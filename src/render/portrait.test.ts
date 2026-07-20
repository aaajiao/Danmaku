/**
 * The portrait registry and its tint arithmetic — the parts that hold without a
 * canvas. The painter (`portraitImage`) needs a 2D context and so is judged in
 * the browser; `test:assets`/`bun run dev` note the dialogue box. What is proved
 * here is that a name always resolves, a built-in reads as its boss, and the
 * seeded fallback is deterministic — the properties the shell relies on to draw
 * an exchange for any speaker without ever throwing.
 */

import { describe, expect, test } from 'bun:test';

import {
  PORTRAIT_SIZE,
  definePortrait,
  getPortraitSpec,
  hasPortrait,
  portraitNames,
  seededTint,
  tintFor,
} from './portrait';

describe('built-in portraits', () => {
  test('one per built-in boss plus the player', () => {
    const names = portraitNames();
    for (const name of ['sentinel', 'warden', 'magistrate', 'player']) {
      expect(names).toContain(name);
      expect(hasPortrait(name)).toBe(true);
    }
  });

  test('each built-in reads as its boss — a declared tint, not a seeded one', () => {
    // The literal tints mirror the bosses in sim/boss.ts and content/stage-2.ts.
    expect(getPortraitSpec('sentinel')?.tint).toEqual({ r: 0.8, g: 0.9, b: 1 });
    expect(getPortraitSpec('warden')?.tint).toEqual({ r: 1, g: 0.6, b: 0.72 });
    expect(getPortraitSpec('magistrate')?.tint).toEqual({ r: 0.72, g: 0.68, b: 1 });
    // tintFor prefers the declared tint over the seeded fallback.
    expect(tintFor('sentinel')).toEqual({ r: 0.8, g: 0.9, b: 1 });
  });
});

describe('definePortrait', () => {
  test('registers a name and rejects a duplicate', () => {
    definePortrait('test/rival', { tint: { r: 0.5, g: 0.5, b: 0.5 } });
    expect(hasPortrait('test/rival')).toBe(true);
    expect(() => definePortrait('test/rival', { tint: { r: 1, g: 1, b: 1 } })).toThrow(
      'portrait "test/rival" is already defined',
    );
  });
});

describe('seeded tint', () => {
  test('an unknown name resolves to a deterministic tint, never throwing', () => {
    const a = tintFor('nobody');
    const b = tintFor('nobody');
    expect(a).toEqual(b);
    expect(a).toEqual(seededTint('nobody'));
  });

  test('different names seed different tints', () => {
    expect(seededTint('alpha')).not.toEqual(seededTint('omega'));
  });

  test('every channel stays in the legible 0..1 band', () => {
    for (const name of ['nobody', 'alpha', 'omega', 'a-very-long-speaker-name']) {
      const { r, g, b } = seededTint(name);
      for (const channel of [r, g, b]) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });
});

test('the fixed cell size the manifest loader must enforce is a positive integer', () => {
  expect(Number.isInteger(PORTRAIT_SIZE)).toBe(true);
  expect(PORTRAIT_SIZE).toBeGreaterThan(0);
});
