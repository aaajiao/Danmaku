#!/usr/bin/env python3
"""Strict validation for the V4 executable choreography package."""

from __future__ import annotations

from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import sys
from typing import Any

from sim_core import compose_run, gap_center, load_patterns, reachable_path, simulation, structural_signature


V4_ROOT = Path(__file__).resolve().parents[2]
MANIFEST_DIR = V4_ROOT / "manifests" / "gameplay"
SCHEMA_DIR = V4_ROOT / "gameplay" / "schemas"
REPORT_DIR = V4_ROOT / "gameplay" / "reports"
NARRATIVE_BOSS_RESOLUTIONS = V4_ROOT / "narrative" / "boss-resolutions-v4.json"


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def schema_errors(value: Any, schema: dict[str, Any], path: str = "$") -> list[str]:
    """Validate the deliberately small JSON-Schema subset used by this package."""
    errors: list[str] = []
    type_map = {"object": dict, "array": list, "string": str, "integer": int, "number": (int, float), "boolean": bool}
    expected = schema.get("type")
    if expected and not isinstance(value, type_map[expected]):
        return [f"{path}: expected {expected}, got {type(value).__name__}"]
    if "const" in schema and value != schema["const"]:
        errors.append(f"{path}: expected const {schema['const']!r}")
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path}: not in enum")
    if isinstance(value, dict):
        for required in schema.get("required", []):
            if required not in value:
                errors.append(f"{path}: missing {required}")
        for key, child_schema in schema.get("properties", {}).items():
            if key in value:
                errors.extend(schema_errors(value[key], child_schema, f"{path}.{key}"))
    if isinstance(value, list):
        if len(value) < schema.get("minItems", 0):
            errors.append(f"{path}: {len(value)} < minItems {schema['minItems']}")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            errors.append(f"{path}: {len(value)} > maxItems {schema['maxItems']}")
        if "items" in schema:
            for i, child in enumerate(value):
                errors.extend(schema_errors(child, schema["items"], f"{path}[{i}]"))
    if isinstance(value, (int, float)) and not isinstance(value, bool) and "minimum" in schema and value < schema["minimum"]:
        errors.append(f"{path}: {value} < minimum {schema['minimum']}")
    return errors


def main() -> int:
    errors: list[str] = []
    warnings: list[str] = []
    checks: list[dict[str, Any]] = []

    manifest_files = {
        "operators": "motion-operators-v4.json",
        "patterns": "executable-patterns-v4.json",
        "enemies": "enemy-archetypes-v4.json",
        "bosses": "boss-rigs-v4.json",
        "lasers": "laser-geometries-v4.json",
        "composers": "room-composers-v4.json",
        "encounter": "encounter-director-v4.json",
        "run": "run-director-v4.json",
        "projectile": "projectile-lifecycle-v4.json",
    }
    manifests = {key: read_json(MANIFEST_DIR / filename) for key, filename in manifest_files.items()}
    index_manifest = read_json(MANIFEST_DIR / "gameplay-index-v4.json")
    checksum_failures = []
    for entry in index_manifest["files"]:
        path = MANIFEST_DIR / entry["path"]
        actual = hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
        if actual != entry["sha256"] or (path.exists() and path.stat().st_size != entry["bytes"]):
            checksum_failures.append(entry["path"])
    if checksum_failures:
        errors.extend(f"index checksum mismatch: {path}" for path in checksum_failures)
    checks.append({"id": "canonical-index-checksums", "pass": not checksum_failures, "files": len(index_manifest["files"]), "failures": checksum_failures})
    narrative_resolution_sha256 = hashlib.sha256(NARRATIVE_BOSS_RESOLUTIONS.read_bytes()).hexdigest()
    external_authorities = index_manifest.get("externalAuthorities", [])
    external_authority_ok = external_authorities == [{"path": "../../narrative/boss-resolutions-v4.json", "role": "canonical boss resolution facts", "sha256": narrative_resolution_sha256}]
    if not external_authority_ok:
        errors.append("gameplay index does not pin the narrative boss resolution authority")
    checks.append({"id": "external-authority-checksum", "pass": external_authority_ok, "path": "narrative/boss-resolutions-v4.json", "sha256": narrative_resolution_sha256})

    # Schema validation.
    schema_map = {
        "operators": "motion-operators-v4.schema.json",
        "patterns": "patterns-v4.schema.json",
        "enemies": "enemies-v4.schema.json",
        "bosses": "boss-rigs-v4.schema.json",
        "lasers": "lasers-v4.schema.json",
        "composers": "composers-v4.schema.json",
        "encounter": "director-v4.schema.json",
        "run": "director-v4.schema.json",
        "projectile": "projectile-lifecycle-v4.schema.json",
    }
    schema_issue_count = 0
    for key, schema_name in schema_map.items():
        issues = schema_errors(manifests[key], read_json(SCHEMA_DIR / schema_name))
        schema_issue_count += len(issues)
        errors.extend(f"schema {key}: {issue}" for issue in issues)
    checks.append({"id": "schemas", "pass": schema_issue_count == 0, "issues": schema_issue_count})

    operators = manifests["operators"]["operators"]
    operator_ids = [entry["id"] for entry in operators]
    if len(operators) != 12 or len(set(operator_ids)) != 12:
        errors.append("motion operators must be exactly 12 unique IDs")

    patterns = manifests["patterns"]["patterns"]
    pattern_ids = [entry["id"] for entry in patterns]
    category_counts = Counter(entry["category"] for entry in patterns)
    if len(patterns) != 48 or len(set(pattern_ids)) != 48:
        errors.append("patterns must be exactly 48 unique IDs")
    expected_categories = {"ROOM": 16, "COMMON": 2, "TRANSITION": 3, "WEATHER_ECHO": 3, "BOSS": 24}
    if dict(category_counts) != expected_categories:
        errors.append(f"pattern category counts {dict(category_counts)} != {expected_categories}")
    room_counts = Counter(entry["room"] for entry in patterns if entry["category"] == "ROOM")
    if set(room_counts.values()) != {4} or len(room_counts) != 4:
        errors.append(f"room pattern counts must be 4 each, got {dict(room_counts)}")

    weather_echoes = [pattern for pattern in patterns if pattern["category"] == "WEATHER_ECHO"]
    expected_weather_echo_ids = {
        "encounter.weather_echo.rain_packets",
        "encounter.weather_echo.ash_memory",
        "encounter.weather_echo.wind_bias",
    }
    weather_decoupling_errors: list[str] = []
    if {pattern["id"] for pattern in weather_echoes} != expected_weather_echo_ids:
        weather_decoupling_errors.append("weather-echo IDs/categories differ from the three independent encounter patterns")
    if any(pattern["category"] == "WEATHER" or pattern["id"].startswith("weather.") for pattern in patterns):
        weather_decoupling_errors.append("a gameplay pattern still presents weather itself as a projectile source")
    for pattern in weather_echoes:
        contract = pattern.get("weatherEchoContract", {})
        required_false = [
            "weatherEventCanTrigger",
            "weatherEventCanSpawnProjectile",
            "weatherEventCanAlterMotion",
            "weatherEventCanAlterCollision",
            "weatherEventCanAlterSafeGap",
            "weatherRngUsed",
        ]
        if any(contract.get(key) is not False for key in required_false):
            weather_decoupling_errors.append(f"{pattern['id']}: weather decoupling flags are not all false")
        if contract.get("schedulingAuthority") != "director.encounter.v4" or not contract.get("runsParallelToWeather"):
            weather_decoupling_errors.append(f"{pattern['id']}: not independently scheduled in parallel")
        if "weatherseed" in pattern["seed"].get("composition", "").lower() or "weatherrng" in pattern["seed"].get("composition", "").lower():
            weather_decoupling_errors.append(f"{pattern['id']}: weather RNG enters pattern seed")
        if set(pattern["seed"].get("disallowedInputs", [])) != {"weatherEvent", "weatherSeed", "weatherRng"}:
            weather_decoupling_errors.append(f"{pattern['id']}: missing forbidden weather seed inputs")
        if pattern["room"] == "WEATHER":
            weather_decoupling_errors.append(f"{pattern['id']}: weather remains a gameplay room authority")
    if weather_decoupling_errors:
        errors.extend(weather_decoupling_errors)
    checks.append({"id": "weather-gameplay-decoupling", "pass": not weather_decoupling_errors, "weatherEchoPatterns": len(weather_echoes), "errors": weather_decoupling_errors})

    used_operators: Counter[str] = Counter()
    for pattern in patterns:
        pid = pattern["id"]
        required = ["emitters", "safeGap", "warning", "cancel", "residue", "difficulty", "seed", "clock", "timeline"]
        for field in required:
            if field not in pattern:
                errors.append(f"{pid}: missing {field}")
        if pattern["clock"].get("authority") != "GAMEPLAY" or not pattern["clock"].get("visualClockSeparated"):
            errors.append(f"{pid}: gameplay/visual clocks are not separated")
        timeline = pattern["timeline"]
        times = [event["atMs"] for event in timeline]
        if times != sorted(times) or times[-1] != pattern["durationMs"]:
            errors.append(f"{pid}: invalid timeline ordering/completion")
        if len({(event["atMs"], event["event"]) for event in timeline}) != len(timeline):
            errors.append(f"{pid}: duplicate timeline event")
        if pattern["safeGap"]["minimumWidthPx"] < 20 or pattern["safeGap"]["focusMinimumWidthPx"] < 10:
            errors.append(f"{pid}: gap below physical minimum")
        if not pattern["warning"].get("coversSweptArea") or pattern["warning"].get("collisionEnabled"):
            errors.append(f"{pid}: invalid warning/collision contract")
        if not pattern["cancel"].get("collisionOffBeforeVisual"):
            errors.append(f"{pid}: cancel does not disable collision first")
        if pattern["residue"].get("gameplayCollision"):
            errors.append(f"{pid}: residue unexpectedly collides")
        for emitter in pattern["emitters"]:
            geom = emitter.get("geometry", {})
            cadence = emitter.get("cadence", {})
            if not all(field in geom for field in ["type", "variant", "count", "baseAngleDeg", "spreadDeg"]):
                errors.append(f"{pid}/{emitter.get('id')}: incomplete geometry")
            if geom.get("count", 0) < 1:
                errors.append(f"{pid}/{emitter.get('id')}: count < 1")
            if not all(field in cadence for field in ["startMs", "intervalMs", "bursts"]):
                errors.append(f"{pid}/{emitter.get('id')}: incomplete cadence")
            keys = emitter.get("speedCurve", {}).get("keys", [])
            if not keys or any("atMs" not in key or "pxPerSec" not in key for key in keys):
                errors.append(f"{pid}/{emitter.get('id')}: missing executable speed curve")
            if not emitter.get("motionStack"):
                errors.append(f"{pid}/{emitter.get('id')}: empty motion stack")
            for motion in emitter.get("motionStack", []):
                used_operators[motion["operator"]] += 1
                if motion["operator"] not in operator_ids:
                    errors.append(f"{pid}: unknown operator {motion['operator']}")
        # Actual corridor kinematics must be focus-followable.
        centers = [gap_center(pattern, t) for t in range(0, pattern["durationMs"] + 1, 100)]
        peak_speed = max((abs(b - a) / 0.1 for a, b in zip(centers, centers[1:])), default=0.0)
        if peak_speed > 92.0:
            errors.append(f"{pid}: safe-gap peak speed {peak_speed:.1f}px/s exceeds focus speed")

    missing_operators = set(operator_ids) - set(used_operators)
    if missing_operators:
        errors.append(f"unused motion operators: {sorted(missing_operators)}")
    checks.append({"id": "content-counts", "pass": not any("must be exactly" in e or "category counts" in e for e in errors), "counts": {"operators": len(operators), "patterns": len(patterns), "categories": dict(category_counts), "rooms": dict(room_counts)}})
    checks.append({"id": "operator-coverage", "pass": not missing_operators, "usage": dict(sorted(used_operators.items()))})

    # Structural normalization and duplicate rejection.
    signature_groups: dict[str, list[str]] = defaultdict(list)
    signature_rows = []
    for pattern in patterns:
        signature, normalized = structural_signature(pattern)
        signature_groups[signature].append(pattern["id"])
        signature_rows.append({"patternId": pattern["id"], "sha256": signature, "normalized": normalized})
    duplicate_groups = [ids for ids in signature_groups.values() if len(ids) > 1]
    if duplicate_groups:
        errors.append(f"normalized structural duplicate groups: {duplicate_groups}")
    checks.append({"id": "structural-deduplication", "pass": not duplicate_groups, "unique": len(signature_groups), "duplicates": duplicate_groups})
    write_json(REPORT_DIR / "pattern-structure-signatures-v4.json", {"schemaVersion": "4.0.0", "normalizationExcludes": ["id", "name", "room color", "intent", "seed", "geometry variant label"], "uniqueSignatureCount": len(signature_groups), "duplicateGroups": duplicate_groups, "patterns": signature_rows})

    # Determinism and reachability. Two independent runs must hash identically.
    deterministic_rows = []
    gap_rows = []
    deterministic_failures = []
    reachability_failures = []
    for index, pattern in enumerate(patterns):
        seed = pattern["seed"]["base"] ^ 0x1B17 ^ index
        trace_a = simulation(pattern, seed=seed, difficulty="NORMAL")
        trace_b = simulation(pattern, seed=seed, difficulty="NORMAL")
        deterministic = trace_a["traceSha256"] == trace_b["traceSha256"]
        if not deterministic:
            deterministic_failures.append(pattern["id"])
        deterministic_rows.append({"patternId": pattern["id"], "seed": seed, "traceSha256": trace_a["traceSha256"], "repeatSha256": trace_b["traceSha256"], "pass": deterministic, "emissionEvents": len(trace_a["events"]), "gapInterventions": trace_a["omittedOrRedirected"], "splitChildren": trace_a["splitChildren"]})
        normal = reachable_path(pattern, trace_a, focus=False)
        focus = reachable_path(pattern, trace_a, focus=True)
        passed = normal["pass"] and focus["pass"]
        if not passed:
            reachability_failures.append({"patternId": pattern["id"], "normal": normal, "focus": focus})
        gap_rows.append({"patternId": pattern["id"], "gapType": pattern["safeGap"]["type"], "widthPx": pattern["safeGap"]["minimumWidthPx"], "enforcement": pattern["safeGap"]["enforcement"], "normal": normal, "focus": focus, "pass": passed})
    if deterministic_failures:
        errors.append(f"determinism failures: {deterministic_failures}")
    if reachability_failures:
        errors.append(f"reachability failures: {[row['patternId'] for row in reachability_failures]}")
    checks.append({"id": "determinism", "pass": not deterministic_failures, "patterns": len(patterns), "failures": deterministic_failures})
    checks.append({"id": "safe-gap-solvability", "pass": not reachability_failures, "normal": len(patterns) - len(reachability_failures), "focus": len(patterns) - len(reachability_failures), "failures": reachability_failures})
    write_json(REPORT_DIR / "determinism-report-v4.json", {"schemaVersion": "4.0.0", "algorithm": "mulberry32-v1 + fixed 120Hz contract / 30Hz QA integration", "sameSeedSameTrace": not deterministic_failures, "patterns": deterministic_rows})
    write_json(REPORT_DIR / "safe-gap-report-v4.json", {"schemaVersion": "4.0.0", "logicalViewport": [360, 640], "playerBandY": 570, "solver": "1D dynamic reachability over actual simulated colliders; 4px grid; 100ms samples", "normalSpeedPxPerSec": 188, "focusSpeedPxPerSec": 92, "patterns": gap_rows})

    # Cross-reference enemies, bosses, lasers and directors.
    pattern_set = set(pattern_ids)
    pattern_by_id = {pattern["id"]: pattern for pattern in patterns}
    enemies = manifests["enemies"]["enemies"]
    enemy_roles = {enemy["role"] for enemy in enemies}
    if len(enemies) != 16 or len(enemy_roles) < 8:
        errors.append(f"enemy coverage invalid: {len(enemies)} enemies / {len(enemy_roles)} roles")
    for enemy in enemies:
        if enemy["cadence"]["patternId"] not in pattern_set:
            errors.append(f"{enemy['id']}: unknown pattern")

    lasers = manifests["lasers"]["lasers"]
    laser_ids = {laser["id"] for laser in lasers}
    geometry_types = {laser["geometry"]["type"] for laser in lasers}
    if len(lasers) != 8 or len(geometry_types) != 8:
        errors.append("laser geometries must be eight structurally distinct types")
    for laser in lasers:
        if not laser["bossId"].startswith("boss.") or laser.get("aliases") != [laser["bossId"].removeprefix("boss.")] or laser.get("narrativeAlias") != laser["bossId"].removeprefix("boss."):
            errors.append(f"{laser['id']}: boss reference is not canonical boss.<slug> plus narrative alias")
        if laser["lifecycle"]["collisionEnable"] != "live.enter" or laser["lifecycle"]["collisionDisable"] != "shutdown.enter":
            errors.append(f"{laser['id']}: invalid collision lifecycle")
        if laser["warning"]["geometry"] != "exact_swept_union":
            errors.append(f"{laser['id']}: warning is not swept union")

    narrative_payload = read_json(NARRATIVE_BOSS_RESOLUTIONS)
    narrative_by_alias = {row["id"]: row for row in narrative_payload["bosses"]}
    rigs = manifests["bosses"]["rigs"]
    terminal_events = []
    boss_canonical_errors: list[str] = []
    if manifests["bosses"].get("canonicalResolutionSource") != "../../narrative/boss-resolutions-v4.json":
        boss_canonical_errors.append("boss rig manifest does not name narrative resolution authority")
    if manifests["bosses"].get("canonicalResolutionSha256") != narrative_resolution_sha256:
        boss_canonical_errors.append("boss rig manifest does not pin the current narrative resolution checksum")
    if manifests["bosses"].get("sharedFallbackResolution") != narrative_payload["sharedFallbackResolution"]:
        boss_canonical_errors.append("shared fallback resolution drifted from narrative authority")
    if manifests["bosses"].get("ruptureContract") != narrative_payload["ruptureContract"]:
        boss_canonical_errors.append("rupture contract drifted from narrative authority")
    for rig in rigs:
        if len(rig["phases"]) != 3 or not (1 <= len(rig["emitters"]) <= 3):
            errors.append(f"{rig['id']}: requires 3 phases and 1-3 emitters")
        for phase in rig["phases"]:
            if phase["patternId"] not in pattern_set:
                errors.append(f"{rig['id']}: unknown pattern {phase['patternId']}")
            if phase.get("laserGeometry") and phase["laserGeometry"] not in laser_ids:
                errors.append(f"{rig['id']}: unknown laser {phase['laserGeometry']}")
        if not rig["id"].startswith("boss."):
            boss_canonical_errors.append(f"{rig['id']}: canonical gameplay ID must start boss.")
            continue
        alias = rig["id"].removeprefix("boss.")
        canonical = narrative_by_alias.get(alias)
        if not canonical:
            boss_canonical_errors.append(f"{rig['id']}: narrative alias missing")
            continue
        if rig.get("aliases") != [alias] or rig.get("narrativeAlias") != alias:
            boss_canonical_errors.append(f"{rig['id']}: narrative slug is not the sole declared alias")
        resolution = rig["resolution"]
        expected_resolution = {
            "source": "../../narrative/boss-resolutions-v4.json",
            "canonicalBossId": rig["id"],
            "narrativeAlias": alias,
            "resolutionId": canonical["resolutionId"],
            "metric": canonical["condition"],
            "condition": canonical["condition"],
            "fact": canonical["fact"],
            "terminal": canonical["terminalEvent"],
            "terminalEvent": canonical["terminalEvent"],
            "materialRemainder": canonical["materialRemainder"],
            "playerPossibilities": canonical["playerPossibilities"],
        }
        if resolution != expected_resolution:
            boss_canonical_errors.append(f"{rig['id']}: gameplay resolution differs from narrative canonical fact")
        final_phase = rig["phases"][2]
        if final_phase.get("exitCondition") != canonical["terminalEvent"] or final_phase.get("resolutionCondition") != canonical["condition"]:
            boss_canonical_errors.append(f"{rig['id']}: phase-3 exit/condition differs from narrative canonical")
        if rig["rupture"].get("event") != canonical["terminalEvent"] or rig["rupture"].get("material") != canonical["materialRemainder"]:
            boss_canonical_errors.append(f"{rig['id']}: rupture terminal/material differs from narrative canonical")
        hook = pattern_by_id[final_phase["patternId"]].get("resolutionHook", {})
        expected_hook = {
            "type": "canonical_boss_resolution",
            "canonicalBossId": rig["id"],
            "narrativeAlias": alias,
            "resolutionId": canonical["resolutionId"],
            "condition": canonical["condition"],
            "terminalEvent": canonical["terminalEvent"],
        }
        if hook != expected_hook:
            boss_canonical_errors.append(f"{rig['id']}: phase-3 pattern resolutionHook differs from narrative canonical")
        terminal_events.append(rig["resolution"]["terminal"])
        if rig["rupture"]["mode"] != "protocol_withdrawal_not_death":
            errors.append(f"{rig['id']}: terminal is framed as death")
    if len(rigs) != 8 or len(set(terminal_events)) != 8:
        errors.append("bosses require eight distinct non-unified terminal events")
    if set(narrative_by_alias) != {rig["narrativeAlias"] for rig in rigs}:
        boss_canonical_errors.append("gameplay/narrative boss alias sets differ")
    if {laser["bossId"] for laser in lasers} != {rig["id"] for rig in rigs}:
        boss_canonical_errors.append("laser boss references differ from canonical gameplay boss IDs")
    if boss_canonical_errors:
        errors.extend(boss_canonical_errors)
    checks.append({"id": "boss-resolution-canonical-parity", "pass": not boss_canonical_errors, "bosses": len(rigs), "canonicalSource": str(NARRATIVE_BOSS_RESOLUTIONS.relative_to(V4_ROOT)), "errors": boss_canonical_errors})

    composers = manifests["composers"]["composers"]
    if len(composers) != 4:
        errors.append("room composer count != 4")
    for composer in composers:
        pool = [entry["patternId"] for entry in composer["patternPool"]]
        if len(pool) != 4 or any(pattern not in pattern_set for pattern in pool):
            errors.append(f"{composer['id']}: invalid four-pattern pool")
    weather_director_errors: list[str] = []
    decoupling = manifests["encounter"].get("weatherDecoupling", {})
    director_false_flags = [
        "weatherEventCanTriggerPattern",
        "weatherEventCanSpawnProjectile",
        "weatherEventCanAlterProjectileMotion",
        "weatherEventCanAlterCollision",
        "weatherEventCanAlterSafeGap",
        "weatherRngEntersPatternSeed",
    ]
    if any(decoupling.get(key) is not False for key in director_false_flags):
        weather_director_errors.append("encounter director weather decoupling flags are not all false")
    echo_pool = manifests["encounter"].get("parallelEncounterPools", {}).get("weatherEcho", {})
    if set(echo_pool.get("patternIds", [])) != expected_weather_echo_ids or echo_pool.get("requiresWeatherState") is not False:
        weather_director_errors.append("weather-echo pool is not independently scheduled from weather state")
    if any("weather" in value.lower() for value in manifests["encounter"]["scheduling"].get("forbiddenSeedInputs", []) if value not in {"weatherEvent", "weatherSeed", "weatherRng"}):
        weather_director_errors.append("unexpected weather seed vocabulary")
    if set(manifests["encounter"]["scheduling"].get("forbiddenSeedInputs", [])) != {"weatherEvent", "weatherSeed", "weatherRng"}:
        weather_director_errors.append("encounter director does not explicitly forbid all weather seed inputs")
    if "weather" in echo_pool.get("selectionSeed", "").lower():
        weather_director_errors.append("weather-echo selection seed depends on weather")
    if weather_director_errors:
        errors.extend(weather_director_errors)
    checks.append({"id": "weather-echo-director-decoupling", "pass": not weather_director_errors, "poolPatterns": len(echo_pool.get("patternIds", [])), "errors": weather_director_errors})
    run_pattern_refs = [pattern for phase in manifests["run"]["phases"] for pattern in phase.get("patterns", [])]
    if any(pattern not in pattern_set for pattern in run_pattern_refs):
        errors.append(f"run director has unknown pattern refs: {run_pattern_refs}")
    director_rows = []
    director_failures = []
    sample_metrics = {
        "avgFlower": 0.62,
        "gazeRatio": 0.28,
        "overrideRatio": 0.08,
        "recentInputDensity": 0.74,
        "unansweredActions": 0.52,
        "sideCommitment": 0.34,
        "crackRatio": 0.46,
        "sideSwitches": 0.41,
        "contextSwitches": 0.58,
        "intersectionHold": 0.37,
        "correctionLatency": 0.44,
        "binarySwitches": 0.22,
        "highLightRatio": 0.54,
        "noDuskTicks": 0.30,
    }
    for seed in range(0x1B1700, 0x1B1710):
        run_a = compose_run(patterns, composers, rigs, run_seed=seed, metrics=sample_metrics)
        run_b = compose_run(patterns, composers, rigs, run_seed=seed, metrics=sample_metrics)
        passed = run_a["traceSha256"] == run_b["traceSha256"] and len(run_a["rooms"]) == len(set(run_a["rooms"])) == 3
        if not passed:
            director_failures.append(seed)
        director_rows.append({"runSeed": seed, "traceSha256": run_a["traceSha256"], "repeatSha256": run_b["traceSha256"], "rooms": run_a["rooms"], "bossId": run_a["bossId"], "durationMs": run_a["durationMs"], "events": len(run_a["schedule"]), "pass": passed})
    if director_failures:
        errors.append(f"run director deterministic composition failures: {director_failures}")
    write_json(REPORT_DIR / "director-determinism-report-v4.json", {"schemaVersion": "4.0.0", "algorithm": "seeded weighted sampling without replacement", "sameSeedSameSchedule": not director_failures, "sampleMetrics": sample_metrics, "runs": director_rows, "exampleSchedule": compose_run(patterns, composers, rigs, run_seed=0x1B17, metrics=sample_metrics)})
    checks.append({"id": "director-determinism", "pass": not director_failures, "seeds": len(director_rows), "failures": director_failures})
    projectile = manifests["projectile"]
    flight = next((state for state in projectile["states"] if state["id"] == "flight"), None)
    if not flight or not flight.get("collision") or "timeout" in flight.get("exit", ""):
        errors.append("projectile flight must be colliding, entity-owned and have no fixed timeout")
    if projectile["grazeEvidence"].get("maximumPerProjectile") != 1 or projectile["grazeEvidence"].get("score") is not None:
        errors.append("graze must produce evidence once, never score")
    if not any("visual alpha" in invariant for invariant in projectile["invariants"]):
        errors.append("projectile lifecycle must explicitly reject alpha-authored collision")
    checks.append({"id": "gameplay-cross-references", "pass": not any("unknown pattern" in e or "unknown laser" in e for e in errors), "enemies": len(enemies), "enemyRoles": len(enemy_roles), "bosses": len(rigs), "bossTerminalEvents": len(set(terminal_events)), "laserGeometryTypes": len(geometry_types), "roomComposers": len(composers)})

    report = {
        "schemaVersion": "4.0.0",
        "status": "PASS" if not errors else "FAIL",
        "summary": {
            "errors": len(errors),
            "warnings": len(warnings),
            "motionOperators": len(operators),
            "executablePatterns": len(patterns),
            "uniqueStructuralSignatures": len(signature_groups),
            "enemies": len(enemies),
            "mechanicalEnemyRoles": len(enemy_roles),
            "bosses": len(rigs),
            "bossPhases": sum(len(rig["phases"]) for rig in rigs),
            "bossCanonicalResolutions": len(rigs) - len({error.split(":", 1)[0] for error in boss_canonical_errors if error.startswith("boss.")}),
            "laserGeometries": len(lasers),
            "weatherEchoPatterns": len(weather_echoes),
            "deterministicPatterns": len(patterns) - len(deterministic_failures),
            "normalSolvablePatterns": len(patterns) - len(reachability_failures),
            "focusSolvablePatterns": len(patterns) - len(reachability_failures),
            "deterministicRunCompositions": len(director_rows) - len(director_failures),
        },
        "checks": checks,
        "errors": errors,
        "warnings": warnings,
    }
    write_json(REPORT_DIR / "validation-report-v4.json", report)
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    if errors:
        print("\nERRORS", file=sys.stderr)
        for issue in errors:
            print(f"- {issue}", file=sys.stderr)
        return 1
    print("V4 GAMEPLAY VALIDATION: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
