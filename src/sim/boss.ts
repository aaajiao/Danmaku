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
import type { BulletSpec, BulletSystem, FieldBounds } from './bullet';
import { MotionTimeline, MoveVector, type MotionParams, type MotionSegment } from './motion';

/**
 * One pattern a phase runs. `startAt` and `stopAt` are ticks since the *phase*
 * began, not since the boss spawned — a card's script must read the same
 * whether it is the first card or the fifth.
 */
export interface PhasePattern {
  pattern: string;
  options?: Record<string, unknown>;
  startAt?: number;
  stopAt?: number;
}

export interface SpellCard {
  name: string;
  /** Health for this phase. */
  hp: number;
  /**
   * Ticks before it times out. Surviving the timer is a valid clear.
   * Zero or negative means no limit — the phase ends only when drained.
   */
  timeLimit: number;
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
    this.#emitters.length = 0;
    this.#retired.length = 0;
  }

  spawn(name: string, spec: BossSpec, x: number, y: number): void {
    this.name = name;
    this.spec = spec;
    this.x = x;
    this.y = y;
    this.age = 0;
    this.angle = 0;
    this.alive = true;
    this.clean = true;
    this.phaseIndex = 0;
    this.phaseTicks = 0;
    this.hp = spec.phases[0]?.hp ?? 1;

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
        emitter = new Emitter(slot.pattern, this.x, this.y, 'enemy', slot.options);
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
}

export class BossSystem {
  readonly #bounds: FieldBounds;
  readonly #bullets: BulletSystem;

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
    boss.spawn(name, spec, x, y);

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
    boss.beginPhase(0, this.#rng);
    this.#emit('phase-start', 0, boss.clean);
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

    const next = index + 1;
    if (next < boss.spec.phases.length) {
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
/* Example content                                                     */
/* ------------------------------------------------------------------ */

/**
 * The reference boss. Every future boss is a copy of this shape, so it is
 * authored as data and nothing below is known to the system above.
 *
 * Its three phases are the three jobs a fight has to do:
 *
 *   0. a non-spell wave — aimed pressure, short, teaches the player to move;
 *   1. a spell card — a static pattern read rather than dodged, forgiving
 *      enough to survive by standing in the right place;
 *   2. a final spell — the two stacked, plus a clock tight enough that the
 *      player cannot simply outlive it.
 *
 * Everything here lives in this file only until there is a `content/bosses.ts`
 * to hold it.
 */

const SHARD: BulletSpec = {
  style: { sprite: 'scale', r: 0.6, g: 0.85, b: 1, orientToHeading: true },
  radius: 4,
  motion: { r: 2.2, theta: 90 },
};

const PETAL: BulletSpec = {
  style: { sprite: 'petal', r: 1, g: 0.55, b: 0.8 },
  radius: 4,
  // Thrown out fast and braked to a crawl, so the ring hangs in the air long
  // enough to be read before the next one lands on top of it.
  motion: { r: 4, theta: 90, ra: -0.06, rrange: { min: 0.5 } },
};

const NEEDLE: BulletSpec = {
  style: { sprite: 'needle', r: 1, g: 0.9, b: 0.5, orientToHeading: true, additive: true },
  radius: 3,
  motion: { r: 3.4, theta: 90 },
};

defineBoss('sentinel', {
  sprite: 'halo',
  radius: 20,
  width: 56,
  height: 56,
  tint: { r: 0.8, g: 0.9, b: 1 },
  // Drops in from above the field to the usual upper-third station.
  entry: { x: 240, y: 140, ticks: 90 },
  onDeath: 'death.big',
  phases: [
    {
      name: 'Approach',
      hp: 900,
      timeLimit: 60 * 30,
      isSpell: false,
      // A slow horizontal drift, reversed by the timeline so it paces rather
      // than leaves. Aimed fire from a moving source is the whole lesson.
      timeline: [
        { count: 0, motion: { r: 0.9, theta: 0 } },
        { count: 90, motion: { r: 0.9, theta: 180 } },
        { count: 180, jump: 0 },
      ],
      patterns: [
        { pattern: 'aimed-fan', options: { spec: SHARD, count: 5, spread: 34, period: 48 } },
        { pattern: 'spray', options: { spec: SHARD, count: 2, period: 30, spread: 70 }, startAt: 120 },
      ],
    },
    {
      name: 'Sign "Tidal Corolla"',
      hp: 1400,
      timeLimit: 60 * 45,
      isSpell: true,
      bonus: 200000,
      // 'surge' is the registered spell-card background. Nothing reads this
      // field yet; naming a background that does not exist would hand the
      // first reader a throw instead of a screen.
      background: 'surge',
      // Stationary: the card is a shape to be read, and a moving source would
      // smear it into noise.
      motion: { r: 0 },
      patterns: [
        // Two counter-rotating rings. Their offsets drift apart at different
        // rates, so the safe gaps sweep instead of standing still.
        { pattern: 'ring', options: { spec: PETAL, count: 18, period: 42, rotation: 9 } },
        { pattern: 'ring', options: { spec: PETAL, count: 18, period: 42, rotation: -14 }, startAt: 21 },
        // One aimed volley per cycle, so standing in a gap is not free.
        { pattern: 'aimed-fan', options: { spec: NEEDLE, count: 3, spread: 18, period: 96 }, startAt: 60 },
      ],
    },
    {
      name: 'Last Sign "Vigil Unbroken"',
      hp: 1800,
      timeLimit: 60 * 50,
      isSpell: true,
      bonus: 500000,
      // Sways through the top of the field, so the spiral's origin moves and
      // its arms cannot be memorised as fixed lanes.
      timeline: [
        { count: 0, motion: { r: 1.4, theta: 0, w: 2.2 } },
        { count: 160, jump: 0 },
      ],
      patterns: [
        { pattern: 'spiral', options: { spec: NEEDLE, arms: 4, step: 13, period: 4 } },
        // Ring pressure arrives late, once the player has settled into reading
        // the spiral, and is what actually makes the timer matter.
        { pattern: 'ring', options: { spec: PETAL, count: 20, period: 90, rotation: 11 }, startAt: 240 },
        { pattern: 'aimed-fan', options: { spec: SHARD, count: 7, spread: 50, period: 75 }, startAt: 420 },
      ],
    },
  ],
});
