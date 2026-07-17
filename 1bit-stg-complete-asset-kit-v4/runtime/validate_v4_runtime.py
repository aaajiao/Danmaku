#!/usr/bin/env python3
"""Strict, dependency-free validator for the 1bit V4 runtime contract."""

import argparse
import json
import math
import re
import subprocess
import sys
from functools import reduce
from operator import mul
from pathlib import Path


SCHEMA_VERSION = "4.0.0"
RUNTIME_DIR = Path(__file__).resolve().parent
V4_ROOT = RUNTIME_DIR.parent
MANIFEST_DIR = V4_ROOT / "manifests" / "runtime"


class DuplicateKeyError(ValueError):
    pass


def strict_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise DuplicateKeyError("duplicate JSON key: {}".format(key))
        result[key] = value
    return result


def load_json(path, errors):
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle, object_pairs_hook=strict_object)
    except (OSError, ValueError) as exc:
        errors.append("{}: {}".format(path, exc))
        return {}


def require(condition, message, errors):
    if not condition:
        errors.append(message)


def unique_ids(items, label, errors):
    ids = [item.get("id") for item in items if isinstance(item, dict)]
    require(all(isinstance(value, str) and value for value in ids),
            "{} contains a missing/invalid id".format(label), errors)
    duplicates = sorted({value for value in ids if ids.count(value) > 1})
    require(not duplicates, "{} duplicate ids: {}".format(label, duplicates), errors)
    return set(ids)


def validate_versions(documents, errors):
    for name, document in documents.items():
        require(document.get("schemaVersion") == SCHEMA_VERSION,
                "{} schemaVersion must be {}".format(name, SCHEMA_VERSION), errors)


def extract_ts_event_ids(errors):
    source_path = RUNTIME_DIR / "events.ts"
    try:
        source = source_path.read_text(encoding="utf-8")
    except OSError as exc:
        errors.append("cannot read {}: {}".format(source_path, exc))
        return set()
    match = re.search(r"export const EVENT_IDS\s*=\s*\[(.*?)\]\s*as const", source, re.S)
    require(match is not None, "events.ts EVENT_IDS array is not parseable", errors)
    if match is None:
        return set()
    values = re.findall(r'"([A-Za-z0-9_.-]+)"', match.group(1))
    require(len(values) == len(set(values)), "events.ts contains duplicate event ids", errors)
    return set(values)


def validate_events(document, errors):
    envelope = document.get("envelope", {})
    require(envelope.get("authority") == "gameplay", "event envelope must be gameplay-authoritative", errors)
    required_envelope = {"id", "authority", "simulationTimeMs", "sequence", "occurrenceKey", "payload"}
    require(set(envelope.get("required", [])) == required_envelope,
            "event envelope required fields differ from the runtime contract", errors)
    events = document.get("events", [])
    event_ids = unique_ids(events, "event catalog", errors)
    for event in events:
        require(event.get("criticality") in {"critical", "support"},
                "event {} has invalid criticality".format(event.get("id")), errors)
        require(isinstance(event.get("domain"), str) and event.get("domain"),
                "event {} has invalid domain".format(event.get("id")), errors)
        required_payload = event.get("requiredPayload")
        require(isinstance(required_payload, list) and len(required_payload) == len(set(required_payload or [])),
                "event {} requiredPayload must be a unique list".format(event.get("id")), errors)
    ts_event_ids = extract_ts_event_ids(errors)
    require(event_ids == ts_event_ids,
            "event catalog/TypeScript mismatch: manifestOnly={}, tsOnly={}".format(
                sorted(event_ids - ts_event_ids), sorted(ts_event_ids - event_ids)), errors)
    return event_ids


def validate_state_machines(document, event_ids, contract, errors):
    machines = document.get("machines", [])
    machine_ids = unique_ids(machines, "state machines", errors)
    required = {
        "playerDamage", "projectileLifecycle", "grazeAward", "gaze", "flowerIntensity",
        "directionalOverride", "bossPhase", "weather", "snapshot", "crossRunArchive",
        "crossRunRestore", "roomTransition",
    }
    require(machine_ids == required,
            "state machine set mismatch: missing={}, extra={}".format(
                sorted(required - machine_ids), sorted(machine_ids - required)), errors)

    by_id = {machine.get("id"): machine for machine in machines}
    for machine in machines:
        states = machine.get("states", [])
        require(isinstance(states, list) and states, "machine {} has no states".format(machine.get("id")), errors)
        require(machine.get("initialState") in states,
                "machine {} initial state is not declared".format(machine.get("id")), errors)
        transitions = machine.get("transitions", [])
        require(isinstance(transitions, list) and transitions,
                "machine {} has no transitions".format(machine.get("id")), errors)
        for transition in transitions:
            refs = transition.get("events", [])
            require(isinstance(refs, list) and refs,
                    "machine {} has a transition with no events".format(machine.get("id")), errors)
            unknown = set(refs) - event_ids
            require(not unknown,
                    "machine {} references unknown events {}".format(machine.get("id"), sorted(unknown)), errors)

    damage = by_id.get("playerDamage", {})
    require(any("exactly one" in item for item in damage.get("invariants", [])),
            "playerDamage lacks exclusive branch invariant", errors)
    require(contract.get("playerDamage", {}).get("mutuallyExclusive") is True,
            "runtime contract must make damage branches mutually exclusive", errors)
    require(contract.get("playerDamage", {}).get("directCollisionToggleForbidden") is True,
            "collision blocker leases are not mandatory", errors)

    projectile = by_id.get("projectileLifecycle", {})
    require(projectile.get("flightDurationMs") is None,
            "projectile flight must have no FSM duration", errors)
    projectile_contract = contract.get("projectileLifecycle", {})
    require(projectile_contract.get("fixedFlightTimeoutForbidden") is True,
            "fixed projectile flight timeout is not forbidden", errors)
    require(projectile_contract.get("flightOwner") == "projectile-entity",
            "projectile entity must own flight", errors)

    flower = by_id.get("flowerIntensity", {})
    require(flower.get("priorityHighToLow") == ["override", "gaze", "focus", "signal"],
            "flower resolver priority must be Override > Gaze > Focus > Signal", errors)
    override = by_id.get("directionalOverride", {})
    require(override.get("geometry") == "forward-sector" and override.get("globalInvulnerability") is False,
            "override must be a directional local sector without global invulnerability", errors)

    snapshot = by_id.get("snapshot", {})
    require(snapshot.get("mayEmitCrossRunEvents") is False,
            "snapshot must not own cross-run restore", errors)
    snapshot_refs = {
        event for transition in snapshot.get("transitions", []) for event in transition.get("events", [])
    }
    require(not any(event.startswith("cross_run.") for event in snapshot_refs),
            "snapshot transition emits cross-run event", errors)
    restore = by_id.get("crossRunRestore", {})
    require(restore.get("orderedSteps") == [
        "overrideScar", "deathTrace", "burnIn", "actual-ghost-route",
        "ghostResidue", "witnessOrientation", "returnInput",
    ],
            "cross-run restore order is wrong", errors)
    require(restore.get("routeDurationAuthority") == "last actual ghostRoute point tMs",
            "cross-run restore does not derive duration from the actual route", errors)
    restore_refs = [
        event for transition in restore.get("transitions", []) for event in transition.get("events", [])
    ]
    required_restore_events = [
        "overrideScar.rehydrate", "deathTrace.rehydrate", "burnIn.rehydrate",
        "ghost.replay.begin", "ghost.replay.complete", "ghost.residue.write",
        "witness.turn", "returnInput",
    ]
    require(all(event in restore_refs for event in required_restore_events),
            "cross-run state machine is missing narrative-authoritative events", errors)
    require(not any(event in restore_refs for event in {
        "cross_run.scar.restore.commit", "cross_run.ghost.restore.commit",
        "cross_run.ghost.playback.begin", "cross_run.ghost.playback.complete",
        "cross_run.witness.orient.commit", "player.input.on",
    }), "cross-run state machine retains legacy fixed-clock events", errors)


def validate_accessibility(document, contract, errors):
    require(document.get("gameplayEventTraceInvariant") is True,
            "accessibility must preserve gameplay event traces", errors)
    require(document.get("axesAreOrthogonal") is True,
            "accessibility axes must be orthogonal", errors)
    expected_values = {
        "motion": ["full", "reduced"],
        "flashing": ["full", "reduced", "off"],
        "contrast": ["room-authored", "high-separation", "softened"],
        "notch": ["standard", "reinforced"],
        "binaural": ["spatial", "mono"],
        "haptics": ["full", "reduced", "off"],
    }
    axes = document.get("axes", {})
    require(set(axes) == set(expected_values), "accessibility axis set is incomplete", errors)
    for axis, values in expected_values.items():
        require(axes.get(axis, {}).get("values") == values,
                "accessibility axis {} values are wrong".format(axis), errors)
        never = axes.get(axis, {}).get("neverAffects", [])
        require(isinstance(never, list) and never,
                "accessibility axis {} must declare neverAffects".format(axis), errors)
    combinations = reduce(mul, (len(values) for values in expected_values.values()), 1)
    require(document.get("cartesianCombinationCount") == combinations,
            "accessibility Cartesian combination count is wrong", errors)

    presets = document.get("presets", {})
    for preset_id, preset in presets.items():
        require(set(preset) == set(expected_values),
                "preset {} does not set every axis".format(preset_id), errors)
        for axis, values in expected_values.items():
            require(preset.get(axis) in values,
                    "preset {} has invalid {} value".format(preset_id, axis), errors)
    require({"full", "reducedMotion", "flashOff"}.issubset(presets),
            "trace parity presets are missing", errors)
    invariant = contract.get("accessibilityInvariant", {})
    require(invariant.get("gameplayAuthorityUnaffected") is True,
            "runtime contract allows accessibility to affect gameplay", errors)
    require(invariant.get("collisionMayDependOnAccessibility") is False,
            "collision may not depend on accessibility", errors)


def validate_feedback(document, event_ids, errors):
    policy = document.get("policy", {})
    require(policy.get("sourceKind") == "gameplay-event", "feedback source must be gameplay event", errors)
    sink_kinds = set(policy.get("sinkKinds", []))
    require(sink_kinds == {"visual", "audio", "haptic", "ui"}, "feedback sink kinds are invalid", errors)
    require(policy.get("sinkMayEmitGameplay") is False, "feedback sinks may not emit gameplay", errors)

    bindings = document.get("bindings", [])
    binding_ids = unique_ids(bindings, "feedback bindings", errors)
    covered = set()
    for binding in bindings:
        event_id = binding.get("eventId")
        require(event_id in event_ids,
                "feedback binding {} references unknown event {}".format(binding.get("id"), event_id), errors)
        sink = binding.get("sink", {})
        require(sink.get("kind") in sink_kinds and sink.get("kind") != "gameplay",
                "feedback binding {} has invalid sink".format(binding.get("id")), errors)
        require(isinstance(sink.get("cueId"), str) and sink.get("cueId"),
                "feedback binding {} has no cue".format(binding.get("id")), errors)
        modifiers = binding.get("modifiers", {})
        conditional = any(modifiers.get(key) is True for key in ("motionSensitive", "usesFlashing", "binaural"))
        if binding.get("gameplayCritical") is True and conditional:
            fallback = binding.get("fallback", {})
            require(isinstance(fallback.get("cueId"), str) and fallback.get("cueId"),
                    "critical conditional binding {} has no fallback".format(binding.get("id")), errors)
        if binding.get("gameplayCritical") is True and sink.get("kind") in {"visual", "ui"}:
            covered.add(event_id)
    required = set(document.get("requiredCriticalEvents", []))
    require(required.issubset(event_ids), "feedback requiredCriticalEvents contains unknown event", errors)
    require(required.issubset(covered),
            "critical feedback coverage missing {}".format(sorted(required - covered)), errors)

    source = (RUNTIME_DIR / "feedback.ts").read_text(encoding="utf-8")
    marker = "export const REFERENCE_FEEDBACK_BINDINGS"
    require(marker in source, "feedback.ts canonical binding constant is missing", errors)
    ts_binding_ids = set(re.findall(r'\bid:\s*"([A-Za-z0-9_.-]+)"', source.split(marker, 1)[-1]))
    require(binding_ids == ts_binding_ids,
            "feedback manifest/TypeScript mismatch: manifestOnly={}, tsOnly={}".format(
                sorted(binding_ids - ts_binding_ids), sorted(ts_binding_ids - binding_ids)), errors)


def validate_inventory(document, errors):
    require(document.get("canonical") is True, "runtime manifest is not canonical", errors)
    manifests = document.get("manifests", {})
    runtime_files = document.get("referenceImplementation", {})
    qa_files = document.get("qaArtifacts", {})
    for label, relative in {**manifests, **runtime_files, **qa_files}.items():
        path = V4_ROOT / relative
        require(path.is_file(), "inventory path {} missing: {}".format(label, path), errors)

    source = "\n".join(
        path.read_text(encoding="utf-8")
        for path in RUNTIME_DIR.glob("*.ts")
        if path.is_file()
    )
    exported_classes = set(re.findall(r"export class ([A-Za-z0-9_]+)", source))
    authoritative = set(document.get("authoritativeSystems", []))
    require(authoritative.issubset(exported_classes),
            "authoritative implementations missing: {}".format(sorted(authoritative - exported_classes)), errors)
    require("FeedbackRouter" in document.get("nonAuthoritativeSystems", []),
            "FeedbackRouter must be explicitly non-authoritative", errors)


def validate_timing_source(contract, errors):
    source = (RUNTIME_DIR / "world.ts").read_text(encoding="utf-8")
    timing = contract.get("canonicalTimingMs", {})
    static_expected = {
        "serializeAtMs": timing.get("snapshot", {}).get("serialize"),
        "presentAtMs": timing.get("snapshot", {}).get("present"),
        "completeAtMs": timing.get("snapshot", {}).get("complete"),
        "worldSwapAtMs": timing.get("roomTransition", {}).get("worldSwap"),
        "roomReadyAtMs": timing.get("roomTransition", {}).get("roomReady"),
    }
    for identifier, value in static_expected.items():
        require(isinstance(value, (int, float)) and math.isfinite(value),
                "contract timing {} is invalid".format(identifier), errors)
        pattern = r"{}:\s*{}(?:\.0+)?\b".format(re.escape(identifier), re.escape(str(value)))
        require(re.search(pattern, source) is not None,
                "TypeScript timing {} does not match contract value {}".format(identifier, value), errors)

    restore_timing = timing.get("crossRunRestore", {})
    expected_restore = {
        "materialRehydrate": 0,
        "ghostReplayBegin": 420,
        "ghostReplayComplete": "routeDurationMs+420",
        "ghostResidueWrite": "routeDurationMs+421",
        "witnessTurn": "routeDurationMs+700",
        "inputReturn": "routeDurationMs+1140",
    }
    require(restore_timing == expected_restore,
            "cross-run contract timing must match narrative routeDuration expressions", errors)
    source_offsets = {
        "materialRehydrateAtMs": 0,
        "ghostReplayBeginAtMs": 420,
        "ghostReplayCompleteOffsetMs": 420,
        "ghostResidueWriteOffsetMs": 421,
        "witnessTurnOffsetMs": 700,
        "inputReturnOffsetMs": 1140,
    }
    for identifier, value in source_offsets.items():
        require(re.search(r"{}:\s*{}\b".format(identifier, value), source) is not None,
                "TypeScript cross-run offset {} must be {}".format(identifier, value), errors)
    require("routeDurationMs + CROSS_RUN_RESTORE_OFFSETS.ghostReplayCompleteOffsetMs" in source,
            "ghost completion is not derived from routeDurationMs", errors)
    require("routeDurationMs + CROSS_RUN_RESTORE_OFFSETS.inputReturnOffsetMs" in source,
            "input return is not derived from routeDurationMs", errors)
    require(not any(legacy in source for legacy in (
        "scarRestoreAtMs", "ghostRestoreAtMs", "CROSS_RUN_RESTORE_TIMING",
    )), "legacy fixed cross-run timing remains in TypeScript", errors)


def validate_narrative_alignment(contract, errors):
    path = V4_ROOT / "manifests" / "narrative" / "ui-layouts-v4.json"
    narrative = load_json(path, errors)
    timeline = narrative.get("screens", {}).get("cross_run_transition", {}).get("authoritativeTimeline", [])
    expected = [
        {"atGameplayMs": 0, "event": "overrideScar.rehydrate"},
        {"atGameplayMs": 0, "event": "deathTrace.rehydrate"},
        {"atGameplayMs": 0, "event": "burnIn.rehydrate"},
        {"atGameplayMs": 420, "event": "ghost.replay.begin"},
        {"atGameplayMs": "routeDuration+420", "event": "ghost.replay.complete"},
        {"atGameplayMs": "routeDuration+421", "event": "ghost.residue.write"},
        {"atGameplayMs": "routeDuration+700", "event": "witness.turn"},
        {"atGameplayMs": "routeDuration+1140", "event": "returnInput"},
    ]
    require(timeline == expected, "runtime integration no longer matches narrative authoritative timeline", errors)
    separation = contract.get("snapshotSeparation", {})
    require(separation.get("materialTypesAreDisjoint") is True,
            "runtime contract does not keep material types disjoint", errors)
    require(separation.get("restoreOrder") == [
        "overrideScar", "deathTrace", "burnIn", "actual-ghost-route",
        "ghostResidue", "witnessOrientation", "returnInput",
    ], "runtime restore order differs from narrative memory schema", errors)


def validate_room_identity(contract, errors):
    identity = contract.get("roomIdentity", {})
    canonical = {"INFORMATION", "FORCED_ALIGNMENT", "IN_BETWEEN", "POLARIZED"}
    require(set(identity.get("canonicalIds", [])) == canonical,
            "runtime canonical room IDs are inconsistent", errors)
    require(identity.get("migrationReadAliases") == {"INFO_OVERFLOW": "INFORMATION"},
            "INFO_OVERFLOW may only exist as the INFORMATION read alias", errors)
    require(identity.get("writePolicy") == "canonical-only",
            "runtime room write policy must be canonical-only", errors)
    source = (RUNTIME_DIR / "world.ts").read_text(encoding="utf-8")
    match = re.search(r'export type RoomId\s*=\s*([^;]+);', source)
    require(match is not None, "RoomId type is not parseable", errors)
    if match is not None:
        room_ids = set(re.findall(r'"([A-Z_]+)"', match.group(1)))
        require(room_ids == canonical, "TypeScript RoomId contains non-canonical IDs", errors)
    machine_source = source.split("export class RoomTransitionMachine", 1)[-1]
    require("INFO_OVERFLOW" not in machine_source,
            "RoomTransitionMachine may not emit the legacy INFO_OVERFLOW ID", errors)


def run_code_checks(errors):
    compile_result = subprocess.run(
        ["tsc", "-p", str(RUNTIME_DIR / "tsconfig.json")],
        cwd=str(V4_ROOT), text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    if compile_result.returncode != 0:
        errors.append("TypeScript strict compilation failed:\n{}".format(compile_result.stdout.strip()))
        return "", ""
    test_result = subprocess.run(
        ["node", str(RUNTIME_DIR / "build" / "runtime.test.js")],
        cwd=str(V4_ROOT), text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    if test_result.returncode != 0:
        errors.append("runtime tests failed:\n{}".format(test_result.stdout.strip()))
    return compile_result.stdout.strip(), test_result.stdout.strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-code", action="store_true", help="also run tsc strict and runtime tests")
    parser.add_argument("--strict-warnings", action="store_true", help="fail if warnings are emitted")
    args = parser.parse_args()

    errors = []
    warnings = []
    paths = {
        "inventory": MANIFEST_DIR / "runtime-manifest-v4.json",
        "contract": MANIFEST_DIR / "runtime-contract-v4.json",
        "events": MANIFEST_DIR / "event-schema-v4.json",
        "machines": MANIFEST_DIR / "state-machines-v4.json",
        "accessibility": MANIFEST_DIR / "accessibility-profiles-v4.json",
        "feedback": MANIFEST_DIR / "feedback-bindings-v4.json",
    }
    documents = {name: load_json(path, errors) for name, path in paths.items()}
    validate_versions(documents, errors)
    event_ids = validate_events(documents["events"], errors)
    validate_state_machines(documents["machines"], event_ids, documents["contract"], errors)
    validate_accessibility(documents["accessibility"], documents["contract"], errors)
    validate_feedback(documents["feedback"], event_ids, errors)
    validate_inventory(documents["inventory"], errors)
    validate_timing_source(documents["contract"], errors)
    validate_narrative_alignment(documents["contract"], errors)
    validate_room_identity(documents["contract"], errors)

    test_output = ""
    if args.run_code:
        _, test_output = run_code_checks(errors)

    print("V4 RUNTIME VALIDATION")
    print("events={}".format(len(event_ids)))
    print("machines={}".format(len(documents["machines"].get("machines", []))))
    print("feedbackBindings={}".format(len(documents["feedback"].get("bindings", []))))
    print("accessibilityCombinations={}".format(documents["accessibility"].get("cartesianCombinationCount", 0)))
    if test_output:
        print(test_output)
    for warning in warnings:
        print("WARNING {}".format(warning))
    for error in errors:
        print("ERROR {}".format(error))
    print("errors={} warnings={}".format(len(errors), len(warnings)))

    if errors or (args.strict_warnings and warnings):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
