import {describe, expect, it} from "vitest";
import {
  AuthorityClock,
  CLOCK_BACKLOG_POLICY,
  MAXIMUM_BOUNDARIES_PER_ADVANCE,
  elapsedWallDeltaMs,
  runtime60DeadlineTick,
  tick120ToMilliseconds,
  type Tick120Boundary,
} from "./clock";

interface InputEdge {
  readonly action: "shoot" | "override" | "pause";
}

function driveForOneSecond(deltas: readonly number[]): string[] {
  const trace: string[] = [];
  const clock = new AuthorityClock<InputEdge>({
    onTick120: (boundary) => {
      const inputs = boundary.inputs.map((input) => `${input.sequence}:${input.value.action}`).join(",");
      trace.push(`120:${boundary.tick120}:${boundary.runtime60Due ? "due" : "-"}:${inputs}`);
    },
    onRuntime60Due: (boundary) => trace.push(`60:${boundary.tick60}@${boundary.tick120}`),
  });
  clock.enqueueInput({action: "shoot"}, 1);
  clock.enqueueInput({action: "override"}, 59);
  clock.enqueueInput({action: "pause"}, 60);
  clock.enqueueInput({action: "shoot"}, 120);
  for (const delta of deltas) clock.advance(delta);
  expect(clock.snapshot()).toMatchObject({tick120: 120, tick60: 60, backlogTicks: 0});
  return trace;
}

describe("dual-rate authority clock", () => {
  it("rejects negative-zero gameplay time identity", () => {
    expect(() => tick120ToMilliseconds(-0)).toThrow(/non-negative safe integer/);
    expect(() => runtime60DeadlineTick(-0, 240)).toThrow(/non-negative safe integer/);
  });

  it("preserves a long presentation gap for the authority backlog", () => {
    expect(elapsedWallDeltaMs(125, 10_125)).toBe(10_000);
    expect(elapsedWallDeltaMs(10_125, 125)).toBe(0);
    expect(() => elapsedWallDeltaMs(Number.NaN, 125)).toThrow(/finite/);
  });

  it("derives exactly one 60 Hz due boundary from every two master ticks", () => {
    const master: Tick120Boundary<never>[] = [];
    const runtime: number[] = [];
    const clock = new AuthorityClock({
      onTick120: (boundary) => master.push(boundary),
      onRuntime60Due: (boundary) => runtime.push(boundary.tick120),
    });

    const result = clock.advance(100);

    expect(master.map((boundary) => boundary.tick120)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(master.filter((boundary) => boundary.runtime60Due).map((boundary) => boundary.tick120))
      .toEqual([2, 4, 6, 8, 10, 12]);
    expect(runtime).toEqual([2, 4, 6, 8, 10, 12]);
    expect(result).toMatchObject({tick120: 12, tick60: 6, processedBoundaries: 12, runtime60Boundaries: 6});
  });

  it("produces one trace across 30/60/90/120/144 Hz render cadence and 100 ms chunks", () => {
    const cadences = [30, 60, 90, 120, 144].map((hz) => (
      Array.from({length: hz}, () => 1000 / hz)
    ));
    cadences.push(Array.from({length: 10}, () => 100));
    const traces = cadences.map(driveForOneSecond);

    for (const trace of traces.slice(1)) expect(trace).toEqual(traces[0]);
  });

  it("keeps integer time identity drift-free across one hour of 144 Hz render deltas", () => {
    const clock = new AuthorityClock();
    for (let frame = 0; frame < 144 * 60 * 60; frame += 1) {
      clock.advance(1000 / 144);
    }

    expect(clock.snapshot()).toMatchObject({
      tick120: 120 * 60 * 60,
      tick60: 60 * 60 * 60,
      milliseconds: 60 * 60 * 1000,
      backlogTicks: 0,
    });
    // The carried wall-clock conversion residue is projection input, not time
    // identity. It remains far below one nanosecond and never changes tick120.
    expect(clock.snapshot().fractionalTickBudget).toBeLessThan(1e-9);
  });

  it("freezes authority and discards wall time observed while paused", () => {
    const clock = new AuthorityClock();
    clock.advance(100);
    clock.setPaused(true);
    const paused = clock.advance(30_000);

    expect(paused).toMatchObject({
      tick120: 12,
      processedBoundaries: 0,
      acceptedWallDeltaMs: 0,
      ignoredWallDeltaMs: 30_000,
      paused: true,
    });

    clock.setPaused(false);
    clock.advance(1000 / 120);
    expect(clock.snapshot().tick120).toBe(13);
  });

  it("traverses every boundary in a 100 ms large delta", () => {
    const crossed: number[] = [];
    const clock = new AuthorityClock({
      onTick120: (boundary) => crossed.push(boundary.tick120),
    });

    const result = clock.advance(100);

    expect(crossed).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(result).toMatchObject({processedBoundaries: 12, backlogTicks: 0, boundaryLimitReached: false});
  });

  it("retains rather than drops work beyond the 1024-boundary advance cap", () => {
    const crossed: number[] = [];
    const clock = new AuthorityClock({
      onTick120: (boundary) => crossed.push(boundary.tick120),
    });

    const capped = clock.advance(10_000);
    expect(capped).toMatchObject({
      processedBoundaries: MAXIMUM_BOUNDARIES_PER_ADVANCE,
      tick120: 1024,
      backlogTicks: 176,
      boundaryLimitReached: true,
      backlogPolicy: CLOCK_BACKLOG_POLICY,
    });

    const drained = clock.advance(0);
    expect(drained).toMatchObject({
      fromTick120: 1024,
      processedBoundaries: 176,
      tick120: 1200,
      tick60: 600,
      backlogTicks: 0,
      boundaryLimitReached: false,
    });
    expect(crossed).toHaveLength(1200);
    expect(crossed.at(-1)).toBe(1200);
  });

  it("delivers tick-stamped input edges once in insertion order", () => {
    const consumed: Array<{tick120: number; values: string[]}> = [];
    const clock = new AuthorityClock<InputEdge>({
      onTick120: (boundary) => {
        if (boundary.inputs.length > 0) {
          consumed.push({
            tick120: boundary.tick120,
            values: boundary.inputs.map((input) => `${input.sequence}:${input.value.action}`),
          });
        }
      },
    });
    clock.enqueueInput({action: "shoot"}, 3);
    clock.enqueueInput({action: "override"}, 3);
    clock.enqueueInput({action: "pause"}, 4);

    expect(clock.advance(50).consumedInputs).toBe(3);
    clock.advance(0);
    clock.advance(50);

    expect(consumed).toEqual([
      {tick120: 3, values: ["0:shoot", "1:override"]},
      {tick120: 4, values: ["2:pause"]},
    ]);
    expect(clock.snapshot().queuedInputCount).toBe(0);
    expect(() => clock.enqueueInput({action: "shoot"}, 4)).toThrow(/later than/);
  });

  it("can invalidate only uncommitted input when an out-of-band pause edge arrives", () => {
    const consumed: string[] = [];
    const clock = new AuthorityClock<InputEdge>({
      onTick120: (boundary) => {
        consumed.push(...boundary.inputs.map((input) => input.value.action));
      },
    });
    clock.enqueueInput({action: "override"}, 1);
    clock.enqueueInput({action: "shoot"}, 2);

    expect(clock.clearQueuedInputs()).toBe(2);
    expect(clock.clearQueuedInputs()).toBe(0);
    expect(clock.snapshot().queuedInputCount).toBe(0);
    clock.advance(1000 / 60);
    expect(consumed).toEqual([]);
  });
});
