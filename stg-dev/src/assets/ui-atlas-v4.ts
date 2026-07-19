import uiAtlasUrl from "../../../1bit-stg-complete-asset-kit-v4/ui/atlas/ui-atlas.png?url";
import {v4UnmanifestedChecksum} from "./kit-checksums-v4";
import type {V4RuntimeAsset} from "./v4-runtime-asset";

/**
 * The UI atlas PNG (`ui/atlas/ui-atlas.png`) is live V4 content: 512x512, an
 * 8x8 grid of 64x64 cells, nearest sampling, binary alpha, no premultiply.
 *
 * The kit ships no V4 JSON cell map for it. Its only authored coordinate table
 * lives at `legacy-v3/manifests/ui-atlas.json`, which is a manifest, not legacy
 * art — the PNG it describes is the shipped V4 file. That table is copied here
 * as data (rather than imported) so no legacy-v3 module enters the runtime
 * graph. The copy is stored in its authored row-major order and expanded into
 * rects by the grid contract; `ui-atlas-v4.test.ts` re-reads the v3 table from
 * disk and fails if a single id, category, tint flag or rect ever drifts.
 */
const UI_ATLAS_GRID = Object.freeze({columns: 8, rows: 8, cell: 64} as const);
const UI_ATLAS_SIZE = Object.freeze([512, 512] as const);
const UI_ATLAS_SOURCE_PATH = "ui/atlas/ui-atlas.png";

export type V4UiCellCategory =
  | "frame"
  | "meter"
  | "behavior"
  | "room_state"
  | "control"
  | "navigation"
  | "fingerprint"
  | "memory";

interface UiAtlasRow {
  readonly category: V4UiCellCategory;
  readonly roomTintable: boolean;
  readonly ids: readonly string[];
}

/** Copied verbatim from legacy-v3/manifests/ui-atlas.json, row-major. */
const UI_ATLAS_ROWS: readonly UiAtlasRow[] = Object.freeze([
  Object.freeze({
    category: "frame",
    roomTintable: true,
    ids: Object.freeze([
      "frame_corner_nw",
      "frame_corner_ne",
      "frame_corner_sw",
      "frame_corner_se",
      "open_panel_left",
      "open_panel_right",
      "seam_vertical",
      "seam_horizontal",
    ]),
  }),
  Object.freeze({
    category: "meter",
    roomTintable: true,
    ids: Object.freeze([
      "bar_empty",
      "bar_25",
      "bar_50",
      "bar_75",
      "bar_full",
      "phase_tick",
      "threshold_marker",
      "void_gap",
    ]),
  }),
  Object.freeze({
    category: "behavior",
    roomTintable: false,
    ids: Object.freeze([
      "behavior_signal",
      "behavior_focus",
      "behavior_gaze",
      "behavior_override",
      "behavior_scar",
      "behavior_ghost",
      "behavior_witness",
      "behavior_snapshot",
    ]),
  }),
  Object.freeze({
    category: "room_state",
    roomTintable: false,
    ids: Object.freeze([
      "room_info",
      "room_forced",
      "room_between",
      "room_polar",
      "state_free",
      "state_suppressed",
      "state_void",
      "state_residue",
    ]),
  }),
  Object.freeze({
    category: "control",
    roomTintable: true,
    ids: Object.freeze([
      "control_up",
      "control_down",
      "control_left",
      "control_right",
      "control_z",
      "control_shift",
      "control_x",
      "control_confirm",
    ]),
  }),
  Object.freeze({
    category: "navigation",
    roomTintable: true,
    ids: Object.freeze([
      "divider_solid",
      "divider_broken",
      "chevron",
      "cursor",
      "toggle_off",
      "toggle_on",
      "slider_knob",
      "scroll_marker",
    ]),
  }),
  Object.freeze({
    category: "fingerprint",
    roomTintable: false,
    ids: Object.freeze([
      "fingerprint_sparse",
      "fingerprint_banded",
      "fingerprint_seam",
      "fingerprint_resist",
      "fingerprint_focus",
      "fingerprint_gaze",
      "fingerprint_ghost",
      "fingerprint_mixed",
    ]),
  }),
  Object.freeze({
    category: "memory",
    roomTintable: false,
    ids: Object.freeze([
      "scar_1",
      "scar_2",
      "scar_3",
      "ghost_dot",
      "ghost_segment",
      "witness_pair",
      "memory_aperture",
      "run_bridge",
    ]),
  }),
] as const);

export interface V4UiCell {
  readonly id: string;
  readonly category: V4UiCellCategory;
  readonly roomTintable: boolean;
  /** Every UI cell is authored with binary alpha; no soft edges exist. */
  readonly alphaMode: "binary";
  readonly row: number;
  readonly column: number;
  readonly index: number;
  /** [x, y, width, height] in top-left-origin atlas pixels. */
  readonly rect: readonly [number, number, number, number];
  readonly pivot: readonly [number, number];
}

function buildUiCells(): Readonly<Record<string, Readonly<V4UiCell>>> {
  const cells: Record<string, Readonly<V4UiCell>> = {};
  if (UI_ATLAS_ROWS.length !== UI_ATLAS_GRID.rows) {
    throw new Error("V4 UI atlas row count drifted from its grid contract");
  }
  UI_ATLAS_ROWS.forEach((definition, row) => {
    if (definition.ids.length !== UI_ATLAS_GRID.columns) {
      throw new Error(`V4 UI atlas row ${definition.category} drifted from its grid contract`);
    }
    definition.ids.forEach((id, column) => {
      if (id.length === 0 || id.trim() !== id) {
        throw new Error(`V4 UI atlas contains an invalid cell id at ${row}:${column}`);
      }
      if (Object.hasOwn(cells, id)) {
        throw new Error(`V4 UI atlas contains duplicate cell id ${id}`);
      }
      cells[id] = Object.freeze({
        id,
        category: definition.category,
        roomTintable: definition.roomTintable,
        alphaMode: "binary",
        row,
        column,
        index: row * UI_ATLAS_GRID.columns + column,
        rect: Object.freeze([
          column * UI_ATLAS_GRID.cell,
          row * UI_ATLAS_GRID.cell,
          UI_ATLAS_GRID.cell,
          UI_ATLAS_GRID.cell,
        ] as const),
        pivot: Object.freeze([0.5, 0.5] as const),
      });
    });
  });
  const expected = UI_ATLAS_GRID.rows * UI_ATLAS_GRID.columns;
  if (Object.keys(cells).length !== expected) {
    throw new Error(`V4 UI atlas requires exactly ${expected} cells`);
  }
  if (
    UI_ATLAS_SIZE[0] !== UI_ATLAS_GRID.columns * UI_ATLAS_GRID.cell
    || UI_ATLAS_SIZE[1] !== UI_ATLAS_GRID.rows * UI_ATLAS_GRID.cell
  ) {
    throw new Error("V4 UI atlas size drifted from its grid contract");
  }
  return Object.freeze(cells);
}

const uiAtlasAsset: Readonly<V4RuntimeAsset> = Object.freeze({
  id: "ui-atlas",
  sourcePath: UI_ATLAS_SOURCE_PATH,
  sha256: v4UnmanifestedChecksum(UI_ATLAS_SOURCE_PATH),
  url: uiAtlasUrl,
  size: UI_ATLAS_SIZE,
});

export const V4_UI_ATLAS = Object.freeze({
  atlas: uiAtlasAsset,
  grid: UI_ATLAS_GRID,
  sampling: "nearest",
  premultiplyAlpha: false,
  cells: buildUiCells(),
} as const);

export function v4UiCell(id: string): Readonly<V4UiCell> {
  const cell = V4_UI_ATLAS.cells[id];
  if (cell === undefined) throw new Error(`V4 UI atlas has no cell ${id}`);
  return cell;
}

export function v4UiCellOrNull(id: string): Readonly<V4UiCell> | null {
  return V4_UI_ATLAS.cells[id] ?? null;
}
