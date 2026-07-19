/**
 * Bullets: the entity type everything else in a danmaku game orbits.
 *
 * Upstream kept two parallel, unrelated hierarchies — `Bullet.js` for player
 * shot and `EnemyBullet.js` for enemy fire — 1,783 lines that duplicate most of
 * their behaviour. Here there is one bullet with a `faction`, because the
 * difference between the two is who it collides with, not what it is.
 */

import { Pool } from '../core/pool';
import { sim, type Random } from '../core/random';
import { circlesOverlap, SpatialGrid } from './collision';
import { MotionTimeline, MoveVector, type MotionParams, type MotionSegment } from './motion';

export type Faction = 'player' | 'enemy';

export interface BulletStyle {
  /** Atlas cell name. */
  sprite: string;
  /** Tint, 0..1. */
  r?: number;
  g?: number;
  b?: number;
  a?: number;
  /** Rendered size. Defaults to the sprite cell size. */
  width?: number;
  height?: number;
  /** Additive blending reads as light — good for lasers and energy shot. */
  additive?: boolean;
  /**
   * Rotate the sprite to match heading. Right for blades and needles, wrong
   * for orbs, which should stay upright.
   */
  orientToHeading?: boolean;
  /** Constant spin, radians/tick. */
  spin?: number;
}

export interface BulletSpec {
  style: BulletStyle;
  /** Collision radius. Danmaku hitboxes are far smaller than the sprite. */
  radius: number;
  motion: MotionParams;
  /** Optional motion timeline; overrides `motion` when present. */
  timeline?: readonly MotionSegment[];
  /** Ticks before the bullet expires. Omit for "until offscreen". */
  life?: number;
  /** Bounce off the field edges instead of despawning. */
  bounce?: boolean;
  /** Bounces allowed before the bullet despawns. 0 (default) means unlimited. */
  maxBounces?: number;
  damage?: number;
}

export class Bullet {
  x = 0;
  y = 0;
  age = 0;
  life = 0;
  radius = 3;
  damage = 1;
  faction: Faction = 'enemy';

  /**
   * Whether this bullet is live. System-owned: `BulletSystem.step` and
   * `BulletSystem.despawn` are the only writers. A caller that wants a
   * bullet gone must call `despawn`, not set this directly — removing a
   * bullet also means unlinking it from the live list and freeing its pool
   * slot, which a flag flip alone does not do.
   */
  alive = false;
  bounce = false;
  maxBounces = 0;
  angle = 0;

  /**
   * Wall bounces this life. Owned by the bullet, not the vector: a timeline
   * segment re-inits the vector, which would otherwise refill the allowance
   * and leave a bouncing bullet immortal.
   */
  bounceCount = 0;

  /**
   * Which life of this slot is currently running. Incremented on every spawn
   * and deliberately **not** cleared by `reset`.
   *
   * Object identity is not enough to tell two bullets apart once pooling is in
   * play, and the free list is LIFO: the slot released this tick is the very
   * next one handed out. Anything remembering a bullet across ticks — graze
   * bookkeeping in `sim/player.ts` — must compare this alongside the reference,
   * or it will mistake a fresh bullet for the one that just despawned.
   */
  generation = 0;

  readonly vector = new MoveVector();
  readonly timeline = new MotionTimeline();
  style: BulletStyle = { sprite: 'orb.small' };

  /** Whether this bullet's spec supplied a timeline. Read by the system's step. */
  hasTimeline = false;

  reset(): void {
    this.alive = false;
    this.age = 0;
    this.hasTimeline = false;
    this.bounceCount = 0;
  }

  spawn(x: number, y: number, spec: BulletSpec, faction: Faction, rng: Random): void {
    this.x = x;
    this.y = y;
    this.age = 0;
    this.alive = true;
    this.faction = faction;
    this.radius = spec.radius;
    this.damage = spec.damage ?? 1;
    this.life = spec.life ?? 0;
    this.style = spec.style;
    this.bounce = spec.bounce ?? false;
    this.maxBounces = spec.maxBounces ?? 0;
    this.angle = 0;
    this.bounceCount = 0;
    this.generation++;

    this.vector.init(spec.motion, rng);
    this.hasTimeline = spec.timeline !== undefined;
    if (spec.timeline) this.timeline.reset(spec.timeline);
  }
}

export interface FieldBounds {
  width: number;
  height: number;
  /** Bullets are culled this far outside the field, so they can arc back in. */
  margin: number;
}

export interface BulletSystemOptions {
  bounds: FieldBounds;
  initial?: number;
  max?: number;
  /** Broad-phase cell size. Roughly the largest common hitbox diameter. */
  cellSize?: number;
}

export class BulletSystem {
  readonly bullets: Bullet[] = [];
  readonly #pool: Pool<Bullet>;
  readonly #bounds: FieldBounds;
  readonly #grid: SpatialGrid<Bullet>;

  /** Spawns refused because the pool was at its ceiling. */
  droppedSpawns = 0;

  constructor(options: BulletSystemOptions) {
    this.#bounds = options.bounds;
    this.#pool = new Pool(() => new Bullet(), {
      initial: options.initial ?? 2000,
      max: options.max ?? 20000,
      reset: (b) => b.reset(),
    });
    this.#grid = new SpatialGrid(options.cellSize ?? 32);
  }

  spawn(
    x: number,
    y: number,
    spec: BulletSpec,
    faction: Faction = 'enemy',
    rng: Random = sim,
  ): Bullet | undefined {
    const bullet = this.#pool.acquire();
    if (!bullet) {
      this.droppedSpawns++;
      return undefined;
    }
    bullet.spawn(x, y, spec, faction, rng);
    this.bullets.push(bullet);
    return bullet;
  }

  /** Aim a spawn at a point, preserving the spec's speed. */
  spawnAimed(
    x: number,
    y: number,
    targetX: number,
    targetY: number,
    spec: BulletSpec,
    faction: Faction = 'enemy',
    rng: Random = sim,
  ): Bullet | undefined {
    const bullet = this.spawn(x, y, spec, faction, rng);
    bullet?.vector.aimAt(x, y, targetX, targetY);
    return bullet;
  }

  step(targetX: number, targetY: number, rng: Random = sim): void {
    const { width, height, margin } = this.#bounds;
    const context = { age: 0, x: 0, y: 0, targetX, targetY };

    let write = 0;
    for (let read = 0; read < this.bullets.length; read++) {
      const b = this.bullets[read];
      if (b === undefined) continue;

      if (b.hasTimeline) {
        // Timeline first: a segment change this tick must apply before moving.
        b.timeline.step(b.vector, rng);
      }

      context.age = b.age;
      context.x = b.x;
      context.y = b.y;
      b.vector.step(context, rng);

      b.x += b.vector.moveX();
      b.y += b.vector.moveY();
      b.age++;

      if (b.style.orientToHeading) {
        b.angle = (b.vector.theta * Math.PI) / 180;
      } else if (b.style.spin) {
        b.angle += b.style.spin;
      }

      if (b.bounce) this.#bounceOffWalls(b);

      const expired =
        (b.life > 0 && b.age >= b.life) ||
        b.x < -margin ||
        b.x > width + margin ||
        b.y < -margin ||
        b.y > height + margin ||
        (b.maxBounces > 0 && b.bounceCount >= b.maxBounces);

      if (expired) {
        b.alive = false;
        this.#pool.release(b);
        continue;
      }

      this.bullets[write++] = b;
    }
    this.bullets.length = write;
  }

  #bounceOffWalls(b: Bullet): void {
    const { width, height } = this.#bounds;
    if (b.x < b.radius) {
      b.x = b.radius;
      b.vector.reflectX();
      b.bounceCount++;
    } else if (b.x > width - b.radius) {
      b.x = width - b.radius;
      b.vector.reflectX();
      b.bounceCount++;
    }
    if (b.y < b.radius) {
      b.y = b.radius;
      b.vector.reflectY();
      b.bounceCount++;
    } else if (b.y > height - b.radius) {
      b.y = height - b.radius;
      b.vector.reflectY();
      b.bounceCount++;
    }
  }

  /**
   * Find the first bullet of `faction` hitting the given circle.
   * Uses the broad-phase grid, so cost tracks local density, not total count.
   */
  hitTest(x: number, y: number, radius: number, faction: Faction): Bullet | undefined {
    this.#grid.clear();
    // The broad phase indexes centres, so the query must reach out by the
    // largest radius present or a big bullet overlapping the circle is never
    // visited — the very miss `collision.ts` exists to avoid. Tracking the
    // real maximum also beats a fixed slack: typical fire is 3px, not 32.
    let maxRadius = 0;
    for (const b of this.bullets) {
      if (b.faction !== faction) continue;
      this.#grid.insert(b.x, b.y, b);
      if (b.radius > maxRadius) maxRadius = b.radius;
    }

    let hit: Bullet | undefined;
    const reach = radius + maxRadius;
    this.#grid.query(x, y, reach, (b) => {
      if (hit || !b.alive) return;
      if (circlesOverlap(x, y, radius, b.x, b.y, b.radius)) hit = b;
    });
    return hit;
  }

  /**
   * Remove a single bullet: unlink it from the live list and return its slot
   * to the pool. This is the only way to end one bullet's life from outside
   * `step()` — `alive` is set here, not by the caller, because removal has
   * two other parts (the live-list splice, the pool release) that a flag
   * flip alone cannot perform.
   *
   * A no-op if the bullet is already gone, so a collision loop that finds
   * the same bullet twice in one sweep — two overlapping queries, say —
   * cannot double-release it into the pool's free list.
   *
   * Safe to call while iterating `bullets`, which is where hit resolution
   * naturally lives, but note a forward `for...of` that despawns as it goes
   * can still skip visiting one shifted-in survivor per removal in that same
   * pass — an artefact of mutating an array while iterating it forward, not
   * a defect here. A second pass (or next tick's `step()`) catches it; a
   * loop that must catch everything in one pass should walk backwards by
   * index instead, where a removal only shifts already-visited slots.
   */
  despawn(bullet: Bullet): void {
    if (!bullet.alive) return;
    bullet.alive = false;

    const index = this.bullets.indexOf(bullet);
    // splice, not swap-remove: spawn order is draw order (main.ts's render
    // loop walks `bullets` directly), and a swap would make it jump.
    if (index >= 0) this.bullets.splice(index, 1);

    this.#pool.release(bullet);
  }

  clear(): void {
    for (const b of this.bullets) {
      b.alive = false;
      this.#pool.release(b);
    }
    this.bullets.length = 0;
  }

  get count(): number {
    return this.bullets.length;
  }

  get poolSize(): number {
    return this.#pool.size;
  }

  get poolGrowth(): number {
    return this.#pool.growthCount;
  }
}
