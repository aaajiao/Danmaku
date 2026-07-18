#!/usr/bin/env python3
"""Render compact, reviewable contact sheets for the variable-duration v3 clips."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from v3lib import Kit, fit_nearest, safe_output_path, tight_crop


INK = (8, 9, 13, 255)
GRID = (29, 32, 39, 255)
PAPER = (239, 233, 218, 255)
GRAY = (125, 128, 135, 255)
CYAN = (23, 167, 202, 255)
MAGENTA = (240, 42, 146, 255)

COMBAT_CLIPS = [
    "player.focus",
    "system.eye_clamp",
    "system.override.directional",
    "player.causality.damage_to_trace",
    "player.return_with_history",
    "enemy.causality.damage_to_trace",
    "bullet.lifecycle",
    "boss.laser.lifecycle",
]

NARRATIVE_CLIPS = [
    "narrative.witness.rebel",
    "narrative.ghost.burnout",
    "narrative.cable.upload_or_burnin",
    "memory.directional_write",
    "weather.static_dropout",
    "weather.rain_ash",
    "weather.wind_eclipse",
    "state.snapshot_handoff",
]


def render_sheet(kit: Kit, clip_ids: list[str], title: str, output: Path) -> None:
    label_width = 236
    cell_width = 96
    row_height = 112
    header_height = 34
    canvas = Image.new("RGBA", (label_width + cell_width * 8, header_height + row_height * len(clip_ids)), INK)
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default()
    draw.text((8, 8), title, font=font, fill=PAPER)
    draw.text((8, 20), "variable duration · events shown in magenta · source pixels use nearest scaling", font=font, fill=CYAN)

    for row_index, clip_id in enumerate(clip_ids):
        timeline = kit.timeline(clip_id, expand_playback=False)
        top = header_height + row_index * row_height
        draw.rectangle((0, top, canvas.width - 1, top + row_height - 1), outline=GRID)
        draw.text((8, top + 8), clip_id, font=font, fill=PAPER)
        draw.text((8, top + 22), f"period {sum(item.duration_ms for item in timeline)}ms", font=font, fill=GRAY)
        clip = kit.clips[clip_id]
        event_names = [
            str(event.get("name"))
            for event in clip.get("events", [])
            if isinstance(event, dict) and event.get("name")
        ]
        if event_names:
            draw.text((8, top + 36), " / ".join(event_names)[:42], font=font, fill=MAGENTA)

        for column, step in enumerate(timeline[:8]):
            left = label_width + column * cell_width
            draw.rectangle(
                (left, top, left + cell_width - 1, top + row_height - 1),
                fill=(23, 26, 32, 255),
                outline=GRID,
            )
            sprite = tight_crop(kit.crop(step.ref), 0)
            sprite = fit_nearest(sprite, (78, 78), allow_upscale=False)
            anchor_x = left + cell_width // 2
            anchor_y = top + 44
            canvas.alpha_composite(sprite, (anchor_x - sprite.width // 2, anchor_y - sprite.height // 2))
            draw.text((left + 4, top + 84), f"f{step.source_ordinal:02d} {step.duration_ms}ms", font=font, fill=GRAY)
            if step.events:
                draw.text((left + 4, top + 96), "+".join(step.events)[:13], font=font, fill=MAGENTA)

    output = safe_output_path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output, format="PNG", optimize=False, compress_level=9)


def main() -> None:
    parser = argparse.ArgumentParser(description="Render v3 combat and narrative motion contact sheets")
    parser.add_argument("--kit-root", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    kit = Kit(Path(args.kit_root))
    out = Path(args.out)
    render_sheet(kit, COMBAT_CLIPS, "1BIT STG V3 · COMBAT CAUSALITY", out / "03-combat-motion-overview-v3.png")
    render_sheet(kit, NARRATIVE_CLIPS, "1BIT STG V3 · NARRATIVE / WEATHER / SNAPSHOT", out / "04-narrative-motion-overview-v3.png")
    print(f"wrote motion overviews to {out.resolve()}")


if __name__ == "__main__":
    main()
