import {describe, expect, it} from "vitest";
import manifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/executable-patterns-v4.json";
import {compileBurst, mulberry32, sampleEnvelope} from "./pattern-compiler";
import type {PatternDefinition} from "./types";

const patterns = manifest.patterns as PatternDefinition[];

describe("manifest-driven pattern compiler", () => {
  it("compiles every emitter to finite deterministic candidates", () => {
    for (const pattern of patterns) {
      for (const emitter of pattern.emitters) {
        const first = compileBurst(pattern, emitter, 0, "NORMAL", {x: 0, y: -220}, 0);
        const second = compileBurst(pattern, emitter, 0, "NORMAL", {x: 0, y: -220}, 0);
        expect(first).toEqual(second);
        expect(first.length).toBeLessThanOrEqual(emitter.geometry.count);
        for (const candidate of first) {
          expect(Number.isFinite(candidate.position.x)).toBe(true);
          expect(Number.isFinite(candidate.position.y)).toBe(true);
          expect(Number.isFinite(candidate.velocity.x)).toBe(true);
          expect(Number.isFinite(candidate.velocity.y)).toBe(true);
          expect(candidate.speed).toBeGreaterThan(0);
        }
      }
    }
  });

  it("uses a stable Mulberry32 trace", () => {
    const first = mulberry32(0x1b17);
    const second = mulberry32(0x1b17);
    const traceA = Array.from({length: 8}, () => first());
    const traceB = Array.from({length: 8}, () => second());
    expect(traceA).toEqual(traceB);
    expect(new Set(traceA).size).toBe(8);
  });

  it("samples step and linear speed envelopes", () => {
    const keys = [
      {atMs: 0, multiplier: 1},
      {atMs: 1000, multiplier: 0},
    ];
    expect(sampleEnvelope(keys, 500, "step")).toBe(1);
    expect(sampleEnvelope(keys, 500, "linear")).toBeCloseTo(0.5);
    expect(sampleEnvelope(keys, 1200, "linear")).toBe(0);
  });
});
