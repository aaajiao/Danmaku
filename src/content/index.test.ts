/**
 * Guards that content is actually reachable, not merely written.
 *
 * Every other test in `src/content` imports the module it tests directly, which
 * is right for testing behaviour and useless for this: a stage can be perfectly
 * correct and completely absent from the game. The only registration-bearing
 * import below is `./index`; the registry readers themselves define nothing.
 * The tests therefore fail exactly when a content module has been written and
 * never wired in.
 */

import { describe, expect, test } from 'bun:test';

import './index';

import { patternNames } from './pattern-registry';
import { behaviourNames } from '../sim/motion';

// Stages, bosses and enemies are no longer registered by importing this index:
// the four-stage campaign, its cast and bosses moved into
// `src/v4/content/campaign.json` and register through the injector at boot.
// Since decisions-round2 §D the player weapons and characters (spread/needle/…,
// scout/lance/…) moved there too, so `./shots` now exports only the shot REGISTRY,
// registering no types of its own. That those names still resolve to the shipped
// specs is the generator drift test's job (`tools/make-v4-content.test.ts`) and the
// replay regression's (`src/base-content.golden.test.ts`), and that a real
// playthrough reaches every one
// of them is `src/reachability.test.ts`'s. What this index still registers, and
// what this file therefore still guards, is the engine content joined to a pack
// only by name: patterns and motion behaviours. (`./shots` stays imported for its
// machinery, so the completeness scan below still expects it.)

describe('importing the content index registers the engine content packs name', () => {
  test('motion behaviours', () => {
    expect(behaviourNames()).toContain('homing');
  });

  test('patterns', () => {
    expect(patternNames().length).toBeGreaterThan(3);
  });
});

describe('the index is complete', () => {
  // A content module that exists on disk but is not listed in index.ts is the
  // exact failure this directory has already had once. Reading the directory
  // rather than listing files here means the check cannot go stale.
  test('every content module is imported by index.ts', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const dir = new URL('.', import.meta.url).pathname;

    const modules = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => !f.endsWith('.test.ts'))
      .filter((f) => f !== 'index.ts')
      .map((f) => f.replace(/\.ts$/, ''));

    const index = readFileSync(`${dir}index.ts`, 'utf8');
    const missing = modules.filter((m) => !index.includes(`'./${m}'`));

    expect(missing).toEqual([]);
  });
});

// Backgrounds are deliberately NOT covered here, and this file deliberately no
// longer imports `../render/background`.
//
// A scene is a fragment shader, so registering one means importing
// `render/background`, and `src/content` may not import `src/render`. That ban
// is what lets the whole simulation run with no GL context. This file used to
// break it — for a value import, in a test, which is the least alarming way to
// break a layering rule and therefore the way it survives longest.
//
// The two halves of the arrangement are checked where each belongs:
//
//   v4/backgrounds/index.test.ts      every scene name the content writes down
//                                     actually resolves
//   architecture.test.ts              sim and content still import no renderer
//                                     value, test files included
//
// Asserting here that importing content registers *no* background was tried and
// cannot work: the registry is module-global and Bun shares module state across
// test files, so whichever file ran first decided the result.
