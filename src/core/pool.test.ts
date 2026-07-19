import { describe, expect, test } from 'bun:test';
import { Pool, type PoolOptions } from './pool';
import { Random } from './random';

interface Cell {
  /** Serial number assigned at construction — identifies a physical object. */
  readonly id: number;
  /** Mutated by callers; `reset` is expected to clear it. */
  dirty: number;
}

/**
 * A pool plus a record of how many objects it actually constructed. Reuse is
 * only observable by counting allocations, so every test that cares about
 * pooling (rather than accounting) reads `created`.
 */
function harness(options: Partial<PoolOptions<Cell>> & { initial: number }) {
  let created = 0;
  const resetLog: Cell[] = [];
  const pool = new Pool<Cell>(() => ({ id: created++, dirty: 0 }), {
    reset: (c) => {
      c.dirty = 0;
      resetLog.push(c);
    },
    ...options,
  });
  return {
    pool,
    resetLog,
    get created() {
      return created;
    },
  };
}

/** Acquire `n` objects, asserting none were refused. */
function take<T>(pool: Pool<T>, n: number): T[] {
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    const item = pool.acquire();
    expect(item).toBeDefined();
    out.push(item as T);
  }
  return out;
}

describe('construction', () => {
  test('allocates `initial` objects up front', () => {
    const h = harness({ initial: 12 });
    expect(h.created).toBe(12);
    expect(h.pool.size).toBe(12);
    expect(h.pool.available).toBe(12);
    expect(h.pool.live).toBe(0);
  });

  test('does not reset objects at construction — only when handed out', () => {
    const h = harness({ initial: 4 });
    expect(h.resetLog).toHaveLength(0);
  });

  test('starts with clean telemetry', () => {
    const h = harness({ initial: 4 });
    expect(h.pool.growthCount).toBe(0);
    expect(h.pool.peakLive).toBe(0);
  });

  test('clamps `initial` to `max`', () => {
    const h = harness({ initial: 50, max: 10 });
    expect(h.created).toBe(10);
    expect(h.pool.size).toBe(10);
  });
});

describe('acquire and release', () => {
  test('hands out distinct objects while free ones remain', () => {
    const h = harness({ initial: 5 });
    const ids = new Set(take(h.pool, 5).map((c) => c.id));
    expect(ids.size).toBe(5);
    expect(h.created).toBe(5);
  });

  test('reuses a released object instead of allocating', () => {
    const h = harness({ initial: 3 });
    const all = take(h.pool, 3);
    for (const c of all) h.pool.release(c);

    take(h.pool, 3);
    expect(h.created).toBe(3);
    expect(h.pool.size).toBe(3);
    expect(h.pool.growthCount).toBe(0);
  });

  test('release/acquire returns the most recently released object', () => {
    const h = harness({ initial: 4 });
    const [a, b] = take(h.pool, 2) as [Cell, Cell];
    h.pool.release(a);
    h.pool.release(b);
    expect(h.pool.acquire()).toBe(b);
    expect(h.pool.acquire()).toBe(a);
  });

  test('a long cycle of one-at-a-time use never allocates twice', () => {
    const h = harness({ initial: 1 });
    for (let i = 0; i < 1000; i++) {
      const c = h.pool.acquire();
      expect(c).toBeDefined();
      h.pool.release(c as Cell);
    }
    expect(h.created).toBe(1);
    expect(h.pool.peakLive).toBe(1);
  });
});

describe('reset callback', () => {
  test('runs on every acquire, including the first use of a fresh object', () => {
    const h = harness({ initial: 2 });
    const a = h.pool.acquire();
    expect(h.resetLog).toEqual([a as Cell]);
  });

  test('receives the object that acquire returns', () => {
    const h = harness({ initial: 2 });
    const first = h.pool.acquire();
    const second = h.pool.acquire();
    expect(h.resetLog).toEqual([first as Cell, second as Cell]);
  });

  test('clears state carried over from previous use', () => {
    const h = harness({ initial: 1 });
    const a = h.pool.acquire() as Cell;
    a.dirty = 99;
    h.pool.release(a);

    const again = h.pool.acquire() as Cell;
    expect(again).toBe(a);
    expect(again.dirty).toBe(0);
  });

  test('does not run on release', () => {
    const h = harness({ initial: 2 });
    const a = h.pool.acquire() as Cell;
    h.resetLog.length = 0;
    h.pool.release(a);
    expect(h.resetLog).toHaveLength(0);
  });

  test('runs on objects created by growth, not just the initial batch', () => {
    const h = harness({ initial: 1, growBy: 1 });
    const a = h.pool.acquire() as Cell;
    const b = h.pool.acquire() as Cell;
    expect(b.id).not.toBe(a.id);
    expect(h.resetLog).toEqual([a, b]);
  });

  test('a pool without a reset callback still acquires', () => {
    const pool = new Pool<Cell>(() => ({ id: 0, dirty: 7 }), { initial: 1 });
    const a = pool.acquire();
    expect(a).toBeDefined();
    expect((a as Cell).dirty).toBe(7);
  });
});

describe('growth', () => {
  test('grows past `initial` rather than refusing — upstream crashed here', () => {
    const h = harness({ initial: 2 });
    const items = take(h.pool, 10);
    expect(new Set(items.map((c) => c.id)).size).toBe(10);
    expect(h.pool.size).toBe(10);
  });

  test('records growth in growthCount', () => {
    const h = harness({ initial: 2, growBy: 2 });
    take(h.pool, 2);
    expect(h.pool.growthCount).toBe(0);

    h.pool.acquire();
    expect(h.pool.growthCount).toBe(1);
  });

  test('counts one growth per block, not one per acquire', () => {
    const h = harness({ initial: 1, growBy: 10 });
    take(h.pool, 11);
    expect(h.pool.growthCount).toBe(1);
    expect(h.pool.size).toBe(11);

    take(h.pool, 1);
    expect(h.pool.growthCount).toBe(2);
    expect(h.pool.size).toBe(21);
  });

  test('honours an explicit growBy', () => {
    const h = harness({ initial: 4, growBy: 7 });
    take(h.pool, 5);
    expect(h.pool.size).toBe(11);
    expect(h.created).toBe(11);
  });

  test('defaults growth to half the current size', () => {
    const h = harness({ initial: 40 });
    take(h.pool, 41);
    expect(h.pool.size).toBe(60);
  });

  test('default growth has a floor of 8 for small pools', () => {
    const h = harness({ initial: 2 });
    take(h.pool, 3);
    expect(h.pool.size).toBe(10);
  });

  test('an empty pool grows on first acquire', () => {
    const h = harness({ initial: 0 });
    expect(h.created).toBe(0);
    expect(h.pool.acquire()).toBeDefined();
    expect(h.pool.growthCount).toBe(1);
    expect(h.pool.size).toBe(8);
  });

  test('growth leaves the surplus available rather than live', () => {
    const h = harness({ initial: 1, growBy: 5 });
    take(h.pool, 2);
    expect(h.pool.size).toBe(6);
    expect(h.pool.live).toBe(2);
    expect(h.pool.available).toBe(4);
  });

  test('default blocks compound — each is half the size at that moment', () => {
    const h = harness({ initial: 100 });
    take(h.pool, 101);
    expect(h.pool.size).toBe(150);

    take(h.pool, 50);
    expect(h.pool.size).toBe(225);

    take(h.pool, 75);
    expect(h.pool.size).toBe(337);
    expect(h.pool.growthCount).toBe(3);
  });

  test('the floor of 8 wins only while half the size is below it', () => {
    // 15 >> 1 is 7, so the floor applies; 20 >> 1 is 10, so it does not.
    for (const [initial, grown] of [
      [15, 23],
      [16, 24],
      [17, 25],
      [20, 30],
    ] as const) {
      const h = harness({ initial });
      take(h.pool, initial + 1);
      expect(h.pool.size).toBe(grown);
    }
  });

  test('an explicit growBy of 0 pins the pool at its initial size', () => {
    // `growBy ?? default` must not collapse to `growBy || default`, which would
    // silently turn a deliberately fixed-size pool into a growing one.
    const h = harness({ initial: 4, growBy: 0 });
    take(h.pool, 4);

    expect(h.pool.acquire()).toBeUndefined();
    expect(h.pool.size).toBe(4);
    expect(h.created).toBe(4);
    expect(h.pool.growthCount).toBe(0);
  });
});

describe('malformed options', () => {
  // `initial` and `max` reach the pool straight from BulletSystemOptions with
  // no validation, so a bad tuning value must degrade to an empty pool rather
  // than drive the size counters negative.
  test('a negative `initial` yields an empty pool, not a negative size', () => {
    const h = harness({ initial: -5 });
    expect(h.pool.size).toBe(0);
    expect(h.pool.live).toBe(0);
    expect(h.pool.available).toBe(0);
    expect(h.created).toBe(0);
  });

  test('a negative `max` refuses everything without corrupting size', () => {
    const h = harness({ initial: 4, max: -2 });
    expect(h.pool.size).toBe(0);
    expect(h.pool.acquire()).toBeUndefined();
    expect(h.pool.live).toBe(0);
    expect(h.pool.growthCount).toBe(0);
  });

  test('a negative `growBy` refuses without shrinking the pool', () => {
    const h = harness({ initial: 2, growBy: -3 });
    const held = take(h.pool, 2);

    expect(h.pool.acquire()).toBeUndefined();
    expect(h.pool.size).toBe(2);
    expect(h.pool.live).toBe(2);
    // A block that allocated nothing is not growth, however it was refused.
    expect(h.pool.growthCount).toBe(0);

    h.pool.release(held[0] as Cell);
    expect(h.pool.acquire()).toBe(held[0] as Cell);
  });
});

describe('max ceiling', () => {
  test('returns undefined instead of growing past max', () => {
    const h = harness({ initial: 2, max: 4, growBy: 2 });
    take(h.pool, 4);
    expect(h.pool.acquire()).toBeUndefined();
    expect(h.pool.size).toBe(4);
    expect(h.created).toBe(4);
  });

  test('a refused acquire does not count as growth', () => {
    const h = harness({ initial: 2, max: 2 });
    take(h.pool, 2);
    h.pool.acquire();
    h.pool.acquire();
    expect(h.pool.growthCount).toBe(0);
  });

  test('a refused acquire does not run reset', () => {
    const h = harness({ initial: 1, max: 1 });
    take(h.pool, 1);
    h.resetLog.length = 0;
    expect(h.pool.acquire()).toBeUndefined();
    expect(h.resetLog).toHaveLength(0);
  });

  test('clamps a growth block that would overshoot max', () => {
    const h = harness({ initial: 10, max: 12, growBy: 5 });
    take(h.pool, 11);
    expect(h.pool.size).toBe(12);
    expect(h.pool.growthCount).toBe(1);

    take(h.pool, 1);
    expect(h.pool.acquire()).toBeUndefined();
    expect(h.pool.size).toBe(12);
    expect(h.pool.growthCount).toBe(1);
  });

  test('a max of 0 refuses every acquire', () => {
    const h = harness({ initial: 4, max: 0 });
    expect(h.created).toBe(0);
    expect(h.pool.size).toBe(0);
    expect(h.pool.acquire()).toBeUndefined();
    expect(h.pool.growthCount).toBe(0);
  });

  test('releasing at the ceiling makes the pool usable again', () => {
    const h = harness({ initial: 2, max: 2 });
    const [a] = take(h.pool, 2) as [Cell, Cell];
    expect(h.pool.acquire()).toBeUndefined();

    h.pool.release(a);
    expect(h.pool.acquire()).toBe(a);
    expect(h.created).toBe(2);
  });

  test('refusal is repeatable — the pool is not left in a broken state', () => {
    const h = harness({ initial: 1, max: 1 });
    const [a] = take(h.pool, 1) as [Cell];
    for (let i = 0; i < 5; i++) expect(h.pool.acquire()).toBeUndefined();

    expect(h.pool.size).toBe(1);
    expect(h.pool.live).toBe(1);
    expect(h.pool.available).toBe(0);

    h.pool.release(a);
    expect(h.pool.acquire()).toBe(a);
  });

  test('an unbounded pool grows well past any fixed upstream ceiling', () => {
    const h = harness({ initial: 8 });
    const items = take(h.pool, 2500);
    expect(new Set(items).size).toBe(2500);
    expect(h.pool.live).toBe(2500);
  });
});

describe('accounting', () => {
  test('size, live and available stay consistent through a mixed sequence', () => {
    const h = harness({ initial: 4, growBy: 4 });

    const a = take(h.pool, 3);
    expect([h.pool.size, h.pool.live, h.pool.available]).toEqual([4, 3, 1]);

    h.pool.release(a[0] as Cell);
    h.pool.release(a[1] as Cell);
    expect([h.pool.size, h.pool.live, h.pool.available]).toEqual([4, 1, 3]);

    take(h.pool, 5);
    expect([h.pool.size, h.pool.live, h.pool.available]).toEqual([8, 6, 2]);
  });

  test('every counter tracks the objects actually constructed', () => {
    const rng = new Random(0xc0ffee);
    const h = harness({ initial: 6, growBy: 3, max: 40 });
    const held: Cell[] = [];
    let acquired = 0;

    for (let i = 0; i < 2000; i++) {
      if (held.length > 0 && rng.random() < 0.45) {
        const index = rng.int(0, held.length - 1);
        const [item] = held.splice(index, 1);
        h.pool.release(item as Cell);
      } else {
        const item = h.pool.acquire();
        if (item !== undefined) {
          held.push(item);
          acquired++;
        }
      }

      // `size === live + available` is true by construction whatever the pool
      // does, so it proves nothing. Anchor each counter to the constructor
      // call count and the objects the test itself is holding instead.
      expect(h.pool.size).toBe(h.created);
      expect(h.pool.live).toBe(held.length);
      expect(h.pool.available).toBe(h.created - held.length);
      expect(h.pool.size).toBeLessThanOrEqual(40);
    }

    expect(h.resetLog).toHaveLength(acquired);
  });

  test('never hands the same object out twice while it is live', () => {
    const rng = new Random(7);
    const h = harness({ initial: 3, growBy: 2, max: 20 });
    const held = new Set<Cell>();

    for (let i = 0; i < 1500; i++) {
      if (held.size > 0 && rng.random() < 0.5) {
        const victim = held.values().next().value as Cell;
        held.delete(victim);
        h.pool.release(victim);
      } else {
        const item = h.pool.acquire();
        if (item !== undefined) {
          expect(held.has(item)).toBe(false);
          held.add(item);
        }
      }
    }
    expect(h.pool.live).toBe(held.size);
  });

  test('allocation count never exceeds size', () => {
    const h = harness({ initial: 5, growBy: 5 });
    take(h.pool, 23);
    expect(h.created).toBe(h.pool.size);
  });
});

describe('peakLive', () => {
  test('tracks the high-water mark, not the current live count', () => {
    const h = harness({ initial: 10 });
    const items = take(h.pool, 7);
    expect(h.pool.peakLive).toBe(7);

    for (const c of items) h.pool.release(c);
    expect(h.pool.live).toBe(0);
    expect(h.pool.peakLive).toBe(7);
  });

  test('only rises when a later burst exceeds the previous peak', () => {
    const h = harness({ initial: 10 });
    const first = take(h.pool, 6);
    for (const c of first) h.pool.release(c);

    take(h.pool, 4);
    expect(h.pool.peakLive).toBe(6);

    take(h.pool, 3);
    expect(h.pool.peakLive).toBe(7);
  });

  test('counts objects created by growth', () => {
    const h = harness({ initial: 2, growBy: 3 });
    take(h.pool, 9);
    expect(h.pool.peakLive).toBe(9);
  });

  test('does not count a refused acquire', () => {
    const h = harness({ initial: 3, max: 3 });
    take(h.pool, 3);
    h.pool.acquire();
    expect(h.pool.peakLive).toBe(3);
  });

  test('stays at zero for a pool that is never acquired from', () => {
    const h = harness({ initial: 5 });
    expect(h.pool.peakLive).toBe(0);
  });

  test('matches the true maximum over a mixed sequence', () => {
    const rng = new Random(0x5eed);
    const h = harness({ initial: 4, growBy: 4, max: 30 });
    const held: Cell[] = [];
    let expectedPeak = 0;

    for (let i = 0; i < 1200; i++) {
      if (held.length > 0 && rng.random() < 0.4) {
        h.pool.release(held.pop() as Cell);
      } else {
        const item = h.pool.acquire();
        if (item !== undefined) held.push(item);
      }
      if (held.length > expectedPeak) expectedPeak = held.length;
    }

    expect(h.pool.peakLive).toBe(expectedPeak);
    expect(expectedPeak).toBe(30);
  });
});

describe('determinism', () => {
  test('two pools driven by the same sequence agree on every counter', () => {
    const run = () => {
      const rng = new Random(0xabcdef);
      const h = harness({ initial: 3, growBy: 4, max: 25 });
      const held: Cell[] = [];
      let refused = 0;

      for (let i = 0; i < 900; i++) {
        if (held.length > 0 && rng.random() < 0.42) {
          h.pool.release(held.pop() as Cell);
        } else {
          const item = h.pool.acquire();
          if (item === undefined) refused++;
          else held.push(item);
        }
      }
      return {
        size: h.pool.size,
        live: h.pool.live,
        available: h.pool.available,
        growthCount: h.pool.growthCount,
        peakLive: h.pool.peakLive,
        created: h.created,
        refused,
      };
    };

    const first = run();
    expect(run()).toEqual(first);

    // Agreement alone is satisfied by a pool that refuses every acquire, so
    // pin the run to its actual outcome: the ceiling is reached, spawns are
    // dropped there, and no object is constructed twice.
    expect(first).toEqual({
      size: 25,
      live: 22,
      available: 3,
      growthCount: 6,
      peakLive: 25,
      created: 25,
      refused: 138,
    });
  });
});
