/**
 * Scenes compare — every registered background on one page, live, measured.
 *
 * The problem this solves: judging a background change by playing to it means
 * title → select → stage → boss for every scene, minutes per look. This page
 * renders ALL registered scenes simultaneously in a grid, drives them off the
 * same tick clock the game uses (uTick / per-scene uScroll accumulation,
 * replicated from `Background#advance`), and overlays live measurements so the
 * readability-law numbers are visible while the art is judged.
 *
 * Per cell, every tick:
 *   pk — peak Rec.709 luminance of the cell (law: <= ~0.1)
 *   mn — mean luminance
 *   Δ  — max per-tick |luminance step| per pixel (temporal law: ~<= 0.02;
 *        rendered red when a tick exceeds it)
 *
 * Measured on the RAW framebuffer values (the scene shader's own output, no
 * bloom, no sRGB decode) — the same space the scene headers' analytic
 * derivations live in. In-game acceptance still re-measures through the real
 * post chain; this page is the fast working instrument, not the header quote.
 *
 * The last cell is the FADE LAB: pick scene A → scene B and GO to watch the
 * real crossfade machinery (base quad + outgoing quad one renderOrder above,
 * uAlpha ramped 1→0 exactly as `Background#step` does). After the shader
 * overhaul the torn-paper mask rides the outgoing alpha, so the tear and the
 * incoming seal's stamp draw-in are both visible here without playing a run.
 *
 * Automation surface (all on window):
 *   __compareReady        true once the first frame rendered
 *   __measure()           {scene: {peak, mean, maxStep}} snapshot
 *   __dump(w?, h?)        {scene: dataURL} full-res PNG per scene
 *   __strips(n?, stride?) {scene: [dataURL,...]} n frames, stride ticks apart
 *
 * The frame loop must not depend on requestAnimationFrame alone: an occluded
 * tab freezes rAF and this page is often driven by automation in exactly that
 * state. `nextFrame` races rAF against a 50ms timeout (same lesson as
 * test/visual/density.ts).
 */

import * as THREE from 'three';
import {
  backgroundNames,
  composeFragmentShader,
  getBackgroundSpec,
} from '../../src/render/background';
import '../../src/render/backgrounds/index';

/* ------------------------------------------------------------------ layout */

const FIELD_W = 480;
const FIELD_H = 640;
const CELL_W = 216;
const CELL_H = 288; // 3:4, matching the field
const COLS = 5;
const GAP = 6;

/** Stages first, seals after, so the grid reads in campaign order. */
const PREFERRED_ORDER = [
  'drift', 'surge', 'expanse', 'undertow', 'stratum', 'vault',
  'signet', 'cordon', 'intaglio', 'regnum', 'sable', 'umbra', 'decree',
  // The terminal-screen scene (game-over / ending). Pinned to cell #14; the
  // fade lab moves to #15 automatically (cellCount = names.length + 1).
  'signal-decay',
];

const names = [...backgroundNames()].sort((a, b) => {
  const ia = PREFERRED_ORDER.indexOf(a);
  const ib = PREFERRED_ORDER.indexOf(b);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
});

const FADE_CELL = names.length; // one extra cell for the fade lab
const cellCount = names.length + 1;
const rows = Math.ceil(cellCount / COLS);
const canvasW = COLS * CELL_W + (COLS - 1) * GAP;
const canvasH = rows * CELL_H + (rows - 1) * GAP;

function cellRect(i: number): { x: number; y: number } {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  // WebGL viewport origin is bottom-left; DOM rows grow downward.
  return {
    x: col * (CELL_W + GAP),
    y: canvasH - (row + 1) * CELL_H - row * GAP,
  };
}

/* ---------------------------------------------------------------- three.js */

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
canvas.width = canvasW;
canvas.height = canvasH;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setSize(canvasW, canvasH, false);
renderer.autoClear = false;
renderer.sortObjects = true;

const scene = new THREE.Scene();
// NDC passthrough — no camera math; the quad is addressed in clip space.
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

/**
 * The game's projection maps (0,0) to the top-left with y down (rule 6), so a
 * scene's uv.y = 0 is the TOP of the field. A raw NDC quad puts uv.y = 1 at
 * the top, so flip here to match the game's orientation exactly.
 */
const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = vec2(uv.x, 1.0 - uv.y);
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const geometry = new THREE.PlaneGeometry(2, 2);

/** One compiled scene — mirrors `Background`'s Compiled, minus the Stage. */
interface Cell {
  readonly name: string;
  readonly material: THREE.ShaderMaterial;
  readonly scrollSpeed: number;
  readonly uTick: THREE.IUniform<number>;
  readonly uScroll: THREE.IUniform<number>;
  readonly uAlpha: THREE.IUniform<number>;
  scroll: number;
}

/**
 * Viewing exposure: multiplies every cell's uIntensity so structure authored
 * near-black can be inspected. Measurements are divided back by this factor,
 * so the overlay always reports the shader's OWN output, boost-independent.
 */
let viewBoost = 3;
const intensityUniforms: THREE.IUniform<number>[] = [];

function compile(name: string): Cell {
  const spec = getBackgroundSpec(name);
  const uTick: THREE.IUniform<number> = { value: 0 };
  const uScroll: THREE.IUniform<number> = { value: 0 };
  const uAlpha: THREE.IUniform<number> = { value: 1 };
  const uniforms: Record<string, THREE.IUniform> = {};
  for (const [key, uniform] of Object.entries(spec.uniforms ?? {})) {
    uniforms[key] = { value: uniform.value };
  }
  uniforms['uTick'] = uTick;
  uniforms['uScroll'] = uScroll;
  uniforms['uRes'] = { value: new THREE.Vector2(FIELD_W, FIELD_H) };
  const uIntensity: THREE.IUniform<number> = { value: viewBoost };
  intensityUniforms.push(uIntensity);
  uniforms['uIntensity'] = uIntensity;
  uniforms['uAlpha'] = uAlpha;
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: composeFragmentShader(spec.fragment),
    uniforms,
    transparent: true,
    side: THREE.DoubleSide, // rule 6 — winding is reversed in-game
    depthTest: false,
    depthWrite: false,
  });
  return { name, material, scrollSpeed: spec.scrollSpeed ?? 0, uTick, uScroll, uAlpha, scroll: 0 };
}

const cells = names.map(compile);
const quad = new THREE.Mesh(geometry, cells[0]!.material);
quad.frustumCulled = false;
scene.add(quad);

/* -------------------------------------------------------------- fade lab */

interface FadeLab {
  base: Cell;
  outgoing: Cell | null;
  fadeElapsed: number;
  fadeTicks: number;
}
const fade: FadeLab = { base: compile(names[0]!), outgoing: null, fadeElapsed: 0, fadeTicks: 0 };

function fadeGo(from: string, to: string, ticks: number): void {
  fade.base.material.dispose();
  fade.outgoing?.material.dispose();
  fade.base = compile(to);
  fade.outgoing = compile(from);
  // Warm the outgoing scene so it fades out mid-life, not at scroll 0.
  fade.outgoing.scroll = 600 * fade.outgoing.scrollSpeed;
  fade.fadeElapsed = 0;
  fade.fadeTicks = Math.max(1, ticks);
}

/* ------------------------------------------------------------ measurement */

interface Metrics {
  peak: number;
  mean: number;
  maxStep: number;
}
const metrics = new Map<string, Metrics>();
const prevLuma = new Map<string, Float32Array>();
const px = new Uint8Array(CELL_W * CELL_H * 4);

/** Rec.709 on the raw framebuffer bytes — the scene shader's own output space. */
function measureCell(key: string, x: number, y: number): Metrics {
  const gl = renderer.getContext();
  gl.readPixels(x, y, CELL_W, CELL_H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const n = CELL_W * CELL_H;
  let luma = prevLuma.get(key);
  const fresh = !luma;
  if (!luma) {
    luma = new Float32Array(n);
    prevLuma.set(key, luma);
  }
  let peak = 0;
  let sum = 0;
  let maxStep = 0;
  const norm = 255 * viewBoost; // report the shader's own output, boost-independent
  for (let i = 0; i < n; i++) {
    const l =
      (0.2126 * px[i * 4]! + 0.7152 * px[i * 4 + 1]! + 0.0722 * px[i * 4 + 2]!) / norm;
    if (l > peak) peak = l;
    sum += l;
    if (!fresh) {
      const d = Math.abs(l - luma[i]!);
      if (d > maxStep) maxStep = d;
    }
    luma[i] = l;
  }
  const m = { peak, mean: sum / n, maxStep: fresh ? 0 : maxStep };
  metrics.set(key, m);
  return m;
}

/* ----------------------------------------------------------------- labels */

const grid = document.getElementById('grid')!;
const labels = new Map<string, HTMLDivElement>();
/** Stable cell numbers (#1..#N in grid order) so the page can be discussed by number. */
const cellNo = new Map<string, number>();
for (let i = 0; i < cellCount; i++) {
  const key = i === FADE_CELL ? 'fade-lab' : names[i]!;
  cellNo.set(key, i + 1);
  const el = document.createElement('div');
  el.className = 'label';
  const { x } = cellRect(i);
  const row = Math.floor(i / COLS);
  el.style.left = `${x + 2}px`;
  el.style.top = `${row * (CELL_H + GAP) + 2}px`;
  el.textContent = `#${i + 1} ${key}`;
  grid.appendChild(el);
  labels.set(key, el);
}

function fmt(v: number): string {
  return v.toFixed(3).replace(/^0/, '');
}

function updateLabel(key: string, m: Metrics): void {
  const el = labels.get(key);
  if (!el) return;
  const pkBad = m.peak > 0.1;
  const stBad = m.maxStep > 0.02;
  el.innerHTML =
    `#${cellNo.get(key)} ${key}\n` +
    `pk <span class="${pkBad ? 'bad' : ''}">${fmt(m.peak)}</span>` +
    ` mn ${fmt(m.mean)}` +
    ` Δ <span class="${stBad ? 'bad' : ''}">${fmt(m.maxStep)}</span>`;
}

/* -------------------------------------------------------------- controls */

let paused = false;
let speed = 1;
let pendingSteps = 0;

const pauseBtn = document.getElementById('pause') as HTMLButtonElement;
function renderPauseBtn(): void {
  pauseBtn.textContent = paused ? 'play' : 'pause';
}
renderPauseBtn();
pauseBtn.onclick = () => {
  paused = !paused;
  renderPauseBtn();
};
(document.getElementById('step') as HTMLButtonElement).onclick = () => {
  pendingSteps += 1;
};
for (const b of document.querySelectorAll<HTMLButtonElement>('button.speed')) {
  b.onclick = () => {
    speed = Number(b.dataset['v']);
    for (const o of document.querySelectorAll('button.speed')) o.classList.remove('active');
    b.classList.add('active');
  };
  if (b.dataset['v'] === '1') b.classList.add('active');
}
(document.getElementById('restamp') as HTMLButtonElement).onclick = () => {
  for (const c of cells) c.scroll = 0;
  fade.base.scroll = 0;
};
for (const b of document.querySelectorAll<HTMLButtonElement>('button.boost')) {
  b.onclick = () => {
    viewBoost = Number(b.dataset['v']);
    for (const u of intensityUniforms) u.value = viewBoost;
    prevLuma.clear(); // step baselines are in the old scale
    for (const o of document.querySelectorAll('button.boost')) o.classList.remove('active');
    b.classList.add('active');
  };
  if (b.dataset['v'] === '3') b.classList.add('active');
}
// Note: at boost k, shader output above 1/k clips in the framebuffer, so the
// normalized overlay saturates at 1/k. Measure bright scenes at ×1.

const selA = document.getElementById('fadeA') as HTMLSelectElement;
const selB = document.getElementById('fadeB') as HTMLSelectElement;
for (const n of names) {
  selA.add(new Option(n, n));
  selB.add(new Option(n, n));
}
selA.value = names.includes('vault') ? 'vault' : names[0]!;
selB.value = names.includes('regnum') ? 'regnum' : names[names.length - 1]!;
(document.getElementById('fadeGo') as HTMLButtonElement).onclick = () => {
  const ticks = Number((document.getElementById('fadeTicks') as HTMLInputElement).value);
  fadeGo(selA.value, selB.value, ticks);
};

/* ------------------------------------------------------------- tick + draw */

let tick = 0;

function advance(c: Cell): void {
  c.scroll += c.scrollSpeed;
  c.uScroll.value = c.scroll;
  c.uTick.value = tick;
}

function stepOnce(): void {
  tick += 1;
  for (const c of cells) advance(c);
  advance(fade.base);
  const out = fade.outgoing;
  if (out) {
    advance(out);
    fade.fadeElapsed += 1;
    if (fade.fadeElapsed >= fade.fadeTicks) {
      out.material.dispose();
      fade.outgoing = null;
    } else {
      out.uAlpha.value = 1 - fade.fadeElapsed / fade.fadeTicks;
    }
  }
}

function drawCell(material: THREE.ShaderMaterial, x: number, y: number, clear: boolean): void {
  renderer.setViewport(x, y, CELL_W, CELL_H);
  renderer.setScissor(x, y, CELL_W, CELL_H);
  renderer.setScissorTest(true);
  if (clear) renderer.clear();
  quad.material = material;
  renderer.render(scene, camera);
}

function drawFrame(): void {
  for (let i = 0; i < names.length; i++) {
    const { x, y } = cellRect(i);
    drawCell(cells[i]!.material, x, y, true);
    updateLabel(names[i]!, measureCell(names[i]!, x, y));
  }
  const { x, y } = cellRect(FADE_CELL);
  drawCell(fade.base.material, x, y, true);
  if (fade.outgoing) drawCell(fade.outgoing.material, x, y, false);
  updateLabel('fade-lab', measureCell('fade-lab', x, y));
}

/** rAF raced against a timeout so an occluded tab keeps ticking (density.ts lesson). */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const fire = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    requestAnimationFrame(fire);
    setTimeout(fire, 50);
  });
}

async function loop(): Promise<void> {
  for (;;) {
    const steps = (paused ? 0 : speed) + pendingSteps;
    pendingSteps = 0;
    for (let s = 0; s < steps; s++) stepOnce();
    drawFrame();
    (window as never as { __compareReady: boolean }).__compareReady = true;
    await nextFrame();
  }
}

/* ------------------------------------------------------------- automation */

declare global {
  interface Window {
    __compareReady: boolean;
    __measure: () => Record<string, Metrics>;
    __dump: (w?: number, h?: number) => Record<string, string>;
    __strips: (frames?: number, stride?: number) => Record<string, string[]>;
  }
}

window.__measure = () => {
  const out: Record<string, Metrics> = {};
  for (const [k, v] of metrics) out[k] = { ...v };
  return out;
};

/** Render one scene full-res into a scratch region and return it as a PNG.
 *  Dumps are always taken at ×1 exposure — archival pixels stay honest. */
function snapshot(c: Cell, w: number, h: number): string {
  const ui = c.material.uniforms['uIntensity'] as THREE.IUniform<number>;
  const savedBoost = ui.value;
  ui.value = 1;
  const target = new THREE.WebGLRenderTarget(w, h);
  renderer.setRenderTarget(target);
  renderer.setViewport(0, 0, w, h);
  renderer.setScissorTest(false);
  renderer.clear();
  quad.material = c.material;
  renderer.render(scene, camera);
  const buf = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(target, 0, 0, w, h, buf);
  renderer.setRenderTarget(null);
  target.dispose();
  ui.value = savedBoost;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  // readRenderTargetPixels returns rows bottom-up; flip into image space.
  for (let row = 0; row < h; row++) {
    img.data.set(buf.subarray((h - 1 - row) * w * 4, (h - row) * w * 4), row * w * 4);
  }
  ctx.putImageData(img, 0, 0);
  return out.toDataURL('image/png');
}

window.__dump = (w = FIELD_W, h = FIELD_H) => {
  const out: Record<string, string> = {};
  for (const c of cells) out[c.name] = snapshot(c, w, h);
  return out;
};

window.__strips = (frames = 3, stride = 60) => {
  const out: Record<string, string[]> = {};
  for (const c of cells) out[c.name] = [snapshot(c, FIELD_W, FIELD_H)];
  for (let f = 1; f < frames; f++) {
    for (let s = 0; s < stride; s++) stepOnce();
    for (const c of cells) out[c.name]!.push(snapshot(c, FIELD_W, FIELD_H));
  }
  return out;
};

void loop();
