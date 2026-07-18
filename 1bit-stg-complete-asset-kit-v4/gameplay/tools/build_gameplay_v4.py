#!/usr/bin/env python3
"""Build the canonical V4 STG gameplay/choreography manifests.

The generated files intentionally contain no sprite art. They describe behavior,
timing, geometry and material consequence so visuals can be bound later without
changing gameplay authority.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


V4_ROOT = Path(__file__).resolve().parents[2]
MANIFEST_DIR = V4_ROOT / "manifests" / "gameplay"
SCHEMA_DIR = V4_ROOT / "gameplay" / "schemas"
NARRATIVE_BOSS_RESOLUTIONS = V4_ROOT / "narrative" / "boss-resolutions-v4.json"


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def stable_seed(value: str) -> int:
    return int.from_bytes(hashlib.sha256(value.encode("utf-8")).digest()[:4], "little")


def load_canonical_boss_resolutions() -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    """Read the worldbuilding authority instead of duplicating boss facts."""
    payload = json.loads(NARRATIVE_BOSS_RESOLUTIONS.read_text(encoding="utf-8"))
    required = {"id", "resolutionId", "fact", "condition", "playerPossibilities", "terminalEvent", "materialRemainder"}
    rows = payload.get("bosses", [])
    if len(rows) != 8 or any(required - set(row) for row in rows):
        raise ValueError("narrative/boss-resolutions-v4.json is incomplete")
    by_alias = {row["id"]: row for row in rows}
    if len(by_alias) != 8:
        raise ValueError("narrative boss aliases must be unique")
    return by_alias, payload


OPERATORS = [
    {
        "id": "op.linear",
        "name": {"zh": "直线漂移", "en": "Linear drift"},
        "category": "kinematic",
        "metadata": "最小运动事实；不暗示意志。",
        "parameters": {"headingDeg": "number", "speedPxPerSec": "number"},
        "update": "p(t+dt)=p(t)+unit(heading)*speed*dt",
        "determinism": "pure; no random input",
        "collisionNote": "continuous swept circle",
    },
    {
        "id": "op.speed_envelope",
        "name": {"zh": "速度包络", "en": "Speed envelope"},
        "category": "kinematic",
        "metadata": "同一条轨迹上的加速、减速、停顿和重新释放。",
        "parameters": {"keys": "[{atMs,multiplier}]", "interpolation": "step|linear"},
        "update": "speed(t)=baseSpeed*sample(keys,t)",
        "determinism": "piecewise keys on gameplay clock",
        "collisionNote": "sweep subdivides at every envelope key",
    },
    {
        "id": "op.aim_lock",
        "name": {"zh": "取样瞄准", "en": "Sampled aim lock"},
        "category": "perception",
        "metadata": "系统读取的是某个时刻的玩家，不是持续拥有玩家。",
        "parameters": {"lockAtMs": "number", "leadMs": "number", "maxTurnDeg": "number"},
        "update": "heading=angle(position,targetSample(lockAt+lead)) once",
        "determinism": "target comes from authoritative sampled player trace",
        "collisionNote": "telegraph must expose lock instant and cone",
    },
    {
        "id": "op.turn_once",
        "name": {"zh": "单次改判", "en": "One-shot turn"},
        "category": "governance",
        "metadata": "规则只改口一次，因此玩家可以记住它。",
        "parameters": {"atMs": "number", "deltaDeg": "number"},
        "update": "if crossed(atMs) heading+=deltaDeg exactly once",
        "determinism": "crossed-frame idempotent event",
        "collisionNote": "warning includes pre/post-turn swept union",
    },
    {
        "id": "op.orbit_release",
        "name": {"zh": "环绕后释放", "en": "Orbit then release"},
        "category": "kinematic",
        "metadata": "归属感是暂时的；释放后才成为威胁。",
        "parameters": {"radiusPx": "number", "angularDegPerSec": "number", "releaseAtMs": "number", "releaseHeadingDeg": "number"},
        "update": "orbit emitter until release; inherit tangent plus release heading",
        "determinism": "phase derives from spawn ordinal and seed",
        "collisionNote": "orbit and released segments are separate swept primitives",
    },
    {
        "id": "op.limited_homing",
        "name": {"zh": "限幅追踪", "en": "Limited homing"},
        "category": "perception",
        "metadata": "凝视会追随，但其算力和转向能力并不无限。",
        "parameters": {"startMs": "number", "endMs": "number", "maxDegPerSec": "number", "sampleEveryMs": "number"},
        "update": "turnToward(sampledTarget) clamped by maxDegPerSec",
        "determinism": "fixed-rate target samples; no render-frame dependence",
        "collisionNote": "warning cone expands by maximum turn budget",
    },
    {
        "id": "op.split_generation",
        "name": {"zh": "分裂代际", "en": "Split generation"},
        "category": "causality",
        "metadata": "一个信号复制成多条责任链，子代继承来源。",
        "parameters": {"atMs": "number", "children": "integer", "spreadDeg": "number", "speedMultiplier": "number", "maxGeneration": "integer"},
        "update": "parent cancels; spawn symmetric children with inherited sourceId",
        "determinism": "child order is clockwise and stable",
        "collisionNote": "parent collision disables before children arm",
    },
    {
        "id": "op.lateral_wall",
        "name": {"zh": "横向墙列", "en": "Lateral wall"},
        "category": "formation",
        "metadata": "空间被制度化为可通过与不可通过的列。",
        "parameters": {"laneCount": "integer", "openLane": "integer", "driftPxPerSec": "number"},
        "update": "spawn lane lattice excluding declared opening; apply lateral drift",
        "determinism": "lane indexing is left-to-right",
        "collisionNote": "opening width is measured after projectile radius",
    },
    {
        "id": "op.seam_transform",
        "name": {"zh": "缝隙变换", "en": "Seam transform"},
        "category": "topology",
        "metadata": "穿过边界时，同一对象被另一套规则重新解释。",
        "parameters": {"seamX": "number", "mode": "mirror|offset|swap_velocity", "offsetPx": "number"},
        "update": "on first seam crossing apply transform and mark transformed",
        "determinism": "one idempotent crossing per generation",
        "collisionNote": "both sides of discontinuity are sampled on crossing tick",
    },
    {
        "id": "op.history_replay",
        "name": {"zh": "历史路径回放", "en": "History replay"},
        "category": "memory",
        "metadata": "旧路径不是装饰，而是下一次危险的输入。",
        "parameters": {"points": "[[x,y,atMs]]", "delayMs": "number", "mode": "follow|reverse|echo"},
        "update": "sample deterministic polyline after delay",
        "determinism": "points are serialized gameplay data, never inferred from animation",
        "collisionNote": "polyline uses capsule segments",
    },
    {
        "id": "op.dual_clock_gate",
        "name": {"zh": "双时钟闸门", "en": "Dual-clock gate"},
        "category": "time",
        "metadata": "两个系统共享空间却不同意现在是什么时候。",
        "parameters": {"periodAMs": "integer", "periodBMs": "integer", "dutyA": "number", "dutyB": "number", "phaseOffsetMs": "integer"},
        "update": "active when xor(gateA(t),gateB(t)); intersection when both",
        "determinism": "both clocks derive from integer gameplay ticks",
        "collisionNote": "collision state changes only on crossed tick boundaries",
    },
    {
        "id": "op.local_vector_bias",
        "name": {"zh": "局部向量偏置", "en": "Local vector bias"},
        "category": "kinematic",
        "metadata": "偏置由 pattern 自己声明；天气事件绝不能移动弹体。",
        "parameters": {"vectorPxPerSec": "[x,y]", "pulsePeriodMs": "integer", "pulseAmount": "number"},
        "update": "velocity+=fieldVector*(1+pulse(t))*dt",
        "determinism": "pattern-local vector is sampled on fixed gameplay ticks; weather RNG is forbidden",
        "collisionNote": "telegraph uses maximum field displacement",
    },
]


def motion(operator: str, **params: Any) -> dict[str, Any]:
    return {"operator": operator, "params": params}


def emitter(
    emitter_id: str,
    geometry_type: str,
    variant: str,
    count: int,
    base_angle: float,
    spread: float,
    interval_ms: int,
    bursts: int,
    motions: list[dict[str, Any]],
    *,
    anchor: tuple[float, float] = (0.5, 0.16),
    speed: tuple[tuple[int, float], ...] = ((0, 150.0),),
    projectile: str = "bullet.micro.notch_e",
    phase_ms: int = 0,
) -> dict[str, Any]:
    return {
        "id": emitter_id,
        "kind": "projectile",
        "anchor": {"space": "viewport-normalized", "x": anchor[0], "y": anchor[1]},
        "geometry": {
            "type": geometry_type,
            "variant": variant,
            "count": count,
            "baseAngleDeg": base_angle,
            "spreadDeg": spread,
            "ordering": "clockwise-then-source-index",
        },
        "cadence": {
            "startMs": 0,
            "phaseMs": phase_ms,
            "intervalMs": interval_ms,
            "bursts": bursts,
            "intraBurstMs": 0,
        },
        "projectile": {"archetype": projectile, "collisionRadiusPx": 2.0, "armDelayMs": 40},
        "speedCurve": {
            "type": "piecewise-linear",
            "keys": [{"atMs": at, "pxPerSec": value} for at, value in speed],
        },
        "motionStack": motions,
    }


ROOM_RESIDUE = {
    "INFORMATION": "packet_dust",
    "FORCED_ALIGNMENT": "seam_filament",
    "IN_BETWEEN": "misregistration_flake",
    "POLARIZED": "binary_chip",
    "COMMON": "friction_grain",
    "TRANSITION": "threshold_sediment",
    "WEATHER_ECHO": "echo_deposit",
}


def safe_gap(gap_type: str, width: int, *, amplitude: int = 0, period_ms: int = 6000, phase: float = 0.0, lane_x: list[int] | None = None, enforcement: str = "spawn_omission") -> dict[str, Any]:
    return {
        "type": gap_type,
        "minimumWidthPx": width,
        "focusMinimumWidthPx": max(10, width - 8),
        "path": {
            "centerX": 180,
            "amplitudePx": amplitude,
            "periodMs": period_ms,
            "phase": phase,
            "laneX": lane_x or [],
            "maxTravelPxPerSec": 78,
        },
        "enforcement": enforcement,
        "compileRule": "omit, gate, redirect, or visibly cancel any candidate whose swept circle violates the corridor envelope",
        "readability": {"leadMs": 520, "neverColorOnly": True},
    }


def make_pattern(
    pattern_id: str,
    category: str,
    room: str,
    zh: str,
    en: str,
    intent: str,
    duration_ms: int,
    gap: dict[str, Any],
    emitters: list[dict[str, Any]],
    *,
    warning_shape: str,
    residue_type: str | None = None,
    laser_geometry: str | None = None,
    resolution_hook: str | dict[str, Any] | None = None,
) -> dict[str, Any]:
    warning_ms = 540 + (stable_seed(pattern_id) % 241)
    emit_end = max(warning_ms + 800, duration_ms - 700)
    for item in emitters:
        item["cadence"]["startMs"] = warning_ms + item["cadence"].pop("phaseMs")
    pattern = {
        "id": pattern_id,
        "category": category,
        "room": room,
        "name": {"zh": zh, "en": en},
        "intent": intent,
        "durationMs": duration_ms,
        "clock": {
            "authority": "GAMEPLAY",
            "tickHz": 120,
            "eventDispatch": "crossed-time-exactly-once",
            "pausePolicy": "freeze",
            "visualClockSeparated": True,
        },
        "timeline": [
            {"atMs": 0, "event": "warning.begin"},
            {"atMs": warning_ms, "event": "collision.arm"},
            {"atMs": warning_ms, "event": "emit.begin"},
            {"atMs": duration_ms // 2, "event": "pattern.midpoint"},
            {"atMs": emit_end, "event": "emit.end"},
            {"atMs": duration_ms - 420, "event": "residue.commit"},
            {"atMs": duration_ms, "event": "pattern.complete"},
        ],
        "emitters": emitters,
        "safeGap": gap,
        "warning": {
            "durationMs": warning_ms,
            "shape": warning_shape,
            "coversSweptArea": True,
            "collisionEnabled": False,
            "flashIndependent": True,
        },
        "cancel": {
            "triggers": ["pattern_end", "source_withdrawn", "override_void", "room_transition"],
            "mode": "digital_cancel_to_material_residue",
            "collisionOffBeforeVisual": True,
            "eventIdempotent": True,
        },
        "residue": {
            "type": residue_type or ROOM_RESIDUE.get(room, "friction_grain"),
            "lifetimeMs": 2200 + stable_seed(pattern_id + ":residue") % 1800,
            "density": round(0.18 + (stable_seed(pattern_id + ":density") % 27) / 100, 2),
            "inheritsSourceId": True,
            "gameplayCollision": False,
        },
        "difficulty": {
            "EASY": {"countMultiplier": 0.78, "speedMultiplier": 0.88, "cadenceMultiplier": 1.16, "gapDeltaPx": 8},
            "NORMAL": {"countMultiplier": 1.0, "speedMultiplier": 1.0, "cadenceMultiplier": 1.0, "gapDeltaPx": 0},
            "HARD": {"countMultiplier": 1.18, "speedMultiplier": 1.12, "cadenceMultiplier": 0.88, "gapDeltaPx": -4},
        },
        "seed": {
            "algorithm": "mulberry32-v1",
            "base": stable_seed(pattern_id),
            "composition": "runSeed xor base xor encounterOrdinal xor difficultySalt",
            "randomCalls": "emitter-order then burst-order then projectile-order",
        },
        "accessibility": {
            "reducedMotionGameplayParity": True,
            "flashOffGameplayParity": True,
            "telegraphNeverColorOnly": True,
        },
    }
    if laser_geometry:
        pattern["laserGeometry"] = laser_geometry
    if resolution_hook:
        pattern["resolutionHook"] = resolution_hook
    return pattern


def as_weather_echo(pattern: dict[str, Any], visual_source: str) -> dict[str, Any]:
    """Mark a combat encounter that borrows weather language without weather authority."""
    pattern["weatherEchoContract"] = {
        "visualSource": visual_source,
        "schedulingAuthority": "director.encounter.v4",
        "runsParallelToWeather": True,
        "weatherEventCanTrigger": False,
        "weatherEventCanSpawnProjectile": False,
        "weatherEventCanAlterMotion": False,
        "weatherEventCanAlterCollision": False,
        "weatherEventCanAlterSafeGap": False,
        "weatherRngUsed": False,
        "seedAuthority": "pattern.seed only",
    }
    pattern["seed"]["disallowedInputs"] = ["weatherEvent", "weatherSeed", "weatherRng"]
    return pattern


def build_room_patterns() -> list[dict[str, Any]]:
    L = "op.linear"
    S = "op.speed_envelope"
    A = "op.aim_lock"
    T = "op.turn_once"
    O = "op.orbit_release"
    H = "op.limited_homing"
    X = "op.split_generation"
    W = "op.lateral_wall"
    M = "op.seam_transform"
    R = "op.history_replay"
    D = "op.dual_clock_gate"
    F = "op.local_vector_bias"
    P: list[dict[str, Any]] = []

    # INFORMATION — volume is not understanding; every pattern withholds a reply differently.
    P.append(make_pattern("room.information.stale_packet_retry", "ROOM", "INFORMATION", "过期重试", "Stale packet retry", "停住的包重新发送旧方向；玩家读到的是基础设施的惯性。", 9800, safe_gap("static_void", 34), [
        emitter("retry-lines", "line", "missing-columns", 11, 90, 0, 820, 10, [motion(L), motion(S, keys=[{"atMs": 0, "multiplier": 1.0}, {"atMs": 620, "multiplier": 0.0}, {"atMs": 1120, "multiplier": 1.35}], interpolation="step")], speed=((0, 126), (1120, 174))),
    ], warning_shape="broken_packet_columns"))
    P.append(make_pattern("room.information.unanswered_fan", "ROOM", "INFORMATION", "无人回答的扇面", "Unanswered fan", "发射器只在锁定瞬间读取玩家，之后不再听。", 10400, safe_gap("sine_corridor", 32, amplitude=58, period_ms=7200, enforcement="angular_omission"), [
        emitter("question-fan", "fan", "off-center-question", 13, 90, 126, 960, 9, [motion(A, lockAtMs=0, leadMs=0, maxTurnDeg=34), motion(L)], anchor=(0.42, 0.13), speed=((0, 152),)),
        emitter("late-echo", "fan", "late-narrow-echo", 6, 90, 48, 1440, 6, [motion(A, lockAtMs=420, leadMs=-80, maxTurnDeg=18), motion(L)], anchor=(0.67, 0.20), speed=((0, 184),), phase_ms=240),
    ], warning_shape="sampled_aim_cones"))
    P.append(make_pattern("room.information.notification_overflow", "ROOM", "INFORMATION", "通知溢流", "Notification overflow", "数据雨被共同场偏置；更多输入只让流向更难辨认。", 11200, safe_gap("moving_window", 38, amplitude=74, period_ms=8400, enforcement="lane_omission"), [
        emitter("packet-rain", "grid", "staggered-rain", 15, 90, 0, 620, 16, [motion(W, laneCount=15, openLane=7, driftPxPerSec=11), motion(F, vectorPxPerSec=[12, 18], pulsePeriodMs=1800, pulseAmount=0.45), motion(L)], anchor=(0.5, 0.02), speed=((0, 112), (1600, 154)), projectile="bullet.micro.dash"),
    ], warning_shape="falling_lane_projection"))
    P.append(make_pattern("room.information.missing_ack", "ROOM", "INFORMATION", "缺失确认", "Missing acknowledgement", "每个信号分裂，但没有任何一代收到确认。", 10800, safe_gap("pulse_gate", 36, amplitude=24, period_ms=5000, enforcement="phase_gate"), [
        emitter("ack-seeds", "arc", "gapped-ack-arc", 9, 90, 148, 1260, 8, [motion(L), motion(X, atMs=980, children=3, spreadDeg=34, speedMultiplier=0.86, maxGeneration=1)], anchor=(0.5, 0.17), speed=((0, 136),), projectile="bullet.micro.seed"),
    ], warning_shape="branching_causal_tree"))

    # FORCED ALIGNMENT — openings exist, but the system insists on naming them left or right.
    P.append(make_pattern("room.forced.left_right_gate", "ROOM", "FORCED_ALIGNMENT", "左右闸门", "Left/right gate", "墙列轮流承认一侧，中央缝隙始终存在但不舒适。", 10200, safe_gap("seam_corridor", 30, amplitude=10, period_ms=3600, enforcement="lane_omission"), [
        emitter("left-wall", "wall", "left-claim", 8, 90, 0, 920, 10, [motion(W, laneCount=12, openLane=5, driftPxPerSec=18), motion(L)], anchor=(0.24, 0.04), speed=((0, 148),)),
        emitter("right-wall", "wall", "right-claim", 8, 90, 0, 920, 10, [motion(W, laneCount=12, openLane=6, driftPxPerSec=-18), motion(L)], anchor=(0.76, 0.04), speed=((0, 148),), phase_ms=460),
    ], warning_shape="alternating_half_planes"))
    P.append(make_pattern("room.forced.unstable_middle", "ROOM", "FORCED_ALIGNMENT", "不稳定的中间", "Unstable middle", "两侧同时向中间施压；安全不是选边，而是承受缝隙的摆动。", 11600, safe_gap("breathing_seam", 28, amplitude=18, period_ms=4600, enforcement="angular_omission"), [
        emitter("claim-a", "paired_fan", "mirror-left", 10, 68, 82, 1080, 9, [motion(L), motion(T, atMs=880, deltaDeg=16)], anchor=(0.18, 0.12), speed=((0, 142),)),
        emitter("claim-b", "paired_fan", "mirror-right", 10, 112, 82, 1080, 9, [motion(L), motion(T, atMs=880, deltaDeg=-16)], anchor=(0.82, 0.12), speed=((0, 142),), phase_ms=180),
    ], warning_shape="mirrored_turn_union"))
    P.append(make_pattern("room.forced.ballot_shift", "ROOM", "FORCED_ALIGNMENT", "选票换边", "Ballot shift", "双时钟轮流宣布唯一开放侧；切换之前留下可读的空拍。", 12000, safe_gap("lane_switch", 40, period_ms=5200, lane_x=[112, 248], enforcement="phase_gate"), [
        emitter("ballot-a", "line", "clock-a-columns", 10, 90, 0, 700, 15, [motion(D, periodAMs=1400, periodBMs=2100, dutyA=0.52, dutyB=0.38, phaseOffsetMs=0), motion(L)], speed=((0, 158),)),
        emitter("ballot-b", "arc", "clock-b-counterclaim", 7, 90, 92, 1050, 10, [motion(D, periodAMs=2100, periodBMs=1400, dutyA=0.38, dutyB=0.52, phaseOffsetMs=350), motion(L)], anchor=(0.5, 0.14), speed=((0, 176),), phase_ms=350),
    ], warning_shape="two_clock_lane_preview"))
    P.append(make_pattern("room.forced.crack_fall_loop", "ROOM", "FORCED_ALIGNMENT", "裂缝回送", "Crack fall loop", "穿越裂缝的弹体被镜像送回，逃离二元也会进入循环。", 11000, safe_gap("serpentine_seam", 34, amplitude=42, period_ms=7600, enforcement="seam_redirect"), [
        emitter("falling-claims", "fan", "seam-crossing-wide", 12, 90, 164, 980, 10, [motion(L), motion(M, seamX=180, mode="mirror", offsetPx=0)], anchor=(0.5, 0.11), speed=((0, 162),)),
    ], warning_shape="mirrored_seam_trajectory"))

    # IN BETWEEN — two systems remain legible and incompatible.
    P.append(make_pattern("room.in_between.context_switch", "ROOM", "IN_BETWEEN", "语境切换", "Context switch", "A 与 B 对同一位置给出相反转向；玩家学习切换而非统一。", 11400, safe_gap("intersection_track", 32, amplitude=34, period_ms=6400, enforcement="operator_constraint"), [
        emitter("system-a", "fan", "rectilinear-a", 8, 78, 76, 920, 11, [motion(L), motion(T, atMs=740, deltaDeg=22)], anchor=(0.30, 0.12), speed=((0, 146),)),
        emitter("system-b", "fan", "broken-b", 9, 102, 96, 1160, 9, [motion(S, keys=[{"atMs": 0, "multiplier": 0.72}, {"atMs": 520, "multiplier": 1.28}], interpolation="linear"), motion(T, atMs=980, deltaDeg=-28), motion(L)], anchor=(0.70, 0.16), speed=((0, 154),), phase_ms=230),
    ], warning_shape="incompatible_turn_fields"))
    P.append(make_pattern("room.in_between.stable_intersection", "ROOM", "IN_BETWEEN", "稳定交集", "Stable intersection", "双时钟同时打开的短窗口形成可学习的交集。", 12400, safe_gap("dual_clock_intersection", 44, amplitude=16, period_ms=6600, enforcement="phase_gate"), [
        emitter("orthogonal-a", "lattice", "horizontal-clock", 12, 90, 0, 720, 15, [motion(D, periodAMs=1600, periodBMs=2400, dutyA=0.50, dutyB=0.34, phaseOffsetMs=0), motion(L)], anchor=(0.5, 0.03), speed=((0, 140),)),
        emitter("diagonal-b", "lattice", "diagonal-clock", 10, 74, 46, 960, 12, [motion(D, periodAMs=2400, periodBMs=1600, dutyA=0.34, dutyB=0.50, phaseOffsetMs=400), motion(L)], anchor=(0.5, 0.08), speed=((0, 158),), phase_ms=200),
    ], warning_shape="clock_intersection_cells", resolution_hook="intersection_hold_ms"))
    P.append(make_pattern("room.in_between.misregistration_corridor", "ROOM", "IN_BETWEEN", "套印偏差", "Misregistration corridor", "两套近似轨迹错开少量距离，空隙来自误差而非设计善意。", 10600, safe_gap("offset_corridor", 30, amplitude=48, period_ms=8200, enforcement="spawn_omission"), [
        emitter("print-a", "spiral", "clockwise-offset", 8, 90, 220, 840, 11, [motion(O, radiusPx=34, angularDegPerSec=88, releaseAtMs=620, releaseHeadingDeg=88), motion(L)], anchor=(0.43, 0.16), speed=((0, 148),)),
        emitter("print-b", "spiral", "counter-offset", 8, 90, 220, 840, 11, [motion(O, radiusPx=42, angularDegPerSec=-74, releaseAtMs=780, releaseHeadingDeg=92), motion(L)], anchor=(0.57, 0.16), speed=((0, 148),), phase_ms=120),
    ], warning_shape="offset_orbit_capsules"))
    P.append(make_pattern("room.in_between.borrowed_rule", "ROOM", "IN_BETWEEN", "借来的规则", "Borrowed rule", "当前攻击沿上一段玩家路径回放；旧适应在新语境里成为风险。", 11800, safe_gap("history_counterpath", 38, amplitude=52, period_ms=9000, enforcement="operator_constraint"), [
        emitter("path-echo", "history_chain", "serialized-polyline", 14, 90, 0, 1700, 6, [motion(R, points=[[92, 80, 0], [144, 190, 420], [112, 310, 860], [188, 450, 1320], [236, 590, 1780]], delayMs=260, mode="echo")], anchor=(0.5, 0.10), speed=((0, 132),), projectile="bullet.micro.shard"),
    ], warning_shape="future_history_polyline"))

    # POLARIZED — hard timing and binary openings, without pretending the binary is natural.
    P.append(make_pattern("room.polarized.clock_decree", "ROOM", "POLARIZED", "时钟法令", "Clock decree", "四拍只允许开或关，安全窗口来自法令之间的沉默。", 10000, safe_gap("quantized_step", 32, amplitude=54, period_ms=4000, enforcement="phase_gate"), [
        emitter("binary-clock", "shutter", "four-beat-decree", 12, 90, 0, 500, 18, [motion(D, periodAMs=1000, periodBMs=2000, dutyA=0.50, dutyB=0.50, phaseOffsetMs=0), motion(L)], speed=((0, 172),)),
    ], warning_shape="four_beat_shutter"))
    P.append(make_pattern("room.polarized.hard_cut_corridor", "ROOM", "POLARIZED", "硬切通道", "Hard-cut corridor", "墙没有渐变地换边；切换时刻比颜色更重要。", 10800, safe_gap("hard_lane_swap", 42, period_ms=4800, lane_x=[96, 180, 264], enforcement="lane_omission"), [
        emitter("cut-columns", "wall", "three-position-shutter", 14, 90, 0, 800, 12, [motion(W, laneCount=14, openLane=7, driftPxPerSec=0), motion(S, keys=[{"atMs": 0, "multiplier": 1.0}, {"atMs": 420, "multiplier": 0.0}, {"atMs": 680, "multiplier": 1.0}], interpolation="step"), motion(L)], anchor=(0.5, 0.02), speed=((0, 164),)),
    ], warning_shape="hard_edge_lane_map"))
    P.append(make_pattern("room.polarized.alternating_verdict", "ROOM", "POLARIZED", "交替裁决", "Alternating verdict", "每次裁决只转一次，上一轮正确的方向下一轮失效。", 11600, safe_gap("alternating_wedge", 34, amplitude=64, period_ms=5600, enforcement="angular_omission"), [
        emitter("verdict-a", "arc", "even-verdict", 11, 76, 118, 1120, 9, [motion(L), motion(T, atMs=640, deltaDeg=32)], anchor=(0.28, 0.13), speed=((0, 156),)),
        emitter("verdict-b", "arc", "odd-verdict", 11, 104, 118, 1120, 9, [motion(L), motion(T, atMs=940, deltaDeg=-32)], anchor=(0.72, 0.13), speed=((0, 178),), phase_ms=560),
    ], warning_shape="alternating_turn_wedges"))
    P.append(make_pattern("room.polarized.no_dusk_grid", "ROOM", "POLARIZED", "没有黄昏的网格", "No-dusk grid", "亮暗不经过过渡；网格只在离散时刻重写。", 12200, safe_gap("binary_cross", 40, amplitude=20, period_ms=6000, enforcement="phase_gate"), [
        emitter("vertical-law", "grid", "vertical-binary", 9, 90, 0, 750, 14, [motion(D, periodAMs=1500, periodBMs=3000, dutyA=0.48, dutyB=0.48, phaseOffsetMs=0), motion(L)], speed=((0, 150),)),
        emitter("diagonal-law", "cross", "diagonal-binary", 6, 68, 44, 1500, 7, [motion(D, periodAMs=3000, periodBMs=1500, dutyA=0.48, dutyB=0.48, phaseOffsetMs=750), motion(L)], anchor=(0.5, 0.18), speed=((0, 188),), phase_ms=375),
    ], warning_shape="binary_grid_union", resolution_hook="no_dusk_clock_ticks"))
    return P


def build_common_patterns() -> list[dict[str, Any]]:
    L, S, A, H, F, W, M, R = "op.linear", "op.speed_envelope", "op.aim_lock", "op.limited_homing", "op.local_vector_bias", "op.lateral_wall", "op.seam_transform", "op.history_replay"
    return [
        make_pattern("common.graze_calibration", "COMMON", "COMMON", "擦边校准", "Graze calibration", "低密度轨迹教玩家读取实体半径；每颗弹只产生一次证据。", 7200, safe_gap("training_sine", 50, amplitude=36, period_ms=6800), [
            emitter("calibration-stream", "fan", "single-evidence-stream", 7, 90, 72, 900, 7, [motion(L)], speed=((0, 118),)),
        ], warning_shape="sparse_path_ticks", residue_type="evidence_grain"),
        make_pattern("common.eye_acquisition", "COMMON", "COMMON", "眼睛取样", "Eye acquisition", "凝视先宣告读取扇区，再进行有限追踪；它不是瞬发惩罚。", 8600, safe_gap("gaze_shadow", 42, amplitude=30, period_ms=7400, enforcement="angular_omission"), [
            emitter("gaze-probes", "arc", "reading-probes", 8, 90, 96, 1180, 7, [motion(A, lockAtMs=360, leadMs=80, maxTurnDeg=24), motion(H, startMs=520, endMs=1380, maxDegPerSec=22, sampleEveryMs=120), motion(L)], anchor=(0.5, 0.08), speed=((0, 138),)),
        ], warning_shape="gaze_reading_cone", residue_type="readout_dust"),
        make_pattern("transition.room_threshold", "TRANSITION", "TRANSITION", "房间阈值", "Room threshold", "旧房间的列与新房间的角度短暂重叠，之后旧规则撤回。", 7800, safe_gap("threshold_bridge", 46, amplitude=28, period_ms=7000, enforcement="phase_gate"), [
            emitter("departing-rule", "line", "old-room-columns", 8, 90, 0, 1000, 6, [motion(S, keys=[{"atMs": 0, "multiplier": 1.0}, {"atMs": 1200, "multiplier": 0.55}], interpolation="linear"), motion(L)], speed=((0, 128),)),
            emitter("arriving-rule", "fan", "new-room-angle", 6, 90, 68, 1000, 5, [motion(S, keys=[{"atMs": 0, "multiplier": 0.55}, {"atMs": 1200, "multiplier": 1.0}], interpolation="linear"), motion(L)], anchor=(0.5, 0.14), speed=((0, 146),), phase_ms=500),
        ], warning_shape="overlap_threshold_map"),
        as_weather_echo(make_pattern("encounter.weather_echo.rain_packets", "WEATHER_ECHO", "COMMON", "雨的回声", "Rain echo encounter", "独立遭遇借用雨的下落语汇；真实天气不能生成、移动或重定向这些弹体。", 9400, safe_gap("rain_lee", 38, amplitude=46, period_ms=8200, enforcement="lane_omission"), [
            emitter("rain", "grid", "uneven-droplets", 13, 90, 0, 540, 15, [motion(F, vectorPxPerSec=[8, 30], pulsePeriodMs=2100, pulseAmount=0.35), motion(L)], anchor=(0.5, 0.0), speed=((0, 126),), projectile="bullet.micro.dash"),
        ], warning_shape="rainfall_projection", residue_type="wet_packet_pulp"), "RAIN"),
        as_weather_echo(make_pattern("encounter.weather_echo.ash_memory", "WEATHER_ECHO", "COMMON", "灰烬的回声", "Ash echo encounter", "独立遭遇沿序列化路径反向回放；真实灰烬天气仅表现环境，不提供轨迹输入。", 10200, safe_gap("ash_wake", 44, amplitude=38, period_ms=9200, enforcement="operator_constraint"), [
            emitter("ash-echo", "history_chain", "reverse-short-trace", 10, 90, 0, 1600, 6, [motion(R, points=[[180, 70, 0], [132, 190, 500], [214, 330, 1000], [166, 470, 1500], [196, 600, 1900]], delayMs=420, mode="reverse")], anchor=(0.5, 0.08), speed=((0, 94),), projectile="bullet.micro.shard"),
        ], warning_shape="reverse_trace_preview", residue_type="ash_fiber"), "ASH"),
        as_weather_echo(make_pattern("encounter.weather_echo.wind_bias", "WEATHER_ECHO", "COMMON", "风的回声", "Wind echo encounter", "局部向量偏置在 pattern 编译时固定；真实风天气不能改写任何弹体或安全通道。", 9600, safe_gap("wind_lee", 36, amplitude=70, period_ms=8800, enforcement="spawn_omission"), [
            emitter("wind-seeds", "arc", "advected-seeds", 10, 90, 134, 920, 9, [motion(F, vectorPxPerSec=[34, 4], pulsePeriodMs=1600, pulseAmount=0.60), motion(L)], anchor=(0.42, 0.12), speed=((0, 144),), projectile="bullet.micro.seed"),
        ], warning_shape="maximum_advection_envelope", residue_type="wind_polished_grain"), "WIND"),
        make_pattern("transition.dusk_settle", "TRANSITION", "TRANSITION", "黄昏沉降", "Dusk settle", "攻击停止生成，仍在场的数字对象沉降为材料记录。", 8200, safe_gap("settling_center", 54, amplitude=12, period_ms=8000, enforcement="rule_clip_with_residue"), [
            emitter("settling-field", "grid", "decreasing-density", 12, 90, 0, 860, 7, [motion(S, keys=[{"atMs": 0, "multiplier": 1.0}, {"atMs": 1200, "multiplier": 0.42}, {"atMs": 2100, "multiplier": 0.0}], interpolation="linear"), motion(L)], speed=((0, 112),)),
        ], warning_shape="descending_settlement_band", residue_type="dusk_sediment", resolution_hook="snapshot_capture_ready"),
        make_pattern("transition.override_void", "TRANSITION", "TRANSITION", "局部负空间", "Local override void", "定向 Void 只取消穿过其扇区的规则，取消位置写入 scar。", 7600, safe_gap("directional_override", 48, amplitude=34, period_ms=7600, enforcement="rule_clip_with_residue"), [
            emitter("rule-field", "ring", "scar-breakable-ring", 16, 90, 300, 1700, 4, [motion(L), motion(M, seamX=180, mode="offset", offsetPx=22)], anchor=(0.5, 0.20), speed=((0, 132),)),
        ], warning_shape="directional_void_wedge", residue_type="override_scar", resolution_hook="scar_coordinate_commit"),
    ]


BOSSES = [
    ("absent_receiver", "INFORMATION", "缺席的接收者", "Absent Receiver", "laser.broken_packet_polyline"),
    ("unanswering_feed", "INFORMATION", "无回应的信息流", "Unanswering Feed", "laser.scrolling_comb"),
    ("one_sun_one_rule", "FORCED_ALIGNMENT", "一个太阳一种规则", "One Sun, One Rule", "laser.single_decree_sweep"),
    ("two_claims", "FORCED_ALIGNMENT", "两份宣称", "Two Claims", "laser.bifurcating_seam"),
    ("misreader", "IN_BETWEEN", "误读者", "Misreader", "laser.misread_bezier"),
    ("misregistered_twin_moons", "IN_BETWEEN", "套印错位的双月", "Misregistered Twin Moons", "laser.twin_offset_arcs"),
    ("no_dusk", "POLARIZED", "没有黄昏", "No Dusk", "laser.binary_shutter_grid"),
    ("absolute_reader", "POLARIZED", "绝对读取者", "Absolute Reader", "laser.broken_iris_cone"),
]


def build_boss_patterns(canonical_resolutions: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    op_sets = [
        ([motion("op.linear"), motion("op.speed_envelope", keys=[{"atMs": 0, "multiplier": 1.0}, {"atMs": 760, "multiplier": 0.0}, {"atMs": 1240, "multiplier": 1.25}], interpolation="step")], "arc", "outbound-retry", "static_void"),
        ([motion("op.history_replay", points=[[84, 90, 0], [150, 220, 520], [116, 360, 980], [220, 520, 1500]], delayMs=320, mode="echo")], "history_chain", "retry-history", "history_counterpath"),
        ([motion("op.split_generation", atMs=920, children=3, spreadDeg=28, speedMultiplier=0.88, maxGeneration=1), motion("op.linear")], "ring", "terminal-branch", "pulse_gate"),
        ([motion("op.lateral_wall", laneCount=13, openLane=6, driftPxPerSec=9), motion("op.linear")], "wall", "feed-columns", "moving_window"),
        ([motion("op.local_vector_bias", vectorPxPerSec=[18, 8], pulsePeriodMs=1700, pulseAmount=0.45), motion("op.linear")], "grid", "scroll-drift", "rain_lee"),
        ([motion("op.aim_lock", lockAtMs=420, leadMs=80, maxTurnDeg=26), motion("op.limited_homing", startMs=600, endMs=1400, maxDegPerSec=18, sampleEveryMs=120), motion("op.linear")], "fan", "feed-lock", "gaze_shadow"),
        ([motion("op.turn_once", atMs=780, deltaDeg=30), motion("op.linear")], "fan", "single-decree", "alternating_wedge"),
        ([motion("op.dual_clock_gate", periodAMs=1500, periodBMs=2250, dutyA=0.5, dutyB=0.36, phaseOffsetMs=0), motion("op.linear")], "shutter", "rule-clock", "quantized_step"),
        ([motion("op.speed_envelope", keys=[{"atMs": 0, "multiplier": 0.7}, {"atMs": 720, "multiplier": 1.35}], interpolation="linear"), motion("op.turn_once", atMs=1080, deltaDeg=-24), motion("op.linear")], "arc", "rule-shadow", "hard_lane_swap"),
        ([motion("op.seam_transform", seamX=180, mode="mirror", offsetPx=0), motion("op.linear")], "paired_fan", "competing-claims", "seam_corridor"),
        ([motion("op.dual_clock_gate", periodAMs=1800, periodBMs=2400, dutyA=0.46, dutyB=0.42, phaseOffsetMs=300), motion("op.turn_once", atMs=860, deltaDeg=18), motion("op.linear")], "lattice", "seam-tax", "breathing_seam"),
        ([motion("op.seam_transform", seamX=180, mode="swap_velocity", offsetPx=0), motion("op.speed_envelope", keys=[{"atMs": 0, "multiplier": 1.0}, {"atMs": 900, "multiplier": 0.56}], interpolation="linear"), motion("op.linear")], "cross", "abstention-route", "serpentine_seam"),
        ([motion("op.aim_lock", lockAtMs=0, leadMs=-120, maxTurnDeg=38), motion("op.linear")], "fan", "false-read", "offset_corridor"),
        ([motion("op.aim_lock", lockAtMs=720, leadMs=180, maxTurnDeg=26), motion("op.turn_once", atMs=1180, deltaDeg=22), motion("op.linear")], "arc", "late-correction", "intersection_track"),
        ([motion("op.dual_clock_gate", periodAMs=1600, periodBMs=2400, dutyA=0.5, dutyB=0.34, phaseOffsetMs=400), motion("op.linear")], "lattice", "stable-read-window", "dual_clock_intersection"),
        ([motion("op.orbit_release", radiusPx=38, angularDegPerSec=84, releaseAtMs=680, releaseHeadingDeg=86), motion("op.linear")], "spiral", "moon-a", "offset_corridor"),
        ([motion("op.orbit_release", radiusPx=48, angularDegPerSec=-72, releaseAtMs=840, releaseHeadingDeg=94), motion("op.dual_clock_gate", periodAMs=1750, periodBMs=2450, dutyA=0.44, dutyB=0.38, phaseOffsetMs=350), motion("op.linear")], "paired_fan", "moon-phase-drift", "dual_clock_intersection"),
        ([motion("op.orbit_release", radiusPx=56, angularDegPerSec=60, releaseAtMs=960, releaseHeadingDeg=90), motion("op.seam_transform", seamX=180, mode="offset", offsetPx=26), motion("op.linear")], "ring", "common-interval", "binary_cross"),
        ([motion("op.dual_clock_gate", periodAMs=1000, periodBMs=2000, dutyA=0.5, dutyB=0.5, phaseOffsetMs=0), motion("op.linear")], "grid", "hard-clock", "quantized_step"),
        ([motion("op.lateral_wall", laneCount=15, openLane=7, driftPxPerSec=0), motion("op.speed_envelope", keys=[{"atMs": 0, "multiplier": 1.0}, {"atMs": 520, "multiplier": 0.0}, {"atMs": 760, "multiplier": 1.0}], interpolation="step"), motion("op.linear")], "wall", "sunset-denied", "hard_lane_swap"),
        ([motion("op.dual_clock_gate", periodAMs=1250, periodBMs=2500, dutyA=0.42, dutyB=0.42, phaseOffsetMs=625), motion("op.split_generation", atMs=1000, children=2, spreadDeg=40, speedMultiplier=0.92, maxGeneration=1), motion("op.linear")], "shutter", "count-without-evening", "binary_cross"),
        ([motion("op.aim_lock", lockAtMs=260, leadMs=120, maxTurnDeg=42), motion("op.limited_homing", startMs=420, endMs=1220, maxDegPerSec=24, sampleEveryMs=100), motion("op.linear")], "arc", "field-scan", "gaze_shadow"),
        ([motion("op.history_replay", points=[[70, 96, 0], [152, 210, 420], [106, 360, 900], [236, 520, 1440]], delayMs=180, mode="follow"), motion("op.split_generation", atMs=1120, children=2, spreadDeg=24, speedMultiplier=0.84, maxGeneration=1)], "history_chain", "flower-clamp-net", "history_counterpath"),
        ([motion("op.seam_transform", seamX=180, mode="offset", offsetPx=32), motion("op.local_vector_bias", vectorPxPerSec=[-12, 6], pulsePeriodMs=1300, pulseAmount=0.5), motion("op.linear")], "broken_ring", "incomplete-iris", "directional_override"),
    ]
    phase_names = [
        ("询问", "Query"), ("重试", "Retry"), ("无确认", "No acknowledgement"),
        ("滚动", "Scroll"), ("滞留", "Stale accumulation"), ("饱和", "Saturation"),
        ("唯一法令", "Single decree"), ("服从时钟", "Compliance clock"), ("规则阴影", "Rule shadow"),
        ("竞争宣称", "Competing claims"), ("缝隙税", "Seam tax"), ("弃权通道", "Abstention passage"),
        ("错误锁定", "False lock"), ("延迟修正", "Delayed correction"), ("稳定交集", "Stable intersection"),
        ("第一轮月", "First orbit"), ("相位漂移", "Phase drift"), ("共同间隔", "Common interval"),
        ("硬时钟", "Hard clock"), ("拒绝黄昏", "Dusk denied"), ("继续计数", "Counting continues"),
        ("场扫描", "Field scan"), ("花的钳制网", "Flower clamp net"), ("不完整读取", "Incomplete reading"),
    ]
    patterns: list[dict[str, Any]] = []
    for boss_index, boss in enumerate(BOSSES):
        boss_id, room, zh_boss, en_boss, laser_id = boss
        resolution = canonical_resolutions[boss_id]
        for phase in range(3):
            index = boss_index * 3 + phase
            motions, geom, variant, gap_type = op_sets[index]
            phase_zh, phase_en = phase_names[index]
            count = 7 + (index % 8)
            interval = 720 + (index * 73) % 620
            duration = 10800 + (index % 5) * 700
            gap_width = 30 + (index % 5) * 3
            pattern_id = f"boss.{boss_id}.phase{phase + 1}"
            e = emitter(
                f"{boss_id}-p{phase + 1}-primary",
                geom,
                variant,
                count,
                90 + ((index % 3) - 1) * 8,
                72 + (index * 17) % 170,
                interval,
                max(6, (duration - 1500) // interval),
                motions,
                anchor=(0.34 + 0.16 * (phase % 3), 0.10 + 0.035 * phase),
                speed=((0, 142 + (index % 6) * 8),),
                projectile=["bullet.micro.notch_e", "bullet.micro.seed", "bullet.micro.shard"][phase],
            )
            emitters = [e]
            if (boss_index + phase) % 2 == 1:
                emitters.append(emitter(
                    f"{boss_id}-p{phase + 1}-counter",
                    "arc" if geom != "arc" else "line",
                    f"counter-{variant}",
                    max(4, count // 2),
                    90 - ((index % 3) - 1) * 10,
                    48 + (index % 4) * 18,
                    interval * 2,
                    max(3, (duration - 1800) // (interval * 2)),
                    [motion("op.linear")],
                    anchor=(0.66 - 0.12 * (phase % 2), 0.18),
                    speed=((0, 126 + phase * 14),),
                    phase_ms=interval // 2,
                ))
            patterns.append(make_pattern(
                pattern_id,
                "BOSS",
                room,
                f"{zh_boss}：{phase_zh}",
                f"{en_boss}: {phase_en}",
                f"阶段 {phase + 1} 将治理机制转译为可学习的时空行为；最终阶段连接世界观事实 {resolution['resolutionId']} / {resolution['terminalEvent']}，不是统一死亡。",
                duration,
                safe_gap(gap_type, gap_width, amplitude=18 + (index % 5) * 10, period_ms=5200 + (index % 4) * 800, enforcement=["spawn_omission", "phase_gate", "operator_constraint", "rule_clip_with_residue"][index % 4]),
                emitters,
                warning_shape=f"{variant}_swept_union",
                residue_type=f"{boss_id}_material_trace",
                laser_geometry=laser_id,
                resolution_hook={
                    "type": "canonical_boss_resolution" if phase == 2 else "phase_evidence",
                    "canonicalBossId": f"boss.{boss_id}",
                    "narrativeAlias": boss_id,
                    "resolutionId": resolution["resolutionId"],
                    "condition": resolution["condition"] if phase == 2 else f"{boss_id}.phaseEvidence>={phase + 1}",
                    "terminalEvent": resolution["terminalEvent"] if phase == 2 else None,
                },
            ))
    return patterns


def build_enemy_archetypes(pattern_ids: set[str]) -> dict[str, Any]:
    roles = [
        ("packet_sprayer", "数据包喷洒者", "orphan_packet", "retry_node", "room.information.stale_packet_retry", "room.information.unanswered_fan"),
        ("seam_warden", "缝隙看守", "left_gate", "right_gate", "room.forced.left_right_gate", "room.forced.unstable_middle"),
        ("clock_divider", "时钟分配器", "phase_a", "phase_b", "room.forced.ballot_shift", "room.polarized.clock_decree"),
        ("context_misreader", "语境误读者", "system_a", "system_b", "room.in_between.context_switch", "room.in_between.misregistration_corridor"),
        ("gaze_proxy", "凝视代理", "probe", "clamp_relay", "common.eye_acquisition", "room.in_between.stable_intersection"),
        ("residue_hauler", "残留搬运者", "cable_carrier", "ash_maker", "encounter.weather_echo.rain_packets", "encounter.weather_echo.ash_memory"),
        ("orbit_broker", "轨道经纪人", "twin_orbit", "release_broker", "room.in_between.misregistration_corridor", "encounter.weather_echo.wind_bias"),
        ("scar_examiner", "伤痕检验者", "trace_reader", "void_filler", "room.in_between.borrowed_rule", "transition.override_void"),
    ]
    entry_types = ["cubic_top", "side_hook", "seam_rise", "packet_drop", "paired_cross", "slow_material_lift", "orbit_in", "history_retrace"]
    movement_types = ["hover_saw", "lane_patrol", "clock_step", "context_swap", "sample_and_hold", "weighted_drift", "elliptic_orbit", "scar_follow"]
    exit_types = ["top_withdraw", "side_release", "seam_sink", "packet_timeout", "reverse_entry", "drop_material", "tangent_exit", "burn_in_place"]
    enemies: list[dict[str, Any]] = []
    for role_index, (role, zh, variant_a, variant_b, pattern_a, pattern_b) in enumerate(roles):
        for variant_index, (variant, pattern_id) in enumerate(((variant_a, pattern_a), (variant_b, pattern_b))):
            assert pattern_id in pattern_ids
            enemy_id = f"enemy.{role}.{variant}"
            side = -1 if variant_index == 0 else 1
            enemies.append({
                "id": enemy_id,
                "role": role,
                "variant": variant,
                "name": {"zh": f"{zh}·{variant_index + 1}", "en": f"{role.replace('_', ' ').title()} {variant_index + 1}"},
                "entry": {
                    "type": entry_types[role_index],
                    "durationMs": 900 + role_index * 90 + variant_index * 120,
                    "controlPoints": [[0.5 + side * 0.42, -0.08], [0.5 - side * 0.18, 0.06], [0.5 + side * 0.10, 0.18]],
                    "collisionArmsAt": 0.72,
                },
                "movement": {
                    "type": movement_types[role_index],
                    "durationMs": 5200 + role_index * 260,
                    "amplitudePx": [26 + role_index * 4, 12 + variant_index * 8],
                    "periodMs": 1800 + role_index * 230 + variant_index * 310,
                    "roomRuleResponsive": True,
                },
                "formation": {
                    "family": ["staggered_column", "mirrored_pair", "clock_quartet", "incompatible_pair"][role_index % 4],
                    "slot": variant_index,
                    "minimumSeparationPx": 42 + role_index * 2,
                    "maxSimultaneous": 2 + role_index % 3,
                },
                "cadence": {
                    "patternId": pattern_id,
                    "warmupMs": 620 + role_index * 40,
                    "repeatEveryMs": 3100 + role_index * 180 + variant_index * 260,
                    "maxRepeats": 2 + (role_index + variant_index) % 3,
                    "interruptibleOnWithdrawal": True,
                },
                "exit": {
                    "type": exit_types[role_index],
                    "condition": "cadence_complete_or_room_withdrawal",
                    "durationMs": 760 + role_index * 70,
                    "collisionDisarmsAt": 0.0,
                },
                "telegraph": {
                    "durationMs": 480 + role_index * 35,
                    "shape": ["anchor_ticks", "lane_notches", "clock_pips", "context_brackets"][role_index % 4],
                    "coversEntryAndFirstBurst": True,
                    "neverColorOnly": True,
                },
                "materialResidue": {
                    "type": ["packet_pulp", "seam_wire", "clock_chip", "misprint", "readout_film", "cable_fiber", "bearing_dust", "scar_rubbing"][role_index],
                    "lifetimeMs": 2600 + role_index * 310,
                    "quantity": 2 + variant_index + role_index % 3,
                    "sourceId": enemy_id,
                    "collision": False,
                },
                "collision": {"shape": "ellipse", "radiusPx": [11 + role_index % 3, 9 + variant_index], "visualAlphaIgnored": True},
            })
    return {"schemaVersion": "4.0.0", "$schema": "../../gameplay/schemas/enemies-v4.schema.json", "mechanicalRoleCount": len(roles), "enemies": enemies}


def build_lasers() -> dict[str, Any]:
    definitions = [
        ("laser.broken_packet_polyline", "absent_receiver", "broken_polyline", {"points": [[0.5, 0.14], [0.30, 0.34], [0.58, 0.52], [0.42, 0.78], [0.54, 1.02]], "missingSegment": 2}, "polyline_capsules", "packet_gap"),
        ("laser.scrolling_comb", "unanswering_feed", "scrolling_comb", {"spine": [[0.18, 0.0], [0.18, 1.0]], "teeth": 7, "toothLengthPx": 116, "scrollPxPerSec": 42}, "capsule_union", "comb_slot"),
        ("laser.single_decree_sweep", "one_sun_one_rule", "half_plane_sweep", {"pivot": [0.5, 0.15], "startDeg": 42, "endDeg": 138, "beamWidthPx": 13}, "swept_segment", "counter_sweep_lane"),
        ("laser.bifurcating_seam", "two_claims", "bifurcating_y", {"root": [0.5, 0.12], "fork": [0.5, 0.40], "ends": [[0.12, 1.02], [0.88, 1.02]], "branchWidthPx": 10}, "branched_capsules", "central_seam"),
        ("laser.misread_bezier", "misreader", "quadratic_bezier", {"p0": [0.18, 0.08], "p1": [0.86, 0.42], "p2": [0.28, 1.04], "widthPx": 11}, "sampled_bezier_capsules", "curve_inside"),
        ("laser.twin_offset_arcs", "misregistered_twin_moons", "twin_arcs", {"centers": [[0.43, 0.38], [0.57, 0.42]], "radiiPx": [126, 148], "startDeg": 18, "endDeg": 162, "widthPx": 9}, "arc_capsule_union", "arc_intersection"),
        ("laser.binary_shutter_grid", "no_dusk", "orthogonal_shutter_grid", {"verticalX": [0.22, 0.50, 0.78], "horizontalY": [0.36, 0.62], "phasePeriodMs": 1200, "widthPx": 8}, "timed_segment_grid", "open_cell"),
        ("laser.broken_iris_cone", "absolute_reader", "broken_iris_cone", {"origin": [0.5, 0.10], "innerRadiusPx": 36, "outerRadiusPx": 620, "startDeg": 58, "endDeg": 122, "missingSectorDeg": 18}, "annular_sector_minus_wedge", "scar_wedge"),
    ]
    lasers = []
    for i, (laser_id, boss_id, geometry_type, params, primitive, opening) in enumerate(definitions):
        lasers.append({
            "id": laser_id,
            "bossId": f"boss.{boss_id}",
            "aliases": [boss_id],
            "narrativeAlias": boss_id,
            "geometry": {"type": geometry_type, "parameters": params, "coordinateSpace": "viewport-normalized-plus-logical-px"},
            "lifecycle": {
                "states": ["idle", "telegraph", "charge", "grow", "live", "shutdown", "residue", "idle"],
                "timingMs": {"telegraph": 680 + i * 45, "charge": 180 + i * 10, "grow": 140 + i * 8, "live": 720 + i * 55, "shutdown": 180, "residue": 520 + i * 35},
                "collisionEnable": "live.enter",
                "collisionDisable": "shutdown.enter",
                "largeDeltaDispatch": "all-crossed-events-once",
            },
            "collision": {"primitive": primitive, "sampleTolerancePx": 1.5, "authority": "gameplay", "visualAlphaIgnored": True},
            "warning": {"geometry": "exact_swept_union", "leadMs": 680 + i * 45, "coversGrowth": True, "flashIndependent": True},
            "safeOpening": {"type": opening, "minimumWidthPx": 22 + (i % 4) * 4, "includedInWarning": True},
            "cancel": {"collisionOffBeforeVisual": True, "toResidue": f"{boss_id}_laser_slag"},
            "reducedMotion": {"gameplayTimingUnchanged": True, "replaceScrollWithPhaseSteps": True},
        })
    return {"schemaVersion": "4.0.0", "$schema": "../../gameplay/schemas/lasers-v4.schema.json", "lasers": lasers}


def build_boss_rigs(
    pattern_ids: set[str],
    laser_ids: set[str],
    canonical_resolutions: dict[str, dict[str, Any]],
    canonical_payload: dict[str, Any],
) -> dict[str, Any]:
    rigs = []
    emitter_layouts = [
        [[0.50, 0.52]],
        [[0.32, 0.48], [0.68, 0.48]],
        [[0.50, 0.42], [0.22, 0.58]],
        [[0.24, 0.48], [0.76, 0.48], [0.50, 0.64]],
        [[0.42, 0.44], [0.64, 0.58]],
        [[0.30, 0.52], [0.70, 0.52]],
        [[0.50, 0.38], [0.18, 0.62], [0.82, 0.62]],
        [[0.50, 0.50], [0.34, 0.66], [0.66, 0.66]],
    ]
    final_spatial_laws = [
        "three_signal_windows_close_without_acknowledgement",
        "feed_queue_exhausts_without_reciprocal_channel",
        "override_scar_crosses_single_shadow_correction_line",
        "player_holds_overlap_while_both_claims_remain_active",
        "three_read_predictions_disagree_with_following_movement",
        "seam_crossed_during_clock_disagreement_without_authority",
        "binary_witness_window_closes_without_twilight",
        "read_ledger_closes_with_unclassified_interval",
    ]
    for i, (boss_id, room, zh, en, laser_id) in enumerate(BOSSES):
        assert laser_id in laser_ids
        canonical = canonical_resolutions[boss_id]
        phase_ids = [f"boss.{boss_id}.phase{n}" for n in range(1, 4)]
        assert all(pid in pattern_ids for pid in phase_ids)
        emitters = [{"id": f"emitter-{n + 1}", "anchor": anchor, "rotationAuthority": "gameplay"} for n, anchor in enumerate(emitter_layouts[i])]
        rigs.append({
            "id": f"boss.{boss_id}",
            "aliases": [boss_id],
            "narrativeAlias": boss_id,
            "name": {"zh": zh, "en": en},
            "room": room,
            "weakpoint": {
                "type": ["absent_socket", "feed_break", "single_aperture", "seam_joint", "reading_cursor", "shared_overlap", "clock_gap", "broken_iris"][i],
                "anchor": [0.50 + ((i % 3) - 1) * 0.08, 0.48 + (i % 2) * 0.07],
                "radiusPx": 9 + i % 4,
                "openConditions": ["telegraph_complete", "phase_rule_exposed"],
                "damageIsOptionalForResolution": True,
            },
            "emitters": emitters,
            "phases": [
                {"id": "observe", "patternId": phase_ids[0], "entryCondition": "encounter.begin", "exitCondition": f"{boss_id}.evidence>=1", "laserGeometry": None, "spatialLaw": ["unreturned_packets", "scroll_only_down", "one_open_half", "two_claimed_halves", "sample_then_misread", "offset_orbits", "binary_ticks", "reading_cone"][i]},
                {"id": "enforce", "patternId": phase_ids[1], "entryCondition": "observe.exit", "exitCondition": f"{boss_id}.evidence>=2", "laserGeometry": laser_id, "spatialLaw": ["retry_old_direction", "feed_has_no_reply", "middle_is_unclassified", "seam_is_contested", "correction_is_late", "clocks_disagree", "no_interpolation", "gaze_clamps_flower"][i]},
                {"id": "fail_to_totalize", "patternId": phase_ids[2], "entryCondition": "enforce.exit", "exitCondition": canonical["terminalEvent"], "resolutionCondition": canonical["condition"], "laserGeometry": laser_id, "spatialLaw": final_spatial_laws[i]},
            ],
            "rupture": {
                "event": canonical["terminalEvent"],
                "mode": "protocol_withdrawal_not_death",
                "digital": "body rule layers disable in dependency order",
                "material": canonical["materialRemainder"],
                "collisionOffBeforeVisual": True,
            },
            "materialResidue": {"type": f"{boss_id}_body_trace", "canonicalRemainder": canonical["materialRemainder"], "persistsToSnapshot": True, "crossRunEligible": boss_id in {"two_claims", "absolute_reader"}, "collision": False},
            "resolution": {
                "source": "../../narrative/boss-resolutions-v4.json",
                "canonicalBossId": f"boss.{boss_id}",
                "narrativeAlias": boss_id,
                "resolutionId": canonical["resolutionId"],
                "metric": canonical["condition"],
                "condition": canonical["condition"],
                "fact": canonical["fact"],
                "terminal": canonical["terminalEvent"],
                "terminalEvent": canonical["terminalEvent"],
                "materialRemainder": canonical["materialRemainder"],
                "playerPossibilities": canonical["playerPossibilities"],
            },
        })
    return {
        "schemaVersion": "4.0.0",
        "$schema": "../../gameplay/schemas/boss-rigs-v4.schema.json",
        "canonicalResolutionSource": "../../narrative/boss-resolutions-v4.json",
        "sharedFallbackResolution": canonical_payload["sharedFallbackResolution"],
        "ruptureContract": canonical_payload["ruptureContract"],
        "rigs": rigs,
    }


def build_composers(pattern_ids: set[str]) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    room_defs = {
        "INFORMATION": ["room.information.stale_packet_retry", "room.information.unanswered_fan", "room.information.notification_overflow", "room.information.missing_ack"],
        "FORCED_ALIGNMENT": ["room.forced.left_right_gate", "room.forced.unstable_middle", "room.forced.ballot_shift", "room.forced.crack_fall_loop"],
        "IN_BETWEEN": ["room.in_between.context_switch", "room.in_between.stable_intersection", "room.in_between.misregistration_corridor", "room.in_between.borrowed_rule"],
        "POLARIZED": ["room.polarized.clock_decree", "room.polarized.hard_cut_corridor", "room.polarized.alternating_verdict", "room.polarized.no_dusk_grid"],
    }
    metric_maps = {
        "INFORMATION": {"avgFlower": 0.30, "gazeRatio": 0.18, "recentInputDensity": 0.34, "unansweredActions": 0.18},
        "FORCED_ALIGNMENT": {"sideCommitment": 0.32, "crackRatio": 0.34, "sideSwitches": 0.22, "avgFlower": 0.12},
        "IN_BETWEEN": {"contextSwitches": 0.28, "intersectionHold": 0.30, "correctionLatency": 0.20, "gazeRatio": 0.22},
        "POLARIZED": {"overrideRatio": 0.30, "binarySwitches": 0.24, "highLightRatio": 0.24, "noDuskTicks": 0.22},
    }
    weather_echo_ids = [
        "encounter.weather_echo.rain_packets",
        "encounter.weather_echo.ash_memory",
        "encounter.weather_echo.wind_bias",
    ]
    assert all(pattern_id in pattern_ids for pattern_id in weather_echo_ids)
    composers = []
    for room, pool in room_defs.items():
        assert all(pid in pattern_ids for pid in pool)
        composers.append({
            "id": f"composer.{room.lower()}",
            "room": room,
            "algorithm": "seeded_weighted_without_replacement_with_behavior_bias",
            "patternPool": [{"patternId": pid, "baseWeight": 1.0 + i * 0.08, "cooldownEncounters": 2} for i, pid in enumerate(pool)],
            "behaviorMetricWeights": metric_maps[room],
            "intensityTiers": [
                {"id": "listen", "budget": {"maxProjectiles": 80, "maxEmitters": 2, "restMs": 1600}, "difficulty": "EASY"},
                {"id": "read", "budget": {"maxProjectiles": 150, "maxEmitters": 3, "restMs": 1100}, "difficulty": "NORMAL"},
                {"id": "enforce", "budget": {"maxProjectiles": 240, "maxEmitters": 4, "restMs": 820}, "difficulty": "HARD"},
            ],
            "constraints": {
                "samePatternConsecutive": False,
                "sameStructuralSignatureWithin": 3,
                "weatherVisualOverlayMaximum": 1,
                "safeGapMustOverlapPreviousForMs": 520,
                "restWindowCannotBeRemovedByDifficulty": True,
                "scoreReward": None,
            },
            "materialLedger": {"recordCancelledProjectiles": True, "recordEnemyResidue": True, "roomSpecificResidue": ROOM_RESIDUE[room]},
        })
    room_manifest = {"schemaVersion": "4.0.0", "$schema": "../../gameplay/schemas/composers-v4.schema.json", "composers": composers}
    encounter = {
        "schemaVersion": "4.0.0",
        "$schema": "../../gameplay/schemas/director-v4.schema.json",
        "id": "director.encounter.v4",
        "coordinateSystem": {"logicalViewport": [360, 640], "playerBandY": 570, "units": "logical-px"},
        "segments": [
            {"id": "telegraph", "durationMs": [520, 900], "collision": False},
            {"id": "entry", "durationMs": [800, 1600], "maxEnemies": 4},
            {"id": "read", "durationMs": [7000, 14000], "patternSlots": [1, 3]},
            {"id": "material_settle", "durationMs": [900, 1800], "newSpawns": False},
            {"id": "rest", "durationMs": [820, 1800], "newSpawns": False, "required": True},
        ],
        "scheduling": {
            "seed": "runSeed xor roomOrdinal xor encounterOrdinal",
            "forbiddenSeedInputs": ["weatherEvent", "weatherSeed", "weatherRng"],
            "maxProjectileBudget": {"EASY": 120, "NORMAL": 200, "HARD": 280},
            "maxLaserAndDenseWallOverlapMs": 0,
            "safeGapHandoffMs": 520,
            "enemyPatternStartsOnlyAfterTelegraph": True,
            "crossedFrameEventsExactlyOnce": True,
        },
        "parallelEncounterPools": {
            "weatherEcho": {
                "patternIds": weather_echo_ids,
                "selectionSeed": "runSeed xor encounterOrdinal xor 0xEC40",
                "maximumConcurrent": 1,
                "requiresWeatherState": False,
                "mayCoincideWithWeatherVisual": True,
            }
        },
        "weatherDecoupling": {
            "weatherAuthority": "visual/audio environment only",
            "weatherEventCanTriggerPattern": False,
            "weatherEventCanSpawnProjectile": False,
            "weatherEventCanAlterProjectileMotion": False,
            "weatherEventCanAlterCollision": False,
            "weatherEventCanAlterSafeGap": False,
            "weatherRngEntersPatternSeed": False,
        },
        "failurePolicy": {"noUntelegraphedSpawnWithinPxOfPlayer": 96, "noForcedHitAtMaximumSpeed": True, "collisionNeverFromAlpha": True},
    }
    run = {
        "schemaVersion": "4.0.0",
        "$schema": "../../gameplay/schemas/director-v4.schema.json",
        "id": "director.run.v4",
        "runIs": "behavioral sampling, not a linear stage ladder",
        "phases": [
            {"id": "quiet_awakening", "durationMs": [6000, 10000], "combat": False, "unlocks": ["move", "flower_expression"]},
            {"id": "first_eye", "durationMs": [7000, 12000], "combat": "sparse", "patterns": ["common.eye_acquisition"], "unlocks": ["focus", "graze_evidence"]},
            {"id": "mental_room_sampling", "roomsSampled": [2, 4], "selection": "seeded_by_behavior_ledger", "roomOrderRepeat": False},
            {"id": "local_override", "entry": "evidence>=overrideCost", "patterns": ["transition.override_void"], "optional": True},
            {"id": "dusk_or_no_dusk", "entry": "runClock>=targetDuration or terminalProtocol", "patterns": ["transition.dusk_settle"], "combatSpawnsStop": True},
            {"id": "state_snapshot", "combat": False, "judgement": None},
            {"id": "cross_run_material_memory", "combat": False, "order": ["scar", "ghost", "witness", "input_return"]},
        ],
        "roomSampling": {
            "rooms": list(room_defs),
            "algorithm": "weighted_without_replacement",
            "weightsFrom": ["roomTime", "flower", "gaze", "crack", "override", "contextSwitch"],
            "neverTreatAsProgression": True,
        },
        "bossPolicy": {"maximumPerRun": 2, "selection": "room_and_behavior_match", "resolutionNeedNotUseDamage": True, "hpZeroNeverRequiredGlobally": True},
        "determinism": {"seedAlgorithm": "mulberry32-v1", "eventLogHash": "sha256", "sameSeedAndInputsSameTrace": True},
    }
    return room_manifest, encounter, run


def build_projectile_lifecycle() -> dict[str, Any]:
    return {
        "schemaVersion": "4.0.0",
        "$schema": "../../gameplay/schemas/projectile-lifecycle-v4.schema.json",
        "id": "projectile.lifecycle.v4",
        "authority": "entity-owned gameplay state; never animation duration or sprite alpha",
        "states": [
            {"id": "spawn", "collision": False, "exit": "spawn_commit"},
            {"id": "arm", "collision": False, "exit": "arm_delay_elapsed"},
            {"id": "flight", "collision": True, "exit": "impact | cancel | source_withdrawn | out_of_bounds | room_transition"},
            {"id": "impact", "collision": False, "exit": "impact_visual_complete"},
            {"id": "cancel", "collision": False, "exit": "residue_commit"},
            {"id": "residue", "collision": False, "exit": "material_lifetime_elapsed"},
            {"id": "cleanup", "collision": False, "exit": "pool_return"},
        ],
        "invariants": [
            "flight has no fixed default timeout",
            "collision disable is committed before impact/cancel visuals",
            "large delta dispatches every crossed state event once",
            "reduced motion and flash-off produce identical gameplay transitions",
            "visual alpha and atlas frame never author collision",
        ],
        "grazeEvidence": {
            "maximumPerProjectile": 1,
            "key": "projectileUid+playerLifeOrdinal",
            "armState": "flight",
            "consumedOn": "first_valid_graze",
            "score": None,
            "output": "evidence.grain",
        },
        "collision": {
            "integration": "continuous swept circle/capsule",
            "playerNormalRadiusPx": 3,
            "playerFocusRadiusPx": 2,
            "projectileRadiusFromArchetype": True,
            "alphaIgnored": True,
        },
        "poolBudgets": {
            "micro": 2048,
            "medium": 768,
            "heavy": 192,
            "splitChildren": 1024,
            "residueVisualOnly": 1536,
            "overflowPolicy": "reject_new_spawn_and_log; never recycle a live collider",
        },
        "cancelConsequences": {
            "pattern_end": "room-specific material residue",
            "override_void": "override scar at exact cancellation coordinate",
            "source_withdrawn": "source-specific sediment",
            "room_transition": "threshold sediment",
            "impact": "impact trace; not override scar",
        },
    }


def schemas() -> dict[str, dict[str, Any]]:
    common_header = {"$schema": "https://json-schema.org/draft/2020-12/schema", "additionalProperties": True}
    pattern_schema = {
        **common_header,
        "$id": "patterns-v4.schema.json",
        "type": "object",
        "required": ["schemaVersion", "patterns"],
        "properties": {
            "schemaVersion": {"const": "4.0.0"},
            "patterns": {
                "type": "array",
                "minItems": 48,
                "maxItems": 48,
                "items": {
                    "type": "object",
                    "required": ["id", "category", "room", "durationMs", "clock", "timeline", "emitters", "safeGap", "warning", "cancel", "residue", "difficulty", "seed"],
                    "properties": {
                        "emitters": {"type": "array", "minItems": 1},
                        "timeline": {"type": "array", "minItems": 7},
                    },
                },
            },
        },
    }
    operator_schema = {
        **common_header,
        "$id": "motion-operators-v4.schema.json",
        "type": "object",
        "required": ["schemaVersion", "operators"],
        "properties": {
            "schemaVersion": {"const": "4.0.0"},
            "operators": {
                "type": "array",
                "minItems": 12,
                "maxItems": 12,
                "items": {"type": "object", "required": ["id", "category", "parameters", "update", "determinism", "collisionNote"]},
            },
        },
    }
    enemy_schema = {
        **common_header,
        "$id": "enemies-v4.schema.json",
        "type": "object",
        "required": ["schemaVersion", "mechanicalRoleCount", "enemies"],
        "properties": {
            "mechanicalRoleCount": {"type": "integer", "minimum": 8},
            "enemies": {
                "type": "array",
                "minItems": 16,
                "maxItems": 16,
                "items": {"type": "object", "required": ["id", "role", "entry", "movement", "formation", "cadence", "exit", "telegraph", "materialResidue", "collision"]},
            },
        },
    }
    boss_schema = {
        **common_header,
        "$id": "boss-rigs-v4.schema.json",
        "type": "object",
        "required": ["schemaVersion", "canonicalResolutionSource", "canonicalResolutionSha256", "sharedFallbackResolution", "ruptureContract", "rigs"],
        "properties": {
            "rigs": {
                "type": "array",
                "minItems": 8,
                "maxItems": 8,
                "items": {
                    "type": "object",
                    "required": ["id", "aliases", "narrativeAlias", "weakpoint", "emitters", "phases", "rupture", "materialResidue", "resolution"],
                    "properties": {
                        "emitters": {"type": "array", "minItems": 1, "maxItems": 3},
                        "phases": {"type": "array", "minItems": 3, "maxItems": 3},
                        "aliases": {"type": "array", "minItems": 1},
                        "resolution": {"type": "object", "required": ["source", "canonicalBossId", "narrativeAlias", "resolutionId", "metric", "condition", "fact", "terminal", "terminalEvent", "materialRemainder", "playerPossibilities"]},
                    },
                },
            },
        },
    }
    laser_schema = {
        **common_header,
        "$id": "lasers-v4.schema.json",
        "type": "object",
        "required": ["schemaVersion", "lasers"],
        "properties": {
            "lasers": {
                "type": "array",
                "minItems": 8,
                "maxItems": 8,
                "items": {"type": "object", "required": ["id", "bossId", "aliases", "narrativeAlias", "geometry", "lifecycle", "collision", "warning", "safeOpening", "cancel"]},
            },
        },
    }
    composer_schema = {
        **common_header,
        "$id": "composers-v4.schema.json",
        "type": "object",
        "required": ["schemaVersion", "composers"],
        "properties": {
            "composers": {
                "type": "array",
                "minItems": 4,
                "maxItems": 4,
                "items": {"type": "object", "required": ["id", "room", "algorithm", "patternPool", "behaviorMetricWeights", "intensityTiers", "constraints", "materialLedger"]},
            },
        },
    }
    director_schema = {
        **common_header,
        "$id": "director-v4.schema.json",
        "type": "object",
        "required": ["schemaVersion", "id"],
    }
    projectile_schema = {
        **common_header,
        "$id": "projectile-lifecycle-v4.schema.json",
        "type": "object",
        "required": ["schemaVersion", "id", "authority", "states", "invariants", "grazeEvidence", "collision", "poolBudgets", "cancelConsequences"],
        "properties": {"states": {"type": "array", "minItems": 7, "maxItems": 7}},
    }
    return {
        "patterns-v4.schema.json": pattern_schema,
        "motion-operators-v4.schema.json": operator_schema,
        "enemies-v4.schema.json": enemy_schema,
        "boss-rigs-v4.schema.json": boss_schema,
        "lasers-v4.schema.json": laser_schema,
        "composers-v4.schema.json": composer_schema,
        "director-v4.schema.json": director_schema,
        "projectile-lifecycle-v4.schema.json": projectile_schema,
    }


def main() -> None:
    MANIFEST_DIR.mkdir(parents=True, exist_ok=True)
    SCHEMA_DIR.mkdir(parents=True, exist_ok=True)

    canonical_resolutions, canonical_resolution_payload = load_canonical_boss_resolutions()
    canonical_resolution_sha256 = hashlib.sha256(NARRATIVE_BOSS_RESOLUTIONS.read_bytes()).hexdigest()
    expected_aliases = {boss[0] for boss in BOSSES}
    if set(canonical_resolutions) != expected_aliases:
        raise ValueError(f"narrative/gameplay boss aliases differ: {set(canonical_resolutions) ^ expected_aliases}")
    operators = {"schemaVersion": "4.0.0", "$schema": "../../gameplay/schemas/motion-operators-v4.schema.json", "operators": OPERATORS}
    patterns = build_room_patterns() + build_common_patterns() + build_boss_patterns(canonical_resolutions)
    assert len(patterns) == 48, len(patterns)
    pattern_manifest = {
        "schemaVersion": "4.0.0",
        "$schema": "../../gameplay/schemas/patterns-v4.schema.json",
        "coordinateSystem": {"logicalViewport": [360, 640], "origin": "top-left", "angleZero": "+x", "positiveAngle": "clockwise", "playerBandY": 570},
        "runtimeContract": {"patternIsExecutable": True, "collisionAuthority": "gameplay", "visualFrameMayNeverChangeCollision": True, "difficultyNeverUsesColorOnly": True},
        "counts": {"room": 16, "commonTransitionWeatherEcho": 8, "boss": 24, "total": 48},
        "patterns": patterns,
    }
    pattern_ids = {p["id"] for p in patterns}
    lasers = build_lasers()
    laser_ids = {l["id"] for l in lasers["lasers"]}
    enemies = build_enemy_archetypes(pattern_ids)
    bosses = build_boss_rigs(pattern_ids, laser_ids, canonical_resolutions, canonical_resolution_payload)
    bosses["canonicalResolutionSha256"] = canonical_resolution_sha256
    composers, encounter, run = build_composers(pattern_ids)
    projectile_lifecycle = build_projectile_lifecycle()

    files = {
        "motion-operators-v4.json": operators,
        "executable-patterns-v4.json": pattern_manifest,
        "enemy-archetypes-v4.json": enemies,
        "boss-rigs-v4.json": bosses,
        "laser-geometries-v4.json": lasers,
        "room-composers-v4.json": composers,
        "encounter-director-v4.json": encounter,
        "run-director-v4.json": run,
        "projectile-lifecycle-v4.json": projectile_lifecycle,
    }
    for name, value in files.items():
        write_json(MANIFEST_DIR / name, value)
    for name, value in schemas().items():
        write_json(SCHEMA_DIR / name, value)

    index_entries = []
    for name in sorted(files):
        data = (MANIFEST_DIR / name).read_bytes()
        index_entries.append({"path": name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)})
    index = {
        "schemaVersion": "4.0.0",
        "id": "1bit.gameplay.v4",
        "description": "Canonical executable STG choreography: behavior, time, safe gaps, causal residue, enemies, bosses, lasers and directors.",
        "canonicalPatternManifest": "executable-patterns-v4.json",
        "externalAuthorities": [
            {
                "path": "../../narrative/boss-resolutions-v4.json",
                "role": "canonical boss resolution facts",
                "sha256": canonical_resolution_sha256,
            }
        ],
        "counts": {"motionOperators": 12, "patterns": 48, "roomPatterns": 16, "commonTransitionWeatherEchoPatterns": 8, "bossPatterns": 24, "enemies": 16, "mechanicalEnemyRoles": 8, "bosses": 8, "bossPhases": 24, "laserGeometries": 8, "roomComposers": 4},
        "files": index_entries,
    }
    write_json(MANIFEST_DIR / "gameplay-index-v4.json", index)
    print(f"wrote {len(files) + 1} manifests, {len(schemas())} schemas, {len(patterns)} executable patterns")


if __name__ == "__main__":
    main()
