import { describe, expect, test } from 'bun:test';

import { createPattern, type EmitContext, type Pattern } from '../../content/pattern-registry';
import { Random } from '../../core/random';
import { BulletSystem, type BulletSpec } from '../../sim/bullet';
import { V4_PATTERN_NAMES } from './patterns';

const SPEC: BulletSpec = {
  style: { sprite: 'orb.small' },
  radius: 3,
  motion: { r: 2, theta: -999 },
};

const NEW_PATTERNS = ['alternating-fan', 'gap-ring', 'weave', 'lane-wall'] as const;

function system(capacity = 256): BulletSystem {
  return new BulletSystem({
    bounds: { width: 480, height: 640, margin: 48 },
    initial: capacity,
    max: capacity,
  });
}

function context(
  bullets: BulletSystem,
  age: number,
  overrides: Partial<EmitContext> = {},
): EmitContext {
  return {
    age,
    x: 100,
    y: 100,
    targetX: 100,
    targetY: 200,
    bullets,
    rng: new Random(0x5eed),
    faction: 'enemy',
    ...overrides,
  };
}

function drive(
  pattern: Pattern,
  bullets: BulletSystem,
  ticks: number,
  overrides: Partial<EmitContext> = {},
): number[] {
  const fired: number[] = [];
  for (let age = 0; age < ticks; age++) {
    const before = bullets.count;
    pattern(context(bullets, age, overrides));
    fired.push(bullets.count - before);
  }
  return fired;
}

function headings(bullets: BulletSystem): number[] {
  return bullets.bullets.map((bullet) => bullet.vector.theta);
}

describe('v4 spatial pattern vocabulary', () => {
  test('the public inventory includes all four negative-space patterns', () => {
    expect(V4_PATTERN_NAMES).toEqual(
      expect.arrayContaining([...NEW_PATTERNS]),
    );
  });

  test('every new pattern fails loudly when its bullet spec is missing', () => {
    for (const name of NEW_PATTERNS) {
      expect(() => createPattern(name)).toThrow(
        `pattern "${name}" requires a "spec" option`,
      );
    }
  });

  test('alternating-fan moves consecutive volleys to opposite sides of aim', () => {
    const bullets = system();
    const pattern = createPattern('alternating-fan', {
      spec: SPEC,
      count: 3,
      spread: 20,
      swing: 10,
      period: 2,
    });

    expect(drive(pattern, bullets, 3)).toEqual([3, 0, 3]);
    expect(headings(bullets)).toEqual([70, 80, 90, 90, 100, 110]);
  });

  test('gap-ring leaves the authored opening on the live player bearing', () => {
    const bullets = system();
    const pattern = createPattern('gap-ring', {
      spec: SPEC,
      count: 12,
      gap: 50,
      rotation: 7,
      period: 1,
    });

    pattern(context(bullets, 0, { targetX: 200, targetY: 100 }));

    expect(bullets.count).toBe(11);
    for (const theta of headings(bullets)) {
      const delta = ((theta + 540) % 360) - 180;
      expect(Math.abs(delta)).toBeGreaterThanOrEqual(25);
    }
  });

  test('gap-ring rotation advances even when the pool truncates a volley', () => {
    const bullets = system(2);
    const pattern = createPattern('gap-ring', {
      spec: SPEC,
      count: 8,
      gap: 1,
      rotation: 10,
      period: 1,
    });

    pattern(context(bullets, 0, { targetX: 200, targetY: 100 }));
    const first = headings(bullets);
    bullets.clear();
    pattern(context(bullets, 1, { targetX: 200, targetY: 100 }));

    expect(first).toEqual([45, 90]);
    expect(headings(bullets)).toEqual([10, 55]);
  });

  test('weave emits nested mirrored threads and moves their crossing', () => {
    const bullets = system();
    const pattern = createPattern('weave', {
      spec: SPEC,
      pairs: 2,
      amplitude: 30,
      step: 60,
      period: 1,
    });

    pattern(context(bullets, 0));
    pattern(context(bullets, 1));

    expect(headings(bullets).slice(0, 4)).toEqual([75, 105, 60, 120]);
    expect(headings(bullets).slice(4)).toEqual([82.5, 97.5, 75, 105]);
  });

  test('lane-wall places a wrapped multi-column opening inside authored bounds', () => {
    const bullets = system();
    const pattern = createPattern('lane-wall', {
      spec: SPEC,
      columns: 5,
      gapColumn: 2,
      gapWidth: 2,
      shift: 1,
      left: 0,
      right: 100,
      direction: 80,
      speed: 3,
      period: 1,
    });

    pattern(context(bullets, 0));
    expect(bullets.bullets.map((bullet) => bullet.x)).toEqual([10, 30, 90]);
    expect(headings(bullets)).toEqual([80, 80, 80]);
    expect(bullets.bullets.every((bullet) => bullet.vector.r === 3)).toBe(true);

    bullets.clear();
    pattern(context(bullets, 1));
    expect(bullets.bullets.map((bullet) => bullet.x)).toEqual([10, 30, 50]);
  });

  test('all four geometry patterns leave the supplied RNG stream untouched', () => {
    for (const name of NEW_PATTERNS) {
      const bullets = system();
      const rng = new Random(0xc0ffee);
      const before = rng.getState();
      const pattern = createPattern(name, { spec: SPEC, period: 1 });

      drive(pattern, bullets, 12, { rng });

      expect(bullets.count).toBeGreaterThan(0);
      expect(rng.getState()).toEqual(before);
    }
  });

  test('identical seeds and inputs reproduce every new pattern exactly', () => {
    const run = (name: (typeof NEW_PATTERNS)[number]): number[] => {
      const bullets = system(1024);
      const rng = new Random(314159);
      const pattern = createPattern(name, { spec: SPEC, period: 2 });
      drive(pattern, bullets, 40, { rng, targetX: 360, targetY: 520 });
      return headings(bullets);
    };

    for (const name of NEW_PATTERNS) expect(run(name)).toEqual(run(name));
  });
});
