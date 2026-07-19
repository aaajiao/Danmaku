const RAW_RUN_SEED_UINT32_MAX = 0xffff_ffff;
const RAW_RUN_SEED_DECIMAL = /^\d+$/u;

/**
 * Resolves the browser adapter's raw Run seed without weakening an explicit
 * reproducibility request. This boundary does not accept or resolve encounter
 * seeds: absence may create a fresh raw Run seed, while a present query value
 * must be a decimal uint32 or startup fails closed.
 */
export function resolveRawRunSeed(
  requestedRawRunSeed: string | null,
  generateFreshRawRunSeed: () => number,
): number {
  if (requestedRawRunSeed === null) {
    const generatedRawRunSeed = generateFreshRawRunSeed();
    if (
      !Number.isSafeInteger(generatedRawRunSeed)
      || generatedRawRunSeed < 0
      || generatedRawRunSeed > RAW_RUN_SEED_UINT32_MAX
      || Object.is(generatedRawRunSeed, -0)
    ) {
      throw new Error("fresh raw Run seed generator must return a uint32");
    }
    return generatedRawRunSeed >>> 0;
  }

  if (!RAW_RUN_SEED_DECIMAL.test(requestedRawRunSeed)) {
    throw new Error("explicit raw Run seed must be a decimal uint32");
  }
  const parsedRawRunSeed = Number(requestedRawRunSeed);
  if (
    !Number.isSafeInteger(parsedRawRunSeed)
    || parsedRawRunSeed < 0
    || parsedRawRunSeed > RAW_RUN_SEED_UINT32_MAX
    || Object.is(parsedRawRunSeed, -0)
  ) {
    throw new Error("explicit raw Run seed must be a decimal uint32");
  }
  return parsedRawRunSeed >>> 0;
}
