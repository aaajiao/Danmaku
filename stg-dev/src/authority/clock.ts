export const MASTER_TICK_HZ = 120 as const;
export const RUNTIME_TICK_HZ = 60 as const;
export const MAXIMUM_BOUNDARIES_PER_ADVANCE = 1024 as const;
export const CLOCK_BACKLOG_POLICY = "retain-and-drain" as const;

const NANOSECONDS_PER_MILLISECOND = 1_000_000;
const NANOSECONDS_PER_SECOND = 1_000_000_000n;
const MASTER_TICK_HZ_BIGINT = BigInt(MASTER_TICK_HZ);
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_DELTA_MS = Number.MAX_SAFE_INTEGER / NANOSECONDS_PER_MILLISECOND;
// 0.01 budget unit is 1/12,000 ns. It only removes conversion noise at an
// exact boundary; browser wall clocks cannot express a materially smaller gap.
const BUDGET_NORMALIZATION_EPSILON = 0.01;

interface SplitBudget {
  readonly wholeTicks: bigint;
  readonly fractionalTick: number;
}

/**
 * A gameplay timestamp is identified only by the integer 120 Hz tick.
 * `milliseconds` is a derived presentation value and must not be used as an
 * ordering key.
 */
export interface AuthorityTimestamp {
  readonly tick120: number;
  readonly milliseconds: number;
}

export interface TickStampedInput<TInput> {
  readonly tick120: number;
  readonly sequence: number;
  readonly value: TInput;
}

export interface Tick120Boundary<TInput> extends AuthorityTimestamp {
  readonly runtime60Due: boolean;
  readonly inputs: readonly TickStampedInput<TInput>[];
}

export interface Runtime60Boundary extends AuthorityTimestamp {
  readonly tick60: number;
}

export interface AuthorityClockPorts<TInput> {
  /** Receives each master boundary and the input facts stamped for that tick. */
  readonly onTick120?: (boundary: Tick120Boundary<TInput>) => void;
  /** Receives one due signal after every second master boundary. */
  readonly onRuntime60Due?: (boundary: Runtime60Boundary) => void;
}

export interface AuthorityClockSnapshot {
  readonly tick120: number;
  readonly tick60: number;
  readonly milliseconds: number;
  readonly paused: boolean;
  readonly backlogTicks: number;
  readonly fractionalTickBudget: number;
  readonly queuedInputCount: number;
  readonly maximumBoundariesPerAdvance: typeof MAXIMUM_BOUNDARIES_PER_ADVANCE;
  readonly backlogPolicy: typeof CLOCK_BACKLOG_POLICY;
}

export interface ClockAdvanceResult extends AuthorityClockSnapshot {
  readonly fromTick120: number;
  readonly processedBoundaries: number;
  readonly runtime60Boundaries: number;
  readonly consumedInputs: number;
  readonly acceptedWallDeltaMs: number;
  readonly ignoredWallDeltaMs: number;
  readonly boundaryLimitReached: boolean;
}

export function tick120ToMilliseconds(tick120: number): number {
  assertTick(tick120, "tick120");
  return tick120 * 1000 / MASTER_TICK_HZ;
}

function assertTick(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

function assertDeltaMs(deltaMs: number): void {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) {
    throw new Error("render delta must be finite and non-negative");
  }
  if (deltaMs > MAX_DELTA_MS) {
    throw new Error("render delta exceeds the supported nanosecond conversion range");
  }
}

/**
 * Dual-rate authority clock for the V4 runtime contract.
 *
 * Render deltas are quantized to nanoseconds with carried conversion residue,
 * then held as an exact bigint budget. Gameplay identity never depends on an
 * accumulated floating-point millisecond value. A call may traverse at most
 * 1024 master boundaries; any whole-tick remainder is retained and can be
 * drained by a later `advance`, including `advance(0)`.
 */
export class AuthorityClock<TInput = never> {
  private tick120Value = 0;
  private pausedValue = false;
  private renderBudgetNumerator = 0n;
  private nanosecondConversionResidue = 0;
  private inputSequence = 0;
  private queuedInputCountValue = 0;
  private readonly inputQueue = new Map<number, TickStampedInput<TInput>[]>();
  private readonly onTick120: (boundary: Tick120Boundary<TInput>) => void;
  private readonly onRuntime60Due: (boundary: Runtime60Boundary) => void;

  constructor(ports: AuthorityClockPorts<TInput> = {}) {
    this.onTick120 = ports.onTick120 ?? (() => undefined);
    this.onRuntime60Due = ports.onRuntime60Due ?? (() => undefined);
  }

  snapshot(): AuthorityClockSnapshot {
    const budget = this.splitBudget(
      this.renderBudgetNumerator,
      this.nanosecondConversionResidue,
    );
    return {
      tick120: this.tick120Value,
      tick60: Math.floor(this.tick120Value / 2),
      milliseconds: tick120ToMilliseconds(this.tick120Value),
      paused: this.pausedValue,
      backlogTicks: Number(budget.wholeTicks),
      fractionalTickBudget: budget.fractionalTick,
      queuedInputCount: this.queuedInputCountValue,
      maximumBoundariesPerAdvance: MAXIMUM_BOUNDARIES_PER_ADVANCE,
      backlogPolicy: CLOCK_BACKLOG_POLICY,
    };
  }

  setPaused(paused: boolean): AuthorityClockSnapshot {
    this.pausedValue = paused;
    return this.snapshot();
  }

  /**
   * Queues an input fact for a future authority boundary. Facts sharing a tick
   * are delivered in insertion order and removed before the boundary callback,
   * so an edge cannot be consumed twice.
   */
  enqueueInput(value: TInput, tick120 = this.tick120Value + 1): TickStampedInput<TInput> {
    assertTick(tick120, "input tick120");
    if (tick120 <= this.tick120Value) {
      throw new Error("input tick120 must be later than the current authority tick");
    }
    if (!Number.isSafeInteger(this.inputSequence)) {
      throw new Error("input sequence exhausted the safe integer range");
    }

    const input = Object.freeze({
      tick120,
      sequence: this.inputSequence,
      value,
    });
    this.inputSequence += 1;
    const bucket = this.inputQueue.get(tick120);
    if (bucket) bucket.push(input);
    else this.inputQueue.set(tick120, [input]);
    this.queuedInputCountValue += 1;
    return input;
  }

  /**
   * Drops facts that have not crossed an authority boundary yet. This is used
   * when an out-of-band clock-control edge (for example pause) invalidates
   * future input sampled against the old wall-time interval.
   */
  clearQueuedInputs(): number {
    const discarded = this.queuedInputCountValue;
    this.inputQueue.clear();
    this.queuedInputCountValue = 0;
    return discarded;
  }

  /**
   * Adds render wall time and traverses due authority boundaries in order.
   * While paused, the supplied delta is deliberately discarded and existing
   * pre-pause backlog remains frozen for a later drain.
   */
  advance(deltaMs: number): ClockAdvanceResult {
    assertDeltaMs(deltaMs);
    const fromTick120 = this.tick120Value;
    if (this.pausedValue) {
      return this.result(fromTick120, 0, 0, 0, 0, deltaMs);
    }

    this.addRenderDelta(deltaMs);
    let processedBoundaries = 0;
    let runtime60Boundaries = 0;
    let consumedInputs = 0;

    while (
      !this.pausedValue
      && processedBoundaries < MAXIMUM_BOUNDARIES_PER_ADVANCE
      && this.hasDueBoundary()
    ) {
      this.renderBudgetNumerator -= NANOSECONDS_PER_SECOND;
      this.tick120Value += 1;
      processedBoundaries += 1;

      const inputs = this.takeInputs(this.tick120Value);
      consumedInputs += inputs.length;
      const runtime60Due = this.tick120Value % 2 === 0;
      const milliseconds = tick120ToMilliseconds(this.tick120Value);
      this.onTick120(Object.freeze({
        tick120: this.tick120Value,
        milliseconds,
        runtime60Due,
        inputs,
      }));

      if (runtime60Due) {
        runtime60Boundaries += 1;
        this.onRuntime60Due(Object.freeze({
          tick120: this.tick120Value,
          tick60: this.tick120Value / 2,
          milliseconds,
        }));
      }
    }

    return this.result(
      fromTick120,
      processedBoundaries,
      runtime60Boundaries,
      consumedInputs,
      deltaMs,
      0,
    );
  }

  private addRenderDelta(deltaMs: number): void {
    const exactNanoseconds = deltaMs * NANOSECONDS_PER_MILLISECOND
      + this.nanosecondConversionResidue;
    const wholeNanoseconds = Math.round(exactNanoseconds);
    const nextResidue = exactNanoseconds - wholeNanoseconds;
    const nextBudget = this.renderBudgetNumerator
      + BigInt(wholeNanoseconds) * MASTER_TICK_HZ_BIGINT;
    const due = this.splitBudget(nextBudget, nextResidue).wholeTicks;
    const lastDueTick = BigInt(this.tick120Value) + due;
    if (lastDueTick > MAX_SAFE_INTEGER_BIGINT) {
      throw new Error("authority tick would exceed the safe integer range");
    }
    this.nanosecondConversionResidue = nextResidue;
    this.renderBudgetNumerator = nextBudget;
  }

  private hasDueBoundary(): boolean {
    return this.splitBudget(
      this.renderBudgetNumerator,
      this.nanosecondConversionResidue,
    ).wholeTicks > 0n;
  }

  private splitBudget(numerator: bigint, nanosecondResidue: number): SplitBudget {
    let wholeTicks = numerator / NANOSECONDS_PER_SECOND;
    let remainder = Number(numerator % NANOSECONDS_PER_SECOND)
      + nanosecondResidue * MASTER_TICK_HZ;
    const denominator = Number(NANOSECONDS_PER_SECOND);

    if (Math.abs(remainder) < BUDGET_NORMALIZATION_EPSILON) remainder = 0;
    if (remainder < 0) {
      wholeTicks -= 1n;
      remainder += denominator;
    }
    if (denominator - remainder < BUDGET_NORMALIZATION_EPSILON) {
      wholeTicks += 1n;
      remainder = 0;
    }
    if (wholeTicks < 0n) {
      throw new Error("authority render budget became negative");
    }

    return {
      wholeTicks,
      fractionalTick: remainder / denominator,
    };
  }

  private takeInputs(tick120: number): readonly TickStampedInput<TInput>[] {
    const bucket = this.inputQueue.get(tick120);
    if (!bucket) return Object.freeze([]);
    this.inputQueue.delete(tick120);
    this.queuedInputCountValue -= bucket.length;
    return Object.freeze([...bucket]);
  }

  private result(
    fromTick120: number,
    processedBoundaries: number,
    runtime60Boundaries: number,
    consumedInputs: number,
    acceptedWallDeltaMs: number,
    ignoredWallDeltaMs: number,
  ): ClockAdvanceResult {
    const snapshot = this.snapshot();
    return {
      ...snapshot,
      fromTick120,
      processedBoundaries,
      runtime60Boundaries,
      consumedInputs,
      acceptedWallDeltaMs,
      ignoredWallDeltaMs,
      boundaryLimitReached:
        processedBoundaries === MAXIMUM_BOUNDARIES_PER_ADVANCE
        && snapshot.backlogTicks > 0,
    };
  }
}
