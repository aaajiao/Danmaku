import {
  safeGapCenter,
  safeGapWidth,
  type ExecutablePattern,
} from "../authority/pattern-executor";
import type {
  BulletState,
  Difficulty,
  PatternDefinition,
  SimulationSnapshot,
  Vec2,
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
  readonly state: "spawn" | "arm" | "flight" | "residue";
  readonly collisionEnabled: boolean;
  readonly previousPosition: Vec2;
  readonly position: Vec2;
  readonly spawnedAtTick: number;
  readonly armAtTick: number;
  readonly sourceId: string;
  readonly headingDegrees: number;
  readonly speedPxPerSecond: number;
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

export interface PresentationSourceSnapshot {
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
    const lifecycleState = projectile.state === "flight"
      ? "flight" as const
      : projectile.state === "arm" || projectile.state === "spawn"
        ? "arm" as const
        : "residue" as const;
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
      collisionEnabled: projectile.collisionEnabled,
    });
  });
  const damage = source.player.damage;
  const playerAlive = damage === null || damage.state === "alive";
  const localVoid = source.localVoid;
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
  });
}
