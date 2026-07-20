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
  'boss-entered': 'explosion',
  'boss-phase': 'pickup',
  'boss-cleared': 'explosion',
  'boss-defeated': 'explosion',
  'player-death': 'death',
  pickup: 'pickup',
  extend: 'pickup',
  graze: 'graze',
  bomb: 'explosion',
  cleared: 'pickup',
  failed: 'death',
};
