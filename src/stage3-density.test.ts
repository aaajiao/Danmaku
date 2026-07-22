/**
 * Stage-3's trash curtain must stay readable, not just look readable once.
 *
 * The density doctrine (`test/visual` density page, CLAUDE.md §Verification) judged
 * the field readable at ~2000 concurrent bullets and soup at ~5000. That judgement
 * rested on one live viewing. This is the headless probe that pins it for the three
 * densest trash moments of stage-3, so the claim stops resting on a single look.
 *
 * ## This measures concurrent population, not cumulative emission
 *
 * `src/difficulty-honesty.test.ts` is the sibling that never steps bullets: its
 * `BulletSystem.count` is the *total emitted* over a window — the right quantity
 * for "does the tier fire more?". It is the wrong quantity for "is the curtain
 * readable?", which is about how many bullets are *in the air at once*. So here the
 * bullets are stepped every tick, off-field ones despawn, and the count read after
 * `step()` is the live concurrent population. The peak of that over the window is
 * what the density doctrine's 2000-bullet limit is denominated in. Because no
 * player fires, every live bullet is enemy fire, so `count` is exactly the enemy
 * curtain.
 *
 * ## The three windows, all from stage-3's own waves (`v4/content/campaign.json`)
 *
 * - **Stele slice [620, 780)** — the pure-stele curtain *before* the summons fans
 *   begin at spawn+24 (=784). The two steles at `at: 620` plus the one at `at: 700`
 *   overlap their verdigris `ring`s (each fires spawn+55..spawn+220). The window
 *   closes at 780 mid-ramp, so this isolates the stele rings alone — no fans yet.
 *   Peak is `orb.medium` (rings) plus `orb.small` (leftover clerk fans), no `needle`.
 * - **Overlap [780, 1000)** — the densest *combined* moment of the stele/summons
 *   block, where the lingering ring tails (the 620/620/700 steles fire until 840/840/
 *   920) overlap the arriving `summons` fans. This is a total-readability window, not
 *   a summons-only guard: at the peak the curtain is ~94% lingering stele rings and
 *   the homing `SUBPOENA` needles are only a few dozen bullets. It guards the whole
 *   curtain the eye sees in that region, whichever pattern owns the bullets.
 * - **Assessor finale [1180, 1500)** — the genuinely densest trash curtain of the
 *   stage, and the worst case for the readability doctrine. The two `assessor`s at
 *   `at: 1180`, the third at `at: 1400` and the `stele` at `at: 1460` stack, and the
 *   peak is a `spark` curtain (~500 bullets) an order of magnitude thicker than the
 *   summons needles. The older version of this probe stopped at tick 1000 and never
 *   reached it; `SCAN_TICKS` now runs past it.
 *
 * Driven on **lunatic**, the densest tier, with an idle-but-alive pilot: nothing is
 * killed, so every enemy lives its full timeline and fires its whole pattern — the
 * undisturbed curtain, which is the worst case. Seed and windows are fixed, so the
 * peaks are reproducible. `normal` is measured alongside for context only.
 *
 * ## Measured peaks (concurrent live enemy bullets, seed 0x3c1d05)
 *
 *                 stele [620,780)    overlap [780,1000)    finale [1180,1500)
 *   normal            230                 308                    325
 *   lunatic           431                 547                    681
 *
 * ## Budgets
 *
 * Each ceiling sits between the measured lunatic peak and the doctrine's readable
 * 2000, with ~33-36% headroom above the peak (never near 2000):
 *
 *   stele   : 431 * 1.33 ≈ 573  → budget 575  (33% over peak, 29% of the 2000 limit)
 *   overlap : 547 * 1.37 ≈ 750  → budget 750  (37% over peak, 38% of the 2000 limit)
 *   finale  : 681 * 1.36 ≈ 926  → budget 925  (36% over peak, 46% of the 2000 limit)
 *
 * A re-authored wave that thickens any window past its budget fails here, named,
 * before it ever reaches the density page. The floors (well below each peak, far
 * above zero) fail if a renamed enemy or shifted `at` tick leaves the probe scanning
 * an empty window — the "wire with nothing on it" shape this project keeps catching.
 */

import { describe, expect, test } from 'bun:test';

import './v4';
import { BulletSystem } from './sim/bullet';
import { type Difficulty } from './sim/difficulty';
import { EnemySystem } from './sim/enemy';
import { Random } from './core/random';
import { getStage, StageRunner } from './content/stage';

const BOUNDS = { width: 480, height: 640, margin: 64 };
const TARGET = { x: 240, y: 520 };

/** The doctrine's readable ceiling; soup begins near 5000 (CLAUDE.md §Verification). */
const READABLE_LIMIT = 2000;

/** Stele slice: the 620+620+700 steles' rings, isolated before the fans begin at 784. */
const STELE_WINDOW = { lo: 620, hi: 780 } as const;
/** Overlap: the lingering ring tails meet the 760+820 summons fans — total readability. */
const OVERLAP_WINDOW = { lo: 780, hi: 1000 } as const;
/** Assessor finale: the 1180×2 + 1400 assessors and the 1460 stele — the densest trash. */
const FINALE_WINDOW = { lo: 1180, hi: 1500 } as const;

/** Far enough past the last probed window (finale peaks at 1426) to fill it; short of the boss (at 1620). */
const SCAN_TICKS = 1500;

/**
 * Peak concurrent live enemy bullets over `[lo, hi)` on `tier`, undisturbed.
 *
 * Same seed at every tier, so runs begin identically and diverge only by what the
 * tier fires. Nothing is damaged, so every enemy lives its full timeline. Bullets
 * are stepped each tick — the whole point, and what separates this from the
 * cumulative-emission probe in `difficulty-honesty.test.ts` — so the count read is
 * the live population, and its window peak is the readable-limit quantity.
 */
function windowPeak(tier: Difficulty, lo: number, hi: number): number {
  const bullets = new BulletSystem({ bounds: BOUNDS, initial: 4000 });
  const enemies = new EnemySystem({ bounds: BOUNDS, bullets, difficulty: tier });
  const runner = new StageRunner(getStage('stage-3'), enemies);
  const rng = new Random(0x3c1d05);
  let peak = 0;
  for (let t = 0; t < SCAN_TICKS; t++) {
    runner.step(rng);
    enemies.step(TARGET.x, TARGET.y, rng);
    bullets.step(TARGET.x, TARGET.y, rng);
    if (t >= lo && t < hi && bullets.count > peak) peak = bullets.count;
  }
  return peak;
}

describe('stage-3 trash curtain stays readable', () => {
  const steleLunatic = windowPeak('lunatic', STELE_WINDOW.lo, STELE_WINDOW.hi);
  const steleNormal = windowPeak('normal', STELE_WINDOW.lo, STELE_WINDOW.hi);
  const overlapLunatic = windowPeak('lunatic', OVERLAP_WINDOW.lo, OVERLAP_WINDOW.hi);
  const overlapNormal = windowPeak('normal', OVERLAP_WINDOW.lo, OVERLAP_WINDOW.hi);
  const finaleLunatic = windowPeak('lunatic', FINALE_WINDOW.lo, FINALE_WINDOW.hi);
  const finaleNormal = windowPeak('normal', FINALE_WINDOW.lo, FINALE_WINDOW.hi);

  // Surfaced in the gate output: the measured peaks, so a reviewer sees the numbers
  // the budgets are set against rather than a bare pass.
  // eslint-disable-next-line no-console
  console.log(
    'stele slice [620,780) peak:   ',
    `normal=${steleNormal}  lunatic=${steleLunatic}  (budget 575, limit ${READABLE_LIMIT})`,
  );
  // eslint-disable-next-line no-console
  console.log(
    'overlap [780,1000) peak:      ',
    `normal=${overlapNormal}  lunatic=${overlapLunatic}  (budget 750, limit ${READABLE_LIMIT})`,
  );
  // eslint-disable-next-line no-console
  console.log(
    'assessor finale [1180,1500) peak:',
    `normal=${finaleNormal}  lunatic=${finaleLunatic}  (budget 925, limit ${READABLE_LIMIT})`,
  );

  // CEILING: the undisturbed lunatic stele slice stays under a budget between the
  // measured peak (431) and the readable 2000 — 575, ~33% headroom. A wave
  // re-authored to blow past it fails here, named, before the density page ever
  // sees it.
  test('the stele slice stays under its readability budget on lunatic', () => {
    const budget = 575;
    expect(budget).toBeLessThan(READABLE_LIMIT); // the budget itself honours the doctrine
    expect(
      `stele slice lunatic peak=${steleLunatic} <= budget ${budget}: ${steleLunatic <= budget}`,
    ).toBe(`stele slice lunatic peak=${steleLunatic} <= budget ${budget}: true`);
  });

  // CEILING: the combined ring-tail + fan overlap — measured peak 547, budget 750,
  // ~37%. This is a total-readability guard for the region, not a summons-only one.
  test('the overlap window stays under its readability budget on lunatic', () => {
    const budget = 750;
    expect(budget).toBeLessThan(READABLE_LIMIT);
    expect(
      `overlap lunatic peak=${overlapLunatic} <= budget ${budget}: ${overlapLunatic <= budget}`,
    ).toBe(`overlap lunatic peak=${overlapLunatic} <= budget ${budget}: true`);
  });

  // CEILING: the densest trash curtain of the stage — the assessor finale. Measured
  // peak 681 (a ~500-bullet spark curtain), budget 925, ~36%. This is the worst case
  // for the readability doctrine; it must be guarded or a re-authored finale can turn
  // into soup unseen.
  test('the assessor finale stays under its readability budget on lunatic', () => {
    const budget = 925;
    expect(budget).toBeLessThan(READABLE_LIMIT);
    expect(
      `finale lunatic peak=${finaleLunatic} <= budget ${budget}: ${finaleLunatic <= budget}`,
    ).toBe(`finale lunatic peak=${finaleLunatic} <= budget ${budget}: true`);
  });

  // FLOOR: each window is genuinely exercised — a floor well below the measured peak
  // but far above zero. If a renamed enemy or a shifted `at` tick leaves a window
  // empty, its peak collapses toward zero and this fails, so the ceilings above can
  // never pass by measuring nothing.
  test('all three windows actually fire — the probe is not scanning an empty field', () => {
    const steleFloor = 150; // 35% of the measured 431
    const overlapFloor = 200; // 37% of the measured 547
    const finaleFloor = 250; // 37% of the measured 681
    expect(
      `stele=${steleLunatic}>=${steleFloor} overlap=${overlapLunatic}>=${overlapFloor} ` +
        `finale=${finaleLunatic}>=${finaleFloor}: ` +
        `${steleLunatic >= steleFloor && overlapLunatic >= overlapFloor && finaleLunatic >= finaleFloor}`,
    ).toBe(
      `stele=${steleLunatic}>=${steleFloor} overlap=${overlapLunatic}>=${overlapFloor} ` +
        `finale=${finaleLunatic}>=${finaleFloor}: true`,
    );
  });
});
