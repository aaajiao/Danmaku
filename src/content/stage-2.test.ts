/**
 * Stage 2 — the checks a level actually needs.
 *
 * Three jobs, in order of how expensive the failure is:
 *
 *   1. **Every name resolves.** A stage is a graph of registry lookups —
 *      enemy → pattern → bullet spec → motion behaviour, boss → phase →
 *      pattern → spec → behaviour — and most of those edges are followed for
 *      the first time deep inside a fight. `MoveVector.init` throws on an
 *      unknown behaviour name, and it throws on the tick the bullet spawns:
 *      a typo in `COLUMN.motion.behaviour` would detonate forty seconds in,
 *      from inside the third card. These tests walk the authored data itself
 *      rather than a list written alongside it, so a name added to the stage
 *      without being added here still gets checked.
 *
 *   2. **It finishes.** A stage that cannot be completed is not a difficulty
 *      problem, it is a bug, and a boss phase that neither drains nor expires
 *      is the specific way that happens.
 *
 *   3. **It is deterministic, fingerprinted as a TRACE.** Comparing two runs
 *      at their end proves nothing here — see the negative control at the
 *      bottom, which builds two runs whose *final samples are identical* and
 *      whose paths are not. Determinism is the product, so it is checked over
 *      the whole flight, sampled every 60 ticks.
 *
 * ## The harness is a conductor, not `Run`
 *
 * `StageRunner` itself now holds the schedule at a midboss — `stage.step`
 * returns without advancing while `stage.waiting` is true, and stays that way
 * until `resume()` is called (see `BossWave`, `drainBossCues` and `resume` in
 * `./stage`). The harness below still has to *be* the conductor, the same way
 * `Run.#sendBoss` is: drain the cue, spawn the boss, and resume once it is
 * gone. It has no `Player`: survival is not what these tests measure, and a
 * dodging player would make every number below a statement about the dodge
 * instead of about the stage.
 *
 * Damage is therefore a **model**: a constant budget per tick, spent on the
 * boss if one is up and on the nearest enemy otherwise. The rate is
 * `REFERENCE_DPS`, imported from `sim/boss.ts` and re-derived from the real
 * `Run` by `game/balance.test.ts` on every test run. The budget test sweeps a
 * band around it rather than trusting one point.
 *
 * It used to say 0.56 and call that "measured". It was measured at a power
 * level `addPower` clamped to zero, so it described no player who has ever
 * existed, and both this file's boss health and `sentinel`'s were sized from it
 * in opposite directions. A tuning constant that cannot be re-derived is worse
 * than none.
 */

import { describe, expect, test } from 'bun:test';

import { Random } from '../core/random';
import { sinDeg } from '../core/trig';
import { BossSystem, getBossSpec, REFERENCE_DPS, type SpellCard } from '../sim/boss';
import { BulletSystem, type BulletSpec, type FieldBounds } from '../sim/bullet';
import { EnemySystem, getEnemySpec, type EnemySpec } from '../sim/enemy';
import { getItemSpec } from '../sim/item';
import { getBehaviour, type MotionParams } from '../sim/motion';
import { patternNames } from './patterns';
import { getStage, StageRunner } from './stage';
import { STAGE_2_BOSS, STAGE_2_MIDBOSS } from './stage-2';

const BOUNDS: FieldBounds = { width: 480, height: 480, margin: 48 };

/**
 * The rate the game is tuned against, imported rather than restated.
 *
 * This was a local literal, `0.56`, and it was wrong: measured at a power level
 * `addPower` clamped to 0, so no player could fly at it. `game/balance.test.ts`
 * now re-derives `REFERENCE_DPS` from the real `Run` on every test run, which
 * is what makes the numbers below re-checkable rather than inherited.
 */
const MEASURED_DPS = REFERENCE_DPS;

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

interface Sample {
  tick: number;
  bullets: number;
  enemies: number;
  /** Positional digest of the whole field. */
  digest: string;
}

interface Report {
  ticks: number;
  scriptTicks: number;
  /**
   * Ticks spent with `stage.waiting` true — the midboss fight, entry
   * included. `scriptTicks + heldTicks === ticks`, always: every tick either
   * advances the script or is held at it, never both and never neither.
   */
  heldTicks: number;
  enemiesSpawned: number;
  peakBullets: number;
  peakEnemies: number;
  droppedEnemySpawns: number;
  droppedBulletSpawns: number;
  midbossTicks: number;
  bossTicks: number;
  cleared: boolean;
  samples: Sample[];
}

/**
 * Fixed-point rounding before the digest.
 *
 * Positions are floats and the digest is a string, so the two runs being
 * compared must agree on how a float becomes text. Six decimals is far tighter
 * than any drift this catches — a 1-ULP divergence in `sinDeg` would not show
 * here, but it is not meant to: this compares two runs of *this* engine, and
 * the cross-engine guard is `determinism.test.ts`'s source scan.
 */
function fixed(value: number): string {
  return value.toFixed(6);
}

/**
 * Play the stage headlessly and report what happened.
 *
 * The virtual player sweeps the bottom of the field on a sinusoid so aimed
 * fire has something moving to aim at — a stationary target would make every
 * `aimed-fan` in the stage fire the same volley forever, and both the bullet
 * peak and the trace would be measuring a degenerate case.
 *
 * ## Sending bosses
 *
 * `stage.step` is called every tick, unconditionally — exactly as `Run.tick`
 * calls it. It is what makes the hold at the midboss real rather than
 * something the caller has to remember: `step` itself no-ops while
 * `stage.waiting`, so nothing here needs to know a boss is up in order to
 * avoid racing its own schedule.
 *
 * What *is* this conductor's job, because `StageRunner` cannot do it for
 * itself, is releasing whichever boss is owed: a cue the schedule just
 * reached, or — once the script is spent and the field is clear — the stage
 * boss, which (unlike the midboss) has no wave of its own and is sent the same
 * way `RunConfig.boss` is. That is `sendBoss` below, and it mirrors
 * `Run.#sendBoss` step for step, including checking the cue first: the
 * schedule is already held at it, so checking the end-of-script boss first
 * would try to put two bosses on the field with one health bar between them.
 */
function play(options: { seed?: number; dps?: number; sampleEvery?: number } = {}): Report {
  const dps = options.dps ?? MEASURED_DPS;
  const sampleEvery = options.sampleEvery ?? 60;
  // The stage's own declared seed, so an omitted seed is the authored run
  // rather than an arbitrary one that happens to be zero.
  const seed = options.seed ?? getStage('stage-2').seed ?? 0;

  const rng = new Random(seed);
  const bullets = new BulletSystem({ bounds: BOUNDS, initial: 4000 });
  const enemies = new EnemySystem({ bounds: BOUNDS, bullets, initial: 64 });
  const boss = new BossSystem({ bounds: BOUNDS, bullets });
  const stage = new StageRunner(getStage('stage-2'), enemies);

  let midbossStart = 0;
  let midbossEnd = 0;
  let bossSent = false;
  let bossStart = 0;
  let bossDone = false;
  let heldTicks = 0;

  let budget = 0;
  let tick = 0;
  let enemiesSpawned = 0;
  let peakBullets = 0;
  let peakEnemies = 0;
  const samples: Sample[] = [];

  /** `Run.#sendBoss`, transcribed for a harness with no `Run` to call. */
  function sendBoss(): void {
    for (const cue of stage.drainBossCues()) {
      midbossStart = tick;
      boss.spawn(cue.boss, cue.x ?? BOUNDS.width / 2, cue.y ?? -60, rng);
      return;
    }

    if (stage.waiting && !boss.active) stage.resume();

    if (bossSent) return;
    if (!stage.finished || enemies.count > 0 || boss.active) return;
    bossSent = true;
    bossStart = tick;
    boss.spawn(STAGE_2_BOSS, BOUNDS.width / 2, -60, rng);
  }

  // Bounded rather than `while (true)`: a stage that cannot finish must fail
  // the assertion, not hang the suite.
  for (; tick < 20000; tick++) {
    const px = 240 + 150 * sinDeg(tick * 0.7);
    const py = 400;

    const before = enemies.count;
    stage.step(rng);
    // Sampled immediately after `step`, before anything can call `resume`:
    // this is the one moment that tells the truth about whether *this* call
    // advanced the script or was held at it.
    if (stage.waiting) heldTicks++;
    enemiesSpawned += Math.max(0, enemies.count - before);

    sendBoss();

    enemies.step(px, py, rng);
    boss.step(px, py, rng);
    bullets.step(px, py, rng);

    budget += dps;
    while (budget >= 1) {
      budget -= 1;
      const live = boss.boss;
      if (live !== undefined && !live.entering) {
        boss.damage(1);
      } else {
        const target = enemies.nearest(px, py);
        if (target === undefined) {
          // Nothing to shoot: drop the surplus rather than bank it, or the
          // first enemy of the next wave would evaporate on arrival.
          budget = 0;
          break;
        }
        enemies.damage(target, 1);
      }
    }

    enemies.drainDeaths();
    for (const event of boss.drainEvents()) {
      if (event.type !== 'defeated') continue;
      if (event.boss.name === STAGE_2_MIDBOSS.boss) {
        midbossEnd = tick;
      } else {
        bossDone = true;
      }
    }

    if (bullets.bullets.length > peakBullets) peakBullets = bullets.bullets.length;
    if (enemies.count > peakEnemies) peakEnemies = enemies.count;

    if (tick % sampleEvery === 0) {
      const parts: string[] = [];
      for (const b of bullets.bullets) {
        parts.push(
          `b${fixed(b.x)},${fixed(b.y)},${fixed(b.vector.theta)},${fixed(b.length)},${b.lethal ? 1 : 0}`,
        );
      }
      for (const e of enemies.enemies) {
        parts.push(`e${e.name},${fixed(e.x)},${fixed(e.y)},${e.hp}`);
      }
      const live = boss.boss;
      if (live !== undefined) {
        parts.push(`B${live.name},${fixed(live.x)},${fixed(live.y)},${live.phaseIndex},${live.hp}`);
      }
      samples.push({
        tick,
        bullets: bullets.bullets.length,
        enemies: enemies.count,
        digest: parts.join('|'),
      });
    }

    if (bossDone && stage.finished && enemies.count === 0) {
      tick++;
      break;
    }
  }

  return {
    ticks: tick,
    scriptTicks: stage.tick,
    heldTicks,
    enemiesSpawned,
    peakBullets,
    peakEnemies,
    droppedEnemySpawns: enemies.droppedSpawns,
    droppedBulletSpawns: bullets.droppedSpawns,
    midbossTicks: midbossEnd - midbossStart,
    bossTicks: bossDone ? tick - bossStart : 0,
    cleared: bossDone,
    samples,
  };
}

function trace(report: Report): string {
  return report.samples.map((s) => `${s.tick}:${s.digest}`).join('\n');
}

/* ------------------------------------------------------------------ */
/* Walking the authored data                                           */
/* ------------------------------------------------------------------ */

/**
 * Every bullet spec the stage can ever fire, pulled out of the pattern options
 * the enemies and bosses actually declare.
 *
 * This is the point of walking the data rather than exporting the specs: a
 * pattern slot whose `options.spec` was never wired up, or was wired to
 * something that is not a bullet spec at all, is invisible to a hand-written
 * list and shows up here.
 */
function specsIn(slots: readonly { options?: Record<string, unknown> }[]): BulletSpec[] {
  const out: BulletSpec[] = [];
  for (const slot of slots) {
    const spec = slot.options?.['spec'];
    if (spec !== undefined) out.push(spec as BulletSpec);
  }
  return out;
}

/** Every `MotionParams` an enemy spec can hand to a `MoveVector`. */
function motionsOf(spec: EnemySpec | SpellCard): MotionParams[] {
  const out: MotionParams[] = [];
  if (spec.motion) out.push(spec.motion);
  for (const segment of spec.timeline ?? []) {
    if (segment.motion) out.push(segment.motion);
  }
  return out;
}

const STAGE = getStage('stage-2');
const ENEMY_NAMES = [
  ...new Set(
    STAGE.waves.flatMap((w) => ('enemy' in w ? [w.enemy] : [])),
  ),
];
const BOSS_NAMES = [STAGE_2_MIDBOSS.boss, STAGE_2_BOSS];

describe('stage-2 names resolve', () => {
  test('every wave names a registered enemy', () => {
    for (const name of ENEMY_NAMES) {
      expect(() => getEnemySpec(name)).not.toThrow();
    }
    // The stage is meant to prove the enemy registry works by using it, so it
    // must not be quietly running on stage 1's cast.
    expect(ENEMY_NAMES.length).toBeGreaterThanOrEqual(5);
    for (const legacy of ['grunt', 'weaver', 'turret']) {
      expect(ENEMY_NAMES).not.toContain(legacy);
    }
  });

  test('both bosses are registered and each has at least three phases', () => {
    for (const name of BOSS_NAMES) {
      const spec = getBossSpec(name);
      expect(spec.phases.length).toBeGreaterThanOrEqual(3);
    }
  });

  test('every pattern named by an enemy or a boss phase is registered', () => {
    const known = new Set(patternNames());
    for (const name of ENEMY_NAMES) {
      for (const slot of getEnemySpec(name).patterns ?? []) {
        expect(known).toContain(slot.pattern);
      }
    }
    for (const name of BOSS_NAMES) {
      for (const phase of getBossSpec(name).phases) {
        for (const slot of phase.patterns) {
          expect(known).toContain(slot.pattern);
        }
      }
    }
  });

  test('every pattern slot supplies a bullet spec', () => {
    // `requireSpec` throws at emitter-construction time, which for a late slot
    // in a late phase is minutes into a fight the player had to earn.
    for (const name of ENEMY_NAMES) {
      const slots = getEnemySpec(name).patterns ?? [];
      expect(specsIn(slots).length).toBe(slots.length);
    }
    for (const name of BOSS_NAMES) {
      for (const phase of getBossSpec(name).phases) {
        expect(specsIn(phase.patterns).length).toBe(phase.patterns.length);
      }
    }
  });

  test('every motion behaviour named anywhere in the stage is registered', () => {
    const named = new Set<string>();

    const collect = (motion: MotionParams | undefined): void => {
      if (motion?.behaviour) named.add(motion.behaviour);
    };

    for (const name of ENEMY_NAMES) {
      const spec = getEnemySpec(name);
      motionsOf(spec).forEach(collect);
      for (const bullet of specsIn(spec.patterns ?? [])) {
        collect(bullet.motion);
        for (const segment of bullet.timeline ?? []) collect(segment.motion);
      }
    }
    for (const name of BOSS_NAMES) {
      for (const phase of getBossSpec(name).phases) {
        motionsOf(phase).forEach(collect);
        for (const bullet of specsIn(phase.patterns)) {
          collect(bullet.motion);
          for (const segment of bullet.timeline ?? []) collect(segment.motion);
        }
      }
    }

    // Not an assertion about which behaviours are used, but about the file
    // exercising the new ones at all: a stage that names none of them proves
    // nothing about the registry it was written to test.
    expect([...named].sort()).toEqual(['accelerate-to', 'homing', 'orbit', 'waver']);
    for (const behaviour of named) {
      expect(getBehaviour(behaviour)).toBeDefined();
    }
  });

  test('the stage fires lasers, and their telegraphs are real', () => {
    const beams: BulletSpec[] = [];
    for (const name of ENEMY_NAMES) {
      for (const b of specsIn(getEnemySpec(name).patterns ?? [])) {
        if (b.laser) beams.push(b);
      }
    }
    for (const name of BOSS_NAMES) {
      for (const phase of getBossSpec(name).phases) {
        for (const b of specsIn(phase.patterns)) {
          if (b.laser) beams.push(b);
        }
      }
    }
    expect(beams.length).toBeGreaterThan(0);

    for (const beam of beams) {
      const laser = beam.laser;
      if (laser === undefined) continue;
      // A beam that is lethal on the tick it appears is a coin flip, not a
      // pattern — there is no information in the field before it kills.
      expect(laser.warmup ?? 0).toBeGreaterThan(0);
      // And one that outlives its own emitter's departure leaves a live line
      // behind a sprite that is no longer there.
      expect(beam.life ?? 0).toBeGreaterThan(laser.warmup ?? 0);
    }
  });

  test('the item names a cleared stage pays out resolve', () => {
    // `Run` showers these on a boss defeat. Stage 2 ends on a boss, so a typo
    // in that table would only ever surface on the last tick of a full clear.
    for (const item of ['power', 'big-power', 'score', 'bomb', 'life']) {
      expect(() => getItemSpec(item)).not.toThrow();
    }
  });
});

/* ------------------------------------------------------------------ */
/* Shape                                                               */
/* ------------------------------------------------------------------ */

describe('stage-2 has the shape it claims', () => {
  test('the midboss cue falls inside the script, with room on both sides', () => {
    const last = STAGE.waves[STAGE.waves.length - 1];
    expect(last).toBeDefined();
    expect(STAGE_2_MIDBOSS.at).toBeGreaterThan(0);
    expect(STAGE_2_MIDBOSS.at).toBeLessThan(last?.at ?? 0);

    // The midboss is now itself a `BossWave` at `STAGE_2_MIDBOSS.at`, so a
    // same-tick filter necessarily finds it — a "no collisions" check built
    // that way would just be asserting the boss wave exists. What actually
    // matters survives the schema change intact: nothing else shares its
    // tick (it does not land on top of another wave's spawn), and it sits
    // between enemy waves rather than at either edge of the script.
    const atTick = STAGE.waves.filter((w) => w.at === STAGE_2_MIDBOSS.at);
    expect(atTick).toEqual([
      { at: STAGE_2_MIDBOSS.at, boss: STAGE_2_MIDBOSS.boss, x: STAGE_2_MIDBOSS.x, y: STAGE_2_MIDBOSS.y },
    ]);

    const enemyWaves = STAGE.waves.filter((w) => 'enemy' in w);
    expect(enemyWaves.some((w) => w.at < STAGE_2_MIDBOSS.at)).toBe(true);
    expect(enemyWaves.some((w) => w.at > STAGE_2_MIDBOSS.at)).toBe(true);
  });

  test('every boss phase can end: it either drains or expires', () => {
    for (const name of BOSS_NAMES) {
      for (const phase of getBossSpec(name).phases) {
        expect(phase.hp).toBeGreaterThan(0);
        // A phase with no clock is not a bug — `sim/boss.ts` allows it — but
        // in this stage every phase is on one, because the run budget below is
        // only bounded if they are.
        expect(phase.timeLimit).toBeGreaterThan(0);
      }
    }
  });

  test('the worst case — every phase timed out — is still bounded', () => {
    let worst = 0;
    for (const name of BOSS_NAMES) {
      const spec = getBossSpec(name);
      worst += spec.entry?.ticks ?? 0;
      for (const phase of spec.phases) worst += phase.timeLimit;
    }
    // A player who never fires still gets through both fights in a bounded
    // time. Without this the stage's length would be unbounded from above,
    // since a timeout is a valid clear.
    //
    // The bound is 140 seconds, not the 45 it was, and the change is the whole
    // retune: these bosses used to hold 60 to 125 hp — less than a `bastion` —
    // so their clocks were short because there was nothing behind them. A
    // midboss and a final boss that are actually fights cost real time, and
    // `CLOCK_MARGIN` fixes the ratio between the clock and the health so this
    // number cannot drift on its own.
    expect(worst).toBeLessThan(60 * 140);
  });
});

/* ------------------------------------------------------------------ */
/* The hold                                                            */
/* ------------------------------------------------------------------ */

/**
 * `BossWave`'s whole mechanism, exercised directly against `StageRunner`
 * rather than through `play`'s full simulation — these three are about the
 * hold itself, not about the stage's pacing or its numbers.
 */
describe('the midboss genuinely holds the schedule', () => {
  test('stage.tick does not advance while stage.waiting is true', () => {
    const bullets = new BulletSystem({ bounds: BOUNDS, initial: 200 });
    const enemies = new EnemySystem({ bounds: BOUNDS, bullets, initial: 32 });
    const stage = new StageRunner(getStage('stage-2'), enemies);
    const rng = new Random(1);

    while (!stage.waiting) stage.step(rng);
    // The wave that raised the cue is a script tick, same as any other.
    expect(stage.tick).toBe(STAGE_2_MIDBOSS.at);

    const heldAt = stage.tick;
    for (let i = 0; i < 2000; i++) {
      stage.step(rng);
      expect(stage.tick).toBe(heldAt);
    }

    stage.resume();
    stage.step(rng);
    expect(stage.tick).toBeGreaterThan(heldAt);
  });

  test('waves authored after the midboss spawn only once it is defeated, not during', () => {
    const bullets = new BulletSystem({ bounds: BOUNDS, initial: 200 });
    const enemies = new EnemySystem({ bounds: BOUNDS, bullets, initial: 32 });
    const stage = new StageRunner(getStage('stage-2'), enemies);
    const rng = new Random(1);

    while (!stage.waiting) stage.step(rng);
    stage.drainBossCues();

    const countAtHold = enemies.count;
    // The next wave in the script (a pair of censers) is authored 60 script
    // ticks after the midboss, at 1200. Stepping well past that point without
    // resuming proves the hold rather than just the counter: nothing the
    // schedule owns pours in while the boss is up, however long the fight
    // actually takes.
    for (let i = 0; i < 500; i++) {
      stage.step(rng);
      expect(enemies.count).toBe(countAtHold);
    }

    stage.resume();
    // 60 script ticks to reach `at: 1200`, plus the call that actually spawns
    // what is due on it.
    for (let i = 0; i < 61; i++) stage.step(rng);
    expect(enemies.count).toBeGreaterThan(countAtHold);
  });

  test('held ticks plus script ticks equal total run ticks', () => {
    const report = play({ seed: 0x2b0f91 });
    // Both halves of the sum have to be real for the identity to mean
    // anything — a run that never held, or one whose script never advanced,
    // would satisfy the arithmetic trivially.
    expect(report.heldTicks).toBeGreaterThan(0);
    expect(report.scriptTicks).toBeGreaterThan(0);
    expect(report.heldTicks + report.scriptTicks).toBe(report.ticks);
  });
});

/* ------------------------------------------------------------------ */
/* It finishes, and at what cost                                       */
/* ------------------------------------------------------------------ */

describe('stage-2 plays', () => {
  test('it finishes, and the report is the one recorded in the header', () => {
    const report = play({ seed: 0x2b0f91 });

    expect(report.cleared).toBe(true);
    // Bounded well below the harness's 20000-tick ceiling, so "finished" means
    // finished rather than "ran out of patience". Roughly two minutes: about a
    // minute of script and a minute of boss, which is what a stage with a real
    // midboss and a real final boss costs.
    expect(report.ticks).toBeLessThan(8000);

    // `scriptTicks` (`stage.tick`) freezes only while `stage.waiting` is
    // true. It is not gated by `finished`, so it keeps counting through the
    // magistrate fight too — the stage boss is not a wave, so nothing holds
    // the schedule for it. That makes this number depend on the damage model
    // now, where it did not before the midboss existed; it is exact for this
    // seed at the header's measured rate, same as everything else here.
    // 3246 before the boss retune, and the comment above predicted exactly why
    // it would move: the schedule keeps counting through the magistrate fight,
    // so a boss that is now a real fight adds its length here.
    expect(report.scriptTicks).toBe(5123);
    expect(report.enemiesSpawned).toBe(70);

    // Nothing was refused. A dropped spawn means the authored timing already
    // is not what plays, which is the failure the pools exist to make visible.
    expect(report.droppedEnemySpawns).toBe(0);
    expect(report.droppedBulletSpawns).toBe(0);

    // Load. The pool is initialised at 4000 bullets, so this is comfortable —
    // it is pinned to catch a retune that quietly triples the field, not
    // because the ceiling is near.
    expect(report.peakBullets).toBeLessThan(400);
    expect(report.peakEnemies).toBeLessThan(30);
  });

  test('the run lands in its budget across the plausible range of player damage', () => {
    // One damage rate proves nothing: `REFERENCE_DPS` is what a competent
    // player lands on a *boss* while tracking it, and a real run is faster
    // against chaff and slower while dodging. So the budget is asserted over a
    // band around the reference, not at a point.
    for (const dps of [REFERENCE_DPS * 0.8, REFERENCE_DPS, REFERENCE_DPS * 1.25]) {
      const report = play({ dps, sampleEvery: 100000 });
      expect(report.cleared).toBe(true);
      expect(report.ticks).toBeGreaterThan(60 * 80);
      expect(report.ticks).toBeLessThan(60 * 190);
    }
  });

  test('a weaker player takes longer but still clears', () => {
    const weak = play({ dps: 0.4, sampleEvery: 100000 });
    const strong = play({ dps: 1.2, sampleEvery: 100000 });
    expect(weak.cleared).toBe(true);
    expect(strong.cleared).toBe(true);
    expect(weak.ticks).toBeGreaterThan(strong.ticks);
  });
});

/* ------------------------------------------------------------------ */
/* Determinism, as a trace                                             */
/* ------------------------------------------------------------------ */

describe('stage-2 is deterministic', () => {
  test('the same seed reproduces the whole trace, not just the endpoint', () => {
    expect(trace(play({ seed: 0x2b0f91 }))).toBe(trace(play({ seed: 0x2b0f91 })));
  });

  test('the trace is dense enough to be worth comparing', () => {
    const report = play({ seed: 0x2b0f91 });
    // A trace of two samples would pass the test above while proving almost
    // nothing, so the sampling itself is pinned.
    expect(report.samples.length).toBeGreaterThan(50);
    const nonEmpty = report.samples.filter((s) => s.digest.length > 0);
    expect(nonEmpty.length).toBeGreaterThan(45);
  });

  /**
   * The negative control, and the reason this file traces rather than compares
   * endpoints.
   *
   * `spray` is the only pattern in the stage that draws from the generator, so
   * two seeds diverge exactly where a scatter is in the air: the warden's
   * opening phase, the two bastions, and the magistrate's arraignment. That is
   * genuinely most of the run — and it is also **transient**. Scatter bullets
   * leave the field, the enemy that fired them dies, and the two runs come
   * back together. Between the warden and the first bastion the traces agree
   * again for several hundred ticks, and after the last scatter clears they
   * agree for the rest of the fight, because every spell card is authored
   * shapes and draws nothing.
   *
   * So the final sample is **byte-identical across seeds**. An endpoint
   * comparison of two different seeds would report these as the same run, and
   * a determinism test built that way would pass while measuring nothing. This
   * one asserts in both directions: the endpoints must match, the traces must
   * not, and the divergence must span a wide window rather than one stray
   * tick.
   *
   * If a change ever makes the endpoints differ, this test fails — correctly.
   * At that point the demonstration no longer holds and the comment above it
   * has become a lie, which is worse than no comment.
   */
  test('two seeds agree at the end and diverge only in the middle — which is why the trace exists', () => {
    const a = play({ seed: 1 });
    const b = play({ seed: 2 });

    const lastA = a.samples[a.samples.length - 1];
    const lastB = b.samples[b.samples.length - 1];
    expect(lastA).toBeDefined();
    expect(lastB).toBeDefined();
    expect(lastA?.digest).toBe(lastB?.digest);

    expect(trace(a)).not.toBe(trace(b));

    const shared = Math.min(a.samples.length, b.samples.length);
    const differing: number[] = [];
    for (let i = 0; i < shared; i++) {
      if (a.samples[i]?.digest !== b.samples[i]?.digest) differing.push(i);
    }

    // Not one stray sample, and not the whole run either — a real window.
    expect(differing.length).toBeGreaterThan(10);
    expect(differing.length).toBeLessThan(shared);

    // The divergence heals: it neither starts on the first sample nor runs to
    // the last. Both ends being clean is the whole demonstration — an endpoint
    // check looks at exactly the sample that agrees.
    const first = differing[0] ?? -1;
    const last = differing[differing.length - 1] ?? -1;
    expect(first).toBeGreaterThan(0);
    expect(last).toBeLessThan(shared - 1);
    // And it spans a large stretch of the run rather than clustering.
    expect(last - first).toBeGreaterThan(shared / 3);
  });
});
