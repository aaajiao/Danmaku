import { test, expect, describe } from 'bun:test';

import { Random, sim } from '../core/random';
import { BulletSystem, type FieldBounds } from '../sim/bullet';
import { defineEnemy, EnemySystem, type EnemySpec } from '../sim/enemy';
import {
  defineStage,
  getStage,
  stageNames,
  StageRunner,
  type StageSpec,
  type WaveEntry,
} from './stage';

/**
 * The stage and enemy registries are module-level and shared with every other
 * test file that imports them, so everything defined here is namespaced.
 * Stage names are minted per test rather than reused, because `defineStage`
 * refuses a duplicate and test order is not guaranteed.
 */
const NS = 'test:stage.test/';
let unique = 0;
function name(): string {
  return `${NS}${unique++}`;
}

const BOUNDS: FieldBounds = { width: 480, height: 480, margin: 48 };

/**
 * Inert test enemies: no patterns, no motion, so a spawn log records exactly
 * the position the stage asked for and nothing drifts underneath the
 * arithmetic being measured.
 */
const INERT: EnemySpec = { sprite: 'orb.small', hp: 1, radius: 4, motion: { r: 0 } };
defineEnemy(`${NS}mark`, INERT);
defineEnemy(`${NS}other`, INERT);
const MARK = `${NS}mark`;
const OTHER = `${NS}other`;

/**
 * A multi-wave stage of inert enemies — repeats, spatial offsets and two
 * same-tick spawns — for exercising the runner's schedule without any fire to
 * vary. The shipped stages moved into the bundled base pack, so a content-side
 * unit test cannot drive them; their full composition determinism (stage +
 * enemies + bullets, byte-for-byte across a whole run) is proved at the root by
 * `src/base-content.golden.test.ts`'s replay fixtures instead.
 */
const SCHEDULE_STAGE: StageSpec = {
  name: `${NS}schedule`,
  seed: 7,
  outro: 180,
  waves: [
    { at: 0, enemy: MARK, x: 120, y: -24, count: 5, interval: 20 },
    { at: 200, enemy: MARK, x: 150, y: -24, count: 5, interval: 0, stepX: 45, stepY: -18 },
    { at: 400, enemy: OTHER, x: 300, y: -30, count: 3, interval: 30, stepX: 70 },
    { at: 800, enemy: MARK, x: 90, y: -24, count: 6, interval: 14, stepX: 60 },
    { at: 1200, enemy: OTHER, x: 140, y: -24 },
    { at: 1200, enemy: MARK, x: 340, y: -24 },
  ],
};

interface Spawned {
  tick: number;
  enemy: string;
  x: number;
  y: number;
}

function makeField(options: { enemyMax?: number } = {}) {
  const bullets = new BulletSystem({ bounds: BOUNDS, initial: 512, max: 8192 });
  const enemies = new EnemySystem({
    bounds: BOUNDS,
    bullets,
    initial: 64,
    max: options.enemyMax ?? 512,
  });
  return { bullets, enemies };
}

/**
 * Run a stage and report every spawn with the tick it landed on.
 *
 * The runner only ever appends to `EnemySystem.enemies`, so reading the tail
 * immediately after `runner.step()` is the spawn log — no hook needed, and no
 * risk of confusing a spawn with a cull.
 */
function spawnLog(
  spec: StageSpec,
  ticks: number,
  options: { stepEnemies?: boolean; enemyMax?: number } = {},
): Spawned[] {
  const { bullets, enemies } = makeField({ enemyMax: options.enemyMax });
  const runner = new StageRunner(spec, enemies);
  const log: Spawned[] = [];

  for (let tick = 0; tick < ticks; tick++) {
    const before = enemies.enemies.length;
    runner.step();
    for (let i = before; i < enemies.enemies.length; i++) {
      const enemy = enemies.enemies[i];
      if (enemy === undefined) continue;
      log.push({ tick, enemy: enemy.name, x: enemy.x, y: enemy.y });
    }
    if (options.stepEnemies) {
      enemies.step(240, 400);
      bullets.step(240, 400);
    }
  }

  return log;
}

/** A stage of one wave, for measuring expansion arithmetic in isolation. */
function oneWave(wave: WaveEntry, outro = 0): StageSpec {
  return { name: name(), waves: [wave], outro };
}

describe('the registry', () => {
  test('a defined stage comes back out', () => {
    const id = name();
    const spec: StageSpec = {
      name: id,
      seed: 7,
      outro: 30,
      waves: [{ at: 10, enemy: MARK, x: 100, y: -20 }],
    };
    defineStage(id, spec);

    const back = getStage(id);
    expect(back.name).toBe(id);
    expect(back.seed).toBe(7);
    expect(back.outro).toBe(30);
    expect(back.waves).toHaveLength(1);
    expect(stageNames()).toContain(id);
  });

  test('a duplicate name is refused', () => {
    const id = name();
    defineStage(id, { name: id, waves: [] });
    expect(() => defineStage(id, { name: id, waves: [] })).toThrow(
      /already defined/,
    );
  });

  test('an unknown name throws rather than returning undefined', () => {
    expect(() => getStage(`${NS}never-defined`)).toThrow(/unknown stage/);
  });

  test('a spec whose own name disagrees with its key is refused', () => {
    const id = name();
    expect(() => defineStage(id, { name: `${id}-copy`, waves: [] })).toThrow(
      /must match/,
    );
  });

  test('waves are sorted by tick on definition, so authoring order is free', () => {
    const id = name();
    defineStage(id, {
      name: id,
      waves: [
        { at: 300, enemy: MARK, x: 1, y: 0 },
        { at: 100, enemy: MARK, x: 2, y: 0 },
        { at: 200, enemy: MARK, x: 3, y: 0 },
      ],
    });

    expect(getStage(id).waves.map((w) => w.at)).toEqual([100, 200, 300]);
  });

  test('waves sharing a tick keep the order they were written in', () => {
    const id = name();
    defineStage(id, {
      name: id,
      waves: [
        { at: 50, enemy: MARK, x: 1, y: 0 },
        { at: 50, enemy: OTHER, x: 2, y: 0 },
        { at: 50, enemy: MARK, x: 3, y: 0 },
      ],
    });

    // Same-tick order is draw order once these reach the enemy system, so a
    // stable sort here is a visible property, not an implementation detail.
    expect(getStage(id).waves.map((w) => w.x)).toEqual([1, 2, 3]);
  });

  test('mutating the authored array afterwards cannot change a registered stage', () => {
    const id = name();
    const waves: WaveEntry[] = [{ at: 10, enemy: MARK, x: 0, y: 0 }];
    defineStage(id, { name: id, waves });

    waves.push({ at: 20, enemy: MARK, x: 0, y: 0 });
    expect(getStage(id).waves).toHaveLength(1);
  });
});

describe('validation', () => {
  test('a fractional tick is refused — it would never be reached', () => {
    expect(() => defineStage(name(), { name: '', waves: [] })).toThrow();

    const id = name();
    expect(() =>
      defineStage(id, {
        name: id,
        waves: [{ at: 12.5, enemy: MARK, x: 0, y: 0 }],
      }),
    ).toThrow(/"at" must be a whole tick count, got 12.5/);
  });

  test('a negative tick is refused', () => {
    const id = name();
    expect(() =>
      defineStage(id, { name: id, waves: [{ at: -1, enemy: MARK, x: 0, y: 0 }] }),
    ).toThrow(/"at" must be a whole tick count/);
  });

  test('count must be a positive whole number', () => {
    for (const count of [0, -2, 1.5]) {
      const id = name();
      expect(() =>
        defineStage(id, {
          name: id,
          waves: [{ at: 0, enemy: MARK, x: 0, y: 0, count }],
        }),
      ).toThrow(/"count" must be a positive whole number/);
    }
  });

  test('interval must be a whole, non-negative tick count', () => {
    for (const interval of [-1, 0.5]) {
      const id = name();
      expect(() =>
        defineStage(id, {
          name: id,
          waves: [{ at: 0, enemy: MARK, x: 0, y: 0, count: 3, interval }],
        }),
      ).toThrow(/"interval" must be a whole tick count/);
    }
  });

  test('outro must be a whole, non-negative tick count', () => {
    for (const outro of [-1, 2.5]) {
      const id = name();
      expect(() => defineStage(id, { name: id, waves: [], outro })).toThrow(
        /outro must be a whole tick count/,
      );
    }
  });

  test('the message names the stage and the offending wave', () => {
    const id = name();
    expect(() =>
      defineStage(id, {
        name: id,
        waves: [
          { at: 0, enemy: MARK, x: 0, y: 0 },
          { at: 1.25, enemy: OTHER, x: 0, y: 0 },
        ],
      }),
    ).toThrow(new RegExp(`stage "${id}" wave 1 \\(${OTHER}\\)`));
  });

  test('the runner validates too, so an unregistered spec is checked as well', () => {
    const { enemies } = makeField();
    const spec: StageSpec = {
      name: name(),
      waves: [{ at: 4.5, enemy: MARK, x: 0, y: 0 }],
    };
    expect(() => new StageRunner(spec, enemies)).toThrow(/whole tick count/);
  });

  test('an unknown enemy fails at construction, not forty seconds in', () => {
    const { enemies } = makeField();
    const spec: StageSpec = {
      name: name(),
      waves: [{ at: 3000, enemy: `${NS}no-such-enemy`, x: 0, y: 0 }],
    };
    expect(() => new StageRunner(spec, enemies)).toThrow(/unknown enemy/);
  });
});

describe('wave expansion', () => {
  test('count: 1 is one spawn, on its own tick, with no offset applied', () => {
    const log = spawnLog(
      oneWave({ at: 5, enemy: MARK, x: 100, y: -20, count: 1, stepX: 999, stepY: 999 }),
      20,
    );
    expect(log).toEqual([{ tick: 5, enemy: MARK, x: 100, y: -20 }]);
  });

  test('an omitted count behaves exactly like count: 1', () => {
    const bare = spawnLog(oneWave({ at: 5, enemy: MARK, x: 100, y: -20 }), 20);
    const explicit = spawnLog(
      oneWave({ at: 5, enemy: MARK, x: 100, y: -20, count: 1 }),
      20,
    );
    expect(bare).toEqual(explicit);
  });

  test('count and interval space repeats by exactly interval ticks', () => {
    const log = spawnLog(
      oneWave({ at: 100, enemy: MARK, x: 50, y: 0, count: 4, interval: 20 }),
      400,
    );
    expect(log.map((s) => s.tick)).toEqual([100, 120, 140, 160]);
  });

  test('interval: 0 puts the whole group on one tick, in order', () => {
    const log = spawnLog(
      oneWave({
        at: 30,
        enemy: MARK,
        x: 100,
        y: -20,
        count: 3,
        interval: 0,
        stepX: 40,
      }),
      60,
    );
    expect(log).toEqual([
      { tick: 30, enemy: MARK, x: 100, y: -20 },
      { tick: 30, enemy: MARK, x: 140, y: -20 },
      { tick: 30, enemy: MARK, x: 180, y: -20 },
    ]);
  });

  test('an omitted interval behaves exactly like interval: 0', () => {
    const bare = spawnLog(
      oneWave({ at: 30, enemy: MARK, x: 0, y: 0, count: 3, stepX: 10 }),
      60,
    );
    const explicit = spawnLog(
      oneWave({ at: 30, enemy: MARK, x: 0, y: 0, count: 3, interval: 0, stepX: 10 }),
      60,
    );
    expect(bare).toEqual(explicit);
  });

  test('stepX and stepY offset by k steps, not by a running sum of something else', () => {
    const log = spawnLog(
      oneWave({
        at: 0,
        enemy: MARK,
        x: 200,
        y: -10,
        count: 4,
        interval: 5,
        stepX: -18,
        stepY: -12,
      }),
      60,
    );
    expect(log).toEqual([
      { tick: 0, enemy: MARK, x: 200, y: -10 },
      { tick: 5, enemy: MARK, x: 182, y: -22 },
      { tick: 10, enemy: MARK, x: 164, y: -34 },
      { tick: 15, enemy: MARK, x: 146, y: -46 },
    ]);
  });

  test('a long wave interleaves with waves that start after it', () => {
    // Sorting the waves alone would emit all of A then all of B. The schedule
    // has to be re-sorted after expansion or B would spawn late.
    const log = spawnLog(
      {
        name: name(),
        waves: [
          { at: 0, enemy: MARK, x: 0, y: 0, count: 4, interval: 50 },
          { at: 25, enemy: OTHER, x: 0, y: 0, count: 3, interval: 50 },
        ],
      },
      300,
    );

    expect(log.map((s) => s.tick)).toEqual([0, 25, 50, 75, 100, 125, 150]);
    expect(log.map((s) => s.enemy)).toEqual([
      MARK,
      OTHER,
      MARK,
      OTHER,
      MARK,
      OTHER,
      MARK,
    ]);
  });

  test('a wave written out of order still spawns at its authored tick', () => {
    const log = spawnLog(
      {
        name: name(),
        waves: [
          { at: 200, enemy: MARK, x: 3, y: 0 },
          { at: 10, enemy: MARK, x: 1, y: 0 },
          { at: 100, enemy: MARK, x: 2, y: 0 },
        ],
      },
      300,
    );
    expect(log.map((s) => [s.tick, s.x])).toEqual([
      [10, 1],
      [100, 2],
      [200, 3],
    ]);
  });

  test('a stage with no waves spawns nothing', () => {
    expect(spawnLog({ name: name(), waves: [] }, 100)).toEqual([]);
  });
});

describe('timing is exact', () => {
  test('a wave at tick 120 spawns on tick 120 — not 119, not 121', () => {
    const { enemies } = makeField();
    const runner = new StageRunner(
      oneWave({ at: 120, enemy: MARK, x: 0, y: 0 }),
      enemies,
    );

    for (let i = 0; i < 120; i++) runner.step();
    expect(runner.tick).toBe(120);
    expect(enemies.count).toBe(0);

    runner.step();
    expect(enemies.count).toBe(1);
  });

  test('tick counts steps taken, and reports the tick the next step will run', () => {
    const { enemies } = makeField();
    const runner = new StageRunner({ name: name(), waves: [] }, enemies);
    expect(runner.tick).toBe(0);
    runner.step();
    expect(runner.tick).toBe(1);
  });

  test('the schedule does not depend on the seed', () => {
    // Spawn timing is authored data. Only what the enemies then *do* is
    // allowed to vary with the stream.
    sim.seed(1);
    const a = spawnLog(SCHEDULE_STAGE, 1900, { stepEnemies: true });
    sim.seed(999);
    const b = spawnLog(SCHEDULE_STAGE, 1900, { stepEnemies: true });
    expect(a).toEqual(b);
  });
});

describe('finished', () => {
  test('outro: 0 finishes on the step that spawns the last wave', () => {
    const { enemies } = makeField();
    const runner = new StageRunner(oneWave({ at: 10, enemy: MARK, x: 0, y: 0 }, 0), enemies);

    for (let i = 0; i < 10; i++) runner.step();
    expect(runner.finished).toBe(false);

    runner.step(); // the spawn lands here
    expect(enemies.count).toBe(1);
    expect(runner.finished).toBe(true);
  });

  test('outro: 60 finishes exactly sixty ticks after that', () => {
    const { enemies } = makeField();
    const runner = new StageRunner(
      oneWave({ at: 10, enemy: MARK, x: 0, y: 0 }, 60),
      enemies,
    );

    for (let i = 0; i <= 10; i++) runner.step(); // through the spawn tick
    expect(runner.finished).toBe(false);

    for (let i = 0; i < 59; i++) runner.step();
    expect(runner.finished).toBe(false);

    runner.step();
    expect(runner.finished).toBe(true);
  });

  test('the outro is measured from the last repeat, not the wave that started it', () => {
    const { enemies } = makeField();
    const runner = new StageRunner(
      oneWave({ at: 0, enemy: MARK, x: 0, y: 0, count: 5, interval: 30 }, 10),
      enemies,
    );

    // Last repeat lands on tick 120, so the stage ends after tick 130. Had the
    // outro been measured from `at` instead, it would have ended at tick 10.
    for (let i = 0; i < 130; i++) runner.step();
    expect(runner.finished).toBe(false);
    runner.step();
    expect(runner.finished).toBe(true);
  });

  test('a stage with no waves and no outro is over before it starts', () => {
    const { enemies } = makeField();
    const runner = new StageRunner({ name: name(), waves: [] }, enemies);
    expect(runner.finished).toBe(true);
  });

  test('a stage with no waves still serves its outro', () => {
    const { enemies } = makeField();
    const runner = new StageRunner({ name: name(), waves: [], outro: 30 }, enemies);

    for (let i = 0; i < 30; i++) {
      expect(runner.finished).toBe(false);
      runner.step();
    }
    expect(runner.finished).toBe(true);
  });

  test('survivors do not keep a stage running', () => {
    const { enemies } = makeField();
    const runner = new StageRunner(oneWave({ at: 0, enemy: MARK, x: 240, y: 240 }, 5), enemies);

    for (let i = 0; i < 6; i++) runner.step();
    expect(runner.finished).toBe(true);
    // Whether the field is clear is the game's question, not the runner's.
    expect(enemies.count).toBe(1);
  });

  test('an empty field does not finish a stage early', () => {
    const { enemies } = makeField();
    const runner = new StageRunner(
      { name: name(), waves: [{ at: 500, enemy: MARK, x: 0, y: 0 }] },
      enemies,
    );

    for (let i = 0; i < 100; i++) runner.step();
    expect(enemies.count).toBe(0);
    expect(runner.finished).toBe(false);
  });
});

describe('reset', () => {
  test('rewinds the schedule and replays it identically', () => {
    const { enemies } = makeField();
    const spec = oneWave({ at: 3, enemy: MARK, x: 10, y: 20, count: 3, interval: 4 }, 5);
    const runner = new StageRunner(spec, enemies);

    const run = (): number[] => {
      const ticks: number[] = [];
      enemies.clear();
      for (let tick = 0; !runner.finished; tick++) {
        const before = enemies.count;
        runner.step();
        for (let i = before; i < enemies.count; i++) ticks.push(tick);
      }
      return ticks;
    };

    const first = run();
    expect(first).toEqual([3, 7, 11]);

    runner.reset();
    expect(runner.tick).toBe(0);
    expect(runner.finished).toBe(false);
    expect(run()).toEqual(first);
  });

  test('resetting mid-run replays the waves already spawned', () => {
    const { enemies } = makeField();
    const runner = new StageRunner(
      oneWave({ at: 0, enemy: MARK, x: 0, y: 0, count: 3, interval: 10 }),
      enemies,
    );

    for (let i = 0; i < 15; i++) runner.step();
    expect(enemies.count).toBe(2);

    runner.reset();
    for (let i = 0; i < 25; i++) runner.step();
    expect(enemies.count).toBe(5); // 2 from before, all 3 again
  });

  test('reset does not clear the field', () => {
    const { enemies } = makeField();
    const runner = new StageRunner(oneWave({ at: 0, enemy: MARK, x: 0, y: 0 }), enemies);
    runner.step();
    runner.reset();
    expect(enemies.count).toBe(1);
  });
});

describe('the runner spawns and nothing else', () => {
  test('a spawned enemy does not move until the enemy system is stepped', () => {
    const { enemies } = makeField();
    const runner = new StageRunner(
      oneWave({ at: 0, enemy: MARK, x: 123, y: -45 }),
      enemies,
    );
    runner.step();
    runner.step();
    runner.step();

    const enemy = enemies.enemies[0];
    expect(enemy).toBeDefined();
    expect(enemy?.x).toBe(123);
    expect(enemy?.y).toBe(-45);
    expect(enemy?.age).toBe(0);
  });

  test('a refused spawn is consumed, not retried on a later tick', () => {
    // Timing must not drift with pool pressure: a wave the pool could not
    // honour is dropped, and the waves after it still land on their own ticks.
    const { enemies } = makeField({ enemyMax: 2 });
    const runner = new StageRunner(
      oneWave({ at: 0, enemy: MARK, x: 0, y: 0, count: 5, interval: 10 }),
      enemies,
    );

    for (let i = 0; i < 60; i++) runner.step();
    expect(enemies.count).toBe(2);
    expect(enemies.droppedSpawns).toBe(3);
  });

  test('the runner draws nothing from the sim stream itself', () => {
    // Its enemies may draw; the schedule may not. A stage that consumed the
    // stream would shift every later bullet by how many enemies it spawned.
    const { enemies } = makeField();
    const runner = new StageRunner(
      oneWave({ at: 0, enemy: MARK, x: 0, y: 0, count: 20, interval: 1 }),
      enemies,
    );

    sim.seed(42);
    const before = sim.getState();
    for (let i = 0; i < 40; i++) runner.step();
    expect(sim.getState()).toEqual(before);
  });

  test('a supplied rng is what reaches the enemy system', () => {
    const { enemies } = makeField();
    const runner = new StageRunner(
      oneWave({ at: 0, enemy: MARK, x: 0, y: 0, count: 5, interval: 1 }),
      enemies,
    );

    const rng = new Random(3);
    const before = sim.getState();
    for (let i = 0; i < 10; i++) runner.step(rng);
    expect(sim.getState()).toEqual(before);
  });
});

// The stage-1-specific cases that used to close this file — "stage-1 is a real
// stage" and "a full stage reproduces exactly" — verified the shipped stage's
// content and the whole stage+enemies+bullets composition against `stage-1`.
// That campaign moved into the bundled base pack, which a content-side unit test
// may not import. The runner machinery those cases leaned on is covered above
// against local fixtures, and the real thing is covered at the composition root:
// `src/base-content.golden.test.ts` replays stage-1 and stage-2 end to end,
// byte-identically, at two tiers, and `src/reachability.test.ts` proves every
// wave, enemy and boss a real playthrough reaches.
