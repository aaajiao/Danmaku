import { describe, expect, test } from 'bun:test';
import { fx, sim } from '../core/random';
import {
  defineEffect,
  effectNames,
  EffectSystem,
  getEffectSpec,
  Particle,
  type ParticleSpec,
} from './effects';

/**
 * The registry is module-global, so tests that define their own effect must not
 * collide with each other or with a re-run. Unique names keep them independent.
 */
let counter = 0;
function uniqueName(): string {
  return `test.effect.${counter++}`;
}

function define(spec: Partial<ParticleSpec> = {}): string {
  const name = uniqueName();
  defineEffect(name, { sprite: 'mote', count: 4, speed: 1, life: 10, ...spec });
  return name;
}

function makeSystem(options: { initial?: number; max?: number } = {}): EffectSystem {
  return new EffectSystem({ initial: 32, ...options });
}

function stepTimes(system: EffectSystem, ticks: number): void {
  for (let i = 0; i < ticks; i++) system.step();
}

/** Snapshot of every field a renderer or a determinism check would read. */
function describeParticles(system: EffectSystem): unknown[] {
  return system.particles.map((p) => [p.x, p.y, p.vx, p.vy, p.age, p.life, p.scale, p.alpha, p.angle]);
}

describe('registry', () => {
  test('a defined effect is retrievable and listed', () => {
    const name = define({ sprite: 'star', count: 9 });

    expect(getEffectSpec(name).sprite).toBe('star');
    expect(getEffectSpec(name).count).toBe(9);
    expect(effectNames()).toContain(name);
  });

  test('redefining a name throws rather than silently replacing content', () => {
    const name = define();
    expect(() => defineEffect(name, { sprite: 'mote', count: 1, speed: 1, life: 1 })).toThrow(
      `effect "${name}" is already defined`,
    );
  });

  test('an unknown effect throws on lookup and on emit', () => {
    const system = makeSystem();
    expect(() => getEffectSpec('nope')).toThrow('unknown effect "nope"');
    expect(() => system.emit('nope', 0, 0)).toThrow('unknown effect "nope"');
  });

  test('the starter set is registered', () => {
    for (const name of ['explosion', 'hit', 'graze', 'pickup', 'muzzle', 'death.big']) {
      expect(effectNames()).toContain(name);
      expect(getEffectSpec(name).sprite).not.toBe('');
    }
  });

  test('starter effects fade out, so nothing pops off the field', () => {
    for (const name of ['explosion', 'hit', 'graze', 'pickup', 'muzzle', 'death.big']) {
      expect(getEffectSpec(name).alpha?.to).toBe(0);
    }
  });
});

/**
 * The reason this module exists. Upstream drew effect scatter from its gameplay
 * generator, so adding a particle moved every subsequent bullet. These tests
 * fail the moment anything here reaches for the sim stream.
 */
describe('stream isolation', () => {
  test('heavy effect work leaves the sim stream exactly where it was', () => {
    sim.seed(0xc0ffee);
    const before = sim.getState();

    const system = makeSystem({ initial: 8, max: 512 });
    for (let tick = 0; tick < 400; tick++) {
      system.emit('explosion', 120, 200);
      system.emit('hit', 60, 60);
      system.emit('graze', 30, 30, 45);
      system.emit('death.big', 200, 100);
      system.step();
    }
    system.clear();

    expect(sim.getState()).toEqual(before);
  });

  test('the sim stream yields the same draws whether or not effects ran', () => {
    sim.seed(1234);
    const expected = [sim.next(), sim.next(), sim.next(), sim.next()];

    sim.seed(1234);
    const system = makeSystem();
    for (let tick = 0; tick < 120; tick++) {
      system.emit('pickup', 10, 10);
      system.step();
    }

    expect([sim.next(), sim.next(), sim.next(), sim.next()]).toEqual(expected);
  });

  test('emitting does advance the fx stream — the isolation tests are not vacuous', () => {
    const system = makeSystem();
    const before = fx.getState();
    system.emit('explosion', 0, 0);
    expect(fx.getState()).not.toEqual(before);
  });
});

describe('emit', () => {
  test('a scalar count spawns exactly that many particles', () => {
    const system = makeSystem();
    system.emit(define({ count: 7 }), 40, 50);

    expect(system.count).toBe(7);
    expect(system.particles.length).toBe(7);
  });

  test('a ranged count stays inside its bounds across many emits', () => {
    const name = define({ count: { min: 3, max: 6 } });
    const seen = new Set<number>();

    for (let i = 0; i < 60; i++) {
      const system = makeSystem();
      system.emit(name, 0, 0);
      expect(system.count).toBeGreaterThanOrEqual(3);
      expect(system.count).toBeLessThanOrEqual(6);
      seen.add(system.count);
    }
    // A range that always returned the same value would pass the bounds check.
    expect(seen.size).toBeGreaterThan(1);
  });

  test('particles start at the emit position, alive and aged zero', () => {
    const system = makeSystem();
    system.emit(define({ count: 3 }), 128, 64);

    for (const p of system.particles) {
      expect(p.x).toBe(128);
      expect(p.y).toBe(64);
      expect(p.age).toBe(0);
      expect(p.alive).toBe(true);
    }
  });

  test('speed drawn from a range lands inside it', () => {
    const system = makeSystem();
    system.emit(define({ count: 40, speed: { min: 2, max: 4 }, spread: 360 }), 0, 0);

    for (const p of system.particles) {
      const speed = Math.hypot(p.vx, p.vy);
      expect(speed).toBeGreaterThanOrEqual(2 - 1e-9);
      expect(speed).toBeLessThanOrEqual(4 + 1e-9);
    }
  });

  test('the spec direction and spread bound the emitted angles', () => {
    const system = makeSystem();
    // 90 is downward: the coordinate space is y-down, as in the motion DSL.
    system.emit(define({ count: 40, direction: 90, spread: 20 }), 0, 0);

    for (const p of system.particles) {
      const deg = (Math.atan2(p.vy, p.vx) * 180) / Math.PI;
      expect(deg).toBeGreaterThanOrEqual(80 - 1e-9);
      expect(deg).toBeLessThanOrEqual(100 + 1e-9);
      expect(p.vy).toBeGreaterThan(0);
    }
  });

  test('the emit argument overrides the spec direction', () => {
    const system = makeSystem();
    system.emit(define({ count: 30, direction: 90, spread: 10 }), 0, 0, 0);

    for (const p of system.particles) {
      expect(p.vx).toBeGreaterThan(0);
      expect(Math.abs(p.vy)).toBeLessThan(Math.abs(p.vx));
    }
  });

  test('a full spread reaches every quadrant', () => {
    const system = makeSystem({ initial: 256 });
    system.emit(define({ count: 200, spread: 360 }), 0, 0);

    expect(system.particles.some((p) => p.vx > 0 && p.vy > 0)).toBe(true);
    expect(system.particles.some((p) => p.vx > 0 && p.vy < 0)).toBe(true);
    expect(system.particles.some((p) => p.vx < 0 && p.vy > 0)).toBe(true);
    expect(system.particles.some((p) => p.vx < 0 && p.vy < 0)).toBe(true);
  });

  test('particles carry their spec, so the renderer can read sprite and tint', () => {
    const system = makeSystem();
    const name = define({ count: 2, sprite: 'petal', tint: { r: 0.5 }, additive: true });
    system.emit(name, 0, 0);

    for (const p of system.particles) {
      expect(p.spec).toBe(getEffectSpec(name));
      expect(p.spec.sprite).toBe('petal');
      expect(p.spec.additive).toBe(true);
    }
  });

  test('the initial angle points along travel, so elongated cells read correctly', () => {
    const system = makeSystem();
    system.emit(define({ count: 12, spread: 360 }), 0, 0);

    for (const p of system.particles) {
      expect(Math.cos(p.angle)).toBeCloseTo(p.vx, 6);
      expect(Math.sin(p.angle)).toBeCloseTo(p.vy, 6);
    }
  });
});

describe('step', () => {
  test('a particle moves by its velocity, one tick at a time', () => {
    const system = makeSystem();
    system.emit(define({ count: 1, speed: 3, direction: 0, spread: 0, life: 100 }), 10, 20);
    const p = system.particles[0] as Particle;

    system.step();
    expect(p.x).toBeCloseTo(13, 9);
    expect(p.y).toBeCloseTo(20, 9);

    system.step();
    expect(p.x).toBeCloseTo(16, 9);
    expect(p.age).toBe(2);
  });

  test('gravity accelerates downward each tick', () => {
    const system = makeSystem();
    system.emit(define({ count: 1, speed: 0, life: 100, gravity: 0.5 }), 0, 0);
    const p = system.particles[0] as Particle;

    system.step();
    expect(p.vy).toBeCloseTo(0.5, 9);
    system.step();
    expect(p.vy).toBeCloseTo(1, 9);
    expect(p.y).toBeCloseTo(1.5, 9);
  });

  test('negative gravity drifts upward', () => {
    const system = makeSystem();
    system.emit(define({ count: 1, speed: 0, life: 100, gravity: -0.25 }), 0, 0);
    const p = system.particles[0] as Particle;

    stepTimes(system, 4);
    expect(p.y).toBeLessThan(0);
  });

  test('drag multiplies velocity every tick', () => {
    const system = makeSystem();
    system.emit(define({ count: 1, speed: 4, direction: 0, spread: 0, life: 100, drag: 0.5 }), 0, 0);
    const p = system.particles[0] as Particle;

    system.step();
    expect(p.vx).toBeCloseTo(2, 9);
    system.step();
    expect(p.vx).toBeCloseTo(1, 9);
    expect(p.x).toBeCloseTo(3, 9);
  });

  test('drag damps gravity into a terminal speed instead of unbounded fall', () => {
    const system = makeSystem();
    system.emit(define({ count: 1, speed: 0, life: 400, gravity: 0.5, drag: 0.9 }), 0, 0);
    const p = system.particles[0] as Particle;

    stepTimes(system, 300);
    // g * drag / (1 - drag) is the fixed point of v -> (v + g) * drag.
    expect(p.vy).toBeCloseTo(4.5, 4);
  });

  test('spin advances the angle', () => {
    const system = makeSystem();
    system.emit(define({ count: 1, speed: 0, life: 100, spin: 0.25 }), 0, 0);
    const p = system.particles[0] as Particle;
    const start = p.angle;

    stepTimes(system, 4);
    expect(p.angle).toBeCloseTo(start + 1, 9);
  });

  test('scale and alpha interpolate from their start to their end over life', () => {
    const system = makeSystem();
    system.emit(
      define({ count: 1, speed: 0, life: 10, scale: { from: 2, to: 0 }, alpha: { from: 1, to: 0 } }),
      0,
      0,
    );
    const p = system.particles[0] as Particle;

    expect(p.scale).toBe(2);
    expect(p.alpha).toBe(1);

    stepTimes(system, 5);
    expect(p.scale).toBeCloseTo(1, 9);
    expect(p.alpha).toBeCloseTo(0.5, 9);

    // The last tick both lands on the end value and retires the particle.
    stepTimes(system, 5);
    expect(p.scale).toBeCloseTo(0, 9);
    expect(p.alpha).toBeCloseTo(0, 9);
    expect(system.count).toBe(0);
  });

  test('a constant scale is left alone', () => {
    const system = makeSystem();
    system.emit(define({ count: 1, speed: 0, life: 20, scale: 1.5 }), 0, 0);
    const p = system.particles[0] as Particle;

    stepTimes(system, 10);
    expect(p.scale).toBe(1.5);
    expect(p.alpha).toBe(1);
  });

  test('particles expire exactly at their life and leave the live list', () => {
    const system = makeSystem();
    system.emit(define({ count: 5, speed: 0, life: 6 }), 0, 0);

    stepTimes(system, 5);
    expect(system.count).toBe(5);

    system.step();
    expect(system.count).toBe(0);
    expect(system.particles.length).toBe(0);
  });

  test('expiring one wave does not disturb a longer-lived one', () => {
    const system = makeSystem();
    system.emit(define({ count: 3, speed: 0, life: 4 }), 1, 1);
    system.emit(define({ count: 2, speed: 0, life: 40 }), 2, 2);
    const survivors = system.particles.filter((p) => p.life === 40);

    stepTimes(system, 10);

    expect(system.count).toBe(2);
    // Identity, not deep equality: a slot mix-up would survive a value check.
    expect(new Set(system.particles)).toEqual(new Set(survivors));
    for (const p of system.particles) expect(p.alive).toBe(true);
  });

  test('stepping an empty system is a no-op', () => {
    const system = makeSystem();
    stepTimes(system, 5);
    expect(system.count).toBe(0);
  });
});

describe('pooling', () => {
  test('expired particles are reused rather than reallocated', () => {
    const system = makeSystem({ initial: 4 });
    system.emit(define({ count: 4, speed: 0, life: 2 }), 0, 0);
    const first = new Set(system.particles);

    stepTimes(system, 2);
    expect(system.count).toBe(0);

    system.emit(define({ count: 4, speed: 0, life: 2 }), 0, 0);
    for (const p of system.particles) expect(first.has(p)).toBe(true);
    expect(system.poolSize).toBe(4);
  });

  test('a reused particle is fully reinitialised, not left stale', () => {
    const system = makeSystem({ initial: 1 });
    system.emit(define({ count: 1, speed: 5, direction: 0, spread: 0, life: 3 }), 90, 90);
    stepTimes(system, 3);

    system.emit(define({ count: 1, speed: 0, life: 8, scale: { from: 3, to: 1 } }), 7, 8);
    const p = system.particles[0] as Particle;

    expect(p.x).toBe(7);
    expect(p.y).toBe(8);
    expect(p.age).toBe(0);
    expect(p.life).toBe(8);
    expect(p.scale).toBe(3);
    expect(p.vx).toBeCloseTo(0, 9);
    expect(p.alive).toBe(true);
  });

  test('the pool ceiling drops particles instead of growing without bound', () => {
    const system = new EffectSystem({ initial: 4, max: 4 });
    system.emit(define({ count: 10, speed: 0, life: 100 }), 0, 0);

    expect(system.count).toBe(4);
    expect(system.droppedParticles).toBe(6);
    expect(system.poolSize).toBe(4);
  });

  test('dropping is survivable — the system keeps working once room frees up', () => {
    const system = new EffectSystem({ initial: 2, max: 2 });
    const name = define({ count: 4, speed: 0, life: 3 });

    system.emit(name, 0, 0);
    expect(system.count).toBe(2);
    stepTimes(system, 3);
    expect(system.count).toBe(0);

    system.emit(name, 5, 5);
    expect(system.count).toBe(2);
    for (const p of system.particles) expect(p.x).toBe(5);
  });

  test('clear releases everything and the particles are reusable afterwards', () => {
    const system = makeSystem({ initial: 8 });
    system.emit(define({ count: 8, speed: 0, life: 100 }), 0, 0);
    const before = new Set(system.particles);

    system.clear();
    expect(system.count).toBe(0);
    for (const p of before) expect(p.alive).toBe(false);

    system.emit(define({ count: 8, speed: 0, life: 100 }), 0, 0);
    expect(system.count).toBe(8);
    for (const p of system.particles) expect(before.has(p)).toBe(true);
    expect(system.poolSize).toBe(8);
  });
});

describe('reproducibility', () => {
  test('the same fx seed replays the same particles', () => {
    const run = (): unknown[] => {
      fx.seed(4242);
      const system = makeSystem({ initial: 64 });
      for (let tick = 0; tick < 20; tick++) {
        system.emit('explosion', 100, 100);
        system.step();
      }
      return describeParticles(system);
    };

    const a = run();
    const b = run();
    expect(b).toEqual(a);
    expect(a.length).toBeGreaterThan(0);
  });

  test('a different fx seed produces different particles', () => {
    const run = (seed: number): unknown[] => {
      fx.seed(seed);
      const system = makeSystem({ initial: 64 });
      system.emit('death.big', 50, 50);
      stepTimes(system, 5);
      return describeParticles(system);
    };

    expect(run(1)).not.toEqual(run(2));
  });
});
