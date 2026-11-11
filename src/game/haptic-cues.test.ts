import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  EVENT_HAPTICS,
  nextRumbleSetting,
  parseRumbleSetting,
  RUMBLE_GAIN,
  RUMBLE_SETTINGS,
  rumbleLabel,
  SHELL_HAPTICS,
  shouldPlayRunEventHaptic,
  type RumbleSetting,
} from './haptic-cues';
import type { RunEventType } from './run';

/**
 * Every `RunEventType`, listed by hand. The `satisfies` clause makes this list
 * fail to compile if it names a type that does not exist; the key-count
 * assertion below catches the converse (a type the list forgot), because
 * `EVENT_HAPTICS` is a total record and so always has every key.
 */
const EVENT_TYPES = [
  'shot', 'shot-hit', 'enemy-killed', 'boss-hit', 'boss-break', 'graze', 'bomb',
  'pickup', 'extend', 'player-death', 'boss-arriving', 'boss-entered', 'boss-phase',
  'boss-cleared', 'boss-defeated', 'cleared', 'failed',
] as const satisfies readonly RunEventType[];

describe('EVENT_HAPTICS', () => {
  test('is total: one row per event type, no more', () => {
    expect(Object.keys(EVENT_HAPTICS).sort()).toEqual([...EVENT_TYPES].sort());
  });

  test('maps exactly the nine felt events, to the brief\'s cue names', () => {
    const felt = Object.fromEntries(
      Object.entries(EVENT_HAPTICS).filter(([, cue]) => cue !== null),
    );
    expect(felt).toEqual({
      graze: 'graze',
      'player-death': 'death',
      bomb: 'bomb',
      extend: 'extend',
      'boss-arriving': 'boss-arrive',
      'boss-phase': 'boss-phase',
      'boss-break': 'boss-break',
      'boss-defeated': 'boss-defeat',
      cleared: 'clear',
    });
  });

  test('`failed` is silent: it shares its tick with the final death', () => {
    expect(EVENT_HAPTICS.failed).toBeNull();
    expect(EVENT_HAPTICS['player-death']).toBe('death');
  });

  test('every null row carries a reason in the source', () => {
    // A null is a decision; the file says so. Hold it to that: the line before
    // each `<key>: null` entry must be a comment.
    const source = readFileSync(new URL('./haptic-cues.ts', import.meta.url), 'utf8');
    const lines = source.split('\n');
    const nullKeys = Object.entries(EVENT_HAPTICS)
      .filter(([, cue]) => cue === null)
      .map(([key]) => key);
    expect(nullKeys.length).toBeGreaterThan(0);
    for (const key of nullKeys) {
      const at = lines.findIndex((line) =>
        new RegExp(`^\\s*'?${key}'?: null,`).test(line));
      expect(at).toBeGreaterThan(0);
      expect(lines[at - 1]?.trim().startsWith('//')).toBe(true);
    }
  });

  test('shell cues are disjoint from run-event cues', () => {
    const eventCues = new Set(Object.values(EVENT_HAPTICS).filter((cue) => cue !== null));
    for (const cue of SHELL_HAPTICS) expect(eventCues.has(cue)).toBe(false);
    expect([...SHELL_HAPTICS]).toEqual(['ui-test']);
  });
});

describe('shouldPlayRunEventHaptic', () => {
  const clear = { bossArrivingInBatch: false, playerInvulnerable: false };

  test('graze plays only when the player is vulnerable and no boss is arriving', () => {
    expect(shouldPlayRunEventHaptic('graze', clear)).toBe(true);
    expect(shouldPlayRunEventHaptic('graze', { ...clear, playerInvulnerable: true })).toBe(false);
    expect(shouldPlayRunEventHaptic('graze', { ...clear, bossArrivingInBatch: true })).toBe(false);
    expect(
      shouldPlayRunEventHaptic('graze', { bossArrivingInBatch: true, playerInvulnerable: true }),
    ).toBe(false);
  });

  test('every other event is never held back, under any flags', () => {
    const flags = [
      clear,
      { bossArrivingInBatch: true, playerInvulnerable: false },
      { bossArrivingInBatch: false, playerInvulnerable: true },
      { bossArrivingInBatch: true, playerInvulnerable: true },
    ];
    for (const type of EVENT_TYPES) {
      if (type === 'graze') continue;
      for (const when of flags) expect(shouldPlayRunEventHaptic(type, when)).toBe(true);
    }
  });
});

describe('the rumble setting', () => {
  test('three settings, in cycle order, with their gains', () => {
    expect([...RUMBLE_SETTINGS]).toEqual(['off', 'low', 'full']);
    expect(RUMBLE_GAIN).toEqual({ off: 0, low: 0.5, full: 1 });
  });

  test('cycles off → low → full → off', () => {
    expect(nextRumbleSetting('off')).toBe('low');
    expect(nextRumbleSetting('low')).toBe('full');
    expect(nextRumbleSetting('full')).toBe('off');
    let setting: RumbleSetting = 'off';
    for (let i = 0; i < RUMBLE_SETTINGS.length; i++) setting = nextRumbleSetting(setting);
    expect(setting).toBe('off');
  });

  test('an out-of-union value recovers to off rather than undefined', () => {
    expect(nextRumbleSetting('loud' as RumbleSetting)).toBe('off');
  });

  test('parse accepts exactly the three strings and falls back otherwise', () => {
    for (const setting of RUMBLE_SETTINGS) {
      expect(parseRumbleSetting(setting, 'full')).toBe(setting);
    }
    for (const junk of [undefined, null, '', 'FULL', ' full', 'on', 1, true, {}, ['low']]) {
      expect(parseRumbleSetting(junk, 'full')).toBe('full');
      expect(parseRumbleSetting(junk, 'off')).toBe('off');
    }
  });

  test('labels use two spaces, like the setup toggles', () => {
    expect(rumbleLabel('off')).toBe('RUMBLE  OFF');
    expect(rumbleLabel('low')).toBe('RUMBLE  LOW');
    expect(rumbleLabel('full')).toBe('RUMBLE  FULL');
  });

  test('the tables are frozen', () => {
    expect(Object.isFrozen(EVENT_HAPTICS)).toBe(true);
    expect(Object.isFrozen(RUMBLE_SETTINGS)).toBe(true);
    expect(Object.isFrozen(RUMBLE_GAIN)).toBe(true);
  });
});

describe('the module stays headless', () => {
  test('imports nothing but a type from ./run', () => {
    const source = readFileSync(new URL('./haptic-cues.ts', import.meta.url), 'utf8');
    const imports = source
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^(import|export)\b.*\bfrom\b/.test(line));
    expect(imports).toEqual([`import type { RunEventType } from './run';`]);
  });
});
