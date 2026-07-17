#!/usr/bin/env python3
"""Deterministic geometry-placeholder simulator for V4 patterns.

This is deliberately small and renderer-independent. It is a reference compiler
and QA oracle, not a replacement for the Three.js runtime.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import json
import math
from pathlib import Path
from typing import Any, Iterable


VIEW_W = 360.0
VIEW_H = 640.0
PLAYER_Y = 570.0


class Mulberry32:
    def __init__(self, seed: int):
        self.state = seed & 0xFFFFFFFF

    def random(self) -> float:
        self.state = (self.state + 0x6D2B79F5) & 0xFFFFFFFF
        z = self.state
        z = ((z ^ (z >> 15)) * (z | 1)) & 0xFFFFFFFF
        z ^= (z + (((z ^ (z >> 7)) * (z | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((z ^ (z >> 14)) & 0xFFFFFFFF) / 4294967296.0


@dataclass
class Bullet:
    uid: int
    source: str
    spawn_ms: float
    x: float
    y: float
    heading_deg: float
    base_speed: float
    radius: float
    motion: list[dict[str, Any]]
    collision: bool = True
    alive: bool = True
    generation: int = 0
    origin_x: float = 0.0
    origin_y: float = 0.0
    orbit_phase: float = 0.0
    events: set[str] = field(default_factory=set)

    def age(self, now_ms: float) -> float:
        return now_ms - self.spawn_ms


def ease_smooth(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def gap_center(pattern: dict[str, Any], now_ms: float) -> float:
    spec = pattern["safeGap"]
    path = spec["path"]
    center = float(path.get("centerX", VIEW_W / 2))
    amplitude = float(path.get("amplitudePx", 0))
    period = max(1000.0, float(path.get("periodMs", 6000)))
    phase = float(path.get("phase", 0.0))
    lanes = path.get("laneX", [])
    gap_type = spec["type"]
    if lanes:
        if now_ms < 900:
            return center
        route = list(lanes) + list(reversed(lanes[1:-1])) if len(lanes) > 2 else list(lanes)
        segment = period / max(1, len(route))
        local = now_ms - 900
        index = int(local // segment) % len(route)
        previous = center if local < segment else float(route[(index - 1) % len(route)])
        target = float(route[index])
        transition_ms = min(segment, max(1000.0, abs(target - previous) / 78.0 * 1000.0))
        blend = min(1.0, (local % segment) / transition_ms)
        return previous + (target - previous) * blend
    if gap_type in {"quantized_step", "binary_cross", "pulse_gate", "hard_lane_swap"}:
        # The surrounding hazard changes in discrete steps; the opening itself
        # travels as a bounded triangle so reduced-speed focus can still follow.
        triangle = (2.0 / math.pi) * math.asin(math.sin((now_ms / period + phase) * math.tau))
        return center + amplitude * triangle
    return center + amplitude * math.sin((now_ms / period) * math.tau + phase * math.tau)


def gap_width(pattern: dict[str, Any], difficulty: str) -> float:
    return float(pattern["safeGap"]["minimumWidthPx"] + pattern["difficulty"][difficulty]["gapDeltaPx"])


def interpolate_keys(keys: list[dict[str, Any]], now_ms: float, key: str, *, mode: str = "linear") -> float:
    if not keys:
        return 1.0
    if now_ms <= keys[0]["atMs"]:
        return float(keys[0][key])
    for left, right in zip(keys, keys[1:]):
        if now_ms <= right["atMs"]:
            if mode == "step":
                return float(left[key])
            span = max(1.0, right["atMs"] - left["atMs"])
            u = (now_ms - left["atMs"]) / span
            return float(left[key]) + (float(right[key]) - float(left[key])) * u
    return float(keys[-1][key])


def speed_from_curve(emitter: dict[str, Any], age_ms: float, difficulty: str, pattern: dict[str, Any]) -> float:
    speed = interpolate_keys(emitter["speedCurve"]["keys"], age_ms, "pxPerSec")
    return speed * pattern["difficulty"][difficulty]["speedMultiplier"]


def angles_and_positions(emitter: dict[str, Any], burst_index: int, count: int) -> list[tuple[float, float, float]]:
    geom = emitter["geometry"]
    gtype = geom["type"]
    base = float(geom["baseAngleDeg"])
    spread = float(geom["spreadDeg"])
    ax = float(emitter["anchor"]["x"]) * VIEW_W
    ay = float(emitter["anchor"]["y"]) * VIEW_H
    result: list[tuple[float, float, float]] = []
    if gtype in {"line", "grid", "wall", "lattice", "shutter"}:
        for i in range(count):
            x = 16.0 + (VIEW_W - 32.0) * ((i + 0.5) / count)
            stagger = (burst_index % 2) * (VIEW_W / count) * 0.45
            x = ((x + stagger - 12.0) % (VIEW_W - 24.0)) + 12.0
            angle = base + (spread * ((i / max(1, count - 1)) - 0.5) if spread else 0.0)
            result.append((x, ay, angle))
    elif gtype in {"ring", "broken_ring"}:
        gap = 44.0 if gtype == "broken_ring" else 0.0
        usable = 360.0 - gap
        for i in range(count):
            result.append((ax, ay, base + gap / 2.0 + usable * i / max(1, count)))
    elif gtype == "cross":
        for i in range(count):
            result.append((ax, ay, base + (i % 4) * 90 + (i // 4) * 8))
    elif gtype == "spiral":
        rotation = (burst_index * 23.0) % 360.0
        for i in range(count):
            result.append((ax, ay, base + rotation + spread * i / max(1, count)))
    elif gtype == "paired_fan":
        for i in range(count):
            side = -1.0 if i % 2 == 0 else 1.0
            rank = i // 2
            angle = base + side * spread * (rank + 0.5) / max(1, math.ceil(count / 2))
            result.append((ax + side * 8.0, ay, angle))
    elif gtype == "history_chain":
        for i in range(count):
            result.append((ax + (i - (count - 1) / 2.0) * 4.0, ay - i * 3.0, base))
    else:  # fan / arc and any future radial fan-like placeholder
        for i in range(count):
            offset = 0.0 if count == 1 else spread * (i / (count - 1) - 0.5)
            result.append((ax, ay, base + offset))
    return result


def cadence_times(pattern: dict[str, Any], emitter: dict[str, Any], difficulty: str) -> Iterable[tuple[int, float]]:
    multiplier = pattern["difficulty"][difficulty]["cadenceMultiplier"]
    start = float(emitter["cadence"]["startMs"])
    interval = float(emitter["cadence"]["intervalMs"]) * multiplier
    for burst in range(int(emitter["cadence"]["bursts"])):
        at = start + burst * interval
        if at < pattern["durationMs"]:
            yield burst, at


def target_trace(pattern: dict[str, Any], now_ms: float) -> tuple[float, float]:
    return gap_center(pattern, now_ms), PLAYER_Y


def angle_to(x: float, y: float, tx: float, ty: float) -> float:
    return math.degrees(math.atan2(ty - y, tx - x))


def normalize_angle(value: float) -> float:
    return (value + 180.0) % 360.0 - 180.0


def op_for(bullet: Bullet, operator: str) -> dict[str, Any] | None:
    return next((entry for entry in bullet.motion if entry["operator"] == operator), None)


def create_schedule(pattern: dict[str, Any], difficulty: str) -> list[tuple[float, dict[str, Any], int]]:
    schedule = []
    for emitter in pattern["emitters"]:
        for burst, at in cadence_times(pattern, emitter, difficulty):
            schedule.append((at, emitter, burst))
    return sorted(schedule, key=lambda row: (row[0], row[1]["id"], row[2]))


def simulation(
    pattern: dict[str, Any],
    *,
    seed: int | None = None,
    difficulty: str = "NORMAL",
    dt_ms: float = 1000.0 / 30.0,
    capture_ms: float = 100.0,
) -> dict[str, Any]:
    seed = int(pattern["seed"]["base"] if seed is None else seed)
    rng = Mulberry32(seed)
    schedule = create_schedule(pattern, difficulty)
    schedule_index = 0
    bullets: list[Bullet] = []
    next_uid = 1
    now_ms = 0.0
    next_capture = 0.0
    frames: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []
    omitted = 0
    split_spawned = 0
    count_multiplier = pattern["difficulty"][difficulty]["countMultiplier"]
    duration = float(pattern["durationMs"])

    while now_ms <= duration + 0.01:
        while schedule_index < len(schedule) and schedule[schedule_index][0] <= now_ms + 0.001:
            at, source, burst_index = schedule[schedule_index]
            schedule_index += 1
            base_count = int(source["geometry"]["count"])
            count = max(1, int(round(base_count * count_multiplier)))
            for x, y, heading in angles_and_positions(source, burst_index, count):
                # Tiny seeded jitter is part of the executable geometry and never changes ordering.
                jitter = (rng.random() - 0.5) * min(3.0, source["geometry"]["spreadDeg"] * 0.012)
                base_speed = speed_from_curve(source, 0.0, difficulty, pattern)
                bullet = Bullet(
                    uid=next_uid,
                    source=source["id"],
                    spawn_ms=at,
                    x=x,
                    y=y,
                    heading_deg=heading + jitter,
                    base_speed=base_speed,
                    radius=float(source["projectile"]["collisionRadiusPx"]),
                    motion=source["motionStack"],
                    origin_x=x,
                    origin_y=y,
                    orbit_phase=(next_uid * 0.61803398875 % 1.0) * math.tau,
                )
                # Snapshot aim at spawn is deterministic and reads the authored trace only once.
                aim = op_for(bullet, "op.aim_lock")
                if aim and float(aim["params"].get("lockAtMs", 0)) <= 0:
                    tx, ty = target_trace(pattern, at + float(aim["params"].get("leadMs", 0)))
                    desired = angle_to(x, y, tx, ty)
                    delta = max(-float(aim["params"].get("maxTurnDeg", 180)), min(float(aim["params"].get("maxTurnDeg", 180)), normalize_angle(desired - bullet.heading_deg)))
                    bullet.heading_deg += delta
                    bullet.events.add("aim")
                bullets.append(bullet)
                next_uid += 1
            events.append({"atMs": round(at, 3), "event": "emit", "source": source["id"], "count": count})

        spawned_children: list[Bullet] = []
        for bullet in bullets:
            if not bullet.alive or bullet.spawn_ms > now_ms:
                continue
            age = bullet.age(now_ms)
            previous_age = age - dt_ms

            aim = op_for(bullet, "op.aim_lock")
            if aim and "aim" not in bullet.events:
                lock_at = float(aim["params"].get("lockAtMs", 0))
                if previous_age < lock_at <= age:
                    tx, ty = target_trace(pattern, bullet.spawn_ms + lock_at + float(aim["params"].get("leadMs", 0)))
                    desired = angle_to(bullet.x, bullet.y, tx, ty)
                    max_turn = float(aim["params"].get("maxTurnDeg", 180))
                    bullet.heading_deg += max(-max_turn, min(max_turn, normalize_angle(desired - bullet.heading_deg)))
                    bullet.events.add("aim")

            turn = op_for(bullet, "op.turn_once")
            if turn and "turn" not in bullet.events:
                at = float(turn["params"]["atMs"])
                if previous_age < at <= age:
                    bullet.heading_deg += float(turn["params"]["deltaDeg"])
                    bullet.events.add("turn")

            homing = op_for(bullet, "op.limited_homing")
            if homing:
                start = float(homing["params"]["startMs"])
                end = float(homing["params"]["endMs"])
                if start <= age <= end:
                    tx, ty = target_trace(pattern, now_ms)
                    desired = angle_to(bullet.x, bullet.y, tx, ty)
                    max_delta = float(homing["params"]["maxDegPerSec"]) * dt_ms / 1000.0
                    bullet.heading_deg += max(-max_delta, min(max_delta, normalize_angle(desired - bullet.heading_deg)))

            speed = bullet.base_speed
            envelope = op_for(bullet, "op.speed_envelope")
            if envelope:
                speed *= interpolate_keys(envelope["params"]["keys"], age, "multiplier", mode=envelope["params"].get("interpolation", "linear"))

            dual = op_for(bullet, "op.dual_clock_gate")
            gate_active = True
            if dual:
                p = dual["params"]
                ta = (now_ms % float(p["periodAMs"])) / float(p["periodAMs"])
                tb = ((now_ms + float(p["phaseOffsetMs"])) % float(p["periodBMs"])) / float(p["periodBMs"])
                a = ta < float(p["dutyA"])
                b = tb < float(p["dutyB"])
                gate_active = a != b or (a and b and pattern["safeGap"]["type"] == "dual_clock_intersection")
                speed *= 1.0 if gate_active else 0.0
                bullet.collision = gate_active

            history = op_for(bullet, "op.history_replay")
            orbit = op_for(bullet, "op.orbit_release")
            if history:
                params = history["params"]
                local = max(0.0, age - float(params["delayMs"]))
                points = params["points"]
                if params.get("mode") == "reverse":
                    points = list(reversed([[x, y, points[-1][2] - t] for x, y, t in points]))
                if local <= points[-1][2]:
                    for p0, p1 in zip(points, points[1:]):
                        if local <= p1[2]:
                            u = (local - p0[2]) / max(1.0, p1[2] - p0[2])
                            offset = ((bullet.uid % 7) - 3) * 2.2
                            bullet.x = p0[0] + (p1[0] - p0[0]) * u + offset
                            bullet.y = p0[1] + (p1[1] - p0[1]) * u
                            break
                else:
                    rad = math.radians(bullet.heading_deg)
                    bullet.x += math.cos(rad) * speed * dt_ms / 1000.0
                    bullet.y += math.sin(rad) * speed * dt_ms / 1000.0
            elif orbit and age < float(orbit["params"]["releaseAtMs"]):
                radius = float(orbit["params"]["radiusPx"])
                theta = bullet.orbit_phase + math.radians(float(orbit["params"]["angularDegPerSec"])) * age / 1000.0
                bullet.x = bullet.origin_x + math.cos(theta) * radius
                bullet.y = bullet.origin_y + math.sin(theta) * radius
            else:
                if orbit and "released" not in bullet.events:
                    bullet.heading_deg = float(orbit["params"]["releaseHeadingDeg"])
                    bullet.events.add("released")
                advection = op_for(bullet, "op.local_vector_bias")
                vx_extra = vy_extra = 0.0
                if advection:
                    p = advection["params"]
                    pulse = math.sin(now_ms / float(p["pulsePeriodMs"]) * math.tau) * float(p["pulseAmount"])
                    vx_extra = float(p["vectorPxPerSec"][0]) * (1.0 + pulse)
                    vy_extra = float(p["vectorPxPerSec"][1]) * (1.0 + pulse)
                rad = math.radians(bullet.heading_deg)
                bullet.x += (math.cos(rad) * speed + vx_extra) * dt_ms / 1000.0
                bullet.y += (math.sin(rad) * speed + vy_extra) * dt_ms / 1000.0

            seam = op_for(bullet, "op.seam_transform")
            if seam and "seam" not in bullet.events:
                sx = float(seam["params"]["seamX"])
                if abs(bullet.x - sx) <= 2.5:
                    mode = seam["params"]["mode"]
                    if mode == "mirror":
                        bullet.x = VIEW_W - bullet.x
                        bullet.heading_deg = 180.0 - bullet.heading_deg
                    elif mode == "offset":
                        bullet.x += float(seam["params"].get("offsetPx", 0)) * (1 if math.cos(math.radians(bullet.heading_deg)) >= 0 else -1)
                    else:
                        bullet.heading_deg = 180.0 - bullet.heading_deg
                    bullet.events.add("seam")

            split = op_for(bullet, "op.split_generation")
            if split and "split" not in bullet.events and bullet.generation < int(split["params"].get("maxGeneration", 1)):
                at = float(split["params"]["atMs"])
                if previous_age < at <= age:
                    children = int(split["params"]["children"])
                    spread = float(split["params"]["spreadDeg"])
                    for ci in range(children):
                        offset = 0.0 if children == 1 else spread * (ci / (children - 1) - 0.5)
                        child = Bullet(
                            uid=next_uid,
                            source=bullet.source,
                            spawn_ms=now_ms,
                            x=bullet.x,
                            y=bullet.y,
                            heading_deg=bullet.heading_deg + offset,
                            base_speed=speed * float(split["params"]["speedMultiplier"]),
                            radius=bullet.radius,
                            motion=[entry for entry in bullet.motion if entry["operator"] != "op.split_generation"],
                            generation=bullet.generation + 1,
                            origin_x=bullet.x,
                            origin_y=bullet.y,
                        )
                        spawned_children.append(child)
                        next_uid += 1
                        split_spawned += 1
                    bullet.events.add("split")
                    bullet.alive = False

            # The pattern compiler enforces the authored corridor. Each policy is
            # visible in production (omission, gate, redirect or residue cancel).
            if bullet.alive and bullet.collision and 476.0 <= bullet.y <= 622.0:
                center = gap_center(pattern, now_ms)
                half = gap_width(pattern, difficulty) / 2.0 + bullet.radius + 2.0
                if abs(bullet.x - center) < half:
                    policy = pattern["safeGap"]["enforcement"]
                    if policy in {"operator_constraint", "seam_redirect"}:
                        side = -1.0 if bullet.x <= center else 1.0
                        bullet.x = center + side * half
                        bullet.heading_deg += side * 8.0
                    else:
                        bullet.alive = False
                    omitted += 1

            if bullet.x < -96 or bullet.x > VIEW_W + 96 or bullet.y < -128 or bullet.y > VIEW_H + 128:
                bullet.alive = False

        bullets.extend(spawned_children)
        if now_ms + 0.001 >= next_capture:
            visible = [
                [b.uid, round(b.x, 3), round(b.y, 3), round(b.radius, 2), 1 if b.collision else 0]
                for b in bullets
                if b.alive and -8 <= b.x <= VIEW_W + 8 and -8 <= b.y <= VIEW_H + 8
            ]
            frames.append({"atMs": round(now_ms, 3), "gapCenterX": round(gap_center(pattern, now_ms), 3), "gapWidthPx": gap_width(pattern, difficulty), "bullets": visible})
            next_capture += capture_ms
        now_ms += dt_ms

    payload = {"patternId": pattern["id"], "seed": seed, "difficulty": difficulty, "frames": frames, "events": events, "omittedOrRedirected": omitted, "splitChildren": split_spawned}
    canonical = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload["traceSha256"] = hashlib.sha256(canonical).hexdigest()
    return payload


def frame_nearest(trace: dict[str, Any], at_ms: float) -> dict[str, Any]:
    return min(trace["frames"], key=lambda frame: abs(frame["atMs"] - at_ms))


def reachable_path(pattern: dict[str, Any], trace: dict[str, Any], *, focus: bool) -> dict[str, Any]:
    grid_step = 4.0
    xs = [12.0 + i * grid_step for i in range(int((VIEW_W - 24.0) / grid_step) + 1)]
    speed = 92.0 if focus else 188.0
    player_radius = 2.0 if focus else 3.0
    reachable = {min(range(len(xs)), key=lambda i: abs(xs[i] - VIEW_W / 2.0))}
    path_indices: list[int] = []
    previous_at = 0.0
    minimum_clearance = 999.0
    for frame in trace["frames"]:
        dt = max(0.001, (frame["atMs"] - previous_at) / 1000.0)
        previous_at = frame["atMs"]
        steps = max(1, int(math.ceil(speed * dt / grid_step)))
        hazards = [(b[1], b[2], b[3]) for b in frame["bullets"] if b[4] and abs(b[2] - PLAYER_Y) < 18.0]
        safe_indices = set()
        for i, x in enumerate(xs):
            clearance = min((math.hypot(x - bx, PLAYER_Y - by) - (player_radius + br) for bx, by, br in hazards), default=999.0)
            if clearance > 0.0:
                safe_indices.add(i)
        next_reachable = {i for i in safe_indices if any(abs(i - prior) <= steps for prior in reachable)}
        if not next_reachable:
            return {"pass": False, "focus": focus, "failedAtMs": frame["atMs"], "minimumClearancePx": round(minimum_clearance, 3), "sampleCount": len(path_indices)}
        target = frame["gapCenterX"]
        chosen = min(next_reachable, key=lambda i: abs(xs[i] - target))
        path_indices.append(chosen)
        reachable = next_reachable
        if hazards:
            minimum_clearance = min(minimum_clearance, min(math.hypot(xs[chosen] - bx, PLAYER_Y - by) - (player_radius + br) for bx, by, br in hazards))
    return {
        "pass": True,
        "focus": focus,
        "failedAtMs": None,
        "minimumClearancePx": round(minimum_clearance if minimum_clearance < 999 else pattern["safeGap"]["minimumWidthPx"] / 2.0, 3),
        "sampleCount": len(path_indices),
        "pathHash": hashlib.sha256(json.dumps(path_indices, separators=(",", ":")).encode()).hexdigest(),
    }


def structural_signature(pattern: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    normalized_emitters = []
    for source in pattern["emitters"]:
        speed_keys = source["speedCurve"]["keys"]
        speeds = [entry["pxPerSec"] for entry in speed_keys]
        normalized_emitters.append({
            "geometry": source["geometry"]["type"],
            "countBand": int(source["geometry"]["count"] // 3),
            "spreadBand": int(source["geometry"]["spreadDeg"] // 30),
            "cadenceBand": int(source["cadence"]["intervalMs"] // 160),
            "burstBand": int(source["cadence"]["bursts"] // 3),
            "speedKeyCount": len(speed_keys),
            "speedDirection": "rise" if speeds[-1] > speeds[0] else "fall" if speeds[-1] < speeds[0] else "flat",
            "operators": [entry["operator"] for entry in source["motionStack"]],
            "parameterShapes": [sorted(entry["params"].keys()) for entry in source["motionStack"]],
        })
    normalized = {
        "emitterCount": len(pattern["emitters"]),
        "emitters": normalized_emitters,
        "gap": [pattern["safeGap"]["type"], pattern["safeGap"]["enforcement"], int(pattern["safeGap"]["minimumWidthPx"] // 4)],
        "warning": pattern["warning"]["shape"],
        "timelineRatios": [round(event["atMs"] / pattern["durationMs"], 2) for event in pattern["timeline"]],
        "hasLaser": "laserGeometry" in pattern,
    }
    encoded = json.dumps(normalized, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest(), normalized


def compose_run(
    patterns: list[dict[str, Any]],
    composers: list[dict[str, Any]],
    boss_rigs: list[dict[str, Any]],
    *,
    run_seed: int,
    metrics: dict[str, float],
    room_count: int = 3,
) -> dict[str, Any]:
    """Compile a deterministic non-linear run from behavior metrics."""
    rng = Mulberry32(run_seed)
    by_id = {pattern["id"]: pattern for pattern in patterns}

    def pick_weighted(rows: list[tuple[Any, float]]) -> Any:
        total = sum(max(0.0001, weight) for _, weight in rows)
        cursor = rng.random() * total
        for value, weight in rows:
            cursor -= max(0.0001, weight)
            if cursor <= 0:
                return value
        return rows[-1][0]

    remaining = list(composers)
    chosen_rooms = []
    for _ in range(min(room_count, len(remaining))):
        weighted = []
        for composer in remaining:
            behavior = sum(metrics.get(metric, 0.0) * weight for metric, weight in composer["behaviorMetricWeights"].items())
            weighted.append((composer, 1.0 + behavior))
        selected = pick_weighted(weighted)
        chosen_rooms.append(selected)
        remaining.remove(selected)

    schedule = []
    clock = 0
    last_signature: str | None = None
    for room_ordinal, composer in enumerate(chosen_rooms):
        room_patterns = list(composer["patternPool"])
        intensity_score = max(0.0, min(1.0, (metrics.get("avgFlower", 0.4) + metrics.get("gazeRatio", 0.2) + metrics.get("overrideRatio", 0.0)) / 2.0))
        tier = composer["intensityTiers"][0 if intensity_score < 0.28 else 1 if intensity_score < 0.58 else 2]
        picks = []
        while room_patterns and len(picks) < 3:
            candidates = []
            for entry in room_patterns:
                signature, _ = structural_signature(by_id[entry["patternId"]])
                penalty = 0.15 if signature == last_signature else 1.0
                candidates.append((entry, float(entry["baseWeight"]) * penalty))
            entry = pick_weighted(candidates)
            room_patterns.remove(entry)
            picks.append(entry["patternId"])
            last_signature, _ = structural_signature(by_id[entry["patternId"]])
        schedule.append({"atMs": clock, "event": "room.enter", "room": composer["room"], "roomOrdinal": room_ordinal})
        clock += 1200
        for encounter_ordinal, pattern_id in enumerate(picks):
            pattern = by_id[pattern_id]
            schedule.append({"atMs": clock, "event": "encounter.begin", "patternId": pattern_id, "difficulty": tier["difficulty"], "encounterOrdinal": encounter_ordinal, "seed": run_seed ^ pattern["seed"]["base"] ^ room_ordinal ^ encounter_ordinal})
            clock += int(pattern["durationMs"])
            schedule.append({"atMs": clock, "event": "material.settle", "residue": pattern["residue"]["type"]})
            clock += int(tier["budget"]["restMs"])
        schedule.append({"atMs": clock, "event": "room.withdraw", "room": composer["room"]})
        if room_ordinal < len(chosen_rooms) - 1:
            transition = by_id["transition.room_threshold"]
            schedule.append({"atMs": clock, "event": "transition.begin", "patternId": transition["id"], "seed": run_seed ^ transition["seed"]["base"] ^ room_ordinal})
            clock += int(transition["durationMs"])

    terminal_room = chosen_rooms[-1]["room"] if chosen_rooms else "INFORMATION"
    eligible_bosses = [rig for rig in boss_rigs if rig["room"] == terminal_room]
    boss = eligible_bosses[int(rng.random() * len(eligible_bosses)) % len(eligible_bosses)]
    schedule.append({"atMs": clock, "event": "boss.protocol.begin", "bossId": boss["id"], "resolution": boss["resolution"]["terminal"]})
    for phase in boss["phases"]:
        pattern = by_id[phase["patternId"]]
        schedule.append({"atMs": clock, "event": "boss.phase.begin", "bossId": boss["id"], "phaseId": phase["id"], "patternId": pattern["id"], "seed": run_seed ^ pattern["seed"]["base"]})
        clock += int(pattern["durationMs"])
    schedule.append({"atMs": clock, "event": boss["resolution"]["terminal"], "bossId": boss["id"]})
    dusk = by_id["transition.dusk_settle"]
    schedule.append({"atMs": clock, "event": "dusk.begin", "patternId": dusk["id"], "seed": run_seed ^ dusk["seed"]["base"]})
    clock += int(dusk["durationMs"])
    schedule.append({"atMs": clock, "event": "snapshot.capture"})
    payload = {"runSeed": run_seed, "metrics": metrics, "rooms": [composer["room"] for composer in chosen_rooms], "bossId": boss["id"], "durationMs": clock, "schedule": schedule}
    encoded = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload["traceSha256"] = hashlib.sha256(encoded).hexdigest()
    return payload


def load_patterns(path: Path) -> list[dict[str, Any]]:
    return json.loads(path.read_text(encoding="utf-8"))["patterns"]
