import type {CanonicalRunSessionSnapshot} from "../authority/run-session";
import {
  safeGapCenter,
  safeGapWidth,
  type ExecutablePattern,
} from "../authority/pattern-executor";
import type {
  BulletState,
  PatternDefinition,
  SimulationSnapshot,
  Vec2,
} from "./types";

const TICKS_PER_SECOND = 120;
const LOGICAL_VIEW_WIDTH = 360;
const LOGICAL_VIEW_HEIGHT = 640;

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
 * port back into the run session, so lifecycle opacity cannot become gameplay.
 */
export function projectCanonicalRunSession(
  run: CanonicalRunSessionSnapshot,
  firstEyePattern: PatternDefinition,
): SimulationSnapshot {
  if (run.authority !== "canonical-run-session-v4") {
    throw new Error("canonical presentation requires a canonical run-session snapshot");
  }
  if (firstEyePattern.id !== run.adapterPolicy.firstEye.patternId) {
    throw new Error("canonical presentation pattern identity drifted");
  }
  const nowMs = run.tick120 * 1000 / TICKS_PER_SECOND;
  const combat = run.combat;
  const relativeTick120 = combat?.relativeTick120 ?? 0;
  const patternElapsedMs = relativeTick120 * 1000 / TICKS_PER_SECOND;
  const emitterById = new Map(firstEyePattern.emitters.map((emitter) => [emitter.id, emitter]));
  const bullets = (combat?.projectiles ?? []).map((projectile): BulletState => {
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
    return Object.freeze({
      id: `${projectile.instanceId}:${projectile.generation}`,
      archetype: projectile.archetypeId,
      position,
      previous,
      velocity,
      baseSpeed: projectile.speedPxPerSecond,
      radius: projectile.collisionRadiusPx,
      bornAtMs: projectile.spawnedAtTick * 1000 / TICKS_PER_SECOND,
      ageMs: Math.max(0, (run.tick120 - projectile.spawnedAtTick) * 1000 / TICKS_PER_SECOND),
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
  const retainedDamage = run.player.damage;
  const playerAlive = retainedDamage === null || retainedDamage.state === "alive";
  const playerPosition = canonicalPositionToView(run.player.position);
  const override = run.override;
  const localVoid = override?.localVoid ?? null;
  const executable = firstEyePattern as unknown as ExecutablePattern;
  const safeCenter = safeGapCenter(executable, patternElapsedMs) - LOGICAL_VIEW_WIDTH / 2;
  const safeWidth = safeGapWidth(executable, run.adapterPolicy.firstEye.difficulty);

  return Object.freeze({
    nowMs,
    patternElapsedMs,
    pattern: firstEyePattern,
    room: run.adapterPolicy.firstEye.roomId,
    bullets: Object.freeze(bullets),
    shots: Object.freeze([]),
    player: Object.freeze({
      position: playerPosition,
      focused: playerAlive && run.player.focused,
      ...(retainedDamage === null ? {} : {lifeState: retainedDamage.state}),
      evidence: run.evidence?.amount ?? 0,
      expression: run.player.flower.resolution?.targetIntensity ?? 0,
      health: retainedDamage?.health ?? 3,
      lives: retainedDamage?.lives ?? 3,
      collisionEnabled: retainedDamage?.collisionEnabled ?? true,
    }),
    protocol: 0,
    overrideUntilMs: localVoid === null
      ? 0
      : localVoid.closesAtTick120 * 1000 / TICKS_PER_SECOND,
    paused: false,
    combatEnabled: combat !== null && !combat.patternComplete,
    gazeState: run.gaze.state,
    targetVisible: run.phase !== "quiet_awakening",
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
          active: override?.state === "active",
          direction: canonicalDirectionToView(localVoid.direction),
          radius: localVoid.radius,
          halfAngleDegrees: localVoid.halfAngleDegrees,
        }),
  });
}
