/** Fixed-tick lifecycle helpers for the view-only v4 Boss identity breakup. */

export interface BossIdentityFx<RunToken> {
  readonly run: RunToken;
  readonly strip: string;
  readonly x: number;
  readonly y: number;
  age: number;
}

/** Age every queued breakup and remove it exactly when its strip is exhausted. */
export function stepBossIdentityFx<RunToken>(
  queue: BossIdentityFx<RunToken>[],
  lifetimeOf: (strip: string) => number,
): void {
  for (let i = queue.length - 1; i >= 0; i--) {
    const identity = queue[i]!;
    identity.age++;
    if (identity.age >= lifetimeOf(identity.strip)) queue.splice(i, 1);
  }
}

/** A hidden Run keeps ageing, but can never leak its breakup into another Run. */
export function visibleBossIdentityFx<RunToken>(
  queue: readonly BossIdentityFx<RunToken>[],
  visibleRuns: ReadonlySet<RunToken>,
): BossIdentityFx<RunToken>[] {
  return queue.filter((identity) => visibleRuns.has(identity.run));
}
