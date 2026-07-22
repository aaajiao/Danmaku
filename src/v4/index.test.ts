/**
 * The v4 composition root installs a complete, internally resolvable edition.
 *
 * Individual registry tests prove each mechanism. This file proves the one
 * import used by the browser actually joins v4 gameplay, scenes and all four
 * campaign stages before downloadable data packs are considered.
 */

import { describe, expect, test } from 'bun:test';

import './index';

import { patternNames } from '../content/pattern-registry';
import { stageNames } from '../content/stage';
import { backgroundNames } from '../render/background';
import { behaviourNames } from '../sim/motion';
import { CONTENT_FINGERPRINT } from './content';
import { V4_PATTERN_NAMES } from './gameplay/patterns';

const V4_BEHAVIOUR_NAMES = [
  'homing',
  'waver',
  'accelerate-to',
  'orbit',
  'beam-sweep',
] as const;

const V4_SCENE_NAMES = [
  'drift',
  'surge',
  'expanse',
  'undertow',
  'stratum',
  'vault',
  'signet',
  'cordon',
  'intaglio',
  'sable',
  'regnum',
  'umbra',
  'decree',
  'signal-decay',
] as const;

describe('v4 edition composition', () => {
  test('installs the compiled danmaku vocabulary', () => {
    expect(patternNames()).toEqual(expect.arrayContaining([...V4_PATTERN_NAMES]));
    expect(behaviourNames()).toEqual(expect.arrayContaining([...V4_BEHAVIOUR_NAMES]));
  });

  test('installs every authored shader scene', () => {
    expect(backgroundNames()).toEqual(expect.arrayContaining([...V4_SCENE_NAMES]));
  });

  test('installs the complete four-stage campaign', () => {
    expect(stageNames()).toEqual(
      expect.arrayContaining(['stage-1', 'stage-2', 'stage-3', 'stage-4']),
    );
  });

  test('preserves the replay-neutral campaign identity', () => {
    expect(CONTENT_FINGERPRINT).toBe('b342fac308ec');
  });

  test('keeps the historical import facades live without a second registration', async () => {
    const patterns = await import('../content/patterns');
    await import('../content/behaviours');
    await import('../render/backgrounds');
    const bundled = await import('../packs/bundled');

    expect(patterns.patternNames()).toEqual(expect.arrayContaining([...V4_PATTERN_NAMES]));
    expect(bundled.CONTENT_FINGERPRINT).toBe(CONTENT_FINGERPRINT);
  });
});
