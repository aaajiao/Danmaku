import { describe, expect, test } from 'bun:test';
import { seedRun } from '../core/random';
import { BulletSystem, type BulletSpec, type FieldBounds } from './bullet';
import {
  defineOptions,
  getOptionSpec,
  optionNames,
  OptionSystem,
  type OptionSlot,
} from './option';

const FIELD: FieldBounds = { width: 480, height: 480, margin: 32 };

function makeBullets(): BulletSystem {
  return new BulletSystem({ bounds: FIELD, initial: 128 });
}

/** Deliberately free of randomised motion, so spawn order is the only variable. */
const TEST_SHOT: BulletSpec = {
  style: { sprite: 'orb.small' },
  radius: 3,
  motion: { r: 10, theta: 270 },
};

/** A shot whose motion draws from the stream — for the determinism cases. */
const RANDOM_SHOT: BulletSpec = {
  style: { sprite: 'orb.small' },
  radius: 3,
  motion: { r: 10, theta: 270, rrandom: { min: 9, max: 11 }, trandom: { min: 266, max: 274 } },
};

const PAIR: readonly OptionSlot[] = [
  { x: -20, y: 0, focusX: -6, focusY: -10, angle: 270 },
  { x: 20, y: 0, focusX: 6, focusY: -10, angle: 270 },
];

const QUAD: readonly OptionSlot[] = [
  ...PAIR,
  { x: -40, y: 10, focusX: -12, focusY: -20, angle: 270 },
  { x: 40, y: 10, focusX: 12, focusY: -20, angle: 270 },
];

defineOptions('test.fixed', {
  sprite: 'orb.medium',
  shot: TEST_SHOT,
  period: 4,
  followSpeed: 2,
  levels: [[], PAIR, QUAD],
});

defineOptions('test.aimed', {
  sprite: 'orb.medium',
  shot: TEST_SHOT,
  period: 3,
  followSpeed: 100, // Snap, so aiming is tested without the lag in the way.
  levels: [[], [{ x: -30, y: 0, focusX: -30, focusY: 0 }]],
});

defineOptions('test.random', {
  sprite: 'orb.medium',
  shot: RANDOM_SHOT,
  period: 2,
  followSpeed: 1.5,
  levels: [[], PAIR, QUAD],
});

/**
 * 3-4-5: a 30/40 gap chased at 5px/tick lands on exact binary fractions, so a
 * strict equality on the chase step is a real claim about reproducibility
 * rather than a rounding accident that happened to hold.
 */
defineOptions('test.triangle', {
  sprite: 'orb.medium',
  shot: TEST_SHOT,
  period: 0,
  followSpeed: 5,
  levels: [[{ x: 30, y: 40, focusX: 30, focusY: 40, angle: 270 }]],
});

/** Settle the options onto their slots so a test can start from rest. */
function settle(
  system: OptionSystem,
  x: number,
  y: number,
  focused: boolean,
  power: number,
  bullets: BulletSystem,
  ticks = 200,
): void {
  for (let i = 0; i < ticks; i++) {
    system.step(x, y, focused, power, false, i, bullets);
  }
}

describe('registry', () => {
  test('specs round-trip by name', () => {
    expect(getOptionSpec('standard').period).toBe(5);
    expect(getOptionSpec('seeker').levels).toHaveLength(4);
  });

  test('the starter set has four power tiers', () => {
    expect(getOptionSpec('standard').levels).toHaveLength(4);
  });

  test('redefining a name throws rather than silently replacing', () => {
    expect(() => {
      defineOptions('test.fixed', getOptionSpec('test.fixed'));
    }).toThrow(/already defined/);
  });

  test('an unknown name throws', () => {
    expect(() => getOptionSpec('test.nope')).toThrow(/unknown options/);
    expect(() => new OptionSystem('test.nope')).toThrow(/unknown options/);
  });

  test('names are enumerable, so tooling can list loadouts', () => {
    expect(optionNames()).toContain('standard');
    expect(optionNames()).toContain('seeker');
  });
});

describe('layout', () => {
  test('the array is sized to the widest tier and never resized', () => {
    const system = new OptionSystem('test.fixed');
    expect(system.options).toHaveLength(4);

    const array = system.options;
    const bullets = makeBullets();
    system.step(240, 400, false, 2, false, 0, bullets);
    expect(system.options).toBe(array);
    expect(system.options).toHaveLength(4);
  });

  test('power tier selects how many options deploy', () => {
    const system = new OptionSystem('test.fixed');
    const bullets = makeBullets();

    system.step(240, 400, false, 0, false, 0, bullets);
    expect(system.count).toBe(0);

    system.step(240, 400, false, 1, false, 1, bullets);
    expect(system.count).toBe(2);

    system.step(240, 400, false, 2, false, 2, bullets);
    expect(system.count).toBe(4);
  });

  test('a tier past the table keeps the strongest layout', () => {
    const system = new OptionSystem('test.fixed');
    const bullets = makeBullets();
    system.step(240, 400, false, 99, false, 0, bullets);
    expect(system.count).toBe(4);
  });

  test('a fractional power tier floors to its layout', () => {
    const system = new OptionSystem('test.fixed');
    const bullets = makeBullets();
    system.step(240, 400, false, 1.9, false, 0, bullets);
    expect(system.count).toBe(2);
  });

  test('options settle exactly on their slot offsets', () => {
    const system = new OptionSystem('test.fixed');
    const bullets = makeBullets();
    settle(system, 240, 400, false, 1, bullets);

    expect(system.options[0]?.x).toBe(220);
    expect(system.options[0]?.y).toBe(400);
    expect(system.options[1]?.x).toBe(260);
    expect(system.options[1]?.y).toBe(400);
  });

  test('focus gathers them to the focused offsets', () => {
    const system = new OptionSystem('test.fixed');
    const bullets = makeBullets();
    settle(system, 240, 400, true, 1, bullets);

    expect(system.options[0]?.x).toBe(234);
    expect(system.options[0]?.y).toBe(390);
    expect(system.options[1]?.x).toBe(246);
  });

  test('a newly deployed option starts on the ship and flies out', () => {
    const system = new OptionSystem('test.fixed');
    const bullets = makeBullets();

    system.step(240, 400, false, 1, false, 0, bullets);
    // One chase step of 2px from the ship, not a pop straight to the slot.
    expect(system.options[0]?.x).toBe(238);
    expect(system.options[0]?.y).toBe(400);
  });
});

describe('lag', () => {
  test('options trail the ship rather than snapping to it', () => {
    const system = new OptionSystem('test.fixed');
    const bullets = makeBullets();
    settle(system, 240, 400, false, 1, bullets);

    // Teleport the ship. A snapping implementation would land on the offset
    // immediately; a chasing one is still 2px per tick behind.
    system.step(340, 400, false, 1, false, 0, bullets);
    expect(system.options[0]?.x).toBe(222);
    expect(system.options[0]?.x).toBeLessThan(320);
  });

  test('the focus transition is the same chase, not a separate animation', () => {
    const system = new OptionSystem('test.fixed');
    const bullets = makeBullets();
    settle(system, 240, 400, false, 1, bullets);

    // 220,400 chasing 234,390: 17.2px away, so one 2px step and no arrival.
    system.step(240, 400, true, 1, false, 0, bullets);
    const option = system.options[0];
    expect(option?.x).toBeGreaterThan(220);
    expect(option?.x).toBeLessThan(234);
    expect(option?.y).toBeLessThan(400);
  });

  test('followSpeed sets the chase rate', () => {
    const slow = new OptionSystem('test.random'); // followSpeed 1.5
    const fast = new OptionSystem('test.fixed'); // followSpeed 2
    const bullets = makeBullets();

    slow.step(240, 400, false, 1, false, 0, bullets);
    fast.step(240, 400, false, 1, false, 0, bullets);
    expect(240 - (slow.options[0]?.x ?? 0)).toBe(1.5);
    expect(240 - (fast.options[0]?.x ?? 0)).toBe(2);
  });

  test('an option at rest stops writing new positions', () => {
    const system = new OptionSystem('test.fixed');
    const bullets = makeBullets();
    settle(system, 240, 400, false, 1, bullets);

    const x = system.options[0]?.x;
    const y = system.options[0]?.y;
    for (let i = 0; i < 50; i++) system.step(240, 400, false, 1, false, i, bullets);
    // An exponential ease never arrives, so the trail would depend on how long
    // the player had been still. A capped rate arrives and stays.
    expect(system.options[0]?.x).toBe(x);
    expect(system.options[0]?.y).toBe(y);
  });
});

describe('aiming', () => {
  test('a slot angle is a fixed heading', () => {
    const system = new OptionSystem('test.fixed');
    const bullets = makeBullets();
    system.step(240, 400, false, 1, false, 0, bullets, { x: 0, y: 0 });
    expect(system.options[0]?.angle).toBe(270);
  });

  test('a slot without an angle aims at the target', () => {
    const system = new OptionSystem('test.aimed');
    const bullets = makeBullets();
    // Option settles at (210, 400); target is directly right of it.
    system.step(240, 400, false, 1, false, 0, bullets, { x: 310, y: 400 });
    expect(system.options[0]?.angle).toBe(0);
  });

  test('aim originates at the option, not the ship', () => {
    const system = new OptionSystem('test.aimed');
    const bullets = makeBullets();
    // Directly above the option at (210, 400) but off to the ship's left.
    system.step(240, 400, false, 1, false, 0, bullets, { x: 210, y: 300 });
    expect(system.options[0]?.angle).toBe(270);
  });

  test('aimed headings are normalized to [0, 360)', () => {
    const system = new OptionSystem('test.aimed');
    const bullets = makeBullets();
    // `atan2Deg` reports (-180, 180], so upward is -90 there. An aimed slot
    // must agree with the fixed slots and the fallback, which say 270.
    for (const target of [
      { x: 210, y: 300 },
      { x: 110, y: 300 },
      { x: 310, y: 300 },
      { x: 110, y: 400 },
    ]) {
      system.step(240, 400, false, 1, false, 0, bullets, target);
      const angle = system.options[0]?.angle ?? -1;
      expect(angle).toBeGreaterThanOrEqual(0);
      expect(angle).toBeLessThan(360);
    }
  });

  test('with no target an aimed option holds forward', () => {
    const system = new OptionSystem('test.aimed');
    const bullets = makeBullets();
    system.step(240, 400, false, 1, false, 0, bullets);
    expect(system.options[0]?.angle).toBe(270);
  });
});

describe('firing', () => {
  test('nothing fires while the shot button is up', () => {
    const system = new OptionSystem('test.fixed');
    const bullets = makeBullets();
    for (let i = 0; i < 40; i++) system.step(240, 400, false, 1, false, i, bullets);
    expect(bullets.count).toBe(0);
  });

  test('a volley is one bullet per active option, on the period', () => {
    const system = new OptionSystem('test.fixed');
    const bullets = makeBullets();
    settle(system, 240, 400, false, 2, bullets);

    system.step(240, 400, false, 2, true, 4, bullets); // 4 % 4 === 0
    expect(bullets.count).toBe(4);

    system.step(240, 400, false, 2, true, 5, bullets);
    expect(bullets.count).toBe(4);
  });

  test('option bullets are player faction and carry the option heading', () => {
    const system = new OptionSystem('test.aimed');
    const bullets = makeBullets();
    system.step(240, 400, false, 1, true, 0, bullets, { x: 310, y: 400 });

    const bullet = bullets.bullets[0];
    expect(bullet?.faction).toBe('player');
    expect(bullet?.vector.theta).toBe(0);
  });

  test('bullets spawn at the option, not at the ship', () => {
    const system = new OptionSystem('test.fixed');
    const bullets = makeBullets();
    settle(system, 240, 400, false, 1, bullets);
    system.step(240, 400, false, 1, true, 4, bullets);

    expect(bullets.bullets[0]?.x).toBe(220);
    expect(bullets.bullets[1]?.x).toBe(260);
  });

  test('an inactive option does not fire', () => {
    const system = new OptionSystem('test.fixed');
    const bullets = makeBullets();
    settle(system, 240, 400, false, 0, bullets);
    system.step(240, 400, false, 0, true, 4, bullets);
    expect(bullets.count).toBe(0);
  });

  test('a full pool drops the shot instead of spinning', () => {
    const system = new OptionSystem('test.fixed');
    const bullets = new BulletSystem({ bounds: FIELD, initial: 1, max: 1 });
    settle(system, 240, 400, false, 2, bullets);

    system.step(240, 400, false, 2, true, 4, bullets);
    expect(bullets.count).toBe(1);
    expect(bullets.droppedSpawns).toBe(3);
  });
});

describe('reset', () => {
  test('clears positions and deployment', () => {
    const system = new OptionSystem('test.fixed');
    const bullets = makeBullets();
    settle(system, 240, 400, false, 2, bullets);
    expect(system.count).toBe(4);

    system.reset();
    expect(system.count).toBe(0);
    expect(system.options[0]?.x).toBe(0);
    expect(system.options[0]?.y).toBe(0);
  });

  test('after a reset options fly out from the ship again', () => {
    const system = new OptionSystem('test.fixed');
    const bullets = makeBullets();
    settle(system, 240, 400, false, 1, bullets);
    system.reset();

    system.step(100, 100, false, 1, false, 0, bullets);
    // Chased 2px out of (100, 100), not resumed from the old slot.
    expect(system.options[0]?.x).toBe(98);
    expect(system.options[0]?.y).toBe(100);
  });
});

describe('determinism', () => {
  /**
   * The valuable tests. Options write bullet spawns into the `sim` stream, so
   * a difference in how many they emit or in what order desyncs every replay
   * downstream — not slightly, but completely (CLAUDE.md, rule 2).
   */
  function run(seed: number): string {
    seedRun(seed);
    const system = new OptionSystem('test.random');
    const bullets = makeBullets();

    let x = 240;
    let y = 400;
    const samples: string[] = [];

    for (let tick = 0; tick < 240; tick++) {
      // A scripted path: moving, focusing and levelling up, so the chase, the
      // layout switch and the aim all participate.
      x += tick % 20 < 10 ? 3 : -3;
      y -= tick % 40 < 20 ? 1 : -1;
      const focused = tick % 60 >= 30;
      const power = tick < 80 ? 1 : 2;

      system.step(x, y, focused, power, true, tick, bullets, { x: 100, y: 40 });
      bullets.step(x, y);

      if (tick % 30 === 0) {
        for (const option of system.options) {
          samples.push(`${option.x},${option.y},${option.angle},${option.active}`);
        }
        samples.push(`n=${bullets.count}`);
      }
    }
    return samples.join('|');
  }

  test('the same seed and inputs reproduce exactly', () => {
    expect(run(12345)).toBe(run(12345));
  });

  test('a different seed diverges', () => {
    expect(run(12345)).not.toBe(run(999));
  });

  test('two systems fed identical inputs stay in lockstep', () => {
    seedRun(7);
    const a = new OptionSystem('test.fixed');
    const bulletsA = makeBullets();
    seedRun(7);
    const b = new OptionSystem('test.fixed');
    const bulletsB = makeBullets();

    for (let tick = 0; tick < 300; tick++) {
      const x = 240 + (tick % 50) * 2;
      const y = 400 - (tick % 30);
      const focused = tick % 17 === 0;
      const power = 1 + (tick % 3 === 0 ? 1 : 0);
      const target = { x: 60 + tick, y: 30 };

      a.step(x, y, focused, power, true, tick, bulletsA, target);
      b.step(x, y, focused, power, true, tick, bulletsB, target);
      bulletsA.step(x, y);
      bulletsB.step(x, y);
    }

    expect(a.options).toEqual(b.options);
    expect(bulletsA.count).toBe(bulletsB.count);
    for (let i = 0; i < bulletsA.bullets.length; i++) {
      expect(bulletsA.bullets[i]?.x).toBe(bulletsB.bullets[i]?.x);
      expect(bulletsA.bullets[i]?.y).toBe(bulletsB.bullets[i]?.y);
    }
  });

  test('a chase step is exactly reproducible, not merely close', () => {
    const system = new OptionSystem('test.triangle');
    const bullets = makeBullets();
    system.step(0, 0, false, 0, false, 0, bullets);
    expect(system.options[0]?.x).toBe(3);
    expect(system.options[0]?.y).toBe(4);
  });

  test('period 0 fires every tick', () => {
    const system = new OptionSystem('test.triangle');
    const bullets = makeBullets();
    for (let tick = 0; tick < 5; tick++) {
      system.step(0, 0, false, 0, true, tick, bullets);
    }
    expect(bullets.count).toBe(5);
  });
});
