/**
 * The Law of Geometry mechanism, headless.
 *
 * `bun test` has no canvas, so the async atlas composers (`nativeBulletAtlas` …)
 * cannot run here — but the ARITHMETIC they lean on is pure, and that is what
 * carries the size fix. This file proves three things that the composers only
 * assemble:
 *
 *  1. `Strip.displayW/H` is a real, optional atlas field: `defineStrip` stores it
 *     when a seam supplies it and leaves it ABSENT otherwise, and `frameOf`/`uv`
 *     never read it (texel sampling is unchanged).
 *  2. `displaySize` implements the uniform fit — ONE scale,
 *     `min(engineW/contentW, engineH/contentH)`, applied to both frame axes so
 *     the art keeps its own aspect and never exceeds the engine box — and
 *     returns `{}` — the byte-identical native-size default — when the pack's
 *     `contentW/H` is absent.
 *  3. `unionExtent`/`bulletEngineContent` read the engine's authored content box
 *     straight off the procedural records (`CELL_ART`, `PICKUP_STRIPS`, …), so the
 *     single source of truth stays in `procedural.ts`.
 *
 * Routing a draw site through this size (the on-screen effect) is a later stage;
 * here it is only the mechanism, dormant until a pack carries `contentW`.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';

import { Atlas } from './atlas';
import {
  CELL_ART,
  FX_STRIPS,
  MISSILE_STRIPS,
  PICKUP_STRIPS,
  bulletEngineContent,
  displaySize,
  laserBodyDisplayThickness,
  unionExtent,
} from './procedural';

const atlas = () => new Atlas(new THREE.Texture(), 256, 256);

describe('Strip.displayW/H — the field a seam fills', () => {
  test('a strip with no display fields carries none — the zero-pack default', () => {
    const a = atlas();
    a.defineStrip('plain', { x: 0, y: 0, frameW: 20, frameH: 12, frames: 1, ticksPerFrame: 1, mode: 'once' });
    const s = a.strip('plain');
    expect(s.displayW).toBeUndefined();
    expect(s.displayH).toBeUndefined();
    // `frameOf` reads frameW/frameH, never displayW/displayH.
    expect(a.frameOf(s, 0)).toEqual({ x: 0, y: 0, w: 20, h: 12 });
  });

  test('a static `define` (1-frame cell) carries no display size either', () => {
    const a = atlas();
    a.define('cell', { x: 3, y: 4, w: 16, h: 16 });
    expect(a.strip('cell').displayW).toBeUndefined();
    expect(a.strip('cell').displayH).toBeUndefined();
  });

  test('a strip WITH display fields stores and returns them, leaving the UV rect alone', () => {
    const a = atlas();
    a.defineStrip('sized', {
      x: 4,
      y: 6,
      frameW: 24,
      frameH: 24,
      frames: 1,
      ticksPerFrame: 1,
      mode: 'once',
      displayW: 18,
      displayH: 10,
      contentH: 8,
    });
    const s = a.strip('sized');
    expect(s.displayW).toBe(18);
    expect(s.displayH).toBe(10);
    expect(s.contentH).toBe(8);
    // The frame rect (the texel/UV size) is unchanged by the display size.
    expect(a.frameOf(s, 0)).toEqual({ x: 4, y: 6, w: 24, h: 24 });
    expect(a.uv(a.frameOf(s, 0))).toEqual([4 / 256, 6 / 256, 24 / 256, 24 / 256]);
  });
});

describe('native laser-body painted thickness', () => {
  test('cross-axis padding expands the quad so visible paint reaches the skin width', () => {
    // BulletPack warm: 20px of paint in a 26px frame, authored as a 24px beam.
    const quad = laserBodyDisplayThickness(24, 26, 20);
    expect(quad).toBeCloseTo(31.2);
    expect(quad * (20 / 26)).toBeCloseTo(24);
  });

  test('missing or invalid metadata preserves the procedural/legacy thickness', () => {
    expect(laserBodyDisplayThickness(18, 24, undefined)).toBe(18);
    expect(laserBodyDisplayThickness(18, 24, 0)).toBe(18);
  });
});

describe('displaySize — the Law of Geometry arithmetic', () => {
  test('absent contentW/H → {} → native frameW/H (byte-identical default)', () => {
    expect(displaySize({ w: 10, h: 10 }, 20, 20, undefined, undefined)).toEqual({});
    // one axis absent is still the fallback — a display size needs both
    expect(displaySize({ w: 10, h: 10 }, 20, 20, 15, undefined)).toEqual({});
  });

  test('non-positive content → {} (guards against divide-by-zero)', () => {
    expect(displaySize({ w: 10, h: 10 }, 20, 20, 0, 5)).toEqual({});
    expect(displaySize({ w: 10, h: 10 }, 20, 20, 5, -1)).toEqual({});
  });

  test('the design coin example: 24² squared frame, 18×10 content, engine 18×10 → 24² quad', () => {
    const d = displaySize({ w: 18, h: 10 }, 24, 24, 18, 10);
    expect(d).toEqual({ displayW: 24, displayH: 24 });
    // The point of the number: on-screen content = displayW · contentW / frameW.
    expect(d.displayW! * (18 / 24)).toBeCloseTo(18); // lands at engine width
    expect(d.displayH! * (10 / 24)).toBeCloseTo(10); // lands at engine height
  });

  test('a 45px baked bullet lands at the ~10px orb.small engine content', () => {
    const engine = bulletEngineContent('orb.small')!; // radius 5 → 10×10 content
    expect(engine).toEqual({ w: 10, h: 10 });
    const d = displaySize(engine, 48, 48, 45, 45); // pack: 45px content, 48px frame (3px margin/side)
    expect(d.displayW! * (45 / 48)).toBeCloseTo(10); // visible disc scaled to engine size
  });

  test('aspect-mismatched art keeps its shape and never exceeds the engine box (the grunt regression)', () => {
    // The live defect this law replaced: `orb.large` in BulletPack is a thin
    // lens (content 26×5 on a 32×11 frame) reskinning a round 26×26 engine
    // cell. Per-axis mapping stretched the 5px lens to the round cell's height
    // — displayH 57, a ×5 vertical smear on stage-1's own `grunt`. Uniform fit
    // must keep the lens a lens: scale = min(26/26, 26/5) = 1 → native size.
    const d = displaySize({ w: 26, h: 26 }, 32, 11, 26, 5);
    expect(d).toEqual({ displayW: 32, displayH: 11 });
    // One scale, both axes: the quad aspect IS the frame aspect.
    expect(d.displayW! / 32).toBeCloseTo(d.displayH! / 11);
    // And the painted content ends at or under the engine box in BOTH axes.
    expect(d.displayW! * (26 / 32)).toBeLessThanOrEqual(26 + 1e-9);
    expect(d.displayH! * (5 / 11)).toBeLessThanOrEqual(26 + 1e-9);
  });

  test('oversized art in both axes shrinks by the tighter axis, aspect intact', () => {
    // Art content 40×20 over an engine box 10×10: width is the tighter fit
    // (10/40 = 0.25 vs 10/20 = 0.5) — one scale of 0.25 lands the 40 at 10 and
    // the 20 at 5, under the box, never stretched to fill it.
    const d = displaySize({ w: 10, h: 10 }, 44, 24, 40, 20);
    expect(d.displayW).toBeCloseTo(11); // 44 × 0.25
    expect(d.displayH).toBeCloseTo(6); // 24 × 0.25
  });
});

describe('the engine content box is read from the records (single source of truth)', () => {
  test('unionExtent of a pickup coin = its face-on peak, pad-free (frame − 2·FX_PAD)', () => {
    const coin = PICKUP_STRIPS['pickup.coin.silver']!; // pickupGeo(18, 10, …), FX_PAD = 2
    // face-on frame (spin = 1) is the peak: 2·hwMax = 18 − 4 = 14; 2·hh = 10 − 4 = 6
    expect(unionExtent(coin)).toEqual({ w: 14, h: 6 });
  });

  test('unionExtent of a missile body = its constant painted box (frame − 2·FX_PAD)', () => {
    const m = MISSILE_STRIPS['missile.0']!; // bodyGeo(21, 9)
    expect(unionExtent(m)).toEqual({ w: 21 - 4, h: 9 - 4 });
  });

  test('unionExtent of the radial burst is positive and square, never zero', () => {
    const burst = FX_STRIPS['burst']!;
    const u = unionExtent(burst);
    expect(u.w).toBeGreaterThan(0);
    expect(u.w).toBe(u.h); // burst is radial
  });

  test('bulletEngineContent: a floor cell reads its own CELL_ART box', () => {
    expect(bulletEngineContent('orb.medium')).toEqual({
      w: CELL_ART['orb.medium'].w,
      h: CELL_ART['orb.medium'].h,
    });
  });

  test('bulletEngineContent: a family variant reads its base cell box', () => {
    // 'needle.tithe' → base 'needle' (a BULLET_VARIANTS entry)
    expect(bulletEngineContent('needle.tithe')).toEqual({
      w: CELL_ART.needle.w,
      h: CELL_ART.needle.h,
    });
  });

  test('bulletEngineContent: a genuinely pack-new name has no engine sibling', () => {
    expect(bulletEngineContent('totally.novel.pack.skin')).toBeUndefined();
  });
});

describe('a real record feeds displaySize end to end', () => {
  test('a pack coin at 2× native content resolves a quad twice its floor size', () => {
    const coin = PICKUP_STRIPS['pickup.coin.silver']!;
    const engine = unionExtent(coin); // {14, 6}
    // A pack whose painted coin is exactly 2× the engine content, on a frame with
    // 1px of margin per side (contentW 28 on a 30px frame, contentH 12 on 14px).
    const d = displaySize(engine, 30, 14, 28, 12);
    // On-screen content = displayW · contentW / frameW must equal the engine box.
    expect(d.displayW! * (28 / 30)).toBeCloseTo(engine.w);
    expect(d.displayH! * (12 / 14)).toBeCloseTo(engine.h);
  });
});
