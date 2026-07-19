import { test, expect, describe, beforeEach, afterEach } from 'bun:test';

import { Random } from '../core/random';
import { BulletSystem, type BulletSpec } from '../sim/bullet';
import {
  aimAngle,
  createPattern,
  definePattern,
  Emitter,
  fan,
  patternDefinitions,
  patternNames,
  ring,
  type EmitContext,
  type Pattern,
} from './patterns';

/**
 * The registry is module-level and shared by every test file that imports
 * patterns.ts, so anything defined here is namespaced and never reused.
 */
const NS = 'test:patterns.test/';

/**
 * `theta` is deliberately absurd so a test that reads it back can tell an
 * angle the pattern wrote from `MoveVector`'s default of 90.
 */
const SPEC: BulletSpec = {
  style: { sprite: 'orb.small' },
  radius: 3,
  motion: { r: 2, theta: -999 },
};

/**
 * A spec whose motion draws from the sim stream at init. Spawning one of these
 * consumes a draw *before* the pattern takes its own, which is what makes the
 * interleaving tests able to see a reordering.
 */
const RANDOMIZED_SPEC: BulletSpec = {
  style: { sprite: 'orb.small' },
  radius: 3,
  motion: { r: 2, trandom: { min: 0, max: 360 } },
};

function makeSystem(capacity = 256): BulletSystem {
  return new BulletSystem({
    bounds: { width: 384, height: 448, margin: 32 },
    initial: capacity,
    max: capacity,
  });
}

function makeContext(
  bullets: BulletSystem,
  overrides: Partial<EmitContext> = {},
): EmitContext {
  return {
    age: 0,
    x: 100,
    y: 100,
    targetX: 100,
    targetY: 200,
    bullets,
    rng: new Random(1),
    faction: 'enemy',
    ...overrides,
  };
}

/** Headings of every bullet in the system, in the order they were fired. */
function thetas(bullets: BulletSystem): number[] {
  return bullets.bullets.map((b) => b.vector.theta);
}

/**
 * Drive a pattern for `ticks` ticks, reporting how many bullets each tick
 * produced and what the pattern returned.
 */
function drive(
  pattern: Pattern,
  bullets: BulletSystem,
  ticks: number,
  overrides: Partial<EmitContext> = {},
): { fired: number[]; results: (boolean | void)[] } {
  const fired: number[] = [];
  const results: (boolean | void)[] = [];
  for (let age = 0; age < ticks; age++) {
    const before = bullets.count;
    results.push(pattern(makeContext(bullets, { ...overrides, age })));
    fired.push(bullets.count - before);
  }
  return { fired, results };
}

describe('registry', () => {
  test('definePattern registers a name that patternNames reports', () => {
    const name = `${NS}registered`;
    expect(patternNames()).not.toContain(name);

    definePattern({ name, create: () => () => true });

    expect(patternNames()).toContain(name);
  });

  test('definePattern rejects a duplicate name', () => {
    const name = `${NS}duplicate`;
    definePattern({ name, create: () => () => true });

    expect(() => definePattern({ name, create: () => () => true })).toThrow(
      `pattern "${name}" is already defined`,
    );
  });

  test('a rejected duplicate does not replace the original definition', () => {
    const name = `${NS}duplicate-keeps-original`;
    const original: Pattern = () => true;
    definePattern({ name, create: () => original });

    expect(() => definePattern({ name, create: () => () => false })).toThrow();
    expect(createPattern(name)).toBe(original);
  });

  test('createPattern throws on an unknown name', () => {
    expect(() => createPattern(`${NS}never-defined`)).toThrow(
      'unknown pattern "test:patterns.test/never-defined"',
    );
  });

  test('createPattern hands the options through to create', () => {
    const name = `${NS}options-passthrough`;
    let seen: unknown;
    definePattern({
      name,
      create(options) {
        seen = options;
        return () => true;
      },
    });

    const options = { count: 4, spec: SPEC };
    createPattern(name, options);

    expect(seen).toBe(options);
  });

  test('createPattern returns an independent instance per call', () => {
    const name = `${NS}independent-instances`;
    definePattern({
      name,
      create() {
        let calls = 0;
        return () => {
          calls++;
          return calls < 2;
        };
      },
    });

    const a = createPattern(name);
    const b = createPattern(name);

    expect(a(makeContext(makeSystem()))).toBe(true);
    expect(a(makeContext(makeSystem()))).toBe(false);
    // `b` has its own closure state, so it is still on its first call.
    expect(b(makeContext(makeSystem()))).toBe(true);
  });

  test('the built-in patterns are registered', () => {
    expect(patternNames()).toEqual(
      expect.arrayContaining(['ring', 'spiral', 'aimed-fan', 'spray']),
    );
  });

  test('patternDefinitions exposes the descriptions patternNames omits', () => {
    const ringDefinition = patternDefinitions().find((d) => d.name === 'ring');
    expect(ringDefinition?.description).toBe(
      'Evenly spaced full circle, optionally rotating each volley.',
    );
  });

  test('patternNames and patternDefinitions agree', () => {
    expect(patternDefinitions().map((d) => d.name)).toEqual([...patternNames()]);
  });

  test('the returned name list is a snapshot, not the live registry', () => {
    const before = patternNames();
    definePattern({ name: `${NS}snapshot-probe`, create: () => () => true });
    expect(before).not.toContain(`${NS}snapshot-probe`);
  });
});

describe('ring primitive', () => {
  test('spaces bullets evenly over a full circle', () => {
    const bullets = makeSystem();
    ring(makeContext(bullets), SPEC, 8);

    expect(bullets.count).toBe(8);
    expect(thetas(bullets)).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
  });

  test('adjacent bullets are 360/count apart for an awkward count', () => {
    const bullets = makeSystem();
    ring(makeContext(bullets), SPEC, 7);

    const angles = thetas(bullets);
    expect(angles).toHaveLength(7);
    for (let i = 1; i < angles.length; i++) {
      expect(angles[i]! - angles[i - 1]!).toBeCloseTo(360 / 7, 10);
    }
    // A full circle: the last bullet stops one step short of wrapping.
    expect(angles[6]! + 360 / 7).toBeCloseTo(360, 10);
  });

  test('honours the offset by rotating the whole ring', () => {
    const bullets = makeSystem();
    ring(makeContext(bullets), SPEC, 4, 10);

    expect(thetas(bullets)).toEqual([10, 100, 190, 280]);
  });

  test('a negative offset rotates the other way', () => {
    const bullets = makeSystem();
    ring(makeContext(bullets), SPEC, 4, -30);

    expect(thetas(bullets)).toEqual([-30, 60, 150, 240]);
  });

  test('a count of one fires a single bullet at the offset', () => {
    const bullets = makeSystem();
    ring(makeContext(bullets), SPEC, 1, 42);

    expect(thetas(bullets)).toEqual([42]);
  });

  test('a count of zero fires nothing rather than dividing by zero', () => {
    const bullets = makeSystem();
    ring(makeContext(bullets), SPEC, 0);

    expect(bullets.count).toBe(0);
  });

  test('spawns at the emitter position with the emitter faction', () => {
    const bullets = makeSystem();
    ring(makeContext(bullets, { x: 33, y: 77, faction: 'player' }), SPEC, 3);

    for (const bullet of bullets.bullets) {
      expect(bullet.x).toBe(33);
      expect(bullet.y).toBe(77);
      expect(bullet.faction).toBe('player');
    }
  });

  test('stops cleanly when the bullet pool is exhausted', () => {
    const bullets = makeSystem(3);
    ring(makeContext(bullets), SPEC, 16);

    expect(bullets.count).toBe(3);
    expect(bullets.droppedSpawns).toBe(1);
  });
});

describe('fan primitive', () => {
  test('centres the arc on the given angle and spans the given spread', () => {
    const bullets = makeSystem();
    fan(makeContext(bullets), SPEC, 5, 90, 40);

    expect(thetas(bullets)).toEqual([70, 80, 90, 100, 110]);
  });

  test('an even count straddles the centre without a bullet on it', () => {
    const bullets = makeSystem();
    fan(makeContext(bullets), SPEC, 2, 90, 40);

    expect(thetas(bullets)).toEqual([70, 110]);
  });

  test('the outermost bullets sit exactly one spread apart', () => {
    const bullets = makeSystem();
    fan(makeContext(bullets), SPEC, 6, -30, 75);

    const angles = thetas(bullets);
    expect(angles[5]! - angles[0]!).toBeCloseTo(75, 10);
    // The midpoint of the arc is the requested centre.
    expect((angles[0]! + angles[5]!) / 2).toBeCloseTo(-30, 10);
  });

  test('a single bullet fires on the centre line, with no division by zero', () => {
    const bullets = makeSystem();
    fan(makeContext(bullets), SPEC, 1, 90, 40);

    const angles = thetas(bullets);
    expect(angles).toHaveLength(1);
    expect(Number.isFinite(angles[0]!)).toBe(true);
    expect(angles[0]).toBe(90);
  });

  test('a single bullet ignores the spread entirely', () => {
    const bullets = makeSystem();
    fan(makeContext(bullets), SPEC, 1, 15, 300);

    expect(thetas(bullets)).toEqual([15]);
  });

  test('a zero spread stacks every bullet on the centre', () => {
    const bullets = makeSystem();
    fan(makeContext(bullets), SPEC, 4, 120, 0);

    expect(thetas(bullets)).toEqual([120, 120, 120, 120]);
  });

  test('a count of zero fires nothing', () => {
    const bullets = makeSystem();
    fan(makeContext(bullets), SPEC, 0, 90, 40);

    expect(bullets.count).toBe(0);
  });

  test('stops cleanly when the bullet pool is exhausted', () => {
    const bullets = makeSystem(2);
    fan(makeContext(bullets), SPEC, 9, 90, 80);

    expect(bullets.count).toBe(2);
    expect(bullets.droppedSpawns).toBe(1);
  });
});

describe('aimAngle', () => {
  const at = (targetX: number, targetY: number): number =>
    aimAngle(makeContext(makeSystem(1), { x: 100, y: 100, targetX, targetY }));

  test('a target straight below reads as 90, matching the y-down motion DSL', () => {
    expect(at(100, 200)).toBeCloseTo(90, 10);
  });

  test('a target straight above reads as -90', () => {
    expect(at(100, 0)).toBeCloseTo(-90, 10);
  });

  test('a target straight right reads as 0', () => {
    expect(at(200, 100)).toBeCloseTo(0, 10);
  });

  test('a target straight left reads as 180', () => {
    expect(at(0, 100)).toBeCloseTo(180, 10);
  });

  test('down-right is +45', () => {
    expect(at(200, 200)).toBeCloseTo(45, 10);
  });

  test('down-left is +135', () => {
    expect(at(0, 200)).toBeCloseTo(135, 10);
  });

  test('up-left is -135', () => {
    expect(at(0, 0)).toBeCloseTo(-135, 10);
  });

  test('up-right is -45', () => {
    expect(at(200, 0)).toBeCloseTo(-45, 10);
  });

  test('a target on top of the emitter is a finite angle, not NaN', () => {
    expect(Number.isFinite(at(100, 100))).toBe(true);
  });

  test('the angle depends on direction, not distance', () => {
    expect(at(101, 101)).toBeCloseTo(at(400, 400), 10);
  });
});

describe('ring pattern', () => {
  test('fires on its period and not between', () => {
    const bullets = makeSystem();
    const pattern = createPattern('ring', { spec: SPEC, count: 4, period: 5 });

    const { fired } = drive(pattern, bullets, 11);

    expect(fired).toEqual([4, 0, 0, 0, 0, 4, 0, 0, 0, 0, 4]);
  });

  test('rotation advances between volleys, not between ticks', () => {
    const bullets = makeSystem();
    const pattern = createPattern('ring', {
      spec: SPEC,
      count: 2,
      period: 3,
      rotation: 7,
    });

    drive(pattern, bullets, 9);

    // Three volleys of two, rotated 0, 7 and 14 degrees.
    expect(thetas(bullets)).toEqual([0, 180, 7, 187, 14, 194]);
  });

  test('zero rotation leaves every volley identical', () => {
    const bullets = makeSystem();
    const pattern = createPattern('ring', {
      spec: SPEC,
      count: 2,
      period: 1,
      rotation: 0,
    });

    drive(pattern, bullets, 3);

    expect(thetas(bullets)).toEqual([0, 180, 0, 180, 0, 180]);
  });

  test('returns false once the duration is reached and true before', () => {
    const bullets = makeSystem();
    const pattern = createPattern('ring', {
      spec: SPEC,
      count: 1,
      period: 2,
      duration: 6,
    });

    const { results, fired } = drive(pattern, bullets, 8);

    expect(results).toEqual([true, true, true, true, true, true, false, false]);
    expect(fired).toEqual([1, 0, 1, 0, 1, 0, 0, 0]);
  });

  test('a duration of zero means run forever', () => {
    const bullets = makeSystem();
    const pattern = createPattern('ring', { spec: SPEC, count: 1, period: 1 });

    const { results } = drive(pattern, bullets, 200);

    expect(results.every((r) => r === true)).toBe(true);
    expect(bullets.count).toBe(200);
  });

  test('defaults to sixteen bullets every thirty ticks, rotating seven degrees', () => {
    const bullets = makeSystem();
    const pattern = createPattern('ring', { spec: SPEC });

    const { fired } = drive(pattern, bullets, 31);

    expect(fired[0]).toBe(16);
    expect(fired.slice(1, 30).every((n) => n === 0)).toBe(true);
    expect(fired[30]).toBe(16);
    expect(thetas(bullets)[0]).toBe(0);
    expect(thetas(bullets)[16]).toBe(7);
  });

  test('rotation tracks volleys attempted, not bullets that fit in the pool', () => {
    // Two slots for a three-bullet ring, so every volley is truncated. The
    // rotation must still advance: it is a function of time, not of how many
    // spawns the pool happened to honour, or a run that brushes the ceiling
    // would diverge from one that does not.
    const bullets = makeSystem(2);
    const pattern = createPattern('ring', {
      spec: SPEC,
      count: 3,
      period: 1,
      rotation: 10,
    });

    const volleys: number[][] = [];
    for (let age = 0; age < 3; age++) {
      pattern(makeContext(bullets, { age }));
      volleys.push(thetas(bullets));
      bullets.clear();
    }

    expect(volleys).toEqual([
      [0, 120],
      [10, 130],
      [20, 140],
    ]);
    expect(bullets.droppedSpawns).toBe(3);
  });
});

describe('spiral pattern', () => {
  test('fires one bullet per arm on its period and not between', () => {
    const bullets = makeSystem();
    const pattern = createPattern('spiral', { spec: SPEC, arms: 3, period: 4 });

    const { fired } = drive(pattern, bullets, 9);

    expect(fired).toEqual([3, 0, 0, 0, 3, 0, 0, 0, 3]);
  });

  test('arms are evenly spaced and the whole spiral advances by step per volley', () => {
    const bullets = makeSystem();
    const pattern = createPattern('spiral', {
      spec: SPEC,
      arms: 4,
      step: 11,
      period: 2,
    });

    drive(pattern, bullets, 4);

    expect(thetas(bullets)).toEqual([
      0, 90, 180, 270, // first volley
      11, 101, 191, 281, // second, advanced by one step
    ]);
  });

  test('respects duration', () => {
    const bullets = makeSystem();
    const pattern = createPattern('spiral', {
      spec: SPEC,
      arms: 1,
      period: 1,
      duration: 3,
    });

    const { results, fired } = drive(pattern, bullets, 5);

    expect(results).toEqual([true, true, true, false, false]);
    expect(fired).toEqual([1, 1, 1, 0, 0]);
  });

  test('a single arm still advances by step each volley', () => {
    const bullets = makeSystem();
    const pattern = createPattern('spiral', {
      spec: SPEC,
      arms: 1,
      step: 5,
      period: 1,
    });

    drive(pattern, bullets, 4);

    expect(thetas(bullets)).toEqual([0, 5, 10, 15]);
  });

  test('stops the volley when the pool is exhausted but keeps running', () => {
    const bullets = makeSystem(2);
    const pattern = createPattern('spiral', { spec: SPEC, arms: 5, period: 1 });

    const { results } = drive(pattern, bullets, 2);

    expect(bullets.count).toBe(2);
    expect(results).toEqual([true, true]);
  });

  test('a truncated volley still advances the angle for the next one', () => {
    // Three slots for a four-arm spiral, so every volley is cut mid-arm. The
    // angle must keep advancing regardless: bailing out of the volley without
    // advancing would freeze the spiral for as long as the pool stayed full.
    // Clearing between volleys is what makes the *following* volley visible —
    // without it the exhausted pool hides the very thing under test.
    const bullets = makeSystem(3);
    const pattern = createPattern('spiral', {
      spec: SPEC,
      arms: 4,
      step: 7,
      period: 1,
    });

    const volleys: number[][] = [];
    for (let age = 0; age < 3; age++) {
      pattern(makeContext(bullets, { age }));
      volleys.push(thetas(bullets));
      bullets.clear();
    }

    expect(volleys).toEqual([
      [0, 90, 180],
      [7, 97, 187],
      [14, 104, 194],
    ]);
    expect(bullets.droppedSpawns).toBe(3);
  });

  test('defaults to three arms advancing eleven degrees every three ticks', () => {
    const bullets = makeSystem();
    const pattern = createPattern('spiral', { spec: SPEC });

    const { fired } = drive(pattern, bullets, 7);

    expect(fired).toEqual([3, 0, 0, 3, 0, 0, 3]);
    expect(thetas(bullets)).toEqual([
      0, 120, 240, //
      11, 131, 251,
      22, 142, 262,
    ]);
  });
});

describe('aimed-fan pattern', () => {
  test('centres the fan on the target', () => {
    const bullets = makeSystem();
    const pattern = createPattern('aimed-fan', {
      spec: SPEC,
      count: 3,
      spread: 60,
      period: 10,
    });

    // Target sits straight below the emitter, so the aim angle is 90.
    drive(pattern, bullets, 1, { x: 100, y: 100, targetX: 100, targetY: 200 });

    expect(thetas(bullets)).toEqual([60, 90, 120]);
  });

  test('re-aims at the target position at each volley', () => {
    const bullets = makeSystem();
    const pattern = createPattern('aimed-fan', {
      spec: SPEC,
      count: 1,
      spread: 40,
      period: 1,
    });

    pattern(makeContext(bullets, { age: 0, targetX: 200, targetY: 100 }));
    pattern(makeContext(bullets, { age: 1, targetX: 100, targetY: 200 }));

    const angles = thetas(bullets);
    expect(angles[0]).toBeCloseTo(0, 10);
    expect(angles[1]).toBeCloseTo(90, 10);
  });

  test('fires on its period and not between', () => {
    const bullets = makeSystem();
    const pattern = createPattern('aimed-fan', {
      spec: SPEC,
      count: 2,
      period: 3,
    });

    const { fired } = drive(pattern, bullets, 7);

    expect(fired).toEqual([2, 0, 0, 2, 0, 0, 2]);
  });

  test('respects duration', () => {
    const bullets = makeSystem();
    const pattern = createPattern('aimed-fan', {
      spec: SPEC,
      count: 1,
      period: 2,
      duration: 4,
    });

    const { results, fired } = drive(pattern, bullets, 6);

    expect(results).toEqual([true, true, true, true, false, false]);
    expect(fired).toEqual([1, 0, 1, 0, 0, 0]);
  });

  test('defaults to five bullets over forty degrees every forty-five ticks', () => {
    const bullets = makeSystem();
    const pattern = createPattern('aimed-fan', { spec: SPEC });

    const { fired } = drive(pattern, bullets, 46);

    expect(fired[0]).toBe(5);
    expect(fired.slice(1, 45).every((n) => n === 0)).toBe(true);
    expect(fired[45]).toBe(5);
    expect(thetas(bullets).slice(0, 5)).toEqual([70, 80, 90, 100, 110]);
  });
});

describe('spray pattern', () => {
  test('fires on its period and not between', () => {
    const bullets = makeSystem();
    const pattern = createPattern('spray', { spec: SPEC, count: 2, period: 4 });

    const { fired } = drive(pattern, bullets, 9);

    expect(fired).toEqual([2, 0, 0, 0, 2, 0, 0, 0, 2]);
  });

  test('scatters within the requested window around an explicit centre', () => {
    const bullets = makeSystem();
    const pattern = createPattern('spray', {
      spec: SPEC,
      count: 40,
      period: 1,
      centre: 90,
      spread: 30,
    });

    drive(pattern, bullets, 5, { rng: new Random(7) });

    for (const theta of thetas(bullets)) {
      expect(theta).toBeGreaterThanOrEqual(75);
      expect(theta).toBeLessThan(105);
    }
  });

  test('a centre of zero is honoured rather than falling back to the aim angle', () => {
    const bullets = makeSystem();
    const pattern = createPattern('spray', {
      spec: SPEC,
      count: 20,
      period: 1,
      centre: 0,
      spread: 10,
    });

    // The target is straight below, so an aim-angle fallback would land near 90.
    drive(pattern, bullets, 1, { targetX: 100, targetY: 200 });

    for (const theta of thetas(bullets)) {
      expect(Math.abs(theta)).toBeLessThanOrEqual(5);
    }
  });

  test('without a centre it scatters around the aim angle', () => {
    const bullets = makeSystem();
    const pattern = createPattern('spray', {
      spec: SPEC,
      count: 20,
      period: 1,
      spread: 20,
    });

    drive(pattern, bullets, 1, { x: 100, y: 100, targetX: 200, targetY: 100 });

    for (const theta of thetas(bullets)) {
      expect(Math.abs(theta)).toBeLessThanOrEqual(10);
    }
  });

  test('respects duration', () => {
    const bullets = makeSystem();
    const pattern = createPattern('spray', {
      spec: SPEC,
      count: 1,
      period: 1,
      duration: 3,
    });

    const { results, fired } = drive(pattern, bullets, 5);

    expect(results).toEqual([true, true, true, false, false]);
    expect(fired).toEqual([1, 1, 1, 0, 0]);
  });

  test('is reproducible from a fixed seed', () => {
    const run = (): number[] => {
      const bullets = makeSystem();
      const pattern = createPattern('spray', {
        spec: SPEC,
        count: 5,
        period: 2,
        centre: 90,
        spread: 120,
      });
      const rng = new Random(0xc0ffee);
      drive(pattern, bullets, 12, { rng });
      return thetas(bullets);
    };

    const first = run();
    expect(first).toHaveLength(30);
    expect(run()).toEqual(first);
  });

  test('a different seed produces a different scatter', () => {
    const run = (seed: number): number[] => {
      const bullets = makeSystem();
      const pattern = createPattern('spray', {
        spec: SPEC,
        count: 5,
        period: 1,
        centre: 90,
        spread: 120,
      });
      drive(pattern, bullets, 4, { rng: new Random(seed) });
      return thetas(bullets);
    };

    expect(run(1)).not.toEqual(run(2));
  });

  test('draws exactly one number per bullet, keeping the call order stable', () => {
    const bullets = makeSystem();
    const pattern = createPattern('spray', {
      spec: SPEC,
      count: 3,
      period: 1,
      centre: 0,
      spread: 100,
    });

    const rng = new Random(99);
    drive(pattern, bullets, 2, { rng });

    // Six bullets consumed six draws, so a fresh generator advanced six times
    // must now be in the same state.
    const reference = new Random(99);
    for (let i = 0; i < 6; i++) reference.random();
    expect(rng.getState()).toEqual(reference.getState());
  });

  test('scatters to exactly the angles the documented formula gives', () => {
    // `run() === run()` only proves the pattern is self-consistent; it would
    // still pass if the window were computed from the wrong end of the range.
    // Rebuilding the sequence from an independent generator pins the formula,
    // the draw count and the order all at once.
    const bullets = makeSystem();
    const pattern = createPattern('spray', {
      spec: SPEC,
      count: 3,
      period: 2,
      centre: 90,
      spread: 120,
    });

    const rng = new Random(0xc0ffee);
    drive(pattern, bullets, 5, { rng });

    const reference = new Random(0xc0ffee);
    const expected: number[] = [];
    for (let i = 0; i < 9; i++) expected.push(90 + reference.range(-60, 60));

    expect(thetas(bullets)).toEqual(expected);
  });

  test('takes its draw after the spawn, so a spec that randomises draws first', () => {
    // With a randomised spec both the bullet and the pattern draw. Computing
    // the angle before spawning would swap the two draws and silently desync
    // every replay that uses such a spec, without changing the draw count.
    const bullets = makeSystem();
    const pattern = createPattern('spray', {
      spec: RANDOMIZED_SPEC,
      count: 2,
      period: 1,
      centre: 0,
      spread: 90,
    });

    const rng = new Random(11);
    drive(pattern, bullets, 1, { rng });

    const reference = new Random(11);
    const expected: number[] = [];
    for (let i = 0; i < 2; i++) {
      reference.random(); // the spec's own trandom draw, taken during spawn
      expected.push(reference.range(-45, 45));
    }

    expect(thetas(bullets)).toEqual(expected);
  });

  test('a zero spread stacks on the centre but still consumes its draw', () => {
    const bullets = makeSystem();
    const pattern = createPattern('spray', {
      spec: SPEC,
      count: 4,
      period: 1,
      centre: 45,
      spread: 0,
    });

    const rng = new Random(2);
    drive(pattern, bullets, 1, { rng });

    expect(thetas(bullets)).toEqual([45, 45, 45, 45]);
    // Skipping the draw when the window is empty would be a plausible
    // optimisation and a determinism break: call count must not depend on
    // tuning values.
    const reference = new Random(2);
    for (let i = 0; i < 4; i++) reference.random();
    expect(rng.getState()).toEqual(reference.getState());
  });

  test('defaults to three bullets every six ticks over a full circle', () => {
    const bullets = makeSystem();
    const pattern = createPattern('spray', { spec: SPEC });

    // The target sits straight below, so the implied centre is 90 and the
    // default 360 window spans [-90, 270).
    const { fired } = drive(pattern, bullets, 13, { rng: new Random(21) });

    expect(fired).toEqual([3, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 3]);
    for (const theta of thetas(bullets)) {
      expect(theta).toBeGreaterThanOrEqual(-90);
      expect(theta).toBeLessThan(270);
    }
  });

  test('a refused spawn does not consume a draw for the bullet that never was', () => {
    const bullets = makeSystem(2);
    const pattern = createPattern('spray', {
      spec: SPEC,
      count: 5,
      period: 1,
      centre: 0,
      spread: 90,
    });

    const rng = new Random(5);
    drive(pattern, bullets, 1, { rng });

    expect(bullets.count).toBe(2);
    const reference = new Random(5);
    reference.random();
    reference.random();
    expect(rng.getState()).toEqual(reference.getState());
  });
});

describe('simulation randomness discipline', () => {
  const realRandom = Math.random;

  beforeEach(() => {
    Math.random = () => {
      throw new Error('simulation code called Math.random');
    };
  });

  afterEach(() => {
    Math.random = realRandom;
  });

  test('no built-in pattern reaches for Math.random', () => {
    for (const name of ['ring', 'spiral', 'aimed-fan', 'spray']) {
      const bullets = makeSystem();
      const pattern = createPattern(name, { spec: SPEC, period: 1 });
      expect(() => drive(pattern, bullets, 20, { rng: new Random(3) })).not.toThrow();
      expect(bullets.count).toBeGreaterThan(0);
    }
  });

  test('only spray touches the sim stream; the others leave it untouched', () => {
    // `spray` is documented as the one pattern that draws. If jitter is ever
    // added to a geometric pattern it shifts every later draw in the run, so
    // an unrelated stage desyncs. That must be a deliberate, visible change.
    for (const name of ['ring', 'spiral', 'aimed-fan']) {
      const bullets = makeSystem();
      const rng = new Random(4);
      const before = rng.getState();

      drive(createPattern(name, { spec: SPEC, period: 1 }), bullets, 10, { rng });

      expect(bullets.count).toBeGreaterThan(0);
      expect(rng.getState()).toEqual(before);
    }
  });

  test('spray does advance the stream, so the guard above is not vacuous', () => {
    const bullets = makeSystem();
    const rng = new Random(4);
    const before = rng.getState();

    drive(createPattern('spray', { spec: SPEC, period: 1 }), bullets, 10, { rng });

    expect(rng.getState()).not.toEqual(before);
  });
});

describe('Emitter', () => {
  test('starts at age zero and alive', () => {
    const emitter = new Emitter(() => true, 10, 20);

    expect(emitter.age).toBe(0);
    expect(emitter.alive).toBe(true);
  });

  test('tracks age across steps', () => {
    const bullets = makeSystem();
    const emitter = new Emitter(() => true, 10, 20);

    for (let i = 0; i < 5; i++) emitter.step(bullets, 0, 0, new Random(1));

    expect(emitter.age).toBe(5);
  });

  test('hands the pattern its own age, position and faction', () => {
    const bullets = makeSystem();
    const seen: EmitContext[] = [];
    const emitter = new Emitter(
      (context) => {
        seen.push({ ...context });
        return true;
      },
      10,
      20,
      'player',
    );

    emitter.step(bullets, 300, 400, new Random(1));
    emitter.x = 55;
    emitter.y = 66;
    emitter.step(bullets, 301, 401, new Random(1));

    expect(seen.map((c) => c.age)).toEqual([0, 1]);
    expect(seen.map((c) => [c.x, c.y])).toEqual([
      [10, 20],
      [55, 66],
    ]);
    expect(seen.map((c) => [c.targetX, c.targetY])).toEqual([
      [300, 400],
      [301, 401],
    ]);
    expect(seen.every((c) => c.faction === 'player')).toBe(true);
    expect(seen.every((c) => c.bullets === bullets)).toBe(true);
  });

  test('defaults to the enemy faction', () => {
    const bullets = makeSystem();
    let faction: string | undefined;
    const emitter = new Emitter((context) => {
      faction = context.faction;
      return true;
    }, 0, 0);

    emitter.step(bullets, 0, 0, new Random(1));

    expect(faction).toBe('enemy');
  });

  test('stops stepping once the pattern returns false', () => {
    const bullets = makeSystem();
    let calls = 0;
    const emitter = new Emitter(() => {
      calls++;
      return calls < 3;
    }, 0, 0);

    for (let i = 0; i < 10; i++) emitter.step(bullets, 0, 0, new Random(1));

    expect(calls).toBe(3);
    expect(emitter.alive).toBe(false);
    // Age froze at the tick that finished the pattern.
    expect(emitter.age).toBe(3);
  });

  test('a pattern returning undefined keeps the emitter alive', () => {
    const bullets = makeSystem();
    let calls = 0;
    const emitter = new Emitter(() => {
      calls++;
    }, 0, 0);

    for (let i = 0; i < 4; i++) emitter.step(bullets, 0, 0, new Random(1));

    expect(calls).toBe(4);
    expect(emitter.alive).toBe(true);
  });

  test('constructing from a name builds that registered pattern', () => {
    const bullets = makeSystem();
    const emitter = new Emitter('ring', 40, 50, 'enemy', {
      spec: SPEC,
      count: 4,
      period: 1,
      rotation: 0,
    });

    emitter.step(bullets, 0, 0, new Random(1));

    expect(thetas(bullets)).toEqual([0, 90, 180, 270]);
    expect(bullets.bullets[0]?.x).toBe(40);
  });

  test('constructing from an unknown name throws immediately', () => {
    expect(() => new Emitter(`${NS}nope`, 0, 0)).toThrow('unknown pattern');
  });

  test('runs a duration-limited pattern to completion and then stops firing', () => {
    const bullets = makeSystem();
    const emitter = new Emitter('ring', 0, 0, 'enemy', {
      spec: SPEC,
      count: 1,
      period: 1,
      duration: 4,
    });

    for (let i = 0; i < 20; i++) emitter.step(bullets, 0, 0, new Random(1));

    expect(bullets.count).toBe(4);
    expect(emitter.alive).toBe(false);
    expect(emitter.age).toBe(5);
  });

  test('two emitters on the same seed and inputs produce identical fire', () => {
    const run = (): number[] => {
      const bullets = makeSystem();
      const rng = new Random(0x5eed);
      const emitter = new Emitter('spray', 120, 60, 'enemy', {
        spec: SPEC,
        count: 4,
        period: 3,
        spread: 180,
      });
      for (let i = 0; i < 30; i++) emitter.step(bullets, 200, 400, rng);
      return thetas(bullets);
    };

    expect(run()).toEqual(run());
  });
});
