const UINT32_MAX = 0xffff_ffff;
const DECIMAL_UINT = /^\d+$/u;

/**
 * Resolves the browser adapter's encounter seed without weakening an explicit
 * reproducibility request. Absence may create a fresh seed; a present query
 * value must be a decimal uint32 or startup fails closed.
 */
export function resolveEncounterSeed(
  requested: string | null,
  generateFreshSeed: () => number,
): number {
  if (requested === null) {
    const generated = generateFreshSeed();
    if (!Number.isSafeInteger(generated) || generated < 0 || generated > UINT32_MAX) {
      throw new Error("fresh encounter seed generator must return a uint32");
    }
    return generated >>> 0;
  }

  if (!DECIMAL_UINT.test(requested)) {
    throw new Error("explicit encounter seed must be a decimal uint32");
  }
  const parsed = Number(requested);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > UINT32_MAX) {
    throw new Error("explicit encounter seed must be a decimal uint32");
  }
  return parsed >>> 0;
}
