import { describe, expect, test } from 'bun:test';
import { GAME_VERSION, GAME_VERSION_LABEL } from './version';

describe('public game version', () => {
  test('owns the 0.15 release and its compact menu label', () => {
    expect(GAME_VERSION).toBe('0.15');
    expect(GAME_VERSION_LABEL).toBe('v0.15');
  });
});
