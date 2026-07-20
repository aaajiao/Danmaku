/**
 * Density check — the one `docs/assets.md` and `CLAUDE.md` both call for and
 * neither has ever run: "put 500 of them on screen at once ... this is where
 * art that looked beautiful in isolation turns into unreadable soup."
 *
 * Two questions, kept apart because they answer to different judges.
 *
 * **Performance** is automated: drive a real `BulletSystem` through real
 * `content/patterns.ts` emitters up to a target population, then hold it
 * there and measure. "Hold" is doing real work here — the specs below add
 * `bounce: true` (which the shipped content does not use) purely so the
 * count sampled at frame 0 is still the count sampled at frame 149. Without
 * it, bullets drift off-field mid-sample and the harness would be silently
 * measuring some lower, decaying count instead of the number in its own
 * report.
 *
 * **Readability** cannot be automated and this page does not pretend
 * otherwise: it renders a still frame at each density, using the bullet
 * specs the shipped game actually fires (`sim/enemy.ts`'s `ENEMY_SHOT` /
 * `HEAVY_SHOT`, `main.ts`'s player shot — reproduced here since none of the
 * three is exported), and leaves the verdict to whoever is looking at it.
 *
 * ## Why two things here get deliberately broken and re-measured
 *
 * `test/visual/layer-order.ts` sets the bar: a check that has only ever been
 * seen green is not evidence, so it re-runs its measurement with the
 * mechanism it depends on turned off, to prove the PASS above meant
 * something. Two claims below get the same treatment:
 *
 * - "draw calls stay flat" is read from `Stage.stats.calls`. If that counter
 *   were broken — always reporting the batch count regardless of what was
 *   actually drawn — the flat line below would be worthless. So this page
 *   also renders 200 bullets deliberately *unbatched*, one `SpriteBatch` per
 *   bullet, and shows `Stage.stats.calls` climbing to match. It only reports
 *   flat calls as meaningful because it has also shown the same counter is
 *   capable of reporting the opposite.
 * - "SpriteBatch didn't have to grow" is read from `capacity` staying at its
 *   starting value. An off-stage control batch, deliberately started far too
 *   small (64), is fed the same draws and is expected to grow — proving the
 *   growth check can detect growth, not just fail to notice it.
 *
 * ## Running it
 *
 *     bun run test:density
 *     open http://localhost:3008/test/visual/density.html
 *
 * Takes a few seconds: each of the three levels runs a real warm-up and a
 * real 120-frame sampled window. The page prints PASS or FAIL for the
 * automated half, and `window.__densityResult` carries every number plus
 * `pass` and `failures`, for automation.
 *
 * The frame loop does not depend on `requestAnimationFrame` alone — see
 * `nextFrame`. A hidden tab froze rAF and this page hung at "level 1/3"
 * indefinitely, which is a poor failure for something read by hand.
 */

import type { Atlas } from '../../src/render/atlas';
import { createBulletAtlas } from '../../src/render/procedural';
import { SpriteBatch } from '../../src/render/sprite-batch';
import { Layer, Stage } from '../../src/render/stage';
import { Random } from '../../src/core/random';
import { Emitter } from '../../src/content/patterns';
import { BulletSystem, type BulletSpec } from '../../src/sim/bullet';

const FIELD_W = 480;
const FIELD_H = 480;
const MARGIN = 48;
const SEED = 0xd3f5b17;

/** Aim point for the aimed patterns — roughly where the player sits in `main.ts`. */
const TARGET_X = FIELD_W / 2;
const TARGET_Y = FIELD_H - 60;

/** Matches `main.ts`'s real `enemyShots` batch. Growth here would be news. */
const REALISTIC_CAPACITY = 8192;
/** Deliberately too small — the control that proves growth is ever detected at all. */
const CONTROL_CAPACITY = 64;

const WARMUP_FRAMES = 30;
const SAMPLE_FRAMES = 120;

const MUTATION_BATCHES = 200;

/**
 * One shared batch per layer is the whole rendering claim (CLAUDE.md,
 * "Rendering"), so the count is not merely expected to be *flat* across levels
 * — it is expected to be exactly one. Flatness alone would be satisfied by
 * three identically wrong readings.
 */
const EXPECTED_DRAW_CALLS = 1;

/**
 * Yield to the browser between frames without depending on tab visibility.
 *
 * `requestAnimationFrame` does not fire in a hidden or occluded tab, and this
 * page's loop had no other exit: run it in a background tab and it stopped at
 * "running level 1/3" forever, with no error and no timeout. That is a bad
 * failure for a page whose whole job is to be run by hand and read.
 *
 * A `MessageChannel` message is a macrotask that visibility throttling does not
 * touch, so it keeps the loop advancing when rAF is frozen. rAF is still
 * preferred when the tab really is visible, because the stills this page leaves
 * on its canvases should be composited frames.
 */
function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (document.visibilityState === 'visible') {
      requestAnimationFrame(() => resolve());
      return;
    }
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

const LEVELS: readonly { target: number; canvasId: string }[] = [
  { target: 500, canvasId: 'field-500' },
  { target: 2000, canvasId: 'field-2000' },
  { target: 5000, canvasId: 'field-5000' },
];

/* ------------------------------------------------------------------ */
/* Bullet specs — real content, reproduced                             */
/* ------------------------------------------------------------------ */

/**
 * `ENEMY_SHOT` / `HEAVY_SHOT` mirror `sim/enemy.ts` exactly (sprite, tint,
 * motion); `PLAYER_SHOT` mirrors `main.ts`'s `shot`. None of the three is
 * exported from its module, so they are reproduced rather than imported.
 * `bounce: true` is the one addition — see the file header for why.
 */
const ENEMY_SHOT: BulletSpec = {
  style: { sprite: 'orb.small', r: 1, g: 0.45, b: 0.75 },
  radius: 3,
  motion: { r: 2.4, theta: 90 },
  bounce: true,
};

const HEAVY_SHOT: BulletSpec = {
  style: { sprite: 'scale', r: 0.55, g: 0.85, b: 1, orientToHeading: true },
  radius: 4,
  motion: { r: 1.8, theta: 90 },
  bounce: true,
};

const PLAYER_SHOT: BulletSpec = {
  style: { sprite: 'glow.small', r: 0.7, g: 0.95, b: 1 },
  radius: 4,
  motion: { r: 9, theta: 270 },
  bounce: true,
};

/**
 * A dozen emitters across the top edge, running the same four registered
 * patterns the shipped enemies use (`ring`, `spiral`, `aimed-fan`, `spray`),
 * tuned for a fast ramp rather than a playable rate. Fresh instances per
 * level: `Emitter` carries its own age, and reusing one would start a later
 * level mid-pattern.
 */
function buildEmitters(): Emitter[] {
  const emitters: Emitter[] = [];

  for (const [x, spec] of [
    [60, ENEMY_SHOT],
    [180, HEAVY_SHOT],
    [300, ENEMY_SHOT],
    [420, HEAVY_SHOT],
  ] as const) {
    emitters.push(
      new Emitter('ring', x, -20, 'enemy', { spec, count: 24, period: 2, rotation: 9 }),
    );
  }

  for (const [x, spec] of [
    [120, ENEMY_SHOT],
    [240, HEAVY_SHOT],
    [360, ENEMY_SHOT],
  ] as const) {
    emitters.push(new Emitter('spiral', x, -20, 'enemy', { spec, arms: 6, step: 13, period: 1 }));
  }

  emitters.push(
    new Emitter('aimed-fan', 90, -20, 'enemy', { spec: ENEMY_SHOT, count: 10, spread: 50, period: 3 }),
  );
  emitters.push(
    new Emitter('aimed-fan', 390, -20, 'enemy', { spec: PLAYER_SHOT, count: 10, spread: 50, period: 3 }),
  );
  emitters.push(
    new Emitter('spray', 180, -20, 'enemy', { spec: ENEMY_SHOT, count: 10, period: 3, spread: 360 }),
  );
  emitters.push(
    new Emitter('spray', 300, -20, 'enemy', { spec: PLAYER_SHOT, count: 10, period: 3, spread: 360 }),
  );

  return emitters;
}

/**
 * Step real emitters against a real `BulletSystem` until the target
 * population is reached. Bounded, because a misconfigured emitter mix should
 * fail loudly here rather than hang the page.
 */
function rampUp(bullets: BulletSystem, emitters: readonly Emitter[], target: number, rng: Random): void {
  const MAX_TICKS = 4000;
  let ticks = 0;
  while (bullets.count < target && ticks < MAX_TICKS) {
    for (const emitter of emitters) emitter.step(bullets, TARGET_X, TARGET_Y, rng);
    bullets.step(TARGET_X, TARGET_Y, rng);
    ticks++;
  }
  if (bullets.count < target) {
    throw new Error(`ramp-up stalled at ${bullets.count}/${target} bullets after ${ticks} ticks`);
  }
}

/** Trim overshoot from pattern batch granularity so the level is exactly `target`. */
function trimTo(bullets: BulletSystem, target: number): void {
  while (bullets.count > target) {
    const last = bullets.bullets[bullets.bullets.length - 1];
    if (last === undefined) break;
    bullets.despawn(last);
  }
}

/* ------------------------------------------------------------------ */
/* Measurement                                                         */
/* ------------------------------------------------------------------ */

/**
 * Non-black pixels in the current drawing buffer.
 *
 * Must be called immediately after `render()` with no `await` in between: the
 * drawing buffer is not preserved, so the pixels only exist until the browser
 * composites (the same constraint `layer-order.ts` works under).
 */
function countLitPixels(gl: WebGLRenderingContext | WebGL2RenderingContext): number {
  const w = gl.drawingBufferWidth;
  const h = gl.drawingBufferHeight;
  const buffer = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
  let lit = 0;
  for (let i = 0; i < buffer.length; i += 4) {
    if (buffer[i]! > 8 || buffer[i + 1]! > 8 || buffer[i + 2]! > 8) lit++;
  }
  return lit;
}

function median(values: readonly number[]): number {
  return percentile(values, 0.5);
}

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  const value = sorted[index];
  if (value === undefined) throw new Error('percentile of an empty sample');
  return value;
}

interface LevelResult {
  target: number;
  actualCount: number;
  /** Population at every sampled frame — proof the timings are under real load. */
  minSampledCount: number;
  maxSampledCount: number;
  heldPopulation: boolean;
  /** Non-black pixels in the last sampled frame — proof the render rasterised. */
  litPixels: number;
  medianFrameMs: number;
  p90FrameMs: number;
  drawCalls: number;
  triangles: number;
  programs: number;
  batch: { capacity: number; lastRequested: number; grew: boolean };
  growthControl: { initialCapacity: number; finalCapacity: number; lastRequested: number; grew: boolean };
  poolGrowth: number;
  droppedSpawns: number;
}

/**
 * One untimed pass through an off-stage, deliberately undersized batch.
 * Kept out of the timed loop entirely — it exists to prove growth detection
 * fires, not to be part of what "sustained frame time" reports.
 */
function measureGrowthControl(atlas: Atlas, bullets: BulletSystem): LevelResult['growthControl'] {
  const control = new SpriteBatch(atlas, { capacity: CONTROL_CAPACITY, renderOrder: Layer.EnemyShots });
  control.begin();
  for (const b of bullets.bullets) {
    control.draw(b.x, b.y, b.style.sprite, { rotation: b.angle, width: b.style.width, height: b.style.height });
  }
  control.end();

  const result = {
    initialCapacity: CONTROL_CAPACITY,
    finalCapacity: control.capacity,
    lastRequested: control.lastRequested,
    grew: control.capacity > CONTROL_CAPACITY,
  };
  control.dispose();
  return result;
}

async function runLevel(canvas: HTMLCanvasElement, target: number, atlas: Atlas): Promise<LevelResult> {
  // maxPixelRatio: 1 — timing must not depend on the viewing device's DPR.
  const stage = new Stage({ canvas, width: FIELD_W, height: FIELD_H, maxPixelRatio: 1 });
  const batch = new SpriteBatch(atlas, { capacity: REALISTIC_CAPACITY, renderOrder: Layer.EnemyShots });
  stage.add(batch.mesh, 'EnemyShots');

  const bounds = { width: FIELD_W, height: FIELD_H, margin: MARGIN };
  const bullets = new BulletSystem({ bounds, initial: target + 200, max: target + 1000 });
  const rng = new Random(SEED + target);

  rampUp(bullets, buildEmitters(), target, rng);
  trimTo(bullets, target);

  const growthControl = measureGrowthControl(atlas, bullets);

  const frameTimes: number[] = [];
  const gl = stage.renderer.getContext();
  const totalFrames = WARMUP_FRAMES + SAMPLE_FRAMES;

  // The population every sampled frame was actually drawn at. Reading the count
  // once at the end cannot tell a level that held 5000 for the whole window
  // from one that decayed to a handful and happened to finish at 5000 — and a
  // frame time is only worth reporting alongside the load that produced it.
  let minSampled = Infinity;
  let maxSampled = 0;
  let lastFrameCalls = 0;
  let litPixels = 0;

  for (let frame = 0; frame < totalFrames; frame++) {
    const t0 = performance.now();

    bullets.step(TARGET_X, TARGET_Y, rng);

    batch.begin();
    for (const b of bullets.bullets) {
      batch.draw(b.x, b.y, b.style.sprite, {
        rotation: b.angle,
        width: b.style.width,
        height: b.style.height,
        r: b.style.r,
        g: b.style.g,
        b: b.style.b,
        a: b.style.a,
      });
    }
    batch.end();

    stage.render();
    // Force a GPU sync every sampled frame. Skipping this would only time
    // how fast the CPU can enqueue commands — a real cost, but not the one
    // a reallocation stall or a fill-rate cliff shows up in.
    gl.finish();

    const t1 = performance.now();
    if (frame >= WARMUP_FRAMES) {
      frameTimes.push(t1 - t0);
      minSampled = Math.min(minSampled, bullets.count);
      maxSampled = Math.max(maxSampled, bullets.count);
    }

    // Draw calls are read after the loop, so the reading must come from a frame
    // at full population — capture it at the last sampled frame, not from
    // whatever state the renderer is left in.
    //
    // The same frame is read back off the GPU. A frame time is only evidence if
    // the frame was really rasterised, and this page has to be able to run in a
    // hidden tab, where it is fair to ask whether the driver is doing the work
    // at all. Counting lit pixels answers that from the framebuffer rather than
    // from a counter that could agree with a no-op.
    if (frame === totalFrames - 1) {
      lastFrameCalls = stage.stats.calls;
      litPixels = countLitPixels(gl);
    }

    await nextFrame();
  }

  const stats = stage.stats;

  return {
    target,
    actualCount: bullets.count,
    minSampledCount: minSampled,
    maxSampledCount: maxSampled,
    heldPopulation: minSampled === target && maxSampled === target,
    medianFrameMs: median(frameTimes),
    p90FrameMs: percentile(frameTimes, 0.9),
    drawCalls: lastFrameCalls,
    litPixels,
    triangles: stats.triangles,
    programs: stats.programs,
    batch: {
      capacity: batch.capacity,
      lastRequested: batch.lastRequested,
      grew: batch.capacity > REALISTIC_CAPACITY,
    },
    growthControl,
    poolGrowth: bullets.poolGrowth,
    droppedSpawns: bullets.droppedSpawns,
  };
  // Deliberately not disposed: the canvas must keep showing this level's
  // last rendered frame for the readability half below.
}

interface MutationProof {
  batches: number;
  calls: number;
  provesCountersAreReal: boolean;
}

/**
 * The negative control for "draw calls stay flat": render the same handful
 * of bullets through one `SpriteBatch` each instead of one shared batch, and
 * confirm `Stage.stats.calls` climbs with the batch count. If it did not,
 * every flat reading above would be equally consistent with a broken counter.
 */
function proveDrawCallsCanFail(atlas: Atlas): MutationProof {
  const scratch = document.createElement('canvas');
  scratch.width = FIELD_W;
  scratch.height = FIELD_H;
  const stage = new Stage({ canvas: scratch, width: FIELD_W, height: FIELD_H, maxPixelRatio: 1 });

  const batches: SpriteBatch[] = [];
  for (let i = 0; i < MUTATION_BATCHES; i++) {
    const b = new SpriteBatch(atlas, { capacity: 1, renderOrder: Layer.EnemyShots });
    b.begin();
    b.draw(FIELD_W / 2, FIELD_H / 2, 'orb.small', {});
    b.end();
    stage.add(b.mesh, 'EnemyShots');
    batches.push(b);
  }

  stage.render();
  const calls = stage.stats.calls;

  for (const b of batches) b.dispose();
  stage.dispose();

  return { batches: MUTATION_BATCHES, calls, provesCountersAreReal: calls === MUTATION_BATCHES };
}

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

/**
 * Everything the automated half actually asserts.
 *
 * This page reported numbers and no verdict, which meant a level that decayed
 * to a handful of bullets, or a batch that silently reallocated, still printed
 * a clean-looking report that nobody would re-read. The numbers are the point,
 * but they need a line that can say FAIL.
 */
function verdict(
  levels: readonly LevelResult[],
  flatDrawCalls: boolean,
  mutation: MutationProof,
): { pass: boolean; failures: string[] } {
  const failures: string[] = [];

  for (const l of levels) {
    if (!l.heldPopulation) {
      failures.push(
        `${l.target}: population was not held across the sampled window ` +
          `(${l.minSampledCount}..${l.maxSampledCount}) — the frame times below are not ` +
          'measurements of the load they are labelled with',
      );
    }
    if (l.litPixels === 0) {
      failures.push(
        `${l.target}: the last sampled frame read back as entirely black — nothing was ` +
          'rasterised, so the frame times are not measurements of drawing',
      );
    }
    if (l.drawCalls !== EXPECTED_DRAW_CALLS) {
      failures.push(`${l.target}: ${l.drawCalls} draw calls, expected ${EXPECTED_DRAW_CALLS}`);
    }
    if (l.batch.grew) {
      failures.push(`${l.target}: the realistic batch reallocated (capacity ${l.batch.capacity})`);
    }
    if (l.droppedSpawns > 0) {
      failures.push(`${l.target}: ${l.droppedSpawns} spawns dropped — the level never reached its load`);
    }
    // The control must grow, or "the realistic batch did not grow" is unfalsifiable.
    if (!l.growthControl.grew) {
      failures.push(
        `${l.target}: the undersized control batch did not grow, so growth detection is not working`,
      );
    }
  }

  if (!flatDrawCalls) failures.push('draw calls are not flat across levels');
  if (!mutation.provesCountersAreReal) {
    failures.push(
      `${mutation.batches} unbatched sprites reported ${mutation.calls} draw calls — ` +
        'the counter cannot distinguish batched from unbatched, so every flat reading is vacuous',
    );
  }

  return { pass: failures.length === 0, failures };
}

function formatReport(
  levels: readonly LevelResult[],
  flatDrawCalls: boolean,
  mutation: MutationProof,
  result: { pass: boolean; failures: string[] },
): string {
  const lines: string[] = [];

  lines.push(result.pass ? 'PASS' : 'FAIL');
  for (const f of result.failures) lines.push(`  FAIL  ${f}`);
  lines.push('');
  lines.push('PERFORMANCE — automated');
  lines.push(
    `sample window: ${SAMPLE_FRAMES} frames after ${WARMUP_FRAMES} warm-up frames (discarded); ` +
      `each sampled frame is gl.finish()'d before its timestamp`,
  );
  lines.push('');

  for (const l of levels) {
    lines.push(`${l.target} bullets (actual ${l.actualCount})`);
    lines.push(
      `  population   held ${l.heldPopulation} across all ${SAMPLE_FRAMES} sampled frames ` +
        `(min ${l.minSampledCount}, max ${l.maxSampledCount})`,
    );
    lines.push(`  frame time   median ${l.medianFrameMs.toFixed(3)}ms   p90 ${l.p90FrameMs.toFixed(3)}ms`);
    lines.push(`  draw calls   ${l.drawCalls}    triangles ${l.triangles}    programs ${l.programs}`);
    lines.push(`  framebuffer  ${l.litPixels} lit pixels in the last sampled frame`);
    lines.push(
      `  batch        capacity ${l.batch.capacity}  lastRequested ${l.batch.lastRequested}  grew ${l.batch.grew}`,
    );
    lines.push(`  pool         growthCount ${l.poolGrowth}  droppedSpawns ${l.droppedSpawns}`);
    lines.push('');
  }

  lines.push(
    `flat draw calls across levels: ${flatDrawCalls}  (${levels.map((l) => l.drawCalls).join(' / ')})`,
  );
  lines.push('');
  lines.push('mutation proof — the flat-calls line above is not vacuous:');
  lines.push(
    `  ${mutation.batches} deliberately unbatched sprites -> ${mutation.calls} draw calls ` +
      `(counters are real: ${mutation.provesCountersAreReal})`,
  );
  lines.push('');
  lines.push('growth-detection control — off-stage batch, starts at capacity 64, not part of any timing above:');
  for (const l of levels) {
    lines.push(
      `  ${l.target}: ${l.growthControl.initialCapacity} -> ${l.growthControl.finalCapacity}` +
        `  (lastRequested ${l.growthControl.lastRequested}, grew ${l.growthControl.grew})`,
    );
  }
  lines.push('');
  lines.push('READABILITY — human check, not automated');
  lines.push('Look at the three stills below. Each is the exact last frame this page');
  lines.push('measured at that density, using the sprites/tints the shipped game fires:');
  lines.push("orb.small pink (enemy shot), scale ice-blue (heavy shot, rotates), glow.small");
  lines.push('cyan (player shot). Judge for yourself whether it is still readable at 5000.');

  return lines.join('\n');
}

interface DensityResult {
  pass: boolean;
  failures: string[];
  sampleWindowFrames: number;
  warmupFrames: number;
  levels: LevelResult[];
  flatDrawCalls: boolean;
  mutationProof: MutationProof;
}

declare global {
  interface Window {
    __densityResult?: DensityResult;
  }
}

async function main(): Promise<void> {
  const resultEl = document.getElementById('result');
  if (!resultEl) throw new Error('missing #result element');

  const atlas = createBulletAtlas();
  const levels: LevelResult[] = [];

  let i = 0;
  for (const { target, canvasId } of LEVELS) {
    i++;
    resultEl.textContent = `running level ${i}/${LEVELS.length} — ${target} bullets…`;
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
    if (!canvas) throw new Error(`missing canvas #${canvasId}`);
    levels.push(await runLevel(canvas, target, atlas));
  }

  resultEl.textContent = 'running mutation proof…';
  const mutationProof = proveDrawCallsCanFail(atlas);

  const calls = levels.map((l) => l.drawCalls);
  const flatDrawCalls = calls.every((c) => c === calls[0]);

  const result = verdict(levels, flatDrawCalls, mutationProof);
  resultEl.textContent = formatReport(levels, flatDrawCalls, mutationProof, result);

  window.__densityResult = {
    pass: result.pass,
    failures: result.failures,
    sampleWindowFrames: SAMPLE_FRAMES,
    warmupFrames: WARMUP_FRAMES,
    levels,
    flatDrawCalls,
    mutationProof,
  };
}

void main();
