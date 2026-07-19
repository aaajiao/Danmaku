/**
 * Enemies and the enemy registry.
 *
 * An enemy is a hitbox that moves along the motion DSL and owns a set of
 * running patterns. Everything specific to one enemy lives in its `EnemySpec`,
 * registered by name, so a stage adds new opposition by writing a file rather
 * than by editing anything here.
 *
 * Upstream spread this across `Enemy.js`, `enemies_params.js` and a switch in
 * the stage runner that knew every enemy type by name. The registry replaces
 * the switch; the spec replaces the params table.
 *
 * Deaths are **recorded, not dispatched**. `damage` can be called from the
 * middle of a caller's collision sweep, and a callback firing there would run
 * arbitrary game code while this system's live list is being rewritten.
 * `drainDeaths` hands the list over at a moment the caller chooses.
 */

import { Emitter } from '../content/patterns';
import { Pool } from '../core/pool';
import { sim, type Random } from '../core/random';
import type { BulletSystem, FieldBounds } from './bullet';
import { circlesOverlap } from './collision';
import { MotionTimeline, MoveVector, type MotionParams, type MotionSegment } from './motion';

/**
 * One pattern an enemy runs. `startAt` and `stopAt` are ticks since the enemy
 * spawned, not since the stage began — an enemy's script must not depend on
 * when the stage happened to release it.
 */
export interface EnemyPattern {
  pattern: string;
  options?: Record<string, unknown>;
  startAt?: number;
  stopAt?: number;
}

export interface EnemySpec {
  /** Atlas cell name. */
  sprite: string;
  hp: number;
  /** Collision radius. */
  radius: number;
  /** Rendered size. Defaults to the sprite cell size. */
  width?: number;
  height?: number;
  motion?: MotionParams;
  /** Optional motion timeline; segments re-init the vector as they fall due. */
  timeline?: readonly MotionSegment[];
  tint?: { r?: number; g?: number; b?: number };
  patterns?: readonly EnemyPattern[];
  drops?: { power?: number; score?: number };
  scoreValue?: number;
  /** Effect names emitted on hit and on death. Resolved by the effect system. */
  onHit?: string;
  onDeath?: string;
  /**
   * How far outside the field this enemy may roam before being culled.
   * Defaults to the field's own margin. Raise it for something that dives off
   * the edge and is meant to come back.
   */
  despawnMargin?: number;
}

const registry = new Map<string, EnemySpec>();

export function defineEnemy(name: string, spec: EnemySpec): void {
  if (registry.has(name)) {
    throw new Error(`enemy "${name}" is already defined`);
  }
  registry.set(name, spec);
}

export function getEnemySpec(name: string): EnemySpec {
  const spec = registry.get(name);
  if (!spec) throw new Error(`unknown enemy "${name}"`);
  return spec;
}

export function enemyNames(): readonly string[] {
  return [...registry.keys()];
}

/** Placeholder for a pooled enemy that has never been spawned. */
const UNSPAWNED: EnemySpec = { sprite: 'orb.medium', hp: 1, radius: 8 };

export class Enemy {
  x = 0;
  y = 0;
  hp = 1;
  age = 0;
  alive = false;
  /** Render rotation, radians. Nothing in the sim writes it; content may. */
  angle = 0;

  readonly vector = new MoveVector();
  readonly timeline = new MotionTimeline();

  spec: EnemySpec = UNSPAWNED;
  name = '';

  /** Whether this enemy's spec supplied a timeline. Read by the system's step. */
  hasTimeline = false;

  /**
   * True once the enemy has been inside the field. Enemies are authored to
   * spawn offscreen and fly in, so the edge cull cannot apply before this or
   * every entrance would be culled on the tick it was created.
   *
   * The cost: an enemy that spawns outside and travels further out is never
   * culled. That is a content bug, and the pool ceiling bounds its damage.
   */
  entered = false;

  /**
   * One slot per spec pattern, in declaration order. Undefined means the slot
   * is not running, which covers both "not started yet" and "finished";
   * `#retired` tells those apart so a stopped pattern is never restarted.
   */
  readonly #emitters: (Emitter | undefined)[] = [];
  readonly #retired: boolean[] = [];

  reset(): void {
    this.alive = false;
    this.age = 0;
    this.hasTimeline = false;
    this.entered = false;
    this.#emitters.length = 0;
    this.#retired.length = 0;
  }

  spawn(name: string, spec: EnemySpec, x: number, y: number, rng: Random): void {
    this.name = name;
    this.spec = spec;
    this.x = x;
    this.y = y;
    this.hp = spec.hp;
    this.age = 0;
    this.angle = 0;
    this.alive = true;
    this.entered = false;

    this.vector.init(spec.motion ?? {}, rng);
    this.hasTimeline = spec.timeline !== undefined;
    if (spec.timeline) this.timeline.reset(spec.timeline);

    // Every slot is rebuilt rather than trimmed: a reused enemy with fewer
    // patterns than its predecessor would otherwise inherit live emitters
    // past the end of its own list and keep firing the last enemy's fire.
    const count = spec.patterns?.length ?? 0;
    this.#emitters.length = count;
    this.#retired.length = count;
    for (let i = 0; i < count; i++) {
      this.#emitters[i] = undefined;
      this.#retired[i] = false;
    }
  }

  /**
   * Advance every pattern slot. Emitters are built on the tick their `startAt`
   * falls due and dropped at `stopAt`, so a pattern that never runs never
   * costs an allocation, and a finite one stops holding its closure the moment
   * it reports completion.
   */
  stepPatterns(
    bullets: BulletSystem,
    targetX: number,
    targetY: number,
    rng: Random,
  ): void {
    const patterns = this.spec.patterns;
    if (patterns === undefined) return;

    for (let i = 0; i < patterns.length; i++) {
      const slot = patterns[i];
      if (slot === undefined || this.#retired[i]) continue;

      if (slot.stopAt !== undefined && this.age >= slot.stopAt) {
        this.#emitters[i] = undefined;
        this.#retired[i] = true;
        continue;
      }
      if (this.age < (slot.startAt ?? 0)) continue;

      let emitter = this.#emitters[i];
      if (emitter === undefined) {
        emitter = new Emitter(slot.pattern, this.x, this.y, 'enemy', slot.options);
        this.#emitters[i] = emitter;
      }

      // The emitter carries its own position and the enemy has just moved.
      emitter.x = this.x;
      emitter.y = this.y;
      emitter.step(bullets, targetX, targetY, rng);

      // A finite pattern reports completion by returning false. Retire the
      // slot, or the next tick would build a fresh emitter and restart it.
      if (!emitter.alive) {
        this.#emitters[i] = undefined;
        this.#retired[i] = true;
      }
    }
  }
}

export interface EnemySystemOptions {
  bounds: FieldBounds;
  bullets: BulletSystem;
  initial?: number;
  max?: number;
}

/** A death worth reacting to — score, drops, effects. Culling is not one. */
export interface EnemyDeath {
  name: string;
  x: number;
  y: number;
  spec: EnemySpec;
}

export class EnemySystem {
  readonly enemies: Enemy[] = [];
  readonly #pool: Pool<Enemy>;
  readonly #bounds: FieldBounds;
  readonly #bullets: BulletSystem;

  /** Double-buffered so a drain on a quiet tick still costs no allocation. */
  #deaths: EnemyDeath[] = [];
  #spare: EnemyDeath[] = [];

  /** Spawns refused because the pool was at its ceiling. */
  droppedSpawns = 0;

  constructor(options: EnemySystemOptions) {
    this.#bounds = options.bounds;
    this.#bullets = options.bullets;
    this.#pool = new Pool(() => new Enemy(), {
      initial: options.initial ?? 64,
      max: options.max ?? 512,
      reset: (e) => e.reset(),
    });
  }

  /** Throws on an unknown name: a typo in stage data must not fail silently. */
  spawn(name: string, x: number, y: number, rng: Random = sim): Enemy | undefined {
    const spec = getEnemySpec(name);
    const enemy = this.#pool.acquire();
    if (!enemy) {
      this.droppedSpawns++;
      return undefined;
    }
    enemy.spawn(name, spec, x, y, rng);
    this.enemies.push(enemy);
    return enemy;
  }

  step(targetX: number, targetY: number, rng: Random = sim): void {
    const { width, height, margin } = this.#bounds;
    const context = { age: 0, x: 0, y: 0, targetX, targetY };

    let write = 0;
    for (let read = 0; read < this.enemies.length; read++) {
      const e = this.enemies[read];
      if (e === undefined) continue;

      if (e.hasTimeline) {
        // Timeline first: a segment falling due this tick must apply before
        // the move it describes.
        e.timeline.step(e.vector, rng);
      }

      context.age = e.age;
      context.x = e.x;
      context.y = e.y;
      e.vector.step(context, rng);

      e.x += e.vector.moveX();
      e.y += e.vector.moveY();

      // Patterns fire from where the enemy now is, and gate on the age it
      // entered the tick with, so `startAt: 0` fires on its very first tick.
      e.stepPatterns(this.#bullets, targetX, targetY, rng);
      e.age++;

      const reach = e.spec.despawnMargin ?? margin;
      const outside =
        e.x < -reach || e.x > width + reach || e.y < -reach || e.y > height + reach;
      if (!outside) e.entered = true;

      // Culling is silent. Leaving the field is not a death and must not pay
      // score, drops or a death effect.
      if (outside && e.entered) {
        e.alive = false;
        this.#pool.release(e);
        continue;
      }

      this.enemies[write++] = e;
    }
    this.enemies.length = write;
  }

  /** Returns true if this damage killed it. */
  damage(enemy: Enemy, amount: number): boolean {
    // Two player bullets can land on the same enemy in one sweep. Without this
    // guard the second would record a second death, paying its score twice.
    if (!enemy.alive) return false;

    enemy.hp -= amount;
    if (enemy.hp > 0) return false;

    enemy.alive = false;
    // Snapshot rather than hand over the enemy: it returns to the pool below
    // and its position is reused long before the caller drains.
    this.#deaths.push({ name: enemy.name, x: enemy.x, y: enemy.y, spec: enemy.spec });

    const index = this.enemies.indexOf(enemy);
    // splice, not swap-remove: spawn order is draw order, and a swap would
    // make the render list jump every time something died.
    if (index >= 0) this.enemies.splice(index, 1);
    this.#pool.release(enemy);
    return true;
  }

  /** Nearest live enemy to a point, for homing shot. */
  nearest(x: number, y: number): Enemy | undefined {
    let best: Enemy | undefined;
    let bestDistance = Infinity;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = e;
      }
    }
    return best;
  }

  /**
   * Enemies overlapping a circle — for player-shot collision.
   *
   * A linear scan, deliberately. `BulletSystem.hitTest` rebuilds a broad-phase
   * grid per call because it faces thousands of bullets; enemies number in the
   * tens, where building the grid costs more than the scan it would save.
   */
  hitTest(x: number, y: number, radius: number): Enemy | undefined {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (circlesOverlap(x, y, radius, e.x, e.y, e.spec.radius)) return e;
    }
    return undefined;
  }

  /**
   * Deaths recorded since the last drain, oldest first.
   *
   * The returned array is recycled by the next drain — read it or copy it
   * before then.
   */
  drainDeaths(): readonly EnemyDeath[] {
    const drained = this.#deaths;
    this.#deaths = this.#spare;
    this.#deaths.length = 0;
    this.#spare = drained;
    return drained;
  }

  /**
   * Empty the field. Clearing is not killing, so it records no deaths — but it
   * also does not discard deaths already recorded this tick, which are real
   * and still owed to the caller.
   */
  clear(): void {
    for (const e of this.enemies) {
      e.alive = false;
      this.#pool.release(e);
    }
    this.enemies.length = 0;
  }

  get count(): number {
    return this.enemies.length;
  }

  get poolSize(): number {
    return this.#pool.size;
  }

  get poolGrowth(): number {
    return this.#pool.growthCount;
  }
}

/* ------------------------------------------------------------------ */
/* Example content                                                     */
/* ------------------------------------------------------------------ */

/**
 * Enough real enemies for a stage to script against. These live here only
 * until there is a `content/enemies.ts` to hold them; nothing in the system
 * above knows they exist.
 */

const ENEMY_SHOT = {
  style: { sprite: 'orb.small', r: 1, g: 0.45, b: 0.75 },
  radius: 3,
  motion: { r: 2.4, theta: 90 },
};

const HEAVY_SHOT = {
  style: { sprite: 'scale', r: 0.55, g: 0.85, b: 1, orientToHeading: true },
  radius: 4,
  motion: { r: 1.8, theta: 90 },
};

defineEnemy('grunt', {
  sprite: 'orb.large',
  hp: 12,
  radius: 11,
  tint: { r: 1, g: 0.8, b: 0.85 },
  motion: { r: 1.6, theta: 90 },
  // Silent for its first half-second, so a wave that spawns on top of the
  // player is still readable before it starts shooting.
  patterns: [
    {
      pattern: 'aimed-fan',
      options: { spec: ENEMY_SHOT, count: 3, spread: 24, period: 50 },
      startAt: 30,
    },
  ],
  drops: { power: 1, score: 100 },
  scoreValue: 100,
  onHit: 'hit',
  onDeath: 'explosion',
});

defineEnemy('weaver', {
  sprite: 'ring',
  hp: 24,
  radius: 14,
  tint: { r: 0.7, g: 1, b: 0.85 },
  // Dives in, sweeps across while firing, then leaves under its own power.
  timeline: [
    { count: 0, motion: { r: 3, theta: 90 } },
    { count: 40, motion: { r: 2, theta: 0, w: 3 } },
    { count: 90, motion: { r: 3.5, theta: 270 } },
  ],
  patterns: [
    {
      pattern: 'spiral',
      options: { spec: ENEMY_SHOT, arms: 2, step: 17, period: 5 },
      startAt: 40,
      stopAt: 90,
    },
  ],
  drops: { power: 2, score: 300 },
  scoreValue: 300,
  onHit: 'hit',
  onDeath: 'explosion',
});

defineEnemy('turret', {
  sprite: 'halo',
  hp: 60,
  radius: 18,
  width: 40,
  height: 40,
  tint: { r: 0.85, g: 0.9, b: 1 },
  motion: { r: 0.4, theta: 90 },
  patterns: [
    {
      pattern: 'ring',
      options: { spec: HEAVY_SHOT, count: 12, period: 70, rotation: 9 },
      startAt: 20,
    },
    {
      pattern: 'spray',
      options: { spec: ENEMY_SHOT, count: 2, period: 24, spread: 50 },
      startAt: 120,
    },
  ],
  // It crawls in from well above the field and is meant to survive the trip.
  despawnMargin: 96,
  drops: { power: 3, score: 1000 },
  scoreValue: 1000,
  onHit: 'hit',
  // The heaviest thing in the cast, so it gets the heaviest death.
  onDeath: 'death.big',
});
