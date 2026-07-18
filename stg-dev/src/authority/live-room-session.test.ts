import {createHash} from "node:crypto";
import {describe, expect, it} from "vitest";
import executablePatternsJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/executable-patterns-v4.json";
import {AuthorityClock} from "./clock";
import type {CanonicalCombatStepInput} from "./combat-kernel";
import {CANONICAL_EVENT_IDS, isCanonicalEventId} from "./events";
import {
  admitLiveRoomCapability,
  type LiveRoomCapabilityAdmittedPlan,
} from "./live-run-admission";
import {
  LIVE_ROOM_EXECUTION_FIXTURE_SHA256,
  LIVE_ROOM_SESSION_CONTRACT,
  CanonicalLiveRoomExecutionFragment,
  type CanonicalLiveRoomExecutionOptions,
  type CanonicalLiveRoomExecutionSnapshot,
} from "./live-room-session";
import {V4_RUN_COMPOSER_METRIC_IDS} from "./run-composer";

const RAW_RUN_SEED = 0x1234_5678;
const FIXTURE_SHA256 = "b6a1eddf043960a43a3b2af99cadb355932b6ae26fafb9da1563232a642d2d1c";
const EVENT_TRACE_SHA256 = "0dceca99986974893345ce2d80e7aff31640e3bd551f98835223be2403016695";
const METRIC_CAPTURE_TICK120 = 960;
const PRE_READ_DURATION_TICK120 = 159;
const EARLIEST_READ_TICK120 = METRIC_CAPTURE_TICK120 + PRE_READ_DURATION_TICK120;
const DEFAULT_START_TICK120 = EARLIEST_READ_TICK120;
const SLICE_DURATION_TICK120 = 1542;
const SLICE_END_TICK120 = DEFAULT_START_TICK120 + SLICE_DURATION_TICK120;
const EXPECTED_BUDGET_EVIDENCE = {
  interpretation: "observational-only-no-enforcement",
  countingPolicy: "post-flush-active-arm-or-flight-entities",
  peakDigitalBodies: 56,
  peakAllAuthorityEntitiesIncludingResidue: 77,
  cumulativeSpawnCommits: 86,
  authoredEmitters: 2,
  listenTierMaxProjectiles: 80,
  listenTierMaxEmitters: 2,
  unresolved: "v4-does-not-author-concurrent-vs-residue-vs-cumulative-projectile-budget-counting",
} as const;

const patternById = new Map(executablePatternsJson.patterns.map((pattern) => [pattern.id, pattern]));

function xor(...values: readonly number[]): number {
  return values.reduce((result, value) => (result ^ value) >>> 0, 0);
}

function metrics(): Record<string, number> {
  return Object.fromEntries(V4_RUN_COMPOSER_METRIC_IDS.map((id, index) => [id, (index + 1) / 20]));
}

function fixedCandidate(): Record<string, unknown> {
  return {
    schemaVersion: "1.0.0-live-room-capability",
    authority: "caller-resolved-live-room",
    rawRunSeed: {domain: "raw-run-seed", value: RAW_RUN_SEED},
    metricSnapshot: {
      producerId: "test.behavior-ledger",
      producerVersion: "1.0.0",
      capturedAtTick120: 960,
      metrics: metrics(),
    },
    room: {
      roomId: "FORCED_ALIGNMENT",
      roomOrdinal: 0,
      tierId: "listen",
      difficulty: "EASY",
      encounters: [{
        occurrenceId: "room:0:encounter:0:room.forced.left_right_gate",
        patternId: "room.forced.left_right_gate",
        encounterOrdinal: 0,
        difficulty: "EASY",
        difficultySalt: 0x1100,
        resolvedSeed: {domain: "resolved-occurrence-seed", value: 0x7876_34f1},
        segments: {
          telegraphMs: 520,
          entryMs: 800,
          readMs: 10_200,
          materialSettleMs: 1050,
          restMs: 1600,
          safeGapHandoffMs: 520,
        },
        parallel: {
          mode: "none",
          selectionSeed: {domain: "parallel-selection-seed", value: 0x1234_ba38},
        },
      }],
    },
  };
}

function ballotCandidate(): Record<string, unknown> {
  const candidate = fixedCandidate();
  const encounter = ((candidate.room as {encounters: Array<Record<string, unknown>>}).encounters[0]!);
  encounter.occurrenceId = "room:0:encounter:0:room.forced.ballot_shift";
  encounter.patternId = "room.forced.ballot_shift";
  encounter.difficultySalt = 0x2200;
  encounter.resolvedSeed = {domain: "resolved-occurrence-seed", value: 0x63cd_1a1f};
  (encounter.segments as Record<string, number>).readMs = 12_000;
  (encounter.segments as Record<string, number>).materialSettleMs = 900;
  return candidate;
}

function twoEncounterCandidate(): Record<string, unknown> {
  const candidate = fixedCandidate();
  const ballot = patternById.get("room.forced.ballot_shift");
  if (ballot === undefined) throw new Error("V4 fixture lost Ballot Shift");
  const room = candidate.room as {encounters: Array<Record<string, unknown>>};
  room.encounters.push({
    occurrenceId: "room:0:encounter:1:room.forced.ballot_shift",
    patternId: ballot.id,
    encounterOrdinal: 1,
    difficulty: "EASY",
    difficultySalt: 0x2201,
    resolvedSeed: {
      domain: "resolved-occurrence-seed",
      value: xor(RAW_RUN_SEED, ballot.seed.base, 1, 0x2201),
    },
    segments: {
      telegraphMs: 520,
      entryMs: 800,
      readMs: 12_000,
      materialSettleMs: 900,
      restMs: 1600,
      safeGapHandoffMs: 520,
    },
    parallel: {
      mode: "none",
      selectionSeed: {domain: "parallel-selection-seed", value: 0x1234_ba39},
    },
  });
  return candidate;
}

function admittedHash(candidate: Record<string, unknown>): string {
  const result = admitLiveRoomCapability(candidate);
  expect(result.status).toBe("admitted");
  if (result.status !== "admitted") throw new Error("test candidate must admit");
  return result.gameplaySha256;
}

function admittedPlan(candidate: Record<string, unknown>): LiveRoomCapabilityAdmittedPlan {
  const result = admitLiveRoomCapability(candidate);
  expect(result.status).toBe("admitted");
  if (result.status !== "admitted") throw new Error("test candidate must admit");
  return result.plan;
}

function options(
  startTick120 = DEFAULT_START_TICK120,
  overrides: Partial<CanonicalLiveRoomExecutionOptions> = {},
): CanonicalLiveRoomExecutionOptions {
  return {
    expectedGameplaySha256: FIXTURE_SHA256,
    startTick120,
    initialPlayerPosition: {x: 180, y: 570},
    grazeRadiusPx: 18,
    projectileDamage: 1,
    projectilePoolClasses: {"bullet.micro.notch_e": "micro"},
    incomingReadBoundary: "caller-established-after-unexecuted-telegraph-and-entry",
    incomingSafeGap: "not-claimed",
    ...overrides,
  };
}

function inputAt(tick120: number): CanonicalCombatStepInput {
  return {
    tick120,
    movement: {x: 0, y: 0},
    focused: false,
  };
}

function tickAt(relativeTick120: number, startTick120 = DEFAULT_START_TICK120): number {
  return startTick120 + relativeTick120;
}

function stepTo(
  session: CanonicalLiveRoomExecutionFragment,
  targetTick120: number,
  input = inputAt,
): CanonicalLiveRoomExecutionSnapshot {
  let snapshot = session.snapshot();
  for (let tick120 = snapshot.tick120 + 1; tick120 <= targetTick120; tick120 += 1) {
    snapshot = tick120 === snapshot.boundaryTicks120.fixedSliceComplete
      ? session.closeSlice()
      : session.step(input(tick120));
  }
  return snapshot;
}

function isDeepFrozen(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value !== "object" || value === null || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value) && Object.values(value).every((entry) => isDeepFrozen(entry, seen));
}

function normalizeEventTime(value: unknown, startTick120: number, key = ""): unknown {
  if (typeof value === "number") {
    if (key === "tick120") return value - startTick120;
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

function cadenceDeltas(hz: number, targetTick120 = SLICE_DURATION_TICK120): readonly number[] {
  const frameMs = 1000 / hz;
  const totalMs = targetTick120 * 1000 / 120;
  const fullFrames = Math.floor(totalMs / frameMs);
  const deltas = Array.from({length: fullFrames}, () => frameMs);
  const remainder = totalMs - fullFrames * frameMs;
  if (remainder > 1e-9) deltas.push(remainder);
  return deltas;
}

function driveWithClock(
  deltas: readonly number[],
  projectionContext?: unknown,
  startTick120 = DEFAULT_START_TICK120,
): CanonicalLiveRoomExecutionFragment {
  const session = new CanonicalLiveRoomExecutionFragment(
    fixedCandidate(),
    options(startTick120),
    projectionContext,
  );
  const clock = new AuthorityClock({
    onTick120: ({tick120}) => {
      const executionTick120 = startTick120 + tick120;
      if (tick120 === SLICE_DURATION_TICK120) session.closeSlice();
      else session.step(inputAt(executionTick120));
    },
  });
  for (const delta of deltas) clock.advance(delta);
  while (clock.snapshot().backlogTicks > 0) clock.advance(0);
  expect(clock.snapshot().tick120).toBe(SLICE_DURATION_TICK120);
  return session;
}

describe("fixed caller-resolved live room execution contract", () => {
  it("pins the immutable fixture identity and recursively frozen initial snapshot", () => {
    expect(LIVE_ROOM_EXECUTION_FIXTURE_SHA256).toBe(FIXTURE_SHA256);
    expect(LIVE_ROOM_SESSION_CONTRACT).toEqual({
      schemaVersion: "1.0.0-canonical-live-room-read-slice",
      authority: "caller-resolved-singleton-read-slice-execution",
      fixtureGameplaySha256: FIXTURE_SHA256,
      roomId: "FORCED_ALIGNMENT",
      tierId: "listen",
      difficulty: "EASY",
      patternId: "room.forced.left_right_gate",
      composer: false,
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
      segmentProjection: "cumulative-first-non-early-tick120-from-read-entry",
      patternLocalTickZero: "caller-established-read-entry",
      metricCausality: "read-entry-at-or-after-metric-capture-plus-unexecuted-pre-read-duration",
      terminalBoundary: "internal-neutral-close-from-quiescent-state",
      nestedCombatReadiness: "occurrence-lifecycle-only-not-room-or-run-handoff",
      safeGapHandoffSerialDuration: false,
      serialSegmentsMs: {
        telegraph: 520,
        entry: 800,
        read: 10_200,
        materialSettle: 1050,
        rest: 1600,
        safeGapHandoff: 520,
      },
      budgetEvidence: EXPECTED_BUDGET_EVIDENCE,
    });
    expect(Object.isFrozen(LIVE_ROOM_SESSION_CONTRACT)).toBe(true);
    expect(isDeepFrozen(LIVE_ROOM_SESSION_CONTRACT)).toBe(true);

    const session = new CanonicalLiveRoomExecutionFragment(fixedCandidate(), options());
    expect(session.snapshot()).toMatchObject({
      authority: "canonical-live-room-read-slice-v4",
      admissionGameplaySha256: FIXTURE_SHA256,
      metricCapturedAtTick120: METRIC_CAPTURE_TICK120,
      phase: "read",
      tick120: DEFAULT_START_TICK120,
      relativeTick120: 0,
      boundaryTicks120: {
        start: DEFAULT_START_TICK120,
        read: DEFAULT_START_TICK120,
        materialSettle: tickAt(1224),
        rest: tickAt(1350),
        fixedSliceComplete: SLICE_END_TICK120,
        residueDeadline: tickAt(1540),
      },
      roomId: "FORCED_ALIGNMENT",
      roomOrdinal: 0,
      patternId: "room.forced.left_right_gate",
      occurrenceId: "room:0:encounter:0:room.forced.left_right_gate",
      encounterOrdinal: 0,
      tierId: "listen",
      difficulty: "EASY",
      composer: false,
      selectionAuthority: "caller-resolved",
      parallel: false,
      canonicalEventBus: true,
      runHandoff: false,
      fixedSliceComplete: false,
      roomComplete: false,
      timedStateQuiescent: true,
      combat: {relativeTick120: 0, occurrenceLifecycleReady: false},
      handoffReady: false,
      faulted: false,
      adapterPolicy: {
        readBoundary: "caller-established-after-unexecuted-telegraph-and-entry",
        incomingSafeGap: "not-claimed",
        preReadAuthority: "telegraph-and-entry-outside-fragment-unexecuted",
        segmentProjection: "cumulative-first-non-early-tick120-from-read-entry",
        patternLocalTickZero: "caller-established-read-entry",
        metricCausality: "read-entry-at-or-after-metric-capture-plus-unexecuted-pre-read-duration",
        terminalBoundary: "internal-neutral-close-from-quiescent-state",
        nestedCombatReadiness: "occurrence-lifecycle-only-not-room-or-run-handoff",
        safeGapHandoff: "validated-scalar-not-a-serial-window-or-spatial-proof",
        budget: EXPECTED_BUDGET_EVIDENCE,
        provenance: "application-required-v4-omission",
      },
    });
    expect(isDeepFrozen(session.snapshot())).toBe(true);
    expect(isDeepFrozen(session.admittedPlan())).toBe(true);
    expect(session.admittedPlan()).toEqual(admittedPlan(fixedCandidate()));
    expect(session.events()).toEqual([]);
    expect(session.canonicalEventSerialization()).toBe("[]");
  });

  it("executes only READ and its terminal tail from a caller-established nonzero boundary", () => {
    const assertBoundaries = (startTick120: number): void => {
      const session = new CanonicalLiveRoomExecutionFragment(fixedCandidate(), options(startTick120));
      expect(session.snapshot()).toMatchObject({
        phase: "read",
        tick120: startTick120,
        combat: {relativeTick120: 0},
      });
      expect(stepTo(session, startTick120 + 1223).phase).toBe("read");
      expect(session.step(inputAt(startTick120 + 1224)).phase).toBe("material_settle");
      expect(stepTo(session, startTick120 + 1349).phase).toBe("material_settle");
      expect(session.step(inputAt(startTick120 + 1350)).phase).toBe("rest");
      expect(stepTo(session, startTick120 + 1541).phase).toBe("rest");
      expect(session.closeSlice()).toMatchObject({
        phase: "slice_complete",
        fixedSliceComplete: true,
        roomComplete: false,
        handoffReady: false,
        runHandoff: false,
      });
    };

    assertBoundaries(DEFAULT_START_TICK120);
    assertBoundaries(DEFAULT_START_TICK120 + 101);
  });

  it("starts at READ tick zero without claiming telegraph/entry or emitting pseudo schedule IDs", () => {
    const session = new CanonicalLiveRoomExecutionFragment(fixedCandidate(), options());
    expect(session.snapshot()).toMatchObject({phase: "read", combat: {relativeTick120: 0}});
    expect(session.events()).toEqual([]);

    stepTo(session, SLICE_END_TICK120);
    const ids = session.events().map((event) => event.id);
    expect(ids.every(isCanonicalEventId)).toBe(true);
    expect(ids.every((id) => CANONICAL_EVENT_IDS.includes(id))).toBe(true);
    expect(ids.some((id) => id.startsWith("room.transition."))).toBe(false);
    expect(ids).not.toContain("run.end.commit");
    expect(ids.some((id) => id.startsWith("boss."))).toBe(false);
    expect(ids.some((id) => id.startsWith("weather."))).toBe(false);
    for (const pseudo of [
      "room.enter",
      "encounter.begin",
      "segment.telegraph",
      "segment.entry",
      "segment.read",
      "segment.material_settle",
      "segment.rest",
      "material.settle",
    ]) expect(ids).not.toContain(pseudo);
    expect(session.canonicalEventSerialization()).not.toContain("transition.room_threshold");
  });

  it("releases the final residue at +1540, then closes two eventless tail ticks", () => {
    const session = new CanonicalLiveRoomExecutionFragment(fixedCandidate(), options());
    const beforeRelease = stepTo(session, tickAt(1539));
    expect(beforeRelease).toMatchObject({
      phase: "rest",
      handoffReady: false,
      runCombat: {activeOccurrenceId: expect.any(String)},
    });
    const released = session.step(inputAt(tickAt(1540)));
    expect(released).toMatchObject({
      phase: "rest",
      handoffReady: false,
      runCombat: {activeOccurrenceId: null},
    });
    const eventCount = session.events().length;
    expect(session.events().filter((event) => event.tick120 === tickAt(1540)).map((event) => event.id))
      .toEqual(expect.arrayContaining(["projectile.residue.remove", "projectile.lifecycle.complete"]));

    expect(session.step(inputAt(tickAt(1541)))).toMatchObject({phase: "rest", handoffReady: false});
    expect(session.events()).toHaveLength(eventCount);
    expect(session.closeSlice()).toMatchObject({
      phase: "slice_complete",
      fixedSliceComplete: true,
      roomComplete: false,
      handoffReady: false,
      runHandoff: false,
      runCombat: {activeOccurrenceId: null},
    });
    expect(session.events()).toHaveLength(eventCount);
    expect(session.events().at(-1)?.tick120).toBe(tickAt(1540));
  });

  it("reserves the terminal boundary for neutral closure and refuses to strand a timer", () => {
    const gameplayAtBoundary = new CanonicalLiveRoomExecutionFragment(fixedCandidate(), options());
    stepTo(gameplayAtBoundary, tickAt(1541));
    const gameplayEvents = gameplayAtBoundary.canonicalEventSerialization();
    expect(() => gameplayAtBoundary.step(inputAt(SLICE_END_TICK120))).toThrow(/closeSlice|terminal/);
    expect(gameplayAtBoundary.snapshot()).toMatchObject({
      tick120: tickAt(1541),
      phase: "rest",
      fixedSliceComplete: false,
      faulted: true,
    });
    expect(gameplayAtBoundary.canonicalEventSerialization()).toBe(gameplayEvents);

    const pendingTimer = new CanonicalLiveRoomExecutionFragment(fixedCandidate(), options());
    stepTo(pendingTimer, tickAt(1540));
    pendingTimer.step({
      ...inputAt(tickAt(1541)),
      overridePressed: true,
      overrideDirection: {x: 0, y: -1},
    });
    expect(() => pendingTimer.closeSlice()).toThrow(/timer|quiescent|strand/);
    expect(pendingTimer.snapshot()).toMatchObject({
      tick120: tickAt(1541),
      fixedSliceComplete: false,
      timedStateQuiescent: false,
      faulted: true,
    });

    const session = new CanonicalLiveRoomExecutionFragment(fixedCandidate(), options());
    stepTo(session, tickAt(1541));
    const eventCount = session.events().length;
    const scheduledComplete = session.closeSlice();
    expect(scheduledComplete).toMatchObject({
      tick120: SLICE_END_TICK120,
      relativeTick120: SLICE_DURATION_TICK120,
      phase: "slice_complete",
      boundaryTicks120: {fixedSliceComplete: SLICE_END_TICK120},
      fixedSliceComplete: true,
      roomComplete: false,
      timedStateQuiescent: true,
      handoffReady: false,
      runHandoff: false,
      runCombat: {override: {state: "idle"}},
      combat: {occurrenceLifecycleReady: true},
    });
    expect(scheduledComplete.combat).not.toHaveProperty("handoffReady");
    expect(session.events()).toHaveLength(eventCount);
    expect(session.events().some((event) => event.id.startsWith("room.transition."))).toBe(false);
  });
});

describe("live room execution admission and fail-closed ownership", () => {
  it("re-admits only the raw candidate without mutation and ignores projection access", () => {
    const candidate = fixedCandidate();
    const before = JSON.stringify(candidate);
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const session = new CanonicalLiveRoomExecutionFragment(candidate, options(), revoked.proxy);

    expect(JSON.stringify(candidate)).toBe(before);
    expect(session.admittedPlan()).toEqual(admittedPlan(fixedCandidate()));

    const forgedPlan = admittedPlan(fixedCandidate());
    expect(() => new CanonicalLiveRoomExecutionFragment(forgedPlan, options())).toThrow();
    expect(() => new CanonicalLiveRoomExecutionFragment(fixedCandidate(), options(DEFAULT_START_TICK120, {
      expectedGameplaySha256: "0".repeat(64),
    }))).toThrow(/hash|SHA/i);
  });

  it("never invokes candidate or option accessors", () => {
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
    expect(() => new CanonicalLiveRoomExecutionFragment(candidate, options())).toThrow(/accessor/);
    expect(candidateReads).toBe(0);

    let optionReads = 0;
    const hostileOptions = Object.defineProperty(
      {...options()},
      "expectedGameplaySha256",
      {
        enumerable: true,
        get() {
          optionReads += 1;
          return FIXTURE_SHA256;
        },
      },
    );
    expect(() => new CanonicalLiveRoomExecutionFragment(fixedCandidate(), hostileOptions))
      .toThrow(/own data property|accessor/);
    expect(optionReads).toBe(0);
  });

  it("rejects unsupported room scope, parallelism, tail, pool, boundary, and budget before stepping", () => {
    const multiple = twoEncounterCandidate();
    expect(() => new CanonicalLiveRoomExecutionFragment(multiple, options(DEFAULT_START_TICK120, {
      expectedGameplaySha256: admittedHash(multiple),
    }))).toThrow(/encounter|singleton|scope|fixture/i);

    const parallel = fixedCandidate();
    const parallelEncounter = ((parallel.room as {encounters: Array<Record<string, unknown>>}).encounters[0]!);
    const rain = patternById.get("encounter.weather_echo.rain_packets");
    if (rain === undefined) throw new Error("V4 fixture lost Rain Packets");
    parallelEncounter.parallel = {
      mode: "member",
      occurrenceId: "parallel:0:0:rain",
      patternId: rain.id,
      difficulty: "EASY",
      difficultySalt: 0x4400,
      resolvedSeed: {
        domain: "resolved-occurrence-seed",
        value: xor(RAW_RUN_SEED, rain.seed.base, 0, 0x4400),
      },
      selectionSeed: {domain: "parallel-selection-seed", value: 0x1234_ba38},
    };
    expect(() => new CanonicalLiveRoomExecutionFragment(parallel, options(DEFAULT_START_TICK120, {
      expectedGameplaySha256: admittedHash(parallel),
    }))).toThrow(/parallel|fixture|scope/i);

    const shortTail = fixedCandidate();
    const shortEncounter = ((shortTail.room as {encounters: Array<{segments: Record<string, number>}>})
      .encounters[0]!);
    shortEncounter.segments.materialSettleMs = 900;
    expect(() => new CanonicalLiveRoomExecutionFragment(shortTail, options(DEFAULT_START_TICK120, {
      expectedGameplaySha256: admittedHash(shortTail),
    }))).toThrow(/settle|tail|fixture/i);

    const otherOrder = fixedCandidate();
    (otherOrder.room as Record<string, unknown>).roomOrdinal = 1;
    expect(() => new CanonicalLiveRoomExecutionFragment(otherOrder, options())).toThrow(/admission|order|room/i);

    expect(() => new CanonicalLiveRoomExecutionFragment(fixedCandidate(), options(DEFAULT_START_TICK120, {
      projectilePoolClasses: {},
    }))).toThrow(/pool|mapping|projectilePoolClasses|own data property/);
    const noIncomingBoundary = {...options()} as unknown as Record<string, unknown>;
    delete noIncomingBoundary.incomingReadBoundary;
    expect(() => new CanonicalLiveRoomExecutionFragment(
      fixedCandidate(),
      noIncomingBoundary as unknown as CanonicalLiveRoomExecutionOptions,
    )).toThrow(/boundary|required|incomingReadBoundary|own data property/);
    const falseReadBoundary = {
      ...options(),
      incomingReadBoundary: "caller-guessed-before-entry",
    } as unknown as CanonicalLiveRoomExecutionOptions;
    expect(() => new CanonicalLiveRoomExecutionFragment(fixedCandidate(), falseReadBoundary))
      .toThrow(/READ boundary|incomingReadBoundary/);
    const forgedSafeGap = {
      ...options(),
      incomingSafeGap: "proved-by-presentation",
    } as unknown as CanonicalLiveRoomExecutionOptions;
    expect(() => new CanonicalLiveRoomExecutionFragment(fixedCandidate(), forgedSafeGap))
      .toThrow(/safe gap|incomingSafeGap/);

    const ballot = ballotCandidate();
    expect(admittedHash(ballot)).toBe(
      "fea078a46315927d2f145be380ad7f38e6cbfef154e95337fd1ac9c90dcdc2a7",
    );
    expect(() => new CanonicalLiveRoomExecutionFragment(ballot, options(DEFAULT_START_TICK120, {
      expectedGameplaySha256: admittedHash(ballot),
    }))).toThrow(/qualified fixed-slice evidence|fixture|pattern/i);
  });

  it("rejects negative-zero, unsafe, and cumulatively overflowing start ticks before execution", () => {
    for (const startTick120 of [
      -0,
      Number.MAX_SAFE_INTEGER + 1,
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER - 1541,
    ]) {
      expect(() => new CanonicalLiveRoomExecutionFragment(
        fixedCandidate(),
        options(startTick120),
      )).toThrow(/startTick120|safe|boundary|range/i);
    }
    expect(() => new CanonicalLiveRoomExecutionFragment(
      fixedCandidate(),
      options(EARLIEST_READ_TICK120 - 1),
    )).toThrow(/precede|metric|telegraph|entry/);
    expect(() => new CanonicalLiveRoomExecutionFragment(
      fixedCandidate(),
      options(EARLIEST_READ_TICK120),
    )).not.toThrow();
  });

  it("requires exact-next ticks and permanently fail-stops every step error", () => {
    const skipped = new CanonicalLiveRoomExecutionFragment(fixedCandidate(), options());
    expect(() => skipped.step(inputAt(tickAt(2)))).toThrow(/one tick|exact.next|1/i);
    expect(skipped.snapshot()).toMatchObject({tick120: DEFAULT_START_TICK120, faulted: true});
    expect(() => skipped.step(inputAt(tickAt(1)))).toThrow(/fault/);
    expect(skipped.events()).toEqual([]);

    const hostile = new CanonicalLiveRoomExecutionFragment(fixedCandidate(), options());
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
    expect(() => hostile.step(inputAt(tickAt(1)))).toThrow(/fault/);
  });

  it("fails a reentrant step without consuming its boundary", () => {
    const session = new CanonicalLiveRoomExecutionFragment(fixedCandidate(), options());
    let attempted = false;
    const input = new Proxy(inputAt(tickAt(1)), {
      getOwnPropertyDescriptor(target, key) {
        if (!attempted && key === "tick120") {
          attempted = true;
          session.step(inputAt(tickAt(1)));
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    expect(() => session.step(input)).toThrow(/in progress|reentrant|fault/);
    expect(attempted).toBe(true);
    expect(session.snapshot()).toMatchObject({tick120: DEFAULT_START_TICK120, faulted: true});
    expect(session.events()).toEqual([]);
    expect(() => session.step(inputAt(tickAt(1)))).toThrow(/fault/);
  });

  it("rejects every step after the fixed slice closes and retains its evidence", () => {
    const session = new CanonicalLiveRoomExecutionFragment(fixedCandidate(), options());
    const completed = stepTo(session, SLICE_END_TICK120);
    const eventSerialization = session.canonicalEventSerialization();
    expect(completed).toMatchObject({
      phase: "slice_complete",
      fixedSliceComplete: true,
      roomComplete: false,
      handoffReady: false,
      faulted: false,
    });
    expect(() => session.step(inputAt(SLICE_END_TICK120 + 1))).toThrow(/slice|closed/);
    expect(session.snapshot()).toMatchObject({
      phase: "slice_complete",
      tick120: SLICE_END_TICK120,
      handoffReady: false,
      faulted: true,
    });
    expect(session.canonicalEventSerialization()).toBe(eventSerialization);
    expect(() => session.step(inputAt(SLICE_END_TICK120 + 1))).toThrow(/fault/);
  });
});

describe("live room execution continuity and deterministic projection opacity", () => {
  it("retains player, evidence, and a cancelled Override cycle across READ and terminal tail", () => {
    const session = new CanonicalLiveRoomExecutionFragment(fixedCandidate(), options());
    session.step({
      ...inputAt(tickAt(1)),
      movement: {x: 1, y: 0},
      overridePressed: true,
      overrideDirection: {x: 0, y: -1},
    });
    session.step({...inputAt(tickAt(2)), overrideReleased: true});
    const duringRead = stepTo(session, tickAt(158));
    const carriedPosition = duringRead.runCombat.playerPosition;
    expect(carriedPosition.x).toBeCloseTo(180 + 188 / 120, 12);
    expect(carriedPosition.y).toBe(570);
    expect(duringRead.runCombat).toMatchObject({
      evidence: {amount: 0},
      override: {state: "idle", cycle: 1},
    });
    expect(session.step({...inputAt(tickAt(159)), focused: true})).toMatchObject({
      phase: "read",
      combat: {
        relativeTick120: 159,
        playerPosition: carriedPosition,
        evidence: {amount: 0},
        override: {state: "idle", cycle: 1},
      },
      runCombat: {
        playerPosition: carriedPosition,
        focused: true,
        evidence: {amount: 0},
        override: {state: "idle", cycle: 1},
      },
    });
    const final = stepTo(session, SLICE_END_TICK120);
    expect(final.runCombat).toMatchObject({
      playerPosition: carriedPosition,
      evidence: {amount: 0},
      override: {state: "idle", cycle: 1},
    });
    expect(session.events().filter((event) => event.id === "player.override.charge.begin"))
      .toHaveLength(1);
    expect(session.events().filter((event) => event.id === "player.override.charge.cancel"))
      .toHaveLength(1);
  });

  it("keeps lifecycle and event identity relative to adjacent causal READ starts", () => {
    const baseline = new CanonicalLiveRoomExecutionFragment(
      fixedCandidate(),
      options(DEFAULT_START_TICK120),
    );
    const adjacentStartTick120 = DEFAULT_START_TICK120 + 1;
    const adjacent = new CanonicalLiveRoomExecutionFragment(
      fixedCandidate(),
      options(adjacentStartTick120),
    );
    stepTo(baseline, DEFAULT_START_TICK120 + SLICE_DURATION_TICK120);
    stepTo(adjacent, adjacentStartTick120 + SLICE_DURATION_TICK120);

    expect(adjacent.events()).toHaveLength(baseline.events().length);
    expect(adjacent.events().map((event) => normalizeEventTime(event, adjacentStartTick120)))
      .toEqual(baseline.events().map((event) => normalizeEventTime(event, DEFAULT_START_TICK120)));
    expect(adjacent.snapshot()).toMatchObject({
      relativeTick120: SLICE_DURATION_TICK120,
      phase: "slice_complete",
      combat: {
        relativeTick120: 1540,
        rngCallsConsumed: baseline.snapshot().combat.rngCallsConsumed,
        occurrenceLifecycleReady: true,
      },
    });
  });

  it("preserves collision-off before impact and player damage through the READ wrapper", () => {
    const session = new CanonicalLiveRoomExecutionFragment(fixedCandidate(), options(
      DEFAULT_START_TICK120,
      {initialPlayerPosition: {x: 120, y: 570}},
    ));
    const hitTick120 = tickAt(591);
    const hit = stepTo(session, hitTick120);
    expect(hit.combat.lastDamageBatch).toMatchObject({
      tick120: hitTick120,
      branch: "non-fatal",
    });
    const events = session.events().filter((event) => event.tick120 === hitTick120);
    const collisionOff = events.findIndex((event) => event.id === "projectile.collision.off");
    const impact = events.findIndex((event) => event.id === "projectile.impact.commit");
    const damage = events.findIndex((event) => event.id === "player.damage.commit");
    expect(collisionOff).toBeGreaterThanOrEqual(0);
    expect(impact).toBeGreaterThan(collisionOff);
    expect(damage).toBeGreaterThan(impact);
    expect(events[collisionOff]?.phasePriority).toBe(0);
    expect(events[impact]?.phasePriority).toBe(1);
    expect(events[damage]?.phasePriority).toBe(1);
  });

  it("measures the qualified fixture budget peaks without turning them into execution policy", () => {
    const session = new CanonicalLiveRoomExecutionFragment(fixedCandidate(), options());
    let peakDigitalBodies = 0;
    let peakLiveColliders = 0;
    let peakAllAuthorityEntities = 0;
    let peakResidueVisuals = 0;
    let allocatedMicroHighWater = 0;
    for (
      let tick120 = DEFAULT_START_TICK120 + 1;
      tick120 <= SLICE_END_TICK120;
      tick120 += 1
    ) {
      const combat = (tick120 === SLICE_END_TICK120
        ? session.closeSlice()
        : session.step(inputAt(tick120))).combat;
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
    expect({
      peakDigitalBodies,
      peakLiveColliders,
      peakAllAuthorityEntities,
      peakResidueVisuals,
      allocatedMicroHighWater,
      cumulativeSpawnCommits: session.events().filter((event) =>
        event.id === "projectile.spawn.commit").length,
    }).toEqual({
      peakDigitalBodies: 56,
      peakLiveColliders: 56,
      peakAllAuthorityEntities: 77,
      peakResidueVisuals: 74,
      allocatedMicroHighWater: 77,
      cumulativeSpawnCommits: 86,
    });
    expect(LIVE_ROOM_SESSION_CONTRACT.budgetEvidence.interpretation)
      .toBe("observational-only-no-enforcement");
  });

  it("pins the full neutral trace and stays identical across cadence, backlog, and opaque projections", () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const contexts = [
      {accessibilityProfile: "full", weather: {id: "STATIC", seed: 1}},
      {accessibilityProfile: "reducedMotion"},
      {accessibilityProfile: "flashOff", weather: {id: "ECLIPSE", seed: 0xffff_ffff}},
      revoked.proxy,
    ];
    const sessions = [
      driveWithClock(cadenceDeltas(30), contexts[0]),
      driveWithClock(cadenceDeltas(60), contexts[1]),
      driveWithClock(cadenceDeltas(144), contexts[2]),
      driveWithClock([SLICE_DURATION_TICK120 * 1000 / 120], contexts[3]),
    ];
    const baseline = sessions[0]!;
    const serialization = baseline.canonicalEventSerialization();
    expect(createHash("sha256").update(serialization).digest("hex")).toBe(EVENT_TRACE_SHA256);
    expect(baseline.events()).toHaveLength(860);
    expect(baseline.events()[0]?.tick120).toBe(tickAt(88));
    expect([...new Set(baseline.events().map((event) => event.id))].sort()).toEqual([
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
    ]);
    expect(baseline.events().filter((event) => event.id === "projectile.spawn.commit")).toHaveLength(86);
    expect(baseline.snapshot()).toMatchObject({
      phase: "slice_complete",
      fixedSliceComplete: true,
      roomComplete: false,
      handoffReady: false,
      combat: {rngCallsConsumed: 99, occurrenceLifecycleReady: true},
      runHandoff: false,
      faulted: false,
    });
    for (const session of sessions.slice(1)) {
      expect(session.canonicalEventSerialization()).toBe(serialization);
      expect(session.snapshot()).toEqual(baseline.snapshot());
    }
  }, 15_000);
});
