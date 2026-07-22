/**
 * A run: one attempt at a stage, from the first tick to the last.
 *
 * `Run` owns the systems and, more importantly, the **rules between them** —
 * what a player shot does when it reaches an enemy, what a kill drops, what a
 * pickup is worth, when the boss arrives, when the run is over. None of that
 * belongs to any one system: `BulletSystem` must not know what an enemy is, and
 * `EnemySystem` must not know what score is. Wiring them is a decision about
 * *this game*, so it lives here rather than being smeared across the systems.
 *
 * That logic used to live in `main.ts`, next to a WebGL context. Moving it here
 * is what makes a run constructible without a renderer, and therefore what makes
 * **headless replay verification** possible — which is the reason the whole
 * determinism architecture exists. A run that can only be played cannot be
 * proved.
 *
 * ## This run owns its generator
 *
 * Every system takes `rng` explicitly and only defaults to the global `sim`
 * stream. `Run` never takes that default: it constructs its own `Random` from
 * the seed and threads it through every call. Two consequences, both load-
 * bearing:
 *
 *  - A live run and a playback run can exist **in the same process at the same
 *    time** without touching each other's stream. Reaching for the global would
 *    make verification a sequential ritual — seed, play, reseed, replay — and
 *    any code that forgot a step would produce a green test that proved nothing.
 *  - Nothing outside a run can move a run's stream. `seedRun` mid-run was always
 *    a live hazard; here there is no shared state to stomp.
 *
 * Cosmetics still draw from `fx` inside `EffectSystem`, which is exactly the
 * split CLAUDE.md rule 2 requires: a particle can never shift a bullet.
 *
 * ## Order is the contract
 *
 * The sequence of calls in `tick` is part of the determinism contract, not a
 * matter of taste. Reordering two of them changes how many draws come off the
 * stream before the next one and every subsequent tick diverges. Change it only
 * deliberately, and expect every recorded replay to stop reproducing.
 */

import { Button } from '../core/input';
import { Random } from '../core/random';
import { getStage, StageRunner } from '../content/stage';
import { BombSystem, getBombSpec } from '../sim/bomb';
import { BossSystem, getBossSpec, type DialogueLine } from '../sim/boss';
import { bulletHitsCircle, BulletSystem } from '../sim/bullet';
import { DEFAULT_DIFFICULTY, type Difficulty } from '../sim/difficulty';
import { EffectSystem } from '../sim/effects';
import { EnemySystem } from '../sim/enemy';
import { ItemSystem, type Spoils } from '../sim/item';
import { OptionSystem } from '../sim/option';
import { Player, type PlayerConfig } from '../sim/player';
import {
  type Replay,
  ReplayPlayback,
  ReplayRecorder,
} from '../sim/replay';

/* ------------------------------------------------------------------ */
/* Characters                                                          */
/* ------------------------------------------------------------------ */

/**
 * A playable ship, as data.
 *
 * A registry rather than a union or a switch, for the same reason every other
 * extension point here is one: a new character must be a new file, never an
 * edit to this one. `CharacterSelectState` reads the registry, so a character
 * that registers itself appears on the select screen without anything being
 * told about it.
 *
 * The field rectangle is deliberately absent — that belongs to the run, not to
 * the ship, and a character carrying its own bounds would silently override the
 * stage it was flown in.
 */
export interface CharacterSpec {
  /** Shown on the select screen. */
  label: string;
  /** Everything about the ship except where the field is. */
  player: Omit<PlayerConfig, 'bounds'>;
  /** Registered option set (`sim/option.ts`). */
  options: string;
  /** Registered bomb the ship deploys (`sim/bomb.ts`). */
  bomb: string;
  /** One line of flavour for the select screen. */
  blurb?: string;
  /**
   * The atlas region this ship is drawn from, by name.
   *
   * Every other on-screen thing in the game names its own sprite this way —
   * `EnemySpec`, `BossSpec`, `ItemSpec`, `OptionSpec`, `BulletStyle` — and the
   * player was the one that did not. The shell hard-coded `'ship'` at 40×40,
   * so a roster of four ships with visibly different roles had exactly one
   * silhouette between them and nowhere to put a second when real art arrives.
   *
   * `main.ts` already fixed this once for options, and its comment there says
   * why: a shell that picks its own sprite makes the spec's field decorative.
   * The player is the case that was not carried across.
   *
   * All four ships name `'ship'` today because that is the only region the
   * placeholder generator paints. The field is what lets that stop being true
   * without editing the shell — see `docs/assets.md` §3.2.
   */
  sprite: string;
  /** Drawn size in px. Defaults to 40×40, the size the shell used to hard-code. */
  width?: number;
  height?: number;
}

const characters = new Map<string, CharacterSpec>();

export function defineCharacter(name: string, spec: CharacterSpec): void {
  if (characters.has(name)) {
    throw new Error(`character "${name}" is already defined`);
  }
  characters.set(name, spec);
}

export function getCharacter(name: string): CharacterSpec {
  const spec = characters.get(name);
  if (!spec) throw new Error(`unknown character "${name}"`);
  return spec;
}

/** Registration order, which is the order the select screen offers them in. */
export function characterNames(): readonly string[] {
  return [...characters.keys()];
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

export interface RunConfig {
  seed: number;
  character?: string;
  stage?: string;
  /**
   * Boss to send once the stage script has run out and the field is clear.
   *
   * **An override.** `StageSpec.boss` is where the answer normally comes from,
   * which is what this field's own comment predicted it should become. It was
   * the only source for the life of the project, and the shipped shell never
   * set it, so the shipped game had no boss fight at all.
   */
  boss?: string;
  /** Replay to play back instead of reading live input. */
  replay?: Replay;
  /**
   * Player state carried in from the stage before this one.
   *
   * Unset means a fresh start, which is what a first stage and every retry
   * get. It is part of the replay meta for the same reason the seed and the
   * character are: a stage-2 recording flown from 3 lives and full power is a
   * different run from the same inputs flown from 2 and none, and a replay
   * system that cannot tell them apart reports success on the wrong one.
   */
  carry?: PlayerCarry;
  field?: { width: number; height: number; margin: number };
  /**
   * Identity of the resource packs loaded for this run: `name@hash` pairs
   * comma-joined, `''` when none. Recorded into replay meta by
   * `finishRecording`, and on playback a mismatch WARNS rather than refuses —
   * v1 packs are presentation-only, so they change how the run looked, never
   * what it did.
   *
   * A plain **string** by contract: `src/game` must not import `src/packs` at
   * all (`architecture.test.ts` enforces it, values and types alike), so pack
   * identity crosses that boundary as text and nothing here learns what a pack
   * is. The shell computes it; this only carries it.
   */
  packs?: string;
  /**
   * Identity of the data pack whose campaign this run entered: `name@hash`,
   * `''` for a built-in campaign even with data packs loaded. Recorded into
   * replay meta, and on playback a mismatch REFUSES rather than warns.
   *
   * This is the strict counterpart to `packs`, and the split is the point: a
   * presentation pack changes how a run *looked* and can be swapped under a
   * replay freely, but a data pack's stages and enemies fire different bullets
   * — they change what the simulation *did*, so a replay under different
   * content is a different run and must be rejected, not flagged.
   *
   * A plain **string** by the same contract as `packs`; the shell computes it,
   * this only carries it.
   */
  packsData?: string;
  /**
   * The difficulty tier this run is flown on. Default `'normal'`, which is what
   * `options` alone declares — a run with no tier selected is Normal.
   *
   * Strict on playback like `stage`/`character`/`packsData`: a tier changes what
   * bullets are in the air (per-pattern overrides and tier-gated cards), so a
   * replay flown on a different tier is a different run and is refused, not
   * warned. Recorded into replay meta by `finishRecording`.
   *
   * Read by score as well as presentation: every award passes `#award`, which
   * scales `points` by the tier's rational in `SCORE_MULTIPLIER` (easy ×1/2,
   * normal ×1, hard ×3/2, lunatic ×2). Normal is `1/1` and so leaves the score
   * exactly what it was before the multiplier existed.
   */
  difficulty?: Difficulty;
  /**
   * Fingerprint of the bundled base content this run was flown under: a short
   * opaque hash the shell computes from `base-pack.json` and threads in. Recorded
   * into replay meta as `content`, and on playback: absent WARNS (a legacy
   * recording, or a harness that threaded none), present-and-different REFUSES.
   *
   * The middle ground between `packs` (warn) and `packsData` (refuse), and it
   * exists because the base content is not a data pack — it is the build itself,
   * so it joins neither of those meta keys, yet it CAN drift when the engine's
   * own enemies or bosses change. This is the only signal that a recording made
   * on one build is being replayed against different base content; it covers the
   * bundled pack JSON, not the pattern/behaviour code the pack names.
   *
   * A plain **string** by the same contract as `packs`: `src/game` must not import
   * `src/packs`, so the identity crosses as text and nothing here learns what a
   * fingerprint is of. Unset means the shell opted out (fixtures, debug launches),
   * and then nothing is recorded and nothing is checked.
   */
  contentFingerprint?: string;
  /**
   * Assist: fly with infinite lives. Default false/absent. A death proceeds in
   * full — power loss and scatter, invuln, deathCount, `boss.notePlayerDeath` —
   * but the life is not spent, so the out-of-lives outcome is simply unreachable
   * rather than special-cased (see `Player.kill` and `#settleOutcome`). Threaded
   * into `Player` as a plain rule flag, so the sim never learns a menu chose it.
   *
   * Recorded into replay meta as `infiniteLives` ONLY when true, and strict on
   * playback exactly like `difficulty`: a run flown with the assist is a
   * different run — deaths that would have ended it did not — so a mismatch
   * REFUSES. An ABSENT key means off, which keeps every pre-assist replay valid.
   */
  infiniteLives?: boolean;
}

/**
 * What survives a stage boundary.
 *
 * Everything here is a resource the player earned; everything omitted is
 * per-stage state that must not leak across (position, invulnerability, the
 * graze bookkeeping). Listing what carries is safer than listing what resets,
 * because a field added to `Player` later defaults to *not* carrying, and a
 * counter that wrongly resets is a visible annoyance while one that wrongly
 * carries is a run its own seed no longer describes.
 */
export interface PlayerCarry {
  score: number;
  lives: number;
  bombs: number;
  power: number;
  graze: number;
  deathCount: number;
}

/** Compact, stable, and comparable as a string — see `RunConfig.carry`. */
function encodeCarry(carry: PlayerCarry | undefined): string {
  if (carry === undefined) return '';
  const { score, lives, bombs, power, graze, deathCount } = carry;
  return `${score}:${lives}:${bombs}:${power}:${graze}:${deathCount}`;
}

export type RunOutcome = 'playing' | 'cleared' | 'failed';

/**
 * Something the presentation layer may want to react to — a sound, a flash, a
 * card announcement.
 *
 * A drain rather than callbacks, and reported rather than acted on, because
 * `Run` must stay constructible with no audio device and no renderer. `main.ts`
 * maps these to sounds; a test ignores them; neither has to pretend.
 */
export type RunEventType =
  | 'shot'
  | 'shot-hit'
  | 'enemy-killed'
  | 'boss-hit'
  | 'graze'
  | 'bomb'
  | 'pickup'
  | 'extend'
  | 'player-death'
  | 'boss-entered'
  | 'boss-phase'
  | 'boss-cleared'
  | 'boss-defeated'
  | 'cleared'
  | 'failed';

export interface RunEvent {
  type: RunEventType;
  x: number;
  y: number;
  /** How many, where the event can happen more than once in a tick. */
  count?: number;
  /** Registry name of whatever the event is about, when there is one. */
  name?: string;
}

/**
 * What the shell needs to draw the current dialogue line, or `undefined` when no
 * exchange is running. Read as *state*, like `scene` and `music`, never drained
 * as an event. `speaker` is an opaque portrait name — the sim does not know what
 * a portrait is (see `DialogueLine`).
 */
export interface DialogueView {
  speaker: string;
  text: string;
  /** Zero-based index of the line on screen. */
  index: number;
  /** Total lines in the exchange. */
  count: number;
}

/**
 * A dialogue exchange in progress: the lines, the line on screen, and the boss
 * held behind it. Private to `Run` — the shell sees only `DialogueView`.
 */
interface DialogueState {
  lines: readonly DialogueLine[];
  index: number;
  /** The boss to spawn once the last line is passed, and where. */
  boss: string;
  x: number;
  y: number;
}

/**
 * Play field. All content in `src/content` is authored in this space.
 *
 * 480×640 is 3:4 — the traditional Japanese STG portrait frame — and the frame
 * IS the whole screen: there is no sidebar, the HUD composites over the field
 * edges. Exported because the shell must agree with the sim about this and has
 * no business declaring its own copy: until it imported this constant,
 * `main.ts` carried an independent `FIELD_W/FIELD_H` pair that happened to
 * match, which is exactly the two-sources-of-truth shape this project keeps
 * finding defects in. The shell may import game values; game may not import
 * the renderer, so the dependency points the safe way.
 */
export const FIELD = { width: 480, height: 640, margin: 48 } as const;

/** Item pickup reach, px. Focus widens it — leaning in should pay twice. */
const MAGNET_RADIUS = 26;
const FOCUS_MAGNET_RADIUS = 62;

/** Above this y the player vacuums the whole field. */
const AUTO_COLLECT_LINE = 96;

/** Score per bullet a converting bomb erased. This is why bombing scores. */
const CLEARED_BULLET_SCORE = 20;

/**
 * Score per bullet grazed. Grazing is a scoring system, so it pays here.
 *
 * Lived on `Player` until score learned the tier: the graze increment was the
 * one award the pure-simulation `Player` scored for itself, and a tier rational
 * has no place there. It now pays through `#award` beside every other award, so
 * `Player.checkGraze` counts near misses and `Run` prices them.
 */
const GRAZE_SCORE = 10;

/**
 * How score scales with the tier — a per-tier integer rational applied as
 * `floor(points * num / den)`, so no float accumulates across a run and Normal
 * (`1/1`) leaves every award byte-identical to the pre-multiplier arithmetic.
 * That identity is what keeps the Normal gate traces frozen while the Lunatic
 * ones move.
 *
 * Engine constants today; content someday. A pack that tunes its own economy
 * would carry this table the way a pattern already carries its per-tier density
 * — until then the rationals live here, closed with the tier union they key on.
 */
export const SCORE_MULTIPLIER: Record<Difficulty, readonly [num: number, den: number]> = {
  easy: [1, 2],
  normal: [1, 1],
  hard: [3, 2],
  lunatic: [2, 1],
};

/**
 * `points` scaled by the tier's rational, floored to an integer — the whole of
 * what the tier does to score, factored out so it can be proven directly rather
 * than only through a run. `floor(points * num / den)`: integer-exact for any
 * score this game reaches, and for Normal (`1/1`) it is the identity, which is
 * the guarantee the frozen Normal gate traces rest on.
 */
export function scaleScore(points: number, difficulty: Difficulty): number {
  const [num, den] = SCORE_MULTIPLIER[difficulty];
  return Math.floor((points * num) / den);
}

/**
 * What a spell card pays when its timer runs out instead of its health.
 *
 * A quarter: enough that outlasting a card is worth something, small enough
 * that killing it is always worth more. See the payout branch in
 * `#resolveBossEvents` for what paying the full bonus did to the incentives.
 */
const TIMEOUT_BONUS_FRACTION = 0.25;

/** Where a boss enters from, relative to the field. */
const BOSS_ENTRY_Y = -60;

/** The impact spark a player shot throws on the boss — the same modest `spark`-sprite burst trash enemies use, small and short for the seal's darkest zone. */
const BOSS_HIT_SPARK = 'hit';

/**
 * What a death costs, and how much of it is left on the floor.
 *
 * One whole tier, of which roughly half is recoverable — eight `power` items
 * at 0.05 each. The asymmetry is the point: a death has to cost something or
 * the resource is not one, and it has to leave something or the run enters a
 * spiral where the player is weakest exactly when the stage is hardest.
 */
const DEATH_POWER_LOSS = 1;
const DEATH_POWER_ITEMS = 8;

/**
 * Score thresholds that drop an extra life, ascending.
 *
 * The `life` item is fully implemented — registered, tinted, magnetised,
 * collected, and it fires an `extend` event nothing else fires — and it had
 * **no spawn site anywhere in the game**. No enemy's spoils named it, the boss
 * shower did not list it, and no score threshold existed. An extra life was
 * unobtainable by any sequence of inputs.
 *
 * A score extend rather than a drop table entry, because that is the decision
 * the genre actually makes: it rewards the scoring game specifically, which is
 * what grazing and spell-card capture feed. Crossed once each, ascending, so a
 * run that jumps two thresholds in one pickup is owed both.
 *
 * Measured against the whole game rather than picked: a pilot that is never hit
 * across both stages, capturing all ten cards, finishes on about 547,000, and
 * one that flails finishes on 52,000. So the first extend sits where a player
 * who is capturing cards at all will reach it, the second where a good run will,
 * and the third above a clean clear — something to play toward.
 */
const EXTEND_SCORES: readonly number[] = [100_000, 300_000, 600_000];

/**
 * The shower a defeated boss drops when its own `BossSpec.spoils` is unset.
 *
 * A default rather than the only table: it used to be the sole source, applied
 * identically to every boss, so no boss could reward differently from another.
 * A boss now declares its own spoils and falls back to this.
 */
const DEFAULT_BOSS_SPOILS: Spoils = [
  ['big-power', 4],
  ['score', 12],
  ['bomb', 1],
];

export class Run {
  readonly bullets: BulletSystem;
  readonly enemies: EnemySystem;
  readonly items: ItemSystem;
  readonly effects: EffectSystem;
  readonly boss: BossSystem;
  readonly bombs: BombSystem;
  readonly options: OptionSystem;
  readonly player: Player;
  readonly stage: StageRunner;

  /** The stage's own scene name. Fixed for the life of the run, so cached. */
  readonly #stageScene: string | undefined;

  /** The stage's own music track. Fixed for the life of the run, so cached. */
  readonly #stageMusic: string | undefined;

  readonly config: RunConfig;
  readonly character: CharacterSpec;
  readonly characterName: string;
  readonly stageName: string;
  /** Boss this run owes, resolved from the stage unless the config overrode it. */
  readonly bossName: string | undefined;
  /** The tier this run is flown on. `'normal'` unless the config selected one. */
  readonly difficulty: Difficulty;
  readonly seed: number;

  readonly #field: { width: number; height: number; margin: number };

  /** This run's own stream. Never the global `sim`. See the header. */
  readonly #rng: Random;

  #recorder: ReplayRecorder;
  #playback: ReplayPlayback | undefined;

  #tick = 0;
  #outcome: RunOutcome = 'playing';
  #bossSent = false;
  #bossDefeated = false;

  /** The pre-fight exchange in progress, or undefined when none is. */
  #dialogue: DialogueState | undefined;
  /**
   * The button mask from the previous dialogue tick, for the fresh-Shot edge
   * that advances a line. Mirrors `Player.#previous` (CLAUDE.md rule 4): a
   * replay is a log of masks, so the tap edge is derived here, not read from a
   * device. Seeded to `Button.Shot` on entry so a Shot already held from
   * clearing the stage does not advance the first line.
   */
  #dialoguePrev = 0;
  /** How many `EXTEND_SCORES` thresholds this run has already paid out. */
  #extends = 0;

  #events: RunEvent[] = [];
  #spare: RunEvent[] = [];

  constructor(config: RunConfig) {
    this.config = config;
    this.#field = config.field ?? { ...FIELD };

    const characterName = config.character ?? characterNames()[0];
    if (characterName === undefined) {
      throw new Error('run: no characters are registered');
    }
    this.characterName = characterName;
    this.character = getCharacter(characterName);
    this.stageName = config.stage ?? 'stage-1';

    // Resolved here rather than beside `StageRunner` further down, because the
    // replay check below needs the boss name and a mismatch has to be caught
    // before anything is constructed.
    const stageSpec = getStage(this.stageName);

    // The stage's own answer, unless the config overrides it. Read this and
    // never `config.boss`: for the whole life of the shipped shell `config.boss`
    // was undefined, so every guard spelled in terms of it silently agreed that
    // this run had no boss and cleared without one.
    this.bossName = config.boss ?? stageSpec.boss;
    this.difficulty = config.difficulty ?? DEFAULT_DIFFICULTY;

    const replay = config.replay;
    if (replay !== undefined) {
      // A replay flown by a different ship, on a different stage, or from a
      // different seed does not fail — it quietly produces a *different run*
      // and reports success. That is the one failure mode a replay system
      // cannot have, so every axis the recording pinned is checked here.
      if (replay.seed !== config.seed) {
        throw new Error(
          `run: replay seed ${replay.seed} does not match config seed ${config.seed}`,
        );
      }
      expectMeta(replay, 'character', characterName);
      expectMeta(replay, 'stage', this.stageName);
      expectMeta(replay, 'boss', this.bossName ?? '');
      expectMeta(replay, 'carry', encodeCarry(config.carry));
      // Strict, and deliberately routed through `expectMeta` (throws) while
      // `packs` below is routed through `warnMeta`: a data pack's content moved
      // the simulation, so a replay recorded under different content is a
      // different run and is refused. Presentation cannot change what the run
      // did; content can — which is the whole reason the two are split.
      expectMeta(replay, 'packsData', config.packsData ?? '');
      // Strict, like stage/character/packsData: the tier changes what bullets are
      // in the air, so a replay flown on a different tier is a different run and is
      // refused. Absent-is-accepted covers fixtures recorded before the field.
      expectMeta(replay, 'difficulty', this.difficulty);
      // Assist marker, the difficulty key's exact shape: a run flown with
      // infinite lives is a different run, so a mismatch refuses. Absent means
      // off (`expectMeta` accepts absent), keeping every pre-assist replay valid.
      expectMeta(replay, 'infiniteLives', String(this.config.infiniteLives ?? false));
      // Content fingerprint: the middle ground. A RECORDED value that differs is
      // refused like `packsData` — the base content drifted, so the run is not the
      // one recorded — but an ABSENT one only warns, because a legacy recording (or
      // the gate harness, which threads no fingerprint) predates the key and is not
      // wrong about it. Routed through neither existing helper: `expectMeta` is
      // silent on absent, `warnMeta` never throws.
      expectOrWarnMeta(replay, 'content', config.contentFingerprint ?? '');
      // Packs are presentation-only: a different pack changes how the run looked,
      // never what it did, so a mismatch WARNS and never refuses. Deliberately
      // not routed through `expectMeta`, which throws.
      warnMeta(replay, 'packs', config.packs);
      this.#playback = new ReplayPlayback(replay);
    }

    this.seed = config.seed;
    this.#rng = new Random(config.seed);
    this.#recorder = new ReplayRecorder(config.seed);

    const bounds = this.#field;
    this.bullets = new BulletSystem({ bounds, initial: 4000 });
    this.enemies = new EnemySystem({ bounds, bullets: this.bullets, initial: 64, difficulty: this.difficulty });
    this.items = new ItemSystem({
      bounds,
      autoCollectLine: AUTO_COLLECT_LINE,
      initial: 256,
    });
    this.effects = new EffectSystem({ initial: 1024 });
    this.boss = new BossSystem({ bounds, bullets: this.bullets, difficulty: this.difficulty });
    this.bombs = new BombSystem({ bounds });
    this.options = new OptionSystem(this.character.options);
    this.player = new Player({
      ...this.character.player,
      // The ceiling is the game layer's to compute, because the game layer is
      // the only thing holding both tables power indexes. Left to `Player`,
      // which can only see the shot table, a 1-entry weapon pinned power to 0
      // and the 4-tier option set below was unreachable.
      maxPower: Math.max(
        this.character.player.shots.length,
        this.options.spec.levels.length,
      ) - 1,
      bounds: { width: bounds.width, height: bounds.height },
      // The run's assist choice, threaded as a plain rule flag. Set here rather
      // than on the character, so it overrides whatever the ship declared (none
      // does) and the sim never learns a menu is behind it.
      infiniteLives: this.config.infiniteLives ?? false,
    });
    this.stage = new StageRunner(stageSpec, this.enemies);
    this.#stageScene = stageSpec.background;
    this.#stageMusic = stageSpec.music;

    // Every name this run will ever resolve, resolved now.
    //
    // `options` and `stage` are already checked by construction above. The
    // other two were not, and they are the two that fail latest: the bomb is
    // looked up when the player first presses Bomb, and the boss only once the
    // stage script is spent and the field is clear — around three thousand ticks
    // into stage-1, later still if the boss carries dialogue, i.e. after the
    // whole stage has been survived. A run that is going to fail on a typo must
    // fail before it is played.
    getBombSpec(this.character.bomb);
    if (this.bossName !== undefined) getBossSpec(this.bossName);

    this.#applyCarry();
  }

  /**
   * Overwrite the fresh player with what the previous stage handed over.
   *
   * After `Player.reset()` in both call sites, never instead of it: reset is
   * what clears the per-stage state, and a carry that skipped it would bring
   * the last stage's invulnerability window and graze map along with the score.
   */
  #applyCarry(): void {
    const carry = this.config.carry;
    if (carry === undefined) return;
    const player = this.player;
    player.score = carry.score;
    player.lives = carry.lives;
    player.bombs = carry.bombs;
    player.power = carry.power;
    player.graze = carry.graze;
    player.deathCount = carry.deathCount;
  }

  /** What this run would hand the stage after it. See `RunConfig.carry`. */
  get carry(): PlayerCarry {
    const p = this.player;
    return {
      score: p.score,
      lives: p.lives,
      bombs: p.bombs,
      power: p.power,
      graze: p.graze,
      deathCount: p.deathCount,
    };
  }

  /* ---------------------------------------------------------------- */
  /* The tick                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Advance one tick. `buttons` is the live mask; a playback run ignores it and
   * reads the recorded one instead.
   *
   * Recording happens either way. A playback run therefore re-emits the replay
   * it was handed, which costs nothing and makes "played back identically" a
   * comparison of two files rather than a claim.
   */
  tick(buttons: number): void {
    // A finished run is frozen. Ticking on would keep spending stream draws
    // after the outcome was decided, so a replay's length would no longer
    // describe the run it recorded.
    if (this.#outcome !== 'playing') return;

    const mask = this.#playback === undefined
      ? buttons
      : this.#playback.buttonsAt(this.#tick);
    this.#recorder.record(this.#tick, mask);

    const rng = this.#rng;
    const player = this.player;

    // A dialogue exchange is a phase of its own: the field is frozen, the player
    // moves but cannot act, and each fresh Shot advances a line. It is entered by
    // `#sendBoss` when a boss carrying dialogue comes due, and it holds the whole
    // rest of the tick — nothing else steps — so the only state that advances is
    // the player's position and the line index, both pure functions of the input
    // log. That is what keeps a replay reproducing it (CLAUDE.md rules 1, 4). The
    // stage and boss are only consulted while no exchange is running, which is
    // also what stops spawning during one.
    if (this.#dialogue === undefined) {
      this.stage.step(rng);
      this.#sendBoss(rng);
    }
    if (this.#dialogue !== undefined) {
      this.#stepDialogue(mask, rng);
      this.#tick++;
      return;
    }

    this.enemies.step(player.x, player.y, rng);
    this.boss.step(player.x, player.y, rng);

    player.step(mask, this.bullets, this.#tick);
    this.#resolveFire();
    this.#resolveBomb();

    // Chosen once and shared, not recomputed per consumer. `bombs.step` below
    // can kill enemies, so asking twice would let an option and a tracking
    // bullet aim at two different things in the same tick — and the one that
    // asked later would be steering at something that had just stopped
    // existing. Order in `tick` is the contract (see the header); so is this.
    const aim = this.#aimTarget();

    this.options.step(
      player.x,
      player.y,
      player.focused,
      Math.floor(player.power),
      (mask & Button.Shot) !== 0 && player.alive,
      this.#tick,
      this.bullets,
      aim,
    );

    this.bombs.step(this.bullets, this.enemies, rng);
    this.#resolveBombDamage();
    // Enemy fire steers at the player; player fire steers at whatever the
    // options are already aiming at. Sharing `aim` keeps a tracking shot and a
    // tracking option agreeing about what "the target" is, which is what makes
    // them read as one loadout rather than two systems.
    this.bullets.step(player.x, player.y, rng, aim);

    this.items.step(
      player.x,
      player.y,
      player.focused ? FOCUS_MAGNET_RADIUS : MAGNET_RADIUS,
      // Not purely positional: a burning bomb claims the field from anywhere,
      // which is half of why bombing out of a bad spot is worth the stock.
      player.alive && (this.items.isAboveCollectLine(player.y) || this.bombs.active),
      rng,
    );

    this.#resolvePlayerShots();
    this.#resolveDeaths(rng);
    this.#resolveClearedBullets();
    this.#resolvePickups();

    const grazed = player.checkGraze(this.bullets);
    if (grazed > 0) {
      // Priced here, not in `checkGraze`: the pure-simulation `Player` counts
      // near misses, `Run` scores them through the one tier-aware choke point.
      this.#award(grazed * GRAZE_SCORE);
      // The `graze` effect was registered, complete, and emitted by nothing, so
      // a near miss made a sound and left no mark on the screen — in a genre
      // where leaning into fire is the scoring system.
      this.effects.emit('graze', player.x, player.y);
      this.#emit({ type: 'graze', x: player.x, y: player.y, count: grazed });
    }

    this.#resolvePlayerHit();
    this.#resolveBossEvents(rng);

    this.effects.step();

    this.#resolveExtends(rng);

    this.#tick++;
    this.#settleOutcome();
  }

  /**
   * Player shot against enemies, then against the boss.
   *
   * Enemies first because they are in front of it: during a fight with escorts,
   * a shot should be eaten by the escort it visibly touched. Backwards by index
   * — `despawn` and `damage` both splice their live lists, and a forward walk
   * would skip the entity shifted into the slot just vacated.
   *
   * ## The bullet's own shape, not a circle at its position
   *
   * This used to call `enemies.hitTest(b.x, b.y, b.radius)`, which is a circle
   * at the **muzzle**. For a round bullet those are the same thing. For a beam
   * they are not remotely: `laser` is anchored at the muzzle and reaches
   * hundreds of pixels forward, so the whole body of it was inert against
   * enemies and only a target sitting on the ship's nose was ever hit. The
   * registered `laser` weapon dealt a measured **0** damage in 400 ticks to a
   * target 68px away, while drawing a lethal-looking line straight through it.
   *
   * `bulletHitsCircle` asks the bullet what shape it is. The segment test it
   * runs for a beam was already written, already correct, and already used by
   * the enemy-fire-versus-player path — the player-fire path simply never
   * called it. That is the whole bug, and it is the shape of most of the bugs
   * this file's audit turned up.
   */
  #resolvePlayerShots(): void {
    const boss = this.boss.boss;

    for (let i = this.bullets.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets.bullets[i];
      if (b === undefined || b.faction !== 'player') continue;

      let spent = false;

      for (let j = this.enemies.enemies.length - 1; j >= 0; j--) {
        const enemy = this.enemies.enemies[j];
        if (enemy === undefined || !enemy.alive) continue;
        if (!bulletHitsCircle(b, enemy.x, enemy.y, enemy.spec.radius)) continue;

        const killed = this.enemies.damage(enemy, b.damage);
        if (!killed && enemy.spec.onHit) this.effects.emit(enemy.spec.onHit, b.x, b.y);
        this.#emit({ type: 'shot-hit', x: b.x, y: b.y, name: enemy.name });

        // A piercing beam keeps going and keeps damaging; anything else is
        // spent on the first thing it touches.
        if (!b.pierce) {
          spent = true;
          break;
        }
      }

      if (spent) {
        // `despawn`, never `alive = false` — CLAUDE.md rule 8: the flag is not
        // a control surface and clears nothing.
        this.bullets.despawn(b);
        continue;
      }

      // Invulnerable during entry, so the fight cannot be skipped by parking
      // a wall of shot on the spot the boss is about to arrive at.
      if (boss === undefined || boss.entering) continue;
      if (!bulletHitsCircle(b, boss.x, boss.y, boss.spec.radius)) continue;

      this.boss.damage(b.damage);
      // Mirror the enemy path (which emits `enemy.spec.onHit`): a boss hit was
      // the only landing in the game that threw no spark. Drawn from the `fx`
      // stream inside `EffectSystem.emit`, never `sim`, so the determinism
      // contract and the golden traces are untouched by construction (rule 2).
      this.effects.emit(BOSS_HIT_SPARK, b.x, b.y);
      this.#emit({ type: 'boss-hit', x: b.x, y: b.y, name: boss.name });
      if (!b.pierce) this.bullets.despawn(b);
    }
  }

  /**
   * The one place score enters the run. Every award — kills, cleared bullets,
   * score pickups, card bonuses, grazes — passes `points` through here, so the
   * tier multiplies the economy in exactly one arithmetic and no other site
   * needs to know a tier exists.
   *
   * Integer-exact: `points` is an integer, the rational is small integers, and
   * `points * num` stays well inside the safe range for any score this game
   * reaches, so `floor` sees an exact product and no float accumulates.
   */
  #award(points: number): void {
    this.player.score += scaleScore(points, this.difficulty);
  }

  /**
   * Kills pay their score directly and scatter their spoils as items.
   *
   * `scoreValue` is the kill's **immediate** points, credited on death.
   * `spoils` is what it drops for the player to fly to and collect — a
   * name→count list, so an enemy can drop any registered item. Every enemy in
   * the game currently drops only `power`, counted 1/2/3 across the cast; a
   * single `power` item is worth 0.05, so this is a count of items, not a power
   * fraction, and reading it as a fraction is what maxed the weapon on the first
   * grunt in the pre-item game.
   *
   * The two are separate mechanisms on purpose. An enemy used to carry a dead
   * `drops.score` field equal to its `scoreValue`; paying both would have
   * doubled the kill, so it was never read, and now it is gone — a `score`
   * *item* is a spoils entry a design can add, distinct from the immediate
   * points.
   */
  #resolveDeaths(rng: Random): void {
    for (const death of this.enemies.drainDeaths()) {
      if (death.spec.onDeath) this.effects.emit(death.spec.onDeath, death.x, death.y);
      // The frame-animated hero flash on every kill, regardless of a pack's own
      // `onDeath` scatter. fx-stream (rule 2), so it never moves the trace.
      this.effects.emit('burst', death.x, death.y);
      this.#award(death.spec.scoreValue ?? 0);

      for (const [name, count] of death.spec.spoils ?? []) {
        this.items.burst(name, death.x, death.y, count, rng);
      }

      this.#emit({
        type: 'enemy-killed',
        x: death.x,
        y: death.y,
        name: death.name,
      });
    }
  }

  /**
   * Erased bullets pay score.
   *
   * Score, not items: a field-wide bomb routinely clears several hundred
   * bullets, and one item per bullet would empty the item pool and bury the
   * drops the player was bombing to reach. `convertBullets` on the bomb spec is
   * what decides whether a bomb reports its clears at all, so a non-converting
   * bomb pays nothing here without this needing to know which bomb it was.
   */
  #resolveClearedBullets(): void {
    const cleared = this.bombs.drainCleared();
    if (cleared.length === 0) return;
    this.#award(cleared.length * CLEARED_BULLET_SCORE);
  }

  #resolvePickups(): void {
    for (const pickup of this.items.drainCollected()) {
      const { kind, value } = pickup.spec;
      switch (kind) {
        case 'power':
          this.player.addPower(value);
          break;
        case 'score':
          this.#award(value);
          break;
        case 'life':
          this.player.lives += value;
          this.#emit({ type: 'extend', x: pickup.x, y: pickup.y, name: pickup.name });
          break;
        case 'bomb':
          this.player.bombs += value;
          break;
      }
      // 29 to 46 pickups a run, every one of them silent and unmarked: the
      // sound never played because `main.ts` keyed the table on an event type
      // that does not exist, and the `pickup` effect was never emitted at all.
      this.effects.emit('pickup', pickup.x, pickup.y);
      this.#emit({ type: 'pickup', x: pickup.x, y: pickup.y, name: pickup.name });
    }
  }

  /**
   * Score extends: the only way an extra life enters the game.
   *
   * Dropped as an **item** rather than credited straight to `lives`, so the
   * player has to fly to it and so the whole pickup path — the magnet, the
   * `pickup` effect, the `extend` event, the sound — runs for the rarest and
   * most valuable drop in the game. Crediting it silently would leave the one
   * reward worth celebrating as the only one with no feedback.
   *
   * A `while`, not an `if`: a single spell-card bonus can cross more than one
   * threshold, and a run is owed every extend it earned.
   */
  #resolveExtends(rng: Random): void {
    if (!this.player.alive) return;
    while (
      this.#extends < EXTEND_SCORES.length &&
      this.player.score >= (EXTEND_SCORES[this.#extends] as number)
    ) {
      this.#extends++;
      this.items.burst('life', this.player.x, this.player.y - 40, 1, rng);
    }
  }

  /**
   * A volley left the muzzles: make it visible and audible.
   *
   * `Player.fired` is the seam. The `shot` sound and the `muzzle` effect were
   * both registered and complete and reached by nothing, because firing
   * happens inside `Player.step` and the game layer had no way to observe it.
   * Emitted at the ship rather than at each muzzle: one particle burst per
   * volley, not one per bolt, or a tier-3 fan would throw seven of them a
   * frame.
   */
  #resolveFire(): void {
    const player = this.player;
    if (!player.fired) return;
    this.effects.emit('muzzle', player.x, player.y - 12);
    this.#emit({ type: 'shot', x: player.x, y: player.y });
  }

  /**
   * `Player` owns the bomb *stock* and the invulnerability it buys; the blast
   * is ours. It has already spent a stock by the time we see `bombing`, so a
   * bomb refused because one is still burning is refunded here — otherwise a
   * double tap costs a stock and produces nothing, which reads as the game
   * eating an input.
   */
  #resolveBomb(): void {
    if (!this.player.bombing) return;

    const fired = this.bombs.fire(
      this.character.bomb,
      this.player.x,
      this.player.y,
    );
    if (!fired) {
      this.player.bombs++;
      return;
    }

    const spec = getBombSpec(this.character.bomb);

    // The bomb's own window, not the ship's respawn one. `Player.bomb` sets
    // `invuln` from its own config because it has nothing else to reach for,
    // and `BombSpec.invulnTicks` says in its doc comment that the game applies
    // it — nothing did. Both bombs therefore covered the player for exactly the
    // character's 90 ticks, so `spread`'s declared 150 and a hypothetical 600
    // produced identical play, and the field the docs teach you to tune was
    // inert.
    this.player.invuln = Math.max(this.player.invuln, spec.invulnTicks);

    // The blast. `BombSpec.effect` is declared by both bombs and
    // `docs/extending.md` teaches it with a worked example; it had no reader,
    // so a bomb erased half the screen in complete silence.
    if (spec.effect) this.effects.emit(spec.effect, this.player.x, this.player.y);

    this.boss.notePlayerBomb();
    this.#emit({
      type: 'bomb',
      x: this.player.x,
      y: this.player.y,
      name: this.character.bomb,
    });
  }

  /**
   * A burning bomb damages the boss too.
   *
   * `BombSystem.step` is handed the `EnemySystem` and walks it; the boss is in
   * `BossSystem` and was never passed, so a bomb dealt **zero** damage to every
   * boss in the game — measured 650 hp before and 650 after, for both bombs
   * against both bosses — while still spending a stock and voiding the spell
   * card bonus. Bombing a boss was strictly worse than not bombing it.
   *
   * Entry is excluded for the same reason player shot is: an invulnerable
   * arrival cannot be skipped by pre-firing at the spot it appears.
   */
  #resolveBombDamage(): void {
    const boss = this.boss.boss;
    if (boss === undefined || !boss.alive || boss.entering) return;

    const damage = this.bombs.damageAt(boss.x, boss.y, boss.spec.radius);
    if (damage <= 0) return;

    this.boss.damage(damage);
    this.#emit({ type: 'boss-hit', x: boss.x, y: boss.y, name: boss.name });
  }

  #resolvePlayerHit(): void {
    const player = this.player;
    if (player.invuln > 0 || !player.alive) return;

    const hit = this.bullets.hitTest(player.x, player.y, player.radius, 'enemy');
    if (hit === undefined) return;

    this.bullets.despawn(hit);
    const powerBefore = player.power;
    player.kill();
    this.boss.notePlayerDeath();
    this.effects.emit('death.big', player.x, player.y);
    // The frame-animated flash augments the scatter above (fx-stream, rule 2).
    this.effects.emit('burst.big', player.x, player.y);
    this.#emit({ type: 'player-death', x: player.x, y: player.y });

    // Dying costs power, and scatters some of it back where the ship fell.
    //
    // Without this there is no power economy in either direction: pickups only
    // ever added, so once the ceiling was reached nothing could take it away
    // and the resource stopped being a resource. Dropping the loss as items
    // rather than deleting it is what keeps a death a *setback* instead of a
    // punishment — the ground the player died on is now worth returning to,
    // which is a decision, and the invulnerability window is exactly the tool
    // for taking it.
    if (powerBefore <= 0 || !player.alive) return;
    const lost = Math.min(powerBefore, DEATH_POWER_LOSS);
    player.addPower(-lost);
    this.items.burst('power', player.x, player.y, DEATH_POWER_ITEMS, this.#rng);
  }

  #resolveBossEvents(rng: Random): void {
    for (const event of this.boss.drainEvents()) {
      const { x, y } = event.boss;
      // Indexed off the event, never off `boss.phase`. Events are drained after
      // the transition that raised them, so by now the boss has already armed
      // the *next* card — reading the live phase would name and pay for the
      // wrong one, and after the last card it has no phase to read at all.
      const card = event.boss.spec.phases[event.phaseIndex];
      switch (event.type) {
        case 'entered':
          this.#emit({ type: 'boss-entered', x, y, name: event.boss.name });
          break;
        case 'phase-start':
          this.#emit({
            type: 'boss-phase',
            x,
            y,
            count: event.phaseIndex,
            name: card?.name,
          });
          break;
        case 'phase-cleared':
        case 'timeout':
          // Both end the card, and both are a clear — surviving the timer is a
          // legitimate way through. They are **not** worth the same.
          //
          // Paying the full bonus for a timeout makes the dominant strategy not
          // shooting: the timer runs out either way, and never firing is a
          // strictly safer way to hold `clean`. Measured on the magistrate, a
          // pacifist scored 1,000,740 against a shooter's 1,000,600 — the whole
          // fight was worth less than the rounding on it, and it paid more to
          // put the controller down.
          //
          // So a kill pays the card, and a timeout pays a fraction of it. The
          // fraction is not zero, because surviving `Last Word "Assize"` for its
          // full clock is a real thing to have done; it is small, because doing
          // it without firing must never beat doing it with.
          if (event.clean === true) {
            const bonus = card?.bonus ?? 0;
            // Floor the timeout fraction to an integer BEFORE the tier scales it,
            // so `#award` sees integer points and Normal stays byte-identical to
            // the pre-multiplier `Math.floor(...)` this replaced.
            const points = Math.floor(
              event.type === 'phase-cleared' ? bonus : bonus * TIMEOUT_BONUS_FRACTION,
            );
            this.#award(points);
          }
          this.#emit({
            type: 'boss-cleared',
            x,
            y,
            count: event.phaseIndex,
            name: card?.name,
          });
          break;
        case 'defeated': {
          // Scoped to *this stage's* boss, not to "a boss died". A midboss is
          // also a boss, and the unscoped flag meant killing stage 2's warden
          // satisfied the end-of-run guard — so the magistrate, a finished
          // four-phase fight, could never be spawned even when named. Both
          // halves are load-bearing: `#bossSent` is set only by the stage-boss
          // branch of `#sendBoss`, so a midboss that happened to share a name
          // still cannot latch this.
          if (this.#bossSent && event.boss.name === this.bossName) {
            this.#bossDefeated = true;
          }
          if (event.boss.spec.onDeath) this.effects.emit(event.boss.spec.onDeath, x, y);
          // The frame-animated boss flash on every boss kill (fx-stream, rule 2).
          this.effects.emit('burst.big', x, y);
          for (const [name, count] of event.boss.spec.spoils ?? DEFAULT_BOSS_SPOILS) {
            this.items.burst(name, x, y, count, rng);
          }
          this.#emit({ type: 'boss-defeated', x, y, name: event.boss.name });
          break;
        }
      }
    }
  }

  /** The boss arrives once the script is spent and the field it left is clear. */
  /**
   * Release whichever boss is owed: a midboss the script has reached, or the
   * stage boss once the script is spent.
   *
   * The midboss path runs first and returns, because the schedule is already
   * held at that point and letting the end-of-stage branch also fire would put
   * two bosses on the field with one health bar between them.
   */
  #sendBoss(rng: Random): void {
    for (const cue of this.stage.drainBossCues()) {
      this.#releaseBoss(
        cue.boss,
        cue.x ?? this.#field.width / 2,
        cue.y ?? BOSS_ENTRY_Y,
        rng,
      );
      return;
    }

    // The schedule stops dead at a midboss, so `finished` cannot be true while
    // one is alive — but it is not the runner's job to know a boss died, and
    // resuming is.
    if (this.stage.waiting && !this.boss.active) this.stage.resume();

    if (this.#bossSent || this.bossName === undefined) return;
    if (!this.stage.finished || this.enemies.count > 0 || this.boss.active) return;

    this.#bossSent = true;
    this.#releaseBoss(this.bossName, this.#field.width / 2, BOSS_ENTRY_Y, rng);
  }

  /**
   * Spawn a boss — but if its spec carries dialogue, enter the dialogue phase
   * first and hold the spawn until the exchange is tapped through.
   *
   * Both `#sendBoss` call sites route through here, and both must: `warden` is a
   * midboss reached only by the cue path, and if only the end-of-stage spawn
   * checked for dialogue its exchange would be registered and unreachable — the
   * exact failure class `reachability.test.ts` exists to catch.
   */
  #releaseBoss(name: string, x: number, y: number, rng: Random): void {
    // Per-character variant first, the shared exchange otherwise — pure data
    // selection off the character this run already pins. A variant with a
    // different line count changes only this character's timeline, which is why a
    // replay records the character (see `BossSpec.dialogueFor`).
    const spec = getBossSpec(name);
    const lines = spec.dialogueFor?.[this.characterName] ?? spec.dialogue;
    if (lines === undefined || lines.length === 0) {
      this.boss.spawn(name, x, y, rng);
      return;
    }

    // Entering the exchange: clear the field (the genre's mercy) and hold the
    // spawn. `Button.Shot` seeds the tap edge so a Shot held from the stage that
    // just ended does not advance line 0 — the first tap must be a fresh press.
    this.bullets.clear();
    this.#dialogue = { lines, index: 0, boss: name, x, y };
    this.#dialoguePrev = Button.Shot;
  }

  /**
   * One dialogue tick: move the player, advance on a fresh Shot press, and spawn
   * the held boss once the last line is passed.
   *
   * `mask` is the raw sampled mask, read here for the tap edge; the value handed
   * to `player.step` has Shot and Bomb cleared, so the same press that advances a
   * line never also fires or spends a bomb (a bomb spent here would never blast —
   * `#resolveBomb` does not run during dialogue — and would be silently lost).
   */
  #stepDialogue(mask: number, rng: Random): void {
    const dialogue = this.#dialogue;
    if (dialogue === undefined) return;

    const shotEdge =
      (mask & Button.Shot) !== 0 && (this.#dialoguePrev & Button.Shot) === 0;
    this.#dialoguePrev = mask;

    this.player.step(mask & ~(Button.Shot | Button.Bomb), this.bullets, this.#tick);

    if (!shotEdge) return;

    dialogue.index++;
    if (dialogue.index < dialogue.lines.length) return;

    // Last line passed: the boss enters exactly as it would have.
    this.#dialogue = undefined;
    this.boss.spawn(dialogue.boss, dialogue.x, dialogue.y, rng);
  }

  /** Nearest enemy to the player, for aimed options. Boss counts as a target. */
  #aimTarget(): { x: number; y: number } | undefined {
    const player = this.player;
    let best: { x: number; y: number } | undefined;
    let bestDistance = Infinity;

    for (const enemy of this.enemies.enemies) {
      const dx = enemy.x - player.x;
      const dy = enemy.y - player.y;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = enemy;
      }
    }

    const boss = this.boss.boss;
    if (boss !== undefined && !boss.entering) {
      const dx = boss.x - player.x;
      const dy = boss.y - player.y;
      if (dx * dx + dy * dy < bestDistance) best = boss;
    }

    return best;
  }

  /**
   * A run ends when the player is out of lives, or when the script, the field
   * and the boss are all done with.
   *
   * "Field clear" reads `enemies.count`, not the bullet count: a stage is not
   * still in progress because something it spawned left a shot in the air.
   */
  #settleOutcome(): void {
    if (!this.player.alive) {
      this.#outcome = 'failed';
      this.#emit({ type: 'failed', x: this.player.x, y: this.player.y });
      return;
    }

    if (!this.stage.finished || this.enemies.count > 0) return;
    if (this.bossName !== undefined && !this.#bossDefeated) return;

    // A boss still on the field is a fight still owed, even once `#bossDefeated`
    // is set — a midboss can be mid-entry on the tick the guard above passes.
    if (this.boss.active) return;

    // Do not freeze the run on top of its own reward. A defeated boss showers
    // its spoils — the default is 17 items, 4 of them big-power — on the same
    // tick it dies, and the outcome used to settle in that same tick, so every
    // one of them was stranded under the clear banner. Measured at 6000 points,
    // 31% of the final score, and the only spawn site 4 of the 5 registered item
    // kinds have.
    //
    // No timer guards this and none is needed: an item is either magnetised, in
    // which case `ItemSystem` forces it onto a live player and clamps the last
    // step so it cannot tunnel past, or it is not, in which case it leaves the
    // field under its own motion and is culled. Both terminate.
    if (this.items.count > 0) return;

    this.#outcome = 'cleared';
    this.#emit({ type: 'cleared', x: this.player.x, y: this.player.y });
  }

  /* ---------------------------------------------------------------- */
  /* State                                                             */
  /* ---------------------------------------------------------------- */

  get tickCount(): number {
    return this.#tick;
  }

  get finished(): boolean {
    return this.#outcome !== 'playing';
  }

  get outcome(): RunOutcome {
    return this.#outcome;
  }

  /** True if this run is reading a recording rather than live input. */
  get playingBack(): boolean {
    return this.#playback !== undefined;
  }

  get field(): { width: number; height: number; margin: number } {
    return this.#field;
  }

  /**
   * The scene this run wants on screen: a registered background name, or
   * `undefined` to leave alone whatever is already there.
   *
   * ## Declared state, not an event
   *
   * Every other thing the presentation layer reacts to arrives through
   * `drainEvents`, and this deliberately does not. An event is the right shape
   * for something that *happened once* — a hit, a pickup, a card starting.
   * Which place we are in is not an occurrence, it is a condition, and pushing
   * conditions through an event queue is how presentation drifts out of sync
   * with the run that owns it: miss one event, or drain it in a state that is
   * not drawing, and the screen stays wrong until something unrelated corrects
   * it.
   *
   * So the run *declares* and the shell *reconciles*. The shell compares this
   * against what is currently on the quad and starts a cross-fade when they
   * disagree. That is idempotent — reading it twice, or not reading it for
   * fifty ticks, cannot leave the wrong scene up — and it means a run that is
   * paused, replayed, or restarted needs no separate resynchronisation path.
   *
   * ## Reading the live phase is correct here, unlike in `#resolveBossEvents`
   *
   * That method indexes off `event.phaseIndex` precisely because it must not
   * read `boss.phase`: events are drained after the transition that raised
   * them, so by then the boss has already armed the *next* card and naming the
   * live one would name the wrong thing. This wants the opposite. It is asking
   * what is being fought at this instant, and the live phase is the only
   * honest answer to that question.
   *
   * `spec.phases[...]` is indexed directly rather than through the `phase`
   * getter, which throws once `phaseIndex` runs past the last card — a state
   * that exists for the ticks between the final phase ending and the boss
   * finishing its death. Asking what the screen should look like must never be
   * the thing that throws.
   */
  get scene(): string | undefined {
    const boss = this.boss.boss;
    if (boss?.alive) {
      const card = boss.spec.phases[boss.phaseIndex];
      if (card?.background !== undefined) return card.background;
    }
    return this.#stageScene;
  }

  /**
   * The music this run wants playing: a registered track name, or `undefined` to
   * leave alone whatever is already sounding.
   *
   * The twin of `scene`, and declared for the same reason — which place we are
   * in is a *condition*, not an event, so the shell reconciles it every tick
   * against what is actually playing rather than reacting to a queue that could
   * drop a message and strand the wrong theme. Reading it is idempotent, so a
   * paused, replayed, or restarted run needs no resynchronisation.
   *
   * The precedence mirrors `scene`: the live card's own track wins first — a
   * spell card may override the theme for its duration exactly as it overrides
   * the background — then the fight's boss-level track, then the stage's. A fight
   * declares one theme on entry and most cards hold it, so `SpellCard.music` is
   * left unset on all but the card that wants its own; those fall through to
   * `boss.spec.music`, the fight's identity.
   *
   * `boss?.alive` is the same guard as `scene`, and for the same reason: the
   * theme announces the *live* fight, and once the boss is gone the run falls
   * back to the stage's own track. Reading the live card here is correct for the
   * same reason `scene` reads it — see that getter's note on `#resolveBossEvents`.
   */
  get music(): string | undefined {
    const boss = this.boss.boss;
    if (boss?.alive) {
      const card = boss.spec.phases[boss.phaseIndex];
      if (card?.music !== undefined) return card.music;
      if (boss.spec.music !== undefined) return boss.spec.music;
    }
    return this.#stageMusic;
  }

  /**
   * The dialogue line on screen, or `undefined` when no exchange is running.
   *
   * Declared state the shell reconciles, like `scene` and `music`, never a
   * drained event — reading it is idempotent, so a paused or replayed run needs
   * no resynchronisation. `speaker` is an opaque portrait name; the simulation
   * never learns portraits exist (see `DialogueLine`).
   */
  get dialogue(): DialogueView | undefined {
    const dialogue = this.#dialogue;
    if (dialogue === undefined) return undefined;
    const line = dialogue.lines[dialogue.index];
    if (line === undefined) return undefined;
    return {
      speaker: line.speaker,
      text: line.text,
      index: dialogue.index,
      count: dialogue.lines.length,
    };
  }

  /**
   * The recording of this run, for saving.
   *
   * The meta is not decoration: it is what `new Run({ replay })` checks itself
   * against, so a recording carries everything needed to reject being replayed
   * as something it was not.
   */
  finishRecording(): Replay {
    const meta: Record<string, string | number> = {
      character: this.characterName,
      stage: this.stageName,
      boss: this.bossName ?? '',
      carry: encodeCarry(this.config.carry),
      // Strict on playback: the tier changes what the simulation did, so a
      // mismatch refuses the replay rather than warning.
      difficulty: this.difficulty,
      // Strict on playback: content changed the simulation, so a mismatch gates
      // the run rather than warning. '' for a built-in campaign.
      packsData: this.config.packsData ?? '',
      // Presentation-only: a mismatch on playback warns, so this is recorded to
      // be reported, not to gate the run. '' when no pack was loaded.
      packs: this.config.packs ?? '',
      outcome: this.#outcome,
      score: this.player.score,
    };
    // The base-content fingerprint is written ONLY when the shell threaded one —
    // a present value is a real hash, never ''. Omitting it (rather than
    // defaulting to '') keeps "opted out" distinct from a valid fingerprint, and
    // is exactly what makes a fingerprint-free harness (the gate) record a replay
    // whose playback takes the absent-warns path instead of a spurious refusal.
    if (this.config.contentFingerprint !== undefined) {
      meta['content'] = this.config.contentFingerprint;
    }
    // Written ONLY when the assist was on, so an ordinary run's meta is
    // byte-identical to before the assist existed and every existing replay (and
    // the frozen gate traces) stays valid — absent means off, checked above.
    if (this.config.infiniteLives === true) {
      meta['infiniteLives'] = 'true';
    }
    return this.#recorder.finish(this.#tick, meta);
  }

  /** Drain what happened this tick. Presentation-only; nothing reads it back. */
  drainEvents(): readonly RunEvent[] {
    const drained = this.#events;
    this.#events = this.#spare;
    this.#spare = drained;
    this.#events.length = 0;
    return drained;
  }

  #emit(event: RunEvent): void {
    this.#events.push(event);
  }

  /**
   * Back to tick zero, identically.
   *
   * "Genuinely fresh" is the whole requirement: a retry that inherits one
   * counter is a run that cannot be reproduced from its own seed, and it fails
   * in a way that only shows up as a replay that stops matching weeks later.
   * The generator is reseeded rather than replaced, so `reset()` and a newly
   * constructed `Run` on the same config are the same run — there is a test.
   */
  reset(): void {
    this.#rng.seed(this.seed);
    this.#recorder = new ReplayRecorder(this.seed);
    this.#playback =
      this.config.replay === undefined
        ? undefined
        : new ReplayPlayback(this.config.replay);

    this.bullets.clear();
    this.enemies.clear();
    this.items.clear();
    this.effects.clear();
    this.boss.clear();
    this.bombs.clear();
    this.options.reset();
    this.player.reset();
    this.#applyCarry();
    this.stage.reset();

    // Drain rather than trust: a system's `clear` is not obliged to discard a
    // queue the game never read, and a stale death carried into a fresh run
    // would pay score for a kill in the previous one.
    this.enemies.drainDeaths();
    this.items.drainCollected();
    this.bombs.drainCleared();
    this.boss.drainEvents();

    this.#tick = 0;
    this.#outcome = 'playing';
    this.#bossSent = false;
    this.#bossDefeated = false;
    this.#dialogue = undefined;
    this.#dialoguePrev = 0;
    this.#extends = 0;
    this.#events.length = 0;
    this.#spare.length = 0;
  }
}

/**
 * The soft half of the replay-meta check: a mismatch is reported, not refused.
 *
 * Only warns when both sides name a pack and they differ — an absent recorded
 * value (a replay from before packs existed) and an absent live value (no pack
 * loaded now) are both silent, matching `expectMeta`'s absent-is-accepted rule.
 */
function warnMeta(replay: Replay, key: string, live: string | undefined): void {
  const recorded = replay.meta?.[key];
  if (recorded === undefined || recorded === '') return;
  if (live === undefined || live === '') return;
  if (String(recorded) !== live) {
    console.warn(
      `run: replay recorded with ${key} "${String(recorded)}", replaying under "${live}" — presentation may differ`,
    );
  }
}

function expectMeta(replay: Replay, key: string, expected: string): void {
  const actual = replay.meta?.[key];
  // Absent is accepted: a replay recorded before a field existed is not wrong
  // about it, and refusing those would make adding a field break every fixture.
  if (actual === undefined) return;
  if (String(actual) !== expected) {
    throw new Error(
      `run: replay was recorded with ${key} "${String(actual)}", not "${expected}"`,
    );
  }
}

/**
 * The third meta semantics, between `expectMeta` (refuse) and `warnMeta` (warn):
 * a RECORDED value that differs is refused exactly as `expectMeta` refuses, but
 * an ABSENT one WARNS instead of being silently accepted.
 *
 * `content` needs it. Silent-on-absent (`expectMeta`) would let a recording that
 * predates the fingerprint slip through with no signal at all, and never-throw
 * (`warnMeta`) would let genuine content drift replay quietly under the wrong
 * base content — the one failure the key exists to make loud. So: a recording
 * that pinned a fingerprint and meets a different one is a different simulation
 * and throws; a recording that pinned none (a legacy replay, or the gate harness
 * that threads no fingerprint) is warned and plays.
 */
function expectOrWarnMeta(replay: Replay, key: string, expected: string): void {
  const actual = replay.meta?.[key];
  if (actual === undefined) {
    console.warn(
      `run: replay has no ${key} fingerprint (a legacy recording, or a harness that threaded none) — replaying without a content check`,
    );
    return;
  }
  if (String(actual) !== expected) {
    throw new Error(
      `run: replay was recorded with ${key} "${String(actual)}", not "${expected}"`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Starter characters                                                  */
/* ------------------------------------------------------------------ */

// scout/lance/hound/spire/maw — and the five shots, four option sets and two bombs
// they fly — moved into the bundled base pack (`tools/make-base-pack.ts` →
// `base-pack.json`), registering through the inject pipeline like any pack
// character (decisions-round2 §D). This module keeps only the machinery above:
// the `CharacterSpec` shape and the registry `CharacterSelectState` reads. The
// roster's presence and correctness are proved at the composition root —
// `src/reachability.test.ts`, `src/balance.test.ts` and the replay regression
// (`src/base-content.golden.test.ts`) — none of which a `src/game` unit test may reach, since
// importing the base pack would cross the `src/packs` boundary.
