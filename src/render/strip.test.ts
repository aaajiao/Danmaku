/**
 * The frame clock, proved pure and integer.
 *
 * `stripFrame`/`stripLength`/`stripDone` decide which frame an animation shows
 * from a run-relative tick clock and nothing else. The tests below pin the two
 * playback modes (a loop wraps, a one-shot clamps), the degenerate static case
 * (`frames: 1` is always frame 0), and — the one that earns its place — the
 * COUPLING between a one-shot effect's `life` and its strip's `stripLength`.
 *
 * That coupling cannot be typed: `sim/effects.ts` may not import `render`, so it
 * cannot call `stripLength`, and the effect's `life` is a hand-written literal.
 * This file re-derives the length from `FX_STRIPS` and asserts the literal
 * matches — the "measure, don't type" discipline the damage model uses, applied
 * to frame length. A drift here means a frame-animated explosion would freeze on
 * its last frame and linger, or die mid-animation — silently, since no other
 * test drives a real framebuffer.
 */

import { describe, expect, test } from 'bun:test';

import type { Strip } from './atlas';
import { stripDone, stripFrame, stripLength } from './strip';
import { FX_STRIPS, FX_CELLS, BULLET_CELLS } from './procedural';
import { effectNames, getEffectSpec } from '../sim/effects';

function strip(over: Partial<Strip>): Strip {
  return {
    x: 0,
    y: 0,
    frameW: 32,
    frameH: 32,
    frames: 1,
    stride: 32,
    ticksPerFrame: 1,
    mode: 'once',
    color: 'tinted',
    ...over,
  };
}

describe('stripFrame', () => {
  test('a static cell (frames === 1) is always frame 0', () => {
    const s = strip({ frames: 1, ticksPerFrame: 1 });
    for (const clock of [0, 1, 5, 100, 99999]) {
      expect(stripFrame(s, clock)).toBe(0);
    }
  });

  test('a one-shot clamps at the last frame', () => {
    const s = strip({ frames: 4, ticksPerFrame: 3, mode: 'once' });
    // frame = floor(clock / 3), clamped to 3.
    expect(stripFrame(s, 0)).toBe(0);
    expect(stripFrame(s, 2)).toBe(0);
    expect(stripFrame(s, 3)).toBe(1);
    expect(stripFrame(s, 8)).toBe(2);
    expect(stripFrame(s, 9)).toBe(3);
    expect(stripFrame(s, 11)).toBe(3);
    expect(stripFrame(s, 10_000)).toBe(3); // never past the last frame
  });

  test('a loop wraps modulo the frame count', () => {
    const s = strip({ frames: 4, ticksPerFrame: 2, mode: 'loop' });
    // step = floor(clock / 2), frame = step % 4.
    expect(stripFrame(s, 0)).toBe(0);
    expect(stripFrame(s, 2)).toBe(1);
    expect(stripFrame(s, 6)).toBe(3);
    expect(stripFrame(s, 8)).toBe(0); // wrapped
    expect(stripFrame(s, 10)).toBe(1);
  });

  test('the frame is a pure function of the clock — no hidden state', () => {
    const s = strip({ frames: 6, ticksPerFrame: 4, mode: 'loop' });
    // Same clock, same frame, regardless of call order or history.
    const a = [0, 40, 12, 40, 0].map((c) => stripFrame(s, c));
    expect(a).toEqual([0, 4, 3, 4, 0]);
  });
});

describe('stripLength / stripDone', () => {
  test('length is frames × ticksPerFrame', () => {
    expect(stripLength(strip({ frames: 8, ticksPerFrame: 3 }))).toBe(24);
    expect(stripLength(strip({ frames: 1, ticksPerFrame: 1 }))).toBe(1);
  });

  test('a one-shot is done exactly when its last frame finishes', () => {
    const s = strip({ frames: 4, ticksPerFrame: 3, mode: 'once' });
    expect(stripDone(s, stripLength(s) - 1)).toBe(false);
    expect(stripDone(s, stripLength(s))).toBe(true);
    expect(stripDone(s, stripLength(s) + 5)).toBe(true);
  });

  test('a loop never finishes', () => {
    const s = strip({ frames: 4, ticksPerFrame: 3, mode: 'loop' });
    expect(stripDone(s, 0)).toBe(false);
    expect(stripDone(s, 1_000_000)).toBe(false);
  });
});

describe('the effect/strip life coupling (measured, not typed)', () => {
  // A count:1, speed:0 particle whose sprite is a `once` fx strip must set its
  // `life` to the strip's `stripLength`, so the single particle dies exactly as
  // its last frame finishes (CLAUDE.md rule 8 — no completion flag). This is the
  // guard against a freeze-then-linger or a die-mid-animation drift.
  const singleShotStripEffects = effectNames().filter((name) => {
    const spec = getEffectSpec(name);
    const geo = FX_STRIPS[spec.sprite];
    return (
      geo !== undefined && geo.mode === 'once' && spec.count === 1 && spec.speed === 0
    );
  });

  test('burst, burst.big and the three missile.pop tiers are covered by this guard', () => {
    // The 导弹轮 tiers join burst/burst.big: each is a count:1, speed:0 particle on
    // a `once` fx strip, so its `life` must equal its strip's `stripLength` or the
    // airburst freeze-then-lingers (or dies mid-animation) — the same coupling,
    // now measured over the missile detonations the content stage fires.
    expect(singleShotStripEffects.sort()).toEqual(
      ['burst', 'burst.big', 'missile.pop.big', 'missile.pop.mid', 'missile.pop.tiny'].sort(),
    );
  });

  test.each(singleShotStripEffects)('%s: life === stripLength(strip)', (name) => {
    const spec = getEffectSpec(name);
    const geo = FX_STRIPS[spec.sprite]!;
    const length = stripLength(
      strip({ frames: geo.frames, ticksPerFrame: geo.ticksPerFrame, mode: geo.mode }),
    );
    expect(spec.life).toBe(length);
  });
});

/**
 * The wall-clock ban, applied to the frame clock — the analogue of
 * `backgrounds/index.test.ts`'s scan for the scenes. Animation phase can never
 * regress onto `performance.now`, a rAF timestamp, or the program-global
 * `loop.count`: any of those desyncs a looping strip's phase from a replay
 * visually while every other test stays green (CLAUDE.md rule 1's class of bug,
 * and the grafted run-relative-age rule).
 */
describe('the frame clock never reads a wall clock or loop.count', () => {
  const WALL = ['Date.now', 'performance.now', 'new Date', 'requestAnimationFrame', 'setTimeout', 'setInterval'];

  const codeLines = async (url: URL): Promise<string[]> => {
    const source = await Bun.file(url).text();
    return source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'));
  };

  test('render/strip.ts contains no wall-clock source and no loop.count', async () => {
    const code = await codeLines(new URL('./strip.ts', import.meta.url));
    const offences: string[] = [];
    for (const token of [...WALL, 'loop.count']) {
      if (code.some((line) => line.includes(token))) offences.push(token);
    }
    expect(offences).toEqual([]);
  });

  test('every stripFrame call in the shell clocks off an entity .age', async () => {
    // The fx/bullet/item draw seams select frames with `stripFrame(strip, X)`.
    // X must be a run-relative entity age (`p.age`, `b.age`, `item.age`) — never
    // `loop.count`, never a wall clock. Proven by reading the real call sites.
    const source = await Bun.file(new URL('../main.ts', import.meta.url)).text();
    const calls = [...source.matchAll(/stripFrame\(\s*[A-Za-z0-9_]+\s*,\s*([^)]+)\)/g)].map((m) =>
      (m[1] ?? '').trim(),
    );
    expect(calls.length).toBeGreaterThan(0);
    const bad = calls.filter((arg) => !/\.age$/.test(arg));
    expect(bad).toEqual([]);
  });
});

/**
 * Two-batch routing: the shell routes a particle by which atlas owns its sprite
 * (`fxAtlas.has(sprite)`), and a batch is bound to exactly one texture. So every
 * effect sprite must resolve on EXACTLY ONE of the two name sets — the fx sheet
 * (`FX_CELLS`) or the bullet sheet (`BULLET_CELLS`). A sprite in neither would
 * throw in the draw loop the first frame it is emitted; a sprite in both would
 * be ambiguous. This is the arithmetic half of the check (the real atlases need
 * a canvas, judged on `test:assets`), and it is why `burst`/`burst.big` live on
 * the fx sheet and the small particles stay on the bullet sheet.
 */
describe('every effect sprite resolves on exactly one atlas', () => {
  const fx = new Set<string>(FX_CELLS);
  const bullet = new Set<string>(BULLET_CELLS as readonly string[]);

  test('the two name sets are disjoint', () => {
    const overlap = [...fx].filter((n) => bullet.has(n));
    expect(overlap).toEqual([]);
  });

  test.each([...effectNames()])('%s draws from exactly one sheet', (name) => {
    const sprite = getEffectSpec(name).sprite;
    const onFx = fx.has(sprite);
    const onBullet = bullet.has(sprite);
    // XOR: in exactly one set. Neither → throws in the draw loop; both → ambiguous.
    expect(`${sprite}: exactly-one=${onFx !== onBullet}`).toBe(`${sprite}: exactly-one=true`);
  });

  test('burst and burst.big route to the fx sheet, not the bullet sheet', () => {
    for (const name of ['burst', 'burst.big']) {
      const geo = FX_STRIPS[name];
      expect(geo).toBeDefined();
      expect(fx.has(name)).toBe(true);
      expect(bullet.has(name)).toBe(false);
    }
  });
});
