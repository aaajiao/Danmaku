/**
 * The difficulty tier, and how a pattern varies across tiers.
 *
 * Difficulty here is **not** a global multiplier. A "bullets ×1.5" would destroy
 * authored patterns — the negative space between bullets is designed, not scaled.
 * Instead a tier is a sparse, per-pattern override: `options` is the Normal truth,
 * and each tier that differs supplies only the fields it changes.
 *
 * This module is sim-side and pure so `content`, `sim` and `game` may all import
 * it — the type crosses no boundary the architecture test forbids, and the merge
 * touches no RNG stream and no trigonometry (rule 3 is satisfied trivially: there
 * is no float arithmetic here at all).
 */

/** The four tiers, in ascending order. A closed union — content names one of these. */
export type Difficulty = 'easy' | 'normal' | 'hard' | 'lunatic';

/**
 * The tiers, ascending. The order is meaningful: `easy < normal < hard < lunatic`
 * in density, and a UI or a test that walks the tiers reads them in this order.
 */
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard', 'lunatic'];

/** What a run is on when nothing selects otherwise. `options` alone is this tier. */
export const DEFAULT_DIFFICULTY: Difficulty = 'normal';

/**
 * A pattern's per-tier overrides. Only the tiers that differ from Normal appear,
 * and each names only the option fields it changes. A tier absent here means the
 * pattern fires its base `options` unchanged on that tier.
 */
export type DifficultyOverrides = Partial<Record<Difficulty, Record<string, unknown>>>;

/**
 * The Normal `options` merged with the override for `difficulty`, as a fresh object.
 *
 * **Shallow, one level deep.** A tier field replaces the base field *whole*; it is
 * not merged into it. `{ spec: A }` overridden by `{ spec: B }` yields `spec: B`
 * entirely — a tier that wants a different bullet declares the whole spec, and a
 * nested object is never partially patched. This is the documented, tested rule.
 *
 * **Never mutates `base`.** The base `options` object lives once in the registered
 * spec and is shared by every spawn of every instance of that enemy or boss for the
 * life of the process; writing to it would leak one tier's values into the next
 * spawn. A tier override therefore builds a new object; the no-override path returns
 * `base` itself, which is safe because patterns only ever read their options.
 *
 * Pure data selection: no RNG draw, no `Math`. The RNG *call order* still differs
 * across tiers — a larger `count` fires more bullets and so pulls more draws from
 * the `sim` stream — and that is correct, not a violation of CLAUDE.md **rule 2**
 * ("RNG is seeded, split by purpose, and order-sensitive"): two tiers are two
 * different runs by definition, which is exactly why the replay meta check on the
 * tier is strict. Rule 2 forbids *reordering the draws of one run*, not two runs
 * from the same seed diverging because they are not the same run.
 */
export function mergeOptions(
  base: Record<string, unknown> | undefined,
  overrides: DifficultyOverrides | undefined,
  difficulty: Difficulty,
): Record<string, unknown> | undefined {
  const tier = overrides?.[difficulty];
  if (tier === undefined) return base;
  return { ...base, ...tier };
}

/**
 * The indices of `phases` that exist on `difficulty`, in order.
 *
 * A card with no `difficulties` exists on every tier; one that lists tiers exists
 * only on those. This is how the genre ships Lunatic-only cards. The result is the
 * phase sequence a boss actually fights on the tier — `defineBoss` requires it to
 * be non-empty for every tier, or the boss would die unfought on the missing one.
 */
export function activePhaseIndices(
  phases: readonly { difficulties?: readonly Difficulty[] }[],
  difficulty: Difficulty,
): number[] {
  const active: number[] = [];
  for (let i = 0; i < phases.length; i++) {
    const gate = phases[i]?.difficulties;
    if (gate === undefined || gate.includes(difficulty)) active.push(i);
  }
  return active;
}
