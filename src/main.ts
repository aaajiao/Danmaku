/**
 * The browser shell: input in, pixels out, and nothing else.
 *
 * All game logic lives under `src/game/`, which imports no three.js. That split
 * is not tidiness — it is what lets a whole run be simulated and replayed
 * headlessly, which is the only way the determinism contract can be checked at
 * all. Anything added here that decides something belongs in `Run` instead.
 */

// The compiled v4 edition installs its deterministic patterns and behaviours,
// byte-pinned shaders, and four-stage campaign in dependency order. Arbitrary
// asset packs remain data-only and load afterward.
import { CONTENT_FINGERPRINT } from './v4';

import * as THREE from 'three';
import { Audio, defineSound } from './audio';
import { Music, MENU_MUSIC } from './audio/music';
import { Input } from './core/input';
import { Loop } from './core/loop';
import { TitleState, type GameContext } from './game/states';
import { StateMachine } from './game/state';
import { EVENT_SOUNDS } from './game/cues';
import type { Replay } from './sim/replay';
import { FIELD, getCharacter, type Run } from './game/run';
import { loadPacks } from './packs/loader';
import { Background } from './render/background';
import {
  ACTOR_PAD_CELL,
  ACTOR_PAD_RENDER_ORDER,
  actorPadLayout,
  createActorPadAtlas,
  type ActorPadRole,
} from './render/actor-pad';
import {
  bulletAtlas as makeBulletAtlas,
  shipAtlas as makeShipAtlas,
  effectAtlas as makeEffectAtlas,
  laserAtlas as makeLaserAtlas,
  laserBodyDisplayThickness,
  missileAtlas as makeMissileAtlas,
  pickupAtlas as makePickupAtlas,
} from './render/procedural';
import { getItemSpec, itemNames } from './sim/item';
import { beamLayout } from './render/beam';
import { bladeDisplaySize } from './render/bullet-geometry';
import { getLaserSkin, laserSkinNames } from './render/laser-skin';
import { stripFrame } from './render/strip';
import type { Atlas } from './render/atlas';
import { PostProcessing } from './render/post';
import { focusIndicatorLayout } from './render/focus-indicator';
import { bossFeedbackLayout } from './render/boss-feedback';
import {
  stepBossIdentityFx,
  visibleBossIdentityFx,
  type BossIdentityFx,
} from './render/boss-identity-fx';
import { portraitImage, tintFor } from './render/portrait';
import { SpriteBatch } from './render/sprite-batch';
import { Layer, Stage } from './render/stage';
import {
  V4_BOSS_ACTORS,
  V4_ENEMY_ACTORS,
  V4_PLAYER_ACTORS,
  loadV4ActorAtlases,
  v4BossPoseFrame,
  v4EnemyPoseFrame,
  v4PlayerBankFrame,
} from './render/v4-actors';
import { v4PortraitSource, v4PortraitSpec } from './render/v4-portrait';
import { V4StageStructure } from './v4/backgrounds/structure';
import {
  V4_CHARACTER_UI,
  V4_DIFFICULTY_UI,
  V4_UI_CELLS,
  V4_UI_SCREEN,
  drawV4Ui,
  loadV4UiAtlas,
  type V4UiCellName,
} from './render/v4-ui';

// The sim's field constant, not a local copy: the whole screen is the play
// field now (3:4, HUD composited over it), so the shell and the sim must mean
// the same thing by "the frame" — see the comment on `FIELD` in game/run.ts.
const FIELD_W = FIELD.width;
const FIELD_H = FIELD.height;

const field = document.getElementById('field') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLCanvasElement;
const surface = overlay.getContext('2d')!;
/** Production keeps diagnostics and the Bloom control out of the authored UI. */
const DEBUG_UI = new URLSearchParams(location.search).get('debug') === '1';

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
const stageStructure = new V4StageStructure(stage, 'drift');

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

// v4's women and default projectile/feedback package are project-owned art, but
// actors stay on normal-blend textures of their own. The selected art pack (v4
// by default; purchaser-local BulletPack by explicit query, or as the local
// fallback only when v4 is absent) supplies bullets, lasers, missiles,
// explosions, pickups and player feedback.
const v4Actors = await loadV4ActorAtlases();
// Original engine-owned UI, independent of whichever projectile pack is live.
const v4Ui = await loadV4UiAtlas();
// One deterministic near-black cell, instanced once per visible v4 woman.  Its
// two batches sit immediately below the enemy and player actor tiers; it never
// becomes a full-screen grade and never competes with a bullet texture.
const actorPadAtlas = createActorPadAtlas();

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
  actorEnemyPads: new SpriteBatch(actorPadAtlas, {
    capacity: 264,
    renderOrder: ACTOR_PAD_RENDER_ORDER.enemy,
  }),
  enemies: new SpriteBatch(bulletAtlas, { capacity: 256, renderOrder: Layer.Enemies }),
  actorEnemies: new SpriteBatch(v4Actors.enemies, { capacity: 256, renderOrder: Layer.Enemies + 1 }),
  actorBosses: new SpriteBatch(v4Actors.bosses, { capacity: 8, renderOrder: Layer.Enemies + 2 }),
  items: new SpriteBatch(bulletAtlas, { capacity: 512, renderOrder: Layer.Items }),
  actorPlayerPads: new SpriteBatch(actorPadAtlas, {
    capacity: 4,
    renderOrder: ACTOR_PAD_RENDER_ORDER.player,
  }),
  player: new SpriteBatch(shipAtlas, { capacity: 8, renderOrder: Layer.Player }),
  actorPlayer: new SpriteBatch(v4Actors.players, { capacity: 4, renderOrder: Layer.Player + 2 }),
  options: new SpriteBatch(bulletAtlas, { capacity: 32, renderOrder: Layer.Player, }),
  optionsFx: new SpriteBatch(fxAtlas, { capacity: 32, renderOrder: Layer.Player }),
  playerFx: new SpriteBatch(fxAtlas, {
    capacity: 32,
    blending: 'additive',
    renderOrder: Layer.Player - 1,
  }),
  playerShots: new SpriteBatch(bulletAtlas, {
    capacity: 2048,
    blending: 'additive',
    renderOrder: Layer.PlayerShots,
  }),
  enemyShots: new SpriteBatch(bulletAtlas, {
    capacity: 8192,
    renderOrder: Layer.EnemyShots,
  }),
  enemyShotsAdditive: new SpriteBatch(bulletAtlas, {
    capacity: 8192,
    blending: 'additive',
    renderOrder: Layer.EnemyShots + 1,
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
  bombFx: new SpriteBatch(fxAtlas, {
    capacity: 16,
    blending: 'additive',
    renderOrder: Layer.Bursts + 1,
  }),
  bossBodyFx: new SpriteBatch(fxAtlas, {
    capacity: 16,
    blending: 'additive',
    renderOrder: Layer.Enemies + 3,
  }),
  bossDeathFx: new SpriteBatch(fxAtlas, {
    capacity: 32,
    blending: 'additive',
    renderOrder: Layer.Bursts + 2,
  }),
};

// 199: behind every enemy/Boss body; 398: behind thruster (399), ship (400)
// and actor (402). Enemy bullets begin at 600, so both local pads remain below
// every danger surface (explicit render order, CLAUDE.md rule 5).
stage.add(batches.actorEnemyPads.mesh, ACTOR_PAD_RENDER_ORDER.enemy);
stage.add(batches.enemies.mesh, 'Enemies');
stage.add(batches.actorEnemies.mesh, 'Enemies', 1);
stage.add(batches.actorBosses.mesh, 'Enemies', 2);
stage.add(batches.bossBodyFx.mesh, 'Enemies', 3);
stage.add(batches.itemGlow.mesh, 'Items');
stage.add(batches.items.mesh, 'Items', 1);
stage.add(batches.pickups.mesh, 'Items', 1);
stage.add(batches.beamBodies.mesh, 'Beams');
stage.add(batches.actorPlayerPads.mesh, ACTOR_PAD_RENDER_ORDER.player);
stage.add(batches.player.mesh, 'Player');
stage.add(batches.actorPlayer.mesh, 'Player', 2);
stage.add(batches.playerFx.mesh, 'Player', -1);
stage.add(batches.options.mesh, 'Player', 1);
stage.add(batches.optionsFx.mesh, 'Player', 1);
stage.add(batches.playerShots.mesh, 'PlayerShots');
stage.add(batches.enemyShots.mesh, 'EnemyShots');
stage.add(batches.enemyShotsAdditive.mesh, 'EnemyShots', 1);
stage.add(batches.missiles.mesh, 'Missiles');
stage.add(batches.burstsBack.mesh, 'BurstsBack');
stage.add(batches.bursts.mesh, 'Bursts');
stage.add(batches.bombFx.mesh, 'Bursts', 1);
stage.add(batches.bossDeathFx.mesh, 'Bursts', 2);
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
  if (!DEBUG_UI || e.code !== 'KeyB' || e.repeat) return;
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
// populated because module-eval order guarantees the wire: `import './v4'`
// (the compiled edition registers) runs before this file's top-level `await loadPacks()`
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

interface GrazeUiPulse {
  readonly run: Run;
  readonly x: number;
  readonly y: number;
  readonly count: number;
  age: number;
}

/**
 * Presentation reaction to the existing `graze` RunEvent.  No collision query,
 * distance check or inferred near-miss lives here; if the simulation did not
 * emit the event, the UI cannot invent one.
 */
const grazeUiPulses: GrazeUiPulse[] = [];
const GRAZE_UI_TICKS = 16;

const bossIdentityFx: BossIdentityFx<Run>[] = [];

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
    stageStructure.step();
    for (let i = grazeUiPulses.length - 1; i >= 0; i--) {
      const pulse = grazeUiPulses[i]!;
      pulse.age++;
      if (pulse.age >= GRAZE_UI_TICKS) grazeUiPulses.splice(i, 1);
    }
    stepBossIdentityFx(bossIdentityFx, (name) => {
      const identityStrip = fxAtlas.strip(name);
      return identityStrip.frames * identityStrip.ticksPerFrame;
    });

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
        if (event.type === 'graze') {
          grazeUiPulses.push({
            run,
            x: event.x,
            y: event.y,
            count: Math.max(1, event.count ?? 1),
            age: 0,
          });
          // A dense multi-graze tick still reads as one clean arc; cap retained
          // pulses so presentation work cannot scale with curtain density.
          if (grazeUiPulses.length > 12) grazeUiPulses.splice(0, grazeUiPulses.length - 12);
        }
        if (event.type === 'boss-defeated') {
          const strip = event.name === undefined ? undefined : V4_BOSS_ACTORS[event.name]?.deathStrip;
          if (strip !== undefined && fxAtlas.has(strip)) {
            bossIdentityFx.push({ run, strip, x: event.x, y: event.y, age: 0 });
          }
        }
      }
    }

    if (topRun === undefined) {
      grazeUiPulses.length = 0;
      bossIdentityFx.length = 0;
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
      stageStructure.transitionTo(scene, SCENE_FADE_TICKS);
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

    const visibleRuns = new Set(machine.stack.flatMap((state) => {
      const run = (state as { run?: Run }).run;
      return run === undefined ? [] : [run];
    }));
    for (const identity of visibleBossIdentityFx(bossIdentityFx, visibleRuns)) {
      const strip = fxAtlas.strip(identity.strip);
      const life = strip.frames * strip.ticksPerFrame;
      drawStrip(batches.bossDeathFx, fxAtlas, identity.x, identity.y, identity.strip, identity.age, {
        a: Math.max(0, 1 - identity.age / life),
      });
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

/**
 * Draw one explicitly selected actor pose.
 *
 * Projectile/effect strips advance from entity age through `drawStrip`. Actor
 * poses are different: banking input, an enemy's breathing pair and a boss's
 * phase select a semantic frame directly. Keeping that distinction here avoids
 * pretending an attack gesture is a perpetual four-frame clock.
 */
function drawPose(
  batch: SpriteBatch,
  atlas: Atlas,
  x: number,
  y: number,
  name: string,
  frame: number,
  style: {
    width?: number;
    height?: number;
    r?: number;
    g?: number;
    b?: number;
    a?: number;
  } = {},
): void {
  const strip = atlas.strip(name);
  batch.draw(x, y, atlas.frameOf(strip, frame), {
    width: style.width ?? strip.displayW ?? strip.frameW,
    height: style.height ?? strip.displayH ?? strip.frameH,
    r: style.r,
    g: style.g,
    b: style.b,
    a: style.a,
  });
}

/** Draw one bounded normal-blend darkness plate immediately behind a v4 actor. */
function drawActorPad(
  batch: SpriteBatch,
  role: ActorPadRole,
  x: number,
  y: number,
  actorSize: number,
  alphaScale = 1,
): void {
  const pad = actorPadLayout(role, actorSize);
  batch.draw(x, y, ACTOR_PAD_CELL, {
    width: pad.width,
    height: pad.height,
    a: pad.alpha * alphaScale,
  });
}

/**
 * Resolve the instance tint for one named strip.
 *
 * A tinted strip is white art whose colour comes from content, so it keeps the
 * authored tint. A baked strip already carries its final colour in its texels and
 * therefore draws identity-white.
 */
function stripTint(
  atlas: Atlas,
  name: string,
  tint?: { r?: number; g?: number; b?: number },
): { r: number; g: number; b: number } {
  const source = atlas.strip(name).color === 'baked' ? undefined : tint;
  return {
    r: source?.r ?? 1,
    g: source?.g ?? 1,
    b: source?.b ?? 1,
  };
}

function drawRun(run: Run): void {
  for (const e of run.enemies.enemies) {
    const actor = V4_ENEMY_ACTORS[e.name];
    if (actor !== undefined) {
      // Women are the positive form; their projectile vocabulary remains on the
      // selected art pack, project-owned v4 by default. The two breathing frames
      // yield to attack/recover only after the sim reports a successful volley.
      // Never rotate a person by
      // her movement angle: the authored front three-quarter silhouette is part
      // of the safe-space grammar.
      drawActorPad(batches.actorEnemyPads, 'enemy', e.x, e.y, actor.size);
      drawPose(
        batches.actorEnemies,
        v4Actors.enemies,
        e.x,
        e.y,
        actor.strip,
        v4EnemyPoseFrame(e.age, e.ticksSinceFire),
        { width: actor.size, height: actor.size, r: 0.86, g: 0.86, b: 0.86 },
      );
      continue;
    }
    // Law of Animation: the frame resolves off `e.age` (enemy.ts sets it, 0 at
    // spawn, tick-advanced) so a multi-frame enemy strip (clerk/hunter/ray) cycles
    // instead of freezing on frame 0 — the primary bug the user reported. Size
    // stays SPEC-driven: `spec.width/height` override any `displayW`, because an
    // enemy's size is its spec and the cell is only its skin.
    const tint = stripTint(bulletAtlas, e.spec.sprite, e.spec.tint);
    drawStrip(batches.enemies, bulletAtlas, e.x, e.y, e.spec.sprite, e.age, {
      rotation: e.angle,
      width: e.spec.width,
      height: e.spec.height,
      ...tint,
    });
  }

  const boss = run.boss.boss;
  if (boss?.alive) {
    const feedback = bossFeedbackLayout({
      hpFraction: boss.phaseHpFraction,
      phaseTicks: boss.phaseTicks,
      impactKind: boss.impact?.kind,
      impactFraction: boss.impactFraction,
      direction8: boss.impact?.direction8,
    });
    const drawX = boss.x + feedback.recoilX;
    const drawY = boss.y + feedback.recoilY;
    const actor = V4_BOSS_ACTORS[boss.name];
    const legacyStrip = actor === undefined ? bulletAtlas.strip(boss.spec.sprite) : undefined;
    const bodyWidth = actor?.size
      ?? boss.spec.width
      ?? legacyStrip?.displayW
      ?? legacyStrip?.frameW
      ?? boss.spec.radius * 2;
    const bodyHeight = actor?.size
      ?? boss.spec.height
      ?? legacyStrip?.displayH
      ?? legacyStrip?.frameH
      ?? boss.spec.radius * 2;
    if (actor !== undefined) {
      const size = actor.size * feedback.bodyScale;
      drawActorPad(batches.actorEnemyPads, 'boss', boss.x, boss.y, actor.size);
      drawPose(
        batches.actorBosses,
        v4Actors.bosses,
        drawX,
        drawY,
        actor.strip,
        v4BossPoseFrame({
          entering: boss.entering,
          phaseTicks: boss.phaseTicks,
          ticksSinceFire: boss.ticksSinceFire,
          phaseHpFraction: boss.phaseHpFraction,
          phaseTimeFraction: boss.phaseTimeFraction,
          impactKind: boss.impact?.kind,
          impactFraction: boss.impactFraction,
        }),
        { width: size, height: size, r: 0.86, g: 0.86, b: 0.86 },
      );
    } else {
      const tint = stripTint(bulletAtlas, boss.spec.sprite, boss.spec.tint);
      drawStrip(batches.enemies, bulletAtlas, drawX, drawY, boss.spec.sprite, boss.age, {
        rotation: boss.angle,
        width: boss.spec.width,
        height: boss.spec.height,
        scale: feedback.bodyScale,
        ...tint,
      });
    }
    if (feedback.distress > 0) {
      const distressWidth = bodyWidth * feedback.bodyScale;
      const distressHeight = bodyHeight * feedback.bodyScale;
      const coreSize = Math.min(distressWidth, distressHeight);
      const material = boss.spec.hitMaterial;
      if (material === 'surface' || material === 'skeleton' || material === 'mycelium') {
        drawPose(batches.bossBodyFx, fxAtlas, drawX, drawY, `boss.distress.${material}`, feedback.materialFrame, {
          width: distressWidth,
          height: distressHeight,
          a: feedback.crackAlpha,
        });
      }
      else if (material === 'heart') {
        drawPose(batches.bossBodyFx, fxAtlas, drawX, drawY - coreSize * 0.05, 'boss.distress.heart', feedback.heartFrame, {
          width: coreSize * 0.36 * feedback.heartScale,
          height: coreSize * 0.36 * feedback.heartScale,
          a: feedback.heartAlpha,
        });
      }
      else {
        // Guest Bosses without the v4 material vocabulary keep a restrained
        // generic crack plus heart fallback, sized from their actual atlas body.
        drawPose(batches.bossBodyFx, fxAtlas, drawX, drawY, 'boss.distress.crack', feedback.crackFrame, {
          width: distressWidth, height: distressHeight, a: feedback.crackAlpha * 0.7,
        });
        drawPose(batches.bossBodyFx, fxAtlas, drawX, drawY - coreSize * 0.05, 'boss.distress.heart', feedback.heartFrame, {
          width: coreSize * 0.3 * feedback.heartScale,
          height: coreSize * 0.3 * feedback.heartScale,
          a: feedback.heartAlpha * 0.45,
        });
      }
    }
  }

  for (const item of run.items.items) {
    // A looping glow behind every pickup — the run-relative-loop proof consumer.
    // `pulse` is a `mode: 'loop'` strip on the fx sheet, and its frame is clocked
    // off `item.age` (run-relative, starts at 0 at spawn, reproduced by a replay)
    // — NEVER `loop.count`, whose program-global phase would desync the loop
    // across replays watched at different session offsets (the grafted clock law).
    const glow = fxAtlas.strip('pulse');
    const glowFrame = fxAtlas.frameOf(glow, stripFrame(glow, item.age));
    const glowTint = stripTint(fxAtlas, 'pulse', item.spec.tint);
    batches.itemGlow.draw(item.x, item.y, glowFrame, {
      width: glow.frameW,
      height: glow.frameH,
      ...glowTint,
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
      // the missile/beam draws obey). The glow halo above follows the same rule.
      // `drawStrip` resolves the frame off `item.age` (Law of Animation, already so
      // for the spinning pickup) and the size off `displayW` (Law of Geometry).
      const tint = stripTint(pickupAtlas, item.spec.sprite, item.spec.tint);
      drawStrip(batches.pickups, pickupAtlas, item.x, item.y, item.spec.sprite, item.age, {
        ...tint,
      });
    } else {
      // The bullet-atlas item branch (`power`/`life`/`bomb`/`score`/`big-power`).
      // Routed off `item.age` so a multi-frame item skin cycles — this is what
      // unfreezes `big-power`→`star` (7 frames), reported static.
      const tint = stripTint(bulletAtlas, item.spec.sprite, item.spec.tint);
      drawStrip(batches.items, bulletAtlas, item.x, item.y, item.spec.sprite, item.age, {
        rotation: item.angle,
        ...tint,
      });
    }
  }

  for (const b of run.bullets.bullets) {
    // Enemy bullets honour their authored blend flag too. The old single normal
    // batch made every additive pack-authored curtain draw as a flat sticker; the
    // split remains presentation-only and keeps both batches on the same atlas.
    const batch = b.faction === 'player'
      ? batches.playerShots
      : b.style.additive === true
        ? batches.enemyShotsAdditive
        : batches.enemyShots;

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
          // The skin value is the VISIBLE band. A native frame keeps transparent
          // cross-axis padding, so compensate by frameH/contentH at draw time.
          thickness: laserBodyDisplayThickness(
            skin.thickness,
            bodyStrip.frameH,
            bodyStrip.contentH,
          ),
          // Default the tile length to the body strip's own frame width, so the
          // procedural floor and a native reskin each tile at their native cell.
          tileLength: skin.tileLength ?? bodyStrip.frameW,
          bodyUV,
          // Law of Geometry: the cap adopts its display size (its
          // per-frame union → engine cap size) when the pack carries `contentW`,
          // native `frameW/H` otherwise. The body uses the contentH correction
          // above; its imported +x frame already has no transparent pad.
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
          // Player beam impacts own a thin persistent hot edge; unlike contact
          // particles this stays continuous along the rendered beam and consumes
          // no simulation state or RNG.
          if (b.faction === 'player' && b.feedback === 'beam') {
            batches.beamBodies.draw(q.x, q.y, q.uv, {
              rotation: q.rotation,
              width: q.width,
              height: q.height * 1.35,
              r: bodyBaked ? 1 : b.style.r,
              g: bodyBaked ? 1 : b.style.g,
              b: bodyBaked ? 1 : b.style.b,
              a: q.alpha * 0.24,
            });
          }
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
      const tint = stripTint(bulletAtlas, b.style.sprite, b.style);
      batch.draw(
        b.x + half * Math.cos(b.angle),
        b.y + half * Math.sin(b.angle),
        b.style.sprite,
        {
          rotation: b.angle,
          width: b.length,
          height: b.style.height ?? b.style.width,
          ...tint,
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
    // A baked body carries its own colour, so the tint stays white and it shows
    // unmultiplied; the tinted procedural floor takes the content tint. That strip
    // colour rule applies equally to missiles and ordinary bullets, after routing
    // each body to the atlas that owns it. Routed through `drawStrip` off `b.age`:
    // the frame animates
    // (Law of Animation) and the size is `b.style.width ?? displayW ?? frameW` (Law
    // of Geometry — an explicit spec width still wins; `displayW` is dormant until
    // the pack carries `contentW`). For the base game every bullet strip is
    // `frames: 1` at 32px, so this stays byte-identical to before.
    const tint = stripTint(spriteAtlas, b.style.sprite, b.style);
    // A carried blade's collision is a capsule. A named baked reskin used to be
    // fitted back into the tiny needle cell and could paint only ~5px around a
    // 26px lethal shape. The view now covers the capsule unless content supplied
    // an explicit size; missiles keep their dedicated body geometry.
    const projectileStrip = spriteAtlas.strip(b.style.sprite);
    const bladeSize = bladeDisplaySize(b.style, b.bladeHalf, b.radius, projectileStrip);
    drawStrip(drawBatch, spriteAtlas, b.x, b.y, b.style.sprite, b.age, {
      rotation: b.angle,
      width: bladeSize.width,
      height: bladeSize.height,
      ...tint,
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
    const tint = stripTint(atlas, p.spec.sprite, p.spec.tint);
    drawStrip(batch, atlas, p.x, p.y, p.spec.sprite, p.age, {
      rotation: p.angle,
      scale: p.scale,
      ...tint,
      a: p.alpha,
    });
  }

  // Read from the spec, not hardcoded: `OptionSpec` already declares a sprite
  // and a tint per option set, and a shell that picks its own makes those two
  // fields decorative — `seeker` authors a tinted `ring` and was drawn as
  // `standard`'s untinted orb.
  const optionSpec = run.options.spec;
  for (let optionIndex = 0; optionIndex < run.options.options.length; optionIndex++) {
    const option = run.options.options[optionIndex];
    if (option === undefined) continue;
    if (!option.active) continue;
    // Built-in heroines first claim their own option strip; a pack that supplies
    // only the historical shared strip still works, and guest characters retain
    // their declared option sprite. `option.age` is fixed simulation time.
    const characterOption = `player.option.${run.characterName}`;
    const playerOption = fxAtlas.has(characterOption)
      ? characterOption
      : fxAtlas.has('player.option')
        ? 'player.option'
        : undefined;
    const usePlayerOption = playerOption !== undefined;
    const atlas = usePlayerOption ? fxAtlas : bulletAtlas;
    const batch = usePlayerOption ? batches.optionsFx : batches.options;
    const sprite = playerOption ?? optionSpec.sprite;
    const tint = stripTint(atlas, sprite, optionSpec.tint);
    drawStrip(batch, atlas, option.x, option.y, sprite, option.age, {
      // `Option.angle` is DEGREES — its own doc comment says so, and contrasts
      // itself with `Bullet.angle`, which is the radians this attribute wants.
      // Fed across unconverted, an option aiming at 270 was drawn at 349.9.
      rotation: (option.angle * Math.PI) / 180,
      ...tint,
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
    // The three named thrust states and two residue strips are conventional
    // fx names, so any pack can supply them without widening Bomb/Player specs.
    // Vertical intent comes from the replay mask; the animation clock is the
    // player's fixed entity age, never the render loop.
    const thrust = player.verticalIntent < 0
      ? 'player.thruster.up'
      : player.verticalIntent > 0
        ? 'player.thruster.down'
        : 'player.thruster.cruise';
    if (fxAtlas.has(thrust)) {
      drawStrip(batches.playerFx, fxAtlas, player.x, player.y + 19, thrust, player.age, {
        a: blink ? 0.25 : 0.9,
      });
    }
    for (const [i, residue] of ['player.thruster.particle.0', 'player.thruster.particle.1'].entries()) {
      if (!fxAtlas.has(residue)) continue;
      drawStrip(batches.playerFx, fxAtlas, player.x, player.y + 25 + i * 5, residue, player.age, {
        a: blink ? 0.18 : 0.55 - i * 0.12,
      });
    }

    // Five source frames are banking POSES, not a 60 Hz loop. A fresh direction
    // uses the gentle frame for three replayed ticks, then settles into the hard
    // pose and holds. A pack ship participates only when its manifest explicitly
    // declares the same five-way semantics; arbitrary/legacy strips stay frame 0.
    const bankFrame = v4PlayerBankFrame(player.horizontalIntent, player.horizontalHeldTicks);
    const shipFrame = packs.shipStrip?.banking === 'five-way' ? bankFrame : 0;
    const actor = V4_PLAYER_ACTORS[run.characterName];
    if (actor !== undefined) {
      // Keep the local darkness present through the invulnerability blink so
      // the player's location never disappears into scene texture. It softens
      // with the actor, but unlike the actor never drops to a near-invisible
      // frame.
      drawActorPad(
        batches.actorPlayerPads,
        'player',
        player.x,
        player.y,
        actor.size,
        blink ? 0.72 : 1,
      );
      // A pack ship remains visible as the heroine's compact back wing/core
      // rather than impersonating the protagonist. It is pack-owned, so a
      // zero-pack run simply omits this optional under-layer.
      if (packs.shipUrl !== undefined) {
        drawPose(batches.player, shipAtlas, player.x, player.y + 5, ship.sprite, shipFrame, {
          width: 36,
          height: 36,
          a: blink ? 0.2 : 0.72,
          g: blink ? 0.5 : 1,
          b: blink ? 0.5 : 1,
        });
      }
      drawPose(
        batches.actorPlayer,
        v4Actors.players,
        player.x,
        player.y,
        actor.strip,
        bankFrame,
        {
          width: actor.size,
          height: actor.size,
          r: 0.88,
          g: blink ? 0.44 : 0.88,
          b: blink ? 0.44 : 0.88,
          a: blink ? 0.35 : 1,
        },
      );
    } else {
      // Pack characters keep their declared ship surface; only an explicit
      // five-way contract enables banking, otherwise this is stable frame 0.
      drawPose(batches.player, shipAtlas, player.x, player.y, ship.sprite, shipFrame, {
        width: ship.width ?? 40,
        height: ship.height ?? 40,
        a: blink ? 0.35 : 1,
        g: blink ? 0.5 : 1,
        b: blink ? 0.5 : 1,
      });
    }
  }

  // Specialized pack strips take priority when a bomb registry name claims one.
  // Their age is fixed simulation time; guest/legacy names retain the two old
  // visual fallbacks below.
  // elapsed time comes from BombSystem's integer duration/remaining pair. This
  // is view-only: damage, clearing, conversion and invulnerability stay exactly
  // where they were in the fixed-tick simulation.
  if (run.bombs.active) {
    const bomb = run.bombs;
    const specialized = `player.bomb.${bomb.name}`;
    if (fxAtlas.has(specialized)) {
      drawStrip(batches.bombFx, fxAtlas, bomb.x, bomb.y, specialized, bomb.age, {
        scale: 3.9,
        a: 0.78,
      });
    } else if (bomb.name === 'spread' && fxAtlas.has('player.bomb.field')) {
      drawStrip(batches.bombFx, fxAtlas, bomb.x, bomb.y, 'player.bomb.field', bomb.age, {
        scale: 3.9,
        a: 0.7,
      });
    } else if (bomb.name === 'lance') {
      // A lance bomb is a travelling attack, not two large decals nailed to
      // the activation point. Position is a pure function of the bomb entity's
      // fixed age; the sprites keep their authored cell aspect ratio.
      const projectileY = bomb.y - Math.min(bomb.age, 42) * 7;
      const missileY = bomb.y - 24 - Math.min(bomb.age, 34) * 9;
      if (fxAtlas.has('player.bomb.projectile')) {
        drawStrip(batches.bombFx, fxAtlas, bomb.x - 26, projectileY, 'player.bomb.projectile', bomb.age, {
          scale: 3.1,
          a: 0.68,
        });
        drawStrip(batches.bombFx, fxAtlas, bomb.x + 26, projectileY, 'player.bomb.projectile', bomb.age, {
          scale: 3.1,
          a: 0.75,
        });
      }
      if (fxAtlas.has('player.bomb.missile')) {
        drawStrip(batches.bombFx, fxAtlas, bomb.x, missileY, 'player.bomb.missile', bomb.age, {
          scale: 4,
          a: 0.9,
        });
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Overlay                                                             */
/* ------------------------------------------------------------------ */

/** CJK-capable fallback stack: guest-pack labels remain verbatim Unicode. */
const UI_FONT = '"Hiragino Sans GB", "Yu Gothic", "Noto Sans CJK SC", system-ui, sans-serif';

function uiFont(size: number, weight: 400 | 500 | 600 = 400): void {
  surface.font = `${weight} ${size}px ${UI_FONT}`;
}

function drawGrazeFeedback(run: Run): void {
  for (const pulse of grazeUiPulses) {
    if (pulse.run !== run) continue;
    const frame = Math.min(3, Math.floor(pulse.age / 4));
    const alpha = Math.max(0, 1 - pulse.age / GRAZE_UI_TICKS);
    drawV4Ui(surface, v4Ui, 'ui.graze.arc', pulse.x - 16, pulse.y - 16, {
      frame,
      alpha,
      rotation: ((pulse.age + pulse.count * 2) % 32) * (Math.PI / 16),
    });
  }
}

/**
 * Draw the focused lethal centre after all WebGL and gameplay feedback.
 *
 * The outer authored ring is deliberately restrained.  A near-black keyline
 * then occludes any additive respawn/bomb light directly under the real core,
 * and the final white disc uses `player.radius` unchanged — a 2.5px hit point
 * remains 2.5px rather than becoming the whole 32px ornament.
 */
function drawFocusIndicator(run: Run): void {
  if (!run.player.alive || !run.player.focused) return;
  const { x, y, radius } = run.player;
  const indicator = focusIndicatorLayout(x, y, radius, run.tickCount);
  surface.save();
  drawV4Ui(surface, v4Ui, 'ui.focus.ring', indicator.ringX, indicator.ringY, {
    width: indicator.ringSize,
    height: indicator.ringSize,
    rotation: indicator.ringRotation,
    alpha: indicator.ringAlpha,
  });

  surface.shadowBlur = 0;
  surface.fillStyle = 'rgba(2,5,10,0.96)';
  surface.beginPath();
  surface.arc(x, y, indicator.keylineRadius, 0, Math.PI * 2);
  surface.fill();

  surface.fillStyle = '#f5fbff';
  surface.beginPath();
  surface.arc(x, y, indicator.coreRadius, 0, Math.PI * 2);
  surface.fill();
  surface.restore();
}

function drawOverlay(run: Run | undefined): void {
  surface.clearRect(0, 0, overlay.width, overlay.height);

  if (run !== undefined) drawGrazeFeedback(run);

  drawHud(run);

  // Highest gameplay indicator: over WebGL FX, graze arcs and the in-field HUD.
  // Dialogue and modal state panels still composite afterward, because they
  // intentionally suspend/cover play rather than competing inside it.
  if (run !== undefined) drawFocusIndicator(run);

  // A pre-boss exchange is drawn over the field the player is still flying. It
  // sits above the HUD and below any menu (a pause taken mid-exchange composites
  // over it). `run.dialogue` is read as declared state, exactly like `scene`.
  if (run) {
    const line = run.dialogue;
    if (line) drawDialogue(line, run.tickCount, run.characterName);
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
  uiFont(11, 500);
  surface.textAlign = 'left';

  // Tuning UI is explicitly opt-in.  Production screenshots contain only the
  // authored v4 interface, never draw-call counters or the Bloom switch.
  if (DEBUG_UI) {
    surface.fillStyle = post.enabled ? '#668a77' : '#555861';
    surface.fillText(`bloom ${post.enabled ? 'on' : 'off'} [B]`, 8, FIELD_H - 8);
  }

  if (!run) return;

  const p = run.player;
  const boss = run.boss.boss;
  const bossUp = boss?.alive === true;

  // Top-left: score and graze, pushed below the boss bar when one is up.
  const topY = bossUp ? 50 : 16;
  drawV4Ui(surface, v4Ui, 'ui.hud.score', 8, topY - 12, { alpha: 0.9 });
  surface.fillStyle = '#d6e1e8';
  surface.fillText(`${p.score.toString().padStart(9, '0')}`, 29, topY);
  drawV4Ui(surface, v4Ui, 'ui.hud.graze', 8, topY + 3, { alpha: 0.8 });
  surface.fillStyle = '#8796a3';
  surface.fillText(`GRAZE ${p.graze}`, 29, topY + 15);

  // Top-right: the resources a player checks between waves.
  surface.textAlign = 'right';
  surface.fillStyle = '#d6e1e8';
  // ∞ rather than a count when the assist is on: the life stock never falls, so
  // a number would read as a fixed 3 and hide that deaths cost nothing here.
  const lives = run.config.infiniteLives === true ? '∞' : `${p.lives}`;
  hudResource(packs.hudIcons.life, 'ui.hud.life', lives, FIELD_W - 8, topY);
  surface.fillStyle = '#91a0ad';
  hudResource(packs.hudIcons.bomb, 'ui.hud.bomb', `${p.bombs}`, FIELD_W - 8, topY + 15);
  hudResource(undefined, 'ui.hud.power', `P ${p.power.toFixed(2)}`, FIELD_W - 52, topY + 15);

  // The tier, one row under the resources: set once at the SELECT screen and
  // never changing, so it sits at the very bottom of the visual hierarchy in the
  // screen's dimmest grey. Rendered on every tier, Normal included — a constant
  // fixture reads cleaner than a readout that blinks in only on the tiers a
  // player deliberately picked. (`#3a3a3a` is the dimmest text the HUD uses; the
  // decisions doc's "dimmest style" is read literally rather than as "one step
  // down within this cluster", which would be `#6f6f78`.)
  surface.fillStyle = '#687783';
  surface.fillText(run.difficulty.toUpperCase(), FIELD_W - 8, topY + 31);

  // Bottom-right: diagnostics, dimmest text on screen.
  if (DEBUG_UI) {
    surface.fillStyle = '#59616b';
    surface.fillText(
      `${run.tickCount} t  ${run.bullets.count} b  ${stage.stats.calls} dc`,
      FIELD_W - 8,
      FIELD_H - 8,
    );
  }
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
 * icon, the engine-owned v4 icon otherwise.
 *
 * The pack supplies the **shape** only — position, size and alpha stay
 * engine-owned, the same structural split as white-bullets-with-engine-tint. So
 * a loaded icon is drawn at a fixed small size and low alpha to the left of the
 * number, exactly where the glyph would have sat, and never gets to move the
 * HUD around. The v4 atlas is the permanent fallback, so the UI remains a
 * complete coherent package with no resource pack loaded.
 */
const HUD_ICON = 13;
const HUD_ICON_GAP = 3;
const HUD_ICON_ALPHA = 0.85;

function hudResource(
  icon: HTMLImageElement | undefined,
  fallback: V4UiCellName,
  text: string,
  rightX: number,
  baselineY: number,
): void {
  surface.fillText(text, rightX, baselineY);
  const iconX = rightX - surface.measureText(text).width - HUD_ICON - HUD_ICON_GAP;
  if (icon === undefined) {
    drawV4Ui(surface, v4Ui, fallback, iconX, baselineY - HUD_ICON, {
      width: HUD_ICON,
      height: HUD_ICON,
      alpha: HUD_ICON_ALPHA,
    });
  } else {
    surface.save();
    surface.globalAlpha = HUD_ICON_ALPHA;
    surface.drawImage(icon, iconX, baselineY - HUD_ICON, HUD_ICON, HUD_ICON);
    surface.restore();
  }
}

function drawBossBar(boss: NonNullable<Run['boss']['boss']>): void {
  const spell = boss.phase.isSpell === true;
  // The production ornament carries the generated design's authored end caps
  // and heart crest. Keep it inside the 80px side gutters: the persistent HUD
  // owns those columns even during a boss, while the data-driven fills occupy
  // the ornament's quiet centre.
  drawV4Ui(surface, v4Ui, 'ui.boss.ornament', 80, 0, {
    width: 320,
    height: 52,
    alpha: 0.72,
  });
  drawUiBarFill(
    spell ? 'ui.boss.fill.spell' : 'ui.boss.fill.normal',
    110,
    8,
    boss.phaseHpFraction,
    260,
  );

  // The timer runs down beside the health, because surviving it is a clear too.
  // Only a spell card gets one drawn: a non-spell phase has a clock as well,
  // but showing it makes every movement look like a card being captured.
  if (spell) {
    drawUiBarFill('ui.boss.timer', 110, 20, 1 - boss.phaseTimeFraction, 260);
  }

  const tint = tintFor(boss.name);
  surface.fillStyle = `rgb(${Math.round(tint.r * 215)},${Math.round(tint.g * 215)},${Math.round(tint.b * 225)})`;
  uiFont(9, 600);
  surface.textAlign = 'left';
  surface.fillText(boss.name, 84, 61);
  surface.fillStyle = spell ? '#edb8c8' : '#9caab5';
  surface.textAlign = 'right';
  surface.fillText(spell ? `✧ ${boss.phase.name}` : boss.phase.name, FIELD_W - 84, 61);
  surface.textAlign = 'left';
}

function drawUiBarFill(
  name: V4UiCellName,
  x: number,
  y: number,
  fraction: number,
  displayWidth?: number,
): void {
  const spec = V4_UI_CELLS[name];
  const visible = Math.max(0, Math.min(spec.frameW, Math.round(spec.frameW * fraction)));
  if (visible === 0) return;
  const visibleDisplayWidth = (displayWidth ?? spec.displayW) * (visible / spec.frameW);
  surface.save();
  surface.imageSmoothingEnabled = false;
  surface.drawImage(
    v4Ui.texture.image as CanvasImageSource,
    spec.x,
    spec.y,
    visible,
    spec.frameH,
    x,
    y,
    visibleDisplayWidth,
    spec.displayH,
  );
  surface.restore();
}

function drawView(view: {
  kind: string;
  title?: string;
  lines?: readonly string[];
  menu?: readonly string[];
  selected?: number;
  age?: number;
  character?: string;
  tally?: readonly { readonly sprite: string; readonly count: number }[];
}): void {
  surface.save();
  const age = view.age ?? 0;
  const cx = FIELD_W / 2;

  if (view.kind === 'title') {
    const masthead = V4_UI_CELLS['ui.title.masthead'];
    drawV4Ui(surface, v4Ui, 'ui.title.masthead', cx - masthead.displayW / 2, 38, {
      alpha: 0.96,
    });
    surface.textAlign = 'center';
    uiFont(27, 600);
    surface.fillStyle = '#e1ebf1';
    surface.fillText(view.title ?? 'DANMAKU', cx, 98);
    uiFont(11, 500);
    surface.fillStyle = '#8596a3';
    surface.fillText('余白御寮  /  THE NEGATIVE-SPACE WARD', cx, 152);
    // State-owned copy remains dynamic and verbatim.  `press start` used to be
    // silently discarded even though TitleState supplied it through `lines`.
    drawViewLines(view.lines ?? [], cx, 212, 320, '#8d9da8');
    const titleEntries = view.menu ?? [];
    const titleSelected = Math.max(0, Math.min(titleEntries.length - 1, view.selected ?? 0));
    const titleRows = 7;
    const titleFirst = Math.max(
      0,
      Math.min(titleSelected - Math.floor(titleRows / 2), titleEntries.length - titleRows),
    );
    const visibleTitleEntries = titleEntries.slice(titleFirst, titleFirst + titleRows);
    const titleMenuH = Math.max(128, 72 + visibleTitleEntries.length * 44);
    drawMenuRows(visibleTitleEntries, titleSelected - titleFirst, 74, 302, 332, 44, age);
    surface.textAlign = 'center';
    uiFont(9, 500);
    surface.fillStyle = '#71808c';
    if (titleFirst > 0) surface.fillText('▲', cx, 272);
    if (titleFirst + visibleTitleEntries.length < titleEntries.length) {
      surface.fillText('▼', cx, 246 + titleMenuH - 12);
    }
    surface.restore();
    return;
  }

  if (view.kind === 'character-select') {
    drawScreenHeading(view.title ?? 'SELECT', 72);
    const previewActor = view.character === undefined ? undefined : V4_PLAYER_ACTORS[view.character];
    const identity = view.character === undefined ? undefined : V4_CHARACTER_UI[view.character as keyof typeof V4_CHARACTER_UI];
    const characterLayout = V4_UI_SCREEN.character;
    if (previewActor !== undefined) {
      const strip = v4Actors.players.strip(previewActor.strip);
      const frame = v4Actors.players.frameOf(strip, 2);
      const source = characterLayout.actorSource;
      const actor = characterLayout.actor;
      surface.imageSmoothingEnabled = false;
      surface.globalAlpha = 0.96;
      surface.drawImage(
        v4Actors.players.texture.image as CanvasImageSource,
        frame.x + source.x,
        frame.y + source.y,
        source.w,
        source.h,
        actor.x,
        actor.y,
        actor.w,
        actor.h,
      );
      surface.globalAlpha = 1;
    } else if (view.character !== undefined) {
      const fallback = characterLayout.fallback;
      surface.drawImage(
        portraitImage(view.character),
        fallback.x,
        fallback.y,
        fallback.w,
        fallback.h,
      );
    }
    // Draw the identity card over the preview so its authored thorns and heart
    // remain the foreground silhouette.  The image inside is still the real
    // actor atlas (or the existing third-party portrait fallback), never a
    // second character identity baked into UI art.
    const characterFrame = characterLayout.frame;
    drawV4Ui(surface, v4Ui, 'ui.character.frame', characterFrame.x, characterFrame.y, {
      width: characterFrame.w,
      height: characterFrame.h,
      alpha: 0.92,
    });
    if (identity !== undefined) {
      const crest = characterLayout.crest;
      drawV4Ui(
        surface,
        v4Ui,
        identity.crest,
        crest.x,
        crest.y,
        { width: crest.w, height: crest.h },
      );
    }
    const menu = characterLayout.menu;
    drawMenuRows(view.menu ?? [], view.selected, menu.x, menu.y, menu.w, menu.rowH, age);
    // Character copy owns the right-hand column below the menu. Keeping it out
    // of the full-width centre prevents even short built-in blurbs from crossing
    // the compact production card's right edge.
    const copy = characterLayout.copy;
    drawViewLines(view.lines ?? [], copy.x, copy.y, copy.w, '#93a2ae');
    surface.restore();
    return;
  }

  if (view.kind === 'difficulty-select') {
    drawScreenHeading(view.title ?? 'DIFFICULTY', 78);
    (view.menu ?? []).forEach((entry, index) => {
      const y = 132 + index * 76;
      const active = index === view.selected;
      const seal = V4_DIFFICULTY_UI[entry as keyof typeof V4_DIFFICULTY_UI];
      drawMenuRowFrame(148, y, 270, 50, active);
      if (seal !== undefined) drawV4Ui(surface, v4Ui, seal, 96, y - 27, { alpha: active ? 1 : 0.55 });
      else drawV4Ui(surface, v4Ui, 'ui.assist.seal', 96, y - 27, { alpha: active ? 1 : 0.55 });
      if (active) drawV4Ui(surface, v4Ui, 'ui.cursor', 73, y - 15, { rotation: (age % 80) * (Math.PI / 40) });
      surface.textAlign = 'left';
      uiFont(13, active ? 600 : 400);
      surface.fillStyle = active ? '#e2ebf1' : '#71808c';
      surface.fillText(entry, 164, y + 4);
    });
    drawViewLines(view.lines ?? [], cx, 548, 318, '#96a6b2');
    surface.restore();
    return;
  }

  const { x: statusX, y: statusY, w: statusW, h: statusH } = V4_UI_SCREEN.status;
  // Modal/result screens now carry their own generated silhouette instead of
  // all collapsing into the same generic nine-slice. The generated source is
  // line art on transparency, so retain one strictly local ink wash inside it:
  // score and menu copy must not compete with a frozen danmaku curtain.
  surface.save();
  surface.fillStyle = 'rgba(4, 7, 12, 0.88)';
  surface.fillRect(
    statusX + 18,
    statusY + 22,
    statusW - 36,
    statusH - 44,
  );
  surface.restore();
  drawV4Ui(surface, v4Ui, 'ui.status.frame', statusX, statusY, {
    width: statusW,
    height: statusH,
    alpha: 0.94,
  });
  const sealByKind: Partial<Record<string, V4UiCellName>> = {
    pause: 'ui.status.pause',
    cleared: 'ui.status.clear',
    'game-over': 'ui.status.gameover',
    ending: 'ui.status.ending',
  };
  const statusSeal = view.kind === 'cleared' && view.title === 'ALL CLEAR'
    ? 'ui.status.result'
    : sealByKind[view.kind] ?? 'ui.status.result';
  drawV4Ui(surface, v4Ui, statusSeal, cx - 28, 132, {
    rotation: view.kind === 'ending' ? (age % 180) * (Math.PI / 90) : undefined,
  });
  if (view.title !== undefined) drawScreenHeading(view.title, 224);
  drawV4Ui(surface, v4Ui, 'ui.divider', 110, 242, { width: 260, alpha: 0.68 });
  let y = view.title === undefined ? 230 : 274;
  y = drawViewLines(view.lines ?? [], cx, y, 270, '#9cabb6');
  if (view.tally && view.tally.length > 0) {
    y += 8;
    drawCoinTally(view.tally, cx, y, age);
    y += 28;
  }
  drawMenuRows(view.menu ?? [], view.selected, 112, Math.max(y + 18, 388), 256, 44, age);
  if (view.kind === 'ending') {
    drawV4Ui(surface, v4Ui, 'ui.prompt', cx - 56, 470, { alpha: 0.74 });
    surface.textAlign = 'center';
    uiFont(10, 600);
    surface.fillStyle = '#c2ced6';
    surface.fillText('SHOT / START', cx, 486);
  }
  surface.restore();
}

function drawScreenHeading(title: string, baseline: number): void {
  surface.textAlign = 'center';
  uiFont(20, 600);
  surface.fillStyle = '#e0eaf0';
  surface.fillText(title, FIELD_W / 2, baseline);
}

function drawMenuRows(
  entries: readonly string[],
  selected: number | undefined,
  x: number,
  y: number,
  width: number,
  step: number,
  age: number,
): void {
  entries.forEach((entry, index) => {
    const active = index === selected;
    const baseline = y + index * step;
    drawMenuRowFrame(x + 16, baseline, width - 16, Math.min(50, step - 6), active);
    if (active) {
      drawV4Ui(surface, v4Ui, 'ui.cursor', x, baseline - 16, {
        alpha: 0.95,
        rotation: (age % 120) * (Math.PI / 60),
      });
    }
    surface.textAlign = 'center';
    uiFont(12, active ? 600 : 400);
    surface.fillStyle = active ? '#e1ebf1' : '#697783';
    // Draw the source string verbatim: pack labels may be namespaced or Unicode.
    surface.fillText(entry, x + width / 2, baseline, width - 34);
  });
}

/** One generated row silhouette, modulated rather than replaced by selection. */
function drawMenuRowFrame(
  x: number,
  baselineY: number,
  width: number,
  height: number,
  active: boolean,
): void {
  drawV4Ui(surface, v4Ui, 'ui.menu.row', x, baselineY - height / 2 - 2, {
    width,
    height,
    alpha: active ? 0.78 : 0.2,
  });
}

function drawViewLines(
  lines: readonly string[],
  cx: number,
  startY: number,
  maxWidth: number,
  colour: string,
): number {
  surface.textAlign = 'center';
  uiFont(11, 400);
  surface.fillStyle = colour;
  let y = startY;
  for (const value of lines) {
    for (const row of wrapText(value, maxWidth)) {
      surface.fillText(row, cx, y);
      y += 17;
    }
  }
  return y;
}

/**
 * The results-card coin tally (战役扩容轮) — a gold and a silver coin with the
 * run's counts beside them, centred as one group under the score lines. The state
 * hands a `{ sprite, count }[]` across the boundary (`states.ts` never learns the
 * coins are drawn); the SHELL owns presentation, so it resolves each sprite name
 * against the pickup atlas here.
 *
 * The coin frame is selected from the result state's fixed-tick `age`.  A native
 * animated coin therefore remains animated after the finished Run beneath has
 * frozen, without a wall clock or `loop.count`.  The atlas always has a
 * procedural floor, so zero-pack and baked art use the same path.
 */
const TALLY_COIN_BOX = 16;
const TALLY_COIN_LABEL_GAP = 5;
const tallyCoinIcons = new Map<string, HTMLCanvasElement>();

/**
 * Cache one 16px result-card icon per tally strip. Baked art is copied as-is;
 * the white procedural/tinted floor receives the denomination colour here,
 * preserving a distinguishable zero-pack fallback without bypassing the atlas.
 */
function tallyCoinIcon(sprite: string, age: number): HTMLCanvasElement {
  const strip = pickupAtlas.strip(sprite);
  const frameIndex = stripFrame(strip, age);
  const key = `${sprite}:${frameIndex}`;
  const cached = tallyCoinIcons.get(key);
  if (cached !== undefined) return cached;

  const icon = document.createElement('canvas');
  icon.width = TALLY_COIN_BOX;
  icon.height = TALLY_COIN_BOX;
  const iconSurface = icon.getContext('2d');
  if (iconSurface === null) throw new Error('2D canvas unavailable for tally coin');
  iconSurface.imageSmoothingEnabled = false;

  const frame = pickupAtlas.frameOf(strip, frameIndex);
  const displayW = strip.displayW ?? strip.frameW;
  const displayH = strip.displayH ?? strip.frameH;
  const fit = Math.min(TALLY_COIN_BOX / displayW, TALLY_COIN_BOX / displayH);
  const drawW = displayW * fit;
  const drawH = displayH * fit;
  const drawX = (TALLY_COIN_BOX - drawW) / 2;
  const drawY = (TALLY_COIN_BOX - drawH) / 2;
  iconSurface.drawImage(
    pickupAtlas.texture.image as CanvasImageSource,
    frame.x,
    frame.y,
    frame.w,
    frame.h,
    drawX,
    drawY,
    drawW,
    drawH,
  );
  if (strip.color !== 'baked') {
    // Match SpriteBatch's RGB multiply rather than replacing the source colour:
    // a legal tinted pack may use greyscale shading as well as alpha shading.
    const [tr, tg, tb] = sprite.includes('gold') ? [230, 194, 74] : [198, 204, 214];
    const pixels = iconSurface.getImageData(0, 0, TALLY_COIN_BOX, TALLY_COIN_BOX);
    for (let i = 0; i < pixels.data.length; i += 4) {
      pixels.data[i] = Math.round((pixels.data[i] ?? 0) * tr / 255);
      pixels.data[i + 1] = Math.round((pixels.data[i + 1] ?? 0) * tg / 255);
      pixels.data[i + 2] = Math.round((pixels.data[i + 2] ?? 0) * tb / 255);
    }
    iconSurface.putImageData(pixels, 0, 0);
  }
  tallyCoinIcons.set(key, icon);
  return icon;
}

function drawCoinTally(
  tally: readonly { readonly sprite: string; readonly count: number }[],
  cx: number,
  baselineY: number,
  age: number,
): void {
  uiFont(12, 500);
  surface.textAlign = 'left';
  const iconW = TALLY_COIN_BOX + TALLY_COIN_LABEL_GAP;
  const gap = 18;
  const labels = tally.map((t) => `${t.count}`);
  const widths = tally.map((_, i) => iconW + surface.measureText(labels[i] ?? '').width);
  const total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, tally.length - 1);

  const centreY = baselineY - 4;
  let x = cx - total / 2;
  surface.save();
  surface.imageSmoothingEnabled = false;
  tally.forEach((entry, i) => {
    surface.drawImage(tallyCoinIcon(entry.sprite, age), x, centreY - TALLY_COIN_BOX / 2);
    surface.fillStyle = '#aab7c0';
    surface.fillText(labels[i] ?? '', x + iconW, baselineY);
    x += (widths[i] ?? 0) + gap;
  });
  surface.restore();
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
const DIALOG_PAD = 14;
const DIALOG_PORTRAIT_MAX = 112;
const DIALOG_PORTRAIT_INSET = 32;
const DIALOG_TEXT_INSET = 152;

/** Draw a close crop from the same Ghost actor art used on the field. */
function drawV4Portrait(
  speaker: string,
  characterName: string,
  x: number,
  y: number,
  size: number,
): boolean {
  const player = speaker === 'player' ? V4_PLAYER_ACTORS[characterName] : undefined;
  const boss = V4_BOSS_ACTORS[speaker];
  const actor = player ?? boss;
  const portrait = v4PortraitSpec(speaker, characterName);
  if (actor === undefined || portrait === undefined) return false;

  const atlas = player === undefined ? v4Actors.bosses : v4Actors.players;
  const frame = atlas.frameOf(atlas.strip(actor.strip), portrait.pose);
  // Each built-in woman owns a close framing anchor. Players use their neutral
  // pose; bosses use the authored cast gesture, so the portrait well carries
  // the face, heart and hands rather than a near-full-body thumbnail.
  const source = v4PortraitSource(frame, portrait);
  surface.save();
  surface.imageSmoothingEnabled = false;
  surface.drawImage(
    atlas.texture.image as CanvasImageSource,
    source.x,
    source.y,
    source.w,
    source.h,
    x,
    y,
    size,
    size,
  );
  surface.restore();
  return true;
}

function drawDialogue(
  line: { speaker: string; text: string; index: number; count: number },
  tickCount: number,
  characterName: string,
): void {
  // The layout contract owns the full composition; do not shadow it with a
  // second set of coincident constants in the shell.
  const { x: boxX, y: boxY, w: boxW, h: boxH } = V4_UI_SCREEN.dialogue;
  const playerIdentity = line.speaker === 'player'
    ? V4_CHARACTER_UI[characterName as keyof typeof V4_CHARACTER_UI]
    : undefined;
  const seeded = tintFor(line.speaker);
  const tint = playerIdentity === undefined
    ? seeded
    : { r: playerIdentity.rgb[0] / 255, g: playerIdentity.rgb[1] / 255, b: playerIdentity.rgb[2] / 255 };
  const speakerLabel = line.speaker === 'player'
    ? getCharacter(characterName).label
    : line.speaker;

  const portraitSize = Math.min(DIALOG_PORTRAIT_MAX, boxH - DIALOG_PAD * 2);
  const pX = boxX + DIALOG_PORTRAIT_INSET;
  const pY = boxY + (boxH - portraitSize) / 2;
  const pCx = pX + portraitSize / 2;
  const pCy = pY + portraitSize / 2;
  const textX = boxX + DIALOG_TEXT_INSET;

  // Match the frame's round portrait well and rectangular copy well instead of
  // restoring a full-width generic panel. This local wash keeps live bullets as
  // atmosphere without letting them break the dialogue's reading order.
  surface.save();
  surface.fillStyle = 'rgba(4, 7, 12, 0.84)';
  surface.beginPath();
  surface.arc(pCx, pCy, portraitSize / 2 + 8, 0, Math.PI * 2);
  surface.rect(textX - 16, boxY + 18, boxX + boxW - textX, boxH - 36);
  surface.fill();
  surface.restore();

  drawV4Ui(surface, v4Ui, 'ui.dialogue.frame', boxX, boxY, {
    width: boxW,
    height: boxH,
    alpha: 0.94,
  });

  // The production frame owns a circular portrait well.  Clip both built-in
  // actor crops and third-party fallbacks through the same geometry so a guest
  // character cannot silently fall back to the old square-card language.
  surface.save();
  surface.beginPath();
  surface.arc(pCx, pCy, portraitSize / 2, 0, Math.PI * 2);
  surface.clip();
  if (!drawV4Portrait(line.speaker, characterName, pX, pY, portraitSize)) {
    surface.drawImage(portraitImage(line.speaker), pX, pY, portraitSize, portraitSize);
  }
  surface.restore();
  // Speaking-side highlight: the portrait's rim in its own tint.
  surface.save();
  surface.strokeStyle = `rgba(${Math.round(tint.r * 200)},${Math.round(tint.g * 200)},${Math.round(tint.b * 210)},0.75)`;
  surface.lineWidth = 1;
  surface.beginPath();
  surface.arc(pCx, pCy, portraitSize / 2 - 0.5, 0, Math.PI * 2);
  surface.stroke();
  surface.restore();
  if (playerIdentity !== undefined) {
    drawV4Ui(surface, v4Ui, playerIdentity.crest, pX - 7, pY - 7, { width: 30, height: 30 });
  }

  const textW = boxX + boxW - DIALOG_PAD - textX;
  surface.textAlign = 'left';

  // Name plate: tinted and bright, the speaking side's cue.
  drawV4Ui(surface, v4Ui, 'ui.nameplate', textX - 7, boxY + 5, {
    width: Math.min(248, textW + 7),
    height: 28,
    alpha: 0.72,
  });
  uiFont(12, 600);
  surface.fillStyle = `rgb(${Math.round(tint.r * 220)},${Math.round(tint.g * 220)},${Math.round(tint.b * 230)})`;
  surface.fillText(speakerLabel, textX, boxY + DIALOG_PAD + 12);

  // Body: wrapped to the panel width, HUD-primary luminance.
  uiFont(12, 400);
  surface.fillStyle = '#9a9aa4';
  let lineY = boxY + DIALOG_PAD + 34;
  for (const row of wrapText(line.text, textW)) {
    surface.fillText(row, textX, lineY);
    lineY += 16;
  }

  // Line counter: dimmest register, low-right, like the HUD diagnostics.
  surface.fillStyle = '#66737e';
  surface.textAlign = 'right';
  surface.fillText(`${line.index + 1} / ${line.count}`, boxX + boxW - DIALOG_PAD, boxY + boxH - DIALOG_PAD);

  // Advance hint: the genre's small blinking marker, pulsed on the tick clock so
  // it is identical on replay. Shown for two-thirds of each second.
  if (Math.floor(tickCount / 20) % 3 !== 2) {
    surface.fillText('▸ SHOT', boxX + boxW - DIALOG_PAD, boxY + DIALOG_PAD + 8);
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
