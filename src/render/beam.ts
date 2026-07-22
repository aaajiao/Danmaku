/**
 * Beam layout: the pure geometry and phase of drawing one laser.
 *
 * A laser is a *line*, not a point. The sim stores its **muzzle** (`Bullet.x/y`)
 * and its live `length`; the tip is `length` px along the heading. Drawing it is
 * a body — a strip stretched or tiled from muzzle to tip — plus a cap flash at
 * the tip while the beam can kill. This module turns those primitives into a
 * flat list of quads the shell hands straight to `SpriteBatch.draw`, and it does
 * so with nothing but arithmetic: no three.js, no atlas, no `document`. That is
 * what lets `render/beam.test.ts` prove the tile split and cap placement under
 * `bun test`, where there is no GL context — the same headless-proof discipline
 * the sim keeps, applied to the one piece of the render that has real logic.
 *
 * ## Why the shell reads the atlas, not this module
 *
 * The frame clock (`stripFrame(strip, b.age)`) and the UV lookup live in the
 * shell so the existing run-relative-age guard (`strip.test.ts`) still sees the
 * `b.age` clock, and so this stays free of the render substrate. The shell
 * resolves the body/cap frame to a `UVRect` and passes it in; this module only
 * decides *where* the quads go and *how bright*.
 *
 * ## Orientation (rule 7)
 *
 * Every quad points **+x** (east) and is rotated by the beam's heading, the one
 * convention an oriented sprite follows. The body's on-beam axis is local +x, so
 * the muzzle edge of a tile is its low-`u` edge — which is why a partial last
 * tile keeps the low-`u` fraction of the texture (see `beamLayout`). The source
 * art is rotated to +x **at import** (rule 7 endorses the once-off rotation over
 * a runtime transpose), and the procedural floor is painted east-native, so this
 * module never applies an axis correction of its own.
 *
 * ## Render-only, so `Math` trig is fine
 *
 * These values reach the framebuffer and stop; they never integrate into a
 * position the sim reads, so `Math.cos`/`Math.sin` here are outside rule 3's
 * remit exactly as GLSL `sin`/`cos` are in a background shader.
 */

import type { UVRect } from './atlas';

/**
 * The most body quads one tiled beam may emit. A 640px beam tiled at 40px is 16
 * quads; the cap is the worst case only if a spec sets an absurdly short tile,
 * and this bounds it. A beam longer than `MAX_BEAM_TILES · tileLength` stops
 * short of its tip rather than emitting thousands of quads — a visible truncation
 * is a better failure than a frame-time cliff, and no reachable content nears it.
 */
export const MAX_BEAM_TILES = 48;

/** Telegraph dim: a warming beam is drawn faint, matching the legacy quad path. */
export const TELEGRAPH_ALPHA = 0.45;

export type BeamFit = 'tile' | 'stretch';

/** One quad the shell draws: centre, size, rotation, UV rect and alpha. */
export interface BeamQuad {
  /** Centre, px (the batch centres the quad and rotates about it). */
  x: number;
  y: number;
  /** Heading, radians. */
  rotation: number;
  width: number;
  height: number;
  uv: UVRect;
  alpha: number;
}

export interface BeamCapInput {
  uv: UVRect;
  width: number;
  height: number;
}

export interface BeamInput {
  /** The stored muzzle — one end of the beam, not its middle. */
  muzzleX: number;
  muzzleY: number;
  /** Heading, radians. */
  angle: number;
  /** Live beam extent, px, from the muzzle along the heading. */
  length: number;
  fit: BeamFit;
  /** Rendered cross-axis px (the VISUAL width; the hitbox is the sim `radius`). */
  thickness: number;
  /** On-beam px per tile when `fit === 'tile'`; the resolved value (>0). */
  tileLength: number;
  /** The full body frame's UV rect (a partial tile crops it). */
  bodyUV: UVRect;
  /** The tip cap, or undefined for a skin with no cap frame this tick. */
  cap?: BeamCapInput;
  /** Sim state, read-only — the phase is derived, never a stored flag. */
  age: number;
  warmup: number;
  /** `0`/omitted means "until offscreen" — then there is no decay window. */
  life: number;
  cooldown: number;
  /** The content's own alpha (`style.a ?? 1`), scaled by the phase. */
  baseAlpha: number;
}

export interface BeamDraw {
  body: BeamQuad[];
  cap?: BeamQuad;
}

/**
 * The lifecycle a beam is in this tick, as three render outputs.
 *
 * Derived from `age`/`warmup`/`life`/`cooldown` — the *same* arithmetic
 * `BulletSystem.#growLaser` uses to set `lethal` — so the picture cannot drift
 * from the hitbox: a beam that looks lethal is lethal, and a beam that looks
 * withdrawn has already stopped killing. `lethal` alone cannot drive this,
 * because it is false in *both* the telegraph and the decay and the two must
 * read differently (a promise vs. a withdrawal).
 */
export interface BeamPhase {
  bodyAlpha: number;
  drawCap: boolean;
  capAlpha: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function beamPhase(
  age: number,
  warmup: number,
  life: number,
  cooldown: number,
  baseAlpha: number,
): BeamPhase {
  // Telegraph: drawn faint, cannot kill (the `lethal` gate). No cap — the tip
  // flash is the mark of a beam that is actually dangerous.
  if (age < warmup) {
    return { bodyAlpha: baseAlpha * TELEGRAPH_ALPHA, drawCap: false, capAlpha: 0 };
  }
  // Decay: the honest retract. The sim has already set `lethal` false; the body
  // ramps to nothing over the cooldown window so the withdrawal is visible, and
  // the cap fades with it. Only a life-limited beam has a fixed end to decay
  // from — the mirror of `#growLaser`'s `cooldown > 0 && life > 0` guard.
  if (cooldown > 0 && life > 0 && age >= life - cooldown) {
    const a = baseAlpha * clamp01((life - age) / cooldown);
    return { bodyAlpha: a, drawCap: true, capAlpha: a };
  }
  // Active: the beam. Full bright, cap on.
  return { bodyAlpha: baseAlpha, drawCap: true, capAlpha: baseAlpha };
}

/**
 * The quads for one beam this tick.
 *
 * `stretch` is one quad spanning the whole length — the whole-beam art (`v3`,
 * `blue`, `cyan`) drawn once and scaled. `tile` repeats a body cell along the
 * beam, so a `t`-suffixed tileable body keeps its texel density at any length:
 * `ceil(length / tileLength)` cells, the last one partial. A partial tile is
 * NOT squashed — its physical length shrinks and it shows the muzzle-side
 * fraction of the texture (the low-`u` edge), so density is constant and the
 * seam falls where the texture wraps. The cap sits at the tip whenever the phase
 * says the beam can kill.
 */
export function beamLayout(input: BeamInput): BeamDraw {
  const { muzzleX, muzzleY, angle, length, fit, thickness, bodyUV } = input;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const phase = beamPhase(input.age, input.warmup, input.life, input.cooldown, input.baseAlpha);

  const body: BeamQuad[] = [];

  if (length > 0) {
    if (fit === 'stretch') {
      const half = length / 2;
      body.push({
        x: muzzleX + half * cos,
        y: muzzleY + half * sin,
        rotation: angle,
        width: length,
        height: thickness,
        uv: bodyUV,
        alpha: phase.bodyAlpha,
      });
    } else {
      const tileLen = input.tileLength > 0 ? input.tileLength : length;
      const n = Math.min(MAX_BEAM_TILES, Math.max(1, Math.ceil(length / tileLen)));
      for (let k = 0; k < n; k++) {
        const start = k * tileLen;
        const segLen = Math.min(tileLen, length - start);
        if (segLen <= 0) break;
        const frac = segLen / tileLen;
        const centre = start + segLen / 2;
        body.push({
          x: muzzleX + centre * cos,
          y: muzzleY + centre * sin,
          rotation: angle,
          width: segLen,
          height: thickness,
          // Keep the muzzle-side (low-`u`) fraction of the frame, so the tile is
          // scaled in world space but the texture is not squashed.
          uv: [bodyUV[0], bodyUV[1], bodyUV[2] * frac, bodyUV[3]],
          alpha: phase.bodyAlpha,
        });
      }
    }
  }

  let cap: BeamQuad | undefined;
  if (phase.drawCap && input.cap !== undefined && length > 0) {
    cap = {
      x: muzzleX + length * cos,
      y: muzzleY + length * sin,
      rotation: angle,
      width: input.cap.width,
      height: input.cap.height,
      uv: input.cap.uv,
      alpha: phase.capAlpha,
    };
  }

  return { body, cap };
}
