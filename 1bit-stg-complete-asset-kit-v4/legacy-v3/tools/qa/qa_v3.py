#!/usr/bin/env python3
"""Read-only semantic and visual QA for the v3 pixel-danmaku asset contract.

The command may write a JSON report, but only beneath work/v3/qa. It never
normalizes, repacks, or edits the kit being inspected.
"""

from __future__ import annotations

import argparse
import collections
import json
import math
import statistics
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Optional

from PIL import Image

from v3lib import ID_RE, Kit, contrast_ratio, frame_hash, safe_output_path, srgb_luminance, write_json


@dataclass
class Finding:
    level: str
    code: str
    message: str
    context: str = ""
    evidence: Any = None


class Report:
    def __init__(self, kit: Kit, max_per_code: int = 24) -> None:
        self.kit = kit
        self.findings: list[Finding] = []
        self.metrics: dict[str, Any] = {}
        self.max_per_code = max_per_code
        self._seen_per_code: collections.Counter[str] = collections.Counter()
        self._suppressed: collections.Counter[str] = collections.Counter()
        self._total_counts: collections.Counter[str] = collections.Counter()

    def add(self, level: str, code: str, message: str, context: str = "", evidence: Any = None) -> None:
        self._total_counts[level] += 1
        if self._seen_per_code[code] >= self.max_per_code:
            self._suppressed[code] += 1
            return
        self._seen_per_code[code] += 1
        self.findings.append(Finding(level, code, message, context, evidence))

    def error(self, code: str, message: str, context: str = "", evidence: Any = None) -> None:
        self.add("error", code, message, context, evidence)

    def warn(self, code: str, message: str, context: str = "", evidence: Any = None) -> None:
        self.add("warning", code, message, context, evidence)

    def info(self, code: str, message: str, context: str = "", evidence: Any = None) -> None:
        self.add("info", code, message, context, evidence)

    @property
    def counts(self) -> dict[str, int]:
        return {
            level: int(self._total_counts[level])
            for level in ("error", "warning", "info")
        }

    def finish(self) -> dict[str, Any]:
        for code, count in sorted(self._suppressed.items()):
            self.findings.append(
                Finding("info", "suppressed", f"{count} additional {code} findings suppressed", code)
            )
        return {
            "schemaVersion": "3.0.0-qa-report",
            "kitRoot": str(self.kit.root),
            "manifestPaths": {
                key: str(path) if path else None for key, path in self.kit.manifest_paths.items()
            },
            "summary": self.counts,
            "displayedSummary": {
                level: sum(item.level == level for item in self.findings)
                for level in ("error", "warning", "info")
            },
            "suppressedByCode": dict(sorted(self._suppressed.items())),
            "metrics": self.metrics,
            "findings": [asdict(item) for item in self.findings],
        }


def nested_hex_colors(value: Any) -> set[tuple[int, int, int]]:
    colors: set[tuple[int, int, int]] = set()
    if isinstance(value, str) and len(value) in (7, 9) and value.startswith("#"):
        try:
            colors.add(tuple(int(value[index : index + 2], 16) for index in (1, 3, 5)))
        except ValueError:
            pass
    elif isinstance(value, dict):
        for child in value.values():
            colors.update(nested_hex_colors(child))
    elif isinstance(value, list):
        for child in value:
            colors.update(nested_hex_colors(child))
    return colors


def opaque_rgbs(image: Image.Image) -> list[tuple[int, int, int]]:
    return [(red, green, blue) for red, green, blue, alpha in image.get_flattened_data() if alpha > 0]


def percentile(values: list[float], quantile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = quantile * (len(ordered) - 1)
    low = math.floor(index)
    high = math.ceil(index)
    if low == high:
        return ordered[low]
    return ordered[low] * (high - index) + ordered[high] * (index - low)


def check_contract_presence(kit: Kit, report: Report) -> None:
    required = ("animation", "frames", "palette-or-visual-contract", "rigs", "lasers", "effects-or-binding-graph")
    missing: list[str] = []
    if kit.manifest_paths.get("animation") is None:
        missing.append("animation")
    if kit.manifest_paths.get("frames") is None:
        missing.append("frames")
    if not kit.palette:
        missing.append("palette-or-visual-contract")
    if kit.manifest_paths.get("rigs") is None:
        missing.append("rigs")
    if kit.manifest_paths.get("lasers") is None:
        missing.append("lasers")
    if not kit.effects and not kit.binding_graph:
        missing.append("effects-or-binding-graph")
    for key in missing:
        report.error("manifest.missing", f"required {key} manifest is missing", key)
    report.metrics["contract"] = {
        "required": list(required),
        "missing": missing,
        "clipCount": len(kit.clips),
        "frameCount": len(kit.frames),
        "atlasCount": len(kit.atlas_specs),
    }


def check_palette_and_cell_colors(kit: Kit, report: Report) -> None:
    palette_cfg = kit.qa_config.get("palette", {}) if isinstance(kit.qa_config.get("palette"), dict) else {}
    configured = nested_hex_colors(palette_cfg.get("targetColors", []))
    target = configured or nested_hex_colors(kit.palette)
    sprite_contract = kit.visual_contract.get("spriteContract", {}) if isinstance(kit.visual_contract.get("spriteContract"), dict) else {}
    max_colors = int(
        palette_cfg.get(
            "maxColorsPerCell",
            kit.qa_config.get(
                "maxColorsPerCell",
                sprite_contract.get("maximumVisibleColorsPerOrdinaryCell", 6),
            ),
        )
    )
    tolerance = int(palette_cfg.get("channelTolerance", 0))
    if not target:
        report.error("palette.target_missing", "no target colors were found in palette or qa-config")
        return

    def allowed(color: tuple[int, int, int]) -> bool:
        return any(max(abs(color[i] - item[i]) for i in range(3)) <= tolerance for item in target)

    over_limit: list[tuple[str, int]] = []
    off_palette: list[tuple[str, int, int]] = []
    unreadable: list[str] = []
    counts: list[int] = []
    inspected = 0
    for frame_id in kit.all_frame_ids():
        try:
            colors = opaque_rgbs(kit.crop(frame_id))
        except (KeyError, FileNotFoundError, ValueError) as exc:
            unreadable.append(f"{frame_id}: {exc}")
            continue
        inspected += 1
        unique = set(colors)
        counts.append(len(unique))
        if len(unique) > max_colors:
            over_limit.append((frame_id, len(unique)))
        outside = sum(1 for color in unique if not allowed(color))
        if outside:
            off_palette.append((frame_id, outside, len(unique)))
    for frame_id, count in over_limit:
        report.error(
            "palette.cell_color_limit",
            f"cell uses {count} visible RGB colors; maximum is {max_colors}",
            frame_id,
        )
    for frame_id, outside, total in off_palette:
        report.error(
            "palette.off_target",
            f"{outside}/{total} cell colors are outside the target palette",
            frame_id,
        )
    for detail in unreadable:
        report.error("frame.unreadable", detail)
    report.metrics["palette"] = {
        "targetColors": ["#%02X%02X%02X" % color for color in sorted(target)],
        "channelTolerance": tolerance,
        "maxColorsPerCell": max_colors,
        "inspectedCells": inspected,
        "unreadableCells": len(unreadable),
        "cellsOverColorLimit": len(over_limit),
        "cellsOffPalette": len(off_palette),
        "cellColorCount": {
            "min": min(counts) if counts else None,
            "median": statistics.median(counts) if counts else None,
            "max": max(counts) if counts else None,
        },
    }


def semantic_value(frame: dict[str, Any]) -> Optional[str]:
    for key in ("semanticId", "semanticID", "semantic", "meaningId"):
        if isinstance(frame.get(key), str):
            return frame[key]
    return None


def check_semantics_and_pivots(kit: Kit, report: Report) -> None:
    semantic_to_frame: dict[str, str] = {}
    missing_semantic: list[str] = []
    duplicate_semantic: list[tuple[str, str, str]] = []
    invalid_pivots: list[str] = []
    for frame_id, frame in sorted(kit.frames.items()):
        semantic = semantic_value(frame)
        if semantic is None:
            missing_semantic.append(frame_id)
        elif not ID_RE.fullmatch(semantic):
            report.error("semantic.invalid", f"invalid semantic ID {semantic!r}", frame_id)
        elif semantic in semantic_to_frame:
            duplicate_semantic.append((semantic, semantic_to_frame[semantic], frame_id))
        else:
            semantic_to_frame[semantic] = frame_id
        pivot = frame.get("pivot")
        valid = (
            isinstance(pivot, list)
            and len(pivot) == 2
            and all(isinstance(value, (int, float)) and not isinstance(value, bool) and 0 <= value <= 1 for value in pivot)
        )
        if not valid:
            invalid_pivots.append(frame_id)
    for frame_id in missing_semantic:
        report.error("semantic.missing", "frame has no stable semanticId", frame_id)
    for semantic, first, second in duplicate_semantic:
        report.error(
            "semantic.duplicate",
            f"semantic ID {semantic!r} is shared by two frames",
            second,
            {"first": first},
        )
    for frame_id in invalid_pivots:
        report.error("pivot.invalid", "pivot must be two normalized numbers in [0,1]", frame_id)

    drift_tolerance = float(kit.qa_config.get("pivotDriftTolerance", 0.02))
    pivot_drift: list[tuple[str, float]] = []
    for clip_id, clip in sorted(kit.clips.items()):
        pivots: list[tuple[float, float]] = []
        for step in kit.timeline(clip_id, expand_playback=False):
            record = kit.frame_record(step.ref) or {}
            pivot = record.get("pivot")
            if isinstance(pivot, list) and len(pivot) == 2 and all(isinstance(x, (int, float)) for x in pivot):
                pivots.append((float(pivot[0]), float(pivot[1])))
        if pivots:
            spread = max(math.dist(left, right) for left in pivots for right in pivots)
            if spread > drift_tolerance:
                pivot_drift.append((clip_id, spread))
    for clip_id, spread in pivot_drift:
        report.error(
            "pivot.clip_drift",
            f"pivot spread {spread:.4f} exceeds {drift_tolerance:.4f}",
            clip_id,
        )
    report.metrics["semanticsAndPivots"] = {
        "frames": len(kit.frames),
        "semanticIds": len(semantic_to_frame),
        "missingSemanticIds": len(missing_semantic),
        "duplicateSemanticIds": len(duplicate_semantic),
        "invalidPivots": len(invalid_pivots),
        "clipsWithPivotDrift": len(pivot_drift),
    }


def check_duplicates(kit: Kit, report: Report) -> None:
    exact_groups: dict[str, list[str]] = collections.defaultdict(list)
    normalized_groups: dict[str, list[str]] = collections.defaultdict(list)
    exact_hash_by_frame: dict[str, str] = {}
    for frame_id in kit.all_frame_ids():
        try:
            image = kit.crop(frame_id)
        except (KeyError, FileNotFoundError, ValueError):
            continue
        exact = frame_hash(image, False)
        exact_hash_by_frame[frame_id] = exact
        exact_groups[exact].append(frame_id)
        normalized_groups[frame_hash(image, True)].append(frame_id)
    exact_duplicates = [items for items in exact_groups.values() if len(items) > 1]
    normalized_duplicates = [items for items in normalized_groups.values() if len(items) > 1]
    for items in exact_duplicates:
        report.warn(
            "duplicate.frame_exact",
            f"{len(items)} frame IDs have byte-identical cells",
            items[0],
            items[:12],
        )

    repeated_in_clip: list[tuple[str, list[str]]] = []
    clip_signatures: dict[str, list[str]] = collections.defaultdict(list)
    for clip_id, clip in sorted(kit.clips.items()):
        timeline = kit.timeline(clip_id, expand_playback=False)
        refs = [item.ref for item in timeline]
        repeated = sorted(ref for ref, count in collections.Counter(refs).items() if count > 1)
        if repeated:
            repeated_in_clip.append((clip_id, repeated))
            report.error(
                "duplicate.frame_in_clip",
                "clip repeats image frames; encode the dwell with hold instead",
                clip_id,
                repeated,
            )
        signature_value = {
            "framePixels": [exact_hash_by_frame.get(ref, f"missing:{ref}") for ref in refs],
            "durations": [item.duration_ms for item in timeline],
            "events": [item.events for item in timeline],
            "loop": clip.get("loop"),
            "loopMode": clip.get("loopMode"),
        }
        signature = json.dumps(signature_value, sort_keys=True, ensure_ascii=True)
        clip_signatures[signature].append(clip_id)
    duplicate_clips = [items for items in clip_signatures.values() if len(items) > 1]
    for items in duplicate_clips:
        report.error("duplicate.clip", "clips have identical timing, frames, events and playback mode", items[0], items)
    report.metrics["duplicates"] = {
        "exactFrameGroups": len(exact_duplicates),
        "normalizedFrameGroups": len(normalized_duplicates),
        "clipsWithRepeatedFrames": len(repeated_in_clip),
        "duplicateClipGroups": len(duplicate_clips),
    }


def infer_monotonic_direction(clip_id: str, clip: dict[str, Any]) -> Optional[str]:
    declared = clip.get("monotonic") or clip.get("lifecycle") or clip.get("profile")
    if isinstance(declared, dict):
        declared = declared.get("alphaArea") or declared.get("direction")
    if isinstance(declared, str):
        lowered = declared.lower()
        if lowered in ("increase", "increasing", "spawn", "appear"):
            return "increase"
        if lowered in ("decrease", "decreasing", "delete", "residue", "disappear"):
            return "decrease"
    lowered_id = clip_id.lower()
    if any(token in lowered_id for token in ("spawn", "respawn", "appear", "materialize")):
        return "increase"
    if any(token in lowered_id for token in ("delete", "cancel", "shutdown", "residue", "scar", "death", "rupture", "dissolve")):
        return "decrease"
    return None


def check_monotonic_lifecycles(kit: Kit, report: Report) -> None:
    tolerance = float(kit.qa_config.get("monotonicAreaTolerance", 0.03))
    checked = 0
    failed = 0
    details: dict[str, Any] = {}
    for clip_id, clip in sorted(kit.clips.items()):
        direction = infer_monotonic_direction(clip_id, clip)
        if direction is None:
            continue
        checked += 1
        areas: list[int] = []
        for step in kit.timeline(clip_id, expand_playback=False):
            try:
                histogram = kit.crop(step.ref).getchannel("A").histogram()
                areas.append(sum(histogram[1:]))
            except (KeyError, FileNotFoundError, ValueError):
                areas.append(-1)
        violations: list[int] = []
        for index, (left, right) in enumerate(zip(areas, areas[1:])):
            if left < 0 or right < 0:
                continue
            if direction == "increase" and right + max(1, int(left * tolerance)) < left:
                violations.append(index)
            if direction == "decrease" and right > left + max(1, int(left * tolerance)):
                violations.append(index)
        details[clip_id] = {"direction": direction, "alphaAreas": areas, "violations": violations}
        if violations:
            failed += 1
            report.error(
                "lifecycle.non_monotonic",
                f"{direction} alpha-area lifecycle reverses at {len(violations)} transition(s)",
                clip_id,
                details[clip_id],
            )
    report.metrics["monotonicLifecycles"] = {
        "tolerance": tolerance,
        "checkedClips": checked,
        "failedClips": failed,
        "clips": details,
    }


def _event_names(clip: dict[str, Any]) -> list[str]:
    names: list[str] = []
    for event in clip.get("events", []):
        if isinstance(event, str):
            names.append(event)
        elif isinstance(event, dict):
            value = event.get("name") or event.get("event") or event.get("id")
            if isinstance(value, str):
                names.append(value)
    return names


def build_event_graph(kit: Kit) -> dict[str, set[str]]:
    graph: dict[str, set[str]] = collections.defaultdict(set)
    for clip_id, clip in kit.clips.items():
        source = f"clip:{clip_id}"
        graph.setdefault(source, set())
        for name in _event_names(clip):
            graph[source].add(f"event:{name}")
        for key in ("nextClip", "onComplete", "gotoClip"):
            target = clip.get(key)
            if isinstance(target, str):
                graph[source].add(f"clip:{target}")

    bindings = kit.effects.get("eventBindings", {})
    if isinstance(bindings, dict):
        for event, targets in bindings.items():
            if isinstance(targets, str):
                targets = [targets]
            if isinstance(targets, list):
                for target in targets:
                    if isinstance(target, str):
                        graph[f"event:{event}"].add(f"effect:{target}")
    effects = normalize_effects(kit.effects.get("effects"))
    for effect_id, effect in effects.items():
        source = f"effect:{effect_id}"
        graph.setdefault(source, set())
        for key in ("clip", "playClip", "nextClip", "gotoClip"):
            target = effect.get(key)
            if isinstance(target, str):
                graph[source].add(f"clip:{target}")
        emitted = effect.get("emitEvent") or effect.get("event")
        if isinstance(emitted, str):
            graph[source].add(f"event:{emitted}")

    rigs = normalize_effects(kit.rigs.get("rigs"))
    for rig_id, rig in rigs.items():
        for binding in rig.get("eventBindings", []):
            if not isinstance(binding, dict) or not isinstance(binding.get("event"), str):
                continue
            source = f"event:{binding['event']}"
            action = binding.get("action", {})
            if not isinstance(action, dict):
                continue
            action_type = action.get("type")
            target = action.get("id")
            if action_type == "playClip" and isinstance(target, str):
                graph[source].add(f"clip:{target}")
            elif action_type == "effect" and isinstance(target, str):
                graph[source].add(f"effect:{target}")
            elif action_type == "spawnLaser" and isinstance(target, str):
                graph[source].add(f"laser:{target}")
    return graph


def normalize_effects(value: Any) -> dict[str, dict[str, Any]]:
    if isinstance(value, dict):
        return {str(key): item for key, item in value.items() if isinstance(item, dict)}
    if isinstance(value, list):
        return {
            str(item["id"]): item
            for item in value
            if isinstance(item, dict) and isinstance(item.get("id"), str)
        }
    return {}


def graph_cycles(graph: dict[str, set[str]]) -> list[list[str]]:
    state: dict[str, int] = {}
    stack: list[str] = []
    cycles: list[list[str]] = []

    def visit(node: str) -> None:
        state[node] = 1
        stack.append(node)
        for child in graph.get(node, set()):
            if state.get(child, 0) == 0:
                visit(child)
            elif state.get(child) == 1:
                start = stack.index(child)
                cycle = stack[start:] + [child]
                if cycle not in cycles:
                    cycles.append(cycle)
        stack.pop()
        state[node] = 2

    for node in sorted(set(graph) | {child for children in graph.values() for child in children}):
        if state.get(node, 0) == 0:
            visit(node)
    return cycles


def check_event_graph(kit: Kit, report: Report) -> None:
    if kit.binding_graph:
        raw_nodes = kit.binding_graph.get("nodes", [])
        raw_edges = kit.binding_graph.get("edges", [])
        nodes: dict[str, dict[str, Any]] = {}
        duplicate_nodes: list[str] = []
        if isinstance(raw_nodes, list):
            for node in raw_nodes:
                if not isinstance(node, dict) or not isinstance(node.get("id"), str):
                    report.error("event_graph.node_invalid", "binding graph node needs a string id")
                    continue
                node_id = node["id"]
                if node_id in nodes:
                    duplicate_nodes.append(node_id)
                    report.error("event_graph.node_duplicate", "duplicate binding graph node id", node_id)
                nodes[node_id] = node
        else:
            report.error("event_graph.nodes_invalid", "binding graph nodes must be an array")

        graph: dict[str, set[str]] = collections.defaultdict(set)
        edge_ids: set[str] = set()
        invalid_edges = 0
        if isinstance(raw_edges, list):
            for edge in raw_edges:
                if not isinstance(edge, dict):
                    invalid_edges += 1
                    report.error("event_graph.edge_invalid", "binding graph edge must be an object")
                    continue
                edge_id, source, target = edge.get("id"), edge.get("from"), edge.get("to")
                if not all(isinstance(value, str) for value in (edge_id, source, target)):
                    invalid_edges += 1
                    report.error("event_graph.edge_invalid", "binding edge needs string id/from/to", evidence=edge)
                    continue
                if edge_id in edge_ids:
                    invalid_edges += 1
                    report.error("event_graph.edge_duplicate", "duplicate binding graph edge id", edge_id)
                edge_ids.add(edge_id)
                if source not in nodes or target not in nodes:
                    invalid_edges += 1
                    report.error(
                        "event_graph.edge_endpoint",
                        "binding edge references an unknown endpoint",
                        edge_id,
                        {"from": source, "to": target},
                    )
                    continue
                graph[source].add(target)
        else:
            report.error("event_graph.edges_invalid", "binding graph edges must be an array")

        policy = kit.binding_graph.get("policy", {}) if isinstance(kit.binding_graph.get("policy"), dict) else {}
        terminal_kinds = set(policy.get("terminalKinds", [])) if isinstance(policy.get("terminalKinds"), list) else set()
        authoritative_kinds = set(policy.get("authoritativeKinds", [])) if isinstance(policy.get("authoritativeKinds"), list) else set()
        for source, targets in graph.items():
            source_kind = nodes[source].get("kind")
            if source_kind in terminal_kinds and targets:
                report.error("event_graph.terminal_outgoing", "terminal visual node has outgoing edges", source)
            if policy.get("forbidVisualToGameplayEdges"):
                for target in targets:
                    target_kind = nodes[target].get("kind")
                    if target_kind in authoritative_kinds and source_kind not in authoritative_kinds:
                        report.error(
                            "event_graph.visual_to_gameplay",
                            "visual node may not dispatch into authoritative gameplay",
                            source,
                            {"to": target},
                        )
        cycles = graph_cycles(graph)
        for cycle in cycles:
            report.error("event_graph.cycle", "explicit binding graph contains a cycle", cycle[0], cycle)
        report.metrics["eventGraph"] = {
            "source": "explicit-binding-graph",
            "nodes": len(nodes),
            "edges": len(edge_ids),
            "invalidEdges": invalid_edges,
            "duplicateNodes": len(duplicate_nodes),
            "cycles": cycles,
            "policy": {
                "forbidVisualToGameplayEdges": policy.get("forbidVisualToGameplayEdges"),
                "requireAcyclic": policy.get("requireAcyclic"),
            },
        }
        return

    graph = build_event_graph(kit)
    cycles = graph_cycles(graph)
    for cycle in cycles:
        report.error("event_graph.cycle", "event/action graph contains a cycle", cycle[0], cycle)
    all_nodes = set(graph) | {child for targets in graph.values() for child in targets}
    report.metrics["eventGraph"] = {
        "source": "derived-from-animation-effects-rigs",
        "nodes": len(all_nodes),
        "edges": sum(len(targets) for targets in graph.values()),
        "cycles": cycles,
    }


def reduced_event_names(value: Any) -> Optional[list[str]]:
    if not isinstance(value, list):
        return None
    names: list[str] = []
    for item in value:
        if isinstance(item, str):
            names.append(item)
        elif isinstance(item, dict):
            name = item.get("name") or item.get("event") or item.get("id")
            if isinstance(name, str):
                names.append(name)
    return names


def check_reduced_motion(kit: Kit, report: Report) -> None:
    missing_mode: list[str] = []
    missing_parity: list[str] = []
    event_mismatch: list[str] = []
    duration_mismatch: list[str] = []
    visual_profiles = kit.runtime_contract.get("visualProfiles", {}) if isinstance(kit.runtime_contract.get("visualProfiles"), dict) else {}
    reduced_profile = visual_profiles.get("reduced-motion", {}) if isinstance(visual_profiles.get("reduced-motion"), dict) else {}
    gameplay_authority = (
        reduced_profile.get("gameplayEventSource") == "gameplay-timeline"
        and isinstance(reduced_profile.get("requiredEventEquivalence"), str)
        and bool(reduced_profile.get("requiredEventEquivalence"))
    )
    covered_by_gameplay_authority = 0
    for clip_id, clip in sorted(kit.clips.items()):
        normal_events = _event_names(clip)
        reduced_clip_id = clip.get("reducedMotionClip")
        static_reduced = clip.get("reducedMotionFrame") or clip.get("reducedMotionFrames")
        if not isinstance(reduced_clip_id, str) and not static_reduced:
            missing_mode.append(clip_id)
            report.error("reduced_motion.missing", "clip has no reduced-motion representation", clip_id)
            continue
        if isinstance(reduced_clip_id, str):
            reduced_clip = kit.clips.get(reduced_clip_id)
            if reduced_clip is None:
                report.error("reduced_motion.unknown_clip", f"unknown reduced-motion clip {reduced_clip_id!r}", clip_id)
                continue
            reduced_events = _event_names(reduced_clip)
            if normal_events != reduced_events:
                event_mismatch.append(clip_id)
                report.error(
                    "reduced_motion.event_parity",
                    "reduced-motion clip does not preserve ordered gameplay events",
                    clip_id,
                    {"normal": normal_events, "reduced": reduced_events},
                )
            normal_duration = sum(item.duration_ms for item in kit.timeline(clip_id, False))
            reduced_duration = sum(item.duration_ms for item in kit.timeline(reduced_clip_id, False))
            if normal_duration and not 0.5 <= reduced_duration / normal_duration <= 2.0:
                duration_mismatch.append(clip_id)
                report.error(
                    "reduced_motion.duration_parity",
                    "reduced-motion duration differs by more than 2×",
                    clip_id,
                    {"normalMs": normal_duration, "reducedMs": reduced_duration},
                )
        elif normal_events:
            declared = reduced_event_names(clip.get("reducedMotionEvents"))
            if gameplay_authority:
                covered_by_gameplay_authority += 1
            elif declared is None and clip.get("reducedMotionPreservesEvents") is not True:
                missing_parity.append(clip_id)
                report.error(
                    "reduced_motion.parity_unspecified",
                    "static reduced-motion frame does not explicitly preserve event dispatch",
                    clip_id,
                    normal_events,
                )
            elif declared is not None and declared != normal_events:
                event_mismatch.append(clip_id)
                report.error(
                    "reduced_motion.event_parity",
                    "reducedMotionEvents differ from normal ordered events",
                    clip_id,
                    {"normal": normal_events, "reduced": declared},
                )

    effects = normalize_effects(kit.effects.get("effects"))
    effects_missing = [effect_id for effect_id, effect in effects.items() if not isinstance(effect.get("reducedMotion"), dict)]
    for effect_id in effects_missing:
        report.error("reduced_motion.effect_missing", "runtime effect has no reducedMotion contract", effect_id)
    report.metrics["reducedMotion"] = {
        "clips": len(kit.clips),
        "clipsMissingRepresentation": len(missing_mode),
        "clipsMissingEventParityDeclaration": len(missing_parity),
        "clipsWithEventMismatch": len(event_mismatch),
        "clipsWithDurationMismatch": len(duration_mismatch),
        "gameplayTimelineAuthority": gameplay_authority,
        "clipsCoveredByGameplayTimelineAuthority": covered_by_gameplay_authority,
        "effects": len(effects),
        "effectsMissingContract": len(effects_missing),
    }


def projectile_frame_ids(kit: Kit) -> list[str]:
    atlas_ids: set[str] = set()
    for atlas_id, spec in kit.atlas_specs.items():
        tags = spec.get("tags", [])
        joined = " ".join(str(tag).lower() for tag in tags) if isinstance(tags, list) else ""
        name = atlas_id.lower()
        if any(token in name or token in joined for token in ("bullet", "projectile", "danmaku")):
            atlas_ids.add(atlas_id)
    return [
        frame_id
        for frame_id in kit.all_frame_ids()
        if isinstance((kit.frame_record(frame_id) or {}).get("atlas"), str)
        and (kit.frame_record(frame_id) or {}).get("atlas") in atlas_ids
    ]


def image_luminances(image: Image.Image, opaque_only: bool) -> list[float]:
    sample = image.copy()
    sample.thumbnail((180, 320), Image.Resampling.NEAREST)
    values: list[float] = []
    for red, green, blue, alpha in sample.get_flattened_data():
        if opaque_only and alpha == 0:
            continue
        values.append(srgb_luminance((red, green, blue)))
    return values


def check_background_contrast(kit: Kit, report: Report) -> None:
    config = kit.qa_config.get("contrast", {}) if isinstance(kit.qa_config.get("contrast"), dict) else {}
    minimum = float(config.get("minimumMedianContrastRatio", 3.0))
    passing_fraction = float(config.get("minimumPassingProjectileFraction", 0.9))
    refs = projectile_frame_ids(kit)
    projectile_luminance: dict[str, float] = {}
    for frame_id in refs:
        try:
            values = image_luminances(kit.crop(frame_id), True)
        except (KeyError, FileNotFoundError, ValueError):
            continue
        if values:
            projectile_luminance[frame_id] = statistics.median(values)
    backgrounds = kit.background_paths()
    if not backgrounds:
        report.error("contrast.background_missing", "no scrolling background PNGs found")
    if not projectile_luminance:
        report.error("contrast.projectile_missing", "no bullet/projectile atlas frames found")
    rows: list[dict[str, Any]] = []
    for path in backgrounds:
        image = Image.open(path).convert("RGBA")
        bg_values = image_luminances(image, False)
        bg_median = statistics.median(bg_values) if bg_values else 0.0
        ratios = [contrast_ratio(value, bg_median) for value in projectile_luminance.values()]
        pass_count = sum(value >= minimum for value in ratios)
        fraction = pass_count / len(ratios) if ratios else 0.0
        row = {
            "background": str(path.relative_to(kit.root)),
            "backgroundLuminance": {
                "p10": round(percentile(bg_values, 0.10), 5),
                "median": round(bg_median, 5),
                "p90": round(percentile(bg_values, 0.90), 5),
            },
            "projectiles": len(ratios),
            "contrast": {
                "minimum": round(min(ratios), 3) if ratios else None,
                "median": round(statistics.median(ratios), 3) if ratios else None,
                "passingFraction": round(fraction, 4),
                "requiredRatio": minimum,
            },
        }
        rows.append(row)
        if fraction < passing_fraction:
            report.error(
                "contrast.projectile_background",
                f"only {fraction:.1%} of projectiles reach {minimum:.1f}:1 against median background luminance; require {passing_fraction:.1%}",
                row["background"],
                row,
            )
    report.metrics["backgroundContrast"] = {
        "requiredRatio": minimum,
        "requiredPassingFraction": passing_fraction,
        "projectileFrames": len(projectile_luminance),
        "backgrounds": rows,
    }


def run_checks(kit: Kit, max_per_code: int) -> dict[str, Any]:
    report = Report(kit, max_per_code=max_per_code)
    check_contract_presence(kit, report)
    check_palette_and_cell_colors(kit, report)
    check_semantics_and_pivots(kit, report)
    check_duplicates(kit, report)
    check_monotonic_lifecycles(kit, report)
    check_event_graph(kit, report)
    check_reduced_motion(kit, report)
    check_background_contrast(kit, report)
    return report.finish()


def print_report(data: dict[str, Any]) -> None:
    print(f"v3 QA: {data['kitRoot']}")
    summary = data["summary"]
    print(f"summary: {summary['error']} error, {summary['warning']} warning, {summary['info']} info")
    for finding in data["findings"]:
        context = f" ({finding['context']})" if finding.get("context") else ""
        print(f"[{finding['level'].upper()}] {finding['code']}{context}: {finding['message']}")
    print("metrics:")
    print(json.dumps(data["metrics"], ensure_ascii=False, indent=2))


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Read-only v3 pixel-danmaku asset QA")
    result.add_argument("--kit-root", type=Path, required=True, help="root of the asset kit to inspect")
    result.add_argument("--report", type=Path, help="optional JSON output; must be beneath work/v3/qa")
    result.add_argument("--max-findings-per-code", type=int, default=24, help="cap repetitive console/report findings")
    result.add_argument("--strict-warnings", action="store_true", help="return failure when warnings are present")
    return result


def main(argv: Optional[list[str]] = None) -> int:
    args = parser().parse_args(argv)
    try:
        kit = Kit(args.kit_root)
        data = run_checks(kit, max(1, args.max_findings_per_code))
        if args.report:
            write_json(safe_output_path(args.report), data)
        print_report(data)
    except Exception as exc:  # noqa: BLE001 - CLI boundary should report bad contracts cleanly
        print(f"qa_v3: {exc}", file=sys.stderr)
        return 2
    failed = data["summary"]["error"] > 0
    if args.strict_warnings:
        failed = failed or data["summary"]["warning"] > 0
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
