import {describe, expect, it} from "vitest";
import runMemorySchema from "../../../1bit-stg-complete-asset-kit-v4/manifests/narrative/run-memory-v4.schema.json";
import sampleRunMemory from "../../../1bit-stg-complete-asset-kit-v4/manifests/narrative/sample-run-memory-v4.json";
import {CanonicalEventBus, type JsonObject} from "./events";
import {
  direction8FromVector,
  ghostSampleDueTick,
  RunMetricsCollector,
} from "./metrics";
import {
  GHOST_SAMPLE_INTERVAL_MS,
  validateRunMemory,
  type FinalizedRunMemory,
} from "./run-memory-model";
import {crossedTickCount, TICKS_PER_SECOND} from "./tick120";

const RUN_ID = "run-metrics-v4";
const SEED = 413;

function quantize(value: number): number {
  return Math.round(value * 1024) / 1024;
}

function transformX(tick: number): number {
  return ((tick * 37) % 101) / 101;
}

function transformY(tick: number): number {
  return ((tick * tick + 7) % 89) / 89;
}

function transformFlower(tick: number): number {
  return ((tick * 13) % 50) / 50;
}

function makeCollector(): {bus: CanonicalEventBus; collector: RunMetricsCollector} {
  const bus = new CanonicalEventBus();
  const collector = new RunMetricsCollector({
    runId: RUN_ID,
    seed: SEED,
    startedAtTick: 0,
    initialRoom: "INFORMATION",
    bus,
  });
  return {bus, collector};
}

interface ScriptedEvent {
  readonly id: string;
  readonly payload: JsonObject;
}

/**
 * Drive one collector through a fixed tape of canonical events, transforms,
 * and observe hooks; the exact same tape is reused for the determinism test.
 */
function runScriptedRun(): {collector: RunMetricsCollector; record: FinalizedRunMemory} {
  const {bus, collector} = makeCollector();

  const script = new Map<number, readonly ScriptedEvent[]>([
    [5, [{id: "flower.intensity.commit", payload: {source: "combat", targetIntensity: 0.2}}]],
    [10, [{id: "flower.intensity.commit", payload: {source: "combat", targetIntensity: 0.5}}]],
    [12, [{id: "gaze.acquire.begin", payload: {cycle: 1, clampAtMs: 500}}]],
    [20, [
      {id: "gaze.clamp.commit", payload: {cycle: 1, forcedIntensity: 0.75}},
      {id: "projectile.graze.commit", payload: {projectileId: "p-1", projectileGeneration: 1, playerId: "player", evidence: 1}},
    ]],
    [25, [{id: "projectile.graze.commit", payload: {projectileId: "p-2", projectileGeneration: 1, playerId: "player", evidence: 1}}]],
    [30, [{
      id: "player.override.local_void.open",
      payload: {cycle: 1, originX: 10, originY: 12, directionX: 1, directionY: 0, radius: 34, halfAngleDegrees: 60},
    }]],
    [35, [{id: "gaze.clamp.release", payload: {cycle: 1, releaseAttempt: 1}}]],
    [40, [{id: "evidence.consume.commit", payload: {amount: 2, total: 0, purposeKey: "override:1"}}]],
    [50, [{id: "weather.active.begin", payload: {weather: "RAIN", cycle: 1}}]],
    [60, [{id: "room.transition.world_swap.commit", payload: {generation: 1, fromRoom: "INFORMATION", toRoom: "IN_BETWEEN"}}]],
    [62, [{id: "room.transition.room_ready", payload: {generation: 1, room: "IN_BETWEEN"}}]],
    [70, [{id: "weather.aftermath.begin", payload: {weather: "RAIN", cycle: 1}}]],
    [72, [{id: "weather.complete", payload: {weather: "RAIN", cycle: 1}}]],
    [80, [{id: "player.damage.commit", payload: {amount: 1, healthAfter: 2, sourceId: "p-3", branch: "hit"}}]],
    [90, [{id: "boss.encounter.resolve", payload: {bossId: "no_dusk", generation: 1, outcome: "NO_DUSK_WITHDRAWAL", finalPhaseId: "phase-3"}}]],
    [95, [{id: "snapshot.present.begin", payload: {runId: RUN_ID, snapshotHash: "ab".repeat(32)}}]],
  ]);

  for (let tick = 0; tick <= 100; tick += 1) {
    const events = script.get(tick) ?? [];
    events.forEach((entry, index) => {
      bus.enqueue({
        id: entry.id,
        tick120: tick,
        entityStableId: "metrics-test",
        localSequence: index,
        occurrenceKey: `${entry.id}:${tick}`,
        payload: entry.payload,
      });
    });
    if (events.length > 0) bus.flush();
    collector.drainCanonicalEvents();
    collector.observePlayerTransform(tick, transformX(tick), transformY(tick), transformFlower(tick), tick % 7 === 0);
    if (tick < 100) collector.observeRoomTime(tick < 60 ? "INFORMATION" : "IN_BETWEEN", 1);
    if (tick === 15) {
      collector.observeFocusEntry();
      collector.observeFocusDwell(10);
    }
    if (tick === 40) collector.observeSeamDwell(12);
    if (tick === 45) collector.observeStableIntersectionDwell(24);
    if (tick === 46) collector.observeGazeStill(500);
    if (tick === 47) collector.observeIncompleteRead();
    if (tick === 48) collector.observeReadPredictionMismatchStreak(3);
    if (tick === 49) collector.observeCableUpload();
    if (tick === 51) collector.observeWitnessResistanceTransmission();
    if (tick === 52) collector.observeRoomThresholdCrossing();
    if (tick === 53) collector.observeOverrideScarRuleIntersection();
    if (tick >= 54 && tick <= 56) collector.observeMeaningfulInputEdge();
    if (tick === 57) {
      collector.observeOverrideScar({
        id: "override-void-1",
        position: {room: "INFORMATION", xNorm: 0.5, yNorm: 0.5},
        direction8: "E",
        localVoidRadiusPx: 34,
        createdAtTick: 30,
        persistenceRuns: 1,
      });
      collector.observeWitness({
        id: "wit-1",
        room: "INFORMATION",
        state: "RESONANT",
        facingTarget: null,
        sourceFactIds: ["projectile.graze.commit:20"],
      });
    }
  }

  const record = collector.finalize({
    endedAtTick: 100,
    resolution: {reason: "BODY_COLLAPSE", bossId: null, factEventId: "player.damage.commit:80"},
    observationIds: ["light.04"],
    behaviorTags: ["MIDDLE_LIGHT"],
  });
  return {collector, record};
}

describe("RunMetricsCollector schema completeness", () => {
  it("finalizes a record that validates and covers every schema metric path", () => {
    const {record} = runScriptedRun();
    expect(validateRunMemory(record)).toEqual({ok: true, errors: []});

    // Every top-level required path of run-memory-v4.schema.json is present.
    for (const key of runMemorySchema.required) {
      expect(record, `top-level ${key}`).toHaveProperty(key);
    }
    // The metric key set matches the schema exactly (no missing, no extra),
    // and the kit's sample fixture agrees on the same shape.
    const requiredMetricKeys = [...runMemorySchema.properties.metrics.required].sort();
    expect(Object.keys(record.metrics).sort()).toEqual(requiredMetricKeys);
    expect(Object.keys(record.metrics).sort()).toEqual(Object.keys(sampleRunMemory.metrics).sort());
    expect(Object.keys(record.metrics.roomTimeMs).sort())
      .toEqual([...runMemorySchema.properties.metrics.properties.roomTimeMs.required].sort());
    expect(Object.keys(record.metrics.weatherExposureMs).sort())
      .toEqual([...runMemorySchema.properties.metrics.properties.weatherExposureMs.required].sort());
  });

  it("populates every observed dimension with the honest event-derived value", () => {
    const {collector, record} = runScriptedRun();
    const metrics = record.metrics;
    const durationMs = Math.round(100 * 1000 / TICKS_PER_SECOND);
    expect(record.run.durationMs).toBe(durationMs);
    expect(record.run.roomsVisited).toEqual(["INFORMATION", "IN_BETWEEN"]);

    expect(metrics.meanLight).toBeCloseTo(0.35, 12);
    expect(metrics.quietLightRatio).toBe(0.5);
    expect(metrics.middleLightRatio).toBe(0.5);
    expect(metrics.loudLightRatio).toBe(0);
    expect(metrics.lightBandChanges).toBe(1);
    expect(metrics.gazeClampCount).toBe(1);
    expect(metrics.gazeAcquireCount).toBe(1);
    expect(metrics.gazeStillMaxMs).toBe(500);
    // Gaze clamp held ticks 20..35: 15 gameplay ticks = 125ms exactly.
    expect(metrics.gazeRatio).toBe(125 / durationMs);
    expect(metrics.incompleteReads).toBe(1);
    expect(metrics.readPredictionMismatchStreak).toBe(3);
    expect(metrics.focusDwellRatio).toBe(Math.round(10 * 1000 / TICKS_PER_SECOND) / durationMs);
    expect(metrics.focusEntryCount).toBe(1);
    expect(metrics.focusReleaseBeforeImpactCount).toBe(0);
    expect(metrics.grazeEvidenceCount).toBe(2);
    expect(metrics.grazeEvidenceSpent).toBe(2);
    expect(metrics.uniqueBulletsGrazed).toBe(2);
    expect(metrics.overrideCount).toBe(1);
    expect(metrics.overrideDirectionUniqueCount).toBe(1);
    expect(metrics.overrideDuringGazeCount).toBe(1);
    expect(metrics.overrideScarRuleIntersections).toBe(1);
    expect(metrics.witnessResistanceTransmissionCount).toBe(1);
    expect(metrics.damageCount).toBe(1);
    expect(metrics.seamDwellRatio).toBe(Math.round(12 * 1000 / TICKS_PER_SECOND) / durationMs);
    expect(metrics.seamCrossings).toBe(1);
    expect(metrics.fallResetCount).toBe(0);
    expect(metrics.stableIntersectionDwellMs).toBe(Math.round(24 * 1000 / TICKS_PER_SECOND));
    expect(metrics.distinctRoomsVisited).toBe(2);
    expect(metrics.roomReentries).toBe(0);
    expect(metrics.roomThresholdCrossings).toBe(1);
    expect(metrics.dominantRoom).toBe("INFORMATION");
    expect(metrics.cableUploadEvents).toBe(1);
    expect(metrics.snapshotEchoCount).toBe(1);
    expect(metrics.witnessesTurnedDuringEclipse).toBe(0);
    expect(metrics.noDuskCycles).toBe(1);
    expect(metrics.roomTimeMs).toEqual({
      INFORMATION: Math.round(60 * 1000 / TICKS_PER_SECOND),
      FORCED_ALIGNMENT: 0,
      IN_BETWEEN: Math.round(40 * 1000 / TICKS_PER_SECOND),
      POLARIZED: 0,
    });
    expect(metrics.weatherExposureMs).toEqual({
      STATIC: 0,
      RAIN: Math.round(20 * 1000 / TICKS_PER_SECOND),
      ASH: 0,
      WIND: 0,
      ECLIPSE: 0,
    });

    expect(record.materialMemory.overrideScars).toHaveLength(1);
    expect(record.witnessMemory).toHaveLength(1);
    expect(record.ghostRoute).not.toBeNull();
    expect(record.snapshot).toEqual({observationIds: ["light.04"], behaviorTags: ["MIDDLE_LIGHT"]});
    expect(collector.meaningfulInputEdgeCount()).toBe(3);
  });
});

describe("RunMetricsCollector determinism", () => {
  it("produces a deep-equal record for the same event and observation tape", () => {
    const first = runScriptedRun().record;
    const second = runScriptedRun().record;
    expect(second).toEqual(first);
    expect(second.fingerprint.digestSha256).toBe(first.fingerprint.digestSha256);
    expect(second.ghostRoute?.routeDigest).toBe(first.ghostRoute?.routeDigest);
  });
});

describe("ghost sampling cadence", () => {
  it("derives its due-tick schedule from crossedTickCount round-up", () => {
    // 120ms at 120Hz is 14.4 ticks; the integer schedule is the ceiling of
    // n * 14.4 because a sample becomes due on the first tick whose boundary
    // has crossed the 120ms grid instant (never on a fractional tick).
    expect(Array.from({length: 11}, (_, index) => ghostSampleDueTick(index)))
      .toEqual([0, 15, 29, 44, 58, 72, 87, 101, 116, 130, 144]);
    for (let index = 0; index <= 200; index += 1) {
      const dueTick = ghostSampleDueTick(index);
      expect(dueTick).toBe(crossedTickCount(index * GHOST_SAMPLE_INTERVAL_MS));
      expect(dueTick).toBe(Math.ceil(index * GHOST_SAMPLE_INTERVAL_MS * TICKS_PER_SECOND / 1000));
    }
  });

  it("samples exactly on the due-tick schedule with nominal 120ms grid tMs", () => {
    const {collector} = makeCollector();
    for (let tick = 0; tick <= 150; tick += 1) {
      collector.observePlayerTransform(tick, transformX(tick), transformY(tick), transformFlower(tick), false);
    }
    const record = collector.finalize({
      endedAtTick: 150,
      resolution: {reason: "BODY_COLLAPSE", bossId: null, factEventId: "cadence-end"},
    });
    const route = record.ghostRoute;
    if (route === null) throw new Error("cadence run must produce a route");
    // Ticks 0..150 cross grid instants 0ms..1200ms (due ticks 0..144); the
    // eleventh sample would be due at tick ceil(11 * 14.4) = 159 > 150.
    expect(route.points.map((point) => point.tMs))
      .toEqual(Array.from({length: 11}, (_, index) => index * GHOST_SAMPLE_INTERVAL_MS));
    // The sample recorded for grid instant n*120ms is captured at the round-up
    // tick, so its transform is the one observed at that exact integer tick.
    const atGrid120 = route.points[1];
    const atGrid240 = route.points[2];
    expect(atGrid120?.xNorm).toBe(quantize(transformX(15)));
    expect(atGrid240?.xNorm).toBe(quantize(transformX(29)));
    // The run's first sample carries the initial-room entry pin.
    expect(route.points[0]?.flags).toEqual(["ROOM_ENTER"]);
  });
});

describe("ghost event pins", () => {
  it("pins GRAZE and DAMAGE points at rounded event tMs between grid samples", () => {
    const {bus, collector} = makeCollector();
    for (let tick = 0; tick <= 30; tick += 1) {
      if (tick === 20) {
        bus.enqueue({
          id: "projectile.graze.commit",
          tick120: 20,
          entityStableId: "metrics-test",
          localSequence: 0,
          occurrenceKey: "projectile.graze.commit:20",
          payload: {projectileId: "p-1", projectileGeneration: 1, playerId: "player", evidence: 1},
        });
        bus.flush();
      }
      if (tick === 25) {
        bus.enqueue({
          id: "player.damage.commit",
          tick120: 25,
          entityStableId: "metrics-test",
          localSequence: 0,
          occurrenceKey: "player.damage.commit:25",
          payload: {amount: 1, healthAfter: 2, sourceId: "p-1", branch: "hit"},
        });
        bus.flush();
      }
      collector.drainCanonicalEvents();
      collector.observePlayerTransform(tick, transformX(tick), transformY(tick), transformFlower(tick), false);
    }
    const record = collector.finalize({
      endedAtTick: 30,
      resolution: {reason: "BODY_COLLAPSE", bossId: null, factEventId: "player.damage.commit:25"},
    });
    const route = record.ghostRoute;
    if (route === null) throw new Error("pin run must produce a route");
    // Grid samples at 0/120/240 plus pins at round(20*25/3)=167 and
    // round(25*25/3)=208, strictly increasing.
    expect(route.points.map((point) => point.tMs)).toEqual([0, 120, 167, 208, 240]);
    expect(route.points.find((point) => point.tMs === 167)?.flags).toEqual(["GRAZE"]);
    expect(route.points.find((point) => point.tMs === 208)?.flags).toEqual(["DAMAGE"]);
    // The pin is placed at the last authoritative transform before the event
    // was drained (the tape drains events before observing that tick).
    expect(route.points.find((point) => point.tMs === 167)?.xNorm).toBe(quantize(transformX(19)));
  });

  it("merges a pin landing exactly on a grid sample into one point", () => {
    const {bus, collector} = makeCollector();
    for (let tick = 0; tick <= 80; tick += 1) {
      if (tick === 72) {
        // Gameplay tick 72 is exactly 600ms: both the pin and grid sample n=5.
        bus.enqueue({
          id: "gaze.clamp.commit",
          tick120: 72,
          entityStableId: "metrics-test",
          localSequence: 0,
          occurrenceKey: "gaze.clamp.commit:72",
          payload: {cycle: 1, forcedIntensity: 0.75},
        });
        bus.flush();
      }
      collector.drainCanonicalEvents();
      collector.observePlayerTransform(tick, transformX(tick), transformY(tick), transformFlower(tick), false);
    }
    const record = collector.finalize({
      endedAtTick: 80,
      resolution: {reason: "BODY_COLLAPSE", bossId: null, factEventId: "gaze.clamp.commit:72"},
    });
    const route = record.ghostRoute;
    if (route === null) throw new Error("merge run must produce a route");
    expect(route.points.map((point) => point.tMs)).toEqual([0, 120, 240, 360, 480, 600]);
    const merged = route.points.find((point) => point.tMs === 600);
    expect(merged?.flags).toEqual(["GAZE"]);
    // The grid capture at the due tick refreshes the merged point's transform.
    expect(merged?.xNorm).toBe(quantize(transformX(72)));
  });

  it("attaches pins observed before any transform to the first sample", () => {
    const {bus, collector} = makeCollector();
    bus.enqueue({
      id: "projectile.graze.commit",
      tick120: 0,
      entityStableId: "metrics-test",
      localSequence: 0,
      occurrenceKey: "projectile.graze.commit:0",
      payload: {projectileId: "p-0", projectileGeneration: 1, playerId: "player", evidence: 1},
    });
    bus.flush();
    collector.drainCanonicalEvents();
    for (let tick = 0; tick <= 20; tick += 1) {
      collector.observePlayerTransform(tick, transformX(tick), transformY(tick), transformFlower(tick), false);
    }
    const record = collector.finalize({
      endedAtTick: 20,
      resolution: {reason: "BODY_COLLAPSE", bossId: null, factEventId: "projectile.graze.commit:0"},
    });
    const first = record.ghostRoute?.points[0];
    expect(first?.tMs).toBe(0);
    expect([...(first?.flags ?? [])].sort()).toEqual(["GRAZE", "ROOM_ENTER"]);
  });
});

describe("direction octants", () => {
  it("maps authority direction vectors onto the 8 scar octants (y-down)", () => {
    expect(direction8FromVector(1, 0)).toBe("E");
    expect(direction8FromVector(1, 1)).toBe("SE");
    expect(direction8FromVector(0, 1)).toBe("S");
    expect(direction8FromVector(-1, 1)).toBe("SW");
    expect(direction8FromVector(-1, 0)).toBe("W");
    expect(direction8FromVector(-1, -1)).toBe("NW");
    expect(direction8FromVector(0, -1)).toBe("N");
    expect(direction8FromVector(1, -1)).toBe("NE");
    expect(() => direction8FromVector(0, 0)).toThrow();
  });
});

describe("fail-closed construction and ingestion", () => {
  it("rejects non-exact buses and unknown initial rooms", () => {
    expect(() => new RunMetricsCollector({
      runId: RUN_ID,
      seed: SEED,
      startedAtTick: 0,
      initialRoom: "INFORMATION",
      bus: {} as never,
    })).toThrow(/exact CanonicalEventBus/);
    expect(() => new RunMetricsCollector({
      runId: RUN_ID,
      seed: SEED,
      startedAtTick: 0,
      initialRoom: "LOBBY" as never,
      bus: new CanonicalEventBus(),
    })).toThrow(/room id/);
  });

  it("fails closed on out-of-contract payload values", () => {
    const cases: readonly {id: string; payload: JsonObject; message: RegExp}[] = [
      {id: "flower.intensity.commit", payload: {source: "combat", targetIntensity: 1.5}, message: /ratio/},
      {id: "room.transition.room_ready", payload: {generation: 1, room: "NOWHERE"}, message: /room id/},
      {id: "weather.active.begin", payload: {weather: "SNOW", cycle: 1}, message: /weather class/},
      {
        id: "room.transition.world_swap.commit",
        payload: {generation: 1, fromRoom: "POLARIZED", toRoom: "IN_BETWEEN"},
        message: /diverges from observed room/,
      },
    ];
    for (const testCase of cases) {
      const {bus, collector} = makeCollector();
      bus.enqueue({
        id: testCase.id,
        tick120: 1,
        entityStableId: "metrics-test",
        localSequence: 0,
        occurrenceKey: `${testCase.id}:1`,
        payload: testCase.payload,
      });
      bus.flush();
      expect(() => collector.drainCanonicalEvents()).toThrow(testCase.message);
    }
  });

  it("rejects invalid observations and post-finalize use", () => {
    const {collector} = makeCollector();
    expect(() => collector.observeRoomTime("INFORMATION", 0)).toThrow(/positive integer/);
    expect(() => collector.observeRoomTime("INFORMATION", -3)).toThrow();
    expect(() => collector.observePlayerTransform(0, 2, 0.5, 0.5, false)).toThrow(/ratio/);
    collector.observePlayerTransform(5, 0.5, 0.5, 0.5, false);
    expect(() => collector.observePlayerTransform(4, 0.5, 0.5, 0.5, false)).toThrow(/non-decreasing/);
    const record = collector.finalize({
      endedAtTick: 10,
      resolution: {reason: "BODY_COLLAPSE", bossId: null, factEventId: "fact-end"},
    });
    expect(record.ghostRoute).toBeNull();
    expect(() => collector.drainCanonicalEvents()).toThrow(/finalized/);
    expect(() => collector.observeMeaningfulInputEdge()).toThrow(/finalized/);
    expect(() => collector.finalize({
      endedAtTick: 11,
      resolution: {reason: "BODY_COLLAPSE", bossId: null, factEventId: "fact-end"},
    })).toThrow(/finalized/);
  });
});
