import { describe, expect, test } from 'bun:test';
import { Random, sim } from '../core/random';
import { BulletSystem, type BulletSpec, type FieldBounds } from './bullet';
import {
  defineEnemy,
  Enemy,
  EnemySystem,
  enemyNames,
  getEnemySpec,
  type EnemySystemOptions,
} from './enemy';

const FIELD: FieldBounds = { width: 480, height: 480, margin: 32 };

/**
 * Every test drives its own generator rather than the global `sim` stream, so
 * no test can move another test's outcome by drawing from it.
 */
function rng(seed = 1): Random {
  return new Random(seed);
}

/** Stationary shot: fired bullets stay where they were born, so they can be counted. */
const TEST_SHOT: BulletSpec = {
  style: { sprite: 'orb.small' },
  radius: 3,
  motion: { r: 0, theta: 90 },
};

function makeBullets(): BulletSystem {
  return new BulletSystem({ bounds: FIELD, initial: 256 });
}

function makeSystem(
  options: Partial<EnemySystemOptions> = {},
): { system: EnemySystem; bullets: BulletSystem } {
  const bullets = options.bullets ?? makeBullets();
  const system = new EnemySystem({ bounds: FIELD, initial: 16, ...options, bullets });
  return { system, bullets };
}

function stepTimes(system: EnemySystem, ticks: number, r = rng()): void {
  for (let i = 0; i < ticks; i++) system.step(240, 460, r);
}

/** Identity-based view of the live list — deep equality would hide slot mix-ups. */
function slots(live: readonly Enemy[], all: readonly Enemy[]): number[] {
  return live.map((e) => all.indexOf(e));
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

defineEnemy('test.sitter', { sprite: 'orb.medium', hp: 10, radius: 10 });
defineEnemy('test.tough', { sprite: 'orb.large', hp: 100, radius: 12 });

defineEnemy('test.diver', {
  sprite: 'orb.small',
  hp: 5,
  radius: 8,
  motion: { r: 6, theta: 90 },
});

defineEnemy('test.riser', {
  sprite: 'orb.small',
  hp: 5,
  radius: 8,
  motion: { r: 6, theta: 270 },
});

defineEnemy('test.roamer', {
  sprite: 'orb.small',
  hp: 5,
  radius: 8,
  motion: { r: 6, theta: 90 },
  despawnMargin: 200,
});

/** One bullet every tick from the moment it spawns. */
defineEnemy('test.always', {
  sprite: 'orb.small',
  hp: 50,
  radius: 8,
  patterns: [{ pattern: 'ring', options: { spec: TEST_SHOT, count: 1, period: 1 } }],
});

/** Fires at ages 5 and 15, then is stopped before the volley at 25. */
defineEnemy('test.gunner', {
  sprite: 'orb.small',
  hp: 50,
  radius: 8,
  patterns: [
    {
      pattern: 'ring',
      options: { spec: TEST_SHOT, count: 4, period: 10 },
      startAt: 5,
      stopAt: 25,
    },
  ],
});

/** The pattern itself reports completion after three volleys. */
defineEnemy('test.finite', {
  sprite: 'orb.small',
  hp: 50,
  radius: 8,
  patterns: [
    { pattern: 'ring', options: { spec: TEST_SHOT, count: 1, period: 1, duration: 3 } },
  ],
});

defineEnemy('test.mover', {
  sprite: 'orb.small',
  hp: 50,
  radius: 8,
  motion: { r: 5, theta: 0 },
  patterns: [{ pattern: 'ring', options: { spec: TEST_SHOT, count: 1, period: 1 } }],
});

defineEnemy('test.twogun', {
  sprite: 'orb.small',
  hp: 50,
  radius: 8,
  patterns: [
    { pattern: 'ring', options: { spec: TEST_SHOT, count: 1, period: 1 }, stopAt: 3 },
    { pattern: 'ring', options: { spec: TEST_SHOT, count: 2, period: 1 }, startAt: 6 },
  ],
});

defineEnemy('test.sprayer', {
  sprite: 'orb.small',
  hp: 50,
  radius: 8,
  patterns: [
    { pattern: 'spray', options: { spec: TEST_SHOT, count: 3, period: 2, spread: 360 } },
  ],
});

defineEnemy('test.timeline', {
  sprite: 'orb.small',
  hp: 50,
  radius: 8,
  timeline: [
    { count: 0, motion: { r: 0, theta: 90 } },
    { count: 3, motion: { r: 4, theta: 0 } },
  ],
});

defineEnemy('test.rich', {
  sprite: 'star',
  hp: 3,
  radius: 20,
  width: 48,
  height: 48,
  tint: { r: 0.2, g: 0.4, b: 0.6 },
  spoils: [['power', 4]],
  scoreValue: 750,
  onHit: 'test.hit',
  onDeath: 'test.death',
});

/** Randomized initial motion, so the outcome depends on the generator. */
defineEnemy('test.scattered', {
  sprite: 'orb.small',
  hp: 50,
  radius: 8,
  motion: { rrandom: { min: 1, max: 5 }, trandom: { min: 0, max: 360 } },
});

/* ------------------------------------------------------------------ */

describe('registry', () => {
  test('a defined enemy is retrievable by name', () => {
    const spec = getEnemySpec('test.rich');

    expect(spec.sprite).toBe('star');
    expect(spec.hp).toBe(3);
    expect(spec.radius).toBe(20);
    expect(spec.width).toBe(48);
    expect(spec.height).toBe(48);
    expect(spec.tint).toEqual({ r: 0.2, g: 0.4, b: 0.6 });
    expect(spec.spoils).toEqual([['power', 4]]);
    expect(spec.scoreValue).toBe(750);
    expect(spec.onHit).toBe('test.hit');
    expect(spec.onDeath).toBe('test.death');
  });

  test('defining the same name twice throws rather than silently replacing', () => {
    expect(() => defineEnemy('test.sitter', { sprite: 'x', hp: 1, radius: 1 })).toThrow(
      /already defined/,
    );
  });

  test('an unknown name throws — a typo in stage data must not pass', () => {
    expect(() => getEnemySpec('test.nope')).toThrow(/unknown enemy/);
  });

  test('enemyNames lists every registered enemy', () => {
    // The shipped cast — grunt, weaver, turret and stage-2's — is no longer
    // defined in this module; it moved into the bundled base pack, where the
    // registry snapshot gate (`src/base-content.golden.test.ts`) pins its specs
    // and `src/reachability.test.ts` proves each one spawns and fires. This
    // module owns the registry, so it is verified here against its own fixtures.
    const names = enemyNames();
    expect(names).toContain('test.sitter');
    expect(names).toContain('test.tough');
  });
});

describe('spawn', () => {
  test('a spawned enemy is alive, placed, named and counted', () => {
    const { system } = makeSystem();
    const enemy = system.spawn('test.sitter', 120, 200, rng()) as Enemy;

    expect(enemy.alive).toBe(true);
    expect(enemy.x).toBe(120);
    expect(enemy.y).toBe(200);
    expect(enemy.name).toBe('test.sitter');
    expect(enemy.age).toBe(0);
    expect(enemy.angle).toBe(0);
    expect(system.count).toBe(1);
    expect(system.enemies[0]).toBe(enemy);
  });

  test('hp comes from the spec, and the spec is carried on the entity', () => {
    const { system } = makeSystem();
    const enemy = system.spawn('test.tough', 10, 10, rng()) as Enemy;

    expect(enemy.hp).toBe(100);
    expect(enemy.spec).toBe(getEnemySpec('test.tough'));
  });

  test('motion params reach the vector', () => {
    const { system } = makeSystem();
    const enemy = system.spawn('test.diver', 10, 10, rng()) as Enemy;

    expect(enemy.vector.r).toBe(6);
    expect(enemy.vector.theta).toBe(90);
  });

  test('an enemy with no motion stands still', () => {
    const { system } = makeSystem();
    const enemy = system.spawn('test.sitter', 240, 240, rng()) as Enemy;

    stepTimes(system, 20);
    expect(enemy.x).toBe(240);
    expect(enemy.y).toBe(240);
    expect(enemy.age).toBe(20);
  });

  test('spawning an unknown enemy throws', () => {
    const { system } = makeSystem();
    expect(() => system.spawn('test.nope', 0, 0, rng())).toThrow(/unknown enemy/);
  });

  test('enemies are appended in spawn order', () => {
    const { system } = makeSystem();
    const all = [0, 1, 2].map(
      (i) => system.spawn('test.sitter', 40 * i + 40, 100, rng()) as Enemy,
    );

    expect(slots(system.enemies, all)).toEqual([0, 1, 2]);
  });

  test('a refused spawn returns undefined and counts, rather than throwing', () => {
    const { system } = makeSystem({ initial: 1, max: 1 });
    system.spawn('test.sitter', 10, 10, rng());

    expect(() => system.spawn('test.sitter', 20, 10, rng())).not.toThrow();
    expect(system.spawn('test.sitter', 20, 10, rng())).toBeUndefined();
    expect(system.droppedSpawns).toBe(2);
    expect(system.count).toBe(1);
  });

  test('the pool grows rather than refusing when initial is too small', () => {
    const { system } = makeSystem({ initial: 2 });
    for (let i = 0; i < 30; i++) system.spawn('test.sitter', 100, 100, rng());

    expect(system.count).toBe(30);
    expect(system.droppedSpawns).toBe(0);
    expect(system.poolGrowth).toBeGreaterThan(0);
    expect(new Set(system.enemies).size).toBe(30);
  });
});

describe('step: motion', () => {
  test('speed is pixels per tick — one tick moves exactly r pixels', () => {
    const { system } = makeSystem();
    const enemy = system.spawn('test.diver', 240, 100, rng()) as Enemy;

    system.step(240, 460, rng());
    expect(enemy.y).toBeCloseTo(106, 9);

    stepTimes(system, 4);
    expect(enemy.y).toBeCloseTo(130, 9);
  });

  test('age increments once per step', () => {
    const { system } = makeSystem();
    const enemy = system.spawn('test.sitter', 240, 240, rng()) as Enemy;

    for (let i = 1; i <= 5; i++) {
      system.step(240, 460, rng());
      expect(enemy.age).toBe(i);
    }
  });

  test('a timeline switches motion when a segment falls due', () => {
    const { system } = makeSystem();
    const enemy = system.spawn('test.timeline', 100, 240, rng()) as Enemy;

    stepTimes(system, 3);
    expect(enemy.x).toBeCloseTo(100, 9);

    system.step(240, 460, rng());
    expect(enemy.vector.r).toBe(4);
    expect(enemy.x).toBeCloseTo(104, 9);

    system.step(240, 460, rng());
    expect(enemy.x).toBeCloseTo(108, 9);
  });

  test('hasTimeline reflects whether the spec supplied one', () => {
    const { system } = makeSystem();
    const plain = system.spawn('test.sitter', 100, 240, rng()) as Enemy;
    const timed = system.spawn('test.timeline', 200, 240, rng()) as Enemy;

    expect(plain.hasTimeline).toBe(false);
    expect(timed.hasTimeline).toBe(true);
  });

  test('stepping an empty system is a no-op', () => {
    const { system } = makeSystem();
    expect(() => system.step(240, 460, rng())).not.toThrow();
    expect(system.count).toBe(0);
  });
});

describe('patterns', () => {
  test('a pattern with no startAt fires on the enemy first tick', () => {
    const { system, bullets } = makeSystem();
    system.spawn('test.always', 240, 240, rng());

    system.step(240, 460, rng());
    expect(bullets.count).toBe(1);

    stepTimes(system, 4);
    expect(bullets.count).toBe(5);
  });

  test('bullets are fired into the system supplied at construction, as enemy fire', () => {
    const bullets = makeBullets();
    const { system } = makeSystem({ bullets });
    system.spawn('test.always', 240, 240, rng());

    system.step(240, 460, rng());
    expect(bullets.bullets[0]?.faction).toBe('enemy');
  });

  test('startAt delays the first volley, counted from the enemy spawn', () => {
    const { system, bullets } = makeSystem();
    system.spawn('test.gunner', 240, 240, rng());

    stepTimes(system, 5);
    expect(bullets.count).toBe(0);

    // Age 5 is the tick startAt falls due, and the fresh emitter fires at once.
    system.step(240, 460, rng());
    expect(bullets.count).toBe(4);
  });

  test('the emitter clock starts at startAt, not at the enemy spawn', () => {
    // A period-10 emitter created at age 5 must fire at ages 5 and 15. If the
    // pattern read the enemy's age instead it would fire at 10 and 20.
    const { system, bullets } = makeSystem();
    system.spawn('test.gunner', 240, 240, rng());

    stepTimes(system, 6);
    expect(bullets.count).toBe(4);

    stepTimes(system, 9);
    expect(bullets.count).toBe(4);

    stepTimes(system, 1);
    expect(bullets.count).toBe(8);
  });

  test('stopAt retires the pattern for good', () => {
    const { system, bullets } = makeSystem();
    system.spawn('test.gunner', 240, 240, rng());

    stepTimes(system, 200);
    // Two volleys of four, and nothing after the stop.
    expect(bullets.count).toBe(8);
  });

  test('a pattern that reports completion is not restarted next tick', () => {
    const { system, bullets } = makeSystem();
    system.spawn('test.finite', 240, 240, rng());

    stepTimes(system, 100);
    expect(bullets.count).toBe(3);
  });

  test('several patterns run independently on their own windows', () => {
    const { system, bullets } = makeSystem();
    system.spawn('test.twogun', 240, 240, rng());

    // Ticks 0..2 from the first slot only.
    stepTimes(system, 3);
    expect(bullets.count).toBe(3);

    // The first has stopped and the second has not started.
    stepTimes(system, 3);
    expect(bullets.count).toBe(3);

    // Ticks 6..8 from the second slot, two bullets each.
    stepTimes(system, 3);
    expect(bullets.count).toBe(9);
  });

  test('bullets are fired from where the enemy is after it has moved', () => {
    const { system, bullets } = makeSystem();
    system.spawn('test.mover', 100, 240, rng());

    system.step(240, 460, rng());
    expect(bullets.bullets[0]?.x).toBeCloseTo(105, 9);
    expect(bullets.bullets[0]?.y).toBeCloseTo(240, 9);

    system.step(240, 460, rng());
    expect(bullets.bullets[1]?.x).toBeCloseTo(110, 9);
  });

  test('an enemy with no patterns never fires', () => {
    const { system, bullets } = makeSystem();
    system.spawn('test.sitter', 240, 240, rng());

    stepTimes(system, 200);
    expect(bullets.count).toBe(0);
  });

  test('a dead enemy stops firing immediately', () => {
    const { system, bullets } = makeSystem();
    const enemy = system.spawn('test.always', 240, 240, rng()) as Enemy;

    stepTimes(system, 3);
    expect(bullets.count).toBe(3);

    system.damage(enemy, 999);
    stepTimes(system, 20);
    expect(bullets.count).toBe(3);
  });

  test('pattern fire is charged to the generator passed in, not the sim stream', () => {
    const before = sim.getState();
    const { system } = makeSystem();
    system.spawn('test.sprayer', 240, 240, rng(3));

    stepTimes(system, 40, rng(3));
    expect(sim.getState()).toEqual(before);
  });
});

describe('damage and deaths', () => {
  test('damage below the hp total does not kill', () => {
    const { system } = makeSystem();
    const enemy = system.spawn('test.tough', 240, 240, rng()) as Enemy;

    expect(system.damage(enemy, 30)).toBe(false);
    expect(enemy.hp).toBe(70);
    expect(enemy.alive).toBe(true);
    expect(system.count).toBe(1);
  });

  test('damage that reaches zero kills and reports it', () => {
    const { system } = makeSystem();
    const enemy = system.spawn('test.sitter', 240, 240, rng()) as Enemy;

    expect(system.damage(enemy, 10)).toBe(true);
    expect(enemy.alive).toBe(false);
    expect(system.count).toBe(0);
    expect(system.enemies).not.toContain(enemy);
  });

  test('a killed enemy leaves the live list at once, not on the next step', () => {
    // The renderer draws whatever is in `enemies`. Deferring the removal would
    // leave a corpse on screen for a tick.
    const { system } = makeSystem();
    const enemy = system.spawn('test.sitter', 240, 240, rng()) as Enemy;

    system.damage(enemy, 10);
    expect(system.enemies).toHaveLength(0);
  });

  test('a second hit on an already dead enemy is refused', () => {
    // Two player bullets can land in the same sweep; paying the score twice
    // is the bug this guards.
    const { system } = makeSystem();
    const enemy = system.spawn('test.sitter', 240, 240, rng()) as Enemy;

    expect(system.damage(enemy, 10)).toBe(true);
    expect(system.damage(enemy, 10)).toBe(false);
    expect(system.drainDeaths()).toHaveLength(1);
  });

  test('a death carries the name, the position of the kill, and the spec', () => {
    const { system } = makeSystem();
    const enemy = system.spawn('test.rich', 130, 170, rng()) as Enemy;

    system.damage(enemy, 3);
    const deaths = system.drainDeaths();

    expect(deaths).toHaveLength(1);
    expect(deaths[0]?.name).toBe('test.rich');
    expect(deaths[0]?.x).toBe(130);
    expect(deaths[0]?.y).toBe(170);
    expect(deaths[0]?.spec).toBe(getEnemySpec('test.rich'));
    expect(deaths[0]?.spec.onDeath).toBe('test.death');
    expect(deaths[0]?.spec.spoils).toEqual([['power', 4]]);
  });

  test('the recorded position is where it died, not where it started', () => {
    const { system } = makeSystem();
    const enemy = system.spawn('test.diver', 240, 100, rng()) as Enemy;

    stepTimes(system, 5);
    system.damage(enemy, 5);

    expect(system.drainDeaths()[0]?.y).toBeCloseTo(130, 9);
  });

  test('a death snapshot survives the slot being reused underneath it', () => {
    const { system } = makeSystem({ initial: 1, max: 1 });
    const first = system.spawn('test.sitter', 111, 222, rng()) as Enemy;
    system.damage(first, 10);

    const second = system.spawn('test.tough', 400, 400, rng()) as Enemy;
    expect(second).toBe(first);

    const deaths = system.drainDeaths();
    expect(deaths[0]?.name).toBe('test.sitter');
    expect(deaths[0]?.x).toBe(111);
    expect(deaths[0]?.y).toBe(222);
  });

  test('deaths accumulate in kill order and drain empty', () => {
    const { system } = makeSystem();
    const all = [0, 1, 2].map(
      (i) => system.spawn('test.sitter', 100 + i * 40, 240, rng()) as Enemy,
    );

    system.damage(all[2] as Enemy, 10);
    system.damage(all[0] as Enemy, 10);

    const deaths = system.drainDeaths();
    expect(deaths.map((d) => d.x)).toEqual([180, 100]);
    expect(system.drainDeaths()).toHaveLength(0);
  });

  test('draining twice in a row does not replay the same deaths', () => {
    const { system } = makeSystem();
    const enemy = system.spawn('test.sitter', 240, 240, rng()) as Enemy;
    system.damage(enemy, 10);

    expect(system.drainDeaths()).toHaveLength(1);
    expect(system.drainDeaths()).toHaveLength(0);
    expect(system.drainDeaths()).toHaveLength(0);
  });

  test('a drained batch is readable until the next drain, across many cycles', () => {
    // The buffers are recycled, so this pins the contract the recycling makes.
    const { system } = makeSystem();

    for (let i = 0; i < 6; i++) {
      const enemy = system.spawn('test.sitter', 100 + i, 240, rng()) as Enemy;
      system.damage(enemy, 10);

      const deaths = system.drainDeaths();
      expect(deaths).toHaveLength(1);
      expect(deaths[0]?.x).toBe(100 + i);
    }
  });

  test('culling at the edge is not a death', () => {
    const { system } = makeSystem();
    system.spawn('test.diver', 240, 240, rng());

    stepTimes(system, 100);
    expect(system.count).toBe(0);
    expect(system.drainDeaths()).toHaveLength(0);
  });

  test('clear is not a death either', () => {
    const { system } = makeSystem();
    system.spawn('test.sitter', 240, 240, rng());
    system.clear();

    expect(system.drainDeaths()).toHaveLength(0);
  });

  test('killing one enemy neither skips nor reorders its neighbours', () => {
    const { system } = makeSystem();
    const all = [0, 1, 2, 3, 4].map(
      (i) => system.spawn('test.tough', 60 + i * 60, 240, rng()) as Enemy,
    );

    system.damage(all[2] as Enemy, 100);
    expect(slots(system.enemies, all)).toEqual([0, 1, 3, 4]);

    system.step(240, 460, rng());
    // A skipped survivor would not have been stepped at all.
    for (const e of system.enemies) expect(e.age).toBe(1);
    expect(new Set(system.enemies).size).toBe(4);
  });

  test('killing every enemy in a sweep leaves a clean list', () => {
    const { system } = makeSystem();
    const all = [0, 1, 2, 3].map(
      (i) => system.spawn('test.sitter', 60 + i * 60, 240, rng()) as Enemy,
    );

    for (const e of all) expect(system.damage(e, 10)).toBe(true);

    expect(system.count).toBe(0);
    expect(system.drainDeaths()).toHaveLength(4);

    // And the slots are all free again.
    for (let i = 0; i < 4; i++) {
      expect(system.spawn('test.sitter', 100, 100, rng())).toBeDefined();
    }
    expect(system.poolGrowth).toBe(0);
  });
});

describe('culling', () => {
  test('an enemy leaving the bottom edge is culled', () => {
    const { system } = makeSystem();
    const enemy = system.spawn('test.diver', 240, 240, rng()) as Enemy;

    stepTimes(system, 40);
    expect(system.count).toBe(1);

    stepTimes(system, 20);
    expect(system.count).toBe(0);
    expect(enemy.alive).toBe(false);
  });

  test('an enemy leaving the top edge is culled too', () => {
    const { system } = makeSystem();
    system.spawn('test.riser', 240, 240, rng());

    stepTimes(system, 40);
    expect(system.count).toBe(1);

    stepTimes(system, 20);
    expect(system.count).toBe(0);
  });

  test('an enemy spawned well above the field flies in instead of being culled', () => {
    // The whole point of the entry grace: content spawns offscreen, and the
    // margin alone would kill the wave on its first tick.
    const { system } = makeSystem();
    const enemy = system.spawn('test.diver', 240, -200, rng()) as Enemy;

    stepTimes(system, 10);
    expect(system.count).toBe(1);
    expect(enemy.y).toBeCloseTo(-140, 9);
    expect(enemy.entered).toBe(false);

    // It reaches the field, and only then becomes eligible for the cull.
    stepTimes(system, 40);
    expect(enemy.entered).toBe(true);
    expect(system.count).toBe(1);

    stepTimes(system, 100);
    expect(system.count).toBe(0);
  });

  test('despawnMargin lets an enemy leave the field and stay alive', () => {
    const { system } = makeSystem();
    system.spawn('test.diver', 240, 240, rng());
    system.spawn('test.roamer', 300, 240, rng());

    stepTimes(system, 60);
    // Same trajectory, same speed: only the margin differs.
    expect(system.count).toBe(1);
    expect(system.enemies[0]?.name).toBe('test.roamer');

    stepTimes(system, 30);
    expect(system.count).toBe(0);
  });

  test('an enemy that spawns outside and never enters is never culled', () => {
    // The cost of the entry grace, pinned rather than discovered later: an
    // enemy authored to spawn offscreen and travel further out lives forever.
    // That is a content bug, and the pool ceiling is what bounds its damage.
    const { system } = makeSystem();
    system.spawn('test.riser', 240, -100, rng());

    stepTimes(system, 500);
    expect(system.count).toBe(1);
  });

  test('a culled enemy is dropped from the list and marked dead', () => {
    const { system } = makeSystem();
    const doomed = system.spawn('test.diver', 240, 470, rng()) as Enemy;
    const survivor = system.spawn('test.sitter', 240, 240, rng()) as Enemy;

    stepTimes(system, 20);

    expect(doomed.alive).toBe(false);
    expect(survivor.alive).toBe(true);
    expect(system.enemies).not.toContain(doomed);
    expect(system.enemies).toContain(survivor);
  });

  test('survivors keep their relative order across staggered culls', () => {
    const { system } = makeSystem();
    const all = [470, 240, 500, 240, 505].map(
      (y, i) =>
        system.spawn(y === 240 ? 'test.sitter' : 'test.diver', 60 + i * 60, y, rng()) as Enemy,
    );

    stepTimes(system, 20);

    expect(slots(system.enemies, all)).toEqual([1, 3]);
    expect(new Set(system.enemies).size).toBe(2);
    for (const e of system.enemies) expect(e.age).toBe(20);
  });
});

describe('pool reuse', () => {
  test('a killed slot is reused instead of allocating a new enemy', () => {
    const { system } = makeSystem({ initial: 1, max: 1 });
    const first = system.spawn('test.sitter', 100, 100, rng()) as Enemy;
    system.damage(first, 10);

    const second = system.spawn('test.tough', 200, 200, rng());
    expect(second).toBe(first);
    expect(system.poolSize).toBe(1);
    expect(system.poolGrowth).toBe(0);
  });

  test('a reused slot carries no hp, age, name or spec from its last life', () => {
    const { system } = makeSystem({ initial: 1, max: 1 });
    const first = system.spawn('test.tough', 100, 100, rng()) as Enemy;

    stepTimes(system, 12);
    system.damage(first, 40);
    expect(first.age).toBe(12);
    expect(first.hp).toBe(60);
    system.damage(first, 100);

    const second = system.spawn('test.sitter', 30, 30, rng()) as Enemy;
    expect(second).toBe(first);
    expect(second.age).toBe(0);
    expect(second.hp).toBe(10);
    expect(second.name).toBe('test.sitter');
    expect(second.spec).toBe(getEnemySpec('test.sitter'));
    expect(second.alive).toBe(true);
    expect(second.entered).toBe(false);
    expect(second.x).toBe(30);
    expect(second.y).toBe(30);
  });

  test('a reused slot does not inherit the previous enemy running patterns', () => {
    // The classic pooling leak: a silent enemy in a recycled slot keeps
    // firing the fire of whatever died there.
    const { system, bullets } = makeSystem({ initial: 1, max: 1 });
    const first = system.spawn('test.always', 240, 240, rng()) as Enemy;

    stepTimes(system, 4);
    expect(bullets.count).toBe(4);
    system.damage(first, 50);

    const second = system.spawn('test.sitter', 240, 240, rng()) as Enemy;
    expect(second).toBe(first);

    stepTimes(system, 20);
    expect(bullets.count).toBe(4);
  });

  test('a reused slot restarts its patterns rather than resuming them', () => {
    const { system, bullets } = makeSystem({ initial: 1, max: 1 });
    const first = system.spawn('test.gunner', 240, 240, rng()) as Enemy;

    // Past startAt, so the emitter is live when the enemy dies.
    stepTimes(system, 8);
    expect(bullets.count).toBe(4);
    system.damage(first, 50);

    const second = system.spawn('test.gunner', 240, 240, rng()) as Enemy;
    expect(second).toBe(first);

    // Rewound: the delay is served again from scratch.
    stepTimes(system, 5);
    expect(bullets.count).toBe(4);
    stepTimes(system, 1);
    expect(bullets.count).toBe(8);
  });

  test('a retired pattern slot is armed again for the next life', () => {
    const { system, bullets } = makeSystem({ initial: 1, max: 1 });
    const first = system.spawn('test.finite', 240, 240, rng()) as Enemy;

    stepTimes(system, 20);
    expect(bullets.count).toBe(3);
    system.damage(first, 50);

    const second = system.spawn('test.finite', 240, 240, rng()) as Enemy;
    expect(second).toBe(first);

    stepTimes(system, 20);
    expect(bullets.count).toBe(6);
  });

  test('a reused slot never advances a stale timeline', () => {
    const { system } = makeSystem({ initial: 1, max: 1 });
    const first = system.spawn('test.timeline', 100, 240, rng()) as Enemy;

    stepTimes(system, 6);
    expect(first.x).toBeCloseTo(112, 9);
    system.damage(first, 50);

    const second = system.spawn('test.sitter', 100, 240, rng()) as Enemy;
    expect(second).toBe(first);
    expect(second.hasTimeline).toBe(false);

    stepTimes(system, 10);
    expect(second.x).toBe(100);
  });

  test('a timeline is rewound for each new life in the same slot', () => {
    const { system } = makeSystem({ initial: 1, max: 1 });
    const first = system.spawn('test.timeline', 100, 240, rng()) as Enemy;

    stepTimes(system, 4);
    expect(first.x).toBeCloseTo(104, 9);
    system.damage(first, 50);

    const second = system.spawn('test.timeline', 100, 240, rng()) as Enemy;
    stepTimes(system, 3);
    expect(second.x).toBeCloseTo(100, 9);
    stepTimes(system, 1);
    expect(second.x).toBeCloseTo(104, 9);
  });

  test('a long spawn/kill cycle never grows the pool', () => {
    const { system } = makeSystem({ initial: 4, max: 4 });

    for (let i = 0; i < 400; i++) {
      const enemy = system.spawn('test.sitter', 100, 100, rng());
      expect(enemy).toBeDefined();
      system.damage(enemy as Enemy, 10);
      system.step(240, 460, rng());
    }

    expect(system.poolSize).toBe(4);
    expect(system.poolGrowth).toBe(0);
    expect(system.droppedSpawns).toBe(0);
  });

  test('a long spawn/cull cycle never grows the pool either', () => {
    const { system } = makeSystem({ initial: 8, max: 8 });

    for (let i = 0; i < 200; i++) {
      system.spawn('test.diver', 100, 500, rng());
      stepTimes(system, 12);
    }

    expect(system.count).toBe(0);
    expect(system.poolSize).toBe(8);
    expect(system.droppedSpawns).toBe(0);
  });

  test('clear empties the list, kills the enemies and returns them to the pool', () => {
    const { system } = makeSystem({ initial: 3, max: 3 });
    const all = [0, 1, 2].map(
      (i) => system.spawn('test.sitter', 60 + i * 60, 240, rng()) as Enemy,
    );

    system.clear();

    expect(system.count).toBe(0);
    expect(system.enemies).toHaveLength(0);
    for (const e of all) expect(e.alive).toBe(false);

    for (let i = 0; i < 3; i++) {
      expect(system.spawn('test.sitter', 100, 100, rng())).toBeDefined();
    }
    expect(system.poolSize).toBe(3);
    expect(system.droppedSpawns).toBe(0);
  });

  test('nothing fires after clear', () => {
    const { system, bullets } = makeSystem();
    system.spawn('test.always', 240, 240, rng());
    stepTimes(system, 3);
    system.clear();

    stepTimes(system, 20);
    expect(bullets.count).toBe(3);
  });
});

describe('nearest', () => {
  test('returns the closest live enemy', () => {
    const { system } = makeSystem();
    system.spawn('test.sitter', 100, 100, rng());
    const close = system.spawn('test.sitter', 240, 200, rng()) as Enemy;
    system.spawn('test.sitter', 400, 400, rng());

    expect(system.nearest(240, 240)).toBe(close);
  });

  test('distance is euclidean, not axis-aligned', () => {
    const { system } = makeSystem();
    const diagonal = system.spawn('test.sitter', 260, 260, rng()) as Enemy;
    system.spawn('test.sitter', 240, 270, rng());

    // The axis-aligned enemy is 30 away, the diagonal one ~28.3.
    expect(system.nearest(240, 240)).toBe(diagonal);
  });

  test('returns undefined on an empty field', () => {
    const { system } = makeSystem();
    expect(system.nearest(240, 240)).toBeUndefined();
  });

  test('a killed enemy is never returned', () => {
    const { system } = makeSystem();
    const close = system.spawn('test.sitter', 240, 250, rng()) as Enemy;
    const far = system.spawn('test.sitter', 240, 400, rng()) as Enemy;

    system.damage(close, 10);
    expect(system.nearest(240, 240)).toBe(far);
  });

  test('the first of two equidistant enemies wins, stably', () => {
    const { system } = makeSystem();
    const first = system.spawn('test.sitter', 200, 240, rng()) as Enemy;
    system.spawn('test.sitter', 280, 240, rng());

    expect(system.nearest(240, 240)).toBe(first);
    expect(system.nearest(240, 240)).toBe(first);
  });
});

describe('hitTest', () => {
  test('finds an enemy overlapping the circle', () => {
    const { system } = makeSystem();
    const enemy = system.spawn('test.sitter', 200, 200, rng()) as Enemy;

    expect(system.hitTest(200, 200, 4)).toBe(enemy);
  });

  test('the test is against the sum of the radii', () => {
    const { system } = makeSystem();
    // radius 10, so a 5px probe reaches to 15px away.
    system.spawn('test.sitter', 115, 100, rng());

    expect(system.hitTest(100, 100, 5)).toBeDefined();
    expect(system.hitTest(100, 100, 4.9)).toBeUndefined();
  });

  test('the enemy radius comes from its spec, not a shared constant', () => {
    const { system } = makeSystem();
    system.spawn('test.rich', 100, 100, rng());

    // radius 20 against a 2px probe.
    expect(system.hitTest(122, 100, 2)).toBeDefined();
    expect(system.hitTest(123, 100, 2)).toBeUndefined();
  });

  test('returns undefined when nothing is in range', () => {
    const { system } = makeSystem();
    system.spawn('test.sitter', 50, 50, rng());

    expect(system.hitTest(400, 400, 5)).toBeUndefined();
  });

  test('a killed enemy is no longer found', () => {
    const { system } = makeSystem();
    const enemy = system.spawn('test.sitter', 200, 200, rng()) as Enemy;
    expect(system.hitTest(200, 200, 4)).toBeDefined();

    system.damage(enemy, 10);
    expect(system.hitTest(200, 200, 4)).toBeUndefined();
  });

  test('nothing is found after clear', () => {
    const { system } = makeSystem();
    system.spawn('test.sitter', 200, 200, rng());
    system.clear();

    expect(system.hitTest(200, 200, 8)).toBeUndefined();
  });

  test('hitTest does not disturb the live list', () => {
    const { system } = makeSystem();
    const all = [0, 1, 2].map(
      (i) => system.spawn('test.sitter', 100 + i * 40, 200, rng()) as Enemy,
    );

    system.hitTest(140, 200, 5);
    system.hitTest(400, 400, 5);

    expect(slots(system.enemies, all)).toEqual([0, 1, 2]);
    for (const e of all) expect(e.alive).toBe(true);
  });

  test('finds enemies anywhere in the field, not only near the origin', () => {
    const { system } = makeSystem();
    const places: Array<[number, number]> = [
      [12, 12],
      [140, 60],
      [240, 240],
      [460, 20],
      [20, 460],
      [460, 460],
    ];
    const all = places.map(([x, y]) => system.spawn('test.sitter', x, y, rng()) as Enemy);

    places.forEach(([x, y], i) => {
      expect(system.hitTest(x, y, 2)).toBe(all[i] as Enemy);
    });
  });

  test('a whole wave can be shot down one hit at a time', () => {
    const { system } = makeSystem();
    for (let i = 0; i < 8; i++) system.spawn('test.sitter', 40 + i * 50, 200, rng());

    for (let i = 0; i < 8; i++) {
      const hit = system.hitTest(40 + i * 50, 200, 2);
      expect(hit).toBeDefined();
      expect(system.damage(hit as Enemy, 10)).toBe(true);
    }

    expect(system.count).toBe(0);
    expect(system.drainDeaths()).toHaveLength(8);
  });
});

describe('determinism', () => {
  const run = (seed: number): string => {
    const r = new Random(seed);
    const bullets = new BulletSystem({ bounds: FIELD, initial: 256 });
    const system = new EnemySystem({ bounds: FIELD, bullets, initial: 16 });
    const trace: number[] = [];

    for (let tick = 0; tick < 90; tick++) {
      if (tick % 7 === 0) system.spawn('test.scattered', 240, 80, r);
      if (tick % 11 === 0) system.spawn('test.sprayer', 120, 60, r);
      system.step(240, 440, r);
      bullets.step(240, 440, r);

      for (const e of system.enemies) trace.push(e.x, e.y, e.age, e.hp);
      for (const b of bullets.bullets) trace.push(b.x, b.y);
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
    const { system } = makeSystem();

    for (let tick = 0; tick < 40; tick++) {
      system.spawn('test.scattered', 240, 80, r);
      system.spawn('test.sprayer', 120, 60, r);
      system.step(240, 440, r);
      system.nearest(240, 440);
      system.hitTest(240, 300, 6);
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
      const { system, bullets } = makeSystem();

      for (let tick = 0; tick < 60; tick++) {
        system.spawn('test.scattered', 240, 80, r);
        system.spawn('test.sprayer', 120, 60, r);
        system.spawn('test.timeline', 100, 200, r);
        system.step(240, 440, r);
        bullets.step(240, 440, r);
        system.hitTest(240, 300, 6);
        system.nearest(240, 440);
      }
      expect(system.count).toBeGreaterThan(0);
      expect(bullets.count).toBeGreaterThan(0);
    } finally {
      Math.random = real;
    }
  });

  test('a replayed spawn and kill sequence lands on identical pool slots', () => {
    const identities = (): number[] => {
      const r = rng(5);
      const { system } = makeSystem({ initial: 4, max: 4 });
      const seen: Enemy[] = [];
      const order: number[] = [];

      for (let tick = 0; tick < 60; tick++) {
        const e = system.spawn('test.scattered', 240, 240, r);
        if (e !== undefined) {
          if (!seen.includes(e)) seen.push(e);
          order.push(seen.indexOf(e));
          if (tick % 3 === 0) system.damage(e, 50);
        } else {
          order.push(-1);
        }
        system.step(240, 440, r);
      }
      return order;
    };

    expect(identities()).toEqual(identities());
  });
});

describe('accounting', () => {
  test('count tracks the live list', () => {
    const { system } = makeSystem();
    expect(system.count).toBe(0);

    for (let i = 0; i < 7; i++) system.spawn('test.sitter', 100, 100, rng());
    expect(system.count).toBe(7);
    expect(system.count).toBe(system.enemies.length);

    system.clear();
    expect(system.count).toBe(0);
  });

  test('poolSize reports allocation, not live enemies', () => {
    const { system } = makeSystem({ initial: 16 });
    expect(system.poolSize).toBe(16);

    system.spawn('test.sitter', 100, 100, rng());
    expect(system.poolSize).toBe(16);
    expect(system.count).toBe(1);
  });
});
