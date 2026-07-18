#!/usr/bin/env python3
"""Generate timing-faithful QA previews without touching the delivery kit."""

from __future__ import annotations

import argparse
import fnmatch
import random
import re
import sys
from pathlib import Path
from typing import Any, Optional

from PIL import Image, ImageDraw, ImageFont

from v3lib import (
    Kit,
    TimelineFrame,
    alpha_composite_at,
    fit_nearest,
    normalize_mapping,
    render_timeline_frame,
    safe_output_path,
    save_animation,
    tight_crop,
    write_json,
)


INK = (8, 9, 13, 255)
PAPER = (239, 233, 218, 255)
MAGENTA = (240, 42, 146, 255)
CYAN = (23, 167, 202, 255)
AMBER = (214, 152, 43, 255)
VIOLET = (120, 81, 183, 255)
RED = (183, 70, 60, 255)
GRAY = (125, 128, 135, 255)

NAMED_COLORS = {
    "SYSTEM_INK": INK,
    "SELF_PAPER": PAPER,
    "FRICTION_GRAY": GRAY,
    "INFO_CYAN": CYAN,
    "FORCED_AMBER": AMBER,
    "BETWEEN_VIOLET": VIOLET,
    "POLAR_RED": RED,
    "OVERRIDE_MAGENTA": MAGENTA,
}


def slug(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_.-]+", "-", value).strip("-.")
    return cleaned or "preview"


def add_extension(base: Path, extension: str) -> Path:
    """Append an extension without treating semantic-ID dots as suffixes."""
    return base.parent / f"{base.name}{extension}"


def format_specs(value: str) -> list[tuple[str, str]]:
    if value == "both":
        return [("gif", ".gif"), ("apng", ".apng")]
    return [(value, ".gif" if value == "gif" else ".apng")]


def select_ids(available: list[str], patterns: list[str], all_items: bool) -> list[str]:
    if all_items:
        return sorted(available)
    selected: list[str] = []
    for pattern in patterns:
        matches = [item for item in available if fnmatch.fnmatchcase(item, pattern)]
        if pattern in available and pattern not in matches:
            matches.append(pattern)
        for item in matches:
            if item not in selected:
                selected.append(item)
    return selected


def render_clip(kit: Kit, clip_id: str, out_dir: Path, formats: str) -> list[dict[str, Any]]:
    timeline = kit.timeline(clip_id, expand_playback=True)
    if not timeline:
        raise ValueError(f"clip {clip_id!r} has no renderable frames")
    frames: list[Image.Image] = []
    durations: list[int] = []
    timing_rows: list[dict[str, Any]] = []
    elapsed = 0
    for playback_ordinal, step in enumerate(timeline):
        sprite = kit.crop(step.ref)
        label = f"{clip_id}  f{step.source_ordinal:02d}  {step.duration_ms}ms"
        frames.append(render_timeline_frame(sprite, label, step.events))
        durations.append(step.duration_ms)
        timing_rows.append(
            {
                "playbackOrdinal": playback_ordinal,
                "sourceOrdinal": step.source_ordinal,
                "frame": step.ref,
                "startMs": elapsed,
                "durationMs": step.duration_ms,
                "events": list(step.events),
            }
        )
        elapsed += step.duration_ms
    base = out_dir / "clips" / slug(clip_id)
    outputs: list[str] = []
    for kind, extension in format_specs(formats):
        path = add_extension(base, extension)
        save_animation(frames, durations, path, kind)
        outputs.append(str(path))
    timeline_path = add_extension(base, ".timeline.json")
    clip = kit.clips[clip_id]
    write_json(
        timeline_path,
        {
            "clip": clip_id,
            "fps": clip.get("fps"),
            "loop": clip.get("loop"),
            "loopMode": clip.get("loopMode"),
            "hold": clip.get("hold", {}),
            "periodMs": elapsed,
            "timeline": timing_rows,
        },
    )
    return [{"type": "clip", "id": clip_id, "files": outputs + [str(timeline_path)], "periodMs": elapsed}]


def timeline_frame_at(timeline: list[TimelineFrame], time_ms: int) -> Optional[TimelineFrame]:
    if not timeline:
        return None
    total = sum(item.duration_ms for item in timeline)
    cursor = time_ms % max(1, total)
    for item in timeline:
        if cursor < item.duration_ms:
            return item
        cursor -= item.duration_ms
    return timeline[-1]


def node_frame(node: dict[str, Any], phase: str, kit: Kit, time_ms: int) -> Optional[str]:
    clip_id = node.get("clip")
    if isinstance(clip_id, str) and clip_id in kit.clips:
        step = timeline_frame_at(kit.timeline(clip_id, expand_playback=True), time_ms)
        if step:
            return step.ref
    phase_frames = node.get("phaseFrames")
    if isinstance(phase_frames, dict) and isinstance(phase_frames.get(phase), str):
        return phase_frames[phase]
    frame = node.get("frame")
    return frame if isinstance(frame, str) else None


def paste_with_pivot(
    canvas: Image.Image,
    sprite: Image.Image,
    anchor: tuple[float, float],
    pivot: tuple[float, float],
) -> None:
    left = int(round(anchor[0] - pivot[0] * sprite.width))
    top = int(round(anchor[1] - pivot[1] * sprite.height))
    canvas.alpha_composite(sprite, (left, top))


def render_boss_frame(kit: Kit, rig_id: str, phase: str, time_ms: int, show_guides: bool) -> Image.Image:
    rig = normalize_mapping(kit.rigs.get("rigs"), "id")[rig_id]
    nodes = rig.get("nodes", {}) if isinstance(rig.get("nodes"), dict) else {}
    canvas = Image.new("RGBA", (480, 320), INK)
    draw = ImageDraw.Draw(canvas)
    for x in range(0, 480, 16):
        draw.line((x, 0, x, 292), fill=(25, 28, 34, 255))
    for y in range(0, 292, 16):
        draw.line((0, y, 480, y), fill=(25, 28, 34, 255))
    body_center = (190.0, 146.0)
    rig_scale = 1.75
    body_size = kit.rigs.get("defaults", {}).get("bodyLogicalSize", [128, 128])
    if not (isinstance(body_size, list) and len(body_size) == 2):
        body_size = [128, 128]
    ordered = sorted(
        ((name, node) for name, node in nodes.items() if isinstance(node, dict) and node.get("type") == "sprite"),
        key=lambda item: int(item[1].get("renderOrder", 0)),
    )
    guide_points: list[tuple[str, tuple[float, float]]] = []
    for name, node in ordered:
        if name == "rupture" and "ruptur" not in phase:
            continue
        frame_ref = node_frame(node, phase, kit, time_ms)
        if not frame_ref:
            continue
        try:
            sprite = kit.crop(frame_ref)
        except (KeyError, FileNotFoundError, ValueError):
            continue
        anchor_value = node.get("anchor", [0.5, 0.5])
        pivot_value = node.get("pivot", (kit.frame_record(frame_ref) or {}).get("pivot", [0.5, 0.5]))
        if name == "body":
            anchor = body_center
        else:
            anchor = (
                body_center[0] + (float(anchor_value[0]) - 0.5) * float(body_size[0]) * rig_scale,
                body_center[1] + (float(anchor_value[1]) - 0.5) * float(body_size[1]) * rig_scale,
            )
        pivot = (float(pivot_value[0]), float(pivot_value[1]))
        sprite = sprite.resize(
            (max(1, int(round(sprite.width * rig_scale))), max(1, int(round(sprite.height * rig_scale)))),
            Image.Resampling.NEAREST,
        )
        paste_with_pivot(canvas, sprite, anchor, pivot)
        guide_points.append((name, anchor))
    if show_guides:
        for index, (name, point) in enumerate(guide_points, start=1):
            x, y = int(point[0]), int(point[1])
            draw.line((x - 4, y, x + 4, y), fill=MAGENTA)
            draw.line((x, y - 4, x, y + 4), fill=MAGENTA)
            draw.text((x + 5, y - 6), str(index), font=ImageFont.load_default(), fill=PAPER)
            draw.text((352, 16 + index * 14), f"{index}  {name}", font=ImageFont.load_default(), fill=PAPER)
    draw.rectangle((0, 292, 480, 320), fill=INK)
    draw.text((6, 296), f"BOSS RIG  {rig_id}  {phase}  t={time_ms}ms", font=ImageFont.load_default(), fill=PAPER)
    room = rig.get("room", "—")
    draw.text((6, 308), f"room={room} · anchors/pivots assembled", font=ImageFont.load_default(), fill=CYAN)
    return canvas


def render_boss(kit: Kit, rig_id: str, out_dir: Path, formats: str, phase: str, show_guides: bool) -> list[dict[str, Any]]:
    rigs = normalize_mapping(kit.rigs.get("rigs"), "id")
    if rig_id not in rigs:
        raise KeyError(f"unknown boss rig {rig_id!r}")
    rig = rigs[rig_id]
    if phase == "auto":
        phases = rig.get("phases", [])
        phase = phases[0].get("id", "phase1") if isinstance(phases, list) and phases and isinstance(phases[0], dict) else "phase1"
    master_clips = [
        node.get("clip")
        for node in (rig.get("nodes", {}) or {}).values()
        if isinstance(node, dict) and isinstance(node.get("clip"), str) and node.get("clip") in kit.clips
    ]
    master = kit.timeline(master_clips[0], expand_playback=True) if master_clips else []
    durations = [item.duration_ms for item in master] or [100] * 12
    starts: list[int] = []
    elapsed = 0
    for duration in durations:
        starts.append(elapsed)
        elapsed += duration
    frames = [render_boss_frame(kit, rig_id, phase, time_ms, show_guides) for time_ms in starts]
    base = out_dir / "boss" / f"{slug(rig_id)}-{slug(phase)}-assembled"
    outputs: list[str] = []
    for kind, extension in format_specs(formats):
        path = add_extension(base, extension)
        save_animation(frames, durations, path, kind)
        outputs.append(str(path))
    still = add_extension(base, ".png")
    still = safe_output_path(still)
    still.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(still)
    outputs.append(str(still))
    return [{"type": "boss", "id": rig_id, "phase": phase, "files": outputs, "periodMs": sum(durations)}]


def laser_timing(kit: Kit, module: dict[str, Any]) -> dict[str, int]:
    defaults = kit.lasers.get("defaults", {}) if isinstance(kit.lasers.get("defaults"), dict) else {}
    timing = module.get("timing", {}) if isinstance(module.get("timing"), dict) else {}
    warning_default = defaults.get("warning", {}) if isinstance(defaults.get("warning"), dict) else {}
    fire_default = defaults.get("fire", {}) if isinstance(defaults.get("fire"), dict) else {}
    shutdown_default = defaults.get("shutdown", {}) if isinstance(defaults.get("shutdown"), dict) else {}
    shutdown_clip = shutdown_default.get("clip")
    shutdown_ms = 220
    if isinstance(shutdown_clip, str) and shutdown_clip in kit.clips:
        shutdown_ms = sum(item.duration_ms for item in kit.timeline(shutdown_clip, False))
    return {
        "warning": int(timing.get("warningMs", warning_default.get("durationMs", 700))),
        "charge": int(timing.get("chargeMs", fire_default.get("chargeMs", 180))),
        "grow": int(timing.get("growMs", fire_default.get("growMs", 140))),
        "live": int(timing.get("minimumLiveMs", fire_default.get("minimumLiveMs", 400))),
        "shutdown": int(timing.get("shutdownMs", shutdown_ms)),
    }


def remap_laser_palette(image: Image.Image, module: dict[str, Any]) -> Image.Image:
    display = module.get("display", {}) if isinstance(module.get("display"), dict) else {}
    mapping = display.get("paletteRemap", {}) if isinstance(display.get("paletteRemap"), dict) else {}
    replacements: dict[tuple[int, int, int], tuple[int, int, int, int]] = {}
    for source_name, target_name in mapping.items():
        source = NAMED_COLORS.get(str(source_name))
        target = NAMED_COLORS.get(str(target_name))
        if source and target:
            replacements[source[:3]] = target
    if not replacements:
        return image
    result = image.convert("RGBA").copy()
    pixels = result.load()
    for y in range(result.height):
        for x in range(result.width):
            red, green, blue, alpha = pixels[x, y]
            replacement = replacements.get((red, green, blue))
            if replacement:
                pixels[x, y] = (*replacement[:3], alpha)
    return result


def pattern_laser_body(image: Image.Image, pattern: str) -> Image.Image:
    """Preview the module's runtime body pattern without changing gameplay."""
    result = image.copy()
    draw = ImageDraw.Draw(result)
    transparent = (0, 0, 0, 0)
    width, height = result.size
    if pattern == "packet-gap":
        for x in range(14, width, 34):
            draw.rectangle((x, 0, min(width - 1, x + 7), height - 1), fill=transparent)
    elif pattern == "vertical-feed":
        for x in range(12, width, 28):
            draw.rectangle((x, 0, min(width - 1, x + 4), max(0, height // 2 - 1)), fill=transparent)
    elif pattern == "single-rule":
        draw.rectangle((0, 0, width - 1, max(0, height // 3 - 1)), fill=transparent)
        draw.rectangle((0, max(0, 2 * height // 3), width - 1, height - 1), fill=transparent)
    elif pattern == "unequal-seam":
        for x in range(22, width, 47):
            draw.rectangle((x, 0, min(width - 1, x + 11), max(0, height // 2 - 1)), fill=transparent)
    elif pattern == "double-read":
        middle = height // 2
        draw.rectangle((0, max(0, middle - 1), width - 1, min(height - 1, middle + 1)), fill=transparent)
    elif pattern == "offset-crescents":
        for x in range(18, width, 42):
            draw.rectangle((x, 0, min(width - 1, x + 6), max(0, height // 3)), fill=transparent)
            draw.rectangle((min(width - 1, x + 9), max(0, 2 * height // 3), min(width - 1, x + 15), height - 1), fill=transparent)
    elif pattern == "binary-wall":
        for x in range(30, width, 58):
            draw.rectangle((x, 0, min(width - 1, x + 2), height - 1), fill=transparent)
    elif pattern == "scarred-eye":
        scar_x = min(width - 1, max(0, int(width * 0.62)))
        draw.rectangle((scar_x, 0, min(width - 1, scar_x + 5), height - 1), fill=transparent)
        draw.line((scar_x - 3, 0, scar_x + 7, height - 1), fill=MAGENTA, width=1)
    return result


def render_laser_frame(
    kit: Kit,
    module_id: str,
    phase: str,
    amount: float,
    collision: bool,
) -> Image.Image:
    module = normalize_mapping(kit.lasers.get("modules"), "id")[module_id]
    refs = module.get("frames", {}) if isinstance(module.get("frames"), dict) else {}
    display = module.get("display", {}) if isinstance(module.get("display"), dict) else {}
    accent_name = str(display.get("paletteRole", "INFO_CYAN"))
    accent = NAMED_COLORS.get(accent_name, CYAN)
    pattern = str(display.get("pattern", "packet-gap"))
    canvas = Image.new("RGBA", (360, 176), INK)
    draw = ImageDraw.Draw(canvas)
    for x in range(0, 360, 16):
        draw.line((x, 0, x, 148), fill=(26, 29, 35, 255))
    for y in range(0, 148, 16):
        draw.line((0, y, 360, y), fill=(26, 29, 35, 255))
    origin = (42, 76)
    maximum_length = 258
    length = max(0, int(round(maximum_length * max(0.0, min(1.0, amount)))))
    if phase == "warning":
        warning_ref = refs.get("warning")
        if isinstance(warning_ref, str):
            warning = remap_laser_palette(fit_nearest(tight_crop(kit.crop(warning_ref)), (46, 46)), module)
            alpha_composite_at(canvas, warning, origin)
        line_color = (*accent[:3], int(90 + 120 * amount))
        draw.line((origin[0], origin[1], origin[0] + maximum_length, origin[1]), fill=line_color, width=2)
    else:
        emitter_ref, body_ref, end_ref = refs.get("emitter"), refs.get("body"), refs.get("end")
        if all(isinstance(value, str) for value in (emitter_ref, body_ref, end_ref)):
            emitter = remap_laser_palette(tight_crop(kit.crop(emitter_ref)), module)
            body = remap_laser_palette(tight_crop(kit.crop(body_ref)), module)
            end = remap_laser_palette(tight_crop(kit.crop(end_ref)), module)
            if length > 0:
                logical_width = int(display.get("widthLogicalPx", 8))
                body_height = max(4, min(26, logical_width + 3))
                body_scaled = body.resize((max(1, length), body_height), Image.Resampling.NEAREST)
                body_scaled = pattern_laser_body(body_scaled, pattern)
                canvas.alpha_composite(body_scaled, (origin[0], origin[1] - body_height // 2))
                end_scaled = fit_nearest(end, (48, 58), allow_upscale=False)
                alpha_composite_at(canvas, end_scaled, (origin[0] + length, origin[1]))
            emitter_scaled = fit_nearest(emitter, (68, 68), allow_upscale=False)
            alpha_composite_at(canvas, emitter_scaled, origin)
    draw.rectangle((0, 148, 360, 176), fill=INK)
    draw.text((6, 152), f"LASER  {module_id}  {phase}  {amount:.2f}", font=ImageFont.load_default(), fill=PAPER)
    draw.text(
        (6, 164),
        f"coll={'ON' if collision else 'off'} | on=beam_live | off=collision_off",
        font=ImageFont.load_default(),
        fill=MAGENTA if collision else CYAN,
    )
    return canvas


def split_duration(total: int, count: int) -> list[int]:
    if count <= 0:
        return []
    base = max(20, total // count)
    values = [base] * count
    values[-1] += max(0, total - sum(values))
    return values


def render_laser(kit: Kit, module_id: str, out_dir: Path, formats: str) -> list[dict[str, Any]]:
    modules = normalize_mapping(kit.lasers.get("modules"), "id")
    if module_id not in modules:
        raise KeyError(f"unknown laser module {module_id!r}")
    timing = laser_timing(kit, modules[module_id])
    states: list[tuple[str, float, bool, int]] = []
    for index, duration in enumerate(split_duration(timing["warning"], 4)):
        states.append(("warning", (index + 1) / 4, False, duration))
    for index, duration in enumerate(split_duration(timing["charge"], 2)):
        states.append(("charge", 0.05 * (index + 1), False, duration))
    for index, duration in enumerate(split_duration(timing["grow"], 5)):
        states.append(("grow", (index + 1) / 5, index == 4, duration))
    for _, duration in enumerate(split_duration(timing["live"], 4)):
        states.append(("live", 1.0, True, duration))
    for index, duration in enumerate(split_duration(timing["shutdown"], 4)):
        states.append(("shutdown", 1.0 - (index + 1) / 4, False, duration))
    frames = [render_laser_frame(kit, module_id, phase, amount, collision) for phase, amount, collision, _ in states]
    durations = [duration for _, _, _, duration in states]
    base = out_dir / "lasers" / f"{slug(module_id)}-lifecycle"
    outputs: list[str] = []
    for kind, extension in format_specs(formats):
        path = add_extension(base, extension)
        save_animation(frames, durations, path, kind)
        outputs.append(str(path))
    sample_indices = [0, 4, 8, 12, len(frames) - 1]
    contact = Image.new("RGBA", (360, 176 * len(sample_indices)), INK)
    for row, index in enumerate(sample_indices):
        contact.alpha_composite(frames[index], (0, row * 176))
    contact_path = safe_output_path(add_extension(base, "-contact-sheet.png"))
    contact_path.parent.mkdir(parents=True, exist_ok=True)
    contact.save(contact_path)
    outputs.append(str(contact_path))
    lifecycle_path = add_extension(base, ".timeline.json")
    write_json(
        lifecycle_path,
        {
            "module": module_id,
            "timing": timing,
            "collisionEnablePhase": "grow:1.0",
            "collisionDisablePhase": "shutdown:0.0",
            "frames": [
                {"phase": phase, "amount": amount, "collision": collision, "durationMs": duration}
                for phase, amount, collision, duration in states
            ],
        },
    )
    return [{"type": "laser", "id": module_id, "files": outputs + [str(lifecycle_path)], "periodMs": sum(durations)}]


def choose_frame(kit: Kit, preferred_clips: list[str], atlas_tokens: list[str]) -> Optional[str]:
    for clip_id in preferred_clips:
        if clip_id in kit.clips:
            timeline = kit.timeline(clip_id, False)
            if timeline:
                return timeline[0].ref
    for frame_id in kit.all_frame_ids():
        atlas = str((kit.frame_record(frame_id) or {}).get("atlas", "")).lower()
        if any(token in atlas for token in atlas_tokens):
            return frame_id
    return None


def crop_background(path: Path, offset: int) -> Image.Image:
    image = Image.open(path).convert("RGBA")
    target_ratio = 360 / 640
    source_ratio = image.width / image.height
    if source_ratio > target_ratio:
        crop_width = int(round(image.height * target_ratio))
        left = (image.width - crop_width) // 2
        image = image.crop((left, 0, left + crop_width, image.height))
    else:
        crop_height = int(round(image.width / target_ratio))
        top = (image.height - crop_height) // 2
        image = image.crop((0, top, image.width, top + crop_height))
    image = image.resize((360, 640), Image.Resampling.NEAREST)
    if offset:
        shifted = Image.new("RGBA", image.size)
        offset %= image.height
        shifted.alpha_composite(image.crop((0, offset, 360, 640)), (0, 0))
        shifted.alpha_composite(image.crop((0, 0, 360, offset)), (0, 640 - offset))
        image = shifted
    return image


def render_stress_frame(
    kit: Kit,
    background: Path,
    bullet_positions: list[tuple[float, float, float, str]],
    player_ref: Optional[str],
    enemy_ref: Optional[str],
    boss_ref: Optional[str],
    frame_index: int,
) -> Image.Image:
    canvas = crop_background(background, frame_index * 7)
    # The gameplay veil models the documented stress-mode mid-layer reduction.
    # It is intentionally modest: geometry remains visible, but cannot compete
    # with projectile silhouettes.
    shade = Image.new("RGBA", canvas.size, (8, 9, 13, 72))
    canvas = Image.alpha_composite(canvas, shade)
    for x, y, speed, ref in bullet_positions:
        try:
            sprite = tight_crop(kit.crop(ref), 0)
        except (KeyError, FileNotFoundError, ValueError):
            continue
        record = kit.frame_record(ref) or {}
        logical_size = int(record.get("logicalSize", 32))
        visible_cap = {16: 6, 32: 12, 64: 24}.get(logical_size, 12)
        if max(sprite.size) > visible_cap:
            sprite.thumbnail((visible_cap, visible_cap), Image.Resampling.NEAREST)
        y_now = (y + frame_index * speed) % 600 + 20
        alpha_composite_at(canvas, sprite, (x, y_now))
    if boss_ref:
        boss = fit_nearest(tight_crop(kit.crop(boss_ref)), (120, 120), allow_upscale=False)
        alpha_composite_at(canvas, boss, (180, 82))
    if enemy_ref:
        enemy = fit_nearest(tight_crop(kit.crop(enemy_ref)), (54, 54), allow_upscale=False)
        alpha_composite_at(canvas, enemy, (70 + (frame_index % 3) * 8, 182))
        alpha_composite_at(canvas, enemy, (290 - (frame_index % 3) * 8, 206))
    if player_ref:
        player = fit_nearest(tight_crop(kit.crop(player_ref)), (48, 48), allow_upscale=False)
        alpha_composite_at(canvas, player, (180, 564))
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 0, 360, 20), fill=(8, 9, 13, 220))
    draw.text((5, 5), f"360×640 STRESS · {len(bullet_positions)} bullets · frame {frame_index:02d}", font=ImageFont.load_default(), fill=PAPER)
    draw.ellipse((177, 561, 183, 567), outline=MAGENTA, width=1)
    return canvas


def render_stress(
    kit: Kit,
    out_dir: Path,
    formats: str,
    count: int,
    seed: int,
    background_match: Optional[str],
) -> list[dict[str, Any]]:
    backgrounds = kit.background_paths()
    if background_match:
        matching = [path for path in backgrounds if background_match.lower() in path.name.lower()]
        if matching:
            backgrounds = matching
    if not backgrounds:
        raise FileNotFoundError("stress scene needs at least one background")
    bullet_banks: dict[str, list[str]] = {"micro": [], "medium": [], "heavy": []}
    for frame_id in kit.all_frame_ids():
        record = kit.frame_record(frame_id) or {}
        kind = str(record.get("kind", ""))
        logical_size = int(record.get("logicalSize", 32))
        if kind == "enemyBullet" and logical_size <= 16:
            bullet_banks["micro"].append(frame_id)
        elif kind == "enemyBullet":
            bullet_banks["medium"].append(frame_id)
        elif kind == "hazard":
            bullet_banks["heavy"].append(frame_id)
    fallback = [ref for bank in bullet_banks.values() for ref in bank]
    if not fallback:
        raise ValueError("stress scene needs bullet/projectile frames")
    rng = random.Random(seed)
    available_classes = [name for name, refs in bullet_banks.items() if refs]
    class_weights = {"micro": 0.76, "medium": 0.19, "heavy": 0.05}
    selected_classes = rng.choices(
        available_classes,
        weights=[class_weights[name] for name in available_classes],
        k=count,
    )
    positions = [
        (
            rng.uniform(10, 350),
            rng.uniform(20, 620),
            rng.uniform(1.5, 6.0),
            rng.choice(bullet_banks[size_class]),
        )
        for size_class in selected_classes
    ]
    player_ref = choose_frame(kit, ["player.core.idle", "player.focus.frame_00"], ["player"])
    enemy_ref = choose_frame(kit, ["enemy.courier", "enemy.clamp"], ["enemy"])
    boss_ref = choose_frame(kit, ["boss.absent_receiver.silhouette"], ["boss"])
    frames = [
        render_stress_frame(
            kit,
            backgrounds[0],
            positions,
            player_ref,
            enemy_ref,
            boss_ref,
            frame_index,
        )
        for frame_index in range(12)
    ]
    durations = [100] * len(frames)
    base = out_dir / "stress" / f"stress-360x640-{count}-bullets"
    outputs: list[str] = []
    still = safe_output_path(add_extension(base, ".png"))
    still.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(still)
    outputs.append(str(still))
    for kind, extension in format_specs(formats):
        path = add_extension(base, extension)
        save_animation(frames, durations, path, kind)
        outputs.append(str(path))
    metadata = add_extension(base, ".json")
    write_json(
        metadata,
        {
            "size": [360, 640],
            "bulletCount": count,
            "seed": seed,
            "background": str(backgrounds[0]),
            "playerFrame": player_ref,
            "enemyFrame": enemy_ref,
            "bossFrame": boss_ref,
            "animationFrames": len(frames),
            "fps": 10,
        },
    )
    outputs.append(str(metadata))
    return [{"type": "stress", "id": f"360x640-{count}", "files": outputs, "periodMs": sum(durations)}]


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Generate v3 clip, rig, laser and stress previews")
    result.add_argument("--kit-root", type=Path, required=True)
    result.add_argument("--out", type=Path, required=True, help="must be inside work/v3/qa")
    result.add_argument("--format", choices=("gif", "apng", "both"), default="both")
    result.add_argument("--clip", action="append", default=[], help="clip ID or shell-style pattern; repeatable")
    result.add_argument("--all-clips", action="store_true")
    result.add_argument("--boss", action="append", default=[], help="boss rig ID, pattern, or 'all'; repeatable")
    result.add_argument("--boss-phase", default="auto")
    result.add_argument("--no-rig-guides", action="store_true")
    result.add_argument("--laser", action="append", default=[], help="laser module ID, pattern, or 'all'; repeatable")
    result.add_argument("--stress", action="store_true")
    result.add_argument("--stress-count", type=int, default=220)
    result.add_argument("--stress-seed", type=int, default=3301)
    result.add_argument("--stress-background", help="case-insensitive background filename substring")
    return result


def main(argv: Optional[list[str]] = None) -> int:
    args = parser().parse_args(argv)
    try:
        out_dir = safe_output_path(args.out)
        out_dir.mkdir(parents=True, exist_ok=True)
        kit = Kit(args.kit_root)
        records: list[dict[str, Any]] = []
        clip_ids = select_ids(list(kit.clips), args.clip, args.all_clips)
        for clip_id in clip_ids:
            records.extend(render_clip(kit, clip_id, out_dir, args.format))
        rigs = normalize_mapping(kit.rigs.get("rigs"), "id")
        boss_all = "all" in args.boss
        boss_patterns = [value for value in args.boss if value != "all"]
        for rig_id in select_ids(list(rigs), boss_patterns, boss_all):
            records.extend(render_boss(kit, rig_id, out_dir, args.format, args.boss_phase, not args.no_rig_guides))
        modules = normalize_mapping(kit.lasers.get("modules"), "id")
        laser_all = "all" in args.laser
        laser_patterns = [value for value in args.laser if value != "all"]
        for module_id in select_ids(list(modules), laser_patterns, laser_all):
            records.extend(render_laser(kit, module_id, out_dir, args.format))
        if args.stress:
            records.extend(
                render_stress(
                    kit,
                    out_dir,
                    args.format,
                    max(1, args.stress_count),
                    args.stress_seed,
                    args.stress_background,
                )
            )
        if not records:
            raise ValueError("nothing selected; use --clip/--all-clips, --boss, --laser, or --stress")
        index_path = out_dir / "preview-index.json"
        write_json(
            index_path,
            {
                "schemaVersion": "3.0.0-preview-index",
                "kitRoot": str(kit.root),
                "format": args.format,
                "records": records,
            },
        )
        print(f"generated {len(records)} preview group(s) in {out_dir}")
        for record in records:
            print(f"- {record['type']} {record['id']}: {len(record['files'])} file(s)")
        print(f"- index: {index_path}")
        return 0
    except Exception as exc:  # noqa: BLE001 - CLI boundary
        print(f"render_v3_previews: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
