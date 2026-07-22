/**
 * The laser skin ledger: every skin names strips the sheet actually paints, and
 * all 11 laser strips are consumed.
 *
 * A beam names a skin (`b.style.sprite`); a skin names a body strip and a cap
 * strip on the laser atlas; the atlas paints exactly the strips `LASER_STRIPS`
 * declares. If a skin named a strip the sheet never paints, the beam would draw
 * nothing the first frame it fired — caught at boot by `main.ts`'s resolution
 * throw, and caught here at build time, arithmetically, before a browser is
 * involved (`bun test` has no canvas, so the pixels are judged on `test:assets`).
 *
 * This is also the static half of "all 11 consumed": the 11 BulletPack laser
 * files map one-to-one onto 8 body strips + 3 cap strips, so the ledger below —
 * every body named exactly once, every cap named at least once, the union all 11
 * — is the build-time proof that a reskin has a home for every file. The
 * reachability half (every body drawn lethal in a real run) lives in
 * `reachability.test.ts`; caps are render-only and proven here, not there.
 */

import { describe, expect, test } from 'bun:test';

import { getLaserSkin, laserSkinNames } from './laser-skin';
import { LASER_BODY_CELLS, LASER_CAP_CELLS, LASER_STRIP_CELLS } from './procedural';

const bodies = new Set<string>(LASER_BODY_CELLS);
const caps = new Set<string>(LASER_CAP_CELLS);

describe('every skin resolves to strips the sheet paints', () => {
  test('the base campaign registered its eight beam skins', () => {
    expect(laserSkinNames().length).toBe(8);
  });

  test('every skin body is one of the eight body strips', () => {
    const broken = laserSkinNames()
      .map((name) => ({ name, body: getLaserSkin(name)!.body }))
      .filter((s) => !bodies.has(s.body));
    expect(broken).toEqual([]);
  });

  test('every skin cap is one of the three cap strips', () => {
    const broken = laserSkinNames()
      .map((name) => ({ name, cap: getLaserSkin(name)!.cap }))
      .filter((s) => !caps.has(s.cap));
    expect(broken).toEqual([]);
  });

  test('a tile skin defaults its tile length (undefined) to the body frame width', () => {
    // Not a fixed px in the table: the shell falls back to the body strip's own
    // frameW, so the procedural floor and a native reskin each tile natively.
    for (const name of laserSkinNames()) {
      const skin = getLaserSkin(name)!;
      if (skin.fit === 'tile') expect(skin.tileLength).toBeUndefined();
    }
  });
});

describe('all 11 laser strips are consumed (the static ledger)', () => {
  test('the sheet paints exactly 8 bodies + 3 caps = 11 strips', () => {
    expect(LASER_BODY_CELLS.length).toBe(8);
    expect(LASER_CAP_CELLS.length).toBe(3);
    expect(LASER_STRIP_CELLS.length).toBe(11);
    // The two role sets partition the whole sheet.
    expect([...LASER_STRIP_CELLS].sort()).toEqual([...LASER_BODY_CELLS, ...LASER_CAP_CELLS].sort());
  });

  test('each body strip is named by exactly one skin', () => {
    const counts = new Map<string, number>();
    for (const name of laserSkinNames()) {
      const body = getLaserSkin(name)!.body;
      counts.set(body, (counts.get(body) ?? 0) + 1);
    }
    // Every body used, and none used twice.
    expect([...counts.keys()].sort()).toEqual([...LASER_BODY_CELLS].sort());
    expect([...counts.values()].every((n) => n === 1)).toBe(true);
  });

  test('each cap strip is named by at least one skin', () => {
    const used = new Set<string>();
    for (const name of laserSkinNames()) used.add(getLaserSkin(name)!.cap);
    expect([...used].sort()).toEqual([...LASER_CAP_CELLS].sort());
  });

  test('the union of every skin body and cap is all 11 strips', () => {
    const named = new Set<string>();
    for (const name of laserSkinNames()) {
      const skin = getLaserSkin(name)!;
      named.add(skin.body);
      named.add(skin.cap);
    }
    expect([...named].sort()).toEqual([...LASER_STRIP_CELLS].sort());
  });
});

describe('the guard can fail', () => {
  // A check nobody has seen reject anything is not evidence: a skin naming a
  // strip one keystroke off a real one resolves to nothing, the exact failure the
  // ledger exists to catch.
  test('a skin naming an unpainted strip is detected', () => {
    const withTypo = [
      ...laserSkinNames().map((name) => ({ name, body: getLaserSkin(name)!.body })),
      { name: 'synthetic', body: 'beam.v4' },
    ];
    const broken = withTypo.filter((s) => !bodies.has(s.body));
    expect(broken).toEqual([{ name: 'synthetic', body: 'beam.v4' }]);
  });
});
