/**
 * Generate `packs/example/` — the reference pack.
 *
 *     bun tools/make-example-pack.ts
 *
 * ## What this pack is for
 *
 * `docs/packs.md` is the spec; this is the thing a copy-paste author actually
 * starts from. Every field format 1 understands is exercised in `pack.json`,
 * every resource the manifest can name is present, and the art obeys every
 * rule the loader enforces — so the pack a person copies is never an example
 * of something the validator would then reject.
 *
 * `README.md` carries the annotation JSON cannot: which field does what, and
 * the *why* behind the rules the art follows (white bullets, the cell margin,
 * the ship's hitbox marker, small flat HUD icons). See that file for the
 * doctrine; this file is only the "how it was drawn".
 *
 * ## Why the art looks nothing like the procedural placeholders
 *
 * The generated sheet (`src/render/procedural.ts`) is soft radial gradients —
 * the same shape language everywhere. This pack is flat, hard-edged
 * silhouettes: every pixel is either fully painted or fully transparent, no
 * antialiasing, one geometric family per cell. The point is not which style
 * is better — it is that a person dropping this pack in and refreshing the
 * game must be able to tell **at a glance** that their pack took effect,
 * rather than squinting at a slightly-different gradient.
 *
 * ## Why the encoder is imported, not reimplemented
 *
 * `tools/png.ts` is `tools/make-fixtures.ts`'s encoder, extracted so this
 * script and that one share one implementation. A second hand-rolled PNG
 * writer is exactly the kind of pair that silently drifts apart — see that
 * module's header for the fuller argument, and `make-fixtures.ts`'s header for
 * why a subtly wrong PNG needs an independent parser rather than a self-check.
 *
 * ## Self-verification
 *
 * Same discipline as `make-fixtures.ts`: every file is re-read through
 * `parsePng` (never the encoder's own state) before being trusted, the cell
 * margin rule is measured in pixels rather than asserted from the shape
 * parameters that produced them, and `pack.json` is round-tripped through the
 * real `validateManifest` — so this script cannot commit a pack its own
 * validator would reject.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sinDeg } from '../src/core/trig';
import { BULLET_GRID, BULLET_COLUMNS, BULLET_ROWS, BULLET_CELLS, MAX_CELL_EXTENT } from '../src/render/procedural';
import { ColourType, encodePng, parsePng, pixelOf, type PngHeader } from './png';
import { validateManifest, type PackContent, type PackManifest } from '../src/packs/manifest';

const OUT = join(import.meta.dir, '..', 'packs', 'example');

/* ------------------------------------------------------------------ */
/* Shape primitives — flat, hard-edged, coordinates local to a centre  */
/* ------------------------------------------------------------------ */

/** True inside the shape. Coordinates are pixel offsets from the shape's centre. */
type Shape = (dx: number, dy: number) => boolean;

const diamond = (r: number): Shape => (dx, dy) => Math.abs(dx) + Math.abs(dy) <= r;

const circle = (r: number): Shape => (dx, dy) => dx * dx + dy * dy <= r * r;

/** A frame: inside the outer bound, outside the inner one. */
const squareFrame = (outer: number, inner: number): Shape => (dx, dy) => {
  const m = Math.max(Math.abs(dx), Math.abs(dy));
  return m <= outer && m >= inner;
};

/** A four-armed plus, the same width in both axes — safe under any rotation. */
const plus = (armLen: number, armHalfW: number): Shape => (dx, dy) =>
  (Math.abs(dx) <= armHalfW && Math.abs(dy) <= armLen) ||
  (Math.abs(dy) <= armHalfW && Math.abs(dx) <= armLen);

/** A diagonal plus (an X) — also four-fold symmetric. */
const xMark = (armLen: number, armHalfW: number): Shape => (dx, dy) => {
  const u = (dx + dy) / Math.SQRT2;
  const v = (dx - dy) / Math.SQRT2;
  return (Math.abs(u) <= armHalfW && Math.abs(v) <= armLen) || (Math.abs(v) <= armHalfW && Math.abs(u) <= armLen);
};

/**
 * A triangle tapering to a point at `+tipX`, along the +x axis.
 *
 * CLAUDE.md rule 7: anything `orientToHeading` rotates to match heading, and
 * heading 0° is +x — so every directional cell in this sheet (`kunai`,
 * `scale`, `needle`) tapers to its point on the *right*, never the top.
 * `roundness` softens the taper (1 = straight edges, <1 bows the flanks out),
 * which is the only thing that tells `kunai` and `needle` apart in silhouette
 * once both are "a triangle pointing right".
 */
const wedgeRight = (tailX: number, tipX: number, halfW: number, roundness = 1): Shape => (dx, dy) => {
  if (dx < tailX || dx > tipX) return false;
  const t = (tipX - dx) / (tipX - tailX); // 1 at the tail, 0 at the tip
  return Math.abs(dy) <= halfW * Math.pow(Math.max(t, 0), roundness);
};

/** A rhombus stretched along the x axis — the blade family's third silhouette. */
const rhombusAxis = (rx: number, ry: number): Shape => (dx, dy) => Math.abs(dx) / rx + Math.abs(dy) / ry <= 1;

/** A hard-edged five-point star, via angular interpolation between two radii. */
const star = (outer: number, inner: number, points: number): Shape => (dx, dy) => {
  const r = Math.hypot(dx, dy);
  if (r > outer) return false;
  let angle = Math.atan2(dy, dx);
  if (angle < 0) angle += Math.PI * 2;
  const segAngle = Math.PI / points; // half a point-to-point span
  const seg = angle / segAngle;
  const i = Math.floor(seg);
  const frac = seg - i;
  const rA = i % 2 === 0 ? outer : inner;
  const rB = (i + 1) % 2 === 0 ? outer : inner;
  return r <= rA + (rB - rA) * frac;
};

/**
 * One shape per `BULLET_CELLS` entry, in that exact order.
 *
 * `kunai`, `scale`, `shard`, `needle`, `petal` are the sheet's directional
 * cells — every one tapers along +x (`wedgeRight`/`rhombusAxis`), matching
 * rule 7 and what `orientToHeading` content actually does with `kunai`,
 * `scale` and `needle` (the base pack's enemy, boss and shot cards in
 * `src/packs/base-pack.json`, authored by `tools/make-base-pack.ts`).
 * Everything else is rotation-symmetric, so it reads the
 * same whichever way the shader happens to turn it.
 *
 * Every reach below is measured by eye against `MAX_CELL_EXTENT` (28, a 32px
 * cell with 2px of margin) and then checked for real in `verifyBullets` —
 * the same "measure the alpha, do not trust the parameter" rule
 * `docs/assets.md` §1.2 states for the generated sheet applies here too.
 */
const BULLET_SHAPES: Record<(typeof BULLET_CELLS)[number], Shape> = {
  'orb.small': diamond(4),
  'orb.medium': diamond(8),
  'orb.large': diamond(12),
  ring: squareFrame(12, 9),
  kunai: wedgeRight(-9, 12, 8),
  scale: wedgeRight(-7, 12, 5, 0.6),
  star: star(12, 5, 5),
  shard: rhombusAxis(12, 4),
  'glow.small': plus(6, 2),
  'glow.medium': plus(9, 3),
  'glow.large': plus(12, 4),
  halo: squareFrame(12, 10),
  needle: wedgeRight(-12, 12, 3),
  petal: wedgeRight(-8, 11, 7, 0.6),
  spark: xMark(8, 2),
  mote: circle(4),
};

/* ------------------------------------------------------------------ */
/* bullets.png                                                         */
/* ------------------------------------------------------------------ */

function buildBullets(): Uint8Array {
  const { cellW, cellH } = BULLET_GRID;
  const width = cellW * BULLET_COLUMNS;
  const height = cellH * BULLET_ROWS;

  return encodePng(width, height, ColourType.RGBA, (x, y) => {
    const col = Math.floor(x / cellW);
    const row = Math.floor(y / cellH);
    const name = BULLET_CELLS[row * BULLET_COLUMNS + col]!;
    const dx = x - (col * cellW + cellW / 2);
    const dy = y - (row * cellH + cellH / 2);
    // Flat and fully opaque, never blended — a hard edge needs no antialiased
    // partial-alpha ring to worry the margin measurement below.
    return BULLET_SHAPES[name]!(dx, dy) ? [255, 255, 255, 255] : [0, 0, 0, 0];
  });
}

/**
 * Re-read `bullets.png` through `parsePng` (never trust the encoder that just
 * wrote it) and, per cell: measure the painted alpha bounding box against
 * `MAX_CELL_EXTENT`, and confirm every painted pixel is neutral (R=G=B) —
 * "bullets are white, colour is the engine's tint" (`docs/assets.md` §1.1),
 * checked rather than asserted.
 */
function verifyBullets(bytes: Uint8Array): string[] {
  const png = parsePng(bytes);
  const { cellW, cellH } = BULLET_GRID;
  if (png.width !== cellW * BULLET_COLUMNS || png.height !== cellH * BULLET_ROWS) {
    throw new Error(`bullets.png: ${png.width}x${png.height}, expected ${cellW * BULLET_COLUMNS}x${cellH * BULLET_ROWS}`);
  }

  const lines: string[] = [];
  BULLET_CELLS.forEach((name, index) => {
    const col = index % BULLET_COLUMNS;
    const row = Math.floor(index / BULLET_COLUMNS);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let painted = 0;

    for (let ly = 0; ly < cellH; ly++) {
      for (let lx = 0; lx < cellW; lx++) {
        const [r, g, b, a] = pixelOf(png, col * cellW + lx, row * cellH + ly);
        if (a === 0) continue;
        painted++;
        if (r !== g || g !== b) {
          throw new Error(`bullets.png cell "${name}": pixel (${lx},${ly}) is (${r},${g},${b},${a}) — not neutral, bullets must stay white`);
        }
        if (lx < minX) minX = lx;
        if (lx > maxX) maxX = lx;
        if (ly < minY) minY = ly;
        if (ly > maxY) maxY = ly;
      }
    }

    if (painted === 0) throw new Error(`bullets.png cell "${name}": nothing painted`);
    const extentX = maxX - minX + 1;
    const extentY = maxY - minY + 1;
    if (extentX > MAX_CELL_EXTENT || extentY > MAX_CELL_EXTENT) {
      throw new Error(
        `bullets.png cell "${name}" paints ${extentX}x${extentY}px, over the ${MAX_CELL_EXTENT}px limit ` +
          `(a ${cellW}px cell needs 2px of margin on every side)`,
      );
    }
    lines.push(`  ${name.padEnd(12)} ${String(extentX).padStart(2)}x${String(extentY).padEnd(2)}px  (limit ${MAX_CELL_EXTENT})`);
  });
  return lines;
}

/* ------------------------------------------------------------------ */
/* ship.png                                                             */
/* ------------------------------------------------------------------ */

const SHIP_SIZE = 64;

function sign(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  return (px - bx) * (ay - by) - (ax - bx) * (py - by);
}

function inTriangle(
  px: number, py: number,
  [ax, ay]: readonly [number, number],
  [bx, by]: readonly [number, number],
  [cx, cy]: readonly [number, number],
): boolean {
  const d1 = sign(px, py, ax, ay, bx, by);
  const d2 = sign(px, py, bx, by, cx, cy);
  const d3 = sign(px, py, cx, cy, ax, ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/**
 * A notched kite pointing up (-y, screen top) — the direction
 * `createShipAtlas` draws its placeholder, kept so a pack swap does not spin
 * the ship. Two triangles rather than one concave polygon, because a
 * point-in-polygon test earns nothing here that two point-in-triangle tests
 * do not already give for free.
 */
const CENTRE = SHIP_SIZE / 2;
const NOSE = [CENTRE, CENTRE - 24] as const;
const LEFT_BASE = [CENTRE - 18, CENTRE + 20] as const;
const RIGHT_BASE = [CENTRE + 18, CENTRE + 20] as const;
const NOTCH = [CENTRE, CENTRE + 8] as const;

/**
 * The hitbox marker: a small disc near the ship's true centre. Danmaku
 * hitboxes are much smaller than the sprite, and drawing the marker on top —
 * a genuine readability feature, not a debug affordance — is the placeholder
 * ship's own convention (`createShipAtlas`, `src/render/procedural.ts`).
 *
 * Colour cannot separate marker from body — docs/packs.md §7.1 keeps everything
 * on this sheet white — so the contrast has to be alpha: the body paints at 205/255,
 * the marker at the full 255, the same technique `createShipAtlas` uses
 * (0.95 vs 1.0) with the gap widened so it reads as a genuine difference
 * rather than a rounding artefact. `verifyShip` checks the two are actually
 * distinguishable rather than trusting that the numbers say so.
 */
const MARKER_CENTRE = [CENTRE, CENTRE + 2] as const;
const MARKER_RADIUS = 3;

function buildShip(): Uint8Array {
  return encodePng(SHIP_SIZE, SHIP_SIZE, ColourType.RGBA, (x, y) => {
    const mdx = x - MARKER_CENTRE[0];
    const mdy = y - MARKER_CENTRE[1];
    if (mdx * mdx + mdy * mdy <= MARKER_RADIUS * MARKER_RADIUS) return [255, 255, 255, 255];
    const body = inTriangle(x, y, NOSE, LEFT_BASE, NOTCH) || inTriangle(x, y, NOSE, NOTCH, RIGHT_BASE);
    return body ? [255, 255, 255, 205] : [0, 0, 0, 0];
  });
}

function verifyShip(bytes: Uint8Array): string {
  const png = parsePng(bytes);
  if (png.width !== SHIP_SIZE || png.height !== SHIP_SIZE) {
    throw new Error(`ship.png: ${png.width}x${png.height}, expected ${SHIP_SIZE}x${SHIP_SIZE}`);
  }
  const [, , , markerAlpha] = pixelOf(png, MARKER_CENTRE[0], MARKER_CENTRE[1]);
  // The centroid of the left wing: inside the body by construction, and far
  // enough from both the marker and the notch's empty wedge to be a genuine
  // "body, not background" sample rather than an accidental pass.
  const bodyX = Math.round((NOSE[0] + LEFT_BASE[0] + NOTCH[0]) / 3);
  const bodyY = Math.round((NOSE[1] + LEFT_BASE[1] + NOTCH[1]) / 3);
  const [, , , bodyAlpha] = pixelOf(png, bodyX, bodyY);
  if (bodyAlpha === 0) throw new Error(`ship.png: body sample (${bodyX},${bodyY}) is transparent — pick a real interior point`);
  if (markerAlpha <= bodyAlpha) {
    throw new Error(`ship.png: hitbox marker (alpha ${markerAlpha}) is not brighter than the body (alpha ${bodyAlpha})`);
  }
  return `  marker alpha ${markerAlpha} vs body alpha ${bodyAlpha} — distinguishable`;
}

/* ------------------------------------------------------------------ */
/* HUD icons — small, flat, shape only                                 */
/* ------------------------------------------------------------------ */

const HUD_SIZE = 16;
const HUD_CENTRE = HUD_SIZE / 2;

/**
 * `life`/`bomb` replace the ♥/★ glyphs `drawHud` draws today. Position, size,
 * alpha and tint stay engine-owned — the same structural move as white bullets
 * tinted by the shader — so these icons are shape only: full white, hard edge,
 * nothing that presumes a size or a background it will be composited on.
 */
function buildHudIcon(shape: Shape): Uint8Array {
  return encodePng(HUD_SIZE, HUD_SIZE, ColourType.RGBA, (x, y) => {
    const dx = x - HUD_CENTRE;
    const dy = y - HUD_CENTRE;
    return shape(dx, dy) ? [255, 255, 255, 255] : [0, 0, 0, 0];
  });
}

function verifyHudIcon(name: string, bytes: Uint8Array): void {
  const png = parsePng(bytes);
  if (png.width > HUD_SIZE || png.height > HUD_SIZE) {
    throw new Error(`${name}: ${png.width}x${png.height}, must be at most ${HUD_SIZE}x${HUD_SIZE}`);
  }
}

/* ------------------------------------------------------------------ */
/* Dialogue portrait — the face the shell draws beside a boss's line   */
/* ------------------------------------------------------------------ */

/**
 * The one square a portrait occupies (`PORTRAIT_SIZE`, `src/render/portrait.ts`).
 * The loader's dimension check is EXACT — the ship-sheet idiom, not the tolerant
 * hud-icon `≤` — so a portrait that is anything other than this size rejects the
 * pack. Imported rather than hardcoded so this generator and the loader agree on
 * the one number.
 */
const PORTRAIT_SIZE = 96;

/**
 * `pyre`'s portrait: the speaker face `content.bosses.pyre.dialogue` names. Flat
 * and hard-edged like the rest of this pack's art — deliberately UNLIKE the
 * built-in procedural placeholder (`paintSilhouette` in `src/render/portrait.ts`,
 * a soft tinted gradient with a name plate) — so an author can see at a glance
 * that a pack portrait took the place of the silhouette. An ember bust on a dark
 * panel: a head, shoulders rising to the base, and a visor band, all in the pack's
 * ember palette so the face reads as `pyre`'s fight the way its bullets do.
 *
 * A portrait need not be white the way a bullet cell must — it is drawn once, not
 * per-instance tinted — so this carries its own colour.
 */
function buildPortrait(): Uint8Array {
  const cx = PORTRAIT_SIZE / 2;
  const inBust = (x: number, y: number): boolean => {
    const dx = x - cx;
    // Head.
    if (dx * dx + (y - 34) * (y - 34) <= 18 * 18) return true;
    // Shoulders: a body widening toward the base, leaving a margin at the edge.
    if (y >= 52) {
      const halfW = 12 + (y - 52) * 0.72;
      if (Math.abs(dx) <= Math.min(halfW, 42)) return true;
    }
    return false;
  };
  // A visor band across the head — the small detail that marks this as authored
  // art, not a blank silhouette.
  const inVisor = (x: number, y: number): boolean =>
    y >= 30 && y <= 38 && Math.abs(x - cx) <= 15;

  return encodePng(PORTRAIT_SIZE, PORTRAIT_SIZE, ColourType.RGBA, (x, y) => {
    if (inVisor(x, y)) return [255, 205, 120, 255]; // bright ember visor
    if (inBust(x, y)) return [200, 110, 45, 255]; // ember bust, mid luminance
    // Dark ember panel, a faint top-to-bottom step so the cell reads as tinted.
    return y < PORTRAIT_SIZE / 2 ? [30, 17, 9, 255] : [18, 10, 5, 255];
  });
}

function verifyPortrait(name: string, bytes: Uint8Array): string {
  const png = parsePng(bytes);
  if (png.width !== PORTRAIT_SIZE || png.height !== PORTRAIT_SIZE) {
    throw new Error(`${name}: ${png.width}x${png.height}, must be exactly ${PORTRAIT_SIZE}x${PORTRAIT_SIZE}`);
  }
  return `  ${png.width}x${png.height} — exactly ${PORTRAIT_SIZE}x${PORTRAIT_SIZE}`;
}

/* ------------------------------------------------------------------ */
/* Sound — a minimal inline WAV encoder                                 */
/* ------------------------------------------------------------------ */

const SAMPLE_RATE = 44100;

/**
 * 16-bit PCM, mono. Deliberately not shared with `tools/make-fixtures.ts`'s
 * `encodeWav` (which also handles multi-channel, for its stereo-swap
 * fixture) — this pack only ever needs one channel, and that function is not
 * exported. Two tiny sounds do not justify widening that seam.
 */
function encodeWavMono(samples: Float64Array): Uint8Array {
  const dataBytes = samples.length * 2;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) out[at + i] = text.charCodeAt(i);
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    const clamped = s < -1 ? -1 : s > 1 ? 1 : s;
    // Asymmetric scale on purpose (see make-fixtures.ts's `encodeWav`): 16-bit
    // two's complement reaches -32768 but only +32767, and scaling both ends
    // by 32768 wraps a full-scale positive sample into a negative one.
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }
  return out;
}

/**
 * A decaying sine sweep. `sinDeg`, not `Math.sin` — nothing here reaches the
 * simulation, so this is not a rule-3 correctness requirement, but a fixture
 * whose committed bytes depend on which JS engine regenerated it is not a
 * fixture (`tools/make-fixtures.ts`'s `tone` makes the same choice, for the
 * same reason).
 */
function sweep(seconds: number, fromHz: number, toHz: number, peak: number, decay: number): Float64Array {
  const count = Math.round(seconds * SAMPLE_RATE);
  const out = new Float64Array(count);
  let phase = 0;
  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    const hz = fromHz + (toHz - fromHz) * (t / seconds);
    phase = (phase + (hz / SAMPLE_RATE) * 360) % 360;
    out[i] = sinDeg(phase) * peak * Math.exp(-decay * t);
  }
  return out;
}

function concatSamples(parts: readonly Float64Array[]): Float64Array {
  const out = new Float64Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * `shot` (upward sine chirp) and `pickup` (a two-note ascending chime) —
 * deliberately unlike the built-in synth voices, which sweep `shot` *down*
 * from a square wave (`src/audio/index.ts`) and step `pickup` through more
 * notes. An author swapping this pack in should hear the difference, not just
 * see it.
 */
function buildShot(): Uint8Array {
  return encodeWavMono(sweep(0.05, 1800, 2600, 0.7, 16));
}

function buildPickup(): Uint8Array {
  const note1 = sweep(0.08, 600, 600, 0.5, 7);
  const note2 = sweep(0.08, 900, 900, 0.5, 7);
  return encodeWavMono(concatSamples([note1, note2]));
}

/* ------------------------------------------------------------------ */
/* ashen.wav — a background track with a real intro and a seamless loop */
/* ------------------------------------------------------------------ */

/**
 * The track's shape, in seconds. Playback runs 0 → `LOOP_END` once (so the
 * `[0, LOOP_START]` intro is heard exactly once), then loops `[LOOP_START,
 * LOOP_END]` forever. A short tail past `LOOP_END` exists only so the manifest
 * demonstrates `loopEnd < duration` — the loader's browser-side check has a real
 * relationship to measure — and is never actually reached under `loop = true`.
 *
 * The loop body must wrap without a click, so the frequencies below are chosen so
 * every partial completes a WHOLE number of cycles across `LOOP_END − LOOP_START`
 * (3.6s): 55, 82.5 and 110 Hz all give an integer over 3.6s, so the waveform value
 * at `LOOP_END` equals the one at `LOOP_START` sample-for-sample. This is the same
 * "whole cycles over the loop" trick the engine's synthesised drone uses
 * (`src/audio/music.ts`), done here in the file rather than at runtime.
 */
const ASHEN_TOTAL = 4.6;
const ASHEN_LOOP_START = 0.6;
const ASHEN_LOOP_END = 4.2;
const ASHEN_VOLUME = 0.5;

/** Low partials (Hz, amplitude): a bass root, a fifth, an octave. Bass so it never masks a bullet's cue. */
const ASHEN_PARTIALS: readonly (readonly [hz: number, amp: number])[] = [
  [55, 0.6],
  [82.5, 0.32],
  [110, 0.18],
];

function buildAshen(): Float64Array {
  const count = Math.round(ASHEN_TOTAL * SAMPLE_RATE);
  const out = new Float64Array(count);
  const norm = 1 / ASHEN_PARTIALS.reduce((s, [, a]) => s + a, 0);
  const peak = 0.5; // well under full scale, and quiet against the SFX
  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    let tone = 0;
    for (const [hz, amp] of ASHEN_PARTIALS) tone += amp * sinDeg((hz * t * 360) % 360);
    tone *= norm;
    // A slow tremolo for a little life. Amplitude only, so a hair of drift at the
    // seam is inaudible — the waveform itself is what has to wrap, and does.
    const sway = 0.78 + 0.22 * sinDeg((0.3 * t * 360) % 360);
    // The intro swells up over its first stretch; the loop body plays at full.
    const env = t < ASHEN_LOOP_START ? t / ASHEN_LOOP_START : 1;
    out[i] = tone * sway * env * peak;
  }
  return out;
}

/**
 * Re-derive the duration from the sample count and confirm the loop points sit
 * inside it — the same "measure, do not trust the parameter" discipline the PNG
 * verifiers use, for the one relationship the loader will re-check in the browser.
 */
function verifyAshen(samples: Float64Array): string {
  const duration = samples.length / SAMPLE_RATE;
  if (!(ASHEN_LOOP_START < ASHEN_LOOP_END)) {
    throw new Error(`ashen.wav: loopStart ${ASHEN_LOOP_START} must be < loopEnd ${ASHEN_LOOP_END}`);
  }
  if (ASHEN_LOOP_END > duration) {
    throw new Error(`ashen.wav: loopEnd ${ASHEN_LOOP_END}s is past the ${duration.toFixed(3)}s track`);
  }
  return `  loop [${ASHEN_LOOP_START}s, ${ASHEN_LOOP_END}s) inside a ${duration.toFixed(3)}s track — intro plays once`;
}

/* ------------------------------------------------------------------ */
/* content — format-2 enemies and stages, as data                      */
/* ------------------------------------------------------------------ */

/**
 * Every field in `content` mirrors an engine spec verbatim — a pack enemy IS an
 * `EnemySpec`, a pack boss IS a `BossSpec`, a pack shot IS a `ShotType`, and so
 * on down the tier, each minus the name the section key carries. There is no
 * translation layer to keep in step, and the numbers below sit in the same range
 * as the built-in cast (`src/sim/enemy.ts`, `src/sim/boss.ts`,
 * `src/content/shots.ts`, `src/game/run.ts`) so a copy-paste author starts from
 * something balanced rather than from a placeholder that plays wrong.
 *
 * The one substitution is the boss spell card: it declares **`hpSeconds`** where
 * the engine's `SpellCard` wants `hp`, so a designer writes the unit they think
 * in and the injector computes `hp = phaseHp(hpSeconds)`. That keeps a pack boss
 * re-derived when `REFERENCE_DPS` moves, the same coupling `balance.test.ts`
 * holds the built-ins to.
 *
 * Name resolution is pack-first, then built-in, for every reference below. This
 * pack's own entries — `ember`/`drone` (enemies), `pyre` (boss), `emberbolt`
 * (shot), `emberwing` (options), `firestorm` (bomb), `cinder` (effect), `relic`
 * (item), `raider` (character), and the top-level `ashen` (music) — are written
 * bare and qualified to `example/<name>` at injection, so a character equips
 * `emberbolt`/`emberwing`/`firestorm` and `gauntlet` names `ashen`, all resolved
 * to the pack's own.
 * Everything else is a built-in referenced bare: `grunt` (enemy), `sentinel`
 * (boss), `expanse`/`undertow`/`drift` (backgrounds), `power`/`score` (items),
 * `hit`/`death.big` (effects), `aimed-fan`/`spiral`/`ring` (patterns). A pack
 * defines content and references engine code by name.
 */

/** A bullet the pack's enemy patterns fire — an ordinary `BulletSpec`, white cell, engine-tinted. */
const EMBER_SHOT = {
  style: { sprite: 'orb.small', r: 1, g: 0.6, b: 0.2 },
  radius: 3,
  motion: { r: 2.2, theta: 90 },
};

/**
 * The pack ship's gun bullet. `kunai` is a directional cell, so it points +x and
 * `orientToHeading` turns it to its heading (rule 7). Fired forward — 270 is up.
 */
const EMBERBOLT = {
  style: { sprite: 'kunai', r: 1, g: 0.65, b: 0.25, orientToHeading: true },
  radius: 4,
  motion: { r: 10, theta: 270 },
  damage: 1,
};

/** The pack option's bullet — weaker per shot than the gun, because options multiply it. */
const EMBERWING_SHOT = {
  style: { sprite: 'orb.small', r: 1, g: 0.6, b: 0.25, additive: true },
  radius: 4,
  motion: { r: 10, theta: 270 },
  damage: 1,
};

/** The pack boss's aimed bullet and its ring petal — enemy fire, heading 90 (down-screen). */
const PYRE_SHOT = {
  style: { sprite: 'scale', r: 1, g: 0.6, b: 0.3, orientToHeading: true },
  radius: 4,
  motion: { r: 2.2, theta: 90 },
};
const PYRE_PETAL = {
  style: { sprite: 'petal', r: 1, g: 0.5, b: 0.7 },
  radius: 4,
  motion: { r: 4, theta: 90, ra: -0.06, rrange: { min: 0.5 } },
};

/**
 * The gun's power ladder. Each tier keeps every muzzle the tier below fired and
 * adds a symmetric pair, periods non-increasing — so it nests by construction.
 * `shots.test.ts` holds every registered weapon (pack ones injected into the same
 * process included) to `tier n ⊇ tier n-1`, so a pack shot that redistributed
 * instead of extending would fail that test, not just play worse.
 */
const EMBERBOLT_TIERS = [
  { spec: EMBERBOLT, offsets: [{ x: 0, y: -12, angle: 270 }], period: 6 },
  {
    spec: EMBERBOLT,
    offsets: [
      { x: 0, y: -12, angle: 270 },
      { x: -9, y: -10, angle: 270 },
      { x: 9, y: -10, angle: 270 },
    ],
    period: 6,
  },
  {
    spec: EMBERBOLT,
    offsets: [
      { x: 0, y: -12, angle: 270 },
      { x: -9, y: -10, angle: 270 },
      { x: 9, y: -10, angle: 270 },
      { x: -18, y: -8, angle: 270 },
      { x: 18, y: -8, angle: 270 },
    ],
    period: 5,
  },
];

/** Option slots, nesting the same way (`option.test.ts` enforces it registry-wide). */
const EMBERWING_NOSE = { x: 0, y: -20, focusX: 0, focusY: -26, angle: 270 };
const EMBERWING_PAIR = [
  { x: -24, y: -4, focusX: -10, focusY: -18, angle: 270 },
  { x: 24, y: -4, focusX: 10, focusY: -18, angle: 270 },
];
const EMBERWING_WIDE = [
  { x: -42, y: 8, focusX: -20, focusY: -4, angle: 270 },
  { x: 42, y: 8, focusX: 20, focusY: -4, angle: 270 },
];

const CONTENT: PackContent = {
  enemies: {
    // Full-featured: a base motion, a timeline that re-inits it (dive, sweep,
    // leave — the `weaver` shape), two patterns with real options, spoils, a
    // tint, and a score value. Everything an `EnemySpec` can carry. Its `onDeath`
    // names the pack effect `cinder`, and its `spoils` drop the pack item `relic`
    // — both resolved pack-first, so both are reached by this enemy dying.
    ember: {
      sprite: 'star',
      hp: 30,
      radius: 12,
      tint: { r: 1, g: 0.7, b: 0.3 },
      motion: { r: 2.6, theta: 90 },
      timeline: [
        { count: 0, motion: { r: 2.6, theta: 90 } },
        { count: 50, motion: { r: 1.6, theta: 0, w: 2 } },
        { count: 110, motion: { r: 3, theta: 270 } },
      ],
      // `options` is the Normal truth; each `difficulty` block is a sparse
      // shallow merge over it (one level deep — see `mergeOptions`). Easy thins,
      // Lunatic thickens, and the negative space is still designed at every tier
      // (docs/assets.md §readability binds a Lunatic curtain too). This is what a
      // gauntlet run at Lunatic fires more of than at Normal.
      patterns: [
        {
          pattern: 'aimed-fan',
          options: { spec: EMBER_SHOT, count: 3, spread: 28, period: 55 },
          difficulty: {
            easy: { count: 2, spread: 24 },
            hard: { count: 4, spread: 34, period: 48 },
            lunatic: { count: 6, spread: 42, period: 42 },
          },
          startAt: 20,
        },
        {
          pattern: 'spiral',
          options: { spec: EMBER_SHOT, arms: 2, step: 13, period: 8 },
          difficulty: {
            easy: { arms: 1 },
            hard: { arms: 3, step: 11 },
            lunatic: { arms: 4, step: 9, period: 6 },
          },
          startAt: 30,
          stopAt: 110,
        },
      ],
      spoils: [['power', 2], ['score', 1], ['relic', 1]] as [string, number][],
      scoreValue: 300,
      onHit: 'hit',
      onDeath: 'cinder',
    },
    // Minimal: the floor an enemy can be — a hitbox with a heading. No patterns,
    // no spoils, no tint. It descends and can be shot; nothing more.
    drone: {
      sprite: 'shard',
      hp: 8,
      radius: 8,
      motion: { r: 1.5, theta: 90 },
    },
  },
  // The pack's own particle effect, fired when `ember` dies (and by the pack
  // bomb). Its `sprite` is a plain atlas cell — the engine's own effects declare
  // it through a `BulletCell`-typed seam that makes it a compile-time union, but
  // a pack has no compiler at author time, so the injector checks it at runtime
  // against the same sprite set enemy and boss art resolve against.
  effects: {
    cinder: {
      sprite: 'mote',
      count: { min: 8, max: 14 },
      speed: { min: 1, max: 3 },
      life: { min: 16, max: 26 },
      drag: 0.9,
      scale: { from: 0.9, to: 0.1 },
      alpha: { from: 1, to: 0 },
      tint: { r: 1, g: 0.55, b: 0.2 },
      additive: true,
    },
  },
  // The pack's own pickup, an existing `kind` (a new kind would be a new game
  // rule, which stays engine — the validator refuses an unfamiliar one by name).
  // Dropped by `ember`'s and `pyre`'s spoils, so something reaches it.
  items: {
    relic: {
      sprite: 'orb.large',
      radius: 15,
      value: 2000,
      kind: 'score',
      tint: { r: 1, g: 0.85, b: 0.3 },
      magnetSpeed: 7,
    },
  },
  // The pack ship's gun, as a named weapon. A character equips it by name, and
  // the injector resolves the name into the ship's `player.shots` ladder — the
  // one indirection the pack form adds over `CharacterSpec`.
  shots: {
    emberbolt: {
      description: 'ember bolts that fan wider with each power tier',
      levels: EMBERBOLT_TIERS,
    },
  },
  // The pack ship's option satellites — fixed forward fire, gathered under focus.
  options: {
    emberwing: {
      sprite: 'orb.medium',
      shot: EMBERWING_SHOT,
      period: 6,
      followSpeed: 1.6,
      tint: { r: 1, g: 0.7, b: 0.3 },
      levels: [
        [EMBERWING_NOSE],
        [EMBERWING_NOSE, ...EMBERWING_PAIR],
        [EMBERWING_NOSE, ...EMBERWING_PAIR, ...EMBERWING_WIDE],
      ],
    },
  },
  // The pack ship's bomb, naming the pack effect `cinder` for its blast (resolved
  // pack-first). A screen clear that converts fire to score.
  bombs: {
    firestorm: {
      duration: 80,
      invulnTicks: 140,
      damagePerTick: 3,
      convertBullets: true,
      effect: 'cinder',
    },
  },
  // The pack ship. It equips the pack shot, option set and bomb — all bare names
  // the injector resolves pack-first — so nothing it flies is a built-in. A pack
  // character is offered on the SELECT screen exactly as a built-in is, because
  // that screen enumerates the registry it registers into.
  characters: {
    raider: {
      label: 'RAIDER',
      sprite: 'ship',
      blurb: 'pack ship — ember bolts, wing options, firestorm bomb',
      shot: 'emberbolt',
      options: 'emberwing',
      bomb: 'firestorm',
      player: {
        x: 240,
        y: 568,
        speed: 3.4,
        focusSpeed: 1.5,
        radius: 2.5,
        grazeRadius: 20,
        lives: 3,
        bombs: 3,
        invulnTicks: 90,
      },
    },
  },
  // The pack's own boss, `ashfall`'s end boss (see the stage below). Three cards:
  // a non-spell movement opener, then a signature spell card that overrides the
  // scene to a built-in background (`drift`), earns a bonus, and varies by tier,
  // then a Lunatic-only card gated with `difficulties: ['lunatic']`. Each phase
  // declares `hpSeconds`; the injector computes `hp = phaseHp(hpSeconds)` and
  // defaults the absent `timeLimit` to `phaseClock(hp)`. On Normal the boss fights
  // the first two cards; only Lunatic reaches the third.
  bosses: {
    pyre: {
      sprite: 'ring',
      radius: 18,
      width: 52,
      height: 52,
      tint: { r: 1, g: 0.6, b: 0.3 },
      entry: { x: 240, y: 140, ticks: 90 },
      onDeath: 'death.big',
      spoils: [['relic', 2], ['score', 3]] as [string, number][],
      // A two-line pre-fight exchange. The first speaker, `pyre`, names this
      // pack's own portrait (bare, resolved pack-first to `example/pyre`); the
      // second, `player`, is a built-in portrait referenced bare. When `ashfall`
      // sends this boss, the Run enters a dialogue phase — bullets cleared, the
      // ship still flying but unable to fire — that a fresh Shot press advances,
      // one line at a time, before the fight begins.
      dialogue: [
        { speaker: 'pyre', text: 'You reached the ash. Few do.' },
        { speaker: 'player', text: 'Then few have put it out.' },
      ],
      // One per-character variant, keyed by this pack's OWN character `raider`
      // (resolved pack-first to `example/raider`, the name a raider run flies
      // under). When raider reaches this fight the exchange below replaces the
      // default above; every other ship keeps the default. A variant may differ in
      // line count — this one runs three — which changes only raider's timeline.
      dialogueFor: {
        raider: [
          { speaker: 'pyre', text: 'A raider. You burn what you cannot carry.' },
          { speaker: 'player', text: 'And carry what will not burn.' },
          { speaker: 'pyre', text: 'Then we are the same. A pity.' },
        ],
      },
      phases: [
        {
          name: 'Smoulder',
          hpSeconds: 8,
          isSpell: false,
          timeline: [
            { count: 0, motion: { r: 0.9, theta: 0 } },
            { count: 90, motion: { r: 0.9, theta: 180 } },
            { count: 180, jump: 0 },
          ],
          patterns: [
            { pattern: 'aimed-fan', options: { spec: PYRE_SHOT, count: 5, spread: 34, period: 48 } },
          ],
        },
        {
          name: 'Ember Sign "Ashfall"',
          hpSeconds: 12,
          isSpell: true,
          bonus: 300000,
          background: 'drift',
          motion: { r: 0 },
          // The signature card, tier-varied: its ring thins on Easy and thickens
          // on Lunatic, the same per-pattern `difficulty` block the enemies carry.
          patterns: [
            {
              pattern: 'ring',
              options: { spec: PYRE_PETAL, count: 18, period: 42, rotation: 9 },
              difficulty: {
                easy: { count: 12 },
                hard: { count: 24, period: 36 },
                lunatic: { count: 30, period: 30 },
              },
            },
            { pattern: 'aimed-fan', options: { spec: PYRE_SHOT, count: 3, spread: 18, period: 96 }, startAt: 60 },
          ],
        },
        // A Lunatic-only card — the genre's extra spell, gated with
        // `difficulties: ['lunatic']`. It exists only on Lunatic; on every other
        // tier the boss fights the two cards above, so the injector's
        // "every tier keeps a phase" rule holds (Smoulder and Ashfall are ungated).
        {
          name: 'Lunatic "Total Eclipse"',
          hpSeconds: 13,
          isSpell: true,
          difficulties: ['lunatic'],
          bonus: 500000,
          background: 'drift',
          motion: { r: 0 },
          patterns: [
            { pattern: 'ring', options: { spec: PYRE_PETAL, count: 34, period: 26, rotation: 13 } },
            { pattern: 'aimed-fan', options: { spec: PYRE_SHOT, count: 5, spread: 22, period: 72 }, startAt: 40 },
          ],
        },
      ],
    },
  },
  stages: {
    // The entry — the row that appears under START. Uses both pack enemies and
    // a built-in one, and chains into the second stage by name.
    gauntlet: {
      entry: true,
      seed: 7,
      background: 'expanse',
      // The pack's own new track, resolved pack-first to `example/ashen`. `ashfall`
      // names none, so the run leaves whatever is playing — a stage need not.
      music: 'ashen',
      outro: 120,
      next: 'ashfall',
      waves: [
        { at: 0, enemy: 'drone', x: 120, y: -20, count: 4, interval: 25 },
        { at: 30, enemy: 'drone', x: 360, y: -20, count: 4, interval: 25 },
        { at: 200, enemy: 'grunt', x: 240, y: -20, count: 3, interval: 30 },
        { at: 360, enemy: 'ember', x: 160, y: -30 },
        { at: 400, enemy: 'ember', x: 320, y: -30 },
        { at: 520, enemy: 'ember', x: 240, y: -30, count: 2, interval: 60, stepX: -80 },
      ],
    },
    // The second stage, reached only via `gauntlet`'s `next`. It keeps a built-in
    // boss WAVE mid-schedule — `sentinel` as a midboss, holding the schedule until
    // it is gone — and names the pack boss `pyre` as its *end* boss, which arrives
    // once the waves are spent. `next: null` states, explicitly, that this is the
    // last stage.
    ashfall: {
      seed: 11,
      background: 'undertow',
      outro: 120,
      next: null,
      boss: 'pyre',
      waves: [
        { at: 0, enemy: 'drone', x: 90, y: -20, count: 6, interval: 18, stepX: 60 },
        { at: 120, enemy: 'grunt', x: 240, y: -20, count: 2, interval: 40 },
        { at: 240, boss: 'sentinel' },
        { at: 260, enemy: 'ember', x: 200, y: -30 },
      ],
    },
  },
};

/* ------------------------------------------------------------------ */
/* pack.json — every field, round-tripped through the real validator   */
/* ------------------------------------------------------------------ */

const MANIFEST: PackManifest = {
  format: 1,
  name: 'example',
  version: '1.0.0',
  author: 'Danmaku project',
  license: 'CC0-1.0',
  description:
    'The reference pack: every manifest field, art that follows every rule the loader checks, and one of every format-2 content section — enemies, stages, a boss, a shot, a character, options, a bomb, an effect and an item. Copy this directory, rename it, and swap the files.',
  assets: {
    bullets: 'bullets.png',
    ship: 'ship.png',
    filter: 'nearest',
  },
  sounds: {
    shot: 'shot.wav',
    pickup: 'pickup.wav',
  },
  // One background track, a NEW name (no built-in track is called `ashen`), so it
  // registers as `example/ashen` and `content.stages.gauntlet` names it. It has a
  // real intro — `loopStart` > 0 — so the swell is heard once and the body loops.
  // `volume` trims it within the music bus, which already sits under the SFX.
  music: {
    ashen: {
      file: 'ashen.wav',
      loopStart: ASHEN_LOOP_START,
      loopEnd: ASHEN_LOOP_END,
      volume: ASHEN_VOLUME,
    },
  },
  hud: {
    life: 'life.png',
    bomb: 'bomb.png',
  },
  // One dialogue portrait, a NEW name (no built-in portrait is called `pyre`), so
  // it registers as `example/pyre` and `content.bosses.pyre.dialogue` names it
  // bare, resolved pack-first. A top-level presentation section, sibling to
  // `sounds` and `music`: a portrait is a file, and a boss only names one.
  portraits: {
    pyre: 'portrait.png',
  },
  // The covering invariant: every content.<section> present must be named here,
  // and vice versa. It is what lets a v1 engine refuse on `requires` before it
  // ever parses `content`. This pack ships every implemented content section, so
  // it declares every capability.
  requires: [
    'content.enemies',
    'content.stages',
    'content.bosses',
    'content.shots',
    'content.characters',
    'content.options',
    'content.bombs',
    'content.effects',
    'content.items',
  ],
  content: CONTENT,
};

/* ------------------------------------------------------------------ */
/* README — the annotation JSON cannot carry                           */
/* ------------------------------------------------------------------ */

const README = `# example — the reference pack

This directory is a working format-1 pack. Copy it, rename the folder and
\`name\` in \`pack.json\` to match, and start replacing files — the loader will
correct you if anything is wrong, and every error it can give names the field,
what it expected, and (where it measured something) the number it measured.

Generated by \`tools/make-example-pack.ts\`. That script is the record of how
every file here was made and is the one to change, not these files by hand —
see its header for why the output is committed rather than built.

## \`pack.json\`, field by field

JSON has no comments, so this table is where the annotation lives.

| Field | Value here | What it is |
|---|---|---|
| \`format\` | \`1\` | The manifest format this pack is written against. This engine's \`SUPPORTED_FORMATS\` is a list, so a future format 2 does not orphan this pack — but a v1 pack only ever declares \`1\`. |
| \`name\` | \`"example"\` | Must equal the directory name, \`[a-z0-9-]{1,32}\`. Pack identity is its directory; this is the check that keeps a renamed folder from silently claiming an old name. |
| \`version\` | \`"1.0.0"\` | Free-form, yours to bump. |
| \`author\` | \`"Danmaku project"\` | Who made this. Provenance, not decoration — see the license row. |
| \`license\` | \`"CC0-1.0"\` | **Required.** CLAUDE.md rule 9: everything shipped needs declared provenance, because upstream's Touhou-derivative art shipped with none and could not be trusted. A pack with no \`license\` field is rejected before anything else is even read. |
| \`description\` | a sentence | Optional, shown wherever the boot report lists loaded packs. |
| \`assets.bullets\` | \`"bullets.png"\` | The 256×64, 8×2-cell sheet — see "Why the bullets look like this" below. |
| \`assets.ship\` | \`"ship.png"\` | 64×64, one sprite. |
| \`assets.filter\` | \`"nearest"\` | Texture sampling for both sheets: \`"nearest"\` or \`"linear"\`. This pack's art is hard-edged, so \`"nearest"\` keeps every boundary crisp; smooth, gradient-shaded art should ask for \`"linear"\` instead. Default is \`"nearest"\` either way. |
| \`sounds.shot\`, \`sounds.pickup\` | two \`.wav\` files | One entry per sound this pack replaces — the full list of names the engine plays is in \`docs/audio.md\` §2; an unknown name is rejected and lists them. This pack only replaces two of the six, which is legal: everything else keeps playing its synthesised placeholder. |
| \`hud.life\`, \`hud.bomb\` | two \`.png\` files | Replace the ♥/★ glyphs. See "HUD icons are shapes, not compositions" below. |
| \`music.ashen\` | one \`.wav\` with loop points | A background track — a top-level section, sibling to \`sounds\`. See "Music: an intro and a loop" below. |
| \`portraits.pyre\` | one \`.png\`, exactly 96×96 | A dialogue portrait — the face drawn beside a boss's line. A top-level section, sibling to \`sounds\`/\`music\`. See "Dialogue: who speaks, and who is drawn" below. |
| \`requires\` | all nine \`content.*\` capabilities | The capabilities this pack's \`content\` needs. The engine honours exactly the implemented set; anything else is refused by name. Every \`content.<section>\` present must be declared here and vice versa — the covering invariant, which is what lets an older engine refuse on \`requires\` before it parses a \`content\` section it could not load. |
| \`content\` | one of every implemented section | Format-2 game content: enemies, stages, a boss, a shot, a character, options, a bomb, an effect and an item. See "Content: one of everything" below. |

The fields this engine still does not implement — the top-level \`backgrounds\`,
the reserved \`hud\` names \`digits\`/\`font\`/\`bossBar\`/\`frame\` — get a dedicated
rejection naming each as a future section rather than a generic "unknown field"
error; see \`docs/packs.md\` §Future. (\`content.backgrounds\` is refused the same way
inside \`content\`.) What remains reserved is only the one permanent code line:
\`backgrounds\` are shader code the engine owns, named by a string and never shipped
as pack data — the same boundary as patterns and behaviours. \`dialog\` left the
list when this feature landed — boss dialogue is now a field on
\`content.bosses\` and portraits a real top-level section (both below); \`music\` is a
real top-level section too; and \`difficulty\` is not a section at all but a
per-pattern override inside the content shapes.

## Content: one of everything

\`content\` is where a pack stops reskinning the game and starts adding to it. This
pack ships **one of every implemented section** — two enemies, a boss, a shot, a
character, an option set, a bomb, a particle effect, an item, and a two-stage
campaign that reaches all of them. The row it adds under START on the title
screen (\`example/gauntlet\`) is the campaign's entry stage.

**A pack entry IS the engine's own spec, minus the name the key carries.** A pack
enemy is an \`EnemySpec\`, a pack boss a \`BossSpec\`, a pack shot a \`ShotType\`, a
pack character a \`CharacterSpec\`, and so on — handed straight to the matching
\`define*\` after its names are checked, no translation layer. So the authoring
reference is the engine's own: \`src/sim/enemy.ts\`, \`src/sim/boss.ts\`,
\`src/content/shots.ts\`, \`src/sim/option.ts\`, \`src/sim/bomb.ts\`,
\`src/sim/effects.ts\`, \`src/sim/item.ts\`, \`src/game/run.ts\`,
\`src/content/stage.ts\`. This section covers only what the pack form adds on top.

**Names resolve pack-first, then built-in — for every reference.** Your own
entries are written **bare** and registered under a \`<packname>/\` prefix, so this
pack's \`ember\` becomes \`example/ember\` and \`raider\` fires \`emberbolt\` which the
injector resolves to \`example/emberbolt\`. A bare name that is not one of yours
resolves to a built-in: \`grunt\` (enemy), \`sentinel\` (boss), \`expanse\`/\`undertow\`/
\`drift\` (backgrounds), \`power\`/\`score\` (items), \`hit\`/\`death.big\` (effects),
\`aimed-fan\`/\`spiral\`/\`ring\` (patterns). **A pack defines content and references
engine code — patterns, behaviours, backgrounds — by name.** Cross-pack
references are not supported: a name is either yours or a built-in's.

**A boss is now data — but its \`hp\` is written as \`hpSeconds\`.** \`content.bosses\`
is implemented, and \`pyre\` is this pack's end boss for \`ashfall\`. Its two phases
mirror \`SpellCard\` field for field, with one substitution: a phase declares
**\`hpSeconds\`** — the *seconds* a competent player should need to drain it — and
the injector computes \`hp = phaseHp(hpSeconds)\`, defaulting the absent
\`timeLimit\` to \`phaseClock(hp)\`. You write the unit a designer thinks in, and the
boss stays sized off \`REFERENCE_DPS\`: when that constant moves, every pack boss
re-derives, the same coupling \`balance.test.ts\` holds the built-ins to. A tuning
constant no test can measure drifts from the thing it describes — so the spec
does not let you type raw \`hp\`. A spell card's \`background\` still names a built-in
scene (\`pyre\`'s second phase overrides the field to \`drift\`); a background is a
shader, engine code, so a pack *selects* one and never ships one.

**Difficulty is authored per pattern, never scaled globally.** A tier here is not
"bullets ×1.5" — a global multiplier would destroy the negative space a curtain is
designed around. Instead a pattern slot's \`options\` is the **Normal** truth, and
an optional \`difficulty\` block names only the fields that change on the tiers that
differ:

\`\`\`json
{ "pattern": "ring",
  "options": { "count": 18, "period": 42 },
  "difficulty": {
    "easy":    { "count": 12 },
    "hard":    { "count": 24, "period": 36 },
    "lunatic": { "count": 30, "period": 30 } } }
\`\`\`

The engine shallow-merges the tier over \`options\` at the moment the pattern fires
— **one level deep**, so a nested object (a whole \`spec\`) is replaced whole, never
patched into. A tier you do not list fires \`options\` unchanged. This pack's
\`ember\` carries such a block on both its patterns (which is why a \`gauntlet\` run
fires more bullets on Lunatic than on Normal), and \`pyre\`'s "Ashfall" card varies
its ring the same way. A whole card can also be **tier-gated**: give a spell card
\`"difficulties": ["lunatic"]\` and it exists only on Lunatic — the genre's extra
card — as \`pyre\`'s "Total Eclipse" does. The one rule the injector enforces is
that every tier keeps at least one phase, so a boss can never be gated into dying
unfought; \`pyre\`'s first two cards are ungated, so every tier has a fight.

**A character equips its weapons by name, not by table.** A built-in
\`CharacterSpec\` carries its shot ladder inline; a pack \`character\` instead names
its \`shot\`, \`options\` and \`bomb\` (\`raider\` names \`emberbolt\`, \`emberwing\`,
\`firestorm\`), and the injector resolves each pack-first and fills the ship's
\`player.shots\` ladder in. That is the one indirection the pack form adds — it is
why shots, options and bombs register *before* characters. A pack character is
offered on the SELECT screen exactly as a built-in is, because that screen
enumerates the registry it lands in.

**An item's \`kind\` is closed.** \`relic\` is an ordinary \`ItemSpec\` with
\`kind: "score"\` — one of \`power\`/\`score\`/\`life\`/\`bomb\`. The game layer switches
on \`kind\` to decide what a pickup *does*, so a new kind is a new game **rule**,
not pack data; an unfamiliar one is refused by name. A pack item becomes
droppable by being named in some \`spoils\` (\`ember\` and \`pyre\` both drop \`relic\`).

**An effect's \`sprite\` is a plain cell, checked at runtime.** \`cinder\` is a
\`ParticleSpec\`; the engine's own effects declare their sprite through a
\`BulletCell\`-typed seam that makes it a compile-time union, but a pack has no
compiler at author time, so the injector enforces that union as a runtime check
against the same sprite set enemy and boss art resolve against.

**Registration is not reachability, and the injector enforces it for every
kind.** Dead content — a stage no campaign reaches, an enemy no wave spawns, a
boss no stage sends, a shot/option/bomb no character equips, an effect nothing
triggers, an item nothing drops — is an error that rejects the pack, naming what
would have had to reference it. In this pack: \`gauntlet\` is the entry and
\`ashfall\` its \`next\`; \`ember\`/\`drone\` are flown by \`gauntlet\`; \`pyre\` is
\`ashfall\`'s boss; \`raider\` fires \`emberbolt\`, flies \`emberwing\` and \`firestorm\`;
\`cinder\` is \`ember\`'s \`onDeath\` and \`firestorm\`'s blast; \`relic\` drops from
\`ember\`'s spoils.

Use \`next: null\` to say a stage is the last one explicitly (an omitted \`next\`
means the same, but \`null\` reads as a decision rather than a gap). \`ashfall\` ends
the campaign that way — after a built-in \`sentinel\` midboss WAVE mid-schedule and
the pack boss \`pyre\` as its end boss.

**A campaign's content is part of the run, so replays of it are strict.** A
built-in run records an empty pack identity; a run entered through this pack's
campaign records \`example@<hash>\`, and a replay whose recorded identity does not
match the pack loaded at playback is **refused**, not warned. That is the
difference from the presentation-only \`packs\` meta (bullets and sounds), which
only warns: format-2 content changes what the simulation does, so a replay under
different content is a different run.

## Why the bullets look like this

\`bullets.png\` is flat, hard-edged silhouettes — deliberately unlike the
built-in placeholder sheet's soft radial gradients (\`src/render/procedural.ts\`),
so you can tell at a glance that this pack took effect rather than squinting at
a slightly different blur.

**Bullets are white. Colour is the engine's tint, not the art's.** Every cell on
this sheet is painted pure \`(255,255,255)\` at full or zero alpha — no shading,
no hue. The renderer multiplies that white by a per-instance tint chosen by
whatever pattern is firing the bullet, so one shape serves every colour in the
game. Paint a bullet blue and it can only ever be shades of that blue; paint it
white and a designer can retune a whole pattern's palette without new art.
\`verifyBullets\` in the generator script checks this for real — every painted
pixel is asserted \`R == G == B\` — rather than trusting that nobody reached for
a colour swatch by accident.

**Every cell keeps a 2px margin, and it is measured, not assumed.** The sheet is
8×2 cells of 32×32, and \`Atlas.uv\` applies no half-texel inset — the outermost
fragment column of a quad interpolates to the *boundary* between one cell and
the next, which is the first texel of the neighbour. Padding inside the cell is
the only thing between that and a stripe of the wrong sprite along every seam,
worse under \`"linear"\` filtering, which reaches across the seam by design.

So: **draw no larger than 28×28 inside a 32×32 cell**, and if you are exporting
a bitmap rather than describing a shape mathematically, *measure the painted
alpha bounding box* — do not trust the number in the shape's parameters. A
stroke's paint reaches past its nominal radius, a Bézier's apex lands short of
its control point; both have broken this exact rule in this project before
(\`docs/assets.md\` §1.2 tells that story in full, cell by cell). This pack's
generator does the same measurement it is describing: \`verifyBullets\` re-reads
\`bullets.png\` through an independent PNG parser after writing it and rejects
its own output if any cell exceeds 28px in either axis.

**Directional cells point right.** \`kunai\`, \`scale\`, \`needle\`, \`shard\` and
\`petal\` are drawn tapering toward \`+x\` — rotating art (\`orientToHeading\`)
turns to match its heading, and heading 0° is east (CLAUDE.md rule 7). Draw
blades pointing right, never up.

## Why the ship marks its hitbox

\`ship.png\` is a notched silhouette pointing up, same as the placeholder, with a
small bright disc near its true centre. In this game the hitbox is far smaller
than the sprite — a few pixels against a ship many times that size — and
showing where it actually is is a real readability feature for the player, not
a debug leftover.

Colour cannot separate the marker from the body; docs/packs.md §7.1 keeps this
whole sheet white. So the contrast is **alpha**: the body paints at 205 of 255, the
marker at a full 255. It is a small gap, deliberately — the marker should read
as "slightly brighter", not as a hole in the ship.

## HUD icons are shapes, not compositions

\`life.png\` and \`bomb.png\` replace the ♥/★ glyphs \`drawHud\` draws today, at up
to 16×16. **Position, size, alpha and tint stay engine-owned** — the same move
as white bullets tinted by the shader — so these icons carry shape only:
solid white, hard edge, no background, no assumption about how large they will
end up on screen or what sits behind them. Draw the smallest legible mark, and
let the engine decide how dim, how big, and where.

## Sound

\`shot.wav\` and \`pickup.wav\` are short, mono, 16-bit PCM, and audibly distinct
from the built-in synth voices in \`src/audio/index.ts\` on purpose: \`shot\` here
sweeps *up*, the synth's sweeps down; \`pickup\` here is a two-note chime, sized
so a swap is heard, not just seen in a boot report. The other four sounds this
game plays (\`hit\`, \`explosion\`, \`graze\`, \`death\` — the full list is
\`docs/audio.md\` §2) are left unset, and keep playing their placeholders; a
pack need not replace every sound to be valid.

## Music: an intro and a loop

\`music\` is a top-level section, a sibling of \`sounds\`, not part of \`content\` —
a track is a file, and a stage or boss only *names* one. This pack adds one
track, \`ashen\`, and \`content.stages.gauntlet\` is scored to it:

\`\`\`json
"music": { "ashen": { "file": "ashen.wav", "loopStart": 0.6, "loopEnd": 4.2, "volume": 0.5 } }
\`\`\`

**A track has an intro and a loop, in seconds.** Playback runs from 0 to
\`loopEnd\` once — so everything before \`loopStart\` is the intro, heard exactly
once — then repeats \`[loopStart, loopEnd)\` forever. Omit both and the whole file
loops; give \`loopStart\` alone and the loop runs to the file's end.

**How to find the loop points.** Open the track in any audio editor and read the
time, in seconds, at two places: where the intro ends and the repeating body
begins (\`loopStart\`), and where that body should jump back (\`loopEnd\`). For a
seamless wrap the body's length should hold a whole number of cycles of its
lowest tone, so the waveform value at \`loopEnd\` matches the one at \`loopStart\` —
\`ashen\` is generated that way (see \`buildAshen\` in the generator, which picks
55/82.5/110 Hz precisely so 3.6 s of body wraps clean). The engine also clamps a
loop region that runs past the decoded track back to the whole file, so a wrong
\`loopEnd\` degrades to "loops the whole thing", never a crash — but the loader
still *rejects* the pack and prints the measured duration, so fix it rather than
lean on the clamp.

**Music sits under the sound effects — the readability rule has an audio face.**
The whole point of the negative-space doctrine is that a single bullet stays
findable; the same holds for its *sound* cue. Music runs on its own bus, already
set well under the SFX, and \`volume\` only trims a track within that — never a
reason to push a theme up until it competes with a shot or a graze. Keep it low
and dark: \`ashen\` is three bass partials and a slow tremolo, nothing in the band
where a bullet's cue lives. A track loud or busy enough to mask that cue is a
readability bug you can hear, exactly like a background bright enough to hide a
bullet is one you can see.

The built-in tracks (\`menu\`, and one per built-in stage and boss — see
\`docs/audio.md\` §Music) are synthesised drones until a pack gives them a file.
Naming one of *those* in your \`music\` section replaces it, last-wins, the same
as a \`sounds\` reskin; a new name like \`ashen\` adds a track your own stages and
bosses can name.

## Dialogue: who speaks, and who is drawn

A boss can carry a **pre-fight exchange**. When \`ashfall\` sends \`pyre\`, the run
enters a dialogue phase before the boss spawns: the screen's bullets are cleared,
enemies stop coming, and the ship still flies but cannot fire. Each **fresh Shot
press** advances one line — a *tap*, not a hold, so leaning on the fire button
does not skip it — and after the last line \`pyre\` enters and the fight begins.

Dialogue is two halves that live in two different places, because they are two
different kinds of thing.

**The lines are content — they ride inside the boss.** \`pyre\`'s exchange is a
\`dialogue\` array on \`content.bosses.pyre\`, each entry a \`{ speaker, text }\`:

\`\`\`json
"dialogue": [
  { "speaker": "pyre",   "text": "You reached the ash. Few do." },
  { "speaker": "player", "text": "Then few have put it out." }
]
\`\`\`

A \`speaker\` is a **portrait name**, resolved pack-first then built-in exactly like
every other reference: \`pyre\` is this pack's own portrait (qualified to
\`example/pyre\`), and \`player\` is a built-in. Because dialogue changes what the
run *does* — it delays the boss, so a replay must reproduce the taps — the lines
travel with the boss spec under the run's strict \`packsData\` identity, the same as
a stage or a character. **A replay recorded against different dialogue is refused,
not warned.**

**A boss can speak differently to different ships.** Beside \`dialogue\` an optional
\`dialogueFor\` maps a **character name** to its own exchange, used in place of the
default when that ship flies the fight; every other character keeps \`dialogue\`.
\`pyre\` greets this pack's own \`raider\` with three lines of its own:

\`\`\`json
"dialogueFor": {
  "raider": [
    { "speaker": "pyre",   "text": "A raider. You burn what you cannot carry." },
    { "speaker": "player", "text": "And carry what will not burn." },
    { "speaker": "pyre",   "text": "Then we are the same. A pity." }
  ]
}
\`\`\`

A key resolves pack-first exactly as a reference does — \`raider\` is this pack's own
character, so it matches the \`example/raider\` a raider run flies under; a built-in
character name would stay bare. A variant may run a **different line count** (this
one runs three where the default runs two): that changes only that character's
tap timeline, which is why a replay pins the character it was flown on. Speakers
inside a variant validate as the default's do.

**The faces are presentation — they ride in a top-level \`portraits\` section.** A
portrait is a file the shell draws beside the line; it changes nothing the
simulation can see, so a \`portraits\` entry is a reskin, **warn-only** on replay
like \`assets\` and \`sounds\`. This pack adds one:

\`\`\`json
"portraits": { "pyre": "portrait.png" }
\`\`\`

A NEW name (no built-in portrait is called \`pyre\`) registers as \`example/pyre\`,
which is what \`pyre\`'s \`dialogue\` names bare and the injector qualifies. **A
portrait must be exactly 96×96** — the shell composites it into a fixed cell, so
the loader's check is exact (a mismatch is rejected with the measured size),
unlike a hud icon's tolerant upper bound.

**Every speaker draws, art or no art.** A speaker with no \`portraits\` entry — a
built-in \`player\`, or a name you have not drawn yet — is not an error at draw
time: the shell paints a **procedural silhouette** seeded from the name, the same
permanent floor as bullets and ship. So the text half is what a boss needs to
speak; the portrait half only *replaces the silhouette with your art*. That split
— strict lines, warn-only faces — is why they sit in two sections rather than one.
`;

/* ------------------------------------------------------------------ */
/* Write, verify, report                                                */
/* ------------------------------------------------------------------ */

const files: Record<string, Uint8Array | string> = {};

const bulletsPng = buildBullets();
const shipPng = buildShip();
const lifePng = buildHudIcon(diamond(6));
const bombPng = buildHudIcon((dx, dy) => plus(6, 1)(dx, dy) || xMark(5, 1)(dx, dy));
const shotWav = buildShot();
const pickupWav = buildPickup();
const ashenSamples = buildAshen();
const ashenWav = encodeWavMono(ashenSamples);
const portraitPng = buildPortrait();

files['bullets.png'] = bulletsPng;
files['ship.png'] = shipPng;
files['life.png'] = lifePng;
files['bomb.png'] = bombPng;
files['shot.wav'] = shotWav;
files['pickup.wav'] = pickupWav;
files['ashen.wav'] = ashenWav;
files['portrait.png'] = portraitPng;
files['pack.json'] = JSON.stringify(MANIFEST, null, 2) + '\n';
files['README.md'] = README;

const report: string[] = [];

report.push('bullets.png — cell margins:');
report.push(...verifyBullets(bulletsPng));

report.push('ship.png:');
report.push(verifyShip(shipPng));

const hudIcons: ReadonlyArray<readonly [string, Uint8Array]> = [
  ['life.png', lifePng],
  ['bomb.png', bombPng],
];
for (const [name, bytes] of hudIcons) {
  verifyHudIcon(name, bytes);
  const png: PngHeader = parsePng(bytes);
  report.push(`${name}: ${png.width}x${png.height} (limit ${HUD_SIZE}x${HUD_SIZE})`);
}

report.push('ashen.wav — music loop:');
report.push(verifyAshen(ashenSamples));

report.push('portrait.png — dialogue portrait:');
report.push(verifyPortrait('portrait.png', portraitPng));

// The manifest this script is about to write, checked against the real
// validator it will be loaded by — not a second, hand-maintained idea of what
// "valid" means.
{
  const result = validateManifest(MANIFEST, 'example');
  if ('errors' in result) {
    throw new Error(`pack.json fails its own validator:\n${result.errors.join('\n')}`);
  }
  report.push('pack.json: validates clean against src/packs/manifest.ts');
}

mkdirSync(OUT, { recursive: true });
for (const [name, contents] of Object.entries(files)) {
  writeFileSync(join(OUT, name), typeof contents === 'string' ? contents : contents);
}

console.log(`wrote ${Object.keys(files).length} files to ${OUT}\n`);
console.log(report.join('\n'));
