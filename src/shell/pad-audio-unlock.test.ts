import { describe, expect, test } from 'bun:test';

import { PAD_AUDIO_RETRY_TICKS, PadAudioUnlock, type PadAudioFacts } from './pad-audio-unlock';

const PRESS: PadAudioFacts = { ready: false, padActive: true, activation: true };

describe('PadAudioUnlock', () => {
  test('a pad press the browser counts as activation tries at once', () => {
    expect(new PadAudioUnlock().step(PRESS)).toBe(true);
  });

  test('a stick push grants no activation, so nothing is tried', () => {
    const unlock = new PadAudioUnlock();
    for (let i = 0; i < 600; i++) {
      expect(unlock.step({ ...PRESS, activation: false })).toBe(false);
    }
  });

  test('a mouse, key or touch session never takes this path', () => {
    // Activation is present (their own gesture), but the pad is not in use.
    const unlock = new PadAudioUnlock();
    for (let i = 0; i < 600; i++) {
      expect(unlock.step({ ...PRESS, padActive: false })).toBe(false);
    }
  });

  test('nothing is tried once audio is running', () => {
    const unlock = new PadAudioUnlock();
    for (let i = 0; i < 600; i++) {
      expect(unlock.step({ ...PRESS, ready: true })).toBe(false);
    }
  });

  test('a held button asks once, then again only after the retry interval', () => {
    const unlock = new PadAudioUnlock();
    const tries: number[] = [];
    for (let tick = 0; tick < PAD_AUDIO_RETRY_TICKS * 2 + 1; tick++) {
      if (unlock.step(PRESS)) tries.push(tick);
    }
    expect(tries).toEqual([0, PAD_AUDIO_RETRY_TICKS, PAD_AUDIO_RETRY_TICKS * 2]);
  });

  test('the interval runs through ticks with no press', () => {
    const unlock = new PadAudioUnlock();
    expect(unlock.step(PRESS)).toBe(true);
    for (let i = 0; i < PAD_AUDIO_RETRY_TICKS - 1; i++) {
      unlock.step({ ...PRESS, activation: false });
    }
    expect(unlock.step(PRESS)).toBe(true);
  });

  test('audio lost after it ran may be retried without waiting', () => {
    const unlock = new PadAudioUnlock();
    expect(unlock.step(PRESS)).toBe(true);
    expect(unlock.step({ ...PRESS, ready: true })).toBe(false);
    // The context was closed underneath us: the next press tries again.
    expect(unlock.step(PRESS)).toBe(true);
  });
});
