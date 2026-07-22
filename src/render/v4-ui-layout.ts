/**
 * v4 engine-owned UI atlas contract.
 *
 * Source rectangles and logical display sizes live together so the headless
 * generator and the browser renderer cannot silently disagree.  These pixels
 * are presentation only: the atlas never enters `src/game` or the simulation.
 * All sizes are authored for the fixed 480×640 play field.
 */

export const V4_UI_ATLAS_WIDTH = 1024;
// The lowest named cell ends at y=240. Keep one 16px packing gutter while
// dropping 256 rows of permanent transparency from the former 512px sheet.
export const V4_UI_ATLAS_HEIGHT = 256;

export interface V4UiCell {
  readonly x: number;
  readonly y: number;
  readonly frameW: number;
  readonly frameH: number;
  readonly frames: number;
  /** Exact default size in the 480×640 logical overlay. */
  readonly displayW: number;
  readonly displayH: number;
}

function cell(
  x: number,
  y: number,
  frameW: number,
  frameH: number,
  displayW = frameW,
  displayH = frameH,
  frames = 1,
): V4UiCell {
  return { x, y, frameW, frameH, frames, displayW, displayH };
}

/**
 * One atlas, one visual grammar: cold mycelium linework, a living heart and a
 * restrained identity colour.  The 48px panel tile is the only scalable entry;
 * it is consumed as a 12px-corner nine-slice and therefore never stretches its
 * thorns or corners.
 */
export const V4_UI_CELLS = {
  'ui.logo': cell(0, 0, 320, 72),
  'ui.panel.9slice': cell(320, 0, 48, 48),
  'ui.cursor': cell(368, 0, 24, 24),
  'ui.divider': cell(392, 0, 320, 12),
  'ui.focus.ring': cell(712, 0, 32, 32),
  'ui.graze.arc': cell(744, 0, 32, 32, 32, 32, 4),

  'ui.hud.score': cell(872, 0, 16, 16),
  'ui.hud.graze': cell(888, 0, 16, 16),
  'ui.hud.life': cell(904, 0, 16, 16),
  'ui.hud.bomb': cell(920, 0, 16, 16),
  'ui.hud.power': cell(936, 0, 16, 16),

  'ui.crest.scout': cell(0, 80, 48, 48),
  'ui.crest.lance': cell(48, 80, 48, 48),
  'ui.crest.hound': cell(96, 80, 48, 48),
  'ui.crest.spire': cell(144, 80, 48, 48),
  'ui.crest.maw': cell(192, 80, 48, 48),

  'ui.difficulty.easy': cell(240, 80, 48, 48),
  'ui.difficulty.normal': cell(288, 80, 48, 48),
  'ui.difficulty.hard': cell(336, 80, 48, 48),
  'ui.difficulty.lunatic': cell(384, 80, 48, 48),

  'ui.status.pause': cell(432, 80, 56, 56),
  'ui.status.clear': cell(488, 80, 56, 56),
  'ui.status.gameover': cell(544, 80, 56, 56),
  'ui.status.ending': cell(600, 80, 56, 56),
  'ui.status.result': cell(656, 80, 56, 56),

  'ui.boss.frame': cell(0, 144, 420, 16),
  'ui.boss.fill.normal': cell(0, 160, 360, 8),
  'ui.boss.fill.spell': cell(0, 168, 360, 8),
  'ui.boss.timer': cell(0, 176, 360, 4),

  'ui.nameplate': cell(0, 192, 248, 28),
  'ui.prompt': cell(248, 192, 112, 24),
  'ui.assist.seal': cell(360, 192, 48, 48),
} as const satisfies Readonly<Record<string, V4UiCell>>;

export type V4UiCellName = keyof typeof V4_UI_CELLS;

export const V4_UI_PANEL_CORNER = 12;

/** Fixed screen compositions, also in 480×640 logical pixels. */
export const V4_UI_SCREEN = {
  menu: { x: 54, y: 116, w: 372, h: 458 },
  character: { x: 24, y: 30, w: 432, h: 574 },
  status: { x: 72, y: 112, w: 336, h: 416 },
  dialogue: { x: 12, y: 510, w: 456, h: 118 },
} as const;

/** Five playable identities, shared by crests, menus and dialogue accents. */
export const V4_CHARACTER_UI = {
  scout: { crest: 'ui.crest.scout', colour: '#8CEBFF', rgb: [140, 235, 255] },
  lance: { crest: 'ui.crest.lance', colour: '#FF91BD', rgb: [255, 145, 189] },
  hound: { crest: 'ui.crest.hound', colour: '#70DFA2', rgb: [112, 223, 162] },
  spire: { crest: 'ui.crest.spire', colour: '#B58CFF', rgb: [181, 140, 255] },
  maw: { crest: 'ui.crest.maw', colour: '#FF795C', rgb: [255, 121, 92] },
} as const satisfies Readonly<
  Record<string, { readonly crest: V4UiCellName; readonly colour: string; readonly rgb: readonly [number, number, number] }>
>;

export const V4_DIFFICULTY_UI = {
  EASY: 'ui.difficulty.easy',
  NORMAL: 'ui.difficulty.normal',
  HARD: 'ui.difficulty.hard',
  LUNATIC: 'ui.difficulty.lunatic',
} as const satisfies Readonly<Record<string, V4UiCellName>>;
