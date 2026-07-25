/**
 * The browser shell: input in, pixels out, and nothing else.
 *
 * All game logic lives under `src/game/`, which imports no three.js. That split
 * is not tidiness — it is what lets a whole run be simulated and replayed
 * headlessly, which is the only way the determinism contract can be checked at
 * all. Anything added here that decides something belongs in `Run` instead.
 */

// Production registers the generated, content-addressed offline shell. This
// import is presentation-only and is compiled away from the development path.
import {
  activateWaitingPwaUpdate,
  holdPwaUpdateWhile,
} from './pwa';
import { GAME_VERSION_LABEL } from './version';

// The compiled v4 edition installs its deterministic patterns and behaviours,
// byte-pinned shaders, and four-stage campaign in dependency order. Arbitrary
// asset packs remain data-only and load afterward.
import { CONTENT_FINGERPRINT, V4_ENDINGS } from './v4';

import * as THREE from 'three';
import { Audio, overrideSound, soundNames } from './audio';
import { Music, musicNames } from './audio/music';
import { AudioOutput, type AudioCaptureLease } from './audio/output';
import { MENU_MUSIC, V4_BOSS_MUSIC_NAMES, v4EventSound } from './v4/audio';
import { Button, Input } from './core/input';
import {
  MenuPointerInput,
  PointerPositionInput,
} from './core/pointer-input';
import { TouchInput } from './core/touch-input';
import {
  XboxWebHidInput,
  browserWebHid,
  type XboxWebHidStatus,
} from './core/xbox-webhid';
import { Loop } from './core/loop';
import {
  ReplayExportState,
  TitleState,
  replayExportPresentationAdvances,
  type GameContext,
} from './game/states';
import { StateMachine, type StateView } from './game/state';
import {
  EVENT_SOUNDS,
  resolveMusicTransition,
  shouldPlayRunEventSound,
} from './game/cues';
import type { Replay } from './sim/replay';
import {
  IndexedDbReplaySessionStore,
  loadReplayLibraryWithFallback,
  MemoryReplaySessionStore,
  ReplayLibrary,
  ReplaySessionPersistenceError,
} from './replay/library';
import type { ReplaySession } from './replay/session';
import { FIELD, type Run } from './game/run';
import { loadPacks } from './packs/loader';
import { Background, loadBackgroundArtAssets } from './render/background';
import {
  ACTOR_PAD_RENDER_ORDER,
  createActorPadAtlas,
} from './render/actor-pad';
import {
  bulletAtlas as makeBulletAtlas,
  shipAtlas as makeShipAtlas,
  effectAtlas as makeEffectAtlas,
  laserAtlas as makeLaserAtlas,
  missileAtlas as makeMissileAtlas,
  pickupAtlas as makePickupAtlas,
} from './render/procedural';
import { getItemSpec, itemNames } from './sim/item';
import { getLaserSkin, laserSkinNames } from './render/laser-skin';
import type { Atlas } from './render/atlas';
import { PostProcessing } from './render/post';
import {
  stepBossCastFx,
  type BossCastFx,
} from './render/boss-cast-fx';
import {
  stepBossIdentityFx,
  type BossIdentityFx,
} from './render/boss-identity-fx';
import { SpriteBatch } from './render/sprite-batch';
import { Layer, Stage } from './render/stage';
import {
  FrameCapture,
  isScreenshotShortcut,
  screenshotFilename,
} from './render/capture';
import {
  ReplayVideoCapture,
  unexpectedVideoCaptureEndError,
} from './render/video-capture';
import {
  V4_BOSS_ACTORS,
  loadV4ActorAtlases,
  v4BossPhaseCastStrip,
} from './render/v4-actors';
import { V4StageStructure } from './v4/backgrounds/structure';
import {
  v4EndingMix,
  type V4EndingMix,
} from './v4/ending/presentation';
import { EndingTraceRecorder } from './v4/ending/trace';
import { loadV4UiAtlas } from './render/v4-ui';
import {
  downloadBlob,
  downloadReplayFile,
  videoFilename,
} from './shell/downloads';
import {
  hasConnectedStandardController,
  installControllerConnect,
  presentControllerStatus,
} from './shell/controller-chrome';
import {
  hideMenuClickTargets as hideMenuClickTargetsInChrome,
  layoutMenuClickTargets as layoutMenuClickTargetsInChrome,
  stopControllerActivationKey,
  stopTouchButtonActivationKey,
  type MenuActionChrome,
  type MenuActionLayout,
} from './shell/menu-actions';
import {
  createOverlayView,
  type OverlayGrazePulse,
} from './shell/overlay-view';
import { createRunView } from './shell/run-view';
import {
  installStageFit,
  installTouchControlReveal,
} from './shell/stage-fit';
import {
  installTouchControlActivity,
  installTouchResetLifecycle,
  installTouchStickVisual,
  resetTouchControlActivity,
  resetTouchStickVisual,
} from './shell/touch-chrome';

// The sim's field constant, not a local copy: the whole screen is the play
// field now (3:4, HUD composited over it), so the shell and the sim must mean
// the same thing by "the frame" — see the comment on `FIELD` in game/run.ts.
const FIELD_W = FIELD.width;
const FIELD_H = FIELD.height;

const gameShell = document.getElementById('game-shell') as HTMLElement;
const stageSlot = document.getElementById('stage-slot') as HTMLDivElement;
const stageElement = document.getElementById('stage') as HTMLDivElement;
const field = document.getElementById('field') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLCanvasElement;
const surface = overlay.getContext('2d')!;
const touchControls = document.getElementById('touch-controls') as HTMLDivElement;
const touchStick = document.getElementById('touch-stick') as HTMLDivElement;
const touchA = document.getElementById('touch-a') as HTMLButtonElement;
const touchB = document.getElementById('touch-b') as HTMLButtonElement;
const touchStart = document.getElementById('touch-start') as HTMLButtonElement;
const menuActions = document.getElementById('menu-actions') as HTMLDivElement;
const controllerSetup = document.getElementById('controller-setup') as HTMLDivElement;
const controllerConnect = document.getElementById('controller-connect') as HTMLButtonElement;
const controllerStatusOutput = document.getElementById('controller-status') as HTMLOutputElement;
const shellStatus = document.getElementById('shell-status') as HTMLOutputElement;
const replayImportInput = document.getElementById('replay-import') as HTMLInputElement;
/** Production keeps diagnostics and the Bloom control out of the authored UI. */
const SEARCH = new URLSearchParams(location.search);
const DEBUG_UI = SEARCH.get('debug') === '1';

const stage = new Stage({ canvas: field, width: FIELD_W, height: FIELD_H });
const captureCanvas = document.createElement('canvas');
captureCanvas.width = FIELD_W;
captureCanvas.height = FIELD_H;
const frameCapture = new FrameCapture(captureCanvas);

const fitStage = installStageFit(stageSlot, stageElement, FIELD_W, FIELD_H);

let touchControlsEnabled = false;

function enableTouchControls(): void {
  if (touchControlsEnabled) return;
  touchControlsEnabled = true;
  gameShell.classList.add('touch-controls-enabled');
  touchControls.hidden = false;
  fitStage();
}

let touchRevealPending = false;
installTouchControlReveal({
  enabled: () => touchControlsEnabled,
  pending: () => touchRevealPending,
  setPending: (pending) => {
    touchRevealPending = pending;
  },
  enable: enableTouchControls,
});

if (
  SEARCH.get('touch') === '1'
  || matchMedia('(pointer: coarse)').matches
) {
  enableTouchControls();
} else {
  fitStage();
}

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
 * The music bus ceiling, and the ducked ceiling while the game is paused.
 *
 * `MUSIC_LEVEL` sits well under the SFX table (shots at ~0.3 after their own
 * gains) so the theme never competes with a bullet's cue — the readability rule
 * with an audio face. Pausing ducks the theme rather than cutting it: the room
 * is still there, just quieter. The duck is an instant set on the music bus and
 * touches no SFX voice, which is why music owns a separate master bus on the
 * shared audio context.
 */
const MUSIC_LEVEL = 0.55;
const MUSIC_PAUSE_LEVEL = 0.22;

/**
 * `drift` is the shell's own scene, not any stage's: it is what the title
 * screen sits on, and what a run with no declared background leaves in place.
 * Stages name their own (`expanse`, `undertow`) and the tick loop reconciles.
 */
// V4's optional painted plates are decoded before the first fixed tick. Image
// completion is wall-clock state; allowing a plate to arrive mid-stage would
// make the same replay visibly switch layers on a different tick on a slower
// device. The owner lives for the page and compiled scenes only borrow from it.
const backgroundArtAssets = await loadBackgroundArtAssets();
const background = new Background(stage, 'drift', { artAssets: backgroundArtAssets });
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

let shellStatusTimer: number | undefined;

function showShellStatus(
  message: string,
  tone: 'info' | 'error' = 'info',
  hideAfterMs = 4200,
): void {
  if (shellStatusTimer !== undefined) window.clearTimeout(shellStatusTimer);
  shellStatus.textContent = message;
  shellStatus.dataset.tone = tone;
  shellStatus.hidden = false;
  shellStatusTimer = undefined;
  if (hideAfterMs > 0) {
    shellStatusTimer = window.setTimeout(() => {
      shellStatus.hidden = true;
      shellStatusTimer = undefined;
    }, hideAfterMs);
  }
}

let replayLibrary: ReplayLibrary;
if (typeof indexedDB === 'undefined') {
  replayLibrary = new ReplayLibrary(new MemoryReplaySessionStore());
  await replayLibrary.load();
  showShellStatus('REPLAYS WILL LAST FOR THIS PAGE ONLY', 'error');
} else {
  const loaded = await loadReplayLibraryWithFallback(
    new IndexedDbReplaySessionStore(indexedDB),
    new MemoryReplaySessionStore(),
  );
  replayLibrary = loaded.library;
  if (loaded.degraded) {
    console.warn('replay library: persistent storage unavailable', loaded.error);
    showShellStatus('REPLAYS WILL LAST FOR THIS PAGE ONLY', 'error');
  }
}

function downloadReplay(session: ReplaySession): void {
  downloadReplayFile(session);
  showShellStatus('REPLAY DOWNLOAD READY');
}

function openReplayImport(): void {
  // Re-selecting the same file must still produce a `change` event.
  replayImportInput.value = '';
  replayImportInput.click();
}

// Apply any sounds a pack replaced, BEFORE the first user-gesture unlock.
// `Audio.unlock` pre-renders every registered sound's buffer (see
// `audio/index.ts` `#start`), so a url swapped in after that first unlock would
// never be decoded. This runs at module top level, before the input shell is
// attached, which is what guarantees the ordering. `overrideSound` preserves
// any mix fields a legacy string entry omitted, while object entries can tune
// them.
for (const [name, spec] of Object.entries(packs.soundSpecs)) {
  overrideSound(name, spec);
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

// Actor textures now come from the selected pack as self-describing sheets.
// v4 supplies all four families (field players/enemies/Bosses plus dialogue
// close-ups); a different/no pack leaves them absent and the ordinary
// ship/bullet/actor-crop draw paths remain the permanent floor.
const v4Actors = await loadV4ActorAtlases(packs.actors);
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
  const filteredAtlases: Atlas[] = [bulletAtlas, shipAtlas];
  for (const actorAtlas of [
    v4Actors.players,
    v4Actors.enemies,
    v4Actors.bosses,
    v4Actors.portraits,
  ]) {
    if (actorAtlas !== undefined) filteredAtlases.push(actorAtlas);
  }
  for (const atlas of filteredAtlases) {
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
  actorEnemies: new SpriteBatch(v4Actors.enemies ?? bulletAtlas, { capacity: 256, renderOrder: Layer.Enemies + 1 }),
  actorBosses: new SpriteBatch(v4Actors.bosses ?? bulletAtlas, { capacity: 8, renderOrder: Layer.Enemies + 2 }),
  items: new SpriteBatch(bulletAtlas, { capacity: 512, renderOrder: Layer.Items }),
  actorPlayerPads: new SpriteBatch(actorPadAtlas, {
    capacity: 4,
    renderOrder: ACTOR_PAD_RENDER_ORDER.player,
  }),
  player: new SpriteBatch(shipAtlas, { capacity: 8, renderOrder: Layer.Player }),
  actorPlayer: new SpriteBatch(v4Actors.players ?? shipAtlas, { capacity: 4, renderOrder: Layer.Player + 2 }),
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

/**
 * V4's ending removes already-frozen render layers in three authored passes.
 *
 * This grouping is presentation-only: no Run collection is filtered or
 * mutated. Every batch is reset to identity before a frame, then receives the
 * page's fixed-tick multiplier while an ending view is present.
 */
const ENDING_BATCH_GROUPS = {
  enemies: [
    'actorEnemyPads',
    'enemies',
    'actorEnemies',
    'actorBosses',
    'bossBodyFx',
  ],
  player: [
    'actorPlayerPads',
    'player',
    'actorPlayer',
    'options',
    'optionsFx',
    'playerFx',
  ],
  projectiles: [
    'playerShots',
    'enemyShots',
    'enemyShotsAdditive',
    'missiles',
    'beamBodies',
    'beamCaps',
  ],
  pickups: [
    'itemGlow',
    'items',
    'pickups',
  ],
  effects: [
    'effects',
    'bursts',
    'burstsBack',
    'bombFx',
    'bossDeathFx',
  ],
} as const satisfies Readonly<
  Record<
    Exclude<keyof V4EndingMix, 'trace' | 'art'>,
    readonly (keyof typeof batches)[]
  >
>;

function setEndingBatchMix(mix: V4EndingMix | undefined): void {
  for (const batch of Object.values(batches)) batch.setOpacity(1);
  if (mix === undefined) return;

  const setGroup = (
    names: readonly (keyof typeof batches)[],
    opacity: number,
  ): void => {
    for (const name of names) batches[name].setOpacity(opacity);
  };

  setGroup(ENDING_BATCH_GROUPS.enemies, mix.enemies);
  setGroup(ENDING_BATCH_GROUPS.player, mix.player);
  setGroup(ENDING_BATCH_GROUPS.projectiles, mix.projectiles);
  setGroup(ENDING_BATCH_GROUPS.pickups, mix.pickups);
  setGroup(ENDING_BATCH_GROUPS.effects, mix.effects);
}

function endingMixFromViews(views: readonly StateView[]): V4EndingMix | undefined {
  for (let index = views.length - 1; index >= 0; index--) {
    const view = views[index];
    if (view?.kind === 'ending' && view.endingPage !== undefined) {
      return v4EndingMix(view.endingPage);
    }
  }
  return undefined;
}

/** Actual fixed-tick stage-4 movement, retained outside simulation and replay. */
const endingTraceByRun = new WeakMap<Run, EndingTraceRecorder>();

function endingTraceRecorder(run: Run): EndingTraceRecorder {
  const existing = endingTraceByRun.get(run);
  if (existing !== undefined) return existing;
  const recorder = new EndingTraceRecorder();
  endingTraceByRun.set(run, recorder);
  return recorder;
}

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

const audioOutput = new AudioOutput();
const audio = new Audio({ output: audioOutput });
// Independent SFX/music buses share one output context. The separate master
// gains preserve pause ducking, while `audioOutput.capture()` can route both
// buses into one already-mixed track for replay video.
const music = new Music({ output: audioOutput, masterVolume: MUSIC_LEVEL });
const machine = new StateMachine();
const webHid = browserWebHid();
let directControllerStatus: XboxWebHidStatus = { phase: 'idle' };

/**
 * The chooser is shell UI rather than a game state: WebHID requires a real
 * click, while game menus intentionally consume only the tick-sampled mask.
 */
function syncControllerPanel(): void {
  if (webHid === undefined || hasConnectedStandardController()) {
    controllerSetup.hidden = true;
    return;
  }

  const { phase } = directControllerStatus;
  const onTitle = machine.current?.name === 'title';
  const visiblePhase = phase !== 'waiting' && phase !== 'ready';
  // Never cover a live bullet field. A disconnect or error waits unobtrusively
  // until the player returns to the title screen.
  controllerSetup.hidden = !(onTitle && visiblePhase);
}

function showControllerStatus(status: XboxWebHidStatus): void {
  directControllerStatus = status;
  presentControllerStatus(status, {
    setup: controllerSetup,
    connect: controllerConnect,
    status: controllerStatusOutput,
  });
  if (status.phase === 'error') {
    console.warn('controller: WebHID fallback failed', status.error);
  }
  syncControllerPanel();
}

const directController = webHid === undefined
  ? undefined
  : new XboxWebHidInput(webHid, showControllerStatus);
const pointerPositionInput = new PointerPositionInput(FIELD_W, FIELD_H);
const menuPointerInput = new MenuPointerInput();

/**
 * Start WebAudio from every browser gesture that may carry user activation.
 *
 * A virtual-stick drag is not guaranteed to produce `click`, and WebKit builds
 * disagree over whether the down or up half authorises WebAudio. The output's
 * synchronous gesture path therefore pokes both halves and permits a later
 * event to retry even while an earlier `resume()` is still pending. Capture
 * listeners run before TouchInput prevents defaults for control hygiene.
 */
function unlockAudioFromUserActivation(): void {
  audioOutput.activateFromGesture();
  void audioOutput.unlock();
  void audio.unlock();
  void music.unlock().then(() => music.preload(V4_BOSS_MUSIC_NAMES));
}
window.addEventListener('pointerdown', unlockAudioFromUserActivation, {
  capture: true,
});
window.addEventListener('pointerup', unlockAudioFromUserActivation, {
  capture: true,
});
window.addEventListener('touchstart', unlockAudioFromUserActivation, {
  capture: true,
  passive: true,
});
window.addEventListener('touchend', unlockAudioFromUserActivation, {
  capture: true,
  passive: true,
});
window.addEventListener('mousedown', unlockAudioFromUserActivation, {
  capture: true,
});
window.addEventListener('click', unlockAudioFromUserActivation, {
  capture: true,
});
window.addEventListener('keydown', unlockAudioFromUserActivation, {
  capture: true,
});

/**
 * iOS may suspend an installed PWA's audio context while it is backgrounded.
 * Page lifecycle events carry no user activation, so they only revalidate an
 * already-created context. If WebKit leaves that attempt pending, the next
 * real gesture above still starts an independent resume + wake-source poke.
 */
function resumeAudioAfterPageRestore(): void {
  if (document.hidden) return;
  void audioOutput.resumeIfStarted();
}
window.addEventListener('pageshow', resumeAudioAfterPageRestore);
document.addEventListener('visibilitychange', resumeAudioAfterPageRestore);

const touchInput = new TouchInput(window);
touchInput.attachStick(touchStick);
touchInput.attachAction(touchA, Button.Shot);
touchInput.attachAction(touchB, Button.Bomb);
touchInput.attachAction(touchStart, Button.Start);

/*
 * Touch chrome stays fully legible while idle, then yields visual priority to
 * the play field while any real pointer is operating one of its four controls.
 * Pointer and legacy Touch Events are tracked independently because older
 * iPhones may emit either stream (or both); neither count reaches game state.
 */
const touchControlPointers = new Map<number, string>();
const touchControlTouches = new Set<number>();
const touchActivityState = {
  pointers: touchControlPointers,
  touches: touchControlTouches,
};
installTouchControlActivity(touchControls, touchActivityState);

/*
 * The thumb follows continuous browser coordinates for presentation only.
 * `TouchInput` independently quantizes the same gesture into eight digital
 * sectors before the fixed tick samples it (CLAUDE.md, rule 4); these CSS
 * offsets never enter game state, replay data, or simulation math.
 */
const stickVisualPointerIds = new Set<number>();
const stickVisualTouchIds = new Set<number>();
const touchStickVisualState = {
  pointerIds: stickVisualPointerIds,
  touchIds: stickVisualTouchIds,
};
installTouchStickVisual(touchStick, touchStickVisualState);
installTouchResetLifecycle(stageElement, {
  pointerPositionInput,
  touchInput,
  resetChrome: () => {
    resetTouchControlActivity(touchControls, touchActivityState);
    resetTouchStickVisual(touchStick, touchStickVisualState);
  },
});
const input = new Input([
  pointerPositionInput,
  menuPointerInput,
  touchInput,
  ...(directController === undefined ? [] : [directController]),
]);
input.attach();

touchControls.addEventListener('contextmenu', (event) => {
  event.preventDefault();
});

if (directController !== undefined) {
  installControllerConnect(controllerConnect, {
    controller: directController,
    unlockAudio: () => {
      void audio.unlock();
      void music.unlock().then(() => music.preload(V4_BOSS_MUSIC_NAMES));
    },
  });
}
controllerConnect.addEventListener('keydown', stopControllerActivationKey);
controllerConnect.addEventListener('keyup', stopControllerActivationKey);
for (const button of [touchA, touchB, touchStart]) {
  button.addEventListener('keydown', stopTouchButtonActivationKey);
  button.addEventListener('keyup', stopTouchButtonActivationKey);
}

const menuActionButtons: HTMLButtonElement[] = [];
const menuActionChrome: MenuActionChrome = {
  container: menuActions,
  buttons: menuActionButtons,
  currentState: () => machine.current?.name,
  openReplayImport,
  queueSelection: (selected, target, count) => {
    menuPointerInput.queueSelection(selected, target, count);
  },
  unlockAudio: () => {
    void audio.unlock();
    void music.unlock().then(() => music.preload(V4_BOSS_MUSIC_NAMES));
  },
};

function hideMenuClickTargets(): void {
  hideMenuClickTargetsInChrome(menuActionChrome);
}

function layoutMenuClickTargets(
  layout: MenuActionLayout,
): void {
  layoutMenuClickTargetsInChrome(menuActionChrome, layout);
}

/**
 * The bloom toggle listens here rather than joining `Input`.
 *
 * A replay is a frame-indexed log of the button mask and nothing else
 * (CLAUDE.md, rule 4). A display setting that entered that mask would be
 * recorded into replays and would make how the game looked part of what the
 * game did. `KeyB` is deliberately absent from `input.ts`'s `KEY_MAP`, so this
 * and the simulation cannot collide.
 */
let screenshotPending = false;

function requestScreenshot(): void {
  screenshotPending = true;
}

window.addEventListener('keydown', (e) => {
  if (isScreenshotShortcut(e)) {
    e.preventDefault();
    requestScreenshot();
    return;
  }

  const view = machine.current?.view?.();
  const action = view?.menuActions?.[view.selected ?? -1];
  const directConfirm = (
    !e.repeat
    && !e.altKey
    && !e.ctrlKey
    && !e.metaKey
    && (e.code === 'KeyZ' || e.code === 'Space')
  );
  if (action === 'import-replay' && directConfirm) {
    // Capture phase outranks the focused transparent menu button and Input's
    // ordinary key listener, preserving this keydown's browser activation.
    e.preventDefault();
    e.stopImmediatePropagation();
    openReplayImport();
    return;
  }

  if (!DEBUG_UI || e.code !== 'KeyB' || e.repeat) return;
  post.enabled = !post.enabled;
}, { capture: true });

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
  // Edition narrative crosses into the generic state machine as plain data,
  // keyed by the exact terminal stage. A namespaced guest finale is absent and
  // therefore reaches the neutral ALL CLEAR card without inheriting v4's voice.
  campaignEndings: V4_ENDINGS,
  campaigns: packs.campaigns,
  // The pack characters this build registered, each with its owning pack's
  // identity — the character path's mirror of `campaigns`. `CharacterSelectState`
  // arms strict `packsData` from it when a pack ship is flown off the plain START
  // row, where no campaign armed it. Same plain-data crossing as `campaigns`.
  characterPacks: packs.characterPacks,
  replaySessions: replayLibrary.sessions,
  beginReplaySession: () => replayLibrary.begin(),
  onReplay(replay, sessionId) {
    (globalThis as { __lastReplay?: Replay }).__lastReplay = replay;
    const id = sessionId ?? replayLibrary.begin();
    const endReason = replay.meta?.['endReason'];
    const savedLabel = endReason === 'retry'
      ? 'PARTIAL REPLAY SAVED · RETRIED'
      : endReason === 'quit'
        ? 'PARTIAL REPLAY SAVED · QUIT'
        : 'REPLAY SAVED';
    const pageOnlyLabel = endReason === 'retry'
      ? 'PARTIAL REPLAY SAVED FOR THIS PAGE ONLY · RETRIED'
      : endReason === 'quit'
        ? 'PARTIAL REPLAY SAVED FOR THIS PAGE ONLY · QUIT'
        : 'REPLAY SAVED FOR THIS PAGE ONLY';
    const saved = holdPwaUpdateWhile(
      replayLibrary.append(id, replay),
      { retainOnFailure: true },
    );
    // `append` updates memory before its first await, so result screens can
    // immediately resolve WATCH/DOWNLOAD even when IndexedDB is still writing.
    context.replaySessions = replayLibrary.sessions;
    void saved.then(() => {
      context.replaySessions = replayLibrary.sessions;
      // Retry has already entered a new run, and a delayed bottom toast would
      // cover the player. Its pause row said SAVE + RETRY; only failures need to
      // interrupt the fresh attempt. Likewise, do not surface a late stage-clear
      // success after the player has already advanced.
      if (endReason !== 'retry' && machine.current?.name !== 'playing') {
        showShellStatus(savedLabel);
      }
    }).catch((error) => {
      console.warn('replay library: failed to persist recording', error);
      showShellStatus(pageOnlyLabel, 'error');
    });
  },
  onImportReplay: () => {
    showShellStatus('USE Z / SPACE OR CLICK IMPORT TO CHOOSE A FILE');
  },
  onDownloadReplay: downloadReplay,
  onDeleteReplaySession: (session) => {
    const deleted = holdPwaUpdateWhile(replayLibrary.remove(session.id));
    // `remove` updates memory before its first await, so the library screen
    // reflects the approved action immediately.
    context.replaySessions = replayLibrary.sessions;
    void deleted.then((removed) => {
      context.replaySessions = replayLibrary.sessions;
      showShellStatus(removed ? 'REPLAY DELETED' : 'REPLAY WAS ALREADY DELETED');
    }).catch((error) => {
      // The library restores the session when IndexedDB refuses the deletion.
      context.replaySessions = replayLibrary.sessions;
      console.warn('replay library: failed to delete session', error);
      showShellStatus('DELETE FAILED · SESSION KEPT', 'error');
    });
  },
  onReplayError: (message) => showShellStatus(message.toUpperCase(), 'error'),
  onScreenshot: requestScreenshot,
};

replayImportInput.addEventListener('change', () => {
  const file = replayImportInput.files?.[0];
  if (file === undefined) return;

  void file.text().then(
    (text) => holdPwaUpdateWhile(
      replayLibrary.import(text),
      {
        retainOnFailure: (error) => (
          error instanceof ReplaySessionPersistenceError
        ),
      },
    ),
  ).then(() => {
    context.replaySessions = replayLibrary.sessions;
    showShellStatus('REPLAY IMPORTED');
  }).catch((error) => {
    context.replaySessions = replayLibrary.sessions;
    if (error instanceof ReplaySessionPersistenceError) {
      console.warn('replay library: imported for this page only', error.cause);
      showShellStatus('REPLAY IMPORTED FOR THIS PAGE ONLY', 'error');
    } else {
      console.warn('replay library: import failed', error);
      showShellStatus(`IMPORT FAILED · ${(error as Error).message}`.toUpperCase(), 'error');
    }
  }).finally(() => {
    replayImportInput.value = '';
  });
});

machine.push(new TitleState(context));
if (directController === undefined) {
  syncControllerPanel();
} else {
  void directController.start();
}

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
/** A URL-backed boss track retains its short arrival fade while it decodes. */
let pendingBossMusic: string | undefined;

/**
 * Presentation reaction to the existing `graze` RunEvent.  No collision query,
 * distance check or inferred near-miss lives here; if the simulation did not
 * emit the event, the UI cannot invent one.
 */
const grazeUiPulses: OverlayGrazePulse[] = [];
const GRAZE_UI_TICKS = 16;

const bossIdentityFx: BossIdentityFx<Run>[] = [];
const bossCastFx: BossCastFx<Run>[] = [];

const REPLAY_EXPORT_TAIL_MS = 1000;

interface ActiveReplayExport {
  readonly state: ReplayExportState;
  ready: boolean;
  tailStartedAt?: number;
  stopping: boolean;
  disposed: boolean;
  audioLease?: AudioCaptureLease;
  video?: ReplayVideoCapture;
}

let activeReplayExport: ActiveReplayExport | undefined;

function replayExportError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(`video export: ${String(error)}`);
}

function disposeReplayExport(active: ActiveReplayExport): void {
  if (activeReplayExport === active) activeReplayExport = undefined;
  if (active.disposed) return;
  active.disposed = true;
  const cancellation = active.video?.cancel();
  active.audioLease?.release();
  if (cancellation !== undefined) void cancellation;
}

function failReplayExport(active: ActiveReplayExport, error: unknown): void {
  const message = replayExportError(error).message;
  const stillCurrent = machine.current === active.state;
  disposeReplayExport(active);
  if (stillCurrent) active.state.fail(message);
}

async function preloadReplayExportAudio(): Promise<void> {
  await Promise.all([audioOutput.unlock(), audio.unlock(), music.unlock()]);
  if (!audio.unlocked || !music.unlocked || !audioOutput.unlocked) {
    throw new Error('video export: audio output could not be unlocked');
  }
  await Promise.all([
    audio.preload(soundNames()),
    music.preload(musicNames()),
  ]);
}

function prepareReplayExport(state: ReplayExportState): void {
  const active: ActiveReplayExport = {
    state,
    ready: false,
    stopping: false,
    disposed: false,
  };
  activeReplayExport = active;
  showShellStatus('PREPARING VIDEO · LOADING AUDIO', 'info', 0);

  void preloadReplayExportAudio().then(() => {
    if (
      activeReplayExport !== active
      || machine.current !== state
      || state.phase !== 'preparing'
    ) {
      return;
    }
    active.ready = true;
  }).catch((error) => failReplayExport(active, error));
}

function startReplayExportRecording(active: ActiveReplayExport): void {
  if (
    activeReplayExport !== active
    || machine.current !== active.state
    || active.state.phase !== 'preparing'
    || !active.ready
  ) {
    return;
  }

  // Remove every pre-export menu cue and theme before opening the mixed route.
  // The replay's own declarations restart through the ordinary reconciliation
  // path on its first armed fixed tick.
  audio.stopAll();
  music.stopAll();

  const audioLease = audioOutput.capture();
  if (audioLease === undefined) {
    failReplayExport(
      active,
      new Error('video export: mixed audio capture is unavailable'),
    );
    return;
  }
  active.audioLease = audioLease;

  const video = new ReplayVideoCapture(frameCapture, {
    audioStream: audioLease.stream,
    requireAudio: true,
  });
  active.video = video;
  void video.completion.then((outcome) => {
    if (activeReplayExport !== active || active.stopping) return;
    failReplayExport(active, unexpectedVideoCaptureEndError(outcome));
  });

  if (!video.start()) return;
  // `captureStream()` created its track inside `start()`, so repaint the same
  // already-composed tick-zero frame after track creation. Without this paint,
  // the canvas track is allowed to begin on the following replay tick.
  frameCapture.compose(field, overlay);
  if (!active.state.arm()) {
    disposeReplayExport(active);
    return;
  }
  showShellStatus('RECORDING VIDEO · START / BOMB TO CANCEL', 'info', 0);
}

function stopReplayExport(active: ActiveReplayExport): void {
  if (
    active.stopping
    || activeReplayExport !== active
    || machine.current !== active.state
  ) {
    return;
  }
  const video = active.video;
  if (video === undefined) {
    failReplayExport(active, new Error('video export: recorder was not started'));
    return;
  }

  active.stopping = true;
  showShellStatus('FINALIZING VIDEO', 'info', 0);
  void video.stop().then((outcome) => {
    active.audioLease?.release();
    active.disposed = true;
    if (
      activeReplayExport !== active
      || machine.current !== active.state
    ) {
      return;
    }
    activeReplayExport = undefined;

    if (outcome.status === 'recorded') {
      const filename = videoFilename(active.state, outcome.extension);
      downloadBlob(outcome.blob, filename);
      if (active.state.complete(filename)) {
        showShellStatus('VIDEO DOWNLOAD READY');
      }
      return;
    }

    active.state.fail(
      outcome.status === 'failed'
        ? outcome.error.message
        : 'video export: recording was cancelled',
    );
  }).catch((error) => failReplayExport(active, error));
}

function syncReplayExportAfterTick(): void {
  const current = machine.current;
  if (!(current instanceof ReplayExportState)) {
    if (activeReplayExport !== undefined) disposeReplayExport(activeReplayExport);
    return;
  }

  if (
    activeReplayExport !== undefined
    && activeReplayExport.state !== current
  ) {
    disposeReplayExport(activeReplayExport);
  }
  if (activeReplayExport === undefined) prepareReplayExport(current);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  const current = machine.current;
  const active = activeReplayExport;
  if (current instanceof ReplayExportState) {
    current.fail('video export: cancelled because the tab was hidden');
  }
  if (active !== undefined) disposeReplayExport(active);
});

// Presentation caches and queues remain owned by the composition root. The
// overlay receives their references but cannot replace them or create game
// state of its own.
const tallyCoinIcons = new Map<string, HTMLCanvasElement>();
const overlayView = createOverlayView({
  surface,
  canvas: overlay,
  fieldWidth: FIELD_W,
  fieldHeight: FIELD_H,
  versionLabel: GAME_VERSION_LABEL,
  v4Ui,
  v4Actors,
  pickupAtlas,
  hudIcons: packs.hudIcons,
  debugUi: DEBUG_UI,
  isBloomEnabled: () => post.enabled,
  drawCalls: () => stage.stats.calls,
  grazeUiPulses,
  grazeUiTicks: GRAZE_UI_TICKS,
  endingTraceByRun,
  tallyCoinIcons,
  hideMenuClickTargets,
  layoutMenuClickTargets,
  controllerAction: {
    isVisible: () => !controllerSetup.hidden,
    label: () => controllerConnect.textContent ?? 'CONNECT CONTROLLER',
    isActive: () => (
      controllerConnect.matches(':hover, :focus-visible')
      && !controllerConnect.disabled
    ),
    setBounds: ({ x, top, width, height }) => {
      controllerConnect.style.left = `${x}px`;
      controllerConnect.style.top = `${top}px`;
      controllerConnect.style.width = `${width}px`;
      controllerConnect.style.height = `${height}px`;
    },
  },
});
const runView = createRunView({
  batches,
  bulletAtlas,
  shipAtlas,
  fxAtlas,
  laserAtlas,
  missileAtlas,
  pickupAtlas,
  v4Actors,
  hasPackShipLayer: packs.shipUrl !== undefined,
  usesFiveWayShipBanking: packs.shipStrip?.banking === 'five-way',
});

const loop = new Loop({
  tick() {
    // A waiting PWA release may replace this page only from the title. This
    // keeps an active run on one JS + pack snapshot and makes the ensuing
    // controllerchange reload a safe, progress-free transition.
    if (machine.current?.name === 'title') activateWaitingPwaUpdate();

    const stateBeforeTick = machine.current;
    const exportPhaseBeforeTick = stateBeforeTick instanceof ReplayExportState
      ? stateBeforeTick.phase
      : undefined;
    const exportRunTickBefore = stateBeforeTick instanceof ReplayExportState
      ? stateBeforeTick.run.tickCount
      : undefined;
    const pointerRun = stateBeforeTick?.name === 'playing'
      ? (stateBeforeTick as { readonly run?: Run }).run
      : undefined;
    if (pointerRun === undefined) pointerPositionInput.clearOrigin();
    else pointerPositionInput.setOrigin(pointerRun.player.x, pointerRun.player.y);

    const buttons = input.sample();

    // The state about to tick, captured before the tick applies its transitions:
    // a menu confirm/cancel replaces this state, but its `.cue` field is set on
    // the object during the tick and survives the transition, so reading it here
    // is what catches those actions (the field is cleared at the top of a menu's
    // own next tick, so it never lingers past the frame it was set).
    const acted = machine.stack[machine.stack.length - 1] as { cue?: string } | undefined;

    machine.tick(buttons);
    if (pointerRun !== undefined) {
      // Capture the updated fixed-tick position, including the terminal clear
      // tick. Death opens a gap inside the recorder, so respawn never becomes a
      // fictional diagonal across the field. This trace is read only by the
      // ending overlay and is neither replay input nor simulation state.
      endingTraceRecorder(pointerRun).sample({
        tick: pointerRun.tickCount,
        x: pointerRun.player.x,
        y: pointerRun.player.y,
        alive: pointerRun.player.alive,
        finished: pointerRun.finished,
      });
    }
    syncReplayExportAfterTick();
    if (machine.current !== stateBeforeTick) {
      // Do not let a menu hover target or an interrupted click sequence spill
      // into the state that was just entered. Touch holds intentionally survive:
      // each state's Edges suppresses its first tick, and play should resume
      // without requiring every finger to lift and press again.
      pointerPositionInput.clearTarget();
      menuPointerInput.reset();
    }
    const exportState = machine.current instanceof ReplayExportState
      ? machine.current
      : undefined;
    if (replayExportPresentationAdvances(
      exportPhaseBeforeTick,
      exportState?.phase,
      exportRunTickBefore === undefined
        || exportState === undefined
        || exportState.run.tickCount > exportRunTickBefore,
    )) {
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
      stepBossCastFx(bossCastFx, (name) => {
        const castStrip = fxAtlas.strip(name);
        return castStrip.frames * castStrip.ticksPerFrame;
      });
    }

    // Play the menu cue the ticked state named, if any (`ui-move`/`ui-confirm`/
    // `ui-cancel`). Resolved here, in the shell, because `src/game` names sounds
    // as strings and never imports the audio engine — the `.music`/scene idiom.
    if (acted?.cue !== undefined) audio.play(acted.cue);

    let scene: string | undefined;
    let track: string | undefined;
    let topRun: Run | undefined;
    let bossArrivingForTrack = false;

    for (const state of machine.stack) {
      // A state may declare a music track directly, with no `Run` behind it — the
      // ending screen does, because once the boss is dead `run.music` has fallen
      // back to the stage theme and can no longer name the ending track. Read
      // bottom-up so the topmost declaration wins, the same precedence `run.music`
      // uses, and so the ending screen on top overrides the finished run beneath.
      const override = (state as { music?: string }).music;
      if (override !== undefined) track = override;

      // The scene's twin of the music read above — a state may declare a scene
      // directly, with no `Run` behind it: game-over and an authored ending do,
      // so each terminal state gets its own field even though the finished run's
      // `run.scene` has fallen back to the stage or boss field it ended on.
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

      const events = run.drainEvents();
      const bossArriving = events.some((event) => event.type === 'boss-arriving');
      // This assignment follows `topRun`: a higher run in the stack replaces
      // both the wanted track and the arrival occurrence that qualifies it.
      bossArrivingForTrack = bossArriving;

      for (const event of events) {
        const sound = shouldPlayRunEventSound(event.type, bossArriving)
          ? v4EventSound(event) ?? EVENT_SOUNDS[event.type]
          : undefined;
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
        if (event.type === 'boss-phase') {
          // `event.name` is the card just armed, not the Boss registry name.
          // Resolve the current Boss only after the sim has completed the phase
          // transition, then map the event's actual phase index to that card's
          // exact declaration strip. The queue remains presentation-only.
          const activeBoss = run.boss.boss;
          const strip = activeBoss === undefined
            ? undefined
            : v4BossPhaseCastStrip(activeBoss.name, event.count);
          if (activeBoss !== undefined && strip !== undefined && fxAtlas.has(strip)) {
            bossCastFx.push({
              run,
              bossName: activeBoss.name,
              strip,
              age: 0,
            });
          }
        }
      }
    }

    if (topRun === undefined) {
      grazeUiPulses.length = 0;
      bossIdentityFx.length = 0;
      bossCastFx.length = 0;
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
      const transition = resolveMusicTransition(
        music.current,
        wanted,
        pendingBossMusic,
        bossArrivingForTrack,
      );
      pendingBossMusic = transition.pendingBossTrack;
      if (wanted !== music.current) {
        music.play(wanted, transition.fadeSeconds);
        // A decoded track starts synchronously. A URL still loading leaves
        // `current` unchanged and keeps the pending arrival fade for the retry.
        if (music.current === wanted) pendingBossMusic = undefined;
      }
    }

    // Duck the theme while paused rather than cutting it — the room stays, just
    // quieter. Pause is a non-transparent state on top of a run (`states.ts`);
    // the shell reads it off the stack the same way it folds `run.music` above,
    // since no `Run` exposes "am I paused" (the pause lives one level up).
    const topName = machine.stack[machine.stack.length - 1]?.name;
    const paused = topName === 'pause' || topName === 'replay-pause';
    music.masterVolume = paused ? MUSIC_PAUSE_LEVEL : MUSIC_LEVEL;

    // `ui-pause` on the rising edge only — the tick the pause menu appears, not
    // every tick it is up. A pure shell reconcile off the stack-top name, the
    // same signal the duck above reads; no run event, no trace touched.
    if (paused && !wasPaused) audio.play('ui-pause');
    wasPaused = paused;
  },

  render() {
    const views = machine.views();
    const endingMix = endingMixFromViews(views);
    setEndingBatchMix(endingMix);
    if (endingMix !== undefined) {
      // Only the v4 wear-field declares this scalar. The engine method is a
      // no-op for every other scene and updates both sides of an active fade.
      background.setScalarUniform('uEndingArt', endingMix.art);
    }

    for (const batch of Object.values(batches)) batch.begin();

    // Bottom-first, so an overlay's base still draws beneath it.
    const runs = machine.stack.flatMap((state) => {
      const run = (state as { run?: Run }).run;
      return run === undefined ? [] : [run];
    });
    runView.draw({ runs, bossCastFx, bossIdentityFx });
    const hud = runs.at(-1);

    for (const batch of Object.values(batches)) batch.end();

    post.render();
    overlayView.draw({ run: hud, views, endingMix });
    let frameComposed = false;
    const exporting = activeReplayExport;
    if (
      exporting !== undefined
      && machine.current === exporting.state
    ) {
      // The same authored composition feeds screenshots and video, synchronously
      // while WebGL's non-preserved drawing buffer still contains this frame.
      frameCapture.compose(field, overlay);
      frameComposed = true;
      if (exporting.ready && exporting.state.phase === 'preparing') {
        startReplayExportRecording(exporting);
      } else if (exporting.state.phase === 'finished') {
        const now = performance.now();
        if (exporting.tailStartedAt === undefined) {
          exporting.tailStartedAt = now;
        } else if (
          now - exporting.tailStartedAt >= REPLAY_EXPORT_TAIL_MS
          && exporting.state.beginStopping()
        ) {
          stopReplayExport(exporting);
        }
      } else if (exporting.state.phase === 'stopping') {
        stopReplayExport(exporting);
      }
    }
    if (screenshotPending) {
      screenshotPending = false;
      // Compose synchronously while WebGL's non-preserved drawing buffer still
      // contains this exact frame. PNG encoding may finish asynchronously.
      if (!frameComposed) frameCapture.compose(field, overlay);
      const filename = screenshotFilename(new Date(), hud === undefined ? {} : {
        stage: hud.stageName,
        difficulty: hud.difficulty,
        tick: hud.tickCount,
      });
      void frameCapture.png().then((blob) => {
        downloadBlob(blob, filename);
        showShellStatus('SCREENSHOT DOWNLOAD READY');
      }).catch((error) => {
        console.warn('capture: screenshot failed', error);
        showShellStatus('SCREENSHOT FAILED', 'error');
      });
    }
    syncControllerPanel();
  },
});

loop.start();
