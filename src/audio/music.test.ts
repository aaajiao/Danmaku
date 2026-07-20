/**
 * The headless half of the music engine: the registry, its overwrite seam, the
 * built-in launch set, and that the runtime is inert (never throwing) where
 * WebAudio does not exist — which `bun test` is, having no `AudioContext`. The
 * crossfade, the loop points and the drone's actual sound are browser-judged;
 * `docs/audio.md` says which dev flow verifies them, honestly, the way the
 * density page's note does for readability.
 */

import { describe, expect, test } from 'bun:test';

import { defineMusic, MENU_MUSIC, Music, musicNames } from './music';

describe('the music registry', () => {
  test('the launch set is registered — the menu, the stage themes, a boss theme', () => {
    // These are the names the built-in stages and bosses wire to; a rename here
    // that is not mirrored there is exactly what `reachability.test.ts` fails on.
    for (const name of [MENU_MUSIC, 'vigil', 'descent', 'nemesis']) {
      expect(musicNames()).toContain(name);
    }
  });

  test('MENU_MUSIC is the track the menu names', () => {
    expect(MENU_MUSIC).toBe('menu');
    expect(musicNames()).toContain(MENU_MUSIC);
  });

  test('a duplicate name overwrites rather than throwing — the replacement seam', () => {
    // Like `defineSound`: the placeholder floor exists to be replaced, from a
    // content file or a pack, without editing the engine.
    defineMusic('test-overwrite', {});
    expect(() => defineMusic('test-overwrite', { url: 'x.wav' })).not.toThrow();
    // Still one entry, not two.
    const count = musicNames().filter((n) => n === 'test-overwrite').length;
    expect(count).toBe(1);
  });

  test('a non-finite loop point or volume does not poison the registry', () => {
    // Spec values arrive unvalidated; NaN must never reach a gain or a scheduler.
    expect(() =>
      defineMusic('test-nan', {
        loopStart: Number.NaN,
        loopEnd: Number.POSITIVE_INFINITY,
        volume: Number.NaN,
      }),
    ).not.toThrow();
    expect(musicNames()).toContain('test-nan');
  });
});

describe('the runtime is inert without WebAudio', () => {
  // `bun test` has no `AudioContext`, so every one of these exercises the
  // no-context branch — the same total-degradation contract the sound engine
  // holds: audio may go silent, never take the run down.

  test('constructing, unlocking and playing never throw', async () => {
    const music = new Music({ masterVolume: 0.5 });
    await music.unlock();

    expect(music.unlocked).toBe(false); // No context came up.
    expect(() => music.play(MENU_MUSIC, 1)).not.toThrow();
    // Nothing started, so nothing is current — which is what makes the shell's
    // reconcile start the theme on the first tick after a real unlock.
    expect(music.current).toBeUndefined();
    expect(() => music.stopAll()).not.toThrow();
  });

  test('playing an unknown track is a no-op', () => {
    const music = new Music();
    expect(() => music.play('no-such-track')).not.toThrow();
    expect(music.current).toBeUndefined();
  });

  test('masterVolume clamps to [0,1] and reads back', () => {
    const music = new Music({ masterVolume: 0.4 });
    expect(music.masterVolume).toBe(0.4);
    music.masterVolume = 2;
    expect(music.masterVolume).toBe(1);
    music.masterVolume = -1;
    expect(music.masterVolume).toBe(0);
  });
});
