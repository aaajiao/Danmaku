import { describe, expect, test } from 'bun:test';
import { Random } from '../core/random';
import {
  BombSystem,
  bombNames,
  defineBomb,
  getBombSpec,
  type BombSpec,
} from './bomb';
import { BulletSystem, type BulletSpec, type FieldBounds } from './bullet';
import { defineEnemy, EnemySystem } from './enemy';

const FIELD: FieldBounds = { width: 480, height: 480, margin: 32 };

/**
 * Every test drives its own generator rather than the global `sim` stream, so
 * no test can move another test's outcome by drawing from it.
 */
function rng(seed = 1): Random {
  return new Random(seed);
}

/** Stationary unless the caller asks for motion — nothing drifts out of range. */
function makeBulletSpec(overrides: Partial<BulletSpec> = {}): BulletSpec {
  return {
    style: { sprite: 'orb.small' },
    radius: 3,
    motion: { r: 0, theta: 90 },
    ...overrides,
  };
}

/**
 * Bomb names are global, so every test that registers one uses a unique name.
 * `defineBomb` throwing on a duplicate is itself under test below.
 */
let nextName = 0;
function defineTestBomb(overrides: Partial<BombSpec> = {}): string {
  const name = `test.bomb.${nextName++}`;
  defineBomb(name, {
    duration: 10,
    invulnTicks: 30,
    damagePerTick: 1,
    ...overrides,
  });
  return name;
}

// Stationary, patternless, and tough enough to survive a long bomb — these
// tests are about the bomb, not about enemy behaviour.
defineEnemy('test.bomb.target', {
  sprite: 'orb.large',
  hp: 100,
  radius: 10,
  motion: { r: 0, theta: 90 },
  despawnMargin: 4096,
});

interface Field {
  bullets: BulletSystem;
  enemies: EnemySystem;
  bombs: BombSystem;
}

function makeField(): Field {
  const bullets = new BulletSystem({ bounds: FIELD, initial: 64 });
  const enemies = new EnemySystem({ bounds: FIELD, bullets, initial: 16 });
  return { bullets, enemies, bombs: new BombSystem({ bounds: FIELD }) };
}

describe('the registry', () => {
  test('a defined bomb can be read back', () => {
    const name = defineTestBomb({ duration: 42, damagePerTick: 3 });
    const spec = getBombSpec(name);
    expect(spec.duration).toBe(42);
    expect(spec.damagePerTick).toBe(3);
  });

  test('defining the same name twice throws', () => {
    const name = defineTestBomb();
    expect(() => defineBomb(name, getBombSpec(name))).toThrow(/already defined/);
  });

  test('an unknown name throws rather than misfiring silently', () => {
    expect(() => getBombSpec('test.bomb.nonexistent')).toThrow(/unknown bomb/);
  });

  test('a registered bomb is enumerable, so tooling can list it', () => {
    // The shipped bombs — spread and lance — are no longer defined here; they
    // moved into the bundled base pack (decisions-round2 §D), which a `src/sim`
    // test may not import. Their specs are pinned by the port gate
    // (`src/base-player.golden.test.ts`) and their behaviour by
    // `src/base-content.golden.test.ts`. Here the registry itself is under test,
    // against a local fixture, so it holds when this file runs alone.
    const name = defineTestBomb();
    expect(bombNames()).toContain(name);
  });
});

describe('fire', () => {
  test('starts a bomb at the given point and reports it', () => {
    const { bombs } = makeField();
    const name = defineTestBomb({ duration: 10 });

    expect(bombs.fire(name, 120, 200)).toBe(true);
    expect(bombs.active).toBe(true);
    expect(bombs.remaining).toBe(10);
    expect(bombs.x).toBe(120);
    expect(bombs.y).toBe(200);
    expect(bombs.name).toBe(name);
  });

  test('an idle system is inert', () => {
    const { bombs } = makeField();
    expect(bombs.active).toBe(false);
    expect(bombs.remaining).toBe(0);
    expect(bombs.name).toBe('');
  });

  test('firing while a bomb burns is refused, not queued', () => {
    const { bullets, enemies, bombs } = makeField();
    const first = defineTestBomb({ duration: 10 });
    const second = defineTestBomb({ duration: 99 });

    bombs.fire(first, 10, 10);
    expect(bombs.fire(second, 400, 400)).toBe(false);

    // The refused bomb left nothing behind: not its position, not its clock.
    expect(bombs.x).toBe(10);
    expect(bombs.y).toBe(10);
    expect(bombs.remaining).toBe(10);
    expect(bombs.name).toBe(first);

    // And it does not land later either — a refusal is not a deferral.
    for (let i = 0; i < 40; i++) bombs.step(bullets, enemies, rng());
    expect(bombs.active).toBe(false);
  });

  test('a bomb can be fired again once the previous one has burned out', () => {
    const { bullets, enemies, bombs } = makeField();
    const name = defineTestBomb({ duration: 3 });

    expect(bombs.fire(name, 0, 0)).toBe(true);
    for (let i = 0; i < 3; i++) bombs.step(bullets, enemies, rng());
    expect(bombs.active).toBe(false);
    expect(bombs.fire(name, 50, 60)).toBe(true);
    expect(bombs.x).toBe(50);
  });

  test('an unknown name throws and starts nothing', () => {
    const { bombs } = makeField();
    expect(() => bombs.fire('test.bomb.nonexistent', 0, 0)).toThrow(/unknown bomb/);
    expect(bombs.active).toBe(false);
  });

  test('a zero-duration spec still lands one tick', () => {
    const { bullets, enemies, bombs } = makeField();
    // A bomb that consumed a stock and did nothing would read to the player as
    // a dropped input.
    const name = defineTestBomb({ duration: 0, damagePerTick: 5 });
    const enemy = enemies.spawn('test.bomb.target', 100, 100, rng());

    bombs.fire(name, 100, 100);
    expect(bombs.remaining).toBe(1);
    bombs.step(bullets, enemies, rng());

    expect(enemy?.hp).toBe(95);
    expect(bombs.active).toBe(false);
  });
});

describe('damage', () => {
  test('is applied once per tick, not as a lump', () => {
    const { bullets, enemies, bombs } = makeField();
    const name = defineTestBomb({ duration: 5, damagePerTick: 4 });
    const enemy = enemies.spawn('test.bomb.target', 200, 200, rng());

    bombs.fire(name, 200, 200);
    bombs.step(bullets, enemies, rng());
    expect(enemy?.hp).toBe(96);
    bombs.step(bullets, enemies, rng());
    expect(enemy?.hp).toBe(92);
  });

  test('stops when the bomb expires', () => {
    const { bullets, enemies, bombs } = makeField();
    const name = defineTestBomb({ duration: 3, damagePerTick: 4 });
    const enemy = enemies.spawn('test.bomb.target', 200, 200, rng());

    bombs.fire(name, 200, 200);
    for (let i = 0; i < 10; i++) bombs.step(bullets, enemies, rng());

    expect(bombs.active).toBe(false);
    expect(enemy?.hp).toBe(100 - 3 * 4);
  });

  test('a kill is recorded as a death, so it pays score and drops', () => {
    const { bullets, enemies, bombs } = makeField();
    const name = defineTestBomb({ duration: 60, damagePerTick: 50 });
    enemies.spawn('test.bomb.target', 200, 200, rng());

    bombs.fire(name, 200, 200);
    bombs.step(bullets, enemies, rng());
    expect(enemies.drainDeaths().length).toBe(0);

    bombs.step(bullets, enemies, rng());
    const deaths = enemies.drainDeaths();
    expect(deaths.length).toBe(1);
    expect(deaths[0]?.name).toBe('test.bomb.target');
    expect(enemies.count).toBe(0);
  });

  test('every enemy in range dies in the same tick', () => {
    // `EnemySystem.damage` splices, so a forward walk would skip the enemy
    // shifted into each vacated slot and spare it for a tick.
    const { bullets, enemies, bombs } = makeField();
    const name = defineTestBomb({ duration: 5, damagePerTick: 200 });
    for (let i = 0; i < 6; i++) enemies.spawn('test.bomb.target', 100 + i, 100, rng());

    bombs.fire(name, 100, 100);
    bombs.step(bullets, enemies, rng());

    expect(enemies.count).toBe(0);
    expect(enemies.drainDeaths().length).toBe(6);
  });

  test('a radius spares what is outside it', () => {
    const { bullets, enemies, bombs } = makeField();
    const name = defineTestBomb({ duration: 5, damagePerTick: 10, radius: 50 });
    const near = enemies.spawn('test.bomb.target', 240, 260, rng());
    const far = enemies.spawn('test.bomb.target', 240, 400, rng());

    bombs.fire(name, 240, 240);
    bombs.step(bullets, enemies, rng());

    expect(near?.hp).toBe(90);
    expect(far?.hp).toBe(100);
  });

  test('the enemy hitbox counts, not only its centre', () => {
    const { bullets, enemies, bombs } = makeField();
    const name = defineTestBomb({ duration: 5, damagePerTick: 10, radius: 50 });
    // Centre 55px away, radius 10 — clipped by the blast, so it takes damage.
    const clipped = enemies.spawn('test.bomb.target', 295, 240, rng());

    bombs.fire(name, 240, 240);
    bombs.step(bullets, enemies, rng());

    expect(clipped?.hp).toBe(90);
  });

  test('without a radius the whole field is in range', () => {
    const { bullets, enemies, bombs } = makeField();
    const name = defineTestBomb({ duration: 5, damagePerTick: 10 });
    const corner = enemies.spawn('test.bomb.target', 1, 1, rng());
    const opposite = enemies.spawn('test.bomb.target', 479, 479, rng());

    bombs.fire(name, 240, 240);
    bombs.step(bullets, enemies, rng());

    expect(corner?.hp).toBe(90);
    expect(opposite?.hp).toBe(90);
  });

  test('a field-wide bomb does not reach an enemy still offscreen', () => {
    // The screen-clear buys the screen, not the rest of the wave.
    const { bullets, enemies, bombs } = makeField();
    const name = defineTestBomb({ duration: 5, damagePerTick: 10 });
    const waiting = enemies.spawn('test.bomb.target', 240, -200, rng());

    bombs.fire(name, 240, 240);
    bombs.step(bullets, enemies, rng());

    expect(waiting?.hp).toBe(100);
  });

  test('a spec with no damage still clears', () => {
    const { bullets, enemies, bombs } = makeField();
    const name = defineTestBomb({ duration: 5, damagePerTick: 0 });
    const enemy = enemies.spawn('test.bomb.target', 200, 200, rng());
    bullets.spawn(200, 200, makeBulletSpec(), 'enemy', rng());

    bombs.fire(name, 200, 200);
    bombs.step(bullets, enemies, rng());

    expect(enemy?.hp).toBe(100);
    expect(bullets.count).toBe(0);
  });
});

describe('clearing', () => {
  test('enemy fire in range is removed', () => {
    const { bullets, enemies, bombs } = makeField();
    const name = defineTestBomb({ duration: 5 });
    for (let i = 0; i < 12; i++) {
      bullets.spawn(200 + i, 200, makeBulletSpec(), 'enemy', rng());
    }

    bombs.fire(name, 200, 200);
    bombs.step(bullets, enemies, rng());

    expect(bullets.count).toBe(0);
  });

  test('player shot is left alone', () => {
    // Eating your own bullets would make bombing a boss cost damage.
    const { bullets, enemies, bombs } = makeField();
    const name = defineTestBomb({ duration: 5 });
    bullets.spawn(200, 200, makeBulletSpec(), 'player', rng());
    bullets.spawn(200, 210, makeBulletSpec(), 'enemy', rng());

    bombs.fire(name, 200, 200);
    bombs.step(bullets, enemies, rng());

    expect(bullets.count).toBe(1);
    expect(bullets.bullets[0]?.faction).toBe('player');
  });

  test('a radius spares fire outside it', () => {
    const { bullets, enemies, bombs } = makeField();
    const name = defineTestBomb({ duration: 5, radius: 40 });
    bullets.spawn(240, 260, makeBulletSpec(), 'enemy', rng());
    const outside = bullets.spawn(240, 400, makeBulletSpec(), 'enemy', rng());

    bombs.fire(name, 240, 240);
    bombs.step(bullets, enemies, rng());

    expect(bullets.count).toBe(1);
    expect(bullets.bullets[0]).toBe(outside!);
  });

  test('fire that arrives mid-bomb is caught too', () => {
    // The bomb is a window, not an instant: it has to keep eating what the
    // pattern keeps sending, or its duration would buy nothing.
    const { bullets, enemies, bombs } = makeField();
    const name = defineTestBomb({ duration: 5 });

    bombs.fire(name, 200, 200);
    bombs.step(bullets, enemies, rng());
    bullets.spawn(200, 200, makeBulletSpec(), 'enemy', rng());
    bombs.step(bullets, enemies, rng());

    expect(bullets.count).toBe(0);
  });

  test('converted bullets are reported at their positions', () => {
    const { bullets, enemies, bombs } = makeField();
    const name = defineTestBomb({ duration: 5, convertBullets: true });
    bullets.spawn(100, 110, makeBulletSpec(), 'enemy', rng());
    bullets.spawn(120, 130, makeBulletSpec(), 'enemy', rng());

    bombs.fire(name, 100, 100);
    bombs.step(bullets, enemies, rng());

    const cleared = bombs.drainCleared();
    expect(cleared.length).toBe(2);
    // Positions are snapshotted before the despawn, so the pool reusing the
    // slot cannot overwrite what the game is about to drop items on.
    expect([...cleared].map((c) => `${c.x},${c.y}`).sort()).toEqual([
      '100,110',
      '120,130',
    ]);
  });

  test('without conversion the bullets are gone and pay nothing', () => {
    const { bullets, enemies, bombs } = makeField();
    const name = defineTestBomb({ duration: 5, convertBullets: false });
    bullets.spawn(100, 110, makeBulletSpec(), 'enemy', rng());

    bombs.fire(name, 100, 100);
    bombs.step(bullets, enemies, rng());

    expect(bullets.count).toBe(0);
    expect(bombs.drainCleared().length).toBe(0);
  });

  test('a drain empties the list', () => {
    const { bullets, enemies, bombs } = makeField();
    const name = defineTestBomb({ duration: 5, convertBullets: true });
    bullets.spawn(100, 110, makeBulletSpec(), 'enemy', rng());

    bombs.fire(name, 100, 100);
    bombs.step(bullets, enemies, rng());

    expect(bombs.drainCleared().length).toBe(1);
    expect(bombs.drainCleared().length).toBe(0);
  });

  test('cleared positions accumulate across ticks until drained', () => {
    const { bullets, enemies, bombs } = makeField();
    const name = defineTestBomb({ duration: 5, convertBullets: true });

    bombs.fire(name, 100, 100);
    bullets.spawn(100, 110, makeBulletSpec(), 'enemy', rng());
    bombs.step(bullets, enemies, rng());
    bullets.spawn(100, 120, makeBulletSpec(), 'enemy', rng());
    bombs.step(bullets, enemies, rng());

    expect(bombs.drainCleared().length).toBe(2);
  });

  test('the drained array is recycled, so a caller must read it before the next drain', () => {
    const { bullets, enemies, bombs } = makeField();
    const name = defineTestBomb({ duration: 5, convertBullets: true });
    bullets.spawn(100, 110, makeBulletSpec(), 'enemy', rng());

    bombs.fire(name, 100, 100);
    bombs.step(bullets, enemies, rng());
    const first = bombs.drainCleared();
    expect(first.length).toBe(1);

    bullets.spawn(100, 120, makeBulletSpec(), 'enemy', rng());
    bombs.step(bullets, enemies, rng());
    bombs.drainCleared();
    // Documented behaviour, asserted so a future change to the buffering has
    // to update the contract rather than quietly break a caller that holds on.
    expect(first.length).toBe(0);
  });
});

describe('lifetime', () => {
  test('remaining counts down one per tick', () => {
    const { bullets, enemies, bombs } = makeField();
    const name = defineTestBomb({ duration: 3 });

    bombs.fire(name, 0, 0);
    expect(bombs.remaining).toBe(3);
    bombs.step(bullets, enemies, rng());
    expect(bombs.remaining).toBe(2);
    bombs.step(bullets, enemies, rng());
    expect(bombs.remaining).toBe(1);
    bombs.step(bullets, enemies, rng());
    expect(bombs.remaining).toBe(0);
    expect(bombs.active).toBe(false);
  });

  test('stepping an idle system does nothing', () => {
    const { bullets, enemies, bombs } = makeField();
    const enemy = enemies.spawn('test.bomb.target', 200, 200, rng());
    bullets.spawn(200, 200, makeBulletSpec(), 'enemy', rng());

    for (let i = 0; i < 10; i++) bombs.step(bullets, enemies, rng());

    expect(enemy?.hp).toBe(100);
    expect(bullets.count).toBe(1);
    expect(bombs.drainCleared().length).toBe(0);
  });

  test('clear cancels the bomb', () => {
    const { bullets, enemies, bombs } = makeField();
    const name = defineTestBomb({ duration: 30, damagePerTick: 10 });
    const enemy = enemies.spawn('test.bomb.target', 200, 200, rng());

    bombs.fire(name, 200, 200);
    bombs.step(bullets, enemies, rng());
    bombs.clear();
    bombs.step(bullets, enemies, rng());

    expect(bombs.active).toBe(false);
    expect(bombs.name).toBe('');
    expect(enemy?.hp).toBe(90);
  });

  test('clear keeps cleared positions already owed to the caller', () => {
    const { bullets, enemies, bombs } = makeField();
    const name = defineTestBomb({ duration: 30, convertBullets: true });
    bullets.spawn(100, 110, makeBulletSpec(), 'enemy', rng());

    bombs.fire(name, 100, 100);
    bombs.step(bullets, enemies, rng());
    bombs.clear();

    expect(bombs.drainCleared().length).toBe(1);
  });

  test('clear releases the field for a new bomb', () => {
    const { bombs } = makeField();
    const name = defineTestBomb({ duration: 30 });

    bombs.fire(name, 0, 0);
    bombs.clear();
    expect(bombs.fire(name, 5, 5)).toBe(true);
  });
});

/**
 * The valuable tests. A bomb landing in the middle of a live field must be
 * reproducible tick for tick, or a replay diverges the moment the player
 * panics — which is exactly when they will want to watch it back.
 */
describe('determinism', () => {
  /** Randomized fire, so the scenario actually depends on the sim stream. */
  const SCATTER = makeBulletSpec({
    motion: { rrandom: { min: 0.5, max: 2 }, trandom: { min: 0, max: 360 } },
  });

  interface Snapshot {
    cleared: string[];
    survivors: string[];
    hp: number[];
    deaths: number;
  }

  function run(seed: number, bombName: string): Snapshot {
    const r = new Random(seed);
    const { bullets, enemies, bombs } = makeField();

    for (let i = 0; i < 5; i++) {
      // Spread wide enough that the blast radius covers some and not others.
      enemies.spawn('test.bomb.target', 200 + i * 60, 220 + i * 20, r);
    }

    const cleared: string[] = [];
    let deaths = 0;

    for (let tick = 0; tick < 40; tick++) {
      // A steady stream, so the bomb is eating new fire on every tick of its
      // window rather than a single frozen snapshot.
      for (let i = 0; i < 4; i++) bullets.spawn(240, 200, SCATTER, 'enemy', r);

      if (tick === 10) bombs.fire(bombName, 240, 240);

      bullets.step(240, 400, r);
      enemies.step(240, 400, r);
      bombs.step(bullets, enemies, r);

      for (const c of bombs.drainCleared()) cleared.push(`${c.x},${c.y}`);
      deaths += enemies.drainDeaths().length;
    }

    return {
      cleared,
      survivors: bullets.bullets.map((b) => `${b.x},${b.y}`),
      hp: enemies.enemies.map((e) => e.hp),
      deaths,
    };
  }

  const name = defineTestBomb({
    duration: 12,
    damagePerTick: 10,
    radius: 120,
    convertBullets: true,
  });

  test('the same seed reproduces the run exactly', () => {
    expect(run(20260719, name)).toEqual(run(20260719, name));
  });

  test('a different seed produces a different run', () => {
    // Otherwise the snapshot above could be passing by being blind.
    expect(run(20260719, name)).not.toEqual(run(20260720, name));
  });

  test('the run is not trivially empty', () => {
    const snapshot = run(20260719, name);
    expect(snapshot.cleared.length).toBeGreaterThan(0);
    expect(snapshot.survivors.length).toBeGreaterThan(0);
    expect(snapshot.deaths).toBeGreaterThan(0);
    // Some enemies stood outside the radius: the run exercises both branches.
    expect(snapshot.hp.length).toBeGreaterThan(0);
  });

  test('the bomb itself draws nothing from the stream', () => {
    // Bombing is player-driven and optional. If the bomb consumed draws, the
    // pattern fired after it would differ from the same pattern in a run where
    // the player held the bomb, for no reason the player could see.
    const { bullets, enemies, bombs } = makeField();
    const bombName = defineTestBomb({ duration: 5, convertBullets: true });
    enemies.spawn('test.bomb.target', 200, 200, rng());
    for (let i = 0; i < 8; i++) bullets.spawn(200, 200 + i, SCATTER, 'enemy', rng(3));

    const r = new Random(99);
    const before = r.getState();
    bombs.fire(bombName, 200, 200);
    bombs.step(bullets, enemies, r);

    expect(r.getState()).toEqual(before);
  });
});
