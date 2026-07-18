#!/usr/bin/env python3
"""Render geometry-placeholder previews from the canonical V4 manifests."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

from sim_core import VIEW_H, VIEW_W, simulation


V4_ROOT = Path(__file__).resolve().parents[2]
MANIFEST_DIR = V4_ROOT / "manifests" / "gameplay"
PREVIEW_DIR = V4_ROOT / "gameplay" / "previews"

INK = "#08090D"
PAPER = "#EFE9DA"
GRAY = "#7D8087"
CYAN = "#17A7CA"
AMBER = "#D6982B"
VIOLET = "#7851B7"
RED = "#B7463C"
MAGENTA = "#F02A92"
ROOM_COLOR = {"INFORMATION": CYAN, "FORCED_ALIGNMENT": AMBER, "IN_BETWEEN": VIOLET, "POLARIZED": RED, "COMMON": PAPER, "TRANSITION": GRAY, "WEATHER_ECHO": CYAN}


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/SFNS.ttf",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            pass
    return ImageFont.load_default()


def pattern_tile(pattern: dict[str, Any], size: tuple[int, int] = (180, 320)) -> Image.Image:
    trace = simulation(pattern, seed=pattern["seed"]["base"], difficulty="NORMAL")
    usable = [frame for frame in trace["frames"] if frame["atMs"] >= pattern["warning"]["durationMs"]]
    frame = max(usable or trace["frames"], key=lambda row: len(row["bullets"]))
    scale_x = size[0] / VIEW_W
    scale_y = size[1] / VIEW_H
    image = Image.new("RGB", size, INK)
    draw = ImageDraw.Draw(image)
    color = ROOM_COLOR.get(pattern["room"], PAPER)

    # Corridor is shown as negative space bounded by friction ticks, not a glow.
    center = frame["gapCenterX"] * scale_x
    half = frame["gapWidthPx"] * scale_x / 2.0
    draw.line([(center - half, 0), (center - half, size[1])], fill=GRAY, width=1)
    draw.line([(center + half, 0), (center + half, size[1])], fill=GRAY, width=1)
    for y in range(0, size[1], 16):
        draw.line([(center - half - 2, y), (center - half + 2, y)], fill=GRAY)
        draw.line([(center + half - 2, y + 8), (center + half + 2, y + 8)], fill=GRAY)

    for source in pattern["emitters"]:
        x = source["anchor"]["x"] * size[0]
        y = source["anchor"]["y"] * size[1]
        draw.line([(x - 4, y), (x + 4, y)], fill=MAGENTA, width=1)
        draw.line([(x, y - 4), (x, y + 4)], fill=MAGENTA, width=1)

    for _, x, y, radius, colliding in frame["bullets"]:
        if not colliding:
            continue
        px = x * scale_x
        py = y * scale_y
        r = max(1.2, radius * (scale_x + scale_y) * 0.5)
        draw.polygon([(px, py - r - 1), (px + r + 1, py), (px, py + r + 1), (px - r - 1, py)], fill=color)

    player_x = center
    player_y = 570 * scale_y
    draw.polygon([(player_x, player_y - 4), (player_x + 3, player_y + 2), (player_x, player_y + 5), (player_x - 3, player_y + 2)], fill=PAPER)
    draw.rectangle((0, 0, size[0] - 1, size[1] - 1), outline=GRAY)
    draw.rectangle((0, 0, size[0], 26), fill=INK)
    short = pattern["id"].replace("room.", "").replace("boss.", "B/").replace("transition.", "T/").replace("weather.", "W/").replace("common.", "C/")
    if len(short) > 25:
        short = short[:24] + "…"
    draw.text((5, 4), short, font=font(10, True), fill=PAPER)
    draw.text((5, 16), f"{len(pattern['emitters'])}E  {sum(e['geometry']['count'] for e in pattern['emitters'])}B  {pattern['safeGap']['type'][:12]}", font=font(8), fill=GRAY)
    return image


def sheet(patterns: list[dict[str, Any]], columns: int, title: str) -> Image.Image:
    tile_w, tile_h = 180, 320
    header = 52
    rows = math.ceil(len(patterns) / columns)
    image = Image.new("RGB", (columns * tile_w, header + rows * tile_h), INK)
    draw = ImageDraw.Draw(image)
    draw.text((16, 12), title, font=font(20, True), fill=PAPER)
    draw.text((16, 34), "canonical data → deterministic geometry placeholder / gray rails = authored safe corridor", font=font(10), fill=GRAY)
    for index, pattern in enumerate(patterns):
        x = (index % columns) * tile_w
        y = header + (index // columns) * tile_h
        image.paste(pattern_tile(pattern), (x, y))
    return image


def pxy(point: list[float], tile: tuple[int, int]) -> tuple[float, float]:
    return point[0] * tile[0], point[1] * tile[1]


def draw_polyline(draw: ImageDraw.ImageDraw, points: list[tuple[float, float]], *, fill: str, width: int) -> None:
    if len(points) > 1:
        draw.line(points, fill=fill, width=width, joint="curve")


def laser_tile(laser: dict[str, Any], tile: tuple[int, int] = (180, 320)) -> Image.Image:
    image = Image.new("RGB", tile, INK)
    draw = ImageDraw.Draw(image)
    geometry = laser["geometry"]
    kind = geometry["type"]
    p = geometry["parameters"]
    color = ROOM_COLOR.get(next((room for boss, room in [
        ("boss.absent_receiver", "INFORMATION"), ("boss.unanswering_feed", "INFORMATION"), ("boss.one_sun_one_rule", "FORCED_ALIGNMENT"), ("boss.two_claims", "FORCED_ALIGNMENT"),
        ("boss.misreader", "IN_BETWEEN"), ("boss.misregistered_twin_moons", "IN_BETWEEN"), ("boss.no_dusk", "POLARIZED"), ("boss.absolute_reader", "POLARIZED")
    ] if boss == laser["bossId"]), "COMMON"), PAPER)

    def warning_and_live(lines: list[list[tuple[float, float]]], width: int = 3) -> None:
        for line in lines:
            draw_polyline(draw, line, fill=GRAY, width=width + 5)
        for line in lines:
            draw_polyline(draw, line, fill=color, width=width)

    if kind == "broken_polyline":
        pts = [pxy(point, tile) for point in p["points"]]
        segments = [[pts[i], pts[i + 1]] for i in range(len(pts) - 1) if i != p["missingSegment"]]
        warning_and_live(segments)
    elif kind == "scrolling_comb":
        spine = [pxy(point, tile) for point in p["spine"]]
        lines = [spine]
        for i in range(p["teeth"]):
            y = 38 + i * 34
            lines.append([(spine[0][0], y), (spine[0][0] + p["toothLengthPx"] * 0.5, y)])
        warning_and_live(lines, 2)
    elif kind == "half_plane_sweep":
        pivot = pxy(p["pivot"], tile)
        warning_lines = []
        for angle in [p["startDeg"], (p["startDeg"] + p["endDeg"]) / 2, p["endDeg"]]:
            rad = math.radians(angle)
            warning_lines.append([pivot, (pivot[0] + math.cos(rad) * 300, pivot[1] + math.sin(rad) * 300)])
        warning_and_live(warning_lines, 3)
    elif kind == "bifurcating_y":
        root, fork = pxy(p["root"], tile), pxy(p["fork"], tile)
        lines = [[root, fork]] + [[fork, pxy(end, tile)] for end in p["ends"]]
        warning_and_live(lines, 3)
    elif kind == "quadratic_bezier":
        p0, p1, p2 = pxy(p["p0"], tile), pxy(p["p1"], tile), pxy(p["p2"], tile)
        curve = []
        for i in range(41):
            u = i / 40
            curve.append(((1-u)**2*p0[0] + 2*(1-u)*u*p1[0] + u*u*p2[0], (1-u)**2*p0[1] + 2*(1-u)*u*p1[1] + u*u*p2[1]))
        warning_and_live([curve], 3)
    elif kind == "twin_arcs":
        lines = []
        for center, radius in zip(p["centers"], p["radiiPx"]):
            cx, cy = pxy(center, tile)
            rr = radius * 0.5
            lines.append([(cx + math.cos(math.radians(a)) * rr, cy + math.sin(math.radians(a)) * rr) for a in range(p["startDeg"], p["endDeg"] + 1, 4)])
        warning_and_live(lines, 2)
    elif kind == "orthogonal_shutter_grid":
        lines = [[(x * tile[0], 0), (x * tile[0], tile[1])] for x in p["verticalX"]] + [[(0, y * tile[1]), (tile[0], y * tile[1])] for y in p["horizontalY"]]
        warning_and_live(lines, 2)
    elif kind == "broken_iris_cone":
        origin = pxy(p["origin"], tile)
        missing_half = p["missingSectorDeg"] / 2
        lines = []
        for a in range(p["startDeg"], p["endDeg"] + 1, 8):
            if abs(a - 90) <= missing_half:
                continue
            rad = math.radians(a)
            lines.append([origin, (origin[0] + math.cos(rad) * 380, origin[1] + math.sin(rad) * 380)])
        warning_and_live(lines, 2)
        draw.arc((origin[0]-28, origin[1]-28, origin[0]+28, origin[1]+28), p["startDeg"], 90-missing_half, fill=color, width=2)
        draw.arc((origin[0]-28, origin[1]-28, origin[0]+28, origin[1]+28), 90+missing_half, p["endDeg"], fill=color, width=2)
    draw.rectangle((0, 0, tile[0] - 1, tile[1] - 1), outline=GRAY)
    draw.rectangle((0, 0, tile[0], 34), fill=INK)
    draw.text((5, 4), laser["bossId"].removeprefix("boss.").replace("_", " ")[:24], font=font(10, True), fill=PAPER)
    draw.text((5, 18), kind, font=font(8), fill=GRAY)
    return image


def laser_sheet(lasers: list[dict[str, Any]]) -> Image.Image:
    columns, tile_w, tile_h, header = 4, 180, 320, 52
    rows = math.ceil(len(lasers) / columns)
    image = Image.new("RGB", (columns * tile_w, header + rows * tile_h), INK)
    draw = ImageDraw.Draw(image)
    draw.text((16, 12), "V4 / EIGHT REAL LASER TOPOLOGIES", font=font(20, True), fill=PAPER)
    draw.text((16, 34), "gray = exact swept warning union / color = live collision geometry", font=font(10), fill=GRAY)
    for index, laser in enumerate(lasers):
        image.paste(laser_tile(laser), ((index % columns) * tile_w, header + (index // columns) * tile_h))
    return image


def run_timeline(run: dict[str, Any]) -> Image.Image:
    image = Image.new("RGB", (1600, 520), INK)
    draw = ImageDraw.Draw(image)
    draw.text((32, 26), "1BIT V4 / RUN DIRECTOR", font=font(28, True), fill=PAPER)
    draw.text((32, 62), "behavioral sampling → material memory; no score ladder", font=font(14), fill=GRAY)
    phases = run["phases"]
    left, right, y = 120, 1480, 190
    step = (right - left) / (len(phases) - 1)
    colors = [PAPER, CYAN, AMBER, MAGENTA, GRAY, PAPER, VIOLET]
    draw.line((left, y, right, y), fill=GRAY, width=2)
    for i, phase in enumerate(phases):
        x = left + step * i
        draw.rectangle((x - 10, y - 10, x + 10, y + 10), fill=colors[i], outline=PAPER)
        label = phase["id"].replace("_", " ")
        draw.text((x - 66, y + 26 + (i % 2) * 62), label, font=font(12, True), fill=PAPER)
        detail = "combat" if phase.get("combat") else "world state"
        if phase["id"] == "mental_room_sampling":
            detail = "2–4 rooms / weighted without replacement"
        elif phase["id"] == "local_override":
            detail = "optional / evidence → directional void → scar"
        elif phase["id"] == "state_snapshot":
            detail = "observation, never rank"
        elif phase["id"] == "cross_run_material_memory":
            detail = "scar → ghost → witness → input"
        draw.text((x - 66, y + 42 + (i % 2) * 62), detail, font=font(9), fill=GRAY)
    draw.text((32, 440), "DIGITAL TRACK", font=font(12, True), fill=CYAN)
    draw.line((164, 448, 760, 448), fill=CYAN, width=2)
    draw.text((800, 440), "MATERIAL TRACK", font=font(12, True), fill=AMBER)
    draw.line((930, 448, 1530, 448), fill=AMBER, width=2)
    draw.text((32, 474), "emit → read → gate → cancel", font=font(12), fill=PAPER)
    draw.text((800, 474), "residue → scar → snapshot → next run", font=font(12), fill=PAPER)
    return image


def main() -> None:
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    patterns = read_json(MANIFEST_DIR / "executable-patterns-v4.json")["patterns"]
    room = [p for p in patterns if p["category"] == "ROOM"]
    common = [p for p in patterns if p["category"] in {"COMMON", "TRANSITION", "WEATHER_ECHO"}]
    boss = [p for p in patterns if p["category"] == "BOSS"]
    lasers = read_json(MANIFEST_DIR / "laser-geometries-v4.json")["lasers"]
    run = read_json(MANIFEST_DIR / "run-director-v4.json")
    outputs = {
        "patterns-room-v4.png": sheet(room, 4, "V4 / FOUR ROOMS × FOUR EXECUTABLE PATTERNS"),
        "patterns-common-transition-weather-v4.png": sheet(common, 4, "V4 / COMMON · TRANSITION · WEATHER-ECHO ENCOUNTERS"),
        "patterns-boss-v4.png": sheet(boss, 4, "V4 / EIGHT BOSSES × THREE PHASES"),
        "laser-geometries-v4.png": laser_sheet(lasers),
        "run-director-v4.png": run_timeline(run),
    }
    index = []
    for name, image in outputs.items():
        path = PREVIEW_DIR / name
        image.save(path, optimize=True)
        index.append({"path": name, "width": image.width, "height": image.height})
    (PREVIEW_DIR / "preview-index-v4.json").write_text(json.dumps({"schemaVersion": "4.0.0", "source": "../../manifests/gameplay/gameplay-index-v4.json", "note": "Geometry placeholders generated from canonical gameplay manifests; not final art.", "files": index}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"rendered {len(outputs)} preview boards")


if __name__ == "__main__":
    main()
