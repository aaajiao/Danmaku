/**
 * The browser shell: input in, pixels out, and nothing else.
 *
 * All game logic lives under `src/game/`, which imports no three.js. That split
 * is not tidiness — it is what lets a whole run be simulated and replayed
 * headlessly, which is the only way the determinism contract can be checked at
 * all. Anything added here that decides something belongs in `Run` instead.
 */

// Side-effect import: content registers itself when its module is evaluated, so
// a stage nothing imports simply does not exist at runtime. See content/index.ts.
import './content';
// Same reason, for the scenes. A stage names its background as a string, so a
// background module nobody imports fails at the moment the stage is entered —
// far from the file that is actually missing. See render/backgrounds/index.ts.
import './render/backgrounds';

import { Audio } from './audio';
import { Input } from './core/input';
import { Loop } from './core/loop';
import { TitleState, type GameContext } from './game/states';
import { StateMachine } from './game/state';
import type { Replay } from './sim/replay';
import type { Run, RunEventType } from './game/run';
import { Background } from './render/background';
import { createBulletAtlas, createShipAtlas } from './render/procedural';
import { PostProcessing } from './render/post';
import { SpriteBatch } from './render/sprite-batch';
import { Layer, Stage } from './render/stage';

const FIELD_W = 480;
const FIELD_H = 480;

const field = document.getElementById('field') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLCanvasElement;
const surface = overlay.getContext('2d')!;

const stage = new Stage({ canvas: field, width: FIELD_W, height: FIELD_H });

/**
 * Ticks a scene change takes. One second: long enough that entering a spell
 * card reads as the room changing rather than as a cut, short enough that it
 * has resolved before the card's opening pattern is dense enough to matter.
 *
 * A single constant covers both kinds of change — stage to stage, and stage to
 * spell card — because so far nothing has wanted them to differ. If one does,
 * it belongs on the `BackgroundSpec` of the scene being entered, not here.
 */
const SCENE_FADE_TICKS = 60;

/**
 * `drift` is the shell's own scene, not any stage's: it is what the title
 * screen sits on, and what a run with no declared background leaves in place.
 * Stages name their own (`expanse`, `undertow`) and the tick loop reconciles.
 */
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

/**
 * Bloom is on by default, and that is a product decision rather than a default
 * left alone. Bullets ship as white art tinted per instance; without bloom a
 * full curtain composites as flat stickers on black, and with it the cores
 * bleed into their neighbours and read as light. It costs fill rate, so `B`
 * turns it off — and if the composer cannot be built at all, `PostProcessing`
 * falls back to `stage.render()` and the game still draws.
 */
const post = new PostProcessing(stage, { enabled: true });

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

const audio = new Audio();
const input = new Input();
input.attach();

const machine = new StateMachine();

/**
 * The bloom toggle listens here rather than joining `Input`.
 *
 * A replay is a frame-indexed log of the button mask and nothing else
 * (CLAUDE.md, rule 4). A display setting that entered that mask would be
 * recorded into replays and would make how the game looked part of what the
 * game did. `KeyB` is deliberately absent from `input.ts`'s `KEY_MAP`, so this
 * and the simulation cannot collide.
 */
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyB' || e.repeat) return;
  post.enabled = !post.enabled;
});

// Exposed for the by-eye checks documented in `render/post.ts` and in
// `render/background.ts` — those headers tell you to build, step and cross-fade
// these from the console, which is impossible if nothing holds a reference. The
// tuning sweeps live there because there is no GL context in tests.
(globalThis as { __post?: PostProcessing }).__post = post;
(globalThis as { __background?: Background }).__background = background;

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

/**
 * Sound is a reaction to events the run drains, never something it triggers.
 *
 * Typed as a `Partial<Record<RunEventType, …>>` rather than
 * `Record<string, string>`, and that is the fix, not decoration. The old type
 * accepted any key, so `'item-collected'` — a `RunEventType` that has never
 * existed; the run emits `'pickup'` — sat here silently for the life of the
 * project and every pickup in every run was mute. Under this annotation the
 * same typo is a compile error (verified: TS2353), which turns a whole class
 * of "wired to a name nobody checked" into something the build catches.
 */
const EVENT_SOUNDS: Partial<Record<RunEventType, string>> = {
  shot: 'shot',
  'shot-hit': 'hit',
  'enemy-killed': 'explosion',
  'boss-hit': 'hit',
  'boss-entered': 'explosion',
  'boss-phase': 'pickup',
  'boss-cleared': 'explosion',
  'boss-defeated': 'explosion',
  'player-death': 'death',
  pickup: 'pickup',
  extend: 'pickup',
  graze: 'graze',
  bomb: 'explosion',
  cleared: 'pickup',
  failed: 'death',
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

    let scene: string | undefined;

    for (const state of machine.stack) {
      const run = (state as { run?: Run }).run;
      if (!run) continue;

      // Bottom-up, so the topmost run wins — the same precedence the render
      // callback uses to pick whose HUD to draw.
      scene = run.scene ?? scene;

      for (const event of run.drainEvents()) {
        const sound = EVENT_SOUNDS[event.type];
        if (sound) audio.play(sound);
      }
    }

    // Reconcile rather than react: `run.scene` is a declaration of where we are,
    // checked every tick against what is actually up. Comparing against
    // `background.name` is what makes this cheap — the name flips to the
    // incoming scene at the *start* of a fade, so an in-flight transition no
    // longer matches and cannot be restarted by the next tick's check.
    if (scene !== undefined && scene !== background.name) {
      background.transitionTo(scene, SCENE_FADE_TICKS);
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

    post.render();
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

    // A beam is a line, and its stored position is the **muzzle** — one end,
    // not the middle. Drawn as an ordinary centred quad it collapses to a stub
    // pinned to the emitter: `LaserSpec`'s own header says a renderer "must
    // therefore offset it by half the length", and this loop never did. The
    // result was a fully lethal 600px hitbox represented on screen by a few
    // pixels of sprite, which is the one thing a bullet-hell game may not do.
    //
    // The quad is stretched along +x and rotated by the heading, because that
    // is the direction a rotating sprite points (CLAUDE.md, rule 7).
    if (b.laser !== undefined && b.length > 0) {
      const half = b.length / 2;
      batch.draw(
        b.x + half * Math.cos(b.angle),
        b.y + half * Math.sin(b.angle),
        b.style.sprite,
        {
          rotation: b.angle,
          width: b.length,
          height: b.style.height ?? b.style.width,
          r: b.style.r,
          g: b.style.g,
          b: b.style.b,
          // Faded while it is still only a telegraph, solid once it can kill.
          // The warmup is already the difference between a readable pattern and
          // a coin flip; showing it costs one multiply.
          a: (b.style.a ?? 1) * (b.lethal ? 1 : 0.45),
        },
      );
      continue;
    }

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

  // Read from the spec, not hardcoded: `OptionSpec` already declares a sprite
  // and a tint per option set, and a shell that picks its own makes those two
  // fields decorative — `seeker` authors a tinted `ring` and was drawn as
  // `standard`'s untinted orb.
  const optionSpec = run.options.spec;
  for (const option of run.options.options) {
    if (!option.active) continue;
    batches.options.draw(option.x, option.y, optionSpec.sprite, {
      // `Option.angle` is DEGREES — its own doc comment says so, and contrasts
      // itself with `Bullet.angle`, which is the radians this attribute wants.
      // Fed across unconverted, an option aiming at 270 was drawn at 349.9.
      rotation: (option.angle * Math.PI) / 180,
      r: optionSpec.tint?.r,
      g: optionSpec.tint?.g,
      b: optionSpec.tint?.b,
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

  // Drawn whether or not a run is live: it is a display setting, and the state
  // has to be readable on the title screen too. It also reads `post.enabled`
  // back rather than tracking the keypress, so a composer that failed to build
  // reports "off" instead of claiming a bloom nobody is drawing.
  surface.fillStyle = post.enabled ? '#8fc8a8' : '#5a5a5a';
  surface.fillText(`bloom  ${post.enabled ? 'on ' : 'off'}  [B]`, x, 200);

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

/**
 * `SpellCard.isSpell` is written by seven phases across three bosses and was
 * read by nothing, so a warm-up movement drew the same card banner and spell
 * timer as a named spell card. The distinction is the genre's basic grammar —
 * a spell card is the thing you capture — and it was invisible.
 */
function drawBossBar(boss: NonNullable<Run['boss']['boss']>): void {
  const w = FIELD_W - 60;
  const spell = boss.phase.isSpell === true;

  surface.fillStyle = '#2a1a1a';
  surface.fillRect(30, 12, w, 4);
  surface.fillStyle = spell ? '#d8607a' : '#8a8a9a';
  surface.fillRect(30, 12, w * boss.phaseHpFraction, 4);

  // The timer runs down beside the health, because surviving it is a clear too.
  // Only a spell card gets one drawn: a non-spell phase has a clock as well,
  // but showing it makes every movement look like a card being captured.
  if (spell) {
    surface.fillStyle = '#2a2a1a';
    surface.fillRect(30, 20, w, 2);
    surface.fillStyle = '#c8b060';
    surface.fillRect(30, 20, w * (1 - boss.phaseTimeFraction), 2);
  }

  surface.fillStyle = spell ? '#d8b0c0' : '#8a8a8a';
  surface.font = '10px monospace';
  surface.fillText(spell ? `✧ ${boss.phase.name}` : boss.phase.name, 30, 36);
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
