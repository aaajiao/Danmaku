/**
 * Guards that content is actually reachable, not merely written.
 *
 * Every other test in `src/content` imports the module it tests directly, which
 * is right for testing behaviour and useless for this: a stage can be perfectly
 * correct and completely absent from the game. These tests import ONLY
 * `./index`, so they fail exactly when a content module has been written and
 * never wired in.
 */

import { describe, expect, test } from 'bun:test';

import './index';

import { backgroundNames } from '../render/background';
import { patternNames } from './patterns';
import { shotNames } from './shots';
import { stageNames } from './stage';
import { behaviourNames } from '../sim/motion';
import { bossNames } from '../sim/boss';
import { enemyNames } from '../sim/enemy';

describe('importing the content index registers everything', () => {
  test('stages', () => {
    expect(stageNames()).toContain('stage-1');
    expect(stageNames()).toContain('stage-2');
  });

  test('bosses, including both of stage 2', () => {
    expect(bossNames()).toContain('warden');
    expect(bossNames()).toContain('magistrate');
  });

  test('enemies from both stages', () => {
    const names = enemyNames();
    // Stage 1's cast is defined in sim/enemy.ts, stage 2's in its own file —
    // so this also proves a content file can register enemies of its own.
    expect(names).toContain('grunt');
    expect(names).toContain('drifter');
  });

  test('shot types', () => {
    expect(shotNames().length).toBeGreaterThan(1);
  });

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

describe('backgrounds', () => {
  // Registered by src/render/background.ts rather than by a content file, so
  // this only checks the game has some. Listed here because a background is
  // content in every sense that matters to whoever authors one.
  test('at least two are registered', () => {
    expect(backgroundNames().length).toBeGreaterThanOrEqual(2);
  });
});
