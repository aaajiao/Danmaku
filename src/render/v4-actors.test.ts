import { describe, expect, test } from 'bun:test';
import {
  V4_BOSS_ACTORS,
  V4_ENEMY_ACTORS,
  V4_PLAYER_ACTORS,
  v4BossPoseFrame,
  v4EnemyIdleFrame,
  v4EnemyPoseFrame,
  v4PlayerBankFrame,
} from './v4-actors';

describe('v4 actor ledger', () => {
  test('covers the whole shipped cast with unique strips', () => {
    expect(Object.keys(V4_PLAYER_ACTORS)).toEqual(['scout', 'lance', 'hound', 'spire', 'maw']);
    expect(Object.keys(V4_ENEMY_ACTORS)).toHaveLength(16);
    expect(Object.keys(V4_BOSS_ACTORS)).toEqual([
      'sentinel',
      'warden',
      'magistrate',
      'chancellor',
      'regent',
    ]);

    const strips = [
      ...Object.values(V4_PLAYER_ACTORS),
      ...Object.values(V4_ENEMY_ACTORS),
      ...Object.values(V4_BOSS_ACTORS),
    ].map((actor) => actor.strip);
    expect(new Set(strips).size).toBe(strips.length);
    expect(strips.every((name) => name.startsWith('actor.'))).toBeTrue();
    const deaths = Object.values(V4_BOSS_ACTORS).map((actor) => actor.deathStrip);
    expect(new Set(deaths).size).toBe(5);
    expect(deaths.every((name) => name?.startsWith('boss.death.'))).toBeTrue();
  });

  test('narrow contact actors use display boxes whose painted width covers their hit circle', () => {
    // Alpha bounds are measured from the committed atlases in
    // tools/v4-actor-atlas.test.ts. These ratios turn those source pixels into
    // the logical 480×640 field and guard the three formerly invisible edges.
    expect(V4_ENEMY_ACTORS.clerk!.size * 50 / 128).toBeGreaterThanOrEqual(18);
    expect(V4_BOSS_ACTORS.magistrate!.size * 85 / 192).toBeGreaterThanOrEqual(42);
    expect(V4_BOSS_ACTORS.regent!.size * 77 / 192).toBeGreaterThanOrEqual(44);
  });

  test('banking poses settle instead of alternating at 60 Hz', () => {
    expect(v4PlayerBankFrame(0, 0)).toBe(2);
    expect(v4PlayerBankFrame(-1, 1)).toBe(1);
    expect(v4PlayerBankFrame(-1, 4)).toBe(0);
    expect(v4PlayerBankFrame(1, 1)).toBe(3);
    expect(v4PlayerBankFrame(1, 4)).toBe(4);
    expect(v4PlayerBankFrame(1, 400)).toBe(4);
  });

  test('minor enemies breathe, attack and recover from actual volley age', () => {
    expect([0, 8, 16, 24].map(v4EnemyIdleFrame)).toEqual([0, 1, 0, 1]);
    expect(v4EnemyPoseFrame(8, undefined)).toBe(1);
    expect(v4EnemyPoseFrame(8, 0)).toBe(2);
    expect(v4EnemyPoseFrame(8, 3)).toBe(2);
    expect(v4EnemyPoseFrame(8, 4)).toBe(3);
    expect(v4EnemyPoseFrame(8, 7)).toBe(3);
    expect(v4EnemyPoseFrame(8, 8)).toBe(1);
  });

  test('boss poses stage fixed-tick phase and actual-fire facts semantically', () => {
    const facts = {
      entering: false,
      phaseTicks: 30,
      ticksSinceFire: undefined,
      phaseHpFraction: 1,
      phaseTimeFraction: 1,
    };
    expect(v4BossPoseFrame({ ...facts, entering: true })).toBe(0);
    expect(v4BossPoseFrame({ ...facts, phaseTicks: 0 })).toBe(1);
    expect(v4BossPoseFrame({ ...facts, ticksSinceFire: 0 })).toBe(2);
    expect(v4BossPoseFrame({ ...facts, ticksSinceFire: 3 })).toBe(2);
    expect(v4BossPoseFrame({ ...facts, ticksSinceFire: 4 })).toBe(3);
    expect(v4BossPoseFrame({ ...facts, ticksSinceFire: 11 })).toBe(3);
    expect(v4BossPoseFrame({ ...facts, phaseHpFraction: 0.125 })).toBe(4);
    expect(v4BossPoseFrame({ ...facts, phaseTimeFraction: 0.1 })).toBe(4);
    expect(v4BossPoseFrame({ ...facts, ticksSinceFire: 12 })).toBe(0);
    expect(v4BossPoseFrame({ ...facts, impactKind: 'heavy', impactFraction: 1 })).toBe(4);
  });
});
