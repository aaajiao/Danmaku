import { describe, expect, test } from 'bun:test';

import { EndingTraceRecorder } from './trace';

function sample(
  recorder: EndingTraceRecorder,
  tick: number,
  options: {
    readonly x?: number;
    readonly y?: number;
    readonly alive?: boolean;
    readonly finished?: boolean;
  } = {},
): void {
  recorder.sample({
    tick,
    x: options.x ?? tick,
    y: options.y ?? 100,
    alive: options.alive ?? true,
    finished: options.finished ?? false,
  });
}

function ticks(recorder: EndingTraceRecorder): number[][] {
  return recorder.segments.map((segment) => segment.map((point) => point.tick));
}

describe('v4 ending trace recorder', () => {
  test('samples alive positions every four fixed ticks and forces the clear endpoint', () => {
    const recorder = new EndingTraceRecorder();
    for (let tick = 1; tick <= 10; tick++) {
      sample(recorder, tick, { finished: tick === 10 });
    }

    expect(ticks(recorder)).toEqual([[1, 4, 8, 10]]);
    expect(recorder.segments[0]?.at(-1)).toEqual({ tick: 10, x: 10, y: 100 });
  });

  test('breaks the path across death and discontinuous movement', () => {
    const recorder = new EndingTraceRecorder();
    sample(recorder, 1, { x: 20 });
    sample(recorder, 5, { x: 20, alive: false });
    // First alive positions after a death and a discontinuity are retained even
    // when neither lands on the four-tick sampling cadence.
    sample(recorder, 6, { x: 24 });
    sample(recorder, 7, { x: 121 });

    expect(ticks(recorder)).toEqual([[1], [6], [7]]);
  });

  test('does not split an exact-threshold move or duplicate a fixed tick', () => {
    const recorder = new EndingTraceRecorder();
    sample(recorder, 4, { x: 0 });
    sample(recorder, 8, { x: 96 });
    sample(recorder, 8, { x: 95, finished: true });

    expect(recorder.segments).toHaveLength(1);
    expect(recorder.segments[0]).toEqual([
      { tick: 4, x: 0, y: 100 },
      { tick: 8, x: 95, y: 100 },
    ]);
  });

  test('caps deterministically while preserving the surviving path endpoints', () => {
    const recorder = new EndingTraceRecorder({
      sampleEveryTicks: 1,
      maxPoints: 6,
    });
    for (let tick = 1; tick <= 20; tick++) sample(recorder, tick);

    const points = recorder.segments.flat();
    expect(points.length).toBeLessThanOrEqual(6);
    expect(points[0]?.tick).toBe(1);
    expect(points.at(-1)?.tick).toBe(20);

    const repeated = new EndingTraceRecorder({
      sampleEveryTicks: 1,
      maxPoints: 6,
    });
    for (let tick = 1; tick <= 20; tick++) sample(repeated, tick);
    expect(repeated.segments).toEqual(recorder.segments);
  });

  test('retains each surviving segment as a whole when endpoint pressure reaches the cap', () => {
    const recorder = new EndingTraceRecorder({
      sampleEveryTicks: 1,
      maxPoints: 4,
    });
    sample(recorder, 1);
    sample(recorder, 2, { alive: false });
    sample(recorder, 3);
    sample(recorder, 4, { alive: false });
    sample(recorder, 5);
    sample(recorder, 6, { alive: false });
    sample(recorder, 7);
    sample(recorder, 8, { alive: false });
    sample(recorder, 9);

    expect(recorder.segments.flat()).toHaveLength(4);
    expect(ticks(recorder)).toEqual([[3], [5], [7], [9]]);
  });
});
