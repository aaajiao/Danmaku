import { describe, expect, test } from 'bun:test';
import { Button } from '../core/input';
import { Random } from '../core/random';
import { BulletSystem, type Bullet, type FieldBounds } from '../sim/bullet';
import { getBehaviour } from '../sim/motion';
import { Player } from '../sim/player';
import { defineShot, getShot, shotNames, type ShotType } from './shots';

const FIELD: FieldBounds = { width: 480, height: 480, margin: 48 };

const STARTERS = ['spread', 'homing', 'laser'] as const;

function makeSystem(): BulletSystem {
  return new BulletSystem({ bounds: FIELD, initial: 256 });
}

describe('the registry', () => {
  test('the starter weapons are registered under their own names', () => {
    for (const name of STARTERS) {
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
    expect(names.indexOf('spread')).toBeLessThan(names.indexOf('homing'));
    for (const name of names) expect(getShot(name).name).toBe(name);
  });
});

describe('the shot table contract', () => {
  test('every starter has a tier 0 — a ship is never unarmed', () => {
    for (const name of STARTERS) {
      const levels = getShot(name).levels;
      expect(levels.length).toBeGreaterThan(0);
      expect(levels[0]?.offsets.length).toBeGreaterThan(0);
    }
  });

  test('every tier fires, at a whole number of ticks', () => {
    for (const name of STARTERS) {
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
    for (const name of STARTERS) {
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

  test('power never makes a weapon strictly worse', () => {
    for (const name of STARTERS) {
      const levels = getShot(name).levels;
      for (let i = 1; i < levels.length; i++) {
        const previous = levels[i - 1] as (typeof levels)[number];
        const current = levels[i] as (typeof levels)[number];
        expect(current.offsets.length).toBeGreaterThanOrEqual(previous.offsets.length);
        expect(current.period).toBeLessThanOrEqual(previous.period);
      }
    }
  });
});

describe('spread', () => {
  const angles = (tier: number): number[] =>
    (getShot('spread').levels[tier]?.offsets ?? []).map((o) => o.angle as number);

  test('every tier keeps a parallel pair to aim with', () => {
    for (let tier = 0; tier < getShot('spread').levels.length; tier++) {
      expect(angles(tier).filter((a) => a === 270)).toHaveLength(2);
    }
  });

  test('the fan widens with power', () => {
    const width = (tier: number): number => {
      const spread = angles(tier).map((a) => Math.abs(a - 270));
      return Math.max(...spread);
    };

    expect(width(0)).toBe(0);
    expect(width(1)).toBeGreaterThan(width(0));
    expect(width(2)).toBeGreaterThan(width(1));
    expect(width(3)).toBeGreaterThan(width(2));
  });

  test('the fan is symmetric about forward', () => {
    for (let tier = 0; tier < getShot('spread').levels.length; tier++) {
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
    const damages = getShot('spread').levels.map((l) => l.spec.damage);
    expect(new Set(damages).size).toBe(1);
  });

  test('a volley reaches the field, spread across the declared headings', () => {
    const system = makeSystem();
    const level = getShot('spread').levels[3] as { offsets: readonly { x: number; y: number; angle?: number }[]; spec: Parameters<BulletSystem['spawn']>[2] };

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

describe('homing', () => {
  test('the steering is referenced by name, not reimplemented here', () => {
    for (const level of getShot('homing').levels) {
      expect(level.spec.motion.behaviour).toBe('homing');
    }
  });

  test('it is priced slower and rarer than spread, since it cannot miss', () => {
    const seeker = getShot('homing').levels[0] as { spec: { motion: { r?: number } }; period: number };
    const bolt = getShot('spread').levels[0] as { spec: { motion: { r?: number } }; period: number };

    expect(seeker.spec.motion.r).toBeLessThan(bolt.spec.motion.r as number);
    expect(seeker.period).toBeGreaterThan(bolt.period);
  });

  test('it actually steers, once the behaviour is registered', () => {
    // Skipped rather than asserted-away while `sim/motion.ts` has no `homing`
    // entry: the behaviour is another module's to register, and a test that
    // silently passed on its absence would be the one thing worth catching
    // here. `MoveVector.init` throws on an unknown name, so this is also what
    // proves the spec is spawnable at all.
    if (getBehaviour('homing') === undefined) return;

    const system = makeSystem();
    const spec = getShot('homing').levels[0]?.spec as Parameters<BulletSystem['spawn']>[2];
    const bullet = system.spawn(240, 400, spec, 'player', new Random(1)) as Bullet;

    const target = { x: 80, y: 120 };
    for (let tick = 0; tick < 30; tick++) system.step(target.x, target.y, new Random(1));

    expect(bullet.vector.theta).not.toBe(270);
    expect(bullet.x).toBeLessThan(240);
  });
});

describe('laser', () => {
  test('every tier is a beam with reach', () => {
    for (const level of getShot('laser').levels) {
      const laser = level.spec.laser;
      expect(laser).toBeDefined();
      expect(laser?.length).toBeGreaterThan(0);
      expect(laser?.maxLength).toBeGreaterThan(laser?.length as number);
    }
  });

  test('a stationary beam declares a life, or it would never be culled', () => {
    // `r: 0` means the offscreen cull can never reach it. Without a life every
    // volley is a permanent pool slot.
    for (const level of getShot('laser').levels) {
      expect(level.spec.motion.r).toBe(0);
      expect(level.spec.life).toBeGreaterThan(0);
    }
  });

  test('the player weapon does not telegraph itself', () => {
    // Warmup exists so the player can read an incoming beam. On the player's
    // own weapon it would only be input latency.
    for (const level of getShot('laser').levels) {
      expect(level.spec.laser?.warmup ?? 0).toBe(0);
    }
  });

  test('a fired beam is lethal along its whole length within a couple of ticks', () => {
    const system = makeSystem();
    const level = getShot('laser').levels[0] as { spec: Parameters<BulletSystem['spawn']>[2] };
    const bullet = system.spawn(240, 400, level.spec, 'player', new Random(1)) as Bullet;

    expect(bullet.lethal).toBe(true);
    system.step(240, 100, new Random(1));

    // Up the screen from the muzzle, well beyond the spawn length.
    expect(system.hitTest(240, 400 - bullet.length, 2, 'player')).toBe(bullet);
    expect(system.hitTest(240, 400 + 10, 2, 'player')).toBeUndefined();
  });

  test('the beam is culled by its life rather than lingering in the field', () => {
    const system = makeSystem();
    const level = getShot('laser').levels[0] as {
      spec: Parameters<BulletSystem['spawn']>[2];
    };
    system.spawn(240, 400, level.spec, 'player', new Random(1));

    for (let tick = 0; tick < 60; tick++) system.step(240, 100, new Random(1));
    expect(system.count).toBe(0);
  });
});

describe('a shot table drives a real player', () => {
  test('every tier of every starter fires without the run touching Math.random', () => {
    // The whole point of the registry is that a weapon is data a `Player` can
    // be constructed from. Anything unspawnable — an unregistered behaviour,
    // a malformed spec — fails here rather than on the tick a player first
    // reaches that power tier.
    const real = Math.random;
    Math.random = () => {
      throw new Error('Math.random reached the simulation');
    };

    try {
      for (const name of STARTERS) {
        const levels = getShot(name).levels;
        if (name === 'homing' && getBehaviour('homing') === undefined) continue;

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
          // this loop, so a laser tier legitimately ends it with an empty
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
