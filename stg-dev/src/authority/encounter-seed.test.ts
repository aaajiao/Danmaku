import {describe, expect, it, vi} from "vitest";
import {resolveEncounterSeed} from "./encounter-seed";

describe("canonical encounter seed boundary", () => {
  it("accepts the complete decimal uint32 range without consulting entropy", () => {
    const generate = vi.fn(() => 99);

    expect(resolveEncounterSeed("0", generate)).toBe(0);
    expect(resolveEncounterSeed("305419896", generate)).toBe(0x1234_5678);
    expect(resolveEncounterSeed("4294967295", generate)).toBe(0xffff_ffff);
    expect(generate).not.toHaveBeenCalled();
  });

  it.each(["", " ", "-1", "+1", "0x10", "1e3", "1.5", "4294967296", "NaN"])(
    "fails closed for the explicit seed %j",
    (requested) => {
      const generate = vi.fn(() => 7);

      expect(() => resolveEncounterSeed(requested, generate)).toThrow(/decimal uint32/);
      expect(generate).not.toHaveBeenCalled();
    },
  );

  it("uses and validates entropy only when no seed was requested", () => {
    expect(resolveEncounterSeed(null, () => 0x89ab_cdef)).toBe(0x89ab_cdef);
    expect(() => resolveEncounterSeed(null, () => -1)).toThrow(/generator.*uint32/);
    expect(() => resolveEncounterSeed(null, () => 0x1_0000_0000)).toThrow(/generator.*uint32/);
  });
});
