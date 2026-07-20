/**
 * The player ship.
 *
 * Two radii, and the gap between them is the genre. `radius` is the lethal
 * hitbox — two or three pixels, small enough that a wall of bullets has holes
 * in it. `grazeRadius` is an order of magnitude larger and costs nothing but
 * score, which is what turns "survive the pattern" into "lean into it".
 *
 * Upstream spread this across `Player.js`, `MyShot.js` and the `Game` object,
 * with the shot table hard-coded in a switch on power. Here the shot table is
 * data on the config, so a new weapon is a new `ShotSpec`, not an edit here.
 *
 * This file is pure simulation: no renderer, no wall clock, no `dt`. Speeds are
 * px/tick and fire rates are tick periods. See CLAUDE.md, rule 1.
 */

import { Button, type Buttons } from '../core/input';
import type { Bullet, BulletSpec, BulletSystem } from './bullet';
import { circlesOverlap } from './collision';

export interface ShotSpec {
  spec: BulletSpec;
  /** Muzzle offsets from the player, px. */
  offsets: readonly { x: number; y: number; angle?: number }[];
  /** Ticks between volleys. */
  period: number;
}

export interface PlayerConfig {
  x: number;
  y: number;
  /** px/tick, normal. */
  speed: number;
  /** px/tick, holding Slow. */
  focusSpeed: number;
  /** LETHAL hitbox. Tiny — this is the genre. */
  radius: number;
  /** Much larger, scoring only. */
  grazeRadius: number;
  /** Deaths the run can absorb before it is over. */
  lives: number;
  bombs: number;
  invulnTicks: number;
  /** Shot table indexed by power level. */
  shots: readonly ShotSpec[];
  /**
   * Highest power the ship can hold. Defaults to the shot table's top index.
   *
   * It has to be settable because **power indexes more than one table**, and
   * the default is only ever right by coincidence. `OptionSpec.levels` is
   * indexed by the same number, so a ship with a 1-entry shot table and a
   * 4-tier option set had its power clamped to 0 and never deployed an option
   * — which is exactly what both shipped characters did, in every run, for the
   * life of the project. `Player` cannot see the option table, so whoever owns
   * both tables passes the ceiling in; see `Run`.
   *
   * A ceiling above the shot table is safe: `#shot` clamps the index, so the
   * ship keeps its strongest weapon rather than disarming.
   */
  maxPower?: number;
  bounds: { width: number; height: number };
}

/**
 * A diagonal is two unit inputs at once. Left unscaled it would carry the ship
 * `speed * sqrt(2)` per tick — the oldest bug in the genre, and one that makes
 * every dodge gap tuned on the axes wrong on the diagonals.
 */
const DIAGONAL = Math.SQRT1_2;

/** Score per bullet grazed. Grazing is a scoring system, so it pays here. */
const GRAZE_SCORE = 10;

/**
 * Power is accumulated on a hundredths grid rather than as a bare float.
 * Ten pickups worth 0.1 sum to 0.9999999999999999 in binary floating point,
 * which floors to the tier below the one the player just earned — the weapon
 * silently fails to upgrade. Snapping each add keeps the total exact.
 */
const POWER_QUANTUM = 100;

export class Player {
  x = 0;
  y = 0;
  lives = 0;
  bombs = 0;
  power = 0;
  score = 0;
  graze = 0;
  invuln = 0;
  alive = true;
  deathCount = 0;

  /**
   * True for exactly the tick a bomb was triggered. The blast, the screen
   * clear and the damage all belong to the game layer; the player owns only
   * the resource and the invulnerability it buys.
   */
  bombing = false;

  /** Lethal hitbox radius. The game tests enemy fire against this. */
  readonly radius: number;
  /** Near-miss radius. Scoring only — nothing here can kill. */
  readonly grazeRadius: number;

  readonly #config: PlayerConfig;

  #buttons: Buttons = 0;
  /**
   * The player is handed a mask, never an `Input`, because a replay is a log
   * of masks and nothing else (CLAUDE.md, rule 4). Press edges are therefore
   * derived here rather than read from `Input.pressed`.
   */
  #previous: Buttons = 0;

  /**
   * Bullets inside the graze circle as of the previous `checkGraze`, each
   * mapped to the life it was in. A bullet scores on the tick it *enters*, so
   * this is what stops a bullet drifting alongside the ship from paying every
   * tick it is nearby.
   *
   * The generation is load-bearing, not defensive. Holding only the last tick's
   * neighbours is *not* on its own enough to be safe against pooling: the free
   * list is LIFO, so a bullet that despawns hands its slot straight to the next
   * spawn, and a wave firing from close range routinely lands that fresh bullet
   * inside the circle on the very next tick. Keyed on identity alone, the new
   * bullet reads as the old one still lingering and the graze is silently lost.
   */
  #grazed = new Map<Bullet, number>();
  #grazing = new Map<Bullet, number>();

  constructor(config: PlayerConfig) {
    this.#config = config;
    this.radius = config.radius;
    this.grazeRadius = config.grazeRadius;
    this.reset();
  }

  /** `buttons` is the mask from `Input.sample()`, sampled once for this tick. */
  step(buttons: number, bullets: BulletSystem, tick: number): void {
    this.#previous = this.#buttons;
    this.#buttons = buttons;
    this.bombing = false;

    // Ahead of everything else, so a bomb or a death landing this tick sets a
    // full allowance that is not immediately spent by its own step.
    if (this.invuln > 0) this.invuln--;

    if (!this.alive) return;

    this.#move();
    this.#tryBomb();
    this.#fire(bullets, tick);
  }

  #move(): void {
    let dx = 0;
    let dy = 0;
    if ((this.#buttons & Button.Left) !== 0) dx -= 1;
    if ((this.#buttons & Button.Right) !== 0) dx += 1;
    if ((this.#buttons & Button.Up) !== 0) dy -= 1;
    if ((this.#buttons & Button.Down) !== 0) dy += 1;
    if (dx === 0 && dy === 0) return;

    const speed = this.focused ? this.#config.focusSpeed : this.#config.speed;
    const scale = dx !== 0 && dy !== 0 ? DIAGONAL : 1;
    this.x += dx * speed * scale;
    this.y += dy * speed * scale;

    // Clamped to the field rect, not to the sprite's extent: how much of the
    // ship may hang over an edge is a view decision, and the hitbox is small
    // enough that the difference is a couple of pixels.
    const { width, height } = this.#config.bounds;
    this.x = Math.min(Math.max(this.x, 0), width);
    this.y = Math.min(Math.max(this.y, 0), height);
  }

  #tryBomb(): void {
    const edge =
      (this.#buttons & Button.Bomb) !== 0 && (this.#previous & Button.Bomb) === 0;
    if (!edge || this.bombs <= 0) return;

    this.bombs--;
    this.bombing = true;
    this.invuln = this.#config.invulnTicks;
  }

  #fire(bullets: BulletSystem, tick: number): void {
    if ((this.#buttons & Button.Shot) === 0) return;

    const shot = this.#shot();
    if (shot === undefined) return;
    // Off the tick, never a float accumulator: an accumulator drifts, and its
    // drift depends on when firing started, so two identical runs diverge.
    if (shot.period > 0 && tick % shot.period !== 0) return;

    for (const muzzle of shot.offsets) {
      const bullet = bullets.spawn(
        this.x + muzzle.x,
        this.y + muzzle.y,
        shot.spec,
        'player',
      );
      // The pool is at its ceiling; drop the rest of the volley rather than
      // spinning on a spawn that cannot succeed, as the pattern primitives do.
      if (!bullet) return;
      if (muzzle.angle !== undefined) bullet.vector.theta = muzzle.angle;
    }
  }

  #shot(): ShotSpec | undefined {
    const shots = this.#config.shots;
    if (shots.length === 0) return undefined;
    const index = Math.min(Math.max(Math.floor(this.power), 0), shots.length - 1);
    return shots[index];
  }

  /** Called by the game when an enemy bullet reaches the lethal radius. */
  kill(): void {
    if (!this.alive || this.invuln > 0) return;

    this.deathCount++;
    this.lives--;
    if (this.lives <= 0) {
      this.lives = 0;
      this.alive = false;
      return;
    }

    // Deliberately no reposition: being thrown back to the start line mid
    // pattern is worse than the death was. The game may move the ship if it
    // wants a Touhou-style respawn.
    this.invuln = this.#config.invulnTicks;
  }

  /**
   * Near-miss scoring. Returns how many bullets grazed *this tick* — each
   * bullet counts once as it enters the circle, not once per tick it lingers.
   *
   * A bullet that leaves the circle and comes back counts again, because that
   * is a second near miss and not a bookkeeping slip.
   */
  checkGraze(bullets: BulletSystem): number {
    const previous = this.#grazed;
    const current = this.#grazing;
    current.clear();

    if (!this.alive) {
      previous.clear();
      return 0;
    }

    let counted = 0;
    for (const bullet of bullets.bullets) {
      if (bullet.faction !== 'enemy' || !bullet.alive) continue;
      if (
        !circlesOverlap(this.x, this.y, this.grazeRadius, bullet.x, bullet.y, bullet.radius)
      ) {
        continue;
      }
      current.set(bullet, bullet.generation);
      // A slot present under an older generation is a different bullet, and a
      // different bullet entering the circle is a fresh near miss.
      if (previous.get(bullet) !== bullet.generation) counted++;
    }

    this.#grazed = current;
    this.#grazing = previous;

    this.graze += counted;
    this.score += counted * GRAZE_SCORE;
    return counted;
  }

  /** Power is clamped to `maxPower`, so every table it indexes stays valid. */
  addPower(amount: number): void {
    const max = this.maxPower;
    const total = Math.round((this.power + amount) * POWER_QUANTUM) / POWER_QUANTUM;
    this.power = Math.min(Math.max(total, 0), max);
  }

  /** The ceiling `addPower` clamps to. See `PlayerConfig.maxPower`. */
  get maxPower(): number {
    const declared = this.#config.maxPower;
    if (declared !== undefined) return Math.max(0, declared);
    return Math.max(0, this.#config.shots.length - 1);
  }

  /** Back to the start of a run. */
  reset(): void {
    const config = this.#config;
    this.x = config.x;
    this.y = config.y;
    this.lives = config.lives;
    this.bombs = config.bombs;
    this.power = 0;
    this.score = 0;
    this.graze = 0;
    this.invuln = 0;
    this.alive = true;
    this.deathCount = 0;
    this.bombing = false;
    this.#buttons = 0;
    this.#previous = 0;
    this.#grazed.clear();
    this.#grazing.clear();
  }

  get focused(): boolean {
    return (this.#buttons & Button.Slow) !== 0;
  }
}
