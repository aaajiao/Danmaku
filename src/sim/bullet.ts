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
  /** Maximum bounces before it despawns anyway. */
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
  alive = false;
  bounce = false;
  maxBounces = 0;
  angle = 0;

  readonly vector = new MoveVector();
  readonly timeline = new MotionTimeline();
  style: BulletStyle = { sprite: 'orb.small' };

  /** Whether this bullet's spec supplied a timeline. Read by the system's step. */
  hasTimeline = false;

  reset(): void {
    this.alive = false;
    this.age = 0;
    this.hasTimeline = false;
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
        (b.maxBounces > 0 && b.vector.reflectCount > b.maxBounces);

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
    } else if (b.x > width - b.radius) {
      b.x = width - b.radius;
      b.vector.reflectX();
    }
    if (b.y < b.radius) {
      b.y = b.radius;
      b.vector.reflectY();
    } else if (b.y > height - b.radius) {
      b.y = height - b.radius;
      b.vector.reflectY();
    }
  }

  /**
   * Find the first bullet of `faction` hitting the given circle.
   * Uses the broad-phase grid, so cost tracks local density, not total count.
   */
  hitTest(x: number, y: number, radius: number, faction: Faction): Bullet | undefined {
    this.#grid.clear();
    for (const b of this.bullets) {
      if (b.faction === faction) this.#grid.insert(b.x, b.y, b);
    }

    let hit: Bullet | undefined;
    const reach = radius + 32;
    this.#grid.query(x, y, reach, (b) => {
      if (hit || !b.alive) return;
      if (circlesOverlap(x, y, radius, b.x, b.y, b.radius)) hit = b;
    });
    return hit;
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
