import {describe, expect, it} from "vitest";
import {
  CanonicalEventBus,
  serializeCanonicalEvents,
  type CanonicalGameplayEvent,
} from "./events";
import {
  CROSS_RUN_RESTORE_AUTHORITY_CONTRACT,
  CrossRunRestoreAuthority,
  CrossRunRestoreConsumptionLedger,
} from "./cross-run-restore";
import {
  assertRunMemory,
  captureRecorderIssuedRunMemory,
  parseRunMemory,
  readRecorderIssuedRunMemory,
  RunMemoryRecorder,
  type FinalizedRunMemory,
  type RecorderIssuedRunMemoryToken,
} from "../game/run-memory";
import {
  NarrativeAuthority,
  validateNarrativeRecord,
} from "./narrative";

function createMemory(
  routePointCount = 3,
  runId = "run-cross-restore-v4",
): FinalizedRunMemory {
  const recorder = new RunMemoryRecorder({
    runId,
    seed: 0x41c0,
    startedAtTick: 0,
  });
  recorder.recordBehaviorFact({
    segmentId: "information-entry",
    room: "INFORMATION",
    atTick: 0,
    eventId: "room-enter-information",
    kind: "ROOM_ENTER",
  });
  if (routePointCount === 3) {
    recorder.recordGhostPoint({
      tMs: 0,
      xNorm: 0.125,
      yNorm: 0.875,
      room: "INFORMATION",
      flower: 0.25,
      focus: false,
      flags: ["ROOM_ENTER"],
    });
    recorder.recordGhostPoint({
      tMs: 480,
      xNorm: 0.5,
      yNorm: 0.625,
      room: "IN_BETWEEN",
      flower: 0.5,
      focus: true,
      flags: ["GAZE", "SEAM_CROSS"],
    });
    recorder.recordGhostPoint({
      tMs: 960,
      xNorm: 0.75,
      yNorm: 0.25,
      room: "POLARIZED",
      flower: 0.75,
      focus: false,
      flags: ["OVERRIDE"],
    });
  } else {
    for (let index = 0; index < routePointCount; index += 1) {
      recorder.recordGhostPoint({
        tMs: index * 120,
        xNorm: index / (routePointCount - 1),
        yNorm: 1 - index / (routePointCount - 1),
        room: "INFORMATION",
        flower: index / (routePointCount - 1),
        focus: index % 2 === 0,
        flags: ["GAZE"],
      });
    }
  }
  recorder.addOverrideScar({
    id: "scar-cross-restore",
    position: {room: "POLARIZED", xNorm: 0.75, yNorm: 0.25},
    direction8: "NW",
    localVoidRadiusPx: 28,
    createdAtTick: 80,
    persistenceRuns: 2,
  });
  recorder.addDeathTrace({
    id: "death-cross-restore",
    position: {room: "IN_BETWEEN", xNorm: 0.5, yNorm: 0.625},
    damageVector: [0, -1],
    createdAtTick: 90,
    causeArchetype: "pattern.unanswered_fan",
  });
  recorder.addBurnIn({
    id: "burn-cross-restore",
    room: "INFORMATION",
    captureDigest: "a".repeat(64),
    gazeStillMs: 2100,
    decayTicks: 80,
  });
  return recorder.finalize({
    endedAtTick: 240,
    durationMs: 2000,
    roomsVisited: ["INFORMATION", "IN_BETWEEN", "POLARIZED"],
    resolution: {
      reason: "NO_DUSK_WITHDRAWAL",
      bossId: "no_dusk",
      factEventId: "boss.noDusk.protocolRetracted",
    },
  });
}

function trusted(memory: FinalizedRunMemory): RecorderIssuedRunMemoryToken {
  return captureRecorderIssuedRunMemory(memory);
}

function createMemoryWithoutRoute(): FinalizedRunMemory {
  const recorder = new RunMemoryRecorder({
    runId: "run-cross-restore-without-route",
    seed: 17,
    startedAtTick: 0,
  });
  recorder.recordBehaviorFact({
    segmentId: "information-entry",
    room: "INFORMATION",
    atTick: 0,
    eventId: "room-enter-information",
    kind: "ROOM_ENTER",
  });
  return recorder.finalize({
    endedAtTick: 120,
    durationMs: 1000,
    roomsVisited: ["INFORMATION"],
    resolution: {
      reason: "PROTOCOL_WITHDRAWAL",
      bossId: null,
      factEventId: "run.protocol.withdrawal",
    },
  });
}

function make(): Readonly<{
  readonly bus: CanonicalEventBus;
  readonly ledger: CrossRunRestoreConsumptionLedger;
  readonly authority: CrossRunRestoreAuthority;
}> {
  const bus = new CanonicalEventBus();
  const ledger = new CrossRunRestoreConsumptionLedger();
  return Object.freeze({
    bus,
    ledger,
    authority: new CrossRunRestoreAuthority(bus, ledger),
  });
}

function flushIds(bus: CanonicalEventBus): readonly (readonly [string, number])[] {
  return bus.flush().map((event) => [event.id, event.tick120] as const);
}

describe("immutable route-present cross-run restore contract", () => {
  it("pins the narrow RunMemory boundary, runtime60 policy, and one-way presentation edge", () => {
    expect(CROSS_RUN_RESTORE_AUTHORITY_CONTRACT).toEqual({
      authority: "v4-cross-run-restore",
      masterTickHz: 120,
      runtimeBoundaryTick120: "even",
      acceptedStartTick120: "even-runtime60-boundary",
      boundaryPolicy: "first-non-early-runtime60-boundary",
      largeDeltaPolicy: "traverse-every-crossed-authoritative-boundary",
      maximumBoundariesPerAdvance: 1024,
      recordBoundary: "opaque-recorder-issued-in-memory-token-to-narrow-restore-record",
      persistedOrParsedRunMemory: "unsupported",
      compressedRouteDigestRecomputation: "forbidden",
      runtimeSnapshotRecordSeedAdapter: "none",
      routeRequirement: "non-null-actual-player-route",
      inputPolicy: "withheld-until-returnInput",
      presentationDirection: "canonical-event-to-passive-feedback-only",
      runtimeTimingMs: {
        materialRehydrate: 0,
        ghostReplayBegin: 420,
        ghostReplayCompleteOffset: 420,
        ghostResidueWriteOffset: 421,
        witnessTurnOffset: 700,
        inputReturnOffset: 1140,
      },
    });
    expect(Object.isFrozen(CROSS_RUN_RESTORE_AUTHORITY_CONTRACT)).toBe(true);
    expect(Object.isFrozen(CROSS_RUN_RESTORE_AUTHORITY_CONTRACT.runtimeTimingMs)).toBe(true);
  });

  it("rejects substitute bus and ledger capabilities", () => {
    const bus = new CanonicalEventBus();
    const ledger = new CrossRunRestoreConsumptionLedger();
    class BusSubclass extends CanonicalEventBus {}
    class LedgerSubclass extends CrossRunRestoreConsumptionLedger {}

    expect(() => new CrossRunRestoreAuthority({}, ledger)).toThrow(/exact CanonicalEventBus/);
    expect(() => new CrossRunRestoreAuthority(new BusSubclass(), ledger)).toThrow(
      /exact CanonicalEventBus/,
    );
    expect(() => new CrossRunRestoreAuthority(bus, {})).toThrow(/exact CrossRunRestoreConsumptionLedger/);
    expect(() => new LedgerSubclass()).toThrow(/must not be subclassed/);
  });

  it("uses the intrinsic bus append boundary despite an own enqueueBatch shadow", () => {
    const bus = new CanonicalEventBus();
    let shadowCalls = 0;
    Object.defineProperty(bus, "enqueueBatch", {
      configurable: true,
      value: () => { shadowCalls += 1; },
    });
    const authority = new CrossRunRestoreAuthority(
      bus,
      new CrossRunRestoreConsumptionLedger(),
    );
    authority.begin(trusted(createMemory()), "run-cross-restore-shadow", 0);
    expect(shadowCalls).toBe(0);
    expect(bus.flush()).toHaveLength(5);
    authority.advance(52);
    expect(shadowCalls).toBe(0);
    expect(bus.flush().map(({id}) => id)).toEqual(["ghost.replay.begin"]);
  });
});

describe("route-present restore lifecycle", () => {
  it("atomically withholds input and rehydrates disjoint material at the aligned start boundary", () => {
    const memory = createMemory();
    const route = memory.ghostRoute;
    if (route === null) throw new Error("test route disappeared");
    const {bus, authority} = make();
    const snapshot = authority.begin(trusted(memory), "run-cross-restore-next", 0);

    expect(snapshot).toEqual({
      authority: "v4-cross-run-restore",
      tick120: 0,
      requestedStartTick120: 0,
      state: "waiting-ghost",
      fromRunId: memory.run.id,
      nextRunId: "run-cross-restore-next",
      routeDigest: route.routeDigest,
      routeDurationMs: 960,
      inputWithheld: true,
      nextStep: 0,
      eventCount: 5,
      schedule: {
        materialRehydrateTick120: 0,
        ghostReplayBeginTick120: 52,
        ghostReplayCompleteTick120: 166,
        ghostResidueWriteTick120: 166,
        witnessTurnTick120: 200,
        inputReturnTick120: 252,
      },
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.schedule)).toBe(true);

    const events = bus.flush();
    expect(events.map((event) => event.id)).toEqual([
      "player.input.off",
      "cross_run.restore.begin",
      "overrideScar.rehydrate",
      "deathTrace.rehydrate",
      "burnIn.rehydrate",
    ]);
    expect(events.map((event) => event.localSequence)).toEqual([0, 1, 2, 3, 4]);
    expect(events.every((event) => event.entityStableId === "cross-run-restore")).toBe(true);
    expect(events[0]?.payload).toEqual({reason: "cross-run-restore"});
    expect(events[1]?.payload).toEqual({
      fromRunId: memory.run.id,
      nextRunId: "run-cross-restore-next",
      routeDigest: route.routeDigest,
      routeDurationMs: 960,
    });
    expect(events[2]?.payload).toEqual({
      fromRunId: memory.run.id,
      nextRunId: "run-cross-restore-next",
      recordType: "overrideScar",
      count: 1,
      records: memory.materialMemory.overrideScars,
    });
    expect(events[3]?.payload).toMatchObject({recordType: "deathTrace", count: 1});
    expect(events[4]?.payload).toMatchObject({recordType: "burnIn", count: 1});
    expect(events.some((event) => "deterministicSeed" in event.payload)).toBe(false);
  });

  it("emits actual route/NONE semantics, residue, witness, then returns input exactly once", () => {
    const memory = createMemory();
    const route = memory.ghostRoute;
    if (route === null) throw new Error("test route disappeared");
    const {bus, authority} = make();
    authority.begin(trusted(memory), "run-cross-restore-next", 0);
    bus.flush();

    expect(authority.advance(51)).toMatchObject({state: "waiting-ghost", inputWithheld: true});
    expect(bus.flush()).toEqual([]);
    expect(authority.advance(52)).toMatchObject({state: "replaying-ghost", inputWithheld: true});
    const replay = bus.flush()[0];
    expect(replay).toMatchObject({id: "ghost.replay.begin", tick120: 52, localSequence: 5});
    expect(replay?.payload).toEqual({
      fromRunId: memory.run.id,
      nextRunId: "run-cross-restore-next",
      routeDigest: route.routeDigest,
      routeDurationMs: 960,
      pointCount: route.points.length,
      routePoints: route.points,
      timeScale: 1,
      collisionClass: "NONE",
      rewardClass: "NONE",
      emitterClass: "NONE",
    });

    expect(authority.advance(165).state).toBe("replaying-ghost");
    expect(bus.flush()).toEqual([]);
    expect(authority.advance(166)).toMatchObject({state: "waiting-witness", inputWithheld: true});
    const burnout = bus.flush();
    expect(burnout.map((event) => [event.id, event.tick120, event.localSequence])).toEqual([
      ["ghost.replay.complete", 166, 6],
      ["ghost.residue.write", 166, 7],
    ]);
    expect(burnout[0]?.payload).toMatchObject({
      finalPoint: {tMs: 960, xNorm: 0.75, yNorm: 0.25, room: "POLARIZED"},
      burnAfterRead: true,
    });
    expect(burnout[1]?.payload).toMatchObject({
      residueId: `ghost-residue:${memory.run.id}:run-cross-restore-next`,
      sourceRouteDigest: route.routeDigest,
      createdAfterReplay: true,
      persistenceRuns: 1,
      position: {room: "POLARIZED", xNorm: 0.75, yNorm: 0.25},
      priorGhostResidueCount: 0,
    });

    expect(authority.advance(199).state).toBe("waiting-witness");
    expect(bus.flush()).toEqual([]);
    expect(authority.advance(200)).toMatchObject({state: "orienting-witnesses", inputWithheld: true});
    expect(bus.flush()[0]).toMatchObject({
      id: "witness.turn",
      tick120: 200,
      localSequence: 8,
      payload: {
        evaluatedAfterGhostResidue: true,
        overrideScarIds: ["scar-cross-restore"],
        ghostEndpoint: {room: "POLARIZED", xNorm: 0.75, yNorm: 0.25},
        priority: [
          "nearbyOverrideScar",
          "ghostEndpoint",
          "resistanceTransmission",
          "eclipse",
          "resonance",
          "clamp",
          "idle",
        ],
      },
    });

    expect(authority.advance(251)).toMatchObject({state: "orienting-witnesses", inputWithheld: true});
    expect(bus.flush()).toEqual([]);
    expect(authority.advance(252)).toMatchObject({
      state: "ready",
      inputWithheld: false,
      nextStep: 5,
      eventCount: 11,
    });
    expect(flushIds(bus)).toEqual([
      ["returnInput", 252],
      ["cross_run.restore.complete", 252],
    ]);
    authority.advance(10_000);
    authority.advance(10_000);
    expect(bus.flush()).toEqual([]);
    expect(bus.events()).toHaveLength(11);
  });

  it("requires the authored next-run start itself to be a runtime60 boundary", () => {
    const {bus, authority} = make();
    const before = authority.snapshot();
    expect(() => authority.begin(trusted(createMemory()), "run-cross-restore-odd", 11)).toThrow(
      /even runtime60 boundary/,
    );
    expect(authority.snapshot()).toEqual(before);
    expect(bus.flush()).toEqual([]);
  });

  it("captures dense authored routes with more than ten points in numeric order", () => {
    const memory = createMemory(12);
    const route = memory.ghostRoute;
    if (route === null) throw new Error("test route disappeared");
    const {bus, authority} = make();
    authority.begin(trusted(memory), "run-cross-restore-twelve-points", 0);
    bus.flush();
    authority.advance(52);
    const replay = bus.flush()[0];
    expect(replay?.payload.pointCount).toBe(12);
    expect(replay?.payload.routePoints).toEqual(route.points);
    expect((replay?.payload.routePoints as readonly {readonly tMs: number}[]).map(({tMs}) => tMs)).toEqual(
      Array.from({length: 12}, (_, index) => index * 120),
    );
  });

  it("has identical canonical traces for chunked and maximum-delta advances", () => {
    const run = (ticks: readonly number[]): string => {
      const {bus, authority} = make();
      authority.begin(trusted(createMemory()), "run-cross-restore-next", 0);
      bus.flush();
      for (const tick of ticks) {
        authority.advance(tick);
        bus.flush();
      }
      return serializeCanonicalEvents(bus.events());
    };

    expect(run([51, 52, 165, 166, 199, 200, 251, 252])).toBe(
      run([Number.MAX_SAFE_INTEGER]),
    );
  });

  it("feeds its committed exact events through the read-only NarrativeAuthority seam", () => {
    const memory = createMemory();
    const narrative = new NarrativeAuthority({
      previousRun: validateNarrativeRecord(memory, assertRunMemory),
    });
    const {bus, authority} = make();
    authority.begin(trusted(memory), "run-cross-restore-next", 0);
    narrative.consumeMany(bus.flush());
    authority.advance(252);
    narrative.consumeMany(bus.flush());

    const snapshot = narrative.snapshot();
    expect(snapshot.state).toBe("AWAKENING");
    expect(snapshot.handoffReady).toBe(false);
    expect(snapshot.crossRun.map(({eventId}) => eventId)).toEqual([
      "cross_run.restore.begin",
      "overrideScar.rehydrate",
      "deathTrace.rehydrate",
      "burnIn.rehydrate",
      "ghost.replay.begin",
      "ghost.replay.complete",
      "ghost.residue.write",
      "witness.turn",
      "returnInput",
      "cross_run.restore.complete",
    ]);
    expect(snapshot.transitions.map(({to}) => to)).toEqual([
      "GHOST_REPLAY",
      "WITNESS_ORIENTATION",
      "AWAKENING",
    ]);
  });

  it("uses the immutable recorder snapshot and never exposes mutable route provenance", () => {
    const memory = createMemory();
    const route = memory.ghostRoute;
    if (route === null) throw new Error("test route disappeared");
    const originalDigest = route.routeDigest;
    const token = trusted(memory);
    const snapshot = readRecorderIssuedRunMemory(token);
    expect(Object.isFrozen(memory)).toBe(true);
    expect(Object.isFrozen(memory.ghostRoute)).toBe(true);
    expect(Object.isFrozen(memory.ghostRoute?.points)).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(() => {
      // @ts-expect-error Runtime probe: finalized route points are recursively readonly.
      route.points[0]!.xNorm = 1;
    }).toThrow();
    expect(() => {
      // @ts-expect-error Runtime probe: finalized route identity is readonly.
      route.routeDigest = "f".repeat(64);
    }).toThrow();
    expect(() => {
      // @ts-expect-error Runtime probe: finalized nested material records are readonly.
      memory.materialMemory.overrideScars[0]!.id = "caller-rewrite";
    }).toThrow();
    expect(() => {
      // @ts-expect-error Runtime probe: finalized arrays expose no mutable methods.
      memory.run.roomsVisited.push("FORCED_ALIGNMENT");
    }).toThrow();
    expect(() => {
      // @ts-expect-error Runtime probe: finalized nested tuples are readonly.
      memory.materialMemory.deathTraces[0]!.damageVector[0] = 1;
    }).toThrow();

    const {bus, authority} = make();
    authority.begin(token, "run-cross-restore-next", 0);
    bus.flush();
    authority.advance(200);
    const events = bus.flush();
    const replay = events.find(({id}) => id === "ghost.replay.begin");
    const witness = events.find(({id}) => id === "witness.turn");
    expect(replay?.payload.routeDigest).toBe(originalDigest);
    expect((replay?.payload.routePoints as readonly {readonly xNorm: number}[])[0]?.xNorm).toBe(0.125);
    expect(witness?.payload.overrideScarIds).toEqual(["scar-cross-restore"]);
  });
});

describe("restore rejection and consumption identity", () => {
  it("rejects raw, cloned, parsed, tampered, accessor, and forged provenance", () => {
    const raw = createMemory();
    const clone = structuredClone(raw);
    const parsed = parseRunMemory(JSON.stringify(raw));
    const tamperedValue: unknown = structuredClone(raw);
    assertRunMemory(tamperedValue);
    const tampered = tamperedValue;
    if (tampered.ghostRoute === null) throw new Error("test route disappeared");
    tampered.ghostRoute.points[0]!.xNorm = 0.25;
    tampered.materialMemory.overrideScars[0]!.id = "shape-valid-stale-edit";
    assertRunMemory(tampered);
    let getterReads = 0;
    const accessorValue: unknown = structuredClone(raw);
    assertRunMemory(accessorValue);
    const accessor = accessorValue;
    const run = accessor.run;
    Object.defineProperty(accessor, "run", {
      enumerable: true,
      get: () => {
        getterReads += 1;
        return run;
      },
    });

    for (const [label, value] of [
      ["raw", raw],
      ["clone", clone],
      ["parsed", parsed],
      ["tampered", tampered],
      ["accessor", accessor],
      ["forged token", Object.freeze(Object.create(null))],
    ] as const) {
      const {bus, ledger, authority} = make();
      const before = authority.snapshot();
      expect(() => authority.begin(
        value as RecorderIssuedRunMemoryToken,
        "run-cross-restore-next",
        0,
      ), label).toThrow(/opaque recorder-issued run memory token/);
      expect(authority.snapshot()).toEqual(before);
      expect(bus.flush()).toEqual([]);
      expect(ledger.hasClaimedNextRun("run-cross-restore-next")).toBe(false);
    }
    expect(getterReads).toBe(0);
    expect(() => captureRecorderIssuedRunMemory(clone)).toThrow(/raw, cloned, parsed, or persisted/);
    expect(() => captureRecorderIssuedRunMemory(parsed)).toThrow(/raw, cloned, parsed, or persisted/);
    expect(() => captureRecorderIssuedRunMemory(tampered)).toThrow(/raw, cloned, parsed, or persisted/);
    expect(() => captureRecorderIssuedRunMemory(accessor)).toThrow(/raw, cloned, parsed, or persisted/);
    expect(getterReads).toBe(0);
  });

  it("fails closed on a trusted null route, hostile IDs/ticks, and deadline overflow", () => {
    const cases = [
      ["null route", trusted(createMemoryWithoutRoute()), "next", 0, /non-null authored actual ghostRoute/],
      ["deadline overflow", trusted(createMemory()), "next", Number.MAX_SAFE_INTEGER - 1, /safe tick range/],
      ["whitespace id", trusted(createMemory()), "   ", 0, /next run id must be a non-empty string/],
      ["negative zero", trusted(createMemory()), "next", -0, /non-negative safe integer/],
    ] as const;

    for (const [label, token, nextRunId, tick120, message] of cases) {
      const {bus, ledger, authority} = make();
      const before = authority.snapshot();
      expect(() => authority.begin(token, nextRunId, tick120), label).toThrow(message);
      expect(authority.snapshot()).toEqual(before);
      expect(bus.flush()).toEqual([]);
      expect(ledger.hasClaimedNextRun("next")).toBe(false);
    }
  });

  it("rejects advance-before-begin, backward/hostile ticks, and reentry without partial mutation", () => {
    const {bus, authority} = make();
    expect(() => authority.advance(0)).toThrow(/before begin/);
    authority.begin(trusted(createMemory()), "run-cross-restore-next", 0);
    bus.flush();
    authority.advance(52);
    bus.flush();
    const before = authority.snapshot();
    for (const tick of [-1, -0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 51]) {
      expect(() => authority.advance(tick)).toThrow();
      expect(authority.snapshot()).toEqual(before);
      expect(bus.flush()).toEqual([]);
    }
    expect(() => authority.begin(trusted(createMemory()), "another-next", 60)).toThrow(/already started/);
    expect(authority.snapshot()).toEqual(before);
  });

  it("shares consumed-route identity across authority instances and prevents duplicate residue", () => {
    const memory = createMemory();
    const route = memory.ghostRoute;
    if (route === null) throw new Error("test route disappeared");
    const ledger = new CrossRunRestoreConsumptionLedger();
    const first = new CrossRunRestoreAuthority(new CanonicalEventBus(), ledger);
    first.begin(trusted(memory), "run-cross-restore-next", 0);
    expect(ledger.hasConsumed(memory.run.id, route.routeDigest)).toBe(true);
    expect(ledger.consumedBy(memory.run.id, route.routeDigest)).toBe("run-cross-restore-next");
    expect(ledger.hasClaimedNextRun("run-cross-restore-next")).toBe(true);

    const duplicate = new CrossRunRestoreAuthority(new CanonicalEventBus(), ledger);
    expect(() => duplicate.begin(trusted(memory), "run-cross-restore-next", 0)).toThrow(
      /already consumed for this nextRunId/,
    );
    const otherNext = new CrossRunRestoreAuthority(new CanonicalEventBus(), ledger);
    expect(() => otherNext.begin(trusted(memory), "another-next-run", 0)).toThrow(
      /idempotent ghost residue/,
    );
  });

  it("atomically prevents two previous records from claiming the same next run", () => {
    const firstMemory = createMemory(3, "run-cross-restore-previous-a");
    const secondMemory = createMemory(3, "run-cross-restore-previous-b");
    const secondRoute = secondMemory.ghostRoute;
    if (secondRoute === null) throw new Error("test route disappeared");
    const ledger = new CrossRunRestoreConsumptionLedger();
    const firstBus = new CanonicalEventBus();
    const first = new CrossRunRestoreAuthority(firstBus, ledger);
    first.begin(trusted(firstMemory), "run-cross-restore-shared-next", 0);
    expect(firstBus.flush()).toHaveLength(5);

    const secondBus = new CanonicalEventBus();
    const second = new CrossRunRestoreAuthority(secondBus, ledger);
    const before = second.snapshot();
    expect(() => second.begin(
      trusted(secondMemory),
      "run-cross-restore-shared-next",
      0,
    )).toThrow(/nextRunId is already claimed/);
    expect(second.snapshot()).toEqual(before);
    expect(secondBus.flush()).toEqual([]);
    expect(ledger.hasClaimedNextRun("run-cross-restore-shared-next")).toBe(true);
    expect(ledger.hasConsumed(secondMemory.run.id, secondRoute.routeDigest)).toBe(false);
  });

  it("atomically binds one previous run id to one route history", () => {
    const sharedPreviousRunId = "run-cross-restore-shared-previous";
    const firstMemory = createMemory(3, sharedPreviousRunId);
    const secondMemory = createMemory(4, sharedPreviousRunId);
    const firstRoute = firstMemory.ghostRoute;
    const secondRoute = secondMemory.ghostRoute;
    if (firstRoute === null || secondRoute === null) throw new Error("test route disappeared");
    expect(secondRoute.routeDigest).not.toBe(firstRoute.routeDigest);

    const ledger = new CrossRunRestoreConsumptionLedger();
    const firstBus = new CanonicalEventBus();
    new CrossRunRestoreAuthority(firstBus, ledger).begin(
      trusted(firstMemory),
      "run-cross-restore-next-a",
      0,
    );
    expect(firstBus.flush()).toHaveLength(5);

    const secondBus = new CanonicalEventBus();
    const second = new CrossRunRestoreAuthority(secondBus, ledger);
    const before = second.snapshot();
    expect(() => second.begin(
      trusted(secondMemory),
      "run-cross-restore-next-b",
      0,
    )).toThrow(/previous run id is already claimed by a different route history/);
    expect(second.snapshot()).toEqual(before);
    expect(secondBus.flush()).toEqual([]);
    expect(ledger.hasConsumed(sharedPreviousRunId, firstRoute.routeDigest)).toBe(true);
    expect(ledger.hasConsumed(sharedPreviousRunId, secondRoute.routeDigest)).toBe(false);
    expect(ledger.hasClaimedNextRun("run-cross-restore-next-a")).toBe(true);
    expect(ledger.hasClaimedNextRun("run-cross-restore-next-b")).toBe(false);
  });

  it("does not consume the route or mutate authority state when the bus rejects begin", () => {
    const memory = createMemory();
    const route = memory.ghostRoute;
    if (route === null) throw new Error("test route disappeared");
    const bus = new CanonicalEventBus();
    bus.enqueue({
      id: "player.input.off",
      tick120: 0,
      entityStableId: "external-system",
      localSequence: 0,
      occurrenceKey: "external:closed-start",
      payload: {reason: "external-test"},
    });
    bus.flush();
    const ledger = new CrossRunRestoreConsumptionLedger();
    const authority = new CrossRunRestoreAuthority(bus, ledger);
    const before = authority.snapshot();
    expect(() => authority.begin(trusted(memory), "run-cross-restore-next", 0)).toThrow(/already closed/);
    expect(authority.snapshot()).toEqual(before);
    expect(ledger.hasConsumed(memory.run.id, route.routeDigest)).toBe(false);
    expect(ledger.hasClaimedNextRun("run-cross-restore-next")).toBe(false);

    const retry = new CrossRunRestoreAuthority(new CanonicalEventBus(), ledger);
    expect(() => retry.begin(trusted(memory), "run-cross-restore-next", 0)).not.toThrow();
    expect(ledger.hasClaimedNextRun("run-cross-restore-next")).toBe(true);
  });

  it("keeps progression unchanged when a later canonical batch is rejected", () => {
    const memory = createMemory();
    const {bus, authority} = make();
    authority.begin(trusted(memory), "run-cross-restore-next", 0);
    bus.flush();
    bus.enqueue({
      id: "ghost.replay.begin",
      tick120: 52,
      entityStableId: "external-restore",
      localSequence: 0,
      occurrenceKey: `cross-run:${memory.run.id}:run-cross-restore-next:ghost-replay-begin`,
      payload: {
        fromRunId: memory.run.id,
        nextRunId: "run-cross-restore-next",
        routeDigest: memory.ghostRoute!.routeDigest,
        routeDurationMs: 960,
        pointCount: 0,
        routePoints: [],
        timeScale: 1,
        collisionClass: "NONE",
        rewardClass: "NONE",
        emitterClass: "NONE",
      },
    });
    const before = authority.snapshot();
    expect(() => authority.advance(52)).toThrow(/duplicate authoritative occurrence key/);
    expect(authority.snapshot()).toEqual(before);
    const committed = bus.flush();
    expect(committed).toHaveLength(1);
    expect(committed[0]?.entityStableId).toBe("external-restore");
  });

  it("retains global collision/state ordering at the shared bus boundary", () => {
    const {bus, authority} = make();
    bus.enqueue({
      id: "player.collision.on",
      tick120: 0,
      entityStableId: "player:0",
      localSequence: 1,
      occurrenceKey: "cross-restore-order:collision-on",
      payload: {owner: "system-handoff", reason: "restore-test"},
    });
    authority.begin(trusted(createMemory()), "run-cross-restore-next", 0);
    bus.enqueue({
      id: "player.collision.off",
      tick120: 0,
      entityStableId: "player:0",
      localSequence: 0,
      occurrenceKey: "cross-restore-order:collision-off",
      payload: {owner: "system-handoff", reason: "restore-test"},
    });

    const events: readonly CanonicalGameplayEvent[] = bus.flush();
    expect(events.map(({id}) => id)).toEqual([
      "player.collision.off",
      "player.input.off",
      "cross_run.restore.begin",
      "overrideScar.rehydrate",
      "deathTrace.rehydrate",
      "burnIn.rehydrate",
      "player.collision.on",
    ]);
  });
});
