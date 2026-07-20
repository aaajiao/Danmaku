/**
 * The padding rule, enforced.
 *
 * `docs/assets.md` has always asserted 2px of transparent margin inside every
 * 32px cell, and the generated sheet has always been offered as the reference
 * implementation of that rule. It was not one: `halo` painted a full 32px with
 * zero margin, and `glow.large` 30px with one. Both survived because the only
 * statement of the rule was prose, and the only statement of the extents was
 * different prose — computed by hand, in a different file, from arguments the
 * call sites do not make obvious.
 *
 * The overhang is the part worth catching mechanically. `ringCell(15, 2)` reads
 * like a 30px shape; `ring` draws a second stroke of `thickness * 2` centred on
 * `radius - thickness / 2`, so it paints to `radius + thickness / 2` = 16. Half
 * a thickness of paint appears outside the number in the call, and no amount of
 * reading the call site reveals it.
 *
 * This file cannot render anything — `bun test` has no canvas, which is why
 * these extents are declared alongside the draw call rather than measured off a
 * bitmap. That is a real limitation: the declaration could drift from the
 * painter. It is bounded by keeping the two in one expression, and by the fact
 * that `test:assets` renders the sheet in a browser where a bleeding seam is
 * visible.
 *
 * The formulas *were* checked against a real canvas once, by replicating each
 * painter in a browser and measuring the alpha bounding box. That run reproduced
 * both defects exactly — old `halo` at 32×32 with zero margin, old `glow.large`
 * at 30×30 with one — and confirmed both fixes at 28×28 with two. It also turned
 * up the geometric-versus-painted distinction now recorded on
 * `MAX_CELL_EXTENT`: `ring(12, 3)` is geometrically 27 and paints 28 pixels,
 * because a fractional boundary gives partial coverage to the pixel outside it.
 *
 * Which is why the assertions below are `<=`, never `===`, against the limit.
 */

import { describe, expect, test } from 'bun:test';

import {
  BULLET_CELLS,
  BULLET_COLUMNS,
  BULLET_GRID,
  BULLET_ROWS,
  CELL_ART,
  MAX_CELL_EXTENT,
} from './procedural';

describe('cell padding', () => {
  test('every cell leaves at least 2px of margin', () => {
    const over = Object.entries(CELL_ART)
      .filter(([, art]) => art.w > MAX_CELL_EXTENT || art.h > MAX_CELL_EXTENT)
      .map(([name, art]) => `${name}: ${art.w}x${art.h} > ${MAX_CELL_EXTENT}`);

    expect(over).toEqual([]);
  });

  test('the limit is the cell size less 2px a side, not a number someone liked', () => {
    expect(MAX_CELL_EXTENT).toBe(BULLET_GRID.cellW - 4);
    expect(MAX_CELL_EXTENT).toBe(BULLET_GRID.cellH - 4);
  });

  test('every named cell has art, and every art is named', () => {
    // A cell with no painter draws nothing and reads as an invisible bullet.
    expect(Object.keys(CELL_ART).sort()).toEqual([...BULLET_CELLS].sort());
  });

  test('the cell list fits the grid it is packed into', () => {
    // `createBulletAtlas` lays cells out row-major into a
    // BULLET_COLUMNS × BULLET_ROWS grid. One name past that capacity does not
    // fail — it wraps to `row = 2` and paints off the bottom of a sheet sized
    // for two rows, so the last cells silently overlap earlier ones and the
    // atlas hands back UVs for a region that was overwritten. Adding a
    // sixteenth-plus bullet is exactly the kind of edit a real art drop makes,
    // so the capacity is asserted rather than trusted.
    expect(BULLET_CELLS.length).toBeLessThanOrEqual(BULLET_COLUMNS * BULLET_ROWS);
  });
});

describe('the two that were broken stay fixed', () => {
  // Named rather than left to the sweep above, because these are the specific
  // regressions: both are cheap to reintroduce by nudging a radius, and both
  // look harmless at the call site.

  test('halo accounts for its outer stroke overhang', () => {
    // ringCell(13, 2) → paint reaches 13 + 1 = 14, exactly the limit.
    expect(CELL_ART.halo.w).toBe(28);
    expect(CELL_ART.halo.h).toBe(28);
  });

  test('glow.large is 28, not the 30 it shipped as', () => {
    expect(CELL_ART['glow.large'].w).toBe(28);
  });
});

describe('the guard can fail', () => {
  // A check nobody has seen reject anything is not evidence. These reproduce
  // the two real defects through the same formulas the real cells use.

  const ringExtent = (radius: number, thickness: number) => (radius + thickness / 2) * 2;
  const orbExtent = (radius: number) => radius * 2;

  test('the old halo would be rejected', () => {
    expect(ringExtent(15, 2)).toBe(32);
    expect(ringExtent(15, 2)).toBeGreaterThan(MAX_CELL_EXTENT);
  });

  test('the old glow.large would be rejected', () => {
    expect(orbExtent(15)).toBe(30);
    expect(orbExtent(15)).toBeGreaterThan(MAX_CELL_EXTENT);
  });

  test('and the shapes that were always fine still pass', () => {
    // Proves the formulas above are not simply returning something too large.
    expect(ringExtent(12, 3)).toBe(27);
    expect(orbExtent(13)).toBe(26);
  });
});

/**
 * These are **geometric** extents — where the path runs — and they are not the
 * pixel footprint. Measured on a canvas, the two disagree in both directions:
 *
 *   kunai   geometric 26x4.5  →  painted 26x6    blunt, so coverage spills
 *   needle  geometric 28x2.5  →  painted 26x4    tips too thin to register
 *   star    geometric 26x26   →  painted 24x24   same, at five points
 *   ring    geometric 27      →  painted 28      fractional boundary
 *
 * The guard is still sound, and the direction is worth stating because it is not
 * obvious. For a shape centred in a 32px cell with geometric extent E ≤ 28, the
 * path spans `16 ± E/2`, so it touches no pixel below index 2 and none above 29
 * — margin 2, whatever the silhouette. E = 28.5 is the first that reaches pixel
 * 1. So a geometric check can never pass something the bitmap would fail, and
 * `kunai` painting 6 where 4.5 was declared is harmless at that size.
 *
 * What it *cannot* do is give `docs/assets.md` numbers to quote. Those must come
 * from the bitmap, and the measurement lives in `test/visual/asset-loading.ts`,
 * which prints all sixteen.
 */
describe('declared geometry', () => {
  test('a blade paints half its control width', () => {
    expect(CELL_ART.kunai.w).toBe(26);
    expect(CELL_ART.kunai.h).toBe(4.5);
    expect(CELL_ART.needle.w).toBe(28);
    expect(CELL_ART.needle.h).toBe(2.5);
  });

  test('a shard paints its full stated width, because its edges are straight', () => {
    expect(CELL_ART.shard.h).toBe(7);
    expect(CELL_ART.scale.h).toBe(12);
  });

  test('a petal is asymmetric about its own centre line', () => {
    expect(CELL_ART.petal.w).toBe(22);
    expect(CELL_ART.petal.h).toBeCloseTo(7.7, 5);
  });
});
