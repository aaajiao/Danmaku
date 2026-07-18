#!/usr/bin/env python3
"""Read-only cross-validation for the v3 art manifests and deterministic runtime."""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable


HERE = Path(__file__).resolve().parent
ERRORS: list[str] = []


def fail(message: str) -> None:
    ERRORS.append(message)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_object)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        raise RuntimeError(f"cannot load {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise RuntimeError(f"root of {path} must be an object")
    return value


def as_dict(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail(f"{label} must be an object")
        return {}
    return value


def as_list(value: Any, label: str) -> list[Any]:
    if not isinstance(value, list):
        fail(f"{label} must be an array")
        return []
    return value


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def source_manifests(contract: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], dict[str, Path]]:
    expected = {
        "animationClips": "animation-clips.json",
        "bossRigs": "boss-rigs.json",
        "laserModules": "laser-modules.json",
        "runtimeEffects": "runtime-effects.json",
    }
    configured = as_dict(contract.get("sourceManifests"), "runtime-contract.sourceManifests")
    require(configured == expected, "sourceManifests must use same-directory paths for the final manifests/v3 package")
    loaded: dict[str, dict[str, Any]] = {}
    paths: dict[str, Path] = {}
    for key, relative in expected.items():
        path = (HERE / relative).resolve()
        if not path.is_file():
            path = (HERE.parent / "art" / "manifests" / relative).resolve()
        paths[key] = path
        require(path.is_file(), f"source manifest {key} does not exist: {path}")
        if path.is_file():
            loaded[key] = load_json(path)
    return loaded, paths


def validate_art_manifests(
    sources: dict[str, dict[str, Any]],
    paths: dict[str, Path],
) -> tuple[set[str], set[str], dict[str, list[str]], int, int]:
    animation = sources.get("animationClips", {})
    effects_manifest = sources.get("runtimeEffects", {})
    laser_manifest = sources.get("laserModules", {})
    rigs_manifest = sources.get("bossRigs", {})
    for name, manifest in sources.items():
        require(manifest.get("schemaVersion") == "3.0.0", f"{name} schemaVersion must be 3.0.0")

    clip_map = as_dict(animation.get("clips"), "animation-clips.clips")
    frame_ids_by_clip: dict[str, list[str]] = {}
    all_frame_ids: set[str] = set()
    for clip_id, raw in clip_map.items():
        clip = as_dict(raw, f"clip {clip_id}")
        require(clip.get("id") == clip_id, f"clip key/id mismatch for {clip_id}")
        frames = as_list(clip.get("frames"), f"clip {clip_id}.frames")
        require(bool(frames), f"clip {clip_id} must contain frames")
        ids: list[str] = []
        for index, raw_frame in enumerate(frames):
            frame = as_dict(raw_frame, f"clip {clip_id} frame {index}")
            frame_id = frame.get("frameId")
            duration = frame.get("durationMs")
            require(isinstance(frame_id, str) and bool(frame_id), f"clip {clip_id} frame {index} needs frameId")
            require(is_number(duration) and duration > 0, f"clip {clip_id} frame {index} durationMs must be > 0")
            if isinstance(frame_id, str):
                ids.append(frame_id)
                all_frame_ids.add(frame_id)
        frame_ids_by_clip[clip_id] = ids
        event_names: list[str] = []
        for raw_event in as_list(clip.get("events"), f"clip {clip_id}.events"):
            event = as_dict(raw_event, f"clip {clip_id} event")
            frame_index = event.get("frame")
            name = event.get("name")
            require(isinstance(frame_index, int) and not isinstance(frame_index, bool) and 0 <= frame_index < len(frames),
                    f"clip {clip_id} event has invalid frame index")
            require(isinstance(name, str) and bool(name), f"clip {clip_id} event needs name")
            if isinstance(name, str):
                event_names.append(name)
        require(clip.get("reducedMotionFrame") in ids, f"clip {clip_id} reducedMotionFrame must belong to the clip")
        require(clip.get("reducedMotionPreservesEvents") is True,
                f"clip {clip_id} must preserve events under reduced motion")
        reduced_events = as_list(clip.get("reducedMotionEvents"), f"clip {clip_id}.reducedMotionEvents")
        require(reduced_events == event_names, f"clip {clip_id} reduced-motion event list must match full playback")

    required_clips = {
        "player.focus",
        "system.override.directional",
        "player.causality.damage_to_trace",
        "player.return_with_history",
        "enemy.causality.damage_to_trace",
        "bullet.lifecycle",
        "bullet.cancel",
        "boss.laser.lifecycle",
        "memory.directional_write",
        "state.snapshot_handoff",
    }
    require(required_clips <= set(clip_map), f"final v3 clips missing: {sorted(required_clips - set(clip_map))}")
    require("enemy.causality.rupture_to_trace" not in clip_map,
            "obsolete enemy.causality.rupture_to_trace clip must not remain in the final manifest")
    require(frame_ids_by_clip.get("bullet.cancel") == ["bullet.impact_0", "bullet.impact_1"],
            "bullet.cancel must be the two-frame immediate impact clip")
    lifecycle_frames = frame_ids_by_clip.get("bullet.lifecycle", [])
    require("bullet.afterimage" in lifecycle_frames and "bullet.clear" in lifecycle_frames,
            "bullet.lifecycle must retain the full afterimage/clear residue")

    effect_map = as_dict(effects_manifest.get("effects"), "runtime-effects.effects")
    for effect_id, raw in effect_map.items():
        effect = as_dict(raw, f"effect {effect_id}")
        require(effect.get("id") == effect_id, f"effect key/id mismatch for {effect_id}")
        require(effect.get("authority") == "visual-only", f"effect {effect_id} must be visual-only")
        reduced = as_dict(effect.get("reducedMotion"), f"effect {effect_id}.reducedMotion")
        require(reduced.get("gameplayEventsUnchanged") is True,
                f"effect {effect_id} must leave gameplay events unchanged")

    module_map = as_dict(laser_manifest.get("modules"), "laser-modules.modules")
    state_machine_ref = laser_manifest.get("stateMachine")
    require(isinstance(state_machine_ref, str), "laser-modules.stateMachine must be a path")
    if isinstance(state_machine_ref, str) and "laserModules" in paths:
        resolved = (paths["laserModules"].parent / state_machine_ref).resolve()
        require(resolved == (HERE / "boss-laser-state-machine.json").resolve(),
                "laser modules must reference the v3 runtime boss laser state machine")
    defaults = as_dict(laser_manifest.get("defaults"), "laser-modules.defaults")
    shutdown = as_dict(defaults.get("shutdown"), "laser defaults.shutdown")
    require(shutdown.get("clip") in clip_map, "laser default shutdown clip must exist")
    collision = as_dict(defaults.get("collision"), "laser defaults.collision")
    require(collision.get("enableState") == "live" and collision.get("disableState") == "shutdown",
            "laser modules must enable collision only in live and disable it on shutdown")
    reduced_laser = as_dict(defaults.get("reducedMotion"), "laser defaults.reducedMotion")
    require(reduced_laser.get("gameplayTimingUnchanged") is True,
            "laser reduced motion must preserve gameplay timing")
    for module_id, raw in module_map.items():
        module = as_dict(raw, f"laser module {module_id}")
        require(module.get("id") == module_id, f"laser module key/id mismatch for {module_id}")
        frames = as_dict(module.get("frames"), f"laser module {module_id}.frames")
        for role, frame_id in frames.items():
            require(frame_id in all_frame_ids, f"laser module {module_id} {role} uses unknown frame {frame_id!r}")
        timing = as_dict(module.get("timing"), f"laser module {module_id}.timing")
        for timing_name, value in timing.items():
            require(is_number(value) and value >= 0,
                    f"laser module {module_id} timing {timing_name} must be non-negative")

    rig_map = as_dict(rigs_manifest.get("rigs"), "boss-rigs.rigs")
    for rig_id, raw in rig_map.items():
        rig = as_dict(raw, f"boss rig {rig_id}")
        require(rig.get("id") == rig_id, f"boss rig key/id mismatch for {rig_id}")
        require(isinstance(rig.get("topologyFrame"), str) and bool(rig.get("topologyFrame")),
                f"boss rig {rig_id} topologyFrame must be a static frame id")
        require(rig.get("terminalClip") in clip_map, f"boss rig {rig_id} terminalClip is unknown")
        nodes = as_dict(rig.get("nodes"), f"boss rig {rig_id}.nodes")
        for node_id, raw_node in nodes.items():
            node = as_dict(raw_node, f"boss rig {rig_id} node {node_id}")
            if node.get("type") == "sprite":
                require(node.get("clip") in clip_map, f"boss rig {rig_id} node {node_id} clip is unknown")
                for frame_id in as_dict(node.get("phaseFrames"), f"boss rig {rig_id} node {node_id}.phaseFrames").values():
                    require(isinstance(frame_id, str) and bool(frame_id),
                            f"boss rig {rig_id} node {node_id} phase frame must be a static frame id")
        for raw_phase in as_list(rig.get("phases"), f"boss rig {rig_id}.phases"):
            phase = as_dict(raw_phase, f"boss rig {rig_id} phase")
            require(isinstance(phase.get("bodyFrame"), str) and bool(phase.get("bodyFrame")),
                    f"boss rig {rig_id} phase bodyFrame must be a static frame id")
            require(phase.get("attackClip") in clip_map, f"boss rig {rig_id} phase attackClip is unknown")
            require(phase.get("laserModule") in module_map, f"boss rig {rig_id} phase laserModule is unknown")
        for raw_binding in as_list(rig.get("eventBindings"), f"boss rig {rig_id}.eventBindings"):
            binding = as_dict(raw_binding, f"boss rig {rig_id} event binding")
            action = as_dict(binding.get("action"), f"boss rig {rig_id} event action")
            action_type = action.get("type")
            action_id = action.get("id")
            if action_type == "effect":
                require(action_id in effect_map, f"boss rig {rig_id} binds unknown effect {action_id!r}")
            elif action_type == "playClip":
                require(action_id in clip_map, f"boss rig {rig_id} binds unknown clip {action_id!r}")
            elif action_type == "spawnLaser":
                require(action_id in module_map, f"boss rig {rig_id} binds unknown laser module {action_id!r}")
            else:
                fail(f"boss rig {rig_id} has unsupported event action {action_type!r}")
    return set(clip_map), set(effect_map), frame_ids_by_clip, len(rig_map), len(module_map)


def validate_laser(machine: dict[str, Any]) -> tuple[int, set[str]]:
    require(machine.get("schemaVersion") == "3.0.0", "laser schemaVersion must be 3.0.0")
    expected_states = ["idle", "telegraph", "charge", "grow", "live", "shutdown", "residue"]
    states = as_dict(machine.get("states"), "laser.states")
    require(list(states) == expected_states, f"laser states must be ordered as {' -> '.join(expected_states)}")
    gameplay_events: set[str] = set()
    parameters = as_dict(machine.get("parameters"), "laser.parameters")
    for state_name in expected_states:
        state = as_dict(states.get(state_name), f"laser.states.{state_name}")
        require(state.get("collision") is (state_name == "live"), f"laser collision invariant failed for {state_name}")
        if state_name != "idle":
            duration_param = state.get("durationParam")
            require(isinstance(duration_param, str) and duration_param in parameters,
                    f"laser state {state_name} has unknown durationParam")
            for raw_event in as_list(state.get("entryEvents"), f"laser.states.{state_name}.entryEvents"):
                event = as_dict(raw_event, f"laser state {state_name} entry event")
                require(event.get("channel") in {"gameplay", "visual"},
                        f"laser state {state_name} entry event has invalid channel")
                require(isinstance(event.get("priority"), int) and not isinstance(event.get("priority"), bool),
                        f"laser state {state_name} entry event needs integer priority")
                if event.get("channel") == "gameplay" and isinstance(event.get("id"), str):
                    gameplay_events.add(event["id"])
    for name, raw in parameters.items():
        parameter = as_dict(raw, f"laser parameter {name}")
        default = parameter.get("default")
        minimum = parameter.get("min")
        require(is_number(default) and is_number(minimum) and default >= minimum >= 0,
                f"laser parameter {name} violates default >= min >= 0")

    transitions = as_list(machine.get("transitions"), "laser.transitions")
    expected_pairs = list(zip(expected_states, expected_states[1:])) + [("residue", "idle")]
    actual_pairs = [(item.get("from"), item.get("to")) for item in transitions if isinstance(item, dict)]
    require(actual_pairs == expected_pairs, "laser transitions must cover the complete lifecycle exactly once")
    for raw_transition in transitions:
        transition = as_dict(raw_transition, "laser transition")
        for raw_event in transition.get("events", []):
            event = as_dict(raw_event, "laser transition event")
            if event.get("channel") == "gameplay" and isinstance(event.get("id"), str):
                gameplay_events.add(event["id"])
    cancel_event = as_dict(as_dict(machine.get("cancelPolicy"), "laser.cancelPolicy").get("event"), "laser cancel event")
    if cancel_event.get("channel") == "gameplay" and isinstance(cancel_event.get("id"), str):
        gameplay_events.add(cancel_event["id"])

    live_events = as_list(as_dict(states.get("live"), "laser.states.live").get("entryEvents"), "laser live events")
    shutdown_events = as_list(as_dict(states.get("shutdown"), "laser.states.shutdown").get("entryEvents"), "laser shutdown events")
    live_ids = [event.get("id") for event in sorted(live_events, key=lambda event: event.get("priority", 999)) if isinstance(event, dict)]
    shutdown_ids = [event.get("id") for event in sorted(shutdown_events, key=lambda event: event.get("priority", 999)) if isinstance(event, dict)]
    require(live_ids and live_ids[0] == "laser.collision.on", "laser collision must enable before live visuals")
    require(shutdown_ids and shutdown_ids[0] == "laser.collision.off", "laser collision must disable before shutdown visuals")
    require(as_dict(machine.get("largeDelta"), "laser.largeDelta").get("overflowPolicy") == "throw-no-silent-event-drop",
            "laser transition overflow must not silently drop events")
    return len(states), gameplay_events


def validate_timeline_contract(
    contract: dict[str, Any],
    clips: set[str],
    effects: set[str],
    frame_ids_by_clip: dict[str, list[str]],
    laser_event_ids: set[str],
) -> tuple[int, set[str]]:
    require(contract.get("schemaVersion") == "3.0.0", "runtime-contract schemaVersion must be 3.0.0")
    clock = as_dict(contract.get("clock"), "runtime-contract.clock")
    gameplay_clock = as_dict(clock.get("gameplay"), "runtime-contract.clock.gameplay")
    visual_clock = as_dict(clock.get("visual"), "runtime-contract.clock.visual")
    require(gameplay_clock.get("intervalSemantics") == "start emits t=0; advance emits events in (previousTime, nextTime]",
            "gameplay interval semantics must be explicit")
    require(visual_clock.get("mayEmitGameplayEvents") is False, "visual clock must not emit gameplay events")
    profiles = as_dict(contract.get("visualProfiles"), "runtime-contract.visualProfiles")
    full = as_dict(profiles.get("full"), "visualProfiles.full")
    reduced = as_dict(profiles.get("reduced-motion"), "visualProfiles.reduced-motion")
    require(full.get("gameplayEventSource") == "gameplay-timeline", "full profile must use gameplay timeline")
    require(reduced.get("gameplayEventSource") == "gameplay-timeline", "reduced-motion must use gameplay timeline")
    require(reduced.get("requiredEventEquivalence") == "same-event-id-same-simulation-time-same-order",
            "reduced-motion equivalence requirement is missing")
    policy = as_dict(contract.get("timelinePolicy"), "runtime-contract.timelinePolicy")
    large_delta = as_dict(policy.get("largeDelta"), "timelinePolicy.largeDelta")
    require(large_delta.get("traverseEveryCrossedBoundary") is True and large_delta.get("emitEveryCrossedEvent") is True,
            "large delta must traverse and emit every crossed event")
    require(large_delta.get("onLimit") == "throw-no-silent-drop", "large delta overflow must be explicit")
    cancel = as_dict(policy.get("cancel"), "timelinePolicy.cancel")
    require(cancel.get("completionAfterCancel") is False, "cancelled timelines must not complete")
    require(cancel.get("collisionDisablePrecedesVisualCancel") is True, "cancel must disable collision before VFX")
    selection = as_dict(contract.get("timelineSelection"), "runtime-contract.timelineSelection")
    projectile_selection = as_dict(selection.get("projectileArmPolicy"), "timelineSelection.projectileArmPolicy")
    require(projectile_selection.get("chooseExactlyOne") == [
        "projectile.normal-arm", "projectile.heavy-arm", "projectile.lifecycle"
    ], "projectile arm/lifecycle authorities must be explicitly mutually exclusive")
    require(projectile_selection.get("default") == "projectile.lifecycle"
            and projectile_selection.get("concurrentSelectionAllowed") is False,
            "projectile.lifecycle must be the non-concurrent default authority")
    require(projectile_selection.get("cancelTimeline") == "projectile.cancel",
            "projectile cancel timeline must interrupt the selected arm authority")

    timelines = as_dict(contract.get("gameplayTimelines"), "runtime-contract.gameplayTimelines")
    required_timelines = {
        "player.focus", "player.hit", "player.death-respawn", "player.override.directional",
        "projectile.lifecycle", "projectile.cancel", "boss.laser.lifecycle", "boss.phase",
        "cross-run.snapshot", "room.transition",
    }
    require(required_timelines <= set(timelines), f"required gameplay timelines missing: {sorted(required_timelines - set(timelines))}")
    gameplay_event_ids: set[str] = set()
    for timeline_id, raw in timelines.items():
        timeline = as_dict(raw, f"gameplayTimelines.{timeline_id}")
        timeline_type = timeline.get("timelineType", "fixed")
        require(timeline_type in {"fixed", "state-machine-adapter", "event-adapter"},
                f"timeline {timeline_id} has unsupported timelineType")
        events = as_list(timeline.get("events"), f"gameplayTimelines.{timeline_id}.events")
        require(bool(events), f"timeline {timeline_id} must declare events")
        duration = timeline.get("durationMs")
        for index, raw_event in enumerate(events):
            event = as_dict(raw_event, f"timeline {timeline_id} event {index}")
            event_id = event.get("id")
            priority = event.get("priority")
            require(isinstance(event_id, str) and bool(event_id), f"timeline {timeline_id} event {index} needs id")
            require(isinstance(priority, int) and not isinstance(priority, bool),
                    f"timeline {timeline_id} event {index} priority must be an integer")
            require(event.get("channel", "gameplay") == "gameplay",
                    f"timeline {timeline_id} cannot contain a visual-channel event")
            if isinstance(event_id, str):
                gameplay_event_ids.add(event_id)
            if timeline_type == "fixed":
                at_ms = event.get("atMs")
                require(is_number(duration) and duration > 0, f"fixed timeline {timeline_id} durationMs must be > 0")
                require(is_number(at_ms) and is_number(duration) and 0 <= at_ms <= duration,
                        f"fixed timeline {timeline_id} event {index} must be within duration")
            elif timeline_type == "state-machine-adapter":
                require("atMs" not in event and any(key in event for key in ("onStateEntry", "onTransition", "on")),
                        f"state-machine adapter {timeline_id} events must use state triggers, never visual time")
            else:
                require("atMs" not in event and isinstance(event.get("on"), str),
                        f"event adapter {timeline_id} events must use authoritative triggers")

        if timeline_type == "fixed" and is_number(duration):
            for raw_event in events:
                if not isinstance(raw_event, dict):
                    continue
                if raw_event.get("atMs") == duration and raw_event.get("id", "").endswith("collision.on"):
                    require(timeline.get("completionPriority", 90) > raw_event.get("priority", 20),
                            f"timeline {timeline_id} completion must occur after collision enable")
            groups: dict[float, list[dict[str, Any]]] = defaultdict(list)
            for event in events:
                if isinstance(event, dict) and is_number(event.get("atMs")):
                    groups[event["atMs"]].append(event)
            for at_ms, group in groups.items():
                ordered = sorted(enumerate(group), key=lambda item: (item[1].get("priority", 10), item[0]))
                ids = [event.get("id", "") for _, event in ordered]
                off = next((i for i, event_id in enumerate(ids) if event_id.endswith("collision.off")), None)
                commit = next((i for i, event_id in enumerate(ids) if event_id.endswith(("damage.commit", "cancel.commit", "death.commit", "impact.commit"))), None)
                if off is not None and commit is not None:
                    require(off < commit, f"timeline {timeline_id} at {at_ms}ms must disable collision before commit")
        for terminal_key in ("completionEvent", "cancelEvent"):
            value = timeline.get(terminal_key)
            if isinstance(value, str):
                gameplay_event_ids.add(value)

    laser_adapter = as_dict(timelines.get("boss.laser.lifecycle"), "boss.laser.lifecycle adapter")
    adapter_ids = {event.get("id") for event in as_list(laser_adapter.get("events"), "boss laser adapter events") if isinstance(event, dict)}
    require(laser_adapter.get("authority") == "boss-laser-state-machine.json",
            "boss laser timeline must delegate to the authoritative state machine")
    require(laser_adapter.get("parameterSource") == "laser-modules.json#modules.*.timing",
            "boss laser timeline must read timing from the packaged laser modules")
    require(laser_adapter.get("parameterMapping") == {
        "telegraphMs": "warningMs",
        "chargeMs": "chargeMs",
        "growMs": "growMs",
        "liveMs": "minimumLiveMs",
        "shutdownMs": "shutdownMs",
        "residueMs": "residueMs",
    }, "boss laser module/state-machine parameter mapping is incomplete")
    require(adapter_ids == laser_event_ids,
            f"boss laser adapter/state machine event mismatch: adapter-only={sorted(adapter_ids-laser_event_ids)}, machine-only={sorted(laser_event_ids-adapter_ids)}")

    bindings = as_dict(contract.get("visualBindings"), "runtime-contract.visualBindings")
    require(set(bindings) <= set(timelines), "every visualBinding must belong to a gameplay timeline")
    for binding_id, raw in bindings.items():
        binding = as_dict(raw, f"visualBindings.{binding_id}")
        clip_refs: list[Any] = []
        effect_refs: list[Any] = []
        if "clip" in binding:
            clip_refs.append(binding["clip"])
        if "clips" in binding:
            clip_refs.extend(as_list(binding["clips"], f"visualBindings.{binding_id}.clips"))
        if "effect" in binding:
            effect_refs.append(binding["effect"])
        if "effects" in binding:
            effect_refs.extend(as_list(binding["effects"], f"visualBindings.{binding_id}.effects"))
        for clip_ref in clip_refs:
            require(isinstance(clip_ref, str) and clip_ref in clips,
                    f"visual binding {binding_id} references unknown clip {clip_ref!r}")
        for effect_ref in effect_refs:
            require(isinstance(effect_ref, str) and effect_ref in effects,
                    f"visual binding {binding_id} references unknown effect {effect_ref!r}")
        for event_id, clip_ref in as_dict(binding.get("eventClips", {}), f"visualBindings.{binding_id}.eventClips").items():
            require(event_id in gameplay_event_ids, f"visual binding {binding_id} eventClips uses unknown gameplay event {event_id}")
            require(clip_ref in clips, f"visual binding {binding_id} eventClips uses unknown clip {clip_ref!r}")
        for event_id, raw_segment in as_dict(binding.get("eventClipSegments", {}), f"visualBindings.{binding_id}.eventClipSegments").items():
            segment = as_dict(raw_segment, f"visual binding {binding_id} segment {event_id}")
            clip_ref = segment.get("clip")
            require(event_id in gameplay_event_ids, f"visual segment {binding_id} uses unknown gameplay event {event_id}")
            require(clip_ref in clips, f"visual segment {binding_id} uses unknown clip {clip_ref!r}")
            frames = frame_ids_by_clip.get(clip_ref, []) if isinstance(clip_ref, str) else []
            start = segment.get("fromFrameId")
            end = segment.get("toFrameId")
            require(start in frames and end in frames and frames.index(start) <= frames.index(end),
                    f"visual segment {binding_id} has an invalid frame range")

    collision_contract = as_dict(contract.get("collisionContract"), "runtime-contract.collisionContract")
    global_collision = as_dict(collision_contract.get("global"), "collisionContract.global")
    require(global_collision.get("neverDeriveFromAlphaOrGPUReadback") is True,
            "collision must not derive from render data")
    require(global_collision.get("largeDeltaMotionTest") == "swept-shape-not-endpoint-only",
            "collision must use swept shapes for large delta")
    in_between = as_dict(collision_contract.get("inBetween"), "collisionContract.inBetween")
    require(in_between.get("mode") == "stable-intersection", "IN_BETWEEN must use stable intersection")
    require(in_between.get("predicate") == "primary.contains(point) && secondary.contains(point)",
            "IN_BETWEEN predicate must require both shapes")
    require(in_between.get("visualJitterAffectsCollision") is False,
            "IN_BETWEEN visual jitter must not affect collision")
    return len(timelines), gameplay_event_ids


def detect_cycle(nodes: Iterable[str], adjacency: dict[str, list[str]]) -> str | None:
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(node: str) -> str | None:
        if node in visiting:
            return node
        if node in visited:
            return None
        visiting.add(node)
        for target in adjacency.get(node, []):
            cycle = visit(target)
            if cycle:
                return cycle
        visiting.remove(node)
        visited.add(node)
        return None

    for node in nodes:
        cycle = visit(node)
        if cycle:
            return cycle
    return None


def validate_binding_graph(
    graph: dict[str, Any],
    clips: set[str],
    effects: set[str],
    gameplay_event_ids: set[str],
    frame_ids_by_clip: dict[str, list[str]],
) -> tuple[int, int]:
    require(graph.get("schemaVersion") == "3.0.0", "binding graph schemaVersion must be 3.0.0")
    policy = as_dict(graph.get("policy"), "binding-graph.policy")
    require(policy.get("forbidVisualToGameplayEdges") is True, "binding graph must forbid visual-to-gameplay edges")
    require(policy.get("requireAcyclic") is True, "binding graph must require acyclic bindings")
    scopes = {"perEvent", "perLoop", "perStateEntry", "perInstance"}
    require(set(as_dict(policy.get("dedupeKeyTemplates"), "binding dedupe templates")) == scopes,
            "binding graph must define every idempotency scope")

    nodes: dict[str, dict[str, Any]] = {}
    for raw in as_list(graph.get("nodes"), "binding-graph.nodes"):
        node = as_dict(raw, "binding node")
        node_id = node.get("id")
        require(isinstance(node_id, str) and bool(node_id), "binding node needs id")
        if not isinstance(node_id, str):
            continue
        require(node_id not in nodes, f"duplicate binding node {node_id}")
        nodes[node_id] = node
        kind = node.get("kind")
        require(kind in {"gameplay-event", "visual-event", "clip", "effect"},
                f"binding node {node_id} has invalid kind")
        if kind == "clip":
            require(node.get("ref") in clips, f"binding node {node_id} references unknown clip {node.get('ref')!r}")
        elif kind == "effect":
            require(node.get("ref") in effects, f"binding node {node_id} references unknown effect {node.get('ref')!r}")
        elif kind == "gameplay-event":
            require(node.get("eventId") in gameplay_event_ids,
                    f"gameplay binding node {node_id} references undeclared event {node.get('eventId')!r}")

    edge_list = as_list(graph.get("edges"), "binding-graph.edges")
    edge_ids: set[str] = set()
    edge_pairs: set[tuple[Any, Any]] = set()
    adjacency: dict[str, list[str]] = defaultdict(list)
    outgoing: set[str] = set()
    for raw in edge_list:
        edge = as_dict(raw, "binding edge")
        edge_id = edge.get("id")
        source = edge.get("from")
        target = edge.get("to")
        require(isinstance(edge_id, str) and bool(edge_id), "binding edge needs id")
        if isinstance(edge_id, str):
            require(edge_id not in edge_ids, f"duplicate binding edge {edge_id}")
            edge_ids.add(edge_id)
        require((source, target) not in edge_pairs, f"duplicate binding pair {source!r} -> {target!r}")
        edge_pairs.add((source, target))
        require(source in nodes, f"binding edge {edge_id} has unknown source {source!r}")
        require(target in nodes, f"binding edge {edge_id} has unknown target {target!r}")
        scope = edge.get("scope")
        require(scope in scopes, f"binding edge {edge_id} has invalid idempotency scope")
        if source in nodes and target in nodes:
            source_kind = nodes[source].get("kind")
            target_kind = nodes[target].get("kind")
            source_event = nodes[source].get("eventId", "")
            require(source_kind == "gameplay-event", f"binding edge {edge_id} must start at gameplay")
            require(target_kind in {"clip", "effect"}, f"binding edge {edge_id} must terminate at clip/effect")
            require(not (target_kind == "gameplay-event"), f"binding edge {edge_id} cannot target gameplay")
            require((scope == "perStateEntry") == str(source_event).startswith("laser."),
                    f"binding edge {edge_id} must use perStateEntry exactly for laser state events")
            adjacency[source].append(target)
            outgoing.add(source)
            segment = edge.get("segment")
            if segment is not None:
                segment_data = as_dict(segment, f"binding edge {edge_id}.segment")
                target_ref = nodes[target].get("ref")
                frames = frame_ids_by_clip.get(target_ref, [])
                start = segment_data.get("fromFrameId")
                end = segment_data.get("toFrameId")
                require(target_kind == "clip" and start in frames and end in frames and frames.index(start) <= frames.index(end),
                        f"binding edge {edge_id} has invalid clip segment")
    for node_id, node in nodes.items():
        if node.get("kind") in {"clip", "effect"}:
            require(node_id not in outgoing, f"terminal visual node {node_id} cannot dispatch another binding")
    cycle = detect_cycle(nodes, adjacency)
    require(cycle is None, f"binding graph cycle detected at {cycle}")
    return len(nodes), len(edge_list)


def main() -> int:
    try:
        contract = load_json(HERE / "runtime-contract.json")
        machine = load_json(HERE / "boss-laser-state-machine.json")
        graph = load_json(HERE / "binding-graph.json")
        sources, paths = source_manifests(contract)
        clips, effects, frame_ids_by_clip, rig_count, module_count = validate_art_manifests(sources, paths)
        state_count, laser_event_ids = validate_laser(machine)
        timeline_count, gameplay_event_ids = validate_timeline_contract(
            contract, clips, effects, frame_ids_by_clip, laser_event_ids
        )
        node_count, edge_count = validate_binding_graph(
            graph, clips, effects, gameplay_event_ids, frame_ids_by_clip
        )
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    if ERRORS:
        for error in ERRORS:
            print(f"ERROR: {error}", file=sys.stderr)
        print(f"validation failed with {len(ERRORS)} error(s)", file=sys.stderr)
        return 1
    print(
        "v3 runtime/art alignment valid: "
        f"{timeline_count} gameplay timelines, {state_count} laser states, "
        f"{rig_count} boss rigs, {module_count} laser modules, "
        f"{node_count} binding nodes, {edge_count} idempotent edges, "
        f"{len(clips)} v3 clips and {len(effects)} visual-only effects checked"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
