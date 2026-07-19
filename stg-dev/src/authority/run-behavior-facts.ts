import roomComposersJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/room-composers-v4.json";

import type {CanonicalEventId, CanonicalGameplayEvent} from "./events";
import type {FlowerIntensitySnapshot, FlowerIntensitySource} from "./flower";
import {
  GAZE_AUTHORITY_CONTRACT,
  type GazeAuthoritySample,
  type GazeAuthoritySnapshot,
  type GazeAuthorityState,
} from "./gaze";
import type {
  DirectionalOverrideSnapshot,
  DirectionalOverrideState,
  PlayerLifeState,
} from "./player";
import type {Vec2} from "./projectiles";
import {FIRST_FIXED_ROOM_CLOSURE_CONTRACT} from "./run-room-session";

const UINT32_MAX = 0xffff_ffff;
const SCHEMA_VERSION = "1.0.0-ext-2026-006" as const;
const PRODUCER_ID = "canonical-run-session.accepted-tick-observer" as const;
const PRODUCER_VERSION = "1.0.0" as const;
const RECENT_INPUT_SUPPLEMENT_AUTHORITY =
  "canonical-run-first-room-recent-input-supplement-v1" as const;
const RECENT_INPUT_SUPPLEMENT_SCHEMA_VERSION = "1.0.0-ext-2026-011" as const;
const RECENT_INPUT_SUPPLEMENT_PRODUCER_ID =
  "canonical-run-behavior-facts.first-room-recent-input-observer" as const;
const RECENT_INPUT_SUPPLEMENT_PRODUCER_VERSION = "1.0.0" as const;
const FIRST_ROOM_TICK_COUNT = FIRST_FIXED_ROOM_CLOSURE_CONTRACT.closureRelativeTick120;

export type CanonicalRunBehaviorOwnerPhase =
  | "quiet_awakening"
  | "first_eye"
  | "first_clamp_recovery"
  | "room_sampling";

export interface CanonicalRunBehaviorFactsOptions {
  readonly rawRunSeed: Readonly<{
    readonly domain: "raw-run-seed";
    readonly value: number;
  }>;
  /** Events already committed before the first accepted player tick. */
  readonly baselineEvents: readonly CanonicalGameplayEvent[];
}

export interface CanonicalRunBehaviorRequestedTick {
  readonly tick120: number;
  readonly movement: Vec2;
  readonly signalActive: boolean;
  readonly focused: boolean;
  readonly gaze: GazeAuthoritySample;
  readonly overridePressed: boolean;
  readonly overrideReleased: boolean;
  readonly overrideDirection: Vec2 | null;
}

export interface CanonicalRunBehaviorCommittedTick {
  readonly player: Readonly<{
    readonly position: Vec2;
    readonly inputEnabled: boolean;
    readonly focused: boolean;
    readonly lifeState: PlayerLifeState | null;
  }>;
  readonly flower: FlowerIntensitySnapshot;
  readonly gaze: GazeAuthoritySnapshot;
  /** Null means the current owner did not consume Override authority this tick. */
  readonly override: DirectionalOverrideSnapshot | null;
  /** Null means the current owner did not consume a mental-room context this tick. */
  readonly roomId: string | null;
  /** Distinguishes an available idle run-combat context from a missing authority. */
  readonly runCombatAvailable: boolean;
  readonly activeOccurrenceId: string | null;
  /** Only the already-closed current-tick delta, never the retained event history. */
  readonly canonicalEvents: readonly CanonicalGameplayEvent[];
  readonly sourceEventCount: number;
}

export interface CanonicalRunBehaviorInputConsumption {
  readonly movement: boolean;
  readonly signal: boolean;
  readonly focus: boolean;
  readonly gaze: boolean;
}

export interface CanonicalRunBehaviorAcceptedTick {
  readonly ownerPhase: CanonicalRunBehaviorOwnerPhase;
  /** Pre-step proposal committed only after the authority tick closes successfully. */
  readonly inputConsumption: CanonicalRunBehaviorInputConsumption;
  readonly requested: CanonicalRunBehaviorRequestedTick;
  readonly committed: CanonicalRunBehaviorCommittedTick;
}

export interface CanonicalRunBehaviorCountEntry {
  readonly id: string;
  readonly ticks120: number;
}

export interface CanonicalRunBehaviorEventCountEntry {
  readonly id: CanonicalEventId;
  readonly count: number;
}

export interface CanonicalRunBehaviorMissing {
  readonly availability: "missing";
  readonly reason:
    | "no-accepted-tick"
    | "authority-not-consumed-yet"
    | "room-context-not-consumed-yet"
    | "run-combat-context-not-consumed-yet";
}

export interface CanonicalRunBehaviorAvailable<T> {
  readonly availability: "available";
  readonly firstAvailableTick120: number;
  readonly lastAvailableTick120: number;
  readonly sampleCount: number;
  readonly aggregate: Readonly<T>;
}

export interface CanonicalRunBehaviorFactsSnapshot {
  readonly authority: "canonical-run-behavior-facts-v1";
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly producerId: typeof PRODUCER_ID;
  readonly producerVersion: typeof PRODUCER_VERSION;
  readonly extensionPolicy: "EXT-2026-006";
  readonly rawRunSeed: CanonicalRunBehaviorFactsOptions["rawRunSeed"];
  readonly tick120: number;
  readonly acceptedTickCount: number;
  readonly sampling: Readonly<{
    readonly tickZeroExcluded: true;
    readonly firstAcceptedTick120: number | null;
    readonly lastAcceptedTick120: number | null;
    readonly ownerPhaseTickCounts: readonly CanonicalRunBehaviorCountEntry[];
  }>;
  readonly requested: CanonicalRunBehaviorMissing | CanonicalRunBehaviorAvailable<{
    readonly movementNonZeroTickCount: number;
    readonly movementXSum: number;
    readonly movementYSum: number;
    readonly movementMagnitudeSum: number;
    readonly signalActiveTickCount: number;
    readonly signalRisingEdgeCount: number;
    readonly focusRequestedTickCount: number;
    readonly gazeVisibleTickCount: number;
    readonly gazePitchDegreesMin: number;
    readonly gazePitchDegreesMax: number;
    readonly gazeAlignmentSum: number;
    readonly gazeQualifiedInputTickCount: number;
    readonly overridePressedEdgeCount: number;
    readonly overrideReleasedEdgeCount: number;
    readonly overrideDirectionRequestCount: number;
  }>;
  readonly committed: Readonly<{
    readonly player: CanonicalRunBehaviorMissing | CanonicalRunBehaviorAvailable<{
      readonly inputEnabledTickCount: number;
      readonly focusedTickCount: number;
      readonly positionXSum: number;
      readonly positionYSum: number;
      readonly positionMinX: number;
      readonly positionMaxX: number;
      readonly positionMinY: number;
      readonly positionMaxY: number;
      readonly lifeStateObservedTickCount: number;
      readonly lifeStateTickCounts: readonly CanonicalRunBehaviorCountEntry[];
    }>;
    readonly flower: CanonicalRunBehaviorMissing | CanonicalRunBehaviorAvailable<{
      readonly targetIntensitySum: number;
      readonly sourceTickCounts: readonly CanonicalRunBehaviorCountEntry[];
    }>;
    readonly gaze: CanonicalRunBehaviorMissing | CanonicalRunBehaviorAvailable<{
      readonly clampActiveTickCount: number;
      readonly stateTickCounts: readonly CanonicalRunBehaviorCountEntry[];
    }>;
    readonly override: CanonicalRunBehaviorMissing | CanonicalRunBehaviorAvailable<{
      readonly stateTickCounts: readonly CanonicalRunBehaviorCountEntry[];
      readonly maximumCycle: number;
      readonly maximumScarCount: number;
    }>;
  }>;
  readonly context: Readonly<{
    readonly room: CanonicalRunBehaviorMissing | CanonicalRunBehaviorAvailable<{
      readonly roomTickCounts: readonly CanonicalRunBehaviorCountEntry[];
    }>;
    readonly runCombat: CanonicalRunBehaviorMissing | CanonicalRunBehaviorAvailable<{
      readonly noActiveOccurrenceTickCount: number;
      readonly activeOccurrenceTickCounts: readonly CanonicalRunBehaviorCountEntry[];
    }>;
  }>;
  readonly canonicalEvents: Readonly<{
    readonly tickZeroBaselineCount: number;
    readonly observedCount: number;
    readonly lastObservedSequence: number | null;
    readonly countsById: readonly CanonicalRunBehaviorEventCountEntry[];
  }>;
  readonly composerAvailability: Readonly<{
    readonly status: "withheld-metric-projection-policy-not-authored";
    readonly ready: false;
    readonly selectionAllowed: false;
    readonly unresolvedMetricIds: readonly string[];
  }>;
  readonly adapterPolicy: Readonly<{
    readonly sampleBoundary: "post-authority-after-closed-canonical-tick";
    readonly ownerPhase: "captured-before-phase-specific-step";
    readonly storage: "bounded-rolling-aggregates-no-per-tick-history";
    readonly requestCommitSeparation: true;
    readonly canonicalEventWrites: 0;
    readonly metricProjection: false;
    readonly provenance: "application-policy-EXT-2026-006";
  }>;
}

declare const canonicalRunBehaviorFactsReceiptBrand: unique symbol;
declare const canonicalRunBehaviorLineageIdentityBrand: unique symbol;
declare const canonicalRunFirstRoomRecentInputSupplementReceiptBrand: unique symbol;

/** Opaque per-ledger identity. Equality is meaningful; its contents never serialize. */
export interface CanonicalRunBehaviorLineageIdentity {
  readonly [canonicalRunBehaviorLineageIdentityBrand]: true;
}

/** Opaque proof that one snapshot came from a live ledger's closed current tick. */
export interface CanonicalRunBehaviorFactsReceipt {
  readonly [canonicalRunBehaviorFactsReceiptBrand]: true;
}

export interface CanonicalRunFirstRoomRecentInputSupplementSource {
  readonly availability: "available";
  readonly authority: typeof RECENT_INPUT_SUPPLEMENT_AUTHORITY;
  readonly schemaVersion: typeof RECENT_INPUT_SUPPLEMENT_SCHEMA_VERSION;
  readonly producerId: typeof RECENT_INPUT_SUPPLEMENT_PRODUCER_ID;
  readonly producerVersion: typeof RECENT_INPUT_SUPPLEMENT_PRODUCER_VERSION;
  readonly extensionPolicy: "EXT-2026-011";
  readonly sourceEpoch: "first-authored-room-input-window";
  readonly capturedAtTick120: number;
  readonly rawRunSeed: CanonicalRunBehaviorFactsOptions["rawRunSeed"];
  readonly sourceWindow: Readonly<{
    readonly firstTick120: number;
    readonly lastTick120: number;
  }>;
  readonly roomTickCount: number;
  readonly activeUnionTickCount: number;
  readonly canonicalEventWrites: 0;
}

export interface CanonicalRunFirstRoomRecentInputSupplementReceipt {
  readonly [canonicalRunFirstRoomRecentInputSupplementReceiptBrand]: true;
}

interface CanonicalRunBehaviorFactsReceiptRecord {
  readonly facts: CanonicalRunBehaviorFactsSnapshot;
  readonly lineage: CanonicalRunBehaviorLineageIdentity;
}

interface CanonicalRunFirstRoomRecentInputSupplementReceiptRecord {
  readonly source: CanonicalRunFirstRoomRecentInputSupplementSource;
  readonly lineage: CanonicalRunBehaviorLineageIdentity;
}

const CANONICAL_RUN_BEHAVIOR_FACTS_RECEIPTS = new WeakMap<
  object,
  CanonicalRunBehaviorFactsReceiptRecord
>();
const CANONICAL_RUN_FIRST_ROOM_RECENT_INPUT_SUPPLEMENT_RECEIPTS = new WeakMap<
  object,
  CanonicalRunFirstRoomRecentInputSupplementReceiptRecord
>();

function behaviorFactsReceiptRecord(
  value: CanonicalRunBehaviorFactsReceipt,
): CanonicalRunBehaviorFactsReceiptRecord {
  if (typeof value !== "object" || value === null) {
    throw new Error("behavior facts receipt must be an opaque object");
  }
  const record = CANONICAL_RUN_BEHAVIOR_FACTS_RECEIPTS.get(value);
  if (record === undefined) throw new Error("behavior facts receipt was not issued by a live ledger");
  return record;
}

function recentInputSupplementReceiptRecord(
  value: CanonicalRunFirstRoomRecentInputSupplementReceipt,
): CanonicalRunFirstRoomRecentInputSupplementReceiptRecord {
  if (typeof value !== "object" || value === null) {
    throw new Error("first-room recent-input supplement receipt must be an opaque object");
  }
  const record = CANONICAL_RUN_FIRST_ROOM_RECENT_INPUT_SUPPLEMENT_RECEIPTS.get(value);
  if (record === undefined) {
    throw new Error("first-room recent-input supplement receipt was not issued by a live ledger");
  }
  return record;
}

export function behaviorFactsFromCanonicalReceipt(
  value: CanonicalRunBehaviorFactsReceipt,
): CanonicalRunBehaviorFactsSnapshot {
  return behaviorFactsReceiptRecord(value).facts;
}

export function behaviorFactsLineageFromCanonicalReceipt(
  value: CanonicalRunBehaviorFactsReceipt,
): CanonicalRunBehaviorLineageIdentity {
  return behaviorFactsReceiptRecord(value).lineage;
}

export function firstRoomRecentInputSupplementFromCanonicalReceipt(
  value: CanonicalRunFirstRoomRecentInputSupplementReceipt,
): CanonicalRunFirstRoomRecentInputSupplementSource {
  return recentInputSupplementReceiptRecord(value).source;
}

export function firstRoomRecentInputLineageFromCanonicalReceipt(
  value: CanonicalRunFirstRoomRecentInputSupplementReceipt,
): CanonicalRunBehaviorLineageIdentity {
  return recentInputSupplementReceiptRecord(value).lineage;
}

interface AvailabilityState {
  firstTick120: number | null;
  lastTick120: number | null;
  sampleCount: number;
}

interface InternalState {
  tick120: number;
  acceptedTickCount: number;
  firstAcceptedTick120: number | null;
  lastAcceptedTick120: number | null;
  ownerPhaseTickCounts: Record<string, number>;
  previousSignalActive: boolean;
  requested: AvailabilityState & {
    movementNonZeroTickCount: number;
    movementXSum: number;
    movementYSum: number;
    movementMagnitudeSum: number;
    signalActiveTickCount: number;
    signalRisingEdgeCount: number;
    focusRequestedTickCount: number;
    gazeVisibleTickCount: number;
    gazePitchDegreesMin: number;
    gazePitchDegreesMax: number;
    gazeAlignmentSum: number;
    gazeQualifiedInputTickCount: number;
    overridePressedEdgeCount: number;
    overrideReleasedEdgeCount: number;
    overrideDirectionRequestCount: number;
  };
  player: AvailabilityState & {
    inputEnabledTickCount: number;
    focusedTickCount: number;
    positionXSum: number;
    positionYSum: number;
    positionMinX: number;
    positionMaxX: number;
    positionMinY: number;
    positionMaxY: number;
    lifeStateObservedTickCount: number;
    lifeStateTickCounts: Record<string, number>;
  };
  flower: AvailabilityState & {
    targetIntensitySum: number;
    sourceTickCounts: Record<string, number>;
  };
  gaze: AvailabilityState & {
    clampActiveTickCount: number;
    stateTickCounts: Record<string, number>;
  };
  override: AvailabilityState & {
    stateTickCounts: Record<string, number>;
    maximumCycle: number;
    maximumScarCount: number;
  };
  room: AvailabilityState & {roomTickCounts: Record<string, number>};
  runCombat: AvailabilityState & {
    noActiveOccurrenceTickCount: number;
    activeOccurrenceTickCounts: Record<string, number>;
  };
  observedEventCount: number;
  lastObservedSequence: number | null;
  eventCountsById: Record<string, number>;
  firstRoomRecentInput: {
    firstTick120: number | null;
    lastTick120: number | null;
    roomTickCount: number;
    activeUnionTickCount: number;
  };
}

const OWNER_PHASES = new Set<CanonicalRunBehaviorOwnerPhase>([
  "quiet_awakening",
  "first_eye",
  "first_clamp_recovery",
  "room_sampling",
]);
const FLOWER_SOURCES = new Set<FlowerIntensitySource>(["override", "gaze", "focus", "signal"]);
const GAZE_STATES = new Set<GazeAuthorityState>(["idle", "acquiring", "clamped", "release-delay"]);
const OVERRIDE_STATES = new Set<DirectionalOverrideState>([
  "idle",
  "charging",
  "active",
  "sediment",
  "cooldown",
]);
const PLAYER_LIFE_STATES = new Set<PlayerLifeState>(["alive", "dead", "respawning", "run-ended"]);

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const entry of Object.values(value)) deepFreeze(entry, seen);
  return Object.freeze(value);
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be finite`);
  return Object.is(value, -0) ? 0 : value;
}

function safeNonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || Object.is(value, -0)) {
    throw new Error(`${path} must be a non-negative safe integer`);
  }
  return value as number;
}

function nonEmpty(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${path} must be non-empty`);
  return value;
}

function addCount(value: number, amount: number, path: string): number {
  const result = value + amount;
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`${path} exceeded safe integer range`);
  return result;
}

function addFinite(value: number, amount: number, path: string): number {
  const result = value + amount;
  if (!Number.isFinite(result)) throw new Error(`${path} exceeded finite number range`);
  return Object.is(result, -0) ? 0 : result;
}

function increment(counts: Record<string, number>, id: string, path: string): void {
  counts[id] = addCount(counts[id] ?? 0, 1, `${path}.${id}`);
}

function markAvailable(value: AvailabilityState, tick120: number): void {
  if (value.firstTick120 === null) value.firstTick120 = tick120;
  value.lastTick120 = tick120;
  value.sampleCount = addCount(value.sampleCount, 1, "availability sample count");
}

function availability(): AvailabilityState {
  return {firstTick120: null, lastTick120: null, sampleCount: 0};
}

function countsSnapshot(value: Readonly<Record<string, number>>): readonly CanonicalRunBehaviorCountEntry[] {
  return Object.freeze(Object.keys(value).sort(compareCodePoints).map((id) => Object.freeze({
    id,
    ticks120: value[id] as number,
  })));
}

function eventCountsSnapshot(
  value: Readonly<Record<string, number>>,
): readonly CanonicalRunBehaviorEventCountEntry[] {
  return Object.freeze(Object.keys(value).sort(compareCodePoints).map((id) => Object.freeze({
    id: id as CanonicalEventId,
    count: value[id] as number,
  })));
}

function missing(reason: CanonicalRunBehaviorMissing["reason"]): CanonicalRunBehaviorMissing {
  return Object.freeze({availability: "missing" as const, reason});
}

function available<T>(
  value: AvailabilityState,
  aggregate: T,
): CanonicalRunBehaviorAvailable<T> {
  if (value.firstTick120 === null || value.lastTick120 === null || value.sampleCount === 0) {
    throw new Error("available behavior aggregate lost its sampling boundary");
  }
  return deepFreeze({
    availability: "available" as const,
    firstAvailableTick120: value.firstTick120,
    lastAvailableTick120: value.lastTick120,
    sampleCount: value.sampleCount,
    aggregate,
  });
}

function metricUniverse(): readonly string[] {
  if (roomComposersJson.schemaVersion !== "4.0.0") {
    throw new Error("behavior facts require the V4 room-composer schema identity");
  }
  const ids = new Set<string>();
  for (const composer of roomComposersJson.composers) {
    if (composer.algorithm !== "seeded_weighted_without_replacement_with_behavior_bias") {
      throw new Error(`room composer algorithm drifted: ${composer.id}`);
    }
    for (const id of Object.keys(composer.behaviorMetricWeights)) ids.add(id);
  }
  const result = [...ids].sort(compareCodePoints);
  if (result.length !== 14) throw new Error("V4 room-composer metric universe must contain fourteen IDs");
  return Object.freeze(result);
}

const UNRESOLVED_METRIC_IDS = metricUniverse();

function captureRawRunSeed(
  value: CanonicalRunBehaviorFactsOptions["rawRunSeed"],
): CanonicalRunBehaviorFactsOptions["rawRunSeed"] {
  if (
    typeof value !== "object"
    || value === null
    || value.domain !== "raw-run-seed"
    || !Number.isSafeInteger(value.value)
    || value.value < 0
    || value.value > UINT32_MAX
    || Object.is(value.value, -0)
  ) {
    throw new Error("behavior facts rawRunSeed must be a tagged uint32");
  }
  return Object.freeze({domain: "raw-run-seed", value: value.value});
}

function validateBaseline(events: readonly CanonicalGameplayEvent[]): void {
  for (const [index, event] of events.entries()) {
    if (event.tick120 !== 0 || event.sequence !== index) {
      throw new Error("behavior facts baseline must be the complete tick-zero event prefix");
    }
  }
}

function initialState(): InternalState {
  return deepFreeze({
    tick120: 0,
    acceptedTickCount: 0,
    firstAcceptedTick120: null,
    lastAcceptedTick120: null,
    ownerPhaseTickCounts: {},
    previousSignalActive: false,
    requested: {
      ...availability(),
      movementNonZeroTickCount: 0,
      movementXSum: 0,
      movementYSum: 0,
      movementMagnitudeSum: 0,
      signalActiveTickCount: 0,
      signalRisingEdgeCount: 0,
      focusRequestedTickCount: 0,
      gazeVisibleTickCount: 0,
      gazePitchDegreesMin: Number.POSITIVE_INFINITY,
      gazePitchDegreesMax: Number.NEGATIVE_INFINITY,
      gazeAlignmentSum: 0,
      gazeQualifiedInputTickCount: 0,
      overridePressedEdgeCount: 0,
      overrideReleasedEdgeCount: 0,
      overrideDirectionRequestCount: 0,
    },
    player: {
      ...availability(),
      inputEnabledTickCount: 0,
      focusedTickCount: 0,
      positionXSum: 0,
      positionYSum: 0,
      positionMinX: Number.POSITIVE_INFINITY,
      positionMaxX: Number.NEGATIVE_INFINITY,
      positionMinY: Number.POSITIVE_INFINITY,
      positionMaxY: Number.NEGATIVE_INFINITY,
      lifeStateObservedTickCount: 0,
      lifeStateTickCounts: {},
    },
    flower: {
      ...availability(),
      targetIntensitySum: 0,
      sourceTickCounts: {},
    },
    gaze: {...availability(), clampActiveTickCount: 0, stateTickCounts: {}},
    override: {
      ...availability(),
      stateTickCounts: {},
      maximumCycle: 0,
      maximumScarCount: 0,
    },
    room: {...availability(), roomTickCounts: {}},
    runCombat: {
      ...availability(),
      noActiveOccurrenceTickCount: 0,
      activeOccurrenceTickCounts: {},
    },
    observedEventCount: 0,
    lastObservedSequence: null,
    eventCountsById: {},
    firstRoomRecentInput: {
      firstTick120: null,
      lastTick120: null,
      roomTickCount: 0,
      activeUnionTickCount: 0,
    },
  });
}

function cloneState(value: InternalState): InternalState {
  return {
    ...value,
    ownerPhaseTickCounts: {...value.ownerPhaseTickCounts},
    requested: {...value.requested},
    player: {...value.player, lifeStateTickCounts: {...value.player.lifeStateTickCounts}},
    flower: {
      ...value.flower,
      sourceTickCounts: {...value.flower.sourceTickCounts},
    },
    gaze: {...value.gaze, stateTickCounts: {...value.gaze.stateTickCounts}},
    override: {...value.override, stateTickCounts: {...value.override.stateTickCounts}},
    room: {...value.room, roomTickCounts: {...value.room.roomTickCounts}},
    runCombat: {
      ...value.runCombat,
      activeOccurrenceTickCounts: {...value.runCombat.activeOccurrenceTickCounts},
    },
    eventCountsById: {...value.eventCountsById},
    firstRoomRecentInput: {...value.firstRoomRecentInput},
  };
}

function captureInputConsumption(
  value: unknown,
): Readonly<CanonicalRunBehaviorInputConsumption> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("behavior facts inputConsumption must be an exact object");
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("behavior facts inputConsumption must be a plain object");
  }
  const expected = ["focus", "gaze", "movement", "signal"];
  const keys = Reflect.ownKeys(value).sort((left, right) => compareCodePoints(String(left), String(right)));
  if (
    keys.length !== expected.length
    || keys.some((key, index) => typeof key !== "string" || key !== expected[index])
  ) {
    throw new Error("behavior facts inputConsumption must contain only movement, signal, focus, and gaze");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const captured: Record<string, boolean> = {};
  for (const key of expected) {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined
      || !("value" in descriptor)
      || descriptor.enumerable !== true
      || typeof descriptor.value !== "boolean"
    ) {
      throw new Error(`behavior facts inputConsumption.${key} must be an enumerable boolean data property`);
    }
    captured[key] = descriptor.value;
  }
  return Object.freeze({
    movement: captured.movement as boolean,
    signal: captured.signal as boolean,
    focus: captured.focus as boolean,
    gaze: captured.gaze as boolean,
  });
}

function validateAcceptedTick(
  value: CanonicalRunBehaviorAcceptedTick,
  previousTick120: number,
): Readonly<CanonicalRunBehaviorInputConsumption> {
  if (!OWNER_PHASES.has(value.ownerPhase)) throw new Error("behavior facts owner phase is invalid");
  const inputConsumption = captureInputConsumption(value.inputConsumption);
  if (value.ownerPhase === "room_sampling" && inputConsumption.gaze !== true) {
    throw new Error("behavior facts room_sampling must consume the Gaze channel");
  }
  const tick120 = safeNonNegativeInteger(value.requested.tick120, "behavior facts tick120");
  if (tick120 !== previousTick120 + 1) {
    throw new Error(`behavior facts must advance one accepted tick: ${previousTick120} -> ${tick120}`);
  }
  finite(value.requested.movement.x, "behavior facts requested movement.x");
  finite(value.requested.movement.y, "behavior facts requested movement.y");
  if (typeof value.requested.signalActive !== "boolean") {
    throw new Error("behavior facts requested signalActive must be boolean");
  }
  if (typeof value.requested.focused !== "boolean") {
    throw new Error("behavior facts requested focused must be boolean");
  }
  if (typeof value.requested.gaze.skyEyeVisible !== "boolean") {
    throw new Error("behavior facts requested Gaze visibility must be boolean");
  }
  finite(value.requested.gaze.pitchDegrees, "behavior facts requested gaze pitch");
  finite(value.requested.gaze.alignment, "behavior facts requested gaze alignment");
  finite(value.committed.player.position.x, "behavior facts committed player x");
  finite(value.committed.player.position.y, "behavior facts committed player y");
  if (value.committed.player.lifeState !== null && !PLAYER_LIFE_STATES.has(value.committed.player.lifeState)) {
    throw new Error("behavior facts committed player life state is invalid");
  }
  if (value.committed.flower.resolution === null) {
    throw new Error("behavior facts require a committed Flower resolution");
  }
  finite(value.committed.flower.resolution.targetIntensity, "behavior facts Flower target");
  if (!FLOWER_SOURCES.has(value.committed.flower.resolution.source)) {
    throw new Error("behavior facts Flower source is invalid");
  }
  if (!GAZE_STATES.has(value.committed.gaze.state)) {
    throw new Error("behavior facts Gaze state is invalid");
  }
  if (value.committed.override !== null) {
    if (value.committed.override.tick120 !== tick120 || !OVERRIDE_STATES.has(value.committed.override.state)) {
      throw new Error("behavior facts Override snapshot was not committed at the sampled tick");
    }
  }
  if (!value.committed.runCombatAvailable && value.committed.activeOccurrenceId !== null) {
    throw new Error("behavior facts cannot expose an occurrence without run-combat authority");
  }
  if (value.committed.roomId !== null) nonEmpty(value.committed.roomId, "behavior facts roomId");
  if (value.committed.activeOccurrenceId !== null) {
    nonEmpty(value.committed.activeOccurrenceId, "behavior facts occurrenceId");
  }
  safeNonNegativeInteger(value.committed.sourceEventCount, "behavior facts source event count");
  return inputConsumption;
}

/**
 * A run-owned observation ledger. It never emits gameplay events and never
 * produces the fourteen composer metrics. Each accepted tick replaces one
 * bounded, recursively frozen aggregate state.
 */
export class CanonicalRunBehaviorFactLedger {
  private readonly rawRunSeed: CanonicalRunBehaviorFactsOptions["rawRunSeed"];
  private readonly baselineEventCount: number;
  private readonly lineage = Object.freeze(
    Object.create(null),
  ) as CanonicalRunBehaviorLineageIdentity;
  private state: InternalState = initialState();

  constructor(options: CanonicalRunBehaviorFactsOptions) {
    this.rawRunSeed = captureRawRunSeed(options.rawRunSeed);
    validateBaseline(options.baselineEvents);
    this.baselineEventCount = options.baselineEvents.length;
  }

  recordAcceptedTick(value: CanonicalRunBehaviorAcceptedTick): void {
    const inputConsumption = validateAcceptedTick(value, this.state.tick120);
    const next = cloneState(this.state);
    const tick120 = value.requested.tick120;
    next.tick120 = tick120;
    next.acceptedTickCount = addCount(next.acceptedTickCount, 1, "accepted tick count");
    if (next.firstAcceptedTick120 === null) next.firstAcceptedTick120 = tick120;
    next.lastAcceptedTick120 = tick120;
    increment(next.ownerPhaseTickCounts, value.ownerPhase, "owner phase tick counts");

    const requested = value.requested;
    markAvailable(next.requested, tick120);
    const movementX = finite(requested.movement.x, "requested movement x");
    const movementY = finite(requested.movement.y, "requested movement y");
    const movementMagnitude = Math.hypot(movementX, movementY);
    if (movementMagnitude > 0) {
      next.requested.movementNonZeroTickCount = addCount(
        next.requested.movementNonZeroTickCount,
        1,
        "requested movement non-zero ticks",
      );
    }
    next.requested.movementXSum = addFinite(next.requested.movementXSum, movementX, "movement x sum");
    next.requested.movementYSum = addFinite(next.requested.movementYSum, movementY, "movement y sum");
    next.requested.movementMagnitudeSum = addFinite(
      next.requested.movementMagnitudeSum,
      movementMagnitude,
      "movement magnitude sum",
    );
    if (requested.signalActive) {
      next.requested.signalActiveTickCount = addCount(
        next.requested.signalActiveTickCount,
        1,
        "signal active ticks",
      );
      if (!next.previousSignalActive) {
        next.requested.signalRisingEdgeCount = addCount(
          next.requested.signalRisingEdgeCount,
          1,
          "signal rising edges",
        );
      }
    }
    next.previousSignalActive = requested.signalActive;
    if (requested.focused) {
      next.requested.focusRequestedTickCount = addCount(
        next.requested.focusRequestedTickCount,
        1,
        "focus requested ticks",
      );
    }
    if (requested.gaze.skyEyeVisible) {
      next.requested.gazeVisibleTickCount = addCount(
        next.requested.gazeVisibleTickCount,
        1,
        "gaze visible ticks",
      );
    }
    next.requested.gazePitchDegreesMin = Math.min(
      next.requested.gazePitchDegreesMin,
      requested.gaze.pitchDegrees,
    );
    next.requested.gazePitchDegreesMax = Math.max(
      next.requested.gazePitchDegreesMax,
      requested.gaze.pitchDegrees,
    );
    next.requested.gazeAlignmentSum = addFinite(
      next.requested.gazeAlignmentSum,
      requested.gaze.alignment,
      "gaze alignment sum",
    );
    const gazeQualified = (
      requested.gaze.skyEyeVisible
      && requested.gaze.pitchDegrees >= GAZE_AUTHORITY_CONTRACT.pitchThresholdDegrees
      && requested.gaze.alignment >= GAZE_AUTHORITY_CONTRACT.alignmentThreshold
    );
    if (gazeQualified) {
      next.requested.gazeQualifiedInputTickCount = addCount(
        next.requested.gazeQualifiedInputTickCount,
        1,
        "qualified gaze input ticks",
      );
    }

    const recentInput = next.firstRoomRecentInput;
    if (
      value.ownerPhase === "room_sampling"
      && recentInput.roomTickCount < FIRST_ROOM_TICK_COUNT
    ) {
      if (recentInput.firstTick120 === null) {
        recentInput.firstTick120 = tick120;
      } else if (recentInput.lastTick120 === null || tick120 !== recentInput.lastTick120 + 1) {
        throw new Error("behavior facts first-room input window must be contiguous");
      }
      recentInput.lastTick120 = tick120;
      recentInput.roomTickCount = addCount(
        recentInput.roomTickCount,
        1,
        "first-room recent-input room ticks",
      );
      const active = (
        (inputConsumption.movement && movementMagnitude > 0)
        || (inputConsumption.signal && requested.signalActive)
        || (inputConsumption.focus && requested.focused)
        || (inputConsumption.gaze && gazeQualified)
      );
      if (active) {
        recentInput.activeUnionTickCount = addCount(
          recentInput.activeUnionTickCount,
          1,
          "first-room recent-input active union ticks",
        );
      }
    }
    if (requested.overridePressed) {
      next.requested.overridePressedEdgeCount = addCount(
        next.requested.overridePressedEdgeCount,
        1,
        "Override press requests",
      );
    }
    if (requested.overrideReleased) {
      next.requested.overrideReleasedEdgeCount = addCount(
        next.requested.overrideReleasedEdgeCount,
        1,
        "Override release requests",
      );
    }
    if (requested.overrideDirection !== null) {
      finite(requested.overrideDirection.x, "requested Override direction x");
      finite(requested.overrideDirection.y, "requested Override direction y");
      next.requested.overrideDirectionRequestCount = addCount(
        next.requested.overrideDirectionRequestCount,
        1,
        "Override direction requests",
      );
    }

    const player = value.committed.player;
    markAvailable(next.player, tick120);
    if (player.inputEnabled) {
      next.player.inputEnabledTickCount = addCount(
        next.player.inputEnabledTickCount,
        1,
        "player input-enabled ticks",
      );
    }
    if (player.focused) {
      next.player.focusedTickCount = addCount(
        next.player.focusedTickCount,
        1,
        "player focused ticks",
      );
    }
    next.player.positionXSum = addFinite(next.player.positionXSum, player.position.x, "player x sum");
    next.player.positionYSum = addFinite(next.player.positionYSum, player.position.y, "player y sum");
    next.player.positionMinX = Math.min(next.player.positionMinX, player.position.x);
    next.player.positionMaxX = Math.max(next.player.positionMaxX, player.position.x);
    next.player.positionMinY = Math.min(next.player.positionMinY, player.position.y);
    next.player.positionMaxY = Math.max(next.player.positionMaxY, player.position.y);
    if (player.lifeState !== null) {
      next.player.lifeStateObservedTickCount = addCount(
        next.player.lifeStateObservedTickCount,
        1,
        "player life-state samples",
      );
      increment(next.player.lifeStateTickCounts, player.lifeState, "player life-state ticks");
    }

    const flower = value.committed.flower.resolution;
    if (flower === null) throw new Error("validated Flower resolution disappeared");
    markAvailable(next.flower, tick120);
    next.flower.targetIntensitySum = addFinite(
      next.flower.targetIntensitySum,
      flower.targetIntensity,
      "Flower target sum",
    );
    increment(next.flower.sourceTickCounts, flower.source, "Flower source ticks");

    const gaze = value.committed.gaze;
    if (gaze.tick120 === tick120) {
      markAvailable(next.gaze, tick120);
      increment(next.gaze.stateTickCounts, gaze.state, "Gaze state ticks");
      if (gaze.clampActive) {
        next.gaze.clampActiveTickCount = addCount(
          next.gaze.clampActiveTickCount,
          1,
          "Gaze clamp-active ticks",
        );
      }
    }

    const override = value.committed.override;
    if (override !== null) {
      markAvailable(next.override, tick120);
      increment(next.override.stateTickCounts, override.state, "Override state ticks");
      next.override.maximumCycle = Math.max(next.override.maximumCycle, override.cycle);
      next.override.maximumScarCount = Math.max(next.override.maximumScarCount, override.scarCount);
    }

    if (value.committed.roomId !== null) {
      markAvailable(next.room, tick120);
      increment(next.room.roomTickCounts, value.committed.roomId, "room context ticks");
    }
    if (value.committed.runCombatAvailable) {
      markAvailable(next.runCombat, tick120);
      if (value.committed.activeOccurrenceId === null) {
        next.runCombat.noActiveOccurrenceTickCount = addCount(
          next.runCombat.noActiveOccurrenceTickCount,
          1,
          "no-active-occurrence ticks",
        );
      } else {
        increment(
          next.runCombat.activeOccurrenceTickCounts,
          value.committed.activeOccurrenceId,
          "active occurrence ticks",
        );
      }
    }

    const expectedSequence = this.baselineEventCount + next.observedEventCount;
    for (const [index, event] of value.committed.canonicalEvents.entries()) {
      if (event.tick120 !== tick120 || event.sequence !== expectedSequence + index) {
        throw new Error("behavior facts event delta is not the closed current-tick trace suffix");
      }
      increment(next.eventCountsById, event.id, "canonical event counts");
      next.lastObservedSequence = event.sequence;
    }
    next.observedEventCount = addCount(
      next.observedEventCount,
      value.committed.canonicalEvents.length,
      "observed canonical event count",
    );
    if (value.committed.sourceEventCount !== this.baselineEventCount + next.observedEventCount) {
      throw new Error("behavior facts event cursor diverged from the canonical trace prefix");
    }

    this.state = deepFreeze(next);
  }

  #snapshotCurrent(): CanonicalRunBehaviorFactsSnapshot {
    const state = this.state;
    const requested = state.requested.sampleCount === 0
      ? missing("no-accepted-tick")
      : available(state.requested, {
        movementNonZeroTickCount: state.requested.movementNonZeroTickCount,
        movementXSum: state.requested.movementXSum,
        movementYSum: state.requested.movementYSum,
        movementMagnitudeSum: state.requested.movementMagnitudeSum,
        signalActiveTickCount: state.requested.signalActiveTickCount,
        signalRisingEdgeCount: state.requested.signalRisingEdgeCount,
        focusRequestedTickCount: state.requested.focusRequestedTickCount,
        gazeVisibleTickCount: state.requested.gazeVisibleTickCount,
        gazePitchDegreesMin: state.requested.gazePitchDegreesMin,
        gazePitchDegreesMax: state.requested.gazePitchDegreesMax,
        gazeAlignmentSum: state.requested.gazeAlignmentSum,
        gazeQualifiedInputTickCount: state.requested.gazeQualifiedInputTickCount,
        overridePressedEdgeCount: state.requested.overridePressedEdgeCount,
        overrideReleasedEdgeCount: state.requested.overrideReleasedEdgeCount,
        overrideDirectionRequestCount: state.requested.overrideDirectionRequestCount,
      });
    const player = state.player.sampleCount === 0
      ? missing("no-accepted-tick")
      : available(state.player, {
        inputEnabledTickCount: state.player.inputEnabledTickCount,
        focusedTickCount: state.player.focusedTickCount,
        positionXSum: state.player.positionXSum,
        positionYSum: state.player.positionYSum,
        positionMinX: state.player.positionMinX,
        positionMaxX: state.player.positionMaxX,
        positionMinY: state.player.positionMinY,
        positionMaxY: state.player.positionMaxY,
        lifeStateObservedTickCount: state.player.lifeStateObservedTickCount,
        lifeStateTickCounts: countsSnapshot(state.player.lifeStateTickCounts),
      });
    const flower = state.flower.sampleCount === 0
      ? missing("no-accepted-tick")
      : available(state.flower, {
        targetIntensitySum: state.flower.targetIntensitySum,
        sourceTickCounts: countsSnapshot(state.flower.sourceTickCounts),
      });
    const gaze = state.gaze.sampleCount === 0
      ? missing("authority-not-consumed-yet")
      : available(state.gaze, {
        clampActiveTickCount: state.gaze.clampActiveTickCount,
        stateTickCounts: countsSnapshot(state.gaze.stateTickCounts),
      });
    const override = state.override.sampleCount === 0
      ? missing("authority-not-consumed-yet")
      : available(state.override, {
        stateTickCounts: countsSnapshot(state.override.stateTickCounts),
        maximumCycle: state.override.maximumCycle,
        maximumScarCount: state.override.maximumScarCount,
      });
    const room = state.room.sampleCount === 0
      ? missing("room-context-not-consumed-yet")
      : available(state.room, {roomTickCounts: countsSnapshot(state.room.roomTickCounts)});
    const runCombat = state.runCombat.sampleCount === 0
      ? missing("run-combat-context-not-consumed-yet")
      : available(state.runCombat, {
        noActiveOccurrenceTickCount: state.runCombat.noActiveOccurrenceTickCount,
        activeOccurrenceTickCounts: countsSnapshot(state.runCombat.activeOccurrenceTickCounts),
      });
    return deepFreeze({
      authority: "canonical-run-behavior-facts-v1" as const,
      schemaVersion: SCHEMA_VERSION,
      producerId: PRODUCER_ID,
      producerVersion: PRODUCER_VERSION,
      extensionPolicy: "EXT-2026-006" as const,
      rawRunSeed: this.rawRunSeed,
      tick120: state.tick120,
      acceptedTickCount: state.acceptedTickCount,
      sampling: {
        tickZeroExcluded: true as const,
        firstAcceptedTick120: state.firstAcceptedTick120,
        lastAcceptedTick120: state.lastAcceptedTick120,
        ownerPhaseTickCounts: countsSnapshot(state.ownerPhaseTickCounts),
      },
      requested,
      committed: {player, flower, gaze, override},
      context: {room, runCombat},
      canonicalEvents: {
        tickZeroBaselineCount: this.baselineEventCount,
        observedCount: state.observedEventCount,
        lastObservedSequence: state.lastObservedSequence,
        countsById: eventCountsSnapshot(state.eventCountsById),
      },
      composerAvailability: {
        status: "withheld-metric-projection-policy-not-authored" as const,
        ready: false as const,
        selectionAllowed: false as const,
        unresolvedMetricIds: UNRESOLVED_METRIC_IDS,
      },
      adapterPolicy: {
        sampleBoundary: "post-authority-after-closed-canonical-tick" as const,
        ownerPhase: "captured-before-phase-specific-step" as const,
        storage: "bounded-rolling-aggregates-no-per-tick-history" as const,
        requestCommitSeparation: true as const,
        canonicalEventWrites: 0 as const,
        metricProjection: false as const,
        provenance: "application-policy-EXT-2026-006" as const,
      },
    });
  }

  snapshot(): CanonicalRunBehaviorFactsSnapshot {
    return this.#snapshotCurrent();
  }

  /**
   * Bind a downstream boundary capture to this exact post-record state without
   * exposing mutable ledger internals or trusting caller-reconstructed facts.
   */
  issueCurrentSnapshotReceipt(): CanonicalRunBehaviorFactsReceipt {
    if (this.state.acceptedTickCount === 0) {
      throw new Error("behavior facts cannot issue a receipt before the first accepted tick");
    }
    const receipt = Object.freeze(Object.create(null)) as CanonicalRunBehaviorFactsReceipt;
    CANONICAL_RUN_BEHAVIOR_FACTS_RECEIPTS.set(receipt, Object.freeze({
      facts: this.#snapshotCurrent(),
      lineage: this.lineage,
    }));
    return receipt;
  }

  /** Issue the exact closed first-room union source; later rolling ticks cannot reissue it. */
  issueFirstRoomRecentInputSupplementReceipt():
    CanonicalRunFirstRoomRecentInputSupplementReceipt {
    const recentInput = this.state.firstRoomRecentInput;
    if (
      recentInput.roomTickCount !== FIRST_ROOM_TICK_COUNT
      || recentInput.firstTick120 === null
      || recentInput.lastTick120 === null
      || recentInput.lastTick120 - recentInput.firstTick120 + 1 !== FIRST_ROOM_TICK_COUNT
      || this.state.tick120 !== recentInput.lastTick120
    ) {
      throw new Error(
        "first-room recent-input supplement receipt requires the exact closed 1702-tick room window",
      );
    }
    if (
      recentInput.activeUnionTickCount < 0
      || recentInput.activeUnionTickCount > recentInput.roomTickCount
    ) {
      throw new Error("first-room recent-input active union is outside its room window");
    }
    const source = deepFreeze({
      availability: "available" as const,
      authority: RECENT_INPUT_SUPPLEMENT_AUTHORITY,
      schemaVersion: RECENT_INPUT_SUPPLEMENT_SCHEMA_VERSION,
      producerId: RECENT_INPUT_SUPPLEMENT_PRODUCER_ID,
      producerVersion: RECENT_INPUT_SUPPLEMENT_PRODUCER_VERSION,
      extensionPolicy: "EXT-2026-011" as const,
      sourceEpoch: "first-authored-room-input-window" as const,
      capturedAtTick120: recentInput.lastTick120,
      rawRunSeed: this.rawRunSeed,
      sourceWindow: {
        firstTick120: recentInput.firstTick120,
        lastTick120: recentInput.lastTick120,
      },
      roomTickCount: recentInput.roomTickCount,
      activeUnionTickCount: recentInput.activeUnionTickCount,
      canonicalEventWrites: 0 as const,
    }) satisfies CanonicalRunFirstRoomRecentInputSupplementSource;
    const receipt = Object.freeze(
      Object.create(null),
    ) as CanonicalRunFirstRoomRecentInputSupplementReceipt;
    CANONICAL_RUN_FIRST_ROOM_RECENT_INPUT_SUPPLEMENT_RECEIPTS.set(
      receipt,
      Object.freeze({source, lineage: this.lineage}),
    );
    return receipt;
  }

  canonicalSerialization(): string {
    return JSON.stringify(this.snapshot());
  }
}
