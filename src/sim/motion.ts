/**
 * The motion DSL — polar velocity with derivatives, clamps and reflection.
 *
 * This is the language every bullet pattern is written in, and it is the most
 * valuable thing inherited from upstream: entirely engine-agnostic, with no
 * rendering coupling. A pattern is a timeline of these segments.
 *
 * Angles are **degrees**, and the coordinate space is **y-down** (screen
 * space), so `theta = 90` moves downward — the default for falling shot.
 * Distances are **pixels per tick**. Never per second: see CLAUDE.md, rule 1.
 */

import { sim, type Random } from '../core/random';

export interface Range {
  min?: number;
  max?: number;
}

export interface MotionParams {
  /** Speed, px/tick. */
  r?: number;
  /** Heading, degrees. 0 = right, 90 = down. */
  theta?: number;
  /** Angular velocity, degrees/tick. */
  w?: number;
  /** Acceleration of `r`. */
  ra?: number;
  /** Acceleration of `w`. */
  wa?: number;
  /** Second derivative of `r`. */
  raa?: number;
  /** Second derivative of `w`. */
  waa?: number;

  /** Clamps, applied after every step. */
  rrange?: Range;
  trange?: Range;
  wrange?: Range;
  rarange?: Range;
  warange?: Range;

  /** Randomized initial values, drawn once at init from the sim stream. */
  rrandom?: Range;
  trandom?: Range;
  wrandom?: Range;

  /** Constant acceleration applied in cartesian space, e.g. gravity. */
  gravity?: { x?: number; y?: number };

  /** Aim at the current player position when this segment begins. */
  aimed?: boolean;

  /** Named behaviour from the registry, applied every step. */
  behaviour?: string;
  /** Free-form parameters handed to the named behaviour. */
  options?: Readonly<Record<string, number>>;
}

/** Context a behaviour may read. Keep this small — it is the extension surface. */
export interface MotionContext {
  /** Ticks since this motion segment began. */
  age: number;
  /** Current entity position, screen space. */
  x: number;
  y: number;
  /** Position of the entity being aimed at, if any. */
  targetX: number;
  targetY: number;
}

/**
 * A behaviour mutates a vector each tick. This is the extension point for
 * motion the polar model cannot express — homing, splines, noise fields.
 *
 * Behaviours run inside the simulation, so they must be deterministic: draw
 * only from the passed generator, never from `Math.random` or wall time.
 */
export type MotionBehaviour = (
  vector: MoveVector,
  context: MotionContext,
  rng: Random,
) => void;

const behaviours = new Map<string, MotionBehaviour>();

/** Register a named motion behaviour. Patterns reference it by name. */
export function defineBehaviour(name: string, behaviour: MotionBehaviour): void {
  if (behaviours.has(name)) {
    throw new Error(`motion behaviour "${name}" is already defined`);
  }
  behaviours.set(name, behaviour);
}

export function getBehaviour(name: string): MotionBehaviour | undefined {
  return behaviours.get(name);
}

const DEG_TO_RAD = Math.PI / 180;

function clamp(value: number, range: Range | undefined): number {
  if (range === undefined) return value;
  if (range.max !== undefined && value > range.max) return range.max;
  if (range.min !== undefined && value < range.min) return range.min;
  return value;
}

export class MoveVector {
  r = 0;
  theta = 90;
  w = 0;
  ra = 0;
  wa = 0;
  raa = 0;
  waa = 0;

  gravityX = 0;
  gravityY = 0;
  /** Cartesian velocity accumulated from gravity, added on top of the polar term. */
  driftX = 0;
  driftY = 0;

  rrange: Range | undefined;
  trange: Range | undefined;
  wrange: Range | undefined;
  rarange: Range | undefined;
  warange: Range | undefined;

  reflectCount = 0;
  age = 0;

  #behaviour: MotionBehaviour | undefined;
  #options: Readonly<Record<string, number>> = {};

  /** Reset to defaults, then apply params. Pools reuse instances via this. */
  init(params: MotionParams = {}, rng: Random = sim): void {
    this.r = params.r ?? 0;
    this.theta = params.theta ?? 90;
    this.w = params.w ?? 0;
    this.ra = params.ra ?? 0;
    this.wa = params.wa ?? 0;
    this.raa = params.raa ?? 0;
    this.waa = params.waa ?? 0;

    this.rrange = params.rrange;
    this.trange = params.trange;
    this.wrange = params.wrange;
    this.rarange = params.rarange;
    this.warange = params.warange;

    this.gravityX = params.gravity?.x ?? 0;
    this.gravityY = params.gravity?.y ?? 0;
    this.driftX = 0;
    this.driftY = 0;

    this.reflectCount = 0;
    this.age = 0;

    // Randomized values are drawn here, in declaration order. That order is
    // part of the determinism contract — reordering these three lines changes
    // every subsequent draw.
    if (params.rrandom) this.r = randomIn(params.rrandom, rng);
    if (params.trandom) this.theta = randomIn(params.trandom, rng);
    if (params.wrandom) this.w = randomIn(params.wrandom, rng);

    this.#options = params.options ?? {};
    this.#behaviour = params.behaviour ? behaviours.get(params.behaviour) : undefined;
    if (params.behaviour && !this.#behaviour) {
      throw new Error(`unknown motion behaviour "${params.behaviour}"`);
    }
  }

  /** Point this vector at a position, preserving speed. */
  aimAt(fromX: number, fromY: number, toX: number, toY: number): void {
    this.theta = Math.atan2(toY - fromY, toX - fromX) / DEG_TO_RAD;
  }

  step(context: MotionContext, rng: Random = sim): void {
    this.theta += this.w;
    this.r += this.ra;
    this.w += this.wa;
    this.ra += this.raa;
    this.wa += this.waa;

    this.theta = clamp(this.theta, this.trange);
    this.r = clamp(this.r, this.rrange);
    this.w = clamp(this.w, this.wrange);
    this.ra = clamp(this.ra, this.rarange);
    this.wa = clamp(this.wa, this.warange);

    this.driftX += this.gravityX;
    this.driftY += this.gravityY;

    this.#behaviour?.(this, context, rng);
    this.age++;
  }

  get options(): Readonly<Record<string, number>> {
    return this.#options;
  }

  moveX(): number {
    return this.r * Math.cos(this.theta * DEG_TO_RAD) + this.driftX;
  }

  moveY(): number {
    return this.r * Math.sin(this.theta * DEG_TO_RAD) + this.driftY;
  }

  /** Reverse direction. */
  reflect(): void {
    this.theta += 180;
    this.driftX = -this.driftX;
    this.driftY = -this.driftY;
    this.reflectCount++;
  }

  /** Bounce off a vertical wall. */
  reflectX(): void {
    this.theta = 180 - this.theta;
    this.driftX = -this.driftX;
    this.reflectCount++;
  }

  /** Bounce off a horizontal wall. */
  reflectY(): void {
    this.theta = 360 - this.theta;
    this.driftY = -this.driftY;
    this.reflectCount++;
  }
}

function randomIn(range: Range, rng: Random): number {
  const min = range.min ?? 0;
  const max = range.max ?? 0;
  if (max <= min) return min;
  return min + Math.floor(rng.random() * (max - min));
}

/**
 * One entry in a motion timeline: switch to `motion` at tick `count`.
 *
 * `jump` makes the timeline loop — on reaching this entry, control returns to
 * the segment at that index. Upstream expressed this by putting a bare number
 * where a params object was expected; naming it costs nothing and stops the
 * pattern data from being a riddle.
 */
export interface MotionSegment {
  count: number;
  motion?: MotionParams;
  jump?: number;
}

/** Drives a MoveVector through a list of segments. */
export class MotionTimeline {
  #segments: readonly MotionSegment[];
  #index = 0;
  #elapsed = 0;

  constructor(segments: readonly MotionSegment[] = []) {
    this.#segments = segments;
  }

  reset(segments: readonly MotionSegment[] = this.#segments): void {
    this.#segments = segments;
    this.#index = 0;
    this.#elapsed = 0;
  }

  /**
   * Advance one tick, applying any segment that becomes due.
   * Returns true if the vector was re-initialised this tick.
   */
  step(vector: MoveVector, rng: Random = sim): boolean {
    let changed = false;

    // `while`, not `if`: several segments may share a count, and a jump can
    // land on one that is already due.
    let guard = 0;
    while (this.#index < this.#segments.length && guard++ < 64) {
      const segment = this.#segments[this.#index];
      if (segment === undefined || this.#elapsed < segment.count) break;

      if (segment.jump !== undefined) {
        this.#index = segment.jump;
        this.#elapsed = 0;
        continue;
      }

      if (segment.motion) {
        vector.init(segment.motion, rng);
        changed = true;
      }
      this.#index++;
    }

    this.#elapsed++;
    return changed;
  }
}
