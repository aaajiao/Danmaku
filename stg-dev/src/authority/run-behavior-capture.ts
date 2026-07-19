import roomComposersJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/room-composers-v4.json";

import {V4_CONTENT_IDENTITY, type V4ContentIdentity} from "../content/v4-content-identity";
import type {
  CanonicalRunBehaviorCountEntry,
  CanonicalRunBehaviorEventCountEntry,
  CanonicalRunBehaviorFactsSnapshot,
} from "./run-behavior-facts";

const UINT32_MAX = 0xffff_ffff;
const AUTHORITY = "canonical-run-pre-room-behavior-capture-v1" as const;
const SCHEMA_VERSION = "1.0.0-ext-2026-007" as const;
const PRODUCER_ID = "canonical-run-session.pre-room-boundary-observer" as const;
const PRODUCER_VERSION = "1.0.0" as const;

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

export const CANONICAL_RUN_PRE_ROOM_BEHAVIOR_CAPTURE_MISSING:
  CanonicalRunPreRoomBehaviorCaptureMissing = Object.freeze({
  availability: "missing",
  reason: "pre-room-boundary-not-closed",
  metricProjection: false,
  selectionAllowed: false,
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
  invariant(record.availability === "available", `${path} must be available at H`);
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
  assertExactKeys(facts.context.room, ["availability", "reason"], "behaviorFacts.context.room");
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

function validateOwnerPhaseCounts(
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

function validateSourceFacts(
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
  validateOwnerPhaseCounts(facts.sampling.ownerPhaseTickCounts, capturedAtTick120);

  invariant(
    facts.context.room.availability === "missing"
      && facts.context.room.reason === "room-context-not-consumed-yet",
    "room context must remain missing at the pre-room boundary",
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

export function createCanonicalRunPreRoomBehaviorCapture(
  options: CreateCanonicalRunPreRoomBehaviorCaptureOptions,
): CanonicalRunPreRoomBehaviorCaptureAvailable {
  const capturedAtTick120 = safePositiveInteger(options.capturedAtTick120, "capturedAtTick120");
  const sourceEventCount = safeNonNegativeInteger(options.sourceEventCount, "sourceEventCount");
  validateSourceFacts(options.behaviorFacts, capturedAtTick120, sourceEventCount);

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
