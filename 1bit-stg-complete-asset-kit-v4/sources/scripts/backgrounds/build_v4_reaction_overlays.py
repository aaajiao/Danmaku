#!/usr/bin/env python3
"""Build deterministic room-reaction overlays for the V4 STG package."""

from __future__ import annotations

import hashlib
import json
import random
from pathlib import Path

from PIL import Image, ImageDraw


SCRIPT_DIR = Path(__file__).resolve().parent
BG_DIR = SCRIPT_DIR.parent
OUT_DIR = BG_DIR / "reactions"
PREVIEW_DIR = BG_DIR / "previews"
REPORT_DIR = BG_DIR / "reports"

W, H = 360, 640
INK = (8, 9, 13, 255)
PAPER = (239, 233, 218, 255)
GRAY = (125, 128, 135, 255)
CYAN = (23, 167, 202, 255)
AMBER = (214, 152, 43, 255)
VIOLET = (120, 81, 183, 255)
RED = (183, 70, 60, 255)
MAGENTA = (240, 42, 146, 255)
TRANSPARENT = (0, 0, 0, 0)

ROOMS = {
    "information": CYAN,
    "forced_choice": AMBER,
    "in_between": VIOLET,
    "polarized": RED,
}
STATES = ("threshold", "dusk", "aftermath", "memory")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def image() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    value = Image.new("RGBA", (W, H), TRANSPARENT)
    return value, ImageDraw.Draw(value)


def draw_information(state: str) -> Image.Image:
    im, d = image()
    rng = random.Random(f"information:{state}:v4")
    if state == "threshold":
        for x in range(10, W - 8, 18):
            offset = rng.randrange(-20, 30)
            for y in range(-16 + offset, H, 42):
                if rng.random() < 0.22:
                    continue
                length = rng.choice((6, 10, 14))
                d.rectangle((x, y, x + 2, y + length), fill=CYAN)
                if rng.random() < 0.35:
                    d.point((x + 5, y + length // 2), fill=PAPER)
    elif state == "dusk":
        for band in range(7):
            y = 90 + band * 72
            left = 18 + (band * 29) % 90
            gap = 34 + (band % 3) * 14
            d.rectangle((left, y, W - 20, y + 3), fill=GRAY)
            d.rectangle((left + 82, y - 1, left + 82 + gap, y + 5), fill=TRANSPARENT)
            d.rectangle((W - 55, y + 7, W - 48, y + 13), fill=CYAN)
    elif state == "aftermath":
        for index in range(18):
            x = rng.randrange(12, W - 24)
            y = rng.randrange(40, H - 26)
            w = rng.choice((8, 12, 18))
            d.rectangle((x, y, x + w, y + 3), fill=GRAY)
            d.line((x + w, y, x + w + 5, y + 5), fill=PAPER, width=2)
            if index % 4 == 0:
                d.point((x - 3, y + 1), fill=CYAN)
    else:
        for y in range(72, H - 30, 64):
            x = 42 + ((y * 7) % 210)
            d.rectangle((x, y, x + 46, y + 2), fill=GRAY)
            d.rectangle((x + 13, y - 2, x + 24, y + 4), fill=INK)
            d.point((x + 51, y + 1), fill=PAPER)
    return im


def draw_forced(state: str) -> Image.Image:
    im, d = image()
    rng = random.Random(f"forced:{state}:v4")
    seam = W // 2
    if state == "threshold":
        d.rectangle((seam - 2, 0, seam + 1, H), fill=INK)
        for y in range(28, H, 56):
            left = rng.choice((44, 64, 88))
            right = rng.choice((34, 72, 96))
            d.rectangle((seam - left, y, seam - 7, y + 5), fill=AMBER)
            d.rectangle((seam + 7, y + 12, seam + right, y + 17), fill=PAPER)
    elif state == "dusk":
        for y in range(0, H, 32):
            width = 132 if (y // 32) % 2 == 0 else 92
            d.rectangle((seam - width, y, seam - 6, y + 15), fill=INK)
            d.rectangle((seam + 6, y + 16, seam + width - 18, y + 31), fill=AMBER)
        d.rectangle((seam - 3, 0, seam + 2, H), fill=PAPER)
    elif state == "aftermath":
        for index in range(14):
            y = 30 + index * 42
            left_w = 18 + (index * 7) % 40
            right_w = 10 + (index * 11) % 50
            d.rectangle((seam - 18 - left_w, y, seam - 18, y + 12), fill=GRAY)
            d.rectangle((seam + 14, y + 6, seam + 14 + right_w, y + 17), fill=AMBER)
    else:
        for y in range(36, H, 74):
            d.rectangle((20, y, seam - 28, y + 2), fill=GRAY)
            d.rectangle((seam + 42, y, W - 18, y + 2), fill=GRAY)
            d.rectangle((seam - 8, y - 5, seam + 4, y + 7), fill=AMBER)
        d.line((seam, 0, seam, H), fill=INK, width=2)
    return im


def draw_between(state: str) -> Image.Image:
    im, d = image()
    rng = random.Random(f"between:{state}:v4")
    if state == "threshold":
        for x in range(8, W, 32):
            d.line((x, 0, x, H), fill=VIOLET, width=2)
        for offset in range(-H, W, 44):
            d.line((offset, H, offset + H, 0), fill=PAPER, width=2)
    elif state == "dusk":
        for index in range(11):
            y = 40 + index * 53
            x1 = 22 + (index * 31) % 140
            x2 = W - 26 - (index * 19) % 130
            d.rectangle((x1, y, x1 + 54, y + 3), fill=VIOLET)
            d.rectangle((x2 - 54, y + 9, x2, y + 12), fill=GRAY)
            if index % 3 == 0:
                d.rectangle(((x1 + x2) // 2 - 3, y + 3, (x1 + x2) // 2 + 3, y + 9), fill=PAPER)
    elif state == "aftermath":
        for index in range(20):
            x = rng.randrange(20, W - 20)
            y = rng.randrange(24, H - 24)
            d.line((x - 8, y - 8, x + 8, y + 8), fill=VIOLET, width=2)
            d.line((x - 8, y + 8, x + 8, y - 8), fill=GRAY, width=2)
            d.rectangle((x - 2, y - 2, x + 2, y + 2), fill=PAPER)
    else:
        for y in range(50, H, 70):
            x = 32 + (y * 13) % 240
            d.rectangle((x, y, x + 28, y + 2), fill=VIOLET)
            d.rectangle((x + 14, y - 14, x + 16, y + 16), fill=GRAY)
            d.rectangle((x + 12, y - 2, x + 18, y + 4), fill=PAPER)
    return im


def draw_polarized(state: str) -> Image.Image:
    im, d = image()
    seam = W // 2
    if state == "threshold":
        for y in range(0, H, 48):
            d.rectangle((0, y, seam - 10, y + 22), fill=INK)
            d.rectangle((seam + 10, y + 24, W, y + 47), fill=RED)
        d.rectangle((seam - 3, 0, seam + 2, H), fill=PAPER)
    elif state == "dusk":
        d.rectangle((0, 0, seam - 1, H), fill=INK)
        d.rectangle((seam, 0, W, H), fill=RED)
        for y in range(92, H, 128):
            d.rectangle((seam - 8, y, seam + 7, y + 19), fill=PAPER)
    elif state == "aftermath":
        for index in range(16):
            y = 22 + index * 38
            width = 18 + (index * 17) % 64
            if index % 2:
                d.rectangle((seam + 18, y, seam + 18 + width, y + 13), fill=RED)
            else:
                d.rectangle((seam - 18 - width, y, seam - 18, y + 13), fill=INK)
            d.rectangle((seam - 3, y + 4, seam + 2, y + 9), fill=PAPER)
    else:
        d.rectangle((seam - 2, 0, seam + 1, H), fill=PAPER)
        points = [(seam, 70), (seam - 10, 132), (seam + 12, 216), (seam - 18, 312), (seam + 16, 402), (seam - 8, 526), (seam + 5, 612)]
        d.line(points, fill=MAGENTA, width=4)
        for x, y in points[1:-1]:
            d.rectangle((x - 3, y - 3, x + 3, y + 3), fill=PAPER)
    return im


DRAWERS = {
    "information": draw_information,
    "forced_choice": draw_forced,
    "in_between": draw_between,
    "polarized": draw_polarized,
}


def main() -> None:
    records = []
    errors = []
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for room in ROOMS:
        room_dir = OUT_DIR / room
        room_dir.mkdir(parents=True, exist_ok=True)
        for state in STATES:
            im = DRAWERS[room](state)
            path = room_dir / f"{state}.png"
            im.save(path, compress_level=9)
            visible = [p for p in im.get_flattened_data() if p[3]]
            if any(p[3] not in (0, 255) for p in im.get_flattened_data()):
                errors.append(f"{room}/{state}: non-binary alpha")
            records.append({
                "id": f"reaction.{room}.{state}",
                "room": room,
                "state": state,
                "file": f"backgrounds/reactions/{room}/{state}.png",
                "size": [W, H],
                "collision": False,
                "authority": "visual-subscriber",
                "visiblePixels": len(visible),
                "sha256": sha256(path),
            })
    manifest = {
        "schemaVersion": "4.0.0",
        "coordinateSystem": "top-left-origin",
        "states": list(STATES),
        "overlays": records,
    }
    (BG_DIR / "reaction-overlays-v4.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    thumb_w, thumb_h = 180, 320
    gap = 12
    canvas = Image.new("RGBA", (4 * thumb_w + 5 * gap, 4 * thumb_h + 5 * gap), INK)
    for row, room in enumerate(ROOMS):
        for col, state in enumerate(STATES):
            im = Image.open(OUT_DIR / room / f"{state}.png").convert("RGBA")
            im = im.resize((thumb_w, thumb_h), Image.Resampling.NEAREST)
            canvas.alpha_composite(im, (gap + col * (thumb_w + gap), gap + row * (thumb_h + gap)))
    canvas.convert("RGB").save(PREVIEW_DIR / "reaction-overlays-overview.png", compress_level=9)

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = {"status": "PASS" if not errors else "FAIL", "overlayCount": len(records), "errors": errors}
    (REPORT_DIR / "reaction-overlays-validation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if errors:
        raise SystemExit("\n".join(errors))
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
