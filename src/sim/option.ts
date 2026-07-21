/**
 * Options — the satellites that orbit the player and fire alongside it.
 *
 * An option is not an entity in the usual sense. It has no hitbox, it cannot
 * die, and nothing collides with it. What it has is a *target offset* from the
 * ship and a lag on the way there, and that lag is the whole mechanic: the
 * unfocused layout is wide, the focused layout is a tight column, and the
 * transition between them is not an animation but the same chase running
 * against a different target. Snap them to their slots and the ship stops
 * feeling like it is dragging anything.
 *
 * Layouts are indexed by power tier, so a weapon upgrade is a row in
 * `levels`, not a branch here. Upstream ran options through a switch on power
 * inside its player update and hard-coded each offset pair at the call site;
 * here the whole thing is one `OptionSpec` in a registry, and a new option
 * loadout is a new file.
 *
 * The nearest enemy arrives as a parameter rather than being looked up. This
 * file must not know `EnemySystem` exists — options are equally usable by
 * anything that can name a point to aim at, and the dependency would only run
 * one way to buy nothing.
 *
 * Pure simulation: no renderer, no `dt`. `followSpeed` is px/tick and `period`
 * is a tick count. See CLAUDE.md, rules 1 and 3.
 */

import { atan2Deg, normalizeDeg } from '../core/trig';
import type { BulletSpec, BulletSystem } from './bullet';

export interface OptionSlot {
  /** Offset from the player when unfocused. */
  x: number;
  y: number;
  /**
   * Offset when holding focus. Options gather tight under focus — that
   * contrast is the point of the mechanic.
   */
  focusX: number;
  focusY: number;
  /** Fixed heading in degrees, or omit to aim at the nearest enemy. */
  angle?: number;
}

export interface OptionSpec {
  sprite: string;
  shot: BulletSpec;
  /** Ticks between volleys. 0 fires every tick. */
  period: number;
  /** Slots by power level: `levels[2]` is the layout at power tier 2. */
  levels: readonly (readonly OptionSlot[])[];
  /** How fast options chase their target offset, px/tick. Lower trails more. */
  followSpeed?: number;
  tint?: { r?: number; g?: number; b?: number };
}

/**
 * Heading for an aimed option with nothing to aim at. Straight up is the
 * player's forward, so an option with no target still contributes fire rather
 * than freezing on whatever angle it last computed.
 */
const FORWARD = 270;

/** Chase rate when a spec declines to pick one. Roughly a third of a ship. */
const DEFAULT_FOLLOW_SPEED = 1.4;

const registry = new Map<string, OptionSpec>();

export function defineOptions(name: string, spec: OptionSpec): void {
  if (registry.has(name)) {
    throw new Error(`options "${name}" are already defined`);
  }
  registry.set(name, spec);
}

export function getOptionSpec(name: string): OptionSpec {
  const spec = registry.get(name);
  if (!spec) throw new Error(`unknown options "${name}"`);
  return spec;
}

export function optionNames(): readonly string[] {
  return [...registry.keys()];
}

/**
 * One satellite. `angle` is DEGREES in [0, 360), matching the motion DSL — not
 * the radians `Bullet.angle` carries, which is a render value converted at the
 * edge. Fixed and aimed slots report in the same range; see `#aim`.
 */
export interface Option {
  x: number;
  y: number;
  angle: number;
  active: boolean;
}

export class OptionSystem {
  /**
   * Fixed length: the widest layout the spec declares. Allocated once and
   * never resized, so a renderer can hold this array across a whole run and a
   * power-up costs no allocation in the middle of a wave.
   */
  readonly options: Option[] = [];

  readonly #spec: OptionSpec;
  readonly #followSpeed: number;

  constructor(name: string) {
    const spec = getOptionSpec(name);
    this.#spec = spec;
    this.#followSpeed = spec.followSpeed ?? DEFAULT_FOLLOW_SPEED;

    let widest = 0;
    for (const level of spec.levels) {
      if (level.length > widest) widest = level.length;
    }
    for (let i = 0; i < widest; i++) {
      this.options.push({ x: 0, y: 0, angle: FORWARD, active: false });
    }
  }

  /** Power tier selects the slot layout. */
  step(
    playerX: number,
    playerY: number,
    focused: boolean,
    powerLevel: number,
    firing: boolean,
    tick: number,
    bullets: BulletSystem,
    aimTarget?: { x: number; y: number },
  ): void {
    const layout = this.#layout(powerLevel);
    // Fires on the tick, never off an accumulator: an accumulator's drift
    // depends on when firing began, so two identical runs would diverge.
    // Matches `Player.#fire`, which keeps ship and options in phase.
    const period = this.#spec.period;
    const volley = firing && (period <= 0 || tick % period === 0);

    for (let i = 0; i < this.options.length; i++) {
      const option = this.options[i];
      if (option === undefined) continue;

      const slot = layout[i];
      if (slot === undefined) {
        option.active = false;
        continue;
      }

      // A slot that just came into range starts *on* the ship and flies out to
      // its post. Materialising it at the offset would make a power-up read as
      // a pop; letting it chase out is the same lag the rest of the mechanic
      // is built from, so the upgrade announces itself for free.
      if (!option.active) {
        option.active = true;
        option.x = playerX;
        option.y = playerY;
      }

      this.#chase(
        option,
        playerX + (focused ? slot.focusX : slot.x),
        playerY + (focused ? slot.focusY : slot.y),
      );

      option.angle = slot.angle ?? this.#aim(option, aimTarget);

      if (volley) this.#fire(option, bullets);
    }
  }

  /**
   * Move one step toward the target offset, capped at `followSpeed`.
   *
   * Capped rather than eased: an exponential ease (`p += (target - p) * k`)
   * never actually arrives, so an option parked next to a stationary ship
   * keeps writing new positions forever and the trail depends on how long the
   * player has been still. A constant rate arrives, stays, and gives the same
   * trail from the same input every time.
   *
   * `Math.sqrt` is IEEE-exact and therefore safe here; `Math.hypot` is not.
   */
  #chase(option: Option, targetX: number, targetY: number): void {
    const dx = targetX - option.x;
    const dy = targetY - option.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance <= this.#followSpeed || distance === 0) {
      option.x = targetX;
      option.y = targetY;
      return;
    }

    const scale = this.#followSpeed / distance;
    option.x += dx * scale;
    option.y += dy * scale;
  }

  /**
   * Aim from the option's own position, not the ship's. A wide unfocused
   * layout puts the outer satellites tens of pixels off-axis, and firing them
   * along the ship's bearing would visibly miss the very target they are
   * pointed at.
   *
   * Normalized to [0, 360) because `atan2Deg` reports (-180, 180]: straight up
   * comes back as -90 there, while every authored `OptionSlot.angle` and the
   * no-target fallback are written as 270. Leaving both conventions in the
   * same field would hand a renderer a 360° jump at the top of the circle for
   * no reason, and make an aimed slot incomparable with a fixed one.
   * `normalizeDeg` is exact, so this costs no reproducibility.
   */
  #aim(option: Option, target?: { x: number; y: number }): number {
    if (target === undefined) return FORWARD;
    return normalizeDeg(atan2Deg(target.y - option.y, target.x - option.x));
  }

  #fire(option: Option, bullets: BulletSystem): void {
    const bullet = bullets.spawn(option.x, option.y, this.#spec.shot, 'player');
    // Pool ceiling. Drop the shot rather than spin on a spawn that cannot
    // succeed, as the pattern primitives and the player's own fire do.
    if (!bullet) return;
    bullet.vector.theta = option.angle;
  }

  /**
   * Clamped to the table, so a power tier past the last authored layout keeps
   * the strongest one rather than silently dropping every option.
   */
  #layout(powerLevel: number): readonly OptionSlot[] {
    const levels = this.#spec.levels;
    if (levels.length === 0) return [];
    const index = Math.min(Math.max(Math.floor(powerLevel), 0), levels.length - 1);
    return levels[index] ?? [];
  }

  reset(): void {
    for (const option of this.options) {
      option.x = 0;
      option.y = 0;
      option.angle = FORWARD;
      option.active = false;
    }
  }

  /** Options currently deployed — the count the last `step` activated. */
  get count(): number {
    let count = 0;
    for (const option of this.options) {
      if (option.active) count++;
    }
    return count;
  }

  get spec(): OptionSpec {
    return this.#spec;
  }
}

// The starter formations — standard/seeker/picket — moved into the bundled base
// pack (`tools/make-base-pack.ts` → `base-pack.json`) with the characters that
// fly them (decisions-round2 §D). This file keeps the machinery: the `OptionSpec`
// shape, the registry, and the `OptionSystem` that runs a layout. `FORWARD` and
// `DEFAULT_FOLLOW_SPEED` above stay because the system reads them at runtime — a
// no-target aim and a spec's default chase rate — not because a spec is authored
// here. The nesting invariant those layouts obey is enforced by `option.test.ts`
// against whatever is registered, and their damage envelope by `balance.test.ts`.
