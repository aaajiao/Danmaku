/**
 * Which sound each run event plays.
 *
 * Sound is a **reaction** to events the run drains, never something the run
 * triggers. `Run` raises `boss-defeated`; it does not know an explosion exists,
 * and nothing in `src/sim` or `src/game` may make a noise. This table is the
 * whole of the coupling, and it is data.
 *
 * ## Why it is here and not in `main.ts`
 *
 * It lived in the shell, which is the one file no test can import — `main.ts`
 * reads `document.getElementById` at module scope and is referenced only by
 * `index.html`. So the map from a registered sound to the moment it plays was
 * unreadable to `bun test` by construction, and `reachability.test.ts` had to
 * settle for asserting the *event types* instead, with a comment conceding the
 * substitution. That proves the left column of this table. Nothing proved the
 * right one: register a seventh sound and it would be silent forever with a
 * green suite, which is precisely the state four of the six were already in.
 *
 * Moving the table into `src/game` costs nothing — it is a plain object of
 * strings, it imports no audio engine, and the shell still owns playback — and
 * it lets both columns be asserted against the real registries.
 *
 * ## The typing is the fix, not decoration
 *
 * `Partial<Record<RunEventType, string>>` rather than `Record<string, string>`.
 * The old type accepted any key, so `'item-collected'` — a `RunEventType` that
 * has never existed, since the run emits `'pickup'` — sat here for the life of
 * the project and every pickup in every run was mute. Under this annotation the
 * same typo is a compile error (verified: TS2353).
 *
 * The **values** cannot be typed the same way and deliberately are not.
 * `defineSound` is an open registry — a sound is added by writing a file — so a
 * static union of sound names would close it, and the project's own extension
 * rule says registries are open and checked at the point of use. The check is
 * therefore a runtime assertion in `reachability.test.ts`, which holds every
 * value here against `soundNames()` and every registered sound against this
 * table. An unplayable name and an unplayed sound both fail the build.
 *
 * ## One sound serves several events, on purpose
 *
 * Five events play `explosion` and four play `pickup`. That is a mix decision
 * rather than an omission: a bomb and a boss dying are the same *kind* of
 * event to an ear, and a distinct cue per event would be sixteen samples where
 * six carry the game. When real audio arrives and one of these wants its own
 * voice, the change is two lines — register the sound, repoint the row — and
 * `docs/audio.md` documents both. Nothing else needs to learn about it.
 */

import type { RunEventType } from './run';

export const EVENT_SOUNDS: Partial<Record<RunEventType, string>> = {
  shot: 'shot',
  'shot-hit': 'hit',
  'enemy-killed': 'explosion',
  'boss-hit': 'hit',
  'boss-break': 'break',
  // The boss ladder, distinct cues where one `explosion` used to serve: a low
  // bell announces the first visible fly-in tick, a rising stab declares a
  // spell card once the boss settles, and a bright shatter breaks one. The boss
  // *death* keeps `explosion` — it is the biggest report, and
  // arrival→declare→break→explosion is the ladder without a fifth name
  // (做减法; `knell` was rejected for that reason). See `docs/audio.md`.
  'boss-arriving': 'toll',
  'boss-phase': 'declare',
  'boss-defeated': 'explosion',
  'player-death': 'death',
  pickup: 'pickup',
  extend: 'pickup',
  graze: 'graze',
  bomb: 'explosion',
  // A stage clear gets its own resolving stinger, not the pickup chirp — the same
  // wrongness fixed for boss-phase: a reward chirp is not a threat or a clear.
  cleared: 'clear',
  failed: 'death',
};

/**
 * Low-priority sounds that yield the tick a boss arrives.
 *
 * The events themselves are never discarded: `main.ts` still applies graze UI
 * pulses and every other visual reaction. This only protects the one-shot
 * arrival cue from a held shot, hit, pickup or graze voice in the same drained
 * batch.
 */
export function shouldPlayRunEventSound(
  type: RunEventType,
  bossArrivingInBatch: boolean,
): boolean {
  if (!bossArrivingInBatch) return true;
  return type !== 'shot'
    && type !== 'shot-hit'
    && type !== 'boss-hit'
    && type !== 'graze'
    && type !== 'pickup';
}

/**
 * Music fades are seconds on the audio clock, never simulation ticks.
 * Ordinary changes retain the established one-second crossfade.
 */
export const MUSIC_TRANSITION_FADE_SECONDS = 1;
/** Starting from silence should announce the requested theme promptly. */
export const MUSIC_START_FADE_SECONDS = 0.25;
/**
 * A boss intro is an attack transient, not crossfade material. A short ramp
 * avoids a click without burying its first second under the outgoing stage.
 */
export const BOSS_ARRIVAL_MUSIC_FADE_SECONDS = 0.16;

export interface MusicTransitionCue {
  readonly fadeSeconds: number;
  /**
   * Boss track still owed its short fade, retained while a URL is fetching or
   * decoding and cleared when the wanted track changes.
   */
  readonly pendingBossTrack: string | undefined;
}

/**
 * Resolve one music reconciliation without touching WebAudio.
 *
 * `Music.play` deliberately leaves `current` unchanged while a URL decodes.
 * Remembering the arriving track makes the retry use the same short fade on the
 * later tick when the buffer is actually ready, rather than falling back to the
 * ordinary one-second crossfade and swallowing the authored intro.
 */
export function resolveMusicTransition(
  current: string | undefined,
  wanted: string,
  pendingBossTrack: string | undefined,
  bossArrivingThisTick: boolean,
): MusicTransitionCue {
  const bossTrack = bossArrivingThisTick
    ? wanted
    : pendingBossTrack === wanted
      ? pendingBossTrack
      : undefined;

  if (current === wanted) {
    return {
      fadeSeconds: MUSIC_TRANSITION_FADE_SECONDS,
      pendingBossTrack: undefined,
    };
  }

  return {
    fadeSeconds: bossTrack === wanted
      ? BOSS_ARRIVAL_MUSIC_FADE_SECONDS
      : current === undefined
        ? MUSIC_START_FADE_SECONDS
        : MUSIC_TRANSITION_FADE_SECONDS,
    pendingBossTrack: bossTrack,
  };
}

/**
 * The UI cue channel — sounds the SHELL plays, never a run event.
 *
 * Menus, pause and dialogue advance are shell/menu state, not simulation, so
 * they are cued outside `EVENT_SOUNDS`: `main.ts` reads a menu state's transient
 * `.cue` field (set at the semantic move/confirm/cancel), reconciles the pause
 * enter edge, and watches `run.dialogue.index` for the advance. None of it
 * introduces a `RunEventType`, so no trace moves (see CLAUDE.md trace integrity)
 * — but every name here is still a registered sound a real menu run must reach,
 * which is why `reachability.test.ts` unions this set into both halves of its
 * sound check and drives the menu stack to prove each one is played.
 *
 * A `string[]` the game names and the shell resolves, exactly like a scene name
 * (`StageSpec.background`) — `src/game` never imports the audio engine.
 */
export const SHELL_CUES: readonly string[] = [
  'ui-move',
  'ui-confirm',
  'ui-cancel',
  'ui-pause',
  'ui-advance',
];
