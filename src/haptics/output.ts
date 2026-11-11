/**
 * The haptic device driver: decides WHEN a level may leave for the hardware.
 *
 * `HapticMixer` decides what is felt, on the tick clock. This class is the
 * only haptics code that reads a wall clock, and it reads it for pacing alone:
 * it can delay a write or repeat one, but it never invents a level the mixer
 * did not produce.
 *
 * Why it exists rather than calling `playEffect` every tick:
 *
 *  - A write per tick is an IPC message per tick, and `Loop` may run up to
 *    five catch-up ticks inside one frame. `minIntervalMs` (50 by default) is
 *    an IPC-hygiene / perceptual floor, not a hardware limit: a changed level
 *    waits for it, and the NEWEST level wins when it opens. Nothing queues.
 *  - Every write asks the device to hold for a bounded `holdMs` (600). If our
 *    loop stops while the renderer lives (an exception, a hidden page), the
 *    motor stops by itself shortly after. An unchanged non-zero level is
 *    therefore re-written every `refreshMs` (250) to stay ahead of that hold.
 *  - Levels are quantised to integer percent before comparing, so float noise
 *    in an envelope never costs a write. The quantised level is what is sent.
 *
 * Every device write leaves from `update()` or `silence()`. The sink's
 * `onExpired` callback only raises a flag that the next `update()` reads, so
 * a browser promise settling at an arbitrary moment cannot write on its own.
 * There are no promises in this class.
 *
 * `onExpired` is honoured only for the LATEST write (`#serial`), and every
 * send or stop this class issues advances the serial first. So a preemption
 * this driver caused can never raise the flag; only the hold running out, or
 * an outside stop (see `HapticSink.send`), can.
 */

import type { HapticLevel, HapticSink } from './types';

export interface HapticOutputOptions {
  /** Wall clock in milliseconds, e.g. `() => performance.now()`. */
  readonly now: () => number;
  /** Floor between two writes of a CHANGED level. Default 50. */
  readonly minIntervalMs?: number;
  /** Hold each write asks the device for. Default 600. */
  readonly holdMs?: number;
  /** Re-write period for an unchanged non-zero level. Default 250. */
  readonly refreshMs?: number;
}

/** 0..1 → integer percent 0..100; anything non-finite is 0. */
function percent(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 100;
  return Math.round(value * 100);
}

function option(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export class HapticOutput {
  readonly #now: () => number;
  readonly #minIntervalMs: number;
  readonly #holdMs: number;
  readonly #refreshMs: number;

  /** The sink last tick's `update()` was given. */
  #sink: HapticSink | undefined;
  /** What the device was last told, in integer percent. 0/0 = stopped. */
  #strong = 0;
  #weak = 0;
  /**
   * Time of the last `send`. Kept across sink switches: the floor paces our
   * IPC to the browser as a whole, not one pad.
   */
  #lastWriteAt = Number.NEGATIVE_INFINITY;
  /** Identifies the most recent `send`; an `onExpired` for any other is stale. */
  #serial = 0;
  /** True while inside `sink.send`, so a synchronous `onExpired` is ignored. */
  #sending = false;
  /** The most recent write ran its whole hold: re-write on the next update. */
  #expired = false;

  constructor(options: HapticOutputOptions) {
    this.#now = options.now;
    this.#minIntervalMs = option(options.minIntervalMs, 50);
    this.#holdMs = option(options.holdMs, 600);
    this.#refreshMs = option(options.refreshMs, 250);
  }

  /**
   * Call exactly once per tick with the mixer's level and the sink to drive
   * (`undefined` when nothing should rumble). Neither argument is retained
   * beyond the sink's identity; `level` may be the mixer's reused object.
   */
  update(level: HapticLevel, sink: HapticSink | undefined): void {
    if (sink !== this.#sink) {
      const old = this.#sink;
      // Stop the old sink only if it was left playing. After `silence()` or a
      // zero level it has already been stopped once; a second reset would only
      // mean this method and `silence()` disagree about the device.
      const wasHolding = this.#strong !== 0 || this.#weak !== 0;
      this.#sink = sink;
      this.#forget();
      if (wasHolding) old?.stop();
    }
    if (sink === undefined) return;

    const strong = percent(level.strong);
    const weak = percent(level.weak);

    if (strong === 0 && weak === 0) {
      // A stop is never delayed by the write floor: the cue has ended.
      if (this.#strong !== 0 || this.#weak !== 0) {
        this.#forget();
        sink.stop();
      }
      return;
    }

    const now = this.#now();
    // A clock that went backwards reads as "the last write was just now",
    // never as a write floor that cannot open for the size of the jump.
    if (now < this.#lastWriteAt) this.#lastWriteAt = now;
    const since = now - this.#lastWriteAt;

    const holding = this.#strong !== 0 || this.#weak !== 0;
    const changed = strong !== this.#strong || weak !== this.#weak;
    // An expired hold skips the refresh wait but NOT the write floor. A browser
    // that resolved "complete" at once, ignoring the duration, would otherwise
    // earn a write every frame; the floor caps that at one per `minIntervalMs`
    // and costs a genuinely late refresh at most that much.
    const due = changed || (holding && this.#expired)
      ? since >= this.#minIntervalMs
      : since >= this.#refreshMs;
    if (!due) return;

    this.#strong = strong;
    this.#weak = weak;
    this.#lastWriteAt = now;
    this.#expired = false;
    const serial = ++this.#serial;
    this.#sending = true;
    try {
      sink.send(
        { strong: strong / 100, weak: weak / 100 },
        this.#holdMs,
        () => this.#onExpired(serial),
      );
    } finally {
      this.#sending = false;
    }
  }

  /**
   * Stop the current sink now, synchronously — for pause, `pagehide`,
   * `visibilitychange` and the setting being switched off. The next non-zero
   * `update()` writes again.
   */
  silence(): void {
    this.#forget();
    this.#sink?.stop();
  }

  /** Mark the device as stopped and invalidate any outstanding expiry. */
  #forget(): void {
    this.#strong = 0;
    this.#weak = 0;
    this.#expired = false;
    this.#serial++;
  }

  #onExpired(serial: number): void {
    // Stale (a later write or a stop happened since), or reported from inside
    // `send` itself: a sink that "completes" synchronously would otherwise
    // turn every same-millisecond catch-up tick into a write.
    if (serial !== this.#serial || this.#sending) return;
    this.#expired = true;
  }
}
