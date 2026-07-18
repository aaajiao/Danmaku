import {describe, expect, it} from "vitest";
import directorReportJson from "../../../1bit-stg-complete-asset-kit-v4/gameplay/reports/director-determinism-report-v4.json";
import {
  composeV4RunComposerPlan,
  deriveV4QaIntensityTier,
  pickV4QaPatternCandidate,
  validateV4RunComposerMetrics,
  V4_RUN_COMPOSER_CONTRACT,
  V4_RUN_COMPOSER_METRIC_IDS,
  type V4RunComposerMetricId,
  type V4RunComposerMetrics,
} from "./run-composer";

const report = directorReportJson as unknown as {
  readonly sampleMetrics: unknown;
  readonly runs: readonly Readonly<{
    runSeed: number;
    traceSha256: string;
    repeatSha256: string;
    rooms: readonly string[];
    bossId: string;
    durationMs: number;
    events: number;
    pass: boolean;
  }>[];
  readonly exampleSchedule: unknown;
};

const SAMPLE_METRICS = validateV4RunComposerMetrics(report.sampleMetrics);

function metrics(
  overrides: Partial<Record<V4RunComposerMetricId, number>> = {},
): V4RunComposerMetrics {
  const value = Object.fromEntries(V4_RUN_COMPOSER_METRIC_IDS.map((id) => [id, 0])) as Record<
    V4RunComposerMetricId,
    number
  >;
  for (const [id, metric] of Object.entries(overrides)) value[id as V4RunComposerMetricId] = metric;
  return validateV4RunComposerMetrics(value);
}

describe("immutable V4 RunComposer declaration authority", () => {
  it("preserves manifest room, pattern, and boss declaration order", () => {
    expect(V4_RUN_COMPOSER_CONTRACT.roomOrder).toEqual([
      "INFORMATION",
      "FORCED_ALIGNMENT",
      "IN_BETWEEN",
      "POLARIZED",
    ]);
    expect(V4_RUN_COMPOSER_CONTRACT.patternOrderByRoom.POLARIZED).toEqual([
      "room.polarized.clock_decree",
      "room.polarized.hard_cut_corridor",
      "room.polarized.alternating_verdict",
      "room.polarized.no_dusk_grid",
    ]);
    expect(V4_RUN_COMPOSER_CONTRACT.metricOrderByRoom).toEqual({
      INFORMATION: ["avgFlower", "gazeRatio", "recentInputDensity", "unansweredActions"],
      FORCED_ALIGNMENT: ["sideCommitment", "crackRatio", "sideSwitches", "avgFlower"],
      IN_BETWEEN: ["contextSwitches", "intersectionHold", "correctionLatency", "gazeRatio"],
      POLARIZED: ["overrideRatio", "binarySwitches", "highLightRatio", "noDuskTicks"],
    });
    expect(V4_RUN_COMPOSER_CONTRACT.bossOrderByRoom.POLARIZED).toEqual([
      "boss.no_dusk",
      "boss.absolute_reader",
    ]);
    expect(V4_RUN_COMPOSER_CONTRACT.qaDefaultRoomCount).toBe(3);
    expect(V4_RUN_COMPOSER_CONTRACT.qaPatternsPerRoom).toBe(3);
    expect(V4_RUN_COMPOSER_CONTRACT.immediateStructuralSignaturePenalty).toBe(0.15);
  });

  it("requires an explicit, finite, exact behavior metric universe", () => {
    const reversed = Object.fromEntries(
      V4_RUN_COMPOSER_METRIC_IDS.slice().reverse().map((id) => [id, SAMPLE_METRICS[id]]),
    );
    expect(validateV4RunComposerMetrics(reversed)).toEqual(SAMPLE_METRICS);
    expect(() => validateV4RunComposerMetrics({...SAMPLE_METRICS, inventedMetric: 1})).toThrow(
      /exact explicit V4 QA metric universe/,
    );
    const missing = {...SAMPLE_METRICS} as Record<string, number>;
    delete missing.noDuskTicks;
    expect(() => validateV4RunComposerMetrics(missing)).toThrow(/exact explicit V4 QA metric universe/);
    expect(() => validateV4RunComposerMetrics({...SAMPLE_METRICS, avgFlower: Number.NaN})).toThrow(
      /avgFlower must be finite/,
    );

    let reads = 0;
    const accessor = Object.defineProperty({...SAMPLE_METRICS}, "avgFlower", {
      enumerable: true,
      get() {
        reads += 1;
        return 0.62;
      },
    });
    expect(() => validateV4RunComposerMetrics(accessor)).toThrow(/own data property/);
    expect(reads).toBe(0);
  });
});

describe("V4 gameplay/tools/sim_core.py compose_run parity", () => {
  it("deep-compares the complete seed 0x1B17 QA example and exact trace hash", () => {
    const plan = composeV4RunComposerPlan({rawRunSeed: 0x1b17, metrics: SAMPLE_METRICS});
    expect(plan.qa).toEqual(report.exampleSchedule);
    expect(plan.qa.traceSha256).toBe("e9f4db707b262a086d438769ba5e474fa55140be84543a1a5547eb816a020b12");
    expect(plan.qa.schedule).toHaveLength(33);
    expect(plan.provenance.roomCountAuthority).toBe("qa-oracle-default-3");
    expect(plan.provenance.canonicalEventBus).toBe(false);
    expect(plan.provenance.liveIntegration).toBe(false);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.qa.schedule)).toBe(true);
  });

  it("matches all sixteen immutable determinism report rows", () => {
    expect(report.runs).toHaveLength(16);
    for (const row of report.runs) {
      const plan = composeV4RunComposerPlan({rawRunSeed: row.runSeed, metrics: SAMPLE_METRICS});
      expect(plan.qa.rooms, `rooms for ${row.runSeed}`).toEqual(row.rooms);
      expect(plan.qa.bossId, `boss for ${row.runSeed}`).toBe(row.bossId);
      expect(plan.qa.durationMs, `duration for ${row.runSeed}`).toBe(row.durationMs);
      expect(plan.qa.schedule.length, `events for ${row.runSeed}`).toBe(row.events);
      expect(plan.qa.traceSha256, `trace for ${row.runSeed}`).toBe(row.traceSha256);
      expect(plan.qa.traceSha256, `repeat trace for ${row.runSeed}`).toBe(row.repeatSha256);
      expect(row.pass).toBe(true);
    }
  });

  it.each([
    [1e-7, "b4a1d78bf7e0861162af1a3e66ecbab8b27a9e97490c205d9582b74404cb94c9"],
    [1e-5, "57a64ce7c40abb4b902cb6c7c388da8bff26016b3fc708cb0968f77abad03dcf"],
    [0.0001, "12c3519dc092bcb73291bb07acc2d8fa7d77fbd0ededb2c601323e2b37490beb"],
    [0.999_999_999_999_999_9, "f4d15de1eca9f58ca4edd944371ec28f0fd302998201fe5e4237cef11f1445ab"],
    [-1e-7, "bb4824d3626acbc46c84a6f086b8652373153579deead15922e6dd7be69d20bc"],
  ] as const)("uses Python float spelling for metric %s trace identity", (avgFlower, trace) => {
    expect(composeV4RunComposerPlan({
      rawRunSeed: 123,
      metrics: metrics({avgFlower}),
    }).qa.traceSha256).toBe(trace);
  });

  it("keeps the authored two- and four-room QA variants on the same oracle path", () => {
    expect(composeV4RunComposerPlan({
      rawRunSeed: 0x1b17,
      metrics: SAMPLE_METRICS,
      roomCount: 2,
    }).qa).toMatchObject({
      rooms: ["POLARIZED", "FORCED_ALIGNMENT"],
      bossId: "boss.one_sun_one_rule",
      durationMs: 130800,
      traceSha256: "3a0ac122138d2379fe07fd06dfc4f45ca4d9cfc2d5e0e563404e6bd2aa979397",
    });
    expect(composeV4RunComposerPlan({
      rawRunSeed: 0x1b17,
      metrics: SAMPLE_METRICS,
      roomCount: 4,
    }).qa).toMatchObject({
      rooms: ["POLARIZED", "FORCED_ALIGNMENT", "IN_BETWEEN", "INFORMATION"],
      bossId: "boss.unanswering_feed",
      durationMs: 218300,
      traceSha256: "ed16b2b2ab8a69cd2300afe922088e053dc3854bee2067783a2cba965a514b66",
    });
  });

  it("uses the exact QA tier thresholds and inclusivity", () => {
    expect(deriveV4QaIntensityTier(metrics()).difficulty).toBe("EASY");

    const belowRead = deriveV4QaIntensityTier(metrics({avgFlower: 0.559_999}));
    expect(belowRead.intensityScore).toBeLessThan(0.28);
    expect(belowRead.id).toBe("listen");
    expect(belowRead.difficulty).toBe("EASY");

    const atRead = deriveV4QaIntensityTier(metrics({avgFlower: 0.56}));
    expect(atRead.intensityScore).toBe(0.28);
    expect(atRead.id).toBe("read");
    expect(atRead.difficulty).toBe("NORMAL");

    const belowEnforce = deriveV4QaIntensityTier(metrics({avgFlower: 1, gazeRatio: 0.159_999}));
    expect(belowEnforce.intensityScore).toBeLessThan(0.58);
    expect(belowEnforce.id).toBe("read");

    const atEnforce = deriveV4QaIntensityTier(metrics({avgFlower: 1, gazeRatio: 0.16}));
    expect(atEnforce.intensityScore).toBe(0.58);
    expect(atEnforce.id).toBe("enforce");
    expect(atEnforce.difficulty).toBe("HARD");
  });

  it("retains the Python immediate structural-signature penalty branch", () => {
    const candidates = [
      {id: "same", baseWeight: 1, structuralSignature: "signature-a"},
      {id: "different", baseWeight: 1, structuralSignature: "signature-b"},
    ] as const;
    const firstMulberryValueForSeedZero = 0.266_429_208_684_712_65;
    expect(pickV4QaPatternCandidate(candidates, null, firstMulberryValueForSeedZero).id).toBe("same");
    expect(
      pickV4QaPatternCandidate(candidates, "signature-a", firstMulberryValueForSeedZero).id,
    ).toBe("different");
  });

  it("keeps QA seeds observable and live runtime seeds unresolved", () => {
    const plan = composeV4RunComposerPlan({rawRunSeed: 0x1b17, metrics: SAMPLE_METRICS});
    const encounters = plan.seedLedger.filter((entry) => entry.kind === "encounter");
    expect(encounters[0]).toEqual({
      kind: "encounter",
      patternId: "room.polarized.alternating_verdict",
      roomOrdinal: 0,
      encounterOrdinal: 0,
      encounterIdentitySeed: 6935,
      qaPatternSeed: 4224146603,
      liveRuntimePatternSeed: null,
      liveRuntimeSeedOmission: "difficulty-salt-not-authored",
    });
    expect(encounters.slice(0, 3).map((entry) => entry.qaPatternSeed)).toEqual([
      4224146603,
      2541744054,
      1517218065,
    ]);
    expect(plan.seedLedger.filter((entry) => entry.kind === "transition").map((entry) =>
      entry.qaPatternSeed)).toEqual([577554860, 577554861]);
    expect(plan.seedLedger.filter((entry) => entry.kind === "boss-phase").map((entry) =>
      entry.qaPatternSeed)).toEqual([3440243983, 4178711120, 2452377432]);
    expect(plan.seedLedger.find((entry) => entry.kind === "dusk")?.qaPatternSeed).toBe(924053607);
    expect(plan.seedLedger.every((entry) => entry.liveRuntimePatternSeed === null)).toBe(true);
  });

  it("schedules authored transitions but never invents a parallel weather encounter", () => {
    const plan = composeV4RunComposerPlan({rawRunSeed: 0x1b17, metrics: SAMPLE_METRICS});
    const transitions = plan.qa.schedule.filter((entry) => entry.event === "transition.begin");
    expect(transitions).toEqual([
      {atMs: 38300, event: "transition.begin", patternId: "transition.room_threshold", seed: 577554860},
      {atMs: 83800, event: "transition.begin", patternId: "transition.room_threshold", seed: 577554861},
    ]);
    const roomEntries = plan.qa.schedule.filter((entry) => entry.event === "room.enter");
    expect(roomEntries.map((entry) => entry.atMs)).toEqual([0, 46100, 91600]);
    expect(plan.qa.schedule.some((entry) => entry.patternId?.startsWith("encounter.weather_echo."))).toBe(false);
    expect(plan.provenance.parallelWeatherScheduled).toBe(false);
  });

  it("fails closed on non-uint32 seeds and non-authored room counts", () => {
    expect(() => composeV4RunComposerPlan({rawRunSeed: -1, metrics: SAMPLE_METRICS})).toThrow(/uint32/);
    expect(() => composeV4RunComposerPlan({rawRunSeed: 0x1_0000_0000, metrics: SAMPLE_METRICS})).toThrow(
      /uint32/,
    );
    expect(() => composeV4RunComposerPlan({rawRunSeed: -0, metrics: SAMPLE_METRICS})).toThrow(/uint32/);
    expect(() => composeV4RunComposerPlan({
      rawRunSeed: 1,
      metrics: SAMPLE_METRICS,
      roomCount: 1 as 2,
    })).toThrow(/authored 2\.\.4 range/);
    expect(composeV4RunComposerPlan({
      rawRunSeed: 1,
      metrics: SAMPLE_METRICS,
      roomCount: 4,
    }).provenance.roomCountAuthority).toBe("caller-supplied-authored-range");
  });

  it("captures plain data options once and rejects accessors before composition", () => {
    let reads = 0;
    const options = Object.defineProperties({}, {
      rawRunSeed: {enumerable: true, value: 1},
      metrics: {enumerable: true, value: SAMPLE_METRICS},
      roomCount: {
        enumerable: true,
        get() {
          reads += 1;
          return reads === 1 ? 2 : undefined;
        },
      },
    });
    expect(() => composeV4RunComposerPlan(options as never)).toThrow(/own data property/);
    expect(reads).toBe(0);
    expect(() => composeV4RunComposerPlan({
      rawRunSeed: 1,
      metrics: SAMPLE_METRICS,
      invented: true,
    } as never)).toThrow(/must contain only/);
  });
});
