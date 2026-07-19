import {
  safeGapCenter,
  safeGapWidth,
  type ExecutablePattern,
} from "../authority/pattern-executor";
import type {
  BulletState,
  Difficulty,
  PatternDefinition,
  PresentedEntryOmen,
  PresentedHudFacts,
  PresentedObservation,
  PresentedRestoreStep,
  PresentedRunFacts,
  PresentedWeatherFacts,
  ProjectileAuthorityLifecycleState,
  ProjectileTerminalCause,
  ProjectileVisualLifecycleState,
  SimulationSnapshot,
  Vec2,
} from "./types";

export type {
  ProjectileAuthorityLifecycleState,
  ProjectileTerminalCause,
  ProjectileVisualLifecycleState,
} from "./types";

const TICKS_PER_SECOND = 120;
const LOGICAL_VIEW_WIDTH = 360;
const LOGICAL_VIEW_HEIGHT = 640;

/**
 * Minimal structural contract the projection reads. The run conductor's
 * snapshot (S2) implements this shape; presentation depends on nothing else.
 * Every field is authority-produced data — the projection only reads it.
 */
export interface PresentationProjectileSnapshot {
  readonly instanceId: string;
  readonly generation: number;
  readonly archetypeId: string;
  readonly collisionRadiusPx: number;
  /** The authority's real seven-state lifecycle, not a visual approximation. */
  readonly state: ProjectileAuthorityLifecycleState;
  readonly collisionEnabled: boolean;
  readonly previousPosition: Vec2;
  readonly position: Vec2;
  readonly spawnedAtTick: number;
  readonly armAtTick: number;
  readonly sourceId: string;
  readonly headingDegrees: number;
  readonly speedPxPerSecond: number;
  /** Authority-committed terminal cause; absent/null while the body is live. */
  readonly terminalCause?: ProjectileTerminalCause | null;
}

export interface PresentationPlayerSnapshot {
  readonly position: Vec2;
  readonly focused: boolean;
  /** Null before the damage authority exists (quiet awakening). */
  readonly damage: Readonly<{
    state: "alive" | "dead" | "respawning" | "run-ended";
    health: number;
    lives: number;
    collisionEnabled: boolean;
  }> | null;
  readonly evidence: number;
  /** V4 flower target intensity; presentation never derives expression. */
  readonly expression: number;
}

export interface PresentationLocalVoidSnapshot {
  /** Override is local absence: a sector void, never a global effect. */
  readonly active: boolean;
  readonly direction: Vec2;
  readonly radius: number;
  readonly halfAngleDegrees: number;
  readonly closesAtTick120: number;
}

/**
 * The run/narrative half of the conductor snapshot. Every field is optional on
 * the source interface so that non-conductor callers stay valid, but the
 * projection is all-or-nothing: declaring `authority: "run-conductor"` makes
 * every field below mandatory and validated, and omitting the marker projects
 * no run block at all. There is no partially-defaulted middle state.
 */
export interface PresentationRunSourceFacts {
  readonly authority?: "run-conductor";
  readonly runId?: string;
  readonly runPhase?: string;
  readonly runComplete?: boolean;
  readonly runEndReason?: string | null;
  readonly inputPolicy?: PresentedHudFacts["inputPolicy"];
  readonly visitedRooms?: readonly string[];
  readonly weather?: PresentedWeatherFacts;
  readonly hud?: PresentedHudFacts;
  readonly observations?: readonly PresentedObservation[];
  readonly restoreTimeline?: readonly PresentedRestoreStep[];
  readonly restoreProgress?: readonly PresentedRestoreStep[];
  readonly entryOmens?: readonly PresentedEntryOmen[];
}

export interface PresentationSourceSnapshot extends PresentationRunSourceFacts {
  readonly tick120: number;
  /** Pattern-local tick of the active occurrence (0 while none is running). */
  readonly relativeTick120: number;
  /** Active pattern id; the caller-supplied definition must match it. */
  readonly patternId: string;
  readonly roomId: string;
  readonly difficulty: Difficulty;
  readonly projectiles: readonly PresentationProjectileSnapshot[];
  readonly combatEnabled: boolean;
  readonly targetVisible: boolean;
  readonly player: PresentationPlayerSnapshot;
  readonly gazeState: "idle" | "acquiring" | "clamped" | "release-delay";
  readonly gazeClampReleased: boolean;
  readonly localVoid: PresentationLocalVoidSnapshot | null;
  /** Present only while the atomic room-transition FSM is active. */
  readonly roomThresholdTargetRoom?: string;
}

function freezeVec2(value: Vec2): Vec2 {
  return Object.freeze({x: value.x, y: value.y});
}

/** Canonical gameplay is top-left/y-down; Three.js presentation is centered/y-up. */
export function canonicalPositionToView(position: Vec2): Vec2 {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    throw new Error("canonical presentation position must be finite");
  }
  return freezeVec2({
    x: position.x - LOGICAL_VIEW_WIDTH / 2,
    y: LOGICAL_VIEW_HEIGHT / 2 - position.y,
  });
}

export function canonicalDirectionToView(direction: Vec2): Vec2 {
  if (!Number.isFinite(direction.x) || !Number.isFinite(direction.y)) {
    throw new Error("canonical presentation direction must be finite");
  }
  return freezeVec2({x: direction.x, y: -direction.y});
}

/** The authority's seven observable lifecycle states, in authored order. */
export const PROJECTILE_AUTHORITY_LIFECYCLE_STATES: readonly ProjectileAuthorityLifecycleState[] =
  Object.freeze([
    "spawn",
    "arm",
    "flight",
    "impact",
    "cancel",
    "residue",
    "cleanup",
  ] as const);

/**
 * The explicit, total collapse from the seven authority states onto the three
 * the renderer draws with. It is written out state by state on purpose: an
 * `else` branch would silently absorb a future authored state.
 *
 * The collapse is deliberately lossy about *stage* and never about *collision*.
 * `impact`, `cancel`, `residue` and `cleanup` all draw as `residue` because they
 * are the same visual fact — a body that no longer owns collision — while the
 * uncollapsed state and the terminal cause both survive on the projected bullet
 * (`authorityLifecycleState`, `terminalCause`) for anything that needs the
 * honest one.
 */
export const PROJECTILE_VISUAL_LIFECYCLE_BY_AUTHORITY_STATE: Readonly<
  Record<ProjectileAuthorityLifecycleState, ProjectileVisualLifecycleState>
> = Object.freeze({
  // Not yet armed: no collision, telegraph only.
  spawn: "arm",
  arm: "arm",
  // The only state permitted to own collision.
  flight: "flight",
  // Terminal: collision has already been withdrawn by the authority.
  impact: "residue",
  cancel: "residue",
  residue: "residue",
  cleanup: "residue",
} as const);

/**
 * `flight` is the only authority state that may own collision (the pool clears
 * `collisionEnabled` on spawn, on cancel and on impact before it commits the
 * terminal transition). Anything else claiming collision is a broken snapshot,
 * so the projection fails closed instead of drawing a body whose collision
 * authority it cannot explain. Generalises EXT-2026-026 rule 5.
 */
export function projectileVisualLifecycle(
  state: ProjectileAuthorityLifecycleState,
  collisionEnabled: boolean,
): ProjectileVisualLifecycleState {
  const visual = PROJECTILE_VISUAL_LIFECYCLE_BY_AUTHORITY_STATE[state];
  if (visual === undefined) {
    throw new Error(`unknown canonical projectile lifecycle: ${String(state)}`);
  }
  if (typeof collisionEnabled !== "boolean") {
    throw new Error(`canonical projectile ${state} requires an explicit collision fact`);
  }
  if (collisionEnabled && state !== "flight") {
    throw new Error(`canonical projectile ${state} cannot own collision`);
  }
  return visual;
}

/**
 * Which authored V4 binding slot replaces this projectile's sprite frame, per
 * EXT-2026-026. Presentation states *which binding applies*; the frame ids stay
 * in the asset chapter, so no content is invented here.
 *
 * - `arm` binding: the body exists but owns no collision yet (telegraph).
 * - `live` binding: the body has taken collision authority.
 * - `null`: no authored replacement — the projectile draws as its own archetype.
 *
 * There is no overlay, no playhead and no timer: the selection is a pure
 * function of the frozen authority snapshot, so replaying the same snapshot
 * always selects the same frame.
 */
export type ProjectileCausalityBinding = "arm" | "live";

export interface ProjectileCausalitySelection {
  readonly binding: ProjectileCausalityBinding;
  /**
   * `reduced-motion` selects the authored steady fallback instead of removing
   * the cue. Only the `arm` binding authors one; the `live` binding does not,
   * and that authored silence is not filled with a substitute.
   */
  readonly variant: "full" | "reduced-motion";
}

export function projectileCausalitySelection(
  projectile: Readonly<{
    state: ProjectileAuthorityLifecycleState;
    collisionEnabled: boolean;
  }>,
  reducedMotion = false,
): ProjectileCausalitySelection | null {
  const visual = projectileVisualLifecycle(projectile.state, projectile.collisionEnabled);
  if (visual === "arm") {
    return Object.freeze({
      binding: "arm" as const,
      variant: reducedMotion ? ("reduced-motion" as const) : ("full" as const),
    });
  }
  if (visual === "flight" && projectile.collisionEnabled) {
    // The live binding authors no reduced-motion variant; silence is authored.
    return Object.freeze({binding: "live" as const, variant: "full" as const});
  }
  // flight without collision, and every terminal state, keep their archetype.
  return null;
}

/**
 * Reconstruct a view-space velocity from the authority's integer-tick motion.
 * Falls back to the declared heading when the projectile has not moved yet
 * (spawn tick), so renderer orientation never divides by zero.
 */
function projectileVelocity(
  previous: Vec2,
  current: Vec2,
  headingDegrees: number,
  speedPxPerSecond: number,
): Vec2 {
  const deltaX = (current.x - previous.x) * TICKS_PER_SECOND;
  const deltaY = -(current.y - previous.y) * TICKS_PER_SECOND;
  if (Math.hypot(deltaX, deltaY) > Number.EPSILON) return freezeVec2({x: deltaX, y: deltaY});
  const radians = headingDegrees * Math.PI / 180;
  return freezeVec2({
    x: Math.cos(radians) * speedPxPerSecond,
    y: -Math.sin(radians) * speedPxPerSecond,
  });
}

function requireFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`canonical presentation ${path} must be a finite number`);
  }
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`canonical presentation ${path} must be a non-empty string`);
  }
  return value;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`canonical presentation ${path} must be a boolean`);
  }
  return value;
}

function requirePresent<T>(value: T | undefined, path: string): T {
  if (value === undefined) {
    throw new Error(`canonical presentation run source is missing ${path}`);
  }
  return value;
}

function projectHudFacts(source: PresentedHudFacts): PresentedHudFacts {
  return Object.freeze({
    inputPolicy: source.inputPolicy,
    inputReturned: requireBoolean(source.inputReturned, "hud.inputReturned"),
    flowerIntensity: requireFiniteNumber(source.flowerIntensity, "hud.flowerIntensity"),
    evidenceAvailable: requireFiniteNumber(source.evidenceAvailable, "hud.evidenceAvailable"),
    gazeTotalMs: requireFiniteNumber(source.gazeTotalMs, "hud.gazeTotalMs"),
    flowerForcedDimCount: requireFiniteNumber(
      source.flowerForcedDimCount,
      "hud.flowerForcedDimCount",
    ),
    overrideEligible: requireBoolean(source.overrideEligible, "hud.overrideEligible"),
    overrideActive: requireBoolean(source.overrideActive, "hud.overrideActive"),
    distinctRoomsVisited: requireFiniteNumber(
      source.distinctRoomsVisited,
      "hud.distinctRoomsVisited",
    ),
    runElapsedMs: requireFiniteNumber(source.runElapsedMs, "hud.runElapsedMs"),
  });
}

function projectWeatherFacts(source: PresentedWeatherFacts): PresentedWeatherFacts {
  if (source.authority !== "weather-presentation") {
    throw new Error("canonical presentation weather must stay presentation-only");
  }
  const biasView: Record<string, Readonly<Record<string, number>>> = {};
  for (const [roomId, biases] of Object.entries(source.biasView)) {
    const projected: Record<string, number> = {};
    for (const [behaviorId, bias] of Object.entries(biases)) {
      projected[behaviorId] = requireFiniteNumber(bias, `weather.biasView.${roomId}.${behaviorId}`);
    }
    biasView[roomId] = Object.freeze(projected);
  }
  return Object.freeze({
    authority: "weather-presentation" as const,
    phase: source.phase,
    classId: source.classId === null ? null : requireString(source.classId, "weather.classId"),
    biasView: Object.freeze(biasView),
    residues: Object.freeze(source.residues.map((residue) => Object.freeze({
      weather: requireString(residue.weather, "weather.residues[].weather"),
      residue: requireString(residue.residue, "weather.residues[].residue"),
      cycle: requireFiniteNumber(residue.cycle, "weather.residues[].cycle"),
      tick120: requireFiniteNumber(residue.tick120, "weather.residues[].tick120"),
      persistence: "room-local" as const,
    }))),
    witnessFacePlayerException: requireBoolean(
      source.witnessFacePlayerException,
      "weather.witnessFacePlayerException",
    ),
  });
}

function projectRestoreSteps(
  steps: readonly PresentedRestoreStep[],
  path: string,
): readonly PresentedRestoreStep[] {
  return Object.freeze(steps.map((step) => Object.freeze({
    phase: requireString(step.phase, `${path}[].phase`),
    tick120: requireFiniteNumber(step.tick120, `${path}[].tick120`),
  })));
}

/**
 * Project the run/narrative half of a conductor snapshot, or null when the
 * source is not a conductor snapshot. All-or-nothing by design: a source that
 * claims conductor authority but omits a fact fails closed rather than
 * presenting a defaulted run.
 */
export function projectPresentationRunFacts(
  source: PresentationSourceSnapshot,
): PresentedRunFacts | null {
  if (source.authority === undefined) return null;
  if (source.authority !== "run-conductor") {
    throw new Error("canonical presentation run authority drifted");
  }
  const visitedRooms = requirePresent(source.visitedRooms, "visitedRooms");
  const observations = requirePresent(source.observations, "observations");
  const entryOmens = requirePresent(source.entryOmens, "entryOmens");
  return Object.freeze({
    authority: "run-conductor" as const,
    runId: requireString(requirePresent(source.runId, "runId"), "runId"),
    runPhase: requireString(requirePresent(source.runPhase, "runPhase"), "runPhase"),
    runComplete: requireBoolean(requirePresent(source.runComplete, "runComplete"), "runComplete"),
    runEndReason: requirePresent(source.runEndReason, "runEndReason") === null
      ? null
      : requireString(source.runEndReason, "runEndReason"),
    roomId: requireString(source.roomId, "roomId"),
    roomThresholdTargetRoom: source.roomThresholdTargetRoom === undefined
      ? null
      : requireString(source.roomThresholdTargetRoom, "roomThresholdTargetRoom"),
    visitedRooms: Object.freeze(
      visitedRooms.map((roomId, index) => requireString(roomId, `visitedRooms[${index}]`)),
    ),
    weather: projectWeatherFacts(requirePresent(source.weather, "weather")),
    hud: projectHudFacts(requirePresent(source.hud, "hud")),
    observations: Object.freeze(observations.map((observation) => Object.freeze({
      id: requireString(observation.id, "observations[].id"),
      category: requireString(observation.category, "observations[].category"),
      zhCN: requireString(observation.zhCN, "observations[].zhCN"),
      en: requireString(observation.en, "observations[].en"),
      trace: Object.freeze(observation.trace.map((entry) => Object.freeze({
        path: requireString(entry.path, "observations[].trace[].path"),
        value: entry.value,
      }))),
    }))),
    restoreTimeline: projectRestoreSteps(
      requirePresent(source.restoreTimeline, "restoreTimeline"),
      "restoreTimeline",
    ),
    restoreProgress: projectRestoreSteps(
      requirePresent(source.restoreProgress, "restoreProgress"),
      "restoreProgress",
    ),
    entryOmens: Object.freeze(entryOmens.map((omen) => Object.freeze({
      tick120: requireFiniteNumber(omen.tick120, "entryOmens[].tick120"),
      roomId: requireString(omen.roomId, "entryOmens[].roomId"),
      event: requireString(omen.event, "entryOmens[].event"),
      distancePx: requireFiniteNumber(omen.distancePx, "entryOmens[].distancePx"),
      audioLeadTicks120: requireFiniteNumber(
        omen.audioLeadTicks120,
        "entryOmens[].audioLeadTicks120",
      ),
      transitionRequestTick120: requireFiniteNumber(
        omen.transitionRequestTick120,
        "entryOmens[].transitionRequestTick120",
      ),
    }))),
  });
}

/**
 * One-way authority projection. It creates renderer DTOs and has no command
 * port back into the authority, so presentation can never write gameplay.
 */
export function projectPresentationSnapshot(
  source: PresentationSourceSnapshot,
  activePattern: PatternDefinition,
): SimulationSnapshot {
  if (activePattern.id !== source.patternId) {
    throw new Error("canonical presentation pattern identity drifted");
  }
  const nowMs = source.tick120 * 1000 / TICKS_PER_SECOND;
  const patternElapsedMs = source.relativeTick120 * 1000 / TICKS_PER_SECOND;
  const emitterById = new Map(activePattern.emitters.map((emitter) => [emitter.id, emitter]));
  const projectedProjectileIds = new Set<string>();
  const bullets = source.projectiles.map((projectile): BulletState => {
    const emitter = emitterById.get(projectile.sourceId);
    const position = canonicalPositionToView(projectile.position);
    const previous = canonicalPositionToView(projectile.previousPosition);
    const velocity = projectileVelocity(
      projectile.previousPosition,
      projectile.position,
      projectile.headingDegrees,
      projectile.speedPxPerSecond,
    );
    const lifecycleState = projectileVisualLifecycle(
      projectile.state,
      projectile.collisionEnabled,
    );
    const projectedId = `${projectile.instanceId}:${projectile.generation}`;
    if (projectedProjectileIds.has(projectedId)) {
      throw new Error("canonical presentation projectile identity collided");
    }
    projectedProjectileIds.add(projectedId);
    return Object.freeze({
      id: projectedId,
      archetype: projectile.archetypeId,
      position,
      previous,
      velocity,
      baseSpeed: projectile.speedPxPerSecond,
      radius: projectile.collisionRadiusPx,
      bornAtMs: projectile.spawnedAtTick * 1000 / TICKS_PER_SECOND,
      ageMs: Math.max(0, (source.tick120 - projectile.spawnedAtTick) * 1000 / TICKS_PER_SECOND),
      armedAtMs: projectile.armAtTick * 1000 / TICKS_PER_SECOND,
      grazed: false,
      generation: projectile.generation,
      splitDone: false,
      turned: new Set<string>(),
      origin: position,
      motionStack: (emitter?.motionStack ?? []).map((entry) => ({
        operator: entry.operator,
        params: {...entry.params},
      })),
      lifecycleState,
      authorityLifecycleState: projectile.state,
      terminalCause: projectile.terminalCause ?? null,
      collisionEnabled: projectile.collisionEnabled,
    });
  });
  const damage = source.player.damage;
  const playerAlive = damage === null || damage.state === "alive";
  const localVoid = source.localVoid;
  const run = projectPresentationRunFacts(source);
  const executable = activePattern as unknown as ExecutablePattern;
  const safeCenter = safeGapCenter(executable, patternElapsedMs) - LOGICAL_VIEW_WIDTH / 2;
  const safeWidth = safeGapWidth(executable, source.difficulty);

  return Object.freeze({
    nowMs,
    patternElapsedMs,
    pattern: activePattern,
    room: source.roomId,
    bullets: Object.freeze(bullets),
    shots: Object.freeze([]),
    player: Object.freeze({
      position: canonicalPositionToView(source.player.position),
      focused: playerAlive && source.player.focused,
      ...(damage === null ? {} : {lifeState: damage.state}),
      evidence: source.player.evidence,
      expression: source.player.expression,
      health: damage?.health ?? 3,
      lives: damage?.lives ?? 3,
      collisionEnabled: damage?.collisionEnabled ?? true,
    }),
    protocol: 0,
    overrideUntilMs: localVoid === null
      ? 0
      : localVoid.closesAtTick120 * 1000 / TICKS_PER_SECOND,
    paused: false,
    combatEnabled: source.combatEnabled,
    gazeState: source.gazeState,
    gazeClampReleased: source.gazeClampReleased,
    ...(source.roomThresholdTargetRoom === undefined
      ? {}
      : {roomThresholdTargetRoom: source.roomThresholdTargetRoom}),
    targetVisible: source.targetVisible,
    safeGapCenterX: safeCenter,
    safeGapWidthPx: safeWidth,
    overrideView: localVoid === null
      ? Object.freeze({
          active: false,
          direction: Object.freeze({x: 0, y: 1}),
          radius: 0,
          halfAngleDegrees: 45,
        })
      : Object.freeze({
          active: localVoid.active,
          direction: canonicalDirectionToView(localVoid.direction),
          radius: localVoid.radius,
          halfAngleDegrees: localVoid.halfAngleDegrees,
        }),
    ...(run === null ? {} : {run}),
  });
}
