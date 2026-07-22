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
 *
 * That white+tint rule describes **this procedural floor**, not every sheet the
 * engine can draw. A loaded pack may instead ship native strips: `tinted` floor
 * cells keep the recolourable law, and a pack may **bake** colour into the
 * pixels of a *named variant* strip (`color: 'baked'`) that content references
 * tint-free. The floor stays tinted white — the honest, recolourable rule-9
 * placeholder — and the baked path lives in `bulletAtlas(url, strips)` / a
 * `Strip.color` of `'baked'`. See docs/packs.md and the Rendering doctrine in
 * CLAUDE.md.
 */

import * as THREE from 'three';
import { Atlas, loadAtlas, loadTexture, type GridSpec, type StripColor, type StripMode } from './atlas';

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
 * A laser body glow band, painted **east-native** (rule 7 — an oriented sprite
 * runs +x, and the beam renderer stretches/tiles along local +x). The glow is
 * uniform along the on-beam (x) axis and fades cross-axis (y), so a tiled body
 * butts against its neighbour with no seam: the frame is painted edge to edge on
 * x precisely because a tiling body reaches its on-beam frame edges by design,
 * and it is a 1-frame strip, so there is no animation frame beside it to bleed
 * into. Cross-axis it clears the seam pad, where the next strip's row *does* sit.
 */
function laserBody(ctx: Ctx, cx: number, cy: number, frameW: number, coreH: number): void {
  const g = ctx.createLinearGradient(0, cy - coreH / 2, 0, cy + coreH / 2);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.95)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(cx - frameW / 2, cy - coreH / 2, frameW, coreH);
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

/* ------------------------------------------------------------------ */
/* Per-family bullet variants — the deliberate curtain vocabulary     */
/* ------------------------------------------------------------------ */

/**
 * The named bullets the base campaign fires, one per enemy/boss family and per
 * player weapon — the vocabulary a pack (BulletPack) reskins so each family gets
 * its own art instead of every `orb.small` sharing one cell at twenty-seven hues.
 *
 * A variant is `<baseCell>.<family>`: the prefix is one of the 16 `BULLET_CELLS`
 * and names the **alias target**, the suffix is the firing family/role. It is NOT
 * a floor cell (`BULLET_CELLS` is the sixteen and never grows — the 8×2 grid and
 * `procedural.test.ts`'s capacity check stay exactly as they are). Instead every
 * atlas the engine builds ALIASES each variant to its base cell's frame-0 region,
 * so:
 *
 * - **Zero-pack / legacy-grid play** draws the variant as its base shape (white),
 *   and the base content carries the family tint — so the never-blocked floor
 *   holds and the picture is byte-identical to before this vocabulary existed.
 * - **A native pack sheet** may define the SAME bare variant name with baked
 *   native art; `nativeBulletAtlas` keeps the pack's strip and aliases only the
 *   variants the pack did not cover. A variant is not one of the sixteen shared
 *   floor cells, so a pack may bake colour into it without fighting the tint the
 *   base campaign uses to colour-code the shared cells (amendment §1.5 / §Naming
 *   tier 3, but reached bare because the base game is the unqualified consumer).
 *
 * A sprite name is content, the pixels it resolves to are presentation: the sim
 * reads `radius`, never a cell, so naming a variant moves no trace. That is why
 * the base-pack port to this vocabulary is replay-neutral.
 */
export const BULLET_VARIANTS: Record<string, BulletCell> = {
  /* -- stage-1 enemies + sentinel -- */
  'orb.small.chaff': 'orb.small', // ENEMY_SHOT — stage-1/2 plain shot
  'scale.heavy': 'scale', // HEAVY_SHOT — turret ring
  'scale.shard': 'scale', // SHARD — sentinel approach/vigil
  'petal.corolla': 'petal', // PETAL — sentinel "Tidal Corolla"
  'needle.vigil': 'needle', // NEEDLE — sentinel "Vigil Unbroken"

  /* -- stage-2 enemies + warden/magistrate -- */
  'orb.small.spark': 'orb.small', // SPARK — stage-2 wavering shot
  'kunai.seeker': 'kunai', // SEEKER — hunter / magistrate
  'needle.lance': 'needle', // LANCE — lash beam
  'needle.column': 'needle', // COLUMN — warden / magistrate beam
  'petal.ember': 'petal', // EMBER — censer / magistrate mill
  'scale.shell': 'scale', // SHELL — bastion / warden / magistrate

  /* -- stage-3 enemies + chancellor -- */
  'orb.small.writ': 'orb.small', // WRIT — stage-3/4 aimed shot
  'orb.medium.slab': 'orb.medium', // SLAB — stele wall
  'needle.subpoena': 'needle', // SUBPOENA — summons homing
  'spark.levy': 'spark', // LEVY — assessor / chancellor / notary spiral
  'orb.medium.decree': 'orb.medium', // DECREE — chancellor / regent ring
  'halo.seal': 'halo', // SEAL — chancellor "Wax and Witness"

  /* -- stage-4 enemies + regent -- */
  'needle.picket': 'needle', // PICKET — usher herd
  'orb.medium.bulwark': 'orb.medium', // BULWARK — marshal wall
  'halo.signet': 'halo', // SIGNET — notary stamp
  'halo.crown': 'halo', // CROWN_CW — regent "Corolla Regnant" inner
  'halo.diadem': 'halo', // CROWN_CCW — regent "Corolla Regnant" outer
  'needle.warrant': 'needle', // WARRANT — regent "Attainder" seeker
  'orb.medium.lattice': 'orb.medium', // LATTICE — regent "Portcullis"

  /* -- player weapons (shots and options) -- */
  'glow.small.bolt': 'glow.small', // GUN_BOLT — spread
  'needle.pin': 'needle', // GUN_NEEDLE — needle
  'scale.tracker': 'scale', // GUN_SEEKER — homing
  'glow.small.beam': 'glow.small', // GUN_BEAM — laser
  'glow.small.spray': 'glow.small', // SCATTER_PELLET — maw scatter
  'orb.small.satellite': 'orb.small', // OPT_STD_SHOT — standard option
  'scale.satellite': 'scale', // OPT_SEEKER_SHOT — seeker option
  'orb.small.battery': 'orb.small', // OPT_PICKET_SHOT — picket option
  'orb.small.clinch': 'orb.small', // CLINCH_SHOT — clinch option
};

/**
 * The variant names as a flat list — the base campaign's sprite-name surface the
 * injector validates content against, `BULLET_CELLS`'s companion. Both `bundled.ts`
 * and `loader.ts` add these to `InjectContext.sprites` so a base (or guest) spec
 * naming a variant resolves.
 */
export const BULLET_VARIANT_CELLS = Object.keys(BULLET_VARIANTS) as readonly string[];

/**
 * Alias every variant not already present on `atlas` to its base cell's frame-0
 * region, so a variant name always resolves whatever built the atlas (procedural
 * floor, legacy grid, or a native pack sheet that covered only some variants). The
 * base cells are defined before this runs on every path, so `atlas.get(base)` is
 * safe. A variant the pack DID define keeps its own (possibly animated, baked)
 * strip — `has` guards it.
 */
function defineVariantAliases(atlas: Atlas): void {
  for (const [variant, base] of Object.entries(BULLET_VARIANTS)) {
    if (!atlas.has(variant)) atlas.define(variant, atlas.get(base));
  }
}

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
  defineVariantAliases(atlas); // every family variant draws as its base shape
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
/**
 * A native bullet strip on a self-describing sheet — the structural twin of the
 * pack manifest's `PackBulletStrip`, redeclared here so `render/` need not import
 * `packs/`. Frame 0 sits at `x,y`; `frames` walk right by `stride`.
 */
export interface BulletStripInput {
  x: number;
  y: number;
  frameW: number;
  frameH: number;
  frames?: number;
  stride?: number;
  ticksPerFrame?: number;
  mode?: StripMode;
  color?: StripColor;
}

/** A whole self-describing bullet atlas: one shared PNG, every strip on it. */
export interface BulletSheetInput {
  sheet: string;
  strips: Record<string, BulletStripInput>;
}

/** A native ship strip bank — one PNG, frame 0 leftmost (no x/y). */
export interface ShipStripInput {
  frameW: number;
  frameH: number;
  frames?: number;
  stride?: number;
  ticksPerFrame?: number;
  mode?: StripMode;
  color?: StripColor;
}

/**
 * The bullet sheet, generated or loaded — **the seam real art arrives through**.
 *
 * Three forms, one atlas:
 * - `bulletAtlas()` — the procedural white+tint floor (rule 9).
 * - `bulletAtlas(url)` — a legacy 256×64 grid PNG, dimension-checked, the 16
 *   cells named by `defineGrid`. Byte-identical draw to the floor.
 * - `bulletAtlas(url, strips)` — a self-describing native sheet: every strip is
 *   `defineStrip`ed at its native size/animation. Because bullets stay single
 *   texture / single batch (500+ a tick), a native sheet REPLACES the whole
 *   bullet atlas, so it must cover all 16 floor cells (asserted); it MAY add
 *   pack-new variant names. No per-bullet routing enters the hot path — the
 *   shell keeps one `bulletAtlas` and one `strip(name)` lookup whichever form
 *   built it. See docs/packs.md and the amendment's §1.4/§1.5.
 *
 * The `url === undefined` and legacy-grid branches are byte-identical to before.
 */
export async function bulletAtlas(url?: string, strips?: BulletSheetInput): Promise<Atlas> {
  if (strips !== undefined) {
    if (url === undefined) throw new Error('a self-describing bullet sheet needs a sheet URL');
    return nativeBulletAtlas(url, strips);
  }
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
  defineVariantAliases(atlas); // family variants alias the grid's base cells
  return atlas;
}

/**
 * Build the wholesale native bullet atlas: load the shared sheet, assert every
 * floor cell is covered, then `defineStrip` each entry (floor cells and pack-new
 * variants alike). The per-strip bounds / seam / saturation checks are the
 * loader's, measured on a real canvas (`packs/loader.ts`); this only wires the
 * geometry the manifest already shape-validated.
 */
async function nativeBulletAtlas(url: string, sheet: BulletSheetInput): Promise<Atlas> {
  const texture = await loadTexture(url);
  const { width, height } = texture.image as { width: number; height: number };
  const atlas = new Atlas(texture, width, height);

  const missing = BULLET_CELLS.filter((cell) => !(cell in sheet.strips));
  if (missing.length > 0) {
    throw new Error(
      `native bullet sheet "${url}" is missing floor cell(s) ${missing.join(', ')} — ` +
        `a strips sheet is the whole bullet atlas and must define every one of the ${BULLET_CELLS.length} built-in cells`,
    );
  }

  for (const [name, s] of Object.entries(sheet.strips)) {
    atlas.defineStrip(name, {
      x: s.x,
      y: s.y,
      frameW: s.frameW,
      frameH: s.frameH,
      frames: s.frames ?? 1,
      stride: s.stride ?? s.frameW,
      ticksPerFrame: s.ticksPerFrame ?? 1,
      mode: s.mode ?? 'once',
      color: s.color ?? 'tinted',
    });
  }
  // Any family variant the pack did not ship its own strip for falls back to its
  // base cell (covered above) — so the base campaign's variant names all resolve
  // even against a sheet that only reskinned the sixteen floor cells.
  defineVariantAliases(atlas);
  return atlas;
}

/** The ship sheet is a single square cell. The real art set must match it. */
export const SHIP_SIZE = 64;

/**
 * The ship atlas's region names, as `BULLET_CELLS` is the bullet sheet's. The
 * two sheets are separate namespaces: a character wears a ship region and
 * everything else wears a bullet cell, and a validator that pools them accepts
 * sprites the batch that actually draws the entity cannot resolve. Both
 * `define('ship', …)` sites below use this constant so it cannot drift.
 */
export const SHIP_CELLS = ['ship'] as const;

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
  atlas.define(SHIP_CELLS[0], { x: 0, y: 0, w: size, h: size });
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
export async function shipAtlas(url?: string, strip?: ShipStripInput): Promise<Atlas> {
  if (strip !== undefined) {
    if (url === undefined) throw new Error('a native ship strip needs a URL');
    const texture = await loadTexture(url);
    const { width, height } = texture.image as { width: number; height: number };
    const atlas = new Atlas(texture, width, height);
    // A native strip bank: the `ship` region is `defineStrip`ed at native size
    // and frame geometry. The engine draws frame 0 (idle) this round via the
    // back-compat `strip(name)`→frame-0 path; bank-by-input is deferred to the
    // input/laser round (no run-relative `viewTick` yet — see the amendment §6).
    atlas.defineStrip(SHIP_CELLS[0], {
      x: 0,
      y: 0,
      frameW: strip.frameW,
      frameH: strip.frameH,
      frames: strip.frames ?? 1,
      stride: strip.stride ?? strip.frameW,
      ticksPerFrame: strip.ticksPerFrame ?? 1,
      mode: strip.mode ?? 'once',
      color: strip.color ?? 'tinted',
    });
    return atlas;
  }

  if (url === undefined) return createShipAtlas();

  const atlas = await loadAtlas(url);
  if (atlas.width !== SHIP_SIZE || atlas.height !== SHIP_SIZE) {
    throw new Error(
      `ship sheet "${url}" is ${atlas.width}×${atlas.height}, ` +
        `expected ${SHIP_SIZE}×${SHIP_SIZE} (one ${SHIP_SIZE}×${SHIP_SIZE} cell)`,
    );
  }
  atlas.define(SHIP_CELLS[0], { x: 0, y: 0, w: atlas.width, h: atlas.height });
  return atlas;
}

/* ------------------------------------------------------------------ */
/* The animation-strip fx floor (rule 9)                              */
/* ------------------------------------------------------------------ */

/**
 * Per-frame transparent margin inside an fx frame, each side — the seam law
 * generalized to a strip (identical to the bullet grid's 2px). A frame's
 * painted extent must clear `frameW − 2·FX_PAD` / `frameH − 2·FX_PAD` or it
 * bleeds into the next frame under linear sampling. `procedural.test.ts` holds
 * every `FX_STRIPS` frame against this the way it holds `CELL_ART`.
 */
export const FX_PAD = 2;

type StripDraw = (ctx: Ctx, frame: number, cx: number, cy: number) => void;

/**
 * One procedural fx strip: its geometry, its place on the shared fx sheet, and
 * how to paint each frame. `frameExtent` re-derives the painted box from the
 * SAME arguments the painter uses (the `CELL_ART` discipline, now per frame), so
 * a drift between the declared budget and the paint is a test failure, not a
 * silent seam bleed. All strips are `tinted`: the orange of an explosion comes
 * from the effect spec's tint, so the floor stays recolourable (rule 9).
 */
export interface FxStrip {
  frameW: number;
  frameH: number;
  frames: number;
  ticksPerFrame: number;
  mode: StripMode;
  color: StripColor;
  /** Frame 0 origin on the shared fx sheet, px. */
  sheetX: number;
  sheetY: number;
  /** Px between frame origins; equals `frameW` (frames laid out horizontally). */
  stride: number;
  /** Painted bounding box of frame `f`, px, from the painter's own radii. */
  frameExtent: (frame: number) => { w: number; h: number };
  draw: StripDraw;
}

// --- burst: an enemy-death flash. Bright core grows then fades; a ring expands.
const BURST_FRAMES = 8;
function burstCore(f: number): number {
  return 7 + 11 * (f / (BURST_FRAMES - 1));
}
function burstRing(f: number): number {
  return 8 + 18 * (f / (BURST_FRAMES - 1));
}
const BURST_RING_THICK = 3;

// --- burst.big: boss/player death. As burst plus a second offset ring.
const BIG_FRAMES = 12;
function bigCore(f: number): number {
  return 10 + 16 * (f / (BIG_FRAMES - 1));
}
function bigRing1(f: number): number {
  return 10 + 30 * (f / (BIG_FRAMES - 1));
}
function bigRing2(f: number): number {
  return 6 + 22 * (f / (BIG_FRAMES - 1));
}
const BIG_RING1_THICK = 4;
const BIG_RING2_THICK = 3;
const BIG_RING2_OFFSET = 4;

// --- pulse: a looping pickup glow whose core ratio breathes 0.2 → 0.6 → 0.2.
const PULSE_FRAMES = 6;
const PULSE_RADIUS = 13;
function pulseRatio(f: number): number {
  const half = PULSE_FRAMES / 2;
  const tri = f <= half ? f / half : (PULSE_FRAMES - f) / half;
  return 0.2 + 0.4 * tri;
}

// --- missile.pop.*: a missile detonation airburst — a bright core flash and an
// expanding ring, tinted orange by the effect spec (the floor stays white +
// tint, rule 9). Three tiers a missile firer picks by threat; radial (no
// orientation, like `burst`), and MISSILE-OWNED — distinct from `burst` /
// `burst.big`, which stay generic enemy/boss/player death, so a missile's blast
// art never plays on a trash kill (design §c.4). Every tier shares a 36×28 frame;
// radii are capped so the ring diameter clears the 28px cross-axis seam pad.
const POP_FRAME_W = 36;
const POP_FRAME_H = 28;
const POP_RING_THICK = 3;
function popRing(f: number, frames: number, ringMax: number): number {
  return 2 + (ringMax - 2) * (frames <= 1 ? 0 : f / (frames - 1));
}
function popCore(f: number, frames: number, coreMax: number): number {
  const t = frames <= 1 ? 0 : f / (frames - 1);
  return coreMax * (0.5 + 0.5 * t); // grows as the fireball opens
}

/**
 * One `missile.pop.*` tier as an `FxStrip`. `frameExtent` re-derives its box from
 * the SAME radii the painter uses (the `CELL_ART` discipline, per frame), and the
 * radii are chosen so the ring's outer diameter clears `frameH − 2·FX_PAD` = 24
 * on every frame — capped by the cross-axis, the tighter of the two. `once`, so
 * a single particle whose `life` is `stripLength` dies as the last frame finishes
 * (rule 8) — that coupling is asserted when a content stage registers the effect.
 */
function popStrip(
  frames: number,
  tpf: number,
  coreMax: number,
  ringMax: number,
  sheetY: number,
): FxStrip {
  return {
    frameW: POP_FRAME_W,
    frameH: POP_FRAME_H,
    frames,
    ticksPerFrame: tpf,
    mode: 'once',
    color: 'tinted',
    sheetX: 0,
    sheetY,
    stride: POP_FRAME_W,
    frameExtent: (f) => {
      const e = Math.max(
        popCore(f, frames, coreMax) * 2,
        (popRing(f, frames, ringMax) + POP_RING_THICK / 2) * 2,
      );
      return { w: e, h: e };
    },
    draw: (ctx, f, cx, cy) => {
      const t = frames <= 1 ? 0 : f / (frames - 1);
      ctx.save();
      ctx.globalAlpha = 0.85 * (1 - 0.55 * t);
      ring(ctx, cx, cy, popRing(f, frames, ringMax), POP_RING_THICK);
      ctx.globalAlpha = 1 - 0.8 * t;
      orb(ctx, cx, cy, popCore(f, frames, coreMax), 0.4);
      ctx.restore();
    },
  };
}

export const FX_STRIPS: Record<string, FxStrip> = {
  burst: {
    frameW: 64,
    frameH: 64,
    frames: BURST_FRAMES,
    ticksPerFrame: 3,
    mode: 'once',
    color: 'tinted',
    sheetX: 0,
    sheetY: 0,
    stride: 64,
    frameExtent: (f) => {
      const e = Math.max(burstCore(f) * 2, (burstRing(f) + BURST_RING_THICK / 2) * 2);
      return { w: e, h: e };
    },
    draw: (ctx, f, cx, cy) => {
      const t = f / (BURST_FRAMES - 1);
      ctx.save();
      ctx.globalAlpha = 0.85 * (1 - 0.4 * t);
      ring(ctx, cx, cy, burstRing(f), BURST_RING_THICK);
      ctx.globalAlpha = 1 - 0.7 * t;
      orb(ctx, cx, cy, burstCore(f), 0.5);
      ctx.restore();
    },
  },
  'burst.big': {
    frameW: 96,
    frameH: 96,
    frames: BIG_FRAMES,
    ticksPerFrame: 3,
    mode: 'once',
    color: 'tinted',
    sheetX: 0,
    sheetY: 64,
    stride: 96,
    frameExtent: (f) => {
      const e = Math.max(
        bigCore(f) * 2,
        (bigRing1(f) + BIG_RING1_THICK / 2) * 2,
        (BIG_RING2_OFFSET + bigRing2(f) + BIG_RING2_THICK / 2) * 2,
      );
      return { w: e, h: e };
    },
    draw: (ctx, f, cx, cy) => {
      const t = f / (BIG_FRAMES - 1);
      ctx.save();
      ctx.globalAlpha = 0.6 * (1 - 0.5 * t);
      ring(ctx, cx + BIG_RING2_OFFSET, cy - BIG_RING2_OFFSET, bigRing2(f), BIG_RING2_THICK);
      ctx.globalAlpha = 0.85 * (1 - 0.4 * t);
      ring(ctx, cx, cy, bigRing1(f), BIG_RING1_THICK);
      ctx.globalAlpha = 1 - 0.7 * t;
      orb(ctx, cx, cy, bigCore(f), 0.5);
      ctx.restore();
    },
  },
  pulse: {
    frameW: 32,
    frameH: 32,
    frames: PULSE_FRAMES,
    ticksPerFrame: 4,
    mode: 'loop',
    color: 'tinted',
    sheetX: 0,
    sheetY: 160,
    stride: 32,
    frameExtent: () => ({ w: PULSE_RADIUS * 2, h: PULSE_RADIUS * 2 }),
    draw: (ctx, f, cx, cy) => {
      orb(ctx, cx, cy, PULSE_RADIUS, pulseRatio(f));
    },
  },
  // The three missile detonation tiers, on their own rows below `pulse`. Frame
  // counts match the BulletPack `Exp` files a reskin drops in (tiny carries the
  // MOST frames, 11; big the fewest, 8 — counter-intuitive, but the floor tracks
  // the file so the import round's pixels land frame-for-frame). `once`.
  'missile.pop.tiny': popStrip(11, 2, 6, 9, 192),
  'missile.pop.mid': popStrip(9, 2, 7, 10, 220),
  'missile.pop.big': popStrip(8, 3, 9, 10, 248),
};

/** The names the fx floor guarantees, mirroring `BULLET_CELLS` for the fx sheet. */
export const FX_CELLS = Object.keys(FX_STRIPS) as readonly string[];

/** Shared fx-sheet dimensions, derived from the table so the two cannot drift. */
export const FX_SHEET_W = Math.max(...Object.values(FX_STRIPS).map((s) => s.sheetX + s.frames * s.stride));
export const FX_SHEET_H = Math.max(...Object.values(FX_STRIPS).map((s) => s.sheetY + s.frameH));

/**
 * Render the fx sheet: every `FX_STRIPS` strip's frames laid out horizontally
 * on one shared canvas, each on its own row. White + tint like the bullet sheet
 * (the orange of a burst is the effect spec's tint), so one greyscale sheet
 * serves every colour and the saturation gate holds.
 */
export function createEffectAtlas(): Atlas {
  const { el, ctx } = canvas(FX_SHEET_W, FX_SHEET_H);

  for (const s of Object.values(FX_STRIPS)) {
    for (let f = 0; f < s.frames; f++) {
      const cx = s.sheetX + f * s.stride + s.frameW / 2;
      const cy = s.sheetY + s.frameH / 2;
      s.draw(ctx, f, cx, cy);
    }
  }

  const texture = new THREE.CanvasTexture(el);
  texture.magFilter = THREE.LinearFilter; // generated art is smooth, not pixel art
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace; // display-referred; see atlas.ts
  texture.flipY = false;
  texture.needsUpdate = true;

  const atlas = new Atlas(texture, FX_SHEET_W, FX_SHEET_H);
  defineFxStrips(atlas);
  return atlas;
}

/** Wire every `FX_STRIPS` name onto `atlas` as a `Strip`. Shared by both branches. */
function defineFxStrips(atlas: Atlas): void {
  for (const [name, s] of Object.entries(FX_STRIPS)) {
    atlas.defineStrip(name, {
      x: s.sheetX,
      y: s.sheetY,
      frameW: s.frameW,
      frameH: s.frameH,
      frames: s.frames,
      stride: s.stride,
      ticksPerFrame: s.ticksPerFrame,
      mode: s.mode,
      color: s.color,
    });
  }
}

/**
 * A pack's `assets.effects` strip, resolved: the winning file's URL plus the
 * geometry the manifest declared. The structural twin of the manifest's
 * `PackStrip`, redeclared here so `render/` need not import `packs/`. Each strip
 * is its OWN file (frames laid horizontally, frame 0 leftmost — no x/y), unlike a
 * bullet sheet's packed strips, which is why fx are composited from many files.
 */
export interface EffectStripInput {
  url: string;
  frames: number;
  frameW: number;
  frameH: number;
  ticksPerFrame?: number;
  mode?: StripMode;
  color?: StripColor;
}

/**
 * The fx sheet, generated, loaded, or composited from a pack — symmetric to
 * `bulletAtlas(url?, strips?)`.
 *
 * Three forms, one atlas:
 * - `effectAtlas()` — the procedural fx floor (rule 9): `burst`, `burst.big`,
 *   `pulse` at their native sizes.
 * - `effectAtlas(url)` — one combined `FX_SHEET_W`×`FX_SHEET_H` sheet loaded and
 *   dimension-checked (the direct-import seam), naming both figures on a mismatch.
 * - `effectAtlas(undefined, packStrips)` — a pack's per-file `assets.effects`
 *   reskin. Because each pack strip is its OWN file but the fx atlas is one texture
 *   / one batch (the same single-texture rule bullets follow), the strips are
 *   COMPOSITED onto one shared canvas: a floor name the pack reskins takes the
 *   pack's native (baked, animated) pixels, a floor name it leaves alone is
 *   painted procedurally, and any pack-new name is blitted too. So `burst`,
 *   `burst.big` and `pulse` always resolve on the returned atlas (`fxAtlas.has`
 *   stays true), procedural when absent from the pack. Warn-only reskin material:
 *   the loader already fetched and gated these files.
 */
export async function effectAtlas(
  url?: string,
  packStrips?: Record<string, EffectStripInput>,
): Promise<Atlas> {
  if (packStrips !== undefined && Object.keys(packStrips).length > 0) {
    return nativeEffectAtlas(packStrips);
  }
  if (url === undefined) return createEffectAtlas();

  const atlas = await loadAtlas(url);
  if (atlas.width !== FX_SHEET_W || atlas.height !== FX_SHEET_H) {
    throw new Error(
      `fx sheet "${url}" is ${atlas.width}×${atlas.height}, expected ${FX_SHEET_W}×${FX_SHEET_H}`,
    );
  }
  defineFxStrips(atlas);
  return atlas;
}

/** One row of the composited fx sheet: either a procedural painter or a blit. */
interface FxRow {
  name: string;
  frameW: number;
  frameH: number;
  frames: number;
  stride: number;
  ticksPerFrame: number;
  mode: StripMode;
  color: StripColor;
  /** A procedural painter (floor strip left un-reskinned), else a loaded image. */
  paint?: StripDraw;
  image?: CanvasImageSource;
}

/** Resolve a pack strip's file to a blittable row (frames laid at `frameW`). */
async function packFxRow(name: string, s: EffectStripInput): Promise<FxRow> {
  const texture = await loadTexture(s.url);
  return {
    name,
    frameW: s.frameW,
    frameH: s.frameH,
    frames: s.frames,
    stride: s.frameW, // a per-file strip lays its frames at frameW spacing
    ticksPerFrame: s.ticksPerFrame ?? 1,
    mode: s.mode ?? 'once',
    color: s.color ?? 'tinted',
    image: texture.image as CanvasImageSource,
  };
}

/**
 * Composite a pack's per-file `assets.effects` strips onto one shared fx texture,
 * so the fx atlas stays a single texture / single batch. Floor names the pack did
 * not reskin are painted procedurally; the pack's files are blitted at their
 * native size; every strip lands on its own row, frames laid horizontally.
 */
async function nativeEffectAtlas(packStrips: Record<string, EffectStripInput>): Promise<Atlas> {
  const rows: FxRow[] = [];

  // Floor names first (procedural unless the pack reskinned them), in the floor's
  // own order, so `burst`/`burst.big`/`pulse` always resolve on the result.
  for (const [name, s] of Object.entries(FX_STRIPS)) {
    const over = packStrips[name];
    if (over) {
      rows.push(await packFxRow(name, over));
    } else {
      rows.push({
        name,
        frameW: s.frameW,
        frameH: s.frameH,
        frames: s.frames,
        stride: s.stride,
        ticksPerFrame: s.ticksPerFrame,
        mode: s.mode,
        color: s.color,
        paint: s.draw,
      });
    }
  }
  // Pack-new fx names (not a floor strip): a content effect spec that names one
  // resolves; the base game draws only the floor names, so these are unreached
  // presentation until a content pack fires them.
  for (const name of Object.keys(packStrips)) {
    if (name in FX_STRIPS) continue;
    const s = packStrips[name];
    if (s !== undefined) rows.push(await packFxRow(name, s));
  }

  // Lay every strip on its own row; sheet width is the widest row.
  const rowY: number[] = [];
  let sheetW = 1;
  let sheetH = 0;
  for (const row of rows) {
    rowY.push(sheetH);
    sheetW = Math.max(sheetW, row.frames * row.stride);
    sheetH += row.frameH;
  }
  sheetH = Math.max(1, sheetH);

  const { el, ctx } = canvas(sheetW, sheetH);
  rows.forEach((row, i) => {
    const y = rowY[i] ?? 0;
    if (row.image) {
      ctx.drawImage(row.image, 0, y);
    } else if (row.paint) {
      for (let f = 0; f < row.frames; f++) {
        row.paint(ctx, f, f * row.stride + row.frameW / 2, y + row.frameH / 2);
      }
    }
  });

  const texture = new THREE.CanvasTexture(el);
  // Native baked fx art is pixel art; nearest keeps it crisp (loadTexture's floor).
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace; // display-referred; see atlas.ts
  texture.flipY = false;
  texture.needsUpdate = true;

  const atlas = new Atlas(texture, sheetW, sheetH);
  rows.forEach((row, i) => {
    atlas.defineStrip(row.name, {
      x: 0,
      y: rowY[i] ?? 0,
      frameW: row.frameW,
      frameH: row.frameH,
      frames: row.frames,
      stride: row.stride,
      ticksPerFrame: row.ticksPerFrame,
      mode: row.mode,
      color: row.color,
    });
  });
  return atlas;
}

/* ------------------------------------------------------------------ */
/* The laser body + cap floor (rule 9)                                */
/* ------------------------------------------------------------------ */

/**
 * A laser draws as a two-element composite — a **body** strip stretched or tiled
 * from muzzle to tip, and a **cap** flash at the tip while it can kill — resolved
 * through the render-side skin registry (`render/laser-skin.ts`). This floor is
 * the never-blocked half of that: a placeholder body and cap for every strip a
 * base skin names, so the game draws a beam with zero assets, and a BulletPack
 * reskin later swaps the pixels through `laserAtlas(url, strips)` without the sim
 * ever learning a beam has an anatomy.
 *
 * Like the fx floor, every strip is `tinted` (rule 9): the colour is the content
 * tint, so `LANCE` stays pink and a warm boss beam stays warm until baked pixels
 * load, at which point the skin drives the tint to white so baked colour shows
 * unmultiplied (the shell decides, `main.ts`).
 */
export type LaserRole = 'body' | 'cap';

export interface LaserStripGeo {
  role: LaserRole;
  frameW: number;
  frameH: number;
  frames: number;
  ticksPerFrame: number;
  mode: StripMode;
  color: StripColor;
  /** Px between frame origins; equals `frameW` (frames laid horizontally). */
  stride: number;
  /** Painted box of frame `f`, px, re-derived from the painter's own dimensions. */
  frameExtent: (frame: number) => { w: number; h: number };
  draw: StripDraw;
}

// Body geometry. `coreH < frameH − 2·FX_PAD` clears the cross-axis seam pad; the
// on-beam extent reaches the full `frameW` for seamless tiling (a 1-frame strip,
// so no animation neighbour to bleed into — the on-beam axis is exempt from the
// pad by construction, asserted per-role in `procedural.test.ts`).
const LASER_BODY_W = 48;
const LASER_BODY_H = 24;
const LASER_BODY_CORE = 16;

// Cap geometry: a small radial tip flash that flickers (a 3-frame loop) while the
// beam persists — no one-shot bookkeeping (rule 8). Both axes clear the pad.
const LASER_CAP_W = 28;
const LASER_CAP_H = 28;
const LASER_CAP_RADII = [9, 11, 9] as const;

function bodyStrip(): LaserStripGeo {
  return {
    role: 'body',
    frameW: LASER_BODY_W,
    frameH: LASER_BODY_H,
    frames: 1,
    ticksPerFrame: 1,
    mode: 'once',
    color: 'tinted',
    stride: LASER_BODY_W,
    frameExtent: () => ({ w: LASER_BODY_W, h: LASER_BODY_CORE }),
    draw: (ctx, _f, cx, cy) => laserBody(ctx, cx, cy, LASER_BODY_W, LASER_BODY_CORE),
  };
}

function capStrip(): LaserStripGeo {
  return {
    role: 'cap',
    frameW: LASER_CAP_W,
    frameH: LASER_CAP_H,
    frames: LASER_CAP_RADII.length,
    ticksPerFrame: 3,
    mode: 'loop',
    color: 'tinted',
    stride: LASER_CAP_W,
    frameExtent: (f) => {
      const r = LASER_CAP_RADII[f] ?? LASER_CAP_RADII[0];
      return { w: r * 2, h: r * 2 };
    },
    draw: (ctx, f, cx, cy) => orb(ctx, cx, cy, LASER_CAP_RADII[f] ?? LASER_CAP_RADII[0], 0.3),
  };
}

/**
 * The 11 laser strips — 8 bodies + 3 caps — mirroring the 11 BulletPack laser
 * files a reskin supplies. The names are the atlas ledger the base skins in
 * `render/laser-skin.ts` reference; `laser-skin.test.ts` cross-checks that every
 * skin's `body`/`cap` is one of these and that all 11 are named.
 */
export const LASER_STRIPS: Record<string, LaserStripGeo> = {
  'beam.v3': bodyStrip(),
  'beam.slim': bodyStrip(),
  'beam.heavy': bodyStrip(),
  'beam.blue': bodyStrip(),
  'beam.cyan': bodyStrip(),
  'beam.warm': bodyStrip(),
  'beam.stream': bodyStrip(),
  'beam.v3.stream': bodyStrip(),
  'cap.v3': capStrip(),
  'cap.green': capStrip(),
  'cap.yellow': capStrip(),
};

/** Every laser strip name, `BULLET_CELLS`'s companion for the laser sheet. */
export const LASER_STRIP_CELLS = Object.keys(LASER_STRIPS) as readonly string[];

/** The body strip names (8) and cap strip names (3), for the skin-ledger test. */
export const LASER_BODY_CELLS = Object.entries(LASER_STRIPS)
  .filter(([, s]) => s.role === 'body')
  .map(([name]) => name) as readonly string[];
export const LASER_CAP_CELLS = Object.entries(LASER_STRIPS)
  .filter(([, s]) => s.role === 'cap')
  .map(([name]) => name) as readonly string[];

/**
 * Where each strip sits on the shared laser sheet: one strip per row, frames
 * laid horizontally, sheet width the widest row. Derived from the table so the
 * layout and the dimensions cannot drift (the fx sheet's discipline).
 */
function laserLayout(): {
  positions: Record<string, { x: number; y: number }>;
  width: number;
  height: number;
} {
  const positions: Record<string, { x: number; y: number }> = {};
  let width = 1;
  let y = 0;
  for (const [name, s] of Object.entries(LASER_STRIPS)) {
    positions[name] = { x: 0, y };
    width = Math.max(width, s.frames * s.stride);
    y += s.frameH;
  }
  return { positions, width, height: Math.max(1, y) };
}

export const LASER_SHEET = laserLayout();
export const LASER_SHEET_W = LASER_SHEET.width;
export const LASER_SHEET_H = LASER_SHEET.height;

/** Wire every `LASER_STRIPS` name onto `atlas` as a `Strip`. Shared by both branches. */
function defineLaserStrips(atlas: Atlas): void {
  for (const [name, s] of Object.entries(LASER_STRIPS)) {
    const p = LASER_SHEET.positions[name]!;
    atlas.defineStrip(name, {
      x: p.x,
      y: p.y,
      frameW: s.frameW,
      frameH: s.frameH,
      frames: s.frames,
      stride: s.stride,
      ticksPerFrame: s.ticksPerFrame,
      mode: s.mode,
      color: s.color,
    });
  }
}

/**
 * Render the procedural laser sheet: every `LASER_STRIPS` strip's frames laid
 * out on one shared canvas, each on its own row. White + tint, like the fx sheet
 * (the colour of a beam is the content's tint), so one greyscale sheet serves
 * every beam colour and the saturation gate holds.
 */
export function createLaserAtlas(): Atlas {
  const { positions, width, height } = LASER_SHEET;
  const { el, ctx } = canvas(width, height);

  for (const [name, s] of Object.entries(LASER_STRIPS)) {
    const p = positions[name]!;
    for (let f = 0; f < s.frames; f++) {
      const cx = p.x + f * s.stride + s.frameW / 2;
      const cy = p.y + s.frameH / 2;
      s.draw(ctx, f, cx, cy);
    }
  }

  const texture = new THREE.CanvasTexture(el);
  texture.magFilter = THREE.LinearFilter; // generated art is smooth, not pixel art
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace; // display-referred; see atlas.ts
  texture.flipY = false;
  texture.needsUpdate = true;

  const atlas = new Atlas(texture, width, height);
  defineLaserStrips(atlas);
  return atlas;
}

/**
 * A pack's `assets.lasers` strip, resolved: the winning file's URL plus the
 * geometry the manifest declared. The structural twin of the fx `EffectStripInput`
 * (one file per strip, frames laid horizontally, frame 0 leftmost — no x/y),
 * redeclared here so `render/` need not import `packs/`. Baked native art, so
 * `color` defaults `'baked'` — the reskin path, the saturation gate skipped.
 */
export interface LaserStripInput {
  url: string;
  frames: number;
  frameW: number;
  frameH: number;
  ticksPerFrame?: number;
  mode?: StripMode;
  color?: StripColor;
}

/**
 * The laser sheet, generated, loaded, or composited from a pack — symmetric to
 * `effectAtlas(url?, packStrips?)`.
 *
 * - `laserAtlas()` — the procedural body+cap floor (rule 9).
 * - `laserAtlas(url)` — one combined `LASER_SHEET_W`×`LASER_SHEET_H` sheet loaded
 *   and dimension-checked, the direct-import seam, naming both figures on a
 *   mismatch (the point `bulletAtlas`/`effectAtlas` make: a wrong-sized sheet
 *   silently repoints every strip at a crop of the wrong shape).
 * - `laserAtlas(undefined, packStrips)` — a pack's per-file `assets.lasers`
 *   reskin, composited onto one shared texture (one batch is one texture): a
 *   strip the pack reskins takes its baked pixels, a strip it leaves alone is
 *   painted procedurally, and any pack-new name is blitted too — so every base
 *   skin's body/cap always resolves.
 */
export async function laserAtlas(
  url?: string,
  packStrips?: Record<string, LaserStripInput>,
): Promise<Atlas> {
  if (packStrips !== undefined && Object.keys(packStrips).length > 0) {
    return nativeLaserAtlas(packStrips);
  }
  if (url === undefined) return createLaserAtlas();

  const atlas = await loadAtlas(url);
  if (atlas.width !== LASER_SHEET_W || atlas.height !== LASER_SHEET_H) {
    throw new Error(
      `laser sheet "${url}" is ${atlas.width}×${atlas.height}, expected ${LASER_SHEET_W}×${LASER_SHEET_H}`,
    );
  }
  defineLaserStrips(atlas);
  return atlas;
}

/** One row of the composited laser sheet: either a procedural painter or a blit. */
interface LaserRow {
  name: string;
  frameW: number;
  frameH: number;
  frames: number;
  stride: number;
  ticksPerFrame: number;
  mode: StripMode;
  color: StripColor;
  paint?: StripDraw;
  image?: CanvasImageSource;
}

/** Resolve a pack strip's file to a blittable row (frames laid at `frameW`). */
async function packLaserRow(name: string, s: LaserStripInput): Promise<LaserRow> {
  const texture = await loadTexture(s.url);
  return {
    name,
    frameW: s.frameW,
    frameH: s.frameH,
    frames: s.frames,
    stride: s.frameW,
    ticksPerFrame: s.ticksPerFrame ?? 1,
    mode: s.mode ?? 'loop',
    color: s.color ?? 'baked',
    image: texture.image as CanvasImageSource,
  };
}

/**
 * Composite a pack's per-file `assets.lasers` strips onto one shared laser
 * texture, so the laser atlas stays a single texture / two batches. Floor names
 * the pack did not reskin are painted procedurally; the pack's files are blitted
 * at their native size; every strip lands on its own row, frames horizontal.
 */
async function nativeLaserAtlas(packStrips: Record<string, LaserStripInput>): Promise<Atlas> {
  const rows: LaserRow[] = [];

  // Floor names first (procedural unless reskinned), in the floor's own order,
  // so every base skin's body/cap always resolves on the result.
  for (const [name, s] of Object.entries(LASER_STRIPS)) {
    const over = packStrips[name];
    if (over) {
      rows.push(await packLaserRow(name, over));
    } else {
      rows.push({
        name,
        frameW: s.frameW,
        frameH: s.frameH,
        frames: s.frames,
        stride: s.stride,
        ticksPerFrame: s.ticksPerFrame,
        mode: s.mode,
        color: s.color,
        paint: s.draw,
      });
    }
  }
  // Pack-new laser names (not a floor strip): a content pack that fires one
  // resolves; the base game draws only the floor names.
  for (const name of Object.keys(packStrips)) {
    if (name in LASER_STRIPS) continue;
    const s = packStrips[name];
    if (s !== undefined) rows.push(await packLaserRow(name, s));
  }

  const rowY: number[] = [];
  let sheetW = 1;
  let sheetH = 0;
  for (const row of rows) {
    rowY.push(sheetH);
    sheetW = Math.max(sheetW, row.frames * row.stride);
    sheetH += row.frameH;
  }
  sheetH = Math.max(1, sheetH);

  const { el, ctx } = canvas(sheetW, sheetH);
  rows.forEach((row, i) => {
    const y = rowY[i] ?? 0;
    if (row.image) {
      ctx.drawImage(row.image, 0, y);
    } else if (row.paint) {
      for (let f = 0; f < row.frames; f++) {
        row.paint(ctx, f, f * row.stride + row.frameW / 2, y + row.frameH / 2);
      }
    }
  });

  const texture = new THREE.CanvasTexture(el);
  // Native baked laser art is pixel art; nearest keeps it crisp (loadTexture's floor).
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace; // display-referred; see atlas.ts
  texture.flipY = false;
  texture.needsUpdate = true;

  const atlas = new Atlas(texture, sheetW, sheetH);
  rows.forEach((row, i) => {
    atlas.defineStrip(row.name, {
      x: 0,
      y: rowY[i] ?? 0,
      frameW: row.frameW,
      frameH: row.frameH,
      frames: row.frames,
      stride: row.stride,
      ticksPerFrame: row.ticksPerFrame,
      mode: row.mode,
      color: row.color,
    });
  });
  return atlas;
}

/* ------------------------------------------------------------------ */
/* The missile body floor (rule 9)                                    */
/* ------------------------------------------------------------------ */

/**
 * A missile is an ordinary strip bullet drawn on its OWN atlas (the sim routes
 * by `b.missile !== undefined`, never by cell name — the render layer cannot be
 * imported by the sim, so the sim marks the missile and the shell resolves the
 * skin). The body is a single animated strip, so its "skin" is just
 * `b.style.sprite` resolved here — no two-part anatomy and therefore no skin
 * registry, unlike a laser (design §c.1).
 *
 * This floor is the never-blocked half: a placeholder body for every strip a
 * base missile spec names, so the game draws a homing writ with zero assets, and
 * a BulletPack reskin later swaps the pixels through `missileAtlas(url)` — the
 * `url` branch is here now, the pack-per-file `assets.missiles` composite is the
 * import round's (design §g.5).
 *
 * Every strip is `tinted` (rule 9): a warm boss missile is coloured by the
 * content tint until baked pixels load. Bodies are painted **nose-EAST (+x)**
 * (rule 7 — an oriented sprite runs +x, and `orientToHeading` rotates the whole
 * quad by the heading), so an imported nose-up pack frame rotated +90° at import
 * lands on the same proportions.
 */
export interface MissileStripGeo {
  frameW: number;
  frameH: number;
  frames: number;
  ticksPerFrame: number;
  mode: StripMode;
  color: StripColor;
  /** Px between frame origins; equals `frameW` (frames laid horizontally). */
  stride: number;
  /** Painted box of frame `f`, px, re-derived from the painter's own dimensions. */
  frameExtent: (frame: number) => { w: number; h: number };
  draw: StripDraw;
}

/**
 * A missile body, painted nose-EAST (+x, rule 7): a fuselage with a pointed nose
 * cone at +x and an age-clocked thruster glow at the tail (-x) that pulses across
 * the strip's `loop` frames — the "banking pose" reinterpreted as a thruster loop
 * (design §c.3), so a live body reads without a turn-driven frame axis. The whole
 * silhouette stays inside `len × thick` (the fuselage reaches the box every frame;
 * the nozzle glow pulses WITHIN it), so `frameExtent` is that box and no frame
 * bleeds the inter-frame seam.
 */
function missileBody(
  ctx: Ctx,
  cx: number,
  cy: number,
  len: number,
  thick: number,
  frame: number,
  frames: number,
): void {
  const half = len / 2;
  const ht = thick / 2;
  const noseTip = cx + half; // +x
  const tail = cx - half; // -x
  const noseLen = Math.min(len * 0.34, thick * 1.4);
  const shoulderX = noseTip - noseLen;

  // Fuselage: tail edge → shoulder → nose tip, with a soft cross-axis gradient so
  // even a 3px-thick dart reads as a lit tube rather than a flat bar.
  const g = ctx.createLinearGradient(0, cy - ht, 0, cy + ht);
  g.addColorStop(0, 'rgba(255,255,255,0.18)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.95)');
  g.addColorStop(1, 'rgba(255,255,255,0.18)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(tail, cy - ht);
  ctx.lineTo(shoulderX, cy - ht);
  ctx.lineTo(noseTip, cy);
  ctx.lineTo(shoulderX, cy + ht);
  ctx.lineTo(tail, cy + ht);
  ctx.closePath();
  ctx.fill();

  // Thruster nozzle: a bright glow at the very tail whose radius pulses across the
  // loop frames (brightest at frame 0), contained in the fuselage back so neither
  // the silhouette nor `frameExtent` changes frame to frame.
  const phase = frames > 1 ? frame / frames : 0;
  const pulse = 0.5 + 0.5 * Math.cos(phase * Math.PI * 2);
  const nozzleR = Math.max(1, Math.min(ht, len * 0.12) * (0.55 + 0.45 * pulse));
  orb(ctx, tail + nozzleR, cy, nozzleR, 0.15);
}

/**
 * The massive missile — the final boss's signature writ. A fatter fuselage than
 * `missileBody`, a warhead band, tail fins, and TWIN thruster tongues that pulse
 * out of phase across its 17 frames. Same box discipline: everything inside
 * `len × thick`, so `frameExtent` is the box.
 */
function missileMassive(
  ctx: Ctx,
  cx: number,
  cy: number,
  len: number,
  thick: number,
  frame: number,
  frames: number,
): void {
  const half = len / 2;
  const ht = thick / 2;
  const noseTip = cx + half;
  const tail = cx - half;
  const noseLen = len * 0.3;
  const shoulderX = noseTip - noseLen;

  // Fins: two triangles at the tail, cross-axis, inside the box.
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(tail, cy + s * ht);
    ctx.lineTo(tail + len * 0.22, cy + s * ht * 0.35);
    ctx.lineTo(tail + len * 0.14, cy + s * ht * 0.35);
    ctx.closePath();
    ctx.fill();
  }

  // Fuselage.
  const g = ctx.createLinearGradient(0, cy - ht, 0, cy + ht);
  g.addColorStop(0, 'rgba(255,255,255,0.22)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.95)');
  g.addColorStop(1, 'rgba(255,255,255,0.22)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(tail + len * 0.06, cy - ht * 0.78);
  ctx.lineTo(shoulderX, cy - ht * 0.78);
  ctx.lineTo(noseTip, cy);
  ctx.lineTo(shoulderX, cy + ht * 0.78);
  ctx.lineTo(tail + len * 0.06, cy + ht * 0.78);
  ctx.closePath();
  ctx.fill();

  // Warhead band: a brighter ring near the nose shoulder.
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = Math.max(1, thick * 0.08);
  ctx.beginPath();
  ctx.moveTo(shoulderX, cy - ht * 0.7);
  ctx.lineTo(shoulderX, cy + ht * 0.7);
  ctx.stroke();

  // Twin thruster tongues, pulsing out of phase across the 17-frame loop.
  const phase = frames > 1 ? frame / frames : 0;
  for (const s of [-1, 1]) {
    const p = 0.5 + 0.5 * Math.cos(phase * Math.PI * 2 + (s > 0 ? Math.PI : 0));
    const r = Math.max(1, ht * 0.34 * (0.55 + 0.45 * p));
    orb(ctx, tail + r, cy + s * ht * 0.32, r, 0.12);
  }
}

/** A 5-frame body strip (12 of these): a thruster-loop flicker clocked off age. */
function bodyGeo(frameW: number, frameH: number): MissileStripGeo {
  const len = frameW - 2 * FX_PAD;
  const thick = frameH - 2 * FX_PAD;
  return {
    frameW,
    frameH,
    frames: 5,
    ticksPerFrame: 3,
    mode: 'loop',
    color: 'tinted',
    stride: frameW,
    frameExtent: () => ({ w: len, h: thick }),
    draw: (ctx, f, cx, cy) => missileBody(ctx, cx, cy, len, thick, f, 5),
  };
}

/** The 17-frame massive strip: a slower twin-thruster loop. */
function massiveGeo(frameW: number, frameH: number): MissileStripGeo {
  const len = frameW - 2 * FX_PAD;
  const thick = frameH - 2 * FX_PAD;
  return {
    frameW,
    frameH,
    frames: 17,
    ticksPerFrame: 2,
    mode: 'loop',
    color: 'tinted',
    stride: frameW,
    frameExtent: () => ({ w: len, h: thick }),
    draw: (ctx, f, cx, cy) => missileMassive(ctx, cx, cy, len, thick, f, 17),
  };
}

/**
 * The 13 missile body strips — 12 `strip5` + 1 `strip17` — mirroring the 13
 * BulletPack missile files a reskin supplies. Frame sizes are the nose-EAST
 * (+x) proportions the pack's nose-up frames land on after the +90° import
 * rotation (rule 7). `procedural.test.ts` holds every frame against the seam
 * pad; the reachability collectors (a later stage) assert every one is fired.
 */
export const MISSILE_STRIPS: Record<string, MissileStripGeo> = {
  'missile.0': bodyGeo(21, 9),
  'missile.1': bodyGeo(22, 7),
  'missile.2': bodyGeo(21, 12),
  'missile.3': bodyGeo(22, 12),
  'missile.4': bodyGeo(23, 17),
  'missile.5': bodyGeo(27, 12),
  'missile.6': bodyGeo(28, 15),
  'missile.7': bodyGeo(28, 15),
  'missile.8': bodyGeo(25, 13),
  'missile.9': bodyGeo(24, 13),
  'missile.10': bodyGeo(24, 13),
  'missile.11': bodyGeo(18, 13),
  'missile.massive': massiveGeo(71, 44),
};

/** Every missile strip name, `BULLET_CELLS`'s companion for the missile sheet. */
export const MISSILE_STRIP_CELLS = Object.keys(MISSILE_STRIPS) as readonly string[];

/**
 * Where each strip sits on the shared missile sheet: one strip per row, frames
 * laid horizontally, sheet width the widest row. Derived from the table so the
 * layout and the dimensions cannot drift (the laser sheet's discipline).
 */
function missileLayout(): {
  positions: Record<string, { x: number; y: number }>;
  width: number;
  height: number;
} {
  const positions: Record<string, { x: number; y: number }> = {};
  let width = 1;
  let y = 0;
  for (const [name, s] of Object.entries(MISSILE_STRIPS)) {
    positions[name] = { x: 0, y };
    width = Math.max(width, s.frames * s.stride);
    y += s.frameH;
  }
  return { positions, width, height: Math.max(1, y) };
}

export const MISSILE_SHEET = missileLayout();
export const MISSILE_SHEET_W = MISSILE_SHEET.width;
export const MISSILE_SHEET_H = MISSILE_SHEET.height;

/** Wire every `MISSILE_STRIPS` name onto `atlas` as a `Strip`. Shared by both branches. */
function defineMissileStrips(atlas: Atlas): void {
  for (const [name, s] of Object.entries(MISSILE_STRIPS)) {
    const p = MISSILE_SHEET.positions[name]!;
    atlas.defineStrip(name, {
      x: p.x,
      y: p.y,
      frameW: s.frameW,
      frameH: s.frameH,
      frames: s.frames,
      stride: s.stride,
      ticksPerFrame: s.ticksPerFrame,
      mode: s.mode,
      color: s.color,
    });
  }
}

/**
 * Render the procedural missile sheet: every `MISSILE_STRIPS` strip's frames laid
 * out on one shared canvas, each on its own row. White + tint, like the laser
 * sheet (a warm missile's colour is the content tint), so one greyscale sheet
 * serves every colour and the saturation gate holds.
 */
export function createMissileAtlas(): Atlas {
  const { positions, width, height } = MISSILE_SHEET;
  const { el, ctx } = canvas(width, height);

  for (const [name, s] of Object.entries(MISSILE_STRIPS)) {
    const p = positions[name]!;
    for (let f = 0; f < s.frames; f++) {
      const cx = p.x + f * s.stride + s.frameW / 2;
      const cy = p.y + s.frameH / 2;
      s.draw(ctx, f, cx, cy);
    }
  }

  const texture = new THREE.CanvasTexture(el);
  texture.magFilter = THREE.LinearFilter; // generated art is smooth, not pixel art
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace; // display-referred; see atlas.ts
  texture.flipY = false;
  texture.needsUpdate = true;

  const atlas = new Atlas(texture, width, height);
  defineMissileStrips(atlas);
  return atlas;
}

/**
 * A pack's `assets.missiles` strip, resolved: the winning file's URL plus the
 * geometry the manifest declared. The structural twin of the laser `LaserStripInput`
 * (one file per strip, frames laid horizontally, frame 0 leftmost — no x/y),
 * redeclared here so `render/` need not import `packs/`. Baked native art, so
 * `color` defaults `'baked'` — the reskin path, the saturation gate skipped.
 */
export interface MissileStripInput {
  url: string;
  frames: number;
  frameW: number;
  frameH: number;
  ticksPerFrame?: number;
  mode?: StripMode;
  color?: StripColor;
}

/**
 * The missile sheet, generated, loaded, or composited from a pack — symmetric to
 * `laserAtlas(url?, packStrips?)`.
 *
 * - `missileAtlas()` — the procedural body floor (rule 9).
 * - `missileAtlas(url)` — one combined `MISSILE_SHEET_W`×`MISSILE_SHEET_H` sheet
 *   loaded and dimension-checked (the direct-import seam), naming both figures on
 *   a mismatch (the point `bulletAtlas`/`laserAtlas` make: a wrong-sized sheet
 *   silently repoints every strip at a crop of the wrong shape).
 * - `missileAtlas(undefined, packStrips)` — a pack's per-file `assets.missiles`
 *   reskin, composited onto one shared texture (one batch is one texture): a body
 *   strip the pack reskins takes its baked pixels, a strip it leaves alone is
 *   painted procedurally, and any pack-new name is blitted too — so every base
 *   missile body always resolves. This is the branch the BulletPack import round
 *   supplies the coloured missile pixels to (design §g.5).
 */
export async function missileAtlas(
  url?: string,
  packStrips?: Record<string, MissileStripInput>,
): Promise<Atlas> {
  if (packStrips !== undefined && Object.keys(packStrips).length > 0) {
    return nativeMissileAtlas(packStrips);
  }
  if (url === undefined) return createMissileAtlas();

  const atlas = await loadAtlas(url);
  if (atlas.width !== MISSILE_SHEET_W || atlas.height !== MISSILE_SHEET_H) {
    throw new Error(
      `missile sheet "${url}" is ${atlas.width}×${atlas.height}, expected ${MISSILE_SHEET_W}×${MISSILE_SHEET_H}`,
    );
  }
  defineMissileStrips(atlas);
  return atlas;
}

/** One row of the composited missile sheet: either a procedural painter or a blit. */
interface MissileRow {
  name: string;
  frameW: number;
  frameH: number;
  frames: number;
  stride: number;
  ticksPerFrame: number;
  mode: StripMode;
  color: StripColor;
  paint?: StripDraw;
  image?: CanvasImageSource;
}

/** Resolve a pack strip's file to a blittable row (frames laid at `frameW`). */
async function packMissileRow(name: string, s: MissileStripInput): Promise<MissileRow> {
  const texture = await loadTexture(s.url);
  return {
    name,
    frameW: s.frameW,
    frameH: s.frameH,
    frames: s.frames,
    stride: s.frameW,
    ticksPerFrame: s.ticksPerFrame ?? 1,
    mode: s.mode ?? 'loop',
    color: s.color ?? 'baked',
    image: texture.image as CanvasImageSource,
  };
}

/**
 * Composite a pack's per-file `assets.missiles` strips onto one shared missile
 * texture, so the missile atlas stays a single texture / single batch. Floor names
 * the pack did not reskin are painted procedurally; the pack's files are blitted
 * at their native size; every strip lands on its own row, frames horizontal — the
 * fx/laser discipline, one more time.
 */
async function nativeMissileAtlas(packStrips: Record<string, MissileStripInput>): Promise<Atlas> {
  const rows: MissileRow[] = [];

  // Floor names first (procedural unless reskinned), in the floor's own order,
  // so every base missile body always resolves on the result.
  for (const [name, s] of Object.entries(MISSILE_STRIPS)) {
    const over = packStrips[name];
    if (over) {
      rows.push(await packMissileRow(name, over));
    } else {
      rows.push({
        name,
        frameW: s.frameW,
        frameH: s.frameH,
        frames: s.frames,
        stride: s.stride,
        ticksPerFrame: s.ticksPerFrame,
        mode: s.mode,
        color: s.color,
        paint: s.draw,
      });
    }
  }
  // Pack-new missile names (not a floor strip): a content pack that fires one
  // resolves; the base game draws only the floor names.
  for (const name of Object.keys(packStrips)) {
    if (name in MISSILE_STRIPS) continue;
    const s = packStrips[name];
    if (s !== undefined) rows.push(await packMissileRow(name, s));
  }

  const rowY: number[] = [];
  let sheetW = 1;
  let sheetH = 0;
  for (const row of rows) {
    rowY.push(sheetH);
    sheetW = Math.max(sheetW, row.frames * row.stride);
    sheetH += row.frameH;
  }
  sheetH = Math.max(1, sheetH);

  const { el, ctx } = canvas(sheetW, sheetH);
  rows.forEach((row, i) => {
    const y = rowY[i] ?? 0;
    if (row.image) {
      ctx.drawImage(row.image, 0, y);
    } else if (row.paint) {
      for (let f = 0; f < row.frames; f++) {
        row.paint(ctx, f, f * row.stride + row.frameW / 2, y + row.frameH / 2);
      }
    }
  });

  const texture = new THREE.CanvasTexture(el);
  // Native baked missile art is pixel art; nearest keeps it crisp (loadTexture's floor).
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace; // display-referred; see atlas.ts
  texture.flipY = false;
  texture.needsUpdate = true;

  const atlas = new Atlas(texture, sheetW, sheetH);
  rows.forEach((row, i) => {
    atlas.defineStrip(row.name, {
      x: 0,
      y: rowY[i] ?? 0,
      frameW: row.frameW,
      frameH: row.frameH,
      frames: row.frames,
      stride: row.stride,
      ticksPerFrame: row.ticksPerFrame,
      mode: row.mode,
      color: row.color,
    });
  });
  return atlas;
}
