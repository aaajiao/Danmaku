import type {ProjectilePoolClass} from "../../projectiles";
import {
  canonicalRunFirstContinuationRoomPlanCatalogDifficultyBudgets,
  canonicalRunFirstContinuationRoomPlanCatalogPoolBudgets,
  canonicalRunFirstContinuationRoomPlanCatalogProjectilePoolClassOrder,
  canonicalRunFirstContinuationRoomPlanCatalogResidueVisualOnlyBudget,
} from "./first-continuation-room-plan-catalog";
import type {
  CanonicalRunFirstContinuationRoomPlanPayload,
  CanonicalRunFirstContinuationRoomPlanProjectilePoolClass,
} from "./first-continuation-room-plan";

const AUTHORITY = "canonical-run-first-continuation-combined-pool-admission-v1" as const;
const SCHEMA_VERSION = "1.0.0-ext-2026-015" as const;
const EXTENSION_POLICY = "EXT-2026-015" as const;

const POOL_CLASS_ORDER =
  canonicalRunFirstContinuationRoomPlanCatalogProjectilePoolClassOrder();
const POOL_BUDGETS = canonicalRunFirstContinuationRoomPlanCatalogPoolBudgets();
const RESIDUE_VISUAL_ONLY_BUDGET =
  canonicalRunFirstContinuationRoomPlanCatalogResidueVisualOnlyBudget();
const DIFFICULTY_BUDGETS =
  canonicalRunFirstContinuationRoomPlanCatalogDifficultyBudgets();

export type CanonicalRunFirstContinuationCombinedPoolAdmissionState =
  | "admissible"
  | "withheld-missing-split-child-upper-bound"
  | "withheld-unsupported-pattern-capability"
  | "withheld-missing-pool-class-mapping"
  | "withheld-live-collider-carryover"
  | "withheld-emitter-capacity"
  | "withheld-difficulty-projectile-capacity"
  | "withheld-projectile-pool-capacity"
  | "withheld-residue-visual-capacity";

export type CanonicalRunFirstContinuationCombinedPoolAdmissionInput = Pick<
  CanonicalRunFirstContinuationRoomPlanPayload,
  | "plannedAtTick120"
  | "targetRoom"
  | "intensity"
  | "occurrence"
  | "patternCapability"
  | "poolReservationRequest"
>;

type PoolCounts = Readonly<
  Record<CanonicalRunFirstContinuationRoomPlanProjectilePoolClass, number>
>;

export interface CanonicalRunFirstContinuationCombinedPoolAdmissionEvaluation {
  readonly availability: "available";
  readonly authority: typeof AUTHORITY;
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly extensionPolicy: typeof EXTENSION_POLICY;
  readonly state: CanonicalRunFirstContinuationCombinedPoolAdmissionState;
  readonly admissible: boolean;
  readonly evaluatedAtTick120: number;
  readonly targetRoom: CanonicalRunFirstContinuationRoomPlanPayload["targetRoom"];
  readonly occurrence: Readonly<{
    readonly occurrenceId: string;
    readonly patternId: string;
    readonly difficulty: CanonicalRunFirstContinuationRoomPlanPayload["occurrence"]["difficulty"];
  }>;
  readonly poolClassResolution:
    | Readonly<{
      readonly state: "resolved";
      readonly archetypeId: string;
      readonly poolClass: CanonicalRunFirstContinuationRoomPlanProjectilePoolClass;
    }>
    | Readonly<{
      readonly state: "missing";
      readonly archetypeId: string;
      readonly poolClass: null;
    }>
    | Readonly<{
      readonly state: "not-evaluated";
      readonly archetypeId: string;
      readonly poolClass: null;
    }>;
  readonly carryover: Readonly<{
    readonly allocatedSlots: PoolCounts;
    readonly residueVisuals: number;
    readonly liveColliders: number;
  }>;
  readonly successor: Readonly<{
    readonly requestedProjectileSlots: number;
    readonly requestedResidueVisualSlots: number;
    readonly emitterCount: number;
    readonly maxEmitters: number;
    readonly reservationByClass: PoolCounts | null;
  }>;
  readonly combined: Readonly<{
    readonly allocatedSlots: PoolCounts;
    readonly residueVisuals: number;
  }> | null;
  readonly limits: Readonly<{
    readonly poolBudgets: PoolCounts;
    readonly residueVisualOnly: number;
    readonly difficultyProjectiles: number;
  }>;
  readonly checks: Readonly<{
    readonly patternCapability: boolean;
    readonly splitChildUpperBound: boolean;
    readonly poolClassMapping: boolean | null;
    readonly collisionlessCarryover: boolean | null;
    readonly emitterCapacity: boolean | null;
    readonly difficultyProjectileCapacity: boolean | null;
    readonly projectilePoolCapacity: boolean | null;
    readonly residueVisualCapacity: boolean | null;
  }>;
  readonly canonicalEventWrites: 0;
  readonly authorityMutations: 0;
  readonly reservationCommitted: false;
}

export const CANONICAL_RUN_FIRST_CONTINUATION_COMBINED_POOL_ADMISSION_CONTRACT =
  Object.freeze({
    authority: AUTHORITY,
    schemaVersion: SCHEMA_VERSION,
    extensionPolicy: EXTENSION_POLICY,
    poolAccounting: "carryover-allocated-plus-successor-reservation" as const,
    successorReservation: "tier-max-projectiles-in-primary-class" as const,
    materialDrainRequired: false as const,
    canonicalEventWrites: 0 as const,
    authorityMutations: 0 as const,
  });

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`first continuation combined pool admission ${message}`);
}

function finiteNonNegativeInteger(value: unknown, path: string): number {
  invariant(
    typeof value === "number"
      && Number.isSafeInteger(value)
      && value >= 0
      && !Object.is(value, -0),
    `${path} must be a non-negative safe integer`,
  );
  return value as number;
}

function finitePositiveInteger(value: unknown, path: string): number {
  const parsed = finiteNonNegativeInteger(value, path);
  invariant(parsed > 0, `${path} must be positive`);
  return parsed;
}

function poolCounts(value: unknown, path: string): PoolCounts {
  invariant(typeof value === "object" && value !== null && !Array.isArray(value), `${path} must be an object`);
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = [...POOL_CLASS_ORDER].sort();
  invariant(
    keys.length === expected.length && keys.every((key, index) => key === expected[index]),
    `${path} must contain the exact V4 pool classes`,
  );
  return Object.freeze(Object.fromEntries(POOL_CLASS_ORDER.map((poolClass) => [
    poolClass,
    finiteNonNegativeInteger(record[poolClass], `${path}.${poolClass}`),
  ]))) as PoolCounts;
}

function validatePoolClassMapping(
  value: Readonly<Record<string, ProjectilePoolClass>>,
): Readonly<Record<string, ProjectilePoolClass>> {
  invariant(
    typeof value === "object"
      && value !== null
      && !Array.isArray(value)
      && Object.isFrozen(value),
    "pool-class mapping must be a frozen plain object",
  );
  const prototype = Object.getPrototypeOf(value);
  invariant(
    prototype === Object.prototype || prototype === null,
    "pool-class mapping must be a frozen plain object",
  );
  const captured: Record<string, ProjectilePoolClass> = {};
  for (const key of Reflect.ownKeys(value)) {
    invariant(typeof key === "string", "pool-class mapping must not contain symbols");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    invariant(
      descriptor !== undefined
        && "value" in descriptor
        && descriptor.enumerable === true
        && (POOL_CLASS_ORDER as readonly string[]).includes(descriptor.value as string),
      `pool-class mapping ${key} must be an own enumerable V4 data mapping`,
    );
    captured[key] = descriptor.value as ProjectilePoolClass;
  }
  return Object.freeze(captured);
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

/**
 * Pure advisory join. It owns no Run, handoff receipt, pool, event bus, or
 * mutation capability and therefore cannot commit the returned reservation.
 */
export function evaluateCanonicalRunFirstContinuationCombinedPoolAdmissionUnbranded(
  input: CanonicalRunFirstContinuationCombinedPoolAdmissionInput,
  projectilePoolClasses: Readonly<Record<string, ProjectilePoolClass>>,
): CanonicalRunFirstContinuationCombinedPoolAdmissionEvaluation {
  const request = input.poolReservationRequest;
  invariant(
    [
      "withheld-pending-combined-pool-admission",
      "withheld-missing-split-child-upper-bound",
      "withheld-unsupported-pattern-capability",
    ].includes(request.state),
    "reservation request state is unknown",
  );
  const carryoverAllocated = poolCounts(
    request.carryover.allocatedSlots,
    "carryover.allocatedSlots",
  );
  for (const poolClass of POOL_CLASS_ORDER) {
    invariant(
      carryoverAllocated[poolClass] <= POOL_BUDGETS[poolClass],
      `carryover ${poolClass} allocation exceeds its V4 budget`,
    );
  }
  const plannedAtTick120 = finitePositiveInteger(input.plannedAtTick120, "plannedAtTick120");
  const requestedProjectileSlots = finitePositiveInteger(
    request.successor.requestedProjectileSlots,
    "successor.requestedProjectileSlots",
  );
  const requestedResidueVisualSlots = finitePositiveInteger(
    request.successor.requestedResidueVisualSlots,
    "successor.requestedResidueVisualSlots",
  );
  const emitterCount = finitePositiveInteger(request.successor.emitterCount, "successor.emitterCount");
  const maxEmitters = finitePositiveInteger(request.successor.maxEmitters, "successor.maxEmitters");
  const tierMaxProjectiles = finitePositiveInteger(
    input.intensity.budget.maxProjectiles,
    "intensity.budget.maxProjectiles",
  );
  invariant(
    request.successor.patternId === input.occurrence.patternId
      && input.patternCapability.patternId === input.occurrence.patternId
      && input.occurrence.roomId === input.targetRoom
      && input.occurrence.difficulty === input.intensity.difficulty
      && requestedProjectileSlots === tierMaxProjectiles
      && requestedResidueVisualSlots === tierMaxProjectiles
      && maxEmitters === input.intensity.budget.maxEmitters,
    "plan and reservation request disagree",
  );
  const residueVisuals = finiteNonNegativeInteger(
    request.carryover.residueVisuals,
    "carryover.residueVisuals",
  );
  const liveColliders = finiteNonNegativeInteger(
    request.carryover.liveColliders,
    "carryover.liveColliders",
  );
  const difficultyLimit = DIFFICULTY_BUDGETS[input.occurrence.difficulty];
  invariant(difficultyLimit !== undefined, "occurrence difficulty has no V4 projectile limit");

  const splitChildUpperBound = request.successor.splitChildren.requiresSplitChildren === false
    && request.successor.splitChildren.upperBound === 0
    && request.successor.splitChildren.status === "not-required";
  const patternCapability = input.patternCapability.status === "supported";
  const archetypeId = request.successor.projectileArchetypeId;
  const upstreamState = request.state === "withheld-missing-split-child-upper-bound"
    ? "withheld-missing-split-child-upper-bound" as const
    : request.state === "withheld-unsupported-pattern-capability"
      ? "withheld-unsupported-pattern-capability" as const
      : null;
  invariant(
    (upstreamState === "withheld-missing-split-child-upper-bound" && !splitChildUpperBound)
      || (upstreamState === "withheld-unsupported-pattern-capability"
        && splitChildUpperBound
        && !patternCapability)
      || (upstreamState === null && splitChildUpperBound && patternCapability),
    "reservation request state disagrees with its capability prerequisites",
  );
  if (upstreamState !== null) {
    return deepFreeze({
      availability: "available" as const,
      authority: AUTHORITY,
      schemaVersion: SCHEMA_VERSION,
      extensionPolicy: EXTENSION_POLICY,
      state: upstreamState,
      admissible: false,
      evaluatedAtTick120: plannedAtTick120,
      targetRoom: input.targetRoom,
      occurrence: {
        occurrenceId: input.occurrence.occurrenceId,
        patternId: input.occurrence.patternId,
        difficulty: input.occurrence.difficulty,
      },
      poolClassResolution: {
        state: "not-evaluated" as const,
        archetypeId,
        poolClass: null,
      },
      carryover: {
        allocatedSlots: carryoverAllocated,
        residueVisuals,
        liveColliders,
      },
      successor: {
        requestedProjectileSlots,
        requestedResidueVisualSlots,
        emitterCount,
        maxEmitters,
        reservationByClass: null,
      },
      combined: null,
      limits: {
        poolBudgets: POOL_BUDGETS,
        residueVisualOnly: RESIDUE_VISUAL_ONLY_BUDGET,
        difficultyProjectiles: difficultyLimit,
      },
      checks: {
        patternCapability,
        splitChildUpperBound,
        poolClassMapping: null,
        collisionlessCarryover: null,
        emitterCapacity: null,
        difficultyProjectileCapacity: null,
        projectilePoolCapacity: null,
        residueVisualCapacity: null,
      },
      canonicalEventWrites: 0 as const,
      authorityMutations: 0 as const,
      reservationCommitted: false as const,
    });
  }

  const mapping = validatePoolClassMapping(projectilePoolClasses);
  const mappedPoolClass = Object.prototype.hasOwnProperty.call(mapping, archetypeId)
    ? mapping[archetypeId] ?? null
    : null;
  const poolClassMapping = mappedPoolClass !== null;
  const reservationByClass = mappedPoolClass === null
    ? null
    : Object.freeze(Object.fromEntries(POOL_CLASS_ORDER.map((poolClass) => [
      poolClass,
      poolClass === mappedPoolClass ? requestedProjectileSlots : 0,
    ]))) as PoolCounts;
  const combinedAllocatedSlots = reservationByClass === null
    ? null
    : Object.freeze(Object.fromEntries(POOL_CLASS_ORDER.map((poolClass) => [
      poolClass,
      carryoverAllocated[poolClass] + reservationByClass[poolClass],
    ]))) as PoolCounts;
  const combinedResidueVisuals = residueVisuals + requestedResidueVisualSlots;
  const collisionlessCarryover = liveColliders === 0;
  const emitterCapacity = emitterCount <= maxEmitters;
  const difficultyProjectileCapacity = tierMaxProjectiles <= difficultyLimit;
  const projectilePoolCapacity = combinedAllocatedSlots === null
    ? null
    : POOL_CLASS_ORDER.every((poolClass) =>
      combinedAllocatedSlots[poolClass] <= POOL_BUDGETS[poolClass]);
  const residueVisualCapacity = combinedAllocatedSlots === null
    ? null
    : combinedResidueVisuals <= RESIDUE_VISUAL_ONLY_BUDGET;

  let state: CanonicalRunFirstContinuationCombinedPoolAdmissionState;
  if (!poolClassMapping) state = "withheld-missing-pool-class-mapping";
  else if (!collisionlessCarryover) state = "withheld-live-collider-carryover";
  else if (!emitterCapacity) state = "withheld-emitter-capacity";
  else if (!difficultyProjectileCapacity) {
    state = "withheld-difficulty-projectile-capacity";
  } else if (projectilePoolCapacity !== true) {
    state = "withheld-projectile-pool-capacity";
  } else if (residueVisualCapacity !== true) {
    state = "withheld-residue-visual-capacity";
  } else state = "admissible";

  return deepFreeze({
    availability: "available" as const,
    authority: AUTHORITY,
    schemaVersion: SCHEMA_VERSION,
    extensionPolicy: EXTENSION_POLICY,
    state,
    admissible: state === "admissible",
    evaluatedAtTick120: plannedAtTick120,
    targetRoom: input.targetRoom,
    occurrence: {
      occurrenceId: input.occurrence.occurrenceId,
      patternId: input.occurrence.patternId,
      difficulty: input.occurrence.difficulty,
    },
    poolClassResolution: mappedPoolClass === null
      ? {state: "missing" as const, archetypeId, poolClass: null}
      : {state: "resolved" as const, archetypeId, poolClass: mappedPoolClass},
    carryover: {
      allocatedSlots: carryoverAllocated,
      residueVisuals,
      liveColliders,
    },
    successor: {
      requestedProjectileSlots,
      requestedResidueVisualSlots,
      emitterCount,
      maxEmitters,
      reservationByClass,
    },
    combined: combinedAllocatedSlots === null
      ? null
      : {allocatedSlots: combinedAllocatedSlots, residueVisuals: combinedResidueVisuals},
    limits: {
      poolBudgets: POOL_BUDGETS,
      residueVisualOnly: RESIDUE_VISUAL_ONLY_BUDGET,
      difficultyProjectiles: difficultyLimit,
    },
    checks: {
      patternCapability,
      splitChildUpperBound,
      poolClassMapping,
      collisionlessCarryover,
      emitterCapacity,
      difficultyProjectileCapacity,
      projectilePoolCapacity,
      residueVisualCapacity,
    },
    canonicalEventWrites: 0 as const,
    authorityMutations: 0 as const,
    reservationCommitted: false as const,
  });
}
