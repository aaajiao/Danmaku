import { describe, expect, test } from 'bun:test';
import { V4_BOSS_ACTORS, V4_PLAYER_ACTORS } from './v4-actors';
import {
  V4_BOSS_PORTRAITS,
  V4_PLAYER_PORTRAITS,
  v4PortraitSource,
  v4PortraitSpec,
} from './v4-portrait';

describe('v4 dialogue portrait framing', () => {
  test('covers every built-in player and boss without inventing guest identities', () => {
    expect(Object.keys(V4_PLAYER_PORTRAITS)).toEqual(Object.keys(V4_PLAYER_ACTORS));
    expect(Object.keys(V4_BOSS_PORTRAITS)).toEqual(Object.keys(V4_BOSS_ACTORS));
    expect(v4PortraitSpec('player', 'scout')).toBe(V4_PLAYER_PORTRAITS.scout);
    expect(v4PortraitSpec('sentinel', 'scout')).toBe(V4_BOSS_PORTRAITS.sentinel);
    expect(v4PortraitSpec('guest/speaker', 'scout')).toBeUndefined();
  });

  test('uses neutral players, cast bosses and a closer-than-full-body crop', () => {
    for (const spec of Object.values(V4_PLAYER_PORTRAITS)) {
      expect(spec.pose).toBe(2);
      expect(spec.crop).toBeLessThan(0.7);
    }
    for (const spec of Object.values(V4_BOSS_PORTRAITS)) {
      expect(spec.pose).toBe(2);
      expect(spec.crop).toBeLessThan(0.7);
    }
  });

  test('rounds and clamps each crop inside its atlas frame', () => {
    const playerFrame = { x: 256, y: 128, w: 128, h: 128 };
    const player = v4PortraitSource(playerFrame, V4_PLAYER_PORTRAITS.scout!);
    expect(player).toEqual({ x: 284, y: 136, w: 72, h: 72 });

    const bossFrame = { x: 384, y: 0, w: 192, h: 192 };
    const boss = v4PortraitSource(bossFrame, V4_BOSS_PORTRAITS.regent!);
    expect(boss.w).toBe(119);
    expect(boss.h).toBe(119);
    expect(boss.x).toBeGreaterThanOrEqual(bossFrame.x);
    expect(boss.y).toBeGreaterThanOrEqual(bossFrame.y);
    expect(boss.x + boss.w).toBeLessThanOrEqual(bossFrame.x + bossFrame.w);
    expect(boss.y + boss.h).toBeLessThanOrEqual(bossFrame.y + bossFrame.h);
  });
});
