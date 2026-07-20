/**
 * Player weapons, as data.
 *
 * A character's shot table already lives on its `PlayerConfig` — but written
 * inline, as `run.ts` does today, a weapon belongs to exactly one ship and
 * cannot be named, compared or reused. That is the same shape `sim/option.ts`
 * rejected for option layouts and `content/patterns.ts` rejected for danmaku:
 * a registry instead, so a new weapon is a new file and a ship references it by
 * name.
 *
 * Tiers are indexed exactly as `OptionSpec.levels` is: `levels[n]` is the
 * weapon at power tier `n`, and `Player.#shot` clamps the index, so a table
 * shorter than the power ceiling keeps its strongest entry rather than
 * disarming the ship. Tier 0 is the bare weapon — unlike options, it is never
 * empty, because a ship that cannot shoot until its first pickup has no way to
 * earn one.
 *
 * Pure content: no renderer, no `dt`. Speeds are px/tick and `period` is a tick
 * count (CLAUDE.md, rule 1), and headings are degrees in the y-down space the
 * motion DSL uses — 270 is up, toward the enemy.
 */

import type { ShotSpec } from '../sim/player';
// Load-bearing, not tidiness: `SEEKER` below names the `homing` behaviour, and
// behaviour names are resolved at `MoveVector.init` — i.e. on the tick the
// first bullet spawns, not at definition. Without this import the registered
// `homing` weapon throws the first time the trigger is pulled.
import './behaviours';

export interface ShotType {
  name: string;
  /** By power tier, like OptionSpec.levels. */
  levels: readonly ShotSpec[];
  description?: string;
}

const registry = new Map<string, ShotType>();

export function defineShot(name: string, type: ShotType): void {
  if (registry.has(name)) {
    throw new Error(`shot "${name}" is already defined`);
  }
  // The key and the field are two places to write the same string, so they are
  // two places to write different ones. Content is referenced by name
  // everywhere; a type whose own `name` disagreed with its key would report the
  // wrong weapon in every diagnostic that reads it back.
  if (type.name !== name) {
    throw new Error(`shot "${name}" declares the name "${type.name}"`);
  }
  registry.set(name, type);
}

export function getShot(name: string): ShotType {
  const type = registry.get(name);
  if (!type) throw new Error(`unknown shot "${name}"`);
  return type;
}

/** Registration order. */
export function shotNames(): readonly string[] {
  return [...registry.keys()];
}

/* ------------------------------------------------------------------ */
/* The starter weapons                                                 */
/* ------------------------------------------------------------------ */

/** Straight up. The whole cast fires toward the top of the screen. */
const FORWARD = 270;

/**
 * The default weapon: a pair of parallel bolts that fans out with power.
 *
 * Power buys *coverage*, not damage — every tier fires the same bullet, and the
 * upgrade is more of them across a wider arc. A tier that raised `damage`
 * instead would make the same fight easier without ever changing how it is
 * played, whereas a wider fan trades single-target rate for the ability to
 * cover two lanes at once, which is a decision the player makes with position.
 *
 * The parallel pair survives at every tier. It is what the ship aims with; the
 * angled bolts are added around it rather than replacing it, so the weapon
 * never stops rewarding the player for lining a target up.
 */
const BOLT = {
  style: { sprite: 'glow.small', r: 0.7, g: 0.95, b: 1 },
  radius: 4,
  motion: { r: 9, theta: FORWARD },
  damage: 1,
} as const;

/** Angles are written as a spread either side of forward, then mirrored. */
function fan(spread: readonly number[]): ShotSpec['offsets'] {
  const offsets: { x: number; y: number; angle?: number }[] = [
    { x: -6, y: -10, angle: FORWARD },
    { x: 6, y: -10, angle: FORWARD },
  ];
  for (const degrees of spread) {
    offsets.push({ x: -10, y: -6, angle: FORWARD - degrees });
    offsets.push({ x: 10, y: -6, angle: FORWARD + degrees });
  }
  return offsets;
}

defineShot('spread', {
  name: 'spread',
  description: 'parallel bolts that fan wider with each power tier',
  levels: [
    { spec: BOLT, offsets: fan([]), period: 5 },
    { spec: BOLT, offsets: fan([7]), period: 5 },
    { spec: BOLT, offsets: fan([7, 15]), period: 4 },
    { spec: BOLT, offsets: fan([8, 17, 26]), period: 4 },
  ],
});

/**
 * Tracking shot.
 *
 * The steering itself is not here: it is the registered `homing` behaviour in
 * `./behaviours` (the registry lives in `sim/motion.ts`, the behaviour does
 * not), referenced by name like every other registry entry, so this file never
 * learns how the turn is computed and the behaviour never learns what a player
 * weapon is. No `options` are passed — the behaviour's own defaults decide the
 * turn rate, which keeps the tuning in one place rather than duplicated across
 * every spec that uses it.
 *
 * ## It does not track an enemy, and cannot yet
 *
 * `BulletSystem.step` is handed one aim target for the whole field — the
 * player's position, since that is what enemy fire aims at — and `homing` reads
 * it off `MotionContext` without knowing its own faction. A player bullet
 * carrying this behaviour therefore steers back toward the ship that fired it:
 * measured, these shots curve around and return, landing 12 damage on a
 * stationary target in 400 ticks where `spread` lands 306. Fixing it means
 * giving `MotionContext` a faction-appropriate target, which is an engine
 * change, not a content one. Until then this weapon is registered but must not
 * be put on a character.
 *
 * Priced against `spread` by fire rate and speed, not damage: a bullet that
 * cannot miss is worth far more per shot, so it is slower in the air and comes
 * out at half the cadence. The fan stays narrow — spreading shots that steer
 * themselves would buy nothing.
 */
const SEEKER = {
  style: { sprite: 'scale', r: 1, g: 0.8, b: 0.5, additive: true, orientToHeading: true },
  radius: 5,
  motion: { r: 7, theta: FORWARD, behaviour: 'homing' },
  damage: 1,
} as const;

defineShot('homing', {
  name: 'homing',
  description: 'slow tracking shot; trades rate and speed for never missing',
  levels: [
    { spec: SEEKER, offsets: [{ x: 0, y: -12, angle: FORWARD }], period: 9 },
    {
      spec: SEEKER,
      offsets: [
        { x: -7, y: -10, angle: FORWARD },
        { x: 7, y: -10, angle: FORWARD },
      ],
      period: 9,
    },
    {
      spec: SEEKER,
      offsets: [
        { x: -7, y: -10, angle: FORWARD },
        { x: 7, y: -10, angle: FORWARD },
        { x: 0, y: -14, angle: FORWARD },
      ],
      period: 8,
    },
    {
      spec: SEEKER,
      offsets: [
        { x: -10, y: -8, angle: FORWARD - 6 },
        { x: -4, y: -12, angle: FORWARD },
        { x: 4, y: -12, angle: FORWARD },
        { x: 10, y: -8, angle: FORWARD + 6 },
      ],
      period: 8,
    },
  ],
});

/**
 * A beam.
 *
 * Anchored where it was fired rather than to the ship, which is what makes it a
 * weapon with a *position* — sweeping is a matter of walking the emitter along
 * a row of enemies, and the beams already in the air keep burning where they
 * were left. Short `life` against a short `period` is what reads as continuous:
 * each volley overlaps the last by a tick or two.
 *
 * `life` is not optional here. The beam is stationary (`r: 0`), so the
 * offscreen cull can never reach it and a laser without a life would sit in the
 * field until the pool was exhausted.
 *
 * `growth` costs the beam its first ticks of reach, so point-blank fire is
 * immediate while a distant target has to be held. There is no `warmup`: the
 * telegraph exists so the *player* can read an incoming beam, and a weapon that
 * announced itself to the enemy would only be a delay.
 *
 * ## It has no reach yet, and piercing is the smaller half of that
 *
 * `Run.#resolvePlayerShots` resolves player fire with
 * `enemies.hitTest(b.x, b.y, b.radius)` — a `radius`-px circle at the **muzzle**.
 * The segment hitbox in `sim/bullet.ts` is only consulted by
 * `BulletSystem.hitTest`, which is the enemy-fire-versus-player path. So the
 * beam's whole length is inert against enemies: measured against a stationary
 * target 68px away, this weapon deals **0** damage in 400 ticks while its beam
 * is drawn and collidable out to 318px. Only a target within a few px of the
 * ship's nose is ever hit.
 *
 * Piercing is the second half of the same gap: `#resolvePlayerShots` despawns a
 * player bullet the moment it damages anything, so even at point blank the beam
 * dies on the first enemy it touches. Both are game-layer decisions — the beam
 * needs `Run` to test the segment and to keep the bullet alive through a hit —
 * so neither can be fixed from here. Registered, but not fit to put on a
 * character until it is.
 */
const BEAM = {
  style: {
    sprite: 'glow.small',
    r: 0.85,
    g: 0.7,
    b: 1,
    additive: true,
    orientToHeading: true,
  },
  // Half-width, so the beam is 6px across — generous next to a 4px orb,
  // because the reach is what it is being priced on, not the coverage.
  radius: 3,
  motion: { r: 0, theta: FORWARD },
  damage: 1,
  laser: { length: 48, growth: 90, maxLength: 520 },
} as const;

defineShot('laser', {
  name: 'laser',
  description: 'stationary piercing beam; reach instead of a spread',
  levels: [
    { spec: { ...BEAM, life: 4 }, offsets: [{ x: 0, y: -12, angle: FORWARD }], period: 4 },
    {
      spec: { ...BEAM, life: 5 },
      offsets: [{ x: 0, y: -12, angle: FORWARD }],
      period: 4,
    },
    {
      spec: { ...BEAM, life: 5 },
      offsets: [
        { x: -8, y: -10, angle: FORWARD },
        { x: 8, y: -10, angle: FORWARD },
      ],
      period: 4,
    },
    {
      spec: { ...BEAM, life: 6, laser: { ...BEAM.laser, growth: 120 } },
      offsets: [
        { x: -9, y: -10, angle: FORWARD },
        { x: 0, y: -14, angle: FORWARD },
        { x: 9, y: -10, angle: FORWARD },
      ],
      period: 3,
    },
  ],
});
