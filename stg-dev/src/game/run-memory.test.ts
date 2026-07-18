import {describe, expect, it} from "vitest";
import sampleRunMemory from "../../../1bit-stg-complete-asset-kit-v4/manifests/narrative/sample-run-memory-v4.json";
import {
  LocalStorageRunMemoryAdapter,
  RunMemoryRecorder,
  parseRunMemory,
  validateRunMemory,
  type RunMemory,
  type SegmentBehaviorFact,
  type StorageLike,
} from "./run-memory";

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const facts: SegmentBehaviorFact[] = [
  {segmentId: "003.encounter", room: "INFORMATION", atTick: 12, eventId: "fact-room-enter", kind: "ROOM_ENTER"},
  {segmentId: "003.encounter", room: "INFORMATION", atTick: 13, eventId: "fact-room-dwell", kind: "ROOM_DWELL", amount: 1000},
  {segmentId: "003.encounter", room: "INFORMATION", atTick: 14, eventId: "fact-light-a", kind: "LIGHT_SAMPLE", amount: 0.25},
  {segmentId: "003.encounter", room: "INFORMATION", atTick: 15, eventId: "fact-light-b", kind: "LIGHT_SAMPLE", amount: 0.5},
  {segmentId: "003.encounter", room: "INFORMATION", atTick: 16, eventId: "fact-focus", kind: "FOCUS_DWELL", amount: 240},
  {segmentId: "003.encounter", room: "INFORMATION", atTick: 17, eventId: "fact-graze", kind: "GRAZE_EVIDENCE", sourceId: "bullet-17"},
  {segmentId: "003.encounter", room: "INFORMATION", atTick: 18, eventId: "fact-override", kind: "OVERRIDE_COMMIT", direction8: "SW"},
  {segmentId: "003.encounter", room: "INFORMATION", atTick: 19, eventId: "fact-ash", kind: "WEATHER_EXPOSURE", weather: "ASH", amount: 120},
];

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function createMemory(): RunMemory {
  const recorder = new RunMemoryRecorder({runId: "run-v4-test-0001", seed: 4088, startedAtTick: 10});
  for (const fact of facts) recorder.recordBehaviorFact(fact);
  recorder.recordGhostPoint({tMs: 0, xNorm: 0.1, yNorm: 0.8, room: "INFORMATION", flower: 0.25, focus: false, flags: ["ROOM_ENTER"]});
  recorder.recordGhostPoint({tMs: 60, xNorm: 0.2, yNorm: 0.7, room: "INFORMATION", flower: 0.4, focus: false, flags: ["GRAZE"]});
  recorder.recordGhostPoint({tMs: 120, xNorm: 0.3, yNorm: 0.65, room: "INFORMATION", flower: 0.5, focus: true, flags: []});
  recorder.recordGhostPoint({tMs: 240, xNorm: 0.8, yNorm: 0.5, room: "INFORMATION", flower: 0.75, focus: false, flags: ["OVERRIDE"]});
  recorder.addOverrideScar({
    id: "scar-1",
    position: {room: "INFORMATION", xNorm: 0.8, yNorm: 0.5},
    direction8: "SW",
    localVoidRadiusPx: 34,
    createdAtTick: 18,
    persistenceRuns: 2,
  });
  return recorder.finalize({
    endedAtTick: 70,
    durationMs: 1000,
    resolution: {reason: "PROTOCOL_WITHDRAWAL", bossId: null, factEventId: "fact-protocol-withdrawal"},
    observationIds: ["route.01"],
    behaviorTags: ["LOCAL_RESISTANCE", "MIDDLE_LIGHT"],
  });
}

describe("V4 run memory", () => {
  it("enforces the authoritative schema's 64-hex digest rule on the supplied sample", () => {
    // The V4 sample currently contains three 63-character digests; the schema requires 64.
    expect(validateRunMemory(sampleRunMemory).ok).toBe(false);
    const corrected = structuredClone(sampleRunMemory);
    corrected.ghostRoute.routeDigest += "0";
    corrected.materialMemory.burnIns[0]!.captureDigest += "0";
    corrected.materialMemory.ghostResidues[0]!.sourceRouteDigest += "0";
    expect(validateRunMemory(corrected)).toEqual({ok: true, errors: []});
  });

  it("reduces the same segment facts and route into identical serializable memory", async () => {
    const first = createMemory();
    const second = createMemory();
    expect(first).toEqual(second);
    expect(first.schemaVersion).toBe("4.0.0-run-memory");
    expect(first.metrics.focusDwellRatio).toBe(0.24);
    expect(first.metrics.uniqueBulletsGrazed).toBe(1);
    expect(first.metrics.overrideDirectionUniqueCount).toBe(1);
    expect(first.metrics.weatherExposureMs.ASH).toBe(120);
    expect(first.ghostRoute?.source).toBe("ACTUAL_PLAYER_ROUTE");
    expect(first.ghostRoute?.routeDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(first.ghostRoute?.collisionClass).toBe("NONE");
    expect(first.ghostRoute?.rewardClass).toBe("NONE");
    expect(first.materialMemory.overrideScars).toHaveLength(1);
    const fingerprintInput = {
      seed: 4088,
      facts,
      ghostRouteDigest: first.ghostRoute?.routeDigest ?? null,
      materialMemory: first.materialMemory,
      witnessMemory: first.witnessMemory,
      resolution: first.resolution,
    };
    const expectedBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(fingerprintInput)));
    const expectedDigest = Array.from(new Uint8Array(expectedBytes), (part) => part.toString(16).padStart(2, "0")).join("");
    expect(first.fingerprint.digestSha256).toBe(expectedDigest);
  });

  it("round-trips through an explicit storage adapter without import-time access", () => {
    const storage = new MemoryStorage();
    const adapter = new LocalStorageRunMemoryAdapter(storage, "test.run-memory");
    expect(storage.values.size).toBe(0);
    expect(adapter.load()).toBeNull();
    const memory = createMemory();
    adapter.save(memory);
    expect(adapter.load()).toEqual(memory);
    adapter.clear();
    expect(adapter.load()).toBeNull();
  });

  it("rejects malformed, corrupted, and schema-expanding data", () => {
    expect(() => parseRunMemory("{")) .toThrow(/malformed JSON/);
    const wrongVersion = {...createMemory(), schemaVersion: "5.0.0-run-memory"};
    expect(validateRunMemory(wrongVersion).ok).toBe(false);
    const alteredReplay = structuredClone(createMemory()) as unknown as Record<string, unknown>;
    const route = alteredReplay.ghostRoute as Record<string, unknown>;
    route.collisionClass = "PLAYER";
    expect(validateRunMemory(alteredReplay).ok).toBe(false);
    const expanded = {...createMemory(), score: 999};
    expect(validateRunMemory(expanded).ok).toBe(false);
  });

  it("keeps evaluative and moralized result semantics disabled", () => {
    const serialized = JSON.stringify(createMemory()).toLowerCase();
    for (const forbidden of ["score", "rank", "victory", "good", "bad"]) {
      expect(serialized).not.toContain(forbidden);
    }
    const recorder = new RunMemoryRecorder({runId: "run-v4-test-0002", seed: 8, startedAtTick: 0});
    expect(() => recorder.recordBehaviorFact({
      segmentId: "segment-1",
      room: "INFORMATION",
      atTick: 1,
      eventId: "score-rank",
      kind: "ROOM_ENTER",
    })).toThrow(/evaluative semantics/);
  });
});
