/**
 * Bombs: the panic button, and the deepest scoring mechanic in the genre.
 *
 * A bomb does three things, and they belong to three different owners:
 *
 * - It **damages** enemies in range, per tick, for as long as it burns. Per
 *   tick and not as a lump, because that is what makes bomb timing against a
 *   boss a skill rather than a button — a bomb fired into the last two seconds
 *   of a phase is worth less than the same bomb fired earlier, and the player
 *   can feel the difference.
 * - It **clears** enemy fire in range. Deleting bullets is a get-out-of-jail
 *   card; converting them into score is a decision. This system reports the
 *   positions it cleared and stops there — what drops at those positions is a
 *   game-layer question, and the answer will change as the scoring does.
 * - It **buys invulnerability**, which it does not administer. `invulnTicks`
 *   is data on the spec for the game to read; the player owns its own timer
 *   (`Player.invuln`) and this system never touches it.
 *
 * It also does not own the player's bomb count. `fire` reports whether a bomb
 * started; the game decrements. A system that decremented would have to know
 * about lives, extends and continues to know when not to.
 *
 * Pure simulation: px/tick, ticks, no `dt`, no renderer. See CLAUDE.md, rule 1.
 */

import { sim, type Random } from '../core/random';
import { bulletShapeOverlaps } from './bullet';
import type { BulletSystem, FieldBounds } from './bullet';
import { circlesOverlap } from './collision';
import type { EnemySystem } from './enemy';

export interface BombSpec {
  /** Ticks the bomb is active. */
  duration: number;
  /**
   * Ticks of player invulnerability, usually longer than the bomb so the
   * player is still covered while the field refills. Read by the game — see
   * the note above; nothing here applies it.
   */
  invulnTicks: number;
  /** Damage per tick to every enemy in range. */
  damagePerTick: number;
  /** Radius, or the whole field if omitted. */
  radius?: number;
  /** Enemy bullets caught are converted to score items rather than deleted. */
  convertBullets?: boolean;
  /** Effect name for the blast. Resolved by the game against the effect registry. */
  effect?: string;
}

const registry = new Map<string, BombSpec>();

export function defineBomb(name: string, spec: BombSpec): void {
  if (registry.has(name)) {
    throw new Error(`bomb "${name}" is already defined`);
  }
  registry.set(name, spec);
}

/** Throws on an unknown name: a typo in content must not silently misfire. */
export function getBombSpec(name: string): BombSpec {
  const spec = registry.get(name);
  if (!spec) throw new Error(`unknown bomb "${name}"`);
  return spec;
}

export function bombNames(): readonly string[] {
  return [...registry.keys()];
}

/** A bullet the bomb caught, at the position it was caught. */
export interface ClearedBullet {
  x: number;
  y: number;
}

export interface BombSystemOptions {
  bounds: FieldBounds;
}

export class BombSystem {
  readonly #bounds: FieldBounds;

  #spec: BombSpec | undefined;
  #name = '';
  #x = 0;
  #y = 0;
  #remaining = 0;

  /**
   * Double-buffered like `EnemySystem`'s death list, so draining on a tick
   * that cleared nothing still costs no allocation. A bomb over a dense
   * pattern clears hundreds of bullets on its first tick and then almost none,
   * which is exactly the shape that punishes a fresh array per drain.
   */
  #cleared: ClearedBullet[] = [];
  #spare: ClearedBullet[] = [];

  constructor(options: BombSystemOptions) {
    this.#bounds = options.bounds;
  }

  /**
   * Start a bomb. Returns false if one is already burning.
   *
   * Refused, never queued: a queued bomb spends a resource the player cannot
   * see being spent, and lands at a moment they did not choose. The panic
   * button has to be honest about whether it fired.
   */
  fire(name: string, x: number, y: number): boolean {
    if (this.#remaining > 0) return false;

    const spec = getBombSpec(name);
    this.#spec = spec;
    this.#name = name;
    this.#x = x;
    this.#y = y;
    // Floored at one tick: a zero-duration bomb would consume a stock and do
    // nothing, which reads to the player as a dropped input.
    this.#remaining = Math.max(1, Math.floor(spec.duration));
    return true;
  }

  /**
   * Apply one tick of the bomb: damage, then clearing.
   *
   * `rng` is accepted for symmetry with the other systems and so a future spec
   * (scattered damage, randomized conversion) has a seeded stream to reach for.
   * Nothing here draws from it today — deliberately, since a bomb that consumed
   * draws would move every subsequent bullet in the run.
   */
  step(bullets: BulletSystem, enemies: EnemySystem, rng: Random = sim): void {
    void rng;
    const spec = this.#spec;
    if (spec === undefined || this.#remaining <= 0) return;

    this.#damageEnemies(enemies, spec);
    this.#clearBullets(bullets, spec);

    // Decremented after the tick's work, so a duration of 1 still lands once.
    this.#remaining--;
    if (this.#remaining <= 0) this.#spec = undefined;
  }

  #damageEnemies(enemies: EnemySystem, spec: BombSpec): void {
    if (spec.damagePerTick <= 0) return;

    // Backwards by index: `EnemySystem.damage` splices the dead out of the
    // live list, and a forward walk would skip the enemy shifted into the
    // vacated slot — one survivor per kill, silently spared for a tick.
    const live = enemies.enemies;
    for (let i = live.length - 1; i >= 0; i--) {
      const e = live[i];
      if (e === undefined || !e.alive) continue;
      if (!this.#inRange(e.x, e.y, e.spec.radius, spec)) continue;
      enemies.damage(e, spec.damagePerTick);
    }
  }

  #clearBullets(bullets: BulletSystem, spec: BombSpec): void {
    // Backwards for the same reason as above: `despawn` splices.
    const live = bullets.bullets;
    for (let i = live.length - 1; i >= 0; i--) {
      const b = live[i];
      if (b === undefined || !b.alive) continue;
      // Player shot is not caught. Eating your own bullets would make bombing
      // during a boss cost damage, which is the opposite of the intent.
      if (b.faction !== 'enemy') continue;

      // A radius bomb is a blast that catches whatever *shape* it overlaps: a
      // beam whose body crosses the blast but whose muzzle sits far away must
      // clear, or a panic-bomb leaves an on-screen beam looking lethal while
      // the player has invuln. `bulletShapeOverlaps`, not `bulletHitsCircle`,
      // so a screen-clear also wipes *telegraphing* beams — a bomb clears
      // incoming threats, not only the ones already able to kill. The
      // field-rect bomb keeps the muzzle test: its rect already reaches every
      // on-field muzzle, and a planted beam's muzzle is on-field.
      const caught =
        spec.radius !== undefined
          ? bulletShapeOverlaps(b, this.#x, this.#y, spec.radius)
          : this.#inRange(b.x, b.y, b.radius, spec);
      if (!caught) continue;

      // Recorded before the despawn: the pool hands this slot straight back
      // out, and its position is overwritten by the next spawn.
      if (spec.convertBullets) this.#cleared.push({ x: b.x, y: b.y });
      bullets.despawn(b);
    }
  }

  /**
   * A bomb with a radius is a circle around where it was fired. A bomb without
   * one covers the field rect — the *visible* field, not the universe: fire
   * still queued offscreen inside the cull margin survives, so a screen-clear
   * buys the screen and not the whole wave.
   */
  #inRange(x: number, y: number, radius: number, spec: BombSpec): boolean {
    if (spec.radius !== undefined) {
      return circlesOverlap(this.#x, this.#y, spec.radius, x, y, radius);
    }
    const { width, height } = this.#bounds;
    return (
      x >= -radius && x <= width + radius && y >= -radius && y <= height + radius
    );
  }

  /**
   * Damage this bomb owes something at the given position, this tick, or 0.
   *
   * The escape hatch for targets this system does not own. `step` walks the
   * `EnemySystem` it is handed and nothing else, and a **boss is not in it** —
   * it lives in `BossSystem` and was never passed here. So a bomb dealt exactly
   * zero damage to every boss in the game while still costing a stock and
   * voiding the spell card's bonus, which inverts the entire point of the
   * mechanic: `lance`'s stated identity is "4x damage, no conversion,
   * point-blank on a boss", and point-blank on a boss was its worst use.
   *
   * A query rather than another system parameter, because the alternative is
   * `BombSystem` importing `BossSystem` to reach one number. The game layer
   * already holds both and is where the rule belongs.
   */
  damageAt(x: number, y: number, radius: number): number {
    const spec = this.#spec;
    if (spec === undefined || this.#remaining <= 0) return 0;
    if (spec.damagePerTick <= 0) return 0;
    if (!this.#inRange(x, y, radius, spec)) return 0;
    return spec.damagePerTick;
  }

  /**
   * Bullets cleared since the last drain, oldest first. The game turns these
   * into score items; this system does not decide what they are worth.
   *
   * The returned array is recycled by the next drain — read it or copy it
   * before then.
   */
  drainCleared(): readonly ClearedBullet[] {
    const drained = this.#cleared;
    this.#cleared = this.#spare;
    this.#cleared.length = 0;
    this.#spare = drained;
    return drained;
  }

  /** Cancel the bomb. Already-cleared bullets are still owed to the caller. */
  clear(): void {
    this.#spec = undefined;
    this.#name = '';
    this.#remaining = 0;
  }

  get active(): boolean {
    return this.#remaining > 0;
  }

  get remaining(): number {
    return this.#remaining;
  }

  get x(): number {
    return this.#x;
  }

  get y(): number {
    return this.#y;
  }

  /** The burning bomb's registry name, or '' when idle — for the view layer. */
  get name(): string {
    return this.#name;
  }
}

// The starter bombs — spread and lance — moved into the bundled base pack
// (`tools/make-base-pack.ts` → `base-pack.json`) with the characters that deploy
// them (decisions-round2 §D). This file keeps the machinery only: the `BombSpec`
// shape, the registry and the `BombSystem` that burns one. `effect` names a
// particle effect the game resolves; nothing above knows which bombs exist.
