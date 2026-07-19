import { Button, Input } from './core/input';
import { Loop } from './core/loop';
import { seedRun, sim } from './core/random';
import { Emitter } from './content/patterns';
import { BulletSystem, type BulletSpec } from './sim/bullet';
import { createBulletAtlas, createShipAtlas } from './render/procedural';
import { SpriteBatch } from './render/sprite-batch';
import { Layer, Stage } from './render/stage';

/** Upstream's play-field dimensions. All content data is authored in this space. */
const FIELD_W = 480;
const FIELD_H = 480;

const field = document.getElementById('field') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLCanvasElement;
const surface = overlay.getContext('2d')!;

const stage = new Stage({ canvas: field, width: FIELD_W, height: FIELD_H });

const bulletAtlas = createBulletAtlas();
const shipAtlas = createShipAtlas();

// One batch per blend mode and layer. Each is a single draw call.
const enemyShots = new SpriteBatch(bulletAtlas, {
  capacity: 4096,
  renderOrder: Layer.EnemyShots,
});
const playerShots = new SpriteBatch(bulletAtlas, {
  capacity: 1024,
  blending: 'additive',
  renderOrder: Layer.PlayerShots,
});
const ship = new SpriteBatch(shipAtlas, { capacity: 4, renderOrder: Layer.Player });

stage.add(enemyShots.mesh, 'EnemyShots');
stage.add(playerShots.mesh, 'PlayerShots');
stage.add(ship.mesh, 'Player');

const bullets = new BulletSystem({
  bounds: { width: FIELD_W, height: FIELD_H, margin: 48 },
  initial: 4000,
});

seedRun(20260720);

/* ------------------------------------------------------------------ */
/* Content                                                             */
/* ------------------------------------------------------------------ */

const blue: BulletSpec = {
  style: { sprite: 'orb.medium', r: 0.45, g: 0.75, b: 1 },
  radius: 4,
  motion: { r: 1.5 },
};

const rose: BulletSpec = {
  style: { sprite: 'needle', r: 1, g: 0.4, b: 0.7, orientToHeading: true },
  radius: 3,
  motion: { r: 2.4 },
};

const amber: BulletSpec = {
  style: { sprite: 'star', r: 1, g: 0.8, b: 0.35, spin: 0.08 },
  radius: 4,
  motion: { r: 1.1, ra: 0.02, rrange: { max: 3.2 } },
};

const shot: BulletSpec = {
  style: { sprite: 'glow.small', r: 0.7, g: 0.95, b: 1, additive: true },
  radius: 3,
  motion: { r: -9, theta: 90 },
  damage: 1,
};

const emitters = [
  new Emitter('spiral', 120, 110, 'enemy', { spec: blue, arms: 4, step: 9, period: 3 }),
  new Emitter('ring', 360, 110, 'enemy', { spec: amber, count: 14, period: 34, rotation: 9 }),
  new Emitter('aimed-fan', 240, 70, 'enemy', { spec: rose, count: 5, spread: 34, period: 52 }),
];

/* ------------------------------------------------------------------ */
/* Player                                                              */
/* ------------------------------------------------------------------ */

const input = new Input();
input.attach();

const SPEED = 3.6;
const SLOW_SPEED = 1.5;
const SHOT_PERIOD = 5;

const player = { x: FIELD_W / 2, y: FIELD_H - 72, radius: 2.5, hits: 0, invuln: 0 };

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/* ------------------------------------------------------------------ */
/* Loop                                                                */
/* ------------------------------------------------------------------ */

const loop = new Loop({
  tick() {
    input.sample();

    const speed = input.held(Button.Slow) ? SLOW_SPEED : SPEED;
    let dx = 0;
    let dy = 0;
    if (input.held(Button.Left)) dx -= 1;
    if (input.held(Button.Right)) dx += 1;
    if (input.held(Button.Up)) dy -= 1;
    if (input.held(Button.Down)) dy += 1;
    if (dx !== 0 && dy !== 0) {
      dx *= Math.SQRT1_2;
      dy *= Math.SQRT1_2;
    }
    player.x = clamp(player.x + dx * speed, 8, FIELD_W - 8);
    player.y = clamp(player.y + dy * speed, 8, FIELD_H - 8);

    if (input.held(Button.Shot) && loop.count % SHOT_PERIOD === 0) {
      bullets.spawn(player.x - 6, player.y - 10, shot, 'player');
      bullets.spawn(player.x + 6, player.y - 10, shot, 'player');
    }

    for (const emitter of emitters) {
      emitter.step(bullets, player.x, player.y, sim);
    }

    bullets.step(player.x, player.y, sim);

    // Grazing distance is generous; the lethal hitbox is tiny. That gap is the
    // whole genre — you survive by threading, not by avoiding.
    if (player.invuln > 0) {
      player.invuln--;
    } else if (bullets.hitTest(player.x, player.y, player.radius, 'enemy')) {
      player.hits++;
      player.invuln = 90;
    }
  },

  render() {
    enemyShots.begin();
    playerShots.begin();
    ship.begin();

    for (const b of bullets.bullets) {
      const batch = b.faction === 'player' ? playerShots : enemyShots;
      batch.draw(b.x, b.y, b.style.sprite, {
        rotation: b.angle,
        r: b.style.r,
        g: b.style.g,
        b: b.style.b,
        a: b.style.a,
      });
    }

    const flash = player.invuln > 0 && Math.floor(player.invuln / 4) % 2 === 0;
    ship.draw(player.x, player.y, 'ship', {
      width: 40,
      height: 40,
      a: flash ? 0.35 : 1,
      g: flash ? 0.5 : 1,
      b: flash ? 0.5 : 1,
    });

    enemyShots.end();
    playerShots.end();
    ship.end();

    stage.render();
    drawHud();
  },
});

function drawHud(): void {
  surface.clearRect(0, 0, overlay.width, overlay.height);
  surface.fillStyle = '#0a0a0a';
  surface.fillRect(FIELD_W, 0, overlay.width - FIELD_W, overlay.height);

  const x = FIELD_W + 14;
  surface.font = '11px monospace';

  surface.fillStyle = '#cfcfcf';
  surface.fillText('DANMAKU', x, 26);

  surface.fillStyle = '#6f6f6f';
  surface.fillText(`tick   ${loop.count}`, x, 52);
  surface.fillText(`bullet ${bullets.count}`, x, 68);
  surface.fillText(`pool   ${bullets.poolSize}`, x, 84);
  surface.fillText(`calls  ${stage.stats.calls}`, x, 100);

  const pads = (navigator.getGamepads?.() ?? []).filter((p) => p?.connected);
  surface.fillStyle = pads.length > 0 ? '#6c9' : '#4a4a4a';
  surface.fillText(`pad    ${pads.length > 0 ? 'yes' : 'no'}`, x, 124);

  surface.fillStyle = player.hits > 0 ? '#c66' : '#4a4a4a';
  surface.fillText(`hits   ${player.hits}`, x, 140);

  surface.fillStyle = '#3a3a3a';
  surface.fillText('arrows move', x, 174);
  surface.fillText('Z    shoot', x, 188);
  surface.fillText('shift  slow', x, 202);
  surface.fillText('pad supported', x, 216);
}

loop.start();
