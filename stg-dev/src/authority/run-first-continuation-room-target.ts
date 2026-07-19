import roomComposersJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/room-composers-v4.json";
import runDirectorJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/run-director-v4.json";

import {V4_CONTENT_IDENTITY, type V4ContentIdentity} from "../content/v4-content-identity";
import {
  CANONICAL_RUN_FIRST_ROOM_METRIC_IDS,
  firstRoomMetricProjectionFromCanonicalReceipt,
  type CanonicalRunFirstRoomMetricAvailableEntry,
  type CanonicalRunFirstRoomMetricId,
  type CanonicalRunFirstRoomMetricMissingEntry,
  type CanonicalRunFirstRoomMetricProjectionPayload,
  type CanonicalRunFirstRoomMetricProjectionReceipt,
} from "./run-metric-projection";
import {executablePattern} from "./pattern-executor";
import {
  FIRST_FIXED_ROOM_CLOSURE_CONTRACT,
  RUN_ROOM_SESSION_CONTRACT,
} from "./run-room-contract";

const UINT32_MAX = 0xffff_ffff;
const MULBERRY32_INCREMENT = 0x6d2b79f5;
const AUTHORITY = "canonical-run-first-continuation-room-target-v1" as const;
const SCHEMA_VERSION = "1.0.0-ext-2026-012" as const;
const PRODUCER_ID = "canonical-run-session.first-continuation-room-selector" as const;
const PRODUCER_VERSION = "1.0.0" as const;
const RNG_DOMAIN = "ext-012-first-continuation-room-selection" as const;

const EXPECTED_ROOM_ORDER = Object.freeze([
  "INFORMATION",
  "FORCED_ALIGNMENT",
  "IN_BETWEEN",
  "POLARIZED",
] as const);
const EXPECTED_REMAINING_ROOM_ORDER = Object.freeze([
  "INFORMATION",
  "IN_BETWEEN",
  "POLARIZED",
] as const);
const EXPECTED_COMPOSER_IDS = Object.freeze([
  "composer.information",
  "composer.forced_alignment",
  "composer.in_between",
  "composer.polarized",
] as const);
const EXPECTED_AVAILABLE_METRIC_IDS = new Set<CanonicalRunFirstRoomMetricId>([
  "avgFlower",
  "gazeRatio",
  "recentInputDensity",
]);
const AVAILABLE_METRIC_CONTRACTS = Object.freeze({
  avgFlower: Object.freeze({
    formulaId: "committed-flower-target-mean-v1",
    numeratorPath: "behaviorFacts.committed.flower.aggregate.targetIntensitySum",
    denominatorPath: "behaviorFacts.committed.flower.sampleCount",
  }),
  gazeRatio: Object.freeze({
    formulaId: "committed-gaze-clamped-state-ratio-v1",
    numeratorPath: "behaviorFacts.committed.gaze.aggregate.stateTickCounts[clamped].ticks120",
    denominatorPath: "behaviorFacts.committed.gaze.sampleCount",
  }),
  recentInputDensity: Object.freeze({
    formulaId: "first-room-active-input-union-ratio-v1",
    numeratorPath: "metricSupplement.activeUnionTickCount",
    denominatorPath: "metricSupplement.roomTickCount",
  }),
} as const);

export type CanonicalRunRoomId = typeof EXPECTED_ROOM_ORDER[number];
export type CanonicalRunFirstContinuationRoomId = typeof EXPECTED_REMAINING_ROOM_ORDER[number];

export interface CanonicalRunFirstContinuationAvailableMetricTerm {
  readonly id: CanonicalRunFirstRoomMetricId;
  readonly availability: "available";
  readonly value: number;
  readonly authoredWeight: number;
  readonly contribution: number;
}

export interface CanonicalRunFirstContinuationMissingMetricTerm {
  readonly id: CanonicalRunFirstRoomMetricId;
  readonly availability: "missing";
  readonly reason: CanonicalRunFirstRoomMetricMissingEntry["reason"];
  readonly authoredWeight: number;
}

export type CanonicalRunFirstContinuationMetricTerm =
  | CanonicalRunFirstContinuationAvailableMetricTerm
  | CanonicalRunFirstContinuationMissingMetricTerm;

export interface CanonicalRunFirstContinuationCandidateWeight {
  readonly roomId: CanonicalRunFirstContinuationRoomId;
  readonly baseWeight: 1;
  readonly metricTerms: readonly CanonicalRunFirstContinuationMetricTerm[];
  readonly totalWeight: number;
}

export interface CanonicalRunFirstContinuationRoomTargetPayload {
  readonly availability: "available";
  readonly authority: typeof AUTHORITY;
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly producerId: typeof PRODUCER_ID;
  readonly producerVersion: typeof PRODUCER_VERSION;
  readonly extensionPolicy: "EXT-2026-012";
  readonly sourceEpoch: "current-run-through-first-room-closure";
  readonly selectedAtTick120: number;
  readonly rawRunSeed: CanonicalRunFirstRoomMetricProjectionPayload["rawRunSeed"];
  readonly contentIdentity: V4ContentIdentity;
  readonly sourceBoundary: CanonicalRunFirstRoomMetricProjectionPayload["sourceBoundary"];
  readonly sourceProjection: Readonly<{
    readonly authority: "canonical-run-first-room-metric-projection-v1";
    readonly schemaVersion: "1.1.0-ext-2026-011";
    readonly extensionPolicy: "EXT-2026-011";
    readonly availableMetricCount: 3;
    readonly missingMetricCount: 11;
  }>;
  readonly completedRoomVisit: Readonly<{
    readonly roomId: "FORCED_ALIGNMENT";
    readonly roomOrdinal: 0;
  }>;
  readonly candidateOrder: readonly CanonicalRunFirstContinuationRoomId[];
  readonly candidateWeights: readonly CanonicalRunFirstContinuationCandidateWeight[];
  readonly candidateTotalWeight: number;
  readonly rng: Readonly<{
    readonly algorithm: "mulberry32-v1";
    readonly seed: Readonly<{
      readonly domain: typeof RNG_DOMAIN;
      readonly value: number;
    }>;
    readonly drawOrdinal: 0;
    readonly drawValue: number;
    readonly stateAfterDrawUint32: number;
    readonly cursorInitial: number;
  }>;
  readonly selectionComplete: true;
  readonly selectionRngDraws: 1;
  readonly canonicalEventWrites: 0;
  readonly targetRoom: CanonicalRunFirstContinuationRoomId;
  readonly targetRoomOrdinal: 1;
  readonly roomCount: null;
  readonly difficulty: null;
  readonly transitionAllowed: false;
  readonly handoffReady: false;
}

declare const canonicalRunFirstContinuationRoomTargetBrand: unique symbol;
declare const canonicalRunFirstContinuationRoomTransitionReceiptBrand: unique symbol;

export type CanonicalRunFirstContinuationRoomTargetAvailable =
  CanonicalRunFirstContinuationRoomTargetPayload & {
    readonly [canonicalRunFirstContinuationRoomTargetBrand]: true;
  };

/**
 * Opaque, in-memory reservation for composing the formal EXT-012 target with
 * the EXT-013 transition start. Issuance does not consume the target.
 */
export type CanonicalRunFirstContinuationRoomTransitionReceipt = Readonly<{
  readonly [canonicalRunFirstContinuationRoomTransitionReceiptBrand]: true;
}>;

export interface CanonicalRunFirstContinuationRoomTargetMissing {
  readonly availability: "missing";
  readonly reason: "first-room-metric-projection-not-available";
  readonly selectionComplete: false;
  readonly selectionRngDraws: 0;
  readonly transitionAllowed: false;
  readonly handoffReady: false;
}

export type CanonicalRunFirstContinuationRoomTarget =
  | CanonicalRunFirstContinuationRoomTargetMissing
  | CanonicalRunFirstContinuationRoomTargetAvailable;

export const CANONICAL_RUN_FIRST_CONTINUATION_ROOM_TARGET_MISSING:
  CanonicalRunFirstContinuationRoomTargetMissing = Object.freeze({
  availability: "missing",
  reason: "first-room-metric-projection-not-available",
  selectionComplete: false,
  selectionRngDraws: 0,
  transitionAllowed: false,
  handoffReady: false,
});

type UnknownRecord = Record<string, unknown>;

interface RoomBiasDefinition {
  readonly roomId: CanonicalRunRoomId;
  readonly metricWeights: readonly Readonly<{
    readonly id: CanonicalRunFirstRoomMetricId;
    readonly authoredWeight: number;
  }>[];
}

interface SelectionCatalog {
  readonly rooms: readonly RoomBiasDefinition[];
}

interface ValidatedProjection {
  readonly selectedAtTick120: number;
  readonly rawRunSeed: number;
  readonly sourceBoundary: CanonicalRunFirstRoomMetricProjectionPayload["sourceBoundary"];
  readonly entries: ReadonlyMap<
    CanonicalRunFirstRoomMetricId,
    CanonicalRunFirstRoomMetricAvailableEntry | CanonicalRunFirstRoomMetricMissingEntry
  >;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`first continuation room target ${message}`);
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function plainDataRecord(value: unknown, path: string): UnknownRecord {
  invariant(typeof value === "object" && value !== null && !Array.isArray(value), `${path} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  invariant(prototype === Object.prototype || prototype === null, `${path} must be a plain object`);
  invariant(Object.getOwnPropertySymbols(value).length === 0, `${path} must not contain symbol keys`);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    invariant("value" in descriptor && descriptor.enumerable === true, `${path}.${key} must be an enumerable data field`);
  }
  return value as UnknownRecord;
}

function exactKeys(value: unknown, expected: readonly string[], path: string): UnknownRecord {
  const record = plainDataRecord(value, path);
  const actual = Object.keys(record).sort(compareCodePoints);
  const sortedExpected = [...expected].sort(compareCodePoints);
  invariant(
    actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]),
    `${path} must contain only its exact schema fields`,
  );
  return record;
}

function list(value: unknown, path: string): readonly unknown[] {
  invariant(Array.isArray(value), `${path} must be an array`);
  return value;
}

function text(value: unknown, path: string): string {
  invariant(typeof value === "string" && value.length > 0, `${path} must be a non-empty string`);
  return value;
}

function finite(value: unknown, path: string): number {
  invariant(
    typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0),
    `${path} must be finite and not negative zero`,
  );
  return value as number;
}

function safeNonNegativeInteger(value: unknown, path: string): number {
  const parsed = finite(value, path);
  invariant(Number.isSafeInteger(parsed) && parsed >= 0, `${path} must be a non-negative safe integer`);
  return parsed;
}

function safePositiveInteger(value: unknown, path: string): number {
  const parsed = safeNonNegativeInteger(value, path);
  invariant(parsed > 0, `${path} must be positive`);
  return parsed;
}

function uint32(value: unknown, path: string): number {
  const parsed = safeNonNegativeInteger(value, path);
  invariant(parsed <= UINT32_MAX, `${path} must be uint32`);
  return parsed;
}

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => deepFreeze(entry))) as T;
  }
  if (typeof value === "object" && value !== null) {
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) copy[key] = deepFreeze(entry);
    return Object.freeze(copy) as T;
  }
  return value;
}

function assertFrozenJsonData(
  value: unknown,
  path = "sourceProjection",
  active = new Set<object>(),
  verified = new Set<object>(),
): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    invariant(Number.isFinite(value) && !Object.is(value, -0), `${path} must contain finite JSON numbers`);
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
      `${path} must be a dense array without custom fields`,
    );
    value.forEach((entry, index) => assertFrozenJsonData(entry, `${path}[${index}]`, active, verified));
  } else {
    const record = plainDataRecord(value, path);
    for (const [key, entry] of Object.entries(record)) {
      assertFrozenJsonData(entry, `${path}.${key}`, active, verified);
    }
  }
  active.delete(object);
  verified.add(object);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function hasOwn(record: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function parseCatalog(): SelectionCatalog {
  const run = plainDataRecord(runDirectorJson, "run director manifest");
  invariant(run.schemaVersion === "4.0.0" && run.id === "director.run.v4", "run director identity drifted");
  const determinism = plainDataRecord(run.determinism, "run director manifest.determinism");
  invariant(
    determinism.seedAlgorithm === "mulberry32-v1" && determinism.sameSeedAndInputsSameTrace === true,
    "run director determinism contract drifted",
  );
  const sampling = plainDataRecord(run.roomSampling, "run director manifest.roomSampling");
  const roomOrder = list(sampling.rooms, "run director manifest.roomSampling.rooms")
    .map((entry, index) => text(entry, `run director manifest.roomSampling.rooms[${index}]`));
  invariant(
    sampling.algorithm === "weighted_without_replacement"
      && sampling.neverTreatAsProgression === true
      && sameStrings(roomOrder, EXPECTED_ROOM_ORDER),
    "run director room sampling contract drifted",
  );
  const mentalRoomPhase = list(run.phases, "run director manifest.phases")
    .map((entry, index) => plainDataRecord(entry, `run director manifest.phases[${index}]`))
    .find((phase) => phase.id === "mental_room_sampling");
  invariant(mentalRoomPhase !== undefined, "run director mental room phase is missing");
  const roomsSampled = list(mentalRoomPhase.roomsSampled, "mental room phase.roomsSampled")
    .map((entry, index) => safePositiveInteger(entry, `mental room phase.roomsSampled[${index}]`));
  invariant(
    sameStrings(roomsSampled.map(String), ["2", "4"])
      && mentalRoomPhase.selection === "seeded_by_behavior_ledger"
      && mentalRoomPhase.roomOrderRepeat === false,
    "run director continuation constraints drifted",
  );

  const manifest = plainDataRecord(roomComposersJson, "room composers manifest");
  invariant(manifest.schemaVersion === "4.0.0", "room composers schema drifted");
  const composers = list(manifest.composers, "room composers manifest.composers");
  invariant(composers.length === EXPECTED_ROOM_ORDER.length, "room composer cardinality drifted");
  const metricUniverse = new Set<string>();
  const rooms = composers.map((entry, index): RoomBiasDefinition => {
    const composer = plainDataRecord(entry, `room composers manifest.composers[${index}]`);
    invariant(
      composer.id === EXPECTED_COMPOSER_IDS[index]
        && composer.room === EXPECTED_ROOM_ORDER[index]
        && composer.algorithm === "seeded_weighted_without_replacement_with_behavior_bias",
      `room composer declaration ${index} drifted`,
    );
    const rawWeights = plainDataRecord(
      composer.behaviorMetricWeights,
      `room composers manifest.composers[${index}].behaviorMetricWeights`,
    );
    const unknownIds = Object.keys(rawWeights).filter(
      (id) => !(CANONICAL_RUN_FIRST_ROOM_METRIC_IDS as readonly string[]).includes(id),
    );
    invariant(unknownIds.length === 0, `room composer ${index} has unknown metric IDs`);
    const metricWeights = CANONICAL_RUN_FIRST_ROOM_METRIC_IDS
      .filter((id) => hasOwn(rawWeights, id))
      .map((id) => {
        const authoredWeight = finite(rawWeights[id], `room composer ${index} metric ${id}`);
        invariant(authoredWeight > 0, `room composer ${index} metric ${id} weight must be positive`);
        metricUniverse.add(id);
        return Object.freeze({id, authoredWeight});
      });
    invariant(metricWeights.length === Object.keys(rawWeights).length, `room composer ${index} metric order drifted`);
    return Object.freeze({
      roomId: EXPECTED_ROOM_ORDER[index] as CanonicalRunRoomId,
      metricWeights: Object.freeze(metricWeights),
    });
  });
  invariant(
    sameStrings([...metricUniverse].sort(compareCodePoints), CANONICAL_RUN_FIRST_ROOM_METRIC_IDS),
    "room composer metric universe drifted",
  );
  invariant(
    sameStrings(rooms.map((room) => room.roomId), roomOrder),
    "run director and composer room orders diverged",
  );
  return Object.freeze({rooms: Object.freeze(rooms)});
}

const CATALOG = parseCatalog();

function assertContentIdentity(
  value: unknown,
  path = "sourceProjection.contentIdentity",
): void {
  const identity = exactKeys(value, [
    "contentAuthoritySchemaVersion",
    "packageId",
    "packageSchemaVersion",
    "packageManifestSha256",
    "contentDigestSha256",
  ], path);
  for (const [key, expected] of Object.entries(V4_CONTENT_IDENTITY)) {
    invariant(identity[key] === expected, `${path} has drifted content identity at ${key}`);
  }
}

function validateSourceBoundary(
  value: unknown,
  rawRunSeed: number,
  capturedAtTick120: number,
): CanonicalRunFirstRoomMetricProjectionPayload["sourceBoundary"] {
  const boundary = exactKeys(value, [
    "preRoomTick120",
    "firstOccurrenceObservationTick120",
    "roomClosureTick120",
    "roomId",
    "roomOrdinal",
    "patternId",
    "occurrenceId",
    "encounterOrdinal",
    "resolvedSeed",
  ], "sourceProjection.sourceBoundary");
  const preRoomTick120 = safePositiveInteger(boundary.preRoomTick120, "source boundary preRoomTick120");
  const observationTick120 = safePositiveInteger(
    boundary.firstOccurrenceObservationTick120,
    "source boundary firstOccurrenceObservationTick120",
  );
  const closureTick120 = safePositiveInteger(boundary.roomClosureTick120, "source boundary roomClosureTick120");
  invariant(
    observationTick120 === preRoomTick120 + RUN_ROOM_SESSION_CONTRACT.relativeBoundaryTicks120.fixedSliceComplete
      && closureTick120 === preRoomTick120 + FIRST_FIXED_ROOM_CLOSURE_CONTRACT.closureRelativeTick120
      && observationTick120 + 1 === closureTick120
      && closureTick120 === capturedAtTick120,
    "source boundary is not the exact H/H+1701/H+1702 closure",
  );
  invariant(
    boundary.roomId === RUN_ROOM_SESSION_CONTRACT.roomId
      && boundary.roomOrdinal === RUN_ROOM_SESSION_CONTRACT.roomOrdinal
      && boundary.patternId === RUN_ROOM_SESSION_CONTRACT.patternId
      && boundary.occurrenceId === RUN_ROOM_SESSION_CONTRACT.occurrenceId
      && boundary.encounterOrdinal === RUN_ROOM_SESSION_CONTRACT.encounterOrdinal,
    "source boundary is not the completed fixed first room",
  );
  const resolvedSeed = exactKeys(boundary.resolvedSeed, ["domain", "value"], "source boundary resolvedSeed");
  const resolvedSeedValue = uint32(resolvedSeed.value, "source boundary resolvedSeed.value");
  const expectedResolvedSeed = (
    rawRunSeed
    ^ executablePattern(RUN_ROOM_SESSION_CONTRACT.patternId).seed.base
    ^ RUN_ROOM_SESSION_CONTRACT.encounterOrdinal
    ^ RUN_ROOM_SESSION_CONTRACT.difficultySalt
  ) >>> 0;
  invariant(
    resolvedSeed.domain === "resolved-occurrence-seed" && resolvedSeedValue === expectedResolvedSeed,
    "source boundary resolved seed provenance drifted",
  );
  return value as CanonicalRunFirstRoomMetricProjectionPayload["sourceBoundary"];
}

function validateAvailableEntry(
  entry: UnknownRecord,
  id: CanonicalRunFirstRoomMetricId,
): CanonicalRunFirstRoomMetricAvailableEntry {
  exactKeys(entry, [
    "id",
    "availability",
    "value",
    "unit",
    "formulaId",
    "numerator",
    "denominator",
    "sampleWindow",
  ], `sourceProjection.metricEntries.${id}`);
  invariant(entry.availability === "available" && entry.unit === "ratio-0-1", `${id} availability/unit drifted`);
  const contract = AVAILABLE_METRIC_CONTRACTS[id as keyof typeof AVAILABLE_METRIC_CONTRACTS];
  invariant(contract !== undefined, `${id} has no EXT-011 available-metric contract`);
  invariant(entry.formulaId === contract.formulaId, `${id}.formulaId drifted`);
  const value = finite(entry.value, `${id}.value`);
  invariant(value >= 0 && value <= 1, `${id}.value must be inside [0,1]`);
  const numerator = exactKeys(entry.numerator, ["sourcePath", "value"], `${id}.numerator`);
  const denominator = exactKeys(entry.denominator, ["sourcePath", "value"], `${id}.denominator`);
  invariant(numerator.sourcePath === contract.numeratorPath, `${id}.numerator.sourcePath drifted`);
  invariant(denominator.sourcePath === contract.denominatorPath, `${id}.denominator.sourcePath drifted`);
  const numeratorValue = finite(numerator.value, `${id}.numerator.value`);
  const denominatorValue = finite(denominator.value, `${id}.denominator.value`);
  invariant(
    numeratorValue >= 0 && denominatorValue > 0 && value === numeratorValue / denominatorValue,
    `${id} ratio provenance drifted`,
  );
  const sampleWindow = exactKeys(entry.sampleWindow, ["firstTick120", "lastTick120"], `${id}.sampleWindow`);
  const firstTick120 = safePositiveInteger(sampleWindow.firstTick120, `${id}.sampleWindow.firstTick120`);
  const lastTick120 = safePositiveInteger(sampleWindow.lastTick120, `${id}.sampleWindow.lastTick120`);
  invariant(firstTick120 <= lastTick120, `${id} sample window is reversed`);
  return entry as unknown as CanonicalRunFirstRoomMetricAvailableEntry;
}

function validateMissingEntry(
  entry: UnknownRecord,
  id: CanonicalRunFirstRoomMetricId,
): CanonicalRunFirstRoomMetricMissingEntry {
  exactKeys(entry, ["id", "availability", "reason"], `sourceProjection.metricEntries.${id}`);
  invariant(entry.availability === "missing", `${id} must remain typed missing`);
  text(entry.reason, `${id}.reason`);
  return entry as unknown as CanonicalRunFirstRoomMetricMissingEntry;
}

function validateProjection(value: CanonicalRunFirstRoomMetricProjectionPayload): ValidatedProjection {
  assertFrozenJsonData(value);
  const projection = exactKeys(value, [
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
    "projectionStatus",
    "availableMetricCount",
    "missingMetricCount",
    "metricEntries",
    "ready",
    "selectionAllowed",
    "selectionRngDraws",
    "canonicalEventWrites",
    "targetRoom",
    "transitionAllowed",
  ], "sourceProjection");
  invariant(
    projection.availability === "available"
      && projection.authority === "canonical-run-first-room-metric-projection-v1"
      && projection.schemaVersion === "1.1.0-ext-2026-011"
      && projection.producerId === "canonical-run-session.first-room-metric-projector"
      && projection.producerVersion === "1.1.0"
      && projection.extensionPolicy === "EXT-2026-011"
      && projection.sourceEpoch === "current-run-through-first-room-closure"
      && projection.projectionStatus === "partial",
    "source projection identity drifted",
  );
  invariant(
    projection.availableMetricCount === 3
      && projection.missingMetricCount === 11
      && projection.ready === false
      && projection.selectionAllowed === false
      && projection.selectionRngDraws === 0
      && projection.canonicalEventWrites === 0
      && projection.targetRoom === null
      && projection.transitionAllowed === false,
    "source projection firewall drifted",
  );
  const selectedAtTick120 = safePositiveInteger(projection.capturedAtTick120, "source projection capturedAtTick120");
  const rawRunSeedRecord = exactKeys(projection.rawRunSeed, ["domain", "value"], "sourceProjection.rawRunSeed");
  const rawRunSeed = uint32(rawRunSeedRecord.value, "sourceProjection.rawRunSeed.value");
  invariant(rawRunSeedRecord.domain === "raw-run-seed", "source projection raw seed domain drifted");
  assertContentIdentity(projection.contentIdentity);
  const sourceBoundary = validateSourceBoundary(projection.sourceBoundary, rawRunSeed, selectedAtTick120);

  const rawEntries = list(projection.metricEntries, "sourceProjection.metricEntries");
  invariant(rawEntries.length === CANONICAL_RUN_FIRST_ROOM_METRIC_IDS.length, "metric cardinality drifted");
  const entries = new Map<
    CanonicalRunFirstRoomMetricId,
    CanonicalRunFirstRoomMetricAvailableEntry | CanonicalRunFirstRoomMetricMissingEntry
  >();
  let availableCount = 0;
  let missingCount = 0;
  rawEntries.forEach((rawEntry, index) => {
    const expectedId = CANONICAL_RUN_FIRST_ROOM_METRIC_IDS[index];
    invariant(expectedId !== undefined, `metric entry ${index} has no expected ID`);
    const entry = plainDataRecord(rawEntry, `sourceProjection.metricEntries[${index}]`);
    invariant(entry.id === expectedId, `metric entry ${index} order/ID drifted`);
    if (entry.availability === "available") {
      invariant(EXPECTED_AVAILABLE_METRIC_IDS.has(expectedId), `${expectedId} became unexpectedly available`);
      entries.set(expectedId, validateAvailableEntry(entry, expectedId));
      availableCount += 1;
    } else {
      invariant(!EXPECTED_AVAILABLE_METRIC_IDS.has(expectedId), `${expectedId} unexpectedly became missing`);
      entries.set(expectedId, validateMissingEntry(entry, expectedId));
      missingCount += 1;
    }
  });
  invariant(availableCount === 3 && missingCount === 11, "metric availability cardinality drifted");
  return Object.freeze({selectedAtTick120, rawRunSeed, sourceBoundary, entries});
}

function firstMulberry32Draw(seed: number): Readonly<{
  readonly value: number;
  readonly stateAfterDrawUint32: number;
}> {
  const stateAfterDrawUint32 = (seed + MULBERRY32_INCREMENT) >>> 0;
  let value = stateAfterDrawUint32;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return Object.freeze({
    value: ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296,
    stateAfterDrawUint32,
  });
}

function candidateWeight(
  definition: RoomBiasDefinition,
  entries: ValidatedProjection["entries"],
): CanonicalRunFirstContinuationCandidateWeight {
  invariant(
    (EXPECTED_REMAINING_ROOM_ORDER as readonly string[]).includes(definition.roomId),
    `completed room ${definition.roomId} re-entered remaining candidates`,
  );
  const metricTerms = definition.metricWeights.map(({id, authoredWeight}): CanonicalRunFirstContinuationMetricTerm => {
    const entry = entries.get(id);
    invariant(entry !== undefined, `projection lost metric ${id}`);
    if (entry.availability === "missing") {
      return Object.freeze({
        id,
        availability: "missing" as const,
        reason: entry.reason,
        authoredWeight,
      });
    }
    const contribution = entry.value * authoredWeight;
    invariant(Number.isFinite(contribution) && contribution >= 0, `${id} contribution is invalid`);
    return Object.freeze({
      id,
      availability: "available" as const,
      value: entry.value,
      authoredWeight,
      contribution,
    });
  });
  let behaviorBias = 0;
  for (const term of metricTerms) {
    if (term.availability === "available") behaviorBias += term.contribution;
  }
  invariant(Number.isFinite(behaviorBias) && behaviorBias >= 0, `${definition.roomId} behavior bias is invalid`);
  const totalWeight = 1 + behaviorBias;
  invariant(Number.isFinite(totalWeight) && totalWeight >= 1, `${definition.roomId} total weight is invalid`);
  return Object.freeze({
    roomId: definition.roomId as CanonicalRunFirstContinuationRoomId,
    baseWeight: 1 as const,
    metricTerms: Object.freeze(metricTerms),
    totalWeight,
  });
}

/**
 * Exact frozen-fixture core. It cannot mint the formal target brand and is not
 * a production admission path.
 */
export function deriveCanonicalRunFirstContinuationRoomTargetUnbranded(
  sourceProjection: CanonicalRunFirstRoomMetricProjectionPayload,
): CanonicalRunFirstContinuationRoomTargetPayload {
  const source = validateProjection(sourceProjection);
  const remaining = CATALOG.rooms.filter((room) => room.roomId !== RUN_ROOM_SESSION_CONTRACT.roomId);
  invariant(
    sameStrings(remaining.map((room) => room.roomId), EXPECTED_REMAINING_ROOM_ORDER),
    "remaining candidate order drifted",
  );
  const candidateWeights = Object.freeze(remaining.map((room) => candidateWeight(room, source.entries)));
  let candidateTotalWeight = 0;
  for (const candidate of candidateWeights) candidateTotalWeight += candidate.totalWeight;
  invariant(Number.isFinite(candidateTotalWeight) && candidateTotalWeight >= candidateWeights.length, "candidate total is invalid");

  const draw = firstMulberry32Draw(source.rawRunSeed);
  const cursorInitial = draw.value * candidateTotalWeight;
  const selectedIndex = selectWeightedCandidateIndex(candidateWeights, cursorInitial);
  const selected = candidateWeights[selectedIndex];
  invariant(selected !== undefined, "weighted selection lost its target");

  return deepFreeze({
    availability: "available" as const,
    authority: AUTHORITY,
    schemaVersion: SCHEMA_VERSION,
    producerId: PRODUCER_ID,
    producerVersion: PRODUCER_VERSION,
    extensionPolicy: "EXT-2026-012" as const,
    sourceEpoch: "current-run-through-first-room-closure" as const,
    selectedAtTick120: source.selectedAtTick120,
    rawRunSeed: {domain: "raw-run-seed" as const, value: source.rawRunSeed},
    contentIdentity: V4_CONTENT_IDENTITY,
    sourceBoundary: {
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
    },
    sourceProjection: {
      authority: "canonical-run-first-room-metric-projection-v1" as const,
      schemaVersion: "1.1.0-ext-2026-011" as const,
      extensionPolicy: "EXT-2026-011" as const,
      availableMetricCount: 3 as const,
      missingMetricCount: 11 as const,
    },
    completedRoomVisit: {roomId: "FORCED_ALIGNMENT" as const, roomOrdinal: 0 as const},
    candidateOrder: EXPECTED_REMAINING_ROOM_ORDER,
    candidateWeights,
    candidateTotalWeight,
    rng: {
      algorithm: "mulberry32-v1" as const,
      seed: {domain: RNG_DOMAIN, value: source.rawRunSeed},
      drawOrdinal: 0 as const,
      drawValue: draw.value,
      stateAfterDrawUint32: draw.stateAfterDrawUint32,
      cursorInitial,
    },
    selectionComplete: true as const,
    selectionRngDraws: 1 as const,
    canonicalEventWrites: 0 as const,
    targetRoom: selected.roomId,
    targetRoomOrdinal: 1 as const,
    roomCount: null,
    difficulty: null,
    transitionAllowed: false as const,
    handoffReady: false as const,
  });
}

function selectWeightedCandidateIndex(
  candidateWeights: readonly Pick<CanonicalRunFirstContinuationCandidateWeight, "totalWeight">[],
  cursorInitial: number,
): number {
  invariant(candidateWeights.length > 0, "weighted selection requires at least one candidate");
  invariant(Number.isFinite(cursorInitial) && cursorInitial >= 0, "weighted selection cursor is invalid");
  let cursor = cursorInitial;
  let selectedIndex = candidateWeights.length - 1;
  for (let index = 0; index < candidateWeights.length; index += 1) {
    const candidate = candidateWeights[index];
    invariant(candidate !== undefined, `candidate ${index} disappeared`);
    cursor -= candidate.totalWeight;
    if (cursor <= 0) {
      selectedIndex = index;
      break;
    }
  }
  return selectedIndex;
}

const consumedFormalProjections = new WeakSet<object>();
interface FormalTargetLineage {
  readonly runCombatOwner: object;
}

const formalTargetLineages = new WeakMap<object, FormalTargetLineage>();

type TransitionReceiptStatus = "prepared" | "cancelled" | "committed" | "quarantined";

interface TransitionReceiptState {
  readonly target: CanonicalRunFirstContinuationRoomTargetAvailable;
  readonly runCombatOwner: object;
  status: TransitionReceiptStatus;
}

const transitionReceiptStates = new WeakMap<
  CanonicalRunFirstContinuationRoomTransitionReceipt,
  TransitionReceiptState
>();
const activeTransitionReceiptsByTarget = new WeakMap<
  object,
  CanonicalRunFirstContinuationRoomTransitionReceipt
>();
const consumedFormalTargets = new WeakSet<object>();
const quarantinedFormalTargets = new WeakSet<object>();

function assertFormalTargetTransitionContract(
  target: CanonicalRunFirstContinuationRoomTargetAvailable,
): void {
  invariant(
    typeof target === "object" && target !== null && formalTargetLineages.has(target),
    "transition receipt requires the original formal target",
  );
  assertFrozenJsonData(target, "formalTarget");
  const formalTarget = exactKeys(target, [
    "availability",
    "authority",
    "schemaVersion",
    "producerId",
    "producerVersion",
    "extensionPolicy",
    "sourceEpoch",
    "selectedAtTick120",
    "rawRunSeed",
    "contentIdentity",
    "sourceBoundary",
    "sourceProjection",
    "completedRoomVisit",
    "candidateOrder",
    "candidateWeights",
    "candidateTotalWeight",
    "rng",
    "selectionComplete",
    "selectionRngDraws",
    "canonicalEventWrites",
    "targetRoom",
    "targetRoomOrdinal",
    "roomCount",
    "difficulty",
    "transitionAllowed",
    "handoffReady",
  ], "formalTarget");
  invariant(
    formalTarget.availability === "available"
      && formalTarget.authority === AUTHORITY
      && formalTarget.schemaVersion === SCHEMA_VERSION
      && formalTarget.producerId === PRODUCER_ID
      && formalTarget.producerVersion === PRODUCER_VERSION
      && formalTarget.extensionPolicy === "EXT-2026-012"
      && formalTarget.sourceEpoch === "current-run-through-first-room-closure",
    "formal target identity drifted",
  );
  invariant(
    formalTarget.selectionComplete === true
      && formalTarget.selectionRngDraws === 1
      && formalTarget.canonicalEventWrites === 0
      && formalTarget.targetRoomOrdinal === 1
      && formalTarget.roomCount === null
      && formalTarget.difficulty === null
      && formalTarget.transitionAllowed === false
      && formalTarget.handoffReady === false,
    "formal target selection firewall drifted",
  );

  const selectedAtTick120 = safePositiveInteger(
    formalTarget.selectedAtTick120,
    "formalTarget.selectedAtTick120",
  );
  const rawRunSeedRecord = exactKeys(formalTarget.rawRunSeed, ["domain", "value"], "formalTarget.rawRunSeed");
  const rawRunSeed = uint32(rawRunSeedRecord.value, "formalTarget.rawRunSeed.value");
  invariant(rawRunSeedRecord.domain === "raw-run-seed", "formal target raw seed domain drifted");
  assertContentIdentity(formalTarget.contentIdentity, "formalTarget.contentIdentity");
  const sourceBoundary = validateSourceBoundary(
    formalTarget.sourceBoundary,
    rawRunSeed,
    selectedAtTick120,
  );
  invariant(
    sourceBoundary.roomClosureTick120 === selectedAtTick120,
    "formal target selection tick drifted from the exact closure",
  );

  const sourceProjection = exactKeys(formalTarget.sourceProjection, [
    "authority",
    "schemaVersion",
    "extensionPolicy",
    "availableMetricCount",
    "missingMetricCount",
  ], "formalTarget.sourceProjection");
  invariant(
    sourceProjection.authority === "canonical-run-first-room-metric-projection-v1"
      && sourceProjection.schemaVersion === "1.1.0-ext-2026-011"
      && sourceProjection.extensionPolicy === "EXT-2026-011"
      && sourceProjection.availableMetricCount === 3
      && sourceProjection.missingMetricCount === 11,
    "formal target source projection drifted",
  );
  const completedRoomVisit = exactKeys(
    formalTarget.completedRoomVisit,
    ["roomId", "roomOrdinal"],
    "formalTarget.completedRoomVisit",
  );
  invariant(
    completedRoomVisit.roomId === "FORCED_ALIGNMENT" && completedRoomVisit.roomOrdinal === 0,
    "formal target completed room drifted",
  );

  const candidateOrder = list(formalTarget.candidateOrder, "formalTarget.candidateOrder")
    .map((entry, index) => text(entry, `formalTarget.candidateOrder[${index}]`));
  invariant(
    sameStrings(candidateOrder, EXPECTED_REMAINING_ROOM_ORDER),
    "formal target candidate order drifted",
  );
  const candidateWeights = list(formalTarget.candidateWeights, "formalTarget.candidateWeights");
  invariant(
    candidateWeights.length === EXPECTED_REMAINING_ROOM_ORDER.length,
    "formal target candidate cardinality drifted",
  );
  let candidateTotalWeight = 0;
  candidateWeights.forEach((candidateValue, candidateIndex) => {
    const expectedRoomId = EXPECTED_REMAINING_ROOM_ORDER[candidateIndex];
    const definition = CATALOG.rooms.find((room) => room.roomId === expectedRoomId);
    invariant(definition !== undefined, `formal target candidate ${candidateIndex} lost its composer`);
    const candidate = exactKeys(candidateValue, [
      "roomId",
      "baseWeight",
      "metricTerms",
      "totalWeight",
    ], `formalTarget.candidateWeights[${candidateIndex}]`);
    invariant(
      candidate.roomId === expectedRoomId && candidate.baseWeight === 1,
      `formal target candidate ${candidateIndex} identity drifted`,
    );
    const metricTerms = list(candidate.metricTerms, `formalTarget.candidateWeights[${candidateIndex}].metricTerms`);
    invariant(
      metricTerms.length === definition.metricWeights.length,
      `formal target candidate ${candidateIndex} metric cardinality drifted`,
    );
    let behaviorBias = 0;
    metricTerms.forEach((termValue, termIndex) => {
      const expectedMetric = definition.metricWeights[termIndex];
      invariant(expectedMetric !== undefined, `formal target metric ${candidateIndex}:${termIndex} lost its contract`);
      const termBase = plainDataRecord(
        termValue,
        `formalTarget.candidateWeights[${candidateIndex}].metricTerms[${termIndex}]`,
      );
      invariant(termBase.id === expectedMetric.id, `formal target metric ${candidateIndex}:${termIndex} ID drifted`);
      if (termBase.availability === "available") {
        const term = exactKeys(termBase, [
          "id",
          "availability",
          "value",
          "authoredWeight",
          "contribution",
        ], `formalTarget.candidateWeights[${candidateIndex}].metricTerms[${termIndex}]`);
        const value = finite(term.value, `formal target metric ${candidateIndex}:${termIndex} value`);
        const authoredWeight = finite(
          term.authoredWeight,
          `formal target metric ${candidateIndex}:${termIndex} authoredWeight`,
        );
        const contribution = finite(
          term.contribution,
          `formal target metric ${candidateIndex}:${termIndex} contribution`,
        );
        invariant(value >= 0 && value <= 1, `formal target metric ${candidateIndex}:${termIndex} left [0,1]`);
        invariant(
          authoredWeight === expectedMetric.authoredWeight && contribution === value * authoredWeight,
          `formal target metric ${candidateIndex}:${termIndex} contribution drifted`,
        );
        behaviorBias += contribution;
      } else {
        const term = exactKeys(termBase, [
          "id",
          "availability",
          "reason",
          "authoredWeight",
        ], `formalTarget.candidateWeights[${candidateIndex}].metricTerms[${termIndex}]`);
        invariant(term.availability === "missing", `formal target metric ${candidateIndex}:${termIndex} availability drifted`);
        text(term.reason, `formal target metric ${candidateIndex}:${termIndex} reason`);
        invariant(
          finite(term.authoredWeight, `formal target metric ${candidateIndex}:${termIndex} authoredWeight`)
            === expectedMetric.authoredWeight,
          `formal target metric ${candidateIndex}:${termIndex} authored weight drifted`,
        );
      }
    });
    const totalWeight = finite(candidate.totalWeight, `formal target candidate ${candidateIndex} totalWeight`);
    invariant(totalWeight === 1 + behaviorBias, `formal target candidate ${candidateIndex} total weight drifted`);
    candidateTotalWeight += totalWeight;
  });
  invariant(
    finite(formalTarget.candidateTotalWeight, "formalTarget.candidateTotalWeight") === candidateTotalWeight,
    "formal target candidate total drifted",
  );

  const rng = exactKeys(formalTarget.rng, [
    "algorithm",
    "seed",
    "drawOrdinal",
    "drawValue",
    "stateAfterDrawUint32",
    "cursorInitial",
  ], "formalTarget.rng");
  const rngSeed = exactKeys(rng.seed, ["domain", "value"], "formalTarget.rng.seed");
  const draw = firstMulberry32Draw(rawRunSeed);
  invariant(
    rng.algorithm === "mulberry32-v1"
      && rngSeed.domain === RNG_DOMAIN
      && uint32(rngSeed.value, "formalTarget.rng.seed.value") === rawRunSeed
      && rng.drawOrdinal === 0
      && finite(rng.drawValue, "formalTarget.rng.drawValue") === draw.value
      && uint32(rng.stateAfterDrawUint32, "formalTarget.rng.stateAfterDrawUint32")
        === draw.stateAfterDrawUint32,
    "formal target RNG evidence drifted",
  );
  const cursorInitial = draw.value * candidateTotalWeight;
  invariant(
    finite(rng.cursorInitial, "formalTarget.rng.cursorInitial") === cursorInitial,
    "formal target RNG cursor drifted",
  );
  const selectedRoom = EXPECTED_REMAINING_ROOM_ORDER[
    selectWeightedCandidateIndex(
      candidateWeights as readonly CanonicalRunFirstContinuationCandidateWeight[],
      cursorInitial,
    )
  ];
  invariant(
    (EXPECTED_REMAINING_ROOM_ORDER as readonly unknown[]).includes(formalTarget.targetRoom)
      && formalTarget.targetRoom === selectedRoom,
    "formal target selected room drifted from RNG evidence",
  );
}

function requireActiveTransitionReceipt(
  receipt: CanonicalRunFirstContinuationRoomTransitionReceipt,
): TransitionReceiptState {
  invariant(
    typeof receipt === "object" && receipt !== null,
    "transition receipt must be opaque",
  );
  const state = transitionReceiptStates.get(receipt);
  invariant(state !== undefined, "transition receipt is not registered");
  invariant(state.status === "prepared", `transition receipt already ${state.status}`);
  invariant(
    activeTransitionReceiptsByTarget.get(state.target) === receipt,
    "transition receipt reservation drifted",
  );
  invariant(!consumedFormalTargets.has(state.target), "formal target transition already committed");
  invariant(!quarantinedFormalTargets.has(state.target), "formal target transition is quarantined");
  assertFormalTargetTransitionContract(state.target);
  return state;
}

/** Formal EXT-012 entry point. Each formal projection can select only once. */
export function createCanonicalRunFirstContinuationRoomTarget(
  sourceReceipt: CanonicalRunFirstRoomMetricProjectionReceipt,
  runCombatOwner: object,
): CanonicalRunFirstContinuationRoomTargetAvailable {
  const projection = firstRoomMetricProjectionFromCanonicalReceipt(sourceReceipt);
  invariant(!consumedFormalProjections.has(projection), "formal projection already selected a continuation target");
  invariant(
    typeof runCombatOwner === "object" && runCombatOwner !== null,
    "formal continuation target requires its exact Run combat owner",
  );
  const payload = deriveCanonicalRunFirstContinuationRoomTargetUnbranded(projection);
  consumedFormalProjections.add(projection);
  formalTargetLineages.set(payload, Object.freeze({runCombatOwner}));
  return payload as CanonicalRunFirstContinuationRoomTargetAvailable;
}

/**
 * Reserve the exact original formal target for one EXT-013 prepared composite.
 * A second in-flight proposal for the same target is rejected rather than
 * aliased. The target remains unconsumed until the coordinator commits.
 */
export function issueCanonicalRunFirstContinuationRoomTransitionReceipt(
  target: CanonicalRunFirstContinuationRoomTargetAvailable,
): CanonicalRunFirstContinuationRoomTransitionReceipt {
  assertFormalTargetTransitionContract(target);
  const lineage = formalTargetLineages.get(target);
  invariant(lineage !== undefined, "formal target lost its Run combat lineage");
  invariant(!consumedFormalTargets.has(target), "formal target transition already committed");
  invariant(!quarantinedFormalTargets.has(target), "formal target transition is quarantined");
  invariant(
    !activeTransitionReceiptsByTarget.has(target),
    "formal target already has an in-flight transition receipt",
  );
  const receipt = Object.freeze({}) as CanonicalRunFirstContinuationRoomTransitionReceipt;
  transitionReceiptStates.set(receipt, {
    target,
    runCombatOwner: lineage.runCombatOwner,
    status: "prepared",
  });
  activeTransitionReceiptsByTarget.set(target, receipt);
  return receipt;
}

/** Verify that the receipt still belongs to the exact Run combat authority that selected it. */
export function assertCanonicalRunFirstContinuationRoomTransitionReceiptOwner(
  receipt: CanonicalRunFirstContinuationRoomTransitionReceipt,
  runCombatOwner: object,
): void {
  const state = requireActiveTransitionReceipt(receipt);
  invariant(
    state.runCombatOwner === runCombatOwner,
    "transition receipt belongs to a different Run combat authority",
  );
}

/** Resolve the exact formal target while revalidating the active reservation. */
export function firstContinuationRoomTargetFromCanonicalTransitionReceipt(
  receipt: CanonicalRunFirstContinuationRoomTransitionReceipt,
): CanonicalRunFirstContinuationRoomTargetAvailable {
  return requireActiveTransitionReceipt(receipt).target;
}

/** Consume the target only after the prepared authoritative start applied. */
export function commitCanonicalRunFirstContinuationRoomTransitionReceipt(
  receipt: CanonicalRunFirstContinuationRoomTransitionReceipt,
): CanonicalRunFirstContinuationRoomTargetAvailable {
  const state = requireActiveTransitionReceipt(receipt);
  consumedFormalTargets.add(state.target);
  state.status = "committed";
  activeTransitionReceiptsByTarget.delete(state.target);
  return state.target;
}

/**
 * Release a proposal that failed before authoritative append/apply. The same
 * formal target may then be reserved by a new coordinator attempt.
 */
export function cancelCanonicalRunFirstContinuationRoomTransitionReceipt(
  receipt: CanonicalRunFirstContinuationRoomTransitionReceipt,
): void {
  const state = requireActiveTransitionReceipt(receipt);
  state.status = "cancelled";
  activeTransitionReceiptsByTarget.delete(state.target);
}

/**
 * Permanently reject retry after an impossible post-append invariant failure.
 * The owning Run is expected to fail-stop as well.
 */
export function quarantineCanonicalRunFirstContinuationRoomTransitionReceipt(
  receipt: CanonicalRunFirstContinuationRoomTransitionReceipt,
): void {
  const state = requireActiveTransitionReceipt(receipt);
  quarantinedFormalTargets.add(state.target);
  state.status = "quarantined";
  activeTransitionReceiptsByTarget.delete(state.target);
}
