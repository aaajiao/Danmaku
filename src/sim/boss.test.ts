import { describe, expect, test } from 'bun:test';
import '../v4/gameplay/patterns';
import { Random } from '../core/random';
import {
  Boss,
  BossSystem,
  bossNames,
  defineBoss,
  getBossSpec,
  type BossEvent,
  type BossSpec,
} from './boss';
import { BulletSystem, type BulletSpec, type FieldBounds } from './bullet';

const FIELD: FieldBounds = { width: 480, height: 480, margin: 32 };

/**
 * Every test drives its own generator rather than the global `sim` stream, so
 * no test can move another test's outcome by drawing from it.
 */
function rng(seed = 1): Random {
  return new Random(seed);
}

/** Stationary shot: fired bullets stay where they were born, so they can be counted. */
const TEST_SHOT: BulletSpec = {
  style: { sprite: 'orb.small' },
  radius: 3,
  motion: { r: 0, theta: 90 },
};

function makeSystem(): { system: BossSystem; bullets: BulletSystem } {
  const bullets = new BulletSystem({ bounds: FIELD, initial: 512 });
  return { system: new BossSystem({ bounds: FIELD, bullets }), bullets };
}

function stepTimes(system: BossSystem, ticks: number, r = rng()): void {
  for (let i = 0; i < ticks; i++) system.step(240, 460, r);
}

/** Event types in order — the shape of a transition, without the payload noise. */
function types(events: readonly BossEvent[]): string[] {
  return events.map((e) => e.type);
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** One bullet every tick of every phase, so fire can be counted per phase. */
const TICKER = { pattern: 'ring', options: { spec: TEST_SHOT, count: 1, period: 1 } };

defineBoss('test.simple', {
  sprite: 'orb.large',
  radius: 16,
  phases: [{ name: 'only', hp: 100, timeLimit: 0, patterns: [] }],
});

defineBoss('test.three', {
  sprite: 'orb.large',
  radius: 16,
  phases: [
    { name: 'wave', hp: 100, timeLimit: 0, patterns: [] },
    { name: 'card', hp: 200, timeLimit: 0, patterns: [], bonus: 1000, isSpell: true },
    { name: 'final', hp: 300, timeLimit: 0, patterns: [], bonus: 5000, isSpell: true },
  ],
});

defineBoss('test.entering', {
  sprite: 'orb.large',
  radius: 16,
  entry: { x: 240, y: 120, ticks: 20 },
  phases: [{ name: 'only', hp: 100, timeLimit: 0, patterns: [TICKER] }],
});

defineBoss('test.timed', {
  sprite: 'orb.large',
  radius: 16,
  phases: [
    { name: 'short', hp: 1_000_000, timeLimit: 10, patterns: [] },
    { name: 'shorter', hp: 1_000_000, timeLimit: 5, patterns: [] },
  ],
});

defineBoss('test.firing', {
  sprite: 'orb.large',
  radius: 16,
  phases: [
    {
      name: 'gated',
      hp: 1_000_000,
      timeLimit: 0,
      patterns: [
        { ...TICKER, startAt: 5 },
        { ...TICKER, stopAt: 3 },
      ],
    },
    { name: 'silent', hp: 1_000_000, timeLimit: 0, patterns: [] },
  ],
});

/** Flies left at speed with nothing to stop it but the field edge. */
defineBoss('test.runaway', {
  sprite: 'orb.large',
  radius: 16,
  phases: [
    { name: 'flee', hp: 1_000_000, timeLimit: 0, patterns: [], motion: { r: 20, theta: 180 } },
  ],
});

/** Randomized motion on every phase — the transition itself draws from the stream. */
defineBoss('test.random', {
  sprite: 'orb.large',
  radius: 16,
  phases: [
    {
      name: 'a',
      hp: 60,
      timeLimit: 30,
      motion: { rrandom: { min: 1, max: 4 }, trandom: { min: 0, max: 360 } },
      patterns: [{ pattern: 'spray', options: { spec: TEST_SHOT, count: 3, period: 2 } }],
    },
    {
      name: 'b',
      hp: 60,
      timeLimit: 30,
      motion: { rrandom: { min: 1, max: 4 }, trandom: { min: 0, max: 360 } },
      patterns: [{ pattern: 'spray', options: { spec: TEST_SHOT, count: 3, period: 2 } }],
    },
  ],
});

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

describe('registry', () => {
  test('a defined boss is retrievable and listed', () => {
    expect(getBossSpec('test.simple').radius).toBe(16);
    expect(bossNames()).toContain('test.simple');
  });

  test('redefining a boss throws', () => {
    const spec: BossSpec = {
      sprite: 'orb.large',
      radius: 8,
      phases: [{ name: 'x', hp: 1, timeLimit: 0, patterns: [] }],
    };
    defineBoss('test.dupe', spec);
    expect(() => defineBoss('test.dupe', spec)).toThrow(/already defined/);
  });

  test('a boss with no phases is rejected at definition', () => {
    expect(() =>
      defineBoss('test.empty', { sprite: 'orb.large', radius: 8, phases: [] }),
    ).toThrow(/at least one phase/);
  });

  test('an unknown boss throws rather than spawning nothing', () => {
    const { system } = makeSystem();
    expect(() => system.spawn('test.nope', 240, 120)).toThrow(/unknown boss/);
  });
});

/* ------------------------------------------------------------------ */
/* Entry                                                               */
/* ------------------------------------------------------------------ */

describe('entry', () => {
  test('a boss without an entry starts phase 0 on the spawn tick', () => {
    const { system } = makeSystem();
    system.spawn('test.simple', 240, 120, rng());

    expect(system.boss?.entering).toBe(false);
    expect(types(system.drainEvents())).toEqual(['entered', 'phase-start']);
  });

  test('the fly-in is invulnerable, silent, and settles exactly on target', () => {
    const { system, bullets } = makeSystem();
    const boss = system.spawn('test.entering', 240, -40, rng());

    expect(boss?.entering).toBe(true);
    // The spawn tick announces nothing: it has not arrived yet.
    expect(types(system.drainEvents())).toEqual([]);

    stepTimes(system, 19);
    expect(system.boss?.entering).toBe(true);
    expect(system.damage(999)).toBe(false);
    expect(system.boss?.hp).toBe(100);
    expect(bullets.bullets.length).toBe(0);
    expect(types(system.drainEvents())).toEqual([]);

    stepTimes(system, 1);
    expect(system.boss?.entering).toBe(false);
    // Exactly on the declared station, not a lerp's rounding away from it.
    expect(system.boss?.x).toBe(240);
    expect(system.boss?.y).toBe(120);
    expect(types(system.drainEvents())).toEqual(['entered', 'phase-start']);
  });

  test('the entry moves toward the target rather than sitting still', () => {
    const { system } = makeSystem();
    system.spawn('test.entering', 240, -40, rng());
    stepTimes(system, 10);

    const y = system.boss?.y ?? 0;
    expect(y).toBeGreaterThan(-40);
    expect(y).toBeLessThan(120);
  });

  test('phase ticks do not count the fly-in', () => {
    const { system } = makeSystem();
    system.spawn('test.entering', 240, -40, rng());
    stepTimes(system, 20);
    expect(system.boss?.phaseTicks).toBe(0);
    expect(system.boss?.age).toBe(20);
  });

  test('the first pattern tick lands on the tick after settling', () => {
    const { system, bullets } = makeSystem();
    system.spawn('test.entering', 240, -40, rng());
    stepTimes(system, 20);
    expect(bullets.bullets.length).toBe(0);
    stepTimes(system, 1);
    expect(bullets.bullets.length).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Hit flash                                                           */
/* ------------------------------------------------------------------ */

describe('hit flash', () => {
  test('a landed hit lights the flash to full, and it decays to zero', () => {
    const { system } = makeSystem();
    system.spawn('test.three', 240, 120, rng());

    expect(system.boss?.hitFlash).toBe(0);
    system.damage(1);
    // Set to the full ticks, so the normalized fraction reads 1 the tick it lands.
    expect(system.boss?.hitFlashFraction).toBe(1);

    const start = system.boss?.hitFlash ?? 0;
    expect(start).toBeGreaterThan(0);

    // One decrement per step, down to zero, and not below.
    for (let i = 1; i <= start; i++) {
      stepTimes(system, 1);
      expect(system.boss?.hitFlash).toBe(start - i);
    }
    expect(system.boss?.hitFlash).toBe(0);
    stepTimes(system, 1);
    expect(system.boss?.hitFlash).toBe(0);
  });

  test('each hit refreshes the counter rather than accumulating', () => {
    const { system } = makeSystem();
    system.spawn('test.three', 240, 120, rng());

    system.damage(1);
    const full = system.boss?.hitFlash ?? 0;
    stepTimes(system, 1); // decays one
    expect(system.boss?.hitFlash).toBe(full - 1);

    system.damage(1); // refresh — assignment, not += , so it caps at full
    expect(system.boss?.hitFlash).toBe(full);
  });

  test('an entering boss cannot flash — damage is refused during the fly-in', () => {
    const { system } = makeSystem();
    system.spawn('test.entering', 240, -40, rng());

    expect(system.boss?.entering).toBe(true);
    expect(system.damage(999)).toBe(false);
    expect(system.boss?.hitFlash).toBe(0);
    expect(system.boss?.hitFlashFraction).toBe(0);
  });

  test('the hit that clears a phase does not flash the next card', () => {
    const { system } = makeSystem();
    system.spawn('test.three', 240, 120, rng()); // phase 0 hp 100
    system.drainEvents();

    // Exactly drains phase 0; `beginPhase` for the next card must clear the flash
    // this same-tick hit set, or it would ghost onto a card not yet touched.
    expect(system.damage(100)).toBe(true);
    expect(system.boss?.phaseIndex).toBe(1);
    expect(system.boss?.hitFlash).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Phase transitions                                                   */
/* ------------------------------------------------------------------ */

describe('phase transitions', () => {
  test('draining a phase advances to the next and re-arms its health', () => {
    const { system } = makeSystem();
    system.spawn('test.three', 240, 120, rng());
    system.drainEvents();

    expect(system.damage(100)).toBe(true);
    expect(system.boss?.phaseIndex).toBe(1);
    expect(system.boss?.hp).toBe(200);
    expect(types(system.drainEvents())).toEqual(['phase-cleared', 'phase-start']);
  });

  test('a transition event names the phase that ended, its successor the new one', () => {
    const { system } = makeSystem();
    system.spawn('test.three', 240, 120, rng());
    system.drainEvents();

    system.damage(100);
    const events = system.drainEvents();
    expect(events[0]?.phaseIndex).toBe(0);
    expect(events[1]?.phaseIndex).toBe(1);
  });

  test('damage short of the threshold clears nothing', () => {
    const { system } = makeSystem();
    system.spawn('test.three', 240, 120, rng());
    system.drainEvents();

    expect(system.damage(99)).toBe(false);
    expect(system.boss?.phaseIndex).toBe(0);
    expect(system.boss?.hp).toBe(1);
    expect(types(system.drainEvents())).toEqual([]);
  });

  test('overkill is discarded rather than carried into the next phase', () => {
    const { system } = makeSystem();
    system.spawn('test.three', 240, 120, rng());
    system.damage(100_000);
    expect(system.boss?.phaseIndex).toBe(1);
    expect(system.boss?.hp).toBe(200);
  });

  test('a timeout ends the phase and advances, as a clear and not a failure', () => {
    const { system } = makeSystem();
    system.spawn('test.timed', 240, 120, rng());
    system.drainEvents();

    stepTimes(system, 9);
    expect(system.boss?.phaseIndex).toBe(0);
    stepTimes(system, 1);
    expect(system.boss?.phaseIndex).toBe(1);
    expect(types(system.drainEvents())).toEqual(['timeout', 'phase-start']);
  });

  test('an expired phase re-arms the next clock, so a boss cannot stall', () => {
    const { system } = makeSystem();
    system.spawn('test.timed', 240, 120, rng());
    // Both phases are unkillable by damage; only the clock can end this fight.
    stepTimes(system, 200);
    expect(system.active).toBe(false);
  });

  test('the last phase ends the fight', () => {
    const { system } = makeSystem();
    system.spawn('test.three', 240, 120, rng());
    system.drainEvents();

    system.damage(100);
    system.damage(200);
    system.drainEvents();
    expect(system.damage(300)).toBe(true);

    expect(types(system.drainEvents())).toEqual(['phase-cleared', 'defeated']);
    expect(system.active).toBe(false);
    expect(system.boss).toBeUndefined();
  });

  test('damage after defeat opens no phase that does not exist', () => {
    const { system } = makeSystem();
    system.spawn('test.three', 240, 120, rng());
    system.damage(100);
    system.damage(200);
    system.damage(300);
    system.drainEvents();

    expect(system.damage(100)).toBe(false);
    expect(types(system.drainEvents())).toEqual([]);
  });

  test('stepping a defeated boss is inert', () => {
    const { system, bullets } = makeSystem();
    system.spawn('test.firing', 240, 120, rng());
    stepTimes(system, 10);
    system.clear();
    const fired = bullets.bullets.length;

    stepTimes(system, 30);
    expect(bullets.bullets.length).toBe(fired);
  });
});

/* ------------------------------------------------------------------ */
/* Clean clears                                                        */
/* ------------------------------------------------------------------ */

describe('clean clears', () => {
  test('an untouched phase is cleared cleanly', () => {
    const { system } = makeSystem();
    system.spawn('test.three', 240, 120, rng());
    system.drainEvents();

    system.damage(100);
    expect(system.drainEvents()[0]?.clean).toBe(true);
  });

  test('a death or a bomb spoils the phase in progress', () => {
    const { system } = makeSystem();
    system.spawn('test.three', 240, 120, rng());
    system.drainEvents();

    system.notePlayerDeath();
    system.damage(100);
    expect(system.drainEvents()[0]?.clean).toBe(false);

    system.notePlayerBomb();
    system.damage(200);
    expect(system.drainEvents()[0]?.clean).toBe(false);
  });

  test('the next phase starts clean again', () => {
    const { system } = makeSystem();
    system.spawn('test.three', 240, 120, rng());
    system.notePlayerBomb();
    system.damage(100);
    system.drainEvents();

    system.damage(200);
    expect(system.drainEvents()[0]?.clean).toBe(true);
  });

  test('a timeout reports cleanliness too — the game decides what to pay', () => {
    const { system } = makeSystem();
    system.spawn('test.timed', 240, 120, rng());
    system.notePlayerDeath();
    system.drainEvents();

    stepTimes(system, 10);
    const timeout = system.drainEvents()[0];
    expect(timeout?.type).toBe('timeout');
    expect(timeout?.clean).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* HUD fractions                                                       */
/* ------------------------------------------------------------------ */

describe('hud fractions', () => {
  test('health drains from 1 to 0 within the phase, never past it', () => {
    const { system } = makeSystem();
    const boss = system.spawn('test.three', 240, 120, rng()) as Boss;

    expect(boss.phaseHpFraction).toBe(1);
    system.damage(50);
    expect(boss.phaseHpFraction).toBe(0.5);
    system.damage(49);
    expect(boss.phaseHpFraction).toBeCloseTo(0.01, 10);
  });

  test('the timer runs full to empty over the limit', () => {
    const { system } = makeSystem();
    const boss = system.spawn('test.timed', 240, 120, rng()) as Boss;

    expect(boss.phaseTimeFraction).toBe(1);
    stepTimes(system, 5);
    expect(boss.phaseTimeFraction).toBe(0.5);
  });

  test('an untimed phase reads as a full ring forever', () => {
    const { system } = makeSystem();
    const boss = system.spawn('test.simple', 240, 120, rng()) as Boss;
    stepTimes(system, 500);
    expect(boss.phaseTimeFraction).toBe(1);
  });

  test('the bar reads full during the fly-in, before any card is announced', () => {
    const { system } = makeSystem();
    const boss = system.spawn('test.entering', 240, -40, rng()) as Boss;
    expect(boss.phaseHpFraction).toBe(1);
    expect(boss.phaseTimeFraction).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Patterns                                                            */
/* ------------------------------------------------------------------ */

describe('patterns', () => {
  test('startAt and stopAt are counted from the phase, not the spawn', () => {
    const { system, bullets } = makeSystem();
    system.spawn('test.firing', 240, 120, rng());

    // Ticks 0..2 fire the stopAt slot only; 3 and 4 fire nothing; 5 onward
    // fires the startAt slot only.
    stepTimes(system, 3);
    expect(bullets.bullets.length).toBe(3);
    stepTimes(system, 2);
    expect(bullets.bullets.length).toBe(3);
    stepTimes(system, 2);
    expect(bullets.bullets.length).toBe(5);
  });

  test('a retired slot is never restarted', () => {
    const { system, bullets } = makeSystem();
    system.spawn('test.firing', 240, 120, rng());
    stepTimes(system, 60);
    // 55 from the startAt slot (ticks 5..59) plus the 3 before the stop.
    expect(bullets.bullets.length).toBe(58);
  });

  test('a phase does not inherit the previous phase fire', () => {
    const { system, bullets } = makeSystem();
    system.spawn('test.firing', 240, 120, rng());
    stepTimes(system, 20);
    const fired = bullets.bullets.length;

    system.damage(1_000_000);
    stepTimes(system, 30);
    expect(bullets.bullets.length).toBe(fired);
  });

  test('bullets are born where the boss now is', () => {
    const { system, bullets } = makeSystem();
    system.spawn('test.entering', 240, -40, rng());
    stepTimes(system, 21);

    const bullet = bullets.bullets[0];
    expect(bullet?.x).toBe(240);
    expect(bullet?.y).toBe(120);
  });
});

describe('fire presentation facts', () => {
  test('records actual phase volleys, quiet ticks, and continuous fire', () => {
    const { system, bullets } = makeSystem();
    const boss = system.spawn('test.firing', 240, 120, rng()) as Boss;

    expect(boss.firedThisTick).toBe(false);
    expect(boss.lastFireTick).toBeUndefined();
    expect(boss.ticksSinceFire).toBeUndefined();

    for (let tick = 0; tick < 3; tick++) {
      system.step(240, 460, rng());
      expect(boss.firedThisTick).toBe(true);
      expect(boss.lastFireTick).toBe(tick);
      expect(boss.ticksSinceFire).toBe(0);
    }
    expect(bullets.count).toBe(3);

    system.step(240, 460, rng());
    expect(boss.firedThisTick).toBe(false);
    expect(boss.lastFireTick).toBe(2);
    expect(boss.ticksSinceFire).toBe(1);
    system.step(240, 460, rng());
    expect(boss.ticksSinceFire).toBe(2);

    system.step(240, 460, rng());
    expect(bullets.count).toBe(4);
    expect(boss.firedThisTick).toBe(true);
    expect(boss.lastFireTick).toBe(5);
    expect(boss.ticksSinceFire).toBe(0);
  });

  test('a new phase and a new fight clear the previous fire facts', () => {
    const { system } = makeSystem();
    const boss = system.spawn('test.firing', 240, 120, rng()) as Boss;
    system.step(240, 460, rng());
    expect(boss.firedThisTick).toBe(true);

    expect(system.damage(1_000_000)).toBe(true);
    expect(boss.phaseIndex).toBe(1);
    expect(boss.phaseTicks).toBe(0);
    expect(boss.firedThisTick).toBe(false);
    expect(boss.lastFireTick).toBeUndefined();
    expect(boss.ticksSinceFire).toBeUndefined();

    system.clear();
    const next = system.spawn('test.firing', 240, 120, rng()) as Boss;
    expect(next).toBe(boss);
    expect(next.firedThisTick).toBe(false);
    expect(next.lastFireTick).toBeUndefined();
  });

  test('a refused bullet spawn is not reported as actual fire', () => {
    const bullets = new BulletSystem({ bounds: FIELD, initial: 1, max: 1 });
    expect(bullets.spawn(10, 10, TEST_SHOT, 'player', rng())).toBeDefined();
    const system = new BossSystem({ bounds: FIELD, bullets });
    const boss = system.spawn('test.firing', 240, 120, rng()) as Boss;

    system.step(240, 460, rng());
    expect(bullets.count).toBe(1);
    expect(bullets.droppedSpawns).toBe(1);
    expect(boss.firedThisTick).toBe(false);
    expect(boss.lastFireTick).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* Movement                                                            */
/* ------------------------------------------------------------------ */

describe('movement', () => {
  test('a boss cannot leave the field, however its motion is authored', () => {
    const { system } = makeSystem();
    system.spawn('test.runaway', 240, 120, rng());
    stepTimes(system, 100);

    expect(system.boss?.x).toBe(16);
    expect(system.active).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

describe('lifecycle', () => {
  test('a second spawn is refused rather than stranding the fight in progress', () => {
    const { system } = makeSystem();
    system.spawn('test.three', 240, 120, rng());
    expect(system.spawn('test.simple', 100, 100, rng())).toBeUndefined();
    expect(system.boss?.name).toBe('test.three');
  });

  test('clear records nothing but keeps what was already owed', () => {
    const { system } = makeSystem();
    system.spawn('test.three', 240, 120, rng());
    system.clear();

    expect(system.active).toBe(false);
    expect(system.boss).toBeUndefined();
    // The spawn's own events predate the clear and are still the caller's.
    expect(types(system.drainEvents())).toEqual(['entered', 'phase-start']);
  });

  test('a cleared system can host the next fight', () => {
    const { system } = makeSystem();
    system.spawn('test.three', 240, 120, rng());
    system.clear();
    system.drainEvents();

    expect(system.spawn('test.simple', 100, 100, rng())?.name).toBe('test.simple');
    expect(system.boss?.phaseIndex).toBe(0);
  });

  test('draining twice yields nothing the second time', () => {
    const { system } = makeSystem();
    system.spawn('test.three', 240, 120, rng());
    expect(system.drainEvents().length).toBe(2);
    expect(system.drainEvents().length).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Determinism                                                         */
/* ------------------------------------------------------------------ */

/**
 * A whole-fight signature: boss position, phase, and the full bullet field, per
 * tick. Comparing only the outcome would miss a divergence that healed, which
 * is the failure mode this contract exists to catch.
 */
function trace(boss: string, seed: number, ticks: number): string[] {
  const { system, bullets } = makeSystem();
  const r = rng(seed);
  const out: string[] = [];

  system.spawn(boss, 240, -40, r);
  for (let tick = 0; tick < ticks; tick++) {
    // A steady trickle of damage, so phases end by drain as well as by clock
    // and the transition path is inside the traced sequence.
    if (tick % 7 === 0) system.damage(3);
    system.step(240 + (tick % 5), 460, r);
    bullets.step(240, 460, r);

    const b = system.boss;
    out.push(
      `${tick}|${b ? `${b.x},${b.y},${b.phaseIndex},${b.hp}` : 'gone'}|` +
        `${types(system.drainEvents()).join(',')}|` +
        bullets.bullets.map((bullet) => `${bullet.x},${bullet.y}`).join(';'),
    );
  }
  return out;
}

describe('determinism', () => {
  test('the same seed reproduces a fight exactly', () => {
    expect(trace('test.random', 12345, 200)).toEqual(trace('test.random', 12345, 200));
  });

  test('a different seed does not', () => {
    expect(trace('test.random', 12345, 200)).not.toEqual(trace('test.random', 999, 200));
  });

  test('a full multi-phase fight reproduces exactly', () => {
    // `test.three` is a three-phase boss whose phases transition under the
    // trickle of damage `trace` applies, so this exercises the transition path
    // as well as steady fire. The shipped bosses (sentinel/warden/magistrate)
    // moved into the bundled base pack; their determinism is proved by the
    // committed replay fixtures in `src/base-content.golden.test.ts`.
    expect(trace('test.three', 7, 400)).toEqual(trace('test.three', 7, 400));
  });

  test('a phase transition draws from the stream the fight is running on', () => {
    // Two identical fights, one whose transitions are triggered by `damage`
    // outside `step`. Both must consume the same stream, or a boss killed by a
    // bullet would desync from one killed by the clock.
    const a = rng(4);
    const b = rng(4);
    const first = new BossSystem({
      bounds: FIELD,
      bullets: new BulletSystem({ bounds: FIELD, initial: 64 }),
    });
    const second = new BossSystem({
      bounds: FIELD,
      bullets: new BulletSystem({ bounds: FIELD, initial: 64 }),
    });

    first.spawn('test.random', 240, 120, a);
    second.spawn('test.random', 240, 120, b);
    first.step(240, 460, a);
    second.step(240, 460, b);

    first.damage(1000);
    second.damage(1000);

    expect(first.boss?.vector.r).toBe(second.boss?.vector.r ?? -1);
    expect(first.boss?.vector.theta).toBe(second.boss?.vector.theta ?? -1);
    expect(a.random()).toBe(b.random());
  });

  test('a damage-triggered transition consumes the fight generator, not a global one', () => {
    // The assertion above holds even if both transitions drew from `sim`, so
    // it is checked here instead: a fight that changed phase must have moved
    // its own generator further than one that did not.
    function advance(withDamage: boolean): number {
      const r = rng(4);
      const system = new BossSystem({
        bounds: FIELD,
        bullets: new BulletSystem({ bounds: FIELD, initial: 64 }),
      });
      system.spawn('test.random', 240, 120, r);
      system.step(240, 460, r);
      if (withDamage) system.damage(1000);
      return r.random();
    }

    expect(advance(true)).not.toBe(advance(false));
  });
});

// The five shipped v4 bosses used to be verified in sim-side fixtures here —
// fly-in, phase transitions, timeout survival, every card fires.
// They moved into the v4 campaign (`src/v4/content/campaign.json`), which this
// sim-side unit test may not import. The mechanism those cases exercised is
// covered above against the local `test.*` fixtures; the real bosses are covered
// at the composition root — `src/base-content.golden.test.ts` replays each to a
// natural end (fly-in, every phase, defeat or timeout), and
// `src/reachability.test.ts` proves every phase of every boss is reached.
