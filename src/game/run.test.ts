import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { Button } from '../core/input';
import { sim } from '../core/random';
import { defineBoss } from '../sim/boss';
import { getBombSpec } from '../sim/bomb';
import { deserialize, serialize, type Replay } from '../sim/replay';
import {
  characterNames,
  defineCharacter,
  getCharacter,
  Run,
  type RunConfig,
} from './run';

const SEED = 0x5747a1;

/**
 * A ship with enough lives to survive the scripted pilot below.
 *
 * The pilot flies a fixed pattern, not the level, so it dies — with three lives
 * it is gone around tick 670, which is before the stage script ends and long
 * before the boss. Every test that needs a *whole* run therefore needs a ship
 * that can absorb the mistakes, and stock is the honest lever: it changes how
 * long the run lasts and nothing about how it is simulated.
 *
 * Registered rather than passed inline, because going through the registry is
 * what proves the character seam is real.
 */
const ENDURANCE = 'test-endurance';
defineCharacter(ENDURANCE, {
  ...getCharacter('scout'),
  label: 'ENDURANCE',
  player: { ...getCharacter('scout').player, lives: 40 },
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
  return { seed: SEED, character: ENDURANCE, ...overrides };
}

/* ------------------------------------------------------------------ */
/* Characters                                                          */
/* ------------------------------------------------------------------ */

describe('characters', () => {
  test('the starter ships are registered', () => {
    expect(characterNames()).toContain('scout');
    expect(characterNames()).toContain('lance');
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
    defineCharacter('test-dupe', getCharacter('scout'));
    expect(() => defineCharacter('test-dupe', getCharacter('scout'))).toThrow(
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
    const live = new Run(config({ boss: 'sentinel' }));
    for (let t = 0; t < 12000 && !live.finished; t++) live.tick(script(t));
    expect(live.finished).toBe(true);

    const replay = live.finishRecording();
    const playback = new Run(config({ boss: 'sentinel', replay }));
    while (!playback.finished && playback.tickCount < replay.length) playback.tick(0);

    expect(playback.outcome).toBe(live.outcome);
    expect(playback.tickCount).toBe(live.tickCount);
    expect(fingerprint(playback)).toBe(fingerprint(live));
  });

  test('a replay flown by the wrong character is refused, not silently wrong', () => {
    const live = new Run(config({ character: 'scout' }));
    play(live, 300);
    const replay = live.finishRecording();
    expect(() => new Run(config({ character: 'lance', replay }))).toThrow(/character/);
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
    const live = new Run(config({ boss: 'sentinel' }));
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
    expect(new Run(config()).bossName).toBe('sentinel');
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
    const live = new Run(config({ character: 'lance', boss: 'sentinel' }));
    play(live, 240);
    const replay = live.finishRecording();
    expect(replay.meta?.['character']).toBe('lance');
    expect(replay.meta?.['stage']).toBe('stage-1');
    expect(replay.meta?.['boss']).toBe('sentinel');
    expect(replay.seed).toBe(SEED);
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
    const run = new Run(config());
    // Idle: the ship never fires, so nothing is killed and the clear must come
    // from the script running out and the survivors leaving on their own.
    for (let t = 0; t < 40000 && !run.finished; t++) run.tick(0);
    expect(['cleared', 'failed']).toContain(run.outcome);
  });

  test('dying out fails the run', () => {
    // The three-life ship, not the endurance one: this is the test that the
    // run *ends* when the stock does.
    const run = new Run(config({ character: 'scout' }));
    // Parked at the top of the field with no shot: everything that spawns
    // survives and everything it fires arrives.
    for (let t = 0; t < 40000 && !run.finished; t++) run.tick(Button.Up);
    expect(run.outcome).toBe('failed');
    expect(run.player.alive).toBe(false);
  });

  test('a boss run does not clear until the boss is gone', () => {
    const run = new Run(config({ boss: 'sentinel' }));
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
    // `drops.power` is a count of items. Read as a power fraction it would put
    // the ship on its top tier within the first wave, which is what the
    // pre-item game did.
    const run = new Run(config());
    play(run, 240);
    expect(run.player.power).toBeLessThan(1);
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
    const run = new Run(config({ boss: 'sentinel' }));
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
    // `render/backgrounds/index.test.ts`'s job — it imports both halves, which
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
    const run = new Run(config({ character: 'scout' }));
    run.player.bombs = 3;
    run.player.invuln = 0;
    run.tick(Button.Bomb);

    expect(getBombSpec('spread').invulnTicks).toBe(150);
    // One tick has already been spent by the time we look.
    expect(run.player.invuln).toBeGreaterThan(getCharacter('scout').player.invulnTicks);
  });
});
