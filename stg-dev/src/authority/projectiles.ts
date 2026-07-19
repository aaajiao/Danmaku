import projectileLifecycleJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/projectile-lifecycle-v4.json";

import {
  CanonicalEventBus,
  consumeCanonicalEventBatchReceipt,
  simulationTimeMsForTick,
  type CanonicalEventBatchReceipt,
  type GameplayEventDraft,
} from "./events";

export const PROJECTILE_TICKS_PER_SECOND = 120 as const;

export type ProjectilePoolClass = "micro" | "medium" | "heavy" | "splitChildren";
export type ProjectileLifecycleState =
  | "pooled"
  | "spawn"
  | "arm"
  | "flight"
  | "impact"
  | "cancel"
  | "residue"
  | "cleanup";
export type ProjectileTerminalCause = "impact" | "cancel";

export interface ProjectilePoolBudgets {
  readonly micro: number;
  readonly medium: number;
  readonly heavy: number;
  readonly splitChildren: number;
  readonly residueVisualOnly: number;
}

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface CircleCollider {
  readonly center: Vec2;
  readonly radius: number;
}

export interface CapsuleCollider {
  readonly start: Vec2;
  readonly end: Vec2;
  readonly radius: number;
}

export interface SweepHit {
  /** Normalized time along the previous-to-current projectile segment. */
  readonly timeOfImpact: number;
  readonly projectileCenter: Vec2;
  /** Unit normal pointing from the static collider toward the projectile. */
  readonly normal: Vec2;
}

export interface ProjectileArchetype {
  readonly id: string;
  readonly poolClass: ProjectilePoolClass;
  readonly collisionRadiusPx: number;
}

export interface ProjectileHandle {
  readonly instanceId: string;
  readonly generation: number;
}

export interface ProjectileFlightCollisionChange {
  readonly handle: ProjectileHandle;
  readonly enabled: boolean;
  readonly reason: string;
}

declare const preparedProjectileCollisionBatchBrand: unique symbol;

/** Opaque, one-use proof of a fully validated reversible-collider batch. */
export interface PreparedProjectileCollisionBatch {
  readonly [preparedProjectileCollisionBatchBrand]: "PreparedProjectileCollisionBatch";
}

export interface SpawnProjectileRequest {
  readonly tick120: number;
  /** Authority-side occurrence identity. Replaying it is an error. */
  readonly occurrenceKey: string;
  readonly archetypeId: string;
  readonly position: Vec2;
  readonly armDelayTicks: number;
  readonly residueTicks: number;
  /**
   * Motion operators may own a collision gate at the arm boundary. Omitted
   * callers retain the canonical projectile lifecycle's collision-on default.
   */
  readonly collisionEnabledAtArm?: boolean;
}

export interface ProjectileSnapshot extends ProjectileHandle {
  readonly archetypeId: string;
  readonly poolClass: ProjectilePoolClass;
  readonly collisionRadiusPx: number;
  readonly state: Exclude<ProjectileLifecycleState, "pooled">;
  readonly collisionEnabled: boolean;
  readonly previousPosition: Vec2;
  readonly position: Vec2;
  /** Last master tick whose movement segment ends at `position`. */
  readonly movedAtTick120: number | null;
  readonly spawnedAtTick: number;
  readonly armAtTick: number;
  readonly terminalCause: ProjectileTerminalCause | null;
}

export type ProjectileCancelReason =
  | "pattern_end"
  | "override_void"
  | "source_withdrawn"
  | "out_of_bounds"
  | "room_transition";

export interface ProjectilePoolUsage {
  readonly active: Readonly<Record<ProjectilePoolClass, number>>;
  readonly allocatedSlots: Readonly<Record<ProjectilePoolClass, number>>;
  readonly liveColliders: number;
  readonly residueVisuals: number;
}

export interface ProjectilePoolAuditRecord {
  readonly sequence: number;
  readonly tick120: number;
  readonly occurrenceKey: string;
  readonly kind: "projectile.spawn.rejected" | "projectile.residue-visual.rejected";
  readonly reason: "budget_exhausted";
  readonly poolClass: ProjectilePoolClass | "residueVisualOnly";
  readonly archetypeId: string;
  readonly budget: number;
}

interface ProjectileLifecycleContract {
  readonly states: readonly string[];
  readonly poolBudgets: ProjectilePoolBudgets;
  readonly playerNormalRadiusPx: number;
  readonly playerFocusRadiusPx: number;
}

interface ProjectileSlot {
  readonly instanceId: string;
  readonly poolClass: ProjectilePoolClass;
  generation: number;
  hasSpawned: boolean;
  nextLocalSequence: number;
  state: ProjectileLifecycleState;
  archetype: ProjectileArchetype | null;
  collisionEnabled: boolean;
  previousPosition: Vec2;
  position: Vec2;
  movedAtTick120: number | null;
  spawnedAtTick: number;
  armAtTick: number;
  collisionEnabledAtArm: boolean;
  collisionGateTransitionOrdinal: number;
  residueTicks: number;
  cleanupAtTick: number | null;
  terminalCause: ProjectileTerminalCause | null;
  residueVisualReserved: boolean;
}

interface PreparedProjectileCollisionTransition {
  readonly slot: ProjectileSlot;
  readonly generation: number;
  readonly enabled: boolean;
  readonly expectedCollisionEnabled: boolean;
  readonly expectedLocalSequence: number;
  readonly expectedGateOrdinal: number;
}

interface PreparedProjectileCollisionBatchRecord {
  readonly owner: ProjectileAuthorityPool;
  readonly tick120: number;
  readonly drafts: readonly GameplayEventDraft[];
  readonly transitions: readonly PreparedProjectileCollisionTransition[];
  status: "prepared" | "begun" | "complete";
}

const PREPARED_PROJECTILE_COLLISION_BATCHES = new WeakMap<
  PreparedProjectileCollisionBatch,
  PreparedProjectileCollisionBatchRecord
>();

const POOL_CLASS_ORDER = Object.freeze([
  "micro",
  "medium",
  "heavy",
  "splitChildren",
] as const satisfies readonly ProjectilePoolClass[]);

const EXPECTED_LIFECYCLE_STATES = Object.freeze([
  "spawn",
  "arm",
  "flight",
  "impact",
  "cancel",
  "residue",
  "cleanup",
] as const);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function requireNonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || Object.is(value, -0)) {
    throw new Error(`${path} must be a non-negative safe integer`);
  }
  return value as number;
}

function requirePositiveInteger(value: unknown, path: string): number {
  const result = requireNonNegativeInteger(value, path);
  if (result === 0) throw new Error(`${path} must be positive`);
  return result;
}

function requireFiniteNonNegative(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${path} must be finite and non-negative`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function requireFinitePositive(value: unknown, path: string): number {
  const result = requireFiniteNonNegative(value, path);
  if (result === 0) throw new Error(`${path} must be positive`);
  return result;
}

function readProjectileLifecycleContract(value: unknown): ProjectileLifecycleContract {
  const root = requireRecord(value, "projectile lifecycle manifest");
  if (root.schemaVersion !== "4.0.0" || root.id !== "projectile.lifecycle.v4") {
    throw new Error("unsupported projectile lifecycle manifest identity");
  }

  if (!Array.isArray(root.states)) throw new Error("projectile lifecycle states must be an array");
  const states = root.states.map((entry, index) =>
    requireString(requireRecord(entry, `projectile lifecycle states[${index}]`).id, `projectile lifecycle states[${index}].id`),
  );
  if (
    states.length !== EXPECTED_LIFECYCLE_STATES.length
    || states.some((state, index) => state !== EXPECTED_LIFECYCLE_STATES[index])
  ) {
    throw new Error("projectile lifecycle state order does not match the V4 authority contract");
  }

  const rawBudgets = requireRecord(root.poolBudgets, "projectile lifecycle poolBudgets");
  const budgets = Object.freeze({
    micro: requirePositiveInteger(rawBudgets.micro, "projectile lifecycle poolBudgets.micro"),
    medium: requirePositiveInteger(rawBudgets.medium, "projectile lifecycle poolBudgets.medium"),
    heavy: requirePositiveInteger(rawBudgets.heavy, "projectile lifecycle poolBudgets.heavy"),
    splitChildren: requirePositiveInteger(
      rawBudgets.splitChildren,
      "projectile lifecycle poolBudgets.splitChildren",
    ),
    residueVisualOnly: requirePositiveInteger(
      rawBudgets.residueVisualOnly,
      "projectile lifecycle poolBudgets.residueVisualOnly",
    ),
  });
  if (rawBudgets.overflowPolicy !== "reject_new_spawn_and_log; never recycle a live collider") {
    throw new Error("unsupported projectile pool overflow policy");
  }

  const collision = requireRecord(root.collision, "projectile lifecycle collision");
  if (collision.integration !== "continuous swept circle/capsule") {
    throw new Error("unsupported projectile collision integration contract");
  }

  return Object.freeze({
    states: Object.freeze(states),
    poolBudgets: budgets,
    playerNormalRadiusPx: requireFinitePositive(
      collision.playerNormalRadiusPx,
      "projectile lifecycle collision.playerNormalRadiusPx",
    ),
    playerFocusRadiusPx: requireFinitePositive(
      collision.playerFocusRadiusPx,
      "projectile lifecycle collision.playerFocusRadiusPx",
    ),
  });
}

const LIFECYCLE_CONTRACT = readProjectileLifecycleContract(projectileLifecycleJson);

export const V4_PROJECTILE_LIFECYCLE_STATES = LIFECYCLE_CONTRACT.states;
export const PROJECTILE_POOL_BUDGETS = LIFECYCLE_CONTRACT.poolBudgets;
export const PLAYER_NORMAL_COLLISION_RADIUS_PX = LIFECYCLE_CONTRACT.playerNormalRadiusPx;
export const PLAYER_FOCUS_COLLISION_RADIUS_PX = LIFECYCLE_CONTRACT.playerFocusRadiusPx;

function captureProjectilePoolBudgets(
  value: ProjectilePoolBudgets | undefined,
): ProjectilePoolBudgets {
  if (value === undefined) return PROJECTILE_POOL_BUDGETS;
  const raw = requireRecord(value, "projectile authority poolBudgets");
  const expectedKeys = [
    "heavy",
    "medium",
    "micro",
    "residueVisualOnly",
    "splitChildren",
  ] as const;
  const actualKeys = Object.keys(raw).sort();
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error("projectile authority poolBudgets field contract drifted");
  }
  const captured = Object.freeze({
    micro: requireNonNegativeInteger(raw.micro, "projectile authority poolBudgets.micro"),
    medium: requireNonNegativeInteger(raw.medium, "projectile authority poolBudgets.medium"),
    heavy: requireNonNegativeInteger(raw.heavy, "projectile authority poolBudgets.heavy"),
    splitChildren: requireNonNegativeInteger(
      raw.splitChildren,
      "projectile authority poolBudgets.splitChildren",
    ),
    residueVisualOnly: requireNonNegativeInteger(
      raw.residueVisualOnly,
      "projectile authority poolBudgets.residueVisualOnly",
    ),
  });
  for (const poolClass of POOL_CLASS_ORDER) {
    if (captured[poolClass] > PROJECTILE_POOL_BUDGETS[poolClass]) {
      throw new Error(`projectile authority ${poolClass} budget exceeds the V4 pool`);
    }
  }
  if (captured.residueVisualOnly > PROJECTILE_POOL_BUDGETS.residueVisualOnly) {
    throw new Error("projectile authority residue budget exceeds the V4 pool");
  }
  return captured;
}

function validateVec2(value: Vec2, path: string): Vec2 {
  if (!isRecord(value)) throw new Error(`${path} must be a vector`);
  return Object.freeze({
    x: requireFiniteNonNegativeOrSigned(value.x, `${path}.x`),
    y: requireFiniteNonNegativeOrSigned(value.y, `${path}.y`),
  });
}

function requireFiniteNonNegativeOrSigned(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be finite`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function addScaled(origin: Vec2, delta: Vec2, scale: number): Vec2 {
  return Object.freeze({x: origin.x + delta.x * scale, y: origin.y + delta.y * scale});
}

function subtract(a: Vec2, b: Vec2): Vec2 {
  return {x: a.x - b.x, y: a.y - b.y};
}

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

function lengthSquared(value: Vec2): number {
  return dot(value, value);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizedOrFallback(value: Vec2, fallback: Vec2): Vec2 {
  const magnitudeSquared = lengthSquared(value);
  if (magnitudeSquared > Number.EPSILON) {
    const inverseMagnitude = 1 / Math.sqrt(magnitudeSquared);
    return Object.freeze({x: value.x * inverseMagnitude, y: value.y * inverseMagnitude});
  }
  const fallbackMagnitudeSquared = lengthSquared(fallback);
  if (fallbackMagnitudeSquared > Number.EPSILON) {
    const inverseMagnitude = 1 / Math.sqrt(fallbackMagnitudeSquared);
    return Object.freeze({x: fallback.x * inverseMagnitude, y: fallback.y * inverseMagnitude});
  }
  return Object.freeze({x: 1, y: 0});
}

function nearestPointOnSegment(point: Vec2, start: Vec2, end: Vec2): Vec2 {
  const segment = subtract(end, start);
  const segmentLengthSquared = lengthSquared(segment);
  if (segmentLengthSquared <= Number.EPSILON) return Object.freeze({...start});
  const along = clamp01(dot(subtract(point, start), segment) / segmentLengthSquared);
  return addScaled(start, segment, along);
}

function makeHit(
  from: Vec2,
  delta: Vec2,
  timeOfImpact: number,
  nearestStaticPoint: Vec2,
): SweepHit {
  const time = clamp01(timeOfImpact);
  const projectileCenter = addScaled(from, delta, time);
  return Object.freeze({
    timeOfImpact: time,
    projectileCenter,
    normal: normalizedOrFallback(subtract(projectileCenter, nearestStaticPoint), {
      x: -delta.x,
      y: -delta.y,
    }),
  });
}

function sweepPointAgainstCircle(
  from: Vec2,
  to: Vec2,
  center: Vec2,
  expandedRadius: number,
): SweepHit | null {
  const delta = subtract(to, from);
  const offset = subtract(from, center);
  const radiusSquared = expandedRadius * expandedRadius;
  if (lengthSquared(offset) <= radiusSquared) return makeHit(from, delta, 0, center);

  const a = lengthSquared(delta);
  if (a <= Number.EPSILON) return null;
  const b = 2 * dot(offset, delta);
  const c = lengthSquared(offset) - radiusSquared;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const time = (-b - Math.sqrt(Math.max(0, discriminant))) / (2 * a);
  if (time < 0 || time > 1) return null;
  return makeHit(from, delta, time, center);
}

/** Continuous moving-circle against static-circle test; sprite alpha is absent by design. */
export function sweepCircleAgainstCircle(
  fromValue: Vec2,
  toValue: Vec2,
  movingRadiusValue: number,
  colliderValue: CircleCollider,
): SweepHit | null {
  const from = validateVec2(fromValue, "sweep from");
  const to = validateVec2(toValue, "sweep to");
  const movingRadius = requireFiniteNonNegative(movingRadiusValue, "moving circle radius");
  const collider = requireRecord(colliderValue, "circle collider");
  const center = validateVec2(collider.center as Vec2, "circle collider.center");
  const radius = requireFiniteNonNegative(collider.radius, "circle collider.radius");
  return sweepPointAgainstCircle(from, to, center, movingRadius + radius);
}

/**
 * Continuous moving-circle against static capsule. It tests both round caps and
 * the finite side strip, so a projectile cannot tunnel through a long collider.
 */
export function sweepCircleAgainstCapsule(
  fromValue: Vec2,
  toValue: Vec2,
  movingRadiusValue: number,
  colliderValue: CapsuleCollider,
): SweepHit | null {
  const from = validateVec2(fromValue, "sweep from");
  const to = validateVec2(toValue, "sweep to");
  const movingRadius = requireFiniteNonNegative(movingRadiusValue, "moving circle radius");
  const collider = requireRecord(colliderValue, "capsule collider");
  const start = validateVec2(collider.start as Vec2, "capsule collider.start");
  const end = validateVec2(collider.end as Vec2, "capsule collider.end");
  const radius = requireFiniteNonNegative(collider.radius, "capsule collider.radius");
  const expandedRadius = movingRadius + radius;
  const delta = subtract(to, from);
  const axis = subtract(end, start);
  const axisLengthSquared = lengthSquared(axis);

  if (axisLengthSquared <= Number.EPSILON) {
    return sweepPointAgainstCircle(from, to, start, expandedRadius);
  }

  const nearestAtStart = nearestPointOnSegment(from, start, end);
  if (lengthSquared(subtract(from, nearestAtStart)) <= expandedRadius * expandedRadius) {
    return makeHit(from, delta, 0, nearestAtStart);
  }

  const candidates: SweepHit[] = [];
  const startCap = sweepPointAgainstCircle(from, to, start, expandedRadius);
  if (startCap !== null) candidates.push(startCap);
  const endCap = sweepPointAgainstCircle(from, to, end, expandedRadius);
  if (endCap !== null) candidates.push(endCap);

  const axisLength = Math.sqrt(axisLengthSquared);
  const tangent = {x: axis.x / axisLength, y: axis.y / axisLength};
  const normal = {x: -tangent.y, y: tangent.x};
  const fromRelative = subtract(from, start);
  const initialNormal = dot(fromRelative, normal);
  const normalVelocity = dot(delta, normal);
  const initialTangent = dot(fromRelative, tangent);
  const tangentVelocity = dot(delta, tangent);

  if (Math.abs(normalVelocity) > Number.EPSILON) {
    for (const side of [-1, 1] as const) {
      const time = (side * expandedRadius - initialNormal) / normalVelocity;
      if (time < 0 || time > 1) continue;
      const along = initialTangent + tangentVelocity * time;
      if (along < 0 || along > axisLength) continue;
      const nearest = addScaled(start, tangent, along);
      candidates.push(makeHit(from, delta, time, nearest));
    }
  }

  candidates.sort((a, b) => a.timeOfImpact - b.timeOfImpact);
  return candidates[0] ?? null;
}

function freezeArchetype(value: ProjectileArchetype, index: number): ProjectileArchetype {
  const raw = requireRecord(value, `projectile archetypes[${index}]`);
  const id = requireString(raw.id, `projectile archetypes[${index}].id`);
  const poolClass = raw.poolClass;
  if (!POOL_CLASS_ORDER.includes(poolClass as ProjectilePoolClass)) {
    throw new Error(`projectile archetypes[${index}].poolClass is invalid`);
  }
  return Object.freeze({
    id,
    poolClass: poolClass as ProjectilePoolClass,
    collisionRadiusPx: requireFinitePositive(
      raw.collisionRadiusPx,
      `projectile archetypes[${index}].collisionRadiusPx`,
    ),
  });
}

function emptyClassCounts(): Record<ProjectilePoolClass, number> {
  return {micro: 0, medium: 0, heavy: 0, splitChildren: 0};
}

function canonicalAuditSerialization(records: readonly ProjectilePoolAuditRecord[]): string {
  return JSON.stringify(records.map((record) => ({
    archetypeId: record.archetypeId,
    budget: record.budget,
    kind: record.kind,
    occurrenceKey: record.occurrenceKey,
    poolClass: record.poolClass,
    reason: record.reason,
    sequence: record.sequence,
    tick120: record.tick120,
  })));
}

function captureFlightCollisionChanges(
  value: unknown,
): readonly Readonly<ProjectileFlightCollisionChange>[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new Error("projectile collision-gate changes must be a plain array");
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error("projectile collision-gate changes must not use symbols");
  }
  const arrayDescriptors = Object.getOwnPropertyDescriptors(value) as Record<
    string,
    PropertyDescriptor
  >;
  const lengthDescriptor = arrayDescriptors.length;
  const length = lengthDescriptor !== undefined && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (!Number.isSafeInteger(length) || (length as number) <= 0) {
    throw new Error("projectile collision-gate changes must be a non-empty dense array");
  }
  const expectedArrayKeys = Array.from({length: length as number}, (_, index) => String(index))
    .concat("length")
    .sort();
  const actualArrayKeys = Object.keys(arrayDescriptors).sort();
  if (
    actualArrayKeys.length !== expectedArrayKeys.length
    || actualArrayKeys.some((key, index) => key !== expectedArrayKeys[index])
  ) {
    throw new Error("projectile collision-gate changes must be a non-empty dense array");
  }
  return Object.freeze(Array.from({length: length as number}, (_, index) => {
    const elementDescriptor = arrayDescriptors[String(index)];
    if (
      elementDescriptor === undefined
      || !("value" in elementDescriptor)
      || elementDescriptor.enumerable !== true
    ) {
      throw new Error(`projectile collision-gate changes[${index}] must be an own data element`);
    }
    const change = elementDescriptor.value;
    if (
      typeof change !== "object"
      || change === null
      || Array.isArray(change)
      || (Object.getPrototypeOf(change) !== Object.prototype
        && Object.getPrototypeOf(change) !== null)
      || Object.getOwnPropertySymbols(change).length > 0
    ) {
      throw new Error(`projectile collision-gate changes[${index}] must be a plain object`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(change);
    const expectedKeys = ["enabled", "handle", "reason"];
    const actualKeys = Object.keys(descriptors).sort();
    if (
      actualKeys.length !== expectedKeys.length
      || actualKeys.some((key, keyIndex) => key !== expectedKeys[keyIndex])
    ) {
      throw new Error(`projectile collision-gate changes[${index}] field contract drifted`);
    }
    const read = (key: "enabled" | "handle" | "reason"): unknown => {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
        throw new Error(
          `projectile collision-gate changes[${index}].${key} must be an own data property`,
        );
      }
      return descriptor.value;
    };
    const enabled = read("enabled");
    if (typeof enabled !== "boolean") {
      throw new Error(`projectile collision-gate changes[${index}].enabled must be boolean`);
    }
    return Object.freeze({
      handle: read("handle") as ProjectileHandle,
      enabled,
      reason: requireString(
        read("reason"),
        `projectile collision-gate changes[${index}].reason`,
      ),
    });
  }));
}

/**
 * Entity-owned projectile authority. Presentation may observe snapshots and
 * events, but it cannot advance this state machine or reclaim its live slots.
 */
export class ProjectileAuthorityPool {
  private readonly authorityId: string;
  private readonly poolBudgets: ProjectilePoolBudgets;
  private readonly archetypes = new Map<string, ProjectileArchetype>();
  private readonly slots: Record<ProjectilePoolClass, ProjectileSlot[]> = {
    micro: [],
    medium: [],
    heavy: [],
    splitChildren: [],
  };
  private readonly claimedSpawnOccurrences = new Set<string>();
  private readonly auditRecords: ProjectilePoolAuditRecord[] = [];
  private currentTick = 0;
  private nextAuditSequence = 0;
  private residueVisualCount = 0;

  constructor(
    private readonly bus: CanonicalEventBus,
    options: {
      readonly authorityId: string;
      readonly archetypes: readonly ProjectileArchetype[];
      readonly poolBudgets?: ProjectilePoolBudgets;
    },
  ) {
    this.authorityId = requireString(options.authorityId, "projectile authorityId");
    this.poolBudgets = captureProjectilePoolBudgets(options.poolBudgets);
    if (!Array.isArray(options.archetypes) || options.archetypes.length === 0) {
      throw new Error("projectile archetypes must be a non-empty array");
    }
    for (const [index, value] of options.archetypes.entries()) {
      const archetype = freezeArchetype(value, index);
      if (this.archetypes.has(archetype.id)) {
        throw new Error(`duplicate projectile archetype: ${archetype.id}`);
      }
      this.archetypes.set(archetype.id, archetype);
    }
  }

  spawn(request: SpawnProjectileRequest): ProjectileHandle | null {
    const raw = requireRecord(request, "projectile spawn request");
    const tick120 = requireNonNegativeInteger(raw.tick120, "projectile spawn tick120");
    const occurrenceKey = requireString(raw.occurrenceKey, "projectile spawn occurrenceKey");
    if (this.claimedSpawnOccurrences.has(occurrenceKey)) {
      throw new Error(`duplicate projectile spawn occurrence: ${occurrenceKey}`);
    }
    const archetypeId = requireString(raw.archetypeId, "projectile spawn archetypeId");
    const archetype = this.archetypes.get(archetypeId);
    if (archetype === undefined) throw new Error(`unknown projectile archetype: ${archetypeId}`);
    const position = validateVec2(raw.position as Vec2, "projectile spawn position");
    const armDelayTicks = requireNonNegativeInteger(raw.armDelayTicks, "projectile armDelayTicks");
    const residueTicks = requireNonNegativeInteger(raw.residueTicks, "projectile residueTicks");
    const collisionEnabledAtArm = raw.collisionEnabledAtArm === undefined
      ? true
      : raw.collisionEnabledAtArm;
    if (typeof collisionEnabledAtArm !== "boolean") {
      throw new Error("projectile collisionEnabledAtArm must be boolean when supplied");
    }

    this.advanceTo(tick120);
    this.claimedSpawnOccurrences.add(occurrenceKey);
    const classSlots = this.slots[archetype.poolClass];
    let slot = classSlots.find((candidate) => candidate.state === "pooled");
    if (slot === undefined && classSlots.length < this.poolBudgets[archetype.poolClass]) {
      slot = this.createSlot(archetype.poolClass, classSlots.length);
      classSlots.push(slot);
    }
    if (slot === undefined) {
      this.recordAudit({
        tick120,
        occurrenceKey: `${this.authorityId}:${occurrenceKey}:spawn-rejected`,
        kind: "projectile.spawn.rejected",
        poolClass: archetype.poolClass,
        archetypeId,
        budget: this.poolBudgets[archetype.poolClass],
      });
      return null;
    }

    this.beginSpawn(
      slot,
      archetype,
      position,
      tick120,
      armDelayTicks,
      residueTicks,
      collisionEnabledAtArm,
    );
    return Object.freeze({instanceId: slot.instanceId, generation: slot.generation});
  }

  advanceTo(tick120Value: number): void {
    const tick120 = requireNonNegativeInteger(tick120Value, "projectile advance tick120");
    this.advanceToTick(tick120);
  }

  private advanceToTick(
    tick120: number,
    sameTickArmCancellations: ReadonlySet<ProjectileSlot> = new Set(),
  ): void {
    if (tick120 < this.currentTick) {
      throw new Error(`projectile authority cannot move backward from tick ${this.currentTick} to ${tick120}`);
    }

    for (const poolClass of POOL_CLASS_ORDER) {
      for (const slot of this.slots[poolClass]) {
        if (
          slot.state === "flight"
          && slot.movedAtTick120 !== null
          && slot.movedAtTick120 < tick120
        ) {
          slot.previousPosition = slot.position;
        }
        const cancelsBeforeSameTickArm = slot.armAtTick === tick120
          && sameTickArmCancellations.has(slot);
        if (slot.state === "arm" && slot.armAtTick <= tick120 && !cancelsBeforeSameTickArm) {
          this.enterFlight(slot, slot.armAtTick);
        }
        if (slot.state === "residue" && slot.cleanupAtTick !== null && slot.cleanupAtTick <= tick120) {
          this.completeLifecycle(slot, slot.cleanupAtTick);
        }
      }
    }
    this.currentTick = tick120;
  }

  move(handle: ProjectileHandle, tick120Value: number, nextPositionValue: Vec2): ProjectileSnapshot {
    const tick120 = requireNonNegativeInteger(tick120Value, "projectile move tick120");
    const nextPosition = validateVec2(nextPositionValue, "projectile next position");
    if (tick120 < this.currentTick) {
      throw new Error(`projectile authority cannot move backward from tick ${this.currentTick} to ${tick120}`);
    }
    const slot = this.resolve(handle);
    if (slot.state !== "flight" && !(slot.state === "arm" && slot.armAtTick <= tick120)) {
      throw new Error(`projectile cannot move from ${slot.state}`);
    }
    this.advanceToTick(tick120);
    if (slot.state !== "flight") throw new Error(`projectile cannot move from ${slot.state}`);
    if (slot.movedAtTick120 !== tick120) slot.previousPosition = slot.position;
    slot.position = nextPosition;
    slot.movedAtTick120 = tick120;
    return this.snapshotSlot(slot);
  }

  /**
   * Change only a live flight collider lease. The projectile keeps its entity,
   * position, movement clock, and terminal lifecycle; presentation cannot call
   * this port because the owning gameplay operator retains the handle.
   */
  setFlightCollision(
    handle: ProjectileHandle,
    tick120Value: number,
    enabledValue: boolean,
    reasonValue: string,
  ): ProjectileSnapshot {
    const tick120 = requireNonNegativeInteger(tick120Value, "projectile collision-gate tick120");
    if (typeof enabledValue !== "boolean") {
      throw new Error("projectile collision-gate enabled must be boolean");
    }
    const reason = requireString(reasonValue, "projectile collision-gate reason");
    if (tick120 !== this.currentTick) {
      throw new Error(
        `projectile collision-gate requires authority at exact tick ${tick120}; current ${this.currentTick}`,
      );
    }
    const slot = this.resolve(handle);
    if (slot.state !== "flight") {
      throw new Error(`projectile cannot change collision gate from ${slot.state}`);
    }
    if (slot.armAtTick >= tick120) {
      throw new Error(`projectile cannot change collision gate on activation tick ${tick120}`);
    }
    if (slot.collisionEnabled === enabledValue) return this.snapshotSlot(slot);
    const prepared = this.prepareFlightCollisionBatch(tick120, Object.freeze([Object.freeze({
      handle,
      enabled: enabledValue,
      reason,
    })]));
    this.beginPreparedFlightCollisionBatch(prepared);
    this.finishPreparedFlightCollisionBatch(prepared);
    return this.snapshotSlot(slot);
  }

  /**
   * Stage every reversible collision transition for one exact master tick.
   * No event or projectile state changes until `beginPrepared...` atomically
   * appends the complete off/on draft set.
   */
  prepareFlightCollisionBatch(
    tick120Value: number,
    changesValue: readonly ProjectileFlightCollisionChange[],
  ): PreparedProjectileCollisionBatch {
    const tick120 = requireNonNegativeInteger(
      tick120Value,
      "projectile collision-gate batch tick120",
    );
    if (tick120 !== this.currentTick) {
      throw new Error(
        `projectile collision-gate batch requires authority at exact tick ${tick120}; current ${this.currentTick}`,
      );
    }
    const changes = captureFlightCollisionChanges(changesValue);
    const targetKeys = new Set<string>();
    const transitions: PreparedProjectileCollisionTransition[] = [];
    const drafts: GameplayEventDraft[] = [];
    for (let index = 0; index < changes.length; index += 1) {
      const change = changes[index];
      if (change === undefined) throw new Error("projectile collision-gate change disappeared");
      const slot = this.resolve(change.handle);
      const targetKey = `${slot.instanceId}:${slot.generation}`;
      if (targetKeys.has(targetKey)) {
        throw new Error(`duplicate projectile collision-gate handle: ${targetKey}`);
      }
      targetKeys.add(targetKey);
      if (slot.state !== "flight") {
        throw new Error(`projectile cannot change collision gate from ${slot.state}`);
      }
      if (slot.armAtTick >= tick120) {
        throw new Error(`projectile cannot change collision gate on activation tick ${tick120}`);
      }
      if (slot.collisionEnabled === change.enabled) continue;
      const ordinal = slot.collisionGateTransitionOrdinal;
      const suffix = change.enabled ? "on" : "off";
      transitions.push(Object.freeze({
        slot,
        generation: slot.generation,
        enabled: change.enabled,
        expectedCollisionEnabled: slot.collisionEnabled,
        expectedLocalSequence: slot.nextLocalSequence,
        expectedGateOrdinal: ordinal,
      }));
      drafts.push(Object.freeze({
        id: change.enabled ? "projectile.collision.on" : "projectile.collision.off",
        tick120,
        entityStableId: slot.instanceId,
        localSequence: slot.nextLocalSequence,
        occurrenceKey: `${slot.instanceId}:${slot.generation}:collision-gate:${ordinal}:${suffix}`,
        payload: change.enabled
          ? Object.freeze({instanceId: slot.instanceId, generation: slot.generation})
          : Object.freeze({
              instanceId: slot.instanceId,
              generation: slot.generation,
              reason: change.reason,
            }),
      }));
    }
    if (transitions.length === 0) {
      throw new Error("projectile collision-gate batch contains no state transition");
    }
    const token = Object.freeze(Object.create(null)) as PreparedProjectileCollisionBatch;
    PREPARED_PROJECTILE_COLLISION_BATCHES.set(token, {
      owner: this,
      tick120,
      drafts: Object.freeze(drafts),
      transitions: Object.freeze(transitions),
      status: "prepared",
    });
    return token;
  }

  /** Append the full batch, then apply only collision-off assignments. */
  beginPreparedFlightCollisionBatch(prepared: PreparedProjectileCollisionBatch): void {
    const record = this.requirePreparedFlightCollisionBatch(prepared, "prepared");
    this.validatePreparedFlightCollisionTransitions(record);
    const receipts = CanonicalEventBus.prototype.enqueuePreparedBatch.call(
      this.bus,
      Object.freeze([record.drafts]),
    );
    consumeCanonicalEventBatchReceipt(
      receipts[0] as CanonicalEventBatchReceipt,
      this.bus,
      record.drafts,
    );
    for (const transition of record.transitions) {
      if (transition.enabled) continue;
      transition.slot.collisionEnabled = false;
      transition.slot.collisionGateTransitionOrdinal += 1;
      transition.slot.nextLocalSequence += 1;
    }
    record.status = "begun";
  }

  /** Apply preaccepted collision-on assignments after same-tick state/damage. */
  finishPreparedFlightCollisionBatch(prepared: PreparedProjectileCollisionBatch): void {
    const record = this.requirePreparedFlightCollisionBatch(prepared, "begun");
    for (const transition of record.transitions) {
      if (!transition.enabled) continue;
      const slot = transition.slot;
      if (
        slot.state !== "flight"
        || slot.generation !== transition.generation
        || slot.collisionEnabled !== transition.expectedCollisionEnabled
        || slot.nextLocalSequence !== transition.expectedLocalSequence
        || slot.collisionGateTransitionOrdinal !== transition.expectedGateOrdinal
      ) {
        throw new Error("prepared projectile collision-on transition became stale");
      }
    }
    for (const transition of record.transitions) {
      if (!transition.enabled) continue;
      transition.slot.collisionEnabled = true;
      transition.slot.collisionGateTransitionOrdinal += 1;
      transition.slot.nextLocalSequence += 1;
    }
    record.status = "complete";
  }

  impact(handle: ProjectileHandle, tick120Value: number, targetIdValue: string): void {
    const tick120 = requireNonNegativeInteger(tick120Value, "projectile impact tick120");
    const targetId = requireString(targetIdValue, "projectile impact targetId");
    if (tick120 < this.currentTick) {
      throw new Error(`projectile authority cannot move backward from tick ${this.currentTick} to ${tick120}`);
    }
    const slot = this.resolve(handle);
    if (slot.state !== "arm" && slot.state !== "flight") {
      throw new Error(`projectile cannot impact from ${slot.state}`);
    }
    if (slot.armAtTick === tick120) {
      throw new Error(`projectile cannot impact on activation tick ${tick120}`);
    }
    if (slot.state === "arm" && slot.armAtTick > tick120) {
      throw new Error(`projectile cannot impact from ${slot.state}`);
    }

    this.advanceToTick(tick120);
    if (slot.state !== "flight") throw new Error(`projectile cannot impact from ${slot.state}`);
    slot.state = "impact";
    slot.collisionEnabled = false;
    this.emit(slot, "projectile.collision.off", tick120, {
      instanceId: slot.instanceId,
      generation: slot.generation,
      reason: "impact",
    }, "collision-off");
    this.emit(slot, "projectile.impact.commit", tick120, {
      instanceId: slot.instanceId,
      generation: slot.generation,
      targetId,
    }, "impact");
    this.enterResidue(slot, tick120, "impact");
  }

  cancel(handle: ProjectileHandle, tick120Value: number, reasonValue: ProjectileCancelReason): void {
    this.cancelMany([handle], tick120Value, reasonValue);
  }

  /**
   * Cancels a complete handle set as one scheduling decision. Targets due to
   * arm on this exact tick stay in `arm` until their cancellation commits, so
   * phase ordering cannot expose a trailing collision-on for a cancelled body.
   */
  cancelMany(
    handlesValue: readonly ProjectileHandle[],
    tick120Value: number,
    reasonValue: ProjectileCancelReason,
  ): void {
    const tick120 = requireNonNegativeInteger(tick120Value, "projectile cancel tick120");
    const reason = requireString(reasonValue, "projectile cancel reason") as ProjectileCancelReason;
    if (![
      "pattern_end",
      "override_void",
      "source_withdrawn",
      "out_of_bounds",
      "room_transition",
    ].includes(reason)) {
      throw new Error(`unsupported projectile cancel reason: ${reason}`);
    }
    if (!Array.isArray(handlesValue) || handlesValue.length === 0) {
      throw new Error("projectile cancel handles must be a non-empty array");
    }
    if (tick120 < this.currentTick) {
      throw new Error(`projectile authority cannot move backward from tick ${this.currentTick} to ${tick120}`);
    }

    // Resolve and validate the entire set before advancing unrelated due work
    // or mutating a target. A malformed, stale, terminal, or duplicate handle
    // therefore fails closed without a partial cancellation.
    const slots: ProjectileSlot[] = [];
    const targetKeys = new Set<string>();
    for (const handle of handlesValue) {
      const slot = this.resolve(handle);
      const targetKey = `${slot.instanceId}:${slot.generation}`;
      if (targetKeys.has(targetKey)) {
        throw new Error(`duplicate projectile cancel handle: ${targetKey}`);
      }
      targetKeys.add(targetKey);
      if (slot.state !== "arm" && slot.state !== "flight") {
        throw new Error(`projectile cannot cancel from ${slot.state}`);
      }
      slots.push(slot);
    }
    for (const slot of slots) {
      if (slot.state === "flight" && slot.armAtTick === tick120) {
        throw new Error(`projectile cannot cancel on activation tick ${tick120}`);
      }
    }
    slots.sort((left, right) => left.instanceId < right.instanceId
      ? -1
      : left.instanceId > right.instanceId
        ? 1
        : left.generation - right.generation);

    this.advanceToTick(tick120, new Set(slots));
    for (const slot of slots) this.cancelSlot(slot, tick120, reason);
  }

  sweepAgainstCircle(handle: ProjectileHandle, collider: CircleCollider): SweepHit | null {
    const slot = this.resolve(handle);
    if (slot.state !== "flight" || !slot.collisionEnabled || slot.archetype === null) return null;
    return sweepCircleAgainstCircle(
      slot.previousPosition,
      slot.position,
      slot.archetype.collisionRadiusPx,
      collider,
    );
  }

  sweepAgainstCapsule(handle: ProjectileHandle, collider: CapsuleCollider): SweepHit | null {
    const slot = this.resolve(handle);
    if (slot.state !== "flight" || !slot.collisionEnabled || slot.archetype === null) return null;
    return sweepCircleAgainstCapsule(
      slot.previousPosition,
      slot.position,
      slot.archetype.collisionRadiusPx,
      collider,
    );
  }

  snapshot(handle: ProjectileHandle): ProjectileSnapshot {
    return this.snapshotSlot(this.resolve(handle));
  }

  activeSnapshots(): readonly ProjectileSnapshot[] {
    const snapshots: ProjectileSnapshot[] = [];
    for (const poolClass of POOL_CLASS_ORDER) {
      for (const slot of this.slots[poolClass]) {
        if (slot.state !== "pooled") snapshots.push(this.snapshotSlot(slot));
      }
    }
    return Object.freeze(snapshots);
  }

  isActive(handle: ProjectileHandle): boolean {
    const slot = this.findSlot(handle.instanceId);
    return slot !== undefined && slot.state !== "pooled" && slot.generation === handle.generation;
  }

  usage(): ProjectilePoolUsage {
    const active = emptyClassCounts();
    const allocatedSlots = emptyClassCounts();
    let liveColliders = 0;
    for (const poolClass of POOL_CLASS_ORDER) {
      allocatedSlots[poolClass] = this.slots[poolClass].length;
      for (const slot of this.slots[poolClass]) {
        if (slot.state !== "pooled") active[poolClass] += 1;
        if (slot.collisionEnabled) liveColliders += 1;
      }
    }
    return Object.freeze({
      active: Object.freeze(active),
      allocatedSlots: Object.freeze(allocatedSlots),
      liveColliders,
      residueVisuals: this.residueVisualCount,
    });
  }

  auditLog(): readonly ProjectilePoolAuditRecord[] {
    return Object.freeze(this.auditRecords.slice());
  }

  canonicalAuditSerialization(): string {
    return canonicalAuditSerialization(this.auditRecords);
  }

  private requirePreparedFlightCollisionBatch(
    prepared: PreparedProjectileCollisionBatch,
    expectedStatus: "prepared" | "begun",
  ): PreparedProjectileCollisionBatchRecord {
    const record = PREPARED_PROJECTILE_COLLISION_BATCHES.get(prepared);
    if (record === undefined || record.owner !== this) {
      throw new Error("prepared projectile collision-gate batch is not owned by this authority");
    }
    if (record.status !== expectedStatus) {
      throw new Error(`prepared projectile collision-gate batch is ${record.status}`);
    }
    if (record.tick120 !== this.currentTick) {
      throw new Error("prepared projectile collision-gate batch became stale by tick");
    }
    return record;
  }

  private validatePreparedFlightCollisionTransitions(
    record: PreparedProjectileCollisionBatchRecord,
  ): void {
    for (const transition of record.transitions) {
      const slot = transition.slot;
      if (
        slot.state !== "flight"
        || slot.generation !== transition.generation
        || slot.armAtTick >= record.tick120
        || slot.collisionEnabled !== transition.expectedCollisionEnabled
        || slot.nextLocalSequence !== transition.expectedLocalSequence
        || slot.collisionGateTransitionOrdinal !== transition.expectedGateOrdinal
      ) {
        throw new Error("prepared projectile collision-gate transition became stale");
      }
    }
  }

  private createSlot(poolClass: ProjectilePoolClass, index: number): ProjectileSlot {
    const width = String(PROJECTILE_POOL_BUDGETS[poolClass] - 1).length;
    const position = Object.freeze({x: 0, y: 0});
    return {
      instanceId: `${this.authorityId}/${poolClass}/${String(index).padStart(width, "0")}`,
      poolClass,
      generation: 0,
      hasSpawned: false,
      nextLocalSequence: 0,
      state: "pooled",
      archetype: null,
      collisionEnabled: false,
      previousPosition: position,
      position,
      movedAtTick120: null,
      spawnedAtTick: 0,
      armAtTick: 0,
      collisionEnabledAtArm: true,
      collisionGateTransitionOrdinal: 0,
      residueTicks: 0,
      cleanupAtTick: null,
      terminalCause: null,
      residueVisualReserved: false,
    };
  }

  private beginSpawn(
    slot: ProjectileSlot,
    archetype: ProjectileArchetype,
    position: Vec2,
    tick120: number,
    armDelayTicks: number,
    residueTicks: number,
    collisionEnabledAtArm: boolean,
  ): void {
    if (slot.state !== "pooled") throw new Error("live projectile slots cannot be recycled");
    if (slot.hasSpawned) slot.generation += 1;
    slot.hasSpawned = true;
    slot.state = "spawn";
    slot.archetype = archetype;
    slot.collisionEnabled = false;
    slot.previousPosition = position;
    slot.position = position;
    slot.movedAtTick120 = null;
    slot.spawnedAtTick = tick120;
    slot.armAtTick = tick120 + armDelayTicks;
    slot.collisionEnabledAtArm = collisionEnabledAtArm;
    slot.collisionGateTransitionOrdinal = 0;
    slot.residueTicks = residueTicks;
    slot.cleanupAtTick = null;
    slot.terminalCause = null;
    slot.residueVisualReserved = false;

    this.emit(slot, "projectile.spawn.commit", tick120, {
      instanceId: slot.instanceId,
      generation: slot.generation,
      archetypeId: archetype.id,
    }, "spawn");
    slot.state = "arm";
    this.emit(slot, "projectile.arm.begin", tick120, {
      instanceId: slot.instanceId,
      generation: slot.generation,
      readyAtMs: simulationTimeMsForTick(slot.armAtTick),
    }, "arm-begin");
    if (armDelayTicks === 0) this.enterFlight(slot, tick120);
  }

  private enterFlight(slot: ProjectileSlot, tick120: number): void {
    if (slot.state !== "arm") throw new Error(`projectile cannot arm from ${slot.state}`);
    slot.state = "flight";
    this.emit(slot, "projectile.armed", tick120, {
      instanceId: slot.instanceId,
      generation: slot.generation,
    }, "armed");
    slot.collisionEnabled = slot.collisionEnabledAtArm;
    if (slot.collisionEnabled) {
      this.emit(slot, "projectile.collision.on", tick120, {
        instanceId: slot.instanceId,
        generation: slot.generation,
      }, "collision-on");
    }
    this.emit(slot, "projectile.flight.begin", tick120, {
      instanceId: slot.instanceId,
      generation: slot.generation,
      ownership: "entity",
    }, "flight-begin");
  }

  private cancelSlot(
    slot: ProjectileSlot,
    tick120: number,
    reason: ProjectileCancelReason,
  ): void {
    slot.state = "cancel";
    slot.collisionEnabled = false;
    this.emit(slot, "projectile.collision.off", tick120, {
      instanceId: slot.instanceId,
      generation: slot.generation,
      reason,
    }, "collision-off");
    this.emit(slot, "projectile.cancel.commit", tick120, {
      instanceId: slot.instanceId,
      generation: slot.generation,
      reason,
    }, "cancel");
    this.enterResidue(slot, tick120, "cancel");
  }

  private enterResidue(
    slot: ProjectileSlot,
    tick120: number,
    cause: ProjectileTerminalCause,
  ): void {
    slot.state = "residue";
    slot.terminalCause = cause;
    slot.cleanupAtTick = tick120 + slot.residueTicks;
    if (this.residueVisualCount < this.poolBudgets.residueVisualOnly) {
      this.residueVisualCount += 1;
      slot.residueVisualReserved = true;
    } else {
      this.recordAudit({
        tick120,
        occurrenceKey: `${slot.instanceId}:${slot.generation}:residue-visual-rejected`,
        kind: "projectile.residue-visual.rejected",
        poolClass: "residueVisualOnly",
        archetypeId: slot.archetype?.id ?? "unknown",
        budget: this.poolBudgets.residueVisualOnly,
      });
    }
    this.emit(slot, "projectile.residue.begin", tick120, {
      instanceId: slot.instanceId,
      generation: slot.generation,
      cause,
      removeAtMs: simulationTimeMsForTick(slot.cleanupAtTick),
    }, "residue-begin");
    if (slot.residueTicks === 0) this.completeLifecycle(slot, tick120);
  }

  private completeLifecycle(slot: ProjectileSlot, tick120: number): void {
    if (slot.state !== "residue" || slot.terminalCause === null) {
      throw new Error(`projectile cannot complete from ${slot.state}`);
    }
    const cause = slot.terminalCause;
    slot.state = "cleanup";
    this.emit(slot, "projectile.residue.remove", tick120, {
      instanceId: slot.instanceId,
      generation: slot.generation,
      cause,
    }, "residue-remove");
    this.emit(slot, "projectile.lifecycle.complete", tick120, {
      instanceId: slot.instanceId,
      generation: slot.generation,
      cause,
    }, "complete");
    if (slot.residueVisualReserved) {
      this.residueVisualCount -= 1;
      slot.residueVisualReserved = false;
    }
    slot.collisionEnabled = false;
    slot.cleanupAtTick = null;
    slot.archetype = null;
    slot.state = "pooled";
  }

  private emit(
    slot: ProjectileSlot,
    id: string,
    tick120: number,
    payload: Readonly<Record<string, string | number>>,
    occurrenceSuffix: string,
  ): void {
    this.bus.enqueue({
      id,
      tick120,
      entityStableId: slot.instanceId,
      localSequence: slot.nextLocalSequence,
      occurrenceKey: `${slot.instanceId}:${slot.generation}:${occurrenceSuffix}`,
      payload,
    });
    slot.nextLocalSequence += 1;
  }

  private recordAudit(
    value: Omit<ProjectilePoolAuditRecord, "sequence" | "reason">,
  ): void {
    this.auditRecords.push(Object.freeze({
      sequence: this.nextAuditSequence,
      reason: "budget_exhausted",
      ...value,
    }));
    this.nextAuditSequence += 1;
  }

  private resolve(handleValue: ProjectileHandle): ProjectileSlot {
    const raw = requireRecord(handleValue, "projectile handle");
    const instanceId = requireString(raw.instanceId, "projectile handle.instanceId");
    const generation = requireNonNegativeInteger(raw.generation, "projectile handle.generation");
    const slot = this.findSlot(instanceId);
    if (slot === undefined || slot.state === "pooled" || slot.generation !== generation) {
      throw new Error(`stale or inactive projectile handle: ${instanceId}:${generation}`);
    }
    return slot;
  }

  private findSlot(instanceId: string): ProjectileSlot | undefined {
    for (const poolClass of POOL_CLASS_ORDER) {
      const slot = this.slots[poolClass].find((candidate) => candidate.instanceId === instanceId);
      if (slot !== undefined) return slot;
    }
    return undefined;
  }

  private snapshotSlot(slot: ProjectileSlot): ProjectileSnapshot {
    if (slot.state === "pooled" || slot.archetype === null) {
      throw new Error("pooled projectile slots do not have gameplay snapshots");
    }
    return Object.freeze({
      instanceId: slot.instanceId,
      generation: slot.generation,
      archetypeId: slot.archetype.id,
      poolClass: slot.poolClass,
      collisionRadiusPx: slot.archetype.collisionRadiusPx,
      state: slot.state,
      collisionEnabled: slot.collisionEnabled,
      previousPosition: Object.freeze({...slot.previousPosition}),
      position: Object.freeze({...slot.position}),
      movedAtTick120: slot.movedAtTick120,
      spawnedAtTick: slot.spawnedAtTick,
      armAtTick: slot.armAtTick,
      terminalCause: slot.terminalCause,
    });
  }
}
