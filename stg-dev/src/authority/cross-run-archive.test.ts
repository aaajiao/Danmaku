import {describe, expect, it} from "vitest";
import {
  CanonicalEventBus,
  type GameplayEventDraft,
} from "./events";
import {
  CROSS_RUN_ARCHIVE_AUTHORITY_CONTRACT,
  CrossRunArchiveAuthority,
} from "./cross-run-archive";
import {
  captureSerializedSnapshotRecord,
  SnapshotAuthority,
  type SerializedSnapshotRecordReceipt,
} from "./snapshot";
import {
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
  runId = "run-cross-archive-v4",
  seed = 0x41c0,
): FinalizedRunMemory {
  const recorder = new RunMemoryRecorder({runId, seed, startedAtTick: 0});
  recorder.recordBehaviorFact({
    segmentId: "information-entry",
    room: "INFORMATION",
    atTick: 0,
    eventId: `room-enter:${runId}`,
    kind: "ROOM_ENTER",
  });
  recorder.recordBehaviorFact({
    segmentId: "information-entry",
    room: "INFORMATION",
    atTick: 1,
    eventId: `room-dwell:${runId}`,
    kind: "ROOM_DWELL",
    amount: 1200,
  });
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
  recorder.addOverrideScar({
    id: `scar:${runId}`,
    position: {room: "POLARIZED", xNorm: 0.75, yNorm: 0.25},
    direction8: "NW",
    localVoidRadiusPx: 28,
    createdAtTick: 80,
    persistenceRuns: 2,
  });
  recorder.addDeathTrace({
    id: `death:${runId}`,
    position: {room: "IN_BETWEEN", xNorm: 0.5, yNorm: 0.625},
    damageVector: [0, -1],
    createdAtTick: 90,
    causeArchetype: "pattern.unanswered_fan",
  });
  recorder.addBurnIn({
    id: `burn:${runId}`,
    room: "INFORMATION",
    captureDigest: "a".repeat(64),
    gazeStillMs: 2100,
    decayTicks: 80,
  });
  recorder.addGhostResidue({
    id: `residue:${runId}`,
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

function serializeOn(
  bus: CanonicalEventBus,
  memory = createMemory(),
  startTick120 = 0,
): Readonly<{
  readonly memory: FinalizedRunMemory;
  readonly token: RecorderIssuedRunMemoryToken;
  readonly authority: SnapshotAuthority;
  readonly receipt: SerializedSnapshotRecordReceipt;
  readonly serializeTick120: number;
}> {
  const token = captureRecorderIssuedRunMemory(memory);
  const authority = new SnapshotAuthority(bus);
  const begun = authority.begin(token, startTick120);
  const serializeTick120 = begun.schedule?.serializeTick120;
  if (serializeTick120 === undefined) throw new Error("snapshot schedule is missing serialization");
  authority.advance(serializeTick120);
  return Object.freeze({
    memory,
    token,
    authority,
    receipt: captureSerializedSnapshotRecord(authority),
    serializeTick120,
  });
}

describe("immutable in-memory cross-run archive contract", () => {
  it("pins the source-derived boundary without claiming storage, restore, or handoff authority", () => {
    expect(CROSS_RUN_ARCHIVE_AUTHORITY_CONTRACT).toEqual({
      authority: "v4-cross-run-archive",
      masterTickHz: 120,
      stateModel: "per-run-absent-to-persisted",
      recordBoundary: "opaque-snapshot-authority-issued-serialized-record-receipt",
      receiptBusBinding: "exact-snapshot-event-bus",
      acceptedPersistTick120: "exact-serialize-tick",
      duplicatePolicy: "reject-existing-run-id-without-overwrite-or-event",
      recordExposure: "original-recorder-issued-in-memory-token",
      deterministicSeedAdapter: "RunMemory.run.seed:number",
      runtimeReferenceSnapshotRecordSeedType: "string-not-claimed-as-parity",
      durableStorageSessionRestoreHandoff: "not-owned",
      emittedEvents: ["cross_run.record.persist.commit"],
      presentationDirection: "canonical-event-to-read-only-narrative-projection",
    });
    expect(Object.isFrozen(CROSS_RUN_ARCHIVE_AUTHORITY_CONTRACT)).toBe(true);
    expect(Object.isFrozen(CROSS_RUN_ARCHIVE_AUTHORITY_CONTRACT.emittedEvents)).toBe(true);
  });

  it("rejects substitute buses and forged record shapes before mutation", () => {
    class BusSubclass extends CanonicalEventBus {}
    expect(() => new CrossRunArchiveAuthority({})).toThrow(/exact CanonicalEventBus/);
    expect(() => new CrossRunArchiveAuthority(new BusSubclass())).toThrow(/exact CanonicalEventBus/);

    const bus = new CanonicalEventBus();
    const archive = new CrossRunArchiveAuthority(bus);
    const memory = createMemory("run-cross-archive-forgeries");
    const rawToken = captureRecorderIssuedRunMemory(memory);
    const parsed = parseRunMemory(JSON.stringify(memory));
    const candidates: readonly unknown[] = [
      null,
      memory,
      rawToken,
      structuredClone(memory),
      parsed,
      Object.freeze(Object.create(null)),
      new Proxy(Object.freeze(Object.create(null)), {}),
    ];
    for (const candidate of candidates) {
      expect(() => archive.persist(
        candidate as SerializedSnapshotRecordReceipt,
        50,
      )).toThrow(/opaque serialized snapshot record receipt/);
      expect(archive.snapshot().recordCount).toBe(0);
    }
    expect(bus.flush()).toEqual([]);
  });

  it("binds receipts to the exact snapshot bus", () => {
    const sourceBus = new CanonicalEventBus();
    const {receipt} = serializeOn(sourceBus, createMemory("run-cross-archive-bus-bound"));
    const otherBus = new CanonicalEventBus();
    const archive = new CrossRunArchiveAuthority(otherBus);

    expect(() => archive.persist(receipt, 50)).toThrow(/belongs to another event bus/);
    expect(archive.snapshot().recordCount).toBe(0);
    expect(otherBus.flush()).toEqual([]);
  });

  it("persists at the serialization tick with exact payload and deterministic causal order", () => {
    const bus = new CanonicalEventBus();
    const {memory, token, receipt, serializeTick120} = serializeOn(bus);
    const archive = new CrossRunArchiveAuthority(bus);

    const snapshot = archive.persist(receipt, serializeTick120);
    const events = bus.flush();
    expect(events.map(({id}) => id)).toEqual([
      "snapshot.begin",
      "snapshot.serialize.commit",
      "cross_run.record.persist.commit",
    ]);
    const persist = events.at(-1);
    expect(persist).toMatchObject({
      id: "cross_run.record.persist.commit",
      tick120: serializeTick120,
      entityStableId: `snapshot.archive:${memory.run.id}`,
      localSequence: 0,
      occurrenceKey: `cross-run:persist:${memory.run.id}`,
      payload: {
        runId: memory.run.id,
        snapshotHash: memory.fingerprint.digestSha256,
        deterministicSeed: memory.run.seed,
        routeDigest: memory.ghostRoute?.routeDigest,
        routeDurationMs: memory.ghostRoute?.points.at(-1)?.tMs,
        materialCounts: {
          overrideScars: 1,
          deathTraces: 1,
          burnIns: 1,
          ghostResidues: 1,
        },
      },
    });
    expect(Object.keys(persist?.payload ?? {})).toEqual([
      "deterministicSeed",
      "materialCounts",
      "routeDigest",
      "routeDurationMs",
      "runId",
      "snapshotHash",
    ]);
    expect(archive.get(memory.run.id)).toBe(token);
    expect(snapshot).toEqual({
      authority: "v4-cross-run-archive",
      state: "persisted",
      recordCount: 1,
      runIds: [memory.run.id],
      eventCount: 1,
      lastPersistTick120: serializeTick120,
      lastPersistedRunId: memory.run.id,
    });
  });

  it("accepts only the exact authoritative serialization tick", () => {
    const bus = new CanonicalEventBus();
    const {receipt, serializeTick120} = serializeOn(
      bus,
      createMemory("run-cross-archive-later-tick"),
    );
    const archive = new CrossRunArchiveAuthority(bus);
    const before = archive.snapshot();

    for (const tick of [-0, -1, 1.5, Number.POSITIVE_INFINITY]) {
      expect(() => archive.persist(receipt, tick)).toThrow();
      expect(archive.snapshot()).toEqual(before);
    }
    for (const tick of [serializeTick120 - 1, serializeTick120 + 1, serializeTick120 + 27]) {
      expect(() => archive.persist(receipt, tick)).toThrow(/must persist at serialized tick/);
      expect(archive.snapshot()).toEqual(before);
    }
    archive.persist(receipt, serializeTick120);
    expect(bus.flush().at(-1)).toMatchObject({
      id: "cross_run.record.persist.commit",
      tick120: serializeTick120,
    });
  });

  it("rejects duplicate persistence without overwriting the token or appending another event", () => {
    const bus = new CanonicalEventBus();
    const {memory, token, receipt, serializeTick120} = serializeOn(
      bus,
      createMemory("run-cross-archive-duplicate"),
    );
    const archive = new CrossRunArchiveAuthority(bus);
    archive.persist(receipt, serializeTick120);
    const once = archive.snapshot();

    expect(() => archive.persist(receipt, serializeTick120)).toThrow(/already persisted/);
    const independentBus = new CanonicalEventBus();
    const independent = serializeOn(
      independentBus,
      createMemory(memory.run.id, memory.run.seed + 1),
    );
    expect(independent.receipt).not.toBe(receipt);
    expect(() => archive.persist(
      independent.receipt,
      independent.serializeTick120,
    )).toThrow(/already persisted/);
    expect(archive.snapshot()).toEqual(once);
    expect(archive.get(memory.run.id)).toBe(token);
    expect(bus.flush().filter(({id}) => id === "cross_run.record.persist.commit")).toHaveLength(1);
    expect(independentBus.flush().some(({id}) => id === "cross_run.record.persist.commit")).toBe(false);
  });

  it("keeps the store absent when the intrinsic event append is rejected", () => {
    const bus = new CanonicalEventBus();
    const {memory, receipt, serializeTick120} = serializeOn(
      bus,
      createMemory("run-cross-archive-atomic"),
    );
    const archive = new CrossRunArchiveAuthority(bus);
    const blocker: GameplayEventDraft = {
      id: "cross_run.record.persist.commit",
      tick120: serializeTick120,
      entityStableId: "archive-blocker",
      localSequence: 0,
      occurrenceKey: `cross-run:persist:${memory.run.id}`,
      payload: {
        runId: memory.run.id,
        snapshotHash: memory.fingerprint.digestSha256,
        deterministicSeed: memory.run.seed,
        routeDigest: memory.ghostRoute?.routeDigest ?? "missing",
        routeDurationMs: memory.ghostRoute?.points.at(-1)?.tMs ?? 0,
        materialCounts: {overrideScars: 1, deathTraces: 1, burnIns: 1, ghostResidues: 1},
      },
    };
    bus.enqueue(blocker);

    expect(() => archive.persist(receipt, serializeTick120)).toThrow(/duplicate authoritative occurrence key/);
    expect(archive.snapshot()).toEqual({
      authority: "v4-cross-run-archive",
      state: "absent",
      recordCount: 0,
      runIds: [],
      eventCount: 0,
      lastPersistTick120: null,
      lastPersistedRunId: null,
    });
    expect(archive.get(memory.run.id)).toBeUndefined();
  });

  it("uses private state and the intrinsic bus boundary despite own-property shadows", () => {
    const bus = new CanonicalEventBus();
    const {memory, receipt, serializeTick120} = serializeOn(
      bus,
      createMemory("run-cross-archive-shadows"),
    );
    let shadowEnqueues = 0;
    Object.defineProperty(bus, "enqueueBatch", {
      configurable: true,
      value: () => { shadowEnqueues += 1; },
    });
    const archive = new CrossRunArchiveAuthority(bus);
    Object.defineProperty(archive, "records", {
      configurable: true,
      value: new Map([[memory.run.id, Object.freeze(Object.create(null))]]),
    });
    Object.defineProperty(archive, "draft", {
      configurable: true,
      value: () => ({id: "cross_run.restore.begin"}),
    });
    Object.defineProperty(archive, "snapshot", {
      configurable: true,
      value: () => ({authority: "forged", recordCount: 99}),
    });

    expect(archive.persist(receipt, serializeTick120)).toMatchObject({
      authority: "v4-cross-run-archive",
      recordCount: 1,
    });
    expect(shadowEnqueues).toBe(0);
    expect(archive.get(memory.run.id)).toBeDefined();
    expect(bus.flush().map(({id}) => id).at(-1)).toBe("cross_run.record.persist.commit");
  });

  it("returns deeply frozen, code-point ordered enumeration without exposing mutable records", () => {
    const bus = new CanonicalEventBus();
    const archive = new CrossRunArchiveAuthority(bus);
    const z = serializeOn(bus, createMemory("run-zeta"), 0);
    archive.persist(z.receipt, z.serializeTick120);
    bus.flush();
    const a = serializeOn(bus, createMemory("run-alpha", 0x41c1), 100);
    archive.persist(a.receipt, a.serializeTick120);
    bus.flush();

    const snapshot = archive.snapshot();
    expect(snapshot.runIds).toEqual(["run-alpha", "run-zeta"]);
    expect(snapshot.recordCount).toBe(2);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.runIds)).toBe(true);
    expect(() => {
      // @ts-expect-error Runtime probe: archive enumeration is readonly.
      snapshot.runIds.push("forged-run");
    }).toThrow();
    const archivedMemory = readRecorderIssuedRunMemory(archive.get("run-alpha"));
    expect(archivedMemory.run.id).toBe("run-alpha");
    expect(Object.isFrozen(archivedMemory)).toBe(true);
    expect(() => archive.get(" ")).toThrow(/non-empty string/);
  });

  it("returns the original token for the current restore authority without becoming restore authority", () => {
    const archiveBus = new CanonicalEventBus();
    const {memory, token, receipt, serializeTick120} = serializeOn(
      archiveBus,
      createMemory("run-cross-archive-restore"),
    );
    const archive = new CrossRunArchiveAuthority(archiveBus);
    archive.persist(receipt, serializeTick120);
    const archivedToken = archive.get(memory.run.id);
    expect(archivedToken).toBe(token);
    if (archivedToken === undefined) throw new Error("archive token disappeared");

    const restoreBus = new CanonicalEventBus();
    const restore = new CrossRunRestoreAuthority(
      restoreBus,
      new CrossRunRestoreConsumptionLedger(),
    );
    expect(() => restore.begin(archivedToken, "run-after-archive", 0)).not.toThrow();
    expect(restore.snapshot()).toMatchObject({
      state: "waiting-ghost",
      fromRunId: memory.run.id,
      nextRunId: "run-after-archive",
    });
  });

  it("projects real archive facts into Narrative without manufacturing BOOT handoff", () => {
    const bus = new CanonicalEventBus();
    const serialized = serializeOn(
      bus,
      createMemory("run-cross-archive-narrative"),
    );
    const archive = new CrossRunArchiveAuthority(bus);
    archive.persist(serialized.receipt, serialized.serializeTick120);
    const narrative = new NarrativeAuthority({
      snapshotRecord: validateNarrativeRecord(serialized.memory, assertRunMemory),
    });
    narrative.consumeMany(bus.flush());
    expect(narrative.snapshot()).toMatchObject({
      state: "BOOT_REHYDRATE",
      handoffReady: false,
      processedOccurrences: 3,
    });
    expect(narrative.snapshot().observations.length).toBeGreaterThan(0);

    serialized.authority.advance(196);
    narrative.consumeMany(bus.flush());
    expect(narrative.snapshot()).toMatchObject({
      state: "BOOT_REHYDRATE",
      handoffReady: false,
      processedOccurrences: 5,
    });
    expect(bus.events().filter(({id}) => id === "cross_run.record.persist.commit")).toHaveLength(1);
    expect(bus.events().some(({id}) => id === "cross_run.restore.begin")).toBe(false);
  });
});
