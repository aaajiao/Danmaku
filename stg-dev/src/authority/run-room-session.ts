import {
  CanonicalCombatKernel,
  CanonicalRunCombatState,
  type CanonicalCombatSnapshot,
  type CanonicalCombatStepInput,
  type CanonicalRunCombatStateSnapshot,
} from "./combat-kernel";
import {
  CanonicalEventBus,
  isExactCanonicalEventBus,
  type CanonicalGameplayEvent,
} from "./events";
import {
  COMPOSER_ID,
  DIFFICULTY,
  DIFFICULTY_SALT,
  FIRST_FIXED_ROOM_CLOSURE_CONTRACT as SHARED_FIRST_FIXED_ROOM_CLOSURE_CONTRACT,
  FIRST_FIXED_ROOM_CLOSURE_RELATIVE_TICK120,
  OCCURRENCE_ID,
  PATTERN_ID,
  PATTERN_SEED_BASE,
  RELATIVE_BOUNDARY_TICKS120,
  ROOM_ID,
  RUN_ROOM_SESSION_CONTRACT as SHARED_RUN_ROOM_SESSION_CONTRACT,
  TIER_ID,
} from "./run-room-contract";
import type {CanonicalRunSessionHandoffSnapshot} from "./run-session";

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const entry of Object.values(value)) deepFreeze(entry, seen);
  return Object.freeze(value);
}

export const RUN_ROOM_SESSION_CONTRACT = SHARED_RUN_ROOM_SESSION_CONTRACT;

export const FIRST_FIXED_ROOM_CLOSURE_CONTRACT =
  SHARED_FIRST_FIXED_ROOM_CLOSURE_CONTRACT;

export interface DomainTaggedRawRunSeed {
  readonly domain: "raw-run-seed";
  readonly value: number;
}

export interface DomainTaggedResolvedOccurrenceSeed {
  readonly domain: "resolved-occurrence-seed";
  readonly value: number;
}

export interface CanonicalRunRoomSessionOptions {
  readonly rawRunSeed: DomainTaggedRawRunSeed;
  readonly handoff: CanonicalRunSessionHandoffSnapshot;
  readonly eventBus: CanonicalEventBus;
  readonly runState: CanonicalRunCombatState;
}

export type CanonicalRunRoomSessionPhase =
  | "telegraph"
  | "entry"
  | "read"
  | "material_settle"
  | "rest"
  | "first_room_slice_complete"
  | "first_room_complete";

export interface CanonicalRunRoomSessionBoundaryTicks {
  readonly start: number;
  readonly telegraphEnd: number;
  readonly read: number;
  readonly materialSettle: number;
  readonly rest: number;
  readonly fixedSliceComplete: number;
  readonly residueDeadline: number;
}

export interface CanonicalRunRoomSessionSnapshot {
  readonly authority: "canonical-run-room-session-v4";
  readonly extensionPolicy: "EXT-2026-005" | "EXT-2026-009";
  readonly phase: CanonicalRunRoomSessionPhase;
  readonly tick120: number;
  readonly relativeTick120: number;
  readonly roomId: typeof ROOM_ID;
  readonly roomOrdinal: 0;
  readonly composerId: typeof COMPOSER_ID;
  readonly patternId: typeof PATTERN_ID;
  readonly occurrenceId: typeof OCCURRENCE_ID;
  readonly encounterOrdinal: 0;
  readonly tierId: typeof TIER_ID;
  readonly difficulty: typeof DIFFICULTY;
  readonly composer: false;
  readonly weightedSelection: false;
  readonly selectionAuthority: "ext-005-fixed-first-room-bootstrap";
  readonly selectionRngDraws: 0;
  readonly parallel: false;
  readonly rawRunSeed: Readonly<DomainTaggedRawRunSeed>;
  readonly resolvedSeed: Readonly<DomainTaggedResolvedOccurrenceSeed>;
  readonly difficultySalt: typeof DIFFICULTY_SALT;
  readonly boundaryTicks120: Readonly<CanonicalRunRoomSessionBoundaryTicks>;
  readonly sourceTraceEventCount: number;
  readonly combat: CanonicalCombatSnapshot | null;
  readonly runCombat: CanonicalRunCombatStateSnapshot;
  readonly entities: Readonly<{
    readonly digitalBodies: number;
    readonly liveColliders: number;
    readonly residueVisuals: number;
  }>;
  readonly fixedSliceComplete: boolean;
  readonly roomComplete: boolean;
  readonly handoffReady: false;
  readonly faulted: boolean;
  readonly adapterPolicy: Readonly<{
    readonly sourceHandoff: "typed-ready-for-room-sampling";
    readonly directRoomInstall: "no-transition-or-room-enter-event";
    readonly preRead: "shared-run-idle-zero-room-entities";
    readonly readStart: "close-H+159-on-shared-state-then-claim-local0";
    readonly overrideEdges: "screened-without-reading";
    readonly tickClosure: "shared-run-combat-state-sole-flush-owner";
    readonly terminalTail: "residue-drained-at-H+1699-plus-two-neutral-ticks";
    readonly completion:
      | "slice-only-no-room-completion-or-handoff"
      | "single-occurrence-room-close-no-handoff";
    readonly provenance:
      | "application-policy-EXT-2026-005"
      | "application-policy-EXT-2026-009";
  }>;
}

interface CapturedHandoff {
  readonly state: "ready_for_room_sampling";
  readonly targetNarrativeState: "ROOM_SAMPLING";
  readonly ready: true;
  readonly sourcePatternId: "common.eye_acquisition";
  readonly atTick120: number;
  readonly consumed: false;
  readonly consumedAtTick120: null;
  readonly consumerAuthority: null;
  readonly barriers: Readonly<{
    readonly combatDrained: true;
    readonly gazeClampCommitted: true;
    readonly gazeClampReleased: true;
    readonly flowerRecoveryComplete: true;
    readonly gazeTimedStateQuiescent: true;
  }>;
  readonly recovery: Readonly<{
    readonly completedAtTick120: number;
  }>;
  readonly sourceCombat: Readonly<{
    readonly tick120: number;
    readonly patternComplete: true;
    readonly projectileLifecycleDrained: true;
    readonly handoffReady: true;
    readonly liveEntities: 0;
    readonly liveColliders: 0;
  }>;
}

interface CapturedStepInput {
  readonly tick120: number;
  readonly movement: Readonly<{readonly x: number; readonly y: number}>;
  readonly focused: boolean;
}

interface RunRoomInternals {
  readonly rawRunSeed: Readonly<DomainTaggedRawRunSeed>;
  readonly resolvedSeed: Readonly<DomainTaggedResolvedOccurrenceSeed>;
  readonly handoff: CapturedHandoff;
  readonly eventBus: CanonicalEventBus;
  readonly runState: CanonicalRunCombatState;
  readonly boundaries: Readonly<CanonicalRunRoomSessionBoundaryTicks>;
  readonly sourceEvents: readonly CanonicalGameplayEvent[];
  readonly sourceClaimedOccurrenceIds: readonly string[];
  combat: CanonicalCombatKernel | null;
  latestCombat: CanonicalCombatSnapshot | null;
  tick120: number;
  fixedSliceComplete: boolean;
  roomComplete: boolean;
  advancing: boolean;
  fault: Error | null;
}

const INTERNALS = new WeakMap<CanonicalRunRoomSession, RunRoomInternals>();

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function ownData(record: object, key: string, path: string, required = true): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) {
    if (required) throw new Error(`${path}.${key} is required`);
    return undefined;
  }
  if (!("value" in descriptor) || descriptor.enumerable !== true) {
    throw new Error(`${path}.${key} must be an own enumerable data property`);
  }
  return descriptor.value;
}

function requireSafeTick(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || Object.is(value, -0)) {
    throw new Error(`${path} must be a non-negative safe integer`);
  }
  return value as number;
}

function requireUint32(value: unknown, path: string): number {
  if (
    !Number.isSafeInteger(value)
    || (value as number) < 0
    || (value as number) > 0xffff_ffff
    || Object.is(value, -0)
  ) {
    throw new Error(`${path} must be a uint32 without negative zero`);
  }
  return value as number;
}

function capturePlainData(
  value: unknown,
  path: string,
  ancestors = new Set<object>(),
): unknown {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  if (typeof value !== "object") throw new Error(`${path} must contain only plain data`);
  if (ancestors.has(value)) throw new Error(`${path} must not contain cycles`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const copy = value.map((_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
          throw new Error(`${path}[${index}] must be an own enumerable data property`);
        }
        return capturePlainData(descriptor.value, `${path}[${index}]`, ancestors);
      });
      return Object.freeze(copy);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${path} must be a plain object`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new Error(`${path} must not contain symbol properties`);
    }
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
        throw new Error(`${path}.${key} must be an own enumerable data property`);
      }
      copy[key] = capturePlainData(descriptor.value, `${path}.${key}`, ancestors);
    }
    return Object.freeze(copy);
  } finally {
    ancestors.delete(value);
  }
}

function captureRawRunSeed(value: unknown): Readonly<DomainTaggedRawRunSeed> {
  const record = requireRecord(value, "run room rawRunSeed");
  const keys = Object.keys(record);
  if (keys.length !== 2 || !keys.includes("domain") || !keys.includes("value")) {
    throw new Error("run room rawRunSeed must contain exactly domain and value");
  }
  const domain = ownData(record, "domain", "run room rawRunSeed");
  if (domain !== "raw-run-seed") {
    throw new Error("run room rawRunSeed domain must be raw-run-seed");
  }
  return Object.freeze({
    domain,
    value: requireUint32(ownData(record, "value", "run room rawRunSeed"), "run room rawRunSeed.value"),
  });
}

function captureHandoff(value: unknown): CapturedHandoff {
  const captured = requireRecord(capturePlainData(value, "run room handoff"), "run room handoff");
  if (
    captured.state !== "ready_for_room_sampling"
    || captured.targetNarrativeState !== "ROOM_SAMPLING"
    || captured.ready !== true
    || captured.sourcePatternId !== "common.eye_acquisition"
    || captured.consumed !== false
    || captured.consumedAtTick120 !== null
    || captured.consumerAuthority !== null
  ) {
    throw new Error("run room requires an unconsumed typed ready_for_room_sampling handoff");
  }
  const atTick120 = requireSafeTick(captured.atTick120, "run room handoff.atTick120");
  const barriers = requireRecord(captured.barriers, "run room handoff.barriers");
  for (const key of [
    "combatDrained",
    "gazeClampCommitted",
    "gazeClampReleased",
    "flowerRecoveryComplete",
    "gazeTimedStateQuiescent",
  ] as const) {
    if (barriers[key] !== true) throw new Error(`run room handoff barrier is incomplete: ${key}`);
  }
  const recovery = requireRecord(captured.recovery, "run room handoff.recovery");
  const completedAtTick120 = requireSafeTick(
    recovery.completedAtTick120,
    "run room handoff.recovery.completedAtTick120",
  );
  if (completedAtTick120 > atTick120) {
    throw new Error("run room handoff recovery completes after authority transfer");
  }
  const sourceCombat = requireRecord(captured.sourceCombat, "run room handoff.sourceCombat");
  const sourceCombatTick120 = requireSafeTick(
    sourceCombat.tick120,
    "run room handoff.sourceCombat.tick120",
  );
  if (
    sourceCombatTick120 > atTick120
    || sourceCombat.patternComplete !== true
    || sourceCombat.projectileLifecycleDrained !== true
    || sourceCombat.handoffReady !== true
    || sourceCombat.liveEntities !== 0
    || sourceCombat.liveColliders !== 0
  ) {
    throw new Error("run room handoff source combat is not fully drained");
  }
  return deepFreeze({
    state: "ready_for_room_sampling" as const,
    targetNarrativeState: "ROOM_SAMPLING" as const,
    ready: true as const,
    sourcePatternId: "common.eye_acquisition" as const,
    atTick120,
    consumed: false as const,
    consumedAtTick120: null,
    consumerAuthority: null,
    barriers: {
      combatDrained: true as const,
      gazeClampCommitted: true as const,
      gazeClampReleased: true as const,
      flowerRecoveryComplete: true as const,
      gazeTimedStateQuiescent: true as const,
    },
    recovery: {completedAtTick120},
    sourceCombat: {
      tick120: sourceCombatTick120,
      patternComplete: true as const,
      projectileLifecycleDrained: true as const,
      handoffReady: true as const,
      liveEntities: 0 as const,
      liveColliders: 0 as const,
    },
  });
}

function captureOptions(value: CanonicalRunRoomSessionOptions): Readonly<{
  rawRunSeed: Readonly<DomainTaggedRawRunSeed>;
  handoff: CapturedHandoff;
  eventBus: CanonicalEventBus;
  runState: CanonicalRunCombatState;
}> {
  const record = requireRecord(value, "run room options");
  const keys = Object.keys(record);
  const expected = ["eventBus", "handoff", "rawRunSeed", "runState"];
  if (keys.length !== expected.length || expected.some((key) => !keys.includes(key))) {
    throw new Error("run room options must contain exactly rawRunSeed, handoff, eventBus, and runState");
  }
  const eventBus = ownData(record, "eventBus", "run room options");
  const runState = ownData(record, "runState", "run room options");
  if (!isExactCanonicalEventBus(eventBus)) {
    throw new Error("run room requires an exact CanonicalEventBus instance");
  }
  if (
    typeof runState !== "object"
    || runState === null
    || Object.getPrototypeOf(runState) !== CanonicalRunCombatState.prototype
  ) {
    throw new Error("run room requires an exact CanonicalRunCombatState instance");
  }
  CanonicalRunCombatState.prototype.snapshot.call(runState as CanonicalRunCombatState);
  return Object.freeze({
    rawRunSeed: captureRawRunSeed(ownData(record, "rawRunSeed", "run room options")),
    handoff: captureHandoff(ownData(record, "handoff", "run room options")),
    eventBus,
    runState: runState as CanonicalRunCombatState,
  });
}

function captureStepInput(value: CanonicalCombatStepInput): CapturedStepInput {
  const record = requireRecord(value, "run room step input");
  const tick120 = requireSafeTick(
    ownData(record, "tick120", "run room step input"),
    "run room step input.tick120",
  );
  const movementRecord = requireRecord(
    ownData(record, "movement", "run room step input"),
    "run room step input.movement",
  );
  const x = ownData(movementRecord, "x", "run room step input.movement");
  const y = ownData(movementRecord, "y", "run room step input.movement");
  if (typeof x !== "number" || !Number.isFinite(x) || typeof y !== "number" || !Number.isFinite(y)) {
    throw new Error("run room step movement must contain finite coordinates");
  }
  const magnitude = Math.hypot(x, y);
  if (magnitude > 1 + 1e-9) throw new Error("run room step movement magnitude must not exceed one");
  const focused = ownData(record, "focused", "run room step input");
  if (typeof focused !== "boolean") throw new Error("run room step focused must be boolean");
  return Object.freeze({
    tick120,
    movement: Object.freeze({x: Object.is(x, -0) ? 0 : x, y: Object.is(y, -0) ? 0 : y}),
    focused,
  });
}

function absoluteBoundaries(handoffTick120: number): Readonly<CanonicalRunRoomSessionBoundaryTicks> {
  if (handoffTick120 > Number.MAX_SAFE_INTEGER - FIRST_FIXED_ROOM_CLOSURE_RELATIVE_TICK120) {
    throw new Error("run room handoff tick cannot represent the fixed slice boundaries safely");
  }
  return Object.freeze({
    start: handoffTick120,
    telegraphEnd: handoffTick120 + RELATIVE_BOUNDARY_TICKS120.telegraph,
    read: handoffTick120 + RELATIVE_BOUNDARY_TICKS120.read,
    materialSettle: handoffTick120 + RELATIVE_BOUNDARY_TICKS120.materialSettle,
    rest: handoffTick120 + RELATIVE_BOUNDARY_TICKS120.rest,
    fixedSliceComplete: handoffTick120 + RELATIVE_BOUNDARY_TICKS120.fixedSliceComplete,
    residueDeadline: handoffTick120 + RELATIVE_BOUNDARY_TICKS120.residueDrained,
  });
}

function assertRunStateReady(
  runState: CanonicalRunCombatState,
  handoffTick120: number,
): CanonicalRunCombatStateSnapshot {
  const snapshot = CanonicalRunCombatState.prototype.snapshot.call(runState);
  if (
    snapshot.tick120 !== handoffTick120
    || snapshot.pendingFlushTick120 !== null
    || snapshot.activeOccurrenceId !== null
    || snapshot.faulted
  ) {
    throw new Error("run room requires an idle, closed shared run state at handoff H");
  }
  if (
    snapshot.player.state !== "alive"
    || snapshot.player.recoveryAtTick120 !== null
    || snapshot.player.respawnPlaceAtTick120 !== null
    || snapshot.player.respawnCompleteAtTick120 !== null
    || snapshot.override.state !== "idle"
    || snapshot.override.deadlineTick120 !== null
    || snapshot.override.localVoid !== null
  ) {
    throw new Error("run room cannot inherit a live player or Override timer");
  }
  if (snapshot.adapterPolicy.projectilePoolClasses["bullet.micro.notch_e"] !== "micro") {
    throw new Error("run room requires bullet.micro.notch_e in the shared micro pool class");
  }
  return snapshot;
}

function assertSharedBusPrefix(
  eventBus: CanonicalEventBus,
  runState: CanonicalRunCombatState,
): readonly CanonicalGameplayEvent[] {
  const busEvents = CanonicalEventBus.prototype.events.call(eventBus);
  const stateEvents = CanonicalRunCombatState.prototype.events.call(runState);
  if (stateEvents.length === 0) {
    throw new Error("run room requires the non-empty canonical First Eye source trace");
  }
  if (
    busEvents.length !== stateEvents.length
    || stateEvents.some((event, index) => event !== busEvents[index])
  ) {
    throw new Error("run room eventBus and runState do not share the same canonical trace");
  }
  return Object.freeze(stateEvents.slice());
}

function internalsFor(session: CanonicalRunRoomSession): RunRoomInternals {
  const internals = INTERNALS.get(session);
  if (internals === undefined) throw new Error("unrecognized canonical run room session");
  return internals;
}

function phaseFor(internals: RunRoomInternals): CanonicalRunRoomSessionPhase {
  if (internals.roomComplete) return "first_room_complete";
  if (internals.fixedSliceComplete) return "first_room_slice_complete";
  if (internals.tick120 < internals.boundaries.telegraphEnd) return "telegraph";
  if (internals.tick120 < internals.boundaries.read) return "entry";
  if (internals.tick120 < internals.boundaries.materialSettle) return "read";
  if (internals.tick120 < internals.boundaries.rest) return "material_settle";
  return "rest";
}

function assertSourceTracePrefix(internals: RunRoomInternals): void {
  const events = CanonicalEventBus.prototype.events.call(internals.eventBus);
  if (
    events.length < internals.sourceEvents.length
    || internals.sourceEvents.some((event, index) => events[index] !== event)
  ) {
    throw new Error("run room canonical source trace is no longer an exact prefix");
  }
}

function assertSynchronized(internals: RunRoomInternals): CanonicalRunCombatStateSnapshot {
  assertSourceTracePrefix(internals);
  const runCombat = CanonicalRunCombatState.prototype.snapshot.call(internals.runState);
  if (
    runCombat.tick120 !== internals.tick120
    || runCombat.pendingFlushTick120 !== null
    || runCombat.faulted
  ) {
    throw new Error("run room lost synchronization with the shared run state");
  }
  const expectsActiveOccurrence = internals.combat !== null
    && internals.tick120 < internals.boundaries.residueDeadline;
  if (
    (expectsActiveOccurrence && runCombat.activeOccurrenceId !== OCCURRENCE_ID)
    || (!expectsActiveOccurrence && runCombat.activeOccurrenceId !== null)
  ) {
    throw new Error("run room shared occurrence ownership drifted");
  }
  return runCombat;
}

function assertSharedCanonicalTraceAligned(internals: RunRoomInternals): void {
  const busEvents = CanonicalEventBus.prototype.events.call(internals.eventBus);
  const stateEvents = CanonicalRunCombatState.prototype.events.call(internals.runState);
  if (
    busEvents.length !== stateEvents.length
    || stateEvents.some((event, index) => event !== busEvents[index])
  ) {
    throw new Error("run room eventBus and runState canonical traces diverged");
  }
}

function sanitizedInput(input: CapturedStepInput): CanonicalCombatStepInput {
  return Object.freeze({
    tick120: input.tick120,
    movement: input.movement,
    focused: input.focused,
  });
}

function neutralInput(
  tick120: number,
  runCombat: CanonicalRunCombatStateSnapshot,
): CanonicalCombatStepInput {
  return Object.freeze({
    tick120,
    movement: Object.freeze({x: 0, y: 0}),
    focused: runCombat.focused,
  });
}

function entitiesFor(combat: CanonicalCombatSnapshot | null): CanonicalRunRoomSessionSnapshot["entities"] {
  if (combat === null) {
    return Object.freeze({digitalBodies: 0, liveColliders: 0, residueVisuals: 0});
  }
  return Object.freeze({
    digitalBodies: combat.projectiles.filter((projectile) =>
      projectile.state === "arm" || projectile.state === "flight").length,
    liveColliders: combat.poolUsage.liveColliders,
    residueVisuals: combat.poolUsage.residueVisuals,
  });
}

const ADAPTER_POLICY = deepFreeze({
  sourceHandoff: "typed-ready-for-room-sampling" as const,
  directRoomInstall: "no-transition-or-room-enter-event" as const,
  preRead: "shared-run-idle-zero-room-entities" as const,
  readStart: "close-H+159-on-shared-state-then-claim-local0" as const,
  overrideEdges: "screened-without-reading" as const,
  tickClosure: "shared-run-combat-state-sole-flush-owner" as const,
  terminalTail: "residue-drained-at-H+1699-plus-two-neutral-ticks" as const,
  completion: "slice-only-no-room-completion-or-handoff" as const,
  provenance: "application-policy-EXT-2026-005" as const,
});

const CLOSURE_ADAPTER_POLICY = deepFreeze({
  ...ADAPTER_POLICY,
  completion: "single-occurrence-room-close-no-handoff" as const,
  provenance: "application-policy-EXT-2026-009" as const,
});

const CLOSURE_PARENT_EVENT_IDS = new Set<string>(
  FIRST_FIXED_ROOM_CLOSURE_CONTRACT.parentCanonicalEventIds,
);

function expectedClaimedOccurrenceIds(internals: RunRoomInternals): readonly string[] {
  return Object.freeze(
    [...internals.sourceClaimedOccurrenceIds, OCCURRENCE_ID].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0),
  );
}

function assertClaimedOccurrencePrefix(
  internals: RunRoomInternals,
  runCombat: CanonicalRunCombatStateSnapshot,
): void {
  const expected = expectedClaimedOccurrenceIds(internals);
  if (
    runCombat.claimedOccurrenceIds.length !== expected.length
    || runCombat.claimedOccurrenceIds.some((id, index) => id !== expected[index])
  ) {
    throw new Error("run room closure requires exactly the inherited and fixed occurrence identities");
  }
}

function assertFirstFixedRoomClosureReady(
  internals: RunRoomInternals,
  runCombat: CanonicalRunCombatStateSnapshot,
): void {
  assertSharedCanonicalTraceAligned(internals);
  const latest = internals.latestCombat;
  const entities = entitiesFor(latest);
  if (
    internals.tick120 !== internals.boundaries.fixedSliceComplete
    || !internals.fixedSliceComplete
    || internals.roomComplete
    || latest === null
    || !latest.patternComplete
    || !latest.digitalBodiesDrained
    || latest.materialResidueDraining
    || !latest.projectileLifecycleDrained
    || !latest.runTimedStateQuiescent
    || !latest.handoffReady
    || latest.projectiles.length !== 0
    || latest.poolUsage.liveColliders !== 0
    || latest.poolUsage.residueVisuals !== 0
    || entities.digitalBodies !== 0
    || entities.liveColliders !== 0
    || entities.residueVisuals !== 0
  ) {
    throw new Error("run room closure requires the fully drained fixed occurrence slice");
  }
  if (
    runCombat.activeOccurrenceId !== null
    || runCombat.pendingFlushTick120 !== null
    || runCombat.faulted
    || runCombat.player.state === "run-ended"
    || runCombat.player.recoveryAtTick120 !== null
    || runCombat.player.respawnPlaceAtTick120 !== null
    || runCombat.player.respawnCompleteAtTick120 !== null
    || runCombat.override.state !== "idle"
    || runCombat.override.deadlineTick120 !== null
    || runCombat.override.localVoid !== null
  ) {
    throw new Error("run room closure requires quiescent non-terminal shared run authority");
  }
  assertClaimedOccurrencePrefix(internals, runCombat);
}

function assertFirstFixedRoomClosurePostflight(
  internals: RunRoomInternals,
  runCombat: CanonicalRunCombatStateSnapshot,
  committedEventsBefore: readonly CanonicalGameplayEvent[],
): void {
  assertSharedCanonicalTraceAligned(internals);
  if (
    internals.tick120
      !== internals.boundaries.start + FIRST_FIXED_ROOM_CLOSURE_RELATIVE_TICK120
    || runCombat.tick120 !== internals.tick120
    || runCombat.activeOccurrenceId !== null
    || runCombat.pendingFlushTick120 !== null
    || runCombat.faulted
    || runCombat.player.state === "run-ended"
  ) {
    throw new Error("run room closure did not close the exact H+1702 idle tick");
  }
  assertClaimedOccurrencePrefix(internals, runCombat);
  const committedEventsAfter = CanonicalEventBus.prototype.events.call(internals.eventBus);
  if (
    committedEventsAfter.length < committedEventsBefore.length
    || committedEventsBefore.some((event, index) => committedEventsAfter[index] !== event)
    || committedEventsAfter.slice(committedEventsBefore.length).some((event) =>
      event.tick120 !== internals.tick120 || !CLOSURE_PARENT_EVENT_IDS.has(event.id))
  ) {
    throw new Error("run room closure accepts only the existing same-tick Gaze/Flower event suffix");
  }
}

/**
 * EXT-2026-005's fixed first-room owner switch. It consumes no selection RNG,
 * invents no room-enter event, and keeps the First Eye bus/state as the only
 * canonical trace and flush owner.
 */
export class CanonicalRunRoomSession {
  constructor(optionsValue: CanonicalRunRoomSessionOptions) {
    const options = captureOptions(optionsValue);
    const handoffTick120 = options.handoff.atTick120;
    const beforeState = assertRunStateReady(options.runState, handoffTick120);
    const sourceEvents = assertSharedBusPrefix(options.eventBus, options.runState);
    const beforeSerialization = CanonicalRunCombatState.prototype.canonicalEventSerialization.call(
      options.runState,
    );
    const boundaries = absoluteBoundaries(handoffTick120);
    const resolvedSeed = Object.freeze({
      domain: "resolved-occurrence-seed" as const,
      value: (
        options.rawRunSeed.value
        ^ PATTERN_SEED_BASE
        ^ 0
        ^ DIFFICULTY_SALT
      ) >>> 0,
    });

    INTERNALS.set(this, {
      rawRunSeed: options.rawRunSeed,
      resolvedSeed,
      handoff: options.handoff,
      eventBus: options.eventBus,
      runState: options.runState,
      boundaries,
      sourceEvents,
      sourceClaimedOccurrenceIds: Object.freeze(beforeState.claimedOccurrenceIds.slice()),
      combat: null,
      latestCombat: null,
      tick120: handoffTick120,
      fixedSliceComplete: false,
      roomComplete: false,
      advancing: false,
      fault: null,
    });
    Object.freeze(this);

    const afterState = CanonicalRunCombatState.prototype.snapshot.call(options.runState);
    if (
      JSON.stringify(afterState) !== JSON.stringify(beforeState)
      || CanonicalRunCombatState.prototype.canonicalEventSerialization.call(options.runState)
        !== beforeSerialization
      || CanonicalEventBus.prototype.events.call(options.eventBus).length !== sourceEvents.length
    ) {
      throw new Error("run room constructor consumed the closed handoff tick");
    }
  }

  snapshot(): CanonicalRunRoomSessionSnapshot {
    const internals = internalsFor(this);
    const runCombat = CanonicalRunCombatState.prototype.snapshot.call(internals.runState);
    const combat = internals.combat === null
      ? internals.latestCombat
      : CanonicalCombatKernel.prototype.snapshot.call(internals.combat);
    return deepFreeze({
      authority: "canonical-run-room-session-v4" as const,
      extensionPolicy: internals.roomComplete ? "EXT-2026-009" as const : "EXT-2026-005" as const,
      phase: phaseFor(internals),
      tick120: internals.tick120,
      relativeTick120: internals.tick120 - internals.handoff.atTick120,
      roomId: ROOM_ID,
      roomOrdinal: 0 as const,
      composerId: COMPOSER_ID,
      patternId: PATTERN_ID,
      occurrenceId: OCCURRENCE_ID,
      encounterOrdinal: 0 as const,
      tierId: TIER_ID,
      difficulty: DIFFICULTY,
      composer: false as const,
      weightedSelection: false as const,
      selectionAuthority: "ext-005-fixed-first-room-bootstrap" as const,
      selectionRngDraws: 0 as const,
      parallel: false as const,
      rawRunSeed: internals.rawRunSeed,
      resolvedSeed: internals.resolvedSeed,
      difficultySalt: DIFFICULTY_SALT,
      boundaryTicks120: internals.boundaries,
      sourceTraceEventCount: internals.sourceEvents.length,
      combat,
      runCombat,
      entities: entitiesFor(combat),
      fixedSliceComplete: internals.fixedSliceComplete,
      roomComplete: internals.roomComplete,
      handoffReady: false as const,
      faulted: internals.fault !== null,
      adapterPolicy: internals.roomComplete ? CLOSURE_ADAPTER_POLICY : ADAPTER_POLICY,
    });
  }

  events(): readonly CanonicalGameplayEvent[] {
    return CanonicalEventBus.prototype.events.call(internalsFor(this).eventBus);
  }

  canonicalEventSerialization(): string {
    return CanonicalRunCombatState.prototype.canonicalEventSerialization.call(
      internalsFor(this).runState,
    );
  }

  step(inputValue: CanonicalCombatStepInput): CanonicalRunRoomSessionSnapshot {
    const internals = internalsFor(this);
    if (internals.advancing) {
      const error = new Error("run room step is already in progress");
      if (internals.fault === null) internals.fault = error;
      throw error;
    }
    if (internals.fault !== null) {
      throw new Error(`run room session is faulted: ${internals.fault.message}`, {
        cause: internals.fault,
      });
    }
    const input = captureStepInput(inputValue);
    if (input.tick120 !== internals.tick120 + 1) {
      throw new Error(
        `run room must advance one exact tick: ${internals.tick120} -> ${input.tick120}`,
      );
    }
    internals.advancing = true;
    try {
      const runBefore = assertSynchronized(internals);
      const tick120 = input.tick120;
      let closeFirstFixedRoom = false;
      let closureCommittedEventsBefore: readonly CanonicalGameplayEvent[] = Object.freeze([]);
      if (tick120 <= internals.boundaries.read) {
        CanonicalRunCombatState.prototype.stepIdle.call(
          internals.runState,
          sanitizedInput(input),
          ROOM_ID,
        );
        internals.tick120 = tick120;
        if (tick120 === internals.boundaries.read) {
          const readStartState = CanonicalRunCombatState.prototype.snapshot.call(internals.runState);
          internals.combat = new CanonicalCombatKernel({
            patternId: PATTERN_ID,
            occurrenceId: OCCURRENCE_ID,
            seed: internals.resolvedSeed.value,
            startTick120: tick120,
            roomId: ROOM_ID,
            difficulty: DIFFICULTY,
            initialPlayerPosition: readStartState.playerPosition,
            grazeRadiusPx: readStartState.adapterPolicy.grazeRadiusPx,
            projectileDamage: readStartState.adapterPolicy.projectileDamage,
            projectilePoolClasses: readStartState.adapterPolicy.projectilePoolClasses,
          }, internals.runState);
          internals.latestCombat = CanonicalCombatKernel.prototype.snapshot.call(internals.combat);
        }
      } else if (tick120 <= internals.boundaries.residueDeadline) {
        if (internals.combat === null) throw new Error("run room READ lost its combat occurrence");
        CanonicalCombatKernel.prototype.advanceTick.call(
          internals.combat,
          sanitizedInput(input),
        );
        CanonicalRunCombatState.prototype.flushTick.call(internals.runState, tick120);
        internals.tick120 = tick120;
        internals.latestCombat = CanonicalCombatKernel.prototype.snapshot.call(internals.combat);
        if (tick120 === internals.boundaries.residueDeadline) {
          const drained = internals.latestCombat;
          const runAfterDrain = CanonicalRunCombatState.prototype.snapshot.call(internals.runState);
          if (
            !drained.patternComplete
            || !drained.digitalBodiesDrained
            || drained.materialResidueDraining
            || !drained.projectileLifecycleDrained
            || !drained.runTimedStateQuiescent
            || !drained.handoffReady
            || drained.projectiles.length !== 0
            || drained.poolUsage.liveColliders !== 0
            || drained.poolUsage.residueVisuals !== 0
            || runAfterDrain.activeOccurrenceId !== null
          ) {
            throw new Error("run room residue boundary did not drain the occurrence exactly");
          }
        }
      } else if (tick120 <= internals.boundaries.fixedSliceComplete) {
        const latest = internals.latestCombat;
        if (latest === null || !latest.handoffReady) {
          throw new Error("run room neutral tail requires a drained occurrence");
        }
        CanonicalRunCombatState.prototype.stepIdle.call(
          internals.runState,
          neutralInput(tick120, runBefore),
          ROOM_ID,
        );
        internals.tick120 = tick120;
        if (tick120 === internals.boundaries.fixedSliceComplete) {
          internals.fixedSliceComplete = true;
        }
      } else {
        if (!internals.fixedSliceComplete) {
          throw new Error("run room cannot idle beyond an incomplete fixed slice");
        }
        if (!internals.roomComplete) {
          const expectedClosureTick120 = internals.boundaries.start
            + FIRST_FIXED_ROOM_CLOSURE_RELATIVE_TICK120;
          if (tick120 !== expectedClosureTick120) {
            throw new Error("run room closure lost the exact H+1702 boundary");
          }
          assertFirstFixedRoomClosureReady(internals, runBefore);
          closeFirstFixedRoom = true;
          closureCommittedEventsBefore = CanonicalEventBus.prototype.events.call(internals.eventBus);
        }
        CanonicalRunCombatState.prototype.stepIdle.call(
          internals.runState,
          sanitizedInput(input),
          ROOM_ID,
        );
        internals.tick120 = tick120;
      }
      const runAfter = assertSynchronized(internals);
      if (closeFirstFixedRoom) {
        assertFirstFixedRoomClosurePostflight(
          internals,
          runAfter,
          closureCommittedEventsBefore,
        );
        internals.roomComplete = true;
      }
      return this.snapshot();
    } catch (error) {
      internals.fault = asError(error);
      throw error;
    } finally {
      internals.advancing = false;
    }
  }
}
