export type Difficulty = "EASY" | "NORMAL" | "HARD";

export interface LocalizedName {
  zh: string;
  en: string;
}

export interface MotionDefinition {
  operator: string;
  params: Record<string, unknown>;
}

export interface GeometryDefinition {
  type: string;
  variant: string;
  count: number;
  baseAngleDeg: number;
  spreadDeg: number;
  ordering: string;
}

export interface EmitterDefinition {
  id: string;
  kind: string;
  anchor: {space: string; x: number; y: number};
  geometry: GeometryDefinition;
  cadence: {startMs: number; intervalMs: number; bursts: number; intraBurstMs: number};
  projectile: {archetype: string; collisionRadiusPx: number; armDelayMs: number};
  speedCurve: {type: string; keys: Array<{atMs: number; pxPerSec: number}>};
  motionStack: MotionDefinition[];
}

export interface PatternDefinition {
  id: string;
  category: string;
  room: string;
  name: LocalizedName;
  intent: string;
  durationMs: number;
  clock: {authority: string; tickHz: number};
  timeline: Array<{atMs: number; event: string}>;
  emitters: EmitterDefinition[];
  safeGap: {
    type: string;
    minimumWidthPx: number;
    focusMinimumWidthPx: number;
    path: {centerX: number; amplitudePx: number; periodMs: number; phase: number; laneX: number[]};
  };
  warning: {durationMs: number; shape: string};
  difficulty: Record<Difficulty, {
    countMultiplier: number;
    speedMultiplier: number;
    cadenceMultiplier: number;
    gapDeltaPx: number;
  }>;
  seed: {algorithm: string; base: number};
}

export interface FrameDefinition {
  semanticId: string;
  atlas: string;
  rect: [number, number, number, number];
  logicalSize?: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * The real projectile lifecycle owned by the authority (`projectile-lifecycle-v4`
 * minus the `pooled` slot state, which has no gameplay snapshot). Presentation
 * carries all seven honestly; it never infers one from time or animation.
 */
export type ProjectileAuthorityLifecycleState =
  | "spawn"
  | "arm"
  | "flight"
  | "impact"
  | "cancel"
  | "residue"
  | "cleanup";

/**
 * The coarser vocabulary the renderer draws with. It is a strict projection of
 * the authority lifecycle above (see PROJECTILE_VISUAL_LIFECYCLE_BY_AUTHORITY_STATE
 * in presentation.ts) and is never the source of a collision fact — the
 * collision-authority distinction always travels separately in
 * `collisionEnabled`, which only `flight` may own.
 */
export type ProjectileVisualLifecycleState = "arm" | "flight" | "residue";

/** Which terminal transition produced a residue body. */
export type ProjectileTerminalCause = "impact" | "cancel";

export interface BulletState {
  id: number | string;
  archetype: string;
  position: Vec2;
  previous: Vec2;
  velocity: Vec2;
  baseSpeed: number;
  radius: number;
  bornAtMs: number;
  ageMs: number;
  armedAtMs: number;
  grazed: boolean;
  generation: number;
  splitDone: boolean;
  turned: Set<string>;
  origin: Vec2;
  motionStack: MotionDefinition[];
  /** Explicit authority lifecycle for canonical projections; presentation only. */
  lifecycleState?: ProjectileVisualLifecycleState;
  /**
   * The uncollapsed authority lifecycle state. Present whenever the source is a
   * canonical authority snapshot; absent for legacy sources that own no
   * lifecycle. Consumers that need the honest state read this, not
   * `lifecycleState`.
   */
  authorityLifecycleState?: ProjectileAuthorityLifecycleState;
  /** Authority-committed terminal cause; null while the body is still live. */
  terminalCause?: ProjectileTerminalCause | null;
  collisionEnabled?: boolean;
}

export interface ShotState {
  id: number;
  position: Vec2;
  previous: Vec2;
  velocity: Vec2;
}

export interface PlayerState {
  position: Vec2;
  focused: boolean;
  /** Present for canonical authority projection; absent in the legacy Lab. */
  lifeState?: "alive" | "dead" | "respawning" | "run-ended";
  evidence: number;
  expression: number;
  health: number;
  lives: number;
  collisionEnabled: boolean;
}

/** Presentation-only weather facts. Weather never writes gameplay. */
export interface PresentedWeatherFacts {
  readonly authority: "weather-presentation";
  readonly phase: "idle" | "cooldown" | "omen" | "active" | "aftermath";
  readonly classId: string | null;
  readonly biasView: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly residues: readonly Readonly<{
    weather: string;
    residue: string;
    cycle: number;
    tick120: number;
    persistence: "room-local";
  }>[];
  readonly witnessFacePlayerException: boolean;
}

/** Authority-owned HUD binds. The HUD displays these; it never derives them. */
export interface PresentedHudFacts {
  readonly inputPolicy: "held" | "movement-and-signal" | "full" | "snapshot-navigation";
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

/** One selected snapshot observation, bilingual, with its authored trace. */
export interface PresentedObservation {
  readonly id: string;
  readonly category: string;
  readonly zhCN: string;
  readonly en: string;
  readonly trace: readonly Readonly<{path: string; value: unknown}>[];
}

export interface PresentedRestoreStep {
  readonly phase: string;
  readonly tick120: number;
}

export interface PresentedEntryOmen {
  readonly tick120: number;
  readonly roomId: string;
  readonly event: string;
  readonly distancePx: number;
  readonly audioLeadTicks120: number;
  readonly transitionRequestTick120: number;
}

/**
 * Run/narrative context projected from a run-conductor snapshot. Present only
 * when the source declares `authority: "run-conductor"`; a source without that
 * marker projects no run block at all rather than a defaulted one.
 *
 * A run ends in observation and handoff. Nothing here ranks, scores or judges.
 */
export interface PresentedRunFacts {
  readonly authority: "run-conductor";
  readonly runId: string;
  readonly runPhase: string;
  readonly runComplete: boolean;
  /** One of the eight authored resolution reasons, or null while the run lives. */
  readonly runEndReason: string | null;
  readonly roomId: string;
  /** Target room only while the atomic room-transition FSM owns one. */
  readonly roomThresholdTargetRoom: string | null;
  readonly visitedRooms: readonly string[];
  readonly weather: PresentedWeatherFacts;
  readonly hud: PresentedHudFacts;
  readonly observations: readonly PresentedObservation[];
  /** The authored cross-run restore schedule. */
  readonly restoreTimeline: readonly PresentedRestoreStep[];
  /** The restore phases that have actually fired, in the order they fired. */
  readonly restoreProgress: readonly PresentedRestoreStep[];
  readonly entryOmens: readonly PresentedEntryOmen[];
}

export interface SimulationSnapshot {
  nowMs: number;
  patternElapsedMs: number;
  pattern: PatternDefinition;
  room: string;
  bullets: readonly BulletState[];
  shots: readonly ShotState[];
  player: Readonly<PlayerState>;
  protocol: number;
  overrideUntilMs: number;
  paused: boolean;
  combatEnabled: boolean;
  /** Optional committed V4 gaze state; presentation cannot infer this from time. */
  gazeState?: "idle" | "acquiring" | "clamped" | "release-delay";
  /** Optional committed release barrier; persistent presentation never infers it from a clip. */
  gazeClampReleased?: boolean;
  /** Target room only while the atomic room-transition FSM is active. */
  roomThresholdTargetRoom?: string;
  /** Optional phase-owned material presence, independent from projectile generation. */
  targetVisible?: boolean;
  /** Optional exact authority projection; legacy Lab computes these locally. */
  safeGapCenterX?: number;
  safeGapWidthPx?: number;
  overrideView?: Readonly<{
    active: boolean;
    direction: Vec2;
    radius: number;
    halfAngleDegrees: number;
  }>;
  /** Run/narrative context; present only for run-conductor sources. */
  run?: PresentedRunFacts;
}

export type SimulationEvent =
  | {type: "pattern"; atMs: number; detail: string}
  | {type: "graze"; atMs: number; detail: string}
  | {type: "damage"; atMs: number; detail: string}
  | {type: "override"; atMs: number; detail: string}
  | {type: "override-denied"; atMs: number; detail: string}
  | {type: "protocol"; atMs: number; detail: string};
