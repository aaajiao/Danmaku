/**
 * Per-character dialogue variants, on real base-pack content.
 *
 * `BossSpec.dialogueFor` lets a boss speak differently to a given ship: `Run`
 * picks `dialogueFor[character] ?? dialogue` the moment the exchange begins, pure
 * data selection off the character the run already pins (CLAUDE.md rule 4 — the
 * variant's line count is part of that character's timeline). The honesty rule
 * this proves: sentinel authors one variant, for the built-in `spire`, and this
 * drives that exact pairing rather than a synthetic fixture. `scout` gets the
 * default, the regression that a boss without a matching key is unchanged.
 *
 * It lives at the composition root, not under `src/game`: it imports the bundled
 * v4 campaign (where `sentinel` and its `dialogueFor` now live), and `src/v4`
 * pulls in the renderer to build its inject context — which `src/game` may not do
 * (`architecture.test.ts`). Reachability keeps its single pilot character; this
 * dedicated test is the variant wire's proof.
 */

import { describe, expect, test } from 'bun:test';

// Registers the base pack — `sentinel` with its `dialogue` and `dialogueFor` — and
// the built-in portraits its speakers name. Importing `Run` below registers the
// built-in characters (`spire`, `scout`), so both halves of the pairing exist.
import './v4';

import { Button } from './core/input';
import { defineStage } from './content/stage';
import { Run, type RunConfig } from './game/run';

const SEED = 0x5e11;

/** No waves and no boss of its own: the config's `boss` is the only one sent, and
 * an empty stage is finished from tick 0, so it comes due at once. */
const STAGE = 'test-variant-stage';
defineStage(STAGE, { name: STAGE, outro: 0, waves: [] });

function config(character: string): RunConfig {
  return { seed: SEED, character, stage: STAGE, boss: 'sentinel' };
}

/** Drive one tick so the boss is sent and the exchange is up, then read it. */
function exchange(character: string): { speaker: string; text: string; count: number } {
  const run = new Run(config(character));
  run.tick(0);
  const d = run.dialogue;
  if (d === undefined) throw new Error(`no dialogue surfaced for ${character}`);
  return { speaker: d.speaker, text: d.text, count: d.count };
}

describe('sentinel speaks its authored variant to spire and the default to everyone else', () => {
  test('spire gets the two-line variant', () => {
    expect(exchange('spire')).toEqual({
      speaker: 'sentinel',
      text: 'You climb without a summit.',
      count: 2,
    });
  });

  test('scout, with no variant, gets the default three-line exchange', () => {
    expect(exchange('scout')).toEqual({
      speaker: 'sentinel',
      text: 'Far enough.',
      count: 3,
    });
  });

  test('the whole spire variant surfaces line by line, then the boss enters', () => {
    const run = new Run(config('spire'));
    run.tick(0);
    expect(run.dialogue).toEqual({ speaker: 'sentinel', text: 'You climb without a summit.', index: 0, count: 2 });

    // A fresh Shot press advances to the variant's second line.
    run.tick(Button.Shot);
    expect(run.dialogue).toEqual({ speaker: 'player', text: 'The climb is the summit.', index: 1, count: 2 });

    // Releasing and pressing again passes the last line: the exchange ends and the
    // held boss enters — a two-line variant, one line shorter than the default.
    run.tick(0);
    run.tick(Button.Shot);
    expect(run.dialogue).toBeUndefined();
    expect(run.boss.boss?.name).toBe('sentinel');
  });
});
