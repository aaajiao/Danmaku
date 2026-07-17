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

export interface BulletState {
  id: number;
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
  evidence: number;
  expression: number;
  health: number;
  lives: number;
  collisionEnabled: boolean;
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
}

export type SimulationEvent =
  | {type: "pattern"; atMs: number; detail: string}
  | {type: "graze"; atMs: number; detail: string}
  | {type: "damage"; atMs: number; detail: string}
  | {type: "override"; atMs: number; detail: string}
  | {type: "override-denied"; atMs: number; detail: string}
  | {type: "protocol"; atMs: number; detail: string};
