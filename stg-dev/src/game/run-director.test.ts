import {describe, expect, it} from "vitest";
import patternsManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/executable-patterns-v4.json";
import composersManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/room-composers-v4.json";
import bossesManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/boss-rigs-v4.json";
import {
  RunDirector,
  type BossRigManifest,
  type RoomComposerManifest,
} from "./run-director";
import type {PatternDefinition} from "./types";

const patterns = patternsManifest.patterns as PatternDefinition[];
const composers = composersManifest as RoomComposerManifest;
const bosses = bossesManifest as BossRigManifest;

function create(seed: number): RunDirector {
  return new RunDirector({seed, patterns, composers, bosses});
}

describe("V4 deterministic run director", () => {
  it("creates an identical schedule from identical seed and ledger", () => {
    expect(create(4088).schedule).toEqual(create(4088).schedule);
  });

  it("changes sampling for a different seed without changing invariants", () => {
    const first = create(4088);
    const second = create(4099);
    expect(first.schedule.map((segment) => segment.patternId)).not.toEqual(
      second.schedule.map((segment) => segment.patternId),
    );
    for (const director of [first, second]) {
      expect(director.schedule[0]?.kind).toBe("AWAKENING");
      expect(director.schedule.at(-2)?.kind).toBe("SNAPSHOT");
      expect(director.schedule.at(-1)?.kind).toBe("CROSS_RUN");
      expect(new Set(director.schedule.map((segment) => segment.bossId).filter(Boolean)).size).toBeLessThanOrEqual(2);
      expect(director.schedule.reduce((sum, segment) => sum + segment.durationMs, 0)).toBeGreaterThanOrEqual(240000);
    }
  });

  it("only references canonical V4 patterns and keeps material rest windows", () => {
    const ids = new Set(patterns.map((pattern) => pattern.id));
    const schedule = create(13).schedule;
    for (const segment of schedule) {
      if (segment.patternId) expect(ids.has(segment.patternId)).toBe(true);
    }
    const encounters = schedule.filter((segment) => segment.kind === "ENCOUNTER");
    expect(encounters.length).toBeGreaterThan(0);
    expect(schedule.filter((segment) => segment.kind === "REST").length).toBeGreaterThanOrEqual(encounters.length);
  });

  it("holds awakening until two meaningful inputs have occurred", () => {
    const director = create(1);
    director.step(9000, {evidence: 0, meaningfulInput: false});
    expect(director.snapshot().segment.kind).toBe("AWAKENING");
    director.step(1, {evidence: 0, meaningfulInput: true});
    director.step(1, {evidence: 0, meaningfulInput: true});
    expect(director.snapshot().segment.kind).toBe("FIRST_EYE");
  });

  it("skips the local Override gate when evidence is not available", () => {
    const director = create(23);
    let guard = 0;
    while (!director.snapshot().complete && guard < 1000) {
      const segment = director.snapshot().segment;
      director.step(Math.max(1, segment.durationMs + 1), {
        evidence: 0,
        meaningfulInput: true,
      });
      guard += 1;
    }
    expect(director.snapshot().complete).toBe(true);
    expect(guard).toBeLessThan(1000);
  });

  it("never introduces score, rank, victory, or moralized ending semantics", () => {
    const serialized = JSON.stringify(create(77).schedule).toLowerCase();
    for (const forbidden of ["score", "rank", "victory", "good_end", "bad_end"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
