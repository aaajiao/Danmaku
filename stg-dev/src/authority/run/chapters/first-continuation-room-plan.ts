import {V4_CONTENT_IDENTITY, type V4ContentIdentity} from "../../../content/v4-content-identity";
import {SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS} from "../../combat-pattern-capabilities";
import type {CanonicalRunFirstContinuationRoomId} from "../../run-first-continuation-room-target";
import {
  canonicalRunFirstContinuationRoomPlanCatalogComposer,
  canonicalRunFirstContinuationRoomPlanCatalogPoolBudgets,
  canonicalRunFirstContinuationRoomPlanCatalogPreviousStructuralSignatureSha256,
  canonicalRunFirstContinuationRoomPlanCatalogProjectilePoolClassOrder,
  canonicalRunFirstContinuationRoomPlanCatalogResidueVisualOnlyBudget,
  canonicalRunFirstContinuationRoomPlanCatalogTargetRoomOrder,
  type CanonicalRunFirstContinuationRoomPlanCatalogDifficulty,
  type CanonicalRunFirstContinuationRoomPlanCatalogProjectilePoolClass,
  type CanonicalRunFirstContinuationRoomPlanCatalogTierId,
} from "./first-continuation-room-plan-catalog";

const UINT32_MAX = 0xffff_ffff;
const MULBERRY32_INCREMENT = 0x6d2b_79f5;
const DIFFICULTY_SALT = 0x2200;
const SOURCE_AUTHORITY = "canonical-run-first-continuation-room-plan-source-v1" as const;
const AUTHORITY = "canonical-run-first-continuation-room-plan-v1" as const;
const SCHEMA_VERSION = "1.0.0-ext-2026-015" as const;
const EXTENSION_POLICY = "EXT-2026-015" as const;
const TARGET_RNG_DOMAIN = "ext-012-first-continuation-room-selection" as const;
const PREVIOUS_PATTERN_ID = "room.forced.left_right_gate" as const;
const MATERIAL_PATTERN_ID = "transition.room_threshold" as const;
const MATERIAL_OCCURRENCE_ID =
  "run:room:0-to-1:transition:transition.room_threshold" as const;
const WITHHELD_ADMISSION =
  "withheld-pending-room-plan-and-combined-pool-budget" as const;

const TARGET_ROOM_ORDER = canonicalRunFirstContinuationRoomPlanCatalogTargetRoomOrder();
const PROJECTILE_POOL_CLASS_ORDER =
  canonicalRunFirstContinuationRoomPlanCatalogProjectilePoolClassOrder();
const PROJECTILE_POOL_BUDGETS = canonicalRunFirstContinuationRoomPlanCatalogPoolBudgets();
const RESIDUE_VISUAL_ONLY_BUDGET =
  canonicalRunFirstContinuationRoomPlanCatalogResidueVisualOnlyBudget();
const PREVIOUS_STRUCTURAL_SIGNATURE_SHA256 =
  canonicalRunFirstContinuationRoomPlanCatalogPreviousStructuralSignatureSha256();

export type CanonicalRunFirstContinuationRoomPlanTierId =
  CanonicalRunFirstContinuationRoomPlanCatalogTierId;
export type CanonicalRunFirstContinuationRoomPlanDifficulty =
  CanonicalRunFirstContinuationRoomPlanCatalogDifficulty;
export type CanonicalRunFirstContinuationRoomPlanProjectilePoolClass =
  CanonicalRunFirstContinuationRoomPlanCatalogProjectilePoolClass;

export interface CanonicalRunFirstContinuationRoomPlanSourceView {
  readonly authority: typeof SOURCE_AUTHORITY;
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly extensionPolicy: typeof EXTENSION_POLICY;
  readonly contentIdentity: V4ContentIdentity;
  readonly target: Readonly<{
    readonly authority: "canonical-run-first-continuation-room-target-v1";
    readonly extensionPolicy: "EXT-2026-012";
    readonly roomId: CanonicalRunFirstContinuationRoomId;
    readonly roomOrdinal: 1;
  }>;
  readonly rawRunSeed: Readonly<{
    readonly domain: "raw-run-seed";
    readonly value: number;
  }>;
  readonly targetSelectionRng: Readonly<{
    readonly algorithm: "mulberry32-v1";
    readonly domain: typeof TARGET_RNG_DOMAIN;
    readonly drawOrdinal: 0;
    readonly drawValue: number;
    readonly stateAfterDrawUint32: number;
    readonly selectionRngDraws: 1;
  }>;
  readonly handoff: Readonly<{
    readonly authority: "canonical-run-first-continuation-room-handoff-v1";
    readonly extensionPolicy: "EXT-2026-013";
    readonly targetRoom: CanonicalRunFirstContinuationRoomId;
    readonly atTick120: number;
    readonly nextRoomAdmission: typeof WITHHELD_ADMISSION;
  }>;
  readonly intensityMetrics: Readonly<{
    readonly avgFlower: Readonly<{
      readonly availability: "available";
      readonly value: number;
      readonly unit: "ratio-0-1";
    }>;
    readonly gazeRatio: Readonly<{
      readonly availability: "available";
      readonly value: number;
      readonly unit: "ratio-0-1";
    }>;
    readonly overrideRatio: Readonly<{
      readonly availability: "missing";
      readonly reason: "override-not-eligible-in-source-window";
    }>;
  }>;
  readonly priorEncounter: Readonly<{
    readonly roomId: "FORCED_ALIGNMENT";
    readonly roomOrdinal: 0;
    readonly encounterOrdinal: 0;
    readonly patternId: typeof PREVIOUS_PATTERN_ID;
  }>;
  readonly materialPoolSummary: Readonly<{
    readonly authority: "room-threshold-material-carryover-v1";
    readonly sourcePatternId: typeof MATERIAL_PATTERN_ID;
    readonly sourceOccurrenceId: typeof MATERIAL_OCCURRENCE_ID;
    readonly detachedAtTick120: number;
    readonly observedAtTick120: number;
    readonly materialCount: number;
    readonly drained: boolean;
    readonly activeSlots: Readonly<Record<CanonicalRunFirstContinuationRoomPlanProjectilePoolClass, number>>;
    readonly allocatedSlots: Readonly<Record<CanonicalRunFirstContinuationRoomPlanProjectilePoolClass, number>>;
    readonly liveColliders: 0;
    readonly residueVisuals: number;
  }>;
}

export interface CanonicalRunFirstContinuationRoomPlanCandidate {
  readonly patternId: string;
  readonly baseWeight: number;
  readonly structuralSignatureSha256: string;
  readonly sameAsPreviousStructuralSignature: boolean;
  readonly structuralSignaturePenalty: 0.15 | 1;
  readonly effectiveWeight: number;
}

export interface CanonicalRunFirstContinuationRoomPlanPayload {
  readonly availability: "available";
  readonly authority: typeof AUTHORITY;
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly extensionPolicy: typeof EXTENSION_POLICY;
  readonly contentIdentity: V4ContentIdentity;
  readonly plannedAtTick120: number;
  readonly targetRoom: CanonicalRunFirstContinuationRoomId;
  readonly roomOrdinal: 1;
  readonly intensity: Readonly<{
    readonly formula: "clamp01((avgFlower + gazeRatio + overrideRatio) / 2)";
    readonly avgFlower: number;
    readonly gazeRatio: number;
    readonly overrideRatio: Readonly<{
      readonly sourceAvailability: "missing";
      readonly missingReason: "override-not-eligible-in-source-window";
      readonly policy: "authored-fallback-not-observed";
      readonly value: 0;
    }>;
    readonly score: number;
    readonly tierId: CanonicalRunFirstContinuationRoomPlanTierId;
    readonly difficulty: CanonicalRunFirstContinuationRoomPlanDifficulty;
    readonly budget: Readonly<{
      readonly maxProjectiles: number;
      readonly maxEmitters: number;
      readonly restMs: number;
    }>;
  }>;
  readonly selection: Readonly<{
    readonly algorithm: "seeded-weighted-with-immediate-structural-signature-penalty";
    readonly previousPatternId: typeof PREVIOUS_PATTERN_ID;
    readonly previousStructuralSignatureSha256: string;
    readonly candidateOrder: readonly string[];
    readonly candidates: readonly CanonicalRunFirstContinuationRoomPlanCandidate[];
    readonly candidateTotalWeight: number;
    readonly rng: Readonly<{
      readonly algorithm: "mulberry32-v1";
      readonly domain: typeof TARGET_RNG_DOMAIN;
      readonly continuedFromStateAfterDrawUint32: number;
      readonly drawOrdinal: 1;
      readonly drawValue: number;
      readonly stateAfterDrawUint32: number;
      readonly cursorInitial: number;
      readonly selectionRngDrawsTotal: 2;
    }>;
    readonly selectedPatternId: string;
    readonly rerollCount: 0;
    readonly capabilityFilteringApplied: false;
  }>;
  readonly occurrence: Readonly<{
    readonly occurrenceId: string;
    readonly patternId: string;
    readonly roomId: CanonicalRunFirstContinuationRoomId;
    readonly roomOrdinal: 1;
    readonly encounterOrdinal: 0;
    readonly difficulty: CanonicalRunFirstContinuationRoomPlanDifficulty;
    readonly difficultySalt: typeof DIFFICULTY_SALT;
    readonly resolvedSeed: Readonly<{
      readonly domain: "resolved-occurrence-seed";
      readonly composition: "rawRunSeed xor pattern.base xor encounterOrdinal xor difficultySalt";
      readonly value: number;
    }>;
    readonly segmentsMs: Readonly<{
      readonly telegraph: 520;
      readonly entry: 800;
      readonly read: number;
      readonly materialSettle: 900;
      readonly rest: number;
      readonly safeGapHandoff: 520;
    }>;
    readonly parallel: Readonly<{
      readonly mode: "none";
      readonly patternId: null;
    }>;
  }>;
  readonly patternCapability: Readonly<{
    readonly patternId: string;
    readonly source: "SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS";
    readonly status: "supported" | "unsupported";
  }>;
  readonly poolReservationRequest: Readonly<{
    readonly state:
      | "withheld-pending-combined-pool-admission"
      | "withheld-missing-split-child-upper-bound"
      | "withheld-unsupported-pattern-capability";
    readonly carryover: CanonicalRunFirstContinuationRoomPlanSourceView["materialPoolSummary"];
    readonly successor: Readonly<{
      readonly patternId: string;
      readonly projectileArchetypeId: string;
      readonly requestedProjectileSlots: number;
      readonly requestedResidueVisualSlots: number;
      readonly emitterCount: number;
      readonly maxEmitters: number;
      readonly poolClassResolution: "required-at-combined-admission";
      readonly splitChildren:
        | Readonly<{
          readonly requiresSplitChildren: false;
          readonly upperBound: 0;
          readonly status: "not-required";
        }>
        | Readonly<{
          readonly requiresSplitChildren: true;
          readonly upperBound: null;
          readonly status: "missing";
        }>;
    }>;
    readonly combinedAdmissionEvaluated: false;
    readonly reservationCommitted: false;
  }>;
  readonly canonicalEventWrites: 0;
  readonly authorityMutations: 0;
}

export const CANONICAL_RUN_FIRST_CONTINUATION_ROOM_PLAN_CONTRACT = Object.freeze({
  sourceAuthority: SOURCE_AUTHORITY,
  authority: AUTHORITY,
  schemaVersion: SCHEMA_VERSION,
  extensionPolicy: EXTENSION_POLICY,
  targetRoomOrdinal: 1 as const,
  encounterOrdinal: 0 as const,
  difficultySalt: DIFFICULTY_SALT,
  targetSelectionDrawOrdinal: 0 as const,
  patternSelectionDrawOrdinal: 1 as const,
  selectionRngDrawsTotal: 2 as const,
  structuralSignaturePenalty: 0.15 as const,
  segmentPolicyMs: Object.freeze({
    telegraph: 520 as const,
    entry: 800 as const,
    materialSettle: 900 as const,
    safeGapHandoff: 520 as const,
  }),
  parallel: "none" as const,
  canonicalEventWrites: 0 as const,
  authorityMutations: 0 as const,
});

type UnknownRecord = Record<string, unknown>;

interface ValidatedSource {
  readonly source: CanonicalRunFirstContinuationRoomPlanSourceView;
  readonly targetRoom: CanonicalRunFirstContinuationRoomId;
  readonly rawRunSeed: number;
  readonly handoffTick120: number;
  readonly avgFlower: number;
  readonly gazeRatio: number;
  readonly stateAfterTargetDrawUint32: number;
  readonly materialPoolSummary: CanonicalRunFirstContinuationRoomPlanSourceView["materialPoolSummary"];
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`first continuation room plan ${message}`);
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function plainDataRecord(value: unknown, path: string): UnknownRecord {
  invariant(typeof value === "object" && value !== null && !Array.isArray(value), `${path} must be a plain object`);
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

function finite(value: unknown, path: string): number {
  invariant(
    typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0),
    `${path} must be finite and not negative zero`,
  );
  return value as number;
}

function ratio(value: unknown, path: string): number {
  const parsed = finite(value, path);
  invariant(parsed >= 0 && parsed <= 1, `${path} must be inside [0,1]`);
  return parsed;
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

function assertFrozenJsonData(
  value: unknown,
  path = "source",
  active = new Set<object>(),
  verified = new Set<object>(),
): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    finite(value, path);
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

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => deepFreeze(entry))) as T;
  if (typeof value === "object" && value !== null) {
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) copy[key] = deepFreeze(entry);
    return Object.freeze(copy) as T;
  }
  return value;
}

function assertContentIdentity(value: unknown): void {
  const identity = exactKeys(value, [
    "contentAuthoritySchemaVersion",
    "packageId",
    "packageSchemaVersion",
    "packageManifestSha256",
    "contentDigestSha256",
  ], "source.contentIdentity");
  for (const [key, expected] of Object.entries(V4_CONTENT_IDENTITY)) {
    invariant(identity[key] === expected, `source.contentIdentity.${key} drifted`);
  }
}


const LIVE_PATTERN_CAPABILITIES: ReadonlySet<string> = new Set(SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS);

function mulberry32DrawFromState(stateBeforeDrawUint32: number): Readonly<{
  readonly value: number;
  readonly stateAfterDrawUint32: number;
}> {
  const stateAfterDrawUint32 = (stateBeforeDrawUint32 + MULBERRY32_INCREMENT) >>> 0;
  let value = stateAfterDrawUint32;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return Object.freeze({
    value: ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296,
    stateAfterDrawUint32,
  });
}

function validatePoolClassCounts(
  value: unknown,
  path: string,
  maximums: Readonly<Record<CanonicalRunFirstContinuationRoomPlanProjectilePoolClass, number>>,
): Readonly<Record<CanonicalRunFirstContinuationRoomPlanProjectilePoolClass, number>> {
  const record = exactKeys(value, [...PROJECTILE_POOL_CLASS_ORDER], path);
  const result = Object.fromEntries(PROJECTILE_POOL_CLASS_ORDER.map((poolClass) => {
    const count = safeNonNegativeInteger(record[poolClass], `${path}.${poolClass}`);
    invariant(count <= maximums[poolClass], `${path}.${poolClass} exceeds V4 pool budget`);
    return [poolClass, count];
  })) as Record<CanonicalRunFirstContinuationRoomPlanProjectilePoolClass, number>;
  return Object.freeze(result);
}

function validateSource(value: CanonicalRunFirstContinuationRoomPlanSourceView): ValidatedSource {
  assertFrozenJsonData(value);
  const source = exactKeys(value, [
    "authority",
    "schemaVersion",
    "extensionPolicy",
    "contentIdentity",
    "target",
    "rawRunSeed",
    "targetSelectionRng",
    "handoff",
    "intensityMetrics",
    "priorEncounter",
    "materialPoolSummary",
  ], "source");
  invariant(
    source.authority === SOURCE_AUTHORITY
      && source.schemaVersion === SCHEMA_VERSION
      && source.extensionPolicy === EXTENSION_POLICY,
    "source identity drifted",
  );
  assertContentIdentity(source.contentIdentity);

  const target = exactKeys(source.target, [
    "authority",
    "extensionPolicy",
    "roomId",
    "roomOrdinal",
  ], "source.target");
  invariant(
    target.authority === "canonical-run-first-continuation-room-target-v1"
      && target.extensionPolicy === "EXT-2026-012"
      && (TARGET_ROOM_ORDER as readonly unknown[]).includes(target.roomId)
      && target.roomOrdinal === 1,
    "source target is not the exact EXT-012 ordinal 1 target",
  );
  const targetRoom = target.roomId as CanonicalRunFirstContinuationRoomId;

  const rawRunSeedRecord = exactKeys(source.rawRunSeed, ["domain", "value"], "source.rawRunSeed");
  invariant(rawRunSeedRecord.domain === "raw-run-seed", "source raw seed domain drifted");
  const rawRunSeed = uint32(rawRunSeedRecord.value, "source.rawRunSeed.value");
  const targetSelectionRng = exactKeys(source.targetSelectionRng, [
    "algorithm",
    "domain",
    "drawOrdinal",
    "drawValue",
    "stateAfterDrawUint32",
    "selectionRngDraws",
  ], "source.targetSelectionRng");
  const expectedTargetDraw = mulberry32DrawFromState(rawRunSeed);
  invariant(
    targetSelectionRng.algorithm === "mulberry32-v1"
      && targetSelectionRng.domain === TARGET_RNG_DOMAIN
      && targetSelectionRng.drawOrdinal === 0
      && targetSelectionRng.selectionRngDraws === 1
      && finite(targetSelectionRng.drawValue, "source.targetSelectionRng.drawValue") === expectedTargetDraw.value
      && uint32(targetSelectionRng.stateAfterDrawUint32, "source.targetSelectionRng.stateAfterDrawUint32")
        === expectedTargetDraw.stateAfterDrawUint32,
    "source target selection draw/state does not continue the raw Run seed",
  );

  const handoff = exactKeys(source.handoff, [
    "authority",
    "extensionPolicy",
    "targetRoom",
    "atTick120",
    "nextRoomAdmission",
  ], "source.handoff");
  const handoffTick120 = safePositiveInteger(handoff.atTick120, "source.handoff.atTick120");
  invariant(
    handoff.authority === "canonical-run-first-continuation-room-handoff-v1"
      && handoff.extensionPolicy === "EXT-2026-013"
      && handoff.targetRoom === targetRoom
      && handoff.nextRoomAdmission === WITHHELD_ADMISSION,
    "source handoff does not bind the exact target/withheld boundary",
  );

  const metrics = exactKeys(source.intensityMetrics, [
    "avgFlower",
    "gazeRatio",
    "overrideRatio",
  ], "source.intensityMetrics");
  const avgFlowerRecord = exactKeys(metrics.avgFlower, [
    "availability",
    "unit",
    "value",
  ], "source.intensityMetrics.avgFlower");
  const gazeRatioRecord = exactKeys(metrics.gazeRatio, [
    "availability",
    "unit",
    "value",
  ], "source.intensityMetrics.gazeRatio");
  const overrideRatioRecord = exactKeys(metrics.overrideRatio, [
    "availability",
    "reason",
  ], "source.intensityMetrics.overrideRatio");
  invariant(
    avgFlowerRecord.availability === "available"
      && avgFlowerRecord.unit === "ratio-0-1"
      && gazeRatioRecord.availability === "available"
      && gazeRatioRecord.unit === "ratio-0-1",
    "source avgFlower/gazeRatio must remain available ratios",
  );
  invariant(
    overrideRatioRecord.availability === "missing"
      && overrideRatioRecord.reason === "override-not-eligible-in-source-window",
    "source overrideRatio must remain the exact typed absence",
  );
  const avgFlower = ratio(avgFlowerRecord.value, "source.intensityMetrics.avgFlower.value");
  const gazeRatio = ratio(gazeRatioRecord.value, "source.intensityMetrics.gazeRatio.value");

  const priorEncounter = exactKeys(source.priorEncounter, [
    "roomId",
    "roomOrdinal",
    "encounterOrdinal",
    "patternId",
  ], "source.priorEncounter");
  invariant(
    priorEncounter.roomId === "FORCED_ALIGNMENT"
      && priorEncounter.roomOrdinal === 0
      && priorEncounter.encounterOrdinal === 0
      && priorEncounter.patternId === PREVIOUS_PATTERN_ID,
    "source prior encounter is not the exact Left/Right occurrence",
  );

  const material = exactKeys(source.materialPoolSummary, [
    "authority",
    "sourcePatternId",
    "sourceOccurrenceId",
    "detachedAtTick120",
    "observedAtTick120",
    "materialCount",
    "drained",
    "activeSlots",
    "allocatedSlots",
    "liveColliders",
    "residueVisuals",
  ], "source.materialPoolSummary");
  invariant(
    material.authority === "room-threshold-material-carryover-v1"
      && material.sourcePatternId === MATERIAL_PATTERN_ID
      && material.sourceOccurrenceId === MATERIAL_OCCURRENCE_ID,
    "source material identity drifted",
  );
  const detachedAtTick120 = safePositiveInteger(
    material.detachedAtTick120,
    "source.materialPoolSummary.detachedAtTick120",
  );
  const observedAtTick120 = safePositiveInteger(
    material.observedAtTick120,
    "source.materialPoolSummary.observedAtTick120",
  );
  invariant(
    detachedAtTick120 <= observedAtTick120 && observedAtTick120 === handoffTick120,
    "source material summary is stale or ahead of the exact handoff",
  );
  const activeSlots = validatePoolClassCounts(
    material.activeSlots,
    "source.materialPoolSummary.activeSlots",
    PROJECTILE_POOL_BUDGETS,
  );
  const allocatedSlots = validatePoolClassCounts(
    material.allocatedSlots,
    "source.materialPoolSummary.allocatedSlots",
    PROJECTILE_POOL_BUDGETS,
  );
  let activeTotal = 0;
  for (const poolClass of PROJECTILE_POOL_CLASS_ORDER) {
    invariant(
      activeSlots[poolClass] <= allocatedSlots[poolClass],
      `source material active ${poolClass} exceeds allocated slots`,
    );
    activeTotal += activeSlots[poolClass];
  }
  const materialCount = safeNonNegativeInteger(material.materialCount, "source.materialPoolSummary.materialCount");
  const residueVisuals = safeNonNegativeInteger(
    material.residueVisuals,
    "source.materialPoolSummary.residueVisuals",
  );
  invariant(
    material.liveColliders === 0
      && materialCount === activeTotal
      && residueVisuals === materialCount
      && residueVisuals <= RESIDUE_VISUAL_ONLY_BUDGET
      && material.drained === (materialCount === 0),
    "source material summary is not collisionless exact carryover",
  );
  const materialPoolSummary = source.materialPoolSummary as
    CanonicalRunFirstContinuationRoomPlanSourceView["materialPoolSummary"];
  return Object.freeze({
    source: value,
    targetRoom,
    rawRunSeed,
    handoffTick120,
    avgFlower,
    gazeRatio,
    stateAfterTargetDrawUint32: expectedTargetDraw.stateAfterDrawUint32,
    materialPoolSummary,
  });
}

function selectWeightedCandidateIndex(
  candidates: readonly Pick<CanonicalRunFirstContinuationRoomPlanCandidate, "effectiveWeight">[],
  cursorInitial: number,
): number {
  invariant(candidates.length > 0, "weighted selection requires candidates");
  invariant(Number.isFinite(cursorInitial) && cursorInitial >= 0, "weighted selection cursor is invalid");
  let cursor = cursorInitial;
  let selectedIndex = candidates.length - 1;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    invariant(candidate !== undefined, `candidate ${index} disappeared`);
    cursor -= Math.max(0.0001, candidate.effectiveWeight);
    if (cursor <= 0) {
      selectedIndex = index;
      break;
    }
  }
  return selectedIndex;
}

/**
 * Pure EXT-015 fixture core. This function accepts no owner, receipt, event bus,
 * pool or mutation capability and cannot mint formal admission authority.
 */
export function deriveCanonicalRunFirstContinuationRoomPlanUnbranded(
  sourceView: CanonicalRunFirstContinuationRoomPlanSourceView,
): CanonicalRunFirstContinuationRoomPlanPayload {
  const source = validateSource(sourceView);
  const composer = canonicalRunFirstContinuationRoomPlanCatalogComposer(source.targetRoom);

  const score = Math.max(0, Math.min(1, (source.avgFlower + source.gazeRatio + 0) / 2));
  const tierIndex = score < 0.28 ? 0 : score < 0.58 ? 1 : 2;
  const tier = composer.tiers[tierIndex];
  invariant(tier !== undefined, `target ${source.targetRoom} lost intensity tier ${tierIndex}`);

  const candidates = Object.freeze(composer.candidates.map((candidate): CanonicalRunFirstContinuationRoomPlanCandidate => {
    const sameAsPreviousStructuralSignature =
      candidate.structuralSignatureSha256 === PREVIOUS_STRUCTURAL_SIGNATURE_SHA256;
    const structuralSignaturePenalty = sameAsPreviousStructuralSignature ? 0.15 as const : 1 as const;
    const effectiveWeight = candidate.baseWeight * structuralSignaturePenalty;
    invariant(Number.isFinite(effectiveWeight) && effectiveWeight > 0, `${candidate.pattern.id} effective weight is invalid`);
    return Object.freeze({
      patternId: candidate.pattern.id,
      baseWeight: candidate.baseWeight,
      structuralSignatureSha256: candidate.structuralSignatureSha256,
      sameAsPreviousStructuralSignature,
      structuralSignaturePenalty,
      effectiveWeight,
    });
  }));
  let candidateTotalWeight = 0;
  for (const candidate of candidates) candidateTotalWeight += Math.max(0.0001, candidate.effectiveWeight);
  invariant(Number.isFinite(candidateTotalWeight) && candidateTotalWeight > 0, "candidate total weight is invalid");

  const draw = mulberry32DrawFromState(source.stateAfterTargetDrawUint32);
  const cursorInitial = draw.value * candidateTotalWeight;
  const selectedIndex = selectWeightedCandidateIndex(candidates, cursorInitial);
  const selectedCandidate = candidates[selectedIndex];
  const selectedDefinition = composer.candidates[selectedIndex];
  invariant(
    selectedCandidate !== undefined
      && selectedDefinition !== undefined
      && selectedCandidate.patternId === selectedDefinition.pattern.id,
    "weighted selection lost the selected pattern",
  );
  const capabilityStatus = LIVE_PATTERN_CAPABILITIES.has(selectedDefinition.pattern.id)
    ? "supported" as const
    : "unsupported" as const;
  const resolvedSeed = (
    source.rawRunSeed
    ^ selectedDefinition.pattern.seedBase
    ^ 0
    ^ DIFFICULTY_SALT
  ) >>> 0;
  const occurrenceId = `run:room:1:encounter:0:${selectedDefinition.pattern.id}`;

  return deepFreeze({
    availability: "available" as const,
    authority: AUTHORITY,
    schemaVersion: SCHEMA_VERSION,
    extensionPolicy: EXTENSION_POLICY,
    contentIdentity: V4_CONTENT_IDENTITY,
    plannedAtTick120: source.handoffTick120,
    targetRoom: source.targetRoom,
    roomOrdinal: 1 as const,
    intensity: {
      formula: "clamp01((avgFlower + gazeRatio + overrideRatio) / 2)" as const,
      avgFlower: source.avgFlower,
      gazeRatio: source.gazeRatio,
      overrideRatio: {
        sourceAvailability: "missing" as const,
        missingReason: "override-not-eligible-in-source-window" as const,
        policy: "authored-fallback-not-observed" as const,
        value: 0 as const,
      },
      score,
      tierId: tier.id,
      difficulty: tier.difficulty,
      budget: {
        maxProjectiles: tier.maxProjectiles,
        maxEmitters: tier.maxEmitters,
        restMs: tier.restMs,
      },
    },
    selection: {
      algorithm: "seeded-weighted-with-immediate-structural-signature-penalty" as const,
      previousPatternId: PREVIOUS_PATTERN_ID,
      previousStructuralSignatureSha256: PREVIOUS_STRUCTURAL_SIGNATURE_SHA256,
      candidateOrder: candidates.map((candidate) => candidate.patternId),
      candidates,
      candidateTotalWeight,
      rng: {
        algorithm: "mulberry32-v1" as const,
        domain: TARGET_RNG_DOMAIN,
        continuedFromStateAfterDrawUint32: source.stateAfterTargetDrawUint32,
        drawOrdinal: 1 as const,
        drawValue: draw.value,
        stateAfterDrawUint32: draw.stateAfterDrawUint32,
        cursorInitial,
        selectionRngDrawsTotal: 2 as const,
      },
      selectedPatternId: selectedDefinition.pattern.id,
      rerollCount: 0 as const,
      capabilityFilteringApplied: false as const,
    },
    occurrence: {
      occurrenceId,
      patternId: selectedDefinition.pattern.id,
      roomId: source.targetRoom,
      roomOrdinal: 1 as const,
      encounterOrdinal: 0 as const,
      difficulty: tier.difficulty,
      difficultySalt: DIFFICULTY_SALT,
      resolvedSeed: {
        domain: "resolved-occurrence-seed" as const,
        composition: "rawRunSeed xor pattern.base xor encounterOrdinal xor difficultySalt" as const,
        value: resolvedSeed,
      },
      segmentsMs: {
        telegraph: 520 as const,
        entry: 800 as const,
        read: selectedDefinition.pattern.durationMs,
        materialSettle: 900 as const,
        rest: tier.restMs,
        safeGapHandoff: 520 as const,
      },
      parallel: {mode: "none" as const, patternId: null},
    },
    patternCapability: {
      patternId: selectedDefinition.pattern.id,
      source: "SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS" as const,
      status: capabilityStatus,
    },
    poolReservationRequest: {
      state: selectedDefinition.pattern.requiresSplitChildren
        ? "withheld-missing-split-child-upper-bound" as const
        : capabilityStatus === "supported"
          ? "withheld-pending-combined-pool-admission" as const
          : "withheld-unsupported-pattern-capability" as const,
      carryover: source.materialPoolSummary,
      successor: {
        patternId: selectedDefinition.pattern.id,
        projectileArchetypeId: selectedDefinition.pattern.projectileArchetypeId,
        requestedProjectileSlots: tier.maxProjectiles,
        requestedResidueVisualSlots: tier.maxProjectiles,
        emitterCount: selectedDefinition.pattern.emitterCount,
        maxEmitters: tier.maxEmitters,
        poolClassResolution: "required-at-combined-admission" as const,
        splitChildren: selectedDefinition.pattern.requiresSplitChildren
          ? {
              requiresSplitChildren: true,
              upperBound: null,
              status: "missing" as const,
            }
          : {
              requiresSplitChildren: false,
              upperBound: 0,
              status: "not-required" as const,
            },
      },
      combinedAdmissionEvaluated: false as const,
      reservationCommitted: false as const,
    },
    canonicalEventWrites: 0 as const,
    authorityMutations: 0 as const,
  });
}
