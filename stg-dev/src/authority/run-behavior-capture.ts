import roomComposersJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/room-composers-v4.json";

import {V4_CONTENT_IDENTITY, type V4ContentIdentity} from "../content/v4-content-identity";
import {
  behaviorFactsFromCanonicalReceipt,
  type CanonicalRunBehaviorFactsReceipt,
  type CanonicalRunBehaviorCountEntry,
  type CanonicalRunBehaviorEventCountEntry,
  type CanonicalRunBehaviorFactsSnapshot,
} from "./run-behavior-facts";
import {executablePattern} from "./pattern-executor";
import {
  FIRST_FIXED_ROOM_CLOSURE_CONTRACT,
  RUN_ROOM_SESSION_CONTRACT,
  type CanonicalRunRoomSessionSnapshot,
} from "./run-room-session";

const UINT32_MAX = 0xffff_ffff;
const AUTHORITY = "canonical-run-pre-room-behavior-capture-v1" as const;
const SCHEMA_VERSION = "1.0.0-ext-2026-007" as const;
const PRODUCER_ID = "canonical-run-session.pre-room-boundary-observer" as const;
const PRODUCER_VERSION = "1.0.0" as const;
const FIRST_OCCURRENCE_AUTHORITY =
  "canonical-run-first-occurrence-observation-capture-v1" as const;
const FIRST_OCCURRENCE_SCHEMA_VERSION = "1.0.0-ext-2026-008" as const;
const FIRST_OCCURRENCE_PRODUCER_ID =
  "canonical-run-session.first-occurrence-boundary-observer" as const;
const FIRST_OCCURRENCE_PRODUCER_VERSION = "1.0.0" as const;
const FIRST_OCCURRENCE_SLICE_TICKS120 =
  RUN_ROOM_SESSION_CONTRACT.relativeBoundaryTicks120.fixedSliceComplete;
const FIRST_OCCURRENCE_READ_START_OFFSET_TICKS120 =
  RUN_ROOM_SESSION_CONTRACT.relativeBoundaryTicks120.read;
const FIRST_OCCURRENCE_DRAIN_OFFSET_TICKS120 =
  RUN_ROOM_SESSION_CONTRACT.relativeBoundaryTicks120.residueDrained;
const FIRST_ROOM_CLOSURE_AUTHORITY =
  "canonical-run-first-room-closure-capture-v1" as const;
const FIRST_ROOM_CLOSURE_SCHEMA_VERSION = "1.0.0-ext-2026-009" as const;
const FIRST_ROOM_CLOSURE_PRODUCER_ID =
  "canonical-run-session.first-room-closure-observer" as const;
const FIRST_ROOM_CLOSURE_PRODUCER_VERSION = "1.0.0" as const;
const FIRST_ROOM_CLOSURE_TICKS120 =
  FIRST_FIXED_ROOM_CLOSURE_CONTRACT.closureRelativeTick120;

export interface CanonicalRunPreRoomBehaviorCaptureMissing {
  readonly availability: "missing";
  readonly reason: "pre-room-boundary-not-closed";
  readonly metricProjection: false;
  readonly selectionAllowed: false;
}

export interface CanonicalRunPreRoomBehaviorCaptureAvailable {
  readonly availability: "available";
  readonly authority: typeof AUTHORITY;
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly producerId: typeof PRODUCER_ID;
  readonly producerVersion: typeof PRODUCER_VERSION;
  readonly extensionPolicy: "EXT-2026-007";
  readonly sourceEpoch: "current-run-pre-room-prefix";
  readonly capturedAtTick120: number;
  readonly rawRunSeed: CanonicalRunBehaviorFactsSnapshot["rawRunSeed"];
  readonly contentIdentity: V4ContentIdentity;
  readonly behaviorFacts: CanonicalRunBehaviorFactsSnapshot;
  readonly metricProjection: false;
  readonly selectionAllowed: false;
}

export type CanonicalRunPreRoomBehaviorCapture =
  | CanonicalRunPreRoomBehaviorCaptureMissing
  | CanonicalRunPreRoomBehaviorCaptureAvailable;

export interface CreateCanonicalRunPreRoomBehaviorCaptureOptions {
  readonly capturedAtTick120: number;
  readonly sourceEventCount: number;
  readonly behaviorFacts: CanonicalRunBehaviorFactsSnapshot;
}

export interface CanonicalRunFirstOccurrenceObservationCaptureMissing {
  readonly availability: "missing";
  readonly reason: "first-occurrence-slice-not-closed";
  readonly roomComplete: false;
  readonly distinctVisitedDelta: 0;
  readonly continuationPolicyAvailable: false;
  readonly metricProjection: false;
  readonly selectionAllowed: false;
  readonly transitionAllowed: false;
  readonly targetRoom: null;
  readonly selectionRngDraws: 0;
  readonly canonicalEventWrites: 0;
}

export interface CanonicalRunFirstOccurrenceObservationCaptureAvailable {
  readonly availability: "available";
  readonly authority: typeof FIRST_OCCURRENCE_AUTHORITY;
  readonly schemaVersion: typeof FIRST_OCCURRENCE_SCHEMA_VERSION;
  readonly producerId: typeof FIRST_OCCURRENCE_PRODUCER_ID;
  readonly producerVersion: typeof FIRST_OCCURRENCE_PRODUCER_VERSION;
  readonly extensionPolicy: "EXT-2026-008";
  readonly sourceEpoch: "current-run-through-first-occurrence-slice";
  readonly capturedAtTick120: number;
  readonly rawRunSeed: CanonicalRunBehaviorFactsSnapshot["rawRunSeed"];
  readonly contentIdentity: V4ContentIdentity;
  readonly sourceBoundary: Readonly<{
    readonly preRoomTick120: number;
    readonly roomId: CanonicalRunRoomSessionSnapshot["roomId"];
    readonly roomOrdinal: CanonicalRunRoomSessionSnapshot["roomOrdinal"];
    readonly patternId: CanonicalRunRoomSessionSnapshot["patternId"];
    readonly occurrenceId: CanonicalRunRoomSessionSnapshot["occurrenceId"];
    readonly encounterOrdinal: CanonicalRunRoomSessionSnapshot["encounterOrdinal"];
    readonly readStartTick120: number;
    readonly occurrenceDrainedAtTick120: number;
    readonly fixedSliceCompleteTick120: number;
    readonly resolvedSeed: CanonicalRunRoomSessionSnapshot["resolvedSeed"];
  }>;
  readonly behaviorFacts: CanonicalRunBehaviorFactsSnapshot;
  readonly roomComplete: false;
  readonly distinctVisitedDelta: 0;
  readonly continuationPolicyAvailable: false;
  readonly metricProjection: false;
  readonly selectionAllowed: false;
  readonly transitionAllowed: false;
  readonly targetRoom: null;
  readonly selectionRngDraws: 0;
  readonly canonicalEventWrites: 0;
}

export type CanonicalRunFirstOccurrenceObservationCapture =
  | CanonicalRunFirstOccurrenceObservationCaptureMissing
  | CanonicalRunFirstOccurrenceObservationCaptureAvailable;

export interface CreateCanonicalRunFirstOccurrenceObservationCaptureOptions {
  readonly behaviorFacts: CanonicalRunBehaviorFactsSnapshot;
  readonly sourceEventCount: number;
  readonly preRoomCapture: CanonicalRunPreRoomBehaviorCaptureAvailable;
  readonly roomSnapshot: CanonicalRunRoomSessionSnapshot;
}

export interface CanonicalRunFirstRoomClosureCaptureMissing {
  readonly availability: "missing";
  readonly reason: "first-fixed-room-not-closed";
  readonly roomComplete: false;
  readonly distinctVisitedDelta: 0;
  readonly handoffReady: false;
  readonly metricProjection: false;
  readonly selectionAllowed: false;
  readonly transitionAllowed: false;
  readonly targetRoom: null;
  readonly selectionRngDraws: 0;
  readonly canonicalEventWrites: 0;
}

export interface CanonicalRunFirstRoomClosureCaptureAvailable {
  readonly availability: "available";
  readonly authority: typeof FIRST_ROOM_CLOSURE_AUTHORITY;
  readonly schemaVersion: typeof FIRST_ROOM_CLOSURE_SCHEMA_VERSION;
  readonly producerId: typeof FIRST_ROOM_CLOSURE_PRODUCER_ID;
  readonly producerVersion: typeof FIRST_ROOM_CLOSURE_PRODUCER_VERSION;
  readonly extensionPolicy: "EXT-2026-009";
  readonly sourceEpoch: "current-run-through-first-room-closure";
  readonly capturedAtTick120: number;
  readonly rawRunSeed: CanonicalRunBehaviorFactsSnapshot["rawRunSeed"];
  readonly contentIdentity: V4ContentIdentity;
  readonly sourceBoundary: Readonly<{
    readonly preRoomTick120: number;
    readonly firstOccurrenceObservationTick120: number;
    readonly roomClosureTick120: number;
    readonly roomId: CanonicalRunRoomSessionSnapshot["roomId"];
    readonly roomOrdinal: CanonicalRunRoomSessionSnapshot["roomOrdinal"];
    readonly patternId: CanonicalRunRoomSessionSnapshot["patternId"];
    readonly occurrenceId: CanonicalRunRoomSessionSnapshot["occurrenceId"];
    readonly encounterOrdinal: CanonicalRunRoomSessionSnapshot["encounterOrdinal"];
    readonly resolvedSeed: CanonicalRunRoomSessionSnapshot["resolvedSeed"];
  }>;
  readonly behaviorFacts: CanonicalRunBehaviorFactsSnapshot;
  readonly plannedOccurrenceCount: 1;
  readonly completedOccurrenceCount: 1;
  readonly remainingOccurrenceCount: 0;
  readonly roomComplete: true;
  readonly completedRoomVisit: Readonly<{
    readonly roomId: CanonicalRunRoomSessionSnapshot["roomId"];
    readonly roomOrdinal: CanonicalRunRoomSessionSnapshot["roomOrdinal"];
  }>;
  readonly distinctVisitedDelta: 1;
  readonly handoffReady: false;
  readonly metricProjection: false;
  readonly selectionAllowed: false;
  readonly transitionAllowed: false;
  readonly targetRoom: null;
  readonly selectionRngDraws: 0;
  readonly canonicalEventWrites: 0;
}

export type CanonicalRunFirstRoomClosureCapture =
  | CanonicalRunFirstRoomClosureCaptureMissing
  | CanonicalRunFirstRoomClosureCaptureAvailable;

declare const canonicalRunFirstRoomMetricSourceReceiptBrand: unique symbol;

/** In-memory proof that the metric source is the exact EXT-009 factory output. */
export interface CanonicalRunFirstRoomMetricSourceReceipt {
  readonly [canonicalRunFirstRoomMetricSourceReceiptBrand]: true;
}

const CANONICAL_RUN_FIRST_ROOM_CLOSURES = new WeakSet<object>();
const CANONICAL_RUN_FIRST_ROOM_METRIC_SOURCE_RECEIPTS = new WeakMap<
  object,
  CanonicalRunFirstRoomClosureCaptureAvailable
>();

export interface CreateCanonicalRunFirstRoomClosureCaptureOptions {
  readonly behaviorFactsReceipt: CanonicalRunBehaviorFactsReceipt;
  readonly sourceEventCount: number;
  readonly preRoomCapture: CanonicalRunPreRoomBehaviorCaptureAvailable;
  readonly firstOccurrenceObservationCapture:
    CanonicalRunFirstOccurrenceObservationCaptureAvailable;
  readonly roomSnapshot: CanonicalRunRoomSessionSnapshot;
}

export function issueCanonicalRunFirstRoomMetricSourceReceipt(
  capture: CanonicalRunFirstRoomClosureCaptureAvailable,
): CanonicalRunFirstRoomMetricSourceReceipt {
  if (
    typeof capture !== "object"
    || capture === null
    || !CANONICAL_RUN_FIRST_ROOM_CLOSURES.has(capture)
  ) {
    throw new Error("first-room metric source must be the exact canonical closure capture");
  }
  const receipt = Object.freeze(Object.create(null)) as CanonicalRunFirstRoomMetricSourceReceipt;
  CANONICAL_RUN_FIRST_ROOM_METRIC_SOURCE_RECEIPTS.set(receipt, capture);
  return receipt;
}

export function firstRoomClosureFromCanonicalMetricSourceReceipt(
  receipt: CanonicalRunFirstRoomMetricSourceReceipt,
): CanonicalRunFirstRoomClosureCaptureAvailable {
  if (typeof receipt !== "object" || receipt === null) {
    throw new Error("first-room metric source receipt must be an opaque object");
  }
  const capture = CANONICAL_RUN_FIRST_ROOM_METRIC_SOURCE_RECEIPTS.get(receipt);
  if (capture === undefined) {
    throw new Error("first-room metric source receipt was not issued by the canonical closure factory");
  }
  return capture;
}

export const CANONICAL_RUN_PRE_ROOM_BEHAVIOR_CAPTURE_MISSING:
  CanonicalRunPreRoomBehaviorCaptureMissing = Object.freeze({
  availability: "missing",
  reason: "pre-room-boundary-not-closed",
  metricProjection: false,
  selectionAllowed: false,
});

export const CANONICAL_RUN_FIRST_OCCURRENCE_OBSERVATION_CAPTURE_MISSING:
  CanonicalRunFirstOccurrenceObservationCaptureMissing = Object.freeze({
  availability: "missing",
  reason: "first-occurrence-slice-not-closed",
  roomComplete: false,
  distinctVisitedDelta: 0,
  continuationPolicyAvailable: false,
  metricProjection: false,
  selectionAllowed: false,
  transitionAllowed: false,
  targetRoom: null,
  selectionRngDraws: 0,
  canonicalEventWrites: 0,
});

export const CANONICAL_RUN_FIRST_ROOM_CLOSURE_CAPTURE_MISSING:
  CanonicalRunFirstRoomClosureCaptureMissing = Object.freeze({
  availability: "missing",
  reason: "first-fixed-room-not-closed",
  roomComplete: false,
  distinctVisitedDelta: 0,
  handoffReady: false,
  metricProjection: false,
  selectionAllowed: false,
  transitionAllowed: false,
  targetRoom: null,
  selectionRngDraws: 0,
  canonicalEventWrites: 0,
});

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`pre-room behavior capture ${message}`);
}

function safeNonNegativeInteger(value: unknown, path: string): number {
  invariant(
    Number.isSafeInteger(value) && (value as number) >= 0 && !Object.is(value, -0),
    `${path} must be a non-negative safe integer`,
  );
  return value as number;
}

function safePositiveInteger(value: unknown, path: string): number {
  const result = safeNonNegativeInteger(value, path);
  invariant(result > 0, `${path} must be positive`);
  return result;
}

function safeAdd(left: number, right: number, path: string): number {
  const result = left + right;
  invariant(Number.isSafeInteger(result) && result >= 0, `${path} exceeded safe integer range`);
  return result;
}

function assertFrozenJsonData(
  value: unknown,
  path = "behaviorFacts",
  active = new Set<object>(),
  verified = new Set<object>(),
): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    invariant(Number.isFinite(value) && !Object.is(value, -0), `${path} must be a finite JSON number`);
    return;
  }
  invariant(typeof value === "object", `${path} must contain JSON data only`);
  const object = value as object;
  invariant(!active.has(object), `${path} must not contain a cycle`);
  if (verified.has(object)) return;
  invariant(Object.isFrozen(object), `${path} must be recursively frozen`);

  active.add(object);
  if (Array.isArray(value)) {
    invariant(Object.getPrototypeOf(value) === Array.prototype, `${path} must be a plain array`);
    const ownKeys = Reflect.ownKeys(value);
    invariant(
      ownKeys.length === value.length + 1
        && ownKeys[value.length] === "length"
        && ownKeys.slice(0, value.length).every((key, index) => key === String(index)),
      `${path} must be a dense array without custom properties`,
    );
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      invariant(
        descriptor !== undefined && "value" in descriptor && descriptor.enumerable,
        `${path}[${index}] must be an enumerable data property`,
      );
      assertFrozenJsonData(value[index], `${path}[${index}]`, active, verified);
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    invariant(
      prototype === Object.prototype || prototype === null,
      `${path} must be a plain object`,
    );
    for (const key of Reflect.ownKeys(value)) {
      invariant(typeof key === "string", `${path} must not contain symbol properties`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      invariant(
        descriptor !== undefined && "value" in descriptor && descriptor.enumerable,
        `${path}.${key} must be an enumerable data property`,
      );
      assertFrozenJsonData(descriptor.value, `${path}.${key}`, active, verified);
    }
  }
  active.delete(object);
  verified.add(object);
}

function assertExactKeys(value: unknown, expected: readonly string[], path: string): void {
  invariant(typeof value === "object" && value !== null && !Array.isArray(value), `${path} must be an object`);
  const actual = Object.keys(value).sort(compareCodePoints);
  const canonicalExpected = [...expected].sort(compareCodePoints);
  invariant(
    actual.length === canonicalExpected.length
      && actual.every((key, index) => key === canonicalExpected[index]),
    `${path} must contain only its exact schema fields`,
  );
}

function assertBehaviorCountEntryShapes(value: unknown, path: string): void {
  invariant(Array.isArray(value), `${path} must be an array`);
  for (const [index, entry] of value.entries()) {
    assertExactKeys(entry, ["id", "ticks120"], `${path}[${index}]`);
  }
}

function assertAvailableAggregateShape(
  value: unknown,
  aggregateKeys: readonly string[],
  path: string,
  countEntryKeys: readonly string[] = [],
): void {
  assertExactKeys(
    value,
    ["availability", "firstAvailableTick120", "lastAvailableTick120", "sampleCount", "aggregate"],
    path,
  );
  const record = value as Record<string, unknown>;
  invariant(record.availability === "available", `${path} must be available at the capture boundary`);
  const first = safePositiveInteger(record.firstAvailableTick120, `${path}.firstAvailableTick120`);
  const last = safePositiveInteger(record.lastAvailableTick120, `${path}.lastAvailableTick120`);
  const count = safePositiveInteger(record.sampleCount, `${path}.sampleCount`);
  invariant(first <= last && count <= last - first + 1, `${path} has an invalid availability window`);
  assertExactKeys(record.aggregate, aggregateKeys, `${path}.aggregate`);
  const aggregate = record.aggregate as Record<string, unknown>;
  for (const key of countEntryKeys) {
    assertBehaviorCountEntryShapes(aggregate[key], `${path}.aggregate.${key}`);
  }
}

function assertExactSourceShape(facts: CanonicalRunBehaviorFactsSnapshot): void {
  assertExactKeys(facts, [
    "authority",
    "schemaVersion",
    "producerId",
    "producerVersion",
    "extensionPolicy",
    "rawRunSeed",
    "tick120",
    "acceptedTickCount",
    "sampling",
    "requested",
    "committed",
    "context",
    "canonicalEvents",
    "composerAvailability",
    "adapterPolicy",
  ], "behaviorFacts");
  assertExactKeys(facts.rawRunSeed, ["domain", "value"], "behaviorFacts.rawRunSeed");
  assertExactKeys(facts.sampling, [
    "tickZeroExcluded",
    "firstAcceptedTick120",
    "lastAcceptedTick120",
    "ownerPhaseTickCounts",
  ], "behaviorFacts.sampling");
  assertBehaviorCountEntryShapes(
    facts.sampling.ownerPhaseTickCounts,
    "behaviorFacts.sampling.ownerPhaseTickCounts",
  );

  assertAvailableAggregateShape(facts.requested, [
    "movementNonZeroTickCount",
    "movementXSum",
    "movementYSum",
    "movementMagnitudeSum",
    "signalActiveTickCount",
    "signalRisingEdgeCount",
    "focusRequestedTickCount",
    "gazeVisibleTickCount",
    "gazePitchDegreesMin",
    "gazePitchDegreesMax",
    "gazeAlignmentSum",
    "gazeQualifiedInputTickCount",
    "overridePressedEdgeCount",
    "overrideReleasedEdgeCount",
    "overrideDirectionRequestCount",
  ], "behaviorFacts.requested");

  assertExactKeys(facts.committed, ["player", "flower", "gaze", "override"], "behaviorFacts.committed");
  assertAvailableAggregateShape(facts.committed.player, [
    "inputEnabledTickCount",
    "focusedTickCount",
    "positionXSum",
    "positionYSum",
    "positionMinX",
    "positionMaxX",
    "positionMinY",
    "positionMaxY",
    "lifeStateObservedTickCount",
    "lifeStateTickCounts",
  ], "behaviorFacts.committed.player", ["lifeStateTickCounts"]);
  assertAvailableAggregateShape(
    facts.committed.flower,
    ["targetIntensitySum", "sourceTickCounts"],
    "behaviorFacts.committed.flower",
    ["sourceTickCounts"],
  );
  assertAvailableAggregateShape(
    facts.committed.gaze,
    ["clampActiveTickCount", "stateTickCounts"],
    "behaviorFacts.committed.gaze",
    ["stateTickCounts"],
  );
  assertAvailableAggregateShape(
    facts.committed.override,
    ["stateTickCounts", "maximumCycle", "maximumScarCount"],
    "behaviorFacts.committed.override",
    ["stateTickCounts"],
  );

  assertExactKeys(facts.context, ["room", "runCombat"], "behaviorFacts.context");
  if (facts.context.room.availability === "missing") {
    assertExactKeys(facts.context.room, ["availability", "reason"], "behaviorFacts.context.room");
  } else {
    assertAvailableAggregateShape(
      facts.context.room,
      ["roomTickCounts"],
      "behaviorFacts.context.room",
      ["roomTickCounts"],
    );
  }
  assertAvailableAggregateShape(
    facts.context.runCombat,
    ["noActiveOccurrenceTickCount", "activeOccurrenceTickCounts"],
    "behaviorFacts.context.runCombat",
    ["activeOccurrenceTickCounts"],
  );

  assertExactKeys(facts.canonicalEvents, [
    "tickZeroBaselineCount",
    "observedCount",
    "lastObservedSequence",
    "countsById",
  ], "behaviorFacts.canonicalEvents");
  invariant(Array.isArray(facts.canonicalEvents.countsById), "behaviorFacts event counts must be an array");
  for (const [index, entry] of facts.canonicalEvents.countsById.entries()) {
    assertExactKeys(entry, ["id", "count"], `behaviorFacts.canonicalEvents.countsById[${index}]`);
  }
  assertExactKeys(facts.composerAvailability, [
    "status",
    "ready",
    "selectionAllowed",
    "unresolvedMetricIds",
  ], "behaviorFacts.composerAvailability");
  assertExactKeys(facts.adapterPolicy, [
    "sampleBoundary",
    "ownerPhase",
    "storage",
    "requestCommitSeparation",
    "canonicalEventWrites",
    "metricProjection",
    "provenance",
  ], "behaviorFacts.adapterPolicy");
}

function canonicalFrozenClone<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => canonicalFrozenClone(entry))) as T;
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort(compareCodePoints)) {
    result[key] = canonicalFrozenClone((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(result) as T;
}

function metricUniverse(): readonly string[] {
  invariant(
    roomComposersJson.schemaVersion === "4.0.0",
    "requires the V4 room-composer schema identity",
  );
  const ids = new Set<string>();
  for (const composer of roomComposersJson.composers) {
    invariant(
      composer.algorithm === "seeded_weighted_without_replacement_with_behavior_bias",
      `room composer algorithm drifted: ${composer.id}`,
    );
    for (const id of Object.keys(composer.behaviorMetricWeights)) ids.add(id);
  }
  const result = [...ids].sort(compareCodePoints);
  invariant(result.length === 14, "V4 room-composer metric universe must contain fourteen IDs");
  return Object.freeze(result);
}

const UNRESOLVED_METRIC_IDS = metricUniverse();

function assertSortedUniqueIds(
  values: readonly string[],
  expected: readonly string[],
  path: string,
): void {
  invariant(values.length === expected.length, `${path} must contain exactly fourteen IDs`);
  for (let index = 0; index < values.length; index += 1) {
    invariant(typeof values[index] === "string" && values[index]!.length > 0, `${path}[${index}] is invalid`);
    if (index > 0) {
      invariant(
        compareCodePoints(values[index - 1]!, values[index]!) < 0,
        `${path} must be unique and code-point sorted`,
      );
    }
    invariant(values[index] === expected[index], `${path} diverged from the V4 metric universe`);
  }
}

function validatePreRoomOwnerPhaseCounts(
  entries: readonly CanonicalRunBehaviorCountEntry[],
  capturedAtTick120: number,
): void {
  const allowed = new Set(["quiet_awakening", "first_eye", "first_clamp_recovery"]);
  let previousId: string | null = null;
  let total = 0;
  let recoveryTicks = 0;
  for (const [index, entry] of entries.entries()) {
    invariant(typeof entry.id === "string" && entry.id.length > 0, `owner phase entry ${index} has no ID`);
    invariant(allowed.has(entry.id), `owner phase ${entry.id} is not part of the pre-room prefix`);
    if (previousId !== null) {
      invariant(compareCodePoints(previousId, entry.id) < 0, "owner phase counts must be unique and sorted");
    }
    const count = safePositiveInteger(entry.ticks120, `owner phase ${entry.id} ticks120`);
    total = safeAdd(total, count, "owner phase total");
    if (entry.id === "first_clamp_recovery") recoveryTicks = count;
    previousId = entry.id;
  }
  invariant(total === capturedAtTick120, "owner phase counts must cover every accepted pre-room tick");
  invariant(recoveryTicks > 0, "must close at least one first-clamp-recovery tick");
}

function validateEventCounts(
  entries: readonly CanonicalRunBehaviorEventCountEntry[],
  observedCount: number,
): void {
  let previousId: string | null = null;
  let total = 0;
  for (const [index, entry] of entries.entries()) {
    invariant(typeof entry.id === "string" && entry.id.length > 0, `event count entry ${index} has no ID`);
    if (previousId !== null) {
      invariant(compareCodePoints(previousId, entry.id) < 0, "event count IDs must be unique and sorted");
    }
    total = safeAdd(total, safePositiveInteger(entry.count, `event ${entry.id} count`), "event count total");
    previousId = entry.id;
  }
  invariant(total === observedCount, "event ID multiset must equal the observed event count");
}

function validateCommonSourceFacts(
  facts: CanonicalRunBehaviorFactsSnapshot,
  capturedAtTick120: number,
  sourceEventCount: number,
): void {
  assertFrozenJsonData(facts);
  assertExactSourceShape(facts);
  invariant(facts.authority === "canonical-run-behavior-facts-v1", "source authority is incompatible");
  invariant(facts.schemaVersion === "1.0.0-ext-2026-006", "source schema is incompatible");
  invariant(
    facts.producerId === "canonical-run-session.accepted-tick-observer",
    "source producer is incompatible",
  );
  invariant(facts.producerVersion === "1.0.0", "source producer version is incompatible");
  invariant(facts.extensionPolicy === "EXT-2026-006", "source extension policy is incompatible");

  invariant(
    facts.rawRunSeed.domain === "raw-run-seed"
      && Number.isSafeInteger(facts.rawRunSeed.value)
      && facts.rawRunSeed.value >= 0
      && facts.rawRunSeed.value <= UINT32_MAX
      && !Object.is(facts.rawRunSeed.value, -0),
    "source raw Run seed must be a tagged uint32",
  );
  invariant(facts.tick120 === capturedAtTick120, "source tick must equal the capture boundary");
  invariant(facts.acceptedTickCount === capturedAtTick120, "accepted count must equal the capture boundary");
  invariant(facts.sampling.tickZeroExcluded === true, "source must exclude constructor tick zero");
  invariant(facts.sampling.firstAcceptedTick120 === 1, "source must begin at accepted tick one");
  invariant(
    facts.sampling.lastAcceptedTick120 === capturedAtTick120,
    "source must end at the capture boundary",
  );
  invariant(
    facts.composerAvailability.status === "withheld-metric-projection-policy-not-authored"
      && facts.composerAvailability.ready === false
      && facts.composerAvailability.selectionAllowed === false,
    "composer selection must remain withheld",
  );
  assertSortedUniqueIds(
    facts.composerAvailability.unresolvedMetricIds,
    UNRESOLVED_METRIC_IDS,
    "unresolved metric IDs",
  );
  invariant(
    facts.adapterPolicy.sampleBoundary === "post-authority-after-closed-canonical-tick"
      && facts.adapterPolicy.ownerPhase === "captured-before-phase-specific-step"
      && facts.adapterPolicy.storage === "bounded-rolling-aggregates-no-per-tick-history"
      && facts.adapterPolicy.requestCommitSeparation === true
      && facts.adapterPolicy.canonicalEventWrites === 0
      && facts.adapterPolicy.metricProjection === false
      && facts.adapterPolicy.provenance === "application-policy-EXT-2026-006",
    "source adapter policy is incompatible",
  );

  const baselineCount = safeNonNegativeInteger(
    facts.canonicalEvents.tickZeroBaselineCount,
    "tick-zero baseline event count",
  );
  const observedCount = safeNonNegativeInteger(
    facts.canonicalEvents.observedCount,
    "observed event count",
  );
  invariant(
    safeAdd(baselineCount, observedCount, "source event count") === sourceEventCount,
    "event cursor must equal the canonical trace prefix",
  );
  if (observedCount === 0) {
    invariant(facts.canonicalEvents.lastObservedSequence === null, "empty event suffix must have no last sequence");
  } else {
    invariant(
      facts.canonicalEvents.lastObservedSequence === baselineCount + observedCount - 1,
      "last observed event sequence must close the event prefix",
    );
  }
  validateEventCounts(facts.canonicalEvents.countsById, observedCount);
}

function validatePreRoomSourceFacts(
  facts: CanonicalRunBehaviorFactsSnapshot,
  capturedAtTick120: number,
  sourceEventCount: number,
): void {
  validateCommonSourceFacts(facts, capturedAtTick120, sourceEventCount);
  validatePreRoomOwnerPhaseCounts(facts.sampling.ownerPhaseTickCounts, capturedAtTick120);
  invariant(
    facts.context.room.availability === "missing"
      && facts.context.room.reason === "room-context-not-consumed-yet",
    "room context must remain missing at the pre-room boundary",
  );
}

function assertContentIdentity(value: V4ContentIdentity, path: string): void {
  assertExactKeys(value, [
    "contentAuthoritySchemaVersion",
    "packageId",
    "packageSchemaVersion",
    "packageManifestSha256",
    "contentDigestSha256",
  ], path);
  invariant(
    value.contentAuthoritySchemaVersion === V4_CONTENT_IDENTITY.contentAuthoritySchemaVersion
      && value.packageId === V4_CONTENT_IDENTITY.packageId
      && value.packageSchemaVersion === V4_CONTENT_IDENTITY.packageSchemaVersion
      && value.packageManifestSha256 === V4_CONTENT_IDENTITY.packageManifestSha256
      && value.contentDigestSha256 === V4_CONTENT_IDENTITY.contentDigestSha256,
    `${path} diverged from the shared V4 content identity`,
  );
}

function validateAvailablePreRoomCapture(
  capture: CanonicalRunPreRoomBehaviorCaptureAvailable,
  expectedTick120: number,
  expectedSourceEventCount: number,
  rawRunSeed: CanonicalRunBehaviorFactsSnapshot["rawRunSeed"],
): void {
  assertFrozenJsonData(capture, "preRoomCapture");
  assertExactKeys(capture, [
    "availability",
    "authority",
    "schemaVersion",
    "producerId",
    "producerVersion",
    "extensionPolicy",
    "sourceEpoch",
    "capturedAtTick120",
    "rawRunSeed",
    "contentIdentity",
    "behaviorFacts",
    "metricProjection",
    "selectionAllowed",
  ], "preRoomCapture");
  invariant(
    capture.availability === "available"
      && capture.authority === AUTHORITY
      && capture.schemaVersion === SCHEMA_VERSION
      && capture.producerId === PRODUCER_ID
      && capture.producerVersion === PRODUCER_VERSION
      && capture.extensionPolicy === "EXT-2026-007"
      && capture.sourceEpoch === "current-run-pre-room-prefix"
      && capture.metricProjection === false
      && capture.selectionAllowed === false,
    "preRoomCapture identity or firewall is incompatible",
  );
  invariant(
    capture.capturedAtTick120 === expectedTick120,
    "preRoomCapture must close exactly at source H",
  );
  invariant(
    capture.rawRunSeed.domain === "raw-run-seed"
      && capture.rawRunSeed.value === rawRunSeed.value,
    "preRoomCapture raw Run seed diverged from the occurrence source",
  );
  assertContentIdentity(capture.contentIdentity, "preRoomCapture.contentIdentity");
  validatePreRoomSourceFacts(
    capture.behaviorFacts,
    expectedTick120,
    expectedSourceEventCount,
  );
  invariant(
    capture.behaviorFacts.rawRunSeed.value === rawRunSeed.value,
    "preRoomCapture behavior facts raw Run seed diverged",
  );
}

function validateFirstOccurrenceOwnerPhaseCounts(
  entries: readonly CanonicalRunBehaviorCountEntry[],
  capturedAtTick120: number,
): void {
  const allowed = new Set([
    "quiet_awakening",
    "first_eye",
    "first_clamp_recovery",
    "room_sampling",
  ]);
  let previousId: string | null = null;
  let total = 0;
  let recoveryTicks = 0;
  let roomSamplingTicks = 0;
  for (const [index, entry] of entries.entries()) {
    invariant(typeof entry.id === "string" && entry.id.length > 0, `owner phase entry ${index} has no ID`);
    invariant(allowed.has(entry.id), `owner phase ${entry.id} is outside the first-occurrence prefix`);
    if (previousId !== null) {
      invariant(compareCodePoints(previousId, entry.id) < 0, "owner phase counts must be unique and sorted");
    }
    const count = safePositiveInteger(entry.ticks120, `owner phase ${entry.id} ticks120`);
    total = safeAdd(total, count, "owner phase total");
    if (entry.id === "first_clamp_recovery") recoveryTicks = count;
    if (entry.id === "room_sampling") roomSamplingTicks = count;
    previousId = entry.id;
  }
  invariant(total === capturedAtTick120, "owner phase counts must cover every accepted source tick");
  invariant(recoveryTicks > 0, "source must retain the completed first-clamp-recovery prefix");
  invariant(
    roomSamplingTicks === FIRST_OCCURRENCE_SLICE_TICKS120,
    "room_sampling owner must consume exactly the fixed first-occurrence slice",
  );
}

function validateFirstOccurrenceRoomContext(
  facts: CanonicalRunBehaviorFactsSnapshot,
  preRoomTick120: number,
  capturedAtTick120: number,
): void {
  const room = facts.context.room;
  invariant(room.availability === "available", "room context must be available at slice close");
  invariant(
    room.firstAvailableTick120 === preRoomTick120 + 1
      && room.lastAvailableTick120 === capturedAtTick120
      && room.sampleCount === FIRST_OCCURRENCE_SLICE_TICKS120,
    "room context must cover exactly H+1 through H+1701",
  );
  invariant(
    room.aggregate.roomTickCounts.length === 1
      && room.aggregate.roomTickCounts[0]?.id === "FORCED_ALIGNMENT"
      && room.aggregate.roomTickCounts[0]?.ticks120 === FIRST_OCCURRENCE_SLICE_TICKS120,
    "room context must contain exactly 1701 Forced Alignment ticks",
  );
}

function behaviorCountMap(
  entries: readonly CanonicalRunBehaviorCountEntry[],
  path: string,
): Readonly<{counts: ReadonlyMap<string, number>; total: number}> {
  const counts = new Map<string, number>();
  let previousId: string | null = null;
  let total = 0;
  for (const [index, entry] of entries.entries()) {
    invariant(typeof entry.id === "string" && entry.id.length > 0, `${path}[${index}].id is invalid`);
    if (previousId !== null) {
      invariant(compareCodePoints(previousId, entry.id) < 0, `${path} must be unique and sorted`);
    }
    const count = safePositiveInteger(entry.ticks120, `${path}[${index}].ticks120`);
    counts.set(entry.id, count);
    total = safeAdd(total, count, `${path} total`);
    previousId = entry.id;
  }
  return Object.freeze({counts, total});
}

function validateFirstOccurrenceBehaviorPrefix(
  preRoomFacts: CanonicalRunBehaviorFactsSnapshot,
  occurrenceFacts: CanonicalRunBehaviorFactsSnapshot,
  preRoomTick120: number,
  capturedAtTick120: number,
): void {
  const preOwners = behaviorCountMap(
    preRoomFacts.sampling.ownerPhaseTickCounts,
    "preRoomCapture owner phase counts",
  );
  const occurrenceOwners = behaviorCountMap(
    occurrenceFacts.sampling.ownerPhaseTickCounts,
    "first-occurrence owner phase counts",
  );
  invariant(
    occurrenceOwners.counts.size === preOwners.counts.size + 1,
    "first-occurrence owner phases must add only room_sampling",
  );
  for (const [id, count] of preOwners.counts) {
    invariant(
      occurrenceOwners.counts.get(id) === count,
      `pre-room owner phase ${id} changed after H`,
    );
  }
  invariant(
    occurrenceOwners.counts.get("room_sampling") === FIRST_OCCURRENCE_SLICE_TICKS120,
    "room_sampling owner must add exactly 1701 ticks after H",
  );

  const preRunCombat = preRoomFacts.context.runCombat;
  const occurrenceRunCombat = occurrenceFacts.context.runCombat;
  invariant(
    preRunCombat.availability === "available"
      && occurrenceRunCombat.availability === "available",
    "run-combat facts must remain available across H",
  );
  invariant(
    preRunCombat.lastAvailableTick120 === preRoomTick120
      && occurrenceRunCombat.firstAvailableTick120 === preRunCombat.firstAvailableTick120
      && occurrenceRunCombat.lastAvailableTick120 === capturedAtTick120
      && occurrenceRunCombat.sampleCount
        === safeAdd(preRunCombat.sampleCount, FIRST_OCCURRENCE_SLICE_TICKS120, "run-combat samples"),
    "run-combat availability window must extend by exactly the fixed occurrence slice",
  );

  const preActive = behaviorCountMap(
    preRunCombat.aggregate.activeOccurrenceTickCounts,
    "preRoomCapture active occurrence counts",
  );
  const occurrenceActive = behaviorCountMap(
    occurrenceRunCombat.aggregate.activeOccurrenceTickCounts,
    "first-occurrence active occurrence counts",
  );
  const expectedActiveTicks = FIRST_OCCURRENCE_DRAIN_OFFSET_TICKS120
    - FIRST_OCCURRENCE_READ_START_OFFSET_TICKS120;
  invariant(
    occurrenceActive.counts.size === preActive.counts.size + 1
      && preActive.counts.has(RUN_ROOM_SESSION_CONTRACT.occurrenceId) === false,
    "first-occurrence facts must add exactly one new occurrence identity",
  );
  for (const [id, count] of preActive.counts) {
    invariant(
      occurrenceActive.counts.get(id) === count,
      `pre-room active occurrence ${id} changed after H`,
    );
  }
  invariant(
    occurrenceActive.counts.get(RUN_ROOM_SESSION_CONTRACT.occurrenceId) === expectedActiveTicks,
    "fixed first occurrence must own exactly 1540 accepted ticks",
  );

  const preNoActive = safeNonNegativeInteger(
    preRunCombat.aggregate.noActiveOccurrenceTickCount,
    "preRoomCapture no-active occurrence count",
  );
  const occurrenceNoActive = safeNonNegativeInteger(
    occurrenceRunCombat.aggregate.noActiveOccurrenceTickCount,
    "first-occurrence no-active occurrence count",
  );
  const expectedNoActiveDelta = FIRST_OCCURRENCE_SLICE_TICKS120 - expectedActiveTicks;
  invariant(
    occurrenceNoActive === safeAdd(preNoActive, expectedNoActiveDelta, "no-active occurrence delta"),
    "fixed first occurrence must add exactly 161 no-active ticks",
  );
  invariant(
    safeAdd(preActive.total, preNoActive, "pre-room run-combat accounting")
      === preRunCombat.sampleCount
      && safeAdd(occurrenceActive.total, occurrenceNoActive, "first-occurrence run-combat accounting")
        === occurrenceRunCombat.sampleCount,
    "run-combat active and no-active counts must cover every available sample",
  );
}

function validateClaimedOccurrenceFacts(
  room: CanonicalRunRoomSessionSnapshot,
  facts: CanonicalRunBehaviorFactsSnapshot,
): void {
  const runCombat = facts.context.runCombat;
  invariant(runCombat.availability === "available", "claimed occurrence facts must be available");
  const observedIds = runCombat.aggregate.activeOccurrenceTickCounts.map((entry) => entry.id);
  invariant(
    room.runCombat.claimedOccurrenceIds.length === observedIds.length
      && room.runCombat.claimedOccurrenceIds.every((id, index) => id === observedIds[index]),
    "shared run claimed occurrences must equal the observed behavior occurrence identities",
  );
}

function validateEventPrefixExtension(
  preRoomFacts: CanonicalRunBehaviorFactsSnapshot,
  occurrenceFacts: CanonicalRunBehaviorFactsSnapshot,
): void {
  invariant(
    occurrenceFacts.canonicalEvents.tickZeroBaselineCount
      === preRoomFacts.canonicalEvents.tickZeroBaselineCount,
    "tick-zero event baseline changed after H",
  );
  invariant(
    occurrenceFacts.canonicalEvents.observedCount >= preRoomFacts.canonicalEvents.observedCount,
    "H event prefix was truncated during the fixed occurrence",
  );
  const occurrenceCounts = new Map(
    occurrenceFacts.canonicalEvents.countsById.map((entry) => [entry.id, entry.count] as const),
  );
  for (const entry of preRoomFacts.canonicalEvents.countsById) {
    invariant(
      (occurrenceCounts.get(entry.id) ?? 0) >= entry.count,
      `H event prefix count for ${entry.id} was truncated`,
    );
  }
}

function validateFirstRoomClosureEventDelta(
  observationFacts: CanonicalRunBehaviorFactsSnapshot,
  closureFacts: CanonicalRunBehaviorFactsSnapshot,
): void {
  const observationCounts = new Map(
    observationFacts.canonicalEvents.countsById.map((entry) => [entry.id, entry.count] as const),
  );
  let deltaTotal = 0;
  for (const entry of closureFacts.canonicalEvents.countsById) {
    const delta = entry.count - (observationCounts.get(entry.id) ?? 0);
    invariant(delta >= 0, `H+1701 event count for ${entry.id} decreased at room closure`);
    if (delta > 0) {
      invariant(
        FIRST_FIXED_ROOM_CLOSURE_CONTRACT.parentCanonicalEventIds.includes(
          entry.id as typeof FIRST_FIXED_ROOM_CLOSURE_CONTRACT.parentCanonicalEventIds[number],
        ),
        `room closure event delta contains forbidden authority ${entry.id}`,
      );
      deltaTotal = safeAdd(deltaTotal, delta, "room closure event delta");
    }
  }
  invariant(
    closureFacts.canonicalEvents.observedCount
      === safeAdd(
        observationFacts.canonicalEvents.observedCount,
        deltaTotal,
        "room closure observed event count",
      ),
    "room closure event multiset delta must equal the observed suffix length",
  );
}

function sourceEventCountForFacts(
  facts: CanonicalRunBehaviorFactsSnapshot,
  path: string,
): number {
  return safeAdd(
    safeNonNegativeInteger(
      facts.canonicalEvents.tickZeroBaselineCount,
      `${path}.canonicalEvents.tickZeroBaselineCount`,
    ),
    safeNonNegativeInteger(
      facts.canonicalEvents.observedCount,
      `${path}.canonicalEvents.observedCount`,
    ),
    `${path} source event count`,
  );
}

function validateAvailableFirstOccurrenceObservationCapture(
  capture: CanonicalRunFirstOccurrenceObservationCaptureAvailable,
  preRoomCapture: CanonicalRunPreRoomBehaviorCaptureAvailable,
): void {
  assertFrozenJsonData(capture, "firstOccurrenceObservationCapture");
  assertExactKeys(capture, [
    "availability",
    "authority",
    "schemaVersion",
    "producerId",
    "producerVersion",
    "extensionPolicy",
    "sourceEpoch",
    "capturedAtTick120",
    "rawRunSeed",
    "contentIdentity",
    "sourceBoundary",
    "behaviorFacts",
    "roomComplete",
    "distinctVisitedDelta",
    "continuationPolicyAvailable",
    "metricProjection",
    "selectionAllowed",
    "transitionAllowed",
    "targetRoom",
    "selectionRngDraws",
    "canonicalEventWrites",
  ], "firstOccurrenceObservationCapture");
  assertExactKeys(
    capture.rawRunSeed,
    ["domain", "value"],
    "firstOccurrenceObservationCapture.rawRunSeed",
  );
  assertExactKeys(capture.sourceBoundary, [
    "preRoomTick120",
    "roomId",
    "roomOrdinal",
    "patternId",
    "occurrenceId",
    "encounterOrdinal",
    "readStartTick120",
    "occurrenceDrainedAtTick120",
    "fixedSliceCompleteTick120",
    "resolvedSeed",
  ], "firstOccurrenceObservationCapture.sourceBoundary");
  assertExactKeys(
    capture.sourceBoundary.resolvedSeed,
    ["domain", "value"],
    "firstOccurrenceObservationCapture.sourceBoundary.resolvedSeed",
  );
  invariant(
    capture.availability === "available"
      && capture.authority === FIRST_OCCURRENCE_AUTHORITY
      && capture.schemaVersion === FIRST_OCCURRENCE_SCHEMA_VERSION
      && capture.producerId === FIRST_OCCURRENCE_PRODUCER_ID
      && capture.producerVersion === FIRST_OCCURRENCE_PRODUCER_VERSION
      && capture.extensionPolicy === "EXT-2026-008"
      && capture.sourceEpoch === "current-run-through-first-occurrence-slice"
      && capture.roomComplete === false
      && capture.distinctVisitedDelta === 0
      && capture.continuationPolicyAvailable === false
      && capture.metricProjection === false
      && capture.selectionAllowed === false
      && capture.transitionAllowed === false
      && capture.targetRoom === null
      && capture.selectionRngDraws === 0
      && capture.canonicalEventWrites === 0,
    "firstOccurrenceObservationCapture identity or firewall is incompatible",
  );
  const preRoomTick120 = preRoomCapture.capturedAtTick120;
  const observationTick120 = safeAdd(
    preRoomTick120,
    FIRST_OCCURRENCE_SLICE_TICKS120,
    "first occurrence observation boundary",
  );
  const boundary = capture.sourceBoundary;
  invariant(
    capture.capturedAtTick120 === observationTick120
      && boundary.preRoomTick120 === preRoomTick120
      && boundary.roomId === RUN_ROOM_SESSION_CONTRACT.roomId
      && boundary.roomOrdinal === RUN_ROOM_SESSION_CONTRACT.roomOrdinal
      && boundary.patternId === RUN_ROOM_SESSION_CONTRACT.patternId
      && boundary.occurrenceId === RUN_ROOM_SESSION_CONTRACT.occurrenceId
      && boundary.encounterOrdinal === RUN_ROOM_SESSION_CONTRACT.encounterOrdinal
      && boundary.readStartTick120
        === safeAdd(preRoomTick120, FIRST_OCCURRENCE_READ_START_OFFSET_TICKS120, "READ boundary")
      && boundary.occurrenceDrainedAtTick120
        === safeAdd(preRoomTick120, FIRST_OCCURRENCE_DRAIN_OFFSET_TICKS120, "drain boundary")
      && boundary.fixedSliceCompleteTick120 === observationTick120,
    "firstOccurrenceObservationCapture source boundary is incompatible",
  );
  const expectedResolvedSeed = (
    capture.rawRunSeed.value
    ^ executablePattern(RUN_ROOM_SESSION_CONTRACT.patternId).seed.base
    ^ RUN_ROOM_SESSION_CONTRACT.encounterOrdinal
    ^ RUN_ROOM_SESSION_CONTRACT.difficultySalt
  ) >>> 0;
  invariant(
    capture.rawRunSeed.domain === "raw-run-seed"
      && capture.rawRunSeed.value === preRoomCapture.rawRunSeed.value
      && boundary.resolvedSeed.domain === "resolved-occurrence-seed"
      && boundary.resolvedSeed.value === expectedResolvedSeed,
    "firstOccurrenceObservationCapture seed provenance is incompatible",
  );
  assertContentIdentity(
    capture.contentIdentity,
    "firstOccurrenceObservationCapture.contentIdentity",
  );
  const observationEventCount = sourceEventCountForFacts(
    capture.behaviorFacts,
    "firstOccurrenceObservationCapture.behaviorFacts",
  );
  validateCommonSourceFacts(
    capture.behaviorFacts,
    observationTick120,
    observationEventCount,
  );
  validateFirstOccurrenceOwnerPhaseCounts(
    capture.behaviorFacts.sampling.ownerPhaseTickCounts,
    observationTick120,
  );
  validateFirstOccurrenceRoomContext(
    capture.behaviorFacts,
    preRoomTick120,
    observationTick120,
  );
  invariant(
    capture.behaviorFacts.rawRunSeed.value === capture.rawRunSeed.value,
    "firstOccurrenceObservationCapture behavior facts raw Run seed diverged",
  );
  validateAvailablePreRoomCapture(
    preRoomCapture,
    preRoomTick120,
    sourceEventCountForFacts(preRoomCapture.behaviorFacts, "preRoomCapture.behaviorFacts"),
    capture.rawRunSeed,
  );
  validateFirstOccurrenceBehaviorPrefix(
    preRoomCapture.behaviorFacts,
    capture.behaviorFacts,
    preRoomTick120,
    observationTick120,
  );
  validateEventPrefixExtension(preRoomCapture.behaviorFacts, capture.behaviorFacts);
}

export function assertCanonicalRunFirstOccurrenceObservationReadyForClosure(
  capture: CanonicalRunFirstOccurrenceObservationCaptureAvailable,
  preRoomCapture: CanonicalRunPreRoomBehaviorCaptureAvailable,
): void {
  validateAvailableFirstOccurrenceObservationCapture(capture, preRoomCapture);
}

function validateFirstRoomClosureOwnerPhaseCounts(
  entries: readonly CanonicalRunBehaviorCountEntry[],
  capturedAtTick120: number,
): void {
  const allowed = new Set([
    "quiet_awakening",
    "first_eye",
    "first_clamp_recovery",
    "room_sampling",
  ]);
  let previousId: string | null = null;
  let total = 0;
  let recoveryTicks = 0;
  let roomSamplingTicks = 0;
  for (const [index, entry] of entries.entries()) {
    invariant(typeof entry.id === "string" && entry.id.length > 0, `closure owner entry ${index} has no ID`);
    invariant(allowed.has(entry.id), `closure owner phase ${entry.id} is outside the first-room prefix`);
    if (previousId !== null) {
      invariant(compareCodePoints(previousId, entry.id) < 0, "closure owner counts must be unique and sorted");
    }
    const count = safePositiveInteger(entry.ticks120, `closure owner phase ${entry.id} ticks120`);
    total = safeAdd(total, count, "closure owner phase total");
    if (entry.id === "first_clamp_recovery") recoveryTicks = count;
    if (entry.id === "room_sampling") roomSamplingTicks = count;
    previousId = entry.id;
  }
  invariant(total === capturedAtTick120, "closure owner counts must cover every accepted source tick");
  invariant(recoveryTicks > 0, "closure source must retain the completed recovery prefix");
  invariant(
    roomSamplingTicks === FIRST_ROOM_CLOSURE_TICKS120,
    "room_sampling owner must consume exactly H+1 through H+1702",
  );
}

function availableWindow(
  value: unknown,
  path: string,
): Readonly<{
  firstAvailableTick120: number;
  lastAvailableTick120: number;
  sampleCount: number;
}> {
  invariant(typeof value === "object" && value !== null, `${path} must be available`);
  const record = value as Record<string, unknown>;
  invariant(record.availability === "available", `${path} must be available`);
  return Object.freeze({
    firstAvailableTick120: safePositiveInteger(
      record.firstAvailableTick120,
      `${path}.firstAvailableTick120`,
    ),
    lastAvailableTick120: safePositiveInteger(
      record.lastAvailableTick120,
      `${path}.lastAvailableTick120`,
    ),
    sampleCount: safePositiveInteger(record.sampleCount, `${path}.sampleCount`),
  });
}

function validateOneTickAvailabilityExtension(
  previous: unknown,
  current: unknown,
  capturedAtTick120: number,
  path: string,
): void {
  const before = availableWindow(previous, `${path}.observation`);
  const after = availableWindow(current, `${path}.closure`);
  invariant(
    after.firstAvailableTick120 === before.firstAvailableTick120
      && before.lastAvailableTick120 + 1 === capturedAtTick120
      && after.lastAvailableTick120 === capturedAtTick120
      && after.sampleCount === safeAdd(before.sampleCount, 1, `${path} sample count`),
    `${path} must extend the H+1701 prefix by exactly one accepted tick`,
  );
}

function validateFirstRoomClosureBehaviorPrefix(
  observationFacts: CanonicalRunBehaviorFactsSnapshot,
  closureFacts: CanonicalRunBehaviorFactsSnapshot,
  preRoomTick120: number,
  capturedAtTick120: number,
): void {
  const observationOwners = behaviorCountMap(
    observationFacts.sampling.ownerPhaseTickCounts,
    "firstOccurrenceObservationCapture owner phase counts",
  );
  const closureOwners = behaviorCountMap(
    closureFacts.sampling.ownerPhaseTickCounts,
    "first-room closure owner phase counts",
  );
  invariant(
    closureOwners.counts.size === observationOwners.counts.size,
    "closure must not add a new owner phase",
  );
  for (const [id, count] of observationOwners.counts) {
    invariant(
      closureOwners.counts.get(id) === count + (id === "room_sampling" ? 1 : 0),
      `closure owner phase ${id} changed outside the exact H+1702 tick`,
    );
  }

  validateOneTickAvailabilityExtension(
    observationFacts.requested,
    closureFacts.requested,
    capturedAtTick120,
    "requested facts",
  );
  validateOneTickAvailabilityExtension(
    observationFacts.committed.player,
    closureFacts.committed.player,
    capturedAtTick120,
    "committed player facts",
  );
  validateOneTickAvailabilityExtension(
    observationFacts.committed.flower,
    closureFacts.committed.flower,
    capturedAtTick120,
    "committed flower facts",
  );
  validateOneTickAvailabilityExtension(
    observationFacts.committed.gaze,
    closureFacts.committed.gaze,
    capturedAtTick120,
    "committed gaze facts",
  );
  validateOneTickAvailabilityExtension(
    observationFacts.committed.override,
    closureFacts.committed.override,
    capturedAtTick120,
    "committed override facts",
  );
  validateOneTickAvailabilityExtension(
    observationFacts.context.room,
    closureFacts.context.room,
    capturedAtTick120,
    "room context",
  );
  validateOneTickAvailabilityExtension(
    observationFacts.context.runCombat,
    closureFacts.context.runCombat,
    capturedAtTick120,
    "run-combat context",
  );

  const room = closureFacts.context.room;
  invariant(room.availability === "available", "closure room context must be available");
  invariant(
    room.firstAvailableTick120 === preRoomTick120 + 1
      && room.lastAvailableTick120 === capturedAtTick120
      && room.sampleCount === FIRST_ROOM_CLOSURE_TICKS120
      && room.aggregate.roomTickCounts.length === 1
      && room.aggregate.roomTickCounts[0]?.id === RUN_ROOM_SESSION_CONTRACT.roomId
      && room.aggregate.roomTickCounts[0]?.ticks120 === FIRST_ROOM_CLOSURE_TICKS120,
    "closure room context must contain exactly H+1 through H+1702",
  );

  const observationRunCombat = observationFacts.context.runCombat;
  const closureRunCombat = closureFacts.context.runCombat;
  invariant(
    observationRunCombat.availability === "available"
      && closureRunCombat.availability === "available",
    "closure run-combat context must remain available",
  );
  const observationActive = behaviorCountMap(
    observationRunCombat.aggregate.activeOccurrenceTickCounts,
    "observation active occurrence counts",
  );
  const closureActive = behaviorCountMap(
    closureRunCombat.aggregate.activeOccurrenceTickCounts,
    "closure active occurrence counts",
  );
  invariant(
    closureActive.counts.size === observationActive.counts.size,
    "closure must not add an active occurrence identity",
  );
  for (const [id, count] of observationActive.counts) {
    invariant(
      closureActive.counts.get(id) === count,
      `closure active occurrence ${id} changed during the idle close`,
    );
  }
  invariant(
    closureRunCombat.aggregate.noActiveOccurrenceTickCount
      === safeAdd(
        observationRunCombat.aggregate.noActiveOccurrenceTickCount,
        1,
        "closure no-active occurrence count",
      ),
    "closure must add exactly one no-active run-combat tick",
  );
  validateEventPrefixExtension(observationFacts, closureFacts);
  validateFirstRoomClosureEventDelta(observationFacts, closureFacts);
}

function assertFirstOccurrenceRoomSnapshotShape(room: CanonicalRunRoomSessionSnapshot): void {
  assertExactKeys(room, [
    "authority",
    "extensionPolicy",
    "phase",
    "tick120",
    "relativeTick120",
    "roomId",
    "roomOrdinal",
    "composerId",
    "patternId",
    "occurrenceId",
    "encounterOrdinal",
    "tierId",
    "difficulty",
    "composer",
    "weightedSelection",
    "selectionAuthority",
    "selectionRngDraws",
    "parallel",
    "rawRunSeed",
    "resolvedSeed",
    "difficultySalt",
    "boundaryTicks120",
    "sourceTraceEventCount",
    "combat",
    "runCombat",
    "entities",
    "fixedSliceComplete",
    "roomComplete",
    "handoffReady",
    "faulted",
    "adapterPolicy",
  ], "roomSnapshot");
  assertExactKeys(room.rawRunSeed, ["domain", "value"], "roomSnapshot.rawRunSeed");
  assertExactKeys(room.resolvedSeed, ["domain", "value"], "roomSnapshot.resolvedSeed");
  assertExactKeys(room.boundaryTicks120, [
    "start",
    "telegraphEnd",
    "read",
    "materialSettle",
    "rest",
    "fixedSliceComplete",
    "residueDeadline",
  ], "roomSnapshot.boundaryTicks120");
  assertExactKeys(
    room.entities,
    ["digitalBodies", "liveColliders", "residueVisuals"],
    "roomSnapshot.entities",
  );
  assertExactKeys(room.adapterPolicy, [
    "sourceHandoff",
    "directRoomInstall",
    "preRead",
    "readStart",
    "overrideEdges",
    "tickClosure",
    "terminalTail",
    "completion",
    "provenance",
  ], "roomSnapshot.adapterPolicy");

  const combat = room.combat;
  invariant(combat !== null, "room snapshot must retain the drained first occurrence");
  assertExactKeys(combat, [
    "authority",
    "patternId",
    "occurrenceId",
    "seed",
    "difficulty",
    "startTick120",
    "tick120",
    "relativeTick120",
    "patternComplete",
    "digitalBodiesDrained",
    "materialResidueDraining",
    "projectileLifecycleDrained",
    "runTimedStateQuiescent",
    "handoffReady",
    "rngCallsConsumed",
    "playerPosition",
    "player",
    "evidence",
    "override",
    "projectiles",
    "poolUsage",
    "lastDamageBatch",
    "adapterGaps",
  ], "roomSnapshot.combat");
  assertExactKeys(
    combat.poolUsage,
    ["active", "allocatedSlots", "liveColliders", "residueVisuals"],
    "roomSnapshot.combat.poolUsage",
  );
  assertExactKeys(combat.adapterGaps, [
    "grazeRadiusPx",
    "projectileDamage",
    "projectilePoolClasses",
    "targetHistorySampling",
    "positiveAimLeadPolicy",
    "lateralWallLaneProjection",
    "provenance",
  ], "roomSnapshot.combat.adapterGaps");

  assertExactKeys(room.runCombat, [
    "authority",
    "tick120",
    "playerPosition",
    "focused",
    "player",
    "evidence",
    "override",
    "activeOccurrenceId",
    "pendingFlushTick120",
    "claimedOccurrenceIds",
    "faulted",
    "adapterPolicy",
  ], "roomSnapshot.runCombat");
  assertExactKeys(room.runCombat.adapterPolicy, [
    "grazeRadiusPx",
    "projectileDamage",
    "projectilePoolClasses",
    "occurrenceIdentity",
    "concurrency",
    "flushOwner",
    "provenance",
  ], "roomSnapshot.runCombat.adapterPolicy");
}

function validateFirstOccurrenceRoomSnapshot(
  room: CanonicalRunRoomSessionSnapshot,
  sourceEventCount: number,
): Readonly<{
  preRoomTick120: number;
  capturedAtTick120: number;
  preRoomSourceEventCount: number;
}> {
  assertFrozenJsonData(room, "roomSnapshot");
  assertFirstOccurrenceRoomSnapshotShape(room);
  const capturedAtTick120 = safePositiveInteger(room.tick120, "roomSnapshot.tick120");
  invariant(
    room.authority === "canonical-run-room-session-v4"
      && room.extensionPolicy === RUN_ROOM_SESSION_CONTRACT.extensionPolicy
      && room.phase === "first_room_slice_complete"
      && room.fixedSliceComplete === true
      && room.roomComplete === RUN_ROOM_SESSION_CONTRACT.roomComplete
      && room.handoffReady === RUN_ROOM_SESSION_CONTRACT.handoffReady
      && room.faulted === false,
    "room snapshot is not the closed, non-complete first-occurrence slice",
  );
  invariant(
    room.roomId === RUN_ROOM_SESSION_CONTRACT.roomId
      && room.roomOrdinal === RUN_ROOM_SESSION_CONTRACT.roomOrdinal
      && room.composerId === RUN_ROOM_SESSION_CONTRACT.composerId
      && room.patternId === RUN_ROOM_SESSION_CONTRACT.patternId
      && room.occurrenceId === RUN_ROOM_SESSION_CONTRACT.occurrenceId
      && room.encounterOrdinal === RUN_ROOM_SESSION_CONTRACT.encounterOrdinal
      && room.tierId === RUN_ROOM_SESSION_CONTRACT.tierId
      && room.difficulty === RUN_ROOM_SESSION_CONTRACT.difficulty
      && room.composer === RUN_ROOM_SESSION_CONTRACT.composer
      && room.weightedSelection === RUN_ROOM_SESSION_CONTRACT.weightedSelection
      && room.selectionAuthority === RUN_ROOM_SESSION_CONTRACT.selectionAuthority
      && room.selectionRngDraws === RUN_ROOM_SESSION_CONTRACT.selectionRngDraws
      && room.parallel === RUN_ROOM_SESSION_CONTRACT.parallel
      && room.difficultySalt === RUN_ROOM_SESSION_CONTRACT.difficultySalt,
    "room snapshot source identity is incompatible",
  );
  invariant(
    room.rawRunSeed.domain === "raw-run-seed"
      && Number.isSafeInteger(room.rawRunSeed.value)
      && room.rawRunSeed.value >= 0
      && room.rawRunSeed.value <= UINT32_MAX
      && !Object.is(room.rawRunSeed.value, -0),
    "room snapshot raw Run seed must be a tagged uint32",
  );
  invariant(
    room.resolvedSeed.domain === "resolved-occurrence-seed"
      && Number.isSafeInteger(room.resolvedSeed.value)
      && room.resolvedSeed.value >= 0
      && room.resolvedSeed.value <= UINT32_MAX
      && !Object.is(room.resolvedSeed.value, -0),
    "room snapshot resolved occurrence seed must be a tagged uint32",
  );
  const pattern = executablePattern(RUN_ROOM_SESSION_CONTRACT.patternId);
  const expectedResolvedSeed = (
    room.rawRunSeed.value
    ^ pattern.seed.base
    ^ RUN_ROOM_SESSION_CONTRACT.encounterOrdinal
    ^ RUN_ROOM_SESSION_CONTRACT.difficultySalt
  ) >>> 0;
  invariant(
    room.resolvedSeed.value === expectedResolvedSeed,
    "room snapshot resolved occurrence seed diverged from the fixed bootstrap composition",
  );
  invariant(
    room.adapterPolicy.sourceHandoff === "typed-ready-for-room-sampling"
      && room.adapterPolicy.directRoomInstall === "no-transition-or-room-enter-event"
      && room.adapterPolicy.preRead === "shared-run-idle-zero-room-entities"
      && room.adapterPolicy.readStart === "close-H+159-on-shared-state-then-claim-local0"
      && room.adapterPolicy.overrideEdges === "screened-without-reading"
      && room.adapterPolicy.tickClosure === "shared-run-combat-state-sole-flush-owner"
      && room.adapterPolicy.terminalTail === "residue-drained-at-H+1699-plus-two-neutral-ticks"
      && room.adapterPolicy.completion === "slice-only-no-room-completion-or-handoff"
      && room.adapterPolicy.provenance === "application-policy-EXT-2026-005",
    "room snapshot adapter policy drifted",
  );

  const preRoomTick120 = safeNonNegativeInteger(
    room.boundaryTicks120.start,
    "roomSnapshot.boundaryTicks120.start",
  );
  invariant(
    room.relativeTick120 === FIRST_OCCURRENCE_SLICE_TICKS120
      && room.boundaryTicks120.telegraphEnd === safeAdd(
        preRoomTick120,
        RUN_ROOM_SESSION_CONTRACT.relativeBoundaryTicks120.telegraph,
        "telegraph boundary",
      )
      && room.boundaryTicks120.read
        === safeAdd(preRoomTick120, FIRST_OCCURRENCE_READ_START_OFFSET_TICKS120, "READ boundary")
      && room.boundaryTicks120.materialSettle === safeAdd(
        preRoomTick120,
        RUN_ROOM_SESSION_CONTRACT.relativeBoundaryTicks120.materialSettle,
        "settle boundary",
      )
      && room.boundaryTicks120.rest === safeAdd(
        preRoomTick120,
        RUN_ROOM_SESSION_CONTRACT.relativeBoundaryTicks120.rest,
        "rest boundary",
      )
      && room.boundaryTicks120.residueDeadline
        === safeAdd(preRoomTick120, FIRST_OCCURRENCE_DRAIN_OFFSET_TICKS120, "drain boundary")
      && room.boundaryTicks120.fixedSliceComplete
        === safeAdd(preRoomTick120, FIRST_OCCURRENCE_SLICE_TICKS120, "slice-close boundary")
      && capturedAtTick120 === room.boundaryTicks120.fixedSliceComplete,
    "room snapshot boundaries must close exactly at H+1701",
  );
  invariant(
    room.entities.digitalBodies === 0
      && room.entities.liveColliders === 0
      && room.entities.residueVisuals === 0,
    "room snapshot must have zero authority entities at slice close",
  );
  const combat = room.combat;
  invariant(combat !== null, "room snapshot must retain the drained first occurrence");
  invariant(
    combat.authority === "canonical-combat-v4"
      && combat.patternId === room.patternId
      && combat.occurrenceId === room.occurrenceId
      && combat.seed === room.resolvedSeed.value
      && combat.difficulty === room.difficulty
      && combat.startTick120 === room.boundaryTicks120.read
      && combat.tick120 === room.boundaryTicks120.residueDeadline
      && combat.relativeTick120
        === FIRST_OCCURRENCE_DRAIN_OFFSET_TICKS120 - FIRST_OCCURRENCE_READ_START_OFFSET_TICKS120
      && combat.patternComplete === true
      && combat.digitalBodiesDrained === true
      && combat.materialResidueDraining === false
      && combat.projectileLifecycleDrained === true
      && combat.runTimedStateQuiescent === true
      && combat.handoffReady === true
      && combat.projectiles.length === 0
      && combat.poolUsage.liveColliders === 0
      && combat.poolUsage.residueVisuals === 0,
    "retained occurrence must be drained, quiescent, and occurrence-handoff-ready",
  );
  invariant(
    combat.adapterGaps.targetHistorySampling === "exact-crossed-tick120"
      && combat.adapterGaps.positiveAimLeadPolicy
        === "last-authoritative-segment-linear-extrapolation"
      && combat.adapterGaps.lateralWallLaneProjection
        === "candidate-center-into-left-to-right-lane-bins"
      && combat.adapterGaps.provenance === "application-required-v4-omission",
    "retained occurrence adapter policy drifted",
  );
  invariant(
    room.runCombat.authority === "canonical-run-combat-v4"
      && room.runCombat.tick120 === capturedAtTick120
      && room.runCombat.activeOccurrenceId === null
      && room.runCombat.pendingFlushTick120 === null
      && room.runCombat.claimedOccurrenceIds.length === 2
      && room.runCombat.claimedOccurrenceIds[0] === RUN_ROOM_SESSION_CONTRACT.occurrenceId
      && typeof room.runCombat.claimedOccurrenceIds[1] === "string"
      && room.runCombat.claimedOccurrenceIds[1]!.length > 0
      && room.runCombat.faulted === false,
    "shared run combat state must be closed and occurrence-free at H+1701",
  );
  invariant(
    room.runCombat.adapterPolicy.occurrenceIdentity === "utf8-length-prefixed"
      && room.runCombat.adapterPolicy.concurrency === "single-spawning-occurrence"
      && room.runCombat.adapterPolicy.flushOwner === "run-combat-state"
      && room.runCombat.adapterPolicy.provenance === "application-required-v4-omission",
    "shared run combat adapter policy drifted",
  );
  invariant(
    room.sourceTraceEventCount <= sourceEventCount,
    "room source trace cannot exceed the H+1701 event prefix",
  );
  return Object.freeze({
    preRoomTick120,
    capturedAtTick120,
    preRoomSourceEventCount: safeNonNegativeInteger(
      room.sourceTraceEventCount,
      "roomSnapshot.sourceTraceEventCount",
    ),
  });
}

function validateFirstRoomClosureSnapshot(
  room: CanonicalRunRoomSessionSnapshot,
  sourceEventCount: number,
  preRoomCapture: CanonicalRunPreRoomBehaviorCaptureAvailable,
  observationCapture: CanonicalRunFirstOccurrenceObservationCaptureAvailable,
): Readonly<{
  preRoomTick120: number;
  observationTick120: number;
  capturedAtTick120: number;
}> {
  assertFrozenJsonData(room, "roomSnapshot");
  assertFirstOccurrenceRoomSnapshotShape(room);
  const capturedAtTick120 = safePositiveInteger(room.tick120, "roomSnapshot.tick120");
  const preRoomTick120 = observationCapture.sourceBoundary.preRoomTick120;
  const observationTick120 = observationCapture.capturedAtTick120;
  invariant(
    room.authority === "canonical-run-room-session-v4"
      && room.extensionPolicy === FIRST_FIXED_ROOM_CLOSURE_CONTRACT.extensionPolicy
      && room.phase === "first_room_complete"
      && room.fixedSliceComplete === true
      && room.roomComplete === FIRST_FIXED_ROOM_CLOSURE_CONTRACT.roomComplete
      && room.handoffReady === FIRST_FIXED_ROOM_CLOSURE_CONTRACT.handoffReady
      && room.faulted === false,
    "room snapshot is not the closed first fixed room",
  );
  invariant(
    room.roomId === RUN_ROOM_SESSION_CONTRACT.roomId
      && room.roomOrdinal === RUN_ROOM_SESSION_CONTRACT.roomOrdinal
      && room.composerId === RUN_ROOM_SESSION_CONTRACT.composerId
      && room.patternId === RUN_ROOM_SESSION_CONTRACT.patternId
      && room.occurrenceId === RUN_ROOM_SESSION_CONTRACT.occurrenceId
      && room.encounterOrdinal === RUN_ROOM_SESSION_CONTRACT.encounterOrdinal
      && room.tierId === RUN_ROOM_SESSION_CONTRACT.tierId
      && room.difficulty === RUN_ROOM_SESSION_CONTRACT.difficulty
      && room.composer === RUN_ROOM_SESSION_CONTRACT.composer
      && room.weightedSelection === RUN_ROOM_SESSION_CONTRACT.weightedSelection
      && room.selectionAuthority === RUN_ROOM_SESSION_CONTRACT.selectionAuthority
      && room.selectionRngDraws === RUN_ROOM_SESSION_CONTRACT.selectionRngDraws
      && room.parallel === RUN_ROOM_SESSION_CONTRACT.parallel
      && room.difficultySalt === RUN_ROOM_SESSION_CONTRACT.difficultySalt,
    "first-room closure source identity is incompatible",
  );
  invariant(
    room.rawRunSeed.domain === "raw-run-seed"
      && Number.isSafeInteger(room.rawRunSeed.value)
      && room.rawRunSeed.value >= 0
      && room.rawRunSeed.value <= UINT32_MAX
      && !Object.is(room.rawRunSeed.value, -0)
      && room.rawRunSeed.value === observationCapture.rawRunSeed.value
      && room.resolvedSeed.domain === "resolved-occurrence-seed"
      && Number.isSafeInteger(room.resolvedSeed.value)
      && room.resolvedSeed.value >= 0
      && room.resolvedSeed.value <= UINT32_MAX
      && !Object.is(room.resolvedSeed.value, -0)
      && room.resolvedSeed.value === observationCapture.sourceBoundary.resolvedSeed.value
      && room.resolvedSeed.value === (
        room.rawRunSeed.value
        ^ executablePattern(RUN_ROOM_SESSION_CONTRACT.patternId).seed.base
        ^ RUN_ROOM_SESSION_CONTRACT.encounterOrdinal
        ^ RUN_ROOM_SESSION_CONTRACT.difficultySalt
      ) >>> 0,
    "first-room closure seed provenance diverged from H+1701",
  );
  invariant(
    room.adapterPolicy.sourceHandoff === "typed-ready-for-room-sampling"
      && room.adapterPolicy.directRoomInstall === "no-transition-or-room-enter-event"
      && room.adapterPolicy.preRead === "shared-run-idle-zero-room-entities"
      && room.adapterPolicy.readStart === "close-H+159-on-shared-state-then-claim-local0"
      && room.adapterPolicy.overrideEdges === "screened-without-reading"
      && room.adapterPolicy.tickClosure === "shared-run-combat-state-sole-flush-owner"
      && room.adapterPolicy.terminalTail === "residue-drained-at-H+1699-plus-two-neutral-ticks"
      && room.adapterPolicy.completion === "single-occurrence-room-close-no-handoff"
      && room.adapterPolicy.provenance === "application-policy-EXT-2026-009",
    "first-room closure adapter policy drifted",
  );
  invariant(
    room.boundaryTicks120.start === preRoomTick120
      && room.boundaryTicks120.telegraphEnd === safeAdd(
        preRoomTick120,
        RUN_ROOM_SESSION_CONTRACT.relativeBoundaryTicks120.telegraph,
        "closure telegraph boundary",
      )
      && room.boundaryTicks120.read === observationCapture.sourceBoundary.readStartTick120
      && room.boundaryTicks120.materialSettle === safeAdd(
        preRoomTick120,
        RUN_ROOM_SESSION_CONTRACT.relativeBoundaryTicks120.materialSettle,
        "closure material-settle boundary",
      )
      && room.boundaryTicks120.rest === safeAdd(
        preRoomTick120,
        RUN_ROOM_SESSION_CONTRACT.relativeBoundaryTicks120.rest,
        "closure rest boundary",
      )
      && room.boundaryTicks120.residueDeadline
        === observationCapture.sourceBoundary.occurrenceDrainedAtTick120
      && room.boundaryTicks120.fixedSliceComplete === observationTick120
      && room.relativeTick120 === FIRST_ROOM_CLOSURE_TICKS120
      && observationTick120 + 1 === capturedAtTick120
      && capturedAtTick120
        === safeAdd(preRoomTick120, FIRST_ROOM_CLOSURE_TICKS120, "room closure boundary"),
    "room snapshot must close exactly at H+1702 without rewriting H+1701",
  );
  invariant(
    room.entities.digitalBodies === 0
      && room.entities.liveColliders === 0
      && room.entities.residueVisuals === 0,
    "first-room closure must retain zero authority entities",
  );
  const combat = room.combat;
  invariant(combat !== null, "first-room closure must retain the drained occurrence");
  invariant(
    combat.authority === "canonical-combat-v4"
      && combat.patternId === room.patternId
      && combat.occurrenceId === room.occurrenceId
      && combat.seed === room.resolvedSeed.value
      && combat.difficulty === room.difficulty
      && combat.startTick120 === room.boundaryTicks120.read
      && combat.tick120 === room.boundaryTicks120.residueDeadline
      && combat.relativeTick120
        === FIRST_OCCURRENCE_DRAIN_OFFSET_TICKS120 - FIRST_OCCURRENCE_READ_START_OFFSET_TICKS120
      && combat.patternComplete === true
      && combat.digitalBodiesDrained === true
      && combat.materialResidueDraining === false
      && combat.projectileLifecycleDrained === true
      && combat.runTimedStateQuiescent === true
      && combat.handoffReady === true
      && combat.projectiles.length === 0
      && combat.poolUsage.liveColliders === 0
      && combat.poolUsage.residueVisuals === 0,
    "first-room closure retained occurrence is not fully drained",
  );
  invariant(
    combat.adapterGaps.targetHistorySampling === "exact-crossed-tick120"
      && combat.adapterGaps.positiveAimLeadPolicy
        === "last-authoritative-segment-linear-extrapolation"
      && combat.adapterGaps.lateralWallLaneProjection
        === "candidate-center-into-left-to-right-lane-bins"
      && combat.adapterGaps.provenance === "application-required-v4-omission",
    "first-room closure retained occurrence adapter policy drifted",
  );
  invariant(
    room.runCombat.authority === "canonical-run-combat-v4"
      && room.runCombat.tick120 === capturedAtTick120
      && room.runCombat.activeOccurrenceId === null
      && room.runCombat.pendingFlushTick120 === null
      && room.runCombat.faulted === false
      && room.runCombat.player.state !== "run-ended"
      && room.runCombat.player.recoveryAtTick120 === null
      && room.runCombat.player.respawnPlaceAtTick120 === null
      && room.runCombat.player.respawnCompleteAtTick120 === null
      && room.runCombat.override.state === "idle"
      && room.runCombat.override.deadlineTick120 === null
      && room.runCombat.override.localVoid === null
      && room.runCombat.claimedOccurrenceIds.length === 2
      && room.runCombat.claimedOccurrenceIds[0] === RUN_ROOM_SESSION_CONTRACT.occurrenceId
      && typeof room.runCombat.claimedOccurrenceIds[1] === "string"
      && room.runCombat.claimedOccurrenceIds[1]!.length > 0,
    "first-room closure shared run state is not quiescent and non-terminal",
  );
  invariant(
    room.runCombat.adapterPolicy.occurrenceIdentity === "utf8-length-prefixed"
      && room.runCombat.adapterPolicy.concurrency === "single-spawning-occurrence"
      && room.runCombat.adapterPolicy.flushOwner === "run-combat-state"
      && room.runCombat.adapterPolicy.provenance === "application-required-v4-omission"
      && room.runCombat.adapterPolicy.grazeRadiusPx === combat.adapterGaps.grazeRadiusPx
      && room.runCombat.adapterPolicy.projectileDamage === combat.adapterGaps.projectileDamage
      && room.runCombat.adapterPolicy.projectilePoolClasses["bullet.micro.notch_e"] === "micro"
      && combat.adapterGaps.projectilePoolClasses["bullet.micro.notch_e"] === "micro",
    "first-room closure shared run-combat adapter policy drifted",
  );
  invariant(
    room.sourceTraceEventCount
      === sourceEventCountForFacts(preRoomCapture.behaviorFacts, "preRoomCapture.behaviorFacts")
      && room.sourceTraceEventCount <= sourceEventCount,
    "first-room closure source trace must retain the exact H event prefix",
  );
  return Object.freeze({preRoomTick120, observationTick120, capturedAtTick120});
}

export function createCanonicalRunPreRoomBehaviorCapture(
  options: CreateCanonicalRunPreRoomBehaviorCaptureOptions,
): CanonicalRunPreRoomBehaviorCaptureAvailable {
  const capturedAtTick120 = safePositiveInteger(options.capturedAtTick120, "capturedAtTick120");
  const sourceEventCount = safeNonNegativeInteger(options.sourceEventCount, "sourceEventCount");
  validatePreRoomSourceFacts(options.behaviorFacts, capturedAtTick120, sourceEventCount);

  const behaviorFacts = canonicalFrozenClone(options.behaviorFacts);
  return Object.freeze({
    availability: "available" as const,
    authority: AUTHORITY,
    schemaVersion: SCHEMA_VERSION,
    producerId: PRODUCER_ID,
    producerVersion: PRODUCER_VERSION,
    extensionPolicy: "EXT-2026-007" as const,
    sourceEpoch: "current-run-pre-room-prefix" as const,
    capturedAtTick120,
    rawRunSeed: behaviorFacts.rawRunSeed,
    contentIdentity: V4_CONTENT_IDENTITY,
    behaviorFacts,
    metricProjection: false as const,
    selectionAllowed: false as const,
  });
}

export function createCanonicalRunFirstOccurrenceObservationCapture(
  options: CreateCanonicalRunFirstOccurrenceObservationCaptureOptions,
): CanonicalRunFirstOccurrenceObservationCaptureAvailable {
  const sourceEventCount = safeNonNegativeInteger(options.sourceEventCount, "sourceEventCount");
  const boundary = validateFirstOccurrenceRoomSnapshot(options.roomSnapshot, sourceEventCount);
  validateCommonSourceFacts(
    options.behaviorFacts,
    boundary.capturedAtTick120,
    sourceEventCount,
  );
  validateFirstOccurrenceOwnerPhaseCounts(
    options.behaviorFacts.sampling.ownerPhaseTickCounts,
    boundary.capturedAtTick120,
  );
  validateFirstOccurrenceRoomContext(
    options.behaviorFacts,
    boundary.preRoomTick120,
    boundary.capturedAtTick120,
  );
  invariant(
    options.behaviorFacts.rawRunSeed.value === options.roomSnapshot.rawRunSeed.value,
    "behavior facts raw Run seed diverged from the room source",
  );
  validateAvailablePreRoomCapture(
    options.preRoomCapture,
    boundary.preRoomTick120,
    boundary.preRoomSourceEventCount,
    options.behaviorFacts.rawRunSeed,
  );
  validateFirstOccurrenceBehaviorPrefix(
    options.preRoomCapture.behaviorFacts,
    options.behaviorFacts,
    boundary.preRoomTick120,
    boundary.capturedAtTick120,
  );
  validateClaimedOccurrenceFacts(options.roomSnapshot, options.behaviorFacts);
  validateEventPrefixExtension(
    options.preRoomCapture.behaviorFacts,
    options.behaviorFacts,
  );

  const behaviorFacts = canonicalFrozenClone(options.behaviorFacts);
  const sourceBoundary = Object.freeze({
    preRoomTick120: boundary.preRoomTick120,
    roomId: options.roomSnapshot.roomId,
    roomOrdinal: options.roomSnapshot.roomOrdinal,
    patternId: options.roomSnapshot.patternId,
    occurrenceId: options.roomSnapshot.occurrenceId,
    encounterOrdinal: options.roomSnapshot.encounterOrdinal,
    readStartTick120: options.roomSnapshot.boundaryTicks120.read,
    occurrenceDrainedAtTick120: options.roomSnapshot.boundaryTicks120.residueDeadline,
    fixedSliceCompleteTick120: options.roomSnapshot.boundaryTicks120.fixedSliceComplete,
    resolvedSeed: Object.freeze({
      domain: options.roomSnapshot.resolvedSeed.domain,
      value: options.roomSnapshot.resolvedSeed.value,
    }),
  });
  return Object.freeze({
    availability: "available" as const,
    authority: FIRST_OCCURRENCE_AUTHORITY,
    schemaVersion: FIRST_OCCURRENCE_SCHEMA_VERSION,
    producerId: FIRST_OCCURRENCE_PRODUCER_ID,
    producerVersion: FIRST_OCCURRENCE_PRODUCER_VERSION,
    extensionPolicy: "EXT-2026-008" as const,
    sourceEpoch: "current-run-through-first-occurrence-slice" as const,
    capturedAtTick120: boundary.capturedAtTick120,
    rawRunSeed: behaviorFacts.rawRunSeed,
    contentIdentity: V4_CONTENT_IDENTITY,
    sourceBoundary,
    behaviorFacts,
    roomComplete: false as const,
    distinctVisitedDelta: 0 as const,
    continuationPolicyAvailable: false as const,
    metricProjection: false as const,
    selectionAllowed: false as const,
    transitionAllowed: false as const,
    targetRoom: null,
    selectionRngDraws: 0 as const,
    canonicalEventWrites: 0 as const,
  });
}

export function createCanonicalRunFirstRoomClosureCapture(
  options: CreateCanonicalRunFirstRoomClosureCaptureOptions,
): CanonicalRunFirstRoomClosureCaptureAvailable {
  const sourceEventCount = safeNonNegativeInteger(options.sourceEventCount, "sourceEventCount");
  const sourceBehaviorFacts = behaviorFactsFromCanonicalReceipt(options.behaviorFactsReceipt);
  validateAvailableFirstOccurrenceObservationCapture(
    options.firstOccurrenceObservationCapture,
    options.preRoomCapture,
  );
  const boundary = validateFirstRoomClosureSnapshot(
    options.roomSnapshot,
    sourceEventCount,
    options.preRoomCapture,
    options.firstOccurrenceObservationCapture,
  );
  validateCommonSourceFacts(
    sourceBehaviorFacts,
    boundary.capturedAtTick120,
    sourceEventCount,
  );
  validateFirstRoomClosureOwnerPhaseCounts(
    sourceBehaviorFacts.sampling.ownerPhaseTickCounts,
    boundary.capturedAtTick120,
  );
  invariant(
    sourceBehaviorFacts.rawRunSeed.value === options.roomSnapshot.rawRunSeed.value
      && sourceBehaviorFacts.rawRunSeed.value
        === options.firstOccurrenceObservationCapture.rawRunSeed.value,
    "first-room closure behavior facts raw Run seed diverged",
  );
  validateFirstRoomClosureBehaviorPrefix(
    options.firstOccurrenceObservationCapture.behaviorFacts,
    sourceBehaviorFacts,
    boundary.preRoomTick120,
    boundary.capturedAtTick120,
  );
  validateClaimedOccurrenceFacts(options.roomSnapshot, sourceBehaviorFacts);

  const behaviorFacts = canonicalFrozenClone(sourceBehaviorFacts);
  const sourceBoundary = Object.freeze({
    preRoomTick120: boundary.preRoomTick120,
    firstOccurrenceObservationTick120: boundary.observationTick120,
    roomClosureTick120: boundary.capturedAtTick120,
    roomId: options.roomSnapshot.roomId,
    roomOrdinal: options.roomSnapshot.roomOrdinal,
    patternId: options.roomSnapshot.patternId,
    occurrenceId: options.roomSnapshot.occurrenceId,
    encounterOrdinal: options.roomSnapshot.encounterOrdinal,
    resolvedSeed: Object.freeze({
      domain: options.roomSnapshot.resolvedSeed.domain,
      value: options.roomSnapshot.resolvedSeed.value,
    }),
  });
  const capture = Object.freeze({
    availability: "available" as const,
    authority: FIRST_ROOM_CLOSURE_AUTHORITY,
    schemaVersion: FIRST_ROOM_CLOSURE_SCHEMA_VERSION,
    producerId: FIRST_ROOM_CLOSURE_PRODUCER_ID,
    producerVersion: FIRST_ROOM_CLOSURE_PRODUCER_VERSION,
    extensionPolicy: "EXT-2026-009" as const,
    sourceEpoch: "current-run-through-first-room-closure" as const,
    capturedAtTick120: boundary.capturedAtTick120,
    rawRunSeed: behaviorFacts.rawRunSeed,
    contentIdentity: V4_CONTENT_IDENTITY,
    sourceBoundary,
    behaviorFacts,
    plannedOccurrenceCount: 1 as const,
    completedOccurrenceCount: 1 as const,
    remainingOccurrenceCount: 0 as const,
    roomComplete: true as const,
    completedRoomVisit: Object.freeze({
      roomId: options.roomSnapshot.roomId,
      roomOrdinal: options.roomSnapshot.roomOrdinal,
    }),
    distinctVisitedDelta: 1 as const,
    handoffReady: false as const,
    metricProjection: false as const,
    selectionAllowed: false as const,
    transitionAllowed: false as const,
    targetRoom: null,
    selectionRngDraws: 0 as const,
    canonicalEventWrites: 0 as const,
  });
  CANONICAL_RUN_FIRST_ROOM_CLOSURES.add(capture);
  return capture;
}
