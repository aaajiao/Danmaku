/**
 * Import the third-party **BulletPack** art folder into a local Danmaku pack.
 *
 *     bun tools/import-bulletpack.ts                 # default root: ~/Downloads/BulletPack
 *     bun tools/import-bulletpack.ts /path/to/BulletPack
 *
 * ## What it produces
 *
 * A complete **reskin** (format-1) pack at `packs/bulletpack/`:
 *   - `bullets.png` (256×64, the 16 `BULLET_CELLS`), `ship.png` (64×64),
 *     `life.png` / `bomb.png` (≤16×16 HUD icons) — assembled by curating one
 *     frame out of a BulletPack sprite per cell, per `tools/bulletpack-map.json`.
 *   - `pack.json` — validated in-process by the real `validateManifest`; a
 *     failure throws, it is never written half-valid.
 *   - `extra/<category>/…` — every BulletPack file this reskin does NOT consume,
 *     copied verbatim and organised by category, staged for a future engine
 *     round (a laser system, a sprite-animation surface, missile entities…).
 *   - `extra/extras.json` — the machine-readable completeness manifest: EVERY
 *     source file with its disposition (consumed / staged / skipped), pixel
 *     dimensions, strip frame count, an orientation guess and a suggested future
 *     consumer. The completeness law: every file in the folder is accounted for
 *     exactly once.
 *   - `README.md` — provenance: the source folder, the missing-LICENSE flag, and
 *     the two artist notes quoted verbatim.
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
 * `tools/png.ts`'s `parsePng` only re-reads the unfiltered PNGs this repo
 * writes; BulletPack's exporter uses adaptive filters and (some) palettes. So
 * this tool decodes through `tools/png-decode.ts` (a full decoder) and encodes
 * the assembled sheets through `tools/png.ts`'s `encodePng`, then re-reads each
 * output through `parsePng` to prove it round-trips.
 */

import { mkdirSync, writeFileSync, copyFileSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import {
  BULLET_CELLS,
  BULLET_GRID,
  BULLET_COLUMNS,
  BULLET_ROWS,
  MAX_CELL_EXTENT,
  SHIP_SIZE,
} from '../src/render/procedural';
import { ColourType, encodePng, parsePng } from './png';
import { decodePng, type DecodedImage } from './png-decode';
import { validateManifest } from '../src/packs/manifest';

/* ------------------------------------------------------------------ */
/* Loader thresholds, restated (they are private consts in loader.ts). */
/* These are the loader's judgement calls; kept in step by eye. If the  */
/* loader's numbers change, change these too — the whole point of       */
/* replicating them here is to fail in the tool, headless, before a     */
/* browser ever loads the sheet.                                        */
/* ------------------------------------------------------------------ */
const BULLET_ALPHA_PAINTED = 16; // loader.ts BULLET_ALPHA_PAINTED
const SATURATION_ALPHA_FLOOR = 128; // loader.ts SATURATION_ALPHA_FLOOR
const BULLET_SATURATION_MAX = 0.15; // loader.ts BULLET_SATURATION_MAX
const HUD_ICON_MAX = 16; // loader.ts HUD_ICON_MAX

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

/** Slice one frame out of a horizontal strip. */
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

/** Crop to the alpha≥threshold bounding box. Returns the image unchanged if empty. */
function trimAlpha(img: Img, threshold: number): Img {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (img.rgba[(y * img.w + x) * 4 + 3]! >= threshold) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) return img;
  return crop(img, minX, minY, maxX - minX + 1, maxY - minY + 1);
}

/** Rotate clockwise by 0/90/180/270 degrees. */
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
 * Resample to (dw,dh) with alpha-premultiplied box averaging — good for the
 * downscales this pack mostly does and acceptable for the few small upscales.
 * Premultiplying keeps transparent texels from bleeding dark colour into edges.
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

/** Fit the longer painted axis to `target` px, preserving aspect. */
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

/* ------------------------------------------------------------------ */
/* The mapping config                                                   */
/* ------------------------------------------------------------------ */
interface CellMap {
  src: string;
  frames?: number;
  frame?: number;
  crop?: { x: number; y: number; w: number; h: number };
  rotate?: number;
  whiten?: boolean;
  trim?: boolean;
  threshold?: number;
  targetExtent: number;
  hitbox?: boolean;
}

function loadSource(root: string, m: CellMap): Img {
  const decoded = decodePng(new Uint8Array(readFileSync(join(root, m.src))));
  let img = fromDecoded(decoded);
  if (m.frames && m.frames > 1) img = frameOf(img, m.frames, m.frame ?? 0);
  if (m.crop) img = crop(img, m.crop.x, m.crop.y, m.crop.w, m.crop.h);
  if (m.trim) img = trimAlpha(img, m.threshold ?? BULLET_ALPHA_PAINTED);
  if (m.whiten) img = whiten(img);
  if (m.rotate) img = rotate(img, m.rotate);
  img = fitTo(img, m.targetExtent);
  return img;
}

function centred(cell: Img, into: Img, cellX: number, cellY: number, cellW: number, cellH: number): void {
  const ox = cellX + Math.round((cellW - cell.w) / 2);
  const oy = cellY + Math.round((cellH - cell.h) / 2);
  blit(into, cell, ox, oy);
}

/* ------------------------------------------------------------------ */
/* Self-validation replicating the loader's browser-only checks.        */
/* ------------------------------------------------------------------ */
function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  if (max === 0) return 0;
  return (max - Math.min(r, g, b)) / max;
}

function assertBulletSheet(sheet: Img): void {
  if (sheet.w !== BULLET_GRID.cellW * BULLET_COLUMNS || sheet.h !== BULLET_GRID.cellH * BULLET_ROWS) {
    throw new Error(`bullets.png is ${sheet.w}×${sheet.h}, expected ${BULLET_GRID.cellW * BULLET_COLUMNS}×${BULLET_GRID.cellH * BULLET_ROWS}`);
  }
  BULLET_CELLS.forEach((cell, index) => {
    const col = index % BULLET_COLUMNS, row = Math.floor(index / BULLET_COLUMNS);
    const x0 = col * BULLET_GRID.cellW, y0 = row * BULLET_GRID.cellH;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, satSum = 0, satCount = 0;
    for (let y = y0; y < y0 + BULLET_GRID.cellH; y++) {
      for (let x = x0; x < x0 + BULLET_GRID.cellW; x++) {
        const [r, g, b, a] = px(sheet, x, y);
        if (a >= BULLET_ALPHA_PAINTED) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
        if (a >= SATURATION_ALPHA_FLOOR) { satSum += saturation(r, g, b); satCount++; }
      }
    }
    if (maxX >= minX) {
      const extent = Math.max(maxX - minX + 1, maxY - minY + 1);
      if (extent > MAX_CELL_EXTENT) {
        throw new Error(`cell "${cell}" paints ${maxX - minX + 1}×${maxY - minY + 1}px, over the ${MAX_CELL_EXTENT}px limit`);
      }
    }
    if (satCount > 0) {
      const mean = satSum / satCount;
      if (mean > BULLET_SATURATION_MAX) throw new Error(`cell "${cell}" has mean saturation ${mean.toFixed(2)}, over ${BULLET_SATURATION_MAX}`);
    }
  });
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
  if (cat === 'explosions' && /Versatile_Particles/i.test(file)) return 'generic hit/death particle skin (artist note: reuse for hits AND explosions)';
  if (cat === 'explosions') return 'sprite-animation effect (enemy/player death)';
  if (cat === 'player-ship' && /Thruster/i.test(file)) return 'exhaust / engine-trail effect (no continuous-trail effect exists yet)';
  if (cat === 'player-ship' && /Bomb/i.test(file)) return 'bomb visual (BombSpec carries no sprite surface yet)';
  if (cat === 'player-ship' && /Option/i.test(file)) return 'dedicated option sprite (OptionSpec currently names a bullet cell)';
  if (cat === 'player-bullets') return 'sprite-animation (player shot pulse) / alternate shot skin';
  if (cat === 'misc') return 'item skin (animated pickup) / sprite-animation';
  if (cat === 'enemy-bullets' && /Spiky/i.test(file)) return 'rotating/animated bullet (artist note: rotate in code)';
  if (cat === 'enemy-bullets') return 'alternate enemy-bullet skin (single frame already consumable as a bullet cell)';
  return 'unclassified';
}

/* ------------------------------------------------------------------ */
/* README (provenance)                                                  */
/* ------------------------------------------------------------------ */
function buildReadme(root: string, notes: { tip: string; quick: string }, counts: { consumed: number; staged: number; skipped: number; total: number }): string {
  return `# bulletpack — imported reskin (provenance)

**Generated** by \`bun tools/import-bulletpack.ts\`. Do not hand-edit; edit
\`tools/bulletpack-map.json\` and regenerate.

## Source

- Imported from a local folder named **BulletPack** (\`${root}\`).
- This is a **reskin** (pack format 1): it replaces the bullet sheet, ship,
  and HUD icons. It changes no simulation, so a mismatch **warns**, never
  refuses — replay-safe.

## Licence — UNCONFIRMED (do not distribute)

- The BulletPack folder contains **no LICENSE file** and **names no author**.
  No PNG carries any metadata/attribution. Provenance is unverifiable from the
  files themselves.
- Under CLAUDE.md **rule 9** everything shipped must be original and licence-clean.
  This pack therefore is **\`.gitignore\`d** — the importer and its map are the
  committed artefacts; the derived art is not, and the pack is regenerable on
  demand.
- **Before this art is committed or distributed, confirm the source** (the
  site/marketplace it came from and its terms) with the pack's owner.

## The two artist notes shipped in the folder (verbatim)

> **Tiny tip.txt**
> ${notes.tip.split('\n').map((l) => l.trim()).filter(Boolean).join('\n> ')}

> **Quick note.txt**
> ${notes.quick.split('\n').map((l) => l.trim()).filter(Boolean).join('\n> ')}

## What was consumed vs staged

- **${counts.consumed}** source files were curated into \`bullets.png\`, \`ship.png\`,
  \`life.png\`, \`bomb.png\` (see \`tools/bulletpack-map.json\` for the exact
  frame/rotate/scale per cell).
- **${counts.staged}** files this reskin does not use are copied verbatim under
  \`extra/<category>/\`, staged for a future engine round (laser system,
  sprite-animation, missile entities, exhaust effects, a bomb visual, a
  dedicated option sprite). None of these have an engine consumer today.
- **${counts.skipped}** non-image files were skipped (\`.DS_Store\`; the two
  \`.txt\` notes, quoted above and staged under \`extra/provenance/\`).
- Every one of the **${counts.total}** files in the folder is accounted for
  exactly once in \`extra/extras.json\`.
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
  const map = JSON.parse(readFileSync(mapPath, 'utf8')) as {
    bullets: Record<string, CellMap>;
    ship: CellMap;
    hud: Record<string, CellMap>;
  };

  // Fresh output tree (art only — safe to wipe, it is regenerable & gitignored).
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  mkdirSync(extraDir, { recursive: true });

  const log: string[] = [];

  /* --- bullet sheet --- */
  const sheet = blank(BULLET_GRID.cellW * BULLET_COLUMNS, BULLET_GRID.cellH * BULLET_ROWS);
  const consumedSrc = new Map<string, string[]>(); // rel src -> [cells]
  const noteConsumed = (src: string, cell: string) => {
    const a = consumedSrc.get(src) ?? []; a.push(cell); consumedSrc.set(src, a);
  };
  BULLET_CELLS.forEach((cell, index) => {
    const m = map.bullets[cell];
    if (!m) throw new Error(`bulletpack-map.json: no mapping for cell "${cell}"`);
    const art = loadSource(root, m);
    const col = index % BULLET_COLUMNS, row = Math.floor(index / BULLET_COLUMNS);
    centred(art, sheet, col * BULLET_GRID.cellW, row * BULLET_GRID.cellH, BULLET_GRID.cellW, BULLET_GRID.cellH);
    noteConsumed(m.src, cell);
  });
  assertBulletSheet(sheet);
  writeVerified(join(outDir, 'bullets.png'), sheet);
  log.push('assembled bullets.png (256×64) — extent+saturation self-check PASSED');

  /* --- ship --- */
  const shipArt = loadSource(root, map.ship);
  const ship = blank(SHIP_SIZE, SHIP_SIZE);
  centred(shipArt, ship, 0, 0, SHIP_SIZE, SHIP_SIZE);
  if (map.ship.hitbox) {
    // Bright hitbox marker: a small disc 2px below centre, matching createShipAtlas.
    const cx = SHIP_SIZE / 2, cy = SHIP_SIZE / 2 + 2, r = 3;
    for (let y = 0; y < SHIP_SIZE; y++) for (let x = 0; x < SHIP_SIZE; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) setPx(ship, x, y, 255, 255, 255, 255);
    }
  }
  writeVerified(join(outDir, 'ship.png'), ship);
  noteConsumed(map.ship.src, 'ship');
  log.push('assembled ship.png (64×64) with hitbox marker');

  /* --- hud icons --- */
  for (const [name, m] of Object.entries(map.hud)) {
    const art = loadSource(root, m);
    if (art.w > HUD_ICON_MAX || art.h > HUD_ICON_MAX) throw new Error(`hud "${name}" is ${art.w}×${art.h}, over ${HUD_ICON_MAX}`);
    writeVerified(join(outDir, `${name}.png`), art);
    noteConsumed(m.src, `hud.${name}`);
    log.push(`assembled ${name}.png (${art.w}×${art.h})`);
  }

  /* --- manifest --- */
  const manifest = {
    format: 1,
    name: 'bulletpack',
    version: '1.0.0',
    author: 'Unknown — third-party BulletPack, source unconfirmed (see README.md)',
    license: 'UNCONFIRMED — no LICENSE file in source; not for distribution until provenance is verified (CLAUDE.md rule 9; see README.md)',
    description: 'Reskin imported from the third-party BulletPack folder: curated bullet sheet, ship and HUD icons. Licence unconfirmed — gitignored, regenerable via tools/import-bulletpack.ts.',
    assets: { bullets: 'bullets.png', ship: 'ship.png', filter: 'nearest' as const },
    hud: { life: 'life.png', bomb: 'bomb.png' },
  };
  const result = validateManifest(manifest, 'bulletpack');
  if ('errors' in result) {
    throw new Error(`validateManifest REJECTED the generated pack.json:\n  ${result.errors.join('\n  ')}`);
  }
  writeFileSync(join(outDir, 'pack.json'), JSON.stringify(manifest, null, 2) + '\n');
  log.push('pack.json — validateManifest ACCEPTED (format 1 reskin)');

  /* --- completeness walk + staging + extras.json --- */
  const files = walk(root).map((abs) => relative(root, abs)).sort();
  interface Entry {
    category: string; file: string; disposition: string;
    width: number | null; height: number | null; frames: number;
    frameW: number | null; frameH: number | null;
    orientation: string; suggestedConsumer: string;
  }
  const entries: Entry[] = [];
  let consumed = 0, staged = 0, skipped = 0;

  for (const rel of files) {
    const abs = join(root, rel);
    const file = basename(rel);
    const cat = categoryOf(rel);

    if (file === '.DS_Store') {
      entries.push({ category: cat, file: rel, disposition: 'skipped: macOS .DS_Store (not an asset)', width: null, height: null, frames: 0, frameW: null, frameH: null, orientation: '-', suggestedConsumer: '-' });
      skipped++; continue;
    }
    if (rel.toLowerCase().endsWith('.txt')) {
      // Stage the artist notes under extra/provenance, and quote them in README.
      const dst = join(extraDir, 'provenance', file);
      mkdirSync(join(extraDir, 'provenance'), { recursive: true });
      copyFileSync(abs, dst);
      entries.push({ category: 'provenance', file: rel, disposition: 'skipped: artist note (quoted in README, staged under extra/provenance)', width: null, height: null, frames: 0, frameW: null, frameH: null, orientation: '-', suggestedConsumer: '-' });
      skipped++; continue;
    }
    if (!rel.toLowerCase().endsWith('.png')) {
      entries.push({ category: cat, file: rel, disposition: `skipped: non-image (${file})`, width: null, height: null, frames: 0, frameW: null, frameH: null, orientation: '-', suggestedConsumer: '-' });
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

    const cells = consumedSrc.get(rel);
    if (cells) {
      entry.disposition = `consumed → ${cells.join(', ')}`;
      consumed++;
    } else {
      const dst = join(extraDir, cat, file);
      mkdirSync(join(extraDir, cat), { recursive: true });
      copyFileSync(abs, dst);
      entry.disposition = `staged → extra/${cat}/${file}`;
      staged++;
    }
    entries.push(entry);
  }

  // Every mapped src must have matched a real file.
  for (const src of consumedSrc.keys()) {
    if (!files.includes(src)) throw new Error(`bulletpack-map.json names a source not in the folder: "${src}"`);
  }

  writeFileSync(join(extraDir, 'extras.json'), JSON.stringify({
    source: root,
    generatedBy: 'tools/import-bulletpack.ts',
    license: 'UNCONFIRMED — no LICENSE file in source folder',
    totals: { total: entries.length, consumed, staged, skipped },
    files: entries,
  }, null, 2) + '\n');

  const notes = {
    tip: readFileSync(join(root, 'Bullet Pack/Bullet Pack/Tiny tip.txt'), 'utf8'),
    quick: readFileSync(join(root, 'Bullet Pack/Quick note.txt'), 'utf8'),
  };
  writeFileSync(join(outDir, 'README.md'), buildReadme(root, notes, { consumed, staged, skipped, total: entries.length }));

  /* --- report --- */
  process.stdout.write(`\nBulletPack import → ${outDir}\n`);
  for (const l of log) process.stdout.write(`  ✓ ${l}\n`);
  process.stdout.write(`\nCompleteness: ${entries.length} files — ${consumed} consumed, ${staged} staged, ${skipped} skipped\n`);
  process.stdout.write(`extras.json manifest: ${join(extraDir, 'extras.json')}\n`);
}

main();
