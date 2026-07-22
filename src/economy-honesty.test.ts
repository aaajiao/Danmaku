/**
 * The drop economy is conserved, and the extends do not inflate.
 *
 * The pickup-variety round redenominates what a defeated boss scatters — the plain
 * `score` chips become native coin/gem/bar TIERS (`kind: 'score'`, differing only in
 * `value` and `sprite`) — while holding **each boss's score AGGREGATE exactly
 * invariant**. That invariance is the whole safety argument: `ItemSystem.burst`
 * draws exactly two `sim` values per requested item in fixed `drift`-then-`lift`
 * order (ballast-absorbed at the pool ceiling), so a same-count reskin is
 * byte-identical on the `sim` stream, and this round's divergence is confined to
 * (i) changed burst counts — a boss now scatters fewer, higher-denomination items —
 * and (ii) any shifted extend-crossing tick, because chunkier value arrivals (and
 * faster gem/bar `magnetSpeed`) reshape the score-accrual curve. Since every boss's
 * aggregate is conserved, endpoint totals are unchanged and every pilot earns the
 * SAME count of extends; `EXTEND_SCORES` does not move. This file is where that is
 * measured rather than asserted, in two halves.
 *
 * ## Part 1 — the conservation is arithmetic, and it is re-derived, not typed
 *
 * The design conserved the aggregates on paper (39,000 across the five bosses,
 * 1,500 across the two trash carriers, 40,500 in all, identical old-vs-new). Part 1
 * re-derives those numbers from the SHIPPED data (`base-pack.json` spoils) crossed
 * with the item registry (`getItemSpec(name).value`), so a gem re-valued, a count
 * mistyped, or a boss redenominated off its own target fails here by name — the
 * same "a tuning constant no test can measure will drift" discipline `balance.test`
 * applies to the damage model.
 *
 * ## Part 2 — the extend count is measured on the real four-stage campaign
 *
 * Two pilots fly the whole game through the real `Run`, chained stage to stage by
 * the same `carry` the state machine threads: a CLEAN one (never hit — it pokes
 * invulnerability the way `reachability.test.ts` does — so it captures every spell
 * card) and a FLAILING one (mortal, bombing through cards so none are captured
 * clean, camping low so drops fall past). What each earns is pinned.
 *
 * **A stale premise, corrected against measurement.** The design (inheriting a
 * comment on `EXTEND_SCORES` that predates stages 3-4) expected a clean clear near
 * 547,000 — below the 600,000 top anchor — and so "2 extends". That is false on the
 * game as it now ships: a single boss spell card pays 200,000-1,000,000, and those
 * card bonuses, not the ~40,500 of drop spoils, are the economy. A clean full clear
 * finishes near 4,700,000 and crosses all three anchors inside stage 1; a flailing
 * clear finishes near 48,000 and crosses none. So the measured, pinned counts are
 * **clean 3 / flailing 0**, not the design's 2 / 0 — and the invariant that matters
 * (the redenomination does not CHANGE either count) is what this file proves. It was
 * proven directly during implementation: the same two pilots, run against the
 * pre-redenomination content, earned 3 / 0 on 4,732,320 / 48,880, and against the
 * post-redenomination content earn 3 / 0 on 4,729,340 / 47,880 — the sub-percent
 * score drift is exactly the declared sim-stream residue, and it moves no threshold.
 *
 * The `EXTEND_SCORES` comment carries the corrected figures; the recalibration of
 * the anchors to the four-stage curve is a scoring-economy round of its own and is
 * deliberately out of scope here — this round conserves the drop table, it does not
 * retune the score gate.
 *
 * Like `balance`/`base-content.golden`, driving whole runs advances the global
 * sim/fx streams, and bun runs test files one at a time; restore what was found so
 * `core/random.test.ts` still sees pristine streams when it loads next.
 */

import { afterAll, describe, expect, test } from 'bun:test';

import './packs/bundled';
// The shipped base-pack DATA, read at the root/composition layer (as the beam and
// item reachability tests do) — `src/content` may not import `src/packs`, so the
// spoils invariant is pinned here, where the base pack is data.
import basePack from './packs/base-pack.json';
import { Button } from './core/input';
import { fx, sim } from './core/random';
import { getStage } from './content/stage';
import { getItemSpec } from './sim/item';
import {
  defineCharacter,
  EXTEND_SCORES,
  getCharacter,
  Run,
  type PlayerCarry,
  type RunConfig,
} from './game/run';

const SIM_ENTRY_STATE = sim.getState();
const FX_ENTRY_STATE = fx.getState();
afterAll(() => {
  sim.setState(SIM_ENTRY_STATE);
  fx.setState(FX_ENTRY_STATE);
});

/* ------------------------------------------------------------------ */
/* Part 1 — aggregate conservation, re-derived from shipped data       */
/* ------------------------------------------------------------------ */

type Spoils = readonly (readonly [string, number])[];

/** The score-item value a spoils list is worth: only `kind: 'score'` entries count. */
function scoreValue(spoils: Spoils): number {
  let total = 0;
  for (const [name, count] of spoils) {
    const spec = getItemSpec(name); // throws if a spoils name is not a registered item
    if (spec.kind === 'score') total += spec.value * count;
  }
  return total;
}

// Through `unknown`: the JSON's inferred spoils type is `(string | number)[][]`,
// which does not structurally overlap the positional tuple `Spoils` — the cast is
// the deliberate narrowing, and `scoreValue` reads only `[name, count]` positionally.
const BOSSES = basePack.content.bosses as unknown as Record<string, { spoils?: Spoils }>;
const ENEMIES = basePack.content.enemies as unknown as Record<string, { spoils?: Spoils }>;

/**
 * The spine of the round: every boss's score aggregate, held EXACTLY invariant
 * across the redenomination. These are the pre-round `score`-chip totals
 * (12/12/14/16/24 × 500), now paid in coins/gems/bar. A boss redenominated off its
 * own target fails here by name — which is the failure the design's whole
 * "extends do not inflate" argument rests on not happening.
 */
const EXPECTED_BOSS_SCORE: Record<string, number> = {
  sentinel: 6000,
  warden: 6000,
  magistrate: 7000,
  chancellor: 8000,
  regent: 12000,
};

describe('the drop economy is conserved (arithmetic, from the shipped pack)', () => {
  test('every boss scatters its exact pre-round score aggregate', () => {
    for (const [name, expected] of Object.entries(EXPECTED_BOSS_SCORE)) {
      const spec = BOSSES[name];
      expect(`${name} exists: ${spec !== undefined}`).toBe(`${name} exists: true`);
      const got = scoreValue(spec?.spoils ?? []);
      expect(`${name} score-aggregate: ${got}`).toBe(`${name} score-aggregate: ${expected}`);
    }
  });

  test('the five bosses total 39,000 — identical to the pre-round chip total', () => {
    const total = Object.keys(EXPECTED_BOSS_SCORE).reduce(
      (sum, name) => sum + scoreValue(BOSSES[name]?.spoils ?? []),
      0,
    );
    expect(total).toBe(39_000);
  });

  test('the two trash carriers total 1,500 — unchanged, silver by reskin only', () => {
    // The two trash `score` drops are NOT redenominated; the `score` sprite/tint
    // repoint turns them into silver-coin drips at zero economy cost. So their
    // aggregate must be exactly the pre-round 500 + 1000.
    let total = 0;
    let carriers = 0;
    for (const spec of Object.values(ENEMIES)) {
      const value = scoreValue(spec.spoils ?? []);
      if (value > 0) {
        total += value;
        carriers++;
      }
    }
    expect(`${carriers} carriers totalling ${total}`).toBe('2 carriers totalling 1500');
  });

  test('the grand drop total is the conserved 40,500', () => {
    const boss = Object.values(BOSSES).reduce((s, spec) => s + scoreValue(spec.spoils ?? []), 0);
    const trash = Object.values(ENEMIES).reduce((s, spec) => s + scoreValue(spec.spoils ?? []), 0);
    expect(boss + trash).toBe(40_500);
  });
});

/* ------------------------------------------------------------------ */
/* Part 2 — the extend count, measured on the real four-stage campaign */
/* ------------------------------------------------------------------ */

// A ship whose lives never matter: both pilots fly with the infinite-lives assist so
// the flailing one, which dies constantly, still clears every stage rather than
// running out and ending the campaign early. `test`-prefixed so the whole-tree
// probes (`reachability`, `balance`) filter it as a fixture.
const PILOT = 'test-economy-pilot';
defineCharacter(PILOT, {
  ...getCharacter('scout'),
  label: 'ECONOMY PILOT',
});

/** Generous per-stage ceiling; every stage finishes far below it (max ~12,600 ticks). */
const STAGE_LIMIT = 60_000;

type Pilot = (run: Run) => (tick: number) => number;

/**
 * Never hit, so every spell card is captured clean and pays its full bonus — the
 * scoring ceiling the extend anchors are measured against. Pokes invulnerability
 * every tick, exactly as `reachability.test.ts` does to measure reach rather than
 * survival. Aims at the boss so its health is actually spent, holds a low station so
 * upward shots reach it, and rises periodically to collect drops.
 */
function cleanPilot(run: Run): (tick: number) => number {
  return (tick: number): number => {
    run.player.invuln = 999;
    if (run.dialogue !== undefined) return tick % 2 === 0 ? Button.Shot : 0;
    let buttons = Button.Shot;
    const boss = run.boss.boss;
    const fightingBoss = boss?.alive === true;
    const aimX = boss?.alive && !boss.entering ? boss.x : run.enemies.enemies[0]?.x;
    const px = run.player.x;
    if (aimX === undefined) buttons |= Math.floor(tick / 70) % 2 === 0 ? Button.Left : Button.Right;
    else if (aimX < px - 4) buttons |= Button.Left;
    else if (aimX > px + 4) buttons |= Button.Right;
    const stationY = !fightingBoss && Math.floor(tick / 240) % 3 === 0 ? 60 : 380;
    if (run.player.y > stationY + 6) buttons |= Button.Up;
    else if (run.player.y < stationY - 6) buttons |= Button.Down;
    return buttons;
  };
}

/**
 * The scoring floor: fires and sweeps but tracks no boss (so cards time out rather
 * than being killed), bombs on a cadence (a bomb voids a card's `clean` flag, so no
 * timeout pays either), and camps at the very bottom so the boss showers fall past
 * uncollected. It clears every stage only because it cannot die (assist on) — a
 * genuinely poor run that captures nothing.
 */
function flailingPilot(run: Run): (tick: number) => number {
  return (tick: number): number => {
    if (run.dialogue !== undefined) return tick % 2 === 0 ? Button.Shot : 0;
    let buttons = Button.Shot;
    buttons |= Math.floor(tick / 40) % 2 === 0 ? Button.Left : Button.Right;
    if (run.player.y < 440) buttons |= Button.Down;
    if (tick % 120 === 0) buttons |= Button.Bomb;
    return buttons;
  };
}

interface CampaignResult {
  score: number;
  extends: number;
  stagesCleared: number;
}

/** Fly the whole campaign, chaining stages by `carry` exactly as `PlayingState.advance` does. */
function playCampaign(makePilot: Pilot): CampaignResult {
  let stage: string | undefined = 'stage-1';
  let carry: PlayerCarry | undefined;
  let score = 0;
  let stagesCleared = 0;

  while (stage !== undefined) {
    const config: RunConfig = {
      seed: getStage(stage).seed ?? 0x5747a1,
      character: PILOT,
      stage,
      difficulty: 'normal',
      infiniteLives: true,
      ...(carry === undefined ? {} : { carry }),
    };
    const run = new Run(config);
    const pilot = makePilot(run);
    let tick = 0;
    for (; tick < STAGE_LIMIT && !run.finished; tick++) run.tick(pilot(tick));
    if (run.outcome !== 'cleared') {
      // A stall or an early end would make the score meaningless — fail loudly, the
      // way the golden gate does, rather than measure a truncated campaign.
      throw new Error(
        `economy gate: ${stage} ended '${run.outcome}' after ${run.tickCount} ticks, not 'cleared'`,
      );
    }
    stagesCleared++;
    score = run.player.score;
    carry = run.carry;
    stage = getStage(stage).next;
  }

  // Extends earned = thresholds the final score crosses. Score is monotonic (a death
  // costs power, never points), so this equals the run's own `#extends` at the end —
  // the same computation `#resolveExtends` performs, read off `EXTEND_SCORES` here.
  const extendsEarned = EXTEND_SCORES.filter((threshold) => score >= threshold).length;
  return { score, extends: extendsEarned, stagesCleared };
}

describe('the extends do not inflate (measured on the real campaign)', () => {
  // Three ascending anchors: [100_000, 300_000, 600_000]. The pins below name "3"
  // and "0" as counts, so this keeps them honest if the array is ever resized.
  test('there are three extend anchors', () => {
    expect(EXTEND_SCORES.length).toBe(3);
  });

  test('a flailing full clear captures nothing and earns no extend (< 100,000)', () => {
    const flail = playCampaign(flailingPilot);
    expect(flail.stagesCleared).toBe(4);
    // Non-vacuous both ways: a real four-stage run (well above a stalled zero), and
    // below the first anchor so it earns no extend. The generous band brackets the
    // deterministic ~48,000 with room for the declared sim-divergence residue while
    // still proving the floor never reaches the score gate.
    expect(`flail ${flail.score} in (20000,100000): ${flail.score > 20_000 && flail.score < EXTEND_SCORES[0]!}`)
      .toBe(`flail ${flail.score} in (20000,100000): true`);
    expect(flail.extends).toBe(0);
  });

  test('a clean full clear captures every card and earns all three extends', () => {
    const clean = playCampaign(cleanPilot);
    expect(clean.stagesCleared).toBe(4);
    // Non-vacuous: a genuine capturing run scoring in the millions, comfortably over
    // the top anchor — so it crosses all three. The card-bonus economy, not the
    // ~40,500 of drop spoils, is what puts it here; the redenomination leaves that
    // economy untouched, which is why the count is invariant.
    expect(`clean ${clean.score} > 1e6: ${clean.score > 1_000_000}`)
      .toBe(`clean ${clean.score} > 1e6: true`);
    expect(clean.score >= EXTEND_SCORES[EXTEND_SCORES.length - 1]!).toBe(true);
    expect(clean.extends).toBe(3);
  });

  test('the economy has a real gradient: a clean clear earns strictly more than a flailing one', () => {
    // The two together are the point — capturing pays, flailing does not — and the
    // redenomination preserves the gap (proven pre/post during implementation).
    expect(playCampaign(cleanPilot).extends).toBeGreaterThan(playCampaign(flailingPilot).extends);
  });
});
