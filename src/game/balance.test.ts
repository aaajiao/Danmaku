/**
 * The damage model, measured rather than asserted.
 *
 * `REFERENCE_DPS` is the number every boss in the game is sized from. Before
 * this file existed it was a literal — `MEASURED_DPS = 0.56`, typed once in a
 * test file, described in three prose comments, and checkable by nobody. It was
 * wrong, and the interesting part is *how* it was wrong:
 *
 *  - It was measured "at full power", and `Player.addPower` clamped power to 0
 *    for both shipped characters, so no player could ever fly at the rate it
 *    described.
 *  - `sim/boss.ts` sized `sentinel` above it, producing phases that could not be
 *    drained inside their own clocks by any loadout.
 *  - `content/stage-2.ts` read that, concluded the reference was far too
 *    generous, and sized its bosses an order of magnitude *below* it — a midboss
 *    with less health than two trash enemies, and a six-second final boss
 *    against a thirty-seven-second stage-1 one.
 *
 * One unverifiable constant, three consumers, three different wrong answers. So
 * this file drives the real `Run` and re-derives it. If player damage changes
 * for any reason — a weapon tier, an option layout, a hitbox shape — this fails
 * and the boss content has to be revisited, which is exactly the coupling that
 * was missing.
 *
 * This is a *balance* test, not a determinism one: it asserts the game is
 * playable, not that it is reproducible. `determinism.test.ts` owns the latter.
 */

import { describe, expect, test } from 'bun:test';

import '../content';
import { Button } from '../core/input';
import {
  bossNames,
  CLOCK_MARGIN,
  FLOOR_DPS,
  getBossSpec,
  REFERENCE_DPS,
} from '../sim/boss';
import { defineEnemy, enemyNames, getEnemySpec } from '../sim/enemy';
import { defineStage } from '../content/stage';
import { characterNames, Run } from './run';

/**
 * A target that cannot die, so pooling can never recycle it mid-measurement and
 * inflate the count. Radius 12 is a mid-sized boss; the number is not sensitive
 * to it once the weapon ladders nest (see `content/shots.test.ts`).
 */
const SINK = 'balance.sink';
defineEnemy(SINK, {
  sprite: 'orb.large',
  hp: 1_000_000,
  radius: 12,
  motion: { r: 0, theta: 0 },
  scoreValue: 0,
  despawnMargin: 4000,
});

/** No waves: the stage script must not spawn anything into the measurement. */
const EMPTY = 'balance.empty';
defineStage(EMPTY, { name: EMPTY, outro: 0, waves: [] });

const TICKS = 600;
const DISTANCE = 100;

/**
 * Damage per tick this loadout lands on a target held dead ahead.
 *
 * The pilot is perfect — it never dodges and the target never moves — so this
 * is an *upper* bound on what the loadout can do. A real player's rate is
 * lower, which is what `CLOCK_MARGIN` covers: the timer runs to twice the
 * reference drain, so falling short of perfect play costs the bonus rather than
 * the fight.
 */
function measureDps(character: string, power: number, focused: boolean): number {
  const run = new Run({ seed: 0x5a1a5, character, stage: EMPTY });
  const player = run.player;
  const sink = run.enemies.spawn(SINK, player.x, player.y - DISTANCE);
  if (sink === undefined) throw new Error('balance: the sink did not spawn');

  const before = sink.hp;
  for (let tick = 0; tick < TICKS; tick++) {
    // Written every tick: `addPower` clamps, and a death would otherwise spend
    // the power this measurement is about.
    player.power = power;
    sink.x = player.x;
    sink.y = player.y - DISTANCE;
    run.tick(Button.Shot | (focused ? Button.Slow : 0));
  }
  return (before - sink.hp) / TICKS;
}

/** Every reachable loadout: both ships, every power tier, focused and not. */
function everyLoadout(): { label: string; dps: number }[] {
  const out: { label: string; dps: number }[] = [];
  for (const character of characterNames()) {
    if (character.startsWith('test')) continue;
    // A pack character (namespaced) is proven by its own acceptance test, not
    // here: `REFERENCE_DPS` is derived from the engine's own reference loadouts,
    // and a pack must not be able to move the number every boss is sized from.
    if (character.includes('/')) continue;
    const maxPower = new Run({ seed: 1, character, stage: EMPTY }).player.maxPower;
    for (let power = 0; power <= maxPower; power++) {
      for (const focused of [false, true]) {
        out.push({
          label: `${character} p${power} ${focused ? 'focused' : 'free'}`,
          dps: measureDps(character, power, focused),
        });
      }
    }
  }
  return out;
}

describe('the damage model', () => {
  test('REFERENCE_DPS is a rate a real loadout actually achieves', () => {
    const loadouts = everyLoadout();
    const rates = loadouts.map((l) => l.dps);

    // Not the ceiling and not the floor: something in the middle of what the
    // game can produce. A reference above everything reachable is what the old
    // 0.56 was, and it is the failure this test exists to make impossible.
    expect(REFERENCE_DPS).toBeLessThanOrEqual(Math.max(...rates));
    expect(REFERENCE_DPS).toBeGreaterThan(Math.min(...rates));
  });

  test('FLOOR_DPS is below every loadout a player arrives with', () => {
    // Power 0 is excluded deliberately, and the exclusion is the definition:
    // reaching a boss having collected nothing is a failure state, and sizing
    // every clock for it would make timing out unreachable for everyone else.
    // See `FLOOR_DPS`. The p0 rates are asserted below so the exclusion cannot
    // quietly become "we do not measure that".
    for (const { label, dps } of everyLoadout()) {
      if (label.includes(' p0 ')) continue;
      expect(`${label}: ${dps >= FLOOR_DPS}`).toBe(`${label}: true`);
    }
  });

  test('a bare tier-0 ship is weaker than the floor, but not by much', () => {
    const bare = everyLoadout().filter((l) => l.label.includes(' p0 '));
    expect(bare.length).toBeGreaterThan(0);
    for (const { label, dps } of bare) {
      // Under half the floor would mean the first power pickup more than
      // doubles the ship, which is too large a cliff to sit at tier 0.
      expect(`${label}: ${dps > FLOOR_DPS / 2}`).toBe(`${label}: true`);
    }
  });

  test('the reference is within a factor of two of the weakest loadout', () => {
    // The spread across loadouts is the difficulty curve. Too wide and the
    // health that suits one ship makes the other unplayable, which is how
    // `scout` and `lance` came to differ by 2.7x unfocused before the weapon
    // ladders were nested.
    const rates = everyLoadout().map((l) => l.dps);
    expect(Math.max(...rates) / Math.min(...rates)).toBeLessThan(5);
  });
});

describe('boss health is derived from it', () => {
  for (const name of bossNames()) {
    if (name.startsWith('test')) continue;
    // Pack bosses (namespaced) are re-derived from the same `phaseHp`/`phaseClock`
    // functions, so this coupling holds for them by construction; their own
    // acceptance path proves it, and a pack injected into this shared process
    // must not turn this engine-reference test red.
    if (name.includes('/')) continue;

    test(`${name}: every phase can be drained inside its own clock`, () => {
      // The defect this catches by name: a phase whose timer expires before its
      // health can be spent is not difficulty, it is a cutscene — the fight
      // lasts the same length however well it is played. Every non-spell
      // opening phase in the game was one.
      //
      // Measured against `REFERENCE_DPS` with the full `CLOCK_MARGIN` demanded,
      // not merely "drainable by somebody": a clock a competent player only
      // just beats is one a slightly worse player cannot, and the failure comes
      // back silently.
      for (const [index, phase] of getBossSpec(name).phases.entries()) {
        const ticksToDrain = phase.hp / REFERENCE_DPS;
        const where = `${name} phase ${index} "${phase.name}"`;
        expect(`${where}: ${ticksToDrain * CLOCK_MARGIN <= phase.timeLimit}`)
          .toBe(`${where}: true`);
      }
    });

    test(`${name}: no phase's clock is so long that not firing is free`, () => {
      // The other side of the same number. A timer far above the drain time
      // makes outlasting a card the easy path, and a run where every card times
      // out is one the player never had to fight.
      for (const [index, phase] of getBossSpec(name).phases.entries()) {
        const ratio = phase.timeLimit / (phase.hp / REFERENCE_DPS);
        const where = `${name} phase ${index} "${phase.name}" ratio ${ratio.toFixed(2)}`;
        expect(`${where}: ${ratio <= CLOCK_MARGIN + 0.2}`).toBe(`${where}: true`);
      }
    });

    test(`${name}: the fight is minutes-free at the reference rate`, () => {
      const seconds = getBossSpec(name).phases
        .reduce((total, phase) => total + phase.hp / REFERENCE_DPS, 0) / 60;
      // Upper bound only. A boss that takes longer than this is not hard, it is
      // long — `sentinel` ran 106 to 126 seconds against a 3-second midboss.
      expect(`${name}: ${seconds.toFixed(1)}s under 90s: ${seconds < 90}`)
        .toBe(`${name}: ${seconds.toFixed(1)}s under 90s: true`);
    });
  }

  test('bosses escalate: the last fight is the longest', () => {
    const length = (name: string) =>
      getBossSpec(name).phases.reduce((t, p) => t + p.hp / REFERENCE_DPS, 0);

    // warden is a midboss, sentinel ends stage 1, magistrate ends the game.
    expect(length('warden')).toBeLessThan(length('sentinel'));
    expect(length('sentinel')).toBeLessThan(length('magistrate'));
  });
});

describe('ordinary enemies die to ordinary fire', () => {
  test('no trash enemy takes longer than a second of sustained fire', () => {
    // The complaint that started the audit: "killing a normal enemy should take
    // one hit, and it takes ages". It took 0.90s for a `grunt` at the power a
    // player could actually reach, because power was pinned at 0.
    for (const name of enemyNames()) {
      if (name.startsWith('balance.') || name.startsWith('test')) continue;
      const seconds = getEnemySpec(name).hp / REFERENCE_DPS / 60;
      expect(`${name}: ${seconds.toFixed(2)}s`).toBe(
        `${name}: ${Math.min(seconds, 1.2).toFixed(2)}s`,
      );
    }
  });

  test('and a boss is an order of magnitude above the toughest of them', () => {
    // Otherwise "boss" is a label rather than a fight. `warden` had 60 hp
    // against `bastion`'s 70.
    const toughest = Math.max(
      ...enemyNames()
        .filter((n) => !n.startsWith('balance.') && !n.startsWith('test'))
        .map((n) => getEnemySpec(n).hp),
    );
    for (const name of bossNames()) {
      if (name.startsWith('test')) continue;
      const total = getBossSpec(name).phases.reduce((t, p) => t + p.hp, 0);
      expect(`${name}: ${total > toughest * 10}`).toBe(`${name}: true`);
    }
  });
});
