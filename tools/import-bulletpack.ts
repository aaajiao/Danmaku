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
 *   - `bullets.png` — ONE shared sheet carrying every bullet strip, placed with
 *     explicit x/y. It holds the 16 built-in `BULLET_CELLS` as **tinted**
 *     (whitened) native strips — animation frames kept, each fit to a coherent
 *     per-cell size so the reskinned curtain stays readable — plus the coloured
 *     BulletPack designs as **baked** native strips keyed by the names the base
 *     four-stage campaign already fires (`BULLET_VARIANTS`, e.g. `orb.medium.decree`,
 *     `needle.pin`): `nativeBulletAtlas` keeps a pack strip over the floor-cell
 *     alias, so a baked design reaches real play the moment its strip carries that
 *     family's fired name — no companion content pack. Base content fires those
 *     names tint-free, so one baked colour per name is safe. Pixel-exact, no
 *     whiten, no resample; only lossless crop / 90° rotation. Coverage is
 *     deliberately PARTIAL — a fired name is baked only where a BulletPack design
 *     fits its orientation and bullet size; the rest keep aliasing to their
 *     reskinned floor cell, and BulletPack's oversized beams / surplus shots stage.
 *   - `<effect>.png` — one PNG per explosion strip, native colour and animation,
 *     each frame re-padded so it clears the inter-frame seam gate. Declared in
 *     `assets.effects`.
 *   - `pack.json` — `assets.bullets = { sheet, strips }` + `assets.effects`,
 *     validated in-process by the real `validateManifest` (a failure throws).
 *     **No ship, no HUD** this round: player/enemy/boss 形象 are out of scope by
 *     user directive (2026-07-22) and the coins/gems HUD icons belong to the
 *     later pickup round — the ship/HUD seams stay engine machinery.
 *   - `extra/<category>/…` + `extra/extras.json` — every source file this round
 *     does not consume, staged verbatim with its disposition. The completeness
 *     law: every file in the folder is accounted for exactly once.
 *   - `README.md` — provenance (source folder, missing-LICENSE flag, artist notes).
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
 * `assertNativeBulletSheet` / `assertEffectStrip` below replicate them headless so
 * a bad sheet fails IN THIS TOOL before a browser ever loads it: floor-cell
 * coverage, per-strip bounds, the per-frame inter-frame seam (`frameW − 2·FX_PAD`),
 * and mean saturation on tinted strips (floor cells are measured as tinted, since
 * the engine draws them with the per-instance tint regardless of what they declare).
 *
 * ## Licence hygiene
 *
 * BulletPack ships **no LICENSE file** and names no author. The whole
 * `packs/bulletpack/` tree is `.gitignore`d — this TOOL and its MAP are the
 * committed artefacts; the ART is not. The pack is regenerable from the folder
 * on demand, so nothing derived from unconfirmed third-party art is committed.
 *
 * ## Why it decodes PNGs itself
 *
 * `tools/png.ts`'s `parsePng` only re-reads the unfiltered PNGs this repo writes;
 * BulletPack's exporter uses adaptive filters and (some) palettes. So this tool
 * decodes through `tools/png-decode.ts` (a full decoder) and encodes the
 * assembled sheets through `tools/png.ts`'s `encodePng`, then re-reads each
 * output through `parsePng` to prove it round-trips.
 */

import { mkdirSync, writeFileSync, copyFileSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { BULLET_CELLS, FX_PAD } from '../src/render/procedural';
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
interface Img {
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

/** Slice one frame out of a horizontal strip (equal-width frames). */
function frameOf(img: Img, frames: number, frame: number): Img {
  const fw = Math.floor(img.w / frames);
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
  strip?: number; // frame count (a horizontal strip); 1 or absent = single
  crop?: { x: number; y: number; w: number; h: number };
  rotate?: number; // clockwise degrees to bring directional art to +x (rule 7)
  fit?: number; // FLOOR only: fit the longer painted axis to this many px
  mode?: 'loop' | 'once';
  ticksPerFrame?: number;
  note?: string;
}
interface EffectMap {
  src: string;
  strip: number;
  mode?: 'loop' | 'once';
  ticksPerFrame?: number;
  note?: string;
}
interface Map {
  floor: Record<string, StripMap>;
  variants: Record<string, StripMap>;
  shots: Record<string, StripMap>;
  effects: Record<string, EffectMap>;
  variantsDuplicate?: Record<string, string>;
}

/**
 * Load a source into its processed frames.
 *  - floor (`whitenFit` true): crop → rotate → trim → fit → whiten → trim.
 *  - baked (`whitenFit` false): crop → rotate → trim. Pixel-exact, no resample.
 */
function loadFrames(root: string, m: StripMap, whitenFit: boolean): Img[] {
  const decoded = decodePng(new Uint8Array(readFileSync(join(root, m.src))));
  const whole = fromDecoded(decoded);
  const n = m.strip && m.strip > 1 ? m.strip : 1;
  const out: Img[] = [];
  for (let f = 0; f < n; f++) {
    let img = n > 1 ? frameOf(whole, n, f) : whole;
    if (m.crop) img = crop(img, m.crop.x, m.crop.y, m.crop.w, m.crop.h);
    if (m.rotate) img = rotate(img, m.rotate);
    img = trimAlpha(img, BULLET_ALPHA_PAINTED);
    if (whitenFit && m.fit) img = fitTo(img, m.fit);
    if (whitenFit) img = whiten(img);
    img = trimAlpha(img, BULLET_ALPHA_PAINTED);
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
    return { e, frameW, frameH, stripW: e.frames.length * frameW };
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
    const { e, frameW, frameH } = b;
    e.frames.forEach((frame, f) => {
      blitCentred(sheet, frame, x + f * frameW, y, frameW, frameH);
    });
    const s: EmittedStrip = { x, y, frameW, frameH, color: e.color };
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
/* Effects: one own-file strip per explosion, frames re-padded.         */
/* ------------------------------------------------------------------ */
interface EmittedEffect {
  src: string;
  frames: number;
  frameW: number;
  frameH: number;
  ticksPerFrame?: number;
  mode: 'loop' | 'once';
  color: Colour;
}

function buildEffectStrip(root: string, name: string, m: EffectMap): { sheet: Img; meta: EmittedEffect; file: string } {
  const whole = fromDecoded(decodePng(new Uint8Array(readFileSync(join(root, m.src)))));
  const n = m.strip;
  const fw = Math.floor(whole.w / n);
  const raw: Img[] = [];
  for (let f = 0; f < n; f++) raw.push(crop(whole, f * fw, 0, fw, whole.h));

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
  if (maxX < minX) { minX = 0; minY = 0; maxX = fw - 1; maxY = whole.h - 1; }
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
  const meta: EmittedEffect = { src: file, frames: n, frameW, frameH, mode: m.mode ?? 'once', color: 'baked' };
  if ((m.ticksPerFrame ?? 1) !== 1) meta.ticksPerFrame = m.ticksPerFrame;
  return { sheet, meta, file };
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

/** Mirror `checkNativeBulletSheet` + `measureStripFrames` (loader.ts). */
function assertNativeBulletSheet(sheet: Img, strips: Record<string, EmittedStrip>): void {
  const floor = new Set<string>(BULLET_CELLS as readonly string[]);
  const missing = BULLET_CELLS.filter((c) => !(c in strips));
  if (missing.length > 0) throw new Error(`bullets.png missing floor cell(s): ${missing.join(', ')}`);

  for (const [name, s] of Object.entries(strips)) {
    const frames = s.frames ?? 1;
    const stride = s.frameW; // stride omitted in the emit ⇒ loader defaults to frameW
    if (s.x + frames * stride > sheet.w || s.y + s.frameH > sheet.h) {
      throw new Error(`strip "${name}" runs to ${s.x + frames * stride}×${s.y + s.frameH}, past the ${sheet.w}×${sheet.h} sheet`);
    }
    // Floor cells are drawn with the per-instance tint regardless of declared
    // colour, so they are measured as tinted (the loader forces this).
    const tinted = floor.has(name) || s.color === 'tinted';
    const limit = s.frameW - 2 * FX_PAD;
    for (let f = 0; f < frames; f++) {
      const { ex, ey, meanSat } = measureFrame(sheet, s.x + f * stride, s.y, s.frameW, s.frameH);
      if (Math.max(ex, ey) > limit) {
        throw new Error(`strip "${name}" frame ${f} paints ${ex}×${ey}px, over the ${limit}px seam limit (frameW ${s.frameW})`);
      }
      if (tinted && meanSat > BULLET_SATURATION_MAX) {
        throw new Error(`strip "${name}" frame ${f} has mean saturation ${meanSat.toFixed(2)}, over ${BULLET_SATURATION_MAX} (a tinted/floor strip must be white)`);
      }
    }
  }
}

/** Mirror `checkStripSheet` (loader.ts) for an own-file effect strip. */
function assertEffectStrip(name: string, sheet: Img, meta: EmittedEffect): void {
  const expectedW = meta.frames * meta.frameW;
  if (sheet.w !== expectedW || sheet.h !== meta.frameH) {
    throw new Error(`effect "${name}" sheet is ${sheet.w}×${sheet.h}, expected ${expectedW}×${meta.frameH}`);
  }
  const limit = meta.frameW - 2 * FX_PAD;
  for (let f = 0; f < meta.frames; f++) {
    const { ex, ey, meanSat } = measureFrame(sheet, f * meta.frameW, 0, meta.frameW, meta.frameH);
    if (Math.max(ex, ey) > limit) {
      throw new Error(`effect "${name}" frame ${f} paints ${ex}×${ey}px, over the ${limit}px seam limit`);
    }
    if (meta.color === 'tinted' && meanSat > BULLET_SATURATION_MAX) {
      throw new Error(`effect "${name}" frame ${f} has mean saturation ${meanSat.toFixed(2)}, over ${BULLET_SATURATION_MAX}`);
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
  if (cat === 'lasers') return 'vertical beam (tiled along length)';
  if (cat === 'enemy-bullets' && /Lines/i.test(file)) return 'horizontal (+x)';
  if (cat === 'player-ship' && /Thruster/i.test(file)) return 'up (-y) exhaust';
  return 'radial / none';
}

function suggestedConsumer(cat: string, file: string): string {
  if (cat === 'lasers') return 'laser system (src/sim/bullet.ts LaserSpec) — tiled beam body + separate hit-cap; needs a tiled-beam renderer';
  if (cat === 'missiles' && file.startsWith('Missiles_Exp')) return 'sprite-animation effect (missile impact)';
  if (cat === 'missiles') return 'missile entity (banking-frame sprite + exhaust) — needs a sprite-animation + entity round';
  if (cat === 'player-ship' && /Thruster/i.test(file)) return 'exhaust / engine-trail effect (deferred: player 形象 out of scope)';
  if (cat === 'player-ship' && /Bomb/i.test(file)) return 'bomb visual (BombSpec carries no sprite surface yet)';
  if (cat === 'player-ship' && /Option/i.test(file)) return 'dedicated option sprite (OptionSpec currently names a bullet cell)';
  if (cat === 'player-ship') return 'player 形象 — out of scope by user directive (2026-07-22)';
  if (cat === 'misc') return 'item skin (animated pickup) — pickup-variety round';
  return 'unclassified';
}

/* ------------------------------------------------------------------ */
/* README (provenance)                                                  */
/* ------------------------------------------------------------------ */
function buildReadme(root: string, notes: { tip: string; quick: string }, counts: { consumed: number; staged: number; skipped: number; total: number; strips: number; effects: number }): string {
  return `# bulletpack — imported native-strip reskin (provenance)

**Generated** by \`bun tools/import-bulletpack.ts\`. Do not hand-edit; edit
\`tools/bulletpack-map.json\` and regenerate.

## Source

- Imported from a local folder named **BulletPack** (\`${root}\`).
- This is a **reskin** (pack format 1) in the engine's **native strip format**:
  \`assets.bullets = { sheet, strips }\` (one packed \`bullets.png\`) plus
  \`assets.effects\` (one PNG per explosion). It changes no simulation, so a
  mismatch **warns**, never refuses — replay-safe.
- **No ship, no HUD** this round: player/enemy/boss 形象 are out of scope by user
  directive (2026-07-22); the coins/gems HUD icons belong to the later pickup round.

## What was consumed

- **${counts.strips}** bullet strips packed onto \`bullets.png\`: the 16 built-in
  cells (tinted/whitened, animation kept, coherently fit) plus baked \`role.family\`
  variants and player shot skins at native size/colour.
- **${counts.effects}** explosion strips as \`assets.effects\` (native colour +
  animation, frames re-padded for the seam gate).
- **${counts.consumed}** source files curated in total (see
  \`tools/bulletpack-map.json\` for the exact frame/rotate/fit per strip).

## Licence — UNCONFIRMED (do not distribute)

- The BulletPack folder contains **no LICENSE file** and **names no author**.
  Provenance is unverifiable from the files themselves.
- Under CLAUDE.md **rule 9** everything shipped must be original and licence-clean.
  This pack is therefore **\`.gitignore\`d** — the importer and its map are the
  committed artefacts; the derived art is not, and the pack is regenerable on demand.
- **Before this art is committed or distributed, confirm the source** and its terms.

## The two artist notes shipped in the folder (verbatim)

> **Tiny tip.txt**
> ${notes.tip.split('\n').map((l) => l.trim()).filter(Boolean).join('\n> ')}

> **Quick note.txt**
> ${notes.quick.split('\n').map((l) => l.trim()).filter(Boolean).join('\n> ')}

## Completeness

- **${counts.staged}** files this round does not use are copied verbatim under
  \`extra/<category>/\` (lasers, missiles, coins/gems, surplus player shots,
  oversized beams, and the explosions no death site fires yet), staged for their
  own future rounds.
- **${counts.skipped}** pure-junk files (\`.DS_Store\`, author \`.txt\` notes) are
  counted in the total but not listed — they left the ledger by user directive.
- Every one of the **${counts.total}** files in the folder is accounted for
  exactly once: \`consumed + staged + skipped = ${counts.total}\` (the
  \`files[]\` array in \`extra/extras.json\` lists the ${counts.consumed} + ${counts.staged}
  non-junk ones).
`;
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
  const map = JSON.parse(readFileSync(mapPath, 'utf8')) as Map;

  // Fresh output tree (art only — safe to wipe, it is regenerable & gitignored).
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  mkdirSync(extraDir, { recursive: true });

  const log: string[] = [];
  const consumedSrc = new Map<string, string[]>(); // rel src -> [strip/effect names]
  const noteConsumed = (src: string, name: string) => {
    const a = consumedSrc.get(src) ?? []; a.push(name); consumedSrc.set(src, a);
  };

  /* --- assemble bullet strips (floor + variants + shots) --- */
  const entries: StripEntry[] = [];
  for (const cell of BULLET_CELLS) {
    const m = map.floor[cell];
    if (!m) throw new Error(`bulletpack-map.json: no floor mapping for cell "${cell}"`);
    entries.push({ name: cell, frames: loadFrames(root, m, true), color: 'tinted', mode: m.mode ?? 'once', ticksPerFrame: m.ticksPerFrame ?? 1 });
    noteConsumed(m.src, cell);
  }
  for (const [name, m] of Object.entries(map.variants)) {
    entries.push({ name, frames: loadFrames(root, m, false), color: 'baked', mode: m.mode ?? 'once', ticksPerFrame: m.ticksPerFrame ?? 1 });
    noteConsumed(m.src, name);
  }
  for (const [name, m] of Object.entries(map.shots)) {
    entries.push({ name, frames: loadFrames(root, m, false), color: 'baked', mode: m.mode ?? 'once', ticksPerFrame: m.ticksPerFrame ?? 1 });
    noteConsumed(m.src, name);
  }

  const { sheet, strips } = packBulletSheet(entries);
  assertNativeBulletSheet(sheet, strips);
  writeVerified(join(outDir, 'bullets.png'), sheet);
  log.push(`assembled bullets.png (${sheet.w}×${sheet.h}) — ${entries.length} strips — coverage + seam + saturation self-check PASSED`);

  /* --- effects (one own-file strip per explosion) --- */
  const effectsManifest: Record<string, EmittedEffect> = {};
  for (const [name, m] of Object.entries(map.effects)) {
    const { sheet: fxSheet, meta, file } = buildEffectStrip(root, name, m);
    assertEffectStrip(name, fxSheet, meta);
    writeVerified(join(outDir, file), fxSheet);
    effectsManifest[name] = meta;
    noteConsumed(m.src, name);
    log.push(`assembled ${file} (${fxSheet.w}×${fxSheet.h}, ${meta.frames}×${meta.frameW}×${meta.frameH}) — seam self-check PASSED`);
  }

  /* --- manifest --- */
  const manifest = {
    format: 1,
    name: 'bulletpack',
    version: '2.0.0',
    author: 'Unknown — third-party BulletPack, source unconfirmed (see README.md)',
    license: 'UNCONFIRMED — no LICENSE file in source; not for distribution until provenance is verified (CLAUDE.md rule 9; see README.md)',
    description: 'Native-strip reskin imported from the third-party BulletPack folder: a packed bullet sheet (16 tinted floor cells + baked colour variants + player shot skins) and animated explosion effects. No ship/HUD (out of scope). Licence unconfirmed — gitignored, regenerable via tools/import-bulletpack.ts.',
    assets: {
      bullets: { sheet: 'bullets.png', strips },
      filter: 'nearest' as const,
      effects: effectsManifest,
    },
  };
  const result = validateManifest(manifest, 'bulletpack');
  if ('errors' in result) {
    throw new Error(`validateManifest REJECTED the generated pack.json:\n  ${result.errors.join('\n  ')}`);
  }
  writeFileSync(join(outDir, 'pack.json'), JSON.stringify(manifest, null, 2) + '\n');
  log.push('pack.json — validateManifest ACCEPTED (format 1, native strips)');

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
    const frames = framesFromName(file);
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
      entry.disposition = `consumed (duplicate) → ${duplicates[rel]}`;
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
    license: 'UNCONFIRMED — no LICENSE file in source folder',
    dispositions: {
      consumed: 'packed into the pack (bullets.png or an effect PNG) under a name the base four-stage campaign draws — a fired BULLET_VARIANTS name, a bare floor cell, or a fired effect. Play-reach for the four-stage game is tracked project-side in the consumption ledger; the tool cannot run the simulation, so "consumed" here means packed-and-named-by-the-base-campaign.',
      staged: 'copied verbatim to extra/<category>/ for a future round (lasers, missiles, coins/gems, surplus player shots, oversized beams, unreached explosions). No consumer this round.',
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
  }));

  /* --- report --- */
  process.stdout.write(`\nBulletPack native import → ${outDir}\n`);
  for (const l of log) process.stdout.write(`  ✓ ${l}\n`);
  process.stdout.write(`\nCompleteness: ${outEntries.length} files — ${consumed} consumed, ${staged} staged, ${skipped} skipped\n`);
  process.stdout.write(`extras.json manifest: ${join(extraDir, 'extras.json')}\n`);
}

main();
