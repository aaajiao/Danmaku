import executablePatternsJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/executable-patterns-v4.json";
import motionOperatorsJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/motion-operators-v4.json";

export const LOGICAL_VIEW_WIDTH = 360;
export const LOGICAL_VIEW_HEIGHT = 640;
export const AUTHORED_PLAYER_Y = 570;
/** Movement envelopes used by the immutable V4 safe-gap reachability oracle. */
export const PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND = 188;
export const PLAYER_FOCUS_MAX_SPEED_PX_PER_SECOND = 92;
export const REFERENCE_STEP_MS = 1000 / 30;
export const REFERENCE_CAPTURE_MS = 100;

export type PatternDifficulty = "EASY" | "NORMAL" | "HARD";
export type PatternExecutionSemantics = "reference-v4" | "declared-v4";

declare const motionOperatorIdBrand: unique symbol;
export type MotionOperatorId = string & {readonly [motionOperatorIdBrand]: "MotionOperatorId"};

interface MotionOperatorManifest {
  readonly schemaVersion: string;
  readonly operators: readonly {readonly id: string}[];
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

const motionOperatorManifest = deepFreezeJson(motionOperatorsJson) as MotionOperatorManifest;
const MOTION_OPERATOR_IDS = Object.freeze(
  motionOperatorManifest.operators.map((operator) => operator.id as MotionOperatorId),
);

const MOTION_OPERATOR_SET: ReadonlySet<string> = new Set(MOTION_OPERATOR_IDS);

export interface PatternMotion {
  readonly operator: MotionOperatorId;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface PatternEmitter {
  readonly id: string;
  readonly anchor: {readonly x: number; readonly y: number};
  readonly geometry: {
    readonly type: string;
    readonly count: number;
    readonly baseAngleDeg: number;
    readonly spreadDeg: number;
  };
  readonly cadence: {
    readonly startMs: number;
    readonly intervalMs: number;
    readonly bursts: number;
  };
  readonly projectile: {
    readonly archetype: string;
    readonly collisionRadiusPx: number;
    readonly armDelayMs: number;
  };
  readonly speedCurve: {
    readonly type: string;
    readonly keys: readonly {readonly atMs: number; readonly pxPerSec: number}[];
  };
  readonly motionStack: readonly PatternMotion[];
}

interface DifficultyProfile {
  readonly countMultiplier: number;
  readonly speedMultiplier: number;
  readonly cadenceMultiplier: number;
  readonly gapDeltaPx: number;
}

export interface ExecutablePattern {
  readonly id: string;
  readonly durationMs: number;
  readonly emitters: readonly PatternEmitter[];
  readonly safeGap: {
    readonly type: string;
    readonly minimumWidthPx: number;
    readonly path: {
      readonly centerX: number;
      readonly amplitudePx: number;
      readonly periodMs: number;
      readonly phase: number;
      readonly laneX: readonly number[];
    };
    readonly enforcement: string;
  };
  readonly warning: {
    readonly durationMs: number;
    readonly shape: string;
    readonly coversSweptArea: boolean;
    readonly collisionEnabled: boolean;
  };
  readonly difficulty: Readonly<Record<PatternDifficulty, DifficultyProfile>>;
  readonly seed: {readonly base: number};
}

interface ExecutablePatternManifest {
  readonly schemaVersion: string;
  readonly patterns: readonly ExecutablePattern[];
}

const executableManifest = deepFreezeJson(executablePatternsJson) as unknown as ExecutablePatternManifest;

/** The V4 manifest is the only pattern catalog; this module does not copy it. */
export const EXECUTABLE_PATTERN_MANIFEST = executableManifest;
export const EXECUTABLE_PATTERNS = Object.freeze([...executableManifest.patterns]);
const PATTERN_BY_ID: ReadonlyMap<string, ExecutablePattern> = new Map(
  EXECUTABLE_PATTERNS.map((pattern) => [pattern.id, pattern]),
);

export function executablePattern(patternId: string): ExecutablePattern {
  const pattern = PATTERN_BY_ID.get(patternId);
  if (!pattern) throw new Error(`unknown V4 executable pattern: ${patternId}`);
  return pattern;
}

export function compileDeclaredMotionStack(
  stack: readonly {readonly operator: string; readonly params: Readonly<Record<string, unknown>>}[],
): readonly PatternMotion[] {
  const compiled = stack.map((entry, index) => {
    if (!MOTION_OPERATOR_SET.has(entry.operator)) {
      throw new Error(`motionStack[${index}] uses unknown operator: ${entry.operator}`);
    }
    return Object.freeze({
      operator: entry.operator as MotionOperatorId,
      params: Object.freeze({...entry.params}),
    });
  });
  return Object.freeze(compiled);
}

export class Mulberry32 {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  random(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1) >>> 0;
    value = (value ^ ((value + Math.imul(value ^ (value >>> 7), value | 61)) >>> 0)) >>> 0;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }
}

export interface ScheduledBurst {
  readonly atMs: number;
  readonly emitter: PatternEmitter;
  readonly burstIndex: number;
}

export function createPatternSchedule(
  pattern: ExecutablePattern,
  difficulty: PatternDifficulty,
): readonly ScheduledBurst[] {
  const multiplier = pattern.difficulty[difficulty].cadenceMultiplier;
  const schedule: ScheduledBurst[] = [];
  for (const emitter of pattern.emitters) {
    const interval = emitter.cadence.intervalMs * multiplier;
    for (let burstIndex = 0; burstIndex < emitter.cadence.bursts; burstIndex += 1) {
      const atMs = emitter.cadence.startMs + burstIndex * interval;
      if (atMs < pattern.durationMs) schedule.push({atMs, emitter, burstIndex});
    }
  }
  schedule.sort((left, right) =>
    left.atMs - right.atMs
    || compareCodePoints(left.emitter.id, right.emitter.id)
    || left.burstIndex - right.burstIndex,
  );
  return Object.freeze(schedule);
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function numberParam(params: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringParam(params: Readonly<Record<string, unknown>>, key: string, fallback: string): string {
  const value = params[key];
  return typeof value === "string" ? value : fallback;
}

function numberPairParam(
  params: Readonly<Record<string, unknown>>,
  key: string,
): readonly [number, number] {
  const value = params[key];
  if (!Array.isArray(value) || value.length !== 2 || value.some((entry) => typeof entry !== "number")) {
    return [0, 0];
  }
  return [value[0] as number, value[1] as number];
}

function motionFor(bullet: Bullet, operator: string): PatternMotion | undefined {
  return bullet.motion.find((entry) => entry.operator === operator);
}

function interpolateKeys(
  keys: readonly Readonly<Record<string, unknown>>[],
  nowMs: number,
  key: string,
  mode = "linear",
): number {
  if (keys.length === 0) return 1;
  const first = keys[0];
  if (!first) return 1;
  const firstAt = numberParam(first, "atMs", 0);
  if (nowMs <= firstAt) return numberParam(first, key, 1);
  for (let index = 0; index < keys.length - 1; index += 1) {
    const left = keys[index];
    const right = keys[index + 1];
    if (!left || !right) continue;
    const rightAt = numberParam(right, "atMs", 0);
    if (nowMs <= rightAt) {
      if (mode === "step") return numberParam(left, key, 1);
      const leftAt = numberParam(left, "atMs", 0);
      const span = Math.max(1, rightAt - leftAt);
      const progress = (nowMs - leftAt) / span;
      const leftValue = numberParam(left, key, 1);
      return leftValue + (numberParam(right, key, 1) - leftValue) * progress;
    }
  }
  const last = keys[keys.length - 1];
  return last ? numberParam(last, key, 1) : 1;
}

function emitterSpeed(
  emitter: PatternEmitter,
  ageMs: number,
  difficulty: PatternDifficulty,
  pattern: ExecutablePattern,
): number {
  const keys = emitter.speedCurve.keys as readonly Readonly<Record<string, unknown>>[];
  return interpolateKeys(keys, ageMs, "pxPerSec") * pattern.difficulty[difficulty].speedMultiplier;
}

export interface GeometryCandidate {
  readonly x: number;
  readonly y: number;
  readonly headingDeg: number;
  readonly sourceIndex: number;
}

export function geometryCandidates(
  emitter: PatternEmitter,
  burstIndex: number,
  count: number,
): readonly GeometryCandidate[] {
  const geometry = emitter.geometry;
  const base = geometry.baseAngleDeg;
  const spread = geometry.spreadDeg;
  const anchorX = emitter.anchor.x * LOGICAL_VIEW_WIDTH;
  const anchorY = emitter.anchor.y * LOGICAL_VIEW_HEIGHT;
  const result: GeometryCandidate[] = [];
  const append = (x: number, y: number, headingDeg: number, sourceIndex: number): void => {
    result.push({x, y, headingDeg, sourceIndex});
  };

  if (["line", "grid", "wall", "lattice", "shutter"].includes(geometry.type)) {
    for (let index = 0; index < count; index += 1) {
      let x = 16 + (LOGICAL_VIEW_WIDTH - 32) * ((index + 0.5) / count);
      x = ((x + (burstIndex % 2) * (LOGICAL_VIEW_WIDTH / count) * 0.45 - 12)
        % (LOGICAL_VIEW_WIDTH - 24)) + 12;
      const angle = base + (spread ? spread * (index / Math.max(1, count - 1) - 0.5) : 0);
      append(x, anchorY, angle, index);
    }
  } else if (geometry.type === "ring" || geometry.type === "broken_ring") {
    const gap = geometry.type === "broken_ring" ? 44 : 0;
    const usable = 360 - gap;
    for (let index = 0; index < count; index += 1) {
      append(anchorX, anchorY, base + gap / 2 + usable * index / Math.max(1, count), index);
    }
  } else if (geometry.type === "cross") {
    for (let index = 0; index < count; index += 1) {
      append(anchorX, anchorY, base + (index % 4) * 90 + Math.floor(index / 4) * 8, index);
    }
  } else if (geometry.type === "spiral") {
    const rotation = burstIndex * 23 % 360;
    for (let index = 0; index < count; index += 1) {
      append(anchorX, anchorY, base + rotation + spread * index / Math.max(1, count), index);
    }
  } else if (geometry.type === "paired_fan") {
    for (let index = 0; index < count; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const rank = Math.floor(index / 2);
      const angle = base + side * spread * (rank + 0.5) / Math.max(1, Math.ceil(count / 2));
      append(anchorX + side * 8, anchorY, angle, index);
    }
  } else if (geometry.type === "history_chain") {
    for (let index = 0; index < count; index += 1) {
      append(anchorX + (index - (count - 1) / 2) * 4, anchorY - index * 3, base, index);
    }
  } else {
    for (let index = 0; index < count; index += 1) {
      const offset = count === 1 ? 0 : spread * (index / (count - 1) - 0.5);
      append(anchorX, anchorY, base + offset, index);
    }
  }
  return result;
}

export function safeGapCenter(pattern: ExecutablePattern, nowMs: number): number {
  const spec = pattern.safeGap;
  const path = spec.path;
  const center = path.centerX ?? LOGICAL_VIEW_WIDTH / 2;
  const amplitude = path.amplitudePx ?? 0;
  const period = Math.max(1000, path.periodMs ?? 6000);
  const phase = path.phase ?? 0;
  const lanes = path.laneX ?? [];
  if (lanes.length > 0) {
    if (nowMs < 900) return center;
    const inner = lanes.length > 2 ? lanes.slice(1, -1).reverse() : [];
    const route = lanes.length > 2 ? [...lanes, ...inner] : [...lanes];
    const segment = period / Math.max(1, route.length);
    const local = nowMs - 900;
    const index = Math.floor(local / segment) % route.length;
    const routeTarget = route[index] ?? center;
    const previous = local < segment ? center : (route[(index - 1 + route.length) % route.length] ?? center);
    const transitionMs = Math.min(segment, Math.max(1000, Math.abs(routeTarget - previous) / 78 * 1000));
    const blend = Math.min(1, (local % segment) / transitionMs);
    return previous + (routeTarget - previous) * blend;
  }
  if (["quantized_step", "binary_cross", "pulse_gate", "hard_lane_swap"].includes(spec.type)) {
    const triangle = 2 / Math.PI * Math.asin(Math.sin((nowMs / period + phase) * Math.PI * 2));
    return center + amplitude * triangle;
  }
  return center + amplitude * Math.sin(nowMs / period * Math.PI * 2 + phase * Math.PI * 2);
}

export function safeGapWidth(pattern: ExecutablePattern, difficulty: PatternDifficulty): number {
  return pattern.safeGap.minimumWidthPx + pattern.difficulty[difficulty].gapDeltaPx;
}

function angleTo(x: number, y: number, targetX: number, targetY: number): number {
  return Math.atan2(targetY - y, targetX - x) * 180 / Math.PI;
}

function normalizeAngle(value: number): number {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

function targetTrace(pattern: ExecutablePattern, nowMs: number): readonly [number, number] {
  return [safeGapCenter(pattern, nowMs), AUTHORED_PLAYER_Y];
}

/**
 * V4's immutable Python oracle uses ties-to-even when difficulty scales an
 * emitter count. JavaScript's Math.round uses a different half-way rule, so
 * production code must share this explicit implementation.
 */
function pythonRoundInteger(value: number): number {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction < 0.5) return floor;
  if (fraction > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

export function roundPatternCount(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("scaled pattern count must be finite and non-negative");
  }
  return pythonRoundInteger(value);
}

function roundDecimal(value: number, digits: number): number {
  const factor = 10 ** digits;
  return pythonRoundInteger(value * factor) / factor;
}

interface Bullet {
  uid: number;
  source: string;
  spawnMs: number;
  x: number;
  y: number;
  headingDeg: number;
  baseSpeed: number;
  speedCurve: readonly {readonly atMs: number; readonly pxPerSec: number}[];
  speedMultiplier: number;
  radius: number;
  motion: readonly PatternMotion[];
  collision: boolean;
  alive: boolean;
  generation: number;
  originX: number;
  originY: number;
  orbitPhase: number;
  events: Set<string>;
  homingSampleIndex: number;
}

export interface TraceFrame {
  readonly atMs: number;
  readonly gapCenterX: number;
  readonly gapWidthPx: number;
  readonly bullets: readonly (readonly [number, number, number, number, 0 | 1])[];
}

export interface TraceEmissionEvent {
  readonly atMs: number;
  readonly event: "emit";
  readonly source: string;
  readonly count: number;
}

export interface SweptCirclePrimitive {
  readonly kind: "swept-circle";
  readonly atMs: number;
  readonly projectileId: number;
  readonly sourceId: string;
  readonly generation: number;
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
  readonly radius: number;
  readonly collision: boolean;
}

export interface PatternTrace {
  readonly patternId: string;
  readonly seed: number;
  readonly difficulty: PatternDifficulty;
  readonly frames: readonly TraceFrame[];
  readonly events: readonly TraceEmissionEvent[];
  readonly omittedOrRedirected: number;
  readonly splitChildren: number;
  readonly traceSha256: string;
  readonly warningFootprint?: readonly SweptCirclePrimitive[];
}

export interface SimulatePatternOptions {
  readonly seed?: number;
  readonly difficulty?: PatternDifficulty;
  readonly dtMs?: number;
  readonly captureMs?: number;
  readonly semantics?: PatternExecutionSemantics;
  readonly collectWarningFootprint?: boolean;
}

export function sweptCirclePrimitive(
  atMs: number,
  bullet: Pick<Bullet, "uid" | "source" | "generation" | "radius" | "collision">,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): SweptCirclePrimitive {
  return Object.freeze({
    kind: "swept-circle",
    atMs,
    projectileId: bullet.uid,
    sourceId: bullet.source,
    generation: bullet.generation,
    from: Object.freeze([fromX, fromY] as const),
    to: Object.freeze([toX, toY] as const),
    radius: bullet.radius,
    collision: bullet.collision,
  });
}

export function sweptCircleContainsPoint(
  primitive: SweptCirclePrimitive,
  pointX: number,
  pointY: number,
  extraRadius = 0,
): boolean {
  const [fromX, fromY] = primitive.from;
  const [toX, toY] = primitive.to;
  const dx = toX - fromX;
  const dy = toY - fromY;
  const denominator = dx * dx + dy * dy;
  const projection = denominator === 0
    ? 0
    : Math.max(0, Math.min(1, ((pointX - fromX) * dx + (pointY - fromY) * dy) / denominator));
  const nearestX = fromX + dx * projection;
  const nearestY = fromY + dy * projection;
  return Math.hypot(pointX - nearestX, pointY - nearestY) <= primitive.radius + extraRadius;
}

function lateralWallAllows(candidateIndex: number, count: number, motion: PatternMotion): boolean {
  const laneCount = Math.max(1, Math.floor(numberParam(motion.params, "laneCount", count)));
  const openLane = Math.floor(numberParam(motion.params, "openLane", -1));
  // Application adapter for the V4-declared, left-to-right lane lattice when
  // geometry count and laneCount differ: project each candidate-bin center.
  const lane = Math.min(
    laneCount - 1,
    Math.floor((candidateIndex + 0.5) * laneCount / Math.max(1, count)),
  );
  return lane !== openLane;
}

function historyPoints(params: Readonly<Record<string, unknown>>): readonly (readonly [number, number, number])[] {
  const raw = params.points;
  if (!Array.isArray(raw)) return [];
  const points: [number, number, number][] = [];
  for (const entry of raw) {
    if (Array.isArray(entry) && entry.length >= 3 && entry.every((value) => typeof value === "number")) {
      points.push([entry[0] as number, entry[1] as number, entry[2] as number]);
    }
  }
  if (stringParam(params, "mode", "follow") !== "reverse" || points.length === 0) return points;
  const lastAt = points[points.length - 1]?.[2] ?? 0;
  return points.map(([x, y, atMs]) => [x, y, lastAt - atMs] as [number, number, number]).reverse();
}

function appendMotionSweep(
  footprint: SweptCirclePrimitive[] | undefined,
  nowMs: number,
  bullet: Bullet,
  fromX: number,
  fromY: number,
): void {
  if (footprint) footprint.push(sweptCirclePrimitive(nowMs, bullet, fromX, fromY, bullet.x, bullet.y));
}

export function simulatePattern(
  patternOrId: ExecutablePattern | string,
  options: SimulatePatternOptions = {},
): PatternTrace {
  const pattern = typeof patternOrId === "string" ? executablePattern(patternOrId) : patternOrId;
  const difficulty = options.difficulty ?? "NORMAL";
  const seed = Math.floor(options.seed ?? pattern.seed.base);
  const dtMs = options.dtMs ?? REFERENCE_STEP_MS;
  const captureMs = options.captureMs ?? REFERENCE_CAPTURE_MS;
  const semantics = options.semantics ?? "reference-v4";
  if (!Number.isFinite(dtMs) || dtMs <= 0 || !Number.isFinite(captureMs) || captureMs <= 0) {
    throw new Error("simulation dtMs and captureMs must be finite positive numbers");
  }

  const random = new Mulberry32(seed);
  const schedule = createPatternSchedule(pattern, difficulty);
  let scheduleIndex = 0;
  const bullets: Bullet[] = [];
  let nextUid = 1;
  let nowMs = 0;
  let nextCapture = 0;
  const frames: TraceFrame[] = [];
  const events: TraceEmissionEvent[] = [];
  let omitted = 0;
  let splitSpawned = 0;
  const countMultiplier = pattern.difficulty[difficulty].countMultiplier;
  const footprint = options.collectWarningFootprint ? [] as SweptCirclePrimitive[] : undefined;

  while (nowMs <= pattern.durationMs + 0.01) {
    let scheduled = schedule[scheduleIndex];
    while (scheduled && scheduled.atMs <= nowMs + 0.001) {
      scheduleIndex += 1;
      const baseCount = scheduled.emitter.geometry.count;
      const count = Math.max(1, roundPatternCount(baseCount * countMultiplier));
      const lateral = scheduled.emitter.motionStack.find((entry) => entry.operator === "op.lateral_wall");
      for (const candidate of geometryCandidates(scheduled.emitter, scheduled.burstIndex, count)) {
        if (semantics === "declared-v4" && lateral && !lateralWallAllows(candidate.sourceIndex, count, lateral)) {
          continue;
        }
        const jitter = (random.random() - 0.5)
          * Math.min(3, scheduled.emitter.geometry.spreadDeg * 0.012);
        const bullet: Bullet = {
          uid: nextUid,
          source: scheduled.emitter.id,
          spawnMs: scheduled.atMs,
          x: candidate.x,
          y: candidate.y,
          headingDeg: candidate.headingDeg + jitter,
          baseSpeed: emitterSpeed(scheduled.emitter, 0, difficulty, pattern),
          speedCurve: scheduled.emitter.speedCurve.keys,
          speedMultiplier: pattern.difficulty[difficulty].speedMultiplier,
          radius: scheduled.emitter.projectile.collisionRadiusPx,
          motion: scheduled.emitter.motionStack,
          collision: true,
          alive: true,
          generation: 0,
          originX: candidate.x,
          originY: candidate.y,
          orbitPhase: (nextUid * 0.61803398875 % 1) * Math.PI * 2,
          events: new Set<string>(),
          homingSampleIndex: -1,
        };
        const aim = motionFor(bullet, "op.aim_lock");
        if (aim && numberParam(aim.params, "lockAtMs", 0) <= 0) {
          const [targetX, targetY] = targetTrace(
            pattern,
            scheduled.atMs + numberParam(aim.params, "leadMs", 0),
          );
          const desired = angleTo(candidate.x, candidate.y, targetX, targetY);
          const maxTurn = numberParam(aim.params, "maxTurnDeg", 180);
          bullet.headingDeg += Math.max(-maxTurn, Math.min(maxTurn, normalizeAngle(desired - bullet.headingDeg)));
          bullet.events.add("aim");
        }
        bullets.push(bullet);
        nextUid += 1;
      }
      events.push({
        atMs: roundDecimal(scheduled.atMs, 3),
        event: "emit",
        source: scheduled.emitter.id,
        count,
      });
      scheduled = schedule[scheduleIndex];
    }

    const spawnedChildren: Bullet[] = [];
    for (const bullet of bullets) {
      if (!bullet.alive || bullet.spawnMs > nowMs) continue;
      const age = nowMs - bullet.spawnMs;
      const previousAge = age - dtMs;
      const movementStartX = bullet.x;
      const movementStartY = bullet.y;

      const aim = motionFor(bullet, "op.aim_lock");
      if (aim && !bullet.events.has("aim")) {
        const lockAt = numberParam(aim.params, "lockAtMs", 0);
        if (previousAge < lockAt && lockAt <= age) {
          const [targetX, targetY] = targetTrace(
            pattern,
            bullet.spawnMs + lockAt + numberParam(aim.params, "leadMs", 0),
          );
          const desired = angleTo(bullet.x, bullet.y, targetX, targetY);
          const maxTurn = numberParam(aim.params, "maxTurnDeg", 180);
          bullet.headingDeg += Math.max(-maxTurn, Math.min(maxTurn, normalizeAngle(desired - bullet.headingDeg)));
          bullet.events.add("aim");
        }
      }

      const turn = motionFor(bullet, "op.turn_once");
      if (turn && !bullet.events.has("turn")) {
        const atMs = numberParam(turn.params, "atMs", 0);
        if (previousAge < atMs && atMs <= age) {
          bullet.headingDeg += numberParam(turn.params, "deltaDeg", 0);
          bullet.events.add("turn");
        }
      }

      const homing = motionFor(bullet, "op.limited_homing");
      if (homing) {
        const start = numberParam(homing.params, "startMs", 0);
        const end = numberParam(homing.params, "endMs", 0);
        if (start <= age && age <= end) {
          const sampleEvery = Math.max(dtMs, numberParam(homing.params, "sampleEveryMs", dtMs));
          const sampleIndex = Math.floor((age - start) / sampleEvery + 1e-9);
          const sampleDue = semantics === "reference-v4" || sampleIndex > bullet.homingSampleIndex;
          if (sampleDue) {
            const [targetX, targetY] = targetTrace(pattern, nowMs);
            const desired = angleTo(bullet.x, bullet.y, targetX, targetY);
            const turnDuration = semantics === "reference-v4" ? dtMs : sampleEvery;
            const maxDelta = numberParam(homing.params, "maxDegPerSec", 0) * turnDuration / 1000;
            bullet.headingDeg += Math.max(-maxDelta, Math.min(maxDelta, normalizeAngle(desired - bullet.headingDeg)));
            bullet.homingSampleIndex = sampleIndex;
          }
        }
      }

      let speed = semantics === "declared-v4" && bullet.speedCurve.length > 0
        ? interpolateKeys(
          bullet.speedCurve as readonly Readonly<Record<string, unknown>>[],
          age,
          "pxPerSec",
        ) * bullet.speedMultiplier
        : bullet.baseSpeed;
      const envelope = motionFor(bullet, "op.speed_envelope");
      if (envelope) {
        const rawKeys = envelope.params.keys;
        const keys = Array.isArray(rawKeys)
          ? rawKeys.filter((entry): entry is Readonly<Record<string, unknown>> =>
            typeof entry === "object" && entry !== null && !Array.isArray(entry))
          : [];
        speed *= interpolateKeys(keys, age, "multiplier", stringParam(envelope.params, "interpolation", "linear"));
      }

      const dual = motionFor(bullet, "op.dual_clock_gate");
      if (dual) {
        const periodA = numberParam(dual.params, "periodAMs", 1);
        const periodB = numberParam(dual.params, "periodBMs", 1);
        const phaseOffset = numberParam(dual.params, "phaseOffsetMs", 0);
        const timeA = (nowMs % periodA) / periodA;
        const timeB = ((nowMs + phaseOffset) % periodB) / periodB;
        const gateA = timeA < numberParam(dual.params, "dutyA", 0);
        const gateB = timeB < numberParam(dual.params, "dutyB", 0);
        const gateActive = gateA !== gateB || (gateA && gateB && pattern.safeGap.type === "dual_clock_intersection");
        speed *= gateActive ? 1 : 0;
        bullet.collision = gateActive;
      }

      const history = motionFor(bullet, "op.history_replay");
      const orbit = motionFor(bullet, "op.orbit_release");
      if (history) {
        const local = Math.max(0, age - numberParam(history.params, "delayMs", 0));
        const points = historyPoints(history.params);
        const lastPoint = points[points.length - 1];
        if (lastPoint && local <= lastPoint[2]) {
          for (let index = 0; index < points.length - 1; index += 1) {
            const left = points[index];
            const right = points[index + 1];
            if (!left || !right || local > right[2]) continue;
            const progress = (local - left[2]) / Math.max(1, right[2] - left[2]);
            const offset = (bullet.uid % 7 - 3) * 2.2;
            bullet.x = left[0] + (right[0] - left[0]) * progress + offset;
            bullet.y = left[1] + (right[1] - left[1]) * progress;
            break;
          }
        } else {
          const radians = bullet.headingDeg * Math.PI / 180;
          bullet.x += Math.cos(radians) * speed * dtMs / 1000;
          bullet.y += Math.sin(radians) * speed * dtMs / 1000;
        }
      } else if (orbit && age < numberParam(orbit.params, "releaseAtMs", 0)) {
        const radius = numberParam(orbit.params, "radiusPx", 0);
        const theta = bullet.orbitPhase
          + numberParam(orbit.params, "angularDegPerSec", 0) * Math.PI / 180 * age / 1000;
        bullet.x = bullet.originX + Math.cos(theta) * radius;
        bullet.y = bullet.originY + Math.sin(theta) * radius;
      } else {
        if (orbit && !bullet.events.has("released")) {
          bullet.headingDeg = numberParam(orbit.params, "releaseHeadingDeg", bullet.headingDeg);
          bullet.events.add("released");
        }
        let extraX = 0;
        let extraY = 0;
        const vectorBias = motionFor(bullet, "op.local_vector_bias");
        if (vectorBias) {
          const period = numberParam(vectorBias.params, "pulsePeriodMs", 1);
          const pulse = Math.sin(nowMs / period * Math.PI * 2)
            * numberParam(vectorBias.params, "pulseAmount", 0);
          const [vectorX, vectorY] = numberPairParam(vectorBias.params, "vectorPxPerSec");
          extraX += vectorX * (1 + pulse);
          extraY += vectorY * (1 + pulse);
        }
        if (semantics === "declared-v4") {
          const lateral = motionFor(bullet, "op.lateral_wall");
          if (lateral) extraX += numberParam(lateral.params, "driftPxPerSec", 0);
        }
        const radians = bullet.headingDeg * Math.PI / 180;
        bullet.x += (Math.cos(radians) * speed + extraX) * dtMs / 1000;
        bullet.y += (Math.sin(radians) * speed + extraY) * dtMs / 1000;
      }
      appendMotionSweep(footprint, nowMs, bullet, movementStartX, movementStartY);

      const seam = motionFor(bullet, "op.seam_transform");
      if (seam && !bullet.events.has("seam")) {
        const seamX = numberParam(seam.params, "seamX", LOGICAL_VIEW_WIDTH / 2);
        const referenceCrossing = Math.abs(bullet.x - seamX) <= 2.5;
        const strictCrossing = (movementStartX - seamX) * (bullet.x - seamX) <= 0
          && movementStartX !== bullet.x;
        if (semantics === "reference-v4" ? referenceCrossing : strictCrossing) {
          const beforeX = bullet.x;
          const beforeY = bullet.y;
          const mode = stringParam(seam.params, "mode", "swap_velocity");
          if (mode === "mirror") {
            bullet.x = LOGICAL_VIEW_WIDTH - bullet.x;
            bullet.headingDeg = 180 - bullet.headingDeg;
          } else if (mode === "offset") {
            const sign = Math.cos(bullet.headingDeg * Math.PI / 180) >= 0 ? 1 : -1;
            bullet.x += numberParam(seam.params, "offsetPx", 0) * sign;
          } else {
            bullet.headingDeg = 180 - bullet.headingDeg;
          }
          bullet.events.add("seam");
          appendMotionSweep(footprint, nowMs, bullet, beforeX, beforeY);
        }
      }

      const split = motionFor(bullet, "op.split_generation");
      if (split && !bullet.events.has("split")
        && bullet.generation < Math.floor(numberParam(split.params, "maxGeneration", 1))) {
        const atMs = numberParam(split.params, "atMs", 0);
        if (previousAge < atMs && atMs <= age) {
          const childCount = Math.max(0, Math.floor(numberParam(split.params, "children", 0)));
          const spread = numberParam(split.params, "spreadDeg", 0);
          for (let childIndex = 0; childIndex < childCount; childIndex += 1) {
            const offset = childCount === 1 ? 0 : spread * (childIndex / (childCount - 1) - 0.5);
            const child: Bullet = {
              uid: nextUid,
              source: bullet.source,
              spawnMs: nowMs,
              x: bullet.x,
              y: bullet.y,
              headingDeg: bullet.headingDeg + offset,
              baseSpeed: speed * numberParam(split.params, "speedMultiplier", 1),
              // A child inherits the split instant's resolved speed. Replaying the
              // parent's source-age curve would create a second, unauthored clock.
              speedCurve: [],
              speedMultiplier: 1,
              radius: bullet.radius,
              motion: bullet.motion.filter((entry) => entry.operator !== "op.split_generation"),
              collision: true,
              alive: true,
              generation: bullet.generation + 1,
              originX: bullet.x,
              originY: bullet.y,
              orbitPhase: 0,
              events: new Set<string>(),
              homingSampleIndex: -1,
            };
            spawnedChildren.push(child);
            if (footprint) footprint.push(sweptCirclePrimitive(nowMs, child, child.x, child.y, child.x, child.y));
            nextUid += 1;
            splitSpawned += 1;
          }
          bullet.events.add("split");
          bullet.alive = false;
        }
      }

      if (bullet.alive && bullet.collision && bullet.y >= 476 && bullet.y <= 622) {
        const center = safeGapCenter(pattern, nowMs);
        const halfWidth = safeGapWidth(pattern, difficulty) / 2 + bullet.radius + 2;
        if (Math.abs(bullet.x - center) < halfWidth) {
          const beforeX = bullet.x;
          const beforeY = bullet.y;
          if (pattern.safeGap.enforcement === "operator_constraint"
            || pattern.safeGap.enforcement === "seam_redirect") {
            const side = bullet.x <= center ? -1 : 1;
            bullet.x = center + side * halfWidth;
            bullet.headingDeg += side * 8;
            appendMotionSweep(footprint, nowMs, bullet, beforeX, beforeY);
          } else {
            bullet.alive = false;
          }
          omitted += 1;
        }
      }

      if (bullet.x < -96 || bullet.x > LOGICAL_VIEW_WIDTH + 96
        || bullet.y < -128 || bullet.y > LOGICAL_VIEW_HEIGHT + 128) {
        bullet.alive = false;
      }
    }

    bullets.push(...spawnedChildren);
    if (nowMs + 0.001 >= nextCapture) {
      const visible: [number, number, number, number, 0 | 1][] = [];
      for (const bullet of bullets) {
        if (bullet.alive && bullet.x >= -8 && bullet.x <= LOGICAL_VIEW_WIDTH + 8
          && bullet.y >= -8 && bullet.y <= LOGICAL_VIEW_HEIGHT + 8) {
          visible.push([
            bullet.uid,
            roundDecimal(bullet.x, 3),
            roundDecimal(bullet.y, 3),
            roundDecimal(bullet.radius, 2),
            bullet.collision ? 1 : 0,
          ]);
        }
      }
      frames.push({
        atMs: roundDecimal(nowMs, 3),
        gapCenterX: roundDecimal(safeGapCenter(pattern, nowMs), 3),
        gapWidthPx: safeGapWidth(pattern, difficulty),
        bullets: visible,
      });
      nextCapture += captureMs;
    }
    nowMs += dtMs;
  }

  const payloadWithoutHash = {
    patternId: pattern.id,
    seed,
    difficulty,
    frames,
    events,
    omittedOrRedirected: omitted,
    splitChildren: splitSpawned,
  };
  const traceSha256 = sha256(new TextEncoder().encode(pythonCanonicalTrace(payloadWithoutHash)));
  return footprint
    ? {...payloadWithoutHash, traceSha256, warningFootprint: Object.freeze(footprint)}
    : {...payloadWithoutHash, traceSha256};
}

function isPythonFloatPath(path: readonly (string | number)[]): boolean {
  if (path[0] === "events" && typeof path[1] === "number" && path[2] === "atMs") return true;
  if (path[0] !== "frames" || typeof path[1] !== "number") return false;
  if (["atMs", "gapCenterX", "gapWidthPx"].includes(String(path[2]))) return true;
  return path[2] === "bullets" && typeof path[3] === "number"
    && typeof path[4] === "number" && [1, 2, 3].includes(path[4]);
}

/** Python-compatible canonical JSON for the V4 trace hash field provenance. */
export function pythonCanonicalTrace(value: unknown): string {
  const encode = (entry: unknown, path: readonly (string | number)[]): string => {
    if (entry === null) return "null";
    if (typeof entry === "boolean") return entry ? "true" : "false";
    if (typeof entry === "string") return JSON.stringify(entry);
    if (typeof entry === "number") {
      if (!Number.isFinite(entry)) throw new Error("canonical trace cannot encode a non-finite number");
      if (isPythonFloatPath(path)) {
        if (Object.is(entry, -0)) return "-0.0";
        if (Number.isInteger(entry)) return `${entry}.0`;
      }
      return String(entry);
    }
    if (Array.isArray(entry)) {
      return `[${entry.map((item, index) => encode(item, [...path, index])).join(",")}]`;
    }
    if (typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      const keys = Object.keys(record).sort(compareCodePoints);
      return `{${keys.map((key) => `${JSON.stringify(key)}:${encode(record[key], [...path, key])}`).join(",")}}`;
    }
    throw new Error(`canonical trace cannot encode ${typeof entry}`);
  };
  return encode(value, []);
}

export interface ReachablePathResult {
  readonly pass: boolean;
  readonly focus: boolean;
  readonly failedAtMs: number | null;
  readonly minimumClearancePx: number;
  readonly sampleCount: number;
  readonly pathHash?: string;
}

export function reachablePath(
  pattern: ExecutablePattern,
  trace: PatternTrace,
  focus: boolean,
): ReachablePathResult {
  const gridStep = 4;
  const positions = Array.from(
    {length: Math.floor((LOGICAL_VIEW_WIDTH - 24) / gridStep) + 1},
    (_, index) => 12 + index * gridStep,
  );
  const speed = focus
    ? PLAYER_FOCUS_MAX_SPEED_PX_PER_SECOND
    : PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND;
  const playerRadius = focus ? 2 : 3;
  let reachable = new Set([nearestIndex(positions, LOGICAL_VIEW_WIDTH / 2)]);
  const pathIndices: number[] = [];
  let previousAt = 0;
  let minimumClearance = 999;
  for (const frame of trace.frames) {
    const deltaSeconds = Math.max(0.001, (frame.atMs - previousAt) / 1000);
    previousAt = frame.atMs;
    const steps = Math.max(1, Math.ceil(speed * deltaSeconds / gridStep));
    const hazards = frame.bullets
      .filter((bullet) => bullet[4] === 1 && Math.abs(bullet[2] - AUTHORED_PLAYER_Y) < 18)
      .map((bullet) => [bullet[1], bullet[2], bullet[3]] as const);
    const safe = new Set<number>();
    positions.forEach((x, index) => {
      let clearance = 999;
      for (const [bulletX, bulletY, radius] of hazards) {
        clearance = Math.min(
          clearance,
          Math.hypot(x - bulletX, AUTHORED_PLAYER_Y - bulletY) - (playerRadius + radius),
        );
      }
      if (clearance > 0) safe.add(index);
    });
    const next = new Set<number>();
    for (const index of safe) {
      if ([...reachable].some((prior) => Math.abs(index - prior) <= steps)) next.add(index);
    }
    if (next.size === 0) {
      return {
        pass: false,
        focus,
        failedAtMs: frame.atMs,
        minimumClearancePx: roundDecimal(minimumClearance, 3),
        sampleCount: pathIndices.length,
      };
    }
    const target = frame.gapCenterX;
    const chosen = [...next].reduce((best, index) =>
      Math.abs((positions[index] ?? 0) - target) < Math.abs((positions[best] ?? 0) - target) ? index : best);
    pathIndices.push(chosen);
    reachable = next;
    if (hazards.length > 0) {
      const chosenX = positions[chosen] ?? 0;
      for (const [bulletX, bulletY, radius] of hazards) {
        minimumClearance = Math.min(
          minimumClearance,
          Math.hypot(chosenX - bulletX, AUTHORED_PLAYER_Y - bulletY) - (playerRadius + radius),
        );
      }
    }
  }
  return {
    pass: true,
    focus,
    failedAtMs: null,
    minimumClearancePx: roundDecimal(
      minimumClearance < 999 ? minimumClearance : pattern.safeGap.minimumWidthPx / 2,
      3,
    ),
    sampleCount: pathIndices.length,
    pathHash: sha256(new TextEncoder().encode(JSON.stringify(pathIndices))),
  };
}

function nearestIndex(values: readonly number[], target: number): number {
  let best = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (Math.abs((values[index] ?? 0) - target) < Math.abs((values[best] ?? 0) - target)) best = index;
  }
  return best;
}

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

export function sha256(bytes: Uint8Array): string {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);
  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const first = words[index - 15] ?? 0;
      const second = words[index - 2] ?? 0;
      const sigma0 = rotateRight(first, 7) ^ rotateRight(first, 18) ^ (first >>> 3);
      const sigma1 = rotateRight(second, 17) ^ rotateRight(second, 19) ^ (second >>> 10);
      words[index] = ((words[index - 16] ?? 0) + sigma0 + (words[index - 7] ?? 0) + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const upper = rotateRight(e ?? 0, 6) ^ rotateRight(e ?? 0, 11) ^ rotateRight(e ?? 0, 25);
      const choice = ((e ?? 0) & (f ?? 0)) ^ (~(e ?? 0) & (g ?? 0));
      const temp1 = ((h ?? 0) + upper + choice + (constants[index] ?? 0) + (words[index] ?? 0)) >>> 0;
      const lower = rotateRight(a ?? 0, 2) ^ rotateRight(a ?? 0, 13) ^ rotateRight(a ?? 0, 22);
      const majority = ((a ?? 0) & (b ?? 0)) ^ ((a ?? 0) & (c ?? 0)) ^ ((b ?? 0) & (c ?? 0));
      const temp2 = (lower + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = ((d ?? 0) + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = ((hash[0] ?? 0) + (a ?? 0)) >>> 0;
    hash[1] = ((hash[1] ?? 0) + (b ?? 0)) >>> 0;
    hash[2] = ((hash[2] ?? 0) + (c ?? 0)) >>> 0;
    hash[3] = ((hash[3] ?? 0) + (d ?? 0)) >>> 0;
    hash[4] = ((hash[4] ?? 0) + (e ?? 0)) >>> 0;
    hash[5] = ((hash[5] ?? 0) + (f ?? 0)) >>> 0;
    hash[6] = ((hash[6] ?? 0) + (g ?? 0)) >>> 0;
    hash[7] = ((hash[7] ?? 0) + (h ?? 0)) >>> 0;
  }
  return Array.from(hash, (part) => part.toString(16).padStart(8, "0")).join("");
}
