/**
 * Bosses and spell cards.
 *
 * A boss is an enemy with a script: a sequence of phases, each with its own
 * health, time limit, movement and fire. Everything specific to one boss lives
 * in its `BossSpec`, so adding a boss means writing a file — never editing this
 * one. If a phase needs behaviour the schema cannot express, the fix is to
 * extend the schema or add a pattern, never to branch on a boss's name here.
 *
 * ## A phase has exactly one exit
 *
 * Drained or expired, a phase leaves through `#endPhase`. Two exits with two
 * bodies is how a boss ends up stuck in a phase that neither drains (because
 * the timer path forgot to advance) nor expires (because the damage path
 * forgot to re-arm the clock), and a stuck boss is unwinnable. Timing a phase
 * out is a clear, not a failure: the phase ends, the run continues, and only
 * what the game chooses to pay for it differs.
 *
 * ## Entry is not phase 0
 *
 * The boss flies in invulnerable, and phase 0 begins only once it settles.
 * Folding that into phase 0 would mean either a health bar draining before the
 * card is announced or a card whose first seconds cannot be damaged — both are
 * the entry animation leaking into the fight.
 *
 * ## Transitions are announced, not enacted
 *
 * Clearing the field between cards is a game decision: some games erase enemy
 * fire, some convert it to score items, some leave it. So this system emits
 * the transition and reaches into nothing. It holds a `BulletSystem` only
 * because patterns fire into one.
 *
 * Events are recorded rather than dispatched, for the same reason `EnemySystem`
 * records deaths: `damage` is called from the middle of a collision sweep, and
 * a callback firing there would run arbitrary game code while this system is
 * mid-transition. `drainEvents` hands them over at a moment the caller picks.
 */

import { Emitter, patternNames } from '../content/patterns';
import { sim, type Random } from '../core/random';
import type { BulletSystem, FieldBounds } from './bullet';
import {
  activePhaseIndices,
  DEFAULT_DIFFICULTY,
  DIFFICULTIES,
  mergeOptions,
  type Difficulty,
  type DifficultyOverrides,
} from './difficulty';
import type { Spoils } from './item';
import { MotionTimeline, MoveVector, type MotionParams, type MotionSegment } from './motion';

/**
 * One pattern a phase runs. `startAt` and `stopAt` are ticks since the *phase*
 * began, not since the boss spawned — a card's script must read the same
 * whether it is the first card or the fifth.
 */
export interface PhasePattern {
  pattern: string;
  options?: Record<string, unknown>;
  /**
   * Per-tier overrides. `options` is the Normal truth; each tier listed here
   * shallow-merges its fields over it at instantiation (see `mergeOptions`).
   * Omit for a pattern that fires identically on every tier.
   */
  difficulty?: DifficultyOverrides;
  startAt?: number;
  stopAt?: number;
}

export interface SpellCard {
  name: string;
  /**
   * Health for this phase.
   *
   * Does **not** vary by tier in v1: player damage is constant across tiers
   * (see `src/balance.test.ts`), so density is the difficulty axis, not health.
   * A future tier-scaled `hp` would move onto `difficulty`-shaped overrides here.
   */
  hp: number;
  /**
   * Ticks before it times out. Surviving the timer is a valid clear.
   * Zero or negative means no limit — the phase ends only when drained.
   *
   * Like `hp`, fixed across tiers in v1 — the clock is sized from the reference
   * drain, which does not change with difficulty.
   */
  timeLimit: number;
  /**
   * The tiers this card exists on. Absent means every tier. Listing tiers makes
   * a card tier-gated — the genre's Lunatic-only cards are `['lunatic']` — and a
   * boss then fights a different phase sequence per tier. `defineBoss` requires
   * every tier to keep at least one phase, so a boss can never die unfought.
   */
  difficulties?: readonly Difficulty[];
  /** Patterns fired during the phase. */
  patterns: readonly PhasePattern[];
  /** Movement during the phase. */
  motion?: MotionParams;
  /** Overrides `motion` when present; segments re-init the vector as they fall due. */
  timeline?: readonly MotionSegment[];
  /** Bonus for clearing without dying or bombing. Paid by the game, not here. */
  bonus?: number;
  /**
   * Non-spell phases exist too — the attack waves between cards. Only the
   * presentation differs (no card name banner, no timer ring), so this system
   * treats both identically and the flag is for whoever draws the HUD.
   */
  isSpell?: boolean;
  /** Named background for the phase, resolved by the render layer. */
  background?: string;
}

/**
 * One line of a pre-fight exchange. `speaker` is an opaque **portrait name** —
 * a registry string the render layer resolves; the simulation never learns that
 * portraits exist, exactly as a stage names a background it never imports. `text`
 * is plain.
 */
export interface DialogueLine {
  speaker: string;
  text: string;
}

export interface BossSpec {
  /** Atlas cell name. */
  sprite: string;
  /** Collision radius. */
  radius: number;
  /** Rendered size. Defaults to the sprite cell size. */
  width?: number;
  height?: number;
  tint?: { r?: number; g?: number; b?: number };
  /**
   * Where it flies to on entry, and how long that takes. Omit for a boss that
   * is simply already there when it spawns.
   */
  entry?: { x: number; y: number; ticks: number };
  phases: readonly SpellCard[];
  /** Effect name emitted when the last phase ends. Resolved by the effect system. */
  onDeath?: string;
  /**
   * The theme this fight is scored to, by registered track name.
   *
   * Boss-level, unlike `background`, which is per spell card: a fight announces
   * itself with one theme on entry and holds it across its cards, so the music
   * belongs to the boss and not to a phase. (Per-spell-card music is a plausible
   * future — it would move onto `SpellCard` beside `background` and `Run.music`
   * would read the live card first — but nothing wants it yet, so it is not
   * built.) A **string**, resolved by the audio layer, never validated here: the
   * music registry is audio-side and importing it would break the boundary; an
   * unknown name is caught at the point of use, exactly as `background` is. Unset
   * leaves the stage's own track playing.
   */
  music?: string;
  /**
   * The pre-fight exchange, shown before the boss spawns.
   *
   * When present and non-empty, `Run` enters a dialogue phase the moment this
   * boss comes due: the field is cleared, spawning stops, the player moves but
   * cannot act, and each fresh Shot press advances one line; after the last the
   * boss enters exactly as it would have. Dialogue is simulation — it delays the
   * boss and is driven by input — so it lives in the tick-and-mask world and a
   * replay reproduces it (see `Run`). Unset means the boss spawns immediately.
   *
   * Identical for every player character in v1. Per-character variants would move
   * onto a shape keyed by character name here; nothing wants them yet.
   */
  dialogue?: readonly DialogueLine[];
  /**
   * Items showered when the boss dies, by registry name and count. See
   * `Spoils`. Unset means the game layer's default shower — a boss that wants
   * to reward differently declares its own. It used to be a single hardcoded
   * table in `Run`, applied identically to every boss, so a third boss could
   * not pay out differently from the first however it was written.
   */
  spoils?: Spoils;
}

const registry = new Map<string, BossSpec>();

export function defineBoss(name: string, spec: BossSpec): void {
  if (registry.has(name)) {
    throw new Error(`boss "${name}" is already defined`);
  }
  // A phaseless boss spawns, enters, and is instantly defeated — a typo that
  // looks like a working fight until someone plays it.
  if (spec.phases.length === 0) {
    throw new Error(`boss "${name}" must declare at least one phase`);
  }

  // Tier-gating (`SpellCard.difficulties`) can empty a tier's phase sequence,
  // which is the same instant-defeat bug one level down: a boss with every card
  // gated off a tier dies unfought there. Checked at definition, for every tier,
  // so a mis-gated card fails as this file loads rather than mid-fight.
  for (const tier of DIFFICULTIES) {
    if (activePhaseIndices(spec.phases, tier).length === 0) {
      throw new Error(`boss "${name}" has no phase on difficulty "${tier}" — every tier must keep at least one`);
    }
  }

  // Pattern names are otherwise resolved on the tick a slot's `startAt` falls
  // due — for a late slot in a late phase, minutes into a fight the player had
  // to earn. A typo belongs to whoever wrote this file, so it fails as this
  // file loads.
  //
  // Membership, not construction: `create` is content code and may draw from a
  // stream, so calling it here to see whether it throws would move that stream
  // before the run that actually uses the pattern. The cost is that a boss
  // naming a pattern from another module must import that module first — an
  // explicit dependency, which is the right shape for one anyway.
  const known = new Set(patternNames());
  for (const phase of spec.phases) {
    for (const slot of phase.patterns) {
      if (!known.has(slot.pattern)) {
        throw new Error(
          `boss "${name}" phase "${phase.name}" names unknown pattern "${slot.pattern}"`,
        );
      }
    }
  }

  registry.set(name, spec);
}

export function getBossSpec(name: string): BossSpec {
  const spec = registry.get(name);
  if (!spec) throw new Error(`unknown boss "${name}"`);
  return spec;
}

export function bossNames(): readonly string[] {
  return [...registry.keys()];
}

/** Non-throwing existence check, for a validator resolving a name before use. */
export function hasBoss(name: string): boolean {
  return registry.has(name);
}

/** Placeholder for a boss that has never been spawned. */
const UNSPAWNED: BossSpec = {
  sprite: 'orb.large',
  radius: 16,
  phases: [{ name: '', hp: 1, timeLimit: 0, patterns: [] }],
};

export class Boss {
  x = 0;
  y = 0;
  hp = 1;
  age = 0;
  alive = false;
  /** Render rotation, radians. Nothing in the sim writes it; content may. */
  angle = 0;

  readonly vector = new MoveVector();
  readonly timeline = new MotionTimeline();

  spec: BossSpec = UNSPAWNED;
  name = '';

  phaseIndex = 0;
  /** Ticks since the current phase began. Entry does not count toward it. */
  phaseTicks = 0;

  /** True while flying in. The boss is invulnerable and fires nothing. */
  entering = false;

  /** No death and no bomb since this phase began. Read by the transition event. */
  clean = true;

  /** Whether the current phase supplied a timeline. Read by the system's step. */
  hasTimeline = false;

  /** Entry interpolation endpoints, captured at spawn. */
  #fromX = 0;
  #fromY = 0;
  #entryTicks = 0;
  #entryAge = 0;

  /**
   * One slot per phase pattern, in declaration order. Undefined means the slot
   * is not running, which covers both "not started yet" and "finished";
   * `#retired` tells those apart so a stopped pattern is never restarted.
   */
  readonly #emitters: (Emitter | undefined)[] = [];
  readonly #retired: boolean[] = [];

  /** The run's tier, captured at spawn. Selects tier-gated cards and merges. */
  #difficulty: Difficulty = DEFAULT_DIFFICULTY;

  /**
   * Indices into `spec.phases` that exist on this run's tier, computed once at
   * spawn. `phaseIndex` always names a real `spec.phases` slot (events, the HUD
   * and reachability all read it that way); this list is only how the system
   * finds the *next* one, skipping cards gated off the tier.
   */
  #activePhases: number[] = [];

  get phase(): SpellCard {
    const phase = this.spec.phases[this.phaseIndex];
    // Only reachable if phaseIndex ran past the end, which the system prevents
    // by ending the fight instead. Loud, because a silent placeholder phase
    // would look like a boss that fires nothing.
    if (phase === undefined) {
      throw new Error(`boss "${this.name}" has no phase ${this.phaseIndex}`);
    }
    return phase;
  }

  /** Remaining health of the current phase, 1 down to 0. For the health bar. */
  get phaseHpFraction(): number {
    if (this.entering) return 1;
    const max = this.phase.hp;
    if (max <= 0) return 0;
    const fraction = this.hp / max;
    return fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
  }

  /**
   * Remaining time of the current phase, 1 down to 0. For the timer ring.
   * An untimed phase reads as full, so a ring drawn from it simply never moves.
   */
  get phaseTimeFraction(): number {
    const limit = this.phase.timeLimit;
    if (limit <= 0) return 1;
    if (this.entering) return 1;
    const fraction = (limit - this.phaseTicks) / limit;
    return fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
  }

  reset(): void {
    this.alive = false;
    this.entering = false;
    this.age = 0;
    this.phaseIndex = 0;
    this.phaseTicks = 0;
    this.hasTimeline = false;
    // `notePlayerDeath`/`notePlayerBomb` write this without checking `alive`,
    // so a death after the fight ended leaves it false. `spawn` sets it too,
    // but a cleared boss is readable before the next one arrives and must not
    // report the previous fight's cleanliness.
    this.clean = true;
    this.#activePhases.length = 0;
    this.#difficulty = DEFAULT_DIFFICULTY;
    this.#emitters.length = 0;
    this.#retired.length = 0;
  }

  spawn(name: string, spec: BossSpec, x: number, y: number, difficulty: Difficulty = DEFAULT_DIFFICULTY): void {
    this.name = name;
    this.spec = spec;
    this.x = x;
    this.y = y;
    this.age = 0;
    this.angle = 0;
    this.alive = true;
    this.clean = true;
    this.#difficulty = difficulty;
    // `defineBoss` guarantees at least one active phase per tier, so index 0 of
    // the list exists; the `?? 0` only quiets the index-access type.
    this.#activePhases = activePhaseIndices(spec.phases, difficulty);
    this.phaseIndex = this.#activePhases[0] ?? 0;
    this.phaseTicks = 0;
    this.hp = spec.phases[this.phaseIndex]?.hp ?? 1;

    this.#fromX = x;
    this.#fromY = y;
    this.#entryAge = 0;
    this.#entryTicks = spec.entry?.ticks ?? 0;
    this.entering = spec.entry !== undefined && this.#entryTicks > 0;

    this.#emitters.length = 0;
    this.#retired.length = 0;
  }

  /**
   * Advance the fly-in by one tick. Returns true on the tick it settles.
   *
   * Linear interpolation from the spawn point, with the last tick snapping
   * exactly onto the target: accumulating a per-tick delta instead would leave
   * the boss a rounding error away from where its spec says it stands, and
   * every phase's motion would start from there.
   */
  stepEntry(): boolean {
    const entry = this.spec.entry;
    if (entry === undefined) {
      this.entering = false;
      return true;
    }

    this.#entryAge++;
    if (this.#entryAge >= this.#entryTicks) {
      this.x = entry.x;
      this.y = entry.y;
      this.entering = false;
      return true;
    }

    const t = this.#entryAge / this.#entryTicks;
    this.x = this.#fromX + (entry.x - this.#fromX) * t;
    this.y = this.#fromY + (entry.y - this.#fromY) * t;
    return false;
  }

  /** The first `spec.phases` index this run's tier fights. Always exists. */
  firstPhaseIndex(): number {
    return this.#activePhases[0] ?? 0;
  }

  /**
   * The next active `spec.phases` index after `after`, or undefined if that was
   * the last card on this tier — which is how the system knows the fight is won.
   * Skips any card gated off the run's tier.
   */
  nextPhaseIndex(after: number): number | undefined {
    const pos = this.#activePhases.indexOf(after);
    if (pos < 0) return undefined;
    return this.#activePhases[pos + 1];
  }

  /**
   * Arm a phase: its health, its clock, its movement and a fresh set of
   * pattern slots.
   *
   * Slots are rebuilt rather than trimmed — a phase with fewer patterns than
   * its predecessor would otherwise inherit live emitters past the end of its
   * own list and keep firing the previous card's fire.
   */
  beginPhase(index: number, rng: Random): void {
    this.phaseIndex = index;
    this.phaseTicks = 0;
    this.clean = true;

    const phase = this.phase;
    this.hp = phase.hp;

    this.vector.init(phase.motion ?? {}, rng);
    this.hasTimeline = phase.timeline !== undefined;
    if (phase.timeline) this.timeline.reset(phase.timeline);

    const count = phase.patterns.length;
    this.#emitters.length = count;
    this.#retired.length = count;
    for (let i = 0; i < count; i++) {
      this.#emitters[i] = undefined;
      this.#retired[i] = false;
    }
  }

  /**
   * Advance every pattern slot of the current phase. Emitters are built on the
   * tick their `startAt` falls due and dropped at `stopAt`, so a pattern that
   * never runs never costs an allocation, and a finite one stops holding its
   * closure the moment it reports completion.
   */
  stepPatterns(
    bullets: BulletSystem,
    targetX: number,
    targetY: number,
    rng: Random,
  ): void {
    const patterns = this.phase.patterns;

    for (let i = 0; i < patterns.length; i++) {
      const slot = patterns[i];
      if (slot === undefined || this.#retired[i]) continue;

      if (slot.stopAt !== undefined && this.phaseTicks >= slot.stopAt) {
        this.#emitters[i] = undefined;
        this.#retired[i] = true;
        continue;
      }
      if (this.phaseTicks < (slot.startAt ?? 0)) continue;

      let emitter = this.#emitters[i];
      if (emitter === undefined) {
        // The tier's merged options, computed once when the emitter is built —
        // a fresh object per `mergeOptions`, never the shared spec's own.
        const options = mergeOptions(slot.options, slot.difficulty, this.#difficulty);
        emitter = new Emitter(slot.pattern, this.x, this.y, 'enemy', options);
        this.#emitters[i] = emitter;
      }

      // The emitter carries its own position and the boss has just moved.
      emitter.x = this.x;
      emitter.y = this.y;
      emitter.step(bullets, targetX, targetY, rng);

      // A finite pattern reports completion by returning false. Retire the
      // slot, or the next tick would build a fresh emitter and restart it.
      if (!emitter.alive) {
        this.#emitters[i] = undefined;
        this.#retired[i] = true;
      }
    }
  }
}

/**
 * Something the game must react to.
 *
 * `phase-cleared` and `timeout` are the two ways a phase ends and are otherwise
 * the same event: both mean "this phase is over, the next one has begun, clear
 * whatever you clear between cards". They are distinguished only so the game
 * can pay differently for them — the conventional reading is that `clean` on a
 * `phase-cleared` earns `phase.bonus` and a `timeout` earns nothing.
 *
 * `phaseIndex` is always the phase the event is *about*, not the one now
 * running: on a transition it names the phase that just ended, and the
 * `phase-start` that follows names the new one.
 */
export interface BossEvent {
  type: 'entered' | 'phase-start' | 'phase-cleared' | 'timeout' | 'defeated';
  boss: Boss;
  phaseIndex: number;
  /** Whether the phase was cleared without the player dying or bombing. */
  clean?: boolean;
}

export interface BossSystemOptions {
  bounds: FieldBounds;
  bullets: BulletSystem;
  /** The run's tier, fixed for its life. Gates cards and selects tier overrides. */
  difficulty?: Difficulty;
}

export class BossSystem {
  readonly #bounds: FieldBounds;
  readonly #bullets: BulletSystem;
  readonly #difficulty: Difficulty;

  // One boss, reused. There is never a second, so there is no pool: a pool of
  // one is a free list with extra steps.
  readonly #boss = new Boss();

  /** Double-buffered so a drain on a quiet tick still costs no allocation. */
  #events: BossEvent[] = [];
  #spare: BossEvent[] = [];

  /**
   * The generator this fight is running on, remembered from the last `spawn`
   * or `step`.
   *
   * `damage` takes no generator — it is called from a collision sweep, which
   * has no business choosing a stream — yet it can end a phase, and arming the
   * next one draws for any randomized motion. Reaching for the global `sim`
   * there would silently split one fight across two streams the moment a
   * caller drove `step` with anything else, which is exactly the kind of
   * divergence CLAUDE.md rule 2 exists to prevent.
   */
  #rng: Random = sim;

  constructor(options: BossSystemOptions) {
    this.#bounds = options.bounds;
    this.#bullets = options.bullets;
    this.#difficulty = options.difficulty ?? DEFAULT_DIFFICULTY;
  }

  get boss(): Boss | undefined {
    return this.#boss.alive ? this.#boss : undefined;
  }

  get active(): boolean {
    return this.#boss.alive;
  }

  /**
   * Throws on an unknown name: a typo in stage data must not fail silently.
   * Returns undefined if a boss is already up — replacing it would strand the
   * events of a fight still in progress.
   */
  spawn(name: string, x: number, y: number, rng: Random = sim): Boss | undefined {
    if (this.#boss.alive) return undefined;

    this.#rng = rng;
    const spec = getBossSpec(name);
    const boss = this.#boss;
    boss.spawn(name, spec, x, y, this.#difficulty);

    // A boss with no entry is already in place, so phase 0 starts on the same
    // tick — the entry event still fires, because "settled" is what it means
    // and the game hangs card announcements off it.
    if (!boss.entering) this.#settle();
    return boss;
  }

  step(targetX: number, targetY: number, rng: Random = sim): void {
    const boss = this.#boss;
    if (!boss.alive) return;

    this.#rng = rng;

    if (boss.entering) {
      // Nothing else runs during entry: no fire, no clock, no damage. The
      // boss is a moving sprite until it settles.
      if (boss.stepEntry()) this.#settle();
      boss.age++;
      return;
    }

    if (boss.hasTimeline) {
      // Timeline first: a segment falling due this tick must apply before the
      // move it describes.
      boss.timeline.step(boss.vector, rng);
    }

    const context = { age: boss.phaseTicks, x: boss.x, y: boss.y, targetX, targetY };
    boss.vector.step(context, rng);

    boss.x += boss.vector.moveX();
    boss.y += boss.vector.moveY();
    this.#confine(boss);

    // Patterns fire from where the boss now is, and gate on the phase tick it
    // entered with, so `startAt: 0` fires on the phase's very first tick.
    boss.stepPatterns(this.#bullets, targetX, targetY, rng);

    boss.phaseTicks++;
    boss.age++;

    const limit = boss.phase.timeLimit;
    if (limit > 0 && boss.phaseTicks >= limit) this.#endPhase('timeout');
  }

  /** Returns true if this damage cleared the current phase. */
  damage(amount: number): boolean {
    const boss = this.#boss;
    // Invulnerable while flying in, and after the last phase there is nothing
    // left to hit — a shot landing on the tick the fight ended must not open
    // a phase that does not exist.
    if (!boss.alive || boss.entering) return false;

    boss.hp -= amount;
    if (boss.hp > 0) return false;

    // Overkill is discarded rather than carried into the next phase. Carrying
    // it would let one well-timed bomb delete a card the player never saw.
    boss.hp = 0;
    this.#endPhase('phase-cleared');
    return true;
  }

  /** The game calls these so a phase knows whether it was cleared cleanly. */
  notePlayerDeath(): void {
    this.#boss.clean = false;
  }

  notePlayerBomb(): void {
    this.#boss.clean = false;
  }

  /**
   * Events recorded since the last drain, oldest first.
   *
   * The returned array is recycled by the next drain — read it or copy it
   * before then.
   */
  drainEvents(): readonly BossEvent[] {
    const drained = this.#events;
    this.#events = this.#spare;
    this.#events.length = 0;
    this.#spare = drained;
    return drained;
  }

  /**
   * Remove the boss. Clearing is not defeating, so it records no events — but
   * it also does not discard events already recorded, which are real and still
   * owed to the caller.
   */
  clear(): void {
    this.#boss.reset();
  }

  /** The fly-in is over: announce it, then arm phase 0. */
  #settle(): void {
    const boss = this.#boss;
    boss.entering = false;
    this.#emit('entered', 0);
    // The first card the tier fights — not necessarily `spec.phases[0]`, which a
    // tier gate may skip. `defineBoss` guarantees this index exists.
    const first = boss.firstPhaseIndex();
    boss.beginPhase(first, this.#rng);
    this.#emit('phase-start', first, boss.clean);
  }

  /**
   * The single exit from a phase, whichever way it was reached.
   *
   * Both callers arrive here having already decided *why*; everything after —
   * the transition event, advancing the index, arming the next card or ending
   * the fight — is identical, and keeping it identical is what stops a boss
   * from stalling in a phase whose clock was never re-armed.
   */
  #endPhase(type: 'phase-cleared' | 'timeout'): void {
    const boss = this.#boss;
    const index = boss.phaseIndex;
    this.#emit(type, index, boss.clean);

    // The next card on this tier, skipping any gated off it. Undefined means
    // `index` was the last active phase, so the fight is won.
    const next = boss.nextPhaseIndex(index);
    if (next !== undefined) {
      boss.beginPhase(next, this.#rng);
      this.#emit('phase-start', next, boss.clean);
      return;
    }

    // Defeat is emitted before the boss is torn down, so the event still
    // carries a position worth spawning an explosion at.
    this.#emit('defeated', index, boss.clean);
    boss.alive = false;
  }

  #emit(type: BossEvent['type'], phaseIndex: number, clean?: boolean): void {
    this.#events.push({ type, boss: this.#boss, phaseIndex, clean });
  }

  /**
   * Keep the boss inside the field.
   *
   * Enemies are culled when they leave; a boss cannot be, because the fight
   * does not end until its phases do. A card whose motion walks it off the
   * edge would otherwise be unkillable — the sprite gone, its fire still
   * arriving. Clamping makes a mis-authored path look wrong on screen, which
   * is a bug someone can see and fix.
   */
  #confine(boss: Boss): void {
    const r = boss.spec.radius;
    const maxX = this.#bounds.width - r;
    const maxY = this.#bounds.height - r;
    if (boss.x < r) boss.x = r;
    else if (boss.x > maxX) boss.x = maxX;
    if (boss.y < r) boss.y = r;
    else if (boss.y > maxY) boss.y = maxY;
  }
}

/* ------------------------------------------------------------------ */
/* The damage model every boss is tuned against                        */
/* ------------------------------------------------------------------ */
//
// The bosses themselves — sentinel, and stage-2's warden/magistrate — are no
// longer defined here. They moved into the bundled base pack
// (`src/packs/base-pack.json`, authored by `tools/make-base-pack.ts`) and register
// through the pack injector at boot, where a pack spell card declares `hpSeconds`
// and the injector applies `phaseHp`/`phaseClock` below exactly as this file's
// bosses used to. What stays here is the mechanism, the registry, and this damage
// model — the numbers a pack's `hpSeconds` is turned into, kept measured by
// `src/balance.test.ts` (decisions-basepack.md).

/**
 * Damage per tick a competent player sustains on a boss.
 *
 * **Measured, and kept measured.** `src/balance.test.ts` drives the real
 * `Run` with every shipped character at every reachable power tier and fails if
 * this constant stops describing them. That test is the whole point of the
 * constant existing: the number it replaces was a literal, typed once, and
 * everything downstream inherited it without anyone able to check it.
 *
 * What it replaced was wrong twice over. It read 0.56, taken from "an immortal
 * probe at full power" — a power level `addPower` clamped to 0, so no player
 * could reach it — and the rate actually reachable at the time was about 0.40.
 * `sentinel` was then sized so its phases needed more ticks than their clocks
 * allowed, and `stage-2.ts` read that, concluded the reference was far too
 * generous, and sized its own bosses an order of magnitude *below* it. The
 * midboss ended up with less health than two `bastion` trash enemies. One
 * unverifiable literal, and every consumer of it went wrong in a different
 * direction.
 *
 * The figure is the weakest ship at one power tier, unfocused — not the
 * ceiling. Nobody holds the ceiling for a whole fight.
 */
export const REFERENCE_DPS = 1.125;

/**
 * The weakest rate a player who has collected *anything* is flying at.
 *
 * Explicitly **not** the absolute minimum. Bare tier 0 with no options measures
 * 0.333, but arriving at a boss having picked up nothing at all is a failure
 * state, and sizing every clock for it would make timing out impossible for
 * anyone else — a spell card's timer is meant to be a real second exit, not
 * decoration. This is one power tier in, unfocused, on the weaker ship for that
 * loadout: measured 0.403.
 *
 * Time limits are derived from this rather than from `REFERENCE_DPS`, so that
 * **every phase is drainable by every loadout a real player arrives with**. A
 * phase whose clock expires before its health can be spent is not a difficulty
 * setting, it is a cutscene: the fight lasts exactly as long either way and
 * nothing the player does changes the outcome. Every non-spell opening phase in
 * the game was one.
 */
export const FLOOR_DPS = 0.4;

/** Phase health for a phase intended to last `seconds` against a good player. */
export function phaseHp(seconds: number): number {
  return Math.round((REFERENCE_DPS * seconds * 60) / 10) * 10;
}

/**
 * How long a phase's timer runs: **twice** what a competent player needs.
 *
 * Not `hp / FLOOR_DPS`, which was the first attempt. Sizing the clock so the
 * weakest arrival loadout drains it exactly means a good player uses a third of
 * the timer, the timer stops being a real exit, and a player who never fires
 * still gets to sit through 183 seconds of boss. Twice the reference drain is
 * the genre's own answer: a good player finishes at half distance, a weak one
 * times out, and timing out is a clear worth a quarter of the card.
 *
 * The property that actually matters — the one whose absence made every
 * non-spell opening phase a cutscene — is that the clock is comfortably longer
 * than the health takes to spend at a rate the player can reach. That is what
 * `src/balance.test.ts` asserts, and it is what a factor of two buys.
 */
export const CLOCK_MARGIN = 2;

export function phaseClock(hp: number): number {
  return Math.ceil((hp / REFERENCE_DPS) * CLOCK_MARGIN / 10) * 10;
}
