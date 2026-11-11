/**
 * When a controller alone may start the game's audio.
 *
 * Browsers start WebAudio only after user activation, and the shell's unlock
 * listeners hear pointer, touch and key events. A gamepad dispatches none of
 * those. Chromium nevertheless counts a pad button as activation — it is
 * granted inside `navigator.getGamepads()`, which `Input.sample()` calls every
 * tick — and Firefox grants it on the press. Nothing announces it, so a player
 * who launches the installed app and only ever touches the controller used to
 * play in silence until they happened to click.
 *
 * This is the decision of when to try, kept out of `main.ts` so a test can
 * reach it. Three facts, read after the input poll of the same tick:
 *
 *  - `ready`: sound and music are already running. Nothing to do.
 *  - `padActive`: the pad is the device in the player's hands
 *    (`Input.activeGamepad`). A mouse, key or touch session never takes this
 *    path at all — its own DOM gesture already unlocked audio, and a second
 *    attempt from outside that gesture is exactly what WebKit punishes.
 *  - `activation`: `navigator.userActivation.isActive`. The browser's own
 *    word that an attempt now is legitimate. Without it a `resume()` is
 *    refused, and Chrome logs a warning for every refusal — so a stick push,
 *    which grants nothing, must not try.
 *
 * An attempt that does not take is retried, but no faster than every
 * `PAD_AUDIO_RETRY_TICKS`: unlocking decodes buffers and can still be in
 * flight on the next tick, and a held button would otherwise ask sixty times
 * a second.
 *
 * Presentation only. It reads nothing the simulation computes and feeds
 * nothing back; the input mask is untouched (CLAUDE.md, rule 4).
 */

/** Minimum ticks between two attempts: two seconds at the fixed 60 Hz tick. */
export const PAD_AUDIO_RETRY_TICKS = 120;

export interface PadAudioFacts {
  readonly ready: boolean;
  readonly padActive: boolean;
  readonly activation: boolean;
}

export class PadAudioUnlock {
  #cooldown = 0;

  /** Once per tick. True when the shell should try to start audio now. */
  step(facts: PadAudioFacts): boolean {
    if (this.#cooldown > 0) this.#cooldown--;
    if (facts.ready) {
      // Audio can be lost again (a closed context); the next loss may retry at once.
      this.#cooldown = 0;
      return false;
    }
    if (!facts.padActive || !facts.activation || this.#cooldown > 0) return false;
    this.#cooldown = PAD_AUDIO_RETRY_TICKS;
    return true;
  }
}
