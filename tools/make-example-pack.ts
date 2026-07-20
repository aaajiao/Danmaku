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
 * `scale` and `needle` (`src/content/stage-2.ts`, `src/content/shots.ts`,
 * `src/sim/boss.ts`). Everything else is rotation-symmetric, so it reads the
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
/* content — format-2 enemies and stages, as data                      */
/* ------------------------------------------------------------------ */

/**
 * Every field in `content` mirrors an engine spec verbatim — a pack enemy IS an
 * `EnemySpec`, a pack stage IS a `StageSpec` (minus its name, which is the
 * section key) — so there is no translation layer to keep in step, and the
 * numbers below are chosen in the same range as the built-in cast in
 * `src/sim/enemy.ts` and `src/content/stage.ts` so a copy-paste author starts
 * from something balanced rather than from a placeholder that plays wrong.
 *
 * Name resolution is pack-first, then built-in. `ember` and `drone` are this
 * pack's own enemies, written bare and qualified to `example/ember` /
 * `example/drone` at injection; `grunt` is a built-in named bare; `sentinel` is
 * a built-in boss (packs may name built-in bosses only — `content.bosses` is
 * reserved); `expanse`/`undertow` are built-in backgrounds; `power`/`score` are
 * built-in item names; `aimed-fan`/`spiral` are built-in patterns. A pack
 * defines enemies and stages; it references everything else by name.
 */

/** A bullet the pack's patterns fire — an ordinary `BulletSpec`, white cell, engine-tinted. */
const EMBER_SHOT = {
  style: { sprite: 'orb.small', r: 1, g: 0.6, b: 0.2 },
  radius: 3,
  motion: { r: 2.2, theta: 90 },
};

const CONTENT: PackContent = {
  enemies: {
    // Full-featured: a base motion, a timeline that re-inits it (dive, sweep,
    // leave — the `weaver` shape), two patterns with real options, spoils, a
    // tint, and a score value. Everything an `EnemySpec` can carry.
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
      patterns: [
        { pattern: 'aimed-fan', options: { spec: EMBER_SHOT, count: 3, spread: 28, period: 55 }, startAt: 20 },
        { pattern: 'spiral', options: { spec: EMBER_SHOT, arms: 2, step: 13, period: 8 }, startAt: 30, stopAt: 110 },
      ],
      spoils: [['power', 2], ['score', 1]] as [string, number][],
      scoreValue: 300,
      onHit: 'hit',
      onDeath: 'explosion',
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
  stages: {
    // The entry — the row that appears under START. Uses both pack enemies and
    // a built-in one, and chains into the second stage by name.
    gauntlet: {
      entry: true,
      seed: 7,
      background: 'expanse',
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
    // The second stage, reached only via `gauntlet`'s `next`. Its climax is a
    // boss wave naming a built-in boss — the schedule holds there until the boss
    // is gone, then the tail wave falls due. `next: null` states, explicitly,
    // that this is the last stage.
    ashfall: {
      seed: 11,
      background: 'undertow',
      outro: 120,
      next: null,
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
    'The reference pack: every manifest field, art that follows every rule the loader checks, and a two-stage campaign of format-2 content. Copy this directory, rename it, and swap the files.',
  assets: {
    bullets: 'bullets.png',
    ship: 'ship.png',
    filter: 'nearest',
  },
  sounds: {
    shot: 'shot.wav',
    pickup: 'pickup.wav',
  },
  hud: {
    life: 'life.png',
    bomb: 'bomb.png',
  },
  // The covering invariant: every content.<section> present must be named here,
  // and vice versa. It is what lets a v1 engine refuse on `requires` before it
  // ever parses `content`.
  requires: ['content.enemies', 'content.stages'],
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
| \`requires\` | \`["content.enemies", "content.stages"]\` | The capabilities this pack's \`content\` needs. The engine honours exactly the two named here; anything else is refused by name. Every \`content.<section>\` present must be declared here and vice versa — the covering invariant, which is what lets an older engine refuse on \`requires\` before it parses a \`content\` section it could not load. |
| \`content\` | two enemies, two stages | Format-2 game content: the enemies and stages this pack adds. See "Content: enemies and stages" below. |

The fields this engine still does not implement — the reserved \`content\`
sections \`bosses\`/\`characters\`/\`items\`/\`music\`/\`difficulty\`/\`dialog\`/
\`backgrounds\`, the top-level \`music\`/\`difficulty\`/\`dialog\`/\`backgrounds\`, and
the reserved \`hud\` names \`digits\`/\`font\`/\`bossBar\`/\`frame\` — get a dedicated
rejection naming each as a future section rather than a generic "unknown field"
error; see \`docs/packs.md\` §Future.

## Content: enemies and stages

\`content\` is where a pack stops reskinning the game and starts adding to it. This
pack ships two enemies and a two-stage campaign; the row it adds under START on
the title screen (\`example/gauntlet\`) is the campaign's entry stage.

**A pack enemy IS an \`EnemySpec\`; a pack stage IS a \`StageSpec\`.** There is no
translation — the JSON below is handed straight to \`defineEnemy\`/\`defineStage\`
after its names are checked. So the authoring reference is the engine's own:
\`src/sim/enemy.ts\` for an enemy's fields (\`sprite\`, \`hp\`, \`radius\`, \`motion\`,
\`timeline\`, \`patterns\`, \`spoils\`, \`tint\`, …) and \`src/content/stage.ts\` for a
stage's (\`waves\`, \`seed\`, \`outro\`, \`boss\`, \`background\`, plus \`entry\`/\`next\`).

**Names resolve pack-first, then built-in.** Your own enemies and stages are
written **bare** inside your JSON and registered under a \`<packname>/\` prefix, so
this pack's \`ember\` becomes \`example/ember\`. A bare name that is not one of your
own resolves to a built-in: \`grunt\` in a wave is the built-in grunt, \`sentinel\`
is the built-in boss, \`expanse\` and \`undertow\` are built-in backgrounds,
\`power\`/\`score\` in \`spoils\` are built-in items, \`aimed-fan\`/\`spiral\` are built-in
patterns. **A pack defines enemies and stages and references everything else by
name.** Cross-pack references are not supported: a name is either yours or a
built-in's.

**Bosses and backgrounds are built-ins you reference, never author.**
\`content.bosses\` is a reserved future section, and a background is a fragment
shader — engine code. A pack stage names one of each by string; it cannot ship
one. Name a boss or background that does not exist and injection refuses the pack
whole, listing (for backgrounds) the ones that do.

**Registration is not reachability, and the injector enforces it.** Two rules,
both errors that reject the pack:

- At least one stage must be an \`entry\`, and every stage must be reachable — an
  \`entry\`, or the \`next\` of some stage in the pack. A stage that is neither is
  dead content. \`gauntlet\` is the entry; \`ashfall\` is reached by its \`next\`.
- Every enemy the pack defines must be spawned by some wave of some pack stage.
  An enemy nothing places is dead content. \`ember\` and \`drone\` are both flown by
  \`gauntlet\`.

Use \`next: null\` to say a stage is the last one explicitly (an omitted \`next\`
means the same, but \`null\` reads as a decision rather than a gap). \`ashfall\` ends
the campaign that way, after a boss wave that summons \`sentinel\`.

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

files['bullets.png'] = bulletsPng;
files['ship.png'] = shipPng;
files['life.png'] = lifePng;
files['bomb.png'] = bombPng;
files['shot.wav'] = shotWav;
files['pickup.wav'] = pickupWav;
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
