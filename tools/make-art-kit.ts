/**
 * Generate an ART KIT — paintable templates for every hand-authored surface.
 *
 *     bun run art:kit            # emits ./art-kit
 *     bun tools/make-art-kit.ts  packs/mine/kit   # or any directory
 *
 * ## What this is for
 *
 * `docs/assets.md` is the binding spec; `packs/example/` is a finished pack an
 * author copies. This kit sits between them: it hands the artist a file to paint
 * *on top of* for every surface the game does not generate procedurally — the
 * bullet sheet, the ship, the dialogue portraits and the HUD icons — with the
 * grid, the safe-area margin, the cell names, the current placeholder art (as a
 * low-alpha "ghost") and the +x arrows drawn INTO the pixels as a reference
 * layer. The artist paints a fresh layer over the ghost in their own tool and
 * exports it clean; the template itself is never shipped.
 *
 * ## Every number here is read from the engine, not copied
 *
 * The whole point of a kit is that it cannot drift from what the loader expects.
 * So the grid, the cell names and order, the painted-extent budget, the ship and
 * portrait sizes, and the dialogue speaker list are all IMPORTED from
 * `src/render/procedural.ts` and `src/render/portrait.ts` (tools are not bound by
 * the sim import rule; `make-example-pack.ts` imports the same way). The one
 * place this file restates an engine fact — which cells are directional, and the
 * ghost's shape parameters — it re-derives the painted extent from those
 * parameters and ASSERTS it against the engine's own `CELL_ART`, so a copy that
 * drifts throws at generation time rather than shipping a wrong template.
 *
 * ## Why a hand-rolled buffer and font
 *
 * `tools/png.ts` is a pixel sampler with no text or compositing, and the
 * procedural painters need a DOM canvas `bun` does not have. So this file
 * composites into its own straight-alpha RGBA buffer with a tiny 3×5 bitmap font
 * and re-implements the placeholder shapes as headless samplers, then hands the
 * finished buffer to `encodePng`. Every emitted PNG is re-read through `parsePng`
 * (never the encoder's own state) and checked for the exact dimensions and an
 * alpha channel before it is trusted — the same discipline `make-example-pack.ts`
 * uses.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  BULLET_GRID,
  BULLET_COLUMNS,
  BULLET_ROWS,
  BULLET_CELLS,
  MAX_CELL_EXTENT,
  CELL_ART,
  SHIP_SIZE,
  SHIP_CELLS,
} from '../src/render/procedural';
import { PORTRAIT_SIZE, portraitNames, tintFor } from '../src/render/portrait';
import { ColourType, encodePng, parsePng, type PngHeader } from './png';

/* ================================================================== */
/* A straight-alpha RGBA image buffer, with source-over compositing.   */
/* ================================================================== */

interface Img {
  readonly w: number;
  readonly h: number;
  readonly buf: Uint8Array; // RGBA, straight alpha, 0..255
}

function image(w: number, h: number): Img {
  return { w, h, buf: new Uint8Array(w * h * 4) };
}

type RGB = readonly [number, number, number];

/** Source-over one pixel: `col` in 0..255, `a` in 0..1. */
function over(img: Img, x: number, y: number, col: RGB, a: number): void {
  if (a <= 0 || x < 0 || y < 0 || x >= img.w || y >= img.h) return;
  const i = (y * img.w + x) * 4;
  const da = img.buf[i + 3]! / 255;
  const oa = a + da * (1 - a);
  if (oa <= 0) return;
  for (let c = 0; c < 3; c++) {
    img.buf[i + c] = Math.round((col[c]! * a + img.buf[i + c]! * da * (1 - a)) / oa);
  }
  img.buf[i + 3] = Math.round(oa * 255);
}

/** Fill an axis-aligned block (used by the bitmap font and the guide lines). */
function block(img: Img, x: number, y: number, w: number, h: number, col: RGB, a: number): void {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) over(img, xx, yy, col, a);
}

/** The perimeter band of a rectangle, `t` px thick, drawn inward. */
function frame(img: Img, x: number, y: number, w: number, h: number, t: number, col: RGB, a: number): void {
  block(img, x, y, w, t, col, a); // top
  block(img, x, y + h - t, w, t, col, a); // bottom
  block(img, x, y, t, h, col, a); // left
  block(img, x + w - t, y, t, h, col, a); // right
}

/** Encode an `Img` to PNG bytes (always RGBA — the alpha channel is required). */
function encode(img: Img): Uint8Array {
  return encodePng(img.w, img.h, ColourType.RGBA, (x, y) => {
    const i = (y * img.w + x) * 4;
    return [img.buf[i]!, img.buf[i + 1]!, img.buf[i + 2]!, img.buf[i + 3]!];
  });
}

/* ================================================================== */
/* A 3×5 bitmap font — the only way to letter a name into the pixels.  */
/* ================================================================== */

const FONT: Record<string, readonly string[]> = {
  A: [' # ', '# #', '###', '# #', '# #'],
  B: ['## ', '# #', '## ', '# #', '## '],
  C: [' ##', '#  ', '#  ', '#  ', ' ##'],
  D: ['## ', '# #', '# #', '# #', '## '],
  E: ['###', '#  ', '## ', '#  ', '###'],
  F: ['###', '#  ', '## ', '#  ', '#  '],
  G: [' ##', '#  ', '# #', '# #', ' ##'],
  H: ['# #', '# #', '###', '# #', '# #'],
  I: ['###', ' # ', ' # ', ' # ', '###'],
  J: ['  #', '  #', '  #', '# #', ' # '],
  K: ['# #', '# #', '## ', '# #', '# #'],
  L: ['#  ', '#  ', '#  ', '#  ', '###'],
  M: ['# #', '###', '###', '# #', '# #'],
  N: ['# #', '## ', '###', ' ##', '# #'],
  O: ['###', '# #', '# #', '# #', '###'],
  P: ['## ', '# #', '## ', '#  ', '#  '],
  Q: ['###', '# #', '# #', '## ', ' ##'],
  R: ['## ', '# #', '## ', '# #', '# #'],
  S: [' ##', '#  ', ' # ', '  #', '## '],
  T: ['###', ' # ', ' # ', ' # ', ' # '],
  U: ['# #', '# #', '# #', '# #', '###'],
  V: ['# #', '# #', '# #', '# #', ' # '],
  W: ['# #', '# #', '###', '###', '# #'],
  X: ['# #', '# #', ' # ', '# #', '# #'],
  Y: ['# #', '# #', ' # ', ' # ', ' # '],
  Z: ['###', '  #', ' # ', '#  ', '###'],
  '0': ['###', '# #', '# #', '# #', '###'],
  '1': [' # ', '## ', ' # ', ' # ', '###'],
  '2': ['###', '  #', '###', '#  ', '###'],
  '3': ['###', '  #', '###', '  #', '###'],
  '4': ['# #', '# #', '###', '  #', '  #'],
  '5': ['###', '#  ', '###', '  #', '###'],
  '6': ['###', '#  ', '###', '# #', '###'],
  '7': ['###', '  #', '  #', '  #', '  #'],
  '8': ['###', '# #', '###', '# #', '###'],
  '9': ['###', '# #', '###', '  #', '###'],
  '.': ['   ', '   ', '   ', '   ', ' # '],
  '-': ['   ', '   ', '###', '   ', '   '],
  '+': ['   ', ' # ', '###', ' # ', '   '],
  ' ': ['   ', '   ', '   ', '   ', '   '],
};

/** Draw a string at (x,y), each source pixel a `px`×`px` block. Returns width. */
function text(img: Img, s: string, x: number, y: number, px: number, col: RGB, a: number): number {
  let cx = x;
  for (const raw of s.toUpperCase()) {
    const g = FONT[raw] ?? FONT[' ']!;
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
      if (g[r]![c] === '#') block(img, cx + c * px, y + r * px, px, px, col, a);
    }
    cx += (3 + 1) * px;
  }
  return cx - x;
}

function textWidth(s: string, px: number): number {
  return s.length * (3 + 1) * px;
}

/* ================================================================== */
/* The palette that marks a pixel as a GUIDE, never as art.            */
/* ================================================================== */

const GUIDE_EDGE: RGB = [255, 60, 200]; // magenta — the cell boundary
const GUIDE_SAFE: RGB = [60, 220, 255]; // cyan — the 28px safe-area edge
const LABEL_COL: RGB = [255, 235, 120]; // amber — the cell / region name
const ARROW_COL: RGB = [120, 255, 160]; // green — the +x heading arrow
const HITBOX_COL: RGB = [255, 150, 60]; // orange — "put the hitbox marker here"

/**
 * The ghost of the white-art surfaces (bullets, ship, HUD) is drawn in a cool
 * neutral grey, NOT white: it is a reference layer to paint over, and a white
 * ghost vanishes against a light editor background. The grey reads on both a
 * light canvas and a dark checkerboard. The art you paint is still white — see
 * the guide; the ghost's colour is not the art's.
 */
const GHOST_COL: RGB = [120, 125, 135];

/* ================================================================== */
/* Ghost samplers — the placeholder shapes, re-implemented headless.   */
/*                                                                     */
/* These mirror `src/render/procedural.ts`'s painters. The parameters   */
/* live in GHOST below; the painted extent they imply is asserted        */
/* against the engine's own CELL_ART, so a drift throws (see checkGhost).*/
/* ================================================================== */

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** The four-stop radial body: 1.0 core → 0.95 at coreRatio → 0.35 at 0.82 → 0. */
function orbA(dx: number, dy: number, radius: number, core: number): number {
  const d = Math.hypot(dx, dy);
  if (d >= radius) return 0;
  const t = d / radius;
  if (t <= core) return lerp(1, 0.95, core === 0 ? 0 : t / core);
  if (t <= 0.82) return lerp(0.95, 0.35, (t - core) / (0.82 - core));
  return lerp(0.35, 0, (t - 0.82) / (1 - 0.82));
}

/** Hollow ring: a bright inner stroke and a faint doubled outer one (§1.2). */
function ringA(dx: number, dy: number, radius: number, thick: number): number {
  const dd = Math.abs(Math.hypot(dx, dy) - (radius - thick / 2));
  if (dd <= thick / 2) return 0.95;
  if (dd <= thick) return 0.3;
  return 0;
}

/** Quadratic-Bézier lens along +x — apex reaches half the control width (§3.1). */
function bladeA(dx: number, dy: number, len: number, wide: number): number {
  if (Math.abs(dx) > len / 2) return 0;
  const t = (1 - (2 * dx) / len) / 2; // 1 at the tail (-x), 0 at the tip (+x)
  const half = Math.abs(2 * (1 - t) * t * (wide / 2));
  return Math.abs(dy) <= half ? 0.95 : 0;
}

/** Diamond with real vertices — exactly its stated size. */
function shardA(dx: number, dy: number, len: number, wide: number): number {
  return Math.abs(dx) / (len / 2) + Math.abs(dy) / (wide / 2) <= 1 ? 0.9 : 0;
}

/** Hard star, angular interpolation between the outer radius and 0.42 of it. */
function starA(dx: number, dy: number, radius: number, points: number): number {
  const r = Math.hypot(dx, dy);
  if (r > radius) return 0;
  const inner = radius * 0.42;
  let ang = Math.atan2(dy, dx) + Math.PI / 2; // start at the top, like the painter
  ang = ((ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const seg = ang / (Math.PI / points);
  const i = Math.floor(seg);
  const frac = seg - i;
  const rA = i % 2 === 0 ? radius : inner;
  const rB = (i + 1) % 2 === 0 ? radius : inner;
  return r <= rA + (rB - rA) * frac ? 0.95 : 0;
}

/** Asymmetric leaf: control points at -0.9r (up) and +0.5r (down). */
function petalA(dx: number, dy: number, radius: number): number {
  if (Math.abs(dx) > radius) return 0;
  const t = (1 - dx / radius) / 2;
  const e = 2 * (1 - t) * t;
  return dy >= -0.9 * radius * e && dy <= 0.5 * radius * e ? 0.9 : 0;
}

type GhostFn = (dx: number, dy: number) => number;

interface Ghost {
  readonly fn: GhostFn;
  /** Painted extent this parameterisation implies — asserted against CELL_ART. */
  readonly w: number;
  readonly h: number;
}

const orbG = (radius: number, core = 0.45): Ghost => ({ fn: (x, y) => orbA(x, y, radius, core), w: radius * 2, h: radius * 2 });
const ringG = (radius: number, thick: number): Ghost => ({ fn: (x, y) => ringA(x, y, radius, thick), w: (radius + thick / 2) * 2, h: (radius + thick / 2) * 2 });
const bladeG = (len: number, wide: number): Ghost => ({ fn: (x, y) => bladeA(x, y, len, wide), w: len, h: wide / 2 });
const shardG = (len: number, wide: number): Ghost => ({ fn: (x, y) => shardA(x, y, len, wide), w: len, h: wide });
const starG = (radius: number, points: number): Ghost => ({ fn: (x, y) => starA(x, y, radius, points), w: radius * 2, h: radius * 2 });
const petalG = (radius: number): Ghost => ({ fn: (x, y) => petalA(x, y, radius), w: radius * 2, h: radius * 0.45 + radius * 0.25 });

/** One ghost per cell — parameters copied from `CELL_ART` and checked against it. */
const GHOST: Record<string, Ghost> = {
  'orb.small': orbG(5),
  'orb.medium': orbG(8),
  'orb.large': orbG(13),
  ring: ringG(12, 3),
  kunai: bladeG(26, 9),
  scale: shardG(20, 12),
  star: starG(13, 5),
  shard: shardG(26, 7),
  'glow.small': orbG(7, 0.15),
  'glow.medium': orbG(11, 0.12),
  'glow.large': orbG(14, 0.1),
  halo: ringG(13, 2),
  needle: bladeG(28, 5),
  petal: petalG(11),
  spark: starG(11, 4),
  mote: orbG(3),
};

/**
 * The directional cells — those that must point +x/east (`docs/assets.md` §3.1,
 * the "Must point +x" column). There is no engine constant for this, so it is
 * restated here with its citation; the arrow the kit draws on these cells is the
 * only consumer.
 */
const DIRECTIONAL = new Set(['kunai', 'scale', 'shard', 'needle', 'petal']);

/**
 * Prove the ghost has not drifted from the engine: every cell in `BULLET_CELLS`
 * has a ghost, and the extent the ghost's parameters imply matches CELL_ART's
 * declared painted box. This is the "measure, do not trust the parameter" rule
 * pointed back at the kit itself.
 */
function checkGhost(): void {
  for (const name of BULLET_CELLS) {
    const g = GHOST[name];
    if (!g) throw new Error(`art-kit: no ghost for cell "${name}" — add one to GHOST`);
    const art = CELL_ART[name];
    if (Math.abs(g.w - art.w) > 1e-6 || Math.abs(g.h - art.h) > 1e-6) {
      throw new Error(
        `art-kit: ghost for "${name}" implies ${g.w}×${g.h}px but CELL_ART declares ${art.w}×${art.h} — ` +
          `the ghost drifted from src/render/procedural.ts; fix GHOST to match`,
      );
    }
  }
}

/* ================================================================== */
/* A right-pointing +x arrow, for the directional cells.               */
/* ================================================================== */

function arrowRight(img: Img, cx: number, cy: number, len: number, t: number): void {
  const half = len / 2;
  block(img, Math.round(cx - half), Math.round(cy - t / 2), Math.round(len), Math.max(1, Math.round(t)), ARROW_COL, 0.7);
  const head = Math.max(2, Math.round(len * 0.3));
  for (let i = 0; i < head; i++) {
    const x = Math.round(cx + half - i);
    const spread = Math.round((i / head) * head * 0.9);
    block(img, x, Math.round(cy - spread), 1, Math.max(1, Math.round(t)), ARROW_COL, 0.7);
    block(img, x, Math.round(cy + spread), 1, Math.max(1, Math.round(t)), ARROW_COL, 0.7);
  }
}

/* ================================================================== */
/* Bullet sheet template — exact (S=1) or an 8× painting canvas (S=8).  */
/* ================================================================== */

const GHOST_A = 0.4; // the ghost is a reference, painted over

function bulletSheet(S: number, nameLabels: boolean): Img {
  const { cellW, cellH } = BULLET_GRID;
  const img = image(cellW * BULLET_COLUMNS * S, cellH * BULLET_ROWS * S);
  const t = Math.max(1, S); // guide line thickness
  const margin = 2 * S; // the 2px safe margin, scaled

  BULLET_CELLS.forEach((name, index) => {
    const col = index % BULLET_COLUMNS;
    const row = Math.floor(index / BULLET_COLUMNS);
    const x0 = col * cellW * S;
    const y0 = row * cellH * S;
    const cx = x0 + (cellW * S) / 2;
    const cy = y0 + (cellH * S) / 2;
    const g = GHOST[name]!;

    // Ghost — white, over the whole cell, in logical coordinates.
    for (let py = 0; py < cellH * S; py++) for (let px = 0; px < cellW * S; px++) {
      const a = g.fn((px - (cellW * S) / 2) / S, (py - (cellH * S) / 2) / S);
      if (a > 0) over(img, x0 + px, y0 + py, GHOST_COL, a * GHOST_A);
    }

    // +x arrow on directional cells, before the labels so text stays on top.
    if (DIRECTIONAL.has(name)) arrowRight(img, cx, cy, cellW * S * 0.5, t);

    // Guides — ONLY in the margin: the cell boundary and the 28px safe edge.
    frame(img, x0, y0, cellW * S, cellH * S, t, GUIDE_EDGE, 0.6);
    frame(img, x0 + margin, y0 + margin, cellW * S - margin * 2, cellH * S - margin * 2, t, GUIDE_SAFE, 0.5);

    // Label — the full name where it fits (8×), the index otherwise (exact).
    const label = nameLabels ? name : String(index);
    const avail = cellW * S - margin * 2 - 2 * S;
    let px = nameLabels ? Math.max(1, Math.floor(avail / Math.max(1, textWidth(label, 1)))) : Math.max(1, Math.floor(S / 2));
    while (px > 1 && textWidth(label, px) > avail) px--;
    text(img, label, x0 + margin + S, y0 + margin + S, px, LABEL_COL, 0.9);
  });

  return img;
}

/* ================================================================== */
/* Ship template — one wired 64×64 region ('ship'), points up (-y).    */
/* ================================================================== */

function shipSilhouette(dx: number, dy: number): number {
  // The placeholder kite from createShipAtlas, centred at (0,0): nose up.
  const inTri = (
    px: number, py: number,
    ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
  ): boolean => {
    const s = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) =>
      (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
    const d1 = s(px, py, ax, ay, bx, by);
    const d2 = s(px, py, bx, by, cx, cy);
    const d3 = s(px, py, cx, cy, ax, ay);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  };
  // nose (0,-22), right (16,18), notch (0,9), left (-16,18)
  const body = inTri(dx, dy, 0, -22, 16, 18, 0, 9) || inTri(dx, dy, 0, -22, 0, 9, -16, 18);
  return body ? 0.32 : 0;
}

function shipTemplate(S: number, label: string): Img {
  const size = SHIP_SIZE * S;
  const img = image(size, size);
  const t = Math.max(1, S);
  const c = size / 2;

  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const dx = (px - c) / S;
    const dy = (py - c) / S;
    const a = shipSilhouette(dx, dy);
    if (a > 0) over(img, px, py, GHOST_COL, a);
  }
  // Hitbox marker: the lethal centre, far smaller than the hull. Drawn in the
  // orange guide colour — "mark your hitbox here" — because the ship must show
  // it (docs/assets.md §3.2). Two px below centre, as createShipAtlas places it.
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const dx = (px - c) / S;
    const dy = (py - c) / S - 2;
    if (dx * dx + dy * dy <= 3 * 3) over(img, px, py, HITBOX_COL, 0.75);
  }

  // Guides: border + centre cross + a small "up" arrow (orientation is -y).
  frame(img, 0, 0, size, size, t, GUIDE_EDGE, 0.5);
  block(img, Math.round(c - t / 2), 0, t, size, GUIDE_SAFE, 0.25);
  block(img, 0, Math.round(c - t / 2), size, t, GUIDE_SAFE, 0.25);
  const up = 6 * S;
  block(img, Math.round(c - t / 2), 3 * S, t, up, ARROW_COL, 0.7);
  for (let i = 0; i < Math.round(3 * S); i++) {
    block(img, Math.round(c - i), 3 * S + i, 1, t, ARROW_COL, 0.7);
    block(img, Math.round(c + i), 3 * S + i, 1, t, ARROW_COL, 0.7);
  }

  const px = Math.max(1, Math.floor((size - 8 * S) / Math.max(1, textWidth(label, 1))));
  text(img, label, 3 * S, size - 3 * S - 5 * px, px, LABEL_COL, 0.9);
  return img;
}

/**
 * A single design sheet showing all seven characters side by side. Only the
 * `ship` region above is wired today (every character's `sprite` names it); per
 * character art needs the §3.2 code change and is out of this kit's scope, so
 * this sheet is a reference for that future, not a loadable file.
 */
function shipRoster(chars: readonly Char[]): Img {
  const S = 3;
  const slot = SHIP_SIZE * S;
  const img = image(slot * chars.length, slot);
  chars.forEach((ch, i) => {
    const x0 = i * slot;
    const t = Math.max(1, S);
    const c = slot / 2;
    for (let py = 0; py < slot; py++) for (let px = 0; px < slot; px++) {
      const a = shipSilhouette((px - c) / S, (py - c) / S);
      if (a > 0) over(img, x0 + px, py, GHOST_COL, a);
    }
    frame(img, x0, 0, slot, slot, t, GUIDE_EDGE, 0.5);
    const label = ch.name;
    let px = Math.max(1, Math.floor((slot - 6 * S) / Math.max(1, textWidth(label, 1))));
    while (px > 1 && textWidth(label, px) > slot - 6 * S) px--;
    text(img, label, x0 + 3 * S, slot - 3 * S - 5 * px, px, LABEL_COL, 0.9);
    text(img, `REGION ${ch.sprite}`, x0 + 3 * S, 3 * S, Math.max(1, Math.floor(S / 2)), GUIDE_SAFE, 0.8);
  });
  return img;
}

/* ================================================================== */
/* Portrait template — one exact 96×96 per speaker, tinted silhouette.  */
/* ================================================================== */

function portraitTemplate(name: string, S: number): Img {
  const size = PORTRAIT_SIZE * S;
  const img = image(size, size);
  const t = Math.max(1, S);
  const tint = tintFor(name); // 0..1, from the render-side registry
  const col = (m: number): RGB => [
    Math.round(tint.r * m),
    Math.round(tint.g * m),
    Math.round(tint.b * m),
  ];

  // Panel: a faint dark tinted vertical gradient (paintSilhouette's floor).
  for (let py = 0; py < size; py++) {
    const f = py / size;
    const c = col(lerp(30, 16, f));
    for (let px = 0; px < size; px++) over(img, px, py, c, 0.5);
  }
  // Bust: head arc + shoulders, in logical (96px) coordinates, moderate tint.
  const cx = size / 2;
  const bust = col(150);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const x = px / S;
    const y = py / S;
    const head = (x - PORTRAIT_SIZE / 2) ** 2 + (y - (PORTRAIT_SIZE - 54)) ** 2 <= 18 * 18;
    const shoulders = y >= PORTRAIT_SIZE - 42 && Math.abs(x - PORTRAIT_SIZE / 2) <= 12 + (y - (PORTRAIT_SIZE - 42)) * 0.7;
    if (head || shoulders) over(img, px, py, bust, 0.45);
  }

  frame(img, 0, 0, size, size, t, GUIDE_EDGE, 0.6);
  const px = Math.max(1, Math.floor((size - 6 * S) / Math.max(1, textWidth(name, 1))));
  text(img, name, 3 * S, size - 3 * S - 5 * px, px, LABEL_COL, 0.85);
  text(img, '96X96 EXACT', 3 * S, 3 * S, Math.max(1, S), GUIDE_SAFE, 0.8);
  void cx;
  return img;
}

/* ================================================================== */
/* HUD icon template — life (heart) and bomb (star), <=16×16, white.    */
/* ================================================================== */

const HUD_SIZE = 16; // docs/packs.md §5.4 / §7.4: the <=16×16 ceiling

function heartA(dx: number, dy: number, r: number): number {
  const u = dx / r;
  const v = -dy / r; // screen y is down; flip so the point faces down
  return (u * u + v * v - 1) ** 3 - u * u * v * v * v <= 0 ? 0.45 : 0;
}

function hudTemplate(name: string, kind: 'life' | 'bomb', S: number, showLabel: boolean): Img {
  const size = HUD_SIZE * S;
  const img = image(size, size);
  const t = Math.max(1, S);
  const c = size / 2;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const dx = (px - c) / S;
    const dy = (py - c) / S;
    const a = kind === 'life' ? heartA(dx, dy, 6) : starA(dx, dy, 6, 5) * 0.5;
    if (a > 0) over(img, px, py, GHOST_COL, a);
  }
  frame(img, 0, 0, size, size, t, GUIDE_EDGE, 0.5);
  if (showLabel) {
    const px = Math.max(1, Math.floor((size - 4 * S) / Math.max(1, textWidth(name, 1))));
    text(img, name, 2 * S, 2 * S, px, LABEL_COL, 0.85);
  }
  return img;
}

/* ================================================================== */
/* The legend — which cell is worn by what, verified against the code.  */
/* ================================================================== */

interface Char {
  readonly pack: string;
  readonly name: string;
  readonly sprite: string;
  readonly label: string;
}

/** Effect → cell, from `src/sim/effects.ts` (verified at authoring time). */
const EFFECT_WEARERS: Record<string, string> = {
  explosion: 'glow.medium',
  hit: 'spark',
  graze: 'needle',
  pickup: 'star',
  muzzle: 'glow.small',
  'death.big': 'glow.large',
};

/** Item → cell, from `src/sim/item.ts` (verified at authoring time). */
const ITEM_WEARERS: Record<string, string> = {
  power: 'shard',
  'big-power': 'star',
  score: 'mote',
  life: 'petal',
  bomb: 'ring',
};

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function collectCharsAndWearers(root: string): { chars: Char[]; enemyBoss: Map<string, string[]>; shotCells: Set<string> } {
  const chars: Char[] = [];
  const enemyBoss = new Map<string, string[]>();
  const shotCells = new Set<string>();
  const add = (cell: string, who: string) => {
    if (!BULLET_CELLS.includes(cell as any)) return;
    const arr = enemyBoss.get(cell) ?? [];
    arr.push(who);
    enemyBoss.set(cell, arr);
  };
  const walkShots = (o: any): void => {
    if (o && typeof o === 'object') {
      if (typeof o.sprite === 'string') shotCells.add(o.sprite);
      for (const v of Object.values(o)) walkShots(v);
    }
  };

  const files: { pack: string; path: string }[] = [
    { pack: '(base)', path: join(root, 'src/packs/base-pack.json') },
  ];
  for (const dir of ['example', 'clearing']) {
    files.push({ pack: dir, path: join(root, 'packs', dir, 'pack.json') });
  }
  for (const { pack, path } of files) {
    let d: any;
    try { d = readJson(path); } catch { continue; }
    const content = d.content ?? {};
    for (const [k, v] of Object.entries<any>(content.characters ?? {})) {
      chars.push({ pack, name: k, sprite: String(v.sprite ?? 'ship'), label: String(v.label ?? k) });
    }
    for (const [k, v] of Object.entries<any>(content.enemies ?? {})) if (typeof v.sprite === 'string') add(v.sprite, `enemy ${k}`);
    for (const [k, v] of Object.entries<any>(content.bosses ?? {})) if (typeof v.sprite === 'string') add(v.sprite, `boss ${k}`);
    walkShots(content.shots ?? {});
  }
  return { chars, enemyBoss, shotCells };
}

/* ================================================================== */
/* README.zh.md — the one-page Chinese quick guide.                    */
/* ================================================================== */

function buildReadme(
  inventory: string[],
  legend: Map<string, string[]>,
  shotCells: Set<string>,
  chars: Char[],
  speakers: readonly string[],
): string {
  const legendRows = BULLET_CELLS.map((name, i) => {
    const wearers: string[] = [];
    const eb = legend.get(name);
    if (eb && eb.length) wearers.push(...eb);
    if (shotCells.has(name)) wearers.push('玩家 shot');
    for (const [fx, cell] of Object.entries(EFFECT_WEARERS)) if (cell === name) wearers.push(`effect ${fx}`);
    for (const [it, cell] of Object.entries(ITEM_WEARERS)) if (cell === name) wearers.push(`item ${it}`);
    const dir = DIRECTIONAL.has(name) ? ' ➡︎+x' : '';
    const art = CELL_ART[name];
    return `| ${i} | \`${name}\`${dir} | ${art.w}×${art.h} | ${wearers.length ? wearers.join('、') : '（暂无消费者，仍须朝右画）'} |`;
  });

  const roster = chars.map((c) => `| \`${c.name}\` | ${c.pack} | \`${c.sprite}\` | ${c.label} |`).join('\n');

  // Derive the roster prose from the collected chars, not a hardcoded literal.
  // The chars array shrinks when a guest pack is absent (collectCharsAndWearers
  // `catch{continue}`s a missing file), so a fixed "七位…" sentence would
  // contradict the generated roster table. Count, names and the shared-region
  // claim must all track chars or they drift.
  const rosterNames = chars.map((c) => `\`${c.name}\``).join(' ');
  const spriteRegions = [...new Set(chars.map((c) => c.sprite))];
  const regionClaim = spriteRegions.length === 1
    ? `**当前都指向同一个 \`${spriteRegions[0]}\` 区域**`
    : `**当前只指向 ${spriteRegions.map((s) => `\`${s}\``).join('、')} 这几个区域**`;
  const loadClaim = spriteRegions.length === 1
    ? `今天真正会被加载的只有 \`${spriteRegions[0]}.png\`。`
    : `今天真正会被加载的只有这几张：${spriteRegions.map((s) => `\`${s}.png\``).join('、')}。`;

  return `# 美术套件 · 中文速用指南 (art-kit)

由 \`bun run art:kit\` 生成。这些 PNG 是**参考底板**：网格线、安全边距、格名、当前
占位图（低透明度 ghost）和 +x 箭头都直接画进了像素里。请在你自己的软件里**新建一层
盖在底板上作画**，导出时**只导出你画的那层**，尺寸必须与底板完全一致——底板本身永远
不进游戏。

---

## 三条铁律（来自 docs/assets.md §1）

1. **白 = 引擎上色。** 子弹、光效、HUD 图标一律画**纯白/灰阶**，只用亮度和 alpha 塑形；
   颜色由引擎每实例 tint 决定（\`{ r, g, b }\`）。画成蓝的就只能是蓝，画成白的可被调成任何
   颜色。真正“有颜色”的只有立绘/背景/UI 插画。加载器会按每格 mean saturation ≤ 0.15 检查，
   超了直接拒绝。
2. **每格至少留 2px 透明边距。** 32×32 的格子里，画面不得超过 **28×28**（\`MAX_CELL_EXTENT\`=${MAX_CELL_EXTENT}）。
   \`Atlas.uv\` 不做半像素内缩，边缘会采到隔壁格；\`linear\` 采样更是跨缝。**导出位图后要量 alpha
   包围盒**，别信你画时的参数——描边会画到半径之外，尖端会缩到控制点以内。
3. **有方向的图形一律朝右（+x / 东）。** 带 \`orientToHeading\` 的图（针、刃、碎片）由着色器旋转到
   朝向，0° 就是 +x。刀刃朝右画，不要朝上。对称的圆/环/星在任何角度都要成立。

---

## 表面清单（尺寸都从引擎源码读出）

| 表面 | 精确底板 | 放大作画板 | 说明 |
|---|---|---|---|
| bullets 子弹表 | ${BULLET_GRID.cellW * BULLET_COLUMNS}×${BULLET_GRID.cellH * BULLET_ROWS}（${BULLET_COLUMNS}×${BULLET_ROWS} 格，每格 ${BULLET_GRID.cellW}×${BULLET_GRID.cellH}） | 8× = ${BULLET_GRID.cellW * BULLET_COLUMNS * 8}×${BULLET_GRID.cellH * BULLET_ROWS * 8} | 全游戏共用的 16 格，白/灰 |
| ship 自机 | ${SHIP_SIZE}×${SHIP_SIZE}，单区域 \`${SHIP_CELLS[0]}\`，朝上(-y) | 8× = ${SHIP_SIZE * 8}×${SHIP_SIZE * 8} | 须标出比机身小得多的判定点 |
| portrait 立绘 | ${PORTRAIT_SIZE}×${PORTRAIT_SIZE}（**精确**，不是上限） | 8× = ${PORTRAIT_SIZE * 8}×${PORTRAIT_SIZE * 8} | 可用真彩，不被 tint |
| hud 图标 | 至多 ${HUD_SIZE}×${HUD_SIZE}（life/bomb） | 8× = ${HUD_SIZE * 8}×${HUD_SIZE * 8} | 只画形状，白色 |
| background 背景 | —— | —— | **不是图片**，是片元着色器，引擎所有；美术贡献调色板/参考图/成品判断，见 docs/assets.md §3.4 |

下表 ${chars.length} 位自机角色（${rosterNames}）${regionClaim}；\`ship-roster\` 是给“将来每机独立区域”
准备的设计参考，那一步需要 §3.2 的引擎改动，不在本套件范围内。${loadClaim}

### 自机角色

| 角色 | 来源 | sprite 区域 | 标签 |
|---|---|---|---|
${roster}

### 子弹格清单（格名即契约，按名引用，不按序号）

| # | 格名 | 几何设计范围（非实测像素，实测见 docs/assets.md §3.1） | 谁在穿它（已核对代码） |
|---|---|---|---|
${legendRows.join('\n')}

### 立绘 speaker（基础游戏 + 内建剧情实际点名的，来自 portrait 注册表）

${speakers.map((s) => `- \`${s}\``).join('\n')}

---

## 两条落地路线

### 路线一（首选）：做成一个 pack，零改代码

在 \`packs/\` 下新建 \`packs/<名字>/\`，放一个 \`pack.json\`（字段名**照抄**，来自 docs/packs.md）：

\`\`\`json
{
  "format": 1,
  "name": "<名字>",
  "version": "1.0.0",
  "author": "<作者，署名即出处，CLAUDE.md 规则 9>",
  "license": "<许可，必填>",
  "assets": { "bullets": "bullets.png", "ship": "ship.png", "filter": "nearest" },
  "hud": { "life": "life.png", "bomb": "bomb.png" },
  "portraits": { "sentinel": "sentinel.png" }
}
\`\`\`

- \`name\` 必须等于文件夹名，且匹配 \`[a-z0-9-]{1,32}\`。
- \`assets.filter\` 只能是 \`"nearest"\` 或 \`"linear"\`（柔和渐变用 \`linear\`，硬边像素用 \`nearest\`）。
- \`portraits.<name>\` 里的 \`<name>\` 就是某 boss 台词的 \`speaker\`。
- 复制 \`packs/example/\` 是最快的起点（每个字段都用到了）。
- 开发时：\`bun run dev\` 后**刷新**页面即生效；\`?pack=<名字>\` 可单独看某个包。

### 路线二：直接替换内建占位表（改一行源码）

见 docs/assets.md §5。把 256×64 的成品放进 \`src/assets/\`，然后：

\`\`\`ts
import BULLETS_URL from './assets/bullets.png';
const BULLET_SHEET: string | undefined = BULLETS_URL;   // main.ts 里原本是 undefined
\`\`\`

**不要**用 \`new URL('./bullets.png', import.meta.url)\`（dev server 下会 404）。自机同理走
\`shipAtlas(url)\` 那条缝。

---

## 验证阶梯（顺序不能反，只跑最后一条就是让美术背引擎的锅）

1. \`bun run dev\` → 刷新，看 console 的 boot report：谁占了哪个槽、谁覆盖了谁、谁失败了。
2. \`bun run test:assets\`（→ http://localhost:3007）：量**真实像素**——尺寸、每格 alpha 包围盒、是否白。
3. \`bun run test:density\`（→ http://localhost:3008）：500 发同屏，判断可读性——这是唯一没法自动化的一关。
4. \`bun run build\`：确认你的 PNG 出现在 dist 的产物里（不是可选步骤）。

---

## 常见坑

- **放大作画板必须以精确尺寸导出。** 8× 是给你画的，导出前缩回原尺寸（bullets 256×64、ship 64×64、
  portrait 必须**正好** 96×96、hud ≤16×16）。
- **sRGB，不要嵌 ICC профиль。** 引擎按 \`NoColorSpace\` 取原始字节；嵌了 profile 浏览器会先解码，颜色就变了。
- **必须有 alpha 通道。**（上游 \`rumia.png\` 就栽在没 alpha，整块黑底。）不要预乘/预校正 gamma。
- **guides/ghost 层不能一起导出。** 底板里的洋红/青色网格线、格名、绿色箭头都是参考，只导出你自己画的那层。
- **有方向的格子朝右画**，即使现在还没有东西旋转它（第一个旋转它的内容不会替你检查）。

### 加载器会原样吐出的真实报错（认得它们就好定位，字符串是契约，不会被改写）

\`\`\`
assets.filter must be "nearest" or "linear"
pack "<名>": <路径>: sheet is <w>×<h>, expected 256×64 (8×2 cells of 32×32)
pack "<名>": <路径>: cell "<格>" paints <x>×<y>px, over the 28px limit — a cell must clear 2px of margin or it bleeds across the seam
pack "<名>": <路径>: cell "<格>" has mean saturation <n>, over 0.15 — bullets are white and colour is the engine's tint
pack "<名>": <路径>: ship sheet is <w>×<h>, expected 64×64
pack "<名>": <路径>: hud icon is <w>×<h>, over the 16×16 limit — it stands in for a glyph, so it is drawn small
pack "<名>": <路径>: portrait is <w>×<h>, expected 96×96
\`\`\`

源码路线（bulletAtlas）尺寸不符时抛：
\`\`\`
bullet sheet "<url>" is <w>×<h>, expected 256×64 (8×2 cells of 32×32)
\`\`\`

若用的是裸 \`bun ./index.html\`（没有 dev 包装器），会看到：
\`\`\`
packs unavailable under this server — run bun run dev
\`\`\`

---

${reservedSection()}

---

## 本次生成清单

${inventory.map((l) => `- ${l}`).join('\n')}
`;
}

/* ================================================================== */
/* RESERVED — surfaces an imported pack may carry, but no engine        */
/* consumer exists yet. Documented as format expectations, NOT emitted  */
/* as templates: a dead template slot that looks live is exactly what   */
/* the reachability doctrine (CLAUDE.md) forbids.                       */
/* ================================================================== */

/**
 * The categories the third-party BulletPack import (tools/import-bulletpack.ts)
 * surfaced that this engine cannot receive today. This section exists so the
 * art is not mistaken for something the kit forgot to template — it is art the
 * *engine* has no home for. The importer stages every one of these under
 * `packs/<pack>/extra/<category>/` with an `extra/extras.json` manifest; a
 * future engine round consumes that manifest, and only then does a template for
 * the surface belong in this kit.
 *
 * This is prose, not a template, on purpose. The four surfaces the kit DOES emit
 * (bullets, ship, portraits, HUD) are the four the `define*` registries wire to
 * art. Items, effects and options are not missing — they reuse the 16 bullet
 * cells above (see the legend), and bombs carry no sprite field at all. So there
 * is nothing more to paint; there is only this, to describe what cannot yet be
 * painted into the game.
 */
function reservedSection(): string {
  return `## 保留区（RESERVED）：有美术、但引擎暂时无法消费的表面

下列类别在导入第三方素材（\`tools/import-bulletpack.ts\`）时出现，但**当前引擎没有任何消费它们的接口**。
它们不是本套件“漏掉”的模板——本套件只为四个真正接线到 \`define*\` 注册表的表面出模板
（bullets / ship / portrait / hud）；item、effect、option 都复用上面那 16 格子弹格，bomb 根本没有 sprite 字段，
所以没有别的可画的了。下面这些是引擎侧还没有落点的东西，按**格式期望**记录，**不出占位模板**——
一个看起来能用、其实没人消费的模板槽，正是可达性铁律（CLAUDE.md《Registration is not reachability》）禁止的。

导入器会把这些原样暂存到 \`packs/<包名>/extra/<类别>/\`，并生成 \`extra/extras.json\` 清单
（每个文件的尺寸、帧数、朝向猜测、建议的未来消费者）。**将来某一轮引擎改动消费的是那份清单，而不是一堆神秘条带**；
只有到那一步，对应表面的模板才该进本套件。

| 类别 | 格式期望（条带布局 / 帧数 / 朝向 / 尺寸） | 为什么现在没有消费者 |
|---|---|---|
| **激光体 + 命中帽** | 竖直、沿长度**平铺**的光束段（\`strip3\`–\`strip12\`，帧宽 13–32），外加独立的 3 帧命中帽 | \`LaserSpec\` 存在（\`src/sim/bullet.ts\`），但渲染是把**一格 32×32 拉伸**铺满整条光束（\`src/main.ts\`），没有平铺光束渲染，也没有独立命中帽精灵 |
| **逐帧动画条** | 2–41 帧水平条带，各种帧宽 | 引擎**任何地方都没有帧播放**（\`grep frameIndex/animFrame\` 零命中）；每条动画都塌缩成单帧 |
| **导弹实体** | 5 帧转向姿态精灵（左右摆动，非循环）+ 尾焰 | 最接近的是把 \`homing\` 行为挂到一颗普通子弹上、单静态格连续旋转——没有离散姿态帧，没有尾焰 |
| **推进 / 尾焰** | 连续拖尾条带（\`strip2\`–\`strip6\`，帧宽 4–6） | 六个 \`defineEffect\`（explosion/hit/graze/pickup/muzzle/death.big）都没有“持续拖尾”这一类 |
| **炸弹视觉** | 大型新星/冲击波条带（最多 41 帧） | \`BombSpec\` 完全没有 sprite 表面；炸弹只通过现有粒子/effect 系统表现 |
| **专用 option 精灵** | 独立的双吊舱卫星精灵（单帧小图） | \`OptionSpec.sprite\` 命名的是一格**子弹格**，option 没有独立精灵命名空间 |

要点：这些**不改引擎就画不进游戏**。想推进其中任何一项，先扩 \`src/render/procedural.ts\` / \`src/sim/*\` /
本套件的模板，然后才谈作画——顺序反了就是画了一堆没人加载的图。`;
}

/* ================================================================== */
/* main — write every template, verify each, emit the guide.           */
/* ================================================================== */

function verify(bytes: Uint8Array, expectW: number, expectH: number, label: string): PngHeader {
  const png = parsePng(bytes);
  if (png.width !== expectW || png.height !== expectH) {
    throw new Error(`${label}: ${png.width}×${png.height}, expected ${expectW}×${expectH}`);
  }
  if (png.colourType !== ColourType.RGBA) {
    throw new Error(`${label}: colour type ${png.colourType}, expected 6 (RGBA — alpha channel required)`);
  }
  return png;
}

function main(): void {
  checkGhost();

  const root = join(import.meta.dir, '..');
  const outArg = process.argv[2] ?? 'art-kit';
  const out = join(process.cwd(), outArg);
  mkdirSync(out, { recursive: true });

  const { chars, enemyBoss, shotCells } = collectCharsAndWearers(root);
  const speakers = [...portraitNames()].sort();

  const inventory: string[] = [];
  const write = (file: string, bytes: Uint8Array, w: number, h: number): void => {
    verify(bytes, w, h, file);
    writeFileSync(join(out, file), bytes);
    inventory.push(`\`${file}\` — ${w}×${h}, RGBA`);
  };

  // Bullets: exact template + 8× painting canvas.
  const bulletsExact = bulletSheet(1, false);
  write('bullets-template.png', encode(bulletsExact), bulletsExact.w, bulletsExact.h);
  const bullets8x = bulletSheet(8, true);
  write('bullets-paint-8x.png', encode(bullets8x), bullets8x.w, bullets8x.h);

  // Ship: exact + 8× + the seven-character roster reference.
  const shipExact = shipTemplate(1, 'SHIP');
  write('ship-template.png', encode(shipExact), shipExact.w, shipExact.h);
  const ship8x = shipTemplate(8, 'SHIP');
  write('ship-paint-8x.png', encode(ship8x), ship8x.w, ship8x.h);
  const roster = shipRoster(chars);
  write('ship-roster.png', encode(roster), roster.w, roster.h);

  // Portraits: one exact 96×96 per speaker + an 8× painting canvas.
  for (const name of speakers) {
    const exact = portraitTemplate(name, 1);
    write(`portrait-${name}-template.png`, encode(exact), exact.w, exact.h);
    const big = portraitTemplate(name, 8);
    write(`portrait-${name}-paint-8x.png`, encode(big), big.w, big.h);
  }

  // HUD icons: life + bomb, exact + 8×.
  for (const [name, kind] of [['life', 'life'], ['bomb', 'bomb']] as const) {
    const exact = hudTemplate(name, kind, 1, false);
    write(`hud-${name}-template.png`, encode(exact), exact.w, exact.h);
    const big = hudTemplate(name, kind, 8, true);
    write(`hud-${name}-paint-8x.png`, encode(big), big.w, big.h);
  }

  const readme = buildReadme(inventory, enemyBoss, shotCells, chars, speakers);
  writeFileSync(join(out, 'README.zh.md'), readme);
  inventory.push('`README.zh.md` — the Chinese quick guide');

  process.stdout.write(`art kit written to ${out}\n`);
  for (const line of inventory) process.stdout.write(`  ${line}\n`);
}

main();
