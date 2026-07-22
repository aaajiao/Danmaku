/**
 * Every sprite name the content writes down resolves to a cell that exists.
 *
 * The other half of the guard `backgrounds/index.test.ts` provides for scenes.
 * A stage names its scene as a string and that test proves the string resolves;
 * a bullet, enemy, boss, item and option name their art as a string too, and
 * until this file nothing proved those did.
 *
 * `sim/effects.ts` is the one registry that types its `sprite` against the
 * atlas — its `defineSprite` helper takes a `BulletCell`, so a renamed cell
 * fails the build. Its own comment states the rationale and it was applied to
 * exactly one registry out of six. For the other five `sprite` is a bare
 * `string`, so a typo or an edited `BULLET_CELLS` compiles clean and throws
 * `atlas region "…" is not defined` from `atlas.ts` — inside the render loop,
 * on the first frame the entity is drawn, i.e. at the moment content is reached
 * rather than at build time. That is the exact failure mode the string-
 * reference design accepts everywhere and pays down with a test like this one.
 *
 * It matters most precisely when real art lands. `docs/assets.md` §5 tells the
 * integrator the swap leaves content untouched because cells are named, not
 * indexed — true only while every declared name still exists, which is a claim
 * this file is the one thing that checks. A real drop almost always edits
 * `BULLET_CELLS` (a renamed or dropped cell), and that is the trigger, not
 * repacking the PNG: cell names live in code, not in the image.
 *
 * ## Which sprites this covers, and one it cannot
 *
 * Everything a spec *declares statically* — enemy, boss, item, option (both the
 * satellite's own sprite and the sprite of the shot it fires), and every player
 * shot ladder. What it does **not** cover is the bullet style a *pattern* emits:
 * a pattern is a function that builds its bullets when it runs, so its sprite
 * names exist only once it has been stepped, and gathering them means driving
 * every pattern rather than reading a table. That is a real remaining gap and
 * it is named here rather than papered over; the pattern's own `sprite` strings
 * are still caught the moment the pattern is reached in `bun run dev`, the same
 * as before, just not at build time.
 *
 * This test may import `src/render`: it lives in `src/render`. The headless
 * trees may not, which is why the check has to live here and not beside the
 * content — the same split `backgrounds/index.test.ts` documents.
 */

import { describe, expect, test } from 'bun:test';

// The base campaign — enemies, bosses, stages AND (since decisions-round2 §D) the
// player weapons and characters — lives in the bundled base pack, not in
// `../content`. This is render, not a headless tree, so it may import the pack;
// doing so is what lets this file validate the REAL declared sprites standalone
// rather than vacuously passing on empty registries under the full suite's
// cross-file leakage.
import '../v4';
import { getShot, shotNames } from '../content/shots';
import { bossNames, getBossSpec } from '../sim/boss';
import { enemyNames, getEnemySpec } from '../sim/enemy';
import { getItemSpec, itemNames } from '../sim/item';
import { getOptionSpec, optionNames } from '../sim/option';
import { laserSkinNames } from './laser-skin';
import { BULLET_CELLS, BULLET_VARIANT_CELLS, PICKUP_STRIP_CELLS } from './procedural';

/**
 * The names a bullet-atlas draw may reference: the sixteen floor cells AND the
 * per-family variant names the base campaign fires. Both resolve on every atlas
 * the engine builds — the procedural floor, the legacy grid and a native pack
 * sheet all alias each variant to its base cell (`defineVariantAliases`) — so a
 * variant is as resolvable as a floor cell, which is exactly what this test
 * asserts and what the injector's sprite gate validates content against.
 */
const CELLS = new Set<string>([...BULLET_CELLS, ...BULLET_VARIANT_CELLS]);

/**
 * The names a beam may wear: the laser SKINS (`laser-skin.ts`), a third pool
 * distinct from the bullet cells because a laser draws from the laser atlas via
 * the beam batch, not the bullet atlas. A bullet spec carrying a `laser` field
 * names one of these, so it is checked against this set rather than `CELLS` —
 * exactly the split the injector's sprite gate makes (`packs/inject.ts`).
 */
const LASER_SKINS = new Set<string>(laserSkinNames());

/**
 * The names a pickup may wear: the pickup-atlas strips (`PICKUP_STRIPS`), a fourth
 * pool distinct from the bullet cells because a coin/gem/bar draws from the pickup
 * atlas via `batches.pickups`, not the bullet atlas. Only an `Item` names one — the
 * money tiers (`pickup.coin.*`, `pickup.gem.*`, `pickup.bar`); `power`/`life`/`bomb`
 * still wear bullet cells — so an item sprite resolves against the bullet cells OR
 * this pool, which is exactly the "exactly one of {bulletAtlas, pickupAtlas}" the
 * boot resolve-check in `main.ts` enforces at runtime, checked headlessly here.
 */
const PICKUP_CELLS = new Set<string>(PICKUP_STRIP_CELLS);

/** Registered by a test rather than by the game. */
const isFixture = (name: string): boolean =>
  name.startsWith('test') || name.startsWith('probe.') || name.startsWith('balance.') ||
  name.includes('.test.');

const content = (names: readonly string[]): string[] => names.filter((n) => !isFixture(n));

/**
 * A `{ where, sprite, laser }` for every statically declared bullet sprite.
 * `laser` marks a spec that carries a `LaserSpec` (the player's `laser` shot),
 * whose sprite names a laser skin rather than a bullet cell — resolved against a
 * different pool below.
 */
function declaredSprites(): { where: string; sprite: string; laser: boolean }[] {
  const out: { where: string; sprite: string; laser: boolean }[] = [];

  for (const name of content(enemyNames())) {
    out.push({ where: `enemy ${name}`, sprite: getEnemySpec(name).sprite, laser: false });
  }
  for (const name of content(bossNames())) {
    out.push({ where: `boss ${name}`, sprite: getBossSpec(name).sprite, laser: false });
  }
  for (const name of content(itemNames())) {
    out.push({ where: `item ${name}`, sprite: getItemSpec(name).sprite, laser: false });
  }
  for (const name of content(optionNames())) {
    const spec = getOptionSpec(name);
    out.push({ where: `option ${name}`, sprite: spec.sprite, laser: false });
    out.push({
      where: `option ${name} shot`,
      sprite: spec.shot.style.sprite,
      laser: spec.shot.laser !== undefined,
    });
  }
  for (const name of content(shotNames())) {
    getShot(name).levels.forEach((level, tier) => {
      out.push({
        where: `shot ${name} tier ${tier}`,
        sprite: level.spec.style.sprite,
        laser: level.spec.laser !== undefined,
      });
      if (level.focused?.spec !== undefined) {
        out.push({
          where: `shot ${name} tier ${tier} focused`,
          sprite: level.focused.spec.style.sprite,
          laser: level.focused.spec.laser !== undefined,
        });
      }
    });
  }

  return out;
}

/**
 * A declared sprite resolves against its own pool: a laser to a skin, else a bullet
 * cell OR a pickup cell (an item's money tier draws from the pickup atlas). The two
 * cell pools are name-disjoint (`pickup.*` vs the sixteen floor cells and variants),
 * so combining them for the non-laser case cannot make a bullet-cell typo resolve.
 */
const resolves = (d: { sprite: string; laser: boolean }): boolean =>
  d.laser ? LASER_SKINS.has(d.sprite) : CELLS.has(d.sprite) || PICKUP_CELLS.has(d.sprite);

describe('every declared sprite resolves to an atlas cell', () => {
  test('nothing names a cell the sheet does not contain', () => {
    const broken = declaredSprites().filter((d) => !resolves(d));
    expect(broken).toEqual([]);
  });

  test('the guard can fail — a bad name is caught', () => {
    // The project's standard: a check nobody has seen reject anything is not
    // evidence. `orb.smal` is one keystroke from a real cell and resolves to
    // nothing, which is the whole failure this file exists to catch.
    const withTypo = [...declaredSprites(), { where: 'synthetic', sprite: 'orb.smal', laser: false }];
    const broken = withTypo.filter((d) => !resolves(d));
    expect(broken).toEqual([{ where: 'synthetic', sprite: 'orb.smal', laser: false }]);
  });

  test('the laser pool is real, and a laser naming a bullet cell is caught', () => {
    // A beam validates against the skin registry, not the bullet cells: the
    // player's `laser` shot wears `beam.cyan`, which is a skin, not a cell — so
    // checking it against `CELLS` would wrongly reject it, and checking a laser
    // against `LASER_SKINS` is what makes it pass. Prove the pool is populated and
    // that the split actually discriminates.
    expect(LASER_SKINS.size).toBeGreaterThan(0);
    const laserNamingCell = { sprite: 'orb.small', laser: true };
    expect(resolves(laserNamingCell)).toBe(false); // a laser cannot wear a bullet cell
  });

  test('the pickup pool is real, and a money tier resolves through it, not the bullet cells', () => {
    // The score TIERS draw from the pickup atlas: their sprites resolve via
    // PICKUP_CELLS and would be rejected against the bullet cells alone. Prove the
    // pool is populated and that the split actually discriminates.
    expect(PICKUP_CELLS.size).toBeGreaterThan(0);
    const silver = { sprite: 'pickup.coin.silver', laser: false };
    expect(CELLS.has(silver.sprite)).toBe(false); // not a bullet cell
    expect(resolves(silver)).toBe(true); // but a real pickup cell
  });
});
