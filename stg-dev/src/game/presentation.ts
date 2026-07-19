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
  activePattern: PatternDefinition,
): SimulationSnapshot {
  if (run.authority !== "canonical-run-session-v4") {
    throw new Error("canonical presentation requires a canonical run-session snapshot");
  }
  const transition = run.firstContinuationTransition;
  if (
    (run.phase === "first_continuation_transition")
    !== (transition !== null)
  ) {
    throw new Error("canonical presentation transition phase identity drifted");
  }
  const expectedPatternId = transition?.patternId
    ?? run.roomSampling?.patternId
    ?? run.adapterPolicy.firstEye.patternId;
  if (activePattern.id !== expectedPatternId) {
    throw new Error("canonical presentation pattern identity drifted");
  }
  const nowMs = run.tick120 * 1000 / TICKS_PER_SECOND;
  const combat = run.combat;
  if (combat !== null && combat.patternId !== expectedPatternId) {
    throw new Error("canonical presentation combat pattern identity drifted");
  }
  if (transition !== null && (
    combat === null
    || transition.worldRoom !== transition.roomTransition.currentRoom
    || combat.occurrenceId !== transition.occurrenceId
    || combat.difficulty !== transition.difficulty
    || combat.seed !== transition.resolvedSeed.value
    || combat.startTick120 !== transition.startTick120
    || combat.tick120 !== transition.combat.tick120
  )) {
    throw new Error("canonical presentation transition combat identity drifted");
  }
  if (
    transition === null
    && run.roomSampling !== null
    && combat !== null
    && (
      combat.occurrenceId !== run.roomSampling.occurrenceId
      || combat.difficulty !== run.roomSampling.difficulty
      || combat.seed !== run.roomSampling.resolvedSeed.value
      || combat.startTick120 !== run.roomSampling.boundaryTicks120.read
    )
  ) {
    throw new Error("canonical presentation room combat identity drifted");
  }
  const material = transition?.material ?? null;
  if (material !== null && (
    material.sourcePatternId !== transition?.patternId
    || material.sourceOccurrenceId !== transition.occurrenceId
    || material.detachedAtTick120 !== transition.timeline.patternCompleteTick120
    || material.tick120 !== run.tick120
    || material.materialCount !== material.projectiles.length
    || material.poolUsage.residueVisuals !== material.projectiles.length
    || material.poolUsage.liveColliders !== 0
    || material.projectiles.some((projectile) =>
      projectile.state !== "residue" || projectile.collisionEnabled)
  )) {
    throw new Error("canonical presentation transition material identity drifted");
  }
  const relativeTick120 = combat?.relativeTick120 ?? 0;
  const patternElapsedMs = relativeTick120 * 1000 / TICKS_PER_SECOND;
  const emitterById = new Map(activePattern.emitters.map((emitter) => [emitter.id, emitter]));
  const projectileSnapshots = material?.projectiles ?? combat?.projectiles ?? [];
  const bullets = projectileSnapshots.map((projectile): BulletState => {
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
  const executable = activePattern as unknown as ExecutablePattern;
  const safeCenter = safeGapCenter(executable, patternElapsedMs) - LOGICAL_VIEW_WIDTH / 2;
  const difficulty = transition?.difficulty
    ?? run.roomSampling?.difficulty
    ?? run.adapterPolicy.firstEye.difficulty;
  const safeWidth = safeGapWidth(executable, difficulty);

  return Object.freeze({
    nowMs,
    patternElapsedMs,
    pattern: activePattern,
    room: transition?.worldRoom
      ?? run.roomSampling?.roomId
      ?? run.adapterPolicy.firstEye.roomId,
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
    targetVisible: run.phase === "first_eye" || run.phase === "first_clamp_recovery",
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
