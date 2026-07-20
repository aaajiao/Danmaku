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
import { EVENT_SOUNDS } from './game/cues';
import type { Replay } from './sim/replay';
import { FIELD, type Run } from './game/run';
import { Background } from './render/background';
import { bulletAtlas as makeBulletAtlas, createShipAtlas } from './render/procedural';
import { PostProcessing } from './render/post';
import { SpriteBatch } from './render/sprite-batch';
import { Layer, Stage } from './render/stage';

// The sim's field constant, not a local copy: the whole screen is the play
// field now (3:4, HUD composited over it), so the shell and the sim must mean
// the same thing by "the frame" — see the comment on `FIELD` in game/run.ts.
const FIELD_W = FIELD.width;
const FIELD_H = FIELD.height;

const field = document.getElementById('field') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLCanvasElement;
const surface = overlay.getContext('2d')!;

const stage = new Stage({ canvas: field, width: FIELD_W, height: FIELD_H });

/**
 * Fit the fixed 480×640 logical frame to the viewport. Integer scales above
 * 1× keep the pixel art crisp (`image-rendering: pixelated` does the rest);
 * below 1× a fractional fit beats clipping. The sim never learns any of this —
 * scaling is CSS transform only, input is already digital bits (rule 4).
 */
function fitStage(): void {
  const el = document.getElementById('stage')!;
  const raw = Math.min(innerWidth / FIELD_W, innerHeight / FIELD_H);
  const scale = raw >= 1 ? Math.max(1, Math.floor(raw)) : raw;
  el.style.transform = `scale(${scale})`;
}
addEventListener('resize', fitStage);
fitStage();

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

/**
 * Where the bullet sheet comes from — **the one line real art changes.**
 *
 * `undefined` generates the placeholder set. To ship real art, import the PNG
 * and put the URL here:
 *
 * ```ts
 * import BULLETS_URL from './assets/bullets.png';
 * const BULLET_SHEET: string | undefined = BULLETS_URL;
 * ```
 *
 * A bundler-resolved `import`, not `new URL(..., import.meta.url)` — under this
 * dev server that form keeps the source file's `file://` path in the client
 * bundle and 404s. `makeBulletAtlas` checks the sheet's dimensions against the
 * grid and throws naming both, because a wrong-sized sheet otherwise repoints
 * every cell at a crop of the wrong shape and the game simply runs.
 *
 * See `docs/assets.md` §5.
 */
const BULLET_SHEET: string | undefined = undefined;

const bulletAtlas = await makeBulletAtlas(BULLET_SHEET);
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
    // Read from the spec, not hardcoded — the same rule the option draw below
    // already follows. A shell that picks the player's sprite makes
    // `CharacterSpec.sprite` decorative, and leaves a four-ship roster with
    // one silhouette and nowhere to put the others when real art lands.
    const ship = run.character;
    batches.player.draw(player.x, player.y, ship.sprite, {
      width: ship.width ?? 40,
      height: ship.height ?? 40,
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

  drawHud(run);

  // Menus and messages are the states' own business; they describe themselves
  // and this only paints what they describe.
  for (const view of machine.views()) {
    if (view.kind === 'playing') continue;
    drawView(view);
  }
}

/**
 * The whole screen is the play field, so the HUD composites over it — the
 * arcade grammar, not the PC-port sidebar. That makes the HUD part of the
 * negative-space budget, and every choice here follows from that:
 *
 * - **Edges and corners only.** The centre of the field belongs to bullets;
 *   nothing may sit where a curtain's gaps have to stay readable.
 * - **Thin strokes, low luminance.** The reference grammar (PCB's in-field
 *   spell display) dims live statistics to near-invisibility — that is the
 *   standard, not a defect. Nothing here approaches a bullet's 1.0 white.
 * - **The one large glyph lives in a corner** (the spell timer, top-right),
 *   matching where the genre trained players to glance for it.
 *
 * Layout: score/graze top-left under the boss bar's line; lives/bombs
 * top-right; power bottom-left; diagnostics bottom-right, dimmest of all.
 * `test:density` judges readability with this HUD composited, so a change
 * here is a change to that judgement.
 */
function drawHud(run: Run | undefined): void {
  surface.font = '11px monospace';
  surface.textAlign = 'left';

  // Display setting, readable on the title screen too. Reads `post.enabled`
  // back rather than tracking the keypress, so a composer that failed to
  // build reports "off" instead of claiming a bloom nobody is drawing.
  surface.fillStyle = post.enabled ? '#4a6a58' : '#3a3a3a';
  surface.fillText(`bloom ${post.enabled ? 'on' : 'off'} [B]`, 8, FIELD_H - 8);

  if (!run) return;

  const p = run.player;
  const boss = run.boss.boss;
  const bossUp = boss?.alive === true;

  // Top-left: score and graze, pushed below the boss bar when one is up.
  const topY = bossUp ? 50 : 16;
  surface.fillStyle = '#9a9aa4';
  surface.fillText(`score ${p.score}`, 8, topY);
  surface.fillStyle = '#6f6f78';
  surface.fillText(`graze ${p.graze}`, 8, topY + 14);

  // Top-right: the resources a player checks between waves.
  surface.textAlign = 'right';
  surface.fillStyle = '#9a9aa4';
  surface.fillText(`♥ ${p.lives}`, FIELD_W - 8, topY);
  surface.fillStyle = '#6f6f78';
  surface.fillText(`★ ${p.bombs}   P ${p.power.toFixed(2)}`, FIELD_W - 8, topY + 14);

  // Bottom-right: diagnostics, dimmest text on screen.
  surface.fillStyle = '#3a3a3a';
  surface.fillText(
    `${run.tickCount} t  ${run.bullets.count} b  ${stage.stats.calls} dc`,
    FIELD_W - 8,
    FIELD_H - 8,
  );
  surface.textAlign = 'left';

  if (bossUp && boss) drawBossBar(boss);
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
  // Upper third of the 3:4 frame: high enough that a menu never sits where
  // the player's ship idles, low enough not to collide with the boss bar.
  let y = Math.round(FIELD_H * 0.3);

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
