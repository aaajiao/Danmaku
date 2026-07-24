/**
 * Presentation-only recording of the route flown through a `Run`.
 *
 * The shell calls `sample` once per fixed tick. No render-frame clock enters
 * here, and the resulting points never feed back into simulation or replay.
 */

export interface EndingTracePoint {
  readonly tick: number;
  readonly x: number;
  readonly y: number;
}

export interface EndingTraceSample extends EndingTracePoint {
  readonly alive: boolean;
  /** Forces the clear position into the trace even between sampling ticks. */
  readonly finished?: boolean;
}

export interface EndingTraceOptions {
  readonly sampleEveryTicks?: number;
  readonly jumpThreshold?: number;
  readonly maxPoints?: number;
}

const DEFAULT_SAMPLE_EVERY_TICKS = 4;
const DEFAULT_JUMP_THRESHOLD = 96;
const DEFAULT_MAX_POINTS = 1024;

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.trunc(value));
}

/**
 * A compact, deterministic trace recorder suitable for a WeakMap keyed by Run.
 *
 * Death and discontinuous movement close the current segment so the renderer
 * never invents a line across a respawn or teleport. Compaction repeatedly
 * halves segment interiors while retaining their endpoints. In the degenerate
 * case where endpoint-only segments alone exceed the cap, whole oldest
 * segments are removed rather than trimming an endpoint off a surviving one.
 */
export class EndingTraceRecorder {
  readonly #sampleEveryTicks: number;
  readonly #jumpThresholdSquared: number;
  readonly #maxPoints: number;
  readonly #segments: EndingTracePoint[][] = [];

  #open = false;
  #lastInputTick = -1;
  #pointCount = 0;

  constructor(options: EndingTraceOptions = {}) {
    this.#sampleEveryTicks = positiveInteger(
      options.sampleEveryTicks,
      DEFAULT_SAMPLE_EVERY_TICKS,
    );
    const jumpThreshold = options.jumpThreshold ?? DEFAULT_JUMP_THRESHOLD;
    const safeJumpThreshold =
      Number.isFinite(jumpThreshold) && jumpThreshold > 0
        ? jumpThreshold
        : DEFAULT_JUMP_THRESHOLD;
    this.#jumpThresholdSquared = safeJumpThreshold * safeJumpThreshold;
    this.#maxPoints = Math.max(2, positiveInteger(options.maxPoints, DEFAULT_MAX_POINTS));
  }

  get segments(): readonly (readonly EndingTracePoint[])[] {
    return this.#segments;
  }

  sample(sample: EndingTraceSample): void {
    if (sample.tick < this.#lastInputTick) return;
    this.#lastInputTick = sample.tick;

    if (
      !sample.alive
      || !Number.isFinite(sample.x)
      || !Number.isFinite(sample.y)
    ) {
      this.#open = false;
      return;
    }

    const current = this.#open
      ? this.#segments[this.#segments.length - 1]
      : undefined;
    const previous = current?.[current.length - 1];

    const jumped = previous !== undefined
      && (
        (sample.x - previous.x) * (sample.x - previous.x)
        + (sample.y - previous.y) * (sample.y - previous.y)
      ) > this.#jumpThresholdSquared;
    const due =
      sample.finished === true
      || !this.#open
      || jumped
      || sample.tick % this.#sampleEveryTicks === 0;
    if (!due) return;

    // Sampling the same fixed tick twice must not grow a zero-length segment.
    // A second, forced call may update the clear position for that tick.
    if (previous?.tick === sample.tick) {
      current![current!.length - 1] = {
        tick: sample.tick,
        x: sample.x,
        y: sample.y,
      };
      return;
    }

    if (!this.#open || jumped) {
      this.#segments.push([]);
      this.#open = true;
    }

    const segment = this.#segments[this.#segments.length - 1]!;
    segment.push({ tick: sample.tick, x: sample.x, y: sample.y });
    this.#pointCount++;
    this.#compact();
  }

  #compact(): void {
    while (this.#pointCount > this.#maxPoints) {
      let removedInterior = false;

      for (let s = 0; s < this.#segments.length; s++) {
        const segment = this.#segments[s]!;
        if (segment.length <= 2) continue;

        const compacted: EndingTracePoint[] = [segment[0]!];
        // Keep alternating interiors. Endpoints are always restored explicitly.
        for (let i = 2; i < segment.length - 1; i += 2) {
          compacted.push(segment[i]!);
        }
        compacted.push(segment[segment.length - 1]!);

        this.#pointCount -= segment.length - compacted.length;
        this.#segments[s] = compacted;
        removedInterior = compacted.length < segment.length;
        if (this.#pointCount <= this.#maxPoints) return;
      }

      if (removedInterior) continue;

      // Every surviving point is now a segment endpoint. Keeping a segment
      // intact is more truthful than joining or shaving it, so expire the
      // oldest complete segment if the configured cap makes that unavoidable.
      if (this.#segments.length <= 1) return;
      const removed = this.#segments.shift();
      this.#pointCount -= removed?.length ?? 0;
    }
  }
}
