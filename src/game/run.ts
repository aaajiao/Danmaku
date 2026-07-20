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
import { getShot } from '../content/shots';
import { getStage, StageRunner } from '../content/stage';
import { BombSystem, getBombSpec } from '../sim/bomb';
import { BossSystem, getBossSpec } from '../sim/boss';
import { bulletHitsCircle, BulletSystem } from '../sim/bullet';
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
 * What a spell card pays when its timer runs out instead of its health.
 *
 * A quarter: enough that outlasting a card is worth something, small enough
 * that killing it is always worth more. See the payout branch in
 * `#resolveBossEvents` for what paying the full bonus did to the incentives.
 */
const TIMEOUT_BONUS_FRACTION = 0.25;

/** Where a boss enters from, relative to the field. */
const BOSS_ENTRY_Y = -60;

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

  readonly config: RunConfig;
  readonly character: CharacterSpec;
  readonly characterName: string;
  readonly stageName: string;
  /** Boss this run owes, resolved from the stage unless the config overrode it. */
  readonly bossName: string | undefined;
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
      // Packs are presentation-only: a different pack changes how the run looked,
      // never what it did, so a mismatch WARNS and never refuses. Deliberately
      // not routed through `expectMeta`, which throws — the strict-refusal path
      // is reserved for a future data-pack meta key.
      warnMeta(replay, 'packs', config.packs);
      this.#playback = new ReplayPlayback(replay);
    }

    this.seed = config.seed;
    this.#rng = new Random(config.seed);
    this.#recorder = new ReplayRecorder(config.seed);

    const bounds = this.#field;
    this.bullets = new BulletSystem({ bounds, initial: 4000 });
    this.enemies = new EnemySystem({ bounds, bullets: this.bullets, initial: 64 });
    this.items = new ItemSystem({
      bounds,
      autoCollectLine: AUTO_COLLECT_LINE,
      initial: 256,
    });
    this.effects = new EffectSystem({ initial: 1024 });
    this.boss = new BossSystem({ bounds, bullets: this.bullets });
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
    });
    this.stage = new StageRunner(stageSpec, this.enemies);
    this.#stageScene = stageSpec.background;

    // Every name this run will ever resolve, resolved now.
    //
    // `options` and `stage` are already checked by construction above. The
    // other two were not, and they are the two that fail latest: the bomb is
    // looked up when the player first presses Bomb, and the boss only once the
    // stage script is spent and the field is clear — measured at tick 3091 on
    // stage-1, i.e. after the whole stage has been survived. A run that is
    // going to fail on a typo must fail before it is played.
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

    this.stage.step(rng);
    this.#sendBoss(rng);

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
      this.#emit({ type: 'boss-hit', x: b.x, y: b.y, name: boss.name });
      if (!b.pierce) this.bullets.despawn(b);
    }
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
      this.player.score += death.spec.scoreValue ?? 0;

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
    this.player.score += cleared.length * CLEARED_BULLET_SCORE;
  }

  #resolvePickups(): void {
    for (const pickup of this.items.drainCollected()) {
      const { kind, value } = pickup.spec;
      switch (kind) {
        case 'power':
          this.player.addPower(value);
          break;
        case 'score':
          this.player.score += value;
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
            this.player.score += Math.floor(
              event.type === 'phase-cleared' ? bonus : bonus * TIMEOUT_BONUS_FRACTION,
            );
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
      this.boss.spawn(
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
    this.boss.spawn(this.bossName, this.#field.width / 2, BOSS_ENTRY_Y, rng);
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
   * The recording of this run, for saving.
   *
   * The meta is not decoration: it is what `new Run({ replay })` checks itself
   * against, so a recording carries everything needed to reject being replayed
   * as something it was not.
   */
  finishRecording(): Replay {
    return this.#recorder.finish(this.#tick, {
      character: this.characterName,
      stage: this.stageName,
      boss: this.bossName ?? '',
      carry: encodeCarry(this.config.carry),
      // Presentation-only: a mismatch on playback warns, so this is recorded to
      // be reported, not to gate the run. '' when no pack was loaded.
      packs: this.config.packs ?? '',
      outcome: this.#outcome,
      score: this.player.score,
    });
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

/* ------------------------------------------------------------------ */
/* Starter characters                                                  */
/* ------------------------------------------------------------------ */

const START_X = FIELD.width / 2;
const START_Y = FIELD.height - 72;

/**
 * Two ships, from content that already exists. Two rather than one because a
 * seam with a single implementation is a seam nobody has checked: the select
 * screen, the replay's character guard and the option-set wiring are all
 * exercised only when the second one behaves differently from the first.
 */
defineCharacter('scout', {
  label: 'SCOUT',
  sprite: 'ship',
  blurb: 'even fire, wide bomb',
  options: 'standard',
  bomb: 'spread',
  player: {
    x: START_X,
    y: START_Y,
    speed: 3.6,
    focusSpeed: 1.5,
    // Lethal radius against a 40px sprite. That ratio is the genre.
    radius: 2.5,
    grazeRadius: 20,
    lives: 3,
    bombs: 3,
    invulnTicks: 90,
    shots: getShot('spread').levels,
  },
});

defineCharacter('lance', {
  label: 'LANCE',
  sprite: 'ship',
  blurb: 'homing options, focused bomb',
  options: 'seeker',
  bomb: 'lance',
  player: {
    x: START_X,
    y: START_Y,
    // Slower and more fragile in exchange for options that do the aiming.
    speed: 3.1,
    focusSpeed: 1.2,
    radius: 2.5,
    grazeRadius: 24,
    lives: 2,
    bombs: 3,
    invulnTicks: 90,
    shots: getShot('needle').levels,
  },
});

/**
 * `hound` and `spire` exist because `homing` and `laser` did not.
 *
 * Both weapons were registered, imported, unit-tested and equipped by nobody:
 * `getShot` was called exactly twice in the whole project. That is the defect
 * the reachability work is about, one layer up — a registry entry is not
 * content until something asks for it — and the fix is a consumer, not a
 * deletion.
 *
 * Adding them also buys the thing two characters could not. With two ships
 * every registry entry in the game had exactly one consumer, so nothing proved
 * `shot`, `options` and `bomb` were independent fields rather than three names
 * for the same choice. `hound` fires `homing` and bombs `spread`; `spire` fires
 * `laser` and flies `lance`'s bomb and `lance`'s options. `seeker`, `spread`
 * and `lance` now each have a second consumer, and `character.bomb` is
 * demonstrably its own axis.
 *
 * Neither ship moves the balance envelope, and that was a constraint rather
 * than an outcome. Measured across every character × tier × focus state the
 * loadout spread is **4.125**, the same figure the two-ship roster produced:
 * `spire` p0 ties `lance`'s floor at 0.3333 and `spire` p3 ties its ceiling at
 * 1.3717 against 1.3750, with `hound` wholly inside. So `REFERENCE_DPS` is
 * untouched and no boss needed resizing — see `balance.test.ts`, which
 * re-derives all of it.
 */

/**
 * Half the rate over four times the width.
 *
 * Measured at tier 3, guns only: `needle` lands 1.000 dead ahead and **0.000**
 * at 80px of lateral offset — a ±19° slot. `homing` lands 0.489 dead ahead and
 * 0.480 at 283px on a 32° bearing, keeping 98% of its rate across a wide
 * forward cone at any range, where `spread` and `needle` both land nothing.
 *
 * It is not `lance` with better aim, and the inversion is exact. `lance`'s gun
 * is fixed forward and narrow while its `seeker` options cover all 360°, so it
 * has no blind spot and a narrow gun. `hound`'s gun covers a wide cone without
 * being pointed while its `picket` battery covers nothing but straight ahead,
 * so it has a wide gun and a real blind spot: the shot's turn circle is 133px
 * (r 7 at 3°/tick), and against a target level with the ship it measures
 * **0.000** where `lance` and `spire` both land 0.372 from their aimed options.
 * Dead ahead `lance` out-damages it 1.372 to 0.765.
 */
defineCharacter('hound', {
  label: 'HOUND',
  sprite: 'ship',
  blurb: 'self-aiming gun, hand-aimed options',
  options: 'picket',
  bomb: 'spread',
  player: {
    x: START_X,
    y: START_Y,
    // The slowest ship, against scout's 3.6 and lance's 3.1. Every other ship's
    // movement does two jobs — dodging and aiming — and is priced for both.
    // This gun keeps 98% of its rate at a 32° bearing, so this ship's movement
    // does one job and is priced for one.
    speed: 2.9,
    // And the fastest focus, above scout's 1.5. The exact inversion of lance,
    // by the same argument run backwards: lance crawls at 1.2 because its
    // options aim for it, so focus is for threading only. These options are
    // fixed forward and land nothing off-axis, so focus is where this ship
    // aims, and a battery the player cannot walk onto a target is not an
    // upgrade.
    focusSpeed: 1.6,
    // Unchanged from both existing ships, deliberately: it is the genre's ratio
    // against a 40px sprite, and it is the one dial that would make a ship
    // strictly better in a way `balance.test.ts` cannot see — that test
    // measures damage dealt and never damage taken.
    radius: 2.5,
    // Above scout's 20 and lance's 24. This is the lowest-damage ship in the
    // game at every tier flown dead ahead, so its fights are the longest and it
    // spends the most time under fire. Graze is pure reward and costs nothing
    // else, so it is the right place to pay that back.
    grazeRadius: 26,
    // The only odd stock in the game, against scout's 3/3 and lance's 2/3. Long
    // fights are survived rather than escaped, so the length is paid in lives
    // and charged in bombs. Nothing in the suite reads either number; this is a
    // play decision and is stated as one.
    lives: 3,
    bombs: 2,
    // Identical to both ships on purpose. `Run` applies
    // `max(player.invulnTicks, bomb.invulnTicks)` and `spread` declares 150
    // against `lance`'s 90, so the bombs already differentiate the window; a
    // per-ship dial on top would double-count it.
    invulnTicks: 90,
    shots: getShot('homing').levels,
  },
});

/**
 * Commitment and reach.
 *
 * The beam is anchored where it was fired and cannot be turned, so every change
 * of target is a change of position: its lethal width is 6px, and it measures
 * 1.000 at 120px dead ahead against **0.000** at 40px of lateral offset. It has
 * to be walked onto its target. And because `growth` accumulates only while a
 * beam lives, power buys *range* rather than rate — p0 lands 0.167 at 200px and
 * nothing at 380px, p3 lands 0.800 and 0.600.
 *
 * This ship is also the only production caller of two paths that unit tests
 * were the sole users of: `pierce` on the player-fire side of
 * `#resolvePlayerShots`, and `BulletSpec.life` expiry on a player bullet — no
 * other player bullet in the game has a life, because no other one is
 * stationary enough to need one.
 */
defineCharacter('spire', {
  label: 'SPIRE',
  sprite: 'ship',
  blurb: 'planted beam, point-blank bomb',
  options: 'seeker',
  bomb: 'lance',
  player: {
    x: START_X,
    y: START_Y,
    // The fastest ship, above scout's 3.6. The beam cannot be re-aimed, so this
    // ship's action loop is crossing the field, and it has to cross faster than
    // the ships that can simply turn.
    speed: 4.2,
    // And the slowest focus, below lance's 1.2. Measured rather than felt: the
    // beam's half-width is 3, so against a radius-11 grunt the window the
    // player must hold is ±14px. At lance's 1.2px/tick that 28px window is 23
    // ticks wide; at 1.0 it is 28. The number is the width of the correction
    // window in ticks, and the fastest free speed in the game is what buys it.
    focusSpeed: 1,
    radius: 2.5,
    // The largest in the game. The beam pays for time spent stationary, and
    // standing still is the most expensive thing a player can do in this genre.
    // This ship is obliged to do it, so it is the ship that should be paid for
    // it, and the loop closes on itself: the gun wants you planted, planted is
    // dangerous, danger is graze, graze is score.
    grazeRadius: 28,
    // The mirror of hound's 3/2. It survives by bombing out of the place it
    // planted itself rather than flying out of it, so it carries the stock and
    // pays the life.
    lives: 2,
    bombs: 3,
    invulnTicks: 90,
    shots: getShot('laser').levels,
  },
});
