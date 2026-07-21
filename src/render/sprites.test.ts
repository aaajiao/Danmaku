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
import '../packs/bundled';
import { getShot, shotNames } from '../content/shots';
import { bossNames, getBossSpec } from '../sim/boss';
import { enemyNames, getEnemySpec } from '../sim/enemy';
import { getItemSpec, itemNames } from '../sim/item';
import { getOptionSpec, optionNames } from '../sim/option';
import { BULLET_CELLS } from './procedural';

/** The names a bullet-atlas draw may reference. Content uses no other region. */
const CELLS = new Set<string>(BULLET_CELLS);

/** Registered by a test rather than by the game. */
const isFixture = (name: string): boolean =>
  name.startsWith('test') || name.startsWith('probe.') || name.startsWith('balance.') ||
  name.includes('.test.');

const content = (names: readonly string[]): string[] => names.filter((n) => !isFixture(n));

/** A `{ where, sprite }` for every statically declared bullet-atlas sprite. */
function declaredSprites(): { where: string; sprite: string }[] {
  const out: { where: string; sprite: string }[] = [];

  for (const name of content(enemyNames())) {
    out.push({ where: `enemy ${name}`, sprite: getEnemySpec(name).sprite });
  }
  for (const name of content(bossNames())) {
    out.push({ where: `boss ${name}`, sprite: getBossSpec(name).sprite });
  }
  for (const name of content(itemNames())) {
    out.push({ where: `item ${name}`, sprite: getItemSpec(name).sprite });
  }
  for (const name of content(optionNames())) {
    const spec = getOptionSpec(name);
    out.push({ where: `option ${name}`, sprite: spec.sprite });
    out.push({ where: `option ${name} shot`, sprite: spec.shot.style.sprite });
  }
  for (const name of content(shotNames())) {
    getShot(name).levels.forEach((level, tier) => {
      out.push({ where: `shot ${name} tier ${tier}`, sprite: level.spec.style.sprite });
    });
  }

  return out;
}

describe('every declared sprite resolves to an atlas cell', () => {
  test('nothing names a cell the sheet does not contain', () => {
    const broken = declaredSprites().filter((d) => !CELLS.has(d.sprite));
    expect(broken).toEqual([]);
  });

  test('the guard can fail — a bad name is caught', () => {
    // The project's standard: a check nobody has seen reject anything is not
    // evidence. `orb.smal` is one keystroke from a real cell and resolves to
    // nothing, which is the whole failure this file exists to catch.
    const withTypo = [...declaredSprites(), { where: 'synthetic', sprite: 'orb.smal' }];
    const broken = withTypo.filter((d) => !CELLS.has(d.sprite));
    expect(broken).toEqual([{ where: 'synthetic', sprite: 'orb.smal' }]);
  });
});
