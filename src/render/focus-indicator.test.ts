import { describe, expect, test } from 'bun:test';
import {
  FOCUS_RING_ALPHA,
  FOCUS_RING_SIZE,
  focusIndicatorLayout,
} from './focus-indicator';

describe('focus indicator layout', () => {
  test('preserves the real lethal radius under a dark keyline', () => {
    const layout = focusIndicatorLayout(240, 560, 2.5, 0);
    expect(layout.coreRadius).toBe(2.5);
    expect(layout.keylineRadius).toBe(4);
    expect(layout.ringX).toBe(240 - FOCUS_RING_SIZE / 2);
    expect(layout.ringY).toBe(560 - FOCUS_RING_SIZE / 2);
    expect(layout.ringAlpha).toBe(FOCUS_RING_ALPHA);
  });

  test('rotation is fixed-tick, periodic and independent of wall time', () => {
    expect(focusIndicatorLayout(0, 0, 2.5, 0).ringRotation).toBe(0);
    expect(focusIndicatorLayout(0, 0, 2.5, 30).ringRotation).toBeCloseTo(Math.PI / 2);
    expect(focusIndicatorLayout(0, 0, 2.5, 120).ringRotation).toBe(0);
  });
});
