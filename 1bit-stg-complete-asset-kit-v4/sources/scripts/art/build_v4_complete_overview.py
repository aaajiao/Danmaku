#!/usr/bin/env python3
"""Compose a single V4 review board from validated subsystem previews."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[4]
V4 = ROOT / "work/v4"
OUT = V4 / "previews/00-v4-complete-overview.png"
FONT = ROOT / "outputs/01-final-delivery/1bit-stg-complete-asset-kit-v3/fonts/NotoSansSC-Variable.ttf"

INK = "#08090D"
PAPER = "#EFE9DA"
GRAY = "#7D8087"
CYAN = "#17A7CA"
AMBER = "#D6982B"
VIOLET = "#7851B7"
RED = "#B7463C"


def fit(path: Path, box: tuple[int, int], *, upscale: bool = False) -> Image.Image:
    image = Image.open(path).convert("RGB")
    if upscale and image.width < box[0]:
        ratio = min(box[0] / image.width, box[1] / image.height)
        return image.resize((round(image.width * ratio), round(image.height * ratio)), Image.Resampling.NEAREST)
    image.thumbnail(box, Image.Resampling.LANCZOS)
    return image


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas = Image.new("RGB", (1920, 1600), PAPER)
    d = ImageDraw.Draw(canvas)
    f52 = ImageFont.truetype(str(FONT), 52)
    f22 = ImageFont.truetype(str(FONT), 22)
    f16 = ImageFont.truetype(str(FONT), 16)
    d.rectangle((0, 0, 1920, 122), fill=INK)
    d.text((28, 18), "1bit STG / V4 COMPLETE VISUAL SYSTEM", font=f52, fill=PAPER)
    d.text((31, 84), "行为先于图标 · 弹幕是论证 · 数字动作留下物质后果", font=f16, fill=GRAY)
    chips = [("7 ATLASES / 448 FRAMES", CYAN), ("48 PATTERNS", AMBER), ("8 × 3 BOSS", VIOLET), ("48 WAV", RED)]
    x = 1030
    for label, color in chips:
        w = d.textbbox((0, 0), label, font=f16)[2] + 30
        d.rectangle((x, 54, x + w, 88), outline=color, width=2)
        d.text((x + 14, 62), label, font=f16, fill=color)
        x += w + 12

    atlas = fit(V4 / "art/previews/v4-addon-atlas-overview.png", (1864, 650), upscale=True)
    canvas.paste(atlas, (28, 148))

    panels = [
        (V4 / "ui/mockups/00-ui-overview-v4.png", (610, 450), "UI：证据 / 记忆 / 协议 / 快照"),
        (V4 / "backgrounds/previews/reaction-overlays-overview.png", (300, 600), "四房间 × 四反应层"),
        (V4 / "gameplay/previews/laser-geometries-v4.png", (440, 550), "八种真实激光拓扑"),
        (V4 / "gameplay/previews/patterns-room-v4.png", (420, 680), "四房间可执行弹幕"),
    ]
    x = 28
    top = 830
    for path, box, label in panels:
        image = fit(path, box)
        d.rectangle((x - 2, top - 2, x + image.width + 2, top + image.height + 2), fill=INK)
        canvas.paste(image, (x, top))
        d.rectangle((x, top, x + image.width, top + 36), fill=INK)
        d.text((x + 10, top + 8), label, font=f16, fill=PAPER)
        x += image.width + 24

    d.text((30, 1565), "所有面板均由同一套 canonical manifests 与确定性脚本生成；预览不拥有碰撞与时间权威。", font=f16, fill=INK)
    canvas.save(OUT, optimize=True)
    print(OUT)


if __name__ == "__main__":
    main()
