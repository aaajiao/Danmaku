#!/usr/bin/env python3
"""Build the deterministic 1BIT STG v3 UI atlas and 360x640 mockups."""

from __future__ import annotations

import hashlib
import json
import math
import random
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
MOCKUPS = ROOT / "mockups"
ATLAS_DIR = ROOT / "atlas"
MANIFESTS = ROOT / "manifests"
FONT_PATH = ROOT / "fonts" / "NotoSansSC-Variable.ttf"

W, H = 360, 640
INK = "#08090D"
PAPER = "#EFE9DA"
GRAY = "#7D8087"
INFO = "#17A7CA"
AMBER = "#D6982B"
VIOLET = "#7851B7"
RED = "#B7463C"
MAGENTA = "#F02A92"
BLACK_2 = "#11131A"
BLACK_3 = "#171A20"

PALETTE = {
    "SYSTEM_INK": INK,
    "SELF_PAPER": PAPER,
    "FRICTION_GRAY": GRAY,
    "INFO_CYAN": INFO,
    "FORCED_AMBER": AMBER,
    "BETWEEN_VIOLET": VIOLET,
    "POLAR_RED": RED,
    "OVERRIDE_MAGENTA": MAGENTA,
}


def ensure_dirs() -> None:
    for path in (MOCKUPS, ATLAS_DIR, MANIFESTS):
        path.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=None)
def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_PATH), size=size)


def canvas(bg: str = INK) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    im = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(im)
    d.fontmode = "1"
    return im, d


def txt(
    d: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    value: str,
    size: int = 10,
    fill: str = PAPER,
    anchor: str | None = None,
    stroke: int = 0,
    stroke_fill: str = INK,
) -> None:
    d.text(
        xy,
        value,
        font=font(size),
        fill=fill,
        anchor=anchor,
        stroke_width=stroke,
        stroke_fill=stroke_fill,
    )


def fit_txt(
    d: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    value: str,
    max_width: int,
    start_size: int,
    fill: str = PAPER,
) -> int:
    size = start_size
    while size > 6 and d.textbbox((0, 0), value, font=font(size))[2] > max_width:
        size -= 1
    txt(d, xy, value, size, fill)
    return size


def line(d: ImageDraw.ImageDraw, pts: list[tuple[int, int]], fill: str = PAPER, width: int = 1) -> None:
    d.line(pts, fill=fill, width=width, joint="curve")


def broken_line(
    d: ImageDraw.ImageDraw,
    a: tuple[int, int],
    b: tuple[int, int],
    fill: str = GRAY,
    dash: int = 4,
    gap: int = 3,
    width: int = 1,
) -> None:
    x1, y1 = a
    x2, y2 = b
    dist = max(1.0, math.hypot(x2 - x1, y2 - y1))
    ux, uy = (x2 - x1) / dist, (y2 - y1) / dist
    p = 0.0
    while p < dist:
        q = min(dist, p + dash)
        line(d, [(round(x1 + ux * p), round(y1 + uy * p)), (round(x1 + ux * q), round(y1 + uy * q))], fill, width)
        p += dash + gap


def corner(d: ImageDraw.ImageDraw, x: int, y: int, sx: int, sy: int, color: str = PAPER, length: int = 10) -> None:
    line(d, [(x, y), (x + sx * length, y)], color)
    line(d, [(x, y), (x, y + sy * length)], color)


def open_frame(
    d: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    color: str = PAPER,
    cut: int = 18,
    width: int = 1,
) -> None:
    x1, y1, x2, y2 = box
    line(d, [(x1, y1), (x2 - cut, y1)], color, width)
    line(d, [(x2, y1 + cut), (x2, y2)], color, width)
    line(d, [(x2, y2), (x1 + cut, y2)], color, width)
    line(d, [(x1, y2 - cut), (x1, y1)], color, width)


def section(d: ImageDraw.ImageDraw, y: int, zh: str, en: str, color: str = PAPER) -> None:
    d.rectangle((12, y + 4, 16, y + 8), fill=color)
    txt(d, (22, y), zh, 11, color)
    txt(d, (348, y + 1), en.upper(), 7, GRAY, "ra")
    line(d, [(12, y + 17), (124, y + 17)], color)
    broken_line(d, (132, y + 17), (348, y + 17), GRAY, 2, 4)


def segmented_bar(
    d: ImageDraw.ImageDraw,
    x: int,
    y: int,
    count: int,
    active: int,
    color: str,
    seg_w: int = 8,
    seg_h: int = 4,
    gap: int = 2,
    vertical: bool = False,
) -> None:
    for i in range(count):
        xx = x if vertical else x + i * (seg_w + gap)
        yy = y + (count - 1 - i) * (seg_h + gap) if vertical else y
        outline = color if i < active else GRAY
        d.rectangle((xx, yy, xx + seg_w - 1, yy + seg_h - 1), outline=outline)
        if i < active:
            d.rectangle((xx + 1, yy + 1, xx + seg_w - 2, yy + seg_h - 2), fill=color)


def metric_bar(
    d: ImageDraw.ImageDraw,
    y: int,
    zh: str,
    en: str,
    value: float,
    color: str,
    value_text: str | None = None,
) -> None:
    txt(d, (18, y), zh, 10, PAPER)
    txt(d, (92, y + 1), en.upper(), 7, GRAY)
    x1, x2 = 166, 324
    line(d, [(x1, y + 8), (x2, y + 8)], GRAY)
    for x in range(x1, x2 + 1, 16):
        line(d, [(x, y + 5), (x, y + 11)], GRAY)
    fill_to = x1 + int((x2 - x1) * max(0.0, min(1.0, value)))
    line(d, [(x1, y + 8), (fill_to, y + 8)], color, 3)
    txt(d, (344, y + 1), value_text or f"{value:.2f}", 8, color, "ra")


def toggle(d: ImageDraw.ImageDraw, x: int, y: int, on: bool, color: str = PAPER) -> None:
    d.rectangle((x, y, x + 27, y + 11), outline=GRAY)
    if on:
        d.rectangle((x + 16, y + 2, x + 25, y + 9), fill=color)
        line(d, [(x + 3, y + 6), (x + 12, y + 6)], GRAY)
    else:
        d.rectangle((x + 2, y + 2, x + 11, y + 9), fill=GRAY)
        line(d, [(x + 15, y + 6), (x + 24, y + 6)], GRAY)


def button(d: ImageDraw.ImageDraw, y: int, zh: str, en: str, selected: bool = False, color: str = PAPER) -> None:
    x1, x2 = 30, 330
    if selected:
        d.rectangle((x1, y, x1 + 3, y + 26), fill=color)
        line(d, [(x1 + 8, y + 26), (x2 - 40, y + 26)], color)
        d.rectangle((x2 - 7, y + 8, x2, y + 15), outline=color)
    else:
        broken_line(d, (x1 + 8, y + 26), (x2 - 40, y + 26), GRAY, 2, 5)
    txt(d, (x1 + 12, y + 2), zh, 13 if selected else 12, color if selected else PAPER)
    txt(d, (x2 - 12, y + 7), en.upper(), 7, GRAY, "ra")


def paper_noise(d: ImageDraw.ImageDraw, seed: int, color: str = GRAY, count: int = 100) -> None:
    rng = random.Random(seed)
    for _ in range(count):
        x = rng.randrange(8, W - 8)
        y = rng.randrange(8, H - 8)
        if rng.random() < 0.78:
            d.point((x, y), fill=color)
        else:
            line(d, [(x, y), (x + rng.randrange(2, 6), y)], color)


def draw_player(d: ImageDraw.ImageDraw, x: int, y: int, color: str = INFO, scale: int = 1, focus: bool = False) -> None:
    r = 8 * scale
    # Incomplete material petals; no full ring.
    d.rectangle((x - r, y - 2 * scale, x - 3 * scale, y + 2 * scale), fill=color)
    d.rectangle((x + 3 * scale, y - 4 * scale, x + r, y), fill=color)
    d.rectangle((x - 2 * scale, y - r, x + 2 * scale, y - 3 * scale), fill=GRAY)
    d.rectangle((x, y + 3 * scale, x + 4 * scale, y + r), fill=GRAY)
    core = 2 * scale if focus else 3 * scale
    d.rectangle((x - core, y - core, x + core, y + core), fill=PAPER)
    d.rectangle((x + core, y - core, x + core + scale, y), fill=INK)


def draw_bullet(d: ImageDraw.ImageDraw, x: int, y: int, vx: int, vy: int, color: str = PAPER, size: int = 4) -> None:
    d.rectangle((x - size, y - size, x + size, y + size), fill=color)
    # Directional alpha-like void is represented by the background in mockups.
    if abs(vx) >= abs(vy):
        if vx >= 0:
            d.rectangle((x + size - 2, y - 1, x + size, y + 1), fill=INK)
        else:
            d.rectangle((x - size, y - 1, x - size + 2, y + 1), fill=INK)
    else:
        if vy >= 0:
            d.rectangle((x - 1, y + size - 2, x + 1, y + size), fill=INK)
        else:
            d.rectangle((x - 1, y - size, x + 1, y - size + 2), fill=INK)


def draw_game_field(d: ImageDraw.ImageDraw, room: str, seed: int = 3, boss: bool = False) -> None:
    color = {"INFO": INFO, "FORCED": AMBER, "BETWEEN": VIOLET, "POLAR": RED}[room]
    rng = random.Random(seed)
    # Far: incomplete protocol slabs; deliberately no central symmetry.
    for i in range(9):
        x = 18 + (i * 41 + seed * 17) % 314
        y = 86 + (i * 73) % 454
        w = 14 + (i * 7) % 42
        if i % 3 == 0:
            d.rectangle((x, y, min(348, x + w), y + 1), fill=BLACK_3)
        else:
            broken_line(d, (x, y), (min(348, x + w), y), BLACK_3, 3, 6)
    # Mid: room process, with one-sided registration.
    if room == "INFO":
        for i in range(8):
            x = 24 + (i * 47) % 304
            y = 112 + (i * 61) % 380
            d.rectangle((x, y, x + 13, y + 3), fill=INFO if i % 3 == 0 else BLACK_3)
            if i % 2 == 0:
                d.rectangle((x + 15, y, x + 18, y + 3), outline=GRAY)
    elif room == "FORCED":
        line(d, [(176, 72), (176, 568)], AMBER)
        line(d, [(181, 72), (181, 202)], GRAY)
        line(d, [(181, 236), (181, 568)], GRAY)
        for y in range(120, 548, 64):
            line(d, [(38, y), (158, y)], BLACK_3, 2)
            line(d, [(198, y + 8), (330, y + 8)], BLACK_3, 2)
    elif room == "BETWEEN":
        for y in range(110, 560, 56):
            broken_line(d, (32, y), (228, y), VIOLET if y % 112 else GRAY, 6, 8)
            broken_line(d, (104, y + 9), (338, y + 9), BLACK_3, 4, 7)
    else:
        for y in range(96, 560, 72):
            d.rectangle((18, y, 164, y + 3), fill=RED if (y // 72) % 2 else BLACK_3)
            d.rectangle((196, y + 12, 342, y + 15), fill=RED if (y // 72) % 2 else BLACK_3)
    # Trace: a previous path that is history, not decoration.
    pts = []
    for i in range(18):
        xx = 52 + i * 15
        yy = 518 - int(22 * math.sin(i * 0.71)) - i * 4
        pts.append((xx, yy))
    broken_line(d, pts[0], pts[5], GRAY, 1, 4)
    for a, b in zip(pts[5:-1], pts[6:]):
        if rng.random() > 0.34:
            line(d, [a, b], BLACK_3)
    if boss:
        return
    for i in range(38):
        a = i * 0.57 + 0.4
        radius = 34 + i * 3.7
        x = int(180 + math.cos(a) * radius * 0.77)
        y = int(218 + math.sin(a) * radius)
        if 15 < x < 345 and 80 < y < 565:
            draw_bullet(d, x, y, int(math.cos(a) * 4), int(math.sin(a) * 4), PAPER if i % 4 else color, 3 if i % 3 else 4)
    draw_player(d, 180, 526, color, 1, False)


def draw_hud(d: ImageDraw.ImageDraw, room: str, light: int, gaze: int, override: int) -> None:
    color = {"INFO": INFO, "FORCED": AMBER, "BETWEEN": VIOLET, "POLAR": RED}[room]
    # Top edge has two independent instruments and a large unboxed void between.
    corner(d, 12, 12, 1, 1, PAPER, 8)
    txt(d, (24, 8), "光", 10, PAPER)
    txt(d, (43, 10), "LIGHT", 6, GRAY)
    segmented_bar(d, 24, 25, 8, light, color, 8, 4, 2)
    txt(d, (336, 8), "凝视", 9, PAPER, "ra")
    txt(d, (336, 21), "GAZE", 6, GRAY, "ra")
    segmented_bar(d, 342, 35, 6, gaze, PAPER, 5, 5, 2, True)
    # Room identity sits at the scene edge; it does not occupy a panel.
    txt(d, (12, 592), room, 8, color)
    room_zh = {"INFO": "信息溢出", "FORCED": "强制对齐", "BETWEEN": "夹层", "POLAR": "极化"}[room]
    txt(d, (12, 604), room_zh, 9, PAPER)
    broken_line(d, (12, 619), (116, 619), color, 3, 3)
    txt(d, (348, 588), "改写", 9, PAPER, "ra")
    txt(d, (348, 600), "OVERRIDE", 6, GRAY, "ra")
    segmented_bar(d, 270, 614, 8, override, MAGENTA if override >= 8 else color, 7, 4, 2)


def draw_behavior_icon(d: ImageDraw.ImageDraw, kind: str, x: int, y: int, color: str) -> None:
    if kind == "signal":
        d.rectangle((x - 2, y - 2, x + 2, y + 2), fill=PAPER)
        line(d, [(x + 5, y), (x + 12, y)], color)
        line(d, [(x + 9, y - 3), (x + 12, y), (x + 9, y + 3)], color)
    elif kind == "focus":
        d.rectangle((x - 8, y - 1, x - 3, y + 1), fill=GRAY)
        d.rectangle((x + 3, y - 1, x + 8, y + 1), fill=GRAY)
        d.rectangle((x - 2, y - 2, x + 2, y + 2), fill=PAPER)
    elif kind == "gaze":
        line(d, [(x - 10, y - 5), (x - 3, y), (x - 10, y + 5)], PAPER)
        line(d, [(x + 10, y - 5), (x + 3, y), (x + 10, y + 5)], PAPER)
        d.rectangle((x - 2, y - 2, x + 2, y + 2), fill=color)
    elif kind == "override":
        line(d, [(x - 9, y - 7), (x - 3, y - 1), (x - 6, y + 7), (x + 2, y + 1), (x + 8, y + 6)], MAGENTA, 2)
    elif kind == "scar":
        line(d, [(x - 10, y - 5), (x - 2, y), (x - 5, y + 8)], GRAY, 2)
        line(d, [(x - 2, y), (x + 8, y - 2)], color)
    elif kind == "ghost":
        broken_line(d, (x - 10, y + 5), (x + 9, y - 5), GRAY, 2, 2)
        d.rectangle((x + 7, y - 7, x + 10, y - 4), fill=PAPER)
    elif kind == "witness":
        d.rectangle((x - 8, y - 5, x - 3, y + 4), outline=GRAY)
        d.rectangle((x + 3, y - 3, x + 8, y + 6), outline=color)
        line(d, [(x - 2, y), (x + 2, y)], PAPER)
    else:
        open_frame(d, (x - 10, y - 7, x + 10, y + 7), color, 5)
        d.rectangle((x - 3, y - 2, x + 4, y + 2), fill=PAPER)


def fingerprint(d: ImageDraw.ImageDraw, box: tuple[int, int, int, int], seed: int, color: str, density: float = 0.46) -> None:
    x1, y1, x2, y2 = box
    rng = random.Random(seed)
    d.rectangle(box, fill=INK)
    open_frame(d, box, GRAY, 24)
    step = 4
    for yy in range(y1 + 8, y2 - 7, step):
        for xx in range(x1 + 8, x2 - 7, step):
            cx = (xx - (x1 + x2) / 2) / max(1, (x2 - x1))
            cy = (yy - (y1 + y2) / 2) / max(1, (y2 - y1))
            wave = math.sin(cx * 19 + cy * 13 + seed) * 0.16
            seam = 0.22 if abs(cx - cy * 0.22) < 0.045 else 0.0
            if rng.random() < density + wave - seam:
                d.rectangle((xx, yy, xx + 2, yy + 2), fill=color if (xx + yy) % 12 else PAPER)
    # Saved scar is not random: same seed gives same normalized event.
    sx = x1 + 18 + (seed * 17) % max(20, x2 - x1 - 36)
    sy = y1 + 18 + (seed * 23) % max(20, y2 - y1 - 36)
    line(d, [(sx - 6, sy - 9), (sx, sy), (sx - 3, sy + 11), (sx + 8, sy + 3)], MAGENTA, 2)


def mock_gameplay() -> Image.Image:
    im, d = canvas()
    draw_game_field(d, "INFO", 7)
    draw_hud(d, "INFO", 4, 2, 5)
    txt(d, (180, 50), "RUN 08 · ROOM 01", 7, GRAY, "ma")
    return im


def mock_boss() -> Image.Image:
    im, d = canvas()
    draw_game_field(d, "FORCED", 11, True)
    # Absent Receiver: an off-center slot consumes the incoming feed.
    d.rectangle((106, 128, 262, 184), fill=GRAY)
    d.rectangle((116, 136, 252, 176), fill=AMBER)
    d.rectangle((131, 141, 239, 171), fill=INK)
    d.rectangle((150, 136, 188, 176), fill=INK)
    d.rectangle((183, 136, 194, 150), fill=PAPER)
    line(d, [(76, 154), (135, 154)], PAPER, 2)
    broken_line(d, (195, 154), (302, 154), AMBER, 7, 5, 2)
    for i in range(56):
        a = (i / 56) * math.tau
        x = int(184 + math.cos(a) * (38 + (i % 7) * 6))
        y = int(192 + math.sin(a) * (44 + (i % 5) * 8))
        if 18 < x < 342 and 88 < y < 560:
            draw_bullet(d, x, y, x - 184, y - 192, PAPER if i % 5 else AMBER, 3)
    draw_player(d, 158, 524, AMBER, 1, True)
    draw_hud(d, "FORCED", 2, 5, 7)
    # Boss HUD is an incomplete ruler rather than a full panel.
    txt(d, (18, 55), "无回应的接收者", 10, PAPER)
    txt(d, (342, 57), "ABSENT RECEIVER", 6, GRAY, "ra")
    line(d, [(18, 72), (140, 72)], AMBER, 3)
    line(d, [(140, 72), (198, 72)], GRAY)
    line(d, [(216, 72), (342, 72)], GRAY)
    for i in range(4):
        d.rectangle((18 + i * 10, 78, 23 + i * 10, 81), fill=AMBER if i < 2 else GRAY)
    txt(d, (342, 77), "PHASE 02 / 04", 6, PAPER, "ra")
    return im


def mock_title() -> Image.Image:
    im, d = canvas()
    # Four process colors enter but do not resolve into a logo-ring.
    d.rectangle((0, 0, W - 1, H - 1), fill=PAPER)
    paper_noise(d, 90, "#D7D0C1", 160)
    for x, y, c, w in ((20, 78, INFO, 98), (244, 121, AMBER, 92), (44, 252, VIOLET, 78), (266, 286, RED, 72)):
        d.rectangle((x, y, x + w, y + 3), fill=c)
    # Offset flower/core with a directional omission.
    cx, cy = 178, 182
    d.rectangle((cx - 42, cy - 8, cx - 7, cy + 7), fill=INK)
    d.rectangle((cx + 8, cy - 24, cx + 42, cy - 9), fill=INK)
    d.rectangle((cx - 6, cy - 42, cx + 9, cy - 8), fill=GRAY)
    d.rectangle((cx + 1, cy + 8, cx + 16, cy + 42), fill=GRAY)
    d.rectangle((cx - 8, cy - 8, cx + 8, cy + 8), fill=INK)
    d.rectangle((cx + 4, cy - 8, cx + 8, cy - 1), fill=PAPER)
    txt(d, (180, 249), "1BIT", 36, INK, "ma")
    txt(d, (180, 296), "SIGNAL / SCAR", 10, GRAY, "ma")
    txt(d, (180, 323), "你被画成了一条路径", 11, INK, "ma")
    # Japanese handheld cadence: short menu, generous breathing interval.
    button(d, 390, "开始", "START", True, INK)
    button(d, 436, "继续", "CONTINUE", False, INK)
    button(d, 482, "设置", "SETTINGS", False, INK)
    txt(d, (18, 602), "Z 确认", 8, INK)
    txt(d, (342, 602), "v3.0 / MEMORY ON", 6, GRAY, "ra")
    corner(d, 12, 12, 1, 1, INK, 13)
    corner(d, 348, 628, -1, -1, INK, 13)
    return im


def veil(d: ImageDraw.ImageDraw) -> None:
    for y in range(0, H, 4):
        for x in range((y // 4) % 2 * 4, W, 8):
            d.rectangle((x, y, x + 3, y + 3), fill=INK)


def mock_pause() -> Image.Image:
    im, d = canvas()
    draw_game_field(d, "BETWEEN", 19)
    draw_hud(d, "BETWEEN", 3, 3, 4)
    veil(d)
    d.rectangle((16, 84, 333, 554), fill=INK)
    open_frame(d, (16, 84, 333, 554), VIOLET, 46)
    txt(d, (30, 107), "暂停", 22, PAPER)
    txt(d, (30, 140), "PAUSE / INPUT HELD", 7, GRAY)
    txt(d, (30, 173), "画面没有停止。只有输入停下。", 9, PAPER)
    fingerprint(d, (222, 103, 314, 194), 8, VIOLET, 0.39)
    button(d, 242, "返回", "RESUME", True, VIOLET)
    button(d, 290, "重新开始本室", "RETRY ROOM")
    button(d, 338, "查看状态", "SNAPSHOT")
    button(d, 386, "设置", "SETTINGS")
    button(d, 434, "返回标题", "TITLE")
    txt(d, (30, 515), "RUN 08 · 07:42 · SCARS 02", 7, GRAY)
    return im


def setting_row(d: ImageDraw.ImageDraw, y: int, zh: str, en: str, on: bool | None, value: int | None = None, color: str = INFO) -> None:
    txt(d, (22, y), zh, 10, PAPER)
    txt(d, (128, y + 1), en.upper(), 6, GRAY)
    if on is not None:
        toggle(d, 310, y - 1, on, color)
    if value is not None:
        segmented_bar(d, 247, y + 4, 8, value, color, 7, 4, 2)
    broken_line(d, (22, y + 20), (338, y + 20), BLACK_3, 2, 6)


def mock_settings() -> Image.Image:
    im, d = canvas()
    section(d, 22, "设置", "SETTINGS", INFO)
    txt(d, (18, 62), "可读性", 12, PAPER)
    txt(d, (342, 64), "READABILITY", 6, GRAY, "ra")
    setting_row(d, 94, "减少闪烁", "REDUCE FLASH", True, color=INFO)
    setting_row(d, 132, "减少运动", "REDUCED MOTION", False, color=INFO)
    setting_row(d, 170, "高对比轮廓", "HIGH CONTRAST", True, color=INFO)
    setting_row(d, 208, "弹体缺口放大", "VOID NOTCH +", False, color=INFO)
    txt(d, (18, 250), "声音", 12, PAPER)
    txt(d, (342, 252), "SOUND", 6, GRAY, "ra")
    setting_row(d, 282, "总音量", "MASTER", None, 6, INFO)
    setting_row(d, 320, "环境层", "AMBIENCE", None, 4, VIOLET)
    setting_row(d, 358, "事件层", "EVENTS", None, 7, AMBER)
    setting_row(d, 396, "双耳拍频", "BINAURAL", False, color=VIOLET)
    txt(d, (18, 438), "输入", 12, PAPER)
    txt(d, (342, 440), "INPUT", 6, GRAY, "ra")
    txt(d, (22, 472), "移动", 10, PAPER)
    txt(d, (150, 473), "方向键 / WASD", 8, GRAY)
    txt(d, (22, 503), "发出信号", 10, PAPER)
    txt(d, (150, 504), "Z", 8, INFO)
    txt(d, (22, 534), "Focus", 10, PAPER)
    txt(d, (150, 535), "SHIFT", 8, VIOLET)
    txt(d, (22, 565), "改写", 10, PAPER)
    txt(d, (150, 566), "X", 8, MAGENTA)
    button(d, 596, "应用", "APPLY", True, INFO)
    return im


def mock_continue() -> Image.Image:
    im, d = canvas()
    section(d, 20, "继续", "CONTINUE", AMBER)
    txt(d, (18, 58), "RUN 08 → RUN 09", 16, PAPER)
    txt(d, (18, 84), "继续不是回到原处。", 9, GRAY)
    fingerprint(d, (18, 116, 218, 282), 8, AMBER, 0.43)
    txt(d, (238, 126), "上一次", 10, PAPER)
    txt(d, (238, 143), "LAST RUN", 6, GRAY)
    txt(d, (238, 171), "07:42", 14, AMBER)
    txt(d, (238, 203), "裂痕 02", 9, PAPER)
    txt(d, (238, 224), "幽灵路径 01", 9, PAPER)
    txt(d, (238, 245), "见证者 03", 9, PAPER)
    line(d, [(18, 309), (310, 309)], GRAY)
    line(d, [(310, 309), (342, 278)], AMBER)
    txt(d, (18, 329), "留下的东西", 11, PAPER)
    txt(d, (342, 331), "WHAT REMAINS", 6, GRAY, "ra")
    draw_behavior_icon(d, "scar", 36, 372, AMBER)
    txt(d, (60, 363), "FORCED / x 0.63, y 0.41", 8, PAPER)
    txt(d, (60, 379), "方向：左下 · 第 2 阶段", 7, GRAY)
    draw_behavior_icon(d, "ghost", 36, 418, VIOLET)
    txt(d, (60, 409), "旧路径将在进入后播放一次", 8, PAPER)
    txt(d, (60, 425), "无碰撞 · 无奖励", 7, GRAY)
    draw_behavior_icon(d, "witness", 36, 464, INFO)
    txt(d, (60, 455), "三名见证者记住了中等光强", 8, PAPER)
    txt(d, (60, 471), "不是评价，只是下一局条件", 7, GRAY)
    button(d, 526, "带着残留继续", "CONTINUE", True, AMBER)
    button(d, 574, "开始空白运行", "NEW / NO MEMORY")
    return im


def mock_failure() -> Image.Image:
    im, d = canvas()
    # Digital shell is gone; material residue gets the visual weight.
    for y in range(0, H, 32):
        broken_line(d, (0, y + 10), (W, y + 10), BLACK_3, 4, 12)
    section(d, 24, "本次运行结束", "RUN ENDED", RED)
    txt(d, (18, 70), "没有得分。留下的是一份行为。", 10, PAPER)
    txt(d, (18, 94), "NO SCORE. A BEHAVIOR REMAINS.", 6, GRAY)
    # Sediment at the failure coordinate.
    cx, cy = 180, 222
    rng = random.Random(45)
    for i in range(88):
        a = rng.random() * math.tau
        r = rng.randrange(9, 70)
        x = int(cx + math.cos(a) * r)
        y = int(cy + math.sin(a) * r * 0.54)
        c = RED if i % 11 == 0 else GRAY if i % 3 else PAPER
        d.rectangle((x, y, x + rng.randrange(1, 4), y + rng.randrange(1, 3)), fill=c)
    line(d, [(cx - 42, cy - 35), (cx - 8, cy - 3), (cx - 19, cy + 42), (cx + 24, cy + 9)], MAGENTA, 2)
    open_frame(d, (78, 152, 283, 290), GRAY, 31)
    txt(d, (18, 329), "系统观察", 10, PAPER)
    txt(d, (342, 331), "SYSTEM OBSERVATION", 6, GRAY, "ra")
    line(d, [(18, 350), (62, 350)], RED, 2)
    txt(d, (18, 370), "你曾经把自己压得很暗，", 11, PAPER)
    txt(d, (18, 390), "然后在被完全看见之前改写了规则。", 11, PAPER)
    txt(d, (18, 420), "它会记住这件事。", 10, RED)
    button(d, 472, "查看状态快照", "STATE SNAPSHOT", True, RED)
    button(d, 520, "带着残留重来", "RETRY WITH MEMORY")
    button(d, 568, "返回标题", "TITLE")
    return im


def arrow(d: ImageDraw.ImageDraw, a: tuple[int, int], b: tuple[int, int], color: str) -> None:
    line(d, [a, b], color)
    bx, by = b
    if abs(bx - a[0]) > abs(by - a[1]):
        s = 1 if bx > a[0] else -1
        line(d, [(bx - 5 * s, by - 3), (bx, by), (bx - 5 * s, by + 3)], color)
    else:
        s = 1 if by > a[1] else -1
        line(d, [(bx - 3, by - 5 * s), (bx, by), (bx + 3, by - 5 * s)], color)


def behavior_card(d: ImageDraw.ImageDraw, y: int, key: str, icon: str, title: str, consequence: str, color: str) -> None:
    draw_behavior_icon(d, icon, 34, y + 20, color)
    d.rectangle((60, y, 88, y + 15), outline=color)
    txt(d, (74, y + 7), key, 7, color, "mm")
    txt(d, (102, y - 1), title, 10, PAPER)
    fit_txt(d, (102, y + 18), consequence, 232, 8, GRAY)
    line(d, [(102, y + 37), (330, y + 37)], color)


def mock_tutorial() -> Image.Image:
    im, d = canvas()
    section(d, 18, "行为图", "BEHAVIOR MAP", VIOLET)
    txt(d, (18, 56), "不是按键说明，是因果说明。", 10, PAPER)
    txt(d, (18, 78), "每个动作都改变下一次系统如何读取你。", 8, GRAY)
    behavior_card(d, 116, "Z", "signal", "发出信号 / SPEAK", "你更亮 → 系统更快刷新 → 更多东西靠近", INFO)
    arrow(d, (34, 158), (34, 188), INFO)
    behavior_card(d, 190, "⇧", "focus", "Focus / 收拢", "你变暗 → 路径更窄 → 表达也被压小", VIOLET)
    arrow(d, (34, 232), (34, 262), VIOLET)
    behavior_card(d, 264, "—", "gaze", "被凝视 / CLAMP", "系统看见你 → 强制压暗 → 恢复比受压更慢", AMBER)
    arrow(d, (34, 306), (34, 336), AMBER)
    behavior_card(d, 338, "近", "scar", "擦边 / GRAZE", "危险成为证据 → 证据积成可用的改写", RED)
    arrow(d, (34, 380), (34, 410), RED)
    behavior_card(d, 412, "X", "override", "改写 / OVERRIDE", "只撕开局部 Void → 不清屏 → 写下一道 scar", MAGENTA)
    arrow(d, (34, 454), (34, 484), MAGENTA)
    behavior_card(d, 486, "→", "ghost", "下一局 / NEXT RUN", "scar 复水 → 旧路径播放一次 → 见证者转向", INFO)
    txt(d, (18, 574), "中等光强不是最优解，只是能被某些东西记住的状态。", 8, PAPER)
    txt(d, (18, 604), "Z 下一页", 7, GRAY)
    txt(d, (342, 604), "01 / 01", 7, GRAY, "ra")
    return im


def mock_snapshot() -> Image.Image:
    im, d = canvas()
    section(d, 18, "状态快照", "STATE SNAPSHOT", INFO)
    txt(d, (18, 56), "RUN 08 / 07:42 / FORCED → BETWEEN", 7, GRAY)
    fingerprint(d, (18, 84, 342, 264), 8, INFO, 0.46)
    txt(d, (28, 238), "BEHAVIOR FINGERPRINT / 1BIT", 6, PAPER)
    metric_bar(d, 292, "平均光强", "MEAN LIGHT", 0.42, INFO)
    metric_bar(d, 326, "凝视压力", "GAZE", 0.61, AMBER)
    metric_bar(d, 360, "Seam 停留", "SEAM DWELL", 0.34, VIOLET)
    metric_bar(d, 394, "路径宽度", "ROUTE WIDTH", 0.72, INFO)
    metric_bar(d, 428, "改写次数", "OVERRIDE", 0.25, MAGENTA, "02")
    txt(d, (18, 468), "观察", 10, PAPER)
    txt(d, (342, 470), "OBSERVATION", 6, GRAY, "ra")
    line(d, [(18, 489), (72, 489)], INFO, 2)
    txt(d, (18, 507), "你有一次把画面弄坏了。", 11, PAPER)
    txt(d, (18, 527), "它恢复了，但已经不太一样。", 11, PAPER)
    # Tags are factual filters, not medals.
    tags = [("MEDIUM_LIGHT", INFO), ("HIGH_GAZE", AMBER), ("CRACK_WALKER", VIOLET), ("RESISTER", MAGENTA)]
    x, y = 18, 560
    for label, c in tags:
        tw = d.textbbox((0, 0), label, font=font(6))[2] + 12
        d.rectangle((x, y, x + tw, y + 14), outline=c)
        txt(d, (x + 6, y + 4), label, 6, c)
        x += tw + 6
        if x > 318:
            x, y = 18, y + 20
    txt(d, (18, 612), "Z 继续", 7, PAPER)
    txt(d, (342, 612), "X 导出 PNG", 7, GRAY, "ra")
    return im


def mock_cross_run() -> Image.Image:
    im, d = canvas()
    section(d, 18, "跨局衔接", "RUN BRIDGE", MAGENTA)
    txt(d, (18, 56), "上一局没有消失。", 14, PAPER)
    txt(d, (18, 82), "THE LAST RUN REMAINS.", 7, GRAY)
    # Two unequal temporal columns with a void between them.
    fingerprint(d, (18, 116, 154, 302), 8, VIOLET, 0.47)
    fingerprint(d, (206, 116, 342, 302), 9, INFO, 0.31)
    txt(d, (86, 312), "RUN 08", 7, VIOLET, "ma")
    txt(d, (274, 312), "RUN 09", 7, INFO, "ma")
    arrow(d, (158, 208), (202, 208), MAGENTA)
    line(d, [(179, 176), (175, 205), (184, 220), (177, 246)], MAGENTA, 2)
    # Real saved ghost points cross the seam, but remain non-colliding.
    pts = [(54, 269), (76, 250), (96, 258), (121, 224), (145, 231), (167, 210), (188, 218), (215, 193), (243, 203), (270, 176), (307, 188)]
    for i, p in enumerate(pts):
        if i < len(pts) - 1:
            broken_line(d, p, pts[i + 1], GRAY if i < 5 else INFO, 2, 3)
        d.rectangle((p[0] - 1, p[1] - 1, p[0] + 1, p[1] + 1), fill=PAPER if i in (5, 10) else GRAY)
    steps = [
        ("01", "复水裂痕", "SCAR REHYDRATE", MAGENTA),
        ("02", "播放旧路径一次", "GHOST REPLAY", VIOLET),
        ("03", "见证者转向", "WITNESS TURN", AMBER),
        ("04", "交还控制", "INPUT RETURN", INFO),
    ]
    y = 354
    for i, (n, zh, en, c) in enumerate(steps):
        d.rectangle((18, y, 42, y + 18), outline=c)
        txt(d, (30, y + 9), n, 7, c, "mm")
        txt(d, (60, y - 1), zh, 10, PAPER)
        txt(d, (342, y + 2), en, 6, GRAY, "ra")
        if i < 3:
            line(d, [(30, y + 20), (30, y + 42)], GRAY)
        y += 54
    txt(d, (18, 589), "记忆不会增加分数，只会改变条件。", 8, PAPER)
    segmented_bar(d, 18, 616, 8, 6, INFO, 36, 3, 2)
    return im


ATLAS_NAMES = [
    ["frame_corner_nw", "frame_corner_ne", "frame_corner_sw", "frame_corner_se", "open_panel_left", "open_panel_right", "seam_vertical", "seam_horizontal"],
    ["bar_empty", "bar_25", "bar_50", "bar_75", "bar_full", "phase_tick", "threshold_marker", "void_gap"],
    ["behavior_signal", "behavior_focus", "behavior_gaze", "behavior_override", "behavior_scar", "behavior_ghost", "behavior_witness", "behavior_snapshot"],
    ["room_info", "room_forced", "room_between", "room_polar", "state_free", "state_suppressed", "state_void", "state_residue"],
    ["control_up", "control_down", "control_left", "control_right", "control_z", "control_shift", "control_x", "control_confirm"],
    ["divider_solid", "divider_broken", "chevron", "cursor", "toggle_off", "toggle_on", "slider_knob", "scroll_marker"],
    ["fingerprint_sparse", "fingerprint_banded", "fingerprint_seam", "fingerprint_resist", "fingerprint_focus", "fingerprint_gaze", "fingerprint_ghost", "fingerprint_mixed"],
    ["scar_1", "scar_2", "scar_3", "ghost_dot", "ghost_segment", "witness_pair", "memory_aperture", "run_bridge"],
]


def atlas_text(d: ImageDraw.ImageDraw, xy: tuple[int, int], value: str, size: int, fill: str) -> None:
    d.text(xy, value, font=font(size), fill=fill, anchor="mm")


def draw_atlas_cell(d: ImageDraw.ImageDraw, r: int, c: int, ox: int, oy: int) -> None:
    cx, cy = ox + 32, oy + 32
    if r == 0:
        if c < 4:
            sx = 1 if c in (0, 2) else -1
            sy = 1 if c in (0, 1) else -1
            corner(d, cx - sx * 17, cy - sy * 17, sx, sy, PAPER, 24)
            x0, x1 = sorted((cx - sx * 17, cx - sx * 15))
            y0, y1 = sorted((cy - sy * 17, cy - sy * 15))
            d.rectangle((x0, y0, x1, y1), fill=INFO)
        elif c == 4:
            open_frame(d, (ox + 8, oy + 14, ox + 55, oy + 50), PAPER, 14)
            d.rectangle((ox + 8, oy + 26, ox + 10, oy + 38), fill=INFO)
        elif c == 5:
            open_frame(d, (ox + 8, oy + 14, ox + 55, oy + 50), PAPER, 14)
            d.rectangle((ox + 53, oy + 22, ox + 55, oy + 36), fill=AMBER)
        elif c == 6:
            line(d, [(cx - 2, oy + 8), (cx - 2, oy + 27)], GRAY)
            line(d, [(cx + 2, oy + 35), (cx + 2, oy + 56)], PAPER)
            d.rectangle((cx - 1, oy + 29, cx + 1, oy + 33), fill=MAGENTA)
        else:
            line(d, [(ox + 8, cy - 2), (ox + 27, cy - 2)], GRAY)
            line(d, [(ox + 36, cy + 2), (ox + 56, cy + 2)], PAPER)
            d.rectangle((ox + 29, cy - 1, ox + 34, cy + 1), fill=MAGENTA)
    elif r == 1:
        if c <= 4:
            d.rectangle((ox + 8, oy + 27, ox + 55, oy + 36), outline=GRAY)
            fill = [0, 12, 24, 36, 46][c]
            if fill:
                d.rectangle((ox + 10, oy + 29, ox + 9 + fill, oy + 34), fill=INFO if c < 4 else PAPER)
        elif c == 5:
            for i in range(4):
                d.rectangle((ox + 10 + i * 11, oy + 27, ox + 16 + i * 11, oy + 35), fill=AMBER if i < 2 else GRAY)
        elif c == 6:
            line(d, [(ox + 8, cy), (ox + 56, cy)], GRAY)
            d.polygon([(cx, cy - 10), (cx - 5, cy - 3), (cx + 5, cy - 3)], fill=MAGENTA)
        else:
            line(d, [(ox + 8, cy), (ox + 25, cy)], PAPER, 3)
            line(d, [(ox + 39, cy), (ox + 56, cy)], PAPER, 3)
            d.rectangle((ox + 29, cy - 5, ox + 35, cy + 5), outline=GRAY)
    elif r == 2:
        kinds = ["signal", "focus", "gaze", "override", "scar", "ghost", "witness", "snapshot"]
        colors = [INFO, VIOLET, AMBER, MAGENTA, RED, VIOLET, AMBER, INFO]
        draw_behavior_icon(d, kinds[c], cx, cy, colors[c])
    elif r == 3:
        if c == 0:
            for i in range(3):
                d.rectangle((ox + 12 + i * 14, oy + 21 + (i % 2) * 8, ox + 20 + i * 14, oy + 25 + (i % 2) * 8), fill=INFO)
        elif c == 1:
            line(d, [(cx - 2, oy + 10), (cx - 2, oy + 54)], AMBER, 2)
            line(d, [(cx + 3, oy + 10), (cx + 3, oy + 26)], PAPER)
            line(d, [(cx + 3, oy + 36), (cx + 3, oy + 54)], PAPER)
        elif c == 2:
            broken_line(d, (ox + 9, oy + 25), (ox + 48, oy + 25), VIOLET, 5, 3)
            broken_line(d, (ox + 18, oy + 38), (ox + 56, oy + 38), PAPER, 4, 4)
        elif c == 3:
            d.rectangle((ox + 8, oy + 20, ox + 27, oy + 28), fill=RED)
            d.rectangle((ox + 37, oy + 36, ox + 56, oy + 44), fill=PAPER)
        elif c == 4:
            draw_player(d, cx, cy, INFO)
        elif c == 5:
            draw_player(d, cx, cy, AMBER, focus=True)
            line(d, [(cx - 15, cy - 10), (cx - 7, cy)], AMBER)
            line(d, [(cx + 15, cy - 10), (cx + 7, cy)], AMBER)
        elif c == 6:
            line(d, [(cx - 11, cy - 16), (cx - 3, cy), (cx - 8, cy + 16), (cx + 10, cy + 5)], MAGENTA, 3)
        else:
            for i in range(18):
                xx = ox + 12 + (i * 17) % 40
                yy = oy + 14 + (i * 11) % 36
                d.rectangle((xx, yy, xx + 2, yy + 1), fill=GRAY if i % 3 else PAPER)
    elif r == 4:
        if c < 4:
            if c == 0:
                pts = [(cx, cy - 13), (cx - 8, cy - 3), (cx - 3, cy - 3), (cx - 3, cy + 12), (cx + 3, cy + 12), (cx + 3, cy - 3), (cx + 8, cy - 3)]
            elif c == 1:
                pts = [(cx, cy + 13), (cx - 8, cy + 3), (cx - 3, cy + 3), (cx - 3, cy - 12), (cx + 3, cy - 12), (cx + 3, cy + 3), (cx + 8, cy + 3)]
            elif c == 2:
                pts = [(cx - 13, cy), (cx - 3, cy - 8), (cx - 3, cy - 3), (cx + 12, cy - 3), (cx + 12, cy + 3), (cx - 3, cy + 3), (cx - 3, cy + 8)]
            else:
                pts = [(cx + 13, cy), (cx + 3, cy - 8), (cx + 3, cy - 3), (cx - 12, cy - 3), (cx - 12, cy + 3), (cx + 3, cy + 3), (cx + 3, cy + 8)]
            d.polygon(pts, fill=PAPER)
        else:
            labels = ["Z", "⇧", "X", "·"]
            d.rectangle((ox + 12, oy + 14, ox + 52, oy + 50), outline=GRAY)
            d.rectangle((ox + 15, oy + 17, ox + 49, oy + 47), outline=[INFO, VIOLET, MAGENTA, PAPER][c - 4])
            atlas_text(d, (cx, cy), labels[c - 4], 14 if c != 5 else 12, PAPER)
    elif r == 5:
        if c == 0:
            line(d, [(ox + 8, cy), (ox + 56, cy)], PAPER)
        elif c == 1:
            broken_line(d, (ox + 8, cy), (ox + 56, cy), GRAY, 4, 4)
        elif c == 2:
            line(d, [(ox + 14, cy - 9), (ox + 30, cy), (ox + 14, cy + 9)], PAPER, 2)
        elif c == 3:
            d.polygon([(ox + 12, cy), (ox + 23, cy - 8), (ox + 23, cy + 8)], fill=INFO)
            line(d, [(ox + 27, cy), (ox + 54, cy)], GRAY)
        elif c in (4, 5):
            d.rectangle((ox + 12, oy + 25, ox + 52, oy + 39), outline=GRAY)
            bx = ox + 15 if c == 4 else ox + 39
            d.rectangle((bx, oy + 28, bx + 10, oy + 36), fill=GRAY if c == 4 else INFO)
        elif c == 6:
            line(d, [(ox + 10, cy), (ox + 54, cy)], GRAY)
            d.rectangle((cx - 4, cy - 7, cx + 4, cy + 7), fill=AMBER)
        else:
            d.rectangle((cx - 3, oy + 9, cx + 3, oy + 55), outline=GRAY)
            d.rectangle((cx - 2, oy + 22, cx + 2, oy + 36), fill=PAPER)
    elif r == 6:
        rng = random.Random(100 + c)
        for yy in range(oy + 9, oy + 56, 5):
            for xx in range(ox + 9, ox + 56, 5):
                cxn = (xx - cx) / 48
                cyn = (yy - cy) / 48
                prob = 0.20 + c * 0.035 + math.sin(cxn * 11 + cyn * (5 + c)) * 0.12
                if c == 2 and abs(cxn - cyn * 0.25) < 0.1:
                    prob = 0
                if rng.random() < prob:
                    d.rectangle((xx, yy, xx + 2, yy + 2), fill=[INFO, AMBER, VIOLET, MAGENTA][c % 4])
        if c in (3, 7):
            line(d, [(ox + 17, oy + 13), (ox + 27, oy + 30), (ox + 23, oy + 49), (ox + 43, oy + 38)], MAGENTA, 2)
    else:
        if c < 3:
            paths = [
                [(ox + 14, oy + 12), (ox + 25, oy + 30), (ox + 20, oy + 51), (ox + 44, oy + 39)],
                [(ox + 12, oy + 41), (ox + 27, oy + 29), (ox + 22, oy + 14), (ox + 49, oy + 24)],
                [(ox + 18, oy + 9), (ox + 37, oy + 24), (ox + 29, oy + 34), (ox + 46, oy + 54)],
            ]
            line(d, paths[c], MAGENTA, 3)
            line(d, [(x + 3, y + 1) for x, y in paths[c]], GRAY)
        elif c == 3:
            d.rectangle((cx - 2, cy - 2, cx + 2, cy + 2), fill=PAPER)
            broken_line(d, (ox + 10, cy + 13), (cx - 5, cy + 3), GRAY, 2, 3)
        elif c == 4:
            broken_line(d, (ox + 8, oy + 48), (ox + 54, oy + 16), VIOLET, 3, 3, 2)
            d.rectangle((ox + 49, oy + 13, ox + 55, oy + 19), fill=PAPER)
        elif c == 5:
            draw_behavior_icon(d, "witness", cx, cy, AMBER)
        elif c == 6:
            open_frame(d, (ox + 11, oy + 14, ox + 53, oy + 50), INFO, 17)
            line(d, [(cx - 2, oy + 13), (cx - 5, cy), (cx + 3, cy + 9)], MAGENTA, 2)
        else:
            d.rectangle((ox + 8, oy + 15, ox + 24, oy + 49), outline=VIOLET)
            d.rectangle((ox + 40, oy + 15, ox + 56, oy + 49), outline=INFO)
            arrow(d, (ox + 26, cy), (ox + 38, cy), MAGENTA)


def build_atlas() -> tuple[Image.Image, dict]:
    size, cell = 512, 64
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.fontmode = "1"
    frames: dict[str, dict] = {}
    category_names = ["frame", "meter", "behavior", "room_state", "control", "navigation", "fingerprint", "memory"]
    for r, row in enumerate(ATLAS_NAMES):
        for c, name in enumerate(row):
            ox, oy = c * cell, r * cell
            draw_atlas_cell(d, r, c, ox, oy)
            frames[name] = {
                "frame": {"x": ox, "y": oy, "w": cell, "h": cell},
                "sourceSize": {"w": cell, "h": cell},
                "pivot": {"x": 0.5, "y": 0.5},
                "category": category_names[r],
                "roomTintable": r not in (2, 3, 6, 7),
                "alpha": "binary",
            }
    manifest = {
        "schemaVersion": "3.0.0-ui",
        "image": "../atlas/ui-atlas.png",
        "size": {"w": size, "h": size},
        "grid": {"columns": 8, "rows": 8, "cell": 64},
        "sampling": "nearest",
        "premultiplyAlpha": False,
        "palette": PALETTE,
        "frames": frames,
        "notes": [
            "UI atlas is separate from 128x128 gameplay atlases.",
            "All transparent pixels have alpha 0; visible pixels have alpha 255.",
            "No ring, reticle, circuit or magic-circle component is present.",
        ],
    }
    return im, manifest


def layouts_manifest() -> dict:
    common = {
        "logicalCanvas": [360, 640],
        "safeArea": {"x": 12, "y": 8, "w": 336, "h": 620},
        "grid": 4,
        "pixelScale": "integer-only",
        "sampling": "nearest",
        "typeface": "Noto Sans SC Variable",
    }
    screens = {
        "gameplay_hud": {
            "mockup": "../mockups/01-gameplay-hud.png",
            "layers": [
                {"id": "light", "rect": [12, 8, 102, 26], "bind": "player.lightIntensity", "atlas": "bar_*"},
                {"id": "gaze", "rect": [310, 8, 38, 74], "bind": "player.gazePressure", "atlas": "bar_*", "orientation": "vertical"},
                {"id": "room", "rect": [12, 588, 112, 32], "bind": "room.id"},
                {"id": "override", "rect": [270, 588, 78, 32], "bind": "player.overrideCharge", "atlas": "bar_*"},
            ],
        },
        "boss_hud": {
            "mockup": "../mockups/02-boss-hud.png",
            "layers": [
                {"id": "boss_name", "rect": [18, 52, 324, 16], "bind": "boss.localizedName"},
                {"id": "boss_integrity", "rect": [18, 70, 324, 5], "bind": "boss.integrity", "semantic": "broken-ruler"},
                {"id": "boss_phase", "rect": [18, 77, 324, 9], "bind": "boss.phaseIndex"},
            ],
        },
        "title": {
            "mockup": "../mockups/03-title.png",
            "focusOrder": ["start", "continue", "settings"],
            "layers": [
                {"id": "title_mark", "rect": [130, 136, 96, 92], "semantic": "incomplete-self"},
                {"id": "menu", "rect": [30, 390, 300, 120], "selectionBind": "ui.titleSelection"},
            ],
        },
        "pause": {
            "mockup": "../mockups/04-pause.png",
            "focusOrder": ["resume", "retryRoom", "snapshot", "settings", "title"],
            "layers": [
                {"id": "hard_veil", "rect": [0, 0, 360, 640], "alphaMode": "binary-dither"},
                {"id": "pause_body", "rect": [16, 84, 317, 470], "atlas": "open_panel_left"},
                {"id": "mini_fingerprint", "rect": [222, 103, 92, 91], "bind": "run.fingerprint"},
            ],
        },
        "settings": {
            "mockup": "../mockups/05-settings.png",
            "focusOrder": ["reduceFlash", "reducedMotion", "highContrast", "notchPlus", "master", "ambience", "events", "binaural", "apply"],
            "binds": {
                "reduceFlash": "accessibility.reduceFlash",
                "reducedMotion": "accessibility.reducedMotion",
                "highContrast": "accessibility.highContrast",
                "notchPlus": "accessibility.largeVoidNotch",
                "master": "audio.master",
                "ambience": "audio.ambience",
                "events": "audio.events",
                "binaural": "audio.binaural",
            },
        },
        "continue": {
            "mockup": "../mockups/06-continue.png",
            "requires": ["previousRun.snapshot", "previousRun.scars", "previousRun.ghostPath", "previousRun.witnesses"],
            "actions": ["continueWithMemory", "newRunWithoutMemory"],
        },
        "failure": {
            "mockup": "../mockups/07-failure.png",
            "requires": ["run.observation", "death.normalizedPosition", "run.fingerprint"],
            "actions": ["openSnapshot", "retryWithMemory", "title"],
            "forbiddenCopy": ["GAME OVER", "RANK", "SCORE"],
        },
        "tutorial_behavior_map": {
            "mockup": "../mockups/08-tutorial-behavior-map.png",
            "nodes": [
                {"action": "signal", "input": "Z", "effects": ["light↑", "refreshRate↑", "proximity↑"]},
                {"action": "focus", "input": "SHIFT", "effects": ["light↓", "routeWidth↓", "expression↓"]},
                {"action": "gazeClamp", "input": None, "effects": ["forcedLight↓", "recoveryDelay↑"]},
                {"action": "graze", "input": "proximity", "effects": ["evidence↑", "overrideCharge↑"]},
                {"action": "override", "input": "X", "effects": ["localVoid", "collisionOffLocal", "scarWrite"]},
                {"action": "nextRun", "input": None, "effects": ["scarRehydrate", "ghostReplayOnce", "witnessTurn"]},
            ],
        },
        "state_snapshot": {
            "mockup": "../mockups/09-state-snapshot.png",
            "layers": [
                {"id": "fingerprint", "rect": [18, 84, 324, 180], "bind": "run.fingerprintBitmap", "format": "1-bit"},
                {"id": "metrics", "rect": [18, 292, 324, 160], "bind": "run.metrics"},
                {"id": "observation", "rect": [18, 468, 324, 72], "bind": "run.observationLocalized"},
                {"id": "tags", "rect": [18, 560, 324, 36], "bind": "run.behaviorTags", "semantic": "filters-not-awards"},
            ],
            "metrics": ["meanLight", "gazePressure", "seamDwell", "routeWidth", "overrideCount"],
            "actions": ["continue", "exportPng"],
        },
        "cross_run_transition": {
            "mockup": "../mockups/10-cross-run-transition.png",
            "timelineMs": [
                {"at": 0, "event": "scarRehydrate"},
                {"at": 420, "event": "ghostReplayOnce"},
                {"at": 980, "event": "witnessTurn"},
                {"at": 1420, "event": "returnInput"},
            ],
            "reducedMotion": {"singleFrame": "scarRehydrate + finalGhostPoint + witnessFacing", "holdMs": 900},
        },
    }
    return {"schemaVersion": "3.0.0-ui-layout", "common": common, "screens": screens}


def contact_sheet(images: list[tuple[str, Image.Image]]) -> Image.Image:
    scale = 0.5
    tw, th = int(W * scale), int(H * scale)
    cols, rows = 5, 2
    margin, label_h = 12, 20
    sw = margin + cols * (tw + margin)
    sh = margin + rows * (th + label_h + margin)
    sheet = Image.new("RGB", (sw, sh), PAPER)
    d = ImageDraw.Draw(sheet)
    d.fontmode = "1"
    for i, (name, im) in enumerate(images):
        row, col = divmod(i, cols)
        x = margin + col * (tw + margin)
        y = margin + row * (th + label_h + margin)
        small = im.resize((tw, th), Image.Resampling.NEAREST)
        sheet.paste(small, (x, y))
        d.text((x, y + th + 4), name, font=font(8), fill=INK)
    return sheet


def validate_png(path: Path) -> dict:
    with Image.open(path) as im:
        alpha_values = None
        if im.mode == "RGBA":
            alpha_values = sorted(set(im.getchannel("A").getdata()))
        return {
            "path": str(path.relative_to(ROOT)),
            "size": list(im.size),
            "mode": im.mode,
            "alphaValues": alpha_values,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }


def main() -> None:
    ensure_dirs()
    atlas, atlas_manifest = build_atlas()
    atlas_path = ATLAS_DIR / "ui-atlas.png"
    atlas.save(atlas_path, optimize=True)
    (MANIFESTS / "ui-atlas.json").write_text(json.dumps(atlas_manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (MANIFESTS / "ui-layouts.json").write_text(json.dumps(layouts_manifest(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    specs = [
        ("01-gameplay-hud", mock_gameplay),
        ("02-boss-hud", mock_boss),
        ("03-title", mock_title),
        ("04-pause", mock_pause),
        ("05-settings", mock_settings),
        ("06-continue", mock_continue),
        ("07-failure", mock_failure),
        ("08-tutorial-behavior-map", mock_tutorial),
        ("09-state-snapshot", mock_snapshot),
        ("10-cross-run-transition", mock_cross_run),
    ]
    built: list[tuple[str, Image.Image]] = []
    for name, factory in specs:
        im = factory()
        im.save(MOCKUPS / f"{name}.png", optimize=True)
        built.append((name, im))
    contact_sheet(built).save(MOCKUPS / "00-ui-overview.png", optimize=True)

    checks = [validate_png(atlas_path)]
    checks.extend(validate_png(MOCKUPS / f"{name}.png") for name, _ in specs)
    checks.append(validate_png(MOCKUPS / "00-ui-overview.png"))
    report = {
        "schemaVersion": "1.0.0",
        "result": "pass" if checks[0]["alphaValues"] == [0, 255] and all(c["size"] == [360, 640] for c in checks[1:-1]) else "fail",
        "checks": checks,
    }
    (MANIFESTS / "validation-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"built": len(specs), "atlasFrames": len(atlas_manifest["frames"]), "validation": report["result"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
