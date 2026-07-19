import assetBindingsJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/integration/asset-bindings-v4.json";
import eventProjectionsJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/integration/event-projections-v4.json";
import eventSchemaJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/runtime/event-schema-v4.json";
import feedbackBindingsJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/runtime/feedback-bindings-v4.json";
import runtimeContractJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/runtime/runtime-contract-v4.json";
import stateMachinesJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/runtime/state-machines-v4.json";
import {MASTER_TICK_HZ} from "./clock";
import {
  CanonicalEventBus,
  isExactCanonicalEventBus,
  type GameplayEventDraft,
} from "./events";
import {
  readSerializedSnapshotRecord,
  type SerializedSnapshotRecordReceipt,
} from "./snapshot";
import type {RecorderIssuedRunMemoryToken} from "../game/run-memory";

type Dictionary = Record<string, unknown>;

const EXPECTED_MACHINE = Object.freeze({
  id: "crossRunArchive",
  implementation: "CrossRunArchive",
  type: "immutable-idempotent-store",
  states: Object.freeze(["absent", "persisted"]),
  initialState: "absent",
  transitions: Object.freeze([
    Object.freeze({
      from: "absent",
      to: "persisted",
      trigger: "explicit-persist-serialized-record",
      events: Object.freeze(["cross_run.record.persist.commit"]),
    }),
  ]),
});

const EXPECTED_EVENT_DEFINITION = Object.freeze({
  id: "cross_run.record.persist.commit",
  domain: "cross-run",
  criticality: "critical",
  requiredPayload: Object.freeze([
    "runId",
    "snapshotHash",
    "deterministicSeed",
    "routeDigest",
    "routeDurationMs",
    "materialCounts",
  ]),
});

const EXPECTED_PROJECTION = Object.freeze({
  narrativeEvent: "snapshot.handoff",
  canonicalSources: Object.freeze(["cross_run.record.persist.commit"]),
  predicate: "archive accepted immutable Snapshot record",
  authority: "read-only projection",
});

function isRecord(value: unknown): value is Dictionary {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Dictionary {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  return value;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Dictionary;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function assertExactJson(actual: unknown, expected: unknown, path: string): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`${path} drifted from the immutable V4 contract`);
  }
}

function objectsWithField(
  value: unknown,
  path: string,
  field: string,
  accepted: ReadonlySet<string>,
): readonly Dictionary[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value.filter((entry, index): entry is Dictionary => {
    const record = requireRecord(entry, `${path}[${index}]`);
    return typeof record[field] === "string" && accepted.has(record[field] as string);
  });
}

function assertImmutableSourceContracts(): void {
  const stateMachines = requireRecord(stateMachinesJson, "state-machine manifest");
  if (stateMachines.schemaVersion !== "4.0.0" || stateMachines.id !== "1bit.state-machines.v4") {
    throw new Error("V4 state-machine manifest identity drifted");
  }
  const machines = objectsWithField(
    stateMachines.machines,
    "state-machine manifest.machines",
    "id",
    new Set(["crossRunArchive"]),
  );
  if (machines.length !== 1) throw new Error("V4 must declare exactly one cross-run archive machine");
  assertExactJson(machines[0], EXPECTED_MACHINE, "V4 cross-run archive machine");

  const runtime = requireRecord(runtimeContractJson, "runtime contract");
  if (runtime.schemaVersion !== "4.0.0" || runtime.id !== "1bit.runtime-contract.v4") {
    throw new Error("V4 runtime contract identity drifted");
  }
  const separation = requireRecord(runtime.snapshotSeparation, "runtime snapshot separation");
  if (separation.archiveResponsibility !== "persist-immutable-record") {
    throw new Error("V4 archive responsibility drifted");
  }
  if (separation.snapshotResponsibility !== "observe-serialize-present-current-run"
    || separation.restoreResponsibility !== "hydrate-next-run"
    || separation.snapshotMayRestoreNextRun !== false) {
    throw new Error("V4 snapshot/archive/restore separation drifted");
  }

  const eventSchema = requireRecord(eventSchemaJson, "event schema");
  if (eventSchema.schemaVersion !== "4.0.0" || eventSchema.id !== "1bit.event-schema.v4") {
    throw new Error("V4 event-schema identity drifted");
  }
  const eventDefinitions = objectsWithField(
    eventSchema.events,
    "event schema.events",
    "id",
    new Set(["cross_run.record.persist.commit"]),
  );
  assertExactJson(eventDefinitions, [EXPECTED_EVENT_DEFINITION], "V4 archive event definition");

  const projections = requireRecord(eventProjectionsJson, "event projections");
  if (
    projections.schemaVersion !== "4.0.0-event-projections"
    || projections.purpose
      !== "Narrative cue names are read-only projections of canonical runtime events, never a second gameplay clock."
  ) {
    throw new Error("V4 event-projection identity drifted");
  }
  const projectionRules = objectsWithField(
    projections.rules,
    "event projections.rules",
    "narrativeEvent",
    new Set(["snapshot.handoff"]),
  );
  assertExactJson(projectionRules, [EXPECTED_PROJECTION], "V4 archive narrative projection");

  const feedback = requireRecord(feedbackBindingsJson, "feedback bindings");
  if (feedback.schemaVersion !== "4.0.0" || feedback.id !== "1bit.feedback-bindings.v4") {
    throw new Error("V4 feedback-binding identity drifted");
  }
  const archiveFeedback = objectsWithField(
    feedback.bindings,
    "feedback bindings.bindings",
    "eventId",
    new Set(["cross_run.record.persist.commit"]),
  );
  assertExactJson(archiveFeedback, [], "V4 archive feedback binding absence");

  const assets = requireRecord(assetBindingsJson, "asset bindings");
  if (assets.schemaVersion !== "4.0.0-asset-bindings") {
    throw new Error("V4 asset-binding identity drifted");
  }
  const archiveAssets = objectsWithField(
    assets.runtimeCueResolvers,
    "asset bindings.runtimeCueResolvers",
    "eventId",
    new Set(["cross_run.record.persist.commit"]),
  );
  assertExactJson(archiveAssets, [], "V4 archive asset binding absence");
}

assertImmutableSourceContracts();

export const CROSS_RUN_ARCHIVE_AUTHORITY_CONTRACT = Object.freeze({
  authority: "v4-cross-run-archive" as const,
  masterTickHz: MASTER_TICK_HZ,
  stateModel: "per-run-absent-to-persisted" as const,
  recordBoundary: "opaque-snapshot-authority-issued-serialized-record-receipt" as const,
  receiptBusBinding: "exact-snapshot-event-bus" as const,
  acceptedPersistTick120: "exact-serialize-tick" as const,
  duplicatePolicy: "reject-existing-run-id-without-overwrite-or-event" as const,
  recordExposure: "original-recorder-issued-in-memory-token" as const,
  deterministicSeedAdapter: "RunMemory.run.seed:number" as const,
  runtimeReferenceSnapshotRecordSeedType: "string-not-claimed-as-parity" as const,
  durableStorageSessionRestoreHandoff: "not-owned" as const,
  emittedEvents: Object.freeze(["cross_run.record.persist.commit"]),
  presentationDirection: "canonical-event-to-read-only-narrative-projection" as const,
});

export interface CrossRunArchiveAuthoritySnapshot {
  readonly authority: "v4-cross-run-archive";
  readonly state: "absent" | "persisted";
  readonly recordCount: number;
  readonly runIds: readonly string[];
  readonly eventCount: number;
  readonly lastPersistTick120: number | null;
  readonly lastPersistedRunId: string | null;
}

function requireTick120(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || Object.is(value, -0)) {
    throw new Error(`${path} must be a non-negative safe integer`);
  }
  return value as number;
}

function requireNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function compareCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function archiveEventDraft(
  runId: string,
  tick120: number,
  payload: unknown,
): GameplayEventDraft {
  return Object.freeze({
    id: "cross_run.record.persist.commit",
    tick120,
    entityStableId: `snapshot.archive:${runId}`,
    localSequence: 0,
    occurrenceKey: `cross-run:persist:${runId}`,
    payload,
  });
}

/**
 * Explicit in-memory archive of immutable serialized current-run records. It
 * owns neither browser persistence nor next-run restoration.
 */
export class CrossRunArchiveAuthority {
  readonly #bus: CanonicalEventBus;
  readonly #records = new Map<string, RecorderIssuedRunMemoryToken>();
  #eventCount = 0;
  #lastPersistTick120: number | null = null;
  #lastPersistedRunId: string | null = null;

  constructor(busValue: unknown) {
    if (!isExactCanonicalEventBus(busValue)) {
      throw new Error("cross-run archive event bus must be an exact CanonicalEventBus");
    }
    this.#bus = busValue;
  }

  persist(
    receiptValue: SerializedSnapshotRecordReceipt,
    persistTick120Value: unknown,
  ): CrossRunArchiveAuthoritySnapshot {
    const receipt = readSerializedSnapshotRecord(receiptValue);
    const persistTick120 = requireTick120(persistTick120Value, "cross-run archive persist tick120");
    if (persistTick120 !== receipt.serializeTick120) {
      throw new Error(
        `cross-run archive must persist at serialized tick ${receipt.serializeTick120}`,
      );
    }
    const {runId} = receipt.payload;
    if (this.#records.has(runId)) {
      throw new Error(`run is already persisted: ${runId}`);
    }
    if (receipt.bus !== this.#bus) {
      throw new Error("serialized snapshot record receipt belongs to another event bus");
    }
    const payload = Object.freeze({
      runId: receipt.payload.runId,
      snapshotHash: receipt.payload.snapshotHash,
      deterministicSeed: receipt.payload.deterministicSeed,
      routeDigest: receipt.payload.routeDigest,
      routeDurationMs: receipt.payload.routeDurationMs,
      materialCounts: receipt.payload.materialCounts,
    });
    const draft = archiveEventDraft(runId, persistTick120, payload);

    CanonicalEventBus.prototype.enqueueBatch.call(this.#bus, Object.freeze([draft]));
    this.#records.set(runId, receipt.runMemoryToken);
    this.#eventCount += 1;
    this.#lastPersistTick120 = persistTick120;
    this.#lastPersistedRunId = runId;
    return this.#captureSnapshot();
  }

  get(runIdValue: unknown): RecorderIssuedRunMemoryToken | undefined {
    const runId = requireNonEmptyString(runIdValue, "cross-run archive run id");
    return this.#records.get(runId);
  }

  snapshot(): CrossRunArchiveAuthoritySnapshot {
    return this.#captureSnapshot();
  }

  #captureSnapshot(): CrossRunArchiveAuthoritySnapshot {
    const runIds = Object.freeze([...this.#records.keys()].sort(compareCodePoint));
    return Object.freeze({
      authority: "v4-cross-run-archive",
      state: this.#records.size === 0 ? "absent" : "persisted",
      recordCount: this.#records.size,
      runIds,
      eventCount: this.#eventCount,
      lastPersistTick120: this.#lastPersistTick120,
      lastPersistedRunId: this.#lastPersistedRunId,
    });
  }
}
