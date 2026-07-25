/** Fixed-tick lifecycle helpers for the exact, view-only v4 Boss phase declarations. */

export interface BossCastFx<RunToken> {
  readonly run: RunToken;
  readonly bossName: string;
  readonly strip: string;
  age: number;
}

/** Age every declaration and remove it exactly when its own strip is exhausted. */
export function stepBossCastFx<RunToken>(
  queue: BossCastFx<RunToken>[],
  lifetimeOf: (strip: string) => number,
): void {
  for (let i = queue.length - 1; i >= 0; i--) {
    const cast = queue[i]!;
    cast.age++;
    if (cast.age >= lifetimeOf(cast.strip)) queue.splice(i, 1);
  }
}

/**
 * Select only declarations belonging to the Boss currently drawn for this Run.
 *
 * The position deliberately does not live in the queue: `main.ts` resolves the
 * active Boss body every render, so a declaration follows authored movement
 * without writing any presentation state back into the simulation.
 */
export function visibleBossCastFx<RunToken>(
  queue: readonly BossCastFx<RunToken>[],
  run: RunToken,
  bossName: string,
): BossCastFx<RunToken>[] {
  return queue.filter((cast) => cast.run === run && cast.bossName === bossName);
}
