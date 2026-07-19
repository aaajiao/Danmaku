import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { Loop, TICK_HZ } from './loop';

const STEP_MS = 1000 / TICK_HZ;

/**
 * The loop is the one place allowed to know about wall time, so testing it
 * means owning the clock. `now` is advanced explicitly and frames are pumped by
 * hand — no real rAF, no real timing, no flake.
 */
let now = 0;
let pending: ((t: number) => void) | undefined;
let saved: Record<string, unknown>;

function pump(toMs: number): void {
  now = toMs;
  const cb = pending;
  pending = undefined;
  cb?.(now);
}

beforeEach(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  saved = {
    requestAnimationFrame: g['requestAnimationFrame'],
    cancelAnimationFrame: g['cancelAnimationFrame'],
    performance: g['performance'],
  };
  now = 0;
  pending = undefined;
  g['requestAnimationFrame'] = (cb: (t: number) => void): number => {
    pending = cb;
    return 1;
  };
  g['cancelAnimationFrame'] = (): void => {
    pending = undefined;
  };
  g['performance'] = { now: () => now };
});

afterEach(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(saved)) g[key] = value;
});

function record(): { loop: Loop; ticks: () => number; alphas: number[] } {
  let ticks = 0;
  const alphas: number[] = [];
  const loop = new Loop({
    tick: () => {
      ticks++;
    },
    render: (a) => {
      alphas.push(a);
    },
  });
  return { loop, ticks: () => ticks, alphas };
}

describe('Loop', () => {
  test('one tick per fixed step, independent of frame rate', () => {
    const { loop, ticks } = record();
    loop.start();

    // 144Hz: many frames, but the tick count tracks elapsed time, not frames.
    // A hair past one second, so the assertion is not sitting on the exact
    // float boundary where 60 * STEP_MS rounds above 1000.
    for (let i = 1; i <= 144; i++) pump((1000.5 / 144) * i);

    expect(ticks()).toBe(60);
    expect(loop.count).toBe(60);
  });

  test('a slower display gets the same tick count for the same elapsed time', () => {
    const { loop, ticks } = record();
    loop.start();

    for (let i = 1; i <= 30; i++) pump((1000.5 / 30) * i);

    expect(ticks()).toBe(60);
  });

  test('never simulates more than MAX_CATCHUP ticks in one frame', () => {
    const { loop, ticks } = record();
    loop.start();

    pump(1000); // a full second of stall arriving at once

    expect(ticks()).toBe(5);
  });

  /**
   * The regression this file was written for. A stall long enough to exhaust
   * the catch-up budget used to leave several steps' worth of time in the
   * accumulator, because the discard threshold was MAX_CATCHUP steps rather
   * than one. That surplus reached `render` as an alpha of up to 5, which
   * extrapolates instead of interpolating.
   */
  test('alpha stays in [0, 1) across every frame pattern, including stalls', () => {
    const { loop, alphas } = record();
    loop.start();

    const gaps = [16.7, 16.7, 150, 8, 33, 1000, 16.7, 99, 4, 250, 16.7];
    let t = 0;
    for (const gap of gaps) {
      t += gap;
      pump(t);
    }

    expect(alphas.length).toBe(gaps.length);
    for (const alpha of alphas) {
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1);
    }
  });

  test('alpha reflects sub-step progress rather than being pinned to zero', () => {
    const { loop, alphas } = record();
    loop.start();

    pump(STEP_MS / 2);

    expect(alphas[0]).toBeCloseTo(0.5, 9);
  });

  test('stop() halts simulation', () => {
    const { loop, ticks } = record();
    loop.start();
    pump(100);
    const before = ticks();

    loop.stop();
    pump(1000);

    expect(ticks()).toBe(before);
  });

  test('start() is idempotent', () => {
    const { loop, ticks } = record();
    loop.start();
    loop.start();

    pump(STEP_MS * 3 + 0.5);

    expect(ticks()).toBe(3);
  });
});
