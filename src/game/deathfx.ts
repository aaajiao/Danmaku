/**
 * The death-explosion tier system (战役扩容轮).
 *
 * A death is not one flash for everything: a trash grunt pops, an elite blooms
 * a layered mid-tier burst, a boss detonates a stacked blast (an occluding back
 * plate, a bright core, a top flash, embers), and the player's own death is its
 * own explosion. This table names the fx each tier emits, in draw order where a
 * tier layers; `run.ts` reads it at the three death sites (enemy / boss / player)
 * and emits the set.
 *
 * ## Why this is game-layer, and `import type` only
 *
 * The tier is *derived* from a signal content already authors — `EnemySpec.onDeath`
 * — never from a new content field and never from an hp threshold (the balance
 * doctrine's "a tuning constant no test can measure drifts away from the thing it
 * describes"). So the rule is a pure function over the spec, and the only thing it
 * borrows from `sim/` is the `EnemySpec` *type*. The import is type-only, so this
 * module drags no simulation runtime into the render/composition seam and stays
 * headlessly testable. It names fx by string; the effects themselves are
 * registered in `sim/effects.ts` and their floors painted in `render/procedural.ts`
 * — this file scripts no new rule, it only routes.
 *
 * ## fx-stream, trace-neutral
 *
 * Every name here is emitted through `EffectSystem.emit`, which draws exclusively
 * from the `fx` stream and never feeds the simulation (CLAUDE.md rule 2). Routing
 * a death through a bigger set of booms therefore moves no `sim` draw and changes
 * no replay — the golden trace is byte-identical whether a kill pops one flash or
 * four. That is the property that let this land without a replay re-record.
 */

import type { EnemySpec } from '../sim/enemy';

/** The four death weights a kill can carry. */
export type DeathTier = 'trash' | 'elite' | 'boss' | 'player';

/**
 * The fx names each tier emits, in draw order (back → front where a tier layers).
 *
 * - `trash` keeps the single `burst` floor flash — nothing is retired, the trash
 *   death is exactly what it was.
 * - `elite` blooms the mid-tier pair (`New_expmid` + `New_Mid_Exp_particles`),
 *   replacing the plain flash with something that reads as a heavier kill.
 * - `boss` stacks four: an occluding **back plate** (`boom.boss.back`, the only
 *   non-additive fx here — it must read as a dark billow *under* the flash, which
 *   additive light cannot do), the retasked `burst.big` as the bright **core**, a
 *   `boom.boss.top` additive detail over it, and `debris` embers. The plate draws
 *   at `Layer.BurstsBack` (under `Layer.Bursts`); `main.ts` routes it by
 *   `spec.additive === false`, not by a hardcoded name.
 * - `player` is the pilot's own explosion (`New_Player_Explosion`) plus embers.
 *
 * `burst`/`burst.big` are KEPT and retasked, never retired: `burst` stays the
 * trash flash and `burst.big` becomes the boss core, so every previously-registered
 * effect still fires at a reachable site.
 */
export const TIER_BOOMS: Record<DeathTier, readonly string[]> = {
  trash: ['burst'],
  elite: ['boom.elite', 'boom.elite.spray'],
  boss: ['boom.boss.back', 'burst.big', 'boom.boss.top', 'debris'],
  player: ['boom.player', 'debris'],
};

/**
 * An enemy's death-weight class, read from the spec it already authors.
 *
 * `onDeath: 'death.big'` is the authored heavy-death marker. It is carried by
 * exactly two ENEMIES — the two highest-hp trash (turret, bastion) — and by every
 * boss; bosses route through the boss-death site, not this function, so among
 * enemies the elite tier is precisely those two. We read the authored *intent*,
 * not a magic `hp >= N` that `balance.test.ts` could silently shift under us.
 *
 * A first-class `EnemySpec.deathTier` field is deliberately NOT added: it would
 * duplicate a signal `onDeath` already carries and force every pack author to set
 * two correlated fields. `deathfx.test.ts` proves this function is TOTAL over every
 * base-pack `onDeath` value — a future enemy authoring a novel `onDeath` fails there,
 * where the content lives, not silently here.
 */
export function enemyDeathTier(spec: EnemySpec): 'trash' | 'elite' {
  return spec.onDeath === 'death.big' ? 'elite' : 'trash';
}
