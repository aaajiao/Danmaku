/**
 * Haptic sinks over the standard Gamepad API's `vibrationActuator`.
 *
 * This is the one place rumble touches a browser device, and it assumes the
 * browser misbehaves:
 *
 *  - `vibrationActuator` is nullable per pad (lib.dom declares it non-null),
 *    and may lack `playEffect` (Firefox).
 *  - Chromium RESOLVES `playEffect` with "invalid-parameter" or
 *    "not-supported" instead of rejecting, and rejects with an UNDEFINED
 *    reason when the pad has gone. lib.dom lists only "complete" and
 *    "preempted", so results are read as plain strings here.
 *  - `Gamepad` objects must not be retained: every `send`/`stop` re-reads the
 *    pad from `getPads()`, and nothing here stores a pad or an actuator.
 *  - `id` cannot tell two identical pads apart, and object identity is not
 *    stable. Sinks and refusals are keyed on (slot index, GENERATION) instead:
 *    a slot's generation advances each time `observe()` sees it go from empty
 *    to connected, so a pad unplugged and replugged — or replaced by another
 *    — is a new sink with a clean slate, and late results from the old one are
 *    ignored.
 *
 * Every newly seen pad gets one stop (`reset()`) whatever the rumble setting.
 * On Chromium the motor is stopped by a renderer task when an effect ends; a
 * renderer that crashed mid-effect leaves the motor running until something
 * sends it a new effect. This is that something. Chromium may expose a pad's
 * actuator some ticks AFTER the pad itself (capability detection is
 * asynchronous), so the stop is owed until an actuator has actually taken it.
 *
 * Nothing here may throw to the caller and nothing returns a promise: every
 * browser call is wrapped, every promise gets a rejection handler, and a
 * synchronous throw is treated like a rejection.
 *
 * Reading `getGamepads()` here is OUTPUT-only. It happens on the tick
 * (`observe()`, and a sink's `send`/`stop` from `HapticOutput.update`) or in a
 * page-lifecycle stop (`HapticOutput.silence()` from `visibilitychange` /
 * `pagehide`), never from render (CLAUDE.md, rule 4), and it never feeds the
 * input mask: `src/core/input.ts` remains the only reader whose result reaches
 * the simulation.
 */

import type { HapticLevel, HapticSink } from './types';

/** The parts of an actuator this module reads, all optional (see header). */
interface ActuatorLike {
  readonly playEffect?: unknown;
  readonly reset?: unknown;
}

/** The parts of a pad this module reads. A `Gamepad` is assignable to it. */
interface PadLike {
  readonly connected?: boolean;
  readonly vibrationActuator?: ActuatorLike | null;
}

type PlayEffect = (type: 'dual-rumble', params: GamepadEffectParameters) => unknown;
type Reset = () => unknown;

/** Chromium's `duration + startDelay` ceiling, in milliseconds. */
const MAX_EFFECT_MS = 5000;

type Refusal = 'none' | 'gone' | 'invalid';

interface Slot {
  generation: number;
  connected: boolean;
  /** Last `observe()` saw a callable `playEffect`. A boolean, not the pad. */
  capable: boolean;
  refused: Refusal;
  sink: HapticSink | undefined;
  /** This generation's first-sight stop has reached an actuator. */
  resetSent: boolean;
}

function defaultPads(): readonly (Gamepad | null)[] {
  return navigator.getGamepads?.() ?? [];
}

function unit(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value >= 1 ? 1 : value;
}

function playEffectOf(actuator: ActuatorLike | null | undefined): PlayEffect | undefined {
  const fn = actuator?.playEffect;
  return typeof fn === 'function' ? (fn as PlayEffect) : undefined;
}

function resetOf(actuator: ActuatorLike | null | undefined): Reset | undefined {
  const fn = actuator?.reset;
  return typeof fn === 'function' ? (fn as Reset) : undefined;
}

/** Swallow a browser promise's outcome, including a non-promise or a throwing `then`. */
function ignore(result: unknown): void {
  try {
    Promise.resolve(result).catch(() => undefined);
  } catch {
    // Unreachable for a conforming Promise; kept total on purpose.
  }
}

export class GamepadRumble {
  readonly #getPads: () => readonly (Gamepad | null)[];
  readonly #slots = new Map<number, Slot>();
  #warned = false;
  #seenCapable = false;

  constructor(getPads: () => readonly (Gamepad | null)[] = defaultPads) {
    this.#getPads = getPads;
  }

  /** Whether this browser can play a dual-rumble effect at all. */
  static supported(scope: typeof globalThis = globalThis): boolean {
    try {
      const ctor = (scope as { readonly GamepadHapticActuator?: { readonly prototype?: ActuatorLike } })
        .GamepadHapticActuator;
      return typeof ctor?.prototype?.playEffect === 'function';
    } catch {
      return false;
    }
  }

  /**
   * Whether `observe()` has ever seen a connected pad with a callable
   * `playEffect`. Sticky for the session: it answers "is there a rumble
   * surface worth offering a setting for", which `supported()` cannot — every
   * Chromium build has the prototype method, pad or no pad.
   */
  get seenCapable(): boolean {
    return this.#seenCapable;
  }

  /**
   * Once per tick, before `sink()`: track slot generations, and stop the
   * motors of each newly seen pad exactly once.
   */
  observe(): void {
    const pads = this.#pads();
    const length = pads.length;
    for (let index = 0; index < length; index++) {
      const slot = this.#slots.get(index);
      const pad = this.#connected(pads[index]);
      if (!pad) {
        if (slot) slot.connected = false;
        continue;
      }
      const actuator = this.#actuator(pad);
      const capable = playEffectOf(actuator) !== undefined;
      if (capable) this.#seenCapable = true;
      if (slot?.connected) {
        slot.capable = capable;
        // The actuator arrived after the pad did: the stop is still owed.
        if (!slot.resetSent) slot.resetSent = this.#stopActuator(actuator);
        continue;
      }
      // Empty or disconnected → connected: a new generation, a clean slate.
      this.#slots.set(index, {
        generation: (slot?.generation ?? 0) + 1,
        connected: true,
        capable,
        refused: 'none',
        sink: undefined,
        resetSent: this.#stopActuator(actuator),
      });
    }
    // Slots past the end of a shorter array are empty too.
    for (const [index, slot] of this.#slots) {
      if (index >= length) slot.connected = false;
    }
  }

  /**
   * The sink for the pad in slot `index`, or `undefined` when there is none to
   * drive. The same object is returned for one (index, generation) on every
   * call, so `HapticOutput` can tell a pad change by identity.
   */
  sink(index: number | undefined): HapticSink | undefined {
    if (index === undefined) return undefined;
    const slot = this.#slots.get(index);
    if (!slot || !slot.connected || !slot.capable || slot.refused !== 'none') return undefined;
    slot.sink ??= this.#makeSink(index, slot.generation);
    return slot.sink;
  }

  /**
   * Forget "pad gone" refusals — the rumble setting was switched on again.
   * An "invalid-parameter" refusal is our bug and stays.
   */
  retry(): void {
    for (const slot of this.#slots.values()) {
      if (slot.refused === 'gone') slot.refused = 'none';
    }
  }

  #makeSink(index: number, generation: number): HapticSink {
    return {
      send: (level: HapticLevel, holdMs: number, onExpired?: () => void): void => {
        this.#send(index, generation, level, holdMs, onExpired);
      },
      stop: (): void => {
        if (!this.#current(index, generation)) return;
        this.#stopActuator(this.#actuator(this.#pad(index)));
      },
    };
  }

  #send(
    index: number,
    generation: number,
    level: HapticLevel,
    holdMs: number,
    onExpired: (() => void) | undefined,
  ): void {
    const slot = this.#current(index, generation);
    if (!slot || slot.refused !== 'none') return;
    const actuator = this.#actuator(this.#pad(index));
    const play = playEffectOf(actuator);
    if (!play) return;

    const params: GamepadEffectParameters = {
      startDelay: 0,
      duration: Number.isFinite(holdMs) ? Math.min(Math.max(holdMs, 0), MAX_EFFECT_MS) : 0,
      strongMagnitude: unit(level.strong),
      weakMagnitude: unit(level.weak),
    };

    let result: unknown;
    try {
      result = play.call(actuator, 'dual-rumble', params);
    } catch {
      this.#refuse(index, generation, 'gone');
      return;
    }
    try {
      Promise.resolve(result).then(
        (outcome: unknown) => this.#settled(index, generation, outcome, onExpired),
        () => this.#refuse(index, generation, 'gone'),
      ).catch(() => undefined);
    } catch {
      this.#refuse(index, generation, 'gone');
    }
  }

  #settled(
    index: number,
    generation: number,
    outcome: unknown,
    onExpired: (() => void) | undefined,
  ): void {
    if (!this.#current(index, generation)) return;
    switch (outcome) {
      case 'complete':
      case 'preempted':
        // "complete": the hold ran out. "preempted" for a write the driver
        // still considers current: something OTHER than this driver stopped
        // it — another page driving the same pad, or Blink's own deferred
        // reset (a "complete" for an older effect handled after this one was
        // sent re-arms that reset, which then zeroes the motor under us).
        // Every preemption we cause ourselves is already stale by the time it
        // settles: `HapticOutput` advances its serial before each send/stop.
        onExpired?.();
        return;
      case 'invalid-parameter':
        this.#refuse(index, generation, 'invalid');
        return;
      case 'not-supported':
        this.#refuse(index, generation, 'gone');
        return;
      default:
        // A value no browser documents: nothing to do.
        return;
    }
  }

  #refuse(index: number, generation: number, why: 'gone' | 'invalid'): void {
    const slot = this.#current(index, generation);
    if (!slot) return;
    if (why === 'invalid') {
      if (slot.refused !== 'invalid' && !this.#warned) {
        this.#warned = true;
        console.warn(
          `[haptics] pad ${index} refused a dual-rumble effect as "invalid-parameter"; rumble disabled for this pad`,
        );
      }
      slot.refused = 'invalid';
    } else if (slot.refused === 'none') {
      slot.refused = 'gone';
    }
  }

  /** The slot, if (index, generation) is still the pad in it. */
  #current(index: number, generation: number): Slot | undefined {
    const slot = this.#slots.get(index);
    return slot && slot.connected && slot.generation === generation ? slot : undefined;
  }

  /** Returns whether the actuator had a stop to call at all. */
  #stopActuator(actuator: ActuatorLike | null | undefined): boolean {
    try {
      const reset = resetOf(actuator);
      if (reset) {
        ignore(reset.call(actuator));
        return true;
      }
      const play = playEffectOf(actuator);
      if (play) {
        ignore(play.call(actuator, 'dual-rumble', {
          startDelay: 0,
          duration: 0,
          strongMagnitude: 0,
          weakMagnitude: 0,
        }));
        return true;
      }
      return false;
    } catch {
      // A throwing stop is a pad that has gone; there is nothing left to stop.
      return true;
    }
  }

  /**
   * One `getPads()` read. Array-like is enough (older Chromium returned a
   * `GamepadList`); anything else, or a throw, reads as no pads.
   */
  #pads(): readonly (Gamepad | null)[] {
    try {
      const pads = this.#getPads();
      return pads !== null && typeof pads === 'object' && typeof pads.length === 'number'
        ? pads
        : [];
    } catch {
      return [];
    }
  }

  #pad(index: number): PadLike | undefined {
    return this.#connected(this.#pads()[index]);
  }

  #connected(raw: Gamepad | null | undefined): PadLike | undefined {
    try {
      const pad: PadLike | null | undefined = raw;
      return pad?.connected ? pad : undefined;
    } catch {
      return undefined;
    }
  }

  #actuator(pad: PadLike | undefined): ActuatorLike | null | undefined {
    try {
      return pad?.vibrationActuator;
    } catch {
      return undefined;
    }
  }
}
