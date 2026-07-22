import { describe, expect, test } from 'bun:test';
import { bossDistress, bossFeedbackLayout } from './boss-feedback';

describe('boss feedback layout', () => {
  test('distress begins at the last third and contracts monotonically', () => {
    const hp = [1, 1 / 3, 0.25, 0.125, 0];
    const distress = hp.map(bossDistress);
    expect(distress[0]).toBe(0);
    expect(distress[1]).toBe(0);
    expect(distress[2]).toBeCloseTo(0.25);
    expect(distress[3]).toBe(0.625);
    expect(distress[4]).toBe(1);
    const scales = hp.map((hpFraction) => bossFeedbackLayout({ hpFraction, phaseTicks: 0 }).bodyScale);
    for (let i = 1; i < scales.length; i++) expect(scales[i]).toBeLessThanOrEqual(scales[i - 1]!);
  });

  test('heartbeat is a fixed low-frequency phase-tick sequence', () => {
    const sequence = (offset: number) => Array.from({ length: 96 }, (_, tick) =>
      bossFeedbackLayout({ hpFraction: 0, phaseTicks: tick + offset }).heartScale,
    );
    expect(sequence(0).slice(0, 48)).toEqual(sequence(48).slice(0, 48));
    expect(new Set(sequence(0)).size).toBeLessThanOrEqual(12);
    const primary = bossFeedbackLayout({ hpFraction: 0, phaseTicks: 0 }).heartScale;
    const secondary = bossFeedbackLayout({ hpFraction: 0, phaseTicks: 9 }).heartScale;
    const quiet = bossFeedbackLayout({ hpFraction: 0, phaseTicks: 20 }).heartScale;
    expect(primary).toBeGreaterThan(secondary);
    expect(secondary).toBeGreaterThan(quiet);
  });

  test('material distress advances only from fixed phase ticks', () => {
    const frames = Array.from({ length: 32 }, (_, phaseTicks) =>
      bossFeedbackLayout({ hpFraction: 0, phaseTicks }).materialFrame,
    );
    expect(frames.slice(0, 16)).toEqual(frames.slice(16));
    expect(frames.slice(0, 8)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  test('heavy recoil is view-only and follows the quantized incoming direction', () => {
    const right = bossFeedbackLayout({ hpFraction: 1, phaseTicks: 0, impactKind: 'heavy', impactFraction: 1, direction8: 0 });
    const down = bossFeedbackLayout({ hpFraction: 1, phaseTicks: 0, impactKind: 'heavy', impactFraction: 1, direction8: 2 });
    expect([right.recoilX, right.recoilY]).toEqual([4, 0]);
    expect([down.recoilX, down.recoilY]).toEqual([0, 4]);
  });

  test('direct render callers cannot create a fractional direction lookup', () => {
    const rounded = bossFeedbackLayout({
      hpFraction: 1,
      phaseTicks: 0,
      impactKind: 'heavy',
      impactFraction: 1,
      direction8: 9.6,
    });
    const wrappedNegative = bossFeedbackLayout({
      hpFraction: 1,
      phaseTicks: 0,
      impactKind: 'heavy',
      impactFraction: 1,
      direction8: -1.6,
    });
    const nonFinite = bossFeedbackLayout({
      hpFraction: 1,
      phaseTicks: 0,
      impactKind: 'heavy',
      impactFraction: 1,
      direction8: Number.POSITIVE_INFINITY,
    });
    expect([rounded.recoilX, rounded.recoilY]).toEqual([0, 4]);
    expect([wrappedNegative.recoilX, wrappedNegative.recoilY]).toEqual([0, -4]);
    expect([nonFinite.recoilX, nonFinite.recoilY]).toEqual([4, 0]);
  });
});
