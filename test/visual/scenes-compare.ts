/**
 * v4 scene atlas — every registered background on one fixed-tick review surface.
 *
 * The visible atlas defaults to the production view: hybrid source at intensity
 * ×1, with `V4StageStructure` composited over the four campaign stage fields.
 * Source and structure are independent controls; raw structure mode and the
 * ×2–×4 gains are diagnostic views only. Metrics always measure the production
 * source at ×1 (hybrid for the four campaign stages, shader elsewhere); legacy raw PNG exports
 * remain shader-only ×1 so changing the view cannot change them.
 *
 * Automation surface (all on window):
 *   __compareReady            true once the first frame rendered
 *   __measure()               {scene: {peak, mean, maxStep}} production ×1
 *   __dump(w?, h?)            {scene: dataURL} raw ×1 PNG per scene
 *   __strips(n?, stride?)     raw ×1 temporal strips
 *   __dumpArt(w?, h?)         painted plates (shader fallback for other scenes)
 *   __dumpHybrid(w?, h?)      production hybrid fields without structure
 *   __dumpComposite(w?, h?)   production hybrid + stage-structure PNGs
 *   __stripsComposite(...)    production hybrid temporal strips
 *
 * `maxStep` is measured between the current production source and exactly one
 * tick before it. It therefore stays a per-tick value at ×1, ×4 and ×16 alike.
 * The page loop uses elapsed wall time only to schedule whole 60Hz ticks; no
 * delta value or wall clock ever reaches a shader uniform.
 */

import * as THREE from 'three';
import {
  BACKGROUND_ART_MODE_VALUE,
  backgroundNames,
  composeFragmentShader,
  getBackgroundSpec,
  loadBackgroundArtAssets,
  type BackgroundArtMode,
} from '../../src/render/background';
import {
  V4_STAGE_STRUCTURE_FRAGMENT,
  v4StageStructureRole,
  type V4StageStructureRole,
} from '../../src/v4/backgrounds/structure';
import '../../src/v4/backgrounds';

window.__compareReady = false;
const artAssets = await loadBackgroundArtAssets();

/* --------------------------------------------------------------- catalogue */

const FIELD_W = 480;
const FIELD_H = 640;
const TICK_MS = 1000 / 60;
const MAX_CATCHUP_TICKS = 240;
const METRIC_W = 240;
const METRIC_H = 320;
const METRIC_INTERVAL_TICKS = 6;
const TEMPORAL_WARNING = 0.02;

/**
 * Keep the legacy automation key order even though the visible atlas reads in
 * narrative order. Unknown future scenes append alphabetically.
 */
const API_ORDER = [
  'drift',
  'surge',
  'expanse',
  'undertow',
  'stratum',
  'vault',
  'signet',
  'cordon',
  'intaglio',
  'regnum',
  'sable',
  'umbra',
  'decree',
  'signal-decay',
] as const;

const DISPLAY_ORDER = [
  'drift',
  'signal-decay',
  'expanse',
  'signet',
  'undertow',
  'cordon',
  'intaglio',
  'stratum',
  'sable',
  'vault',
  'regnum',
  'umbra',
  'decree',
  'surge',
] as const;

interface SceneMeta {
  readonly role: string;
  readonly owner: string;
  readonly route: string;
  readonly story: string;
  readonly className?: string;
}

const SCENE_META: Readonly<Record<string, SceneMeta>> = {
  drift: {
    role: 'SHELL / TITLE',
    owner: 'neutral field',
    route: '流程入口 · 标题 / 菜单',
    story: '低月与冷银水面托住标题、难度与选角；菜单层最明亮，但高光仍保持为大尺度结构。',
  },
  'signal-decay': {
    role: 'TERMINAL',
    owner: 'game over / ending',
    route: '流程出口 · 结算 / GAME OVER',
    story: 'Ghost 宽带由上而下失去连续性；只服务结局、结果与失败文字，不承载弹幕。',
  },
  expanse: {
    role: 'STAGE 01 · 旷野',
    owner: 'sentinel',
    route: '主线 1/4 · 第一关背景 · SENTINEL 前',
    story: 'V4 冷青 Ghost 像素膜层先建立空旷远场与连接边缘，lens-whisper 的六束远光再沿独立 Lissajous 轨迹漂移；完整 hybrid 锁在 480×640 逻辑像素网格。',
  },
  signet: {
    role: 'BOSS STATION',
    owner: 'sentinel',
    route: '主线 1/4 · 第一关 BOSS · SENTINEL',
    story: '液态金属印记进入第一位守望者的稳定施术场；玩家活动带主动压低细节与反光。',
  },
  undertow: {
    role: 'STAGE 02 · 竖井',
    owner: 'warden / magistrate',
    route: '主线 2/4 · 第二关背景 · 双守卫',
    story: 'V4 靛青 Ghost 像素膜墙建立下沉竖深与中央通道；原 tropical-heat 的 simplex 域扭曲继续提供冷折射，完整 hybrid 锁在 480×640 逻辑像素网格。',
  },
  cordon: {
    role: 'MIDBOSS STATION',
    owner: 'warden',
    route: '主线 2/4 · 第二关 MIDBOSS · WARDEN',
    story: '原 hologram-glitch 的有机 FBM 体积与横向错位保留；扫描线、RGB 分色和噪块收束成连续 Ghost 膜。',
  },
  intaglio: {
    role: 'BOSS STATION',
    owner: 'magistrate',
    route: '主线 2/4 · 第二关 BOSS · MAGISTRATE',
    story: '原 bass-ripple 的鼓膜波推动柔性骨银蜂巢与三向棚拍反光；静态网格退后，行进形变成为主体。',
  },
  stratum: {
    role: 'STAGE 03 · 沉积',
    owner: 'chancellor',
    route: '主线 3/4 · 第三关背景 · CHANCELLOR 前',
    story: '原三中心 gradient 与 travelling wave 是完整动态主体并加快 15%；V4 soot/slate Ghost 像素图只提供低频浮雕和微量色相，不再作为不透明层遮挡 shader。',
  },
  sable: {
    role: 'BOSS STATION',
    owner: 'chancellor',
    route: '主线 3/4 · 第三关 BOSS · CHANCELLOR',
    story: '冷黑玻璃内的大型封存气泡保持宽软边缘；生产 ×1 可见膜层与上升，不重新加入亮点和爆泡。',
  },
  vault: {
    role: 'STAGE 04 · 穹顶',
    owner: 'regent',
    route: '主线 4/4 · 第四关背景 · REGENT 前',
    story: 'V4 黑紫 Ghost 像素膜层提供侧向压力与石墨支撑，fluid-amber 双重 warp 在同一逻辑像素网格推动冷光；生产 ×1 清晰，时钟仍为固定 tick 的原版 110%。',
  },
  regnum: {
    role: 'FINAL BOSS',
    owner: 'regent',
    route: '主线 4/4 · 最终 BOSS · REGENT',
    story: '原 topographic 的十四层自然地形完整展开；无空席或中央裂缝图形，紫、绯与冷银线随高程自行闭合。',
  },
  umbra: {
    role: 'LUNATIC · 出神',
    owner: 'sentinel',
    route: '额外路线 · LUNATIC / 出神',
    story: 'Total Eclipse 保留无星点冷紫帷幕、漂移和遮蔽；生产 ×1 提亮后仍不产生任何独立光点。',
    className: 'unmoored',
  },
  decree: {
    role: 'LUNATIC · 出神',
    owner: 'chancellor / regent',
    route: '额外路线 · LUNATIC / 出神',
    story: 'Fiat 与 Sine Die 由四个原始环源生成暖灰、受控琥珀与骨色 moiré；宽拍频主导，细乘积仅作材质。',
    className: 'unmoored',
  },
  surge: {
    role: 'EXTENSION SURFACE',
    owner: 'not in base campaign',
    route: '未编入主线 · 扩展场景',
    story: '原 ink-dissolve 的双重 domain warp 与反应边保留；总时钟为原版 110%，全局平移近乎静止，运动集中在 q/r 回卷、secondary curl 与膜内溶解。',
    className: 'extension',
  },
};

const registered = [...backgroundNames()];
const apiNames = [...registered].sort((a, b) => {
  const ia = API_ORDER.indexOf(a as (typeof API_ORDER)[number]);
  const ib = API_ORDER.indexOf(b as (typeof API_ORDER)[number]);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
});
const hybridLegacyLabel = apiNames
  .filter((name) => getBackgroundSpec(name).art !== undefined)
  .map((name) => String(API_ORDER.indexOf(name as (typeof API_ORDER)[number]) + 1).padStart(2, '0'))
  .join('/');
const displayNames = [...registered].sort((a, b) => {
  const ia = DISPLAY_ORDER.indexOf(a as (typeof DISPLAY_ORDER)[number]);
  const ib = DISPLAY_ORDER.indexOf(b as (typeof DISPLAY_ORDER)[number]);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
});

/* --------------------------------------------------------------------- DOM */

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element as T;
}

const grid = required<HTMLElement>('grid');
const cardsLayer = required<HTMLDivElement>('cards');
const canvas = required<HTMLCanvasElement>('canvas');
const tickReadout = required<HTMLElement>('tickReadout');
const modeReadout = required<HTMLElement>('modeReadout');
const sourceReadout = required<HTMLElement>('sourceReadout');
const boostReadout = required<HTMLElement>('boostReadout');
const diagnosticReadout = required<HTMLElement>('diagnosticReadout');

interface CardRefs {
  readonly element: HTMLElement;
  readonly visual: HTMLDivElement;
  readonly info: HTMLDivElement;
  readonly peak: HTMLElement;
  readonly mean: HTMLElement;
  readonly step: HTMLElement;
}

const cardRefs = new Map<string, CardRefs>();
const legacyNumber = new Map(apiNames.map((name, index) => [name, index + 1]));
legacyNumber.set('fade-lab', apiNames.length + 1);

function metricItem(label: string): { root: HTMLSpanElement; value: HTMLElement } {
  const root = document.createElement('span');
  root.append(`${label} `);
  const value = document.createElement('b');
  value.textContent = '.---';
  root.appendChild(value);
  return { root, value };
}

function makeCard(key: string, meta: SceneMeta): CardRefs {
  const element = document.createElement('article');
  element.className = `scene-card ${meta.className ?? ''}`.trim();
  element.dataset['scene'] = key;
  element.id = `scene-${key}`;
  element.setAttribute('aria-label', `${key}: ${meta.role}`);
  if (key !== 'fade-lab' && v4StageStructureRole(key) !== 0) {
    element.classList.add('has-structure');
  }
  if (key !== 'fade-lab' && getBackgroundSpec(key).art) {
    element.classList.add('has-art');
  }

  const visual = document.createElement('div');
  visual.className = 'scene-visual';

  const topline = document.createElement('div');
  topline.className = 'scene-topline';
  const number = document.createElement('span');
  number.className = 'scene-no';
  number.textContent = `#${String(legacyNumber.get(key) ?? 0).padStart(2, '0')}`;
  const role = document.createElement('span');
  role.className = 'scene-role';
  role.textContent = meta.role;
  topline.append(number, role);
  visual.appendChild(topline);

  const structureFlag = document.createElement('span');
  structureFlag.className = 'structure-flag';
  structureFlag.textContent = '+ STAGE STRUCTURE';
  visual.appendChild(structureFlag);

  const artFlag = document.createElement('span');
  artFlag.className = 'art-flag';
  artFlag.textContent = 'ART + SHADER';
  visual.appendChild(artFlag);

  const info = document.createElement('div');
  info.className = 'scene-info';

  const identity = document.createElement('div');
  identity.className = 'scene-identity';
  const name = document.createElement('strong');
  name.className = 'scene-name';
  name.textContent = key;
  const owner = document.createElement('span');
  owner.className = 'scene-owner';
  owner.textContent = meta.owner;
  identity.append(name, owner);

  const story = document.createElement('p');
  story.className = 'scene-story';
  story.textContent = meta.story;

  const route = document.createElement('div');
  route.className = 'scene-route';
  route.textContent = meta.route;

  const metricRow = document.createElement('div');
  metricRow.className = 'metrics';
  const peak = metricItem('pk');
  const mean = metricItem('mn');
  const step = metricItem('Δ1');
  metricRow.append(peak.root, mean.root, step.root);

  info.append(identity, route, story, metricRow);
  element.append(visual, info);
  cardsLayer.appendChild(element);

  return {
    element,
    visual,
    info,
    peak: peak.value,
    mean: mean.value,
    step: step.value,
  };
}

for (const name of displayNames) {
  cardRefs.set(
    name,
    makeCard(name, SCENE_META[name] ?? {
      role: 'REGISTERED SCENE',
      owner: 'extension',
      route: '未编排 · 扩展场景',
      story: '已注册但尚未写入 v4 审查元数据；shader 仍以固定 tick 和 raw ×1 接受测量。',
      className: 'extension',
    }),
  );
}
cardRefs.set(
  'fade-lab',
  makeCard('fade-lab', {
    role: 'TRANSITION LAB',
    owner: 'tear + structure',
    route: '工具 · 场景转场预览',
    story: '使用真实 torn-paper outgoing alpha；hybrid source 同步驱动转场两侧，composite 模式另运行四关 structure 的 60-tick 过渡。',
  }),
);

/* --------------------------------------------------------------- renderer */

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
renderer.autoClear = false;
renderer.sortObjects = true;
renderer.setClearColor(0x030509, 1);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

/**
 * The game camera is y-down. A raw NDC quad would invert the authored field, so
 * this matches `Background`'s visible orientation exactly.
 */
const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = vec2(uv.x, 1.0 - uv.y);
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const geometry = new THREE.PlaneGeometry(2, 2);

interface Cell {
  readonly name: string;
  readonly material: THREE.ShaderMaterial;
  readonly scrollSpeed: number;
  readonly uArtMode: THREE.IUniform<number> | null;
  readonly uTick: THREE.IUniform<number>;
  readonly uScroll: THREE.IUniform<number>;
  readonly uIntensity: THREE.IUniform<number>;
  readonly uAlpha: THREE.IUniform<number>;
  scroll: number;
}

let tick = 0;
let viewBoost = 1;
let sourceMode: BackgroundArtMode = 'hybrid';

function compile(name: string): Cell {
  const spec = getBackgroundSpec(name);
  const uArtMode: THREE.IUniform<number> | null = spec.art
    ? { value: BACKGROUND_ART_MODE_VALUE[sourceMode] }
    : null;
  const uTick: THREE.IUniform<number> = { value: tick };
  const uScroll: THREE.IUniform<number> = { value: 0 };
  const uIntensity: THREE.IUniform<number> = { value: viewBoost };
  const uAlpha: THREE.IUniform<number> = { value: 1 };
  const uniforms: Record<string, THREE.IUniform> = {};
  for (const [key, uniform] of Object.entries(spec.uniforms ?? {})) {
    uniforms[key] = { value: uniform.value };
  }
  if (spec.art && uArtMode) {
    uniforms['uArt'] = { value: artAssets.texture(spec.art.url) };
    uniforms['uArtRes'] = { value: new THREE.Vector2(spec.art.width, spec.art.height) };
    uniforms['uArtMode'] = uArtMode;
  }
  uniforms['uTick'] = uTick;
  uniforms['uScroll'] = uScroll;
  uniforms['uRes'] = { value: new THREE.Vector2(FIELD_W, FIELD_H) };
  uniforms['uIntensity'] = uIntensity;
  uniforms['uAlpha'] = uAlpha;

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: composeFragmentShader(spec.fragment),
    uniforms,
    transparent: true,
    side: THREE.DoubleSide, // CLAUDE.md rule 6
    depthTest: false,
    depthWrite: false,
  });
  return {
    name,
    material,
    scrollSpeed: spec.scrollSpeed ?? 0,
    uArtMode,
    uTick,
    uScroll,
    uIntensity,
    uAlpha,
    scroll: 0,
  };
}

const cells = apiNames.map(compile);
const cellsByName = new Map(cells.map((cell) => [cell.name, cell]));
const displayCells = displayNames.map((name) => {
  const cell = cellsByName.get(name);
  if (!cell) throw new Error(`display scene "${name}" is not compiled`);
  return cell;
});

const quad = new THREE.Mesh(geometry, cells[0]?.material);
quad.frustumCulled = false;
scene.add(quad);

const structureUniforms = {
  uTick: { value: 0 },
  uRole: { value: 0 },
  uPreviousRole: { value: 0 },
  uFade: { value: 1 },
  uRes: { value: new THREE.Vector2(FIELD_W, FIELD_H) },
};
const structureMaterial = new THREE.ShaderMaterial({
  vertexShader: VERTEX,
  fragmentShader: V4_STAGE_STRUCTURE_FRAGMENT,
  uniforms: structureUniforms,
  transparent: true,
  side: THREE.DoubleSide,
  depthTest: false,
  depthWrite: false,
});

/* ----------------------------------------------------------------- layout */

const LAYOUT_GAP = 14;
const INFO_H = 166;
const MAX_CELL_W = 270;

interface AtlasLayout {
  readonly cols: number;
  readonly cellW: number;
  readonly cellH: number;
  readonly cardH: number;
  readonly width: number;
  readonly height: number;
}

let layout: AtlasLayout = {
  cols: 1,
  cellW: 1,
  cellH: 1,
  cardH: 1 + INFO_H,
  width: 1,
  height: 1 + INFO_H,
};
let layoutDirty = true;

function chooseColumns(width: number): number {
  if (width >= 1060) return 4;
  if (width >= 780) return 3;
  if (width >= 520) return 2;
  return 1;
}

function cardPosition(index: number): { x: number; top: number; y: number } {
  const col = index % layout.cols;
  const row = Math.floor(index / layout.cols);
  const x = col * (layout.cellW + LAYOUT_GAP);
  const top = row * (layout.cardH + LAYOUT_GAP);
  return {
    x,
    top,
    y: layout.height - top - layout.cellH,
  };
}

function applyLayout(): void {
  const hostWidth = Math.max(
    1,
    Math.floor(grid.parentElement?.clientWidth ?? document.documentElement.clientWidth),
  );
  const cols = chooseColumns(hostWidth);
  const availableCellW = Math.floor((hostWidth - (cols - 1) * LAYOUT_GAP) / cols);
  const cellW = Math.max(1, Math.min(MAX_CELL_W, availableCellW));
  const cellH = Math.max(1, Math.round(cellW * FIELD_H / FIELD_W));
  const cardH = cellH + INFO_H;
  const count = displayCells.length + 1;
  const rows = Math.ceil(count / cols);
  const width = cols * cellW + (cols - 1) * LAYOUT_GAP;
  const height = rows * cardH + (rows - 1) * LAYOUT_GAP;

  layout = { cols, cellW, cellH, cardH, width, height };
  grid.style.width = `${width}px`;
  grid.style.height = `${height}px`;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  renderer.setSize(width, height, false);

  const keys = [...displayNames, 'fade-lab'];
  for (let i = 0; i < keys.length; i++) {
    const refs = cardRefs.get(keys[i]!);
    if (!refs) continue;
    const { x, top } = cardPosition(i);
    refs.element.style.left = `${x}px`;
    refs.element.style.top = `${top}px`;
    refs.element.style.width = `${cellW}px`;
    refs.element.style.height = `${cardH}px`;
    refs.visual.style.height = `${cellH}px`;
    refs.info.style.height = `${INFO_H}px`;
  }
  layoutDirty = false;
}

const resizeObserver = new ResizeObserver(() => {
  layoutDirty = true;
});
if (grid.parentElement) resizeObserver.observe(grid.parentElement);
window.addEventListener('resize', () => {
  layoutDirty = true;
});

/* --------------------------------------------------------------- fade lab */

interface FadeLab {
  base: Cell;
  outgoing: Cell | null;
  retired: Cell | null;
  retiredAtTick: number;
  retiredFadeTicks: number;
  fadeElapsed: number;
  fadeTicks: number;
}

const fade: FadeLab = {
  base: compile(apiNames[0]!),
  outgoing: null,
  retired: null,
  retiredAtTick: -1,
  retiredFadeTicks: 0,
  fadeElapsed: 0,
  fadeTicks: 0,
};

let forceMetricRefresh = true;
let suppressNextMetricDelta = true;

function disposeCell(cell: Cell | null): void {
  cell?.material.dispose();
}

function syncCellScroll(cell: Cell): void {
  cell.uScroll.value = cell.scroll;
  cell.uTick.value = tick;
}

function fadeGo(from: string, to: string, ticks: number): void {
  disposeCell(fade.base);
  disposeCell(fade.outgoing);
  disposeCell(fade.retired);
  fade.base = compile(to);
  fade.outgoing = compile(from);
  fade.retired = null;
  fade.retiredAtTick = -1;
  fade.retiredFadeTicks = 0;
  // Preserve the original lab's useful choice: outgoing starts mid-life.
  fade.outgoing.scroll = 600 * fade.outgoing.scrollSpeed;
  syncCellScroll(fade.outgoing);
  fade.fadeElapsed = 0;
  fade.fadeTicks = Math.max(1, Math.floor(ticks));
  forceMetricRefresh = true;
  suppressNextMetricDelta = true;
}

/* --------------------------------------------------------------- drawing */

type ViewMode = 'raw' | 'composite';
let viewMode: ViewMode = 'composite';

function drawMaterial(
  material: THREE.Material,
  x: number,
  y: number,
  width: number,
  height: number,
  clear: boolean,
): void {
  renderer.setViewport(x, y, width, height);
  renderer.setScissor(x, y, width, height);
  renderer.setScissorTest(true);
  if (clear) renderer.clear();
  quad.material = material;
  renderer.render(scene, camera);
}

function setStructureState(
  previousRole: V4StageStructureRole,
  role: V4StageStructureRole,
  fadeAmount: number,
  structureTick: number,
): void {
  structureUniforms.uPreviousRole.value = previousRole;
  structureUniforms.uRole.value = role;
  structureUniforms.uFade.value = fadeAmount;
  structureUniforms.uTick.value = structureTick;
}

function drawStructure(
  previousRole: V4StageStructureRole,
  role: V4StageStructureRole,
  fadeAmount: number,
  structureTick: number,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  if (previousRole === 0 && role === 0) return;
  setStructureState(previousRole, role, fadeAmount, structureTick);
  drawMaterial(structureMaterial, x, y, width, height, false);
}

function drawScenePreview(cell: Cell, index: number): void {
  const { x, y } = cardPosition(index);
  drawMaterial(cell.material, x, y, layout.cellW, layout.cellH, true);
  if (viewMode === 'composite') {
    const role = v4StageStructureRole(cell.name);
    drawStructure(role, role, 1, tick, x, y, layout.cellW, layout.cellH);
  }
}

function fadeStructureState(offset = 0): {
  previousRole: V4StageStructureRole;
  role: V4StageStructureRole;
  amount: number;
} {
  const role = v4StageStructureRole(fade.base.name);
  if (fade.outgoing) {
    return {
      previousRole: v4StageStructureRole(fade.outgoing.name),
      role,
      amount: Math.max(0, Math.min(1, (fade.fadeElapsed + offset) / fade.fadeTicks)),
    };
  }
  if (offset < 0 && fade.retired && fade.retiredAtTick === tick) {
    return {
      previousRole: v4StageStructureRole(fade.retired.name),
      role,
      amount: Math.max(0, (fade.retiredFadeTicks - 1) / fade.retiredFadeTicks),
    };
  }
  return { previousRole: role, role, amount: 1 };
}

function drawFadePreview(index: number): void {
  const { x, y } = cardPosition(index);
  drawMaterial(fade.base.material, x, y, layout.cellW, layout.cellH, true);
  if (fade.outgoing) {
    drawMaterial(fade.outgoing.material, x, y, layout.cellW, layout.cellH, false);
  }
  if (viewMode === 'composite') {
    const state = fadeStructureState();
    drawStructure(
      state.previousRole,
      state.role,
      state.amount,
      tick,
      x,
      y,
      layout.cellW,
      layout.cellH,
    );
  }
}

function drawFrame(): void {
  if (layoutDirty) applyLayout();
  renderer.setRenderTarget(null);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, layout.width, layout.height);
  renderer.clear();

  for (let i = 0; i < displayCells.length; i++) {
    drawScenePreview(displayCells[i]!, i);
  }
  drawFadePreview(displayCells.length);
}

/* ------------------------------------------------------------- measurement */

interface Metrics {
  peak: number;
  mean: number;
  maxStep: number;
}

const metrics = new Map<string, Metrics>();
const metricTarget = new THREE.WebGLRenderTarget(METRIC_W, METRIC_H, {
  depthBuffer: false,
  stencilBuffer: false,
});
const metricNow = new Uint8Array(METRIC_W * METRIC_H * 4);
const metricBefore = new Uint8Array(METRIC_W * METRIC_H * 4);
let metricsTick = -1;

interface CellDrawState {
  readonly tick: number;
  readonly scroll: number;
  readonly alpha: number;
}

function withCellState(
  cell: Cell,
  state: CellDrawState,
  intensity: number,
  artMode: BackgroundArtMode,
  draw: () => void,
): void {
  const savedTick = cell.uTick.value;
  const savedScroll = cell.uScroll.value;
  const savedIntensity = cell.uIntensity.value;
  const savedAlpha = cell.uAlpha.value;
  const savedArtMode = cell.uArtMode?.value;
  cell.uTick.value = state.tick;
  cell.uScroll.value = state.scroll;
  cell.uIntensity.value = intensity;
  cell.uAlpha.value = state.alpha;
  if (cell.uArtMode) cell.uArtMode.value = BACKGROUND_ART_MODE_VALUE[artMode];
  draw();
  cell.uTick.value = savedTick;
  cell.uScroll.value = savedScroll;
  cell.uIntensity.value = savedIntensity;
  cell.uAlpha.value = savedAlpha;
  if (cell.uArtMode && savedArtMode !== undefined) cell.uArtMode.value = savedArtMode;
}

function renderSceneToTarget(
  target: THREE.WebGLRenderTarget,
  width: number,
  height: number,
  cell: Cell,
  offset: number,
  composite: boolean,
  artMode: BackgroundArtMode,
): void {
  renderer.setRenderTarget(target);
  renderer.setViewport(0, 0, width, height);
  renderer.setScissor(0, 0, width, height);
  renderer.setScissorTest(true);
  renderer.clear();
  withCellState(
    cell,
    {
      tick: Math.max(0, tick + offset),
      scroll: cell.scroll + cell.scrollSpeed * offset,
      alpha: 1,
    },
    1,
    artMode,
    () => {
      drawMaterial(cell.material, 0, 0, width, height, false);
    },
  );
  if (composite) {
    const role = v4StageStructureRole(cell.name);
    drawStructure(role, role, 1, Math.max(0, tick + offset), 0, 0, width, height);
  }
}

function productionArtMode(cell: Cell): BackgroundArtMode {
  return cell.uArtMode ? 'hybrid' : 'shader';
}

function readScenePixels(cell: Cell, offset: number, out: Uint8Array): void {
  renderSceneToTarget(
    metricTarget,
    METRIC_W,
    METRIC_H,
    cell,
    offset,
    false,
    productionArtMode(cell),
  );
  renderer.readRenderTargetPixels(metricTarget, 0, 0, METRIC_W, METRIC_H, out);
}

function outgoingAtOffset(offset: number): {
  cell: Cell;
  alpha: number;
} | null {
  if (fade.outgoing) {
    const elapsed = Math.max(0, fade.fadeElapsed + offset);
    return {
      cell: fade.outgoing,
      alpha: Math.max(0, 1 - elapsed / fade.fadeTicks),
    };
  }
  if (offset < 0 && fade.retired && fade.retiredAtTick === tick) {
    return {
      cell: fade.retired,
      alpha: 1 / Math.max(1, fade.retiredFadeTicks),
    };
  }
  return null;
}

function readFadePixels(offset: number, out: Uint8Array): void {
  renderer.setRenderTarget(metricTarget);
  renderer.setViewport(0, 0, METRIC_W, METRIC_H);
  renderer.setScissor(0, 0, METRIC_W, METRIC_H);
  renderer.setScissorTest(true);
  renderer.clear();

  withCellState(
    fade.base,
    {
      tick: Math.max(0, tick + offset),
      scroll: fade.base.scroll + fade.base.scrollSpeed * offset,
      alpha: 1,
    },
    1,
    productionArtMode(fade.base),
    () => {
      drawMaterial(fade.base.material, 0, 0, METRIC_W, METRIC_H, false);
    },
  );

  const outgoing = outgoingAtOffset(offset);
  if (outgoing) {
    withCellState(
      outgoing.cell,
      {
        tick: Math.max(0, tick + offset),
        scroll: outgoing.cell.scroll + outgoing.cell.scrollSpeed * offset,
        alpha: outgoing.alpha,
      },
      1,
      productionArtMode(outgoing.cell),
      () => {
        drawMaterial(outgoing.cell.material, 0, 0, METRIC_W, METRIC_H, false);
      },
    );
  }
  renderer.readRenderTargetPixels(metricTarget, 0, 0, METRIC_W, METRIC_H, out);
}

function analysePixels(now: Uint8Array, before: Uint8Array | null): Metrics {
  const count = now.length / 4;
  let peak = 0;
  let sum = 0;
  let maxStep = 0;
  for (let i = 0; i < count; i++) {
    const base = i * 4;
    const luma =
      (0.2126 * now[base]! + 0.7152 * now[base + 1]! + 0.0722 * now[base + 2]!) /
      255;
    peak = Math.max(peak, luma);
    sum += luma;
    if (before) {
      const oldLuma =
        (0.2126 * before[base]! +
          0.7152 * before[base + 1]! +
          0.0722 * before[base + 2]!) /
        255;
      maxStep = Math.max(maxStep, Math.abs(luma - oldLuma));
    }
  }
  return { peak, mean: sum / count, maxStep };
}

function fmt(value: number): string {
  return value.toFixed(3).replace(/^0/, '');
}

function updateCardMetrics(key: string, value: Metrics): void {
  const refs = cardRefs.get(key);
  if (!refs) return;
  refs.peak.textContent = fmt(value.peak);
  refs.mean.textContent = fmt(value.mean);
  refs.step.textContent = fmt(value.maxStep);
  refs.step.parentElement?.classList.toggle('bad', value.maxStep > TEMPORAL_WARNING);
}

function refreshMetrics(suppressDelta = false): void {
  const before = tick > 0 && !suppressDelta ? metricBefore : null;
  for (const cell of cells) {
    readScenePixels(cell, 0, metricNow);
    if (before) readScenePixels(cell, -1, metricBefore);
    const value = analysePixels(metricNow, before);
    metrics.set(cell.name, value);
    updateCardMetrics(cell.name, value);
  }

  readFadePixels(0, metricNow);
  if (before) readFadePixels(-1, metricBefore);
  const fadeValue = analysePixels(metricNow, before);
  metrics.set('fade-lab', fadeValue);
  updateCardMetrics('fade-lab', fadeValue);

  renderer.setRenderTarget(null);
  metricsTick = tick;
  forceMetricRefresh = false;
  suppressNextMetricDelta = false;
}

/* ------------------------------------------------------------- tick clock */

function advance(cell: Cell): void {
  cell.scroll += cell.scrollSpeed;
  syncCellScroll(cell);
}

function stepOnce(): void {
  tick += 1;
  for (const cell of cells) advance(cell);
  advance(fade.base);

  if (fade.retired && tick > fade.retiredAtTick + 1) {
    disposeCell(fade.retired);
    fade.retired = null;
    fade.retiredAtTick = -1;
    fade.retiredFadeTicks = 0;
  }

  const outgoing = fade.outgoing;
  if (!outgoing) return;
  advance(outgoing);
  fade.fadeElapsed += 1;
  if (fade.fadeElapsed >= fade.fadeTicks) {
    disposeCell(fade.retired);
    fade.retired = outgoing;
    fade.retiredAtTick = tick;
    fade.retiredFadeTicks = fade.fadeTicks;
    fade.outgoing = null;
    fade.fadeElapsed = fade.fadeTicks;
    return;
  }
  outgoing.uAlpha.value = 1 - fade.fadeElapsed / fade.fadeTicks;
}

let paused = false;
let speed = 1;
let pendingSteps = 0;
let accumulatorMs = 0;
let lastFrameMs = performance.now();

function resetFrameClock(): void {
  accumulatorMs = 0;
  lastFrameMs = performance.now();
}

function nextFrame(): Promise<number> {
  return new Promise((resolve) => {
    let done = false;
    let timeout = 0;
    const fire = (time = performance.now()) => {
      if (done) return;
      done = true;
      if (timeout !== 0) window.clearTimeout(timeout);
      resolve(time);
    };
    requestAnimationFrame(fire);
    timeout = window.setTimeout(() => fire(), 50);
  });
}

async function loop(): Promise<void> {
  for (;;) {
    const frameMs = await nextFrame();
    const elapsedMs = Math.min(250, Math.max(0, frameMs - lastFrameMs));
    lastFrameMs = frameMs;

    let steps = pendingSteps;
    pendingSteps = 0;
    if (paused) {
      accumulatorMs = 0;
    } else {
      accumulatorMs += elapsedMs * speed;
      const automatic = Math.min(MAX_CATCHUP_TICKS, Math.floor(accumulatorMs / TICK_MS));
      accumulatorMs -= automatic * TICK_MS;
      steps += automatic;
    }

    for (let i = 0; i < steps; i++) stepOnce();
    if (steps > 0) {
      forceMetricRefresh ||= tick - metricsTick >= METRIC_INTERVAL_TICKS;
    }
    if (forceMetricRefresh) refreshMetrics(suppressNextMetricDelta);

    tickReadout.textContent = String(tick);
    drawFrame();
    window.__compareReady = true;
  }
}

/* --------------------------------------------------------------- controls */

function setPressed(selector: string, active: HTMLButtonElement): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>(selector)) {
    const selected = button === active;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
}

const pauseButton = required<HTMLButtonElement>('pause');
function renderPauseButton(): void {
  pauseButton.textContent = paused ? 'play' : 'pause';
  pauseButton.setAttribute('aria-pressed', String(paused));
}
renderPauseButton();
pauseButton.onclick = () => {
  paused = !paused;
  resetFrameClock();
  renderPauseButton();
};

required<HTMLButtonElement>('step').onclick = () => {
  pendingSteps += 1;
  forceMetricRefresh = true;
};

for (const button of document.querySelectorAll<HTMLButtonElement>('button.speed')) {
  button.onclick = () => {
    speed = Number(button.dataset['v']);
    setPressed('button.speed', button);
    resetFrameClock();
  };
}

required<HTMLButtonElement>('restamp').onclick = () => {
  for (const cell of cells) {
    cell.scroll = 0;
    cell.uScroll.value = 0;
  }
  for (const cell of [fade.base, fade.outgoing, fade.retired]) {
    if (!cell) continue;
    cell.scroll = 0;
    cell.uScroll.value = 0;
  }
  forceMetricRefresh = true;
  suppressNextMetricDelta = true;
};

for (const button of document.querySelectorAll<HTMLButtonElement>('button.mode')) {
  button.onclick = () => {
    viewMode = button.dataset['v'] === 'raw' ? 'raw' : 'composite';
    setPressed('button.mode', button);
    document.body.classList.toggle('composite-view', viewMode === 'composite');
    modeReadout.textContent = viewMode === 'composite' ? 'v4 composite' : 'raw shader';
  };
}

function liveCells(): Cell[] {
  return [
    ...cells,
    fade.base,
    ...(fade.outgoing ? [fade.outgoing] : []),
    ...(fade.retired ? [fade.retired] : []),
  ];
}

for (const button of document.querySelectorAll<HTMLButtonElement>('button.source')) {
  button.onclick = () => {
    const requested = button.dataset['v'];
    if (requested !== 'art' && requested !== 'shader' && requested !== 'hybrid') return;
    sourceMode = requested;
    for (const cell of liveCells()) {
      if (cell.uArtMode) cell.uArtMode.value = BACKGROUND_ART_MODE_VALUE[sourceMode];
    }
    setPressed('button.source', button);
    sourceReadout.textContent =
      sourceMode === 'shader' ? 'shader · all' : `${sourceMode} · ${hybridLegacyLabel}`;
  };
}

for (const button of document.querySelectorAll<HTMLButtonElement>('button.boost')) {
  button.onclick = () => {
    viewBoost = Number(button.dataset['v']);
    for (const cell of liveCells()) cell.uIntensity.value = viewBoost;
    setPressed('button.boost', button);
    const diagnostic = viewBoost === 1 ? '×1 production' : `×${viewBoost} diagnostic`;
    boostReadout.textContent = diagnostic;
    boostReadout.parentElement?.classList.toggle('diagnostic', viewBoost !== 1);
    diagnosticReadout.textContent =
      viewBoost === 1
        ? ''
        : 'diagnostic gain affects preview only · metrics stay production ×1';
    diagnosticReadout.classList.toggle('diagnostic', viewBoost !== 1);
  };
}

const selectA = required<HTMLSelectElement>('fadeA');
const selectB = required<HTMLSelectElement>('fadeB');
for (const name of apiNames) {
  selectA.add(new Option(name, name));
  selectB.add(new Option(name, name));
}
selectA.value = apiNames.includes('vault') ? 'vault' : apiNames[0]!;
selectB.value = apiNames.includes('regnum') ? 'regnum' : apiNames[apiNames.length - 1]!;
required<HTMLButtonElement>('fadeGo').onclick = () => {
  const fadeTicks = Number(required<HTMLInputElement>('fadeTicks').value);
  fadeGo(selectA.value, selectB.value, Number.isFinite(fadeTicks) ? fadeTicks : 60);
};

/* ------------------------------------------------------------- automation */

declare global {
  interface Window {
    __compareReady: boolean;
    __measure: () => Record<string, Metrics>;
    __dump: (w?: number, h?: number) => Record<string, string>;
    __dumpArt: (w?: number, h?: number) => Record<string, string>;
    __dumpHybrid: (w?: number, h?: number) => Record<string, string>;
    __strips: (frames?: number, stride?: number) => Record<string, string[]>;
    __dumpComposite: (w?: number, h?: number) => Record<string, string>;
    __stripsComposite: (frames?: number, stride?: number) => Record<string, string[]>;
  }
}

window.__compareReady = false;

window.__measure = () => {
  if (metricsTick !== tick) refreshMetrics(suppressNextMetricDelta);
  const out: Record<string, Metrics> = {};
  for (const [key, value] of metrics) out[key] = { ...value };
  return out;
};

function pixelsToDataUrl(bytes: Uint8Array, width: number, height: number): string {
  const output = document.createElement('canvas');
  output.width = width;
  output.height = height;
  const context = output.getContext('2d');
  if (!context) throw new Error('2d context unavailable');
  const image = context.createImageData(width, height);
  // WebGL target rows are bottom-up; Canvas2D image rows are top-down.
  for (let row = 0; row < height; row++) {
    image.data.set(
      bytes.subarray((height - 1 - row) * width * 4, (height - row) * width * 4),
      row * width * 4,
    );
  }
  context.putImageData(image, 0, 0);
  return output.toDataURL('image/png');
}

function snapshot(
  cell: Cell,
  requestedW: number,
  requestedH: number,
  composite: boolean,
  artMode: BackgroundArtMode,
): string {
  const width = Math.max(1, Math.floor(requestedW));
  const height = Math.max(1, Math.floor(requestedH));
  const target = new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: false,
    stencilBuffer: false,
  });
  renderSceneToTarget(target, width, height, cell, 0, composite, artMode);
  const bytes = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, width, height, bytes);
  renderer.setRenderTarget(null);
  target.dispose();
  return pixelsToDataUrl(bytes, width, height);
}

function dump(
  composite: boolean,
  artMode: BackgroundArtMode,
  width = FIELD_W,
  height = FIELD_H,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const cell of cells) {
    out[cell.name] = snapshot(cell, width, height, composite, artMode);
  }
  return out;
}

function strips(
  composite: boolean,
  artMode: BackgroundArtMode,
  frames = 3,
  stride = 60,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const cell of cells) {
    out[cell.name] = [snapshot(cell, FIELD_W, FIELD_H, composite, artMode)];
  }
  for (let frame = 1; frame < frames; frame++) {
    for (let step = 0; step < stride; step++) stepOnce();
    for (const cell of cells) {
      out[cell.name]!.push(snapshot(cell, FIELD_W, FIELD_H, composite, artMode));
    }
  }
  forceMetricRefresh = true;
  resetFrameClock();
  return out;
}

window.__dump = (width = FIELD_W, height = FIELD_H) =>
  dump(false, 'shader', width, height);
window.__dumpArt = (width = FIELD_W, height = FIELD_H) =>
  dump(false, 'art', width, height);
window.__dumpHybrid = (width = FIELD_W, height = FIELD_H) =>
  dump(false, 'hybrid', width, height);
window.__dumpComposite = (width = FIELD_W, height = FIELD_H) =>
  dump(true, 'hybrid', width, height);
window.__strips = (frames = 3, stride = 60) =>
  strips(false, 'shader', frames, stride);
window.__stripsComposite = (frames = 3, stride = 60) =>
  strips(true, 'hybrid', frames, stride);

applyLayout();
refreshMetrics(true);
drawFrame();
window.__compareReady = true;
void loop();
