/**
 * Behaviours are tested by their trajectory, not by their arithmetic.
 *
 * "It ran and mutated theta" is not evidence: a homing behaviour that turns the
 * wrong way, or turns forever, or turns 350 degrees to avoid turning 10, passes
 * that test comfortably. So every case here integrates the vector the way
 * `BulletSystem.step` does — step, then move by `moveX`/`moveY` — and asserts
 * on where the thing actually went.
 */

import { describe, expect, test } from 'bun:test';
import { Random } from '../core/random';
import { atan2Deg, deltaDeg } from '../core/trig';
import { MoveVector, type MotionContext, type MotionParams } from '../sim/motion';
import './behaviours';

interface Flight {
  x: number;
  y: number;
  theta: number;
  r: number;
}

/**
 * Fly a vector for `ticks`, integrating position exactly as the bullet system
 * does, and return the sample at every tick. The context carries the live
 * position, which is what the position-reading behaviours (homing, orbit)
 * depend on — feeding them a frozen origin would let a broken one look fine.
 */
function fly(
  params: MotionParams,
  ticks: number,
  options: { x?: number; y?: number; targetX?: number; targetY?: number; rng?: Random } = {},
): Flight[] {
  const vector = new MoveVector();
  const rng = options.rng ?? new Random(1);
  vector.init(params, rng);

  const context: MotionContext = {
    age: 0,
    x: options.x ?? 0,
    y: options.y ?? 0,
    targetX: options.targetX ?? 0,
    targetY: options.targetY ?? 0,
  };

  const samples: Flight[] = [];
  for (let tick = 0; tick < ticks; tick++) {
    context.age = tick;
    vector.step(context, rng);
    context.x += vector.moveX();
    context.y += vector.moveY();
    samples.push({ x: context.x, y: context.y, theta: vector.theta, r: vector.r });
  }
  return samples;
}

function at(samples: Flight[], index: number): Flight {
  const sample = samples[index];
  if (sample === undefined) throw new Error(`no sample at ${index}`);
  return sample;
}

/** How far off aim a sample is, as an unsigned angle. */
function aimError(sample: Flight, targetX: number, targetY: number): number {
  return Math.abs(deltaDeg(sample.theta, atan2Deg(targetY - sample.y, targetX - sample.x)));
}

// ---------------------------------------------------------------------------

describe('homing', () => {
  const TARGET = { targetX: 0, targetY: 400 };

  test('closes the angle to the target', () => {
    const samples = fly(
      { r: 2, theta: 0, behaviour: 'homing', options: { turnRate: 6, duration: 30 } },
      30,
      TARGET,
    );

    // Aim error must fall monotonically, not merely end lower: a bullet that
    // overshoots and swings back also ends lower. It starts a quarter turn off
    // and is still travelling, so the aim it is chasing keeps moving too.
    let previous = aimError(at(samples, 0), TARGET.targetX, TARGET.targetY);
    expect(previous).toBeGreaterThan(80);
    for (let i = 1; i < 15; i++) {
      const error = aimError(at(samples, i), TARGET.targetX, TARGET.targetY);
      expect(error).toBeLessThan(previous);
      previous = error;
    }
    // By the end of the window it is locked on, not merely closer.
    expect(aimError(at(samples, 29), TARGET.targetX, TARGET.targetY)).toBeLessThan(1);
  });

  test('turns at most turnRate degrees per tick', () => {
    // A quarter turn at 3 deg/tick cannot complete before tick 30, so an
    // uncapped implementation — one that snaps to the aim — fails here.
    const samples = fly(
      { r: 2, theta: 0, behaviour: 'homing', options: { turnRate: 3, duration: 60 } },
      6,
      TARGET,
    );
    for (let i = 1; i < samples.length; i++) {
      const turn = Math.abs(deltaDeg(at(samples, i - 1).theta, at(samples, i).theta));
      expect(turn).toBeLessThanOrEqual(3 + 1e-9);
    }
    expect(at(samples, 0).theta).toBeCloseTo(3);
  });

  test('does not steer before delay', () => {
    const samples = fly(
      { r: 2, theta: 0, behaviour: 'homing', options: { turnRate: 5, delay: 10, duration: 20 } },
      12,
      TARGET,
    );
    for (let i = 0; i < 10; i++) expect(at(samples, i).theta).toBe(0);
    expect(at(samples, 10).theta).toBeCloseTo(5);
  });

  test('stops steering when the window closes, and flies straight after', () => {
    const samples = fly(
      { r: 2, theta: 0, behaviour: 'homing', options: { turnRate: 3, duration: 10 } },
      40,
      TARGET,
    );

    const released = at(samples, 9).theta;
    expect(released).toBeCloseTo(30);
    for (let i = 10; i < 40; i++) expect(at(samples, i).theta).toBe(released);

    // Flying straight past a target it was still turning toward is the whole
    // point of the window: the aim error must grow again once it is released.
    expect(aimError(at(samples, 39), TARGET.targetX, TARGET.targetY)).toBeGreaterThan(
      aimError(at(samples, 10), TARGET.targetX, TARGET.targetY),
    );
  });

  // The bug this file exists to prevent. `theta` accumulates through `w`
  // without wrapping, so a long-lived spinning bullet carries a heading of
  // hundreds or thousands of degrees. `target - theta` is then a huge number
  // pointing the wrong way, and the bullet takes the scenic route.
  describe('shortest turn at accumulated headings', () => {
    // 1170 is 90 with three whole turns on it; 1070 is likewise -10 away from
    // 1080, the wrapped equivalent of 0.
    test.each([
      ['three turns of positive accumulation', 1170, -3],
      ['three negative turns', -1170, 3],
      ['just past a whole turn', 1070, 3],
      ['just short of a whole turn', -1070, -3],
    ])('%s turns the short way', (_label, theta, expectedFirstTurn) => {
      const samples = fly(
        { r: 2, theta, behaviour: 'homing', options: { turnRate: 3, duration: 40 } },
        40,
        { targetX: 400, targetY: 0 },
      );
      expect(at(samples, 0).theta - theta).toBeCloseTo(expectedFirstTurn);
      // 30 ticks is far more than the ~30 degrees the short way needs and far
      // less than the ~330 the long way would.
      expect(aimError(at(samples, 30), 400, 0)).toBeLessThan(5);
    });
  });

  test('sitting exactly on the target leaves the heading alone', () => {
    const samples = fly(
      { r: 0, theta: 137, behaviour: 'homing', options: { turnRate: 9, duration: 10 } },
      5,
      { x: 50, y: 50, targetX: 50, targetY: 50 },
    );
    for (const sample of samples) expect(sample.theta).toBe(137);
  });
});

describe('waver', () => {
  test('deviation is sinusoidal and returns to the base heading each period', () => {
    const samples = fly(
      { r: 2, theta: 90, behaviour: 'waver', options: { amplitude: 20, period: 8 } },
      24,
    );
    // After k ticks the accumulated offset is amplitude * sin(360k / period).
    expect(at(samples, 1).theta).toBeCloseTo(90 + 20); // k=2, quarter cycle
    expect(at(samples, 3).theta).toBeCloseTo(90); // k=4, half cycle
    expect(at(samples, 5).theta).toBeCloseTo(90 - 20);
    expect(at(samples, 7).theta).toBeCloseTo(90); // k=8, whole cycle
    expect(at(samples, 15).theta).toBeCloseTo(90);
    expect(at(samples, 23).theta).toBeCloseTo(90);
  });

  test('travel stays centred on the authored heading', () => {
    // A waver that assigned theta instead of nudging it would still oscillate,
    // but the path would bias. Over whole periods the lateral excursion must
    // cancel: the bullet ends where an unwavering one would, roughly.
    const wavered = fly({ r: 3, theta: 90, behaviour: 'waver', options: { amplitude: 25, period: 12 } }, 48);
    const straight = fly({ r: 3, theta: 90 }, 48);
    expect(at(wavered, 47).x).toBeCloseTo(at(straight, 47).x, 0);
    // Not equal on the forward axis, and should not be: speed is along the
    // heading, so a wobbling bullet spends some of its 3px/tick going sideways
    // and arrives a little short. Within 5% of the straight run over 4 periods.
    const shortfall = at(straight, 47).y - at(wavered, 47).y;
    expect(shortfall).toBeGreaterThan(0);
    expect(shortfall).toBeLessThan(at(straight, 47).y * 0.05);

    // ...but it must genuinely leave that line in between, or the assertion
    // above would also pass for a behaviour that does nothing at all.
    const excursion = Math.max(...wavered.slice(0, 12).map((s) => Math.abs(s.x)));
    expect(excursion).toBeGreaterThan(3);
  });

  test('rides on top of angular velocity rather than replacing it', () => {
    const samples = fly(
      { r: 2, theta: 0, w: 2, behaviour: 'waver', options: { amplitude: 10, period: 8 } },
      8,
    );
    // The turn from `w` is intact at every whole period; only the wobble is
    // superimposed. Eight ticks of w=2 is 16 degrees.
    expect(at(samples, 7).theta).toBeCloseTo(16);
  });

  test('the window bounds the wobble', () => {
    const samples = fly(
      {
        r: 2,
        theta: 0,
        behaviour: 'waver',
        options: { amplitude: 30, period: 8, delay: 4, duration: 8 },
      },
      20,
    );
    for (let i = 0; i < 4; i++) expect(at(samples, i).theta).toBe(0);
    expect(at(samples, 5).theta).toBeCloseTo(30);
    // A duration that is a whole number of periods hands the heading back.
    for (let i = 11; i < 20; i++) expect(at(samples, i).theta).toBeCloseTo(0);
  });
});

describe('accelerate-to', () => {
  test('hangs, then eases onto the target speed exactly', () => {
    const samples = fly(
      {
        r: 0.2,
        theta: 90,
        behaviour: 'accelerate-to',
        options: { speed: 6, delay: 20, duration: 20 },
      },
      50,
    );

    for (let i = 0; i < 20; i++) expect(at(samples, i).r).toBe(0.2);

    // Monotone across the ramp, and landing on the target rather than
    // asymptotically approaching it — an exponential ease would be at 5.9 here.
    for (let i = 21; i < 40; i++) expect(at(samples, i).r).toBeGreaterThan(at(samples, i - 1).r);
    expect(at(samples, 39).r).toBeCloseTo(6, 10);
    for (let i = 40; i < 50; i++) expect(at(samples, i).r).toBeCloseTo(6, 10);
  });

  test('the ease is slow at both ends and fastest in the middle', () => {
    const samples = fly(
      { r: 0, theta: 90, behaviour: 'accelerate-to', options: { speed: 10, duration: 20 } },
      20,
    );
    const gain = (i: number) => at(samples, i).r - (i === 0 ? 0 : at(samples, i - 1).r);
    expect(gain(9)).toBeGreaterThan(gain(0) * 2);
    expect(gain(9)).toBeGreaterThan(gain(19) * 2);
  });

  test('decelerates as readily as it accelerates', () => {
    const samples = fly(
      { r: 8, theta: 90, behaviour: 'accelerate-to', options: { speed: 1, duration: 10 } },
      12,
    );
    expect(at(samples, 9).r).toBeCloseTo(1, 10);
    expect(at(samples, 4).r).toBeLessThan(8);
    expect(at(samples, 4).r).toBeGreaterThan(1);
  });

  test('a bullet that hangs then snaps covers almost no ground while hanging', () => {
    const samples = fly(
      {
        r: 0.1,
        theta: 90,
        behaviour: 'accelerate-to',
        options: { speed: 8, delay: 30, duration: 15 },
      },
      60,
    );
    expect(at(samples, 29).y).toBeCloseTo(3, 5);
    expect(at(samples, 59).y).toBeGreaterThan(180);
  });
});

describe('orbit', () => {
  const CENTER = { centerX: 200, centerY: 150, radius: 60 };

  test('holds the ring and advances by angularSpeed', () => {
    const samples = fly(
      {
        r: 0,
        theta: 0,
        behaviour: 'orbit',
        options: { ...CENTER, angularSpeed: 6, duration: 120 },
      },
      60,
      { x: 260, y: 150 },
    );

    for (let i = 5; i < 60; i++) {
      const sample = at(samples, i);
      const distance = Math.hypot(sample.x - 200, sample.y - 150);
      expect(distance).toBeCloseTo(60, 6);
    }

    // 60 ticks at 6 deg/tick is one whole turn, back to the start.
    expect(at(samples, 59).x).toBeCloseTo(260, 4);
    expect(at(samples, 59).y).toBeCloseTo(150, 4);
    // And it went the way it was told: a quarter turn from due east is due
    // south in this y-down space.
    expect(at(samples, 14).y).toBeGreaterThan(190);
  });

  test('negative angularSpeed orbits the other way', () => {
    const samples = fly(
      { r: 0, theta: 0, behaviour: 'orbit', options: { ...CENTER, angularSpeed: -6, duration: 120 } },
      15,
      { x: 260, y: 150 },
    );
    expect(at(samples, 14).y).toBeLessThan(110);
  });

  test('gathers a bullet spawned off the ring onto it', () => {
    const samples = fly(
      { r: 0, theta: 0, behaviour: 'orbit', options: { ...CENTER, angularSpeed: 4, duration: 200 } },
      40,
      { x: 400, y: 150 },
    );
    const distanceAt = (i: number) => Math.hypot(at(samples, i).x - 200, at(samples, i).y - 150);
    expect(distanceAt(0)).toBeLessThan(200);
    expect(distanceAt(0)).toBeGreaterThan(60);
    // The radius closes by a quarter of the gap each tick, so the approach is
    // geometric — 140px of overshoot is under a hundredth of a pixel by tick
    // 40, but never identically zero.
    expect(distanceAt(39)).toBeCloseTo(60, 2);
  });

  test('releases tangentially when the window closes', () => {
    const samples = fly(
      { r: 0, theta: 0, behaviour: 'orbit', options: { ...CENTER, angularSpeed: 6, duration: 30 } },
      90,
      { x: 260, y: 150 },
    );

    const release = at(samples, 29);
    for (let i = 30; i < 90; i++) expect(at(samples, i).theta).toBe(release.theta);

    // Tangential means perpendicular to the radius, and means leaving: the
    // distance from the centre must grow without bound after release.
    const radial = atan2Deg(release.y - 150, release.x - 200);
    expect(Math.abs(Math.abs(deltaDeg(radial, release.theta)) - 90)).toBeLessThan(6);

    const distanceAt = (i: number) => Math.hypot(at(samples, i).x - 200, at(samples, i).y - 150);
    expect(distanceAt(60)).toBeGreaterThan(distanceAt(35));
    expect(distanceAt(89)).toBeGreaterThan(distanceAt(60));
  });

  test('aimAtTarget orbits the aim target instead of a fixed point', () => {
    const samples = fly(
      {
        r: 0,
        theta: 0,
        behaviour: 'orbit',
        options: { aimAtTarget: 1, radius: 40, angularSpeed: 9, duration: 100 },
      },
      30,
      { x: 140, y: 300, targetX: 100, targetY: 300 },
    );
    for (let i = 3; i < 30; i++) {
      expect(Math.hypot(at(samples, i).x - 100, at(samples, i).y - 300)).toBeCloseTo(40, 6);
    }
  });
});

describe('beam-sweep', () => {
  // A beam is aimed once (through `aimed-fan`, which sets `theta`), then held
  // through its telegraph, then swept. So every case fixes `w: 0` — the spec's
  // contract — and reads the heading, which is the whole state this behaviour
  // touches. `hold` is the telegraph the aimed heading survives; only after it
  // does the wedge open.

  test('holds the aimed heading through the telegraph, then sweeps from it', () => {
    // `aimed-fan` would leave a bullet pointed here; the sweep must not touch it
    // until the telegraph is spent. This is exactly what `w` cannot do — `w`
    // would have turned the beam on every one of these first 20 ticks.
    const AIM = 137;
    const samples = fly(
      { r: 2, theta: AIM, w: 0, behaviour: 'beam-sweep', options: { hold: 20, rate: 3, duration: 60, arc: 0 } },
      30,
    );
    for (let i = 0; i < 20; i++) expect(at(samples, i).theta).toBe(AIM);
    expect(at(samples, 20).theta).toBeCloseTo(AIM + 3); // first sweep tick
    expect(at(samples, 21).theta).toBeCloseTo(AIM + 6);
    expect(at(samples, 29).theta).toBeCloseTo(AIM + 3 * 10); // ten sweep ticks in
  });

  test('sweeps in the direction of rate, and the other way when it is negative', () => {
    const east = fly(
      { r: 0, theta: 90, w: 0, behaviour: 'beam-sweep', options: { hold: 3, rate: 4, duration: 20, arc: 0 } },
      8,
    );
    const west = fly(
      { r: 0, theta: 90, w: 0, behaviour: 'beam-sweep', options: { hold: 3, rate: -4, duration: 20, arc: 0 } },
      8,
    );
    for (let i = 0; i < 3; i++) {
      expect(at(east, i).theta).toBe(90);
      expect(at(west, i).theta).toBe(90);
    }
    expect(at(east, 3).theta).toBeCloseTo(94);
    expect(at(west, 3).theta).toBeCloseTo(86);
    expect(at(east, 7).theta).toBeCloseTo(90 + 4 * 5); // five sweep ticks
    expect(at(west, 7).theta).toBeCloseTo(90 - 4 * 5);
  });

  test('the wedge is measured from the sweep start, not from spawn', () => {
    // If the bound read `age` instead of `age - hold`, a beam held past `arc`
    // ticks would halt the instant the window opened and never sweep at all.
    const samples = fly(
      { r: 0, theta: 0, w: 0, behaviour: 'beam-sweep', options: { hold: 10, rate: 2, duration: 100, arc: 10 } },
      30,
    );
    for (let i = 0; i < 10; i++) expect(at(samples, i).theta).toBe(0); // held
    expect(at(samples, 14).theta).toBeCloseTo(10); // five sweep ticks reach the 10° wedge
    for (let i = 15; i < 30; i++) expect(at(samples, i).theta).toBeCloseTo(10); // halted, held
  });

  test('the arc bound halts within one step of the wedge, never short of it', () => {
    // 3°/tick against a 10° wedge cannot land on it exactly. The rule is to halt
    // on the first tick whose prior swing has reached the bound, so the total
    // overshoots to the next multiple (12°) rather than stopping short at 9°.
    const samples = fly(
      { r: 0, theta: 0, w: 0, behaviour: 'beam-sweep', options: { rate: 3, duration: 100, arc: 10 } },
      30,
    );
    const total = at(samples, 29).theta;
    expect(total).toBeGreaterThanOrEqual(10);
    expect(total).toBeLessThan(10 + 3);
    expect(total).toBeCloseTo(12);
    for (let i = 4; i < 30; i++) expect(at(samples, i).theta).toBeCloseTo(12);
  });

  test('arc: 0 sweeps the whole window, then holds the heading and flies straight', () => {
    const samples = fly(
      { r: 3, theta: 0, w: 0, behaviour: 'beam-sweep', options: { hold: 0, rate: 2, duration: 15, arc: 0 } },
      25,
    );
    expect(at(samples, 14).theta).toBeCloseTo(30); // fifteen ticks, 2° each
    for (let i = 15; i < 25; i++) expect(at(samples, i).theta).toBeCloseTo(30); // window closed

    // Released, it flies straight: with the heading pinned the position steps
    // are equal. A behaviour that kept nudging `theta` would fail this.
    const dx1 = at(samples, 20).x - at(samples, 19).x;
    const dy1 = at(samples, 20).y - at(samples, 19).y;
    const dx2 = at(samples, 21).x - at(samples, 20).x;
    const dy2 = at(samples, 21).y - at(samples, 20).y;
    expect(dx2).toBeCloseTo(dx1, 10);
    expect(dy2).toBeCloseTo(dy1, 10);
  });

  test('draws no RNG, so attaching it perturbs no stream', () => {
    // The property the whole module rests on (CLAUDE.md rule 2): a behaviour
    // that drew would displace every later sim draw the moment it was attached.
    // The generator cursor must be exactly where a single prior draw left it.
    const rng = new Random(11);
    const before = rng.random();

    const vector = new MoveVector();
    vector.init(
      { r: 2, theta: 40, w: 0, behaviour: 'beam-sweep', options: { hold: 5, rate: 2, duration: 30, arc: 60 } },
      rng,
    );
    const context: MotionContext = { age: 0, x: 0, y: 0, targetX: 0, targetY: 0 };
    for (let tick = 0; tick < 50; tick++) {
      context.age = tick;
      vector.step(context, rng);
      context.x += vector.moveX();
      context.y += vector.moveY();
    }

    const control = new Random(11);
    control.random();
    expect(rng.random()).toBe(control.random());
    expect(before).toBe(new Random(11).random());
  });

  test('the same params reproduce the whole sweep tick for tick', () => {
    const params: MotionParams = {
      r: 2,
      theta: 40,
      w: 0,
      behaviour: 'beam-sweep',
      options: { hold: 8, rate: 1.5, duration: 50, arc: 45 },
    };
    const a = fly(params, 80);
    const b = fly(params, 80);
    for (let i = 0; i < 80; i++) {
      expect(at(a, i).theta).toBe(at(b, i).theta);
      expect(at(a, i).x).toBe(at(b, i).x);
      expect(at(a, i).y).toBe(at(b, i).y);
    }
  });

  // The `hold == warmup` / `w == 0` couplings are pinned over the REAL base-pack
  // beam-sweep specs in `src/reachability.test.ts` (root), not here: this file is
  // `src/content/`, and the pack boundary is total — content may not import
  // `src/packs`, even the base-pack JSON as data (architecture.test.ts). So the
  // data-scan coupling lives where the beam reachability collectors do.
});

describe('registration', () => {
  test('every behaviour this module provides is reachable by name', () => {
    for (const name of ['homing', 'waver', 'accelerate-to', 'orbit', 'beam-sweep']) {
      expect(() => new MoveVector().init({ behaviour: name })).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------

/**
 * Determinism, fingerprinted as a trace.
 *
 * Comparing two runs at their end proves nothing here, and that is not a
 * hypothetical: an earlier negative control on this project compared two
 * *different seeds* at tick 1200 and got byte-identical results, because the
 * content converges. So the fingerprint samples the whole flight at intervals.
 * A divergence that later heals still shows up.
 */
describe('determinism', () => {
  const SCENE: MotionParams[] = [
    { r: 2, theta: 20, behaviour: 'homing', options: { turnRate: 4, delay: 6, duration: 40 } },
    { r: 3, theta: 1170, w: 1.5, behaviour: 'waver', options: { amplitude: 22, period: 13 } },
    { r: 0.3, theta: 75, behaviour: 'accelerate-to', options: { speed: 7, delay: 25, duration: 35 } },
    {
      r: 0,
      theta: 0,
      behaviour: 'orbit',
      options: { centerX: 190, centerY: 140, radius: 55, angularSpeed: 7, duration: 90 },
    },
  ];

  /** Sample every 7 ticks, so a transient divergence cannot hide between samples. */
  function trace(seed: number, scene: MotionParams[] = SCENE, ticks = 210): string {
    const rng = new Random(seed);
    const vectors = scene.map((params) => {
      const vector = new MoveVector();
      vector.init(params, rng);
      return vector;
    });
    const contexts: MotionContext[] = scene.map((_, i) => ({
      age: 0,
      x: 120 + i * 17,
      y: 60 + i * 23,
      targetX: 160,
      targetY: 380,
    }));

    const out: string[] = [];
    for (let tick = 0; tick < ticks; tick++) {
      for (let i = 0; i < vectors.length; i++) {
        const vector = vectors[i];
        const context = contexts[i];
        if (vector === undefined || context === undefined) continue;
        context.age = tick;
        vector.step(context, rng);
        context.x += vector.moveX();
        context.y += vector.moveY();
      }
      if (tick % 7 === 0) {
        for (const context of contexts) out.push(`${context.x.toFixed(12)},${context.y.toFixed(12)}`);
        for (const vector of vectors) out.push(`${vector.theta.toFixed(12)}:${vector.r.toFixed(12)}`);
      }
    }
    return out.join('|');
  }

  test('the same seed reproduces the whole trace, not just the endpoint', () => {
    expect(trace(20260719)).toBe(trace(20260719));
  });

  test('behaviours make no RNG draws, so they cannot shift the sim stream', () => {
    // Every behaviour here reads options and position only. If one started
    // drawing, attaching it to a pattern would displace every later draw in
    // the run — so the draw count is pinned rather than left to good intent.
    const rng = new Random(7);
    const before = rng.random();

    const vector = new MoveVector();
    const context: MotionContext = { age: 0, x: 10, y: 10, targetX: 300, targetY: 300 };
    for (const params of SCENE) {
      vector.init({ ...params, rrandom: undefined }, rng);
      for (let tick = 0; tick < 50; tick++) {
        context.age = tick;
        vector.step(context, rng);
        context.x += vector.moveX();
        context.y += vector.moveY();
      }
    }

    const control = new Random(7);
    control.random();
    expect(rng.random()).toBe(control.random());
    expect(before).toBe(new Random(7).random());
  });

  /**
   * The negative control, built so that the endpoints agree.
   *
   * Two `accelerate-to` ramps of different length reach the same speed and,
   * given enough ticks, very nearly the same place. An end-state comparison
   * would call these identical. The trace must not.
   */
  test('a mid-flight difference that heals is still caught', () => {
    const slow: MotionParams[] = [
      { r: 0, theta: 90, behaviour: 'accelerate-to', options: { speed: 5, duration: 40 } },
    ];
    const fast: MotionParams[] = [
      { r: 0, theta: 90, behaviour: 'accelerate-to', options: { speed: 5, duration: 10 } },
    ];

    const slowRun = trace(1, slow, 210);
    const fastRun = trace(1, fast, 210);
    expect(slowRun).not.toBe(fastRun);

    // And the reason this is a real negative control: the two agree on the
    // thing an endpoint check would have looked at.
    const endSpeed = (t: string) => t.split('|').slice(-1)[0];
    expect(endSpeed(slowRun)).toBe(endSpeed(fastRun));
  });
});
