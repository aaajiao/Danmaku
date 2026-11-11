/**
 * HapticMixer: overlapping rumble cues, folded into one level per tick.
 *
 * The mixer is the tick-clocked half of the haptics split described in
 * `./types`. Cue envelopes are authored in fixed ticks, and this class is the
 * only thing that advances them — in `step()` and nowhere else, once per
 * simulation tick. That is the same discipline the background engine keeps for
 * `uTick` (CLAUDE.md, "Backgrounds are scenes"): a cue on a wall clock would
 * drift against the run it describes while every test stayed green. So this
 * module reads no clock, draws from neither RNG stream, and touches no DOM or
 * device. What it produces is a pure function of the sequence of `play`,
 * `step` and `clear` calls, and of `gain`; pacing that level onto hardware is
 * `HapticOutput`'s job.
 *
 * Mixing is per-channel MAX, not a sum. Two cues landing together should feel
 * like the stronger of the two, not like a third, louder cue — and a sum would
 * clip at 1 the moment two big cues overlapped, flattening both envelopes.
 *
 * Voices live in a fixed set of preallocated slots. When every slot is busy
 * the OLDEST voice (earliest accepted `play`) is stolen: the newest event is
 * the one the player has just caused.
 *
 * Throttle is measured on the mixer's own tick counter, which only `step()`
 * advances. Two starts of the same cue closer together than its
 * `throttleTicks` are reduced to the first. `clear()` keeps both the counter
 * and every throttle clock: clearing on pause must not let a cue re-fire the
 * instant play resumes.
 */

import { getHaptic, type HapticLevel, type ResolvedHaptic } from './index';

const DEFAULT_VOICES = 8;

interface Voice {
  /** `null` when the slot is free. */
  cue: ResolvedHaptic | null;
  /** Index into `cue.segments` of the segment currently playing. */
  segment: number;
  /** Ticks still to play in that segment. Always >= 1 while the voice is live. */
  left: number;
  /** Accept order of the `play` that started it; lowest is oldest. */
  serial: number;
}

interface MutableLevel {
  strong: number;
  weak: number;
}

export class HapticMixer {
  readonly #voices: Voice[];
  /** Mixer ticks elapsed. Advanced by `step()` only. */
  #tick = 0;
  #serial = 0;
  /** Cue name → the mixer tick its last accepted start happened on. */
  readonly #lastStart = new Map<string, number>();
  #gain = 1;
  /** Reused for every `step()` result. */
  readonly #level: MutableLevel = { strong: 0, weak: 0 };

  constructor(options?: { voices?: number }) {
    const requested = options?.voices;
    const count =
      requested !== undefined && Number.isFinite(requested)
        ? Math.max(1, Math.floor(requested))
        : DEFAULT_VOICES;
    this.#voices = [];
    for (let i = 0; i < count; i++) {
      this.#voices.push({ cue: null, segment: 0, left: 0, serial: 0 });
    }
  }

  /** Master gain 0..1, applied in `step()`. NaN reads as 0 (silence). */
  get gain(): number {
    return this.#gain;
  }

  set gain(value: number) {
    this.#gain = Number.isNaN(value) || value <= 0 ? 0 : value > 1 ? 1 : value;
  }

  /**
   * Start cue `name`. It contributes from the NEXT `step()` — its first
   * segment's first tick — for exactly its total `ticks` steps.
   *
   * Returns false, and changes nothing, when the name is unknown, the cue is
   * zero-length, or a start of the same cue was accepted fewer than
   * `throttleTicks` mixer ticks ago.
   */
  play(name: string): boolean {
    const cue = getHaptic(name);
    if (cue === undefined || cue.ticks < 1) return false;
    const first = cue.segments[0];
    if (first === undefined) return false;

    const last = this.#lastStart.get(name);
    if (last !== undefined && this.#tick - last < cue.throttleTicks) return false;
    this.#lastStart.set(name, this.#tick);

    const slot = this.#freeOrOldest();
    slot.cue = cue;
    slot.segment = 0;
    slot.left = first.ticks;
    slot.serial = this.#serial++;
    return true;
  }

  /**
   * Advance one tick and return the mixed level: per-channel MAX over every
   * live voice, times `gain`.
   *
   * Allocates nothing. The returned object is the SAME one on every call and
   * is overwritten by the next `step()`: read it, never retain it.
   */
  step(): HapticLevel {
    this.#tick++;
    let strong = 0;
    let weak = 0;
    for (const voice of this.#voices) {
      const cue = voice.cue;
      if (cue === null) continue;
      const seg = cue.segments[voice.segment];
      if (seg === undefined) {
        // Unreachable while play() and this loop keep `left >= 1`; free the
        // slot rather than trust that invariant with a motor.
        voice.cue = null;
        continue;
      }
      if (seg.strong > strong) strong = seg.strong;
      if (seg.weak > weak) weak = seg.weak;
      if (--voice.left > 0) continue;
      const nextIndex = voice.segment + 1;
      const next = cue.segments[nextIndex];
      if (next === undefined) {
        voice.cue = null;
      } else {
        voice.segment = nextIndex;
        voice.left = next.ticks;
      }
    }
    this.#level.strong = strong * this.#gain;
    this.#level.weak = weak * this.#gain;
    return this.#level;
  }

  /** Drop every voice. The tick counter and the throttle clocks are kept. */
  clear(): void {
    for (const voice of this.#voices) voice.cue = null;
  }

  /** Whether any voice is still playing. */
  get active(): boolean {
    for (const voice of this.#voices) if (voice.cue !== null) return true;
    return false;
  }

  #freeOrOldest(): Voice {
    let oldest: Voice | undefined;
    for (const voice of this.#voices) {
      if (voice.cue === null) return voice;
      if (oldest === undefined || voice.serial < oldest.serial) oldest = voice;
    }
    // The constructor guarantees at least one slot.
    return oldest as Voice;
  }
}
