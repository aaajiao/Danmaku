import runDirectorManifestJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/run-director-v4.json";
import eventProjectionsManifestJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/integration/event-projections-v4.json";
import uiLayoutsManifestJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/narrative/ui-layouts-v4.json";
import narrativeStateMachineJson from "../../../1bit-stg-complete-asset-kit-v4/narrative/narrative-state-machine-v4.json";
import {
  CanonicalCombatKernel,
  CanonicalRunCombatState,
  type CanonicalCombatKernelOptions,
  type CanonicalCombatSnapshot,
} from "./combat-kernel";
import {CanonicalEventBus, type CanonicalGameplayEvent} from "./events";
import {
  FlowerIntensityAuthority,
  type FlowerIntensityResolution,
  type FlowerIntensitySnapshot,
} from "./flower";
import {
  GAZE_AUTHORITY_CONTRACT,
  GazeAuthority,
  validateGazeAuthoritySample,
  type GazeAuthoritySample,
  type GazeAuthoritySnapshot,
} from "./gaze";
import {
  CanonicalRunBehaviorFactLedger,
  type CanonicalRunBehaviorFactsSnapshot,
  type CanonicalRunBehaviorOwnerPhase,
} from "./run-behavior-facts";
import {
  CANONICAL_RUN_PRE_ROOM_BEHAVIOR_CAPTURE_MISSING,
  createCanonicalRunPreRoomBehaviorCapture,
  type CanonicalRunPreRoomBehaviorCapture,
} from "./run-behavior-capture";
import {
  AUTHORED_PLAYER_Y,
  LOGICAL_VIEW_HEIGHT,
  LOGICAL_VIEW_WIDTH,
  PLAYER_FOCUS_MAX_SPEED_PX_PER_SECOND,
  PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND,
  executablePattern,
} from "./pattern-executor";
import {
  PLAYER_NORMAL_COLLISION_RADIUS_PX,
  type ProjectilePoolClass,
  type Vec2,
} from "./projectiles";
import {playerInputEligibleAtTick} from "./player";
import {
  CanonicalRunRoomSession,
  type CanonicalRunRoomSessionSnapshot,
} from "./run-room-session";

const TICKS_PER_SECOND = 120;
const UINT32_MAX = 0xffff_ffff;
const INPUT_MAGNITUDE_TOLERANCE = 1e-9;
const MEANINGFUL_MOVEMENT_THRESHOLD = 0.15;
const AWAKENING_DURATION_MS = 8000;
const AWAKENING_MINIMUM_DURATION_MS = 6000;
const AWAKENING_MEANINGFUL_INPUT_COUNT = 2;
const SIGNAL_FALLBACK_MS = 60000;
const INACTIVE_SIGNAL_INTENSITY = 0.3;
const ACTIVE_SIGNAL_INTENSITY = 0.5;
const FIRST_EYE_PATTERN_ID = "common.eye_acquisition";
const FIRST_EYE_OCCURRENCE_ID = "run:first-eye:0";
const FIRST_EYE_ROOM_ID = "INFORMATION";
const FIRST_EYE_DIFFICULTY = "EASY";
const FIRST_EYE_DIFFICULTY_SALT = 0x0100;
const GAZE_INTENT_PITCH_DEGREES = 60;
const GAZE_INTENT_ALIGNMENT = 1;
const FLOWER_RECOVERY_DELAY_TICKS120 = 30;
const FLOWER_RECOVERY_DELAY_MS = FLOWER_RECOVERY_DELAY_TICKS120 * 1000 / TICKS_PER_SECOND;

interface RunDirectorPhaseManifest {
  readonly id: string;
  readonly durationMs?: readonly unknown[];
  readonly combat?: unknown;
  readonly patterns?: readonly unknown[];
  readonly unlocks?: readonly unknown[];
}

interface RunDirectorManifest {
  readonly schemaVersion: string;
  readonly id: string;
  readonly runIs: string;
  readonly phases: readonly RunDirectorPhaseManifest[];
  readonly determinism: {
    readonly seedAlgorithm: string;
    readonly sameSeedAndInputsSameTrace: boolean;
  };
}

interface ValidatedRunContract {
  readonly awakeningRangeMs: readonly [6000, 10000];
  readonly awakeningUnlocks: readonly ["move", "flower_expression"];
  readonly firstEyeUnlocks: readonly ["focus", "graze_evidence"];
  readonly freshSessionBootstrapOrder: readonly [
    "BOOT_REHYDRATE",
    "GHOST_REPLAY",
    "WITNESS_ORIENTATION",
    "AWAKENING",
  ];
}

interface NarrativeStateManifest {
  readonly inputPolicy?: unknown;
  readonly minimumDurationMs?: unknown;
  readonly exitGuard?: unknown;
  readonly next?: unknown;
  readonly enterEvents?: readonly unknown[];
  readonly exitEvents?: readonly unknown[];
  readonly transitions?: readonly Readonly<{
    readonly guard?: unknown;
    readonly events?: readonly unknown[];
    readonly next?: unknown;
  }>[];
  readonly discovery?: Readonly<{readonly fallback?: unknown}>;
}

interface NarrativeStateMachineManifest {
  readonly schemaVersion: string;
  readonly id: string;
  readonly authority: string;
  readonly initialState: string;
  readonly states: Readonly<Record<string, NarrativeStateManifest>>;
}

interface UiLayoutsManifest {
  readonly schemaVersion: string;
  readonly screens: Readonly<{
    readonly discovery_prompts?: Readonly<{
      readonly prompts?: readonly Readonly<Record<string, unknown>>[];
    }>;
  }>;
}

interface EventProjectionManifest {
  readonly schemaVersion: string;
  readonly purpose: string;
  readonly projectionCount: number;
  readonly rules: readonly Readonly<{
    readonly narrativeEvent?: unknown;
    readonly canonicalSources?: readonly unknown[];
    readonly predicate?: unknown;
    readonly authority?: unknown;
  }>[];
}

export type CanonicalRunSessionPhase =
  | "quiet_awakening"
  | "first_eye"
  | "first_clamp_recovery"
  | "room_sampling";

export interface CanonicalRunSessionOptions {
  /** Domain-tagged raw Run seed; occurrence seeds are resolved by recorded adapter policy. */
  readonly rawRunSeed: Readonly<{
    readonly domain: "raw-run-seed";
    readonly value: number;
  }>;
  /** Adapter gap: V4 names graze evidence, but does not declare its radius. */
  readonly grazeRadiusPx: number;
  /** Adapter gap: V4 does not declare one universal projectile damage amount. */
  readonly projectileDamage: number;
  /** Adapter gap: V4 budgets pool classes without mapping archetypes to them. */
  readonly projectilePoolClasses: Readonly<Record<string, ProjectilePoolClass>>;
}

export interface CanonicalRunSessionStepInput {
  readonly tick120: number;
  readonly movement: Vec2;
  /** Browser/application signal action before the explicit binary mapping. */
  readonly signalActive: boolean;
  readonly focused: boolean;
  /** Explicit device adapter output; this authority never infers gaze from movement or presentation. */
  readonly gaze: GazeAuthoritySample;
  readonly overridePressed?: boolean;
  readonly overrideReleased?: boolean;
  readonly overrideDirection?: Vec2;
}

export interface CanonicalRunSessionPlayerSnapshot {
  readonly position: Vec2;
  readonly focused: boolean;
  readonly inputEnabled: boolean;
  readonly flower: FlowerIntensitySnapshot;
  readonly meaningfulInputCount: number;
  readonly signalInputCount: number;
  /** Null before first-eye; retained after combat hands authority onward. */
  readonly damage: CanonicalCombatSnapshot["player"] | null;
}

export interface CanonicalRunSessionHandoffSnapshot {
  readonly state:
    | "not_started"
    | "awaiting_first_eye_barriers"
    | "flower_recovery_delayed"
    | "ready_for_room_sampling";
  readonly targetNarrativeState: "ROOM_SAMPLING";
  readonly ready: boolean;
  readonly sourcePatternId: typeof FIRST_EYE_PATTERN_ID;
  readonly atTick120: number | null;
  readonly consumed: boolean;
  readonly consumedAtTick120: number | null;
  readonly consumerAuthority: "ext-005-first-forced-room-bootstrap" | null;
  readonly barriers: Readonly<{
    readonly combatDrained: boolean;
    readonly gazeClampCommitted: boolean;
    readonly gazeClampReleased: boolean;
    readonly flowerRecoveryComplete: boolean;
    /** Transfer safety, not a narrative progress fact: no live gaze deadline may be frozen. */
    readonly gazeTimedStateQuiescent: boolean;
  }>;
  readonly recovery: Readonly<{
    readonly delayTicks120: typeof FLOWER_RECOVERY_DELAY_TICKS120;
    readonly dueAtTick120: number | null;
    readonly completedAtTick120: number | null;
  }>;
  readonly sourceCombat: Readonly<{
    readonly tick120: number;
    readonly patternComplete: true;
    readonly projectileLifecycleDrained: true;
    readonly handoffReady: true;
    readonly liveEntities: 0;
    readonly liveColliders: 0;
  }> | null;
}

export interface CanonicalRunFreshSessionBootstrap {
  readonly scope: "fresh-session-without-previous-run-material";
  readonly narrativeStateOrder: ValidatedRunContract["freshSessionBootstrapOrder"];
  readonly previousMaterial: "absent";
  readonly previousGhostRoute: "absent";
  readonly witnessSources: "absent";
  readonly inputAvailableAtTick120: 0;
  readonly syntheticRestoreEvents: false;
}

export interface CanonicalRunSessionAdapterPolicy {
  readonly provenance: "application-policy-within-v4-contract";
  readonly awakeningDurationMs: typeof AWAKENING_DURATION_MS;
  readonly awakeningManifestRangeMs: readonly [6000, 10000];
  readonly awakeningSelection: "fixed-midpoint-plus-meaningful-input-guard";
  readonly awakeningExitGuard: Readonly<{
    minimumDurationMs: typeof AWAKENING_MINIMUM_DURATION_MS;
    selectedDurationMs: typeof AWAKENING_DURATION_MS;
    meaningfulInputCount: typeof AWAKENING_MEANINGFUL_INPUT_COUNT;
  }>;
  readonly meaningfulInput: Readonly<{
    movementRisingThreshold: typeof MEANINGFUL_MOVEMENT_THRESHOLD;
    signalRisingEdge: true;
    simultaneousMovementAndSignal: "one-aggregate-fact";
    sustainedInputRepeats: false;
    provenance: "application-required-v4-omission";
  }>;
  readonly signal: Readonly<{
    mapping: "binary-action-to-intensity";
    inactiveIntensity: typeof INACTIVE_SIGNAL_INTENSITY;
    activeIntensity: typeof ACTIVE_SIGNAL_INTENSITY;
    fallbackAtMs: typeof SIGNAL_FALLBACK_MS;
    fallbackCopyId: "prompt.signal";
    provenance: "application-required-v4-omission";
  }>;
  readonly pauseInputPolicy: "discard-paused-edges-reconcile-held-at-next-tick";
  readonly wallGapInputPolicy: "hold-last-sample-until-backlog-drained";
  readonly presentation: Readonly<{
    firstEyeTargetFrame: "eye.reveal";
    firstEyeTargetFact: "first-eye-phase-enter-eye-horizon-appear";
    gazeAcquireReadFrames: "committed-gaze-state-only";
    gazeAcquiringFrame: "eye.acquire";
    gazeClampedFrame: "eye.read";
    playerLifeFrames: "stable-state-representatives-not-clip-phase";
    deadFrame: "player.residue_hold";
    deadReducedMotionFrame: "player.residue_appear";
    respawningFrame: "player.respawn_asymmetric.frame_04";
    respawningReducedMotionFrame: "player.respawn_asymmetric.frame_05";
    runEndedFrame: "player.digital_delete";
    provenance: "application-required-v4-omission";
  }>;
  readonly freshSessionBootstrap: CanonicalRunFreshSessionBootstrap;
  readonly playerBounds: Readonly<{
    minX: 0;
    maxX: typeof LOGICAL_VIEW_WIDTH;
    minY: 0;
    maxY: typeof LOGICAL_VIEW_HEIGHT;
  }>;
  readonly playerSpeedPxPerSecond: Readonly<{
    normal: typeof PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND;
    focused: typeof PLAYER_FOCUS_MAX_SPEED_PX_PER_SECOND;
  }>;
  /** The run manifest omits room/difficulty, so the adapter records its fixed choice. */
  readonly firstEye: Readonly<{
    patternId: typeof FIRST_EYE_PATTERN_ID;
    occurrenceId: typeof FIRST_EYE_OCCURRENCE_ID;
    roomId: typeof FIRST_EYE_ROOM_ID;
    difficulty: typeof FIRST_EYE_DIFFICULTY;
    combatOwnership: "strictly-sequential-shared-run-state";
    tickClosure: "irreversible-exact-next-tick";
    postReleaseTimers: "shared-idle-advance";
    roomDifficultyProvenance: "application-required-v4-omission";
    seedAuthority: "raw-run-seed+ext-005-difficulty-salt";
    difficultySalt: typeof FIRST_EYE_DIFFICULTY_SALT;
    seedComposition: "rawRunSeed xor patternBase xor encounterOrdinal xor difficultySalt";
    manifestDurationRangeMs: readonly [7000, 12000];
    authoredPatternDurationMs: number;
    exit: "combat-drain+gaze-release+flower-recovery";
    gazeSampleAuthority: "caller-supplied-device-neutral-sample";
    gazeIntent: Readonly<{
      applicationFact: "independent-held-gaze-intent";
      keyboardCode: "KeyG";
      gamepadButton: 3;
      pointerCount: 2;
      focusIndependent: true;
      qualifiedPitchDegrees: typeof GAZE_INTENT_PITCH_DEGREES;
      qualifiedAlignment: typeof GAZE_INTENT_ALIGNMENT;
      neutralPitchDegrees: 0;
      neutralAlignment: 0;
      provenance: "application-required-v4-omission";
    }>;
    gazeAcquireTicks120: number;
    gazeReleaseDelayTicks120: number;
    flowerRecoveryAuthority: "application-tick120-delay+v4-flower-resolver";
    flowerRecoveryDelayTicks120: typeof FLOWER_RECOVERY_DELAY_TICKS120;
    flowerRecoveryDelayMs: typeof FLOWER_RECOVERY_DELAY_MS;
    flowerRecoveryProjectionContext: "GAZE_RECOVERY";
    flowerRecoveryCanonicalSources: readonly ["focus", "signal"];
    flowerRecoveryMinimumExclusive: number;
    handoffTargetNarrativeState: "ROOM_SAMPLING";
    handoffAuthorityQuiescence: "run-timers-idle+gaze-idle";
    overrideAvailability: "withheld-until-local-resistance-authority";
  }>;
}

export interface CanonicalRunSessionSnapshot {
  readonly authority: "canonical-run-session-v4";
  readonly rawRunSeed: CanonicalRunSessionOptions["rawRunSeed"];
  readonly firstEyeResolvedSeed: Readonly<{
    readonly domain: "resolved-occurrence-seed";
    readonly value: number;
  }>;
  readonly phase: CanonicalRunSessionPhase;
  readonly tick120: number;
  readonly segmentTick120: number;
  readonly player: CanonicalRunSessionPlayerSnapshot;
  readonly gaze: GazeAuthoritySnapshot;
  readonly combat: CanonicalCombatSnapshot | null;
  /** Run-scoped facts retained across the unsupported authority boundary. */
  readonly evidence: CanonicalCombatSnapshot["evidence"] | null;
  readonly override: CanonicalCombatSnapshot["override"] | null;
  readonly discovery: Readonly<{
    readonly signalFallbackVisible: boolean;
  }>;
  readonly handoff: CanonicalRunSessionHandoffSnapshot;
  readonly roomSampling: CanonicalRunRoomSessionSnapshot | null;
  /** Bounded observation only; it is neither a metric snapshot nor composer input. */
  readonly behaviorFacts: CanonicalRunBehaviorFactsSnapshot;
  /** Frozen `[1,H]` facts only; never a room plan or composer input. */
  readonly preRoomBehaviorCapture: CanonicalRunPreRoomBehaviorCapture;
  readonly adapterPolicy: CanonicalRunSessionAdapterPolicy;
}

interface ValidatedStepInput {
  readonly tick120: number;
  readonly movement: Vec2;
  readonly signalActive: boolean;
  readonly focused: boolean;
  readonly gaze: Readonly<GazeAuthoritySample>;
  readonly overridePressed: boolean;
  readonly overrideReleased: boolean;
  readonly overrideDirection: Vec2 | null;
}

function deepFreezeJson<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => deepFreezeJson(entry))) as T;
  }
  if (typeof value === "object" && value !== null) {
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) copy[key] = deepFreezeJson(entry);
    return Object.freeze(copy) as T;
  }
  return value;
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactArray(value: unknown, expected: readonly unknown[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

function requireSafeTick(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${path} must be a non-negative safe integer`);
  }
  return value as number;
}

function requirePositiveFinite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${path} must be finite and positive`);
  }
  return value;
}

function requirePositiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${path} must be a positive safe integer`);
  }
  return value as number;
}

function ownData(object: object, key: PropertyKey, path: string, required: boolean): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined) {
    if (required) throw new Error(`${path} is required`);
    return undefined;
  }
  if (!("value" in descriptor)) throw new Error(`${path} must be an own data property`);
  return descriptor.value;
}

function freezeVec2(value: unknown, path: string): Vec2 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be a vector object`);
  }
  const x = ownData(value, "x", `${path}.x`, true);
  const y = ownData(value, "y", `${path}.y`, true);
  if (typeof x !== "number" || !Number.isFinite(x) || typeof y !== "number" || !Number.isFinite(y)) {
    throw new Error(`${path} must contain finite coordinates`);
  }
  return Object.freeze({
    x: Object.is(x, -0) ? 0 : x,
    y: Object.is(y, -0) ? 0 : y,
  });
}

function validateRunDirectorManifest(manifest: RunDirectorManifest): ValidatedRunContract {
  if (
    manifest.schemaVersion !== "4.0.0"
    || manifest.id !== "director.run.v4"
    || manifest.runIs !== "behavioral sampling, not a linear stage ladder"
  ) {
    throw new Error("canonical run session requires the V4 run-director identity contract");
  }
  if (
    manifest.determinism.seedAlgorithm !== "mulberry32-v1"
    || manifest.determinism.sameSeedAndInputsSameTrace !== true
  ) {
    throw new Error("canonical run session determinism contract drifted");
  }
  const awakeningIndex = manifest.phases.findIndex((phase) => phase.id === "quiet_awakening");
  const firstEyeIndex = manifest.phases.findIndex((phase) => phase.id === "first_eye");
  if (
    awakeningIndex !== 0
    || firstEyeIndex !== 1
    || manifest.phases.filter((phase) => phase.id === "quiet_awakening").length !== 1
    || manifest.phases.filter((phase) => phase.id === "first_eye").length !== 1
  ) {
    throw new Error("canonical prologue phase order drifted");
  }
  const awakening = manifest.phases[awakeningIndex];
  const firstEye = manifest.phases[firstEyeIndex];
  if (awakening === undefined || firstEye === undefined) {
    throw new Error("canonical prologue phases are missing");
  }
  const range = awakening.durationMs;
  if (
    range?.length !== 2
    || range[0] !== 6000
    || range[1] !== 10000
    || awakening.combat !== false
    || !exactArray(awakening.unlocks, ["move", "flower_expression"])
  ) {
    throw new Error("quiet_awakening V4 contract drifted");
  }
  if (AWAKENING_DURATION_MS < range[0] || AWAKENING_DURATION_MS > range[1]) {
    throw new Error("awakening adapter duration is outside the V4 manifest range");
  }
  if (
    firstEye.combat !== "sparse"
    || firstEye.durationMs?.length !== 2
    || firstEye.durationMs[0] !== 7000
    || firstEye.durationMs[1] !== 12000
    || firstEye.patterns?.length !== 1
    || firstEye.patterns[0] !== FIRST_EYE_PATTERN_ID
    || !exactArray(firstEye.unlocks, ["focus", "graze_evidence"])
  ) {
    throw new Error("first_eye V4 combat contract drifted");
  }
  const firstEyePatternDurationMs = executablePattern(FIRST_EYE_PATTERN_ID).durationMs;
  if (firstEyePatternDurationMs < firstEye.durationMs[0] || firstEyePatternDurationMs > firstEye.durationMs[1]) {
    throw new Error("first-eye executable duration is outside the V4 run-director range");
  }
  return Object.freeze({
    awakeningRangeMs: Object.freeze([6000, 10000] as const),
    awakeningUnlocks: Object.freeze(["move", "flower_expression"] as const),
    firstEyeUnlocks: Object.freeze(["focus", "graze_evidence"] as const),
    freshSessionBootstrapOrder: Object.freeze([
      "BOOT_REHYDRATE",
      "GHOST_REPLAY",
      "WITNESS_ORIENTATION",
      "AWAKENING",
    ] as const),
  });
}

function validateNarrativeContracts(
  manifest: NarrativeStateMachineManifest,
  uiLayouts: UiLayoutsManifest,
): void {
  if (
    manifest.schemaVersion !== "4.0.0-narrative-state-machine"
    || manifest.id !== "narrative.run-cycle.v4"
    || manifest.authority !== "gameplay"
    || manifest.initialState !== "BOOT_REHYDRATE"
  ) {
    throw new Error("canonical run session requires the V4 narrative state-machine identity");
  }
  const boot = manifest.states.BOOT_REHYDRATE;
  const ghost = manifest.states.GHOST_REPLAY;
  const witness = manifest.states.WITNESS_ORIENTATION;
  const awakening = manifest.states.AWAKENING;
  const firstEye = manifest.states.FIRST_EYE;
  const firstClampRecovery = manifest.states.FIRST_CLAMP_RECOVERY;
  const firstEyeClamp = firstEye?.transitions?.[0];
  const firstEyeFallback = firstEye?.transitions?.[1];
  if (
    boot?.next !== "GHOST_REPLAY"
    || ghost?.next !== "WITNESS_ORIENTATION"
    || witness?.next !== "AWAKENING"
    || awakening?.next !== "FIRST_EYE"
    || awakening.inputPolicy !== "movement-and-signal"
    || awakening.minimumDurationMs !== AWAKENING_MINIMUM_DURATION_MS
    || awakening.exitGuard !== "run.elapsedMs >= 6000 && player.meaningfulInputCount >= 2"
    || awakening.discovery?.fallback
      !== "After 60 seconds without signal input, show only the currently bound signal input glyph."
    || firstEye?.inputPolicy !== "full"
    || !exactArray(firstEye.enterEvents, ["eye.horizon.appear"])
    || firstEye.transitions?.length !== 2
    || firstEyeClamp?.guard !== "gaze.pitchDeg > 45 && gaze.directness >= 0.55"
    || !exactArray(firstEyeClamp.events, [
      "gaze.acquire",
      "gaze.clamp.begin",
      "flower.forcedDim",
      "audio.gazeLowPass.begin",
    ])
    || firstEyeClamp.next !== "FIRST_CLAMP_RECOVERY"
    || firstEyeFallback?.guard !== "run.elapsedMs >= 30000 && gaze.eventCount == 0"
    || !exactArray(firstEyeFallback.events, ["eye.horizon.shift", "gaze.thresholdLine.pulseOnce"])
    || firstEyeFallback.next !== "FIRST_EYE"
    || firstClampRecovery?.inputPolicy !== "full"
    || !exactArray(firstClampRecovery.enterEvents, ["flower.recovery.delay.begin"])
    || firstClampRecovery.exitGuard
      !== "gaze.clampReleased == true && flower.recoveryComplete == true"
    || !exactArray(firstClampRecovery.exitEvents, ["firstEye.complete"])
    || firstClampRecovery.next !== "ROOM_SAMPLING"
  ) {
    throw new Error("canonical run session narrative prologue contract drifted");
  }
  if (uiLayouts.schemaVersion !== "4.0.0-ui-layout") {
    throw new Error("canonical run session requires the V4 UI layout identity");
  }
  const prompts = uiLayouts.screens.discovery_prompts?.prompts;
  const signalFallback = prompts?.find((prompt) => prompt.id === "signal-fallback");
  if (
    signalFallback?.guard !== "run.elapsedMs >= 60000 && player.signalInputCount == 0"
    || signalFallback.copy !== "prompt.signal"
    || signalFallback.dismiss !== "first signal input"
  ) {
    throw new Error("canonical run session signal fallback contract drifted");
  }
}

function validateEventProjectionContract(manifest: EventProjectionManifest): void {
  if (
    manifest.schemaVersion !== "4.0.0-event-projections"
    || manifest.purpose
      !== "Narrative cue names are read-only projections of canonical runtime events, never a second gameplay clock."
    || manifest.projectionCount !== manifest.rules.length
  ) {
    throw new Error("canonical run session requires the V4 event-projection identity contract");
  }
  const requireIdentityProjection = (narrativeEvent: string, canonicalSource: string): void => {
    const matches = manifest.rules.filter((rule) => rule.narrativeEvent === narrativeEvent);
    if (
      matches.length !== 1
      || !exactArray(matches[0]?.canonicalSources, [canonicalSource])
      || matches[0]?.predicate !== "identity"
      || matches[0]?.authority !== "read-only projection"
    ) {
      throw new Error(`canonical narrative projection drifted: ${narrativeEvent}`);
    }
  };
  requireIdentityProjection("gaze.clamp.begin", "gaze.clamp.commit");
  requireIdentityProjection("gaze.clamp.release", "gaze.clamp.release");
  const recovery = manifest.rules.filter((rule) => rule.narrativeEvent === "flower.recovery.complete");
  if (
    recovery.length !== 1
    || !exactArray(recovery[0]?.canonicalSources, ["flower.intensity.commit"])
    || recovery[0]?.predicate !== "source=GAZE_RECOVERY and target band reached"
    || recovery[0]?.authority !== "read-only projection"
  ) {
    throw new Error("canonical narrative projection drifted: flower.recovery.complete");
  }
}

const RUN_DIRECTOR_MANIFEST = deepFreezeJson(runDirectorManifestJson) as unknown as RunDirectorManifest;
const RUN_CONTRACT = validateRunDirectorManifest(RUN_DIRECTOR_MANIFEST);
const NARRATIVE_STATE_MACHINE = deepFreezeJson(
  narrativeStateMachineJson,
) as unknown as NarrativeStateMachineManifest;
const UI_LAYOUTS_MANIFEST = deepFreezeJson(uiLayoutsManifestJson) as unknown as UiLayoutsManifest;
const EVENT_PROJECTIONS_MANIFEST = deepFreezeJson(
  eventProjectionsManifestJson,
) as unknown as EventProjectionManifest;
validateNarrativeContracts(NARRATIVE_STATE_MACHINE, UI_LAYOUTS_MANIFEST);
validateEventProjectionContract(EVENT_PROJECTIONS_MANIFEST);
const AWAKENING_DURATION_TICKS = AWAKENING_DURATION_MS * TICKS_PER_SECOND / 1000;
const SIGNAL_FALLBACK_TICKS = SIGNAL_FALLBACK_MS * TICKS_PER_SECOND / 1000;
if (!Number.isSafeInteger(AWAKENING_DURATION_TICKS)) {
  throw new Error("awakening adapter duration must map exactly to tick120");
}
if (!Number.isSafeInteger(SIGNAL_FALLBACK_TICKS)) {
  throw new Error("signal fallback duration must map exactly to tick120");
}
if (
  !Number.isSafeInteger(FLOWER_RECOVERY_DELAY_TICKS120)
  || FLOWER_RECOVERY_DELAY_TICKS120 <= 0
  || !Number.isFinite(FLOWER_RECOVERY_DELAY_MS)
) {
  throw new Error("Flower recovery adapter delay must be a positive tick120 duration");
}
if (
  GAZE_INTENT_PITCH_DEGREES < GAZE_AUTHORITY_CONTRACT.pitchThresholdDegrees
  || GAZE_INTENT_ALIGNMENT < GAZE_AUTHORITY_CONTRACT.alignmentThreshold
) {
  throw new Error("gaze-intent adapter sample no longer qualifies for the V4 gaze contract");
}

export const CANONICAL_RUN_SESSION_ADAPTER_POLICY: CanonicalRunSessionAdapterPolicy = deepFreezeJson({
  provenance: "application-policy-within-v4-contract",
  awakeningDurationMs: AWAKENING_DURATION_MS,
  awakeningManifestRangeMs: RUN_CONTRACT.awakeningRangeMs,
  awakeningSelection: "fixed-midpoint-plus-meaningful-input-guard",
  awakeningExitGuard: {
    minimumDurationMs: AWAKENING_MINIMUM_DURATION_MS,
    selectedDurationMs: AWAKENING_DURATION_MS,
    meaningfulInputCount: AWAKENING_MEANINGFUL_INPUT_COUNT,
  },
  meaningfulInput: {
    movementRisingThreshold: MEANINGFUL_MOVEMENT_THRESHOLD,
    signalRisingEdge: true,
    simultaneousMovementAndSignal: "one-aggregate-fact",
    sustainedInputRepeats: false,
    provenance: "application-required-v4-omission",
  },
  signal: {
    mapping: "binary-action-to-intensity",
    inactiveIntensity: INACTIVE_SIGNAL_INTENSITY,
    activeIntensity: ACTIVE_SIGNAL_INTENSITY,
    fallbackAtMs: SIGNAL_FALLBACK_MS,
    fallbackCopyId: "prompt.signal",
    provenance: "application-required-v4-omission",
  },
  pauseInputPolicy: "discard-paused-edges-reconcile-held-at-next-tick",
  wallGapInputPolicy: "hold-last-sample-until-backlog-drained",
  presentation: {
    firstEyeTargetFrame: "eye.reveal",
    firstEyeTargetFact: "first-eye-phase-enter-eye-horizon-appear",
    gazeAcquireReadFrames: "committed-gaze-state-only",
    gazeAcquiringFrame: "eye.acquire",
    gazeClampedFrame: "eye.read",
    playerLifeFrames: "stable-state-representatives-not-clip-phase",
    deadFrame: "player.residue_hold",
    deadReducedMotionFrame: "player.residue_appear",
    respawningFrame: "player.respawn_asymmetric.frame_04",
    respawningReducedMotionFrame: "player.respawn_asymmetric.frame_05",
    runEndedFrame: "player.digital_delete",
    provenance: "application-required-v4-omission",
  },
  freshSessionBootstrap: {
    scope: "fresh-session-without-previous-run-material",
    narrativeStateOrder: RUN_CONTRACT.freshSessionBootstrapOrder,
    previousMaterial: "absent",
    previousGhostRoute: "absent",
    witnessSources: "absent",
    inputAvailableAtTick120: 0,
    syntheticRestoreEvents: false,
  },
  playerBounds: {minX: 0, maxX: LOGICAL_VIEW_WIDTH, minY: 0, maxY: LOGICAL_VIEW_HEIGHT},
  playerSpeedPxPerSecond: {
    normal: PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND,
    focused: PLAYER_FOCUS_MAX_SPEED_PX_PER_SECOND,
  },
  firstEye: {
    patternId: FIRST_EYE_PATTERN_ID,
    occurrenceId: FIRST_EYE_OCCURRENCE_ID,
    roomId: FIRST_EYE_ROOM_ID,
    difficulty: FIRST_EYE_DIFFICULTY,
    combatOwnership: "strictly-sequential-shared-run-state",
    tickClosure: "irreversible-exact-next-tick",
    postReleaseTimers: "shared-idle-advance",
    roomDifficultyProvenance: "application-required-v4-omission",
    seedAuthority: "raw-run-seed+ext-005-difficulty-salt",
    difficultySalt: FIRST_EYE_DIFFICULTY_SALT,
    seedComposition: "rawRunSeed xor patternBase xor encounterOrdinal xor difficultySalt",
    manifestDurationRangeMs: [7000, 12000],
    authoredPatternDurationMs: executablePattern(FIRST_EYE_PATTERN_ID).durationMs,
    exit: "combat-drain+gaze-release+flower-recovery",
    gazeSampleAuthority: "caller-supplied-device-neutral-sample",
    gazeIntent: {
      applicationFact: "independent-held-gaze-intent",
      keyboardCode: "KeyG",
      gamepadButton: 3,
      pointerCount: 2,
      focusIndependent: true,
      qualifiedPitchDegrees: GAZE_INTENT_PITCH_DEGREES,
      qualifiedAlignment: GAZE_INTENT_ALIGNMENT,
      neutralPitchDegrees: 0,
      neutralAlignment: 0,
      provenance: "application-required-v4-omission",
    },
    gazeAcquireTicks120: GAZE_AUTHORITY_CONTRACT.acquireTicks120,
    gazeReleaseDelayTicks120: GAZE_AUTHORITY_CONTRACT.releaseDelayTicks120,
    flowerRecoveryAuthority: "application-tick120-delay+v4-flower-resolver",
    flowerRecoveryDelayTicks120: FLOWER_RECOVERY_DELAY_TICKS120,
    flowerRecoveryDelayMs: FLOWER_RECOVERY_DELAY_MS,
    flowerRecoveryProjectionContext: "GAZE_RECOVERY",
    flowerRecoveryCanonicalSources: ["focus", "signal"],
    flowerRecoveryMinimumExclusive: GAZE_AUTHORITY_CONTRACT.forcedIntensity,
    handoffTargetNarrativeState: "ROOM_SAMPLING",
    handoffAuthorityQuiescence: "run-timers-idle+gaze-idle",
    overrideAvailability: "withheld-until-local-resistance-authority",
  },
});

function validatePoolClasses(value: unknown): Readonly<Record<string, ProjectilePoolClass>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("run session projectilePoolClasses must be an object");
  }
  const expectedArchetypes = [...new Set(
    executablePattern(FIRST_EYE_PATTERN_ID).emitters.map((emitter) => emitter.projectile.archetype),
  )].sort(compareCodePoints);
  const actualArchetypes = Object.keys(value).sort(compareCodePoints);
  if (
    actualArchetypes.length !== expectedArchetypes.length
    || actualArchetypes.some((archetype, index) => archetype !== expectedArchetypes[index])
  ) {
    throw new Error("run session requires an exact first-eye projectile pool-class mapping");
  }
  const result: Record<string, ProjectilePoolClass> = {};
  for (const archetype of actualArchetypes) {
    const poolClass = ownData(value, archetype, `projectilePoolClasses.${archetype}`, true);
    if (!(poolClass === "micro" || poolClass === "medium" || poolClass === "heavy" || poolClass === "splitChildren")) {
      throw new Error(`projectilePoolClasses.${archetype} is not a V4 pool class`);
    }
    result[archetype] = poolClass;
  }
  return Object.freeze(result);
}

function validateOptions(options: CanonicalRunSessionOptions): Readonly<CanonicalRunSessionOptions> {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new Error("canonical run session options must be an object");
  }
  const optionsPrototype = Object.getPrototypeOf(options) as object | null;
  if (optionsPrototype !== Object.prototype && optionsPrototype !== null) {
    throw new Error("canonical run session options must be a plain object");
  }
  const optionKeys = Object.keys(options);
  const expectedOptionKeys = [
    "rawRunSeed",
    "grazeRadiusPx",
    "projectileDamage",
    "projectilePoolClasses",
  ];
  if (
    optionKeys.length !== expectedOptionKeys.length
    || optionKeys.some((key) => !expectedOptionKeys.includes(key))
    || Object.getOwnPropertySymbols(options).length > 0
  ) {
    throw new Error("canonical run session options must contain the exact authority fields");
  }
  const rawRunSeedValue = ownData(options, "rawRunSeed", "run session rawRunSeed", true);
  if (
    typeof rawRunSeedValue !== "object"
    || rawRunSeedValue === null
    || Array.isArray(rawRunSeedValue)
  ) {
    throw new Error("run session rawRunSeed must be a tagged identity");
  }
  const rawRunSeedRecord = rawRunSeedValue as Record<string, unknown>;
  const rawRunSeedPrototype = Object.getPrototypeOf(rawRunSeedRecord) as object | null;
  if (
    (rawRunSeedPrototype !== Object.prototype && rawRunSeedPrototype !== null)
    || Object.keys(rawRunSeedRecord).length !== 2
    || !Object.prototype.hasOwnProperty.call(rawRunSeedRecord, "domain")
    || !Object.prototype.hasOwnProperty.call(rawRunSeedRecord, "value")
    || Object.getOwnPropertySymbols(rawRunSeedRecord).length > 0
  ) {
    throw new Error("run session rawRunSeed must contain only domain and value");
  }
  const rawRunSeedDomain = ownData(
    rawRunSeedRecord,
    "domain",
    "run session rawRunSeed.domain",
    true,
  );
  if (rawRunSeedDomain !== "raw-run-seed") {
    throw new Error("run session rawRunSeed must use the raw-run-seed domain");
  }
  const rawRunSeed = ownData(
    rawRunSeedRecord,
    "value",
    "run session rawRunSeed.value",
    true,
  );
  if (
    !Number.isSafeInteger(rawRunSeed)
    || (rawRunSeed as number) < 0
    || (rawRunSeed as number) > UINT32_MAX
    || Object.is(rawRunSeed, -0)
  ) {
    throw new Error("run session raw Run seed must be a uint32 without negative zero");
  }
  const grazeRadiusPx = requirePositiveFinite(
    ownData(options, "grazeRadiusPx", "run session grazeRadiusPx", true),
    "run session grazeRadiusPx",
  );
  if (grazeRadiusPx <= PLAYER_NORMAL_COLLISION_RADIUS_PX) {
    throw new Error("run session grazeRadiusPx must exceed the canonical normal collision radius");
  }
  const projectileDamage = requirePositiveInteger(
    ownData(options, "projectileDamage", "run session projectileDamage", true),
    "run session projectileDamage",
  );
  const projectilePoolClasses = validatePoolClasses(
    ownData(options, "projectilePoolClasses", "run session projectilePoolClasses", true),
  );
  return Object.freeze({
    rawRunSeed: Object.freeze({domain: "raw-run-seed" as const, value: rawRunSeed as number}),
    grazeRadiusPx,
    projectileDamage,
    projectilePoolClasses,
  });
}

function validateStepInput(
  input: CanonicalRunSessionStepInput,
  currentTick120: number,
): ValidatedStepInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("run session step input must be an object");
  }
  const tick120 = requireSafeTick(
    ownData(input, "tick120", "run session step input.tick120", true),
    "run session step tick120",
  );
  if (tick120 !== currentTick120 + 1) {
    throw new Error(`canonical run session must advance one tick at a time: ${currentTick120} -> ${tick120}`);
  }
  const movement = freezeVec2(
    ownData(input, "movement", "run session step input.movement", true),
    "run session movement",
  );
  const magnitude = Math.hypot(movement.x, movement.y);
  if (magnitude > 1 + INPUT_MAGNITUDE_TOLERANCE) {
    throw new Error(`run session movement magnitude must not exceed one: ${magnitude}`);
  }
  const movementScale = magnitude > 1 ? 1 / magnitude : 1;
  const normalizedMovement = Object.freeze({
    x: movement.x * movementScale,
    y: movement.y * movementScale,
  });
  const signalActive = ownData(input, "signalActive", "run session step input.signalActive", true);
  if (typeof signalActive !== "boolean") throw new Error("run session signalActive must be boolean");
  const focused = ownData(input, "focused", "run session step input.focused", true);
  if (typeof focused !== "boolean") throw new Error("run session focused must be boolean");
  const gaze = validateGazeAuthoritySample(ownData(
    input,
    "gaze",
    "run session step input.gaze",
    true,
  ) as GazeAuthoritySample);
  const overridePressedValue = ownData(
    input,
    "overridePressed",
    "run session step input.overridePressed",
    false,
  );
  const overrideReleasedValue = ownData(
    input,
    "overrideReleased",
    "run session step input.overrideReleased",
    false,
  );
  if (overridePressedValue !== undefined && typeof overridePressedValue !== "boolean") {
    throw new Error("run session overridePressed must be boolean when present");
  }
  if (overrideReleasedValue !== undefined && typeof overrideReleasedValue !== "boolean") {
    throw new Error("run session overrideReleased must be boolean when present");
  }
  const overridePressed = overridePressedValue ?? false;
  const overrideReleased = overrideReleasedValue ?? false;
  if (overridePressed && overrideReleased) {
    throw new Error("Override press and release cannot share one sampled edge");
  }
  const overrideDirectionValue = ownData(
    input,
    "overrideDirection",
    "run session step input.overrideDirection",
    false,
  );
  let overrideDirection: Vec2 | null = null;
  if (overrideDirectionValue !== undefined) {
    overrideDirection = freezeVec2(overrideDirectionValue, "run session overrideDirection");
    if (Math.hypot(overrideDirection.x, overrideDirection.y) <= Number.EPSILON) {
      throw new Error("run session overrideDirection must be non-zero");
    }
  }
  if (overridePressed && overrideDirection === null) {
    throw new Error("Override press requires an explicit direction");
  }
  return Object.freeze({
    tick120,
    movement: normalizedMovement,
    signalActive,
    focused,
    gaze,
    overridePressed,
    overrideReleased,
    overrideDirection,
  });
}

function integratePlayerPosition(
  position: Vec2,
  input: ValidatedStepInput,
  focusEnabled: boolean,
): Vec2 {
  const speed = focusEnabled && input.focused
    ? PLAYER_FOCUS_MAX_SPEED_PX_PER_SECOND
    : PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND;
  return Object.freeze({
    x: Math.max(0, Math.min(LOGICAL_VIEW_WIDTH, position.x + input.movement.x * speed / TICKS_PER_SECOND)),
    y: Math.max(0, Math.min(LOGICAL_VIEW_HEIGHT, position.y + input.movement.y * speed / TICKS_PER_SECOND)),
  });
}

function signalIntensity(signalActive: boolean): number {
  return signalActive ? ACTIVE_SIGNAL_INTENSITY : INACTIVE_SIGNAL_INTENSITY;
}

function resolveFirstEyeSeed(rawRunSeed: number): CanonicalRunSessionSnapshot["firstEyeResolvedSeed"] {
  const patternBase = executablePattern(FIRST_EYE_PATTERN_ID).seed.base;
  return Object.freeze({
    domain: "resolved-occurrence-seed",
    value: (rawRunSeed ^ patternBase ^ 0 ^ FIRST_EYE_DIFFICULTY_SALT) >>> 0,
  });
}

/**
 * The manifest-backed, renderer-independent V4 prologue authority. The quiet
 * interval preserves absence; First Eye retains combat while the independent
 * gaze clamp/release barrier advances. The application-authored recovery delay
 * is isolated at the V4 narrative projection seam. EXT-005 consumes the typed
 * handoff with one explicit non-composer room bootstrap while retaining the
 * same run-scoped body, event bus, and occurrence ledger.
 */
export class CanonicalRunSession {
  readonly adapterPolicy = CANONICAL_RUN_SESSION_ADAPTER_POLICY;

  private readonly options: Readonly<CanonicalRunSessionOptions>;
  private readonly firstEyeResolvedSeed: CanonicalRunSessionSnapshot["firstEyeResolvedSeed"];
  private readonly bus = new CanonicalEventBus();
  private readonly flower = new FlowerIntensityAuthority(this.bus, {authorityId: "player-flower"});
  private readonly gaze = new GazeAuthority(this.bus);
  private readonly behaviorFacts: CanonicalRunBehaviorFactLedger;
  private preRoomBehaviorCaptureValue: CanonicalRunPreRoomBehaviorCapture | null = null;
  private phaseValue: CanonicalRunSessionPhase = "quiet_awakening";
  private currentTick120 = 0;
  private phaseStartTick120 = 0;
  private playerPosition: Vec2 = Object.freeze({x: LOGICAL_VIEW_WIDTH / 2, y: AUTHORED_PLAYER_Y});
  private focused = false;
  private playerDamage: CanonicalCombatSnapshot["player"] | null = null;
  private combatState: CanonicalRunCombatState | null = null;
  private combat: CanonicalCombatKernel | null = null;
  private latestCombatSnapshot: CanonicalCombatSnapshot | null = null;
  private roomSession: CanonicalRunRoomSession | null = null;
  private gazeClampCommittedAtTick120: number | null = null;
  private gazeClampReleasedAtTick120: number | null = null;
  private flowerRecoveryDueAtTick120: number | null = null;
  private flowerRecoveryCompletedAtTick120: number | null = null;
  private handoffReadyAtTick120: number | null = null;
  private handoffSourceCombat: CanonicalRunSessionHandoffSnapshot["sourceCombat"] = null;
  private meaningfulInputCountValue = 0;
  private signalInputCountValue = 0;
  private movementWasMeaningful = false;
  private signalWasActive = false;
  private fatalError: Error | null = null;
  private stepLocked = false;

  constructor(options: CanonicalRunSessionOptions) {
    this.options = validateOptions(options);
    this.firstEyeResolvedSeed = resolveFirstEyeSeed(this.options.rawRunSeed.value);
    this.flower.resolve({
      signalIntensity: INACTIVE_SIGNAL_INTENSITY,
      focusActive: false,
      gazeClampActive: false,
      overrideActive: false,
    }, 0);
    this.bus.flush();
    this.behaviorFacts = new CanonicalRunBehaviorFactLedger({
      rawRunSeed: this.options.rawRunSeed,
      baselineEvents: this.bus.committedEventsFrom(0),
    });
  }

  step(input: CanonicalRunSessionStepInput): CanonicalRunSessionSnapshot {
    if (this.stepLocked) throw new Error("canonical run session step is already in progress");
    this.stepLocked = true;
    try {
      this.assertOperational();
      // Rejected caller samples remain mutation-atomic and do not poison the
      // session. Any later failure is an internal cross-authority invariant
      // breach; the composite becomes permanently fail-stop so partial state
      // can never be resumed or observed through its public ports.
      const validated = validateStepInput(input, this.currentTick120);
      const ownerPhase: CanonicalRunBehaviorOwnerPhase = this.phaseValue;
      const eventCountBefore = this.bus.committedEventCount();
      try {
        if (this.phaseValue === "quiet_awakening") this.stepAwakening(validated);
        else if (this.phaseValue === "room_sampling") this.stepRoomSampling(validated);
        else this.stepFirstEye(validated);
        this.recordBehaviorFacts(ownerPhase, validated, eventCountBefore);
        this.capturePreRoomBehaviorFacts(ownerPhase);
        return this.snapshot();
      } catch (error) {
        this.fatalError = error instanceof Error ? error : new Error(String(error));
        throw error;
      }
    } finally {
      this.stepLocked = false;
    }
  }

  snapshot(): CanonicalRunSessionSnapshot {
    this.assertOperational();
    const gaze = this.gaze.snapshot();
    const roomSampling = this.roomSession?.snapshot() ?? null;
    const retainedCombat = this.phaseValue === "room_sampling"
      ? roomSampling?.combat ?? null
      : this.latestCombatSnapshot ?? this.combat?.snapshot() ?? null;
    const retainedRunCombat = this.combatState?.snapshot() ?? null;
    const combat = this.phaseValue === "quiet_awakening" ? null : retainedCombat;
    const playerInputEligible = this.playerDamage === null
      || playerInputEligibleAtTick(this.playerDamage, this.currentTick120);
    const inputEnabled = playerInputEligible;
    const handoffState = this.phaseValue === "quiet_awakening"
      ? "not_started"
      : this.handoffReadyAtTick120 !== null
        ? "ready_for_room_sampling"
        : this.flowerRecoveryDueAtTick120 !== null
          && this.flowerRecoveryCompletedAtTick120 === null
          ? "flower_recovery_delayed"
          : "awaiting_first_eye_barriers";
    return deepFreezeJson({
      authority: "canonical-run-session-v4",
      rawRunSeed: this.options.rawRunSeed,
      firstEyeResolvedSeed: this.firstEyeResolvedSeed,
      phase: this.phaseValue,
      tick120: this.currentTick120,
      segmentTick120: this.currentTick120 - this.phaseStartTick120,
      player: {
        position: this.playerPosition,
        focused: inputEnabled && this.focused,
        inputEnabled,
        flower: this.flower.snapshot(),
        meaningfulInputCount: this.meaningfulInputCountValue,
        signalInputCount: this.signalInputCountValue,
        damage: this.playerDamage,
      },
      gaze,
      combat,
      evidence: retainedRunCombat?.evidence ?? retainedCombat?.evidence ?? null,
      override: retainedRunCombat?.override ?? retainedCombat?.override ?? null,
      discovery: {
        signalFallbackVisible: this.phaseValue === "quiet_awakening"
          && this.currentTick120 >= SIGNAL_FALLBACK_TICKS
          && this.signalInputCountValue === 0,
      },
      handoff: {
        state: handoffState,
        targetNarrativeState: "ROOM_SAMPLING",
        ready: this.handoffReadyAtTick120 !== null,
        sourcePatternId: FIRST_EYE_PATTERN_ID,
        atTick120: this.handoffReadyAtTick120,
        consumed: roomSampling !== null,
        consumedAtTick120: roomSampling?.boundaryTicks120.start ?? null,
        consumerAuthority: roomSampling === null
          ? null
          : "ext-005-first-forced-room-bootstrap",
        barriers: {
          combatDrained: this.handoffSourceCombat !== null,
          gazeClampCommitted: this.gazeClampCommittedAtTick120 !== null,
          gazeClampReleased: this.gazeClampReleasedAtTick120 !== null,
          flowerRecoveryComplete: this.flowerRecoveryCompletedAtTick120 !== null,
          gazeTimedStateQuiescent: gaze.state === "idle" && gaze.deadlineTick120 === null,
        },
        recovery: {
          delayTicks120: FLOWER_RECOVERY_DELAY_TICKS120,
          dueAtTick120: this.flowerRecoveryDueAtTick120,
          completedAtTick120: this.flowerRecoveryCompletedAtTick120,
        },
        sourceCombat: this.handoffSourceCombat,
      },
      roomSampling,
      behaviorFacts: this.behaviorFacts.snapshot(),
      preRoomBehaviorCapture: this.preRoomBehaviorCaptureValue
        ?? CANONICAL_RUN_PRE_ROOM_BEHAVIOR_CAPTURE_MISSING,
      adapterPolicy: this.adapterPolicy,
    });
  }

  events(): readonly CanonicalGameplayEvent[] {
    this.assertOperational();
    return this.bus.events();
  }

  canonicalEventSerialization(): string {
    this.assertOperational();
    return this.bus.canonicalSerialization();
  }

  behaviorFactSerialization(): string {
    this.assertOperational();
    return this.behaviorFacts.canonicalSerialization();
  }

  private assertOperational(): void {
    if (this.fatalError === null) return;
    throw new Error(
      `canonical run session is faulted after an internal authority failure: ${this.fatalError.message}`,
      {cause: this.fatalError},
    );
  }

  private recordBehaviorFacts(
    ownerPhase: CanonicalRunBehaviorOwnerPhase,
    input: ValidatedStepInput,
    eventCountBefore: number,
  ): void {
    const sourceEventCount = this.bus.committedEventCount();
    if (eventCountBefore < 0 || eventCountBefore > sourceEventCount) {
      throw new Error("run behavior facts lost its canonical event cursor");
    }
    const canonicalEvents = this.bus.committedEventsFrom(eventCountBefore);
    const runCombat = this.combatState?.snapshot() ?? null;
    const ownerConsumesRunCombat = ownerPhase !== "quiet_awakening" && runCombat !== null;
    const roomId = ownerPhase === "room_sampling"
      ? this.roomSession?.snapshot().roomId ?? null
      : null;
    if (ownerPhase === "room_sampling" && roomId === null) {
      throw new Error("ROOM_SAMPLING behavior facts lost its current room context");
    }
    const inputEnabled = this.playerDamage === null
      || playerInputEligibleAtTick(this.playerDamage, this.currentTick120);
    this.behaviorFacts.recordAcceptedTick({
      ownerPhase,
      requested: {
        tick120: input.tick120,
        movement: input.movement,
        signalActive: input.signalActive,
        focused: input.focused,
        gaze: input.gaze,
        overridePressed: input.overridePressed,
        overrideReleased: input.overrideReleased,
        overrideDirection: input.overrideDirection,
      },
      committed: {
        player: {
          position: this.playerPosition,
          inputEnabled,
          focused: inputEnabled && this.focused,
          lifeState: this.playerDamage?.state ?? null,
        },
        flower: this.flower.snapshot(),
        gaze: this.gaze.snapshot(),
        override: ownerConsumesRunCombat ? runCombat.override : null,
        roomId,
        runCombatAvailable: ownerConsumesRunCombat,
        activeOccurrenceId: ownerConsumesRunCombat ? runCombat.activeOccurrenceId : null,
        canonicalEvents,
        sourceEventCount,
      },
    });
  }

  private capturePreRoomBehaviorFacts(ownerPhase: CanonicalRunBehaviorOwnerPhase): void {
    if (this.preRoomBehaviorCaptureValue !== null) return;
    if (ownerPhase !== "first_clamp_recovery" || this.phaseValue !== "room_sampling") return;
    const room = this.roomSession?.snapshot() ?? null;
    if (
      room === null
      || this.handoffReadyAtTick120 !== this.currentTick120
      || room.boundaryTicks120.start !== this.currentTick120
      || room.tick120 !== this.currentTick120
    ) {
      throw new Error("pre-room behavior capture lost the closed handoff boundary");
    }
    this.preRoomBehaviorCaptureValue = createCanonicalRunPreRoomBehaviorCapture({
      capturedAtTick120: this.currentTick120,
      sourceEventCount: this.bus.committedEventCount(),
      behaviorFacts: this.behaviorFacts.snapshot(),
    });
  }

  private recordAwakeningInput(input: ValidatedStepInput): void {
    const movementIsMeaningful = Math.hypot(input.movement.x, input.movement.y)
      > MEANINGFUL_MOVEMENT_THRESHOLD;
    const movementRose = movementIsMeaningful && !this.movementWasMeaningful;
    const signalRose = input.signalActive && !this.signalWasActive;
    // One sampled aggregate interaction is one meaningful fact even when a
    // device (notably one-finger touch) binds movement and signal together.
    // This keeps the narrative guard device-neutral without inspecting source.
    if (movementRose || signalRose) this.meaningfulInputCountValue += 1;
    if (signalRose) {
      this.signalInputCountValue += 1;
    }
    this.movementWasMeaningful = movementIsMeaningful;
    this.signalWasActive = input.signalActive;
  }

  private resolveFlower(
    input: ValidatedStepInput,
    focusEnabled: boolean,
    gazeClampActive: boolean,
    inputEligible = true,
  ): Readonly<FlowerIntensityResolution> {
    return this.flower.resolve({
      signalIntensity: signalIntensity(inputEligible && input.signalActive),
      focusActive: inputEligible && focusEnabled && input.focused,
      gazeClampActive,
      // LOCAL_RESISTANCE_AVAILABLE is outside this fragment.
      overrideActive: false,
    }, input.tick120);
  }

  private stepAwakening(input: ValidatedStepInput): void {
    this.recordAwakeningInput(input);
    this.resolveFlower(input, false, false);
    const nextPosition = integratePlayerPosition(this.playerPosition, input, false);
    const exitGuardSatisfied = input.tick120 >= AWAKENING_DURATION_TICKS
      && this.meaningfulInputCountValue >= AWAKENING_MEANINGFUL_INPUT_COUNT;
    if (!exitGuardSatisfied) {
      this.currentTick120 = input.tick120;
      this.playerPosition = nextPosition;
      this.focused = false;
      this.bus.flush();
      return;
    }
    const combatOptions = Object.freeze({
      patternId: FIRST_EYE_PATTERN_ID,
      occurrenceId: FIRST_EYE_OCCURRENCE_ID,
      seed: this.firstEyeResolvedSeed.value,
      startTick120: input.tick120,
      roomId: FIRST_EYE_ROOM_ID,
      difficulty: FIRST_EYE_DIFFICULTY,
      grazeRadiusPx: this.options.grazeRadiusPx,
      projectileDamage: this.options.projectileDamage,
      projectilePoolClasses: this.options.projectilePoolClasses,
      initialPlayerPosition: nextPosition,
    }) satisfies CanonicalCombatKernelOptions & {readonly initialPlayerPosition: Vec2};
    // Commit the transition sample before combat takes permanent exact-tick
    // flush ownership. Combat construction then closes this start tick even
    // when the transition emitted no Flower fact.
    this.bus.flush();
    const nextCombatState = new CanonicalRunCombatState({
      startTick120: input.tick120,
      initialPlayerPosition: nextPosition,
      grazeRadiusPx: this.options.grazeRadiusPx,
      projectileDamage: this.options.projectileDamage,
      projectilePoolClasses: this.options.projectilePoolClasses,
    }, this.bus);
    const nextCombat = new CanonicalCombatKernel(combatOptions, nextCombatState);
    const initialCombat = nextCombat.snapshot();
    if (
      initialCombat.tick120 !== input.tick120
      || initialCombat.relativeTick120 !== 0
      || initialCombat.playerPosition.x !== nextPosition.x
      || initialCombat.playerPosition.y !== nextPosition.y
    ) {
      throw new Error("first-eye combat authority did not preserve the awakening position handoff");
    }
    this.currentTick120 = input.tick120;
    this.phaseStartTick120 = input.tick120;
    this.playerPosition = nextPosition;
    // The transition sample still belongs to movement-and-signal AWAKENING;
    // Focus becomes authoritative on the following First Eye tick.
    this.focused = false;
    this.playerDamage = initialCombat.player;
    this.combatState = nextCombatState;
    this.combat = nextCombat;
    this.latestCombatSnapshot = initialCombat;
    this.phaseValue = "first_eye";
  }

  private stepFirstEye(input: ValidatedStepInput): void {
    const combat = this.combat;
    if (combat === null) throw new Error("First Eye lost its canonical combat authority");
    const combatState = this.combatState;
    if (combatState === null) throw new Error("First Eye lost its run-scoped combat state");
    const retainedPlayer = this.playerDamage ?? combat.snapshot().player;
    const inputEligible = playerInputEligibleAtTick(retainedPlayer, input.tick120);
    const eventsBefore = this.bus.committedEventCount();
    // Gaze is an independent caller-supplied perceptual relation. Player body
    // death gates movement/Focus/signal, but must never rewrite a qualified
    // sample into a synthetic release.
    const gazeAfter = this.gaze.observe(input.gaze, input.tick120);
    let recoveryResolution: Readonly<FlowerIntensityResolution> | null = null;
    const recoveryDue = this.flowerRecoveryDueAtTick120 !== null
      && this.flowerRecoveryCompletedAtTick120 === null
      && input.tick120 >= this.flowerRecoveryDueAtTick120;
    // A committed clamp retains the gaze-owned 0.1 band through release and
    // the explicit recovery delay. Normal V4 sources resume only at the due
    // tick; after an accepted recovery they continue resolving normally.
    if (
      this.gazeClampCommittedAtTick120 === null
      || gazeAfter.clampActive
      || this.flowerRecoveryCompletedAtTick120 !== null
    ) {
      this.resolveFlower(input, true, gazeAfter.clampActive, inputEligible);
    } else if (recoveryDue) {
      recoveryResolution = this.resolveFlower(input, true, false, inputEligible);
    }
    const combatInput = Object.freeze({
      tick120: input.tick120,
      movement: input.movement,
      focused: input.focused,
      // The kernel capability exists, but the Run has not reached the authored
      // LOCAL_RESISTANCE_AVAILABLE state, so these inputs have no authority.
      overridePressed: false,
      overrideReleased: false,
    });
    const activeOccurrenceId = combatState.snapshot().activeOccurrenceId;
    if (activeOccurrenceId !== null && activeOccurrenceId !== FIRST_EYE_OCCURRENCE_ID) {
      throw new Error(`First Eye lost occurrence ownership to ${activeOccurrenceId}`);
    }
    const occurrenceActive = activeOccurrenceId === FIRST_EYE_OCCURRENCE_ID;
    const combatSnapshot = occurrenceActive
      ? combat.step(combatInput)
      : this.latestCombatSnapshot;
    if (occurrenceActive) {
      this.latestCombatSnapshot = combatSnapshot;
    } else {
      combatState.stepIdle(combatInput, FIRST_EYE_ROOM_ID);
    }
    if (combatSnapshot === null) {
      throw new Error("First Eye released before retaining its final combat snapshot");
    }
    const committedEvents = this.bus.committedEventsFrom(eventsBefore);
    const clampCommit = committedEvents.find((event) => event.id === "gaze.clamp.commit");
    if (clampCommit !== undefined) {
      if (this.gazeClampCommittedAtTick120 === null) {
        this.gazeClampCommittedAtTick120 = clampCommit.tick120;
        if (this.phaseValue === "first_eye") {
          this.phaseValue = "first_clamp_recovery";
          this.phaseStartTick120 = clampCommit.tick120;
        }
      }
      if (this.handoffReadyAtTick120 === null) {
        this.gazeClampReleasedAtTick120 = null;
        this.flowerRecoveryDueAtTick120 = null;
        this.flowerRecoveryCompletedAtTick120 = null;
      }
    }
    const clampRelease = committedEvents.find((event) => event.id === "gaze.clamp.release");
    if (clampRelease !== undefined) {
      if (this.gazeClampReleasedAtTick120 === null) {
        this.gazeClampReleasedAtTick120 = clampRelease.tick120;
      }
      if (this.handoffReadyAtTick120 === null) {
        const dueAtTick120 = clampRelease.tick120 + FLOWER_RECOVERY_DELAY_TICKS120;
        if (!Number.isSafeInteger(dueAtTick120)) {
          throw new Error("Flower recovery deadline exceeds safe tick120 range");
        }
        this.flowerRecoveryDueAtTick120 = dueAtTick120;
        this.flowerRecoveryCompletedAtTick120 = null;
      }
    }
    if (recoveryResolution !== null) {
      const commits = committedEvents.filter((event) => event.id === "flower.intensity.commit");
      const commit = commits[0];
      if (
        commits.length !== 1
        || commit === undefined
        || commit.tick120 !== input.tick120
        || commit.payload.source !== recoveryResolution.source
        || commit.payload.targetIntensity !== recoveryResolution.targetIntensity
        || !(recoveryResolution.source === "focus" || recoveryResolution.source === "signal")
        || recoveryResolution.targetIntensity <= GAZE_AUTHORITY_CONTRACT.forcedIntensity
      ) {
        throw new Error("Flower recovery projection did not commit its V4 target band");
      }
      this.flowerRecoveryCompletedAtTick120 = input.tick120;
    }
    this.currentTick120 = input.tick120;
    const runCombatAfter = combatState.snapshot();
    this.playerPosition = runCombatAfter.playerPosition;
    this.focused = inputEligible && runCombatAfter.player.state === "alive" && input.focused;
    this.playerDamage = runCombatAfter.player;
    const runTimedStateQuiescent = runCombatAfter.player.recoveryAtTick120 === null
      && runCombatAfter.player.respawnPlaceAtTick120 === null
      && runCombatAfter.player.respawnCompleteAtTick120 === null
      && runCombatAfter.override.state === "idle"
      && runCombatAfter.override.deadlineTick120 === null;
    if (
      combatSnapshot.projectileLifecycleDrained
      && runTimedStateQuiescent
      && this.handoffSourceCombat === null
    ) {
      if (
        !combatSnapshot.patternComplete
        || !combatSnapshot.projectileLifecycleDrained
        || combatSnapshot.projectiles.length !== 0
        || combatSnapshot.poolUsage.liveColliders !== 0
        || combatSnapshot.poolUsage.residueVisuals !== 0
      ) {
        throw new Error("first-eye handoff claimed readiness before source combat drained");
      }
      this.handoffSourceCombat = Object.freeze({
        tick120: runCombatAfter.tick120,
        patternComplete: true,
        projectileLifecycleDrained: true,
        handoffReady: true,
        liveEntities: 0,
        liveColliders: 0,
      });
    }
    if (
      this.handoffReadyAtTick120 === null
      && this.handoffSourceCombat !== null
      && this.gazeClampCommittedAtTick120 !== null
      && this.gazeClampReleasedAtTick120 !== null
      && this.flowerRecoveryCompletedAtTick120 !== null
      && gazeAfter.state === "idle"
      && gazeAfter.deadlineTick120 === null
    ) {
      this.handoffReadyAtTick120 = input.tick120;
    }
    if (this.handoffReadyAtTick120 !== null && this.roomSession === null) {
      const handoff = this.snapshot().handoff;
      const roomSession = new CanonicalRunRoomSession({
        rawRunSeed: this.options.rawRunSeed,
        handoff,
        eventBus: this.bus,
        runState: combatState,
      });
      const room = roomSession.snapshot();
      if (
        room.tick120 !== input.tick120
        || room.phase !== "telegraph"
        || room.combat !== null
        || room.runCombat.tick120 !== input.tick120
      ) {
        throw new Error("ROOM_SAMPLING bootstrap did not install at the closed handoff tick");
      }
      this.roomSession = roomSession;
      this.combat = null;
      this.phaseValue = "room_sampling";
      this.phaseStartTick120 = input.tick120;
    }
  }

  private stepRoomSampling(input: ValidatedStepInput): void {
    const roomSession = this.roomSession;
    if (roomSession === null) throw new Error("ROOM_SAMPLING lost its fixed bootstrap authority");
    const combatState = this.combatState;
    if (combatState === null) throw new Error("ROOM_SAMPLING lost its shared run combat state");
    const before = combatState.snapshot();
    const inputEligible = playerInputEligibleAtTick(before.player, input.tick120);
    const gazeAfter = this.gaze.observe(input.gaze, input.tick120);
    this.resolveFlower(input, true, gazeAfter.clampActive, inputEligible);
    const room = roomSession.step(Object.freeze({
      tick120: input.tick120,
      movement: input.movement,
      focused: inputEligible && input.focused,
      // ROOM_SAMPLING precedes LOCAL_RESISTANCE_AVAILABLE. The browser may
      // retain an edge, but this owner cannot route it into gameplay yet.
      overridePressed: false,
      overrideReleased: false,
    }));
    if (room.tick120 !== input.tick120 || room.runCombat.tick120 !== input.tick120) {
      throw new Error("ROOM_SAMPLING bootstrap did not close exactly one master tick");
    }
    this.currentTick120 = input.tick120;
    this.playerPosition = room.runCombat.playerPosition;
    this.focused = room.runCombat.focused;
    this.playerDamage = room.runCombat.player;
    if (room.combat !== null) this.latestCombatSnapshot = room.combat;
  }
}
