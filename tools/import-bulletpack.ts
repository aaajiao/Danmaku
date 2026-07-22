/**
 * Import the third-party **BulletPack** art folder into a local Danmaku pack, in
 * the engine's **native self-describing strip format** (design-native-format
 * amendment §Importer).
 *
 *     bun tools/import-bulletpack.ts                 # default root: ~/Downloads/BulletPack
 *     bun tools/import-bulletpack.ts /path/to/BulletPack
 *
 * ## What it produces
 *
 * A **reskin** pack (format 1) at `packs/bulletpack/`:
 *   - `bullets/bullets.png` — ONE shared sheet carrying every bullet strip, placed with
 *     explicit x/y. It holds the 16 built-in `BULLET_CELLS` as **tinted**
 *     (whitened) native strips — animation frames kept, each fit to a coherent
 *     per-cell size so the reskinned curtain stays readable — plus the coloured
 *     BulletPack designs as **baked** native strips keyed by the names the base
 *     four-stage campaign already fires (`BULLET_VARIANTS`, e.g. `orb.medium.decree`,
 *     `needle.pin`): `nativeBulletAtlas` keeps a pack strip over the floor-cell
 *     alias, so a baked design reaches real play the moment its strip carries that
 *     family's fired name — no companion content pack. Base content fires those
 *     names tint-free, so one baked colour per name is safe. Every source row is
 *     split explicitly and preserved; directional frames are losslessly rotated
 *     to +x where needed, never cropped across logical cells.
 *   - Four more shared category atlases: `explosions/explosions.png`,
 *     `lasers/lasers.png`, `missiles/missiles.png`, `misc/pickups.png`. Every
 *     `PackStrip` repeats the category `src` and carries explicit x/y/stride.
 *   - `pack.json` — all category atlases plus the native player ship strip,
 *     validated in-process by the real `validateManifest` (a failure throws).
 *     Every one of the 10 `Player Ship/` PNGs is now a live consumer: banking
 *     ship, option, three thrusters, two exhaust residues and three bomb strips.
 *   - `extra/<category>/…` + `extra/extras.json` — every source file this round
 *     does not consume, staged verbatim with its disposition. The completeness
 *     law: every file in the folder is accounted for exactly once.
 *   - `README.md` — purchase/product-page provenance, the no-redistribution
 *     boundary and the artist notes shipped with the pack.
 *
 * ## Why native strips, not the old whiten+regrid
 *
 * The retired importer whitened every source and downsampled it into a fixed
 * 32px grid, taking frame 0 of any animation — it destroyed colour, blurred
 * small pixel art, and dropped every animation. This one keeps native size and
 * native animation for the baked variants (the coloured art the user bought),
 * and only the 16 shared floor cells stay whitened tint-coded (the base campaign
 * recolours them per-instance, so their colour is restored by the tint, and a
 * per-cell coherent fit keeps them readable — this is NOT the retired uniform
 * regrid, which flattened all 16 to one size and dropped their frames).
 *
 * ## In-tool self-check mirrors the browser gates
 *
 * The loader's native-sheet gates (`packs/loader.ts` `checkNativeBulletSheet` /
 * `measureStripFrames` / `checkStripSheet`) are browser-only (they need a canvas).
 * `assertNativeBulletSheet` / `assertPackedStrip` below replicate them headless so
 * a bad sheet fails IN THIS TOOL before a browser ever loads it: floor-cell
 * coverage, per-strip bounds, the per-frame inter-frame seam (`frameW − 2·FX_PAD`),
 * and mean saturation on tinted strips (floor cells are measured as tinted, since
 * the engine draws them with the per-instance tint regardless of what they declare).
 *
 * ## Licence hygiene
 *
 * The user supplied their itch.io purchase receipt and the public product page
 * identifies the author as J i m (jinvorionstg), whose public usage statement
 * permits commercial use. The whole `packs/bulletpack/` tree remains
 * `.gitignore`d because purchase grants use, not redistribution of source art.
 *
 * ## Why it decodes PNGs itself
 *
 * `tools/png.ts`'s `parsePng` only re-reads the unfiltered PNGs this repo writes;
 * BulletPack's exporter uses adaptive filters and (some) palettes. So this tool
 * decodes through `tools/png-decode.ts` (a full decoder) and encodes the
 * assembled sheets through `tools/png.ts`'s `encodePng`, then re-reads each
 * output through `parsePng` to prove it round-trips.
 */

import { mkdirSync, writeFileSync, copyFileSync, readFileSync, readdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { BULLET_CELLS, FX_PAD, LASER_BODY_CELLS } from '../src/render/procedural';
import { BASE_LASER_SKINS } from '../src/render/laser-skin';
import { ColourType, encodePng, parsePng } from './png';
import { decodePng, type DecodedImage } from './png-decode';
import { validateManifest } from '../src/packs/manifest';

/* ------------------------------------------------------------------ */
/* Loader thresholds, restated (they are private consts in loader.ts). */
/* Kept in step by eye; replicating them here fails in the tool,        */
/* headless, before a browser ever loads the sheet.                     */
/* ------------------------------------------------------------------ */
const BULLET_ALPHA_PAINTED = 16; // loader.ts BULLET_ALPHA_PAINTED
const SATURATION_ALPHA_FLOOR = 128; // loader.ts SATURATION_ALPHA_FLOOR
const BULLET_SATURATION_MAX = 0.15; // loader.ts BULLET_SATURATION_MAX

/** Transparent margin baked around each frame's content, per side. Gives the
 *  loader's `frameW − 2·FX_PAD` seam gate 1px of headroom (FX_PAD is 2). */
const MARGIN = 3;

/* ------------------------------------------------------------------ */
/* A mutable straight-alpha RGBA image.                                 */
/* ------------------------------------------------------------------ */
export interface Img {
  w: number;
  h: number;
  rgba: Uint8Array; // RGBA, 4 bytes/pixel, straight alpha
}

function fromDecoded(d: DecodedImage): Img {
  return { w: d.width, h: d.height, rgba: d.rgba.slice() };
}
function blank(w: number, h: number): Img {
  return { w, h, rgba: new Uint8Array(w * h * 4) };
}
function px(img: Img, x: number, y: number): [number, number, number, number] {
  const i = (y * img.w + x) * 4;
  return [img.rgba[i]!, img.rgba[i + 1]!, img.rgba[i + 2]!, img.rgba[i + 3]!];
}
function setPx(img: Img, x: number, y: number, r: number, g: number, b: number, a: number): void {
  const i = (y * img.w + x) * 4;
  img.rgba[i] = r; img.rgba[i + 1] = g; img.rgba[i + 2] = b; img.rgba[i + 3] = a;
}

/** Slice one frame out of a validated horizontal equal-width strip. */
function frameOf(img: Img, frames: number, frame: number): Img {
  if (!Number.isInteger(frames) || frames < 1) throw new Error(`invalid strip count ${frames}`);
  if (img.w % frames !== 0) {
    throw new Error(`strip width ${img.w} is not divisible by ${frames} frames`);
  }
  const fw = img.w / frames;
  return crop(img, frame * fw, 0, fw, img.h);
}

function crop(img: Img, x0: number, y0: number, w: number, h: number): Img {
  const out = blank(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x0 + x, sy = y0 + y;
      if (sx < 0 || sy < 0 || sx >= img.w || sy >= img.h) continue;
      const [r, g, b, a] = px(img, sx, sy);
      setPx(out, x, y, r, g, b, a);
    }
  }
  return out;
}

/** The alpha≥threshold bounding box, or undefined if the image is empty. */
function alphaBox(img: Img, threshold: number): { x: number; y: number; w: number; h: number } | undefined {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (img.rgba[(y * img.w + x) * 4 + 3]! >= threshold) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) return undefined;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Crop to the alpha≥threshold bounding box; the image unchanged if empty. */
function trimAlpha(img: Img, threshold: number): Img {
  const box = alphaBox(img, threshold);
  if (box === undefined) return img;
  return crop(img, box.x, box.y, box.w, box.h);
}

/**
 * Make one +x-native tile repeat without a transparent crack. The source's
 * `t` bodies are authored as longitudinal tiles, but a few animation frames
 * leave one to three empty columns at an end. Repeat the first/last non-empty
 * texel of each painted scanline to the frame edge; cross-axis transparency is
 * untouched, so the glow profile and its atlas-row padding stay intact.
 */
export function extendHorizontalEdges(img: Img): Img {
  const out = { w: img.w, h: img.h, rgba: img.rgba.slice() };
  for (let y = 0; y < out.h; y++) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < out.w; x++) {
      if (out.rgba[(y * out.w + x) * 4 + 3]! > 0) {
        if (left < 0) left = x;
        right = x;
      }
    }
    if (left < 0 || right < 0) continue;
    const [lr, lg, lb, la] = px(out, left, y);
    for (let x = 0; x < left; x++) setPx(out, x, y, lr, lg, lb, la);
    const [rr, rg, rb, ra] = px(out, right, y);
    for (let x = right + 1; x < out.w; x++) setPx(out, x, y, rr, rg, rb, ra);
  }
  return out;
}

/** Frame box policy shared by the importer and its headless regression test. */
export function orientedFrameSize(
  contentW: number,
  contentH: number,
  laserBody: boolean,
): { frameW: number; frameH: number } {
  return {
    frameW: contentW + (laserBody ? 0 : 2 * MARGIN),
    frameH: contentH + 2 * MARGIN,
  };
}

/** Rotate clockwise by 0/90/180/270 degrees (lossless). */
function rotate(img: Img, deg: number): Img {
  const t = (((deg % 360) + 360) % 360) / 90;
  if (t === 0) return img;
  let cur = img;
  for (let i = 0; i < t; i++) cur = rot90(cur);
  return cur;
}
function rot90(img: Img): Img {
  const out = blank(img.h, img.w); // 90° CW: newW=h, newH=w
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const [r, g, b, a] = px(img, x, y);
      const nx = img.h - 1 - y;
      const ny = x;
      setPx(out, nx, ny, r, g, b, a);
    }
  }
  return out;
}

/** Set every texel to white, keeping alpha — so the engine's tint recolours it. */
function whiten(img: Img): Img {
  const out = blank(img.w, img.h);
  for (let i = 0; i < img.rgba.length; i += 4) {
    out.rgba[i] = 255; out.rgba[i + 1] = 255; out.rgba[i + 2] = 255; out.rgba[i + 3] = img.rgba[i + 3]!;
  }
  return out;
}

/**
 * Resample to (dw,dh) with alpha-premultiplied box averaging — used ONLY to fit
 * a tinted floor cell to its coherent size. Baked variants are never resampled.
 */
function resize(img: Img, dw: number, dh: number): Img {
  const out = blank(dw, dh);
  const sxr = img.w / dw;
  const syr = img.h / dh;
  for (let dy = 0; dy < dh; dy++) {
    const sy0 = dy * syr, sy1 = (dy + 1) * syr;
    for (let dx = 0; dx < dw; dx++) {
      const sx0 = dx * sxr, sx1 = (dx + 1) * sxr;
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      const ix0 = Math.floor(sx0), ix1 = Math.min(img.w, Math.ceil(sx1));
      const iy0 = Math.floor(sy0), iy1 = Math.min(img.h, Math.ceil(sy1));
      for (let sy = iy0; sy < iy1; sy++) {
        const cover_y = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
        if (cover_y <= 0) continue;
        for (let sx = ix0; sx < ix1; sx++) {
          const cover_x = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
          if (cover_x <= 0) continue;
          const wgt = cover_x * cover_y;
          const [pr, pg, pb, pa] = px(img, sx, sy);
          const al = pa / 255;
          r += pr * al * wgt; g += pg * al * wgt; b += pb * al * wgt;
          a += pa * wgt; wsum += wgt;
        }
      }
      if (wsum > 0 && a > 0) {
        const alpha = a / wsum; // 0..255
        const un = alpha / 255;
        setPx(out, dx, dy, Math.round(r / wsum / un), Math.round(g / wsum / un), Math.round(b / wsum / un), Math.round(alpha));
      }
    }
  }
  return out;
}

/**
 * Integer nearest-neighbour upscale by `n`× — lifts a sub-`FX_PAD` source (the
 * 2×2 `Versatile_Particles` debris; a 2px frame's `frameW − 2·FX_PAD` is negative)
 * to a paintable frame WITHOUT introducing a new colour or blurring a pixel, a
 * documented import transform (design §c). Baked art only; every output texel is a
 * copy of a source texel, so the `color:'baked'` pixels stay exact. The seam gate
 * itself is untouched — the art is enlarged before it reaches the gate.
 */
function nearestUpscale(img: Img, n: number): Img {
  if (n <= 1) return img;
  const out = blank(img.w * n, img.h * n);
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const [r, g, b, a] = px(img, x, y);
      for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) setPx(out, x * n + dx, y * n + dy, r, g, b, a);
    }
  }
  return out;
}

/** Fit the longer painted axis to `target` px (up or down), preserving aspect. */
function fitTo(img: Img, target: number): Img {
  const m = Math.max(img.w, img.h);
  if (m === 0) return img;
  const scale = target / m;
  const dw = Math.max(1, Math.min(target, Math.round(img.w * scale)));
  const dh = Math.max(1, Math.min(target, Math.round(img.h * scale)));
  if (dw === img.w && dh === img.h) return img;
  return resize(img, dw, dh);
}

/** Source-over composite `src` onto `dst` at (ox,oy). */
function blit(dst: Img, src: Img, ox: number, oy: number): void {
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const dx = ox + x, dy = oy + y;
      if (dx < 0 || dy < 0 || dx >= dst.w || dy >= dst.h) continue;
      const [sr, sg, sb, sa] = px(src, x, y);
      if (sa === 0) continue;
      const [dr, dg, db, da] = px(dst, dx, dy);
      const saf = sa / 255, daf = da / 255;
      const oaf = saf + daf * (1 - saf);
      if (oaf <= 0) continue;
      setPx(dst, dx, dy,
        Math.round((sr * saf + dr * daf * (1 - saf)) / oaf),
        Math.round((sg * saf + dg * daf * (1 - saf)) / oaf),
        Math.round((sb * saf + db * daf * (1 - saf)) / oaf),
        Math.round(oaf * 255));
    }
  }
}

/** Centre `cell` in a (cellW×cellH) box whose top-left is (cellX,cellY). */
function blitCentred(dst: Img, cell: Img, cellX: number, cellY: number, cellW: number, cellH: number): void {
  const ox = cellX + Math.round((cellW - cell.w) / 2);
  const oy = cellY + Math.round((cellH - cell.h) / 2);
  blit(dst, cell, ox, oy);
}

/* ------------------------------------------------------------------ */
/* The mapping config                                                   */
/* ------------------------------------------------------------------ */
interface StripMap {
  src: string;
  strip: number; // explicit frame count; even a static source declares 1
  rotate?: number; // clockwise degrees to bring directional art to +x (rule 7)
  fit?: number; // FLOOR only: fit the longer painted axis to this many px
  nearest?: number; // integer nearest-neighbour upscale (sub-FX_PAD art, design §c)
  mode?: 'loop' | 'once';
  ticksPerFrame?: number;
  note?: string;
}
interface EffectMap {
  src: string;
  strip: number;
  nearest?: number; // integer nearest-neighbour upscale (sub-FX_PAD art, design §c)
  mode?: 'loop' | 'once';
  ticksPerFrame?: number;
  /** Player exhaust strips intentionally contain an all-transparent off frame. */
  allowEmpty?: boolean;
  note?: string;
}
interface BulletPackMap {
  floor: Record<string, StripMap>;
  variants: Record<string, StripMap>;
  shots: Record<string, StripMap>;
  effects: Record<string, EffectMap>;
  /** Laser body/cap strips → `assets.lasers` (baked, rotated +x). Keys are laser
   *  strip names (`beam.warm`, `cap.yellow`, `src/render/laser-skin.ts`). */
  lasers: Record<string, StripMap>;
  /** Missile body strips → `assets.missiles` (baked, rotated +x). Keys are missile
   *  body names (`missile.0` … `missile.11`, `missile.massive`,
   *  `src/render/procedural.ts`). They are packed as oriented rows in one atlas. */
  missiles: Record<string, StripMap>;
  /** Pickup coin/gem/bar strips → `assets.pickups` (baked, RADIAL — no rotate).
   *  Keys are pickup-skin names (`pickup.coin.silver`, `pickup.gem.cyan`,
   *  `pickup.bar`, `src/render/procedural.ts`). They are packed as radial rows in
   *  one atlas after building through `buildEffectStrip`. */
  pickups: Record<string, EffectMap>;
  player: {
    ship: EffectMap;
    effects: Record<string, EffectMap>;
  };
  variantsDuplicate?: Record<string, { of: string; representedBy: string }>;
}

/** Source-strip integrity is checked before any trim, fit or atlas packing. */
function assertSourceStrip(whole: Img, frames: number, src: string, allowEmpty = false): void {
  if (!Number.isInteger(frames) || frames < 1) {
    throw new Error(`${src}: strip must be a positive integer, got ${frames}`);
  }
  if (whole.w % frames !== 0) {
    throw new Error(`${src}: width ${whole.w} is not divisible by ${frames} frames`);
  }
  if (!allowEmpty) {
    for (let f = 0; f < frames; f++) assertFrameHasAlpha(frameOf(whole, frames, f), src, f);
  }
}

function assertFrameHasAlpha(frame: Img, src: string, index: number): void {
  if (!alphaBox(frame, 1)) throw new Error(`${src}: frame ${index} has no non-transparent pixel`);
}

/**
 * File-level "consumed" is insufficient for a strip source: prove that every
 * enemy/player row is explicitly split, no cell crop survives, reused sources
 * agree on their count, and every source frame contains paint.
 */
function assertBulletCellCompleteness(root: string, map: BulletPackMap): Map<string, number> {
  const counts = new Map<string, number>();
  const bulletSections = [map.floor, map.variants, map.shots];
  for (const section of bulletSections) {
    for (const [name, raw] of Object.entries(section)) {
      if (name.startsWith('$')) continue;
      const m = raw as StripMap & { crop?: unknown };
      if ('crop' in m) throw new Error(`bullet mapping "${name}" must preserve the full strip; crop is forbidden`);
      if (!Number.isInteger(m.strip) || m.strip < 1) {
        throw new Error(`bullet mapping "${name}" must declare strip >= 1`);
      }
      if (m.strip > 1 && m.mode !== 'loop') {
        throw new Error(`bullet mapping "${name}" has ${m.strip} frames but mode is not "loop"`);
      }
      const previous = counts.get(m.src);
      if (previous !== undefined && previous !== m.strip) {
        throw new Error(`${m.src}: inconsistent strip counts ${previous} and ${m.strip}`);
      }
      counts.set(m.src, m.strip);
    }
  }

  for (const [src, frames] of counts) {
    const whole = fromDecoded(decodePng(new Uint8Array(readFileSync(join(root, src)))));
    assertSourceStrip(whole, frames, src);
  }

  const duplicates = Object.entries(map.variantsDuplicate ?? {})
    .filter(([name]) => !name.startsWith('$'));
  const duplicatePaths = new Set(duplicates.map(([src]) => src));
  for (const [src, duplicate] of duplicates) {
    const originalFrames = counts.get(duplicate.of);
    if (originalFrames === undefined) throw new Error(`${src}: duplicate original "${duplicate.of}" is not mapped`);
    const a = readFileSync(join(root, src));
    const b = readFileSync(join(root, duplicate.of));
    if (a.length !== b.length || !a.equals(b)) throw new Error(`${src}: not byte-identical to declared original "${duplicate.of}"`);
    counts.set(src, originalFrames);
  }

  const sourceRows = walk(root)
    .map((abs) => relative(root, abs))
    .filter((rel) => rel.toLowerCase().endsWith('.png'))
    .filter((rel) => rel.startsWith('Bullet Pack/Bullet Pack/') || rel.startsWith('Bullet Pack/Player Bullets/'));
  const omitted = sourceRows.filter((rel) => !counts.has(rel) && !duplicatePaths.has(rel));
  if (omitted.length > 0) throw new Error(`bullet source row(s) omitted from the cell ledger: ${omitted.join(', ')}`);
  return counts;
}

/**
 * Load a source into its processed frames.
 *  - floor (`whitenFit` true): split → rotate → trim → fit → whiten → trim.
 *  - baked (`whitenFit` false): split → rotate → trim. Pixel-exact, no resample.
 */
function loadFrames(root: string, m: StripMap, whitenFit: boolean): Img[] {
  const decoded = decodePng(new Uint8Array(readFileSync(join(root, m.src))));
  const whole = fromDecoded(decoded);
  const n = m.strip;
  assertSourceStrip(whole, n, m.src);
  const out: Img[] = [];
  for (let f = 0; f < n; f++) {
    let img = frameOf(whole, n, f);
    if (m.rotate) img = rotate(img, m.rotate);
    if (m.nearest) img = nearestUpscale(img, m.nearest);
    img = trimAlpha(img, BULLET_ALPHA_PAINTED);
    if (whitenFit && m.fit) img = fitTo(img, m.fit);
    if (whitenFit) img = whiten(img);
    img = trimAlpha(img, BULLET_ALPHA_PAINTED);
    assertFrameHasAlpha(img, m.src, f);
    out.push(img);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Bullet sheet: pack every strip onto one PNG.                         */
/* ------------------------------------------------------------------ */
type Colour = 'tinted' | 'baked';
interface StripEntry {
  name: string;
  frames: Img[];
  color: Colour;
  mode: 'loop' | 'once';
  ticksPerFrame: number;
}
/** The emitted `PackBulletStrip` (stride omitted — the loader defaults it to frameW). */
interface EmittedStrip {
  x: number;
  y: number;
  frameW: number;
  frameH: number;
  frames?: number;
  ticksPerFrame?: number;
  mode?: 'loop' | 'once';
  color: Colour;
  /** Un-margined painted content bound, px — the Law of Geometry seam input the
   *  render seam divides by (`displayW = engineContent × frameW / contentW`). The
   *  measurement already exists here; emitting it is what activates the size fix. */
  contentW: number;
  contentH: number;
}

const SHEET_MAX_W = 512;
const GAP = 2; // transparent gap between packed strips (belt-and-braces vs linear bleed)

function packBulletSheet(entries: StripEntry[]): { sheet: Img; strips: Record<string, EmittedStrip> } {
  // Frame box per entry: content padded by MARGIN, and square-enough that the
  // loader's frameW-based seam limit clears BOTH the width and the height.
  const boxed = entries.map((e) => {
    const contentW = Math.max(1, ...e.frames.map((f) => f.w));
    const contentH = Math.max(1, ...e.frames.map((f) => f.h));
    const side = Math.max(contentW, contentH);
    const frameW = side + 2 * MARGIN;
    const frameH = contentH + 2 * MARGIN;
    return { e, frameW, frameH, contentW, contentH, stripW: e.frames.length * frameW };
  });

  // Shelf pack: tallest first, left→right, wrap at SHEET_MAX_W.
  const order = [...boxed].sort((a, b) => b.frameH - a.frameH);
  const placed: Array<{ b: (typeof boxed)[number]; x: number; y: number }> = [];
  let rowX = 0, rowY = 0, rowH = 0, usedW = 0;
  for (const b of order) {
    if (rowX > 0 && rowX + b.stripW > SHEET_MAX_W) {
      rowY += rowH + GAP;
      rowX = 0;
      rowH = 0;
    }
    placed.push({ b, x: rowX, y: rowY });
    rowX += b.stripW + GAP;
    if (rowX > usedW) usedW = rowX;
    if (b.frameH > rowH) rowH = b.frameH;
  }
  const sheetW = Math.max(1, usedW - GAP);
  const sheetH = rowY + rowH;

  const sheet = blank(sheetW, sheetH);
  const strips: Record<string, EmittedStrip> = {};
  for (const { b, x, y } of placed) {
    const { e, frameW, frameH, contentW, contentH } = b;
    e.frames.forEach((frame, f) => {
      blitCentred(sheet, frame, x + f * frameW, y, frameW, frameH);
    });
    // Law of Geometry: carry the measured content bound (not the margined/squared
    // frame) so the render seam lands the painted content at its engine size — for
    // floor cells too, which incidentally erases the per-cell `fit` drift.
    const s: EmittedStrip = { x, y, frameW, frameH, contentW, contentH, color: e.color };
    if (e.frames.length > 1) {
      s.frames = e.frames.length;
      if (e.ticksPerFrame !== 1) s.ticksPerFrame = e.ticksPerFrame;
      s.mode = e.mode;
    }
    strips[e.name] = s;
  }
  return { sheet, strips };
}

/* ------------------------------------------------------------------ */
/* Build one normalized effect row; category packing happens afterwards.*/
/* ------------------------------------------------------------------ */
interface EmittedEffect {
  src: string;
  /** Frame-0 origin and inter-frame stride in the shared category atlas. */
  x: number;
  y: number;
  stride: number;
  frames: number;
  frameW: number;
  frameH: number;
  ticksPerFrame?: number;
  mode: 'loop' | 'once';
  color: Colour;
  /** Un-margined painted content bound, px (the frame-union content, pre-margin and
   *  pre-squaring) — the Law of Geometry seam input for effects/lasers/missiles/
   *  pickups (`displayW = engineContent × frameW / contentW`). */
  contentW: number;
  contentH: number;
}

function buildEffectStrip(root: string, name: string, m: EffectMap): { sheet: Img; meta: EmittedEffect; file: string } {
  const whole = fromDecoded(decodePng(new Uint8Array(readFileSync(join(root, m.src)))));
  const n = m.strip;
  assertSourceStrip(whole, n, m.src, m.allowEmpty === true);
  const raw: Img[] = [];
  for (let f = 0; f < n; f++) {
    // A sub-`FX_PAD` source (the 2×2 debris) is nearest-upscaled to a paintable
    // frame BEFORE the union box / seam gate see it (design §c). Radial art only,
    // so no rotate here — the effect discipline.
    let fr = frameOf(whole, n, f);
    if (m.nearest) fr = nearestUpscale(fr, m.nearest);
    if (!m.allowEmpty) assertFrameHasAlpha(fr, m.src, f);
    raw.push(fr);
  }

  // Union content box across all frames (local coords), so every frame shares
  // one crop window — inter-frame motion is preserved, not re-centred per frame.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const fr of raw) {
    const box = alphaBox(fr, BULLET_ALPHA_PAINTED);
    if (!box) continue;
    if (box.x < minX) minX = box.x;
    if (box.y < minY) minY = box.y;
    if (box.x + box.w - 1 > maxX) maxX = box.x + box.w - 1;
    if (box.y + box.h - 1 > maxY) maxY = box.y + box.h - 1;
  }
  const efw = raw[0]?.w ?? whole.w / n;
  const efh = raw[0]?.h ?? whole.h;
  if (maxX < minX) { minX = 0; minY = 0; maxX = efw - 1; maxY = efh - 1; }
  const uW = maxX - minX + 1;
  const uH = maxY - minY + 1;
  const side = Math.max(uW, uH);
  const frameW = side + 2 * MARGIN;
  const frameH = uH + 2 * MARGIN;

  const sheet = blank(n * frameW, frameH);
  raw.forEach((fr, f) => {
    const cropped = crop(fr, minX, minY, uW, uH);
    const ox = f * frameW + Math.round((frameW - uW) / 2);
    const oy = Math.round((frameH - uH) / 2);
    blit(sheet, cropped, ox, oy); // baked: native colour, no whiten
  });

  const file = `${name}.png`;
  // `uW`/`uH` are the pre-margin, pre-square content bound — the Law of Geometry
  // divisor. The squared `frameW` divided by `uW` is the on-screen scale factor.
  const meta: EmittedEffect = {
    src: file, x: 0, y: 0, stride: frameW,
    frames: n, frameW, frameH, contentW: uW, contentH: uH,
    mode: m.mode ?? 'once', color: 'baked',
  };
  if ((m.ticksPerFrame ?? 1) !== 1) meta.ticksPerFrame = m.ticksPerFrame;
  return { sheet, meta, file };
}

/**
 * Build one ORIENTED row — a LASER body/cap or a MISSILE body — before its
 * category atlas packs it, with two specifics that both surfaces share.
 *
 *  - **+x rotation, once at import (rule 7).** The BulletPack laser art is drawn
 *    long-axis-VERTICAL (the beam runs up the frame) and the missile art nose-UP;
 *    oriented sprites in this engine run +x, so each frame is rotated 90° here —
 *    NOT with a runtime UV transpose — so the renderer reuses the one convention
 *    (length along local +x, rotate by heading) with no baked offset. Post-rotation
 *    `frameW` is the on-axis extent (beam length / missile nose-to-tail) and
 *    `frameH` the thickness.
 *  - **Rectangular, not squared.** `buildEffectStrip` squares each frame (an
 *    explosion is radial); a beam or a missile is long and thin, so its frame keeps
 *    its own aspect — `frameW` from the length axis, `frameH` from the thickness.
 *
 * Baked native colour (no whiten, the `color: 'baked'` reskin path, saturation
 * gate skipped), content unioned across frames. Caps and missiles are re-padded
 * by `MARGIN` on both axes. Laser bodies deliberately fill the +x axis (the
 * procedural body's established seam exception) and retain `MARGIN` only on the
 * cross axis; tile bodies also extend their boundary texels to remove source-side
 * one-to-three-pixel gaps.
 */
function buildLaserStrip(
  root: string,
  name: string,
  m: StripMap,
  laserBody = false,
  tileBody = false,
): { sheet: Img; meta: EmittedEffect; file: string } {
  const whole = fromDecoded(decodePng(new Uint8Array(readFileSync(join(root, m.src)))));
  const n = m.strip;
  assertSourceStrip(whole, n, m.src);
  const srcFrameW = whole.w / n;
  const raw: Img[] = [];
  for (let f = 0; f < n; f++) {
    let fr = frameOf(whole, n, f);
    if (m.rotate) fr = rotate(fr, m.rotate); // bring the beam to +x (rule 7)
    assertFrameHasAlpha(fr, m.src, f);
    raw.push(fr);
  }

  // Union content box across all frames (shared crop window), so inter-frame
  // motion is preserved rather than re-centred per frame — the effect discipline.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const fr of raw) {
    const box = alphaBox(fr, BULLET_ALPHA_PAINTED);
    if (!box) continue;
    if (box.x < minX) minX = box.x;
    if (box.y < minY) minY = box.y;
    if (box.x + box.w - 1 > maxX) maxX = box.x + box.w - 1;
    if (box.y + box.h - 1 > maxY) maxY = box.y + box.h - 1;
  }
  const w0 = raw[0]?.w ?? srcFrameW;
  const h0 = raw[0]?.h ?? whole.h;
  if (maxX < minX) { minX = 0; minY = 0; maxX = w0 - 1; maxY = h0 - 1; }
  const uW = maxX - minX + 1;
  const uH = maxY - minY + 1;
  // A laser BODY must reach both longitudinal frame edges: stretch bodies then
  // meet muzzle/tip exactly, and tile bodies butt without a transparent seam.
  // Caps and missiles retain the ordinary two-axis padding contract.
  const { frameW, frameH } = orientedFrameSize(uW, uH, laserBody);

  const sheet = blank(n * frameW, frameH);
  raw.forEach((fr, f) => {
    const base = crop(fr, minX, minY, uW, uH);
    const cropped = tileBody ? extendHorizontalEdges(base) : base;
    const ox = f * frameW + Math.round((frameW - uW) / 2);
    const oy = Math.round((frameH - uH) / 2);
    blit(sheet, cropped, ox, oy); // baked: native colour, no whiten
  });

  const file = `${name}.png`;
  // `uW`/`uH` are the pre-margin content bound (a laser/missile keeps its aspect —
  // no squaring), the Law of Geometry divisor for this oriented strip.
  const meta: EmittedEffect = {
    src: file, x: 0, y: 0, stride: frameW,
    frames: n, frameW, frameH, contentW: uW, contentH: uH,
    mode: m.mode ?? 'loop', color: 'baked',
  };
  if ((m.ticksPerFrame ?? 1) !== 1) meta.ticksPerFrame = m.ticksPerFrame;
  return { sheet, meta, file };
}

/* ------------------------------------------------------------------ */
/* Shared atlases for effects / lasers / missiles / pickups.           */
/* ------------------------------------------------------------------ */
interface BuiltCategoryStrip {
  name: string;
  sheet: Img;
  meta: EmittedEffect;
  allowEmpty?: boolean;
  /** Laser body only: +x must fill for stretch endpoints / seamless tiling. */
  allowLongAxisFill?: boolean;
}

const CATEGORY_ATLAS_MAX = 4096;
const CATEGORY_ATLAS_GAP = 2;

/** Shelf-pack complete strip rectangles. Frames remain contiguous within a strip. */
function packCategoryAtlas(
  entries: BuiltCategoryStrip[],
  atlasPath: string,
): { sheet: Img; strips: Record<string, EmittedEffect> } {
  if (entries.length === 0) return { sheet: blank(1, 1), strips: {} };

  const order = [...entries].sort((a, b) => {
    if (a.sheet.h !== b.sheet.h) return b.sheet.h - a.sheet.h;
    if (a.sheet.w !== b.sheet.w) return b.sheet.w - a.sheet.w;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  const placed = new Map<string, { x: number; y: number }>();
  let rowX = 0, rowY = 0, rowH = 0, usedW = 0;
  for (const e of order) {
    if (e.sheet.w > CATEGORY_ATLAS_MAX || e.sheet.h > CATEGORY_ATLAS_MAX) {
      throw new Error(`${atlasPath}: strip "${e.name}" is ${e.sheet.w}×${e.sheet.h}, over ${CATEGORY_ATLAS_MAX}×${CATEGORY_ATLAS_MAX}`);
    }
    if (rowX > 0 && rowX + e.sheet.w > CATEGORY_ATLAS_MAX) {
      rowY += rowH + CATEGORY_ATLAS_GAP;
      rowX = 0;
      rowH = 0;
    }
    if (rowY + e.sheet.h > CATEGORY_ATLAS_MAX) {
      throw new Error(`${atlasPath}: packed height exceeds ${CATEGORY_ATLAS_MAX}px at strip "${e.name}"`);
    }
    placed.set(e.name, { x: rowX, y: rowY });
    rowX += e.sheet.w + CATEGORY_ATLAS_GAP;
    usedW = Math.max(usedW, rowX - CATEGORY_ATLAS_GAP);
    rowH = Math.max(rowH, e.sheet.h);
  }

  const sheet = blank(Math.max(1, usedW), Math.max(1, rowY + rowH));
  const strips: Record<string, EmittedEffect> = {};
  for (const e of entries) {
    const at = placed.get(e.name);
    if (!at) throw new Error(`${atlasPath}: internal placement missing for "${e.name}"`);
    blit(sheet, e.sheet, at.x, at.y);
    const meta: EmittedEffect = {
      ...e.meta,
      src: atlasPath,
      x: at.x,
      y: at.y,
      stride: e.meta.frameW,
    };
    assertPackedStrip(
      e.name,
      sheet,
      meta,
      e.allowEmpty === true,
      e.allowLongAxisFill === true,
    );
    strips[e.name] = meta;
  }
  if (sheet.w > CATEGORY_ATLAS_MAX || sheet.h > CATEGORY_ATLAS_MAX) {
    throw new Error(`${atlasPath}: atlas is ${sheet.w}×${sheet.h}, over ${CATEGORY_ATLAS_MAX}×${CATEGORY_ATLAS_MAX}`);
  }
  return { sheet, strips };
}

/* ------------------------------------------------------------------ */
/* Self-validation replicating the loader's browser-only measured gates.*/
/* ------------------------------------------------------------------ */
function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  if (max === 0) return 0;
  return (max - Math.min(r, g, b)) / max;
}

/** Measure one frame at (fx0,y0) of size frameW×frameH on `sheet`. */
function measureFrame(sheet: Img, fx0: number, y0: number, frameW: number, frameH: number): { ex: number; ey: number; meanSat: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, satSum = 0, satCount = 0;
  for (let y = y0; y < y0 + frameH; y++) {
    for (let x = fx0; x < fx0 + frameW; x++) {
      const [r, g, b, a] = px(sheet, x, y);
      if (a >= BULLET_ALPHA_PAINTED) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      if (a >= SATURATION_ALPHA_FLOOR) { satSum += saturation(r, g, b); satCount++; }
    }
  }
  const ex = maxX >= minX ? maxX - minX + 1 : 0;
  const ey = maxY >= minY ? maxY - minY + 1 : 0;
  return { ex, ey, meanSat: satCount > 0 ? satSum / satCount : 0 };
}

/** Independent-axis padding gate; rectangular strips must not borrow X headroom for Y. */
export function frameClearsPadding(
  paintedW: number,
  paintedH: number,
  frameW: number,
  frameH: number,
  pad = FX_PAD,
  allowLongAxisFill = false,
): boolean {
  const xPass = allowLongAxisFill
    ? paintedW === frameW
    : paintedW <= frameW - 2 * pad;
  return xPass && paintedH <= frameH - 2 * pad;
}

/** Correct last-frame bound for stride > frameW as well as contiguous strips. */
export function stripEnd(
  x: number,
  y: number,
  frames: number,
  stride: number,
  frameW: number,
  frameH: number,
): { right: number; bottom: number } {
  return { right: x + (frames - 1) * stride + frameW, bottom: y + frameH };
}

/** Mirror `checkNativeBulletSheet` + `measureStripFrames` (loader.ts). */
function assertNativeBulletSheet(sheet: Img, strips: Record<string, EmittedStrip>): void {
  const floor = new Set<string>(BULLET_CELLS as readonly string[]);
  const missing = BULLET_CELLS.filter((c) => !(c in strips));
  if (missing.length > 0) throw new Error(`bullets.png missing floor cell(s): ${missing.join(', ')}`);

  for (const [name, s] of Object.entries(strips)) {
    const frames = s.frames ?? 1;
    const stride = s.frameW; // stride omitted in the emit ⇒ loader defaults to frameW
    const { right: lastRight, bottom } = stripEnd(s.x, s.y, frames, stride, s.frameW, s.frameH);
    if (s.x < 0 || s.y < 0 || lastRight > sheet.w || bottom > sheet.h) {
      throw new Error(`strip "${name}" runs to ${lastRight}×${bottom}, past the ${sheet.w}×${sheet.h} sheet`);
    }
    // Floor cells are drawn with the per-instance tint regardless of declared
    // colour, so they are measured as tinted (the loader forces this).
    const tinted = floor.has(name) || s.color === 'tinted';
    const limitX = s.frameW - 2 * FX_PAD;
    const limitY = s.frameH - 2 * FX_PAD;
    for (let f = 0; f < frames; f++) {
      const { ex, ey, meanSat } = measureFrame(sheet, s.x + f * stride, s.y, s.frameW, s.frameH);
      if (ex === 0 || ey === 0) throw new Error(`strip "${name}" frame ${f} has no non-transparent pixel`);
      if (!frameClearsPadding(ex, ey, s.frameW, s.frameH)) {
        throw new Error(`strip "${name}" frame ${f} paints ${ex}×${ey}px, over the ${limitX}×${limitY}px seam limits (frame ${s.frameW}×${s.frameH})`);
      }
      if (tinted && meanSat > BULLET_SATURATION_MAX) {
        throw new Error(`strip "${name}" frame ${f} has mean saturation ${meanSat.toFixed(2)}, over ${BULLET_SATURATION_MAX} (a tinted/floor strip must be white)`);
      }
    }
  }
}

/** Prove one just-built strip before it is placed into a category atlas. */
function assertOwnStrip(
  name: string,
  sheet: Img,
  meta: EmittedEffect,
  allowEmpty = false,
  allowLongAxisFill = false,
): void {
  const expectedW = (meta.frames - 1) * meta.stride + meta.frameW;
  if (meta.x !== 0 || meta.y !== 0 || sheet.w !== expectedW || sheet.h !== meta.frameH) {
    throw new Error(`strip "${name}" build is ${sheet.w}×${sheet.h} at ${meta.x},${meta.y}, expected ${expectedW}×${meta.frameH} at 0,0`);
  }
  assertPackedStrip(name, sheet, meta, allowEmpty, allowLongAxisFill);
}

/** Mirror the loader's shared-sheet strip gate, including x/y and last-frame end. */
function assertPackedStrip(
  name: string,
  sheet: Img,
  meta: EmittedEffect,
  allowEmpty = false,
  allowLongAxisFill = false,
): void {
  if (meta.stride < meta.frameW) {
    throw new Error(`strip "${name}" stride ${meta.stride} is less than frameW ${meta.frameW}`);
  }
  const { right: lastRight, bottom } = stripEnd(
    meta.x, meta.y, meta.frames, meta.stride, meta.frameW, meta.frameH,
  );
  if (meta.x < 0 || meta.y < 0 || lastRight > sheet.w || bottom > sheet.h) {
    throw new Error(`strip "${name}" runs to ${lastRight}×${bottom}, past the ${sheet.w}×${sheet.h} atlas`);
  }
  const limitX = allowLongAxisFill ? meta.frameW : meta.frameW - 2 * FX_PAD;
  const limitY = meta.frameH - 2 * FX_PAD;
  for (let f = 0; f < meta.frames; f++) {
    const fx = meta.x + f * meta.stride;
    const { ex, ey, meanSat } = measureFrame(sheet, fx, meta.y, meta.frameW, meta.frameH);
    if (ex === 0 || ey === 0) {
      if (allowEmpty) continue;
      throw new Error(`strip "${name}" frame ${f} has no non-transparent pixel`);
    }
    if (allowLongAxisFill && ex !== meta.frameW) {
      throw new Error(
        `laser body "${name}" frame ${f} paints ${ex}px on +x, expected full frameW ${meta.frameW}px for a seamless body`,
      );
    }
    if (!frameClearsPadding(ex, ey, meta.frameW, meta.frameH, FX_PAD, allowLongAxisFill)) {
      throw new Error(`strip "${name}" frame ${f} paints ${ex}×${ey}px, over the ${limitX}×${limitY}px seam limits`);
    }
    if (meta.color === 'tinted' && meanSat > BULLET_SATURATION_MAX) {
      throw new Error(`strip "${name}" frame ${f} has mean saturation ${meanSat.toFixed(2)}, over ${BULLET_SATURATION_MAX}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* PNG write + independent re-read.                                     */
/* ------------------------------------------------------------------ */
function encode(img: Img): Uint8Array {
  return encodePng(img.w, img.h, ColourType.RGBA, (x, y) => px(img, x, y));
}
function writeVerified(path: string, img: Img): void {
  const bytes = encode(img);
  const back = parsePng(bytes); // independent re-read, no shared state with encode
  if (back.width !== img.w || back.height !== img.h) {
    throw new Error(`${path}: re-read ${back.width}×${back.height}, expected ${img.w}×${img.h}`);
  }
  if (back.colourType !== ColourType.RGBA) throw new Error(`${path}: re-read colour type ${back.colourType}, expected 6 (RGBA)`);
  writeFileSync(path, bytes);
}

/* ------------------------------------------------------------------ */
/* Completeness: walk the folder, classify, stage, manifest.            */
/* ------------------------------------------------------------------ */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const CATEGORY_BY_DIR: Array<[RegExp, string]> = [
  [/Bullet Pack\/Bullet Pack\//, 'enemy-bullets'],
  [/\/Explosions\//, 'explosions'],
  [/\/Misc\//, 'misc'],
  [/\/Missiles\//, 'missiles'],
  [/\/Player Bullets\//, 'player-bullets'],
  [/\/Player Ship\//, 'player-ship'],
  [/^Lasers\/|\/Lasers\//, 'lasers'],
];
function categoryOf(rel: string): string {
  for (const [re, cat] of CATEGORY_BY_DIR) if (re.test(rel)) return cat;
  return 'other';
}

function framesFromName(file: string): number {
  const m = file.match(/strip(\d+)/i);
  return m ? Number(m[1]) : 1;
}

function orientationGuess(cat: string, file: string): string {
  if (cat === 'player-bullets') return 'up (-y)';
  if (cat === 'missiles') return file.startsWith('Missiles_Exp') ? 'radial' : 'up (-y), banking';
  if (cat === 'lasers') return 'vertical beam → rotated 90° to +x on import (rule 7)';
  if (cat === 'enemy-bullets' && /Lines/i.test(file)) return 'horizontal (+x)';
  if (cat === 'player-ship' && /Thruster/i.test(file)) return 'up (-y) exhaust';
  return 'radial / none';
}

function suggestedConsumer(cat: string, file: string): string {
  if (cat === 'lasers') return 'laser skin body/cap on the laser atlas (assets.lasers) — src/render/laser-skin.ts; a base-campaign beam fires it';
  if (cat === 'missiles' && file.startsWith('Missiles_Exp')) return 'missile detonation fx reskin (assets.effects: missile.pop.tiny|mid|big) — src/render/procedural.ts; a base-campaign missile fires it';
  if (cat === 'missiles') return 'missile body on the missile atlas (assets.missiles) — src/render/procedural.ts; a base-campaign firer launches it';
  if (cat === 'player-ship' && /Thruster/i.test(file)) return 'live player thrust/residue strip (assets.playerEffects) — src/main.ts';
  if (cat === 'player-ship' && /Bomb/i.test(file)) return 'live presentation-only bomb strip (assets.playerEffects) — src/main.ts';
  if (cat === 'player-ship' && /Option/i.test(file)) return 'live dedicated option strip (assets.playerEffects) — src/main.ts';
  if (cat === 'player-ship') return 'live five-bank back-wing/core strip (assets.ship) beneath the v4 heroine — src/main.ts';
  // The two shadowed coin twins are results-card tally skins; all ten Misc PNGs
  // are consumed, though the shadows remain deliberately absent from field items.
  if (cat === 'misc' && /_strip6\.png$/i.test(file) && !/noshadow/i.test(file)) {
    return 'results-card coin tally (assets.pickups: pickup.tally.coin.gold/silver) — the shadowed twin on the lit ending card, where a cast shadow is correct';
  }
  if (cat === 'misc') return 'item/tally skin — all 10 coin/gem/bar strips are consumed as assets.pickups';
  return 'unclassified';
}

/* ------------------------------------------------------------------ */
/* README (provenance)                                                  */
/* ------------------------------------------------------------------ */
function buildReadme(root: string, notes: { tip: string; quick: string }, counts: { consumed: number; staged: number; skipped: number; total: number; strips: number; effects: number; playerEffects: number; lasers: number; missiles: number; pickups: number }): string {
  return `# bulletpack — imported native-strip reskin (provenance)

**Generated** by \`bun tools/import-bulletpack.ts\`. Do not hand-edit; edit
\`tools/bulletpack-map.json\` and regenerate.

## Source

- Imported from a local folder named **BulletPack** (\`${root}\`).
- This is a **reskin** (pack format 1) in the engine's **native strip format**:
  shared category atlases — \`bullets/bullets.png\`,
  \`explosions/explosions.png\`, \`lasers/lasers.png\`,
  \`missiles/missiles.png\`, \`misc/pickups.png\`, and
  \`player/player-effects.png\` — plus \`player/ship.png\`. Every strip has explicit
  placement; effects/lasers/missiles/pickups repeat their category \`src\` and
  carry \`x\`/\`y\`/\`stride\`.
  It changes no simulation, so a mismatch **warns**, never refuses — replay-safe.
- **Folder taxonomy.** The emitted tree mirrors the source pack's kebab-case
  categories instead of a flat root: \`bullets/\` (the packed sheet), \`explosions/\`
  (burst + death-tier + missile-detonation strips), \`lasers/\` (beam bodies +
  caps), \`missiles/\` (missile bodies) and \`misc/\` (coin/gem/bar pickups).
  \`pack.json\`, \`README.md\` and \`extra/\` stay at the root; every manifest asset
  string carries its subpath.
- **Complete player binding**: all 10 \`Player Ship/\` PNGs are live: five bank
  poses, one option strip, three thrust states, two residue strips and three bomb
  animations. No image remains staged.

## What was consumed

- **${counts.strips}** complete bullet strips on \`bullets/bullets.png\`: 16 tinted
  floor names plus baked enemy/player names. All logical source frames are kept;
  multi-frame strips loop, and directional art is split before +x rotation.
- **${counts.effects}** effect strips on \`explosions/explosions.png\`, including
  all 8 Explosions files and the 3 missile detonations.
- **${counts.lasers}** laser strips on \`lasers/lasers.png\` (8 bodies + 3 caps).
- **${counts.missiles}** missile bodies on \`missiles/missiles.png\` (12 five-frame
  bodies + the 17-frame massive body).
- **${counts.pickups}** pickup strips on \`misc/pickups.png\`: 4 coins, 5 gems and
  1 bar. The two shadowed coins are results-card tally skins, not staged files.
- **1** five-bank ship strip plus **${counts.playerEffects}** option/thruster/bomb
  strips on the player atlas. Their consumers are presentation-only and tick-clocked.
- **${counts.consumed}** source files curated in total (see
  \`tools/bulletpack-map.json\` for the exact frame/rotate/fit per strip).

This is file-level completeness, not a visual-fidelity sign-off. Original RGB
reachability for tintable floor projections, result-tally frame usage, short-lived
effect tails, laser tiling seams and painted-content sizing remain explicit
browser-audit items in \`docs/assets.md §8\`.

## Licence and provenance

- Product: [16Bit Bullets, Explosions & Misc Asset Pack](https://jinvorionstg.itch.io/bullet-asset-pack-top-down-or-shmup-classic-bullet-hell-style)
  by **J i m** (itch.io: \`jinvorionstg\`).
- Purchase confirmed by the user on **2026-07-20**. The creator's public product-page
  statement permits use however desired, including commercial use.
- Purchase/use permission does not grant redistribution of the source sprites.
  Therefore \`packs/bulletpack/\` remains **\`.gitignore\`d**; only this importer
  and its semantic map are committed. Generate the pack only for an explicit
  purchaser-local audit, select it with \`?pack=bulletpack\`, and remove it again
  afterward. It is not a production or distributable project pack.

## The two artist notes shipped in the folder (verbatim)

> **Tiny tip.txt**
> ${notes.tip.split('\n').map((l) => l.trim()).filter(Boolean).join('\n> ')}

> **Quick note.txt**
> ${notes.quick.split('\n').map((l) => l.trim()).filter(Boolean).join('\n> ')}

## Completeness

- **${counts.staged}** image files are staged. The expected value is zero: all
  purchased PNGs now have named runtime consumers.
- **${counts.skipped}** pure-junk files (\`.DS_Store\`, author \`.txt\` notes) are
  counted in the total but not listed — they left the ledger by user directive.
- Every one of the **${counts.total}** files in the folder is accounted for
  exactly once: \`consumed + staged + skipped = ${counts.total}\` (the
  \`files[]\` array in \`extra/extras.json\` lists the ${counts.consumed} + ${counts.staged}
  non-junk ones).
`;
}

/* ------------------------------------------------------------------ */
/* Emitted taxonomy: the pack mirrors the source's kebab-case folders.   */
/* ------------------------------------------------------------------ */
// Report 3 (decisions-asset-fidelity.md): the emitted pack keeps a folder
// taxonomy instead of a flat ~50-file root, so the art stays navigable. Each
// manifest SECTION lands in its own kebab-case folder (the same names `extra/`
// already uses). Each section owns ONE shared atlas; `pack.json`/`README.md` stay
// at the root and `extra/` is unchanged. The manifest strings carry subpaths; the
// loader (`fileUrl` string-joins), `tools/serve.ts` (`normalize`+`join`) and
// `tools/copy-packs.ts` (recursive `cp`) all handle it — no filename-only
// assumption survives anywhere in that path.
const BULLETS_DIR = 'bullets';
const EXPLOSIONS_DIR = 'explosions';
const LASERS_DIR = 'lasers';
const MISSILES_DIR = 'missiles';
const MISC_DIR = 'misc';
const PLAYER_DIR = 'player';

/**
 * The importer's own taxonomy self-check (binding "TESTS TO GRAFT"): every asset
 * the manifest names must carry a category subpath AND exist at it under `outDir`.
 * A flat filename, or a manifest ↔ tree mismatch, fails the import loudly — the
 * same discipline `assertNativeBulletSheet`/`assertPackedStrip` apply to pixels.
 */
function assertTaxonomy(
  outDir: string,
  bulletsSheet: string,
  sections: Record<string, EmittedEffect>[],
): void {
  const paths = new Set([bulletsSheet, ...sections.flatMap((s) => Object.values(s).map((m) => m.src))]);
  for (const p of paths) {
    if (!p.includes('/')) throw new Error(`taxonomy: emitted asset "${p}" has no category folder`);
    if (!existsSync(join(outDir, p))) {
      throw new Error(`taxonomy: manifest names "${p}" but no file was written there`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* main                                                                 */
/* ------------------------------------------------------------------ */
function main(): void {
  const repo = join(import.meta.dir, '..');
  const root = process.argv[2] ?? join(process.env.HOME ?? '', 'Downloads/BulletPack');
  const outDir = join(repo, 'packs', 'bulletpack');
  const extraDir = join(outDir, 'extra');

  const mapPath = join(import.meta.dir, 'bulletpack-map.json');
  const map = JSON.parse(readFileSync(mapPath, 'utf8')) as BulletPackMap;

  // Fail on an incomplete/misaligned source ledger before deleting the previous
  // generated pack. This is the cell-level complement to the later file walk.
  const sourceFrameCounts = assertBulletCellCompleteness(root, map);
  for (const section of [map.effects, map.lasers, map.missiles, map.pickups, map.player.effects]) {
    for (const [name, m] of Object.entries(section)) {
      if (name.startsWith('$')) continue;
      const previous = sourceFrameCounts.get(m.src);
      if (previous !== undefined && previous !== m.strip) {
        throw new Error(`${m.src}: inconsistent strip counts ${previous} and ${m.strip}`);
      }
      sourceFrameCounts.set(m.src, m.strip);
    }
  }
  sourceFrameCounts.set(map.player.ship.src, map.player.ship.strip);

  // Fresh output tree (art only — safe to wipe, it is regenerable & gitignored).
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  mkdirSync(extraDir, { recursive: true });

  const log: string[] = [];
  const consumedSrc = new Map<string, string[]>(); // rel src -> [strip/effect names]
  const noteConsumed = (src: string, name: string) => {
    const a = consumedSrc.get(src) ?? []; a.push(name); consumedSrc.set(src, a);
  };
  // A map section may carry `$`-prefixed doc keys inline (a `$grammar`/`$gem-reskins`
  // note beside the strips it explains); they are commentary, not strips, so every
  // strip loop skips them — the same discipline `variantsDuplicate` already applies.
  const mapStrips = <T,>(o: Record<string, T>): [string, T][] =>
    Object.entries(o).filter(([k]) => !k.startsWith('$'));

  /* --- assemble bullet strips (floor + variants + shots) --- */
  const entries: StripEntry[] = [];
  for (const cell of BULLET_CELLS) {
    const m = map.floor[cell];
    if (!m) throw new Error(`bulletpack-map.json: no floor mapping for cell "${cell}"`);
    entries.push({ name: cell, frames: loadFrames(root, m, true), color: 'tinted', mode: m.mode ?? 'once', ticksPerFrame: m.ticksPerFrame ?? 1 });
    noteConsumed(m.src, cell);
  }
  for (const [name, m] of mapStrips(map.variants)) {
    entries.push({ name, frames: loadFrames(root, m, false), color: 'baked', mode: m.mode ?? 'once', ticksPerFrame: m.ticksPerFrame ?? 1 });
    noteConsumed(m.src, name);
  }
  for (const [name, m] of mapStrips(map.shots)) {
    entries.push({ name, frames: loadFrames(root, m, false), color: 'baked', mode: m.mode ?? 'once', ticksPerFrame: m.ticksPerFrame ?? 1 });
    noteConsumed(m.src, name);
  }

  const { sheet, strips } = packBulletSheet(entries);
  assertNativeBulletSheet(sheet, strips);
  mkdirSync(join(outDir, BULLETS_DIR), { recursive: true });
  writeVerified(join(outDir, BULLETS_DIR, 'bullets.png'), sheet);
  const bulletsSheetPath = `${BULLETS_DIR}/bullets.png`;
  log.push(`assembled ${bulletsSheetPath} (${sheet.w}×${sheet.h}) — ${entries.length} strips — coverage + seam + saturation self-check PASSED`);

  /* --- player ship (one native five-bank strip) --- */
  // Build through the same union-crop + transparent-margin path as an effect so
  // every bank keeps its native pixels while satisfying the loader's seam gate.
  // The shell selects banks from deterministic horizontal intent; this manifest
  // still describes one ordinary horizontal strip and changes no simulation.
  const { sheet: shipSheet, meta: shipMeta } = buildEffectStrip(root, 'ship', map.player.ship);
  assertOwnStrip('ship', shipSheet, shipMeta);
  const shipPath = `${PLAYER_DIR}/ship.png`;
  mkdirSync(join(outDir, PLAYER_DIR), { recursive: true });
  writeVerified(join(outDir, shipPath), shipSheet);
  noteConsumed(map.player.ship.src, 'ship');
  const shipManifest = {
    src: shipPath,
    frameW: shipMeta.frameW,
    frameH: shipMeta.frameH,
    frames: shipMeta.frames,
    stride: shipMeta.stride,
    ticksPerFrame: shipMeta.ticksPerFrame,
    mode: shipMeta.mode,
    color: shipMeta.color,
    contentW: shipMeta.contentW,
    contentH: shipMeta.contentH,
    banking: 'five-way' as const,
  };
  log.push(`assembled ${shipPath} (${shipSheet.w}×${shipSheet.h}) — 5 bank poses — seam self-check PASSED`);

  /* --- effects (one shared category atlas) --- */
  const effectBuilds: BuiltCategoryStrip[] = [];
  for (const [name, m] of mapStrips(map.effects)) {
    const { sheet: fxSheet, meta } = buildEffectStrip(root, name, m);
    assertOwnStrip(name, fxSheet, meta, m.allowEmpty === true);
    effectBuilds.push({ name, sheet: fxSheet, meta, allowEmpty: m.allowEmpty });
    noteConsumed(m.src, name);
  }
  const effectsAtlasPath = `${EXPLOSIONS_DIR}/explosions.png`;
  const { sheet: effectsSheet, strips: effectsManifest } = packCategoryAtlas(effectBuilds, effectsAtlasPath);
  mkdirSync(join(outDir, EXPLOSIONS_DIR), { recursive: true });
  writeVerified(join(outDir, effectsAtlasPath), effectsSheet);
  log.push(`assembled ${effectsAtlasPath} (${effectsSheet.w}×${effectsSheet.h}) — ${effectBuilds.length} strips — x/y/stride + seam self-check PASSED`);

  /* --- player option / thrust / bomb strips (one shared category atlas) --- */
  const playerEffectBuilds: BuiltCategoryStrip[] = [];
  for (const [name, m] of mapStrips(map.player.effects)) {
    const { sheet: playerSheet, meta } = buildEffectStrip(root, name, m);
    assertOwnStrip(name, playerSheet, meta, m.allowEmpty === true);
    playerEffectBuilds.push({ name, sheet: playerSheet, meta, allowEmpty: m.allowEmpty });
    noteConsumed(m.src, name);
  }
  const playerEffectsAtlasPath = `${PLAYER_DIR}/player-effects.png`;
  const { sheet: playerEffectsSheet, strips: playerEffectsManifest } =
    packCategoryAtlas(playerEffectBuilds, playerEffectsAtlasPath);
  writeVerified(join(outDir, playerEffectsAtlasPath), playerEffectsSheet);
  log.push(`assembled ${playerEffectsAtlasPath} (${playerEffectsSheet.w}×${playerEffectsSheet.h}) — ${playerEffectBuilds.length} strips — x/y/stride + seam self-check PASSED`);

  const allEffectsManifest: Record<string, EmittedEffect> = {
    ...effectsManifest,
    ...playerEffectsManifest,
  };

  /* --- lasers (one shared category atlas, frames rotated +x) --- */
  const laserBuilds: BuiltCategoryStrip[] = [];
  for (const [name, m] of mapStrips(map.lasers)) {
    const skin = BASE_LASER_SKINS[name];
    const laserBody = (LASER_BODY_CELLS as readonly string[]).includes(name) && skin?.body === name;
    const tileBody = laserBody && skin?.fit === 'tile';
    const { sheet: lzSheet, meta } = buildLaserStrip(root, name, m, laserBody, tileBody);
    assertOwnStrip(name, lzSheet, meta, false, laserBody);
    laserBuilds.push({ name, sheet: lzSheet, meta, allowLongAxisFill: laserBody });
    noteConsumed(m.src, name);
  }
  const lasersAtlasPath = `${LASERS_DIR}/lasers.png`;
  const { sheet: lasersSheet, strips: lasersManifest } = packCategoryAtlas(laserBuilds, lasersAtlasPath);
  mkdirSync(join(outDir, LASERS_DIR), { recursive: true });
  writeVerified(join(outDir, lasersAtlasPath), lasersSheet);
  log.push(`assembled ${lasersAtlasPath} (${lasersSheet.w}×${lasersSheet.h}) — ${laserBuilds.length} strips — x/y/stride + seam self-check PASSED`);

  /* --- missiles (one shared category atlas, frames rotated +x) --- */
  // Missile rows have the same ORIENTED shape as laser rows (long, thin,
  // nose/beam along +x), so they build through `buildLaserStrip`, then share one
  // category atlas — `assets.missiles` is the fourth texture in `main.ts`.
  const missileBuilds: BuiltCategoryStrip[] = [];
  for (const [name, m] of mapStrips(map.missiles)) {
    const { sheet: msSheet, meta } = buildLaserStrip(root, name, m);
    assertOwnStrip(name, msSheet, meta);
    missileBuilds.push({ name, sheet: msSheet, meta });
    noteConsumed(m.src, name);
  }
  const missilesAtlasPath = `${MISSILES_DIR}/missiles.png`;
  const { sheet: missilesSheet, strips: missilesManifest } = packCategoryAtlas(missileBuilds, missilesAtlasPath);
  mkdirSync(join(outDir, MISSILES_DIR), { recursive: true });
  writeVerified(join(outDir, missilesAtlasPath), missilesSheet);
  log.push(`assembled ${missilesAtlasPath} (${missilesSheet.w}×${missilesSheet.h}) — ${missileBuilds.length} strips — x/y/stride + seam self-check PASSED`);

  /* --- pickups (one shared category atlas, radial — no rotate) --- */
  // Coins/gems/bar are RADIAL (no heading, rule 7 moot), so they build through the
  // SAME `buildEffectStrip` an explosion uses (squared, no rotation), then share
  // one category atlas — `assets.pickups` is the fifth texture in `main.ts`. The
  // Silver suffix trap is handled in the MAP (`strip: 6` hand-declared), not here.
  const pickupBuilds: BuiltCategoryStrip[] = [];
  for (const [name, m] of mapStrips(map.pickups)) {
    const { sheet: pkSheet, meta } = buildEffectStrip(root, name, m);
    assertOwnStrip(name, pkSheet, meta);
    pickupBuilds.push({ name, sheet: pkSheet, meta });
    noteConsumed(m.src, name);
  }
  const pickupsAtlasPath = `${MISC_DIR}/pickups.png`;
  const { sheet: pickupsSheet, strips: pickupsManifest } = packCategoryAtlas(pickupBuilds, pickupsAtlasPath);
  mkdirSync(join(outDir, MISC_DIR), { recursive: true });
  writeVerified(join(outDir, pickupsAtlasPath), pickupsSheet);
  log.push(`assembled ${pickupsAtlasPath} (${pickupsSheet.w}×${pickupsSheet.h}) — ${pickupBuilds.length} strips — x/y/stride + seam self-check PASSED`);

  /* --- manifest --- */
  const manifest = {
    format: 1,
    name: 'bulletpack',
    version: '3.1.0',
    author: 'J i m (itch.io: jinvorionstg)',
    license: 'Commercial use permitted by the creator; purchased 2026-07-20. Source-sprite redistribution not granted; see README.md.',
    description: 'File-complete native-strip binding imported from the purchased BulletPack: baked fired bullets, explosions, lasers, missiles, pickups, plus the five-bank player ship, options, thrust and bomb animation. All 117 PNG files are consumed or represented; visual-fidelity audit items remain documented; purchased pixels stay gitignored and regenerate from the purchaser copy.',
    assets: {
      bullets: { sheet: bulletsSheetPath, strips },
      ship: shipManifest,
      filter: 'nearest' as const,
      effects: allEffectsManifest,
      lasers: lasersManifest,
      missiles: missilesManifest,
      pickups: pickupsManifest,
    },
  };
  const result = validateManifest(manifest, 'bulletpack');
  if ('errors' in result) {
    throw new Error(`validateManifest REJECTED the generated pack.json:\n  ${result.errors.join('\n  ')}`);
  }
  writeFileSync(join(outDir, 'pack.json'), JSON.stringify(manifest, null, 2) + '\n');
  log.push('pack.json — validateManifest ACCEPTED (format 1, native strips)');

  assertTaxonomy(outDir, manifest.assets.bullets.sheet, [
    { ship: { ...shipMeta, src: shipPath } },
    allEffectsManifest,
    lasersManifest,
    missilesManifest,
    pickupsManifest,
  ]);
  log.push(
    `taxonomy self-check — every asset lives under a category folder ` +
      `(${BULLETS_DIR}/ ${EXPLOSIONS_DIR}/ ${LASERS_DIR}/ ${MISSILES_DIR}/ ${MISC_DIR}/)`,
  );

  /* --- completeness walk + staging + extras.json --- */
  const files = walk(root).map((abs) => relative(root, abs)).sort();
  const duplicates = Object.fromEntries(
    Object.entries(map.variantsDuplicate ?? {}).filter(([k]) => !k.startsWith('$')),
  );
  interface Entry {
    category: string; file: string; disposition: string;
    width: number | null; height: number | null; frames: number;
    frameW: number | null; frameH: number | null;
    orientation: string; suggestedConsumer: string;
  }
  const outEntries: Entry[] = [];
  let consumed = 0, staged = 0, skipped = 0;

  for (const rel of files) {
    const abs = join(root, rel);
    const file = basename(rel);
    const cat = categoryOf(rel);

    if (file === '.DS_Store') { skipped++; continue; }
    if (rel.toLowerCase().endsWith('.txt')) { skipped++; continue; }
    if (!rel.toLowerCase().endsWith('.png')) {
      outEntries.push({ category: cat, file: rel, disposition: `skipped: non-image (${file})`, width: null, height: null, frames: 0, frameW: null, frameH: null, orientation: '-', suggestedConsumer: '-' });
      skipped++; continue;
    }

    const dec = decodePng(new Uint8Array(readFileSync(abs)));
    const frames = sourceFrameCounts.get(rel) ?? framesFromName(file);
    if (dec.width % frames !== 0) {
      throw new Error(`${rel}: ledger width ${dec.width} is not divisible by ${frames} frames`);
    }
    const entry: Entry = {
      category: cat, file: rel, disposition: '',
      width: dec.width, height: dec.height, frames,
      frameW: Math.floor(dec.width / frames), frameH: dec.height,
      orientation: orientationGuess(cat, file), suggestedConsumer: suggestedConsumer(cat, file),
    };

    const names = consumedSrc.get(rel);
    if (names) {
      entry.disposition = `consumed → ${names.join(', ')}`;
      consumed++;
    } else if (rel in duplicates) {
      entry.disposition = `consumed (duplicate of ${duplicates[rel]!.of}) → ${duplicates[rel]!.representedBy}`;
      consumed++;
    } else {
      const dst = join(extraDir, cat, file);
      mkdirSync(join(extraDir, cat), { recursive: true });
      copyFileSync(abs, dst);
      entry.disposition = `staged → extra/${cat}/${file}`;
      staged++;
    }
    outEntries.push(entry);
  }

  // Every mapped src must have matched a real file.
  for (const src of consumedSrc.keys()) {
    if (!files.includes(src)) throw new Error(`bulletpack-map.json names a source not in the folder: "${src}"`);
  }
  for (const src of Object.keys(duplicates)) {
    if (!files.includes(src)) throw new Error(`bulletpack-map.json variantsDuplicate names a source not in the folder: "${src}"`);
  }

  // Each walked file increments exactly ONE of consumed/staged/skipped, so the
  // honest total is their sum — 121 here. `outEntries.length` is NOT that total:
  // the four pure-junk files (2×.DS_Store, 2×.txt) are counted in `skipped` but
  // deliberately not listed in `files` (they left the ledger by user directive,
  // commit e79e148), so `files.length === consumed + staged` and understates the
  // folder by `skipped`. Using it as `total` (the earlier bug) left
  // consumed+staged+skipped ≠ total.
  const total = consumed + staged + skipped;
  writeFileSync(join(extraDir, 'extras.json'), JSON.stringify({
    source: root,
    generatedBy: 'tools/import-bulletpack.ts',
    license: 'Commercial use permitted by J i m (jinvorionstg); purchased 2026-07-20. No source-sprite redistribution.',
    dispositions: {
      consumed: 'all logical frames are packed into shared category atlases (bullets, explosions, lasers, missiles, pickups, player effects) or the native ship strip under names the base four-stage campaign draws. Every source row declares its full equal-width strip count; no bullet cell crop is allowed.',
      staged: 'unexpected PNGs only. The expected count is zero: the player ship, option, all thrusters and particles, all three bomb strips, every bullet/effect/laser/missile/pickup now have runtime consumers.',
      skipped: 'pure junk not tracked in files[] (.DS_Store, author .txt notes). Counted in total, not listed.',
    },
    totals: { total, consumed, staged, skipped },
    files: outEntries,
  }, null, 2) + '\n');

  const notes = {
    tip: readFileSync(join(root, 'Bullet Pack/Bullet Pack/Tiny tip.txt'), 'utf8'),
    quick: readFileSync(join(root, 'Bullet Pack/Quick note.txt'), 'utf8'),
  };
  writeFileSync(join(outDir, 'README.md'), buildReadme(root, notes, {
    consumed, staged, skipped, total,
    strips: entries.length, effects: Object.keys(effectsManifest).length,
    playerEffects: Object.keys(playerEffectsManifest).length,
    lasers: Object.keys(lasersManifest).length,
    missiles: Object.keys(missilesManifest).length,
    pickups: Object.keys(pickupsManifest).length,
  }));

  /* --- report --- */
  process.stdout.write(`\nBulletPack native import → ${outDir}\n`);
  for (const l of log) process.stdout.write(`  ✓ ${l}\n`);
  process.stdout.write(`\nCompleteness: ${total} files — ${consumed} consumed, ${staged} staged, ${skipped} skipped\n`);
  process.stdout.write(`extras.json manifest: ${join(extraDir, 'extras.json')}\n`);
}

if (import.meta.main) main();
