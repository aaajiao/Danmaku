import { describe, expect, test } from 'bun:test';

import { V4_ENDINGS } from '../content/narrative';
import {
  V4_ENDING_MIXES,
  V4_ENDING_TRANSITION_TICKS,
  v4EndingMix,
} from './presentation';

describe('v4 ending presentation', () => {
  test('owns exactly one choreography target per authored ending page', () => {
    const pages = V4_ENDINGS['stage-4'].pages;
    expect(pages).toHaveLength(3);
    expect(V4_ENDING_MIXES).toHaveLength(pages.length);
    expect(V4_ENDING_TRANSITION_TICKS).toHaveLength(pages.length);

    expect(V4_ENDING_MIXES.map((mix) => mix.art)).toEqual([0.30, 0.16, 0.04]);
    expect(V4_ENDING_MIXES[1]?.trace).toBe(0.32);
    expect(V4_ENDING_MIXES[2]).toEqual({
      enemies: 0,
      player: 0,
      projectiles: 0,
      pickups: 0,
      effects: 0,
      trace: 0,
      art: 0.04,
    });
  });

  test('opens from the unaltered clear frame and settles by fixed ticks', () => {
    expect(v4EndingMix({ index: 0, count: 3, age: 0 })).toEqual({
      enemies: 1,
      player: 1,
      projectiles: 1,
      pickups: 1,
      effects: 1,
      trace: 0,
      art: 0,
    });

    const halfway = v4EndingMix({
      index: 0,
      count: 3,
      age: V4_ENDING_TRANSITION_TICKS[0] / 2,
    });
    // smoothstep(0.5) is exactly 0.5.
    expect(halfway.player).toBeCloseTo((1 + 0.82) / 2);
    expect(halfway.art).toBeCloseTo(0.15);

    expect(v4EndingMix({ index: 0, count: 3, age: 999 })).toEqual(
      V4_ENDING_MIXES[0],
    );
  });

  test('each later page begins at the prior target and ends at its own', () => {
    expect(v4EndingMix({ index: 1, count: 3, age: 0 })).toEqual(
      V4_ENDING_MIXES[0],
    );
    expect(v4EndingMix({ index: 1, count: 3, age: 30 })).toEqual(
      V4_ENDING_MIXES[1],
    );

    expect(v4EndingMix({ index: 2, count: 3, age: 0 })).toEqual(
      V4_ENDING_MIXES[1],
    );
    expect(v4EndingMix({ index: 2, count: 3, age: 30 })).toEqual(
      V4_ENDING_MIXES[2],
    );
  });

  test('clamps malformed presentation clocks instead of producing NaNs', () => {
    expect(v4EndingMix({ index: -20, count: 3, age: -10 })).toEqual(
      v4EndingMix({ index: 0, count: 3, age: 0 }),
    );
    expect(v4EndingMix({ index: 99, count: 3, age: 999 })).toEqual(
      V4_ENDING_MIXES[2],
    );
    expect(v4EndingMix({ index: Number.NaN, count: 3, age: Number.NaN })).toEqual(
      v4EndingMix({ index: 0, count: 3, age: 0 }),
    );
  });
});
