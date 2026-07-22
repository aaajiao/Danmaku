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
import { cosDeg, sinDeg } from '../core/trig';
import { circlesOverlap, segmentHitsCircle, SpatialGrid } from './collision';
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

/**
 * A bullet that is a *line*, not a point.
 *
 * `BulletStyle.height` is static and shared by every bullet drawn from the same
 * spec, so a beam that lengthens cannot express itself there — the growing
 * extent is per-bullet state (`Bullet.length`), and this is the recipe it grows
 * by.
 *
 * The bullet's `x`/`y` is the **muzzle**, and the tip is `length` px along the
 * vector's heading. A renderer drawing a centred quad must therefore offset it
 * by half the length; anchoring the hitbox at the muzzle instead is what lets
 * the origin stay put while the beam extends, which is the whole shape of the
 * effect.
 */
export interface LaserSpec {
  /** Length at spawn, px. */
  length: number;
  /** Growth per tick until maxLength. */
  growth?: number;
  maxLength?: number;
  /** Ticks spent fading in before it becomes lethal — the telegraph. */
  warmup?: number;
  /**
   * Ticks the beam is drawn-but-harmless *after* it stops being lethal, before
   * `life` ends — the decay, the mirror of `warmup`. A beam that visibly fades
   * must stop killing *before* it vanishes; a beam that looked withdrawn but
   * still killed would be the telegraph's dishonesty run backwards.
   *
   * Measured from the fixed end (`life`), so it applies **only to a
   * `life`-limited beam**: an until-offscreen beam (`life` 0 or omitted) has no
   * fixed end to count a cooldown back from and stays lethal to expiry. The
   * window is derived each tick from `age`/`life`/`cooldown` — all already on
   * the bullet — so `reset()` and the LIFO-pool leak it guards are untouched,
   * the same reasoning `warmup` uses (an elapsed count, not stored state).
   *
   * Omitting it (or `0`) is byte-identical to a beam with no decay: the beam
   * expires at `age >= life` (the offscreen-cull check) on the same tick the
   * zero-width window would first fire, so `lethal` is never observed false on
   * a beam still in the live list. See `#growLaser`.
   */
  cooldown?: number;
}

/**
 * Makes a bullet a *missile*: an ordinary bullet in every mechanic it already
 * has — an elongated `blade` capsule for its body, `homing` to curve, and
 * `orientToHeading` to point where it travels — plus the one thing the `Bullet`
 * primitive could not do, a flash when it dies.
 *
 * It is a field on `BulletSpec`, not a second projectile format, for the same
 * reason `laser` is: a missile is a bullet, and standing up a parallel system,
 * pool and collision path to acquire one death-fx hook would re-derive every
 * upstream mistake CLAUDE.md catalogues. The sim carries exactly one property —
 * where to puff — and records *that* a missile detonated, never what the puff
 * looks like (that is the game/render layer's, across the import boundary).
 */
export interface MissileSpec {
  /**
   * The fx effect emitted where this missile detonates — a FLOORED effect name
   * (`missile.pop.tiny|mid|big`), so a base missile puffs with zero pack loaded
   * (rule 9). The name is resolved on the `fx` stream by the game layer, never
   * here: this module only records *that* a detonation happened and where (see
   * `BulletSystem` `#pops` and `drainMissilePops`).
   *
   * An object, not a bare `detonation?: string`, because the field's *presence*
   * (`missile !== undefined`) does triple duty — it marks this bullet a
   * detonator, it is the render layer's key to draw from the missile atlas, and
   * it is the extension point a blast radius or split-on-death grows from without
   * another `BulletSpec` field.
   */
  explosion: string;
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
  /** Makes this a beam: a segment hitbox that grows from the muzzle. */
  laser?: LaserSpec;
  /**
   * Makes this a blade: a capsule of `length` px **centred on the bullet**,
   * lying along its heading, with `radius` as the half-thickness.
   *
   * The difference from `laser` is only where the segment is anchored — a beam
   * grows forward from a fixed muzzle, a blade is carried by a bullet that
   * moves. Both are the same test underneath.
   *
   * Set this on anything drawn with `orientToHeading`, because a circle is the
   * wrong shape for those in two directions at once. A 28x2.5 needle given a
   * radius-3 circle overhangs its own painted thickness by 1.75px on the short
   * axis — measured, 29.3% of its kills landed with the blade visually clear of
   * the target — while covering 11px less than it draws on the long axis, so
   * 83.3% of the sweeps a player saw pass through them were never lethal. One
   * wrong shape, both complaints.
   */
  blade?: { length: number };
  /**
   * Keep going after damaging something, instead of despawning on first hit.
   *
   * Beams want this and nothing else does yet. It is stated rather than
   * inferred from `laser` because "is a line" and "passes through" are separate
   * claims, and a future beam that stops on its first target should be able to
   * say so without pretending not to be a beam.
   */
  pierce?: boolean;
  /**
   * Makes this bullet a missile that detonates on death. Undefined = an ordinary
   * bullet. Its presence adds no sim behaviour on its own — a missile is homing +
   * blade + orientToHeading, all existing — beyond recording a detonation where
   * the bullet dies (see `MissileSpec`).
   */
  missile?: MissileSpec;
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

  /**
   * The beam recipe, or undefined for an ordinary bullet. Its presence is what
   * makes this bullet a line: collision switches to a segment test and the
   * renderer to a stretched quad, both keyed off this one field rather than off
   * a sprite name they would have to agree on.
   */
  laser: LaserSpec | undefined;

  /** Current beam extent, px, from the muzzle along the heading. */
  length = 0;

  /**
   * False during warmup: drawn, but not yet dangerous.
   *
   * A laser that is lethal on the tick it appears is not a pattern, it is a
   * coin flip — there is no information in the field before it kills. The
   * telegraph is what turns it into something that can be read and dodged, so
   * the flag gates the hit test rather than merely tinting the sprite.
   */
  lethal = false;

  /** Half the blade's length, or 0 for a bullet that is a point. See the spec. */
  bladeHalf = 0;

  /** Whether damaging something ends this bullet. See `BulletSpec.pierce`. */
  pierce = false;

  /**
   * The detonation recipe, or undefined for an ordinary bullet. A spec
   * discriminator the *system* reads at the moment it removes this bullet — it
   * is never a control surface a caller writes to request removal (that is
   * `despawn`; `alive` is system-owned, rule 8). Its presence records a
   * detonation on removal and, in the render layer, routes this bullet's body to
   * the missile atlas.
   */
  missile: MissileSpec | undefined;

  reset(): void {
    this.alive = false;
    this.age = 0;
    this.hasTimeline = false;
    this.bounceCount = 0;
    // Extent is per-life state. Left behind, the next bullet in this slot
    // spawns with the previous beam's reach — and since the free list is LIFO
    // that is the very next spawn, not a rare one.
    this.laser = undefined;
    this.length = 0;
    this.lethal = false;
    this.bladeHalf = 0;
    this.pierce = false;
    // Cleared every reset, like `laser`/`bladeHalf` above and for the same
    // reason: the free list is LIFO, so a plain shot reusing a missile's slot
    // must not come back a detonator.
    this.missile = undefined;
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

    // Written unconditionally, not only when the spec is a laser: an ordinary
    // bullet reusing a beam's slot must come back a point.
    const laser = spec.laser;
    this.laser = laser;
    this.length = laser?.length ?? 0;
    // Age 0 is already past a zero-tick warmup, so an undeclared warmup means
    // lethal from the first tick and `warmup: 1` costs exactly one tick.
    this.lethal = laser === undefined || (laser.warmup ?? 0) <= 0;
    // Same reason as `laser` above: written every spawn, so a round bullet
    // inheriting a blade's slot does not inherit its reach.
    this.bladeHalf = spec.blade === undefined ? 0 : spec.blade.length / 2;
    this.pierce = spec.pierce ?? false;
    // Written every spawn, same as `laser`/`bladeHalf`: a plain bullet reusing a
    // missile's pooled slot comes back a point that does not detonate.
    this.missile = spec.missile;

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

/**
 * One missile detonation, snapshotted where it died. The game layer drains these
 * each tick and emits `explosion` on the `fx` stream — the analogue of
 * `EnemyDeath` for `EnemySystem.drainDeaths` and `ClearedBullet` for
 * `BombSystem.drainCleared`.
 *
 * A value snapshot, not the bullet: the pool hands its slot straight back out, so
 * `x`/`y` are read at removal and copied before the position is reused.
 */
export interface MissilePop {
  x: number;
  y: number;
  /** The fx effect to emit — carried out from `MissileSpec.explosion`. */
  explosion: string;
  /**
   * Which side fired it. Unread this round (all missiles are enemy); carried so
   * the deferred player-side missile can route its own detonation later.
   */
  faction: Faction;
}

export class BulletSystem {
  readonly bullets: Bullet[] = [];
  readonly #pool: Pool<Bullet>;
  readonly #bounds: FieldBounds;
  readonly #grid: SpatialGrid<Bullet>;

  /** Spawns refused because the pool was at its ceiling. */
  droppedSpawns = 0;

  /**
   * Missile detonations recorded this tick, double-buffered like
   * `EnemySystem`'s death list and `BombSystem`'s cleared list so a drain on a
   * tick that detonated nothing costs no allocation. Write-only sim bookkeeping
   * (rule 2): nothing in `step()`, collision, expiry or the pool ever reads it,
   * so it can never feed back into a position, a heading or a removal decision.
   */
  #pops: MissilePop[] = [];
  #popSpare: MissilePop[] = [];

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

  /**
   * Advance every bullet.
   *
   * `targetX`/`targetY` is what enemy fire steers at — the player. `playerAim`
   * is what *player* fire steers at, and it is a separate argument because a
   * single field-wide target is the wrong model the moment both factions can
   * steer.
   *
   * That is not hypothetical. Before this argument existed, `MotionContext`
   * carried one target for everything, and the registered `homing` weapon read
   * it without knowing its own faction — so a player's tracking shot curved
   * around and steered back at the ship that fired it. Measured, it landed 12
   * damage on a stationary target in 400 ticks where `spread` landed 306. The
   * weapon was documented as "registered but must not be put on a character".
   *
   * Undefined means there is nothing to aim at, and a steering player bullet
   * then keeps its heading rather than turning toward the origin — which is
   * what a `{x: 0, y: 0}` default would silently mean.
   */
  step(
    targetX: number,
    targetY: number,
    rng: Random = sim,
    playerAim?: { x: number; y: number },
  ): void {
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
      if (b.faction === 'player') {
        // No target: aim at itself, so `atan2Deg(0, 0)` leaves the heading
        // alone rather than pointing the shot somewhere arbitrary.
        context.targetX = playerAim?.x ?? b.x;
        context.targetY = playerAim?.y ?? b.y;
      } else {
        context.targetX = targetX;
        context.targetY = targetY;
      }
      b.vector.step(context, rng);

      b.x += b.vector.moveX();
      b.y += b.vector.moveY();
      b.age++;

      if (b.laser !== undefined) this.#growLaser(b);

      if (b.style.orientToHeading) {
        b.angle = (b.vector.theta * Math.PI) / 180;
      } else if (b.style.spin) {
        b.angle += b.style.spin;
      }

      if (b.bounce) this.#bounceOffWalls(b);

      // The offscreen cull reads the muzzle, and a laser is the one bullet
      // whose muzzle does not bound it: the body reaches `length` px further
      // on. An emitter parked above the field firing down therefore has its
      // beam deleted on the tick it spawns, while most of that beam — and all
      // of its hitbox — is on screen. Widening the cull by the reach is the
      // conservative direction: keeping a beam a few ticks too long costs a
      // step, deleting a live one costs the player a hit they could not read.
      const reach = b.laser === undefined ? margin : margin + b.length;

      const expired =
        (b.life > 0 && b.age >= b.life) ||
        b.x < -reach ||
        b.x > width + reach ||
        b.y < -reach ||
        b.y > height + reach ||
        (b.maxBounces > 0 && b.bounceCount >= b.maxBounces);

      if (expired) {
        // A missile detonates a flash where it dies — but only when its own
        // `life` ran out while it was still on the field. Culled off the edge it
        // puffs into nothing the player can see, and a bounce-cap expiry (base
        // missiles set none) is out of scope this round; both fall through
        // silently. `reach` is the same widened bound the `expired` test used, so
        // this on-field check agrees with the removal decision exactly rather
        // than re-deriving it. The record is read AT removal (rule 8 — never a
        // "please-remove-me" flag) and is write-only fx bookkeeping (rule 2): it
        // moves no position and no removal, so it cannot touch the trace.
        const offscreen =
          b.x < -reach || b.x > width + reach || b.y < -reach || b.y > height + reach;
        const lifeExpired = b.life > 0 && b.age >= b.life;
        if (b.missile !== undefined && lifeExpired && !offscreen) {
          this.#pops.push({ x: b.x, y: b.y, explosion: b.missile.explosion, faction: b.faction });
        }
        b.alive = false;
        this.#pool.release(b);
        continue;
      }

      this.bullets[write++] = b;
    }
    this.bullets.length = write;
  }

  /**
   * Extend the beam and set its lethal window — telegraph → active → decay.
   *
   * Read against `age`, which `step` has already incremented, so `warmup: 4`
   * means four ticks in which the beam is on screen and harmless. An elapsed
   * count rather than a countdown: a countdown is state that has to survive
   * pooling, and `age` is already reset for us — and `cooldown` rides the same
   * property, derived from `age`/`life` rather than stored.
   */
  #growLaser(b: Bullet): void {
    const laser = b.laser;
    if (laser === undefined) return;

    const growth = laser.growth ?? 0;
    if (growth !== 0) {
      const length = b.length + growth;
      const max = laser.maxLength;
      b.length = max !== undefined && length > max ? max : length;
    }

    const warmup = laser.warmup ?? 0;
    const cooldown = laser.cooldown ?? 0;
    // Decay is anchored to the fixed end, so it exists only for a life-limited
    // beam — and only when a decay was actually asked for. The `cooldown > 0`
    // guard is what makes an undeclared cooldown *literally* byte-identical:
    // without it, a zero-width window `[life, life)` would still flip `lethal`
    // false on the very tick `age` reaches `life`, and though the offscreen cull
    // removes the beam that same tick, the internal flag differs from today's.
    // `b.life > 0` mirrors the cull's own precondition (`b.life > 0 && b.age >=
    // b.life`): an until-offscreen beam has no fixed end to decay from.
    const decaying = cooldown > 0 && b.life > 0 && b.age >= b.life - cooldown;
    // Harmless in *both* the telegraph and the decay: a beam that looks like it
    // is fading must not still kill. Honesty at the sim level, not render alpha.
    b.lethal = b.age >= warmup && !decaying;
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
    //
    // A laser is indexed at its muzzle while its body reaches `length` px away,
    // so its reach is the radius of the circle around the muzzle that contains
    // the whole segment. Without that a 300px beam is only ever found by
    // something standing on the emitter.
    let maxReach = 0;
    for (const b of this.bullets) {
      if (b.faction !== faction) continue;
      this.#grid.insert(b.x, b.y, b);
      const reach = bulletReach(b);
      if (reach > maxReach) maxReach = reach;
    }

    let hit: Bullet | undefined;
    const reach = radius + maxReach;
    this.#grid.query(x, y, reach, (b) => {
      if (hit || !b.alive) return;
      if (bulletHitsCircle(b, x, y, radius)) hit = b;
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

    // A consumed removal detonates too — a hit the game resolved (`run.ts`'s
    // player-hit path) or a bomb-clear. Recorded at the removal, exactly as the
    // step()-expiry record is, and behind the `!alive` guard above so a bullet
    // found twice in one sweep records at most one pop — the same double-release
    // protection that guard already provides.
    if (bullet.missile !== undefined) {
      this.#pops.push({
        x: bullet.x,
        y: bullet.y,
        explosion: bullet.missile.explosion,
        faction: bullet.faction,
      });
    }

    const index = this.bullets.indexOf(bullet);
    // splice, not swap-remove: spawn order is draw order (main.ts's render
    // loop walks `bullets` directly), and a swap would make it jump.
    if (index >= 0) this.bullets.splice(index, 1);

    this.#pool.release(bullet);
  }

  /**
   * Missile detonations recorded since the last drain, oldest first — the
   * missiles that died on-field this tick by life-expiry, plus every one
   * consumed through `despawn` (a resolved hit, a bomb-clear). A stage wipe
   * (`clear`) records nothing: it is a reset, not a detonation.
   *
   * The game layer drains this each tick and emits each `explosion` on the `fx`
   * stream; this system does not know what a `missile.pop.*` looks like — the
   * name crosses the import boundary as a string. Double-buffered like
   * `EnemySystem.drainDeaths` and `BombSystem.drainCleared`, so the returned
   * array is recycled by the next drain — read it or copy it before then.
   */
  drainMissilePops(): readonly MissilePop[] {
    const drained = this.#pops;
    this.#pops = this.#popSpare;
    this.#pops.length = 0;
    this.#popSpare = drained;
    return drained;
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

/**
 * The bullet's real geometric shape against a circle — **telegraph-agnostic**.
 *
 * A laser tested as a circle at its stored position is a laser the player can
 * stand inside — the muzzle is one end of it, not its middle, so a point
 * anywhere along a 300px beam reads as 300px away from the thing that is
 * killing it. This answers "does the shape overlap", nothing about whether the
 * shape is *allowed* to hit — that gate (`lethal`) belongs to the callers that
 * care about danger (`bulletHitsCircle`), not to the ones that care about
 * presence (a screen-clear bomb wipes a telegraphing beam too).
 *
 * Split out of `bulletHitsCircle` so the shape and the gate are separately
 * reusable; the gated form below is byte-identical to every call it ever
 * served, and the ungated form is what graze and the radius bomb reach for.
 */
export function bulletShapeOverlaps(
  b: Bullet,
  x: number,
  y: number,
  radius: number,
): boolean {
  if (b.laser !== undefined) {
    const theta = b.vector.theta;
    const tipX = b.x + b.length * cosDeg(theta);
    const tipY = b.y + b.length * sinDeg(theta);
    // A beam runs *from* the muzzle: the stored position is one end, not the
    // middle. `radius` is the bullet's half-width — a capsule, not a bare line.
    return segmentHitsCircle(b.x, b.y, tipX, tipY, x, y, radius + b.radius);
  }

  if (b.bladeHalf > 0) {
    // A blade is carried, so its capsule is centred on the bullet rather than
    // anchored behind it.
    const theta = b.vector.theta;
    const dx = b.bladeHalf * cosDeg(theta);
    const dy = b.bladeHalf * sinDeg(theta);
    return segmentHitsCircle(
      b.x - dx, b.y - dy,
      b.x + dx, b.y + dy,
      x, y,
      radius + b.radius,
    );
  }

  return circlesOverlap(x, y, radius, b.x, b.y, b.radius);
}

/**
 * Exact phase of the hit test: the bullet's real shape against a circle, gated
 * by the telegraph.
 *
 * Drawn but harmless during warmup and decay, so a non-lethal beam registers no
 * hit. Gated here rather than at the call sites so that every present and future
 * *danger* path inherits the telegraph, instead of each one having to remember
 * it (the argument rule 8 makes about `alive`).
 */
export function bulletHitsCircle(
  b: Bullet,
  x: number,
  y: number,
  radius: number,
): boolean {
  if (!b.lethal) return false;
  return bulletShapeOverlaps(b, x, y, radius);
}

/** How far from `b.x`/`b.y` this bullet's lethal shape can reach. */
export function bulletReach(b: Bullet): number {
  if (b.laser !== undefined) return b.radius + b.length;
  return b.radius + b.bladeHalf;
}
