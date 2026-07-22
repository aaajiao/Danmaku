import { describe, expect, test } from 'bun:test';
import {
  stepBossIdentityFx,
  visibleBossIdentityFx,
  type BossIdentityFx,
} from './boss-identity-fx';

describe('boss identity breakup queue', () => {
  const firstRun = { id: 'first' };
  const secondRun = { id: 'second' };

  function identity(run: object, strip: string, age = 0): BossIdentityFx<object> {
    return { run, strip, x: 120, y: 80, age };
  }

  test('items age on fixed ticks and expire at their own strip lifetime', () => {
    const queue = [identity(firstRun, 'short'), identity(secondRun, 'long', 2)];
    const life = (strip: string) => strip === 'short' ? 2 : 4;

    stepBossIdentityFx(queue, life);
    expect(queue.map((item) => [item.strip, item.age])).toEqual([['short', 1], ['long', 3]]);
    stepBossIdentityFx(queue, life);
    expect(queue).toEqual([]);
  });

  test('visibility is scoped by Run without pausing hidden lifetimes', () => {
    const queue = [identity(firstRun, 'sentinel'), identity(secondRun, 'warden')];
    expect(visibleBossIdentityFx(queue, new Set([secondRun])).map((item) => item.strip))
      .toEqual(['warden']);

    stepBossIdentityFx(queue, () => 3);
    expect(queue.map((item) => item.age)).toEqual([1, 1]);
    expect(visibleBossIdentityFx(queue, new Set())).toEqual([]);
  });
});
