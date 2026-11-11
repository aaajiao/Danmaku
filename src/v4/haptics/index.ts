/**
 * v4 rumble identity: one authored cue per character bomb.
 *
 * The generic registry (`src/haptics`) ships a floor cue for every felt event,
 * including one generic `bomb`. That floor is right for a guest pack's bomb,
 * whose shape this edition cannot know — and wrong for v4's five, because each
 * of them is a different verb on screen (a tide, a lance, a pack, a field, a
 * bite) and one envelope for all five would tell the player's hands they all
 * did the same thing. This module is the tactile sibling of `../audio`: the
 * identity lives in the edition root, the machinery stays generic.
 *
 * Two rules every cue here keeps, and `index.test.ts` pins both:
 *
 *  - **Its length is its bomb's `duration`.** A cue that outlived the blast
 *    would be felt over a field the player can already see is back; one that
 *    stopped early would fall silent mid-effect.
 *  - **It opens on the strong motor (>= 0.6) inside its first 3–8 ticks.** A
 *    bomb is a panic button, and its answer is front-loaded. That is allowed
 *    by the cap rule (see `src/haptics/index.ts`): every v4 bomb's
 *    `invulnTicks` exceeds its `duration`, so the strong motor under the stick
 *    thumb only ever shakes while the player cannot be hit.
 *
 * Presentation only, like everything under `src/haptics`: the shell resolves
 * an already drained `bomb` event through `v4EventHaptic` and plays the result.
 * Nothing here is read by the simulation, draws from either RNG stream, or
 * reaches the input mask.
 */

import { defineHaptic, type HapticSegment, type HapticSpec } from '../../haptics';
import type { RunEvent } from '../../game/run';

/** Shorthand for one authored segment: strong, weak, ticks. */
function s(strong: number, weak: number, ticks: number): HapticSegment {
  return { strong, weak, ticks };
}

/** One hound pulse: the bite, then an equal authored gap. */
function pulse(strong: number, weak: number): HapticSegment[] {
  return [s(strong, weak, 6), s(0, 0, 6)];
}

/** One spire breath: the field's slow in-and-out. */
function breath(): HapticSegment[] {
  return [s(0.12, 0.28, 9), s(0.2, 0.36, 9)];
}

/**
 * Bomb registry name → the cue it plays. Keys are the v4 campaign's bomb names
 * (`tools/make-v4-content.ts`); a bomb absent from this table — any guest
 * pack's — falls back to the generic `bomb` floor cue.
 */
export const V4_BOMB_HAPTICS = Object.freeze({
  'scout-tide': 'bomb.scout-tide',
  'lance-pierce': 'bomb.lance-pierce',
  'hound-pack': 'bomb.hound-pack',
  'spire-field': 'bomb.spire-field',
  'maw-devour': 'bomb.maw-devour',
} as const);

type V4BombName = keyof typeof V4_BOMB_HAPTICS;
type V4BombHaptic = (typeof V4_BOMB_HAPTICS)[V4BombName];

/** Every cue name this module registers, in authoring order. */
export const V4_EVENT_HAPTIC_NAMES: readonly V4BombHaptic[] = Object.freeze(
  Object.values(V4_BOMB_HAPTICS),
);

// Lengths in the comments are the bomb `duration`s these were authored
// against; the test re-derives them from the registered bombs.
const V4_BOMB_HAPTIC_SPECS: Readonly<Record<V4BombHaptic, HapticSpec>> = {
  // 90 ticks. A surge, a pull back, then a second slower swell as the tide
  // comes in, draining out over the last half second.
  'bomb.scout-tide': {
    segments: [
      s(0.65, 0.5, 6),
      s(0.3, 0.2, 14),
      s(0.45, 0.3, 20),
      s(0.35, 0.2, 20),
      s(0.2, 0.1, 15),
      s(0.08, 0.04, 15),
    ],
  },
  // 60 ticks. One full-strength punch, then the beam's sustained hum carried
  // on the weak motor while it pierces.
  'bomb.lance-pierce': {
    segments: [s(1.0, 1.0, 5), s(0.3, 0.85, 25), s(0.15, 0.5, 20), s(0, 0.2, 10)],
  },
  // 72 ticks. Six bites, each a little weaker, as the pack runs out.
  'bomb.hound-pack': {
    segments: [
      ...pulse(0.85, 0.5),
      ...pulse(0.75, 0.45),
      ...pulse(0.65, 0.4),
      ...pulse(0.55, 0.33),
      ...pulse(0.45, 0.27),
      ...pulse(0.35, 0.2),
    ],
  },
  // 120 ticks. The field slams down, settles, and then breathes four times
  // while it holds the screen.
  'bomb.spire-field': {
    segments: [
      s(0.7, 0.6, 6),
      s(0.15, 0.3, 24),
      ...breath(),
      ...breath(),
      ...breath(),
      ...breath(),
      s(0.08, 0.15, 18),
    ],
  },
  // 45 ticks. Three closing jaws, each softer, over the shortest bomb.
  'bomb.maw-devour': {
    segments: [
      s(1.0, 0.9, 8),
      s(0.5, 0.3, 5),
      s(0.9, 0.6, 6),
      s(0.3, 0.2, 6),
      s(0.7, 0.4, 6),
      s(0.2, 0.1, 14),
    ],
  },
};

for (const name of V4_EVENT_HAPTIC_NAMES) defineHaptic(name, V4_BOMB_HAPTIC_SPECS[name]);

function isV4Bomb(name: string): name is V4BombName {
  // Own keys only: a bomb named `constructor` or `toString` must not resolve
  // through the prototype to a function and be handed to the mixer as a name.
  return Object.hasOwn(V4_BOMB_HAPTICS, name);
}

/**
 * Resolve the event details v4 owns. Returning `undefined` delegates to the
 * generic `EVENT_HAPTICS` table in the shell — which is what every non-bomb
 * event, and a guest pack's bomb, gets.
 */
export function v4EventHaptic(event: RunEvent): string | undefined {
  if (event.type !== 'bomb' || event.name === undefined) return undefined;
  return isV4Bomb(event.name) ? V4_BOMB_HAPTICS[event.name] : undefined;
}
