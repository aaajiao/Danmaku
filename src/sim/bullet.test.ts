import { describe, expect, test } from 'bun:test';
import { Random, sim } from '../core/random';
import { atan2Deg, deltaDeg } from '../core/trig';
import {
  Bullet,
  bulletHitsCircle,
  bulletReach,
  bulletShapeOverlaps,
  BulletSystem,
  type BulletSpec,
  type BulletSystemOptions,
  type FieldBounds,
  type LaserSpec,
  type MissileSpec,
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

  test('maxBounces despawns the bullet on its Nth bounce, not the N+1th', () => {
    const system = new BulletSystem({ bounds: SMALL, initial: 8 });
    const bullet = system.spawn(
      20,
      20,
      makeSpec({ motion: { r: 5, theta: 180 }, bounce: true, maxBounces: 1 }),
      'enemy',
      rng(),
    ) as Bullet;

    // Nothing has hit a wall yet.
    stepTimes(system, 3);
    expect(system.count).toBe(1);
    expect(bullet.vector.reflectCount).toBe(0);

    // maxBounces: 1 means exactly one bounce — it despawns on the same tick
    // that bounce happens, rather than reflecting once more first.
    system.step(0, 0, rng());
    expect(system.count).toBe(0);
    expect(bullet.alive).toBe(false);
    expect(bullet.vector.reflectCount).toBe(1);
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

    expect(bouncesBeforeDeath(1)).toBe(1);
    expect(bouncesBeforeDeath(3)).toBe(3);
    expect(bouncesBeforeDeath(6)).toBe(6);
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
    expect(bullet.bounceCount).toBe(1);
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

describe('lasers', () => {
  /** A beam pointing right (theta 0), so its tip is at x + length. */
  const beam = (laser: Partial<BulletSpec['laser'] & object> = {}): BulletSpec =>
    makeSpec({
      radius: 2,
      motion: { r: 0, theta: 0 },
      laser: { length: 100, ...laser },
    });

  test('a laser spawns at its declared length', () => {
    const system = makeSystem();
    const bullet = system.spawn(100, 100, beam(), 'enemy', rng()) as Bullet;

    expect(bullet.laser).toBeDefined();
    expect(bullet.length).toBe(100);
  });

  test('an ordinary bullet has no laser and zero length', () => {
    const system = makeSystem();
    const bullet = system.spawn(100, 100, makeSpec(), 'enemy', rng()) as Bullet;

    expect(bullet.laser).toBeUndefined();
    expect(bullet.length).toBe(0);
  });

  test('growth extends the beam by a constant every tick', () => {
    const system = makeSystem();
    const bullet = system.spawn(
      100,
      100,
      beam({ length: 20, growth: 15 }),
      'enemy',
      rng(),
    ) as Bullet;

    stepTimes(system, 4);
    expect(bullet.length).toBeCloseTo(80, 9);
  });

  test('growth stops at maxLength and never overshoots it', () => {
    const system = makeSystem();
    const bullet = system.spawn(
      100,
      100,
      beam({ length: 20, growth: 15, maxLength: 50 }),
      'enemy',
      rng(),
    ) as Bullet;

    stepTimes(system, 40);
    expect(bullet.length).toBe(50);
  });

  test('a laser with no growth keeps its spawn length', () => {
    const system = makeSystem();
    const bullet = system.spawn(100, 100, beam({ length: 60 }), 'enemy', rng()) as Bullet;

    stepTimes(system, 20);
    expect(bullet.length).toBe(60);
  });

  test('the muzzle is the origin — the beam extends along the heading', () => {
    // theta 90 is down, so a stationary beam at (100, 100) covers y 100..200
    // and nothing above it. Anchored at the centre instead it would reach up
    // to y = 50, which is the bug this pins.
    const system = makeSystem();
    system.spawn(
      100,
      100,
      makeSpec({ radius: 2, motion: { r: 0, theta: 90 }, laser: { length: 100 } }),
      'enemy',
      rng(),
    );

    expect(system.hitTest(100, 150, 1, 'enemy')).toBeDefined();
    expect(system.hitTest(100, 200, 1, 'enemy')).toBeDefined();
    expect(system.hitTest(100, 90, 1, 'enemy')).toBeUndefined();
  });

  test('the hitbox follows the whole segment, not a circle at the muzzle', () => {
    const system = makeSystem();
    const bullet = system.spawn(100, 100, beam({ length: 200 }), 'enemy', rng()) as Bullet;

    // Every point along it is lethal — standing inside a laser is not safety.
    for (let along = 0; along <= 200; along += 20) {
      expect(system.hitTest(100 + along, 100, 1, 'enemy')).toBe(bullet);
    }

    // Past the tip, and off to the side, it misses.
    expect(system.hitTest(304, 100, 1, 'enemy')).toBeUndefined();
    expect(system.hitTest(200, 104, 1, 'enemy')).toBeUndefined();
  });

  test('the segment test honours the sum of the radii, like the circle one', () => {
    const system = makeSystem();
    system.spawn(100, 100, beam({ length: 200 }), 'enemy', rng());

    // Bullet radius 2, so a probe of radius 3 reaches 5px off the axis.
    expect(system.hitTest(200, 105, 3, 'enemy')).toBeDefined();
    expect(system.hitTest(200, 105.01, 3, 'enemy')).toBeUndefined();
  });

  test('a beam only as long as it has grown cannot hit past its own tip', () => {
    const system = makeSystem();
    system.spawn(100, 100, beam({ length: 10, growth: 10 }), 'enemy', rng());

    expect(system.hitTest(160, 100, 1, 'enemy')).toBeUndefined();

    stepTimes(system, 6);
    expect(system.hitTest(160, 100, 1, 'enemy')).toBeDefined();
  });

  test('a diagonal beam is tested along its real heading', () => {
    const system = makeSystem();
    system.spawn(
      100,
      100,
      makeSpec({ radius: 2, motion: { r: 0, theta: 45 }, laser: { length: 200 } }),
      'enemy',
      rng(),
    );

    // A point on the 45° line, and one the same distance out but off it.
    expect(system.hitTest(170.71, 170.71, 1, 'enemy')).toBeDefined();
    expect(system.hitTest(170.71, 100, 1, 'enemy')).toBeUndefined();
  });

  describe('warmup', () => {
    test('a warming laser is not lethal and registers no hit', () => {
      const system = makeSystem();
      const bullet = system.spawn(
        100,
        100,
        beam({ length: 200, warmup: 4 }),
        'enemy',
        rng(),
      ) as Bullet;

      // It is on screen from the first tick — the telegraph has to be visible
      // to be a telegraph — but nothing along it can be hit.
      for (let tick = 0; tick < 4; tick++) {
        expect(bullet.lethal).toBe(false);
        expect(system.count).toBe(1);
        expect(system.hitTest(200, 100, 1, 'enemy')).toBeUndefined();
        system.step(0, 0, rng());
      }

      expect(bullet.lethal).toBe(true);
      expect(system.hitTest(200, 100, 1, 'enemy')).toBe(bullet);
    });

    test('warmup is counted in ticks, exactly', () => {
      const ticksUntilLethal = (warmup: number): number => {
        const system = makeSystem();
        const bullet = system.spawn(
          100,
          100,
          beam({ warmup }),
          'enemy',
          rng(),
        ) as Bullet;

        let ticks = 0;
        while (!bullet.lethal && ticks < 100) {
          system.step(0, 0, rng());
          ticks++;
        }
        return ticks;
      };

      expect(ticksUntilLethal(1)).toBe(1);
      expect(ticksUntilLethal(6)).toBe(6);
      expect(ticksUntilLethal(30)).toBe(30);
    });

    test('a laser without warmup is lethal on the tick it spawns', () => {
      const system = makeSystem();
      const bullet = system.spawn(100, 100, beam(), 'enemy', rng()) as Bullet;

      expect(bullet.lethal).toBe(true);
      expect(system.hitTest(180, 100, 1, 'enemy')).toBe(bullet);
    });

    test('a warming laser blocks nothing else from being found', () => {
      // The gate must skip the beam, not abandon the query — an orb sharing
      // the field stays lethal while the laser is still winding up.
      const system = makeSystem();
      system.spawn(100, 100, beam({ length: 200, warmup: 30 }), 'enemy', rng());
      const orb = system.spawn(200, 100, makeSpec({ radius: 4 }), 'enemy', rng()) as Bullet;

      expect(system.hitTest(200, 100, 1, 'enemy')).toBe(orb);
    });
  });

  describe('decay (cooldown)', () => {
    // The lethal flag at each age from spawn to the last on-field tick.
    // Index === age; the run stops the tick the beam is culled (age === life),
    // so the last recorded index is life − 1.
    const lethalByAge = (spec: BulletSpec): boolean[] => {
      const system = makeSystem({ initial: 1, max: 1 });
      const bullet = system.spawn(100, 100, spec, 'enemy', rng()) as Bullet;
      const seen: boolean[] = [bullet.lethal]; // age 0
      while (system.count > 0) {
        system.step(0, 0, rng());
        if (system.count > 0) seen.push(bullet.lethal);
      }
      return seen;
    };

    test('lethal spans exactly [warmup, life − cooldown) — telegraph then decay', () => {
      // warmup 3, cooldown 4, life 20: harmless 0..2, lethal 3..15, harmless
      // 16..19, then culled at age 20. The decay window is the telegraph's
      // mirror at the far end.
      const seen = lethalByAge({ ...beam({ warmup: 3, cooldown: 4 }), life: 20 });
      expect(seen.length).toBe(20);
      for (let age = 0; age < 20; age++) {
        expect(seen[age]).toBe(age >= 3 && age < 16);
      }
    });

    test('a decaying beam is still drawn but kills nothing', () => {
      const system = makeSystem();
      // No warmup, cooldown 5, life 12 → decay window is age ∈ [7, 12).
      system.spawn(100, 100, { ...beam({ length: 200, cooldown: 5 }), life: 12 }, 'enemy', rng());

      // Active early: the body kills.
      expect(system.hitTest(200, 100, 1, 'enemy')).toBeDefined();

      stepTimes(system, 8); // age 8, inside the decay window
      expect(system.count).toBe(1); // still on the field
      const b = system.bullets[0] as Bullet;
      expect(b.lethal).toBe(false); // but withdrawn
      expect(system.hitTest(200, 100, 1, 'enemy')).toBeUndefined();
    });

    test('a beam with no cooldown stays lethal to the tick it expires (byte-identical)', () => {
      // The guard the cooldown=0 trace-neutrality claim rests on: without it a
      // zero-width decay window would flip lethal false on the expiry tick.
      const system = makeSystem({ initial: 1, max: 1 });
      const b = system.spawn(100, 100, { ...beam({ warmup: 2 }), life: 6 }, 'enemy', rng()) as Bullet;
      stepTimes(system, 5); // age 5 — the last on-field tick
      expect(system.count).toBe(1);
      expect(b.lethal).toBe(true);
    });

    test('cooldown is ignored on an until-offscreen beam — it has no fixed end', () => {
      // `life` 0 means "until offscreen"; there is no end to measure a cooldown
      // back from, so a stationary beam stays lethal indefinitely.
      const system = makeSystem();
      const b = system.spawn(100, 100, beam({ cooldown: 10 }), 'enemy', rng()) as Bullet;
      stepTimes(system, 40);
      expect(b.lethal).toBe(true);
      expect(system.hitTest(180, 100, 1, 'enemy')).toBe(b);
    });

    test('a decaying beam draws no randomness of its own', () => {
      // The decay window is a subtraction and a comparison on the tick count —
      // the same arithmetic class as growth and warmup — so a field of decaying
      // beams must leave the stream exactly where a field of orbs would.
      const consume = (withLaser: boolean): unknown => {
        const r = rng(88);
        const system = makeSystem();
        for (let tick = 0; tick < 40; tick++) {
          system.spawn(
            240,
            240,
            withLaser
              ? { ...makeSpec({ motion: { r: 0, theta: 0 }, laser: { length: 50, warmup: 3, cooldown: 4 } }), life: 20 }
              : makeSpec({ motion: { r: 0, theta: 0 } }),
            'enemy',
            r,
          );
          system.step(240, 400, r);
          system.hitTest(300, 240, 4, 'enemy');
        }
        return r.getState();
      };
      expect(consume(true)).toEqual(consume(false));
    });
  });

  describe('pooling', () => {
    test('an ordinary bullet reusing a beam slot comes back a point', () => {
      const system = makeSystem({ initial: 1, max: 1 });
      const first = system.spawn(
        100,
        100,
        { ...beam({ length: 200, growth: 20 }), life: 2 },
        'enemy',
        rng(),
      ) as Bullet;

      stepTimes(system, 2);
      expect(system.count).toBe(0);
      expect(first.length).toBeGreaterThan(200);

      const second = system.spawn(100, 100, makeSpec(), 'enemy', rng()) as Bullet;
      expect(second).toBe(first);
      expect(second.laser).toBeUndefined();
      expect(second.length).toBe(0);

      // And the stale reach is gone: nothing 200px away is hit any more.
      expect(system.hitTest(300, 100, 1, 'enemy')).toBeUndefined();
    });

    test('a beam reusing a slot restarts at its spawn length, not the last tip', () => {
      const system = makeSystem({ initial: 1, max: 1 });
      const spec = { ...beam({ length: 40, growth: 25 }), life: 4 };

      const first = system.spawn(100, 100, spec, 'enemy', rng()) as Bullet;
      stepTimes(system, 4);
      expect(first.length).toBe(140);

      const second = system.spawn(100, 100, spec, 'enemy', rng()) as Bullet;
      expect(second).toBe(first);
      expect(second.length).toBe(40);
    });

    test('a fresh warmup runs for each new life in the same slot', () => {
      // `lethal` left true from the previous beam is the pooling bug that
      // deletes the telegraph — silently, and only for the second laser onward.
      const system = makeSystem({ initial: 1, max: 1 });
      const spec = { ...beam({ length: 100, warmup: 3 }), life: 6 };

      const first = system.spawn(100, 100, spec, 'enemy', rng()) as Bullet;
      stepTimes(system, 6);
      expect(first.lethal).toBe(true);
      expect(system.count).toBe(0);

      const second = system.spawn(100, 100, spec, 'enemy', rng()) as Bullet;
      expect(second).toBe(first);
      expect(second.lethal).toBe(false);
      expect(system.hitTest(150, 100, 1, 'enemy')).toBeUndefined();
    });
  });

  test('a long beam agrees with a brute-force segment scan', () => {
    // The broad phase indexes muzzles. A beam whose muzzle sits many cells away
    // from the probe must still be visited, which is what the reach widening
    // buys; asserting hits alone would pass on an implementation that found
    // nothing.
    const system = makeSystem();
    const r = rng(31);
    const beams: Bullet[] = [];
    for (let i = 0; i < 40; i++) {
      beams.push(
        system.spawn(
          r.range(0, 480),
          r.range(0, 480),
          makeSpec({
            radius: 3,
            motion: { r: 0, theta: r.range(0, 360) },
            laser: { length: r.range(40, 260) },
          }),
          'enemy',
          r,
        ) as Bullet,
      );
    }

    const nearSegment = (b: Bullet, x: number, y: number, radius: number): boolean => {
      const steps = 4000;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const px = b.x + b.length * t * Math.cos((b.vector.theta * Math.PI) / 180);
        const py = b.y + b.length * t * Math.sin((b.vector.theta * Math.PI) / 180);
        if (circlesOverlap(x, y, radius, px, py, b.radius)) return true;
      }
      return false;
    };

    let found = 0;
    for (let i = 0; i < 300; i++) {
      const x = r.range(0, 480);
      const y = r.range(0, 480);
      const hit = system.hitTest(x, y, 5, 'enemy');
      const expected = beams.filter((b) => nearSegment(b, x, y, 5));

      if (hit !== undefined) {
        found++;
        expect(expected).toContain(hit);
      } else {
        // Sampling the segment can only miss by less than a step, so anything
        // the scan is sure about must have been found.
        expect(expected).toHaveLength(0);
      }
    }
    expect(found).toBeGreaterThan(20);
  });

  test('a laser draws no randomness of its own', () => {
    // Growth and warmup are arithmetic on the tick count, so a field of beams
    // must leave the stream exactly where a field of orbs would.
    const consume = (withLaser: boolean): unknown => {
      const r = rng(77);
      const system = makeSystem();
      for (let tick = 0; tick < 40; tick++) {
        system.spawn(
          240,
          240,
          withLaser
            ? makeSpec({ motion: { r: 0, theta: 0 }, laser: { length: 50, growth: 5, warmup: 3 } })
            : makeSpec({ motion: { r: 0, theta: 0 } }),
          'enemy',
          r,
        );
        system.step(240, 400, r);
        system.hitTest(300, 240, 4, 'enemy');
      }
      return r.getState();
    };

    expect(consume(true)).toEqual(consume(false));
  });

  describe('the offscreen cull accounts for the beam, not just the muzzle', () => {
    // FIELD is 480x480 with a 32px margin, so a muzzle at y = -200 is well
    // outside what culls an ordinary bullet.
    const downward = (length: number): BulletSpec =>
      makeSpec({ radius: 2, motion: { r: 0, theta: 90 }, laser: { length } });

    test('a beam whose muzzle is offscreen survives while its body is on the field', () => {
      const system = makeSystem();
      system.spawn(240, -200, downward(400), 'enemy', rng());

      stepTimes(system, 1);

      expect(system.count).toBe(1);
      // And it is still the lethal object it looks like, 250px down the beam.
      expect(system.hitTest(240, 50, 2, 'enemy')).toBeDefined();
    });

    test('a beam is culled once its whole body has left the field', () => {
      const system = makeSystem();
      // Tip at y = -190, above the field and past the 32px margin.
      system.spawn(240, -200, downward(10), 'enemy', rng());

      stepTimes(system, 1);

      expect(system.count).toBe(0);
    });

    test('an ordinary bullet at the same muzzle is culled as before', () => {
      // The widening must be the laser's alone: a point bullet keeps the plain
      // margin, or this "fix" would quietly keep every stray bullet alive.
      const system = makeSystem();
      system.spawn(240, -200, makeSpec(), 'enemy', rng());

      stepTimes(system, 1);

      expect(system.count).toBe(0);
    });
  });
});

describe('despawn', () => {
  test('removes exactly the given bullet, alive, from the live list, and returns it to the pool', () => {
    const system = makeSystem({ initial: 3, max: 3 });
    const all = [0, 1, 2].map(
      (i) => system.spawn(10 * i, 10, makeSpec(), 'enemy', rng()) as Bullet,
    );

    system.despawn(all[1] as Bullet);

    expect(system.count).toBe(2);
    expect((all[1] as Bullet).alive).toBe(false);
    expect((all[0] as Bullet).alive).toBe(true);
    expect((all[2] as Bullet).alive).toBe(true);
    // Order preserved among survivors — draw order should not jump.
    expect(slots(system.bullets, all)).toEqual([0, 2]);
  });

  test('the freed slot is reused on the next spawn, like natural expiry', () => {
    const system = makeSystem({ initial: 1, max: 1 });
    const first = system.spawn(100, 100, makeSpec(), 'enemy', rng()) as Bullet;

    system.despawn(first);
    expect(system.count).toBe(0);
    expect(system.poolGrowth).toBe(0);

    const second = system.spawn(200, 200, makeSpec(), 'enemy', rng());
    expect(second).toBe(first);
    expect(system.poolSize).toBe(1);
    expect(system.poolGrowth).toBe(0);
  });

  test('despawning a bullet twice is a no-op the second time', () => {
    // The pool's development-mode double-release guard throws if the same
    // object reaches release() twice; despawn must not let a second call
    // through to it.
    const system = makeSystem({ initial: 2, max: 2 });
    const bullet = system.spawn(100, 100, makeSpec(), 'enemy', rng()) as Bullet;
    const other = system.spawn(120, 100, makeSpec(), 'enemy', rng()) as Bullet;

    expect(() => system.despawn(bullet)).not.toThrow();
    expect(() => system.despawn(bullet)).not.toThrow();

    expect(system.count).toBe(1);
    expect(system.bullets).toContain(other);
    expect(system.poolSize).toBe(2);

    // The slot was freed exactly once, not twice: one more spawn fits, a
    // second does not.
    expect(system.spawn(0, 0, makeSpec(), 'enemy', rng())).toBeDefined();
    expect(system.spawn(0, 0, makeSpec(), 'enemy', rng())).toBeUndefined();
  });

  test('despawning a bullet that already expired naturally is a no-op', () => {
    const system = makeSystem({ initial: 2, max: 2 });
    const bullet = system.spawn(100, 100, makeSpec({ life: 1 }), 'enemy', rng()) as Bullet;
    system.step(0, 0, rng());
    expect(bullet.alive).toBe(false);

    expect(() => system.despawn(bullet)).not.toThrow();
    expect(system.count).toBe(0);
    expect(system.poolSize).toBe(2);
  });

  test('despawning during a for-of loop over the live list stays safe', () => {
    // The natural caller is a collision loop: walk the live bullets, despawn
    // the ones that were hit. That loop mutates the very array it walks, so
    // this proves despawn holds its invariants under that — not that every
    // match is caught in a single forward pass, which no in-place array
    // removal can promise (removing the current element shifts the next one
    // into its place, and a forward iterator has already moved past that
    // index). A later pass, or next tick's step(), catches what a given pass
    // misses — pinned by the second sweep below.
    const system = makeSystem({ initial: 10, max: 10 });
    for (let i = 0; i < 10; i++) {
      system.spawn(10 * i, 100, makeSpec(), i % 2 === 0 ? 'enemy' : 'player', rng());
    }

    expect(() => {
      for (const bullet of system.bullets) {
        if (bullet.faction === 'enemy') system.despawn(bullet);
      }
    }).not.toThrow();

    // Whatever survived the pass is coherent: no duplicate slots, nothing
    // half-dead, and the pool's own accounting still balances.
    expect(new Set(system.bullets).size).toBe(system.bullets.length);
    for (const b of system.bullets) expect(b.alive).toBe(true);
    expect(system.poolSize).toBe(10);
    expect(system.droppedSpawns).toBe(0);

    // A second sweep finishes what the first pass's array-mutation hazard
    // could have left behind.
    for (const bullet of system.bullets) {
      if (bullet.faction === 'enemy') system.despawn(bullet);
    }
    expect(system.bullets.every((b) => b.faction === 'player')).toBe(true);

    // Every freed slot is genuinely free: refilling to capacity never grows
    // the pool or drops a spawn.
    for (let i = 0; i < 10 - system.count; i++) {
      expect(system.spawn(0, 0, makeSpec(), 'enemy', rng())).toBeDefined();
    }
    expect(system.poolGrowth).toBe(0);
    expect(system.droppedSpawns).toBe(0);
  });

  test('despawning while walking backwards by index catches every match in one pass', () => {
    // The safe idiom for a collision loop that must not miss anything this
    // tick: walk by index from the end. Removing the current element only
    // shifts already-visited indices, so nothing is skipped.
    const system = makeSystem({ initial: 8, max: 8 });
    for (let i = 0; i < 8; i++) {
      system.spawn(10 * i, 100, makeSpec(), i % 2 === 0 ? 'enemy' : 'player', rng());
    }

    for (let i = system.bullets.length - 1; i >= 0; i--) {
      const bullet = system.bullets[i];
      if (bullet !== undefined && bullet.faction === 'enemy') system.despawn(bullet);
    }

    expect(system.bullets).toHaveLength(4);
    expect(system.bullets.every((b) => b.faction === 'player')).toBe(true);
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

/**
 * A bullet's lethal shape is whatever its spec says it is.
 *
 * Three shapes, one test: a point, a beam anchored at its muzzle, and a blade
 * centred on itself. The last two were both being stood in for by a circle, and
 * a circle is wrong for them in opposite directions — too short along the art
 * and too fat across it — so measuring one extent alone would have looked fine.
 */
describe('bullet shapes', () => {
  const bounds: FieldBounds = { width: 480, height: 480, margin: 48 };
  const make = (spec: BulletSpec, theta: number) => {
    const system = new BulletSystem({ bounds, initial: 8 });
    const bullet = system.spawn(240, 240, spec, 'enemy', new Random(1)) as Bullet;
    bullet.vector.theta = theta;
    return bullet;
  };

  /** Furthest a radius-`r` circle can sit from the origin and still be hit. */
  const extent = (b: Bullet, dx: number, dy: number, r: number): number => {
    let hi = 0;
    for (let d = 0; d <= 200; d += 0.25) {
      if (bulletHitsCircle(b, 240 + dx * d, 240 + dy * d, r)) hi = d;
    }
    return hi;
  };

  const NEEDLE: BulletSpec = {
    style: { sprite: 'needle', orientToHeading: true },
    radius: 2,
    motion: { r: 0, theta: 270 },
    blade: { length: 26 },
  };

  test('a blade reaches along the art and not across it', () => {
    // 270 is up, so the capsule lies on the y axis. Half-length 13 plus half
    // thickness 2, against a radius-6 target: 21 up the blade and 8 beside it.
    const b = make(NEEDLE, 270);
    expect(extent(b, 0, -1, 6)).toBe(21);
    expect(extent(b, 1, 0, 6)).toBe(8);
  });

  test('a blade turns with its heading', () => {
    // The same shape rotated: now long on x and thin on y. A hitbox that
    // ignored `theta` would report the previous test's numbers here.
    const b = make(NEEDLE, 0);
    expect(extent(b, 1, 0, 6)).toBe(21);
    expect(extent(b, 0, -1, 6)).toBe(8);
  });

  test('the circle it replaced was wrong in both directions', () => {
    // The spec as it shipped: radius 3, no blade. Isotropic — which is the
    // defect, since the sprite is 26x4.
    const round: BulletSpec = { ...NEEDLE, radius: 3, blade: undefined };
    const b = make(round, 270);
    expect(extent(b, 0, -1, 6)).toBe(9); // 10px short of the drawn tip
    expect(extent(b, 1, 0, 6)).toBe(9); // 1px past the drawn edge
  });

  test('a beam runs forward from its muzzle, not out from its centre', () => {
    const beam: BulletSpec = {
      style: { sprite: 'needle' },
      radius: 3,
      motion: { r: 0, theta: 270 },
      laser: { length: 100 },
    };
    const b = make(beam, 270);
    // Up: the full 100px body plus the half-width and the target's radius.
    expect(extent(b, 0, -1, 6)).toBe(109);
    // Down, behind the muzzle: nothing but the cap.
    expect(extent(b, 0, 1, 6)).toBe(9);
  });

  test('reach covers whatever shape the bullet has', () => {
    // `BulletSystem.hitTest` sizes its broad-phase query with this. A blade or
    // a beam reported as its bare radius is a bullet the grid never visits, so
    // the exact test below it never runs — a miss that looks like a clean dodge.
    expect(bulletReach(make(NEEDLE, 270))).toBe(15);
    expect(bulletReach(make({ ...NEEDLE, radius: 3, blade: undefined }, 270))).toBe(3);
  });
});

/**
 * The shape test, split from the telegraph gate.
 *
 * `bulletShapeOverlaps` answers "does the geometry overlap" and nothing about
 * whether the shape is *allowed* to hit; `bulletHitsCircle` is that same shape
 * behind the `lethal` gate. The split is what lets a screen-clear bomb wipe a
 * telegraphing beam (presence) while collision still respects the telegraph
 * (danger). The two must agree exactly whenever the bullet is lethal, and only
 * then.
 */
describe('bulletShapeOverlaps: shape without the telegraph gate', () => {
  const bounds: FieldBounds = { width: 480, height: 480, margin: 48 };
  const spawnBeam = (
    laser: LaserSpec,
    extra: Partial<BulletSpec> = {},
  ): { system: BulletSystem; b: Bullet } => {
    const system = new BulletSystem({ bounds, initial: 4 });
    const b = system.spawn(
      240,
      240,
      makeSpec({ radius: 2, motion: { r: 0, theta: 0 }, laser, ...extra }),
      'enemy',
      new Random(1),
    ) as Bullet;
    return { system, b };
  };

  test('a warming beam overlaps its body, but the gated test refuses it', () => {
    const { b } = spawnBeam({ length: 100, warmup: 30 });
    // Mid-body at (300, 240), well past the muzzle circle at (240, 240).
    expect(b.lethal).toBe(false);
    expect(bulletShapeOverlaps(b, 300, 240, 1)).toBe(true); // the shape is there
    expect(bulletHitsCircle(b, 300, 240, 1)).toBe(false); // but harmless
  });

  test('a decaying beam overlaps its body, but the gated test refuses it', () => {
    const { system, b } = spawnBeam({ length: 100, cooldown: 5 }, { life: 12 });
    for (let i = 0; i < 8; i++) system.step(0, 0, new Random(2)); // age 8, decaying
    expect(b.lethal).toBe(false);
    expect(bulletShapeOverlaps(b, 300, 240, 1)).toBe(true);
    expect(bulletHitsCircle(b, 300, 240, 1)).toBe(false);
  });

  test('for a lethal bullet the gated and ungated tests agree exactly', () => {
    const { b } = spawnBeam({ length: 100 }); // lethal at spawn
    const probes: readonly [number, number][] = [
      [300, 240], // on-body
      [240, 240], // at the muzzle
      [400, 240], // past the tip
      [300, 260], // beside the body
    ];
    for (const [x, y] of probes) {
      expect(bulletShapeOverlaps(b, x, y, 3)).toBe(bulletHitsCircle(b, x, y, 3));
    }
  });

  test('for a point bullet the shape test is the plain muzzle circle', () => {
    const system = new BulletSystem({ bounds, initial: 2 });
    const b = system.spawn(240, 240, makeSpec({ radius: 4 }), 'enemy', new Random(1)) as Bullet;
    expect(bulletShapeOverlaps(b, 246, 240, 2)).toBe(
      circlesOverlap(246, 240, 2, b.x, b.y, b.radius),
    );
    expect(bulletShapeOverlaps(b, 300, 240, 2)).toBe(false);
  });
});

describe('piercing', () => {
  const bounds: FieldBounds = { width: 480, height: 480, margin: 48 };

  test('pierce is per-life state, so a slot cannot inherit it', () => {
    // The same argument `laser` and `length` are reset for: the free list is
    // LIFO, so the slot a piercing beam releases is handed to the very next
    // spawn. A round bullet that inherited `pierce` would refuse to despawn on
    // contact and fly on through everything it touched.
    const system = new BulletSystem({ bounds, initial: 2 });
    const beam: BulletSpec = {
      style: { sprite: 'needle' }, radius: 3,
      motion: { r: 0, theta: 270 }, laser: { length: 40 }, pierce: true,
    };
    const plain: BulletSpec = {
      style: { sprite: 'orb.small' }, radius: 3, motion: { r: 2, theta: 90 },
    };

    const first = system.spawn(240, 240, beam, 'player', new Random(1)) as Bullet;
    expect(first.pierce).toBe(true);
    system.despawn(first);

    const second = system.spawn(240, 240, plain, 'player', new Random(1)) as Bullet;
    expect(second.pierce).toBe(false);
    expect(second.bladeHalf).toBe(0);
    expect(second.laser).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* Missiles — a BulletSpec that detonates on death (导弹轮)            */
/* ------------------------------------------------------------------ */

// Homing transcribed from `v4/gameplay/behaviours.ts`'s `homing`, kept local under a
// namespaced name so this sim test needs no content-layer import and cannot
// collide with the real registration. It reads the context and `core/trig` and
// draws NOTHING from the generator — the exact property the no-RNG-draw
// assertion below locks end to end.
defineBehaviour('bullet.test.homing', (vector, context) => {
  const dx = context.targetX - context.x;
  const dy = context.targetY - context.y;
  if (dx === 0 && dy === 0) return;
  const turnRate = vector.options['turnRate'] ?? 3;
  const delta = deltaDeg(vector.theta, atan2Deg(dy, dx));
  const step = Math.min(Math.abs(delta), Math.abs(turnRate));
  vector.theta += delta < 0 ? -step : step;
});

const POP: MissileSpec = { explosion: 'test.pop' };

/**
 * A missile spec with the real anatomy: an elongated `blade` body, a homing
 * segment, `orientToHeading`, and the `missile` detonation recipe. Stationary by
 * default so it stays on-field; callers add `life`/`motion` to steer the case.
 */
function makeMissile(overrides: Partial<BulletSpec> = {}): BulletSpec {
  return makeSpec({
    style: { sprite: 'missile.0', orientToHeading: true },
    radius: 2,
    blade: { length: 16 },
    missile: { ...POP },
    motion: { r: 0, theta: 90 },
    ...overrides,
  });
}

describe('the missile field round-trips through spawn and reset', () => {
  test('a spawned missile carries its spec detonation recipe', () => {
    const system = makeSystem();
    const b = system.spawn(120, 200, makeMissile(), 'enemy', rng()) as Bullet;
    expect(b.missile).toEqual({ explosion: 'test.pop' });
  });

  test('a plain bullet has no missile recipe', () => {
    const system = makeSystem();
    const b = system.spawn(120, 200, makeSpec(), 'enemy', rng()) as Bullet;
    expect(b.missile).toBeUndefined();
  });

  test('missile is per-life state, so a slot cannot inherit it', () => {
    // The same LIFO-pool argument `pierce`/`laser`/`bladeHalf` make: the slot a
    // missile releases is handed to the very next spawn, and a plain bullet that
    // inherited `missile` would detonate on a death that is not a detonation.
    const system = new BulletSystem({ bounds: FIELD, initial: 1, max: 1 });
    const first = system.spawn(240, 240, makeMissile(), 'enemy', new Random(1)) as Bullet;
    expect(first.missile).toEqual({ explosion: 'test.pop' });
    system.despawn(first);

    const second = system.spawn(240, 240, makeSpec(), 'enemy', new Random(1)) as Bullet;
    expect(second.missile).toBeUndefined();
  });
});

describe('the detonation record matrix', () => {
  test('a missile that runs out of life on-field records one pop', () => {
    const system = makeSystem();
    system.spawn(240, 240, makeMissile({ life: 3 }), 'enemy', rng());
    stepTimes(system, 3); // age reaches 3 >= life 3, still at (240, 240)

    const pops = system.drainMissilePops();
    expect(pops).toHaveLength(1);
    expect(pops[0]).toEqual({ x: 240, y: 240, explosion: 'test.pop', faction: 'enemy' });
  });

  test('a missile culled off the field records no pop', () => {
    // `life` omitted (0 = until offscreen): it leaves the field and is culled,
    // not life-expired, so the matrix records nothing — a puff off the edge is
    // wasted particles no one can see.
    const system = makeSystem();
    system.spawn(240, 470, makeMissile({ motion: { r: 20, theta: 90 } }), 'enemy', rng());
    stepTimes(system, 6);

    expect(system.count).toBe(0);
    expect(system.drainMissilePops()).toHaveLength(0);
  });

  test('a missile whose life ends off-field records no pop — offscreen wins', () => {
    // Both life-expiry AND offscreen are true on the same removal; the matrix
    // records only the on-field case, so this puffs nothing.
    const system = makeSystem();
    system.spawn(240, 470, makeMissile({ life: 3, motion: { r: 20, theta: 90 } }), 'enemy', rng());
    stepTimes(system, 3);

    expect(system.drainMissilePops()).toHaveLength(0);
  });

  test('despawn detonates — a resolved hit or a bomb-clear puffs', () => {
    const system = makeSystem();
    const b = system.spawn(150, 160, makeMissile(), 'enemy', rng()) as Bullet;
    system.despawn(b);

    const pops = system.drainMissilePops();
    expect(pops).toHaveLength(1);
    expect(pops[0]).toEqual({ x: 150, y: 160, explosion: 'test.pop', faction: 'enemy' });
  });

  test('a double despawn records at most one pop', () => {
    // The `!alive` guard in despawn that stops a double pool-release also stops a
    // second pop for a bullet found twice in one sweep.
    const system = makeSystem();
    const b = system.spawn(150, 160, makeMissile(), 'enemy', rng()) as Bullet;
    system.despawn(b);
    system.despawn(b); // no-op: already gone

    expect(system.drainMissilePops()).toHaveLength(1);
  });

  test('a stage wipe (clear) records no detonation — it is a reset', () => {
    const system = makeSystem();
    system.spawn(10, 10, makeMissile(), 'enemy', rng());
    system.spawn(20, 20, makeMissile(), 'enemy', rng());
    system.clear();

    expect(system.count).toBe(0);
    expect(system.drainMissilePops()).toHaveLength(0);
  });

  test('a plain bullet never records a pop, however it is removed', () => {
    // The `b.missile !== undefined` guard: a point bullet that life-expires or is
    // despawned records nothing.
    const system = makeSystem();
    system.spawn(240, 240, makeSpec({ life: 2 }), 'enemy', rng());
    const b = system.spawn(200, 200, makeSpec(), 'enemy', rng()) as Bullet;
    system.despawn(b);
    stepTimes(system, 2);

    expect(system.drainMissilePops()).toHaveLength(0);
  });
});

describe('drainMissilePops is a double-buffer', () => {
  test('a drain empties the queue — a second drain returns nothing', () => {
    const system = makeSystem();
    system.despawn(system.spawn(1, 2, makeMissile(), 'enemy', rng()) as Bullet);
    system.despawn(system.spawn(3, 4, makeMissile(), 'enemy', rng()) as Bullet);

    expect(system.drainMissilePops()).toHaveLength(2);
    expect(system.drainMissilePops()).toHaveLength(0);
  });

  test('the buffers alternate and are reused — copy before the next-but-one drain', () => {
    // The drainDeaths/drainCleared contract: two backing arrays cycle, so a
    // returned buffer is reused two drains later. Pinning it stops a future
    // caller from stashing the reference and being surprised when it is emptied.
    const system = makeSystem();
    const drainAfterOnePop = (n: number): readonly unknown[] => {
      system.despawn(system.spawn(n, n, makeMissile(), 'enemy', rng()) as Bullet);
      return system.drainMissilePops();
    };
    const a = drainAfterOnePop(1);
    const b = drainAfterOnePop(2);
    const c = drainAfterOnePop(3);

    expect(a).not.toBe(b); // two distinct backing buffers
    expect(c).toBe(a); // the first buffer comes back around — proof it recycles
  });
});

describe('missiles draw nothing from the sim stream (the locked determinism property, G1)', () => {
  test('1000 ticks of homing, detonating missiles leave the sim stream byte-identical to plain bullets', () => {
    const SEED = 0x515d1e;
    const rMissile = new Random(SEED);
    const rPlain = new Random(SEED);
    const sysM = new BulletSystem({ bounds: FIELD, initial: 256 });
    const sysP = new BulletSystem({ bounds: FIELD, initial: 256 });

    // A shared random draw at spawn (`rrandom`) is the baseline: it proves the
    // assertion is not vacuously true of two streams that both draw nothing. The
    // missile spec adds homing + blade + orientToHeading + the detonation record
    // ON TOP of that draw; the plain spec is the same motion without them. If any
    // of the missile machinery drew from `sim`, the two streams would part.
    const baseMotion = { rrandom: { min: 1, max: 2 }, theta: 90 } as const;
    const missileSpec = makeMissile({
      motion: {
        ...baseMotion,
        w: 0,
        behaviour: 'bullet.test.homing',
        options: { turnRate: 3, delay: 0, duration: 2000 },
      },
      life: 40,
    });
    const plainSpec = makeSpec({ motion: { ...baseMotion }, life: 40 });

    let detonations = 0;
    for (let t = 0; t < 1000; t++) {
      // Same spawn cadence in both, so the spawn-time `rrandom` draws match
      // exactly regardless of where the two bullets then fly.
      if (t % 4 === 0) {
        sysM.spawn(240, 120, missileSpec, 'enemy', rMissile);
        sysP.spawn(240, 120, plainSpec, 'enemy', rPlain);
      }
      // Target off to the side so the homing math computes a real, non-zero turn
      // every tick — even the turn path must draw nothing.
      sysM.step(180, 400, rMissile);
      sysP.step(180, 400, rPlain);
      detonations += sysM.drainMissilePops().length;
      sysP.drainMissilePops(); // parity, though it is always empty
    }

    // Identical generator state after identical spawn draws and 1000 steps of
    // divergent motion: the missile machinery perturbed no stream.
    expect(rMissile.getState()).toEqual(rPlain.getState());
    // And it was not inertness over an empty code path: missiles homed, expired
    // on-field, and detonated.
    expect(detonations).toBeGreaterThan(0);
  });

  test('spawning and detonating a missile never touches the shared sim stream', () => {
    // The companion to the file's existing `sim` guard: the missile field, the
    // homing segment and the pop record all leave the global stream pristine when
    // an explicit generator is passed.
    const before = sim.getState();
    const r = rng(7);
    const system = makeSystem({ initial: 8 });

    for (let t = 0; t < 40; t++) {
      system.spawn(240, 120, makeMissile({ life: 5 }), 'enemy', r);
      system.step(180, 400, r);
      system.drainMissilePops();
    }

    expect(sim.getState()).toEqual(before);
  });
});

describe('a missile detonation is read AT removal, never a please-remove-me flag (rule 8, G4)', () => {
  test('the missile field detonates nothing while the bullet is alive', () => {
    // `missile` is a spec discriminator the system reads when it is already
    // removing the bullet — it is not a standing flag whose presence removes or
    // records anything. A live missile that never leaves the field and never
    // expires records no pop, however long it is stepped.
    const system = makeSystem();
    const b = system.spawn(240, 240, makeMissile(), 'enemy', rng()) as Bullet; // r: 0, life: 0 → immortal, on-field
    stepTimes(system, 500);

    expect(b.alive).toBe(true);
    expect(system.count).toBe(1);
    expect(system.drainMissilePops()).toHaveLength(0);

    // The pop appears only when the SYSTEM removes it, at the removal.
    system.despawn(b);
    expect(system.drainMissilePops()).toHaveLength(1);
  });

  test('writing alive from outside does not remove a missile, and so records no pop', () => {
    // Rule 8: `alive` is system-owned. Flipping it is not a removal — the bullet
    // keeps its slot and its live-list entry — so no removal path runs and no pop
    // is recorded. Removal (and the pop) come only through despawn/expiry.
    const system = makeSystem();
    const b = system.spawn(240, 240, makeMissile(), 'enemy', rng()) as Bullet;
    b.alive = false; // the wrong way to remove a bullet; see rule 8

    expect(system.count).toBe(1); // still in the live list — the flag removed nothing
    expect(system.drainMissilePops()).toHaveLength(0); // and detonated nothing
  });
});

// The G3 authored-invariant honesty scan (`life > delay + duration`) walks the
// base-pack DATA, which sim code may not import (architecture.test.ts:
// "src/sim imports nothing from src/packs"). It lives at the composition layer,
// in `reachability.test.ts`, beside the beam-sweep `hold === warmup` scan it
// mirrors — the same file that already imports the v4 campaign JSON.
