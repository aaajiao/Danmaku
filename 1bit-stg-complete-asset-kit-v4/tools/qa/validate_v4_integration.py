#!/usr/bin/env python3
"""Strict cross-subsystem QA for the independent 1bit STG V4 package.

The validator intentionally has no project-relative working-directory assumption.
It can run from ``work/v4/qa`` and, after packaging, from ``tools/qa``.  The package
root is discovered by finding the canonical V4 gameplay manifest layout.
"""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import math
import re
import sys
import wave
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

try:
    from PIL import Image
except Exception as exc:  # pragma: no cover - reported as a QA failure below
    Image = None
    PIL_IMPORT_ERROR = str(exc)
else:
    PIL_IMPORT_ERROR = ""


SCRIPT = Path(__file__).resolve()
REPORT_JSON_NAME = "v4-integration-validation-report.json"
REPORT_ZH_NAME = "V4_INTEGRATION_VALIDATION_REPORT_ZH.md"


def discover_root(explicit: str | None = None) -> Path:
    if explicit:
        root = Path(explicit).expanduser().resolve()
        if not (root / "manifests" / "gameplay" / "executable-patterns-v4.json").is_file():
            raise SystemExit(f"不是 V4 包根目录：{root}")
        return root

    candidates = [Path.cwd().resolve(), *SCRIPT.parents]
    seen: set[Path] = set()
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        marker = candidate / "manifests" / "gameplay" / "executable-patterns-v4.json"
        if marker.is_file():
            return candidate

    # Compatibility fallback for a package that inserts one level below manifests.
    for candidate in candidates:
        if not candidate.is_dir():
            continue
        for marker in candidate.glob("manifests/**/executable-patterns-v4.json"):
            for ancestor in marker.parents:
                if ancestor.name == "manifests":
                    return ancestor.parent
    raise SystemExit("无法定位 V4 包根目录（缺少 manifests/gameplay/executable-patterns-v4.json）")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def flatten_strings(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from flatten_strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from flatten_strings(child)


def duplicate_values(values: Iterable[str]) -> list[str]:
    counts = Counter(values)
    return sorted(value for value, count in counts.items() if count > 1)


def image_pixels(image: Any) -> list[Any]:
    getter = getattr(image, "get_flattened_data", None)
    return list(getter() if getter else image.getdata())


class Audit:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.checks: list[dict[str, Any]] = []
        self.errors: list[dict[str, str]] = []
        self.warnings: list[dict[str, str]] = []
        self.metrics: dict[str, Any] = {}
        self._json_cache: dict[Path, Any] = {}

    def relative(self, path: Path) -> str:
        try:
            return path.resolve().relative_to(self.root.resolve()).as_posix()
        except ValueError:
            return path.as_posix()

    def check(
        self,
        check_id: str,
        subsystem: str,
        condition: bool,
        detail: str,
        metrics: dict[str, Any] | None = None,
    ) -> None:
        row: dict[str, Any] = {
            "id": check_id,
            "subsystem": subsystem,
            "status": "PASS" if condition else "FAIL",
            "detail": detail,
        }
        if metrics:
            row["metrics"] = metrics
        self.checks.append(row)
        if not condition:
            self.errors.append({"check": check_id, "detail": detail})

    def locate_manifest(self, preferred: str, basename: str | None = None) -> Path:
        direct = self.root / preferred
        if direct.is_file():
            return direct
        name = basename or Path(preferred).name
        matches = sorted(self.root.glob(f"manifests/**/{name}"))
        if len(matches) == 1:
            return matches[0]
        # Working-tree-only manifests (art/background indices) may live outside manifests/.
        matches = sorted(self.root.glob(f"**/{name}"))
        matches = [p for p in matches if "/qa/" not in p.as_posix()]
        if len(matches) == 1:
            return matches[0]
        return direct

    def locate_file(
        self,
        reference: str,
        base: Path | None = None,
        extras: Iterable[Path] = (),
    ) -> Path:
        ref = Path(reference)
        candidates: list[Path] = []
        if ref.is_absolute():
            candidates.append(ref)
        if base is not None:
            candidates.append(base / ref)
        candidates.extend(
            [
                self.root / ref,
                self.root / "art" / ref,
                self.root / "gameplay" / ref,
                self.root / "backgrounds" / ref,
            ]
        )
        candidates.extend(extra / ref for extra in extras)
        for candidate in candidates:
            if candidate.is_file():
                return candidate
        matches = sorted(self.root.glob(f"**/{ref.name}"))
        if len(matches) == 1:
            return matches[0]
        return candidates[0] if candidates else self.root / ref

    def load(self, path: Path) -> Any:
        path = path.resolve()
        if path in self._json_cache:
            return self._json_cache[path]
        data = json.loads(path.read_text(encoding="utf-8"))
        self._json_cache[path] = data
        return data

    def required_json(self, preferred: str) -> tuple[Path, Any]:
        path = self.locate_manifest(preferred)
        if not path.is_file():
            self.check(
                f"required-json:{Path(preferred).name}",
                "package",
                False,
                f"缺少 {preferred}",
            )
            return path, {}
        try:
            return path, self.load(path)
        except Exception as exc:
            self.check(
                f"required-json:{Path(preferred).name}",
                "package",
                False,
                f"无法读取 {preferred}: {exc}",
            )
            return path, {}


def audit_all_json(audit: Audit, report_dir: Path) -> None:
    excluded = {
        (report_dir / REPORT_JSON_NAME).resolve(),
    }
    files = sorted(path for path in audit.root.rglob("*.json") if path.resolve() not in excluded)
    failures: list[str] = []
    for path in files:
        try:
            audit.load(path)
        except Exception as exc:
            failures.append(f"{audit.relative(path)}: {exc}")
    audit.metrics["jsonFiles"] = len(files)
    audit.check(
        "json.syntax.all",
        "package",
        not failures,
        f"{len(files)} 个 JSON 全部可解析" if not failures else "; ".join(failures[:8]),
        {"files": len(files), "failures": len(failures)},
    )

    schema_refs = 0
    missing: list[str] = []
    for source, value in list(audit._json_cache.items()):
        def walk(node: Any) -> None:
            nonlocal schema_refs
            if isinstance(node, dict):
                for key, child in node.items():
                    if key == "$schema" and isinstance(child, str) and not re.match(r"^[a-z]+://", child):
                        schema_refs += 1
                        target = (source.parent / child).resolve()
                        if not target.is_file():
                            missing.append(f"{audit.relative(source)} -> {child}")
                    walk(child)
            elif isinstance(node, list):
                for child in node:
                    walk(child)
        walk(value)
    audit.check(
        "json.local-schema-references",
        "package",
        not missing,
        f"{schema_refs} 个本地 schema 引用全部存在" if not missing else "; ".join(missing[:8]),
        {"references": schema_refs, "missing": len(missing)},
    )


def audit_gameplay(audit: Audit) -> dict[str, Any]:
    _, operators_doc = audit.required_json("manifests/gameplay/motion-operators-v4.json")
    _, patterns_doc = audit.required_json("manifests/gameplay/executable-patterns-v4.json")
    _, enemies_doc = audit.required_json("manifests/gameplay/enemy-archetypes-v4.json")
    _, rigs_doc = audit.required_json("manifests/gameplay/boss-rigs-v4.json")
    _, lasers_doc = audit.required_json("manifests/gameplay/laser-geometries-v4.json")
    _, composers_doc = audit.required_json("manifests/gameplay/room-composers-v4.json")
    _, encounter_director = audit.required_json("manifests/gameplay/encounter-director-v4.json")
    _, run_director = audit.required_json("manifests/gameplay/run-director-v4.json")
    gameplay_index_path, gameplay_index = audit.required_json("manifests/gameplay/gameplay-index-v4.json")

    operators = operators_doc.get("operators", [])
    patterns = patterns_doc.get("patterns", [])
    enemies = enemies_doc.get("enemies", [])
    rigs = rigs_doc.get("rigs", [])
    lasers = lasers_doc.get("lasers", [])
    composers = composers_doc.get("composers", [])

    operator_ids = [row.get("id", "") for row in operators]
    pattern_ids = [row.get("id", "") for row in patterns]
    enemy_ids = [row.get("id", "") for row in enemies]
    rig_ids = [row.get("id", "") for row in rigs]
    laser_ids = [row.get("id", "") for row in lasers]
    definition_groups = {
        "operators": operator_ids,
        "patterns": pattern_ids,
        "enemies": enemy_ids,
        "bosses": rig_ids,
        "lasers": laser_ids,
        "composers": [row.get("id", "") for row in composers],
    }
    duplicate_groups = {name: duplicate_values(values) for name, values in definition_groups.items()}
    duplicate_groups = {name: values for name, values in duplicate_groups.items() if values}

    roles = {row.get("role") for row in enemies}
    phase_counts = [len(row.get("phases", [])) for row in rigs]
    laser_types = [row.get("geometry", {}).get("type") for row in lasers]
    count_ok = (
        len(operators) == 12
        and len(patterns) == 48
        and len(enemies) == 16
        and len(roles) == 8
        and len(rigs) == 8
        and phase_counts == [3] * 8
        and len(lasers) == 8
        and len(set(laser_types)) == 8
    )
    audit.metrics["gameplay"] = {
        "motionOperators": len(operators),
        "patterns": len(patterns),
        "enemies": len(enemies),
        "enemyRoles": len(roles),
        "bosses": len(rigs),
        "bossPhases": sum(phase_counts),
        "lasers": len(lasers),
        "laserTopologies": len(set(laser_types)),
    }
    audit.check(
        "gameplay.required-counts",
        "gameplay",
        count_ok,
        "12 operators / 48 patterns / 16 enemies（8 roles）/ 8 Boss × 3 phases / 8 unique lasers",
        audit.metrics["gameplay"],
    )
    audit.check(
        "gameplay.definition-id-uniqueness",
        "gameplay",
        not duplicate_groups,
        "玩法权威定义 ID 全部唯一" if not duplicate_groups else json.dumps(duplicate_groups, ensure_ascii=False),
    )

    operator_set = set(operator_ids)
    pattern_set = set(pattern_ids)
    laser_set = set(laser_ids)
    broken_refs: list[str] = []
    for pattern in patterns:
        for emitter in pattern.get("emitters", []):
            for operation in emitter.get("motionStack", []):
                if operation.get("operator") not in operator_set:
                    broken_refs.append(f"{pattern.get('id')} -> {operation.get('operator')}")
        if pattern.get("laserGeometry") and pattern["laserGeometry"] not in laser_set:
            broken_refs.append(f"{pattern.get('id')} -> {pattern['laserGeometry']}")
    for enemy in enemies:
        ref = enemy.get("cadence", {}).get("patternId")
        if ref not in pattern_set:
            broken_refs.append(f"{enemy.get('id')} -> {ref}")
    for composer in composers:
        for item in composer.get("patternPool", []):
            if item.get("patternId") not in pattern_set:
                broken_refs.append(f"{composer.get('id')} -> {item.get('patternId')}")
    for phase in run_director.get("phases", []):
        for ref in phase.get("patterns", []):
            if ref not in pattern_set:
                broken_refs.append(f"director:{phase.get('id')} -> {ref}")
    for rig in rigs:
        for phase in rig.get("phases", []):
            if phase.get("patternId") not in pattern_set:
                broken_refs.append(f"{rig.get('id')} -> {phase.get('patternId')}")
            if phase.get("laserGeometry") and phase["laserGeometry"] not in laser_set:
                broken_refs.append(f"{rig.get('id')} -> {phase.get('laserGeometry')}")
    audit.check(
        "gameplay.cross-manifest-references",
        "gameplay",
        not broken_refs,
        "operator / pattern / enemy / boss / laser / director 引用闭合" if not broken_refs else "; ".join(broken_refs[:12]),
        {"brokenReferences": len(broken_refs)},
    )

    checksum_errors: list[str] = []
    for item in gameplay_index.get("files", []):
        target = gameplay_index_path.parent / item.get("path", "")
        if not target.is_file():
            checksum_errors.append(f"missing:{item.get('path')}")
            continue
        if target.stat().st_size != item.get("bytes"):
            checksum_errors.append(f"bytes:{item.get('path')}")
        if sha256(target) != item.get("sha256"):
            checksum_errors.append(f"sha256:{item.get('path')}")
    audit.check(
        "gameplay.canonical-index-checksums",
        "gameplay",
        not checksum_errors,
        f"gameplay index 的 {len(gameplay_index.get('files', []))} 个文件尺寸与 SHA-256 一致" if not checksum_errors else "; ".join(checksum_errors),
    )

    return {
        "operators": operators,
        "patterns": patterns,
        "enemies": enemies,
        "rigs": rigs,
        "lasers": lasers,
        "composers": composers,
        "encounterDirector": encounter_director,
        "patternIds": pattern_set,
        "rigIds": set(rig_ids),
    }


def audit_runtime(audit: Audit) -> dict[str, Any]:
    _, events_doc = audit.required_json("manifests/runtime/event-schema-v4.json")
    _, machines_doc = audit.required_json("manifests/runtime/state-machines-v4.json")
    _, bindings_doc = audit.required_json("manifests/runtime/feedback-bindings-v4.json")
    _, a11y_doc = audit.required_json("manifests/runtime/accessibility-profiles-v4.json")
    _, contract = audit.required_json("manifests/runtime/runtime-contract-v4.json")
    _, runtime_manifest = audit.required_json("manifests/runtime/runtime-manifest-v4.json")

    events = events_doc.get("events", [])
    machines = machines_doc.get("machines", [])
    bindings = bindings_doc.get("bindings", [])
    axes = a11y_doc.get("axes", {})
    event_ids = [row.get("id", "") for row in events]
    machine_ids = [row.get("id", "") for row in machines]
    binding_ids = [row.get("id", "") for row in bindings]
    combinations = math.prod(len(axis.get("values", [])) for axis in axes.values()) if axes else 0

    count_ok = (
        len(events) == 72
        and len(machines) == 12
        and len(bindings) == 34
        and combinations == 216
        and a11y_doc.get("cartesianCombinationCount") == 216
    )
    audit.metrics["runtime"] = {
        "events": len(events),
        "machines": len(machines),
        "feedbackBindings": len(bindings),
        "accessibilityAxes": len(axes),
        "accessibilityCombinations": combinations,
    }
    audit.check(
        "runtime.required-counts",
        "runtime",
        count_ok,
        "72 events / 12 machines / 34 feedback bindings / 216 accessibility combinations",
        audit.metrics["runtime"],
    )

    duplicates = {
        "events": duplicate_values(event_ids),
        "machines": duplicate_values(machine_ids),
        "bindings": duplicate_values(binding_ids),
    }
    duplicates = {key: value for key, value in duplicates.items() if value}
    audit.check(
        "runtime.definition-id-uniqueness",
        "runtime",
        not duplicates,
        "runtime event / machine / binding ID 全部唯一" if not duplicates else json.dumps(duplicates, ensure_ascii=False),
    )

    event_set = set(event_ids)
    machine_event_set: set[str] = set()
    for machine in machines:
        for transition in machine.get("transitions", []):
            machine_event_set.update(transition.get("events", []))
    unknown_machine_events = sorted(machine_event_set - event_set)
    orphan_events = sorted(event_set - machine_event_set)
    unknown_binding_events = sorted(
        {binding.get("eventId") for binding in bindings if binding.get("eventId") not in event_set}
    )
    critical = set(bindings_doc.get("requiredCriticalEvents", []))
    bound = {binding.get("eventId") for binding in bindings}
    missing_critical = sorted(critical - bound)
    refs_ok = not unknown_machine_events and not orphan_events and not unknown_binding_events and not missing_critical
    audit.check(
        "runtime.event-graph-closure",
        "runtime",
        refs_ok,
        "72 个事件全部由状态机定义使用；binding 引用与 critical coverage 完整"
        if refs_ok
        else json.dumps(
            {
                "unknownMachineEvents": unknown_machine_events,
                "orphanEvents": orphan_events,
                "unknownBindingEvents": unknown_binding_events,
                "missingCriticalBindings": missing_critical,
            },
            ensure_ascii=False,
        ),
    )

    invalid_presets: list[str] = []
    for preset_name, preset in a11y_doc.get("presets", {}).items():
        for axis_name, axis in axes.items():
            if preset.get(axis_name) not in axis.get("values", []):
                invalid_presets.append(f"{preset_name}.{axis_name}={preset.get(axis_name)}")
    parity = a11y_doc.get("requiredTraceParity", [])
    parity_ok = ["full", "reducedMotion"] in parity and ["full", "flashOff"] in parity
    audit.check(
        "runtime.accessibility-orthogonality",
        "runtime",
        not invalid_presets and parity_ok and a11y_doc.get("axesAreOrthogonal") is True,
        "6 个轴正交组合；full / reducedMotion / flashOff 强制事件轨迹一致"
        if not invalid_presets and parity_ok
        else "; ".join(invalid_presets) or "缺少强制 trace parity",
    )

    file_refs: list[tuple[str, str]] = []
    for key, ref in runtime_manifest.get("manifests", {}).items():
        file_refs.append((f"manifest:{key}", ref))
    for section in ("referenceImplementation", "qaArtifacts"):
        for key, ref in runtime_manifest.get(section, {}).items():
            file_refs.append((f"{section}:{key}", ref))
    missing_refs = [label for label, ref in file_refs if not audit.locate_file(ref).is_file()]
    audit.check(
        "runtime.declared-file-references",
        "runtime",
        not missing_refs,
        f"runtime manifest 的 {len(file_refs)} 个可部署文件引用全部存在" if not missing_refs else "; ".join(missing_refs),
    )

    return {
        "events": events,
        "machines": machines,
        "bindings": bindings,
        "a11y": a11y_doc,
        "contract": contract,
    }


def audit_narrative(audit: Audit) -> dict[str, Any]:
    narrative_manifest_path, narrative_manifest = audit.required_json("manifests/narrative/narrative-manifest-v4.json")
    _, state_machine = audit.required_json("narrative/narrative-state-machine-v4.json")
    _, world_graph = audit.required_json("narrative/world-reaction-graph-v4.json")
    _, thresholds = audit.required_json("narrative/room-thresholds-v4.json")
    _, weather = audit.required_json("narrative/weather-system-v4.json")
    _, resolutions = audit.required_json("narrative/boss-resolutions-v4.json")
    _, observations = audit.required_json("narrative/snapshot-observations-v4.json")
    _, witness = audit.required_json("manifests/narrative/witness-conditions-v4.json")
    _, cues = audit.required_json("manifests/narrative/feedback-cues-v4.json")
    _, ui_copy = audit.required_json("manifests/narrative/ui-copy-v4.json")
    _, ui_layouts = audit.required_json("manifests/narrative/ui-layouts-v4.json")
    _, ghost = audit.required_json("manifests/narrative/ghost-replay-contract-v4.json")

    room_threshold_count = sum(len(room.get("thresholds", [])) for room in thresholds.get("rooms", {}).values())
    metrics = {
        "states": len(state_machine.get("states", {})),
        "worldReactionNodes": len(world_graph.get("reactionNodes", {})),
        "roomThresholds": room_threshold_count,
        "weatherTypes": len(weather.get("weather", {})),
        "bossResolutions": len(resolutions.get("bosses", [])),
        "snapshotObservations": len(observations.get("observations", [])),
        "witnessStates": len(witness.get("states", [])),
        "feedbackCues": len(cues.get("cues", [])),
    }
    audit.metrics["narrative"] = metrics
    expected = {
        "states": 16,
        "worldReactionNodes": 13,
        "roomThresholds": 16,
        "weatherTypes": 5,
        "bossResolutions": 8,
        "snapshotObservations": 64,
        "witnessStates": 7,
        "feedbackCues": 37,
    }
    audit.check(
        "narrative.required-counts",
        "narrative",
        metrics == expected,
        "16 states / 13 reaction nodes / 16 thresholds / 5 weather / 8 Boss resolutions / 64 observations / 7 witness / 37 cues",
        metrics,
    )

    definition_groups = {
        "bossResolution": [row.get("id", "") for row in resolutions.get("bosses", [])],
        "observation": [row.get("id", "") for row in observations.get("observations", [])],
        "witness": [row.get("id", "") for row in witness.get("states", [])],
        "feedbackCue": [row.get("id", "") for row in cues.get("cues", [])],
        "roomThreshold": [
            row.get("id", "")
            for room in thresholds.get("rooms", {}).values()
            for row in room.get("thresholds", [])
        ],
    }
    duplicates = {key: duplicate_values(values) for key, values in definition_groups.items()}
    duplicates = {key: value for key, value in duplicates.items() if value}
    audit.check(
        "narrative.semantic-id-uniqueness",
        "narrative",
        not duplicates,
        "叙事状态、观察、Witness、反馈 cue 与阈值语义 ID 全部唯一" if not duplicates else json.dumps(duplicates, ensure_ascii=False),
    )

    source_nodes = set(world_graph.get("sourceNodes", []))
    reaction_nodes = set(world_graph.get("reactionNodes", {}).keys())
    bad_edges = [
        edge for edge in world_graph.get("edges", [])
        if edge.get("from") not in source_nodes or edge.get("to") not in reaction_nodes
    ]
    bad_inputs = [
        f"{node}:{source}"
        for node, contract in world_graph.get("reactionNodes", {}).items()
        for source in contract.get("inputs", [])
        if source not in source_nodes
    ]
    audit.check(
        "narrative.reaction-graph-closure",
        "narrative",
        not bad_edges and not bad_inputs,
        "世界反应图的 source / reaction node / edge 引用闭合"
        if not bad_edges and not bad_inputs
        else f"badEdges={len(bad_edges)} badInputs={bad_inputs[:8]}",
    )

    canonical_missing: list[str] = []
    for label, ref in narrative_manifest.get("canonicalFiles", {}).items():
        if not audit.locate_file(ref, base=narrative_manifest_path.parent).is_file():
            canonical_missing.append(f"{label}:{ref}")
    audit.check(
        "narrative.canonical-file-references",
        "narrative",
        not canonical_missing,
        f"{len(narrative_manifest.get('canonicalFiles', {}))} 个 narrative canonical file 引用全部存在"
        if not canonical_missing else "; ".join(canonical_missing),
    )

    forbidden = [token.casefold() for token in ui_copy.get("forbiddenTokensCaseInsensitive", [])]
    forbidden_hits: list[str] = []
    for copy_id, locales in ui_copy.get("copy", {}).items():
        for locale, text in locales.items():
            folded = str(text).casefold()
            for token in forbidden:
                if token in folded:
                    forbidden_hits.append(f"{copy_id}.{locale}:{token}")
    audit.check(
        "ui.forbidden-copy-tokens",
        "ui",
        not forbidden_hits,
        "实际 UI copy 不含 Score / Rank / Perfect / 道德化结局禁词" if not forbidden_hits else "; ".join(forbidden_hits),
    )

    copy_refs: list[str] = []
    def gather_copy_refs(node: Any) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                if key in {"labelCopy", "copy", "copyNote"} and isinstance(value, str):
                    copy_refs.append(value)
                gather_copy_refs(value)
        elif isinstance(node, list):
            for value in node:
                gather_copy_refs(value)
    gather_copy_refs(ui_layouts)
    missing_copy = sorted(set(copy_refs) - set(ui_copy.get("copy", {})))
    audit.check(
        "ui.layout-copy-references",
        "ui",
        not missing_copy,
        f"UI layout 的 {len(set(copy_refs))} 个 copy key 全部可解析" if not missing_copy else "; ".join(missing_copy),
    )

    return {
        "stateMachine": state_machine,
        "worldGraph": world_graph,
        "thresholds": thresholds,
        "weather": weather,
        "resolutions": resolutions,
        "observations": observations,
        "witness": witness,
        "cues": cues,
        "uiCopy": ui_copy,
        "uiLayouts": ui_layouts,
        "ghost": ghost,
    }


def audit_audio(audit: Audit, narrative: dict[str, Any]) -> dict[str, Any]:
    _, audio = audit.required_json("manifests/narrative/audio-manifest-v4.json")
    assets = audio.get("assets", [])
    category_counts = Counter(row.get("category") for row in assets)
    count_ok = (
        len(assets) == 48
        and category_counts == Counter({"sfx": 36, "boss-signal": 8, "room-bed": 4})
    )
    audit.metrics["audio"] = {
        "assets": len(assets),
        "roomBeds": category_counts.get("room-bed", 0),
        "bossSignals": category_counts.get("boss-signal", 0),
        "sfx": category_counts.get("sfx", 0),
    }
    audit.check(
        "audio.required-counts",
        "audio",
        count_ok,
        "48 WAV：4 room beds / 8 Boss signals / 36 SFX",
        audit.metrics["audio"],
    )
    ids = [row.get("id", "") for row in assets]
    audit.check(
        "audio.asset-id-uniqueness",
        "audio",
        not duplicate_values(ids),
        "48 个音频 asset ID 全部唯一",
    )

    file_errors: list[str] = []
    for row in assets:
        target = audit.locate_file(row.get("path", ""))
        asset_id = row.get("id", "unknown")
        if not target.is_file():
            file_errors.append(f"missing:{asset_id}")
            continue
        if target.stat().st_size != row.get("bytes"):
            file_errors.append(f"bytes:{asset_id}")
        if sha256(target) != row.get("sha256"):
            file_errors.append(f"sha256:{asset_id}")
        try:
            with wave.open(str(target), "rb") as wav:
                duration_ms = wav.getnframes() * 1000.0 / wav.getframerate()
                if wav.getframerate() != row.get("sampleRate", 48000):
                    file_errors.append(f"sampleRate:{asset_id}")
                if wav.getnchannels() != row.get("channels", 2):
                    file_errors.append(f"channels:{asset_id}")
                if wav.getsampwidth() * 8 != row.get("bitDepth", 16):
                    file_errors.append(f"bitDepth:{asset_id}")
                if abs(duration_ms - float(row.get("durationMs", -9999))) > 1.0:
                    file_errors.append(f"duration:{asset_id}")
        except Exception as exc:
            file_errors.append(f"wav:{asset_id}:{exc}")
    audit.check(
        "audio.files-hashes-wave-format",
        "audio",
        not file_errors,
        "48 个 WAV 的文件、尺寸、SHA-256、48kHz / stereo / 16-bit / duration 全部一致"
        if not file_errors else "; ".join(file_errors[:16]),
    )

    audio_set = set(ids)
    missing_cue_audio: list[str] = []
    for cue in narrative["cues"].get("cues", []):
        ref = cue.get("audio")
        if ref == "boss.{bossId}.signal":
            expected = {f"boss.{boss.get('id')}.signal" for boss in narrative["resolutions"].get("bosses", [])}
            missing_cue_audio.extend(sorted(expected - audio_set))
        elif ref not in {None, "none"} and ref not in audio_set:
            missing_cue_audio.append(f"{cue.get('id')}->{ref}")
    audit.check(
        "audio.feedback-cue-references",
        "audio",
        not missing_cue_audio,
        "37 个 narrative feedback cue 的音频引用全部可解析" if not missing_cue_audio else "; ".join(missing_cue_audio),
    )
    return {"manifest": audio, "assetIds": audio_set}


def audit_art(audit: Audit) -> dict[str, Any]:
    atlas_path = audit.locate_manifest("art/manifests/atlas-index-v4-additions.json")
    frame_path = audit.locate_manifest("art/manifests/frame-index-v4-additions.json")
    try:
        atlas_doc = audit.load(atlas_path)
        frame_doc = audit.load(frame_path)
    except Exception as exc:
        audit.check("art.required-manifests", "art", False, str(exc))
        return {"frames": [], "semanticIds": set()}

    atlases = atlas_doc.get("atlases", [])
    frames = frame_doc.get("frames", [])
    palette = {
        tuple(int(value[index:index + 2], 16) for index in (1, 3, 5))
        for value in atlas_doc.get("palette", {}).values()
    }
    ids = [row.get("semanticId", "") for row in frames]
    audit.metrics["art"] = {
        "atlases": len(atlases),
        "frames": len(frames),
        "paletteColors": len(palette),
    }
    audit.check(
        "art.required-counts",
        "art",
        len(atlases) == 3 and len(frames) == 192 and len(palette) == 8,
        "3 个 V4 atlas / 192 semantic frames / exact 8-color palette",
        audit.metrics["art"],
    )
    audit.check(
        "art.semantic-id-uniqueness",
        "art",
        not duplicate_values(ids),
        "192 个 atlas semanticId 全部唯一" if not duplicate_values(ids) else "; ".join(duplicate_values(ids)),
    )

    atlas_by_id = {row.get("id"): row for row in atlases}
    frame_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for frame in frames:
        frame_groups[frame.get("board")].append(frame)
    errors: list[str] = []
    if Image is None:
        errors.append(f"Pillow unavailable:{PIL_IMPORT_ERROR}")
    else:
        for atlas_id, atlas in atlas_by_id.items():
            target = audit.locate_file(atlas.get("file", ""))
            if not target.is_file():
                errors.append(f"missing:{atlas_id}")
                continue
            if sha256(target) != atlas.get("sha256"):
                errors.append(f"sha256:{atlas_id}")
            try:
                image = Image.open(target).convert("RGBA")
            except Exception as exc:
                errors.append(f"open:{atlas_id}:{exc}")
                continue
            if list(image.size) != atlas.get("size"):
                errors.append(f"size:{atlas_id}")
            pixels = image_pixels(image)
            alphas = {pixel[3] for pixel in pixels}
            colors = {pixel[:3] for pixel in pixels if pixel[3] > 0}
            if not alphas.issubset({0, 255}):
                errors.append(f"alpha:{atlas_id}:{sorted(alphas)[:8]}")
            if not colors.issubset(palette):
                errors.append(f"palette:{atlas_id}:{sorted(colors - palette)[:4]}")
            board_frames = frame_groups.get(atlas_id, [])
            if len(board_frames) != 64:
                errors.append(f"frameCount:{atlas_id}:{len(board_frames)}")
            seen_rects: set[tuple[int, ...]] = set()
            for frame in board_frames:
                rect = tuple(frame.get("rect", []))
                if len(rect) != 4 or rect in seen_rects:
                    errors.append(f"rect:{frame.get('semanticId')}")
                    continue
                seen_rects.add(rect)
                x, y, width, height = rect
                if x < 0 or y < 0 or width <= 0 or height <= 0 or x + width > image.width or y + height > image.height:
                    errors.append(f"bounds:{frame.get('semanticId')}")
                    continue
                crop = image.crop((x, y, x + width, y + height))
                visible = {pixel[:3] for pixel in image_pixels(crop) if pixel[3] > 0}
                if not visible:
                    errors.append(f"empty:{frame.get('semanticId')}")
                if len(visible) != frame.get("visibleColorCount"):
                    errors.append(f"visibleColorCount:{frame.get('semanticId')}")
                if len(visible) > 4:
                    errors.append(f"cellPaletteBudget:{frame.get('semanticId')}:{len(visible)}")
            source = audit.locate_file(atlas.get("source", ""))
            if not source.is_file():
                errors.append(f"source:{atlas_id}")
    audit.check(
        "art.atlas-palette-alpha-rects-hashes",
        "art",
        not errors,
        "3 个 atlas 通过 SHA-256、尺寸、hard alpha、8 色、每格≤4色、64 rect 与 source 检查"
        if not errors else "; ".join(errors[:20]),
    )
    return {"frames": frames, "semanticIds": set(ids), "palette": palette}


def audit_ui_and_backgrounds(audit: Audit, art: dict[str, Any]) -> None:
    _, ui_doc = audit.required_json("manifests/ui/ui-mockups-v4.json")
    screens = ui_doc.get("screens", [])
    screen_ids = [row.get("id", "") for row in screens]
    screen_files = [row.get("file", "") for row in screens]
    files = [ui_doc.get("overview", ""), *screen_files]
    errors: list[str] = []
    ui_palette = {
        tuple(int(value[index:index + 2], 16) for index in (1, 3, 5))
        for value in ui_doc.get("palette", [])
    }
    if Image is None:
        errors.append(f"Pillow unavailable:{PIL_IMPORT_ERROR}")
    else:
        for ref in files:
            target = audit.locate_file(ref)
            if not target.is_file():
                errors.append(f"missing:{ref}")
                continue
            try:
                image = Image.open(target).convert("RGBA")
                pixels = image_pixels(image)
                alphas = {pixel[3] for pixel in pixels}
                if not alphas.issubset({0, 255}):
                    errors.append(f"alpha:{ref}")
                if ref in screen_files and list(image.size) != ui_doc.get("canvas"):
                    errors.append(f"size:{ref}:{image.size}")
            except Exception as exc:
                errors.append(f"open:{ref}:{exc}")
    audit.metrics["ui"] = {"screens": len(screens), "overview": 1, "files": len(files)}
    audit.check(
        "ui.mockup-files-palette-alpha",
        "ui",
        len(screens) == 9
        and not duplicate_values(screen_ids)
        and not duplicate_values(screen_files)
        and len(ui_palette) == 8
        and not errors,
        "9 个 360×640 UI screen + 1 overview；文件唯一、声明 8 色语义系统、hard alpha"
        if not errors else "; ".join(errors[:16]),
        audit.metrics["ui"],
    )

    overlay_path = audit.locate_manifest("backgrounds/reaction-overlays-v4.json")
    try:
        overlay_doc = audit.load(overlay_path)
    except Exception as exc:
        audit.check("background.required-manifest", "backgrounds", False, str(exc))
        return
    overlays = overlay_doc.get("overlays", [])
    states = set(overlay_doc.get("states", []))
    expected_rooms = {"information", "forced_choice", "in_between", "polarized"}
    actual_pairs = {(row.get("room"), row.get("state")) for row in overlays}
    expected_pairs = set(itertools.product(expected_rooms, states))
    overlay_errors: list[str] = []
    for row in overlays:
        target = audit.locate_file(row.get("file", ""))
        if not target.is_file():
            overlay_errors.append(f"missing:{row.get('id')}")
            continue
        if sha256(target) != row.get("sha256"):
            overlay_errors.append(f"sha256:{row.get('id')}")
        if Image is not None:
            image = Image.open(target).convert("RGBA")
            if list(image.size) != row.get("size"):
                overlay_errors.append(f"size:{row.get('id')}")
            pixels = image_pixels(image)
            if not {pixel[3] for pixel in pixels}.issubset({0, 255}):
                overlay_errors.append(f"alpha:{row.get('id')}")
            if not {pixel[:3] for pixel in pixels if pixel[3] > 0}.issubset(art.get("palette", set())):
                overlay_errors.append(f"palette:{row.get('id')}")
    audit.metrics["backgrounds"] = {"reactionOverlays": len(overlays), "rooms": 4, "states": len(states)}
    audit.check(
        "background.reaction-overlay-matrix",
        "backgrounds",
        len(overlays) == 16
        and len(states) == 4
        and actual_pairs == expected_pairs
        and not duplicate_values([row.get("id", "") for row in overlays])
        and not overlay_errors,
        "4 rooms × 4 states = 16 overlays；ID、文件、SHA-256、8 色、hard alpha 完整"
        if not overlay_errors else "; ".join(overlay_errors[:16]),
        audit.metrics["backgrounds"],
    )


def audit_animations(audit: Audit, gameplay: dict[str, Any]) -> None:
    index_path = audit.locate_manifest("gameplay/animations/animation-index-v4.json")
    try:
        index = audit.load(index_path)
    except Exception as exc:
        audit.check("animations.required-index", "animations", False, str(exc))
        return
    pattern_rows = index.get("patterns", [])
    boss_rows = index.get("bossSequences", [])
    pattern_root = index_path.parent / "patterns"
    boss_root = index_path.parent / "boss-sequences"
    if not pattern_root.is_dir():
        pattern_root = audit.root / "gameplay" / "animations" / "patterns"
    if not boss_root.is_dir():
        boss_root = audit.root / "gameplay" / "animations" / "boss-sequences"

    errors: list[str] = []
    pattern_ids = [row.get("patternId", "") for row in pattern_rows]
    boss_ids = [row.get("bossId", "") for row in boss_rows]
    if set(pattern_ids) != gameplay["patternIds"]:
        errors.append("patternId-set")
    if set(boss_ids) != gameplay["rigIds"]:
        errors.append("bossId-set")

    pattern_by_id = {row.get("id"): row for row in gameplay["patterns"]}
    rig_by_id = {row.get("id"): row for row in gameplay["rigs"]}
    file_sets: dict[str, list[str]] = defaultdict(list)
    hash_sets: dict[str, list[str]] = defaultdict(list)

    def verify_media(row: dict[str, Any], root: Path, expected_frames: int, kind: str) -> None:
        identity = row.get("patternId") or row.get("bossId") or "unknown"
        for extension in ("gif", "apng", "timeline"):
            ref = row.get("files", {}).get(extension)
            if not isinstance(ref, str):
                errors.append(f"missing-ref:{kind}:{identity}:{extension}")
                continue
            file_sets[f"{kind}:{extension}"].append(ref)
            target = root / ref
            if not target.is_file() or target.stat().st_size == 0:
                errors.append(f"missing-file:{kind}:{identity}:{extension}")
                continue
            hash_sets[f"{kind}:{extension}"].append(sha256(target))
            if extension == "timeline":
                try:
                    if audit.load(target) != row:
                        errors.append(f"timeline-identity:{kind}:{identity}")
                except Exception as exc:
                    errors.append(f"timeline-json:{kind}:{identity}:{exc}")
            elif Image is not None:
                try:
                    image = Image.open(target)
                    actual_frames = getattr(image, "n_frames", 1)
                    if actual_frames != expected_frames:
                        errors.append(f"frame-count:{kind}:{identity}:{extension}:{actual_frames}")
                    image.seek(actual_frames - 1)
                except Exception as exc:
                    errors.append(f"media:{kind}:{identity}:{extension}:{exc}")

    for row in pattern_rows:
        pattern_id = row.get("patternId")
        source = pattern_by_id.get(pattern_id, {})
        if row.get("sourceDurationMs") != source.get("durationMs"):
            errors.append(f"duration:{pattern_id}")
        if row.get("timeline") != source.get("timeline"):
            errors.append(f"timeline:{pattern_id}")
        verify_media(row, pattern_root, int(row.get("previewFrameCount", -1)), "pattern")

    for row in boss_rows:
        boss_id = row.get("bossId")
        source = rig_by_id.get(boss_id, {})
        phases = source.get("phases", [])
        phase_rows = row.get("phaseRows", [])
        if len(phase_rows) != 3:
            errors.append(f"boss-phase-count:{boss_id}")
        for phase, preview in zip(phases, phase_rows):
            if phase.get("id") != preview.get("phaseId") or phase.get("patternId") != preview.get("patternId"):
                errors.append(f"boss-phase-identity:{boss_id}:{phase.get('id')}")
        if sum(int(phase.get("frameCount", 0)) for phase in phase_rows) != row.get("previewFrameCount"):
            errors.append(f"boss-frame-sum:{boss_id}")
        verify_media(row, boss_root, int(row.get("previewFrameCount", -1)), "boss")

    for group, refs in file_sets.items():
        if len(refs) != len(set(refs)):
            errors.append(f"reused-file:{group}")
    for group, hashes in hash_sets.items():
        if len(hashes) != len(set(hashes)):
            errors.append(f"duplicate-content:{group}")

    artifact_validation = index.get("artifactValidation", {})
    if artifact_validation.get("status") != "PASS" or artifact_validation.get("errors") not in ([], None):
        errors.append("artifactValidation")
    audit.metrics["animations"] = {
        "patternAnimations": len(pattern_rows),
        "patternArtifacts": sum(len(row.get("files", {})) for row in pattern_rows),
        "bossAnimations": len(boss_rows),
        "bossArtifacts": sum(len(row.get("files", {})) for row in boss_rows),
    }
    audit.check(
        "animations.pattern-and-boss-completeness",
        "animations",
        len(pattern_rows) == 48
        and len(boss_rows) == 8
        and audit.metrics["animations"]["patternArtifacts"] == 144
        and audit.metrics["animations"]["bossArtifacts"] == 24
        and not errors,
        "48 pattern × (GIF/APNG/timeline) + 8 Boss × (GIF/APNG/timeline)；一对一、帧数、identity、内容哈希完整"
        if not errors else "; ".join(errors[:24]),
        audit.metrics["animations"],
    )


def normalize_time(value: Any) -> str:
    if isinstance(value, (int, float)):
        return str(int(value))
    text = str(value).replace("routeDurationMs", "routeDuration")
    text = text.replace("ms", "").replace("Ms", "").replace(" ", "")
    if "@" in text:
        text = text.rsplit("@", 1)[-1]
    return text


def audit_cross_subsystem(
    audit: Audit,
    gameplay: dict[str, Any],
    runtime: dict[str, Any],
    narrative: dict[str, Any],
    audio: dict[str, Any],
    art: dict[str, Any],
) -> None:
    # Canonical room identity across gameplay, runtime and narrative.
    gameplay_rooms = {row.get("room") for row in gameplay["composers"]}
    narrative_rooms = set(narrative["thresholds"].get("rooms", {}).keys())
    runtime_rooms = set(runtime["contract"].get("roomIdentity", {}).get("canonicalIds", []))
    expected_rooms = {"INFORMATION", "FORCED_ALIGNMENT", "IN_BETWEEN", "POLARIZED"}
    aliases = runtime["contract"].get("roomIdentity", {}).get("migrationReadAliases", {})
    room_ok = (
        gameplay_rooms == expected_rooms
        and narrative_rooms == expected_rooms
        and runtime_rooms == expected_rooms
        and aliases.get("INFO_OVERFLOW") == "INFORMATION"
        and runtime["contract"].get("roomIdentity", {}).get("writePolicy") == "canonical-only"
    )
    audit.check(
        "integration.room-identity",
        "integration",
        room_ok,
        "三套系统统一写入 INFORMATION / FORCED_ALIGNMENT / IN_BETWEEN / POLARIZED；INFO_OVERFLOW 仅为迁移读别名"
        if room_ok else json.dumps(
            {"gameplay": sorted(gameplay_rooms), "narrative": sorted(narrative_rooms), "runtime": sorted(runtime_rooms), "aliases": aliases},
            ensure_ascii=False,
        ),
    )

    # Route-duration timing is narrative-authored and runtime-executed without a fixed ghost clock.
    transition = narrative["uiLayouts"].get("screens", {}).get("cross_run_transition", {})
    ui_timeline = {row.get("event"): normalize_time(row.get("atGameplayMs")) for row in transition.get("authoritativeTimeline", [])}
    expected_timeline = {
        "overrideScar.rehydrate": "0",
        "deathTrace.rehydrate": "0",
        "burnIn.rehydrate": "0",
        "ghost.replay.begin": "420",
        "ghost.replay.complete": "routeDuration+420",
        "ghost.residue.write": "routeDuration+421",
        "witness.turn": "routeDuration+700",
        "returnInput": "routeDuration+1140",
    }
    contract_timing = runtime["contract"].get("canonicalTimingMs", {}).get("crossRunRestore", {})
    contract_map = {
        "ghost.replay.begin": normalize_time(contract_timing.get("ghostReplayBegin")),
        "ghost.replay.complete": normalize_time(contract_timing.get("ghostReplayComplete")),
        "ghost.residue.write": normalize_time(contract_timing.get("ghostResidueWrite")),
        "witness.turn": normalize_time(contract_timing.get("witnessTurn")),
        "returnInput": normalize_time(contract_timing.get("inputReturn")),
    }
    restore_machine = next((row for row in runtime["machines"] if row.get("id") == "crossRunRestore"), {})
    machine_map: dict[str, str] = {}
    for transition_row in restore_machine.get("transitions", []):
        time = normalize_time(transition_row.get("trigger"))
        if transition_row.get("trigger", "").startswith("next-run-start"):
            time = "0"
        for event in transition_row.get("events", []):
            if event in expected_timeline:
                machine_map[event] = time
    ghost_order = narrative["ghost"].get("ordering", [])
    required_order = list(expected_timeline)
    order_positions = [ghost_order.index(event) for event in required_order if event in ghost_order]
    order_ok = len(order_positions) == len(required_order) and order_positions == sorted(order_positions)
    timing_ok = (
        ui_timeline == expected_timeline
        and contract_map == {key: expected_timeline[key] for key in contract_map}
        and machine_map == expected_timeline
        and restore_machine.get("routeDurationAuthority") == "last actual ghostRoute point tMs"
        and runtime["contract"].get("snapshotSeparation", {}).get("routeDurationAuthority") == "last-authoritative-ghostRoute-point-tMs"
        and order_ok
    )
    audit.check(
        "integration.cross-run-dynamic-timeline",
        "integration",
        timing_ok,
        "narrative UI / ghost contract / runtime contract / restore machine 统一使用真实 routeDuration：0, 420, +420, +421, +700, +1140"
        if timing_ok else json.dumps(
            {"ui": ui_timeline, "runtimeContract": contract_map, "runtimeMachine": machine_map, "ghostOrder": ghost_order},
            ensure_ascii=False,
        ),
    )

    # Four disjoint material memories must not collapse into a generic scar.
    restore_order = runtime["contract"].get("snapshotSeparation", {}).get("restoreOrder", [])
    material_classes = narrative["worldGraph"].get("materialRemainderClasses", {})
    material_ok = (
        restore_order[:3] == ["overrideScar", "deathTrace", "burnIn"]
        and "ghostResidue" in restore_order
        and all(key in material_classes for key in ("overrideScar", "deathTrace", "burnIn", "ghostResidue"))
        and len({material_classes[key] for key in ("overrideScar", "deathTrace", "burnIn", "ghostResidue")}) == 4
    )
    audit.check(
        "integration.disjoint-material-memory",
        "integration",
        material_ok,
        "overrideScar / deathTrace / burnIn / ghostResidue 四类材料独立定义并按序恢复"
        if material_ok else f"restoreOrder={restore_order}; classes={list(material_classes)}",
    )

    # Boss identity and non-kill resolution facts are narrative-canonical.
    narrative_bosses = {row.get("id"): row for row in narrative["resolutions"].get("bosses", [])}
    gameplay_bosses = {row.get("id", "").removeprefix("boss."): row for row in gameplay["rigs"]}
    boss_errors: list[str] = []
    if set(narrative_bosses) != set(gameplay_bosses):
        boss_errors.append("boss-id-set")
    for boss_id, canonical in narrative_bosses.items():
        rig = gameplay_bosses.get(boss_id, {})
        resolution = rig.get("resolution", {})
        for field in ("resolutionId", "condition", "terminalEvent", "materialRemainder"):
            if resolution.get(field) != canonical.get(field):
                boss_errors.append(f"{boss_id}.{field}")
    audit.check(
        "integration.boss-resolution-worldview",
        "integration",
        not boss_errors,
        "8 个 Boss 的 ID / resolutionId / condition / terminalEvent / materialRemainder 与世界观权威表一致"
        if not boss_errors else "; ".join(boss_errors),
    )

    # Narrative weather never owns gameplay. WEATHER_ECHO patterns are independent encounters.
    weather_doc = narrative["weather"]
    invariant_text = " ".join(weather_doc.get("invariants", [])).casefold()
    weather_patterns = [row for row in gameplay["patterns"] if row.get("category") == "WEATHER_ECHO"]
    weather_errors: list[str] = []
    if weather_doc.get("authority") != "world-presentation":
        weather_errors.append("narrative.authority")
    for token in ("bullets", "hitboxes", "safe lanes", "player collision"):
        if token not in invariant_text:
            weather_errors.append(f"narrative.invariant:{token}")
    for pattern in weather_patterns:
        separation = pattern.get("weatherEchoContract", {})
        if not all(
            separation.get(field) is False
            for field in (
                "weatherEventCanTrigger",
                "weatherEventCanSpawnProjectile",
                "weatherEventCanAlterMotion",
                "weatherEventCanAlterCollision",
                "weatherEventCanAlterSafeGap",
                "weatherRngUsed",
            )
        ) or separation.get("schedulingAuthority") != "director.encounter.v4":
            weather_errors.append(f"pattern:{pattern.get('id')}")
    director = gameplay.get("encounterDirector", {})
    director_contract = director.get("weatherDecoupling", {})
    director_pool = director.get("parallelEncounterPools", {}).get("weatherEcho", {})
    if set(director_pool.get("patternIds", [])) != {row.get("id") for row in weather_patterns}:
        weather_errors.append("director.weatherEcho.patternIds")
    if director_pool.get("requiresWeatherState") is not False:
        weather_errors.append("director.weatherEcho.requiresWeatherState")
    if not all(
        director_contract.get(field) is False
        for field in (
            "weatherEventCanTriggerPattern",
            "weatherEventCanSpawnProjectile",
            "weatherEventCanAlterProjectileMotion",
            "weatherEventCanAlterCollision",
            "weatherEventCanAlterSafeGap",
            "weatherRngEntersPatternSeed",
        )
    ):
        weather_errors.append("director.weatherDecoupling")
    audit.check(
        "integration.weather-gameplay-decoupling",
        "integration",
        len(weather_patterns) == 3 and not weather_errors,
        "5 类叙事天气仅属 world-presentation；3 个 WEATHER_ECHO 弹幕由 encounter director 独立调度，不读写天气 phase/seed"
        if len(weather_patterns) == 3 and not weather_errors else "; ".join(weather_errors) or f"weatherPatterns={len(weather_patterns)}",
    )

    # Asset binding report is the explicit bridge from runtime/narrative cues to art/audio.
    binding_report_path = audit.locate_manifest("manifests/integration/asset-bindings-validation-v4.json")
    binding_ok = False
    binding_detail = "missing asset-bindings-validation-v4.json"
    if binding_report_path.is_file():
        binding_report = audit.load(binding_report_path)
        binding_ok = (
            binding_report.get("status") == "PASS"
            and binding_report.get("errors") == []
            and binding_report.get("narrativeCues") == 37
            and binding_report.get("runtimeBindings") == 34
            and binding_report.get("audioUniverse") == 48
            and binding_report.get("frameUniverse", 0) >= len(art.get("semanticIds", set()))
        )
        binding_detail = json.dumps(binding_report, ensure_ascii=False)
    audit.check(
        "integration.asset-bindings",
        "integration",
        binding_ok,
        "37 narrative cues / 34 runtime bindings 已绑定到 48 audio 与完整 frame universe"
        if binding_ok else binding_detail,
    )


def audit_existing_reports(audit: Audit) -> None:
    report_specs = [
        ("runtime", "runtime/runtime-validation-report-v4.json", lambda row: row.get("result") == "PASS" and row.get("errors") == 0 and row.get("warnings") == 0),
        ("gameplay", "gameplay/reports/validation-report-v4.json", lambda row: row.get("status") == "PASS" and row.get("summary", {}).get("errors") == 0 and row.get("summary", {}).get("warnings") == 0),
        ("narrative", "narrative/validation-report-v4.json", lambda row: row.get("summary", {}).get("failed") == 0),
        ("art", "reports/art-atlas-validation.json", lambda row: row.get("status") == "PASS" and row.get("errors") == []),
        ("ui", "ui/reports/ui-validation-v4.json", lambda row: row.get("status") == "PASS" and row.get("errors") == []),
        ("backgrounds", "backgrounds/reports/reaction-overlays-validation.json", lambda row: row.get("status") == "PASS" and row.get("errors") == []),
        ("audio", "audio/validation-report-v4.json", lambda row: row.get("summary", {}).get("failed") == 0),
        ("bindings", "manifests/integration/asset-bindings-validation-v4.json", lambda row: row.get("status") == "PASS" and row.get("errors") == []),
    ]
    failures: list[str] = []
    found = 0
    for name, preferred, predicate in report_specs:
        path = audit.locate_manifest(preferred)
        if not path.is_file():
            failures.append(f"missing:{name}")
            continue
        found += 1
        try:
            if not predicate(audit.load(path)):
                failures.append(f"not-pass:{name}")
        except Exception as exc:
            failures.append(f"invalid:{name}:{exc}")
    audit.check(
        "subsystem.reports-strict-pass",
        "package",
        not failures and found == len(report_specs),
        f"{found} 份子系统报告全部 PASS，且各自 0 errors / 0 warnings" if not failures else "; ".join(failures),
        {"reports": found, "expected": len(report_specs)},
    )


def audit_optional_composite_package(audit: Audit) -> None:
    """Enforce the 7-atlas/448-frame package contract when a final manifest exists.

    The working tree deliberately has no top-level ``manifests/v4/package-manifest``;
    the packaged kit does.  Absence is therefore neutral in work/v4, while presence
    turns every composite assertion below into a hard delivery gate.
    """
    package_path = audit.root / "manifests" / "v4" / "package-manifest-v4.json"
    if not package_path.is_file():
        audit.metrics["compositePackage"] = {"present": False, "enforced": False}
        return

    package = audit.load(package_path)
    entrypoints = package.get("entrypoints", {})
    missing_entrypoints = [
        f"{name}:{reference}"
        for name, reference in entrypoints.items()
        if not audit.locate_file(reference).is_file()
    ]
    audit.check(
        "package.v4-entrypoints",
        "package",
        len(entrypoints) >= 10 and not missing_entrypoints,
        f"V4 package manifest 的 {len(entrypoints)} 个入口全部存在"
        if not missing_entrypoints else "; ".join(missing_entrypoints),
    )

    atlas_path = audit.locate_file(entrypoints.get("atlases", "manifests/v4/atlas-index-v4.json"))
    frame_path = audit.locate_file(entrypoints.get("frames", "manifests/v4/frame-index-v4.json"))
    alias_path = audit.locate_file(entrypoints.get("semanticAliases", "manifests/v4/semantic-aliases-v4.json"))
    atlas_doc = audit.load(atlas_path) if atlas_path.is_file() else {}
    frame_doc = audit.load(frame_path) if frame_path.is_file() else {}
    alias_doc = audit.load(alias_path) if alias_path.is_file() else {}
    atlases = atlas_doc.get("atlases", [])
    frames = frame_doc.get("frames", [])
    atlas_ids = [row.get("id") or row.get("atlasId") for row in atlases]
    frame_atlas_ids = [row.get("atlas") for row in frames]
    semantic_ids = [row.get("semanticId") or row.get("id") for row in frames]
    counts = package.get("counts", {})
    count_errors: list[str] = []
    expected_counts = {
        "atlases": 7,
        "physicalFrames": 448,
        "motionOperators": 12,
        "executablePatterns": 48,
        "enemyArchetypes": 16,
        "bosses": 8,
        "bossPhases": 24,
        "laserTopologies": 8,
        "patternAnimations": 48,
        "bossSequenceAnimations": 8,
        "reactionOverlays": 16,
        "weatherTypes": 5,
        "snapshotObservations": 64,
        "audioAssets": 48,
        "runtimeEvents": 72,
        "runtimeStateSystems": 12,
        "runtimeFeedbackBindings": 34,
        "narrativeFeedbackCues": 37,
        "accessibilityCombinations": 216,
        "v4UiScreens": 9,
    }
    for key, expected in expected_counts.items():
        if counts.get(key) != expected:
            count_errors.append(f"{key}:{counts.get(key)}!={expected}")
    if atlas_doc.get("atlasCount") != 7 or atlas_doc.get("frameCount") != 448:
        count_errors.append("atlas-index-counts")
    if frame_doc.get("frameCount") != 448:
        count_errors.append("frame-index-count")
    audit.metrics["compositePackage"] = {
        "present": True,
        "enforced": True,
        "entrypoints": len(entrypoints),
        "atlases": len(atlases),
        "frames": len(frames),
        "semanticAliases": len(alias_doc.get("readAliases", {})),
    }
    audit.check(
        "package.v4-composite-counts",
        "package",
        len(atlases) == 7 and len(frames) == 448 and not count_errors,
        "组合包为 7 atlases / 448 physical frames，且所有 V4 汇总数量与权威 manifests 一致"
        if not count_errors else "; ".join(count_errors),
        audit.metrics["compositePackage"],
    )

    atlas_errors: list[str] = []
    for row in atlases:
        atlas_id = row.get("id") or row.get("atlasId") or "unknown"
        reference = row.get("file") or row.get("image")
        target = audit.locate_file(reference or "")
        if not target.is_file():
            atlas_errors.append(f"missing:{atlas_id}")
            continue
        if sha256(target) != row.get("sha256"):
            atlas_errors.append(f"sha256:{atlas_id}")
        if Image is not None:
            try:
                image = Image.open(target)
                if list(image.size) != row.get("size"):
                    atlas_errors.append(f"size:{atlas_id}")
            except Exception as exc:
                atlas_errors.append(f"open:{atlas_id}:{exc}")
    audit.check(
        "package.v4-atlas-files",
        "package",
        len(atlas_ids) == 7 and not duplicate_values([str(value) for value in atlas_ids]) and not atlas_errors,
        "7 个 atlas 的 ID、文件、尺寸与 SHA-256 全部一致" if not atlas_errors else "; ".join(atlas_errors),
    )

    frame_errors: list[str] = []
    atlas_id_set = set(atlas_ids)
    if duplicate_values([str(value) for value in semantic_ids]):
        frame_errors.append("duplicate-semanticId")
    if set(frame_atlas_ids) - atlas_id_set:
        frame_errors.append(f"unknown-atlas:{sorted(set(frame_atlas_ids) - atlas_id_set)}")
    per_atlas = Counter(frame_atlas_ids)
    if any(per_atlas.get(atlas_id) != 64 for atlas_id in atlas_ids):
        frame_errors.append(f"per-atlas:{dict(per_atlas)}")
    if set(frame_doc.get("atlases", []) if frame_doc.get("atlases") and isinstance(frame_doc.get("atlases", [None])[0], str) else atlas_ids) != atlas_id_set:
        frame_errors.append("frame-atlas-index-set")
    audit.check(
        "package.v4-frame-atlas-closure",
        "package",
        len(semantic_ids) == 448 and not frame_errors,
        "448 个 physical frame 的 semanticId 唯一；每个 atlas 恰有 64 格且 atlas ID 全部闭合"
        if not frame_errors else "; ".join(frame_errors),
    )

    alias_errors: list[str] = []
    semantic_set = set(semantic_ids)
    read_aliases = alias_doc.get("readAliases", {})
    deprecated = alias_doc.get("deprecatedPhysicalFrames", {})
    for old, canonical in {**read_aliases, **deprecated}.items():
        if old == canonical:
            alias_errors.append(f"self:{old}")
        if canonical not in semantic_set:
            alias_errors.append(f"missing-target:{old}->{canonical}")
    if alias_doc.get("writePolicy") != "write canonical V4 semantic IDs only":
        alias_errors.append("writePolicy")
    audit.check(
        "package.v4-semantic-aliases",
        "package",
        len(read_aliases) >= 3 and not alias_errors,
        "旧 Score / Power / Life 语义仅作读别名；所有 alias target 都是 448-frame canonical semanticId"
        if not alias_errors else "; ".join(alias_errors),
    )


def audit_cleanliness(audit: Audit, report_dir: Path) -> None:
    junk_names = {".DS_Store"}
    junk_suffixes = {".pyc", ".pyo"}
    junk: list[str] = []
    for path in audit.root.rglob("*"):
        if path.name in junk_names or path.suffix in junk_suffixes or path.name == "__pycache__":
            junk.append(audit.relative(path))
    audit.check(
        "package.no-junk-artifacts",
        "package",
        not junk,
        "无 .DS_Store / __pycache__ / .pyc / .pyo" if not junk else "; ".join(junk[:16]),
    )


def write_reports(audit: Audit, report_dir: Path) -> dict[str, Any]:
    passed = sum(check["status"] == "PASS" for check in audit.checks)
    result = "PASS" if not audit.errors and not audit.warnings else "FAIL"
    report = {
        "schemaVersion": "4.0.0-integration-qa",
        "validator": "tools/qa/validate_v4_integration.py",
        "result": result,
        "strictWarnings": True,
        "summary": {
            "checks": len(audit.checks),
            "passed": passed,
            "errors": len(audit.errors),
            "warnings": len(audit.warnings),
        },
        "metrics": audit.metrics,
        "checks": audit.checks,
        "errors": audit.errors,
        "warnings": audit.warnings,
    }
    report_dir.mkdir(parents=True, exist_ok=True)
    (report_dir / REPORT_JSON_NAME).write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    gameplay = audit.metrics.get("gameplay", {})
    runtime = audit.metrics.get("runtime", {})
    narrative = audit.metrics.get("narrative", {})
    animations = audit.metrics.get("animations", {})
    composite = audit.metrics.get("compositePackage", {})
    lines = [
        "# V4 跨子系统严格集成 QA 报告",
        "",
        f"结果：**{result}** — {len(audit.checks)} 项检查，{passed} PASS，{len(audit.errors)} errors，{len(audit.warnings)} warnings。",
        "",
        "## 核心覆盖",
        "",
        "| 系统 | 已验证数量 |",
        "|---|---:|",
        f"| 运动算子 / 可执行弹幕 | {gameplay.get('motionOperators', 0)} / {gameplay.get('patterns', 0)} |",
        f"| 普通敌人 / 机械角色 | {gameplay.get('enemies', 0)} / {gameplay.get('enemyRoles', 0)} |",
        f"| Boss / 阶段 / 激光拓扑 | {gameplay.get('bosses', 0)} / {gameplay.get('bossPhases', 0)} / {gameplay.get('laserTopologies', 0)} |",
        f"| Runtime events / machines / bindings | {runtime.get('events', 0)} / {runtime.get('machines', 0)} / {runtime.get('feedbackBindings', 0)} |",
        f"| 无障碍组合 | {runtime.get('accessibilityCombinations', 0)} |",
        f"| 叙事状态 / 反应节点 / 观察句 | {narrative.get('states', 0)} / {narrative.get('worldReactionNodes', 0)} / {narrative.get('snapshotObservations', 0)} |",
        f"| Pattern 动画 / Boss 动画 | {animations.get('patternAnimations', 0)} / {animations.get('bossAnimations', 0)} |",
        f"| 音频 / atlas frames / 背景反应层 / UI screens | {audit.metrics.get('audio', {}).get('assets', 0)} / {audit.metrics.get('art', {}).get('frames', 0)} / {audit.metrics.get('backgrounds', {}).get('reactionOverlays', 0)} / {audit.metrics.get('ui', {}).get('screens', 0)} |",
        *(
            [f"| 最终组合包 atlas / physical frames | {composite.get('atlases', 0)} / {composite.get('frames', 0)} |"]
            if composite.get("present")
            else []
        ),
        "",
        "## 跨系统结论",
        "",
        "- 房间枚举、Boss 世界观解决条件、真实 Ghost routeDuration 时钟与四类跨局材料均以单一权威事实接线。",
        "- 叙事天气不拥有弹体、碰撞体或安全通道；同名弹幕只作为独立 encounter echo。",
        "- 48 个 pattern 和 8 个 Boss 均拥有独立 GIF、APNG、timeline，且媒体帧数与 timeline identity 可复验。",
        "- UI 实际 copy 不含 Score、Rank、Perfect 或道德化结局禁词；关键反馈由 visual / audio / haptic / UI 绑定桥接。",
        "",
        "## 检查项",
        "",
        "| 状态 | 子系统 | 检查 | 说明 |",
        "|---|---|---|---|",
    ]
    for check in audit.checks:
        detail = str(check["detail"]).replace("|", "\\|").replace("\n", " ")
        lines.append(f"| {check['status']} | {check['subsystem']} | `{check['id']}` | {detail} |")
    if audit.errors:
        lines.extend(["", "## 必须修复", ""])
        lines.extend(f"- `{row['check']}`：{row['detail']}" for row in audit.errors)
    lines.extend(
        [
            "",
            "## 严格性",
            "",
            "本报告把 warning 视为失败条件；最终可交付门槛为 **0 errors / 0 warnings**。",
            "",
        ]
    )
    (report_dir / REPORT_ZH_NAME).write_text("\n".join(lines), encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Strict V4 cross-subsystem integration QA")
    parser.add_argument("--root", help="explicit V4 package root")
    parser.add_argument("--report-dir", help="report output directory (default: validator directory)")
    args = parser.parse_args()

    root = discover_root(args.root)
    report_dir = Path(args.report_dir).expanduser().resolve() if args.report_dir else SCRIPT.parent
    audit = Audit(root)

    audit_all_json(audit, report_dir)
    gameplay = audit_gameplay(audit)
    runtime = audit_runtime(audit)
    narrative = audit_narrative(audit)
    audio = audit_audio(audit, narrative)
    art = audit_art(audit)
    audit_ui_and_backgrounds(audit, art)
    audit_animations(audit, gameplay)
    audit_cross_subsystem(audit, gameplay, runtime, narrative, audio, art)
    audit_optional_composite_package(audit)
    audit_existing_reports(audit)
    audit_cleanliness(audit, report_dir)
    report = write_reports(audit, report_dir)

    summary = report["summary"]
    print(
        json.dumps(
            {
                "result": report["result"],
                "checks": summary["checks"],
                "passed": summary["passed"],
                "errors": summary["errors"],
                "warnings": summary["warnings"],
                "report": str(report_dir / REPORT_JSON_NAME),
            },
            ensure_ascii=False,
        )
    )
    return 0 if report["result"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
