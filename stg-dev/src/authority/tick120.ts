/** Shared integer master-clock projection with no gameplay-module dependency. */
export const TICKS_PER_SECOND = 120 as const;

export function crossedTickCount(milliseconds: number): number {
  if (!Number.isFinite(milliseconds) || milliseconds < 0 || Object.is(milliseconds, -0)) {
    throw new Error("authored milliseconds must be finite and non-negative without negative zero");
  }
  const tick120 = Math.ceil(milliseconds * TICKS_PER_SECOND / 1000);
  if (!Number.isSafeInteger(tick120)) {
    throw new Error("authored milliseconds exceed safe tick120 identity");
  }
  return tick120;
}
