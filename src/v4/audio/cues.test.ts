import { describe, expect, test } from 'bun:test';

import { soundNames } from '../../audio';
import type { RunEvent } from '../../game/run';
import {
  V4_EVENT_SOUND_NAMES,
  v4EventSound,
} from './index';

const event = (
  type: RunEvent['type'],
  details: Pick<RunEvent, 'name' | 'tier'> = {},
): RunEvent => ({ type, x: 0, y: 0, ...details });

describe('v4 event sounds', () => {
  test('the edition registers every dynamic cue exactly once', () => {
    expect(V4_EVENT_SOUND_NAMES).toHaveLength(10);
    expect(new Set(V4_EVENT_SOUND_NAMES).size).toBe(10);
    for (const name of V4_EVENT_SOUND_NAMES) expect(soundNames()).toContain(name);
  });

  test('the four weapon tiers have four different cue identities', () => {
    const sounds = [
      v4EventSound(event('shot', { tier: 0 })),
      v4EventSound(event('shot', { tier: 1 })),
      v4EventSound(event('shot', { tier: 2 })),
      v4EventSound(event('shot', { tier: 3 })),
    ];

    expect(sounds).toEqual([
      'shot',
      'shot-tier-1',
      'shot-tier-2',
      'shot-tier-3',
    ]);
    expect(new Set(sounds).size).toBe(4);
    expect(v4EventSound(event('shot'))).toBe('shot');
    expect(v4EventSound(event('shot', { tier: 99 }))).toBe('shot-tier-3');
  });

  test('only a reported tier crossing replaces the ordinary pickup cue', () => {
    expect(v4EventSound(event('pickup'))).toBeUndefined();
    expect(v4EventSound(event('pickup', { tier: 0 }))).toBeUndefined();
    expect(v4EventSound(event('pickup', { tier: 1 }))).toBe('power-up-1');
    expect(v4EventSound(event('pickup', { tier: 2 }))).toBe('power-up-2');
    expect(v4EventSound(event('pickup', { tier: 3 }))).toBe('power-up-3');
  });

  test('each campaign authority has its own entry cue and guests keep the toll', () => {
    expect(v4EventSound(event('boss-arriving', { name: 'warden' }))).toBe(
      'boss-enter-warden',
    );
    expect(v4EventSound(event('boss-arriving', { name: 'magistrate' }))).toBe(
      'boss-enter-magistrate',
    );
    expect(v4EventSound(event('boss-arriving', { name: 'chancellor' }))).toBe(
      'boss-enter-chancellor',
    );
    expect(v4EventSound(event('boss-arriving', { name: 'regent' }))).toBe(
      'boss-enter-regent',
    );
    expect(v4EventSound(event('boss-arriving', { name: 'sentinel' }))).toBe('toll');
    expect(v4EventSound(event('boss-arriving', { name: 'guest-boss' }))).toBe('toll');
    // Settling is deliberately silent; the adjacent boss-phase owns `declare`.
    expect(v4EventSound(event('boss-entered', { name: 'warden' }))).toBeUndefined();
  });
});
