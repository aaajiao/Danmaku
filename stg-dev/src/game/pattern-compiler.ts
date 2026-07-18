import type {
  Difficulty,
  EmitterDefinition,
  MotionDefinition,
  PatternDefinition,
  Vec2,
} from "./types";

export const FIELD_WIDTH = 360;
export const FIELD_HEIGHT = 640;

export interface BulletCandidate {
  position: Vec2;
  velocity: Vec2;
  speed: number;
  archetype: string;
  radius: number;
  armDelayMs: number;
  motionStack: MotionDefinition[];
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function direction(angleDeg: number): Vec2 {
  const angle = angleDeg * Math.PI / 180;
  return {x: Math.cos(angle), y: -Math.sin(angle)};
}

function evenlySpaced(index: number, count: number, spread: number): number {
  if (count <= 1) return 0;
  return -spread / 2 + (spread * index) / (count - 1);
}

function anchorToWorld(emitter: EmitterDefinition): Vec2 {
  return {
    x: emitter.anchor.x * FIELD_WIDTH - FIELD_WIDTH / 2,
    y: FIELD_HEIGHT / 2 - emitter.anchor.y * FIELD_HEIGHT,
  };
}

function candidatePosition(
  emitter: EmitterDefinition,
  index: number,
  count: number,
  burstIndex: number,
): Vec2 {
  const anchor = anchorToWorld(emitter);
  const geometry = emitter.geometry.type;
  const lineOffset = evenlySpaced(index, count, Math.min(320, Math.max(96, count * 25)));

  switch (geometry) {
    case "line":
    case "wall":
    case "grid":
    case "lattice":
    case "shutter":
      return {x: Math.max(-166, Math.min(166, anchor.x + lineOffset)), y: anchor.y};
    case "history_chain":
      return {x: anchor.x + lineOffset * 0.52, y: anchor.y + (index % 3) * 12};
    case "cross":
      return index % 2 === 0
        ? {x: anchor.x + lineOffset * 0.5, y: anchor.y}
        : {x: anchor.x, y: anchor.y + lineOffset * 0.35};
    case "spiral": {
      const orbit = 12 + (index % 4) * 5;
      const angle = (burstIndex * 29 + index * (360 / count)) * Math.PI / 180;
      return {x: anchor.x + Math.cos(angle) * orbit, y: anchor.y + Math.sin(angle) * orbit};
    }
    default:
      return anchor;
  }
}

function candidateAngle(
  emitter: EmitterDefinition,
  index: number,
  count: number,
  burstIndex: number,
  player: Vec2,
  position: Vec2,
  random: () => number,
): number {
  const {baseAngleDeg, spreadDeg, type} = emitter.geometry;
  const spreadAngle = evenlySpaced(index, count, spreadDeg);
  const hasAim = emitter.motionStack.some((motion) => motion.operator === "op.aim_lock");
  const aimAngle = Math.atan2(-(player.y - position.y), player.x - position.x) * 180 / Math.PI;

  if (hasAim) return aimAngle + spreadAngle;
  switch (type) {
    case "ring":
    case "broken_ring":
      return baseAngleDeg + index * (360 / count) + burstIndex * 11;
    case "spiral":
      return baseAngleDeg + index * (spreadDeg / Math.max(1, count)) + burstIndex * 23;
    case "cross":
      return index * 90 + (index % 4) * spreadAngle * 0.1;
    case "paired_fan":
      return baseAngleDeg + spreadAngle + (burstIndex % 2 === 0 ? -8 : 8);
    case "lattice":
      return baseAngleDeg + (index % 2 === 0 ? -spreadDeg * 0.28 : spreadDeg * 0.28);
    case "history_chain":
      return baseAngleDeg + spreadAngle * 0.32 + (random() - 0.5) * 4;
    default:
      return baseAngleDeg + spreadAngle;
  }
}

function crossesSafeGap(
  position: Vec2,
  velocity: Vec2,
  pattern: PatternDefinition,
  difficulty: Difficulty,
  patternElapsedMs: number,
): boolean {
  if (velocity.y >= -1) return false;
  const secondsToBottom = Math.max(0, (position.y + FIELD_HEIGHT * 0.38) / -velocity.y);
  const projectedX = position.x + velocity.x * secondsToBottom;
  const path = pattern.safeGap.path;
  const period = Math.max(1, path.periodMs);
  const phase = path.phase + (patternElapsedMs + secondsToBottom * 1000) / period * Math.PI * 2;
  const safeCenter = path.centerX - FIELD_WIDTH / 2 + Math.sin(phase) * path.amplitudePx;
  const width = pattern.safeGap.minimumWidthPx + pattern.difficulty[difficulty].gapDeltaPx;
  return Math.abs(projectedX - safeCenter) < width / 2;
}

export function compileBurst(
  pattern: PatternDefinition,
  emitter: EmitterDefinition,
  burstIndex: number,
  difficulty: Difficulty,
  player: Vec2,
  patternElapsedMs: number,
): BulletCandidate[] {
  const profile = pattern.difficulty[difficulty];
  const random = mulberry32((pattern.seed.base ^ (burstIndex + 1) * 0x9e3779b9) >>> 0);
  const count = Math.max(1, Math.round(emitter.geometry.count * profile.countMultiplier));
  const baseSpeed = (emitter.speedCurve.keys[0]?.pxPerSec ?? 120) * profile.speedMultiplier;
  const candidates: BulletCandidate[] = [];

  for (let index = 0; index < count; index += 1) {
    if (emitter.geometry.type === "broken_ring" && index % 4 === 1) continue;
    if (emitter.geometry.type === "shutter" && Math.abs(index - (count - 1) / 2) < 1.1) continue;
    const position = candidatePosition(emitter, index, count, burstIndex);
    const angle = candidateAngle(emitter, index, count, burstIndex, player, position, random);
    const vector = direction(angle);
    const velocity = {x: vector.x * baseSpeed, y: vector.y * baseSpeed};
    if (crossesSafeGap(position, velocity, pattern, difficulty, patternElapsedMs)) continue;
    candidates.push({
      position,
      velocity,
      speed: baseSpeed,
      archetype: emitter.projectile.archetype,
      radius: emitter.projectile.collisionRadiusPx,
      armDelayMs: emitter.projectile.armDelayMs,
      motionStack: emitter.motionStack,
    });
  }
  return candidates;
}

export function sampleEnvelope(
  keys: Array<{atMs: number; multiplier: number}>,
  ageMs: number,
  interpolation: unknown,
): number {
  if (keys.length === 0) return 1;
  const sorted = [...keys].sort((a, b) => a.atMs - b.atMs);
  let previous = sorted[0] ?? {atMs: 0, multiplier: 1};
  for (const key of sorted) {
    if (ageMs < key.atMs) {
      if (interpolation !== "linear" || key.atMs === previous.atMs) return previous.multiplier;
      const progress = (ageMs - previous.atMs) / (key.atMs - previous.atMs);
      return previous.multiplier + (key.multiplier - previous.multiplier) * Math.max(0, progress);
    }
    previous = key;
  }
  return previous.multiplier;
}

export function numberParam(params: Record<string, unknown>, key: string, fallback: number): number {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
