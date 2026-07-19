import { Audio } from './audio';
import { Input } from './core/input';
import { Loop } from './core/loop';
import { seedRun, sim } from './core/random';
import { getStage, StageRunner } from './content/stage';
import { BulletSystem, type BulletSpec } from './sim/bullet';
import { EffectSystem } from './sim/effects';
import { EnemySystem } from './sim/enemy';
import { Player } from './sim/player';
import { createBulletAtlas, createShipAtlas } from './render/procedural';
import { SpriteBatch } from './render/sprite-batch';
import { Layer, Stage } from './render/stage';

/** Upstream's play-field dimensions. All content is authored in this space. */
const FIELD_W = 480;
const FIELD_H = 480;
const MARGIN = 48;
const SEED = 0x5747a1;

const field = document.getElementById('field') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLCanvasElement;
const surface = overlay.getContext('2d')!;

const stage = new Stage({ canvas: field, width: FIELD_W, height: FIELD_H });

const bulletAtlas = createBulletAtlas();
const shipAtlas = createShipAtlas();

/**
 * One batch per layer and blend mode; each is a single instanced draw call.
 * The order of `Layer` decides compositing, not the order these are created —
 * but `renderer.sortObjects` must stay on for that to be true.
 */
const enemySprites = new SpriteBatch(bulletAtlas, {
  capacity: 256,
  renderOrder: Layer.Enemies,
});
const playerShots = new SpriteBatch(bulletAtlas, {
  capacity: 1024,
  blending: 'additive',
  renderOrder: Layer.PlayerShots,
});
const enemyShots = new SpriteBatch(bulletAtlas, {
  capacity: 8192,
  renderOrder: Layer.EnemyShots,
});
const effectSprites = new SpriteBatch(bulletAtlas, {
  capacity: 2048,
  blending: 'additive',
  renderOrder: Layer.Effects,
});
const ship = new SpriteBatch(shipAtlas, { capacity: 4, renderOrder: Layer.Player });

stage.add(enemySprites.mesh, 'Enemies');
stage.add(ship.mesh, 'Player');
stage.add(playerShots.mesh, 'PlayerShots');
stage.add(enemyShots.mesh, 'EnemyShots');
stage.add(effectSprites.mesh, 'Effects');

/* ------------------------------------------------------------------ */
/* Systems                                                             */
/* ------------------------------------------------------------------ */

const bounds = { width: FIELD_W, height: FIELD_H, margin: MARGIN };

const bullets = new BulletSystem({ bounds, initial: 4000 });
const enemies = new EnemySystem({ bounds, bullets, initial: 64 });
const effects = new EffectSystem({ initial: 1024 });
const audio = new Audio();

const shot: BulletSpec = {
  style: { sprite: 'glow.small', r: 0.7, g: 0.95, b: 1 },
  radius: 4,
  motion: { r: 9, theta: 270 },
  damage: 1,
};

const player = new Player({
  x: FIELD_W / 2,
  y: FIELD_H - 72,
  speed: 3.6,
  focusSpeed: 1.5,
  // Lethal radius against a 40px sprite. That ratio is the genre.
  radius: 2.5,
  grazeRadius: 20,
  lives: 3,
  bombs: 3,
  invulnTicks: 90,
  shots: [{ spec: shot, offsets: [{ x: -6, y: -10 }, { x: 6, y: -10 }], period: 5 }],
  bounds: { width: FIELD_W, height: FIELD_H },
});

seedRun(SEED);
const runner = new StageRunner(getStage('stage-1'), enemies);

const input = new Input();
input.attach();

/* ------------------------------------------------------------------ */
/* Simulation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Resolve player shot against enemies.
 *
 * Lives here rather than in either system because it is a rule of *this game* —
 * whether shot pierces, how damage is applied, what a kill is worth. The systems
 * stay ignorant of each other.
 */
function resolvePlayerShots(): void {
  for (let i = bullets.bullets.length - 1; i >= 0; i--) {
    const b = bullets.bullets[i];
    if (b === undefined || b.faction !== 'player') continue;

    const hit = enemies.hitTest(b.x, b.y, b.radius);
    if (hit === undefined) continue;

    const killed = enemies.damage(hit, b.damage);
    if (!killed && hit.spec.onHit) effects.emit(hit.spec.onHit, b.x, b.y);
    audio.play(killed ? 'explosion' : 'hit');

    // Shot does not pierce: despawn rather than flagging, so it leaves
    // collision, rendering and the pool in one step.
    bullets.despawn(b);
  }
}

function resolveDeaths(): void {
  for (const death of enemies.drainDeaths()) {
    if (death.spec.onDeath) effects.emit(death.spec.onDeath, death.x, death.y);
    player.score += death.spec.scoreValue ?? 0;
    const power = death.spec.drops?.power;
    if (power) player.addPower(power);
  }
}

function resolvePlayerHit(): void {
  if (player.invuln > 0 || !player.alive) return;
  const hit = bullets.hitTest(player.x, player.y, 2.5, 'enemy');
  if (hit === undefined) return;
  bullets.despawn(hit);
  player.kill();
  effects.emit('death.big', player.x, player.y);
  audio.play('death');
}

let unlocked = false;

const loop = new Loop({
  tick() {
    const buttons = input.sample();

    // Browsers require a user gesture before audio may start.
    if (!unlocked && buttons !== 0) {
      unlocked = true;
      void audio.unlock();
    }

    runner.step(sim);
    enemies.step(player.x, player.y, sim);
    player.step(buttons, bullets, loop.count);
    bullets.step(player.x, player.y, sim);

    resolvePlayerShots();
    resolveDeaths();
    if (player.checkGraze(bullets) > 0) audio.play('graze');
    resolvePlayerHit();

    effects.step();
  },

  render() {
    enemySprites.begin();
    playerShots.begin();
    enemyShots.begin();
    effectSprites.begin();
    ship.begin();

    for (const e of enemies.enemies) {
      enemySprites.draw(e.x, e.y, e.spec.sprite, {
        rotation: e.angle,
        width: e.spec.width,
        height: e.spec.height,
        r: e.spec.tint?.r,
        g: e.spec.tint?.g,
        b: e.spec.tint?.b,
      });
    }

    for (const b of bullets.bullets) {
      const batch = b.faction === 'player' ? playerShots : enemyShots;
      batch.draw(b.x, b.y, b.style.sprite, {
        rotation: b.angle,
        width: b.style.width,
        height: b.style.height,
        r: b.style.r,
        g: b.style.g,
        b: b.style.b,
        a: b.style.a,
      });
    }

    for (const p of effects.particles) {
      const cell = p.spec.sprite;
      effectSprites.draw(p.x, p.y, cell, {
        rotation: p.angle,
        width: 32 * p.scale,
        height: 32 * p.scale,
        r: p.spec.tint?.r,
        g: p.spec.tint?.g,
        b: p.spec.tint?.b,
        a: p.alpha,
      });
    }

    if (player.alive) {
      const blink = player.invuln > 0 && Math.floor(player.invuln / 4) % 2 === 0;
      ship.draw(player.x, player.y, 'ship', {
        width: 40,
        height: 40,
        a: blink ? 0.35 : 1,
        g: blink ? 0.5 : 1,
        b: blink ? 0.5 : 1,
      });
    }

    enemySprites.end();
    playerShots.end();
    enemyShots.end();
    effectSprites.end();
    ship.end();

    stage.render();
    drawHud();
  },
});

/* ------------------------------------------------------------------ */
/* HUD                                                                 */
/* ------------------------------------------------------------------ */

function drawHud(): void {
  surface.clearRect(0, 0, overlay.width, overlay.height);
  surface.fillStyle = '#0a0a0a';
  surface.fillRect(FIELD_W, 0, overlay.width - FIELD_W, overlay.height);

  const x = FIELD_W + 14;
  surface.font = '11px monospace';

  surface.fillStyle = '#cfcfcf';
  surface.fillText('DANMAKU', x, 26);

  surface.fillStyle = '#b8b8b8';
  surface.fillText(`score  ${player.score}`, x, 52);
  surface.fillText(`graze  ${player.graze}`, x, 68);
  surface.fillText(`lives  ${player.lives}`, x, 84);
  surface.fillText(`power  ${player.power.toFixed(2)}`, x, 100);

  surface.fillStyle = '#6f6f6f';
  surface.fillText(`tick   ${runner.tick}`, x, 128);
  surface.fillText(`enemy  ${enemies.count}`, x, 144);
  surface.fillText(`bullet ${bullets.count}`, x, 160);
  surface.fillText(`fx     ${effects.count}`, x, 176);
  surface.fillText(`calls  ${stage.stats.calls}`, x, 192);

  const pads = (navigator.getGamepads?.() ?? []).filter((p) => p?.connected);
  surface.fillStyle = pads.length > 0 ? '#6c9' : '#4a4a4a';
  surface.fillText(`pad    ${pads.length > 0 ? 'yes' : 'no'}`, x, 216);

  if (runner.finished) {
    surface.fillStyle = '#8a8';
    surface.fillText('stage clear', x, 244);
  } else if (!player.alive) {
    surface.fillStyle = '#c66';
    surface.fillText('game over', x, 244);
  }

  surface.fillStyle = '#3a3a3a';
  surface.fillText('arrows move', x, 288);
  surface.fillText('Z     shoot', x, 302);
  surface.fillText('shift focus', x, 316);
}

loop.start();
