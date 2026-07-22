import { describe, expect, test } from 'bun:test';
import { Button } from '../core/input';
import { Random, sim } from '../core/random';
import {
  BulletSystem,
  type Bullet,
  type BulletSpec,
  type FieldBounds,
  type LaserSpec,
} from './bullet';
import { circlesOverlap } from './collision';
import { Player, type PlayerConfig, type ShotSpec } from './player';

const FIELD: FieldBounds = { width: 480, height: 480, margin: 32 };

/** Player shot: fast, upward, and deliberately free of random motion. */
const SHOT_SPEC: BulletSpec = {
  style: { sprite: 'orb.small' },
  radius: 4,
  motion: { r: 12, theta: 270 },
};

const SHOTS: readonly ShotSpec[] = [
  { spec: SHOT_SPEC, offsets: [{ x: 0, y: -10 }], period: 6 },
  {
    spec: SHOT_SPEC,
    offsets: [
      { x: -8, y: -10 },
      { x: 8, y: -10 },
    ],
    period: 4,
  },
  {
    spec: SHOT_SPEC,
    offsets: [
      { x: -8, y: -10, angle: 260 },
      { x: 0, y: -12 },
      { x: 8, y: -10, angle: 280 },
    ],
    period: 3,
  },
];

function makeConfig(overrides: Partial<PlayerConfig> = {}): PlayerConfig {
  return {
    x: 240,
    y: 400,
    speed: 4,
    focusSpeed: 2,
    radius: 2,
    grazeRadius: 20,
    lives: 3,
    bombs: 2,
    invulnTicks: 60,
    shots: SHOTS,
    bounds: { width: 480, height: 480 },
    ...overrides,
  };
}

function makePlayer(overrides: Partial<PlayerConfig> = {}): Player {
  return new Player(makeConfig(overrides));
}

function makeBullets(): BulletSystem {
  return new BulletSystem({ bounds: FIELD, initial: 64 });
}

/** A stationary enemy bullet, so a test can place it and leave it there. */
function enemySpec(radius = 3): BulletSpec {
  return { style: { sprite: 'orb.small' }, radius, motion: { r: 0 } };
}

function place(
  bullets: BulletSystem,
  x: number,
  y: number,
  faction: 'player' | 'enemy' = 'enemy',
  radius = 3,
): Bullet {
  return bullets.spawn(x, y, enemySpec(radius), faction, new Random(1)) as Bullet;
}

/** Run `ticks` steps from tick 0, holding one mask throughout. */
function hold(player: Player, bullets: BulletSystem, buttons: number, ticks: number): void {
  for (let tick = 0; tick < ticks; tick++) player.step(buttons, bullets, tick);
}

describe('construction', () => {
  test('a fresh player starts at the configured position with full stock', () => {
    const player = makePlayer();

    expect(player.x).toBe(240);
    expect(player.y).toBe(400);
    expect(player.lives).toBe(3);
    expect(player.bombs).toBe(2);
    expect(player.alive).toBe(true);
  });

  test('score, graze, power, invuln and deathCount all start at zero', () => {
    const player = makePlayer();

    expect(player.score).toBe(0);
    expect(player.graze).toBe(0);
    expect(player.power).toBe(0);
    expect(player.invuln).toBe(0);
    expect(player.deathCount).toBe(0);
    expect(player.bombing).toBe(false);
  });

  test('the two radii are exposed, and the lethal one is far smaller', () => {
    const player = makePlayer();

    expect(player.radius).toBe(2);
    expect(player.grazeRadius).toBe(20);
    expect(player.radius).toBeLessThan(player.grazeRadius);
  });

  test('focused is false until a mask says otherwise', () => {
    expect(makePlayer().focused).toBe(false);
  });

  test('presentation intents are derived from the last replay mask', () => {
    const player = makePlayer();
    const bullets = makeBullets();

    player.step(Button.Left | Button.Up, bullets, 0);
    expect(player.horizontalIntent).toBe(-1);
    expect(player.horizontalHeldTicks).toBe(1);
    expect(player.verticalIntent).toBe(-1);

    player.step(Button.Left, bullets, 1);
    expect(player.horizontalHeldTicks).toBe(2);

    player.step(Button.Right | Button.Down, bullets, 2);
    expect(player.horizontalIntent).toBe(1);
    expect(player.horizontalHeldTicks).toBe(1);
    expect(player.verticalIntent).toBe(1);

    player.step(Button.Left | Button.Right | Button.Up | Button.Down, bullets, 3);
    expect(player.horizontalIntent).toBe(0);
    expect(player.horizontalHeldTicks).toBe(0);
    expect(player.verticalIntent).toBe(0);
  });
});

describe('movement', () => {
  test('speed is pixels per tick — one tick moves exactly speed pixels', () => {
    const player = makePlayer();
    const bullets = makeBullets();

    player.step(Button.Right, bullets, 0);
    expect(player.x).toBeCloseTo(244, 9);

    hold(player, bullets, Button.Right, 5);
    expect(player.x).toBeCloseTo(264, 9);
  });

  test('each direction moves the expected way in y-down screen space', () => {
    const bullets = makeBullets();
    const cases: Array<[number, number, number]> = [
      [Button.Left, -4, 0],
      [Button.Right, 4, 0],
      [Button.Up, 0, -4],
      [Button.Down, 0, 4],
    ];

    for (const [button, dx, dy] of cases) {
      const player = makePlayer();
      player.step(button, bullets, 0);
      expect(player.x - 240).toBeCloseTo(dx, 9);
      expect(player.y - 400).toBeCloseTo(dy, 9);
    }
  });

  test('a diagonal covers exactly speed pixels, not speed * sqrt(2)', () => {
    const bullets = makeBullets();
    const diagonals = [
      Button.Right | Button.Down,
      Button.Right | Button.Up,
      Button.Left | Button.Down,
      Button.Left | Button.Up,
    ];

    for (const mask of diagonals) {
      const player = makePlayer();
      player.step(mask, bullets, 0);
      expect(Math.hypot(player.x - 240, player.y - 400)).toBeCloseTo(4, 9);
    }
  });

  test('a diagonal is slower on each axis than the axis alone', () => {
    const bullets = makeBullets();
    const straight = makePlayer();
    const diagonal = makePlayer();

    straight.step(Button.Right, bullets, 0);
    diagonal.step(Button.Right | Button.Down, bullets, 0);

    expect(diagonal.x - 240).toBeLessThan(straight.x - 240);
    expect(diagonal.x - 240).toBeCloseTo(4 * Math.SQRT1_2, 9);
  });

  test('opposing directions cancel instead of drifting', () => {
    const player = makePlayer();
    const bullets = makeBullets();

    hold(player, bullets, Button.Left | Button.Right | Button.Up | Button.Down, 10);

    expect(player.x).toBe(240);
    expect(player.y).toBe(400);
  });

  test('one axis still moves when the other is cancelled, at full speed', () => {
    const player = makePlayer();
    const bullets = makeBullets();

    player.step(Button.Left | Button.Right | Button.Down, bullets, 0);

    expect(player.x).toBe(240);
    expect(player.y - 400).toBeCloseTo(4, 9);
  });

  test('Slow swaps in the focus speed', () => {
    const player = makePlayer();
    const bullets = makeBullets();

    player.step(Button.Right | Button.Slow, bullets, 0);
    expect(player.x).toBeCloseTo(242, 9);
    expect(player.focused).toBe(true);
  });

  test('focus applies to diagonals too, still normalised', () => {
    const player = makePlayer();
    const bullets = makeBullets();

    player.step(Button.Right | Button.Down | Button.Slow, bullets, 0);
    expect(Math.hypot(player.x - 240, player.y - 400)).toBeCloseTo(2, 9);
  });

  test('focused tracks the mask handed to the last step', () => {
    const player = makePlayer();
    const bullets = makeBullets();

    player.step(Button.Slow, bullets, 0);
    expect(player.focused).toBe(true);

    player.step(0, bullets, 1);
    expect(player.focused).toBe(false);
  });

  test('the player is clamped inside the field on every edge', () => {
    const bullets = makeBullets();
    const cases: Array<[number, number, number, number, number]> = [
      [Button.Left, 2, 240, 0, 240],
      [Button.Up, 240, 2, 240, 0],
      [Button.Right, 478, 240, 480, 240],
      [Button.Down, 240, 478, 240, 480],
    ];

    for (const [button, startX, startY, endX, endY] of cases) {
      const player = makePlayer({ x: startX, y: startY });
      hold(player, bullets, button, 20);
      expect(player.x).toBe(endX);
      expect(player.y).toBe(endY);
    }
  });

  test('a dead player does not move', () => {
    const player = makePlayer({ lives: 1 });
    const bullets = makeBullets();

    player.kill();
    expect(player.alive).toBe(false);

    hold(player, bullets, Button.Left | Button.Up, 30);
    expect(player.x).toBe(240);
    expect(player.y).toBe(400);
  });

  test('an invulnerable player still moves', () => {
    const player = makePlayer();
    const bullets = makeBullets();

    player.kill();
    expect(player.invuln).toBeGreaterThan(0);

    player.step(Button.Right, bullets, 0);
    expect(player.x).toBeCloseTo(244, 9);
  });
});

describe('firing', () => {
  test('nothing is fired without the shot button', () => {
    const player = makePlayer();
    const bullets = makeBullets();

    hold(player, bullets, Button.Right, 60);
    expect(bullets.count).toBe(0);
  });

  test('a volley lands only on ticks divisible by the period', () => {
    const player = makePlayer();
    const bullets = makeBullets();

    // Period 6 at power 0: ticks 0 and 6 fire within the first twelve.
    hold(player, bullets, Button.Shot, 12);
    expect(bullets.count).toBe(2);
  });

  test('the period is read off the tick, not off how long the button was held', () => {
    const player = makePlayer();
    const bullets = makeBullets();

    // Firing starts at tick 4, so the first volley waits for tick 6 rather
    // than going off immediately — an accumulator would fire at once.
    for (let tick = 4; tick < 7; tick++) player.step(Button.Shot, bullets, tick);

    expect(bullets.count).toBe(1);
    expect(bullets.bullets[0]?.y).toBeCloseTo(390, 9);
  });

  test('a volley spawns one player bullet per muzzle offset', () => {
    const player = makePlayer();
    const bullets = makeBullets();
    player.addPower(1);

    player.step(Button.Shot, bullets, 0);

    expect(bullets.count).toBe(2);
    expect(bullets.bullets.map((b) => b.x)).toEqual([232, 248]);
    for (const b of bullets.bullets) {
      expect(b.faction).toBe('player');
      expect(b.y).toBeCloseTo(390, 9);
    }
  });

  test('muzzles ride the ship rather than the spawn point of the first volley', () => {
    const player = makePlayer();
    const bullets = makeBullets();

    for (let tick = 0; tick <= 6; tick++) {
      player.step(Button.Shot | Button.Right, bullets, tick);
    }

    // Volleys on ticks 0 and 6, by which point the ship has moved six times.
    expect(bullets.count).toBe(2);
    expect(bullets.bullets[0]?.x).toBeCloseTo(244, 9);
    expect(bullets.bullets[1]?.x).toBeCloseTo(240 + 4 * 7, 9);
  });

  test('a muzzle angle overrides the spec heading; without one the spec wins', () => {
    const player = makePlayer();
    const bullets = makeBullets();
    player.addPower(2);

    player.step(Button.Shot, bullets, 0);

    expect(bullets.bullets.map((b) => b.vector.theta)).toEqual([260, 270, 280]);
  });

  test('power picks the shot table entry, changing both spread and rate', () => {
    const bullets = makeBullets();

    const low = makePlayer();
    hold(low, bullets, Button.Shot, 12);
    expect(bullets.count).toBe(2); // period 6, one muzzle

    bullets.clear();
    const high = makePlayer();
    high.addPower(2);
    hold(high, bullets, Button.Shot, 12);
    expect(bullets.count).toBe(12); // period 3, three muzzles
  });

  test('a dead player fires nothing', () => {
    const player = makePlayer({ lives: 1 });
    const bullets = makeBullets();
    player.kill();

    hold(player, bullets, Button.Shot, 60);
    expect(bullets.count).toBe(0);
  });

  test('an invulnerable player still fires', () => {
    const player = makePlayer();
    const bullets = makeBullets();
    player.kill();

    player.step(Button.Shot, bullets, 0);
    expect(bullets.count).toBe(1);
  });

  test('an empty shot table is survivable rather than a crash', () => {
    const player = makePlayer({ shots: [] });
    const bullets = makeBullets();

    expect(() => hold(player, bullets, Button.Shot, 30)).not.toThrow();
    expect(bullets.count).toBe(0);
  });

  test('a period of zero fires every tick', () => {
    const player = makePlayer({
      shots: [{ spec: SHOT_SPEC, offsets: [{ x: 0, y: 0 }], period: 0 }],
    });
    const bullets = makeBullets();

    hold(player, bullets, Button.Shot, 5);
    expect(bullets.count).toBe(5);
  });

  test('focus falls back field-by-field and may override only the formation', () => {
    const focusedOffsets = [{ x: -3, y: -14, angle: 265 }, { x: 3, y: -14, angle: 275 }];
    const player = makePlayer({
      shots: [{ spec: SHOT_SPEC, offsets: [{ x: 0, y: -10 }], period: 4, focused: { offsets: focusedOffsets } }],
    });
    const bullets = makeBullets();

    player.step(Button.Shot | Button.Slow, bullets, 0);

    expect(bullets.count).toBe(2);
    expect(bullets.bullets.map((b) => [b.x, b.y, b.vector.theta])).toEqual([
      [237, 386, 265],
      [243, 386, 275],
    ]);
    expect(bullets.bullets.every((b) => b.style === SHOT_SPEC.style)).toBe(true);
  });

  test('focus may override projectile and cadence without changing base offsets', () => {
    const focusedSpec: BulletSpec = { ...SHOT_SPEC, damage: 9 };
    const player = makePlayer({
      shots: [{ spec: SHOT_SPEC, offsets: [{ x: 0, y: -10 }], period: 6, focused: { spec: focusedSpec, period: 2 } }],
    });
    const bullets = makeBullets();

    hold(player, bullets, Button.Shot | Button.Slow, 5);

    expect(bullets.count).toBe(3); // ticks 0, 2, 4; base offset is retained
    expect(bullets.bullets.every((b) => b.damage === 9 && b.x === 240 && b.y <= 390)).toBe(true);
  });

  test('focus mode is deterministic and an exhausted pool still drops its focused volley', () => {
    const focused = { spec: { ...SHOT_SPEC, damage: 3 }, offsets: [{ x: -4, y: -8 }, { x: 4, y: -8 }], period: 0 };
    const config = { shots: [{ spec: SHOT_SPEC, offsets: [{ x: 0, y: 0 }], period: 6, focused }] };
    const first = makeBullets();
    const second = makeBullets();
    hold(makePlayer(config), first, Button.Shot | Button.Slow, 4);
    hold(makePlayer(config), second, Button.Shot | Button.Slow, 4);
    expect(first.bullets.map((b) => [b.x, b.y, b.damage])).toEqual(second.bullets.map((b) => [b.x, b.y, b.damage]));

    const full = new BulletSystem({ bounds: FIELD, initial: 1, max: 1 });
    expect(() => makePlayer(config).step(Button.Shot | Button.Slow, full, 0)).not.toThrow();
    expect(full.count).toBe(1);
    expect(full.droppedSpawns).toBe(1);
  });

  test('an exhausted pool drops the volley instead of throwing', () => {
    const player = makePlayer();
    const bullets = new BulletSystem({ bounds: FIELD, initial: 1, max: 1 });
    player.addPower(2);

    expect(() => player.step(Button.Shot, bullets, 0)).not.toThrow();
    expect(bullets.count).toBe(1);
    expect(bullets.droppedSpawns).toBe(1);
  });
});

describe('power', () => {
  test('addPower accumulates and clamps to the top of the shot table', () => {
    const player = makePlayer();

    player.addPower(1);
    expect(player.power).toBe(1);

    player.addPower(99);
    expect(player.power).toBe(SHOTS.length - 1);
  });

  test('fractional power accumulates and floors to a shot tier', () => {
    const player = makePlayer();
    const bullets = makeBullets();

    for (let i = 0; i < 10; i++) player.addPower(0.1);
    expect(player.power).toBeCloseTo(1, 9);

    player.step(Button.Shot, bullets, 0);
    expect(bullets.count).toBe(2);
  });

  test('power below a full tier still fires the tier below it', () => {
    const player = makePlayer();
    const bullets = makeBullets();

    player.addPower(0.9);
    player.step(Button.Shot, bullets, 0);
    expect(bullets.count).toBe(1);
  });

  test('power never goes negative', () => {
    const player = makePlayer();

    player.addPower(-5);
    expect(player.power).toBe(0);
  });

  test('a single-entry shot table pins power at zero', () => {
    const player = makePlayer({
      shots: [{ spec: SHOT_SPEC, offsets: [{ x: 0, y: 0 }], period: 2 }],
    });

    player.addPower(10);
    expect(player.power).toBe(0);
  });
});

describe('graze', () => {
  test('a bullet inside the graze circle counts', () => {
    const player = makePlayer();
    const bullets = makeBullets();
    place(bullets, 250, 400);

    expect(player.checkGraze(bullets)).toBe(1);
    expect(player.graze).toBe(1);
  });

  test('a bullet outside the graze circle does not', () => {
    const player = makePlayer();
    const bullets = makeBullets();
    place(bullets, 300, 400);

    expect(player.checkGraze(bullets)).toBe(0);
    expect(player.graze).toBe(0);
  });

  test('the test is against the sum of the radii', () => {
    const bullets = makeBullets();
    // grazeRadius 20 + bullet radius 3 = 23.
    const inside = makePlayer();
    place(bullets, 263, 400);
    expect(inside.checkGraze(bullets)).toBe(1);

    bullets.clear();
    const outside = makePlayer();
    place(bullets, 263.5, 400);
    expect(outside.checkGraze(bullets)).toBe(0);
  });

  test('a lingering bullet counts once, not once per tick', () => {
    const player = makePlayer();
    const bullets = makeBullets();
    place(bullets, 250, 400);

    expect(player.checkGraze(bullets)).toBe(1);
    for (let i = 0; i < 60; i++) expect(player.checkGraze(bullets)).toBe(0);
    expect(player.graze).toBe(1);
  });

  test('several bullets each count once on the tick they arrive', () => {
    const player = makePlayer();
    const bullets = makeBullets();
    const first = place(bullets, 250, 400);
    place(bullets, 240, 410);

    expect(player.checkGraze(bullets)).toBe(2);

    // A third arrives later; the two already counted stay counted.
    place(bullets, 230, 400);
    expect(player.checkGraze(bullets)).toBe(1);
    expect(player.graze).toBe(3);
    expect(first.alive).toBe(true);
  });

  test('a bullet that leaves and returns is a second near miss', () => {
    const player = makePlayer();
    const bullets = makeBullets();
    const bullet = place(bullets, 250, 400);

    expect(player.checkGraze(bullets)).toBe(1);

    bullet.x = 400;
    expect(player.checkGraze(bullets)).toBe(0);

    bullet.x = 250;
    expect(player.checkGraze(bullets)).toBe(1);
    expect(player.graze).toBe(2);
  });

  test('the ship moving into a stationary bullet grazes it', () => {
    const player = makePlayer({ x: 300 });
    const bullets = makeBullets();
    place(bullets, 240, 400);

    expect(player.checkGraze(bullets)).toBe(0);

    hold(player, bullets, Button.Left, 15);
    expect(player.checkGraze(bullets)).toBe(1);
  });

  test('player bullets are never grazed', () => {
    const player = makePlayer();
    const bullets = makeBullets();
    place(bullets, 245, 400, 'player');
    place(bullets, 235, 400, 'player');

    expect(player.checkGraze(bullets)).toBe(0);
    expect(player.graze).toBe(0);
  });

  test('the ship grazes its own outgoing fire not at all', () => {
    const player = makePlayer();
    const bullets = makeBullets();
    player.addPower(2);

    hold(player, bullets, Button.Shot, 3);
    expect(bullets.count).toBeGreaterThan(0);
    expect(player.checkGraze(bullets)).toBe(0);
  });

  test('grazing counts near misses once — Run prices them, Player never scores', () => {
    const player = makePlayer();
    const bullets = makeBullets();
    place(bullets, 250, 400);
    place(bullets, 240, 410);

    // The count moved out of score: `checkGraze` counts and `Run.#award` prices,
    // because score reads the difficulty tier and this pure simulation has none.
    expect(player.checkGraze(bullets)).toBe(2);
    expect(player.graze).toBe(2);
    expect(player.score).toBe(0);

    // Both bullets are already grazed, so a second look this tick counts none.
    expect(player.checkGraze(bullets)).toBe(0);
    expect(player.graze).toBe(2);
    expect(player.score).toBe(0);
  });

  test('a bullet at the lethal radius is grazed too — the radii nest', () => {
    const player = makePlayer();
    const bullets = makeBullets();
    place(bullets, 240, 400);

    expect(player.checkGraze(bullets)).toBe(1);
  });

  test('a bullet well inside the graze circle is not lethal by itself', () => {
    // The whole point of the gap: this bullet scores and does not kill. Only
    // a hitTest against `radius` may reach `kill`.
    const player = makePlayer();
    const bullets = makeBullets();
    place(bullets, 255, 400);

    expect(player.checkGraze(bullets)).toBe(1);
    expect(bullets.hitTest(player.x, player.y, player.radius, 'enemy')).toBeUndefined();
    expect(player.alive).toBe(true);
    expect(player.lives).toBe(3);
  });

  test('a dead player grazes nothing', () => {
    const player = makePlayer({ lives: 1 });
    const bullets = makeBullets();
    place(bullets, 250, 400);
    player.kill();

    expect(player.checkGraze(bullets)).toBe(0);
    expect(player.graze).toBe(0);
  });

  test('an invulnerable player still grazes', () => {
    const player = makePlayer();
    const bullets = makeBullets();
    place(bullets, 250, 400);
    player.kill();

    expect(player.invuln).toBeGreaterThan(0);
    expect(player.checkGraze(bullets)).toBe(1);
  });

  test('a despawned bullet stops being grazed and its slot reuse is not confused', () => {
    const player = makePlayer();
    const bullets = new BulletSystem({ bounds: FIELD, initial: 1, max: 1 });

    const first = bullets.spawn(
      250,
      400,
      { ...enemySpec(), life: 1 },
      'enemy',
      new Random(1),
    ) as Bullet;
    expect(player.checkGraze(bullets)).toBe(1);

    bullets.step(0, 0, new Random(1));
    expect(bullets.count).toBe(0);
    expect(player.checkGraze(bullets)).toBe(0);

    // The pool hands the same object back; it must read as a new near miss.
    const second = bullets.spawn(250, 400, enemySpec(), 'enemy', new Random(1)) as Bullet;
    expect(second).toBe(first);
    expect(player.checkGraze(bullets)).toBe(1);
    expect(player.graze).toBe(2);
  });

  test('a slot despawned and respawned inside one tick still grazes', () => {
    const player = makePlayer();
    const bullets = new BulletSystem({ bounds: FIELD, initial: 1, max: 1 });

    const first = bullets.spawn(
      250,
      400,
      { ...enemySpec(), life: 1 },
      'enemy',
      new Random(1),
    ) as Bullet;
    expect(player.checkGraze(bullets)).toBe(1);

    // The real tick order: step despawns the bullet and the next spawn takes
    // its slot back, with no `checkGraze` in between to forget the old one.
    // Nothing observes the gap, so identity alone cannot tell the two apart.
    bullets.step(0, 0, new Random(1));
    const second = bullets.spawn(250, 400, enemySpec(), 'enemy', new Random(1)) as Bullet;
    expect(second).toBe(first);

    expect(player.checkGraze(bullets)).toBe(1);
    expect(player.graze).toBe(2);
  });

  test('a stream of bullets passing by grazes once each, not once per tick', () => {
    const player = makePlayer();
    const bullets = makeBullets();
    const rng = new Random(3);
    const spec: BulletSpec = {
      style: { sprite: 'orb.small' },
      radius: 3,
      motion: { r: 3, theta: 90 },
    };

    // Spawning stops well before the loop does, so every bullet has time to
    // fall through the graze circle — otherwise the tail is merely in flight.
    let spawned = 0;
    for (let tick = 0; tick < 300; tick++) {
      if (tick < 180 && tick % 5 === 0) {
        bullets.spawn(236 + (spawned % 3) * 4, 300, spec, 'enemy', rng);
        spawned++;
      }
      bullets.step(player.x, player.y, rng);
      player.checkGraze(bullets);
    }

    expect(spawned).toBeGreaterThan(20);
    // Every bullet passes through the circle exactly once on its way down.
    expect(player.graze).toBe(spawned);
  });
});

/**
 * Graze now tests the bullet's real shape, not a circle at its muzzle. You can
 * die to a beam's body but the old muzzle-only graze could never score it — the
 * exact asymmetry `collision.ts` rails against, one method over. Point-bullet
 * graze is byte-identical (the whole `graze` block above still passes); only
 * beams and blades gain body-graze.
 */
describe('graze against a beam body (the asymmetry fix)', () => {
  const beamSpec = (laser: LaserSpec): BulletSpec => ({
    style: { sprite: 'needle' },
    radius: 2,
    motion: { r: 0, theta: 0 }, // +x, so the body runs east from the muzzle
    laser,
  });

  test('a lethal beam body inside the graze ring counts, though its muzzle is far', () => {
    const player = makePlayer(); // at (240, 400), grazeRadius 20
    const bullets = makeBullets();
    // Muzzle at (100, 410), pointing +x, length 200 → the body passes (240,410),
    // 10px below the ship: inside the graze ring (20+2), outside the lethal
    // hitbox. The muzzle alone sits 140px away, well outside the ring.
    const beam = bullets.spawn(100, 410, beamSpec({ length: 200 }), 'enemy', new Random(1)) as Bullet;
    expect(beam.lethal).toBe(true);
    expect(
      circlesOverlap(240, 400, player.grazeRadius, beam.x, beam.y, beam.radius),
    ).toBe(false); // the old muzzle test would have missed it
    expect(player.checkGraze(bullets)).toBe(1);
  });

  test('a warming beam grazes nobody — a near-miss of a telegraph is not danger', () => {
    const player = makePlayer();
    const bullets = makeBullets();
    bullets.spawn(100, 410, beamSpec({ length: 200, warmup: 30 }), 'enemy', new Random(1));
    expect(player.checkGraze(bullets)).toBe(0);
  });

  test('the beam body grazes once, then not again while it lingers', () => {
    const player = makePlayer();
    const bullets = makeBullets();
    bullets.spawn(100, 410, beamSpec({ length: 200 }), 'enemy', new Random(1));
    expect(player.checkGraze(bullets)).toBe(1);
    for (let i = 0; i < 10; i++) expect(player.checkGraze(bullets)).toBe(0);
    expect(player.graze).toBe(1);
  });
});

describe('death', () => {
  test('a kill costs a life, grants invulnerability and counts', () => {
    const player = makePlayer();

    player.kill();

    expect(player.lives).toBe(2);
    expect(player.deathCount).toBe(1);
    expect(player.invuln).toBe(60);
    expect(player.alive).toBe(true);
  });

  test('death does not move the player', () => {
    const player = makePlayer();
    const bullets = makeBullets();

    hold(player, bullets, Button.Right, 5);
    const { x, y } = player;
    player.kill();

    expect(player.x).toBe(x);
    expect(player.y).toBe(y);
  });

  test('invulnerability makes further kills free', () => {
    const player = makePlayer();

    player.kill();
    for (let i = 0; i < 10; i++) player.kill();

    expect(player.lives).toBe(2);
    expect(player.deathCount).toBe(1);
  });

  test('invulnerability ticks down and expires exactly on schedule', () => {
    const player = makePlayer({ invulnTicks: 5 });
    const bullets = makeBullets();

    player.kill();
    expect(player.invuln).toBe(5);

    hold(player, bullets, 0, 4);
    expect(player.invuln).toBe(1);

    player.step(0, bullets, 4);
    expect(player.invuln).toBe(0);

    player.kill();
    expect(player.lives).toBe(1);
    expect(player.deathCount).toBe(2);
  });

  test('invuln never runs below zero', () => {
    const player = makePlayer({ invulnTicks: 2 });
    const bullets = makeBullets();

    player.kill();
    hold(player, bullets, 0, 50);
    expect(player.invuln).toBe(0);
  });

  test('lives is how many deaths the run can absorb', () => {
    const player = makePlayer({ lives: 3, invulnTicks: 0 });

    player.kill();
    expect(player.alive).toBe(true);
    player.kill();
    expect(player.alive).toBe(true);
    player.kill();

    expect(player.alive).toBe(false);
    expect(player.lives).toBe(0);
    expect(player.deathCount).toBe(3);
  });

  test('a dead player cannot die again', () => {
    const player = makePlayer({ lives: 1 });

    player.kill();
    expect(player.alive).toBe(false);

    player.kill();
    expect(player.deathCount).toBe(1);
    expect(player.lives).toBe(0);
  });

  test('a one-life run ends on its first death', () => {
    const player = makePlayer({ lives: 1 });

    player.kill();
    expect(player.alive).toBe(false);
    expect(player.lives).toBe(0);
  });

  test('score and graze survive a death', () => {
    const player = makePlayer();
    const bullets = makeBullets();
    place(bullets, 250, 400);
    player.checkGraze(bullets);

    const { score, graze } = player;
    player.kill();

    expect(player.score).toBe(score);
    expect(player.graze).toBe(graze);
  });
});

describe('bombs', () => {
  test('a press spends a bomb and raises the flag for one tick', () => {
    const player = makePlayer();
    const bullets = makeBullets();

    player.step(Button.Bomb, bullets, 0);
    expect(player.bombing).toBe(true);
    expect(player.bombs).toBe(1);

    player.step(Button.Bomb, bullets, 1);
    expect(player.bombing).toBe(false);
  });

  test('holding the button spends exactly one bomb', () => {
    const player = makePlayer();
    const bullets = makeBullets();

    hold(player, bullets, Button.Bomb, 60);
    expect(player.bombs).toBe(1);
  });

  test('a release and a fresh press spends a second bomb', () => {
    const player = makePlayer();
    const bullets = makeBullets();

    player.step(Button.Bomb, bullets, 0);
    player.step(0, bullets, 1);
    player.step(Button.Bomb, bullets, 2);

    expect(player.bombs).toBe(0);
    expect(player.bombing).toBe(true);
  });

  test('an empty stock refuses, without going negative or flagging', () => {
    const player = makePlayer({ bombs: 0 });
    const bullets = makeBullets();

    player.step(Button.Bomb, bullets, 0);

    expect(player.bombs).toBe(0);
    expect(player.bombing).toBe(false);
  });

  test('a bomb buys invulnerability', () => {
    const player = makePlayer();
    const bullets = makeBullets();

    player.step(Button.Bomb, bullets, 0);
    expect(player.invuln).toBe(60);

    player.kill();
    expect(player.lives).toBe(3);
    expect(player.deathCount).toBe(0);
  });

  test('a dead player cannot bomb', () => {
    const player = makePlayer({ lives: 1 });
    const bullets = makeBullets();
    player.kill();

    player.step(Button.Bomb, bullets, 0);
    expect(player.bombs).toBe(2);
    expect(player.bombing).toBe(false);
  });

  test('bombing while moving and firing does all three', () => {
    const player = makePlayer();
    const bullets = makeBullets();

    player.step(Button.Bomb | Button.Shot | Button.Right, bullets, 0);

    expect(player.bombing).toBe(true);
    expect(player.x).toBeCloseTo(244, 9);
    expect(bullets.count).toBe(1);
  });
});

describe('reset', () => {
  test('reset restores position, stock and score for a new run', () => {
    const player = makePlayer();
    const bullets = makeBullets();

    place(bullets, 250, 400);
    hold(player, bullets, Button.Shot | Button.Right | Button.Bomb, 20);
    expect(player.age).toBeGreaterThan(0);
    player.checkGraze(bullets);
    player.addPower(2);
    player.kill();

    player.reset();

    expect(player.x).toBe(240);
    expect(player.y).toBe(400);
    expect(player.lives).toBe(3);
    expect(player.bombs).toBe(2);
    expect(player.power).toBe(0);
    expect(player.score).toBe(0);
    expect(player.graze).toBe(0);
    expect(player.invuln).toBe(0);
    expect(player.alive).toBe(true);
    expect(player.deathCount).toBe(0);
    expect(player.age).toBe(0);
    expect(player.bombing).toBe(false);
    expect(player.focused).toBe(false);
  });

  test('reset revives a player whose run ended', () => {
    const player = makePlayer({ lives: 1 });
    const bullets = makeBullets();

    player.kill();
    expect(player.alive).toBe(false);

    player.reset();
    player.step(Button.Right, bullets, 0);
    expect(player.x).toBeCloseTo(244, 9);
  });

  test('reset clears the graze memory, so a lingering bullet grazes again', () => {
    const player = makePlayer();
    const bullets = makeBullets();
    place(bullets, 250, 400);

    expect(player.checkGraze(bullets)).toBe(1);
    expect(player.checkGraze(bullets)).toBe(0);

    player.reset();
    expect(player.checkGraze(bullets)).toBe(1);
  });

  test('reset clears the held mask, so a held bomb button re-arms', () => {
    const player = makePlayer();
    const bullets = makeBullets();

    player.step(Button.Bomb, bullets, 0);
    expect(player.bombs).toBe(1);

    player.reset();
    player.step(Button.Bomb, bullets, 1);
    expect(player.bombs).toBe(1);
  });
});

describe('determinism', () => {
  /** A full run driven by a scripted mask, reduced to a comparable trace. */
  const run = (): string => {
    const player = makePlayer();
    const bullets = makeBullets();
    const rng = new Random(0xc0ffee);
    const spec: BulletSpec = {
      style: { sprite: 'orb.small' },
      radius: 3,
      motion: { rrandom: { min: 1, max: 5 }, trandom: { min: 60, max: 120 } },
    };
    const trace: number[] = [];

    for (let tick = 0; tick < 300; tick++) {
      const mask =
        (tick % 7 < 3 ? Button.Left : Button.Right) |
        (tick % 11 === 0 ? Button.Slow : 0) |
        Button.Shot |
        (tick === 120 ? Button.Bomb : 0);

      if (tick % 4 === 0) bullets.spawn(rng.range(200, 280), 260, spec, 'enemy', rng);

      player.step(mask, bullets, tick);
      bullets.step(player.x, player.y, rng);
      player.checkGraze(bullets);
      if (bullets.hitTest(player.x, player.y, player.radius, 'enemy')) player.kill();

      if (tick % 5 === 0) player.addPower(0.05);
      trace.push(player.x, player.y, player.score, player.graze, player.lives, bullets.count);
    }
    return trace.map((n) => n.toFixed(9)).join(',');
  };

  test('the same scripted inputs produce an identical run', () => {
    expect(run()).toBe(run());
  });

  test('the run is non-trivial — it grazes, fires and takes hits', () => {
    const player = makePlayer();
    const bullets = makeBullets();
    const rng = new Random(0xc0ffee);
    const spec: BulletSpec = {
      style: { sprite: 'orb.small' },
      radius: 3,
      motion: { r: 3, theta: 90 },
    };

    for (let tick = 0; tick < 300; tick++) {
      if (tick % 4 === 0) bullets.spawn(rng.range(230, 250), 300, spec, 'enemy', rng);
      player.step(Button.Shot, bullets, tick);
      bullets.step(player.x, player.y, rng);
      player.checkGraze(bullets);
      if (bullets.hitTest(player.x, player.y, player.radius, 'enemy')) player.kill();
    }

    expect(player.graze).toBeGreaterThan(0);
    expect(player.deathCount).toBeGreaterThan(0);
  });

  test('the player never draws from the shared sim stream', () => {
    const before = sim.getState();
    const player = makePlayer();
    const bullets = makeBullets();
    player.addPower(2);

    for (let tick = 0; tick < 120; tick++) {
      player.step(Button.Shot | Button.Right | Button.Slow, bullets, tick);
      player.checkGraze(bullets);
    }

    expect(bullets.count).toBeGreaterThan(0);
    expect(sim.getState()).toEqual(before);
  });

  test('the player never reaches for Math.random', () => {
    const real = Math.random;
    Math.random = () => {
      throw new Error('Math.random reached the simulation');
    };

    try {
      const player = makePlayer();
      const bullets = makeBullets();
      const rng = new Random(17);

      for (let tick = 0; tick < 200; tick++) {
        bullets.spawn(rng.range(220, 260), 380, enemySpec(), 'enemy', rng);
        player.step(Button.Shot | Button.Down | Button.Bomb, bullets, tick);
        player.checkGraze(bullets);
        player.addPower(0.02);
        if (tick % 50 === 0) player.kill();
      }

      expect(player.deathCount).toBeGreaterThan(0);
    } finally {
      Math.random = real;
    }
  });
});
