import { describe, expect, test } from 'bun:test';
import { measureStripFrames, stripSourceEnd, type MeasuredStrip } from './loader';

/**
 * The conditional saturation gate (loader.ts, `measureStripFrames`) is the exact
 * generalization of the bullet white+tint law to a strip: a `tinted` strip is
 * measured for mean saturation, a `baked` one declares its colour and skips the
 * gate. That branch is reachable in the browser only through a decoded canvas —
 * but the measurement itself is a pure function over a `Uint8ClampedArray`, so
 * the branch is exercised here with a synthetic coloured frame, no framebuffer.
 * Binding design §3/§9: "a baked-tagged sheet passes, the same sheet tagged
 * tinted fails — so the branch is not untested vocabulary."
 */

const FRAME = 8; // frameW === frameH; seam limit is frameW − 2·FX_PAD = 4

/**
 * One 8×8 frame whose only painted pixels are a fully-opaque, fully-saturated
 * (pure red) 2×2 block at (3,3). The 2px extent clears the seam limit, so the
 * seam gate never fires and the saturation gate is measured in isolation.
 */
function coloredFrame(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(FRAME * FRAME * 4); // transparent black
  for (let y = 3; y < 5; y++) {
    for (let x = 3; x < 5; x++) {
      const i = (y * FRAME + x) * 4;
      data[i] = 255; // R — saturation (max−min)/max = 1.0, far over 0.15
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 255; // opaque: counts toward both extent and saturation
    }
  }
  return data;
}

function strip(color: 'tinted' | 'baked'): MeasuredStrip {
  return { frameW: FRAME, frameH: FRAME, frames: 1, stride: FRAME, color };
}

describe('measureStripFrames saturation gate', () => {
  const data = coloredFrame();

  test('a baked strip skips the saturation gate — coloured pixels pass', () => {
    const reasons: string[] = [];
    measureStripFrames('p', 'sheet.png', 's', strip('baked'), data, FRAME, 0, 0, reasons);
    expect(reasons).toEqual([]);
  });

  test('the same pixels tagged tinted fail the saturation gate', () => {
    const reasons: string[] = [];
    measureStripFrames('p', 'sheet.png', 's', strip('tinted'), data, FRAME, 0, 0, reasons);
    expect(reasons.length).toBe(1);
    expect(reasons[0]).toContain('has mean saturation');
    expect(reasons[0]).toContain('over 0.15');
  });
});

describe('strip source geometry', () => {
  test('the exclusive x boundary is the last frame origin plus frameW', () => {
    expect(
      stripSourceEnd(
        { frameW: 8, frameH: 6, frames: 3, stride: 20 },
        11,
        7,
      ),
    ).toEqual({ x: 59, y: 13 }); // 11 + (3 - 1)·20 + 8, not 11 + 3·20
  });

  test('padding is checked independently against rectangular frame width and height', () => {
    const frameW = 12;
    const frameH = 8;
    const data = new Uint8ClampedArray(frameW * frameH * 4);
    // 2×6 paint: clears the horizontal 8px limit, violates the vertical 4px
    // limit. The old max(extent) <= horizontal-limit check silently accepted it.
    for (let y = 1; y < 7; y++) {
      for (let x = 5; x < 7; x++) {
        const i = (y * frameW + x) * 4;
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = 255;
      }
    }

    const reasons: string[] = [];
    measureStripFrames(
      'p',
      'shared.png',
      'rect',
      { frameW, frameH, frames: 1, stride: frameW, color: 'tinted' },
      data,
      frameW,
      0,
      0,
      reasons,
    );

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('paints 2×6px');
    expect(reasons[0]).toContain('over the 8×4px limit');
  });
});
