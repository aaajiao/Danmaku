import roomComposersJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/room-composers-v4.json";

import {V4_CONTENT_IDENTITY, type V4ContentIdentity} from "../content/v4-content-identity";
import {
  firstRoomClosureFromCanonicalMetricSourceReceipt,
  firstRoomMetricSourceLineageFromCanonicalReceipt,
  type CanonicalRunFirstRoomClosureCaptureAvailable,
  type CanonicalRunFirstRoomMetricSourceReceipt,
} from "./run-behavior-capture";
import {
  firstRoomRecentInputLineageFromCanonicalReceipt,
  firstRoomRecentInputSupplementFromCanonicalReceipt,
  type CanonicalRunBehaviorAvailable,
  type CanonicalRunBehaviorCountEntry,
  type CanonicalRunBehaviorFactsSnapshot,
  type CanonicalRunFirstRoomRecentInputSupplementReceipt,
  type CanonicalRunFirstRoomRecentInputSupplementSource,
} from "./run-behavior-facts";
import {
  FIRST_FIXED_ROOM_CLOSURE_CONTRACT,
  RUN_ROOM_SESSION_CONTRACT,
} from "./run-room-contract";
import {executablePattern} from "./pattern-executor";

const UINT32_MAX = 0xffff_ffff;
const AUTHORITY = "canonical-run-first-room-metric-projection-v1" as const;
const SCHEMA_VERSION = "1.1.0-ext-2026-011" as const;
const PRODUCER_ID = "canonical-run-session.first-room-metric-projector" as const;
const PRODUCER_VERSION = "1.1.0" as const;

const EXPECTED_METRIC_IDS = Object.freeze([
  "avgFlower",
  "binarySwitches",
  "contextSwitches",
  "correctionLatency",
  "crackRatio",
  "gazeRatio",
  "highLightRatio",
  "intersectionHold",
  "noDuskTicks",
  "overrideRatio",
  "recentInputDensity",
  "sideCommitment",
  "sideSwitches",
  "unansweredActions",
] as const);

export type CanonicalRunFirstRoomMetricId = typeof EXPECTED_METRIC_IDS[number];
export type CanonicalRunFirstRoomAvailableMetricId =
  | "avgFlower"
  | "gazeRatio"
  | "recentInputDensity";
export type CanonicalRunFirstRoomMissingMetricId = Exclude<
  CanonicalRunFirstRoomMetricId,
  CanonicalRunFirstRoomAvailableMetricId
>;

export type CanonicalRunFirstRoomMetricMissingReason =
  | "action-response-contract-not-authored"
  | "binary-authority-not-observed"
  | "context-transition-sequence-not-recorded"
  | "correction-pairs-not-recorded"
  | "crack-band-samples-not-recorded"
  | "high-light-threshold-samples-not-recorded"
  | "intersection-authority-not-observed"
  | "no-dusk-authority-not-observed"
  | "override-not-eligible-in-source-window"
  | "side-band-samples-not-recorded"
  | "side-transition-sequence-not-recorded";

export interface CanonicalRunFirstRoomMetricValueSource {
  readonly sourcePath: string;
  readonly value: number;
}

export interface CanonicalRunFirstRoomMetricSampleWindow {
  readonly firstTick120: number;
  readonly lastTick120: number;
}

export interface CanonicalRunFirstRoomMetricAvailableEntry {
  readonly id: CanonicalRunFirstRoomAvailableMetricId;
  readonly availability: "available";
  readonly value: number;
  readonly unit: "ratio-0-1";
  readonly formulaId:
    | "committed-flower-target-mean-v1"
    | "committed-gaze-clamped-state-ratio-v1"
    | "first-room-active-input-union-ratio-v1";
  readonly numerator: CanonicalRunFirstRoomMetricValueSource;
  readonly denominator: CanonicalRunFirstRoomMetricValueSource;
  readonly sampleWindow: CanonicalRunFirstRoomMetricSampleWindow;
}

export interface CanonicalRunFirstRoomMetricMissingEntry {
  readonly id: CanonicalRunFirstRoomMissingMetricId;
  readonly availability: "missing";
  readonly reason: CanonicalRunFirstRoomMetricMissingReason;
}

export type CanonicalRunFirstRoomMetricEntry =
  | CanonicalRunFirstRoomMetricAvailableEntry
  | CanonicalRunFirstRoomMetricMissingEntry;

export interface CanonicalRunFirstRoomMetricProjectionMissing {
  readonly availability: "missing";
  readonly reason: "first-room-metric-source-not-closed";
  readonly ready: false;
  readonly selectionAllowed: false;
}

export interface CanonicalRunFirstRoomMetricProjectionPayload {
  readonly availability: "available";
  readonly authority: typeof AUTHORITY;
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly producerId: typeof PRODUCER_ID;
  readonly producerVersion: typeof PRODUCER_VERSION;
  readonly extensionPolicy: "EXT-2026-011";
  readonly sourceEpoch: "current-run-through-first-room-closure";
  readonly capturedAtTick120: number;
  readonly rawRunSeed: CanonicalRunBehaviorFactsSnapshot["rawRunSeed"];
  readonly contentIdentity: V4ContentIdentity;
  readonly sourceBoundary: CanonicalRunFirstRoomClosureCaptureAvailable["sourceBoundary"];
  readonly projectionStatus: "partial";
  readonly availableMetricCount: 3;
  readonly missingMetricCount: 11;
  readonly metricEntries: readonly CanonicalRunFirstRoomMetricEntry[];
  readonly ready: false;
  readonly selectionAllowed: false;
  readonly selectionRngDraws: 0;
  readonly canonicalEventWrites: 0;
  readonly targetRoom: null;
  readonly transitionAllowed: false;
}

declare const canonicalRunFirstRoomMetricProjectionBrand: unique symbol;
declare const canonicalRunFirstRoomMetricProjectionReceiptBrand: unique symbol;

/** Formal projection; only the receipt-taking factory can return this brand. */
export type CanonicalRunFirstRoomMetricProjectionAvailable =
  CanonicalRunFirstRoomMetricProjectionPayload & {
    readonly [canonicalRunFirstRoomMetricProjectionBrand]: true;
  };

/** Opaque in-memory authority for the exact formal projection object. */
export type CanonicalRunFirstRoomMetricProjectionReceipt = Readonly<{
  readonly [canonicalRunFirstRoomMetricProjectionReceiptBrand]: true;
}>;

export type CanonicalRunFirstRoomMetricProjection =
  | CanonicalRunFirstRoomMetricProjectionMissing
  | CanonicalRunFirstRoomMetricProjectionAvailable;

export const CANONICAL_RUN_FIRST_ROOM_METRIC_PROJECTION_MISSING:
  CanonicalRunFirstRoomMetricProjectionMissing = Object.freeze({
  availability: "missing",
  reason: "first-room-metric-source-not-closed",
  ready: false,
  selectionAllowed: false,
});

const formalProjections = new WeakSet<object>();
const formalProjectionReceiptsByProjection = new WeakMap<
  object,
  CanonicalRunFirstRoomMetricProjectionReceipt
>();
const formalProjectionReceipts = new WeakMap<
  object,
  CanonicalRunFirstRoomMetricProjectionAvailable
>();

const MISSING_REASONS: Readonly<Record<
  CanonicalRunFirstRoomMissingMetricId,
  CanonicalRunFirstRoomMetricMissingReason
>> = Object.freeze({
  binarySwitches: "binary-authority-not-observed",
  contextSwitches: "context-transition-sequence-not-recorded",
  correctionLatency: "correction-pairs-not-recorded",
  crackRatio: "crack-band-samples-not-recorded",
  highLightRatio: "high-light-threshold-samples-not-recorded",
  intersectionHold: "intersection-authority-not-observed",
  noDuskTicks: "no-dusk-authority-not-observed",
  overrideRatio: "override-not-eligible-in-source-window",
  sideCommitment: "side-band-samples-not-recorded",
  sideSwitches: "side-transition-sequence-not-recorded",
  unansweredActions: "action-response-contract-not-authored",
});

type UnknownRecord = Record<string, unknown>;

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`first-room metric projection ${message}`);
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

function finite(value: unknown, path: string): number {
  invariant(typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0), `${path} must be finite`);
  return value as number;
}

function safeAdd(left: number, right: number, path: string): number {
  const result = left + right;
  invariant(Number.isSafeInteger(result) && result >= 0, `${path} exceeded safe integer range`);
  return result;
}

function plainRecord(value: unknown, path: string): UnknownRecord {
  invariant(typeof value === "object" && value !== null && !Array.isArray(value), `${path} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  invariant(prototype === Object.prototype || prototype === null, `${path} must be a plain object`);
  return value as UnknownRecord;
}

function assertExactKeys(value: unknown, expected: readonly string[], path: string): void {
  const record = plainRecord(value, path);
  const keys = Object.keys(record).sort(compareCodePoints);
  const expectedKeys = [...expected].sort(compareCodePoints);
  invariant(
    keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index]),
    `${path} must contain only its exact schema fields`,
  );
}

function assertFrozenJsonData(
  value: unknown,
  path = "source",
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
    const keys = Reflect.ownKeys(value);
    invariant(
      keys.length === value.length + 1
        && keys[value.length] === "length"
        && keys.slice(0, value.length).every((key, index) => key === String(index)),
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
    plainRecord(value, path);
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

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const entry of Object.values(value)) deepFreeze(entry, seen);
  return Object.freeze(value);
}

function deriveMetricUniverse(): readonly CanonicalRunFirstRoomMetricId[] {
  invariant(roomComposersJson.schemaVersion === "4.0.0", "requires V4 room-composer schema 4.0.0");
  const ids = new Set<string>();
  for (const composer of roomComposersJson.composers) {
    invariant(
      composer.algorithm === "seeded_weighted_without_replacement_with_behavior_bias",
      `room composer algorithm drifted: ${composer.id}`,
    );
    for (const [id, weight] of Object.entries(composer.behaviorMetricWeights)) {
      invariant(Number.isFinite(weight), `room composer metric weight ${id} must be finite`);
      ids.add(id);
    }
  }
  const derived = [...ids].sort(compareCodePoints);
  invariant(
    derived.length === EXPECTED_METRIC_IDS.length
      && derived.every((id, index) => id === EXPECTED_METRIC_IDS[index]),
    "V4 room-composer metric universe drifted",
  );
  return EXPECTED_METRIC_IDS;
}

export const CANONICAL_RUN_FIRST_ROOM_METRIC_IDS = deriveMetricUniverse();

function assertContentIdentity(value: V4ContentIdentity): void {
  assertExactKeys(value, [
    "contentAuthoritySchemaVersion",
    "packageId",
    "packageSchemaVersion",
    "packageManifestSha256",
    "contentDigestSha256",
  ], "source.contentIdentity");
  invariant(
    value.contentAuthoritySchemaVersion === V4_CONTENT_IDENTITY.contentAuthoritySchemaVersion
      && value.packageId === V4_CONTENT_IDENTITY.packageId
      && value.packageSchemaVersion === V4_CONTENT_IDENTITY.packageSchemaVersion
      && value.packageManifestSha256 === V4_CONTENT_IDENTITY.packageManifestSha256
      && value.contentDigestSha256 === V4_CONTENT_IDENTITY.contentDigestSha256,
    "source content identity drifted",
  );
}

function assertTaggedRawRunSeed(
  value: CanonicalRunBehaviorFactsSnapshot["rawRunSeed"],
  path: string,
): number {
  assertExactKeys(value, ["domain", "value"], path);
  invariant(value.domain === "raw-run-seed", `${path} domain is incompatible`);
  const seed = safeNonNegativeInteger(value.value, `${path}.value`);
  invariant(seed <= UINT32_MAX, `${path}.value must be uint32`);
  return seed;
}

interface CountMapResult {
  readonly counts: ReadonlyMap<string, number>;
  readonly total: number;
}

function countMap(
  entries: readonly CanonicalRunBehaviorCountEntry[],
  path: string,
  allowedIds?: ReadonlySet<string>,
): CountMapResult {
  invariant(Array.isArray(entries), `${path} must be an array`);
  const counts = new Map<string, number>();
  let previous: string | null = null;
  let total = 0;
  for (const [index, entry] of entries.entries()) {
    assertExactKeys(entry, ["id", "ticks120"], `${path}[${index}]`);
    invariant(typeof entry.id === "string" && entry.id.length > 0, `${path}[${index}].id must be non-empty`);
    invariant(allowedIds === undefined || allowedIds.has(entry.id), `${path}[${index}].id is not allowed`);
    invariant(previous === null || compareCodePoints(previous, entry.id) < 0, `${path} must be unique and sorted`);
    const count = safePositiveInteger(entry.ticks120, `${path}[${index}].ticks120`);
    counts.set(entry.id, count);
    total = safeAdd(total, count, `${path} total`);
    previous = entry.id;
  }
  return Object.freeze({counts, total});
}

function assertAvailableShape(
  value: unknown,
  aggregateKeys: readonly string[],
  path: string,
): asserts value is CanonicalRunBehaviorAvailable<UnknownRecord> {
  assertExactKeys(value, [
    "availability",
    "firstAvailableTick120",
    "lastAvailableTick120",
    "sampleCount",
    "aggregate",
  ], path);
  const record = value as unknown as CanonicalRunBehaviorAvailable<UnknownRecord>;
  invariant(record.availability === "available", `${path} must be available`);
  const first = safePositiveInteger(record.firstAvailableTick120, `${path}.firstAvailableTick120`);
  const last = safePositiveInteger(record.lastAvailableTick120, `${path}.lastAvailableTick120`);
  const samples = safePositiveInteger(record.sampleCount, `${path}.sampleCount`);
  invariant(first <= last && samples <= last - first + 1, `${path} availability window is invalid`);
  assertExactKeys(record.aggregate, aggregateKeys, `${path}.aggregate`);
}

function assertBehaviorFactsShape(facts: CanonicalRunBehaviorFactsSnapshot): void {
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
  ], "source.behaviorFacts");
  assertExactKeys(facts.sampling, [
    "tickZeroExcluded",
    "firstAcceptedTick120",
    "lastAcceptedTick120",
    "ownerPhaseTickCounts",
  ], "source.behaviorFacts.sampling");
  assertAvailableShape(facts.requested, [
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
  ], "source.behaviorFacts.requested");
  assertExactKeys(facts.committed, ["player", "flower", "gaze", "override"], "source.behaviorFacts.committed");
  assertAvailableShape(facts.committed.player, [
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
  ], "source.behaviorFacts.committed.player");
  assertAvailableShape(facts.committed.flower, [
    "targetIntensitySum",
    "sourceTickCounts",
  ], "source.behaviorFacts.committed.flower");
  assertAvailableShape(facts.committed.gaze, [
    "clampActiveTickCount",
    "stateTickCounts",
  ], "source.behaviorFacts.committed.gaze");
  assertAvailableShape(facts.committed.override, [
    "stateTickCounts",
    "maximumCycle",
    "maximumScarCount",
  ], "source.behaviorFacts.committed.override");
  assertExactKeys(facts.context, ["room", "runCombat"], "source.behaviorFacts.context");
  assertAvailableShape(facts.context.room, ["roomTickCounts"], "source.behaviorFacts.context.room");
  assertAvailableShape(
    facts.context.runCombat,
    ["noActiveOccurrenceTickCount", "activeOccurrenceTickCounts"],
    "source.behaviorFacts.context.runCombat",
  );
  assertExactKeys(facts.canonicalEvents, [
    "tickZeroBaselineCount",
    "observedCount",
    "lastObservedSequence",
    "countsById",
  ], "source.behaviorFacts.canonicalEvents");
  assertExactKeys(facts.composerAvailability, [
    "status",
    "ready",
    "selectionAllowed",
    "unresolvedMetricIds",
  ], "source.behaviorFacts.composerAvailability");
  assertExactKeys(facts.adapterPolicy, [
    "sampleBoundary",
    "ownerPhase",
    "storage",
    "requestCommitSeparation",
    "canonicalEventWrites",
    "metricProjection",
    "provenance",
  ], "source.behaviorFacts.adapterPolicy");
}

interface MetricRatioInput {
  readonly numerator: number;
  readonly denominator: number;
  readonly firstTick120: number;
  readonly lastTick120: number;
}

interface ClosureProjectionInputs {
  readonly capturedAtTick120: number;
  readonly flower: Readonly<MetricRatioInput>;
  readonly gaze: Readonly<MetricRatioInput>;
}

interface ProjectionInputs extends ClosureProjectionInputs {
  readonly recentInput: Readonly<MetricRatioInput>;
}

function validateSource(source: CanonicalRunFirstRoomClosureCaptureAvailable): ClosureProjectionInputs {
  assertFrozenJsonData(source);
  assertExactKeys(source, [
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
    "plannedOccurrenceCount",
    "completedOccurrenceCount",
    "remainingOccurrenceCount",
    "roomComplete",
    "completedRoomVisit",
    "distinctVisitedDelta",
    "handoffReady",
    "metricProjection",
    "selectionAllowed",
    "transitionAllowed",
    "targetRoom",
    "selectionRngDraws",
    "canonicalEventWrites",
  ], "source");
  invariant(
    source.availability === "available"
      && source.authority === "canonical-run-first-room-closure-capture-v1"
      && source.schemaVersion === "1.0.0-ext-2026-009"
      && source.producerId === "canonical-run-session.first-room-closure-observer"
      && source.producerVersion === "1.0.0"
      && source.extensionPolicy === "EXT-2026-009"
      && source.sourceEpoch === "current-run-through-first-room-closure",
    "source identity is incompatible",
  );
  const capturedAtTick120 = safePositiveInteger(source.capturedAtTick120, "source.capturedAtTick120");
  const rawRunSeed = assertTaggedRawRunSeed(source.rawRunSeed, "source.rawRunSeed");
  assertContentIdentity(source.contentIdentity);

  assertExactKeys(source.sourceBoundary, [
    "preRoomTick120",
    "firstOccurrenceObservationTick120",
    "roomClosureTick120",
    "roomId",
    "roomOrdinal",
    "patternId",
    "occurrenceId",
    "encounterOrdinal",
    "resolvedSeed",
  ], "source.sourceBoundary");
  assertExactKeys(source.sourceBoundary.resolvedSeed, ["domain", "value"], "source.sourceBoundary.resolvedSeed");
  const preRoomTick120 = safePositiveInteger(source.sourceBoundary.preRoomTick120, "source.sourceBoundary.preRoomTick120");
  const observationTick120 = safePositiveInteger(
    source.sourceBoundary.firstOccurrenceObservationTick120,
    "source.sourceBoundary.firstOccurrenceObservationTick120",
  );
  const closureTick120 = safePositiveInteger(
    source.sourceBoundary.roomClosureTick120,
    "source.sourceBoundary.roomClosureTick120",
  );
  invariant(
    observationTick120 === preRoomTick120 + RUN_ROOM_SESSION_CONTRACT.relativeBoundaryTicks120.fixedSliceComplete
      && closureTick120 === preRoomTick120 + FIRST_FIXED_ROOM_CLOSURE_CONTRACT.closureRelativeTick120
      && observationTick120 + 1 === closureTick120
      && closureTick120 === capturedAtTick120,
    "source boundary is not the exact H/H+1701/H+1702 closure",
  );
  invariant(
    source.sourceBoundary.roomId === RUN_ROOM_SESSION_CONTRACT.roomId
      && source.sourceBoundary.roomOrdinal === RUN_ROOM_SESSION_CONTRACT.roomOrdinal
      && source.sourceBoundary.patternId === RUN_ROOM_SESSION_CONTRACT.patternId
      && source.sourceBoundary.occurrenceId === RUN_ROOM_SESSION_CONTRACT.occurrenceId
      && source.sourceBoundary.encounterOrdinal === RUN_ROOM_SESSION_CONTRACT.encounterOrdinal,
    "source room identity is incompatible",
  );
  invariant(
    source.sourceBoundary.resolvedSeed.domain === "resolved-occurrence-seed",
    "source resolved seed domain is incompatible",
  );
  const resolvedSeed = safeNonNegativeInteger(
    source.sourceBoundary.resolvedSeed.value,
    "source.sourceBoundary.resolvedSeed.value",
  );
  invariant(resolvedSeed <= UINT32_MAX, "source resolved seed must be uint32");
  const expectedResolvedSeed = (
    rawRunSeed
    ^ executablePattern(RUN_ROOM_SESSION_CONTRACT.patternId).seed.base
    ^ RUN_ROOM_SESSION_CONTRACT.encounterOrdinal
    ^ RUN_ROOM_SESSION_CONTRACT.difficultySalt
  ) >>> 0;
  invariant(resolvedSeed === expectedResolvedSeed, "source resolved seed provenance drifted");
  assertExactKeys(source.completedRoomVisit, ["roomId", "roomOrdinal"], "source.completedRoomVisit");
  invariant(
    source.plannedOccurrenceCount === 1
      && source.completedOccurrenceCount === 1
      && source.remainingOccurrenceCount === 0
      && source.roomComplete === true
      && source.completedRoomVisit.roomId === source.sourceBoundary.roomId
      && source.completedRoomVisit.roomOrdinal === source.sourceBoundary.roomOrdinal
      && source.distinctVisitedDelta === 1
      && source.handoffReady === false
      && source.metricProjection === false
      && source.selectionAllowed === false
      && source.transitionAllowed === false
      && source.targetRoom === null
      && source.selectionRngDraws === 0
      && source.canonicalEventWrites === 0,
    "source closure firewall is incompatible",
  );

  const facts = source.behaviorFacts;
  assertBehaviorFactsShape(facts);
  invariant(
    facts.authority === "canonical-run-behavior-facts-v1"
      && facts.schemaVersion === "1.0.0-ext-2026-006"
      && facts.producerId === "canonical-run-session.accepted-tick-observer"
      && facts.producerVersion === "1.0.0"
      && facts.extensionPolicy === "EXT-2026-006",
    "source behavior-facts identity is incompatible",
  );
  invariant(
    assertTaggedRawRunSeed(facts.rawRunSeed, "source.behaviorFacts.rawRunSeed") === rawRunSeed,
    "source behavior-facts raw Run seed diverged",
  );
  invariant(
    facts.tick120 === capturedAtTick120
      && facts.acceptedTickCount === capturedAtTick120
      && facts.sampling.tickZeroExcluded === true
      && facts.sampling.firstAcceptedTick120 === 1
      && facts.sampling.lastAcceptedTick120 === capturedAtTick120,
    "source behavior-facts boundary diverged",
  );
  const ownerCounts = countMap(
    facts.sampling.ownerPhaseTickCounts,
    "source.behaviorFacts.sampling.ownerPhaseTickCounts",
    new Set(["quiet_awakening", "first_eye", "first_clamp_recovery", "room_sampling"]),
  );
  invariant(
    ownerCounts.total === capturedAtTick120
      && ownerCounts.counts.get("room_sampling")
        === FIRST_FIXED_ROOM_CLOSURE_CONTRACT.closureRelativeTick120
      && ownerCounts.total - FIRST_FIXED_ROOM_CLOSURE_CONTRACT.closureRelativeTick120
        === preRoomTick120,
    "source owner phases do not cover the exact closure prefix",
  );
  invariant(
    facts.composerAvailability.status === "withheld-metric-projection-policy-not-authored"
      && facts.composerAvailability.ready === false
      && facts.composerAvailability.selectionAllowed === false
      && facts.composerAvailability.unresolvedMetricIds.length === EXPECTED_METRIC_IDS.length
      && facts.composerAvailability.unresolvedMetricIds.every(
        (id, index) => id === EXPECTED_METRIC_IDS[index],
      ),
    "source composer availability is incompatible",
  );
  invariant(
    facts.adapterPolicy.sampleBoundary === "post-authority-after-closed-canonical-tick"
      && facts.adapterPolicy.ownerPhase === "captured-before-phase-specific-step"
      && facts.adapterPolicy.storage === "bounded-rolling-aggregates-no-per-tick-history"
      && facts.adapterPolicy.requestCommitSeparation === true
      && facts.adapterPolicy.canonicalEventWrites === 0
      && facts.adapterPolicy.metricProjection === false
      && facts.adapterPolicy.provenance === "application-policy-EXT-2026-006",
    "source behavior-facts adapter policy is incompatible",
  );

  const flower = facts.committed.flower;
  invariant(flower.availability === "available", "source Flower facts must be available");
  const flowerDenominator = safePositiveInteger(flower.sampleCount, "source Flower sampleCount");
  const flowerNumerator = finite(
    flower.aggregate.targetIntensitySum,
    "source Flower targetIntensitySum",
  );
  invariant(
    flower.firstAvailableTick120 === 1
      && flower.lastAvailableTick120 === capturedAtTick120
      && flowerDenominator === capturedAtTick120
      && flowerNumerator >= 0
      && flowerNumerator <= flowerDenominator,
    "source Flower aggregate is outside its exact closed sample window",
  );
  const flowerSources = countMap(
    flower.aggregate.sourceTickCounts,
    "source.behaviorFacts.committed.flower.aggregate.sourceTickCounts",
    new Set(["override", "gaze", "focus", "signal"]),
  );
  invariant(flowerSources.total === flowerDenominator, "source Flower source counts do not cover its samples");

  const gaze = facts.committed.gaze;
  invariant(gaze.availability === "available", "source Gaze facts must be available");
  const gazeFirst = safePositiveInteger(gaze.firstAvailableTick120, "source Gaze firstAvailableTick120");
  const gazeLast = safePositiveInteger(gaze.lastAvailableTick120, "source Gaze lastAvailableTick120");
  const gazeDenominator = safePositiveInteger(gaze.sampleCount, "source Gaze sampleCount");
  const gazeStates = countMap(
    gaze.aggregate.stateTickCounts,
    "source.behaviorFacts.committed.gaze.aggregate.stateTickCounts",
    new Set(["idle", "acquiring", "clamped", "release-delay"]),
  );
  const gazeNumerator = gazeStates.counts.get("clamped") ?? 0;
  const clampActiveTicks = safeNonNegativeInteger(
    gaze.aggregate.clampActiveTickCount,
    "source Gaze clampActiveTickCount",
  );
  const quietTicks = ownerCounts.counts.get("quiet_awakening") ?? 0;
  invariant(
    gazeFirst === quietTicks + 1
      && gazeLast === capturedAtTick120
      && gazeDenominator === gazeLast - gazeFirst + 1
      && gazeStates.total === gazeDenominator
      && clampActiveTicks === gazeNumerator + (gazeStates.counts.get("release-delay") ?? 0),
    "source Gaze aggregate is outside its exact authority window",
  );

  return deepFreeze({
    capturedAtTick120,
    flower: {
      numerator: flowerNumerator,
      denominator: flowerDenominator,
      firstTick120: flower.firstAvailableTick120,
      lastTick120: flower.lastAvailableTick120,
    },
    gaze: {
      numerator: gazeNumerator,
      denominator: gazeDenominator,
      firstTick120: gazeFirst,
      lastTick120: gazeLast,
    },
  });
}

function validateRecentInputSupplement(
  supplement: CanonicalRunFirstRoomRecentInputSupplementSource,
  source: CanonicalRunFirstRoomClosureCaptureAvailable,
  closureInputs: ClosureProjectionInputs,
): Readonly<MetricRatioInput> {
  assertFrozenJsonData(supplement, "metricSupplement");
  assertExactKeys(supplement, [
    "availability",
    "authority",
    "schemaVersion",
    "producerId",
    "producerVersion",
    "extensionPolicy",
    "sourceEpoch",
    "capturedAtTick120",
    "rawRunSeed",
    "sourceWindow",
    "roomTickCount",
    "activeUnionTickCount",
    "canonicalEventWrites",
  ], "metricSupplement");
  invariant(
    supplement.availability === "available"
      && supplement.authority === "canonical-run-first-room-recent-input-supplement-v1"
      && supplement.schemaVersion === "1.0.0-ext-2026-011"
      && supplement.producerId === "canonical-run-behavior-facts.first-room-recent-input-observer"
      && supplement.producerVersion === "1.0.0"
      && supplement.extensionPolicy === "EXT-2026-011"
      && supplement.sourceEpoch === "first-authored-room-input-window",
    "metric supplement identity is incompatible",
  );
  const capturedAtTick120 = safePositiveInteger(
    supplement.capturedAtTick120,
    "metricSupplement.capturedAtTick120",
  );
  const rawRunSeed = assertTaggedRawRunSeed(
    supplement.rawRunSeed,
    "metricSupplement.rawRunSeed",
  );
  const sourceRawRunSeed = assertTaggedRawRunSeed(source.rawRunSeed, "source.rawRunSeed");
  assertExactKeys(supplement.sourceWindow, [
    "firstTick120",
    "lastTick120",
  ], "metricSupplement.sourceWindow");
  const firstTick120 = safePositiveInteger(
    supplement.sourceWindow.firstTick120,
    "metricSupplement.sourceWindow.firstTick120",
  );
  const lastTick120 = safePositiveInteger(
    supplement.sourceWindow.lastTick120,
    "metricSupplement.sourceWindow.lastTick120",
  );
  const roomTickCount = safePositiveInteger(
    supplement.roomTickCount,
    "metricSupplement.roomTickCount",
  );
  const activeUnionTickCount = safeNonNegativeInteger(
    supplement.activeUnionTickCount,
    "metricSupplement.activeUnionTickCount",
  );
  invariant(
    capturedAtTick120 === closureInputs.capturedAtTick120
      && rawRunSeed === sourceRawRunSeed
      && firstTick120 === source.sourceBoundary.preRoomTick120 + 1
      && lastTick120 === closureInputs.capturedAtTick120
      && roomTickCount === FIRST_FIXED_ROOM_CLOSURE_CONTRACT.closureRelativeTick120
      && lastTick120 - firstTick120 + 1 === roomTickCount
      && activeUnionTickCount <= roomTickCount
      && supplement.canonicalEventWrites === 0,
    "metric supplement does not cover the exact event-free H+1 through H+1702 window",
  );
  return deepFreeze({
    numerator: activeUnionTickCount,
    denominator: roomTickCount,
    firstTick120,
    lastTick120,
  });
}

function availableEntry(
  id: CanonicalRunFirstRoomAvailableMetricId,
  formulaId: CanonicalRunFirstRoomMetricAvailableEntry["formulaId"],
  numeratorPath: string,
  denominatorPath: string,
  input: ProjectionInputs["flower"] | ProjectionInputs["gaze"] | ProjectionInputs["recentInput"],
): CanonicalRunFirstRoomMetricAvailableEntry {
  const value = input.numerator / input.denominator;
  invariant(
    Number.isFinite(value) && value >= 0 && value <= 1 && !Object.is(value, -0),
    `${id} ratio is outside [0,1]`,
  );
  return deepFreeze({
    id,
    availability: "available" as const,
    value,
    unit: "ratio-0-1" as const,
    formulaId,
    numerator: {sourcePath: numeratorPath, value: input.numerator},
    denominator: {sourcePath: denominatorPath, value: input.denominator},
    sampleWindow: {firstTick120: input.firstTick120, lastTick120: input.lastTick120},
  });
}

function metricEntries(inputs: ProjectionInputs): readonly CanonicalRunFirstRoomMetricEntry[] {
  const entries = EXPECTED_METRIC_IDS.map((id): CanonicalRunFirstRoomMetricEntry => {
    if (id === "avgFlower") {
      return availableEntry(
        id,
        "committed-flower-target-mean-v1",
        "behaviorFacts.committed.flower.aggregate.targetIntensitySum",
        "behaviorFacts.committed.flower.sampleCount",
        inputs.flower,
      );
    }
    if (id === "gazeRatio") {
      return availableEntry(
        id,
        "committed-gaze-clamped-state-ratio-v1",
        "behaviorFacts.committed.gaze.aggregate.stateTickCounts[clamped].ticks120",
        "behaviorFacts.committed.gaze.sampleCount",
        inputs.gaze,
      );
    }
    if (id === "recentInputDensity") {
      return availableEntry(
        id,
        "first-room-active-input-union-ratio-v1",
        "metricSupplement.activeUnionTickCount",
        "metricSupplement.roomTickCount",
        inputs.recentInput,
      );
    }
    return Object.freeze({
      id,
      availability: "missing" as const,
      reason: MISSING_REASONS[id],
    });
  });
  return Object.freeze(entries);
}

/**
 * Unbranded/testable derivation core. It validates exact frozen source data but
 * cannot mint the formal projection brand. Production callers must use the
 * receipt-taking factory below.
 */
export function deriveCanonicalRunFirstRoomMetricProjectionUnbranded(
  source: CanonicalRunFirstRoomClosureCaptureAvailable,
  supplement: CanonicalRunFirstRoomRecentInputSupplementSource,
): CanonicalRunFirstRoomMetricProjectionPayload {
  const closureInputs = validateSource(source);
  const inputs = deepFreeze({
    ...closureInputs,
    recentInput: validateRecentInputSupplement(supplement, source, closureInputs),
  });
  const sourceBoundary = deepFreeze({
    preRoomTick120: source.sourceBoundary.preRoomTick120,
    firstOccurrenceObservationTick120: source.sourceBoundary.firstOccurrenceObservationTick120,
    roomClosureTick120: source.sourceBoundary.roomClosureTick120,
    roomId: source.sourceBoundary.roomId,
    roomOrdinal: source.sourceBoundary.roomOrdinal,
    patternId: source.sourceBoundary.patternId,
    occurrenceId: source.sourceBoundary.occurrenceId,
    encounterOrdinal: source.sourceBoundary.encounterOrdinal,
    resolvedSeed: {
      domain: source.sourceBoundary.resolvedSeed.domain,
      value: source.sourceBoundary.resolvedSeed.value,
    },
  }) satisfies CanonicalRunFirstRoomClosureCaptureAvailable["sourceBoundary"];
  return deepFreeze({
    availability: "available" as const,
    authority: AUTHORITY,
    schemaVersion: SCHEMA_VERSION,
    producerId: PRODUCER_ID,
    producerVersion: PRODUCER_VERSION,
    extensionPolicy: "EXT-2026-011" as const,
    sourceEpoch: "current-run-through-first-room-closure" as const,
    capturedAtTick120: inputs.capturedAtTick120,
    rawRunSeed: {
      domain: source.rawRunSeed.domain,
      value: source.rawRunSeed.value,
    },
    contentIdentity: V4_CONTENT_IDENTITY,
    sourceBoundary,
    projectionStatus: "partial" as const,
    availableMetricCount: 3 as const,
    missingMetricCount: 11 as const,
    metricEntries: metricEntries(inputs),
    ready: false as const,
    selectionAllowed: false as const,
    selectionRngDraws: 0 as const,
    canonicalEventWrites: 0 as const,
    targetRoom: null,
    transitionAllowed: false as const,
  });
}

/** Formal EXT-011 entry point. Plain captures and unbranded fixtures are not accepted. */
export function createCanonicalRunFirstRoomMetricProjection(
  sourceReceipt: CanonicalRunFirstRoomMetricSourceReceipt,
  supplementReceipt: CanonicalRunFirstRoomRecentInputSupplementReceipt,
): CanonicalRunFirstRoomMetricProjectionAvailable {
  const sourceLineage = firstRoomMetricSourceLineageFromCanonicalReceipt(sourceReceipt);
  const supplementLineage = firstRoomRecentInputLineageFromCanonicalReceipt(supplementReceipt);
  invariant(
    sourceLineage === supplementLineage,
    "closure and metric supplement receipts must share one opaque ledger lineage",
  );
  const source = firstRoomClosureFromCanonicalMetricSourceReceipt(sourceReceipt);
  const supplement = firstRoomRecentInputSupplementFromCanonicalReceipt(supplementReceipt);
  const payload = deriveCanonicalRunFirstRoomMetricProjectionUnbranded(source, supplement);
  const projection = payload as CanonicalRunFirstRoomMetricProjectionAvailable;
  formalProjections.add(projection);
  return projection;
}

/**
 * Issues an opaque receipt only for the original formal projection. Public
 * snapshots and JSON-equivalent clones deliberately fail this boundary.
 */
export function issueCanonicalRunFirstRoomMetricProjectionReceipt(
  projection: CanonicalRunFirstRoomMetricProjectionAvailable,
): CanonicalRunFirstRoomMetricProjectionReceipt {
  invariant(formalProjections.has(projection), "metric projection receipt requires the original formal projection");
  const existing = formalProjectionReceiptsByProjection.get(projection);
  if (existing !== undefined) return existing;
  const receipt = Object.freeze({}) as CanonicalRunFirstRoomMetricProjectionReceipt;
  formalProjectionReceiptsByProjection.set(projection, receipt);
  formalProjectionReceipts.set(receipt, projection);
  return receipt;
}

/** Internal authority handoff for the EXT-012 first-continuation selector. */
export function firstRoomMetricProjectionFromCanonicalReceipt(
  receipt: CanonicalRunFirstRoomMetricProjectionReceipt,
): CanonicalRunFirstRoomMetricProjectionAvailable {
  invariant(typeof receipt === "object" && receipt !== null, "metric projection receipt must be opaque");
  const projection = formalProjectionReceipts.get(receipt);
  invariant(projection !== undefined, "metric projection receipt is not registered");
  return projection;
}
