/**
 * Pickups: the reward channel.
 *
 * An item is a hitbox that cannot hurt anything. It has no faction, no damage,
 * no bounce, and nothing in this file writes to the player — the game layer
 * drains what was collected and decides what a 'power' is worth. That asymmetry
 * is deliberate: items are the one entity type the player is never punished for
 * touching, and keeping the reward table out of here is what lets a stage add a
 * new pickup by writing a file.
 *
 * Upstream had no item entity at all; power and score were fields incremented
 * directly from the enemy death branch, which is why its drops could not miss,
 * could not be magnetised, and could not be seen.
 *
 * ## Magnetism is the feel
 *
 * Within `magnetRadius` an item stops obeying its motion and flies at the
 * player. Once magnetised it stays magnetised, permanently — an item that
 * re-entered its own motion every time the player stepped a pixel away would
 * oscillate at the edge of the radius, and that reads as the game fighting you.
 * `Item.magnetised` is therefore latched, never cleared except by a fresh spawn.
 *
 * ## Collection is drained, not dispatched
 *
 * `step` rewrites the live list in place, compacting survivors as it goes. A
 * collection callback firing mid-sweep would run arbitrary game code — awarding
 * power, spawning an effect, possibly spawning more items — against a list that
 * is half-rewritten, and the entity in the slot being written would be skipped.
 * `drainCollected` hands the batch over at a moment the caller chooses, the same
 * contract `EnemySystem.drainDeaths` uses and for the same reason.
 */

import { Pool } from '../core/pool';
import { sim, type Random } from '../core/random';
import type { FieldBounds } from './bullet';
import { circlesOverlap } from './collision';
import { MoveVector, type MotionParams } from './motion';

export interface ItemSpec {
  /** Atlas cell name. */
  sprite: string;
  /**
   * Pickup radius. Generous by design — this is a reward, and a drop the player
   * earned but grazed past feels like the game cheating. Compare `BulletSpec`,
   * where the radius is deliberately far *smaller* than the sprite.
   */
  radius: number;
  /** Power fraction or score points, read by the game layer through `kind`. */
  value: number;
  kind: 'power' | 'score' | 'life' | 'bomb';
  /** Defaults to `DEFAULT_MOTION`: drift up briefly, then fall. */
  motion?: MotionParams;
  tint?: { r?: number; g?: number; b?: number };
  /** Speed, px/tick, once drawn to the player. Defaults to `DEFAULT_MAGNET_SPEED`. */
  magnetSpeed?: number;
}

/**
 * What a kill scatters: registered item names and how many of each.
 *
 * A **name → count** list rather than a fixed set of typed fields, so a spawner
 * can drop any item the registry holds without the game layer learning its
 * name. An enemy used to carry `drops: { power, score }` — two hardcoded fields,
 * of which only `power` was ever read and `score` was dead — so nothing could
 * drop a `life` or a `bomb` item however the content was written, while a boss's
 * spoils were a separate hardcoded table in `Run`. This is the one shape both
 * use: `[['power', 2], ['score', 4]]`.
 *
 * Order is part of the determinism contract. `ItemSystem.burst` draws two `sim`
 * values per item in list order, so reordering the entries or the counts changes
 * every subsequent draw in the run (CLAUDE.md rule 2).
 */
export type Spoils = readonly (readonly [name: string, count: number])[];

/**
 * The genre's drop arc, expressed as one polar segment rather than a timeline.
 *
 * `theta = 270` is up, and `r` decays through zero into negative, which reverses
 * travel along the same heading — so the item rises, stalls, and falls back
 * without a second segment or a gravity vector. `rrange.min` is then a terminal
 * velocity for free, which a cartesian gravity term could not give without an
 * accumulator clamp that `MoveVector` does not have.
 */
const DEFAULT_MOTION: MotionParams = {
  r: 1.7,
  theta: 270,
  ra: -0.09,
  rrange: { min: -2.3 },
};

const DEFAULT_MAGNET_SPEED = 6;

/** Sideways spread a `burst` draws from, px/tick. */
const BURST_DRIFT = 1.1;
/** Launch-speed jitter a `burst` draws from, px/tick, so drops do not peak in unison. */
const BURST_LIFT = 0.7;

const registry = new Map<string, ItemSpec>();

export function defineItem(name: string, spec: ItemSpec): void {
  if (registry.has(name)) {
    throw new Error(`item "${name}" is already defined`);
  }
  registry.set(name, spec);
}

export function getItemSpec(name: string): ItemSpec {
  const spec = registry.get(name);
  if (!spec) throw new Error(`unknown item "${name}"`);
  return spec;
}

export function itemNames(): readonly string[] {
  return [...registry.keys()];
}

/** Placeholder for a pooled item that has never been spawned. */
const UNSPAWNED: ItemSpec = { sprite: 'star', radius: 12, value: 0, kind: 'score' };

export class Item {
  x = 0;
  y = 0;
  age = 0;
  alive = false;
  /** Render rotation, radians. Nothing in the sim writes it; content may. */
  angle = 0;

  spec: ItemSpec = UNSPAWNED;
  name = '';

  /**
   * Latched. Set when the player first comes within the magnet radius, or when
   * an auto-collect sweep claims the field, and never cleared while the item
   * lives — see the module note on oscillation.
   */
  magnetised = false;

  readonly vector = new MoveVector();

  reset(): void {
    this.alive = false;
    this.age = 0;
    this.magnetised = false;
  }

  spawn(name: string, spec: ItemSpec, x: number, y: number, rng: Random): void {
    this.name = name;
    this.spec = spec;
    this.x = x;
    this.y = y;
    this.age = 0;
    this.angle = 0;
    this.alive = true;
    this.magnetised = false;

    this.vector.init(spec.motion ?? DEFAULT_MOTION, rng);
  }
}

export interface ItemSystemOptions {
  bounds: FieldBounds;
  /** Above this y the player auto-collects everything on screen. */
  autoCollectLine?: number;
  initial?: number;
  max?: number;
}

/** A collection worth reacting to. Snapshotted — the `Item` is already pooled. */
export interface ItemCollection {
  name: string;
  spec: ItemSpec;
  x: number;
  y: number;
}

export class ItemSystem {
  readonly items: Item[] = [];
  readonly #pool: Pool<Item>;
  readonly #bounds: FieldBounds;
  readonly #autoCollectLine: number | undefined;

  /** Double-buffered so a drain on a quiet tick still costs no allocation. */
  #collected: ItemCollection[] = [];
  #spare: ItemCollection[] = [];

  /** Spawns refused because the pool was at its ceiling. */
  droppedSpawns = 0;

  /**
   * Absorbs the draws of a spawn the pool refused.
   *
   * `Item.spawn` ends in `vector.init`, which draws whenever the motion
   * declares a randomized parameter. Skipping that call on a refusal would let
   * a pool ceiling change how many draws the run has made, shifting every
   * later one — a divergence visible only when the pool happens to fill, which
   * is the hardest kind to reproduce. Initialising a throwaway vector keeps the
   * stream's position a function of what was *requested*, not of what fit.
   */
  readonly #ballast = new MoveVector();

  constructor(options: ItemSystemOptions) {
    this.#bounds = options.bounds;
    this.#autoCollectLine = options.autoCollectLine;
    this.#pool = new Pool(() => new Item(), {
      initial: options.initial ?? 128,
      max: options.max ?? 2048,
      reset: (i) => i.reset(),
    });
  }

  /** Throws on an unknown name: a typo in drop data must not fail silently. */
  spawn(name: string, x: number, y: number, rng: Random = sim): Item | undefined {
    const spec = getItemSpec(name);
    const item = this.#pool.acquire();
    if (!item) {
      this.droppedSpawns++;
      // Consume exactly what the spawn would have. See `#ballast`.
      this.#ballast.init(spec.motion ?? DEFAULT_MOTION, rng);
      return undefined;
    }
    item.spawn(name, spec, x, y, rng);
    this.items.push(item);
    return item;
  }

  /**
   * Scatter several, the way a kill drops them.
   *
   * Each item takes a constant sideways drift and a lift jitter, in that order —
   * two draws per item, and that order is part of the determinism contract.
   * `driftX` is set rather than expressed as a `gravity.x` because it is a
   * constant velocity, not an acceleration: the item should slide aside at a
   * steady rate for its whole life, not accelerate off the field.
   */
  burst(name: string, x: number, y: number, count: number, rng: Random = sim): void {
    for (let i = 0; i < count; i++) {
      // Draw before the spawn can fail. Together with the ballast inside
      // `spawn`, this is what makes a pool ceiling reached mid-burst unable to
      // change how many draws the sim stream makes — these two draws alone
      // were never the whole cost of a spawn.
      const drift = rng.range(-BURST_DRIFT, BURST_DRIFT);
      const lift = rng.range(0, BURST_LIFT);

      const item = this.spawn(name, x, y, rng);
      if (!item) continue;
      item.vector.driftX = drift;
      item.vector.r += lift;
    }
  }

  /**
   * Advance every item, then collect what the player is touching.
   *
   * `playerAboveLine` is passed in rather than derived from `playerY` here. The
   * flag is not only about position — a bomb or a spellcard capture claims the
   * field from anywhere — so the decision belongs to the game layer, and this
   * system stays ignorant of what a player is. `autoCollectLine` is exposed for
   * the caller that only needs the positional case.
   */
  step(
    playerX: number,
    playerY: number,
    magnetRadius: number,
    playerAboveLine: boolean,
    rng: Random = sim,
  ): void {
    const { width, height, margin } = this.#bounds;
    const magnetReach = magnetRadius * magnetRadius;

    let write = 0;
    for (let read = 0; read < this.items.length; read++) {
      const item = this.items[read];
      if (item === undefined) continue;

      const dx = playerX - item.x;
      const dy = playerY - item.y;

      if (!item.magnetised) {
        if (playerAboveLine || dx * dx + dy * dy <= magnetReach) {
          item.magnetised = true;
        }
      }

      if (item.magnetised) {
        // Re-aimed every tick, so the item tracks a moving player instead of
        // committing to where it was when the latch closed. Speed is forced
        // rather than accelerated: a pickup arriving *now* is the reward.
        const speed = item.spec.magnetSpeed ?? DEFAULT_MAGNET_SPEED;
        item.vector.aimAt(item.x, item.y, playerX, playerY);
        item.vector.r = speed;
        // Any drift from a burst would otherwise pull the flight off-line.
        item.vector.driftX = 0;
        item.vector.driftY = 0;

        // The final step is clamped to land *on* the player rather than pass
        // through. Magnet speeds are routinely larger than pickup radii — 6px a
        // tick against a 5px window — so an unclamped step tunnels straight
        // over the player, misses the overlap test below, and the item then
        // orbits forever, permanently uncollectable. `sqrt` is exact under
        // IEEE-754 and safe in the sim; see `src/determinism.test.ts`.
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= speed) {
          item.x = playerX;
          item.y = playerY;
        } else {
          item.x += item.vector.moveX();
          item.y += item.vector.moveY();
        }
      } else {
        // No `MotionContext` target: items are never aimed, so there is
        // nothing to point them at. `rng` is threaded through because a spec
        // that names a motion behaviour draws every tick, and defaulting that
        // draw to the global `sim` would take it off whichever stream the
        // caller is running on — which is precisely the isolation `Run` is
        // built to guarantee, so that a live run and a playback run can be
        // stepped in the same process without consuming each other's draws.
        item.vector.step(
          { age: item.age, x: item.x, y: item.y, targetX: 0, targetY: 0 },
          rng,
        );
        item.x += item.vector.moveX();
        item.y += item.vector.moveY();
      }
      item.age++;

      // The player is a point here. The generous radius lives on the item, so
      // the pickup window is a property of the reward rather than of the ship.
      if (circlesOverlap(playerX, playerY, 0, item.x, item.y, item.spec.radius)) {
        this.#collected.push({ name: item.name, spec: item.spec, x: item.x, y: item.y });
        item.alive = false;
        this.#pool.release(item);
        continue;
      }

      // A magnetised item is on its way to an onscreen player and must never be
      // culled: a burst near the bottom edge would otherwise lose the drops the
      // player had already earned by touching them.
      const outside =
        !item.magnetised &&
        (item.x < -margin ||
          item.x > width + margin ||
          item.y < -margin ||
          item.y > height + margin);

      if (outside) {
        item.alive = false;
        this.#pool.release(item);
        continue;
      }

      this.items[write++] = item;
    }
    this.items.length = write;
  }

  /**
   * Items collected since the last drain, oldest first.
   *
   * The returned array is recycled by the next drain — read it or copy it
   * before then.
   */
  drainCollected(): readonly ItemCollection[] {
    const drained = this.#collected;
    this.#collected = this.#spare;
    this.#collected.length = 0;
    this.#spare = drained;
    return drained;
  }

  /**
   * Whether a player at `y` is high enough to claim the field. A convenience for
   * the caller that computes `step`'s flag from position alone; the threshold
   * lives here so there is one copy of the number.
   */
  isAboveCollectLine(y: number): boolean {
    return this.#autoCollectLine !== undefined && y <= this.#autoCollectLine;
  }

  get autoCollectLine(): number | undefined {
    return this.#autoCollectLine;
  }

  /**
   * Empty the field. Clearing is not collecting, so it awards nothing — but it
   * also does not discard collections already recorded this tick, which the
   * player earned and is still owed.
   */
  clear(): void {
    for (const item of this.items) {
      item.alive = false;
      this.#pool.release(item);
    }
    this.items.length = 0;
  }

  get count(): number {
    return this.items.length;
  }

  get poolSize(): number {
    return this.#pool.size;
  }

  get poolGrowth(): number {
    return this.#pool.growthCount;
  }
}

/* ------------------------------------------------------------------ */
/* Starter content                                                     */
/* ------------------------------------------------------------------ */

/**
 * The five pickups a stage can already script against. These live here only
 * until there is a `content/items.ts` to hold them; nothing in the system above
 * knows they exist.
 *
 * `value` is uninterpreted by this file — for 'power' it is the fraction added
 * to `Player.power`, which quantises to hundredths, and for 'score' it is
 * points. 'life' and 'bomb' carry a count.
 */

defineItem('power', {
  sprite: 'shard',
  radius: 13,
  value: 0.05,
  kind: 'power',
  tint: { r: 1, g: 0.3, b: 0.35 },
});

defineItem('big-power', {
  sprite: 'star',
  radius: 16,
  value: 1,
  kind: 'power',
  tint: { r: 1, g: 0.55, b: 0.2 },
  // Worth crossing the field for, so it comes to you from further out.
  magnetSpeed: 7.5,
});

defineItem('score', {
  sprite: 'mote',
  radius: 13,
  value: 500,
  kind: 'score',
  tint: { r: 0.55, g: 0.85, b: 1 },
});

defineItem('life', {
  sprite: 'petal',
  radius: 18,
  value: 1,
  kind: 'life',
  tint: { r: 1, g: 0.75, b: 0.85 },
  // Rises higher and settles slower: the rarest drop should be legible for
  // longer than the confetti it lands in.
  motion: { r: 2.2, theta: 270, ra: -0.05, rrange: { min: -1.4 } },
  magnetSpeed: 8,
});

defineItem('bomb', {
  sprite: 'ring',
  radius: 18,
  value: 1,
  kind: 'bomb',
  tint: { r: 0.8, g: 0.7, b: 1 },
  motion: { r: 2.2, theta: 270, ra: -0.05, rrange: { min: -1.4 } },
  magnetSpeed: 8,
});
