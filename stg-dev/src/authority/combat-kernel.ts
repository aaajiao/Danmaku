import bossRigsJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/boss-rigs-v4.json";
import {SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS} from "./combat-pattern-capabilities";
import {validateMisregistrationCorridorPatternContract} from
  "./combat-patterns/misregistration-corridor";
import {
  assertExactDataContract,
  ownDenseDataArray,
  ownPlainDataRecord,
} from "./exact-data-contract";
import {
  AUTHORED_PLAYER_Y,
  LOGICAL_VIEW_HEIGHT,
  LOGICAL_VIEW_WIDTH,
  Mulberry32,
  EXECUTABLE_PATTERN_MANIFEST,
  PLAYER_FOCUS_MAX_SPEED_PX_PER_SECOND,
  PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND,
  createPatternSchedule,
  executablePattern,
  geometryCandidates,
  roundPatternCount,
  safeGapCenter,
  safeGapWidth,
  type ExecutablePattern,
  type PatternDifficulty,
  type PatternEmitter,
  type PatternMotion,
} from "./pattern-executor";
import {
  CanonicalEventBus,
  isExactCanonicalEventBus,
  type CanonicalEventBatchReceipt,
  type CanonicalEventBusTickFlushAuthority,
  type CanonicalGameplayEvent,
} from "./events";
import {
  BossPhaseAuthority,
  V4_ENCOUNTER_CATALOG,
  isExactBossPhaseAuthority,
  type BossAuthoritySnapshot,
} from "./encounters";
import {
  LaserAuthority,
  compileLaserGeometry,
  isExactLaserAuthority,
  millisecondsToAuthorityTicks,
  type LaserGeometrySnapshot,
  type LaserLifecycleSnapshot,
} from "./lasers";
import {
  PLAYER_FOCUS_COLLISION_RADIUS_PX,
  PLAYER_NORMAL_COLLISION_RADIUS_PX,
  PROJECTILE_POOL_BUDGETS,
  ProjectileAuthorityPool,
  sweepCircleAgainstCircle,
  type SweepHit,
  type ProjectileHandle,
  type PreparedProjectileCollisionBatch,
  type ProjectileFlightCollisionChange,
  type ProjectilePoolBudgets,
  type ProjectilePoolClass,
  type ProjectilePoolAuditRecord,
  type ProjectilePoolUsage,
  type ProjectileSnapshot,
  type Vec2,
} from "./projectiles";
import {
  DirectionalOverrideAuthority,
  EvidenceAuthority,
  GrazeEvidenceAuthority,
  PlayerDamageAuthority,
  V4_PLAYER_AUTHORITY_CONTRACT,
  inspectPreparedPlayerCollisionBlockerMutation,
  playerInputEligibleAtTick,
  type CollisionBlockerLease,
  type DirectionalOverrideSnapshot,
  type DamageBatchResult,
  type EvidenceSnapshot,
  type OverrideProjectilePath,
  type PreparedPlayerCollisionBlockerMutation,
  type PreparedPlayerCollisionBlockerMutationView,
  type PlayerDamageSnapshot,
} from "./player";
import {
  RoomTransitionAuthority,
  isExactRoomTransitionAuthority,
  type PreparedRoomTransitionMutation,
  type PreparedRoomTransitionMutationView,
  type RoomTransitionAuthoritySnapshot,
} from "./room-transition";
import {
  assertCanonicalRunFirstContinuationRoomTransitionReceiptOwner,
  cancelCanonicalRunFirstContinuationRoomTransitionReceipt,
  commitCanonicalRunFirstContinuationRoomTransitionReceipt,
  firstContinuationRoomTargetFromCanonicalTransitionReceipt,
  quarantineCanonicalRunFirstContinuationRoomTransitionReceipt,
  type CanonicalRunFirstContinuationRoomTargetAvailable,
  type CanonicalRunFirstContinuationRoomTransitionReceipt,
} from "./run-first-continuation-room-target";
import {
  evaluateCanonicalRunFirstContinuationCombinedPoolAdmissionUnbranded,
  type CanonicalRunFirstContinuationCombinedPoolAdmissionEvaluation,
} from "./run/chapters/first-continuation-room-admission";
import {
  deriveCanonicalRunFirstContinuationRoomPlanUnbranded,
  type CanonicalRunFirstContinuationRoomPlanPayload,
  type CanonicalRunFirstContinuationRoomPlanSourceView,
} from "./run/chapters/first-continuation-room-plan";
import {deriveCanonicalRunFirstContinuationRoomPlanSourceUnbranded} from
  "./run/chapters/first-continuation-room-plan-source";
import {TICKS_PER_SECOND, crossedTickCount} from "./tick120";

export {crossedTickCount} from "./tick120";
export {SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS} from "./combat-pattern-capabilities";
// Direct-kernel capabilities only: live-run admission intentionally consumes
// the exported list above and must not infer these isolated slices.
const ISOLATED_CANONICAL_COMBAT_PATTERN_IDS = Object.freeze([
  "encounter.weather_echo.ash_memory",
  "room.in_between.stable_intersection",
  "room.polarized.clock_decree",
  "room.polarized.no_dusk_grid",
  "transition.room_threshold",
] as const);
export type CanonicalCombatPatternId =
  | typeof SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS[number]
  | typeof ISOLATED_CANONICAL_COMBAT_PATTERN_IDS[number];
const DEFAULT_PATTERN_ID: CanonicalCombatPatternId = "common.eye_acquisition";
const SUPPORTED_PATTERN_SET: ReadonlySet<string> = new Set([
  ...SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS,
  ...ISOLATED_CANONICAL_COMBAT_PATTERN_IDS,
]);
const SUPPORTED_OPERATOR_SET: ReadonlySet<string> = new Set([
  "op.aim_lock",
  "op.dual_clock_gate",
  "op.history_replay",
  "op.lateral_wall",
  "op.limited_homing",
  "op.linear",
  "op.local_vector_bias",
  "op.orbit_release",
  "op.speed_envelope",
  "op.seam_transform",
  "op.turn_once",
]);
const SUPPORTED_OPERATOR_SIGNATURES: ReadonlySet<string> = new Set([
  "op.linear",
  "op.dual_clock_gate>op.linear",
  "op.linear>op.seam_transform",
  "op.linear>op.turn_once",
  "op.lateral_wall>op.linear",
  "op.lateral_wall>op.speed_envelope>op.linear",
  "op.linear>op.speed_envelope",
  "op.lateral_wall>op.local_vector_bias>op.linear",
  "op.local_vector_bias>op.linear",
  "op.speed_envelope>op.linear",
  "op.speed_envelope>op.turn_once>op.linear",
  "op.history_replay",
  "op.aim_lock>op.linear",
  "op.aim_lock>op.limited_homing>op.linear",
  "op.orbit_release>op.linear",
]);
const SUPPORTED_GEOMETRY_SET: ReadonlySet<string> = new Set([
  "arc",
  "fan",
  "grid",
  "line",
  "paired_fan",
  "ring",
  "wall",
]);
const SUPPORTED_SAFE_GAP_ENFORCEMENT_SET: ReadonlySet<string> = new Set([
  "angular_omission",
  "lane_omission",
  "operator_constraint",
  "phase_gate",
  "rule_clip_with_residue",
  "seam_redirect",
  "spawn_omission",
]);
const CANONICAL_PROJECTILE_ARCHETYPE_SET: ReadonlySet<string> = new Set(
  EXECUTABLE_PATTERN_MANIFEST.patterns.flatMap((pattern) =>
    pattern.emitters.map((emitter) => emitter.projectile.archetype)),
);
const INPUT_MAGNITUDE_TOLERANCE = 1e-9;

interface CombatPattern extends ExecutablePattern {
  readonly category: "COMMON" | "ROOM" | "BOSS" | "WEATHER_ECHO" | "TRANSITION";
  readonly room: string;
  readonly clock: {
    readonly authority: string;
    readonly tickHz: number;
    readonly eventDispatch: string;
    readonly pausePolicy: string;
    readonly visualClockSeparated: boolean;
  };
  readonly seed: ExecutablePattern["seed"] & {
    readonly algorithm: string;
    readonly composition: string;
    readonly randomCalls: string;
    readonly disallowedInputs?: readonly string[];
  };
  readonly cancel: {
    readonly triggers: readonly string[];
    readonly mode: string;
    readonly collisionOffBeforeVisual: boolean;
    readonly eventIdempotent: boolean;
  };
  readonly residue: {
    readonly type: string;
    readonly lifetimeMs: number;
    readonly inheritsSourceId: boolean;
    readonly gameplayCollision: boolean;
  };
  readonly safeGap: ExecutablePattern["safeGap"] & {
    readonly compileRule: string;
    readonly path: ExecutablePattern["safeGap"]["path"] & {
      readonly maxTravelPxPerSec: number;
    };
  };
  readonly laserGeometry?: string;
  readonly resolutionHook?: unknown;
  readonly weatherEchoContract?: {
    readonly visualSource: string;
    readonly schedulingAuthority: string;
    readonly runsParallelToWeather: boolean;
    readonly weatherEventCanTrigger: boolean;
    readonly weatherEventCanSpawnProjectile: boolean;
    readonly weatherEventCanAlterMotion: boolean;
    readonly weatherEventCanAlterCollision: boolean;
    readonly weatherEventCanAlterSafeGap: boolean;
    readonly weatherRngUsed: boolean;
    readonly seedAuthority: string;
  };
}

interface BossRigPhaseContract {
  readonly id: string;
  readonly patternId: string;
  readonly entryCondition: string;
  readonly exitCondition: string;
  readonly laserGeometry: string | null;
  readonly spatialLaw: string;
}

interface BossRigContract {
  readonly id: string;
  readonly room: string;
  readonly phases: readonly BossRigPhaseContract[];
}

interface BossRigManifestContract {
  readonly schemaVersion: string;
  readonly rigs: readonly BossRigContract[];
}

interface OrbitReleaseContract {
  readonly radiusPx: number;
  readonly angularDegPerSec: number;
  readonly releaseAtMs: number;
  readonly releaseHeadingDeg: number;
}

interface RuntimeProjectile {
  readonly handle: ProjectileHandle;
  readonly sourceId: string;
  readonly sourceIndex: number;
  readonly burstIndex: number;
  readonly spawnTick120: number;
  readonly authoredSpawnMs: number;
  readonly motion: readonly PatternMotion[];
  readonly historyReplay: HistoryReplayContract | undefined;
  readonly authoredSpawnOrdinal: number;
  position: Vec2;
  previousPosition: Vec2;
  headingDegrees: number;
  readonly speedCurve: SpeedCurveContract;
  readonly speedMultiplier: number;
  readonly localVectorBias: LocalVectorBiasContract | undefined;
  readonly dualClockGate: DualClockGateContract | undefined;
  readonly orbitRelease: OrbitReleaseContract | undefined;
  readonly orbitOrigin: Vec2;
  readonly orbitPhaseRadians: number;
  orbitStarted: boolean;
  dualClockActive: boolean;
  /** Last resolved flight-motion speed; collisionless arm retains the age-zero sample. */
  speedPxPerSecond: number;
  collisionEnabledAtTick120: number | null;
  desiredCollisionEnabled: boolean | null;
  desiredCollisionReason: "dual_clock_gate" | "phase_gate" | null;
  aimLocked: boolean;
  turnApplied: boolean;
  seamTransformed: boolean;
  nextHomingSample: number;
  movementSegmentsAtTick120: number | null;
  movementSegments: readonly KinematicMotionSegment[];
}

interface RuntimeCollisionGateBatch {
  readonly prepared: PreparedProjectileCollisionBatch;
  readonly enabledRuntimes: readonly RuntimeProjectile[];
}

export interface CanonicalCombatKernelOptions {
  readonly patternId?: string;
  /**
   * Run-scoped occurrence identity. Standalone kernels retain their historical
   * pattern-scoped identity; a shared run combat state requires this field.
   */
  readonly occurrenceId?: string;
  /** Fully resolved V4 encounter seed; no undocumented difficulty salt is inferred here. */
  readonly seed: number;
  readonly startTick120: number;
  readonly roomId: string;
  readonly difficulty: PatternDifficulty;
  /** Run-scoped authority handoff; defaults to the V4 authored player band center. */
  readonly initialPlayerPosition?: Vec2;
  /** Adapter gap: V4 defines graze identity, but not the near-miss radius. */
  readonly grazeRadiusPx: number;
  /** Adapter gap: V4 projectile lifecycle does not declare a universal damage amount. */
  readonly projectileDamage: number;
  /** Adapter gap: V4 budgets pool classes but does not map archetype IDs to them. */
  readonly projectilePoolClasses: Readonly<Record<string, ProjectilePoolClass>>;
}

export interface CanonicalCombatStepInput {
  readonly tick120: number;
  /** Normalized authority input; the kernel, not presentation, integrates position. */
  readonly movement: Vec2;
  readonly focused: boolean;
  readonly overridePressed?: boolean;
  readonly overrideReleased?: boolean;
  readonly overrideDirection?: Vec2;
}

export interface CombatProjectileSnapshot extends ProjectileSnapshot {
  readonly sourceId: string;
  readonly sourceIndex: number;
  readonly burstIndex: number;
  readonly headingDegrees: number;
  readonly speedPxPerSecond: number;
}

export interface CanonicalCombatSnapshot {
  readonly authority: "canonical-combat-v4";
  readonly patternId: CanonicalCombatPatternId;
  readonly occurrenceId: string;
  readonly seed: number;
  readonly difficulty: PatternDifficulty;
  readonly startTick120: number;
  readonly tick120: number;
  readonly relativeTick120: number;
  readonly patternComplete: boolean;
  /** Pattern-local digital bodies are gone; collisionless residue may remain. */
  readonly digitalBodiesDrained: boolean;
  /** Collisionless material residue remains after the digital bodies drain. */
  readonly materialResidueDraining: boolean;
  readonly projectileLifecycleDrained: boolean;
  /** Run-owned player/Override timers are quiescent at this exact tick. */
  readonly runTimedStateQuiescent: boolean;
  /** True only after projectiles drain and every owned timed FSM is quiescent. */
  readonly handoffReady: boolean;
  /** Audit fact for the manifest-declared single RNG stream. */
  readonly rngCallsConsumed: number;
  readonly playerPosition: Vec2;
  readonly player: PlayerDamageSnapshot;
  readonly evidence: EvidenceSnapshot;
  readonly override: DirectionalOverrideSnapshot;
  readonly projectiles: readonly CombatProjectileSnapshot[];
  readonly poolUsage: ProjectilePoolUsage;
  readonly lastDamageBatch: DamageBatchResult | null;
  readonly adapterGaps: Readonly<{
    grazeRadiusPx: number;
    projectileDamage: number;
    projectilePoolClasses: Readonly<Record<string, ProjectilePoolClass>>;
    targetHistorySampling: "exact-crossed-tick120";
    positiveAimLeadPolicy: "last-authoritative-segment-linear-extrapolation";
    lateralWallLaneProjection: "candidate-center-into-left-to-right-lane-bins";
    rainLaneOmission?: Readonly<{
      order: "geometry-source-index>rng-jitter>swept-preflight>entity-spawn";
      preflight: "shared-fixed-tick-local-vector-corridor-sweep";
      spawnIdentity: "assigned-only-after-preflight-pass";
      residue: "omitted-candidates-have-no-entity-or-residue";
    }>;
    ashMemoryHistoryReplay?: Readonly<{
      candidateIdentity: "all-authored-candidates-retain-rng-and-entity-identity";
      spawnOrdinal: "occurrence-local-emitter-burst-source-order-starting-at-one";
      armPolicy: "anchor-spawn-then-first-flight-tick-sweeps-to-reversed-path-head";
      replayClock: "authored-spawn-age-with-delay-held-at-reversed-path-head";
      pathSweep: "absolute-polyline-split-at-authored-vertices";
      crossSideEntry: "safe-prefix-plus-disconnected-snapped-endpoint-no-interior-contact";
      redirectPolicy: "absolute-replay-before-repeatable-operator-constraint";
      releasePolicy: "first-fixed-tick-after-replay-end-continues-at-owned-heading-and-speed";
      weatherAuthority: "withheld-no-weather-event-seed-rng-motion-collision-or-gap-input";
      admission: "isolated-kernel-no-director-session-renderer-or-default-run";
    }>;
    alternatingVerdictAngularOmission?: Readonly<{
      order:
        "geometry-source-index>one-rng-jitter>full-declaration-order-swept-preflight>entity-spawn";
      crossedTurnTick: "old-heading-sweep>zero-time-turn>new-heading-next-tick";
      spawnIdentity: "assigned-only-after-preflight-pass";
      residue: "omitted-candidates-have-no-events-or-residue";
      runtimeViolation: "fail-stop-never-source-withdrawn";
    }>;
    misregistrationOrbitRelease?: Readonly<{
      order:
        "geometry-source-index>one-rng-jitter>full-orbit-release-swept-preflight>entity-spawn";
      phasePolicy: "ext-018-one-candidate-draw-times-tau";
      referenceDivergence: "qa-golden-ordinal-phase-remains-reference-only";
      releasePolicy: "exact-release-boundary>authored-absolute-heading>linear-remainder";
      armPolicy: "anchor-spawn>first-live-tick-radial-to-orbit-sweep";
      spawnIdentity: "assigned-only-after-preflight-pass";
      residue: "omitted-candidates-have-no-events-or-residue";
      runtimeViolation: "fail-stop-never-source-withdrawn";
    }>;
    seamTopology?: Readonly<{
      crossing: "inclusive-arrival-or-departure-first-crossing-per-generation";
      transformSweep: "linear-sweep-then-mirror-discontinuity-sweep";
      corridorEntry: "analytic-relative-sine-extrema-then-bisection";
      redirectedContact: "safe-prefix-then-curvature-bounded-boundary-chord";
      oraclePolicy: "python-endpoint-edge-snap-plus-signed-eight-degrees";
    }>;
    offsetSeamTopology?: Readonly<{
      crossing: "inclusive-arrival-or-departure-first-crossing-per-generation";
      transformSweep: "linear-sweep-then-signed-offset-discontinuity-sweep";
      headingPolicy: "preserved-across-offset";
      contactAndOverridePaths: "both-linear-and-discontinuity-segments";
      resolutionHook: "validated-inert-no-automatic-completion";
      realScarEvidence: "separate-directional-override-authority";
      sameTickTerminalPriority: "rule-clip-before-override-no-double-terminal-no-linked-scar";
    }>;
    contextConstraint?: Readonly<{
      candidateIdentity: "all-authored-candidates-retain-rng-and-entity-identity";
      declarationOrder: "motion-stack-literal-before-operator-constraint";
      corridorEntry: "analytic-relative-sine-extrema-then-bisection";
      redirectedContact: "safe-prefix-then-curvature-bounded-boundary-chord";
      oraclePolicy: "python-endpoint-edge-snap-plus-signed-eight-degrees";
      completeTickTie: "spawn-then-pattern-end-residue-under-canonical-phase-order";
    }>;
    oneSunOneRuleConstraint?: Readonly<{
      candidateIdentity: "all-authored-candidates-retain-rng-and-entity-identity";
      declarationOrder: "turn-on-crossed-tick>linear-sweep>operator-constraint";
      observeBinding: "exact-observe-phase-with-null-laser";
      laserAuthority: "inactive-through-phase1";
      phaseExitAndResolution: "withheld-no-evaluator-no-terminal-events";
      oraclePolicy: "python-endpoint-edge-snap-plus-signed-eight-degrees";
    }>;
    ballotPhaseGate?: Readonly<{
      candidateIdentity: "all-authored-candidates-retain-rng-and-entity-identity";
      clockIdentity: "pattern-relative-integer-tick120";
      effectiveGate: "dual-clock-xor-plus-continuous-lane-collision-mask";
      clockInactiveBehavior: "same-generation-speed-zero-and-collision-off";
      clockOpenBoundary: "collision-on-at-crossed-tick;motion-and-contact-next-tick";
      phaseGapBehavior: "same-generation-motion-retained-collision-off";
      collisionLease: "reversible-entity-owned-canonical-events";
      overridePolicy: "masked-digital-body-remains-cancellable";
      completeTickTie: "pattern-end-cancels-before-same-tick-arm";
    }>;
    clockDecreePhaseGate?: Readonly<{
      candidateIdentity: "all-authored-candidates-retain-rng-and-entity-identity";
      clockIdentity: "pattern-relative-integer-tick120";
      effectiveGate: "dual-clock-xor-plus-continuous-quantized-triangle-collision-mask";
      quantizedPathSweep: "exact-cusp-segmented-linear";
      clockInactiveBehavior: "same-generation-speed-zero-and-collision-off";
      clockOpenBoundary: "collision-on-at-crossed-tick;motion-and-contact-next-tick";
      phaseGapBehavior: "same-generation-motion-retained-collision-off";
      collisionLease: "reversible-entity-owned-canonical-events";
      easyLateBurst: "cadence-owned-after-emit-end-then-pattern-end-cancelled";
      completeTickTie: "pattern-end-cancels-live-identities-before-gate-update";
    }>;
    noDuskGridPhaseGate?: Readonly<{
      candidateIdentity: "all-authored-candidates-retain-rng-and-entity-identity";
      clockIdentity: "pattern-relative-integer-tick120";
      effectiveGate: "emitter-owned-dual-clock-xor-plus-continuous-binary-cross-collision-mask";
      binaryCrossSweep: "exact-cusp-segmented-linear";
      clockInactiveBehavior: "same-generation-speed-zero-and-collision-off";
      clockOpenBoundary: "collision-on-at-crossed-tick;motion-and-contact-next-tick";
      phaseGapBehavior: "same-generation-motion-retained-collision-off";
      collisionLease: "reversible-entity-owned-canonical-events";
      easyLateBurst: "cadence-owned-after-emit-end-and-residue-marker";
      resolutionHook: "validated-inert-no-automatic-completion";
      completeTickTie: "pattern-end-cancels-live-identities-before-gate-update";
    }>;
    stableIntersectionPhaseGate?: Readonly<{
      candidateIdentity: "all-authored-candidates-retain-rng-and-entity-identity";
      clockIdentity: "pattern-relative-integer-tick120";
      effectiveGate: "dual-clock-xor-plus-both-open-intersection-plus-continuous-sine-collision-mask";
      intersectionRule: "python-oracle-a-or-b-from-xor-plus-both-open";
      corridorSweep: "analytic-relative-sine-extrema-then-bisection";
      clockInactiveBehavior: "same-generation-speed-zero-and-collision-off";
      clockOpenBoundary: "collision-on-at-crossed-tick;motion-and-contact-next-tick";
      phaseGapBehavior: "same-generation-motion-retained-collision-off";
      collisionLease: "reversible-entity-owned-canonical-events";
      resolutionHook: "validated-inert-no-metric-or-room-completion";
      roomAuthority: "withheld-no-composer-session-handoff-renderer-or-default-run";
      completeTickTie: "pattern-end-cancels-live-identities-before-gate-update";
    }>;
    roomThresholdPhaseGate?: Readonly<{
      candidateIdentity: "all-authored-candidates-retain-rng-and-entity-identity";
      declarationOrder: "speed-envelope>linear>continuous-threshold-bridge-collision-mask";
      thresholdBridgeSweep: "analytic-relative-sine-extrema-then-bisection";
      phaseGapBehavior: "same-generation-motion-retained-collision-off";
      collisionLease: "reversible-entity-owned-canonical-events";
      transitionAuthority:
        | "withheld-no-room-transition-composer-session-renderer-or-room-completion"
        | "ext-013-prepared-atomic-fsm-and-material-carryover";
      completeTickTie: "pattern-end-cancels-live-identities-before-mask-update";
    }>;
    provenance: "application-required-v4-omission";
  }>;
}

export interface CanonicalMisreaderEnforceEntryOptions {
  /** One-use run identity; this fragment does not infer room or scheduler ordinals. */
  readonly occurrenceId: string;
  /** Caller-authorized exact `observe.exit -> enforce.enter` master tick. */
  readonly phaseEntryTick120: number;
  /** Explicit caller assertion; this fragment does not implement the missing phase-evidence evaluator. */
  readonly phaseExitAuthorization: "caller-validated:misreader.evidence>=1";
}

export interface CanonicalMisreaderEnforceEntrySnapshot {
  readonly authority: "misreader-enforce-entry-laser-v4-adapter";
  readonly occurrenceId: string;
  readonly phaseEntryTick120: number;
  readonly tick120: number;
  readonly relativeTick120: number;
  readonly playerPosition: Vec2;
  readonly focused: boolean;
  readonly player: PlayerDamageSnapshot;
  readonly evidence: EvidenceSnapshot;
  readonly override: DirectionalOverrideSnapshot;
  readonly boss: BossAuthoritySnapshot;
  readonly laser: LaserLifecycleSnapshot;
  readonly geometry: LaserGeometrySnapshot | null;
  /** Collision is enabled at +151; the first non-zero swept interval ends at +152. */
  readonly firstContactEligibleTick120: number;
  /** This bounded adapter authorizes at most one contact attempt per laser generation. */
  readonly contactAttemptTick120: number | null;
  readonly lastDamageBatch: DamageBatchResult | null;
  readonly collisionBodyDrained: boolean;
  readonly materialResidueDraining: boolean;
  readonly laserLifecycleDrained: boolean;
  readonly runTimedStateQuiescent: boolean;
  /** The full phase-2 projectile plan is intentionally not executed by this fragment. */
  readonly fullAttackPlanExecuted: false;
  readonly adapterPolicy: Readonly<{
    readonly laserStartsPerEntry: 1;
    readonly repeatCadence: null;
    readonly contactEntryBoundary: "first-post-collision-on-interval";
    readonly contactAttemptsPerGeneration: 1;
    readonly contactTerminalEffect: "player-damage-only-laser-remains-live";
    readonly overrideLaserCancellation: "withheld-no-authored-single-scar-coordinate";
    readonly capsuleCount: 16;
    readonly capsuleCountAuthority: "deterministic-adaptive-flattening-adapter";
    readonly difficultyProjection: "laser-trace-invariant";
    readonly phaseEvidenceEvaluator: null;
    readonly phaseExitAuthorization: "caller-validated:misreader.evidence>=1";
    readonly provenance: "application-required-v4-omission";
  }>;
}

export interface CanonicalRunCombatStateOptions {
  readonly startTick120: number;
  readonly initialPlayerPosition: Vec2;
  /** Adapter gap: V4 defines graze identity, but not the near-miss radius. */
  readonly grazeRadiusPx: number;
  /** Adapter gap: V4 projectile lifecycle does not declare a universal damage amount. */
  readonly projectileDamage: number;
  /** Run-fixed archetype-to-pool projection; pattern engines consume exact subsets. */
  readonly projectilePoolClasses: Readonly<Record<string, ProjectilePoolClass>>;
}

export interface CanonicalRunCombatStateSnapshot {
  readonly authority: "canonical-run-combat-v4";
  readonly tick120: number;
  readonly playerPosition: Vec2;
  readonly focused: boolean;
  readonly player: PlayerDamageSnapshot;
  readonly evidence: EvidenceSnapshot;
  readonly override: DirectionalOverrideSnapshot;
  readonly activeOccurrenceId: string | null;
  readonly pendingFlushTick120: number | null;
  readonly claimedOccurrenceIds: readonly string[];
  readonly faulted: boolean;
  readonly adapterPolicy: Readonly<{
    readonly grazeRadiusPx: number;
    readonly projectileDamage: number;
    readonly projectilePoolClasses: Readonly<Record<string, ProjectilePoolClass>>;
    readonly occurrenceIdentity: "utf8-length-prefixed";
    readonly concurrency: "single-spawning-occurrence";
    readonly flushOwner: "run-combat-state";
    readonly provenance: "application-required-v4-omission";
  }>;
}

interface RunCombatStateInternals {
  readonly bus: CanonicalEventBus;
  readonly tickFlushAuthority: CanonicalEventBusTickFlushAuthority;
  readonly player: PlayerDamageAuthority;
  readonly evidence: EvidenceAuthority;
  readonly graze: GrazeEvidenceAuthority;
  readonly override: DirectionalOverrideAuthority;
  readonly adapterPolicy: CanonicalRunCombatStateSnapshot["adapterPolicy"];
  readonly claimedOccurrenceIds: Set<string>;
  currentTick120: number;
  currentPlayerPosition: Vec2;
  previousPlayerPosition: Vec2 | null;
  focused: boolean;
  activeOccurrenceId: string | null;
  pendingReleaseOccurrenceId: string | null;
  pendingFlushTick120: number | null;
  advanceLocked: boolean;
  fault: Error | null;
}

const RUN_COMBAT_STATE_INTERNALS = new WeakMap<CanonicalRunCombatState, RunCombatStateInternals>();

const FIRST_CONTINUATION_ROOM_THRESHOLD_PATTERN_ID = "transition.room_threshold" as const;
const FIRST_CONTINUATION_ROOM_THRESHOLD_OCCURRENCE_ID =
  "run:room:0-to-1:transition:transition.room_threshold" as const;
const ROOM_THRESHOLD_SEED_BASE = 577_557_179;
const FIRST_CONTINUATION_ROOM_THRESHOLD_TARGETS = Object.freeze([
  "INFORMATION",
  "IN_BETWEEN",
  "POLARIZED",
] as const);

export type CanonicalRunRoomThresholdTargetRoom =
  typeof FIRST_CONTINUATION_ROOM_THRESHOLD_TARGETS[number];

declare const preparedRunRoomThresholdStartBrand: unique symbol;

/** Opaque, one-use next-tick install proposal for EXT-013's exact pattern. */
export interface PreparedCanonicalRunRoomThresholdStart {
  readonly [preparedRunRoomThresholdStartBrand]: "PreparedCanonicalRunRoomThresholdStart";
}

export interface PreparedCanonicalRunRoomThresholdStartView {
  readonly authority: "canonical-run-room-threshold-start-v1";
  readonly tick120: number;
  readonly occurrenceId: "run:room:0-to-1:transition:transition.room_threshold";
  readonly patternId: "transition.room_threshold";
  readonly rawRunSeed: number;
  readonly transitionEncounterOrdinal: 0;
  readonly transitionDifficultySalt: 0;
  readonly resolvedSeed: number;
  readonly targetRoom: CanonicalRunRoomThresholdTargetRoom;
  readonly playerLease: CollisionBlockerLease;
  readonly eventIds: readonly ["player.collision.off", "room.transition.begin"];
  readonly playerPreview: PlayerDamageSnapshot;
  readonly roomTransitionPreview: RoomTransitionAuthoritySnapshot;
  readonly playerPosition: Vec2;
  readonly focused: boolean;
}

export interface CanonicalRunRoomThresholdStartResult {
  readonly kernel: CanonicalCombatKernel;
  readonly collisionLease: CollisionBlockerLease;
  readonly runCombat: CanonicalRunCombatStateSnapshot;
  readonly combat: CanonicalCombatSnapshot;
  readonly roomTransition: RoomTransitionAuthoritySnapshot;
  readonly successorTransferCapability:
    CanonicalRunFirstContinuationDormantSuccessorTransferCapability;
}

interface PreparedRunRoomThresholdStartRecord {
  readonly runState: CanonicalRunCombatState;
  readonly transitionReceipt: CanonicalRunFirstContinuationRoomTransitionReceipt;
  readonly formalTarget: CanonicalRunFirstContinuationRoomTargetAvailable;
  readonly playerProposal: PreparedPlayerCollisionBlockerMutation;
  readonly playerView: PreparedPlayerCollisionBlockerMutationView;
  readonly roomTransition: RoomTransitionAuthority;
  readonly roomTransitionProposal: PreparedRoomTransitionMutation;
  readonly roomTransitionView: PreparedRoomTransitionMutationView;
  readonly roomTransitionBefore: RoomTransitionAuthoritySnapshot;
  readonly kernel: CanonicalCombatKernel;
  readonly beforeTick120: number;
  readonly beforePlayerPosition: Vec2;
  readonly beforeFocused: boolean;
  readonly validated: ValidatedCombatStepInput;
  readonly view: PreparedCanonicalRunRoomThresholdStartView;
  status: "prepared" | "applied" | "failed";
}

const PREPARED_RUN_ROOM_THRESHOLD_STARTS = new WeakMap<
  PreparedCanonicalRunRoomThresholdStart,
  PreparedRunRoomThresholdStartRecord
>();
const ACTIVE_RUN_ROOM_THRESHOLD_START_BY_TRANSITION_RECEIPT = new WeakMap<
  CanonicalRunFirstContinuationRoomTransitionReceipt,
  PreparedCanonicalRunRoomThresholdStart
>();
const DEFERRED_ROOM_THRESHOLD_INSTALL = Symbol("deferred-room-threshold-install");
const DEFERRED_FIRST_CONTINUATION_READ_INSTALL = Symbol(
  "deferred-first-continuation-read-install",
);
const SEALED_ROOM_THRESHOLD_ADVANCE = Symbol("sealed-room-threshold-advance");
const SEALED_FIRST_CONTINUATION_READ_ADVANCE = Symbol(
  "sealed-first-continuation-read-advance",
);
const SEALED_FIRST_CONTINUATION_MATERIAL_ADVANCE = Symbol(
  "sealed-first-continuation-material-advance",
);
const ROOM_THRESHOLD_RUN_STATE_PROOF = Symbol("room-threshold-run-state-proof");
const ROOM_THRESHOLD_FAIL_STOP_PROOF = Symbol("room-threshold-fail-stop-proof");
const EXT013_ROOM_THRESHOLD_KERNELS = new WeakSet<CanonicalCombatKernel>();

interface Ext013RoomThresholdRunBinding {
  readonly kernel: CanonicalCombatKernel;
  readonly formalTarget: CanonicalRunFirstContinuationRoomTargetAvailable;
  readonly roomTransition: RoomTransitionAuthority;
  readonly lease: CollisionBlockerLease;
  readonly targetRoom: CanonicalRunRoomThresholdTargetRoom;
  readonly completeTick120: number;
  readonly successorTransferCapability:
    CanonicalRunFirstContinuationDormantSuccessorTransferCapability;
  phase:
    | "transition"
    | "detach-release-requested"
    | "material"
    | "target-room-idle"
    | "successor-dormant"
    | "successor-pre-read"
    | "successor-read"
    | "successor-release-requested"
    | "successor-tail"
    | "successor-complete";
  carryover: CanonicalRoomThresholdMaterialCarryover | null;
  materialRoomEventCount: number | null;
  successorOwner: object | null;
  successorReservation: CanonicalRunFirstContinuationDormantSuccessorReservation | null;
  successorPlan: CanonicalRunFirstContinuationRoomPlanPayload | null;
  successorKernel: CanonicalCombatKernel | null;
  successorFinalCombat: CanonicalCombatSnapshot | null;
  expectedFlushTick120: number | null;
  expectedPendingEventCount: number | null;
}

const EXT013_ROOM_THRESHOLD_RUN_BINDINGS = new WeakMap<
  CanonicalRunCombatState,
  Ext013RoomThresholdRunBinding
>();

declare const dormantSuccessorTransferCapabilityBrand: unique symbol;

export type CanonicalRunFirstContinuationDormantSuccessorTransferCapability = Readonly<{
  readonly [dormantSuccessorTransferCapabilityBrand]: true;
}>;

interface DormantSuccessorTransferCapabilityRecord {
  readonly runState: CanonicalRunCombatState;
  readonly kernel: CanonicalCombatKernel;
  readonly formalTarget: CanonicalRunFirstContinuationRoomTargetAvailable;
  status: "transition" | "handoff" | "prepared" | "committed";
  handoffReceipt: object | null;
  handoffTick120: number | null;
  carryover: CanonicalRoomThresholdMaterialCarryover | null;
  activeProposal: PreparedCanonicalRunFirstContinuationDormantSuccessorTransfer | null;
}

const DORMANT_SUCCESSOR_TRANSFER_CAPABILITIES = new WeakMap<
  CanonicalRunFirstContinuationDormantSuccessorTransferCapability,
  DormantSuccessorTransferCapabilityRecord
>();

export interface CanonicalRunFirstContinuationDormantSuccessorReservation {
  readonly authority: "canonical-run-first-continuation-dormant-successor-reservation-v1";
  readonly extensionPolicy: "EXT-2026-015";
  readonly admittedAtTick120: number;
  readonly targetRoom: CanonicalRunRoomThresholdTargetRoom;
  readonly occurrenceId: string;
  readonly patternId: string;
  readonly difficulty: PatternDifficulty;
  readonly projectileArchetypeId: string;
  readonly projectilePoolClass: ProjectilePoolClass;
  readonly requestedProjectileSlots: number;
  readonly requestedResidueVisualSlots: number;
  readonly emitterCount: number;
  readonly maxEmitters: number;
  readonly combinedAllocatedSlots: Readonly<Record<ProjectilePoolClass, number>>;
  readonly combinedResidueVisuals: number;
}

declare const preparedDormantSuccessorTransferBrand: unique symbol;

export interface PreparedCanonicalRunFirstContinuationDormantSuccessorTransfer {
  readonly [preparedDormantSuccessorTransferBrand]:
    "PreparedCanonicalRunFirstContinuationDormantSuccessorTransfer";
}

export interface PreparedCanonicalRunFirstContinuationDormantSuccessorTransferView {
  readonly authority: "canonical-run-first-continuation-dormant-successor-transfer-v1";
  readonly extensionPolicy: "EXT-2026-015";
  readonly tick120: number;
  readonly targetRoom: CanonicalRunRoomThresholdTargetRoom;
  readonly occurrenceId: string;
  readonly patternId: string;
  readonly plan: CanonicalRunFirstContinuationRoomPlanPayload;
  readonly combinedPoolAdmission: CanonicalRunFirstContinuationCombinedPoolAdmissionEvaluation;
  readonly materialCount: number;
  readonly materialDraining: boolean;
  readonly liveColliders: 0;
  readonly canonicalEventWrites: 0;
  readonly tickAdvance: 0;
}

interface PreparedDormantSuccessorTransferRecord {
  readonly capability: CanonicalRunFirstContinuationDormantSuccessorTransferCapability;
  readonly handoffReceipt: object;
  readonly runState: CanonicalRunCombatState;
  readonly eventBus: CanonicalEventBus;
  readonly carryover: CanonicalRoomThresholdMaterialCarryover;
  readonly successorOwner: object;
  readonly reservation: CanonicalRunFirstContinuationDormantSuccessorReservation;
  readonly source: CanonicalRunFirstContinuationRoomPlanSourceView;
  readonly plan: CanonicalRunFirstContinuationRoomPlanPayload;
  readonly evaluation: CanonicalRunFirstContinuationCombinedPoolAdmissionEvaluation;
  readonly material: CanonicalRoomThresholdMaterialCarryoverSnapshot;
  readonly view: PreparedCanonicalRunFirstContinuationDormantSuccessorTransferView;
  status: "prepared" | "committed" | "cancelled" | "failed";
}

const PREPARED_DORMANT_SUCCESSOR_TRANSFERS = new WeakMap<
  PreparedCanonicalRunFirstContinuationDormantSuccessorTransfer,
  PreparedDormantSuccessorTransferRecord
>();
const ACTIVE_DORMANT_SUCCESSOR_TRANSFER_BY_RUN_STATE = new WeakMap<
  CanonicalRunCombatState,
  PreparedCanonicalRunFirstContinuationDormantSuccessorTransfer
>();

declare const preparedRunRoomTransitionLeaseReleaseBrand: unique symbol;

export interface PreparedCanonicalRunRoomTransitionLeaseRelease {
  readonly [preparedRunRoomTransitionLeaseReleaseBrand]:
    "PreparedCanonicalRunRoomTransitionLeaseRelease";
}

export interface PreparedCanonicalRunRoomTransitionLeaseReleaseView {
  readonly authority: "canonical-run-room-transition-lease-release-v1";
  readonly tick120: number;
  readonly lease: CollisionBlockerLease;
  readonly eventIds: readonly ["room.transition.complete", "player.collision.on"];
  readonly playerPreview: PlayerDamageSnapshot;
  readonly roomTransitionPreview: RoomTransitionAuthoritySnapshot;
}

interface PreparedRunRoomTransitionLeaseReleaseRecord {
  readonly runState: CanonicalRunCombatState;
  readonly roomTransition: RoomTransitionAuthority;
  readonly roomTransitionProposal: PreparedRoomTransitionMutation;
  readonly roomTransitionView: PreparedRoomTransitionMutationView;
  readonly playerProposal: PreparedPlayerCollisionBlockerMutation;
  readonly playerView: PreparedPlayerCollisionBlockerMutationView;
  readonly view: PreparedCanonicalRunRoomTransitionLeaseReleaseView;
  status: "prepared" | "applied" | "failed";
}

const PREPARED_RUN_ROOM_TRANSITION_LEASE_RELEASES = new WeakMap<
  PreparedCanonicalRunRoomTransitionLeaseRelease,
  PreparedRunRoomTransitionLeaseReleaseRecord
>();
const PENDING_RUN_ROOM_TRANSITION_LEASE_RELEASES = new WeakMap<
  CanonicalRunCombatState,
  PreparedCanonicalRunRoomTransitionLeaseRelease
>();

declare const preparedRoomThresholdMaterialDetachBrand: unique symbol;

export interface PreparedCanonicalRoomThresholdMaterialDetach {
  readonly [preparedRoomThresholdMaterialDetachBrand]:
    "PreparedCanonicalRoomThresholdMaterialDetach";
}

export interface CanonicalRoomThresholdMaterialCarryoverSnapshot {
  readonly authority: "room-threshold-material-carryover-v1";
  readonly sourcePatternId: "transition.room_threshold";
  readonly sourceOccurrenceId: "run:room:0-to-1:transition:transition.room_threshold";
  readonly detachedAtTick120: number;
  readonly tick120: number;
  readonly materialCount: number;
  readonly drained: boolean;
  readonly poolUsage: ProjectilePoolUsage;
  readonly projectiles: readonly CombatProjectileSnapshot[];
}

export interface CanonicalRunIdleWithRoomThresholdMaterialResult {
  readonly runCombat: CanonicalRunCombatStateSnapshot;
  readonly material: CanonicalRoomThresholdMaterialCarryoverSnapshot;
}

interface PreparedRoomThresholdMaterialDetachRecord {
  readonly kernel: CanonicalCombatKernel;
  readonly runState: CanonicalRunCombatState;
  readonly tick120: number;
  status: "prepared" | "release-requested" | "committed" | "failed";
}

const PREPARED_ROOM_THRESHOLD_MATERIAL_DETACHES = new WeakMap<
  PreparedCanonicalRoomThresholdMaterialDetach,
  PreparedRoomThresholdMaterialDetachRecord
>();
const ACTIVE_ROOM_THRESHOLD_MATERIAL_DETACH_BY_KERNEL = new WeakMap<
  CanonicalCombatKernel,
  PreparedCanonicalRoomThresholdMaterialDetach
>();
const ROOM_THRESHOLD_MATERIAL_DETACH = Symbol("room-threshold-material-detach");
interface RoomThresholdMaterialCarryoverRecord {
  readonly runState: CanonicalRunCombatState;
  readonly projectiles: ProjectileAuthorityPool;
  readonly materialIdentityByKey: ReadonlyMap<string, Readonly<{
    sourceId: string;
    sourceIndex: number;
    burstIndex: number;
    headingDegrees: number;
    speedPxPerSecond: number;
  }>>;
  readonly detachedAtTick120: number;
  currentTick120: number;
}
const ROOM_THRESHOLD_MATERIAL_CARRYOVERS = new WeakMap<
  CanonicalRoomThresholdMaterialCarryover,
  RoomThresholdMaterialCarryoverRecord
>();
const CREATE_ROOM_THRESHOLD_MATERIAL_CARRYOVER = Symbol(
  "create-room-threshold-material-carryover",
);

interface ValidatedCombatStepInput {
  readonly tick120: number;
  readonly playerPosition: Vec2;
  readonly focused: boolean;
  readonly overridePressed: boolean;
  readonly overrideReleased: boolean;
  readonly overrideDirection: Vec2 | null;
}

function requireSafeTick(value: number, path: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    throw new Error(`${path} must be a non-negative safe integer without negative zero`);
  }
  return value;
}

function requirePositiveFinite(value: number, path: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${path} must be finite and positive`);
  return value;
}

function requireNonNegativeFinite(value: number, path: string): number {
  if (!Number.isFinite(value) || value < 0 || Object.is(value, -0)) {
    throw new Error(`${path} must be finite and non-negative without negative zero`);
  }
  return value;
}

function requirePositiveInteger(value: number, path: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${path} must be a positive safe integer`);
  return value;
}

function requireNonNegativeInteger(value: number, path: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    throw new Error(`${path} must be a non-negative safe integer without negative zero`);
  }
  return value;
}

function freezeVec2(value: Vec2, path: string): Vec2 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be a vector object`);
  }
  const xDescriptor = Object.getOwnPropertyDescriptor(value, "x");
  const yDescriptor = Object.getOwnPropertyDescriptor(value, "y");
  if (
    xDescriptor === undefined
    || yDescriptor === undefined
    || !("value" in xDescriptor)
    || !("value" in yDescriptor)
  ) {
    throw new Error(`${path} must use own data coordinates`);
  }
  const x = xDescriptor.value as unknown;
  const y = yDescriptor.value as unknown;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`${path} must contain finite coordinates`);
  }
  return Object.freeze({
    x: Object.is(x, -0) ? 0 : x as number,
    y: Object.is(y, -0) ? 0 : y as number,
  });
}

function ownInputData(
  input: CanonicalCombatStepInput,
  key: keyof CanonicalCombatStepInput,
  required: boolean,
): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("combat step input must be an object");
  }
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (descriptor === undefined) {
    if (required) throw new Error(`combat step input.${key} is required`);
    return undefined;
  }
  if (!("value" in descriptor)) {
    throw new Error(`combat step input.${key} must be an own data property`);
  }
  return descriptor.value;
}

function captureCombatOptions(options: CanonicalCombatKernelOptions): CanonicalCombatKernelOptions {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new Error("canonical combat options must be an object");
  }
  const read = (key: keyof CanonicalCombatKernelOptions, required: boolean): unknown => {
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (descriptor === undefined) {
      if (required) throw new Error(`canonical combat options.${key} is required`);
      return undefined;
    }
    if (!("value" in descriptor)) {
      throw new Error(`canonical combat options.${key} must be an own data property`);
    }
    return descriptor.value;
  };
  const poolValue = read("projectilePoolClasses", true);
  if (typeof poolValue !== "object" || poolValue === null || Array.isArray(poolValue)) {
    throw new Error("canonical combat options.projectilePoolClasses must be an object");
  }
  const projectilePoolClasses: Record<string, ProjectilePoolClass> = {};
  for (const key of Object.keys(poolValue).sort(compareText)) {
    const descriptor = Object.getOwnPropertyDescriptor(poolValue, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new Error(`canonical combat options.projectilePoolClasses.${key} must be an own data property`);
    }
    projectilePoolClasses[key] = descriptor.value as ProjectilePoolClass;
  }
  const patternId = read("patternId", false);
  const occurrenceId = read("occurrenceId", false);
  const initialPlayerPosition = read("initialPlayerPosition", false);
  return Object.freeze({
    ...(patternId === undefined ? {} : {patternId: patternId as string}),
    ...(occurrenceId === undefined ? {} : {occurrenceId: occurrenceId as string}),
    seed: read("seed", true) as number,
    startTick120: read("startTick120", true) as number,
    roomId: read("roomId", true) as string,
    difficulty: read("difficulty", true) as PatternDifficulty,
    ...(initialPlayerPosition === undefined ? {} : {initialPlayerPosition: initialPlayerPosition as Vec2}),
    grazeRadiusPx: read("grazeRadiusPx", true) as number,
    projectileDamage: read("projectileDamage", true) as number,
    projectilePoolClasses: Object.freeze(projectilePoolClasses),
  });
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

const BOSS_RIG_MANIFEST = deepFreezeJson(
  bossRigsJson as unknown as BossRigManifestContract,
);

function compareText(left: string, right: string): number {
  const leftScalars = Array.from(left);
  const rightScalars = Array.from(right);
  const length = Math.min(leftScalars.length, rightScalars.length);
  for (let index = 0; index < length; index += 1) {
    const leftCodePoint = leftScalars[index]?.codePointAt(0) ?? 0;
    const rightCodePoint = rightScalars[index]?.codePointAt(0) ?? 0;
    if (leftCodePoint !== rightCodePoint) return leftCodePoint - rightCodePoint;
  }
  return leftScalars.length - rightScalars.length;
}

function requireUnicodeScalarString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error(`${path} must contain only Unicode scalar values`);
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new Error(`${path} must contain only Unicode scalar values`);
    }
  }
  return value;
}

function captureProjectilePoolClasses(
  value: unknown,
  path: string,
): Readonly<Record<string, ProjectilePoolClass>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be a plain object`);
  }
  let keys: readonly string[];
  try {
    keys = Object.keys(Object.getOwnPropertyDescriptors(value)).sort(compareText);
  } catch {
    throw new Error(`${path} could not be inspected safely`);
  }
  if (keys.length === 0) throw new Error(`${path} must contain at least one pool-class mapping`);
  const captured = ownPlainDataRecord(
    value as Readonly<Record<string, unknown>>,
    keys,
    path,
  );
  const result: Record<string, ProjectilePoolClass> = {};
  for (const key of keys) {
    requireUnicodeScalarString(key, `${path} key`);
    if (!CANONICAL_PROJECTILE_ARCHETYPE_SET.has(key)) {
      throw new Error(`${path}.${key} is not a canonical V4 projectile archetype`);
    }
    const poolClass = captured[key];
    if (poolClass !== "micro"
      && poolClass !== "medium"
      && poolClass !== "heavy"
      && poolClass !== "splitChildren") {
      throw new Error(`${path}.${key} must be a canonical projectile pool class`);
    }
    result[key] = poolClass;
  }
  return Object.freeze(result);
}

function captureRunCombatStateOptions(
  value: CanonicalRunCombatStateOptions,
): Readonly<CanonicalRunCombatStateOptions> {
  const captured = ownPlainDataRecord(
    value as unknown as Readonly<Record<string, unknown>>,
    [
      "startTick120",
      "initialPlayerPosition",
      "grazeRadiusPx",
      "projectileDamage",
      "projectilePoolClasses",
    ],
    "canonical run combat state options",
  );
  return Object.freeze({
    startTick120: captured.startTick120 as number,
    initialPlayerPosition: freezeVec2(
      captured.initialPlayerPosition as Vec2,
      "canonical run combat state initialPlayerPosition",
    ),
    grazeRadiusPx: captured.grazeRadiusPx as number,
    projectileDamage: captured.projectileDamage as number,
    projectilePoolClasses: captureProjectilePoolClasses(
      captured.projectilePoolClasses,
      "canonical run combat state projectilePoolClasses",
    ),
  });
}

function captureMisreaderEnforceEntryOptions(
  value: CanonicalMisreaderEnforceEntryOptions,
): Readonly<CanonicalMisreaderEnforceEntryOptions> {
  const captured = ownPlainDataRecord(
    value as unknown as Readonly<Record<string, unknown>>,
    ["occurrenceId", "phaseEntryTick120", "phaseExitAuthorization"],
    "Misreader enforce-entry options",
  );
  if (captured.phaseExitAuthorization !== "caller-validated:misreader.evidence>=1") {
    throw new Error("Misreader phase-exit authorization assertion is invalid");
  }
  return Object.freeze({
    occurrenceId: requireUnicodeScalarString(
      captured.occurrenceId,
      "Misreader enforce-entry occurrenceId",
    ),
    phaseEntryTick120: requireSafeTick(
      captured.phaseEntryTick120 as number,
      "Misreader enforce-entry phaseEntryTick120",
    ),
    phaseExitAuthorization: captured.phaseExitAuthorization,
  });
}

function occurrenceAuthorityId(occurrenceId: string, patternId: string): string {
  const byteLength = new TextEncoder().encode(occurrenceId).byteLength;
  return `combat:${byteLength}:${occurrenceId}:${patternId}`;
}

interface SpeedCurveKey {
  readonly atMs: number;
  readonly pxPerSec: number;
}

interface SpeedCurveContract {
  readonly type: "piecewise-linear";
  readonly keys: readonly SpeedCurveKey[];
}

function capturePiecewiseLinearSpeedCurve(
  speedCurveValue: Readonly<Record<string, unknown>>,
  path: string,
): SpeedCurveContract {
  const captured = ownPlainDataRecord(speedCurveValue, ["keys", "type"], path);
  if (captured.type !== "piecewise-linear") {
    throw new Error(`${path}.type must be piecewise-linear`);
  }
  const rawKeys = ownDenseDataArray(captured.keys, `${path}.keys`);
  if (rawKeys.length === 0) throw new Error(`${path}.keys must not be empty`);
  let previousAtMs = -1;
  const keys = rawKeys.map((value, index): SpeedCurveKey => {
    const key = ownPlainDataRecord(
      value as Readonly<Record<string, unknown>>,
      ["atMs", "pxPerSec"],
      `${path}.keys[${index}]`,
    );
    const atMs = requireNonNegativeInteger(key.atMs as number, `${path}.keys[${index}].atMs`);
    const pxPerSec = requirePositiveFinite(
      key.pxPerSec as number,
      `${path}.keys[${index}].pxPerSec`,
    );
    if (index === 0 && atMs !== 0) throw new Error(`${path}.keys must begin at 0ms`);
    if (index > 0 && atMs <= previousAtMs) {
      throw new Error(`${path}.keys must be strictly ordered by atMs`);
    }
    previousAtMs = atMs;
    return Object.freeze({atMs, pxPerSec});
  });
  return Object.freeze({type: "piecewise-linear", keys: Object.freeze(keys)});
}

/** Exported for adversarial fail-closed tests; production uses the same capture path. */
export function validatePiecewiseLinearSpeedCurveParameters(
  speedCurve: Readonly<Record<string, unknown>>,
): void {
  capturePiecewiseLinearSpeedCurve(speedCurve, "speedCurve");
}

function speedCurveAt(curve: SpeedCurveContract, ageMs: number): number {
  const first = curve.keys[0];
  if (first === undefined) throw new Error("validated speed curve lost its first key");
  if (ageMs <= first.atMs) return first.pxPerSec;
  for (let index = 0; index < curve.keys.length - 1; index += 1) {
    const left = curve.keys[index];
    const right = curve.keys[index + 1];
    if (left === undefined || right === undefined || ageMs > right.atMs) continue;
    const progress = (ageMs - left.atMs) / (right.atMs - left.atMs);
    return left.pxPerSec + (right.pxPerSec - left.pxPerSec) * progress;
  }
  return curve.keys[curve.keys.length - 1]?.pxPerSec ?? first.pxPerSec;
}

interface SpeedEnvelopeKey {
  readonly atMs: number;
  readonly multiplier: number;
}

interface SpeedEnvelopeContract {
  readonly keys: readonly SpeedEnvelopeKey[];
  readonly interpolation: "step" | "linear";
}

function captureSpeedEnvelope(
  motionEntry: Pick<PatternMotion, "params">,
  path: string,
): SpeedEnvelopeContract {
  const captured = ownPlainDataRecord(motionEntry.params, ["interpolation", "keys"], path);
  if (captured.interpolation !== "step" && captured.interpolation !== "linear") {
    throw new Error(`${path}.interpolation must be step or linear`);
  }
  const rawKeys = ownDenseDataArray(captured.keys, `${path}.keys`);
  if (rawKeys.length === 0) throw new Error(`${path}.keys must not be empty`);
  let previousAtMs = -1;
  const keys = rawKeys.map((value, index): SpeedEnvelopeKey => {
    const key = ownPlainDataRecord(
      value as Readonly<Record<string, unknown>>,
      ["atMs", "multiplier"],
      `${path}.keys[${index}]`,
    );
    const atMs = requireNonNegativeInteger(key.atMs as number, `${path}.keys[${index}].atMs`);
    const multiplier = requireNonNegativeFinite(
      key.multiplier as number,
      `${path}.keys[${index}].multiplier`,
    );
    if (index === 0 && atMs !== 0) throw new Error(`${path}.keys must begin at 0ms`);
    if (index > 0 && atMs <= previousAtMs) {
      throw new Error(`${path}.keys must be strictly ordered by atMs`);
    }
    previousAtMs = atMs;
    return Object.freeze({atMs, multiplier});
  });
  return Object.freeze({
    keys: Object.freeze(keys),
    interpolation: captured.interpolation,
  });
}

/** Exported for adversarial fail-closed tests; production uses the same capture path. */
export function validateSpeedEnvelopeParameters(params: Readonly<Record<string, unknown>>): void {
  captureSpeedEnvelope({params}, "op.speed_envelope");
}

interface LocalVectorBiasContract {
  readonly vectorPxPerSec: readonly [number, number];
  readonly pulsePeriodMs: number;
  readonly pulseAmount: number;
}

function captureLocalVectorBias(
  motionEntry: Pick<PatternMotion, "params">,
  path: string,
): LocalVectorBiasContract {
  const captured = ownPlainDataRecord(
    motionEntry.params,
    ["pulseAmount", "pulsePeriodMs", "vectorPxPerSec"],
    path,
  );
  const rawVector = ownDenseDataArray(captured.vectorPxPerSec, `${path}.vectorPxPerSec`);
  if (rawVector.length !== 2) throw new Error(`${path}.vectorPxPerSec must contain exactly two values`);
  const vector = rawVector.map((value, index) => {
    if (typeof value !== "number" || !Number.isFinite(value) || Object.is(value, -0)) {
      throw new Error(`${path}.vectorPxPerSec[${index}] must be finite without negative zero`);
    }
    return value;
  }) as [number, number];
  const pulsePeriodMs = requirePositiveInteger(
    captured.pulsePeriodMs as number,
    `${path}.pulsePeriodMs`,
  );
  const pulseAmount = requireNonNegativeFinite(
    captured.pulseAmount as number,
    `${path}.pulseAmount`,
  );
  if (Object.is(pulseAmount, -0)) throw new Error(`${path}.pulseAmount must not be negative zero`);
  return Object.freeze({
    vectorPxPerSec: Object.freeze(vector) as readonly [number, number],
    pulsePeriodMs,
    pulseAmount,
  });
}

/** Exported for adversarial parameter tests; production uses the same strict capture path. */
export function validateLocalVectorBiasParameters(
  params: Readonly<Record<string, unknown>>,
): void {
  captureLocalVectorBias({params}, "op.local_vector_bias");
}

interface DualClockGateContract {
  readonly periodAMs: number;
  readonly periodBMs: number;
  readonly dutyANumerator: number;
  readonly dutyBNumerator: number;
  readonly dutyScale: 1_000_000;
  readonly phaseOffsetMs: number;
}

const DUAL_CLOCK_DUTY_SCALE = 1_000_000 as const;

function captureDualClockGate(
  motionEntry: Pick<PatternMotion, "params">,
  path: string,
): DualClockGateContract {
  const captured = ownPlainDataRecord(
    motionEntry.params,
    ["dutyA", "dutyB", "periodAMs", "periodBMs", "phaseOffsetMs"],
    path,
  );
  const periodAMs = requirePositiveInteger(captured.periodAMs as number, `${path}.periodAMs`);
  const periodBMs = requirePositiveInteger(captured.periodBMs as number, `${path}.periodBMs`);
  const phaseOffsetMs = requireNonNegativeInteger(
    captured.phaseOffsetMs as number,
    `${path}.phaseOffsetMs`,
  );
  const captureDuty = (value: unknown, dutyPath: string): number => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1) {
      throw new Error(`${dutyPath} must be finite in (0, 1]`);
    }
    const numerator = Math.round(value * DUAL_CLOCK_DUTY_SCALE);
    if (
      !Number.isSafeInteger(numerator)
      || Math.abs(value - numerator / DUAL_CLOCK_DUTY_SCALE) > Number.EPSILON
    ) {
      throw new Error(`${dutyPath} must have an exact six-decimal integer representation`);
    }
    return numerator;
  };
  return Object.freeze({
    periodAMs,
    periodBMs,
    dutyANumerator: captureDuty(captured.dutyA, `${path}.dutyA`),
    dutyBNumerator: captureDuty(captured.dutyB, `${path}.dutyB`),
    dutyScale: DUAL_CLOCK_DUTY_SCALE,
    phaseOffsetMs,
  });
}

/** Exported for hostile parameter tests; production uses the same integer capture path. */
export function validateDualClockGateParameters(
  params: Readonly<Record<string, unknown>>,
): void {
  captureDualClockGate({params}, "op.dual_clock_gate");
}

function dualClockGateContract(
  motionStack: readonly PatternMotion[],
  path: string,
): DualClockGateContract | undefined {
  const dualClockGate = motionStack.find((entry) => entry.operator === "op.dual_clock_gate");
  if (dualClockGate === undefined) return undefined;
  return captureDualClockGate(dualClockGate, path);
}

function dualClockGateActiveAtRelativeTick(
  gate: DualClockGateContract,
  relativeTick120: number,
  safeGapType: string,
): boolean {
  const tick120 = requireSafeTick(relativeTick120, "dual-clock relative tick120");
  const open = (
    periodMs: number,
    dutyNumerator: number,
    phaseOffsetMs: number,
  ): boolean => {
    // BigInt keeps the exported hostile-value validator meaningful across the
    // complete safe-integer tick domain; floating products would silently lose
    // the exact crossed-tick boundary long before Number.MAX_SAFE_INTEGER.
    const periodUnits = BigInt(periodMs) * BigInt(TICKS_PER_SECOND);
    const elapsedUnits = BigInt(tick120) * 1000n
      + BigInt(phaseOffsetMs) * BigInt(TICKS_PER_SECOND);
    const phaseUnits = elapsedUnits % periodUnits;
    return phaseUnits * BigInt(gate.dutyScale) < periodUnits * BigInt(dutyNumerator);
  };
  const gateA = open(gate.periodAMs, gate.dutyANumerator, 0);
  const gateB = open(gate.periodBMs, gate.dutyBNumerator, gate.phaseOffsetMs);
  return gateA !== gateB || (gateA && gateB && safeGapType === "dual_clock_intersection");
}

function keyFor(handle: ProjectileHandle): string {
  return `${handle.instanceId}:${handle.generation}`;
}

function crossedOffsetTickCount(authoredStartMs: number, authoredOffsetMs: number): number {
  const absoluteMs = authoredStartMs + authoredOffsetMs;
  if (!Number.isFinite(absoluteMs) || Object.is(absoluteMs, -0)) {
    throw new Error("authored offset exceeds finite gameplay time");
  }
  return crossedTickCount(absoluteMs) - crossedTickCount(authoredStartMs);
}

function degreesToRadians(value: number): number {
  return value * Math.PI / 180;
}

function normalizeDegrees(value: number): number {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

function angleTo(from: Vec2, to: Vec2): number {
  return Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
}

function turnToward(current: number, target: number, maximumDelta: number): number {
  const delta = Math.max(-maximumDelta, Math.min(maximumDelta, normalizeDegrees(target - current)));
  return current + delta;
}

function numberParameter(motion: PatternMotion | undefined, key: string, fallback: number): number {
  const value = motion?.params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function motion(runtime: RuntimeProjectile, operator: string): PatternMotion | undefined {
  return runtime.motion.find((candidate) => candidate.operator === operator);
}

function speedEnvelopeContract(
  motionStack: readonly PatternMotion[],
): SpeedEnvelopeContract | undefined {
  const envelope = motionStack.find((entry) => entry.operator === "op.speed_envelope");
  if (envelope === undefined) return undefined;
  return envelope.params as unknown as SpeedEnvelopeContract;
}

function localVectorBiasContract(
  motionStack: readonly PatternMotion[],
): LocalVectorBiasContract | undefined {
  const localVectorBias = motionStack.find((entry) => entry.operator === "op.local_vector_bias");
  if (localVectorBias === undefined) return undefined;
  return localVectorBias.params as unknown as LocalVectorBiasContract;
}

interface HistoryReplayPoint {
  readonly x: number;
  readonly y: number;
  readonly atMs: number;
}

interface HistoryReplayContract {
  readonly points: readonly HistoryReplayPoint[];
  readonly delayMs: number;
  readonly mode: "reverse";
  readonly replayDurationMs: number;
}

function captureHistoryReplay(
  motionEntry: Pick<PatternMotion, "params">,
  path: string,
): HistoryReplayContract {
  const captured = ownPlainDataRecord(motionEntry.params, ["delayMs", "mode", "points"], path);
  if (captured.mode !== "reverse") {
    throw new Error(`${path}.mode must be reverse for the admitted Ash Memory slice`);
  }
  const delayMs = requireNonNegativeInteger(captured.delayMs as number, `${path}.delayMs`);
  const rawPoints = ownDenseDataArray(captured.points, `${path}.points`);
  if (rawPoints.length < 2) throw new Error(`${path}.points must contain at least two points`);
  let previousAtMs = -1;
  const authoredPoints = rawPoints.map((value, index): HistoryReplayPoint => {
    const tuple = ownDenseDataArray(value, `${path}.points[${index}]`);
    if (tuple.length !== 3) throw new Error(`${path}.points[${index}] must contain x, y, atMs`);
    const [x, y, rawAtMs] = tuple;
    if (
      typeof x !== "number"
      || !Number.isFinite(x)
      || Object.is(x, -0)
      || typeof y !== "number"
      || !Number.isFinite(y)
      || Object.is(y, -0)
    ) {
      throw new Error(`${path}.points[${index}] coordinates must be finite without negative zero`);
    }
    const atMs = requireNonNegativeInteger(rawAtMs as number, `${path}.points[${index}].atMs`);
    if (index === 0 && atMs !== 0) throw new Error(`${path}.points must begin at 0ms`);
    if (index > 0 && atMs <= previousAtMs) {
      throw new Error(`${path}.points must be strictly ordered by atMs`);
    }
    previousAtMs = atMs;
    return Object.freeze({x, y, atMs});
  });
  const replayDurationMs = authoredPoints[authoredPoints.length - 1]?.atMs;
  if (replayDurationMs === undefined || replayDurationMs <= 0) {
    throw new Error(`${path}.points require a positive replay duration`);
  }
  const points = authoredPoints
    .map((point) => Object.freeze({
      x: point.x,
      y: point.y,
      atMs: replayDurationMs - point.atMs,
    }))
    .reverse();
  return Object.freeze({
    points: Object.freeze(points),
    delayMs,
    mode: "reverse",
    replayDurationMs,
  });
}

/** Exported for descriptor-hostile parameter tests; production uses this exact capture path. */
export function validateHistoryReplayParameters(
  params: Readonly<Record<string, unknown>>,
): void {
  captureHistoryReplay({params}, "op.history_replay");
}

function historyReplayContract(
  motionStack: readonly PatternMotion[],
  path: string,
): HistoryReplayContract | undefined {
  const historyReplay = motionStack.find((entry) => entry.operator === "op.history_replay");
  return historyReplay === undefined ? undefined : captureHistoryReplay(historyReplay, path);
}

function historyReplayOffsetX(authoredSpawnOrdinal: number): number {
  requirePositiveInteger(authoredSpawnOrdinal, "history replay authored spawn ordinal");
  return ((authoredSpawnOrdinal % 7) - 3) * 2.2;
}

function historyReplayPositionAt(
  history: HistoryReplayContract,
  authoredSpawnOrdinal: number,
  ageMs: number,
): Vec2 | null {
  const localMs = Math.max(0, ageMs - history.delayMs);
  if (localMs > history.replayDurationMs) return null;
  const offsetX = historyReplayOffsetX(authoredSpawnOrdinal);
  for (let index = 0; index < history.points.length - 1; index += 1) {
    const left = history.points[index];
    const right = history.points[index + 1];
    if (left === undefined || right === undefined || localMs > right.atMs) continue;
    const progress = (localMs - left.atMs) / (right.atMs - left.atMs);
    return Object.freeze({
      x: left.x + (right.x - left.x) * progress + offsetX,
      y: left.y + (right.y - left.y) * progress,
    });
  }
  const terminal = history.points[history.points.length - 1];
  if (terminal === undefined) throw new Error("validated history replay lost its terminal point");
  return Object.freeze({x: terminal.x + offsetX, y: terminal.y});
}

/**
 * Absolute authored replay sampled on the master clock. The first live motion
 * interval retains the history-chain anchor-to-path capsule; later intervals
 * reset any prior corridor redirect to the serialized path before applying the
 * repeatable operator constraint again.
 */
function integrateHistoryReplayMotion(
  position: Vec2,
  history: HistoryReplayContract,
  authoredSpawnOrdinal: number,
  authoredSpawnMs: number,
  previousRelativeMs: number,
  relativeMs: number,
  speedPxPerSecond: number,
): Readonly<{
  readonly position: Vec2;
  readonly resolvedSpeedPxPerSecond: number;
  readonly segments: readonly KinematicMotionSegment[];
}> | null {
  const ageMs = Math.max(0, relativeMs - authoredSpawnMs);
  const terminalPosition = historyReplayPositionAt(history, authoredSpawnOrdinal, ageMs);
  if (terminalPosition === null) return null;
  const boundaries = [
    authoredSpawnMs + history.delayMs,
    ...history.points.slice(1).map((point) => authoredSpawnMs + history.delayMs + point.atMs),
  ]
    .filter((atMs) => atMs > previousRelativeMs && atMs < relativeMs)
    .sort((left, right) => left - right);
  const times = [...new Set([...boundaries, relativeMs])];
  const segments: KinematicMotionSegment[] = [];
  let cursor = position;
  let fromMs = previousRelativeMs;
  for (const toMs of times) {
    const target = historyReplayPositionAt(
      history,
      authoredSpawnOrdinal,
      Math.max(0, toMs - authoredSpawnMs),
    );
    if (target === null) throw new Error("history replay crossed its terminal time while active");
    segments.push(motionSegment(cursor, target, fromMs, toMs, speedPxPerSecond));
    cursor = target;
    fromMs = toMs;
  }
  return Object.freeze({
    position: terminalPosition,
    resolvedSpeedPxPerSecond: speedPxPerSecond,
    segments: Object.freeze(segments),
  });
}

function speedEnvelopeMultiplierAt(
  envelope: SpeedEnvelopeContract | undefined,
  ageMs: number,
): number {
  if (envelope === undefined) return 1;
  const first = envelope.keys[0];
  if (first === undefined) throw new Error("validated speed envelope lost its first key");
  if (envelope.interpolation === "linear") {
    if (ageMs <= first.atMs) return first.multiplier;
    for (let index = 0; index < envelope.keys.length - 1; index += 1) {
      const left = envelope.keys[index];
      const right = envelope.keys[index + 1];
      if (left === undefined || right === undefined || ageMs > right.atMs) continue;
      const progress = (ageMs - left.atMs) / (right.atMs - left.atMs);
      return left.multiplier + (right.multiplier - left.multiplier) * progress;
    }
    return envelope.keys[envelope.keys.length - 1]?.multiplier ?? first.multiplier;
  }
  let multiplier = envelope.keys[0]?.multiplier ?? 1;
  for (let index = 1; index < envelope.keys.length; index += 1) {
    const key = envelope.keys[index];
    if (key === undefined) continue;
    // The immutable Python/TS reference compiler samples step keys from the
    // left: an exact key instant retains the preceding value.
    if (ageMs <= key.atMs) break;
    multiplier = key.multiplier;
  }
  return multiplier;
}

interface KinematicMotionSegment {
  readonly from: Vec2;
  readonly to: Vec2;
  readonly previousRelativeMs: number;
  readonly relativeMs: number;
  readonly speedPxPerSecond: number;
  readonly startsNewComponent?: true;
}

function integrateKinematicMotion(
  position: Vec2,
  headingDegrees: number,
  speedCurve: SpeedCurveContract,
  speedMultiplier: number,
  lateralDriftPxPerSecond: number,
  envelope: SpeedEnvelopeContract | undefined,
  localVectorBias: LocalVectorBiasContract | undefined,
  authoredSpawnMs: number,
  previousRelativeMs: number,
  relativeMs: number,
): Readonly<{
  readonly position: Vec2;
  readonly resolvedSpeedPxPerSecond: number;
  readonly segments: readonly KinematicMotionSegment[];
}> {
  const boundaryTimes = [...new Set([
    ...speedCurve.keys.slice(1).map((key) => authoredSpawnMs + key.atMs),
    ...(envelope?.keys.slice(1).map((key) => authoredSpawnMs + key.atMs) ?? []),
  ])]
    .filter((atMs) => atMs > previousRelativeMs && atMs < relativeMs)
    .sort((left, right) => left - right);
  const times = [previousRelativeMs, ...boundaryTimes, relativeMs];
  const radians = degreesToRadians(headingDegrees);
  const segments: KinematicMotionSegment[] = [];
  let cursor = position;
  for (let index = 0; index < times.length - 1; index += 1) {
    const fromMs = times[index];
    const toMs = times[index + 1];
    if (fromMs === undefined || toMs === undefined || toMs <= fromMs) continue;
    const sampleAgeMs = (fromMs + toMs) / 2 - authoredSpawnMs;
    const envelopeMultiplier = speedEnvelopeMultiplierAt(envelope, sampleAgeMs);
    const fromSpeedPxPerSecond = speedCurveAt(speedCurve, fromMs - authoredSpawnMs)
      * speedMultiplier * envelopeMultiplier;
    const toSpeedPxPerSecond = speedCurveAt(speedCurve, toMs - authoredSpawnMs)
      * speedMultiplier * envelopeMultiplier;
    const speedPxPerSecond = (fromSpeedPxPerSecond + toSpeedPxPerSecond) / 2;
    const seconds = (toMs - fromMs) / 1000;
    let vectorBiasX = 0;
    let vectorBiasY = 0;
    if (localVectorBias !== undefined) {
      // V4 requires one pattern-local field sample on each fixed gameplay tick.
      // A speed-curve key may subdivide that tick, but every subsegment retains
      // the same endpoint sample instead of creating a second field clock.
      const pulse = Math.sin(
        relativeMs / localVectorBias.pulsePeriodMs * Math.PI * 2,
      ) * localVectorBias.pulseAmount;
      const biasedSeconds = seconds * (1 + pulse);
      vectorBiasX = localVectorBias.vectorPxPerSec[0] * biasedSeconds;
      vectorBiasY = localVectorBias.vectorPxPerSec[1] * biasedSeconds;
    }
    const next = Object.freeze({
      x: cursor.x + (
        Math.cos(radians) * speedPxPerSecond
        + lateralDriftPxPerSecond
      ) * seconds + vectorBiasX,
      y: cursor.y + Math.sin(radians) * speedPxPerSecond * seconds + vectorBiasY,
    });
    segments.push(Object.freeze({
      from: cursor,
      to: next,
      previousRelativeMs: fromMs,
      relativeMs: toMs,
      speedPxPerSecond,
    }));
    cursor = next;
  }
  return Object.freeze({
    position: cursor,
    resolvedSpeedPxPerSecond: speedCurveAt(speedCurve, relativeMs - authoredSpawnMs)
      * speedMultiplier
      * speedEnvelopeMultiplierAt(envelope, relativeMs - authoredSpawnMs),
    segments: Object.freeze(segments),
  });
}

interface SeamMotionStep {
  readonly position: Vec2;
  readonly headingDegrees: number;
  readonly seamTransformed: boolean;
  readonly redirected: boolean;
  /** Full authored footprint, including topology and redirect discontinuities. */
  readonly segments: readonly KinematicMotionSegment[];
  /** Contact footprint after removing corridor-violating segments. */
  readonly contactSegments: readonly KinematicMotionSegment[];
}

interface OperatorConstraintMotionStep {
  readonly position: Vec2;
  readonly headingDegrees: number;
  readonly redirected: boolean;
  /** Full authored footprint, including the oracle edge-snap discontinuity. */
  readonly segments: readonly KinematicMotionSegment[];
  /** Player/Override footprint with the protected corridor removed. */
  readonly contactSegments: readonly KinematicMotionSegment[];
}

interface SafeGapEntry {
  readonly fraction: number;
  readonly position: Vec2;
  readonly relativeMs: number;
  readonly side: -1 | 1;
}

function assertSeamTransformMotion(
  motionEntry: Pick<PatternMotion, "params">,
  path: string,
): void {
  const captured = ownPlainDataRecord(
    motionEntry.params,
    ["mode", "offsetPx", "seamX"],
    path,
  );
  requireNonNegativeFinite(captured.seamX as number, `${path}.seamX`);
  if (captured.mode !== "mirror" && captured.mode !== "offset") {
    throw new Error(`${path}.mode requires an admitted mirror or offset topology`);
  }
  if (
    typeof captured.offsetPx !== "number"
    || !Number.isFinite(captured.offsetPx)
    || Object.is(captured.offsetPx, -0)
  ) {
    throw new Error(`${path}.offsetPx must be finite without negative zero`);
  }
}

/** Exported for hostile parameter tests; live validation uses this exact path. */
export function validateSeamTransformParameters(params: Readonly<Record<string, unknown>>): void {
  assertSeamTransformMotion({params}, "op.seam_transform");
}

/**
 * A stationary point on the seam is not a crossing. Arrival at, departure
 * from, or traversal through the seam is. This inclusive tie rule makes the
 * first flight interval deterministic for Crack's seam-anchored fan.
 */
function crossesSeamOnMovement(fromX: number, toX: number, seamX: number): boolean {
  if (fromX === toX) return false;
  const fromSide = fromX - seamX;
  const toSide = toX - seamX;
  return fromSide === 0 || toSide === 0 || (fromSide < 0) !== (toSide < 0);
}

function motionSegment(
  from: Vec2,
  to: Vec2,
  previousRelativeMs: number,
  relativeMs: number,
  speedPxPerSecond: number,
  startsNewComponent = false,
): KinematicMotionSegment {
  return Object.freeze({
    from,
    to,
    previousRelativeMs,
    relativeMs,
    speedPxPerSecond,
    ...(startsNewComponent ? {startsNewComponent: true as const} : {}),
  });
}

const ORBIT_SWEEP_MAX_SAGITTA_PX = 0.0001;

function orbitPhaseRadiansFromCandidateDraw(draw: number): number {
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1 || Object.is(draw, -0)) {
    throw new Error("orbit phase draw must be in [0,1) without negative zero");
  }
  return draw * Math.PI * 2;
}

function orbitPositionAtAge(
  origin: Vec2,
  orbit: OrbitReleaseContract,
  phaseRadians: number,
  ageMs: number,
): Vec2 {
  const theta = phaseRadians
    + degreesToRadians(orbit.angularDegPerSec) * ageMs / 1000;
  return Object.freeze({
    x: origin.x + Math.cos(theta) * orbit.radiusPx,
    y: origin.y + Math.sin(theta) * orbit.radiusPx,
  });
}

function appendOrbitArcSegments(
  segments: KinematicMotionSegment[],
  origin: Vec2,
  orbit: OrbitReleaseContract,
  phaseRadians: number,
  fromPosition: Vec2,
  fromAgeMs: number,
  toAgeMs: number,
  authoredSpawnMs: number,
): Vec2 {
  const deltaRadians = Math.abs(degreesToRadians(orbit.angularDegPerSec))
    * (toAgeMs - fromAgeMs) / 1000;
  const maximumRadians = 2 * Math.acos(
    Math.max(-1, 1 - ORBIT_SWEEP_MAX_SAGITTA_PX / orbit.radiusPx),
  );
  const count = Math.max(1, Math.ceil(deltaRadians / maximumRadians));
  const tangentSpeedPxPerSecond = orbit.radiusPx
    * Math.abs(degreesToRadians(orbit.angularDegPerSec));
  let cursor = fromPosition;
  let fromMs = authoredSpawnMs + fromAgeMs;
  for (let index = 1; index <= count; index += 1) {
    const fraction = index / count;
    const sampleAgeMs = fromAgeMs + (toAgeMs - fromAgeMs) * fraction;
    const sampleMs = authoredSpawnMs + sampleAgeMs;
    const target = orbitPositionAtAge(origin, orbit, phaseRadians, sampleAgeMs);
    segments.push(motionSegment(
      cursor,
      target,
      fromMs,
      sampleMs,
      tangentSpeedPxPerSecond,
    ));
    cursor = target;
    fromMs = sampleMs;
  }
  return cursor;
}

/**
 * Integrate one declaration-order orbit/release interval. The first armed
 * interval retains the reference adapter's anchor-to-orbit radial sweep; later
 * orbit arcs use bounded deterministic chords, and a crossed release boundary
 * becomes a distinct authored-heading linear primitive.
 */
function integrateOrbitReleaseMotion(
  position: Vec2,
  origin: Vec2,
  orbit: OrbitReleaseContract,
  phaseRadians: number,
  orbitStarted: boolean,
  linearSpeedPxPerSecond: number,
  authoredSpawnMs: number,
  previousRelativeMs: number,
  relativeMs: number,
): Readonly<{
  readonly position: Vec2;
  readonly headingDegrees: number | null;
  readonly orbitStarted: boolean;
  readonly released: boolean;
  readonly resolvedSpeedPxPerSecond: number;
  readonly segments: readonly KinematicMotionSegment[];
}> {
  const previousAgeMs = Math.max(0, previousRelativeMs - authoredSpawnMs);
  const ageMs = Math.max(0, relativeMs - authoredSpawnMs);
  if (ageMs < previousAgeMs) throw new Error("orbit/release time must be monotonic");
  const releaseRelativeMs = authoredSpawnMs + orbit.releaseAtMs;
  const segments: KinematicMotionSegment[] = [];
  let cursor = position;
  let started = orbitStarted;
  if (previousAgeMs < orbit.releaseAtMs) {
    const orbitEndAgeMs = Math.min(ageMs, orbit.releaseAtMs);
    if (orbitEndAgeMs > previousAgeMs) {
      if (!started) {
        const orbitEnd = orbitPositionAtAge(origin, orbit, phaseRadians, orbitEndAgeMs);
        segments.push(motionSegment(
          cursor,
          orbitEnd,
          previousRelativeMs,
          authoredSpawnMs + orbitEndAgeMs,
          orbit.radiusPx * Math.abs(degreesToRadians(orbit.angularDegPerSec)),
        ));
        cursor = orbitEnd;
        started = true;
      } else {
        cursor = appendOrbitArcSegments(
          segments,
          origin,
          orbit,
          phaseRadians,
          cursor,
          previousAgeMs,
          orbitEndAgeMs,
          authoredSpawnMs,
        );
      }
    }
  } else if (!started) {
    throw new Error("orbit/release reached release before its owned orbit began");
  }
  const released = ageMs >= orbit.releaseAtMs;
  if (released && relativeMs > releaseRelativeMs) {
    const linearFromMs = Math.max(previousRelativeMs, releaseRelativeMs);
    const seconds = (relativeMs - linearFromMs) / 1000;
    const radians = degreesToRadians(orbit.releaseHeadingDeg);
    const next = Object.freeze({
      x: cursor.x + Math.cos(radians) * linearSpeedPxPerSecond * seconds,
      y: cursor.y + Math.sin(radians) * linearSpeedPxPerSecond * seconds,
    });
    segments.push(motionSegment(
      cursor,
      next,
      linearFromMs,
      relativeMs,
      linearSpeedPxPerSecond,
      previousRelativeMs < releaseRelativeMs,
    ));
    cursor = next;
  }
  if (segments.length === 0) {
    throw new Error("orbit/release integration produced no owned movement segment");
  }
  return Object.freeze({
    position: cursor,
    headingDegrees: released ? orbit.releaseHeadingDeg : null,
    orbitStarted: started,
    released,
    resolvedSpeedPxPerSecond: released
      ? linearSpeedPxPerSecond
      : orbit.radiusPx * Math.abs(degreesToRadians(orbit.angularDegPerSec)),
    segments: Object.freeze(segments),
  });
}

/** Earliest strict entry into the moving, radius-expanded player corridor. */
function firstSafeGapEntryOnSegment(
  pattern: CombatPattern,
  difficulty: PatternDifficulty,
  segment: KinematicMotionSegment,
  collisionRadiusPx: number,
): SafeGapEntry | null {
  const deltaX = segment.to.x - segment.from.x;
  const deltaY = segment.to.y - segment.from.y;
  let intervalStart = 0;
  let intervalEnd = 1;
  const bandMinimumY = 476;
  const bandMaximumY = 622;
  if (Math.abs(deltaY) <= Number.EPSILON) {
    if (segment.from.y < bandMinimumY || segment.from.y > bandMaximumY) return null;
  } else {
    const first = (bandMinimumY - segment.from.y) / deltaY;
    const second = (bandMaximumY - segment.from.y) / deltaY;
    intervalStart = Math.max(0, Math.min(first, second));
    intervalEnd = Math.min(1, Math.max(first, second));
    if (intervalStart > intervalEnd) return null;
  }
  const halfWidth = safeGapWidth(pattern, difficulty) / 2 + collisionRadiusPx + 2;
  const sample = (fraction: number) => {
    const relativeMs = segment.previousRelativeMs
      + (segment.relativeMs - segment.previousRelativeMs) * fraction;
    const x = segment.from.x + deltaX * fraction;
    const y = segment.from.y + deltaY * fraction;
    const relativeX = x - safeGapCenter(pattern, relativeMs);
    return {relativeMs, x, y, relativeX, clearance: Math.abs(relativeX) - halfWidth};
  };
  const entry = (fraction: number, relativeX: number): SafeGapEntry => {
    const sampled = sample(fraction);
    const side: -1 | 1 = relativeX <= 0 ? -1 : 1;
    return Object.freeze({
      fraction,
      position: Object.freeze({
        x: safeGapCenter(pattern, sampled.relativeMs) + side * halfWidth,
        y: sampled.y,
      }),
      relativeMs: sampled.relativeMs,
      side,
    });
  };

  const firstSample = sample(intervalStart);
  if (firstSample.clearance < 0) return entry(intervalStart, firstSample.relativeX);

  // Relative x is linear minus one authored sine. Partition it at every exact
  // derivative critical point, making each bracket monotone; this detects even
  // a same-edge tangential enter/exit that fixed temporal probes could miss.
  const breakpoints = [intervalStart, intervalEnd];
  const durationMs = segment.relativeMs - segment.previousRelativeMs;
  const amplitude = pattern.safeGap.path.amplitudePx;
  const periodMs = pattern.safeGap.path.periodMs;
  const phase = pattern.safeGap.path.phase;
  const thetaAtZero = segment.previousRelativeMs / periodMs * Math.PI * 2
    + phase * Math.PI * 2;
  const deltaTheta = durationMs / periodMs * Math.PI * 2;
  const derivativeScale = amplitude * deltaTheta;
  if (Math.abs(derivativeScale) > Number.EPSILON) {
    const ratio = deltaX / derivativeScale;
    if (ratio >= -1 && ratio <= 1) {
      const principal = Math.acos(Math.max(-1, Math.min(1, ratio)));
      const thetaMinimum = thetaAtZero + deltaTheta * intervalStart;
      const thetaMaximum = thetaAtZero + deltaTheta * intervalEnd;
      for (const signedPrincipal of [principal, -principal]) {
        const firstTurn = Math.ceil((thetaMinimum - signedPrincipal) / (Math.PI * 2));
        const lastTurn = Math.floor((thetaMaximum - signedPrincipal) / (Math.PI * 2));
        for (let turn = firstTurn; turn <= lastTurn; turn += 1) {
          const theta = signedPrincipal + turn * Math.PI * 2;
          const fraction = (theta - thetaAtZero) / deltaTheta;
          if (fraction > intervalStart && fraction < intervalEnd) breakpoints.push(fraction);
        }
      }
    }
  }
  breakpoints.sort((left, right) => left - right);
  const orderedBreakpoints = breakpoints.filter((value, index) =>
    index === 0 || Math.abs(value - (breakpoints[index - 1] ?? value)) > Number.EPSILON);
  for (let index = 0; index < orderedBreakpoints.length - 1; index += 1) {
    const leftFraction = orderedBreakpoints[index];
    const rightFraction = orderedBreakpoints[index + 1];
    if (leftFraction === undefined || rightFraction === undefined) continue;
    const left = sample(leftFraction);
    const right = sample(rightFraction);
    if (left.clearance < 0) return entry(leftFraction, left.relativeX);
    let target: number | null = null;
    if (left.relativeX >= halfWidth && right.relativeX < halfWidth) target = halfWidth;
    else if (left.relativeX <= -halfWidth && right.relativeX > -halfWidth) target = -halfWidth;
    if (target === null) continue;
    let before = leftFraction;
    let after = rightFraction;
    const increasing = right.relativeX > left.relativeX;
    for (let iteration = 0; iteration < 52; iteration += 1) {
      const middle = (before + after) / 2;
      const relativeX = sample(middle).relativeX;
      const remainsBefore = increasing ? relativeX <= target : relativeX >= target;
      if (remainsBefore) before = middle;
      else after = middle;
    }
    return entry(before, sample(before).relativeX);
  }
  return null;
}

/**
 * Room Threshold's corridor is a continuous sine, not a clock. Every body
 * keeps its declaration-ordered speed-envelope motion and stable identity;
 * only its entity-owned collision lease is masked when any fixed-tick motion
 * segment enters the radius-expanded threshold bridge.
 */
function independentRoomThresholdPhaseGateAllowsCollision(
  pattern: CombatPattern,
  difficulty: PatternDifficulty,
  segments: readonly KinematicMotionSegment[],
  collisionRadiusPx: number,
): boolean {
  if (
    pattern.id !== "transition.room_threshold"
    || pattern.safeGap.type !== "threshold_bridge"
    || pattern.safeGap.enforcement !== "phase_gate"
    || pattern.safeGap.path.laneX.length !== 0
    || segments.length === 0
  ) {
    throw new Error(`${pattern.id} independent threshold-bridge ownership drifted`);
  }
  return segments.every((segment) =>
    firstSafeGapEntryOnSegment(
      pattern,
      difficulty,
      segment,
      collisionRadiusPx,
    ) === null);
}

/**
 * Shared Crack integrator for preflight and live authority. Declaration order
 * is literal: linear sweep, one generation-owned mirror discontinuity, then
 * the Python-oracle-derived seam redirect (corridor edge plus signed 8deg).
 */
function integrateSeamRedirectMotion(
  pattern: CombatPattern,
  difficulty: PatternDifficulty,
  position: Vec2,
  headingDegrees: number,
  speedPxPerSecond: number,
  collisionRadiusPx: number,
  seamEntry: PatternMotion,
  seamTransformed: boolean,
  previousRelativeMs: number,
  relativeMs: number,
): SeamMotionStep {
  const seamX = seamEntry.params.seamX as number;
  const offsetPx = seamEntry.params.offsetPx as number;
  const seconds = (relativeMs - previousRelativeMs) / 1000;
  const radians = degreesToRadians(headingDegrees);
  const linearEnd = Object.freeze({
    x: position.x + Math.cos(radians) * speedPxPerSecond * seconds,
    y: position.y + Math.sin(radians) * speedPxPerSecond * seconds,
  });
  const segments: KinematicMotionSegment[] = [motionSegment(
    position,
    linearEnd,
    previousRelativeMs,
    relativeMs,
    speedPxPerSecond,
  )];
  let resolvedPosition = linearEnd;
  let resolvedHeading = headingDegrees;
  let transformed = seamTransformed;
  if (!transformed && crossesSeamOnMovement(position.x, linearEnd.x, seamX)) {
    const mirrored = Object.freeze({
      x: LOGICAL_VIEW_WIDTH - linearEnd.x + offsetPx,
      y: linearEnd.y,
    });
    // A zero-time segment is intentional: it samples both sides of a topology
    // discontinuity at the exact crossed tick without inventing a second clock.
    segments.push(motionSegment(
      linearEnd,
      mirrored,
      relativeMs,
      relativeMs,
      speedPxPerSecond,
    ));
    resolvedPosition = mirrored;
    resolvedHeading = 180 - resolvedHeading;
    transformed = true;
  }

  const contactSegments: KinematicMotionSegment[] = [];
  let safeGapEntry: SafeGapEntry | null = null;
  for (const segment of segments) {
    const candidateEntry = firstSafeGapEntryOnSegment(
      pattern,
      difficulty,
      segment,
      collisionRadiusPx,
    );
    if (candidateEntry === null) {
      contactSegments.push(segment);
      continue;
    }
    safeGapEntry = candidateEntry;
    contactSegments.push(motionSegment(
      segment.from,
      candidateEntry.position,
      segment.previousRelativeMs,
      candidateEntry.relativeMs,
      segment.speedPxPerSecond,
    ));
    break;
  }
  let redirected = false;
  if (safeGapEntry !== null) {
    // The immutable oracle supplies the edge snap and signed turn. Production
    // preserves the full linear endpoint/time while continuous collision keeps
    // only the safe prefix before first entry plus the snapped endpoint.
    const center = safeGapCenter(pattern, relativeMs);
    const halfWidth = safeGapWidth(pattern, difficulty) / 2 + collisionRadiusPx + 2;
    // Exact oracle tie policy: an endpoint on the center belongs to the left.
    const side: -1 | 1 = resolvedPosition.x <= center ? -1 : 1;
    if (side !== safeGapEntry.side) {
      throw new Error("Crack seam redirect crossed the entire protected corridor within one tick");
    }
    const redirectedPosition = Object.freeze({
      x: center + side * halfWidth,
      y: resolvedPosition.y,
    });
    segments.push(motionSegment(
      resolvedPosition,
      redirectedPosition,
      relativeMs,
      relativeMs,
      speedPxPerSecond,
    ));
    resolvedPosition = redirectedPosition;
    resolvedHeading += side * 8;
    const remainingMs = relativeMs - safeGapEntry.relativeMs;
    const curvatureBound = remainingMs <= Number.EPSILON
      ? 0
      : Math.abs(pattern.safeGap.path.amplitudePx)
        * (Math.PI * 2 / pattern.safeGap.path.periodMs) ** 2
        * remainingMs ** 2 / 8
        + Number.EPSILON;
    const shiftedEntry = Object.freeze({
      x: safeGapEntry.position.x + side * curvatureBound,
      y: safeGapEntry.position.y,
    });
    const shiftedEnd = Object.freeze({
      x: redirectedPosition.x + side * curvatureBound,
      y: redirectedPosition.y,
    });
    contactSegments.push(motionSegment(
      safeGapEntry.position,
      shiftedEntry,
      safeGapEntry.relativeMs,
      safeGapEntry.relativeMs,
      speedPxPerSecond,
    ));
    contactSegments.push(motionSegment(
      shiftedEntry,
      shiftedEnd,
      safeGapEntry.relativeMs,
      relativeMs,
      speedPxPerSecond,
    ));
    contactSegments.push(motionSegment(
      shiftedEnd,
      redirectedPosition,
      relativeMs,
      relativeMs,
      speedPxPerSecond,
    ));
    redirected = true;
  }
  return Object.freeze({
    position: resolvedPosition,
    headingDegrees: resolvedHeading,
    seamTransformed: transformed,
    redirected,
    segments: Object.freeze(segments),
    contactSegments: Object.freeze(contactSegments),
  });
}

/**
 * Override Void's offset topology is not Crack's mirror/redirect policy.
 * Declaration order is literal: complete the linear sweep, then sample the
 * signed zero-time offset as a second swept primitive while preserving heading.
 */
function integrateOffsetSeamMotion(
  position: Vec2,
  headingDegrees: number,
  speedPxPerSecond: number,
  seamEntry: PatternMotion,
  seamTransformed: boolean,
  previousRelativeMs: number,
  relativeMs: number,
): SeamMotionStep {
  if (seamEntry.params.mode !== "offset") {
    throw new Error("offset seam integrator requires op.seam_transform mode offset");
  }
  const seamX = seamEntry.params.seamX as number;
  const offsetPx = seamEntry.params.offsetPx as number;
  const seconds = (relativeMs - previousRelativeMs) / 1000;
  const radians = degreesToRadians(headingDegrees);
  const linearEnd = Object.freeze({
    x: position.x + Math.cos(radians) * speedPxPerSecond * seconds,
    y: position.y + Math.sin(radians) * speedPxPerSecond * seconds,
  });
  const segments: KinematicMotionSegment[] = [motionSegment(
    position,
    linearEnd,
    previousRelativeMs,
    relativeMs,
    speedPxPerSecond,
  )];
  let resolvedPosition = linearEnd;
  let transformed = seamTransformed;
  if (!transformed && crossesSeamOnMovement(position.x, linearEnd.x, seamX)) {
    const direction = Math.cos(radians) >= 0 ? 1 : -1;
    const offsetEnd = Object.freeze({
      x: linearEnd.x + offsetPx * direction,
      y: linearEnd.y,
    });
    segments.push(motionSegment(
      linearEnd,
      offsetEnd,
      relativeMs,
      relativeMs,
      speedPxPerSecond,
    ));
    resolvedPosition = offsetEnd;
    transformed = true;
  }
  const footprint = Object.freeze(segments);
  return Object.freeze({
    position: resolvedPosition,
    headingDegrees,
    seamTransformed: transformed,
    redirected: false,
    segments: footprint,
    contactSegments: footprint,
  });
}

/**
 * Apply the immutable Python oracle's `operator_constraint` after an emitter's
 * declaration-ordered motion stack. Unlike omission policies, this preserves
 * every candidate and may redirect the same generation again on a later tick.
 */
function applyOperatorConstraint(
  pattern: CombatPattern,
  difficulty: PatternDifficulty,
  position: Vec2,
  headingDegrees: number,
  collisionRadiusPx: number,
  segmentsValue: readonly KinematicMotionSegment[],
  relativeMs: number,
): OperatorConstraintMotionStep {
  const segments = [...segmentsValue];
  const contactSegments: KinematicMotionSegment[] = [];
  let safeGapEntry: SafeGapEntry | null = null;
  for (const segment of segments) {
    const candidateEntry = firstSafeGapEntryOnSegment(
      pattern,
      difficulty,
      segment,
      collisionRadiusPx,
    );
    if (candidateEntry === null) {
      contactSegments.push(segment);
      continue;
    }
    safeGapEntry = candidateEntry;
    contactSegments.push(motionSegment(
      segment.from,
      candidateEntry.position,
      segment.previousRelativeMs,
      candidateEntry.relativeMs,
      segment.speedPxPerSecond,
    ));
    break;
  }
  if (safeGapEntry === null) {
    return Object.freeze({
      position,
      headingDegrees,
      redirected: false,
      segments: Object.freeze(segments),
      contactSegments: Object.freeze(contactSegments),
    });
  }

  const center = safeGapCenter(pattern, relativeMs);
  const halfWidth = safeGapWidth(pattern, difficulty) / 2 + collisionRadiusPx + 2;
  // Exact oracle tie policy: an endpoint on the center belongs to the left.
  const side: -1 | 1 = position.x <= center ? -1 : 1;
  const crossesSides = side !== safeGapEntry.side;
  if (crossesSides && pattern.id !== "encounter.weather_echo.ash_memory") {
    throw new Error(
      `${pattern.id} operator constraint crossed the entire protected corridor within one tick`,
    );
  }
  const redirectedPosition = Object.freeze({
    x: center + side * halfWidth,
    y: position.y,
  });
  const terminalSegment = segments[segments.length - 1];
  const speedPxPerSecond = terminalSegment?.speedPxPerSecond ?? 0;
  segments.push(motionSegment(
    position,
    redirectedPosition,
    relativeMs,
    relativeMs,
    speedPxPerSecond,
  ));

  if (crossesSides) {
    // Ash's first anchor-to-history sweep can enter one side of the moving
    // wake and finish inside the opposite half. The immutable oracle chooses
    // the endpoint side for its snap/heading. Production keeps the first safe
    // prefix and the exact snapped endpoint as disconnected contact pieces;
    // connecting them would reintroduce collision through the protected wake.
    contactSegments.push(motionSegment(
      redirectedPosition,
      redirectedPosition,
      relativeMs,
      relativeMs,
      speedPxPerSecond,
      true,
    ));
    return Object.freeze({
      position: redirectedPosition,
      headingDegrees: headingDegrees + side * 8,
      redirected: true,
      segments: Object.freeze(segments),
      contactSegments: Object.freeze(contactSegments),
    });
  }

  // The moving sine boundary bows away from its endpoint chord. Shift the
  // contact chord outward by a closed-form curvature bound, then return to the
  // exact oracle endpoint through a zero-time segment.
  const remainingMs = relativeMs - safeGapEntry.relativeMs;
  const curvatureBound = remainingMs <= Number.EPSILON
    ? 0
    : Math.abs(pattern.safeGap.path.amplitudePx)
      * (Math.PI * 2 / pattern.safeGap.path.periodMs) ** 2
      * remainingMs ** 2 / 8
      + Number.EPSILON;
  const shiftedEntry = Object.freeze({
    x: safeGapEntry.position.x + side * curvatureBound,
    y: safeGapEntry.position.y,
  });
  const shiftedEnd = Object.freeze({
    x: redirectedPosition.x + side * curvatureBound,
    y: redirectedPosition.y,
  });
  contactSegments.push(motionSegment(
    safeGapEntry.position,
    shiftedEntry,
    safeGapEntry.relativeMs,
    safeGapEntry.relativeMs,
    speedPxPerSecond,
  ));
  contactSegments.push(motionSegment(
    shiftedEntry,
    shiftedEnd,
    safeGapEntry.relativeMs,
    relativeMs,
    speedPxPerSecond,
  ));
  contactSegments.push(motionSegment(
    shiftedEnd,
    redirectedPosition,
    relativeMs,
    relativeMs,
    speedPxPerSecond,
  ));
  return Object.freeze({
    position: redirectedPosition,
    headingDegrees: headingDegrees + side * 8,
    redirected: true,
    segments: Object.freeze(segments),
    contactSegments: Object.freeze(contactSegments),
  });
}

function validateMotionParameters(
  motionEntry: Pick<PatternMotion, "params">,
  expectedKeys: readonly string[],
  path: string,
): void {
  const actualKeys = Object.keys(motionEntry.params).sort(compareText);
  const expected = [...expectedKeys].sort(compareText);
  if (
    actualKeys.length !== expected.length
    || actualKeys.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${path} parameter contract drifted`);
  }
  for (const key of expected) {
    if (typeof motionEntry.params[key] !== "number" || !Number.isFinite(motionEntry.params[key])) {
      throw new Error(`${path}.${key} must be finite`);
    }
  }
}

function captureOrbitRelease(
  motionEntry: Pick<PatternMotion, "params">,
  path: string,
): OrbitReleaseContract {
  validateMotionParameters(
    motionEntry,
    ["angularDegPerSec", "radiusPx", "releaseAtMs", "releaseHeadingDeg"],
    path,
  );
  const radiusPx = requirePositiveFinite(motionEntry.params.radiusPx as number, `${path}.radiusPx`);
  const angularDegPerSec = motionEntry.params.angularDegPerSec as number;
  if (angularDegPerSec === 0 || Object.is(angularDegPerSec, -0)) {
    throw new Error(`${path}.angularDegPerSec must be non-zero without negative zero`);
  }
  const releaseAtMs = requirePositiveFinite(
    motionEntry.params.releaseAtMs as number,
    `${path}.releaseAtMs`,
  );
  const releaseHeadingDeg = motionEntry.params.releaseHeadingDeg as number;
  if (Object.is(releaseHeadingDeg, -0)) {
    throw new Error(`${path}.releaseHeadingDeg must not be negative zero`);
  }
  return Object.freeze({radiusPx, angularDegPerSec, releaseAtMs, releaseHeadingDeg});
}

function orbitReleaseContract(
  motionStack: readonly PatternMotion[],
  path: string,
): OrbitReleaseContract | undefined {
  const orbit = motionStack.find((entry) => entry.operator === "op.orbit_release");
  return orbit === undefined ? undefined : captureOrbitRelease(orbit, path);
}

function assertTurnOnceMotion(
  motionEntry: Pick<PatternMotion, "params">,
  path: string,
): void {
  validateMotionParameters(motionEntry, ["atMs", "deltaDeg"], path);
  requireNonNegativeFinite(
    motionEntry.params.atMs as number,
    `${path}.atMs`,
  );
}

/** Exported for fail-closed contract tests; live validation uses the same path. */
export function validateTurnOnceParameters(params: Readonly<Record<string, unknown>>): void {
  assertTurnOnceMotion({params}, "op.turn_once");
}

function assertPairedFanGeometry(
  geometry: Readonly<Record<string, unknown>>,
  path: string,
): void {
  if (typeof geometry !== "object" || geometry === null || Array.isArray(geometry)) {
    throw new Error(`${path} must be a plain geometry object`);
  }
  const prototype = Object.getPrototypeOf(geometry) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${path} must be a plain geometry object`);
  }
  if (Object.getOwnPropertySymbols(geometry).length > 0) {
    throw new Error(`${path} must not contain symbol keys`);
  }
  const expectedKeys = [
    "baseAngleDeg",
    "count",
    "ordering",
    "spreadDeg",
    "type",
    "variant",
  ];
  const descriptors = Object.getOwnPropertyDescriptors(geometry);
  const actualKeys = Object.keys(descriptors).sort(compareText);
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error(`${path} paired_fan geometry contract drifted`);
  }
  const read = (key: string): unknown => {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new Error(`${path}.${key} must be an own data property`);
    }
    return descriptor.value;
  };
  const type = read("type");
  const ordering = read("ordering");
  const variant = read("variant");
  const count = read("count");
  const baseAngleDeg = read("baseAngleDeg");
  const spreadDeg = read("spreadDeg");
  if (type !== "paired_fan") {
    throw new Error(`${path}.type must be paired_fan`);
  }
  if (ordering !== "clockwise-then-source-index") {
    throw new Error(`${path}.ordering must be clockwise-then-source-index`);
  }
  if (typeof variant !== "string" || variant.length === 0) {
    throw new Error(`${path}.variant must be a non-empty string`);
  }
  requirePositiveInteger(count as number, `${path}.count`);
  requireNonNegativeFinite(baseAngleDeg as number, `${path}.baseAngleDeg`);
  requireNonNegativeFinite(spreadDeg as number, `${path}.spreadDeg`);
}

/** Exported for fail-closed contract tests; production validates the same shape. */
export function validatePairedFanGeometryContract(
  geometry: Readonly<Record<string, unknown>>,
): void {
  assertPairedFanGeometry(geometry, "paired_fan");
}

function assertWallGeometry(
  geometry: Readonly<Record<string, unknown>>,
  path: string,
): void {
  const captured = ownPlainDataRecord(
    geometry,
    ["baseAngleDeg", "count", "ordering", "spreadDeg", "type", "variant"],
    path,
  );
  if (captured.type !== "wall") throw new Error(`${path}.type must be wall`);
  if (captured.ordering !== "clockwise-then-source-index") {
    throw new Error(`${path}.ordering must be clockwise-then-source-index`);
  }
  if (typeof captured.variant !== "string" || captured.variant.length === 0) {
    throw new Error(`${path}.variant must be a non-empty string`);
  }
  requirePositiveInteger(captured.count as number, `${path}.count`);
  requireNonNegativeFinite(captured.baseAngleDeg as number, `${path}.baseAngleDeg`);
  requireNonNegativeFinite(captured.spreadDeg as number, `${path}.spreadDeg`);
}

/** Exported for fail-closed wall-shape tests; production validates the same shape. */
export function validateWallGeometryContract(
  geometry: Readonly<Record<string, unknown>>,
): void {
  assertWallGeometry(geometry, "wall");
}

function assertLineGeometry(
  geometry: Readonly<Record<string, unknown>>,
  path: string,
): void {
  const captured = ownPlainDataRecord(
    geometry,
    ["baseAngleDeg", "count", "ordering", "spreadDeg", "type", "variant"],
    path,
  );
  if (captured.type !== "line") throw new Error(`${path}.type must be line`);
  if (captured.ordering !== "clockwise-then-source-index") {
    throw new Error(`${path}.ordering must be clockwise-then-source-index`);
  }
  if (typeof captured.variant !== "string" || captured.variant.length === 0) {
    throw new Error(`${path}.variant must be a non-empty string`);
  }
  requirePositiveInteger(captured.count as number, `${path}.count`);
  requireNonNegativeFinite(captured.baseAngleDeg as number, `${path}.baseAngleDeg`);
  requireNonNegativeFinite(captured.spreadDeg as number, `${path}.spreadDeg`);
}

/** Exported for fail-closed line-shape tests; production validates the same shape. */
export function validateLineGeometryContract(
  geometry: Readonly<Record<string, unknown>>,
): void {
  assertLineGeometry(geometry, "line");
}

function assertGridGeometry(
  geometry: Readonly<Record<string, unknown>>,
  path: string,
): void {
  const captured = ownPlainDataRecord(
    geometry,
    ["baseAngleDeg", "count", "ordering", "spreadDeg", "type", "variant"],
    path,
  );
  if (captured.type !== "grid") throw new Error(`${path}.type must be grid`);
  if (captured.ordering !== "clockwise-then-source-index") {
    throw new Error(`${path}.ordering must be clockwise-then-source-index`);
  }
  if (typeof captured.variant !== "string" || captured.variant.length === 0) {
    throw new Error(`${path}.variant must be a non-empty string`);
  }
  requirePositiveInteger(captured.count as number, `${path}.count`);
  requireNonNegativeFinite(captured.baseAngleDeg as number, `${path}.baseAngleDeg`);
  requireNonNegativeFinite(captured.spreadDeg as number, `${path}.spreadDeg`);
}

/** Exported for fail-closed grid-shape tests; production validates the same shape. */
export function validateGridGeometryContract(
  geometry: Readonly<Record<string, unknown>>,
): void {
  assertGridGeometry(geometry, "grid");
}

function assertLatticeGeometry(
  geometry: Readonly<Record<string, unknown>>,
  path: string,
): void {
  const captured = ownPlainDataRecord(
    geometry,
    ["baseAngleDeg", "count", "ordering", "spreadDeg", "type", "variant"],
    path,
  );
  if (captured.type !== "lattice") throw new Error(`${path}.type must be lattice`);
  if (captured.ordering !== "clockwise-then-source-index") {
    throw new Error(`${path}.ordering must be clockwise-then-source-index`);
  }
  if (typeof captured.variant !== "string" || captured.variant.length === 0) {
    throw new Error(`${path}.variant must be a non-empty string`);
  }
  requirePositiveInteger(captured.count as number, `${path}.count`);
  requireNonNegativeFinite(captured.baseAngleDeg as number, `${path}.baseAngleDeg`);
  requireNonNegativeFinite(captured.spreadDeg as number, `${path}.spreadDeg`);
}

/** Exported for fail-closed lattice-shape tests; production validates the same shape. */
export function validateLatticeGeometryContract(
  geometry: Readonly<Record<string, unknown>>,
): void {
  assertLatticeGeometry(geometry, "lattice");
}

function assertRingGeometry(
  geometry: Readonly<Record<string, unknown>>,
  path: string,
): void {
  const captured = ownPlainDataRecord(
    geometry,
    ["baseAngleDeg", "count", "ordering", "spreadDeg", "type", "variant"],
    path,
  );
  if (captured.type !== "ring") throw new Error(`${path}.type must be ring`);
  if (captured.ordering !== "clockwise-then-source-index") {
    throw new Error(`${path}.ordering must be clockwise-then-source-index`);
  }
  if (typeof captured.variant !== "string" || captured.variant.length === 0) {
    throw new Error(`${path}.variant must be a non-empty string`);
  }
  requirePositiveInteger(captured.count as number, `${path}.count`);
  requireNonNegativeFinite(captured.baseAngleDeg as number, `${path}.baseAngleDeg`);
  requireNonNegativeFinite(captured.spreadDeg as number, `${path}.spreadDeg`);
}

/** Exported for hostile ring-shape tests; production validates this same path. */
export function validateRingGeometryContract(
  geometry: Readonly<Record<string, unknown>>,
): void {
  assertRingGeometry(geometry, "ring");
}

function assertLateralWallMotion(
  motionEntry: Pick<PatternMotion, "params">,
  path: string,
): void {
  const captured = ownPlainDataRecord(
    motionEntry.params,
    ["driftPxPerSec", "laneCount", "openLane"],
    path,
  );
  const laneCount = requirePositiveInteger(captured.laneCount as number, `${path}.laneCount`);
  const openLane = requireNonNegativeInteger(captured.openLane as number, `${path}.openLane`);
  if (openLane >= laneCount) throw new Error(`${path}.openLane must be smaller than laneCount`);
  if (typeof captured.driftPxPerSec !== "number" || !Number.isFinite(captured.driftPxPerSec)) {
    throw new Error(`${path}.driftPxPerSec must be finite`);
  }
  if (Object.is(captured.driftPxPerSec, -0)) {
    throw new Error(`${path}.driftPxPerSec must not be negative zero`);
  }
}

/** Exported for adversarial parameter tests; live validation uses this exact path. */
export function validateLateralWallParameters(
  params: Readonly<Record<string, unknown>>,
): void {
  assertLateralWallMotion({params}, "op.lateral_wall");
}

function lateralWallAllows(
  candidateIndex: number,
  count: number,
  lateral: PatternMotion,
): boolean {
  const laneCount = lateral.params.laneCount as number;
  const openLane = lateral.params.openLane as number;
  // V4 declares a left-to-right lane lattice but not how a geometry count that
  // differs from laneCount projects into it. Treat every ordered candidate as
  // the center of an equal-width source bin, then map that center into the
  // declared lattice. The bin-center rule avoids a systematic left-edge bias;
  // it is an explicit application adapter where V4 leaves projection unstated.
  const lane = Math.min(
    laneCount - 1,
    Math.floor((candidateIndex + 0.5) * laneCount / Math.max(1, count)),
  );
  return lane !== openLane;
}

function assertHardCutLanePath(pattern: CombatPattern): void {
  if (pattern.id !== "room.polarized.hard_cut_corridor") return;
  if (pattern.safeGap.type !== "hard_lane_swap" || pattern.safeGap.enforcement !== "lane_omission") {
    throw new Error(`${pattern.id} hard-lane safe-gap contract drifted`);
  }
  if (
    pattern.safeGap.minimumWidthPx !== 42
    || pattern.safeGap.path.centerX !== 180
    || pattern.safeGap.path.amplitudePx !== 0
    || pattern.safeGap.path.periodMs !== 4800
    || pattern.safeGap.path.phase !== 0
    || pattern.safeGap.path.maxTravelPxPerSec !== 78
  ) {
    throw new Error(`${pattern.id} hard-lane path inputs drifted`);
  }
  const lanes = ownDenseDataArray(pattern.safeGap.path.laneX, `${pattern.id}.safeGap.path.laneX`);
  const expected = [96, 180, 264] as const;
  if (
    lanes.length !== expected.length
    || lanes.some((value, index) => value !== expected[index])
  ) {
    throw new Error(`${pattern.id}.safeGap.path.laneX contract drifted`);
  }
}

function assertStalePacketRetryContract(pattern: CombatPattern): void {
  if (pattern.id !== "room.information.stale_packet_retry") return;
  const rawPattern = pattern as unknown as Readonly<Record<string, unknown>>;
  const focusMinimumWidthPx = (
    pattern.safeGap as unknown as Readonly<Record<string, unknown>>
  ).focusMinimumWidthPx;
  const safeGapReadability = (
    pattern.safeGap as unknown as Readonly<Record<string, unknown>>
  ).readability as Readonly<Record<string, unknown>>;
  const warningFlashIndependent = (
    pattern.warning as unknown as Readonly<Record<string, unknown>>
  ).flashIndependent;
  const residueDensity = (
    pattern.residue as unknown as Readonly<Record<string, unknown>>
  ).density;
  const accessibility = ownPlainDataRecord(
    rawPattern.accessibility as Readonly<Record<string, unknown>>,
    ["flashOffGameplayParity", "reducedMotionGameplayParity", "telegraphNeverColorOnly"],
    `${pattern.id}.accessibility`,
  );
  const laneX = ownDenseDataArray(
    pattern.safeGap.path.laneX,
    `${pattern.id}.safeGap.path.laneX`,
  );
  const readability = ownPlainDataRecord(
    safeGapReadability,
    ["leadMs", "neverColorOnly"],
    `${pattern.id}.safeGap.readability`,
  );
  if (
    pattern.category !== "ROOM"
    || pattern.room !== "INFORMATION"
    || pattern.durationMs !== 9800
    || pattern.warning.durationMs !== 689
    || pattern.warning.shape !== "broken_packet_columns"
    || warningFlashIndependent !== true
    || pattern.safeGap.type !== "static_void"
    || pattern.safeGap.minimumWidthPx !== 34
    || focusMinimumWidthPx !== 26
    || pattern.safeGap.enforcement !== "spawn_omission"
    || pattern.safeGap.path.centerX !== 180
    || pattern.safeGap.path.amplitudePx !== 0
    || pattern.safeGap.path.periodMs !== 6000
    || pattern.safeGap.path.phase !== 0
    || pattern.safeGap.path.maxTravelPxPerSec !== 78
    || laneX.length !== 0
    || readability.leadMs !== 520
    || readability.neverColorOnly !== true
    || pattern.residue.type !== "packet_dust"
    || pattern.residue.lifetimeMs !== 3978
    || residueDensity !== 0.37
    || accessibility.reducedMotionGameplayParity !== true
    || accessibility.flashOffGameplayParity !== true
    || accessibility.telegraphNeverColorOnly !== true
    || pattern.emitters.length !== 1
  ) {
    throw new Error(`${pattern.id} authored family contract drifted`);
  }
  const timeline = ownDenseDataArray(rawPattern.timeline, `${pattern.id}.timeline`);
  const expectedTimeline = [
    [0, "warning.begin"],
    [689, "collision.arm"],
    [689, "emit.begin"],
    [4900, "pattern.midpoint"],
    [9100, "emit.end"],
    [9380, "residue.commit"],
    [9800, "pattern.complete"],
  ] as const;
  if (timeline.length !== expectedTimeline.length) {
    throw new Error(`${pattern.id} timeline contract drifted`);
  }
  for (let index = 0; index < expectedTimeline.length; index += 1) {
    const expected = expectedTimeline[index];
    const entry = ownPlainDataRecord(
      timeline[index] as Readonly<Record<string, unknown>>,
      ["atMs", "event"],
      `${pattern.id}.timeline[${index}]`,
    );
    if (entry.atMs !== expected?.[0] || entry.event !== expected?.[1]) {
      throw new Error(`${pattern.id} timeline contract drifted`);
    }
  }
  const emitter = pattern.emitters[0];
  const anchorSpace = (
    emitter?.anchor as unknown as Readonly<Record<string, unknown>> | undefined
  )?.space;
  const intraBurstMs = (
    emitter?.cadence as unknown as Readonly<Record<string, unknown>> | undefined
  )?.intraBurstMs;
  if (
    emitter === undefined
    || emitter.id !== "retry-lines"
    || anchorSpace !== "viewport-normalized"
    || emitter.anchor.x !== 0.5
    || emitter.anchor.y !== 0.16
    || emitter.cadence.startMs !== 689
    || emitter.cadence.intervalMs !== 820
    || emitter.cadence.bursts !== 10
    || intraBurstMs !== 0
    || emitter.projectile.archetype !== "bullet.micro.notch_e"
    || emitter.projectile.collisionRadiusPx !== 2
    || emitter.projectile.armDelayMs !== 40
  ) {
    throw new Error(`${pattern.id} retry-lines emitter contract drifted`);
  }
  assertLineGeometry(
    emitter.geometry as unknown as Readonly<Record<string, unknown>>,
    `${pattern.id}/${emitter.id}.geometry`,
  );
  if (
    emitter.geometry.count !== 11
    || emitter.geometry.baseAngleDeg !== 90
    || emitter.geometry.spreadDeg !== 0
    || (emitter.geometry as unknown as Readonly<Record<string, unknown>>).variant
      !== "missing-columns"
  ) {
    throw new Error(`${pattern.id} retry-lines geometry contract drifted`);
  }
  const speedCurve = capturePiecewiseLinearSpeedCurve(
    emitter.speedCurve as unknown as Readonly<Record<string, unknown>>,
    `${pattern.id}/${emitter.id}.speedCurve`,
  );
  if (
    speedCurve.keys.length !== 2
    || speedCurve.keys[0]?.atMs !== 0
    || speedCurve.keys[0]?.pxPerSec !== 126
    || speedCurve.keys[1]?.atMs !== 1120
    || speedCurve.keys[1]?.pxPerSec !== 174
  ) {
    throw new Error(`${pattern.id} piecewise-linear speed curve drifted`);
  }
  if (
    pattern.difficulty.EASY.countMultiplier !== 0.78
    || pattern.difficulty.EASY.speedMultiplier !== 0.88
    || pattern.difficulty.EASY.cadenceMultiplier !== 1.16
    || pattern.difficulty.EASY.gapDeltaPx !== 8
    || pattern.difficulty.NORMAL.countMultiplier !== 1
    || pattern.difficulty.NORMAL.speedMultiplier !== 1
    || pattern.difficulty.NORMAL.cadenceMultiplier !== 1
    || pattern.difficulty.NORMAL.gapDeltaPx !== 0
    || pattern.difficulty.HARD.countMultiplier !== 1.18
    || pattern.difficulty.HARD.speedMultiplier !== 1.12
    || pattern.difficulty.HARD.cadenceMultiplier !== 0.88
    || pattern.difficulty.HARD.gapDeltaPx !== -4
    || pattern.seed.base !== 2259047871
  ) {
    throw new Error(`${pattern.id} difficulty or seed contract drifted`);
  }
}

function assertNotificationOverflowContract(pattern: CombatPattern): void {
  if (pattern.id !== "room.information.notification_overflow") return;
  const rawPattern = pattern as unknown as Readonly<Record<string, unknown>>;
  const rawSafeGap = pattern.safeGap as unknown as Readonly<Record<string, unknown>>;
  const rawWarning = pattern.warning as unknown as Readonly<Record<string, unknown>>;
  const rawResidue = pattern.residue as unknown as Readonly<Record<string, unknown>>;
  const accessibility = ownPlainDataRecord(
    rawPattern.accessibility as Readonly<Record<string, unknown>>,
    ["flashOffGameplayParity", "reducedMotionGameplayParity", "telegraphNeverColorOnly"],
    `${pattern.id}.accessibility`,
  );
  const readability = ownPlainDataRecord(
    rawSafeGap.readability as Readonly<Record<string, unknown>>,
    ["leadMs", "neverColorOnly"],
    `${pattern.id}.safeGap.readability`,
  );
  const laneX = ownDenseDataArray(
    pattern.safeGap.path.laneX,
    `${pattern.id}.safeGap.path.laneX`,
  );
  if (
    pattern.category !== "ROOM"
    || pattern.room !== "INFORMATION"
    || pattern.durationMs !== 11200
    || pattern.warning.durationMs !== 566
    || pattern.warning.shape !== "falling_lane_projection"
    || rawWarning.flashIndependent !== true
    || pattern.safeGap.type !== "moving_window"
    || pattern.safeGap.minimumWidthPx !== 38
    || rawSafeGap.focusMinimumWidthPx !== 30
    || pattern.safeGap.enforcement !== "lane_omission"
    || pattern.safeGap.path.centerX !== 180
    || pattern.safeGap.path.amplitudePx !== 74
    || pattern.safeGap.path.periodMs !== 8400
    || pattern.safeGap.path.phase !== 0
    || pattern.safeGap.path.maxTravelPxPerSec !== 78
    || laneX.length !== 0
    || readability.leadMs !== 520
    || readability.neverColorOnly !== true
    || pattern.residue.type !== "packet_dust"
    || pattern.residue.lifetimeMs !== 2425
    || rawResidue.density !== 0.22
    || accessibility.reducedMotionGameplayParity !== true
    || accessibility.flashOffGameplayParity !== true
    || accessibility.telegraphNeverColorOnly !== true
    || pattern.emitters.length !== 1
  ) {
    throw new Error(`${pattern.id} authored field contract drifted`);
  }

  const timeline = ownDenseDataArray(rawPattern.timeline, `${pattern.id}.timeline`);
  const expectedTimeline = [
    [0, "warning.begin"],
    [566, "collision.arm"],
    [566, "emit.begin"],
    [5600, "pattern.midpoint"],
    [10500, "emit.end"],
    [10780, "residue.commit"],
    [11200, "pattern.complete"],
  ] as const;
  if (timeline.length !== expectedTimeline.length) {
    throw new Error(`${pattern.id} timeline contract drifted`);
  }
  for (let index = 0; index < expectedTimeline.length; index += 1) {
    const expected = expectedTimeline[index];
    const entry = ownPlainDataRecord(
      timeline[index] as Readonly<Record<string, unknown>>,
      ["atMs", "event"],
      `${pattern.id}.timeline[${index}]`,
    );
    if (entry.atMs !== expected?.[0] || entry.event !== expected?.[1]) {
      throw new Error(`${pattern.id} timeline contract drifted`);
    }
  }

  const emitter = pattern.emitters[0];
  const rawEmitter = emitter as unknown as Readonly<Record<string, unknown>> | undefined;
  const anchorSpace = (
    emitter?.anchor as unknown as Readonly<Record<string, unknown>> | undefined
  )?.space;
  const intraBurstMs = (
    emitter?.cadence as unknown as Readonly<Record<string, unknown>> | undefined
  )?.intraBurstMs;
  if (
    emitter === undefined
    || rawEmitter?.kind !== "projectile"
    || emitter.id !== "packet-rain"
    || anchorSpace !== "viewport-normalized"
    || emitter.anchor.x !== 0.5
    || emitter.anchor.y !== 0.02
    || emitter.cadence.startMs !== 566
    || emitter.cadence.intervalMs !== 620
    || emitter.cadence.bursts !== 16
    || intraBurstMs !== 0
    || emitter.projectile.archetype !== "bullet.micro.dash"
    || emitter.projectile.collisionRadiusPx !== 2
    || emitter.projectile.armDelayMs !== 40
  ) {
    throw new Error(`${pattern.id} packet-rain emitter contract drifted`);
  }
  assertGridGeometry(
    emitter.geometry as unknown as Readonly<Record<string, unknown>>,
    `${pattern.id}/${emitter.id}.geometry`,
  );
  if (
    emitter.geometry.count !== 15
    || emitter.geometry.baseAngleDeg !== 90
    || emitter.geometry.spreadDeg !== 0
    || (emitter.geometry as unknown as Readonly<Record<string, unknown>>).variant
      !== "staggered-rain"
  ) {
    throw new Error(`${pattern.id} packet-rain geometry drifted`);
  }
  const speedCurve = capturePiecewiseLinearSpeedCurve(
    emitter.speedCurve as unknown as Readonly<Record<string, unknown>>,
    `${pattern.id}/${emitter.id}.speedCurve`,
  );
  if (
    speedCurve.keys.length !== 2
    || speedCurve.keys[0]?.atMs !== 0
    || speedCurve.keys[0]?.pxPerSec !== 112
    || speedCurve.keys[1]?.atMs !== 1600
    || speedCurve.keys[1]?.pxPerSec !== 154
  ) {
    throw new Error(`${pattern.id} piecewise-linear speed curve drifted`);
  }
  if (
    emitter.motionStack.length !== 3
    || emitter.motionStack[0]?.operator !== "op.lateral_wall"
    || emitter.motionStack[1]?.operator !== "op.local_vector_bias"
    || emitter.motionStack[2]?.operator !== "op.linear"
  ) {
    throw new Error(`${pattern.id} declaration-order motion stack drifted`);
  }
  const lateral = emitter.motionStack[0];
  const localVector = emitter.motionStack[1];
  if (lateral === undefined || localVector === undefined) {
    throw new Error(`${pattern.id} field operators were lost after validation`);
  }
  assertLateralWallMotion(lateral, `${pattern.id}/${emitter.id}.lateral_wall`);
  const capturedLocalVector = captureLocalVectorBias(
    localVector,
    `${pattern.id}/${emitter.id}.local_vector_bias`,
  );
  if (
    lateral.params.laneCount !== 15
    || lateral.params.openLane !== 7
    || lateral.params.driftPxPerSec !== 11
    || capturedLocalVector.vectorPxPerSec[0] !== 12
    || capturedLocalVector.vectorPxPerSec[1] !== 18
    || capturedLocalVector.pulsePeriodMs !== 1800
    || capturedLocalVector.pulseAmount !== 0.45
  ) {
    throw new Error(`${pattern.id} lane or local-vector field drifted`);
  }
  if (
    pattern.difficulty.EASY.countMultiplier !== 0.78
    || pattern.difficulty.EASY.speedMultiplier !== 0.88
    || pattern.difficulty.EASY.cadenceMultiplier !== 1.16
    || pattern.difficulty.EASY.gapDeltaPx !== 8
    || pattern.difficulty.NORMAL.countMultiplier !== 1
    || pattern.difficulty.NORMAL.speedMultiplier !== 1
    || pattern.difficulty.NORMAL.cadenceMultiplier !== 1
    || pattern.difficulty.NORMAL.gapDeltaPx !== 0
    || pattern.difficulty.HARD.countMultiplier !== 1.18
    || pattern.difficulty.HARD.speedMultiplier !== 1.12
    || pattern.difficulty.HARD.cadenceMultiplier !== 0.88
    || pattern.difficulty.HARD.gapDeltaPx !== -4
    || pattern.seed.base !== 1205727364
  ) {
    throw new Error(`${pattern.id} difficulty or seed contract drifted`);
  }
}

/**
 * Exact isolated Rain Echo projectile contract. Real weather remains a
 * presentation-only parallel track; this validator admits no scheduler or
 * weather-derived gameplay input.
 */
export function validateRainPacketsWeatherEchoContract(patternValue: unknown): void {
  const path = "encounter.weather_echo.rain_packets";
  const pattern = ownPlainDataRecord(
    patternValue as Readonly<Record<string, unknown>>,
    [
      "accessibility",
      "cancel",
      "category",
      "clock",
      "difficulty",
      "durationMs",
      "emitters",
      "id",
      "intent",
      "name",
      "residue",
      "room",
      "safeGap",
      "seed",
      "timeline",
      "warning",
      "weatherEchoContract",
    ],
    path,
  );
  const name = ownPlainDataRecord(
    pattern.name as Readonly<Record<string, unknown>>,
    ["en", "zh"],
    `${path}.name`,
  );
  const clock = ownPlainDataRecord(
    pattern.clock as Readonly<Record<string, unknown>>,
    ["authority", "eventDispatch", "pausePolicy", "tickHz", "visualClockSeparated"],
    `${path}.clock`,
  );
  const cancel = ownPlainDataRecord(
    pattern.cancel as Readonly<Record<string, unknown>>,
    ["collisionOffBeforeVisual", "eventIdempotent", "mode", "triggers"],
    `${path}.cancel`,
  );
  const cancelTriggers = ownDenseDataArray(cancel.triggers, `${path}.cancel.triggers`);
  const safeGap = ownPlainDataRecord(
    pattern.safeGap as Readonly<Record<string, unknown>>,
    [
      "compileRule",
      "enforcement",
      "focusMinimumWidthPx",
      "minimumWidthPx",
      "path",
      "readability",
      "type",
    ],
    `${path}.safeGap`,
  );
  const safeGapPath = ownPlainDataRecord(
    safeGap.path as Readonly<Record<string, unknown>>,
    ["amplitudePx", "centerX", "laneX", "maxTravelPxPerSec", "periodMs", "phase"],
    `${path}.safeGap.path`,
  );
  const laneX = ownDenseDataArray(safeGapPath.laneX, `${path}.safeGap.path.laneX`);
  const readability = ownPlainDataRecord(
    safeGap.readability as Readonly<Record<string, unknown>>,
    ["leadMs", "neverColorOnly"],
    `${path}.safeGap.readability`,
  );
  const warning = ownPlainDataRecord(
    pattern.warning as Readonly<Record<string, unknown>>,
    ["collisionEnabled", "coversSweptArea", "durationMs", "flashIndependent", "shape"],
    `${path}.warning`,
  );
  const residue = ownPlainDataRecord(
    pattern.residue as Readonly<Record<string, unknown>>,
    ["density", "gameplayCollision", "inheritsSourceId", "lifetimeMs", "type"],
    `${path}.residue`,
  );
  const accessibility = ownPlainDataRecord(
    pattern.accessibility as Readonly<Record<string, unknown>>,
    ["flashOffGameplayParity", "reducedMotionGameplayParity", "telegraphNeverColorOnly"],
    `${path}.accessibility`,
  );
  const seed = ownPlainDataRecord(
    pattern.seed as Readonly<Record<string, unknown>>,
    ["algorithm", "base", "composition", "disallowedInputs", "randomCalls"],
    `${path}.seed`,
  );
  const disallowedInputs = ownDenseDataArray(seed.disallowedInputs, `${path}.seed.disallowedInputs`);
  const weatherEcho = ownPlainDataRecord(
    pattern.weatherEchoContract as Readonly<Record<string, unknown>>,
    [
      "runsParallelToWeather",
      "schedulingAuthority",
      "seedAuthority",
      "visualSource",
      "weatherEventCanAlterCollision",
      "weatherEventCanAlterMotion",
      "weatherEventCanAlterSafeGap",
      "weatherEventCanSpawnProjectile",
      "weatherEventCanTrigger",
      "weatherRngUsed",
    ],
    `${path}.weatherEchoContract`,
  );
  if (
    pattern.id !== path
    || pattern.category !== "WEATHER_ECHO"
    || pattern.room !== "COMMON"
    || name.zh !== "雨的回声"
    || name.en !== "Rain echo encounter"
    || pattern.intent !== "独立遭遇借用雨的下落语汇；真实天气不能生成、移动或重定向这些弹体。"
    || pattern.durationMs !== 9400
    || clock.authority !== "GAMEPLAY"
    || clock.tickHz !== 120
    || clock.eventDispatch !== "crossed-time-exactly-once"
    || clock.pausePolicy !== "freeze"
    || clock.visualClockSeparated !== true
    || cancelTriggers.length !== 4
    || cancelTriggers[0] !== "pattern_end"
    || cancelTriggers[1] !== "source_withdrawn"
    || cancelTriggers[2] !== "override_void"
    || cancelTriggers[3] !== "room_transition"
    || cancel.mode !== "digital_cancel_to_material_residue"
    || cancel.collisionOffBeforeVisual !== true
    || cancel.eventIdempotent !== true
    || warning.durationMs !== 742
    || warning.shape !== "rainfall_projection"
    || warning.coversSweptArea !== true
    || warning.collisionEnabled !== false
    || warning.flashIndependent !== true
    || safeGap.type !== "rain_lee"
    || safeGap.minimumWidthPx !== 38
    || safeGap.focusMinimumWidthPx !== 30
    || safeGap.enforcement !== "lane_omission"
    || safeGap.compileRule
      !== "omit, gate, redirect, or visibly cancel any candidate whose swept circle violates the corridor envelope"
    || safeGapPath.centerX !== 180
    || safeGapPath.amplitudePx !== 46
    || safeGapPath.periodMs !== 8200
    || safeGapPath.phase !== 0
    || safeGapPath.maxTravelPxPerSec !== 78
    || laneX.length !== 0
    || readability.leadMs !== 520
    || readability.neverColorOnly !== true
    || residue.type !== "wet_packet_pulp"
    || residue.lifetimeMs !== 3793
    || residue.density !== 0.21
    || residue.inheritsSourceId !== true
    || residue.gameplayCollision !== false
    || accessibility.reducedMotionGameplayParity !== true
    || accessibility.flashOffGameplayParity !== true
    || accessibility.telegraphNeverColorOnly !== true
    || seed.algorithm !== "mulberry32-v1"
    || seed.base !== 1771200059
    || seed.composition !== "runSeed xor base xor encounterOrdinal xor difficultySalt"
    || seed.randomCalls !== "emitter-order then burst-order then projectile-order"
    || disallowedInputs.length !== 3
    || disallowedInputs[0] !== "weatherEvent"
    || disallowedInputs[1] !== "weatherSeed"
    || disallowedInputs[2] !== "weatherRng"
    || weatherEcho.visualSource !== "RAIN"
    || weatherEcho.schedulingAuthority !== "director.encounter.v4"
    || weatherEcho.runsParallelToWeather !== true
    || weatherEcho.weatherEventCanTrigger !== false
    || weatherEcho.weatherEventCanSpawnProjectile !== false
    || weatherEcho.weatherEventCanAlterMotion !== false
    || weatherEcho.weatherEventCanAlterCollision !== false
    || weatherEcho.weatherEventCanAlterSafeGap !== false
    || weatherEcho.weatherRngUsed !== false
    || weatherEcho.seedAuthority !== "pattern.seed only"
  ) {
    throw new Error(`${path} authored weather-echo contract drifted`);
  }

  const timeline = ownDenseDataArray(pattern.timeline, `${path}.timeline`);
  const expectedTimeline = [
    [0, "warning.begin"],
    [742, "collision.arm"],
    [742, "emit.begin"],
    [4700, "pattern.midpoint"],
    [8700, "emit.end"],
    [8980, "residue.commit"],
    [9400, "pattern.complete"],
  ] as const;
  if (timeline.length !== expectedTimeline.length) {
    throw new Error(`${path} timeline contract drifted`);
  }
  for (let index = 0; index < expectedTimeline.length; index += 1) {
    const entry = ownPlainDataRecord(
      timeline[index] as Readonly<Record<string, unknown>>,
      ["atMs", "event"],
      `${path}.timeline[${index}]`,
    );
    if (entry.atMs !== expectedTimeline[index]?.[0] || entry.event !== expectedTimeline[index]?.[1]) {
      throw new Error(`${path} timeline contract drifted`);
    }
  }

  const emitters = ownDenseDataArray(pattern.emitters, `${path}.emitters`);
  if (emitters.length !== 1) throw new Error(`${path} emitter contract drifted`);
  const emitter = ownPlainDataRecord(
    emitters[0] as Readonly<Record<string, unknown>>,
    ["anchor", "cadence", "geometry", "id", "kind", "motionStack", "projectile", "speedCurve"],
    `${path}.emitters[0]`,
  );
  const anchor = ownPlainDataRecord(
    emitter.anchor as Readonly<Record<string, unknown>>,
    ["space", "x", "y"],
    `${path}/rain.anchor`,
  );
  const cadence = ownPlainDataRecord(
    emitter.cadence as Readonly<Record<string, unknown>>,
    ["bursts", "intervalMs", "intraBurstMs", "startMs"],
    `${path}/rain.cadence`,
  );
  const geometry = ownPlainDataRecord(
    emitter.geometry as Readonly<Record<string, unknown>>,
    ["baseAngleDeg", "count", "ordering", "spreadDeg", "type", "variant"],
    `${path}/rain.geometry`,
  );
  const projectile = ownPlainDataRecord(
    emitter.projectile as Readonly<Record<string, unknown>>,
    ["archetype", "armDelayMs", "collisionRadiusPx"],
    `${path}/rain.projectile`,
  );
  const speedCurve = capturePiecewiseLinearSpeedCurve(
    emitter.speedCurve as Readonly<Record<string, unknown>>,
    `${path}/rain.speedCurve`,
  );
  const motionStack = ownDenseDataArray(emitter.motionStack, `${path}/rain.motionStack`);
  if (motionStack.length !== 2) throw new Error(`${path} motion stack drifted`);
  const localVectorEntry = ownPlainDataRecord(
    motionStack[0] as Readonly<Record<string, unknown>>,
    ["operator", "params"],
    `${path}/rain.motionStack[0]`,
  );
  const linearEntry = ownPlainDataRecord(
    motionStack[1] as Readonly<Record<string, unknown>>,
    ["operator", "params"],
    `${path}/rain.motionStack[1]`,
  );
  if (localVectorEntry.operator !== "op.local_vector_bias" || linearEntry.operator !== "op.linear") {
    throw new Error(`${path} motion declaration order drifted`);
  }
  const localVector = captureLocalVectorBias(
    {params: localVectorEntry.params as Readonly<Record<string, unknown>>},
    `${path}/rain.local_vector_bias`,
  );
  validateMotionParameters(
    {params: linearEntry.params as Readonly<Record<string, unknown>>},
    [],
    `${path}/rain.linear`,
  );
  if (
    emitter.id !== "rain"
    || emitter.kind !== "projectile"
    || anchor.space !== "viewport-normalized"
    || anchor.x !== 0.5
    || anchor.y !== 0
    || geometry.type !== "grid"
    || geometry.variant !== "uneven-droplets"
    || geometry.count !== 13
    || geometry.baseAngleDeg !== 90
    || geometry.spreadDeg !== 0
    || geometry.ordering !== "clockwise-then-source-index"
    || cadence.startMs !== 742
    || cadence.intervalMs !== 540
    || cadence.bursts !== 15
    || cadence.intraBurstMs !== 0
    || projectile.archetype !== "bullet.micro.dash"
    || projectile.collisionRadiusPx !== 2
    || projectile.armDelayMs !== 40
    || speedCurve.keys.length !== 1
    || speedCurve.keys[0]?.atMs !== 0
    || speedCurve.keys[0]?.pxPerSec !== 126
    || localVector.vectorPxPerSec[0] !== 8
    || localVector.vectorPxPerSec[1] !== 30
    || localVector.pulsePeriodMs !== 2100
    || localVector.pulseAmount !== 0.35
  ) {
    throw new Error(`${path} rain emitter contract drifted`);
  }

  const difficulty = ownPlainDataRecord(
    pattern.difficulty as Readonly<Record<string, unknown>>,
    ["EASY", "HARD", "NORMAL"],
    `${path}.difficulty`,
  );
  const expectedDifficulty = {
    EASY: [0.78, 0.88, 1.16, 8],
    NORMAL: [1, 1, 1, 0],
    HARD: [1.18, 1.12, 0.88, -4],
  } as const;
  for (const profileId of ["EASY", "NORMAL", "HARD"] as const) {
    const profile = ownPlainDataRecord(
      difficulty[profileId] as Readonly<Record<string, unknown>>,
      ["cadenceMultiplier", "countMultiplier", "gapDeltaPx", "speedMultiplier"],
      `${path}.difficulty.${profileId}`,
    );
    const expected = expectedDifficulty[profileId];
    if (
      profile.countMultiplier !== expected[0]
      || profile.speedMultiplier !== expected[1]
      || profile.cadenceMultiplier !== expected[2]
      || profile.gapDeltaPx !== expected[3]
    ) {
      throw new Error(`${path} difficulty contract drifted`);
    }
  }
}

function assertWindBiasWeatherEchoContract(pattern: CombatPattern): void {
  if (pattern.id !== "encounter.weather_echo.wind_bias") return;
  const rawPattern = ownPlainDataRecord(
    pattern as unknown as Readonly<Record<string, unknown>>,
    [
      "accessibility",
      "cancel",
      "category",
      "clock",
      "difficulty",
      "durationMs",
      "emitters",
      "id",
      "intent",
      "name",
      "residue",
      "room",
      "safeGap",
      "seed",
      "timeline",
      "warning",
      "weatherEchoContract",
    ],
    pattern.id,
  );
  const name = ownPlainDataRecord(
    rawPattern.name as Readonly<Record<string, unknown>>,
    ["en", "zh"],
    `${pattern.id}.name`,
  );
  const clock = ownPlainDataRecord(
    rawPattern.clock as Readonly<Record<string, unknown>>,
    ["authority", "eventDispatch", "pausePolicy", "tickHz", "visualClockSeparated"],
    `${pattern.id}.clock`,
  );
  const cancel = ownPlainDataRecord(
    rawPattern.cancel as Readonly<Record<string, unknown>>,
    ["collisionOffBeforeVisual", "eventIdempotent", "mode", "triggers"],
    `${pattern.id}.cancel`,
  );
  const cancelTriggers = ownDenseDataArray(cancel.triggers, `${pattern.id}.cancel.triggers`);
  const safeGap = ownPlainDataRecord(
    rawPattern.safeGap as Readonly<Record<string, unknown>>,
    [
      "compileRule",
      "enforcement",
      "focusMinimumWidthPx",
      "minimumWidthPx",
      "path",
      "readability",
      "type",
    ],
    `${pattern.id}.safeGap`,
  );
  const safeGapPath = ownPlainDataRecord(
    safeGap.path as Readonly<Record<string, unknown>>,
    ["amplitudePx", "centerX", "laneX", "maxTravelPxPerSec", "periodMs", "phase"],
    `${pattern.id}.safeGap.path`,
  );
  const laneX = ownDenseDataArray(safeGapPath.laneX, `${pattern.id}.safeGap.path.laneX`);
  const readability = ownPlainDataRecord(
    safeGap.readability as Readonly<Record<string, unknown>>,
    ["leadMs", "neverColorOnly"],
    `${pattern.id}.safeGap.readability`,
  );
  const warning = ownPlainDataRecord(
    rawPattern.warning as Readonly<Record<string, unknown>>,
    ["collisionEnabled", "coversSweptArea", "durationMs", "flashIndependent", "shape"],
    `${pattern.id}.warning`,
  );
  const residue = ownPlainDataRecord(
    rawPattern.residue as Readonly<Record<string, unknown>>,
    ["density", "gameplayCollision", "inheritsSourceId", "lifetimeMs", "type"],
    `${pattern.id}.residue`,
  );
  const accessibility = ownPlainDataRecord(
    rawPattern.accessibility as Readonly<Record<string, unknown>>,
    ["flashOffGameplayParity", "reducedMotionGameplayParity", "telegraphNeverColorOnly"],
    `${pattern.id}.accessibility`,
  );
  const seed = ownPlainDataRecord(
    rawPattern.seed as Readonly<Record<string, unknown>>,
    ["algorithm", "base", "composition", "disallowedInputs", "randomCalls"],
    `${pattern.id}.seed`,
  );
  const disallowedInputs = ownDenseDataArray(
    seed.disallowedInputs,
    `${pattern.id}.seed.disallowedInputs`,
  );
  const weatherEcho = ownPlainDataRecord(
    rawPattern.weatherEchoContract as Readonly<Record<string, unknown>>,
    [
      "runsParallelToWeather",
      "schedulingAuthority",
      "seedAuthority",
      "visualSource",
      "weatherEventCanAlterCollision",
      "weatherEventCanAlterMotion",
      "weatherEventCanAlterSafeGap",
      "weatherEventCanSpawnProjectile",
      "weatherEventCanTrigger",
      "weatherRngUsed",
    ],
    `${pattern.id}.weatherEchoContract`,
  );
  if (
    pattern.category !== "WEATHER_ECHO"
    || pattern.room !== "COMMON"
    || name.zh !== "风的回声"
    || name.en !== "Wind echo encounter"
    || rawPattern.intent
      !== "局部向量偏置在 pattern 编译时固定；真实风天气不能改写任何弹体或安全通道。"
    || pattern.durationMs !== 9600
    || clock.authority !== "GAMEPLAY"
    || clock.tickHz !== 120
    || clock.eventDispatch !== "crossed-time-exactly-once"
    || clock.pausePolicy !== "freeze"
    || clock.visualClockSeparated !== true
    || cancelTriggers.length !== 4
    || cancelTriggers[0] !== "pattern_end"
    || cancelTriggers[1] !== "source_withdrawn"
    || cancelTriggers[2] !== "override_void"
    || cancelTriggers[3] !== "room_transition"
    || cancel.mode !== "digital_cancel_to_material_residue"
    || cancel.collisionOffBeforeVisual !== true
    || cancel.eventIdempotent !== true
    || warning.durationMs !== 578
    || warning.shape !== "maximum_advection_envelope"
    || warning.coversSweptArea !== true
    || warning.collisionEnabled !== false
    || warning.flashIndependent !== true
    || safeGap.type !== "wind_lee"
    || safeGap.minimumWidthPx !== 36
    || safeGap.focusMinimumWidthPx !== 28
    || safeGap.enforcement !== "spawn_omission"
    || safeGap.compileRule
      !== "omit, gate, redirect, or visibly cancel any candidate whose swept circle violates the corridor envelope"
    || safeGapPath.centerX !== 180
    || safeGapPath.amplitudePx !== 70
    || safeGapPath.periodMs !== 8800
    || safeGapPath.phase !== 0
    || safeGapPath.maxTravelPxPerSec !== 78
    || laneX.length !== 0
    || readability.leadMs !== 520
    || readability.neverColorOnly !== true
    || residue.type !== "wind_polished_grain"
    || residue.lifetimeMs !== 3143
    || residue.density !== 0.44
    || residue.inheritsSourceId !== true
    || residue.gameplayCollision !== false
    || accessibility.reducedMotionGameplayParity !== true
    || accessibility.flashOffGameplayParity !== true
    || accessibility.telegraphNeverColorOnly !== true
    || seed.algorithm !== "mulberry32-v1"
    || seed.base !== 1709396168
    || seed.composition !== "runSeed xor base xor encounterOrdinal xor difficultySalt"
    || seed.randomCalls !== "emitter-order then burst-order then projectile-order"
    || disallowedInputs.length !== 3
    || disallowedInputs[0] !== "weatherEvent"
    || disallowedInputs[1] !== "weatherSeed"
    || disallowedInputs[2] !== "weatherRng"
    || weatherEcho.visualSource !== "WIND"
    || weatherEcho.schedulingAuthority !== "director.encounter.v4"
    || weatherEcho.runsParallelToWeather !== true
    || weatherEcho.weatherEventCanTrigger !== false
    || weatherEcho.weatherEventCanSpawnProjectile !== false
    || weatherEcho.weatherEventCanAlterMotion !== false
    || weatherEcho.weatherEventCanAlterCollision !== false
    || weatherEcho.weatherEventCanAlterSafeGap !== false
    || weatherEcho.weatherRngUsed !== false
    || weatherEcho.seedAuthority !== "pattern.seed only"
    || pattern.emitters.length !== 1
  ) {
    throw new Error(`${pattern.id} authored weather-echo contract drifted`);
  }

  const timeline = ownDenseDataArray(rawPattern.timeline, `${pattern.id}.timeline`);
  const expectedTimeline = [
    [0, "warning.begin"],
    [578, "collision.arm"],
    [578, "emit.begin"],
    [4800, "pattern.midpoint"],
    [8900, "emit.end"],
    [9180, "residue.commit"],
    [9600, "pattern.complete"],
  ] as const;
  if (timeline.length !== expectedTimeline.length) {
    throw new Error(`${pattern.id} timeline contract drifted`);
  }
  for (let index = 0; index < expectedTimeline.length; index += 1) {
    const expected = expectedTimeline[index];
    const entry = ownPlainDataRecord(
      timeline[index] as Readonly<Record<string, unknown>>,
      ["atMs", "event"],
      `${pattern.id}.timeline[${index}]`,
    );
    if (entry.atMs !== expected?.[0] || entry.event !== expected?.[1]) {
      throw new Error(`${pattern.id} timeline contract drifted`);
    }
  }

  const emitter = pattern.emitters[0];
  if (emitter === undefined) throw new Error(`${pattern.id} lost its wind-seeds emitter`);
  const rawEmitter = ownPlainDataRecord(
    emitter as unknown as Readonly<Record<string, unknown>>,
    ["anchor", "cadence", "geometry", "id", "kind", "motionStack", "projectile", "speedCurve"],
    `${pattern.id}.emitters[0]`,
  );
  const anchor = ownPlainDataRecord(
    rawEmitter.anchor as Readonly<Record<string, unknown>>,
    ["space", "x", "y"],
    `${pattern.id}/${emitter.id}.anchor`,
  );
  const cadence = ownPlainDataRecord(
    rawEmitter.cadence as Readonly<Record<string, unknown>>,
    ["bursts", "intervalMs", "intraBurstMs", "startMs"],
    `${pattern.id}/${emitter.id}.cadence`,
  );
  const projectile = ownPlainDataRecord(
    rawEmitter.projectile as Readonly<Record<string, unknown>>,
    ["archetype", "armDelayMs", "collisionRadiusPx"],
    `${pattern.id}/${emitter.id}.projectile`,
  );
  const geometry = ownPlainDataRecord(
    rawEmitter.geometry as Readonly<Record<string, unknown>>,
    ["baseAngleDeg", "count", "ordering", "spreadDeg", "type", "variant"],
    `${pattern.id}/${emitter.id}.geometry`,
  );
  const speedCurve = capturePiecewiseLinearSpeedCurve(
    emitter.speedCurve as unknown as Readonly<Record<string, unknown>>,
    `${pattern.id}/${emitter.id}.speedCurve`,
  );
  const motionStack = ownDenseDataArray(rawEmitter.motionStack, `${pattern.id}/${emitter.id}.motionStack`);
  const localVector = emitter.motionStack[0];
  const linear = emitter.motionStack[1];
  if (
    emitter.id !== "wind-seeds"
    || rawEmitter.kind !== "projectile"
    || anchor.space !== "viewport-normalized"
    || anchor.x !== 0.42
    || anchor.y !== 0.12
    || geometry.type !== "arc"
    || geometry.variant !== "advected-seeds"
    || geometry.count !== 10
    || geometry.baseAngleDeg !== 90
    || geometry.spreadDeg !== 134
    || geometry.ordering !== "clockwise-then-source-index"
    || cadence.startMs !== 578
    || cadence.intervalMs !== 920
    || cadence.bursts !== 9
    || cadence.intraBurstMs !== 0
    || projectile.archetype !== "bullet.micro.seed"
    || projectile.collisionRadiusPx !== 2
    || projectile.armDelayMs !== 40
    || speedCurve.keys.length !== 1
    || speedCurve.keys[0]?.atMs !== 0
    || speedCurve.keys[0]?.pxPerSec !== 144
    || motionStack.length !== 2
    || localVector?.operator !== "op.local_vector_bias"
    || linear?.operator !== "op.linear"
  ) {
    throw new Error(`${pattern.id} wind-seeds emitter contract drifted`);
  }
  const capturedLocalVector = captureLocalVectorBias(
    localVector,
    `${pattern.id}/${emitter.id}.local_vector_bias`,
  );
  validateMotionParameters(linear, [], `${pattern.id}/${emitter.id}.linear`);
  if (
    capturedLocalVector.vectorPxPerSec[0] !== 34
    || capturedLocalVector.vectorPxPerSec[1] !== 4
    || capturedLocalVector.pulsePeriodMs !== 1600
    || capturedLocalVector.pulseAmount !== 0.6
    || pattern.difficulty.EASY.countMultiplier !== 0.78
    || pattern.difficulty.EASY.speedMultiplier !== 0.88
    || pattern.difficulty.EASY.cadenceMultiplier !== 1.16
    || pattern.difficulty.EASY.gapDeltaPx !== 8
    || pattern.difficulty.NORMAL.countMultiplier !== 1
    || pattern.difficulty.NORMAL.speedMultiplier !== 1
    || pattern.difficulty.NORMAL.cadenceMultiplier !== 1
    || pattern.difficulty.NORMAL.gapDeltaPx !== 0
    || pattern.difficulty.HARD.countMultiplier !== 1.18
    || pattern.difficulty.HARD.speedMultiplier !== 1.12
    || pattern.difficulty.HARD.cadenceMultiplier !== 0.88
    || pattern.difficulty.HARD.gapDeltaPx !== -4
  ) {
    throw new Error(`${pattern.id} field or difficulty contract drifted`);
  }
}

function assertAbsentReceiverQueryContract(pattern: CombatPattern): void {
  if (pattern.id !== "boss.absent_receiver.phase1") return;
  const rawPattern = pattern as unknown as Readonly<Record<string, unknown>>;
  const safeGap = pattern.safeGap as unknown as Readonly<Record<string, unknown>>;
  const warning = pattern.warning as unknown as Readonly<Record<string, unknown>>;
  const residue = pattern.residue as unknown as Readonly<Record<string, unknown>>;
  const accessibility = ownPlainDataRecord(
    rawPattern.accessibility as Readonly<Record<string, unknown>>,
    ["flashOffGameplayParity", "reducedMotionGameplayParity", "telegraphNeverColorOnly"],
    `${pattern.id}.accessibility`,
  );
  const readability = ownPlainDataRecord(
    safeGap.readability as Readonly<Record<string, unknown>>,
    ["leadMs", "neverColorOnly"],
    `${pattern.id}.safeGap.readability`,
  );
  const laneX = ownDenseDataArray(
    pattern.safeGap.path.laneX,
    `${pattern.id}.safeGap.path.laneX`,
  );
  if (
    pattern.category !== "BOSS"
    || pattern.room !== "INFORMATION"
    || pattern.durationMs !== 10800
    || pattern.warning.durationMs !== 773
    || pattern.warning.shape !== "outbound-retry_swept_union"
    || warning.flashIndependent !== true
    || pattern.safeGap.type !== "static_void"
    || pattern.safeGap.minimumWidthPx !== 30
    || safeGap.focusMinimumWidthPx !== 22
    || pattern.safeGap.enforcement !== "spawn_omission"
    || pattern.safeGap.path.centerX !== 180
    || pattern.safeGap.path.amplitudePx !== 18
    || pattern.safeGap.path.periodMs !== 5200
    || pattern.safeGap.path.phase !== 0
    || pattern.safeGap.path.maxTravelPxPerSec !== 78
    || laneX.length !== 0
    || readability.leadMs !== 520
    || readability.neverColorOnly !== true
    || pattern.residue.type !== "absent_receiver_material_trace"
    || pattern.residue.lifetimeMs !== 2391
    || residue.density !== 0.39
    || pattern.laserGeometry !== "laser.broken_packet_polyline"
    || accessibility.reducedMotionGameplayParity !== true
    || accessibility.flashOffGameplayParity !== true
    || accessibility.telegraphNeverColorOnly !== true
    || pattern.emitters.length !== 1
  ) {
    throw new Error(`${pattern.id} authored query-phase contract drifted`);
  }

  const resolutionHook = ownPlainDataRecord(
    rawPattern.resolutionHook as Readonly<Record<string, unknown>>,
    ["canonicalBossId", "condition", "narrativeAlias", "resolutionId", "terminalEvent", "type"],
    `${pattern.id}.resolutionHook`,
  );
  if (
    resolutionHook.type !== "phase_evidence"
    || resolutionHook.canonicalBossId !== "boss.absent_receiver"
    || resolutionHook.narrativeAlias !== "absent_receiver"
    || resolutionHook.resolutionId !== "RECEIVER_TIMED_OUT"
    || resolutionHook.condition !== "absent_receiver.phaseEvidence>=1"
    || resolutionHook.terminalEvent !== null
  ) {
    throw new Error(`${pattern.id} resolution hook drifted`);
  }

  const timeline = ownDenseDataArray(rawPattern.timeline, `${pattern.id}.timeline`);
  const expectedTimeline = [
    [0, "warning.begin"],
    [773, "collision.arm"],
    [773, "emit.begin"],
    [5400, "pattern.midpoint"],
    [10100, "emit.end"],
    [10380, "residue.commit"],
    [10800, "pattern.complete"],
  ] as const;
  if (timeline.length !== expectedTimeline.length) {
    throw new Error(`${pattern.id} timeline contract drifted`);
  }
  for (let index = 0; index < expectedTimeline.length; index += 1) {
    const expected = expectedTimeline[index];
    const entry = ownPlainDataRecord(
      timeline[index] as Readonly<Record<string, unknown>>,
      ["atMs", "event"],
      `${pattern.id}.timeline[${index}]`,
    );
    if (entry.atMs !== expected?.[0] || entry.event !== expected?.[1]) {
      throw new Error(`${pattern.id} timeline contract drifted`);
    }
  }

  const emitter = pattern.emitters[0];
  const anchorSpace = (
    emitter?.anchor as unknown as Readonly<Record<string, unknown>> | undefined
  )?.space;
  const intraBurstMs = (
    emitter?.cadence as unknown as Readonly<Record<string, unknown>> | undefined
  )?.intraBurstMs;
  if (
    emitter === undefined
    || emitter.id !== "absent_receiver-p1-primary"
    || anchorSpace !== "viewport-normalized"
    || emitter.anchor.x !== 0.34
    || emitter.anchor.y !== 0.1
    || emitter.geometry.type !== "arc"
    || (emitter.geometry as unknown as Readonly<Record<string, unknown>>).variant !== "outbound-retry"
    || emitter.geometry.count !== 7
    || emitter.geometry.baseAngleDeg !== 82
    || emitter.geometry.spreadDeg !== 72
    || (emitter.geometry as unknown as Readonly<Record<string, unknown>>).ordering
      !== "clockwise-then-source-index"
    || emitter.cadence.startMs !== 773
    || emitter.cadence.intervalMs !== 720
    || emitter.cadence.bursts !== 12
    || intraBurstMs !== 0
    || emitter.projectile.archetype !== "bullet.micro.notch_e"
    || emitter.projectile.collisionRadiusPx !== 2
    || emitter.projectile.armDelayMs !== 40
  ) {
    throw new Error(`${pattern.id} primary emitter contract drifted`);
  }
  const speedCurve = capturePiecewiseLinearSpeedCurve(
    emitter.speedCurve as unknown as Readonly<Record<string, unknown>>,
    `${pattern.id}/${emitter.id}.speedCurve`,
  );
  if (
    speedCurve.keys.length !== 1
    || speedCurve.keys[0]?.atMs !== 0
    || speedCurve.keys[0]?.pxPerSec !== 142
  ) {
    throw new Error(`${pattern.id} speed curve drifted`);
  }
  if (
    pattern.difficulty.EASY.countMultiplier !== 0.78
    || pattern.difficulty.EASY.speedMultiplier !== 0.88
    || pattern.difficulty.EASY.cadenceMultiplier !== 1.16
    || pattern.difficulty.EASY.gapDeltaPx !== 8
    || pattern.difficulty.NORMAL.countMultiplier !== 1
    || pattern.difficulty.NORMAL.speedMultiplier !== 1
    || pattern.difficulty.NORMAL.cadenceMultiplier !== 1
    || pattern.difficulty.NORMAL.gapDeltaPx !== 0
    || pattern.difficulty.HARD.countMultiplier !== 1.18
    || pattern.difficulty.HARD.speedMultiplier !== 1.12
    || pattern.difficulty.HARD.cadenceMultiplier !== 0.88
    || pattern.difficulty.HARD.gapDeltaPx !== -4
    || pattern.seed.base !== 3098162237
  ) {
    throw new Error(`${pattern.id} difficulty or seed contract drifted`);
  }
}

/** Exact source contract for the isolated V4 Override Void pattern. */
const OVERRIDE_VOID_PATTERN_CONTRACT = deepFreezeJson({
  id: "transition.override_void",
  category: "TRANSITION",
  room: "TRANSITION",
  name: {zh: "局部负空间", en: "Local override void"},
  intent: "定向 Void 只取消穿过其扇区的规则，取消位置写入 scar。",
  durationMs: 7600,
  clock: {
    authority: "GAMEPLAY",
    tickHz: 120,
    eventDispatch: "crossed-time-exactly-once",
    pausePolicy: "freeze",
    visualClockSeparated: true,
  },
  timeline: [
    {atMs: 0, event: "warning.begin"},
    {atMs: 694, event: "collision.arm"},
    {atMs: 694, event: "emit.begin"},
    {atMs: 3800, event: "pattern.midpoint"},
    {atMs: 6900, event: "emit.end"},
    {atMs: 7180, event: "residue.commit"},
    {atMs: 7600, event: "pattern.complete"},
  ],
  emitters: [{
    id: "rule-field",
    kind: "projectile",
    anchor: {space: "viewport-normalized", x: 0.5, y: 0.2},
    geometry: {
      type: "ring",
      variant: "scar-breakable-ring",
      count: 16,
      baseAngleDeg: 90,
      spreadDeg: 300,
      ordering: "clockwise-then-source-index",
    },
    cadence: {startMs: 694, intervalMs: 1700, bursts: 4, intraBurstMs: 0},
    projectile: {
      archetype: "bullet.micro.notch_e",
      collisionRadiusPx: 2,
      armDelayMs: 40,
    },
    speedCurve: {type: "piecewise-linear", keys: [{atMs: 0, pxPerSec: 132}]},
    motionStack: [
      {operator: "op.linear", params: {}},
      {operator: "op.seam_transform", params: {seamX: 180, mode: "offset", offsetPx: 22}},
    ],
  }],
  safeGap: {
    type: "directional_override",
    minimumWidthPx: 48,
    focusMinimumWidthPx: 40,
    path: {
      centerX: 180,
      amplitudePx: 34,
      periodMs: 7600,
      phase: 0,
      laneX: [],
      maxTravelPxPerSec: 78,
    },
    enforcement: "rule_clip_with_residue",
    compileRule:
      "omit, gate, redirect, or visibly cancel any candidate whose swept circle violates the corridor envelope",
    readability: {leadMs: 520, neverColorOnly: true},
  },
  warning: {
    durationMs: 694,
    shape: "directional_void_wedge",
    coversSweptArea: true,
    collisionEnabled: false,
    flashIndependent: true,
  },
  cancel: {
    triggers: ["pattern_end", "source_withdrawn", "override_void", "room_transition"],
    mode: "digital_cancel_to_material_residue",
    collisionOffBeforeVisual: true,
    eventIdempotent: true,
  },
  residue: {
    type: "override_scar",
    lifetimeMs: 2880,
    density: 0.18,
    inheritsSourceId: true,
    gameplayCollision: false,
  },
  difficulty: {
    EASY: {countMultiplier: 0.78, speedMultiplier: 0.88, cadenceMultiplier: 1.16, gapDeltaPx: 8},
    NORMAL: {countMultiplier: 1, speedMultiplier: 1, cadenceMultiplier: 1, gapDeltaPx: 0},
    HARD: {countMultiplier: 1.18, speedMultiplier: 1.12, cadenceMultiplier: 0.88, gapDeltaPx: -4},
  },
  seed: {
    algorithm: "mulberry32-v1",
    base: 1930566563,
    composition: "runSeed xor base xor encounterOrdinal xor difficultySalt",
    randomCalls: "emitter-order then burst-order then projectile-order",
  },
  accessibility: {
    reducedMotionGameplayParity: true,
    flashOffGameplayParity: true,
    telegraphNeverColorOnly: true,
  },
  resolutionHook: "scar_coordinate_commit",
});

/** Exact immutable contract for the isolated V4 Override Void pattern. */
export function validateOverrideVoidPatternContract(patternValue: unknown): void {
  assertExactDataContract(
    patternValue,
    OVERRIDE_VOID_PATTERN_CONTRACT,
    "transition.override_void",
  );
}

/**
 * Exact isolated projectile contract for V4 Dusk. The snapshot hook is retained
 * as source data only: this validator does not schedule a transition or emit a
 * snapshot event.
 */
export function validateDuskSettlePatternContract(patternValue: unknown): void {
  const pattern = ownPlainDataRecord(
    patternValue as Readonly<Record<string, unknown>>,
    [
      "accessibility",
      "cancel",
      "category",
      "clock",
      "difficulty",
      "durationMs",
      "emitters",
      "id",
      "intent",
      "name",
      "residue",
      "resolutionHook",
      "room",
      "safeGap",
      "seed",
      "timeline",
      "warning",
    ],
    "transition.dusk_settle",
  );
  const name = ownPlainDataRecord(
    pattern.name as Readonly<Record<string, unknown>>,
    ["en", "zh"],
    "transition.dusk_settle.name",
  );
  const clock = ownPlainDataRecord(
    pattern.clock as Readonly<Record<string, unknown>>,
    ["authority", "eventDispatch", "pausePolicy", "tickHz", "visualClockSeparated"],
    "transition.dusk_settle.clock",
  );
  const warning = ownPlainDataRecord(
    pattern.warning as Readonly<Record<string, unknown>>,
    ["collisionEnabled", "coversSweptArea", "durationMs", "flashIndependent", "shape"],
    "transition.dusk_settle.warning",
  );
  const safeGap = ownPlainDataRecord(
    pattern.safeGap as Readonly<Record<string, unknown>>,
    [
      "compileRule",
      "enforcement",
      "focusMinimumWidthPx",
      "minimumWidthPx",
      "path",
      "readability",
      "type",
    ],
    "transition.dusk_settle.safeGap",
  );
  const safeGapPath = ownPlainDataRecord(
    safeGap.path as Readonly<Record<string, unknown>>,
    ["amplitudePx", "centerX", "laneX", "maxTravelPxPerSec", "periodMs", "phase"],
    "transition.dusk_settle.safeGap.path",
  );
  const laneX = ownDenseDataArray(
    safeGapPath.laneX,
    "transition.dusk_settle.safeGap.path.laneX",
  );
  const readability = ownPlainDataRecord(
    safeGap.readability as Readonly<Record<string, unknown>>,
    ["leadMs", "neverColorOnly"],
    "transition.dusk_settle.safeGap.readability",
  );
  const cancel = ownPlainDataRecord(
    pattern.cancel as Readonly<Record<string, unknown>>,
    ["collisionOffBeforeVisual", "eventIdempotent", "mode", "triggers"],
    "transition.dusk_settle.cancel",
  );
  const cancelTriggers = ownDenseDataArray(cancel.triggers, "transition.dusk_settle.cancel.triggers");
  const residue = ownPlainDataRecord(
    pattern.residue as Readonly<Record<string, unknown>>,
    ["density", "gameplayCollision", "inheritsSourceId", "lifetimeMs", "type"],
    "transition.dusk_settle.residue",
  );
  const seed = ownPlainDataRecord(
    pattern.seed as Readonly<Record<string, unknown>>,
    ["algorithm", "base", "composition", "randomCalls"],
    "transition.dusk_settle.seed",
  );
  const accessibility = ownPlainDataRecord(
    pattern.accessibility as Readonly<Record<string, unknown>>,
    ["flashOffGameplayParity", "reducedMotionGameplayParity", "telegraphNeverColorOnly"],
    "transition.dusk_settle.accessibility",
  );
  if (
    pattern.id !== "transition.dusk_settle"
    || pattern.category !== "TRANSITION"
    || pattern.room !== "TRANSITION"
    || name.zh !== "黄昏沉降"
    || name.en !== "Dusk settle"
    || pattern.intent !== "攻击停止生成，仍在场的数字对象沉降为材料记录。"
    || pattern.durationMs !== 8200
    || clock.authority !== "GAMEPLAY"
    || clock.tickHz !== 120
    || clock.eventDispatch !== "crossed-time-exactly-once"
    || clock.pausePolicy !== "freeze"
    || clock.visualClockSeparated !== true
    || warning.durationMs !== 554
    || warning.shape !== "descending_settlement_band"
    || warning.coversSweptArea !== true
    || warning.collisionEnabled !== false
    || warning.flashIndependent !== true
    || safeGap.type !== "settling_center"
    || safeGap.minimumWidthPx !== 54
    || safeGap.focusMinimumWidthPx !== 46
    || safeGap.enforcement !== "rule_clip_with_residue"
    || safeGap.compileRule
      !== "omit, gate, redirect, or visibly cancel any candidate whose swept circle violates the corridor envelope"
    || safeGapPath.centerX !== 180
    || safeGapPath.amplitudePx !== 12
    || safeGapPath.periodMs !== 8000
    || safeGapPath.phase !== 0
    || safeGapPath.maxTravelPxPerSec !== 78
    || laneX.length !== 0
    || readability.leadMs !== 520
    || readability.neverColorOnly !== true
    || cancel.mode !== "digital_cancel_to_material_residue"
    || cancel.collisionOffBeforeVisual !== true
    || cancel.eventIdempotent !== true
    || cancelTriggers.length !== 4
    || cancelTriggers[0] !== "pattern_end"
    || cancelTriggers[1] !== "source_withdrawn"
    || cancelTriggers[2] !== "override_void"
    || cancelTriggers[3] !== "room_transition"
    || residue.type !== "dusk_sediment"
    || residue.lifetimeMs !== 3424
    || residue.density !== 0.38
    || residue.inheritsSourceId !== true
    || residue.gameplayCollision !== false
    || seed.algorithm !== "mulberry32-v1"
    || seed.base !== 924052336
    || seed.composition !== "runSeed xor base xor encounterOrdinal xor difficultySalt"
    || seed.randomCalls !== "emitter-order then burst-order then projectile-order"
    || accessibility.reducedMotionGameplayParity !== true
    || accessibility.flashOffGameplayParity !== true
    || accessibility.telegraphNeverColorOnly !== true
    || pattern.resolutionHook !== "snapshot_capture_ready"
  ) {
    throw new Error("transition.dusk_settle authored contract drifted");
  }

  const timeline = ownDenseDataArray(pattern.timeline, "transition.dusk_settle.timeline");
  const expectedTimeline = [
    [0, "warning.begin"],
    [554, "collision.arm"],
    [554, "emit.begin"],
    [4100, "pattern.midpoint"],
    [7500, "emit.end"],
    [7780, "residue.commit"],
    [8200, "pattern.complete"],
  ] as const;
  if (timeline.length !== expectedTimeline.length) {
    throw new Error("transition.dusk_settle timeline contract drifted");
  }
  for (let index = 0; index < expectedTimeline.length; index += 1) {
    const entry = ownPlainDataRecord(
      timeline[index] as Readonly<Record<string, unknown>>,
      ["atMs", "event"],
      `transition.dusk_settle.timeline[${index}]`,
    );
    if (entry.atMs !== expectedTimeline[index]?.[0] || entry.event !== expectedTimeline[index]?.[1]) {
      throw new Error("transition.dusk_settle timeline contract drifted");
    }
  }

  const emitters = ownDenseDataArray(pattern.emitters, "transition.dusk_settle.emitters");
  if (emitters.length !== 1) throw new Error("transition.dusk_settle emitter contract drifted");
  const emitter = ownPlainDataRecord(
    emitters[0] as Readonly<Record<string, unknown>>,
    ["anchor", "cadence", "geometry", "id", "kind", "motionStack", "projectile", "speedCurve"],
    "transition.dusk_settle.emitters[0]",
  );
  const anchor = ownPlainDataRecord(
    emitter.anchor as Readonly<Record<string, unknown>>,
    ["space", "x", "y"],
    "transition.dusk_settle/settling-field.anchor",
  );
  const cadence = ownPlainDataRecord(
    emitter.cadence as Readonly<Record<string, unknown>>,
    ["bursts", "intervalMs", "intraBurstMs", "startMs"],
    "transition.dusk_settle/settling-field.cadence",
  );
  const geometry = ownPlainDataRecord(
    emitter.geometry as Readonly<Record<string, unknown>>,
    ["baseAngleDeg", "count", "ordering", "spreadDeg", "type", "variant"],
    "transition.dusk_settle/settling-field.geometry",
  );
  const projectile = ownPlainDataRecord(
    emitter.projectile as Readonly<Record<string, unknown>>,
    ["archetype", "armDelayMs", "collisionRadiusPx"],
    "transition.dusk_settle/settling-field.projectile",
  );
  const speedCurve = capturePiecewiseLinearSpeedCurve(
    emitter.speedCurve as Readonly<Record<string, unknown>>,
    "transition.dusk_settle/settling-field.speedCurve",
  );
  const motionStack = ownDenseDataArray(
    emitter.motionStack,
    "transition.dusk_settle/settling-field.motionStack",
  );
  if (motionStack.length !== 2) throw new Error("transition.dusk_settle motion stack drifted");
  const envelopeEntry = ownPlainDataRecord(
    motionStack[0] as Readonly<Record<string, unknown>>,
    ["operator", "params"],
    "transition.dusk_settle/settling-field.motionStack[0]",
  );
  const linearEntry = ownPlainDataRecord(
    motionStack[1] as Readonly<Record<string, unknown>>,
    ["operator", "params"],
    "transition.dusk_settle/settling-field.motionStack[1]",
  );
  if (envelopeEntry.operator !== "op.speed_envelope" || linearEntry.operator !== "op.linear") {
    throw new Error("transition.dusk_settle motion declaration order drifted");
  }
  const envelope = captureSpeedEnvelope(
    {params: envelopeEntry.params as Readonly<Record<string, unknown>>},
    "transition.dusk_settle/settling-field.speed_envelope",
  );
  validateMotionParameters(
    {params: linearEntry.params as Readonly<Record<string, unknown>>},
    [],
    "transition.dusk_settle/settling-field.linear",
  );
  if (
    emitter.id !== "settling-field"
    || emitter.kind !== "projectile"
    || anchor.space !== "viewport-normalized"
    || anchor.x !== 0.5
    || anchor.y !== 0.16
    || geometry.type !== "grid"
    || geometry.variant !== "decreasing-density"
    || geometry.count !== 12
    || geometry.baseAngleDeg !== 90
    || geometry.spreadDeg !== 0
    || geometry.ordering !== "clockwise-then-source-index"
    || cadence.startMs !== 554
    || cadence.intervalMs !== 860
    || cadence.bursts !== 7
    || cadence.intraBurstMs !== 0
    || projectile.archetype !== "bullet.micro.notch_e"
    || projectile.collisionRadiusPx !== 2
    || projectile.armDelayMs !== 40
    || speedCurve.keys.length !== 1
    || speedCurve.keys[0]?.atMs !== 0
    || speedCurve.keys[0]?.pxPerSec !== 112
    || envelope.interpolation !== "linear"
    || envelope.keys.length !== 3
    || envelope.keys[0]?.atMs !== 0
    || envelope.keys[0]?.multiplier !== 1
    || envelope.keys[1]?.atMs !== 1200
    || envelope.keys[1]?.multiplier !== 0.42
    || envelope.keys[2]?.atMs !== 2100
    || envelope.keys[2]?.multiplier !== 0
  ) {
    throw new Error("transition.dusk_settle settling-field contract drifted");
  }

  const difficulty = ownPlainDataRecord(
    pattern.difficulty as Readonly<Record<string, unknown>>,
    ["EASY", "HARD", "NORMAL"],
    "transition.dusk_settle.difficulty",
  );
  const expectedDifficulty = {
    EASY: [0.78, 0.88, 1.16, 8],
    NORMAL: [1, 1, 1, 0],
    HARD: [1.18, 1.12, 0.88, -4],
  } as const;
  for (const profileId of ["EASY", "NORMAL", "HARD"] as const) {
    const profile = ownPlainDataRecord(
      difficulty[profileId] as Readonly<Record<string, unknown>>,
      ["cadenceMultiplier", "countMultiplier", "gapDeltaPx", "speedMultiplier"],
      `transition.dusk_settle.difficulty.${profileId}`,
    );
    const expected = expectedDifficulty[profileId];
    if (
      profile.countMultiplier !== expected[0]
      || profile.speedMultiplier !== expected[1]
      || profile.cadenceMultiplier !== expected[2]
      || profile.gapDeltaPx !== expected[3]
    ) {
      throw new Error("transition.dusk_settle difficulty contract drifted");
    }
  }
}

/** Exact isolated V4 contract for the admitted Crack Fall Loop capability. */
export function validateCrackFallLoopPatternContract(patternValue: unknown): void {
  const path = "room.forced.crack_fall_loop";
  const pattern = ownPlainDataRecord(
    patternValue as Readonly<Record<string, unknown>>,
    [
      "accessibility",
      "cancel",
      "category",
      "clock",
      "difficulty",
      "durationMs",
      "emitters",
      "id",
      "intent",
      "name",
      "residue",
      "room",
      "safeGap",
      "seed",
      "timeline",
      "warning",
    ],
    path,
  );
  const name = ownPlainDataRecord(
    pattern.name as Readonly<Record<string, unknown>>,
    ["en", "zh"],
    `${path}.name`,
  );
  const clock = ownPlainDataRecord(
    pattern.clock as Readonly<Record<string, unknown>>,
    ["authority", "eventDispatch", "pausePolicy", "tickHz", "visualClockSeparated"],
    `${path}.clock`,
  );
  const warning = ownPlainDataRecord(
    pattern.warning as Readonly<Record<string, unknown>>,
    ["collisionEnabled", "coversSweptArea", "durationMs", "flashIndependent", "shape"],
    `${path}.warning`,
  );
  const safeGap = ownPlainDataRecord(
    pattern.safeGap as Readonly<Record<string, unknown>>,
    [
      "compileRule",
      "enforcement",
      "focusMinimumWidthPx",
      "minimumWidthPx",
      "path",
      "readability",
      "type",
    ],
    `${path}.safeGap`,
  );
  const safeGapPath = ownPlainDataRecord(
    safeGap.path as Readonly<Record<string, unknown>>,
    ["amplitudePx", "centerX", "laneX", "maxTravelPxPerSec", "periodMs", "phase"],
    `${path}.safeGap.path`,
  );
  const laneX = ownDenseDataArray(safeGapPath.laneX, `${path}.safeGap.path.laneX`);
  const readability = ownPlainDataRecord(
    safeGap.readability as Readonly<Record<string, unknown>>,
    ["leadMs", "neverColorOnly"],
    `${path}.safeGap.readability`,
  );
  const cancel = ownPlainDataRecord(
    pattern.cancel as Readonly<Record<string, unknown>>,
    ["collisionOffBeforeVisual", "eventIdempotent", "mode", "triggers"],
    `${path}.cancel`,
  );
  const cancelTriggers = ownDenseDataArray(cancel.triggers, `${path}.cancel.triggers`);
  const residue = ownPlainDataRecord(
    pattern.residue as Readonly<Record<string, unknown>>,
    ["density", "gameplayCollision", "inheritsSourceId", "lifetimeMs", "type"],
    `${path}.residue`,
  );
  const seed = ownPlainDataRecord(
    pattern.seed as Readonly<Record<string, unknown>>,
    ["algorithm", "base", "composition", "randomCalls"],
    `${path}.seed`,
  );
  const accessibility = ownPlainDataRecord(
    pattern.accessibility as Readonly<Record<string, unknown>>,
    ["flashOffGameplayParity", "reducedMotionGameplayParity", "telegraphNeverColorOnly"],
    `${path}.accessibility`,
  );
  if (
    pattern.id !== path
    || pattern.category !== "ROOM"
    || pattern.room !== "FORCED_ALIGNMENT"
    || name.zh !== "裂缝回送"
    || name.en !== "Crack fall loop"
    || pattern.intent !== "穿越裂缝的弹体被镜像送回，逃离二元也会进入循环。"
    || pattern.durationMs !== 11000
    || clock.authority !== "GAMEPLAY"
    || clock.tickHz !== 120
    || clock.eventDispatch !== "crossed-time-exactly-once"
    || clock.pausePolicy !== "freeze"
    || clock.visualClockSeparated !== true
    || warning.durationMs !== 699
    || warning.shape !== "mirrored_seam_trajectory"
    || warning.coversSweptArea !== true
    || warning.collisionEnabled !== false
    || warning.flashIndependent !== true
    || safeGap.type !== "serpentine_seam"
    || safeGap.minimumWidthPx !== 34
    || safeGap.focusMinimumWidthPx !== 26
    || safeGap.enforcement !== "seam_redirect"
    || safeGap.compileRule
      !== "omit, gate, redirect, or visibly cancel any candidate whose swept circle violates the corridor envelope"
    || safeGapPath.centerX !== 180
    || safeGapPath.amplitudePx !== 42
    || safeGapPath.periodMs !== 7600
    || safeGapPath.phase !== 0
    || safeGapPath.maxTravelPxPerSec !== 78
    || laneX.length !== 0
    || readability.leadMs !== 520
    || readability.neverColorOnly !== true
    || cancel.mode !== "digital_cancel_to_material_residue"
    || cancel.collisionOffBeforeVisual !== true
    || cancel.eventIdempotent !== true
    || cancelTriggers.length !== 4
    || cancelTriggers[0] !== "pattern_end"
    || cancelTriggers[1] !== "source_withdrawn"
    || cancelTriggers[2] !== "override_void"
    || cancelTriggers[3] !== "room_transition"
    || residue.type !== "seam_filament"
    || residue.lifetimeMs !== 3850
    || residue.density !== 0.24
    || residue.inheritsSourceId !== true
    || residue.gameplayCollision !== false
    || seed.algorithm !== "mulberry32-v1"
    || seed.base !== 3074675749
    || seed.composition !== "runSeed xor base xor encounterOrdinal xor difficultySalt"
    || seed.randomCalls !== "emitter-order then burst-order then projectile-order"
    || accessibility.reducedMotionGameplayParity !== true
    || accessibility.flashOffGameplayParity !== true
    || accessibility.telegraphNeverColorOnly !== true
  ) {
    throw new Error(`${path} authored contract drifted`);
  }

  const timeline = ownDenseDataArray(pattern.timeline, `${path}.timeline`);
  const expectedTimeline = [
    [0, "warning.begin"],
    [699, "collision.arm"],
    [699, "emit.begin"],
    [5500, "pattern.midpoint"],
    [10300, "emit.end"],
    [10580, "residue.commit"],
    [11000, "pattern.complete"],
  ] as const;
  if (timeline.length !== expectedTimeline.length) {
    throw new Error(`${path} timeline contract drifted`);
  }
  for (let index = 0; index < expectedTimeline.length; index += 1) {
    const entry = ownPlainDataRecord(
      timeline[index] as Readonly<Record<string, unknown>>,
      ["atMs", "event"],
      `${path}.timeline[${index}]`,
    );
    if (entry.atMs !== expectedTimeline[index]?.[0] || entry.event !== expectedTimeline[index]?.[1]) {
      throw new Error(`${path} timeline contract drifted`);
    }
  }

  const emitters = ownDenseDataArray(pattern.emitters, `${path}.emitters`);
  if (emitters.length !== 1) throw new Error(`${path} emitter contract drifted`);
  const emitter = ownPlainDataRecord(
    emitters[0] as Readonly<Record<string, unknown>>,
    ["anchor", "cadence", "geometry", "id", "kind", "motionStack", "projectile", "speedCurve"],
    `${path}.emitters[0]`,
  );
  const anchor = ownPlainDataRecord(
    emitter.anchor as Readonly<Record<string, unknown>>,
    ["space", "x", "y"],
    `${path}/falling-claims.anchor`,
  );
  const cadence = ownPlainDataRecord(
    emitter.cadence as Readonly<Record<string, unknown>>,
    ["bursts", "intervalMs", "intraBurstMs", "startMs"],
    `${path}/falling-claims.cadence`,
  );
  const geometry = ownPlainDataRecord(
    emitter.geometry as Readonly<Record<string, unknown>>,
    ["baseAngleDeg", "count", "ordering", "spreadDeg", "type", "variant"],
    `${path}/falling-claims.geometry`,
  );
  const projectile = ownPlainDataRecord(
    emitter.projectile as Readonly<Record<string, unknown>>,
    ["archetype", "armDelayMs", "collisionRadiusPx"],
    `${path}/falling-claims.projectile`,
  );
  const speedCurve = capturePiecewiseLinearSpeedCurve(
    emitter.speedCurve as Readonly<Record<string, unknown>>,
    `${path}/falling-claims.speedCurve`,
  );
  const motionStack = ownDenseDataArray(
    emitter.motionStack,
    `${path}/falling-claims.motionStack`,
  );
  if (motionStack.length !== 2) throw new Error(`${path} motion stack drifted`);
  const linearEntry = ownPlainDataRecord(
    motionStack[0] as Readonly<Record<string, unknown>>,
    ["operator", "params"],
    `${path}/falling-claims.motionStack[0]`,
  );
  const seamEntry = ownPlainDataRecord(
    motionStack[1] as Readonly<Record<string, unknown>>,
    ["operator", "params"],
    `${path}/falling-claims.motionStack[1]`,
  );
  if (linearEntry.operator !== "op.linear" || seamEntry.operator !== "op.seam_transform") {
    throw new Error(`${path} motion declaration order drifted`);
  }
  validateMotionParameters(
    {params: linearEntry.params as Readonly<Record<string, unknown>>},
    [],
    `${path}/falling-claims.linear`,
  );
  assertSeamTransformMotion(
    {params: seamEntry.params as Readonly<Record<string, unknown>>},
    `${path}/falling-claims.seam_transform`,
  );
  const seamParams = seamEntry.params as Readonly<Record<string, unknown>>;
  if (
    emitter.id !== "falling-claims"
    || emitter.kind !== "projectile"
    || anchor.space !== "viewport-normalized"
    || anchor.x !== 0.5
    || anchor.y !== 0.11
    || geometry.type !== "fan"
    || geometry.variant !== "seam-crossing-wide"
    || geometry.count !== 12
    || geometry.baseAngleDeg !== 90
    || geometry.spreadDeg !== 164
    || geometry.ordering !== "clockwise-then-source-index"
    || cadence.startMs !== 699
    || cadence.intervalMs !== 980
    || cadence.bursts !== 10
    || cadence.intraBurstMs !== 0
    || projectile.archetype !== "bullet.micro.notch_e"
    || projectile.collisionRadiusPx !== 2
    || projectile.armDelayMs !== 40
    || speedCurve.keys.length !== 1
    || speedCurve.keys[0]?.atMs !== 0
    || speedCurve.keys[0]?.pxPerSec !== 162
    || seamParams.seamX !== 180
    || seamParams.mode !== "mirror"
    || seamParams.offsetPx !== 0
  ) {
    throw new Error(`${path} falling-claims contract drifted`);
  }

  const difficulty = ownPlainDataRecord(
    pattern.difficulty as Readonly<Record<string, unknown>>,
    ["EASY", "HARD", "NORMAL"],
    `${path}.difficulty`,
  );
  const expectedDifficulty = {
    EASY: [0.78, 0.88, 1.16, 8],
    NORMAL: [1, 1, 1, 0],
    HARD: [1.18, 1.12, 0.88, -4],
  } as const;
  for (const profileId of ["EASY", "NORMAL", "HARD"] as const) {
    const profile = ownPlainDataRecord(
      difficulty[profileId] as Readonly<Record<string, unknown>>,
      ["cadenceMultiplier", "countMultiplier", "gapDeltaPx", "speedMultiplier"],
      `${path}.difficulty.${profileId}`,
    );
    const expected = expectedDifficulty[profileId];
    if (
      profile.countMultiplier !== expected[0]
      || profile.speedMultiplier !== expected[1]
      || profile.cadenceMultiplier !== expected[2]
      || profile.gapDeltaPx !== expected[3]
    ) {
      throw new Error(`${path} difficulty contract drifted`);
    }
  }
}

/** Exact isolated V4 contract for the admitted Ballot Shift capability. */
export function validateBallotShiftPatternContract(patternValue: unknown): void {
  const path = "room.forced.ballot_shift";
  const pattern = ownPlainDataRecord(
    patternValue as Readonly<Record<string, unknown>>,
    [
      "accessibility",
      "cancel",
      "category",
      "clock",
      "difficulty",
      "durationMs",
      "emitters",
      "id",
      "intent",
      "name",
      "residue",
      "room",
      "safeGap",
      "seed",
      "timeline",
      "warning",
    ],
    path,
  );
  const name = ownPlainDataRecord(
    pattern.name as Readonly<Record<string, unknown>>,
    ["en", "zh"],
    `${path}.name`,
  );
  const clock = ownPlainDataRecord(
    pattern.clock as Readonly<Record<string, unknown>>,
    ["authority", "eventDispatch", "pausePolicy", "tickHz", "visualClockSeparated"],
    `${path}.clock`,
  );
  const warning = ownPlainDataRecord(
    pattern.warning as Readonly<Record<string, unknown>>,
    ["collisionEnabled", "coversSweptArea", "durationMs", "flashIndependent", "shape"],
    `${path}.warning`,
  );
  const safeGap = ownPlainDataRecord(
    pattern.safeGap as Readonly<Record<string, unknown>>,
    [
      "compileRule",
      "enforcement",
      "focusMinimumWidthPx",
      "minimumWidthPx",
      "path",
      "readability",
      "type",
    ],
    `${path}.safeGap`,
  );
  const safeGapPath = ownPlainDataRecord(
    safeGap.path as Readonly<Record<string, unknown>>,
    ["amplitudePx", "centerX", "laneX", "maxTravelPxPerSec", "periodMs", "phase"],
    `${path}.safeGap.path`,
  );
  const laneX = ownDenseDataArray(safeGapPath.laneX, `${path}.safeGap.path.laneX`);
  const readability = ownPlainDataRecord(
    safeGap.readability as Readonly<Record<string, unknown>>,
    ["leadMs", "neverColorOnly"],
    `${path}.safeGap.readability`,
  );
  const cancel = ownPlainDataRecord(
    pattern.cancel as Readonly<Record<string, unknown>>,
    ["collisionOffBeforeVisual", "eventIdempotent", "mode", "triggers"],
    `${path}.cancel`,
  );
  const cancelTriggers = ownDenseDataArray(cancel.triggers, `${path}.cancel.triggers`);
  const residue = ownPlainDataRecord(
    pattern.residue as Readonly<Record<string, unknown>>,
    ["density", "gameplayCollision", "inheritsSourceId", "lifetimeMs", "type"],
    `${path}.residue`,
  );
  const seed = ownPlainDataRecord(
    pattern.seed as Readonly<Record<string, unknown>>,
    ["algorithm", "base", "composition", "randomCalls"],
    `${path}.seed`,
  );
  const accessibility = ownPlainDataRecord(
    pattern.accessibility as Readonly<Record<string, unknown>>,
    ["flashOffGameplayParity", "reducedMotionGameplayParity", "telegraphNeverColorOnly"],
    `${path}.accessibility`,
  );
  if (
    pattern.id !== path
    || pattern.category !== "ROOM"
    || pattern.room !== "FORCED_ALIGNMENT"
    || name.zh !== "选票换边"
    || name.en !== "Ballot shift"
    || pattern.intent !== "双时钟轮流宣布唯一开放侧；切换之前留下可读的空拍。"
    || pattern.durationMs !== 12000
    || clock.authority !== "GAMEPLAY"
    || clock.tickHz !== 120
    || clock.eventDispatch !== "crossed-time-exactly-once"
    || clock.pausePolicy !== "freeze"
    || clock.visualClockSeparated !== true
    || warning.durationMs !== 591
    || warning.shape !== "two_clock_lane_preview"
    || warning.coversSweptArea !== true
    || warning.collisionEnabled !== false
    || warning.flashIndependent !== true
    || safeGap.type !== "lane_switch"
    || safeGap.minimumWidthPx !== 40
    || safeGap.focusMinimumWidthPx !== 32
    || safeGap.enforcement !== "phase_gate"
    || safeGap.compileRule
      !== "omit, gate, redirect, or visibly cancel any candidate whose swept circle violates the corridor envelope"
    || safeGapPath.centerX !== 180
    || safeGapPath.amplitudePx !== 0
    || safeGapPath.periodMs !== 5200
    || safeGapPath.phase !== 0
    || safeGapPath.maxTravelPxPerSec !== 78
    || laneX.length !== 2
    || laneX[0] !== 112
    || laneX[1] !== 248
    || readability.leadMs !== 520
    || readability.neverColorOnly !== true
    || cancel.mode !== "digital_cancel_to_material_residue"
    || cancel.collisionOffBeforeVisual !== true
    || cancel.eventIdempotent !== true
    || cancelTriggers.length !== 4
    || cancelTriggers[0] !== "pattern_end"
    || cancelTriggers[1] !== "source_withdrawn"
    || cancelTriggers[2] !== "override_void"
    || cancelTriggers[3] !== "room_transition"
    || residue.type !== "seam_filament"
    || residue.lifetimeMs !== 2579
    || residue.density !== 0.39
    || residue.inheritsSourceId !== true
    || residue.gameplayCollision !== false
    || seed.algorithm !== "mulberry32-v1"
    || seed.base !== 1912172135
    || seed.composition !== "runSeed xor base xor encounterOrdinal xor difficultySalt"
    || seed.randomCalls !== "emitter-order then burst-order then projectile-order"
    || accessibility.reducedMotionGameplayParity !== true
    || accessibility.flashOffGameplayParity !== true
    || accessibility.telegraphNeverColorOnly !== true
  ) {
    throw new Error(`${path} authored contract drifted`);
  }

  const timeline = ownDenseDataArray(pattern.timeline, `${path}.timeline`);
  const expectedTimeline = [
    [0, "warning.begin"],
    [591, "collision.arm"],
    [591, "emit.begin"],
    [6000, "pattern.midpoint"],
    [11300, "emit.end"],
    [11580, "residue.commit"],
    [12000, "pattern.complete"],
  ] as const;
  if (timeline.length !== expectedTimeline.length) {
    throw new Error(`${path} timeline contract drifted`);
  }
  for (let index = 0; index < expectedTimeline.length; index += 1) {
    const entry = ownPlainDataRecord(
      timeline[index] as Readonly<Record<string, unknown>>,
      ["atMs", "event"],
      `${path}.timeline[${index}]`,
    );
    if (entry.atMs !== expectedTimeline[index]?.[0] || entry.event !== expectedTimeline[index]?.[1]) {
      throw new Error(`${path} timeline contract drifted`);
    }
  }

  const emitters = ownDenseDataArray(pattern.emitters, `${path}.emitters`);
  if (emitters.length !== 2) throw new Error(`${path} emitter contract drifted`);
  const captureEmitter = (index: number, expected: Readonly<{
    id: string;
    anchorY: number;
    geometryType: string;
    variant: string;
    count: number;
    spreadDeg: number;
    startMs: number;
    intervalMs: number;
    bursts: number;
    speed: number;
    periodAMs: number;
    periodBMs: number;
    dutyA: number;
    dutyB: number;
    phaseOffsetMs: number;
  }>): void => {
    const emitterPath = `${path}/${expected.id}`;
    const emitter = ownPlainDataRecord(
      emitters[index] as Readonly<Record<string, unknown>>,
      ["anchor", "cadence", "geometry", "id", "kind", "motionStack", "projectile", "speedCurve"],
      `${path}.emitters[${index}]`,
    );
    const anchor = ownPlainDataRecord(
      emitter.anchor as Readonly<Record<string, unknown>>,
      ["space", "x", "y"],
      `${emitterPath}.anchor`,
    );
    const cadence = ownPlainDataRecord(
      emitter.cadence as Readonly<Record<string, unknown>>,
      ["bursts", "intervalMs", "intraBurstMs", "startMs"],
      `${emitterPath}.cadence`,
    );
    const geometry = ownPlainDataRecord(
      emitter.geometry as Readonly<Record<string, unknown>>,
      ["baseAngleDeg", "count", "ordering", "spreadDeg", "type", "variant"],
      `${emitterPath}.geometry`,
    );
    const projectile = ownPlainDataRecord(
      emitter.projectile as Readonly<Record<string, unknown>>,
      ["archetype", "armDelayMs", "collisionRadiusPx"],
      `${emitterPath}.projectile`,
    );
    const speedCurve = capturePiecewiseLinearSpeedCurve(
      emitter.speedCurve as Readonly<Record<string, unknown>>,
      `${emitterPath}.speedCurve`,
    );
    const motionStack = ownDenseDataArray(emitter.motionStack, `${emitterPath}.motionStack`);
    if (motionStack.length !== 2) throw new Error(`${emitterPath} motion stack drifted`);
    const dual = ownPlainDataRecord(
      motionStack[0] as Readonly<Record<string, unknown>>,
      ["operator", "params"],
      `${emitterPath}.motionStack[0]`,
    );
    const linear = ownPlainDataRecord(
      motionStack[1] as Readonly<Record<string, unknown>>,
      ["operator", "params"],
      `${emitterPath}.motionStack[1]`,
    );
    const dualParams = ownPlainDataRecord(
      dual.params as Readonly<Record<string, unknown>>,
      ["dutyA", "dutyB", "periodAMs", "periodBMs", "phaseOffsetMs"],
      `${emitterPath}.dual_clock_gate`,
    );
    captureDualClockGate(
      {params: dual.params as Readonly<Record<string, unknown>>},
      `${emitterPath}.dual_clock_gate`,
    );
    validateMotionParameters(
      {params: linear.params as Readonly<Record<string, unknown>>},
      [],
      `${emitterPath}.linear`,
    );
    if (
      emitter.id !== expected.id
      || emitter.kind !== "projectile"
      || anchor.space !== "viewport-normalized"
      || anchor.x !== 0.5
      || anchor.y !== expected.anchorY
      || geometry.type !== expected.geometryType
      || geometry.variant !== expected.variant
      || geometry.count !== expected.count
      || geometry.baseAngleDeg !== 90
      || geometry.spreadDeg !== expected.spreadDeg
      || geometry.ordering !== "clockwise-then-source-index"
      || cadence.startMs !== expected.startMs
      || cadence.intervalMs !== expected.intervalMs
      || cadence.bursts !== expected.bursts
      || cadence.intraBurstMs !== 0
      || projectile.archetype !== "bullet.micro.notch_e"
      || projectile.collisionRadiusPx !== 2
      || projectile.armDelayMs !== 40
      || speedCurve.keys.length !== 1
      || speedCurve.keys[0]?.atMs !== 0
      || speedCurve.keys[0]?.pxPerSec !== expected.speed
      || dual.operator !== "op.dual_clock_gate"
      || linear.operator !== "op.linear"
      || dualParams.periodAMs !== expected.periodAMs
      || dualParams.periodBMs !== expected.periodBMs
      || dualParams.dutyA !== expected.dutyA
      || dualParams.dutyB !== expected.dutyB
      || dualParams.phaseOffsetMs !== expected.phaseOffsetMs
    ) {
      throw new Error(`${emitterPath} authored emitter contract drifted`);
    }
  };
  captureEmitter(0, {
    id: "ballot-a",
    anchorY: 0.16,
    geometryType: "line",
    variant: "clock-a-columns",
    count: 10,
    spreadDeg: 0,
    startMs: 591,
    intervalMs: 700,
    bursts: 15,
    speed: 158,
    periodAMs: 1400,
    periodBMs: 2100,
    dutyA: 0.52,
    dutyB: 0.38,
    phaseOffsetMs: 0,
  });
  captureEmitter(1, {
    id: "ballot-b",
    anchorY: 0.14,
    geometryType: "arc",
    variant: "clock-b-counterclaim",
    count: 7,
    spreadDeg: 92,
    startMs: 941,
    intervalMs: 1050,
    bursts: 10,
    speed: 176,
    periodAMs: 2100,
    periodBMs: 1400,
    dutyA: 0.38,
    dutyB: 0.52,
    phaseOffsetMs: 350,
  });

  const difficulty = ownPlainDataRecord(
    pattern.difficulty as Readonly<Record<string, unknown>>,
    ["EASY", "HARD", "NORMAL"],
    `${path}.difficulty`,
  );
  const expectedDifficulty = {
    EASY: [0.78, 0.88, 1.16, 8],
    NORMAL: [1, 1, 1, 0],
    HARD: [1.18, 1.12, 0.88, -4],
  } as const;
  for (const profileId of ["EASY", "NORMAL", "HARD"] as const) {
    const profile = ownPlainDataRecord(
      difficulty[profileId] as Readonly<Record<string, unknown>>,
      ["cadenceMultiplier", "countMultiplier", "gapDeltaPx", "speedMultiplier"],
      `${path}.difficulty.${profileId}`,
    );
    const expected = expectedDifficulty[profileId];
    if (
      profile.countMultiplier !== expected[0]
      || profile.speedMultiplier !== expected[1]
      || profile.cadenceMultiplier !== expected[2]
      || profile.gapDeltaPx !== expected[3]
    ) {
      throw new Error(`${path} difficulty contract drifted`);
    }
  }
}

/** Exact isolated V4 contract for the admitted Context Switch capability. */
export function validateContextSwitchPatternContract(patternValue: unknown): void {
  const path = "room.in_between.context_switch";
  const pattern = ownPlainDataRecord(
    patternValue as Readonly<Record<string, unknown>>,
    [
      "accessibility",
      "cancel",
      "category",
      "clock",
      "difficulty",
      "durationMs",
      "emitters",
      "id",
      "intent",
      "name",
      "residue",
      "room",
      "safeGap",
      "seed",
      "timeline",
      "warning",
    ],
    path,
  );
  const name = ownPlainDataRecord(
    pattern.name as Readonly<Record<string, unknown>>,
    ["en", "zh"],
    `${path}.name`,
  );
  const clock = ownPlainDataRecord(
    pattern.clock as Readonly<Record<string, unknown>>,
    ["authority", "eventDispatch", "pausePolicy", "tickHz", "visualClockSeparated"],
    `${path}.clock`,
  );
  const warning = ownPlainDataRecord(
    pattern.warning as Readonly<Record<string, unknown>>,
    ["collisionEnabled", "coversSweptArea", "durationMs", "flashIndependent", "shape"],
    `${path}.warning`,
  );
  const safeGap = ownPlainDataRecord(
    pattern.safeGap as Readonly<Record<string, unknown>>,
    [
      "compileRule",
      "enforcement",
      "focusMinimumWidthPx",
      "minimumWidthPx",
      "path",
      "readability",
      "type",
    ],
    `${path}.safeGap`,
  );
  const safeGapPath = ownPlainDataRecord(
    safeGap.path as Readonly<Record<string, unknown>>,
    ["amplitudePx", "centerX", "laneX", "maxTravelPxPerSec", "periodMs", "phase"],
    `${path}.safeGap.path`,
  );
  const laneX = ownDenseDataArray(safeGapPath.laneX, `${path}.safeGap.path.laneX`);
  const readability = ownPlainDataRecord(
    safeGap.readability as Readonly<Record<string, unknown>>,
    ["leadMs", "neverColorOnly"],
    `${path}.safeGap.readability`,
  );
  const cancel = ownPlainDataRecord(
    pattern.cancel as Readonly<Record<string, unknown>>,
    ["collisionOffBeforeVisual", "eventIdempotent", "mode", "triggers"],
    `${path}.cancel`,
  );
  const cancelTriggers = ownDenseDataArray(cancel.triggers, `${path}.cancel.triggers`);
  const residue = ownPlainDataRecord(
    pattern.residue as Readonly<Record<string, unknown>>,
    ["density", "gameplayCollision", "inheritsSourceId", "lifetimeMs", "type"],
    `${path}.residue`,
  );
  const seed = ownPlainDataRecord(
    pattern.seed as Readonly<Record<string, unknown>>,
    ["algorithm", "base", "composition", "randomCalls"],
    `${path}.seed`,
  );
  const accessibility = ownPlainDataRecord(
    pattern.accessibility as Readonly<Record<string, unknown>>,
    ["flashOffGameplayParity", "reducedMotionGameplayParity", "telegraphNeverColorOnly"],
    `${path}.accessibility`,
  );
  if (
    pattern.id !== path
    || pattern.category !== "ROOM"
    || pattern.room !== "IN_BETWEEN"
    || name.zh !== "语境切换"
    || name.en !== "Context switch"
    || pattern.intent !== "A 与 B 对同一位置给出相反转向；玩家学习切换而非统一。"
    || pattern.durationMs !== 11400
    || clock.authority !== "GAMEPLAY"
    || clock.tickHz !== 120
    || clock.eventDispatch !== "crossed-time-exactly-once"
    || clock.pausePolicy !== "freeze"
    || clock.visualClockSeparated !== true
    || warning.durationMs !== 726
    || warning.shape !== "incompatible_turn_fields"
    || warning.coversSweptArea !== true
    || warning.collisionEnabled !== false
    || warning.flashIndependent !== true
    || safeGap.type !== "intersection_track"
    || safeGap.minimumWidthPx !== 32
    || safeGap.focusMinimumWidthPx !== 24
    || safeGap.enforcement !== "operator_constraint"
    || safeGap.compileRule
      !== "omit, gate, redirect, or visibly cancel any candidate whose swept circle violates the corridor envelope"
    || safeGapPath.centerX !== 180
    || safeGapPath.amplitudePx !== 34
    || safeGapPath.periodMs !== 6400
    || safeGapPath.phase !== 0
    || safeGapPath.maxTravelPxPerSec !== 78
    || laneX.length !== 0
    || readability.leadMs !== 520
    || readability.neverColorOnly !== true
    || cancel.mode !== "digital_cancel_to_material_residue"
    || cancel.collisionOffBeforeVisual !== true
    || cancel.eventIdempotent !== true
    || cancelTriggers.length !== 4
    || cancelTriggers[0] !== "pattern_end"
    || cancelTriggers[1] !== "source_withdrawn"
    || cancelTriggers[2] !== "override_void"
    || cancelTriggers[3] !== "room_transition"
    || residue.type !== "misregistration_flake"
    || residue.lifetimeMs !== 3150
    || residue.density !== 0.24
    || residue.inheritsSourceId !== true
    || residue.gameplayCollision !== false
    || seed.algorithm !== "mulberry32-v1"
    || seed.base !== 2740017633
    || seed.composition !== "runSeed xor base xor encounterOrdinal xor difficultySalt"
    || seed.randomCalls !== "emitter-order then burst-order then projectile-order"
    || accessibility.reducedMotionGameplayParity !== true
    || accessibility.flashOffGameplayParity !== true
    || accessibility.telegraphNeverColorOnly !== true
  ) {
    throw new Error(`${path} authored contract drifted`);
  }

  const timeline = ownDenseDataArray(pattern.timeline, `${path}.timeline`);
  const expectedTimeline = [
    [0, "warning.begin"],
    [726, "collision.arm"],
    [726, "emit.begin"],
    [5700, "pattern.midpoint"],
    [10700, "emit.end"],
    [10980, "residue.commit"],
    [11400, "pattern.complete"],
  ] as const;
  if (timeline.length !== expectedTimeline.length) {
    throw new Error(`${path} timeline contract drifted`);
  }
  for (let index = 0; index < expectedTimeline.length; index += 1) {
    const entry = ownPlainDataRecord(
      timeline[index] as Readonly<Record<string, unknown>>,
      ["atMs", "event"],
      `${path}.timeline[${index}]`,
    );
    if (entry.atMs !== expectedTimeline[index]?.[0] || entry.event !== expectedTimeline[index]?.[1]) {
      throw new Error(`${path} timeline contract drifted`);
    }
  }

  const emitters = ownDenseDataArray(pattern.emitters, `${path}.emitters`);
  if (emitters.length !== 2) throw new Error(`${path} emitter contract drifted`);
  const captureEmitter = (index: number, id: string) => {
    const emitterPath = `${path}/${id}`;
    const emitter = ownPlainDataRecord(
      emitters[index] as Readonly<Record<string, unknown>>,
      ["anchor", "cadence", "geometry", "id", "kind", "motionStack", "projectile", "speedCurve"],
      `${path}.emitters[${index}]`,
    );
    const anchor = ownPlainDataRecord(
      emitter.anchor as Readonly<Record<string, unknown>>,
      ["space", "x", "y"],
      `${emitterPath}.anchor`,
    );
    const cadence = ownPlainDataRecord(
      emitter.cadence as Readonly<Record<string, unknown>>,
      ["bursts", "intervalMs", "intraBurstMs", "startMs"],
      `${emitterPath}.cadence`,
    );
    const geometry = ownPlainDataRecord(
      emitter.geometry as Readonly<Record<string, unknown>>,
      ["baseAngleDeg", "count", "ordering", "spreadDeg", "type", "variant"],
      `${emitterPath}.geometry`,
    );
    const projectile = ownPlainDataRecord(
      emitter.projectile as Readonly<Record<string, unknown>>,
      ["archetype", "armDelayMs", "collisionRadiusPx"],
      `${emitterPath}.projectile`,
    );
    const speedCurve = capturePiecewiseLinearSpeedCurve(
      emitter.speedCurve as Readonly<Record<string, unknown>>,
      `${emitterPath}.speedCurve`,
    );
    const motionStack = ownDenseDataArray(emitter.motionStack, `${emitterPath}.motionStack`);
    if (
      emitter.id !== id
      || emitter.kind !== "projectile"
      || anchor.space !== "viewport-normalized"
      || geometry.type !== "fan"
      || geometry.ordering !== "clockwise-then-source-index"
      || cadence.intraBurstMs !== 0
      || projectile.archetype !== "bullet.micro.notch_e"
      || projectile.collisionRadiusPx !== 2
      || projectile.armDelayMs !== 40
      || speedCurve.keys.length !== 1
      || speedCurve.keys[0]?.atMs !== 0
    ) {
      throw new Error(`${emitterPath} authored emitter contract drifted`);
    }
    return {anchor, cadence, geometry, motionStack, speedCurve};
  };

  const systemA = captureEmitter(0, "system-a");
  if (
    systemA.anchor.x !== 0.3
    || systemA.anchor.y !== 0.12
    || systemA.geometry.variant !== "rectilinear-a"
    || systemA.geometry.count !== 8
    || systemA.geometry.baseAngleDeg !== 78
    || systemA.geometry.spreadDeg !== 76
    || systemA.cadence.startMs !== 726
    || systemA.cadence.intervalMs !== 920
    || systemA.cadence.bursts !== 11
    || systemA.speedCurve.keys[0]?.pxPerSec !== 146
    || systemA.motionStack.length !== 2
  ) {
    throw new Error(`${path}/system-a authored emitter contract drifted`);
  }
  const systemALinear = ownPlainDataRecord(
    systemA.motionStack[0] as Readonly<Record<string, unknown>>,
    ["operator", "params"],
    `${path}/system-a.motionStack[0]`,
  );
  const systemATurn = ownPlainDataRecord(
    systemA.motionStack[1] as Readonly<Record<string, unknown>>,
    ["operator", "params"],
    `${path}/system-a.motionStack[1]`,
  );
  if (systemALinear.operator !== "op.linear" || systemATurn.operator !== "op.turn_once") {
    throw new Error(`${path}/system-a declaration order drifted`);
  }
  validateMotionParameters(
    {params: systemALinear.params as Readonly<Record<string, unknown>>},
    [],
    `${path}/system-a.linear`,
  );
  assertTurnOnceMotion(
    {params: systemATurn.params as Readonly<Record<string, unknown>>},
    `${path}/system-a.turn_once`,
  );
  const systemATurnParams = systemATurn.params as Readonly<Record<string, unknown>>;
  if (systemATurnParams.atMs !== 740 || systemATurnParams.deltaDeg !== 22) {
    throw new Error(`${path}/system-a turn contract drifted`);
  }

  const systemB = captureEmitter(1, "system-b");
  if (
    systemB.anchor.x !== 0.7
    || systemB.anchor.y !== 0.16
    || systemB.geometry.variant !== "broken-b"
    || systemB.geometry.count !== 9
    || systemB.geometry.baseAngleDeg !== 102
    || systemB.geometry.spreadDeg !== 96
    || systemB.cadence.startMs !== 956
    || systemB.cadence.intervalMs !== 1160
    || systemB.cadence.bursts !== 9
    || systemB.speedCurve.keys[0]?.pxPerSec !== 154
    || systemB.motionStack.length !== 3
  ) {
    throw new Error(`${path}/system-b authored emitter contract drifted`);
  }
  const systemBEnvelope = ownPlainDataRecord(
    systemB.motionStack[0] as Readonly<Record<string, unknown>>,
    ["operator", "params"],
    `${path}/system-b.motionStack[0]`,
  );
  const systemBTurn = ownPlainDataRecord(
    systemB.motionStack[1] as Readonly<Record<string, unknown>>,
    ["operator", "params"],
    `${path}/system-b.motionStack[1]`,
  );
  const systemBLinear = ownPlainDataRecord(
    systemB.motionStack[2] as Readonly<Record<string, unknown>>,
    ["operator", "params"],
    `${path}/system-b.motionStack[2]`,
  );
  if (
    systemBEnvelope.operator !== "op.speed_envelope"
    || systemBTurn.operator !== "op.turn_once"
    || systemBLinear.operator !== "op.linear"
  ) {
    throw new Error(`${path}/system-b declaration order drifted`);
  }
  const envelope = captureSpeedEnvelope(
    {params: systemBEnvelope.params as Readonly<Record<string, unknown>>},
    `${path}/system-b.speed_envelope`,
  );
  assertTurnOnceMotion(
    {params: systemBTurn.params as Readonly<Record<string, unknown>>},
    `${path}/system-b.turn_once`,
  );
  validateMotionParameters(
    {params: systemBLinear.params as Readonly<Record<string, unknown>>},
    [],
    `${path}/system-b.linear`,
  );
  const systemBTurnParams = systemBTurn.params as Readonly<Record<string, unknown>>;
  if (
    envelope.interpolation !== "linear"
    || envelope.keys.length !== 2
    || envelope.keys[0]?.atMs !== 0
    || envelope.keys[0]?.multiplier !== 0.72
    || envelope.keys[1]?.atMs !== 520
    || envelope.keys[1]?.multiplier !== 1.28
    || systemBTurnParams.atMs !== 980
    || systemBTurnParams.deltaDeg !== -28
  ) {
    throw new Error(`${path}/system-b envelope or turn contract drifted`);
  }

  const difficulty = ownPlainDataRecord(
    pattern.difficulty as Readonly<Record<string, unknown>>,
    ["EASY", "HARD", "NORMAL"],
    `${path}.difficulty`,
  );
  const expectedDifficulty = {
    EASY: [0.78, 0.88, 1.16, 8],
    NORMAL: [1, 1, 1, 0],
    HARD: [1.18, 1.12, 0.88, -4],
  } as const;
  for (const profileId of ["EASY", "NORMAL", "HARD"] as const) {
    const profile = ownPlainDataRecord(
      difficulty[profileId] as Readonly<Record<string, unknown>>,
      ["cadenceMultiplier", "countMultiplier", "gapDeltaPx", "speedMultiplier"],
      `${path}.difficulty.${profileId}`,
    );
    const expected = expectedDifficulty[profileId];
    if (
      profile.countMultiplier !== expected[0]
      || profile.speedMultiplier !== expected[1]
      || profile.cadenceMultiplier !== expected[2]
      || profile.gapDeltaPx !== expected[3]
    ) {
      throw new Error(`${path} difficulty contract drifted`);
    }
  }
}

/**
 * A Boss executable pattern carries its family laser association, while the
 * Boss rig decides whether that topology is live in a particular phase.
 */
export function validateBossObservePhaseContract(
  phaseValue: unknown,
  expectedPatternId: string,
): void {
  if (typeof phaseValue !== "object" || phaseValue === null || Array.isArray(phaseValue)) {
    throw new Error("Boss observe phase must be an object");
  }
  const phase = phaseValue as Readonly<Record<string, unknown>>;
  const read = (key: string): unknown => {
    const descriptor = Object.getOwnPropertyDescriptor(phase, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new Error(`Boss observe phase.${key} must be an own data property`);
    }
    return descriptor.value;
  };
  if (read("id") !== "observe" || read("patternId") !== expectedPatternId) {
    throw new Error(`Boss pattern ${expectedPatternId} is not the rig observe phase`);
  }
  if (read("laserGeometry") !== null) {
    throw new Error(`Boss pattern ${expectedPatternId} would require active laser authority`);
  }
}

/** Exact observe binding for the isolated Absent Receiver query capability. */
export function validateAbsentReceiverObserveRigContract(phaseValue: unknown): void {
  if (typeof phaseValue !== "object" || phaseValue === null || Array.isArray(phaseValue)) {
    throw new Error("Absent Receiver observe phase must be an object");
  }
  const phase = ownPlainDataRecord(
    phaseValue as Readonly<Record<string, unknown>>,
    ["entryCondition", "exitCondition", "id", "laserGeometry", "patternId", "spatialLaw"],
    "boss.absent_receiver.observe",
  );
  if (
    phase.id !== "observe"
    || phase.patternId !== "boss.absent_receiver.phase1"
    || phase.entryCondition !== "encounter.begin"
    || phase.exitCondition !== "absent_receiver.evidence>=1"
    || phase.laserGeometry !== null
    || phase.spatialLaw !== "unreturned_packets"
  ) {
    throw new Error("Absent Receiver observe rig contract drifted");
  }
}

/** Exact observe binding for the isolated One Sun, One Rule phase-1 capability. */
export function validateOneSunOneRuleObserveRigContract(phaseValue: unknown): void {
  const phase = ownPlainDataRecord(
    phaseValue as Readonly<Record<string, unknown>>,
    ["entryCondition", "exitCondition", "id", "laserGeometry", "patternId", "spatialLaw"],
    "boss.one_sun_one_rule.observe",
  );
  if (
    phase.id !== "observe"
    || phase.patternId !== "boss.one_sun_one_rule.phase1"
    || phase.entryCondition !== "encounter.begin"
    || phase.exitCondition !== "one_sun_one_rule.evidence>=1"
    || phase.laserGeometry !== null
    || phase.spatialLaw !== "one_open_half"
  ) {
    throw new Error("One Sun, One Rule observe rig contract drifted");
  }
}

function validateBossPatternScope(pattern: CombatPattern): void {
  if (pattern.category !== "BOSS") {
    if (pattern.laserGeometry !== undefined) {
      throw new Error(`${pattern.id} non-Boss pattern cannot declare a laser geometry`);
    }
    return;
  }
  if (
    BOSS_RIG_MANIFEST.schemaVersion !== "4.0.0"
    || !Array.isArray(BOSS_RIG_MANIFEST.rigs)
    || BOSS_RIG_MANIFEST.rigs.length !== 8
  ) {
    throw new Error("canonical combat requires the complete V4 Boss rig manifest");
  }
  if (typeof pattern.laserGeometry !== "string" || pattern.laserGeometry.length === 0) {
    throw new Error(`${pattern.id} Boss laser association drifted`);
  }
  const bossId = pattern.id.split(".").slice(0, 2).join(".");
  const rig = BOSS_RIG_MANIFEST.rigs.find((candidate) => candidate.id === bossId);
  if (
    rig === undefined
    || rig.id !== bossId
    || rig.room !== pattern.room
    || !Array.isArray(rig.phases)
    || rig.phases.length !== 3
  ) {
    throw new Error(`${pattern.id} has no canonical three-phase Boss rig`);
  }
  const phases = rig.phases as readonly BossRigPhaseContract[];
  const matches = phases.filter((phase) => phase.patternId === pattern.id);
  if (matches.length !== 1 || matches[0] === undefined) {
    throw new Error(`${pattern.id} must have one canonical Boss phase binding`);
  }
  validateBossObservePhaseContract(matches[0], pattern.id);
  if (pattern.id === "boss.absent_receiver.phase1") {
    validateAbsentReceiverObserveRigContract(matches[0]);
  }
  if (pattern.id === "boss.one_sun_one_rule.phase1") {
    validateOneSunOneRuleObserveRigContract(matches[0]);
  }
  const activePhases = phases.filter((phase) => phase.id !== "observe");
  if (
    activePhases.length !== 2
    || activePhases.some((phase) => phase.laserGeometry !== pattern.laserGeometry)
  ) {
    throw new Error(`${pattern.id} Boss family laser binding drifted`);
  }
}

function poolClassFor(
  archetypeId: string,
  mappings: Readonly<Record<string, ProjectilePoolClass>>,
): ProjectilePoolClass {
  const poolClass = mappings[archetypeId];
  if (!["micro", "medium", "heavy", "splitChildren"].includes(poolClass ?? "")) {
    throw new Error(`canonical combat adapter has no V4 pool-class mapping for ${archetypeId}`);
  }
  return poolClass as ProjectilePoolClass;
}

function residueLifetimeMs(pattern: CombatPattern): number {
  const value = pattern.residue.lifetimeMs;
  return requirePositiveFinite(value, `${pattern.id} V4 residue lifetime`);
}

const CLOCK_DECREE_PATTERN_CONTRACT = deepFreezeJson({
  id: "room.polarized.clock_decree",
  category: "ROOM",
  room: "POLARIZED",
  name: {zh: "时钟法令", en: "Clock decree"},
  intent: "四拍只允许开或关，安全窗口来自法令之间的沉默。",
  durationMs: 10000,
  clock: {
    authority: "GAMEPLAY",
    tickHz: 120,
    eventDispatch: "crossed-time-exactly-once",
    pausePolicy: "freeze",
    visualClockSeparated: true,
  },
  timeline: [
    {atMs: 0, event: "warning.begin"},
    {atMs: 576, event: "collision.arm"},
    {atMs: 576, event: "emit.begin"},
    {atMs: 5000, event: "pattern.midpoint"},
    {atMs: 9300, event: "emit.end"},
    {atMs: 9580, event: "residue.commit"},
    {atMs: 10000, event: "pattern.complete"},
  ],
  emitters: [
    {
      id: "binary-clock",
      kind: "projectile",
      anchor: {space: "viewport-normalized", x: 0.5, y: 0.16},
      geometry: {
        type: "shutter",
        variant: "four-beat-decree",
        count: 12,
        baseAngleDeg: 90,
        spreadDeg: 0,
        ordering: "clockwise-then-source-index",
      },
      cadence: {startMs: 576, intervalMs: 500, bursts: 18, intraBurstMs: 0},
      projectile: {
        archetype: "bullet.micro.notch_e",
        collisionRadiusPx: 2,
        armDelayMs: 40,
      },
      speedCurve: {type: "piecewise-linear", keys: [{atMs: 0, pxPerSec: 172}]},
      motionStack: [
        {
          operator: "op.dual_clock_gate",
          params: {
            periodAMs: 1000,
            periodBMs: 2000,
            dutyA: 0.5,
            dutyB: 0.5,
            phaseOffsetMs: 0,
          },
        },
        {operator: "op.linear", params: {}},
      ],
    },
  ],
  safeGap: {
    type: "quantized_step",
    minimumWidthPx: 32,
    focusMinimumWidthPx: 24,
    path: {
      centerX: 180,
      amplitudePx: 54,
      periodMs: 4000,
      phase: 0,
      laneX: [],
      maxTravelPxPerSec: 78,
    },
    enforcement: "phase_gate",
    compileRule:
      "omit, gate, redirect, or visibly cancel any candidate whose swept circle violates the corridor envelope",
    readability: {leadMs: 520, neverColorOnly: true},
  },
  warning: {
    durationMs: 576,
    shape: "four_beat_shutter",
    coversSweptArea: true,
    collisionEnabled: false,
    flashIndependent: true,
  },
  cancel: {
    triggers: ["pattern_end", "source_withdrawn", "override_void", "room_transition"],
    mode: "digital_cancel_to_material_residue",
    collisionOffBeforeVisual: true,
    eventIdempotent: true,
  },
  residue: {
    type: "binary_chip",
    lifetimeMs: 2435,
    density: 0.43,
    inheritsSourceId: true,
    gameplayCollision: false,
  },
  difficulty: {
    EASY: {countMultiplier: 0.78, speedMultiplier: 0.88, cadenceMultiplier: 1.16, gapDeltaPx: 8},
    NORMAL: {countMultiplier: 1, speedMultiplier: 1, cadenceMultiplier: 1, gapDeltaPx: 0},
    HARD: {countMultiplier: 1.18, speedMultiplier: 1.12, cadenceMultiplier: 0.88, gapDeltaPx: -4},
  },
  seed: {
    algorithm: "mulberry32-v1",
    base: 1517220356,
    composition: "runSeed xor base xor encounterOrdinal xor difficultySalt",
    randomCalls: "emitter-order then burst-order then projectile-order",
  },
  accessibility: {
    reducedMotionGameplayParity: true,
    flashOffGameplayParity: true,
    telegraphNeverColorOnly: true,
  },
});

/** Exact descriptor-safe V4 contract for the bounded Clock Decree authority. */
export function validateClockDecreePatternContract(patternValue: unknown): void {
  assertExactDataContract(
    patternValue,
    CLOCK_DECREE_PATTERN_CONTRACT,
    "room.polarized.clock_decree",
  );
}

const NO_DUSK_GRID_PATTERN_CONTRACT = deepFreezeJson({
  id: "room.polarized.no_dusk_grid",
  category: "ROOM",
  room: "POLARIZED",
  name: {zh: "没有黄昏的网格", en: "No-dusk grid"},
  intent: "亮暗不经过过渡；网格只在离散时刻重写。",
  durationMs: 12200,
  clock: {
    authority: "GAMEPLAY",
    tickHz: 120,
    eventDispatch: "crossed-time-exactly-once",
    pausePolicy: "freeze",
    visualClockSeparated: true,
  },
  timeline: [
    {atMs: 0, event: "warning.begin"},
    {atMs: 551, event: "collision.arm"},
    {atMs: 551, event: "emit.begin"},
    {atMs: 6100, event: "pattern.midpoint"},
    {atMs: 11500, event: "emit.end"},
    {atMs: 11780, event: "residue.commit"},
    {atMs: 12200, event: "pattern.complete"},
  ],
  emitters: [
    {
      id: "vertical-law",
      kind: "projectile",
      anchor: {space: "viewport-normalized", x: 0.5, y: 0.16},
      geometry: {
        type: "grid",
        variant: "vertical-binary",
        count: 9,
        baseAngleDeg: 90,
        spreadDeg: 0,
        ordering: "clockwise-then-source-index",
      },
      cadence: {startMs: 551, intervalMs: 750, bursts: 14, intraBurstMs: 0},
      projectile: {
        archetype: "bullet.micro.notch_e",
        collisionRadiusPx: 2,
        armDelayMs: 40,
      },
      speedCurve: {type: "piecewise-linear", keys: [{atMs: 0, pxPerSec: 150}]},
      motionStack: [
        {
          operator: "op.dual_clock_gate",
          params: {
            periodAMs: 1500,
            periodBMs: 3000,
            dutyA: 0.48,
            dutyB: 0.48,
            phaseOffsetMs: 0,
          },
        },
        {operator: "op.linear", params: {}},
      ],
    },
    {
      id: "diagonal-law",
      kind: "projectile",
      anchor: {space: "viewport-normalized", x: 0.5, y: 0.18},
      geometry: {
        type: "cross",
        variant: "diagonal-binary",
        count: 6,
        baseAngleDeg: 68,
        spreadDeg: 44,
        ordering: "clockwise-then-source-index",
      },
      cadence: {startMs: 926, intervalMs: 1500, bursts: 7, intraBurstMs: 0},
      projectile: {
        archetype: "bullet.micro.notch_e",
        collisionRadiusPx: 2,
        armDelayMs: 40,
      },
      speedCurve: {type: "piecewise-linear", keys: [{atMs: 0, pxPerSec: 188}]},
      motionStack: [
        {
          operator: "op.dual_clock_gate",
          params: {
            periodAMs: 3000,
            periodBMs: 1500,
            dutyA: 0.48,
            dutyB: 0.48,
            phaseOffsetMs: 750,
          },
        },
        {operator: "op.linear", params: {}},
      ],
    },
  ],
  safeGap: {
    type: "binary_cross",
    minimumWidthPx: 40,
    focusMinimumWidthPx: 32,
    path: {
      centerX: 180,
      amplitudePx: 20,
      periodMs: 6000,
      phase: 0,
      laneX: [],
      maxTravelPxPerSec: 78,
    },
    enforcement: "phase_gate",
    compileRule:
      "omit, gate, redirect, or visibly cancel any candidate whose swept circle violates the corridor envelope",
    readability: {leadMs: 520, neverColorOnly: true},
  },
  warning: {
    durationMs: 551,
    shape: "binary_grid_union",
    coversSweptArea: true,
    collisionEnabled: false,
    flashIndependent: true,
  },
  cancel: {
    triggers: ["pattern_end", "source_withdrawn", "override_void", "room_transition"],
    mode: "digital_cancel_to_material_residue",
    collisionOffBeforeVisual: true,
    eventIdempotent: true,
  },
  residue: {
    type: "binary_chip",
    lifetimeMs: 2640,
    density: 0.43,
    inheritsSourceId: true,
    gameplayCollision: false,
  },
  difficulty: {
    EASY: {countMultiplier: 0.78, speedMultiplier: 0.88, cadenceMultiplier: 1.16, gapDeltaPx: 8},
    NORMAL: {countMultiplier: 1, speedMultiplier: 1, cadenceMultiplier: 1, gapDeltaPx: 0},
    HARD: {countMultiplier: 1.18, speedMultiplier: 1.12, cadenceMultiplier: 0.88, gapDeltaPx: -4},
  },
  seed: {
    algorithm: "mulberry32-v1",
    base: 2541745312,
    composition: "runSeed xor base xor encounterOrdinal xor difficultySalt",
    randomCalls: "emitter-order then burst-order then projectile-order",
  },
  accessibility: {
    reducedMotionGameplayParity: true,
    flashOffGameplayParity: true,
    telegraphNeverColorOnly: true,
  },
  resolutionHook: "no_dusk_clock_ticks",
});

/** Exact descriptor-safe V4 contract for the bounded No-dusk Grid authority. */
export function validateNoDuskGridPatternContract(patternValue: unknown): void {
  assertExactDataContract(
    patternValue,
    NO_DUSK_GRID_PATTERN_CONTRACT,
    "room.polarized.no_dusk_grid",
  );
}

const STABLE_INTERSECTION_PATTERN_CONTRACT = deepFreezeJson({
  id: "room.in_between.stable_intersection",
  category: "ROOM",
  room: "IN_BETWEEN",
  name: {zh: "稳定交集", en: "Stable intersection"},
  intent: "双时钟同时打开的短窗口形成可学习的交集。",
  durationMs: 12400,
  clock: {
    authority: "GAMEPLAY",
    tickHz: 120,
    eventDispatch: "crossed-time-exactly-once",
    pausePolicy: "freeze",
    visualClockSeparated: true,
  },
  timeline: [
    {atMs: 0, event: "warning.begin"},
    {atMs: 682, event: "collision.arm"},
    {atMs: 682, event: "emit.begin"},
    {atMs: 6200, event: "pattern.midpoint"},
    {atMs: 11700, event: "emit.end"},
    {atMs: 11980, event: "residue.commit"},
    {atMs: 12400, event: "pattern.complete"},
  ],
  emitters: [
    {
      id: "orthogonal-a",
      kind: "projectile",
      anchor: {space: "viewport-normalized", x: 0.5, y: 0.03},
      geometry: {
        type: "lattice",
        variant: "horizontal-clock",
        count: 12,
        baseAngleDeg: 90,
        spreadDeg: 0,
        ordering: "clockwise-then-source-index",
      },
      cadence: {startMs: 682, intervalMs: 720, bursts: 15, intraBurstMs: 0},
      projectile: {
        archetype: "bullet.micro.notch_e",
        collisionRadiusPx: 2,
        armDelayMs: 40,
      },
      speedCurve: {type: "piecewise-linear", keys: [{atMs: 0, pxPerSec: 140}]},
      motionStack: [
        {
          operator: "op.dual_clock_gate",
          params: {
            periodAMs: 1600,
            periodBMs: 2400,
            dutyA: 0.5,
            dutyB: 0.34,
            phaseOffsetMs: 0,
          },
        },
        {operator: "op.linear", params: {}},
      ],
    },
    {
      id: "diagonal-b",
      kind: "projectile",
      anchor: {space: "viewport-normalized", x: 0.5, y: 0.08},
      geometry: {
        type: "lattice",
        variant: "diagonal-clock",
        count: 10,
        baseAngleDeg: 74,
        spreadDeg: 46,
        ordering: "clockwise-then-source-index",
      },
      cadence: {startMs: 882, intervalMs: 960, bursts: 12, intraBurstMs: 0},
      projectile: {
        archetype: "bullet.micro.notch_e",
        collisionRadiusPx: 2,
        armDelayMs: 40,
      },
      speedCurve: {type: "piecewise-linear", keys: [{atMs: 0, pxPerSec: 158}]},
      motionStack: [
        {
          operator: "op.dual_clock_gate",
          params: {
            periodAMs: 2400,
            periodBMs: 1600,
            dutyA: 0.34,
            dutyB: 0.5,
            phaseOffsetMs: 400,
          },
        },
        {operator: "op.linear", params: {}},
      ],
    },
  ],
  safeGap: {
    type: "dual_clock_intersection",
    minimumWidthPx: 44,
    focusMinimumWidthPx: 36,
    path: {
      centerX: 180,
      amplitudePx: 16,
      periodMs: 6600,
      phase: 0,
      laneX: [],
      maxTravelPxPerSec: 78,
    },
    enforcement: "phase_gate",
    compileRule:
      "omit, gate, redirect, or visibly cancel any candidate whose swept circle violates the corridor envelope",
    readability: {leadMs: 520, neverColorOnly: true},
  },
  warning: {
    durationMs: 682,
    shape: "clock_intersection_cells",
    coversSweptArea: true,
    collisionEnabled: false,
    flashIndependent: true,
  },
  cancel: {
    triggers: ["pattern_end", "source_withdrawn", "override_void", "room_transition"],
    mode: "digital_cancel_to_material_residue",
    collisionOffBeforeVisual: true,
    eventIdempotent: true,
  },
  residue: {
    type: "misregistration_flake",
    lifetimeMs: 3155,
    density: 0.23,
    inheritsSourceId: true,
    gameplayCollision: false,
  },
  difficulty: {
    EASY: {countMultiplier: 0.78, speedMultiplier: 0.88, cadenceMultiplier: 1.16, gapDeltaPx: 8},
    NORMAL: {countMultiplier: 1, speedMultiplier: 1, cadenceMultiplier: 1, gapDeltaPx: 0},
    HARD: {countMultiplier: 1.18, speedMultiplier: 1.12, cadenceMultiplier: 0.88, gapDeltaPx: -4},
  },
  seed: {
    algorithm: "mulberry32-v1",
    base: 3179525433,
    composition: "runSeed xor base xor encounterOrdinal xor difficultySalt",
    randomCalls: "emitter-order then burst-order then projectile-order",
  },
  accessibility: {
    reducedMotionGameplayParity: true,
    flashOffGameplayParity: true,
    telegraphNeverColorOnly: true,
  },
  resolutionHook: "intersection_hold_ms",
});

/** Exact descriptor-safe V4 contract for the bounded Stable Intersection authority. */
export function validateStableIntersectionPatternContract(patternValue: unknown): void {
  assertExactDataContract(
    patternValue,
    STABLE_INTERSECTION_PATTERN_CONTRACT,
    "room.in_between.stable_intersection",
  );
}

const ROOM_THRESHOLD_PATTERN_CONTRACT = deepFreezeJson({
  id: "transition.room_threshold",
  category: "TRANSITION",
  room: "TRANSITION",
  name: {zh: "房间阈值", en: "Room threshold"},
  intent: "旧房间的列与新房间的角度短暂重叠，之后旧规则撤回。",
  durationMs: 7800,
  clock: {
    authority: "GAMEPLAY",
    tickHz: 120,
    eventDispatch: "crossed-time-exactly-once",
    pausePolicy: "freeze",
    visualClockSeparated: true,
  },
  timeline: [
    {atMs: 0, event: "warning.begin"},
    {atMs: 737, event: "collision.arm"},
    {atMs: 737, event: "emit.begin"},
    {atMs: 3900, event: "pattern.midpoint"},
    {atMs: 7100, event: "emit.end"},
    {atMs: 7380, event: "residue.commit"},
    {atMs: 7800, event: "pattern.complete"},
  ],
  emitters: [
    {
      id: "departing-rule",
      kind: "projectile",
      anchor: {space: "viewport-normalized", x: 0.5, y: 0.16},
      geometry: {
        type: "line",
        variant: "old-room-columns",
        count: 8,
        baseAngleDeg: 90,
        spreadDeg: 0,
        ordering: "clockwise-then-source-index",
      },
      cadence: {startMs: 737, intervalMs: 1000, bursts: 6, intraBurstMs: 0},
      projectile: {
        archetype: "bullet.micro.notch_e",
        collisionRadiusPx: 2,
        armDelayMs: 40,
      },
      speedCurve: {type: "piecewise-linear", keys: [{atMs: 0, pxPerSec: 128}]},
      motionStack: [
        {
          operator: "op.speed_envelope",
          params: {
            keys: [
              {atMs: 0, multiplier: 1},
              {atMs: 1200, multiplier: 0.55},
            ],
            interpolation: "linear",
          },
        },
        {operator: "op.linear", params: {}},
      ],
    },
    {
      id: "arriving-rule",
      kind: "projectile",
      anchor: {space: "viewport-normalized", x: 0.5, y: 0.14},
      geometry: {
        type: "fan",
        variant: "new-room-angle",
        count: 6,
        baseAngleDeg: 90,
        spreadDeg: 68,
        ordering: "clockwise-then-source-index",
      },
      cadence: {startMs: 1237, intervalMs: 1000, bursts: 5, intraBurstMs: 0},
      projectile: {
        archetype: "bullet.micro.notch_e",
        collisionRadiusPx: 2,
        armDelayMs: 40,
      },
      speedCurve: {type: "piecewise-linear", keys: [{atMs: 0, pxPerSec: 146}]},
      motionStack: [
        {
          operator: "op.speed_envelope",
          params: {
            keys: [
              {atMs: 0, multiplier: 0.55},
              {atMs: 1200, multiplier: 1},
            ],
            interpolation: "linear",
          },
        },
        {operator: "op.linear", params: {}},
      ],
    },
  ],
  safeGap: {
    type: "threshold_bridge",
    minimumWidthPx: 46,
    focusMinimumWidthPx: 38,
    path: {
      centerX: 180,
      amplitudePx: 28,
      periodMs: 7000,
      phase: 0,
      laneX: [],
      maxTravelPxPerSec: 78,
    },
    enforcement: "phase_gate",
    compileRule:
      "omit, gate, redirect, or visibly cancel any candidate whose swept circle violates the corridor envelope",
    readability: {leadMs: 520, neverColorOnly: true},
  },
  warning: {
    durationMs: 737,
    shape: "overlap_threshold_map",
    coversSweptArea: true,
    collisionEnabled: false,
    flashIndependent: true,
  },
  cancel: {
    triggers: ["pattern_end", "source_withdrawn", "override_void", "room_transition"],
    mode: "digital_cancel_to_material_residue",
    collisionOffBeforeVisual: true,
    eventIdempotent: true,
  },
  residue: {
    type: "threshold_sediment",
    lifetimeMs: 2741,
    density: 0.37,
    inheritsSourceId: true,
    gameplayCollision: false,
  },
  difficulty: {
    EASY: {countMultiplier: 0.78, speedMultiplier: 0.88, cadenceMultiplier: 1.16, gapDeltaPx: 8},
    NORMAL: {countMultiplier: 1, speedMultiplier: 1, cadenceMultiplier: 1, gapDeltaPx: 0},
    HARD: {countMultiplier: 1.18, speedMultiplier: 1.12, cadenceMultiplier: 0.88, gapDeltaPx: -4},
  },
  seed: {
    algorithm: "mulberry32-v1",
    base: 577557179,
    composition: "runSeed xor base xor encounterOrdinal xor difficultySalt",
    randomCalls: "emitter-order then burst-order then projectile-order",
  },
  accessibility: {
    reducedMotionGameplayParity: true,
    flashOffGameplayParity: true,
    telegraphNeverColorOnly: true,
  },
});

/** Exact descriptor-safe V4 contract for the bounded Room Threshold authority. */
export function validateRoomThresholdPatternContract(patternValue: unknown): void {
  assertExactDataContract(
    patternValue,
    ROOM_THRESHOLD_PATTERN_CONTRACT,
    "transition.room_threshold",
  );
}

const ONE_SUN_ONE_RULE_PATTERN_CONTRACT = deepFreezeJson({
  id: "boss.one_sun_one_rule.phase1",
  category: "BOSS",
  room: "FORCED_ALIGNMENT",
  name: {zh: "一个太阳一种规则：唯一法令", en: "One Sun, One Rule: Single decree"},
  intent:
    "阶段 1 将治理机制转译为可学习的时空行为；最终阶段连接世界观事实 RULE_INTERRUPTED_BY_SCAR / boss.rule.correctionFailed，不是统一死亡。",
  durationMs: 11500,
  clock: {
    authority: "GAMEPLAY",
    tickHz: 120,
    eventDispatch: "crossed-time-exactly-once",
    pausePolicy: "freeze",
    visualClockSeparated: true,
  },
  timeline: [
    {atMs: 0, event: "warning.begin"},
    {atMs: 669, event: "collision.arm"},
    {atMs: 669, event: "emit.begin"},
    {atMs: 5750, event: "pattern.midpoint"},
    {atMs: 10800, event: "emit.end"},
    {atMs: 11080, event: "residue.commit"},
    {atMs: 11500, event: "pattern.complete"},
  ],
  emitters: [
    {
      id: "one_sun_one_rule-p1-primary",
      kind: "projectile",
      anchor: {space: "viewport-normalized", x: 0.34, y: 0.1},
      geometry: {
        type: "fan",
        variant: "single-decree",
        count: 13,
        baseAngleDeg: 82,
        spreadDeg: 174,
        ordering: "clockwise-then-source-index",
      },
      cadence: {startMs: 669, intervalMs: 1158, bursts: 8, intraBurstMs: 0},
      projectile: {
        archetype: "bullet.micro.notch_e",
        collisionRadiusPx: 2,
        armDelayMs: 40,
      },
      speedCurve: {type: "piecewise-linear", keys: [{atMs: 0, pxPerSec: 142}]},
      motionStack: [
        {operator: "op.turn_once", params: {atMs: 780, deltaDeg: 30}},
        {operator: "op.linear", params: {}},
      ],
    },
  ],
  safeGap: {
    type: "alternating_wedge",
    minimumWidthPx: 33,
    focusMinimumWidthPx: 25,
    path: {
      centerX: 180,
      amplitudePx: 28,
      periodMs: 6800,
      phase: 0,
      laneX: [],
      maxTravelPxPerSec: 78,
    },
    enforcement: "operator_constraint",
    compileRule:
      "omit, gate, redirect, or visibly cancel any candidate whose swept circle violates the corridor envelope",
    readability: {leadMs: 520, neverColorOnly: true},
  },
  warning: {
    durationMs: 669,
    shape: "single-decree_swept_union",
    coversSweptArea: true,
    collisionEnabled: false,
    flashIndependent: true,
  },
  cancel: {
    triggers: ["pattern_end", "source_withdrawn", "override_void", "room_transition"],
    mode: "digital_cancel_to_material_residue",
    collisionOffBeforeVisual: true,
    eventIdempotent: true,
  },
  residue: {
    type: "one_sun_one_rule_material_trace",
    lifetimeMs: 2495,
    density: 0.3,
    inheritsSourceId: true,
    gameplayCollision: false,
  },
  difficulty: {
    EASY: {countMultiplier: 0.78, speedMultiplier: 0.88, cadenceMultiplier: 1.16, gapDeltaPx: 8},
    NORMAL: {countMultiplier: 1, speedMultiplier: 1, cadenceMultiplier: 1, gapDeltaPx: 0},
    HARD: {countMultiplier: 1.18, speedMultiplier: 1.12, cadenceMultiplier: 0.88, gapDeltaPx: -4},
  },
  seed: {
    algorithm: "mulberry32-v1",
    base: 2689489757,
    composition: "runSeed xor base xor encounterOrdinal xor difficultySalt",
    randomCalls: "emitter-order then burst-order then projectile-order",
  },
  accessibility: {
    reducedMotionGameplayParity: true,
    flashOffGameplayParity: true,
    telegraphNeverColorOnly: true,
  },
  laserGeometry: "laser.single_decree_sweep",
  resolutionHook: {
    type: "phase_evidence",
    canonicalBossId: "boss.one_sun_one_rule",
    narrativeAlias: "one_sun_one_rule",
    resolutionId: "RULE_INTERRUPTED_BY_SCAR",
    condition: "one_sun_one_rule.phaseEvidence>=1",
    terminalEvent: null,
  },
});

/** Exact descriptor-safe V4 contract for the bounded One Sun, One Rule authority. */
export function validateOneSunOneRulePatternContract(patternValue: unknown): void {
  assertExactDataContract(
    patternValue,
    ONE_SUN_ONE_RULE_PATTERN_CONTRACT,
    "boss.one_sun_one_rule.phase1",
  );
}

const ALTERNATING_VERDICT_PATTERN_CONTRACT = deepFreezeJson({
  id: "room.polarized.alternating_verdict",
  category: "ROOM",
  room: "POLARIZED",
  name: {zh: "交替裁决", en: "Alternating verdict"},
  intent: "每次裁决只转一次，上一轮正确的方向下一轮失效。",
  durationMs: 11600,
  clock: {
    authority: "GAMEPLAY",
    tickHz: 120,
    eventDispatch: "crossed-time-exactly-once",
    pausePolicy: "freeze",
    visualClockSeparated: true,
  },
  timeline: [
    {atMs: 0, event: "warning.begin"},
    {atMs: 547, event: "collision.arm"},
    {atMs: 547, event: "emit.begin"},
    {atMs: 5800, event: "pattern.midpoint"},
    {atMs: 10900, event: "emit.end"},
    {atMs: 11180, event: "residue.commit"},
    {atMs: 11600, event: "pattern.complete"},
  ],
  emitters: [
    {
      id: "verdict-a",
      kind: "projectile",
      anchor: {space: "viewport-normalized", x: 0.28, y: 0.13},
      geometry: {
        type: "arc",
        variant: "even-verdict",
        count: 11,
        baseAngleDeg: 76,
        spreadDeg: 118,
        ordering: "clockwise-then-source-index",
      },
      cadence: {startMs: 547, intervalMs: 1120, bursts: 9, intraBurstMs: 0},
      projectile: {
        archetype: "bullet.micro.notch_e",
        collisionRadiusPx: 2,
        armDelayMs: 40,
      },
      speedCurve: {type: "piecewise-linear", keys: [{atMs: 0, pxPerSec: 156}]},
      motionStack: [
        {operator: "op.linear", params: {}},
        {operator: "op.turn_once", params: {atMs: 640, deltaDeg: 32}},
      ],
    },
    {
      id: "verdict-b",
      kind: "projectile",
      anchor: {space: "viewport-normalized", x: 0.72, y: 0.13},
      geometry: {
        type: "arc",
        variant: "odd-verdict",
        count: 11,
        baseAngleDeg: 104,
        spreadDeg: 118,
        ordering: "clockwise-then-source-index",
      },
      cadence: {startMs: 1107, intervalMs: 1120, bursts: 9, intraBurstMs: 0},
      projectile: {
        archetype: "bullet.micro.notch_e",
        collisionRadiusPx: 2,
        armDelayMs: 40,
      },
      speedCurve: {type: "piecewise-linear", keys: [{atMs: 0, pxPerSec: 178}]},
      motionStack: [
        {operator: "op.linear", params: {}},
        {operator: "op.turn_once", params: {atMs: 940, deltaDeg: -32}},
      ],
    },
  ],
  safeGap: {
    type: "alternating_wedge",
    minimumWidthPx: 34,
    focusMinimumWidthPx: 26,
    path: {
      centerX: 180,
      amplitudePx: 64,
      periodMs: 5600,
      phase: 0,
      laneX: [],
      maxTravelPxPerSec: 78,
    },
    enforcement: "angular_omission",
    compileRule:
      "omit, gate, redirect, or visibly cancel any candidate whose swept circle violates the corridor envelope",
    readability: {leadMs: 520, neverColorOnly: true},
  },
  warning: {
    durationMs: 547,
    shape: "alternating_turn_wedges",
    coversSweptArea: true,
    collisionEnabled: false,
    flashIndependent: true,
  },
  cancel: {
    triggers: ["pattern_end", "source_withdrawn", "override_void", "room_transition"],
    mode: "digital_cancel_to_material_residue",
    collisionOffBeforeVisual: true,
    eventIdempotent: true,
  },
  residue: {
    type: "binary_chip",
    lifetimeMs: 2422,
    density: 0.37,
    inheritsSourceId: true,
    gameplayCollision: false,
  },
  difficulty: {
    EASY: {countMultiplier: 0.78, speedMultiplier: 0.88, cadenceMultiplier: 1.16, gapDeltaPx: 8},
    NORMAL: {countMultiplier: 1, speedMultiplier: 1, cadenceMultiplier: 1, gapDeltaPx: 0},
    HARD: {countMultiplier: 1.18, speedMultiplier: 1.12, cadenceMultiplier: 0.88, gapDeltaPx: -4},
  },
  seed: {
    algorithm: "mulberry32-v1",
    base: 4224141244,
    composition: "runSeed xor base xor encounterOrdinal xor difficultySalt",
    randomCalls: "emitter-order then burst-order then projectile-order",
  },
  accessibility: {
    reducedMotionGameplayParity: true,
    flashOffGameplayParity: true,
    telegraphNeverColorOnly: true,
  },
});

/** Exact descriptor-safe V4 contract for the bounded Alternating Verdict authority. */
export function validateAlternatingVerdictPatternContract(patternValue: unknown): void {
  assertExactDataContract(
    patternValue,
    ALTERNATING_VERDICT_PATTERN_CONTRACT,
    "room.polarized.alternating_verdict",
  );
}

const ASH_MEMORY_PATTERN_CONTRACT = deepFreezeJson({
  id: "encounter.weather_echo.ash_memory",
  category: "WEATHER_ECHO",
  room: "COMMON",
  name: {zh: "灰烬的回声", en: "Ash echo encounter"},
  intent: "独立遭遇沿序列化路径反向回放；真实灰烬天气仅表现环境，不提供轨迹输入。",
  durationMs: 10200,
  clock: {
    authority: "GAMEPLAY",
    tickHz: 120,
    eventDispatch: "crossed-time-exactly-once",
    pausePolicy: "freeze",
    visualClockSeparated: true,
  },
  timeline: [
    {atMs: 0, event: "warning.begin"},
    {atMs: 759, event: "collision.arm"},
    {atMs: 759, event: "emit.begin"},
    {atMs: 5100, event: "pattern.midpoint"},
    {atMs: 9500, event: "emit.end"},
    {atMs: 9780, event: "residue.commit"},
    {atMs: 10200, event: "pattern.complete"},
  ],
  emitters: [
    {
      id: "ash-echo",
      kind: "projectile",
      anchor: {space: "viewport-normalized", x: 0.5, y: 0.08},
      geometry: {
        type: "history_chain",
        variant: "reverse-short-trace",
        count: 10,
        baseAngleDeg: 90,
        spreadDeg: 0,
        ordering: "clockwise-then-source-index",
      },
      cadence: {startMs: 759, intervalMs: 1600, bursts: 6, intraBurstMs: 0},
      projectile: {
        archetype: "bullet.micro.shard",
        collisionRadiusPx: 2,
        armDelayMs: 40,
      },
      speedCurve: {type: "piecewise-linear", keys: [{atMs: 0, pxPerSec: 94}]},
      motionStack: [
        {
          operator: "op.history_replay",
          params: {
            points: [
              [180, 70, 0],
              [132, 190, 500],
              [214, 330, 1000],
              [166, 470, 1500],
              [196, 600, 1900],
            ],
            delayMs: 420,
            mode: "reverse",
          },
        },
      ],
    },
  ],
  safeGap: {
    type: "ash_wake",
    minimumWidthPx: 44,
    focusMinimumWidthPx: 36,
    path: {
      centerX: 180,
      amplitudePx: 38,
      periodMs: 9200,
      phase: 0,
      laneX: [],
      maxTravelPxPerSec: 78,
    },
    enforcement: "operator_constraint",
    compileRule:
      "omit, gate, redirect, or visibly cancel any candidate whose swept circle violates the corridor envelope",
    readability: {leadMs: 520, neverColorOnly: true},
  },
  warning: {
    durationMs: 759,
    shape: "reverse_trace_preview",
    coversSweptArea: true,
    collisionEnabled: false,
    flashIndependent: true,
  },
  cancel: {
    triggers: ["pattern_end", "source_withdrawn", "override_void", "room_transition"],
    mode: "digital_cancel_to_material_residue",
    collisionOffBeforeVisual: true,
    eventIdempotent: true,
  },
  residue: {
    type: "ash_fiber",
    lifetimeMs: 3194,
    density: 0.39,
    inheritsSourceId: true,
    gameplayCollision: false,
  },
  difficulty: {
    EASY: {countMultiplier: 0.78, speedMultiplier: 0.88, cadenceMultiplier: 1.16, gapDeltaPx: 8},
    NORMAL: {countMultiplier: 1, speedMultiplier: 1, cadenceMultiplier: 1, gapDeltaPx: 0},
    HARD: {countMultiplier: 1.18, speedMultiplier: 1.12, cadenceMultiplier: 0.88, gapDeltaPx: -4},
  },
  seed: {
    algorithm: "mulberry32-v1",
    base: 2725936518,
    composition: "runSeed xor base xor encounterOrdinal xor difficultySalt",
    randomCalls: "emitter-order then burst-order then projectile-order",
    disallowedInputs: ["weatherEvent", "weatherSeed", "weatherRng"],
  },
  accessibility: {
    reducedMotionGameplayParity: true,
    flashOffGameplayParity: true,
    telegraphNeverColorOnly: true,
  },
  weatherEchoContract: {
    visualSource: "ASH",
    schedulingAuthority: "director.encounter.v4",
    runsParallelToWeather: true,
    weatherEventCanTrigger: false,
    weatherEventCanSpawnProjectile: false,
    weatherEventCanAlterMotion: false,
    weatherEventCanAlterCollision: false,
    weatherEventCanAlterSafeGap: false,
    weatherRngUsed: false,
    seedAuthority: "pattern.seed only",
  },
});

/** Exact descriptor-safe V4 contract for the isolated Ash Memory authority. */
export function validateAshMemoryPatternContract(patternValue: unknown): void {
  assertExactDataContract(
    patternValue,
    ASH_MEMORY_PATTERN_CONTRACT,
    "encounter.weather_echo.ash_memory",
  );
}

function validatePattern(pattern: CombatPattern): void {
  if (EXECUTABLE_PATTERN_MANIFEST.schemaVersion !== "4.0.0") {
    throw new Error("canonical combat requires executable pattern schema 4.0.0");
  }
  if (!SUPPORTED_PATTERN_SET.has(pattern.id)) {
    throw new Error(`canonical combat kernel does not yet support pattern: ${pattern.id}`);
  }
  if (pattern.id === "room.polarized.clock_decree") {
    validateClockDecreePatternContract(pattern);
  }
  if (pattern.id === "room.polarized.no_dusk_grid") {
    validateNoDuskGridPatternContract(pattern);
  }
  if (pattern.id === "room.in_between.stable_intersection") {
    validateStableIntersectionPatternContract(pattern);
  }
  if (pattern.id === "room.in_between.misregistration_corridor") {
    validateMisregistrationCorridorPatternContract(pattern);
  }
  if (pattern.id === "transition.room_threshold") {
    validateRoomThresholdPatternContract(pattern);
  }
  if (pattern.id === "encounter.weather_echo.ash_memory") {
    validateAshMemoryPatternContract(pattern);
  }
  if (pattern.id === "boss.one_sun_one_rule.phase1") {
    validateOneSunOneRulePatternContract(pattern);
  }
  validateBossPatternScope(pattern);
  if (
    pattern.clock.authority !== "GAMEPLAY"
    || pattern.clock.tickHz !== TICKS_PER_SECOND
    || pattern.clock.eventDispatch !== "crossed-time-exactly-once"
    || pattern.clock.pausePolicy !== "freeze"
    || pattern.clock.visualClockSeparated !== true
  ) {
    throw new Error(`${pattern.id} clock contract drifted`);
  }
  if (
    pattern.seed.algorithm !== "mulberry32-v1"
    || pattern.seed.composition !== "runSeed xor base xor encounterOrdinal xor difficultySalt"
    || pattern.seed.randomCalls !== "emitter-order then burst-order then projectile-order"
    || !Number.isSafeInteger(pattern.seed.base)
    || pattern.seed.base < 0
    || pattern.seed.base > 0xffff_ffff
  ) {
    throw new Error(`${pattern.id} seed contract drifted`);
  }
  const expectedCancelTriggers = [
    "pattern_end",
    "source_withdrawn",
    "override_void",
    "room_transition",
  ];
  if (
    pattern.cancel.mode !== "digital_cancel_to_material_residue"
    || pattern.cancel.collisionOffBeforeVisual !== true
    || pattern.cancel.eventIdempotent !== true
    || pattern.cancel.triggers.length !== expectedCancelTriggers.length
    || pattern.cancel.triggers.some((trigger, index) => trigger !== expectedCancelTriggers[index])
  ) {
    throw new Error(`${pattern.id} cancellation contract drifted`);
  }
  if (
    typeof pattern.residue.type !== "string"
    || pattern.residue.type.length === 0
    || pattern.residue.inheritsSourceId !== true
    || pattern.residue.gameplayCollision !== false
  ) {
    throw new Error(`${pattern.id} residue contract drifted`);
  }
  if (
    pattern.warning.coversSweptArea !== true
    || pattern.warning.collisionEnabled !== false
    || typeof pattern.warning.shape !== "string"
    || pattern.warning.shape.length === 0
    || typeof pattern.safeGap.type !== "string"
    || pattern.safeGap.type.length === 0
    || !SUPPORTED_SAFE_GAP_ENFORCEMENT_SET.has(pattern.safeGap.enforcement)
    || pattern.safeGap.compileRule
      !== "omit, gate, redirect, or visibly cancel any candidate whose swept circle violates the corridor envelope"
  ) {
    throw new Error(`${pattern.id} swept warning or safe-gap contract drifted`);
  }
  requirePositiveFinite(pattern.durationMs, `${pattern.id} durationMs`);
  requirePositiveFinite(pattern.safeGap.minimumWidthPx, `${pattern.id} safe-gap width`);
  requireNonNegativeFinite(pattern.safeGap.path.centerX, `${pattern.id} safe-gap centerX`);
  requireNonNegativeFinite(pattern.safeGap.path.amplitudePx, `${pattern.id} safe-gap amplitude`);
  requirePositiveFinite(pattern.safeGap.path.periodMs, `${pattern.id} safe-gap period`);
  requireNonNegativeFinite(pattern.safeGap.path.phase, `${pattern.id} safe-gap phase`);
  requirePositiveFinite(pattern.safeGap.path.maxTravelPxPerSec, `${pattern.id} safe-gap maximum travel`);
  assertHardCutLanePath(pattern);
  assertStalePacketRetryContract(pattern);
  assertNotificationOverflowContract(pattern);
  if (pattern.id === "encounter.weather_echo.rain_packets") {
    validateRainPacketsWeatherEchoContract(pattern);
  }
  assertWindBiasWeatherEchoContract(pattern);
  assertAbsentReceiverQueryContract(pattern);
  if (pattern.id === "transition.dusk_settle") validateDuskSettlePatternContract(pattern);
  if (pattern.id === "transition.override_void") validateOverrideVoidPatternContract(pattern);
  if (pattern.id === "room.forced.crack_fall_loop") {
    validateCrackFallLoopPatternContract(pattern);
  }
  if (pattern.id === "room.forced.ballot_shift") {
    validateBallotShiftPatternContract(pattern);
  }
  if (pattern.id === "room.in_between.context_switch") {
    validateContextSwitchPatternContract(pattern);
  }
  if (pattern.id === "room.polarized.alternating_verdict") {
    validateAlternatingVerdictPatternContract(pattern);
  }
  if (pattern.emitters.length < 1 || pattern.emitters.length > 2) {
    throw new Error(`${pattern.id} canonical combat family requires one or two emitters`);
  }
  const lateralWallEmitters = pattern.emitters.filter((emitter) =>
    emitter.motionStack.some((entry) => entry.operator === "op.lateral_wall"));
  if (lateralWallEmitters.some((emitter) =>
    emitter.geometry.type !== "wall"
    && !(pattern.id === "room.information.notification_overflow" && emitter.geometry.type === "grid"))) {
    throw new Error(`${pattern.id} lane omission must be owned by an admitted lane lattice`);
  }
  if (
    pattern.safeGap.enforcement === "lane_omission"
    && pattern.id !== "encounter.weather_echo.rain_packets"
    && lateralWallEmitters.length !== pattern.emitters.length
  ) {
    throw new Error(`${pattern.id} lane omission must be owned by every wall emitter`);
  }
  if (
    pattern.id === "encounter.weather_echo.rain_packets"
    && lateralWallEmitters.length !== 0
  ) {
    throw new Error(`${pattern.id} rain lane omission must remain path-compiled without a lateral wall`);
  }
  if (
    pattern.safeGap.enforcement !== "lane_omission"
    && pattern.safeGap.enforcement !== "rule_clip_with_residue"
    && lateralWallEmitters.length !== 0
  ) {
    throw new Error(`${pattern.id} lateral walls require lane omission or visible rule clipping`);
  }
  if (
    pattern.safeGap.enforcement === "operator_constraint"
    && pattern.id !== "room.in_between.context_switch"
    && pattern.id !== "boss.one_sun_one_rule.phase1"
    && pattern.id !== "encounter.weather_echo.ash_memory"
  ) {
    throw new Error(`${pattern.id} operator-constraint capability ownership drifted`);
  }
  if (
    pattern.safeGap.enforcement === "phase_gate"
    && pattern.id !== "room.forced.ballot_shift"
    && pattern.id !== "room.polarized.clock_decree"
    && pattern.id !== "room.polarized.no_dusk_grid"
    && pattern.id !== "room.in_between.stable_intersection"
    && pattern.id !== "transition.room_threshold"
  ) {
    throw new Error(`${pattern.id} phase-gate capability ownership drifted`);
  }
  for (const difficulty of ["EASY", "NORMAL", "HARD"] as const) {
    const profile = pattern.difficulty[difficulty];
    requirePositiveFinite(profile.countMultiplier, `${pattern.id}.${difficulty} countMultiplier`);
    requirePositiveFinite(profile.speedMultiplier, `${pattern.id}.${difficulty} speedMultiplier`);
    requirePositiveFinite(profile.cadenceMultiplier, `${pattern.id}.${difficulty} cadenceMultiplier`);
    requireNonNegativeFinite(
      pattern.safeGap.minimumWidthPx + profile.gapDeltaPx,
      `${pattern.id}.${difficulty} safe-gap width`,
    );
  }
  for (const emitter of pattern.emitters) {
    const operators = emitter.motionStack.map((entry) => entry.operator);
    for (const operator of operators) {
      if (!SUPPORTED_OPERATOR_SET.has(operator)) {
        throw new Error(`${pattern.id}/${emitter.id} uses unsupported live operator: ${operator}`);
      }
    }
    const operatorSignature = operators.join(">");
    // The reverse ordering is not a generic operator capability: this one
    // exact phase owns the turn-before-linear declaration.
    const ownsOneSunTurnBeforeLinear = pattern.id === "boss.one_sun_one_rule.phase1"
      && operatorSignature === "op.turn_once>op.linear";
    if (!SUPPORTED_OPERATOR_SIGNATURES.has(operatorSignature) && !ownsOneSunTurnBeforeLinear) {
      throw new Error(`${pattern.id}/${emitter.id} live operator declaration order drifted`);
    }
    const speedCurve = capturePiecewiseLinearSpeedCurve(
      emitter.speedCurve as unknown as Readonly<Record<string, unknown>>,
      `${pattern.id}/${emitter.id}.speedCurve`,
    );
    if (
      pattern.id !== "room.information.stale_packet_retry"
      && pattern.id !== "room.information.notification_overflow"
      && (speedCurve.keys.length !== 1 || speedCurve.keys[0]?.atMs !== 0)
    ) {
      throw new Error(`${pattern.id}/${emitter.id} requires an unsupported live speed curve`);
    }
    // `shutter` remains this exact descriptor's geometry, not a generic live
    // geometry capability for the other isolated manifest shapes.
    const ownsClockDecreeShutter = pattern.id === "room.polarized.clock_decree"
      && emitter.geometry.type === "shutter";
    const ownsNoDuskCross = pattern.id === "room.polarized.no_dusk_grid"
      && emitter.id === "diagonal-law"
      && emitter.geometry.type === "cross";
    const ownsStableIntersectionLattice = pattern.id === "room.in_between.stable_intersection"
      && emitter.geometry.type === "lattice";
    const ownsMisregistrationSpiral = pattern.id === "room.in_between.misregistration_corridor"
      && emitter.geometry.type === "spiral";
    const ownsAshMemoryHistoryChain = pattern.id === "encounter.weather_echo.ash_memory"
      && emitter.geometry.type === "history_chain";
    if (
      !SUPPORTED_GEOMETRY_SET.has(emitter.geometry.type)
      && !ownsClockDecreeShutter
      && !ownsNoDuskCross
      && !ownsStableIntersectionLattice
      && !ownsMisregistrationSpiral
      && !ownsAshMemoryHistoryChain
    ) {
      throw new Error(`${pattern.id}/${emitter.id} requires an unsupported geometry`);
    }
    if (emitter.geometry.type === "paired_fan") {
      assertPairedFanGeometry(
        emitter.geometry as unknown as Readonly<Record<string, unknown>>,
        `${pattern.id}/${emitter.id}.geometry`,
      );
    } else if (emitter.geometry.type === "wall") {
      assertWallGeometry(
        emitter.geometry as unknown as Readonly<Record<string, unknown>>,
        `${pattern.id}/${emitter.id}.geometry`,
      );
    } else if (emitter.geometry.type === "line") {
      if (
        pattern.id !== "room.information.stale_packet_retry"
        && pattern.id !== "room.forced.ballot_shift"
        && pattern.id !== "transition.room_threshold"
      ) {
        throw new Error(`${pattern.id}/${emitter.id} line geometry capability ownership drifted`);
      }
      assertLineGeometry(
        emitter.geometry as unknown as Readonly<Record<string, unknown>>,
        `${pattern.id}/${emitter.id}.geometry`,
      );
    } else if (emitter.geometry.type === "grid") {
      if (
        pattern.id !== "room.information.notification_overflow"
        && pattern.id !== "transition.dusk_settle"
        && pattern.id !== "encounter.weather_echo.rain_packets"
        && !(
          pattern.id === "room.polarized.no_dusk_grid"
          && emitter.id === "vertical-law"
        )
      ) {
        throw new Error(`${pattern.id}/${emitter.id} grid geometry capability ownership drifted`);
      }
      assertGridGeometry(
        emitter.geometry as unknown as Readonly<Record<string, unknown>>,
        `${pattern.id}/${emitter.id}.geometry`,
      );
    } else if (emitter.geometry.type === "lattice") {
      if (pattern.id !== "room.in_between.stable_intersection") {
        throw new Error(`${pattern.id}/${emitter.id} lattice geometry capability ownership drifted`);
      }
      assertLatticeGeometry(
        emitter.geometry as unknown as Readonly<Record<string, unknown>>,
        `${pattern.id}/${emitter.id}.geometry`,
      );
    } else if (emitter.geometry.type === "ring") {
      if (pattern.id !== "transition.override_void") {
        throw new Error(`${pattern.id}/${emitter.id} ring geometry capability ownership drifted`);
      }
      assertRingGeometry(
        emitter.geometry as unknown as Readonly<Record<string, unknown>>,
        `${pattern.id}/${emitter.id}.geometry`,
      );
    } else if (
      emitter.geometry.type === "history_chain"
      && pattern.id !== "encounter.weather_echo.ash_memory"
    ) {
      throw new Error(`${pattern.id}/${emitter.id} history-chain capability ownership drifted`);
    }
    requirePositiveInteger(emitter.geometry.count, `${pattern.id}/${emitter.id} geometry count`);
    requireNonNegativeFinite(emitter.geometry.spreadDeg, `${pattern.id}/${emitter.id} spreadDeg`);
    requireNonNegativeFinite(emitter.geometry.baseAngleDeg, `${pattern.id}/${emitter.id} baseAngleDeg`);
    requireNonNegativeFinite(emitter.anchor.x, `${pattern.id}/${emitter.id} anchor.x`);
    requireNonNegativeFinite(emitter.anchor.y, `${pattern.id}/${emitter.id} anchor.y`);
    if (emitter.anchor.x > 1 || emitter.anchor.y > 1) {
      throw new Error(`${pattern.id}/${emitter.id} anchor must remain viewport-normalized`);
    }
    requireNonNegativeFinite(emitter.cadence.startMs, `${pattern.id}/${emitter.id} cadence start`);
    requirePositiveFinite(emitter.cadence.intervalMs, `${pattern.id}/${emitter.id} cadence interval`);
    requirePositiveInteger(emitter.cadence.bursts, `${pattern.id}/${emitter.id} cadence bursts`);
    requirePositiveFinite(
      emitter.projectile.collisionRadiusPx,
      `${pattern.id}/${emitter.id} projectile collision radius`,
    );
    requirePositiveFinite(
      emitter.projectile.armDelayMs,
      `${pattern.id}/${emitter.id} projectile arm delay`,
    );
    requirePositiveFinite(
      speedCurve.keys[0]?.pxPerSec ?? Number.NaN,
      `${pattern.id}/${emitter.id} projectile speed`,
    );
    const aim = emitter.motionStack.find((entry) => entry.operator === "op.aim_lock");
    const homing = emitter.motionStack.find((entry) => entry.operator === "op.limited_homing");
    const turn = emitter.motionStack.find((entry) => entry.operator === "op.turn_once");
    const lateral = emitter.motionStack.find((entry) => entry.operator === "op.lateral_wall");
    const localVectorBias = emitter.motionStack.find((entry) =>
      entry.operator === "op.local_vector_bias");
    const dualClockGate = emitter.motionStack.find((entry) =>
      entry.operator === "op.dual_clock_gate");
    const speedEnvelope = emitter.motionStack.find((entry) => entry.operator === "op.speed_envelope");
    const seamTransform = emitter.motionStack.find((entry) => entry.operator === "op.seam_transform");
    const linear = emitter.motionStack.find((entry) => entry.operator === "op.linear");
    const historyReplay = emitter.motionStack.find((entry) => entry.operator === "op.history_replay");
    const orbitRelease = emitter.motionStack.find((entry) => entry.operator === "op.orbit_release");
    const ownsAshMemoryHistoryReplay = pattern.id === "encounter.weather_echo.ash_memory";
    if (ownsAshMemoryHistoryReplay !== (historyReplay !== undefined)) {
      throw new Error(`${pattern.id}/${emitter.id} history-replay capability ownership drifted`);
    }
    if (historyReplay !== undefined) {
      captureHistoryReplay(historyReplay, `${emitter.id}.history_replay`);
      if (linear !== undefined) {
        throw new Error(`${pattern.id}/${emitter.id} history replay must not invent linear motion`);
      }
    } else {
      if (linear === undefined) throw new Error(`${pattern.id}/${emitter.id} motion stack is incomplete`);
      validateMotionParameters(linear, [], `${emitter.id}.linear`);
    }
    const ownsOrbitRelease = pattern.id === "room.in_between.misregistration_corridor";
    if (ownsOrbitRelease !== (orbitRelease !== undefined)) {
      throw new Error(`${pattern.id}/${emitter.id} orbit-release capability ownership drifted`);
    }
    if (orbitRelease !== undefined) {
      captureOrbitRelease(orbitRelease, `${emitter.id}.orbit_release`);
    }
    if (aim !== undefined) {
      validateMotionParameters(aim, ["lockAtMs", "leadMs", "maxTurnDeg"], `${emitter.id}.aim_lock`);
      requireNonNegativeFinite(numberParameter(aim, "lockAtMs", Number.NaN), `${emitter.id}.lockAtMs`);
      requireNonNegativeFinite(numberParameter(aim, "maxTurnDeg", Number.NaN), `${emitter.id}.maxTurnDeg`);
    }
    if (homing !== undefined) {
      validateMotionParameters(
        homing,
        ["startMs", "endMs", "maxDegPerSec", "sampleEveryMs"],
        `${emitter.id}.limited_homing`,
      );
      const homingStart = requireNonNegativeFinite(
        numberParameter(homing, "startMs", Number.NaN),
        `${emitter.id}.homing startMs`,
      );
      const homingEnd = requireNonNegativeFinite(
        numberParameter(homing, "endMs", Number.NaN),
        `${emitter.id}.homing endMs`,
      );
      if (homingEnd < homingStart) throw new Error(`${emitter.id} homing ends before it starts`);
      requireNonNegativeFinite(
        numberParameter(homing, "maxDegPerSec", Number.NaN),
        `${emitter.id}.homing maxDegPerSec`,
      );
      requirePositiveFinite(
        numberParameter(homing, "sampleEveryMs", Number.NaN),
        `${emitter.id}.homing sampleEveryMs`,
      );
    }
    if (turn !== undefined) assertTurnOnceMotion(turn, `${emitter.id}.turn_once`);
    if (lateral !== undefined) assertLateralWallMotion(lateral, `${emitter.id}.lateral_wall`);
    const ownsLocalVectorBias = pattern.id === "room.information.notification_overflow"
      || pattern.id === "encounter.weather_echo.rain_packets"
      || pattern.id === "encounter.weather_echo.wind_bias";
    if (ownsLocalVectorBias !== (localVectorBias !== undefined)) {
      throw new Error(`${pattern.id}/${emitter.id} local-vector capability ownership drifted`);
    }
    if (localVectorBias !== undefined) {
      captureLocalVectorBias(localVectorBias, `${emitter.id}.local_vector_bias`);
    }
    const ownsDualClockGate = pattern.id === "room.forced.ballot_shift"
      || pattern.id === "room.polarized.clock_decree"
      || pattern.id === "room.polarized.no_dusk_grid"
      || pattern.id === "room.in_between.stable_intersection";
    if (ownsDualClockGate !== (dualClockGate !== undefined)) {
      throw new Error(`${pattern.id}/${emitter.id} dual-clock capability ownership drifted`);
    }
    if (dualClockGate !== undefined) {
      captureDualClockGate(dualClockGate, `${emitter.id}.dual_clock_gate`);
    }
    const ownsSeamTransform = pattern.id === "room.forced.crack_fall_loop"
      || pattern.id === "transition.override_void";
    if (ownsSeamTransform !== (seamTransform !== undefined)) {
      throw new Error(`${pattern.id}/${emitter.id} seam-transform capability ownership drifted`);
    }
    if (seamTransform !== undefined) {
      assertSeamTransformMotion(seamTransform, `${emitter.id}.seam_transform`);
    }
    const ownsSpeedEnvelope = pattern.id === "room.polarized.hard_cut_corridor"
      || pattern.id === "room.information.stale_packet_retry"
      || pattern.id === "boss.absent_receiver.phase1"
      || pattern.id === "transition.dusk_settle"
      || pattern.id === "transition.room_threshold"
      || (
        pattern.id === "room.in_between.context_switch"
        && emitter.id === "system-b"
      );
    if (ownsSpeedEnvelope !== (speedEnvelope !== undefined)) {
      throw new Error(`${pattern.id}/${emitter.id} speed-envelope capability ownership drifted`);
    }
    if (speedEnvelope !== undefined) {
      const captured = captureSpeedEnvelope(speedEnvelope, `${emitter.id}.speed_envelope`);
      if (
        pattern.id !== "transition.dusk_settle"
        && pattern.id !== "transition.room_threshold"
        && pattern.id !== "room.in_between.context_switch"
        && captured.interpolation !== "step"
      ) {
        throw new Error(`${pattern.id} speed-envelope interpolation contract drifted`);
      }
      if (
        pattern.id === "room.polarized.hard_cut_corridor"
        && (
          captured.keys.length !== 3
          || captured.keys[0]?.atMs !== 0
          || captured.keys[0]?.multiplier !== 1
          || captured.keys[1]?.atMs !== 420
          || captured.keys[1]?.multiplier !== 0
          || captured.keys[2]?.atMs !== 680
          || captured.keys[2]?.multiplier !== 1
        )
      ) {
        throw new Error(`${pattern.id} speed-envelope contract drifted`);
      }
      if (
        pattern.id === "room.information.stale_packet_retry"
        && (
          captured.keys.length !== 3
          || captured.keys[0]?.atMs !== 0
          || captured.keys[0]?.multiplier !== 1
          || captured.keys[1]?.atMs !== 620
          || captured.keys[1]?.multiplier !== 0
          || captured.keys[2]?.atMs !== 1120
          || captured.keys[2]?.multiplier !== 1.35
        )
      ) {
        throw new Error(`${pattern.id} speed-envelope contract drifted`);
      }
      if (
        pattern.id === "boss.absent_receiver.phase1"
        && (
          captured.keys.length !== 3
          || captured.keys[0]?.atMs !== 0
          || captured.keys[0]?.multiplier !== 1
          || captured.keys[1]?.atMs !== 760
          || captured.keys[1]?.multiplier !== 0
          || captured.keys[2]?.atMs !== 1240
          || captured.keys[2]?.multiplier !== 1.25
        )
      ) {
        throw new Error(`${pattern.id} speed-envelope contract drifted`);
      }
    }
  }
  residueLifetimeMs(pattern);
}

function archetypesFor(
  pattern: CombatPattern,
  poolClasses: Readonly<Record<string, ProjectilePoolClass>>,
): readonly {
  readonly id: string;
  readonly poolClass: ProjectilePoolClass;
  readonly collisionRadiusPx: number;
}[] {
  const requiredArchetypes = [...new Set(pattern.emitters.map((emitter) => emitter.projectile.archetype))]
    .sort(compareText);
  const suppliedArchetypes = Object.keys(poolClasses).sort(compareText);
  if (
    suppliedArchetypes.length !== requiredArchetypes.length
    || suppliedArchetypes.some((id, index) => id !== requiredArchetypes[index])
  ) {
    throw new Error(`${pattern.id} requires an exact projectile pool-class mapping`);
  }
  const definitions = new Map<string, {id: string; poolClass: ProjectilePoolClass; collisionRadiusPx: number}>();
  for (const emitter of pattern.emitters) {
    const candidate = {
      id: emitter.projectile.archetype,
      poolClass: poolClassFor(emitter.projectile.archetype, poolClasses),
      collisionRadiusPx: emitter.projectile.collisionRadiusPx,
    };
    const existing = definitions.get(candidate.id);
    if (existing && existing.collisionRadiusPx !== candidate.collisionRadiusPx) {
      throw new Error(`projectile archetype radius drift: ${candidate.id}`);
    }
    definitions.set(candidate.id, candidate);
  }
  return Object.freeze([...definitions.values()].sort((left, right) => compareText(left.id, right.id)));
}

function candidateViolatesSafeGap(
  pattern: CombatPattern,
  difficulty: PatternDifficulty,
  emitter: PatternEmitter,
  position: Vec2,
  headingDegrees: number,
  speedCurve: SpeedCurveContract,
  speedMultiplier: number,
  spawnRelativeMs: number,
  orbitPhaseRadians: number | null,
): boolean {
  const turn = emitter.motionStack.find((entry) => entry.operator === "op.turn_once");
  const lateral = emitter.motionStack.find((entry) => entry.operator === "op.lateral_wall");
  const envelope = speedEnvelopeContract(emitter.motionStack);
  const localVectorBias = localVectorBiasContract(emitter.motionStack);
  const seamTransform = emitter.motionStack.find((entry) => entry.operator === "op.seam_transform");
  const dualClockGate = emitter.motionStack.find((entry) => entry.operator === "op.dual_clock_gate");
  const orbitRelease = orbitReleaseContract(
    emitter.motionStack,
    `${pattern.id}/${emitter.id}.orbit_release`,
  );
  const linearIndex = emitter.motionStack.findIndex((entry) => entry.operator === "op.linear");
  const turnIndex = emitter.motionStack.findIndex((entry) => entry.operator === "op.turn_once");
  const turnDeclaredAfterLinear = turnIndex >= 0
    && linearIndex >= 0
    && turnIndex > linearIndex;
  if (orbitRelease !== undefined) {
    if (
      pattern.id !== "room.in_between.misregistration_corridor"
      || pattern.safeGap.enforcement !== "spawn_omission"
      || orbitPhaseRadians === null
    ) {
      throw new Error(`${pattern.id} orbit/release preflight ownership drifted`);
    }
    const spawnTick120 = crossedTickCount(spawnRelativeMs);
    const armAtTick120 = spawnTick120 + crossedOffsetTickCount(
      spawnRelativeMs,
      emitter.projectile.armDelayMs,
    );
    const patternEndTick120 = crossedTickCount(pattern.durationMs);
    const linearSpeedPxPerSecond = speedCurveAt(speedCurve, 0) * speedMultiplier;
    let previous = position;
    let orbitStarted = false;
    for (let relativeTick120 = spawnTick120 + 1;
      relativeTick120 < patternEndTick120;
      relativeTick120 += 1) {
      if (relativeTick120 <= armAtTick120) continue;
      const previousMs = (relativeTick120 - 1) * 1000 / TICKS_PER_SECOND;
      const currentMs = relativeTick120 * 1000 / TICKS_PER_SECOND;
      const integrated = integrateOrbitReleaseMotion(
        previous,
        position,
        orbitRelease,
        orbitPhaseRadians,
        orbitStarted,
        linearSpeedPxPerSecond,
        spawnRelativeMs,
        previousMs,
        currentMs,
      );
      if (integrated.segments.some((segment) => sweptSegmentViolatesSafeGap(
        pattern,
        difficulty,
        segment.from,
        segment.to,
        emitter.projectile.collisionRadiusPx,
        segment.previousRelativeMs,
        segment.relativeMs,
      ))) return true;
      previous = integrated.position;
      orbitStarted = integrated.orbitStarted;
      if (outOfBounds(previous)) return false;
    }
    return false;
  }
  if (orbitPhaseRadians !== null) {
    throw new Error(`${pattern.id} received an orbit phase without orbit authority`);
  }
  if (pattern.safeGap.enforcement === "phase_gate") {
    const ownsPhaseGate = pattern.id === "room.forced.ballot_shift"
      || pattern.id === "room.polarized.clock_decree"
      || pattern.id === "room.polarized.no_dusk_grid"
      || pattern.id === "room.in_between.stable_intersection"
      || pattern.id === "transition.room_threshold";
    const ownsIndependentRoomThresholdGate = pattern.id === "transition.room_threshold";
    if (
      !ownsPhaseGate
      || (ownsIndependentRoomThresholdGate && dualClockGate !== undefined)
      || (!ownsIndependentRoomThresholdGate && dualClockGate === undefined)
    ) {
      throw new Error(`${pattern.id} phase-gate preflight ownership drifted`);
    }
    // A phase gate retains the authored RNG and entity identities. Its
    // reversible corridor mask is evaluated on each owned 120Hz body; Room
    // Threshold owns no clock and therefore never freezes or omits motion.
    return false;
  }
  if (pattern.safeGap.enforcement === "operator_constraint") {
    // The immutable oracle redirects an already-owned body after motion. It is
    // never a candidate omission, so RNG and occurrence identity survive.
    return false;
  }
  if (seamTransform !== undefined) {
    if (pattern.safeGap.enforcement !== "seam_redirect") {
      throw new Error(`${pattern.id} seam transform lost its redirect compiler`);
    }
    // seam_redirect is an authored transformation, never a preflight omission:
    // every candidate retains entity and RNG identity.
    return false;
  }
  if (
    turn !== undefined
    || lateral !== undefined
    || envelope !== undefined
    || localVectorBias !== undefined
    || speedCurve.keys.length > 1
  ) {
    const spawnTick120 = crossedTickCount(spawnRelativeMs);
    const armAtTick120 = spawnTick120 + crossedOffsetTickCount(
      spawnRelativeMs,
      emitter.projectile.armDelayMs,
    );
    const turnAtAgeTick120 = turn === undefined
      ? null
      : crossedOffsetTickCount(spawnRelativeMs, numberParameter(turn, "atMs", 0));
    const patternEndTick120 = crossedTickCount(pattern.durationMs);
    let previous = position;
    let heading = headingDegrees;
    let turned = false;
    for (let relativeTick120 = spawnTick120 + 1;
      relativeTick120 < patternEndTick120;
      relativeTick120 += 1) {
      if (relativeTick120 <= armAtTick120) continue;
      const ageTick120 = relativeTick120 - spawnTick120;
      if (
        !turnDeclaredAfterLinear
        && turnAtAgeTick120 !== null
        && !turned
        && ageTick120 >= turnAtAgeTick120
      ) {
        heading += numberParameter(turn, "deltaDeg", 0);
        turned = true;
      }
      const previousMs = (relativeTick120 - 1) * 1000 / TICKS_PER_SECOND;
      const currentMs = relativeTick120 * 1000 / TICKS_PER_SECOND;
      if (
        envelope !== undefined
        || localVectorBias !== undefined
        || speedCurve.keys.length > 1
      ) {
        const integrated = integrateKinematicMotion(
          previous,
          heading,
          speedCurve,
          speedMultiplier,
          numberParameter(lateral, "driftPxPerSec", 0),
          envelope,
          localVectorBias,
          spawnRelativeMs,
          previousMs,
          currentMs,
        );
        if (integrated.segments.some((segment) => sweptSegmentViolatesSafeGap(
          pattern,
          difficulty,
          segment.from,
          segment.to,
          emitter.projectile.collisionRadiusPx,
          segment.previousRelativeMs,
          segment.relativeMs,
        ))) return true;
        previous = integrated.position;
        if (
          turnDeclaredAfterLinear
          && turnAtAgeTick120 !== null
          && !turned
          && ageTick120 >= turnAtAgeTick120
        ) {
          heading += numberParameter(turn, "deltaDeg", 0);
          turned = true;
        }
        if (outOfBounds(previous)) return false;
        continue;
      }
      const radians = degreesToRadians(heading);
      const speedPxPerSecond = speedCurveAt(speedCurve, 0) * speedMultiplier;
      const next = Object.freeze({
        x: previous.x + (
          Math.cos(radians) * speedPxPerSecond
          + numberParameter(lateral, "driftPxPerSec", 0)
        ) / TICKS_PER_SECOND,
        y: previous.y + Math.sin(radians) * speedPxPerSecond / TICKS_PER_SECOND,
      });
      if (sweptSegmentViolatesSafeGap(
        pattern,
        difficulty,
        previous,
        next,
        emitter.projectile.collisionRadiusPx,
        previousMs,
        currentMs,
      )) return true;
      previous = next;
      if (
        turnDeclaredAfterLinear
        && turnAtAgeTick120 !== null
        && !turned
        && ageTick120 >= turnAtAgeTick120
      ) {
        heading += numberParameter(turn, "deltaDeg", 0);
        turned = true;
      }
      if (outOfBounds(next)) return false;
    }
    return false;
  }
  const speedPxPerSecond = speedCurveAt(speedCurve, 0) * speedMultiplier;
  const radians = degreesToRadians(headingDegrees);
  const velocityY = Math.sin(radians) * speedPxPerSecond;
  if (velocityY <= 0) return false;
  const secondsToPlayerBand = Math.max(0, (AUTHORED_PLAYER_Y - position.y) / velocityY);
  const projectedX = position.x + Math.cos(radians) * speedPxPerSecond * secondsToPlayerBand;
  const arrivalMs = spawnRelativeMs + secondsToPlayerBand * 1000;
  const halfWidth = safeGapWidth(pattern, difficulty) / 2
    + emitter.projectile.collisionRadiusPx;
  return Math.abs(projectedX - safeGapCenter(pattern, arrivalMs)) < halfWidth;
}

function sweptSegmentViolatesSafeGap(
  pattern: CombatPattern,
  difficulty: PatternDifficulty,
  from: Vec2,
  to: Vec2,
  collisionRadiusPx: number,
  previousRelativeMs: number,
  relativeMs: number,
): boolean {
  const segmentDurationMs = relativeMs - previousRelativeMs;
  if (!Number.isFinite(segmentDurationMs) || segmentDurationMs < 0) {
    throw new Error("safe-gap sweep segment time must be finite and monotonic");
  }
  const bandMinimumY = 476;
  const bandMaximumY = 622;
  const deltaY = to.y - from.y;
  let intervalStart = 0;
  let intervalEnd = 1;
  if (Math.abs(deltaY) <= Number.EPSILON) {
    if (from.y < bandMinimumY || from.y > bandMaximumY) return false;
  } else {
    const first = (bandMinimumY - from.y) / deltaY;
    const second = (bandMaximumY - from.y) / deltaY;
    intervalStart = Math.max(0, Math.min(first, second));
    intervalEnd = Math.min(1, Math.max(first, second));
    if (intervalStart > intervalEnd) return false;
  }

  const relativeFromX = from.x - safeGapCenter(pattern, previousRelativeMs);
  const relativeToX = to.x - safeGapCenter(pattern, relativeMs);
  const relativeDeltaX = relativeToX - relativeFromX;
  const candidateTimes = [intervalStart, intervalEnd];
  if (Math.abs(relativeDeltaX) > Number.EPSILON) {
    candidateTimes.push(Math.max(intervalStart, Math.min(intervalEnd, -relativeFromX / relativeDeltaX)));
  }
  const closestDistance = Math.min(...candidateTimes.map((time) =>
    Math.abs(relativeFromX + relativeDeltaX * time)));
  const pathEnvelopeForSegment = pattern.safeGap.path.maxTravelPxPerSec
    * segmentDurationMs / 1000;
  const halfWidth = safeGapWidth(pattern, difficulty) / 2
    + collisionRadiusPx
    + 2
    + pathEnvelopeForSegment;
  return closestDistance < halfWidth;
}

function laneSwitchPathBreakpoints(
  pattern: CombatPattern,
  previousRelativeMs: number,
  relativeMs: number,
): readonly number[] {
  const lanes = pattern.safeGap.path.laneX;
  if (lanes.length === 0 || relativeMs <= previousRelativeMs) return Object.freeze([]);
  const route = lanes.length > 2
    ? [...lanes, ...lanes.slice(1, -1).reverse()]
    : [...lanes];
  if (route.length === 0) return Object.freeze([]);
  const periodMs = pattern.safeGap.path.periodMs;
  const segmentMs = periodMs / route.length;
  const epochMs = 900;
  const centerX = pattern.safeGap.path.centerX;
  const breakpoints = new Set<number>();
  if (previousRelativeMs < epochMs && epochMs < relativeMs) breakpoints.add(epochMs);
  const firstSegmentIndex = Math.max(
    0,
    Math.floor((previousRelativeMs - epochMs) / segmentMs) - 1,
  );
  const finalSegmentIndex = Math.max(
    firstSegmentIndex,
    Math.ceil((relativeMs - epochMs) / segmentMs) + 1,
  );
  for (let segmentIndex = firstSegmentIndex;
    segmentIndex <= finalSegmentIndex;
    segmentIndex += 1) {
    const segmentStartMs = epochMs + segmentIndex * segmentMs;
    const routeIndex = segmentIndex % route.length;
    const target = route[routeIndex] ?? centerX;
    const previous = segmentIndex === 0
      ? centerX
      : (route[(routeIndex - 1 + route.length) % route.length] ?? centerX);
    const transitionMs = Math.min(
      segmentMs,
      Math.max(1000, Math.abs(target - previous) / 78 * 1000),
    );
    for (const boundary of [segmentStartMs, segmentStartMs + transitionMs]) {
      if (previousRelativeMs < boundary && boundary < relativeMs) breakpoints.add(boundary);
    }
  }
  return Object.freeze([...breakpoints].sort((left, right) => left - right));
}

function quantizedTrianglePathBreakpoints(
  pattern: CombatPattern,
  previousRelativeMs: number,
  relativeMs: number,
): readonly number[] {
  if (relativeMs <= previousRelativeMs) return Object.freeze([]);
  const periodMs = pattern.safeGap.path.periodMs;
  const cuspStrideMs = periodMs / 2;
  const firstCuspMs = periodMs * (0.25 - pattern.safeGap.path.phase);
  const firstIndex = Math.floor((previousRelativeMs - firstCuspMs) / cuspStrideMs) - 1;
  const finalIndex = Math.ceil((relativeMs - firstCuspMs) / cuspStrideMs) + 1;
  const breakpoints = new Set<number>();
  for (let index = firstIndex; index <= finalIndex; index += 1) {
    const cuspMs = firstCuspMs + index * cuspStrideMs;
    if (previousRelativeMs < cuspMs && cuspMs < relativeMs) breakpoints.add(cuspMs);
  }
  return Object.freeze([...breakpoints].sort((left, right) => left - right));
}

function linearPhaseGapSegmentViolatesSafeGap(
  pattern: CombatPattern,
  difficulty: PatternDifficulty,
  from: Vec2,
  to: Vec2,
  collisionRadiusPx: number,
  previousRelativeMs: number,
  relativeMs: number,
): boolean {
  const bandMinimumY = 476;
  const bandMaximumY = 622;
  const deltaY = to.y - from.y;
  let intervalStart = 0;
  let intervalEnd = 1;
  if (Math.abs(deltaY) <= Number.EPSILON) {
    if (from.y < bandMinimumY || from.y > bandMaximumY) return false;
  } else {
    const first = (bandMinimumY - from.y) / deltaY;
    const second = (bandMaximumY - from.y) / deltaY;
    intervalStart = Math.max(0, Math.min(first, second));
    intervalEnd = Math.min(1, Math.max(first, second));
    if (intervalStart > intervalEnd) return false;
  }
  const relativeFromX = from.x - safeGapCenter(pattern, previousRelativeMs);
  const relativeToX = to.x - safeGapCenter(pattern, relativeMs);
  const relativeDeltaX = relativeToX - relativeFromX;
  const candidates = [intervalStart, intervalEnd];
  if (Math.abs(relativeDeltaX) > Number.EPSILON) {
    candidates.push(Math.max(
      intervalStart,
      Math.min(intervalEnd, -relativeFromX / relativeDeltaX),
    ));
  }
  const closestDistance = Math.min(...candidates.map((time) =>
    Math.abs(relativeFromX + relativeDeltaX * time)));
  return closestDistance < safeGapWidth(pattern, difficulty) / 2 + collisionRadiusPx + 2;
}

function reversiblePhaseGateAllowsCollision(
  pattern: CombatPattern,
  difficulty: PatternDifficulty,
  from: Vec2,
  proposed: Vec2,
  collisionRadiusPx: number,
  previousRelativeMs: number,
  relativeMs: number,
): boolean {
  let pathBreakpoints: readonly number[];
  if (pattern.id === "room.forced.ballot_shift") {
    if (pattern.safeGap.type !== "lane_switch") {
      throw new Error(`${pattern.id} phase-gate path ownership drifted`);
    }
    pathBreakpoints = laneSwitchPathBreakpoints(pattern, previousRelativeMs, relativeMs);
  } else if (pattern.id === "room.polarized.clock_decree") {
    if (pattern.safeGap.type !== "quantized_step" || pattern.safeGap.path.laneX.length !== 0) {
      throw new Error(`${pattern.id} phase-gate path ownership drifted`);
    }
    pathBreakpoints = quantizedTrianglePathBreakpoints(
      pattern,
      previousRelativeMs,
      relativeMs,
    );
  } else if (pattern.id === "room.polarized.no_dusk_grid") {
    if (pattern.safeGap.type !== "binary_cross" || pattern.safeGap.path.laneX.length !== 0) {
      throw new Error(`${pattern.id} phase-gate path ownership drifted`);
    }
    pathBreakpoints = quantizedTrianglePathBreakpoints(
      pattern,
      previousRelativeMs,
      relativeMs,
    );
  } else if (pattern.id === "room.in_between.stable_intersection") {
    if (
      pattern.safeGap.type !== "dual_clock_intersection"
      || pattern.safeGap.enforcement !== "phase_gate"
      || pattern.safeGap.path.laneX.length !== 0
    ) {
      throw new Error(`${pattern.id} phase-gate path ownership drifted`);
    }
    // Unlike the quantized paths above, this corridor is a continuous sine.
    // Use the shared analytic extrema/bisection sweep so a complete enter/exit
    // between two endpoints cannot disappear through temporal undersampling.
    return firstSafeGapEntryOnSegment(
      pattern,
      difficulty,
      motionSegment(
        from,
        proposed,
        previousRelativeMs,
        relativeMs,
        Math.hypot(proposed.x - from.x, proposed.y - from.y)
          * 1000 / Math.max(Number.EPSILON, relativeMs - previousRelativeMs),
      ),
      collisionRadiusPx,
    ) === null;
  } else {
    throw new Error(`${pattern.id} reversible phase-gate ownership drifted`);
  }
  const boundaries = [
    previousRelativeMs,
    ...pathBreakpoints,
    relativeMs,
  ];
  const durationMs = relativeMs - previousRelativeMs;
  const positionAt = (atMs: number): Vec2 => {
    const progress = durationMs <= 0 ? 1 : (atMs - previousRelativeMs) / durationMs;
    return Object.freeze({
      x: from.x + (proposed.x - from.x) * progress,
      y: from.y + (proposed.y - from.y) * progress,
    });
  };
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startMs = boundaries[index];
    const endMs = boundaries[index + 1];
    if (startMs === undefined || endMs === undefined) continue;
    if (linearPhaseGapSegmentViolatesSafeGap(
      pattern,
      difficulty,
      positionAt(startMs),
      positionAt(endMs),
      collisionRadiusPx,
      startMs,
      endMs,
    )) return false;
  }
  return true;
}

function sweptRuntimeViolatesSafeGap(
  pattern: CombatPattern,
  difficulty: PatternDifficulty,
  projectile: ProjectileSnapshot,
  previousRelativeMs: number,
  relativeMs: number,
): boolean {
  return sweptSegmentViolatesSafeGap(
    pattern,
    difficulty,
    projectile.previousPosition,
    projectile.position,
    projectile.collisionRadiusPx,
    previousRelativeMs,
    relativeMs,
  );
}

/** Relative swept-circle test: both projectile and player may move during the master tick. */
export function sweepMovingProjectileAgainstPlayer(
  projectilePrevious: Vec2,
  projectileCurrent: Vec2,
  projectileRadius: number,
  playerPrevious: Vec2,
  playerCurrent: Vec2,
  playerRadius: number,
): SweepHit | null {
  return sweepCircleAgainstCircle(
    {
      x: projectilePrevious.x - playerPrevious.x,
      y: projectilePrevious.y - playerPrevious.y,
    },
    {
      x: projectileCurrent.x - playerCurrent.x,
      y: projectileCurrent.y - playerCurrent.y,
    },
    projectileRadius,
    {center: {x: 0, y: 0}, radius: playerRadius},
  );
}

function interpolatePlayerPosition(from: Vec2, to: Vec2, fraction: number): Vec2 {
  const clamped = Math.max(0, Math.min(1, fraction));
  return Object.freeze({
    x: from.x + (to.x - from.x) * clamped,
    y: from.y + (to.y - from.y) * clamped,
  });
}

function sweepRuntimeAgainstMovingPlayer(
  runtime: RuntimeProjectile,
  snapshot: ProjectileSnapshot,
  tick120: number,
  startTick120: number,
  playerPrevious: Vec2,
  playerCurrent: Vec2,
  playerRadius: number,
): SweepHit | null {
  const tickStartRelativeMs = (tick120 - startTick120 - 1) * 1000 / TICKS_PER_SECOND;
  const tickDurationMs = 1000 / TICKS_PER_SECOND;
  const segments = runtime.movementSegmentsAtTick120 === tick120
    && runtime.movementSegments.length > 0
    ? runtime.movementSegments
    : Object.freeze([Object.freeze({
        from: snapshot.previousPosition,
        to: snapshot.position,
        previousRelativeMs: tickStartRelativeMs,
        relativeMs: tickStartRelativeMs + tickDurationMs,
        speedPxPerSecond: runtime.speedPxPerSecond,
      })]);
  for (const segment of segments) {
    const playerFrom = interpolatePlayerPosition(
      playerPrevious,
      playerCurrent,
      (segment.previousRelativeMs - tickStartRelativeMs) / tickDurationMs,
    );
    const playerTo = interpolatePlayerPosition(
      playerPrevious,
      playerCurrent,
      (segment.relativeMs - tickStartRelativeMs) / tickDurationMs,
    );
    const hit = sweepMovingProjectileAgainstPlayer(
      segment.from,
      segment.to,
      snapshot.collisionRadiusPx,
      playerFrom,
      playerTo,
      playerRadius,
    );
    if (hit !== null) return hit;
  }
  return null;
}

function outOfBounds(position: Vec2): boolean {
  return position.x < -96 || position.x > LOGICAL_VIEW_WIDTH + 96
    || position.y < -128 || position.y > LOGICAL_VIEW_HEIGHT + 128;
}

function validateCombatStepAgainstRunState(
  input: CanonicalCombatStepInput,
  internals: Pick<
    RunCombatStateInternals,
    "currentTick120" | "currentPlayerPosition" | "player"
  >,
): ValidatedCombatStepInput {
  const tickValue = ownInputData(input, "tick120", true);
  const movementValue = ownInputData(input, "movement", true);
  const focusedValue = ownInputData(input, "focused", true);
  const overridePressedValue = ownInputData(input, "overridePressed", false);
  const overrideReleasedValue = ownInputData(input, "overrideReleased", false);
  const overrideDirectionValue = ownInputData(input, "overrideDirection", false);
  const tick120 = requireSafeTick(tickValue as number, "combat step tick120");
  if (tick120 !== internals.currentTick120 + 1) {
    throw new Error(
      `canonical combat must advance one tick at a time: ${internals.currentTick120} -> ${tick120}`,
    );
  }
  const movement = freezeVec2(movementValue as Vec2, "combat movement");
  const magnitude = Math.hypot(movement.x, movement.y);
  if (magnitude > 1 + INPUT_MAGNITUDE_TOLERANCE) {
    throw new Error(`combat movement magnitude must not exceed one: ${magnitude}`);
  }
  if (typeof focusedValue !== "boolean") throw new Error("combat focused must be boolean");
  if (overridePressedValue !== undefined && typeof overridePressedValue !== "boolean") {
    throw new Error("combat overridePressed must be boolean when present");
  }
  if (overrideReleasedValue !== undefined && typeof overrideReleasedValue !== "boolean") {
    throw new Error("combat overrideReleased must be boolean when present");
  }
  const overridePressed = overridePressedValue ?? false;
  const overrideReleased = overrideReleasedValue ?? false;
  if (overridePressed && overrideReleased) {
    throw new Error("Override press and release cannot share one sampled edge");
  }
  let overrideDirection: Vec2 | null = null;
  if (overrideDirectionValue !== undefined) {
    overrideDirection = freezeVec2(overrideDirectionValue as Vec2, "combat overrideDirection");
    if (Math.hypot(overrideDirection.x, overrideDirection.y) <= Number.EPSILON) {
      throw new Error("combat overrideDirection must be non-zero");
    }
  }
  if (overridePressed && overrideDirection === null) {
    throw new Error("Override press requires an explicit direction");
  }
  const inputEligible = playerInputEligibleAtTick(internals.player.snapshot(), tick120);
  const focused = inputEligible && focusedValue;
  const movementScale = magnitude > 1 ? 1 / magnitude : 1;
  const maximumTravel = (focused
    ? PLAYER_FOCUS_MAX_SPEED_PX_PER_SECOND
    : PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND) / TICKS_PER_SECOND;
  const playerPosition = inputEligible
    ? Object.freeze({
        x: Math.max(0, Math.min(
          LOGICAL_VIEW_WIDTH,
          internals.currentPlayerPosition.x + movement.x * movementScale * maximumTravel,
        )),
        y: Math.max(0, Math.min(
          LOGICAL_VIEW_HEIGHT,
          internals.currentPlayerPosition.y + movement.y * movementScale * maximumTravel,
        )),
      })
    : internals.currentPlayerPosition;
  return Object.freeze({
    tick120,
    playerPosition,
    focused,
    overridePressed: inputEligible && overridePressed,
    overrideReleased: inputEligible && overrideReleased,
    overrideDirection,
  });
}

function runCombatStateInternals(state: CanonicalRunCombatState): RunCombatStateInternals {
  const internals = RUN_COMBAT_STATE_INTERNALS.get(state);
  if (internals === undefined) throw new Error("unrecognized canonical run combat state");
  return internals;
}

function assertRunCombatStateOperational(internals: RunCombatStateInternals): void {
  if (internals.fault === null) return;
  throw new Error(
    `canonical run combat state is faulted: ${internals.fault.message}`,
    {cause: internals.fault},
  );
}

function isExactCanonicalRunCombatState(
  value: unknown,
): value is CanonicalRunCombatState {
  return typeof value === "object"
    && value !== null
    && RUN_COMBAT_STATE_INTERNALS.has(value as CanonicalRunCombatState)
    && Object.getPrototypeOf(value) === CanonicalRunCombatState.prototype
    && !Object.prototype.hasOwnProperty.call(value, "snapshot")
    && !Object.prototype.hasOwnProperty.call(value, "flushTick");
}

function isExactExt013RoomThresholdKernel(
  value: unknown,
): value is CanonicalCombatKernel {
  return typeof value === "object"
    && value !== null
    && EXT013_ROOM_THRESHOLD_KERNELS.has(value as CanonicalCombatKernel)
    && Object.getPrototypeOf(value) === CanonicalCombatKernel.prototype
    && !Object.prototype.hasOwnProperty.call(value, "snapshot")
    && !Object.prototype.hasOwnProperty.call(value, "advanceTick");
}

/**
 * Narrow coordinator escape hatch for an impossible invariant failure after a
 * transition composite batch was already accepted by the shared event bus.
 */
export function failStopCanonicalRunCombatAfterAcceptedTransitionAppend(
  runState: CanonicalRunCombatState,
  transitionProof: CanonicalCombatKernel,
  cause: unknown,
): void {
  if (!isExactCanonicalRunCombatState(runState)) {
    throw new Error("transition fail-stop requires an exact CanonicalRunCombatState");
  }
  const internals = runCombatStateInternals(runState);
  const exactLiveKernel = isExactExt013RoomThresholdKernel(transitionProof)
    ? transitionProof
    : null;
  const kernelProof = exactLiveKernel === null
    ? null
    : exactLiveKernel[ROOM_THRESHOLD_FAIL_STOP_PROOF]();
  const activeTickAppendAccepted = kernelProof?.runState === runState
    && internals.activeOccurrenceId === FIRST_CONTINUATION_ROOM_THRESHOLD_OCCURRENCE_ID
    && internals.pendingFlushTick120 === kernelProof.tick120;
  const detachFlushCommitted = kernelProof?.runState === runState
    && kernelProof.materialDetachPending
    && internals.activeOccurrenceId === null
    && internals.pendingReleaseOccurrenceId === null
    && internals.pendingFlushTick120 === null;
  if (!activeTickAppendAccepted && !detachFlushCommitted) {
    throw new Error("transition fail-stop requires the exact active EXT-013 kernel proof");
  }
  if (internals.fault !== null) return;
  internals.fault = cause instanceof Error ? cause : new Error(String(cause));
}

function claimRunCombatOccurrence(
  state: CanonicalRunCombatState,
  occurrenceId: string,
  startTick120: number,
): void {
  const internals = runCombatStateInternals(state);
  assertRunCombatStateOperational(internals);
  if (EXT013_ROOM_THRESHOLD_RUN_BINDINGS.has(state)) {
    throw new Error(
      "run combat cannot claim a new occurrence until successor admission releases the active continuation binding",
    );
  }
  if (internals.currentTick120 !== startTick120) {
    throw new Error(
      `run combat occurrence must start at the current tick: ${internals.currentTick120} !== ${startTick120}`,
    );
  }
  if (internals.pendingFlushTick120 !== null) {
    throw new Error(`run combat tick ${internals.pendingFlushTick120} must flush before claiming an occurrence`);
  }
  if (internals.activeOccurrenceId !== null) {
    throw new Error(`run combat already owns active occurrence: ${internals.activeOccurrenceId}`);
  }
  if (internals.claimedOccurrenceIds.has(occurrenceId)) {
    throw new Error(`run combat occurrence identity was already claimed: ${occurrenceId}`);
  }
  internals.claimedOccurrenceIds.add(occurrenceId);
  internals.activeOccurrenceId = occurrenceId;
}

function requestRunCombatOccurrenceRelease(
  state: CanonicalRunCombatState,
  occurrenceId: string,
): void {
  const internals = runCombatStateInternals(state);
  if (internals.activeOccurrenceId !== occurrenceId) {
    throw new Error(`run combat cannot release inactive occurrence: ${occurrenceId}`);
  }
  if (internals.pendingReleaseOccurrenceId !== null) {
    throw new Error(`run combat occurrence release is already pending: ${occurrenceId}`);
  }
  internals.pendingReleaseOccurrenceId = occurrenceId;
}

function requirePreparedRoomThresholdStart(
  proposal: PreparedCanonicalRunRoomThresholdStart,
): PreparedRunRoomThresholdStartRecord {
  if (typeof proposal !== "object" || proposal === null) {
    throw new Error("Room Threshold start proposal must be opaque");
  }
  const record = PREPARED_RUN_ROOM_THRESHOLD_STARTS.get(proposal);
  if (record === undefined) throw new Error("Room Threshold start proposal is not registered");
  if (record.status !== "prepared") {
    throw new Error(`Room Threshold start proposal is ${record.status}`);
  }
  if (
    ACTIVE_RUN_ROOM_THRESHOLD_START_BY_TRANSITION_RECEIPT.get(
      record.transitionReceipt,
    ) !== proposal
  ) {
    throw new Error("Room Threshold start proposal lost its formal-target reservation");
  }
  return record;
}

function validatePreparedRoomThresholdStartRecord(
  record: PreparedRunRoomThresholdStartRecord,
): void {
  const internals = runCombatStateInternals(record.runState);
  assertRunCombatStateOperational(internals);
  assertCanonicalRunFirstContinuationRoomTransitionReceiptOwner(
    record.transitionReceipt,
    record.runState,
  );
  const formalTarget = firstContinuationRoomTargetFromCanonicalTransitionReceipt(
    record.transitionReceipt,
  );
  if (
    formalTarget !== record.formalTarget
    || formalTarget.targetRoom !== record.view.targetRoom
    || formalTarget.rawRunSeed.value !== record.view.rawRunSeed
    || formalTarget.selectedAtTick120 + 1 !== record.view.tick120
  ) {
    throw new Error("Room Threshold formal target receipt drifted");
  }
  if (
    internals.advanceLocked
    || internals.currentTick120 !== record.beforeTick120
    || internals.currentPlayerPosition.x !== record.beforePlayerPosition.x
    || internals.currentPlayerPosition.y !== record.beforePlayerPosition.y
    || internals.focused !== record.beforeFocused
    || internals.activeOccurrenceId !== null
    || internals.pendingReleaseOccurrenceId !== null
    || internals.pendingFlushTick120 !== null
    || internals.claimedOccurrenceIds.has(FIRST_CONTINUATION_ROOM_THRESHOLD_OCCURRENCE_ID)
    || internals.bus.pendingEventCount() !== 0
  ) {
    throw new Error("Room Threshold start proposal became stale at the shared run boundary");
  }
  const roomBefore = RoomTransitionAuthority.prototype.snapshot.call(
    record.roomTransition,
  );
  if (
    roomBefore.tick120 !== record.roomTransitionBefore.tick120
    || roomBefore.state !== record.roomTransitionBefore.state
    || roomBefore.currentRoom !== record.roomTransitionBefore.currentRoom
    || roomBefore.targetRoom !== record.roomTransitionBefore.targetRoom
    || roomBefore.generation !== record.roomTransitionBefore.generation
    || roomBefore.eventCount !== record.roomTransitionBefore.eventCount
    || roomBefore.active !== record.roomTransitionBefore.active
  ) {
    throw new Error("Room Threshold room-transition request became stale");
  }
  const currentRoomView = RoomTransitionAuthority.prototype.validatePreparedMutation.call(
    record.roomTransition,
    record.roomTransitionProposal,
    internals.bus,
  );
  if (
    currentRoomView !== record.roomTransitionView
    || currentRoomView.drafts !== record.roomTransitionView.drafts
    || currentRoomView.preview !== record.roomTransitionView.preview
  ) {
    throw new Error("Room Threshold room-transition request proposal drifted");
  }
  const currentPlayerView = inspectPreparedPlayerCollisionBlockerMutation(
    record.playerProposal,
  );
  if (
    currentPlayerView.owner !== internals.player
    || currentPlayerView.eventBus !== internals.bus
    || currentPlayerView.kind !== "acquire"
    || currentPlayerView.tick120 !== record.validated.tick120
    || currentPlayerView.lease !== record.playerView.lease
    || currentPlayerView.drafts !== record.playerView.drafts
  ) {
    throw new Error("Room Threshold player blocker proposal drifted");
  }
  const override = internals.override.snapshot();
  if (
    override.tick120 !== record.beforeTick120
    || override.state !== "idle"
    || override.deadlineTick120 !== null
    || override.localVoid !== null
  ) {
    throw new Error("Room Threshold start requires an idle, quiescent Override authority");
  }
}

/**
 * Purely stage EXT-013's exact H+1703 player blocker, room-FSM request, and
 * deferred combat install. Only the sealed commit below can append the drafts.
 */
export function prepareCanonicalRunRoomThresholdStartNextTick(
  runState: CanonicalRunCombatState,
  roomTransition: RoomTransitionAuthority,
  transitionReceipt: CanonicalRunFirstContinuationRoomTransitionReceipt,
  input: CanonicalCombatStepInput,
): PreparedCanonicalRunRoomThresholdStart {
  const formalTarget = firstContinuationRoomTargetFromCanonicalTransitionReceipt(
    transitionReceipt,
  );
  if (ACTIVE_RUN_ROOM_THRESHOLD_START_BY_TRANSITION_RECEIPT.has(transitionReceipt)) {
    throw new Error("formal target receipt already owns a Room Threshold start proposal");
  }
  try {
    return prepareCanonicalRunRoomThresholdStartFromFormalTarget(
      runState,
      roomTransition,
      transitionReceipt,
      formalTarget,
      input,
    );
  } catch (error) {
    cancelCanonicalRunFirstContinuationRoomTransitionReceipt(transitionReceipt);
    throw error;
  }
}

function prepareCanonicalRunRoomThresholdStartFromFormalTarget(
  runState: CanonicalRunCombatState,
  roomTransition: RoomTransitionAuthority,
  transitionReceipt: CanonicalRunFirstContinuationRoomTransitionReceipt,
  formalTarget: CanonicalRunFirstContinuationRoomTargetAvailable,
  input: CanonicalCombatStepInput,
): PreparedCanonicalRunRoomThresholdStart {
  if (!isExactCanonicalRunCombatState(runState)) {
    throw new Error("Room Threshold start requires an exact CanonicalRunCombatState");
  }
  assertCanonicalRunFirstContinuationRoomTransitionReceiptOwner(
    transitionReceipt,
    runState,
  );
  const internals = runCombatStateInternals(runState);
  assertRunCombatStateOperational(internals);
  if (!isExactRoomTransitionAuthority(roomTransition)) {
    throw new Error("Room Threshold start requires the exact room-transition authority");
  }
  const targetRoomValue = formalTarget.targetRoom;
  if (
    !FIRST_CONTINUATION_ROOM_THRESHOLD_TARGETS.includes(
      targetRoomValue as CanonicalRunRoomThresholdTargetRoom,
    )
  ) {
    throw new Error("Room Threshold formal target left the exact first-continuation universe");
  }
  const targetRoom = targetRoomValue as CanonicalRunRoomThresholdTargetRoom;
  const rawRunSeed = formalTarget.rawRunSeed.value;
  const selectedAtTick120 = requireSafeTick(
    formalTarget.selectedAtTick120,
    "Room Threshold formal target selectedAtTick120",
  );
  if (selectedAtTick120 === Number.MAX_SAFE_INTEGER) {
    throw new Error("Room Threshold formal target cannot start beyond the safe tick range");
  }
  const startTick120 = selectedAtTick120 + 1;
  if (
    internals.advanceLocked
    || internals.pendingFlushTick120 !== null
    || internals.pendingReleaseOccurrenceId !== null
    || internals.activeOccurrenceId !== null
    || internals.claimedOccurrenceIds.has(FIRST_CONTINUATION_ROOM_THRESHOLD_OCCURRENCE_ID)
    || internals.bus.pendingEventCount() !== 0
  ) {
    throw new Error("Room Threshold start requires an idle unclaimed shared run boundary");
  }
  if (
    internals.currentTick120 !== selectedAtTick120
    || startTick120 !== internals.currentTick120 + 1
  ) {
    throw new Error("Room Threshold start requires its formal target's exact H+1702 Run boundary");
  }
  const player = internals.player.snapshot();
  if (
    player.tick120 !== internals.currentTick120
    || player.state !== "alive"
    || player.collisionEnabled !== true
    || player.activeLeases.length !== 0
    || player.recoveryAtTick120 !== null
    || player.respawnPlaceAtTick120 !== null
    || player.respawnCompleteAtTick120 !== null
    || player.handoff !== null
  ) {
    throw new Error("Room Threshold start requires an alive, collision-enabled, quiescent player");
  }
  const override = internals.override.snapshot();
  if (
    override.tick120 !== internals.currentTick120
    || override.state !== "idle"
    || override.deadlineTick120 !== null
    || override.localVoid !== null
  ) {
    throw new Error("Room Threshold start requires an idle, quiescent Override authority");
  }
  const validated = validateCombatStepAgainstRunState(input, internals);
  if (validated.tick120 !== startTick120) {
    throw new Error("Room Threshold input tick disagrees with its exact start tick");
  }
  if (validated.overridePressed || validated.overrideReleased) {
    throw new Error("Room Threshold start cannot admit an Override edge before local resistance");
  }
  const roomTransitionBefore = RoomTransitionAuthority.prototype.snapshot.call(roomTransition);
  if (
    (roomTransitionBefore.tick120 !== null
      && roomTransitionBefore.tick120 !== internals.currentTick120)
    || roomTransitionBefore.state !== "idle"
    || roomTransitionBefore.currentRoom !== "FORCED_ALIGNMENT"
    || roomTransitionBefore.targetRoom !== null
    || roomTransitionBefore.generation !== 0
    || roomTransitionBefore.eventCount !== 0
    || roomTransitionBefore.active !== null
  ) {
    throw new Error("Room Threshold start requires the unused first room-transition boundary");
  }
  const roomTransitionProposal = RoomTransitionAuthority.prototype.prepareRequest.call(
    roomTransition,
    targetRoom,
    startTick120,
  );
  const roomTransitionView = RoomTransitionAuthority.prototype.validatePreparedMutation.call(
    roomTransition,
    roomTransitionProposal,
    internals.bus,
  );
  const preparedRoomActive = roomTransitionView.preview.active;
  if (
    roomTransitionView.kind !== "request"
    || roomTransitionView.eventBus !== internals.bus
    || roomTransitionView.tick120 !== startTick120
    || roomTransitionView.drafts.length !== 1
    || roomTransitionView.drafts[0]?.id !== "room.transition.begin"
    || roomTransitionView.drafts[0]?.tick120 !== startTick120
    || roomTransitionView.preview.state !== "preparing"
    || roomTransitionView.preview.currentRoom !== "FORCED_ALIGNMENT"
    || roomTransitionView.preview.targetRoom !== targetRoom
    || roomTransitionView.preview.generation !== 1
    || preparedRoomActive === null
    || preparedRoomActive.fromRoom !== "FORCED_ALIGNMENT"
    || preparedRoomActive.toRoom !== targetRoom
    || preparedRoomActive.requestTick120 !== startTick120
  ) {
    throw new Error("Room Threshold prepared room-transition request does not match EXT-013");
  }
  const playerProposal = PlayerDamageAuthority.prototype.prepareCollisionBlockerAcquire.call(
    internals.player,
    "room-transition",
    "atomic-world-swap",
    startTick120,
  );
  const playerView = inspectPreparedPlayerCollisionBlockerMutation(playerProposal);
  if (
    playerView.eventBus !== internals.bus
    || playerView.kind !== "acquire"
    || playerView.before.playerId !== player.playerId
    || playerView.before.tick120 !== player.tick120
    || playerView.before.state !== player.state
    || playerView.before.health !== player.health
    || playerView.before.lives !== player.lives
    || playerView.before.collisionEnabled !== player.collisionEnabled
    || playerView.before.activeLeases.length !== player.activeLeases.length
    || playerView.before.recoveryAtTick120 !== player.recoveryAtTick120
    || playerView.before.respawnPlaceAtTick120 !== player.respawnPlaceAtTick120
    || playerView.before.respawnCompleteAtTick120 !== player.respawnCompleteAtTick120
    || playerView.before.handoff !== player.handoff
    || playerView.preview.state !== "alive"
    || playerView.preview.collisionEnabled !== false
    || playerView.preview.activeLeases.length !== 1
    || playerView.preview.activeLeases[0] !== playerView.lease
    || playerView.lease.owner !== "room-transition"
    || playerView.lease.reason !== "atomic-world-swap"
  ) {
    throw new Error("Room Threshold prepared player blocker does not match EXT-013");
  }
  const resolvedSeed = (rawRunSeed ^ ROOM_THRESHOLD_SEED_BASE) >>> 0;
  const kernel = new CanonicalCombatKernel({
    patternId: FIRST_CONTINUATION_ROOM_THRESHOLD_PATTERN_ID,
    occurrenceId: FIRST_CONTINUATION_ROOM_THRESHOLD_OCCURRENCE_ID,
    seed: resolvedSeed,
    startTick120,
    roomId: "FORCED_ALIGNMENT",
    difficulty: "NORMAL",
    initialPlayerPosition: validated.playerPosition,
    grazeRadiusPx: internals.adapterPolicy.grazeRadiusPx,
    projectileDamage: internals.adapterPolicy.projectileDamage,
    projectilePoolClasses: internals.adapterPolicy.projectilePoolClasses,
  }, runState, DEFERRED_ROOM_THRESHOLD_INSTALL);
  const view: PreparedCanonicalRunRoomThresholdStartView = Object.freeze({
    authority: "canonical-run-room-threshold-start-v1" as const,
    tick120: startTick120,
    occurrenceId: FIRST_CONTINUATION_ROOM_THRESHOLD_OCCURRENCE_ID,
    patternId: FIRST_CONTINUATION_ROOM_THRESHOLD_PATTERN_ID,
    rawRunSeed,
    transitionEncounterOrdinal: 0 as const,
    transitionDifficultySalt: 0 as const,
    resolvedSeed,
    targetRoom,
    playerLease: playerView.lease,
    eventIds: Object.freeze([
      "player.collision.off",
      "room.transition.begin",
    ] as const),
    playerPreview: playerView.preview,
    roomTransitionPreview: roomTransitionView.preview,
    playerPosition: validated.playerPosition,
    focused: validated.focused,
  });
  const proposal = Object.freeze(Object.create(null)) as PreparedCanonicalRunRoomThresholdStart;
  PREPARED_RUN_ROOM_THRESHOLD_STARTS.set(proposal, {
    runState,
    transitionReceipt,
    formalTarget,
    playerProposal,
    playerView,
    roomTransition,
    roomTransitionProposal,
    roomTransitionView,
    roomTransitionBefore,
    kernel,
    beforeTick120: internals.currentTick120,
    beforePlayerPosition: internals.currentPlayerPosition,
    beforeFocused: internals.focused,
    validated,
    view,
    status: "prepared",
  });
  ACTIVE_RUN_ROOM_THRESHOLD_START_BY_TRANSITION_RECEIPT.set(
    transitionReceipt,
    proposal,
  );
  return proposal;
}

/** Read and fully revalidate the exact deferred start before batch append. */
export function inspectPreparedCanonicalRunRoomThresholdStart(
  proposal: PreparedCanonicalRunRoomThresholdStart,
): PreparedCanonicalRunRoomThresholdStartView {
  const record = requirePreparedRoomThresholdStart(proposal);
  validatePreparedRoomThresholdStartRecord(record);
  return record.view;
}

/** Atomically append and apply the exact player-blocker plus room-request start. */
export function commitPreparedCanonicalRunRoomThresholdStart(
  proposal: PreparedCanonicalRunRoomThresholdStart,
): CanonicalRunRoomThresholdStartResult {
  let record: PreparedRunRoomThresholdStartRecord;
  try {
    record = requirePreparedRoomThresholdStart(proposal);
    validatePreparedRoomThresholdStartRecord(record);
  } catch (error) {
    const known = PREPARED_RUN_ROOM_THRESHOLD_STARTS.get(proposal);
    if (known?.status === "prepared") {
      known.status = "failed";
      ACTIVE_RUN_ROOM_THRESHOLD_START_BY_TRANSITION_RECEIPT.delete(
        known.transitionReceipt,
      );
      try {
        cancelCanonicalRunFirstContinuationRoomTransitionReceipt(
          known.transitionReceipt,
        );
      } catch {
        // The receipt may have been cancelled by the caller; the proposal is
        // still terminal and cannot alias a later reservation.
      }
    }
    throw error;
  }
  const internals = runCombatStateInternals(record.runState);
  let appendAccepted = false;
  let targetCommitted = false;
  try {
    const receipts = CanonicalEventBus.prototype.enqueuePreparedBatch.call(
      internals.bus,
      Object.freeze([
        record.playerView.drafts,
        record.roomTransitionView.drafts,
      ]),
    );
    appendAccepted = true;
    const lease = PlayerDamageAuthority.prototype.applyPreparedCollisionBlockerAfterAppend.call(
      internals.player,
      record.playerProposal,
      receipts[0] as CanonicalEventBatchReceipt,
    );
    internals.override.advanceTo(record.validated.tick120);
    internals.currentTick120 = record.validated.tick120;
    internals.previousPlayerPosition = internals.currentPlayerPosition;
    internals.currentPlayerPosition = record.validated.playerPosition;
    internals.focused = record.validated.focused;
    claimRunCombatOccurrence(
      record.runState,
      FIRST_CONTINUATION_ROOM_THRESHOLD_OCCURRENCE_ID,
      record.validated.tick120,
    );
    const activeRoomTransition = record.roomTransitionView.preview.active;
    if (activeRoomTransition === null) {
      throw new Error("Room Threshold prepared room transition lost its active record");
    }
    const successorTransferCapability = record.kernel[DEFERRED_ROOM_THRESHOLD_INSTALL](
      record.runState,
      record.formalTarget,
      record.roomTransition,
      lease,
      record.view.targetRoom,
      activeRoomTransition.completeTick120,
    );
    internals.pendingFlushTick120 = record.validated.tick120;
    const roomTransition = RoomTransitionAuthority.prototype.applyPreparedMutationAfterAppend.call(
      record.roomTransition,
      record.roomTransitionProposal,
      internals.bus,
      receipts[1] as CanonicalEventBatchReceipt,
    );
    const binding = EXT013_ROOM_THRESHOLD_RUN_BINDINGS.get(record.runState);
    if (binding?.kernel !== record.kernel || binding.phase !== "transition") {
      throw new Error("Room Threshold start lost its exact Run binding after append");
    }
    binding.expectedFlushTick120 = record.validated.tick120;
    binding.expectedPendingEventCount = internals.bus.pendingEventCount();
    const committedTarget = commitCanonicalRunFirstContinuationRoomTransitionReceipt(
      record.transitionReceipt,
    );
    targetCommitted = true;
    if (committedTarget !== record.formalTarget) {
      throw new Error("Room Threshold committed a different formal target identity");
    }
    record.status = "applied";
    ACTIVE_RUN_ROOM_THRESHOLD_START_BY_TRANSITION_RECEIPT.delete(
      record.transitionReceipt,
    );
    return Object.freeze({
      kernel: record.kernel,
      collisionLease: lease,
      runCombat: record.runState.snapshot(),
      combat: CanonicalCombatKernel.prototype.snapshot.call(record.kernel),
      roomTransition,
      successorTransferCapability,
    });
  } catch (error) {
    record.status = "failed";
    ACTIVE_RUN_ROOM_THRESHOLD_START_BY_TRANSITION_RECEIPT.delete(
      record.transitionReceipt,
    );
    if (appendAccepted) {
      if (!targetCommitted) {
        try {
          quarantineCanonicalRunFirstContinuationRoomTransitionReceipt(
            record.transitionReceipt,
          );
        } catch {
          // Run fail-stop remains authoritative even if an externally altered
          // receipt can no longer accept the quarantine marker.
        }
      }
      internals.fault = error instanceof Error ? error : new Error(String(error));
    } else {
      try {
        cancelCanonicalRunFirstContinuationRoomTransitionReceipt(
          record.transitionReceipt,
        );
      } catch {
        // Preserve the original append failure; no authoritative state changed.
      }
    }
    throw error;
  }
}

function requirePreparedRoomTransitionLeaseRelease(
  proposal: PreparedCanonicalRunRoomTransitionLeaseRelease,
  phase: "before-append" | "after-fsm-apply",
): PreparedRunRoomTransitionLeaseReleaseRecord {
  if (typeof proposal !== "object" || proposal === null) {
    throw new Error("room-transition lease release proposal must be opaque");
  }
  const record = PREPARED_RUN_ROOM_TRANSITION_LEASE_RELEASES.get(proposal);
  if (record === undefined) {
    throw new Error("room-transition lease release proposal is not registered");
  }
  if (record.status !== "prepared") {
    throw new Error(`room-transition lease release proposal is ${record.status}`);
  }
  const internals = runCombatStateInternals(record.runState);
  assertRunCombatStateOperational(internals);
  if (PENDING_RUN_ROOM_TRANSITION_LEASE_RELEASES.get(record.runState) !== proposal) {
    throw new Error("room-transition lease release lost its exclusive flush reservation");
  }
  const current = inspectPreparedPlayerCollisionBlockerMutation(record.playerProposal);
  if (
    internals.currentTick120 !== record.view.tick120
    || internals.pendingFlushTick120 !== record.view.tick120
    || internals.activeOccurrenceId !== FIRST_CONTINUATION_ROOM_THRESHOLD_OCCURRENCE_ID
    || current.owner !== internals.player
    || current.eventBus !== internals.bus
    || current.kind !== "release"
    || current.lease !== record.playerView.lease
    || current.drafts !== record.playerView.drafts
  ) {
    throw new Error("room-transition lease release proposal became stale");
  }
  if (phase === "before-append") {
    const currentRoomView = RoomTransitionAuthority.prototype.validatePreparedMutation.call(
      record.roomTransition,
      record.roomTransitionProposal,
      internals.bus,
    );
    if (
      currentRoomView !== record.roomTransitionView
      || currentRoomView.drafts !== record.roomTransitionView.drafts
      || currentRoomView.preview !== record.roomTransitionView.preview
    ) {
      throw new Error("room-transition complete proposal drifted before append");
    }
  } else {
    const room = RoomTransitionAuthority.prototype.snapshot.call(record.roomTransition);
    const expected = record.roomTransitionView.preview;
    if (
      room.tick120 !== expected.tick120
      || room.state !== expected.state
      || room.currentRoom !== expected.currentRoom
      || room.targetRoom !== expected.targetRoom
      || room.generation !== expected.generation
      || room.eventCount !== expected.eventCount
      || room.active !== expected.active
    ) {
      throw new Error("room-transition complete state was not applied before player release");
    }
  }
  return record;
}

/** Stage the exact player blocker release after combat has advanced to the FSM complete tick. */
export function prepareCanonicalRunRoomTransitionLeaseRelease(
  roomTransition: RoomTransitionAuthority,
  roomTransitionProposal: PreparedRoomTransitionMutation,
  kernel: CanonicalCombatKernel,
  runState: CanonicalRunCombatState,
  lease: CollisionBlockerLease,
  tick120Value: number,
): PreparedCanonicalRunRoomTransitionLeaseRelease {
  if (!isExactCanonicalRunCombatState(runState)) {
    throw new Error("room-transition lease release requires an exact CanonicalRunCombatState");
  }
  if (
    !isExactExt013RoomThresholdKernel(kernel)
    || kernel[ROOM_THRESHOLD_RUN_STATE_PROOF]() !== runState
  ) {
    throw new Error("room-transition lease release requires the exact live Room Threshold kernel");
  }
  const tick120 = requireSafeTick(tick120Value, "room-transition lease release tick120");
  const internals = runCombatStateInternals(runState);
  assertRunCombatStateOperational(internals);
  const binding = EXT013_ROOM_THRESHOLD_RUN_BINDINGS.get(runState);
  if (
    binding?.kernel !== kernel
    || binding.roomTransition !== roomTransition
    || binding.lease !== lease
    || binding.phase !== "transition"
    || binding.completeTick120 !== tick120
  ) {
    throw new Error("room-transition lease release lost its exact EXT-013 start binding");
  }
  if (!isExactRoomTransitionAuthority(roomTransition)) {
    throw new Error("room-transition lease release requires the exact FSM authority");
  }
  const roomTransitionView = RoomTransitionAuthority.prototype.validatePreparedMutation.call(
    roomTransition,
    roomTransitionProposal,
    internals.bus,
  );
  const roomBefore = RoomTransitionAuthority.prototype.snapshot.call(roomTransition);
  const kernelSnapshot = CanonicalCombatKernel.prototype.snapshot.call(kernel);
  if (
    roomTransitionView.kind !== "advance"
    || roomTransitionView.eventBus !== internals.bus
    || roomTransitionView.tick120 !== tick120
    || roomTransitionView.drafts.length !== 1
    || roomTransitionView.drafts[0]?.id !== "room.transition.complete"
    || roomTransitionView.drafts[0]?.tick120 !== tick120
    || roomTransitionView.preview.tick120 !== tick120
    || roomTransitionView.preview.state !== "idle"
    || roomTransitionView.preview.targetRoom !== null
    || roomTransitionView.preview.active !== null
    || roomTransitionView.preview.currentRoom === "FORCED_ALIGNMENT"
    || roomBefore.state !== "stabilizing"
    || roomBefore.active === null
    || roomBefore.generation !== 1
    || roomBefore.active.generation !== 1
    || roomBefore.active.fromRoom !== "FORCED_ALIGNMENT"
    || roomBefore.active.requestTick120 !== kernelSnapshot.startTick120
    || roomBefore.active.completeTick120 !== tick120
    || roomBefore.active.toRoom !== roomTransitionView.preview.currentRoom
  ) {
    throw new Error("room-transition lease release requires the exact prepared FSM complete boundary");
  }
  if (
    internals.currentTick120 !== tick120
    || internals.pendingFlushTick120 !== tick120
    || internals.activeOccurrenceId !== FIRST_CONTINUATION_ROOM_THRESHOLD_OCCURRENCE_ID
  ) {
    throw new Error("room-transition lease release requires the active transition's pending tick");
  }
  if (kernelSnapshot.tick120 !== tick120) {
    throw new Error("room-transition lease release tick disagrees with the live Room Threshold kernel");
  }
  const activeLease = internals.player.snapshot().activeLeases.find(
    (candidate) => candidate.token === lease.token,
  );
  if (
    activeLease !== lease
    || lease.owner !== "room-transition"
    || lease.reason !== "atomic-world-swap"
  ) {
    throw new Error("room-transition lease release requires its exact active start lease");
  }
  const playerProposal = PlayerDamageAuthority.prototype.prepareCollisionBlockerRelease.call(
    internals.player,
    lease.token,
    tick120,
  );
  const playerView = inspectPreparedPlayerCollisionBlockerMutation(playerProposal);
  if (
    playerView.kind !== "release"
    || playerView.eventBus !== internals.bus
    || playerView.lease !== lease
  ) {
    throw new Error("room-transition prepared lease release drifted");
  }
  const view: PreparedCanonicalRunRoomTransitionLeaseReleaseView = Object.freeze({
    authority: "canonical-run-room-transition-lease-release-v1" as const,
    tick120,
    lease,
    eventIds: Object.freeze([
      "room.transition.complete",
      "player.collision.on",
    ] as const),
    playerPreview: playerView.preview,
    roomTransitionPreview: roomTransitionView.preview,
  });
  const proposal = Object.freeze(Object.create(null)) as unknown as PreparedCanonicalRunRoomTransitionLeaseRelease;
  if (PENDING_RUN_ROOM_TRANSITION_LEASE_RELEASES.has(runState)) {
    throw new Error("room-transition lease release already has an in-flight proposal");
  }
  PREPARED_RUN_ROOM_TRANSITION_LEASE_RELEASES.set(proposal, {
    runState,
    roomTransition,
    roomTransitionProposal,
    roomTransitionView,
    playerProposal,
    playerView,
    view,
    status: "prepared",
  });
  PENDING_RUN_ROOM_TRANSITION_LEASE_RELEASES.set(runState, proposal);
  return proposal;
}

export function inspectPreparedCanonicalRunRoomTransitionLeaseRelease(
  proposal: PreparedCanonicalRunRoomTransitionLeaseRelease,
): PreparedCanonicalRunRoomTransitionLeaseReleaseView {
  return requirePreparedRoomTransitionLeaseRelease(proposal, "before-append").view;
}

/** Atomically append and apply the exact room-complete plus player-release batch. */
export function commitPreparedCanonicalRunRoomTransitionLeaseRelease(
  proposal: PreparedCanonicalRunRoomTransitionLeaseRelease,
): PlayerDamageSnapshot {
  let record: PreparedRunRoomTransitionLeaseReleaseRecord;
  try {
    record = requirePreparedRoomTransitionLeaseRelease(proposal, "before-append");
  } catch (error) {
    const known = PREPARED_RUN_ROOM_TRANSITION_LEASE_RELEASES.get(proposal);
    if (
      known?.status === "prepared"
      && PENDING_RUN_ROOM_TRANSITION_LEASE_RELEASES.get(known.runState) === proposal
    ) {
      known.status = "failed";
      const knownInternals = runCombatStateInternals(known.runState);
      knownInternals.fault = error instanceof Error ? error : new Error(String(error));
    }
    throw error;
  }
  const internals = runCombatStateInternals(record.runState);
  let appendAccepted = false;
  try {
    const receipts = CanonicalEventBus.prototype.enqueuePreparedBatch.call(
      internals.bus,
      Object.freeze([
        record.roomTransitionView.drafts,
        record.playerView.drafts,
      ]),
    );
    appendAccepted = true;
    RoomTransitionAuthority.prototype.applyPreparedMutationAfterAppend.call(
      record.roomTransition,
      record.roomTransitionProposal,
      internals.bus,
      receipts[0] as CanonicalEventBatchReceipt,
    );
    requirePreparedRoomTransitionLeaseRelease(proposal, "after-fsm-apply");
    PlayerDamageAuthority.prototype.applyPreparedCollisionBlockerAfterAppend.call(
      internals.player,
      record.playerProposal,
      receipts[1] as CanonicalEventBatchReceipt,
    );
    record.status = "applied";
    PENDING_RUN_ROOM_TRANSITION_LEASE_RELEASES.delete(record.runState);
    return internals.player.snapshot();
  } catch (error) {
    if (appendAccepted) {
      record.status = "failed";
      if (internals.fault === null) {
        internals.fault = error instanceof Error ? error : new Error(String(error));
      }
    }
    throw error;
  }
}

export interface CanonicalRunRoomThresholdTransitionTickResult {
  readonly runCombat: CanonicalRunCombatStateSnapshot;
  readonly combat: CanonicalCombatSnapshot;
  readonly roomTransition: RoomTransitionAuthoritySnapshot;
  readonly collisionLeaseReleased: boolean;
  readonly materialDetach: PreparedCanonicalRoomThresholdMaterialDetach | null;
}

/**
 * Advance the bound EXT-013 combat and room FSM as one sealed tick. The caller
 * retains only Run flush ownership; no room draft or append receipt escapes.
 */
export function advanceCanonicalRunRoomThresholdTransitionTick(
  kernel: CanonicalCombatKernel,
  input: CanonicalCombatStepInput,
): CanonicalRunRoomThresholdTransitionTickResult {
  if (!isExactExt013RoomThresholdKernel(kernel)) {
    throw new Error("sealed Room Threshold tick requires the exact EXT-013 kernel");
  }
  const runState = kernel[ROOM_THRESHOLD_RUN_STATE_PROOF]();
  const binding = EXT013_ROOM_THRESHOLD_RUN_BINDINGS.get(runState);
  if (
    binding?.kernel !== kernel
    || binding.phase !== "transition"
    || !isExactRoomTransitionAuthority(binding.roomTransition)
    || binding.expectedFlushTick120 !== null
    || binding.expectedPendingEventCount !== null
  ) {
    throw new Error("sealed Room Threshold tick lost its exact Run/FSM binding");
  }
  const internals = runCombatStateInternals(runState);
  assertRunCombatStateOperational(internals);
  if (internals.pendingFlushTick120 !== null || internals.bus.pendingEventCount() !== 0) {
    const error = new Error(
      "sealed Room Threshold tick requires the prior tick and shared event queue to be fully closed",
    );
    internals.fault = error;
    throw error;
  }
  const combat = kernel[SEALED_ROOM_THRESHOLD_ADVANCE](input);
  try {
    const roomProposal = RoomTransitionAuthority.prototype.prepareAdvance.call(
      binding.roomTransition,
      combat.tick120,
    );
    const roomView = RoomTransitionAuthority.prototype.validatePreparedMutation.call(
      binding.roomTransition,
      roomProposal,
      internals.bus,
    );
    const completesTransition = roomView.drafts.length === 1
      && roomView.drafts[0]?.id === "room.transition.complete";
    if (completesTransition) {
      const release = prepareCanonicalRunRoomTransitionLeaseRelease(
        binding.roomTransition,
        roomProposal,
        kernel,
        runState,
        binding.lease,
        combat.tick120,
      );
      commitPreparedCanonicalRunRoomTransitionLeaseRelease(release);
    } else {
      const receipts = CanonicalEventBus.prototype.enqueuePreparedBatch.call(
        internals.bus,
        Object.freeze([roomView.drafts]),
      );
      RoomTransitionAuthority.prototype.applyPreparedMutationAfterAppend.call(
        binding.roomTransition,
        roomProposal,
        internals.bus,
        receipts[0] as CanonicalEventBatchReceipt,
      );
    }
    const roomTransition = RoomTransitionAuthority.prototype.snapshot.call(
      binding.roomTransition,
    );
    const collisionLeaseReleased = !internals.player.snapshot().activeLeases.includes(
      binding.lease,
    );
    const materialDetach = combat.relativeTick120 === crossedTickCount(7_800)
      ? prepareCanonicalRoomThresholdMaterialDetach(kernel)
      : null;
    binding.expectedFlushTick120 = combat.tick120;
    binding.expectedPendingEventCount = internals.bus.pendingEventCount();
    return Object.freeze({
      runCombat: runState.snapshot(),
      combat: CanonicalCombatKernel.prototype.snapshot.call(kernel),
      roomTransition,
      collisionLeaseReleased,
      materialDetach,
    });
  } catch (error) {
    internals.fault = error instanceof Error ? error : new Error(String(error));
    throw error;
  }
}

export interface BossLaserEntryCommitResult {
  readonly boss: BossAuthoritySnapshot;
  readonly laser: LaserLifecycleSnapshot;
}

/**
 * Narrow prepared composite for an authored Boss phase boundary that binds one
 * laser. It appends one event batch and applies two prevalidated after-states;
 * it is neither a generic transaction nor a flush owner.
 */
export function commitBossPhaseExitWithLaserStart(
  eventBus: CanonicalEventBus,
  boss: BossPhaseAuthority,
  laser: LaserAuthority,
  expectedPhaseId: string,
  tick120: number,
  cause: string,
): BossLaserEntryCommitResult {
  if (!isExactCanonicalEventBus(eventBus)) {
    throw new Error("Boss/laser entry requires an exact CanonicalEventBus instance");
  }
  if (!isExactBossPhaseAuthority(boss)) {
    throw new Error("Boss/laser entry requires an exact BossPhaseAuthority instance");
  }
  if (!isExactLaserAuthority(laser)) {
    throw new Error("Boss/laser entry requires an exact LaserAuthority instance");
  }
  const bossProposal = BossPhaseAuthority.prototype.preparePhaseExit.call(
    boss,
    expectedPhaseId,
    tick120,
    cause,
  );
  const bossView = BossPhaseAuthority.prototype.readPreparedPhaseExit.call(
    boss,
    bossProposal,
    eventBus,
  );
  const laserProposal = LaserAuthority.prototype.prepareStart.call(laser, tick120);
  const laserView = LaserAuthority.prototype.validatePreparedMutation.call(laser, laserProposal);
  if (laserView.eventBus !== eventBus) {
    throw new Error("Boss and laser proposals must share one event bus");
  }
  if (bossView.tick120 !== laserView.tick120) {
    throw new Error("Boss and laser proposals must share one exact tick");
  }
  if (bossView.laserGeometry !== laser.definition.id) {
    throw new Error(
      `Boss phase ${bossView.toPhaseId} does not bind laser ${laser.definition.id}`,
    );
  }
  const receipts = CanonicalEventBus.prototype.enqueuePreparedBatch.call(
    eventBus,
    Object.freeze([bossView.drafts, laserView.drafts]),
  );
  BossPhaseAuthority.prototype.applyPreparedPhaseExit.call(
    boss,
    bossProposal,
    eventBus,
    receipts[0] as CanonicalEventBatchReceipt,
  );
  LaserAuthority.prototype.applyPreparedMutationAfterAppend.call(
    laser,
    laserProposal,
    receipts[1] as CanonicalEventBatchReceipt,
  );
  return Object.freeze({
    boss: BossPhaseAuthority.prototype.snapshot.call(boss),
    laser: LaserAuthority.prototype.snapshot.call(laser),
  });
}

/**
 * Run-owned combat facts shared by a strictly sequential set of occurrence
 * engines. This checkpoint intentionally admits only one spawning occurrence;
 * it is not a parallel-pattern coordinator or a rollback transaction.
 */
export class CanonicalRunCombatState {
  constructor(
    optionsValue: CanonicalRunCombatStateOptions,
    eventBus: CanonicalEventBus = new CanonicalEventBus(),
  ) {
    if (!isExactCanonicalEventBus(eventBus)) {
      throw new Error("canonical run combat state requires an exact CanonicalEventBus instance");
    }
    const options = captureRunCombatStateOptions(optionsValue);
    const startTick120 = requireSafeTick(options.startTick120, "run combat startTick120");
    const initialPlayerPosition = options.initialPlayerPosition;
    if (
      initialPlayerPosition.x < 0
      || initialPlayerPosition.x > LOGICAL_VIEW_WIDTH
      || initialPlayerPosition.y < 0
      || initialPlayerPosition.y > LOGICAL_VIEW_HEIGHT
    ) {
      throw new Error("run combat initialPlayerPosition must remain inside the logical viewport");
    }
    requirePositiveFinite(options.grazeRadiusPx, "run combat grazeRadiusPx");
    if (options.grazeRadiusPx <= PLAYER_NORMAL_COLLISION_RADIUS_PX) {
      throw new Error("run combat grazeRadiusPx must exceed the canonical normal collision radius");
    }
    requirePositiveInteger(options.projectileDamage, "run combat projectileDamage");

    const player = new PlayerDamageAuthority(eventBus, {playerId: "player"});
    const evidence = new EvidenceAuthority(eventBus);
    const graze = new GrazeEvidenceAuthority(eventBus, evidence);
    const override = new DirectionalOverrideAuthority(eventBus, evidence, {
      authorityId: "player-override",
    });
    player.advanceTo(startTick120);
    override.advanceTo(startTick120);
    const tickFlushAuthority = CanonicalEventBus.prototype.claimExclusiveTickFlush.call(
      eventBus,
      "canonical-run-combat-state",
      startTick120,
    );
    const adapterPolicy = Object.freeze({
      grazeRadiusPx: options.grazeRadiusPx,
      projectileDamage: options.projectileDamage,
      projectilePoolClasses: options.projectilePoolClasses,
      occurrenceIdentity: "utf8-length-prefixed" as const,
      concurrency: "single-spawning-occurrence" as const,
      flushOwner: "run-combat-state" as const,
      provenance: "application-required-v4-omission" as const,
    });
    RUN_COMBAT_STATE_INTERNALS.set(this, {
      bus: eventBus,
      tickFlushAuthority,
      player,
      evidence,
      graze,
      override,
      adapterPolicy,
      claimedOccurrenceIds: new Set<string>(),
      currentTick120: startTick120,
      currentPlayerPosition: initialPlayerPosition,
      previousPlayerPosition: null,
      focused: false,
      activeOccurrenceId: null,
      pendingReleaseOccurrenceId: null,
      pendingFlushTick120: null,
      advanceLocked: false,
      fault: null,
    });
    Object.freeze(this);
  }

  snapshot(): CanonicalRunCombatStateSnapshot {
    const internals = runCombatStateInternals(this);
    return Object.freeze({
      authority: "canonical-run-combat-v4" as const,
      tick120: internals.currentTick120,
      playerPosition: Object.freeze({...internals.currentPlayerPosition}),
      focused: internals.focused,
      player: internals.player.snapshot(),
      evidence: internals.evidence.snapshot(),
      override: internals.override.snapshot(),
      activeOccurrenceId: internals.activeOccurrenceId,
      pendingFlushTick120: internals.pendingFlushTick120,
      claimedOccurrenceIds: Object.freeze(
        [...internals.claimedOccurrenceIds].sort(compareText),
      ),
      faulted: internals.fault !== null,
      adapterPolicy: internals.adapterPolicy,
    });
  }

  /** Advance shared timers and player input during a collision-free authored gap. */
  advanceIdleTick(
    input: CanonicalCombatStepInput,
    roomIdValue: string,
  ): CanonicalRunCombatStateSnapshot {
    const internals = runCombatStateInternals(this);
    if (internals.advanceLocked) {
      throw new Error("canonical run combat idle advance is already in progress");
    }
    internals.advanceLocked = true;
    try {
      return this.advanceIdleTickUnlocked(input, roomIdValue, internals);
    } finally {
      internals.advanceLocked = false;
    }
  }

  private advanceIdleTickUnlocked(
    input: CanonicalCombatStepInput,
    roomIdValue: string,
    internals: RunCombatStateInternals,
  ): CanonicalRunCombatStateSnapshot {
    assertRunCombatStateOperational(internals);
    if (EXT013_ROOM_THRESHOLD_RUN_BINDINGS.has(this)) {
      throw new Error(
        "run combat idle advance is reserved by the active EXT-013 continuation transition, material, or dormant successor owner",
      );
    }
    if (internals.activeOccurrenceId !== null) {
      throw new Error(`run combat idle advance cannot overlap occurrence: ${internals.activeOccurrenceId}`);
    }
    if (internals.pendingFlushTick120 !== null) {
      throw new Error(`run combat tick ${internals.pendingFlushTick120} must flush before advancing`);
    }
    const roomId = requireUnicodeScalarString(roomIdValue, "run combat idle roomId");
    if (!V4_PLAYER_AUTHORITY_CONTRACT.canonicalRoomIds.includes(roomId)) {
      throw new Error(`run combat idle room is not authored: ${roomId}`);
    }
    const validated = validateCombatStepAgainstRunState(input, internals);
    internals.currentTick120 = validated.tick120;
    internals.previousPlayerPosition = internals.currentPlayerPosition;
    internals.currentPlayerPosition = validated.playerPosition;
    internals.focused = validated.focused;
    try {
      if (validated.overridePressed) {
        if (validated.overrideDirection === null) {
          throw new Error("validated Override direction was lost");
        }
        internals.override.press({
          origin: validated.playerPosition,
          direction: validated.overrideDirection,
          roomId,
        }, validated.tick120);
      }
      if (validated.overrideReleased) internals.override.release(validated.tick120);
      internals.override.advanceTo(validated.tick120);
      internals.player.advanceTo(validated.tick120);
      internals.pendingFlushTick120 = validated.tick120;
    } catch (error) {
      internals.fault = error instanceof Error ? error : new Error(String(error));
      throw error;
    }
    return this.snapshot();
  }

  flushTick(tick120Value: number): readonly CanonicalGameplayEvent[] {
    const internals = runCombatStateInternals(this);
    assertRunCombatStateOperational(internals);
    const tick120 = requireSafeTick(tick120Value, "run combat flush tick120");
    if (tick120 !== internals.currentTick120) {
      throw new Error(
        `run combat can flush only its current tick: ${internals.currentTick120} !== ${tick120}`,
      );
    }
    if (internals.pendingFlushTick120 !== tick120) {
      throw new Error(`run combat tick ${tick120} has no prepared flush`);
    }
    const pendingLeaseRelease = PENDING_RUN_ROOM_TRANSITION_LEASE_RELEASES.get(this);
    if (pendingLeaseRelease !== undefined) {
      try {
        requirePreparedRoomTransitionLeaseRelease(pendingLeaseRelease, "before-append");
      } catch (error) {
        const record = PREPARED_RUN_ROOM_TRANSITION_LEASE_RELEASES.get(pendingLeaseRelease);
        if (record?.status === "prepared") record.status = "failed";
        internals.fault = error instanceof Error ? error : new Error(String(error));
        throw error;
      }
      throw new Error(
        "room-transition complete composite must commit before the run tick can flush",
      );
    }
    const binding = EXT013_ROOM_THRESHOLD_RUN_BINDINGS.get(this);
    if (
      binding !== undefined
      && (
        binding.expectedFlushTick120 !== tick120
        || binding.expectedPendingEventCount === null
        || internals.bus.pendingEventCount() !== binding.expectedPendingEventCount
      )
    ) {
      const error = new Error(
        "EXT-013 sealed tick event batch changed before the Run-owned flush",
      );
      internals.fault = error;
      throw error;
    }
    if (binding?.phase === "transition") {
      const combat = CanonicalCombatKernel.prototype.snapshot.call(binding.kernel);
      const room = RoomTransitionAuthority.prototype.snapshot.call(binding.roomTransition);
      const player = internals.player.snapshot();
      const leaseActive = player.activeLeases.includes(binding.lease);
      const synchronized = combat.tick120 === tick120
        && room.tick120 === tick120
        && room.generation === 1
        && (
          tick120 < binding.completeTick120
            ? room.targetRoom === binding.targetRoom && leaseActive
            : room.state === "idle"
              && room.currentRoom === binding.targetRoom
              && room.targetRoom === null
              && room.active === null
              && !leaseActive
        );
      if (!synchronized) {
        const error = new Error(
          "EXT-013 combat, room transition, and collision lease lost tick-atomic synchronization",
        );
        internals.fault = error;
        throw error;
      }
      if (
        combat.relativeTick120 === crossedTickCount(7_800)
        && !binding.kernel[ROOM_THRESHOLD_FAIL_STOP_PROOF]().materialDetachPending
      ) {
        throw new Error(
          "Room Threshold material detach must request release before the completion tick can flush",
        );
      }
    } else if (binding?.phase === "detach-release-requested") {
      const proof = binding.kernel[ROOM_THRESHOLD_FAIL_STOP_PROOF]();
      if (
        proof.tick120 !== tick120
        || !proof.materialDetachPending
        || internals.pendingReleaseOccurrenceId !== FIRST_CONTINUATION_ROOM_THRESHOLD_OCCURRENCE_ID
      ) {
        const error = new Error("Room Threshold detach release reservation drifted before flush");
        internals.fault = error;
        throw error;
      }
    } else if (
      binding?.phase === "material"
      || binding?.phase === "target-room-idle"
      || binding?.phase === "successor-dormant"
      || binding?.phase === "successor-pre-read"
    ) {
      const room = RoomTransitionAuthority.prototype.snapshot.call(binding.roomTransition);
      const material = binding.carryover?.snapshot() ?? null;
      if (
        binding.materialRoomEventCount === null
        || room.tick120 !== tick120
        || room.state !== "idle"
        || room.currentRoom !== binding.targetRoom
        || room.targetRoom !== null
        || room.generation !== 1
        || room.eventCount !== binding.materialRoomEventCount
        || room.active !== null
        || material === null
        || material.tick120 !== tick120
        || (binding.phase === "successor-dormant" || binding.phase === "successor-pre-read"
          ? binding.successorOwner === null
            || binding.successorReservation === null
            || binding.successorPlan === null
            || binding.successorKernel !== null
            || binding.successorFinalCombat !== null
          : binding.successorOwner !== null
            || binding.successorReservation !== null
            || binding.successorPlan !== null
            || binding.successorKernel !== null
            || binding.successorFinalCombat !== null)
      ) {
        const error = new Error(
          "continuation material, target-room FSM, and Run tick lost sealed synchronization",
        );
        internals.fault = error;
        throw error;
      }
    } else if (
      binding?.phase === "successor-read"
      || binding?.phase === "successor-release-requested"
    ) {
      const releaseRequested = binding.phase === "successor-release-requested";
      const room = RoomTransitionAuthority.prototype.snapshot.call(binding.roomTransition);
      const material = binding.carryover?.snapshot() ?? null;
      const combat = binding.successorKernel?.snapshot() ?? null;
      const reservation = binding.successorReservation;
      if (
        binding.successorOwner === null
        || binding.successorPlan === null
        || reservation === null
        || binding.successorKernel === null
        || binding.successorFinalCombat !== null
        || binding.materialRoomEventCount === null
        || internals.activeOccurrenceId !== reservation.occurrenceId
        || (releaseRequested
          ? internals.pendingReleaseOccurrenceId !== reservation.occurrenceId
            || combat?.patternComplete !== true
            || combat.digitalBodiesDrained !== true
            || combat.poolUsage.liveColliders !== 0
            || combat.projectiles.some((projectile) =>
              projectile.state !== "residue" || projectile.collisionEnabled)
          : internals.pendingReleaseOccurrenceId !== null)
        || room.tick120 !== tick120
        || room.state !== "idle"
        || room.currentRoom !== binding.targetRoom
        || room.targetRoom !== null
        || room.generation !== 1
        || room.eventCount !== binding.materialRoomEventCount
        || room.active !== null
        || material === null
        || material.tick120 !== tick120
        || material.poolUsage.liveColliders !== 0
        || combat === null
        || combat.tick120 !== tick120
        || combat.patternId !== reservation.patternId
        || combat.occurrenceId !== reservation.occurrenceId
        || combat.player.tick120 !== tick120
        || !successorPoolUsageFitsReservation(material, combat, reservation)
      ) {
        const error = new Error(
          "continuation READ/release combat, material, target-room FSM, and Run tick lost sealed synchronization",
        );
        internals.fault = error;
        throw error;
      }
    } else if (
      binding?.phase === "successor-tail"
      || binding?.phase === "successor-complete"
    ) {
      const room = RoomTransitionAuthority.prototype.snapshot.call(binding.roomTransition);
      const material = binding.carryover?.snapshot() ?? null;
      const combat = binding.successorFinalCombat;
      const reservation = binding.successorReservation;
      if (
        binding.successorOwner === null
        || binding.successorPlan === null
        || reservation === null
        || binding.successorKernel === null
        || combat === null
        || !combat.patternComplete
        || !combat.digitalBodiesDrained
        || combat.poolUsage.liveColliders !== 0
        || combat.projectiles.some((projectile) =>
          projectile.state !== "residue" || projectile.collisionEnabled)
        || combat.tick120 !== tick120
        || combat.patternId !== reservation.patternId
        || combat.occurrenceId !== reservation.occurrenceId
        || internals.activeOccurrenceId !== null
        || internals.pendingReleaseOccurrenceId !== null
        || binding.materialRoomEventCount === null
        || room.tick120 !== tick120
        || room.state !== "idle"
        || room.currentRoom !== binding.targetRoom
        || room.targetRoom !== null
        || room.generation !== 1
        || room.eventCount !== binding.materialRoomEventCount
        || room.active !== null
        || material === null
        || material.tick120 !== tick120
        || material.poolUsage.liveColliders !== 0
        || (binding.phase === "successor-complete" && !material.drained)
        || !successorPoolUsageFitsReservation(material, combat, reservation)
        || internals.player.snapshot().tick120 !== tick120
      ) {
        const error = new Error(
          "continuation successor tail lost its collisionless material/room synchronization",
        );
        internals.fault = error;
        throw error;
      }
    }
    try {
      const flushed = internals.tickFlushAuthority.flushTick(tick120);
      internals.pendingFlushTick120 = null;
      if (internals.pendingReleaseOccurrenceId !== null) {
        if (internals.activeOccurrenceId !== internals.pendingReleaseOccurrenceId) {
          throw new Error("run combat pending occurrence release lost its active owner");
        }
        internals.activeOccurrenceId = null;
        internals.pendingReleaseOccurrenceId = null;
      }
      if (binding !== undefined) {
        binding.expectedFlushTick120 = null;
        binding.expectedPendingEventCount = null;
        if (binding.phase === "material" && binding.carryover?.snapshot().drained === true) {
          binding.phase = "target-room-idle";
        }
      }
      return flushed;
    } catch (error) {
      internals.fault = error instanceof Error ? error : new Error(String(error));
      throw error;
    }
  }

  stepIdle(
    input: CanonicalCombatStepInput,
    roomId: string,
  ): CanonicalRunCombatStateSnapshot {
    const snapshot = this.advanceIdleTick(input, roomId);
    this.flushTick(snapshot.tick120);
    return this.snapshot();
  }

  events(): readonly CanonicalGameplayEvent[] {
    return runCombatStateInternals(this).bus.events();
  }

  canonicalEventSerialization(): string {
    return runCombatStateInternals(this).bus.canonicalSerialization();
  }
}

/**
 * One explicit Misreader `observe -> enforce` entry laser. It is deliberately
 * not the phase-2 projectile plan, a room scheduler, a repeat loop, or a Boss
 * resolution machine.
 */
export class CanonicalMisreaderEnforceEntryFragment {
  private readonly options: Readonly<CanonicalMisreaderEnforceEntryOptions>;
  private readonly runState: CanonicalRunCombatState;
  private readonly boss: BossPhaseAuthority;
  private readonly laser: LaserAuthority;
  private readonly occurrenceId: string;
  private readonly phaseExitCause: string;
  private readonly firstContactEligibleTick120: number;
  private currentTick120: number;
  private currentPlayerPosition: Vec2;
  private focused = false;
  private entryCommitted = false;
  private contactAttemptTick120: number | null = null;
  private lastDamageBatch: DamageBatchResult | null = null;
  private occurrenceReleased = false;
  private advanceLocked = false;

  constructor(
    runState: CanonicalRunCombatState,
    boss: BossPhaseAuthority,
    optionsValue: CanonicalMisreaderEnforceEntryOptions,
  ) {
    const runInternals = runCombatStateInternals(runState);
    assertRunCombatStateOperational(runInternals);
    if (!isExactBossPhaseAuthority(boss)) {
      throw new Error("Misreader fragment requires an exact BossPhaseAuthority instance");
    }
    if (runInternals.pendingFlushTick120 !== null || runInternals.activeOccurrenceId !== null) {
      throw new Error("Misreader fragment requires an unclaimed run-combat tick boundary");
    }
    const options = captureMisreaderEnforceEntryOptions(optionsValue);
    if (
      runInternals.currentTick120 === Number.MAX_SAFE_INTEGER
      || options.phaseEntryTick120 !== runInternals.currentTick120 + 1
    ) {
      throw new Error("Misreader enforce entry must be the exact next master tick");
    }
    const canonicalMisreader = V4_ENCOUNTER_CATALOG.requireBoss("boss.misreader");
    const bossSnapshot = BossPhaseAuthority.prototype.snapshot.call(boss);
    const observe = boss.boss.phases[0];
    const enforce = boss.boss.phases[1];
    if (
      boss.boss !== canonicalMisreader
      || boss.boss.id !== "boss.misreader"
      || boss.boss.room !== "IN_BETWEEN"
      || bossSnapshot.state !== "active"
      || bossSnapshot.phaseIndex !== 0
      || bossSnapshot.phaseId !== "observe"
      || observe === undefined
      || enforce === undefined
      || observe.id !== "observe"
      || observe.patternId !== "boss.misreader.phase1"
      || observe.entryCondition !== "encounter.begin"
      || observe.exitCondition !== "misreader.evidence>=1"
      || observe.laserGeometry !== null
      || observe.spatialLaw !== "sample_then_misread"
      || enforce.id !== "enforce"
      || enforce.patternId !== "boss.misreader.phase2"
      || enforce.entryCondition !== "observe.exit"
      || enforce.exitCondition !== "misreader.evidence>=2"
      || enforce.laserGeometry !== "laser.misread_bezier"
      || enforce.spatialLaw !== "correction_is_late"
    ) {
      throw new Error("Misreader fragment requires the manifest-derived active observe -> enforce binding");
    }
    const override = runInternals.override.snapshot();
    if (override.state !== "idle" || override.deadlineTick120 !== null) {
      throw new Error("Misreader laser requires idle Override until a single scar coordinate is authored");
    }
    const laser = new LaserAuthority(
      runInternals.bus,
      enforce.laserGeometry,
      `${occurrenceAuthorityId(options.occurrenceId, enforce.laserGeometry)}:laser:0`,
    );
    const geometry = compileLaserGeometry(laser.definition, {tick120: 0});
    if (
      geometry.capsules.length !== 16
      || geometry.sectors.length !== 0
      || geometry.capsules.some((capsule) => capsule.radius !== 5.5)
    ) {
      throw new Error("Misreader adaptive Bezier projection drifted from its recorded adapter contract");
    }
    const activeOffset = millisecondsToAuthorityTicks(
      laser.definition.lifecycle.timingMs.telegraph
      + laser.definition.lifecycle.timingMs.charge
      + laser.definition.lifecycle.timingMs.grow,
    );
    const firstContactEligibleTick120 = options.phaseEntryTick120 + activeOffset + 1;
    requireSafeTick(firstContactEligibleTick120, "Misreader first contact tick120");

    // Prove the already-active Boss and the new laser share the leased bus and
    // exact manifest binding before claiming run occurrence ownership.
    const bossProposal = BossPhaseAuthority.prototype.preparePhaseExit.call(
      boss,
      observe.id,
      options.phaseEntryTick120,
      observe.exitCondition,
    );
    const bossProposalView = BossPhaseAuthority.prototype.readPreparedPhaseExit.call(
      boss,
      bossProposal,
      runInternals.bus,
    );
    const laserProposal = LaserAuthority.prototype.prepareStart.call(
      laser,
      options.phaseEntryTick120,
    );
    const laserProposalView = LaserAuthority.prototype.validatePreparedMutation.call(
      laser,
      laserProposal,
    );
    if (
      bossProposalView.laserGeometry !== laser.definition.id
      || laserProposalView.eventBus !== runInternals.bus
    ) {
      throw new Error("Misreader Boss/laser entry proposals do not share their canonical binding");
    }

    claimRunCombatOccurrence(runState, options.occurrenceId, runInternals.currentTick120);
    this.options = options;
    this.runState = runState;
    this.boss = boss;
    this.laser = laser;
    this.occurrenceId = options.occurrenceId;
    this.phaseExitCause = observe.exitCondition;
    this.firstContactEligibleTick120 = firstContactEligibleTick120;
    this.currentTick120 = runInternals.currentTick120;
    this.currentPlayerPosition = runInternals.currentPlayerPosition;
  }

  step(input: CanonicalCombatStepInput): CanonicalMisreaderEnforceEntrySnapshot {
    const snapshot = this.advanceTick(input);
    this.runState.flushTick(snapshot.tick120);
    return this.snapshot();
  }

  /** Prepare one exact tick; only the shared run state may close it. */
  advanceTick(input: CanonicalCombatStepInput): CanonicalMisreaderEnforceEntrySnapshot {
    if (this.advanceLocked) throw new Error("Misreader laser tick advance is already in progress");
    this.advanceLocked = true;
    try {
      return this.advanceTickUnlocked(input);
    } finally {
      this.advanceLocked = false;
    }
  }

  private advanceTickUnlocked(
    input: CanonicalCombatStepInput,
  ): CanonicalMisreaderEnforceEntrySnapshot {
    const runInternals = runCombatStateInternals(this.runState);
    assertRunCombatStateOperational(runInternals);
    if (this.occurrenceReleased || runInternals.activeOccurrenceId !== this.occurrenceId) {
      throw new Error(`Misreader laser occurrence is not active: ${this.occurrenceId}`);
    }
    if (runInternals.pendingFlushTick120 !== null) {
      throw new Error(`run combat tick ${runInternals.pendingFlushTick120} must flush before advancing`);
    }
    if (
      runInternals.currentTick120 !== this.currentTick120
      || runInternals.currentPlayerPosition.x !== this.currentPlayerPosition.x
      || runInternals.currentPlayerPosition.y !== this.currentPlayerPosition.y
    ) {
      throw new Error("Misreader laser lost synchronization with run combat state");
    }
    const validated = validateCombatStepAgainstRunState(input, runInternals);
    if (validated.overridePressed || validated.overrideReleased) {
      throw new Error("Misreader laser withholds Override without an authored single scar coordinate");
    }
    const overrideBefore = runInternals.override.snapshot();
    if (overrideBefore.state !== "idle" || overrideBefore.deadlineTick120 !== null) {
      throw new Error("Misreader laser cannot advance while Override owns a timed state");
    }

    const previousPlayerPosition = this.currentPlayerPosition;
    try {
      const laserBefore = LaserAuthority.prototype.snapshot.call(this.laser);
      if (!this.entryCommitted) {
        if (validated.tick120 !== this.options.phaseEntryTick120) {
          throw new Error("Misreader laser entry was not committed on its explicit tick");
        }
        commitBossPhaseExitWithLaserStart(
          runInternals.bus,
          this.boss,
          this.laser,
          "observe",
          validated.tick120,
          this.phaseExitCause,
        );
        this.entryCommitted = true;
      } else {
        LaserAuthority.prototype.advance.call(this.laser, validated.tick120);
      }
      runInternals.override.advanceTo(validated.tick120);
      const laserAfter = LaserAuthority.prototype.snapshot.call(this.laser);
      let attemptedContact = false;
      if (
        this.contactAttemptTick120 === null
        && laserBefore.collisionEnabled
        && laserAfter.collisionEnabled
        && validated.tick120 >= this.firstContactEligibleTick120
      ) {
        const playerRadius = validated.focused
          ? PLAYER_FOCUS_COLLISION_RADIUS_PX
          : PLAYER_NORMAL_COLLISION_RADIUS_PX;
        if (LaserAuthority.prototype.collides.call(
          this.laser,
          validated.tick120 - 1,
          validated.tick120,
          {
            from: previousPlayerPosition,
            to: validated.playerPosition,
            radius: playerRadius,
          },
        )) {
          attemptedContact = true;
          const generation = laserAfter.generation;
          const sourceId = `${laserAfter.instanceId}:${generation}`;
          const damageProposal = PlayerDamageAuthority.prototype.prepareDamageBatch.call(
            runInternals.player,
            validated.tick120,
            Object.freeze([Object.freeze({
              occurrenceKey: `contact:${sourceId}:tick:${validated.tick120}`,
              sourceId,
              amount: runInternals.adapterPolicy.projectileDamage,
            })]),
          );
          const damageView = PlayerDamageAuthority.prototype.validatePreparedDamageCommit.call(
            runInternals.player,
            damageProposal,
          );
          if (
            damageView.eventBus !== runInternals.bus
            || damageView.tick120 !== validated.tick120
          ) {
            throw new Error("Misreader contact damage proposal lost its run tick or event bus");
          }
          const receipts = CanonicalEventBus.prototype.enqueuePreparedBatch.call(
            runInternals.bus,
            Object.freeze([damageView.drafts]),
          );
          this.lastDamageBatch = PlayerDamageAuthority.prototype
            .applyPreparedDamageAfterAppend.call(
              runInternals.player,
              damageProposal,
              receipts[0] as CanonicalEventBatchReceipt,
            );
          this.contactAttemptTick120 = validated.tick120;
        }
      }
      if (!attemptedContact) runInternals.player.advanceTo(validated.tick120);
      if (laserAfter.state === "cleanup" && !this.occurrenceReleased) {
        requestRunCombatOccurrenceRelease(this.runState, this.occurrenceId);
        this.occurrenceReleased = true;
      }
      this.currentTick120 = validated.tick120;
      this.currentPlayerPosition = validated.playerPosition;
      this.focused = validated.focused;
      runInternals.currentTick120 = validated.tick120;
      runInternals.previousPlayerPosition = previousPlayerPosition;
      runInternals.currentPlayerPosition = validated.playerPosition;
      runInternals.focused = validated.focused;
      runInternals.pendingFlushTick120 = validated.tick120;
      return this.snapshot();
    } catch (error) {
      runInternals.fault = error instanceof Error ? error : new Error(String(error));
      throw error;
    }
  }

  snapshot(): CanonicalMisreaderEnforceEntrySnapshot {
    const runInternals = runCombatStateInternals(this.runState);
    const laser = LaserAuthority.prototype.snapshot.call(this.laser);
    const player = runInternals.player.snapshot();
    const override = runInternals.override.snapshot();
    const playerTimedStateQuiescent = player.recoveryAtTick120 === null
      && player.respawnPlaceAtTick120 === null
      && player.respawnCompleteAtTick120 === null;
    const runTimedStateQuiescent = playerTimedStateQuiescent
      && override.state === "idle"
      && override.deadlineTick120 === null;
    const geometry = laser.state === "idle"
      ? null
      : LaserAuthority.prototype.activeGeometry.call(this.laser, this.currentTick120);
    return Object.freeze({
      authority: "misreader-enforce-entry-laser-v4-adapter" as const,
      occurrenceId: this.occurrenceId,
      phaseEntryTick120: this.options.phaseEntryTick120,
      tick120: this.currentTick120,
      relativeTick120: this.currentTick120 - this.options.phaseEntryTick120,
      playerPosition: Object.freeze({...this.currentPlayerPosition}),
      focused: this.focused,
      player,
      evidence: runInternals.evidence.snapshot(),
      override,
      boss: BossPhaseAuthority.prototype.snapshot.call(this.boss),
      laser,
      geometry,
      firstContactEligibleTick120: this.firstContactEligibleTick120,
      contactAttemptTick120: this.contactAttemptTick120,
      lastDamageBatch: this.lastDamageBatch,
      collisionBodyDrained: laser.state === "shutdown"
        || laser.state === "residue"
        || laser.state === "cleanup",
      materialResidueDraining: laser.state === "residue",
      laserLifecycleDrained: laser.state === "cleanup",
      runTimedStateQuiescent,
      fullAttackPlanExecuted: false as const,
      adapterPolicy: Object.freeze({
        laserStartsPerEntry: 1 as const,
        repeatCadence: null,
        contactEntryBoundary: "first-post-collision-on-interval" as const,
        contactAttemptsPerGeneration: 1 as const,
        contactTerminalEffect: "player-damage-only-laser-remains-live" as const,
        overrideLaserCancellation: "withheld-no-authored-single-scar-coordinate" as const,
        capsuleCount: 16 as const,
        capsuleCountAuthority: "deterministic-adaptive-flattening-adapter" as const,
        difficultyProjection: "laser-trace-invariant" as const,
        phaseEvidenceEvaluator: null,
        phaseExitAuthorization: this.options.phaseExitAuthorization,
        provenance: "application-required-v4-omission" as const,
      }),
    });
  }

  events(): readonly CanonicalGameplayEvent[] {
    return this.runState.events();
  }

  canonicalEventSerialization(): string {
    return this.runState.canonicalEventSerialization();
  }
}

/**
 * Production composition for the explicitly validated V4 signatures above.
 * Every other manifest structure fails closed until its distinct semantics
 * are implemented.
 */
export class CanonicalCombatKernel {
  readonly adapterGaps: CanonicalCombatSnapshot["adapterGaps"];

  private readonly options: Readonly<CanonicalCombatKernelOptions>;
  private readonly pattern: CombatPattern;
  private readonly occurrenceId: string;
  private readonly occurrenceScope: string | null;
  private readonly runState: CanonicalRunCombatState;
  private readonly sharedRunState: boolean;

  private readonly bus: CanonicalEventBus;
  private readonly projectiles: ProjectileAuthorityPool;
  private readonly player: PlayerDamageAuthority;
  private readonly evidence: EvidenceAuthority;
  private readonly graze: GrazeEvidenceAuthority;
  private readonly override: DirectionalOverrideAuthority;
  private readonly random: Mulberry32;
  private readonly schedule: ReturnType<typeof createPatternSchedule>;
  private readonly residueTicks: number;
  private readonly patternCompleteTick120: number;
  private readonly runtimeProjectiles = new Map<string, RuntimeProjectile>();
  private readonly playerPositionByTick120 = new Map<number, Vec2>();
  private scheduleCursor = 0;
  private rngCallsConsumedValue = 0;
  private currentTick120: number;
  private currentPlayerPosition: Vec2;
  private previousPlayerPosition: Vec2 | null = null;
  private focused = false;
  private patternCompleteValue = false;
  private lastDamageBatchValue: DamageBatchResult | null = null;
  private sharedOccurrenceReleased = false;
  private deferredRoomThresholdInstallPending = false;
  private deferredFirstContinuationReadInstallPending = false;
  private materialDetachPending = false;
  private materialDetached = false;
  private advanceLocked = false;

  constructor(
    options: CanonicalCombatKernelOptions,
    eventBusOrRunState: CanonicalEventBus | CanonicalRunCombatState = new CanonicalEventBus(),
    installMode?: symbol,
    internalProjectilePoolBudgets?: ProjectilePoolBudgets,
  ) {
    const deferredRoomThresholdInstall = installMode === DEFERRED_ROOM_THRESHOLD_INSTALL;
    const deferredFirstContinuationReadInstall =
      installMode === DEFERRED_FIRST_CONTINUATION_READ_INSTALL;
    const deferredSharedInstall = deferredRoomThresholdInstall
      || deferredFirstContinuationReadInstall;
    if (installMode !== undefined && !deferredSharedInstall) {
      throw new Error("canonical combat received an unknown internal install mode");
    }
    if (
      (deferredFirstContinuationReadInstall && internalProjectilePoolBudgets === undefined)
      || (!deferredFirstContinuationReadInstall && internalProjectilePoolBudgets !== undefined)
    ) {
      throw new Error("continuation READ pool budgets require the sealed deferred install");
    }
    const suppliedRunState = isExactCanonicalRunCombatState(eventBusOrRunState)
      ? eventBusOrRunState
      : null;
    if (suppliedRunState === null && !isExactCanonicalEventBus(eventBusOrRunState)) {
      throw new Error("canonical combat requires a CanonicalEventBus or CanonicalRunCombatState");
    }
    this.sharedRunState = suppliedRunState !== null;
    const captured = captureCombatOptions(options);
    const patternId = captured.patternId ?? DEFAULT_PATTERN_ID;
    this.pattern = deepFreezeJson(executablePattern(patternId) as CombatPattern);
    validatePattern(this.pattern);
    if (
      deferredRoomThresholdInstall
      && (
        suppliedRunState === null
        || this.pattern.id !== FIRST_CONTINUATION_ROOM_THRESHOLD_PATTERN_ID
        || captured.occurrenceId !== FIRST_CONTINUATION_ROOM_THRESHOLD_OCCURRENCE_ID
      )
    ) {
      throw new Error("deferred install is reserved for the exact EXT-013 Room Threshold occurrence");
    }
    if (
      deferredFirstContinuationReadInstall
      && (suppliedRunState === null || this.pattern.category !== "ROOM")
    ) {
      throw new Error("deferred continuation READ install requires an exact ROOM occurrence");
    }
    if (suppliedRunState !== null && this.pattern.id === "transition.override_void") {
      throw new Error(
        "transition.override_void shared-run handoff is not admitted by this isolated capability",
      );
    }
    if (
      !Number.isSafeInteger(captured.seed)
      || captured.seed < 0
      || captured.seed > 0xffff_ffff
      || Object.is(captured.seed, -0)
    ) {
      throw new Error("canonical combat seed must be a uint32 without negative zero");
    }
    this.currentTick120 = requireSafeTick(captured.startTick120, "combat startTick120");
    if (!V4_PLAYER_AUTHORITY_CONTRACT.canonicalRoomIds.includes(captured.roomId)) {
      throw new Error(`canonical combat room is not authored: ${captured.roomId}`);
    }
    if (
      this.pattern.category !== "COMMON"
      && this.pattern.category !== "WEATHER_ECHO"
      && this.pattern.category !== "TRANSITION"
      && captured.roomId !== this.pattern.room
    ) {
      throw new Error(
        `canonical combat room mismatch for ${this.pattern.id}: ${captured.roomId} !== ${this.pattern.room}`,
      );
    }
    if (!(["EASY", "NORMAL", "HARD"] as const).includes(captured.difficulty)) {
      throw new Error(`unsupported combat difficulty: ${String(captured.difficulty)}`);
    }
    requirePositiveFinite(captured.grazeRadiusPx, "combat grazeRadiusPx");
    if (captured.grazeRadiusPx <= PLAYER_NORMAL_COLLISION_RADIUS_PX) {
      throw new Error("combat grazeRadiusPx must exceed the canonical normal collision radius");
    }
    requirePositiveInteger(captured.projectileDamage, "combat projectileDamage");
    const sharedSnapshot = suppliedRunState?.snapshot() ?? null;
    if (sharedSnapshot?.faulted === true) {
      throw new Error("canonical combat cannot claim a faulted run combat state");
    }
    if (
      sharedSnapshot !== null
      && (
        deferredSharedInstall
          ? sharedSnapshot.tick120 === Number.MAX_SAFE_INTEGER
            || this.currentTick120 !== sharedSnapshot.tick120 + 1
          : sharedSnapshot.tick120 !== this.currentTick120
      )
    ) {
      throw new Error(
        deferredSharedInstall
          ? `deferred combat must start on the next run tick: ${sharedSnapshot.tick120} -> ${this.currentTick120}`
          : `canonical combat start tick does not match run combat state: ${this.currentTick120} !== ${sharedSnapshot.tick120}`,
      );
    }
    const suppliedInitialPlayerPosition = captured.initialPlayerPosition === undefined
      ? null
      : freezeVec2(captured.initialPlayerPosition, "combat initialPlayerPosition");
    if (deferredSharedInstall && suppliedInitialPlayerPosition === null) {
      throw new Error("deferred combat requires its prepared next-tick player position");
    }
    if (
      sharedSnapshot !== null
      && !deferredSharedInstall
      && suppliedInitialPlayerPosition !== null
      && (
        suppliedInitialPlayerPosition.x !== sharedSnapshot.playerPosition.x
        || suppliedInitialPlayerPosition.y !== sharedSnapshot.playerPosition.y
      )
    ) {
      throw new Error("canonical combat initialPlayerPosition disagrees with run combat state");
    }
    const initialPlayerPosition = deferredSharedInstall
      ? suppliedInitialPlayerPosition as Vec2
      : sharedSnapshot?.playerPosition
        ?? suppliedInitialPlayerPosition
        ?? Object.freeze({x: LOGICAL_VIEW_WIDTH / 2, y: AUTHORED_PLAYER_Y});
    if (
      initialPlayerPosition.x < 0
      || initialPlayerPosition.x > LOGICAL_VIEW_WIDTH
      || initialPlayerPosition.y < 0
      || initialPlayerPosition.y > LOGICAL_VIEW_HEIGHT
    ) {
      throw new Error("combat initialPlayerPosition must remain inside the logical viewport");
    }
    if (sharedSnapshot !== null) {
      if (
        captured.grazeRadiusPx !== sharedSnapshot.adapterPolicy.grazeRadiusPx
        || captured.projectileDamage !== sharedSnapshot.adapterPolicy.projectileDamage
      ) {
        throw new Error("canonical combat adapter policy disagrees with run combat state");
      }
      for (const [archetypeId, poolClass] of Object.entries(captured.projectilePoolClasses)) {
        if (sharedSnapshot.adapterPolicy.projectilePoolClasses[archetypeId] !== poolClass) {
          throw new Error(
            `canonical combat pool mapping disagrees with run combat state: ${archetypeId}`,
          );
        }
      }
    }
    let occurrenceId: string;
    if (captured.occurrenceId === undefined) {
      if (suppliedRunState !== null) {
        throw new Error("shared run combat requires an explicit occurrenceId");
      }
      occurrenceId = patternId;
    } else {
      occurrenceId = requireUnicodeScalarString(
        captured.occurrenceId,
        "canonical combat occurrenceId",
      );
    }
    this.occurrenceId = occurrenceId;
    this.currentPlayerPosition = initialPlayerPosition;
    this.playerPositionByTick120.set(this.currentTick120, initialPlayerPosition);
    const projectilePoolClasses = captured.projectilePoolClasses;
    if (
      this.pattern.id === "room.information.notification_overflow"
      && projectilePoolClasses["bullet.micro.dash"] !== "micro"
    ) {
      throw new Error(
        "room.information.notification_overflow requires bullet.micro.dash in the micro pool class",
      );
    }
    if (
      this.pattern.id === "encounter.weather_echo.wind_bias"
      && projectilePoolClasses["bullet.micro.seed"] !== "micro"
    ) {
      throw new Error(
        "encounter.weather_echo.wind_bias requires bullet.micro.seed in the micro pool class",
      );
    }
    if (
      this.pattern.id === "encounter.weather_echo.rain_packets"
      && projectilePoolClasses["bullet.micro.dash"] !== "micro"
    ) {
      throw new Error(
        "encounter.weather_echo.rain_packets requires bullet.micro.dash in the micro pool class",
      );
    }
    if (
      this.pattern.id === "encounter.weather_echo.ash_memory"
      && projectilePoolClasses["bullet.micro.shard"] !== "micro"
    ) {
      throw new Error(
        "encounter.weather_echo.ash_memory requires bullet.micro.shard in the micro pool class",
      );
    }
    this.options = Object.freeze({
      ...captured,
      patternId,
      occurrenceId,
      initialPlayerPosition,
      projectilePoolClasses,
    });
    this.adapterGaps = Object.freeze({
      grazeRadiusPx: captured.grazeRadiusPx,
      projectileDamage: captured.projectileDamage,
      projectilePoolClasses,
      targetHistorySampling: "exact-crossed-tick120" as const,
      positiveAimLeadPolicy: "last-authoritative-segment-linear-extrapolation" as const,
      lateralWallLaneProjection: "candidate-center-into-left-to-right-lane-bins" as const,
      ...(this.pattern.id === "encounter.weather_echo.rain_packets"
        ? {rainLaneOmission: Object.freeze({
            order: "geometry-source-index>rng-jitter>swept-preflight>entity-spawn" as const,
            preflight: "shared-fixed-tick-local-vector-corridor-sweep" as const,
            spawnIdentity: "assigned-only-after-preflight-pass" as const,
            residue: "omitted-candidates-have-no-entity-or-residue" as const,
          })}
        : {}),
      ...(this.pattern.id === "encounter.weather_echo.ash_memory"
        ? {ashMemoryHistoryReplay: Object.freeze({
            candidateIdentity:
              "all-authored-candidates-retain-rng-and-entity-identity" as const,
            spawnOrdinal:
              "occurrence-local-emitter-burst-source-order-starting-at-one" as const,
            armPolicy:
              "anchor-spawn-then-first-flight-tick-sweeps-to-reversed-path-head" as const,
            replayClock:
              "authored-spawn-age-with-delay-held-at-reversed-path-head" as const,
            pathSweep: "absolute-polyline-split-at-authored-vertices" as const,
            crossSideEntry:
              "safe-prefix-plus-disconnected-snapped-endpoint-no-interior-contact" as const,
            redirectPolicy:
              "absolute-replay-before-repeatable-operator-constraint" as const,
            releasePolicy:
              "first-fixed-tick-after-replay-end-continues-at-owned-heading-and-speed" as const,
            weatherAuthority:
              "withheld-no-weather-event-seed-rng-motion-collision-or-gap-input" as const,
            admission:
              "isolated-kernel-no-director-session-renderer-or-default-run" as const,
          })}
        : {}),
      ...(this.pattern.id === "room.polarized.alternating_verdict"
        ? {alternatingVerdictAngularOmission: Object.freeze({
            order: (
              "geometry-source-index>one-rng-jitter>full-declaration-order-swept-preflight>entity-spawn"
            ) as const,
            crossedTurnTick: "old-heading-sweep>zero-time-turn>new-heading-next-tick" as const,
            spawnIdentity: "assigned-only-after-preflight-pass" as const,
            residue: "omitted-candidates-have-no-events-or-residue" as const,
            runtimeViolation: "fail-stop-never-source-withdrawn" as const,
          })}
        : {}),
      ...(this.pattern.id === "room.in_between.misregistration_corridor"
        ? {misregistrationOrbitRelease: Object.freeze({
            order: (
              "geometry-source-index>one-rng-jitter>full-orbit-release-swept-preflight>entity-spawn"
            ) as const,
            phasePolicy: "ext-018-one-candidate-draw-times-tau" as const,
            referenceDivergence:
              "qa-golden-ordinal-phase-remains-reference-only" as const,
            releasePolicy:
              "exact-release-boundary>authored-absolute-heading>linear-remainder" as const,
            armPolicy: "anchor-spawn>first-live-tick-radial-to-orbit-sweep" as const,
            spawnIdentity: "assigned-only-after-preflight-pass" as const,
            residue: "omitted-candidates-have-no-events-or-residue" as const,
            runtimeViolation: "fail-stop-never-source-withdrawn" as const,
          })}
        : {}),
      ...(this.pattern.id === "room.forced.crack_fall_loop"
        ? {seamTopology: Object.freeze({
            crossing: "inclusive-arrival-or-departure-first-crossing-per-generation" as const,
            transformSweep: "linear-sweep-then-mirror-discontinuity-sweep" as const,
            corridorEntry: "analytic-relative-sine-extrema-then-bisection" as const,
            redirectedContact: "safe-prefix-then-curvature-bounded-boundary-chord" as const,
            oraclePolicy: "python-endpoint-edge-snap-plus-signed-eight-degrees" as const,
          })}
        : {}),
      ...(this.pattern.id === "transition.override_void"
        ? {offsetSeamTopology: Object.freeze({
            crossing: "inclusive-arrival-or-departure-first-crossing-per-generation" as const,
            transformSweep: "linear-sweep-then-signed-offset-discontinuity-sweep" as const,
            headingPolicy: "preserved-across-offset" as const,
            contactAndOverridePaths: "both-linear-and-discontinuity-segments" as const,
            resolutionHook: "validated-inert-no-automatic-completion" as const,
            realScarEvidence: "separate-directional-override-authority" as const,
            sameTickTerminalPriority:
              "rule-clip-before-override-no-double-terminal-no-linked-scar" as const,
          })}
        : {}),
      ...(this.pattern.id === "room.in_between.context_switch"
        ? {contextConstraint: Object.freeze({
            candidateIdentity: "all-authored-candidates-retain-rng-and-entity-identity" as const,
            declarationOrder: "motion-stack-literal-before-operator-constraint" as const,
            corridorEntry: "analytic-relative-sine-extrema-then-bisection" as const,
            redirectedContact: "safe-prefix-then-curvature-bounded-boundary-chord" as const,
            oraclePolicy: "python-endpoint-edge-snap-plus-signed-eight-degrees" as const,
            completeTickTie: "spawn-then-pattern-end-residue-under-canonical-phase-order" as const,
          })}
        : {}),
      ...(this.pattern.id === "boss.one_sun_one_rule.phase1"
        ? {oneSunOneRuleConstraint: Object.freeze({
            candidateIdentity: "all-authored-candidates-retain-rng-and-entity-identity" as const,
            declarationOrder:
              "turn-on-crossed-tick>linear-sweep>operator-constraint" as const,
            observeBinding: "exact-observe-phase-with-null-laser" as const,
            laserAuthority: "inactive-through-phase1" as const,
            phaseExitAndResolution: "withheld-no-evaluator-no-terminal-events" as const,
            oraclePolicy: "python-endpoint-edge-snap-plus-signed-eight-degrees" as const,
          })}
        : {}),
      ...(this.pattern.id === "room.forced.ballot_shift"
        ? {ballotPhaseGate: Object.freeze({
            candidateIdentity: "all-authored-candidates-retain-rng-and-entity-identity" as const,
            clockIdentity: "pattern-relative-integer-tick120" as const,
            effectiveGate: "dual-clock-xor-plus-continuous-lane-collision-mask" as const,
            clockInactiveBehavior: "same-generation-speed-zero-and-collision-off" as const,
            clockOpenBoundary:
              "collision-on-at-crossed-tick;motion-and-contact-next-tick" as const,
            phaseGapBehavior: "same-generation-motion-retained-collision-off" as const,
            collisionLease: "reversible-entity-owned-canonical-events" as const,
            overridePolicy: "masked-digital-body-remains-cancellable" as const,
            completeTickTie: "pattern-end-cancels-before-same-tick-arm" as const,
          })}
        : {}),
      ...(this.pattern.id === "room.polarized.clock_decree"
        ? {clockDecreePhaseGate: Object.freeze({
            candidateIdentity: "all-authored-candidates-retain-rng-and-entity-identity" as const,
            clockIdentity: "pattern-relative-integer-tick120" as const,
            effectiveGate:
              "dual-clock-xor-plus-continuous-quantized-triangle-collision-mask" as const,
            quantizedPathSweep: "exact-cusp-segmented-linear" as const,
            clockInactiveBehavior: "same-generation-speed-zero-and-collision-off" as const,
            clockOpenBoundary:
              "collision-on-at-crossed-tick;motion-and-contact-next-tick" as const,
            phaseGapBehavior: "same-generation-motion-retained-collision-off" as const,
            collisionLease: "reversible-entity-owned-canonical-events" as const,
            easyLateBurst:
              "cadence-owned-after-emit-end-then-pattern-end-cancelled" as const,
            completeTickTie:
              "pattern-end-cancels-live-identities-before-gate-update" as const,
          })}
        : {}),
      ...(this.pattern.id === "room.polarized.no_dusk_grid"
        ? {noDuskGridPhaseGate: Object.freeze({
            candidateIdentity: "all-authored-candidates-retain-rng-and-entity-identity" as const,
            clockIdentity: "pattern-relative-integer-tick120" as const,
            effectiveGate:
              "emitter-owned-dual-clock-xor-plus-continuous-binary-cross-collision-mask" as const,
            binaryCrossSweep: "exact-cusp-segmented-linear" as const,
            clockInactiveBehavior: "same-generation-speed-zero-and-collision-off" as const,
            clockOpenBoundary:
              "collision-on-at-crossed-tick;motion-and-contact-next-tick" as const,
            phaseGapBehavior: "same-generation-motion-retained-collision-off" as const,
            collisionLease: "reversible-entity-owned-canonical-events" as const,
            easyLateBurst: "cadence-owned-after-emit-end-and-residue-marker" as const,
            resolutionHook: "validated-inert-no-automatic-completion" as const,
            completeTickTie:
              "pattern-end-cancels-live-identities-before-gate-update" as const,
          })}
        : {}),
      ...(this.pattern.id === "room.in_between.stable_intersection"
        ? {stableIntersectionPhaseGate: Object.freeze({
            candidateIdentity:
              "all-authored-candidates-retain-rng-and-entity-identity" as const,
            clockIdentity: "pattern-relative-integer-tick120" as const,
            effectiveGate:
              "dual-clock-xor-plus-both-open-intersection-plus-continuous-sine-collision-mask" as const,
            intersectionRule:
              "python-oracle-a-or-b-from-xor-plus-both-open" as const,
            corridorSweep:
              "analytic-relative-sine-extrema-then-bisection" as const,
            clockInactiveBehavior: "same-generation-speed-zero-and-collision-off" as const,
            clockOpenBoundary:
              "collision-on-at-crossed-tick;motion-and-contact-next-tick" as const,
            phaseGapBehavior: "same-generation-motion-retained-collision-off" as const,
            collisionLease: "reversible-entity-owned-canonical-events" as const,
            resolutionHook: "validated-inert-no-metric-or-room-completion" as const,
            roomAuthority:
              "withheld-no-composer-session-handoff-renderer-or-default-run" as const,
            completeTickTie:
              "pattern-end-cancels-live-identities-before-gate-update" as const,
          })}
        : {}),
      ...(this.pattern.id === "transition.room_threshold"
        ? {roomThresholdPhaseGate: Object.freeze({
            candidateIdentity:
              "all-authored-candidates-retain-rng-and-entity-identity" as const,
            declarationOrder:
              "speed-envelope>linear>continuous-threshold-bridge-collision-mask" as const,
            thresholdBridgeSweep:
              "analytic-relative-sine-extrema-then-bisection" as const,
            phaseGapBehavior: "same-generation-motion-retained-collision-off" as const,
            collisionLease: "reversible-entity-owned-canonical-events" as const,
            transitionAuthority: deferredRoomThresholdInstall
              ? "ext-013-prepared-atomic-fsm-and-material-carryover" as const
              : "withheld-no-room-transition-composer-session-renderer-or-room-completion" as const,
            completeTickTie:
              "pattern-end-cancels-live-identities-before-mask-update" as const,
          })}
        : {}),
      provenance: "application-required-v4-omission" as const,
    });
    this.random = new Mulberry32(captured.seed);
    this.schedule = createPatternSchedule(this.pattern, captured.difficulty);
    this.residueTicks = crossedTickCount(residueLifetimeMs(this.pattern));
    this.patternCompleteTick120 = requireSafeTick(
      captured.startTick120 + crossedTickCount(this.pattern.durationMs),
      "combat pattern completion tick120",
    );
    this.runState = suppliedRunState ?? new CanonicalRunCombatState({
      startTick120: captured.startTick120,
      initialPlayerPosition,
      grazeRadiusPx: captured.grazeRadiusPx,
      projectileDamage: captured.projectileDamage,
      projectilePoolClasses,
    }, eventBusOrRunState as CanonicalEventBus);
    const runInternals = runCombatStateInternals(this.runState);
    this.bus = runInternals.bus;
    this.occurrenceScope = suppliedRunState === null && captured.occurrenceId === undefined
      ? null
      : occurrenceAuthorityId(occurrenceId, this.pattern.id);
    this.projectiles = new ProjectileAuthorityPool(this.bus, {
      authorityId: this.occurrenceScope ?? `combat:${this.pattern.id}`,
      archetypes: archetypesFor(this.pattern, projectilePoolClasses),
      ...(internalProjectilePoolBudgets === undefined
        ? {}
        : {poolBudgets: internalProjectilePoolBudgets}),
    });
    this.player = runInternals.player;
    this.evidence = runInternals.evidence;
    this.graze = runInternals.graze;
    this.override = runInternals.override;
    this.deferredRoomThresholdInstallPending = deferredRoomThresholdInstall;
    this.deferredFirstContinuationReadInstallPending = deferredFirstContinuationReadInstall;
    this.projectiles.advanceTo(this.currentTick120);
    if (!deferredSharedInstall) {
      this.player.advanceTo(this.currentTick120);
      this.override.advanceTo(this.currentTick120);
    }
    if (suppliedRunState !== null && !deferredSharedInstall) {
      claimRunCombatOccurrence(suppliedRunState, occurrenceId, this.currentTick120);
    }
  }

  [DEFERRED_ROOM_THRESHOLD_INSTALL](
    runState: CanonicalRunCombatState,
    formalTarget: CanonicalRunFirstContinuationRoomTargetAvailable,
    roomTransition: RoomTransitionAuthority,
    lease: CollisionBlockerLease,
    targetRoom: CanonicalRunRoomThresholdTargetRoom,
    completeTick120: number,
  ): CanonicalRunFirstContinuationDormantSuccessorTransferCapability {
    if (
      !this.deferredRoomThresholdInstallPending
      || this.runState !== runState
      || this.pattern.id !== FIRST_CONTINUATION_ROOM_THRESHOLD_PATTERN_ID
      || this.occurrenceId !== FIRST_CONTINUATION_ROOM_THRESHOLD_OCCURRENCE_ID
      || formalTarget.targetRoom !== targetRoom
      || !isExactRoomTransitionAuthority(roomTransition)
      || !FIRST_CONTINUATION_ROOM_THRESHOLD_TARGETS.includes(targetRoom)
      || EXT013_ROOM_THRESHOLD_RUN_BINDINGS.has(runState)
    ) {
      throw new Error("Room Threshold deferred install is unknown or already applied");
    }
    const internals = runCombatStateInternals(runState);
    const player = internals.player.snapshot();
    if (
      internals.currentTick120 !== this.currentTick120
      || internals.currentPlayerPosition.x !== this.currentPlayerPosition.x
      || internals.currentPlayerPosition.y !== this.currentPlayerPosition.y
      || internals.activeOccurrenceId !== this.occurrenceId
      || player.tick120 !== this.currentTick120
      || player.state !== "alive"
      || player.collisionEnabled !== false
      || player.activeLeases.length !== 1
      || player.activeLeases[0] !== lease
      || lease.owner !== "room-transition"
      || lease.reason !== "atomic-world-swap"
      || completeTick120 <= this.currentTick120
    ) {
      throw new Error("Room Threshold deferred install lost its prepared shared state");
    }
    this.focused = internals.focused;
    const successorTransferCapability = Object.freeze({}) as
      CanonicalRunFirstContinuationDormantSuccessorTransferCapability;
    DORMANT_SUCCESSOR_TRANSFER_CAPABILITIES.set(successorTransferCapability, {
      runState,
      kernel: this,
      formalTarget,
      status: "transition",
      handoffReceipt: null,
      handoffTick120: null,
      carryover: null,
      activeProposal: null,
    });
    EXT013_ROOM_THRESHOLD_KERNELS.add(this);
    EXT013_ROOM_THRESHOLD_RUN_BINDINGS.set(runState, {
      kernel: this,
      formalTarget,
      roomTransition,
      lease,
      targetRoom,
      completeTick120,
      successorTransferCapability,
      phase: "transition",
      carryover: null,
      materialRoomEventCount: null,
      successorOwner: null,
      successorReservation: null,
      successorPlan: null,
      successorKernel: null,
      successorFinalCombat: null,
      expectedFlushTick120: null,
      expectedPendingEventCount: null,
    });
    this.deferredRoomThresholdInstallPending = false;
    return successorTransferCapability;
  }

  [DEFERRED_FIRST_CONTINUATION_READ_INSTALL](
    runState: CanonicalRunCombatState,
    successorOwner: object,
    plan: CanonicalRunFirstContinuationRoomPlanPayload,
    reservation: CanonicalRunFirstContinuationDormantSuccessorReservation,
  ): void {
    const binding = EXT013_ROOM_THRESHOLD_RUN_BINDINGS.get(runState);
    const internals = runCombatStateInternals(runState);
    const material = binding?.carryover?.snapshot() ?? null;
    const room = binding === undefined
      ? null
      : RoomTransitionAuthority.prototype.snapshot.call(binding.roomTransition);
    const player = internals.player.snapshot();
    const override = internals.override.snapshot();
    const projectileUsage = this.projectiles.usage();
    if (
      !this.deferredFirstContinuationReadInstallPending
      || this.runState !== runState
      || binding?.phase !== "successor-pre-read"
      || binding.successorOwner !== successorOwner
      || binding.successorPlan !== plan
      || binding.successorReservation !== reservation
      || binding.successorKernel !== null
      || binding.successorFinalCombat !== null
      || binding.carryover === null
      || this.pattern.id !== plan.occurrence.patternId
      || this.occurrenceId !== plan.occurrence.occurrenceId
      || this.options.seed !== plan.occurrence.resolvedSeed.value
      || this.options.startTick120 !== internals.currentTick120
      || this.options.roomId !== plan.targetRoom
      || this.options.difficulty !== plan.occurrence.difficulty
      || reservation.admittedAtTick120 !== plan.plannedAtTick120
      || reservation.targetRoom !== plan.targetRoom
      || reservation.occurrenceId !== this.occurrenceId
      || reservation.patternId !== this.pattern.id
      || internals.currentPlayerPosition.x !== this.currentPlayerPosition.x
      || internals.currentPlayerPosition.y !== this.currentPlayerPosition.y
      || internals.pendingFlushTick120 !== null
      || internals.bus.pendingEventCount() !== 0
      || internals.activeOccurrenceId !== null
      || internals.pendingReleaseOccurrenceId !== null
      || internals.claimedOccurrenceIds.has(this.occurrenceId)
      || material === null
      || material.tick120 !== internals.currentTick120
      || material.poolUsage.liveColliders !== 0
      || room === null
      || room.tick120 !== internals.currentTick120
      || room.state !== "idle"
      || room.currentRoom !== plan.targetRoom
      || room.targetRoom !== null
      || room.active !== null
      || player.tick120 !== internals.currentTick120
      || player.state !== "alive"
      || player.collisionEnabled !== true
      || player.activeLeases.length !== 0
      || override.state !== "idle"
      || override.deadlineTick120 !== null
      || override.localVoid !== null
      || DORMANT_SUCCESSOR_POOL_CLASS_ORDER.some((poolClass) =>
        projectileUsage.active[poolClass] !== 0
        || projectileUsage.allocatedSlots[poolClass] !== 0)
      || projectileUsage.residueVisuals !== 0
      || projectileUsage.liveColliders !== 0
    ) {
      throw new Error("deferred continuation READ install lost its exact plan and owner lease");
    }
    this.focused = internals.focused;
    internals.claimedOccurrenceIds.add(this.occurrenceId);
    internals.activeOccurrenceId = this.occurrenceId;
    binding.successorKernel = this;
    binding.phase = "successor-read";
    this.deferredFirstContinuationReadInstallPending = false;
  }

  [ROOM_THRESHOLD_RUN_STATE_PROOF](): CanonicalRunCombatState {
    if (
      !EXT013_ROOM_THRESHOLD_KERNELS.has(this)
      || !this.sharedRunState
      || this.pattern.id !== FIRST_CONTINUATION_ROOM_THRESHOLD_PATTERN_ID
      || this.occurrenceId !== FIRST_CONTINUATION_ROOM_THRESHOLD_OCCURRENCE_ID
    ) {
      throw new Error("kernel is not the exact live EXT-013 Room Threshold proof");
    }
    return this.runState;
  }

  [ROOM_THRESHOLD_FAIL_STOP_PROOF](): Readonly<{
    runState: CanonicalRunCombatState;
    tick120: number;
    materialDetachPending: boolean;
  }> {
    this[ROOM_THRESHOLD_RUN_STATE_PROOF]();
    return Object.freeze({
      runState: this.runState,
      tick120: this.currentTick120,
      materialDetachPending: this.materialDetachPending,
    });
  }

  [ROOM_THRESHOLD_MATERIAL_DETACH](
    phase:
      | "inspect"
      | "request-release"
      | "validate-after-flush"
      | "finalize-after-carryover",
  ): Readonly<{
    runState: CanonicalRunCombatState;
    projectiles: ProjectileAuthorityPool;
    materialIdentityByKey: ReadonlyMap<string, Readonly<{
      sourceId: string;
      sourceIndex: number;
      burstIndex: number;
      headingDegrees: number;
      speedPxPerSecond: number;
    }>>;
    tick120: number;
  }> {
    if (
      !EXT013_ROOM_THRESHOLD_KERNELS.has(this)
      || !this.sharedRunState
      || this.pattern.id !== FIRST_CONTINUATION_ROOM_THRESHOLD_PATTERN_ID
      || this.occurrenceId !== FIRST_CONTINUATION_ROOM_THRESHOLD_OCCURRENCE_ID
      || this.deferredRoomThresholdInstallPending
    ) {
      throw new Error("material detach is reserved for the exact live Room Threshold occurrence");
    }
    const internals = runCombatStateInternals(this.runState);
    assertRunCombatStateOperational(internals);
    const snapshot = CanonicalCombatKernel.prototype.snapshot.call(this);
    const binding = EXT013_ROOM_THRESHOLD_RUN_BINDINGS.get(this.runState);
    const roomTransition = binding === undefined
      ? null
      : RoomTransitionAuthority.prototype.snapshot.call(binding.roomTransition);
    const player = internals.player.snapshot();
    const override = internals.override.snapshot();
    if (
      binding === undefined
      || roomTransition === null
      || binding.kernel !== this
      || binding.targetRoom !== roomTransition?.currentRoom
      || binding.completeTick120 >= this.currentTick120
      || roomTransition.tick120 !== this.currentTick120
      || roomTransition.state !== "idle"
      || roomTransition.targetRoom !== null
      || roomTransition.generation !== 1
      || roomTransition.active !== null
      || player.activeLeases.includes(binding.lease)
      // EXT-013 explicitly allows recovery/respawn timers to continue beside
      // material carryover. Only the exact room-transition lease must be gone.
      || override.state !== "idle"
      || override.deadlineTick120 !== null
      || override.localVoid !== null
      || snapshot.relativeTick120 !== crossedTickCount(7_800)
      || !snapshot.patternComplete
      || !snapshot.digitalBodiesDrained
      || !snapshot.materialResidueDraining
      || snapshot.projectileLifecycleDrained
      || snapshot.poolUsage.liveColliders !== 0
      || snapshot.poolUsage.residueVisuals <= 0
      || snapshot.projectiles.some((projectile) =>
        projectile.state !== "residue" || projectile.collisionEnabled)
    ) {
      throw new Error("Room Threshold material detach requires the exact collisionless pattern-complete boundary");
    }
    if (phase === "inspect") {
      if (
        binding.phase !== "transition"
        || this.materialDetachPending
        || this.materialDetached
        || this.sharedOccurrenceReleased
        || internals.currentTick120 !== this.currentTick120
        || internals.pendingFlushTick120 !== this.currentTick120
        || internals.pendingReleaseOccurrenceId !== null
        || internals.activeOccurrenceId !== this.occurrenceId
      ) {
        throw new Error("Room Threshold material detach boundary is stale");
      }
    } else if (phase === "request-release") {
      if (
        binding.phase !== "transition"
        || this.materialDetachPending
        || this.materialDetached
        || this.sharedOccurrenceReleased
        || internals.pendingFlushTick120 !== this.currentTick120
        || internals.pendingReleaseOccurrenceId !== null
        || internals.activeOccurrenceId !== this.occurrenceId
      ) {
        throw new Error("Room Threshold material detach release cannot be requested");
      }
      requestRunCombatOccurrenceRelease(this.runState, this.occurrenceId);
      this.materialDetachPending = true;
      binding.phase = "detach-release-requested";
    } else if (phase === "validate-after-flush") {
      if (
        binding.phase !== "detach-release-requested"
        || !this.materialDetachPending
        || this.materialDetached
        || this.sharedOccurrenceReleased
        || internals.currentTick120 !== this.currentTick120
        || internals.pendingFlushTick120 !== null
        || internals.pendingReleaseOccurrenceId !== null
        || internals.activeOccurrenceId !== null
      ) {
        throw new Error("Room Threshold material detach requires its successful release flush");
      }
    } else {
      if (
        binding.phase !== "detach-release-requested"
        || !this.materialDetachPending
        || this.materialDetached
        || this.sharedOccurrenceReleased
        || internals.currentTick120 !== this.currentTick120
        || internals.pendingFlushTick120 !== null
        || internals.pendingReleaseOccurrenceId !== null
        || internals.activeOccurrenceId !== null
      ) {
        throw new Error("Room Threshold material carryover finalization became stale");
      }
      this.materialDetachPending = false;
      this.materialDetached = true;
      this.sharedOccurrenceReleased = true;
    }
    const materialIdentityByKey = new Map<string, Readonly<{
      sourceId: string;
      sourceIndex: number;
      burstIndex: number;
      headingDegrees: number;
      speedPxPerSecond: number;
    }>>();
    for (const projectile of snapshot.projectiles) {
      materialIdentityByKey.set(keyFor(projectile), Object.freeze({
        sourceId: projectile.sourceId,
        sourceIndex: projectile.sourceIndex,
        burstIndex: projectile.burstIndex,
        headingDegrees: projectile.headingDegrees,
        speedPxPerSecond: projectile.speedPxPerSecond,
      }));
    }
    return Object.freeze({
      runState: this.runState,
      projectiles: this.projectiles,
      materialIdentityByKey,
      tick120: this.currentTick120,
    });
  }

  step(input: CanonicalCombatStepInput): CanonicalCombatSnapshot {
    const snapshot = this.advanceTick(input);
    this.runState.flushTick(snapshot.tick120);
    return this.snapshot();
  }

  /**
   * Mutate one exact master tick without closing the shared event bus. A
   * coordinator may enqueue other same-tick authority facts before the run
   * combat state performs the sole flush.
   */
  advanceTick(input: CanonicalCombatStepInput): CanonicalCombatSnapshot {
    if (EXT013_ROOM_THRESHOLD_KERNELS.has(this)) {
      throw new Error(
        "EXT-013 Room Threshold must advance through its sealed transition coordinator",
      );
    }
    return this.advanceTickWithLock(input);
  }

  [SEALED_ROOM_THRESHOLD_ADVANCE](input: CanonicalCombatStepInput): CanonicalCombatSnapshot {
    const binding = EXT013_ROOM_THRESHOLD_RUN_BINDINGS.get(this.runState);
    if (
      !isExactExt013RoomThresholdKernel(this)
      || binding?.kernel !== this
      || binding.phase !== "transition"
    ) {
      throw new Error("sealed Room Threshold advance requires its exact active Run binding");
    }
    return this.advanceTickWithLock(input);
  }

  [SEALED_FIRST_CONTINUATION_READ_ADVANCE](
    successorOwner: object,
    input: CanonicalCombatStepInput,
  ): CanonicalCombatSnapshot {
    const binding = EXT013_ROOM_THRESHOLD_RUN_BINDINGS.get(this.runState);
    if (
      !this.sharedRunState
      || this.deferredFirstContinuationReadInstallPending
      || binding?.phase !== "successor-read"
      || binding.successorOwner !== successorOwner
      || binding.successorKernel !== this
      || binding.successorPlan === null
      || binding.successorReservation === null
      || this.pattern.id !== binding.successorReservation.patternId
      || this.occurrenceId !== binding.successorReservation.occurrenceId
    ) {
      throw new Error("sealed continuation READ advance requires its exact active owner");
    }
    return this.advanceTickWithLock(input);
  }

  /** Advance only collisionless successor residue after gameplay ownership releases. */
  [SEALED_FIRST_CONTINUATION_MATERIAL_ADVANCE](
    successorOwner: object,
    tick120Value: number,
  ): CanonicalCombatSnapshot {
    const binding = EXT013_ROOM_THRESHOLD_RUN_BINDINGS.get(this.runState);
    const runInternals = runCombatStateInternals(this.runState);
    const tick120 = requireSafeTick(tick120Value, "successor material tick120");
    const before = CanonicalCombatKernel.prototype.snapshot.call(this);
    if (
      this.advanceLocked
      || !this.sharedRunState
      || !this.sharedOccurrenceReleased
      || this.deferredFirstContinuationReadInstallPending
      || (binding?.phase !== "successor-tail" && binding?.phase !== "successor-complete")
      || binding.successorOwner !== successorOwner
      || binding.successorKernel !== this
      || binding.successorFinalCombat === null
      || binding.successorPlan === null
      || binding.successorReservation === null
      || runInternals.activeOccurrenceId !== null
      || runInternals.pendingReleaseOccurrenceId !== null
      || runInternals.currentTick120 !== tick120
      || runInternals.pendingFlushTick120 !== tick120
      || before.tick120 !== tick120 - 1
      || before.patternId !== binding.successorReservation.patternId
      || before.occurrenceId !== binding.successorReservation.occurrenceId
      || !before.patternComplete
      || !before.digitalBodiesDrained
      || before.poolUsage.liveColliders !== 0
      || before.projectiles.some((projectile) =>
        projectile.state !== "residue" || projectile.collisionEnabled)
    ) {
      throw new Error("sealed successor material advance lost its collisionless owner boundary");
    }
    this.advanceLocked = true;
    try {
      this.previousPlayerPosition = this.currentPlayerPosition;
      this.currentPlayerPosition = runInternals.currentPlayerPosition;
      this.focused = runInternals.focused;
      this.currentTick120 = tick120;
      this.projectiles.advanceTo(tick120);
      this.removeCompletedRuntimeProjectiles();
      const after = CanonicalCombatKernel.prototype.snapshot.call(this);
      if (
        after.tick120 !== tick120
        || !after.patternComplete
        || !after.digitalBodiesDrained
        || after.poolUsage.liveColliders !== 0
        || after.projectiles.some((projectile) =>
          projectile.state !== "residue" || projectile.collisionEnabled)
      ) {
        throw new Error("successor material advance produced gameplay-capable state");
      }
      return after;
    } catch (error) {
      runInternals.fault = error instanceof Error ? error : new Error(String(error));
      throw error;
    } finally {
      this.advanceLocked = false;
    }
  }

  private advanceTickWithLock(input: CanonicalCombatStepInput): CanonicalCombatSnapshot {
    if (this.advanceLocked) throw new Error("canonical combat tick advance is already in progress");
    this.advanceLocked = true;
    try {
      return this.advanceTickUnlocked(input);
    } finally {
      this.advanceLocked = false;
    }
  }

  private advanceTickUnlocked(input: CanonicalCombatStepInput): CanonicalCombatSnapshot {
    const runInternals = runCombatStateInternals(this.runState);
    assertRunCombatStateOperational(runInternals);
    if (runInternals.pendingFlushTick120 !== null) {
      throw new Error(`run combat tick ${runInternals.pendingFlushTick120} must flush before advancing`);
    }
    const activeMaterialDetach = ACTIVE_ROOM_THRESHOLD_MATERIAL_DETACH_BY_KERNEL.get(this);
    const activeMaterialDetachRecord = activeMaterialDetach === undefined
      ? undefined
      : PREPARED_ROOM_THRESHOLD_MATERIAL_DETACHES.get(activeMaterialDetach);
    if (
      activeMaterialDetachRecord !== undefined
      && (
        activeMaterialDetachRecord.status === "prepared"
        || activeMaterialDetachRecord.status === "release-requested"
      )
    ) {
      const error = new Error(
        "Room Threshold material detach must complete before gameplay can advance",
      );
      activeMaterialDetachRecord.status = "failed";
      runInternals.fault = error;
      throw error;
    }
    if (this.deferredRoomThresholdInstallPending) {
      throw new Error("Room Threshold deferred install has not been applied");
    }
    if (this.materialDetachPending || this.materialDetached) {
      throw new Error("Room Threshold gameplay authority was detached from its material carryover");
    }
    if (this.sharedRunState) {
      if (this.sharedOccurrenceReleased) {
        throw new Error(`run combat occurrence is already released: ${this.occurrenceId}`);
      }
      if (runInternals.activeOccurrenceId !== this.occurrenceId) {
        throw new Error(`run combat occurrence is not active: ${this.occurrenceId}`);
      }
    }
    // Complete validation precedes every authority mutation so a rejected
    // sample cannot consume a tick or partially advance an owned FSM.
    const validated = this.validateStepInput(input);
    const {
      tick120,
      playerPosition,
      focused,
      overridePressed,
      overrideReleased,
      overrideDirection,
    } = validated;
    if (
      EXT013_ROOM_THRESHOLD_KERNELS.has(this)
      && (overridePressed || overrideReleased)
    ) {
      throw new Error(
        "EXT-013 Room Threshold cannot admit an Override edge before successor local resistance",
      );
    }

    this.currentTick120 = tick120;
    this.previousPlayerPosition = this.currentPlayerPosition;
    this.currentPlayerPosition = playerPosition;
    runInternals.currentTick120 = tick120;
    runInternals.previousPlayerPosition = runInternals.currentPlayerPosition;
    runInternals.currentPlayerPosition = playerPosition;
    runInternals.focused = focused;
    this.playerPositionByTick120.set(tick120, playerPosition);
    this.focused = focused;

    try {
      if (overridePressed) {
        if (overrideDirection === null) throw new Error("validated Override direction was lost");
        this.override.press({
          origin: playerPosition,
          direction: overrideDirection,
          roomId: this.options.roomId,
        }, tick120);
      }
      if (overrideReleased) this.override.release(tick120);
      this.override.advanceTo(tick120);

      if (!this.patternCompleteValue && tick120 >= this.patternCompleteTick120) {
        this.patternCompleteValue = true;
        this.cancelLiveProjectiles(tick120, "pattern_end");
        if (this.pattern.id === "room.in_between.context_switch") {
          // EASY's authored 11398ms A burst and 11400ms completion cross the
          // same master tick. Cadence owns every candidate with atMs<duration;
          // canonical phase ordering then makes those new, still-unarmed
          // identities terminal pattern-end residue without collision-on.
          this.spawnDueBursts(tick120);
          this.cancelLiveProjectiles(tick120, "pattern_end");
        }
      } else if (!this.patternCompleteValue) {
        // Cancel existing same-tick arm candidates atomically before spawning the
        // tick's new arm-state entities, then apply the local void once more to
        // those new entities. The second pass cannot recancel terminal handles.
        this.override.cancelProjectiles(this.projectiles, tick120);
        this.spawnDueBursts(tick120);
        this.override.cancelProjectiles(this.projectiles, tick120);
      } else {
        this.projectiles.advanceTo(tick120);
      }
      this.removeCompletedRuntimeProjectiles();
      this.advanceRuntimeProjectiles(tick120);
      // A live collider may enter the active local void during this tick's
      // movement; cancel it at swept time-of-entry before resolving player hits.
      this.cancelMovedProjectilesInOverride(tick120);
      // A closing lease is gameplay-authoritative before damage/contact for
      // this tick. An opening lease commits only after state/damage, matching
      // the repository's collision-off -> state/damage -> collision-on order.
      const collisionGateBatch = this.prepareRuntimeCollisionGateBatch(tick120);
      if (collisionGateBatch !== null) {
        this.projectiles.beginPreparedFlightCollisionBatch(collisionGateBatch.prepared);
      }
      try {
        this.resolvePlayerContacts(tick120);
      } finally {
        // Once the complete gate event set has been accepted, its prevalidated
        // collision-on after-state must not be stranded by a later independent
        // contact fault. The run still faults and cannot advance, but every
        // accepted reversible-lease fact remains state-consistent.
        if (collisionGateBatch !== null) {
          this.projectiles.finishPreparedFlightCollisionBatch(collisionGateBatch.prepared);
          for (const runtime of collisionGateBatch.enabledRuntimes) {
            runtime.collisionEnabledAtTick120 = tick120;
          }
        }
      }
      const snapshot = this.snapshot();
      const continuationBinding = this.sharedRunState
        ? EXT013_ROOM_THRESHOLD_RUN_BINDINGS.get(this.runState)
        : undefined;
      const successorGameplayDrained = continuationBinding?.phase === "successor-read"
        && continuationBinding.successorKernel === this
        && snapshot.digitalBodiesDrained;
      if (
        this.sharedRunState
        && (snapshot.projectileLifecycleDrained || successorGameplayDrained)
        && !this.sharedOccurrenceReleased
      ) {
        requestRunCombatOccurrenceRelease(this.runState, this.occurrenceId);
        this.sharedOccurrenceReleased = true;
      }
      runInternals.pendingFlushTick120 = tick120;
      return this.snapshot();
    } catch (error) {
      runInternals.fault = error instanceof Error ? error : new Error(String(error));
      throw error;
    }
  }

  snapshot(): CanonicalCombatSnapshot {
    const runtime = this.runtimeProjectiles;
    const projectiles = this.projectiles.activeSnapshots()
      .map((projectile): CombatProjectileSnapshot => {
        const state = runtime.get(keyFor(projectile));
        return Object.freeze({
          ...projectile,
          sourceId: state?.sourceId ?? "terminal-residue",
          sourceIndex: state?.sourceIndex ?? -1,
          burstIndex: state?.burstIndex ?? -1,
          headingDegrees: state?.headingDegrees ?? 0,
          speedPxPerSecond: state?.speedPxPerSecond ?? 0,
        });
      })
      .sort((left, right) => compareText(left.instanceId, right.instanceId)
        || left.generation - right.generation);
    const player = this.player.snapshot();
    const override = this.override.snapshot();
    const poolUsage = this.projectiles.usage();
    const digitalBodiesDrained = this.patternCompleteValue && poolUsage.liveColliders === 0;
    const materialResidueDraining = digitalBodiesDrained && poolUsage.residueVisuals > 0;
    const projectileLifecycleDrained = this.patternCompleteValue && projectiles.length === 0;
    const playerTimedStateQuiescent = player.recoveryAtTick120 === null
      && player.respawnPlaceAtTick120 === null
      && player.respawnCompleteAtTick120 === null;
    const overrideQuiescent = override.state === "idle" && override.deadlineTick120 === null;
    const runTimedStateQuiescent = playerTimedStateQuiescent && overrideQuiescent;
    return Object.freeze({
      authority: "canonical-combat-v4",
      patternId: this.pattern.id as CanonicalCombatPatternId,
      occurrenceId: this.occurrenceId,
      seed: this.options.seed,
      difficulty: this.options.difficulty,
      startTick120: this.options.startTick120,
      tick120: this.currentTick120,
      relativeTick120: this.currentTick120 - this.options.startTick120,
      patternComplete: this.patternCompleteValue,
      digitalBodiesDrained,
      materialResidueDraining,
      projectileLifecycleDrained,
      runTimedStateQuiescent,
      handoffReady: projectileLifecycleDrained && runTimedStateQuiescent,
      rngCallsConsumed: this.rngCallsConsumedValue,
      playerPosition: Object.freeze({...this.currentPlayerPosition}),
      player,
      evidence: this.evidence.snapshot(),
      override,
      projectiles: Object.freeze(projectiles),
      poolUsage,
      lastDamageBatch: this.lastDamageBatchValue,
      adapterGaps: this.adapterGaps,
    });
  }

  events(): readonly CanonicalGameplayEvent[] {
    return this.bus.events();
  }

  canonicalEventSerialization(): string {
    return this.bus.canonicalSerialization();
  }

  /** Immutable capacity evidence; gameplay never branches on this audit projection. */
  projectilePoolAudit(): readonly ProjectilePoolAuditRecord[] {
    return this.projectiles.auditLog();
  }

  /** Immutable audit view; mutating source-manifest objects cannot write authority back. */
  patternContractSnapshot(): ExecutablePattern {
    return this.pattern;
  }

  private validateStepInput(input: CanonicalCombatStepInput): ValidatedCombatStepInput {
    const internals = runCombatStateInternals(this.runState);
    if (
      internals.currentTick120 !== this.currentTick120
      || internals.currentPlayerPosition.x !== this.currentPlayerPosition.x
      || internals.currentPlayerPosition.y !== this.currentPlayerPosition.y
    ) {
      throw new Error("canonical combat lost synchronization with run combat state");
    }
    return validateCombatStepAgainstRunState(input, internals);
  }

  private spawnDueBursts(tick120: number): void {
    const relativeTick120 = tick120 - this.options.startTick120;
    while (this.scheduleCursor < this.schedule.length) {
      const scheduled = this.schedule[this.scheduleCursor];
      if (scheduled === undefined || crossedTickCount(scheduled.atMs) > relativeTick120) break;
      this.spawnBurst(scheduled.emitter, scheduled.burstIndex, scheduled.atMs, tick120);
      this.scheduleCursor += 1;
    }
  }

  private spawnBurst(
    emitter: PatternEmitter,
    burstIndex: number,
    authoredAtMs: number,
    tick120: number,
  ): void {
    const profile = this.pattern.difficulty[this.options.difficulty];
    const count = Math.max(1, roundPatternCount(emitter.geometry.count * profile.countMultiplier));
    const candidates = geometryCandidates(emitter, burstIndex, count);
    const speedCurve = capturePiecewiseLinearSpeedCurve(
      emitter.speedCurve as unknown as Readonly<Record<string, unknown>>,
      `${this.pattern.id}/${emitter.id}.speedCurve`,
    );
    const speedMultiplier = profile.speedMultiplier;
    const initialSpeed = speedCurveAt(speedCurve, 0) * speedMultiplier;
    const lateral = emitter.motionStack.find((entry) => entry.operator === "op.lateral_wall");
    const dualClockGate = dualClockGateContract(
      emitter.motionStack,
      `${this.pattern.id}/${emitter.id}.dual_clock_gate`,
    );
    const historyReplay = historyReplayContract(
      emitter.motionStack,
      `${this.pattern.id}/${emitter.id}.history_replay`,
    );
    const orbitRelease = orbitReleaseContract(
      emitter.motionStack,
      `${this.pattern.id}/${emitter.id}.orbit_release`,
    );
    for (const candidate of candidates) {
      // `op.lateral_wall` defines the opening as an absent spawn candidate.
      // The omitted lane therefore owns neither an entity identity nor an RNG call.
      if (lateral !== undefined && !lateralWallAllows(candidate.sourceIndex, count, lateral)) continue;
      const candidateDraw = this.nextRandom();
      const orbitPhaseRadians = orbitRelease === undefined
        ? null
        : orbitPhaseRadiansFromCandidateDraw(candidateDraw);
      const jitter = (candidateDraw - 0.5)
        * Math.min(3, emitter.geometry.spreadDeg * 0.012);
      const position = Object.freeze({x: candidate.x, y: candidate.y});
      const aim = emitter.motionStack.find((entry) => entry.operator === "op.aim_lock");
      const locksAtSpawn = aim !== undefined && numberParameter(aim, "lockAtMs", 0) <= 0;
      const headingDegrees = locksAtSpawn
        ? turnToward(
            candidate.headingDeg + jitter,
            angleTo(
              position,
              this.sampledPlayerTargetAtAuthoredMs(
                authoredAtMs + numberParameter(aim, "leadMs", 0),
                tick120,
              ),
            ),
            numberParameter(aim, "maxTurnDeg", 180),
          )
        : candidate.headingDeg + jitter;
      // A rule clip is authored as an observable cancellation into material
      // residue. Preflight omission would erase that behavior and consume RNG
      // without ever assigning the candidate an entity identity.
      // Rain's lane omission is the inverse, and its adapter order is literal:
      // source-index candidate -> one RNG jitter -> full local-vector sweep ->
      // entity spawn only on pass. A rejected droplet therefore has neither a
      // ProjectileAuthority identity nor digital/material lifecycle events.
      if (
        this.pattern.safeGap.enforcement !== "rule_clip_with_residue"
        && candidateViolatesSafeGap(
          this.pattern,
          this.options.difficulty,
          emitter,
          position,
          headingDegrees,
          speedCurve,
          speedMultiplier,
          authoredAtMs,
          orbitPhaseRadians,
        )
      ) continue;
      const armDelayTicks = crossedOffsetTickCount(authoredAtMs, emitter.projectile.armDelayMs);
      const armRelativeTick120 = crossedTickCount(authoredAtMs) + armDelayTicks;
      // Ash has one exact emitter. This candidate-derived ordinal matches the
      // immutable oracle's uid stream without binding replay offsets to a
      // recyclable pool slot or to whether an earlier pool allocation failed.
      const authoredSpawnOrdinal = burstIndex * count + candidate.sourceIndex + 1;
      const collisionEnabledAtArm = dualClockGate === undefined
        || dualClockGateActiveAtRelativeTick(
          dualClockGate,
          armRelativeTick120,
          this.pattern.safeGap.type,
        );
      const handle = this.projectiles.spawn({
        tick120,
        occurrenceKey: this.occurrenceScope !== null
          ? `${this.occurrenceScope}:${emitter.id}:${burstIndex}:${candidate.sourceIndex}`
          : `${this.pattern.id}:${emitter.id}:${burstIndex}:${candidate.sourceIndex}`,
        archetypeId: emitter.projectile.archetype,
        position,
        armDelayTicks,
        residueTicks: this.residueTicks,
        collisionEnabledAtArm,
      });
      if (handle === null) continue;
      const runtime: RuntimeProjectile = {
        handle,
        sourceId: emitter.id,
        sourceIndex: candidate.sourceIndex,
        burstIndex,
        spawnTick120: tick120,
        authoredSpawnMs: authoredAtMs,
        motion: emitter.motionStack,
        historyReplay,
        authoredSpawnOrdinal,
        orbitRelease,
        orbitOrigin: position,
        orbitPhaseRadians: orbitPhaseRadians ?? 0,
        orbitStarted: false,
        position,
        previousPosition: position,
        headingDegrees,
        speedCurve,
        speedMultiplier,
        localVectorBias: localVectorBiasContract(emitter.motionStack),
        dualClockGate,
        dualClockActive: collisionEnabledAtArm,
        speedPxPerSecond: collisionEnabledAtArm
          ? initialSpeed * speedEnvelopeMultiplierAt(
              speedEnvelopeContract(emitter.motionStack),
              0,
            )
          : 0,
        collisionEnabledAtTick120: null,
        desiredCollisionEnabled: null,
        desiredCollisionReason: null,
        aimLocked: locksAtSpawn,
        turnApplied: false,
        seamTransformed: false,
        nextHomingSample: 0,
        movementSegmentsAtTick120: null,
        movementSegments: Object.freeze([]),
      };
      this.runtimeProjectiles.set(keyFor(handle), runtime);
    }
  }

  private nextRandom(): number {
    this.rngCallsConsumedValue += 1;
    return this.random.random();
  }

  private advanceRuntimeProjectiles(tick120: number): void {
    const relativeTick120 = tick120 - this.options.startTick120;
    const relativeMs = relativeTick120 * 1000 / TICKS_PER_SECOND;
    const previousRelativeMs = relativeMs - 1000 / TICKS_PER_SECOND;
    const ordered = [...this.runtimeProjectiles.values()].sort((left, right) =>
      compareText(left.handle.instanceId, right.handle.instanceId)
      || left.handle.generation - right.handle.generation);
    for (const runtime of ordered) {
      runtime.movementSegmentsAtTick120 = null;
      runtime.movementSegments = Object.freeze([]);
      runtime.desiredCollisionEnabled = null;
      runtime.desiredCollisionReason = null;
      if (!this.projectiles.isActive(runtime.handle)) continue;
      const snapshot = this.projectiles.snapshot(runtime.handle);
      if (snapshot.state !== "flight") continue;
      // collision.on establishes flight at the end of its activation tick;
      // movement and terminal contact begin on the following master tick.
      if (snapshot.armAtTick >= tick120) continue;
      const ageTick120 = tick120 - runtime.spawnTick120;
      if (runtime.dualClockGate !== undefined) {
        const gateActive = dualClockGateActiveAtRelativeTick(
          runtime.dualClockGate,
          relativeTick120,
          this.pattern.safeGap.type,
        );
        const ageMs = Math.max(0, relativeMs - runtime.authoredSpawnMs);
        const ungatedSpeedPxPerSecond = speedCurveAt(runtime.speedCurve, ageMs)
          * runtime.speedMultiplier;
        // A newly opened collision lease commits at the end of this tick's
        // canonical phase order. Like the initial arm boundary, its first
        // non-zero motion/contact interval therefore begins on the next tick.
        const movesThisTick = gateActive && runtime.dualClockActive;
        const radians = degreesToRadians(runtime.headingDegrees);
        const proposed = movesThisTick
          ? Object.freeze({
              x: runtime.position.x
                + Math.cos(radians) * ungatedSpeedPxPerSecond / TICKS_PER_SECOND,
              y: runtime.position.y
                + Math.sin(radians) * ungatedSpeedPxPerSecond / TICKS_PER_SECOND,
            })
          : runtime.position;
        const phaseGapAllowsCollision = gateActive && reversiblePhaseGateAllowsCollision(
          this.pattern,
          this.options.difficulty,
          runtime.position,
          proposed,
          snapshot.collisionRadiusPx,
          previousRelativeMs,
          relativeMs,
        );
        runtime.speedPxPerSecond = movesThisTick ? ungatedSpeedPxPerSecond : 0;
        runtime.movementSegmentsAtTick120 = tick120;
        runtime.movementSegments = Object.freeze([motionSegment(
          runtime.position,
          proposed,
          previousRelativeMs,
          relativeMs,
          runtime.speedPxPerSecond,
        )]);
        runtime.previousPosition = runtime.position;
        runtime.position = proposed;
        this.projectiles.move(runtime.handle, tick120, proposed);
        runtime.desiredCollisionEnabled = gateActive && phaseGapAllowsCollision;
        runtime.desiredCollisionReason = gateActive ? "phase_gate" : "dual_clock_gate";
        runtime.dualClockActive = gateActive;
        if (outOfBounds(proposed)) {
          runtime.desiredCollisionEnabled = null;
          runtime.desiredCollisionReason = null;
          this.projectiles.cancel(runtime.handle, tick120, "out_of_bounds");
        }
        continue;
      }
      if (runtime.orbitRelease !== undefined) {
        if (this.pattern.id !== "room.in_between.misregistration_corridor") {
          throw new Error(`${this.pattern.id} runtime acquired unowned orbit/release motion`);
        }
        const linearSpeedPxPerSecond = speedCurveAt(
          runtime.speedCurve,
          Math.max(0, relativeMs - runtime.authoredSpawnMs),
        ) * runtime.speedMultiplier;
        const integrated = integrateOrbitReleaseMotion(
          runtime.position,
          runtime.orbitOrigin,
          runtime.orbitRelease,
          runtime.orbitPhaseRadians,
          runtime.orbitStarted,
          linearSpeedPxPerSecond,
          runtime.authoredSpawnMs,
          previousRelativeMs,
          relativeMs,
        );
        if (integrated.segments.some((segment) => sweptSegmentViolatesSafeGap(
          this.pattern,
          this.options.difficulty,
          segment.from,
          segment.to,
          snapshot.collisionRadiusPx,
          segment.previousRelativeMs,
          segment.relativeMs,
        ))) {
          throw new Error(
            `${this.pattern.id} admitted orbit/release projectile violated its complete swept preflight`,
          );
        }
        runtime.previousPosition = runtime.position;
        runtime.position = integrated.position;
        runtime.orbitStarted = integrated.orbitStarted;
        if (integrated.headingDegrees !== null) {
          runtime.headingDegrees = integrated.headingDegrees;
        }
        runtime.speedPxPerSecond = integrated.resolvedSpeedPxPerSecond;
        runtime.movementSegmentsAtTick120 = tick120;
        runtime.movementSegments = integrated.segments;
        this.projectiles.move(runtime.handle, tick120, integrated.position);
        if (outOfBounds(integrated.position)) {
          this.projectiles.cancel(runtime.handle, tick120, "out_of_bounds");
        }
        continue;
      }
      const usesOperatorConstraint = this.pattern.safeGap.enforcement === "operator_constraint";
      const usesIndependentRoomThresholdPhaseGate =
        this.pattern.id === "transition.room_threshold";
      const linearIndex = runtime.motion.findIndex((entry) => entry.operator === "op.linear");
      const turnIndex = runtime.motion.findIndex((entry) => entry.operator === "op.turn_once");
      const turnDeclaredAfterLinear = turnIndex >= 0
        && linearIndex >= 0
        && turnIndex > linearIndex;
      this.applyAimLock(runtime, ageTick120);
      if (!turnDeclaredAfterLinear) this.applyTurnOnce(runtime, ageTick120);
      this.applyLimitedHoming(runtime, ageTick120);
      const radians = degreesToRadians(runtime.headingDegrees);
      const lateral = motion(runtime, "op.lateral_wall");
      const seamTransform = motion(runtime, "op.seam_transform");
      const envelope = speedEnvelopeContract(runtime.motion);
      const usesAnalyticKinematics = envelope !== undefined
        || runtime.localVectorBias !== undefined
        || runtime.speedCurve.keys.length > 1;
      let next: Vec2;
      let violatesSafeGap: boolean;
      if (seamTransform !== undefined) {
        const integrated = seamTransform.params.mode === "offset"
          ? integrateOffsetSeamMotion(
              runtime.position,
              runtime.headingDegrees,
              runtime.speedPxPerSecond,
              seamTransform,
              runtime.seamTransformed,
              previousRelativeMs,
              relativeMs,
            )
          : integrateSeamRedirectMotion(
              this.pattern,
              this.options.difficulty,
              runtime.position,
              runtime.headingDegrees,
              runtime.speedPxPerSecond,
              snapshot.collisionRadiusPx,
              seamTransform,
              runtime.seamTransformed,
              previousRelativeMs,
              relativeMs,
            );
        next = integrated.position;
        runtime.headingDegrees = integrated.headingDegrees;
        runtime.seamTransformed = integrated.seamTransformed;
        runtime.movementSegmentsAtTick120 = tick120;
        runtime.movementSegments = integrated.contactSegments;
        // Crack redirects the complete footprint. Override Void retains both
        // offset sides and uses the ordinary visible rule-clip cancellation.
        violatesSafeGap = seamTransform.params.mode === "offset"
          && integrated.segments.some((segment) => sweptSegmentViolatesSafeGap(
            this.pattern,
            this.options.difficulty,
            segment.from,
            segment.to,
            snapshot.collisionRadiusPx,
            segment.previousRelativeMs,
            segment.relativeMs,
          ));
      } else if (usesOperatorConstraint) {
        const historySpeedPxPerSecond = speedCurveAt(
          runtime.speedCurve,
          Math.max(0, relativeMs - runtime.authoredSpawnMs),
        ) * runtime.speedMultiplier;
        const historyIntegrated = runtime.historyReplay === undefined
          ? null
          : integrateHistoryReplayMotion(
              runtime.position,
              runtime.historyReplay,
              runtime.authoredSpawnOrdinal,
              runtime.authoredSpawnMs,
              previousRelativeMs,
              relativeMs,
              historySpeedPxPerSecond,
            );
        const integrated = historyIntegrated ?? (usesAnalyticKinematics
          ? integrateKinematicMotion(
              runtime.position,
              runtime.headingDegrees,
              runtime.speedCurve,
              runtime.speedMultiplier,
              numberParameter(lateral, "driftPxPerSec", 0),
              envelope,
              runtime.localVectorBias,
              runtime.authoredSpawnMs,
              previousRelativeMs,
              relativeMs,
            )
          : (() => {
              const directNext = Object.freeze({
                x: runtime.position.x + (
                  Math.cos(radians) * runtime.speedPxPerSecond
                  + numberParameter(lateral, "driftPxPerSec", 0)
                ) / TICKS_PER_SECOND,
                y: runtime.position.y
                  + Math.sin(radians) * runtime.speedPxPerSecond / TICKS_PER_SECOND,
              });
              return Object.freeze({
                position: directNext,
                resolvedSpeedPxPerSecond: runtime.speedPxPerSecond,
                segments: Object.freeze([motionSegment(
                  runtime.position,
                  directNext,
                  previousRelativeMs,
                  relativeMs,
                  runtime.speedPxPerSecond,
                )]),
              });
            })());
        runtime.speedPxPerSecond = integrated.resolvedSpeedPxPerSecond;
        // A turn declared after linear completes the crossed tick's old-heading
        // sweep before its zero-time turn. A turn declared before linear (the
        // exact Context-B and One-Sun signatures) was already applied above.
        if (turnDeclaredAfterLinear) this.applyTurnOnce(runtime, ageTick120);
        const constrained = applyOperatorConstraint(
          this.pattern,
          this.options.difficulty,
          integrated.position,
          runtime.headingDegrees,
          snapshot.collisionRadiusPx,
          integrated.segments,
          relativeMs,
        );
        next = constrained.position;
        runtime.headingDegrees = constrained.headingDegrees;
        runtime.movementSegmentsAtTick120 = tick120;
        runtime.movementSegments = constrained.contactSegments;
        violatesSafeGap = false;
      } else if (usesAnalyticKinematics) {
        const integrated = integrateKinematicMotion(
          runtime.position,
          runtime.headingDegrees,
          runtime.speedCurve,
          runtime.speedMultiplier,
          numberParameter(lateral, "driftPxPerSec", 0),
          envelope,
          runtime.localVectorBias,
          runtime.authoredSpawnMs,
          previousRelativeMs,
          relativeMs,
        );
        next = integrated.position;
        runtime.speedPxPerSecond = integrated.resolvedSpeedPxPerSecond;
        runtime.movementSegmentsAtTick120 = tick120;
        runtime.movementSegments = integrated.segments;
        violatesSafeGap = usesIndependentRoomThresholdPhaseGate
          ? false
          : integrated.segments.some((segment) => sweptSegmentViolatesSafeGap(
              this.pattern,
              this.options.difficulty,
              segment.from,
              segment.to,
              snapshot.collisionRadiusPx,
              segment.previousRelativeMs,
              segment.relativeMs,
            ));
      } else {
        next = Object.freeze({
          x: runtime.position.x + (
            Math.cos(radians) * runtime.speedPxPerSecond
            + numberParameter(lateral, "driftPxPerSec", 0)
          ) / TICKS_PER_SECOND,
          y: runtime.position.y + Math.sin(radians) * runtime.speedPxPerSecond / TICKS_PER_SECOND,
        });
        runtime.movementSegmentsAtTick120 = tick120;
        runtime.movementSegments = Object.freeze([Object.freeze({
          from: runtime.position,
          to: next,
          previousRelativeMs,
          relativeMs,
          speedPxPerSecond: runtime.speedPxPerSecond,
        })]);
        violatesSafeGap = false;
      }
      if (turnDeclaredAfterLinear && !usesOperatorConstraint) {
        this.applyTurnOnce(runtime, ageTick120);
      }
      runtime.previousPosition = runtime.position;
      runtime.position = next;
      const moved = this.projectiles.move(runtime.handle, tick120, next);
      if (usesIndependentRoomThresholdPhaseGate) {
        runtime.desiredCollisionEnabled = independentRoomThresholdPhaseGateAllowsCollision(
          this.pattern,
          this.options.difficulty,
          runtime.movementSegments,
          snapshot.collisionRadiusPx,
        );
        runtime.desiredCollisionReason = "phase_gate";
      }
      const runtimeViolatesSafeGap = !usesIndependentRoomThresholdPhaseGate && (violatesSafeGap || (
        seamTransform === undefined
        && !usesOperatorConstraint
        && !usesAnalyticKinematics
        && sweptRuntimeViolatesSafeGap(
        this.pattern,
        this.options.difficulty,
        moved,
        previousRelativeMs,
        relativeMs,
      )));
      if (runtimeViolatesSafeGap) {
        if (
          this.pattern.id === "room.polarized.alternating_verdict"
          && this.pattern.safeGap.enforcement === "angular_omission"
        ) {
          throw new Error(
            `${this.pattern.id} admitted projectile violated its complete swept preflight`,
          );
        }
        this.projectiles.cancel(runtime.handle, tick120, "source_withdrawn");
      } else if (outOfBounds(next)) {
        runtime.desiredCollisionEnabled = null;
        runtime.desiredCollisionReason = null;
        this.projectiles.cancel(runtime.handle, tick120, "out_of_bounds");
      }
    }
  }

  private applyAimLock(runtime: RuntimeProjectile, ageTick120: number): void {
    const aim = motion(runtime, "op.aim_lock");
    if (aim === undefined || runtime.aimLocked) return;
    if (ageTick120 < crossedOffsetTickCount(
      runtime.authoredSpawnMs,
      numberParameter(aim, "lockAtMs", 0),
    )) return;
    runtime.headingDegrees = turnToward(
      runtime.headingDegrees,
      angleTo(
        runtime.position,
        this.sampledPlayerTargetAtAuthoredMs(
          runtime.authoredSpawnMs
            + numberParameter(aim, "lockAtMs", 0)
            + numberParameter(aim, "leadMs", 0),
          this.currentTick120,
        ),
      ),
      numberParameter(aim, "maxTurnDeg", 180),
    );
    runtime.aimLocked = true;
  }

  private applyTurnOnce(runtime: RuntimeProjectile, ageTick120: number): void {
    const turn = motion(runtime, "op.turn_once");
    if (turn === undefined || runtime.turnApplied) return;
    if (ageTick120 < crossedOffsetTickCount(
      runtime.authoredSpawnMs,
      numberParameter(turn, "atMs", 0),
    )) return;
    runtime.headingDegrees += numberParameter(turn, "deltaDeg", 0);
    runtime.turnApplied = true;
  }

  private sampledPlayerTargetAtAuthoredMs(authoredRelativeMs: number, currentTick120: number): Vec2 {
    if (!Number.isFinite(authoredRelativeMs)) {
      throw new Error("aim target authored time must be finite");
    }
    const targetTick120 = this.options.startTick120 + crossedTickCount(Math.max(0, authoredRelativeMs));
    if (targetTick120 <= currentTick120) {
      const sampled = this.playerPositionByTick120.get(targetTick120);
      if (sampled !== undefined) return sampled;
      // Only a run handoff can ask for a pre-kernel sample. The initial
      // position is the oldest authority fact available at this boundary.
      return this.playerPositionByTick120.get(this.options.startTick120)
        ?? this.currentPlayerPosition;
    }

    // Positive lead requests a future player sample, which an interactive
    // runtime cannot possess. V4 defines the field but not an online predictor;
    // this explicit adapter policy extrapolates only the latest authoritative
    // movement segment and never reads presentation or wall-clock state.
    const previous = this.playerPositionByTick120.get(currentTick120 - 1)
      ?? this.currentPlayerPosition;
    const ticksAhead = targetTick120 - currentTick120;
    return Object.freeze({
      x: Math.max(0, Math.min(
        LOGICAL_VIEW_WIDTH,
        this.currentPlayerPosition.x + (this.currentPlayerPosition.x - previous.x) * ticksAhead,
      )),
      y: Math.max(0, Math.min(
        LOGICAL_VIEW_HEIGHT,
        this.currentPlayerPosition.y + (this.currentPlayerPosition.y - previous.y) * ticksAhead,
      )),
    });
  }

  private applyLimitedHoming(runtime: RuntimeProjectile, ageTick120: number): void {
    const homing = motion(runtime, "op.limited_homing");
    if (homing === undefined) return;
    const startMs = numberParameter(homing, "startMs", 0);
    const endMs = numberParameter(homing, "endMs", startMs);
    const sampleEveryMs = requirePositiveFinite(
      numberParameter(homing, "sampleEveryMs", 1),
      "limited homing sampleEveryMs",
    );
    while (true) {
      const authoredSampleMs = startMs + runtime.nextHomingSample * sampleEveryMs;
      if (
        authoredSampleMs > endMs
        || crossedOffsetTickCount(runtime.authoredSpawnMs, authoredSampleMs) > ageTick120
      ) break;
      runtime.headingDegrees = turnToward(
        runtime.headingDegrees,
        angleTo(runtime.position, this.currentPlayerPosition),
        numberParameter(homing, "maxDegPerSec", 0) * sampleEveryMs / 1000,
      );
      runtime.nextHomingSample += 1;
    }
  }

  private cancelMovedProjectilesInOverride(tick120: number) {
    if (
      this.pattern.id !== "room.forced.crack_fall_loop"
      && this.pattern.id !== "room.in_between.context_switch"
      && this.pattern.id !== "room.in_between.misregistration_corridor"
      && this.pattern.id !== "transition.override_void"
      && this.pattern.id !== "encounter.weather_echo.ash_memory"
    ) {
      return this.override.cancelProjectiles(this.projectiles, tick120);
    }
    const area = this.override.snapshot().localVoid;
    if (area === null) return this.override.cancelProjectiles(this.projectiles, tick120);
    const paths: OverrideProjectilePath[] = [];
    for (const snapshot of this.projectiles.activeSnapshots()) {
      if (snapshot.state !== "flight") continue;
      const runtime = this.runtimeProjectiles.get(keyFor(snapshot));
      if (
        runtime === undefined
        || runtime.movementSegmentsAtTick120 !== tick120
        || runtime.movementSegments.length === 0
      ) continue;
      paths.push(Object.freeze({
        projectileId: snapshot.instanceId,
        projectileGeneration: snapshot.generation,
        segments: Object.freeze(runtime.movementSegments.map((segment) => Object.freeze({
          from: segment.from,
          to: segment.to,
          ...(segment.startsNewComponent === true
            ? {startsNewComponent: true as const}
            : {}),
        }))),
      }));
    }
    return this.override.cancelProjectilesAlongPaths(
      this.projectiles,
      Object.freeze(paths),
      tick120,
    );
  }

  private resolvePlayerContacts(tick120: number): void {
    const playerRadius = this.focused
      ? PLAYER_FOCUS_COLLISION_RADIUS_PX
      : PLAYER_NORMAL_COLLISION_RADIUS_PX;
    const handles = [...this.runtimeProjectiles.values()]
      .map((runtime) => runtime.handle)
      .filter((handle) => this.projectiles.isActive(handle))
      .sort((left, right) => compareText(left.instanceId, right.instanceId)
        || left.generation - right.generation);
    const hitHandles: ProjectileHandle[] = [];
    const previousPlayerPosition = this.previousPlayerPosition ?? this.currentPlayerPosition;
    for (const handle of handles) {
      const snapshot = this.projectiles.snapshot(handle);
      if (snapshot.state !== "flight" || !snapshot.collisionEnabled) continue;
      if (snapshot.armAtTick >= tick120) continue;
      const runtime = this.runtimeProjectiles.get(keyFor(handle));
      if (runtime === undefined) throw new Error("live projectile lost runtime motion authority");
      if (runtime.collisionEnabledAtTick120 === tick120) continue;
      const hit = sweepRuntimeAgainstMovingPlayer(
        runtime,
        snapshot,
        tick120,
        this.options.startTick120,
        previousPlayerPosition,
        this.currentPlayerPosition,
        playerRadius,
      );
      if (hit !== null) {
        hitHandles.push(handle);
        continue;
      }
      const nearMiss = sweepRuntimeAgainstMovingPlayer(
        runtime,
        snapshot,
        tick120,
        this.options.startTick120,
        previousPlayerPosition,
        this.currentPlayerPosition,
        this.options.grazeRadiusPx,
      );
      if (nearMiss !== null) this.graze.tryAward(this.projectiles, handle, this.player.playerId, tick120);
    }
    if (hitHandles.length === 0) {
      this.player.advanceTo(tick120);
      return;
    }

    const result = this.player.commitDamageBatch(tick120, hitHandles.map((handle) => ({
      occurrenceKey: `hit:${handle.instanceId}:${handle.generation}:tick:${tick120}`,
      sourceId: `${handle.instanceId}:${handle.generation}`,
      amount: this.options.projectileDamage,
    })));
    this.lastDamageBatchValue = result;
    if (result.committedSourceId === null) return;
    const committed = hitHandles.find((handle) =>
      `${handle.instanceId}:${handle.generation}` === result.committedSourceId);
    if (committed === undefined) throw new Error("damage authority selected an unknown projectile source");
    this.projectiles.impact(committed, tick120, this.player.playerId);
  }

  private prepareRuntimeCollisionGateBatch(tick120: number): RuntimeCollisionGateBatch | null {
    const ordered = [...this.runtimeProjectiles.values()].sort((left, right) =>
      compareText(left.handle.instanceId, right.handle.instanceId)
      || left.handle.generation - right.handle.generation);
    const changes: ProjectileFlightCollisionChange[] = [];
    const enabledRuntimes: RuntimeProjectile[] = [];
    for (const runtime of ordered) {
      const desired = runtime.desiredCollisionEnabled;
      const reason = runtime.desiredCollisionReason;
      if (
        desired === null
        || reason === null
        || !this.projectiles.isActive(runtime.handle)
      ) continue;
      const snapshot = this.projectiles.snapshot(runtime.handle);
      if (snapshot.state !== "flight" || snapshot.collisionEnabled === desired) continue;
      changes.push(Object.freeze({handle: runtime.handle, enabled: desired, reason}));
      if (desired) enabledRuntimes.push(runtime);
    }
    if (changes.length === 0) return null;
    return Object.freeze({
      prepared: this.projectiles.prepareFlightCollisionBatch(
        tick120,
        Object.freeze(changes),
      ),
      enabledRuntimes: Object.freeze(enabledRuntimes),
    });
  }

  private cancelLiveProjectiles(
    tick120: number,
    reason: "pattern_end" | "source_withdrawn" | "out_of_bounds" | "override_void" | "room_transition",
  ): void {
    const live = this.projectiles.activeSnapshots()
      .filter((snapshot) => snapshot.state === "arm" || snapshot.state === "flight")
      .sort((left, right) => compareText(left.instanceId, right.instanceId)
        || left.generation - right.generation);
    if (live.length === 0) {
      this.projectiles.advanceTo(tick120);
      return;
    }
    this.projectiles.cancelMany(live.map((snapshot) => ({
      instanceId: snapshot.instanceId,
      generation: snapshot.generation,
    })), tick120, reason);
  }

  private removeCompletedRuntimeProjectiles(): void {
    for (const [key, runtime] of this.runtimeProjectiles) {
      if (!this.projectiles.isActive(runtime.handle)) this.runtimeProjectiles.delete(key);
    }
  }
}

function requirePreparedRoomThresholdMaterialDetach(
  proposal: PreparedCanonicalRoomThresholdMaterialDetach,
  expectedStatus: PreparedRoomThresholdMaterialDetachRecord["status"],
): PreparedRoomThresholdMaterialDetachRecord {
  if (typeof proposal !== "object" || proposal === null) {
    throw new Error("Room Threshold material detach proposal must be opaque");
  }
  const record = PREPARED_ROOM_THRESHOLD_MATERIAL_DETACHES.get(proposal);
  if (record === undefined) {
    throw new Error("Room Threshold material detach proposal is not registered");
  }
  if (ACTIVE_ROOM_THRESHOLD_MATERIAL_DETACH_BY_KERNEL.get(record.kernel) !== proposal) {
    throw new Error("Room Threshold material detach proposal lost its exclusive reservation");
  }
  if (record.status !== expectedStatus) {
    throw new Error(`Room Threshold material detach proposal is ${record.status}`);
  }
  return record;
}

/** Stage the unique relative-936 gameplay/material ownership split. */
export function prepareCanonicalRoomThresholdMaterialDetach(
  kernel: CanonicalCombatKernel,
): PreparedCanonicalRoomThresholdMaterialDetach {
  if (
    !isExactExt013RoomThresholdKernel(kernel)
  ) {
    throw new Error("Room Threshold material detach requires the exact live EXT-013 kernel");
  }
  if (ACTIVE_ROOM_THRESHOLD_MATERIAL_DETACH_BY_KERNEL.has(kernel)) {
    throw new Error("Room Threshold material detach already has an in-flight proposal");
  }
  const view = kernel[ROOM_THRESHOLD_MATERIAL_DETACH]("inspect");
  const proposal = Object.freeze(Object.create(null)) as unknown as PreparedCanonicalRoomThresholdMaterialDetach;
  PREPARED_ROOM_THRESHOLD_MATERIAL_DETACHES.set(proposal, {
    kernel,
    runState: view.runState,
    tick120: view.tick120,
    status: "prepared",
  });
  ACTIVE_ROOM_THRESHOLD_MATERIAL_DETACH_BY_KERNEL.set(kernel, proposal);
  return proposal;
}

/** Request occurrence release after all complete-tick gameplay events are staged. */
export function applyCanonicalRoomThresholdMaterialDetachBeforeFlush(
  proposal: PreparedCanonicalRoomThresholdMaterialDetach,
): void {
  const record = requirePreparedRoomThresholdMaterialDetach(proposal, "prepared");
  try {
    const view = record.kernel[ROOM_THRESHOLD_MATERIAL_DETACH]("inspect");
    if (view.runState !== record.runState || view.tick120 !== record.tick120) {
      throw new Error("Room Threshold material detach proposal became stale");
    }
    record.kernel[ROOM_THRESHOLD_MATERIAL_DETACH]("request-release");
    record.status = "release-requested";
  } catch (error) {
    record.status = "failed";
    const internals = runCombatStateInternals(record.runState);
    if (internals.fault === null) {
      internals.fault = error instanceof Error ? error : new Error(String(error));
    }
    throw error;
  }
}

/** Mint material-only ownership only after the run occurrence release flush succeeded. */
export function commitCanonicalRoomThresholdMaterialDetachAfterFlush(
  proposal: PreparedCanonicalRoomThresholdMaterialDetach,
): CanonicalRoomThresholdMaterialCarryover {
  const record = requirePreparedRoomThresholdMaterialDetach(proposal, "release-requested");
  try {
    const view = record.kernel[ROOM_THRESHOLD_MATERIAL_DETACH]("validate-after-flush");
    if (view.runState !== record.runState || view.tick120 !== record.tick120) {
      throw new Error("Room Threshold material detach commit drifted");
    }
    const binding = EXT013_ROOM_THRESHOLD_RUN_BINDINGS.get(record.runState);
    if (
      binding?.kernel !== record.kernel
      || binding.phase !== "detach-release-requested"
      || binding.carryover !== null
      || binding.expectedFlushTick120 !== null
      || binding.expectedPendingEventCount !== null
    ) {
      throw new Error("Room Threshold material carryover lost its exact Run reservation");
    }
    const room = RoomTransitionAuthority.prototype.snapshot.call(binding.roomTransition);
    if (
      room.tick120 !== view.tick120
      || room.state !== "idle"
      || room.currentRoom !== binding.targetRoom
      || room.targetRoom !== null
      || room.generation !== 1
      || room.active !== null
    ) {
      throw new Error("Room Threshold material carryover lost its completed target-room FSM");
    }
    const carryover = new CanonicalRoomThresholdMaterialCarryover(
      view.runState,
      view.projectiles,
      view.materialIdentityByKey,
      view.tick120,
      CREATE_ROOM_THRESHOLD_MATERIAL_CARRYOVER,
    );
    record.kernel[ROOM_THRESHOLD_MATERIAL_DETACH]("finalize-after-carryover");
    binding.phase = "material";
    binding.carryover = carryover;
    binding.materialRoomEventCount = room.eventCount;
    record.status = "committed";
    return carryover;
  } catch (error) {
    record.status = "failed";
    const internals = runCombatStateInternals(record.runState);
    if (internals.fault === null) {
      internals.fault = error instanceof Error ? error : new Error(String(error));
    }
    throw error;
  }
}

/**
 * Opaque owner for collisionless threshold sediment after transition gameplay
 * releases. It intentionally exposes no spawn, collision, RNG, or contact port.
 */
export class CanonicalRoomThresholdMaterialCarryover {
  constructor(
    runState: CanonicalRunCombatState,
    projectiles: ProjectileAuthorityPool,
    materialIdentityByKey: ReadonlyMap<string, Readonly<{
      sourceId: string;
      sourceIndex: number;
      burstIndex: number;
      headingDegrees: number;
      speedPxPerSecond: number;
    }>>,
    detachedAtTick120: number,
    creationToken?: symbol,
  ) {
    if (creationToken !== CREATE_ROOM_THRESHOLD_MATERIAL_CARRYOVER) {
      throw new Error("Room Threshold material carryover can only be minted by a flushed detach");
    }
    ROOM_THRESHOLD_MATERIAL_CARRYOVERS.set(this, {
      runState,
      projectiles,
      materialIdentityByKey,
      detachedAtTick120,
      currentTick120: detachedAtTick120,
    });
    Object.freeze(this);
  }

  snapshot(): CanonicalRoomThresholdMaterialCarryoverSnapshot {
    const record = ROOM_THRESHOLD_MATERIAL_CARRYOVERS.get(this);
    if (record === undefined) throw new Error("unrecognized Room Threshold material carryover");
    const projectiles = record.projectiles.activeSnapshots()
      .map((projectile): CombatProjectileSnapshot => {
        const identity = record.materialIdentityByKey.get(keyFor(projectile));
        if (identity === undefined) {
          throw new Error("Room Threshold material carryover lost its source identity");
        }
        return Object.freeze({...projectile, ...identity});
      })
      .sort((left, right) => compareText(left.instanceId, right.instanceId)
        || left.generation - right.generation);
    if (projectiles.some((projectile) =>
      projectile.state !== "residue" || projectile.collisionEnabled)) {
      throw new Error("Room Threshold material carryover acquired gameplay-capable state");
    }
    const poolUsage = record.projectiles.usage();
    if (poolUsage.liveColliders !== 0 || poolUsage.residueVisuals !== projectiles.length) {
      throw new Error("Room Threshold material carryover pool accounting drifted");
    }
    return Object.freeze({
      authority: "room-threshold-material-carryover-v1" as const,
      sourcePatternId: FIRST_CONTINUATION_ROOM_THRESHOLD_PATTERN_ID,
      sourceOccurrenceId: FIRST_CONTINUATION_ROOM_THRESHOLD_OCCURRENCE_ID,
      detachedAtTick120: record.detachedAtTick120,
      tick120: record.currentTick120,
      materialCount: projectiles.length,
      drained: projectiles.length === 0,
      poolUsage,
      projectiles: Object.freeze(projectiles),
    });
  }
}

/**
 * Advance one target-room idle tick with the old room's collisionless material
 * on the same bus. Validation completes before either authority mutates.
 */
export function advanceCanonicalRunIdleWithRoomThresholdMaterial(
  runState: CanonicalRunCombatState,
  carryover: CanonicalRoomThresholdMaterialCarryover,
  input: CanonicalCombatStepInput,
  roomIdValue: string,
): CanonicalRunIdleWithRoomThresholdMaterialResult {
  if (!isExactCanonicalRunCombatState(runState)) {
    throw new Error("material idle advance requires an exact CanonicalRunCombatState");
  }
  const material = ROOM_THRESHOLD_MATERIAL_CARRYOVERS.get(carryover);
  if (material === undefined || material.runState !== runState) {
    throw new Error("material idle advance requires the exact carryover owner and run state");
  }
  const binding = EXT013_ROOM_THRESHOLD_RUN_BINDINGS.get(runState);
  if (
    (binding?.phase !== "material" && binding?.phase !== "target-room-idle")
    || binding.carryover !== carryover
    || binding.kernel[ROOM_THRESHOLD_RUN_STATE_PROOF]() !== runState
    || binding.expectedFlushTick120 !== null
    || binding.expectedPendingEventCount !== null
  ) {
    throw new Error("material idle advance lost its exclusive EXT-013 Run reservation");
  }
  return advanceCanonicalRunIdleWithContinuationMaterial(
    runState,
    carryover,
    input,
    roomIdValue,
    binding,
    material,
    Object.freeze({
      label: "material idle",
      requireDrained: binding.phase === "target-room-idle",
      requireOverrideQuiescent: true,
      latestTick120: null,
    }),
  );
}

/**
 * Exact successor-only pre-READ port. It cannot be reached with the old
 * transition/material capability and stops before the H+159 READ claim tick.
 */
export function advanceCanonicalRunFirstContinuationDormantSuccessorPreReadTick(
  runState: CanonicalRunCombatState,
  eventBus: CanonicalEventBus,
  carryover: CanonicalRoomThresholdMaterialCarryover,
  successorOwner: object,
  input: CanonicalCombatStepInput,
): CanonicalRunIdleWithRoomThresholdMaterialResult {
  if (!isExactCanonicalRunCombatState(runState)) {
    throw new Error("dormant successor pre-READ requires an exact CanonicalRunCombatState");
  }
  if (!isExactCanonicalEventBus(eventBus)) {
    throw new Error("dormant successor pre-READ requires the exact canonical event bus");
  }
  const material = ROOM_THRESHOLD_MATERIAL_CARRYOVERS.get(carryover);
  const binding = EXT013_ROOM_THRESHOLD_RUN_BINDINGS.get(runState);
  const plan = binding?.successorPlan ?? null;
  const reservation = binding?.successorReservation ?? null;
  const internals = runCombatStateInternals(runState);
  if (
    material === undefined
    || material.runState !== runState
    || (binding?.phase !== "successor-dormant" && binding?.phase !== "successor-pre-read")
    || binding.carryover !== carryover
    || binding.successorOwner !== successorOwner
    || reservation === null
    || plan === null
    || binding.kernel[ROOM_THRESHOLD_RUN_STATE_PROOF]() !== runState
    || binding.expectedFlushTick120 !== null
    || binding.expectedPendingEventCount !== null
    || internals.bus !== eventBus
    || reservation.admittedAtTick120 !== plan.plannedAtTick120
    || reservation.targetRoom !== plan.targetRoom
    || reservation.occurrenceId !== plan.occurrence.occurrenceId
    || reservation.patternId !== plan.occurrence.patternId
  ) {
    throw new Error("dormant successor pre-READ lost its exact committed owner and plan lease");
  }
  const readOffsetTick120 = crossedTickCount(
    plan.occurrence.segmentsMs.telegraph + plan.occurrence.segmentsMs.entry,
  );
  const readStartTick120 = plan.plannedAtTick120 + readOffsetTick120;
  if (
    !Number.isSafeInteger(readStartTick120)
    || internals.currentTick120 < plan.plannedAtTick120
    || internals.currentTick120 >= readStartTick120
  ) {
    throw new Error("dormant successor pre-READ is outside its exact H..H+158 boundary");
  }
  const result = advanceCanonicalRunIdleWithContinuationMaterial(
    runState,
    carryover,
    input,
    binding.targetRoom,
    binding,
    material,
    Object.freeze({
      label: "dormant successor pre-READ",
      requireDrained: false,
      requireOverrideQuiescent: true,
      latestTick120: readStartTick120 - 1,
    }),
  );
  binding.phase = "successor-pre-read";
  return result;
}

interface ContinuationMaterialIdleAdvancePolicy {
  readonly label:
    | "material idle"
    | "dormant successor pre-READ"
    | "successor READ start"
    | "successor tail"
    | "successor complete hold";
  readonly requireDrained: boolean;
  readonly requireOverrideQuiescent: boolean;
  readonly latestTick120: number | null;
}

function advanceCanonicalRunIdleWithContinuationMaterial(
  runState: CanonicalRunCombatState,
  carryover: CanonicalRoomThresholdMaterialCarryover,
  input: CanonicalCombatStepInput,
  roomIdValue: string,
  binding: Ext013RoomThresholdRunBinding,
  material: RoomThresholdMaterialCarryoverRecord,
  policy: ContinuationMaterialIdleAdvancePolicy,
): CanonicalRunIdleWithRoomThresholdMaterialResult {
  const internals = runCombatStateInternals(runState);
  if (internals.advanceLocked) {
    throw new Error(`${policy.label} advance is already in progress`);
  }
  internals.advanceLocked = true;
  try {
    assertRunCombatStateOperational(internals);
    if (
      internals.activeOccurrenceId !== null
      || internals.pendingReleaseOccurrenceId !== null
      || internals.pendingFlushTick120 !== null
    ) {
      throw new Error(`${policy.label} advance requires a released, flushed occurrence boundary`);
    }
    if (internals.bus.pendingEventCount() !== 0) {
      const error = new Error(
        `${policy.label} advance requires an empty shared event queue`,
      );
      internals.fault = error;
      throw error;
    }
    if (material.currentTick120 !== internals.currentTick120) {
      throw new Error("material carryover lost synchronization with the run tick");
    }
    const roomId = requireUnicodeScalarString(roomIdValue, `${policy.label} roomId`);
    if (!V4_PLAYER_AUTHORITY_CONTRACT.canonicalRoomIds.includes(roomId)) {
      throw new Error(`${policy.label} room is not authored: ${roomId}`);
    }
    if (roomId !== binding.targetRoom) {
      throw new Error(
        policy.label === "material idle"
          ? `material idle room must remain the formal EXT-013 target: ${binding.targetRoom}`
          : `${policy.label} room must remain the formal continuation target: ${binding.targetRoom}`,
      );
    }
    const validated = validateCombatStepAgainstRunState(input, internals);
    if (policy.latestTick120 !== null && validated.tick120 > policy.latestTick120) {
      throw new Error(
        `${policy.label} stops before the exact READ claim tick ${policy.latestTick120 + 1}`,
      );
    }
    if (validated.overridePressed || validated.overrideReleased) {
      throw new Error(
        `${policy.label} cannot admit an Override edge before successor local resistance`,
      );
    }
    const beforeMaterial = carryover.snapshot();
    const beforeOverride = internals.override.snapshot();
    const beforeRoom = RoomTransitionAuthority.prototype.snapshot.call(binding.roomTransition);
    if (
      beforeMaterial.tick120 !== internals.currentTick120
      || beforeMaterial.poolUsage.liveColliders !== 0
      || binding.materialRoomEventCount === null
      || beforeRoom.tick120 !== internals.currentTick120
      || beforeRoom.state !== "idle"
      || beforeRoom.currentRoom !== binding.targetRoom
      || beforeRoom.targetRoom !== null
      || beforeRoom.generation !== 1
      || beforeRoom.eventCount !== binding.materialRoomEventCount
      || beforeRoom.active !== null
      || (policy.requireOverrideQuiescent
        && (beforeOverride.state !== "idle"
          || beforeOverride.deadlineTick120 !== null
          || beforeOverride.localVoid !== null))
      || (policy.requireDrained && !beforeMaterial.drained)
    ) {
      const error = new Error(
        `${policy.label} material, target-room FSM, or Override lost its sealed boundary`,
      );
      internals.fault = error;
      throw error;
    }
    const roomProposal = RoomTransitionAuthority.prototype.prepareAdvance.call(
      binding.roomTransition,
      validated.tick120,
    );
    const roomView = RoomTransitionAuthority.prototype.validatePreparedMutation.call(
      binding.roomTransition,
      roomProposal,
      internals.bus,
    );
    if (
      roomView.kind !== "advance"
      || roomView.eventBus !== internals.bus
      || roomView.tick120 !== validated.tick120
      || roomView.drafts.length !== 0
      || roomView.preview.tick120 !== validated.tick120
      || roomView.preview.state !== "idle"
      || roomView.preview.currentRoom !== binding.targetRoom
      || roomView.preview.targetRoom !== null
      || roomView.preview.generation !== 1
      || roomView.preview.eventCount !== binding.materialRoomEventCount
      || roomView.preview.active !== null
    ) {
      const error = new Error(`${policy.label} target-room FSM proposal drifted`);
      internals.fault = error;
      throw error;
    }

    try {
      material.projectiles.advanceTo(validated.tick120);
      internals.currentTick120 = validated.tick120;
      internals.previousPlayerPosition = internals.currentPlayerPosition;
      internals.currentPlayerPosition = validated.playerPosition;
      internals.focused = validated.focused;
      if (validated.overridePressed) {
        if (validated.overrideDirection === null) {
          throw new Error("validated Override direction was lost");
        }
        internals.override.press({
          origin: validated.playerPosition,
          direction: validated.overrideDirection,
          roomId,
        }, validated.tick120);
      }
      if (validated.overrideReleased) internals.override.release(validated.tick120);
      internals.override.advanceTo(validated.tick120);
      internals.player.advanceTo(validated.tick120);
      const receipts = CanonicalEventBus.prototype.enqueuePreparedBatch.call(
        internals.bus,
        Object.freeze([roomView.drafts]),
      );
      RoomTransitionAuthority.prototype.applyPreparedMutationAfterAppend.call(
        binding.roomTransition,
        roomProposal,
        internals.bus,
        receipts[0] as CanonicalEventBatchReceipt,
      );
      material.currentTick120 = validated.tick120;
      internals.pendingFlushTick120 = validated.tick120;
      const afterMaterial = carryover.snapshot();
      if (
        afterMaterial.poolUsage.liveColliders !== 0
        || afterMaterial.projectiles.some((projectile) =>
          projectile.state !== "residue" || projectile.collisionEnabled)
        || (policy.requireDrained && !afterMaterial.drained)
      ) {
        throw new Error(`${policy.label} material produced gameplay-capable state`);
      }
      const afterOverride = internals.override.snapshot();
      if (
        policy.requireOverrideQuiescent
        && (
        afterOverride.state !== "idle"
        || afterOverride.deadlineTick120 !== null
        || afterOverride.localVoid !== null
        )
      ) {
        throw new Error(`${policy.label} advanced a non-quiescent Override state`);
      }
      binding.expectedFlushTick120 = validated.tick120;
      binding.expectedPendingEventCount = internals.bus.pendingEventCount();
      return Object.freeze({
        runCombat: runState.snapshot(),
        material: afterMaterial,
      });
    } catch (error) {
      internals.fault = error instanceof Error ? error : new Error(String(error));
      throw error;
    }
  } finally {
    internals.advanceLocked = false;
  }
}

export interface CanonicalRunFirstContinuationSuccessorReadStartResult {
  readonly runCombat: CanonicalRunCombatStateSnapshot;
  readonly material: CanonicalRoomThresholdMaterialCarryoverSnapshot;
  readonly combat: CanonicalCombatSnapshot;
  readonly flushedEvents: readonly CanonicalGameplayEvent[];
}

export interface CanonicalRunFirstContinuationSuccessorBoundaryTicks {
  readonly handoffTick120: number;
  readonly telegraphStartTick120: number;
  readonly entryStartTick120: number;
  readonly readStartTick120: number;
  readonly materialSettleStartTick120: number;
  readonly restStartTick120: number;
  readonly sliceCompleteTick120: number;
}

function successorBoundaryTicks(
  plan: CanonicalRunFirstContinuationRoomPlanPayload,
): Readonly<CanonicalRunFirstContinuationSuccessorBoundaryTicks> {
  const handoffTick120 = requireSafeTick(
    plan.plannedAtTick120,
    "successor handoff boundary",
  );
  const safeBoundary = (relativeTick120: number, path: string): number =>
    requireSafeTick(plan.plannedAtTick120 + relativeTick120, path);
  const readRelativeTick120 = crossedTickCount(
    plan.occurrence.segmentsMs.telegraph + plan.occurrence.segmentsMs.entry,
  );
  const readStartTick120 = safeBoundary(readRelativeTick120, "successor READ boundary");
  const readLocalBoundary = (cumulativeMs: number, path: string): number =>
    requireSafeTick(readStartTick120 + crossedTickCount(cumulativeMs), path);
  const boundaries = Object.freeze({
    handoffTick120,
    telegraphStartTick120: safeBoundary(1, "successor telegraph boundary"),
    entryStartTick120: safeBoundary(
      crossedTickCount(plan.occurrence.segmentsMs.telegraph),
      "successor entry boundary",
    ),
    readStartTick120,
    materialSettleStartTick120: readLocalBoundary(
      plan.occurrence.segmentsMs.read,
      "successor material-settle boundary",
    ),
    restStartTick120: readLocalBoundary(
      plan.occurrence.segmentsMs.read + plan.occurrence.segmentsMs.materialSettle,
      "successor rest boundary",
    ),
    sliceCompleteTick120: readLocalBoundary(
      plan.occurrence.segmentsMs.read
        + plan.occurrence.segmentsMs.materialSettle
        + plan.occurrence.segmentsMs.rest,
      "successor slice-complete boundary",
    ),
  });
  if (
    boundaries.entryStartTick120 !== handoffTick120 + 63
    || boundaries.readStartTick120 !== handoffTick120 + 159
    || boundaries.materialSettleStartTick120 <= boundaries.readStartTick120
    || boundaries.restStartTick120 <= boundaries.materialSettleStartTick120
    || boundaries.sliceCompleteTick120 <= boundaries.restStartTick120
  ) {
    throw new Error("first continuation successor segment boundaries drifted");
  }
  return boundaries;
}

/**
 * Closes H+159 as the sole body/material/room tick, flushes it, then installs
 * the already-planned READ kernel into the same continuation binding.
 */
export function startCanonicalRunFirstContinuationSuccessorRead(
  runState: CanonicalRunCombatState,
  eventBus: CanonicalEventBus,
  carryover: CanonicalRoomThresholdMaterialCarryover,
  successorOwner: object,
  input: CanonicalCombatStepInput,
): CanonicalRunFirstContinuationSuccessorReadStartResult {
  if (!isExactCanonicalRunCombatState(runState)) {
    throw new Error("successor READ start requires an exact CanonicalRunCombatState");
  }
  if (!isExactCanonicalEventBus(eventBus)) {
    throw new Error("successor READ start requires the exact canonical event bus");
  }
  const binding = EXT013_ROOM_THRESHOLD_RUN_BINDINGS.get(runState);
  const materialRecord = ROOM_THRESHOLD_MATERIAL_CARRYOVERS.get(carryover);
  const internals = runCombatStateInternals(runState);
  const plan = binding?.successorPlan ?? null;
  const reservation = binding?.successorReservation ?? null;
  if (
    binding?.phase !== "successor-pre-read"
    || binding.carryover !== carryover
    || binding.successorOwner !== successorOwner
    || binding.successorKernel !== null
    || binding.successorFinalCombat !== null
    || plan === null
    || reservation === null
    || materialRecord?.runState !== runState
    || internals.bus !== eventBus
    || binding.expectedFlushTick120 !== null
    || binding.expectedPendingEventCount !== null
  ) {
    throw new Error("successor READ start lost its exact pre-READ owner lease");
  }
  const boundaries = successorBoundaryTicks(plan);
  const readStartTick120 = boundaries.readStartTick120;
  if (
    !Number.isSafeInteger(readStartTick120)
    || internals.currentTick120 !== readStartTick120 - 1
  ) {
    throw new Error("successor READ start requires the exact H+158 boundary");
  }
  inspectCanonicalRunFirstContinuationDormantSuccessorBinding(
    runState,
    eventBus,
    carryover,
    successorOwner,
  );
  const validated = validateCombatStepAgainstRunState(input, internals);
  if (
    validated.tick120 !== readStartTick120
    || validated.overridePressed
    || validated.overrideReleased
  ) {
    throw new Error("successor READ start requires exact H+159 input with Override locked");
  }
  const runBefore = runState.snapshot();
  const kernel = new CanonicalCombatKernel({
    patternId: plan.occurrence.patternId,
    occurrenceId: plan.occurrence.occurrenceId,
    seed: plan.occurrence.resolvedSeed.value,
    startTick120: readStartTick120,
    roomId: plan.targetRoom,
    difficulty: plan.occurrence.difficulty,
    initialPlayerPosition: validated.playerPosition,
    grazeRadiusPx: runBefore.adapterPolicy.grazeRadiusPx,
    projectileDamage: runBefore.adapterPolicy.projectileDamage,
    projectilePoolClasses: runBefore.adapterPolicy.projectilePoolClasses,
  },
  runState,
  DEFERRED_FIRST_CONTINUATION_READ_INSTALL,
  successorProjectilePoolBudgets(reservation),
  );
  let authoritativeTickAccepted = false;
  try {
    advanceCanonicalRunIdleWithContinuationMaterial(
      runState,
      carryover,
      input,
      binding.targetRoom,
      binding,
      materialRecord,
      Object.freeze({
        label: "successor READ start",
        requireDrained: false,
        requireOverrideQuiescent: true,
        latestTick120: readStartTick120,
      }),
    );
    authoritativeTickAccepted = true;
    const flushedEvents = runState.flushTick(readStartTick120);
    if (flushedEvents.some((event) =>
      event.id !== "projectile.residue.remove"
      && event.id !== "projectile.lifecycle.complete")) {
      throw new Error("successor READ start emitted a non-material pre-READ event");
    }
    kernel[DEFERRED_FIRST_CONTINUATION_READ_INSTALL](
      runState,
      successorOwner,
      plan,
      reservation,
    );
    const combat = kernel.snapshot();
    const runCombat = runState.snapshot();
    const material = carryover.snapshot();
    if (
      combat.tick120 !== readStartTick120
      || combat.relativeTick120 !== 0
      || combat.projectiles.length !== 0
      || combat.poolUsage.liveColliders !== 0
      || runCombat.tick120 !== readStartTick120
      || runCombat.activeOccurrenceId !== plan.occurrence.occurrenceId
      || runCombat.pendingFlushTick120 !== null
      || material.tick120 !== readStartTick120
      || material.poolUsage.liveColliders !== 0
    ) {
      throw new Error("successor READ start did not install an empty local-tick-zero kernel");
    }
    return Object.freeze({runCombat, material, combat, flushedEvents});
  } catch (error) {
    if (authoritativeTickAccepted && internals.fault === null) {
      internals.fault = error instanceof Error ? error : new Error(String(error));
    }
    throw error;
  }
}

export interface CanonicalRunFirstContinuationSuccessorReadTickResult {
  readonly runCombat: CanonicalRunCombatStateSnapshot;
  readonly material: CanonicalRoomThresholdMaterialCarryoverSnapshot;
  readonly combat: CanonicalCombatSnapshot;
  readonly flushedEvents: readonly CanonicalGameplayEvent[];
}

/**
 * Advance the successor combat, old collisionless material, target-room FSM,
 * player state, and shared event bus as one exact READ tick.
 */
export function advanceCanonicalRunFirstContinuationSuccessorReadTick(
  runState: CanonicalRunCombatState,
  eventBus: CanonicalEventBus,
  carryover: CanonicalRoomThresholdMaterialCarryover,
  successorOwner: object,
  input: CanonicalCombatStepInput,
): CanonicalRunFirstContinuationSuccessorReadTickResult {
  if (!isExactCanonicalRunCombatState(runState)) {
    throw new Error("successor READ advance requires an exact CanonicalRunCombatState");
  }
  if (!isExactCanonicalEventBus(eventBus)) {
    throw new Error("successor READ advance requires the exact canonical event bus");
  }
  const binding = EXT013_ROOM_THRESHOLD_RUN_BINDINGS.get(runState);
  const materialRecord = ROOM_THRESHOLD_MATERIAL_CARRYOVERS.get(carryover);
  const internals = runCombatStateInternals(runState);
  const plan = binding?.successorPlan ?? null;
  const reservation = binding?.successorReservation ?? null;
  const kernel = binding?.successorKernel ?? null;
  if (
    binding?.phase !== "successor-read"
    || binding.carryover !== carryover
    || binding.successorOwner !== successorOwner
    || plan === null
    || reservation === null
    || kernel === null
    || binding.successorFinalCombat !== null
    || materialRecord?.runState !== runState
    || internals.bus !== eventBus
    || binding.expectedFlushTick120 !== null
    || binding.expectedPendingEventCount !== null
  ) {
    throw new Error("successor READ advance lost its exact active owner lease");
  }
  if (internals.advanceLocked) {
    throw new Error("successor READ advance is already in progress");
  }
  internals.advanceLocked = true;
  let authoritativeTickAccepted = false;
  try {
    assertRunCombatStateOperational(internals);
    if (
      internals.pendingFlushTick120 !== null
      || internals.pendingReleaseOccurrenceId !== null
      || internals.activeOccurrenceId !== reservation.occurrenceId
      || internals.bus.pendingEventCount() !== 0
    ) {
      throw new Error("successor READ advance requires its flushed active occurrence boundary");
    }
    inspectCanonicalRunFirstContinuationDormantSuccessorBinding(
      runState,
      eventBus,
      carryover,
      successorOwner,
    );
    const validated = validateCombatStepAgainstRunState(input, internals);
    if (validated.overridePressed || validated.overrideReleased) {
      throw new Error("successor READ cannot admit an Override edge before Local Resistance");
    }
    const beforeMaterial = carryover.snapshot();
    const beforeCombat = CanonicalCombatKernel.prototype.snapshot.call(kernel);
    const beforeRoom = RoomTransitionAuthority.prototype.snapshot.call(binding.roomTransition);
    if (
      beforeCombat.tick120 !== internals.currentTick120
      || beforeCombat.patternId !== reservation.patternId
      || beforeCombat.occurrenceId !== reservation.occurrenceId
      || beforeMaterial.tick120 !== internals.currentTick120
      || beforeMaterial.poolUsage.liveColliders !== 0
      || beforeMaterial.projectiles.some((projectile) =>
        projectile.state !== "residue" || projectile.collisionEnabled)
      || !successorPoolUsageFitsReservation(beforeMaterial, beforeCombat, reservation)
      || binding.materialRoomEventCount === null
      || beforeRoom.tick120 !== internals.currentTick120
      || beforeRoom.state !== "idle"
      || beforeRoom.currentRoom !== binding.targetRoom
      || beforeRoom.targetRoom !== null
      || beforeRoom.generation !== 1
      || beforeRoom.eventCount !== binding.materialRoomEventCount
      || beforeRoom.active !== null
    ) {
      throw new Error("successor READ authorities lost their sealed pre-tick boundary");
    }
    const roomProposal = RoomTransitionAuthority.prototype.prepareAdvance.call(
      binding.roomTransition,
      validated.tick120,
    );
    const roomView = RoomTransitionAuthority.prototype.validatePreparedMutation.call(
      binding.roomTransition,
      roomProposal,
      internals.bus,
    );
    if (
      roomView.kind !== "advance"
      || roomView.eventBus !== internals.bus
      || roomView.tick120 !== validated.tick120
      || roomView.drafts.length !== 0
      || roomView.preview.tick120 !== validated.tick120
      || roomView.preview.state !== "idle"
      || roomView.preview.currentRoom !== binding.targetRoom
      || roomView.preview.targetRoom !== null
      || roomView.preview.generation !== 1
      || roomView.preview.eventCount !== binding.materialRoomEventCount
      || roomView.preview.active !== null
    ) {
      throw new Error("successor READ target-room FSM proposal drifted");
    }

    const combat = kernel[SEALED_FIRST_CONTINUATION_READ_ADVANCE](successorOwner, input);
    authoritativeTickAccepted = true;
    materialRecord.projectiles.advanceTo(validated.tick120);
    const receipts = CanonicalEventBus.prototype.enqueuePreparedBatch.call(
      internals.bus,
      Object.freeze([roomView.drafts]),
    );
    RoomTransitionAuthority.prototype.applyPreparedMutationAfterAppend.call(
      binding.roomTransition,
      roomProposal,
      internals.bus,
      receipts[0] as CanonicalEventBatchReceipt,
    );
    materialRecord.currentTick120 = validated.tick120;
    const material = carryover.snapshot();
    const room = RoomTransitionAuthority.prototype.snapshot.call(binding.roomTransition);
    const releasesOccurrence = combat.digitalBodiesDrained;
    if (
      combat.tick120 !== validated.tick120
      || combat.patternId !== reservation.patternId
      || combat.occurrenceId !== reservation.occurrenceId
      || internals.currentTick120 !== validated.tick120
      || internals.pendingFlushTick120 !== validated.tick120
      || internals.activeOccurrenceId !== reservation.occurrenceId
      || (releasesOccurrence
        ? internals.pendingReleaseOccurrenceId !== reservation.occurrenceId
          || !combat.patternComplete
          || combat.poolUsage.liveColliders !== 0
          || combat.projectiles.some((projectile) =>
            projectile.state !== "residue" || projectile.collisionEnabled)
        : internals.pendingReleaseOccurrenceId !== null)
      || material.tick120 !== validated.tick120
      || material.poolUsage.liveColliders !== 0
      || material.projectiles.some((projectile) =>
        projectile.state !== "residue" || projectile.collisionEnabled)
      || !successorPoolUsageFitsReservation(material, combat, reservation)
      || room.tick120 !== validated.tick120
      || room.state !== "idle"
      || room.currentRoom !== binding.targetRoom
      || room.targetRoom !== null
      || room.generation !== 1
      || room.eventCount !== binding.materialRoomEventCount
      || room.active !== null
    ) {
      throw new Error("successor READ tick lost combat/material/room synchronization");
    }
    if (releasesOccurrence) binding.phase = "successor-release-requested";
    binding.expectedFlushTick120 = validated.tick120;
    binding.expectedPendingEventCount = internals.bus.pendingEventCount();
    const flushedEvents = runState.flushTick(validated.tick120);
    const runCombat = runState.snapshot();
    if (
      runCombat.tick120 !== validated.tick120
      || runCombat.pendingFlushTick120 !== null
      || (releasesOccurrence
        ? runCombat.activeOccurrenceId !== null
        : runCombat.activeOccurrenceId !== reservation.occurrenceId)
      || eventBus.pendingEventCount() !== 0
    ) {
      throw new Error("successor READ tick did not close its sole Run-owned flush");
    }
    if (releasesOccurrence) {
      binding.successorFinalCombat = combat;
      binding.phase = "successor-tail";
    }
    return Object.freeze({runCombat, material, combat, flushedEvents});
  } catch (error) {
    if (authoritativeTickAccepted && internals.fault === null) {
      internals.fault = error instanceof Error ? error : new Error(String(error));
    }
    throw error;
  } finally {
    internals.advanceLocked = false;
  }
}

export interface CanonicalRunFirstContinuationSuccessorTailTickResult {
  readonly runCombat: CanonicalRunCombatStateSnapshot;
  readonly material: CanonicalRoomThresholdMaterialCarryoverSnapshot;
  readonly combat: CanonicalCombatSnapshot;
  readonly flushedEvents: readonly CanonicalGameplayEvent[];
  readonly sliceComplete: boolean;
}

export function advanceCanonicalRunFirstContinuationSuccessorTailTick(
  runState: CanonicalRunCombatState,
  eventBus: CanonicalEventBus,
  carryover: CanonicalRoomThresholdMaterialCarryover,
  successorOwner: object,
  input: CanonicalCombatStepInput,
  mode: "advance" | "close" | "hold",
): CanonicalRunFirstContinuationSuccessorTailTickResult {
  if (!isExactCanonicalRunCombatState(runState)) {
    throw new Error("successor tail requires an exact CanonicalRunCombatState");
  }
  if (!isExactCanonicalEventBus(eventBus)) {
    throw new Error("successor tail requires the exact canonical event bus");
  }
  if (mode !== "advance" && mode !== "close" && mode !== "hold") {
    throw new Error("successor tail requires an exact advance, close, or hold mode");
  }
  const binding = EXT013_ROOM_THRESHOLD_RUN_BINDINGS.get(runState);
  const materialRecord = ROOM_THRESHOLD_MATERIAL_CARRYOVERS.get(carryover);
  const internals = runCombatStateInternals(runState);
  const plan = binding?.successorPlan ?? null;
  const reservation = binding?.successorReservation ?? null;
  const kernel = binding?.successorKernel ?? null;
  const combat = binding?.successorFinalCombat ?? null;
  if (
    binding === undefined
    || (mode === "hold"
      ? binding.phase !== "successor-complete"
      : binding.phase !== "successor-tail")
    || binding.carryover !== carryover
    || binding.successorOwner !== successorOwner
    || plan === null
    || reservation === null
    || kernel === null
    || combat === null
    || !combat.patternComplete
    || !combat.digitalBodiesDrained
    || combat.poolUsage.liveColliders !== 0
    || combat.projectiles.some((projectile) =>
      projectile.state !== "residue" || projectile.collisionEnabled)
    || combat.tick120 !== internals.currentTick120
    || materialRecord?.runState !== runState
    || internals.bus !== eventBus
    || binding.expectedFlushTick120 !== null
    || binding.expectedPendingEventCount !== null
  ) {
    throw new Error("successor tail/hold lost its exact released occurrence owner");
  }
  const boundaries = successorBoundaryTicks(plan);
  const nextTick120 = requireSafeTick(internals.currentTick120 + 1, "successor tail next tick");
  if (
    (mode === "advance" && nextTick120 >= boundaries.sliceCompleteTick120)
    || (mode === "close" && nextTick120 !== boundaries.sliceCompleteTick120)
    || (mode === "hold" && internals.currentTick120 < boundaries.sliceCompleteTick120)
  ) {
    throw new Error(
      mode === "advance"
        ? "successor tail terminal boundary requires close"
        : mode === "close"
          ? "successor tail close requires the exact slice-complete boundary"
          : "successor complete hold requires a closed slice boundary",
    );
  }
  let authoritativeTickAccepted = false;
  try {
    const advanced = advanceCanonicalRunIdleWithContinuationMaterial(
      runState,
      carryover,
      input,
      binding.targetRoom,
      binding,
      materialRecord,
      Object.freeze({
        label: mode === "hold"
          ? "successor complete hold" as const
          : "successor tail" as const,
        requireDrained: mode === "hold",
        requireOverrideQuiescent: true,
        latestTick120: mode === "hold" ? null : boundaries.sliceCompleteTick120,
      }),
    );
    authoritativeTickAccepted = true;
    const successorMaterial = kernel[SEALED_FIRST_CONTINUATION_MATERIAL_ADVANCE](
      successorOwner,
      nextTick120,
    );
    binding.successorFinalCombat = successorMaterial;
    binding.expectedPendingEventCount = internals.bus.pendingEventCount();
    const flushedEvents = runState.flushTick(advanced.runCombat.tick120);
    const runCombat = runState.snapshot();
    const material = carryover.snapshot();
    if (
      runCombat.tick120 !== nextTick120
      || runCombat.pendingFlushTick120 !== null
      || runCombat.activeOccurrenceId !== null
      || eventBus.pendingEventCount() !== 0
      || material.tick120 !== nextTick120
      || material.poolUsage.liveColliders !== 0
      || successorMaterial.tick120 !== nextTick120
      || !successorMaterial.patternComplete
      || !successorMaterial.digitalBodiesDrained
      || successorMaterial.poolUsage.liveColliders !== 0
      || successorMaterial.projectiles.some((projectile) =>
        projectile.state !== "residue" || projectile.collisionEnabled)
      || !successorPoolUsageFitsReservation(material, successorMaterial, reservation)
    ) {
      throw new Error("successor tail/hold did not close its exact idle/material tick");
    }
    if (mode === "close") {
      if (
        !material.drained
        || material.projectiles.length !== 0
        || runCombat.override.state !== "idle"
        || runCombat.override.deadlineTick120 !== null
        || runCombat.override.localVoid !== null
      ) {
        throw new Error(
          "successor slice close requires drained prior carryover and locked Override",
        );
      }
      binding.phase = "successor-complete";
    }
    return Object.freeze({
      runCombat,
      material,
      combat: successorMaterial,
      flushedEvents,
      sliceComplete: mode !== "advance",
    });
  } catch (error) {
    if (authoritativeTickAccepted && internals.fault === null) {
      internals.fault = error instanceof Error ? error : new Error(String(error));
    }
    throw error;
  }
}

const DORMANT_SUCCESSOR_POOL_CLASS_ORDER = Object.freeze([
  "micro",
  "medium",
  "heavy",
  "splitChildren",
] as const satisfies readonly ProjectilePoolClass[]);

function successorProjectilePoolBudgets(
  reservation: CanonicalRunFirstContinuationDormantSuccessorReservation,
): ProjectilePoolBudgets {
  return Object.freeze({
    micro: reservation.projectilePoolClass === "micro"
      ? reservation.requestedProjectileSlots
      : 0,
    medium: reservation.projectilePoolClass === "medium"
      ? reservation.requestedProjectileSlots
      : 0,
    heavy: reservation.projectilePoolClass === "heavy"
      ? reservation.requestedProjectileSlots
      : 0,
    splitChildren: reservation.projectilePoolClass === "splitChildren"
      ? reservation.requestedProjectileSlots
      : 0,
    residueVisualOnly: reservation.requestedResidueVisualSlots,
  });
}

function successorPoolUsageFitsReservation(
  material: CanonicalRoomThresholdMaterialCarryoverSnapshot,
  combat: CanonicalCombatSnapshot,
  reservation: CanonicalRunFirstContinuationDormantSuccessorReservation,
): boolean {
  const successorBudgets = successorProjectilePoolBudgets(reservation);
  return DORMANT_SUCCESSOR_POOL_CLASS_ORDER.every((poolClass) =>
    combat.poolUsage.active[poolClass] <= successorBudgets[poolClass]
      && combat.poolUsage.allocatedSlots[poolClass] <= successorBudgets[poolClass]
      && material.poolUsage.allocatedSlots[poolClass]
        + combat.poolUsage.allocatedSlots[poolClass]
        <= reservation.combinedAllocatedSlots[poolClass])
    && combat.poolUsage.residueVisuals <= successorBudgets.residueVisualOnly
    && material.poolUsage.residueVisuals + combat.poolUsage.residueVisuals
      <= reservation.combinedResidueVisuals;
}

function requireDormantSuccessorTransferCapability(
  capability: CanonicalRunFirstContinuationDormantSuccessorTransferCapability,
  expectedStatus: DormantSuccessorTransferCapabilityRecord["status"],
): DormantSuccessorTransferCapabilityRecord {
  if (typeof capability !== "object" || capability === null) {
    throw new Error("dormant successor transfer capability must be opaque");
  }
  const record = DORMANT_SUCCESSOR_TRANSFER_CAPABILITIES.get(capability);
  if (record === undefined) {
    throw new Error("dormant successor transfer capability is not registered");
  }
  if (record.status !== expectedStatus) {
    throw new Error(`dormant successor transfer capability is ${record.status}`);
  }
  return record;
}

/** Bind the exact EXT-013 start capability to its one opaque handoff receipt. */
export function bindCanonicalRunFirstContinuationDormantSuccessorTransferCapability(
  capability: CanonicalRunFirstContinuationDormantSuccessorTransferCapability,
  formalTarget: CanonicalRunFirstContinuationRoomTargetAvailable,
  runState: CanonicalRunCombatState,
  eventBus: CanonicalEventBus,
  roomTransition: RoomTransitionAuthority,
  carryover: CanonicalRoomThresholdMaterialCarryover,
  handoffReceipt: object,
): void {
  const capabilityRecord = requireDormantSuccessorTransferCapability(
    capability,
    "transition",
  );
  const binding = EXT013_ROOM_THRESHOLD_RUN_BINDINGS.get(runState);
  const materialRecord = ROOM_THRESHOLD_MATERIAL_CARRYOVERS.get(carryover);
  const internals = runCombatStateInternals(runState);
  const room = RoomTransitionAuthority.prototype.snapshot.call(roomTransition);
  const material = carryover.snapshot();
  if (
    capabilityRecord.runState !== runState
    || capabilityRecord.kernel !== binding?.kernel
    || capabilityRecord.formalTarget !== formalTarget
    || binding.formalTarget !== formalTarget
    || binding.successorTransferCapability !== capability
    || (binding.phase !== "material" && binding.phase !== "target-room-idle")
    || binding.roomTransition !== roomTransition
    || binding.carryover !== carryover
    || binding.successorOwner !== null
    || binding.successorReservation !== null
    || binding.successorPlan !== null
    || binding.successorKernel !== null
    || binding.successorFinalCombat !== null
    || materialRecord?.runState !== runState
    || internals.bus !== eventBus
    || internals.pendingFlushTick120 !== null
    || internals.activeOccurrenceId !== null
    || eventBus.pendingEventCount() !== 0
    || room.tick120 !== internals.currentTick120
    || room.currentRoom !== formalTarget.targetRoom
    || room.state !== "idle"
    || room.active !== null
    || material.tick120 !== internals.currentTick120
    || material.poolUsage.liveColliders !== 0
    || typeof handoffReceipt !== "object"
    || handoffReceipt === null
    || !Object.isFrozen(handoffReceipt)
    || Reflect.ownKeys(handoffReceipt).length !== 0
  ) {
    throw new Error("dormant successor transfer capability lost its exact handoff lineage");
  }
  capabilityRecord.status = "handoff";
  capabilityRecord.handoffReceipt = handoffReceipt;
  capabilityRecord.handoffTick120 = material.tick120;
  capabilityRecord.carryover = carryover;
}

function captureDormantSuccessorReservation(
  value: CanonicalRunFirstContinuationDormantSuccessorReservation,
): CanonicalRunFirstContinuationDormantSuccessorReservation {
  const captured = ownPlainDataRecord(
    value as unknown as Readonly<Record<string, unknown>>,
    [
      "authority",
      "extensionPolicy",
      "admittedAtTick120",
      "targetRoom",
      "occurrenceId",
      "patternId",
      "difficulty",
      "projectileArchetypeId",
      "projectilePoolClass",
      "requestedProjectileSlots",
      "requestedResidueVisualSlots",
      "emitterCount",
      "maxEmitters",
      "combinedAllocatedSlots",
      "combinedResidueVisuals",
    ],
    "dormant successor reservation",
  );
  if (
    captured.authority !== "canonical-run-first-continuation-dormant-successor-reservation-v1"
    || captured.extensionPolicy !== "EXT-2026-015"
  ) {
    throw new Error("dormant successor reservation identity drifted");
  }
  const admittedAtTick120 = requireSafeTick(
    captured.admittedAtTick120 as number,
    "dormant successor reservation admittedAtTick120",
  );
  const targetRoom = captured.targetRoom;
  if (!FIRST_CONTINUATION_ROOM_THRESHOLD_TARGETS.includes(
    targetRoom as CanonicalRunRoomThresholdTargetRoom,
  )) {
    throw new Error("dormant successor reservation target is not authored");
  }
  const occurrenceId = requireUnicodeScalarString(
    captured.occurrenceId,
    "dormant successor reservation occurrenceId",
  );
  const patternId = requireUnicodeScalarString(
    captured.patternId,
    "dormant successor reservation patternId",
  );
  if (occurrenceId !== `run:room:1:encounter:0:${patternId}`) {
    throw new Error("dormant successor reservation occurrence identity drifted");
  }
  const difficulty = captured.difficulty;
  if (!(["EASY", "NORMAL", "HARD"] as const).includes(difficulty as PatternDifficulty)) {
    throw new Error("dormant successor reservation difficulty is not canonical");
  }
  const projectileArchetypeId = requireUnicodeScalarString(
    captured.projectileArchetypeId,
    "dormant successor reservation projectileArchetypeId",
  );
  const projectilePoolClass = captured.projectilePoolClass;
  if (!DORMANT_SUCCESSOR_POOL_CLASS_ORDER.includes(projectilePoolClass as ProjectilePoolClass)) {
    throw new Error("dormant successor reservation pool class is not canonical");
  }
  const requestedProjectileSlots = requirePositiveInteger(
    captured.requestedProjectileSlots as number,
    "dormant successor reservation requestedProjectileSlots",
  );
  const requestedResidueVisualSlots = requirePositiveInteger(
    captured.requestedResidueVisualSlots as number,
    "dormant successor reservation requestedResidueVisualSlots",
  );
  const emitterCount = requirePositiveInteger(
    captured.emitterCount as number,
    "dormant successor reservation emitterCount",
  );
  const maxEmitters = requirePositiveInteger(
    captured.maxEmitters as number,
    "dormant successor reservation maxEmitters",
  );
  if (emitterCount > maxEmitters) {
    throw new Error("dormant successor reservation exceeds its emitter capacity");
  }
  const rawCombined = ownPlainDataRecord(
    captured.combinedAllocatedSlots as Readonly<Record<string, unknown>>,
    DORMANT_SUCCESSOR_POOL_CLASS_ORDER,
    "dormant successor reservation combinedAllocatedSlots",
  );
  const combinedAllocatedSlots = Object.freeze(Object.fromEntries(
    DORMANT_SUCCESSOR_POOL_CLASS_ORDER.map((poolClass) => {
      const count = requireNonNegativeInteger(
        rawCombined[poolClass] as number,
        `dormant successor reservation combinedAllocatedSlots.${poolClass}`,
      );
      if (count > PROJECTILE_POOL_BUDGETS[poolClass]) {
        throw new Error(`dormant successor reservation exceeds ${poolClass} capacity`);
      }
      return [poolClass, count];
    }),
  )) as Readonly<Record<ProjectilePoolClass, number>>;
  const combinedResidueVisuals = requireNonNegativeInteger(
    captured.combinedResidueVisuals as number,
    "dormant successor reservation combinedResidueVisuals",
  );
  if (combinedResidueVisuals > PROJECTILE_POOL_BUDGETS.residueVisualOnly) {
    throw new Error("dormant successor reservation exceeds residue visual capacity");
  }
  return Object.freeze({
    authority: "canonical-run-first-continuation-dormant-successor-reservation-v1" as const,
    extensionPolicy: "EXT-2026-015" as const,
    admittedAtTick120,
    targetRoom: targetRoom as CanonicalRunRoomThresholdTargetRoom,
    occurrenceId,
    patternId,
    difficulty: difficulty as PatternDifficulty,
    projectileArchetypeId,
    projectilePoolClass: projectilePoolClass as ProjectilePoolClass,
    requestedProjectileSlots,
    requestedResidueVisualSlots,
    emitterCount,
    maxEmitters,
    combinedAllocatedSlots,
    combinedResidueVisuals,
  });
}

function sameDormantSuccessorJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function reservationFromFormalCombinedAdmission(
  plan: CanonicalRunFirstContinuationRoomPlanPayload,
  evaluation: CanonicalRunFirstContinuationCombinedPoolAdmissionEvaluation,
): CanonicalRunFirstContinuationDormantSuccessorReservation {
  if (
    !evaluation.admissible
    || evaluation.state !== "admissible"
    || evaluation.poolClassResolution.state !== "resolved"
    || evaluation.successor.reservationByClass === null
    || evaluation.combined === null
  ) {
    throw new Error("formal combined pool admission did not produce a reservation");
  }
  return captureDormantSuccessorReservation(Object.freeze({
    authority: "canonical-run-first-continuation-dormant-successor-reservation-v1" as const,
    extensionPolicy: "EXT-2026-015" as const,
    admittedAtTick120: plan.plannedAtTick120,
    targetRoom: plan.targetRoom,
    occurrenceId: plan.occurrence.occurrenceId,
    patternId: plan.occurrence.patternId,
    difficulty: plan.occurrence.difficulty,
    projectileArchetypeId: evaluation.poolClassResolution.archetypeId,
    projectilePoolClass: evaluation.poolClassResolution.poolClass,
    requestedProjectileSlots: evaluation.successor.requestedProjectileSlots,
    requestedResidueVisualSlots: evaluation.successor.requestedResidueVisualSlots,
    emitterCount: evaluation.successor.emitterCount,
    maxEmitters: evaluation.successor.maxEmitters,
    combinedAllocatedSlots: evaluation.combined.allocatedSlots,
    combinedResidueVisuals: evaluation.combined.residueVisuals,
  }));
}

function validateDormantSuccessorTransferBoundary(
  runState: CanonicalRunCombatState,
  eventBus: CanonicalEventBus,
  carryover: CanonicalRoomThresholdMaterialCarryover,
  successorOwner: object,
  reservation: CanonicalRunFirstContinuationDormantSuccessorReservation,
): Readonly<{
  readonly binding: Ext013RoomThresholdRunBinding;
  readonly material: CanonicalRoomThresholdMaterialCarryoverSnapshot;
}> {
  if (!isExactCanonicalRunCombatState(runState)) {
    throw new Error("dormant successor transfer requires an exact CanonicalRunCombatState");
  }
  if (!isExactCanonicalEventBus(eventBus)) {
    throw new Error("dormant successor transfer requires the exact canonical event bus");
  }
  if (
    typeof successorOwner !== "object"
    || successorOwner === null
    || Object.getPrototypeOf(successorOwner) !== Object.prototype
    || !Object.isFrozen(successorOwner)
    || Reflect.ownKeys(successorOwner).length !== 0
  ) {
    throw new Error("dormant successor transfer owner must be opaque");
  }
  const materialRecord = ROOM_THRESHOLD_MATERIAL_CARRYOVERS.get(carryover);
  if (materialRecord === undefined || materialRecord.runState !== runState) {
    throw new Error("dormant successor transfer requires the exact material owner");
  }
  const binding = EXT013_ROOM_THRESHOLD_RUN_BINDINGS.get(runState);
  if (
    (binding?.phase !== "material" && binding?.phase !== "target-room-idle")
    || binding.carryover !== carryover
    || binding.successorOwner !== null
    || binding.successorReservation !== null
    || binding.successorPlan !== null
    || binding.successorKernel !== null
    || binding.successorFinalCombat !== null
    || binding.expectedFlushTick120 !== null
    || binding.expectedPendingEventCount !== null
    || binding.kernel[ROOM_THRESHOLD_RUN_STATE_PROOF]() !== runState
  ) {
    throw new Error("dormant successor transfer lost the exact flushed EXT-013 binding");
  }
  const internals = runCombatStateInternals(runState);
  assertRunCombatStateOperational(internals);
  if (
    internals.bus !== eventBus
    || internals.advanceLocked
    || internals.activeOccurrenceId !== null
    || internals.pendingReleaseOccurrenceId !== null
    || internals.pendingFlushTick120 !== null
    || internals.bus.pendingEventCount() !== 0
  ) {
    throw new Error("dormant successor transfer requires an empty flushed Run boundary");
  }
  const material = carryover.snapshot();
  const room = RoomTransitionAuthority.prototype.snapshot.call(binding.roomTransition);
  const player = internals.player.snapshot();
  const override = internals.override.snapshot();
  if (
    material.tick120 !== internals.currentTick120
    || material.poolUsage.liveColliders !== 0
    || material.poolUsage.residueVisuals !== material.materialCount
    || room.tick120 !== internals.currentTick120
    || room.state !== "idle"
    || room.currentRoom !== binding.targetRoom
    || room.targetRoom !== null
    || room.generation !== 1
    || room.active !== null
    || binding.materialRoomEventCount === null
    || room.eventCount !== binding.materialRoomEventCount
    || player.tick120 !== internals.currentTick120
    || player.state !== "alive"
    || player.collisionEnabled !== true
    || player.activeLeases.length !== 0
    || player.recoveryAtTick120 !== null
    || player.respawnPlaceAtTick120 !== null
    || player.respawnCompleteAtTick120 !== null
    || override.state !== "idle"
    || override.deadlineTick120 !== null
    || override.localVoid !== null
  ) {
    throw new Error("dormant successor transfer boundary is not alive, quiescent, and collisionless");
  }
  if (
    reservation.admittedAtTick120 !== internals.currentTick120
    || reservation.targetRoom !== binding.targetRoom
    || internals.adapterPolicy.projectilePoolClasses[reservation.projectileArchetypeId]
      !== reservation.projectilePoolClass
    || reservation.combinedResidueVisuals
      !== material.poolUsage.residueVisuals + reservation.requestedResidueVisualSlots
  ) {
    throw new Error("dormant successor reservation is stale or belongs to another Run boundary");
  }
  for (const poolClass of DORMANT_SUCCESSOR_POOL_CLASS_ORDER) {
    const expected = material.poolUsage.allocatedSlots[poolClass]
      + (poolClass === reservation.projectilePoolClass
        ? reservation.requestedProjectileSlots
        : 0);
    if (reservation.combinedAllocatedSlots[poolClass] !== expected) {
      throw new Error(`dormant successor ${poolClass} reservation lost its carryover join`);
    }
  }
  return Object.freeze({binding, material});
}

function requirePreparedDormantSuccessorTransfer(
  proposal: PreparedCanonicalRunFirstContinuationDormantSuccessorTransfer,
  expectedStatus: PreparedDormantSuccessorTransferRecord["status"] = "prepared",
): PreparedDormantSuccessorTransferRecord {
  if (typeof proposal !== "object" || proposal === null) {
    throw new Error("dormant successor transfer proposal must be opaque");
  }
  const record = PREPARED_DORMANT_SUCCESSOR_TRANSFERS.get(proposal);
  if (record === undefined) {
    throw new Error("dormant successor transfer proposal is not registered");
  }
  if (record.status !== expectedStatus) {
    throw new Error(`dormant successor transfer proposal is ${record.status}`);
  }
  return record;
}

/** Prepare a zero-event replacement of the flushed EXT-013 material binding. */
export function prepareCanonicalRunFirstContinuationDormantSuccessorTransfer(
  capability: CanonicalRunFirstContinuationDormantSuccessorTransferCapability,
  handoffReceipt: object,
  runState: CanonicalRunCombatState,
  eventBus: CanonicalEventBus,
  carryover: CanonicalRoomThresholdMaterialCarryover,
  successorOwner: object,
): PreparedCanonicalRunFirstContinuationDormantSuccessorTransfer {
  if (ACTIVE_DORMANT_SUCCESSOR_TRANSFER_BY_RUN_STATE.has(runState)) {
    throw new Error("dormant successor transfer already has an in-flight proposal");
  }
  const capabilityRecord = requireDormantSuccessorTransferCapability(
    capability,
    "handoff",
  );
  const binding = EXT013_ROOM_THRESHOLD_RUN_BINDINGS.get(runState);
  const material = carryover.snapshot();
  if (
    capabilityRecord.runState !== runState
    || capabilityRecord.kernel !== binding?.kernel
    || capabilityRecord.formalTarget !== binding.formalTarget
    || capabilityRecord.handoffReceipt !== handoffReceipt
    || capabilityRecord.handoffTick120 === null
    || capabilityRecord.handoffTick120 !== material.tick120
    || capabilityRecord.carryover !== carryover
    || binding.successorTransferCapability !== capability
  ) {
    throw new Error("dormant successor transfer capability is not the exact handoff proof");
  }
  const source = deriveCanonicalRunFirstContinuationRoomPlanSourceUnbranded(
    capabilityRecord.formalTarget,
    Object.freeze({
      targetRoom: capabilityRecord.formalTarget.targetRoom,
      atTick120: capabilityRecord.handoffTick120,
    }),
    material,
  );
  const plan = deriveCanonicalRunFirstContinuationRoomPlanUnbranded(source);
  const evaluation = evaluateCanonicalRunFirstContinuationCombinedPoolAdmissionUnbranded(
    plan,
    runState.snapshot().adapterPolicy.projectilePoolClasses,
  );
  if (!evaluation.admissible || evaluation.state !== "admissible") {
    throw new Error(`dormant successor formal admission is ${evaluation.state}`);
  }
  const reservation = reservationFromFormalCombinedAdmission(plan, evaluation);
  const boundary = validateDormantSuccessorTransferBoundary(
    runState,
    eventBus,
    carryover,
    successorOwner,
    reservation,
  );
  const proposal = Object.freeze({}) as
    PreparedCanonicalRunFirstContinuationDormantSuccessorTransfer;
  const view = Object.freeze({
    authority: "canonical-run-first-continuation-dormant-successor-transfer-v1" as const,
    extensionPolicy: "EXT-2026-015" as const,
    tick120: reservation.admittedAtTick120,
    targetRoom: reservation.targetRoom,
    occurrenceId: reservation.occurrenceId,
    patternId: reservation.patternId,
    plan,
    combinedPoolAdmission: evaluation,
    materialCount: boundary.material.materialCount,
    materialDraining: !boundary.material.drained,
    liveColliders: 0 as const,
    canonicalEventWrites: 0 as const,
    tickAdvance: 0 as const,
  });
  PREPARED_DORMANT_SUCCESSOR_TRANSFERS.set(proposal, {
    capability,
    handoffReceipt,
    runState,
    eventBus,
    carryover,
    successorOwner,
    reservation,
    source,
    plan,
    evaluation,
    material: boundary.material,
    view,
    status: "prepared",
  });
  ACTIVE_DORMANT_SUCCESSOR_TRANSFER_BY_RUN_STATE.set(runState, proposal);
  capabilityRecord.status = "prepared";
  capabilityRecord.activeProposal = proposal;
  return proposal;
}

export function inspectPreparedCanonicalRunFirstContinuationDormantSuccessorTransfer(
  proposal: PreparedCanonicalRunFirstContinuationDormantSuccessorTransfer,
): PreparedCanonicalRunFirstContinuationDormantSuccessorTransferView {
  return requirePreparedDormantSuccessorTransfer(proposal).view;
}

/**
 * Atomically replaces the existing map entry; it never deletes the binding,
 * so generic occurrence claim cannot observe an unleased gap.
 */
export function commitPreparedCanonicalRunFirstContinuationDormantSuccessorTransfer(
  proposal: PreparedCanonicalRunFirstContinuationDormantSuccessorTransfer,
): void {
  const record = requirePreparedDormantSuccessorTransfer(proposal);
  const capabilityRecord = requireDormantSuccessorTransferCapability(
    record.capability,
    "prepared",
  );
  try {
    if (
      ACTIVE_DORMANT_SUCCESSOR_TRANSFER_BY_RUN_STATE.get(record.runState) !== proposal
      || capabilityRecord.activeProposal !== proposal
      || capabilityRecord.handoffReceipt !== record.handoffReceipt
      || capabilityRecord.carryover !== record.carryover
      || capabilityRecord.handoffTick120 === null
    ) {
      throw new Error("dormant successor transfer lost its exclusive reservation");
    }
    const boundary = validateDormantSuccessorTransferBoundary(
      record.runState,
      record.eventBus,
      record.carryover,
      record.successorOwner,
      record.reservation,
    );
    if (
      boundary.material.tick120 !== record.material.tick120
      || boundary.material.materialCount !== record.material.materialCount
      || boundary.material.drained !== record.material.drained
      || boundary.material.poolUsage.residueVisuals !== record.material.poolUsage.residueVisuals
      || DORMANT_SUCCESSOR_POOL_CLASS_ORDER.some((poolClass) =>
        boundary.material.poolUsage.active[poolClass] !== record.material.poolUsage.active[poolClass]
        || boundary.material.poolUsage.allocatedSlots[poolClass]
          !== record.material.poolUsage.allocatedSlots[poolClass])
    ) {
      throw new Error("dormant successor transfer material summary became stale");
    }
    const source = deriveCanonicalRunFirstContinuationRoomPlanSourceUnbranded(
      capabilityRecord.formalTarget,
      Object.freeze({
        targetRoom: capabilityRecord.formalTarget.targetRoom,
        atTick120: capabilityRecord.handoffTick120,
      }),
      boundary.material,
    );
    const plan = deriveCanonicalRunFirstContinuationRoomPlanUnbranded(source);
    const evaluation = evaluateCanonicalRunFirstContinuationCombinedPoolAdmissionUnbranded(
      plan,
      record.runState.snapshot().adapterPolicy.projectilePoolClasses,
    );
    if (
      !evaluation.admissible
      || !sameDormantSuccessorJson(source, record.source)
      || !sameDormantSuccessorJson(plan, record.plan)
      || !sameDormantSuccessorJson(evaluation, record.evaluation)
    ) {
      throw new Error("dormant successor formal plan or combined admission became stale");
    }
    boundary.binding.successorOwner = record.successorOwner;
    boundary.binding.successorReservation = record.reservation;
    boundary.binding.successorPlan = record.plan;
    boundary.binding.phase = "successor-dormant";
    record.status = "committed";
    capabilityRecord.status = "committed";
    capabilityRecord.activeProposal = null;
    ACTIVE_DORMANT_SUCCESSOR_TRANSFER_BY_RUN_STATE.delete(record.runState);
  } catch (error) {
    record.status = "failed";
    capabilityRecord.status = "handoff";
    capabilityRecord.activeProposal = null;
    ACTIVE_DORMANT_SUCCESSOR_TRANSFER_BY_RUN_STATE.delete(record.runState);
    throw error;
  }
}

export function cancelPreparedCanonicalRunFirstContinuationDormantSuccessorTransfer(
  proposal: PreparedCanonicalRunFirstContinuationDormantSuccessorTransfer,
): void {
  const record = requirePreparedDormantSuccessorTransfer(proposal);
  const capabilityRecord = requireDormantSuccessorTransferCapability(
    record.capability,
    "prepared",
  );
  if (
    ACTIVE_DORMANT_SUCCESSOR_TRANSFER_BY_RUN_STATE.get(record.runState) !== proposal
    || capabilityRecord.activeProposal !== proposal
  ) {
    throw new Error("dormant successor transfer lost its exclusive reservation");
  }
  record.status = "cancelled";
  capabilityRecord.status = "handoff";
  capabilityRecord.activeProposal = null;
  ACTIVE_DORMANT_SUCCESSOR_TRANSFER_BY_RUN_STATE.delete(record.runState);
}

export interface CanonicalRunFirstContinuationDormantSuccessorBindingSnapshot {
  readonly authority: "canonical-run-first-continuation-dormant-successor-binding-v1";
  readonly extensionPolicy: "EXT-2026-015";
  readonly terminalPolicy: "EXT-2026-016";
  readonly phase: "dormant" | "pre-read" | "read" | "tail" | "complete";
  readonly tick120: number;
  readonly boundaryTicks120: Readonly<CanonicalRunFirstContinuationSuccessorBoundaryTicks>;
  readonly admittedAtTick120: number;
  readonly targetRoom: CanonicalRunRoomThresholdTargetRoom;
  readonly plan: CanonicalRunFirstContinuationRoomPlanPayload;
  readonly reservation: CanonicalRunFirstContinuationDormantSuccessorReservation;
  readonly material: CanonicalRoomThresholdMaterialCarryoverSnapshot;
  readonly combat: CanonicalCombatSnapshot | null;
  readonly nextMasterTickAction:
    | "telegraph"
    | "continue-pre-read"
    | "claim-read"
    | "advance-read"
    | "advance-tail"
    | "close-slice"
    | "advance-complete-hold";
}

export function inspectCanonicalRunFirstContinuationDormantSuccessorBinding(
  runState: CanonicalRunCombatState,
  eventBus: CanonicalEventBus,
  carryover: CanonicalRoomThresholdMaterialCarryover,
  successorOwner: object,
): CanonicalRunFirstContinuationDormantSuccessorBindingSnapshot {
  if (!isExactCanonicalRunCombatState(runState)) {
    throw new Error("dormant successor inspection requires an exact Run state");
  }
  if (!isExactCanonicalEventBus(eventBus)) {
    throw new Error("dormant successor inspection requires the exact event bus");
  }
  const binding = EXT013_ROOM_THRESHOLD_RUN_BINDINGS.get(runState);
  const materialRecord = ROOM_THRESHOLD_MATERIAL_CARRYOVERS.get(carryover);
  if (
    (
      binding?.phase !== "successor-dormant"
      && binding?.phase !== "successor-pre-read"
      && binding?.phase !== "successor-read"
      && binding?.phase !== "successor-tail"
      && binding?.phase !== "successor-complete"
    )
    || binding.carryover !== carryover
    || binding.successorOwner !== successorOwner
    || binding.successorReservation === null
    || binding.successorPlan === null
    || (binding.phase === "successor-read"
      ? binding.successorKernel === null || binding.successorFinalCombat !== null
      : binding.phase === "successor-tail" || binding.phase === "successor-complete"
        ? binding.successorKernel === null || binding.successorFinalCombat === null
        : binding.successorKernel !== null || binding.successorFinalCombat !== null)
    || binding.expectedFlushTick120 !== null
    || binding.expectedPendingEventCount !== null
    || materialRecord?.runState !== runState
  ) {
    throw new Error("dormant successor owner lost its exact binding");
  }
  const internals = runCombatStateInternals(runState);
  const material = carryover.snapshot();
  const room = RoomTransitionAuthority.prototype.snapshot.call(binding.roomTransition);
  const player = internals.player.snapshot();
  const override = internals.override.snapshot();
  const combat = binding.phase === "successor-read"
    ? binding.successorKernel?.snapshot() ?? null
    : binding.successorFinalCombat;
  const boundaryTicks120 = successorBoundaryTicks(binding.successorPlan);
  const readStartTick120 = boundaryTicks120.readStartTick120;
  if (
    internals.bus !== eventBus
    || !Number.isSafeInteger(readStartTick120)
    || binding.successorReservation.admittedAtTick120
      !== binding.successorPlan.plannedAtTick120
    || binding.successorReservation.targetRoom !== binding.successorPlan.targetRoom
    || binding.successorReservation.occurrenceId
      !== binding.successorPlan.occurrence.occurrenceId
    || binding.successorReservation.patternId !== binding.successorPlan.occurrence.patternId
    || internals.currentTick120 < binding.successorReservation.admittedAtTick120
    || (binding.phase === "successor-read"
      ? internals.currentTick120 < readStartTick120
        || internals.currentTick120 >= boundaryTicks120.sliceCompleteTick120
        || internals.activeOccurrenceId !== binding.successorReservation.occurrenceId
        || combat === null
        || combat.tick120 !== internals.currentTick120
        || combat.relativeTick120 !== internals.currentTick120 - readStartTick120
        || combat.occurrenceId !== binding.successorReservation.occurrenceId
        || combat.patternId !== binding.successorReservation.patternId
        || !successorPoolUsageFitsReservation(
          material,
          combat,
          binding.successorReservation,
        )
      : binding.phase === "successor-tail" || binding.phase === "successor-complete"
        ? internals.activeOccurrenceId !== null
          || combat === null
          || !combat.patternComplete
          || !combat.digitalBodiesDrained
          || combat.poolUsage.liveColliders !== 0
          || combat.projectiles.some((projectile) =>
            projectile.state !== "residue" || projectile.collisionEnabled)
          || combat.tick120 !== internals.currentTick120
          || combat.occurrenceId !== binding.successorReservation.occurrenceId
          || combat.patternId !== binding.successorReservation.patternId
          || !successorPoolUsageFitsReservation(
            material,
            combat,
            binding.successorReservation,
          )
          || (binding.phase === "successor-tail"
            ? internals.currentTick120 >= boundaryTicks120.sliceCompleteTick120
            : internals.currentTick120 < boundaryTicks120.sliceCompleteTick120)
        : internals.currentTick120 >= readStartTick120
          || internals.activeOccurrenceId !== null
          || combat !== null)
    || internals.pendingReleaseOccurrenceId !== null
    || internals.pendingFlushTick120 !== null
    || internals.bus.pendingEventCount() !== 0
    || material.tick120 !== internals.currentTick120
    || material.poolUsage.liveColliders !== 0
    || material.poolUsage.residueVisuals !== material.materialCount
    || material.poolUsage.residueVisuals
      > binding.successorPlan.poolReservationRequest.carryover.residueVisuals
    || DORMANT_SUCCESSOR_POOL_CLASS_ORDER.some((poolClass) =>
      material.poolUsage.active[poolClass]
        > binding.successorPlan!.poolReservationRequest.carryover.activeSlots[poolClass]
      || material.poolUsage.allocatedSlots[poolClass]
        !== binding.successorPlan!.poolReservationRequest.carryover.allocatedSlots[poolClass])
    || room.tick120 !== internals.currentTick120
    || room.currentRoom !== binding.targetRoom
    || room.targetRoom !== null
    || room.generation !== 1
    || binding.materialRoomEventCount === null
    || room.eventCount !== binding.materialRoomEventCount
    || room.state !== "idle"
    || room.active !== null
    || player.tick120 !== internals.currentTick120
    || (binding.phase === "successor-read"
      ? combat === null
        || combat.player.tick120 !== internals.currentTick120
        || combat.player.state !== player.state
        || combat.player.collisionEnabled !== player.collisionEnabled
        || combat.override.state !== override.state
        || combat.override.deadlineTick120 !== override.deadlineTick120
      : binding.phase === "successor-complete"
        ? !material.drained
          || combat === null
          || combat.player.tick120 !== internals.currentTick120
          || combat.player.state !== player.state
          || combat.player.collisionEnabled !== player.collisionEnabled
          || combat.override.state !== override.state
          || combat.override.deadlineTick120 !== override.deadlineTick120
          || override.state !== "idle"
          || override.deadlineTick120 !== null
          || override.localVoid !== null
        : binding.phase === "successor-tail"
          ? combat === null
            || combat.player.tick120 !== internals.currentTick120
            || combat.player.state !== player.state
            || combat.player.collisionEnabled !== player.collisionEnabled
            || combat.override.state !== override.state
            || combat.override.deadlineTick120 !== override.deadlineTick120
            || override.state !== "idle"
            || override.deadlineTick120 !== null
            || override.localVoid !== null
          : player.state !== "alive"
            || player.collisionEnabled !== true
            || player.activeLeases.length !== 0
            || player.recoveryAtTick120 !== null
            || player.respawnPlaceAtTick120 !== null
            || player.respawnCompleteAtTick120 !== null
            || override.state !== "idle"
            || override.deadlineTick120 !== null
            || override.localVoid !== null)
  ) {
    throw new Error("dormant successor binding lost its exact collisionless material boundary");
  }
  const phase = binding.phase === "successor-dormant"
    ? "dormant" as const
    : binding.phase === "successor-pre-read"
      ? "pre-read" as const
      : binding.phase === "successor-read"
        ? "read" as const
        : binding.phase === "successor-tail"
          ? "tail" as const
          : "complete" as const;
  const nextMasterTickAction = phase === "dormant"
    ? "telegraph" as const
    : phase === "read"
      ? "advance-read" as const
      : phase === "tail"
        ? internals.currentTick120 === boundaryTicks120.sliceCompleteTick120 - 1
          ? "close-slice" as const
          : "advance-tail" as const
        : phase === "complete"
          ? "advance-complete-hold" as const
    : internals.currentTick120 === readStartTick120 - 1
      ? "claim-read" as const
      : "continue-pre-read" as const;
  return Object.freeze({
    authority: "canonical-run-first-continuation-dormant-successor-binding-v1" as const,
    extensionPolicy: "EXT-2026-015" as const,
    terminalPolicy: "EXT-2026-016" as const,
    phase,
    tick120: internals.currentTick120,
    boundaryTicks120,
    admittedAtTick120: binding.successorReservation.admittedAtTick120,
    targetRoom: binding.targetRoom,
    plan: binding.successorPlan,
    reservation: binding.successorReservation,
    material,
    combat,
    nextMasterTickAction,
  });
}
