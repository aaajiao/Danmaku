import {describe, expect, it, vi} from "vitest";
import {resolveRawRunSeed} from "./run-seed";

describe("raw Run seed boundary", () => {
  it("accepts the complete decimal uint32 range without consulting entropy", () => {
    const generateFreshRawRunSeed = vi.fn(() => 99);

    expect(resolveRawRunSeed("0", generateFreshRawRunSeed)).toBe(0);
    expect(resolveRawRunSeed("305419896", generateFreshRawRunSeed)).toBe(0x1234_5678);
    expect(resolveRawRunSeed("4294967295", generateFreshRawRunSeed)).toBe(0xffff_ffff);
    expect(generateFreshRawRunSeed).not.toHaveBeenCalled();
  });

  it.each(["", " ", "-1", "+1", "0x10", "1e3", "1.5", "4294967296", "NaN"])(
    "fails closed for the explicit raw Run seed %j",
    (requestedRawRunSeed) => {
      const generateFreshRawRunSeed = vi.fn(() => 7);

      expect(() => resolveRawRunSeed(requestedRawRunSeed, generateFreshRawRunSeed))
        .toThrow(/explicit raw Run seed must be a decimal uint32/);
      expect(generateFreshRawRunSeed).not.toHaveBeenCalled();
    },
  );

  it("uses and validates entropy only when no raw Run seed was requested", () => {
    expect(resolveRawRunSeed(null, () => 0x89ab_cdef)).toBe(0x89ab_cdef);
    expect(() => resolveRawRunSeed(null, () => -1))
      .toThrow(/fresh raw Run seed generator must return a uint32/);
    expect(() => resolveRawRunSeed(null, () => -0))
      .toThrow(/fresh raw Run seed generator must return a uint32/);
    expect(() => resolveRawRunSeed(null, () => 0x1_0000_0000))
      .toThrow(/fresh raw Run seed generator must return a uint32/);
  });
});
