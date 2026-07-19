/**
 * RunConductor — the thin brain that drives one run.
 *
 * It owns no frame loop, no renderer, no input device and no wall clock. The
 * caller steps it once per authoritative tick120 boundary; everything the
 * conductor does is a pure function of (previous state, this tick's gated
 * input) over manifest-authored content.
 *
 * What it actually is: narrative-state-machine-v4.json's 16 states, loaded as
 * literal runtime data and evaluated against a facts blackboard, plus the
 * wiring that makes those facts true — combat occurrences, gaze/flower, room
 * sampling and thresholds, weather (presentation only), metrics, snapshot
 * observation selection and cross-run materialization.
 *
 * Invariants this file is responsible for:
 *  - integer tick120 identity everywhere; every ms→tick conversion goes
 *    through crossedTickCount (round-up), never a float schedule;
 *  - one Mulberry32 stream per combat occurrence, seeded by the composer's
 *    manifest-derived encounter seed; no Date.now, no Math.random;
 *  - exactly one canonical event-bus flush per tick;
 *  - weather never touches gameplay RNG, collision or projectiles;
 *  - a run ends only with one of the eight authored reasons, and the five
 *    reasons this slice cannot honestly produce throw instead of firing;
 *  - unknown guard names, unknown rooms and unadmitted patterns fail closed.
 */

import executablePatternsJson from
  "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/executable-patterns-v4.json";
import narrativeStateMachineJson from
  "../../../1bit-stg-complete-asset-kit-v4/narrative/narrative-state-machine-v4.json";
import {
  CROSS_RUN_RESTORE_OFFSETS,
  deriveCrossRunRestoreTiming,
} from "../../../1bit-stg-complete-asset-kit-v4/runtime/world";
import type {Vec2} from "../../../1bit-stg-complete-asset-kit-v4/runtime/events";

import {
  CanonicalCombatKernel,
  SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS,
  type CanonicalCombatSnapshot,
  type CombatProjectileSnapshot,
} from "./combat-kernel";
import {
  AUTHORED_TRANSITION_CONTRACT,
  CONDUCTOR_ROOM_IDS,
  OVERRIDE_ELIGIBILITY_GATE,
  RoomThresholdWatcher,
  canonicalEventIdForNarrativeEvent,
  type ConductorRoomId,
} from "./conductor-facts";
import {
  evaluateCompiledGuard,
  parseNarrativeStateMachine,
  type GuardFactValue,
  type NarrativeInputPolicy,
  type ParsedNarrativeStateMachine,
} from "./conductor-guards";
import {
  CanonicalEventBus,
  serializeCanonicalEvents,
  type CanonicalGameplayEvent,
} from "./events";
import {FlowerIntensityAuthority} from "./flower";
import {GazeAuthority, type GazeAuthorityState} from "./gaze";
import {RunMetricsCollector} from "./metrics";
import {
  selectSnapshotObservations,
  validateNarrativeRecord,
  type SelectedObservation,
} from "./narrative";
import type {ProjectilePoolClass} from "./projectiles";
import {executablePattern} from "./pattern-executor";
import type {CrossRunArchiveStore} from "./persistence";
import {RoomTransitionAuthority} from "./room-transition";
import {
  assertRunMemory,
  captureRecorderIssuedRunMemory,
  type FinalizedRunMemory,
  type ResolutionReason,
} from "./run-memory-model";
import {
  composeV4RunComposerPlan,
  validateV4RunComposerMetrics,
  V4_RUN_COMPOSER_METRIC_IDS,
  type V4QaRoomCount,
  type V4QaScheduleEvent,
  type V4RunComposerMetricId,
  type V4RunComposerPlan,
} from "./run-composer";
import {SnapshotAuthority} from "./snapshot";
import {crossedTickCount} from "./tick120";
import {WeatherScheduler, type WeatherSchedulerSnapshot} from "./weather-scheduler";

const LOGICAL_VIEW_WIDTH = 360;
const LOGICAL_VIEW_HEIGHT = 640;
const TICKS_PER_SECOND = 120;

/** EXT-004: the flower recovers 30 ticks after the Eye releases its clamp. */
export const FLOWER_RECOVERY_ANCHOR_TICKS120 = 30 as const;

/** Adapter gaps the V4 manifests deliberately leave to the runtime. */
const COMBAT_GRAZE_RADIUS_PX = 18;
const COMBAT_PROJECTILE_DAMAGE = 1;

/**
 * The three run-end reasons this slice can commit from real authored facts.
 * BODY_COLLAPSE comes from the player damage authority, PROTOCOL_WITHDRAWAL
 * from the authored run-end eligibility thresholds, NO_DUSK_WITHDRAWAL from
 * the POLARIZED no-dusk path.
 */
export const CONDUCTOR_SUPPORTED_RUN_END_REASONS: readonly ResolutionReason[] = Object.freeze([
  "BODY_COLLAPSE",
  "PROTOCOL_WITHDRAWAL",
  "NO_DUSK_WITHDRAWAL",
]);

/**
 * The five authored reasons whose producing mechanics are not in this slice.
 * They are fail-closed throws, never silent fallthroughs: an unimplemented
 * ending must be impossible to reach, not quietly relabelled as another one.
 */
export const CONDUCTOR_DEFERRED_RUN_END_REASONS: readonly ResolutionReason[] = Object.freeze([
  "READING_FAILED",
  "STABLE_INTERSECTION",
  "SEAM_CROSSED_UNCLAIMED",
  "RULE_INTERRUPTED_BY_SCAR",
  "ABSOLUTE_READER_INCOMPLETE",
]);

export type ConductorRestorePhase =
  | "material"
  | "ghost-replay-begin"
  | "ghost-replay-complete"
  | "ghost-residue"
  | "witness"
  | "input-return";

export interface ConductorRestoreStep {
  readonly phase: ConductorRestorePhase;
  readonly tick120: number;
}

export interface ConductorNarrativeLogEntry {
  readonly tick120: number;
  readonly state: string;
  readonly event: string;
  /** True when the authored narrative event also exists in event-schema-v4. */
  readonly canonical: boolean;
}

export interface ConductorWithheldEncounter {
  readonly tick120: number;
  readonly patternId: string;
  readonly encounterOrdinal: number;
  readonly reason: "pattern-not-conductor-admissible";
}

export interface ConductorEntryOmenFact {
  readonly tick120: number;
  readonly roomId: ConductorRoomId;
  readonly event: string;
  readonly distancePx: number;
  readonly audioLeadTicks120: number;
  readonly transitionRequestTick120: number;
}

export interface ConductorThresholdFact {
  readonly tick120: number;
  readonly roomId: ConductorRoomId;
  readonly thresholdId: string;
  readonly reaction: string;
  readonly edge: "enter" | "exit";
}

export interface ConductorTickInput {
  /** Normalized movement in [-1, 1]; the kernel integrates it, not presentation. */
  readonly movement: Vec2;
  readonly focused: boolean;
  /** Player-signalled flower intensity in [0, 1]. */
  readonly signalIntensity: number;
  /** KeyG / pad face-3 / two-finger hold, already debounced by the adapter. */
  readonly gazeIntent: boolean;
  readonly gazePitchDegrees: number;
  /** Reading directness in [0, 1]; the manifest calls it gaze.directness. */
  readonly gazeAlignment: number;
  readonly overridePressed?: boolean;
  readonly overrideReleased?: boolean;
  readonly overrideDirection?: Vec2;
  readonly snapshotContinueRequested?: boolean;
  readonly snapshotTitleRequested?: boolean;
}

export interface ConductorPlayerSnapshot {
  readonly position: Vec2;
  readonly focused: boolean;
  readonly damage: Readonly<{
    state: "alive" | "dead" | "respawning" | "run-ended";
    health: number;
    lives: number;
    collisionEnabled: boolean;
  }> | null;
  readonly evidence: number;
  readonly expression: number;
}

export interface ConductorLocalVoidSnapshot {
  readonly active: boolean;
  readonly direction: Vec2;
  readonly radius: number;
  readonly halfAngleDegrees: number;
  readonly closesAtTick120: number;
}

export interface ConductorHudBinds {
  readonly inputPolicy: NarrativeInputPolicy;
  readonly inputReturned: boolean;
  readonly flowerIntensity: number;
  readonly evidenceAvailable: number;
  readonly gazeTotalMs: number;
  readonly flowerForcedDimCount: number;
  readonly overrideEligible: boolean;
  readonly overrideActive: boolean;
  readonly distinctRoomsVisited: number;
  readonly runElapsedMs: number;
}

export interface ConductorWeatherPresentationFacts {
  readonly phase: WeatherSchedulerSnapshot["phase"];
  readonly classId: string | null;
  readonly biasView: WeatherSchedulerSnapshot["biasView"];
  readonly residues: WeatherSchedulerSnapshot["residues"];
  readonly witnessFacePlayerException: boolean;
  /** Structural proof that weather cannot write gameplay from this snapshot. */
  readonly authority: "weather-presentation";
}

/**
 * Frozen per-tick projection. The first block is a structural superset of the
 * PresentationSourceSnapshot interface that game/presentation.ts declared; the
 * rest is run/narrative context. Presentation reads this and never writes back
 * — there is no command port on this object.
 */
export interface ConductorSnapshot {
  readonly tick120: number;
  readonly relativeTick120: number;
  readonly patternId: string;
  readonly roomId: string;
  readonly difficulty: "EASY" | "NORMAL" | "HARD";
  readonly projectiles: readonly CombatProjectileSnapshot[];
  readonly combatEnabled: boolean;
  readonly targetVisible: boolean;
  readonly player: ConductorPlayerSnapshot;
  readonly gazeState: GazeAuthorityState;
  readonly gazeClampReleased: boolean;
  readonly localVoid: ConductorLocalVoidSnapshot | null;
  readonly roomThresholdTargetRoom?: string;

  readonly authority: "run-conductor";
  readonly runId: string;
  readonly runPhase: string;
  readonly inputPolicy: NarrativeInputPolicy;
  readonly runComplete: boolean;
  readonly visitedRooms: readonly ConductorRoomId[];
  readonly weather: ConductorWeatherPresentationFacts;
  readonly hud: ConductorHudBinds;
  readonly observations: readonly SelectedObservation[];
  readonly runEndReason: ResolutionReason | null;
  readonly restoreTimeline: readonly ConductorRestoreStep[];
  /** The restore phases that have actually fired, in the order they fired. */
  readonly restoreProgress: readonly ConductorRestoreStep[];
  readonly entryOmens: readonly ConductorEntryOmenFact[];
  readonly thresholdFacts: readonly ConductorThresholdFact[];
  readonly withheldEncounters: readonly ConductorWithheldEncounter[];
  readonly narrativeLog: readonly ConductorNarrativeLogEntry[];
}

export interface RunConductorOptions {
  readonly runId: string;
  /** uint32 raw run seed resolved by run-seed.ts at the browser boundary. */
  readonly rawRunSeed: number;
  /**
   * The previous run's archive record, loaded from CrossRunArchiveStore, or
   * null for a fresh null-route boot.
   */
  readonly previousRun?: FinalizedRunMemory | null;
  /** Destination for CROSS_RUN_MATERIALIZATION; omit to keep the run in memory. */
  readonly archive?: CrossRunArchiveStore | null;
  readonly roomCount?: V4QaRoomCount;
}

type MutableFacts = Record<string, GuardFactValue>;

interface ActiveOccurrence {
  readonly kernel: CanonicalCombatKernel;
  /**
   * Occurrence-local bus. CanonicalCombatKernel builds its player damage
   * authority with a fixed `player` identity whose collision-lease occurrence
   * keys restart at :000000 for every kernel, so two occurrences writing
   * straight onto one run bus collide on the second damage batch. Run-scoped
   * occurrence identity is the conductor's job, so each occurrence writes to
   * its own bus and the conductor mirrors every committed fact onto the run
   * bus under a run-unique occurrence key — same id, tick, entity, sequence
   * and payload, so the canonical trace and the same-tick phase order are
   * unchanged. (Cross-island note: a run-scoped player identity option on
   * CanonicalCombatKernel would remove this mirror entirely.)
   */
  readonly bus: CanonicalEventBus;
  readonly patternId: string;
  readonly startTick120: number;
  readonly encounterOrdinal: number;
  mirrorCursor: number;
}

interface ScheduledPlanEvent {
  readonly tick120: number;
  readonly event: V4QaScheduleEvent;
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireUint32(value: unknown, path: string): number {
  if (
    !Number.isSafeInteger(value)
    || (value as number) < 0
    || (value as number) > 0xffff_ffff
    || Object.is(value, -0)
  ) {
    throw new Error(`${path} must be a uint32`);
  }
  return (value as number) >>> 0;
}

function requireNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function requireRatio(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${path} must be a ratio in [0, 1]`);
  }
  return value;
}

function requireAxis(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < -1 || value > 1) {
    throw new Error(`${path} must be in [-1, 1]`);
  }
  return value;
}

function freezeVec2(value: Vec2): Vec2 {
  return Object.freeze({x: value.x, y: value.y});
}

/**
 * Derive the exact projectile pool-class map a pattern needs straight from the
 * executable-patterns manifest. V4 budgets pool classes but never maps
 * archetype IDs onto them, so the adapter reads the class out of the authored
 * `bullet.<class>.<name>` identity and fails closed on anything else.
 */
/** The authored occurrence the Eye first arrives through. */
export const FIRST_EYE_PATTERN_ID = "common.eye_acquisition" as const;

interface AuthoredPatternPlacement {
  readonly category: string;
  readonly room: string | null;
}

/**
 * Pattern category/room placement, read straight from the manifest. The
 * executable-pattern runtime type does not surface these fields, and a room
 * placement must never be inferred from the pattern id string.
 */
const AUTHORED_PATTERN_PLACEMENT: ReadonlyMap<string, AuthoredPatternPlacement> = (() => {
  const manifest = executablePatternsJson as unknown;
  if (!isRecordValue(manifest) || !Array.isArray(manifest.patterns)) {
    throw new Error("executable patterns manifest must author a patterns array");
  }
  const placements = new Map<string, AuthoredPatternPlacement>();
  for (const entry of manifest.patterns) {
    if (!isRecordValue(entry)) throw new Error("executable pattern entry must be an object");
    const id = requireNonEmptyString(entry.id, "executable pattern id");
    const category = requireNonEmptyString(entry.category, `executable pattern ${id}.category`);
    const room = entry.room === undefined || entry.room === null
      ? null
      : requireNonEmptyString(entry.room, `executable pattern ${id}.room`);
    placements.set(id, Object.freeze({category, room}));
  }
  if (placements.size === 0) throw new Error("executable patterns manifest is empty");
  return placements;
})();

/** Authored `seed.base` per pattern; the occurrence seed composition input. */
const AUTHORED_PATTERN_SEED_BASE: ReadonlyMap<string, number> = (() => {
  const manifest = executablePatternsJson as unknown;
  if (!isRecordValue(manifest) || !Array.isArray(manifest.patterns)) {
    throw new Error("executable patterns manifest must author a patterns array");
  }
  const bases = new Map<string, number>();
  for (const entry of manifest.patterns) {
    if (!isRecordValue(entry)) throw new Error("executable pattern entry must be an object");
    const id = requireNonEmptyString(entry.id, "executable pattern id");
    const seed = entry.seed;
    if (!isRecordValue(seed)) throw new Error(`executable pattern ${id} authors no seed block`);
    if (seed.algorithm !== "mulberry32-v1") {
      throw new Error(`executable pattern ${id} does not author the mulberry32 stream`);
    }
    bases.set(id, requireUint32(seed.base, `executable pattern ${id}.seed.base`));
  }
  return bases;
})();

function projectilePoolClassesFor(patternId: string): Readonly<Record<string, ProjectilePoolClass>> {
  const pattern = executablePattern(patternId);
  const classes: Record<string, ProjectilePoolClass> = {};
  for (const emitter of pattern.emitters) {
    const archetypeId = emitter.projectile.archetype;
    const segments = archetypeId.split(".");
    const poolClass = segments[1];
    if (
      segments.length !== 3
      || segments[0] !== "bullet"
      || (poolClass !== "micro" && poolClass !== "medium" && poolClass !== "heavy")
    ) {
      throw new Error(`projectile archetype has no derivable pool class: ${archetypeId}`);
    }
    classes[archetypeId] = poolClass;
  }
  if (Object.keys(classes).length === 0) {
    throw new Error(`pattern authors no projectile archetypes: ${patternId}`);
  }
  return Object.freeze(classes);
}

/**
 * Behaviour carried from the previous run into this run's composition. Only
 * metrics with an exact authored counterpart cross the boundary; the rest stay
 * zero rather than being inferred from a differently-shaped ledger dimension.
 * (Widening this map is P1 work and is deliberately not guessed here.)
 */
function composerMetricsFrom(previousRun: FinalizedRunMemory | null) {
  const value = Object.fromEntries(
    V4_RUN_COMPOSER_METRIC_IDS.map((id) => [id, 0]),
  ) as Record<V4RunComposerMetricId, number>;
  if (previousRun !== null) {
    value.avgFlower = previousRun.metrics.meanLight;
    value.gazeRatio = previousRun.metrics.gazeRatio;
    value.highLightRatio = previousRun.metrics.loudLightRatio;
  }
  return validateV4RunComposerMetrics(value);
}

/**
 * The facts blackboard's complete name registry. Every guard in the manifest
 * must resolve against this set at construction; a manifest naming anything
 * else is a construction error, never a silent false at runtime.
 */
export const CONDUCTOR_NARRATIVE_FACT_NAMES: ReadonlySet<string> = new Set([
  "memory.rehydrationSettled",
  "memory.commitVerified",
  "ghost.replayComplete",
  "previousRun.ghostRoute",
  "witness.orientationCommitted",
  "run.elapsedMs",
  "player.meaningfulInputCount",
  "gaze.pitchDeg",
  "gaze.directness",
  "gaze.eventCount",
  "gaze.clampReleased",
  "gaze.totalMs",
  "flower.recoveryComplete",
  "flower.forcedDimCount",
  "evidence.available",
  "room.id",
  "room.distinctVisited",
  "override.eligibility",
  "override.activated",
  "localVoid.active",
  "runEnd.eligible",
  "dusk.omenComplete",
  "noDusk.protocolRetracted",
  "noDusk.witnessWindowComplete",
  "snapshot.continueRequested",
  "snapshot.titleRequested",
  "nextRun.queueVerified",
]);

/** Authored dusk omen length; the FSM only asks whether the omen completed. */
const DUSK_OMEN_TICKS120 = crossedTickCount(2400);
/** Authored no-dusk witness window before the run may commit its end. */
const NO_DUSK_WITNESS_WINDOW_TICKS120 = crossedTickCount(3000);
/** Snapshot presentation completes on the authored schedule; see snapshot.ts. */
const SNAPSHOT_COMPLETE_TICKS120 = crossedTickCount(1500);

export class RunConductor {
  readonly runId: string;
  readonly rawRunSeed: number;
  readonly machine: ParsedNarrativeStateMachine;
  readonly plan: V4RunComposerPlan;

  readonly #bus: CanonicalEventBus;
  readonly #metrics: RunMetricsCollector;
  readonly #gaze: GazeAuthority;
  readonly #flower: FlowerIntensityAuthority;
  readonly #weather: WeatherScheduler;
  readonly #roomTransition: RoomTransitionAuthority;
  readonly #snapshotAuthority: SnapshotAuthority;
  readonly #archive: CrossRunArchiveStore | null;
  readonly #previousRun: FinalizedRunMemory | null;

  readonly #facts: MutableFacts = Object.create(null) as MutableFacts;
  readonly #narrativeLog: ConductorNarrativeLogEntry[] = [];
  readonly #entryOmens: ConductorEntryOmenFact[] = [];
  readonly #thresholdFacts: ConductorThresholdFact[] = [];
  readonly #withheldEncounters: ConductorWithheldEncounter[] = [];
  readonly #restoreTimeline: readonly ConductorRestoreStep[];
  readonly #restoreProgress: ConductorRestoreStep[] = [];
  readonly #planEvents: readonly ScheduledPlanEvent[];
  readonly #visitedRooms: ConductorRoomId[] = [];

  #tick120 = -1;
  #stateId: string;
  #stateEnteredTick120 = 0;
  #started = false;
  #complete = false;

  #thresholdWatcher: RoomThresholdWatcher;
  #occurrence: ActiveOccurrence | null = null;
  #lastPatternId: string;
  #lastDifficulty: "EASY" | "NORMAL" | "HARD" = "NORMAL";
  #encounterOrdinal = -1;
  #nextPlanEventIndex = 0;
  /** ROOM_SAMPLING anchors the composer plan clock; -1 until it is entered. */
  #planAnchorTick120 = -1;
  #playerPosition: Vec2 = Object.freeze({x: LOGICAL_VIEW_WIDTH / 2, y: LOGICAL_VIEW_HEIGHT * 0.82});
  #combatSpawningStopped = false;
  #firstEyeOccurrenceStarted = false;

  #flowerIntensity = 0;
  #flowerForcedDimCount = 0;
  #flowerClampWasActive = false;
  #flowerRecoveryDueTick120: number | null = null;
  #gazeClampTicks = 0;
  #meaningfulInputActive = false;
  #evidenceAvailable = 0;

  #lastCombatSnapshot: CanonicalCombatSnapshot | null = null;
  #duskOmenStartTick120: number | null = null;
  #noDuskStartTick120: number | null = null;
  #runEndReason: ResolutionReason | null = null;
  #runEndCommitTick120: number | null = null;
  #finalizedRecord: FinalizedRunMemory | null = null;
  #observations: readonly SelectedObservation[] = Object.freeze([]);
  #snapshotStartedTick120: number | null = null;

  constructor(options: RunConductorOptions) {
    if (!isRecordValue(options)) throw new Error("run conductor options must be an object");
    this.runId = requireNonEmptyString(options.runId, "run conductor runId");
    this.rawRunSeed = requireUint32(options.rawRunSeed, "run conductor rawRunSeed");
    const previousRun = options.previousRun ?? null;
    if (previousRun !== null) {
      // A rehydrated archive record must still be a schema-valid run memory.
      assertRunMemory(previousRun as unknown);
    }
    this.#previousRun = previousRun;
    this.#archive = options.archive ?? null;

    // Fail closed at construction: unknown guard fact names throw here.
    this.machine = parseNarrativeStateMachine(narrativeStateMachineJson, CONDUCTOR_NARRATIVE_FACT_NAMES);
    this.#stateId = this.machine.initialState;

    this.plan = composeV4RunComposerPlan({
      rawRunSeed: this.rawRunSeed,
      metrics: composerMetricsFrom(previousRun),
      ...(options.roomCount === undefined ? {} : {roomCount: options.roomCount}),
    });
    const bootRoom = this.#resolveBootRoom();

    this.#bus = new CanonicalEventBus();
    this.#gaze = new GazeAuthority(this.#bus);
    this.#flower = new FlowerIntensityAuthority(this.#bus);
    this.#weather = new WeatherScheduler(this.#bus, this.rawRunSeed);
    this.#roomTransition = new RoomTransitionAuthority(this.#bus, bootRoom);
    this.#snapshotAuthority = new SnapshotAuthority(this.#bus);
    this.#metrics = new RunMetricsCollector({
      runId: this.runId,
      seed: this.rawRunSeed,
      startedAtTick: 0,
      initialRoom: bootRoom,
      bus: this.#bus,
    });
    this.#thresholdWatcher = new RoomThresholdWatcher(bootRoom);
    this.#visitedRooms.push(bootRoom);
    this.#lastPatternId = this.#firstAdmittedPlanPatternId();
    this.#planEvents = this.#compilePlanEvents();
    this.#restoreTimeline = this.#compileRestoreTimeline();
    this.#seedFacts();
  }

  /** Read-only access to the run's single canonical event bus. */
  get bus(): CanonicalEventBus {
    return this.#bus;
  }

  get tick120(): number {
    return this.#tick120;
  }

  get runPhase(): string {
    return this.#stateId;
  }

  get complete(): boolean {
    return this.#complete;
  }

  /** Canonical trace serialization; identical inputs produce identical text. */
  canonicalTrace(): string {
    return serializeCanonicalEvents(this.#bus.events() as readonly CanonicalGameplayEvent[]);
  }

  /** The finalized cross-run record, available from RUN_END_COMMIT onward. */
  finalizedRecord(): FinalizedRunMemory | null {
    return this.#finalizedRecord;
  }

  /**
   * Advance exactly one authoritative tick120. The caller owns the clock and
   * never delivers paused ticks; wall time is discarded upstream.
   */
  step(input: ConductorTickInput): void {
    if (this.#complete) throw new Error("run conductor is complete and cannot step");
    if (!isRecordValue(input)) throw new Error("conductor tick input must be an object");
    const tick120 = this.#tick120 + 1;
    this.#tick120 = tick120;

    const state = this.#requireState(this.#stateId);
    const gated = this.#gateInput(input, state.inputPolicy);

    if (!this.#started) {
      this.#started = true;
      this.#weather.enterRoom(this.#currentRoom(), 0, tick120);
      this.#emitStateEvents(this.machine.initialState, this.#requireState(this.machine.initialState).enterEvents);
    }

    this.#advanceRestoreTimeline(tick120);
    this.#advanceGaze(gated, tick120);
    this.#advanceFlower(gated, tick120);
    this.#weather.advanceTo(tick120);
    this.#roomTransition.advance(tick120);
    this.#observeRoomChange(tick120);
    this.#advanceFirstEyeOccurrence(tick120);
    this.#advancePlan(tick120);
    this.#advanceCombat(gated, tick120);
    this.#advanceRunEndPhases(tick120);
    this.#enqueueRunEndCommit(tick120);
    this.#advanceSnapshotAuthority(tick120);

    // Exactly one canonical close per tick: the occurrence bus first (so its
    // facts can be mirrored under run-scoped identity), then the run bus.
    this.#flushOccurrence(tick120);
    this.#bus.flush();

    // The record is closed once the run end is committed; the collector stops
    // observing rather than accumulating post-commit facts into a sealed run.
    if (this.#finalizedRecord === null) {
      this.#metrics.drainCanonicalEvents();
      this.#observeMetrics(gated, tick120);
    }
    this.#lastFocused = gated.focused;
    this.#observeThresholds(gated, tick120);
    this.#finalizeRunMemoryIfDue(tick120);
    this.#updateFacts(gated, tick120);
    this.#advanceNarrative(tick120);
  }

  snapshot(): ConductorSnapshot {
    const combat = this.#lastCombatSnapshot;
    const transition = this.#roomTransition.snapshot();
    const weather = this.#weather.snapshot();
    const localVoid = combat?.override.localVoid ?? null;
    const state = this.#requireState(this.#stateId);
    return Object.freeze({
      tick120: Math.max(0, this.#tick120),
      relativeTick120: this.#occurrence === null || combat === null ? 0 : combat.relativeTick120,
      patternId: this.#occurrence?.patternId ?? this.#lastPatternId,
      roomId: transition.currentRoom,
      difficulty: this.#lastDifficulty,
      projectiles: this.#occurrence === null
        ? Object.freeze([] as CombatProjectileSnapshot[])
        : combat?.projectiles ?? Object.freeze([] as CombatProjectileSnapshot[]),
      combatEnabled: this.#occurrence !== null,
      targetVisible: this.#occurrence !== null,
      player: Object.freeze({
        position: freezeVec2(this.#playerPosition),
        focused: combat?.player.state === "alive" && this.#lastFocused,
        damage: combat === null ? null : Object.freeze({
          state: combat.player.state,
          health: combat.player.health,
          lives: combat.player.lives,
          collisionEnabled: combat.player.collisionEnabled,
        }),
        evidence: this.#evidenceAvailable,
        expression: this.#flowerIntensity,
      }),
      gazeState: this.#gaze.snapshot().state,
      gazeClampReleased: this.#facts["gaze.clampReleased"] === true,
      localVoid: localVoid === null ? null : Object.freeze({
        active: true,
        direction: freezeVec2(localVoid.direction),
        radius: localVoid.radius,
        halfAngleDegrees: localVoid.halfAngleDegrees,
        closesAtTick120: localVoid.closesAtTick120,
      }),
      ...(transition.targetRoom === null ? {} : {roomThresholdTargetRoom: transition.targetRoom}),

      authority: "run-conductor" as const,
      runId: this.runId,
      runPhase: this.#stateId,
      inputPolicy: state.inputPolicy,
      runComplete: this.#complete,
      visitedRooms: Object.freeze([...this.#visitedRooms]),
      weather: Object.freeze({
        phase: weather.phase,
        classId: weather.classId,
        biasView: weather.biasView,
        residues: weather.residues,
        witnessFacePlayerException: weather.witnessFacePlayerException,
        authority: "weather-presentation" as const,
      }),
      hud: Object.freeze({
        inputPolicy: state.inputPolicy,
        inputReturned: state.inputPolicy !== "held",
        flowerIntensity: this.#flowerIntensity,
        evidenceAvailable: this.#evidenceAvailable,
        gazeTotalMs: this.#gazeTotalMs(),
        flowerForcedDimCount: this.#flowerForcedDimCount,
        overrideEligible: this.#facts["override.eligibility"] === true,
        overrideActive: localVoid !== null,
        distinctRoomsVisited: this.#visitedRooms.length,
        runElapsedMs: this.#elapsedMs(),
      }),
      observations: this.#observations,
      runEndReason: this.#runEndReason,
      restoreTimeline: this.#restoreTimeline,
      restoreProgress: Object.freeze([...this.#restoreProgress]),
      entryOmens: Object.freeze([...this.#entryOmens]),
      thresholdFacts: Object.freeze([...this.#thresholdFacts]),
      withheldEncounters: Object.freeze([...this.#withheldEncounters]),
      narrativeLog: Object.freeze([...this.#narrativeLog]),
    });
  }

  // ---------------------------------------------------------------- boot ---

  #resolveBootRoom(): ConductorRoomId {
    const first = this.plan.qa.rooms[0];
    const roomId = requireNonEmptyString(first, "composer plan first room");
    if (!CONDUCTOR_ROOM_IDS.includes(roomId as ConductorRoomId)) {
      throw new Error(`composer plan room is not authored: ${roomId}`);
    }
    return roomId as ConductorRoomId;
  }

  #firstAdmittedPlanPatternId(): string {
    for (const event of this.plan.qa.schedule) {
      if (event.event !== "encounter.begin" || event.patternId === undefined) continue;
      if (isAdmittedPattern(event.patternId)) return event.patternId;
    }
    throw new Error("composer plan contains no conductor-admissible encounter");
  }

  /**
   * Project the composer plan's millisecond schedule onto the integer tick
   * grid once, at construction. Every atMs becomes a due tick by round-up, so
   * the plan can never drift against the authoritative clock.
   */
  #compilePlanEvents(): readonly ScheduledPlanEvent[] {
    const events: ScheduledPlanEvent[] = [];
    for (const event of this.plan.qa.schedule) {
      if (!Number.isSafeInteger(event.atMs) || event.atMs < 0) {
        throw new Error("composer plan schedule must use non-negative integer milliseconds");
      }
      events.push(Object.freeze({tick120: crossedTickCount(event.atMs), event}));
    }
    return Object.freeze(events);
  }

  /**
   * The authoritative cross-run restore order, on the tick grid:
   * material 0ms → ghost replay +420 → ghost complete routeDuration+420 →
   * residue +421 → witness +700 → input return +1140.
   *
   * The full canonical cross-run event envelope belongs to
   * CrossRunRestoreAuthority, which requires a recorder-issued provenance
   * token. A record rehydrated from the durable archive cannot carry that
   * token (the provenance lives in a process-local WeakMap), so this slice
   * drives the same schedule as narrative-layer restore facts and emits no
   * fabricated cross-run envelope. Same-process token handoff is S3 work.
   */
  #compileRestoreTimeline(): readonly ConductorRestoreStep[] {
    if (this.#previousRun === null) return Object.freeze([] as ConductorRestoreStep[]);
    const route = this.#previousRun.ghostRoute;
    // The route's duration is its last sampled point; GhostRoute stores the
    // sampled timeline, never a separately-authored duration to drift from.
    const routeDurationMs = route === null
      ? 0
      : route.points[route.points.length - 1]?.tMs ?? 0;
    const timing = deriveCrossRunRestoreTiming(routeDurationMs);
    if (
      timing.ghostReplayBeginAtMs !== CROSS_RUN_RESTORE_OFFSETS.ghostReplayBeginAtMs
      || timing.inputReturnAtMs !== routeDurationMs + CROSS_RUN_RESTORE_OFFSETS.inputReturnOffsetMs
    ) {
      throw new Error("cross-run restore timing drifted from the authored offsets");
    }
    const steps: ConductorRestoreStep[] = [
      {phase: "material", tick120: crossedTickCount(timing.materialRehydrateAtMs)},
    ];
    if (route !== null) {
      steps.push({phase: "ghost-replay-begin", tick120: crossedTickCount(timing.ghostReplayBeginAtMs)});
      steps.push({phase: "ghost-replay-complete", tick120: crossedTickCount(timing.ghostReplayCompleteAtMs)});
      steps.push({phase: "ghost-residue", tick120: crossedTickCount(timing.ghostResidueWriteAtMs)});
    }
    steps.push({phase: "witness", tick120: crossedTickCount(timing.witnessTurnAtMs)});
    steps.push({phase: "input-return", tick120: crossedTickCount(timing.inputReturnAtMs)});
    for (let index = 1; index < steps.length; index += 1) {
      const previous = steps[index - 1];
      const current = steps[index];
      if (previous === undefined || current === undefined) throw new Error("restore timeline lost a step");
      if (current.tick120 < previous.tick120) {
        throw new Error("cross-run restore timeline is not monotonic on the tick grid");
      }
    }
    return Object.freeze(steps.map((step) => Object.freeze(step)));
  }

  #seedFacts(): void {
    const facts = this.#facts;
    const hasPrevious = this.#previousRun !== null;
    const route = this.#previousRun?.ghostRoute ?? null;
    // A null archive is a null route: nothing to rehydrate, replay or orient.
    facts["memory.rehydrationSettled"] = !hasPrevious;
    facts["ghost.replayComplete"] = route === null;
    facts["previousRun.ghostRoute"] = route === null ? null : route.routeDigest;
    facts["witness.orientationCommitted"] = !hasPrevious;
    facts["memory.commitVerified"] = false;
    facts["run.elapsedMs"] = 0;
    facts["player.meaningfulInputCount"] = 0;
    facts["gaze.pitchDeg"] = 0;
    facts["gaze.directness"] = 0;
    facts["gaze.eventCount"] = 0;
    facts["gaze.clampReleased"] = false;
    facts["gaze.totalMs"] = 0;
    facts["flower.recoveryComplete"] = false;
    facts["flower.forcedDimCount"] = 0;
    facts["evidence.available"] = 0;
    facts["room.id"] = this.#currentRoom();
    facts["room.distinctVisited"] = 1;
    facts["override.eligibility"] = false;
    facts["override.activated"] = false;
    facts["localVoid.active"] = false;
    facts["runEnd.eligible"] = false;
    facts["dusk.omenComplete"] = false;
    facts["noDusk.protocolRetracted"] = false;
    facts["noDusk.witnessWindowComplete"] = false;
    facts["snapshot.continueRequested"] = false;
    facts["snapshot.titleRequested"] = false;
    facts["nextRun.queueVerified"] = false;
  }

  // ---------------------------------------------------------------- tick ---

  #lastFocused = false;

  /**
   * The narrative state's input policy decides which raw facts are allowed to
   * become gameplay at all. "held" is a real hold: not a disabled renderer, an
   * absent input surface.
   */
  #gateInput(input: ConductorTickInput, policy: NarrativeInputPolicy): ConductorTickInput {
    const movement = isRecordValue(input.movement)
      ? Object.freeze({
          x: requireAxis(input.movement.x, "conductor input movement.x"),
          y: requireAxis(input.movement.y, "conductor input movement.y"),
        })
      : (() => {
          throw new Error("conductor input movement must be a vector");
        })();
    const signalIntensity = requireRatio(input.signalIntensity, "conductor input signalIntensity");
    const held = Object.freeze({
      movement: Object.freeze({x: 0, y: 0}),
      focused: false,
      signalIntensity: 0,
      gazeIntent: false,
      gazePitchDegrees: 0,
      gazeAlignment: 0,
      snapshotContinueRequested: false,
      snapshotTitleRequested: false,
    });
    switch (policy) {
      case "held":
        return held;
      case "snapshot-navigation":
        return Object.freeze({
          ...held,
          snapshotContinueRequested: input.snapshotContinueRequested === true,
          snapshotTitleRequested: input.snapshotTitleRequested === true,
        });
      case "movement-and-signal":
        return Object.freeze({
          ...held,
          movement,
          focused: input.focused === true,
          signalIntensity,
        });
      case "full":
        return Object.freeze({
          movement,
          focused: input.focused === true,
          signalIntensity,
          gazeIntent: input.gazeIntent === true,
          gazePitchDegrees: typeof input.gazePitchDegrees === "number"
            && Number.isFinite(input.gazePitchDegrees)
            ? input.gazePitchDegrees
            : 0,
          gazeAlignment: requireRatio(input.gazeAlignment, "conductor input gazeAlignment"),
          ...(input.overridePressed === undefined ? {} : {overridePressed: input.overridePressed}),
          ...(input.overrideReleased === undefined ? {} : {overrideReleased: input.overrideReleased}),
          ...(input.overrideDirection === undefined ? {} : {overrideDirection: input.overrideDirection}),
          snapshotContinueRequested: false,
          snapshotTitleRequested: false,
        });
      default: {
        const exhaustive: never = policy;
        throw new Error(`unsupported narrative input policy: ${String(exhaustive)}`);
      }
    }
  }

  /**
   * Walk the scheduled restore phases and record each one as it actually
   * fires. `restoreProgress` is the observed timeline; `restoreTimeline` is the
   * schedule it must match tick for tick. Ghost replay is evidence, never a
   * collider — it opens no gameplay fact beyond "the replay finished".
   */
  #advanceRestoreTimeline(tick120: number): void {
    for (const step of this.#restoreTimeline) {
      if (step.tick120 !== tick120) continue;
      this.#restoreProgress.push(step);
      switch (step.phase) {
        case "material":
          this.#facts["memory.rehydrationSettled"] = true;
          break;
        case "ghost-replay-begin":
        case "ghost-residue":
        case "witness":
          break;
        case "ghost-replay-complete":
          this.#facts["ghost.replayComplete"] = true;
          break;
        case "input-return":
          // Witness orientation is committed exactly when input returns; the
          // authored order is scars -> ghost -> witnesses -> input.
          this.#facts["witness.orientationCommitted"] = true;
          break;
        default: {
          const exhaustive: never = step.phase;
          throw new Error(`unsupported restore phase: ${String(exhaustive)}`);
        }
      }
    }
  }

  #advanceGaze(input: ConductorTickInput, tick120: number): void {
    const skyEyeVisible = input.gazeIntent;
    this.#gaze.observe(
      {
        skyEyeVisible,
        pitchDegrees: skyEyeVisible ? input.gazePitchDegrees : 0,
        alignment: skyEyeVisible ? input.gazeAlignment : 0,
      },
      tick120,
    );
    const gaze = this.#gaze.snapshot();
    if (gaze.clampActive) this.#gazeClampTicks += 1;
    // EXT-004: the first lesson is bodily. Once the Eye has let go — the gaze
    // machine is idle again — the flower still needs 30 ticks to come back.
    // The anchor is armed only inside FIRST_CLAMP_RECOVERY, on the release
    // edge, and never re-armed by later gaze cycles.
    if (this.#stateId !== "FIRST_CLAMP_RECOVERY") return;
    if (gaze.state !== "idle") return;
    if (this.#flowerRecoveryDueTick120 !== null) return;
    this.#facts["gaze.clampReleased"] = true;
    this.#flowerRecoveryDueTick120 = tick120 + FLOWER_RECOVERY_ANCHOR_TICKS120;
  }

  #advanceFlower(input: ConductorTickInput, tick120: number): void {
    const gaze = this.#gaze.snapshot();
    if (gaze.clampActive && !this.#flowerClampWasActive) this.#flowerForcedDimCount += 1;
    if (gaze.clampActive) this.#flowerClampWasActive = true;
    const overrideActive = this.#lastCombatSnapshot?.override.localVoid !== null
      && this.#lastCombatSnapshot !== null;
    const resolution = this.#flower.resolve(
      {
        signalIntensity: input.signalIntensity,
        focusActive: input.focused,
        gazeClampActive: gaze.clampActive,
        overrideActive,
      },
      tick120,
    );
    this.#flowerIntensity = resolution.targetIntensity;
    if (
      this.#flowerRecoveryDueTick120 !== null
      && tick120 >= this.#flowerRecoveryDueTick120
    ) {
      this.#facts["flower.recoveryComplete"] = true;
    }
  }

  /** Consume every composer-plan event whose due tick has arrived. */
  #advancePlan(tick120: number): void {
    if (this.#planAnchorTick120 < 0) return;
    const relative = tick120 - this.#planAnchorTick120;
    while (this.#nextPlanEventIndex < this.#planEvents.length) {
      const scheduled = this.#planEvents[this.#nextPlanEventIndex];
      if (scheduled === undefined) throw new Error("composer plan lost a scheduled event");
      if (scheduled.tick120 > relative) break;
      this.#nextPlanEventIndex += 1;
      this.#consumePlanEvent(scheduled.event, tick120);
    }
    this.#emitDuePlanOmens(relative, tick120);
  }

  /**
   * The authored entry omen leads the room-transition request by the room's
   * own audioLeadMs, carrying the manifest's approach distance forward for
   * presentation. (The spatial `distancePx` gate itself needs world geometry
   * the authority layer does not own yet; the authored value is preserved, not
   * approximated.)
   */
  #emitDuePlanOmens(relativeTick120: number, tick120: number): void {
    for (const scheduled of this.#planEvents) {
      if (scheduled.event.event !== "room.enter") continue;
      if ((scheduled.event.roomOrdinal ?? 0) === 0) continue;
      const roomId = scheduled.event.room;
      if (roomId === undefined || !CONDUCTOR_ROOM_IDS.includes(roomId as ConductorRoomId)) continue;
      const watcher = new RoomThresholdWatcher(roomId);
      const omenTick = scheduled.tick120 - watcher.entryOmen.audioLeadTicks120;
      if (omenTick !== relativeTick120) continue;
      if (this.#entryOmens.some((fact) => fact.roomId === roomId && fact.event === watcher.entryOmen.event)) {
        continue;
      }
      this.#entryOmens.push(Object.freeze({
        tick120,
        roomId: roomId as ConductorRoomId,
        event: watcher.entryOmen.event,
        distancePx: watcher.entryOmen.distancePx,
        audioLeadTicks120: watcher.entryOmen.audioLeadTicks120,
        transitionRequestTick120: this.#planAnchorTick120 + scheduled.tick120,
      }));
    }
  }

  /**
   * FIRST_EYE is where authority becomes spatially unavoidable: the authored
   * `common.eye_acquisition` occurrence runs through the real combat kernel,
   * not a scripted cutscene. It takes global encounter ordinal 0, so the
   * composer's room encounters continue the same global sequence.
   */
  #advanceFirstEyeOccurrence(tick120: number): void {
    if (this.#firstEyeOccurrenceStarted) return;
    if (this.#stateId !== "FIRST_EYE") return;
    if (this.#occurrence !== null) return;
    this.#firstEyeOccurrenceStarted = true;
    const patternId = FIRST_EYE_PATTERN_ID;
    const seedBase = AUTHORED_PATTERN_SEED_BASE.get(patternId);
    if (seedBase === undefined) throw new Error(`pattern authors no seed base: ${patternId}`);
    this.#beginOccurrence(
      {
        atMs: 0,
        event: "encounter.begin",
        patternId,
        difficulty: "EASY",
        encounterOrdinal: 0,
        // Occurrence seed policy (run-director-v4): runSeed xor pattern base
        // xor encounter ordinal. The eye occurrence is ordinal 0.
        seed: (this.rawRunSeed ^ seedBase ^ 0) >>> 0,
      },
      tick120,
    );
  }

  #consumePlanEvent(event: V4QaScheduleEvent, tick120: number): void {
    switch (event.event) {
      case "room.enter": {
        const roomId = event.room;
        if (roomId === undefined || !CONDUCTOR_ROOM_IDS.includes(roomId as ConductorRoomId)) {
          throw new Error(`composer plan entered an unauthored room: ${String(roomId)}`);
        }
        if ((event.roomOrdinal ?? 0) === 0) return;
        this.#requestRoomTransition(roomId as ConductorRoomId, tick120);
        return;
      }
      case "encounter.begin": {
        this.#beginOccurrence(event, tick120);
        return;
      }
      default:
        // material.settle / room.withdraw / transition.* / boss.* are material
        // and boss-loop facts this slice does not drive. They are recorded by
        // the plan, not silently reinterpreted here.
        return;
    }
  }

  /**
   * The destination room becomes collision-authoritative only at the atomic
   * world-swap commit (room-thresholds transitionContract), so the conductor
   * never runs an occurrence across the swap and never reads a midpoint room.
   */
  #requestRoomTransition(roomId: ConductorRoomId, tick120: number): void {
    if (!AUTHORED_TRANSITION_CONTRACT.noMidpointAmbiguity) {
      throw new Error("room transition contract permits midpoint collision ambiguity");
    }
    if (this.#roomTransition.snapshot().currentRoom === roomId) return;
    if (this.#roomTransition.snapshot().state !== "idle") return;
    // Collision authority may not be ambiguous across a swap: end the running
    // occurrence before the destination room becomes authoritative.
    this.#occurrence = null;
    this.#roomTransition.request(roomId, tick120);
  }

  #beginOccurrence(event: V4QaScheduleEvent, tick120: number): void {
    const patternId = event.patternId;
    if (patternId === undefined) throw new Error("composer encounter is missing its pattern id");
    this.#encounterOrdinal += 1;
    if (this.#combatSpawningStopped) return;
    if (this.#roomTransition.snapshot().state !== "idle") return;
    if (!isAdmittedPattern(patternId)) {
      // Known but not conductor-admissible (isolated kernel slices and boss
      // phases beyond phase 1). Withheld visibly, never silently swapped.
      this.#withheldEncounters.push(Object.freeze({
        tick120,
        patternId,
        encounterOrdinal: this.#encounterOrdinal,
        reason: "pattern-not-conductor-admissible" as const,
      }));
      return;
    }
    if (patternId.startsWith("boss.")) {
      this.#withheldEncounters.push(Object.freeze({
        tick120,
        patternId,
        encounterOrdinal: this.#encounterOrdinal,
        reason: "pattern-not-conductor-admissible" as const,
      }));
      return;
    }
    const seed = event.seed;
    if (seed === undefined) throw new Error("composer encounter is missing its manifest seed");
    const difficulty = event.difficulty;
    if (difficulty !== "EASY" && difficulty !== "NORMAL" && difficulty !== "HARD") {
      throw new Error(`composer encounter difficulty is not authored: ${String(difficulty)}`);
    }
    const roomId = this.#currentRoom();
    const placement = AUTHORED_PATTERN_PLACEMENT.get(patternId);
    if (placement === undefined) {
      throw new Error(`executable pattern placement is not authored: ${patternId}`);
    }
    // COMMON / WEATHER_ECHO / TRANSITION patterns are room-agnostic; a
    // room-scoped pattern must match the room that is currently authoritative.
    if (
      placement.category !== "COMMON"
      && placement.category !== "WEATHER_ECHO"
      && placement.category !== "TRANSITION"
      && placement.room !== roomId
    ) {
      return;
    }
    this.#lastDifficulty = difficulty;
    this.#lastPatternId = patternId;
    const occurrenceBus = new CanonicalEventBus();
    this.#occurrence = {
      kernel: new CanonicalCombatKernel(
        {
          patternId,
          occurrenceId: `${this.runId}:occurrence:${this.#encounterOrdinal}`,
          // One Mulberry32 stream per occurrence, seeded by the composer's
          // manifest-derived encounter seed (runSeed ^ base ^ ordinals).
          seed: requireUint32(seed, "composer encounter seed"),
          startTick120: tick120,
          roomId,
          difficulty,
          initialPlayerPosition: freezeVec2(this.#playerPosition),
          grazeRadiusPx: COMBAT_GRAZE_RADIUS_PX,
          projectileDamage: COMBAT_PROJECTILE_DAMAGE,
          projectilePoolClasses: projectilePoolClassesFor(patternId),
        },
        occurrenceBus,
      ),
      bus: occurrenceBus,
      patternId,
      startTick120: tick120,
      encounterOrdinal: this.#encounterOrdinal,
      mirrorCursor: 0,
    };
    this.#lastCombatSnapshot = this.#occurrence.kernel.snapshot();
  }

  #advanceCombat(input: ConductorTickInput, tick120: number): void {
    const occurrence = this.#occurrence;
    if (occurrence === null) return;
    if (occurrence.startTick120 === tick120) return;
    const snapshot = occurrence.kernel.advanceTick({
      tick120,
      movement: input.movement,
      focused: input.focused,
      ...(input.overridePressed === undefined ? {} : {overridePressed: input.overridePressed}),
      ...(input.overrideReleased === undefined ? {} : {overrideReleased: input.overrideReleased}),
      ...(input.overrideDirection === undefined ? {} : {overrideDirection: input.overrideDirection}),
    });
    this.#lastCombatSnapshot = snapshot;
    this.#playerPosition = freezeVec2(snapshot.playerPosition);
    this.#evidenceAvailable = snapshot.evidence.amount;
    this.#facts["localVoid.active"] = snapshot.override.localVoid !== null;
    if (snapshot.override.localVoid !== null) this.#facts["override.activated"] = true;
    // BODY_COLLAPSE is a committed fact from the damage authority, never a
    // numeric threshold: lives exhausted is the only source in this slice.
    if (snapshot.player.state === "run-ended" && this.#runEndReason === null) {
      this.#commitRunEndReason("BODY_COLLAPSE");
    }
  }

  #advanceRunEndPhases(tick120: number): void {
    if (this.#stateId === "DUSK_APPROACH") {
      if (this.#duskOmenStartTick120 === null) this.#duskOmenStartTick120 = tick120;
      if (tick120 - this.#duskOmenStartTick120 >= DUSK_OMEN_TICKS120) {
        this.#facts["dusk.omenComplete"] = true;
      }
    }
    if (this.#stateId === "NO_DUSK") {
      if (this.#noDuskStartTick120 === null) this.#noDuskStartTick120 = tick120;
      if (tick120 - this.#noDuskStartTick120 >= NO_DUSK_WITNESS_WINDOW_TICKS120) {
        this.#facts["noDusk.witnessWindowComplete"] = true;
      }
    }
  }

  /**
   * The run-end fact is committed on the tick after RUN_END_COMMIT is entered,
   * because the state's own enter happens after this tick's canonical close.
   * The record is then finalized from the committed trace, not from a
   * prediction of it.
   */
  #enqueueRunEndCommit(tick120: number): void {
    if (this.#runEndCommitTick120 !== tick120) return;
    const reason = this.#runEndReason;
    if (reason === null) throw new Error("run end commit reached without a committed reason");
    this.#bus.enqueue({
      id: "run.end.commit",
      tick120,
      entityStableId: `run:${this.runId}`,
      localSequence: 0,
      occurrenceKey: `run:${this.runId}:end`,
      payload: {reason},
    });
  }

  #finalizeRunMemoryIfDue(tick120: number): void {
    if (this.#runEndCommitTick120 !== tick120) return;
    const reason = this.#runEndReason;
    if (reason === null) throw new Error("run end finalize reached without a committed reason");
    this.#finalizedRecord = this.#metrics.finalize({
      endedAtTick: tick120,
      resolution: Object.freeze({reason, bossId: null, factEventId: `run:${this.runId}:end`}),
    });
    this.#facts["memory.commitVerified"] = true;
  }

  #advanceSnapshotAuthority(tick120: number): void {
    const startTick120 = this.#snapshotStartedTick120;
    if (startTick120 === null || tick120 < startTick120) return;
    if (tick120 === startTick120) {
      const record = this.#finalizedRecord;
      if (record === null) throw new Error("state snapshot requires a committed run memory");
      this.#snapshotAuthority.begin(captureRecorderIssuedRunMemory(record), startTick120);
      return;
    }
    this.#snapshotAuthority.advance(tick120);
  }

  /**
   * Close the occurrence bus for this tick and mirror its committed facts onto
   * the run bus under run-scoped occurrence keys. Ids, ticks, entity ids,
   * local sequences and payloads are carried verbatim; only the occurrence key
   * gains the run/occurrence namespace the kernel cannot supply itself.
   */
  #flushOccurrence(tick120: number): void {
    const occurrence = this.#occurrence;
    if (occurrence === null) return;
    if (occurrence.startTick120 === tick120) occurrence.bus.flush();
    else occurrence.kernel.flushTick(tick120);

    const committed = occurrence.bus.committedEventsFrom(occurrence.mirrorCursor);
    occurrence.mirrorCursor += committed.length;
    if (committed.length > 0) {
      const prefix = `${this.runId}:occurrence:${occurrence.encounterOrdinal}`;
      this.#bus.enqueueBatch(committed.map((event) => {
        if (event.tick120 !== tick120) {
          throw new Error(
            `occurrence mirror received tick ${event.tick120} while closing tick ${tick120}`,
          );
        }
        return {
          id: event.id as string,
          tick120: event.tick120,
          entityStableId: event.entityStableId,
          localSequence: event.localSequence,
          occurrenceKey: `${prefix}:${event.occurrenceKey}`,
          payload: event.payload,
        };
      }));
    }
    if (occurrence.startTick120 !== tick120 && occurrence.kernel.snapshot().handoffReady) {
      this.#occurrence = null;
    }
  }

  #observeMetrics(input: ConductorTickInput, tick120: number): void {
    this.#metrics.observePlayerTransform(
      tick120,
      clampRatio(this.#playerPosition.x / LOGICAL_VIEW_WIDTH),
      clampRatio(this.#playerPosition.y / LOGICAL_VIEW_HEIGHT),
      clampRatio(this.#flowerIntensity),
      input.focused,
    );
    this.#metrics.observeRoomTime(this.#currentRoom(), 1);
    if (input.focused) this.#metrics.observeFocusDwell(1);
    const meaningful = input.movement.x !== 0 || input.movement.y !== 0
      || input.focused || input.gazeIntent;
    if (meaningful && !this.#meaningfulInputActive) this.#metrics.observeMeaningfulInputEdge();
    this.#meaningfulInputActive = meaningful;
  }

  /**
   * React to the atomic world swap. This runs before the tick's canonical
   * close because entering a room writes weather cycle events, and a closed
   * tick may never receive an authoritative write.
   */
  #observeRoomChange(tick120: number): void {
    const roomId = this.#currentRoom();
    if (this.#thresholdWatcher.roomId === roomId) return;
    this.#thresholdWatcher = new RoomThresholdWatcher(roomId);
    if (this.#visitedRooms.includes(roomId)) return;
    this.#visitedRooms.push(roomId);
    // Weather is presentation only: entering a room reschedules its cycle and
    // clears room-local residue, and touches no gameplay RNG or collider.
    this.#weather.enterRoom(roomId, this.#visitedRooms.length - 1, tick120);
  }

  #observeThresholds(input: ConductorTickInput, tick120: number): void {
    const crossings = this.#thresholdWatcher.observe(
      {
        "flower.intensity": this.#flowerIntensity,
        "gaze.stillMs": input.gazeIntent ? this.#gazeTotalMs() : 0,
        "gaze.directness": input.gazeAlignment,
        "gaze.holdMs": this.#gazeTotalMs(),
        "gaze.totalMs": this.#gazeTotalMs(),
        "flower.forcedDimCount": this.#flowerForcedDimCount,
        "evidence.available": this.#evidenceAvailable,
        "player.xNorm": clampRatio(this.#playerPosition.x / LOGICAL_VIEW_WIDTH),
        "run.endEligibility": this.#facts["runEnd.eligible"] === true ? 1 : 0,
      },
      tick120,
    );
    for (const crossing of crossings) {
      this.#thresholdFacts.push(Object.freeze({
        tick120: crossing.tick120,
        roomId: crossing.roomId,
        thresholdId: crossing.thresholdId,
        reaction: crossing.reaction,
        edge: crossing.edge,
      }));
      if (crossing.edge === "enter") this.#metrics.observeRoomThresholdCrossing();
    }
  }

  #updateFacts(input: ConductorTickInput, tick120: number): void {
    const facts = this.#facts;
    const gaze = this.#gaze.snapshot();
    facts["run.elapsedMs"] = this.#elapsedMs();
    facts["player.meaningfulInputCount"] = this.#metrics.meaningfulInputEdgeCount();
    facts["gaze.pitchDeg"] = input.gazeIntent ? input.gazePitchDegrees : 0;
    facts["gaze.directness"] = input.gazeIntent ? input.gazeAlignment : 0;
    facts["gaze.eventCount"] = gaze.eventCount;
    facts["gaze.totalMs"] = this.#gazeTotalMs();
    facts["flower.forcedDimCount"] = this.#flowerForcedDimCount;
    facts["evidence.available"] = this.#evidenceAvailable;
    facts["room.id"] = this.#currentRoom();
    facts["room.distinctVisited"] = this.#visitedRooms.length;
    facts["snapshot.continueRequested"] = input.snapshotContinueRequested === true;
    facts["snapshot.titleRequested"] = input.snapshotTitleRequested === true;

    // Override is a local absence, gated by the authored POLARIZED compound
    // clause set (gaze.totalMs, flower.forcedDimCount, evidence.available).
    const gateSamples: Readonly<Record<string, number>> = {
      "gaze.totalMs": this.#gazeTotalMs(),
      "flower.forcedDimCount": this.#flowerForcedDimCount,
      "evidence.available": this.#evidenceAvailable,
    };
    facts["override.eligibility"] = OVERRIDE_ELIGIBILITY_GATE.clauses.every((clause) => {
      const sample = gateSamples[clause.metric];
      if (sample === undefined) return false;
      switch (clause.operator) {
        case ">=": return sample >= clause.value;
        case ">": return sample > clause.value;
        case "<=": return sample <= clause.value;
        case "<": return sample < clause.value;
        default: return false;
      }
    });

    // Natural run-end eligibility: the authored minimum run length and the
    // authored minimum distinct rooms. Reaching it withdraws the protocol; it
    // is not an achievement and carries no evaluative vocabulary.
    if (
      this.#runEndReason === null
      && this.#elapsedMs() >= this.machine.runEndEligibility.minimumRunMs
      && this.#visitedRooms.length >= this.machine.runEndEligibility.minimumDistinctRooms
    ) {
      this.#commitRunEndReason("PROTOCOL_WITHDRAWAL");
    }
    facts["runEnd.eligible"] = this.#runEndReason !== null;
    void tick120;
  }

  // ----------------------------------------------------------- narrative ---

  #advanceNarrative(tick120: number): void {
    // One transition per tick keeps the FSM's own clock on the tick grid; a
    // state that would immediately fall through simply exits next tick.
    const state = this.#requireState(this.#stateId);
    if (state.terminal) {
      this.#complete = true;
      return;
    }
    const inState = tick120 - this.#stateEnteredTick120;
    if (inState * 1000 < state.minimumDurationMs * TICKS_PER_SECOND) return;
    for (const transition of state.transitions) {
      const passed = evaluateCompiledGuard(transition.guard, (factName) => this.#readFact(factName));
      if (!passed) continue;
      this.#emitStateEvents(this.#stateId, transition.events);
      const next = transition.next;
      if (next === this.#stateId) {
        // Self-transition (FIRST_EYE's horizon shift): re-arm, do not re-enter.
        this.#stateEnteredTick120 = tick120;
        return;
      }
      this.#enterState(next, tick120);
      return;
    }
  }

  #enterState(nextStateId: string, tick120: number): void {
    const next = this.#requireState(nextStateId);
    this.#stateId = nextStateId;
    this.#stateEnteredTick120 = tick120;
    this.#onEnterState(nextStateId, tick120);
    this.#emitStateEvents(nextStateId, next.enterEvents);
    if (next.terminal) this.#complete = true;
  }

  #onEnterState(stateId: string, tick120: number): void {
    switch (stateId) {
      case "ROOM_SAMPLING":
        // The composer plan's millisecond clock is anchored here, so room
        // sampling never runs against wall time or against the quiet awakening.
        if (this.#planAnchorTick120 < 0) this.#planAnchorTick120 = tick120;
        return;
      case "DUSK_APPROACH":
      case "NO_DUSK":
        // Dusk stops NEW spawning. Existing bodies and residue are untouched:
        // the world does not clear itself to announce an ending.
        this.#combatSpawningStopped = true;
        return;
      case "RUN_END_COMMIT":
        this.#armRunEndCommit(tick120);
        return;
      case "STATE_SNAPSHOT":
        this.#beginSnapshot(tick120);
        return;
      case "CROSS_RUN_MATERIALIZATION":
        this.#materialize();
        return;
      default:
        return;
    }
  }

  /**
   * Authored narrative enter/exit events. Names that exist in
   * event-schema-v4.json are written to the canonical bus; the rest are
   * narrative-layer facts on this log. Nothing is invented in either
   * direction — membership is decided by the canonical registry.
   */
  #emitStateEvents(stateId: string, events: readonly string[]): void {
    for (const event of events) this.#logNarrativeEvent(this.#tick120, event, stateId);
  }

  #logNarrativeEvent(tick120: number, event: string, stateId = this.#stateId): void {
    this.#narrativeLog.push(Object.freeze({
      tick120: Math.max(0, tick120),
      state: stateId,
      event,
      canonical: canonicalEventIdForNarrativeEvent(event) !== null,
    }));
  }

  // ------------------------------------------------------------- run end ---

  #commitRunEndReason(reason: ResolutionReason): void {
    if (this.#runEndReason !== null) return;
    if (CONDUCTOR_DEFERRED_RUN_END_REASONS.includes(reason)) {
      throw new Error(
        `run end reason ${reason} has no committing mechanic in this slice; `
        + "it must not fire until its authority lands",
      );
    }
    if (!CONDUCTOR_SUPPORTED_RUN_END_REASONS.includes(reason)) {
      throw new Error(`run end reason is not authored: ${reason}`);
    }
    if (!this.machine.runEndEligibility.acceptedReasons.includes(reason)) {
      throw new Error(`run end reason is not accepted by the manifest: ${reason}`);
    }
    this.#runEndReason = reason;
    this.#combatSpawningStopped = true;
  }

  #armRunEndCommit(tick120: number): void {
    if (this.#runEndReason === null) {
      // NO_DUSK is the only path that can reach the commit without a reason
      // already latched; it withdraws by protocol retraction.
      this.#commitRunEndReason("NO_DUSK_WITHDRAWAL");
    }
    this.#occurrence = null;
    this.#runEndCommitTick120 = tick120 + 1;
  }

  #beginSnapshot(tick120: number): void {
    const record = this.#finalizedRecord;
    if (record === null) throw new Error("state snapshot requires a committed run memory");
    // The snapshot authority begins on an even runtime60 boundary, strictly
    // after this tick's canonical close.
    const next = tick120 + 1;
    this.#snapshotStartedTick120 = next % 2 === 0 ? next : next + 1;
    // Observation selection is authored: <= 3, <= 1 per category, priority
    // desc, ties broken by hash(run.id, observation.id) in narrative.ts.
    const validated = validateNarrativeRecord(record, (value) => {
      assertRunMemory(value);
    });
    this.#observations = selectSnapshotObservations(validated);
    if (this.#observations.length > 3) {
      throw new Error("snapshot observation selection exceeded the authored maximum");
    }
  }

  #materialize(): void {
    const record = this.#finalizedRecord;
    if (record === null) throw new Error("cross-run materialization requires a committed run memory");
    if (this.#archive !== null) this.#archive.persist(record);
    this.#facts["nextRun.queueVerified"] = true;
  }

  // ------------------------------------------------------------- helpers ---

  #requireState(stateId: string) {
    const state = this.machine.states.get(stateId);
    if (state === undefined) throw new Error(`narrative state is not authored: ${stateId}`);
    return state;
  }

  #readFact(factName: string): GuardFactValue {
    if (!Object.prototype.hasOwnProperty.call(this.#facts, factName)) {
      throw new Error(`narrative guard read an unregistered fact: ${factName}`);
    }
    const value = this.#facts[factName];
    return value === undefined ? null : value;
  }

  #currentRoom(): ConductorRoomId {
    return this.#roomTransition.snapshot().currentRoom as ConductorRoomId;
  }

  /** Integer millisecond view of the integer tick grid; never a float clock. */
  #elapsedMs(): number {
    return Math.floor(Math.max(0, this.#tick120) * 1000 / TICKS_PER_SECOND);
  }

  #gazeTotalMs(): number {
    return Math.floor(this.#gazeClampTicks * 1000 / TICKS_PER_SECOND);
  }
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) throw new Error("ratio must be finite");
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function isAdmittedPattern(patternId: string): boolean {
  return (SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS as readonly string[]).includes(patternId);
}

/** Exposed for tests and S3 wiring: the snapshot authority's completion span. */
export const CONDUCTOR_SNAPSHOT_COMPLETE_TICKS120 = SNAPSHOT_COMPLETE_TICKS120;
