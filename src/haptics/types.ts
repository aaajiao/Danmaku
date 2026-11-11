/**
 * Haptics contract: the shapes every rumble module agrees on.
 *
 * Rumble is a presentation-only OUTPUT channel, the tactile sibling of
 * `src/audio/`. The shell maps drained `Run` events to named cues; nothing here
 * is read by the simulation, drawn from the `sim` RNG, or fed back into the
 * input mask. A replay neither records nor reproduces it.
 *
 * Two clocks, deliberately separate:
 *
 *  - Cue envelopes are authored in fixed TICKS and advanced only by
 *    `HapticMixer.step()`, once per simulation tick — the same "step() and
 *    nowhere else" discipline the background engine keeps for `uTick`.
 *  - Only the device driver (`HapticOutput`) reads a wall clock, and only to
 *    pace writes to hardware. It cannot change WHAT is felt, only when a write
 *    is allowed to leave.
 */

/**
 * One instant of rumble for a dual-motor pad, both channels 0..1.
 *
 * `strong` is the low-frequency motor in the LEFT grip — under the thumb that
 * is on the stick. `weak` is the high-frequency motor in the right grip. That
 * asymmetry is a design input, not trivia: a cue that fires while the player
 * is still dodging should carry its energy on `weak`.
 */
export interface HapticLevel {
  readonly strong: number;
  readonly weak: number;
}

/** Hold one level for `ticks` fixed ticks. A zero level is an authored gap. */
export interface HapticSegment extends HapticLevel {
  readonly ticks: number;
}

/** A named rumble cue: segments played in order, then silence. */
export interface HapticSpec {
  readonly segments: readonly HapticSegment[];
  /**
   * Starts of this cue closer together than this many ticks are dropped —
   * the tactile `throttleMs`. Default 0.
   */
  readonly throttleTicks?: number;
}

/**
 * One physical actuator pair, as the driver sees it.
 *
 * Both calls are synchronous hand-offs that never throw and never return a
 * promise the caller must wait on: a browser promise that fails to settle must
 * not be able to block output, and a stop issued from `pagehide` has to reach
 * the device before the frame is torn down.
 */
export interface HapticSink {
  /**
   * Hold `level` for at most `holdMs`, unless replaced sooner.
   *
   * `onExpired` is called if this effect ran its whole hold, or was stopped
   * by something other than this driver (another page on the same pad, the
   * browser's own deferred reset), without being replaced or stopped by the
   * driver itself — the signal that the device has gone quiet underneath a
   * level the driver still believes is playing.
   */
  send(level: HapticLevel, holdMs: number, onExpired?: () => void): void;
  /** Stop both motors now. */
  stop(): void;
}
