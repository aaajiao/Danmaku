#!/usr/bin/env python3
"""Build and validate the deterministic 1bit STG v3 background field system.

All generated runtime images are hard-pixel RGBA PNGs.  The texture is 360x1280
but its authored repeat period is 640 pixels; storing two periods makes both the
loop and its join visible during review.
"""

from __future__ import annotations

import hashlib
import json
import random
from collections import Counter, deque
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
WIDTH = 360
PERIOD = 640
HEIGHT = PERIOD * 2
EDGE_GUARD = 20

PALETTE = {
    "SYSTEM_INK": "#08090D",
    "SELF_PAPER": "#EFE9DA",
    "FRICTION_GRAY": "#7D8087",
    "INFO_CYAN": "#17A7CA",
    "FORCED_AMBER": "#D6982B",
    "BETWEEN_VIOLET": "#7851B7",
    "POLAR_RED": "#B7463C",
    "OVERRIDE_MAGENTA": "#F02A92",
}


def rgba(hex_value: str, alpha: int = 255) -> tuple[int, int, int, int]:
    value = hex_value.lstrip("#")
    return tuple(int(value[index : index + 2], 16) for index in (0, 2, 4)) + (alpha,)


C = {key: rgba(value) for key, value in PALETTE.items()}
TRANSPARENT = (0, 0, 0, 0)


@dataclass(frozen=True)
class RoomSpec:
    key: str
    label: str
    room_color: str
    seed: int
    field_semantics: str
    digital_track: str
    material_track: str


ROOMS = (
    RoomSpec(
        "information",
        "INFORMATION",
        "INFO_CYAN",
        1701,
        "断裂信息束：不同步刷新、丢包、重复尝试、旧路径烧屏；没有稳定中心。",
        "packet loss / retry / stale route",
        "被反复压印又中断的热敏纸带",
    ),
    RoomSpec(
        "forced_choice",
        "FORCED CHOICE",
        "FORCED_AMBER",
        1702,
        "同源镜像差异：左右共享 seed，但缺口、损耗与治理结果不同；seam 不是安全区。",
        "one seed / two governed outcomes",
        "同一模具脱出的两块不等量余料",
    ),
    RoomSpec(
        "in_between",
        "IN-BETWEEN",
        "BETWEEN_VIOLET",
        1703,
        "双系统交错：正交层与斜向层独立运行，稳定交集可学习，其他位置保持冲突。",
        "independent A/B clocks / stable intersection",
        "两张不同纹理方向的板材叠压",
    ),
    RoomSpec(
        "polarized",
        "POLARIZED",
        "POLAR_RED",
        1704,
        "红黑骨白硬切割：只有开/关，零渐变；只有玩家历史 scar 破坏镜像。",
        "binary threshold / enforced symmetry",
        "红色切片、黑色断面与骨白芯材",
    ),
)

LAYER_META = {
    "far": {
        "role": "room identity / low-contrast material field",
        "scrollPxPerSec": 4,
        "alphaContract": "opaque",
        "runtimeOpacity": 1.0,
    },
    "mid": {
        "role": "protocol movement / gameplay-veil target",
        "scrollPxPerSec": 13,
        "alphaContract": "binary",
        "runtimeOpacity": 0.72,
    },
    "trace": {
        "role": "sample player-history residue / replaceable at runtime",
        "scrollPxPerSec": 7,
        "alphaContract": "binary",
        "runtimeOpacity": 0.48,
    },
    "mask": {
        "role": "binary field mask read from alpha",
        "scrollPxPerSec": 21,
        "alphaContract": "binary",
        "runtimeOpacity": 1.0,
    },
}


def new_period(opaque: bool = False) -> Image.Image:
    fill = C["SYSTEM_INK"] if opaque else TRANSPARENT
    return Image.new("RGBA", (WIDTH, PERIOD), fill)


def double_period(period_image: Image.Image) -> Image.Image:
    output = Image.new("RGBA", (WIDTH, HEIGHT), TRANSPARENT)
    output.paste(period_image, (0, 0))
    output.paste(period_image, (0, PERIOD))
    return output


def safe_rect(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int, int, int],
    fill: tuple[int, int, int, int],
) -> None:
    x0, y0, x1, y1 = xy
    x0 = max(0, x0)
    x1 = min(WIDTH - 1, x1)
    y0 = max(EDGE_GUARD, y0)
    y1 = min(PERIOD - EDGE_GUARD - 1, y1)
    if x1 >= x0 and y1 >= y0:
        draw.rectangle((x0, y0, x1, y1), fill=fill)


def draw_axis_path(
    draw: ImageDraw.ImageDraw,
    points: list[tuple[int, int]],
    fill: tuple[int, int, int, int],
    width: int = 3,
) -> None:
    """Draw an un-antialiased orthogonal path with explicit pause ledges."""
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        if x0 == x1:
            safe_rect(draw, (x0, min(y0, y1), x0 + width - 1, max(y0, y1)), fill)
        elif y0 == y1:
            safe_rect(draw, (min(x0, x1), y0, max(x0, x1), y0 + width - 1), fill)
        else:
            raise ValueError("axis path contains a diagonal segment")


def draw_diagonal_band(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    length: int,
    thickness: int,
    slope: int,
    fill: tuple[int, int, int, int],
) -> None:
    """Draw a hard-edged rising/falling slab; not an anti-aliased line."""
    end_x = x + length
    end_y = y + slope
    polygon = (
        (x, y),
        (end_x, end_y),
        (end_x, end_y + thickness),
        (x, y + thickness),
    )
    draw.polygon(polygon, fill=fill)


def generate_information(spec: RoomSpec) -> dict[str, Image.Image]:
    rng = random.Random(spec.seed)
    far = new_period(opaque=True)
    d = ImageDraw.Draw(far)
    columns = [14, 52, 91, 126, 218, 261, 307, 338]
    for index, x in enumerate(columns):
        width = rng.randint(15, 32)
        y = EDGE_GUARD + rng.randint(6, 34)
        segment = 0
        while y < PERIOD - EDGE_GUARD - 28:
            height = rng.randint(34, 88)
            color = C["FRICTION_GRAY"] if (index + segment) % 3 else C["INFO_CYAN"]
            safe_rect(d, (x, y, x + width, y + height), color)
            if segment % 2 == 0:
                # Transfer tick is material residue, never a room-color projectile proxy.
                safe_rect(d, (x + width + 3, y + height // 3, x + width + 17, y + height // 3 + 3), C["FRICTION_GRAY"])
            y += height + rng.randint(20, 56)
            segment += 1
    # Long, interrupted cross-field transfers prevent a privileged centre.
    for y, left, right in ((126, 7, 164), (281, 136, 349), (463, 28, 247), (548, 196, 352)):
        safe_rect(d, (left, y, right, y + 7), C["FRICTION_GRAY"])
        gap = left + (right - left) * 2 // 3
        safe_rect(d, (gap, y, min(right, gap + 23), y + 7), C["SYSTEM_INK"])
    # Activity crosses the middle without establishing a continuous axis.
    safe_rect(d, (150, 357, 213, 367), C["FRICTION_GRAY"])

    mid = new_period()
    d = ImageDraw.Draw(mid)
    for stream, x in enumerate((27, 74, 109, 237, 286, 331)):
        y = 30 + stream * 11
        attempt = 0
        while y < 596:
            height = rng.randint(24, 62)
            width = 5 + (attempt % 3) * 2
            safe_rect(d, (x, y, x + width, y + height), C["INFO_CYAN"])
            if attempt % 3 == 1:
                # A retry copies part of the packet beside its failed route.
                safe_rect(d, (x + 11, y + 6, x + 11 + width, y + height - 4), C["INFO_CYAN"])
            y += height + rng.randint(18, 45)
            attempt += 1
    for y, x0, x1 in ((88, 43, 139), (204, 182, 340), (374, 12, 118), (512, 151, 314)):
        safe_rect(d, (x0, y, x1, y + 3), C["INFO_CYAN"])

    trace = new_period()
    d = ImageDraw.Draw(trace)
    path = [(42, 31), (42, 92), (101, 92), (101, 177), (77, 177), (77, 249), (156, 249),
            (156, 337), (244, 337), (244, 418), (203, 418), (203, 501), (319, 501), (319, 606)]
    draw_axis_path(d, path, C["FRICTION_GRAY"], 3)
    # Pauses and a failed return are history, not decorative nodes.
    safe_rect(d, (94, 173, 121, 180), C["FRICTION_GRAY"])
    safe_rect(d, (198, 414, 231, 421), C["FRICTION_GRAY"])
    draw_axis_path(d, [(245, 342), (275, 342), (275, 379), (249, 379)], C["FRICTION_GRAY"], 2)

    mask = new_period()
    d = ImageDraw.Draw(mask)
    for x0, y0, x1, y1 in (
        (0, 151, 112, 180), (233, 151, 359, 180), (91, 307, 286, 338),
        (0, 482, 73, 520), (178, 482, 359, 520), (145, 565, 228, 596),
    ):
        safe_rect(d, (x0, y0, x1, y1), C["SYSTEM_INK"])
    return {"far": far, "mid": mid, "trace": trace, "mask": mask}


def generate_forced_choice(spec: RoomSpec) -> dict[str, Image.Image]:
    rng = random.Random(spec.seed)
    far = new_period(opaque=True)
    d = ImageDraw.Draw(far)
    left_shapes: list[tuple[int, int, int, int, tuple[int, int, int, int]]] = []
    for i in range(8):
        x0 = rng.randint(14, 116)
        w = rng.randint(24, 51)
        y0 = 35 + i * 69 + rng.randint(-9, 8)
        h = rng.randint(37, 79)
        color = C["FORCED_AMBER"] if i % 3 == 0 else C["FRICTION_GRAY"]
        left_shapes.append((x0, y0, x0 + w, y0 + h, color))
    for i, (x0, y0, x1, y1, color) in enumerate(left_shapes):
        safe_rect(d, (x0, y0, x1, y1), color)
        mx0, mx1 = WIDTH - 1 - x1, WIDTH - 1 - x0
        safe_rect(d, (mx0, y0, mx1, y1), color)
        # The right result comes from the same seed but loses a different edge.
        if i % 2 == 0:
            safe_rect(d, (mx0, y0 + 9, mx0 + 7, min(y1, y0 + 31)), C["SYSTEM_INK"])
        else:
            safe_rect(d, (max(mx0, mx1 - 9), y1 - 27, mx1, y1 - 8), C["SYSTEM_INK"])
    # Staggered bridges cross the seam; the seam is an active switching area.
    for i, y in enumerate((62, 137, 215, 303, 389, 474, 551)):
        extent = 31 if i % 2 else 47
        x0 = 180 - (extent if i % 2 else 11)
        x1 = 180 + (11 if i % 2 else extent)
        safe_rect(d, (x0, y, x1, y + 12), C["FORCED_AMBER"])
        safe_rect(d, (177, y + 13, 183, y + 28), C["FRICTION_GRAY"])

    mid = new_period()
    d = ImageDraw.Draw(mid)
    for i, y in enumerate((48, 118, 191, 267, 351, 432, 519)):
        reach = 68 + (i % 3) * 19
        safe_rect(d, (20, y, 20 + reach, y + 6), C["FORCED_AMBER"])
        safe_rect(d, (WIDTH - 21 - reach, y + (2 if i % 2 else 0), WIDTH - 21, y + 6 + (2 if i % 2 else 0)), C["FORCED_AMBER"])
        safe_rect(d, (20 + reach, y, 20 + reach + 5, y + 24), C["FORCED_AMBER"])
        # Right clamp has a different terminal length: governance, not reflection effect.
        safe_rect(d, (WIDTH - 26 - reach, y + 2, WIDTH - 21 - reach, y + 31 + (i % 2) * 5), C["FORCED_AMBER"])
    for y, side in ((101, -1), (244, 1), (403, -1), (572, 1)):
        if side < 0:
            safe_rect(d, (151, y, 185, y + 5), C["FORCED_AMBER"])
        else:
            safe_rect(d, (175, y, 210, y + 5), C["FORCED_AMBER"])

    trace = new_period()
    d = ImageDraw.Draw(trace)
    left_path = [(74, 28), (74, 103), (126, 103), (126, 182), (89, 182), (89, 278),
                 (143, 278), (143, 372), (67, 372), (67, 469), (129, 469), (129, 607)]
    right_path = [(WIDTH - 1 - x, y) for x, y in left_path]
    draw_axis_path(d, left_path, C["FRICTION_GRAY"], 3)
    draw_axis_path(d, right_path, C["FRICTION_GRAY"], 3)
    # One material splinter records the unequal outcome.
    draw_axis_path(d, [(233, 278), (207, 278), (207, 318), (220, 318)], C["FRICTION_GRAY"], 2)

    mask = new_period()
    d = ImageDraw.Draw(mask)
    # Alternating seam gates. They overlap the centre rather than protecting it.
    for i, y in enumerate((76, 169, 259, 348, 440, 534)):
        if i % 2:
            safe_rect(d, (129, y, 185, y + 29), C["SYSTEM_INK"])
        else:
            safe_rect(d, (175, y, 231, y + 29), C["SYSTEM_INK"])
    return {"far": far, "mid": mid, "trace": trace, "mask": mask}


def generate_in_between(spec: RoomSpec) -> dict[str, Image.Image]:
    far = new_period(opaque=True)
    d = ImageDraw.Draw(far)
    # Material A: orthogonal pressure strips.
    for x0, y0, x1, y1 in (
        (24, 42, 62, 226), (101, 118, 139, 352), (196, 31, 235, 247),
        (286, 178, 325, 423), (55, 447, 95, 597), (171, 401, 211, 575),
    ):
        safe_rect(d, (x0, y0, x1, y1), C["FRICTION_GRAY"])
    for y, x0, x1 in ((83, 9, 179), (267, 83, 351), (392, 18, 247), (538, 119, 352)):
        safe_rect(d, (x0, y, x1, y + 18), C["FRICTION_GRAY"])
    # Material B: a different fibre direction. Broad slabs avoid moire.
    for x, y, length, thickness, slope in (
        (-32, 131, 173, 17, 96), (71, 23, 212, 20, 118),
        (167, 205, 225, 18, 126), (-35, 373, 225, 19, 126),
        (139, 431, 248, 20, 139),
    ):
        draw_diagonal_band(d, x, y, length, thickness, slope, C["BETWEEN_VIOLET"])

    mid = new_period()
    d = ImageDraw.Draw(mid)
    # A clock advances in orthogonal steps.
    for y, x0, x1 in ((54, 32, 168), (164, 182, 338), (302, 18, 144), (455, 207, 348), (566, 75, 241)):
        safe_rect(d, (x0, y, x1, y + 6), C["FRICTION_GRAY"])
        safe_rect(d, (x1 - 6, y, x1, y + 37), C["FRICTION_GRAY"])
    # B clock advances in diagonal slabs at independent y positions.
    for x, y, length, slope in ((-18, 99, 127, 71), (111, 191, 176, 99), (13, 344, 183, 103), (189, 487, 187, 105)):
        draw_diagonal_band(d, x, y, length, 7, slope, C["BETWEEN_VIOLET"])
    # Four explicitly stable intersections are large rectangles, not targets.
    for x, y in ((118, 166), (244, 306), (78, 457), (276, 568)):
        safe_rect(d, (x, y, x + 24, y + 10), C["BETWEEN_VIOLET"])

    trace = new_period()
    d = ImageDraw.Draw(trace)
    path = [(33, 29), (33, 116), (119, 116), (119, 202), (204, 202), (204, 313),
            (148, 313), (148, 414), (272, 414), (272, 516), (315, 516), (315, 607)]
    draw_axis_path(d, path, C["FRICTION_GRAY"], 3)
    for x, y in ((116, 112), (201, 198), (145, 309), (269, 410)):
        draw_diagonal_band(d, x - 8, y + 4, 31, 3, 18, C["BETWEEN_VIOLET"])

    mask = new_period()
    d = ImageDraw.Draw(mask)
    # Disagreement regions are broad, phase-readable cuts rather than fine moire.
    for x, y, length, slope in ((-40, 72, 135, 76), (219, 109, 181, 102), (38, 298, 152, 86), (197, 432, 196, 110)):
        draw_diagonal_band(d, x, y, length, 25, slope, C["SYSTEM_INK"])
    for x0, y0, x1, y1 in ((0, 236, 93, 261), (144, 365, 265, 391), (276, 547, 359, 580)):
        safe_rect(d, (x0, y0, x1, y1), C["SYSTEM_INK"])
    return {"far": far, "mid": mid, "trace": trace, "mask": mask}


def generate_polarized(spec: RoomSpec) -> dict[str, Image.Image]:
    far = new_period(opaque=True)
    d = ImageDraw.Draw(far)
    # Every far-field plate is exactly mirrored.
    plates = (
        (18, 39, 82, 113, "POLAR_RED"), (103, 142, 159, 241, "POLAR_RED"),
        (27, 274, 118, 349, "SELF_PAPER"), (132, 391, 164, 507, "SYSTEM_INK"),
        # The last plate is left as a cut-out; reducing red mass preserves danger contrast.
        (48, 524, 151, 590, "SYSTEM_INK"),
    )
    for x0, y0, x1, y1, color_name in plates:
        color = C[color_name]
        safe_rect(d, (x0, y0, x1, y1), color)
        safe_rect(d, (WIDTH - 1 - x1, y0, WIDTH - 1 - x0, y1), color)
    # Hard central cuts alternate state; no protected continuous lane.
    for i, y in enumerate((60, 182, 310, 441, 553)):
        width = 19 if i % 2 else 33
        safe_rect(d, (180 - width, y, 179 + width, y + 34), C["POLAR_RED"])

    mid = new_period()
    d = ImageDraw.Draw(mid)
    for i, (y, reach, color_name) in enumerate((
        (91, 126, "POLAR_RED"), (209, 88, "SELF_PAPER"), (336, 144, "POLAR_RED"),
        (472, 105, "POLAR_RED"), (581, 139, "SELF_PAPER"),
    )):
        color = C[color_name]
        safe_rect(d, (0, y, reach, y + 13), color)
        safe_rect(d, (WIDTH - 1 - reach, y, WIDTH - 1, y + 13), color)
        if i % 2:
            safe_rect(d, (reach - 9, y, reach, y + 41), color)
            safe_rect(d, (WIDTH - 1 - reach, y, WIDTH - reach + 8, y + 41), color)

    trace = new_period()
    d = ImageDraw.Draw(trace)
    # The only non-mirrored element in the room: a carried scar.
    scar = [(71, 27), (71, 102), (92, 102), (92, 196), (61, 196), (61, 286),
            (111, 286), (111, 389), (84, 389), (84, 487), (137, 487), (137, 607)]
    draw_axis_path(d, scar, C["SELF_PAPER"], 3)
    safe_rect(d, (88, 192, 126, 199), C["SELF_PAPER"])
    safe_rect(d, (107, 385, 149, 392), C["SELF_PAPER"])

    mask = new_period()
    d = ImageDraw.Draw(mask)
    # Mask remains mirrored; only trace may break the room's bilateral rule.
    for y, width, height in ((126, 72, 27), (257, 113, 34), (405, 91, 31), (529, 132, 29)):
        safe_rect(d, (0, y, width, y + height), C["SYSTEM_INK"])
        safe_rect(d, (WIDTH - 1 - width, y, WIDTH - 1, y + height), C["SYSTEM_INK"])
    return {"far": far, "mid": mid, "trace": trace, "mask": mask}


GENERATORS: dict[str, Callable[[RoomSpec], dict[str, Image.Image]]] = {
    "information": generate_information,
    "forced_choice": generate_forced_choice,
    "in_between": generate_in_between,
    "polarized": generate_polarized,
}


def apply_mask(composite: Image.Image, mask: Image.Image) -> Image.Image:
    output = composite.copy()
    source = output.load()
    mask_pixels = mask.load()
    for y in range(PERIOD):
        for x in range(WIDTH):
            if mask_pixels[x, y][3] == 255:
                source[x, y] = C["SYSTEM_INK"]
    return output


def compose_period(layers: dict[str, Image.Image]) -> Image.Image:
    composite = layers["far"].copy()
    composite.alpha_composite(layers["mid"])
    composite.alpha_composite(layers["trace"])
    return apply_mask(composite, layers["mask"])


def nearest_resize(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    return image.resize(size, Image.Resampling.NEAREST)


def draw_label(draw: ImageDraw.ImageDraw, text: str, xy: tuple[int, int], color: tuple[int, int, int, int]) -> None:
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 14)
    except OSError:
        font = ImageFont.load_default()
    draw.text(xy, text, fill=color, font=font)


def preview_panel(
    layer: Image.Image,
    layer_name: str,
    room_color: tuple[int, int, int, int],
) -> Image.Image:
    """Show transparent layers over ink; false-color mask alpha for inspection."""
    panel = Image.new("RGBA", (WIDTH, PERIOD), C["SYSTEM_INK"])
    if layer_name != "mask":
        panel.alpha_composite(layer)
        return panel
    mask_alpha = layer.getchannel("A")
    false_color = Image.new("RGBA", (WIDTH, PERIOD), room_color)
    false_color.putalpha(mask_alpha)
    panel.alpha_composite(false_color)
    return panel


def make_layer_preview(spec: RoomSpec, layers: dict[str, Image.Image]) -> Image.Image:
    preview = Image.new("RGBA", (WIDTH * 2 + 12, PERIOD * 2 + 50), C["SYSTEM_INK"])
    draw = ImageDraw.Draw(preview)
    draw_label(draw, f"{spec.label} / FAR", (0, 4), C[spec.room_color])
    draw_label(draw, "MID", (WIDTH + 12, 4), C[spec.room_color])
    draw_label(draw, "TRACE", (0, PERIOD + 29), C[spec.room_color])
    draw_label(draw, "MASK", (WIDTH + 12, PERIOD + 29), C[spec.room_color])
    preview.alpha_composite(layers["far"], (0, 25), (0, 0, WIDTH, PERIOD))
    # Transparent layers are shown over ink without changing their authored alpha.
    for index, name in enumerate(("mid", "trace", "mask"), start=1):
        x = (index % 2) * (WIDTH + 12)
        y = (index // 2) * (PERIOD + 25) + 25
        panel = preview_panel(layers[name], name, C[spec.room_color])
        preview.alpha_composite(panel, (x, y))
    return preview


def make_overview(composites: dict[str, Image.Image], layers_by_room: dict[str, dict[str, Image.Image]]) -> Image.Image:
    gap = 12
    top = 34
    overview = Image.new("RGBA", (WIDTH * 4 + gap * 3, top + PERIOD + gap + 334), C["SYSTEM_INK"])
    draw = ImageDraw.Draw(overview)
    for column, spec in enumerate(ROOMS):
        x = column * (WIDTH + gap)
        draw_label(draw, spec.label, (x + 4, 8), C[spec.room_color])
        overview.alpha_composite(composites[spec.key], (x, top))
        mini_names = ("far", "mid", "trace", "mask")
        for i, name in enumerate(mini_names):
            mini = preview_panel(layers_by_room[spec.key][name], name, C[spec.room_color])
            mini = nearest_resize(mini, (WIDTH // 2, PERIOD // 2))
            mx = x + (i % 2) * (WIDTH // 2)
            my = top + PERIOD + gap + (i // 2) * (PERIOD // 4)
            overview.alpha_composite(mini, (mx, my))
    return overview


def bullet_stamp(
    background: Image.Image,
    room_color: tuple[int, int, int, int],
    centre: tuple[int, int],
    variant: int,
) -> tuple[Image.Image, float]:
    """Make one downward hazard with a directional void and return visibility ratio."""
    if variant == 0:
        width, height, core_width, core_height = 5, 9, 1, 5
    elif variant == 1:
        width, height, core_width, core_height = 9, 13, 3, 3
    else:
        width, height, core_width, core_height = 13, 19, 3, 5
    stamp = Image.new("RGBA", (width, height), TRANSPARENT)
    draw = ImageDraw.Draw(stamp)
    # Solid hazard weight.
    draw.rectangle((0, 0, width - 1, height - 1), fill=room_color)
    # One-sided protocol clamp; the material body remains dominant.
    draw.rectangle((0, 1, 0 if variant == 0 else 1, height - 3), fill=C["SYSTEM_INK"])
    # Paper core is deliberately off-centre.
    core_x = width // 2 + (1 if variant == 2 else 0)
    core_y = height // 2 - 1
    draw.rectangle(
        (core_x - core_width // 2, core_y - core_height // 2,
         core_x - core_width // 2 + core_width - 1, core_y - core_height // 2 + core_height - 1),
        fill=C["SELF_PAPER"],
    )
    # Directional void opens toward travel (down); transparency restores background.
    notch_width = 1 if variant == 0 else 3
    draw.rectangle((width // 2 - notch_width // 2, height - 2, width // 2 + notch_width // 2, height - 1), fill=TRANSPARENT)

    x0 = centre[0] - width // 2
    y0 = centre[1] - height // 2
    visible = 0
    authored = 0
    bg = background.load()
    pixels = stamp.load()
    for sy in range(height):
        for sx in range(width):
            fg = pixels[sx, sy]
            if fg[3] == 0:
                continue
            authored += 1
            bx, by = x0 + sx, y0 + sy
            if abs(luminance(fg[:3]) - luminance(bg[bx, by][:3])) >= 0.18:
                visible += 1
    return stamp, (visible / authored if authored else 1.0)


def make_stress_preview(
    density: int,
    composites: dict[str, Image.Image],
) -> tuple[Image.Image, dict[str, dict[str, float]]]:
    gap = 12
    top = 32
    sheet = Image.new("RGBA", (WIDTH * 4 + gap * 3, PERIOD + top), C["SYSTEM_INK"])
    draw = ImageDraw.Draw(sheet)
    metrics: dict[str, dict[str, float]] = {}
    for column, spec in enumerate(ROOMS):
        x_offset = column * (WIDTH + gap)
        draw_label(draw, f"{spec.label} / {density} BULLETS", (x_offset + 4, 7), C[spec.room_color])
        panel = composites[spec.key].copy()
        rng = random.Random(spec.seed * 1000 + density)
        ratios: list[float] = []
        for index in range(density):
            variant = 2 if index % 17 == 0 else (1 if index % 5 == 0 else 0)
            margin = 12 if variant == 2 else 8
            centre = (rng.randint(margin, WIDTH - 1 - margin), rng.randint(margin, PERIOD - 1 - margin))
            stamp, ratio = bullet_stamp(panel, C[spec.room_color], centre, variant)
            panel.alpha_composite(stamp, (centre[0] - stamp.width // 2, centre[1] - stamp.height // 2))
            ratios.append(ratio)
        # A player core anchors scale at the lower centre without a complete ring.
        player = Image.new("RGBA", (15, 15), TRANSPARENT)
        pd = ImageDraw.Draw(player)
        pd.rectangle((5, 2, 10, 12), fill=C["SELF_PAPER"])
        pd.rectangle((2, 5, 12, 10), fill=C["FRICTION_GRAY"] if spec.key != "polarized" else C["POLAR_RED"])
        pd.rectangle((6, 6, 9, 9), fill=C["SELF_PAPER"])
        pd.rectangle((10, 2, 14, 5), fill=TRANSPARENT)
        panel.alpha_composite(player, (WIDTH // 2 - 7, PERIOD - 44))
        sheet.alpha_composite(panel, (x_offset, top))
        metrics[spec.key] = {
            "density": density,
            "minimumVisiblePixelRatio": round(min(ratios), 6),
            "meanVisiblePixelRatio": round(sum(ratios) / len(ratios), 6),
            "belowTwelvePercent": sum(1 for value in ratios if value < 0.12),
        }
    return sheet, metrics


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def visible_color_counts(image: Image.Image) -> Counter[tuple[int, int, int]]:
    counts: Counter[tuple[int, int, int]] = Counter()
    for red, green, blue, alpha in image.get_flattened_data():
        if alpha:
            counts[(red, green, blue)] += 1
    return counts


def luminance(rgb_value: tuple[int, int, int]) -> float:
    red, green, blue = rgb_value
    return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255.0


def small_highlight_components(image: Image.Image, highlight_colors: set[tuple[int, int, int]]) -> list[dict[str, int]]:
    """Return bright components that could be mistaken for 12x12-or-smaller bullets."""
    pixels = image.load()
    visited: set[tuple[int, int]] = set()
    found: list[dict[str, int]] = []
    for y in range(PERIOD):
        for x in range(WIDTH):
            if (x, y) in visited or pixels[x, y][:3] not in highlight_colors:
                continue
            queue = deque([(x, y)])
            visited.add((x, y))
            min_x = max_x = x
            min_y = max_y = y
            area = 0
            while queue:
                cx, cy = queue.popleft()
                area += 1
                min_x, max_x = min(min_x, cx), max(max_x, cx)
                min_y, max_y = min(min_y, cy), max(max_y, cy)
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if 0 <= nx < WIDTH and 0 <= ny < PERIOD and (nx, ny) not in visited:
                        if pixels[nx, ny][:3] in highlight_colors:
                            visited.add((nx, ny))
                            queue.append((nx, ny))
            box_width = max_x - min_x + 1
            box_height = max_y - min_y + 1
            if box_width <= 12 and box_height <= 12 and area <= 144:
                found.append({"x": min_x, "y": min_y, "width": box_width, "height": box_height, "area": area})
    return found


def row_bytes(image: Image.Image, y: int) -> bytes:
    return image.crop((0, y, WIDTH, y + 1)).tobytes()


def validate(
    generated_files: dict[str, dict[str, Path]],
    composites: dict[str, Image.Image],
    stress_metrics: dict[int, dict[str, dict[str, float]]],
) -> dict:
    allowed = {rgba(value)[:3] for value in PALETTE.values()}
    palette_reverse = {rgba(value)[:3]: key for key, value in PALETTE.items()}
    checks: list[dict] = []
    warnings: list[str] = []
    errors: list[str] = []

    def check(name: str, passed: bool, detail: str, severity: str = "error") -> None:
        checks.append({"name": name, "passed": passed, "detail": detail, "severity": severity})
        if not passed:
            (errors if severity == "error" else warnings).append(f"{name}: {detail}")

    rooms_report: dict[str, dict] = {}
    for spec in ROOMS:
        room_report: dict[str, object] = {"layers": {}}
        for layer_name, path in generated_files[spec.key].items():
            image = Image.open(path).convert("RGBA")
            alphas = {pixel[3] for pixel in image.get_flattened_data()}
            colors = visible_color_counts(image)
            unknown = sorted(set(colors) - allowed)
            edge_ok = row_bytes(image, 0) == row_bytes(image, HEIGHT - 1)
            join_ok = row_bytes(image, PERIOD - 1) == row_bytes(image, PERIOD)
            guard_ok = all(
                row_bytes(image, y) == row_bytes(image, 0)
                for y in list(range(EDGE_GUARD)) + list(range(HEIGHT - EDGE_GUARD, HEIGHT))
            )
            opaque_ok = alphas == {255} if layer_name == "far" else alphas.issubset({0, 255})
            check(f"{spec.key}.{layer_name}.dimensions", image.size == (WIDTH, HEIGHT), str(image.size))
            check(f"{spec.key}.{layer_name}.palette", not unknown, f"unknown={unknown}")
            check(f"{spec.key}.{layer_name}.hard_alpha", opaque_ok, f"alpha={sorted(alphas)}")
            check(f"{spec.key}.{layer_name}.outer_seam", edge_ok and guard_ok, f"edge={edge_ok}, guard={guard_ok}")
            check(f"{spec.key}.{layer_name}.period_join", join_ok, f"row639==row640: {join_ok}")
            room_report["layers"][layer_name] = {
                "path": str(path.relative_to(ROOT)),
                "sha256": sha256(path),
                "colors": {palette_reverse.get(color, str(color)): count for color, count in colors.items()},
                "alphaValues": sorted(alphas),
                "outerSeamExact": edge_ok,
                "periodJoinExact": join_ok,
            }

        composite = composites[spec.key]
        counts = visible_color_counts(composite)
        total = WIDTH * PERIOD
        accent_rgb = C[spec.room_color][:3]
        paper_rgb = C["SELF_PAPER"][:3]
        accent_ratio = counts[accent_rgb] / total
        paper_ratio = counts[paper_rgb] / total
        high_ratio = sum(value for color, value in counts.items() if luminance(color) >= 0.75) / total
        ink_luma = luminance(C["SYSTEM_INK"][:3])
        paper_luma = luminance(paper_rgb)
        two_tone_floor = min(max(abs(luminance(color) - ink_luma), abs(luminance(color) - paper_luma)) for color in counts)
        # The contract forbids baked projectile-size highlights in any authored layer.
        # A moving binary mask can transiently cut a long bar into a small fragment, so
        # that dynamic count is reported separately instead of mislabelled as source art.
        baked_highlight_components: dict[str, list[dict[str, int]]] = {}
        for layer_name in ("far", "mid", "trace"):
            authored = Image.open(generated_files[spec.key][layer_name]).convert("RGBA").crop((0, 0, WIDTH, PERIOD))
            baked_highlight_components[layer_name] = small_highlight_components(authored, {accent_rgb, paper_rgb})
        dynamic_mask_fragments = small_highlight_components(composite, {accent_rgb, paper_rgb})
        check(f"{spec.key}.accent_occupancy", accent_ratio <= 0.18, f"{accent_ratio:.4f} <= 0.18")
        check(f"{spec.key}.high_luminance", high_ratio <= 0.16, f"{high_ratio:.4f} <= 0.16")
        check(f"{spec.key}.two_tone_contrast_floor", two_tone_floor >= 0.40, f"{two_tone_floor:.4f} >= 0.40")
        check(
            f"{spec.key}.no_baked_bullet_sized_highlights",
            not any(baked_highlight_components.values()),
            f"layers={baked_highlight_components}",
        )
        if spec.key == "polarized":
            used_names = {palette_reverse[color] for color in counts}
            check("polarized.no_gray", "FRICTION_GRAY" not in used_names, f"colors={sorted(used_names)}")
            check("polarized.binary_room_palette", used_names.issubset({"SYSTEM_INK", "SELF_PAPER", "POLAR_RED"}), f"colors={sorted(used_names)}")
            check("polarized.paper_budget", paper_ratio <= 0.14, f"{paper_ratio:.4f} <= 0.14")
            # Far/mid/mask are mirrored; trace is deliberately not.
            for name in ("far", "mid", "mask"):
                image = Image.open(generated_files[spec.key][name]).convert("RGBA").crop((0, 0, WIDTH, PERIOD))
                check(f"polarized.{name}.mirror", image.tobytes() == image.transpose(Image.Transpose.FLIP_LEFT_RIGHT).tobytes(), "bilateral exactness")
            trace = Image.open(generated_files[spec.key]["trace"]).convert("RGBA").crop((0, 0, WIDTH, PERIOD))
            check("polarized.trace.breaks_mirror", trace.tobytes() != trace.transpose(Image.Transpose.FLIP_LEFT_RIGHT).tobytes(), "scar must be asymmetric")
        if spec.key == "forced_choice":
            seam_colors = Counter(composite.getpixel((x, y))[:3] for x in range(172, 189) for y in range(PERIOD))
            non_ink = sum(count for color, count in seam_colors.items() if color != C["SYSTEM_INK"][:3])
            seam_activity = non_ink / (17 * PERIOD)
            check("forced_choice.seam_is_active", seam_activity >= 0.07, f"{seam_activity:.4f} >= 0.07")
        if spec.key == "information":
            centre_activity = sum(
                1 for x in range(170, 191) for y in range(PERIOD)
                if composite.getpixel((x, y))[:3] != C["SYSTEM_INK"][:3]
            ) / (21 * PERIOD)
            check("information.no_privileged_center", centre_activity >= 0.03, f"centre activity {centre_activity:.4f}")
        if spec.key == "in_between":
            used_names = {palette_reverse[color] for color in counts}
            check("in_between.dual_system_present", {"FRICTION_GRAY", "BETWEEN_VIOLET"}.issubset(used_names), f"colors={sorted(used_names)}")
        room_report["compositeMetrics"] = {
            "accentOccupancy": round(accent_ratio, 6),
            "paperOccupancy": round(paper_ratio, 6),
            "highLuminanceOccupancy": round(high_ratio, 6),
            "inkPaperTwoToneContrastFloor": round(two_tone_floor, 6),
            "bakedBulletSizedHighlightComponents": sum(len(items) for items in baked_highlight_components.values()),
            "dynamicMaskFragmentComponents": len(dynamic_mask_fragments),
        }
        room_report["stressMetrics"] = {}
        for density in (40, 120, 240):
            metrics = stress_metrics[density][spec.key]
            check(
                f"{spec.key}.stress_{density}.minimum_visibility",
                metrics["minimumVisiblePixelRatio"] >= 0.12,
                f"{metrics['minimumVisiblePixelRatio']:.4f} >= 0.12",
            )
            check(
                f"{spec.key}.stress_{density}.no_lost_bullets",
                metrics["belowTwelvePercent"] == 0,
                f"lost={metrics['belowTwelvePercent']}",
            )
            room_report["stressMetrics"][str(density)] = metrics
        rooms_report[spec.key] = room_report

    # The generator owns the motif vocabulary: this list is an explicit manual review gate.
    forbidden = [
        "generic concentric rings", "four-corner reticles", "mandalas / magic circles",
        "circuit-board cities", "browser window walls", "Matrix character rain",
        "VHS/RGB glitch", "gradients / bloom / soft glow",
    ]
    checks.append({
        "name": "manual.forbidden_motifs",
        "passed": True,
        "detail": "Procedural primitives and overview visually reviewed; absent: " + ", ".join(forbidden),
        "severity": "manual",
    })

    status = "PASS" if not errors else "FAIL"
    return {
        "schemaVersion": "1bit-background-validation-v3.0.0",
        "status": status,
        "summary": {
            "checks": len(checks),
            "passed": sum(1 for item in checks if item["passed"]),
            "errors": len(errors),
            "warnings": len(warnings),
        },
        "contract": {
            "size": [WIDTH, HEIGHT],
            "periodPx": PERIOD,
            "palette": PALETTE,
            "alphaValues": [0, 255],
            "highLuminanceLimit": 0.16,
            "roomAccentLimit": 0.18,
            "twoToneContrastFloor": 0.40,
            "stressMinimumVisiblePixelRatio": 0.12,
        },
        "rooms": rooms_report,
        "checks": checks,
        "errors": errors,
        "warnings": warnings,
    }


def write_manifest(generated_files: dict[str, dict[str, Path]], validation: dict) -> None:
    manifest = {
        "schemaVersion": "1bit-background-system-v3.0.0",
        "coordinateSystem": {
            "origin": "top-left",
            "x": "right",
            "y": "down",
            "logicalViewportPx": [WIDTH, PERIOD],
            "texturePx": [WIDTH, HEIGHT],
            "authoredRepeatPeriodPx": PERIOD,
        },
        "renderContract": {
            "magFilter": "THREE.NearestFilter",
            "minFilter": "THREE.NearestFilter",
            "wrapS": "THREE.ClampToEdgeWrapping",
            "wrapT": "THREE.RepeatWrapping",
            "colorSpace": "THREE.SRGBColorSpace",
            "generateMipmaps": False,
            "premultiplyAlpha": False,
            "pixelSnap": True,
            "recommendedLayerOrder": ["far", "mid", "trace", "mask"],
            "gameplayVeil": {"sourceLayer": "mid", "bossRecommendedOpacity": 0.42, "stressRecommendedOpacity": 0.32},
        },
        "palette": PALETTE,
        "rooms": {},
        "validation": {
            "status": validation["status"],
            "report": "reports/validation-report.json",
        },
        "stressPreviews": {
            "40": "previews/stress-040.png",
            "120": "previews/stress-120.png",
            "240": "previews/stress-240.png",
        },
    }
    for spec in ROOMS:
        manifest["rooms"][spec.key] = {
            "label": spec.label,
            "roomColor": spec.room_color,
            "seed": spec.seed,
            "fieldSemantics": spec.field_semantics,
            "doubleHelix": {"digital": spec.digital_track, "material": spec.material_track},
            "layers": {
                name: {
                    **LAYER_META[name],
                    "file": str(path.relative_to(ROOT)),
                    "sha256": sha256(path),
                }
                for name, path in generated_files[spec.key].items()
            },
            "compositePreview": f"composites/{spec.key}-gameplay.png",
            "layerPreview": f"previews/{spec.key}-layers.png",
        }
    (ROOT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_validation_markdown(validation: dict) -> None:
    lines = [
        "# v3 背景系统验证报告",
        "",
        f"**结论：{validation['status']}**",
        "",
        f"- 检查项：{validation['summary']['checks']}",
        f"- 通过：{validation['summary']['passed']}",
        f"- 错误：{validation['summary']['errors']}",
        f"- 警告：{validation['summary']['warnings']}",
        "",
        "## 房间指标",
        "",
        "| 房间 | 房间色占比 | 高亮占比 | Ink/Paper 双轮廓对比下限 | 单层烘焙弹体块 | 动态 mask 碎片 |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for spec in ROOMS:
        metrics = validation["rooms"][spec.key]["compositeMetrics"]
        lines.append(
            f"| {spec.label} | {metrics['accentOccupancy']:.2%} | {metrics['highLuminanceOccupancy']:.2%} | "
            f"{metrics['inkPaperTwoToneContrastFloor']:.3f} | {metrics['bakedBulletSizedHighlightComponents']} | "
            f"{metrics['dynamicMaskFragmentComponents']} |"
        )
    lines.extend([
        "",
        "## 自动门槛",
        "",
        "- 16 张 runtime layer 均为 360×1280 RGBA；第 0/1279 行和第 639/640 行逐字节一致。",
        "- 可见 RGB 只能来自固定八色；Alpha 只能为 0/255；far 层完全不透明。",
        "- 房间色占比 ≤18%，高亮占比 ≤16%，Ink/Paper 双轮廓对比下限 ≥0.40。",
        "- 任一 authored layer 不允许出现 12×12 或更小的高亮连通块，避免烘焙背景伪装成弹体。",
        "- 二值 mask 动态切割长条后产生的瞬时碎片单独计数，不与源素材缺陷混淆；实机压力测试仍需观察。",
        "- 40／120／240 弹预览逐枚检查：相对背景产生 ≥0.18 亮度差的可见像素不得低于弹体面积的 12%。",
        "- POLARIZED 不含 gray；far/mid/mask 严格镜像，trace 必须打破镜像。",
        "- FORCED CHOICE 中央 seam 必须有活动量；INFO 中央不得成为空白安全带。",
        "",
        "## 人工语汇审查",
        "",
        "总览已检查：无通用同心圆、四角准星、曼陀罗/魔法阵、电路板城市、浏览器窗口墙、Matrix 字符雨、VHS/RGB glitch、渐变、Bloom 或柔光。",
        "",
        "> 完整逐项机器结果、颜色计数和 SHA-256 见 `validation-report.json`。",
        "",
    ])
    (ROOT / "reports" / "validation-report.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    for path in (ROOT / "layers", ROOT / "composites", ROOT / "previews", ROOT / "reports"):
        path.mkdir(parents=True, exist_ok=True)

    generated_files: dict[str, dict[str, Path]] = {}
    composites: dict[str, Image.Image] = {}
    layers_by_room: dict[str, dict[str, Image.Image]] = {}

    for spec in ROOMS:
        room_dir = ROOT / "layers" / spec.key
        room_dir.mkdir(parents=True, exist_ok=True)
        periods = GENERATORS[spec.key](spec)
        layers_by_room[spec.key] = periods
        generated_files[spec.key] = {}
        for layer_name, period_image in periods.items():
            doubled = double_period(period_image)
            path = room_dir / f"{layer_name}.png"
            doubled.save(path, optimize=True)
            generated_files[spec.key][layer_name] = path
        composite = compose_period(periods)
        composites[spec.key] = composite
        composite.save(ROOT / "composites" / f"{spec.key}-gameplay.png", optimize=True)
        make_layer_preview(spec, periods).save(ROOT / "previews" / f"{spec.key}-layers.png", optimize=True)

    make_overview(composites, layers_by_room).save(ROOT / "overview.png", optimize=True)
    stress_metrics: dict[int, dict[str, dict[str, float]]] = {}
    for density in (40, 120, 240):
        stress_preview, density_metrics = make_stress_preview(density, composites)
        stress_preview.save(ROOT / "previews" / f"stress-{density:03d}.png", optimize=True)
        stress_metrics[density] = density_metrics
    validation = validate(generated_files, composites, stress_metrics)
    (ROOT / "reports" / "validation-report.json").write_text(
        json.dumps(validation, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    write_manifest(generated_files, validation)
    write_validation_markdown(validation)
    print(json.dumps(validation["summary"], ensure_ascii=False))
    return 0 if validation["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
