import { describe, expect, test } from 'bun:test';
import { Button } from '../core/input';
import { Random } from '../core/random';
import { BulletSystem, type Bullet, type FieldBounds } from '../sim/bullet';
import { getBehaviour } from '../sim/motion';
import { Player } from '../sim/player';
// Registers the `homing` behaviour the tracking fixture names, so the steering
// cases below run rather than early-returning. A content import — allowed here.
import './behaviours';
import { defineShot, getShot, shotNames, type ShotType } from './shots';

const FIELD: FieldBounds = { width: 480, height: 480, margin: 48 };

function makeSystem(): BulletSystem {
  return new BulletSystem({ bounds: FIELD, initial: 256 });
}

/*
 * The shipped weapons — spread/needle/homing/laser — no longer live here. They
 * moved into the v4 campaign (`tools/make-v4-content.ts` → `src/v4/content/campaign.json`)
 * with the characters that fire them (decisions-round2 §D), and a `src/content`
 * test may not import that pack. Their exact specs are pinned by the generator
 * drift test (`tools/make-v4-content.test.ts`) and their damage envelope by
 * `src/balance.test.ts`. What THIS file tests is the machinery every weapon runs
 * on — the registry, the shot-table contract, the nesting invariant, and that a
 * table drives a real `Player` — against local fixtures that exercise each of the
 * four archetypes the base pack ships. Named `test.*`, so the process-global
 * registry never confuses them with content and the cross-suite scans skip them.
 */

const FORWARD = 270;

/** A fanning weapon: a parallel pair plus symmetric angled bolts. Mirrors `spread`. */
function fanOffsets(spread: readonly number[]): { x: number; y: number; angle: number }[] {
  const offsets = [
    { x: -6, y: -10, angle: FORWARD },
    { x: 6, y: -10, angle: FORWARD },
  ];
  for (const d of spread) {
    offsets.push({ x: -10, y: -6, angle: FORWARD - d });
    offsets.push({ x: 10, y: -6, angle: FORWARD + d });
  }
  return offsets;
}

const FAN_BOLT = {
  style: { sprite: 'glow.small', r: 0.7, g: 0.95, b: 1 },
  radius: 4,
  motion: { r: 9, theta: FORWARD },
  damage: 1,
} as const;

// Power buys coverage, not damage: every tier fires the same bullet, and each
// tier's muzzle set is a superset of the one below with a period no larger.
defineShot('test.fan', {
  name: 'test.fan',
  description: 'fixture: a fanning weapon',
  levels: [
    { spec: FAN_BOLT, offsets: fanOffsets([]), period: 5 },
    { spec: FAN_BOLT, offsets: fanOffsets([7]), period: 5 },
    { spec: FAN_BOLT, offsets: fanOffsets([7, 15]), period: 4 },
    { spec: FAN_BOLT, offsets: fanOffsets([7, 15, 26]), period: 4 },
  ],
});

/** Parallel needles at 9px steps. Mirrors `needle` — concentration, not coverage. */
function rakeOffsets(pairs: number): { x: number; y: number; angle: number }[] {
  const offsets = [{ x: 0, y: -12, angle: FORWARD }];
  for (let i = 1; i <= pairs; i++) {
    offsets.push({ x: -9 * i, y: -12, angle: FORWARD });
    offsets.push({ x: 9 * i, y: -12, angle: FORWARD });
  }
  return offsets;
}

const RAKE_NEEDLE = {
  style: { sprite: 'needle', r: 1, g: 0.85, b: 0.6, orientToHeading: true },
  radius: 2,
  motion: { r: 11, theta: FORWARD },
  damage: 2,
  blade: { length: 26 },
} as const;

defineShot('test.needle', {
  name: 'test.needle',
  description: 'fixture: parallel needles',
  levels: [
    { spec: RAKE_NEEDLE, offsets: rakeOffsets(0), period: 6 },
    { spec: RAKE_NEEDLE, offsets: rakeOffsets(1), period: 6 },
    { spec: RAKE_NEEDLE, offsets: rakeOffsets(2), period: 6 },
    { spec: RAKE_NEEDLE, offsets: rakeOffsets(3), period: 6 },
  ],
});

// A tracking weapon: it names the `homing` behaviour rather than reimplementing a
// turn, and is priced slower and rarer than the fan since it cannot miss.
const TRACK_SEEKER = {
  style: { sprite: 'scale', r: 1, g: 0.8, b: 0.5, additive: true, orientToHeading: true },
  radius: 5,
  motion: { r: 7, theta: FORWARD, behaviour: 'homing' },
  damage: 1,
} as const;

defineShot('test.homing', {
  name: 'test.homing',
  description: 'fixture: a tracking shot',
  levels: [
    { spec: TRACK_SEEKER, offsets: [{ x: 0, y: -12, angle: FORWARD }], period: 9 },
    {
      spec: TRACK_SEEKER,
      offsets: [
        { x: -7, y: -10, angle: FORWARD },
        { x: 7, y: -10, angle: FORWARD },
      ],
      period: 9,
    },
  ],
});

// A stationary beam: `r: 0`, so it is purely its own length; a `life` so the cull
// can reach it; reach that grows; `pierce`; and NO warmup — a player weapon does
// not telegraph itself. One muzzle at every tier, so nesting holds by construction.
const BEAM = {
  style: { sprite: 'glow.small', r: 0.85, g: 0.7, b: 1, additive: true, orientToHeading: true },
  radius: 3,
  motion: { r: 0, theta: FORWARD },
  damage: 1,
  laser: { length: 48, growth: 90, maxLength: 520 },
  pierce: true,
} as const;

const BEAM_MUZZLE = [{ x: 0, y: -12, angle: FORWARD }] as const;

defineShot('test.beam', {
  name: 'test.beam',
  description: 'fixture: a stationary piercing beam',
  levels: [
    { spec: { ...BEAM, life: 3 }, offsets: BEAM_MUZZLE, period: 6 },
    { spec: { ...BEAM, life: 4 }, offsets: BEAM_MUZZLE, period: 6 },
    { spec: { ...BEAM, life: 5 }, offsets: BEAM_MUZZLE, period: 6 },
    { spec: { ...BEAM, life: 6, laser: { ...BEAM.laser, growth: 120 } }, offsets: BEAM_MUZZLE, period: 5 },
  ],
});

/** The archetype fixtures, for the contract loops. */
const FIXTURES = ['test.fan', 'test.needle', 'test.homing', 'test.beam'] as const;

describe('the registry', () => {
  test('a fixture is registered under its own name', () => {
    for (const name of FIXTURES) {
      expect(shotNames()).toContain(name);
      expect(getShot(name).name).toBe(name);
    }
  });

  test('an unknown shot fails loudly rather than returning undefined', () => {
    expect(() => getShot('no-such-weapon')).toThrow(/unknown shot/);
  });

  test('a name cannot be registered twice', () => {
    const type: ShotType = { name: 'shots.test.duplicate', levels: [] };
    defineShot('shots.test.duplicate', type);

    expect(() => defineShot('shots.test.duplicate', type)).toThrow(/already defined/);
  });

  test('a type whose name disagrees with its key is refused', () => {
    // Two places to write the same string. Catching the disagreement here is
    // what stops every diagnostic downstream from naming the wrong weapon.
    expect(() =>
      defineShot('shots.test.mismatch', { name: 'something-else', levels: [] }),
    ).toThrow(/declares the name/);
  });

  test('shotNames reports registration order and every registered name resolves', () => {
    const names = shotNames();
    expect(names.indexOf('test.fan')).toBeLessThan(names.indexOf('test.homing'));
    for (const name of names) expect(getShot(name).name).toBe(name);
  });
});

describe('the shot table contract', () => {
  test('every fixture has a tier 0 — a ship is never unarmed', () => {
    for (const name of FIXTURES) {
      const levels = getShot(name).levels;
      expect(levels.length).toBeGreaterThan(0);
      expect(levels[0]?.offsets.length).toBeGreaterThan(0);
    }
  });

  test('every tier fires, at a whole number of ticks', () => {
    for (const name of FIXTURES) {
      for (const level of getShot(name).levels) {
        expect(level.period).toBeGreaterThan(0);
        expect(Number.isInteger(level.period)).toBe(true);
        expect(level.offsets.length).toBeGreaterThan(0);
        expect(level.spec.radius).toBeGreaterThan(0);
      }
    }
  });

  test('every tier shoots toward the enemy, never down the screen', () => {
    // 270 is up in the y-down space the DSL uses. A weapon authored in the
    // radian convention, or with the sign flipped, would fire into the floor —
    // and would still typecheck.
    for (const name of FIXTURES) {
      for (const level of getShot(name).levels) {
        for (const muzzle of level.offsets) {
          const angle = muzzle.angle ?? (level.spec.motion.theta as number);
          expect(angle).toBeGreaterThan(180);
          expect(angle).toBeLessThan(360);
          expect(muzzle.y).toBeLessThan(0);
        }
      }
    }
  });
});

describe('a fanning weapon', () => {
  const angles = (tier: number): number[] =>
    (getShot('test.fan').levels[tier]?.offsets ?? []).map((o) => o.angle as number);

  test('every tier keeps a parallel pair to aim with', () => {
    for (let tier = 0; tier < getShot('test.fan').levels.length; tier++) {
      expect(angles(tier).filter((a) => a === 270)).toHaveLength(2);
    }
  });

  test('the fan widens with power', () => {
    const width = (tier: number): number =>
      Math.max(...angles(tier).map((a) => Math.abs(a - 270)));

    expect(width(0)).toBe(0);
    expect(width(1)).toBeGreaterThan(width(0));
    expect(width(2)).toBeGreaterThan(width(1));
    expect(width(3)).toBeGreaterThan(width(2));
  });

  test('the fan is symmetric about forward', () => {
    for (let tier = 0; tier < getShot('test.fan').levels.length; tier++) {
      // `+ 0` collapses the negative zero that mirroring a forward bolt
      // produces — -0 and 0 are the same heading, and only deep equality
      // disagrees.
      const offsets = angles(tier)
        .map((a) => a - 270 + 0)
        .sort((a, b) => a - b);
      const mirrored = offsets.map((a) => -a + 0).sort((a, b) => a - b);
      expect(offsets).toEqual(mirrored);
    }
  });

  test('power buys coverage, not damage', () => {
    const damages = getShot('test.fan').levels.map((l) => l.spec.damage);
    expect(new Set(damages).size).toBe(1);
  });

  test('a volley reaches the field, spread across the declared headings', () => {
    const system = makeSystem();
    const level = getShot('test.fan').levels[3] as { offsets: readonly { x: number; y: number; angle?: number }[]; spec: Parameters<BulletSystem['spawn']>[2] };

    const fired: Bullet[] = [];
    for (const muzzle of level.offsets) {
      const bullet = system.spawn(
        240 + muzzle.x,
        400 + muzzle.y,
        level.spec,
        'player',
        new Random(1),
      ) as Bullet;
      if (muzzle.angle !== undefined) bullet.vector.theta = muzzle.angle;
      fired.push(bullet);
    }

    system.step(240, 100, new Random(1));

    // All of it travelled upward, and the outermost pair diverged horizontally.
    for (const bullet of fired) expect(bullet.y).toBeLessThan(400);
    const xs = fired.map((b) => b.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(20);
  });
});

describe('a tracking weapon', () => {
  test('the steering is referenced by name, not reimplemented here', () => {
    for (const level of getShot('test.homing').levels) {
      expect(level.spec.motion.behaviour).toBe('homing');
    }
  });

  test('it is priced slower and rarer than the fan, since it cannot miss', () => {
    const seeker = getShot('test.homing').levels[0] as { spec: { motion: { r?: number } }; period: number };
    const bolt = getShot('test.fan').levels[0] as { spec: { motion: { r?: number } }; period: number };

    expect(seeker.spec.motion.r).toBeLessThan(bolt.spec.motion.r as number);
    expect(seeker.period).toBeGreaterThan(bolt.period);
  });

  test('it actually steers, once the behaviour is registered', () => {
    // `MoveVector.init` throws on an unknown name, so this is also what proves
    // the spec is spawnable at all. Guarded so the file still runs if some
    // refactor stops registering the behaviour it names.
    if (getBehaviour('homing') === undefined) return;

    const system = makeSystem();
    const spec = getShot('test.homing').levels[0]?.spec as Parameters<BulletSystem['spawn']>[2];
    const bullet = system.spawn(240, 400, spec, 'player', new Random(1)) as Bullet;

    // The enemy-side target and the player-side one are separate arguments, and
    // this is a **player** bullet — so it steers at the fourth argument, not the
    // first two (which in a real run are the ship's own position).
    const target = { x: 80, y: 120 };
    const playerPosition = { x: 240, y: 400 };
    for (let tick = 0; tick < 30; tick++) {
      system.step(playerPosition.x, playerPosition.y, new Random(1), target);
    }

    expect(bullet.vector.theta).not.toBe(270);
    expect(bullet.x).toBeLessThan(240);
  });

  test('a player shot does not steer at the player', () => {
    // Given only the enemy-side target — the ship — a player bullet must hold
    // its heading rather than turn around.
    if (getBehaviour('homing') === undefined) return;

    const system = makeSystem();
    const spec = getShot('test.homing').levels[0]?.spec as Parameters<BulletSystem['spawn']>[2];
    // Fired to the left of the ship, so "turns toward the player" is a turn to
    // the right and unmistakable in `theta`.
    const bullet = system.spawn(140, 400, spec, 'player', new Random(1)) as Bullet;

    for (let tick = 0; tick < 30; tick++) {
      system.step(240, 400, new Random(1));
    }

    expect(bullet.vector.theta).toBe(270);
    expect(bullet.x).toBe(140);
  });
});

describe('a stationary beam', () => {
  test('every tier is a beam with reach', () => {
    for (const level of getShot('test.beam').levels) {
      const laser = level.spec.laser;
      expect(laser).toBeDefined();
      expect(laser?.length).toBeGreaterThan(0);
      expect(laser?.maxLength).toBeGreaterThan(laser?.length as number);
    }
  });

  test('it declares a life, or it would never be culled', () => {
    // `r: 0` means the offscreen cull can never reach it. Without a life every
    // volley is a permanent pool slot.
    for (const level of getShot('test.beam').levels) {
      expect(level.spec.motion.r).toBe(0);
      expect(level.spec.life).toBeGreaterThan(0);
    }
  });

  test('a player weapon does not telegraph itself', () => {
    // Warmup exists so the player can read an incoming beam. On the player's
    // own weapon it would only be input latency.
    for (const level of getShot('test.beam').levels) {
      expect(level.spec.laser?.warmup ?? 0).toBe(0);
    }
  });

  test('a fired beam is lethal along its whole length within a couple of ticks', () => {
    const system = makeSystem();
    const level = getShot('test.beam').levels[0] as { spec: Parameters<BulletSystem['spawn']>[2] };
    const bullet = system.spawn(240, 400, level.spec, 'player', new Random(1)) as Bullet;

    expect(bullet.lethal).toBe(true);
    system.step(240, 100, new Random(1));

    // Up the screen from the muzzle, well beyond the spawn length.
    expect(system.hitTest(240, 400 - bullet.length, 2, 'player')).toBe(bullet);
    expect(system.hitTest(240, 400 + 10, 2, 'player')).toBeUndefined();
  });

  test('the beam is culled by its life rather than lingering in the field', () => {
    const system = makeSystem();
    const level = getShot('test.beam').levels[0] as {
      spec: Parameters<BulletSystem['spawn']>[2];
    };
    system.spawn(240, 400, level.spec, 'player', new Random(1));

    for (let tick = 0; tick < 60; tick++) system.step(240, 100, new Random(1));
    expect(system.count).toBe(0);
  });
});

describe('a shot table drives a real player', () => {
  test('every tier of every fixture fires without the run touching Math.random', () => {
    // The whole point of the registry is that a weapon is data a `Player` can
    // be constructed from. Anything unspawnable — an unregistered behaviour,
    // a malformed spec — fails here rather than on the tick a player first
    // reaches that power tier.
    const real = Math.random;
    Math.random = () => {
      throw new Error('Math.random reached the simulation');
    };

    try {
      for (const name of FIXTURES) {
        const levels = getShot(name).levels;

        for (let tier = 0; tier < levels.length; tier++) {
          const system = makeSystem();
          const player = new Player({
            x: 240,
            y: 400,
            speed: 3.5,
            focusSpeed: 1.4,
            radius: 2.5,
            grazeRadius: 20,
            lives: 3,
            bombs: 3,
            invulnTicks: 90,
            shots: levels,
            bounds: { width: FIELD.width, height: FIELD.height },
          });
          player.addPower(tier);

          // The peak, not the final count: a beam's whole life is shorter than
          // this loop, so a beam tier legitimately ends it with an empty
          // field. What is being asserted is that fire happened at all.
          let peak = 0;
          for (let tick = 0; tick < 40; tick++) {
            player.step(Button.Shot, system, tick);
            system.step(240, 80, new Random(3));
            if (system.count > peak) peak = system.count;
          }

          expect(peak).toBeGreaterThanOrEqual(levels[tier]?.offsets.length as number);
        }
      }
    } finally {
      Math.random = real;
    }
  });
});

/**
 * A power tier must never be worse than the tier below it.
 *
 * This is checked structurally rather than by measuring damage, because a
 * measurement only ever covers the target it was taken against. `spread`'s top
 * tier once measured *stronger* than tier 2 against a radius-14 enemy and 35%
 * weaker against a radius-22 one, and both numbers were true. What was wrong was
 * the shape: tier 3 re-spaced its inner bolts, so it was a different muzzle set
 * rather than a wider one, and a different set can drop bullets the old set was
 * landing.
 *
 * The invariant that removes the whole class:
 *
 *   tier n's muzzle set ⊇ tier n-1's, and period(n) ≤ period(n-1)
 *
 * Under it, every bullet tier n-1 puts on a target tier n also puts there, at
 * least as often — for any target, at any range, with no measurement needed.
 *
 * **Aimed weapons are exempt from the geometry half**, and the exemption is
 * narrow and stated rather than assumed: a bullet that steers to its target
 * cannot be moved off it by shifting the muzzle, so for those only the count and
 * the cadence have to hold — the tracking fixture is the one that qualifies.
 *
 * The base pack's four weapons obey this by construction (the generator authors
 * them so); that they still do is guarded behaviourally at the composition root,
 * where `src/balance.test.ts` measures every real loadout's damage rising with
 * power. Here the checker itself is under test, against fixtures that nest and
 * one hand-built ladder that does not.
 */
describe('power tiers never go backwards', () => {
  const key = (o: { x: number; y: number; angle?: number }) =>
    `${o.x},${o.y},${o.angle ?? 'aimed'}`;

  const steers = (type: ShotType, tier: number): boolean =>
    type.levels[tier]?.spec.motion?.behaviour !== undefined;

  // The nesting fixtures — the aimed one included, held only to count and cadence.
  for (const name of ['test.fan', 'test.needle', 'test.homing'] as const) {
    test(`${name}: each tier keeps what the one below it fired`, () => {
      const type = getShot(name);
      for (let tier = 1; tier < type.levels.length; tier++) {
        const below = type.levels[tier - 1];
        const here = type.levels[tier];
        if (below === undefined || here === undefined) continue;
        const where = `${name} tier ${tier}`;

        // Cadence first: a tier that fires less often is weaker however its
        // muzzles are arranged.
        expect(`${where} period ${here.period}`).toBe(
          `${where} period ${Math.min(here.period, below.period)}`,
        );

        expect(`${where} muzzles ${here.offsets.length}`).toBe(
          `${where} muzzles ${Math.max(here.offsets.length, below.offsets.length)}`,
        );

        if (steers(type, tier) || steers(type, tier - 1)) continue;

        const present = new Set(here.offsets.map(key));
        const dropped = below.offsets.map(key).filter((k) => !present.has(k));
        expect(`${where} dropped ${JSON.stringify(dropped)}`).toBe(`${where} dropped []`);
      }
    });
  }

  test('the check can fail', () => {
    // A ladder nobody has watched reject anything is not evidence. This is the
    // exact shape `spread` once shipped as — a re-spaced inner pair.
    const shifted: ShotType = {
      name: 'test.shifted',
      levels: [
        { spec: { style: { sprite: 'glow.small' }, radius: 4, motion: { r: 9, theta: 270 }, damage: 1 },
          offsets: [{ x: -7, y: -10, angle: 270 }, { x: 7, y: -10, angle: 270 }],
          period: 5 },
        { spec: { style: { sprite: 'glow.small' }, radius: 4, motion: { r: 9, theta: 270 }, damage: 1 },
          offsets: [{ x: -8, y: -10, angle: 270 }, { x: 8, y: -10, angle: 270 }],
          period: 5 },
      ],
    };
    const present = new Set(shifted.levels[1]!.offsets.map(key));
    const dropped = shifted.levels[0]!.offsets.map(key).filter((k) => !present.has(k));
    expect(dropped).toEqual(['-7,-10,270', '7,-10,270']);
  });
});
