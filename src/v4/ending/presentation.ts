/**
 * V4's fixed-tick ending choreography.
 *
 * These values describe presentation only. They never enter `Run`, replay
 * input, or content identity; the browser shell applies them to already-frozen
 * render layers while the generic ending state supplies the current page clock.
 */

export interface EndingPageClock {
  /** Zero-based authored page index. */
  readonly index: number;
  /** Authored page count, carried across the generic state/render boundary. */
  readonly count: number;
  /** Fixed ticks elapsed on this page. */
  readonly age: number;
}

export interface V4EndingMix {
  readonly enemies: number;
  readonly player: number;
  readonly projectiles: number;
  readonly pickups: number;
  readonly effects: number;
  readonly trace: number;
  readonly art: number;
}

/** The frozen run as it looked on the terminal clear tick. */
const FULL_GAMEPLAY_MIX: V4EndingMix = {
  enemies: 1,
  player: 1,
  projectiles: 1,
  pickups: 1,
  effects: 1,
  trace: 0,
  art: 0,
};

/**
 * One target per authored v4 page.
 *
 * Page 0 retains a legible residue of the field and pilot. Page 1 removes the
 * institution-shaped objects, leaving the diminished pilot and the route they
 * actually flew. Page 2 removes both body and trace; only the authored wear
 * field remains, almost gone.
 */
export const V4_ENDING_MIXES = [
  {
    enemies: 0.46,
    player: 0.82,
    projectiles: 0.24,
    pickups: 0.18,
    effects: 0.16,
    trace: 0,
    art: 0.30,
  },
  {
    enemies: 0,
    player: 0.42,
    projectiles: 0,
    pickups: 0,
    effects: 0,
    trace: 0.32,
    art: 0.16,
  },
  {
    enemies: 0,
    player: 0,
    projectiles: 0,
    pickups: 0,
    effects: 0,
    trace: 0,
    art: 0.04,
  },
] as const satisfies readonly V4EndingMix[];

/**
 * Transition durations are page-relative fixed ticks. The opening gets a
 * slightly longer hand-off from full gameplay; later pages settle faster.
 */
export const V4_ENDING_TRANSITION_TICKS = [36, 30, 30] as const;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep01(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function mix(from: V4EndingMix, to: V4EndingMix, amount: number): V4EndingMix {
  const lerp = (a: number, b: number): number => a + (b - a) * amount;
  return {
    enemies: lerp(from.enemies, to.enemies),
    player: lerp(from.player, to.player),
    projectiles: lerp(from.projectiles, to.projectiles),
    pickups: lerp(from.pickups, to.pickups),
    effects: lerp(from.effects, to.effects),
    trace: lerp(from.trace, to.trace),
    art: lerp(from.art, to.art),
  };
}

/**
 * Resolve the current v4 layer mix from the generic page clock.
 *
 * Invalid indices are clamped so a renderer cannot turn malformed presentation
 * metadata into NaNs. `count` is deliberately descriptive: the v4 contract test
 * pins it to the target array and the runtime interpolation depends only on the
 * actual page index and fixed-tick age.
 */
export function v4EndingMix(clock: EndingPageClock): V4EndingMix {
  const authoredIndex = Number.isFinite(clock.index) ? Math.trunc(clock.index) : 0;
  const index = Math.max(0, Math.min(V4_ENDING_MIXES.length - 1, authoredIndex));
  const target = V4_ENDING_MIXES[index] ?? V4_ENDING_MIXES[0];
  const previous = index === 0
    ? FULL_GAMEPLAY_MIX
    : (V4_ENDING_MIXES[index - 1] ?? FULL_GAMEPLAY_MIX);
  const duration = V4_ENDING_TRANSITION_TICKS[index] ?? 1;
  const age = Number.isFinite(clock.age) ? Math.max(0, clock.age) : 0;
  const amount = smoothstep01(age / duration);
  if (amount <= 0) return previous;
  if (amount >= 1) return target;
  return mix(previous, target, amount);
}
