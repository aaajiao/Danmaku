import { afterAll, describe, expect, test } from 'bun:test';
import { fx, Random, seedRun, sim } from './random';

/**
 * Captured at import time, before any test has touched the singletons, so the
 * "what does an untouched stream look like" assertions test the real thing
 * rather than whatever a previous test left behind.
 */
const SIM_INITIAL_STATE = sim.getState();
const FX_INITIAL_STATE = fx.getState();

// `sim` and `fx` are process-wide singletons shared with every other test file.
// Leaving them advanced would make this suite's effect on others depend on file
// order, which is exactly the kind of hidden coupling determinism forbids.
afterAll(() => {
  sim.setState(SIM_INITIAL_STATE);
  fx.setState(FX_INITIAL_STATE);
});

/** Drain `count` draws from `fn` into an array, for sequence comparison. */
function draw(count: number, fn: () => number): number[] {
  return Array.from({ length: count }, fn);
}

/**
 * Independent oracle. Runs xorshift128 over unsigned BigInts with explicit
 * masking, sharing none of the int32 coercion (`<<`, `>>>`, `| 0`) the
 * implementation leans on. Agreement between the two is evidence about the
 * algorithm; a test that re-derived values with the implementation's own
 * expression would only be evidence that the expression equals itself.
 */
function referenceDraws(seed: number, count: number): number[] {
  const MASK = 0xffffffffn;
  let x = 123456789n;
  let y = 362436069n;
  let z = 521288629n;
  let w = BigInt.asUintN(32, BigInt(Math.trunc(seed)));

  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = (x ^ ((x << 11n) & MASK)) & MASK;
    x = y;
    y = z;
    z = w;
    w = ((w ^ (w >> 19n)) ^ (t ^ (t >> 8n))) & MASK;
    out.push(Number(w));
  }
  return out;
}

describe('determinism', () => {
  test('the same seed reproduces the same raw sequence', () => {
    const a = new Random(12345);
    const b = new Random(12345);

    expect(draw(64, () => a.next())).toEqual(draw(64, () => b.next()));
  });

  test('the same seed reproduces the same float sequence', () => {
    const a = new Random(-98765);
    const b = new Random(-98765);

    expect(draw(64, () => a.random())).toEqual(draw(64, () => b.random()));
  });

  test('the same seed reproduces the same derived draws', () => {
    const a = new Random(7);
    const b = new Random(7);
    const derive = (r: Random) => [
      r.int(0, 100),
      r.range(-5, 5),
      r.angle(),
      r.pick([1, 2, 3, 4, 5]),
    ];

    expect(derive(a)).toEqual(derive(b));
  });

  test('different seeds diverge on the very first draw', () => {
    expect(new Random(1).next()).not.toBe(new Random(2).next());
  });

  test('neighbouring seeds produce entirely different sequences', () => {
    const a = new Random(1000);
    const b = new Random(1001);
    const seqA = draw(32, () => a.next());
    const seqB = draw(32, () => b.next());

    const shared = seqA.filter((v, i) => v === seqB[i]);
    expect(shared).toHaveLength(0);
  });

  test('an unseeded generator is itself reproducible', () => {
    // Two long-lived instances, not a fresh one per draw: comparing 32 first
    // draws would pass even against a generator that never advances its state.
    const a = new Random();
    const b = new Random();
    const seq = draw(32, () => a.next());

    expect(seq).toEqual(draw(32, () => b.next()));
    expect(new Set(seq).size).toBe(32);
  });

  test('the default state is the documented xorshift128 seed', () => {
    expect(new Random().getState()).toEqual([123456789, 362436069, 521288629, 88675123]);
  });

  test('seeding replaces only w, leaving the canonical x/y/z', () => {
    expect(new Random(42).getState()).toEqual([123456789, 362436069, 521288629, 42]);
  });

  test('the generator matches a frozen golden sequence', () => {
    // Locks the algorithm itself: any change here invalidates every replay
    // recorded before it.
    const r = new Random(42);

    expect(draw(6, () => r.next())).toEqual([
      3656013402, 504890879, 2421774874, 2421692779, 462149052, 3311541455,
    ]);
  });

  test('matches an independent BigInt implementation of xorshift128', () => {
    for (const seed of [0, 1, 42, -1, 2 ** 31 - 1, -(2 ** 31), 0x9e3779b9]) {
      const r = new Random(seed);
      expect(draw(256, () => r.next())).toEqual(referenceDraws(seed, 256));
    }
  });

  test('the unseeded stream also matches the independent implementation', () => {
    const r = new Random();

    // 88675123 is DEFAULT_W, i.e. what the constructor leaves w at.
    expect(draw(256, () => r.next())).toEqual(referenceDraws(88675123, 256));
  });

  test('the w-mix uses logical shifts, diverging from upstream Randomizer', () => {
    // Upstream (utility/Random.js) writes `w >> 19` and `t >> 8` — arithmetic
    // shifts, which sign-extend and yield a different generator entirely. Ours
    // uses `>>>`, the canonical unsigned form. This pins that choice so nobody
    // "restores upstream fidelity" and silently invalidates every recorded run.
    const arithmeticShift = (seed: number, count: number): number[] => {
      let x = 123456789;
      let y = 362436069;
      let z = 521288629;
      let w = seed | 0;
      return Array.from({ length: count }, () => {
        const t = x ^ (x << 11);
        x = y;
        y = z;
        z = w;
        w = (w ^ (w >> 19)) ^ (t ^ (t >> 8));
        return w >>> 0;
      });
    };
    const r = new Random(42);

    expect(draw(6, () => r.next())).not.toEqual(arithmeticShift(42, 6));
  });

  test('reseeding fully resets an advanced generator', () => {
    const r = new Random(99);
    const first = draw(10, () => r.next());
    for (let i = 0; i < 500; i++) r.next();

    r.seed(99);
    expect(draw(10, () => r.next())).toEqual(first);
  });

  test('the constructor seed and an explicit seed() agree', () => {
    const constructed = new Random(2024);
    const seeded = new Random();
    seeded.seed(2024);

    expect(draw(16, () => constructed.next())).toEqual(draw(16, () => seeded.next()));
  });

  test('seeds are coerced to int32, so fractional seeds collapse', () => {
    const whole = new Random(5);
    const fractional = new Random(5.999);

    expect(draw(8, () => whole.next())).toEqual(draw(8, () => fractional.next()));
  });

  test('seeds wrap at 2^32', () => {
    const low = new Random(3);
    const wrapped = new Random(2 ** 32 + 3);

    expect(draw(8, () => low.next())).toEqual(draw(8, () => wrapped.next()));
  });

  test('a zero seed still produces a live sequence', () => {
    const r = new Random(0);
    const seq = draw(16, () => r.next());

    expect(new Set(seq).size).toBeGreaterThan(1);
    expect(seq.every((v) => Number.isInteger(v))).toBe(true);
  });

  test('negative seeds are valid and distinct from their positives', () => {
    const negative = new Random(-1);
    const positive = new Random(1);

    expect(draw(8, () => negative.next())).not.toEqual(draw(8, () => positive.next()));
  });

  test('call order is part of the contract', () => {
    const inOrder = new Random(31);
    const reordered = new Random(31);

    const a = { int: inOrder.int(0, 999), angle: inOrder.angle() };
    const b = { angle: reordered.angle(), int: reordered.int(0, 999) };

    expect(a.int).not.toBe(b.int);
  });
});

describe('state snapshots', () => {
  test('getState/setState round-trips and resumes the same sequence', () => {
    const r = new Random(555);
    for (let i = 0; i < 37; i++) r.next();

    const checkpoint = r.getState();
    const expected = draw(24, () => r.random());

    r.setState(checkpoint);
    expect(draw(24, () => r.random())).toEqual(expected);
  });

  test('a snapshot transplants onto a different instance', () => {
    const source = new Random(8);
    for (let i = 0; i < 11; i++) source.next();
    const target = new Random(999999);

    target.setState(source.getState());

    expect(draw(20, () => target.next())).toEqual(draw(20, () => source.next()));
  });

  test('a snapshot is a copy, unaffected by later draws', () => {
    const r = new Random(4);
    const snapshot = r.getState();
    for (let i = 0; i < 100; i++) r.next();

    expect(snapshot).toEqual([123456789, 362436069, 521288629, 4]);
  });

  test('each getState call returns a fresh array', () => {
    const r = new Random(4);

    expect(r.getState()).not.toBe(r.getState());
  });

  test('state survives an unsigned round-trip through serialisation', () => {
    // getState() hands back signed int32s, but a checkpoint that went through
    // a `>>> 0` on the way to disk comes back unsigned. Both must resume the
    // identical stream, or replays break on the sign of one saved word.
    const source = new Random(0x9e3779b9);
    for (let i = 0; i < 13; i++) source.next();
    const signed = source.getState();
    const unsigned = signed.map((v) => v >>> 0) as unknown as readonly [
      number,
      number,
      number,
      number,
    ];

    expect(unsigned).not.toEqual(signed);

    const a = new Random();
    const b = new Random();
    a.setState(signed);
    b.setState(unsigned);

    expect(draw(32, () => b.next())).toEqual(draw(32, () => a.next()));
  });

  test('setState is not aliased to the caller array', () => {
    const r = new Random(4);
    const mutable: [number, number, number, number] = [1, 2, 3, 4];
    r.setState(mutable);
    const expected = draw(8, () => r.next());

    r.setState(mutable);
    mutable[3] = 999;

    expect(draw(8, () => r.next())).toEqual(expected);
  });

  test('replaying from a mid-run checkpoint matches the original run', () => {
    const original = new Random(2718);
    const prefix = draw(50, () => original.random());
    const checkpoint = original.getState();
    const suffix = draw(50, () => original.random());

    const resumed = new Random(2718);
    expect(draw(50, () => resumed.random())).toEqual(prefix);
    resumed.setState(checkpoint);
    expect(draw(50, () => resumed.random())).toEqual(suffix);
  });
});

describe('next()', () => {
  test('every draw is an unsigned 32-bit integer', () => {
    const r = new Random(0x5eed);

    for (let i = 0; i < 100_000; i++) {
      const v = r.next();
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(0x100000000);
    }
  });

  test('draws populate the full 32-bit width, not just the low bits', () => {
    const r = new Random(11);
    let orAll = 0;

    for (let i = 0; i < 1000; i++) orAll |= r.next() | 0;

    expect(orAll >>> 0).toBe(0xffffffff);
  });
});

describe('random()', () => {
  // Upstream returned `(signedW % 0x7fffffff) / 0x7fffffff`, which yields
  // (-1, 1). A negative draw pushes randomized parameters below their declared
  // minimum. This port exists to fix that; these tests keep it fixed.
  test('never returns a negative value', () => {
    for (const seed of [0, 1, -1, 42, 0x7fffffff, -0x80000000, 0x9e3779b9]) {
      const r = new Random(seed);
      for (let i = 0; i < 50_000; i++) {
        expect(r.random()).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('stays strictly below 1', () => {
    const r = new Random(0xbadbeef);

    for (let i = 0; i < 200_000; i++) {
      expect(r.random()).toBeLessThan(1);
    }
  });

  test('matches a frozen golden float sequence', () => {
    // Literal expected values, not `next() / 0x100000000` recomputed by the
    // test. These pin the divisor itself: scaling by 0x7fffffff (as upstream
    // did) or by 2^31 changes every number here.
    const r = new Random(42);

    expect(draw(4, () => r.random())).toEqual([
      0.8512319535948336, 0.11755406833253801, 0.563863402698189, 0.5638442884664983,
    ]);
  });

  test('is exactly the unsigned draw scaled by 2^32', () => {
    const r = new Random(77);

    for (let i = 0; i < 1000; i++) {
      const before = r.getState();
      const raw = r.next();
      r.setState(before);
      expect(r.random()).toBe(raw / 0x100000000);
      expect(r.random()).toBeLessThan(1);
    }
  });

  test('a maximal raw draw still lands below 1', () => {
    // Construct the state whose next draw is 0xffffffff, so the exclusive
    // upper bound is exercised at the only point where it can fail.
    // w ^ (w >>> 19) is self-inverse: the top 19 bits pass through untouched,
    // so applying it twice recovers w.
    const r = new Random();
    const t = 123456789 ^ (123456789 << 11);
    const mix = t ^ (t >>> 8);
    const u = ~mix >>> 0;
    const w = u ^ (u >>> 19);
    r.setState([123456789, 362436069, 521288629, w | 0]);

    const state = r.getState();
    expect(r.next()).toBe(0xffffffff);
    r.setState(state);
    const value = r.random();
    expect(value).toBeLessThan(1);
    expect(value).toBeGreaterThan(0.9999999);
  });

  test('spreads across the unit interval', () => {
    const r = new Random(123);
    const buckets = new Array<number>(10).fill(0);

    for (let i = 0; i < 100_000; i++) {
      const bucket = Math.floor(r.random() * 10);
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }

    for (const count of buckets) {
      expect(count).toBeGreaterThan(9000);
      expect(count).toBeLessThan(11000);
    }
  });
});

describe('int()', () => {
  test('stays within [min, max] inclusive', () => {
    const r = new Random(313);

    for (let i = 0; i < 100_000; i++) {
      const v = r.int(-3, 7);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThanOrEqual(7);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  test('reaches both endpoints', () => {
    const r = new Random(9);
    const seen = new Set<number>();

    for (let i = 0; i < 5000; i++) seen.add(r.int(0, 5));

    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test('min === max collapses to that value without consuming a draw', () => {
    const r = new Random(17);
    const control = new Random(17);

    expect(r.int(4, 4)).toBe(4);
    expect(r.next()).toBe(control.next());
  });

  test('an inverted range collapses to min', () => {
    const r = new Random(17);

    expect(r.int(10, 2)).toBe(10);
  });

  test('a two-value range yields both outcomes', () => {
    const r = new Random(21);
    const seen = new Set(Array.from({ length: 200 }, () => r.int(0, 1)));

    expect(seen).toEqual(new Set([0, 1]));
  });

  test('negative-only ranges stay negative', () => {
    const r = new Random(64);

    for (let i = 0; i < 10_000; i++) {
      const v = r.int(-20, -10);
      expect(v).toBeGreaterThanOrEqual(-20);
      expect(v).toBeLessThanOrEqual(-10);
    }
  });

  test('an inverted range consumes no draw either', () => {
    const r = new Random(17);
    const control = new Random(17);

    r.int(10, 2);
    expect(r.next()).toBe(control.next());
  });

  test('every value in the range is equally likely', () => {
    // A `Math.round`-based implementation would still reach both endpoints —
    // the endpoint test above passes — but would hand them half the weight of
    // the interior. Only a distribution check catches that.
    const r = new Random(1861);
    const counts = new Map<number, number>();
    const draws = 140_000;

    for (let i = 0; i < draws; i++) {
      const v = r.int(0, 6);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }

    expect(counts.size).toBe(7);
    const expectedShare = draws / 7;
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(expectedShare * 0.95);
      expect(count).toBeLessThan(expectedShare * 1.05);
    }
  });
});

describe('draw consumption', () => {
  // Whether a call advances the stream is part of the replay contract: a method
  // that consumes a draw only for some arguments makes the RNG sequence depend
  // on content values, so retuning a pattern silently reshuffles everything
  // drawn after it. These pin the current, deliberately uneven, behaviour.
  const consumed = (act: (r: Random) => void): number => {
    const r = new Random(4242);
    act(r);
    const target = r.getState().join(',');

    const control = new Random(4242);
    for (let i = 0; i <= 8; i++) {
      if (control.getState().join(',') === target) return i;
      control.next();
    }
    throw new Error('generator advanced more than 8 draws');
  };

  test('int consumes one draw for a real range and none for a collapsed one', () => {
    expect(consumed((r) => r.int(0, 10))).toBe(1);
    expect(consumed((r) => r.int(4, 4))).toBe(0);
    expect(consumed((r) => r.int(10, 2))).toBe(0);
  });

  test('range always consumes a draw, even when min === max', () => {
    // Deliberately unlike int(): range() has no early return, so a collapsed
    // range still advances the stream.
    expect(consumed((r) => r.range(0, 10))).toBe(1);
    expect(consumed((r) => r.range(3, 3))).toBe(1);
  });

  test('angle consumes exactly one draw', () => {
    expect(consumed((r) => r.angle())).toBe(1);
  });

  test('pick consumes one draw unless the array is empty', () => {
    expect(consumed((r) => r.pick([1, 2, 3]))).toBe(1);
    expect(consumed((r) => r.pick(['solo']))).toBe(1);
    expect(consumed((r) => r.pick([]))).toBe(0);
  });

  test('getState does not advance the stream', () => {
    expect(consumed((r) => r.getState())).toBe(0);
  });
});

describe('range()', () => {
  test('stays within [min, max)', () => {
    const r = new Random(404);

    for (let i = 0; i < 100_000; i++) {
      const v = r.range(2, 5);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThan(5);
    }
  });

  test('spans ranges that cross zero without leaving them', () => {
    const r = new Random(505);

    for (let i = 0; i < 100_000; i++) {
      const v = r.range(-1.5, 1.5);
      expect(v).toBeGreaterThanOrEqual(-1.5);
      expect(v).toBeLessThan(1.5);
    }
  });

  test('min === max is a constant', () => {
    const r = new Random(606);

    for (let i = 0; i < 100; i++) expect(r.range(3, 3)).toBe(3);
  });

  test('reaches near both ends of the interval', () => {
    const r = new Random(707);
    let min = Infinity;
    let max = -Infinity;

    for (let i = 0; i < 100_000; i++) {
      const v = r.range(0, 10);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }

    expect(min).toBeLessThan(0.01);
    expect(max).toBeGreaterThan(9.99);
  });
});

describe('angle()', () => {
  test('stays within [0, 360)', () => {
    const r = new Random(808);

    for (let i = 0; i < 100_000; i++) {
      const a = r.angle();
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(360);
    }
  });

  test('covers every quadrant', () => {
    const r = new Random(909);
    const quadrants = new Set<number>();

    for (let i = 0; i < 1000; i++) quadrants.add(Math.floor(r.angle() / 90));

    expect(quadrants).toEqual(new Set([0, 1, 2, 3]));
  });
});

describe('pick()', () => {
  test('an empty array yields undefined', () => {
    expect(new Random(1).pick([])).toBeUndefined();
  });

  test('an empty array still consumes no draw', () => {
    const r = new Random(1);
    const control = new Random(1);

    r.pick([]);
    expect(r.next()).toBe(control.next());
  });

  test('a single-element array always yields that element', () => {
    const r = new Random(2);

    for (let i = 0; i < 100; i++) expect(r.pick(['only'])).toBe('only');
  });

  test('only ever returns members of the array', () => {
    const items: string[] = ['a', 'b', 'c', 'd'];
    const r = new Random(3);

    for (let i = 0; i < 10_000; i++) {
      const picked = r.pick(items);
      expect(picked).toBeDefined();
      expect(items).toContain(picked as string);
    }
  });

  test('every index is reachable', () => {
    const items = [0, 1, 2, 3, 4, 5, 6, 7];
    const r = new Random(4);
    const seen = new Set(Array.from({ length: 5000 }, () => r.pick(items)));

    expect(seen.size).toBe(items.length);
  });

  test('never runs off the end of the array', () => {
    const items = [10, 20];
    const r = new Random(5);

    for (let i = 0; i < 100_000; i++) expect(r.pick(items)).toBeDefined();
  });
});

describe('streams', () => {
  test('sim and fx are distinct generators', () => {
    expect(sim).not.toBe(fx);
  });

  test('drawing from fx never perturbs sim', () => {
    seedRun(1234);
    const expected = draw(50, () => sim.random());

    seedRun(1234);
    const interleaved: number[] = [];
    for (let i = 0; i < 50; i++) {
      for (let j = 0; j < 7; j++) fx.random();
      interleaved.push(sim.random());
    }

    expect(interleaved).toEqual(expected);
  });

  test('reseeding fx mid-run never perturbs sim', () => {
    seedRun(4321);
    const expected = draw(30, () => sim.random());

    seedRun(4321);
    const observed = Array.from({ length: 30 }, (_, i) => {
      fx.seed(i);
      fx.angle();
      return sim.random();
    });

    expect(observed).toEqual(expected);
  });

  test('seedRun resets sim without touching fx', () => {
    fx.seed(1);
    const fxBefore = fx.getState();

    seedRun(555);
    expect(sim.getState()).toEqual(new Random(555).getState());
    expect(fx.getState()).toEqual(fxBefore);
  });

  test('seedRun makes the sim stream replayable', () => {
    seedRun(2048);
    const first = draw(40, () => sim.random());

    seedRun(2048);
    expect(draw(40, () => sim.random())).toEqual(first);
  });

  test('fx starts pre-seeded and sim starts at the bare default', () => {
    // Asserted against the states captured at import time, before any test in
    // this file touched the singletons. Reseeding fx here and then inspecting
    // it would only confirm the reseed.
    expect(SIM_INITIAL_STATE).toEqual(new Random().getState());
    expect(FX_INITIAL_STATE).toEqual(new Random(0x9e3779b9).getState());
    expect(FX_INITIAL_STATE).not.toEqual(SIM_INITIAL_STATE);
  });

  test('the two streams share no sequence when a run starts unseeded', () => {
    sim.setState(SIM_INITIAL_STATE);
    fx.setState(FX_INITIAL_STATE);

    expect(draw(16, () => sim.next())).not.toEqual(draw(16, () => fx.next()));
  });

  test('two instances with the same seed advance independently', () => {
    const a = new Random(60);
    const b = new Random(60);

    a.next();
    a.next();

    expect(b.next()).not.toBe(a.next());
    expect(b.getState()).not.toEqual(a.getState());
  });
});

describe('unseedable randomness', () => {
  test('no method reaches for Math.random', () => {
    // CLAUDE.md rule 2. Math.random cannot be seeded, so a single call anywhere
    // in here would make every replay worthless while every other test in this
    // file still passed — the sequence would stay self-consistent within a run.
    const real = Math.random;
    Math.random = () => {
      throw new Error('Random called Math.random');
    };

    try {
      const r = new Random(1);
      r.next();
      r.random();
      r.int(0, 10);
      r.int(4, 4);
      r.range(-1, 1);
      r.angle();
      r.pick([1, 2, 3]);
      r.pick([]);
      r.seed(2);
      r.setState(r.getState());
      new Random();
      new Random(3);

      expect(r.next()).toBe(new Random(2).next());
    } finally {
      Math.random = real;
    }
  });
});
