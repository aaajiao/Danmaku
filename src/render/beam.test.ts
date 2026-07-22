/**
 * Beam layout, proved headlessly.
 *
 * `beamLayout`/`beamPhase` are the one piece of the laser render with real logic
 * — where the quads land, how a tiled body splits, when the cap shows, how the
 * telegraph and decay dim the beam. It is pure arithmetic on primitives (no
 * three.js, no atlas, no canvas) precisely so it can be pinned here under
 * `bun test`, the same headless-proof discipline the sim keeps. The pixels are
 * judged on `test:assets`; the geometry is judged here.
 */

import { describe, expect, test } from 'bun:test';

import type { UVRect } from './atlas';
import type { BeamInput } from './beam';
import { MAX_BEAM_TILES, TELEGRAPH_ALPHA, beamLayout, beamPhase } from './beam';

const BODY_UV: UVRect = [0.1, 0.2, 0.4, 0.5];
const CAP_UV: UVRect = [0.5, 0.6, 0.1, 0.1];

function input(over: Partial<BeamInput> = {}): BeamInput {
  return {
    muzzleX: 0,
    muzzleY: 0,
    angle: 0,
    length: 100,
    fit: 'stretch',
    thickness: 16,
    tileLength: 40,
    bodyUV: BODY_UV,
    cap: { uv: CAP_UV, width: 28, height: 28 },
    // Active by default: past the warmup, no decay window (until-offscreen).
    age: 50,
    warmup: 10,
    life: 0,
    cooldown: 0,
    baseAlpha: 1,
    ...over,
  };
}

describe('beamLayout — stretch', () => {
  test('one quad spanning the whole length, centred on the midpoint', () => {
    const { body } = beamLayout(input({ muzzleX: 100, muzzleY: 200, length: 60, fit: 'stretch' }));
    expect(body).toHaveLength(1);
    const q = body[0]!;
    // Muzzle (100,200), heading +x, so the centre is half the length along +x.
    expect(q.x).toBe(130);
    expect(q.y).toBe(200);
    expect(q.width).toBe(60);
    expect(q.height).toBe(16);
    expect(q.rotation).toBe(0);
    // Stretch uses the whole body frame — no cropping.
    expect(q.uv).toEqual(BODY_UV);
  });

  test('the heading rotates the whole beam about the muzzle', () => {
    const { body, cap } = beamLayout(
      input({ muzzleX: 0, muzzleY: 0, length: 100, angle: Math.PI / 2, fit: 'stretch' }),
    );
    // +y heading: the midpoint is straight down, the tip twice as far.
    expect(body[0]!.x).toBeCloseTo(0, 6);
    expect(body[0]!.y).toBeCloseTo(50, 6);
    expect(cap!.x).toBeCloseTo(0, 6);
    expect(cap!.y).toBeCloseTo(100, 6);
    expect(body[0]!.rotation).toBe(Math.PI / 2);
  });
});

describe('beamLayout — tile', () => {
  test('ceil(length / tileLength) tiles, the last one partial', () => {
    const { body } = beamLayout(input({ length: 100, tileLength: 40, fit: 'tile' }));
    expect(body).toHaveLength(3); // ceil(100/40) = 3
    // Physical lengths: 40, 40, 20.
    expect(body.map((q) => q.width)).toEqual([40, 40, 20]);
    // Centres along +x: 20, 60, 90.
    expect(body.map((q) => q.x)).toEqual([20, 60, 90]);
  });

  test('a full tile shows the whole frame; the partial tile crops from the muzzle edge', () => {
    const { body } = beamLayout(input({ length: 100, tileLength: 40, fit: 'tile' }));
    // Full tiles: the whole body UV.
    expect(body[0]!.uv).toEqual(BODY_UV);
    expect(body[1]!.uv).toEqual(BODY_UV);
    // Partial tile: segLen 20 of a 40 tile = half, so the u-width is halved and
    // kept from the low-u (muzzle) edge — the texture is scaled, never squashed.
    expect(body[2]!.uv).toEqual([BODY_UV[0], BODY_UV[1], BODY_UV[2] * 0.5, BODY_UV[3]]);
  });

  test('an exact multiple tiles into whole cells, no partial', () => {
    const { body } = beamLayout(input({ length: 80, tileLength: 40, fit: 'tile' }));
    expect(body).toHaveLength(2);
    expect(body.map((q) => q.width)).toEqual([40, 40]);
    for (const q of body) expect(q.uv).toEqual(BODY_UV);
  });

  test('the tile count is bounded — a tiny tile length cannot emit thousands of quads', () => {
    const { body } = beamLayout(input({ length: 100_000, tileLength: 1, fit: 'tile' }));
    expect(body).toHaveLength(MAX_BEAM_TILES);
  });

  test('a zero tile length falls back to one full-length tile rather than dividing by zero', () => {
    const { body } = beamLayout(input({ length: 100, tileLength: 0, fit: 'tile' }));
    expect(body).toHaveLength(1);
    expect(body[0]!.width).toBe(100);
  });
});

describe('beamLayout — cap', () => {
  test('the cap sits at the tip, muzzle + length along the heading', () => {
    const { cap } = beamLayout(input({ muzzleX: 10, muzzleY: 20, length: 100, angle: 0 }));
    expect(cap).toBeDefined();
    expect(cap!.x).toBe(110);
    expect(cap!.y).toBe(20);
    expect(cap!.width).toBe(28);
    expect(cap!.height).toBe(28);
  });

  test('no cap frame supplied means no cap quad', () => {
    const { cap } = beamLayout(input({ cap: undefined }));
    expect(cap).toBeUndefined();
  });

  test('a zero-length beam emits nothing', () => {
    const { body, cap } = beamLayout(input({ length: 0 }));
    expect(body).toHaveLength(0);
    expect(cap).toBeUndefined();
  });
});

describe('beamPhase — the honest lifecycle', () => {
  test('telegraph: faint body, no cap (a warning is not yet danger)', () => {
    const p = beamPhase(5, 10, 0, 0, 1);
    expect(p.bodyAlpha).toBeCloseTo(TELEGRAPH_ALPHA, 10);
    expect(p.drawCap).toBe(false);
    expect(p.capAlpha).toBe(0);
  });

  test('active: full body, cap on', () => {
    const p = beamPhase(50, 10, 0, 0, 1);
    expect(p.bodyAlpha).toBe(1);
    expect(p.drawCap).toBe(true);
    expect(p.capAlpha).toBe(1);
  });

  test('decay: the body ramps to nothing over the cooldown window, cap fading with it', () => {
    // life 100, cooldown 20 → the window is [80, 100).
    const at90 = beamPhase(90, 10, 100, 20, 1);
    expect(at90.bodyAlpha).toBeCloseTo(0.5, 10); // (100 − 90) / 20
    expect(at90.drawCap).toBe(true);
    expect(at90.capAlpha).toBeCloseTo(0.5, 10);
    // Start of the window is still nearly full; the end is nearly zero.
    expect(beamPhase(80, 10, 100, 20, 1).bodyAlpha).toBeCloseTo(1, 10);
    expect(beamPhase(99, 10, 100, 20, 1).bodyAlpha).toBeCloseTo(0.05, 10);
  });

  test('decay applies only to a life-limited beam', () => {
    // An until-offscreen beam (life 0) has no fixed end to decay from — active.
    const p = beamPhase(1000, 10, 0, 20, 1);
    expect(p.bodyAlpha).toBe(1);
    expect(p.drawCap).toBe(true);
  });

  test('cooldown 0 is byte-identical to no decay — the existing beams are unchanged', () => {
    // A base beam with a life and no cooldown stays fully lethal to expiry.
    const p = beamPhase(99, 10, 100, 0, 1);
    expect(p.bodyAlpha).toBe(1);
    expect(p.drawCap).toBe(true);
  });

  test('baseAlpha scales every phase', () => {
    expect(beamPhase(5, 10, 0, 0, 0.6).bodyAlpha).toBeCloseTo(0.6 * TELEGRAPH_ALPHA, 10);
    expect(beamPhase(50, 10, 0, 0, 0.6).bodyAlpha).toBeCloseTo(0.6, 10);
  });

  test('the phase drives the layout: a telegraphing beam draws no cap', () => {
    const { cap } = beamLayout(input({ age: 5, warmup: 10 }));
    expect(cap).toBeUndefined();
  });

  test('a decaying beam still draws its body and cap, dimmed', () => {
    const { body, cap } = beamLayout(input({ age: 90, warmup: 10, life: 100, cooldown: 20 }));
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]!.alpha).toBeCloseTo(0.5, 10);
    expect(cap).toBeDefined();
    expect(cap!.alpha).toBeCloseTo(0.5, 10);
  });
});
