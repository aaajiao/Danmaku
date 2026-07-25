import { describe, expect, test } from 'bun:test';
import {
  stepBossCastFx,
  visibleBossCastFx,
  type BossCastFx,
} from './boss-cast-fx';

describe('boss phase declaration queue', () => {
  const firstRun = { id: 'first' };
  const secondRun = { id: 'second' };

  function cast(
    run: object,
    bossName: string,
    strip: string,
    age = 0,
  ): BossCastFx<object> {
    return { run, bossName, strip, age };
  }

  test('items age on fixed ticks and expire at their own strip lifetime', () => {
    const queue = [
      cast(firstRun, 'sentinel', 'short'),
      cast(secondRun, 'regent', 'long', 2),
    ];
    const life = (strip: string) => strip === 'short' ? 2 : 4;

    stepBossCastFx(queue, life);
    expect(queue.map((item) => [item.strip, item.age])).toEqual([
      ['short', 1],
      ['long', 3],
    ]);
    stepBossCastFx(queue, life);
    expect(queue).toEqual([]);
  });

  test('visibility requires both the current Run and its current Boss', () => {
    const queue = [
      cast(firstRun, 'sentinel', 'boss.cast.sentinel.tidal-corolla'),
      cast(firstRun, 'magistrate', 'boss.cast.magistrate.colonnade'),
      cast(secondRun, 'sentinel', 'other-run'),
    ];

    expect(visibleBossCastFx(queue, firstRun, 'sentinel').map((item) => item.strip))
      .toEqual(['boss.cast.sentinel.tidal-corolla']);
    expect(visibleBossCastFx(queue, firstRun, 'regent')).toEqual([]);
  });
});
