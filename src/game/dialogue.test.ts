/**
 * Dialogue as simulation.
 *
 * The exchange delays the boss and is advanced by player input, so it changes
 * the run's timeline and must live in the tick-and-mask world or replays break
 * (CLAUDE.md rules 1, 4). These tests pin the mechanism the shell only renders:
 * the phase enters on boss-send, a fresh Shot advances a line while a held one
 * does not, the last line spawns the boss, the field is cleared on entry, the
 * player cannot fire during it, and a recording reproduces the whole exchange
 * tick-for-tick. The final test is the regression: a boss with no dialogue
 * spawns exactly as it did before any of this existed.
 */

import { describe, expect, test } from 'bun:test';

import { Button } from '../core/input';
import { defineBomb } from '../sim/bomb';
import { defineBoss } from '../sim/boss';
import type { BulletSpec } from '../sim/bullet';
import { defineOptions } from '../sim/option';
import { defineStage } from '../content/stage';
import { deserialize, serialize } from '../sim/replay';
import { defineCharacter, Run, type RunConfig } from './run';

const SEED = 0x0d1a;

/** No waves and no boss of its own: the config's boss is the only one sent. */
const STAGE = 'test-dialogue-stage';
defineStage(STAGE, { name: STAGE, outro: 0, waves: [] });

/**
 * A local pilot. The shipped roster (scout/lance/…) moved into the bundled base
 * pack (decisions-round2 §D), which a `src/game` test may not import — so this
 * file registers a faithful stand-in with a forward gun and a plain option/bomb,
 * enough to fly the exchange and chip the boss down. Its shot/options/bomb are
 * local so the file runs alone rather than under the full suite's leakage.
 */
const DIALOGUE_OPTIONS = 'test.dialogue-options';
defineOptions(DIALOGUE_OPTIONS, {
  sprite: 'orb.medium',
  shot: { style: { sprite: 'orb.small' }, radius: 4, motion: { r: 11, theta: 270 }, damage: 1 },
  period: 5,
  levels: [[], [{ x: -20, y: 0, focusX: -8, focusY: -10, angle: 270 }, { x: 20, y: 0, focusX: 8, focusY: -10, angle: 270 }]],
});
const DIALOGUE_BOMB = 'test.dialogue-bomb';
defineBomb(DIALOGUE_BOMB, { duration: 90, invulnTicks: 150, damagePerTick: 2, convertBullets: true, effect: 'death.big' });
const CHARACTER = 'test-dialogue-character';
defineCharacter(CHARACTER, {
  label: 'DIALOGUE',
  sprite: 'ship',
  options: DIALOGUE_OPTIONS,
  bomb: DIALOGUE_BOMB,
  player: {
    x: 240, y: 568, speed: 3.6, focusSpeed: 1.5, radius: 2.5, grazeRadius: 20, lives: 3, bombs: 3, invulnTicks: 90,
    shots: [{ spec: { style: { sprite: 'glow.small' }, radius: 4, motion: { r: 9, theta: 270 }, damage: 1 }, offsets: [{ x: 0, y: -10, angle: 270 }], period: 5 }],
  },
});

/**
 * A boss with a three-line exchange. Its phase is deliberately fat — high health,
 * long clock, no fire — so it survives the replay window and its health chips
 * down deterministically under player shot rather than dying or timing out.
 */
const DIALOGUE_BOSS = 'test-dialogue-boss';
defineBoss(DIALOGUE_BOSS, {
  sprite: 'orb.large',
  radius: 16,
  // Flies into the field so player shot can reach it — a boss with no entry
  // would settle off-field at the spawn point and take no damage.
  entry: { x: 240, y: 200, ticks: 20 },
  dialogue: [
    { speaker: 'test-dialogue-boss', text: 'first' },
    { speaker: 'player', text: 'second' },
    { speaker: 'test-dialogue-boss', text: 'third' },
  ],
  phases: [{ name: 'test phase', hp: 2000, timeLimit: 6000, patterns: [] }],
});

/** The same boss with no dialogue, for the regression test. */
const PLAIN_BOSS = 'test-dialogue-plain';
defineBoss(PLAIN_BOSS, {
  sprite: 'orb.large',
  radius: 16,
  phases: [{ name: 'test phase', hp: 2000, timeLimit: 6000, patterns: [] }],
});

/** A stray enemy bullet, to prove the field is cleared on entry. */
const STRAY: BulletSpec = {
  style: { sprite: 'orb.small' },
  radius: 3,
  motion: { r: 0, theta: 90 },
};

function config(boss: string, overrides: Partial<RunConfig> = {}): RunConfig {
  return { seed: SEED, character: CHARACTER, stage: STAGE, boss, ...overrides };
}

/** Everything a dialogue divergence could hide in, flattened to a string. */
function fingerprint(run: Run): string {
  const d = run.dialogue;
  const boss = run.boss.boss;
  const parts: (string | number)[] = [
    run.tickCount,
    run.outcome,
    run.player.x,
    run.player.y,
    run.player.score,
    run.bullets.count,
    d === undefined ? 'no-dialogue' : `${d.speaker}:${d.index}/${d.count}`,
    boss === undefined ? 'no-boss' : `${boss.name}:${boss.hp}:${boss.phaseIndex}:${boss.entering ? 1 : 0}`,
  ];
  for (const b of run.bullets.bullets) parts.push(b.x, b.y, b.faction);
  return parts.join('|');
}

describe('the dialogue phase', () => {
  test('is entered when a boss carrying dialogue is sent, before it spawns', () => {
    const run = new Run(config(DIALOGUE_BOSS));
    // The empty stage is finished from tick 0 and the field is clear, so the
    // boss comes due immediately — and the exchange, not the boss, is what is up.
    run.tick(0);
    expect(run.dialogue).toEqual({ speaker: 'test-dialogue-boss', text: 'first', index: 0, count: 3 });
    expect(run.boss.active).toBe(false);
  });

  test('clears the field on entry', () => {
    const run = new Run(config(DIALOGUE_BOSS));
    // A bullet in the air when the exchange begins is erased — the genre's mercy.
    expect(run.bullets.spawn(240, 300, STRAY, 'enemy')).toBeDefined();
    expect(run.bullets.count).toBeGreaterThan(0);
    run.tick(0);
    expect(run.dialogue).toBeDefined();
    expect(run.bullets.count).toBe(0);
  });

  test('a fresh Shot press advances one line; a held Shot does not', () => {
    const run = new Run(config(DIALOGUE_BOSS));
    run.tick(0);
    expect(run.dialogue?.index).toBe(0);

    // Fresh press: 0 -> 1.
    run.tick(Button.Shot);
    expect(run.dialogue?.index).toBe(1);

    // Held across the next tick: no edge, no advance.
    run.tick(Button.Shot);
    expect(run.dialogue?.index).toBe(1);

    // Released, then pressed again: a second fresh press, 1 -> 2.
    run.tick(0);
    run.tick(Button.Shot);
    expect(run.dialogue?.index).toBe(2);
  });

  test('a Shot already held on entry does not advance the first line', () => {
    const run = new Run(config(DIALOGUE_BOSS));
    // Enter the exchange on the very tick Shot is held: the seed of the tap edge
    // is what stops a stage-clearing hold from skipping line 0.
    run.tick(Button.Shot);
    expect(run.dialogue?.index).toBe(0);
    // Still held next tick: still no advance.
    run.tick(Button.Shot);
    expect(run.dialogue?.index).toBe(0);
  });

  test('the player moves but cannot fire during the exchange', () => {
    const run = new Run(config(DIALOGUE_BOSS));
    run.tick(0);
    const x0 = run.player.x;

    // Right + Shot: the ship moves right, the press advances a line, and no
    // player bullet leaves the muzzle.
    for (let i = 0; i < 20; i++) run.tick(Button.Right | Button.Shot);

    expect(run.player.x).toBeGreaterThan(x0);
    const playerBullets = run.bullets.bullets.filter((b) => b.faction === 'player');
    expect(playerBullets.length).toBe(0);
    expect(run.player.fired).toBe(false);
  });

  test('a Bomb press during the exchange neither blasts nor spends a stock', () => {
    const run = new Run(config(DIALOGUE_BOSS));
    run.tick(0);
    const stock = run.player.bombs;

    // The dialogue mask strips Bomb before the player sees it, so a press here
    // must be a complete no-op: no blast, the stock intact, and no line advance
    // (only Shot reads as "next"). Pinned because a refactor that dropped the
    // Bomb bit from the mask would silently eat a stock and pass everything else.
    run.tick(Button.Bomb);
    run.tick(0);

    expect(run.player.bombs).toBe(stock);
    expect(run.bombs.active).toBe(false);
    expect(run.dialogue?.index).toBe(0);
  });

  test('passing the last line spawns the boss exactly as it would have', () => {
    const run = new Run(config(DIALOGUE_BOSS));
    run.tick(0); // line 0
    expect(run.boss.active).toBe(false);

    // Three fresh presses, spaced by a release each, to pass all three lines.
    for (let line = 0; line < 3; line++) {
      run.tick(Button.Shot);
      run.tick(0);
    }

    expect(run.dialogue).toBeUndefined();
    expect(run.boss.active).toBe(true);
    expect(run.boss.boss?.name).toBe(DIALOGUE_BOSS);
  });
});

describe('a run through a dialogue replays identically', () => {
  /**
   * Varied tap timing: Shot is pressed for three of every seven ticks, so fresh
   * presses land on ticks 0, 7, 14, … — input-driven advance points, which is
   * the property a replay has to reproduce. Movement is stirred in so the trace
   * is not a straight line.
   */
  function varied(t: number): number {
    let b = 0;
    if (t % 7 < 3) b |= Button.Shot;
    if (t % 5 < 2) b |= Button.Right;
    else if (t % 5 < 4) b |= Button.Left;
    return b;
  }

  function trace(run: Run, ticks: number, input: (t: number) => number): string {
    const frames: string[] = [];
    for (let t = 0; t < ticks && !run.finished; t++) {
      run.tick(input(t));
      if (t % 10 === 0) frames.push(fingerprint(run));
    }
    return frames.join('\n');
  }

  test('the exchange and the fight after it reproduce tick-for-tick', () => {
    const live = new Run(config(DIALOGUE_BOSS));
    const liveTrace = trace(live, 600, varied);
    const recorded = live.finishRecording();

    // Round-tripped through JSON, then driven with no live input at all: the
    // recorded masks — including the dialogue taps — are the only thing steering.
    const replay = deserialize(serialize(recorded));
    const playback = new Run(config(DIALOGUE_BOSS, { replay }));
    const playbackTrace = trace(playback, replay.length, () => 0);

    expect(playbackTrace).toBe(liveTrace);
    expect(playback.tickCount).toBe(live.tickCount);
    expect(fingerprint(playback)).toBe(fingerprint(live));
  });

  test('the recorded run really passed through the exchange into the fight', () => {
    // A guard on the test above: if the boss never spawned, the "replay" would be
    // proving nothing about dialogue. It must reach the fight with the boss up.
    const live = new Run(config(DIALOGUE_BOSS));
    let sawDialogue = false;
    for (let t = 0; t < 600 && !live.finished; t++) {
      live.tick(varied(t));
      if (live.dialogue !== undefined) sawDialogue = true;
    }
    expect(sawDialogue).toBe(true);
    expect(live.dialogue).toBeUndefined();
    expect(live.boss.active).toBe(true);
    expect(live.boss.boss?.hp).toBeLessThan(2000);
  });
});

describe('a boss without dialogue', () => {
  test('spawns immediately, with no exchange', () => {
    const run = new Run(config(PLAIN_BOSS));
    run.tick(0);
    // No dialogue phase at all: the boss is on the field the moment it is sent,
    // exactly as every boss did before dialogue existed.
    expect(run.dialogue).toBeUndefined();
    expect(run.boss.active).toBe(true);
    expect(run.boss.boss?.name).toBe(PLAIN_BOSS);
  });
});
