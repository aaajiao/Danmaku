import { describe, expect, test } from 'bun:test';

import { MAX_HAPTIC_TICKS, defineHaptic, getHaptic, hapticNames, type HapticSpec } from './index';

/**
 * The registry is module-level and shared by every test file that imports it,
 * so anything defined here is namespaced and never reused — and the floor cue
 * names are never redefined, since other files read them.
 */
const NS = 'test:haptics.index.test/';

let nextName = 0;
function unique(label: string): string {
  return `${NS}${label}-${nextName++}`;
}

function defined(name: string): NonNullable<ReturnType<typeof getHaptic>> {
  const cue = getHaptic(name);
  if (cue === undefined) throw new Error(`cue ${name} is not registered`);
  return cue;
}

/** Content data arrives untyped; this is how a test hands the registry junk. */
function junk(value: unknown): HapticSpec {
  return value as HapticSpec;
}

describe('defineHaptic sanitising', () => {
  test('a clean spec resolves to the same values', () => {
    const name = unique('clean');
    defineHaptic(name, {
      segments: [
        { strong: 0.25, weak: 0.5, ticks: 3 },
        { strong: 0, weak: 0, ticks: 2 },
      ],
      throttleTicks: 7,
    });
    expect(defined(name)).toEqual({
      segments: [
        { strong: 0.25, weak: 0.5, ticks: 3 },
        { strong: 0, weak: 0, ticks: 2 },
      ],
      throttleTicks: 7,
      ticks: 5,
    });
  });

  test('non-finite magnitudes become 0', () => {
    const name = unique('nan');
    defineHaptic(name, {
      segments: [
        { strong: NaN, weak: Infinity, ticks: 1 },
        { strong: -Infinity, weak: NaN, ticks: 1 },
      ],
    });
    expect(defined(name).segments).toEqual([
      { strong: 0, weak: 0, ticks: 1 },
      { strong: 0, weak: 0, ticks: 1 },
    ]);
  });

  test('magnitudes are clamped to 0..1, and -0 folds to 0', () => {
    const name = unique('clamp');
    defineHaptic(name, {
      segments: [
        { strong: -0.5, weak: 1.5, ticks: 1 },
        { strong: 2, weak: -3, ticks: 1 },
        { strong: -0, weak: 1, ticks: 1 },
      ],
    });
    const segs = defined(name).segments;
    expect(segs).toEqual([
      { strong: 0, weak: 1, ticks: 1 },
      { strong: 1, weak: 0, ticks: 1 },
      { strong: 0, weak: 1, ticks: 1 },
    ]);
    expect(Object.is(segs[2]?.strong, -0)).toBe(false);
  });

  test('fractional ticks are floored; segments left under one tick are dropped', () => {
    const name = unique('ticks');
    defineHaptic(name, {
      segments: [
        { strong: 0.1, weak: 0, ticks: 2.9 },
        { strong: 0.2, weak: 0, ticks: 0.99 },
        { strong: 0.3, weak: 0, ticks: 0 },
        { strong: 0.4, weak: 0, ticks: -4 },
        { strong: 0.5, weak: 0, ticks: NaN },
        { strong: 0.6, weak: 0, ticks: Infinity },
        { strong: 0.7, weak: 0, ticks: 1 },
      ],
    });
    expect(defined(name)).toEqual({
      segments: [
        { strong: 0.1, weak: 0, ticks: 2 },
        { strong: 0.7, weak: 0, ticks: 1 },
      ],
      throttleTicks: 0,
      ticks: 3,
    });
  });

  test('a cue whose every segment is dropped still registers, zero-length', () => {
    const name = unique('empty');
    defineHaptic(name, { segments: [{ strong: 1, weak: 1, ticks: 0 }] });
    expect(defined(name)).toEqual({ segments: [], throttleTicks: 0, ticks: 0 });
  });

  test('total length is capped at 600 ticks by truncating the tail', () => {
    expect(MAX_HAPTIC_TICKS).toBe(600);
    const name = unique('cap');
    defineHaptic(name, {
      segments: [
        { strong: 0.1, weak: 0, ticks: 400 },
        { strong: 0.2, weak: 0, ticks: 400 },
        { strong: 0.3, weak: 0, ticks: 5 },
      ],
    });
    expect(defined(name)).toEqual({
      segments: [
        { strong: 0.1, weak: 0, ticks: 400 },
        { strong: 0.2, weak: 0, ticks: 200 },
      ],
      throttleTicks: 0,
      ticks: 600,
    });

    const huge = unique('cap-one');
    defineHaptic(huge, { segments: [{ strong: 1, weak: 0, ticks: 1e9 }] });
    expect(defined(huge).ticks).toBe(600);
    expect(defined(huge).segments[0]?.ticks).toBe(600);

    const exact = unique('cap-exact');
    defineHaptic(exact, {
      segments: [
        { strong: 0.1, weak: 0, ticks: 600 },
        { strong: 0.2, weak: 0, ticks: 1 },
      ],
    });
    expect(defined(exact).segments).toEqual([{ strong: 0.1, weak: 0, ticks: 600 }]);
  });

  test('throttleTicks is floored, minimum 0, non-finite 0', () => {
    const cases: [unknown, number][] = [
      [undefined, 0],
      [2.7, 2],
      [-5, 0],
      [-0.5, 0],
      [NaN, 0],
      [Infinity, 0],
      [20, 20],
    ];
    for (const [input, expected] of cases) {
      const name = unique('throttle');
      defineHaptic(name, junk({ segments: [{ strong: 0, weak: 0.1, ticks: 1 }], throttleTicks: input }));
      expect(defined(name).throttleTicks).toBe(expected);
    }
  });

  test('malformed content does not throw', () => {
    const shapes: unknown[] = [
      {},
      { segments: null },
      { segments: 'not an array' },
      { segments: [null, 3, 'x', { strong: '1', weak: {}, ticks: '4' }] },
      null,
    ];
    for (const shape of shapes) {
      const name = unique('malformed');
      expect(() => defineHaptic(name, junk(shape))).not.toThrow();
      expect(defined(name).ticks).toBe(0);
    }
  });

  test('resolved cues are frozen copies, detached from the spec and stripped of extra keys', () => {
    const name = unique('frozen');
    const segment = { strong: 0.4, weak: 0.2, ticks: 3, extra: 'dropped' };
    const segments = [segment];
    defineHaptic(name, { segments });
    segment.strong = 1;
    segments.push({ strong: 1, weak: 1, ticks: 50, extra: '' });

    const cue = defined(name);
    expect(cue.segments).toEqual([{ strong: 0.4, weak: 0.2, ticks: 3 }]);
    expect(Object.keys(cue.segments[0] ?? {}).sort()).toEqual(['strong', 'ticks', 'weak']);
    expect(Object.isFrozen(cue)).toBe(true);
    expect(Object.isFrozen(cue.segments)).toBe(true);
    expect(Object.isFrozen(cue.segments[0])).toBe(true);
  });
});

describe('registry', () => {
  test('an unknown name resolves to undefined', () => {
    expect(getHaptic(unique('never-defined'))).toBeUndefined();
  });

  test('a duplicate name replaces, like defineSound', () => {
    const name = unique('replace');
    defineHaptic(name, { segments: [{ strong: 0.1, weak: 0.1, ticks: 2 }], throttleTicks: 4 });
    const before = defined(name);
    defineHaptic(name, { segments: [{ strong: 0.9, weak: 0, ticks: 9 }] });
    expect(defined(name)).toEqual({
      segments: [{ strong: 0.9, weak: 0, ticks: 9 }],
      throttleTicks: 0,
      ticks: 9,
    });
    // The earlier resolution is untouched — a voice holding it keeps playing it.
    expect(before.ticks).toBe(2);
    expect(hapticNames().filter((n) => n === name)).toHaveLength(1);
  });

  test('hapticNames lists defined names and is a snapshot', () => {
    const name = unique('listed');
    defineHaptic(name, { segments: [{ strong: 0, weak: 0.1, ticks: 1 }] });
    const names = hapticNames();
    expect(names).toContain(name);
    const later = unique('later');
    defineHaptic(later, { segments: [{ strong: 0, weak: 0.1, ticks: 1 }] });
    expect(names).not.toContain(later);
  });
});

/* ------------------------------------------------------------------ */
/* Floor cues                                                          */
/* ------------------------------------------------------------------ */

type Row = readonly [strong: number, weak: number, ticks: number];

/** The brief's table, transcribed independently of the module. */
const FLOOR: Readonly<Record<string, { rows: readonly Row[]; throttleTicks: number }>> = {
  graze: { rows: [[0, 0.18, 5]], throttleTicks: 20 },
  death: {
    rows: [
      [1.0, 0.8, 8],
      [0.7, 0.5, 8],
      [0.4, 0.25, 10],
      [0.18, 0.1, 10],
    ],
    throttleTicks: 0,
  },
  bomb: {
    rows: [
      [0.75, 0.55, 6],
      [0.5, 0.35, 14],
      [0.3, 0.2, 20],
    ],
    throttleTicks: 0,
  },
  extend: {
    rows: [
      [0, 0.5, 4],
      [0, 0, 5],
      [0, 0.5, 4],
    ],
    throttleTicks: 0,
  },
  'boss-arrive': {
    rows: [
      [0.12, 0, 12],
      [0.22, 0, 12],
      [0.32, 0.05, 12],
      [0.4, 0.08, 12],
      [0.22, 0.04, 9],
      [0.1, 0, 9],
    ],
    throttleTicks: 0,
  },
  'boss-phase': {
    rows: [
      [0.2, 0.35, 4],
      [0.08, 0.15, 6],
    ],
    throttleTicks: 0,
  },
  'boss-break': {
    rows: [
      [0.3, 0.6, 5],
      [0.1, 0.25, 8],
    ],
    throttleTicks: 0,
  },
  'boss-defeat': {
    rows: [
      [1.0, 1.0, 10],
      [0.75, 0.6, 14],
      [0.5, 0.35, 18],
      [0.28, 0.15, 20],
      [0.12, 0.05, 18],
    ],
    throttleTicks: 0,
  },
  clear: {
    rows: [
      [0.35, 0.35, 8],
      [0, 0, 4],
      [0.5, 0.5, 10],
      [0.2, 0.2, 10],
    ],
    throttleTicks: 0,
  },
  'ui-test': { rows: [[0.5, 0.5, 8]], throttleTicks: 0 },
};

describe('floor cues', () => {
  test('all ten are registered', () => {
    const names = hapticNames();
    for (const name of Object.keys(FLOOR)) expect(names).toContain(name);
    expect(Object.keys(FLOOR)).toHaveLength(10);
  });

  for (const [name, { rows, throttleTicks }] of Object.entries(FLOOR)) {
    test(`${name} matches the table exactly`, () => {
      const segments = rows.map(([strong, weak, ticks]) => ({ strong, weak, ticks }));
      const ticks = rows.reduce((sum, [, , t]) => sum + t, 0);
      expect(defined(name)).toEqual({ segments, throttleTicks, ticks });
    });
  }

  test('the cap rule: cues that fire while the player is vulnerable keep strong <= 0.35', () => {
    for (const name of ['graze', 'extend', 'boss-phase', 'boss-break']) {
      const cue = defined(name);
      expect(cue.ticks).toBeGreaterThan(0);
      for (const seg of cue.segments) expect(seg.strong).toBeLessThanOrEqual(0.35);
    }
  });

  test('graze is weak-motor only and at most 3 starts a second', () => {
    const graze = defined('graze');
    for (const seg of graze.segments) expect(seg.strong).toBe(0);
    expect(60 / graze.throttleTicks).toBeLessThanOrEqual(3);
  });
});
