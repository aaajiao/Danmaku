#!/usr/bin/env python3
"""Render motion-QA GIF/APNG previews for all executable V4 patterns."""
from __future__ import annotations

import json
import math
import re
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from sim_core import PLAYER_Y, VIEW_H, VIEW_W, simulation

V4 = Path(__file__).resolve().parents[2]
MANIFESTS = V4 / "manifests" / "gameplay"
OUT = V4 / "gameplay" / "animations"
PATTERN_OUT = OUT / "patterns"
BOSS_OUT = OUT / "boss-sequences"

INK = "#08090D"
PAPER = "#EFE9DA"
GRAY = "#7D8087"
CYAN = "#17A7CA"
AMBER = "#D6982B"
VIOLET = "#7851B7"
RED = "#B7463C"
MAGENTA = "#F02A92"
COLORS = {
    "INFORMATION": CYAN,
    "FORCED_ALIGNMENT": AMBER,
    "IN_BETWEEN": VIOLET,
    "POLARIZED": RED,
    "COMMON": PAPER,
    "TRANSITION": GRAY,
    "WEATHER_ECHO": CYAN,
}
SIZE = (180, 320)


def read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def face(size: int, bold=False):
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/SFNS.ttf",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default()


F8, F10 = face(8), face(10, True)


def safe_id(value: str) -> str:
    # Avoid dots: Path.with_suffix would otherwise collapse every sibling in a
    # semantic namespace (for example room.information.*) to one filename.
    return re.sub(r"[^a-z0-9_-]+", "--", value.lower()).strip("-")


def select_frames(frames: list[dict], maximum=72) -> list[dict]:
    if len(frames) <= maximum:
        return frames
    indices = [round(i * (len(frames) - 1) / (maximum - 1)) for i in range(maximum)]
    return [frames[i] for i in indices]


def draw_frame(pattern: dict, frame: dict, ordinal: int, total: int, *, phase_label: str | None = None) -> Image.Image:
    w, h = SIZE
    sx, sy = w / VIEW_W, h / VIEW_H
    image = Image.new("RGB", SIZE, INK)
    d = ImageDraw.Draw(image)
    color = COLORS.get(pattern["room"], PAPER)

    # Sparse room field: never a decorative circuit-city backdrop.
    for row in range(58, h - 22, 42):
        offset = (ordinal * 2 + row) % 17
        d.line((12 + offset, row, w - 10, row + ((row // 42) % 3 - 1) * 3), fill="#202228")

    center = frame["gapCenterX"] * sx
    half = frame["gapWidthPx"] * sx / 2
    d.line((center - half, 38, center - half, h), fill=GRAY)
    d.line((center + half, 38, center + half, h), fill=GRAY)
    for y in range(46, h, 16):
        d.line((center - half - 2, y, center - half + 2, y), fill=GRAY)
        d.line((center + half - 2, y + 8, center + half + 2, y + 8), fill=GRAY)

    now = float(frame["atMs"])
    warning_ms = float(pattern["warning"]["durationMs"])
    if now < warning_ms:
        p = max(0.0, min(1.0, now / max(1.0, warning_ms)))
        d.rectangle((0, 34, round(w * p), 37), fill=GRAY)
        d.text((6, 43), f"WARNING / {pattern['warning']['shape'][:18]}", fill=GRAY, font=F8)
    else:
        d.rectangle((0, 34, w, 37), fill=color)

    for emitter in pattern["emitters"]:
        ex = emitter["anchor"]["x"] * w
        ey = emitter["anchor"]["y"] * h
        d.line((ex - 3, ey, ex + 3, ey), fill=MAGENTA)
        d.line((ex, ey - 3, ex, ey + 3), fill=MAGENTA)

    for uid, x, y, radius, colliding in frame["bullets"]:
        px, py = x * sx, y * sy
        r = max(1, min(3, round(radius * (sx + sy) / 2)))
        bullet_color = color if colliding else GRAY
        if uid % 3 == 0:
            d.rectangle((px - r, py - r, px + r, py + r), fill=bullet_color)
        elif uid % 3 == 1:
            d.polygon(((px, py - r - 1), (px + r + 1, py), (px, py + r + 1), (px - r - 1, py)), fill=bullet_color)
        else:
            d.line((px - r - 1, py, px + r + 1, py), fill=bullet_color, width=2)

    player_x = center
    player_y = PLAYER_Y * sy
    d.polygon(((player_x, player_y - 4), (player_x + 3, player_y + 2), (player_x, player_y + 5), (player_x - 3, player_y + 2)), fill=PAPER)
    d.rectangle((player_x - 1, player_y, player_x + 1, player_y + 2), fill=CYAN)

    d.rectangle((0, 0, w - 1, h - 1), outline=GRAY)
    d.rectangle((0, 0, w, 34), fill=INK)
    label = pattern["id"].replace("boss.", "B/").replace("room.", "R/").replace("transition.", "T/").replace("weather.", "W/").replace("common.", "C/")
    if len(label) > 28:
        label = label[:27] + "…"
    d.text((5, 4), label, fill=PAPER, font=F10)
    phase = phase_label or pattern["safeGap"]["type"]
    d.text((5, 18), f"{now:05.0f}ms · {phase[:21]}", fill=color, font=F8)
    d.rectangle((5, h - 8, w - 5, h - 5), fill="#25272D")
    d.rectangle((5, h - 8, 5 + round((w - 10) * ((ordinal + 1) / total)), h - 5), fill=color)
    return image


def save_animation(frames: list[Image.Image], base: Path, duration_ms: int):
    duration = max(45, round(duration_ms / max(1, len(frames))))
    frames[0].save(base.parent / f"{base.name}.gif", save_all=True, append_images=frames[1:], duration=duration, loop=0, disposal=2, optimize=False)
    frames[0].save(base.parent / f"{base.name}.apng", save_all=True, append_images=frames[1:], duration=duration, loop=0, disposal=2, blend=0, optimize=False)


def render_pattern(pattern: dict) -> dict:
    trace = simulation(pattern, seed=pattern["seed"]["base"], difficulty="NORMAL", capture_ms=125)
    selected = select_frames(trace["frames"])
    frames = [draw_frame(pattern, frame, i, len(selected)) for i, frame in enumerate(selected)]
    base = PATTERN_OUT / safe_id(pattern["id"])
    save_animation(frames, base, int(pattern["durationMs"]))
    timeline = {
        "schemaVersion": "4.0.0-pattern-preview",
        "patternId": pattern["id"],
        "traceSha256": trace["traceSha256"],
        "sourceDurationMs": pattern["durationMs"],
        "previewFrameCount": len(frames),
        "previewFrameDurationMs": max(45, round(pattern["durationMs"] / len(frames))),
        "timeline": pattern["timeline"],
        "files": {"gif": f"{base.name}.gif", "apng": f"{base.name}.apng", "timeline": f"{base.name}.timeline.json"},
    }
    (base.parent / f"{base.name}.timeline.json").write_text(json.dumps(timeline, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return timeline


def render_boss(rig: dict, by_id: dict[str, dict]) -> dict:
    frames: list[Image.Image] = []
    phase_rows = []
    for phase_index, phase in enumerate(rig["phases"]):
        pattern = by_id[phase["patternId"]]
        trace = simulation(pattern, seed=pattern["seed"]["base"], difficulty="NORMAL", capture_ms=160)
        selected = select_frames(trace["frames"], 32)
        start = len(frames)
        for i, frame in enumerate(selected):
            image = draw_frame(pattern, frame, i, len(selected), phase_label=f"P{phase_index + 1} {phase['id']}")
            d = ImageDraw.Draw(image)
            for p in range(3):
                c = COLORS.get(rig["room"], PAPER) if p <= phase_index else GRAY
                d.rectangle((142 + p * 10, 20, 148 + p * 10, 25), fill=c)
            frames.append(image)
        phase_rows.append({"phaseId": phase["id"], "patternId": pattern["id"], "startFrame": start, "frameCount": len(selected), "traceSha256": trace["traceSha256"]})
    base = BOSS_OUT / safe_id(rig["id"])
    duration_ms = sum(by_id[p["patternId"]]["durationMs"] for p in rig["phases"])
    save_animation(frames, base, duration_ms)
    timeline = {
        "schemaVersion": "4.0.0-boss-sequence-preview",
        "bossId": rig["id"],
        "resolution": rig["resolution"],
        "phaseRows": phase_rows,
        "previewFrameCount": len(frames),
        "files": {"gif": f"{base.name}.gif", "apng": f"{base.name}.apng", "timeline": f"{base.name}.timeline.json"},
    }
    (base.parent / f"{base.name}.timeline.json").write_text(json.dumps(timeline, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return timeline


def validate_artifacts(pattern_rows: list[dict], boss_rows: list[dict]) -> dict:
    """Prove one-to-one identity between index rows and on-disk artifacts."""
    errors: list[str] = []

    def validate_rows(rows: list[dict], directory: Path, id_key: str, expected: int) -> int:
        identities = [row[id_key] for row in rows]
        if len(rows) != expected or len(set(identities)) != expected:
            errors.append(f"{id_key}: expected {expected} unique rows, got {len(rows)}/{len(set(identities))}")
        for kind in ("gif", "apng", "timeline"):
            names = [row["files"][kind] for row in rows]
            if len(set(names)) != len(rows):
                errors.append(f"{id_key}/{kind}: artifact names are not one-to-one")
            for row, name in zip(rows, names):
                path = directory / name
                if not path.is_file() or path.stat().st_size == 0:
                    errors.append(f"{row[id_key]}: missing or empty {kind} {name}")
                elif kind in {"gif", "apng"}:
                    try:
                        with Image.open(path) as image:
                            if image.n_frames != row["previewFrameCount"]:
                                errors.append(f"{row[id_key]}: {kind} frame count {image.n_frames} != {row['previewFrameCount']}")
                    except Exception as exc:
                        errors.append(f"{row[id_key]}: unreadable {kind}: {exc}")
        for row in rows:
            stored = read(directory / row["files"]["timeline"])
            if stored.get(id_key) != row[id_key]:
                errors.append(f"{row[id_key]}: timeline identity mismatch")
        return sum(1 for path in directory.iterdir() if path.is_file())

    pattern_artifacts = validate_rows(pattern_rows, PATTERN_OUT, "patternId", 48)
    boss_artifacts = validate_rows(boss_rows, BOSS_OUT, "bossId", 8)
    if pattern_artifacts != 48 * 3:
        errors.append(f"pattern artifacts: expected 144, got {pattern_artifacts}")
    if boss_artifacts != 8 * 3:
        errors.append(f"boss artifacts: expected 24, got {boss_artifacts}")
    return {
        "status": "PASS" if not errors else "FAIL",
        "patternRows": len(pattern_rows),
        "patternArtifacts": pattern_artifacts,
        "bossRows": len(boss_rows),
        "bossArtifacts": boss_artifacts,
        "errors": errors,
    }


def main() -> int:
    if OUT.exists():
        shutil.rmtree(OUT)
    PATTERN_OUT.mkdir(parents=True, exist_ok=True)
    BOSS_OUT.mkdir(parents=True, exist_ok=True)
    patterns = read(MANIFESTS / "executable-patterns-v4.json")["patterns"]
    rigs = read(MANIFESTS / "boss-rigs-v4.json")["rigs"]
    by_id = {p["id"]: p for p in patterns}
    pattern_rows = [render_pattern(pattern) for pattern in patterns]
    boss_rows = [render_boss(rig, by_id) for rig in rigs]
    validation = validate_artifacts(pattern_rows, boss_rows)
    index = {
        "schemaVersion": "4.0.0-motion-previews",
        "source": "../../manifests/gameplay/gameplay-index-v4.json",
        "authority": "QA preview only; gameplay geometry and time remain manifest-owned",
        "patternCount": len(pattern_rows),
        "bossSequenceCount": len(boss_rows),
        "patterns": pattern_rows,
        "bossSequences": boss_rows,
        "artifactValidation": validation,
    }
    (OUT / "animation-index-v4.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"patternAnimations": len(pattern_rows), "patternArtifacts": validation["patternArtifacts"], "bossSequences": len(boss_rows), "bossArtifacts": validation["bossArtifacts"], "status": validation["status"]}))
    if validation["errors"]:
        for error in validation["errors"]:
            print(f"ERROR: {error}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
