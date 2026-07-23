import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import '../v4/gameplay/patterns';

import { Button } from '../core/input';
import { fx, sim } from '../core/random';
import { defineBoss } from '../sim/boss';
import { defineBomb, getBombSpec } from '../sim/bomb';
import { effectNames, getEffectSpec } from '../sim/effects';
import { defineEnemy } from '../sim/enemy';
import { defineOptions } from '../sim/option';
import { defineStage } from '../content/stage';
import { TIER_BOOMS } from './deathfx';
import { EVENT_SOUNDS } from './cues';
import { deserialize, serialize, type Replay } from '../sim/replay';
import { type Difficulty } from '../sim/difficulty';
import {
  characterNames,
  defineCharacter,
  getCharacter,
  Run,
  type RunConfig,
  scaleScore,
} from './run';

const SEED = 0x5747a1;

/**
 * A local player loadout, and why one is needed now.
 *
 * The shipped roster used to reach this file for free: importing `./run`
 * registered scout/lance and pulled in their shots, options and bombs. That
 * content moved into the v4 campaign (`src/v4/content/campaign.json`), which a
 * `src/game` unit test may not import — so this file registers its own faithful
 * stand-in instead of depending on some other test file injecting the pack into
 * the shared process (the cross-file coupling this file's `OTHER_BOSS` note
 * condemns). The real roster's presence and behaviour are proved at the
 * composition root by `src/reachability.test.ts`, `src/balance.test.ts` and the
 * replay regression (`src/base-content.golden.test.ts`).
 */
const RUN_BOLT = { style: { sprite: 'glow.small', r: 0.7, g: 0.95, b: 1 }, radius: 4, motion: { r: 9, theta: 270 }, damage: 1, feedback: 'round' as const };
const RUN_SHOT_LEVELS = [
  { spec: RUN_BOLT, offsets: [{ x: -6, y: -10, angle: 270 }, { x: 6, y: -10, angle: 270 }], period: 5 },
  {
    spec: RUN_BOLT,
    offsets: [
      { x: -6, y: -10, angle: 270 }, { x: 6, y: -10, angle: 270 },
      { x: -10, y: -6, angle: 263 }, { x: 10, y: -6, angle: 277 },
    ],
    period: 5,
  },
];

const RUN_OPTIONS = 'test.run-options';
defineOptions(RUN_OPTIONS, {
  sprite: 'orb.medium',
  shot: { style: { sprite: 'orb.small', r: 0.75, g: 0.9, b: 1, additive: true }, radius: 4, motion: { r: 11, theta: 270 }, damage: 1 },
  period: 5,
  followSpeed: 1.6,
  levels: [
    [],
    [{ x: -26, y: 6, focusX: -11, focusY: -10, angle: 270 }, { x: 26, y: 6, focusX: 11, focusY: -10, angle: 270 }],
  ],
});

// Mirrors the shipped `spread` bomb — a 150-tick invuln window longer than the
// ship's own 90, which is what the invulnerability test below reads back.
const RUN_BOMB = 'test.run-bomb';
defineBomb(RUN_BOMB, { duration: 90, invulnTicks: 150, damagePerTick: 2, convertBullets: true, effect: 'death.big' });

/**
 * The endurance pilot: enough lives to survive the scripted pilot's mistakes.
 *
 * The script flies a fixed pattern, not the level, so a three-life ship is gone
 * around tick 670 — before the stage script ends and long before the boss. Every
 * test that needs a *whole* run needs a ship that can absorb that, and stock is
 * the honest lever: it changes how long the run lasts and nothing about how it is
 * simulated. Registered rather than passed inline, because going through the
 * registry is what proves the character seam is real.
 */
const ENDURANCE = 'test-endurance';
defineCharacter(ENDURANCE, {
  label: 'ENDURANCE',
  sprite: 'ship',
  blurb: 'test pilot, deep stock',
  options: RUN_OPTIONS,
  bomb: RUN_BOMB,
  player: {
    x: 240, y: 568, speed: 3.6, focusSpeed: 1.5, radius: 2.5,
    grazeRadius: 20, lives: 40, bombs: 3, invulnTicks: 90, shots: RUN_SHOT_LEVELS,
  },
});

/**
 * A second, three-life ship: the run-ending cases (a replay flown by the wrong
 * character, dying out, the bomb invuln window) need a ship that is *not* the
 * endurance one and a character name that differs from it.
 */
const ALT = 'test-alt';
defineCharacter(ALT, {
  label: 'ALT',
  sprite: 'ship',
  blurb: 'test pilot, three lives',
  options: RUN_OPTIONS,
  bomb: RUN_BOMB,
  player: {
    x: 240, y: 568, speed: 3.6, focusSpeed: 1.5, radius: 2.5,
    grazeRadius: 20, lives: 3, bombs: 3, invulnTicks: 90, shots: RUN_SHOT_LEVELS,
  },
});

/**
 * A second boss, for the tests that need one that is *not* the stage's own.
 *
 * Registered here rather than borrowed from content, and that is the point.
 * Two tests in this file reached for `warden`, which lives in
 * `content/stage-2.ts` — a module this file never imports. They passed under
 * `bun test`, where some other file had already registered it into the same
 * process, and failed the moment this file was run on its own. A test that
 * depends on another test file's side effects is not testing what it says.
 */
const OTHER_BOSS = 'test-other-boss';
defineBoss(OTHER_BOSS, {
  sprite: 'orb.large',
  radius: 12,
  phases: [{ name: 'test other', hp: 40, timeLimit: 120, patterns: [] }],
});

/**
 * A stage with no waves and no boss, for the no-boss clear path.
 *
 * stage-1 now ends in `sentinel`, whose pre-fight dialogue an idle pilot (one
 * that never presses Shot) cannot tap through — so a run left on stage-1 with
 * zero input stalls at the exchange rather than clearing, which is correct. This
 * stage has nothing to fight, so a run of it clears the moment its empty script
 * runs out, which is the path the no-boss test below is about.
 */
const NO_BOSS_STAGE = 'test-no-boss-stage';
defineStage(NO_BOSS_STAGE, { name: NO_BOSS_STAGE, outro: 0, waves: [] });

/**
 * A local stand-in for the built-in campaign, and why one is needed now.
 *
 * `config()` below used to default to `'stage-1'`, whose boss is `'sentinel'`,
 * both of which this file got for free: importing `../content/stage` and
 * `../sim/boss` registered them as a module side effect. That content moved into
 * the v4 campaign (`src/v4/content/campaign.json`), which a `src/game` unit test
 * may not import — so this file registers its own faithful stand-in instead of
 * depending on some other test file having injected the pack into the shared
 * process (the exact cross-file coupling this file's `OTHER_BOSS` note condemns).
 *
 * `MAIN_STAGE` and `MAIN_BOSS` mirror the shape and dynamics of stage-1 and
 * sentinel — firing enemies that drop power, a boss that flies in and fights
 * timed phases — closely enough that every "a real run does X" assertion below
 * (kills, graze, pickups, boss reached, entry invulnerability) holds against
 * them. The real campaign's own behaviour is proved at the composition root by
 * `src/base-content.golden.test.ts` and `src/reachability.test.ts`. The patterns
 * these fire (`aimed-fan`, `ring`, `spray`) reach this file transitively through
 * `content/stage` → `content/patterns`.
 */
const RUN_SHOT = { style: { sprite: 'orb.small', r: 1, g: 0.45, b: 0.75 }, radius: 3, motion: { r: 2.4, theta: 90 } };
const RUN_HEAVY = { style: { sprite: 'scale', r: 0.55, g: 0.85, b: 1, orientToHeading: true }, radius: 4, motion: { r: 1.8, theta: 90 } };

const MAIN_GRUNT = 'test-run-grunt';
defineEnemy(MAIN_GRUNT, {
  sprite: 'orb.large', hp: 12, radius: 11, motion: { r: 1.6, theta: 90 },
  patterns: [{ pattern: 'aimed-fan', options: { spec: RUN_SHOT, count: 3, spread: 24, period: 50 }, startAt: 30 }],
  spoils: [['power', 1]], scoreValue: 100, onHit: 'hit', onDeath: 'explosion',
});

const MAIN_TURRET = 'test-run-turret';
defineEnemy(MAIN_TURRET, {
  sprite: 'halo', hp: 60, radius: 18, width: 40, height: 40, motion: { r: 0.4, theta: 90 },
  patterns: [{ pattern: 'ring', options: { spec: RUN_HEAVY, count: 12, period: 70, rotation: 9 }, startAt: 20 }],
  despawnMargin: 96, spoils: [['power', 3]], scoreValue: 1000,
  hitMaterial: 'skeleton', onHit: 'hit', onDeath: 'death.big',
});

const MAIN_BOSS = 'test-run-boss';
defineBoss(MAIN_BOSS, {
  sprite: 'halo', radius: 20, width: 56, height: 56,
  hitMaterial: 'heart',
  entry: { x: 240, y: 140, ticks: 90 },
  onDeath: 'death.big',
  phases: [
    {
      name: 'Approach', hp: 410, timeLimit: 730, isSpell: false,
      patterns: [{ pattern: 'aimed-fan', options: { spec: RUN_HEAVY, count: 5, spread: 34, period: 48 } }],
    },
    {
      name: 'Vigil', hp: 810, timeLimit: 1440, isSpell: true, motion: { r: 0 },
      patterns: [{ pattern: 'ring', options: { spec: RUN_SHOT, count: 18, period: 42, rotation: 9 } }],
    },
  ],
});

const BREAK_BOSS = 'test-break-boss';
defineBoss(BREAK_BOSS, {
  sprite: 'halo', radius: 20, onDeath: 'death.big',
  phases: [
    { name: 'body', hp: 10, timeLimit: 0, isSpell: false, patterns: [] },
    { name: 'seal', hp: 10, timeLimit: 0, isSpell: true, patterns: [] },
    { name: 'last', hp: 10, timeLimit: 0, isSpell: true, patterns: [] },
  ],
});

const TIMEOUT_BREAK_BOSS = 'test-timeout-break-boss';
defineBoss(TIMEOUT_BREAK_BOSS, {
  sprite: 'halo', radius: 20,
  phases: [
    { name: 'clock seal', hp: 10, timeLimit: 1, isSpell: true, patterns: [] },
    { name: 'successor', hp: 10, timeLimit: 0, isSpell: false, patterns: [] },
  ],
});

const TIER_FINAL_BOSS = 'test-tier-final-boss';
defineBoss(TIER_FINAL_BOSS, {
  sprite: 'halo', radius: 20,
  phases: [
    { name: 'normal last', hp: 10, timeLimit: 0, isSpell: true, patterns: [] },
    {
      name: 'lunatic appendix', hp: 10, timeLimit: 0, isSpell: true,
      difficulties: ['lunatic'], patterns: [],
    },
  ],
});

const MAIN_STAGE = 'test-run-stage';
const RY = -24;
defineStage(MAIN_STAGE, {
  name: MAIN_STAGE, seed: 0x5747a1, outro: 180, boss: MAIN_BOSS,
  // The scene and track the run reports (the `scene`/`music` blocks below read
  // these off `config()`'s default stage), the same two the built-in stage-1
  // declared. They are plain strings the shell resolves — the sim never learns a
  // shader or a track exists — so a game-side unit test names them freely.
  background: 'expanse', music: 'vigil',
  waves: [
    { at: 0, enemy: MAIN_GRUNT, x: 120, y: RY, count: 5, interval: 20 },
    { at: 30, enemy: MAIN_GRUNT, x: 360, y: RY, count: 5, interval: 20 },
    { at: 200, enemy: MAIN_GRUNT, x: 150, y: RY, count: 5, interval: 0, stepX: 45, stepY: -18 },
    { at: 440, enemy: MAIN_GRUNT, x: 240, y: RY, count: 4, interval: 24 },
    { at: 760, enemy: MAIN_TURRET, x: 240, y: -60 },
    { at: 820, enemy: MAIN_GRUNT, x: 60, y: RY, count: 4, interval: 40 },
    { at: 840, enemy: MAIN_GRUNT, x: 420, y: RY, count: 4, interval: 40 },
    { at: 1160, enemy: MAIN_GRUNT, x: 90, y: RY, count: 6, interval: 0, stepX: 60, stepY: -20 },
    { at: 1320, enemy: MAIN_GRUNT, x: 300, y: RY, count: 8, interval: 14, stepX: -18 },
    { at: 1500, enemy: MAIN_TURRET, x: 140, y: -60 },
    { at: 1500, enemy: MAIN_TURRET, x: 340, y: -60 },
    { at: 1620, enemy: MAIN_GRUNT, x: 60, y: RY, count: 6, interval: 18, stepX: 72 },
  ],
});

/**
 * A scripted pilot: deterministic, busy, and not a straight line.
 *
 * Every branch is a function of the tick alone, so the same script drives a
 * live run and a verification run identically without either recording it.
 * It shoots almost always, weaves, focuses in bursts and bombs twice — a script
 * that only held Shot would leave graze, focus, bombs, options and pickups
 * untested and the replay would prove far less than it appears to.
 */
function script(tick: number): number {
  let buttons = 0;
  if (tick % 8 !== 0) buttons |= Button.Shot;
  if (tick % 240 < 60) buttons |= Button.Left;
  else if (tick % 240 < 120) buttons |= Button.Right;
  if (tick % 90 < 30) buttons |= Button.Up;
  else if (tick % 90 < 45) buttons |= Button.Down;
  if (tick % 150 < 40) buttons |= Button.Slow;
  if (tick === 300 || tick === 900) buttons |= Button.Bomb;
  return buttons;
}

/** Everything a divergence could hide in, flattened to a comparable string. */
function fingerprint(run: Run): string {
  const parts: (string | number)[] = [
    run.tickCount,
    run.outcome,
    run.player.x,
    run.player.y,
    run.player.score,
    run.player.graze,
    run.player.lives,
    run.player.bombs,
    run.player.power,
    run.player.invuln,
    run.player.deathCount,
    run.enemies.count,
    run.bullets.count,
    run.items.count,
    run.boss.active ? 1 : 0,
  ];

  // The bullet field itself, not just its size: a wrong bullet in the right
  // count is exactly the kind of drift the count would hide.
  for (const b of run.bullets.bullets) {
    parts.push(b.x, b.y, b.faction, b.vector.theta, b.vector.r);
  }
  for (const e of run.enemies.enemies) {
    parts.push(e.name, e.x, e.y, e.hp, e.age);
  }
  for (const i of run.items.items) {
    parts.push(i.name, i.x, i.y, i.age);
  }
  for (const o of run.options.options) {
    parts.push(o.x, o.y, o.angle, o.active ? 1 : 0);
  }

  const boss = run.boss.boss;
  if (boss !== undefined) {
    parts.push(boss.name, boss.x, boss.y, boss.hp, boss.phaseIndex, boss.phaseTicks);
  }

  return parts.join('|');
}

function play(run: Run, ticks: number, input: (tick: number) => number = script): void {
  for (let t = 0; t < ticks && !run.finished; t++) run.tick(input(t));
}

/**
 * Fingerprints sampled through the run, not just at the end.
 *
 * An endpoint comparison is a much weaker instrument than it looks, and this
 * content proves it: the *only* sim draws the whole stage makes are the `spray`
 * pattern's angle jitter and the scatter on an item burst. Both produce state
 * that is transient — a sprayed bullet leaves the field, a dropped item is
 * collected — so two runs on different seeds can be visibly different for a
 * hundred ticks and land on identical endpoints. A trace sees the difference
 * while it exists, and it also catches the harder case: a divergence that later
 * heals, which an endpoint check reports as a pass.
 */
function trace(run: Run, ticks: number, sample = 15): string {
  const frames: string[] = [];
  for (let t = 0; t < ticks && !run.finished; t++) {
    run.tick(script(t));
    if (t % sample === 0) frames.push(fingerprint(run));
  }
  return frames.join('\n');
}

function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return { seed: SEED, character: ENDURANCE, stage: MAIN_STAGE, ...overrides };
}

/* ------------------------------------------------------------------ */
/* Characters                                                          */
/* ------------------------------------------------------------------ */

describe('characters', () => {
  test('a registered character is enumerable, so SELECT can offer it', () => {
    // The shipped roster — scout/lance/hound/spire — is no longer registered by
    // importing `./run`; it lives in the bundled base pack this file may not
    // import (decisions-round2 §D). Its presence on SELECT is proved by
    // `src/reachability.test.ts` and the port gate. Here the registry mechanism
    // is under test against the local pilots, so it holds when this file runs
    // alone rather than under the full suite's cross-file registration.
    expect(characterNames()).toContain(ENDURANCE);
    expect(characterNames()).toContain(ALT);
  });

  test('a character carries an option set and a bomb that both exist', () => {
    for (const name of characterNames()) {
      const spec = getCharacter(name);
      expect(spec.options.length).toBeGreaterThan(0);
      expect(spec.bomb.length).toBeGreaterThan(0);
      // Construction resolves both through their registries and throws on a
      // typo, so this is the check that a character is actually flyable.
      expect(() => new Run(config({ character: name }))).not.toThrow();
    }
  });

  test('defining the same character twice throws', () => {
    defineCharacter('test-dupe', getCharacter(ENDURANCE));
    expect(() => defineCharacter('test-dupe', getCharacter(ENDURANCE))).toThrow(
      /already defined/,
    );
  });

  test('an unknown character throws rather than falling back', () => {
    expect(() => new Run(config({ character: 'nobody' }))).toThrow(/unknown character/);
  });
});

/* ------------------------------------------------------------------ */
/* Determinism                                                         */
/* ------------------------------------------------------------------ */

describe('determinism', () => {
  test('two runs on one seed trace identically for 1200 ticks', () => {
    expect(trace(new Run(config()), 1200)).toBe(trace(new Run(config()), 1200));
  });

  test('a different seed diverges — so the test above is not vacuous', () => {
    expect(trace(new Run(config()), 1200)).not.toBe(
      trace(new Run(config({ seed: SEED + 1 })), 1200),
    );
  });

  test('two runs interleaved tick-for-tick stay identical', () => {
    // The real proof that a run owns its generator. If either reached for the
    // global `sim` stream they would consume each other's draws, and this is
    // the only arrangement that catches it — sequential runs would pass.
    const a = new Run(config());
    const b = new Run(config());
    for (let t = 0; t < 900; t++) {
      a.tick(script(t));
      b.tick(script(t));
      if (t % 150 === 0) expect(fingerprint(a)).toBe(fingerprint(b));
    }
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  test('a run does not touch the global sim stream', () => {
    // Anything reaching for the default `rng` argument would move `sim`, and
    // every other module's determinism tests would then depend on whether a
    // game had been constructed first.
    const before = sim.getState();
    play(new Run(config()), 400);
    expect(sim.getState()).toEqual(before);
  });

  test('the run is not trivially empty', () => {
    const run = new Run(config());
    play(run, 1200);
    expect(run.player.score).toBeGreaterThan(0);
    expect(run.player.graze).toBeGreaterThan(0);
    expect(run.tickCount).toBe(1200);
  });
});

/* ------------------------------------------------------------------ */
/* Record then replay — the project's thesis                           */
/* ------------------------------------------------------------------ */

describe('record then replay', () => {
  test('a recorded run replays headlessly to an identical state', () => {
    const live = new Run(config());
    play(live, 1800);
    const recorded = live.finishRecording();

    // Round-tripped through JSON: a replay that only survives in memory is not
    // a replay, and `deserialize` is what a saved one comes back through.
    const replay = deserialize(serialize(recorded));

    const playback = new Run(config({ replay }));
    // Driven with *no* input at all. If any of this leaked live buttons the
    // ship would sit still and the fingerprints could not match.
    for (let t = 0; t < replay.length && !playback.finished; t++) playback.tick(0);

    expect(playback.tickCount).toBe(live.tickCount);
    expect(playback.outcome).toBe(live.outcome);
    expect(fingerprint(playback)).toBe(fingerprint(live));
  });

  test('the run replayed is not a trivial one', () => {
    const live = new Run(config());
    play(live, 1800);
    expect(live.player.score).toBeGreaterThan(1000);
    expect(live.player.graze).toBeGreaterThan(0);
    expect(live.finishRecording().inputs.length).toBeGreaterThan(50);
  });

  test('a playback run re-emits the replay it was given', () => {
    const live = new Run(config());
    play(live, 600);
    const replay = live.finishRecording();

    const playback = new Run(config({ replay }));
    for (let t = 0; t < replay.length; t++) playback.tick(0);

    const again = playback.finishRecording();
    expect(again.inputs).toEqual(replay.inputs);
    expect(again.length).toBe(replay.length);
  });

  test('replaying a full run to its natural end reproduces the outcome', () => {
    // Long enough to actually finish: the stage runs out, the boss arrives,
    // and the run ends on its own rather than on the loop bound.
    const live = new Run(config({ boss: MAIN_BOSS }));
    for (let t = 0; t < 12000 && !live.finished; t++) live.tick(script(t));
    expect(live.finished).toBe(true);

    const replay = live.finishRecording();
    const playback = new Run(config({ boss: MAIN_BOSS, replay }));
    while (!playback.finished && playback.tickCount < replay.length) playback.tick(0);

    expect(playback.outcome).toBe(live.outcome);
    expect(playback.tickCount).toBe(live.tickCount);
    expect(fingerprint(playback)).toBe(fingerprint(live));
  });

  test('a replay flown by the wrong character is refused, not silently wrong', () => {
    const live = new Run(config({ character: ENDURANCE }));
    play(live, 300);
    const replay = live.finishRecording();
    expect(() => new Run(config({ character: ALT, replay }))).toThrow(/character/);
  });

  test('a replay played on the wrong seed is refused', () => {
    const live = new Run(config());
    play(live, 120);
    const replay = live.finishRecording();
    expect(() => new Run(config({ seed: SEED + 7, replay }))).toThrow(/seed/);
  });

  test('a replay played against a different boss is refused', () => {
    // "Different" has to be named now. This test used to leave the second
    // config's boss unset and rely on that meaning *no boss*, which it no
    // longer does: stage-1 declares `sentinel` itself. That the assertion held
    // for the life of the project is the bug in miniature — the value the
    // shipped shell actually passed was `undefined`, and every guard written
    // against it agreed the run had no boss to fight.
    const live = new Run(config({ boss: MAIN_BOSS }));
    play(live, 300);
    const replay = live.finishRecording();
    expect(() => new Run(config({ boss: OTHER_BOSS, replay }))).toThrow(/boss/);
  });

  test('a run inherits its stage\'s boss when the config names none', () => {
    // Only stage-1, for the reason the `scene` block below spells out: this
    // file reaches `content/stage.ts` transitively and never imports the
    // content index, so stage-2 is genuinely unregistered here. Asserting the
    // stage-2 mapping passed anyway while the whole suite ran in one process
    // and failed the moment this file ran alone — a registry dependency on
    // another test file, which is the flake `content/index.ts` exists to stop.
    // That mapping is `reachability.test.ts`'s to prove; it imports both halves.
    expect(new Run(config()).bossName).toBe(MAIN_BOSS);
    expect(new Run(config({ boss: OTHER_BOSS })).bossName).toBe(OTHER_BOSS);
  });

  test('a replay recorded without meta is accepted', () => {
    // Fixtures outlive the fields added to them; a missing key is not a lie.
    const live = new Run(config());
    play(live, 120);
    const bare: Replay = { ...live.finishRecording() };
    delete bare.meta;
    expect(() => new Run(config({ replay: bare }))).not.toThrow();
  });

  test('the recording carries what it was flown with', () => {
    const live = new Run(config({ character: ALT, boss: MAIN_BOSS }));
    play(live, 240);
    const replay = live.finishRecording();
    expect(replay.meta?.['character']).toBe(ALT);
    expect(replay.meta?.['stage']).toBe(MAIN_STAGE);
    expect(replay.meta?.['boss']).toBe(MAIN_BOSS);
    expect(replay.seed).toBe(SEED);
  });

  test('the recording carries the data-pack identity it entered under', () => {
    const live = new Run(config({ packsData: 'example@abcdef012345' }));
    play(live, 240);
    expect(live.finishRecording().meta?.['packsData']).toBe('example@abcdef012345');
  });

  test('a built-in run records an empty pack identity', () => {
    // '' rather than absent: a built-in run is a positive claim that no data
    // pack shaped it, even in a build where data packs were loaded.
    const live = new Run(config());
    play(live, 120);
    expect(live.finishRecording().meta?.['packsData']).toBe('');
  });

  test('a replay recorded under different pack content is refused, not warned', () => {
    // The strict counterpart to the presentation `packs` warning: a data pack's
    // stages and enemies fire different bullets, so a replay under different
    // content is a different run and must be rejected. Mirrors the character,
    // seed and boss refusals above.
    const live = new Run(config({ packsData: 'example@abcdef012345' }));
    play(live, 300);
    const replay = live.finishRecording();
    expect(() => new Run(config({ packsData: 'crimson@012345abcdef', replay }))).toThrow(
      /packsData/,
    );
  });

  test('a replay replayed under the same pack content is accepted', () => {
    const live = new Run(config({ packsData: 'example@abcdef012345' }));
    play(live, 120);
    const replay = live.finishRecording();
    expect(() => new Run(config({ packsData: 'example@abcdef012345', replay }))).not.toThrow();
  });

  test('a run records the tier it was flown on, defaulting to normal', () => {
    const normal = new Run(config());
    play(normal, 120);
    expect(normal.finishRecording().meta?.['difficulty']).toBe('normal');

    const hard = new Run(config({ difficulty: 'hard' }));
    play(hard, 120);
    expect(hard.finishRecording().meta?.['difficulty']).toBe('hard');
  });

  test('a replay flown on the same tier is accepted', () => {
    const live = new Run(config({ difficulty: 'hard' }));
    play(live, 120);
    const replay = live.finishRecording();
    expect(() => new Run(config({ difficulty: 'hard', replay }))).not.toThrow();
  });

  test('a replay flown on a different tier is refused', () => {
    // Strict, like the character/seed/boss/packsData refusals above: a tier
    // changes what bullets are in the air, so a replay recorded on `hard` and
    // replayed on `normal` is a different run, not a mis-tag.
    const live = new Run(config({ difficulty: 'hard' }));
    play(live, 300);
    const replay = live.finishRecording();
    expect(() => new Run(config({ difficulty: 'normal', replay }))).toThrow(/difficulty/);
    // A config that names no tier is Normal, so it too mismatches a hard recording.
    expect(() => new Run(config({ replay }))).toThrow(/difficulty/);
  });

  test('the recording carries the content fingerprint it was flown under', () => {
    const live = new Run(config({ contentFingerprint: 'abc123def456' }));
    play(live, 240);
    expect(live.finishRecording().meta?.['content']).toBe('abc123def456');
  });

  test('a run with no fingerprint records no content key at all', () => {
    // Absent, not '': the key is a real hash or nothing. A harness that threaded
    // none leaves the meta without it, which is the legacy-warn path on playback —
    // this is exactly how the gate fixtures record, so they keep no content key.
    const live = new Run(config());
    play(live, 120);
    expect(live.finishRecording().meta?.['content']).toBeUndefined();
  });

  test('a replay replayed under the same content fingerprint is accepted', () => {
    const live = new Run(config({ contentFingerprint: 'abc123def456' }));
    play(live, 120);
    const replay = live.finishRecording();
    expect(() => new Run(config({ contentFingerprint: 'abc123def456', replay }))).not.toThrow();
  });

  test('a replay recorded under different content is refused', () => {
    // The strict half: the base content drifted, so the recorded run is not the one
    // this build produces. Refused like the packsData mismatch above, and for the
    // same reason — different content is a different simulation.
    const live = new Run(config({ contentFingerprint: 'abc123def456' }));
    play(live, 300);
    const replay = live.finishRecording();
    expect(() => new Run(config({ contentFingerprint: '000000000000', replay }))).toThrow(/content/);
  });

  test('a replay with no recorded fingerprint warns and plays', () => {
    // The legacy/opted-out half: a recording that pinned no fingerprint plays back
    // under a build that now threads one — warned, not refused. This is the gate
    // path, proven here so the warn is a real emission, not a silent accept.
    const live = new Run(config());
    play(live, 120);
    const replay = live.finishRecording();
    expect(replay.meta?.['content']).toBeUndefined();
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(() => new Run(config({ contentFingerprint: 'abc123def456', replay }))).not.toThrow();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

/* ------------------------------------------------------------------ */
/* Infinite lives — the assist                                         */
/* ------------------------------------------------------------------ */

describe('infinite lives (assist)', () => {
  test('a death spares the life and only the life; the run outlasts its stock', () => {
    const start = getCharacter(ALT).player.lives; // three

    // Control: the same three-life ship and script without the assist flies out
    // — lives reach zero, the run fails, and deathCount stops at the life count.
    const control = new Run(config({ character: ALT }));
    play(control, 2000);
    expect(control.outcome).toBe('failed');
    expect(control.player.alive).toBe(false);
    expect(control.player.lives).toBe(0);
    expect(control.player.deathCount).toBe(start);

    // Assist: identical seed and script, but the life is never spent, so the
    // out-of-lives outcome is unreachable and deathCount climbs past the stock.
    // The death otherwise proceeds in full — `alive` never flips, so power loss
    // and scatter still run, which is exactly why deaths keep costing.
    const assisted = new Run(config({ character: ALT, infiniteLives: true }));
    play(assisted, 2000);
    expect(assisted.outcome).not.toBe('failed');
    expect(assisted.player.alive).toBe(true);
    expect(assisted.player.lives).toBe(start); // constant — never decremented
    expect(assisted.player.deathCount).toBeGreaterThan(start);
  });

  test('an assisted run records the marker; an ordinary run records none', () => {
    const assisted = new Run(config({ infiniteLives: true }));
    play(assisted, 120);
    expect(assisted.finishRecording().meta?.['infiniteLives']).toBe('true');

    // Off is the default and writes nothing — absent means off, so every
    // pre-assist replay (and the frozen gate traces) stays byte-identical.
    const plain = new Run(config());
    play(plain, 120);
    expect(plain.finishRecording().meta?.['infiniteLives']).toBeUndefined();
  });

  test('a replay flown with the assist off is refused against an assisted recording', () => {
    // The difficulty key's exact shape: an assisted run is a different run —
    // deaths that would have ended it did not — so replaying it without the
    // assist is rejected, not silently played as a harder run.
    const live = new Run(config({ infiniteLives: true }));
    play(live, 300);
    const replay = live.finishRecording();
    expect(() => new Run(config({ infiniteLives: true, replay }))).not.toThrow();
    expect(() => new Run(config({ infiniteLives: false, replay }))).toThrow(/infiniteLives/);
    // A config that names no assist is off, so it too mismatches an assisted recording.
    expect(() => new Run(config({ replay }))).toThrow(/infiniteLives/);
  });

  test('a legacy replay without the marker plays as off', () => {
    // Absent is accepted (expectMeta), so a recording made before the assist
    // existed stays valid — replayed as a plain run, and accepted even under a
    // shell that now offers the assist.
    const live = new Run(config());
    play(live, 120);
    const replay = live.finishRecording();
    expect(replay.meta?.['infiniteLives']).toBeUndefined();
    expect(() => new Run(config({ replay }))).not.toThrow();
    expect(() => new Run(config({ infiniteLives: true, replay }))).not.toThrow();
  });
});

/* ------------------------------------------------------------------ */
/* Score multiplier — the tier enters the economy in one place         */
/* ------------------------------------------------------------------ */

describe('score multiplier', () => {
  test('each tier scales an award by its rational, integer-exact', () => {
    // 100 was chosen so every tier floors exactly and the rational reads plainly:
    // easy ×1/2, normal ×1, hard ×3/2, lunatic ×2.
    expect(scaleScore(100, 'easy')).toBe(50);
    expect(scaleScore(100, 'normal')).toBe(100);
    expect(scaleScore(100, 'hard')).toBe(150);
    expect(scaleScore(100, 'lunatic')).toBe(200);
  });

  test('normal is the identity — a direct proof the frozen gate traces rest on', () => {
    // Normal's rational is 1/1, so `#award(points)` adds exactly `points`. This is
    // why the two normal gate traces did NOT move; asserted here directly rather
    // than only through those traces, over a spread of award sizes up to a whole
    // clean run's score.
    for (const points of [0, 1, 7, 13, 20, 99, 100, 1000, 12_345, 547_000]) {
      expect(scaleScore(points, 'normal')).toBe(points);
    }
  });

  test('the floor is exact and never rounds up — no float accumulates', () => {
    expect(scaleScore(1, 'easy')).toBe(0); // floor(0.5)
    expect(scaleScore(101, 'easy')).toBe(50); // floor(50.5), not 51
    expect(scaleScore(1, 'hard')).toBe(1); // floor(1.5)
    expect(scaleScore(3, 'hard')).toBe(4); // floor(4.5)
    expect(scaleScore(1, 'lunatic')).toBe(2); // ×2/1 never floors
  });

  test('identical play scores easy < normal < hard < lunatic, lunatic exactly double', () => {
    // The test campaign authors no per-tier density, so one seed and one script
    // fire byte-identical bullets on every tier — the only thing that can differ
    // across these four runs is the multiplier, so the score IS the multiplier,
    // isolated. (The built-in campaign's real per-tier density is a separate axis,
    // guarded by difficulty-honesty.test.ts on bullet population, not score.)
    const scoreOn = (difficulty: Difficulty): number => {
      const run = new Run(config({ difficulty }));
      play(run, 2000);
      return run.player.score;
    };
    const easy = scoreOn('easy');
    const normal = scoreOn('normal');
    const hard = scoreOn('hard');
    const lunatic = scoreOn('lunatic');

    expect(normal).toBeGreaterThan(0);
    expect(easy).toBeLessThan(normal);
    expect(normal).toBeLessThan(hard);
    expect(hard).toBeLessThan(lunatic);
    // ×2/1 floors nothing, and every award is an integer, so the whole is exactly
    // twice the un-scaled total — the strongest single proof the multiplier is real.
    expect(lunatic).toBe(normal * 2);
  });
});

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

describe('lifecycle', () => {
  test('a fresh run is playing and has ticked nothing', () => {
    const run = new Run(config());
    expect(run.outcome).toBe('playing');
    expect(run.finished).toBe(false);
    expect(run.tickCount).toBe(0);
  });

  test('reset produces exactly the run a fresh construction would', () => {
    const reused = new Run(config());
    play(reused, 900);
    reused.reset();

    // Traced, not compared at the end: a counter that survived the reset would
    // shift the run for a while and could still land on the same endpoint.
    expect(trace(reused, 900)).toBe(trace(new Run(config()), 900));
  });

  test('reset returns a finished run to playing', () => {
    const run = new Run(config());
    for (let t = 0; t < 40000 && !run.finished; t++) run.tick(script(t));
    expect(run.finished).toBe(true);
    run.reset();
    expect(run.outcome).toBe('playing');
    expect(run.tickCount).toBe(0);
    expect(run.player.lives).toBeGreaterThan(0);
  });

  test('a finished run is frozen — ticking it changes nothing', () => {
    const run = new Run(config());
    for (let t = 0; t < 40000 && !run.finished; t++) run.tick(script(t));
    const settled = fingerprint(run);
    for (let t = 0; t < 100; t++) run.tick(Button.Shot);
    expect(fingerprint(run)).toBe(settled);
  });

  test('a run with no boss clears once the stage and the field are done', () => {
    // A genuinely boss-less stage. On stage-1 an idle pilot now stalls at
    // `sentinel`'s dialogue (a fresh Shot advances a line and idle never presses
    // one), so this points at an empty no-boss stage to keep testing the clear
    // path the comment describes: the script runs out and nothing is owed.
    const run = new Run(config({ stage: NO_BOSS_STAGE }));
    for (let t = 0; t < 40000 && !run.finished; t++) run.tick(0);
    expect(run.outcome).toBe('cleared');
  });

  test('dying out fails the run', () => {
    // The three-life ship, not the endurance one: this is the test that the
    // run *ends* when the stock does.
    const run = new Run(config({ character: ALT }));
    // Parked at the top of the field with no shot: everything that spawns
    // survives and everything it fires arrives.
    for (let t = 0; t < 40000 && !run.finished; t++) run.tick(Button.Up);
    expect(run.outcome).toBe('failed');
    expect(run.player.alive).toBe(false);
  });

  test('a boss run does not clear until the boss is gone', () => {
    const run = new Run(config({ boss: MAIN_BOSS }));
    let sawBoss = false;
    for (let t = 0; t < 40000 && !run.finished; t++) {
      run.tick(script(t));
      if (!run.boss.active) continue;
      sawBoss = true;
      // The run may still *fail* during the fight — the pilot is scripted, not
      // good. What it may never do is clear with the boss still on the field.
      expect(run.outcome).not.toBe('cleared');
    }
    expect(sawBoss).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Rules between the systems                                           */
/* ------------------------------------------------------------------ */

describe('rules', () => {
  test('kills pay score and drop power items', () => {
    const run = new Run(config());
    let killed = 0;
    let dropped = 0;
    for (let t = 0; t < 900; t++) {
      run.tick(script(t));
      for (const event of run.drainEvents()) {
        if (event.type === 'enemy-killed') killed++;
        if (event.type === 'pickup') dropped++;
      }
    }
    expect(killed).toBeGreaterThan(0);
    expect(dropped).toBeGreaterThan(0);
    expect(run.player.score).toBeGreaterThan(0);
  });

  test('power arrives in item-sized steps, not whole tiers per kill', () => {
    // A `power` spoils entry is a count of items. Read as a power fraction it
    // would put the ship on its top tier within the first wave, which is what
    // the pre-item game did.
    const run = new Run(config());
    play(run, 240);
    expect(run.player.power).toBeLessThan(1);
  });

  test('a fired volley reports the integer power tier that produced it', () => {
    const run = new Run(config({ stage: NO_BOSS_STAGE }));
    run.player.power = 1;
    run.tick(Button.Shot);

    const shot = run.drainEvents().find((event) => event.type === 'shot');
    expect(shot?.tier).toBe(1);
  });

  test('a power pickup reports a tier only when that same pickup crosses one', () => {
    const collectAt = (power: number) => {
      const run = new Run(config({ stage: NO_BOSS_STAGE }));
      run.player.power = power;
      run.items.spawn('power', run.player.x, run.player.y);
      run.tick(0);
      return run.drainEvents().find((event) => event.type === 'pickup');
    };

    expect(collectAt(0.94)?.tier).toBeUndefined();
    expect(collectAt(0.95)?.tier).toBe(1);
  });

  test('a bomb spends a stock, clears the field and pays for it', () => {
    const run = new Run(config());
    play(run, 600, (t) => (t % 8 !== 0 ? Button.Shot : 0));

    const before = { bombs: run.player.bombs, score: run.player.score };
    const bulletsBefore = run.bullets.count;
    run.tick(Button.Bomb);
    expect(run.player.bombs).toBe(before.bombs - 1);

    // The blast runs for its whole duration; a tick or two in, the field is
    // measurably emptier and the erased fire has paid.
    for (let t = 0; t < 5; t++) run.tick(0);
    expect(run.bullets.count).toBeLessThan(bulletsBefore);
    expect(run.player.score).toBeGreaterThan(before.score);
  });

  test('a bomb refused while one is burning refunds the stock', () => {
    const run = new Run(config());
    play(run, 300);
    const stock = run.player.bombs;

    run.tick(Button.Bomb);
    expect(run.player.bombs).toBe(stock - 1);
    // Second press while the first is still burning. The player already paid
    // in `Player.#tryBomb`; without the refund the stock vanishes for nothing.
    run.tick(0);
    run.tick(Button.Bomb);
    expect(run.player.bombs).toBe(stock - 1);
  });

  test('graze scores without killing', () => {
    const run = new Run(config());
    play(run, 900);
    expect(run.player.graze).toBeGreaterThan(0);
    expect(run.player.alive).toBe(true);
  });

  test('player shot despawns on impact rather than piercing', () => {
    const run = new Run(config());
    play(run, 600);
    // Nothing may be left in the field marked dead: `despawn` is the only
    // removal path, and `alive = false` from outside removes nothing at all
    // (CLAUDE.md rule 8).
    for (const b of run.bullets.bullets) expect(b.alive).toBe(true);
  });

  test('a boss is invulnerable while it flies in', () => {
    const run = new Run(config({ boss: MAIN_BOSS }));
    for (let t = 0; t < 40000; t++) {
      run.tick(script(t));
      const boss = run.boss.boss;
      if (boss === undefined) continue;
      if (!boss.entering) break;
      expect(boss.hp).toBe(boss.spec.phases[0]?.hp ?? 0);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Boss hit feedback                                                   */
/* ------------------------------------------------------------------ */

describe('boss hit feedback', () => {
  // Driving runs advances the global `fx` stream (a run's `EffectSystem` draws
  // cosmetics from it, rule 2), and the audio SFX buffers are synthesized from
  // that same stream — so these long boss fights must leave `fx` (and `sim`)
  // exactly as they found them, or another file's synthesis drifts. Same idiom
  // as `base-content.golden.test.ts` and `core/random.test.ts`.
  let fxEntry: ReturnType<typeof fx.getState>;
  let simEntry: ReturnType<typeof sim.getState>;
  beforeAll(() => {
    fxEntry = fx.getState();
    simEntry = sim.getState();
  });
  afterAll(() => {
    fx.setState(fxEntry);
    sim.setState(simEntry);
  });

  /** Fire always; steer under the boss once it settles, else onto the nearest enemy so the stage clears and the boss releases. */
  function pursue(run: Run): number {
    let mask = Button.Shot;
    const boss = run.boss.boss;
    const target = boss?.alive && !boss.entering ? boss.x : run.enemies.enemies[0]?.x;
    if (target !== undefined) {
      if (run.player.x < target - 3) mask |= Button.Right;
      else if (run.player.x > target + 3) mask |= Button.Left;
    }
    return mask;
  }

  test('weapon feedback names used by the boss path are registered', () => {
    const source = readFileSync(new URL('./run.ts', import.meta.url), 'utf8');
    for (const name of source.match(/impact\.(?:needle|round|tracking|beam|scatter(?:\.pause)?)/g) ?? []) {
      expect(effectNames()).toContain(name);
      expect(() => getEffectSpec(name)).not.toThrow();
    }
  });

  test('a shot landing on a boss records a local response and throws a spark', () => {
    const sparkSprite = getEffectSpec('impact.round').sprite;
    const run = new Run(config({ boss: MAIN_BOSS }));

    let responded = false;
    let sparked = false;
    let fought = false;
    for (let t = 0; t < 40000 && !(responded && sparked); t++) {
      run.tick(pursue(run));
      const boss = run.boss.boss;
      if (boss === undefined || boss.entering) continue;
      fought = true;
      if (boss.impact !== undefined) responded = true;
      // While the boss is up the field is otherwise clear, so a `spark`-sprite
      // particle is the boss-hit spark and not a trash hit.
      for (const p of run.effects.particles) if (p.spec.sprite === sparkSprite) sparked = true;
    }
    expect(fought).toBe(true);
    expect(responded).toBe(true);
    expect(sparked).toBe(true);
  });

  test('a non-clearing boss hit adds its authored material at the real contact point', () => {
    const run = new Run(config({ boss: MAIN_BOSS }));
    let boss;
    for (let t = 0; t < 40000; t++) {
      run.tick(pursue(run)); boss = run.boss.boss;
      if (boss !== undefined && !boss.entering) break;
    }
    expect(boss).toBeDefined();
    run.bullets.clear(); run.effects.clear();
    run.bullets.spawn(boss!.x + 5, boss!.y, { style: { sprite: 'glow.small' }, radius: 4, motion: { r: 0, theta: 270 }, damage: 1, feedback: 'round' }, 'player');
    run.tick(0);
    const heart = run.effects.particles.find((p) => p.spec.sprite === 'material.heart');
    expect(heart).toBeDefined();
    expect(heart!.x).toBe(boss!.x + 5);
    expect(heart!.y).toBe(boss!.y);
  });

  test('an enemy emits its material while alive, but a killing hit yields to death FX', () => {
    const run = new Run(config({ stage: NO_BOSS_STAGE }));
    const enemy = run.enemies.spawn(MAIN_TURRET, 240, 300);
    expect(enemy).toBeDefined();

    const shot = (damage: number): void => {
      run.bullets.spawn(
        enemy!.x,
        enemy!.y,
        {
          style: { sprite: 'glow.small' }, radius: 4,
          motion: { r: 0, theta: 270 }, damage, feedback: 'round',
        },
        'player',
      );
      run.tick(0);
    };

    shot(1);
    expect(run.effects.particles.some((p) => p.spec.sprite === 'material.skeleton')).toBe(true);

    run.effects.clear();
    shot(100);
    expect(enemy!.alive).toBe(false);
    expect(run.effects.particles.some((p) => p.spec.sprite === 'material.skeleton')).toBe(false);
  });

  test('a legacy shot without a feedback family retains the boss hit sparkle', () => {
    const run = new Run(config({ boss: MAIN_BOSS }));
    let boss;
    for (let t = 0; t < 40000; t++) {
      run.tick(pursue(run));
      boss = run.boss.boss;
      if (boss !== undefined && !boss.entering) break;
    }
    expect(boss).toBeDefined();
    run.bullets.clear();
    run.effects.clear();
    run.bullets.spawn(
      boss!.x,
      boss!.y,
      { style: { sprite: 'glow.small' }, radius: 4, motion: { r: 0, theta: 270 }, damage: 1 },
      'player',
    );
    run.tick(0);
    expect(run.effects.particles.some((p) => p.spec.sprite === getEffectSpec('hit').sprite)).toBe(true);
  });

  test('a held beam throttles contact sparks locally without throttling damage ticks', () => {
    const run = new Run(config({ boss: MAIN_BOSS }));
    let boss;
    for (let t = 0; t < 40000; t++) {
      run.tick(pursue(run));
      boss = run.boss.boss;
      if (boss !== undefined && !boss.entering) break;
    }
    expect(boss).toBeDefined();
    run.bullets.clear();
    run.effects.clear();
    run.drainEvents();
    const hp = boss!.hp;
    run.bullets.spawn(
      boss!.x,
      boss!.y,
      {
        style: { sprite: 'beam.cyan' }, radius: 3, motion: { r: 0, theta: 270 }, damage: 1,
        laser: { length: 48 }, pierce: true, feedback: 'beam',
      },
      'player',
    );
    run.tick(0);
    const firstSparkCount = run.effects.particles.filter((p) => p.spec.sprite === getEffectSpec('impact.beam').sprite).length;
    run.tick(0);
    const secondSparkCount = run.effects.particles.filter((p) => p.spec.sprite === getEffectSpec('impact.beam').sprite).length;
    expect(firstSparkCount).toBe(2);
    expect(secondSparkCount).toBeLessThanOrEqual(firstSparkCount);
    expect(boss!.hp).toBe(hp - 2);
    expect(run.drainEvents().filter((event) => event.type === 'boss-hit')).toHaveLength(1);
    const hearts = run.effects.particles.filter((p) => p.spec.sprite === 'material.heart');
    expect(hearts).toHaveLength(1);
  });

  test('scatter is heavy by semantic family even at one damage', () => {
    const run = new Run(config({ boss: MAIN_BOSS }));
    let boss;
    for (let t = 0; t < 40000; t++) {
      run.tick(pursue(run)); boss = run.boss.boss;
      if (boss !== undefined && !boss.entering) break;
    }
    expect(boss).toBeDefined();
    run.bullets.clear();
    run.bullets.spawn(boss!.x, boss!.y, {
      style: { sprite: 'glow.small' }, radius: 4, motion: { r: 0, theta: 270 },
      damage: 1, feedback: 'scatter',
    }, 'player');
    run.tick(0);
    expect(boss!.impact?.kind).toBe('heavy');
  });

  test('the same beam gate covers an enemy legacy spark and its material layer', () => {
    const run = new Run(config({ stage: NO_BOSS_STAGE }));
    const enemy = run.enemies.spawn(MAIN_TURRET, 240, 300)!;
    const hp = enemy.hp;
    run.bullets.spawn(
      enemy.x,
      enemy.y + 40,
      {
        style: { sprite: 'beam.cyan' }, radius: 3,
        motion: { r: 0, theta: 270 }, damage: 1,
        laser: { length: 80 }, pierce: true, feedback: 'beam',
      },
      'player',
    );

    run.tick(0);
    const generic = getEffectSpec('hit');
    const firstGeneric = run.effects.particles.filter((p) => p.spec === generic).length;
    const firstMaterial = run.effects.particles.filter(
      (p) => p.spec.sprite === 'material.skeleton',
    ).length;
    run.tick(0);

    expect(run.effects.particles.filter((p) => p.spec === generic)).toHaveLength(firstGeneric);
    expect(run.effects.particles.filter((p) => p.spec.sprite === 'material.skeleton'))
      .toHaveLength(firstMaterial);
    expect(enemy.hp).toBe(hp - 2);
  });

  test('no impact response while the boss is invulnerable during entry', () => {
    const run = new Run(config({ boss: MAIN_BOSS }));
    let sawEntry = false;
    for (let t = 0; t < 40000; t++) {
      run.tick(script(t));
      const boss = run.boss.boss;
      if (boss === undefined) continue;
      if (!boss.entering) break;
      sawEntry = true;
      expect(boss.impact).toBeUndefined();
    }
    expect(sawEntry).toBe(true);
  });
});

describe('boss Break and final death are separate', () => {
  test('only the dedicated Break and accepted boss-hit events own their sounds', () => {
    expect(EVENT_SOUNDS['boss-break']).toBe('break');
    expect(EVENT_SOUNDS['boss-cleared']).toBeUndefined();
    expect(EVENT_SOUNDS['boss-hit']).toBe('hit');
  });

  test('only a non-final spell with a successor emits Break', () => {
    const run = new Run(config({ stage: NO_BOSS_STAGE, boss: BREAK_BOSS }));
    run.boss.spawn(BREAK_BOSS, 240, 140, sim);
    run.tick(0); run.drainEvents();

    run.boss.damage(10); run.tick(0);
    expect(run.drainEvents().some((event) => event.type === 'boss-break')).toBe(false);

    run.boss.damage(10); run.tick(0);
    const middle = run.drainEvents();
    expect(middle.filter((event) => event.type === 'boss-break')).toHaveLength(1);

    run.effects.clear();
    const emit = spyOn(run.effects, 'emit');
    run.boss.damage(10); run.tick(0);
    const finalEvents = run.drainEvents();
    expect(finalEvents.some((event) => event.type === 'boss-break')).toBe(false);
    expect(finalEvents.map((event) => event.type)).toContain('boss-defeated');
    const names = emit.mock.calls.map((call) => call[0]);
    expect(names).toEqual(['death.big', ...TIER_BOOMS.boss]);
    expect(TIER_BOOMS.boss).toEqual(['boom.boss.back', 'burst.big', 'boom.boss.top', 'debris']);
    emit.mockRestore();
  });

  test('a timed-out non-final spell is also a valid Break', () => {
    const run = new Run(config({ stage: NO_BOSS_STAGE, boss: TIMEOUT_BREAK_BOSS }));
    run.boss.spawn(TIMEOUT_BREAK_BOSS, 240, 140, sim);
    run.tick(0);
    const events = run.drainEvents();
    expect(events.filter((event) => event.type === 'boss-break')).toHaveLength(1);
    expect(events.some((event) => event.type === 'boss-cleared')).toBe(true);
  });

  test('a raw later card gated off this difficulty does not make the live final spell Break', () => {
    const run = new Run(config({ stage: NO_BOSS_STAGE, boss: TIER_FINAL_BOSS }));
    run.boss.spawn(TIER_FINAL_BOSS, 240, 140, sim);
    run.tick(0); run.drainEvents();

    run.boss.damage(10); run.tick(0);
    const events = run.drainEvents();
    expect(events.some((event) => event.type === 'boss-break')).toBe(false);
    expect(events.some((event) => event.type === 'boss-defeated')).toBe(true);
  });

  test('a final defeat in the same drain suppresses every earlier Break candidate', () => {
    const run = new Run(config({ stage: NO_BOSS_STAGE, boss: BREAK_BOSS }));
    run.boss.spawn(BREAK_BOSS, 240, 140, sim);
    run.tick(0); run.drainEvents();

    run.boss.damage(10);
    run.tick(0); run.drainEvents();
    run.effects.clear();

    // Queue the middle spell clear and the final clear before Run drains either.
    run.boss.damage(10);
    run.boss.damage(10);
    run.tick(0);
    const events = run.drainEvents();
    expect(events.some((event) => event.type === 'boss-break')).toBe(false);
    expect(events.some((event) => event.type === 'boss-defeated')).toBe(true);
    expect(run.effects.particles.some((particle) => particle.spec.sprite === 'boss.break'))
      .toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Source guards                                                       */
/* ------------------------------------------------------------------ */

describe('source', () => {
  const files = ['state.ts', 'run.ts', 'states.ts'].map((name) => ({
    name,
    source: readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'),
  }));

  test('src/game imports no renderer', () => {
    // The states describe what to draw, never how. A three.js import here would
    // make every one of them unrunnable in this test file.
    for (const { name, source } of files) {
      expect(`${name}: ${/from\s+'three'|from\s+"three"|\.\.\/render\//.test(source)}`).toBe(
        `${name}: false`,
      );
    }
  });

  test('src/game calls no approximated Math function', () => {
    // `src/determinism.test.ts` scans this directory too — `game` is in its
    // `SIMULATION_TREES`. It was not when this test was written, which is why
    // this exists; it is kept because a scan living next to the code it guards
    // fails in the file whose author caused it, and because narrowing that list
    // must break something local rather than silently reduce coverage.
    //
    // The hazard is rule 3's: anything that can move the simulation must not
    // call an approximated `Math`, and `Run` moves all of it.
    const banned = /Math\.(sin|cos|tan|asin|acos|atan|atan2|hypot|exp|log|log2|log10|pow|cbrt)\b/;
    for (const { name, source } of files) {
      expect(`${name}: ${banned.test(source)}`).toBe(`${name}: false`);
    }
  });

  test('src/game reads no wall clock', () => {
    // A run that consulted a clock would tick differently on a slow machine
    // and every replay would rot silently — nothing else in the suite could
    // see it, because the sim would still be internally consistent.
    const banned = /Date\.now|performance\.now|requestAnimationFrame|setTimeout|setInterval/;
    for (const { name, source } of files) {
      expect(`${name}: ${banned.test(source)}`).toBe(`${name}: false`);
    }
  });

  test('src/game never calls Math.random', () => {
    for (const { name, source } of files) {
      expect(`${name}: ${/Math\.random/.test(source)}`).toBe(`${name}: false`);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

/**
 * `Run.scene` is the one thing the presentation layer reads as *state* rather
 * than draining as an event, so it is the one thing that can be wrong without
 * any event going missing. The browser cannot check the interesting half: the
 * boss override only happens some three thousand ticks into a stage, which is
 * why it is tested here instead of by eye.
 */
describe('scene', () => {
  const SCENE_BOSS = 'test-scene-boss';
  const PLAIN_BOSS = 'test-plain-boss';

  const card = (background?: string) => ({
    name: 'test card',
    hp: 50,
    timeLimit: 600,
    patterns: [],
    ...(background === undefined ? {} : { background }),
  });

  defineBoss(SCENE_BOSS, {
    sprite: 'orb.large',
    radius: 12,
    phases: [card('test-scene-card'), card()],
  });

  defineBoss(PLAIN_BOSS, {
    sprite: 'orb.large',
    radius: 12,
    phases: [card()],
  });

  test('a run reports the scene its stage declares', () => {
    // Only stage-1 here: this file reaches `content/stage.ts` transitively
    // through `sim/enemy` and never imports the content index, so stage-2 is
    // genuinely unregistered in this process. Asserting both mappings is
    // `v4/backgrounds/index.test.ts`'s job — it imports both halves, which
    // is the whole reason it exists.
    expect(new Run(config()).scene).toBe('expanse');
  });

  test('an active boss phase overrides the stage scene', () => {
    const run = new Run(config());
    run.boss.spawn(SCENE_BOSS, 240, 120, sim);

    expect(run.scene).toBe('test-scene-card');
  });

  test('a phase declaring no scene falls back to the stage, rather than to nothing', () => {
    // The failure this catches is a boss whose second card silently blacks out
    // the level, which looks like a rendering bug and is a data one.
    const run = new Run(config());
    run.boss.spawn(PLAIN_BOSS, 240, 120, sim);

    expect(run.scene).toBe('expanse');
  });

  test('the override ends with the boss, not with the phase index', () => {
    const run = new Run(config());
    const boss = run.boss.spawn(SCENE_BOSS, 240, 120, sim);
    expect(run.scene).toBe('test-scene-card');

    // Past the last card. The `phase` getter throws here, which is exactly why
    // `scene` indexes `spec.phases` directly — asking what to draw must never
    // be the thing that throws.
    boss!.phaseIndex = 99;
    expect(() => run.scene).not.toThrow();
    expect(run.scene).toBe('expanse');
  });
});

/* ------------------------------------------------------------------ */
/* Music                                                               */
/* ------------------------------------------------------------------ */

/**
 * `Run.music` is `Run.scene`'s twin — declared state the shell reconciles, not a
 * drained event — with one deliberate difference: it is boss-level, so a boss
 * theme is a property of the fight, not of a spell card. Tested here for the
 * same reason `scene` is: the boss override only happens thousands of ticks into
 * a stage, which is exactly the half a browser cannot check by eye.
 */
describe('music', () => {
  const MUSIC_BOSS = 'test-music-boss';
  const SILENT_BOSS = 'test-silent-boss';

  const phase = () => ({ name: 'test card', hp: 50, timeLimit: 600, patterns: [] });

  // Declares its own theme.
  defineBoss(MUSIC_BOSS, {
    sprite: 'orb.large',
    radius: 12,
    music: 'test-boss-theme',
    phases: [phase(), phase()],
  });

  // Declares none, to prove the fall-back to the stage's track.
  defineBoss(SILENT_BOSS, {
    sprite: 'orb.large',
    radius: 12,
    phases: [phase()],
  });

  test('a run reports the track its stage declares', () => {
    // stage-1 names `vigil` (see `content/stage.ts`). Only stage-1 is registered
    // in this process, for the reason the scene block above spells out.
    expect(new Run(config()).music).toBe('vigil');
  });

  test('an active boss with its own theme overrides the stage track', () => {
    const run = new Run(config());
    run.boss.spawn(MUSIC_BOSS, 240, 120, sim);

    expect(run.music).toBe('test-boss-theme');
  });

  test('a boss declaring no theme leaves the stage track playing', () => {
    // The failure this catches is a boss silently killing the level's music,
    // which sounds like an audio bug and is a data one.
    const run = new Run(config());
    run.boss.spawn(SILENT_BOSS, 240, 120, sim);

    expect(run.music).toBe('vigil');
  });

  test('music is boss-level: the phase index does not change the track', () => {
    // Unlike `scene`, which indexes `phases`, `music` reads `boss.spec.music`, so
    // advancing the card cannot change or throw the track.
    const run = new Run(config());
    const boss = run.boss.spawn(MUSIC_BOSS, 240, 120, sim);
    expect(run.music).toBe('test-boss-theme');

    boss!.phaseIndex = 99;
    expect(() => run.music).not.toThrow();
    expect(run.music).toBe('test-boss-theme');
  });
});

/**
 * What a boss encounter is worth.
 *
 * Both of these were inert in the shipped game and both inverted the incentive
 * they exist to create: a bomb cost a stock and the card, and returned no
 * damage; a card that timed out paid exactly what a card you killed paid. Put
 * together, the dominant strategy against a boss was to stop playing — measured
 * on the magistrate, a pacifist outscored a shooter 1,000,740 to 1,000,600.
 */
describe('a boss encounter pays for damage', () => {
  const BONUS = 100_000;
  const PAYOUT_BOSS = 'test-payout-boss';

  defineBoss(PAYOUT_BOSS, {
    sprite: 'orb.large',
    radius: 12,
    // One card, small enough to kill inside its clock and short enough to time
    // out inside a test.
    phases: [{ name: 'test payout', hp: 40, timeLimit: 120, patterns: [], bonus: BONUS }],
  });

  /** Run the card to its end, either by shooting it or by waiting it out. */
  const fightCard = (shoot: boolean): number => {
    const run = new Run(config({ boss: PAYOUT_BOSS }));
    run.boss.spawn(PAYOUT_BOSS, run.player.x, run.player.y - 90, sim);

    let paid = 0;
    for (let t = 0; t < 600; t++) {
      // Untouchable, so the card stays `clean` and the bonus is actually owed.
      // Without this the test would compare two zeroes and pass on anything.
      run.player.invuln = 999;
      const before = run.player.score;
      run.tick(shoot ? Button.Shot : 0);
      const events = run.drainEvents();
      if (events.some((e) => e.type === 'boss-cleared')) {
        paid = run.player.score - before;
        break;
      }
    }
    return paid;
  };

  test('killing a card pays its full bonus', () => {
    expect(fightCard(true)).toBe(BONUS);
  });

  test('outlasting a card pays a fraction of it, never the same', () => {
    const timedOut = fightCard(false);
    expect(timedOut).toBeGreaterThan(0);
    expect(timedOut).toBeLessThan(BONUS);
    // A quarter. Stated exactly, because "less than" would still pass at 99%,
    // and 99% would leave not shooting the better play once the risk of dying
    // to the pattern is priced in.
    expect(timedOut).toBe(BONUS / 4);
  });

  test('a bomb damages the boss', () => {
    // `BombSystem.step` walks the `EnemySystem` and the boss is not in it, so
    // this measured 650 -> 650 for both bombs against both bosses.
    const run = new Run(config({ boss: PAYOUT_BOSS }));
    run.boss.spawn(PAYOUT_BOSS, run.player.x, run.player.y - 20, sim);
    for (let t = 0; t < 40 && run.boss.boss?.entering; t++) run.tick(0);

    const boss = run.boss.boss;
    expect(boss).toBeDefined();
    const before = (boss as NonNullable<typeof boss>).hp;

    run.player.bombs = 3;
    run.tick(Button.Bomb);
    for (let t = 0; t < 60; t++) run.tick(0);

    expect((boss as NonNullable<typeof boss>).hp).toBeLessThan(before);
  });

  test('a bomb applies its own invulnerability window, not the ship\'s', () => {
    // `BombSpec.invulnTicks` is documented as "read by the game"; nothing read
    // it, so both bombs gave exactly the character's 90-tick respawn window and
    // `spread`'s declared 150 did nothing.
    const run = new Run(config({ character: ALT }));
    run.player.bombs = 3;
    run.player.invuln = 0;
    run.tick(Button.Bomb);

    expect(getBombSpec(RUN_BOMB).invulnTicks).toBe(150);
    // One tick has already been spent by the time we look.
    expect(run.player.invuln).toBeGreaterThan(getCharacter(ALT).player.invulnTicks);
  });
});
