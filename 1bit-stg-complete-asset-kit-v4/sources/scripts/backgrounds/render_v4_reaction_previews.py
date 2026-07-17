#!/usr/bin/env python3
"""Render room-reaction previews from the same delivered overlays."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw


SCRIPT_DIR = Path(__file__).resolve().parent
BG_DIR = SCRIPT_DIR.parent
V4_DIR = BG_DIR.parent
ROOT = V4_DIR.parent.parent
V3 = ROOT / "outputs" / "01-final-delivery" / "1bit-stg-complete-asset-kit-v3"
OUT = V4_DIR / "previews" / "room-reactions"

ROOMS = ("information", "forced_choice", "in_between", "polarized")
STATES = ("threshold", "dusk", "aftermath", "memory")
DURATIONS = (720, 900, 760, 1100)


def composite(room: str, state: str) -> Image.Image:
    base = Image.open(V3 / "backgrounds" / "composites" / f"{room}-gameplay.png").convert("RGBA")
    overlay = Image.open(BG_DIR / "reactions" / room / f"{state}.png").convert("RGBA")
    base.alpha_composite(overlay)
    return base


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    index = []
    for room in ROOMS:
        frames = [composite(room, state) for state in STATES]
        gif_frames = [frame.convert("P", palette=Image.Palette.ADAPTIVE, colors=32) for frame in frames]
        gif_path = OUT / f"{room}-reaction-lifecycle.gif"
        gif_frames[0].save(gif_path, save_all=True, append_images=gif_frames[1:], duration=DURATIONS, loop=0, disposal=2)
        apng_path = OUT / f"{room}-reaction-lifecycle.apng"
        frames[0].save(apng_path, save_all=True, append_images=frames[1:], duration=DURATIONS, loop=0, disposal=2, blend=0)
        contact = Image.new("RGB", (360 * 4, 640), (8, 9, 13))
        for idx, frame in enumerate(frames):
            contact.paste(frame.convert("RGB"), (idx * 360, 0))
            ImageDraw.Draw(contact).text((idx * 360 + 8, 8), STATES[idx], fill=(239, 233, 218))
        contact_path = OUT / f"{room}-reaction-contact.png"
        contact.save(contact_path, compress_level=9)
        timeline = {
            "schemaVersion": "4.0.0-preview",
            "room": room,
            "states": [
                {"id": state, "durationMs": duration, "collision": False, "source": f"backgrounds/reactions/{room}/{state}.png"}
                for state, duration in zip(STATES, DURATIONS)
            ],
            "authority": "visual-preview-only",
        }
        timeline_path = OUT / f"{room}-reaction-timeline.json"
        timeline_path.write_text(json.dumps(timeline, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        index.append({"room": room, "gif": gif_path.name, "apng": apng_path.name, "contact": contact_path.name, "timeline": timeline_path.name})
    (OUT / "index.json").write_text(json.dumps({"schemaVersion": "4.0.0", "previews": index}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"roomPreviews": len(index), "statesPerRoom": len(STATES)}))


if __name__ == "__main__":
    main()
