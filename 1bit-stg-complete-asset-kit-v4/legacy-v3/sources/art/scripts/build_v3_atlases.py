#!/usr/bin/env python3
"""Build the production v3 sprite atlases from the four authored source boards.

The source boards are deliberately treated as sketches. This builder is the
authority for grid geometry, hard alpha, palette, safe margins and semantics.
Running it twice with the same inputs produces byte-identical PNG pixels and
JSON content.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont


SCRIPT_DIR = Path(__file__).resolve().parent
ART_DIR = SCRIPT_DIR.parent
V3_DIR = ART_DIR.parent
SOURCE_DIR = V3_DIR / "generated"
ATLAS_DIR = ART_DIR / "atlases"
MANIFEST_DIR = ART_DIR / "manifests"
PREVIEW_DIR = ART_DIR / "previews"

GRID = 8
CELL = 128
ATLAS_SIZE = GRID * CELL
SAFE_MARGIN = 8

PALETTE: dict[str, str] = {
    "SYSTEM_INK": "#08090D",
    "SELF_PAPER": "#EFE9DA",
    "FRICTION_GRAY": "#7D8087",
    "INFO_CYAN": "#17A7CA",
    "FORCED_AMBER": "#D6982B",
    "BETWEEN_VIOLET": "#7851B7",
    "POLAR_RED": "#B7463C",
    "OVERRIDE_MAGENTA": "#F02A92",
}


def rgb(hex_color: str) -> tuple[int, int, int]:
    value = hex_color.removeprefix("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


PALETTE_RGB = {name: rgb(value) for name, value in PALETTE.items()}


@dataclass(frozen=True)
class RowSpec:
    clip_id: str
    frame_ids: tuple[str, ...]
    kind: str
    room: str
    logical_size: int
    collision_class: str
    threat_role: str
    accent: str
    durations_ms: tuple[int, ...]
    loop: bool = False
    allow_magenta: tuple[bool, ...] = (False,) * 8
    events: tuple[dict[str, Any], ...] = ()


def row(
    clip_id: str,
    frame_ids: list[str],
    kind: str,
    room: str,
    logical_size: int,
    collision_class: str,
    threat_role: str,
    accent: str,
    durations_ms: list[int],
    *,
    loop: bool = False,
    allow_magenta: list[bool] | None = None,
    events: list[dict[str, Any]] | None = None,
) -> RowSpec:
    assert len(frame_ids) == GRID
    assert len(durations_ms) == GRID
    return RowSpec(
        clip_id=clip_id,
        frame_ids=tuple(frame_ids),
        kind=kind,
        room=room,
        logical_size=logical_size,
        collision_class=collision_class,
        threat_role=threat_role,
        accent=accent,
        durations_ms=tuple(durations_ms),
        loop=loop,
        allow_magenta=tuple(allow_magenta or [False] * GRID),
        events=tuple(events or []),
    )


CORE_ROWS = [
    row(
        "library.bullet.micro",
        [
            "bullet.micro.notch_e",
            "bullet.micro.notch_ne",
            "bullet.micro.split",
            "bullet.micro.dash",
            "bullet.micro.thorn",
            "bullet.micro.shard",
            "bullet.micro.seed",
            "bullet.micro.bit",
        ],
        "enemyBullet",
        "ANY",
        16,
        "enemy_projectile_small",
        "moving_prohibition",
        "INFO_CYAN",
        [90] * 8,
    ),
    row(
        "library.bullet.medium",
        [
            "bullet.medium.blade",
            "bullet.medium.droplet",
            "bullet.medium.packet",
            "bullet.medium.capsule",
            "bullet.medium.fork",
            "bullet.medium.leaf",
            "bullet.medium.bar",
            "bullet.medium.diamond_void",
        ],
        "enemyBullet",
        "ANY",
        32,
        "enemy_projectile_medium",
        "pattern_carrier",
        "FORCED_AMBER",
        [105] * 8,
    ),
    row(
        "library.hazard.heavy",
        [
            "hazard.heavy.wall_chunk",
            "hazard.heavy.long_lance",
            "hazard.heavy.twin_block",
            "hazard.heavy.blade_mass",
            "hazard.heavy.slash_bar",
            "hazard.heavy.gate",
            "hazard.heavy.column",
            "hazard.heavy.pressure_plate",
        ],
        "hazard",
        "ANY",
        64,
        "enemy_hazard_heavy",
        "space_denial",
        "POLAR_RED",
        [130] * 8,
    ),
    row(
        "library.player.system",
        [
            "player.core.idle",
            "player.focus.confirm_tick",
            "player.option.left",
            "player.option.right",
            "player.shot.tap",
            "player.shot.hold",
            "player.guard.incomplete_shell",
            "player.hitbox.offset_core",
        ],
        "player",
        "ANY",
        32,
        "player_or_player_system",
        "self_control",
        "INFO_CYAN",
        [180, 130, 180, 180, 70, 90, 180, 180],
    ),
    row(
        "library.pickup",
        [
            "pickup.score.open_bit",
            "pickup.power.fork",
            "pickup.life.fragment",
            "pickup.memory.node",
            "pickup.witness.fragment",
            "pickup.option.gain",
            "pickup.snapshot.seed",
            "pickup.polarity.key",
        ],
        "pickup",
        "ANY",
        16,
        "pickup",
        "permission",
        "BETWEEN_VIOLET",
        [220] * 8,
        loop=True,
    ),
    row(
        "library.enemy.governor_a",
        [
            "enemy.courier",
            "enemy.clamp",
            "enemy.comparator",
            "enemy.warden",
            "enemy.witness_drone",
            "enemy.cable_biter",
            "enemy.echo_frame",
            "enemy.seed_carrier",
        ],
        "enemy",
        "ANY",
        32,
        "enemy_body_medium",
        "governor",
        "INFO_CYAN",
        [190] * 8,
    ),
    row(
        "library.enemy.governor_b",
        [
            "enemy.seam_walker",
            "enemy.packet_moth",
            "enemy.fork_crab",
            "enemy.residue_hound",
            "enemy.link_sentry",
            "enemy.asymmetric_twin",
            "enemy.burnin_ghost",
            "enemy.archive_leecher",
        ],
        "enemy",
        "ANY",
        64,
        "enemy_body_large",
        "governor",
        "FORCED_AMBER",
        [210] * 8,
    ),
    row(
        "library.utility",
        [
            "utility.spawn.marker",
            "utility.path.node",
            "utility.warning.strip",
            "utility.hit.spark",
            "utility.graze.tick",
            "utility.delete.mark",
            "utility.residue.patch",
            "utility.offscreen.arrow",
        ],
        "utility",
        "ANY",
        16,
        "none",
        "readability",
        "BETWEEN_VIOLET",
        [120] * 8,
    ),
]


BOSS_NAMES = [
    ("absent_receiver", "INFO_CYAN"),
    ("unanswering_feed", "INFO_CYAN"),
    ("one_sun_one_rule", "FORCED_AMBER"),
    ("two_claims", "FORCED_AMBER"),
    ("misreader", "BETWEEN_VIOLET"),
    ("misregistered_twin_moons", "BETWEEN_VIOLET"),
    ("no_dusk", "POLAR_RED"),
    ("absolute_reader", "POLAR_RED"),
]
BOSS_ROOM_BY_ACCENT = {
    "INFO_CYAN": "INFORMATION",
    "FORCED_AMBER": "FORCED_CHOICE",
    "BETWEEN_VIOLET": "IN_BETWEEN",
    "POLAR_RED": "POLARIZED",
}
BOSS_STATES = ["silhouette", "idle_a", "idle_b", "telegraph", "attack", "break", "death", "residue"]
BOSS_ROWS = [
    row(
        f"boss.{boss_name}.rig",
        [f"boss.{boss_name}.{state}" for state in BOSS_STATES],
        "boss",
        BOSS_ROOM_BY_ACCENT[accent],
        64,
        "boss_body",
        "governor_apex",
        accent,
        [220, 190, 230, 120, 150, 180, 260, 820],
        events=[
            {"frame": 3, "name": "telegraph_commit"},
            {"frame": 4, "name": "attack_live"},
            {"frame": 6, "name": "digital_delete"},
            {"frame": 7, "name": "material_residue"},
        ],
    )
    for boss_name, accent in BOSS_NAMES
]


COMBAT_ROWS = [
    row(
        "player.focus",
        [f"player.focus.frame_{i:02d}" for i in range(8)],
        "player",
        "ANY",
        32,
        "player_body",
        "self_control",
        "INFO_CYAN",
        [90, 90, 180, 240, 70, 60, 130, 180],
        events=[{"frame": 3, "name": "focus_hold"}, {"frame": 6, "name": "focus_confirm"}],
    ),
    row(
        "system.eye_clamp",
        [f"system.eye_clamp.frame_{i:02d}" for i in range(8)],
        "systemOverlay",
        "ANY",
        32,
        "none",
        "regulation_feedback",
        "INFO_CYAN",
        [40, 40, 40, 120, 120, 180, 210, 260],
        events=[{"frame": 3, "name": "clamp_closed"}, {"frame": 7, "name": "recovery_allowed"}],
    ),
    row(
        "system.override.directional",
        [f"system.override.directional.frame_{i:02d}" for i in range(8)],
        "override",
        "ANY",
        64,
        "override_field",
        "local_rule_rewrite",
        "INFO_CYAN",
        [110, 90, 80, 100, 120, 150, 240, 360],
        allow_magenta=[False, False, False, False, True, True, True, False],
        events=[
            {"frame": 1, "name": "charge"},
            {"frame": 2, "name": "directional_tear"},
            {"frame": 3, "name": "local_void"},
            {"frame": 4, "name": "collision_off"},
            {"frame": 5, "name": "scar_write"},
            {"frame": 7, "name": "material_sediment"},
        ],
    ),
    row(
        "player.causality.damage_to_trace",
        [
            "player.hit",
            "player.core_break",
            "player.shard",
            "player.digital_delete",
            "player.void_hold",
            "player.residue_appear",
            "player.residue_hold",
            "player.residue_fade",
        ],
        "playerFx",
        "ANY",
        32,
        "none",
        "death_causality",
        "POLAR_RED",
        [60, 70, 80, 90, 110, 160, 300, 220],
        events=[{"frame": 3, "name": "collision_removed"}, {"frame": 5, "name": "residue_created"}],
    ),
    row(
        "player.return_with_history",
        [f"player.respawn_asymmetric.frame_{i:02d}" for i in range(8)],
        "playerFx",
        "ANY",
        32,
        "none",
        "return_with_history",
        "BETWEEN_VIOLET",
        [180, 120, 100, 120, 150, 160, 190, 220],
        events=[{"frame": 0, "name": "read_previous_scar"}, {"frame": 5, "name": "collision_restored"}],
    ),
    row(
        "enemy.causality.damage_to_trace",
        [
            "enemy.hit",
            "enemy.fracture",
            "enemy.split",
            "enemy.digital_delete",
            "enemy.rupture",
            "enemy.residue",
            "enemy.ash",
            "enemy.clear",
        ],
        "enemyFx",
        "ANY",
        64,
        "none",
        "death_causality",
        "FORCED_AMBER",
        [60, 80, 90, 110, 140, 300, 240, 160],
        events=[{"frame": 3, "name": "collision_removed"}, {"frame": 5, "name": "material_residue"}],
    ),
    row(
        "bullet.lifecycle",
        [
            "bullet.birth_0",
            "bullet.birth_1",
            "bullet.live",
            "bullet.travel",
            "bullet.impact_0",
            "bullet.impact_1",
            "bullet.afterimage",
            "bullet.clear",
        ],
        "enemyBulletFx",
        "ANY",
        16,
        "enemy_projectile_small",
        "moving_prohibition",
        "INFO_CYAN",
        [45, 45, 90, 90, 50, 70, 100, 120],
        events=[{"frame": 2, "name": "collision_live"}, {"frame": 4, "name": "collision_removed"}],
    ),
    row(
        "boss.laser.lifecycle",
        [
            "boss.laser.off",
            "boss.laser.telegraph_0",
            "boss.laser.telegraph_1",
            "boss.laser.charge",
            "boss.laser.active",
            "boss.laser.decay",
            "boss.laser.residue",
            "boss.laser.cancel",
        ],
        "bossLaser",
        "ANY",
        64,
        "boss_laser",
        "space_denial",
        "FRICTION_GRAY",
        [100, 120, 120, 180, 260, 140, 360, 160],
        events=[
            {"frame": 1, "name": "telegraph_on"},
            {"frame": 3, "name": "charge_commit"},
            {"frame": 4, "name": "collision_live"},
            {"frame": 5, "name": "collision_removed"},
            {"frame": 6, "name": "residue_created"},
        ],
    ),
]


NARRATIVE_ROWS = [
    row(
        "narrative.witness.rebel",
        [
            "witness.idle_a",
            "witness.idle_b",
            "witness.turn_0",
            "witness.turn_1",
            "witness.face_player",
            "witness.rebel_mark",
            "witness.rebel_hold",
            "witness.rebel_exit",
        ],
        "narrativeActor",
        "ANY",
        32,
        "none",
        "witness_behavior",
        "INFO_CYAN",
        [240, 260, 120, 160, 220, 140, 340, 220],
        events=[{"frame": 4, "name": "witness_choice"}, {"frame": 5, "name": "rebel_committed"}],
    ),
    row(
        "narrative.ghost.burnout",
        [
            "ghost.walk_0",
            "ghost.walk_1",
            "ghost.hesitate_0",
            "ghost.hesitate_1",
            "ghost.stumble",
            "ghost.burnout_0",
            "ghost.burnout_1",
            "ghost.residue",
        ],
        "narrativeActor",
        "ANY",
        32,
        "none",
        "burnout_behavior",
        "FRICTION_GRAY",
        [180, 180, 260, 340, 180, 210, 280, 420],
        events=[{"frame": 2, "name": "hesitation"}, {"frame": 5, "name": "burnout"}],
    ),
    row(
        "narrative.cable.upload_or_burnin",
        [
            "cable.idle",
            "cable.attach",
            "cable.upload_0",
            "cable.upload_1",
            "cable.burnin_0",
            "cable.burnin_1",
            "cable.disconnect",
            "cable.residue",
        ],
        "narrativeProp",
        "ANY",
        64,
        "none",
        "digital_material_choice",
        "FORCED_AMBER",
        [180, 130, 120, 170, 170, 240, 160, 360],
        events=[{"frame": 1, "name": "branch_open"}, {"frame": 3, "name": "upload"}, {"frame": 5, "name": "burn_in"}],
    ),
    row(
        "memory.directional_write",
        [
            "scar.seed",
            "scar.extend_0",
            "scar.extend_1",
            "scar.branch",
            "scar.commit",
            "scar.hold",
            "scar.burn",
            "scar.permanent",
        ],
        "memory",
        "ANY",
        64,
        "none",
        "persistent_consequence",
        "BETWEEN_VIOLET",
        [90, 110, 120, 140, 160, 240, 320, 520],
        allow_magenta=[False, False, False, False, True, True, True, False],
        events=[{"frame": 4, "name": "scar_write"}, {"frame": 7, "name": "snapshot_ready"}],
    ),
    row(
        "weather.static_dropout",
        [
            "weather.static.calm",
            "weather.static.noise_0",
            "weather.static.noise_1",
            "weather.static.burst",
            "weather.static.tear",
            "weather.static.dropout",
            "weather.static.recover",
            "weather.static.after",
        ],
        "weather",
        "INFORMATION",
        64,
        "none",
        "visibility_pressure",
        "INFO_CYAN",
        [220, 80, 70, 60, 80, 180, 120, 260],
        loop=True,
    ),
    row(
        "weather.rain_ash",
        [
            "weather.rain_0",
            "weather.rain_1",
            "weather.rain_2",
            "weather.ash_0",
            "weather.ash_1",
            "weather.ash_2",
            "weather.rain_ash_mix",
            "weather.rain_ash_clear",
        ],
        "weather",
        "ANY",
        32,
        "none",
        "material_atmosphere",
        "FRICTION_GRAY",
        [120, 120, 120, 180, 190, 200, 240, 300],
        loop=True,
    ),
    row(
        "weather.wind_eclipse",
        [
            "weather.wind_0",
            "weather.wind_1",
            "weather.wind_2",
            "weather.eclipse_0",
            "weather.eclipse_1",
            "weather.eclipse_2",
            "weather.eclipse_hold",
            "weather.eclipse_release",
        ],
        "weather",
        "POLARIZED",
        64,
        "none",
        "temporal_visibility",
        "POLAR_RED",
        [120, 130, 140, 180, 200, 240, 360, 220],
        loop=True,
    ),
    row(
        "state.snapshot_handoff",
        [
            "snapshot.collect",
            "snapshot.compress",
            "snapshot.label",
            "snapshot.store",
            "snapshot.handoff",
            "snapshot.next_seed",
            "snapshot.next_scar",
            "snapshot.next_active",
        ],
        "memory",
        "ANY",
        64,
        "none",
        "cross_run_memory",
        "BETWEEN_VIOLET",
        [160, 130, 120, 180, 220, 160, 240, 420],
        allow_magenta=[False, False, False, False, False, False, True, False],
        events=[{"frame": 3, "name": "snapshot_serialized"}, {"frame": 5, "name": "next_run_seeded"}, {"frame": 6, "name": "scar_restored"}],
    ),
]


BOARD_SPECS = [
    {
        "id": "core-grammar-v3",
        "source": "core-grammar-v3-alpha.png",
        "rows": CORE_ROWS,
        "description": "Curated runtime primitives replacing the untyped 656-cell library.",
    },
    {
        "id": "boss-topologies-v3",
        "source": "boss-topologies-v3-alpha.png",
        "rows": BOSS_ROWS,
        "description": "Eight bosses with eight non-interchangeable void topologies.",
    },
    {
        "id": "combat-causality-v3",
        "source": "combat-causality-v3-alpha.png",
        "rows": COMBAT_ROWS,
        "description": "Focus, clamp, Override, death, respawn, projectile and laser causality.",
    },
    {
        "id": "narrative-behavior-v3",
        "source": "narrative-behavior-v3-alpha.png",
        "rows": NARRATIVE_ROWS,
        "description": "Witness, ghost, cable, scar, weather and cross-run behavior.",
    },
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def is_green_spill(r: int, g: int, b: int) -> bool:
    return g > 72 and g > r + 28 and g > b + 24 and g > int(r * 1.22)


def classify_color(
    r: int,
    g: int,
    b: int,
    accent: str,
    allow_magenta: bool,
    invert_dark_body: bool,
) -> tuple[int, int, int]:
    max_c = max(r, g, b)
    min_c = min(r, g, b)
    chroma = max_c - min_c
    luminance = (2126 * r + 7152 * g + 722 * b) // 10000

    if luminance < 46:
        return PALETTE_RGB["SELF_PAPER"] if invert_dark_body else PALETTE_RGB["SYSTEM_INK"]
    if allow_magenta and r > 135 and b > 80 and r > g * 1.25 and b > g * 1.10:
        return PALETTE_RGB["OVERRIDE_MAGENTA"]
    if chroma < 34:
        if luminance >= 178:
            return PALETTE_RGB["SYSTEM_INK"] if invert_dark_body else PALETTE_RGB["SELF_PAPER"]
        if accent == "POLAR_RED":
            return PALETTE_RGB["SYSTEM_INK"] if luminance < 118 else PALETTE_RGB["SELF_PAPER"]
        return PALETTE_RGB["FRICTION_GRAY"]
    if luminance >= 214 and chroma < 76:
        return PALETTE_RGB["SELF_PAPER"]
    # Scar/Override write cells replace the room accent with magenta instead
    # of adding a fifth visible color to the ordinary four-color cell budget.
    return PALETTE_RGB["OVERRIDE_MAGENTA"] if allow_magenta else PALETTE_RGB[accent]


def source_cell(source: Image.Image, row_index: int, col_index: int) -> Image.Image:
    left = round(col_index * source.width / GRID)
    right = round((col_index + 1) * source.width / GRID)
    top = round(row_index * source.height / GRID)
    bottom = round((row_index + 1) * source.height / GRID)
    return source.crop((left, top, right, bottom)).resize((CELL, CELL), Image.Resampling.NEAREST)


def enforce_margin(cell: Image.Image) -> Image.Image:
    alpha = cell.getchannel("A")
    bbox = alpha.getbbox()
    if not bbox:
        return cell
    left, top, right, bottom = bbox
    if left >= SAFE_MARGIN and top >= SAFE_MARGIN and right <= CELL - SAFE_MARGIN and bottom <= CELL - SAFE_MARGIN:
        return cell

    content = cell.crop(bbox)
    max_side = CELL - SAFE_MARGIN * 2
    scale = min(max_side / content.width, max_side / content.height, 1.0)
    target_w = max(1, round(content.width * scale))
    target_h = max(1, round(content.height * scale))
    if (target_w, target_h) != content.size:
        content = content.resize((target_w, target_h), Image.Resampling.NEAREST)

    original_cx = (left + right) / 2
    original_cy = (top + bottom) / 2
    x = round(original_cx - target_w / 2)
    y = round(original_cy - target_h / 2)
    x = min(max(x, SAFE_MARGIN), CELL - SAFE_MARGIN - target_w)
    y = min(max(y, SAFE_MARGIN), CELL - SAFE_MARGIN - target_h)

    result = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    result.alpha_composite(content, (x, y))
    return result


def normalize_library_occupancy(cell: Image.Image, target_max_dimension: int) -> Image.Image:
    """Give static library sprites a predictable visible size inside 128px cells.

    Image generators tend to interpret "micro bullet" as a few source pixels,
    but a 128px atlas cell is later scaled to a 16px logical quad. Without this
    normalization the final projectile can become sub-pixel. Animation boards
    intentionally skip this step because changing area is part of their timing.
    """
    bbox = cell.getchannel("A").getbbox()
    if not bbox:
        return cell
    left, top, right, bottom = bbox
    content = cell.crop(bbox)
    current = max(content.size)
    if current == target_max_dimension:
        return cell
    scale = target_max_dimension / max(1, current)
    target_w = max(1, round(content.width * scale))
    target_h = max(1, round(content.height * scale))
    max_side = CELL - SAFE_MARGIN * 2
    if target_w > max_side or target_h > max_side:
        down = min(max_side / target_w, max_side / target_h)
        target_w = max(1, round(target_w * down))
        target_h = max(1, round(target_h * down))
    content = content.resize((target_w, target_h), Image.Resampling.NEAREST)
    cx = (left + right) / 2
    cy = (top + bottom) / 2
    x = min(max(round(cx - target_w / 2), SAFE_MARGIN), CELL - SAFE_MARGIN - target_w)
    y = min(max(round(cy - target_h / 2), SAFE_MARGIN), CELL - SAFE_MARGIN - target_h)
    result = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    result.alpha_composite(content, (x, y))
    return result


def lift_nearly_invisible_dark_body(cell: Image.Image, kind: str, accent: str) -> Image.Image:
    """Prevent actors/props from becoming black cutouts on the ink playfield."""
    readable_kinds = {"player", "pickup", "enemy", "utility", "narrativeActor", "narrativeProp"}
    if kind not in readable_kinds:
        return cell
    pixels = list(cell.get_flattened_data())
    visible = [pixel for pixel in pixels if pixel[3] > 0]
    if not visible:
        return cell
    ink = PALETTE_RGB["SYSTEM_INK"]
    ink_count = sum(1 for red, green, blue, _ in visible if (red, green, blue) == ink)
    threshold = 0.45 if kind == "narrativeProp" else 0.78
    if ink_count / len(visible) < threshold:
        return cell
    replacement = PALETTE_RGB["SELF_PAPER"] if accent == "POLAR_RED" else PALETTE_RGB["FRICTION_GRAY"]
    result = cell.copy()
    data = []
    for red, green, blue, alpha in pixels:
        if alpha and (red, green, blue) == ink:
            data.append((*replacement, alpha))
        else:
            data.append((red, green, blue, alpha))
    result.putdata(data)
    return result


def material_ghost_residue() -> Image.Image:
    """A low-luminance, path-derived remainder for the terminal ghost frame."""
    result = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    draw = ImageDraw.Draw(result)
    gray = (*PALETTE_RGB["FRICTION_GRAY"], 255)
    # Uneven footprints and settled fragments; deliberately no centered icon.
    fragments = [
        (39, 79, 46, 82),
        (49, 75, 53, 78),
        (56, 81, 64, 84),
        (67, 77, 71, 80),
        (75, 83, 84, 86),
        (88, 80, 92, 82),
        (52, 69, 55, 72),
        (72, 71, 74, 74),
    ]
    for fragment in fragments:
        draw.rectangle(fragment, fill=gray)
    return result


def open_focus_ring(cell: Image.Image, col_index: int) -> Image.Image:
    """Keep Focus incomplete: it converges but never becomes a generic emblem."""
    if col_index < 4:
        return cell
    result = cell.copy()
    alpha = result.getchannel("A")
    bbox = alpha.getbbox()
    if not bbox:
        return result
    left, top, right, bottom = bbox
    notch_w = max(3, min(7, (right - left) // 8))
    notch_h = max(3, min(6, (bottom - top) // 9))
    draw = ImageDraw.Draw(result)
    draw.rectangle((left, top + 2, left + notch_w, top + 2 + notch_h), fill=(0, 0, 0, 0))
    return result


def process_cell(
    raw: Image.Image,
    accent: str,
    allow_magenta: bool,
    *,
    focus_col: int | None = None,
    invert_dark_body: bool = False,
) -> Image.Image:
    raw = raw.convert("RGBA")
    px = raw.load()
    # Remove per-cell border contamination before color classification.
    border = 2
    for y in range(CELL):
        for x in range(CELL):
            r, g, b, a = px[x, y]
            if x < border or y < border or x >= CELL - border or y >= CELL - border:
                px[x, y] = (0, 0, 0, 0)
                continue
            if a < 96 or is_green_spill(r, g, b):
                px[x, y] = (0, 0, 0, 0)
                continue
            nr, ng, nb = classify_color(r, g, b, accent, allow_magenta, invert_dark_body)
            px[x, y] = (nr, ng, nb, 255)

    raw = enforce_margin(raw)
    if focus_col is not None:
        raw = open_focus_ring(raw, focus_col)
    # Reassert binary alpha after compositing and edits.
    alpha = raw.getchannel("A").point(lambda value: 255 if value >= 128 else 0)
    raw.putalpha(alpha)
    return raw


def frame_record(
    board_id: str,
    row_index: int,
    col_index: int,
    spec: RowSpec,
) -> dict[str, Any]:
    semantic_id = spec.frame_ids[col_index]
    palette_role = spec.accent
    atlas_ref = board_id
    if board_id == "core-grammar-v3" and spec.kind in {"enemyBullet", "hazard"}:
        atlas_ref = "core-projectile-v3"
    elif board_id == "combat-causality-v3" and spec.kind in {"enemyBulletFx", "bossLaser"}:
        atlas_ref = "combat-projectile-v3"
    return {
        "id": semantic_id,
        "semanticId": semantic_id,
        "atlas": atlas_ref,
        "frameIndex": row_index * GRID + col_index,
        "index": row_index * GRID + col_index,
        "row": row_index,
        "column": col_index,
        "rect": [col_index * CELL, row_index * CELL, CELL, CELL],
        "kind": spec.kind,
        "room": spec.room,
        "paletteRole": palette_role,
        "pivot": [0.5, 0.5],
        "logicalSize": spec.logical_size,
        "collisionClass": spec.collision_class,
        "threatRole": spec.threat_role,
        "durationMs": spec.durations_ms[col_index],
        "alphaMode": "binary",
        "safeMarginPx": SAFE_MARGIN,
    }


def build_board(board: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    source_path = SOURCE_DIR / board["source"]
    if not source_path.exists():
        raise FileNotFoundError(source_path)
    source = Image.open(source_path).convert("RGBA")
    atlas = Image.new("RGBA", (ATLAS_SIZE, ATLAS_SIZE), (0, 0, 0, 0))
    frames: list[dict[str, Any]] = []
    clips: list[dict[str, Any]] = []
    core_occupancy = [24, 52, 82, 64, 52, 64, 76, 48]

    for row_index, spec in enumerate(board["rows"]):
        for col_index in range(GRID):
            raw = source_cell(source, row_index, col_index)
            focus_col = col_index if spec.clip_id == "player.focus" else None
            cell = process_cell(
                raw,
                spec.accent,
                spec.allow_magenta[col_index],
                focus_col=focus_col,
                invert_dark_body=(
                    spec.kind in {"enemyBullet", "hazard", "enemyBulletFx", "bossLaser"}
                    or spec.clip_id == "narrative.witness.rebel"
                ),
            )
            cell = lift_nearly_invisible_dark_body(cell, spec.kind, spec.accent)
            if spec.frame_ids[col_index] == "ghost.residue" and cell.getchannel("A").getbbox() is None:
                cell = material_ghost_residue()
            if board["id"] == "core-grammar-v3":
                cell = normalize_library_occupancy(cell, core_occupancy[row_index])
            atlas.alpha_composite(cell, (col_index * CELL, row_index * CELL))
            frames.append(frame_record(board["id"], row_index, col_index, spec))

        clips.append(
            {
                "clipId": spec.clip_id,
                "atlas": f"atlases/{board['id']}.png",
                "frames": list(spec.frame_ids),
                "durationsMs": list(spec.durations_ms),
                "loop": spec.loop,
                "events": list(spec.events),
                "reducedMotion": {
                    "mode": "event-equivalent-keyframes",
                    "requiredEvents": [event["name"] for event in spec.events],
                    "recommendedFrames": sorted({0, GRID - 1, *[int(event["frame"]) for event in spec.events]}),
                },
            }
        )

    ATLAS_DIR.mkdir(parents=True, exist_ok=True)
    output_path = ATLAS_DIR / f"{board['id']}.png"
    atlas.save(output_path, format="PNG", optimize=False, compress_level=9)
    board_manifest = {
        "id": board["id"],
        "atlasId": board["id"],
        "image": f"atlases/{board['id']}.png",
        "file": f"atlases/{board['id']}.png",
        "description": board["description"],
        "sourceSketch": f"source-boards/{board['source']}",
        "size": [ATLAS_SIZE, ATLAS_SIZE],
        "cell": [CELL, CELL],
        "grid": [GRID, GRID],
        "frameCount": GRID * GRID,
        "sha256": sha256(output_path),
    }
    return board_manifest, frames, clips


def atlas_specs(board_manifests: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    specs: dict[str, dict[str, Any]] = {}
    for board in board_manifests:
        atlas_id = board["atlasId"]
        tags = ["runtime", "pixel", "v3"]
        if atlas_id == "boss-topologies-v3":
            tags.append("boss")
        elif atlas_id == "combat-causality-v3":
            tags.extend(["combat", "animation"])
        elif atlas_id == "narrative-behavior-v3":
            tags.extend(["narrative", "weather"])
        specs[atlas_id] = {
            "id": atlas_id,
            "image": board["image"],
            "grid": [GRID, GRID],
            "cell": [CELL, CELL],
            "size": [ATLAS_SIZE, ATLAS_SIZE],
            "alphaMode": "straight-binary",
            "filter": "nearest",
            "tags": tags,
            "sha256": board["sha256"],
        }

    # Aliases let QA and the runtime select projectile-only frames without
    # duplicating the pixels or misclassifying enemies and pickups.
    specs["core-projectile-v3"] = {
        **specs["core-grammar-v3"],
        "id": "core-projectile-v3",
        "tags": ["runtime", "bullet", "projectile", "danmaku", "v3"],
        "aliasOf": "core-grammar-v3",
    }
    specs["combat-projectile-v3"] = {
        **specs["combat-causality-v3"],
        "id": "combat-projectile-v3",
        "tags": ["runtime", "bullet", "projectile", "laser", "v3"],
        "aliasOf": "combat-causality-v3",
    }
    return specs


def clip_payload(
    clip_id: str,
    spec: RowSpec,
    columns: list[int] | None = None,
    *,
    loop: bool | None = None,
    events: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    selected = columns or list(range(GRID))
    frames = [
        {"frameId": spec.frame_ids[column], "durationMs": spec.durations_ms[column]}
        for column in selected
    ]
    mapped_events: list[dict[str, Any]] = []
    source_events = events if events is not None else list(spec.events)
    for event in source_events:
        source_frame = int(event["frame"])
        if source_frame in selected:
            mapped_events.append({**event, "frame": selected.index(source_frame)})
    reduced_index = mapped_events[-1]["frame"] if mapped_events else (0 if (loop if loop is not None else spec.loop) else len(frames) - 1)
    reduced_index = max(0, min(int(reduced_index), len(frames) - 1))
    return {
        "id": clip_id,
        "atlas": "semantic-frame-index",
        "fps": 12,
        "loop": spec.loop if loop is None else loop,
        "loopMode": "repeat" if (spec.loop if loop is None else loop) else "once",
        "frames": frames,
        "events": mapped_events,
        "reducedMotionFrame": frames[reduced_index]["frameId"],
        "reducedMotionPreservesEvents": True,
        "reducedMotionEvents": [event["name"] for event in mapped_events],
    }


def build_animation_manifest(board_manifests: list[dict[str, Any]]) -> dict[str, Any]:
    clips: dict[str, dict[str, Any]] = {}

    for spec in COMBAT_ROWS + NARRATIVE_ROWS:
        clips[spec.clip_id] = clip_payload(spec.clip_id, spec)

    # Projectile cancel is a real lifecycle slice, not an alias of the full
    # birth/travel/impact strip.
    bullet_spec = COMBAT_ROWS[6]
    clips["bullet.cancel"] = clip_payload(
        "bullet.cancel",
        bullet_spec,
        [4, 5],
        events=[{"frame": 4, "name": "collision_removed"}, {"frame": 5, "name": "impact_complete"}],
    )

    for boss_index, (boss_name, _) in enumerate(BOSS_NAMES):
        spec = BOSS_ROWS[boss_index]
        idle_id = f"boss.{boss_name}.idle"
        attack_id = f"boss.{boss_name}.attack"
        terminal_id = f"boss.{boss_name}.terminal_material"
        clips[idle_id] = clip_payload(idle_id, spec, [1, 2], loop=True, events=[])
        clips[attack_id] = clip_payload(
            attack_id,
            spec,
            [3, 4, 2],
            events=[{"frame": 3, "name": "telegraph_commit"}, {"frame": 4, "name": "attack_live"}],
        )
        clips[terminal_id] = clip_payload(
            terminal_id,
            spec,
            [5, 6, 7],
            events=[{"frame": 6, "name": "digital_delete"}, {"frame": 7, "name": "material_residue"}],
        )

    return {
        "schemaVersion": "3.0.0",
        "description": "Semantic, variable-duration clips. Gameplay events remain authoritative in runtime/runtime-contract.json.",
        "atlases": atlas_specs(board_manifests),
        "clips": clips,
        "proceduralMotions": {
            "enemy.hover": {"transform": "integer-y", "keyframes": [0, -1, -1, 0, 1, 0], "durationsMs": [180, 110, 240, 130, 170, 220]},
            "enemy.recoil": {"transform": "opposite-emitter-direction", "keyframes": [0, 2, 1, 0], "durationsMs": [40, 60, 80, 120]},
            "pickup.drift": {"transform": "integer-xy", "keyframes": [[0, 0], [0, 1], [-1, 1], [0, 0]], "durationsMs": [220, 280, 180, 260]},
        },
    }


def build_boss_rigs() -> dict[str, Any]:
    rigs: dict[str, Any] = {}
    hitbox_types = ["box", "ellipse", "box", "compound", "box", "compound", "box", "ring"]
    for index, (boss_name, accent) in enumerate(BOSS_NAMES):
        room = BOSS_ROOM_BY_ACCENT[accent]
        body_frames = BOSS_ROWS[index].frame_ids
        hitbox_type = hitbox_types[index]
        if hitbox_type == "ellipse":
            hitbox = {"type": "ellipse", "radius": [42, 48]}
        elif hitbox_type == "compound":
            hitbox = {"type": "compound", "shapes": [{"type": "box", "offset": [-18, 0], "halfExtents": [17, 28]}, {"type": "box", "offset": [20, 1], "halfExtents": [15, 26]}]}
        elif hitbox_type == "ring":
            hitbox = {"type": "ring", "innerRadius": 18, "outerRadius": 46}
        else:
            hitbox = {"type": "box", "halfExtents": [40, 40]}
        hitbox.update({"centerNode": "body", "damageTarget": True})
        rigs[boss_name] = {
            "id": boss_name,
            "room": room,
            "topologyFrame": body_frames[0],
            "nodes": {
                "root": {"type": "transform", "parent": None, "anchor": [0.5, 0.5], "pivot": [0.5, 0.5]},
                "body": {
                    "type": "sprite",
                    "parent": "root",
                    "clip": f"boss.{boss_name}.idle",
                    "phaseFrames": {"phase1": body_frames[0], "phase2": body_frames[2], "rupture": body_frames[6]},
                    "anchor": [0.5, 0.5],
                    "pivot": [0.5, 0.5],
                    "renderOrder": 100,
                },
            },
            "phases": [
                {"id": "phase1", "hpRange": [1.0, 0.5], "bodyFrame": body_frames[0], "attackClip": f"boss.{boss_name}.attack", "laserModule": f"laser.{boss_name}"},
                {"id": "phase2", "hpRange": [0.5, 0.0], "bodyFrame": body_frames[2], "attackClip": f"boss.{boss_name}.attack", "laserModule": f"laser.{boss_name}"},
            ],
            "terminalClip": f"boss.{boss_name}.terminal_material",
            "hitboxes": {"body": hitbox},
            "eventBindings": [
                {"event": "boss.phase.swap", "action": {"type": "effect", "id": "boss.phase_swap"}},
                {"event": "boss.attack", "action": {"type": "playClip", "id": f"boss.{boss_name}.attack"}},
                {"event": "boss.laser", "action": {"type": "spawnLaser", "id": f"laser.{boss_name}"}},
            ],
        }
    return {
        "schemaVersion": "3.0.0",
        "description": "One whole-body topology per boss; animation swaps semantic states instead of stacking ornamental emblems.",
        "coordinateSystem": {"anchorSpace": "normalized-body-space-top-left-origin", "logicalViewport": [360, 640]},
        "defaults": {"renderOrder": {"body": 100}, "bodyLogicalSize": [128, 128], "alphaTest": 0.5, "depthWrite": False},
        "rigs": rigs,
    }


def build_laser_modules() -> dict[str, Any]:
    modules: dict[str, Any] = {}
    frame_refs = {
        "warning": "boss.laser.telegraph_1",
        "emitter": "boss.laser.charge",
        "body": "boss.laser.active",
        "end": "boss.laser.decay",
    }
    patterns = ["packet-gap", "vertical-feed", "single-rule", "unequal-seam", "double-read", "offset-crescents", "binary-wall", "scarred-eye"]
    for index, (boss_name, accent) in enumerate(BOSS_NAMES):
        modules[f"laser.{boss_name}"] = {
            "id": f"laser.{boss_name}",
            "room": BOSS_ROOM_BY_ACCENT[accent],
            "frames": frame_refs,
            "display": {
                "widthLogicalPx": 6 + index,
                "paletteRole": accent,
                "paletteRemap": {"FRICTION_GRAY": accent},
                "pattern": patterns[index],
            },
            "bodySlice": {"mode": "stretch-center", "sampleRangeNormalized": [0.47, 0.53], "repeat": False, "capOverlapLogicalPx": 1},
            "timing": {
                "warningMs": 620 + index * 55,
                "chargeMs": 150 + index * 15,
                "growMs": 120 + index * 10,
                "minimumLiveMs": 420 + index * 40,
                "shutdownMs": 180,
                "residueMs": 240,
            },
            "collision": {"type": "segment", "radiusLogicalPx": 3 + index // 2, "endpointInsetLogicalPx": 4 + index // 2},
        }
    return {
        "schemaVersion": "3.0.0",
        "stateMachine": "../../runtime/boss-laser-state-machine.json",
        "defaults": {
            "axis": "local-x",
            "warning": {"durationMs": 700, "collisionEnabled": False},
            "fire": {"chargeMs": 180, "growMs": 140, "minimumLiveMs": 480},
            "shutdown": {"clip": "boss.laser.lifecycle", "durationMs": 180},
            "collision": {"enableState": "live", "disableState": "shutdown"},
            "render": {"blendMode": "normal", "alphaTest": 0.5, "depthWrite": False, "toneMapped": False},
            "reducedMotion": {"disableBodyScroll": True, "gameplayTimingUnchanged": True},
        },
        "modules": modules,
    }


def build_runtime_effects() -> dict[str, Any]:
    effect_ids = [
        "sprite.damage_flash",
        "bullet.cancel_dither",
        "laser.warning_pulse",
        "laser.grow",
        "laser.body_scroll",
        "laser.shutdown",
        "room.transition_mask",
        "boss.phase_swap",
    ]
    effects = {
        effect_id: {
            "id": effect_id,
            "authority": "visual-only",
            "integerPixelMotion": True,
            "reducedMotion": {"mode": "representative-frame", "gameplayEventsUnchanged": True},
        }
        for effect_id in effect_ids
    }
    return {
        "schemaVersion": "3.0.0",
        "description": "Visual subscribers only; no effect can emit or gate a gameplay event.",
        "effects": effects,
    }


def build_gameplay_visual_archetypes() -> dict[str, Any]:
    micro = list(CORE_ROWS[0].frame_ids)
    medium = list(CORE_ROWS[1].frame_ids)
    heavy = list(CORE_ROWS[2].frame_ids)
    enemy_frames = list(CORE_ROWS[5].frame_ids) + list(CORE_ROWS[6].frame_ids)
    rooms = ["INFORMATION", "FORCED_CHOICE", "IN_BETWEEN", "POLARIZED"]

    projectiles: dict[str, Any] = {}
    for family, frames, logical_size, speed_range, radius in (
        ("micro", micro, 16, [110, 280], 2.0),
        ("medium", medium, 32, [70, 210], 4.0),
        ("heavy", heavy, 64, [28, 120], 8.0),
    ):
        for index, frame_id in enumerate(frames):
            collision_type = "circle"
            if family == "medium" and index in {0, 5, 6}:
                collision_type = "capsule"
            elif family == "heavy":
                collision_type = "oriented-box"
            projectiles[frame_id] = {
                "id": frame_id,
                "frame": frame_id,
                "family": family,
                "logicalSize": logical_size,
                "collision": {
                    "type": collision_type,
                    "radiusLogicalPx": radius,
                    "authority": "gameplay-timeline",
                    "visualAlphaIgnored": True,
                },
                "speedRangeLogicalPxPerSec": speed_range,
                "rotatesToVelocity": not (family == "heavy" and index in {0, 5, 6, 7}),
                "poolClass": f"enemy-projectile-{family}",
                "cancelClip": "bullet.cancel",
                "residueFrame": "utility.residue.patch",
                "difficultyScaling": "count-and-gap-only; never color-only",
            }

    enemy_archetypes: dict[str, Any] = {}
    for index, frame_id in enumerate(enemy_frames):
        large = index >= 8
        room = rooms[(index // 2) % len(rooms)]
        bullet_frame = micro[index % len(micro)] if not large else medium[index % len(medium)]
        enemy_archetypes[frame_id] = {
            "id": frame_id,
            "frame": frame_id,
            "roomAffinity": room,
            "logicalSize": 64 if large else 32,
            "collision": {"type": "circle", "radiusLogicalPx": 13 if large else 7, "damageTarget": True},
            "emitterAnchor": [0.62 if index % 2 == 0 else 0.38, 0.68],
            "forceDirection": "away-from-emitter",
            "proceduralMotions": ["enemy.hover", "enemy.recoil"],
            "defaultProjectile": bullet_frame,
            "terminalClip": "enemy.causality.damage_to_trace",
            "drops": ["pickup.score.open_bit", "pickup.power.fork"] if index % 3 else ["pickup.memory.node"],
        }

    patterns = {
        "information.packet_retry": {
            "room": "INFORMATION",
            "verbs": ["emit", "drop-slot", "pause", "retry-offset"],
            "projectileFamilies": ["micro", "medium"],
            "readabilityRule": "the missing slot persists for the whole retry group",
        },
        "information.stale_route": {
            "room": "INFORMATION",
            "verbs": ["trace-old-path", "hold", "reroute"],
            "projectileFamilies": ["micro"],
            "readabilityRule": "afterimage is visual-only and never collidable",
        },
        "forced_choice.twin_governors": {
            "room": "FORCED_CHOICE",
            "verbs": ["clone-seed", "apply-left-rule", "apply-right-rule"],
            "projectileFamilies": ["medium"],
            "readabilityRule": "same seed; different gaps; seam remains active",
        },
        "forced_choice.seam_denial": {
            "room": "FORCED_CHOICE",
            "verbs": ["open-seam", "warn", "close-from-both-sides"],
            "projectileFamilies": ["heavy"],
            "readabilityRule": "never imply that center is a permanent safe lane",
        },
        "in_between.dual_clock": {
            "room": "IN_BETWEEN",
            "verbs": ["emit-a", "delay", "emit-b", "intersect"],
            "projectileFamilies": ["micro", "medium"],
            "readabilityRule": "A and B poses are quantized separately",
        },
        "in_between.stable_intersection": {
            "room": "IN_BETWEEN",
            "verbs": ["sample-a", "sample-b", "collide-only-at-intersection"],
            "projectileFamilies": ["medium"],
            "readabilityRule": "visual jitter cannot move the gameplay intersection",
        },
        "polarized.binary_wall": {
            "room": "POLARIZED",
            "verbs": ["telegraph", "switch-on", "hold", "switch-off"],
            "projectileFamilies": ["heavy"],
            "readabilityRule": "hard states only; no opacity tween",
        },
        "polarized.no_dusk": {
            "room": "POLARIZED",
            "verbs": ["mirror", "commit", "scar-break"],
            "projectileFamilies": ["micro", "heavy"],
            "readabilityRule": "only the persisted player scar may break bilateral symmetry",
        },
        "global.aimed_notch": {
            "room": "ANY",
            "verbs": ["sample-player", "lock-direction", "emit"],
            "projectileFamilies": ["micro"],
            "readabilityRule": "directional void notch faces velocity",
        },
        "global.delayed_fan": {
            "room": "ANY",
            "verbs": ["telegraph-gap", "fan", "hold-center-empty"],
            "projectileFamilies": ["micro", "medium"],
            "readabilityRule": "danger increases by density and closure, not hue",
        },
        "global.memory_echo": {
            "room": "ANY",
            "verbs": ["read-path", "delay", "emit-from-history"],
            "projectileFamilies": ["micro"],
            "readabilityRule": "historical trace remains non-collidable until explicit emit",
        },
        "boss.override_scar": {
            "room": "ANY",
            "verbs": ["charge", "tear", "local-void", "collision-off", "scar-write", "sediment"],
            "projectileFamilies": ["medium", "heavy"],
            "readabilityRule": "collision-off is gameplay-authoritative and precedes magenta write",
        },
    }

    return {
        "schemaVersion": "3.0.0",
        "description": "Production bindings from visual semantics to a traditional vertical STG. Values are starting contracts, not hidden art meaning.",
        "playerRig": {
            "id": "player.self",
            "logicalSize": 32,
            "nodes": {
                "core": {"frame": "player.core.idle", "anchor": [0.5, 0.5], "pivot": [0.5, 0.5]},
                "optionLeft": {"frame": "player.option.left", "anchor": [0.22, 0.56], "pivot": [0.5, 0.5]},
                "optionRight": {"frame": "player.option.right", "anchor": [0.78, 0.56], "pivot": [0.5, 0.5]},
                "hitbox": {"frame": "player.hitbox.offset_core", "anchor": [0.52, 0.58], "pivot": [0.5, 0.5], "visibleWhen": "focus-or-debug"},
            },
            "states": {
                "idle": {"coreFrame": "player.core.idle", "optionOffset": [0, 0]},
                "moveLeft": {"integerOffset": [-1, 0], "optionOffset": [-1, 1], "bank": "shell-only-left"},
                "moveRight": {"integerOffset": [1, 0], "optionOffset": [1, 1], "bank": "shell-only-right"},
                "focus": {"clip": "player.focus", "hitboxRadiusLogicalPx": 2.0},
                "fireTap": {"muzzleFrame": "player.shot.tap"},
                "fireHold": {"muzzleFrame": "player.shot.hold"},
                "override": {"clip": "system.override.directional"},
                "hit": {"clip": "player.causality.damage_to_trace"},
                "respawn": {"clip": "player.return_with_history"},
            },
            "collision": {"type": "circle", "anchor": [0.52, 0.58], "radiusLogicalPx": 3.0, "focusRadiusLogicalPx": 2.0},
            "shotHardpoints": [{"id": "left", "anchor": [0.38, 0.34]}, {"id": "right", "anchor": [0.62, 0.34]}],
        },
        "projectiles": projectiles,
        "enemies": enemy_archetypes,
        "patternTemplates": patterns,
        "poolBudgets": {
            "enemy-projectile-micro": 1400,
            "enemy-projectile-medium": 480,
            "enemy-projectile-heavy": 96,
            "enemy": 96,
            "pickup": 160,
            "visual-residue": 320,
        },
    }


def build_overview(board_manifests: list[dict[str, Any]]) -> None:
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    thumb = 512
    gutter = 48
    canvas = Image.new("RGB", (thumb * 2 + gutter * 3, thumb * 2 + gutter * 3), PALETTE_RGB["SYSTEM_INK"])
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default()
    for index, board in enumerate(board_manifests):
        atlas = Image.open(ART_DIR / board["file"]).convert("RGBA")
        composite = Image.new("RGBA", atlas.size, (*PALETTE_RGB["SYSTEM_INK"], 255))
        composite.alpha_composite(atlas)
        image = composite.convert("RGB").resize((thumb, thumb), Image.Resampling.NEAREST)
        col = index % 2
        row_index = index // 2
        x = gutter + col * (thumb + gutter)
        y = gutter + row_index * (thumb + gutter)
        canvas.paste(image, (x, y))
        draw.text((x, y - 18), board["atlasId"], fill=PALETTE_RGB["SELF_PAPER"], font=font)
    canvas.save(PREVIEW_DIR / "00-atlas-overview-v3.png", format="PNG", optimize=False, compress_level=9)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    board_manifests: list[dict[str, Any]] = []
    frames: list[dict[str, Any]] = []
    clips: list[dict[str, Any]] = []

    for board in BOARD_SPECS:
        board_manifest, board_frames, board_clips = build_board(board)
        board_manifests.append(board_manifest)
        frames.extend(board_frames)
        clips.extend(board_clips)

    frame_index = {
        "schemaVersion": "3.0.0",
        "contract": "../visual-contract-v3.json",
        "palette": PALETTE,
        "atlasSize": [ATLAS_SIZE, ATLAS_SIZE],
        "cell": [CELL, CELL],
        "atlases": board_manifests,
        "frames": frames,
    }
    semantics = {
        "schemaVersion": "3.0.0",
        "principle": "A semantic ID names an action or gameplay role, never a decorative icon.",
        "palette": PALETTE,
        "clips": clips,
        "bossRigs": [clip["clipId"] for clip in clips if clip["clipId"].startswith("boss.") and clip["clipId"].endswith(".rig")],
        "causalChains": {
            "override": ["charge", "directional_tear", "local_void", "collision_off", "scar_write", "material_sediment"],
            "deletion": ["digital_delete", "collision_removed", "material_residue"],
            "respawn": ["read_previous_scar", "collision_restored"],
            "laser": ["telegraph_on", "charge_commit", "collision_live", "collision_removed", "residue_created"],
            "crossRun": ["snapshot_serialized", "next_run_seeded", "scar_restored"],
        },
        "runtimeRules": {
            "filtering": "NearestFilter",
            "colorSpace": "SRGBColorSpace",
            "premultiplyAlpha": False,
            "pixelSnap": True,
            "collisionAuthority": "gameplay timeline; visual frame is never authoritative",
            "eventDispatch": "dispatch all crossed events exactly once, including reduced motion and dropped frames",
        },
    }

    animation = build_animation_manifest(board_manifests)
    rigs = build_boss_rigs()
    lasers = build_laser_modules()
    effects = build_runtime_effects()
    gameplay_visual_archetypes = build_gameplay_visual_archetypes()
    asset_manifest = {
        "schemaVersion": "3.0.0",
        "description": "Production runtime atlases. Background and UI entries are merged by the final packaging step.",
        "atlases": atlas_specs(board_manifests),
        "backgrounds": [],
        "gameplayVisualArchetypes": "manifests/v3/gameplay-visual-archetypes.json",
        "statistics": {
            "atlasFiles": len(board_manifests),
            "atlasAliases": 2,
            "semanticFrames": len(frames),
            "projectileArchetypes": 24,
            "enemyArchetypes": 16,
            "danmakuPatternTemplates": 12,
        },
    }
    palette_manifest = {
        "schemaVersion": "3.0.0",
        "colors": PALETTE,
        "rules": {
            "alphaValues": [0, 255],
            "maximumVisibleColorsPerOrdinaryCell": 4,
            "polarizedAllowsGray": False,
            "overrideMagentaUse": "scar-write-only",
        },
    }
    qa_config = {
        "schemaVersion": "3.0.0",
        "palette": {"targetColors": list(PALETTE.values()), "maxColorsPerCell": 4, "channelTolerance": 0},
        "pivotDriftTolerance": 0.02,
        "monotonicAreaTolerance": 0.03,
        "contrast": {"minimumMedianContrastRatio": 3.0, "minimumPassingProjectileFraction": 0.9},
    }

    write_json(MANIFEST_DIR / "frame-index-v3.json", frame_index)
    write_json(MANIFEST_DIR / "asset-semantics-v3.json", semantics)
    write_json(MANIFEST_DIR / "animation-clips.json", animation)
    write_json(MANIFEST_DIR / "asset-manifest-v3.json", asset_manifest)
    write_json(MANIFEST_DIR / "boss-rigs.json", rigs)
    write_json(MANIFEST_DIR / "laser-modules.json", lasers)
    write_json(MANIFEST_DIR / "runtime-effects.json", effects)
    write_json(MANIFEST_DIR / "gameplay-visual-archetypes.json", gameplay_visual_archetypes)
    write_json(MANIFEST_DIR / "palette.json", palette_manifest)
    write_json(MANIFEST_DIR / "qa-config.json", qa_config)
    build_overview(board_manifests)

    print(f"Built {len(board_manifests)} atlases, {len(frames)} semantic frames and {len(clips)} clips/rig rows.")


if __name__ == "__main__":
    main()
