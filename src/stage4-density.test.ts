/**
 * Stage-4's curtain must stay readable, not just look readable once — the same
 * guard `stage3-density.test.ts` gives stage 3, extended to the final stage's two
 * dense zones: its pre-boss trash squeeze *and* the Regent's composed finale cards.
 *
 * Stage 4 is the peak of the campaign, so it is the worst case for the readability
 * doctrine (`test/visual` density page, CLAUDE.md §Verification): the field is judged
 * readable at ~2000 concurrent bullets and soup at ~5000. That judgement rested on
 * one live viewing; this pins it headlessly for the moments most likely to drift past
 * it, so the claim stops resting on a single look. It records stage-4's OWN windows
 * and does **not** touch the stage-3 windows `stage3-density.test.ts` pins.
 *
 * ## This measures concurrent population, not cumulative emission
 *
 * `src/difficulty-honesty.test.ts` is the sibling that never steps bullets: its
 * `BulletSystem.count` is the *total emitted* over a window — the right quantity for
 * "does the tier fire more?", the wrong one for "is the curtain readable?", which is
 * about how many bullets are *in the air at once*. So here bullets are stepped every
 * tick, off-field ones despawn, and the count read after `step()` is the live
 * concurrent population. The peak of that over a window is what the 2000-bullet limit
 * is denominated in. No player fires, so every live bullet is enemy fire.
 *
 * ## Two trash windows, from stage-4's own waves (`v4/content/campaign.json`)
 *
 * - **Mid composite [760, 1040)** — the two `marshal`s at `at: 760` lay their
 *   `ring`-walls while an `usher` bank sweeps and the `assessor` at `980` dives: a
 *   sideways read under stationary walls, the stage-2/stage-3 lessons stacked. Peak
 *   is `orb`/`needle` mixed, the densest moment before the squeeze.
 * - **Pre-boss squeeze [1180, 1600)** — the genuinely densest trash curtain of the
 *   stage and its worst case: the `notary` + `marshal` at `at: 1180`, the two `usher`
 *   banks at `1260`/`1280` and the `grunt` pair at `1440` stack, and the `notary`'s
 *   `spiral` under the marshal ring-wall is the peak (615 concurrent @tick 1396). The
 *   window runs past the last wave and short of the boss hand-off.
 *
 * ## Two boss windows — the Regent's composed finale cards
 *
 * The boss is driven the way `difficulty-honesty.test.ts` drives one: spawn `regent`,
 * step past the fly-in, then drain each preceding phase with one large hit (overkill
 * is discarded) to arm the target card. A 260-tick warm-up then lets the drain's
 * residual fly off-field and the card reach steady state, so the measured peak is the
 * card's *own* sustained population, not an artifact of how it was reached.
 *
 * - **Statute (phase 4)** — `ring` + `spray` + `spiral` at once, the chancellor recap:
 *   all three primitive curtains on the field together, the densest general card (484
 *   concurrent on lunatic).
 * - **Sine Die (phase 5, lunatic-only finale)** — `spiral` + `aimed-fan` + `ring`, the
 *   composed maximum with a designed lane (437 concurrent). It exists only on lunatic,
 *   so it is measured there alone.
 *
 * Both cards cap their counts by design so the peak stays a curtain-with-a-lane; this
 * is the headless proof of that cap.
 *
 * ## Measured peaks (concurrent live bullets, lunatic the worst-case tier)
 *
 *                    normal   lunatic
 *   mid [760,1040)     243       465
 *   squeeze [1180,)    332       615
 *   Statute (card 4)   256       484
 *   Sine Die (card 5)   —        437   (lunatic-only)
 *
 * ## Budgets
 *
 * Each ceiling sits between the measured lunatic peak and the doctrine's readable
 * 2000, with ~33-36% headroom above the peak (never near 2000):
 *
 *   mid      : 465 * 1.35 ≈ 628  → budget 630  (35% over peak, 32% of the 2000 limit)
 *   squeeze  : 615 * 1.35 ≈ 830  → budget 830  (35% over peak, 42% of the 2000 limit)
 *   Statute  : 484 * 1.35 ≈ 653  → budget 655  (35% over peak, 33% of the 2000 limit)
 *   Sine Die : 437 * 1.35 ≈ 590  → budget 590  (35% over peak, 30% of the 2000 limit)
 *
 * A re-authored wave or card that thickens any window past its budget fails here,
 * named, before it ever reaches the density page. The floors (well below each peak,
 * far above zero) fail if a renamed enemy, a shifted `at` tick, or a re-ordered phase
 * leaves the probe scanning an empty window — the "wire with nothing on it" shape this
 * project keeps catching.
 */

import { describe, expect, test } from 'bun:test';

import './v4';
import { BossSystem } from './sim/boss';
import { BulletSystem } from './sim/bullet';
import { type Difficulty } from './sim/difficulty';
import { EnemySystem } from './sim/enemy';
import { Random } from './core/random';
import { getStage, StageRunner } from './content/stage';

const BOUNDS = { width: 480, height: 640, margin: 64 };
const TARGET = { x: 240, y: 520 };

/** The doctrine's readable ceiling; soup begins near 5000 (CLAUDE.md §Verification). */
const READABLE_LIMIT = 2000;

/** Mid composite: marshal walls + usher sweep + assessor dive. */
const MID_WINDOW = { lo: 760, hi: 1040 } as const;
/** Pre-boss squeeze: notary + marshal + two usher banks + grunts — the densest trash. */
const SQUEEZE_WINDOW = { lo: 1180, hi: 1600 } as const;

/** Past the last wave (`at: 1440`) and short of the boss hand-off, so the squeeze fills. */
const SCAN_TICKS = 1600;

/** Any fixed seed: trash fire is deterministic per tier, so the peak is seed-independent. */
const SEED = 0x4e2a17;

/**
 * Peak concurrent live enemy bullets over `[lo, hi)` on `tier` in stage-4's trash,
 * undisturbed. Bullets are stepped each tick — the point, and what separates this from
 * the cumulative-emission probe in `difficulty-honesty.test.ts` — so the count read is
 * the live population, and its window peak is the readable-limit quantity.
 */
function trashPeak(tier: Difficulty, lo: number, hi: number): number {
  const bullets = new BulletSystem({ bounds: BOUNDS, initial: 4000 });
  const enemies = new EnemySystem({ bounds: BOUNDS, bullets, difficulty: tier });
  const runner = new StageRunner(getStage('stage-4'), enemies);
  const rng = new Random(SEED);
  let peak = 0;
  for (let t = 0; t < SCAN_TICKS; t++) {
    runner.step(rng);
    enemies.step(TARGET.x, TARGET.y, rng);
    bullets.step(TARGET.x, TARGET.y, rng);
    if (t >= lo && t < hi && bullets.count > peak) peak = bullets.count;
  }
  return peak;
}

/**
 * Peak concurrent live bullets while the Regent's phase `drainPhases` card is active,
 * on `tier`. The card is reached by draining the preceding phases with one large hit
 * each (overkill discarded), then a 260-tick warm-up clears the drain's residual and
 * settles the card, so the peak is the card's own sustained population.
 */
function cardPeak(tier: Difficulty, drainPhases: number): number {
  const bullets = new BulletSystem({ bounds: BOUNDS, initial: 4000 });
  const boss = new BossSystem({ bounds: BOUNDS, bullets, difficulty: tier });
  const rng = new Random(SEED);
  boss.spawn('regent', 240, -40, rng);
  while (boss.boss?.entering) {
    boss.step(TARGET.x, TARGET.y, rng);
    bullets.step(TARGET.x, TARGET.y, rng);
  }
  for (let i = 0; i < drainPhases; i++) {
    boss.damage(100000);
    boss.step(TARGET.x, TARGET.y, rng);
    bullets.step(TARGET.x, TARGET.y, rng);
  }
  // Clear the drain's residual and let the card reach steady state before measuring.
  for (let t = 0; t < 260; t++) {
    boss.step(TARGET.x, TARGET.y, rng);
    bullets.step(TARGET.x, TARGET.y, rng);
  }
  let peak = 0;
  for (let t = 0; t < 600; t++) {
    boss.step(TARGET.x, TARGET.y, rng);
    bullets.step(TARGET.x, TARGET.y, rng);
    if (bullets.count > peak) peak = bullets.count;
  }
  return peak;
}

describe('stage-4 curtain stays readable', () => {
  const midLunatic = trashPeak('lunatic', MID_WINDOW.lo, MID_WINDOW.hi);
  const midNormal = trashPeak('normal', MID_WINDOW.lo, MID_WINDOW.hi);
  const squeezeLunatic = trashPeak('lunatic', SQUEEZE_WINDOW.lo, SQUEEZE_WINDOW.hi);
  const squeezeNormal = trashPeak('normal', SQUEEZE_WINDOW.lo, SQUEEZE_WINDOW.hi);
  const statuteLunatic = cardPeak('lunatic', 4);
  const statuteNormal = cardPeak('normal', 4);
  const sineDieLunatic = cardPeak('lunatic', 5);

  // Surfaced in the gate output: the measured peaks, so a reviewer sees the numbers
  // the budgets are set against rather than a bare pass.
  // eslint-disable-next-line no-console
  console.log(
    'stage-4 mid composite [760,1040) peak:',
    `normal=${midNormal}  lunatic=${midLunatic}  (budget 630, limit ${READABLE_LIMIT})`,
  );
  // eslint-disable-next-line no-console
  console.log(
    'stage-4 pre-boss squeeze [1180,1600) peak:',
    `normal=${squeezeNormal}  lunatic=${squeezeLunatic}  (budget 830, limit ${READABLE_LIMIT})`,
  );
  // eslint-disable-next-line no-console
  console.log(
    'regent Statute (card 4) peak:',
    `normal=${statuteNormal}  lunatic=${statuteLunatic}  (budget 655, limit ${READABLE_LIMIT})`,
  );
  // eslint-disable-next-line no-console
  console.log(
    'regent Sine Die (card 5, lunatic-only) peak:',
    `lunatic=${sineDieLunatic}  (budget 590, limit ${READABLE_LIMIT})`,
  );

  // CEILING: the mid composite — measured lunatic peak 465, budget 630, ~35%.
  test('the mid composite stays under its readability budget on lunatic', () => {
    const budget = 630;
    expect(budget).toBeLessThan(READABLE_LIMIT); // the budget itself honours the doctrine
    expect(
      `mid lunatic peak=${midLunatic} <= budget ${budget}: ${midLunatic <= budget}`,
    ).toBe(`mid lunatic peak=${midLunatic} <= budget ${budget}: true`);
  });

  // CEILING: the pre-boss squeeze — the densest trash curtain of the stage, measured
  // lunatic peak 615, budget 830, ~35%. This is the worst case for trash readability.
  test('the pre-boss squeeze stays under its readability budget on lunatic', () => {
    const budget = 830;
    expect(budget).toBeLessThan(READABLE_LIMIT);
    expect(
      `squeeze lunatic peak=${squeezeLunatic} <= budget ${budget}: ${squeezeLunatic <= budget}`,
    ).toBe(`squeeze lunatic peak=${squeezeLunatic} <= budget ${budget}: true`);
  });

  // CEILING: Statute — the densest general boss card (ring + spray + spiral at once),
  // measured lunatic peak 484, budget 655, ~35%.
  test('the Statute card stays under its readability budget on lunatic', () => {
    const budget = 655;
    expect(budget).toBeLessThan(READABLE_LIMIT);
    expect(
      `Statute lunatic peak=${statuteLunatic} <= budget ${budget}: ${statuteLunatic <= budget}`,
    ).toBe(`Statute lunatic peak=${statuteLunatic} <= budget ${budget}: true`);
  });

  // CEILING: Sine Die — the lunatic-only composed finale, measured peak 437, budget
  // 590, ~35%. Its whole design is maximum density with a lane; this proves the cap.
  test('the Sine Die finale card stays under its readability budget on lunatic', () => {
    const budget = 590;
    expect(budget).toBeLessThan(READABLE_LIMIT);
    expect(
      `Sine Die lunatic peak=${sineDieLunatic} <= budget ${budget}: ${sineDieLunatic <= budget}`,
    ).toBe(`Sine Die lunatic peak=${sineDieLunatic} <= budget ${budget}: true`);
  });

  // FLOOR: each window is genuinely exercised — a floor well below the measured peak
  // but far above zero. If a renamed enemy, a shifted `at` tick, or a re-ordered phase
  // leaves a window empty, its peak collapses toward zero and this fails, so the
  // ceilings above can never pass by measuring nothing.
  test('all four windows actually fire — the probe is not scanning an empty field', () => {
    const midFloor = 160; // 34% of the measured 465
    const squeezeFloor = 200; // 33% of the measured 615
    const statuteFloor = 160; // 33% of the measured 484
    const sineDieFloor = 150; // 34% of the measured 437
    expect(
      `mid=${midLunatic}>=${midFloor} squeeze=${squeezeLunatic}>=${squeezeFloor} ` +
        `statute=${statuteLunatic}>=${statuteFloor} sinedie=${sineDieLunatic}>=${sineDieFloor}: ` +
        `${midLunatic >= midFloor && squeezeLunatic >= squeezeFloor && statuteLunatic >= statuteFloor && sineDieLunatic >= sineDieFloor}`,
    ).toBe(
      `mid=${midLunatic}>=${midFloor} squeeze=${squeezeLunatic}>=${squeezeFloor} ` +
        `statute=${statuteLunatic}>=${statuteFloor} sinedie=${sineDieLunatic}>=${sineDieFloor}: true`,
    );
  });
});
