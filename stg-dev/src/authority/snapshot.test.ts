import {describe, expect, it} from "vitest";
import {
  CanonicalEventBus,
  serializeCanonicalEvents,
  type GameplayEventDraft,
} from "./events";
import {
  captureSerializedSnapshotRecord,
  SNAPSHOT_AUTHORITY_CONTRACT,
  SnapshotAuthority,
} from "./snapshot";
import {
  assertRunMemory,
  captureRecorderIssuedRunMemory,
  parseRunMemory,
  RunMemoryRecorder,
  type FinalizedRunMemory,
  type RecorderIssuedRunMemoryToken,
} from "./run-memory-model";
import {
  NarrativeAuthority,
  validateNarrativeRecord,
} from "./narrative";

interface MemoryOptions {
  readonly runId?: string;
  readonly route?: boolean;
  readonly firstRouteTimeMs?: number;
}

function createMemory(options: MemoryOptions = {}): FinalizedRunMemory {
  const runId = options.runId ?? "run-snapshot-v4";
  const firstRouteTimeMs = options.firstRouteTimeMs ?? 0;
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
  recorder.recordBehaviorFact({
    segmentId: "information-entry",
    room: "INFORMATION",
    atTick: 1,
    eventId: "room-dwell-information",
    kind: "ROOM_DWELL",
    amount: 1200,
  });
  if (options.route !== false) {
    recorder.recordGhostPoint({
      tMs: firstRouteTimeMs,
      xNorm: 0.125,
      yNorm: 0.875,
      room: "INFORMATION",
      flower: 0.25,
      focus: false,
      flags: ["ROOM_ENTER"],
    });
    recorder.recordGhostPoint({
      tMs: firstRouteTimeMs + 480,
      xNorm: 0.5,
      yNorm: 0.625,
      room: "IN_BETWEEN",
      flower: 0.5,
      focus: true,
      flags: ["GAZE", "SEAM_CROSS"],
    });
    recorder.recordGhostPoint({
      tMs: firstRouteTimeMs + 960,
      xNorm: 0.75,
      yNorm: 0.25,
      room: "POLARIZED",
      flower: 0.75,
      focus: false,
      flags: ["OVERRIDE"],
    });
  }
  recorder.addOverrideScar({
    id: "scar-snapshot",
    position: {room: "POLARIZED", xNorm: 0.75, yNorm: 0.25},
    direction8: "NW",
    localVoidRadiusPx: 28,
    createdAtTick: 80,
    persistenceRuns: 2,
  });
  recorder.addDeathTrace({
    id: "death-snapshot",
    position: {room: "IN_BETWEEN", xNorm: 0.5, yNorm: 0.625},
    damageVector: [0, -1],
    createdAtTick: 90,
    causeArchetype: "pattern.unanswered_fan",
  });
  recorder.addBurnIn({
    id: "burn-snapshot",
    room: "INFORMATION",
    captureDigest: "a".repeat(64),
    gazeStillMs: 2100,
    decayTicks: 80,
  });
  recorder.addGhostResidue({
    id: "residue-snapshot",
    position: {room: "INFORMATION", xNorm: 0.125, yNorm: 0.875},
    sourceRouteDigest: "b".repeat(64),
    createdAfterReplay: true,
    persistenceRuns: 1,
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

function make(memory = createMemory()): Readonly<{
  readonly memory: FinalizedRunMemory;
  readonly token: RecorderIssuedRunMemoryToken;
  readonly bus: CanonicalEventBus;
  readonly authority: SnapshotAuthority;
}> {
  const bus = new CanonicalEventBus();
  return Object.freeze({
    memory,
    token: trusted(memory),
    bus,
    authority: new SnapshotAuthority(bus),
  });
}

describe("immutable route-present snapshot authority contract", () => {
  it("pins the V4 timing, narrow record boundary, and explicit numeric seed adapter", () => {
    expect(SNAPSHOT_AUTHORITY_CONTRACT).toEqual({
      authority: "v4-snapshot",
      masterTickHz: 120,
      acceptedStartTick120: "even-runtime60-boundary",
      boundaryPolicy: "first-non-early-runtime60-boundary",
      largeDeltaPolicy: "traverse-every-crossed-authoritative-boundary",
      maximumBoundariesPerAdvance: 1024,
      recordBoundary: "opaque-recorder-issued-in-memory-token",
      serializedRecordReceipt: "opaque-snapshot-authority-issued-after-accepted-serialize",
      serializedReceiptBusBinding: "exact-snapshot-event-bus",
      routeRequirement: "non-null-actual-player-route",
      parsedClonedOrPersistedRunMemory: "unsupported",
      deterministicSeedAdapter: "RunMemory.run.seed:number",
      runtimeReferenceSnapshotRecordSeedType: "string-not-claimed-as-parity",
      archivePersistenceSessionRenderer: "not-owned",
      mayEmitCrossRunEvents: false,
      runtimeTimingMs: {serialize: 410, present: 810, complete: 1630},
      presentationDirection: "canonical-event-to-passive-feedback-only",
    });
    expect(Object.isFrozen(SNAPSHOT_AUTHORITY_CONTRACT)).toBe(true);
    expect(Object.isFrozen(SNAPSHOT_AUTHORITY_CONTRACT.runtimeTimingMs)).toBe(true);
  });

  it("rejects substitute bus capabilities", () => {
    class BusSubclass extends CanonicalEventBus {}
    expect(() => new SnapshotAuthority({})).toThrow(/exact CanonicalEventBus/);
    expect(() => new SnapshotAuthority(new BusSubclass())).toThrow(/exact CanonicalEventBus/);
  });

  it("mints one unforgeable null-prototype receipt only after accepted serialization", () => {
    const {token, bus, authority} = make(createMemory({runId: "run-snapshot-receipt"}));
    let receiptShadowCalls = 0;
    Object.defineProperty(authority, "serializedRecordReceipt", {
      configurable: true,
      value: () => {
        receiptShadowCalls += 1;
        return Object.freeze(Object.create(null));
      },
    });
    Object.defineProperty(authority, "bus", {
      configurable: true,
      value: new CanonicalEventBus(),
    });

    expect(() => captureSerializedSnapshotRecord(authority)).toThrow(/unavailable before/);
    authority.begin(token, 0);
    expect(() => captureSerializedSnapshotRecord(authority)).toThrow(/unavailable before/);
    authority.advance(49);
    expect(() => captureSerializedSnapshotRecord(authority)).toThrow(/unavailable before/);
    authority.advance(50);

    const receipt = captureSerializedSnapshotRecord(authority);
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.getPrototypeOf(receipt)).toBeNull();
    expect(Reflect.ownKeys(receipt)).toEqual([]);
    expect(captureSerializedSnapshotRecord(authority)).toBe(receipt);
    expect(receiptShadowCalls).toBe(0);
    expect(() => captureSerializedSnapshotRecord(new Proxy(authority, {}))).toThrow(/exact SnapshotAuthority/);
    class SnapshotAuthoritySubclass extends SnapshotAuthority {}
    const subclassBus = new CanonicalEventBus();
    const subclass = new SnapshotAuthoritySubclass(subclassBus);
    subclass.begin(trusted(createMemory({runId: "run-snapshot-receipt-subclass"})), 0);
    subclass.advance(50);
    expect(() => captureSerializedSnapshotRecord(subclass)).toThrow(/exact SnapshotAuthority/);
    expect(bus.flush().map(({id}) => id)).toEqual([
      "snapshot.begin",
      "snapshot.serialize.commit",
    ]);
  });

  it("does not expose a serialization receipt when the intrinsic append is rejected", () => {
    const {memory, token, bus, authority} = make(createMemory({runId: "run-snapshot-receipt-reject"}));
    authority.begin(token, 0);
    bus.enqueue({
      id: "snapshot.serialize.commit",
      tick120: 50,
      entityStableId: "receipt-blocker",
      localSequence: 0,
      occurrenceKey: `snapshot:${memory.run.id}:serialize`,
      payload: {
        runId: memory.run.id,
        snapshotHash: memory.fingerprint.digestSha256,
        deterministicSeed: memory.run.seed,
        routeDigest: memory.ghostRoute?.routeDigest ?? "missing",
        routeDurationMs: memory.ghostRoute?.points.at(-1)?.tMs ?? 0,
        materialCounts: {overrideScars: 1, deathTraces: 1, burnIns: 1, ghostResidues: 1},
      },
    });

    expect(() => authority.advance(50)).toThrow(/duplicate authoritative occurrence key/);
    expect(() => captureSerializedSnapshotRecord(authority)).toThrow(/unavailable before/);
    expect(authority.snapshot()).toMatchObject({state: "capturing", nextStep: 0});
  });

  it("uses the intrinsic append boundary despite an own enqueueBatch shadow", () => {
    const memory = createMemory();
    const bus = new CanonicalEventBus();
    let shadowCalls = 0;
    Object.defineProperty(bus, "enqueueBatch", {
      configurable: true,
      value: () => { shadowCalls += 1; },
    });
    const authority = new SnapshotAuthority(bus);
    authority.begin(trusted(memory), 0);
    authority.advance(196);

    expect(shadowCalls).toBe(0);
    expect(bus.flush().map(({id}) => id)).toEqual([
      "snapshot.begin",
      "snapshot.serialize.commit",
      "snapshot.present.begin",
      "snapshot.complete",
    ]);
  });

  it("ignores own draft and snapshot shadows across committed lifecycle results", () => {
    const memory = createMemory({runId: "run-snapshot-own-shadow"});
    if (memory.ghostRoute === null) throw new Error("shadow test route disappeared");
    const bus = new CanonicalEventBus();
    const authority = new SnapshotAuthority(bus);
    let draftShadowCalls = 0;
    let snapshotShadowCalls = 0;
    Object.defineProperty(authority, "draft", {
      configurable: true,
      value: (): GameplayEventDraft => {
        draftShadowCalls += 1;
        return {
          id: "cross_run.record.persist.commit",
          tick120: 0,
          entityStableId: "forged-shadow",
          localSequence: 0,
          occurrenceKey: "forged-shadow:persist",
          payload: {
            runId: memory.run.id,
            snapshotHash: memory.fingerprint.digestSha256,
            deterministicSeed: memory.run.seed,
            routeDigest: memory.ghostRoute?.routeDigest ?? "missing",
            routeDurationMs: memory.ghostRoute?.points.at(-1)?.tMs ?? 0,
            materialCounts: {
              overrideScars: 1,
              deathTraces: 1,
              burnIns: 1,
              ghostResidues: 1,
            },
          },
        };
      },
    });
    Object.defineProperty(authority, "snapshot", {
      configurable: true,
      value: () => {
        snapshotShadowCalls += 1;
        return Object.freeze({authority: "forged", state: "complete"});
      },
    });

    expect(authority.begin(trusted(memory), 0)).toMatchObject({
      authority: "v4-snapshot",
      state: "capturing",
      eventCount: 1,
    });
    Object.defineProperty(authority, "snapshot", {
      configurable: true,
      value: () => {
        snapshotShadowCalls += 1;
        throw new Error("own snapshot shadow must stay unreachable");
      },
    });
    expect(authority.advance(196)).toMatchObject({
      authority: "v4-snapshot",
      state: "complete",
      eventCount: 4,
    });

    expect(draftShadowCalls).toBe(0);
    expect(snapshotShadowCalls).toBe(0);
    expect(bus.flush().map(({id}) => id)).toEqual([
      "snapshot.begin",
      "snapshot.serialize.commit",
      "snapshot.present.begin",
      "snapshot.complete",
    ]);
    expect(bus.events().some(({id}) => id.startsWith("cross_run."))).toBe(false);
  });
});

describe("snapshot lifecycle", () => {
  it("emits the exact V4 state/event/payload trace on aligned non-early deadlines", () => {
    const {memory, token, bus, authority} = make();
    if (memory.ghostRoute === null) throw new Error("test route disappeared");
    const initial = authority.begin(token, 20);

    expect(initial).toEqual({
      authority: "v4-snapshot",
      tick120: 20,
      requestedStartTick120: 20,
      state: "capturing",
      runId: memory.run.id,
      snapshotHash: memory.fingerprint.digestSha256,
      deterministicSeed: memory.run.seed,
      routeDigest: memory.ghostRoute.routeDigest,
      routeDurationMs: 960,
      materialCounts: {overrideScars: 1, deathTraces: 1, burnIns: 1, ghostResidues: 1},
      nextStep: 0,
      eventCount: 1,
      schedule: {
        beginTick120: 20,
        serializeTick120: 70,
        presentTick120: 118,
        completeTick120: 216,
      },
    });
    expect(bus.flush()).toMatchObject([{
      id: "snapshot.begin",
      tick120: 20,
      simulationTimeMs: 20 * 1000 / 120,
      entityStableId: "snapshot",
      localSequence: 0,
      occurrenceKey: `snapshot:${memory.run.id}:begin`,
      payload: {runId: memory.run.id},
    }]);

    expect(authority.advance(69).state).toBe("capturing");
    expect(bus.flush()).toEqual([]);
    expect(authority.advance(70).state).toBe("serialized");
    expect(bus.flush()).toMatchObject([{
      id: "snapshot.serialize.commit",
      tick120: 70,
      simulationTimeMs: 70 * 1000 / 120,
      localSequence: 1,
      occurrenceKey: `snapshot:${memory.run.id}:serialize`,
      payload: {
        runId: memory.run.id,
        snapshotHash: memory.fingerprint.digestSha256,
        deterministicSeed: memory.run.seed,
        routeDigest: memory.ghostRoute.routeDigest,
        routeDurationMs: 960,
        materialCounts: {overrideScars: 1, deathTraces: 1, burnIns: 1, ghostResidues: 1},
      },
    }]);
    expect(authority.advance(118).state).toBe("presenting");
    expect(bus.flush()).toMatchObject([{
      id: "snapshot.present.begin",
      tick120: 118,
      localSequence: 2,
      occurrenceKey: `snapshot:${memory.run.id}:present`,
      payload: {runId: memory.run.id, snapshotHash: memory.fingerprint.digestSha256},
    }]);
    expect(authority.advance(216)).toMatchObject({
      tick120: 216,
      state: "complete",
      nextStep: 3,
      eventCount: 4,
    });
    expect(bus.flush()).toMatchObject([{
      id: "snapshot.complete",
      tick120: 216,
      localSequence: 3,
      occurrenceKey: `snapshot:${memory.run.id}:complete`,
      payload: {runId: memory.run.id},
    }]);
    expect(bus.events().some(({id}) => id.startsWith("cross_run."))).toBe(false);
  });

  it("is trace-identical for stepped and one-call large-delta advancement", () => {
    const memory = createMemory({runId: "run-snapshot-large-delta"});
    const run = (ticks: readonly number[]): string => {
      const bus = new CanonicalEventBus();
      const authority = new SnapshotAuthority(bus);
      authority.begin(trusted(memory), 0);
      for (const tick of ticks) authority.advance(tick);
      bus.flush();
      return serializeCanonicalEvents(bus.events());
    };

    expect(run([50, 98, 196])).toBe(run([Number.MAX_SAFE_INTEGER]));
  });

  it("keeps a multi-boundary advance atomic when the event append is rejected", () => {
    const {memory, token, bus, authority} = make(createMemory({runId: "run-snapshot-atomic"}));
    authority.begin(token, 0);
    const blocker: GameplayEventDraft = {
      id: "snapshot.present.begin",
      tick120: 98,
      entityStableId: "blocker",
      localSequence: 0,
      occurrenceKey: `snapshot:${memory.run.id}:present`,
      payload: {runId: memory.run.id, snapshotHash: memory.fingerprint.digestSha256},
    };
    bus.enqueue(blocker);

    expect(() => authority.advance(196)).toThrow(/duplicate authoritative occurrence key/);
    expect(authority.snapshot()).toMatchObject({
      tick120: 0,
      state: "capturing",
      nextStep: 0,
      eventCount: 1,
    });
    expect(bus.flush().map(({entityStableId}) => entityStableId)).toEqual(["snapshot", "blocker"]);
  });

  it("returns deeply frozen readonly snapshots", () => {
    const {token, authority} = make();
    const snapshot = authority.begin(token, 0);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.schedule)).toBe(true);
    expect(Object.isFrozen(snapshot.materialCounts)).toBe(true);
    expect(() => {
      // @ts-expect-error Runtime probe: authority snapshots are readonly.
      snapshot.state = "complete";
    }).toThrow();
    expect(() => {
      // @ts-expect-error Runtime probe: nested schedules are readonly.
      snapshot.schedule!.serializeTick120 = 0;
    }).toThrow();
    expect(() => {
      // @ts-expect-error Runtime probe: nested material counts are readonly.
      snapshot.materialCounts!.burnIns = 99;
    }).toThrow();
  });
});

describe("snapshot rejection and narrative projection boundary", () => {
  it("rejects raw, cloned, parsed, tampered, and forged record provenance without mutation", () => {
    const raw = createMemory();
    const clone = structuredClone(raw);
    const parsed = parseRunMemory(JSON.stringify(raw));
    const tamperedValue: unknown = structuredClone(raw);
    assertRunMemory(tamperedValue);
    tamperedValue.run.id = "shape-valid-tamper";
    assertRunMemory(tamperedValue);

    for (const [label, value] of [
      ["raw", raw],
      ["clone", clone],
      ["parsed", parsed],
      ["tampered", tamperedValue],
      ["forged token", Object.freeze(Object.create(null))],
    ] as const) {
      const bus = new CanonicalEventBus();
      const authority = new SnapshotAuthority(bus);
      const before = authority.snapshot();
      expect(() => authority.begin(
        value as unknown as RecorderIssuedRunMemoryToken,
        0,
      ), label).toThrow(/opaque recorder-issued run memory token/);
      expect(authority.snapshot()).toEqual(before);
      expect(bus.flush()).toEqual([]);
    }
  });

  it("fails closed on a trusted null route, nonzero route origin, hostile ticks, and reentry", () => {
    const invalidCases = [
      [trusted(createMemory({route: false})), 0, /non-null authored actual ghostRoute/],
      [trusted(createMemory({firstRouteTimeMs: 120})), 0, /begin at authored tMs 0/],
      [trusted(createMemory()), 1, /even runtime60 boundary/],
      [trusted(createMemory()), Number.MAX_SAFE_INTEGER - 1, /safe tick range/],
    ] as const;
    for (const [token, tick120, message] of invalidCases) {
      const bus = new CanonicalEventBus();
      const authority = new SnapshotAuthority(bus);
      expect(() => authority.begin(token, tick120)).toThrow(message);
      expect(authority.snapshot().state).toBe("idle");
      expect(bus.flush()).toEqual([]);
    }

    const {token, authority} = make();
    expect(() => authority.advance(0)).toThrow(/before begin/);
    authority.begin(token, 0);
    expect(() => authority.advance(-0)).toThrow(/non-negative safe integer/);
    authority.advance(10);
    expect(() => authority.advance(9)).toThrow(/cannot move backward/);
    expect(() => authority.begin(token, 12)).toThrow(/already started/);
  });

  it("feeds the existing observation selector while snapshot.complete alone never enables handoff", () => {
    const memory = createMemory({runId: "run-snapshot-narrative"});
    const bus = new CanonicalEventBus();
    const authority = new SnapshotAuthority(bus);
    const narrative = new NarrativeAuthority({
      snapshotRecord: validateNarrativeRecord(memory, assertRunMemory),
    });

    authority.begin(trusted(memory), 0);
    narrative.consumeMany(bus.flush());
    authority.advance(196);
    const snapshotEvents = bus.flush();
    narrative.consumeMany(snapshotEvents);
    const projected = narrative.snapshot();

    expect(snapshotEvents.map(({id}) => id)).toEqual([
      "snapshot.serialize.commit",
      "snapshot.present.begin",
      "snapshot.complete",
    ]);
    expect(projected.state).toBe("BOOT_REHYDRATE");
    expect(projected.observations.length).toBeGreaterThan(0);
    expect(projected.observations.length).toBeLessThanOrEqual(3);
    expect(new Set(projected.observations.map(({category}) => category)).size)
      .toBe(projected.observations.length);
    expect(projected.handoffReady).toBe(false);
    expect(projected.processedOccurrences).toBe(4);
    expect(projected.lastTick120).toBe(196);
    expect(snapshotEvents.some(({id}) => id.startsWith("cross_run."))).toBe(false);
  });
});
