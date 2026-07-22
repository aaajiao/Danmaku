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

  test('burst, burst.big, the missile.pop tiers and the death-explosion tiers are covered by this guard', () => {
    // The 导弹轮 tiers and the 战役扩容轮 death-explosion tiers join burst/burst.big:
    // each is a count:1, speed:0 particle on a `once` fx strip, so its `life` must
    // equal its strip's `stripLength` or the flash freeze-then-lingers (or dies
    // mid-animation) — the same coupling, now measured over the missile detonations
    // and the elite/boss/player booms the death sites fire. `debris` is NOT here:
    // it is a `loop`, `count > 1` ember, so a loop-never-finishes strip carries no
    // `life === stripLength` coupling.
    expect(singleShotStripEffects.sort()).toEqual(
      [
        'boom.boss.back',
        'boom.boss.top',
        'boom.elite',
        'boom.elite.spray',
        'boom.player',
        'burst',
        'burst.big',
        'missile.pop.big',
        'missile.pop.mid',
        'missile.pop.tiny',
      ].sort(),
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
    // `loop.count`, never a wall clock. The `drawStrip` helper (asset-fidelity
    // round) centralises the clock, so its own parameter `age` — fed an entity
    // `.age` at every call site — is the one legal bare identifier; a wall clock
    // or `loop.count` reaching it is still caught here. The complementary hole — a
    // surface that makes NO `stripFrame` call at all (the exact way the freeze
    // shipped) — is closed by the no-bare-name scan below. Proven by reading the
    // real call sites.
    const source = await Bun.file(new URL('../main.ts', import.meta.url)).text();
    const calls = [...source.matchAll(/stripFrame\(\s*[A-Za-z0-9_]+\s*,\s*([^)]+)\)/g)].map((m) =>
      (m[1] ?? '').trim(),
    );
    expect(calls.length).toBeGreaterThan(0);
    const bad = calls.filter((arg) => !/\.age$/.test(arg) && arg !== 'age');
    expect(bad).toEqual([]);
  });

  test('every drawStrip call in the shell feeds an entity .age as its clock argument', async () => {
    // `drawStrip` CENTRALISES the frame clock — its body calls `stripFrame(s, age)`,
    // so the scan above sees only the bare `age` parameter and is BLIND to what each
    // call site actually feeds it. This closes that hole at the new choke point:
    // every `drawStrip(batch, atlas, x, y, name, age, …)` call must pass a
    // run-relative entity `.age` as its 6th positional argument — never `loop.count`,
    // never a wall clock. Without this a call site could feed `loop.count` to
    // drawStrip and BOTH guards would miss it (the stripFrame scan sees the
    // centralised bare `age`; the no-bare-name scan checks only the sprite-NAME arg).
    // Strip comment lines first (via the same `codeLines` helper the wall-clock
    // scan uses), so a `drawStrip(…)` written inside a `//` example comment — the
    // latent-ship note does exactly that — is not mistaken for a real call site.
    const src = (await codeLines(new URL('../main.ts', import.meta.url))).join('\n');
    // The 6th positional argument of every drawStrip CALL (not the `function
    // drawStrip` declaration), splitting the argument list at TOP-LEVEL commas so a
    // nested `{ … }` style object or a `(a ?? b)` expression does not miscount — the
    // same depth-aware discipline the no-bare-name extractor below uses.
    const clockArgs = (source: string): string[] => {
      const out: string[] = [];
      const head = /\bdrawStrip\(/g;
      let m: RegExpExecArray | null;
      while ((m = head.exec(source)) !== null) {
        // Skip the `function drawStrip(` declaration; only calls carry a clock.
        if (source.slice(Math.max(0, m.index - 9), m.index).endsWith('function ')) continue;
        const args: string[] = [];
        let depth = 1;
        let cur = '';
        for (let i = head.lastIndex; i < source.length && depth > 0; i++) {
          const c = source[i]!;
          if (depth === 1 && c === ',') {
            args.push(cur.trim());
            cur = '';
            continue;
          }
          if (c === '(' || c === '[' || c === '{') depth++;
          else if (c === ')' || c === ']' || c === '}') {
            depth--;
            if (depth === 0) {
              args.push(cur.trim());
              break;
            }
          }
          cur += c;
        }
        out.push(args[5] ?? ''); // 6th positional arg — the `age` clock
      }
      return out;
    };
    const clocks = clockArgs(src);
    expect(clocks.length).toBeGreaterThan(0);
    const bad = clocks.filter((arg) => !/\.age$/.test(arg));
    expect(bad).toEqual([]);
  });
});

/**
 * No animated entity surface draws by BARE NAME — the exact blindness that
 * shipped the freeze.
 *
 * A bare-name draw — `batch.draw(x, y, someSpec.sprite, …)` — resolves
 * `atlas.get(name)` = frame 0 forever, so a multi-frame strip never advances.
 * That is what froze `clerk`/`hunter`/`ray` (enemy bodies) and `big-power` (a
 * bullet-atlas item). The fix routes every animated entity surface through
 * `drawStrip`, which resolves the frame off the entity's `.age`.
 *
 * The `stripFrame`-argument scan above is BLIND to a surface that makes no
 * `stripFrame` call at all — precisely how the bug shipped. This scan closes that
 * hole: it reads every `.draw(` call in the shell and fails if a bare sprite NAME
 * (a `.sprite` expression) reaches one that is not a documented-latent exemption.
 *
 * Exempt, keyed `<receiver>|<third-arg>`, each because it has no run-relative age
 * to clock from — animating it would be dishonest, not merely deferred:
 *  - `batches.options|optionSpec.sprite` — `Option` carries no `.age` (a sim
 *    change is needed first),
 *  - `batches.player|ship.sprite` — a 1-frame procedural silhouette,
 *  - `batch|b.style.sprite` — the legacy beam-body fallback, a length-driven
 *    stretched quad (Law of Geometry excludes laser bodies; Law of Animation
 *    routes the cap, not the body).
 */
describe('no animated entity surface draws by bare name (the shipped blindness)', () => {
  // Depth-aware extractor: for every `<receiver>.draw(` in the source, return the
  // receiver and the third positional argument (the sprite source), splitting the
  // argument list at TOP-LEVEL commas so a nested `Math.cos(a)` or `{ … }` option
  // object does not confuse the count. `drawStrip(` is not a `.draw(` call, so the
  // routed sites are correctly invisible to this scan.
  const drawCalls = (src: string): { receiver: string; third: string }[] => {
    const out: { receiver: string; third: string }[] = [];
    const head = /([\w.]+)\.draw\(/g;
    let m: RegExpExecArray | null;
    while ((m = head.exec(src)) !== null) {
      const args: string[] = [];
      let depth = 1;
      let cur = '';
      for (let i = head.lastIndex; i < src.length && depth > 0; i++) {
        const c = src[i]!;
        if (depth === 1 && c === ',') {
          args.push(cur.trim());
          cur = '';
          continue;
        }
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') {
          depth--;
          if (depth === 0) {
            args.push(cur.trim());
            break;
          }
        }
        cur += c;
      }
      out.push({ receiver: m[1] ?? '', third: args[2] ?? '' });
    }
    return out;
  };

  const bareName = (calls: { receiver: string; third: string }[]) =>
    calls.filter((c) => /\.sprite$/.test(c.third));

  const EXEMPT = new Set([
    'batches.options|optionSpec.sprite', // Option has no .age
    'batches.player|ship.sprite', // 1-frame procedural ship
    'batch|b.style.sprite', // legacy beam-body fallback (length-driven)
  ]);

  test('the extractor flags a pre-fix bare-name enemy draw (non-vacuous)', () => {
    // The exact shape main.ts shipped, that froze the enemy strip at frame 0.
    const preFix = `batches.enemies.draw(e.x, e.y, e.spec.sprite, { rotation: e.angle });`;
    const bad = bareName(drawCalls(preFix));
    expect(bad).toEqual([{ receiver: 'batches.enemies', third: 'e.spec.sprite' }]);
    // And it is NOT exempt, so the real assertion below would fail on it.
    expect(EXEMPT.has(`${bad[0]!.receiver}|${bad[0]!.third}`)).toBe(false);
  });

  test('the multi-line legacy-beam draw parses to its third arg despite nested parens', () => {
    const beam =
      `batch.draw(\n` +
      `  b.x + half * Math.cos(b.angle),\n` +
      `  b.y + half * Math.sin(b.angle),\n` +
      `  b.style.sprite,\n` +
      `  { rotation: b.angle },\n` +
      `);`;
    expect(bareName(drawCalls(beam))).toEqual([{ receiver: 'batch', third: 'b.style.sprite' }]);
  });

  test('every bare-name entity draw in main.ts is a documented-latent exemption', async () => {
    const src = await Bun.file(new URL('../main.ts', import.meta.url)).text();
    const offenders = bareName(drawCalls(src))
      .map((c) => `${c.receiver}|${c.third}`)
      .filter((key) => !EXEMPT.has(key));
    expect(offenders).toEqual([]);
  });

  test('the frozen surfaces are actually routed through drawStrip (non-vacuous)', async () => {
    const src = await Bun.file(new URL('../main.ts', import.meta.url)).text();
    // Proof the routing landed: the batches that carried the frozen strips are now
    // passed to drawStrip, not bare-name drawn. (enemies = enemy + boss bodies.)
    expect(/drawStrip\(\s*batches\.enemies\b/.test(src)).toBe(true);
    expect(/drawStrip\(\s*batches\.items\b/.test(src)).toBe(true); // big-power item
    expect(/drawStrip\(\s*batches\.pickups\b/.test(src)).toBe(true); // coins/gems
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
