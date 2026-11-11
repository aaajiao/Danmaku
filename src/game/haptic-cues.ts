/**
 * Which rumble cue each run event plays, and the player's rumble setting.
 *
 * The tactile sibling of `cues.ts`, and here for the same reason that table is:
 * `main.ts` is the one file no test can import, so a map that lived there would
 * be unreadable to `bun test`, and `reachability.test.ts` could never hold its
 * right-hand column against the haptic registry. This file is strings and
 * numbers only. It imports nothing but a type from `./run` — in particular
 * nothing from `src/haptics/`, which `architecture.test.ts` bans from every
 * headless tree outright. The shell owns the mixer, the device and the clock;
 * the game names a cue and the shell resolves it, exactly as a stage names a
 * scene (`StageSpec.background`).
 *
 * Rumble is presentation. Nothing here reaches `RunConfig`, a replay, the `sim`
 * RNG or the input mask (CLAUDE.md, rule 4: the sim reads one button mask per
 * tick, and an output channel has no business near it).
 *
 * ## A total table, unlike `EVENT_SOUNDS`
 *
 * `EVENT_SOUNDS` is a `Partial` record, which catches a misspelt key but lets a
 * NEW event type arrive silently unmapped. Here every `RunEventType` must have a
 * row — a cue name or an explicit `null` with its reason — so an eighteenth
 * event type fails to compile until someone decides whether it is felt. A
 * silent `null` is a decision; a missing key would only be an accident.
 *
 * ## The cap rule the cue names imply
 *
 * The registry (`src/haptics/index.ts`) owns the envelopes. What this table
 * encodes is which moment gets which family: cues that fire while the player is
 * still dodging (`graze`, `extend`, `boss-phase`, `boss-break`) are authored
 * light on the strong motor — it sits under the stick thumb — while cues
 * covered by invulnerability or a cleared field may use it freely.
 */

import type { RunEventType } from './run';

export const EVENT_HAPTICS: Readonly<Record<RunEventType, string | null>> = Object.freeze({
  // Every player volley. Felt at 10–20 Hz for the whole run it would be a
  // constant buzz that masks every cue that means something.
  shot: null,
  // As dense as `shot`, and it reports the player's success, not a threat.
  'shot-hit': null,
  // Trash dies in clusters; a pulse per kill saturates the motor in a wave.
  'enemy-killed': null,
  // Fires on every damaging tick of a boss fight — the same saturation.
  'boss-hit': null,
  // Pickups arrive in showers on every kill and bomb conversion.
  pickup: null,
  // Reports the fly-in settling. `boss-arriving` already carried the swell
  // across the approach and `boss-phase` declares the card; a third cue here
  // would only cut the swell short.
  'boss-entered': null,
  // Ends every card, so it lands beside `boss-break` (a spell with a
  // successor) or `boss-defeated` (the last card) — each with its own cue — and
  // ahead of the next card's `boss-phase`. A cue of its own would double them.
  'boss-cleared': null,
  // Always lands on the same tick as the final `player-death`, and would be
  // hidden under that cue (or preempt it) rather than felt.
  failed: null,

  graze: 'graze',
  'player-death': 'death',
  bomb: 'bomb',
  extend: 'extend',
  'boss-arriving': 'boss-arrive',
  'boss-phase': 'boss-phase',
  'boss-break': 'boss-break',
  'boss-defeated': 'boss-defeat',
  cleared: 'clear',
});

/**
 * Cues the SHELL plays, never a run event — the haptic counterpart of
 * `SHELL_CUES`. `ui-test` is the pulse played when the player changes the
 * RUMBLE setting to a non-off level, so they feel the level they chose.
 * `reachability.test.ts` exempts these from its playthrough by this list.
 */
export const SHELL_HAPTICS = ['ui-test'] as const;

/**
 * Whether an event's cue plays this tick. Only `graze` is ever held back:
 *
 * - while the player is invulnerable, because a graze during a bomb or respawn
 *   window reports nothing the player has to act on, and it would pile onto the
 *   bomb/death envelope already playing;
 * - in a batch that carries `boss-arriving`, so the arrival swell starts clean —
 *   the same yield `shouldPlayRunEventSound` gives the arrival toll.
 *
 * Every other event plays whenever its row names a cue.
 */
export function shouldPlayRunEventHaptic(
  type: RunEventType,
  when: { readonly bossArrivingInBatch: boolean; readonly playerInvulnerable: boolean },
): boolean {
  if (type !== 'graze') return true;
  return !when.bossArrivingInBatch && !when.playerInvulnerable;
}

/* ------------------------------------------------------------------ */
/* The setting                                                         */
/* ------------------------------------------------------------------ */

/**
 * The player's rumble level. Declared here, not in `src/haptics/`, because
 * `GameContext` carries it and `src/game` may not import that tree — not even
 * a type (see `architecture.test.ts`).
 */
export type RumbleSetting = 'off' | 'low' | 'full';

/** Every setting, in the order the menu row cycles through them. */
export const RUMBLE_SETTINGS: readonly RumbleSetting[] = Object.freeze([
  'off',
  'low',
  'full',
] as const);

/** Master gain the shell applies to the mixer for each setting. */
export const RUMBLE_GAIN: Readonly<Record<RumbleSetting, number>> = Object.freeze({
  off: 0,
  low: 0.5,
  full: 1,
});

/** off → low → full → off. */
export function nextRumbleSetting(current: RumbleSetting): RumbleSetting {
  const index = RUMBLE_SETTINGS.indexOf(current);
  // An index of -1 (a value outside the union, which only an untyped caller can
  // pass) lands on `off`, the first entry — the least surprising recovery.
  return RUMBLE_SETTINGS[(index + 1) % RUMBLE_SETTINGS.length] ?? 'off';
}

/**
 * A stored value read back, or `fallback` when it is not exactly one of the
 * three settings. Storage is outside the program — another tab, an older
 * build, a hand edit — so the value is `unknown` until proved otherwise.
 */
export function parseRumbleSetting(value: unknown, fallback: RumbleSetting): RumbleSetting {
  return typeof value === 'string' && (RUMBLE_SETTINGS as readonly string[]).includes(value)
    ? (value as RumbleSetting)
    : fallback;
}

const RUMBLE_LABELS: Readonly<Record<RumbleSetting, string>> = Object.freeze({
  off: 'RUMBLE  OFF',
  low: 'RUMBLE  LOW',
  full: 'RUMBLE  FULL',
});

/** The menu row's text — two spaces, like `INFINITE LIVES  ON`. */
export function rumbleLabel(setting: RumbleSetting): string {
  return RUMBLE_LABELS[setting];
}
