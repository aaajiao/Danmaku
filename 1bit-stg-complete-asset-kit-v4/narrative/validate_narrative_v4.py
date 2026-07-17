#!/usr/bin/env python3
"""Read-only structural and audio validation for V4 narrative deliverables."""

from __future__ import annotations

import hashlib
import json
import math
import re
import sys
import wave
from pathlib import Path

V4 = Path(__file__).resolve().parent.parent
NARRATIVE = V4 / "narrative"
MANIFESTS = V4 / "manifests" / "narrative"
AUDIO = V4 / "audio"
REPORT_JSON = NARRATIVE / "validation-report-v4.json"
REPORT_MD = NARRATIVE / "VALIDATION_REPORT_V4_ZH.md"
AUDIO_REPORT_JSON = AUDIO / "validation-report-v4.json"
AUDIO_REPORT_MD = AUDIO / "VALIDATION_REPORT_V4_ZH.md"


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    checks = []

    def check(name: str, ok: bool, detail: str) -> None:
        checks.append({"name": name, "status": "PASS" if ok else "FAIL", "detail": detail})

    json_paths = sorted(NARRATIVE.glob("*.json")) + sorted(MANIFESTS.glob("*.json"))
    parsed = {}
    for path in json_paths:
        try:
            parsed[path.name] = load(path)
            check(f"json:{path.name}", True, "valid JSON")
        except Exception as exc:  # pragma: no cover - diagnostic
            check(f"json:{path.name}", False, str(exc))

    state = parsed["narrative-state-machine-v4.json"]
    required_states = {
        "BOOT_REHYDRATE", "GHOST_REPLAY", "WITNESS_ORIENTATION", "AWAKENING",
        "FIRST_EYE", "FIRST_CLAMP_RECOVERY", "ROOM_SAMPLING", "WORLD_RESPONSE",
        "LOCAL_RESISTANCE_AVAILABLE", "LOCAL_RESISTANCE_DECAY", "DUSK_APPROACH",
        "NO_DUSK", "RUN_END_COMMIT", "STATE_SNAPSHOT", "CROSS_RUN_MATERIALIZATION",
        "RUN_CYCLE_COMPLETE",
    }
    actual_states = set(state["states"])
    check("narrative-state-coverage", required_states <= actual_states, f"{len(actual_states)} states")
    ordering = ["overrideScar.rehydrate", "ghost.replay.begin", "witness.turn", "returnInput"]
    source_text = json.dumps(state, ensure_ascii=False)
    check("cross-run-order-events", all(item in source_text for item in ordering), "scar -> ghost -> witness -> input")
    forbidden_end = set(state["runEndEligibility"]["forbiddenReasons"])
    check("non-judgemental-end-reasons", {"VICTORY", "DEFEAT", "GOOD_END", "BAD_END"} <= forbidden_end, f"forbidden={sorted(forbidden_end)}")

    graph = parsed["world-reaction-graph-v4.json"]
    required_nodes = {"Eye", "Flower", "Witness", "Ghost", "Cable", "SnapshotEcho", "Seam", "RoomSky", "ShadowCorrection", "DataWaterfall", "ViewmodelEcho", "BurnIn", "NoDusk"}
    graph_nodes = set(graph["reactionNodes"])
    check("world-reaction-node-coverage", graph_nodes == required_nodes, f"{len(graph_nodes)} required nodes")
    source_nodes = set(graph["sourceNodes"])
    edges_valid = all(edge["from"] in source_nodes and edge["to"] in graph_nodes for edge in graph["edges"])
    check("world-reaction-edge-references", edges_valid, f"{len(graph['edges'])} one-way edges")
    remainder_keys = set(graph["materialRemainderClasses"])
    check("four-distinct-memory-classes", {"overrideScar", "deathTrace", "burnIn", "ghostResidue"} <= remainder_keys, ", ".join(sorted(remainder_keys)))

    weather = parsed["weather-system-v4.json"]["weather"]
    expected_weather = {"STATIC", "RAIN", "ASH", "WIND", "ECLIPSE"}
    check("five-weather-types", set(weather) == expected_weather, f"{len(weather)} types")
    phases_complete = all(all(phase in item for phase in ("omen", "burst", "aftermath")) for item in weather.values())
    check("weather-three-phase-contract", phases_complete, "omen / burst / aftermath on all types")
    residues = [item["aftermath"]["materialResidue"] for item in weather.values()]
    check("weather-distinct-residue", len(set(residues)) == len(residues), ", ".join(residues))

    room_thresholds = parsed["room-thresholds-v4.json"]["rooms"]
    check("four-room-thresholds", set(room_thresholds) == {"INFORMATION", "FORCED_ALIGNMENT", "IN_BETWEEN", "POLARIZED"}, f"{len(room_thresholds)} rooms")
    threshold_ids = [t["id"] for room in room_thresholds.values() for t in room["thresholds"]]
    check("room-threshold-id-unique", len(threshold_ids) == len(set(threshold_ids)), f"{len(threshold_ids)} unique thresholds")

    bosses = parsed["boss-resolutions-v4.json"]["bosses"]
    resolution_ids = [boss["resolutionId"] for boss in bosses]
    check("eight-boss-resolutions", len(bosses) == 8, f"{len(bosses)} bosses")
    check("boss-resolution-diversity", len(set(resolution_ids)) == 8, f"{len(set(resolution_ids))} distinct resolutions")
    hp_only = any(boss["condition"].strip().lower() in {"hp == 0", "hp <= 0"} for boss in bosses)
    check("boss-resolution-not-hp-only", not hp_only, "all primary resolutions are behavioral/protocol conditions")

    observations_doc = parsed["snapshot-observations-v4.json"]
    observations = observations_doc["observations"]
    ids = [item["id"] for item in observations]
    check("snapshot-observation-count", len(observations) >= 48, f"{len(observations)} bilingual observations")
    check("snapshot-observation-ids", len(ids) == len(set(ids)), f"{len(set(ids))} unique ids")
    traceable = all(item.get("trace") and item.get("condition") and item.get("zh-CN") and item.get("en") for item in observations)
    check("snapshot-observation-traceability", traceable, "condition + metric paths + bilingual copy")
    schema_metric_props = set(parsed["run-memory-v4.schema.json"]["properties"]["metrics"]["properties"])
    observed_metric_names = set()
    for item in observations:
        for path in item["trace"]:
            if path.startswith("metrics."):
                observed_metric_names.add(path.split(".")[1])
        observed_metric_names.update(re.findall(r"metrics\.([A-Za-z0-9_]+)", item["condition"]))
    unknown_metrics = sorted(observed_metric_names - schema_metric_props)
    check("snapshot-traces-resolve-run-schema", not unknown_metrics, f"unknown metrics={unknown_metrics}")
    forbidden = [term.lower() for term in observations_doc["forbiddenEvaluationTerms"]]
    copy_text = "\n".join(item["zh-CN"] + "\n" + item["en"] for item in observations).lower()
    found_forbidden = sorted(term for term in forbidden if term in copy_text)
    check("snapshot-copy-non-evaluative", not found_forbidden, f"forbidden terms found={found_forbidden}")

    schema = parsed["run-memory-v4.schema.json"]
    memory_props = schema["properties"]["materialMemory"]["properties"]
    check("run-memory-separated-remainders", set(memory_props) == {"overrideScars", "deathTraces", "burnIns", "ghostResidues"}, ", ".join(memory_props))
    sample = parsed["sample-run-memory-v4.json"]
    required_metrics = set(schema["properties"]["metrics"]["required"])
    sample_metrics = set(sample["metrics"])
    check("sample-run-has-all-authoritative-metrics", required_metrics <= sample_metrics, f"missing={sorted(required_metrics - sample_metrics)}")
    light_sum = sum(sample["metrics"][key] for key in ("quietLightRatio", "middleLightRatio", "loudLightRatio"))
    check("sample-light-bands-sum-one", abs(light_sum - 1.0) < 1e-6, f"sum={light_sum:.6f}")
    room_time_sum = sum(sample["metrics"]["roomTimeMs"].values())
    check("sample-room-time-equals-duration", room_time_sum == sample["run"]["durationMs"], f"rooms={room_time_sum}, run={sample['run']['durationMs']}")
    evidence_ok = sample["metrics"]["grazeEvidenceSpent"] <= sample["metrics"]["grazeEvidenceCount"] == sample["metrics"]["uniqueBulletsGrazed"]
    check("sample-evidence-once-per-projectile", evidence_ok, "spent <= accepted == unique bullets")
    memory_ids = [item["id"] for group in sample["materialMemory"].values() for item in group]
    check("sample-material-ids-global-unique", len(memory_ids) == len(set(memory_ids)), f"{len(memory_ids)} material records")
    expected_rehydrate = schema["properties"]["rehydrationOrder"]["const"]
    check("sample-run-rehydration-order", sample["rehydrationOrder"] == expected_rehydrate, "four remainders -> witness -> input")
    ghost_contract = parsed["ghost-replay-contract-v4.json"]
    check("ghost-actual-route-only", ghost_contract["capture"]["source"].startswith("actual player transform"), ghost_contract["capture"]["source"])
    check("ghost-single-replay", ghost_contract["replay"]["count"] == 1, "replay count = 1")
    check("ghost-no-gameplay-authority", ghost_contract["replay"]["collisionClass"] == ghost_contract["replay"]["rewardClass"] == "NONE", "collision/reward = NONE")

    witnesses = parsed["witness-conditions-v4.json"]["states"]
    witness_ids = {item["id"] for item in witnesses}
    expected_witness = {"ISOLATED", "RESONANT", "HEAD_DOWN", "FACING_EYE", "FACING_SCAR", "FACING_GHOST_END", "RESISTANCE_TRANSMISSION"}
    check("witness-condition-coverage", witness_ids == expected_witness, f"{len(witness_ids)} witness states")

    ui_copy = parsed["ui-copy-v4.json"]
    visible_copy = "\n".join(value[locale] for value in ui_copy["copy"].values() for locale in ("zh-CN", "en")).lower()
    ui_forbidden = [token.lower() for token in ui_copy["forbiddenTokensCaseInsensitive"]]
    ui_found = [token for token in ui_forbidden if token in visible_copy]
    check("ui-no-score-semantics", not ui_found, f"visible forbidden tokens={ui_found}")
    migration = ui_copy["migration"]
    check("score-migrated-to-evidence", migration.get("pickup.score") == "pickup.evidence" and migration.get("hud.score") == "hud.evidence", "score pickups/HUD removed")

    feedback = parsed["feedback-cues-v4.json"]
    cue_ids = [cue["id"] for cue in feedback["cues"]]
    check("feedback-cue-ids", len(cue_ids) == len(set(cue_ids)), f"{len(cue_ids)} unique cues")
    complete_modalities = all(all(key in cue for key in ("visual", "ui", "audio", "haptic")) for cue in feedback["cues"])
    check("feedback-four-modalities", complete_modalities, "visual / UI / audio / haptic declared")

    audio_manifest = parsed.get("audio-manifest-v4.json")
    if audio_manifest is None:
        check("audio-manifest", False, "run audio/generate_audio_v4.py first")
    else:
        assets = audio_manifest["assets"]
        audio_ids = {asset["id"] for asset in assets}
        check("audio-room-bed-count", len([a for a in assets if a["category"] == "room-bed"]) == 4, "4 room beds")
        check("audio-boss-signal-count", len([a for a in assets if a["category"] == "boss-signal"]) == 8, "8 boss signals")
        check("audio-sfx-count", len([a for a in assets if a["category"] == "sfx"]) >= 30, f"{len([a for a in assets if a['category'] == 'sfx'])} SFX")
        missing_refs = []
        for cue in feedback["cues"]:
            ref = cue["audio"]
            if ref == "none":
                continue
            if "{bossId}" in ref:
                if not all(f"boss.{boss['id']}.signal" in audio_ids for boss in bosses):
                    missing_refs.append(ref)
            elif ref not in audio_ids:
                missing_refs.append(ref)
        check("feedback-audio-references", not missing_refs, f"missing={sorted(set(missing_refs))}")

        audio_errors = []
        loop_errors = []
        for asset in assets:
            path = V4 / asset["path"]
            if not path.is_file():
                audio_errors.append(f"missing:{asset['id']}")
                continue
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            if digest != asset["sha256"]:
                audio_errors.append(f"hash:{asset['id']}")
            with wave.open(str(path), "rb") as wav:
                if wav.getframerate() != 48000 or wav.getsampwidth() != 2 or wav.getnchannels() != 2:
                    audio_errors.append(f"format:{asset['id']}")
                if wav.getnframes() == 0:
                    audio_errors.append(f"empty:{asset['id']}")
                if asset.get("loop"):
                    first = wav.readframes(1)
                    wav.setpos(wav.getnframes() - 1)
                    last = wav.readframes(1)
                    first_vals = struct_unpack_stereo(first)
                    last_vals = struct_unpack_stereo(last)
                    if max(abs(a - b) for a, b in zip(first_vals, last_vals)) > 2500:
                        loop_errors.append(asset["id"])
            if asset["rms"] <= 0.0005 or asset["peak"] >= 0.99:
                audio_errors.append(f"level:{asset['id']}")
        check("audio-files-and-hashes", not audio_errors, f"errors={audio_errors}")
        check("audio-loop-boundaries", not loop_errors, f"discontinuity={loop_errors}")

    passed = sum(item["status"] == "PASS" for item in checks)
    failed = len(checks) - passed
    report = {
        "schemaVersion": "4.0.0-narrative-validation",
        "summary": {"checks": len(checks), "passed": passed, "failed": failed},
        "checks": checks,
    }
    REPORT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# V4 世界观、叙事、UI 与音频验证报告",
        "",
        f"结果：**{passed}/{len(checks)} PASS，{failed} FAIL**。",
        "",
        "| 检查 | 结果 | 说明 |",
        "|---|---:|---|",
    ]
    for item in checks:
        lines.append(f"| `{item['name']}` | {item['status']} | {item['detail']} |")
    REPORT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")
    audio_checks = [item for item in checks if item["name"].startswith("audio-") or item["name"] == "feedback-audio-references"]
    audio_passed = sum(item["status"] == "PASS" for item in audio_checks)
    audio_report = {
        "schemaVersion": "4.0.0-audio-validation",
        "summary": {"checks": len(audio_checks), "passed": audio_passed, "failed": len(audio_checks) - audio_passed},
        "checks": audio_checks,
    }
    AUDIO_REPORT_JSON.write_text(json.dumps(audio_report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    audio_lines = [
        "# V4 程序化音频验证报告",
        "",
        f"结果：**{audio_passed}/{len(audio_checks)} PASS，{len(audio_checks) - audio_passed} FAIL**。",
        "",
        "| 检查 | 结果 | 说明 |",
        "|---|---:|---|",
    ]
    for item in audio_checks:
        audio_lines.append(f"| `{item['name']}` | {item['status']} | {item['detail']} |")
    AUDIO_REPORT_MD.write_text("\n".join(audio_lines) + "\n", encoding="utf-8")
    print(json.dumps(report["summary"], ensure_ascii=False))
    return 1 if failed else 0


def struct_unpack_stereo(frame: bytes) -> tuple[int, int]:
    import struct
    return struct.unpack("<hh", frame)


if __name__ == "__main__":
    sys.exit(main())
