import { describe, expect, test } from 'bun:test';
import { Random, sim } from '../core/random';
import {
  Bullet,
  BulletSystem,
  type BulletSpec,
  type BulletSystemOptions,
  type FieldBounds,
} from './bullet';
import { circlesOverlap } from './collision';
import { defineBehaviour, type MotionContext, type MotionSegment } from './motion';

const FIELD: FieldBounds = { width: 480, height: 480, margin: 32 };

/** A cramped field, so wall bounces happen in a handful of ticks. */
const SMALL: FieldBounds = { width: 40, height: 40, margin: 8 };

function makeSystem(options: Partial<BulletSystemOptions> = {}): BulletSystem {
  return new BulletSystem({ bounds: FIELD, initial: 64, ...options });
}

/** A stationary bullet unless the caller supplies motion — it never drifts offscreen. */
function makeSpec(overrides: Partial<BulletSpec> = {}): BulletSpec {
  return {
    style: { sprite: 'orb.small' },
    radius: 3,
    motion: { r: 0, theta: 90 },
    ...overrides,
  };
}

/**
 * Every test drives its own generator rather than the global `sim` stream, so
 * no test can move another test's outcome by drawing from it.
 */
function rng(seed = 1): Random {
  return new Random(seed);
}

/** Identity-based view of the live list — deep equality would hide slot mix-ups. */
function slots(live: readonly Bullet[], all: readonly Bullet[]): number[] {
  return live.map((b) => all.indexOf(b));
}

function stepTimes(system: BulletSystem, ticks: number, r = rng()): void {
  for (let i = 0; i < ticks; i++) system.step(0, 0, r);
}

describe('spawn', () => {
  test('a spawned bullet is alive, placed, and counted', () => {
    const system = makeSystem();
    const bullet = system.spawn(120, 200, makeSpec(), 'enemy', rng());

    expect(bullet).toBeDefined();
    expect(bullet?.alive).toBe(true);
    expect(bullet?.x).toBe(120);
    expect(bullet?.y).toBe(200);
    expect(system.count).toBe(1);
    expect(system.bullets[0]).toBe(bullet as Bullet);
  });

  test('the spec supplies radius, damage, life, bounce and style', () => {
    const system = makeSystem();
    const style = { sprite: 'blade', additive: true };
    const bullet = system.spawn(
      10,
      10,
      makeSpec({ radius: 7, damage: 4, life: 90, bounce: true, maxBounces: 3, style }),
      'enemy',
      rng(),
    ) as Bullet;

    expect(bullet.radius).toBe(7);
    expect(bullet.damage).toBe(4);
    expect(bullet.life).toBe(90);
    expect(bullet.bounce).toBe(true);
    expect(bullet.maxBounces).toBe(3);
    expect(bullet.style).toBe(style);
  });

  test('damage defaults to 1 and life to 0, meaning "until offscreen"', () => {
    const system = makeSystem();
    const bullet = system.spawn(10, 10, makeSpec(), 'enemy', rng()) as Bullet;

    expect(bullet.damage).toBe(1);
    expect(bullet.life).toBe(0);
    expect(bullet.bounce).toBe(false);
    expect(bullet.maxBounces).toBe(0);
  });

  test('faction defaults to enemy and is honoured when given', () => {
    const system = makeSystem();
    const enemy = system.spawn(10, 10, makeSpec(), undefined, rng()) as Bullet;
    const player = system.spawn(20, 10, makeSpec(), 'player', rng()) as Bullet;

    expect(enemy.faction).toBe('enemy');
    expect(player.faction).toBe('player');
  });

  test('motion params reach the vector', () => {
    const system = makeSystem();
    const bullet = system.spawn(
      10,
      10,
      makeSpec({ motion: { r: 4, theta: 30, w: 2 } }),
      'enemy',
      rng(),
    ) as Bullet;

    expect(bullet.vector.r).toBe(4);
    expect(bullet.vector.theta).toBe(30);
    expect(bullet.vector.w).toBe(2);
  });

  test('a fresh bullet starts at age 0 with no reflections', () => {
    const system = makeSystem();
    const bullet = system.spawn(10, 10, makeSpec(), 'enemy', rng()) as Bullet;

    expect(bullet.age).toBe(0);
    expect(bullet.angle).toBe(0);
    expect(bullet.vector.reflectCount).toBe(0);
  });

  test('hasTimeline reflects whether the spec supplied one', () => {
    const system = makeSystem();
    const timeline: MotionSegment[] = [{ count: 4, motion: { r: 2 } }];

    const plain = system.spawn(10, 10, makeSpec(), 'enemy', rng()) as Bullet;
    const timed = system.spawn(20, 10, makeSpec({ timeline }), 'enemy', rng()) as Bullet;

    expect(plain.hasTimeline).toBe(false);
    expect(timed.hasTimeline).toBe(true);
  });

  test('bullets are appended in spawn order', () => {
    const system = makeSystem();
    const all = [0, 1, 2].map(
      (i) => system.spawn(10 * i, 10, makeSpec(), 'enemy', rng()) as Bullet,
    );

    expect(slots(system.bullets, all)).toEqual([0, 1, 2]);
  });
});

describe('step: motion', () => {
  test('speed is pixels per tick — one tick moves exactly r pixels', () => {
    const system = makeSystem();
    const bullet = system.spawn(
      100,
      100,
      makeSpec({ motion: { r: 3, theta: 0 } }),
      'enemy',
      rng(),
    ) as Bullet;

    system.step(0, 0, rng());
    expect(bullet.x).toBeCloseTo(103, 9);

    stepTimes(system, 9);
    expect(bullet.x).toBeCloseTo(130, 9);
    expect(bullet.age).toBe(10);
  });

  test('theta 90 moves down — the field is y-down screen space', () => {
    const system = makeSystem();
    const bullet = system.spawn(
      100,
      100,
      makeSpec({ motion: { r: 5, theta: 90 } }),
      'enemy',
      rng(),
    ) as Bullet;

    stepTimes(system, 4);
    expect(bullet.y).toBeCloseTo(120, 9);
    expect(bullet.x).toBeCloseTo(100, 9);
  });

  test('age increments once per step', () => {
    const system = makeSystem();
    const bullet = system.spawn(100, 100, makeSpec(), 'enemy', rng()) as Bullet;

    for (let i = 1; i <= 5; i++) {
      system.step(0, 0, rng());
      expect(bullet.age).toBe(i);
    }
  });

  test('orientToHeading writes the heading into angle, in radians', () => {
    const system = makeSystem();
    const bullet = system.spawn(
      100,
      100,
      makeSpec({
        style: { sprite: 'needle', orientToHeading: true },
        motion: { r: 1, theta: 180 },
      }),
      'enemy',
      rng(),
    ) as Bullet;

    system.step(0, 0, rng());
    expect(bullet.angle).toBeCloseTo(Math.PI, 9);
  });

  test('spin advances angle by a constant every tick', () => {
    const system = makeSystem();
    const bullet = system.spawn(
      100,
      100,
      makeSpec({ style: { sprite: 'orb.small', spin: 0.25 } }),
      'enemy',
      rng(),
    ) as Bullet;

    stepTimes(system, 4);
    expect(bullet.angle).toBeCloseTo(1, 9);
  });

  test('orientToHeading wins over spin when a style sets both', () => {
    const system = makeSystem();
    const bullet = system.spawn(
      100,
      100,
      makeSpec({
        style: { sprite: 'needle', orientToHeading: true, spin: 0.25 },
        motion: { r: 1, theta: 180 },
      }),
      'enemy',
      rng(),
    ) as Bullet;

    stepTimes(system, 4);
    // Locked to the heading, not 4 * 0.25 accumulated on top of it.
    expect(bullet.angle).toBeCloseTo(Math.PI, 9);
  });

  test('orientToHeading tracks a turning bullet every tick', () => {
    const system = makeSystem();
    const bullet = system.spawn(
      240,
      240,
      makeSpec({
        style: { sprite: 'needle', orientToHeading: true },
        motion: { r: 1, theta: 0, w: 10 },
      }),
      'enemy',
      rng(),
    ) as Bullet;

    for (let tick = 1; tick <= 6; tick++) {
      system.step(0, 0, rng());
      expect(bullet.angle).toBeCloseTo((tick * 10 * Math.PI) / 180, 9);
    }
  });

  test('a plain style leaves angle alone', () => {
    const system = makeSystem();
    const bullet = system.spawn(
      100,
      100,
      makeSpec({ motion: { r: 2, theta: 45 } }),
      'enemy',
      rng(),
    ) as Bullet;

    stepTimes(system, 5);
    expect(bullet.angle).toBe(0);
  });

  test('the motion context carries the pre-move position, age and target', () => {
    const seen: MotionContext[] = [];
    defineBehaviour('bullet.test.recordContext', (_vector, context) => {
      seen.push({ ...context });
    });

    const system = makeSystem();
    const bullet = system.spawn(
      100,
      140,
      makeSpec({ motion: { r: 6, theta: 90, behaviour: 'bullet.test.recordContext' } }),
      'enemy',
      rng(),
    ) as Bullet;

    system.step(11, 22, rng());
    system.step(11, 22, rng());

    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual({ age: 0, x: 100, y: 140, targetX: 11, targetY: 22 });
    expect(seen[1]?.age).toBe(1);
    expect(seen[1]?.y).toBeCloseTo(146, 9);
    expect(bullet.y).toBeCloseTo(152, 9);
  });
});

describe('expiry', () => {
  test('a bullet expires once its life has elapsed', () => {
    const system = makeSystem();
    const bullet = system.spawn(100, 100, makeSpec({ life: 3 }), 'enemy', rng()) as Bullet;

    stepTimes(system, 2);
    expect(system.count).toBe(1);
    expect(bullet.alive).toBe(true);

    system.step(0, 0, rng());
    expect(system.count).toBe(0);
    expect(bullet.alive).toBe(false);
  });

  test('life 0 means the bullet only ever leaves by going offscreen', () => {
    const system = makeSystem();
    system.spawn(100, 100, makeSpec({ life: 0 }), 'enemy', rng());

    stepTimes(system, 500);
    expect(system.count).toBe(1);
  });

  test('a bullet despawns past the bottom margin', () => {
    const system = makeSystem();
    system.spawn(240, 460, makeSpec({ motion: { r: 10, theta: 90 } }), 'enemy', rng());

    stepTimes(system, 4);
    expect(system.count).toBe(1);

    stepTimes(system, 3);
    expect(system.count).toBe(0);
  });

  test('the margin is exclusive — a bullet exactly on it survives one more tick', () => {
    const system = makeSystem();
    const bullet = system.spawn(
      240,
      502,
      makeSpec({ motion: { r: 10, theta: 90 } }),
      'enemy',
      rng(),
    ) as Bullet;

    system.step(0, 0, rng());
    expect(bullet.y).toBeCloseTo(FIELD.height + FIELD.margin, 9);
    expect(system.count).toBe(1);

    system.step(0, 0, rng());
    expect(system.count).toBe(0);
  });

  test('bullets despawn past every edge, and the margin lets them arc back in', () => {
    const cases: Array<{ x: number; y: number; theta: number }> = [
      { x: 240, y: 20, theta: 270 },
      { x: 20, y: 240, theta: 180 },
      { x: 460, y: 240, theta: 0 },
      { x: 240, y: 460, theta: 90 },
    ];

    for (const { x, y, theta } of cases) {
      const system = makeSystem();
      const bullet = system.spawn(
        x,
        y,
        makeSpec({ motion: { r: 8, theta } }),
        'enemy',
        rng(),
      ) as Bullet;

      // Still alive just outside the field — that is what the margin buys.
      stepTimes(system, 4);
      expect(system.count).toBe(1);
      expect(bullet.alive).toBe(true);

      stepTimes(system, 12);
      expect(system.count).toBe(0);
      expect(bullet.alive).toBe(false);
    }
  });

  test('an expired bullet is dropped from the list and marked dead', () => {
    const system = makeSystem();
    const doomed = system.spawn(100, 100, makeSpec({ life: 1 }), 'enemy', rng()) as Bullet;
    const survivor = system.spawn(120, 100, makeSpec(), 'enemy', rng()) as Bullet;

    system.step(0, 0, rng());

    expect(doomed.alive).toBe(false);
    expect(survivor.alive).toBe(true);
    expect(system.bullets).not.toContain(doomed);
    expect(system.bullets).toContain(survivor);
  });
});

describe('pool reuse', () => {
  test('a despawned slot is reused instead of allocating a new bullet', () => {
    const system = makeSystem({ initial: 1, max: 1 });
    const first = system.spawn(100, 100, makeSpec({ life: 1 }), 'enemy', rng()) as Bullet;

    system.step(0, 0, rng());
    expect(system.count).toBe(0);

    const second = system.spawn(200, 200, makeSpec(), 'enemy', rng());
    expect(second).toBe(first);
    expect(system.poolSize).toBe(1);
    expect(system.poolGrowth).toBe(0);
  });

  test('a reused slot carries no age, reflectCount or timeline from its last life', () => {
    const system = new BulletSystem({ bounds: SMALL, initial: 1, max: 1 });
    const timeline: MotionSegment[] = [{ count: 2, motion: { r: 1, theta: 270 } }];
    const first = system.spawn(
      20,
      20,
      makeSpec({ motion: { r: 5, theta: 180 }, bounce: true, timeline, life: 6 }),
      'player',
      rng(),
    ) as Bullet;

    stepTimes(system, 6);
    expect(system.count).toBe(0);
    expect(first.age).toBeGreaterThan(0);

    const second = system.spawn(30, 30, makeSpec(), 'enemy', rng()) as Bullet;
    expect(second).toBe(first);
    expect(second.age).toBe(0);
    expect(second.angle).toBe(0);
    expect(second.vector.reflectCount).toBe(0);
    expect(second.hasTimeline).toBe(false);
    expect(second.bounce).toBe(false);
    expect(second.alive).toBe(true);
    expect(second.faction).toBe('enemy');
    expect(second.x).toBe(30);
    expect(second.y).toBe(30);
  });

  test('a reused slot re-reads life and damage rather than inheriting them', () => {
    const system = makeSystem({ initial: 1, max: 1 });
    const first = system.spawn(
      100,
      100,
      makeSpec({ life: 1, damage: 9, radius: 12 }),
      'enemy',
      rng(),
    ) as Bullet;
    system.step(0, 0, rng());

    const second = system.spawn(100, 100, makeSpec(), 'enemy', rng()) as Bullet;
    expect(second).toBe(first);
    expect(second.life).toBe(0);
    expect(second.damage).toBe(1);
    expect(second.radius).toBe(3);
  });

  test('a long spawn/despawn cycle never grows the pool', () => {
    const system = makeSystem({ initial: 4, max: 4 });

    for (let i = 0; i < 400; i++) {
      expect(system.spawn(100, 100, makeSpec({ life: 1 }), 'enemy', rng())).toBeDefined();
      system.step(0, 0, rng());
    }

    expect(system.poolSize).toBe(4);
    expect(system.poolGrowth).toBe(0);
    expect(system.droppedSpawns).toBe(0);
  });

  test('clear empties the list, kills the bullets and returns them to the pool', () => {
    const system = makeSystem({ initial: 3, max: 3 });
    const all = [0, 1, 2].map(
      (i) => system.spawn(10 * i, 10, makeSpec(), 'enemy', rng()) as Bullet,
    );

    system.clear();

    expect(system.count).toBe(0);
    expect(system.bullets).toHaveLength(0);
    for (const b of all) expect(b.alive).toBe(false);

    // All three slots are free again, so three more spawns must succeed.
    for (let i = 0; i < 3; i++) {
      expect(system.spawn(10, 10, makeSpec(), 'enemy', rng())).toBeDefined();
    }
    expect(system.poolSize).toBe(3);
    expect(system.droppedSpawns).toBe(0);
  });

  test('the pool grows rather than refusing when initial is too small', () => {
    const system = makeSystem({ initial: 2 });

    for (let i = 0; i < 40; i++) system.spawn(100, 100, makeSpec(), 'enemy', rng());

    expect(system.count).toBe(40);
    expect(system.droppedSpawns).toBe(0);
    expect(system.poolGrowth).toBeGreaterThan(0);
    expect(new Set(system.bullets).size).toBe(40);
  });
});

describe('timeline gating', () => {
  test('a bullet with a timeline switches motion when a segment falls due', () => {
    const system = makeSystem();
    const timeline: MotionSegment[] = [{ count: 2, motion: { r: 4, theta: 0 } }];
    const bullet = system.spawn(
      100,
      100,
      makeSpec({ motion: { r: 0, theta: 90 }, timeline }),
      'enemy',
      rng(),
    ) as Bullet;

    stepTimes(system, 2);
    expect(bullet.x).toBeCloseTo(100, 9);

    system.step(0, 0, rng());
    expect(bullet.vector.r).toBe(4);
    expect(bullet.x).toBeCloseTo(104, 9);
  });

  test('the timeline is applied before the move, so a due segment counts this tick', () => {
    const system = makeSystem();
    const timeline: MotionSegment[] = [{ count: 0, motion: { r: 7, theta: 0 } }];
    const bullet = system.spawn(
      100,
      100,
      makeSpec({ motion: { r: 0, theta: 90 }, timeline }),
      'enemy',
      rng(),
    ) as Bullet;

    system.step(0, 0, rng());
    expect(bullet.x).toBeCloseTo(107, 9);
  });

  test('a bullet without a timeline never advances a stale one left in its slot', () => {
    // The gate is `hasTimeline`. If it were ever unconditionally true, the
    // reused slot below would resume the previous bullet's timeline and fly
    // upward on its second tick instead of falling.
    const system = makeSystem({ initial: 1, max: 1 });
    const timeline: MotionSegment[] = [{ count: 2, motion: { r: 12, theta: 270 } }];
    const first = system.spawn(
      100,
      100,
      makeSpec({ motion: { r: 0 }, timeline, life: 1 }),
      'enemy',
      rng(),
    ) as Bullet;

    system.step(0, 0, rng());
    expect(system.count).toBe(0);

    const second = system.spawn(
      100,
      100,
      makeSpec({ motion: { r: 2, theta: 90 } }),
      'enemy',
      rng(),
    ) as Bullet;
    expect(second).toBe(first);
    expect(second.hasTimeline).toBe(false);

    stepTimes(system, 3);
    expect(second.vector.r).toBe(2);
    expect(second.vector.theta).toBe(90);
    expect(second.y).toBeCloseTo(106, 9);
  });

  test('a timeline is rewound for each new life in the same slot', () => {
    const system = makeSystem({ initial: 1, max: 1 });
    const timeline: MotionSegment[] = [{ count: 1, motion: { r: 3, theta: 0 } }];
    const spec = makeSpec({ motion: { r: 0, theta: 90 }, timeline, life: 2 });

    const first = system.spawn(100, 100, spec, 'enemy', rng()) as Bullet;
    stepTimes(system, 2);
    expect(first.x).toBeCloseTo(103, 9);

    const second = system.spawn(100, 100, spec, 'enemy', rng()) as Bullet;
    expect(second).toBe(first);

    // Rewound: the segment falls due on the second tick again, not immediately.
    system.step(0, 0, rng());
    expect(second.x).toBeCloseTo(100, 9);
    system.step(0, 0, rng());
    expect(second.x).toBeCloseTo(103, 9);
  });

  test('a looping timeline keeps re-applying its segments', () => {
    const system = makeSystem();
    const timeline: MotionSegment[] = [
      { count: 0, motion: { r: 2, theta: 0 } },
      { count: 2, motion: { r: 2, theta: 90 } },
      { count: 4, jump: 0 },
    ];
    const bullet = system.spawn(
      100,
      100,
      makeSpec({ timeline }),
      'enemy',
      rng(),
    ) as Bullet;

    stepTimes(system, 2);
    expect(bullet.x).toBeCloseTo(104, 9);

    stepTimes(system, 2);
    expect(bullet.y).toBeCloseTo(104, 9);

    // The jump returns to segment 0, so it heads right again.
    stepTimes(system, 2);
    expect(bullet.x).toBeCloseTo(108, 9);
  });
});

describe('bouncing', () => {
  test('bounce reflects off a wall instead of despawning', () => {
    const system = new BulletSystem({ bounds: SMALL, initial: 8 });
    const bullet = system.spawn(
      20,
      20,
      makeSpec({ motion: { r: 5, theta: 180 }, bounce: true }),
      'enemy',
      rng(),
    ) as Bullet;

    stepTimes(system, 4);

    expect(system.count).toBe(1);
    expect(bullet.alive).toBe(true);
    expect(bullet.x).toBe(bullet.radius);
    expect(bullet.vector.reflectCount).toBe(1);

    // Heading flipped: it now travels back into the field.
    system.step(0, 0, rng());
    expect(bullet.x).toBeCloseTo(8, 9);
  });

  test('the same trajectory without bounce despawns instead', () => {
    const system = new BulletSystem({ bounds: SMALL, initial: 8 });
    system.spawn(20, 20, makeSpec({ motion: { r: 5, theta: 180 } }), 'enemy', rng());

    stepTimes(system, 8);
    expect(system.count).toBe(0);
  });

  test('a corner bounce reflects on both axes in one tick', () => {
    const system = new BulletSystem({ bounds: SMALL, initial: 8 });
    const bullet = system.spawn(
      10,
      10,
      makeSpec({ motion: { r: 5, theta: 225 }, bounce: true }),
      'enemy',
      rng(),
    ) as Bullet;

    stepTimes(system, 2);

    expect(bullet.x).toBe(bullet.radius);
    expect(bullet.y).toBe(bullet.radius);
    expect(bullet.vector.reflectCount).toBe(2);

    // Both components flipped, so it now moves down and to the right.
    system.step(0, 0, rng());
    expect(bullet.x).toBeGreaterThan(bullet.radius);
    expect(bullet.y).toBeGreaterThan(bullet.radius);
  });

  test('bouncing off the top and bottom flips the vertical heading', () => {
    const system = new BulletSystem({ bounds: SMALL, initial: 8 });
    const bullet = system.spawn(
      20,
      20,
      makeSpec({ motion: { r: 5, theta: 270 }, bounce: true }),
      'enemy',
      rng(),
    ) as Bullet;

    stepTimes(system, 4);
    expect(bullet.y).toBe(bullet.radius);
    expect(bullet.vector.reflectCount).toBe(1);

    system.step(0, 0, rng());
    expect(bullet.y).toBeCloseTo(8, 9);
  });

  test('a bouncing bullet stays inside the field indefinitely without maxBounces', () => {
    const system = new BulletSystem({ bounds: SMALL, initial: 8 });
    const bullet = system.spawn(
      20,
      20,
      makeSpec({ motion: { r: 5, theta: 200 }, bounce: true }),
      'enemy',
      rng(),
    ) as Bullet;

    for (let i = 0; i < 500; i++) {
      system.step(0, 0, rng());
      expect(bullet.x).toBeGreaterThanOrEqual(bullet.radius - 1e-9);
      expect(bullet.x).toBeLessThanOrEqual(SMALL.width - bullet.radius + 1e-9);
      expect(bullet.y).toBeGreaterThanOrEqual(bullet.radius - 1e-9);
      expect(bullet.y).toBeLessThanOrEqual(SMALL.height - bullet.radius + 1e-9);
    }

    expect(system.count).toBe(1);
    expect(bullet.vector.reflectCount).toBeGreaterThan(10);
  });

  test('maxBounces despawns the bullet on the bounce past its allowance', () => {
    const system = new BulletSystem({ bounds: SMALL, initial: 8 });
    const bullet = system.spawn(
      20,
      20,
      makeSpec({ motion: { r: 5, theta: 180 }, bounce: true, maxBounces: 1 }),
      'enemy',
      rng(),
    ) as Bullet;

    // It survives its allowed bounce.
    stepTimes(system, 4);
    expect(system.count).toBe(1);
    expect(bullet.vector.reflectCount).toBe(1);

    // And dies on the next one rather than reflecting again.
    stepTimes(system, 7);
    expect(system.count).toBe(0);
    expect(bullet.alive).toBe(false);
    expect(bullet.vector.reflectCount).toBe(2);
  });

  test('a larger maxBounces allows proportionally more bounces', () => {
    const bouncesBeforeDeath = (maxBounces: number): number => {
      const system = new BulletSystem({ bounds: SMALL, initial: 8 });
      const bullet = system.spawn(
        20,
        20,
        makeSpec({ motion: { r: 5, theta: 180 }, bounce: true, maxBounces }),
        'enemy',
        rng(),
      ) as Bullet;

      for (let i = 0; i < 1000 && system.count > 0; i++) system.step(0, 0, rng());
      expect(system.count).toBe(0);
      return bullet.vector.reflectCount;
    };

    expect(bouncesBeforeDeath(1)).toBe(2);
    expect(bouncesBeforeDeath(3)).toBe(4);
    expect(bouncesBeforeDeath(6)).toBe(7);
  });

  test('the bounce allowance survives a timeline changing the motion', () => {
    // The allowance belongs to the bullet. Counting it on the vector instead
    // lets every segment re-init refill it, and the bullet never dies —
    // a pattern that quietly leaks bullets until the pool is exhausted.
    const system = new BulletSystem({ bounds: SMALL, initial: 8 });
    const timeline: MotionSegment[] = [
      { count: 5, motion: { r: 5, theta: 180 } },
      { count: 5, jump: 0 },
    ];
    const bullet = system.spawn(
      20,
      20,
      makeSpec({ motion: { r: 5, theta: 180 }, timeline, bounce: true, maxBounces: 1 }),
      'enemy',
      rng(),
    ) as Bullet;

    for (let i = 0; i < 400 && system.count > 0; i++) system.step(0, 0, rng());

    expect(system.count).toBe(0);
    expect(bullet.alive).toBe(false);
    expect(bullet.bounceCount).toBe(2);
  });

  test('bounceCount counts wall contacts and resets with the slot', () => {
    const system = new BulletSystem({ bounds: SMALL, initial: 1, max: 1 });
    const first = system.spawn(
      20,
      20,
      makeSpec({ motion: { r: 5, theta: 180 }, bounce: true, life: 12 }),
      'enemy',
      rng(),
    ) as Bullet;

    stepTimes(system, 12);
    expect(first.bounceCount).toBeGreaterThan(0);

    const second = system.spawn(20, 20, makeSpec(), 'enemy', rng()) as Bullet;
    expect(second).toBe(first);
    expect(second.bounceCount).toBe(0);
  });

  test('a corner bounce counts as two', () => {
    const system = new BulletSystem({ bounds: SMALL, initial: 8 });
    const bullet = system.spawn(
      10,
      10,
      makeSpec({ motion: { r: 5, theta: 225 }, bounce: true }),
      'enemy',
      rng(),
    ) as Bullet;

    stepTimes(system, 2);
    expect(bullet.bounceCount).toBe(2);
  });

  test('gravity drift reverses with the bounce that caused it', () => {
    // reflectY flips driftY too; if it did not, a falling bullet would stick
    // to the floor, bouncing every tick forever.
    const system = new BulletSystem({ bounds: SMALL, initial: 8 });
    const bullet = system.spawn(
      20,
      4,
      makeSpec({ motion: { r: 0, theta: 90, gravity: { y: 0.5 } }, bounce: true }),
      'enemy',
      rng(),
    ) as Bullet;

    let ticksAtFloor = 0;
    for (let i = 0; i < 40; i++) {
      system.step(0, 0, rng());
      if (bullet.y >= SMALL.height - bullet.radius - 1e-9) ticksAtFloor++;
    }

    expect(bullet.bounceCount).toBeGreaterThan(0);
    // It leaves the floor again rather than grinding along it.
    expect(ticksAtFloor).toBeLessThan(20);
    expect(bullet.vector.driftY).toBeLessThan(0.5 * 40);
  });

  test('maxBounces on a non-bouncing bullet does not keep it alive', () => {
    const system = new BulletSystem({ bounds: SMALL, initial: 8 });
    system.spawn(
      20,
      20,
      makeSpec({ motion: { r: 5, theta: 180 }, maxBounces: 5 }),
      'enemy',
      rng(),
    );

    stepTimes(system, 8);
    expect(system.count).toBe(0);
  });
});

describe('spawnAimed', () => {
  test('points the bullet at the target', () => {
    const system = makeSystem();
    const cases: Array<[number, number, number]> = [
      [100, 200, 90],
      [200, 100, 0],
      [0, 100, 180],
      [100, 0, -90],
      [200, 200, 45],
    ];

    for (const [targetX, targetY, theta] of cases) {
      const bullet = system.spawnAimed(
        100,
        100,
        targetX,
        targetY,
        makeSpec({ motion: { r: 3, theta: 999 } }),
        'enemy',
        rng(),
      ) as Bullet;
      expect(bullet.vector.theta).toBeCloseTo(theta, 9);
    }
  });

  test('aim overrides the spec heading but preserves its speed', () => {
    const system = makeSystem();
    const bullet = system.spawnAimed(
      100,
      100,
      100,
      300,
      makeSpec({ motion: { r: 6, theta: 270 } }),
      'enemy',
      rng(),
    ) as Bullet;

    expect(bullet.vector.r).toBe(6);
    expect(bullet.vector.theta).toBeCloseTo(90, 9);
  });

  test('the aimed bullet travels straight at the target', () => {
    const system = makeSystem();
    const [fromX, fromY, toX, toY] = [100, 100, 300, 260];
    const bullet = system.spawnAimed(
      fromX,
      fromY,
      toX,
      toY,
      makeSpec({ motion: { r: 10 } }),
      'enemy',
      rng(),
    ) as Bullet;

    stepTimes(system, 10);

    const travelled = Math.hypot(bullet.x - fromX, bullet.y - fromY);
    expect(travelled).toBeCloseTo(100, 6);

    // Zero cross product: the bullet never left the line to the target.
    const cross = (toX - fromX) * (bullet.y - fromY) - (toY - fromY) * (bullet.x - fromX);
    expect(cross).toBeCloseTo(0, 6);

    const remaining = Math.hypot(toX - bullet.x, toY - bullet.y);
    expect(remaining).toBeCloseTo(Math.hypot(toX - fromX, toY - fromY) - 100, 6);
  });

  test('aiming at the spawn point itself does not produce a NaN heading', () => {
    const system = makeSystem();
    const bullet = system.spawnAimed(
      100,
      100,
      100,
      100,
      makeSpec({ motion: { r: 4 } }),
      'enemy',
      rng(),
    ) as Bullet;

    expect(Number.isNaN(bullet.vector.theta)).toBe(false);
    system.step(0, 0, rng());
    expect(Number.isNaN(bullet.x)).toBe(false);
    expect(Number.isNaN(bullet.y)).toBe(false);
  });

  test('a timeline segment due on tick 0 overrides the aim', () => {
    // Documented, not accidental: BulletSpec says a timeline overrides
    // `motion`, and the aim is written into the same vector. Pinning it so
    // that a pattern author combining the two sees a stable rule.
    const system = makeSystem();
    const timeline: MotionSegment[] = [{ count: 0, motion: { r: 3, theta: 270 } }];
    const bullet = system.spawnAimed(
      240,
      240,
      240,
      480,
      makeSpec({ motion: { r: 3, theta: 0 }, timeline }),
      'enemy',
      rng(),
    ) as Bullet;

    expect(bullet.vector.theta).toBeCloseTo(90, 9);

    system.step(240, 480, rng());
    expect(bullet.vector.theta).toBe(270);
    expect(bullet.y).toBeCloseTo(237, 9);
  });

  test('a timeline segment due later leaves the aim intact until then', () => {
    const system = makeSystem();
    const timeline: MotionSegment[] = [{ count: 3, motion: { r: 3, theta: 270 } }];
    const bullet = system.spawnAimed(
      240,
      240,
      240,
      480,
      makeSpec({ motion: { r: 3, theta: 0 }, timeline }),
      'enemy',
      rng(),
    ) as Bullet;

    stepTimes(system, 3);
    expect(bullet.vector.theta).toBeCloseTo(90, 9);
    expect(bullet.y).toBeCloseTo(249, 9);
  });

  test('it drops gracefully when the pool is at its ceiling', () => {
    const system = makeSystem({ initial: 1, max: 1 });
    system.spawn(100, 100, makeSpec(), 'enemy', rng());

    expect(() =>
      system.spawnAimed(100, 100, 200, 200, makeSpec(), 'enemy', rng()),
    ).not.toThrow();
    expect(system.spawnAimed(100, 100, 200, 200, makeSpec(), 'enemy', rng())).toBeUndefined();
    expect(system.droppedSpawns).toBe(2);
  });
});

describe('hitTest', () => {
  test('finds a bullet of the requested faction overlapping the circle', () => {
    const system = makeSystem();
    const bullet = system.spawn(200, 200, makeSpec(), 'enemy', rng()) as Bullet;

    expect(system.hitTest(200, 200, 4, 'enemy')).toBe(bullet);
  });

  test('never returns a bullet of the other faction', () => {
    const system = makeSystem();
    const enemy = system.spawn(200, 200, makeSpec(), 'enemy', rng()) as Bullet;
    const player = system.spawn(200, 200, makeSpec(), 'player', rng()) as Bullet;

    expect(system.hitTest(200, 200, 4, 'enemy')).toBe(enemy);
    expect(system.hitTest(200, 200, 4, 'player')).toBe(player);
  });

  test('a field full of enemy fire is invisible to a player-faction query', () => {
    const system = makeSystem();
    for (let i = 0; i < 50; i++) {
      system.spawn(10 + i * 8, 200, makeSpec(), 'enemy', rng());
    }

    for (let i = 0; i < 50; i++) {
      expect(system.hitTest(10 + i * 8, 200, 6, 'player')).toBeUndefined();
    }
  });

  test('returns undefined when nothing is in range', () => {
    const system = makeSystem();
    system.spawn(50, 50, makeSpec(), 'enemy', rng());

    expect(system.hitTest(400, 400, 5, 'enemy')).toBeUndefined();
  });

  test('the test is against the sum of the radii', () => {
    const system = makeSystem();
    system.spawn(108, 100, makeSpec({ radius: 3 }), 'enemy', rng());

    expect(system.hitTest(100, 100, 5, 'enemy')).toBeDefined();
    expect(system.hitTest(100, 100, 4.9, 'enemy')).toBeUndefined();
  });

  test('finds bullets anywhere in the field, not only near the origin', () => {
    const system = makeSystem();
    const places: Array<[number, number]> = [
      [8, 8],
      [140, 60],
      [240, 240],
      [470, 12],
      [12, 470],
      [470, 470],
    ];
    const all = places.map(
      ([x, y]) => system.spawn(x, y, makeSpec(), 'enemy', rng()) as Bullet,
    );

    places.forEach(([x, y], i) => {
      expect(system.hitTest(x, y, 2, 'enemy')).toBe(all[i] as Bullet);
    });
  });

  test('a despawned bullet is no longer found', () => {
    const system = makeSystem();
    system.spawn(200, 200, makeSpec({ life: 1 }), 'enemy', rng());
    expect(system.hitTest(200, 200, 4, 'enemy')).toBeDefined();

    system.step(0, 0, rng());
    expect(system.hitTest(200, 200, 4, 'enemy')).toBeUndefined();
  });

  test('nothing is found after clear', () => {
    const system = makeSystem();
    system.spawn(200, 200, makeSpec(), 'enemy', rng());
    system.clear();

    expect(system.hitTest(200, 200, 8, 'enemy')).toBeUndefined();
  });

  test('hitTest does not disturb the live list', () => {
    const system = makeSystem();
    const all = [0, 1, 2].map(
      (i) => system.spawn(100 + i * 20, 200, makeSpec(), 'enemy', rng()) as Bullet,
    );

    system.hitTest(120, 200, 5, 'enemy');
    system.hitTest(400, 400, 5, 'player');

    expect(slots(system.bullets, all)).toEqual([0, 1, 2]);
    for (const b of all) expect(b.alive).toBe(true);
  });

  /**
   * The broad phase may only ever add candidates, never hide one. Asserting
   * that a returned hit is genuine is not enough — an implementation that
   * always returned undefined would satisfy it. Every case below compares
   * against a brute-force scan of the live list in both directions.
   */
  const bruteForce = (
    system: BulletSystem,
    x: number,
    y: number,
    radius: number,
    faction: 'player' | 'enemy',
  ): Bullet[] =>
    system.bullets.filter(
      (b) =>
        b.faction === faction && circlesOverlap(x, y, radius, b.x, b.y, b.radius),
    );

  test('a dense field agrees with a brute-force scan on every probe', () => {
    const system = makeSystem();
    const r = rng(99);
    for (let i = 0; i < 600; i++) {
      system.spawn(r.range(0, 480), r.range(0, 480), makeSpec({ radius: 3 }), 'enemy', r);
    }

    let found = 0;
    for (let i = 0; i < 400; i++) {
      const x = r.range(0, 480);
      const y = r.range(0, 480);
      const hit = system.hitTest(x, y, 6, 'enemy');
      const expected = bruteForce(system, x, y, 6, 'enemy');

      expect(hit === undefined).toBe(expected.length === 0);
      if (hit !== undefined) {
        found++;
        expect(expected).toContain(hit);
        expect(hit.faction).toBe('enemy');
      }
    }

    // Guards the assertions above against passing vacuously.
    expect(found).toBeGreaterThan(20);
  });

  test('a bullet larger than a grid cell is still found', () => {
    // The broad phase indexes centres. With a fixed reach, a bullet this size
    // overlaps the query circle while its centre sits in an unvisited cell —
    // the "large laser misses a small hitbox" bug collision.ts exists to avoid.
    const system = makeSystem();
    const big = system.spawn(240, 240, makeSpec({ radius: 80 }), 'enemy', rng()) as Bullet;

    expect(system.hitTest(240, 315, 2, 'enemy')).toBe(big);
    expect(system.hitTest(315, 240, 2, 'enemy')).toBe(big);
    expect(system.hitTest(240, 165, 2, 'enemy')).toBe(big);
    expect(system.hitTest(165, 240, 2, 'enemy')).toBe(big);

    // Just past the radius sum it must still miss — reach is not a free pass.
    expect(system.hitTest(240, 323, 2, 'enemy')).toBeUndefined();
  });

  test('mixed radii agree with brute force regardless of cell size', () => {
    for (const cellSize of [8, 32, 128]) {
      const system = new BulletSystem({ bounds: FIELD, initial: 64, cellSize });
      const r = rng(7);
      for (let i = 0; i < 200; i++) {
        const radius = [2, 3, 12, 40, 90][i % 5] as number;
        system.spawn(r.range(0, 480), r.range(0, 480), makeSpec({ radius }), 'enemy', r);
      }

      let found = 0;
      for (let i = 0; i < 200; i++) {
        const x = r.range(0, 480);
        const y = r.range(0, 480);
        const hit = system.hitTest(x, y, 4, 'enemy');
        const expected = bruteForce(system, x, y, 4, 'enemy');

        expect(hit === undefined).toBe(expected.length === 0);
        if (hit !== undefined) {
          found++;
          expect(expected).toContain(hit);
        }
      }
      expect(found).toBeGreaterThan(20);
    }
  });
});

describe('droppedSpawns', () => {
  test('starts at zero', () => {
    expect(makeSystem().droppedSpawns).toBe(0);
  });

  test('a refused spawn returns undefined and counts, rather than throwing', () => {
    const system = makeSystem({ initial: 2, max: 2 });
    system.spawn(10, 10, makeSpec(), 'enemy', rng());
    system.spawn(20, 10, makeSpec(), 'enemy', rng());

    expect(() => system.spawn(30, 10, makeSpec(), 'enemy', rng())).not.toThrow();
    expect(system.spawn(30, 10, makeSpec(), 'enemy', rng())).toBeUndefined();
    expect(system.droppedSpawns).toBe(2);
    expect(system.count).toBe(2);
  });

  test('refusal is repeatable and leaves the system usable', () => {
    const system = makeSystem({ initial: 1, max: 1 });
    const live = system.spawn(10, 10, makeSpec({ life: 1 }), 'enemy', rng()) as Bullet;

    for (let i = 0; i < 5; i++) {
      expect(system.spawn(10, 10, makeSpec(), 'enemy', rng())).toBeUndefined();
    }
    expect(system.droppedSpawns).toBe(5);

    system.step(0, 0, rng());
    const reused = system.spawn(10, 10, makeSpec(), 'enemy', rng());
    expect(reused).toBe(live);
    expect(system.droppedSpawns).toBe(5);
  });

  test('it does not count spawns that merely made the pool grow', () => {
    const system = makeSystem({ initial: 1 });
    for (let i = 0; i < 30; i++) system.spawn(10, 10, makeSpec(), 'enemy', rng());

    expect(system.count).toBe(30);
    expect(system.droppedSpawns).toBe(0);
  });
});

describe('compaction', () => {
  test('a bullet expiring mid-array neither skips nor duplicates its neighbours', () => {
    const system = makeSystem();
    const lives = [0, 1, 0, 1, 0];
    const all = lives.map(
      (life, i) => system.spawn(20 * i, 100, makeSpec({ life }), 'enemy', rng()) as Bullet,
    );

    system.step(0, 0, rng());

    expect(slots(system.bullets, all)).toEqual([0, 2, 4]);
    expect(new Set(system.bullets).size).toBe(3);
    // A skipped survivor would not have been stepped at all.
    for (const b of system.bullets) expect(b.age).toBe(1);
  });

  test('survivors keep their relative order across staggered expiries', () => {
    const system = makeSystem();
    const lives = [0, 3, 0, 1, 0, 2, 0];
    const all = lives.map(
      (life, i) => system.spawn(20 * i, 100, makeSpec({ life }), 'enemy', rng()) as Bullet,
    );

    system.step(0, 0, rng());
    expect(slots(system.bullets, all)).toEqual([0, 1, 2, 4, 5, 6]);

    system.step(0, 0, rng());
    expect(slots(system.bullets, all)).toEqual([0, 1, 2, 4, 6]);

    system.step(0, 0, rng());
    expect(slots(system.bullets, all)).toEqual([0, 2, 4, 6]);

    for (const b of system.bullets) expect(b.age).toBe(3);
    expect(new Set(system.bullets).size).toBe(4);
  });

  test('every bullet is stepped exactly once per tick, whoever dies around it', () => {
    const system = makeSystem();
    const r = rng(4242);
    const lives = Array.from({ length: 60 }, () => r.int(0, 6));
    const all = lives.map(
      (life, i) =>
        system.spawn(100, 100 + i * 0.01, makeSpec({ life }), 'enemy', r) as Bullet,
    );

    for (let tick = 1; tick <= 8; tick++) {
      system.step(0, 0, r);

      const expected = all
        .map((b, i) => ({ b, life: lives[i] as number }))
        .filter(({ life }) => life === 0 || life > tick)
        .map(({ b }) => all.indexOf(b));

      expect(slots(system.bullets, all)).toEqual(expected);
      expect(new Set(system.bullets).size).toBe(expected.length);
      for (const b of system.bullets) expect(b.age).toBe(tick);
    }
  });

  test('a mix of expiry causes — life, offscreen and bounce limits — compacts cleanly', () => {
    const system = new BulletSystem({ bounds: SMALL, initial: 32 });
    const byLife = system.spawn(20, 20, makeSpec({ life: 2 }), 'enemy', rng()) as Bullet;
    const offscreen = system.spawn(
      20,
      20,
      makeSpec({ motion: { r: 9, theta: 90 } }),
      'enemy',
      rng(),
    ) as Bullet;
    const bouncer = system.spawn(
      20,
      20,
      makeSpec({ motion: { r: 5, theta: 180 }, bounce: true, maxBounces: 1 }),
      'enemy',
      rng(),
    ) as Bullet;
    const survivor = system.spawn(20, 20, makeSpec(), 'enemy', rng()) as Bullet;
    const all = [byLife, offscreen, bouncer, survivor];

    for (let i = 0; i < 20; i++) {
      system.step(0, 0, rng());
      expect(new Set(system.bullets).size).toBe(system.count);
      for (const b of system.bullets) expect(b.alive).toBe(true);
    }

    expect(slots(system.bullets, all)).toEqual([3]);
    expect(byLife.alive).toBe(false);
    expect(offscreen.alive).toBe(false);
    expect(bouncer.alive).toBe(false);
    expect(survivor.age).toBe(20);
  });

  test('stepping an empty system is a no-op', () => {
    const system = makeSystem();
    expect(() => system.step(100, 100, rng())).not.toThrow();
    expect(system.count).toBe(0);
  });
});

describe('determinism', () => {
  /** Randomized motion, so the outcome depends on the generator. */
  const scattered = (): BulletSpec =>
    makeSpec({
      motion: {
        rrandom: { min: 1, max: 6 },
        trandom: { min: 0, max: 360 },
        wrandom: { min: 0, max: 4 },
      },
    });

  const run = (seed: number): string => {
    const r = new Random(seed);
    const system = makeSystem({ initial: 8 });
    const trace: number[] = [];

    for (let tick = 0; tick < 60; tick++) {
      if (tick % 3 === 0) system.spawn(240, 240, scattered(), 'enemy', r);
      system.step(240, 400, r);
      for (const b of system.bullets) trace.push(b.x, b.y, b.age);
    }
    return trace.map((n) => n.toFixed(9)).join(',');
  };

  test('same seed and same inputs produce an identical run', () => {
    expect(run(0xbeef)).toBe(run(0xbeef));
  });

  test('a different seed produces a different run', () => {
    expect(run(0xbeef)).not.toBe(run(0xf00d));
  });

  test('passing an explicit generator never touches the shared sim stream', () => {
    const before = sim.getState();
    const r = rng(7);
    const system = makeSystem({ initial: 8 });

    for (let tick = 0; tick < 30; tick++) {
      system.spawn(240, 240, scattered(), 'enemy', r);
      system.spawnAimed(240, 240, 100, 400, scattered(), 'player', r);
      system.step(240, 400, r);
      system.hitTest(240, 300, 6, 'enemy');
    }

    expect(sim.getState()).toEqual(before);
  });

  test('the simulation never draws from Math.random', () => {
    const real = Math.random;
    Math.random = () => {
      throw new Error('Math.random reached the simulation');
    };

    try {
      const r = rng(11);
      const system = new BulletSystem({ bounds: SMALL, initial: 8 });
      const timeline: MotionSegment[] = [
        { count: 2, motion: { rrandom: { min: 1, max: 4 }, theta: 200 } },
        { count: 4, jump: 0 },
      ];

      for (let tick = 0; tick < 50; tick++) {
        system.spawn(20, 20, scattered(), 'enemy', r);
        system.spawn(20, 20, makeSpec({ timeline, bounce: true, maxBounces: 2 }), 'player', r);
        system.spawnAimed(20, 20, 5, 35, scattered(), 'enemy', r);
        system.step(20, 30, r);
        system.hitTest(20, 20, 5, 'player');
      }
      expect(system.count).toBeGreaterThan(0);
    } finally {
      Math.random = real;
    }
  });

  test('a replayed spawn sequence lands on identical pool slots', () => {
    const identities = (): number[] => {
      const r = rng(5);
      const system = makeSystem({ initial: 4, max: 4 });
      const seen: Bullet[] = [];
      const order: number[] = [];

      for (let tick = 0; tick < 50; tick++) {
        const b = system.spawn(240, 240, makeSpec({ life: (tick % 3) + 1 }), 'enemy', r);
        if (b !== undefined) {
          if (!seen.includes(b)) seen.push(b);
          order.push(seen.indexOf(b));
        } else {
          order.push(-1);
        }
        system.step(240, 400, r);
      }
      return order;
    };

    expect(identities()).toEqual(identities());
  });
});

describe('accounting', () => {
  test('count tracks the live list', () => {
    const system = makeSystem();
    expect(system.count).toBe(0);

    for (let i = 0; i < 7; i++) system.spawn(100, 100, makeSpec({ life: 1 }), 'enemy', rng());
    expect(system.count).toBe(7);
    expect(system.count).toBe(system.bullets.length);

    system.step(0, 0, rng());
    expect(system.count).toBe(0);
  });

  test('poolSize reports allocation, not live bullets', () => {
    const system = makeSystem({ initial: 16 });
    expect(system.poolSize).toBe(16);

    system.spawn(100, 100, makeSpec(), 'enemy', rng());
    expect(system.poolSize).toBe(16);
    expect(system.count).toBe(1);
  });
});
