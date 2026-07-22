import { describe, expect, test } from 'bun:test';
import { bladeDisplaySize } from './bullet-geometry';

describe('bladeDisplaySize', () => {
  test('covers the complete lethal capsule when content declares no size', () => {
    expect(bladeDisplaySize({}, 13, 2)).toEqual({ width: 30, height: 4 });
    expect(bladeDisplaySize({}, 13, 3)).toEqual({ width: 32, height: 6 });
  });

  test('keeps explicit authored dimensions and leaves point bullets alone', () => {
    expect(bladeDisplaySize({ width: 40, height: 9 }, 13, 2)).toEqual({ width: 40, height: 9 });
    expect(bladeDisplaySize({ width: 8 }, 0, 3)).toEqual({ width: 8, height: undefined });
  });

  test('native paint, not its transparent frame, contains a circular lethal area', () => {
    // v4 needle after the ordinary fit: a 25×5 painted shape in a 32² frame,
    // displayed on a 16² quad. Its paint would be only 12.5×2.5 around a radius-5
    // circle; compensate the unsafe short axis until the visible paint is 10px.
    const size = bladeDisplaySize({}, 0, 5, {
      frameW: 32,
      frameH: 32,
      displayW: 16,
      displayH: 16,
      contentW: 25,
      contentH: 5,
    });
    expect(size).toEqual({ width: 16, height: 64 });
    expect(size.width! * 25 / 32).toBeGreaterThanOrEqual(10);
    expect(size.height! * 5 / 32).toBeGreaterThanOrEqual(10);
  });

  test('native missile paint contains its lethal capsule including both tips', () => {
    // missile.4's runtime frame is fitted so 27×15 paint appears as 19×~10.6.
    // Its radius-2, length-18 capsule is 22px long, so only the long axis grows.
    const size = bladeDisplaySize({}, 9, 2, {
      frameW: 32,
      frameH: 16,
      displayW: 32 * (19 / 27),
      displayH: 16 * (19 / 27),
      contentW: 27,
      contentH: 15,
    });
    expect(size.width! * 27 / 32).toBeCloseTo(22);
    expect(size.height! * 15 / 16).toBeGreaterThanOrEqual(4);
  });
});
