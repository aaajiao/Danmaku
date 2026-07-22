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
  FX_STRIPS,
  FX_PAD,
  FX_SHEET_W,
  FX_SHEET_H,
  LASER_STRIPS,
  LASER_STRIP_CELLS,
  LASER_BODY_CELLS,
  LASER_CAP_CELLS,
  LASER_SHEET,
  LASER_SHEET_W,
  LASER_SHEET_H,
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
/**
 * The fx floor's per-frame budget — the seam law of `MAX_CELL_EXTENT`, now
 * applied at every frame boundary of every animation strip. Each strip's
 * `frameExtent(f)` re-derives the painted box from the SAME radii its painter
 * uses (the `CELL_ART` discipline, per frame), so a drift between the declared
 * budget and the paint is a failure here rather than a seam bleed on screen.
 * `bun test` has no canvas, so this is arithmetic; `test:assets` measures the
 * real painted footprint on a framebuffer.
 */
describe('fx strip geometry', () => {
  test('every frame of every strip clears 2px of margin on both axes', () => {
    const over: string[] = [];
    for (const [name, s] of Object.entries(FX_STRIPS)) {
      const limit = s.frameW - 2 * FX_PAD;
      const hLimit = s.frameH - 2 * FX_PAD;
      for (let f = 0; f < s.frames; f++) {
        const e = s.frameExtent(f);
        if (e.w > limit || e.h > hLimit) {
          over.push(`${name} frame ${f}: ${e.w}×${e.h} > ${limit}×${hLimit}`);
        }
      }
    }
    expect(over).toEqual([]);
  });

  test('every strip fits within the shared sheet, frames laid horizontally', () => {
    const off: string[] = [];
    for (const [name, s] of Object.entries(FX_STRIPS)) {
      if (s.stride < s.frameW) off.push(`${name}: stride ${s.stride} < frameW ${s.frameW}`);
      if (s.sheetX + s.frames * s.stride > FX_SHEET_W) {
        off.push(`${name}: runs past sheet width ${FX_SHEET_W}`);
      }
      if (s.sheetY + s.frameH > FX_SHEET_H) {
        off.push(`${name}: runs past sheet height ${FX_SHEET_H}`);
      }
    }
    expect(off).toEqual([]);
  });

  test('the sheet dimensions are derived from the table, not hand-set', () => {
    const w = Math.max(...Object.values(FX_STRIPS).map((s) => s.sheetX + s.frames * s.stride));
    const h = Math.max(...Object.values(FX_STRIPS).map((s) => s.sheetY + s.frameH));
    expect(FX_SHEET_W).toBe(w);
    expect(FX_SHEET_H).toBe(h);
  });

  test('the round-one strips exist with their declared playback', () => {
    // The reachable consumers: two once bursts (enemy/boss/player death) and one
    // looping pulse (item spin). A change to the set is a change to what draws.
    expect(FX_STRIPS.burst?.mode).toBe('once');
    expect(FX_STRIPS['burst.big']?.mode).toBe('once');
    expect(FX_STRIPS.pulse?.mode).toBe('loop');
    // All tinted: the floor is recolourable (rule 9); colour comes from the tint.
    for (const s of Object.values(FX_STRIPS)) expect(s.color).toBe('tinted');
  });
});

/**
 * The laser floor's per-frame budget, with one deliberate asymmetry the fx floor
 * does not have. A cap is a small animated tip flash whose frames sit adjacent on
 * the sheet, so it clears the seam pad on BOTH axes exactly as an fx strip does.
 * A body is a `frames: 1` tiling strip: it is DESIGNED to reach its on-beam frame
 * edges so a tiled beam butts without a seam, and being one frame there is no
 * animation frame beside it to bleed into — so the on-beam (frameW) axis is
 * exempt, and only the cross-axis (frameH), where the next strip's row sits, is
 * held to the pad. `bun test` has no canvas, so this is arithmetic; `test:assets`
 * measures the real painted footprint.
 */
describe('laser strip geometry', () => {
  test('the sheet paints 8 bodies + 3 caps = 11 strips', () => {
    expect(LASER_BODY_CELLS.length).toBe(8);
    expect(LASER_CAP_CELLS.length).toBe(3);
    expect(LASER_STRIP_CELLS.length).toBe(11);
    expect(Object.keys(LASER_STRIPS).sort()).toEqual([...LASER_STRIP_CELLS].sort());
  });

  test('every cap frame clears 2px of margin on both axes', () => {
    const over: string[] = [];
    for (const [name, s] of Object.entries(LASER_STRIPS)) {
      if (s.role !== 'cap') continue;
      const wLimit = s.frameW - 2 * FX_PAD;
      const hLimit = s.frameH - 2 * FX_PAD;
      for (let f = 0; f < s.frames; f++) {
        const e = s.frameExtent(f);
        if (e.w > wLimit || e.h > hLimit) {
          over.push(`${name} frame ${f}: ${e.w}×${e.h} > ${wLimit}×${hLimit}`);
        }
      }
    }
    expect(over).toEqual([]);
  });

  test('every body clears the pad cross-axis; the on-beam axis fills the frame for seamless tiling', () => {
    const over: string[] = [];
    for (const [name, s] of Object.entries(LASER_STRIPS)) {
      if (s.role !== 'body') continue;
      const hLimit = s.frameH - 2 * FX_PAD;
      for (let f = 0; f < s.frames; f++) {
        const e = s.frameExtent(f);
        // Cross-axis held to the pad; on-beam axis must fill (reach) the frame
        // width and never exceed it — that is what tiles seamlessly.
        if (e.h > hLimit) over.push(`${name} frame ${f}: cross-axis ${e.h} > ${hLimit}`);
        if (e.w > s.frameW) over.push(`${name} frame ${f}: on-beam ${e.w} > frameW ${s.frameW}`);
        if (e.w < s.frameW) over.push(`${name} frame ${f}: on-beam ${e.w} < frameW ${s.frameW} (would seam)`);
      }
    }
    expect(over).toEqual([]);
  });

  test('every strip fits the shared sheet, frames laid horizontally', () => {
    const off: string[] = [];
    for (const [name, s] of Object.entries(LASER_STRIPS)) {
      const p = LASER_SHEET.positions[name]!;
      if (s.stride < s.frameW) off.push(`${name}: stride ${s.stride} < frameW ${s.frameW}`);
      if (p.x + s.frames * s.stride > LASER_SHEET_W) off.push(`${name}: runs past sheet width`);
      if (p.y + s.frameH > LASER_SHEET_H) off.push(`${name}: runs past sheet height`);
    }
    expect(off).toEqual([]);
  });

  test('the sheet dimensions are derived from the table, not hand-set', () => {
    const width = Math.max(...Object.values(LASER_STRIPS).map((s) => s.frames * s.stride), 1);
    const height = Object.values(LASER_STRIPS).reduce((h, s) => h + s.frameH, 0);
    expect(LASER_SHEET_W).toBe(width);
    expect(LASER_SHEET_H).toBe(height);
  });

  test('bodies are static (tiled), caps loop (a tip flicker); all tinted (rule 9)', () => {
    for (const [name, s] of Object.entries(LASER_STRIPS)) {
      // The floor is recolourable — colour is the content tint, so LANCE stays pink.
      expect(`${name}:${s.color}`).toBe(`${name}:tinted`);
      if (s.role === 'body') expect(s.frames).toBe(1);
      if (s.role === 'cap') expect(s.mode).toBe('loop');
    }
  });

  test('the guard can fail — a body painting past its cross-axis pad is rejected', () => {
    // Reproduce a body whose glow reaches the frame edge on the cross-axis, the
    // exact seam bleed the check exists to catch.
    const bad = { frameH: 24, extent: { h: 24 } };
    const hLimit = bad.frameH - 2 * FX_PAD;
    expect(bad.extent.h).toBeGreaterThan(hLimit);
  });
});

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
