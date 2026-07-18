import {createHash} from "node:crypto";
import {describe, expect, it, vi} from "vitest";
import executablePatternsJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/executable-patterns-v4.json";
import {AuthorityClock} from "./clock";
import type {CanonicalCombatStepInput} from "./combat-kernel";
import {CANONICAL_EVENT_IDS, isCanonicalEventId} from "./events";
import {
  admitLiveRoomCapability,
  type LiveRoomCapabilityAdmittedPlan,
} from "./live-run-admission";
import {
  ALTERNATING_VERDICT_READ_CONTRACT,
  ALTERNATING_VERDICT_READ_FIXTURE_SHA256,
  CanonicalAlternatingVerdictReadFragment,
  type CanonicalAlternatingVerdictReadOptions,
  type CanonicalAlternatingVerdictReadSnapshot,
} from "./alternating-verdict-read";
import {V4_RUN_COMPOSER_METRIC_IDS} from "./run-composer";

const EVENT_BUS_AUDIT = vi.hoisted(() => ({allocations: 0}));

vi.mock("./events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./events")>();
  const AuditedCanonicalEventBus = new Proxy(actual.CanonicalEventBus, {
    construct(target, args) {
      EVENT_BUS_AUDIT.allocations += 1;
      return Reflect.construct(target, args, target);
    },
  });
  return {...actual, CanonicalEventBus: AuditedCanonicalEventBus};
});

const RAW_RUN_SEED = 0x1234_5678;
const FIXTURE_SHA256 = "36da160cd1a63e96a71c6c5978c1d3b73398e177c8b447ef08274c6215824131";
const EVENT_TRACE_SHA256 = "21c28e87ea9bdb9fd2a9777fd8f6cc3392209ae5557ede1b766b6d3bcf36bd3c";
const METRIC_CAPTURE_TICK120 = 960;
const PRE_READ_DURATION_TICK120 = 159;
const EARLIEST_READ_TICK120 = METRIC_CAPTURE_TICK120 + PRE_READ_DURATION_TICK120;
const DEFAULT_START_TICK120 = EARLIEST_READ_TICK120;
const SLICE_DURATION_TICK120 = 1692;
const SLICE_END_TICK120 = DEFAULT_START_TICK120 + SLICE_DURATION_TICK120;
const OCCURRENCE_ID = "room:0:encounter:0:room.polarized.alternating_verdict";
const ENTITY_PREFIX = `combat:${OCCURRENCE_ID.length}:${OCCURRENCE_ID}:`
  + "room.polarized.alternating_verdict/micro/";

const EXPECTED_EVENT_IDS = [
  "projectile.arm.begin",
  "projectile.armed",
  "projectile.cancel.commit",
  "projectile.collision.off",
  "projectile.collision.on",
  "projectile.flight.begin",
  "projectile.lifecycle.complete",
  "projectile.residue.begin",
  "projectile.residue.remove",
  "projectile.spawn.commit",
] as const;

const EXPECTED_BUDGET_EVIDENCE = {
  interpretation: "observational-only-no-enforcement",
  countingPolicy: "post-flush-authority-snapshots",
  observationProfile: "stationary-center-unfocused-graze10-damage1",
  peakDigitalBodies: 52,
  peakLiveColliders: 52,
  peakAllAuthorityEntitiesIncludingResidue: 83,
  peakResidueVisuals: 83,
  allocatedMicroHighWater: 83,
  cumulativeSpawnCommits: 150,
  authoredRngCallsConsumed: 162,
  preflightOmissions: 12,
  authoredEmitters: 2,
  listenTierMaxProjectiles: 80,
  listenTierMaxEmitters: 2,
  encounterEasyMaxProjectileBudget: 120,
  unresolved: "v4-does-not-author-concurrent-vs-residue-vs-cumulative-projectile-budget-counting",
} as const;

const patternById = new Map(executablePatternsJson.patterns.map((pattern) => [pattern.id, pattern]));

function xor(...values: readonly number[]): number {
  return values.reduce((result, value) => (result ^ value) >>> 0, 0);
}

function metrics(): Record<string, number> {
  return Object.fromEntries(V4_RUN_COMPOSER_METRIC_IDS.map((id, index) => [id, (index + 1) / 20]));
}

function resolvedSeed(
  patternId: string,
  encounterOrdinal: number,
  difficultySalt: number,
  rawRunSeed = RAW_RUN_SEED,
): number {
  const pattern = patternById.get(patternId);
  if (pattern === undefined) throw new Error(`test fixture lost ${patternId}`);
  return xor(rawRunSeed, pattern.seed.base, encounterOrdinal, difficultySalt);
}

function selectionSeed(encounterOrdinal: number, rawRunSeed = RAW_RUN_SEED): number {
  return xor(rawRunSeed, encounterOrdinal, 0xec40);
}

function encounter(
  patternId: string,
  encounterOrdinal: number,
  difficultySalt: number,
  rawRunSeed = RAW_RUN_SEED,
): Record<string, unknown> {
  const pattern = patternById.get(patternId);
  if (pattern === undefined) throw new Error(`test fixture lost ${patternId}`);
  return {
    occurrenceId: `room:0:encounter:${encounterOrdinal}:${patternId}`,
    patternId,
    encounterOrdinal,
    difficulty: "EASY",
    difficultySalt,
    resolvedSeed: {
      domain: "resolved-occurrence-seed",
      value: resolvedSeed(patternId, encounterOrdinal, difficultySalt, rawRunSeed),
    },
    segments: {
      telegraphMs: 520,
      entryMs: 800,
      readMs: pattern.durationMs,
      materialSettleMs: 900,
      restMs: 1600,
      safeGapHandoffMs: 520,
    },
    parallel: {
      mode: "none",
      selectionSeed: {
        domain: "parallel-selection-seed",
        value: selectionSeed(encounterOrdinal, rawRunSeed),
      },
    },
  };
}

function fixedCandidate(): Record<string, unknown> {
  return {
    schemaVersion: "1.0.0-live-room-capability",
    authority: "caller-resolved-live-room",
    rawRunSeed: {domain: "raw-run-seed", value: RAW_RUN_SEED},
    metricSnapshot: {
      producerId: "test.behavior-ledger",
      producerVersion: "1.0.0",
      capturedAtTick120: METRIC_CAPTURE_TICK120,
      metrics: metrics(),
    },
    room: {
      roomId: "POLARIZED",
      roomOrdinal: 0,
      tierId: "listen",
      difficulty: "EASY",
      encounters: [encounter("room.polarized.alternating_verdict", 0, 0x2200)],
    },
  };
}

function admitted(candidate: Record<string, unknown>): LiveRoomCapabilityAdmittedPlan {
  const result = admitLiveRoomCapability(candidate);
  expect(result.status).toBe("admitted");
  if (result.status !== "admitted") throw new Error("test candidate must admit");
  return result.plan;
}

function admittedHash(candidate: Record<string, unknown>): string {
  return admitted(candidate).gameplaySha256;
}

function options(
  startTick120 = DEFAULT_START_TICK120,
  overrides: Partial<CanonicalAlternatingVerdictReadOptions> = {},
): CanonicalAlternatingVerdictReadOptions {
  return {
    expectedGameplaySha256: FIXTURE_SHA256,
    startTick120,
    initialPlayerPosition: {x: 180, y: 570},
    grazeRadiusPx: 10,
    projectileDamage: 1,
    projectilePoolClasses: {"bullet.micro.notch_e": "micro"},
    incomingReadBoundary: "caller-established-after-unexecuted-telegraph-and-entry",
    incomingSafeGap: "not-claimed",
    ...overrides,
  };
}

function inputAt(tick120: number): CanonicalCombatStepInput {
  return {tick120, movement: {x: 0, y: 0}, focused: false};
}

function tickAt(relativeTick120: number, startTick120 = DEFAULT_START_TICK120): number {
  return startTick120 + relativeTick120;
}

function stepTo(
  fragment: CanonicalAlternatingVerdictReadFragment,
  targetTick120: number,
  input = inputAt,
): CanonicalAlternatingVerdictReadSnapshot {
  let snapshot = fragment.snapshot();
  for (let tick120 = snapshot.tick120 + 1; tick120 <= targetTick120; tick120 += 1) {
    snapshot = tick120 === snapshot.boundaryTicks120.fixedSliceComplete
      ? fragment.closeSlice()
      : fragment.step(input(tick120));
  }
  return snapshot;
}

function isDeepFrozen(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value !== "object" || value === null || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value)
    && Object.values(value).every((entry) => isDeepFrozen(entry, seen));
}

function expectNoBusAllocation(action: () => unknown): void {
  const before = EVENT_BUS_AUDIT.allocations;
  expect(action).toThrow();
  expect(EVENT_BUS_AUDIT.allocations).toBe(before);
}

function normalizeEventTime(value: unknown, startTick120: number, key = ""): unknown {
  if (typeof value === "number") {
    if (key === "tick120" || key.endsWith("AtTick120")) return value - startTick120;
    if (/(?:At|Time)Ms$/.test(key)) {
      const startMs = startTick120 * 1000 / 120;
      return Math.round((value - startMs) * 1e9) / 1e9;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeEventTime(entry, startTick120));
  }
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([entryKey, entry]) => [
    entryKey,
    normalizeEventTime(entry, startTick120, entryKey),
  ]));
}

function cadenceDeltas(hz: number): readonly number[] {
  const frameMs = 1000 / hz;
  const totalMs = SLICE_DURATION_TICK120 * 1000 / 120;
  const fullFrames = Math.floor(totalMs / frameMs);
  const deltas = Array.from({length: fullFrames}, () => frameMs);
  const remainder = totalMs - fullFrames * frameMs;
  if (remainder > 1e-9) deltas.push(remainder);
  return deltas;
}

function driveWithClock(
  deltas: readonly number[],
  projectionContext?: unknown,
): CanonicalAlternatingVerdictReadFragment {
  const fragment = new CanonicalAlternatingVerdictReadFragment(
    fixedCandidate(),
    options(),
    projectionContext,
  );
  const clock = new AuthorityClock({
    onTick120: ({tick120}) => {
      if (tick120 === SLICE_DURATION_TICK120) fragment.closeSlice();
      else fragment.step(inputAt(DEFAULT_START_TICK120 + tick120));
    },
  });
  for (const delta of deltas) clock.advance(delta);
  while (clock.snapshot().backlogTicks > 0) clock.advance(0);
  expect(clock.snapshot().tick120).toBe(SLICE_DURATION_TICK120);
  return fragment;
}

describe("CanonicalAlternatingVerdictReadFragment fixed contract", () => {
  it("pins the exact frozen fixture, source-derived negative claims, and initial snapshot", () => {
    expect(ALTERNATING_VERDICT_READ_FIXTURE_SHA256).toBe(FIXTURE_SHA256);
    expect(ALTERNATING_VERDICT_READ_CONTRACT).toEqual({
      schemaVersion: "1.0.0-canonical-alternating-verdict-read-fragment",
      authority: "caller-resolved-singleton-alternating-verdict-read",
      fixtureGameplaySha256: FIXTURE_SHA256,
      roomId: "POLARIZED",
      roomOrdinal: 0,
      tierId: "listen",
      difficulty: "EASY",
      patternId: "room.polarized.alternating_verdict",
      metricCount: 14,
      composer: false,
      scheduler: false,
      selectionAuthority: "caller-resolved",
      selectionRngConsumed: false,
      parallel: false,
      canonicalEventBus: true,
      canonicalSegmentEvents: false,
      runHandoff: false,
      roomComplete: false,
      handoffReady: false,
      roomTransition: "absent-not-invoked",
      telegraphAuthority: "outside-fragment-unexecuted",
      entryAuthority: "outside-fragment-unexecuted",
      incomingSafeGap: "not-claimed",
      segmentProjection: "snapshot-phase-only-cumulative-first-non-early-tick120",
      patternLocalTickZero: "caller-established-read-entry",
      metricCausality: "read-entry-at-or-after-metric-capture-plus-unexecuted-pre-read-duration",
      terminalBoundary: "eventless-neutral-close-from-quiescent-state",
      nestedCombatReadiness: "occurrence-lifecycle-only-not-room-or-run-handoff",
      safeGapHandoffSerialDuration: false,
      safeGapHandoffSpatialProof: false,
      sourceWithdrawnInNeutralTrace: false,
      weatherAuthority: false,
      presentationAffectsGameplay: false,
      budgetEnforced: false,
      serialSegmentsMs: {
        telegraph: 520,
        entry: 800,
        read: 11_600,
        materialSettle: 900,
        rest: 1600,
        safeGapHandoff: 520,
      },
      budgetEvidence: EXPECTED_BUDGET_EVIDENCE,
    });
    expect(isDeepFrozen(ALTERNATING_VERDICT_READ_CONTRACT)).toBe(true);

    const candidate = fixedCandidate();
    const beforeCandidate = JSON.stringify(candidate);
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const allocations = EVENT_BUS_AUDIT.allocations;
    const fragment = new CanonicalAlternatingVerdictReadFragment(candidate, options(), revoked.proxy);
    expect(EVENT_BUS_AUDIT.allocations).toBe(allocations + 1);
    expect(JSON.stringify(candidate)).toBe(beforeCandidate);
    expect(fragment.snapshot()).toMatchObject({
      authority: "canonical-alternating-verdict-read-fragment-v4",
      admissionGameplaySha256: FIXTURE_SHA256,
      metricCapturedAtTick120: 960,
      tick120: DEFAULT_START_TICK120,
      relativeTick120: 0,
      phase: "read",
      boundaryTicks120: {
        start: DEFAULT_START_TICK120,
        read: DEFAULT_START_TICK120,
        materialSettle: tickAt(1392),
        rest: tickAt(1500),
        residueDeadline: tickAt(1683),
        fixedSliceComplete: tickAt(1692),
      },
      roomId: "POLARIZED",
      roomOrdinal: 0,
      patternId: "room.polarized.alternating_verdict",
      occurrenceId: OCCURRENCE_ID,
      encounterOrdinal: 0,
      tierId: "listen",
      difficulty: "EASY",
      safeGapHandoffMs: 520,
      composer: false,
      scheduler: false,
      selectionAuthority: "caller-resolved",
      selectionRngConsumed: false,
      parallel: false,
      canonicalEventBus: true,
      runHandoff: false,
      fixedSliceComplete: false,
      roomComplete: false,
      timedStateQuiescent: true,
      handoffReady: false,
      faulted: false,
      runCombat: {activeOccurrenceId: OCCURRENCE_ID},
      combat: {relativeTick120: 0, occurrenceLifecycleReady: false},
      adapterPolicy: {
        safeGapHandoff: "validated-scalar-not-a-serial-window-or-spatial-proof",
        budget: EXPECTED_BUDGET_EVIDENCE,
      },
    });
    expect(Object.isFrozen(fragment)).toBe(true);
    expect(isDeepFrozen(fragment.snapshot())).toBe(true);
    expect(isDeepFrozen(fragment.admittedPlan())).toBe(true);
    expect(fragment.admittedPlan()).toEqual(admitted(fixedCandidate()));
    expect(fragment.events()).toEqual([]);
    expect(fragment.canonicalEventSerialization()).toBe("[]");
  });
});

describe("Alternating Verdict raw re-admission and pre-bus rejection", () => {
  it("rejects admitted plans, the POLARIZED pair, other patterns, and parallel members before a bus", () => {
    const plan = admitted(fixedCandidate());
    expectNoBusAllocation(() => new CanonicalAlternatingVerdictReadFragment(plan, options()));

    const pair = fixedCandidate();
    (pair.room as {encounters: Record<string, unknown>[]}).encounters.push(
      encounter("room.polarized.hard_cut_corridor", 1, 0x2201),
    );
    expect(admittedHash(pair)).toBe("0659e91c3a0cabbf17a5a5961189d47f13f1a27e341360ad92aca34a674ba820");
    expectNoBusAllocation(() => new CanonicalAlternatingVerdictReadFragment(
      pair,
      options(DEFAULT_START_TICK120, {expectedGameplaySha256: admittedHash(pair)}),
    ));

    const other = fixedCandidate();
    (other.room as {encounters: Record<string, unknown>[]}).encounters[0] =
      encounter("room.polarized.hard_cut_corridor", 0, 0x2200);
    expectNoBusAllocation(() => new CanonicalAlternatingVerdictReadFragment(
      other,
      options(DEFAULT_START_TICK120, {expectedGameplaySha256: admittedHash(other)}),
    ));

    const parallel = fixedCandidate();
    const primary = (parallel.room as {encounters: Record<string, unknown>[]}).encounters[0];
    if (primary === undefined) throw new Error("parallel fixture lost its primary occurrence");
    primary.parallel = {
      mode: "member",
      occurrenceId: "parallel:room:0:encounter:0:rain",
      patternId: "encounter.weather_echo.rain_packets",
      difficulty: "EASY",
      difficultySalt: 0x4400,
      resolvedSeed: {
        domain: "resolved-occurrence-seed",
        value: resolvedSeed("encounter.weather_echo.rain_packets", 0, 0x4400),
      },
      selectionSeed: {domain: "parallel-selection-seed", value: selectionSeed(0)},
    };
    expectNoBusAllocation(() => new CanonicalAlternatingVerdictReadFragment(
      parallel,
      options(DEFAULT_START_TICK120, {expectedGameplaySha256: admittedHash(parallel)}),
    ));
  });

  it("rejects exact hash, raw/resolved seed, segment, tier, selection, and pool drift before a bus", () => {
    expectNoBusAllocation(() => new CanonicalAlternatingVerdictReadFragment(
      fixedCandidate(),
      options(DEFAULT_START_TICK120, {expectedGameplaySha256: "0".repeat(64)}),
    ));

    const metricDrift = fixedCandidate();
    ((metricDrift.metricSnapshot as {metrics: Record<string, number>}).metrics).avgFlower = 0.987;
    expectNoBusAllocation(() => new CanonicalAlternatingVerdictReadFragment(
      metricDrift,
      options(DEFAULT_START_TICK120, {expectedGameplaySha256: admittedHash(metricDrift)}),
    ));

    const rawSeedDrift = fixedCandidate();
    const nextRawSeed = RAW_RUN_SEED + 1;
    (rawSeedDrift.rawRunSeed as {value: number}).value = nextRawSeed;
    const rawOccurrence = (rawSeedDrift.room as {encounters: Record<string, unknown>[]}).encounters[0];
    if (rawOccurrence === undefined) throw new Error("raw-seed fixture lost its occurrence");
    rawOccurrence.resolvedSeed = {
      domain: "resolved-occurrence-seed",
      value: resolvedSeed("room.polarized.alternating_verdict", 0, 0x2200, nextRawSeed),
    };
    rawOccurrence.parallel = {
      mode: "none",
      selectionSeed: {domain: "parallel-selection-seed", value: selectionSeed(0, nextRawSeed)},
    };
    expectNoBusAllocation(() => new CanonicalAlternatingVerdictReadFragment(
      rawSeedDrift,
      options(DEFAULT_START_TICK120, {expectedGameplaySha256: admittedHash(rawSeedDrift)}),
    ));

    const resolvedSeedDrift = fixedCandidate();
    const resolved = (resolvedSeedDrift.room as {encounters: Record<string, unknown>[]})
      .encounters[0];
    if (resolved === undefined) throw new Error("resolved-seed fixture lost its occurrence");
    (resolved.resolvedSeed as {value: number}).value ^= 1;
    expectNoBusAllocation(() => new CanonicalAlternatingVerdictReadFragment(
      resolvedSeedDrift,
      options(),
    ));

    const segmentDrift = fixedCandidate();
    const segmentOccurrence = (segmentDrift.room as {encounters: Record<string, unknown>[]})
      .encounters[0];
    if (segmentOccurrence === undefined) throw new Error("segment fixture lost its occurrence");
    (segmentOccurrence.segments as {materialSettleMs: number}).materialSettleMs = 1000;
    expectNoBusAllocation(() => new CanonicalAlternatingVerdictReadFragment(
      segmentDrift,
      options(DEFAULT_START_TICK120, {expectedGameplaySha256: admittedHash(segmentDrift)}),
    ));

    const tierDrift = fixedCandidate();
    const tierRoom = tierDrift.room as {
      tierId: string;
      difficulty: string;
      encounters: Record<string, unknown>[];
    };
    tierRoom.tierId = "read";
    tierRoom.difficulty = "NORMAL";
    const tierOccurrence = tierRoom.encounters[0];
    if (tierOccurrence === undefined) throw new Error("tier fixture lost its occurrence");
    tierOccurrence.difficulty = "NORMAL";
    (tierOccurrence.segments as {restMs: number}).restMs = 1100;
    expectNoBusAllocation(() => new CanonicalAlternatingVerdictReadFragment(
      tierDrift,
      options(DEFAULT_START_TICK120, {expectedGameplaySha256: admittedHash(tierDrift)}),
    ));

    const selectionDrift = fixedCandidate();
    const selectionOccurrence = (selectionDrift.room as {encounters: Record<string, unknown>[]})
      .encounters[0];
    if (selectionOccurrence === undefined) throw new Error("selection fixture lost its occurrence");
    ((selectionOccurrence.parallel as {selectionSeed: {value: number}}).selectionSeed).value ^= 1;
    expectNoBusAllocation(() => new CanonicalAlternatingVerdictReadFragment(selectionDrift, options()));

    expectNoBusAllocation(() => new CanonicalAlternatingVerdictReadFragment(
      fixedCandidate(),
      options(DEFAULT_START_TICK120, {projectilePoolClasses: {}}),
    ));
  });

  it("does not invoke hostile candidate, option, or projection accessors before rejection", () => {
    let candidateReads = 0;
    const candidate = fixedCandidate();
    candidate.rawRunSeed = Object.defineProperties({}, {
      domain: {value: "raw-run-seed", enumerable: true},
      value: {
        enumerable: true,
        get() {
          candidateReads += 1;
          return RAW_RUN_SEED;
        },
      },
    });
    expectNoBusAllocation(() => new CanonicalAlternatingVerdictReadFragment(candidate, options()));
    expect(candidateReads).toBe(0);

    let optionReads = 0;
    const hostileOptions = Object.defineProperty({...options()}, "startTick120", {
      enumerable: true,
      get() {
        optionReads += 1;
        return DEFAULT_START_TICK120;
      },
    });
    expectNoBusAllocation(() => new CanonicalAlternatingVerdictReadFragment(
      fixedCandidate(),
      hostileOptions,
    ));
    expect(optionReads).toBe(0);

    const projection = new Proxy({}, {
      get() {
        throw new Error("projection must remain opaque");
      },
      ownKeys() {
        throw new Error("projection must remain opaque");
      },
    });
    expect(() => new CanonicalAlternatingVerdictReadFragment(
      fixedCandidate(),
      options(),
      projection,
    )).not.toThrow();
  });

  it("rejects early, negative-zero, unsafe, and cumulatively overflowing starts before a bus", () => {
    for (const startTick120 of [
      -0,
      Number.MAX_SAFE_INTEGER + 1,
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER - 1691,
      EARLIEST_READ_TICK120 - 1,
    ]) {
      expectNoBusAllocation(() => new CanonicalAlternatingVerdictReadFragment(
        fixedCandidate(),
        options(startTick120),
      ));
    }
    const allocations = EVENT_BUS_AUDIT.allocations;
    expect(() => new CanonicalAlternatingVerdictReadFragment(
      fixedCandidate(),
      options(EARLIEST_READ_TICK120),
    )).not.toThrow();
    expect(EVENT_BUS_AUDIT.allocations).toBe(allocations + 1);
  });
});

describe("Alternating Verdict exact phase and lifecycle boundaries", () => {
  it("projects +1392/+1500/+1683 and reserves +1692 for eventless neutral closure", {
    timeout: 15_000,
  }, () => {
    const fragment = new CanonicalAlternatingVerdictReadFragment(fixedCandidate(), options());
    expect(stepTo(fragment, tickAt(1391))).toMatchObject({
      phase: "read",
      combat: {patternComplete: false},
      runCombat: {activeOccurrenceId: OCCURRENCE_ID},
    });
    expect(fragment.step(inputAt(tickAt(1392)))).toMatchObject({
      phase: "material_settle",
      combat: {patternComplete: true, occurrenceLifecycleReady: false},
      runCombat: {activeOccurrenceId: OCCURRENCE_ID},
    });
    expect(stepTo(fragment, tickAt(1499)).phase).toBe("material_settle");
    expect(fragment.step(inputAt(tickAt(1500))).phase).toBe("rest");
    expect(stepTo(fragment, tickAt(1682))).toMatchObject({
      phase: "rest",
      combat: {projectileLifecycleDrained: false, occurrenceLifecycleReady: false},
      runCombat: {activeOccurrenceId: OCCURRENCE_ID},
    });

    const released = fragment.step(inputAt(tickAt(1683)));
    expect(released).toMatchObject({
      phase: "rest",
      combat: {
        relativeTick120: 1683,
        projectileLifecycleDrained: true,
        occurrenceLifecycleReady: true,
        projectiles: [],
      },
      runCombat: {activeOccurrenceId: null, pendingFlushTick120: null},
      timedStateQuiescent: true,
      roomComplete: false,
      handoffReady: false,
      runHandoff: false,
    });
    expect(fragment.events().filter((event) => event.tick120 === tickAt(1683)).map((event) => event.id))
      .toEqual(expect.arrayContaining([
        "projectile.residue.remove",
        "projectile.lifecycle.complete",
      ]));
    const eventCount = fragment.events().length;
    const serialization = fragment.canonicalEventSerialization();
    expect(stepTo(fragment, tickAt(1691))).toMatchObject({
      phase: "rest",
      tick120: tickAt(1691),
      runCombat: {activeOccurrenceId: null},
      combat: {tick120: tickAt(1683), occurrenceLifecycleReady: true},
    });
    expect(fragment.events()).toHaveLength(eventCount);
    expect(fragment.canonicalEventSerialization()).toBe(serialization);

    expect(fragment.closeSlice()).toMatchObject({
      phase: "slice_complete",
      tick120: SLICE_END_TICK120,
      relativeTick120: 1692,
      fixedSliceComplete: true,
      roomComplete: false,
      timedStateQuiescent: true,
      handoffReady: false,
      runHandoff: false,
      runCombat: {activeOccurrenceId: null, pendingFlushTick120: null},
      combat: {relativeTick120: 1683, occurrenceLifecycleReady: true},
    });
    expect(fragment.events()).toHaveLength(eventCount);
    expect(fragment.canonicalEventSerialization()).toBe(serialization);

    expect(() => fragment.step(inputAt(SLICE_END_TICK120 + 1))).toThrow(/closed|slice/i);
    expect(fragment.snapshot()).toMatchObject({
      tick120: SLICE_END_TICK120,
      phase: "slice_complete",
      faulted: true,
    });
  });

  it("allows gameplay only through +1691 and fail-stops gameplay at the +1692 boundary", {
    timeout: 15_000,
  }, () => {
    const fragment = new CanonicalAlternatingVerdictReadFragment(fixedCandidate(), options());
    stepTo(fragment, tickAt(1691));
    const serialization = fragment.canonicalEventSerialization();
    expect(() => fragment.step(inputAt(tickAt(1692)))).toThrow(/closeSlice|terminal/i);
    expect(fragment.snapshot()).toMatchObject({
      tick120: tickAt(1691),
      phase: "rest",
      fixedSliceComplete: false,
      faulted: true,
    });
    expect(fragment.canonicalEventSerialization()).toBe(serialization);
    expect(() => fragment.closeSlice()).toThrow(/fault/i);
  });

  it("observes a real player timer close in the authored tail and rejects a live Override timer", {
    timeout: 20_000,
  }, () => {
    const playerTimer = new CanonicalAlternatingVerdictReadFragment(
      fixedCandidate(),
      options(DEFAULT_START_TICK120, {initialPlayerPosition: {x: 240, y: 570}}),
    );
    const damaged = stepTo(playerTimer, tickAt(1300));
    expect(damaged.runCombat.player).toMatchObject({
      health: 2,
      recoveryAtTick120: expect.any(Number),
    });
    expect(stepTo(playerTimer, tickAt(1691))).toMatchObject({
      timedStateQuiescent: true,
      runCombat: {
        player: {
          recoveryAtTick120: null,
          respawnPlaceAtTick120: null,
          respawnCompleteAtTick120: null,
        },
      },
    });
    expect(() => playerTimer.closeSlice()).not.toThrow();

    const overrideTimer = new CanonicalAlternatingVerdictReadFragment(fixedCandidate(), options());
    stepTo(overrideTimer, tickAt(1690));
    expect(overrideTimer.step({
      ...inputAt(tickAt(1691)),
      overridePressed: true,
      overrideDirection: {x: 0, y: -1},
    })).toMatchObject({
      timedStateQuiescent: false,
      runCombat: {override: {state: "charging", deadlineTick120: expect.any(Number)}},
    });
    expect(() => overrideTimer.closeSlice()).toThrow(/player\/Override timer|strand|quiescent/i);
    expect(overrideTimer.snapshot()).toMatchObject({
      tick120: tickAt(1691),
      fixedSliceComplete: false,
      timedStateQuiescent: false,
      faulted: true,
    });
  });
});

describe("Alternating Verdict fail-stop ownership", () => {
  it("requires exact-next ticks, latches hostile input errors, and rejects every later step", () => {
    const skipped = new CanonicalAlternatingVerdictReadFragment(fixedCandidate(), options());
    expect(() => skipped.step(inputAt(tickAt(2)))).toThrow(/one tick|exact.next|1/i);
    expect(skipped.snapshot()).toMatchObject({tick120: DEFAULT_START_TICK120, faulted: true});
    expect(skipped.events()).toEqual([]);
    expect(() => skipped.step(inputAt(tickAt(1)))).toThrow(/fault/i);

    const hostile = new CanonicalAlternatingVerdictReadFragment(fixedCandidate(), options());
    let movementReads = 0;
    const hostileInput = Object.defineProperty(
      {tick120: tickAt(1), focused: false},
      "movement",
      {
        enumerable: true,
        get() {
          movementReads += 1;
          return {x: 0, y: 0};
        },
      },
    );
    expect(() => hostile.step(hostileInput as CanonicalCombatStepInput)).toThrow(/own data property/);
    expect(movementReads).toBe(0);
    expect(hostile.snapshot()).toMatchObject({tick120: DEFAULT_START_TICK120, faulted: true});
    expect(() => hostile.step(inputAt(tickAt(1)))).toThrow(/fault/i);
  });

  it("fails reentrant advance without consuming the boundary or appending an event", () => {
    const fragment = new CanonicalAlternatingVerdictReadFragment(fixedCandidate(), options());
    let attempted = false;
    const input = new Proxy(inputAt(tickAt(1)), {
      getOwnPropertyDescriptor(target, key) {
        if (!attempted && key === "tick120") {
          attempted = true;
          fragment.step(inputAt(tickAt(1)));
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    expect(() => fragment.step(input)).toThrow(/in progress|fault/i);
    expect(attempted).toBe(true);
    expect(fragment.snapshot()).toMatchObject({tick120: DEFAULT_START_TICK120, faulted: true});
    expect(fragment.events()).toEqual([]);
    expect(() => fragment.step(inputAt(tickAt(1)))).toThrow(/fault/i);
  });

  it("fails an early close permanently without advancing or emitting", () => {
    const fragment = new CanonicalAlternatingVerdictReadFragment(fixedCandidate(), options());
    expect(() => fragment.closeSlice()).toThrow(/exact fixed boundary/i);
    expect(fragment.snapshot()).toMatchObject({
      tick120: DEFAULT_START_TICK120,
      phase: "read",
      fixedSliceComplete: false,
      faulted: true,
    });
    expect(fragment.events()).toEqual([]);
    expect(() => fragment.step(inputAt(tickAt(1)))).toThrow(/fault/i);
  });
});

describe("Alternating Verdict canonical trace and projection parity", () => {
  it("pins stable occurrence identities, event order, no synthetic events, and observational budgets", {
    timeout: 15_000,
  }, () => {
    const fragment = new CanonicalAlternatingVerdictReadFragment(fixedCandidate(), options());
    let peakDigitalBodies = 0;
    let peakLiveColliders = 0;
    let peakAllAuthorityEntities = 0;
    let peakResidueVisuals = 0;
    let allocatedMicroHighWater = 0;
    for (let relativeTick120 = 1; relativeTick120 <= SLICE_DURATION_TICK120; relativeTick120 += 1) {
      const snapshot = relativeTick120 === SLICE_DURATION_TICK120
        ? fragment.closeSlice()
        : fragment.step(inputAt(tickAt(relativeTick120)));
      const combat = snapshot.combat;
      peakDigitalBodies = Math.max(
        peakDigitalBodies,
        combat.projectiles.filter((entry) => entry.state === "arm" || entry.state === "flight").length,
      );
      peakLiveColliders = Math.max(peakLiveColliders, combat.poolUsage.liveColliders);
      peakAllAuthorityEntities = Math.max(peakAllAuthorityEntities, combat.projectiles.length);
      peakResidueVisuals = Math.max(peakResidueVisuals, combat.poolUsage.residueVisuals);
      allocatedMicroHighWater = Math.max(
        allocatedMicroHighWater,
        combat.poolUsage.allocatedSlots.micro,
      );
    }

    const events = fragment.events();
    const serialization = fragment.canonicalEventSerialization();
    expect(createHash("sha256").update(serialization).digest("hex")).toBe(EVENT_TRACE_SHA256);
    expect(events).toHaveLength(1500);
    expect([...new Set(events.map((event) => event.id))].sort()).toEqual(EXPECTED_EVENT_IDS);
    expect(events.every((event) => isCanonicalEventId(event.id))).toBe(true);
    expect(events.every((event) => CANONICAL_EVENT_IDS.includes(event.id))).toBe(true);
    expect(events.map((event) => event.sequence)).toEqual(
      Array.from({length: events.length}, (_, index) => index),
    );
    expect(new Set(events.map((event) => event.occurrenceKey)).size).toBe(events.length);
    expect(events.every((event) => event.entityStableId.startsWith(ENTITY_PREFIX))).toBe(true);
    expect(events.every((event) =>
      event.payload.instanceId === event.entityStableId
      && Number.isSafeInteger(event.payload.generation))).toBe(true);

    const eventsByTick = new Map<number, typeof events>();
    for (const event of events) {
      const tickEvents = eventsByTick.get(event.tick120) ?? [];
      eventsByTick.set(event.tick120, Object.freeze([...tickEvents, event]));
    }
    for (const tickEvents of eventsByTick.values()) {
      for (let index = 1; index < tickEvents.length; index += 1) {
        expect(tickEvents[index]?.phasePriority).toBeGreaterThanOrEqual(
          tickEvents[index - 1]?.phasePriority ?? -1,
        );
      }
    }

    const firstEntityId = `${ENTITY_PREFIX}0000`;
    expect(events.filter((event) =>
      event.entityStableId === firstEntityId && event.payload.generation === 0)
      .map((event) => [event.tick120 - DEFAULT_START_TICK120, event.id])).toEqual([
      [66, "projectile.arm.begin"],
      [66, "projectile.spawn.commit"],
      [71, "projectile.armed"],
      [71, "projectile.flight.begin"],
      [71, "projectile.collision.on"],
      [513, "projectile.collision.off"],
      [513, "projectile.cancel.commit"],
      [513, "projectile.residue.begin"],
      [804, "projectile.residue.remove"],
      [804, "projectile.lifecycle.complete"],
    ]);
    expect(events[0]).toMatchObject({
      tick120: tickAt(66),
      entityStableId: firstEntityId,
      payload: {generation: 0, instanceId: firstEntityId},
    });
    expect(events.at(-1)).toMatchObject({
      id: "projectile.lifecycle.complete",
      tick120: tickAt(1683),
      entityStableId: `${ENTITY_PREFIX}0082`,
      payload: {generation: 0, cause: "cancel"},
    });

    expect(events.some((event) =>
      event.payload.reason === "source_withdrawn"
      || event.id.startsWith("room.transition.")
      || event.id.startsWith("weather.")
      || event.id.startsWith("boss.")
      || event.id === "run.end.commit")).toBe(false);
    for (const pseudo of [
      "room.enter",
      "encounter.begin",
      "segment.telegraph",
      "segment.entry",
      "segment.read",
      "segment.material_settle",
      "segment.rest",
      "material.settle",
    ]) expect(events.some((event) => event.id === pseudo)).toBe(false);

    const spawnCommits = events.filter((event) => event.id === "projectile.spawn.commit").length;
    expect({
      peakDigitalBodies,
      peakLiveColliders,
      peakAllAuthorityEntities,
      peakResidueVisuals,
      allocatedMicroHighWater,
      cumulativeSpawnCommits: spawnCommits,
      authoredRngCallsConsumed: fragment.snapshot().combat.rngCallsConsumed,
      preflightOmissions: fragment.snapshot().combat.rngCallsConsumed - spawnCommits,
    }).toEqual({
      peakDigitalBodies: 52,
      peakLiveColliders: 52,
      peakAllAuthorityEntities: 83,
      peakResidueVisuals: 83,
      allocatedMicroHighWater: 83,
      cumulativeSpawnCommits: 150,
      authoredRngCallsConsumed: 162,
      preflightOmissions: 12,
    });
    expect(ALTERNATING_VERDICT_READ_CONTRACT.budgetEvidence).toEqual(EXPECTED_BUDGET_EVIDENCE);
    expect(ALTERNATING_VERDICT_READ_CONTRACT.budgetEnforced).toBe(false);
    expect(52).toBeLessThan(80);
    expect(83).toBeGreaterThan(80);
    expect(150).toBeGreaterThan(120);
  });

  it("is trace-identical at 30/60/144 Hz, retained backlog, and opaque projections", {
    timeout: 30_000,
  }, () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const fragments = [
      driveWithClock(cadenceDeltas(30), {
        accessibilityProfile: "full",
        weather: {id: "STATIC", seed: 1},
      }),
      driveWithClock(cadenceDeltas(60), {accessibilityProfile: "reducedMotion"}),
      driveWithClock(cadenceDeltas(144), {
        accessibilityProfile: "flashOff",
        weather: {id: "ECLIPSE", seed: 0xffff_ffff},
      }),
      driveWithClock([SLICE_DURATION_TICK120 * 1000 / 120], revoked.proxy),
    ];
    const baseline = fragments[0];
    if (baseline === undefined) throw new Error("cadence baseline was not created");
    expect(createHash("sha256").update(baseline.canonicalEventSerialization()).digest("hex"))
      .toBe(EVENT_TRACE_SHA256);
    for (const fragment of fragments.slice(1)) {
      expect(fragment.canonicalEventSerialization()).toBe(baseline.canonicalEventSerialization());
      expect(fragment.snapshot()).toEqual(baseline.snapshot());
    }
  });

  it("keeps occurrence identity and lifecycle relative to a nonzero adjacent READ start", {
    timeout: 20_000,
  }, () => {
    const baseline = new CanonicalAlternatingVerdictReadFragment(
      fixedCandidate(),
      options(DEFAULT_START_TICK120),
    );
    const offsetStartTick120 = DEFAULT_START_TICK120 + 401;
    const offset = new CanonicalAlternatingVerdictReadFragment(
      fixedCandidate(),
      options(offsetStartTick120),
    );
    stepTo(baseline, DEFAULT_START_TICK120 + SLICE_DURATION_TICK120);
    stepTo(offset, offsetStartTick120 + SLICE_DURATION_TICK120);
    expect(offset.events()).toHaveLength(baseline.events().length);
    expect(offset.events().map((event) => normalizeEventTime(event, offsetStartTick120)))
      .toEqual(baseline.events().map((event) => normalizeEventTime(event, DEFAULT_START_TICK120)));
    expect(offset.snapshot()).toMatchObject({
      relativeTick120: SLICE_DURATION_TICK120,
      phase: "slice_complete",
      fixedSliceComplete: true,
      roomComplete: false,
      handoffReady: false,
      combat: {
        relativeTick120: 1683,
        rngCallsConsumed: 162,
        occurrenceLifecycleReady: true,
      },
    });
  });
});
