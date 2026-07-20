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
import { BulletSystem } from '../sim/bullet';
import { circlesOverlap } from '../sim/collision';
import { EffectSystem } from '../sim/effects';
import { EnemySystem } from '../sim/enemy';
import { ItemSystem } from '../sim/item';
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
   * On the config rather than in `StageSpec` because `content/stage.ts` has no
   * boss field yet; this is the seam until it grows one, at which point the
   * stage's own answer should win and this becomes the override.
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

/** Play field. All content in `src/content` is authored in this space. */
const FIELD = { width: 480, height: 480, margin: 48 } as const;

/** Item pickup reach, px. Focus widens it — leaning in should pay twice. */
const MAGNET_RADIUS = 26;
const FOCUS_MAGNET_RADIUS = 62;

/** Above this y the player vacuums the whole field. */
const AUTO_COLLECT_LINE = 96;

/** Score per bullet a converting bomb erased. This is why bombing scores. */
const CLEARED_BULLET_SCORE = 20;

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

/** Items a defeated boss showers, by registry name and count. */
const BOSS_SPOILS: readonly (readonly [string, number])[] = [
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
    this.#resolveBomb();

    this.options.step(
      player.x,
      player.y,
      player.focused,
      Math.floor(player.power),
      (mask & Button.Shot) !== 0 && player.alive,
      this.#tick,
      this.bullets,
      this.#aimTarget(),
    );

    this.bombs.step(this.bullets, this.enemies, rng);
    this.bullets.step(player.x, player.y, rng);

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
      this.#emit({ type: 'graze', x: player.x, y: player.y, count: grazed });
    }

    this.#resolvePlayerHit();
    this.#resolveBossEvents(rng);

    this.effects.step();

    this.#tick++;
    this.#settleOutcome();
  }

  /**
   * Player shot against enemies, then against the boss.
   *
   * Enemies first because they are in front of it: during a fight with escorts,
   * a shot should be eaten by the escort it visibly touched. Backwards by index
   * — `despawn` splices the live list, and a forward walk would skip the entity
   * shifted into the slot just vacated.
   */
  #resolvePlayerShots(): void {
    const boss = this.boss.boss;

    for (let i = this.bullets.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets.bullets[i];
      if (b === undefined || b.faction !== 'player') continue;

      const hit = this.enemies.hitTest(b.x, b.y, b.radius);
      if (hit !== undefined) {
        const killed = this.enemies.damage(hit, b.damage);
        if (!killed && hit.spec.onHit) this.effects.emit(hit.spec.onHit, b.x, b.y);
        this.#emit({ type: 'shot-hit', x: b.x, y: b.y, name: hit.name });
        // Shot does not pierce. `despawn`, never `alive = false` — CLAUDE.md
        // rule 8: the flag is not a control surface and clears nothing.
        this.bullets.despawn(b);
        continue;
      }

      // Invulnerable during entry, so the fight cannot be skipped by parking
      // a wall of shot on the spot the boss is about to arrive at.
      if (boss === undefined || boss.entering) continue;
      if (!circlesOverlap(b.x, b.y, b.radius, boss.x, boss.y, boss.spec.radius)) {
        continue;
      }
      this.boss.damage(b.damage);
      this.#emit({ type: 'boss-hit', x: b.x, y: b.y, name: boss.name });
      this.bullets.despawn(b);
    }
  }

  /**
   * Kills pay score directly and drop items for their power.
   *
   * `drops.power` is read as a **count of `power` items**, not as a power
   * fraction. It is authored 1/2/3 across the cast while a single `power` item
   * is worth 0.05, so the fraction reading maxes the weapon on the first grunt —
   * which is what the pre-item game did, since it had nowhere else to put the
   * number.
   *
   * `drops.score` is deliberately not paid: it is identical to `scoreValue` on
   * every enemy currently defined, so paying both would silently double the
   * value of a kill.
   */
  #resolveDeaths(rng: Random): void {
    for (const death of this.enemies.drainDeaths()) {
      if (death.spec.onDeath) this.effects.emit(death.spec.onDeath, death.x, death.y);
      this.player.score += death.spec.scoreValue ?? 0;

      const power = death.spec.drops?.power ?? 0;
      if (power > 0) this.items.burst('power', death.x, death.y, power, rng);

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
      this.#emit({ type: 'pickup', x: pickup.x, y: pickup.y, name: pickup.name });
    }
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

    this.boss.notePlayerBomb();
    this.#emit({
      type: 'bomb',
      x: this.player.x,
      y: this.player.y,
      name: this.character.bomb,
    });
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
          // Surviving the timer is a clear; `clean` is what separates the two,
          // and the payout is ours to decide. A clean card pays its bonus.
          if (event.clean === true) this.player.score += card?.bonus ?? 0;
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
          for (const [name, count] of BOSS_SPOILS) {
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
    // `BOSS_SPOILS` — 17 items, 4 of them big-power — on the same tick it dies,
    // and the outcome used to settle in that same tick, so every one of them was
    // stranded under the clear banner. Measured at 6000 points, 31% of the final
    // score, and the only spawn site 4 of the 5 registered item kinds have.
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
    this.#events.length = 0;
    this.#spare.length = 0;
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
