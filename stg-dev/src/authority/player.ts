import eventSchemaJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/runtime/event-schema-v4.json";
import projectileLifecycleJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/projectile-lifecycle-v4.json";
import runtimeContractJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/runtime/runtime-contract-v4.json";
import stateMachinesJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/runtime/state-machines-v4.json";

import {
  MASTER_TICK_HZ,
  RUNTIME_TICK_HZ,
  tick120ToMilliseconds,
} from "./clock";
import {
  CANONICAL_EVENT_IDS,
  CanonicalEventBus,
  type GameplayEventDraft,
} from "./events";
import {
  ProjectileAuthorityPool,
  type ProjectileHandle,
  type Vec2,
} from "./projectiles";

type UnknownRecord = Record<string, unknown>;

export type PlayerLifeState = "alive" | "dead" | "respawning" | "run-ended";
export type CommittedDamageBranch = "non-fatal" | "fatal";
export type DamageHitDisposition = "committed" | "blocked" | "competing";

export interface CollisionBlockerLease {
  readonly token: string;
  readonly owner: string;
  readonly reason: string;
  readonly acquiredAtTick120: number;
}

export interface PlayerDamageConfig {
  readonly maxHealth: number;
  readonly initialLives: number;
  readonly nonFatalInvulnerabilityMs: number;
  readonly respawnPlaceMs: number;
  readonly respawnInvulnerabilityEndMs: number;
}

export interface DamageHit {
  readonly occurrenceKey: string;
  readonly sourceId: string;
  readonly amount: number;
}

export interface DamageHitResult extends DamageHit {
  readonly disposition: DamageHitDisposition;
  readonly branch: CommittedDamageBranch | null;
}

export interface DamageBatchResult {
  readonly tick120: number;
  readonly committedSourceId: string | null;
  readonly branch: CommittedDamageBranch | null;
  readonly hits: readonly DamageHitResult[];
}

export interface PlayerDamageSnapshot {
  readonly playerId: string;
  readonly tick120: number;
  readonly state: PlayerLifeState;
  readonly health: number;
  readonly lives: number;
  readonly collisionEnabled: boolean;
  readonly activeLeases: readonly CollisionBlockerLease[];
  readonly recoveryAtTick120: number | null;
  readonly respawnPlaceAtTick120: number | null;
  readonly respawnCompleteAtTick120: number | null;
  readonly handoff: Readonly<{reason: "lives-exhausted"; tick120: number}> | null;
}

export interface EvidenceSnapshot {
  readonly amount: number;
  readonly creditedSourceCount: number;
  readonly consumedPurposeCount: number;
}

export interface GrazeProjectileRef {
  readonly instanceId: string;
  readonly generation: number;
}

export type DirectionalOverrideState = "idle" | "charging" | "active" | "sediment" | "cooldown";

export interface DirectionalOverrideConfig {
  readonly evidenceCost: number;
  readonly chargeMs: number;
  readonly activeMs: number;
  readonly sedimentMs: number;
  readonly cooldownMs: number;
  readonly radius: number;
  readonly halfAngleDegrees: number;
}

export interface DirectionalOverrideContext {
  readonly origin: Vec2;
  readonly direction: Vec2;
  readonly roomId: string;
}

export interface LocalVoidSnapshot {
  readonly origin: Vec2;
  readonly direction: Vec2;
  readonly radius: number;
  readonly halfAngleDegrees: number;
  readonly openedAtTick120: number;
  readonly closesAtTick120: number;
}

export interface OverrideScarRecord {
  readonly id: string;
  readonly scarType: "overrideScar";
  readonly cycle: number;
  readonly tick120: number;
  readonly roomId: string;
  readonly position: Vec2;
  readonly direction: Vec2;
  readonly cancellations: readonly OverrideCancellationRecord[];
}

export interface OverrideCancellationRecord {
  readonly id: string;
  readonly cycle: number;
  readonly tick120: number;
  readonly position: Vec2;
  readonly projectileId: string;
  readonly projectileGeneration: number;
}

export interface DirectionalOverrideSnapshot {
  readonly tick120: number;
  readonly state: DirectionalOverrideState;
  readonly cycle: number;
  readonly deadlineTick120: number | null;
  readonly localVoid: LocalVoidSnapshot | null;
  readonly scarCount: number;
  readonly globalInvulnerability: false;
}

export interface V4PlayerAuthorityContract {
  readonly schemaVersion: string;
  readonly playerDamageStates: readonly string[];
  readonly grazeAwardStates: readonly string[];
  readonly grazeAwardKey: string;
  readonly grazeAwardMaximumPerKey: number;
  readonly directionalOverrideStates: readonly string[];
  readonly directionalOverrideGeometry: string;
  readonly overrideVoidCancellationConsequence: string;
  readonly canonicalRoomIds: readonly string[];
  readonly globalInvulnerability: false;
}

interface MachineTransitionSignature {
  readonly from: string;
  readonly to: string;
  readonly trigger: string;
  readonly events: readonly string[];
}

interface EventOrdering {
  readonly entityStableId: string;
  readonly localSequence: number;
}

interface PlayerEventSpec {
  readonly id: string;
  readonly occurrenceSuffix: string;
  readonly payload: GameplayEventDraft["payload"];
}

const DEFAULT_DAMAGE_CONFIG: PlayerDamageConfig = Object.freeze({
  maxHealth: 3,
  initialLives: 3,
  nonFatalInvulnerabilityMs: 1000,
  respawnPlaceMs: 1100,
  respawnInvulnerabilityEndMs: 1800,
});

const DEFAULT_OVERRIDE_CONFIG: DirectionalOverrideConfig = Object.freeze({
  evidenceCost: 8,
  chargeMs: 600,
  activeMs: 700,
  sedimentMs: 520,
  cooldownMs: 800,
  radius: 180,
  halfAngleDegrees: 24,
});

const EXPECTED_DAMAGE_TRANSITIONS: readonly MachineTransitionSignature[] = Object.freeze([
  Object.freeze({from: "alive", to: "alive", trigger: "damage.non-fatal", events: Object.freeze([
    "player.collision.off", "player.damage.commit", "player.invulnerability.begin",
  ])}),
  Object.freeze({from: "alive", to: "dead", trigger: "damage.fatal-and-lives-remain", events: Object.freeze([
    "player.collision.off", "player.death.commit", "player.life.consume",
  ])}),
  Object.freeze({from: "alive", to: "run-ended", trigger: "damage.fatal-and-lives-exhausted", events: Object.freeze([
    "player.collision.off", "player.death.commit", "player.life.consume", "run.end.commit",
  ])}),
  Object.freeze({from: "dead", to: "respawning", trigger: "respawn-place-deadline", events: Object.freeze([
    "player.respawn.place", "player.invulnerability.begin",
  ])}),
  Object.freeze({from: "respawning", to: "alive", trigger: "respawn-invulnerability-deadline", events: Object.freeze([
    "player.invulnerability.end", "player.collision.on", "player.respawn.complete",
  ])}),
  Object.freeze({from: "alive", to: "alive", trigger: "non-fatal-invulnerability-deadline", events: Object.freeze([
    "player.invulnerability.end", "player.collision.on",
  ])}),
]);

const EXPECTED_GRAZE_TRANSITIONS: readonly MachineTransitionSignature[] = Object.freeze([
  Object.freeze({from: "unseen", to: "awarded", trigger: "valid-graze-overlap", events: Object.freeze([
    "projectile.graze.commit", "evidence.gain.commit",
  ])}),
]);

const EXPECTED_OVERRIDE_TRANSITIONS: readonly MachineTransitionSignature[] = Object.freeze([
  Object.freeze({from: "idle", to: "charging", trigger: "override-press", events: Object.freeze([
    "player.override.charge.begin",
  ])}),
  Object.freeze({from: "charging", to: "idle", trigger: "release-before-commit", events: Object.freeze([
    "player.override.charge.cancel",
  ])}),
  Object.freeze({from: "charging", to: "idle", trigger: "commit-deadline-without-evidence", events: Object.freeze([
    "player.override.denied",
  ])}),
  Object.freeze({from: "charging", to: "active", trigger: "commit-deadline-with-evidence", events: Object.freeze([
    "evidence.consume.commit", "player.override.commit", "player.override.local_void.open",
  ])}),
  Object.freeze({from: "active", to: "sediment", trigger: "local-void-deadline", events: Object.freeze([
    "player.override.local_void.close", "cross_run.scar.write.commit", "player.override.material_sediment.begin",
  ])}),
  Object.freeze({from: "sediment", to: "cooldown", trigger: "sediment-deadline", events: Object.freeze([
    "player.override.cooldown.begin",
  ])}),
  Object.freeze({from: "cooldown", to: "idle", trigger: "cooldown-deadline", events: Object.freeze([
    "player.override.ready",
  ])}),
]);

let canonicalRoomIdSet: ReadonlySet<string> = new Set<string>();

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string): UnknownRecord {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  return value;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function canonicalRoomId(value: unknown, path: string): string {
  const roomId = nonEmptyString(value, path);
  if (!canonicalRoomIdSet.has(roomId)) {
    throw new Error(`${path} must be a canonical writable V4 room ID`);
  }
  return roomId;
}

function tick120(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || Object.is(value, -0)) {
    throw new Error(`${path} must be a non-negative safe integer`);
  }
  return value as number;
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${path} must be a positive safe integer`);
  }
  return value as number;
}

function finitePositive(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${path} must be finite and positive`);
  }
  return value;
}

function finiteNonNegative(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${path} must be finite and non-negative`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function finiteCoordinate(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be finite`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function compareCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function parseMachine(root: UnknownRecord, id: string): UnknownRecord {
  if (!Array.isArray(root.machines)) throw new Error("runtime state machines must be an array");
  const machine = root.machines
    .map((value, index) => record(value, `runtime state machines[${index}]`))
    .find((value) => value.id === id);
  if (machine === undefined) throw new Error(`runtime state machine is missing: ${id}`);
  return machine;
}

function parseStateNames(machine: UnknownRecord, path: string): readonly string[] {
  if (!Array.isArray(machine.states)) throw new Error(`${path}.states must be an array`);
  return Object.freeze(machine.states.map((value, index) =>
    nonEmptyString(value, `${path}.states[${index}]`)));
}

function parseMachineTransitions(
  machine: UnknownRecord,
  path: string,
): readonly MachineTransitionSignature[] {
  if (!Array.isArray(machine.transitions)) throw new Error(`${path}.transitions must be an array`);
  const canonicalIds = new Set<string>(CANONICAL_EVENT_IDS);
  const transitions = machine.transitions.map((rawTransition, transitionIndex) => {
    const transition = record(rawTransition, `${path}.transitions[${transitionIndex}]`);
    if (!Array.isArray(transition.events)) {
      throw new Error(`${path}.transitions[${transitionIndex}].events must be an array`);
    }
    const events = transition.events.map((rawEventId, eventIndex) => {
      const id = nonEmptyString(
        rawEventId,
        `${path}.transitions[${transitionIndex}].events[${eventIndex}]`,
      );
      if (!canonicalIds.has(id)) {
        throw new Error(`${path} references an unknown canonical event: ${id}`);
      }
      return id;
    });
    return Object.freeze({
      from: nonEmptyString(transition.from, `${path}.transitions[${transitionIndex}].from`),
      to: nonEmptyString(transition.to, `${path}.transitions[${transitionIndex}].to`),
      trigger: nonEmptyString(transition.trigger, `${path}.transitions[${transitionIndex}].trigger`),
      events: Object.freeze(events),
    });
  });
  return Object.freeze(transitions);
}

function assertMachineShape(
  machine: UnknownRecord,
  path: string,
  expected: {
    readonly implementation: string;
    readonly type: string;
    readonly states: readonly string[];
    readonly initialState: string;
    readonly transitions: readonly MachineTransitionSignature[];
  },
): void {
  if (machine.implementation !== expected.implementation || machine.type !== expected.type) {
    throw new Error(`${path} implementation/type diverges from the supported V4 adapter`);
  }
  if (machine.initialState !== expected.initialState) {
    throw new Error(`${path}.initialState diverges from the supported V4 adapter`);
  }
  const states = parseStateNames(machine, path);
  if (!sameStrings(states, expected.states)) {
    throw new Error(`${path}.states diverge from the supported V4 adapter`);
  }
  const actualTransitions = parseMachineTransitions(machine, path);
  if (JSON.stringify(actualTransitions) !== JSON.stringify(expected.transitions)) {
    throw new Error(`${path}.transitions diverge from the supported V4 adapter`);
  }
}

function assertExactStrings(value: unknown, expected: readonly string[], path: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  const actual = value.map((entry, index) => nonEmptyString(entry, `${path}[${index}]`));
  if (!sameStrings(actual, expected)) throw new Error(`${path} diverges from the supported V4 adapter`);
  return Object.freeze(actual);
}

function assertContractField(
  source: UnknownRecord,
  key: string,
  expected: string | boolean | number | null,
  path: string,
): void {
  if (source[key] !== expected) {
    throw new Error(`${path}.${key} diverges from the supported V4 adapter`);
  }
}

function readV4PlayerAuthorityContract(): V4PlayerAuthorityContract {
  const events = record(eventSchemaJson, "event schema");
  const machines = record(stateMachinesJson, "runtime state machines");
  const runtimeContract = record(runtimeContractJson, "runtime contract");
  const projectileLifecycle = record(projectileLifecycleJson, "projectile lifecycle");
  const schemaVersion = nonEmptyString(events.schemaVersion, "event schema.schemaVersion");
  if (
    machines.schemaVersion !== schemaVersion
    || runtimeContract.schemaVersion !== schemaVersion
    || projectileLifecycle.schemaVersion !== schemaVersion
  ) {
    throw new Error("player authority sources have incompatible schema versions");
  }
  if (!Array.isArray(events.events)) throw new Error("event schema events must be an array");
  const eventIds = events.events.map((value, index) =>
    nonEmptyString(record(value, `event schema.events[${index}]`).id, `event schema.events[${index}].id`));
  if (!sameStrings(eventIds, CANONICAL_EVENT_IDS)) {
    throw new Error("player authority event source diverges from the canonical bus registry");
  }

  const damage = parseMachine(machines, "playerDamage");
  const graze = parseMachine(machines, "grazeAward");
  const override = parseMachine(machines, "directionalOverride");
  assertMachineShape(damage, "playerDamage machine", {
    implementation: "PlayerDamageMachine",
    type: "atomic-branch-fsm",
    states: ["alive", "dead", "respawning", "run-ended"],
    initialState: "alive",
    transitions: EXPECTED_DAMAGE_TRANSITIONS,
  });
  assertMachineShape(graze, "grazeAward machine", {
    implementation: "GrazeAwardRegistry",
    type: "generation-scoped-once-gate",
    states: ["unseen", "awarded"],
    initialState: "unseen",
    transitions: EXPECTED_GRAZE_TRANSITIONS,
  });
  assertMachineShape(override, "directionalOverride machine", {
    implementation: "DirectionalOverrideMachine",
    type: "evidence-funded-local-rule-fsm",
    states: ["idle", "charging", "active", "sediment", "cooldown"],
    initialState: "idle",
    transitions: EXPECTED_OVERRIDE_TRANSITIONS,
  });
  if (override.geometry !== "forward-sector" || override.globalInvulnerability !== false) {
    throw new Error("directional Override geometry or collision authority is unsupported");
  }

  const damageContract = record(runtimeContract.playerDamage, "runtime contract.playerDamage");
  assertContractField(damageContract, "authority", "PlayerDamageMachine", "runtime contract.playerDamage");
  assertContractField(damageContract, "branchSelection", "atomic-before-events", "runtime contract.playerDamage");
  assertExactStrings(damageContract.branches, ["ignored", "non-fatal", "fatal"], "runtime contract.playerDamage.branches");
  assertContractField(damageContract, "mutuallyExclusive", true, "runtime contract.playerDamage");
  assertContractField(
    damageContract,
    "collisionPolicy",
    "enabled-only-when-no-active-blocker-leases",
    "runtime contract.playerDamage",
  );
  assertContractField(damageContract, "directCollisionToggleForbidden", true, "runtime contract.playerDamage");
  assertContractField(damageContract, "fatalCancelsNonFatalTimelineCompetition", true, "runtime contract.playerDamage");

  const projectileContract = record(
    runtimeContract.projectileLifecycle,
    "runtime contract.projectileLifecycle",
  );
  const grazeAwardKey = nonEmptyString(
    projectileContract.grazeAwardKey,
    "runtime contract.projectileLifecycle.grazeAwardKey",
  );
  if (graze.idempotencyKey !== grazeAwardKey) {
    throw new Error("grazeAward machine key diverges from the runtime contract");
  }
  const grazeAwardMaximumPerKey = positiveInteger(
    projectileContract.grazeAwardMaximumPerKey,
    "runtime contract.projectileLifecycle.grazeAwardMaximumPerKey",
  );
  if (grazeAwardMaximumPerKey !== 1) {
    throw new Error("graze award maximum diverges from the supported V4 adapter");
  }

  const overrideContract = record(runtimeContract.override, "runtime contract.override");
  assertContractField(overrideContract, "mode", "directional-local-void", "runtime contract.override");
  assertContractField(overrideContract, "globalInvulnerability", false, "runtime contract.override");
  assertContractField(overrideContract, "consumes", "evidence", "runtime contract.override");
  assertContractField(overrideContract, "geometry", "forward-sector", "runtime contract.override");
  assertContractField(
    overrideContract,
    "materialOutcome",
    "typed-overrideScar-at-world-coordinate",
    "runtime contract.override",
  );

  const roomIdentity = record(runtimeContract.roomIdentity, "runtime contract.roomIdentity");
  const canonicalRoomIds = assertExactStrings(
    roomIdentity.canonicalIds,
    ["INFORMATION", "FORCED_ALIGNMENT", "IN_BETWEEN", "POLARIZED"],
    "runtime contract.roomIdentity.canonicalIds",
  );
  assertContractField(roomIdentity, "writePolicy", "canonical-only", "runtime contract.roomIdentity");

  const cancelConsequences = record(
    projectileLifecycle.cancelConsequences,
    "projectile lifecycle.cancelConsequences",
  );
  const overrideVoidCancellationConsequence = nonEmptyString(
    cancelConsequences.override_void,
    "projectile lifecycle.cancelConsequences.override_void",
  );
  if (overrideVoidCancellationConsequence !== "override scar at exact cancellation coordinate") {
    throw new Error("override_void consequence diverges from the supported V4 adapter");
  }
  return Object.freeze({
    schemaVersion,
    playerDamageStates: parseStateNames(damage, "playerDamage machine"),
    grazeAwardStates: parseStateNames(graze, "grazeAward machine"),
    grazeAwardKey,
    grazeAwardMaximumPerKey,
    directionalOverrideStates: parseStateNames(override, "directionalOverride machine"),
    directionalOverrideGeometry: override.geometry,
    overrideVoidCancellationConsequence,
    canonicalRoomIds,
    globalInvulnerability: false,
  });
}

export const V4_PLAYER_AUTHORITY_CONTRACT = readV4PlayerAuthorityContract();
canonicalRoomIdSet = new Set(V4_PLAYER_AUTHORITY_CONTRACT.canonicalRoomIds);

/**
 * Converts a reference-runtime millisecond delay into a V4 60 Hz boundary.
 * The result is always an even master tick and never fires early.
 */
export function runtime60DeadlineTick(startTick120Value: number, durationMsValue: number): number {
  const start = tick120(startTick120Value, "deadline start tick120");
  const durationMs = finiteNonNegative(durationMsValue, "deadline durationMs");
  const masterTicksPerRuntimeTick = MASTER_TICK_HZ / RUNTIME_TICK_HZ;
  const runtimeBoundary = Math.ceil(
    start / masterTicksPerRuntimeTick + durationMs * RUNTIME_TICK_HZ / 1000,
  );
  const deadline = runtimeBoundary * masterTicksPerRuntimeTick;
  if (!Number.isSafeInteger(deadline)) throw new Error("runtime deadline exceeds the safe tick range");
  return deadline;
}

function freezeVec2(value: unknown, path: string): Vec2 {
  const vector = record(value, path);
  return Object.freeze({
    x: finiteCoordinate(vector.x, `${path}.x`),
    y: finiteCoordinate(vector.y, `${path}.y`),
  });
}

function normalizeDirection(value: unknown, path: string): Vec2 {
  const vector = freezeVec2(value, path);
  const magnitude = Math.hypot(vector.x, vector.y);
  if (magnitude <= Number.EPSILON) throw new Error(`${path} must be non-zero`);
  return Object.freeze({x: vector.x / magnitude, y: vector.y / magnitude});
}

function freezeDamageConfig(value: Partial<PlayerDamageConfig>): Readonly<PlayerDamageConfig> {
  const config = Object.freeze({...DEFAULT_DAMAGE_CONFIG, ...value});
  positiveInteger(config.maxHealth, "player maxHealth");
  positiveInteger(config.initialLives, "player initialLives");
  finiteNonNegative(config.nonFatalInvulnerabilityMs, "player nonFatalInvulnerabilityMs");
  finiteNonNegative(config.respawnPlaceMs, "player respawnPlaceMs");
  finiteNonNegative(config.respawnInvulnerabilityEndMs, "player respawnInvulnerabilityEndMs");
  if (config.respawnInvulnerabilityEndMs < config.respawnPlaceMs) {
    throw new Error("respawn completion must not precede placement");
  }
  return config;
}

export class PlayerDamageAuthority {
  readonly config: Readonly<PlayerDamageConfig>;
  private stateValue: PlayerLifeState = "alive";
  private healthValue: number;
  private livesValue: number;
  private currentTick120 = 0;
  private nextLeaseSerial = 0;
  private nextEventSequence = 0;
  private readonly leases = new Map<string, CollisionBlockerLease>();
  private readonly claimedHitOccurrences = new Set<string>();
  private readonly processedDamageTicks = new Set<number>();
  private recoveryLeaseToken: string | null = null;
  private recoveryAtTick120: number | null = null;
  private respawnPlaceAtTick120: number | null = null;
  private respawnCompleteAtTick120: number | null = null;
  private handoffValue: PlayerDamageSnapshot["handoff"] = null;

  constructor(
    private readonly bus: CanonicalEventBus,
    options: {
      readonly playerId?: string;
      readonly config?: Partial<PlayerDamageConfig>;
    } = {},
  ) {
    this.playerId = nonEmptyString(options.playerId ?? "player", "playerId");
    this.config = freezeDamageConfig(options.config ?? {});
    this.healthValue = this.config.maxHealth;
    this.livesValue = this.config.initialLives;
  }

  readonly playerId: string;

  acquireCollisionBlocker(ownerValue: string, reasonValue: string, tick120Value: number): CollisionBlockerLease {
    const owner = nonEmptyString(ownerValue, "collision blocker owner");
    const reason = nonEmptyString(reasonValue, "collision blocker reason");
    const tick = tick120(tick120Value, "collision blocker tick120");
    this.advanceToInternal(tick, true);
    const wasEnabled = this.collisionEnabled();
    const lease = this.prepareCollisionLease(owner, reason, tick);
    if (wasEnabled) {
      this.emit("player.collision.off", tick, `collision-off:${lease.token}`, {owner, reason});
    }
    this.commitPreparedLease(lease);
    return lease;
  }

  releaseCollisionBlocker(tokenValue: string, tick120Value: number): void {
    const token = nonEmptyString(tokenValue, "collision blocker token");
    const tick = tick120(tick120Value, "collision blocker release tick120");
    const lease = this.leases.get(token);
    if (lease === undefined) throw new Error(`unknown or released collision blocker: ${token}`);
    this.advanceToInternal(tick, true);
    const enablesCollision = this.stateValue === "alive" && this.leases.size === 1;
    if (enablesCollision) {
      this.emit("player.collision.on", tick, `collision-on:${token}`, {
        owner: lease.owner,
        reason: lease.reason,
      });
    }
    this.leases.delete(token);
  }

  commitDamageBatch(tick120Value: number, hitsValue: readonly DamageHit[]): DamageBatchResult {
    const tick = tick120(tick120Value, "damage batch tick120");
    if (!Array.isArray(hitsValue) || hitsValue.length === 0) {
      throw new Error("damage batch must contain at least one hit");
    }
    if (this.processedDamageTicks.has(tick)) {
      throw new Error(`damage batch already committed for tick ${tick}`);
    }
    const batchOccurrences = new Set<string>();
    const hits = hitsValue.map((rawHit, index) => {
      const hit = record(rawHit, `damage hits[${index}]`);
      const occurrenceKey = nonEmptyString(hit.occurrenceKey, `damage hits[${index}].occurrenceKey`);
      if (batchOccurrences.has(occurrenceKey) || this.claimedHitOccurrences.has(occurrenceKey)) {
        throw new Error(`duplicate damage hit occurrence: ${occurrenceKey}`);
      }
      batchOccurrences.add(occurrenceKey);
      return Object.freeze({
        occurrenceKey,
        sourceId: nonEmptyString(hit.sourceId, `damage hits[${index}].sourceId`),
        amount: positiveInteger(hit.amount, `damage hits[${index}].amount`),
      });
    }).sort((left, right) =>
      compareCodePoint(left.sourceId, right.sourceId)
      || compareCodePoint(left.occurrenceKey, right.occurrenceKey));

    // If recovery completes on this exact authority tick, the incoming batch
    // may immediately claim a new blocker. Suppress the transient collision-on
    // so the canonical trace describes the final same-tick collision state.
    this.advanceToInternal(tick, true);
    const acceptsHit = this.collisionEnabled();
    const selected = acceptsHit ? hits[0] ?? null : null;
    let branch: CommittedDamageBranch | null = null;
    if (selected !== null) {
      branch = this.healthValue - selected.amount <= 0 ? "fatal" : "non-fatal";
      if (branch === "fatal") this.commitFatalDamage(selected, tick);
      else this.commitNonFatalDamage(selected, tick);
      // Zero-duration reference configuration crosses at this same even runtime boundary.
      this.advanceTo(tick);
    }

    const results = hits.map((hit) => Object.freeze({
      ...hit,
      disposition: selected === null
        ? "blocked" as const
        : hit === selected
          ? "committed" as const
          : "competing" as const,
      branch: hit === selected ? branch : null,
    }));
    for (const occurrenceKey of batchOccurrences) this.claimedHitOccurrences.add(occurrenceKey);
    this.processedDamageTicks.add(tick);
    return Object.freeze({
      tick120: tick,
      committedSourceId: selected?.sourceId ?? null,
      branch,
      hits: Object.freeze(results),
    });
  }

  advanceTo(tick120Value: number): PlayerDamageSnapshot {
    return this.advanceToInternal(tick120Value, false);
  }

  private advanceToInternal(
    tick120Value: number,
    suppressCollisionEnableAtTarget: boolean,
  ): PlayerDamageSnapshot {
    const targetTick = tick120(tick120Value, "player advance tick120");
    if (targetTick < this.currentTick120) {
      throw new Error(`player authority cannot move backward from ${this.currentTick120} to ${targetTick}`);
    }

    while (true) {
      if (
        this.stateValue === "alive"
        && this.recoveryAtTick120 !== null
        && this.recoveryAtTick120 <= targetTick
      ) {
        const due = this.recoveryAtTick120;
        const token = this.recoveryLeaseToken;
        if (token === null) throw new Error("non-fatal recovery lost its collision blocker");
        this.currentTick120 = due;
        this.emit("player.invulnerability.end", due, `invulnerability-end:${token}`, {
          reason: "non-fatal",
        });
        this.recoveryAtTick120 = null;
        this.recoveryLeaseToken = null;
        this.releaseCollisionBlockerAtCurrentTick(
          token,
          due,
          suppressCollisionEnableAtTarget && due === targetTick,
        );
        continue;
      }

      if (
        this.stateValue === "dead"
        && this.respawnPlaceAtTick120 !== null
        && this.respawnPlaceAtTick120 <= targetTick
      ) {
        const due = this.respawnPlaceAtTick120;
        this.currentTick120 = due;
        this.respawnPlaceAtTick120 = null;
        this.stateValue = "respawning";
        this.healthValue = this.config.maxHealth;
        this.emit("player.respawn.place", due, `respawn-place:${due}`, {health: this.healthValue});
        this.emit("player.invulnerability.begin", due, `respawn-invulnerability:${due}`, {
          reason: "respawn",
        });
        continue;
      }

      if (
        this.stateValue === "respawning"
        && this.respawnCompleteAtTick120 !== null
        && this.respawnCompleteAtTick120 <= targetTick
      ) {
        const due = this.respawnCompleteAtTick120;
        const token = this.recoveryLeaseToken;
        if (token === null) throw new Error("respawn completion lost its collision blocker");
        this.currentTick120 = due;
        this.respawnCompleteAtTick120 = null;
        this.recoveryLeaseToken = null;
        this.emit("player.invulnerability.end", due, `respawn-invulnerability-end:${due}`, {
          reason: "respawn",
        });
        this.stateValue = "alive";
        this.releaseCollisionBlockerAtCurrentTick(
          token,
          due,
          suppressCollisionEnableAtTarget && due === targetTick,
        );
        this.emit("player.respawn.complete", due, `respawn-complete:${due}`, {});
        continue;
      }
      break;
    }
    this.currentTick120 = targetTick;
    return this.snapshot();
  }

  snapshot(): PlayerDamageSnapshot {
    const activeLeases = [...this.leases.values()].sort((left, right) =>
      compareCodePoint(left.token, right.token));
    return Object.freeze({
      playerId: this.playerId,
      tick120: this.currentTick120,
      state: this.stateValue,
      health: this.healthValue,
      lives: this.livesValue,
      collisionEnabled: this.collisionEnabled(),
      activeLeases: Object.freeze(activeLeases),
      recoveryAtTick120: this.recoveryAtTick120,
      respawnPlaceAtTick120: this.respawnPlaceAtTick120,
      respawnCompleteAtTick120: this.respawnCompleteAtTick120,
      handoff: this.handoffValue,
    });
  }

  private collisionEnabled(): boolean {
    return this.stateValue === "alive" && this.leases.size === 0;
  }

  private commitNonFatalDamage(hit: Readonly<DamageHit>, tick: number): void {
    const lease = this.prepareCollisionLease("damage", "non-fatal-invulnerability", tick);
    const healthAfter = this.healthValue - hit.amount;
    const recoveryAtTick120 = runtime60DeadlineTick(tick, this.config.nonFatalInvulnerabilityMs);
    this.enqueuePlayerEvents(tick, [
      {
        id: "player.collision.off",
        occurrenceSuffix: `collision-off:${lease.token}`,
        payload: {owner: lease.owner, reason: lease.reason},
      },
      {
        id: "player.damage.commit",
        occurrenceSuffix: `damage:${hit.occurrenceKey}`,
        payload: {
          amount: hit.amount,
          healthAfter,
          sourceId: hit.sourceId,
          branch: "non-fatal",
        },
      },
      {
        id: "player.invulnerability.begin",
        occurrenceSuffix: `invulnerability-begin:${lease.token}`,
        payload: {reason: "non-fatal"},
      },
    ]);
    this.commitPreparedLease(lease);
    this.healthValue = healthAfter;
    this.recoveryLeaseToken = lease.token;
    this.recoveryAtTick120 = recoveryAtTick120;
  }

  private commitFatalDamage(hit: Readonly<DamageHit>, tick: number): void {
    const lease = this.prepareCollisionLease("damage", "death-respawn", tick);
    const livesAfter = this.livesValue - 1;
    const respawnPlaceAtTick120 = livesAfter > 0
      ? runtime60DeadlineTick(tick, this.config.respawnPlaceMs)
      : null;
    const respawnCompleteAtTick120 = livesAfter > 0
      ? runtime60DeadlineTick(tick, this.config.respawnInvulnerabilityEndMs)
      : null;
    const events: PlayerEventSpec[] = [
      {
        id: "player.collision.off",
        occurrenceSuffix: `collision-off:${lease.token}`,
        payload: {owner: lease.owner, reason: lease.reason},
      },
      {
        id: "player.death.commit",
        occurrenceSuffix: `death:${hit.occurrenceKey}`,
        payload: {sourceId: hit.sourceId, branch: "fatal"},
      },
      {
        id: "player.life.consume",
        occurrenceSuffix: `life-consume:${hit.occurrenceKey}`,
        payload: {livesAfter},
      },
    ];
    if (livesAfter <= 0) {
      events.push({
        id: "run.end.commit",
        occurrenceSuffix: `run-end:${hit.occurrenceKey}`,
        payload: {reason: "lives-exhausted"},
      });
    }
    this.enqueuePlayerEvents(tick, events);
    this.commitPreparedLease(lease);
    this.stateValue = "dead";
    this.healthValue = 0;
    this.livesValue = livesAfter;
    this.recoveryLeaseToken = lease.token;

    if (livesAfter <= 0) {
      this.stateValue = "run-ended";
      this.handoffValue = Object.freeze({reason: "lives-exhausted", tick120: tick});
      return;
    }
    this.respawnPlaceAtTick120 = respawnPlaceAtTick120;
    this.respawnCompleteAtTick120 = respawnCompleteAtTick120;
  }

  private prepareCollisionLease(owner: string, reason: string, tick: number): CollisionBlockerLease {
    if (!Number.isSafeInteger(this.nextLeaseSerial)) {
      throw new Error("collision blocker serial exceeds the safe integer range");
    }
    const token = `${this.playerId}:lease:${String(this.nextLeaseSerial).padStart(6, "0")}`;
    return Object.freeze({token, owner, reason, acquiredAtTick120: tick});
  }

  private commitPreparedLease(lease: CollisionBlockerLease): void {
    this.leases.set(lease.token, lease);
    this.nextLeaseSerial += 1;
  }

  private releaseCollisionBlockerAtCurrentTick(
    token: string,
    tick: number,
    suppressCollisionEnable = false,
  ): void {
    const lease = this.leases.get(token);
    if (lease === undefined) throw new Error(`unknown or released collision blocker: ${token}`);
    const enablesCollision = this.stateValue === "alive" && this.leases.size === 1;
    if (enablesCollision && !suppressCollisionEnable) {
      this.emit("player.collision.on", tick, `collision-on:${token}`, {
        owner: lease.owner,
        reason: lease.reason,
      });
    }
    this.leases.delete(token);
  }

  private emit(
    id: string,
    tick: number,
    occurrenceSuffix: string,
    payload: GameplayEventDraft["payload"],
  ): void {
    this.enqueuePlayerEvents(tick, [{id, occurrenceSuffix, payload}]);
  }

  private enqueuePlayerEvents(tick: number, events: readonly PlayerEventSpec[]): void {
    const firstSequence = this.nextEventSequence;
    this.bus.enqueueBatch(events.map((event, index) => ({
      id: event.id,
      tick120: tick,
      entityStableId: this.playerId,
      localSequence: firstSequence + index,
      occurrenceKey: `${this.playerId}:${event.occurrenceSuffix}`,
      payload: event.payload,
    })));
    this.nextEventSequence += events.length;
  }
}

export class EvidenceAuthority {
  private amountValue: number;
  private nextEventSequence = 0;
  private readonly creditedSources = new Set<string>();
  private readonly consumedPurposes = new Set<string>();

  constructor(
    private readonly bus: CanonicalEventBus,
    initialAmountValue = 0,
    private readonly authorityId = "evidence",
  ) {
    this.amountValue = tick120(initialAmountValue, "initial evidence");
    nonEmptyString(authorityId, "evidence authorityId");
  }

  get amount(): number {
    return this.amountValue;
  }

  hasCreditedSource(sourceKey: string): boolean {
    return this.creditedSources.has(sourceKey);
  }

  credit(
    amountValue: number,
    tick120Value: number,
    sourceKeyValue: string,
    ordering?: EventOrdering,
  ): void {
    const amount = positiveInteger(amountValue, "evidence credit amount");
    const tick = tick120(tick120Value, "evidence credit tick120");
    const sourceKey = nonEmptyString(sourceKeyValue, "evidence sourceKey");
    if (this.creditedSources.has(sourceKey)) throw new Error(`evidence source already credited: ${sourceKey}`);
    const total = this.amountValue + amount;
    if (!Number.isSafeInteger(total)) throw new Error("evidence total exceeds the safe integer range");
    const eventOrdering = ordering ?? {
      entityStableId: this.authorityId,
      localSequence: this.nextEventSequence,
    };
    this.bus.enqueue({
      id: "evidence.gain.commit",
      tick120: tick,
      entityStableId: eventOrdering.entityStableId,
      localSequence: eventOrdering.localSequence,
      occurrenceKey: `${this.authorityId}:gain:${sourceKey}`,
      payload: {amount, total, sourceKey},
    });
    if (ordering === undefined) this.nextEventSequence += 1;
    this.amountValue = total;
    this.creditedSources.add(sourceKey);
  }

  trySpend(
    amountValue: number,
    tick120Value: number,
    purposeKeyValue: string,
    ordering?: EventOrdering,
  ): boolean {
    const amount = positiveInteger(amountValue, "evidence cost");
    const tick = tick120(tick120Value, "evidence consume tick120");
    const purposeKey = nonEmptyString(purposeKeyValue, "evidence purposeKey");
    if (this.consumedPurposes.has(purposeKey)) {
      throw new Error(`evidence purpose already consumed: ${purposeKey}`);
    }
    if (this.amountValue < amount) return false;
    const total = this.amountValue - amount;
    const eventOrdering = ordering ?? {
      entityStableId: this.authorityId,
      localSequence: this.nextEventSequence,
    };
    this.bus.enqueue({
      id: "evidence.consume.commit",
      tick120: tick,
      entityStableId: eventOrdering.entityStableId,
      localSequence: eventOrdering.localSequence,
      occurrenceKey: `${this.authorityId}:consume:${purposeKey}`,
      payload: {amount, total, purposeKey},
    });
    if (ordering === undefined) this.nextEventSequence += 1;
    this.amountValue = total;
    this.consumedPurposes.add(purposeKey);
    return true;
  }

  snapshot(): EvidenceSnapshot {
    return Object.freeze({
      amount: this.amountValue,
      creditedSourceCount: this.creditedSources.size,
      consumedPurposeCount: this.consumedPurposes.size,
    });
  }
}

export class GrazeEvidenceAuthority {
  private readonly awarded = new Set<string>();

  constructor(
    private readonly bus: CanonicalEventBus,
    private readonly evidence: EvidenceAuthority,
    private readonly authorityId = "graze",
  ) {
    nonEmptyString(authorityId, "graze authorityId");
  }

  tryAward(
    projectiles: ProjectileAuthorityPool,
    handle: ProjectileHandle,
    playerIdValue: string,
    tick120Value: number,
    amountValue = 1,
  ): boolean {
    const playerId = nonEmptyString(playerIdValue, "graze playerId");
    const tick = tick120(tick120Value, "graze tick120");
    const amount = positiveInteger(amountValue, "graze evidence amount");
    projectiles.advanceTo(tick);
    const snapshot = projectiles.snapshot(handle);
    if (snapshot.state !== "flight" || !snapshot.collisionEnabled) return false;
    const awardKey = `${snapshot.instanceId}:${snapshot.generation}:${playerId}`;
    if (this.awarded.has(awardKey)) return false;
    const sourceKey = `graze:${awardKey}`;
    if (this.evidence.hasCreditedSource(sourceKey)) {
      throw new Error(`graze evidence source was already claimed outside registry: ${sourceKey}`);
    }
    const entityStableId = `${this.authorityId}:${awardKey}`;
    this.bus.enqueue({
      id: "projectile.graze.commit",
      tick120: tick,
      entityStableId,
      localSequence: 0,
      occurrenceKey: `${this.authorityId}:award:${awardKey}`,
      payload: {
        projectileId: snapshot.instanceId,
        projectileGeneration: snapshot.generation,
        playerId,
        evidence: amount,
      },
    });
    this.evidence.credit(amount, tick, sourceKey, {entityStableId, localSequence: 1});
    this.awarded.add(awardKey);
    return true;
  }

  hasAward(projectile: GrazeProjectileRef, playerId: string): boolean {
    return this.awarded.has(`${projectile.instanceId}:${projectile.generation}:${playerId}`);
  }
}

function freezeOverrideConfig(value: Partial<DirectionalOverrideConfig>): Readonly<DirectionalOverrideConfig> {
  const config = Object.freeze({...DEFAULT_OVERRIDE_CONFIG, ...value});
  positiveInteger(config.evidenceCost, "Override evidenceCost");
  finiteNonNegative(config.chargeMs, "Override chargeMs");
  finiteNonNegative(config.activeMs, "Override activeMs");
  finiteNonNegative(config.sedimentMs, "Override sedimentMs");
  finiteNonNegative(config.cooldownMs, "Override cooldownMs");
  finitePositive(config.radius, "Override radius");
  if (
    !Number.isFinite(config.halfAngleDegrees)
    || config.halfAngleDegrees <= 0
    || config.halfAngleDegrees >= 90
  ) {
    throw new Error("Override halfAngleDegrees must be in (0, 90)");
  }
  return config;
}

function pointInSector(position: Vec2, area: LocalVoidSnapshot): boolean {
  const dx = position.x - area.origin.x;
  const dy = position.y - area.origin.y;
  const distance = Math.hypot(dx, dy);
  if (distance > area.radius) return false;
  if (distance <= Number.EPSILON) return true;
  const dot = dx / distance * area.direction.x + dy / distance * area.direction.y;
  const threshold = Math.cos(area.halfAngleDegrees * Math.PI / 180);
  return dot + Number.EPSILON >= threshold;
}

export class DirectionalOverrideAuthority {
  readonly config: Readonly<DirectionalOverrideConfig>;
  private stateValue: DirectionalOverrideState = "idle";
  private currentTick120 = 0;
  private deadlineTick120: number | null = null;
  private context: Readonly<DirectionalOverrideContext> | null = null;
  private localVoidValue: LocalVoidSnapshot | null = null;
  private cycleValue = 0;
  private nextEventSequence = 0;
  private readonly scars: OverrideScarRecord[] = [];
  private cycleCancellations: OverrideCancellationRecord[] = [];

  constructor(
    private readonly bus: CanonicalEventBus,
    private readonly evidence: EvidenceAuthority,
    options: {
      readonly authorityId?: string;
      readonly config?: Partial<DirectionalOverrideConfig>;
    } = {},
  ) {
    this.authorityId = nonEmptyString(options.authorityId ?? "override", "Override authorityId");
    this.config = freezeOverrideConfig(options.config ?? {});
  }

  readonly authorityId: string;

  press(contextValue: DirectionalOverrideContext, tick120Value: number): boolean {
    const contextRecord = record(contextValue, "Override context");
    const origin = freezeVec2(contextRecord.origin, "Override context.origin");
    const direction = normalizeDirection(contextRecord.direction, "Override context.direction");
    const roomId = canonicalRoomId(contextRecord.roomId, "Override context.roomId");
    const tick = tick120(tick120Value, "Override press tick120");
    this.advanceTo(tick);
    if (this.stateValue !== "idle") return false;
    const nextCycle = this.cycleValue + 1;
    const deadline = runtime60DeadlineTick(tick, this.config.chargeMs);
    this.emit("player.override.charge.begin", tick, nextCycle, "charge-begin", {
      cycle: nextCycle,
      roomId,
      commitAtMs: tick120ToMilliseconds(deadline),
      evidenceCost: this.config.evidenceCost,
    });
    this.cycleValue = nextCycle;
    this.context = Object.freeze({origin, direction, roomId});
    this.cycleCancellations = [];
    this.stateValue = "charging";
    this.deadlineTick120 = deadline;
    if (deadline <= tick) this.advanceTo(tick);
    return true;
  }

  release(tick120Value: number): boolean {
    const tick = tick120(tick120Value, "Override release tick120");
    this.advanceTo(tick);
    if (this.stateValue !== "charging") return false;
    this.emit("player.override.charge.cancel", tick, this.cycleValue, "charge-cancel", {
      cycle: this.cycleValue,
    });
    this.stateValue = "idle";
    this.deadlineTick120 = null;
    this.context = null;
    return true;
  }

  advanceTo(tick120Value: number): DirectionalOverrideSnapshot {
    const targetTick = tick120(tick120Value, "Override advance tick120");
    if (targetTick < this.currentTick120) {
      throw new Error(`Override authority cannot move backward from ${this.currentTick120} to ${targetTick}`);
    }
    let crossed = 0;
    while (this.deadlineTick120 !== null && this.deadlineTick120 <= targetTick) {
      crossed += 1;
      if (crossed > 4) throw new Error("Override crossed too many boundaries in one advance");
      const due = this.deadlineTick120;
      if (due % 2 !== 0) throw new Error("Override runtime deadline must be an even master tick");
      this.currentTick120 = due;
      this.crossBoundary(due);
    }
    this.currentTick120 = targetTick;
    return this.snapshot();
  }

  contains(pointValue: Vec2): boolean {
    const point = freezeVec2(pointValue, "Override sector point");
    const area = this.localVoidValue;
    if (this.stateValue !== "active" || area === null) return false;
    return pointInSector(point, area);
  }

  cancelProjectiles(
    projectiles: ProjectileAuthorityPool,
    tick120Value: number,
  ): readonly OverrideCancellationRecord[] {
    const tick = tick120(tick120Value, "Override cancel tick120");
    this.advanceTo(tick);
    projectiles.advanceTo(tick);
    const area = this.localVoidValue;
    const context = this.context;
    if (this.stateValue !== "active" || area === null || context === null) return Object.freeze([]);
    const candidates = projectiles.activeSnapshots()
      .filter((snapshot) =>
        (snapshot.state === "arm" || snapshot.state === "flight")
        && pointInSector(snapshot.position, area))
      .sort((left, right) =>
        compareCodePoint(left.instanceId, right.instanceId) || left.generation - right.generation);
    const cancelled: OverrideCancellationRecord[] = [];
    for (const snapshot of candidates) {
      const handle = Object.freeze({
        instanceId: snapshot.instanceId,
        generation: snapshot.generation,
      });
      projectiles.cancel(handle, tick, "override_void");
      const cancellation = Object.freeze({
        id: `override-cancel:${this.cycleValue}:${snapshot.instanceId}:${snapshot.generation}`,
        cycle: this.cycleValue,
        tick120: tick,
        position: Object.freeze({...snapshot.position}),
        projectileId: snapshot.instanceId,
        projectileGeneration: snapshot.generation,
      });
      this.cycleCancellations.push(cancellation);
      cancelled.push(cancellation);
    }
    return Object.freeze(cancelled);
  }

  snapshot(): DirectionalOverrideSnapshot {
    return Object.freeze({
      tick120: this.currentTick120,
      state: this.stateValue,
      cycle: this.cycleValue,
      deadlineTick120: this.deadlineTick120,
      localVoid: this.localVoidValue,
      scarCount: this.scars.length,
      globalInvulnerability: false,
    });
  }

  overrideScars(): readonly OverrideScarRecord[] {
    return Object.freeze(this.scars.slice());
  }

  private crossBoundary(due: number): void {
    if (this.stateValue === "charging") {
      const context = this.context;
      if (context === null) throw new Error("Override charge lost its context");
      if (this.evidence.amount < this.config.evidenceCost) {
        this.emit("player.override.denied", due, this.cycleValue, "denied", {
          cycle: this.cycleValue,
          reason: "insufficient-evidence",
        });
        this.stateValue = "idle";
        this.deadlineTick120 = null;
        this.context = null;
        return;
      }
      const purposeKey = `override:${this.cycleValue}`;
      const spent = this.evidence.trySpend(this.config.evidenceCost, due, purposeKey, {
        entityStableId: this.authorityId,
        localSequence: this.nextEventSequence,
      });
      if (!spent) throw new Error("Override evidence changed during atomic commit");
      this.nextEventSequence += 1;
      const closesAtTick120 = runtime60DeadlineTick(due, this.config.activeMs);
      this.emit("player.override.commit", due, this.cycleValue, "commit", {
        cycle: this.cycleValue,
        roomId: context.roomId,
        mode: "directional-local",
      });
      this.emit("player.override.local_void.open", due, this.cycleValue, "local-void-open", {
        cycle: this.cycleValue,
        originX: context.origin.x,
        originY: context.origin.y,
        directionX: context.direction.x,
        directionY: context.direction.y,
        radius: this.config.radius,
        halfAngleDegrees: this.config.halfAngleDegrees,
      });
      this.stateValue = "active";
      this.deadlineTick120 = closesAtTick120;
      this.localVoidValue = Object.freeze({
        origin: context.origin,
        direction: context.direction,
        radius: this.config.radius,
        halfAngleDegrees: this.config.halfAngleDegrees,
        openedAtTick120: due,
        closesAtTick120,
      });
      return;
    }

    if (this.stateValue === "active") {
      const context = this.context;
      if (context === null) throw new Error("active Override lost its context");
      this.emit("player.override.local_void.close", due, this.cycleValue, "local-void-close", {
        cycle: this.cycleValue,
      });
      const cancellations = Object.freeze(this.cycleCancellations.slice());
      // V4's Override FSM requires a scar write on active -> sediment, while
      // projectile-lifecycle-v4 requires each override_void consequence at the
      // exact cancellation coordinate. Buffering cancellations until close
      // satisfies both contracts; an empty successful cycle retains the
      // reference runtime's single origin scar.
      const scarSources: readonly (OverrideCancellationRecord | null)[] = cancellations.length > 0
        ? cancellations
        : Object.freeze([null]);
      for (const cancellation of scarSources) {
        const position = cancellation?.position ?? context.origin;
        const linkedCancellations = cancellation === null
          ? Object.freeze([])
          : Object.freeze([cancellation]);
        const stableSuffix = cancellation === null
          ? "cycle"
          : `${cancellation.projectileId}:${cancellation.projectileGeneration}`;
        const scar = Object.freeze({
          id: `overrideScar:${this.cycleValue}:${stableSuffix}`,
          scarType: "overrideScar" as const,
          cycle: this.cycleValue,
          tick120: due,
          roomId: context.roomId,
          position,
          direction: context.direction,
          cancellations: linkedCancellations,
        });
        this.emit(
          "cross_run.scar.write.commit",
          due,
          this.cycleValue,
          `scar-write:${stableSuffix}`,
          {
            cycle: this.cycleValue,
            scarType: scar.scarType,
            roomId: context.roomId,
            x: position.x,
            y: position.y,
            directionX: context.direction.x,
            directionY: context.direction.y,
            cancellations: linkedCancellations.map((entry) => ({
              projectileId: entry.projectileId,
              projectileGeneration: entry.projectileGeneration,
              x: entry.position.x,
              y: entry.position.y,
            })),
          },
        );
        this.scars.push(scar);
      }
      this.emit("player.override.material_sediment.begin", due, this.cycleValue, "sediment", {
        cycle: this.cycleValue,
        scarType: "overrideScar",
      });
      this.stateValue = "sediment";
      this.localVoidValue = null;
      this.deadlineTick120 = runtime60DeadlineTick(due, this.config.sedimentMs);
      return;
    }

    if (this.stateValue === "sediment") {
      this.emit("player.override.cooldown.begin", due, this.cycleValue, "cooldown", {
        cycle: this.cycleValue,
      });
      this.stateValue = "cooldown";
      this.deadlineTick120 = runtime60DeadlineTick(due, this.config.cooldownMs);
      return;
    }

    if (this.stateValue === "cooldown") {
      this.emit("player.override.ready", due, this.cycleValue, "ready", {cycle: this.cycleValue});
      this.stateValue = "idle";
      this.deadlineTick120 = null;
      this.context = null;
      return;
    }
    throw new Error(`Override deadline cannot execute from ${this.stateValue}`);
  }

  private emit(
    id: string,
    tick: number,
    cycle: number,
    occurrenceSuffix: string,
    payload: GameplayEventDraft["payload"],
  ): void {
    this.bus.enqueue({
      id,
      tick120: tick,
      entityStableId: this.authorityId,
      localSequence: this.nextEventSequence,
      occurrenceKey: `${this.authorityId}:${cycle}:${occurrenceSuffix}`,
      payload,
    });
    this.nextEventSequence += 1;
  }
}
