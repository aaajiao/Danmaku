import { describe, expect, test } from 'bun:test';

import {
  BOSS_ARRIVAL_MUSIC_FADE_SECONDS,
  EVENT_SOUNDS,
  MUSIC_START_FADE_SECONDS,
  MUSIC_TRANSITION_FADE_SECONDS,
  resolveMusicTransition,
  shouldPlayRunEventSound,
} from './cues';
import type { RunEventType } from './run';

describe('boss arrival sound priority', () => {
  test('the fly-in owns the toll and settling leaves the declaration unobscured', () => {
    expect(EVENT_SOUNDS['boss-arriving']).toBe('toll');
    expect(EVENT_SOUNDS['boss-entered']).toBeUndefined();
    expect(EVENT_SOUNDS['boss-phase']).toBe('declare');
  });

  test('mutes only low-priority voices while preserving the arrival and declarations', () => {
    const low: readonly RunEventType[] = [
      'shot',
      'shot-hit',
      'boss-hit',
      'graze',
      'pickup',
    ];
    for (const type of low) expect(shouldPlayRunEventSound(type, true)).toBe(false);

    expect(shouldPlayRunEventSound('boss-arriving', true)).toBe(true);
    expect(shouldPlayRunEventSound('boss-phase', true)).toBe(true);
    expect(shouldPlayRunEventSound('player-death', true)).toBe(true);
  });

  test('does not suppress ordinary ticks', () => {
    expect(shouldPlayRunEventSound('shot', false)).toBe(true);
    expect(shouldPlayRunEventSound('graze', false)).toBe(true);
    expect(shouldPlayRunEventSound('pickup', false)).toBe(true);
  });
});

describe('boss arrival music transition', () => {
  test('uses the short fade for an arriving boss and the established fades otherwise', () => {
    expect(resolveMusicTransition('stage', 'boss', undefined, true)).toEqual({
      fadeSeconds: BOSS_ARRIVAL_MUSIC_FADE_SECONDS,
      pendingBossTrack: 'boss',
    });
    expect(resolveMusicTransition('stage', 'next-stage', undefined, false)).toEqual({
      fadeSeconds: MUSIC_TRANSITION_FADE_SECONDS,
      pendingBossTrack: undefined,
    });
    expect(resolveMusicTransition(undefined, 'menu', undefined, false)).toEqual({
      fadeSeconds: MUSIC_START_FADE_SECONDS,
      pendingBossTrack: undefined,
    });
  });

  test('retains the short fade across a loading retry, then clears it on success or reroute', () => {
    const loading = resolveMusicTransition('stage', 'boss', undefined, true);
    expect(resolveMusicTransition(
      'stage',
      'boss',
      loading.pendingBossTrack,
      false,
    )).toEqual(loading);

    expect(resolveMusicTransition('boss', 'boss', 'boss', false).pendingBossTrack)
      .toBeUndefined();
    expect(resolveMusicTransition('stage', 'menu', 'boss', false)).toEqual({
      fadeSeconds: MUSIC_TRANSITION_FADE_SECONDS,
      pendingBossTrack: undefined,
    });
  });
});
