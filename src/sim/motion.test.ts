import { describe, expect, test } from 'bun:test';
import { Random, seedRun } from '../core/random';
import {
  defineBehaviour,
  getBehaviour,
  MotionTimeline,
  MoveVector,
  type MotionContext,
  type MotionSegment,
} from './motion';

/** A context with everything zeroed; override only what a test cares about. */
function ctx(overrides: Partial<MotionContext> = {}): MotionContext {
  return { age: 0, x: 0, y: 0, targetX: 0, targetY: 0, ...overrides };
}

function stepped(vector: MoveVector, ticks: number, rng?: Random): MoveVector {
  for (let i = 0; i < ticks; i++) vector.step(ctx(), rng);
  return vector;
}

/** Integrate a vector's movement, the way BulletSystem does. */
function travel(vector: MoveVector, ticks: number, rng?: Random): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (let i = 0; i < ticks; i++) {
    vector.step(ctx({ age: i, x, y }), rng);
    x += vector.moveX();
    y += vector.moveY();
  }
  return { x, y };
}

// ---------------------------------------------------------------------------

describe('polar model and sign convention', () => {
  // Screen space is y-down. Inverting this silently mirrors every pattern in
  // the game, so it is pinned from both directions: heading and resulting move.
  test('theta = 0 moves along +x only', () => {
    const v = new MoveVector();
    v.init({ r: 4, theta: 0 });
    expect(v.moveX()).toBeCloseTo(4);
    expect(v.moveY()).toBeCloseTo(0);
  });

  test('theta = 90 moves along +y, which is downward on screen', () => {
    const v = new MoveVector();
    v.init({ r: 4, theta: 90 });
    expect(v.moveX()).toBeCloseTo(0);
    expect(v.moveY()).toBeCloseTo(4);
  });

  test('theta = 180 moves along -x', () => {
    const v = new MoveVector();
    v.init({ r: 4, theta: 180 });
    expect(v.moveX()).toBeCloseTo(-4);
    expect(v.moveY()).toBeCloseTo(0);
  });

  test('theta = 270 moves along -y, which is upward on screen', () => {
    const v = new MoveVector();
    v.init({ r: 4, theta: 270 });
    expect(v.moveX()).toBeCloseTo(0);
    expect(v.moveY()).toBeCloseTo(-4);
  });

  test('theta = 45 splits evenly into +x and +y', () => {
    const v = new MoveVector();
    v.init({ r: Math.SQRT2, theta: 45 });
    expect(v.moveX()).toBeCloseTo(1);
    expect(v.moveY()).toBeCloseTo(1);
  });

  test('the default heading is 90, so an unconfigured bullet falls', () => {
    const v = new MoveVector();
    v.init({ r: 2 });
    expect(v.theta).toBe(90);
    expect(v.moveY()).toBeGreaterThan(0);
  });

  test('negative theta mirrors across the x axis', () => {
    const down = new MoveVector();
    const up = new MoveVector();
    down.init({ r: 3, theta: 60 });
    up.init({ r: 3, theta: -60 });
    expect(up.moveX()).toBeCloseTo(down.moveX());
    expect(up.moveY()).toBeCloseTo(-down.moveY());
  });

  test('theta wraps: 450 behaves as 90', () => {
    const v = new MoveVector();
    v.init({ r: 5, theta: 450 });
    expect(v.moveX()).toBeCloseTo(0);
    expect(v.moveY()).toBeCloseTo(5);
  });

  test('r is px/tick: distance travelled scales linearly with r', () => {
    const slow = new MoveVector();
    const fast = new MoveVector();
    slow.init({ r: 1, theta: 0 });
    fast.init({ r: 3, theta: 0 });
    expect(travel(slow, 10).x).toBeCloseTo(10);
    expect(travel(fast, 10).x).toBeCloseTo(30);
  });

  test('negative r reverses the heading', () => {
    const v = new MoveVector();
    v.init({ r: -4, theta: 90 });
    expect(v.moveY()).toBeCloseTo(-4);
  });
});

describe('init', () => {
  test('defaults everything except the falling heading', () => {
    const v = new MoveVector();
    v.init();
    expect(v.r).toBe(0);
    expect(v.theta).toBe(90);
    expect(v.w).toBe(0);
    expect(v.ra).toBe(0);
    expect(v.wa).toBe(0);
    expect(v.raa).toBe(0);
    expect(v.waa).toBe(0);
    expect(v.age).toBe(0);
    expect(v.reflectCount).toBe(0);
    expect(v.driftX).toBe(0);
    expect(v.driftY).toBe(0);
  });

  test('applies every declared parameter', () => {
    const v = new MoveVector();
    v.init({ r: 1, theta: 2, w: 3, ra: 4, wa: 5, raa: 6, waa: 7 });
    expect([v.r, v.theta, v.w, v.ra, v.wa, v.raa, v.waa]).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  // Pools reuse MoveVector instances, so a stale field from a previous bullet
  // would leak into the next one and desync a replay.
  test('re-init scrubs state left over from a previous life', () => {
    const v = new MoveVector();
    v.init({ r: 9, theta: 0, w: 4, ra: 2, raa: 1, gravity: { x: 3, y: 3 } });
    stepped(v, 5);
    v.reflect();
    expect(v.reflectCount).toBe(1);

    v.init();
    expect(v.r).toBe(0);
    expect(v.theta).toBe(90);
    expect(v.w).toBe(0);
    expect(v.ra).toBe(0);
    expect(v.raa).toBe(0);
    expect(v.age).toBe(0);
    expect(v.reflectCount).toBe(0);
    expect(v.driftX).toBe(0);
    expect(v.driftY).toBe(0);
  });

  test('re-init clears clamps that the new params do not declare', () => {
    const v = new MoveVector();
    v.init({ r: 0, ra: 10, rrange: { max: 5 } });
    stepped(v, 3);
    expect(v.r).toBe(5);

    v.init({ r: 0, ra: 10 });
    stepped(v, 3);
    expect(v.r).toBe(30);
  });

  test('re-init clears a previously attached behaviour', () => {
    let ran = 0;
    defineBehaviour('test:init-clears', () => {
      ran++;
    });
    const v = new MoveVector();
    v.init({ behaviour: 'test:init-clears' });
    v.step(ctx());
    expect(ran).toBe(1);

    v.init({});
    v.step(ctx());
    expect(ran).toBe(1);
  });

  test('re-init swaps one behaviour for another rather than stacking them', () => {
    const calls: string[] = [];
    defineBehaviour('test:init-swap-a', () => {
      calls.push('a');
    });
    defineBehaviour('test:init-swap-b', () => {
      calls.push('b');
    });
    const v = new MoveVector();
    v.init({ behaviour: 'test:init-swap-a' });
    v.step(ctx());
    v.init({ behaviour: 'test:init-swap-b' });
    v.step(ctx());
    expect(calls).toEqual(['a', 'b']);
  });

  // A failed lookup throws *after* the rest of init has already been applied,
  // so the vector is left half-configured. Callers must treat a throwing init
  // as fatal for that vector, not something to catch and fly on.
  test('an init that throws on an unknown behaviour has already mutated the vector', () => {
    const v = new MoveVector();
    v.init({ r: 1, theta: 10 });
    expect(() => v.init({ r: 5, theta: 20, behaviour: 'test:absent' })).toThrow();
    expect(v.r).toBe(5);
    expect(v.theta).toBe(20);
  });

  test('options default to an empty record and are replaced on re-init', () => {
    const v = new MoveVector();
    v.init();
    expect(v.options).toEqual({});

    v.init({ options: { swing: 12 } });
    expect(v.options.swing).toBe(12);

    v.init({});
    expect(v.options).toEqual({});
  });

  test('step increments age', () => {
    const v = new MoveVector();
    v.init();
    stepped(v, 7);
    expect(v.age).toBe(7);
  });
});

describe('derivatives', () => {
  test('w rotates theta by a constant amount each step', () => {
    const v = new MoveVector();
    v.init({ theta: 0, w: 15 });
    stepped(v, 4);
    expect(v.theta).toBe(60);
  });

  test('ra accumulates into r over several steps', () => {
    const v = new MoveVector();
    v.init({ r: 1, ra: 0.5 });
    stepped(v, 6);
    expect(v.r).toBeCloseTo(4);
  });

  test('wa accumulates into w, which then accumulates into theta', () => {
    const v = new MoveVector();
    v.init({ theta: 0, w: 2, wa: 1 });
    // theta advances by the pre-step w each tick: 2, 3, 4 => 9.
    stepped(v, 3);
    expect(v.theta).toBe(9);
    expect(v.w).toBe(5);
  });

  test('raa drives ra, which drives r — a two-stage integration', () => {
    const v = new MoveVector();
    v.init({ r: 0, ra: 1, raa: 0.5 });
    v.step(ctx());
    expect([v.r, v.ra]).toEqual([1, 1.5]);
    v.step(ctx());
    expect([v.r, v.ra]).toEqual([2.5, 2]);
    v.step(ctx());
    expect([v.r, v.ra]).toEqual([4.5, 2.5]);
  });

  test('waa drives wa, which drives w, which drives theta', () => {
    const v = new MoveVector();
    v.init({ theta: 0, w: 0, wa: 0, waa: 1 });
    v.step(ctx());
    expect([v.theta, v.w, v.wa]).toEqual([0, 0, 1]);
    v.step(ctx());
    expect([v.theta, v.w, v.wa]).toEqual([0, 1, 2]);
    v.step(ctx());
    expect([v.theta, v.w, v.wa]).toEqual([1, 3, 3]);
    v.step(ctx());
    expect([v.theta, v.w, v.wa]).toEqual([4, 6, 4]);
  });

  // The integration is explicit Euler on the previous tick's values. Switching
  // to the post-step derivative would shift every authored arc by one tick.
  test('theta advances by the pre-step w, not the post-step w', () => {
    const v = new MoveVector();
    v.init({ theta: 0, w: 10, wa: 5 });
    v.step(ctx());
    expect(v.theta).toBe(10);
    expect(v.w).toBe(15);
  });

  test('r advances by the pre-step ra, not the post-step ra', () => {
    const v = new MoveVector();
    v.init({ r: 0, ra: 10, raa: 5 });
    v.step(ctx());
    expect(v.r).toBe(10);
    expect(v.ra).toBe(15);
  });

  test('a decelerating bullet reverses once ra carries r past zero', () => {
    const v = new MoveVector();
    v.init({ r: 3, theta: 0, ra: -1 });
    stepped(v, 3);
    expect(v.r).toBe(0);
    v.step(ctx());
    expect(v.r).toBe(-1);
    expect(v.moveX()).toBeCloseTo(-1);
  });
});

describe('clamps', () => {
  test('rrange.max caps r after every step, not just the last', () => {
    const v = new MoveVector();
    v.init({ r: 0, ra: 10, rrange: { max: 25 } });
    v.step(ctx());
    expect(v.r).toBe(10);
    v.step(ctx());
    expect(v.r).toBe(20);
    v.step(ctx());
    expect(v.r).toBe(25);
    v.step(ctx());
    expect(v.r).toBe(25);
  });

  test('rrange.min floors a decelerating r', () => {
    const v = new MoveVector();
    v.init({ r: 10, ra: -3, rrange: { min: 0 } });
    stepped(v, 4);
    expect(v.r).toBe(0);
    stepped(v, 3);
    expect(v.r).toBe(0);
  });

  test('trange clamps the heading', () => {
    const v = new MoveVector();
    v.init({ theta: 0, w: 100, trange: { max: 180 } });
    v.step(ctx());
    expect(v.theta).toBe(100);
    v.step(ctx());
    expect(v.theta).toBe(180);
    v.step(ctx());
    expect(v.theta).toBe(180);
  });

  test('trange.min clamps a heading rotating the other way', () => {
    const v = new MoveVector();
    v.init({ theta: 90, w: -40, trange: { min: 0 } });
    stepped(v, 3);
    expect(v.theta).toBe(0);
  });

  test('wrange caps angular velocity, so the spin stops tightening', () => {
    const v = new MoveVector();
    v.init({ theta: 0, w: 0, wa: 3, wrange: { max: 5 } });
    v.step(ctx());
    expect(v.w).toBe(3);
    v.step(ctx());
    expect(v.w).toBe(5);
    v.step(ctx());
    expect(v.w).toBe(5);
    expect(v.theta).toBe(8);
  });

  test('rarange caps the acceleration itself', () => {
    const v = new MoveVector();
    v.init({ r: 0, ra: 0, raa: 2, rarange: { max: 5 } });
    stepped(v, 3);
    expect(v.ra).toBe(5);
    stepped(v, 2);
    expect(v.ra).toBe(5);
  });

  test('warange caps the angular acceleration', () => {
    const v = new MoveVector();
    v.init({ wa: 0, waa: 4, warange: { max: 6 } });
    stepped(v, 2);
    expect(v.wa).toBe(6);
    stepped(v, 5);
    expect(v.wa).toBe(6);
  });

  test('a range with only a max leaves the lower side unbounded', () => {
    const v = new MoveVector();
    v.init({ r: 0, ra: -5, rrange: { max: 10 } });
    stepped(v, 4);
    expect(v.r).toBe(-20);
  });

  test('a range with only a min leaves the upper side unbounded', () => {
    const v = new MoveVector();
    v.init({ r: 0, ra: 5, rrange: { min: -1 } });
    stepped(v, 4);
    expect(v.r).toBe(20);
  });

  test('a value already inside its range is untouched', () => {
    const v = new MoveVector();
    v.init({ r: 3, ra: 1, rrange: { min: 0, max: 100 } });
    stepped(v, 2);
    expect(v.r).toBe(5);
  });

  test('clamping is inclusive of the bound', () => {
    const v = new MoveVector();
    v.init({ r: 0, ra: 5, rrange: { max: 5 } });
    v.step(ctx());
    expect(v.r).toBe(5);
  });

  // Clamps are applied in `step`, never in `init`. A bullet therefore spends its
  // spawn tick moving at whatever speed it was authored with, however far that
  // sits outside its own range. BulletSystem reads moveX/moveY on the tick after
  // stepping, so this is one tick of real, visible travel — not a dormant value.
  test('an out-of-range init value survives untouched until the first step', () => {
    const v = new MoveVector();
    v.init({ r: 100, theta: 0, rrange: { max: 5 } });
    expect(v.r).toBe(100);
    expect(v.moveX()).toBeCloseTo(100);

    v.step(ctx());
    expect(v.r).toBe(5);
  });

  test('the first theta advance uses the unclamped init w', () => {
    const v = new MoveVector();
    v.init({ theta: 0, w: 100, wrange: { max: 5 } });
    // theta takes the full 100 before w is ever clamped down to 5.
    v.step(ctx());
    expect(v.theta).toBe(100);
    expect(v.w).toBe(5);

    v.step(ctx());
    expect(v.theta).toBe(105);
  });

  test('a randomized init draw is not filtered through its matching clamp', () => {
    const v = new MoveVector();
    v.init({ rrandom: { min: 50, max: 60 }, rrange: { max: 5 } }, new Random(11));
    expect(v.r).toBeGreaterThanOrEqual(50);

    v.step(ctx());
    expect(v.r).toBe(5);
  });

  // max is tested before min, so an inverted range is not merely useless — it
  // reports different values on either side of itself. Pinned so that giving
  // inverted ranges a defined meaning is a deliberate change.
  test('an inverted range resolves max first', () => {
    const high = new MoveVector();
    high.init({ r: 7, rrange: { min: 10, max: 5 } });
    high.step(ctx());
    expect(high.r).toBe(5);

    const low = new MoveVector();
    low.init({ r: 3, rrange: { min: 10, max: 5 } });
    low.step(ctx());
    expect(low.r).toBe(10);
  });
});

describe('reflection', () => {
  test('reflectX reverses horizontal travel and preserves vertical', () => {
    const v = new MoveVector();
    v.init({ r: 3, theta: 30 });
    const beforeX = v.moveX();
    const beforeY = v.moveY();
    expect(beforeX).toBeGreaterThan(0);

    v.reflectX();
    expect(v.moveX()).toBeCloseTo(-beforeX);
    expect(v.moveY()).toBeCloseTo(beforeY);
  });

  test('reflectY reverses vertical travel and preserves horizontal', () => {
    const v = new MoveVector();
    v.init({ r: 3, theta: 30 });
    const beforeX = v.moveX();
    const beforeY = v.moveY();
    expect(beforeY).toBeGreaterThan(0);

    v.reflectY();
    expect(v.moveX()).toBeCloseTo(beforeX);
    expect(v.moveY()).toBeCloseTo(-beforeY);
  });

  test('reflect reverses both axes', () => {
    const v = new MoveVector();
    v.init({ r: 3, theta: 30 });
    const beforeX = v.moveX();
    const beforeY = v.moveY();

    v.reflect();
    expect(v.moveX()).toBeCloseTo(-beforeX);
    expect(v.moveY()).toBeCloseTo(-beforeY);
  });

  test('reflectX on a straight-down bullet leaves it falling', () => {
    const v = new MoveVector();
    v.init({ r: 2, theta: 90 });
    v.reflectX();
    expect(v.moveY()).toBeCloseTo(2);
    expect(v.moveX()).toBeCloseTo(0);
  });

  test('reflectY on a straight-right bullet leaves it going right', () => {
    const v = new MoveVector();
    v.init({ r: 2, theta: 0 });
    v.reflectY();
    expect(v.moveX()).toBeCloseTo(2);
    expect(v.moveY()).toBeCloseTo(0);
  });

  test('reflecting the same axis twice restores the original heading', () => {
    const v = new MoveVector();
    v.init({ r: 3, theta: 30 });
    v.reflectX();
    v.reflectX();
    expect(v.theta).toBe(30);

    v.reflectY();
    v.reflectY();
    expect(v.theta).toBe(30);
  });

  test('reflecting twice restores the original travel direction', () => {
    const v = new MoveVector();
    v.init({ r: 3, theta: 30 });
    const beforeX = v.moveX();
    const beforeY = v.moveY();
    v.reflect();
    v.reflect();
    expect(v.moveX()).toBeCloseTo(beforeX);
    expect(v.moveY()).toBeCloseTo(beforeY);
  });

  test('every reflection kind increments reflectCount', () => {
    const v = new MoveVector();
    v.init({ r: 1 });
    expect(v.reflectCount).toBe(0);
    v.reflectX();
    expect(v.reflectCount).toBe(1);
    v.reflectY();
    expect(v.reflectCount).toBe(2);
    v.reflect();
    expect(v.reflectCount).toBe(3);
  });

  test('reflectCount survives stepping and resets on init', () => {
    const v = new MoveVector();
    v.init({ r: 1 });
    v.reflectX();
    v.reflectY();
    stepped(v, 5);
    expect(v.reflectCount).toBe(2);

    v.init({ r: 1 });
    expect(v.reflectCount).toBe(0);
  });

  test('a reflected bullet retraces its path', () => {
    const v = new MoveVector();
    v.init({ r: 2, theta: 35 });
    const out = travel(v, 6);
    v.reflect();
    const back = travel(v, 6);
    expect(out.x + back.x).toBeCloseTo(0);
    expect(out.y + back.y).toBeCloseTo(0);
  });

  // Reflection writes theta directly and does not re-clamp, so a bounce can put
  // a heading outside its own trange until the next step drags it back. A
  // bouncing bullet with a constrained heading is therefore authorable but not
  // trustworthy on the bounce tick.
  test('reflecting past a trange bound is only corrected on the next step', () => {
    const v = new MoveVector();
    v.init({ r: 2, theta: 170, trange: { max: 180 } });
    v.reflect();
    expect(v.theta).toBe(350);

    v.step(ctx());
    expect(v.theta).toBe(180);
  });

  test('reflection does not disturb speed or the derivative chain', () => {
    const v = new MoveVector();
    v.init({ r: 4, theta: 45, ra: 1, w: 2 });
    v.reflectX();
    expect(v.r).toBe(4);
    expect(v.ra).toBe(1);
    expect(v.w).toBe(2);
  });
});

describe('gravity drift', () => {
  test('drift accumulates one gravity step per tick', () => {
    const v = new MoveVector();
    v.init({ r: 0, gravity: { x: 0.25, y: 0.5 } });
    stepped(v, 4);
    expect(v.driftX).toBeCloseTo(1);
    expect(v.driftY).toBeCloseTo(2);
  });

  test('drift adds on top of the polar term', () => {
    const v = new MoveVector();
    v.init({ r: 2, theta: 90, gravity: { y: 1 } });
    stepped(v, 3);
    expect(v.moveY()).toBeCloseTo(5);
    expect(v.moveX()).toBeCloseTo(0);
  });

  test('horizontal gravity bends a falling bullet sideways', () => {
    const v = new MoveVector();
    v.init({ r: 1, theta: 90, gravity: { x: 0.1 } });
    const end = travel(v, 10);
    expect(end.x).toBeGreaterThan(0);
    expect(end.y).toBeCloseTo(10);
  });

  test('a bullet fired upward under gravity arcs back down', () => {
    const v = new MoveVector();
    v.init({ r: 3, theta: 270, gravity: { y: 0.5 } });
    // Rising while drift is small, falling once drift overtakes the polar term.
    expect(travel(v, 3).y).toBeLessThan(0);
    stepped(v, 20);
    expect(v.moveY()).toBeGreaterThan(0);
  });

  test('reflectY negates only the vertical drift', () => {
    const v = new MoveVector();
    v.init({ r: 0, gravity: { x: 1, y: 2 } });
    stepped(v, 3);
    v.reflectY();
    expect(v.driftX).toBeCloseTo(3);
    expect(v.driftY).toBeCloseTo(-6);
  });

  test('reflectX negates only the horizontal drift', () => {
    const v = new MoveVector();
    v.init({ r: 0, gravity: { x: 1, y: 2 } });
    stepped(v, 3);
    v.reflectX();
    expect(v.driftX).toBeCloseTo(-3);
    expect(v.driftY).toBeCloseTo(6);
  });

  test('reflect negates both drift axes', () => {
    const v = new MoveVector();
    v.init({ r: 0, gravity: { x: 1, y: 2 } });
    stepped(v, 3);
    v.reflect();
    expect(v.driftX).toBeCloseTo(-3);
    expect(v.driftY).toBeCloseTo(-6);
  });

  test('reflection mirrors total movement exactly, drift included', () => {
    const v = new MoveVector();
    v.init({ r: 2, theta: 90, gravity: { y: 1 } });
    stepped(v, 3);
    const beforeY = v.moveY();
    v.reflectY();
    expect(v.moveY()).toBeCloseTo(-beforeY);
  });

  test('drift keeps growing after a reflection, from the negated value', () => {
    const v = new MoveVector();
    v.init({ r: 0, gravity: { y: 1 } });
    stepped(v, 3);
    v.reflectY();
    expect(v.driftY).toBeCloseTo(-3);
    stepped(v, 2);
    expect(v.driftY).toBeCloseTo(-1);
  });

  test('init clears drift so a pooled vector does not inherit a fall', () => {
    const v = new MoveVector();
    v.init({ gravity: { x: 1, y: 1 } });
    stepped(v, 10);
    expect(v.driftY).toBeCloseTo(10);

    v.init({ r: 1, theta: 0 });
    expect(v.driftX).toBe(0);
    expect(v.driftY).toBe(0);
    expect(v.moveX()).toBeCloseTo(1);
  });
});

describe('aimAt', () => {
  test('aims right', () => {
    const v = new MoveVector();
    v.init({ r: 1 });
    v.aimAt(0, 0, 10, 0);
    expect(v.theta).toBeCloseTo(0);
  });

  test('aims down, which is +y in screen space', () => {
    const v = new MoveVector();
    v.init({ r: 1 });
    v.aimAt(0, 0, 0, 10);
    expect(v.theta).toBeCloseTo(90);
  });

  test('aims left', () => {
    const v = new MoveVector();
    v.init({ r: 1 });
    v.aimAt(0, 0, -10, 0);
    expect(Math.abs(v.theta)).toBeCloseTo(180);
  });

  test('aims up', () => {
    const v = new MoveVector();
    v.init({ r: 1 });
    v.aimAt(0, 0, 0, -10);
    expect(v.theta).toBeCloseTo(-90);
  });

  test('down-right is +45', () => {
    const v = new MoveVector();
    v.aimAt(0, 0, 10, 10);
    expect(v.theta).toBeCloseTo(45);
  });

  test('down-left is +135', () => {
    const v = new MoveVector();
    v.aimAt(0, 0, -10, 10);
    expect(v.theta).toBeCloseTo(135);
  });

  test('up-left is -135', () => {
    const v = new MoveVector();
    v.aimAt(0, 0, -10, -10);
    expect(v.theta).toBeCloseTo(-135);
  });

  test('up-right is -45', () => {
    const v = new MoveVector();
    v.aimAt(0, 0, 10, -10);
    expect(v.theta).toBeCloseTo(-45);
  });

  test('preserves speed', () => {
    const v = new MoveVector();
    v.init({ r: 7, theta: 0 });
    v.aimAt(100, 100, 50, 400);
    expect(v.r).toBe(7);
  });

  test('the resulting movement actually points at the target', () => {
    const v = new MoveVector();
    v.init({ r: 5 });
    v.aimAt(200, 100, 120, 380);
    // Direction of travel must match the direction to the target.
    const scale = 5 / Math.hypot(-80, 280);
    expect(v.moveX()).toBeCloseTo(-80 * scale);
    expect(v.moveY()).toBeCloseTo(280 * scale);
  });

  test('aiming from a non-origin source uses the relative offset', () => {
    const a = new MoveVector();
    const b = new MoveVector();
    a.aimAt(0, 0, 3, 4);
    b.aimAt(500, 500, 503, 504);
    expect(b.theta).toBeCloseTo(a.theta);
  });

  test('aiming at the current position yields a defined heading', () => {
    const v = new MoveVector();
    v.init({ r: 2, theta: 123 });
    v.aimAt(50, 50, 50, 50);
    expect(v.theta).toBe(0);
  });

  // `MotionParams.aimed` is declared and documented on motion.ts:52 but read
  // nowhere in src/. A pattern that sets it gets ordinary un-aimed fire, in
  // silence. Aiming currently happens only where a caller invokes `aimAt`
  // explicitly, as BulletSystem.spawnAimed does. This pins the no-op so that
  // wiring the flag up is a deliberate change with a failing test to greet it,
  // rather than something a pattern author discovers by shipping a dead spell.
  test('the aimed flag is inert — declared, documented, and never read', () => {
    const plain = new MoveVector();
    const flagged = new MoveVector();
    plain.init({ r: 3, theta: 90 });
    flagged.init({ r: 3, theta: 90, aimed: true });
    expect(flagged.theta).toBe(plain.theta);

    // Even with a target sitting in the context, stepping never turns it.
    flagged.step(ctx({ x: 0, y: 0, targetX: 500, targetY: 0 }));
    expect(flagged.theta).toBe(90);
  });

  test('a bullet aimed at a point converges on it', () => {
    const v = new MoveVector();
    v.init({ r: 2 });
    v.aimAt(0, 0, 60, 80);
    const end = travel(v, 50);
    expect(end.x).toBeCloseTo(60);
    expect(end.y).toBeCloseTo(80);
  });
});

describe('MotionTimeline', () => {
  const rng = () => new Random(5);

  test('an empty timeline is an inert no-op', () => {
    const timeline = new MotionTimeline();
    const v = new MoveVector();
    v.init({ r: 3 });
    expect(timeline.step(v, rng())).toBe(false);
    expect(v.r).toBe(3);
  });

  test('a count-0 segment applies on the very first tick', () => {
    const timeline = new MotionTimeline([{ count: 0, motion: { r: 6, theta: 0 } }]);
    const v = new MoveVector();
    expect(timeline.step(v, rng())).toBe(true);
    expect(v.r).toBe(6);
    expect(v.theta).toBe(0);
  });

  test('a segment applies on the tick its count names, and not before', () => {
    const timeline = new MotionTimeline([{ count: 3, motion: { r: 7 } }]);
    const v = new MoveVector();
    v.init({ r: 1 });
    expect(timeline.step(v, rng())).toBe(false);
    expect(timeline.step(v, rng())).toBe(false);
    expect(timeline.step(v, rng())).toBe(false);
    expect(v.r).toBe(1);
    expect(timeline.step(v, rng())).toBe(true);
    expect(v.r).toBe(7);
  });

  test('ticks after the last segment report no change', () => {
    const timeline = new MotionTimeline([{ count: 0, motion: { r: 2 } }]);
    const v = new MoveVector();
    expect(timeline.step(v, rng())).toBe(true);
    expect(timeline.step(v, rng())).toBe(false);
    expect(timeline.step(v, rng())).toBe(false);
  });

  test('segments sharing a count all apply in order, the last one winning', () => {
    const timeline = new MotionTimeline([
      { count: 0, motion: { r: 1 } },
      { count: 0, motion: { r: 2 } },
      { count: 0, motion: { r: 3 } },
    ]);
    const v = new MoveVector();
    expect(timeline.step(v, rng())).toBe(true);
    expect(v.r).toBe(3);
  });

  test('a segment without motion advances the timeline without re-initialising', () => {
    const timeline = new MotionTimeline([{ count: 0 }, { count: 2, motion: { r: 5 } }]);
    const v = new MoveVector();
    v.init({ r: 1 });
    expect(timeline.step(v, rng())).toBe(false);
    expect(v.r).toBe(1);
    expect(timeline.step(v, rng())).toBe(false);
    expect(timeline.step(v, rng())).toBe(true);
    expect(v.r).toBe(5);
  });

  test('successive segments run in sequence', () => {
    const timeline = new MotionTimeline([
      { count: 0, motion: { r: 1 } },
      { count: 2, motion: { r: 2 } },
      { count: 4, motion: { r: 3 } },
    ]);
    const v = new MoveVector();
    const trace: number[] = [];
    for (let i = 0; i < 6; i++) {
      timeline.step(v, rng());
      trace.push(v.r);
    }
    expect(trace).toEqual([1, 1, 2, 2, 3, 3]);
  });

  test('jump loops the timeline back and restarts its clock', () => {
    const segments: MotionSegment[] = [
      { count: 0, motion: { r: 1 } },
      { count: 2, motion: { r: 2 } },
      { count: 4, jump: 0 },
    ];
    const timeline = new MotionTimeline(segments);
    const v = new MoveVector();
    const trace: number[] = [];
    for (let i = 0; i < 12; i++) {
      timeline.step(v, rng());
      trace.push(v.r);
    }
    expect(trace).toEqual([1, 1, 2, 2, 1, 1, 2, 2, 1, 1, 2, 2]);
  });

  test('jump can target a segment other than the first', () => {
    const timeline = new MotionTimeline([
      { count: 0, motion: { r: 1 } },
      { count: 1, motion: { r: 2 } },
      { count: 2, motion: { r: 3 } },
      { count: 4, jump: 1 },
    ]);
    const v = new MoveVector();
    const trace: number[] = [];
    for (let i = 0; i < 9; i++) {
      timeline.step(v, rng());
      trace.push(v.r);
    }
    // The first pass runs 1,2,3; thereafter the loop replays only 2,3. The
    // jump tick itself re-inits nothing, because segment 1 is not yet due
    // against the freshly reset clock.
    expect(trace).toEqual([1, 2, 3, 3, 3, 2, 3, 3, 3]);
  });

  // Without the iteration guard a self-jumping segment would freeze the frame.
  // Authored data is hand-written, so this cycle is a plausible typo.
  test('a zero-length jump cycle is bounded instead of hanging the tick', () => {
    class CountingVector extends MoveVector {
      initCalls = 0;
      override init(params?: Parameters<MoveVector['init']>[0], r?: Random): void {
        this.initCalls++;
        super.init(params, r);
      }
    }

    const timeline = new MotionTimeline([
      { count: 0, motion: { r: 1 } },
      { count: 0, jump: 0 },
    ]);
    const v = new CountingVector();
    expect(timeline.step(v, rng())).toBe(true);
    expect(v.initCalls).toBe(32);

    // The next tick is bounded too — the guard is per-tick, not one-shot.
    v.initCalls = 0;
    expect(timeline.step(v, rng())).toBe(true);
    expect(v.initCalls).toBe(32);
  });

  test('a jump past the end of the list retires the timeline safely', () => {
    const timeline = new MotionTimeline([
      { count: 0, motion: { r: 1 } },
      { count: 1, jump: 9 },
    ]);
    const v = new MoveVector();
    timeline.step(v, rng());
    expect(v.r).toBe(1);
    expect(() => {
      for (let i = 0; i < 10; i++) timeline.step(v, rng());
    }).not.toThrow();
    expect(v.r).toBe(1);
  });

  test('a negative jump index retires the timeline safely', () => {
    const timeline = new MotionTimeline([
      { count: 0, motion: { r: 1 } },
      { count: 1, jump: -1 },
    ]);
    const v = new MoveVector();
    timeline.step(v, rng());
    expect(() => {
      for (let i = 0; i < 10; i++) timeline.step(v, rng());
    }).not.toThrow();
    expect(v.r).toBe(1);
  });

  test('reset replays the same segments from the start', () => {
    const timeline = new MotionTimeline([
      { count: 0, motion: { r: 1 } },
      { count: 2, motion: { r: 2 } },
    ]);
    const v = new MoveVector();
    for (let i = 0; i < 4; i++) timeline.step(v, rng());
    expect(v.r).toBe(2);

    timeline.reset();
    expect(timeline.step(v, rng())).toBe(true);
    expect(v.r).toBe(1);
  });

  test('reset can swap in a different timeline', () => {
    const timeline = new MotionTimeline([{ count: 0, motion: { r: 1 } }]);
    const v = new MoveVector();
    timeline.step(v, rng());
    expect(v.r).toBe(1);

    timeline.reset([{ count: 0, motion: { r: 8, theta: 0 } }]);
    expect(timeline.step(v, rng())).toBe(true);
    expect(v.r).toBe(8);
    expect(v.theta).toBe(0);
  });

  test('the timeline hands its generator to the segment init', () => {
    const timeline = new MotionTimeline([
      { count: 0, motion: { rrandom: { min: 0, max: 100 } } },
    ]);
    const v = new MoveVector();
    const reference = new Random(5);
    timeline.step(v, rng());
    expect(v.r).toBe(Math.floor(reference.random() * 100));
  });

  test('a looping timeline redraws randomized values on each pass', () => {
    const segments: MotionSegment[] = [
      { count: 0, motion: { trandom: { min: 0, max: 360 } } },
      { count: 2, jump: 0 },
    ];
    const timeline = new MotionTimeline(segments);
    const shared = new Random(21);
    const v = new MoveVector();
    const draws: number[] = [];
    for (let i = 0; i < 6; i++) {
      if (timeline.step(v, shared)) draws.push(v.theta);
    }
    expect(draws.length).toBe(3);

    const reference = new Random(21);
    expect(draws).toEqual([
      Math.floor(reference.random() * 360),
      Math.floor(reference.random() * 360),
      Math.floor(reference.random() * 360),
    ]);
  });
});

describe('randomized init', () => {
  // Draw order is the determinism contract. Reordering these three lines would
  // change every subsequent draw in the run, so it is asserted explicitly.
  test('rrandom, trandom and wrandom draw in declaration order', () => {
    const rng = new Random(7);
    const reference = new Random(7);
    const v = new MoveVector();
    v.init(
      {
        rrandom: { min: 2, max: 9 },
        trandom: { min: 0, max: 360 },
        wrandom: { min: -5, max: 5 },
      },
      rng,
    );
    expect(v.r).toBe(2 + Math.floor(reference.random() * 7));
    expect(v.theta).toBe(0 + Math.floor(reference.random() * 360));
    expect(v.w).toBe(-5 + Math.floor(reference.random() * 10));
  });

  test('an absent randomized field consumes no draw', () => {
    const rng = new Random(7);
    const reference = new Random(7);
    const v = new MoveVector();
    v.init({ trandom: { min: 0, max: 360 }, wrandom: { min: -5, max: 5 } }, rng);
    // theta takes what would have been r's draw.
    expect(v.theta).toBe(Math.floor(reference.random() * 360));
    expect(v.w).toBe(-5 + Math.floor(reference.random() * 10));
  });

  test('each randomized field consumes exactly one draw', () => {
    const rng = new Random(3);
    const v = new MoveVector();
    v.init({ rrandom: { min: 0, max: 10 } }, rng);

    const reference = new Random(3);
    reference.random();
    expect(rng.getState()).toEqual(reference.getState());
  });

  test('an init with no randomized fields consumes no draws at all', () => {
    const rng = new Random(3);
    const before = rng.getState();
    new MoveVector().init({ r: 4, theta: 12, w: 1 }, rng);
    expect(rng.getState()).toEqual(before);
  });

  test('a randomized field overrides its literal counterpart', () => {
    const v = new MoveVector();
    v.init({ r: 999, rrandom: { min: 0, max: 4 } }, new Random(1));
    expect(v.r).toBeLessThan(4);
  });

  test('draws are integers inside [min, max)', () => {
    const rng = new Random(1234);
    const v = new MoveVector();
    for (let i = 0; i < 200; i++) {
      v.init({ rrandom: { min: 3, max: 7 } }, rng);
      expect(Number.isInteger(v.r)).toBe(true);
      expect(v.r).toBeGreaterThanOrEqual(3);
      expect(v.r).toBeLessThanOrEqual(6);
    }
  });

  test('a range whose max does not exceed its min yields the min and draws nothing', () => {
    const rng = new Random(9);
    const before = rng.getState();
    const v = new MoveVector();
    v.init({ rrandom: { min: 5, max: 5 } }, rng);
    expect(v.r).toBe(5);
    expect(rng.getState()).toEqual(before);
  });

  // `max` defaults to 0, so a min-only range trips the `max <= min` branch:
  // `{ min: 5 }` is a constant 5, not "5 or more". The consumed-nothing half
  // matters more than the value — giving this range a meaning later would add a
  // draw here and shift every subsequent draw in the run.
  test('a range with only a min is degenerate, yields the min, and draws nothing', () => {
    const rng = new Random(9);
    const before = rng.getState();
    const v = new MoveVector();
    v.init({ rrandom: { min: 5 } }, rng);
    expect(v.r).toBe(5);
    expect(rng.getState()).toEqual(before);
  });

  test('a degenerate range still leaves following draws in declaration order', () => {
    const rng = new Random(9);
    const v = new MoveVector();
    v.init({ rrandom: { min: 5 }, trandom: { min: 0, max: 360 } }, rng);

    // theta must take the stream's *first* draw: r consumed none.
    const reference = new Random(9);
    expect(v.r).toBe(5);
    expect(v.theta).toBe(Math.floor(reference.random() * 360));
  });

  test('a range with only a max draws from zero', () => {
    const rng = new Random(1234);
    const v = new MoveVector();
    for (let i = 0; i < 50; i++) {
      v.init({ rrandom: { max: 4 } }, rng);
      expect(v.r).toBeGreaterThanOrEqual(0);
      expect(v.r).toBeLessThanOrEqual(3);
    }
  });

  test('negative ranges draw below zero', () => {
    const rng = new Random(77);
    const v = new MoveVector();
    let sawNegative = false;
    for (let i = 0; i < 100; i++) {
      v.init({ wrandom: { min: -5, max: 5 } }, rng);
      expect(v.w).toBeGreaterThanOrEqual(-5);
      expect(v.w).toBeLessThanOrEqual(4);
      if (v.w < 0) sawNegative = true;
    }
    expect(sawNegative).toBe(true);
  });

  test('init defaults to the shared sim stream', () => {
    seedRun(4321);
    const v = new MoveVector();
    v.init({ rrandom: { min: 0, max: 100 } });

    const reference = new Random(4321);
    expect(v.r).toBe(Math.floor(reference.random() * 100));
  });
});

describe('determinism', () => {
  function run(seed: number): string {
    return runWith(new Random(seed));
  }

  function runWith(rng: Random): string {
    const timeline = new MotionTimeline([
      { count: 0, motion: { rrandom: { min: 1, max: 4 }, trandom: { min: 0, max: 360 } } },
      { count: 30, motion: { r: 2, w: 3, wrandom: { min: -4, max: 4 } } },
      { count: 60, jump: 0 },
    ]);
    const v = new MoveVector();
    let x = 0;
    let y = 0;
    const trace: string[] = [];
    for (let tick = 0; tick < 200; tick++) {
      timeline.step(v, rng);
      v.step(ctx({ age: tick, x, y }), rng);
      x += v.moveX();
      y += v.moveY();
      trace.push(`${x.toFixed(6)},${y.toFixed(6)}`);
    }
    return trace.join('|');
  }

  test('the same seed reproduces the run exactly', () => {
    expect(run(20240719)).toBe(run(20240719));
  });

  test('a different seed produces a different run', () => {
    expect(run(1)).not.toBe(run(2));
  });

  // RNG call order is part of the contract (CLAUDE.md rule 2): a single stray
  // draw anywhere upstream of the run must move the whole trajectory, otherwise
  // the stream is not actually feeding the motion we think it is.
  test('one extra draw before the run desyncs the whole trajectory', () => {
    const seed = 555;
    const rng = new Random(seed);
    rng.random();
    expect(runWith(rng)).not.toBe(run(seed));
  });

  test('the motion source draws no unseeded randomness and reads no clock', () => {
    const source = Bun.file(`${import.meta.dir}/motion.ts`);
    return source.text().then((text) => {
      expect(text).not.toMatch(/Math\.random\s*\(/);
      expect(text).not.toMatch(/\bDate\.now\b/);
      expect(text).not.toMatch(/\bperformance\.now\b/);
      // Frame-locked: no delta-time may reach the simulation.
      expect(text).not.toMatch(/\bdeltaTime\b|\belapsedTime\b/);
    });
  });
});

describe('behaviours', () => {
  test('a defined behaviour can be retrieved by name', () => {
    const fn = () => {};
    defineBehaviour('test:lookup', fn);
    expect(getBehaviour('test:lookup')).toBe(fn);
  });

  test('an unknown name resolves to undefined', () => {
    expect(getBehaviour('test:never-registered')).toBeUndefined();
  });

  test('registering the same name twice throws', () => {
    defineBehaviour('test:duplicate', () => {});
    expect(() => defineBehaviour('test:duplicate', () => {})).toThrow(
      'motion behaviour "test:duplicate" is already defined',
    );
  });

  test('a duplicate registration leaves the original in place', () => {
    const original = () => {};
    defineBehaviour('test:duplicate-keeps', original);
    try {
      defineBehaviour('test:duplicate-keeps', () => {});
    } catch {
      // expected
    }
    expect(getBehaviour('test:duplicate-keeps')).toBe(original);
  });

  test('referencing an unknown behaviour in init throws', () => {
    const v = new MoveVector();
    expect(() => v.init({ behaviour: 'test:missing' })).toThrow(
      'unknown motion behaviour "test:missing"',
    );
  });

  test('a behaviour runs once per step', () => {
    let calls = 0;
    defineBehaviour('test:count-steps', () => {
      calls++;
    });
    const v = new MoveVector();
    v.init({ behaviour: 'test:count-steps' });
    stepped(v, 5);
    expect(calls).toBe(5);
  });

  test('a behaviour receives the vector, the context and the generator', () => {
    let seen: { r: number; x: number; targetY: number; draw: number } | undefined;
    defineBehaviour('test:capture-args', (vector, context, rng) => {
      seen = { r: vector.r, x: context.x, targetY: context.targetY, draw: rng.random() };
    });
    const v = new MoveVector();
    v.init({ r: 3, behaviour: 'test:capture-args' });
    v.step(ctx({ x: 42, targetY: 90 }), new Random(8));

    const reference = new Random(8);
    expect(seen).toEqual({ r: 3, x: 42, targetY: 90, draw: reference.random() });
  });

  test('step defaults its generator to the shared sim stream', () => {
    defineBehaviour('test:default-stream', (vector, _context, rng) => {
      vector.r = rng.random();
    });
    seedRun(606);
    const v = new MoveVector();
    v.init({ behaviour: 'test:default-stream' });
    v.step(ctx());

    const reference = new Random(606);
    expect(v.r).toBe(reference.random());
  });

  test('a behaviour can steer the vector — homing lives here', () => {
    defineBehaviour('test:home', (vector, context) => {
      vector.aimAt(context.x, context.y, context.targetX, context.targetY);
    });
    const v = new MoveVector();
    v.init({ r: 2, theta: 0, behaviour: 'test:home' });

    let x = 0;
    let y = 0;
    for (let i = 0; i < 100; i++) {
      v.step(ctx({ x, y, targetX: 40, targetY: 120 }));
      x += v.moveX();
      y += v.moveY();
    }
    expect(Math.hypot(x - 40, y - 120)).toBeLessThan(3);
  });

  test('a behaviour reads its options off the vector', () => {
    defineBehaviour('test:options', (vector) => {
      vector.r += vector.options.push ?? 0;
    });
    const v = new MoveVector();
    v.init({ r: 0, behaviour: 'test:options', options: { push: 2.5 } });
    stepped(v, 4);
    expect(v.r).toBe(10);
  });

  // The behaviour is the last word: it runs after the clamps, so it can express
  // motion the polar model refuses.
  test('a behaviour runs after the clamps are applied', () => {
    defineBehaviour('test:after-clamp', (vector) => {
      vector.r += 100;
    });
    const v = new MoveVector();
    v.init({ r: 1, ra: 5, rrange: { max: 2 }, behaviour: 'test:after-clamp' });
    v.step(ctx());
    expect(v.r).toBe(102);
  });

  test('a behaviour sees the age of the step it is running in', () => {
    const seen: number[] = [];
    defineBehaviour('test:age-probe', (vector) => {
      seen.push(vector.age);
    });
    const v = new MoveVector();
    v.init({ behaviour: 'test:age-probe' });
    stepped(v, 3);
    expect(seen).toEqual([0, 1, 2]);
  });

  test('a behaviour attached by a timeline segment takes over mid-flight', () => {
    defineBehaviour('test:segment-attached', (vector) => {
      vector.theta += 45;
    });
    const timeline = new MotionTimeline([
      { count: 0, motion: { r: 1, theta: 0 } },
      { count: 2, motion: { r: 1, theta: 0, behaviour: 'test:segment-attached' } },
    ]);
    const v = new MoveVector();
    const rng = new Random(2);

    timeline.step(v, rng);
    v.step(ctx());
    expect(v.theta).toBe(0);

    timeline.step(v, rng);
    v.step(ctx());
    expect(v.theta).toBe(0);

    timeline.step(v, rng);
    v.step(ctx());
    expect(v.theta).toBe(45);
  });
});
