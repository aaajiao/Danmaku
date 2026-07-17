#!/usr/bin/env python3
"""Render state-library previews for every V4 add-on atlas row."""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

from PIL import Image, ImageDraw


SCRIPT_DIR = Path(__file__).resolve().parent
ART_DIR = SCRIPT_DIR.parent
V4_DIR = ART_DIR.parent
OUT = V4_DIR / "previews" / "addon-libraries"
FRAME_INDEX = ART_DIR / "manifests" / "frame-index-v4-additions.json"
INK = (8, 9, 13, 255)
PAPER = (239, 233, 218, 255)


def render_frame(atlas: Image.Image, rect: list[int], label: str) -> Image.Image:
    x, y, w, h = rect
    sprite = atlas.crop((x, y, x + w, y + h))
    canvas = Image.new("RGBA", (192, 192), INK)
    canvas.alpha_composite(sprite, ((192 - w) // 2, 22))
    draw = ImageDraw.Draw(canvas)
    short = label.split(".")[-1][:22]
    draw.text((8, 170), short, fill=PAPER)
    return canvas


def main() -> None:
    payload = json.loads(FRAME_INDEX.read_text(encoding="utf-8"))
    groups: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for frame in payload["frames"]:
        groups[(frame["board"], frame["row"])].append(frame)
    OUT.mkdir(parents=True, exist_ok=True)
    index = []
    for (board, row), frames in sorted(groups.items()):
        frames.sort(key=lambda frame: frame["column"])
        atlas_file = ART_DIR / frames[0]["atlas"]
        atlas = Image.open(atlas_file).convert("RGBA")
        rendered = [render_frame(atlas, frame["rect"], frame["semanticId"]) for frame in frames]
        durations = [260] * len(rendered)
        stem = f"{board}-row-{row:02d}"
        gif_frames = [frame.convert("P", palette=Image.Palette.ADAPTIVE, colors=32) for frame in rendered]
        gif_frames[0].save(OUT / f"{stem}.gif", save_all=True, append_images=gif_frames[1:], duration=durations, loop=0, disposal=2)
        rendered[0].save(OUT / f"{stem}.apng", save_all=True, append_images=rendered[1:], duration=durations, loop=0, disposal=2, blend=0)
        contact = Image.new("RGB", (192 * 8, 192), INK[:3])
        for idx, frame in enumerate(rendered):
            contact.paste(frame.convert("RGB"), (idx * 192, 0))
        contact.save(OUT / f"{stem}-contact.png", compress_level=9)
        timeline = {
            "schemaVersion": "4.0.0-preview",
            "mode": "state-library-not-authoritative-gameplay",
            "board": board,
            "row": row,
            "states": [
                {"semanticId": frame["semanticId"], "durationMs": duration, "collision": False}
                for frame, duration in zip(frames, durations)
            ],
        }
        (OUT / f"{stem}.timeline.json").write_text(json.dumps(timeline, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        index.append({"id": stem, "board": board, "row": row, "frames": len(frames)})
    (OUT / "index.json").write_text(json.dumps({"schemaVersion": "4.0.0", "libraries": index}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"libraryPreviews": len(index), "frames": sum(item["frames"] for item in index)}))


if __name__ == "__main__":
    main()
