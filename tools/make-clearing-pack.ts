/**
 * Generate `packs/clearing/` — the second guest pack, content-first.
 *
 *     bun tools/make-clearing-pack.ts
 *
 * ## What this pack is for
 *
 * `packs/example` is the reference: it exercises *every* manifest field and one
 * of every content section, painting its own bullet sheet, ship, HUD, portrait
 * and sounds so a copy-paste author sees art take effect at a glance. This pack
 * is the opposite proof — the **procedural floor under load**. It paints no
 * bullet sheet, no ship, no HUD icons and ships no sound files: every one of
 * those falls through to `src/render/procedural.ts` and `src/audio/`, and the
 * whole two-campaign, three-boss pack still boots and plays. That the game is
 * *never blocked on assets* (CLAUDE.md rule 9) is a claim; this pack is the load
 * test for it.
 *
 * Presentation is kept to the floor, with two structurally-required exceptions:
 * the one music track this pack carries, and the two boss portraits its speaking
 * bosses need. A dialogue speaker's portrait NAME must resolve at INJECTION time
 * (`src/packs/inject.ts` refuses a speaker whose portrait is neither a built-in
 * nor a pack-carried one); the procedural silhouette is a render-time fallback
 * the injector deliberately does not accept for validation. `assay` is a gate and
 * never speaks, so it carries no face; `escrow` and `lien` speak, so each carries
 * one. Everything else — bullets, ship, HUD, all six sounds — is procedural.
 *
 * ## The fiction, so the numbers are not arbitrary
 *
 * A **clearing house** — the settlement sibling to the base game's magistrates
 * and wardens, nouns of procedure rather than persons. Two lanes through one
 * institution: **Manifest** (`intake` → `manifest-floor`), the standard teaching
 * queue that ramps from trash into a midboss (`assay`) and an end boss
 * (`escrow`); and **Demurrage** (`demurrage`), the penalty lane for late arrival
 * — dense from the first wave, stingy with drops, ending on `lien`.
 *
 * ## What it proves that `example` does not
 *
 *  - **The procedural floor holds for a themed pack**, not just a demo — one
 *    carried file, everything else inherited.
 *  - **Two `entry: true` stages → two TITLE rows** (`example` ships one).
 *  - **A pack boss used as a MIDBOSS wave** (`assay`) alongside a pack end boss
 *    (`escrow`) that re-sends at wave exhaustion.
 *  - **A disjoint difficulty slot**: two complementary-gated phases
 *    (`provisional-clearance` on easy/normal, `final-clearance` on hard/lunatic)
 *    give every tier exactly three cards. `example` showed only a lunatic-only
 *    card; this shows narrowing toward BOTH the low and the high tiers.
 *  - **A `dialogueFor` variant keyed to a BUILT-IN character** (`scout`), where
 *    `example` keyed its variant to its own pack character.
 *  - **All four item kinds** (`power`/`score`/`life`/`bomb`); `example` shipped
 *    a `score` item only.
 *  - **A character built entirely from base rows** — `consignee` names `scout`'s
 *    `spread`/`standard`/`spread` and declares no `content.shots`/`.options`/
 *    `.bombs`, so `balance.test` (base-only derivation) is untouched by it.
 *  - **A reskin that replaces a BUILT-IN music name** (`descent`), demonstrating
 *    the replay split — content refuses, skins warn — from one worked example.
 *
 * ## Self-verification
 *
 * Same discipline as `make-example-pack.ts`. The carried WAV is **re-parsed from
 * its own encoded bytes** (RIFF header decoded back, the duration re-derived from
 * the sample count, the loop seam measured off the decoded samples) before being
 * trusted, never read back off the Float64Array that produced it. The two
 * portraits are **re-read through `parsePng`** and their dimensions checked
 * against `PORTRAIT_SIZE` — the exact bound the loader enforces. And `pack.json`
 * is round-tripped through the real `validateManifest` — so this script cannot
 * commit a pack its own validator would reject.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sinDeg } from '../src/core/trig';
import { ColourType, encodePng, parsePng, pixelOf } from './png';
import { validateManifest, type PackContent, type PackManifest } from '../src/packs/manifest';

const OUT = join(import.meta.dir, '..', 'packs', 'clearing');

/* ------------------------------------------------------------------ */
/* WAV — a minimal inline 16-bit PCM mono encoder                       */
/* ------------------------------------------------------------------ */

const SAMPLE_RATE = 44100;

/**
 * 16-bit PCM, mono — the same shape `make-example-pack.ts` uses, and for the same
 * reason: this pack only ever needs one channel, and `make-fixtures.ts`'s
 * multi-channel `encodeWav` is not exported. Two copies of forty lines is a
 * smaller cost than widening that seam.
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
    // Asymmetric scale on purpose (see make-example-pack.ts): 16-bit two's
    // complement reaches -32768 but only +32767; scaling both ends by 32768
    // wraps a full-scale positive sample into a negative one.
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }
  return out;
}

/**
 * A minimal WAV *parser*, the counterpart the example generator did not need (it
 * re-read its PNGs through `parsePng` and only measured its WAV off the sample
 * array). Here the one carried file is a WAV, so it is re-parsed from the encoded
 * bytes — the "measure the output, do not trust the parameter" rule — reading the
 * RIFF/fmt/data chunks back to confirm the header the loader will read and to
 * re-derive the duration from the real sample count.
 */
interface WavHeader {
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  sampleCount: number;
  duration: number;
}

function parseWavMono(bytes: Uint8Array): WavHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number): string =>
    String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
  if (tag(0) !== 'RIFF') throw new Error(`descent.wav: not RIFF (${tag(0)})`);
  if (tag(8) !== 'WAVE') throw new Error(`descent.wav: not WAVE (${tag(8)})`);
  if (tag(12) !== 'fmt ') throw new Error(`descent.wav: missing fmt chunk`);
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  if (tag(36) !== 'data') throw new Error(`descent.wav: missing data chunk`);
  const dataBytes = view.getUint32(40, true);
  const sampleCount = dataBytes / (bitsPerSample / 8) / channels;
  return { channels, sampleRate, bitsPerSample, sampleCount, duration: sampleCount / sampleRate };
}

/* ------------------------------------------------------------------ */
/* descent.wav — a falling intro over a darker, seamless loop           */
/* ------------------------------------------------------------------ */

/**
 * The track's shape, in seconds. Playback runs 0 → `LOOP_END` once (so the
 * `[0, LOOP_START]` intro is heard exactly once), then loops `[LOOP_START,
 * LOOP_END]` forever. A short tail past `LOOP_END` exists only so the manifest
 * demonstrates `loopEnd < duration` — the loader's browser-side check has a real
 * relationship to measure — and is never reached under `loop = true`.
 *
 * This is a DIFFERENT composition from `example`'s `ashen`, deliberately: it is a
 * DESCENT. Where `ashen` swells a bass triad up over its intro, this glides a
 * high voice DOWN an octave-and-a-fifth into the loop root during the intro, then
 * settles onto a bed a fifth LOWER than ashen's (root 41 Hz against ashen's 55) —
 * darker, and heard to fall before it holds. It also REPLACES the built-in track
 * name `descent`, so it is the reskin that carries the pack's replay split.
 *
 * Seamlessness is the same trick, applied to the LOOP BODY only: every partial in
 * the bed completes a WHOLE number of cycles across `LOOP_END − LOOP_START`
 * (4.0s), so the waveform at `LOOP_END` equals the one at `LOOP_START`
 * sample-for-sample. 41, 61.5 and 82 Hz all give an integer over 4.0s (164, 246,
 * 328 cycles), and the amplitude tremolo runs at 0.25 Hz — exactly one cycle over
 * the loop — so even the sway matches at the wrap. The descending intro voice has
 * faded to silence by `LOOP_START`, so it never touches the loop body.
 */
const DESCENT_TOTAL = 5.2;
const DESCENT_LOOP_START = 0.8;
const DESCENT_LOOP_END = 4.8;
const DESCENT_VOLUME = 0.45;

/**
 * The loop bed's low partials (Hz, amplitude): a bass root, a perfect fifth, the
 * octave — weighted hard toward the root so the timbre reads dark, and all bass so
 * it never masks a bullet's cue. Each Hz is an exact multiple of 0.5, so each
 * completes a whole number of cycles across the 4.0s loop body.
 */
const DESCENT_PARTIALS: readonly (readonly [hz: number, amp: number])[] = [
  [41, 0.72],
  [61.5, 0.2],
  [82, 0.08],
];

function buildDescent(): Float64Array {
  const count = Math.round(DESCENT_TOTAL * SAMPLE_RATE);
  const out = new Float64Array(count);
  const norm = 1 / DESCENT_PARTIALS.reduce((s, [, a]) => s + a, 0);
  const peak = 0.45; // darker and quieter than ashen's 0.5, well under full scale

  // The intro's falling voice, integrated by phase accumulation so its pitch can
  // glide continuously. It starts an octave-and-a-fifth above the root (164 Hz)
  // and slides to the root (41 Hz) across the intro, its amplitude fading to zero
  // by LOOP_START so it leaves nothing in the loop body to break the seam.
  let glidePhase = 0;

  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;

    // The steady bed — the loop body's whole-cycle partials, phase taken from the
    // GLOBAL t (never reset), so value(LOOP_START) === value(LOOP_END).
    let bed = 0;
    for (const [hz, amp] of DESCENT_PARTIALS) bed += amp * sinDeg((hz * t * 360) % 360);
    bed *= norm;

    // The bed swells in across the intro and holds at full through the loop.
    const bedEnv = t < DESCENT_LOOP_START ? 0.35 + 0.65 * (t / DESCENT_LOOP_START) : 1;

    // The descending intro voice: pitch glides high → root, amplitude fades to 0.
    let voice = 0;
    if (t < DESCENT_LOOP_START) {
      const p = t / DESCENT_LOOP_START; // 0 → 1 across the intro
      const hz = 164 + (41 - 164) * p; // fall an octave and a fifth
      glidePhase = (glidePhase + (hz / SAMPLE_RATE) * 360) % 360;
      voice = sinDeg(glidePhase) * 0.42 * (1 - p) * (1 - p); // quadratic fade-out
    }

    // Amplitude tremolo at 0.25 Hz — exactly one cycle over the 4.0s loop body, so
    // it too wraps seamlessly. A hair of drift in the intro region is inaudible.
    const sway = 0.72 + 0.28 * sinDeg((0.25 * t * 360) % 360);

    out[i] = (bed * bedEnv + voice) * sway * peak;
  }
  return out;
}

/**
 * Re-parse the ENCODED bytes (not the sample array that produced them), confirm
 * the header the loader reads, and re-derive the duration from the real sample
 * count — then check the loop points sit inside it, the one relationship the
 * loader re-checks in the browser.
 */
function verifyDescent(bytes: Uint8Array): string[] {
  const h = parseWavMono(bytes);
  if (h.channels !== 1) throw new Error(`descent.wav: ${h.channels} channels, expected mono`);
  if (h.sampleRate !== SAMPLE_RATE) throw new Error(`descent.wav: ${h.sampleRate} Hz, expected ${SAMPLE_RATE}`);
  if (h.bitsPerSample !== 16) throw new Error(`descent.wav: ${h.bitsPerSample}-bit, expected 16`);
  if (!(DESCENT_LOOP_START < DESCENT_LOOP_END)) {
    throw new Error(`descent.wav: loopStart ${DESCENT_LOOP_START} must be < loopEnd ${DESCENT_LOOP_END}`);
  }
  if (DESCENT_LOOP_END > h.duration) {
    throw new Error(`descent.wav: loopEnd ${DESCENT_LOOP_END}s is past the ${h.duration.toFixed(3)}s track`);
  }
  // Measure the wrap discontinuity from the decoded samples: value at LOOP_START
  // vs value at LOOP_END must match, or the loop clicks. Decode both back.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sampleAt = (sec: number): number =>
    view.getInt16(44 + Math.round(sec * SAMPLE_RATE) * 2, true) / 32767;
  const seam = Math.abs(sampleAt(DESCENT_LOOP_START) - sampleAt(DESCENT_LOOP_END));
  if (seam > 0.02) {
    throw new Error(`descent.wav: loop seam discontinuity ${seam.toFixed(4)} — the bed partials are not whole-cycle over the loop`);
  }
  return [
    `  ${h.duration.toFixed(3)}s, mono ${h.sampleRate}Hz/${h.bitsPerSample}-bit, ${h.sampleCount} samples`,
    `  loop [${DESCENT_LOOP_START}s, ${DESCENT_LOOP_END}s) inside it — intro (falling) plays once`,
    `  wrap discontinuity ${seam.toFixed(4)} (< 0.02) — seamless`,
  ];
}

/* ------------------------------------------------------------------ */
/* Portraits — the face a SPEAKING boss's line needs to resolve         */
/* ------------------------------------------------------------------ */

/**
 * The one square a portrait must be (`PORTRAIT_SIZE`, `src/render/portrait.ts`).
 * The loader's dimension check is EXACT, so a portrait that is anything other than
 * this size rejects the pack.
 */
const PORTRAIT_SIZE = 96;

/**
 * A boss bust, flat and hard-edged — like `example`'s portrait, deliberately
 * UNLIKE the procedural silhouette so an author sees it took the place of the
 * fallback, but in this pack's cool clearing-house palette rather than ember. A
 * portrait is drawn once, not per-instance tinted, so unlike a bullet cell it
 * carries its own colour. `head`/`body`/`visor` are per-boss channel triples so
 * `escrow` and `lien` read as two distinct faces, not one recoloured twice.
 */
function buildPortrait(
  head: readonly [number, number, number],
  body: readonly [number, number, number],
  visor: readonly [number, number, number],
  panelTop: readonly [number, number, number],
  panelBottom: readonly [number, number, number],
  visorTilt: number,
): Uint8Array {
  const cx = PORTRAIT_SIZE / 2;
  const inHead = (x: number, y: number): boolean => (x - cx) * (x - cx) + (y - 34) * (y - 34) <= 18 * 18;
  const inShoulders = (x: number, y: number): boolean => {
    if (y < 52) return false;
    const halfW = 12 + (y - 52) * 0.72; // widening toward the base
    return Math.abs(x - cx) <= Math.min(halfW, 42);
  };
  // A visor band across the head, tilted per boss so the two faces differ in
  // silhouette detail as well as colour.
  const inVisor = (x: number, y: number): boolean => {
    const band = 34 + (x - cx) * visorTilt;
    return Math.abs(y - band) <= 4 && Math.abs(x - cx) <= 15;
  };
  return encodePng(PORTRAIT_SIZE, PORTRAIT_SIZE, ColourType.RGBA, (x, y) => {
    if (inHead(x, y)) return inVisor(x, y) ? [visor[0], visor[1], visor[2], 255] : [head[0], head[1], head[2], 255];
    if (inShoulders(x, y)) return [body[0], body[1], body[2], 255];
    return y < PORTRAIT_SIZE / 2 ? [panelTop[0], panelTop[1], panelTop[2], 255] : [panelBottom[0], panelBottom[1], panelBottom[2], 255];
  });
}

function verifyPortrait(name: string, bytes: Uint8Array): string {
  const png = parsePng(bytes);
  if (png.width !== PORTRAIT_SIZE || png.height !== PORTRAIT_SIZE) {
    throw new Error(`${name}: ${png.width}x${png.height}, must be exactly ${PORTRAIT_SIZE}x${PORTRAIT_SIZE}`);
  }
  // A real interior sample: the head centre must be painted (opaque).
  const [, , , a] = pixelOf(png, PORTRAIT_SIZE / 2, 34);
  if (a === 0) throw new Error(`${name}: head centre is transparent — nothing painted`);
  return `  ${name}: ${png.width}x${png.height} — exactly ${PORTRAIT_SIZE}x${PORTRAIT_SIZE}`;
}

/* ------------------------------------------------------------------ */
/* Bullet specs — white cells, engine-tinted, procedural sheet          */
/* ------------------------------------------------------------------ */

/*
 * Every `style.sprite` below names a PROCEDURAL cell — this pack carries no
 * bullet sheet, so these resolve against `src/render/procedural.ts`'s
 * `BULLET_CELLS`. Bullets stay white (`docs/packs.md` §7.1); the r/g/b is the
 * engine's per-instance tint. `orientToHeading` cells (`needle`, `scale`) point
 * +x and the shader turns them to heading (CLAUDE.md rule 7).
 */

// --- enemy bullets ---
const COURIER_NEEDLE = {
  style: { sprite: 'needle', r: 0.7, g: 0.85, b: 1, orientToHeading: true },
  radius: 3,
  motion: { r: 2.4, theta: 90, behaviour: 'waver', options: { amplitude: 10, period: 60, duration: 480 } },
};
const INSPECTOR_ORB = {
  style: { sprite: 'orb.small', r: 0.7, g: 0.8, b: 0.95 },
  radius: 3,
  motion: { r: 2.0, theta: 90 },
};
const TURNSTILE_SCALE = {
  style: { sprite: 'scale', r: 0.65, g: 0.82, b: 0.95, orientToHeading: true },
  radius: 3,
  motion: { r: 2.1, theta: 90 },
};
const SKIMMER_ORB = {
  style: { sprite: 'orb.small', r: 0.75, g: 0.88, b: 1 },
  radius: 3,
  motion: { r: 2.2, theta: 90 },
};
// The weigher's aimed slot: hangs slow, then snaps forward (the pause of
// assessment, then judgement).
const WEIGHER_SNAP = {
  style: { sprite: 'orb.medium', r: 0.6, g: 0.78, b: 0.98 },
  radius: 4,
  motion: { r: 0.4, theta: 90, behaviour: 'accelerate-to', options: { speed: 4.0, delay: 40, duration: 24 } },
};
const WEIGHER_RING = {
  style: { sprite: 'orb.small', r: 0.7, g: 0.82, b: 0.96 },
  radius: 3,
  motion: { r: 2.0, theta: 90 },
};

// --- boss bullets ---
const ASSAY_SNAP = {
  style: { sprite: 'orb.small', r: 0.66, g: 0.8, b: 0.98 },
  radius: 3,
  motion: { r: 0.4, theta: 90, behaviour: 'accelerate-to', options: { speed: 3.6, delay: 30, duration: 20 } },
};
const ASSAY_NEEDLE = {
  style: { sprite: 'needle', r: 0.7, g: 0.86, b: 1, orientToHeading: true },
  radius: 3,
  motion: { r: 2.6, theta: 90 },
};
// Escrow holds a ring on a circle, then releases it tangentially ("held in
// escrow, then cleared").
const ESCROW_HALO = {
  style: { sprite: 'halo', r: 0.62, g: 0.78, b: 0.98 },
  radius: 4,
  motion: { r: 2, theta: 0, behaviour: 'orbit', options: { centerX: 240, centerY: 190, radius: 60, angularSpeed: 4, duration: 140 } },
};
const ESCROW_SCALE = {
  style: { sprite: 'scale', r: 0.7, g: 0.82, b: 0.96, orientToHeading: true },
  radius: 4,
  motion: { r: 2.3, theta: 90 },
};
const ESCROW_SPIRAL = {
  style: { sprite: 'orb.small', r: 0.68, g: 0.8, b: 0.98 },
  radius: 3,
  motion: { r: 2.2, theta: 0 },
};
// Lien's debt turns toward you.
const LIEN_HOMING = {
  style: { sprite: 'needle', r: 0.6, g: 0.72, b: 0.95, orientToHeading: true },
  radius: 3,
  motion: { r: 2.4, theta: 90, behaviour: 'homing', options: { turnRate: 2.0, delay: 18, duration: 60 } },
};
const LIEN_WAVER = {
  style: { sprite: 'scale', r: 0.64, g: 0.76, b: 0.96, orientToHeading: true },
  radius: 3,
  motion: { r: 2.2, theta: 90, behaviour: 'waver', options: { amplitude: 12, period: 56, duration: 600 } },
};
const LIEN_ORBIT = {
  style: { sprite: 'orb.medium', r: 0.6, g: 0.74, b: 0.95 },
  radius: 4,
  motion: { r: 2, theta: 0, behaviour: 'orbit', options: { centerX: 240, centerY: 200, radius: 70, angularSpeed: -3.5, duration: 120 } },
};
const LIEN_ACCENT = {
  style: { sprite: 'orb.small', r: 0.66, g: 0.72, b: 0.96 },
  radius: 3,
  motion: { r: 2.6, theta: 90, behaviour: 'homing', options: { turnRate: 1.4, delay: 12, duration: 48 } },
};
const LIEN_SPRAY = {
  style: { sprite: 'orb.small', r: 0.7, g: 0.75, b: 0.98 },
  radius: 3,
  motion: { r: 2.5, theta: 90 },
};

/* ------------------------------------------------------------------ */
/* content — every section this pack ships, as data                     */
/* ------------------------------------------------------------------ */

const CONTENT: PackContent = {
  // --- enemies: the clearing house's clerks -------------------------------
  enemies: {
    // Streams in wide fans of wavering needles — the teaching enemy.
    courier: {
      sprite: 'kunai',
      hp: 10,
      radius: 7,
      tint: { r: 0.7, g: 0.85, b: 1 },
      motion: { r: 2.0, theta: 90 },
      timeline: [
        { count: 0, motion: { r: 2.0, theta: 90 } },
        { count: 70, motion: { r: 1.4, theta: 60, w: 1.5 } },
        { count: 150, motion: { r: 2.4, theta: 90 } },
      ],
      patterns: [
        {
          pattern: 'aimed-fan',
          options: { spec: COURIER_NEEDLE, count: 3, spread: 28, period: 55 },
          difficulty: {
            easy: { count: 2, spread: 24 },
            hard: { count: 4, spread: 34, period: 48 },
            lunatic: { count: 5, spread: 40, period: 42 },
          },
          startAt: 20,
        },
      ],
      spoils: [['stamp', 1]] as [string, number][],
      scoreValue: 100,
      onHit: 'hit',
      onDeath: 'explosion',
    },
    // A slow anchor that lays down an even ring.
    inspector: {
      sprite: 'star',
      hp: 22,
      radius: 11,
      tint: { r: 0.72, g: 0.82, b: 0.98 },
      motion: { r: 1.5, theta: 90 },
      patterns: [
        {
          pattern: 'ring',
          options: { spec: INSPECTOR_ORB, count: 12, period: 70, rotation: 6 },
          difficulty: {
            easy: { count: 10 },
            hard: { count: 16, period: 60 },
            lunatic: { count: 20, period: 52 },
          },
          startAt: 30,
        },
      ],
      spoils: [['stamp', 1]] as [string, number][],
      scoreValue: 200,
      onHit: 'hit',
      onDeath: 'explosion',
    },
    // Rotating arms — the queue that will not stop turning.
    turnstile: {
      sprite: 'ring',
      hp: 20,
      radius: 11,
      tint: { r: 0.68, g: 0.8, b: 0.96 },
      motion: { r: 1.6, theta: 90 },
      patterns: [
        {
          pattern: 'spiral',
          options: { spec: TURNSTILE_SCALE, arms: 2, step: 13, period: 8 },
          difficulty: {
            easy: { arms: 1 },
            hard: { arms: 3, step: 11 },
            lunatic: { arms: 4, step: 9, period: 6 },
          },
          startAt: 24,
          stopAt: 200,
        },
      ],
      spoils: [['receipt', 1]] as [string, number][],
      scoreValue: 200,
      onHit: 'hit',
      onDeath: 'explosion',
    },
    // A fast diver that scatters — draws from the sim stream (rule 2 territory).
    skimmer: {
      sprite: 'shard',
      hp: 9,
      radius: 7,
      tint: { r: 0.75, g: 0.86, b: 1 },
      motion: { r: 2.6, theta: 90 },
      patterns: [
        {
          pattern: 'spray',
          options: { spec: SKIMMER_ORB, count: 3, period: 26, spread: 60 },
          difficulty: {
            easy: { count: 2, period: 32 },
            hard: { count: 4, period: 22, spread: 74 },
            lunatic: { count: 5, period: 18, spread: 88 },
          },
          startAt: 16,
        },
      ],
      spoils: [['stamp', 1]] as [string, number][],
      scoreValue: 100,
      onHit: 'hit',
      onDeath: 'explosion',
    },
    // The heavy: an aimed snap-volley over a covering ring. Rare life bearer.
    weigher: {
      sprite: 'star',
      hp: 48,
      radius: 12,
      tint: { r: 0.6, g: 0.78, b: 0.98 },
      motion: { r: 1.3, theta: 90 },
      timeline: [
        { count: 0, motion: { r: 1.3, theta: 90 } },
        { count: 90, motion: { r: 0.6, theta: 90 } },
      ],
      patterns: [
        {
          pattern: 'aimed-fan',
          options: { spec: WEIGHER_SNAP, count: 3, spread: 20, period: 70 },
          difficulty: {
            easy: { count: 2, spread: 16 },
            hard: { count: 4, spread: 26, period: 60 },
            lunatic: { count: 5, spread: 32, period: 54 },
          },
          startAt: 40,
        },
        {
          pattern: 'ring',
          options: { spec: WEIGHER_RING, count: 10, period: 64, rotation: 8 },
          difficulty: {
            easy: { count: 8 },
            hard: { count: 14, period: 56 },
            lunatic: { count: 18, period: 48 },
          },
          startAt: 60,
        },
      ],
      spoils: [['writ', 1], ['receipt', 1]] as [string, number][],
      scoreValue: 500,
      onHit: 'hit',
      onDeath: 'explosion',
    },
  },

  // --- items: the four kinds, as instruments of settlement ----------------
  items: {
    // A clearance increment — power. Generous in Manifest, sparse in Demurrage
    // (fewer droppers there), the lane's difficulty texture expressed in drops.
    stamp: {
      sprite: 'glow.small',
      radius: 13,
      value: 1,
      kind: 'power',
      tint: { r: 0.7, g: 0.86, b: 1 },
      magnetSpeed: 7,
    },
    // A throughput bonus — score.
    receipt: {
      sprite: 'orb.medium',
      radius: 13,
      value: 1500,
      kind: 'score',
      tint: { r: 0.8, g: 0.9, b: 1 },
      magnetSpeed: 7,
    },
    // A rare extension — life. Off weighers and the midboss.
    writ: {
      sprite: 'star',
      radius: 15,
      value: 1,
      kind: 'life',
      tint: { r: 0.85, g: 0.95, b: 1 },
      magnetSpeed: 6,
    },
    // A held resource — bomb. Off the bosses (and the penalty lane's own mid-run).
    indemnity: {
      sprite: 'halo',
      radius: 15,
      value: 1,
      kind: 'bomb',
      tint: { r: 0.72, g: 0.8, b: 1 },
      magnetSpeed: 6,
    },
  },

  // --- character: reissued under a new consignee --------------------------
  // Every loadout row is a BASE row named by string: `spread` shot, `standard`
  // options, `spread` bomb, all `scout`'s — so this pack declares NO
  // content.shots/.options/.bombs, and its `player` block is `scout`'s verbatim,
  // which keeps its DPS identical to scout and `balance.test` (base-only
  // derivation) untouched by construction.
  characters: {
    consignee: {
      label: 'CONSIGNEE',
      sprite: 'ship',
      blurb: 'reissued under a new consignee — scout rows, clearing colours',
      shot: 'spread',
      options: 'standard',
      bomb: 'spread',
      player: {
        x: 240,
        y: 568,
        speed: 3.6,
        focusSpeed: 1.5,
        radius: 2.5,
        grazeRadius: 20,
        lives: 3,
        bombs: 3,
        invulnTicks: 90,
      },
    },
  },

  // --- bosses: the settlement officers ------------------------------------
  //
  // MEASURED, not estimated (the design's `hpSeconds` values were pre-measurement
  // estimates; the binding required re-tuning each so its phase drains within its
  // own clock flying `consignee`). The re-tune was driven, not guessed: a real
  // `Run` flying `clearing/consignee` — identical loadout, and so identical DPS,
  // to base `scout`, since it reuses `scout`'s `spread`/`standard`/`spread` rows —
  // was measured across every power tier × focus with balance.test's own harness
  // (immortal sink held dead ahead, 600 ticks). Measured damage/tick:
  //
  //     p0 free/focused 0.397   p1 free 0.403  focused 0.793
  //     p2 free 0.510  focused 1.287           p3 free 0.517  focused 1.293
  //
  // A phase's clock is `phaseClock(phaseHp(hpSeconds))` = 2× the drain time at
  // REFERENCE_DPS (1.125, CLOCK_MARGIN 2), so every phase clears its clock at the
  // reference rate with the full margin. The stricter check this re-tune passed:
  // even the WEAKEST competent rate — p1 focused, 0.793, one power above the p0
  // failure state — drains every phase inside its clock. Per-phase drain (ticks):
  //
  //   boss/phase              hp   clock  @REF  @p1-focused(0.793)
  //   assay Weigh            540    960    480   681   OK
  //   assay Sign "Tare"      680   1210    604   857   OK
  //   escrow Hold           1080   1920    960  1361   OK
  //   escrow Provisional    1220   2170   1084  1538   OK  [easy,normal]
  //   escrow Final          1490   2650   1324  1878   OK  [hard,lunatic]
  //   escrow Settlement     1620   2880   1440  2042   OK
  //   lien Attachment       1220   2170   1084  1538   OK
  //   lien Distraint        1350   2400   1200  1702   OK
  //   lien Foreclosure      1490   2650   1324  1878   OK
  //   lien Penalty          1620   2880   1440  2042   OK  [lunatic]
  //
  // Per-tier fight length stays inside the base <90s envelope: assay 18s, escrow
  // 58s normal / 62s hard-lunatic, lien 60s normal / 84s lunatic. The from→to of
  // the re-tune (family-fit against base bosses `warden` 14s / `regent` 80s):
  // assay 14/16→8/10, escrow 18/20/24/26→16/18/22/24, lien 22/24/26/28→18/20/22/24.
  bosses: {
    // The Manifest MIDBOSS, sent as a WAVE (a pack boss used as a midboss — new
    // coverage). A gate, not a voice: no dialogue, a procedural silhouette if it
    // ever spoke. Two cards, every tier.
    assay: {
      sprite: 'ring',
      radius: 16,
      width: 46,
      height: 46,
      tint: { r: 0.66, g: 0.82, b: 1 },
      entry: { x: 240, y: 150, ticks: 80 },
      onDeath: 'death.big',
      spoils: [['writ', 1]] as [string, number][],
      phases: [
        {
          name: 'Weigh',
          hpSeconds: 8,
          isSpell: false,
          patterns: [
            {
              pattern: 'ring',
              options: { spec: ASSAY_SNAP, count: 12, period: 60, rotation: 7 },
              difficulty: {
                easy: { count: 10, period: 68 },
                hard: { count: 16, period: 52 },
                lunatic: { count: 20, period: 46 },
              },
            },
          ],
        },
        {
          name: 'Sign "Tare"',
          hpSeconds: 10,
          isSpell: true,
          bonus: 120000,
          patterns: [
            {
              pattern: 'aimed-fan',
              options: { spec: ASSAY_NEEDLE, count: 5, spread: 30, period: 50 },
              difficulty: {
                easy: { count: 3, spread: 24 },
                hard: { count: 7, spread: 36, period: 42 },
                lunatic: { count: 9, spread: 42, period: 36 },
              },
            },
          ],
        },
      ],
    },

    // The Manifest END boss. Three cards on EVERY tier via a disjoint slot: an
    // ungated opener and settlement, and two complementary-gated middle cards.
    escrow: {
      sprite: 'halo',
      radius: 18,
      width: 52,
      height: 52,
      tint: { r: 0.6, g: 0.78, b: 1 },
      entry: { x: 240, y: 150, ticks: 90 },
      onDeath: 'death.big',
      spoils: [['indemnity', 1], ['receipt', 2]] as [string, number][],
      // A default exchange, plus a variant keyed to the BUILT-IN character
      // `scout` (new coverage — example keyed its variant to its own pack ship).
      // The `escrow` speaker resolves to this pack's own carried portrait
      // (pack-first); `player` is a built-in face. Both must resolve at injection.
      dialogue: [
        { speaker: 'escrow', text: 'Your account is held pending clearance.' },
        { speaker: 'player', text: 'Then clear it. I have somewhere to be.' },
      ],
      dialogueFor: {
        scout: [
          { speaker: 'escrow', text: 'A scout. You carry nothing that settles a debt.' },
          { speaker: 'player', text: 'I carry the fastest way out of here.' },
          { speaker: 'escrow', text: 'Noted. The account is still held.' },
        ],
      },
      phases: [
        // Opener: a ring held on a circle, then released tangentially.
        {
          name: 'Hold',
          hpSeconds: 16,
          isSpell: false,
          patterns: [
            {
              pattern: 'ring',
              options: { spec: ESCROW_HALO, count: 16, period: 150, rotation: 0, duration: 150 },
              difficulty: {
                easy: { count: 12 },
                hard: { count: 20 },
                lunatic: { count: 24 },
              },
            },
          ],
        },
        // Disjoint slot 2a: the low-tier face — a wide aimed fan.
        {
          name: 'Clearance "Provisional"',
          hpSeconds: 18,
          isSpell: true,
          difficulties: ['easy', 'normal'],
          bonus: 200000,
          patterns: [
            {
              pattern: 'aimed-fan',
              options: { spec: ESCROW_SCALE, count: 5, spread: 40, period: 52 },
              difficulty: {
                easy: { count: 3, spread: 32, period: 60 },
              },
            },
          ],
        },
        // Disjoint slot 2b: the high-tier face — a tight spiral crossed with an
        // aimed fan.
        {
          name: 'Clearance "Final"',
          hpSeconds: 22,
          isSpell: true,
          difficulties: ['hard', 'lunatic'],
          bonus: 260000,
          patterns: [
            {
              pattern: 'spiral',
              options: { spec: ESCROW_SPIRAL, arms: 3, step: 9, period: 5 },
              difficulty: {
                lunatic: { arms: 4, step: 8, period: 4 },
              },
            },
            {
              pattern: 'aimed-fan',
              options: { spec: ESCROW_SCALE, count: 3, spread: 18, period: 84 },
              startAt: 50,
            },
          ],
        },
        // Settlement — the signature close, in a different room (undertow) to a
        // different theme (fiat, a built-in track: an override costs no file).
        {
          name: 'Settlement',
          hpSeconds: 24,
          isSpell: true,
          bonus: 320000,
          background: 'undertow',
          music: 'fiat',
          patterns: [
            {
              pattern: 'spiral',
              options: { spec: ESCROW_SPIRAL, arms: 3, step: 11, period: 6 },
              difficulty: {
                easy: { arms: 2, step: 13 },
                hard: { arms: 4, step: 9 },
                lunatic: { arms: 5, step: 8, period: 5 },
              },
            },
          ],
        },
      ],
    },

    // The Demurrage END boss. Three cards plus a lunatic-only fourth — the
    // classic direction, alongside escrow's disjoint slot. Carries the pack's own
    // track `descent` at the boss level (the one reskin).
    lien: {
      sprite: 'ring',
      radius: 18,
      width: 54,
      height: 54,
      tint: { r: 0.58, g: 0.72, b: 1 },
      entry: { x: 240, y: 150, ticks: 90 },
      onDeath: 'death.big',
      music: 'descent',
      spoils: [['indemnity', 1], ['writ', 1]] as [string, number][],
      dialogue: [
        { speaker: 'lien', text: 'You are late. Lateness is a lien on everything you carry.' },
        { speaker: 'player', text: 'Then I will carry less, and faster.' },
      ],
      phases: [
        // The debt that turns toward you.
        {
          name: 'Attachment',
          hpSeconds: 18,
          isSpell: false,
          patterns: [
            {
              pattern: 'aimed-fan',
              options: { spec: LIEN_HOMING, count: 5, spread: 26, period: 56 },
              difficulty: {
                easy: { count: 3, spread: 20, period: 64 },
                hard: { count: 7, spread: 32, period: 48 },
                lunatic: { count: 9, spread: 38, period: 42 },
              },
            },
          ],
        },
        // Dense, wavering distraint.
        {
          name: 'Sign "Distraint"',
          hpSeconds: 20,
          isSpell: true,
          bonus: 240000,
          patterns: [
            {
              pattern: 'spiral',
              options: { spec: LIEN_WAVER, arms: 3, step: 10, period: 6 },
              difficulty: {
                easy: { arms: 2, step: 12, period: 7 },
                hard: { arms: 4, step: 9 },
                lunatic: { arms: 5, step: 8, period: 5 },
              },
            },
          ],
        },
        // A held ring release, accented by homing motes.
        {
          name: 'Sign "Foreclosure"',
          hpSeconds: 22,
          isSpell: true,
          bonus: 280000,
          patterns: [
            {
              pattern: 'ring',
              options: { spec: LIEN_ORBIT, count: 18, period: 128, rotation: 0, duration: 128 },
              difficulty: {
                easy: { count: 14 },
                hard: { count: 22 },
                lunatic: { count: 26 },
              },
            },
            {
              pattern: 'aimed-fan',
              options: { spec: LIEN_ACCENT, count: 2, spread: 14, period: 90 },
              startAt: 60,
            },
          ],
        },
        // Lunatic-only: the penalty interest — spray crossed with homing.
        {
          name: 'Penalty "Interest"',
          hpSeconds: 24,
          isSpell: true,
          difficulties: ['lunatic'],
          bonus: 360000,
          patterns: [
            { pattern: 'spray', options: { spec: LIEN_SPRAY, count: 4, period: 20, spread: 80 } },
            { pattern: 'aimed-fan', options: { spec: LIEN_ACCENT, count: 3, spread: 20, period: 64 }, startAt: 40 },
          ],
        },
      ],
    },
  },

  // --- stages: two campaigns, two TITLE rows ------------------------------
  stages: {
    // MANIFEST lane, stage 1 — the teaching ramp. Trash only, generous stamp
    // drops, boss-less: it advances at wave exhaustion into manifest-floor (the
    // gauntlet pattern — no top-level boss, a `next` chain).
    intake: {
      entry: true,
      seed: 21,
      background: 'stratum',
      outro: 120,
      next: 'manifest-floor',
      waves: [
        { at: 0, enemy: 'courier', x: 140, y: -20, count: 4, interval: 30, stepX: 40 },
        { at: 60, enemy: 'courier', x: 340, y: -20, count: 4, interval: 30, stepX: -40 },
        { at: 260, enemy: 'inspector', x: 240, y: -30 },
        { at: 360, enemy: 'skimmer', x: 120, y: -20, count: 3, interval: 26, stepX: 90 },
        { at: 560, enemy: 'inspector', x: 160, y: -30 },
        { at: 600, enemy: 'inspector', x: 320, y: -30 },
        { at: 760, enemy: 'courier', x: 240, y: -20, count: 5, interval: 24, stepX: -50 },
      ],
    },
    // MANIFEST lane, stage 2 — reached only via intake's `next`. Turnstiles and
    // weighers and couriers, then a MIDBOSS WAVE (`assay`, a pack boss used as a
    // midboss), then recovery trash. `escrow` re-sends at wave exhaustion as the
    // END boss; its settlement card overrides the scene to `undertow`.
    'manifest-floor': {
      seed: 22,
      background: 'surge',
      outro: 120,
      next: null,
      boss: 'escrow',
      waves: [
        { at: 0, enemy: 'turnstile', x: 160, y: -30 },
        { at: 40, enemy: 'turnstile', x: 320, y: -30 },
        { at: 200, enemy: 'courier', x: 120, y: -20, count: 4, interval: 26, stepX: 80 },
        { at: 380, enemy: 'weigher', x: 240, y: -30 },
        { at: 560, boss: 'assay' },
        { at: 600, enemy: 'courier', x: 200, y: -20, count: 3, interval: 30, stepX: 40 },
        { at: 720, enemy: 'turnstile', x: 240, y: -30 },
        { at: 760, enemy: 'skimmer', x: 300, y: -20, count: 3, interval: 24, stepX: -70 },
      ],
    },
    // DEMURRAGE lane — the penalty queue, one dense stage. Skimmers and couriers
    // arrive together from wave 1; turnstiles stack; drops are stingy (no writ
    // generosity — weighers absent). `lien` re-sends at exhaustion as the END
    // boss, carrying the pack's own `descent` track.
    demurrage: {
      entry: true,
      seed: 23,
      background: 'undertow',
      outro: 120,
      next: null,
      boss: 'lien',
      waves: [
        { at: 0, enemy: 'skimmer', x: 120, y: -20, count: 4, interval: 22, stepX: 80 },
        { at: 0, enemy: 'courier', x: 360, y: -20, count: 4, interval: 30, stepX: -50 },
        { at: 180, enemy: 'turnstile', x: 160, y: -30 },
        { at: 200, enemy: 'turnstile', x: 320, y: -30 },
        { at: 360, enemy: 'skimmer', x: 200, y: -20, count: 5, interval: 20, stepX: 30 },
        { at: 420, enemy: 'courier', x: 240, y: -20, count: 4, interval: 26, stepX: -60 },
        { at: 620, enemy: 'turnstile', x: 240, y: -30 },
        { at: 640, enemy: 'skimmer', x: 100, y: -20, count: 4, interval: 22, stepX: 90 },
      ],
    },
  },
};

/* ------------------------------------------------------------------ */
/* pack.json — round-tripped through the real validator                 */
/* ------------------------------------------------------------------ */

const MANIFEST: PackManifest = {
  format: 1,
  name: 'clearing',
  version: '1.0.0',
  author: 'Danmaku project',
  license: 'CC0-1.0',
  description:
    'A clearing house: two lanes — Manifest teaches, Demurrage charges you for lateness. Content-first on the procedural floor: three bosses, two campaigns, one carried music file and no painted art.',
  // The ONE carried presentation file. `descent` is a BUILT-IN track name, so
  // this WAV REPLACES it (last-wins reskin, resolved pack-first) and plays as
  // `lien`'s boss music. Because the name is a built-in the pack replaces, any run
  // made with this pack installed records the warn-only music identity — the
  // reskin half of the replay split (see README §Replay contract).
  music: {
    descent: {
      file: 'music/descent.wav',
      loopStart: DESCENT_LOOP_START,
      loopEnd: DESCENT_LOOP_END,
      volume: DESCENT_VOLUME,
    },
  },
  // The faces the two SPEAKING bosses need. A dialogue speaker's portrait name
  // must resolve at INJECTION time — the injector refuses a speaker whose portrait
  // is neither built-in nor pack-carried (`src/packs/inject.ts`), and the
  // procedural silhouette is a render-time fallback it does not accept for
  // validation. `assay` never speaks and carries none. Presentation, warn-only:
  // a portrait mismatch on replay WARNS, exactly like the music reskin.
  portraits: {
    escrow: 'portraits/escrow.png',
    lien: 'portraits/lien.png',
  },
  // Five of the nine capabilities — a genuine subset (example declares all nine).
  // NO content.shots/.options/.bombs: `consignee` reuses `scout`'s base rows by
  // name. NO content.effects: only built-in effects (`hit`, `explosion`,
  // `death.big`) are triggered. The covering invariant holds — a capability for
  // every shipped section and a section for every capability.
  requires: [
    'content.enemies',
    'content.stages',
    'content.bosses',
    'content.characters',
    'content.items',
  ],
  content: CONTENT,
};

/* ------------------------------------------------------------------ */
/* README — the annotation JSON cannot carry                            */
/* ------------------------------------------------------------------ */

const README = `# clearing — the content-first guest pack

A clearing house: two lanes through one institution. **Manifest** teaches
(\`intake\` → \`manifest-floor\`, ramping into the midboss \`assay\` and the end boss
\`escrow\`); **Demurrage** charges you for lateness (\`demurrage\`, dense and stingy,
ending on \`lien\`). It is the settlement sibling to the base game's magistrates
and wardens — nouns of procedure, never persons.

This is a working format-1 pack, generated by \`tools/make-clearing-pack.ts\`. That
script is the record of how every file here was made and the one to change — not
these files by hand.

## What this pack is *for*

\`packs/example\` is the reference: it paints its own bullet sheet, ship, HUD,
portrait and sounds, so an author sees art take effect at a glance. **This pack is
the opposite proof — the procedural floor under load.** It paints no bullet sheet,
no ship, no HUD icons, and ships no sound files — every bullet, the ship, the HUD
icons and all six sounds fall through to the engine's procedural placeholders
(\`src/render/procedural.ts\`, \`src/audio/\`) — and the whole two-campaign,
three-boss pack still boots and plays. That the game is *never blocked on assets*
(CLAUDE.md rule 9) is the claim; this pack is the load test for it.

Presentation is kept to the floor with two structurally-required exceptions: the
one music track it carries (\`music/descent.wav\`), and the two boss portraits its
speaking bosses need. A dialogue speaker's portrait NAME must resolve at INJECTION
time — the injector refuses a speaker whose portrait is neither built-in nor
pack-carried, and the procedural silhouette is only a render-time fallback it does
not accept for validation. \`assay\` is a gate and never speaks, so it carries no
face; \`escrow\` and \`lien\` speak, so each carries one. Both portraits are
presentation (warn-only), exactly like the music.

If you want to see the empty-folder floor for yourself before any of this
content: read \`docs/quickstart.md\`, which uses this pack as its worked example and
starts from \`mkdir packs/clearing\`.

## Coverage — what this pack proves that \`example\` does not

| Surface | \`example\` | \`clearing\` |
|---|---|---|
| Presentation | full art + sounds | **one music file + two boss faces; bullets, ship, HUD, sounds all procedural** |
| TITLE rows | one campaign | **two \`entry: true\` stages → two rows** |
| Pack boss as a midboss | end boss only | **\`assay\` sent as a midboss WAVE**, \`escrow\` re-sends as end boss |
| Difficulty gating | one lunatic-only card | **a disjoint slot** — \`provisional-clearance\` (easy/normal) and \`final-clearance\` (hard/lunatic) give every tier exactly 3 cards; \`lien\` also keeps the classic lunatic-only 4th |
| \`dialogueFor\` key | the pack's own ship | **a BUILT-IN character** (\`scout\`) |
| Item kinds | \`score\` only | **all four** — \`power\`/\`score\`/\`life\`/\`bomb\` |
| Character loadout | pack shot/options/bomb | **base rows by name** — \`consignee\` = \`scout\`'s \`spread\`/\`standard\`/\`spread\`, so it declares no \`content.shots\`/\`.options\`/\`.bombs\` and cannot move \`balance.test\`'s derivation |
| Reskin target | a NEW music name | **a BUILT-IN music name** (\`descent\`), replaced in place |

## \`pack.json\`, field by field

JSON has no comments, so this is where the annotation lives.

| Field | Value here | What it is |
|---|---|---|
| \`format\` | \`1\` | The manifest format. |
| \`name\` | \`"clearing"\` | Must equal the directory name, \`[a-z0-9-]{1,32}\`. |
| \`version\` | \`"1.0.0"\` | Free-form, yours to bump. |
| \`author\` | \`"Danmaku project"\` | **Required** — provenance, not decoration (rule 9). |
| \`license\` | \`"CC0-1.0"\` | **Required.** CLAUDE.md rule 9: everything shipped needs declared provenance. A pack with no \`license\` is rejected before anything else is read. |
| \`description\` | a sentence | Optional, shown wherever the boot report lists packs. |
| \`music.descent\` | one \`.wav\` with loop points | The carried track. \`descent\` is a **built-in** track name, so this REPLACES it (see §The reskins). |
| \`portraits.escrow\`, \`portraits.lien\` | two \`.png\`, exactly 96×96 | The faces the two speaking bosses need. A dialogue speaker's portrait must resolve at injection; \`assay\` never speaks and carries none. Presentation, warn-only. |
| \`requires\` | five \`content.*\` capabilities | Exactly the sections shipped — enemies, stages, bosses, characters, items. The **covering invariant**: every \`content.<section>\` present must be declared here and vice versa, which is what lets an older engine refuse on \`requires\` before it parses \`content\`. There is deliberately **no** \`content.shots\`/\`.options\`/\`.bombs\` (the character reuses base rows) and **no** \`content.effects\` (only built-in effects fire). |
| \`content\` | five sections | Format-2 game content. See below. |

There is no \`assets\`, no \`sounds\`, no \`hud\` — every one of those is inherited
procedurally. That absence is the whole point; the two portraits are the one
concession, and only because a speaking boss's face must resolve at injection.

## Content, section by section

**A pack entry IS the engine's own spec, minus the name the key carries** — a pack
enemy is an \`EnemySpec\`, a pack boss a \`BossSpec\`, a pack character a
\`CharacterSpec\`. The one substitution is on a boss phase: it declares **\`hpSeconds\`**
(seconds a competent player needs) where the engine's \`SpellCard\` wants \`hp\`, and
the injector computes \`hp = phaseHp(hpSeconds)\` and defaults the timer to
\`phaseClock(hp)\`. That keeps a pack boss re-derived when \`REFERENCE_DPS\` moves,
the same coupling \`balance.test.ts\` holds the built-ins to.

- **enemies** (5) — \`courier\`, \`inspector\`, \`turnstile\`, \`skimmer\`, \`weigher\`.
  Each fires a built-in pattern (\`aimed-fan\`/\`ring\`/\`spiral\`/\`spray\`) with a
  \`difficulty\` block on every slot (no bare-Normal gap), and its bullets steer with
  built-in behaviours (\`waver\`/\`accelerate-to\`) named by string. Patterns and
  behaviours are engine CODE, joined to this pack only by name.
- **bosses** (3) — \`assay\` (Manifest midboss, 2 cards), \`escrow\` (Manifest end,
  3 cards/tier via the disjoint slot), \`lien\` (Demurrage end, 3 + a lunatic-only
  4th). Phase health is in \`hpSeconds\`. \`escrow\` carries a default exchange and a
  \`dialogueFor\` variant keyed to built-in \`scout\` (drawn on its carried \`escrow\`
  face); \`lien\` names the carried \`descent\` track at the boss level and its own
  \`lien\` face, and \`escrow\`'s settlement card overrides the scene to \`undertow\`
  and the theme to the built-in \`fiat\`.
- **characters** (1) — \`consignee\`. Names \`scout\`'s \`spread\` shot, \`standard\`
  options and \`spread\` bomb (base rows resolved pack-first then built-in) and
  copies \`scout\`'s \`player\` block verbatim, so its DPS is scout's exactly.
- **items** (4) — \`stamp\` (power), \`receipt\` (score), \`writ\` (life), \`indemnity\`
  (bomb). All four kinds; a new \`kind\` would be a new game rule and is refused.
- **stages** (3) — \`intake\` (entry) → \`manifest-floor\`; \`demurrage\` (entry). Two
  \`entry: true\` stages, so START is joined by two campaign rows: \`clearing/intake\`
  and \`clearing/demurrage\`.

Every name inside \`content\` resolves **pack-first, then built-in**: a bare
\`spread\` finds the base shot, a bare \`descent\` finds this pack's own track, and
\`stratum\`/\`surge\`/\`undertow\` are built-in shader scenes named by string. A pack
adds data and joins engine code by name; it never ships code.

## The reskins, and the replay split

\`clearing\`'s presentation is three files: \`music/descent.wav\` — a falling intro
over a darker, seamless loop, a different composition from \`example\`'s \`ashen\` —
and the two boss portraits \`escrow\` and \`lien\`. \`descent\` is a **built-in** track
name, so its file REPLACES the placeholder in place (last-wins reskin, resolved
pack-first) and plays as \`lien\`'s boss music; the portraits are new names the two
speaking bosses draw. All three are presentation — warn-only.

Together they teach both halves of the replay contract from one worked example:

- \`clearing\` ships **content** (enemies, stages, bosses, a character, items, and
  dialogue **text**). Any run that touches pack content — flying \`consignee\`, or
  playing **either** campaign — records \`packsData\`; a content mismatch on replay
  **REFUSES**, exactly like a mismatched base character, stage or difficulty tier.
- \`clearing\` ships **reskins** (the music, the two portraits). Their identity
  records in the warn-only \`packs\` field; a skin mismatch **WARNS** and plays on.
- Because \`descent\` is a built-in name this pack replaces, **any** run made with
  the pack installed — even a pure base run on a base campaign — carries the
  warn-only presentation identity in \`packs\`. That alone never refuses.
- Concretely: a base run recorded *without* the pack, replayed *with* it → **warns**
  (presentation differs), plays on. A \`clearing\` campaign or a \`consignee\` run
  replayed *without* the pack → **refuses** (content differs).

The eight base replay traces stay byte-identical: all this pack's content
registers under \`clearing/…\` qualification, no base-pack fingerprint changes, and
a second \`packs/\` folder is invisible to \`bun test\`.

## Loading and playing

\`bun run dev\`, then open \`?pack=clearing\` — the boot-report overlay lists what
loaded (one music track, two portraits; no bullet sheet, ship, HUD or sounds) and
any warnings. Two rows join START on the title screen: \`clearing/intake\` and
\`clearing/demurrage\`.
\`bun run build\` stages the pack into \`dist/\` via \`tools/copy-packs.ts\`. Nothing
here touches the engine or \`bun test\`.

For the full format, read \`docs/packs.md\`. For adding painted art later — the
presentation path this pack deliberately skips — read \`docs/assets.md\` and
\`docs/audio.md\`.
`;

/* ------------------------------------------------------------------ */
/* Write, verify, report                                                */
/* ------------------------------------------------------------------ */

const descentSamples = buildDescent();
const descentWav = encodeWavMono(descentSamples);

// escrow — a cold institutional blue bust; lien — a darker, colder debtor's face.
const escrowPng = buildPortrait([150, 178, 205], [70, 96, 128], [180, 210, 240], [16, 22, 34], [9, 13, 22], 0.14);
const lienPng = buildPortrait([120, 138, 178], [52, 64, 104], [150, 168, 220], [14, 16, 30], [7, 8, 18], -0.14);

const files: Record<string, Uint8Array | string> = {
  'music/descent.wav': descentWav,
  'portraits/escrow.png': escrowPng,
  'portraits/lien.png': lienPng,
  'pack.json': JSON.stringify(MANIFEST, null, 2) + '\n',
  'README.md': README,
};

const report: string[] = [];

report.push('music/descent.wav — re-parsed from its own bytes:');
report.push(...verifyDescent(descentWav));
report.push('portraits — re-read through parsePng:');
report.push(verifyPortrait('portraits/escrow.png', escrowPng));
report.push(verifyPortrait('portraits/lien.png', lienPng));

// The manifest this script is about to write, checked against the real validator
// it will be loaded by — not a second, hand-maintained idea of what "valid" means.
{
  const result = validateManifest(MANIFEST, 'clearing');
  if ('errors' in result) {
    throw new Error(`pack.json fails its own validator:\n${result.errors.join('\n')}`);
  }
  report.push('pack.json: validates clean against src/packs/manifest.ts');
}

mkdirSync(join(OUT, 'music'), { recursive: true });
mkdirSync(join(OUT, 'portraits'), { recursive: true });
for (const [name, contents] of Object.entries(files)) {
  writeFileSync(join(OUT, name), typeof contents === 'string' ? contents : contents);
}

console.log(`wrote ${Object.keys(files).length} files to ${OUT}\n`);
console.log(report.join('\n'));
