/**
 * Stages: the declarative surface a designer authors a level in.
 *
 * A stage is a list of waves, and a wave is "at this tick, put this enemy
 * here". Everything else — what the enemy does, how it moves, what it fires —
 * belongs to its `EnemySpec`. That split is the point: a stage is a score, not
 * a script. It says when things enter, never how they behave, so retuning an
 * enemy retunes it everywhere without touching a single stage file.
 *
 * Upstream had no stage data at all. `Stage.js` hard-coded its waves as
 * imperative spawn calls inside a `switch` on the stage number, which is why
 * adding an enemy there meant editing the runner. Here a stage is data, and
 * the runner knows nothing about any particular one.
 *
 * ## Timing is exact
 *
 * A wave at tick 120 spawns on tick 120 of every run, on every machine. The
 * runner counts its own ticks and never reads a clock — per CLAUDE.md rule 1,
 * nothing on this path may know what a second is. `at` is ticks, and 60 ticks
 * is a second because the loop says so, not because anything here measures it.
 */

import { sim, type Random } from '../core/random';
import { getBossSpec } from '../sim/boss';
import { EnemySystem, getEnemySpec } from '../sim/enemy';
import { patternNames } from './patterns';

export interface EnemyWave {
  /** Tick, relative to the stage start. */
  at: number;
  enemy: string;
  x: number;
  y: number;
  /** Spawn several, spaced by this many ticks. */
  count?: number;
  interval?: number;
  /** Offset each successive spawn. */
  stepX?: number;
  stepY?: number;
}

/**
 * A boss fought partway through the script — a midboss.
 *
 * Reaching one **holds the schedule**: the runner stops advancing entirely
 * until `resume()` is called, so the waves authored after it do not pour in
 * during the fight. That is why every `at` in a stage is a *script* tick rather
 * than a wall-clock one, and why a midboss can be moved without retiming
 * everything that follows it.
 *
 * The hold lives here rather than in the caller because the schedule lives
 * here. A caller that had to know when to stop stepping would be reimplementing
 * the timeline it was handed.
 */
export interface BossWave {
  at: number;
  boss: string;
  /** Entry position. Defaults to top-centre of the field. */
  x?: number;
  y?: number;
}

export type WaveEntry = EnemyWave | BossWave;

const EMPTY_CUES: readonly BossCue[] = [];

function isBossWave(wave: WaveEntry): wave is BossWave {
  return (wave as BossWave).boss !== undefined;
}

/** A boss the schedule has reached and is waiting on. */
export interface BossCue {
  boss: string;
  x: number | undefined;
  y: number | undefined;
}

export interface StageSpec {
  name: string;
  /**
   * The seed a run of this stage starts from.
   *
   * The runner deliberately does not apply it — reseeding `sim` mid-run would
   * stomp a stream the replay system owns. Whoever starts the run applies it,
   * once, with `seedRun(spec.seed)` from `core/random`.
   */
  seed?: number;
  waves: readonly WaveEntry[];
  /** Ticks after the last wave before the stage is considered complete. */
  outro?: number;
  /**
   * The boss sent once the script is spent and the field is clear, by name.
   *
   * A stage that declares one cannot be cleared without fighting it. This is
   * the stage's own answer to "who is at the end of me", and it is the only
   * place that answer belongs: `RunConfig.boss` used to be the sole source, so
   * a boss existed only if whoever built the run happened to name one. Nothing
   * in the shipped shell ever did, which is why three bosses, ten phases and
   * seven spell cards were unreachable in a game you could actually launch.
   *
   * `RunConfig.boss` still overrides this, for tests that want to point a stage
   * at a different fight without authoring a stage to hold it.
   */
  boss?: string;
  /**
   * The stage that follows this one, by name. Unset means this is the last.
   *
   * A **name** for the same reason `background` is one: a stage may not import
   * its sibling, or the two files would have to know about each other in a
   * cycle. `states.ts` resolves it when a run clears.
   */
  next?: string;
  /**
   * The scene this stage is set in, by registered background name.
   *
   * A **name**, resolved by whoever is drawing, and never an import. Registering
   * a background means importing `render/background`, and `src/content` may not
   * import from `src/render` — that rule is what keeps the whole simulation
   * runnable with no GL context, and it is worth more than the convenience of
   * putting the shader next to the stage that uses it. So the shaders live in
   * `render/backgrounds/` and a stage refers to one the same way it refers to a
   * pattern or an enemy: by string, checked at the point of use.
   *
   * Unset means the shell keeps whatever is already on screen.
   */
  background?: string;
  /**
   * The music this stage is scored to, by registered track name.
   *
   * A **string**, for the identical reason `background` is one: registering a
   * track means importing the audio engine, and `src/content` stays runnable
   * with no audio (and no GL) context, so a stage names its theme the same way
   * it names a scene or a pattern — by string, resolved by whoever is playing
   * sound. It is never validated here against the music registry, because that
   * registry is audio-side and importing it would break the boundary; an unknown
   * name is caught at the point of use, exactly as `background` is.
   *
   * Unset means the shell leaves whatever track is already playing.
   */
  music?: string;
}

const registry = new Map<string, StageSpec>();

/**
 * Register a stage. Waves are sorted by `at`, so they may be authored in any
 * order — grouped by role, by lane, or by whatever reads best.
 */
export function defineStage(name: string, spec: StageSpec): void {
  if (registry.has(name)) {
    throw new Error(`stage "${name}" is already defined`);
  }
  // A stage whose registry key and `name` disagree is a copy-paste that got
  // half-renamed. Tooling shows one and lookups use the other, so the lie
  // would surface far from its cause.
  if (spec.name !== name) {
    throw new Error(
      `stage "${name}" declares name "${spec.name}"; the two must match`,
    );
  }

  validate(spec);

  // Sorted and copied at definition, so an author mutating their own array
  // afterwards cannot change a registered stage, and `getStage` always hands
  // back waves in the order they will actually fire.
  registry.set(name, { ...spec, waves: sortWaves(spec.waves) });
}

export function getStage(name: string): StageSpec {
  const spec = registry.get(name);
  if (!spec) throw new Error(`unknown stage "${name}"`);
  return spec;
}

export function stageNames(): readonly string[] {
  return [...registry.keys()];
}

/** Non-throwing existence check, for a validator resolving a name before use. */
export function hasStage(name: string): boolean {
  return registry.has(name);
}

/**
 * `Array.prototype.sort` is stable per spec, which is load-bearing here rather
 * than incidental: two waves sharing an `at` spawn in the order they were
 * written, and spawn order is draw order in `EnemySystem`.
 */
function sortWaves(waves: readonly WaveEntry[]): WaveEntry[] {
  return [...waves].sort((a, b) => a.at - b.at);
}

/**
 * Reject what would otherwise go wrong quietly.
 *
 * Only whole ticks are checked, not taste. `at: 12.5` is never reached by a
 * tick counter that moves in whole steps, and a fractional `interval` makes a
 * wave's repeats land on ticks that are neither evenly spaced nor the ones
 * written down. Both produce a stage that looks authored and plays wrong.
 */
function validate(spec: StageSpec): void {
  const outro = spec.outro ?? 0;
  if (!Number.isInteger(outro) || outro < 0) {
    throw new Error(`stage "${spec.name}": outro must be a whole tick count`);
  }

  for (let i = 0; i < spec.waves.length; i++) {
    const wave = spec.waves[i];
    if (wave === undefined) continue;
    const subject = isBossWave(wave) ? wave.boss : wave.enemy;
    const where = `stage "${spec.name}" wave ${i} (${subject})`;

    if (!Number.isInteger(wave.at) || wave.at < 0) {
      throw new Error(`${where}: "at" must be a whole tick count, got ${wave.at}`);
    }

    // A boss wave has no repeat arithmetic — it is one fight, and `count` on it
    // would be a request nobody could satisfy.
    if (isBossWave(wave)) continue;

    const count = wave.count ?? 1;
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(`${where}: "count" must be a positive whole number, got ${count}`);
    }
    const interval = wave.interval ?? 0;
    if (!Number.isInteger(interval) || interval < 0) {
      throw new Error(
        `${where}: "interval" must be a whole tick count, got ${interval}`,
      );
    }
  }
}

/**
 * One resolved schedule entry: a wave's repeats flattened out.
 *
 * Enemy spawns and boss cues share one sorted timeline rather than living in
 * separate lists, because their relative order is the thing that matters and
 * two lists would have to be re-merged at every step to recover it.
 */
type StageSpawn =
  | { tick: number; kind: 'enemy'; enemy: string; x: number; y: number }
  | { tick: number; kind: 'boss'; boss: string; x: number | undefined; y: number | undefined };

/**
 * Flatten waves into the exact spawn list a run will replay.
 *
 * Repeat `k` of a wave lands at `at + k * interval`, offset by `k` steps —
 * so `count: 1` is the wave itself and nothing more, and `interval: 0` puts
 * the whole group on one tick, which is how a formation is written.
 */
function expand(spec: StageSpec): StageSpawn[] {
  const spawns: StageSpawn[] = [];

  for (const wave of sortWaves(spec.waves)) {
    if (isBossWave(wave)) {
      spawns.push({ tick: wave.at, kind: 'boss', boss: wave.boss, x: wave.x, y: wave.y });
      continue;
    }

    const count = wave.count ?? 1;
    const interval = wave.interval ?? 0;
    const stepX = wave.stepX ?? 0;
    const stepY = wave.stepY ?? 0;

    for (let k = 0; k < count; k++) {
      spawns.push({
        tick: wave.at + k * interval,
        kind: 'enemy',
        enemy: wave.enemy,
        x: wave.x + k * stepX,
        y: wave.y + k * stepY,
      });
    }
  }

  // Sorting waves is not enough: a long wave's later repeats interleave with
  // waves that start after it. Stable, so a formation keeps its written order
  // and two waves sharing a tick keep theirs.
  return spawns.sort((a, b) => a.tick - b.tick);
}

/**
 * Drives a stage's spawn schedule against an `EnemySystem`.
 *
 * It spawns and nothing else. It does not step the enemies it created, does
 * not touch bullets, and does not care whether anything it spawned is still
 * alive — a stage is over when its script is over, and clearing the field is
 * the game's business. Keeping those separate is what lets a stage be tested
 * headlessly against a spawn log.
 */
export class StageRunner {
  readonly #enemies: EnemySystem;
  readonly #spawns: readonly StageSpawn[];

  /** Last tick on which this stage is still running. See `finished`. */
  readonly #endTick: number;

  #tick = 0;

  /** Index of the next spawn owed. The schedule is sorted, so this only moves forward. */
  #cursor = 0;

  /** Stopped at a midboss until `resume()`. */
  #waiting = false;
  #cues: BossCue[] = [];

  constructor(spec: StageSpec, enemies: EnemySystem) {
    this.#enemies = enemies;
    validate(spec);
    this.#spawns = expand(spec);

    // Resolve every enemy name now. `EnemySystem.spawn` would throw on a typo
    // anyway, but forty seconds into the stage, from a wave the player was
    // about to meet. Checking at construction fails before the stage starts.
    //
    // This is deliberately not done in `defineStage`: a content file that
    // defines its own enemies would then have to be imported in the right
    // order, and load-order dependence is the exact trap `patterns.ts` was
    // written to avoid.
    //
    // The pattern names inside those specs need the same treatment, and are
    // worse without it: an enemy name is read the moment it spawns, but a
    // pattern name is not read until the slot's `startAt` falls due, so a typo
    // detonates from inside `EnemySystem.step` an arbitrary number of ticks
    // after the enemy the player is already fighting appeared.
    const known = new Set(patternNames());
    const seen = new Set<string>();
    for (const spawn of this.#spawns) {
      // Boss specs are resolved here for the same reason enemy names are: a
      // typo in a midboss would otherwise surface only when the script reached
      // it, which is the deepest point in the stage.
      if (spawn.kind === 'boss') {
        getBossSpec(spawn.boss);
        continue;
      }
      if (seen.has(spawn.enemy)) continue;
      seen.add(spawn.enemy);
      const enemy = getEnemySpec(spawn.enemy);
      for (const slot of enemy.patterns ?? []) {
        if (!known.has(slot.pattern)) {
          throw new Error(
            `stage "${spec.name}": enemy "${spawn.enemy}" uses unknown pattern "${slot.pattern}"`,
          );
        }
      }
    }

    const last = this.#spawns[this.#spawns.length - 1];
    this.#endTick = (last?.tick ?? -1) + (spec.outro ?? 0);
  }

  /**
   * Advance one tick, spawning everything due on it.
   *
   * `rng` is passed through to the enemy system, which draws from it for any
   * randomized motion parameter. Nothing here draws on its own: the schedule
   * is fixed data, and a stage that consumed the sim stream would shift every
   * subsequent bullet by how many enemies it happened to have spawned.
   */
  step(rng: Random = sim): void {
    // Held at a midboss. The tick does not advance either, so every `at` after
    // the boss stays a script tick and the fight's length cannot retime the
    // rest of the stage.
    if (this.#waiting) return;

    while (this.#cursor < this.#spawns.length) {
      const spawn = this.#spawns[this.#cursor];
      if (spawn === undefined || spawn.tick > this.#tick) break;

      if (spawn.kind === 'boss') {
        this.#cues.push({ boss: spawn.boss, x: spawn.x, y: spawn.y });
        this.#waiting = true;
        this.#cursor++;
        return;
      }

      // A refused spawn (pool at its ceiling) still consumes the entry.
      // Retrying it on a later tick would make authored timing depend on how
      // busy the field was, which is exactly the determinism the schedule
      // exists to provide. `EnemySystem.droppedSpawns` already counts these.
      this.#enemies.spawn(spawn.enemy, spawn.x, spawn.y, rng);
      this.#cursor++;
    }

    this.#tick++;
  }

  /**
   * Bosses the schedule has reached. Drained, not delivered by callback — a
   * callback firing mid-schedule would run the caller's boss-spawning code
   * inside this loop.
   */
  drainBossCues(): readonly BossCue[] {
    if (this.#cues.length === 0) return EMPTY_CUES;
    const drained = this.#cues;
    this.#cues = [];
    return drained;
  }

  /** Release the hold. The caller calls this when the midboss is gone. */
  resume(): void {
    this.#waiting = false;
  }

  /** True while the schedule is stopped at a midboss. */
  get waiting(): boolean {
    return this.#waiting;
  }

  /** Ticks elapsed — equivalently, the tick the next `step` will process. */
  get tick(): number {
    return this.#tick;
  }

  /**
   * True once the last wave has spawned and the outro has fully elapsed.
   *
   * The outro is counted in ticks *after* the tick that spawned the last wave,
   * so `outro: 0` finishes the moment that spawn happens and `outro: 60`
   * finishes exactly one second later. A stage with no waves at all is over
   * before it starts.
   *
   * Survivors are not consulted. Whether the player still has enemies to clear
   * is a question about the field, not about the script.
   */
  get finished(): boolean {
    return this.#tick > this.#endTick;
  }

  /** Rewind the schedule. Does not clear the field — the game owns what it spawned. */
  reset(): void {
    this.#tick = 0;
    this.#cursor = 0;
    this.#waiting = false;
    this.#cues = [];
  }
}

// Stage 1 and stage 2 are no longer defined here. They moved into the bundled
// base pack (`src/packs/base-pack.json`, authored by `tools/make-base-pack.ts`) and
// register through the pack injector at boot. This module keeps only the
// `defineStage` machinery and its registry; a stage is pack data now
// (decisions-basepack.md).
