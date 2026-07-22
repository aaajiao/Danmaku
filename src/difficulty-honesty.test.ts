/**
 * Difficulty must be real, not a menu that changes nothing.
 *
 * A difficulty select that does not alter what is in the air is the failure
 * shape this project keeps finding — a wire with nothing on it. This file is the
 * guard the difficulty decisions call for: it drives the same seed at each tier
 * over two windows and measures the **spawned-bullet population**, asserting both
 * the stage's trash opening and the boss cards genuinely thicken as the tier
 * rises, and would fail the moment a tier block were dropped by a refactor.
 *
 * ## The two windows, both authored, both varying
 *
 * The decisions doc requires the built-in trash — not only the bosses — to carry
 * tier blocks, so the default START run varies from its very first wave rather
 * than staying flat until the boss. Both windows therefore rise:
 *
 * - **Stage-1's opening** — driven through the real `StageRunner` over the grunt
 *   columns and weaver arcs that open the stage, before any turret wall. `grunt`
 *   and `weaver` carry `difficulty` blocks (`sim/enemy.ts`), so the opening's
 *   population rises strictly with the tier. Drop either block and that tier
 *   collapses onto the Normal base, the strict rise breaks, and this goes red —
 *   which is the point of measuring the real stage rather than trusting the spec.
 * - **One boss card** — `sentinel`'s opening card, measured directly through the
 *   real `BossSystem` with each tier's difficulty. Same contract: easy < normal <
 *   hard < lunatic, and dropping the card's block collapses it.
 *
 * ## Counting is cumulative emission
 *
 * Bullets are never stepped here, so `BulletSystem.count` is the total emitted
 * over the window — the population the window spawned, which is the quantity the
 * decisions doc names. The windows are short enough that no count approaches the
 * pool ceiling, so nothing saturates and the ordering is real.
 */

import { describe, expect, test } from 'bun:test';

import './v4';
import { BulletSystem } from './sim/bullet';
import { BossSystem } from './sim/boss';
import { DIFFICULTIES, type Difficulty } from './sim/difficulty';
import { EnemySystem } from './sim/enemy';
import { Random } from './core/random';
import { getStage, StageRunner } from './content/stage';

const BOUNDS = { width: 480, height: 640, margin: 64 };
const TARGET = { x: 240, y: 520 };

/** Long enough to clear the 90-tick entry and sit inside the opening card. */
const BOSS_TICKS = 500;
/** Stage-1's opening movements, before any turret wall. */
const OPENING_TICKS = 600;
/**
 * Stage-3's opening — the clerk columns and the lone telegraph stele — before the
 * graze wave's summons arrive at 760. Long enough that every tier's clerk fan and
 * the stele's slab ring both fire, so the rise is measured on authored content and
 * not on an empty field.
 */
const STAGE3_OPENING_TICKS = 700;
/**
 * Stage-4's opening — the usher banks from both flanks and the first marshal
 * ring-wall — measured before the notary carrier arrives at 560. Long enough that
 * every tier's usher fan (2/3/4/5) and the marshal's slab ring (16/20/24/28) both
 * fire, so the rise is measured on authored content, not on an empty field.
 */
const STAGE4_OPENING_TICKS = 560;
/**
 * Chancellor's thesis card, `Sign "Binding Precedent"` — measured after draining
 * the opening `Appeal` phase. Well inside that card's ~1440-tick clock, so the
 * phase never times out mid-window and the count is the card's own emission.
 */
const CHANCELLOR_TICKS = 500;

/**
 * Bullets `sentinel`'s first card emits over the window on `tier`.
 *
 * The same seed at every tier, so the runs begin identically and diverge only
 * because the tier fires a different count — the honest comparison. The boss is
 * never damaged, so it stays on its opening card for the whole window.
 */
function bossCardPopulation(tier: Difficulty, ticks: number): number {
  const bullets = new BulletSystem({ bounds: BOUNDS, initial: 4000 });
  const boss = new BossSystem({ bounds: BOUNDS, bullets, difficulty: tier });
  const rng = new Random(0xda6ec1);
  boss.spawn('sentinel', 240, -40, rng);
  for (let t = 0; t < ticks; t++) boss.step(TARGET.x, TARGET.y, rng);
  return bullets.count;
}

/** Bullets stage-1's opening emits over the window on `tier`. */
function stageOpeningPopulation(tier: Difficulty, ticks: number): number {
  const bullets = new BulletSystem({ bounds: BOUNDS, initial: 4000 });
  const enemies = new EnemySystem({ bounds: BOUNDS, bullets, difficulty: tier });
  const runner = new StageRunner(getStage('stage-1'), enemies);
  const rng = new Random(0x5747a1);
  for (let t = 0; t < ticks; t++) {
    runner.step(rng);
    enemies.step(TARGET.x, TARGET.y, rng);
  }
  return bullets.count;
}

/** Bullets stage-3's opening emits over the window on `tier`. */
function stage3OpeningPopulation(tier: Difficulty, ticks: number): number {
  const bullets = new BulletSystem({ bounds: BOUNDS, initial: 4000 });
  const enemies = new EnemySystem({ bounds: BOUNDS, bullets, difficulty: tier });
  const runner = new StageRunner(getStage('stage-3'), enemies);
  const rng = new Random(0x3c1d05);
  for (let t = 0; t < ticks; t++) {
    runner.step(rng);
    enemies.step(TARGET.x, TARGET.y, rng);
  }
  return bullets.count;
}

/** Bullets stage-4's opening emits over the window on `tier`. */
function stage4OpeningPopulation(tier: Difficulty, ticks: number): number {
  const bullets = new BulletSystem({ bounds: BOUNDS, initial: 4000 });
  const enemies = new EnemySystem({ bounds: BOUNDS, bullets, difficulty: tier });
  const runner = new StageRunner(getStage('stage-4'), enemies);
  const rng = new Random(0x4e2a17);
  for (let t = 0; t < ticks; t++) {
    runner.step(rng);
    enemies.step(TARGET.x, TARGET.y, rng);
  }
  return bullets.count;
}

/**
 * Bullets `chancellor`'s thesis card emits over the window on `tier`.
 *
 * The card the honesty bar targets is the second phase, not the opener: `spiral`
 * laid over `aimed-fan`, the "weaving under aim" thesis. Reaching it headlessly
 * means draining the opening `Appeal` phase — one large hit, since overkill is
 * discarded — after the fly-in settles. Emission is counted from the tick the
 * thesis card is armed, so the opener's bullets are excluded.
 */
function chancellorCardPopulation(tier: Difficulty, ticks: number): number {
  const bullets = new BulletSystem({ bounds: BOUNDS, initial: 4000 });
  const boss = new BossSystem({ bounds: BOUNDS, bullets, difficulty: tier });
  const rng = new Random(0x3c1d05);
  boss.spawn('chancellor', 240, -40, rng);
  // The fly-in fires nothing; step until the boss settles onto its first card.
  while (boss.boss?.entering) boss.step(TARGET.x, TARGET.y, rng);
  // Drain 'Appeal' to arm the thesis card 'Binding Precedent' (phase 1).
  boss.damage(100000);
  const before = bullets.count;
  for (let t = 0; t < ticks; t++) boss.step(TARGET.x, TARGET.y, rng);
  return bullets.count - before;
}

function byTier(measure: (tier: Difficulty) => number): Record<Difficulty, number> {
  const out = {} as Record<Difficulty, number>;
  for (const tier of DIFFICULTIES) out[tier] = measure(tier);
  return out;
}

describe('difficulty is real, not a menu that changes nothing', () => {
  const card = byTier((tier) => bossCardPopulation(tier, BOSS_TICKS));
  const opening = byTier((tier) => stageOpeningPopulation(tier, OPENING_TICKS));
  const stage3Opening = byTier((tier) => stage3OpeningPopulation(tier, STAGE3_OPENING_TICKS));
  const stage4Opening = byTier((tier) => stage4OpeningPopulation(tier, STAGE4_OPENING_TICKS));
  const chancellorCard = byTier((tier) => chancellorCardPopulation(tier, CHANCELLOR_TICKS));

  // Surfaced in the gate output: the actual populations, so a reviewer sees the
  // numbers rather than a bare pass.
  // eslint-disable-next-line no-console
  console.log(
    'boss card (sentinel, opening):',
    DIFFICULTIES.map((t) => `${t}=${card[t]}`).join('  '),
  );
  // eslint-disable-next-line no-console
  console.log(
    'stage-1 opening (trash):      ',
    DIFFICULTIES.map((t) => `${t}=${opening[t]}`).join('  '),
  );
  // eslint-disable-next-line no-console
  console.log(
    'stage-3 opening (trash):      ',
    DIFFICULTIES.map((t) => `${t}=${stage3Opening[t]}`).join('  '),
  );
  // eslint-disable-next-line no-console
  console.log(
    'stage-4 opening (trash):      ',
    DIFFICULTIES.map((t) => `${t}=${stage4Opening[t]}`).join('  '),
  );
  // eslint-disable-next-line no-console
  console.log(
    'boss card (chancellor, thesis):',
    DIFFICULTIES.map((t) => `${t}=${chancellorCard[t]}`).join('  '),
  );

  test('a boss card fires strictly more bullets as the tier rises', () => {
    const line = DIFFICULTIES.map((t) => `${t}=${card[t]}`).join(' ');
    const rising =
      card.easy < card.normal && card.normal < card.hard && card.hard < card.lunatic;
    // Fails if any tier block is dropped: without it that tier collapses onto
    // the Normal base and the strict rise breaks.
    expect(`${line} | easy<normal<hard<lunatic: ${rising}`).toBe(
      `${line} | easy<normal<hard<lunatic: true`,
    );
  });

  test('every tier is a distinct population — none is a no-op', () => {
    expect(new Set(DIFFICULTIES.map((t) => card[t])).size).toBe(DIFFICULTIES.length);
    // And the card actually fired, or "distinct" would be meaningless.
    expect(card.easy).toBeGreaterThan(0);
  });

  test("the stage-1 opening's trash fires strictly more bullets as the tier rises", () => {
    const line = DIFFICULTIES.map((t) => `${t}=${opening[t]}`).join(' ');
    const rising =
      opening.easy < opening.normal &&
      opening.normal < opening.hard &&
      opening.hard < opening.lunatic;
    // The default START run varies from its opening wave, not only at the boss:
    // grunt and weaver carry tier blocks. Drop one and that tier collapses onto
    // the Normal base, breaking the rise.
    expect(`${line} | easy<normal<hard<lunatic: ${rising}`).toBe(
      `${line} | easy<normal<hard<lunatic: true`,
    );
  });

  test("the stage-3 opening's trash fires strictly more bullets as the tier rises", () => {
    // Stage-3 is the first natively-authored stage, and its opening carries tier
    // blocks the same way stage-1's does: `clerk` fans (2/3/4/5) and the telegraph
    // `stele`'s slab ring (14/18/22/24). Drop either and that tier collapses onto
    // the Normal base and the strict rise breaks.
    const line = DIFFICULTIES.map((t) => `${t}=${stage3Opening[t]}`).join(' ');
    const rising =
      stage3Opening.easy < stage3Opening.normal &&
      stage3Opening.normal < stage3Opening.hard &&
      stage3Opening.hard < stage3Opening.lunatic;
    expect(`${line} | easy<normal<hard<lunatic: ${rising}`).toBe(
      `${line} | easy<normal<hard<lunatic: true`,
    );
  });

  test("the stage-4 opening's trash fires strictly more bullets as the tier rises", () => {
    // Stage-4 is the last stage, and its opening carries tier blocks the same way
    // stage-1's and stage-3's do: `usher` aimed-fans (2/3/4/5) and the `marshal`'s
    // bulwark ring (16/20/24/28). Drop either and that tier collapses onto the
    // Normal base and the strict rise breaks.
    const line = DIFFICULTIES.map((t) => `${t}=${stage4Opening[t]}`).join(' ');
    const rising =
      stage4Opening.easy < stage4Opening.normal &&
      stage4Opening.normal < stage4Opening.hard &&
      stage4Opening.hard < stage4Opening.lunatic;
    expect(`${line} | easy<normal<hard<lunatic: ${rising}`).toBe(
      `${line} | easy<normal<hard<lunatic: true`,
    );
  });

  test("chancellor's thesis card fires strictly more bullets as the tier rises", () => {
    // 'Binding Precedent' is the escalation thesis as a card — `spiral` over
    // `aimed-fan`, weaving under aim. Its tier blocks rise (fan 3/5/6/7; spiral
    // arms 2/3/4/4 with lunatic's period 2 carrying the hard->lunatic step). The
    // card is reached by draining the opener, so this measures the thesis itself.
    const line = DIFFICULTIES.map((t) => `${t}=${chancellorCard[t]}`).join(' ');
    const rising =
      chancellorCard.easy < chancellorCard.normal &&
      chancellorCard.normal < chancellorCard.hard &&
      chancellorCard.hard < chancellorCard.lunatic;
    expect(`${line} | easy<normal<hard<lunatic: ${rising}`).toBe(
      `${line} | easy<normal<hard<lunatic: true`,
    );
  });

  test('over the window (opening + one card) totals rise easy < normal < lunatic', () => {
    const total = (t: Difficulty): number => opening[t] + card[t];
    const line = (['easy', 'normal', 'lunatic'] as const)
      .map((t) => `${t}=${total(t)}`)
      .join(' ');
    const rising = total('easy') < total('normal') && total('normal') < total('lunatic');
    expect(`${line} | easy<normal<lunatic: ${rising}`).toBe(
      `${line} | easy<normal<lunatic: true`,
    );
  });
});
