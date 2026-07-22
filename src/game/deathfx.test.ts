/**
 * The death-explosion tier table, pinned by its two couplings.
 *
 * `deathfx.ts` names fx by string and derives a tier from a spec it does not own,
 * so two invariants have to hold or a real death breaks silently:
 *
 *  1. Every name in `TIER_BOOMS` is a REGISTERED effect — otherwise the death site
 *     that emits it throws `unknown effect` the first frame that tier dies (the
 *     never-blocked floor, rule 9). Total over the effect registry.
 *  2. `enemyDeathTier` is TOTAL — it returns `'trash'` or `'elite'` and nothing
 *     else, reading only the authored `onDeath` marker. `death.big` is elite; every
 *     other value, and none at all, is trash.
 *
 * PURE by construction: this is a `src/game` file, and the import boundary is total
 * — it may not import `src/packs`, so it cannot drive the injected base campaign
 * (that is the ROOT-level `reachability.test.ts`'s job, which proves `boom.elite`
 * is actually emitted by a real elite death, i.e. that the base campaign ships one).
 * Here the function's whole contract is exercised against synthetic specs, and the
 * table against the engine effect registry, neither of which needs the base pack.
 */

import { describe, expect, test } from 'bun:test';

import { TIER_BOOMS, enemyDeathTier, type DeathTier } from './deathfx';
import { effectNames } from '../sim/effects';
import type { EnemySpec } from '../sim/enemy';

/** A minimal valid `EnemySpec` carrying just the `onDeath` under test. */
const withOnDeath = (onDeath?: string): EnemySpec => ({
  sprite: 'orb.small',
  hp: 10,
  radius: 8,
  onDeath,
});

describe('TIER_BOOMS names only registered effects', () => {
  const registered = new Set(effectNames());
  const named = [...new Set(Object.values(TIER_BOOMS).flat())];

  test.each(named)('%s is a registered effect', (name) => {
    // A tier naming an unregistered effect throws `unknown effect` at the death
    // site the first frame that tier dies. Emitting is fx-stream, so it never
    // shows in the golden — this test is the only thing that catches it headlessly.
    expect(`${name} registered: ${registered.has(name)}`).toBe(`${name} registered: true`);
  });

  test('every tier is present and non-empty', () => {
    const tiers: DeathTier[] = ['trash', 'elite', 'boss', 'player'];
    for (const tier of tiers) {
      expect(TIER_BOOMS[tier].length).toBeGreaterThan(0);
    }
  });

  test('the boss stack keeps its layered draw order (back plate first, embers last)', () => {
    // The occluding back plate must be named BEFORE the bright core, and the
    // embers last — the order the death site emits, so the layering reads as
    // authored even before the Layer split routes the plate under.
    expect(TIER_BOOMS.boss).toEqual(['boom.boss.back', 'burst.big', 'boom.boss.top', 'debris']);
  });

  test('burst and burst.big are kept — retasked into a tier, not retired', () => {
    const named = new Set(Object.values(TIER_BOOMS).flat());
    expect(named.has('burst')).toBe(true); // still the trash flash
    expect(named.has('burst.big')).toBe(true); // retasked as the boss core
  });
});

describe('enemyDeathTier reads authored intent, and is total', () => {
  test('onDeath "death.big" is the one elite marker', () => {
    expect(enemyDeathTier(withOnDeath('death.big'))).toBe('elite');
  });

  test('every other onDeath, and none at all, is trash', () => {
    const others = [undefined, 'explosion', 'burst', 'hit', 'death.small', 'DEATH.BIG', ''];
    for (const value of others) {
      expect(`${value} → ${enemyDeathTier(withOnDeath(value))}`).toBe(`${value} → trash`);
    }
  });

  test('the classification is total — trash or elite, never a third answer or a throw', () => {
    const bad: string[] = [];
    for (const value of [undefined, 'death.big', 'anything', 'x']) {
      const tier = enemyDeathTier(withOnDeath(value));
      if (tier !== 'trash' && tier !== 'elite') bad.push(`${value} → ${tier}`);
    }
    expect(bad).toEqual([]);
  });
});
