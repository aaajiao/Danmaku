/**
 * Rumble cue registry, and the generic floor cues every edition starts from.
 *
 * This is the tactile sibling of `src/audio/index.ts` and follows its idiom on
 * purpose. Cues are registered by name rather than hard-coded, so an edition
 * adds or replaces one by writing a file — never by editing the engine. A
 * duplicate name REPLACES, exactly like `defineSound`: the floor cues below
 * exist to be overridden by authored ones.
 *
 * Spec values may arrive from content files unvalidated, so `defineHaptic`
 * sanitises rather than throws. A bad magnitude must not reach a motor (the
 * Gamepad API refuses out-of-range magnitudes with "invalid-parameter"), and a
 * runaway length must not hold a motor on for the rest of a stage. The rules:
 *
 *  - a non-finite number becomes 0;
 *  - magnitudes are clamped to 0..1;
 *  - `ticks` is floored, and a segment left with fewer than one tick is dropped;
 *  - the total length is capped at `MAX_HAPTIC_TICKS` by truncating the tail;
 *  - `throttleTicks` is floored, minimum 0.
 *
 * A zero-length cue is still registered — the name resolves, and
 * `HapticMixer.play` reports it unplayable — because silently dropping the
 * name would hide the authoring mistake behind "unknown cue".
 *
 * Everything here is pure data. It reads no clock, draws from neither RNG
 * stream, and touches no device; see `./types` for why rumble is presentation.
 *
 * The floor cues are defined at the BOTTOM of this module, not in a sibling
 * file: an `import './cues'` from here would be hoisted and evaluated before
 * the registry below exists.
 */

import type { HapticSegment, HapticSpec } from './types';

export type { HapticLevel, HapticSegment, HapticSpec, HapticSink } from './types';

/** A registered cue, with every value already sanitised. Frozen throughout. */
export interface ResolvedHaptic {
  readonly segments: readonly HapticSegment[];
  readonly throttleTicks: number;
  /** Total length in ticks: the sum of every segment's `ticks`. */
  readonly ticks: number;
}

/**
 * The longest cue the registry will hold: ten seconds at the fixed 60 Hz tick.
 * Longer than any authored moment (the longest floor cue, `boss-defeat`, is 80),
 * short enough that a typo'd length cannot pin a motor through a whole stage.
 */
export const MAX_HAPTIC_TICKS = 600;

const registry = new Map<string, ResolvedHaptic>();

/** Non-finite (NaN, ±Infinity, or not a number at all) becomes 0. */
function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Also folds -0 into 0, so a resolved level never carries a signed zero. */
function magnitude(value: unknown): number {
  const v = finiteOrZero(value);
  return v <= 0 ? 0 : v > 1 ? 1 : v;
}

function resolve(spec: HapticSpec): ResolvedHaptic {
  const segments: HapticSegment[] = [];
  let total = 0;
  const source: readonly unknown[] = Array.isArray(spec?.segments) ? spec.segments : [];
  for (const raw of source) {
    if (total >= MAX_HAPTIC_TICKS) break;
    if (raw === null || typeof raw !== 'object') continue;
    const seg = raw as Partial<Record<keyof HapticSegment, unknown>>;
    const ticks = Math.floor(finiteOrZero(seg.ticks));
    if (ticks < 1) continue;
    const kept = Math.min(ticks, MAX_HAPTIC_TICKS - total);
    total += kept;
    segments.push(
      Object.freeze({ strong: magnitude(seg.strong), weak: magnitude(seg.weak), ticks: kept }),
    );
  }
  const throttle = Math.floor(finiteOrZero(spec?.throttleTicks));
  return Object.freeze({
    segments: Object.freeze(segments),
    throttleTicks: throttle < 0 ? 0 : throttle,
    ticks: total,
  });
}

/**
 * Register a cue, or replace one already registered under `name`.
 *
 * A voice already playing keeps the cue it started with; only later `play`s
 * see the replacement.
 */
export function defineHaptic(name: string, spec: HapticSpec): void {
  registry.set(name, resolve(spec));
}

export function getHaptic(name: string): ResolvedHaptic | undefined {
  return registry.get(name);
}

export function hapticNames(): readonly string[] {
  return [...registry.keys()];
}

/* ------------------------------------------------------------------ */
/* Floor cues                                                          */
/* ------------------------------------------------------------------ */

/** Shorthand for one authored segment: strong, weak, ticks. */
function s(strong: number, weak: number, ticks: number): HapticSegment {
  return { strong, weak, ticks };
}

// The cap rule. `strong` is the left-grip motor, under the thumb on the stick
// (see `HapticLevel`). A cue that lands while the player is still vulnerable
// and dodging — graze, extend, boss-phase, boss-break — keeps strong <= 0.35
// and carries its energy on `weak`, so it can be felt without shaking the aim.
// Cues covered by invulnerability or a cleared field (death, bomb,
// boss-arrive, boss-defeat, clear) may use the strong motor freely.
// `index.test.ts` pins the rule.

// Sparse on purpose: at most 3 starts a second (60 / 20), weak motor only.
// A first draft's 6-tick throttle was measured saturating into a 10 Hz, 50%
// duty buzz in dense play — a texture, not a cue.
defineHaptic('graze', { segments: [s(0, 0.18, 5)], throttleTicks: 20 });

defineHaptic('death', {
  segments: [s(1.0, 0.8, 8), s(0.7, 0.5, 8), s(0.4, 0.25, 10), s(0.18, 0.1, 10)],
});

// The generic bomb. Every v4 character's bomb has its own cue; this floor is
// what a guest pack's bomb falls back to.
defineHaptic('bomb', {
  segments: [s(0.75, 0.55, 6), s(0.5, 0.35, 14), s(0.3, 0.2, 20)],
});

// Two light taps with an authored gap: a reward, felt mid-dodge.
defineHaptic('extend', { segments: [s(0, 0.5, 4), s(0, 0, 5), s(0, 0.5, 4)] });

// A slow swell on the low motor while the field is clear for the entrance.
defineHaptic('boss-arrive', {
  segments: [
    s(0.12, 0, 12),
    s(0.22, 0, 12),
    s(0.32, 0.05, 12),
    s(0.4, 0.08, 12),
    s(0.22, 0.04, 9),
    s(0.1, 0, 9),
  ],
});

defineHaptic('boss-phase', { segments: [s(0.2, 0.35, 4), s(0.08, 0.15, 6)] });

defineHaptic('boss-break', { segments: [s(0.3, 0.6, 5), s(0.1, 0.25, 8)] });

defineHaptic('boss-defeat', {
  segments: [
    s(1.0, 1.0, 10),
    s(0.75, 0.6, 14),
    s(0.5, 0.35, 18),
    s(0.28, 0.15, 20),
    s(0.12, 0.05, 18),
  ],
});

defineHaptic('clear', {
  segments: [s(0.35, 0.35, 8), s(0, 0, 4), s(0.5, 0.5, 10), s(0.2, 0.2, 10)],
});

// Shell-side only: the pulse played when the RUMBLE setting changes to a
// non-off level, never off a run event.
defineHaptic('ui-test', { segments: [s(0.5, 0.5, 8)] });
