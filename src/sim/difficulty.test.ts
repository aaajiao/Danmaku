/**
 * The difficulty axis: the pure merge, the phase gate, and both live wires.
 *
 * The unit half proves `mergeOptions`/`activePhaseIndices` in isolation; the
 * integration half proves the sim actually reads them — an enemy pattern fires a
 * different bullet population per tier, and a tier-gated boss card is skipped on
 * the tiers it excludes. A mechanism that selects but never varies is the "wire
 * with nothing on it" this project keeps finding, so both ends are asserted.
 */

import { describe, expect, test } from 'bun:test';
import { Random } from '../core/random';
import { BossSystem, defineBoss, type BossEvent } from './boss';
import { BulletSystem, type BulletSpec, type FieldBounds } from './bullet';
import {
  activePhaseIndices,
  DEFAULT_DIFFICULTY,
  DIFFICULTIES,
  mergeOptions,
  type Difficulty,
} from './difficulty';
import { defineEnemy, EnemySystem } from './enemy';

const FIELD: FieldBounds = { width: 480, height: 480, margin: 32 };

function rng(seed = 1): Random {
  return new Random(seed);
}

/* ------------------------------------------------------------------ */
/* The union                                                           */
/* ------------------------------------------------------------------ */

describe('the tier union', () => {
  test('is the four tiers ascending, with normal the default', () => {
    expect(DIFFICULTIES).toEqual(['easy', 'normal', 'hard', 'lunatic']);
    expect(DEFAULT_DIFFICULTY).toBe('normal');
  });
});

/* ------------------------------------------------------------------ */
/* mergeOptions — the shallow, non-mutating select                     */
/* ------------------------------------------------------------------ */

describe('mergeOptions', () => {
  test('no override for the tier returns the base untouched', () => {
    const base = { count: 12, period: 90 };
    // Returned as-is (identity), because nothing on this tier changes it — the
    // no-allocation path, and the reason the base is safe to share.
    expect(mergeOptions(base, { hard: { count: 16 } }, 'normal')).toBe(base);
    // Absent overrides likewise.
    expect(mergeOptions(base, undefined, 'lunatic')).toBe(base);
  });

  test('a tier override shallow-merges its fields over the base', () => {
    const base = { count: 12, period: 90, rotation: 7 };
    const merged = mergeOptions(base, { hard: { count: 16, period: 75 } }, 'hard');
    expect(merged).toEqual({ count: 16, period: 75, rotation: 7 });
  });

  test('a nested value is replaced whole, not deep-merged', () => {
    // The documented rule: one level deep. `spec` is swapped entirely; the base
    // spec's other fields do NOT survive into the override's spec.
    const base = { spec: { sprite: 'a', r: 1 }, count: 12 };
    const merged = mergeOptions(base, { lunatic: { spec: { sprite: 'b' } } }, 'lunatic');
    expect(merged).toEqual({ spec: { sprite: 'b' }, count: 12 });
    expect((merged as { spec: { r?: number } }).spec.r).toBeUndefined();
  });

  test('never mutates the base — the shared spec object is untouched', () => {
    // The base `options` lives once in a registered spec and is read by every
    // spawn; a merge that wrote through it would leak one tier into the next.
    const base = { count: 12, period: 90 };
    const merged = mergeOptions(base, { easy: { count: 8 } }, 'easy');
    expect(merged).not.toBe(base);
    expect(base).toEqual({ count: 12, period: 90 });
  });
});

/* ------------------------------------------------------------------ */
/* activePhaseIndices — the tier gate                                  */
/* ------------------------------------------------------------------ */

describe('activePhaseIndices', () => {
  test('an ungated card exists on every tier', () => {
    const phases = [{}, {}, {}];
    for (const tier of DIFFICULTIES) {
      expect(activePhaseIndices(phases, tier)).toEqual([0, 1, 2]);
    }
  });

  test('a gated card exists only on the tiers it lists', () => {
    const phases = [{}, { difficulties: ['lunatic'] as Difficulty[] }, {}];
    expect(activePhaseIndices(phases, 'normal')).toEqual([0, 2]);
    expect(activePhaseIndices(phases, 'lunatic')).toEqual([0, 1, 2]);
  });
});

/* ------------------------------------------------------------------ */
/* defineBoss — every tier must keep a phase                           */
/* ------------------------------------------------------------------ */

describe('defineBoss tier validation', () => {
  test('a card gated off a tier is fine while another remains', () => {
    expect(() =>
      defineBoss('test.diff.oktier', {
        sprite: 'orb.large',
        radius: 12,
        phases: [
          { name: 'p0', hp: 10, timeLimit: 0, patterns: [] },
          { name: 'p1', hp: 10, timeLimit: 0, patterns: [], difficulties: ['lunatic'] },
        ],
      }),
    ).not.toThrow();
  });

  test('a boss with every card gated off a tier is refused at definition', () => {
    // easy is checked first (DIFFICULTIES order), so it names easy.
    expect(() =>
      defineBoss('test.diff.emptytier', {
        sprite: 'orb.large',
        radius: 12,
        phases: [{ name: 'only', hp: 10, timeLimit: 0, patterns: [], difficulties: ['lunatic'] }],
      }),
    ).toThrow(/has no phase on difficulty "easy" — every tier must keep at least one/);
  });
});

/* ------------------------------------------------------------------ */
/* Live wire 1: an enemy pattern varies its population by tier          */
/* ------------------------------------------------------------------ */

/** Stationary shot so fired bullets stay put and can be counted. */
const RING_SHOT: BulletSpec = {
  style: { sprite: 'orb.small' },
  radius: 3,
  motion: { r: 0, theta: 90 },
};

/**
 * A single `ring` volley whose count varies by tier. `period` is huge so the
 * ring fires exactly once in the window, making the bullet count the tier's
 * `count` exactly. Kept as a named const so the test can assert it is never
 * mutated by the merges the systems run through it.
 */
const TIERED_RING = { spec: RING_SHOT, count: 12, period: 100000, rotation: 0 };

defineEnemy('test.diff.tiered', {
  sprite: 'orb.medium',
  hp: 100000,
  radius: 10,
  patterns: [
    {
      pattern: 'ring',
      options: TIERED_RING,
      difficulty: { easy: { count: 4 }, hard: { count: 16 }, lunatic: { count: 20 } },
    },
  ],
});

function ringCountOnTier(difficulty: Difficulty): number {
  const bullets = new BulletSystem({ bounds: FIELD, initial: 256 });
  const system = new EnemySystem({ bounds: FIELD, initial: 8, bullets, difficulty });
  system.spawn('test.diff.tiered', 240, 240, rng());
  // A couple of ticks: the ring fires on the enemy's first pattern step.
  for (let i = 0; i < 3; i++) system.step(240, 460, rng());
  return bullets.count;
}

describe('an enemy pattern varies its population by tier', () => {
  test('each tier fires its own count, ascending easy < normal < hard < lunatic', () => {
    const easy = ringCountOnTier('easy');
    const normal = ringCountOnTier('normal');
    const hard = ringCountOnTier('hard');
    const lunatic = ringCountOnTier('lunatic');

    expect(easy).toBe(4);
    expect(normal).toBe(12); // the base `options`, no override — Normal is the truth
    expect(hard).toBe(16);
    expect(lunatic).toBe(20);
    expect(easy).toBeLessThan(normal);
    expect(normal).toBeLessThan(lunatic);
  });

  test('running every tier leaves the authored spec options unmutated', () => {
    // Four full runs through the merge above; the shared spec must be pristine.
    expect(TIERED_RING).toEqual({ spec: RING_SHOT, count: 12, period: 100000, rotation: 0 });
  });
});

/* ------------------------------------------------------------------ */
/* Live wire 2: a boss skips a tier-gated card                          */
/* ------------------------------------------------------------------ */

defineBoss('test.diff.gatedboss', {
  sprite: 'orb.large',
  radius: 12,
  // No entry: it settles on spawn, so phase 0 arms immediately.
  phases: [
    { name: 'p0', hp: 10, timeLimit: 0, patterns: [] },
    { name: 'p1 lunatic', hp: 10, timeLimit: 0, patterns: [], difficulties: ['lunatic'] },
    { name: 'p2', hp: 10, timeLimit: 0, patterns: [] },
  ],
});

/** The `spec.phases` indices a fight actually enters, in order, on a tier. */
function phasesEntered(difficulty: Difficulty): number[] {
  const bullets = new BulletSystem({ bounds: FIELD, initial: 64 });
  const system = new BossSystem({ bounds: FIELD, bullets, difficulty });
  const entered: number[] = [];
  const collect = (events: readonly BossEvent[]): void => {
    for (const e of events) if (e.type === 'phase-start') entered.push(e.phaseIndex);
  };

  system.spawn('test.diff.gatedboss', 240, 120, rng());
  collect(system.drainEvents());
  // Drain each phase in turn; a cleared last phase ends the fight.
  for (let i = 0; i < 5 && system.active; i++) {
    system.damage(1000);
    collect(system.drainEvents());
  }
  return entered;
}

describe('a boss skips a card gated off the tier', () => {
  test('normal fights phases 0 and 2, lunatic fights 0, 1 and 2', () => {
    expect(phasesEntered('normal')).toEqual([0, 2]);
    expect(phasesEntered('lunatic')).toEqual([0, 1, 2]);
  });
});
