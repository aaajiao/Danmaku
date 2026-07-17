#!/usr/bin/env python3
"""Build deterministic V4 add-on atlases from three generated source boards.

The generated boards are sketches. This builder owns the grid, exact palette,
binary alpha, safety margins, semantic IDs and reproducibility guarantees.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw


SCRIPT_DIR = Path(__file__).resolve().parent
ART_DIR = SCRIPT_DIR.parent
V4_DIR = ART_DIR.parent
SOURCE_DIR = V4_DIR / "sources" / "generated"
ATLAS_DIR = ART_DIR / "atlases"
MANIFEST_DIR = ART_DIR / "manifests"
PREVIEW_DIR = ART_DIR / "previews"

GRID = 8
CELL = 128
ATLAS_SIZE = GRID * CELL
SAFE_MARGIN = 8

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


def rgb(value: str) -> tuple[int, int, int]:
    value = value.removeprefix("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


PALETTE_RGB = {name: rgb(value) for name, value in PALETTE.items()}


@dataclass(frozen=True)
class Board:
    source: str
    output: str
    board_id: str
    rows: tuple[tuple[str, ...], ...]
    row_kinds: tuple[str, ...]
    row_rooms: tuple[str, ...]
    row_accents: tuple[str, ...]


PLAYER_WORLD_ROWS = (
    (
        "flower.dark", "flower.breathe", "flower.resonance", "flower.expression",
        "flower.clamp", "flower.recover_delay", "flower.focus", "flower.trance_echo",
    ),
    (
        "eye.absent_fragment", "eye.reveal", "eye.acquire", "eye.read",
        "eye.clamp", "eye.pressure_hold", "eye.scar_interrupt", "eye.withdraw",
    ),
    (
        "graze.near_miss", "evidence.grain", "override.charge", "override.directional_tear",
        "override.local_void", "override.scar_commit", "override.sediment", "override.recover",
    ),
    (
        "witness.distant", "witness.isolated", "witness.resonance", "witness.lower_head",
        "witness.look_eye", "witness.turn_player", "witness.gather_scar", "witness.rebel_exit",
    ),
    (
        "ghost.walk_a", "ghost.walk_b", "ghost.pause", "ghost.turn",
        "ghost.retrace", "ghost.path_endpoint", "ghost.burnout", "ghost.material_residue",
    ),
    (
        "cable.idle", "cable.attach", "cable.upload_eye", "cable.sever",
        "cable.thermal_burnin", "snapshot_echo.seed", "snapshot_echo.reveal", "snapshot_echo.fade",
    ),
    (
        "threshold.information", "threshold.forced_choice", "threshold.in_between", "threshold.polarized",
        "dusk.warning", "dusk.settle", "dusk.no_dusk_cut", "snapshot.capture",
    ),
    (
        "memory.override_scar", "memory.death_trace", "memory.burnin", "memory.ghost_residue",
        "memory.scar_rehydrate", "memory.witness_turn", "memory.input_return_gap", "memory.material_archive",
    ),
)


COMBAT_ROWS = (
    (
        "cue.projectile.dormant", "cue.projectile.armed", "cue.projectile.delayed_lock", "cue.projectile.turn_once",
        "cue.projectile.stop_release", "cue.projectile.split", "cue.projectile.reflect", "cue.projectile.history_replay",
    ),
    (
        "player_shot.quiet", "player_shot.medium_twin", "player_shot.loud_open", "player_shot.focus_needle",
        "player_shot.option_left", "player_shot.option_right", "player_shot.impact", "player_shot.expression_residue",
    ),
    (
        "enemy_move.packet_entry", "enemy_move.side_sweep", "enemy_move.seam_climb", "enemy_move.mirror_pair",
        "enemy_move.orbit_anchor", "enemy_move.path_replay", "enemy_move.formation_lock", "enemy_move.retreat",
    ),
    (
        "enemy_attack.aim_sample", "enemy_attack.warning_strip", "enemy_attack.emitter_open", "enemy_attack.cadence_tick",
        "enemy_attack.dual_emitter", "enemy_attack.weakpoint_reveal", "enemy_attack.attack_lock", "enemy_attack.material_shutdown",
    ),
    (
        "boss_node.reading_aperture", "boss_node.weakpoint_shutter", "boss_node.single_emitter", "boss_node.unequal_twin_emitters",
        "boss_node.ab_clock", "boss_node.phase_divider", "boss_node.rupture_joint", "boss_node.material_anchor",
    ),
    (
        "laser_piece.packet_gap_cap", "laser_piece.scanning_hinge", "laser_piece.unequal_double_cap", "laser_piece.shutter_segment",
        "laser_piece.ab_intersection", "laser_piece.binary_wall_edge", "laser_piece.scar_break", "laser_piece.incomplete_arc_cap",
    ),
    (
        "residue.thermal_curl", "residue.thermal_dropout", "residue.acrylic_offcut", "residue.misaligned_mold",
        "residue.crossed_fiber", "residue.delamination", "residue.red_hardcut", "residue.bone_core",
    ),
    (
        "weather.static_warning", "weather.static_dropout", "weather.rain_onset", "weather.ash_settle",
        "weather.wind_vector", "weather.eclipse_occlusion", "weather.puddle_trace", "weather.shadow_failure",
    ),
)


BOSS_NAMES = (
    "absent_receiver", "unanswering_feed", "one_sun_one_rule", "two_claims",
    "misreader", "misregistered_twin_moons", "no_dusk", "absolute_reader",
)
BOSS_COLUMNS = (
    "phase1_establish", "phase1_live", "phase2_adapt", "phase2_live",
    "phase3_incomplete", "aperture_open", "protocol_interrupted", "material_residue",
)
BOSS_ROWS = tuple(tuple(f"boss.{boss}.{column}" for column in BOSS_COLUMNS) for boss in BOSS_NAMES)


BOARDS = (
    Board(
        "player-world-v4-source.png", "player-world-behavior-v4.png", "player-world-behavior-v4",
        PLAYER_WORLD_ROWS,
        ("flower", "eye", "override", "witness", "ghost", "infrastructure", "threshold", "memory"),
        ("ANY", "ANY", "ANY", "ANY", "ANY", "ANY", "ANY", "ANY"),
        ("BETWEEN_VIOLET", "INFO_CYAN", "OVERRIDE_MAGENTA", "SELF_PAPER", "FRICTION_GRAY", "INFO_CYAN", "POLAR_RED", "OVERRIDE_MAGENTA"),
    ),
    Board(
        "combat-behavior-v4-source.png", "combat-behavior-cues-v4.png", "combat-behavior-cues-v4",
        COMBAT_ROWS,
        ("projectileCue", "playerShot", "enemyMovement", "enemyAttack", "bossNode", "laserPiece", "materialResidue", "weather"),
        ("ANY", "ANY", "ANY", "ANY", "ANY", "ANY", "ANY", "ANY"),
        ("INFO_CYAN", "INFO_CYAN", "FRICTION_GRAY", "FORCED_AMBER", "BETWEEN_VIOLET", "INFO_CYAN", "FRICTION_GRAY", "POLAR_RED"),
    ),
    Board(
        "boss-phases-v4-source.png", "boss-phase-components-v4.png", "boss-phase-components-v4",
        BOSS_ROWS,
        tuple("bossPhase" for _ in range(8)),
        ("INFORMATION", "INFORMATION", "FORCED_CHOICE", "FORCED_CHOICE", "IN_BETWEEN", "IN_BETWEEN", "POLARIZED", "POLARIZED"),
        ("INFO_CYAN", "INFO_CYAN", "FORCED_AMBER", "FORCED_AMBER", "BETWEEN_VIOLET", "BETWEEN_VIOLET", "POLAR_RED", "POLAR_RED"),
    ),
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def is_key_green(pixel: tuple[int, int, int]) -> bool:
    r, g, b = pixel
    return g >= 105 and g >= r * 1.30 and g >= b * 1.30


def nearest_color(pixel: tuple[int, int, int], allowed: Iterable[str]) -> tuple[int, int, int]:
    r, g, b = pixel
    best_name = min(
        allowed,
        key=lambda name: sum((channel - target) ** 2 for channel, target in zip((r, g, b), PALETTE_RGB[name])),
    )
    return PALETTE_RGB[best_name]


def allowed_colors(row: int, col: int, board: Board) -> tuple[str, ...]:
    accent = board.row_accents[row]
    base = ["SYSTEM_INK", "SELF_PAPER", "FRICTION_GRAY"]
    if accent not in base:
        base.append(accent)
    if board.board_id == "player-world-behavior-v4" and row in (2, 7):
        base = ["SYSTEM_INK", "SELF_PAPER", "FRICTION_GRAY", "OVERRIDE_MAGENTA"]
    if board.board_id == "combat-behavior-cues-v4" and row == 6:
        room_accents = ("INFO_CYAN", "INFO_CYAN", "FORCED_AMBER", "FORCED_AMBER", "BETWEEN_VIOLET", "BETWEEN_VIOLET", "POLAR_RED", "POLAR_RED")
        base = ["SYSTEM_INK", "SELF_PAPER", "FRICTION_GRAY", room_accents[col]]
    return tuple(base)


def square_resize(source: Image.Image) -> Image.Image:
    source = source.convert("RGB")
    side = min(source.size)
    left = (source.width - side) // 2
    top = (source.height - side) // 2
    source = source.crop((left, top, left + side, top + side))
    return source.resize((ATLAS_SIZE, ATLAS_SIZE), Image.Resampling.NEAREST)


def enforce_margin(cell: Image.Image) -> Image.Image:
    alpha = cell.getchannel("A")
    bbox = alpha.getbbox()
    if not bbox:
        return cell
    max_size = CELL - SAFE_MARGIN * 2
    width = bbox[2] - bbox[0]
    height = bbox[3] - bbox[1]
    if width <= max_size and height <= max_size:
        return cell
    crop = cell.crop(bbox)
    scale = min(max_size / width, max_size / height)
    target = (max(1, round(width * scale)), max(1, round(height * scale)))
    crop = crop.resize(target, Image.Resampling.NEAREST)
    out = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    out.alpha_composite(crop, ((CELL - target[0]) // 2, (CELL - target[1]) // 2))
    return out


def process_cell(raw: Image.Image, board: Board, row: int, col: int) -> Image.Image:
    allowed = allowed_colors(row, col, board)
    src = raw.convert("RGB")
    out = Image.new("RGBA", src.size, (0, 0, 0, 0))
    src_pixels = src.load()
    out_pixels = out.load()
    for y in range(src.height):
        for x in range(src.width):
            pixel = src_pixels[x, y]
            if is_key_green(pixel):
                continue
            out_pixels[x, y] = (*nearest_color(pixel, allowed), 255)
    return enforce_margin(out)


def build_board(board: Board) -> tuple[dict, list[dict]]:
    source_path = SOURCE_DIR / board.source
    if not source_path.exists():
        raise FileNotFoundError(source_path)
    source = square_resize(Image.open(source_path))
    atlas = Image.new("RGBA", (ATLAS_SIZE, ATLAS_SIZE), (0, 0, 0, 0))
    frames: list[dict] = []
    for row in range(GRID):
        for col in range(GRID):
            rect = (col * CELL, row * CELL, (col + 1) * CELL, (row + 1) * CELL)
            cell = process_cell(source.crop(rect), board, row, col)
            atlas.alpha_composite(cell, (col * CELL, row * CELL))
            semantic_id = board.rows[row][col]
            visible = sorted({pixel[:3] for pixel in cell.get_flattened_data() if pixel[3]})
            frames.append({
                "semanticId": semantic_id,
                "board": board.board_id,
                "atlas": f"atlases/{board.output}",
                "index": row * GRID + col,
                "row": row,
                "column": col,
                "rect": [col * CELL, row * CELL, CELL, CELL],
                "pivot": [0.5, 0.5],
                "kind": board.row_kinds[row],
                "room": board.row_rooms[row],
                "collisionClass": "NONE",
                "authority": "visual-subscriber",
                "visibleColorCount": len(visible),
            })
    ATLAS_DIR.mkdir(parents=True, exist_ok=True)
    output_path = ATLAS_DIR / board.output
    atlas.save(output_path, optimize=False, compress_level=9)
    manifest = {
        "id": board.board_id,
        "file": f"atlases/{board.output}",
        "size": [ATLAS_SIZE, ATLAS_SIZE],
        "grid": [GRID, GRID],
        "cell": [CELL, CELL],
        "source": f"sources/generated/{board.source}",
        "sha256": sha256(output_path),
    }
    return manifest, frames


def build_preview(manifests: list[dict]) -> None:
    scale = 0.43
    thumb = round(ATLAS_SIZE * scale)
    gap = 28
    top = 36
    canvas = Image.new("RGB", (thumb * 3 + gap * 4, thumb + top + gap), PALETTE_RGB["SYSTEM_INK"])
    draw = ImageDraw.Draw(canvas)
    for index, manifest in enumerate(manifests):
        image = Image.open(ATLAS_DIR / Path(manifest["file"]).name).convert("RGBA")
        image = image.resize((thumb, thumb), Image.Resampling.NEAREST)
        x = gap + index * (thumb + gap)
        canvas.paste(image, (x, top), image)
        draw.text((x, 10), manifest["id"], fill=PALETTE_RGB["SELF_PAPER"])
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    canvas.save(PREVIEW_DIR / "v4-addon-atlas-overview.png", compress_level=9)


def validate(manifests: list[dict], frames: list[dict]) -> dict:
    errors: list[str] = []
    ids = [frame["semanticId"] for frame in frames]
    if len(ids) != len(set(ids)):
        errors.append("semantic IDs are not unique")
    if len(frames) != 192:
        errors.append(f"expected 192 frames, found {len(frames)}")
    exact_palette = set(PALETTE_RGB.values())
    for manifest in manifests:
        image = Image.open(ATLAS_DIR / Path(manifest["file"]).name).convert("RGBA")
        if image.size != (ATLAS_SIZE, ATLAS_SIZE):
            errors.append(f"{manifest['id']} has invalid size")
        for index, pixel in enumerate(image.get_flattened_data()):
            if pixel[3] not in (0, 255):
                errors.append(f"{manifest['id']} alpha is not binary at {index}")
                break
            if pixel[3] and pixel[:3] not in exact_palette:
                errors.append(f"{manifest['id']} has off-palette pixel at {index}")
                break
    for frame in frames:
        if frame["visibleColorCount"] > 4:
            errors.append(f"{frame['semanticId']} exceeds four visible colors")
    return {
        "schemaVersion": "4.0.0-art-qa",
        "status": "PASS" if not errors else "FAIL",
        "atlasCount": len(manifests),
        "frameCount": len(frames),
        "errors": errors,
    }


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    manifests: list[dict] = []
    frames: list[dict] = []
    for board in BOARDS:
        manifest, board_frames = build_board(board)
        manifests.append(manifest)
        frames.extend(board_frames)
    write_json(MANIFEST_DIR / "atlas-index-v4-additions.json", {
        "schemaVersion": "4.0.0",
        "palette": PALETTE,
        "atlases": manifests,
    })
    write_json(MANIFEST_DIR / "frame-index-v4-additions.json", {
        "schemaVersion": "4.0.0",
        "coordinateSystem": "top-left-origin",
        "frames": frames,
    })
    report = validate(manifests, frames)
    write_json(V4_DIR / "reports" / "art-atlas-validation.json", report)
    build_preview(manifests)
    if report["errors"]:
        raise SystemExit("\n".join(report["errors"]))
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
