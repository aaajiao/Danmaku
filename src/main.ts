/**
 * The browser shell: input in, pixels out, and nothing else.
 *
 * All game logic lives under `src/game/`, which imports no three.js. That split
 * is not tidiness — it is what lets a whole run be simulated and replayed
 * headlessly, which is the only way the determinism contract can be checked at
 * all. Anything added here that decides something belongs in `Run` instead.
 */

import { Audio } from './audio';
import { Input } from './core/input';
import { Loop } from './core/loop';
import { TitleState, type GameContext } from './game/states';
import { StateMachine } from './game/state';
import type { Replay } from './sim/replay';
import type { Run } from './game/run';
import { Background } from './render/background';
import { createBulletAtlas, createShipAtlas } from './render/procedural';
import { SpriteBatch } from './render/sprite-batch';
import { Layer, Stage } from './render/stage';

const FIELD_W = 480;
const FIELD_H = 480;

const field = document.getElementById('field') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLCanvasElement;
const surface = overlay.getContext('2d')!;

const stage = new Stage({ canvas: field, width: FIELD_W, height: FIELD_H });
const background = new Background(stage, 'drift');

const bulletAtlas = createBulletAtlas();
const shipAtlas = createShipAtlas();

/** One batch per layer and blend mode; each is a single instanced draw call. */
const batches = {
  enemies: new SpriteBatch(bulletAtlas, { capacity: 256, renderOrder: Layer.Enemies }),
  items: new SpriteBatch(bulletAtlas, { capacity: 512, renderOrder: Layer.Items }),
  player: new SpriteBatch(shipAtlas, { capacity: 8, renderOrder: Layer.Player }),
  options: new SpriteBatch(bulletAtlas, { capacity: 32, renderOrder: Layer.Player, }),
  playerShots: new SpriteBatch(bulletAtlas, {
    capacity: 2048,
    blending: 'additive',
    renderOrder: Layer.PlayerShots,
  }),
  enemyShots: new SpriteBatch(bulletAtlas, {
    capacity: 8192,
    renderOrder: Layer.EnemyShots,
  }),
  effects: new SpriteBatch(bulletAtlas, {
    capacity: 4096,
    blending: 'additive',
    renderOrder: Layer.Effects,
  }),
};

stage.add(batches.enemies.mesh, 'Enemies');
stage.add(batches.items.mesh, 'Items');
stage.add(batches.player.mesh, 'Player');
stage.add(batches.options.mesh, 'Player', 1);
stage.add(batches.playerShots.mesh, 'PlayerShots');
stage.add(batches.enemyShots.mesh, 'EnemyShots');
stage.add(batches.effects.mesh, 'Effects');

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

const audio = new Audio();
const input = new Input();
input.attach();

const machine = new StateMachine();

/**
 * Seeds come from the wall clock, which is fine: a seed is chosen once, before
 * a run starts, and is then recorded. Nothing inside the simulation ever reads
 * a clock — see CLAUDE.md rule 1.
 */
const context: GameContext = {
  machine,
  nextSeed: () => Date.now() & 0xffffffff,
  onReplay(replay) {
    // Kept only in memory, and exposed so a finished run can be inspected or
    // saved from the console. Persisting these is the natural next step; the
    // format is already serialisable and versioned.
    (globalThis as { __lastReplay?: Replay }).__lastReplay = replay;
  },
};

machine.push(new TitleState(context));

let unlocked = false;

/** Sound is a reaction to events the run drains, never something it triggers. */
const EVENT_SOUNDS: Readonly<Record<string, string>> = {
  'shot-hit': 'hit',
  'enemy-killed': 'explosion',
  'boss-hit': 'hit',
  'player-death': 'death',
  'item-collected': 'pickup',
  graze: 'graze',
  bomb: 'explosion',
};

const loop = new Loop({
  tick() {
    const buttons = input.sample();

    if (!unlocked && buttons !== 0) {
      unlocked = true;
      void audio.unlock();
    }

    machine.tick(buttons);
    background.step();

    for (const state of machine.stack) {
      const run = (state as { run?: Run }).run;
      if (!run) continue;
      for (const event of run.drainEvents()) {
        const sound = EVENT_SOUNDS[event.type];
        if (sound) audio.play(sound);
      }
    }
  },

  render() {
    for (const batch of Object.values(batches)) batch.begin();

    // Bottom-first, so an overlay's base still draws beneath it.
    let hud: Run | undefined;
    for (const state of machine.stack) {
      const run = (state as { run?: Run }).run;
      if (run) {
        drawRun(run);
        hud = run;
      }
    }

    for (const batch of Object.values(batches)) batch.end();

    stage.render();
    drawOverlay(hud);
  },
});

function drawRun(run: Run): void {
  for (const e of run.enemies.enemies) {
    batches.enemies.draw(e.x, e.y, e.spec.sprite, {
      rotation: e.angle,
      width: e.spec.width,
      height: e.spec.height,
      r: e.spec.tint?.r,
      g: e.spec.tint?.g,
      b: e.spec.tint?.b,
    });
  }

  const boss = run.boss.boss;
  if (boss?.alive) {
    batches.enemies.draw(boss.x, boss.y, boss.spec.sprite, {
      rotation: boss.angle,
      width: boss.spec.width,
      height: boss.spec.height,
      r: boss.spec.tint?.r,
      g: boss.spec.tint?.g,
      b: boss.spec.tint?.b,
    });
  }

  for (const item of run.items.items) {
    batches.items.draw(item.x, item.y, item.spec.sprite, {
      rotation: item.angle,
      r: item.spec.tint?.r,
      g: item.spec.tint?.g,
      b: item.spec.tint?.b,
    });
  }

  for (const b of run.bullets.bullets) {
    const batch = b.faction === 'player' ? batches.playerShots : batches.enemyShots;
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

  for (const p of run.effects.particles) {
    batches.effects.draw(p.x, p.y, p.spec.sprite, {
      rotation: p.angle,
      width: 32 * p.scale,
      height: 32 * p.scale,
      r: p.spec.tint?.r,
      g: p.spec.tint?.g,
      b: p.spec.tint?.b,
      a: p.alpha,
    });
  }

  for (const option of run.options.options) {
    if (!option.active) continue;
    batches.options.draw(option.x, option.y, 'glow.small', {
      rotation: option.angle,
      r: 0.8,
      g: 0.95,
      b: 1,
    });
  }

  const player = run.player;
  if (player.alive) {
    const blink = player.invuln > 0 && Math.floor(player.invuln / 4) % 2 === 0;
    batches.player.draw(player.x, player.y, 'ship', {
      width: 40,
      height: 40,
      a: blink ? 0.35 : 1,
      g: blink ? 0.5 : 1,
      b: blink ? 0.5 : 1,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Overlay                                                             */
/* ------------------------------------------------------------------ */

function drawOverlay(run: Run | undefined): void {
  surface.clearRect(0, 0, overlay.width, overlay.height);
  surface.fillStyle = '#0a0a0a';
  surface.fillRect(FIELD_W, 0, overlay.width - FIELD_W, overlay.height);

  drawSidebar(run);

  // Menus and messages are the states' own business; they describe themselves
  // and this only paints what they describe.
  for (const view of machine.views()) {
    if (view.kind === 'playing') continue;
    drawView(view);
  }
}

function drawSidebar(run: Run | undefined): void {
  const x = FIELD_W + 14;
  surface.font = '11px monospace';

  surface.fillStyle = '#cfcfcf';
  surface.fillText('DANMAKU', x, 26);

  if (!run) return;

  const p = run.player;
  surface.fillStyle = '#b8b8b8';
  surface.fillText(`score  ${p.score}`, x, 52);
  surface.fillText(`graze  ${p.graze}`, x, 68);
  surface.fillText(`lives  ${p.lives}`, x, 84);
  surface.fillText(`bombs  ${p.bombs}`, x, 100);
  surface.fillText(`power  ${p.power.toFixed(2)}`, x, 116);

  surface.fillStyle = '#6f6f6f';
  surface.fillText(`tick   ${run.tickCount}`, x, 144);
  surface.fillText(`bullet ${run.bullets.count}`, x, 160);
  surface.fillText(`calls  ${stage.stats.calls}`, x, 176);

  const boss = run.boss.boss;
  if (boss?.alive) drawBossBar(boss);
}

function drawBossBar(boss: NonNullable<Run['boss']['boss']>): void {
  const w = FIELD_W - 60;
  surface.fillStyle = '#2a1a1a';
  surface.fillRect(30, 12, w, 4);
  surface.fillStyle = '#d8607a';
  surface.fillRect(30, 12, w * boss.phaseHpFraction, 4);

  // The timer runs down beside the health, because surviving it is a clear too.
  surface.fillStyle = '#2a2a1a';
  surface.fillRect(30, 20, w, 2);
  surface.fillStyle = '#c8b060';
  surface.fillRect(30, 20, w * (1 - boss.phaseTimeFraction), 2);

  surface.fillStyle = '#9a9a9a';
  surface.font = '10px monospace';
  surface.fillText(boss.phase.name, 30, 36);
}

function drawView(view: { kind: string; title?: string; lines?: readonly string[]; menu?: readonly string[]; selected?: number }): void {
  const cx = FIELD_W / 2;
  let y = 150;

  if (view.title) {
    surface.fillStyle = '#e8e8e8';
    surface.font = '20px monospace';
    surface.textAlign = 'center';
    surface.fillText(view.title, cx, y);
    y += 40;
  }

  surface.font = '12px monospace';
  surface.textAlign = 'center';

  for (const line of view.lines ?? []) {
    surface.fillStyle = '#8a8a8a';
    surface.fillText(line, cx, y);
    y += 20;
  }

  y += 12;
  (view.menu ?? []).forEach((entry, i) => {
    const active = i === view.selected;
    surface.fillStyle = active ? '#e8e8e8' : '#5a5a5a';
    surface.fillText(active ? `> ${entry} <` : entry, cx, y);
    y += 22;
  });

  surface.textAlign = 'left';
}

loop.start();
