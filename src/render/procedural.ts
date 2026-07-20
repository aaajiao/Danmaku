/**
 * Procedurally generated placeholder art.
 *
 * Upstream's sprites are Touhou Project derivatives and cannot ship (CLAUDE.md,
 * rule 9). Rather than block on art, the engine generates its own sheet at
 * runtime — original by construction, and license-clean.
 *
 * This doubles as the executable specification for the real art set: the grid
 * geometry, cell count and pivot conventions defined here are exactly what
 * `docs/assets.md` asks an artist or an image model to match.
 *
 * **Real art replaces the pixels, not this module.** Call `bulletAtlas(url)`
 * instead of `bulletAtlas()` and the sheet comes from a PNG; that is the entire
 * swap, and the seam is documented on that function. The header used to claim
 * "replacing this with a loaded PNG must not require touching anything else",
 * which was an intention rather than a description — there was no such
 * function, and doing it by hand meant reordering `main.ts`'s module top level.
 * The contract also lives here and outlives any swap: `BULLET_GRID`,
 * `BULLET_CELLS`, `MAX_CELL_EXTENT`, `CELL_ART`, and the `BulletCell` type that
 * `sim/effects.ts` imports.
 *
 * Bullets are drawn **white** and tinted per-instance by the shader. One
 * greyscale shape therefore serves every colour in the game, which is why the
 * sheet is small and why the art spec asks for luminance, not colour.
 */

import * as THREE from 'three';
import { Atlas, loadAtlas, type GridSpec } from './atlas';

/** Every generated sheet uses this grid. The real art set must match it. */
export const BULLET_GRID: GridSpec = { cellW: 32, cellH: 32 };
export const BULLET_COLUMNS = 8;
export const BULLET_ROWS = 2;

/**
 * Cell names in row-major order. Content references these, never indices —
 * so re-packing the sheet cannot silently repoint a bullet at the wrong art.
 */
export const BULLET_CELLS = [
  'orb.small',
  'orb.medium',
  'orb.large',
  'ring',
  'kunai',
  'scale',
  'star',
  'shard',
  'glow.small',
  'glow.medium',
  'glow.large',
  'halo',
  'needle',
  'petal',
  'spark',
  'mote',
] as const;

export type BulletCell = (typeof BULLET_CELLS)[number];

type Ctx = CanvasRenderingContext2D;

function canvas(width: number, height: number): { el: HTMLCanvasElement; ctx: Ctx } {
  const el = document.createElement('canvas');
  el.width = width;
  el.height = height;
  const ctx = el.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return { el, ctx };
}

/** Soft radial body — the core shape most danmaku sprites are built from. */
function orb(ctx: Ctx, cx: number, cy: number, radius: number, coreRatio = 0.45): void {
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(coreRatio, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.82, 'rgba(255,255,255,0.35)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
}

/** Hollow ring — reads clearly against dense fire, so it suits aimed shots. */
function ring(ctx: Ctx, cx: number, cy: number, radius: number, thickness: number): void {
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = thickness;
  ctx.beginPath();
  ctx.arc(cx, cy, radius - thickness / 2, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = thickness * 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius - thickness / 2, 0, Math.PI * 2);
  ctx.stroke();
}

/** Elongated blade, pointing along +x so rotation matches heading. */
function blade(ctx: Ctx, cx: number, cy: number, len: number, wide: number): void {
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.moveTo(cx + len / 2, cy);
  ctx.quadraticCurveTo(cx, cy - wide / 2, cx - len / 2, cy);
  ctx.quadraticCurveTo(cx, cy + wide / 2, cx + len / 2, cy);
  ctx.fill();
}

function star(ctx: Ctx, cx: number, cy: number, radius: number, points: number): void {
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? radius : radius * 0.42;
    const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function shard(ctx: Ctx, cx: number, cy: number, len: number, wide: number): void {
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.moveTo(cx + len / 2, cy);
  ctx.lineTo(cx, cy - wide / 2);
  ctx.lineTo(cx - len / 2, cy);
  ctx.lineTo(cx, cy + wide / 2);
  ctx.closePath();
  ctx.fill();
}

function petal(ctx: Ctx, cx: number, cy: number, radius: number): void {
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.moveTo(cx + radius, cy);
  ctx.quadraticCurveTo(cx, cy - radius * 0.9, cx - radius, cy);
  ctx.quadraticCurveTo(cx, cy + radius * 0.5, cx + radius, cy);
  ctx.fill();
}

/**
 * Largest painted extent a 32px cell may contain.
 *
 * `Atlas.uv` applies no half-texel inset, so the outermost fragment column of a
 * quad interpolates to the boundary between one cell and the next — the first
 * texel of the neighbour. Padding inside the cell is the only thing between
 * that and a stripe of the wrong sprite along every seam, and this sheet is
 * sampled with `LinearFilter`, which reaches across the seam by design.
 *
 * 28 in a 32px cell is 2px of margin on each side.
 *
 * ## Geometric extent, not the pixel footprint — and why 28 is exactly right
 *
 * The extents below are geometric: where the path runs. What antialiasing
 * actually *paints* is up to a pixel wider, because a boundary landing at a
 * fractional coordinate gives partial coverage to the pixel outside it.
 * Measured on a real canvas, centred at 16:
 *
 *   geometric 27  →  covers 2.5 .. 29.5  →  pixels 2..29  =  28px, 2px margin
 *   geometric 28  →  covers 2.0 .. 30.0  →  pixels 2..29  =  28px, 2px margin
 *   geometric 29  →  covers 1.5 .. 30.5  →  pixels 1..30  =  30px, 1px margin
 *
 * So 28 is not a round number someone liked: it is the largest geometric extent
 * whose painted footprint still clears two pixels, and 29 is the first that does
 * not. Checking geometry rather than pixels is therefore safe in the direction
 * that matters — it can never pass something the bitmap would fail.
 *
 * This distinction is the same class of error as the one that produced the bug:
 * a number that looks like it describes the art but describes something one step
 * removed from it. `procedural.test.ts` says so too, and cannot check it, since
 * `bun test` has no canvas.
 */
export const MAX_CELL_EXTENT = 28;

/**
 * One cell: how to draw it, and how big the result actually is.
 *
 * The extent is declared here rather than in `docs/assets.md` because a number
 * living only in prose is a number nothing checks. This sheet shipped for the
 * life of the project with `halo` painting a full 32px — zero margin, its faint
 * outer stroke sitting exactly on the seam — and the asset spec asserted 2px of
 * padding throughout. Both were written by hand and neither could catch the
 * other.
 *
 * So every constructor below computes the extent from the same arguments it
 * hands the painter, and `procedural.test.ts` holds them all against
 * `MAX_CELL_EXTENT`. Getting one wrong now means changing two expressions that
 * sit on adjacent lines, rather than a doc nobody reruns.
 */
interface CellArt {
  draw: (ctx: Ctx, cx: number, cy: number) => void;
  /** Painted bounding box in px. */
  readonly w: number;
  readonly h: number;
}

const orbCell = (radius: number, coreRatio?: number): CellArt => ({
  draw: (c, x, y) => orb(c, x, y, radius, coreRatio),
  w: radius * 2,
  h: radius * 2,
});

/**
 * The faint outer stroke is `thickness * 2` wide and centred on
 * `radius - thickness / 2`, so paint reaches `radius + thickness / 2` — half a
 * thickness *beyond* the nominal radius. That overhang is what put `halo` on
 * the cell boundary, and it is invisible from the call site.
 */
const ringCell = (radius: number, thickness: number): CellArt => ({
  draw: (c, x, y) => ring(c, x, y, radius, thickness),
  w: (radius + thickness / 2) * 2,
  h: (radius + thickness / 2) * 2,
});

/**
 * A quadratic Bézier's apex reaches only half its control offset, so a blade
 * declared `wide` paints `wide / 2` tall. `docs/assets.md` quoted the control
 * argument as the height and was roughly double the truth on every blade.
 */
const bladeCell = (len: number, wide: number): CellArt => ({
  draw: (c, x, y) => blade(c, x, y, len, wide),
  w: len,
  h: wide / 2,
});

/** Straight edges to real vertices, so this one is exactly its stated size. */
const shardCell = (len: number, wide: number): CellArt => ({
  draw: (c, x, y) => shard(c, x, y, len, wide),
  w: len,
  h: wide,
});

const starCell = (radius: number, points: number): CellArt => ({
  draw: (c, x, y) => star(c, x, y, radius, points),
  w: radius * 2,
  h: radius * 2,
});

/** Control points at -0.9r and +0.5r; each apex lands at half its offset. */
const petalCell = (radius: number): CellArt => ({
  draw: (c, x, y) => petal(c, x, y, radius),
  w: radius * 2,
  h: radius * 0.45 + radius * 0.25,
});

export const CELL_ART: Record<BulletCell, CellArt> = {
  'orb.small': orbCell(5),
  'orb.medium': orbCell(8),
  'orb.large': orbCell(13),
  ring: ringCell(12, 3),
  kunai: bladeCell(26, 9),
  scale: shardCell(20, 12),
  star: starCell(13, 5),
  shard: shardCell(26, 7),
  'glow.small': orbCell(7, 0.15),
  'glow.medium': orbCell(11, 0.12),
  // Was radius 15 — a 30px extent, 1px of margin. The gradient's last stop is
  // fully transparent so it never bled visibly, but it broke the rule the sheet
  // is meant to demonstrate, and hand-drawn art copying the number would.
  'glow.large': orbCell(14, 0.1),
  // Was ring(15, 2): the overhang above put paint at r=16, a full 32px with no
  // margin at all. 13 + 1 lands exactly on the limit.
  halo: ringCell(13, 2),
  needle: bladeCell(28, 5),
  petal: petalCell(11),
  spark: starCell(11, 4),
  mote: orbCell(3),
};

/**
 * Render the bullet sheet into a texture.
 *
 * Everything is white; colour comes from the per-instance tint.
 *
 * Cells are padded to `MAX_CELL_EXTENT`, which `procedural.test.ts` checks —
 * "padded by construction" is what this comment used to claim, and it was not
 * true of `halo` or `glow.large`. It also said NEAREST sampling could not bleed
 * a neighbour in. Two things wrong with that: this sheet sets `LinearFilter`
 * eight lines below, precisely because generated art is smooth rather than
 * pixel art, and linear sampling reaching across the seam is the entire reason
 * the padding matters. NEAREST is what `loadTexture` gives a dropped-in PNG.
 */
export function createBulletAtlas(): Atlas {
  const { cellW, cellH } = BULLET_GRID;
  const width = cellW * BULLET_COLUMNS;
  const height = cellH * BULLET_ROWS;
  const { el, ctx } = canvas(width, height);

  BULLET_CELLS.forEach((name, index) => {
    const col = index % BULLET_COLUMNS;
    const row = Math.floor(index / BULLET_COLUMNS);
    const cx = col * cellW + cellW / 2;
    const cy = row * cellH + cellH / 2;
    CELL_ART[name].draw(ctx, cx, cy);
  });

  const texture = new THREE.CanvasTexture(el);
  texture.magFilter = THREE.LinearFilter; // generated art is smooth, not pixel art
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace; // display-referred; see atlas.ts
  texture.flipY = false;
  texture.needsUpdate = true;

  const atlas = new Atlas(texture, width, height, BULLET_GRID);
  atlas.defineGrid([...BULLET_CELLS]);
  return atlas;
}

/**
 * The bullet sheet, generated or loaded — **the seam real art arrives through**.
 *
 * This function is the whole integration point. Pass a URL and the sheet comes
 * from a PNG; pass nothing and it is generated as before. Both branches end in
 * the same two lines — `defineGrid([...BULLET_CELLS])` and the filter — so the
 * cell names, their order and the grid are identical either way, and every
 * consumer downstream is genuinely untouched.
 *
 * It exists because the header above promised it and the code did not deliver
 * it: substituting a loaded sheet used to mean reordering `main.ts`'s module
 * top level, re-deciding the texture filter, and remembering `defineGrid`
 * yourself. Three chances to get it wrong, in a procedure documented in two
 * places that disagreed.
 *
 * ## The dimension check is the point, not a courtesy
 *
 * A sheet of the wrong size does not fail. `Atlas` computes UVs from the
 * dimensions it is handed, so a 512×128 sheet where a 256×64 one was expected
 * silently repoints all sixteen cells at quarter-size crops of the wrong
 * shapes, and the game runs. That is a bad afternoon with no error message, so
 * a mismatch throws here instead — naming both figures, because "wrong size" is
 * not actionable and "got 512×128, expected 256×64" is.
 *
 * ## `procedural.ts` survives the swap; only its texture source changes
 *
 * Worth stating plainly, because the file is named "placeholder art" and reads
 * like something to delete. The *contract* lives here too — `BULLET_GRID`,
 * `BULLET_CELLS`, `BULLET_COLUMNS`/`ROWS`, `MAX_CELL_EXTENT`, `CELL_ART` and
 * the `BulletCell` type that `sim/effects.ts` imports — and `tools/` and the
 * visual pages read it as well. Real art replaces the pixels, not the module.
 */
export async function bulletAtlas(url?: string): Promise<Atlas> {
  if (url === undefined) return createBulletAtlas();

  const atlas = await loadAtlas(url, BULLET_GRID);
  const expectedW = BULLET_GRID.cellW * BULLET_COLUMNS;
  const expectedH = BULLET_GRID.cellH * BULLET_ROWS;
  if (atlas.width !== expectedW || atlas.height !== expectedH) {
    throw new Error(
      `bullet sheet "${url}" is ${atlas.width}×${atlas.height}, ` +
        `expected ${expectedW}×${expectedH} ` +
        `(${BULLET_COLUMNS}×${BULLET_ROWS} cells of ${BULLET_GRID.cellW}×${BULLET_GRID.cellH})`,
    );
  }
  atlas.defineGrid([...BULLET_CELLS]);
  return atlas;
}

/** The ship sheet is a single square cell. The real art set must match it. */
export const SHIP_SIZE = 64;

/** A simple ship silhouette, pointing up (-y). Placeholder for the player. */
export function createShipAtlas(): Atlas {
  const size = SHIP_SIZE;
  const { el, ctx } = canvas(size, size);
  const cx = size / 2;
  const cy = size / 2;

  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 22);
  ctx.lineTo(cx + 16, cy + 18);
  ctx.lineTo(cx, cy + 9);
  ctx.lineTo(cx - 16, cy + 18);
  ctx.closePath();
  ctx.fill();

  // Hitbox marker. In danmaku the hitbox is far smaller than the sprite, and
  // showing it is a genuine readability feature, not a debug affordance.
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.beginPath();
  ctx.arc(cx, cy + 2, 3, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(el);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace; // display-referred; see atlas.ts
  texture.flipY = false;
  texture.needsUpdate = true;

  const atlas = new Atlas(texture, size, size);
  atlas.define('ship', { x: 0, y: 0, w: size, h: size });
  return atlas;
}

/**
 * The ship sheet, generated or loaded — the player's half of the art seam.
 *
 * Symmetric with `bulletAtlas(url?)` in every way that matters: `undefined`
 * generates the placeholder silhouette, a URL loads a PNG, and both branches
 * end defining the same single `ship` region so every consumer downstream is
 * untouched. The dimension check is the point for the same reason it is on the
 * bullet seam — `Atlas` computes UVs from the size it is handed, so a
 * wrong-sized sheet silently repoints the region at a crop of the wrong shape
 * and the game runs. A mismatch throws here instead, naming both figures.
 *
 * A loaded sheet keeps `loadTexture`'s NearestFilter; smooth art opts into
 * linear at the call site (a pack declares `assets.filter`), which is why this
 * does not re-decide the filter the way the two placeholder generators do.
 */
export async function shipAtlas(url?: string): Promise<Atlas> {
  if (url === undefined) return createShipAtlas();

  const atlas = await loadAtlas(url);
  if (atlas.width !== SHIP_SIZE || atlas.height !== SHIP_SIZE) {
    throw new Error(
      `ship sheet "${url}" is ${atlas.width}×${atlas.height}, ` +
        `expected ${SHIP_SIZE}×${SHIP_SIZE} (one ${SHIP_SIZE}×${SHIP_SIZE} cell)`,
    );
  }
  atlas.define('ship', { x: 0, y: 0, w: atlas.width, h: atlas.height });
  return atlas;
}
