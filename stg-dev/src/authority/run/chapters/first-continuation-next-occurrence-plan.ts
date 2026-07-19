import {V4_CONTENT_IDENTITY, type V4ContentIdentity} from
  "../../../content/v4-content-identity";
import {SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS} from "../../combat-pattern-capabilities";
import {crossedTickCount} from "../../tick120";
import {
  canonicalRunFirstContinuationRoomPlanCatalogComposer,
  canonicalRunFirstContinuationRoomPlanCatalogProjectilePoolClassOrder,
  type CanonicalRunFirstContinuationRoomPlanCatalogProjectilePoolClass,
} from "./first-continuation-room-plan-catalog";
import type {
  CanonicalRunFirstContinuationRoomPlanCandidate,
  CanonicalRunFirstContinuationRoomPlanDifficulty,
  CanonicalRunFirstContinuationRoomPlanPayload,
} from "./first-continuation-room-plan";

const UINT32_MAX = 0xffff_ffff;
const MULBERRY32_INCREMENT = 0x6d2b_79f5;
const DIFFICULTY_SALT = 0x2201;
const AUTHORITY = "canonical-run-first-continuation-next-occurrence-plan-v1" as const;
const SOURCE_AUTHORITY =
  "canonical-run-first-continuation-next-occurrence-plan-source-v1" as const;
const SCHEMA_VERSION = "1.0.0-ext-2026-020" as const;
const EXTENSION_POLICY = "EXT-2026-020" as const;
const RNG_DOMAIN = "ext-012-first-continuation-room-selection" as const;
const POOL_CLASS_ORDER =
  canonicalRunFirstContinuationRoomPlanCatalogProjectilePoolClassOrder();
const LIVE_PATTERN_CAPABILITIES = new Set<string>(SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS);

type PoolCounts = Readonly<Record<
  CanonicalRunFirstContinuationRoomPlanCatalogProjectilePoolClass,
  number
>>;

export interface CanonicalRunFirstContinuationNextOccurrenceMaterialSource {
  readonly authority: "canonical-run-occurrence-material-carryover-v1";
  readonly extensionPolicy: "EXT-2026-019";
  readonly sourcePatternId: string;
  readonly sourceOccurrenceId: string;
  readonly transferredAtTick120: number;
  readonly tick120: number;
  readonly materialCount: number;
  readonly drained: boolean;
  readonly poolUsage: Readonly<{
    readonly active: PoolCounts;
    readonly allocatedSlots: PoolCounts;
    readonly liveColliders: number;
    readonly residueVisuals: number;
  }>;
  readonly predecessorMaterialLease: "retired";
  readonly gameplayAuthority: "released";
  readonly roomCompletion: "withheld";
  readonly roomHandoff: "withheld";
  readonly nextOccurrenceAdmission:
    "withheld-pending-plan-and-combined-pool-admission";
}

export interface CanonicalRunFirstContinuationNextOccurrencePlanSourceView {
  readonly authority: typeof SOURCE_AUTHORITY;
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly extensionPolicy: typeof EXTENSION_POLICY;
  readonly contentIdentity: V4ContentIdentity;
  readonly plannedAtTick120: number;
  readonly room: Readonly<{
    readonly id: CanonicalRunFirstContinuationRoomPlanPayload["targetRoom"];
    readonly ordinal: 1;
  }>;
  readonly rawRunSeed: Readonly<{
    readonly domain: "raw-run-seed";
    readonly value: number;
    readonly recoveredFrom:
      "previousResolvedSeed xor previousPatternBase xor encounterOrdinal xor difficultySalt";
  }>;
  readonly intensity: CanonicalRunFirstContinuationRoomPlanPayload["intensity"];
  readonly previousOccurrence: Readonly<{
    readonly occurrenceId: string;
    readonly patternId: string;
    readonly encounterOrdinal: 0;
    readonly structuralSignatureSha256: string;
  }>;
  readonly selectionCursor: Readonly<{
    readonly algorithm: "mulberry32-v1";
    readonly domain: typeof RNG_DOMAIN;
    readonly previousDrawOrdinal: 1;
    readonly stateAfterPreviousDrawUint32: number;
    readonly selectionRngDrawsBeforePlan: 2;
  }>;
  readonly materialPoolSummary: Readonly<{
    readonly authority: "canonical-run-occurrence-material-carryover-v1";
    readonly sourcePatternId: string;
    readonly sourceOccurrenceId: string;
    readonly transferredAtTick120: number;
    readonly observedAtTick120: number;
    readonly materialCount: number;
    readonly drained: boolean;
    readonly activeSlots: PoolCounts;
    readonly allocatedSlots: PoolCounts;
    readonly liveColliders: 0;
    readonly residueVisuals: number;
  }>;
}

export interface CanonicalRunFirstContinuationNextOccurrencePlanPayload {
  readonly availability: "available";
  readonly authority: typeof AUTHORITY;
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly extensionPolicy: typeof EXTENSION_POLICY;
  readonly contentIdentity: V4ContentIdentity;
  readonly plannedAtTick120: number;
  readonly targetRoom: CanonicalRunFirstContinuationRoomPlanPayload["targetRoom"];
  readonly roomOrdinal: 1;
  readonly intensity: CanonicalRunFirstContinuationRoomPlanPayload["intensity"];
  readonly selection: Readonly<{
    readonly algorithm:
      "seeded-weighted-without-replacement-with-immediate-structural-signature-penalty";
    readonly removedPatternIds: readonly [string];
    readonly previousPatternId: string;
    readonly previousStructuralSignatureSha256: string;
    readonly candidateOrder: readonly string[];
    readonly candidates: readonly CanonicalRunFirstContinuationRoomPlanCandidate[];
    readonly candidateTotalWeight: number;
    readonly rng: Readonly<{
      readonly algorithm: "mulberry32-v1";
      readonly domain: typeof RNG_DOMAIN;
      readonly continuedFromStateAfterDrawUint32: number;
      readonly drawOrdinal: 2;
      readonly drawValue: number;
      readonly stateAfterDrawUint32: number;
      readonly cursorInitial: number;
      readonly selectionRngDrawsTotal: 3;
    }>;
    readonly selectedPatternId: string;
    readonly rerollCount: 0;
    readonly capabilityFilteringApplied: false;
  }>;
  readonly occurrence: Readonly<{
    readonly occurrenceId: string;
    readonly patternId: string;
    readonly roomId: CanonicalRunFirstContinuationRoomPlanPayload["targetRoom"];
    readonly roomOrdinal: 1;
    readonly encounterOrdinal: 1;
    readonly difficulty: CanonicalRunFirstContinuationRoomPlanDifficulty;
    readonly difficultySalt: typeof DIFFICULTY_SALT;
    readonly resolvedSeed: Readonly<{
      readonly domain: "resolved-occurrence-seed";
      readonly composition:
        "rawRunSeed xor pattern.base xor encounterOrdinal xor difficultySalt";
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
    readonly parallel: Readonly<{readonly mode: "none"; readonly patternId: null}>;
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
    readonly carryover:
      CanonicalRunFirstContinuationNextOccurrencePlanSourceView["materialPoolSummary"];
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
  readonly roomCompletion: "withheld";
  readonly roomHandoff: "withheld";
  readonly canonicalEventWrites: 0;
  readonly authorityMutations: 0;
}

export const CANONICAL_RUN_FIRST_CONTINUATION_NEXT_OCCURRENCE_PLAN_CONTRACT =
  Object.freeze({
    authority: AUTHORITY,
    sourceAuthority: SOURCE_AUTHORITY,
    schemaVersion: SCHEMA_VERSION,
    extensionPolicy: EXTENSION_POLICY,
    roomOrdinal: 1 as const,
    encounterOrdinal: 1 as const,
    difficultySalt: DIFFICULTY_SALT,
    patternSelectionDrawOrdinal: 2 as const,
    selectionRngDrawsTotal: 3 as const,
    withoutReplacement: true as const,
    tierPolicy: "reuse-room-tier" as const,
    segmentPolicyMs: Object.freeze({
      telegraph: 520 as const,
      entry: 800 as const,
      materialSettle: 900 as const,
      safeGapHandoff: 520 as const,
    }),
    parallel: "none" as const,
    roomCompletion: "withheld" as const,
    canonicalEventWrites: 0 as const,
    authorityMutations: 0 as const,
  });

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`first continuation next occurrence plan ${message}`);
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

function safeInteger(value: unknown, path: string): number {
  invariant(
    typeof value === "number"
      && Number.isSafeInteger(value)
      && value >= 0
      && !Object.is(value, -0),
    `${path} must be a non-negative safe integer`,
  );
  return value as number;
}

function uint32(value: unknown, path: string): number {
  const parsed = safeInteger(value, path);
  invariant(parsed <= UINT32_MAX, `${path} must be uint32`);
  return parsed;
}

function capturePoolCounts(value: PoolCounts, path: string): PoolCounts {
  invariant(typeof value === "object" && value !== null, `${path} must be an object`);
  const keys = Object.keys(value).sort();
  const expected = [...POOL_CLASS_ORDER].sort();
  invariant(
    keys.length === expected.length && keys.every((key, index) => key === expected[index]),
    `${path} must contain the exact V4 pool classes`,
  );
  return Object.freeze(Object.fromEntries(POOL_CLASS_ORDER.map((poolClass) => [
    poolClass,
    safeInteger(value[poolClass], `${path}.${poolClass}`),
  ]))) as PoolCounts;
}

function mulberry32DrawFromState(stateBeforeDrawUint32: number): Readonly<{
  value: number;
  stateAfterDrawUint32: number;
}> {
  const stateAfterDrawUint32 = (stateBeforeDrawUint32 + MULBERRY32_INCREMENT) >>> 0;
  let t = stateAfterDrawUint32;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  return Object.freeze({value, stateAfterDrawUint32});
}

function selectWeightedCandidateIndex(
  candidates: readonly Pick<CanonicalRunFirstContinuationRoomPlanCandidate, "effectiveWeight">[],
  cursorInitial: number,
): number {
  invariant(candidates.length > 0, "weighted selection requires candidates");
  let cursor = cursorInitial;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    invariant(candidate !== undefined, `candidate ${index} disappeared`);
    cursor -= Math.max(0.0001, candidate.effectiveWeight);
    if (cursor <= 0) return index;
  }
  return candidates.length - 1;
}

export function deriveCanonicalRunFirstContinuationNextOccurrencePlanSourceUnbranded(
  previousPlan: CanonicalRunFirstContinuationRoomPlanPayload,
  material: CanonicalRunFirstContinuationNextOccurrenceMaterialSource,
): CanonicalRunFirstContinuationNextOccurrencePlanSourceView {
  invariant(
    Object.isFrozen(previousPlan)
      && previousPlan.authority === "canonical-run-first-continuation-room-plan-v1"
      && previousPlan.extensionPolicy === "EXT-2026-015"
      && JSON.stringify(previousPlan.contentIdentity) === JSON.stringify(V4_CONTENT_IDENTITY)
      && previousPlan.roomOrdinal === 1
      && previousPlan.occurrence.roomOrdinal === 1
      && previousPlan.occurrence.encounterOrdinal === 0
      && previousPlan.occurrence.patternId === previousPlan.selection.selectedPatternId
      && previousPlan.occurrence.difficultySalt === 0x2200
      && previousPlan.occurrence.resolvedSeed.composition
        === "rawRunSeed xor pattern.base xor encounterOrdinal xor difficultySalt"
      && previousPlan.selection.rng.drawOrdinal === 1
      && previousPlan.selection.rng.selectionRngDrawsTotal === 2
      && previousPlan.selection.rng.domain === RNG_DOMAIN,
    "previous formal plan lost its exact EXT-015 continuation cursor",
  );
  const composer = canonicalRunFirstContinuationRoomPlanCatalogComposer(previousPlan.targetRoom);
  const previousDefinition = composer.candidates.find((candidate) =>
    candidate.pattern.id === previousPlan.occurrence.patternId);
  invariant(previousDefinition !== undefined, "previous pattern left its target composer pool");
  const expectedSliceCompleteTick120 = previousPlan.plannedAtTick120
    + crossedTickCount(
      previousPlan.occurrence.segmentsMs.telegraph
        + previousPlan.occurrence.segmentsMs.entry,
    )
    + crossedTickCount(
      previousPlan.occurrence.segmentsMs.read
        + previousPlan.occurrence.segmentsMs.materialSettle
        + previousPlan.occurrence.segmentsMs.rest,
    );
  const activeSlots = capturePoolCounts(material.poolUsage.active, "material.activeSlots");
  const allocatedSlots = capturePoolCounts(
    material.poolUsage.allocatedSlots,
    "material.allocatedSlots",
  );
  const materialCount = safeInteger(material.materialCount, "material.materialCount");
  const residueVisuals = safeInteger(
    material.poolUsage.residueVisuals,
    "material.residueVisuals",
  );
  const activeTotal = POOL_CLASS_ORDER.reduce((total, poolClass) =>
    total + activeSlots[poolClass], 0);
  invariant(
    material.authority === "canonical-run-occurrence-material-carryover-v1"
      && material.extensionPolicy === "EXT-2026-019"
      && material.sourcePatternId === previousPlan.occurrence.patternId
      && material.sourceOccurrenceId === previousPlan.occurrence.occurrenceId
      && material.transferredAtTick120 === expectedSliceCompleteTick120
      && material.tick120 === expectedSliceCompleteTick120
      && material.predecessorMaterialLease === "retired"
      && material.gameplayAuthority === "released"
      && material.roomCompletion === "withheld"
      && material.roomHandoff === "withheld"
      && material.nextOccurrenceAdmission
        === "withheld-pending-plan-and-combined-pool-admission"
      && material.poolUsage.liveColliders === 0
      && activeTotal === materialCount
      && residueVisuals === materialCount
      && material.drained === (materialCount === 0)
      && POOL_CLASS_ORDER.every((poolClass) =>
        activeSlots[poolClass] <= allocatedSlots[poolClass]),
    "material source is not the exact collisionless EXT-019 handoff",
  );
  const rawRunSeed = (
    uint32(previousPlan.occurrence.resolvedSeed.value, "previous resolved seed")
    ^ previousDefinition.pattern.seedBase
    ^ previousPlan.occurrence.encounterOrdinal
    ^ previousPlan.occurrence.difficultySalt
  ) >>> 0;
  return deepFreeze({
    authority: SOURCE_AUTHORITY,
    schemaVersion: SCHEMA_VERSION,
    extensionPolicy: EXTENSION_POLICY,
    contentIdentity: V4_CONTENT_IDENTITY,
    plannedAtTick120: expectedSliceCompleteTick120,
    room: {id: previousPlan.targetRoom, ordinal: 1 as const},
    rawRunSeed: {
      domain: "raw-run-seed" as const,
      value: rawRunSeed,
      recoveredFrom:
        "previousResolvedSeed xor previousPatternBase xor encounterOrdinal xor difficultySalt" as const,
    },
    intensity: previousPlan.intensity,
    previousOccurrence: {
      occurrenceId: previousPlan.occurrence.occurrenceId,
      patternId: previousPlan.occurrence.patternId,
      encounterOrdinal: 0 as const,
      structuralSignatureSha256: previousDefinition.structuralSignatureSha256,
    },
    selectionCursor: {
      algorithm: "mulberry32-v1" as const,
      domain: RNG_DOMAIN,
      previousDrawOrdinal: 1 as const,
      stateAfterPreviousDrawUint32: previousPlan.selection.rng.stateAfterDrawUint32,
      selectionRngDrawsBeforePlan: 2 as const,
    },
    materialPoolSummary: {
      authority: material.authority,
      sourcePatternId: material.sourcePatternId,
      sourceOccurrenceId: material.sourceOccurrenceId,
      transferredAtTick120: material.transferredAtTick120,
      observedAtTick120: material.tick120,
      materialCount,
      drained: material.drained,
      activeSlots,
      allocatedSlots,
      liveColliders: 0 as const,
      residueVisuals,
    },
  });
}

export function deriveCanonicalRunFirstContinuationNextOccurrencePlanUnbranded(
  source: CanonicalRunFirstContinuationNextOccurrencePlanSourceView,
): CanonicalRunFirstContinuationNextOccurrencePlanPayload {
  invariant(
    Object.isFrozen(source)
      && source.authority === SOURCE_AUTHORITY
      && source.schemaVersion === SCHEMA_VERSION
      && source.extensionPolicy === EXTENSION_POLICY
      && JSON.stringify(source.contentIdentity) === JSON.stringify(V4_CONTENT_IDENTITY)
      && source.room.ordinal === 1
      && source.previousOccurrence.encounterOrdinal === 0
      && source.selectionCursor.algorithm === "mulberry32-v1"
      && source.selectionCursor.domain === RNG_DOMAIN
      && source.selectionCursor.previousDrawOrdinal === 1
      && source.selectionCursor.selectionRngDrawsBeforePlan === 2
      && source.materialPoolSummary.observedAtTick120 === source.plannedAtTick120
      && source.materialPoolSummary.sourceOccurrenceId
        === source.previousOccurrence.occurrenceId,
    "source lost its exact frozen schema or continuation lineage",
  );
  const composer = canonicalRunFirstContinuationRoomPlanCatalogComposer(source.room.id);
  const remaining = composer.candidates.filter((candidate) =>
    candidate.pattern.id !== source.previousOccurrence.patternId);
  invariant(
    remaining.length === composer.candidates.length - 1 && remaining.length > 0,
    "without-replacement pool did not remove exactly the previous pattern",
  );
  const candidates = Object.freeze(remaining.map((candidate) => {
    const sameAsPreviousStructuralSignature = candidate.structuralSignatureSha256
      === source.previousOccurrence.structuralSignatureSha256;
    const structuralSignaturePenalty = sameAsPreviousStructuralSignature
      ? 0.15 as const
      : 1 as const;
    return Object.freeze({
      patternId: candidate.pattern.id,
      baseWeight: candidate.baseWeight,
      structuralSignatureSha256: candidate.structuralSignatureSha256,
      sameAsPreviousStructuralSignature,
      structuralSignaturePenalty,
      effectiveWeight: candidate.baseWeight * structuralSignaturePenalty,
    });
  }));
  const candidateTotalWeight = candidates.reduce((total, candidate) =>
    total + Math.max(0.0001, candidate.effectiveWeight), 0);
  invariant(Number.isFinite(candidateTotalWeight) && candidateTotalWeight > 0,
    "candidate total weight is invalid");
  const draw = mulberry32DrawFromState(
    uint32(
      source.selectionCursor.stateAfterPreviousDrawUint32,
      "selection state after previous draw",
    ),
  );
  const cursorInitial = draw.value * candidateTotalWeight;
  const selectedIndex = selectWeightedCandidateIndex(candidates, cursorInitial);
  const selectedCandidate = candidates[selectedIndex];
  const selectedDefinition = remaining[selectedIndex];
  invariant(
    selectedCandidate !== undefined
      && selectedDefinition !== undefined
      && selectedCandidate.patternId === selectedDefinition.pattern.id,
    "weighted selection lost its manifest candidate",
  );
  const capabilityStatus = LIVE_PATTERN_CAPABILITIES.has(selectedDefinition.pattern.id)
    ? "supported" as const
    : "unsupported" as const;
  const resolvedSeed = (
    source.rawRunSeed.value
    ^ selectedDefinition.pattern.seedBase
    ^ 1
    ^ DIFFICULTY_SALT
  ) >>> 0;
  const occurrenceId =
    `run:room:1:encounter:1:${selectedDefinition.pattern.id}`;
  return deepFreeze({
    availability: "available" as const,
    authority: AUTHORITY,
    schemaVersion: SCHEMA_VERSION,
    extensionPolicy: EXTENSION_POLICY,
    contentIdentity: V4_CONTENT_IDENTITY,
    plannedAtTick120: source.plannedAtTick120,
    targetRoom: source.room.id,
    roomOrdinal: 1 as const,
    intensity: source.intensity,
    selection: {
      algorithm:
        "seeded-weighted-without-replacement-with-immediate-structural-signature-penalty" as const,
      removedPatternIds: [source.previousOccurrence.patternId] as const,
      previousPatternId: source.previousOccurrence.patternId,
      previousStructuralSignatureSha256:
        source.previousOccurrence.structuralSignatureSha256,
      candidateOrder: candidates.map((candidate) => candidate.patternId),
      candidates,
      candidateTotalWeight,
      rng: {
        algorithm: "mulberry32-v1" as const,
        domain: RNG_DOMAIN,
        continuedFromStateAfterDrawUint32:
          source.selectionCursor.stateAfterPreviousDrawUint32,
        drawOrdinal: 2 as const,
        drawValue: draw.value,
        stateAfterDrawUint32: draw.stateAfterDrawUint32,
        cursorInitial,
        selectionRngDrawsTotal: 3 as const,
      },
      selectedPatternId: selectedDefinition.pattern.id,
      rerollCount: 0 as const,
      capabilityFilteringApplied: false as const,
    },
    occurrence: {
      occurrenceId,
      patternId: selectedDefinition.pattern.id,
      roomId: source.room.id,
      roomOrdinal: 1 as const,
      encounterOrdinal: 1 as const,
      difficulty: source.intensity.difficulty,
      difficultySalt: DIFFICULTY_SALT,
      resolvedSeed: {
        domain: "resolved-occurrence-seed" as const,
        composition:
          "rawRunSeed xor pattern.base xor encounterOrdinal xor difficultySalt" as const,
        value: resolvedSeed,
      },
      segmentsMs: {
        telegraph: 520 as const,
        entry: 800 as const,
        read: selectedDefinition.pattern.durationMs,
        materialSettle: 900 as const,
        rest: source.intensity.budget.restMs,
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
        requestedProjectileSlots: source.intensity.budget.maxProjectiles,
        requestedResidueVisualSlots: source.intensity.budget.maxProjectiles,
        emitterCount: selectedDefinition.pattern.emitterCount,
        maxEmitters: source.intensity.budget.maxEmitters,
        poolClassResolution: "required-at-combined-admission" as const,
        splitChildren: selectedDefinition.pattern.requiresSplitChildren
          ? {
            requiresSplitChildren: true as const,
            upperBound: null,
            status: "missing" as const,
          }
          : {
            requiresSplitChildren: false as const,
            upperBound: 0 as const,
            status: "not-required" as const,
          },
      },
      combinedAdmissionEvaluated: false as const,
      reservationCommitted: false as const,
    },
    roomCompletion: "withheld" as const,
    roomHandoff: "withheld" as const,
    canonicalEventWrites: 0 as const,
    authorityMutations: 0 as const,
  });
}
