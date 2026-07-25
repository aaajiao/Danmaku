/**
 * V4 Boss choreography is an executable contract, not a campaign-data shape.
 *
 * Every probe below runs the real Lunatic `BossSystem` and `BulletSystem` after
 * importing the v4 composition root. A phase gets 420 live ticks against a
 * moving target: long enough to see at least one complete continuous route or
 * several authored station changes, while remaining well inside the shortest
 * card's 730-tick clock.
 *
 * Phase transitions deliberately preserve the Boss's current position. To
 * exercise that seam, each fight is run twice with no extra dwell and twice
 * with another 137 ticks before every damaging clear. The latter lands each
 * predecessor at a different, awkward point on its route. The successor must
 * still converge on its own absolute choreography instead of inheriting a
 * player-dependent relative drift.
 */

import { describe, expect, test } from 'bun:test';

import './index';
import { Random } from '../core/random';
import { BossSystem, getBossSpec } from '../sim/boss';
import { BulletSystem } from '../sim/bullet';
import type { MotionParams } from '../sim/motion';

const BOUNDS = { width: 480, height: 640, margin: 64 } as const;
const BOSS_NAMES = ['sentinel', 'magistrate', 'chancellor', 'regent'] as const;
const PRE_CLEAR_DWELLS = [0, 137] as const;
const SEED = 0xb055cafe;
const PHASE_TICKS = 420;
const RECOVERY_TICK = 119;
const MIN_PATH_LENGTH = 48;
const MIN_AXIS_SPAN = 20;
const FIRE_STATION_SEPARATION = 8;
const STEP_EPSILON = 1e-9;

type BossName = (typeof BOSS_NAMES)[number];

interface Point {
  readonly x: number;
  readonly y: number;
}

interface PhaseProbe {
  readonly name: string;
  readonly start: Point;
  readonly recovered: Point;
  readonly pathLength: number;
  readonly maxStep: number;
  readonly spanX: number;
  readonly spanY: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly firingStations: readonly Point[];
  readonly motion: MotionParams;
}

interface FightProbe {
  readonly trace: readonly string[];
  readonly phases: readonly PhaseProbe[];
  readonly initialRngState: readonly [number, number, number, number];
  readonly finalRngState: readonly [number, number, number, number];
  readonly droppedSpawns: number;
}

interface SpriteVolley {
  readonly tick: number;
  readonly boss: Point;
  readonly origins: readonly Point[];
}

interface SpriteState {
  readonly ages: readonly number[];
  readonly lethal: readonly boolean[];
}

interface SpritePhaseProbe {
  readonly positions: readonly Point[];
  readonly volleys: readonly SpriteVolley[];
  readonly liveStates: readonly SpriteState[];
  readonly droppedSpawns: number;
}

/** A deterministic triangle-wave target that moves on both axes. */
function targetAt(tick: number): Point {
  const horizontal = tick % 240;
  const vertical = tick % 160;
  return {
    x: horizontal <= 120 ? 120 + horizontal * 2 : 600 - horizontal * 2,
    y: vertical <= 80 ? 500 + vertical / 2 : 580 - vertical / 2,
  };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Keep only spatially distinct volley origins. Exact-coordinate uniqueness
 * would let a continuously moving Boss pass while firing several times from
 * effectively the same spot.
 */
function noteFiringStation(stations: Point[], point: Point): void {
  if (stations.every((station) => distance(station, point) >= FIRE_STATION_SEPARATION)) {
    stations.push(point);
  }
}

function numericOption(motion: MotionParams, key: string, label: string): number {
  const value = motion.options?.[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must provide finite motion.options.${key}`);
  }
  return value;
}

/**
 * The point sampled after the warm-up must be inside the route's authored
 * absolute envelope. `lunar-arc` uses a lifted cosine, so its vertical range is
 * centre..centre + 2*span rather than centre ± span.
 */
function expectRecoveredInAuthoredEnvelope(
  phase: PhaseProbe,
  label: string,
): void {
  const centerX = numericOption(phase.motion, 'centerX', label);
  const centerY = numericOption(phase.motion, 'centerY', label);
  const spanX = Math.abs(numericOption(phase.motion, 'spanX', label));
  const spanY = Math.abs(numericOption(phase.motion, 'spanY', label));
  const lunar = phase.motion.behaviour === 'lunar-arc';
  const minY = lunar ? centerY : centerY - spanY;
  const maxY = lunar ? centerY + 2 * spanY : centerY + spanY;

  expect(phase.recovered.x, `${label} recovered x`).toBeGreaterThanOrEqual(centerX - spanX - 1);
  expect(phase.recovered.x, `${label} recovered x`).toBeLessThanOrEqual(centerX + spanX + 1);
  expect(phase.recovered.y, `${label} recovered y`).toBeGreaterThanOrEqual(minY - 1);
  expect(phase.recovered.y, `${label} recovered y`).toBeLessThanOrEqual(maxY + 1);
}

/** Compact but stateful sample of the live bullet field for replay equality. */
function bulletSample(bullets: BulletSystem): string {
  if (bullets.count === 0) return '-';
  const indices = [0, Math.floor(bullets.count / 2), bullets.count - 1];
  return indices.map((index) => {
    const bullet = bullets.bullets[index];
    if (bullet === undefined) return '-';
    return [
      bullet.x,
      bullet.y,
      bullet.age,
      bullet.vector.r,
      bullet.vector.theta,
      bullet.style.sprite,
    ].join(',');
  }).join(';');
}

/**
 * Run one whole Boss fight. Damage, not timeout, advances every phase; bullets
 * are cleared at the transition as the game does for a spell-card boundary.
 */
function probeFight(name: BossName, preClearDwell: number): FightProbe {
  const bullets = new BulletSystem({
    bounds: BOUNDS,
    initial: 4096,
    max: 4096,
  });
  const system = new BossSystem({
    bounds: BOUNDS,
    bullets,
    difficulty: 'lunatic',
  });
  const rng = new Random(SEED);
  const initialRngState = rng.getState();
  const trace: string[] = [];
  const phases: PhaseProbe[] = [];
  let globalTick = 0;

  system.spawn(name, BOUNDS.width / 2, -40, rng);

  function step(record: boolean): {
    readonly before: Point;
    readonly after: Point;
    readonly emitted: number;
    readonly fired: boolean;
  } {
    const target = targetAt(globalTick);
    const beforeBoss = system.boss;
    if (beforeBoss === undefined) throw new Error(`${name} vanished before tick ${globalTick}`);
    const before = { x: beforeBoss.x, y: beforeBoss.y };
    const bulletsBefore = bullets.count;

    system.step(target.x, target.y, rng);
    const afterBoss = system.boss;
    if (afterBoss === undefined) throw new Error(`${name} vanished during tick ${globalTick}`);
    const emitted = bullets.count - bulletsBefore;
    const fired = afterBoss.firedThisTick;
    bullets.step(target.x, target.y, rng);
    const events = system.drainEvents().map((event) => event.type).join(',');
    const after = { x: afterBoss.x, y: afterBoss.y };

    if (record) {
      trace.push([
        globalTick,
        afterBoss.phaseIndex,
        afterBoss.phaseTicks,
        afterBoss.x,
        afterBoss.y,
        afterBoss.vector.r,
        afterBoss.vector.theta,
        fired ? 1 : 0,
        emitted,
        bullets.count,
        target.x,
        target.y,
        events,
        bulletSample(bullets),
      ].join('|'));
    }
    globalTick++;
    return { before, after, emitted, fired };
  }

  // Exercise the authored fly-in through the same systems before phase 0.
  let entryGuard = 0;
  while (system.boss?.entering) {
    step(true);
    entryGuard++;
    if (entryGuard > 240) throw new Error(`${name} entry did not settle`);
  }

  const spec = getBossSpec(name);
  for (let phaseIndex = 0; phaseIndex < spec.phases.length; phaseIndex++) {
    const live = system.boss;
    const phaseSpec = spec.phases[phaseIndex];
    if (live === undefined || phaseSpec === undefined) {
      throw new Error(`${name} phase ${phaseIndex} was not reachable`);
    }
    if (live.phaseIndex !== phaseIndex) {
      throw new Error(`${name} expected phase ${phaseIndex}, got ${live.phaseIndex}`);
    }
    const motion = phaseSpec.motion;
    if (motion === undefined) throw new Error(`${name} phase ${phaseIndex} has no motion`);

    const start = { x: live.x, y: live.y };
    const firingStations: Point[] = [];
    let previous = start;
    let pathLength = 0;
    let maxStep = 0;
    let minX = start.x;
    let maxX = start.x;
    let minY = start.y;
    let maxY = start.y;
    let recovered: Point | undefined;

    for (let phaseTick = 0; phaseTick < PHASE_TICKS; phaseTick++) {
      const sample = step(true);
      const boss = system.boss;
      if (boss === undefined || boss.phaseIndex !== phaseIndex) {
        throw new Error(`${name} phase ${phaseIndex} ended before ${PHASE_TICKS} ticks`);
      }

      const stepDistance = distance(previous, sample.after);
      pathLength += stepDistance;
      maxStep = Math.max(maxStep, stepDistance);
      minX = Math.min(minX, sample.after.x);
      maxX = Math.max(maxX, sample.after.x);
      minY = Math.min(minY, sample.after.y);
      maxY = Math.max(maxY, sample.after.y);
      if (sample.fired && sample.emitted > 0) {
        noteFiringStation(firingStations, sample.after);
      }
      if (phaseTick === RECOVERY_TICK) recovered = sample.after;
      previous = sample.after;
    }

    if (recovered === undefined) throw new Error(`${name} phase ${phaseIndex} missed recovery sample`);
    phases.push({
      name: phaseSpec.name,
      start,
      recovered,
      pathLength,
      maxStep,
      spanX: maxX - minX,
      spanY: maxY - minY,
      minX,
      maxX,
      minY,
      maxY,
      firingStations,
      motion,
    });

    // The extra dwell changes the inherited position without contributing to
    // the 420-tick movement budget above.
    for (let dwell = 0; dwell < preClearDwell; dwell++) step(true);

    expect(system.damage(Number.MAX_SAFE_INTEGER), `${name} phase ${phaseIndex} damage clear`).toBe(true);
    const transition = system.drainEvents().map((event) => event.type);
    const last = phaseIndex === spec.phases.length - 1;
    expect(transition, `${name} phase ${phaseIndex} transition`).toEqual(
      last ? ['phase-cleared', 'defeated'] : ['phase-cleared', 'phase-start'],
    );
    trace.push(`damage|${phaseIndex}|${transition.join(',')}|${system.boss?.phaseIndex ?? 'gone'}`);
    bullets.clear();
  }

  return {
    trace,
    phases,
    initialRngState,
    finalRngState: rng.getState(),
    droppedSpawns: bullets.droppedSpawns,
  };
}

function expectHealthyPhase(
  phase: PhaseProbe,
  bossName: BossName,
  phaseIndex: number,
  dwell: number,
): void {
  const label = `${bossName} phase ${phaseIndex} (${phase.name}), dwell ${dwell}`;
  const maxSpeed = numericOption(phase.motion, 'maxSpeed', label);

  expect(phase.pathLength, `${label} path length`).toBeGreaterThanOrEqual(MIN_PATH_LENGTH);
  expect(Math.max(phase.spanX, phase.spanY), `${label} axis span`).toBeGreaterThanOrEqual(MIN_AXIS_SPAN);
  expect(phase.firingStations.length, `${label} firing stations`).toBeGreaterThanOrEqual(2);
  expect(phase.maxStep, `${label} max step`).toBeLessThanOrEqual(maxSpeed + STEP_EPSILON);

  // This is intentionally tighter than the simulation's offscreen margin:
  // every choreography must remain visibly in the upper field with generous
  // clearance from all four playfield edges.
  expect(phase.minX, `${label} left clearance`).toBeGreaterThanOrEqual(96);
  expect(phase.maxX, `${label} right clearance`).toBeLessThanOrEqual(384);
  expect(phase.minY, `${label} top clearance`).toBeGreaterThanOrEqual(40);
  expect(phase.maxY, `${label} upper-field ceiling`).toBeLessThanOrEqual(220);

  expectRecoveredInAuthoredEnvelope(phase, label);
}

/**
 * Advance directly to one real phase, then observe one projectile skin at the
 * exact boundary between Boss movement, pattern emission and bullet ageing.
 *
 * The skin is only a probe key here: each of the three planted-beam slots owns
 * a distinct v4 projectile, while every assertion below is about simulation
 * time and coordinates.
 */
function probePhaseSprite(
  bossName: BossName,
  phaseIndex: number,
  sprite: string,
  ticks: number,
): SpritePhaseProbe {
  const bullets = new BulletSystem({
    bounds: BOUNDS,
    initial: 8192,
    max: 8192,
  });
  const system = new BossSystem({
    bounds: BOUNDS,
    bullets,
    difficulty: 'lunatic',
  });
  const rng = new Random(SEED);
  system.spawn(bossName, BOUNDS.width / 2, -40, rng);

  let entryTick = 0;
  while (system.boss?.entering) {
    const target = targetAt(entryTick++);
    system.step(target.x, target.y, rng);
    bullets.step(target.x, target.y, rng);
    system.drainEvents();
    if (entryTick > 240) throw new Error(`${bossName} entry did not settle`);
  }

  for (let index = 0; index < phaseIndex; index++) {
    const boss = system.boss;
    if (boss === undefined || boss.phaseIndex !== index) {
      throw new Error(`${bossName} could not advance through phase ${index}`);
    }
    if (!system.damage(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`${bossName} phase ${index} did not clear`);
    }
    system.drainEvents();
    bullets.clear();
  }

  const positions: Point[] = [];
  const volleys: SpriteVolley[] = [];
  const liveStates: SpriteState[] = [];

  for (let tick = 0; tick < ticks; tick++) {
    const before = system.boss;
    if (before === undefined || before.phaseIndex !== phaseIndex || before.phaseTicks !== tick) {
      throw new Error(`${bossName} phase ${phaseIndex} missed probe tick ${tick}`);
    }

    const target = targetAt(tick);
    const countBefore = bullets.count;
    system.step(target.x, target.y, rng);
    const after = system.boss;
    if (after === undefined || after.phaseIndex !== phaseIndex) {
      throw new Error(`${bossName} phase ${phaseIndex} ended at probe tick ${tick}`);
    }

    const boss = { x: after.x, y: after.y };
    positions.push(boss);
    const spawned = bullets.bullets
      .slice(countBefore)
      .filter((bullet) => bullet.style.sprite === sprite);
    if (spawned.length > 0) {
      volleys.push({
        tick,
        boss,
        origins: spawned.map((bullet) => ({ x: bullet.x, y: bullet.y })),
      });
    }

    bullets.step(target.x, target.y, rng);
    const live = bullets.bullets.filter((bullet) => bullet.style.sprite === sprite);
    liveStates.push({
      ages: live.map((bullet) => bullet.age),
      lethal: live.map((bullet) => bullet.lethal),
    });
    system.drainEvents();
  }

  return {
    positions,
    volleys,
    liveStates,
    droppedSpawns: bullets.droppedSpawns,
  };
}

function pointAt(points: readonly Point[], tick: number, label: string): Point {
  const point = points[tick];
  if (point === undefined) throw new Error(`${label} has no point at tick ${tick}`);
  return point;
}

function stateAt(states: readonly SpriteState[], tick: number, label: string): SpriteState {
  const state = states[tick];
  if (state === undefined) throw new Error(`${label} has no state at tick ${tick}`);
  return state;
}

function expectPoint(actual: Point, expected: Point, label: string): void {
  expect(distance(actual, expected), label).toBeLessThanOrEqual(STEP_EPSILON);
}

describe('v4 Boss choreography', () => {
  test('all 20 Lunatic phases move, fire from multiple stations, and replay exactly', () => {
    expect(
      BOSS_NAMES.reduce((sum, name) => sum + getBossSpec(name).phases.length, 0),
    ).toBe(20);

    const startsByBoss = new Map<BossName, readonly [readonly Point[], readonly Point[]]>();

    for (const bossName of BOSS_NAMES) {
      const starts: Point[][] = [];
      for (const dwell of PRE_CLEAR_DWELLS) {
        const first = probeFight(bossName, dwell);
        const replay = probeFight(bossName, dwell);
        const label = `${bossName}, predecessor dwell ${dwell}`;

        expect(replay.trace, `${label} exact trace`).toEqual(first.trace);
        expect(first.phases.length, `${label} phase count`).toBe(getBossSpec(bossName).phases.length);
        expect(first.droppedSpawns, `${label} dropped spawns`).toBe(0);
        expect(first.finalRngState, `${label} RNG draws`).toEqual(first.initialRngState);
        expect(replay.finalRngState, `${label} replay RNG draws`).toEqual(replay.initialRngState);

        for (let phaseIndex = 0; phaseIndex < first.phases.length; phaseIndex++) {
          const phase = first.phases[phaseIndex];
          if (phase === undefined) throw new Error(`${label} missing phase ${phaseIndex}`);
          expectHealthyPhase(phase, bossName, phaseIndex, dwell);
        }
        starts.push(first.phases.map((phase) => phase.start));
      }
      const immediate = starts[0];
      const delayed = starts[1];
      if (immediate === undefined || delayed === undefined) {
        throw new Error(`${bossName} did not run both predecessor dwells`);
      }
      startsByBoss.set(bossName, [immediate, delayed]);
    }

    // Phase 0 follows the same entry. Every successor starts elsewhere under
    // the 137-tick predecessor dwell, proving both inheritance variants above
    // exercised genuinely different incoming positions before reconverging.
    for (const bossName of BOSS_NAMES) {
      const starts = startsByBoss.get(bossName);
      if (starts === undefined) throw new Error(`${bossName} has no start traces`);
      const [immediate, delayed] = starts;
      expect(immediate[0], `${bossName} phase 0 entry`).toEqual(delayed[0]);
      for (let phaseIndex = 1; phaseIndex < immediate.length; phaseIndex++) {
        const a = immediate[phaseIndex];
        const b = delayed[phaseIndex];
        if (a === undefined || b === undefined) {
          throw new Error(`${bossName} missing inherited start ${phaseIndex}`);
        }
        expect(distance(a, b), `${bossName} phase ${phaseIndex} inherited-position delta`)
          .toBeGreaterThan(1);
      }
    }
  });

  test('planted columns and retained rakes declare on settled-station clocks', () => {
    const colonnade = probePhaseSprite('magistrate', 2, 'beam.blue', 420);
    expect(colonnade.droppedSpawns).toBe(0);
    expect(colonnade.volleys.map((volley) => volley.tick)).toEqual([132, 264, 396]);
    const colonnadeStations = [
      { x: 170, y: 108 },
      { x: 240, y: 108 },
      { x: 310, y: 108 },
    ] as const;
    for (let index = 0; index < colonnade.volleys.length; index++) {
      const volley = colonnade.volleys[index];
      const station = colonnadeStations[index];
      if (volley === undefined || station === undefined) {
        throw new Error(`colonnade missing declaration ${index}`);
      }
      expectPoint(volley.boss, station, `colonnade declaration ${index} station`);
    }
    for (const tick of [132, 264]) {
      const station = pointAt(colonnade.positions, tick, 'colonnade');
      expectPoint(
        pointAt(colonnade.positions, tick + 107, 'colonnade'),
        station,
        `colonnade tick ${tick} 108-tick hold`,
      );
      expect(
        distance(pointAt(colonnade.positions, tick + 108, 'colonnade'), station),
        `colonnade tick ${tick} movement begins after beam life`,
      ).toBeGreaterThan(1);
      expect(stateAt(colonnade.liveStates, tick + 106, 'colonnade').ages)
        .toEqual(new Array(stateAt(colonnade.liveStates, tick + 106, 'colonnade').ages.length).fill(107));
      expect(stateAt(colonnade.liveStates, tick + 107, 'colonnade').ages).toEqual([]);
      expect(stateAt(colonnade.liveStates, tick + 108, 'colonnade').ages).toEqual([]);
    }

    const assize = probePhaseSprite('magistrate', 3, 'beam.assize', 470);
    expect(assize.droppedSpawns).toBe(0);
    expect(assize.volleys.map((volley) => volley.tick)).toEqual([150, 300, 450]);
    const assizeStations = [
      { x: 144, y: 80 },
      { x: 240, y: 96 },
      { x: 336, y: 112 },
    ] as const;
    for (let index = 0; index < assize.volleys.length; index++) {
      const volley = assize.volleys[index];
      const station = assizeStations[index];
      if (volley === undefined || station === undefined) {
        throw new Error(`assize missing declaration ${index}`);
      }
      expectPoint(volley.boss, station, `assize declaration ${index} station`);
    }
    for (const tick of [150, 300]) {
      const station = pointAt(assize.positions, tick, 'assize');
      expectPoint(
        pointAt(assize.positions, tick + 107, 'assize'),
        station,
        `assize tick ${tick} 108-tick hold`,
      );
      expect(
        distance(pointAt(assize.positions, tick + 108, 'assize'), station),
        `assize tick ${tick} movement begins after beam life`,
      ).toBeGreaterThan(1);
      expect(stateAt(assize.liveStates, tick + 106, 'assize').ages)
        .toEqual(new Array(stateAt(assize.liveStates, tick + 106, 'assize').ages.length).fill(107));
      expect(stateAt(assize.liveStates, tick + 107, 'assize').ages).toEqual([]);
      expect(stateAt(assize.liveStates, tick + 108, 'assize').ages).toEqual([]);
    }

    const assay = probePhaseSprite('chancellor', 3, 'beam.warm', 610);
    expect(assay.droppedSpawns).toBe(0);
    expect(assay.volleys.map((volley) => volley.tick)).toEqual([300, 600]);
    const firstRake = assay.volleys[0];
    const secondRake = assay.volleys[1];
    if (firstRake === undefined || secondRake === undefined) {
      throw new Error('assay did not emit both retained rakes');
    }

    // The live Boss has reached the next stamp, but each muzzle is the oldest
    // retained source: the station occupied before the preceding travel.
    expectPoint(firstRake.boss, { x: 180, y: 96 }, 'assay tick 300 Boss stamp');
    for (const origin of firstRake.origins) {
      expectPoint(origin, { x: 240, y: 96 }, 'assay tick 300 retained source');
    }
    expectPoint(secondRake.boss, { x: 240, y: 82 }, 'assay tick 600 Boss stamp');
    for (const origin of secondRake.origins) {
      expectPoint(origin, { x: 180, y: 96 }, 'assay tick 600 retained source');
    }

    expectPoint(
      pointAt(assay.positions, 537, 'assay'),
      firstRake.boss,
      'assay holds through rake tick 537',
    );
    expect(
      distance(pointAt(assay.positions, 538, 'assay'), firstRake.boss),
      'assay movement begins at tick 538',
    ).toBeGreaterThan(0.5);
    expectPoint(
      pointAt(assay.positions, 599, 'assay'),
      secondRake.boss,
      'assay reaches the next stamp on tick 599',
    );
    expectPoint(
      pointAt(assay.positions, 600, 'assay'),
      secondRake.boss,
      'assay declares again from the settled tick-600 stamp',
    );

    expect(stateAt(assay.liveStates, 536, 'assay')).toEqual({
      ages: [237, 237],
      lethal: [true, true],
    });
    expect(stateAt(assay.liveStates, 537, 'assay')).toEqual({
      ages: [238, 238],
      lethal: [false, false],
    });
    expect(stateAt(assay.liveStates, 538, 'assay')).toEqual({
      ages: [239, 239],
      lethal: [false, false],
    });
    expect(stateAt(assay.liveStates, 558, 'assay')).toEqual({
      ages: [259, 259],
      lethal: [false, false],
    });
    expect(stateAt(assay.liveStates, 559, 'assay')).toEqual({
      ages: [],
      lethal: [],
    });
  });
});
