import { describe, expect, test } from 'bun:test';
import { Random } from '../core/random';
import type { Box } from './collision';
import { circlesOverlap, overlaps, SpatialGrid } from './collision';

function box(x: number, y: number, halfW: number, halfH: number): Box {
  return { x, y, halfW, halfH };
}

/**
 * Independent reference: 1-D interval overlap on each axis, written from the
 * edges rather than the centres so it cannot share a mistake with the
 * implementation's centre-distance form.
 */
function referenceOverlaps(a: Box, b: Box): boolean {
  const axLo = a.x - a.halfW;
  const axHi = a.x + a.halfW;
  const bxLo = b.x - b.halfW;
  const bxHi = b.x + b.halfW;
  const ayLo = a.y - a.halfH;
  const ayHi = a.y + a.halfH;
  const byLo = b.y - b.halfH;
  const byHi = b.y + b.halfH;
  return axLo <= bxHi && bxLo <= axHi && ayLo <= byHi && byLo <= ayHi;
}

/** Deterministic box cloud — no Math.random anywhere, including in tests. */
function randomBox(rng: Random): Box {
  return box(rng.range(-200, 200), rng.range(-200, 200), rng.range(0, 40), rng.range(0, 40));
}

describe('overlaps', () => {
  test('boxes clear of each other on x do not overlap', () => {
    expect(overlaps(box(0, 0, 5, 5), box(20, 0, 5, 5))).toBe(false);
  });

  test('boxes clear of each other on y do not overlap', () => {
    expect(overlaps(box(0, 0, 5, 5), box(0, -20, 5, 5))).toBe(false);
  });

  test('overlap on only one axis is not an overlap', () => {
    // Same x span, disjoint y span: a naive OR would call this a hit.
    expect(overlaps(box(0, 0, 10, 2), box(0, 40, 10, 2))).toBe(false);
  });

  test('partially interpenetrating boxes overlap', () => {
    expect(overlaps(box(0, 0, 10, 10), box(15, 15, 10, 10))).toBe(true);
  });

  test('edges that exactly touch count as an overlap', () => {
    // Right edge of a is at x=10; left edge of b is at x=10.
    expect(overlaps(box(0, 0, 10, 10), box(20, 0, 10, 10))).toBe(true);
  });

  test('corners that exactly touch count as an overlap', () => {
    expect(overlaps(box(0, 0, 10, 10), box(20, 20, 10, 10))).toBe(true);
  });

  test('one unit past touching is a miss', () => {
    expect(overlaps(box(0, 0, 10, 10), box(21, 0, 10, 10))).toBe(false);
    expect(overlaps(box(0, 0, 10, 10), box(0, 21, 10, 10))).toBe(false);
  });

  test('identical boxes overlap', () => {
    const a = box(37, -12, 3, 9);
    expect(overlaps(a, { ...a })).toBe(true);
  });

  test('a box fully containing another overlaps, argument order irrelevant', () => {
    const small = box(100, 100, 2, 2);
    const large = box(100, 100, 200, 60);
    expect(overlaps(small, large)).toBe(true);
    expect(overlaps(large, small)).toBe(true);
  });

  // The exact shape upstream's five-point test got wrong: a wide laser sweeps
  // over a tiny hitbox. None of the laser's corners and not its centre fall
  // inside the hitbox, so point-containment reports no hit — the player walks
  // through the beam untouched.
  test('a wide laser fully covering a small hitbox is a hit (the containment bug)', () => {
    const hitbox = box(100, 100, 2, 2);
    const laser = box(220, 100, 200, 8);

    expect(overlaps(hitbox, laser)).toBe(true);
    expect(overlaps(laser, hitbox)).toBe(true);
    // Neither of the laser's own reference points is inside the hitbox, which
    // is precisely why the old test missed it.
    expect(overlaps(box(laser.x, laser.y, 0, 0), hitbox)).toBe(false);
    expect(overlaps(box(laser.x - laser.halfW, laser.y - laser.halfH, 0, 0), hitbox)).toBe(false);
  });

  test('a zero-extent box inside a larger box overlaps both ways round', () => {
    const point = box(5, 5, 0, 0);
    const area = box(0, 0, 10, 10);
    expect(overlaps(point, area)).toBe(true);
    expect(overlaps(area, point)).toBe(true);
  });

  test('two zero-extent boxes overlap only when coincident', () => {
    expect(overlaps(box(5, 5, 0, 0), box(5, 5, 0, 0))).toBe(true);
    expect(overlaps(box(5, 5, 0, 0), box(5, 6, 0, 0))).toBe(false);
  });

  test('negative coordinates behave like any other', () => {
    expect(overlaps(box(-100, -100, 10, 10), box(-85, -100, 10, 10))).toBe(true);
    expect(overlaps(box(-100, -100, 10, 10), box(-79, -100, 10, 10))).toBe(false);
  });

  test('overlap straddling the origin is detected', () => {
    expect(overlaps(box(-4, -4, 5, 5), box(4, 4, 5, 5))).toBe(true);
  });

  test('is symmetric for every seeded random pair', () => {
    const rng = new Random(0xc0ffee);
    for (let i = 0; i < 2000; i++) {
      const a = randomBox(rng);
      const b = randomBox(rng);
      expect(overlaps(a, b)).toBe(overlaps(b, a));
    }
  });

  test('is symmetric for pairs forced into containment', () => {
    const rng = new Random(7);
    for (let i = 0; i < 500; i++) {
      const outer = box(rng.range(-100, 100), rng.range(-100, 100), rng.range(50, 90), rng.range(50, 90));
      // Placed strictly inside `outer`, with room to spare on every side.
      const inner = box(
        outer.x + rng.range(-10, 10),
        outer.y + rng.range(-10, 10),
        rng.range(0, 5),
        rng.range(0, 5),
      );
      expect(overlaps(outer, inner)).toBe(true);
      expect(overlaps(inner, outer)).toBe(true);
    }
  });

  test('agrees with an edge-based reference implementation', () => {
    const rng = new Random(31337);
    for (let i = 0; i < 5000; i++) {
      const a = randomBox(rng);
      const b = randomBox(rng);
      expect(overlaps(a, b)).toBe(referenceOverlaps(a, b));
    }
  });
});

describe('circlesOverlap', () => {
  test('clearly separated circles miss', () => {
    expect(circlesOverlap(0, 0, 1, 10, 0, 1)).toBe(false);
  });

  test('clearly interpenetrating circles hit', () => {
    expect(circlesOverlap(0, 0, 5, 4, 0, 5)).toBe(true);
  });

  test('exact tangency on an axis counts as a hit', () => {
    // Centres 6 apart, radii summing to exactly 6.
    expect(circlesOverlap(0, 0, 2, 6, 0, 4)).toBe(true);
  });

  test('exact tangency on a diagonal counts as a hit', () => {
    // 3-4-5 triangle: distance 5, radii sum 5.
    expect(circlesOverlap(0, 0, 2, 3, 4, 3)).toBe(true);
  });

  test('a hair past tangency is a miss', () => {
    expect(circlesOverlap(0, 0, 2, 6, 0, 3.5)).toBe(false);
    expect(circlesOverlap(0, 0, 2, 3, 4, 2.5)).toBe(false);
  });

  // Guards the squared-distance form: comparing d² against an unsquared radius
  // sum would wrongly report a hit whenever the sum is below 1.
  test('compares squared distance against squared radius, not raw radius', () => {
    expect(circlesOverlap(0, 0, 0.2, 0, 0.5, 0.2)).toBe(false);
  });

  // ...and it must be a true euclidean distance, not a manhattan shortcut.
  test('uses euclidean distance, not the sum of the axis deltas', () => {
    // |dx| + |dy| = 7, which exceeds the radius sum of 5, but the real
    // distance is exactly 5.
    expect(circlesOverlap(0, 0, 0, 3, 4, 5)).toBe(true);
  });

  test('coincident centres always hit', () => {
    expect(circlesOverlap(12, -8, 1, 12, -8, 1)).toBe(true);
  });

  test('zero-radius circles hit only when coincident', () => {
    expect(circlesOverlap(3, 3, 0, 3, 3, 0)).toBe(true);
    expect(circlesOverlap(3, 3, 0, 3, 3.0001, 0)).toBe(false);
  });

  test('a point exactly on a circle boundary is a hit', () => {
    expect(circlesOverlap(0, 0, 7, 7, 0, 0)).toBe(true);
  });

  test('negative coordinates behave like any other', () => {
    expect(circlesOverlap(-50, -50, 3, -46, -47, 2)).toBe(true);
    expect(circlesOverlap(-50, -50, 3, -40, -50, 2)).toBe(false);
  });

  test('is symmetric for every seeded random pair', () => {
    const rng = new Random(0xbadc0de);
    for (let i = 0; i < 2000; i++) {
      const ax = rng.range(-300, 300);
      const ay = rng.range(-300, 300);
      const ar = rng.range(0, 30);
      const bx = rng.range(-300, 300);
      const by = rng.range(-300, 300);
      const br = rng.range(0, 30);
      expect(circlesOverlap(ax, ay, ar, bx, by, br)).toBe(circlesOverlap(bx, by, br, ax, ay, ar));
    }
  });

  test('agrees with a hypot-based reference implementation', () => {
    const rng = new Random(2024);
    for (let i = 0; i < 5000; i++) {
      const ax = rng.range(-300, 300);
      const ay = rng.range(-300, 300);
      const ar = rng.range(0, 30);
      const bx = rng.range(-300, 300);
      const by = rng.range(-300, 300);
      const br = rng.range(0, 30);
      const expected = Math.hypot(ax - bx, ay - by) <= ar + br;
      expect(circlesOverlap(ax, ay, ar, bx, by, br)).toBe(expected);
    }
  });
});

/** Collect everything a query visits, in visit order. */
function collect<T>(grid: SpatialGrid<T>, x: number, y: number, radius: number): T[] {
  const seen: T[] = [];
  grid.query(x, y, radius, (item) => seen.push(item));
  return seen;
}

describe('SpatialGrid', () => {
  const CELL = 32;
  /** Playfield width. The grid is unbounded; this only shapes the coordinates. */
  const FIELD = 320;

  test('an item is found by a zero-radius query at its own position', () => {
    const grid = new SpatialGrid<string>(CELL);
    grid.insert(10, 10, 'a');
    expect(collect(grid, 10, 10, 0)).toEqual(['a']);
  });

  test('items land in distinct cells rather than one shared bucket', () => {
    const grid = new SpatialGrid<string>(CELL);
    grid.insert(10, 10, 'cell-0-0');
    grid.insert(100, 10, 'cell-3-0');
    grid.insert(10, 100, 'cell-0-3');

    // A zero-radius query reaches exactly one cell, so each item is isolated.
    expect(collect(grid, 10, 10, 0)).toEqual(['cell-0-0']);
    expect(collect(grid, 100, 10, 0)).toEqual(['cell-3-0']);
    expect(collect(grid, 10, 100, 0)).toEqual(['cell-0-3']);
  });

  test('a distant query does not sweep up the whole grid', () => {
    const grid = new SpatialGrid<string>(CELL);
    grid.insert(5, 5, 'near-origin');
    expect(collect(grid, 300, 300, CELL)).toEqual([]);
  });

  test('cell boundaries partition on the floor of the coordinate', () => {
    const grid = new SpatialGrid<string>(CELL);
    grid.insert(CELL - 1, 0, 'last-of-cell-0');
    grid.insert(CELL, 0, 'first-of-cell-1');

    expect(collect(grid, 0, 0, 0)).toEqual(['last-of-cell-0']);
    expect(collect(grid, CELL, 0, 0)).toEqual(['first-of-cell-1']);
  });

  test('a query spanning several cells returns items from all of them', () => {
    const grid = new SpatialGrid<string>(CELL);
    grid.insert(10, 10, 'a');
    grid.insert(40, 10, 'b');
    grid.insert(10, 40, 'c');
    grid.insert(40, 40, 'd');

    expect(collect(grid, 32, 32, CELL).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  test('an item is visited once per query even when the query spans many cells', () => {
    const grid = new SpatialGrid<string>(CELL);
    grid.insert(50, 50, 'only');
    // Radius wide enough to cover a 3x3 block of cells around the item.
    expect(collect(grid, 50, 50, CELL * 1.5)).toEqual(['only']);
  });

  test('broad phase may return items outside the radius', () => {
    const grid = new SpatialGrid<string>(CELL);
    // Same cell as the query point, but 42px away — further than the radius.
    grid.insert(31, 31, 'same-cell-far');
    const seen = collect(grid, 1, 1, 2);
    expect(seen).toEqual(['same-cell-far']);
  });

  test('items sharing a cell are visited in insertion order', () => {
    const grid = new SpatialGrid<string>(CELL);
    grid.insert(1, 1, 'first');
    grid.insert(2, 2, 'second');
    grid.insert(3, 3, 'third');
    expect(collect(grid, 1, 1, 0)).toEqual(['first', 'second', 'third']);
  });

  test('the same item inserted twice is visited from both positions', () => {
    const grid = new SpatialGrid<string>(CELL);
    grid.insert(10, 10, 'ghost');
    grid.insert(200, 200, 'ghost');
    expect(collect(grid, 10, 10, 0)).toEqual(['ghost']);
    expect(collect(grid, 200, 200, 0)).toEqual(['ghost']);
  });

  test('negative coordinates are stored and found, not dropped', () => {
    const grid = new SpatialGrid<string>(CELL);
    grid.insert(-50, -70, 'off-left');
    expect(collect(grid, -50, -70, 0)).toEqual(['off-left']);
    expect(collect(grid, -50, -70, CELL)).toContain('off-left');
  });

  test('a query straddling the origin finds items on both sides', () => {
    const grid = new SpatialGrid<string>(CELL);
    grid.insert(-1, -1, 'negative');
    grid.insert(1, 1, 'positive');
    expect(collect(grid, 0, 0, 4).sort()).toEqual(['negative', 'positive']);
  });

  test('items far outside the playfield are stored and found', () => {
    const grid = new SpatialGrid<string>(CELL);
    grid.insert(FIELD * 10, FIELD * 10, 'far-right');
    grid.insert(FIELD + 1, -5000, 'way-above');

    expect(collect(grid, FIELD * 10, FIELD * 10, 0)).toEqual(['far-right']);
    expect(collect(grid, FIELD + 1, -5000, 0)).toEqual(['way-above']);
  });

  // Regression: the key used to be `cy * cols + cx`, which wrapped any cell
  // past the right edge onto the next row. Bullets stream off the sides every
  // tick, so this leaked them into queries on the far side of the field.
  test('a cell past the right edge does not alias onto the next row', () => {
    const grid = new SpatialGrid<string>(CELL);
    // Eleven cells right of the origin, on row 0 — the old key gave this the
    // same bucket as cell (0, 1) for a 320px-wide field.
    grid.insert(CELL * 11 + 5, 5, 'offscreen-right');

    expect(collect(grid, 5, CELL + 5, 0)).toEqual([]);
    expect(collect(grid, CELL * 11 + 5, 5, 0)).toEqual(['offscreen-right']);
  });

  test('a cell left of the origin does not alias onto the previous row', () => {
    const grid = new SpatialGrid<string>(CELL);
    grid.insert(-5, CELL + 5, 'offscreen-left');

    expect(collect(grid, CELL * 10 + 5, 5, 0)).toEqual([]);
    expect(collect(grid, -5, CELL + 5, 0)).toEqual(['offscreen-left']);
  });

  // The same aliasing made one query walk one bucket repeatedly, so a caller
  // that accumulates (damage, graze counts) rather than short-circuiting would
  // have counted a single bullet many times.
  test('a wide query visits each stored item exactly once', () => {
    const grid = new SpatialGrid<string>(CELL);
    grid.insert(10, 10, 'a');
    grid.insert(300, 300, 'b');
    grid.insert(-100, -100, 'c');

    const seen = collect(grid, 0, 0, 2000);
    expect(seen.filter((i) => i === 'a')).toHaveLength(1);
    expect(seen.filter((i) => i === 'b')).toHaveLength(1);
    expect(seen.filter((i) => i === 'c')).toHaveLength(1);
    expect(seen).toHaveLength(3);
  });

  test('no item is visited twice, for any query over a scattered cloud', () => {
    const rng = new Random(0xd00d);
    const grid = new SpatialGrid<number>(64);
    for (let i = 0; i < 200; i++) {
      grid.insert(rng.range(-400, 1000), rng.range(-400, 1000), i);
    }

    for (let q = 0; q < 200; q++) {
      const seen = collect(grid, rng.range(-400, 1000), rng.range(-400, 1000), rng.range(0, 500));
      expect(new Set(seen).size).toBe(seen.length);
    }
  });

  test('a query on an empty grid never calls the visitor', () => {
    const grid = new SpatialGrid<string>(CELL);
    let calls = 0;
    grid.query(0, 0, 1000, () => calls++);
    expect(calls).toBe(0);
  });

  // A degenerate radius is never useful, but it must stay harmless: the caller
  // runs an exact test afterwards, so extras cost nothing and a throw mid-tick
  // would cost everything.
  // Pin the actual outcome rather than only "did not throw": the previous
  // shape of this test was satisfied by an empty result as well as by the real
  // one, so it could not have detected a change in the degenerate behaviour.
  test('a negative radius is harmless — no throw, and nothing invented', () => {
    const grid = new SpatialGrid<string>(CELL);
    grid.insert(10, 10, 'a');
    grid.insert(300, 300, 'b');

    expect(() => collect(grid, 10, 10, -1)).not.toThrow();
    // Too small to push the swept range off the point's own cell, so that one
    // cell is still visited — harmless, because the caller's exact test rejects
    // it, and cheaper than branching on a case that never occurs in play.
    expect(collect(grid, 10, 10, -1)).toEqual(['a']);
    // Large enough that the range inverts and the loops never run at all.
    expect(collect(grid, 10, 10, -CELL)).toEqual([]);
  });

  // Under-reach is the only grid failure that loses a hit outright rather than
  // costing a wasted exact test, and it was guarded by a single brute-force
  // test. Give it direct, readable coverage on each side as well.
  test('a query reaches items at the far edge of its radius on every side', () => {
    const grid = new SpatialGrid<string>(CELL);
    const r = CELL * 2.5;
    grid.insert(100 - r, 100, 'left');
    grid.insert(100 + r, 100, 'right');
    grid.insert(100, 100 - r, 'up');
    grid.insert(100, 100 + r, 'down');

    expect(collect(grid, 100, 100, r).sort()).toEqual(['down', 'left', 'right', 'up']);
  });

  test('a huge radius returns every item in the grid', () => {
    const grid = new SpatialGrid<string>(CELL);
    grid.insert(10, 10, 'a');
    grid.insert(300, 300, 'b');
    grid.insert(-100, -100, 'c');
    expect(collect(grid, 0, 0, 2000).sort()).toEqual(['a', 'b', 'c']);
  });

  test('cells beyond the packing window clamp instead of wrapping', () => {
    const grid = new SpatialGrid<string>(CELL);
    // Far past the ±0x8000-cell window, on both signs.
    grid.insert(CELL * 0x40000, 0, 'absurdly-right');
    grid.insert(-CELL * 0x40000, 0, 'absurdly-left');

    // Clamping may merge distant cells (extra candidates are legal), but it
    // must never hide an item from a query at its own position.
    expect(collect(grid, CELL * 0x40000, 0, 0)).toContain('absurdly-right');
    expect(collect(grid, -CELL * 0x40000, 0, 0)).toContain('absurdly-left');
  });

  // The test above passes just as happily on a key that wraps modulo the
  // window, because insert and query then wrap alike. What actually separates
  // clamping from wrapping is *where* an out-of-window cell lands: clamping
  // parks it at the window edge, nowhere near the origin, while any modular key
  // folds it back onto a low cell and leaks it into ordinary play-area queries
  // — the same class of bug as the original row-stride aliasing.
  test('an out-of-window cell does not fold back onto the play area', () => {
    const grid = new SpatialGrid<string>(CELL);
    // Exactly one window out, one axis at a time, so a wrap on either axis is
    // caught rather than masked by the other axis still clamping.
    grid.insert(CELL * 0x10000, 0, 'one-window-right');
    grid.insert(0, CELL * 0x10000, 'one-window-down');

    expect(collect(grid, 0, 0, 0)).toEqual([]);
    expect(collect(grid, CELL, 0, 0)).toEqual([]);
    expect(collect(grid, 0, CELL, 0)).toEqual([]);
  });

  test('clear empties every bucket', () => {
    const grid = new SpatialGrid<string>(CELL);
    grid.insert(10, 10, 'a');
    grid.insert(200, 200, 'b');
    grid.insert(-40, -40, 'c');
    grid.clear();

    expect(collect(grid, 10, 10, 0)).toEqual([]);
    expect(collect(grid, 200, 200, 0)).toEqual([]);
    expect(collect(grid, -40, -40, 0)).toEqual([]);
  });

  test('a cleared grid is reusable and does not leak the previous tick', () => {
    const grid = new SpatialGrid<string>(CELL);
    grid.insert(10, 10, 'tick-1');
    grid.clear();
    grid.insert(10, 10, 'tick-2');

    expect(collect(grid, 10, 10, 0)).toEqual(['tick-2']);
  });

  test('clear on an untouched grid is a no-op', () => {
    const grid = new SpatialGrid<string>(CELL);
    grid.clear();
    grid.clear();
    grid.insert(10, 10, 'a');
    expect(collect(grid, 10, 10, 0)).toEqual(['a']);
  });

  test('repeated clear/insert cycles stay consistent', () => {
    const grid = new SpatialGrid<number>(CELL);
    for (let tick = 0; tick < 50; tick++) {
      grid.clear();
      grid.insert(tick * 7, tick * 5, tick);
      expect(collect(grid, tick * 7, tick * 5, 0)).toEqual([tick]);
    }
  });

  test('holds reference types without copying them', () => {
    const grid = new SpatialGrid<{ hp: number }>(CELL);
    const enemy = { hp: 10 };
    grid.insert(10, 10, enemy);
    const [found] = collect(grid, 10, 10, 0);
    expect(found).toBe(enemy);
  });

  // A false negative here is a bullet passing through an enemy, so this is
  // checked exhaustively against brute force rather than by example.
  test('never misses an item inside the query radius', () => {
    const rng = new Random(0x5eed);
    const grid = new SpatialGrid<number>(64);
    const points: { x: number; y: number }[] = [];

    for (let i = 0; i < 300; i++) {
      // Deliberately spilling outside [0, 640) on both axes.
      const x = rng.range(-300, 1000);
      const y = rng.range(-300, 1000);
      points.push({ x, y });
      grid.insert(x, y, i);
    }

    for (let q = 0; q < 300; q++) {
      const qx = rng.range(-300, 1000);
      const qy = rng.range(-300, 1000);
      const radius = rng.range(0, 150);

      const visited = new Set(collect(grid, qx, qy, radius));
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (p === undefined) continue;
        // The oracle is deliberately not `circlesOverlap`: this is the test
        // guarding the property that matters most, and drawing its expectation
        // from the module under test would let a broken `circlesOverlap` make
        // it vacuously green rather than red.
        if (Math.hypot(qx - p.x, qy - p.y) <= radius) {
          expect(visited.has(i)).toBe(true);
        }
      }
    }
  });

  test('a wider radius never returns fewer items than a narrower one', () => {
    const rng = new Random(99);
    const grid = new SpatialGrid<number>(64);
    for (let i = 0; i < 200; i++) {
      grid.insert(rng.range(-200, 800), rng.range(-200, 800), i);
    }

    for (let q = 0; q < 100; q++) {
      const qx = rng.range(-200, 800);
      const qy = rng.range(-200, 800);
      const narrow = new Set(collect(grid, qx, qy, 20));
      const wide = new Set(collect(grid, qx, qy, 120));
      for (const item of narrow) expect(wide.has(item)).toBe(true);
    }
  });

  test('identical insertion sequences produce identical visit orders', () => {
    const build = (): SpatialGrid<number> => {
      const rng = new Random(1234);
      const grid = new SpatialGrid<number>(64);
      for (let i = 0; i < 200; i++) {
        grid.insert(rng.range(-100, 700), rng.range(-100, 700), i);
      }
      return grid;
    };

    const a = collect(build(), 320, 320, 400);
    const b = collect(build(), 320, 320, 400);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  // Determinism is the product, and `clear` deliberately retains its bucket
  // arrays across ticks. A recycled grid must therefore visit in exactly the
  // order a fresh one would — if any trace of the previous tick's population
  // survived, a replay would diverge based on what came before it.
  test('a recycled grid visits in the same order as a fresh one', () => {
    const fill = (grid: SpatialGrid<number>, seed: number, count: number): void => {
      const rng = new Random(seed);
      for (let i = 0; i < count; i++) {
        grid.insert(rng.range(-200, 800), rng.range(-200, 800), i);
      }
    };

    // A busy earlier tick, with a different seed and a larger population, so
    // leftovers would be both present and distinguishable.
    const recycled = new SpatialGrid<number>(64);
    fill(recycled, 0xfeed, 300);
    recycled.clear();
    fill(recycled, 0xbeef, 150);

    const fresh = new SpatialGrid<number>(64);
    fill(fresh, 0xbeef, 150);

    const a = collect(recycled, 320, 320, 400);
    const b = collect(fresh, 320, 320, 400);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  describe('bucket retention', () => {
    /**
     * A never-before-touched cell, `n` distinct ones as `n` counts up.
     *
     * The stride must stay inside the range `packCell` can represent. It
     * clamps cell coordinates to +/-0x8000, so a "far apart" x of `n * CELL *
     * 100` stops producing new keys at n = 328: every later position saturates
     * onto the same edge bucket. Written that way these tests peak at ~330
     * buckets, never reach the cap, and never evict anything — they pass
     * identically against the leaking implementation they were written to
     * catch. One cell per step is the whole point.
     */
    const churnX = (n: number): number => n * CELL;

    /**
     * Buckets retained once the cap binds. Not exported from `collision.ts`
     * (nothing outside it should tune the cap), so the tests assert the shape
     * of the bound — flat, and far below the number of cells touched — rather
     * than its exact value. `atCap` is what stops these going vacuous again:
     * a run that never fills the map never exercises eviction at all.
     */
    const atCap = (grid: SpatialGrid<unknown>): boolean => grid.bucketCount >= 4000;

    // The leak this guards: `clear()` used to empty every bucket's array but
    // never drop the key, so the map grew with the union of every cell ever
    // touched. Bullets stream far outside the field over a long session, so a
    // stream of never-repeated positions is exactly the failure case.
    test('the bucket count does not grow without bound under a stream of ever-moving positions', () => {
      const grid = new SpatialGrid<number>(CELL);
      const PER_PHASE = 9000;
      const drive = (offset: number): void => {
        for (let i = 0; i < PER_PHASE; i++) {
          grid.clear();
          grid.insert(churnX(offset + i), 0, i);
        }
      };

      drive(0);
      const afterFirst = grid.bucketCount;
      drive(PER_PHASE);
      const afterSecond = grid.bucketCount;

      // Unbounded retention would reach 9000 keys after the first phase and
      // 18000 after the second. A bounded policy holds it flat at the cap.
      expect(afterFirst).toBeLessThan(PER_PHASE);
      expect(afterSecond).toBeLessThanOrEqual(afterFirst + 50);
      expect(atCap(grid)).toBe(true);
    });

    // The other half of the policy: eviction must never reach a bucket that is
    // still in active use, no matter how much unrelated churn is pushing on
    // the cap at the same time.
    test('a bucket still in use is never dropped, even under eviction pressure', () => {
      const grid = new SpatialGrid<string>(CELL);
      const homeX = 10;
      const homeY = 10;

      for (let tick = 0; tick < 9000; tick++) {
        grid.clear();
        grid.insert(homeX, homeY, 'home');
        // A fresh, never-repeated cell every tick, to force the cap and keep
        // the eviction path exercised for the whole run.
        grid.insert(churnX(tick), 5000, `churn-${tick}`);
      }

      expect(atCap(grid)).toBe(true);
      expect(collect(grid, homeX, homeY, 0)).toEqual(['home']);
    });

    // Occasional gaps in use are normal (a lane goes quiet, then fires again)
    // and must not read as abandonment. Churn runs throughout, so the gap is
    // survived under live eviction pressure rather than in an idle map.
    test('a bucket survives a gap shorter than the idle threshold', () => {
      const grid = new SpatialGrid<string>(CELL);
      let tick = 0;
      const churn = (): void => {
        grid.clear();
        grid.insert(churnX(tick), 5000, `churn-${tick}`);
        tick++;
      };

      // Past the cap, not merely up to it, so every churn tick through the gap
      // below is evicting rather than still filling the map.
      while (!atCap(grid)) churn();
      for (let settle = 0; settle < 200; settle++) churn();

      grid.insert(10, 10, 'lull');
      for (let gap = 0; gap < 100; gap++) churn();

      grid.insert(10, 10, 'lull');
      expect(collect(grid, 10, 10, 0)).toEqual(['lull']);
    });

    // The positive case behind the bounded-growth test above: a bucket that
    // is genuinely abandoned — one insert, then never touched again — must
    // eventually be reclaimed under cap pressure, not just stop growing.
    test('a genuinely abandoned bucket is eventually evicted under cap pressure', () => {
      const grid = new SpatialGrid<string>(CELL);
      const CHURN = 9000;

      grid.clear();
      grid.insert(10, 10, 'abandoned');

      // Far more ticks than the idle threshold, each forcing a brand-new key,
      // so the cap is reached and stays under pressure for the whole run.
      for (let tick = 0; tick < CHURN; tick++) {
        grid.clear();
        grid.insert(churnX(tick), 5000, `churn-${tick}`);
      }

      // Retention has to be asserted on the bucket count, not on what a query
      // returns: an emptied-but-retained bucket and an evicted one both answer
      // an empty query. Holding at the cap while 1 + CHURN distinct cells were
      // touched is reclamation, and reclamation takes the least-recently-used
      // bucket first — which is precisely the one touched once, at the start,
      // and never since.
      expect(atCap(grid)).toBe(true);
      expect(grid.bucketCount).toBeLessThan(1 + CHURN);
      expect(collect(grid, 10, 10, 0)).toEqual([]);
    });
  });
});
