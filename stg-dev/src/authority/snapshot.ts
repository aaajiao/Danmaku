import assetBindingsJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/integration/asset-bindings-v4.json";
import eventProjectionsJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/integration/event-projections-v4.json";
import eventSchemaJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/runtime/event-schema-v4.json";
import feedbackBindingsJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/runtime/feedback-bindings-v4.json";
import runtimeContractJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/runtime/runtime-contract-v4.json";
import stateMachinesJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/runtime/state-machines-v4.json";
import {SNAPSHOT_TIMING} from "../../../1bit-stg-complete-asset-kit-v4/runtime/world";
import {
  CanonicalEventBus,
  isExactCanonicalEventBus,
  type GameplayEventDraft,
} from "./events";
import {
  MASTER_TICK_HZ,
  MAXIMUM_BOUNDARIES_PER_ADVANCE,
  runtime60DeadlineTick,
} from "./clock";
import {
  readRecorderIssuedRunMemory,
  type FinalizedRunMemory,
  type RecorderIssuedRunMemoryToken,
} from "./run-memory-model";

type Dictionary = Record<string, unknown>;

const AUTHORITY_ID = "snapshot";

const EXPECTED_MACHINE = Object.freeze({
  id: "snapshot",
  implementation: "SnapshotMachine",
  type: "current-run-observation-fsm",
  states: Object.freeze(["idle", "capturing", "serialized", "presenting", "complete"]),
  initialState: "idle",
  mayEmitCrossRunEvents: false,
  transitions: Object.freeze([
    Object.freeze({
      from: "idle",
      to: "capturing",
      trigger: "run-end-observation",
      events: Object.freeze(["snapshot.begin"]),
    }),
    Object.freeze({
      from: "capturing",
      to: "serialized",
      trigger: "410ms",
      events: Object.freeze(["snapshot.serialize.commit"]),
    }),
    Object.freeze({
      from: "serialized",
      to: "presenting",
      trigger: "810ms",
      events: Object.freeze(["snapshot.present.begin"]),
    }),
    Object.freeze({
      from: "presenting",
      to: "complete",
      trigger: "1630ms",
      events: Object.freeze(["snapshot.complete"]),
    }),
  ]),
});

const EXPECTED_EVENT_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "snapshot.begin",
    domain: "snapshot",
    criticality: "critical",
    requiredPayload: Object.freeze(["runId"]),
  }),
  Object.freeze({
    id: "snapshot.serialize.commit",
    domain: "snapshot",
    criticality: "critical",
    requiredPayload: Object.freeze([
      "runId",
      "snapshotHash",
      "deterministicSeed",
      "routeDigest",
      "routeDurationMs",
      "materialCounts",
    ]),
  }),
  Object.freeze({
    id: "snapshot.present.begin",
    domain: "snapshot",
    criticality: "support",
    requiredPayload: Object.freeze(["runId", "snapshotHash"]),
  }),
  Object.freeze({
    id: "snapshot.complete",
    domain: "snapshot",
    criticality: "support",
    requiredPayload: Object.freeze(["runId"]),
  }),
]);

const EXPECTED_FEEDBACK_BINDING = Object.freeze({
  id: "snapshot-begin-ui",
  eventId: "snapshot.begin",
  sink: Object.freeze({kind: "ui", cueId: "snapshot.observational-frame"}),
  gameplayCritical: true,
  modifiers: Object.freeze({contrastAware: true}),
});

const EXPECTED_ASSET_BINDING = Object.freeze({
  bindingId: "snapshot-begin-ui",
  eventId: "snapshot.begin",
  kind: "ui",
  cueId: "snapshot.observational-frame",
  resolver: "state_snapshot.observations",
});

const EXPECTED_PROJECTIONS = Object.freeze([
  Object.freeze({
    narrativeEvent: "burnIn.capture",
    canonicalSources: Object.freeze(["snapshot.serialize.commit"]),
    predicate: "serialize qualified burnIn material record",
    authority: "read-only projection",
  }),
  Object.freeze({
    narrativeEvent: "snapshot.collect",
    canonicalSources: Object.freeze(["snapshot.begin"]),
    predicate: "identity",
    authority: "read-only projection",
  }),
  Object.freeze({
    narrativeEvent: "snapshot.handoff",
    canonicalSources: Object.freeze(["cross_run.record.persist.commit"]),
    predicate: "archive accepted immutable Snapshot record",
    authority: "read-only projection",
  }),
]);

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
  return value.filter((entry): entry is Dictionary => {
    const record = requireRecord(entry, `${path} entry`);
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
    new Set(["snapshot"]),
  );
  if (machines.length !== 1) throw new Error("V4 must declare exactly one snapshot machine");
  assertExactJson(machines[0], EXPECTED_MACHINE, "V4 snapshot machine");

  const runtime = requireRecord(runtimeContractJson, "runtime contract");
  if (runtime.schemaVersion !== "4.0.0" || runtime.id !== "1bit.runtime-contract.v4") {
    throw new Error("V4 runtime contract identity drifted");
  }
  assertExactJson(requireRecord(runtime.canonicalTimingMs, "runtime canonical timing").snapshot, {
    serialize: 410,
    present: 810,
    complete: 1630,
  }, "V4 snapshot timing");
  assertExactJson(runtime.snapshotSeparation, {
    snapshotResponsibility: "observe-serialize-present-current-run",
    archiveResponsibility: "persist-immutable-record",
    restoreResponsibility: "hydrate-next-run",
    snapshotMayRestoreNextRun: false,
    restoreOrder: [
      "overrideScar",
      "deathTrace",
      "burnIn",
      "actual-ghost-route",
      "ghostResidue",
      "witnessOrientation",
      "returnInput",
    ],
    materialTypesAreDisjoint: true,
    routeDurationAuthority: "last-authoritative-ghostRoute-point-tMs",
  }, "V4 snapshot separation");
  assertExactJson(SNAPSHOT_TIMING, {
    serializeAtMs: 410,
    presentAtMs: 810,
    completeAtMs: 1630,
  }, "V4 SnapshotMachine timing constants");

  const eventSchema = requireRecord(eventSchemaJson, "event schema");
  if (eventSchema.schemaVersion !== "4.0.0" || eventSchema.id !== "1bit.event-schema.v4") {
    throw new Error("V4 event-schema identity drifted");
  }
  const eventDefinitions = objectsWithField(
    eventSchema.events,
    "event schema.events",
    "id",
    new Set(EXPECTED_EVENT_DEFINITIONS.map(({id}) => id)),
  );
  assertExactJson(eventDefinitions, EXPECTED_EVENT_DEFINITIONS, "V4 snapshot event definitions");

  const feedback = requireRecord(feedbackBindingsJson, "feedback bindings");
  if (feedback.schemaVersion !== "4.0.0" || feedback.id !== "1bit.feedback-bindings.v4") {
    throw new Error("V4 feedback-binding identity drifted");
  }
  const feedbackBindings = objectsWithField(
    feedback.bindings,
    "feedback bindings.bindings",
    "id",
    new Set(["snapshot-begin-ui"]),
  );
  assertExactJson(feedbackBindings, [EXPECTED_FEEDBACK_BINDING], "V4 snapshot feedback binding");

  const assets = requireRecord(assetBindingsJson, "asset bindings");
  if (assets.schemaVersion !== "4.0.0-asset-bindings") {
    throw new Error("V4 asset-binding identity drifted");
  }
  const runtimeCueResolvers = objectsWithField(
    assets.runtimeCueResolvers,
    "asset bindings.runtimeCueResolvers",
    "bindingId",
    new Set(["snapshot-begin-ui"]),
  );
  assertExactJson(runtimeCueResolvers, [EXPECTED_ASSET_BINDING], "V4 snapshot asset binding");

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
    new Set(EXPECTED_PROJECTIONS.map(({narrativeEvent}) => narrativeEvent)),
  );
  assertExactJson(projectionRules, EXPECTED_PROJECTIONS, "V4 snapshot projections");
}

assertImmutableSourceContracts();

/**
 * The runtime reference's convenience SnapshotRecord types deterministicSeed as
 * a string, while the canonical RunMemory manifest and the application reducer
 * use the recorder's non-negative integer run.seed. This adapter makes that
 * existing boundary explicit instead of claiming structural SnapshotRecord
 * parity or silently stringifying the seed.
 */
export const SNAPSHOT_AUTHORITY_CONTRACT = Object.freeze({
  authority: "v4-snapshot" as const,
  masterTickHz: MASTER_TICK_HZ,
  acceptedStartTick120: "even-runtime60-boundary" as const,
  boundaryPolicy: "first-non-early-runtime60-boundary" as const,
  largeDeltaPolicy: "traverse-every-crossed-authoritative-boundary" as const,
  maximumBoundariesPerAdvance: MAXIMUM_BOUNDARIES_PER_ADVANCE,
  recordBoundary: "opaque-recorder-issued-in-memory-token" as const,
  serializedRecordReceipt:
    "opaque-snapshot-authority-issued-after-accepted-serialize" as const,
  serializedReceiptBusBinding: "exact-snapshot-event-bus" as const,
  routeRequirement: "non-null-actual-player-route" as const,
  parsedClonedOrPersistedRunMemory: "unsupported" as const,
  deterministicSeedAdapter: "RunMemory.run.seed:number" as const,
  runtimeReferenceSnapshotRecordSeedType: "string-not-claimed-as-parity" as const,
  archivePersistenceSessionRenderer: "not-owned" as const,
  mayEmitCrossRunEvents: false,
  runtimeTimingMs: Object.freeze({
    serialize: SNAPSHOT_TIMING.serializeAtMs,
    present: SNAPSHOT_TIMING.presentAtMs,
    complete: SNAPSHOT_TIMING.completeAtMs,
  }),
  presentationDirection: "canonical-event-to-passive-feedback-only" as const,
});

export type SnapshotAuthorityState = "idle" | "capturing" | "serialized" | "presenting" | "complete";

export interface SnapshotMaterialCounts {
  readonly overrideScars: number;
  readonly deathTraces: number;
  readonly burnIns: number;
  readonly ghostResidues: number;
}

export interface SnapshotAuthoritySchedule {
  readonly beginTick120: number;
  readonly serializeTick120: number;
  readonly presentTick120: number;
  readonly completeTick120: number;
}

export interface SnapshotAuthoritySnapshot {
  readonly authority: "v4-snapshot";
  readonly tick120: number | null;
  readonly requestedStartTick120: number | null;
  readonly state: SnapshotAuthorityState;
  readonly runId: string | null;
  readonly snapshotHash: string | null;
  readonly deterministicSeed: number | null;
  readonly routeDigest: string | null;
  readonly routeDurationMs: number | null;
  readonly materialCounts: SnapshotMaterialCounts | null;
  readonly nextStep: number;
  readonly eventCount: number;
  readonly schedule: SnapshotAuthoritySchedule | null;
}

interface CapturedSnapshotRecord {
  readonly runId: string;
  readonly snapshotHash: string;
  readonly deterministicSeed: number;
  readonly routeDigest: string;
  readonly routeDurationMs: number;
  readonly materialCounts: SnapshotMaterialCounts;
}

declare const serializedSnapshotRecordReceiptBrand: unique symbol;

/**
 * Opaque proof that SnapshotAuthority accepted the authored serialization
 * boundary for one recorder-issued immutable record.
 */
export interface SerializedSnapshotRecordReceipt {
  readonly [serializedSnapshotRecordReceiptBrand]: "SerializedSnapshotRecordReceipt";
}

export interface SerializedSnapshotRecordPayload {
  readonly runId: string;
  readonly snapshotHash: string;
  readonly deterministicSeed: number;
  readonly routeDigest: string;
  readonly routeDurationMs: number;
  readonly materialCounts: SnapshotMaterialCounts;
}

export interface SerializedSnapshotRecordAccess {
  readonly bus: CanonicalEventBus;
  readonly runMemoryToken: RecorderIssuedRunMemoryToken;
  readonly serializeTick120: number;
  readonly payload: SerializedSnapshotRecordPayload;
}

interface SerializedSnapshotRecordReceiptState {
  readonly bus: CanonicalEventBus;
  readonly runMemoryToken: RecorderIssuedRunMemoryToken;
  readonly serializeTick120: number;
  readonly payload: CapturedSnapshotRecord;
  status: "pending" | "accepted";
}

const EXACT_SNAPSHOT_AUTHORITIES = new WeakSet<object>();
const SNAPSHOT_AUTHORITY_RECEIPTS = new WeakMap<object, SerializedSnapshotRecordReceipt>();
const SERIALIZED_SNAPSHOT_RECORD_RECEIPTS = new WeakMap<
  SerializedSnapshotRecordReceipt,
  SerializedSnapshotRecordReceiptState
>();

function createSerializedSnapshotRecordReceipt(
  bus: CanonicalEventBus,
  runMemoryToken: RecorderIssuedRunMemoryToken,
  serializeTick120: number,
  payload: CapturedSnapshotRecord,
): SerializedSnapshotRecordReceipt {
  const receipt = Object.freeze(Object.create(null)) as SerializedSnapshotRecordReceipt;
  SERIALIZED_SNAPSHOT_RECORD_RECEIPTS.set(receipt, {
    bus,
    runMemoryToken,
    serializeTick120,
    payload,
    status: "pending",
  });
  return receipt;
}

function prepareSerializedSnapshotRecordAcceptance(
  receipt: SerializedSnapshotRecordReceipt,
): SerializedSnapshotRecordReceiptState {
  const state = SERIALIZED_SNAPSHOT_RECORD_RECEIPTS.get(receipt);
  if (state === undefined || state.status !== "pending") {
    throw new Error("snapshot serialization receipt cannot be accepted from its current state");
  }
  return state;
}

/**
 * Capture the exact receipt for a real SnapshotAuthority instance. An own
 * property or proxy cannot substitute an authority or manufacture a receipt.
 */
export function captureSerializedSnapshotRecord(
  authorityValue: unknown,
): SerializedSnapshotRecordReceipt {
  if (
    typeof authorityValue !== "object"
    || authorityValue === null
    || !EXACT_SNAPSHOT_AUTHORITIES.has(authorityValue)
    || Object.getPrototypeOf(authorityValue) !== SnapshotAuthority.prototype
  ) {
    throw new Error("serialized snapshot capture requires an exact SnapshotAuthority instance");
  }
  const receipt = SNAPSHOT_AUTHORITY_RECEIPTS.get(authorityValue);
  const state = receipt === undefined
    ? undefined
    : SERIALIZED_SNAPSHOT_RECORD_RECEIPTS.get(receipt);
  if (receipt === undefined || state?.status !== "accepted") {
    throw new Error("serialized snapshot record is unavailable before snapshot.serialize.commit");
  }
  return receipt;
}

/** Internal archive read of an unforgeable serialized-record receipt. */
export function readSerializedSnapshotRecord(
  receiptValue: unknown,
): SerializedSnapshotRecordAccess {
  if (typeof receiptValue !== "object" || receiptValue === null) {
    throw new Error("cross-run archive requires an opaque serialized snapshot record receipt");
  }
  const state = SERIALIZED_SNAPSHOT_RECORD_RECEIPTS.get(
    receiptValue as SerializedSnapshotRecordReceipt,
  );
  if (state === undefined || state.status !== "accepted") {
    throw new Error("cross-run archive requires an opaque serialized snapshot record receipt");
  }
  return Object.freeze({
    bus: state.bus,
    runMemoryToken: state.runMemoryToken,
    serializeTick120: state.serializeTick120,
    payload: state.payload,
  });
}

interface ScheduledSnapshotStep {
  readonly dueTick120: number;
  readonly stateAfter: Exclude<SnapshotAuthorityState, "idle" | "capturing">;
  readonly drafts: readonly GameplayEventDraft[];
}

interface ActiveSnapshot {
  readonly requestedStartTick120: number;
  readonly record: CapturedSnapshotRecord;
  readonly serializedRecordReceipt: SerializedSnapshotRecordReceipt;
  readonly schedule: SnapshotAuthoritySchedule;
  readonly steps: readonly ScheduledSnapshotStep[];
}

function snapshotEventDraft(
  id: string,
  tick120: number,
  localSequence: number,
  occurrenceKey: string,
  payload: unknown,
): GameplayEventDraft {
  return Object.freeze({
    id,
    tick120,
    entityStableId: AUTHORITY_ID,
    localSequence,
    occurrenceKey,
    payload,
  });
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

function captureSnapshotRecord(memory: FinalizedRunMemory): CapturedSnapshotRecord {
  const route = memory.ghostRoute;
  if (route === null) {
    throw new Error("snapshot authority requires a non-null authored actual ghostRoute");
  }
  const firstPoint = route.points[0];
  const finalPoint = route.points.at(-1);
  if (firstPoint === undefined || finalPoint === undefined || firstPoint.tMs !== 0) {
    throw new Error("snapshot authority ghostRoute must begin at authored tMs 0");
  }
  for (const [index, point] of route.points.entries()) {
    if (!Number.isSafeInteger(point.tMs)) {
      throw new Error(`snapshot authority ghostRoute.points[${index}].tMs must be a safe integer`);
    }
  }
  if (memory.run.seed !== memory.fingerprint.seed) {
    throw new Error("snapshot authority recorder seed and fingerprint seed diverged");
  }
  const materialCounts = Object.freeze({
    overrideScars: memory.materialMemory.overrideScars.length,
    deathTraces: memory.materialMemory.deathTraces.length,
    burnIns: memory.materialMemory.burnIns.length,
    ghostResidues: memory.materialMemory.ghostResidues.length,
  });
  return Object.freeze({
    runId: requireNonEmptyString(memory.run.id, "snapshot run id"),
    snapshotHash: requireNonEmptyString(
      memory.fingerprint.digestSha256,
      "snapshot fingerprint digest",
    ),
    deterministicSeed: memory.run.seed,
    routeDigest: requireNonEmptyString(route.routeDigest, "snapshot route digest"),
    routeDurationMs: finalPoint.tMs,
    materialCounts,
  });
}

function freezeSchedule(value: SnapshotAuthoritySchedule): SnapshotAuthoritySchedule {
  const ticks = [
    value.beginTick120,
    value.serializeTick120,
    value.presentTick120,
    value.completeTick120,
  ];
  if (ticks.some((tick) => tick % 2 !== 0)) {
    throw new Error("snapshot deadline must land on an even runtime60 boundary");
  }
  if (ticks.some((tick, index) => index > 0 && tick <= (ticks[index - 1] as number))) {
    throw new Error("snapshot deadline order must advance strictly");
  }
  return Object.freeze({...value});
}

/**
 * Route-present current-run observation authority. It owns no archive,
 * persistence, session, renderer, input return, or next-run restore port.
 */
export class SnapshotAuthority {
  readonly #bus: CanonicalEventBus;
  private tick120Value: number | null = null;
  private stateValue: SnapshotAuthorityState = "idle";
  private activeValue: ActiveSnapshot | null = null;
  private nextStepValue = 0;
  private eventCountValue = 0;

  constructor(busValue: unknown) {
    if (!isExactCanonicalEventBus(busValue)) {
      throw new Error("snapshot event bus must be an exact CanonicalEventBus");
    }
    this.#bus = busValue;
    if (new.target === SnapshotAuthority) EXACT_SNAPSHOT_AUTHORITIES.add(this);
  }

  begin(
    currentRunMemoryTokenValue: RecorderIssuedRunMemoryToken,
    requestedStartTick120Value: unknown,
  ): SnapshotAuthoritySnapshot {
    if (this.stateValue !== "idle" || this.activeValue !== null) {
      throw new Error("snapshot authority already started");
    }
    const requestedStartTick120 = requireTick120(
      requestedStartTick120Value,
      "snapshot start tick120",
    );
    if (requestedStartTick120 % 2 !== 0) {
      throw new Error("snapshot authority must begin on an even runtime60 boundary");
    }
    const trustedMemory = readRecorderIssuedRunMemory(currentRunMemoryTokenValue);
    const record = captureSnapshotRecord(trustedMemory);
    const schedule = freezeSchedule({
      beginTick120: requestedStartTick120,
      serializeTick120: runtime60DeadlineTick(
        requestedStartTick120,
        SNAPSHOT_TIMING.serializeAtMs,
      ),
      presentTick120: runtime60DeadlineTick(
        requestedStartTick120,
        SNAPSHOT_TIMING.presentAtMs,
      ),
      completeTick120: runtime60DeadlineTick(
        requestedStartTick120,
        SNAPSHOT_TIMING.completeAtMs,
      ),
    });
    const prefix = `snapshot:${record.runId}`;
    const serializedRecordReceipt = createSerializedSnapshotRecordReceipt(
      this.#bus,
      currentRunMemoryTokenValue,
      schedule.serializeTick120,
      record,
    );
    const initialDrafts = Object.freeze([
      snapshotEventDraft("snapshot.begin", schedule.beginTick120, 0, `${prefix}:begin`, {
        runId: record.runId,
      }),
    ]);
    const steps = Object.freeze([
      Object.freeze({
        dueTick120: schedule.serializeTick120,
        stateAfter: "serialized" as const,
        drafts: Object.freeze([
          snapshotEventDraft(
            "snapshot.serialize.commit",
            schedule.serializeTick120,
            1,
            `${prefix}:serialize`,
            {
              runId: record.runId,
              snapshotHash: record.snapshotHash,
              deterministicSeed: record.deterministicSeed,
              routeDigest: record.routeDigest,
              routeDurationMs: record.routeDurationMs,
              materialCounts: record.materialCounts,
            },
          ),
        ]),
      }),
      Object.freeze({
        dueTick120: schedule.presentTick120,
        stateAfter: "presenting" as const,
        drafts: Object.freeze([
          snapshotEventDraft("snapshot.present.begin", schedule.presentTick120, 2, `${prefix}:present`, {
            runId: record.runId,
            snapshotHash: record.snapshotHash,
          }),
        ]),
      }),
      Object.freeze({
        dueTick120: schedule.completeTick120,
        stateAfter: "complete" as const,
        drafts: Object.freeze([
          snapshotEventDraft("snapshot.complete", schedule.completeTick120, 3, `${prefix}:complete`, {
            runId: record.runId,
          }),
        ]),
      }),
    ] satisfies readonly ScheduledSnapshotStep[]);
    if (steps.length > MAXIMUM_BOUNDARIES_PER_ADVANCE) {
      throw new Error("snapshot schedule exceeds the V4 boundary traversal limit");
    }
    const active = Object.freeze({
      requestedStartTick120,
      record,
      serializedRecordReceipt,
      schedule,
      steps,
    });

    CanonicalEventBus.prototype.enqueueBatch.call(this.#bus, initialDrafts);
    this.tick120Value = requestedStartTick120;
    this.stateValue = "capturing";
    this.activeValue = active;
    this.nextStepValue = 0;
    this.eventCountValue = initialDrafts.length;
    SNAPSHOT_AUTHORITY_RECEIPTS.set(this, serializedRecordReceipt);
    return this.#captureSnapshot();
  }

  advance(tick120Value: unknown): SnapshotAuthoritySnapshot {
    const tick120 = requireTick120(tick120Value, "snapshot advance tick120");
    const active = this.activeValue;
    if (active === null || this.stateValue === "idle") {
      throw new Error("snapshot authority cannot advance before begin");
    }
    if (this.tick120Value !== null && tick120 < this.tick120Value) {
      throw new Error(`snapshot authority cannot move backward from tick ${this.tick120Value} to ${tick120}`);
    }

    let nextStep = this.nextStepValue;
    let state = this.stateValue;
    let traversed = 0;
    let serializationReceiptState: SerializedSnapshotRecordReceiptState | null = null;
    const drafts: GameplayEventDraft[] = [];
    while (nextStep < active.steps.length) {
      const step = active.steps[nextStep];
      if (step === undefined) throw new Error("snapshot schedule lost a step");
      if (tick120 < step.dueTick120) break;
      traversed += 1;
      if (traversed > MAXIMUM_BOUNDARIES_PER_ADVANCE) {
        throw new Error("snapshot advance exceeded the V4 boundary traversal limit");
      }
      drafts.push(...step.drafts);
      if (step.stateAfter === "serialized") {
        serializationReceiptState = prepareSerializedSnapshotRecordAcceptance(
          active.serializedRecordReceipt,
        );
      }
      state = step.stateAfter;
      nextStep += 1;
    }

    if (drafts.length > 0) {
      CanonicalEventBus.prototype.enqueueBatch.call(this.#bus, drafts);
    }
    if (serializationReceiptState !== null) {
      serializationReceiptState.status = "accepted";
    }
    this.tick120Value = tick120;
    this.stateValue = state;
    this.nextStepValue = nextStep;
    this.eventCountValue += drafts.length;
    return this.#captureSnapshot();
  }

  snapshot(): SnapshotAuthoritySnapshot {
    return this.#captureSnapshot();
  }

  #captureSnapshot(): SnapshotAuthoritySnapshot {
    const active = this.activeValue;
    return Object.freeze({
      authority: "v4-snapshot",
      tick120: this.tick120Value,
      requestedStartTick120: active?.requestedStartTick120 ?? null,
      state: this.stateValue,
      runId: active?.record.runId ?? null,
      snapshotHash: active?.record.snapshotHash ?? null,
      deterministicSeed: active?.record.deterministicSeed ?? null,
      routeDigest: active?.record.routeDigest ?? null,
      routeDurationMs: active?.record.routeDurationMs ?? null,
      materialCounts: active?.record.materialCounts ?? null,
      nextStep: this.nextStepValue,
      eventCount: this.eventCountValue,
      schedule: active?.schedule ?? null,
    });
  }
}
