/**
 * The shell's rumble controller: every decision `main.ts` used to make inline.
 *
 * `main.ts` is the one file no test can import, and the rules below are
 * exactly the kind that go missing silently — a wire between two working,
 * tested modules. An earlier version kept them in `main.ts`; a review deleted
 * six of them at once (the pause stop, the pad targeting, the hidden-page
 * stop, …) and the whole suite stayed green. They live here so that
 * `rumble.test.ts` can run them against the real mixer and driver.
 *
 * What this class decides, once per tick, from a plain `RumbleFrame`:
 *
 *  - **Which pad.** During live play only the pad the player's hands are on
 *    (`activePad`). On menus the last pad used is enough, so the RUMBLE row's
 *    test pulse reaches the controller even when the row was confirmed with
 *    the mouse or the keyboard.
 *  - **Pause freezes, it does not drop.** While paused the mixer is not
 *    stepped and the device is told zero; on resume the envelope continues
 *    where the simulation does. A five-second bomb paused at its first second
 *    still has four seconds of rumble under four seconds of bomb. If the run
 *    that was paused is not the run that comes back (QUIT, RETRY), the frozen
 *    cues belonged to a run that no longer exists and are cleared.
 *  - **A hidden page drives nothing.** `silence()` is the immediate stop for
 *    `visibilitychange` / `pagehide`; `hidden` in the frame keeps any tick
 *    that still runs from re-writing the level.
 *  - **A throw at the device boundary only ever switches rumble off.** `Loop`
 *    has no try/catch around `tick()`: an exception escaping from here would
 *    stop the game drawing, for a feature the game does not need.
 *
 * Presentation only. Nothing here reaches the simulation, an RNG or the input
 * mask (CLAUDE.md, rule 4); the pad indices arrive as numbers the shell read
 * off `Input`, and nothing flows back.
 */

import type { RumbleSetting } from '../game/haptic-cues';
import { RUMBLE_GAIN, SHELL_HAPTICS } from '../game/haptic-cues';
import type { HapticLevel, HapticSink } from '../haptics/types';

/** The parts of `HapticMixer` the controller drives. */
export interface RumbleMixer {
  gain: number;
  play(name: string): boolean;
  step(): HapticLevel;
  clear(): void;
}

/** The parts of `HapticOutput` the controller drives. */
export interface RumbleOutput {
  update(level: HapticLevel, sink: HapticSink | undefined): void;
  silence(): void;
}

/** The parts of `GamepadRumble` the controller drives. */
export interface RumblePads {
  readonly seenCapable: boolean;
  observe(): void;
  sink(index: number | undefined): HapticSink | undefined;
  retry(): void;
}

export interface RumbleParts {
  readonly mixer: RumbleMixer;
  readonly output: RumbleOutput;
  readonly pads: RumblePads;
  /** `GamepadRumble.supported()`: false disables everything for the session. */
  readonly supported: boolean;
  /** The stored setting; rumble follows it from the first tick. */
  readonly setting: RumbleSetting;
  readonly warn?: (message: string, error: unknown) => void;
}

/** What the shell knows this tick. Plain values; nothing is retained but `liveRun`'s identity. */
export interface RumbleFrame {
  /**
   * The run the player is flying, when one is on the stack — never a replay
   * and never an export. Compared by identity only.
   */
  readonly liveRun: object | undefined;
  /** A pause menu is the top state. */
  readonly paused: boolean;
  /** `document.hidden`. */
  readonly hidden: boolean;
  /** `Input.activeGamepad`. */
  readonly activePad: number | undefined;
  /** `Input.lastGamepad`. */
  readonly lastPad: number | undefined;
}

const ZERO: HapticLevel = Object.freeze({ strong: 0, weak: 0 });
const TEST_CUE = SHELL_HAPTICS[0];

/**
 * The pad to drive: the active one, or on menus (no live run) the last one
 * used. `undefined` during live play means the player's hands are elsewhere.
 */
export function rumbleTarget(
  activePad: number | undefined,
  lastPad: number | undefined,
  liveRun: boolean,
): number | undefined {
  return activePad ?? (liveRun ? undefined : lastPad);
}

export class Rumble {
  readonly #mixer: RumbleMixer;
  readonly #output: RumbleOutput;
  readonly #pads: RumblePads;
  readonly #warn: (message: string, error: unknown) => void;
  #setting: RumbleSetting;
  #failed: boolean;
  #paused = false;
  #pausedRun: object | undefined;

  constructor(parts: RumbleParts) {
    this.#mixer = parts.mixer;
    this.#output = parts.output;
    this.#pads = parts.pads;
    this.#warn = parts.warn ?? ((message, error) => console.warn(message, error));
    this.#failed = !parts.supported;
    this.#setting = parts.setting;
    if (!this.#failed) this.#guard(() => { this.#mixer.gain = RUMBLE_GAIN[parts.setting]; });
  }

  /** Cues may play: supported, not failed, and not switched off. */
  get enabled(): boolean {
    return !this.#failed && this.#setting !== 'off';
  }

  /**
   * There is something to offer a setting for: a pad with a working actuator
   * has been seen this session. Sticky, and false for good once failed.
   */
  get surface(): boolean {
    return !this.#failed && this.#pads.seenCapable;
  }

  get setting(): RumbleSetting {
    return this.#setting;
  }

  /**
   * The player changed the setting. Switching off drops every cue and stops
   * the motors now; any other level plays the test pulse, the player's proof —
   * in the installed PWA too — that rumble reaches the pad.
   */
  change(setting: RumbleSetting): void {
    this.#setting = setting;
    if (this.#failed) return;
    this.#guard(() => {
      this.#mixer.gain = RUMBLE_GAIN[setting];
      if (setting === 'off') {
        this.#mixer.clear();
        this.#output.silence();
        return;
      }
      // A pad refused while it was away gets another chance.
      this.#pads.retry();
      this.#mixer.play(TEST_CUE);
    });
  }

  /** Start a named cue. A no-op while disabled. */
  play(cue: string): void {
    if (!this.enabled) return;
    this.#guard(() => { this.#mixer.play(cue); });
  }

  /**
   * Stop the motors now, keeping the cues: `visibilitychange` → hidden and
   * `pagehide`. Ticks do not run on a hidden page, so the envelope waits with
   * the simulation and continues with it.
   */
  silence(): void {
    if (this.#failed) return;
    this.#guard(() => { this.#output.silence(); });
  }

  /** Exactly once per tick, after the events of that tick have been played. */
  step(frame: RumbleFrame): void {
    if (this.#failed) return;
    this.#guard(() => {
      // Runs whatever the setting: a newly seen pad is reset once, which is
      // the only recovery for a motor a crashed page left running (Chromium
      // has no browser-side stop).
      this.#pads.observe();

      if (frame.paused && !this.#paused) this.#pausedRun = frame.liveRun;
      if (!frame.paused && this.#paused) {
        if (frame.liveRun !== this.#pausedRun) this.#mixer.clear();
        this.#pausedRun = undefined;
      }
      this.#paused = frame.paused;

      const level = frame.paused ? ZERO : this.#mixer.step();
      const drive = this.#setting !== 'off' && !frame.hidden;
      const target = rumbleTarget(frame.activePad, frame.lastPad, frame.liveRun !== undefined);
      this.#output.update(level, drive ? this.#pads.sink(target) : undefined);
    });
  }

  #guard(body: () => void): void {
    try {
      body();
    } catch (error) {
      this.#fail(error);
    }
  }

  #fail(error: unknown): void {
    if (this.#failed) return;
    this.#failed = true;
    this.#warn('haptics: disabled for this session', error);
    try {
      this.#mixer.clear();
      this.#output.silence();
    } catch {
      // Nothing further can be stopped from here.
    }
  }
}
