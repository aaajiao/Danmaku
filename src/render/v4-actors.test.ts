import { describe, expect, test } from 'bun:test';
import {
  V4_BOSS_ACTORS,
  V4_ENEMY_ACTORS,
  V4_PLAYER_ACTORS,
  v4BossPoseFrame,
  v4EnemyIdleFrame,
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

  test('minor enemies breathe on two frames while bosses expose phase gestures', () => {
    expect([0, 8, 16, 24].map(v4EnemyIdleFrame)).toEqual([0, 1, 0, 1]);
    expect(v4BossPoseFrame(true, 3, 100)).toBe(0);
    expect(v4BossPoseFrame(false, 0, 0)).toBe(1);
    expect(v4BossPoseFrame(false, 3, 0)).toBe(4);
    expect(v4BossPoseFrame(false, 3, 12)).toBe(0);
    expect(v4BossPoseFrame(false, 3, 36)).toBe(4);
  });
});
