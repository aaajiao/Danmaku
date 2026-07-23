import { describe, expect, test } from 'bun:test';

import { musicNames } from '../../audio/music';
import { MENU_MUSIC, V4_BOSS_MUSIC_NAMES, V4_MUSIC_NAMES } from './index';

describe('v4 fallback score ownership', () => {
  test('the edition registers its exact thirteen-track inventory', () => {
    expect(MENU_MUSIC).toBe('menu');
    expect(V4_MUSIC_NAMES).toHaveLength(13);
    expect(new Set(V4_MUSIC_NAMES).size).toBe(13);

    for (const name of V4_MUSIC_NAMES) expect(musicNames()).toContain(name);
  });

  test('the generic engine does not hide the edition inventory in its source', async () => {
    const source = await Bun.file(new URL('../../audio/music.ts', import.meta.url)).text();
    for (const name of V4_MUSIC_NAMES) {
      expect(source).not.toContain(`defineMusic('${name}'`);
    }
  });

  test('the preload set is exactly the five campaign boss themes', () => {
    expect(V4_BOSS_MUSIC_NAMES).toEqual([
      'nemesis',
      'interdict',
      'docket',
      'sanction',
      'interregnum',
    ]);
    for (const name of V4_BOSS_MUSIC_NAMES) expect(V4_MUSIC_NAMES).toContain(name);
  });
});
