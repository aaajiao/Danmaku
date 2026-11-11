import { describe, expect, test } from 'bun:test';

import { defineHaptic, getHaptic, type HapticSegment } from './index';
import { HapticMixer } from './mixer';

/** Namespaced, never reused: the registry is shared across test files. */
const NS = 'test:haptics.mixer.test/';

let nextName = 0;
function cue(segments: readonly HapticSegment[], throttleTicks?: number): string {
  const name = `${NS}${nextName++}`;
  defineHaptic(name, throttleTicks === undefined ? { segments } : { segments, throttleTicks });
  return name;
}

/** Step `n` times and copy each result out — the mixer reuses its return object. */
function run(mixer: HapticMixer, n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const level = mixer.step();
    out.push([level.strong, level.weak]);
  }
  return out;
}

describe('a single cue', () => {
  test('contributes from the next step, for exactly its total ticks, segment by segment', () => {
    const name = cue([
      { strong: 0.5, weak: 0.1, ticks: 2 },
      { strong: 0, weak: 0, ticks: 1 },
      { strong: 0.2, weak: 0.9, ticks: 3 },
    ]);
    const mixer = new HapticMixer();
    // Nothing is felt before play, and play itself emits nothing.
    expect(run(mixer, 2)).toEqual([
      [0, 0],
      [0, 0],
    ]);
    expect(mixer.active).toBe(false);
    expect(mixer.play(name)).toBe(true);
    expect(mixer.active).toBe(true);

    expect(run(mixer, 6)).toEqual([
      [0.5, 0.1],
      [0.5, 0.1],
      [0, 0],
      [0.2, 0.9],
      [0.2, 0.9],
      [0.2, 0.9],
    ]);
    // The voice ends on its sixth step, not one later.
    expect(mixer.active).toBe(false);
    expect(run(mixer, 1)).toEqual([[0, 0]]);
  });

  test('a floor cue plays its registered envelope tick for tick', () => {
    const mixer = new HapticMixer();
    expect(mixer.play('extend')).toBe(true);
    const expected: [number, number][] = [
      ...Array.from({ length: 4 }, (): [number, number] => [0, 0.5]),
      ...Array.from({ length: 5 }, (): [number, number] => [0, 0]),
      ...Array.from({ length: 4 }, (): [number, number] => [0, 0.5]),
    ];
    expect(run(mixer, 13)).toEqual(expected);
    expect(mixer.active).toBe(false);
  });

  test('a voice keeps the cue it started with when the name is redefined', () => {
    const name = cue([{ strong: 0.3, weak: 0, ticks: 3 }]);
    const mixer = new HapticMixer();
    mixer.play(name);
    defineHaptic(name, { segments: [{ strong: 1, weak: 1, ticks: 1 }] });
    expect(run(mixer, 4)).toEqual([
      [0.3, 0],
      [0.3, 0],
      [0.3, 0],
      [0, 0],
    ]);
  });
});

describe('mixing', () => {
  test('overlapping voices combine as per-channel MAX, not a sum', () => {
    const a = cue([{ strong: 0.6, weak: 0.1, ticks: 4 }]);
    const b = cue([
      { strong: 0.2, weak: 0.7, ticks: 2 },
      { strong: 0.9, weak: 0, ticks: 2 },
    ]);
    const mixer = new HapticMixer();
    mixer.play(a);
    expect(run(mixer, 1)).toEqual([[0.6, 0.1]]);
    mixer.play(b);
    expect(run(mixer, 5)).toEqual([
      [0.6, 0.7],
      [0.6, 0.7],
      [0.9, 0.1],
      [0.9, 0],
      [0, 0],
    ]);
  });

  test('the same cue twice overlaps itself when it has no throttle', () => {
    const name = cue([
      { strong: 0.8, weak: 0, ticks: 1 },
      { strong: 0.1, weak: 0, ticks: 2 },
    ]);
    const mixer = new HapticMixer();
    mixer.play(name);
    run(mixer, 1);
    expect(mixer.play(name)).toBe(true);
    expect(run(mixer, 3)).toEqual([
      [0.8, 0],
      [0.1, 0],
      [0.1, 0],
    ]);
  });
});

describe('gain', () => {
  test('scales the mixed level in step(), and applies to voices already playing', () => {
    const name = cue([{ strong: 0.8, weak: 0.4, ticks: 3 }]);
    const mixer = new HapticMixer();
    expect(mixer.gain).toBe(1);
    mixer.play(name);
    expect(run(mixer, 1)).toEqual([[0.8, 0.4]]);
    mixer.gain = 0.5;
    expect(run(mixer, 1)).toEqual([[0.4, 0.2]]);
    mixer.gain = 0;
    expect(run(mixer, 1)).toEqual([[0, 0]]);
    // Gain 0 silences output but does not stop the voice clock.
    expect(mixer.active).toBe(false);
  });

  test('is clamped on set', () => {
    const mixer = new HapticMixer();
    const cases: [number, number][] = [
      [2, 1],
      [-1, 0],
      [Infinity, 1],
      [-Infinity, 0],
      [NaN, 0],
      [0.25, 0.25],
    ];
    for (const [input, expected] of cases) {
      mixer.gain = input;
      expect(mixer.gain).toBe(expected);
    }
  });
});

describe('throttle', () => {
  test('is measured in mixer ticks, which only step() advances', () => {
    const name = cue([{ strong: 0, weak: 0.2, ticks: 1 }], 3);
    const mixer = new HapticMixer();
    expect(mixer.play(name)).toBe(true);
    // Any number of plays between two steps is the same tick.
    expect(mixer.play(name)).toBe(false);
    expect(mixer.play(name)).toBe(false);
    run(mixer, 2);
    expect(mixer.play(name)).toBe(false); // 2 ticks after the start
    run(mixer, 1);
    expect(mixer.play(name)).toBe(true); // exactly 3: not "closer than 3"
    run(mixer, 2);
    expect(mixer.play(name)).toBe(false); // measured from the accepted start, not the drop
    run(mixer, 1);
    expect(mixer.play(name)).toBe(true);
  });

  test('a throttled play changes nothing', () => {
    const name = cue([{ strong: 0.3, weak: 0, ticks: 2 }], 10);
    const mixer = new HapticMixer({ voices: 1 });
    mixer.play(name);
    run(mixer, 1);
    expect(mixer.play(name)).toBe(false);
    // The original voice was not restarted: one tick left, then silence.
    expect(run(mixer, 2)).toEqual([
      [0.3, 0],
      [0, 0],
    ]);
  });

  test('clear() keeps the throttle clocks and the tick counter', () => {
    const name = cue([{ strong: 0, weak: 0.2, ticks: 5 }], 4);
    const mixer = new HapticMixer();
    mixer.play(name);
    run(mixer, 1);
    mixer.clear();
    expect(mixer.play(name)).toBe(false);
    run(mixer, 2);
    mixer.clear();
    expect(mixer.play(name)).toBe(false);
    run(mixer, 1);
    expect(mixer.play(name)).toBe(true);
  });

  test('is per cue name: one cue throttled does not block another', () => {
    const a = cue([{ strong: 0, weak: 0.2, ticks: 1 }], 100);
    const b = cue([{ strong: 0, weak: 0.3, ticks: 1 }], 100);
    const mixer = new HapticMixer();
    expect(mixer.play(a)).toBe(true);
    expect(mixer.play(a)).toBe(false);
    expect(mixer.play(b)).toBe(true);
  });

  test('the floor graze cue starts at most 3 times a second however dense the grazing', () => {
    const mixer = new HapticMixer();
    let starts = 0;
    let buzzing = 0;
    // A graze every tick for one second — far denser than real play.
    for (let t = 0; t < 60; t++) {
      if (mixer.play('graze')) starts++;
      if (mixer.step().weak > 0) buzzing++;
    }
    expect(starts).toBe(3);
    expect(buzzing).toBe(15); // 3 × 5 ticks: 25% duty, not a 50% buzz
  });
});

describe('voices', () => {
  test('when full, the OLDEST voice is stolen', () => {
    const a = cue([{ strong: 0.9, weak: 0, ticks: 10 }]);
    const b = cue([{ strong: 0.5, weak: 0.1, ticks: 10 }]);
    const c = cue([{ strong: 0.2, weak: 0.6, ticks: 10 }]);
    const mixer = new HapticMixer({ voices: 2 });
    mixer.play(a);
    mixer.play(b);
    expect(run(mixer, 1)).toEqual([[0.9, 0.1]]);
    expect(mixer.play(c)).toBe(true);
    // `a` (strong 0.9) is gone; b and c remain.
    expect(run(mixer, 1)).toEqual([[0.5, 0.6]]);
    // The next steal takes `b`, now the oldest — not `c`, the newest.
    const d = cue([{ strong: 0, weak: 0, ticks: 10 }]);
    mixer.play(d);
    expect(run(mixer, 1)).toEqual([[0.2, 0.6]]);
  });

  test('a freed slot is reused before anything is stolen', () => {
    const short = cue([{ strong: 0.1, weak: 0, ticks: 1 }]);
    const long = cue([{ strong: 0.7, weak: 0, ticks: 10 }]);
    const other = cue([{ strong: 0, weak: 0.4, ticks: 10 }]);
    const mixer = new HapticMixer({ voices: 2 });
    mixer.play(long);
    mixer.play(short);
    run(mixer, 1); // `short` ends here, freeing its slot
    mixer.play(other);
    expect(run(mixer, 1)).toEqual([[0.7, 0.4]]);
  });

  test('a nonsensical voice count falls back sanely', () => {
    const name = cue([{ strong: 0.4, weak: 0, ticks: 2 }]);
    for (const voices of [0, -3, NaN, 0.5]) {
      const mixer = new HapticMixer({ voices });
      expect(mixer.play(name)).toBe(true);
      expect(run(mixer, 1)).toEqual([[0.4, 0]]);
    }
  });
});

describe('clear and unknown cues', () => {
  test('clear() drops every voice at once', () => {
    const a = cue([{ strong: 0.5, weak: 0, ticks: 10 }]);
    const b = cue([{ strong: 0, weak: 0.5, ticks: 10 }]);
    const mixer = new HapticMixer();
    mixer.play(a);
    mixer.play(b);
    run(mixer, 3);
    mixer.clear();
    expect(mixer.active).toBe(false);
    expect(run(mixer, 1)).toEqual([[0, 0]]);
    // The mixer still plays normally afterwards.
    expect(mixer.play(a)).toBe(true);
    expect(run(mixer, 1)).toEqual([[0.5, 0]]);
  });

  test('an unknown cue returns false and changes nothing', () => {
    const mixer = new HapticMixer();
    expect(mixer.play(`${NS}never-defined`)).toBe(false);
    expect(mixer.active).toBe(false);
    expect(run(mixer, 1)).toEqual([[0, 0]]);
  });

  test('a zero-length cue returns false and does not start its throttle', () => {
    const name = cue([{ strong: 1, weak: 1, ticks: 0 }], 30);
    expect(getHaptic(name)?.ticks).toBe(0);
    const mixer = new HapticMixer();
    expect(mixer.play(name)).toBe(false);
    expect(mixer.active).toBe(false);
    defineHaptic(name, { segments: [{ strong: 0.2, weak: 0, ticks: 1 }], throttleTicks: 30 });
    expect(mixer.play(name)).toBe(true);
  });
});

describe('step() after every voice has ended', () => {
  test('returns the same object at zero, with active false, every time', () => {
    const name = cue([{ strong: 0.7, weak: 0.3, ticks: 2 }]);
    const mixer = new HapticMixer();
    const first = mixer.step();
    mixer.play(name);
    const during = mixer.step();
    expect(during).toBe(first);
    expect(during.strong).toBe(0.7);
    run(mixer, 1);
    expect(mixer.active).toBe(false);

    for (let i = 0; i < 100; i++) {
      const level = mixer.step();
      expect(level).toBe(first);
      expect(level.strong).toBe(0);
      expect(level.weak).toBe(0);
      expect(mixer.active).toBe(false);
    }
    expect(Object.keys(first).sort()).toEqual(['strong', 'weak']);
  });
});

describe('the central guarantee: output is a pure function of play/step/clear/gain', () => {
  /**
   * A mixer that consulted a wall clock, a random source, or the DOM would
   * pass every envelope test above on a quiet machine and still drift against
   * the run it describes. Poisoning all three proves it reads none of them:
   * any call throws, and the test fails.
   */
  test('reads no clock, no randomness, no device, and two mixers driven alike agree exactly', () => {
    const script: readonly (string | null)[] = [
      'boss-arrive',
      null,
      'graze',
      'graze',
      null,
      'extend',
      'death',
      null,
      'graze',
      'bomb',
      'boss-phase',
      null,
      null,
      'boss-break',
      'clear',
    ];

    const poisoned = {
      now: performance.now,
      date: Date.now,
      random: Math.random,
      navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
    };
    const trap = (): never => {
      throw new Error('the mixer read a clock or a random source');
    };
    performance.now = trap;
    Date.now = trap;
    Math.random = trap;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      get: trap,
    });

    const traces: [number, number][][] = [];
    try {
      for (const voices of [8, 8]) {
        const mixer = new HapticMixer({ voices });
        mixer.gain = 0.5;
        const trace: [number, number][] = [];
        for (let t = 0; t < 400; t++) {
          const entry = script[t % script.length];
          if (entry !== null && entry !== undefined && t % 7 === 0) mixer.play(entry);
          if (t === 200) mixer.clear();
          const level = mixer.step();
          trace.push([level.strong, level.weak]);
        }
        traces.push(trace);
      }
    } finally {
      performance.now = poisoned.now;
      Date.now = poisoned.date;
      Math.random = poisoned.random;
      if (poisoned.navigator) Object.defineProperty(globalThis, 'navigator', poisoned.navigator);
      else Reflect.deleteProperty(globalThis, 'navigator');
    }

    expect(traces).toHaveLength(2);
    expect(traces[0]).toEqual(traces[1] ?? []);
    // And the trace is not trivially silent.
    expect((traces[0] ?? []).some(([strong]) => strong > 0)).toBe(true);
  });
});
