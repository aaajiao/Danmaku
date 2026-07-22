import { describe, expect, test } from 'bun:test';
import {
  ACTOR_PAD_RENDER_ORDER,
  ACTOR_PAD_TEXTURE_SIZE,
  actorPadAlphaAt,
  actorPadLayout,
} from './actor-pad';
import { Layer } from './stage';

describe('actor-local darkness pads', () => {
  test('role layouts stay local and inside the authored opacity bands', () => {
    expect(actorPadLayout('enemy', 42)).toEqual({ width: 66, height: 66, alpha: 0.2 });
    expect(actorPadLayout('player', 52)).toEqual({ width: 80, height: 80, alpha: 0.22 });
    expect(actorPadLayout('boss', 88)).toEqual({ width: 124, height: 124, alpha: 0.3 });
  });

  test('render orders stay immediately below actors and every danger layer', () => {
    expect(ACTOR_PAD_RENDER_ORDER.enemy).toBe(Layer.Enemies - 1);
    expect(ACTOR_PAD_RENDER_ORDER.player).toBe(Layer.Player - 2);
    expect(ACTOR_PAD_RENDER_ORDER.enemy).toBeLessThan(Layer.Enemies);
    expect(ACTOR_PAD_RENDER_ORDER.player).toBeLessThan(Layer.Player);
    expect(ACTOR_PAD_RENDER_ORDER.player).toBeLessThan(Layer.EnemyShots);
  });

  test('the texture has a solid centre, radial fade and transparent gutter', () => {
    const mid = ACTOR_PAD_TEXTURE_SIZE / 2;
    expect(actorPadAlphaAt(mid, mid)).toBe(255);
    expect(actorPadAlphaAt(20, mid)).toBeGreaterThan(actorPadAlphaAt(12, mid));
    expect(actorPadAlphaAt(12, mid)).toBeGreaterThan(actorPadAlphaAt(4, mid));
    expect(actorPadAlphaAt(2, mid)).toBe(0);
    expect(actorPadAlphaAt(0, 0)).toBe(0);
  });
});
