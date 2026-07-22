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
// The built-in campaign is a bundled pack now: stage-1/stage-2, their cast and
// bosses register by injecting `base-pack.json` at import. It must run AFTER
// content (the patterns it names) and the scenes/portraits above, and BEFORE
// loadPacks below so a fetched pack naming a base name still qualifies away from
// it. START keeps resolving 'stage-1'. See packs/bundled.ts.
import './packs/bundled';
import { CONTENT_FINGERPRINT } from './packs/bundled';

import * as THREE from 'three';
import { Audio, defineSound } from './audio';
import { Music, MENU_MUSIC } from './audio/music';
import { Input } from './core/input';
import { Loop } from './core/loop';
import { TitleState, type GameContext } from './game/states';
import { StateMachine } from './game/state';
import { EVENT_SOUNDS } from './game/cues';
import type { Replay } from './sim/replay';
import { FIELD, type Run } from './game/run';
import { loadPacks } from './packs/loader';
import { Background } from './render/background';
import {
  bulletAtlas as makeBulletAtlas,
  shipAtlas as makeShipAtlas,
  effectAtlas as makeEffectAtlas,
  laserAtlas as makeLaserAtlas,
  missileAtlas as makeMissileAtlas,
  pickupAtlas as makePickupAtlas,
} from './render/procedural';
import { getItemSpec, itemNames } from './sim/item';
import { beamLayout } from './render/beam';
import { getLaserSkin, laserSkinNames } from './render/laser-skin';
import { stripFrame } from './render/strip';
import type { Atlas } from './render/atlas';
import { PostProcessing } from './render/post';
import { portraitImage, tintFor } from './render/portrait';
import { SpriteBatch } from './render/sprite-batch';
import { Layer, Stage } from './render/stage';

// The sim's field constant, not a local copy: the whole screen is the play
// field now (3:4, HUD composited over it), so the shell and the sim must mean
// the same thing by "the frame" — see the comment on `FIELD` in game/run.ts.
const FIELD_W = FIELD.width;
const FIELD_H = FIELD.height;

/**
 * Per-channel tint boost added to the boss sprite at the peak of a hit flash.
 * Modest on purpose: the boss sits in the darkest zone of the seal scenes, so
 * this is behaviour made visible, not a light show. Under sustained fire the
 * sim-side counter stays high and the boss holds a steady glow; on a ceasefire
 * it decays to nothing.
 */
const BOSS_HIT_FLASH_BOOST = 0.6;

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
 * Seconds a music change crossfades over. About a second, the same feel as
 * `SCENE_FADE_TICKS`: long enough that a boss theme arrives as the room turning
 * rather than a cut, short enough to have resolved before the fight is dense.
 *
 * In **seconds**, not ticks, and that is the point — music runs on the audio
 * clock, never `uTick` (see `audio/music.ts`'s header on why the two clocks are
 * deliberately different). One constant covers every kind of change — menu to
 * stage, stage to stage, stage to boss — because nothing has wanted them to
 * differ; if one does, it belongs on the track being entered, not here.
 */
const MUSIC_FADE_SECONDS = 1.0;

/**
 * The music bus ceiling, and the ducked ceiling while the game is paused.
 *
 * `MUSIC_LEVEL` sits well under the SFX table (shots at ~0.3 after their own
 * gains) so the theme never competes with a bullet's cue — the readability rule
 * with an audio face. Pausing ducks the theme rather than cutting it: the room
 * is still there, just quieter. The duck is an instant set on the music bus and
 * touches no SFX voice, which is the whole reason music owns a separate context.
 */
const MUSIC_LEVEL = 0.55;
const MUSIC_PAUSE_LEVEL = 0.22;

/**
 * `drift` is the shell's own scene, not any stage's: it is what the title
 * screen sits on, and what a run with no declared background leaves in place.
 * Stages name their own (`expanse`, `undertow`) and the tick loop reconciles.
 */
const background = new Background(stage, 'drift');

/**
 * Discover and validate resource packs before anything reads their assets.
 *
 * Awaited here, at the top of boot: the sheets, sound URLs and hud icons it
 * returns must be in place before the atlases are built and before the audio
 * graph can unlock. Total by construction — no packs, a broken pack, or a
 * server that cannot serve them all degrade to the procedural placeholders and
 * the game runs. See `packs/loader.ts` and `docs/packs.md`.
 */
const packs = await loadPacks();

// Re-register any sounds a pack replaced, BEFORE the first `audio.unlock()` in
// the loop can fire. `Audio.unlock` pre-renders every registered sound's buffer
// (see `audio/index.ts` `#start`), so a url swapped in after that first unlock
// would never be decoded. This runs at module top level, before `loop.start()`,
// which is what guarantees the ordering.
for (const [name, url] of Object.entries(packs.soundUrls)) {
  defineSound(name, { url });
}

/**
 * Where the bullet sheet comes from when no pack supplies one — **the
 * low-level seam real art can also arrive through.**
 *
 * A loaded pack's `assets.bullets` wins over this: `packs.bulletsUrl ?? …`
 * below. This constant stays as the documented direct route — to ship a sheet
 * without authoring a pack, import the PNG and put the URL here:
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

// A native pack sheet arrives as a self-describing strip object (native size,
// native frames, tinted floor cells or baked variants); a legacy pack still
// arrives as a plain URL. The shell picks the branch by which shape the loader
// resolved. Either way the result is ONE `bulletAtlas` and ONE batch per layer:
// bullets stay single-texture / single-batch, so no per-bullet routing enters
// the hot path (amendment §1.5). Native baked pixel art wants nearest sampling,
// which `loadTexture` already gives a loaded sheet (linear stays opt-in below).
const bulletAtlas = await makeBulletAtlas(packs.bulletsUrl ?? BULLET_SHEET, packs.bulletsStrips);
const shipAtlas = await makeShipAtlas(packs.shipUrl, packs.shipStrip);

// The animation-strip fx floor (rule 9): a second texture carrying the bursts
// and the item pulse at their native sizes. Procedural when no pack ships fx;
// when a pack's per-file `assets.effects` strips win, they are composited onto
// this single texture (a reskinned floor name takes its native pixels, the rest
// stay procedural), so `burst`/`burst.big`/`pulse` always resolve. Warn-only:
// the loader already fetched and gated the files.
const fxAtlas = await makeEffectAtlas(undefined, packs.effectStrips);

// The laser sheet: a third texture carrying the beam body + tip-cap strips a
// skin names (`render/laser-skin.ts`). Procedural floor (rule 9) unless a pack
// ships `assets.lasers`, in which case its baked strips composite onto this one
// texture exactly as fx does — a body/cap a pack reskins takes its native pixels,
// the rest stay procedural — without the sim ever learning a beam has a body and
// a cap.
const laserAtlas = await makeLaserAtlas(undefined, packs.laserStrips);

// The missile sheet: a fourth texture carrying the animated missile bodies a
// base spec names (`b.missile` routes here, not by cell name). Procedural floor
// (rule 9) unless a pack ships `assets.missiles`, in which case its baked strips
// composite onto this one texture exactly as fx and lasers do — a body a pack
// reskins takes its native baked pixels, the rest stay procedural — without the
// sim ever learning a missile has a skin. All missiles are enemy this round, so
// one batch on one texture suffices.
const missileAtlas = await makeMissileAtlas(undefined, packs.missileStrips);

// The pickup sheet: a fifth texture carrying the animated coin/gem/bar bodies an
// item's `sprite` names (routed by which atlas owns the name, not by cell name).
// Procedural floor (rule 9) unless a pack ships `assets.pickups`, in which case
// its baked strips composite onto this one texture exactly as fx, lasers and
// missiles do — a coin a pack reskins takes its native baked pixels, the rest
// stay procedural — without the sim ever learning a pickup has a skin.
const pickupAtlas = await makePickupAtlas(undefined, packs.pickupStrips);

// Every registered skin's body and cap must resolve on the laser atlas, or a
// beam that names it draws nothing — throw at boot rather than in the draw loop
// the first frame the beam is fired. This is the "all named strips exist" gate
// the procedural floor is built to satisfy (a pack reskin keeps every floor name).
for (const name of laserSkinNames()) {
  const skin = getLaserSkin(name)!;
  for (const strip of [skin.body, skin.cap]) {
    if (!laserAtlas.has(strip)) {
      throw new Error(`laser skin "${name}" names strip "${strip}", absent from the laser atlas`);
    }
  }
}

// Every registered item's sprite must resolve on EXACTLY ONE of the two atlases
// an item can draw from — the bullet sheet (legacy power/life/bomb cells) or the
// pickup sheet (coins/gems/bar) — or a drop of it renders nothing the first frame
// it spawns. Throw at boot, mirroring the laser-skin gate above, rather than in
// the item draw loop. A sprite on NEITHER is a typo the never-blocked floor cannot
// cover; a sprite on BOTH is ambiguous between two textures. (This round no item
// names a pickup skin yet — every base item resolves on the bullet sheet — so this
// simply proves the wire before the content round hangs coins off it.)
for (const name of itemNames()) {
  const sprite = getItemSpec(name).sprite;
  const onBullet = bulletAtlas.has(sprite);
  const onPickup = pickupAtlas.has(sprite);
  if (onBullet === onPickup) {
    throw new Error(
      `item "${name}" names sprite "${sprite}", which must resolve on exactly one of ` +
        `{bullet atlas, pickup atlas} — ${onBullet ? 'it is on both' : 'it is on neither'}`,
    );
  }
}

// A pack may ask for linear sampling (smooth art); the default `nearest`
// matches `loadTexture`, so only the opt-in needs applying. The placeholder
// generators already choose their own filter, and a pack that supplied no
// sheet leaves them untouched.
if (packs.filter === 'linear') {
  for (const atlas of [bulletAtlas, shipAtlas]) {
    atlas.texture.magFilter = THREE.LinearFilter;
    atlas.texture.minFilter = THREE.LinearFilter;
    atlas.texture.needsUpdate = true;
  }
}

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
  // Missiles ride their own texture (the strips doctrine — one atlas is one
  // batch) at their own layer (Layer.Missiles), a heavier threat over the bullet
  // swarm. Normal blending, not additive: a missile is a solid body, so it reads
  // as an object rather than a glow that could counterfeit a bullet's 1.0-white
  // core. Sparse on field (salvos of a few), so a small capacity suffices; a
  // future player missile adds a faction-keyed second batch (noted, not built).
  missiles: new SpriteBatch(missileAtlas, {
    capacity: 256,
    renderOrder: Layer.Missiles,
  }),
  effects: new SpriteBatch(bulletAtlas, {
    capacity: 4096,
    blending: 'additive',
    renderOrder: Layer.Effects,
  }),
  // The frame-animated bursts live on the fx sheet, so they need their own
  // batch bound to that texture (a batch is one texture — this is the binding,
  // not a preference, and it reuses the whole instanced-draw machinery). Its own
  // layer, just under Effects, so the flash reads behind the sparks.
  bursts: new SpriteBatch(fxAtlas, {
    capacity: 512,
    blending: 'additive',
    renderOrder: Layer.Bursts,
  }),
  // The boss blast's occluding BACK PLATE: the same fx sheet as `bursts` (one
  // texture), a SECOND batch bound to it with NORMAL blending at Layer.BurstsBack,
  // just under Bursts. A batch is one texture and one blend, so a plate that must
  // read as a dark billow *under* the bright additive core needs its own batch —
  // additive can only add light, never occlude. The draw loop routes a particle
  // here by `p.spec.additive === false` (only `boom.boss.back`), not a name set.
  burstsBack: new SpriteBatch(fxAtlas, {
    capacity: 64,
    blending: 'normal',
    renderOrder: Layer.BurstsBack,
  }),
  // The looping pickup glow, also on the fx sheet, at the Items layer.
  itemGlow: new SpriteBatch(fxAtlas, {
    capacity: 512,
    blending: 'additive',
    renderOrder: Layer.Items,
  }),
  // The animated coin/gem/bar bodies ride their own texture (the strips doctrine —
  // one atlas is one batch) at the Items layer, over the additive glow halo.
  // Normal blending, not additive: a coin is a solid object, so it reads as an
  // object rather than a glow that could counterfeit a bullet's 1.0-white core
  // (the missile/beam precedent). Sparse on field (a handful of drops), so a small
  // capacity suffices. An item draws through EITHER this or `items` (routed by
  // which atlas owns its sprite), never both, so the two never overlap.
  pickups: new SpriteBatch(pickupAtlas, {
    capacity: 256,
    renderOrder: Layer.Items,
  }),
  // Beam bodies on the laser sheet: a wide dim additive lane under the ship and
  // bullets (Layer.Beams). Baked colour means no per-instance tint distinguishes
  // factions, so a player beam and an enemy beam share this batch — they differ
  // by skin, not tint.
  beamBodies: new SpriteBatch(laserAtlas, {
    capacity: 1024,
    blending: 'additive',
    renderOrder: Layer.Beams,
  }),
  // Beam tip caps: a small localized impact flash at the Effects tier, above
  // bullets — an indicator, not a field-filling structure, so it does not
  // counterfeit a bullet.
  beamCaps: new SpriteBatch(laserAtlas, {
    capacity: 256,
    blending: 'additive',
    renderOrder: Layer.Effects,
  }),
};

stage.add(batches.enemies.mesh, 'Enemies');
stage.add(batches.itemGlow.mesh, 'Items');
stage.add(batches.items.mesh, 'Items', 1);
stage.add(batches.pickups.mesh, 'Items', 1);
stage.add(batches.beamBodies.mesh, 'Beams');
stage.add(batches.player.mesh, 'Player');
stage.add(batches.options.mesh, 'Player', 1);
stage.add(batches.playerShots.mesh, 'PlayerShots');
stage.add(batches.enemyShots.mesh, 'EnemyShots');
stage.add(batches.missiles.mesh, 'Missiles');
stage.add(batches.burstsBack.mesh, 'BurstsBack');
stage.add(batches.bursts.mesh, 'Bursts');
stage.add(batches.effects.mesh, 'Effects');
// Caps at the Effects tier but one step above the small-particle effects batch,
// so the tip flash reads over both bullets and sparks (a deterministic order,
// not a reliance on equal-renderOrder tie-breaking).
stage.add(batches.beamCaps.mesh, 'Effects', 1);

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
// Music owns its own context (see `audio/music.ts`) so the shell can duck the
// theme on pause without touching a single SFX voice. It unlocks off the same
// user gesture as `audio`, below.
const music = new Music({ masterVolume: MUSIC_LEVEL });
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
// The loaded pack identity travels on the context so `PlayingState` can forward
// it into `RunConfig.packs`, which records it into replay meta — read there the
// same way `ctx.boss` is.
//
// `campaigns` are the content packs' entry stages, one title-menu row each. They
// reach the game as plain data: `src/game` may not import `src/packs`, so the
// loader hands over flat `{ label, stage, packsData }` records and `TitleState`
// arms `ctx.stage`/`ctx.packsData` from the chosen row. The list is only
// populated because module-eval order guarantees the wire: `import './content'`
// (built-ins register) runs before this file's top-level `await loadPacks()`
// (which injects each pack's content into those same registries), which runs
// before the state machine below is constructed — so every campaign a row can
// select names a stage that already exists by the time a player reaches it.
const context: GameContext = {
  machine,
  nextSeed: () => Date.now() & 0xffffffff,
  packs: packs.packsMeta || undefined,
  // The bundled base content's fingerprint, forwarded into every run's
  // `RunConfig.contentFingerprint` and recorded into replay meta — so a replay
  // made on this build is caught when replayed against drifted base content.
  contentFingerprint: CONTENT_FINGERPRINT,
  campaigns: packs.campaigns,
  // The pack characters this build registered, each with its owning pack's
  // identity — the character path's mirror of `campaigns`. `CharacterSelectState`
  // arms strict `packsData` from it when a pack ship is flown off the plain START
  // row, where no campaign armed it. Same plain-data crossing as `campaigns`.
  characterPacks: packs.characterPacks,
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
 * Shell-side UI cues (`SHELL_CUES`), none of them a run event.
 *
 * `wasPaused` gives the pause its rising edge — `ui-pause` plays the tick the
 * pause menu appears, not every tick it is up. `dialogueIndex` remembers the
 * line each run was last showing, so a fresh advance (`run.dialogue.index` ticks
 * up) plays `ui-advance` — a getter read on declared state, no `RunEventType`,
 * no trace touched. A `WeakMap` so a finished run is collected with its entry.
 */
let wasPaused = false;
const dialogueIndex = new WeakMap<Run, number>();

const loop = new Loop({
  tick() {
    const buttons = input.sample();

    if (!unlocked && buttons !== 0) {
      unlocked = true;
      void audio.unlock();
      void music.unlock();
    }

    // The state about to tick, captured before the tick applies its transitions:
    // a menu confirm/cancel replaces this state, but its `.cue` field is set on
    // the object during the tick and survives the transition, so reading it here
    // is what catches those actions (the field is cleared at the top of a menu's
    // own next tick, so it never lingers past the frame it was set).
    const acted = machine.stack[machine.stack.length - 1] as { cue?: string } | undefined;

    machine.tick(buttons);
    background.step();

    // Play the menu cue the ticked state named, if any (`ui-move`/`ui-confirm`/
    // `ui-cancel`). Resolved here, in the shell, because `src/game` names sounds
    // as strings and never imports the audio engine — the `.music`/scene idiom.
    if (acted?.cue !== undefined) audio.play(acted.cue);

    let scene: string | undefined;
    let track: string | undefined;
    let topRun: Run | undefined;

    for (const state of machine.stack) {
      // A state may declare a music track directly, with no `Run` behind it — the
      // ending screen does, because once the boss is dead `run.music` has fallen
      // back to the stage theme and can no longer name the ending track. Read
      // bottom-up so the topmost declaration wins, the same precedence `run.music`
      // uses, and so the ending screen on top overrides the finished run beneath.
      const override = (state as { music?: string }).music;
      if (override !== undefined) track = override;

      // The scene's twin of the music read above — a state may declare a scene
      // directly, with no `Run` behind it: game-over and the ending screen do, so
      // the run's END gets its own field (`signal-decay`) even though the finished
      // run's `run.scene` has fallen back to the stage or boss field it ended on.
      // Read bottom-up so the topmost declaration wins, the exact precedence music
      // uses just above and `run.scene` uses just below.
      const sceneOverride = (state as { scene?: string }).scene;
      if (sceneOverride !== undefined) scene = sceneOverride;

      const run = (state as { run?: Run }).run;
      if (!run) continue;

      // Bottom-up, so the topmost run wins — the same precedence the render
      // callback uses to pick whose HUD to draw.
      scene = run.scene ?? scene;
      track = run.music ?? track;
      topRun = run;

      for (const event of run.drainEvents()) {
        const sound = EVENT_SOUNDS[event.type];
        if (sound) audio.play(sound);
      }
    }

    // Dialogue advance is shell-side edge detection, not a run event: a fresh
    // Shot press ticks `run.dialogue.index` up, and that increment plays
    // `ui-advance`. Read off declared state (`run.dialogue`), so no `RunEventType`
    // is introduced and no replay trace moves. A line landing (index 0 → the
    // exchange appearing) also counts as an advance into the first line.
    if (topRun !== undefined) {
      const line = topRun.dialogue?.index;
      const last = dialogueIndex.get(topRun);
      if (line !== undefined && (last === undefined || line > last)) {
        if (last !== undefined) audio.play('ui-advance');
        dialogueIndex.set(topRun, line);
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

    // The same reconcile for music. A title screen (no run) wants the menu
    // theme, so the fallback is `MENU_MUSIC` rather than "leave it": `Music.play`
    // is idempotent and no-ops when it already matches `music.current`, so this
    // only ever switches on a real change. Before unlock `current` stays
    // undefined, which is exactly what makes the theme start on the first tick
    // after the gesture with no special case.
    // On a failed run the shell CUTS the theme to silence — the void the player
    // wrote — rather than falling back to the stage track the finished run
    // beneath it still reports (`run.music` resolves to `#stageMusic` once the
    // boss is dead, and a failed run never returns undefined). The `death` sound
    // punctuates the cut. `GameOverState` is always the stack top while it is up
    // (its confirm pops or clears the stack, never pushes over itself), so its
    // name is the signal — read the same way the pause duck below reads the top.
    // The `current !== undefined` guard makes the cut a one-shot; a RETRY pops
    // the card and the reconcile resumes on the next tick with no special case.
    const gameOver = machine.stack[machine.stack.length - 1]?.name === 'game-over';
    if (gameOver) {
      if (music.current !== undefined) music.stopAll();
    } else {
      const wanted = track ?? MENU_MUSIC;
      if (wanted !== music.current) music.play(wanted, MUSIC_FADE_SECONDS);
    }

    // Duck the theme while paused rather than cutting it — the room stays, just
    // quieter. Pause is a non-transparent state on top of a run (`states.ts`);
    // the shell reads it off the stack the same way it folds `run.music` above,
    // since no `Run` exposes "am I paused" (the pause lives one level up).
    const paused = machine.stack[machine.stack.length - 1]?.name === 'pause';
    music.masterVolume = paused ? MUSIC_PAUSE_LEVEL : MUSIC_LEVEL;

    // `ui-pause` on the rising edge only — the tick the pause menu appears, not
    // every tick it is up. A pure shell reconcile off the stack-top name, the
    // same signal the duck above reads; no run event, no trace touched.
    if (paused && !wasPaused) audio.play('ui-pause');
    wasPaused = paused;
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

/**
 * The Law of Animation + Law of Geometry helper (asset-fidelity round). One call
 * resolves BOTH: the frame off the entity's run-relative `.age`
 * (`stripFrame` — never `loop.count` or a wall clock, the strips clock law) AND
 * the quad size off the strip's `displayW/H` (native `frameW/H` when a seam set
 * no display size — this stage, always — so it is byte-identical). `scale`
 * multiplies the resolved size (an effect's `p.scale`); `width`/`height` override
 * it outright (an enemy whose size is its spec, the cell only its skin).
 *
 * Every entity draw site routes through this — enemy, boss, bullet-atlas item,
 * pickups, bullets, missiles, effects, and the laser cap via its own feed site.
 * Bare-name draw stays legal only for surfaces with no run-relative age to clock
 * from: the latent options and 1-frame player ship, and the length-driven legacy
 * beam-body fallback (Law of Geometry excludes laser bodies). `strip.test.ts`
 * asserts no other entity surface draws by bare name.
 *
 * Law of Geometry is dormant until the importer emits `contentW/contentH`: with no
 * display size a strip draws at native `frameW/H`, so routing is byte-identical for
 * zero-pack (every cell is 1-frame → frame 0) and animation-only for a loaded
 * multi-frame pack. When a pack carries `contentW`, each seam fills `displayW/H`
 * and this same call resizes with no further change here.
 */
function drawStrip(
  batch: SpriteBatch,
  atlas: Atlas,
  x: number,
  y: number,
  name: string,
  age: number,
  style: {
    width?: number;
    height?: number;
    scale?: number;
    rotation?: number;
    r?: number;
    g?: number;
    b?: number;
    a?: number;
  } = {},
): void {
  const s = atlas.strip(name);
  const region = atlas.frameOf(s, stripFrame(s, age)); // Law of Animation: frame off .age
  const scale = style.scale ?? 1;
  const w = (style.width ?? s.displayW ?? s.frameW) * scale; // Law of Geometry: engine display size
  const h = (style.height ?? s.displayH ?? s.frameH) * scale;
  batch.draw(x, y, region, {
    rotation: style.rotation,
    width: w,
    height: h,
    r: style.r,
    g: style.g,
    b: style.b,
    a: style.a,
  });
}

function drawRun(run: Run): void {
  for (const e of run.enemies.enemies) {
    // Law of Animation: the frame resolves off `e.age` (enemy.ts sets it, 0 at
    // spawn, tick-advanced) so a multi-frame enemy strip (clerk/hunter/ray) cycles
    // instead of freezing on frame 0 — the primary bug the user reported. Size
    // stays SPEC-driven: `spec.width/height` override any `displayW`, because an
    // enemy's size is its spec and the cell is only its skin.
    drawStrip(batches.enemies, bulletAtlas, e.x, e.y, e.spec.sprite, e.age, {
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
    // Hit flash: presentation reading sim data (`hitFlashFraction`, the
    // `phaseHpFraction` pattern). The tint multiplies the texel in the shader,
    // so an already-white boss cannot brighten by lerping *toward* white —
    // instead add a flat boost to every channel, which both lifts mid-tone
    // texels (bloom then makes the pop visible) and desaturates a coloured boss
    // toward white. Kept modest: the boss sits in the darkest zone of the seal.
    const boost = boss.hitFlashFraction * BOSS_HIT_FLASH_BOOST;
    // Same routing as an enemy, clocked off `boss.age`: a 1-frame boss cell (all
    // five base bosses today) draws frame 0, a future multi-frame boss cell cycles.
    // Size stays spec-driven; the hit-flash boost rides the tint as before.
    drawStrip(batches.enemies, bulletAtlas, boss.x, boss.y, boss.spec.sprite, boss.age, {
      rotation: boss.angle,
      width: boss.spec.width,
      height: boss.spec.height,
      r: (boss.spec.tint?.r ?? 1) + boost,
      g: (boss.spec.tint?.g ?? 1) + boost,
      b: (boss.spec.tint?.b ?? 1) + boost,
    });
  }

  for (const item of run.items.items) {
    // A looping glow behind every pickup — the run-relative-loop proof consumer.
    // `pulse` is a `mode: 'loop'` strip on the fx sheet, and its frame is clocked
    // off `item.age` (run-relative, starts at 0 at spawn, reproduced by a replay)
    // — NEVER `loop.count`, whose program-global phase would desync the loop
    // across replays watched at different session offsets (the grafted clock law).
    const glow = fxAtlas.strip('pulse');
    const glowFrame = fxAtlas.frameOf(glow, stripFrame(glow, item.age));
    batches.itemGlow.draw(item.x, item.y, glowFrame, {
      width: glow.frameW,
      height: glow.frameH,
      r: item.spec.tint?.r,
      g: item.spec.tint?.g,
      b: item.spec.tint?.b,
      a: 0.5,
    });

    // Route by which atlas owns the sprite (the "shell knows both halves" pattern,
    // exactly as the fx-particle draw below does with `fxAtlas.has`): a coin/gem/bar
    // skin lives on the pickup sheet and draws through the pickup batch, spinning on
    // its own strip clocked off `item.age` (run-relative, tick-only, reproduced by a
    // replay — NEVER `loop.count`). Every legacy item (`power`/`life`/`bomb`/`score`)
    // stays on the bullet atlas and the items batch, byte-identical to before.
    if (pickupAtlas.has(item.spec.sprite)) {
      // Baked art carries its own colour (tint stays identity-white so it shows
      // unmultiplied); a tinted floor strip takes the content tint, so a coin is
      // coloured by its denomination until baked pixels load (the strips colour law
      // the missile/beam draws obey). The glow halo above always carries the tint.
      // `drawStrip` resolves the frame off `item.age` (Law of Animation, already so
      // for the spinning pickup) and the size off `displayW` (Law of Geometry).
      const baked = pickupAtlas.strip(item.spec.sprite).color === 'baked';
      drawStrip(batches.pickups, pickupAtlas, item.x, item.y, item.spec.sprite, item.age, {
        r: baked ? undefined : item.spec.tint?.r,
        g: baked ? undefined : item.spec.tint?.g,
        b: baked ? undefined : item.spec.tint?.b,
      });
    } else {
      // The bullet-atlas item branch (`power`/`life`/`bomb`/`score`/`big-power`).
      // Routed off `item.age` so a multi-frame item skin cycles — this is what
      // unfreezes `big-power`→`star` (7 frames), reported static.
      drawStrip(batches.items, bulletAtlas, item.x, item.y, item.spec.sprite, item.age, {
        rotation: item.angle,
        r: item.spec.tint?.r,
        g: item.spec.tint?.g,
        b: item.spec.tint?.b,
      });
    }
  }

  for (const b of run.bullets.bullets) {
    const batch = b.faction === 'player' ? batches.playerShots : batches.enemyShots;

    // A beam is a line, and its stored position is the **muzzle** — one end,
    // not the middle. It draws as a two-element composite: a body strip stretched
    // or tiled from the muzzle to the tip, and a cap flash at the tip while it can
    // kill. The anatomy lives behind a skin name resolved here (the sim named a
    // string, `render/laser-skin.ts`); a beam whose sprite names no skin falls
    // back to the legacy stretched quad below, byte-identical to before.
    if (b.laser !== undefined && b.length > 0) {
      const skin = getLaserSkin(b.style.sprite);
      if (skin !== undefined) {
        const bodyStrip = laserAtlas.strip(skin.body);
        const capStrip = laserAtlas.strip(skin.cap);
        // Frame clock is `b.age` — run-relative, tick-only, reproduced by a replay
        // (the strips clock law; `strip.test.ts` asserts every shell stripFrame
        // call reads a `.age`). Never `loop.count`, never a wall clock.
        const bodyUV = laserAtlas.uv(laserAtlas.frameOf(bodyStrip, stripFrame(bodyStrip, b.age)));
        const capUV = laserAtlas.uv(laserAtlas.frameOf(capStrip, stripFrame(capStrip, b.age)));
        const layout = beamLayout({
          muzzleX: b.x,
          muzzleY: b.y,
          angle: b.angle,
          length: b.length,
          fit: skin.fit,
          thickness: skin.thickness,
          // Default the tile length to the body strip's own frame width, so the
          // procedural floor and a native reskin each tile at their native cell.
          tileLength: skin.tileLength ?? bodyStrip.frameW,
          bodyUV,
          // Law of Geometry, cap only: the cap adopts its display size (its
          // per-frame union → engine cap size) when the pack carries `contentW`,
          // native `frameW/H` otherwise. The BODY is excluded — its cross-axis is
          // `skin.thickness` and its length the sim's, so native pixels never reach
          // the quad (the one surface that already obeyed the invariant).
          cap: {
            uv: capUV,
            width: capStrip.displayW ?? capStrip.frameW,
            height: capStrip.displayH ?? capStrip.frameH,
          },
          age: b.age,
          warmup: b.laser.warmup ?? 0,
          life: b.life,
          cooldown: b.laser.cooldown ?? 0,
          baseAlpha: b.style.a ?? 1,
        });
        // Baked art carries its own colour (tint stays white so it shows
        // unmultiplied); the tinted procedural floor takes the content tint, so a
        // beam is coloured by its spec until real pixels load (the strips colour
        // law) — the shell is the only place that knows both halves.
        const bodyBaked = bodyStrip.color === 'baked';
        for (const q of layout.body) {
          batches.beamBodies.draw(q.x, q.y, q.uv, {
            rotation: q.rotation,
            width: q.width,
            height: q.height,
            r: bodyBaked ? 1 : b.style.r,
            g: bodyBaked ? 1 : b.style.g,
            b: bodyBaked ? 1 : b.style.b,
            a: q.alpha,
          });
        }
        if (layout.cap !== undefined) {
          const capBaked = capStrip.color === 'baked';
          const q = layout.cap;
          batches.beamCaps.draw(q.x, q.y, q.uv, {
            rotation: q.rotation,
            width: q.width,
            height: q.height,
            r: capBaked ? 1 : b.style.r,
            g: capBaked ? 1 : b.style.g,
            b: capBaked ? 1 : b.style.b,
            a: q.alpha,
          });
        }
        continue;
      }

      // Legacy fallback: the stretched quad, centred on the beam's midpoint (its
      // stored x/y is the muzzle, one end) and stretched +x, rotated by the
      // heading (rule 7). Faded while it is only a telegraph, solid once lethal.
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
          a: (b.style.a ?? 1) * (b.lethal ? 1 : 0.45),
        },
      );
      continue;
    }

    // A missile draws from its OWN atlas into its OWN batch/layer — routed by the
    // sim field `b.missile` (the render layer cannot be imported by the sim, so
    // the sim marks the missile as a string-named skin and the shell resolves it,
    // the import boundary). It falls through the laser branches above because a
    // missile sets `blade`, never `laser`. An ordinary bullet stays on the bullet
    // atlas and its faction batch, byte-identical to before.
    const onMissile = b.missile !== undefined;
    const spriteAtlas = onMissile ? missileAtlas : bulletAtlas;
    const drawBatch = onMissile ? batches.missiles : batch;
    // A baked missile body carries its own colour, so the tint stays white and it
    // shows unmultiplied; the tinted procedural floor takes the content tint, so a
    // missile is warm-coded by its spec until real pixels load (the strips colour
    // law the laser branch above obeys, applied here to the missile surface only —
    // the bullet atlas keeps its established behaviour, its baked variants being
    // fired tint-free). Routed through `drawStrip` off `b.age`: the frame animates
    // (Law of Animation) and the size is `b.style.width ?? displayW ?? frameW` (Law
    // of Geometry — an explicit spec width still wins; `displayW` is dormant until
    // the pack carries `contentW`). For the base game every bullet strip is
    // `frames: 1` at 32px, so this stays byte-identical to before.
    const bodyBaked = onMissile && spriteAtlas.strip(b.style.sprite).color === 'baked';
    drawStrip(drawBatch, spriteAtlas, b.x, b.y, b.style.sprite, b.age, {
      rotation: b.angle,
      width: b.style.width,
      height: b.style.height,
      r: bodyBaked ? 1 : b.style.r,
      g: bodyBaked ? 1 : b.style.g,
      b: bodyBaked ? 1 : b.style.b,
      a: b.style.a,
    });
  }

  for (const p of run.effects.particles) {
    // Route by which atlas owns the sprite (the "shell knows both halves"
    // pattern): a burst strip lives on the fx sheet and draws through the fx
    // batch; every existing small particle stays on the bullet atlas and the
    // effects batch, byte-identical (its `frameW === 32`, so the size below is
    // the old `32 * p.scale`). The frame is selected off `p.age` — a
    // run-relative, tick-only clock the replay reproduces (rule 1's analogue),
    // never a wall clock or the interpolation alpha.
    const onFx = fxAtlas.has(p.spec.sprite);
    const atlas = onFx ? fxAtlas : bulletAtlas;
    // Route by which atlas owns the sprite, then — on the fx sheet — by blend: a
    // non-additive fx (only the boss blast's `boom.boss.back` plate) draws through
    // the normal-blend `burstsBack` batch UNDER the additive core; every other fx
    // stays additive. The split is read from the spec, not a hardcoded name set.
    const batch = onFx
      ? p.spec.additive === false
        ? batches.burstsBack
        : batches.bursts
      : batches.effects;
    // Routed through `drawStrip` off `p.age`: the frame animates (already so — a
    // squared burst) and `scale: p.scale` multiplies the resolved size, which is
    // `displayW ?? frameW` (Law of Geometry, dormant until `contentW`). With no
    // display size this is the old `frameW * p.scale`, byte-identical.
    drawStrip(batch, atlas, p.x, p.y, p.spec.sprite, p.age, {
      rotation: p.angle,
      scale: p.scale,
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
    // LATENT — bare name, NOT routed through `drawStrip`: `Option` carries no
    // run-relative `.age`, so there is no honest clock to resolve a frame from.
    // Animating an option strip first needs an age counter on `Option` (a sim
    // change, out of scope this round); base options name only 1-frame cells, so
    // frame 0 is correct today. `strip.test.ts` exempts this pair by name.
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
    // LATENT — bare name: the ship is a 1-frame procedural silhouette today, so
    // frame 0 is correct. If a multi-frame ship strip ever ships (the `shipAtlas`
    // native branch already anticipates one), route this through
    // `drawStrip(batches.player, shipAtlas, …, player.age, …)`; there is nothing to
    // animate until then. `strip.test.ts` exempts this pair by name.
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

  // A pre-boss exchange is drawn over the field the player is still flying. It
  // sits above the HUD and below any menu (a pause taken mid-exchange composites
  // over it). `run.dialogue` is read as declared state, exactly like `scene`.
  if (run) {
    const line = run.dialogue;
    if (line) drawDialogue(line, run.tickCount);
  }

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
  // ∞ rather than a count when the assist is on: the life stock never falls, so
  // a number would read as a fixed 3 and hide that deaths cost nothing here.
  const lives = run.config.infiniteLives === true ? '∞' : `${p.lives}`;
  hudResource(packs.hudIcons.life, '♥', lives, FIELD_W - 8, topY);
  surface.fillStyle = '#6f6f78';
  hudResource(packs.hudIcons.bomb, '★', `${p.bombs}   P ${p.power.toFixed(2)}`, FIELD_W - 8, topY + 14);

  // The tier, one row under the resources: set once at the SELECT screen and
  // never changing, so it sits at the very bottom of the visual hierarchy in the
  // screen's dimmest grey. Rendered on every tier, Normal included — a constant
  // fixture reads cleaner than a readout that blinks in only on the tiers a
  // player deliberately picked. (`#3a3a3a` is the dimmest text the HUD uses; the
  // decisions doc's "dimmest style" is read literally rather than as "one step
  // down within this cluster", which would be `#6f6f78`.)
  surface.fillStyle = '#3a3a3a';
  surface.fillText(run.difficulty.toUpperCase(), FIELD_W - 8, topY + 28);

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
/**
 * A right-aligned HUD resource: an icon-and-number when a pack supplied the
 * icon, the ♥/★ glyph otherwise.
 *
 * The pack supplies the **shape** only — position, size and alpha stay
 * engine-owned, the same structural split as white-bullets-with-engine-tint. So
 * a loaded icon is drawn at a fixed small size and low alpha to the left of the
 * number, exactly where the glyph would have sat, and never gets to move the
 * HUD around. The glyph remains the fallback, so a pack that ships no hud art
 * changes nothing here.
 */
const HUD_ICON = 10;
const HUD_ICON_GAP = 3;
const HUD_ICON_ALPHA = 0.85;

function hudResource(
  icon: HTMLImageElement | undefined,
  glyph: string,
  text: string,
  rightX: number,
  baselineY: number,
): void {
  if (icon === undefined) {
    surface.fillText(`${glyph} ${text}`, rightX, baselineY);
    return;
  }
  surface.fillText(text, rightX, baselineY);
  const iconX = rightX - surface.measureText(text).width - HUD_ICON - HUD_ICON_GAP;
  surface.save();
  surface.globalAlpha = HUD_ICON_ALPHA;
  surface.drawImage(icon, iconX, baselineY - HUD_ICON, HUD_ICON, HUD_ICON);
  surface.restore();
}

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

function drawView(view: {
  kind: string;
  title?: string;
  lines?: readonly string[];
  menu?: readonly string[];
  selected?: number;
  tally?: readonly { readonly sprite: string; readonly count: number }[];
}): void {
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

  if (view.tally && view.tally.length > 0) {
    y += 4;
    drawCoinTally(view.tally, cx, y);
    y += 24;
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

/**
 * The results-card coin tally (战役扩容轮) — a gold and a silver coin with the
 * run's counts beside them, centred as one group under the score lines. The state
 * hands a `{ sprite, count }[]` across the boundary (`states.ts` never learns the
 * coins are drawn); the SHELL owns presentation, so it maps each sprite name to a
 * coin colour here.
 *
 * The coin is drawn as a lit disc glyph on the 2D overlay — the honest home for
 * the shadowed coin twins the field bars (a lit UI surface where an implied light
 * makes a coin's sheen correct). The `pickup.tally.coin.*` names still resolve on
 * the pickup atlas (the never-blocked floor), so a BulletPack can bake real coin
 * art there and `test:assets` proves those pixels; the glyph is the zero-pack
 * floor for this card until a draw path blits the atlas cell.
 */
const TALLY_COIN_R = 6;
function tallyCoinColor(sprite: string): string {
  return sprite.includes('gold') ? '#e6c24a' : '#c6ccd6';
}

function drawCoinTally(
  tally: readonly { readonly sprite: string; readonly count: number }[],
  cx: number,
  baselineY: number,
): void {
  surface.font = '12px monospace';
  surface.textAlign = 'left';
  const iconW = TALLY_COIN_R * 2 + 5;
  const gap = 18;
  const labels = tally.map((t) => `${t.count}`);
  const widths = tally.map((_, i) => iconW + surface.measureText(labels[i] ?? '').width);
  const total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, tally.length - 1);

  let x = cx - total / 2;
  tally.forEach((entry, i) => {
    surface.fillStyle = tallyCoinColor(entry.sprite);
    surface.beginPath();
    surface.arc(x + TALLY_COIN_R, baselineY - 4, TALLY_COIN_R, 0, Math.PI * 2);
    surface.fill();
    surface.fillStyle = '#8a8a8a';
    surface.fillText(labels[i] ?? '', x + iconW, baselineY);
    x += (widths[i] ?? 0) + gap;
  });

  surface.textAlign = 'center';
}

/**
 * The pre-boss exchange box. Same negative-space grammar as the HUD (thin, dark,
 * edges, dimmest text for the diagnostics-tier readouts), kept low on the frame
 * so it never sits where a curtain would — the bullets are cleared during an
 * exchange, but the player is still flying and the field must stay legible.
 *
 * Only the current line's speaker is shown, so the speaking side is always the
 * portrait side: it takes the highlight (a tinted rim, a tinted name plate)
 * while everything else stays in the dim register.
 *
 * `tickCount` drives the advance marker's blink — a tick counter, never a wall
 * clock, so the hint pulses identically on replay as it did live.
 */
const DIALOG_MARGIN = 12;
const DIALOG_H = 118;
const DIALOG_PAD = 11;
const DIALOG_PORTRAIT = 88;

function drawDialogue(
  line: { speaker: string; text: string; index: number; count: number },
  tickCount: number,
): void {
  const boxX = DIALOG_MARGIN;
  const boxY = FIELD_H - DIALOG_MARGIN - DIALOG_H;
  const boxW = FIELD_W - 2 * DIALOG_MARGIN;
  const tint = tintFor(line.speaker);

  // Panel: a dark fill and a thin edge, nothing that reaches a bullet's white.
  surface.fillStyle = 'rgba(10,10,14,0.74)';
  surface.fillRect(boxX, boxY, boxW, DIALOG_H);
  surface.strokeStyle = '#2a2a32';
  surface.lineWidth = 1;
  surface.strokeRect(boxX + 0.5, boxY + 0.5, boxW - 1, DIALOG_H - 1);

  // Portrait on the left, drawn from its fixed square down to the box height.
  const pX = boxX + DIALOG_PAD;
  const pY = boxY + (DIALOG_H - DIALOG_PORTRAIT) / 2;
  surface.drawImage(portraitImage(line.speaker), pX, pY, DIALOG_PORTRAIT, DIALOG_PORTRAIT);
  // Speaking-side highlight: the portrait's rim in its own tint.
  surface.strokeStyle = `rgba(${Math.round(tint.r * 200)},${Math.round(tint.g * 200)},${Math.round(tint.b * 210)},0.75)`;
  surface.strokeRect(pX + 0.5, pY + 0.5, DIALOG_PORTRAIT - 1, DIALOG_PORTRAIT - 1);

  const textX = pX + DIALOG_PORTRAIT + DIALOG_PAD;
  const textW = boxX + boxW - DIALOG_PAD - textX;
  surface.textAlign = 'left';

  // Name plate: tinted and bright, the speaking side's cue.
  surface.font = '12px monospace';
  surface.fillStyle = `rgb(${Math.round(tint.r * 220)},${Math.round(tint.g * 220)},${Math.round(tint.b * 230)})`;
  surface.fillText(line.speaker.toUpperCase(), textX, boxY + DIALOG_PAD + 12);

  // Body: wrapped to the panel width, HUD-primary luminance.
  surface.font = '12px monospace';
  surface.fillStyle = '#9a9aa4';
  let lineY = boxY + DIALOG_PAD + 34;
  for (const row of wrapText(line.text, textW)) {
    surface.fillText(row, textX, lineY);
    lineY += 16;
  }

  // Line counter: dimmest register, low-right, like the HUD diagnostics.
  surface.fillStyle = '#3a3a3a';
  surface.textAlign = 'right';
  surface.fillText(`${line.index + 1} / ${line.count}`, boxX + boxW - DIALOG_PAD, boxY + DIALOG_H - DIALOG_PAD);

  // Advance hint: the genre's small blinking marker, pulsed on the tick clock so
  // it is identical on replay. Shown for two-thirds of each second.
  if (Math.floor(tickCount / 20) % 3 !== 2) {
    surface.fillText('▸ shot', boxX + boxW - DIALOG_PAD, boxY + DIALOG_PAD + 8);
  }
  surface.textAlign = 'left';
}

/**
 * Greedy word-wrap against the current font, so a long line stays in the box.
 * A lone token wider than the column breaks at the character level: built-in
 * lines never need it, but pack dialogue is any string an author types, and an
 * unbroken token must not escape the panel.
 */
function wrapText(text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const rows: string[] = [];
  let row = '';
  for (const word of words) {
    const candidate = row === '' ? word : `${row} ${word}`;
    if (row !== '' && surface.measureText(candidate).width > maxWidth) {
      rows.push(row);
      row = word;
    } else {
      row = candidate;
    }
    while (row.length > 1 && surface.measureText(row).width > maxWidth) {
      let cut = 1;
      while (cut < row.length && surface.measureText(row.slice(0, cut + 1)).width <= maxWidth) {
        cut++;
      }
      rows.push(row.slice(0, cut));
      row = row.slice(cut);
    }
  }
  if (row !== '') rows.push(row);
  return rows;
}

loop.start();
