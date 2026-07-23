/**
 * Build the dedicated high-resolution dialogue atlas shipped by `packs/v4`.
 *
 * Field actors are intentionally not a source here. They have already been
 * reduced to 128px/192px full-body frames, so enlarging one of their close
 * crops throws away the face detail the dialogue well needs. This compiler
 * instead reads the accepted RGB player and Boss masters, selects the neutral
 * player / cast Boss identity through connected-component ownership, and
 * scales ten authored close crops into independent 256px cells.
 *
 * The generated masters are black-backed RGB. Their antialiased edges are
 * therefore already colour-premultiplied over black. `keyedAlpha` recovers a
 * soft matte; the bilinear accumulator keeps the original RGB contribution
 * while accumulating that matte separately, which uncomposites the black edge
 * before returning to straight-alpha PNG pixels. Every cell keeps an 8px
 * transparent gutter so browser smoothing cannot sample a neighbouring face.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PackActorSheet, PackBulletStrip } from '../src/packs/manifest';
import { decodePng } from './png-decode';
import { ColourType, encodePng, parsePng } from './png';

const ROOT = join(import.meta.dir, '..');

export const V4_PORTRAIT_PLAYER_MASTER = join(
  ROOT,
  'docs',
  'art',
  'v4',
  'player-cast-ghoststyle-master.png',
);
export const V4_PORTRAIT_BOSS_MASTER = join(
  ROOT,
  'docs',
  'art',
  'v4',
  'boss-cast-ghoststyle-atlas-master.png',
);

export const V4_PORTRAIT_PLAYER_MASTER_SHA256 =
  'b3802eb6c125bf002031d19112b8d106d7f3664ece81c40196b81844fb1acc4a';
export const V4_PORTRAIT_BOSS_MASTER_SHA256 =
  'a347c84259269c10b21100534c45614a71b307a7ae6eab240e7eeb456e8d18e7';

const PLAYER_SOURCE_WIDTH = 1024;
const PLAYER_SOURCE_HEIGHT = 1536;
const BOSS_SOURCE_WIDTH = 1254;
const BOSS_SOURCE_HEIGHT = 1254;

export const V4_DIALOGUE_PORTRAIT_SHEET = 'actors/portraits.png';
export const V4_DIALOGUE_PORTRAIT_FRAME = 256;
export const V4_DIALOGUE_PORTRAIT_COLUMNS = 5;
export const V4_DIALOGUE_PORTRAIT_ROWS = 2;
export const V4_DIALOGUE_PORTRAIT_GUTTER = 8;
export const V4_DIALOGUE_PORTRAIT_INNER =
  V4_DIALOGUE_PORTRAIT_FRAME - V4_DIALOGUE_PORTRAIT_GUTTER * 2;
export const V4_DIALOGUE_PORTRAIT_ATLAS_WIDTH =
  V4_DIALOGUE_PORTRAIT_FRAME * V4_DIALOGUE_PORTRAIT_COLUMNS;
export const V4_DIALOGUE_PORTRAIT_ATLAS_HEIGHT =
  V4_DIALOGUE_PORTRAIT_FRAME * V4_DIALOGUE_PORTRAIT_ROWS;

const BLACK_FLOOR = 12;
const OPAQUE_FLOOR = 24;

export type V4DialoguePortraitFamily = 'player' | 'boss';

export interface V4DialoguePortraitCrop {
  readonly name: string;
  readonly strip: string;
  readonly family: V4DialoguePortraitFamily;
  /** Neutral players and cast Bosses are both semantic pose 2. */
  readonly pose: number;
  readonly sourceX: number;
  readonly sourceY: number;
  readonly sourceSize: number;
  readonly atlasColumn: number;
  readonly atlasRow: number;
}

/**
 * Authored close framings in manifest order.
 *
 * Every crop starts eight source pixels above its owned silhouette. Most use a
 * 176px square; Warden needs 192px to retain the cage that identifies her. The
 * crop then maps into the shared 240px inner cell, so all ten retain the same
 * atlas gutter without pretending their source silhouettes have one scale.
 */
export const V4_DIALOGUE_PORTRAIT_CROPS: readonly V4DialoguePortraitCrop[] = [
  {
    name: 'scout',
    strip: 'actor.portrait.player.scout',
    family: 'player',
    pose: 2,
    sourceX: 422,
    sourceY: 39,
    sourceSize: 176,
    atlasColumn: 0,
    atlasRow: 0,
  },
  {
    name: 'lance',
    strip: 'actor.portrait.player.lance',
    family: 'player',
    pose: 7,
    sourceX: 423,
    sourceY: 325,
    sourceSize: 176,
    atlasColumn: 1,
    atlasRow: 0,
  },
  {
    name: 'hound',
    strip: 'actor.portrait.player.hound',
    family: 'player',
    pose: 12,
    sourceX: 424,
    sourceY: 651,
    sourceSize: 176,
    atlasColumn: 2,
    atlasRow: 0,
  },
  {
    name: 'spire',
    strip: 'actor.portrait.player.spire',
    family: 'player',
    pose: 17,
    sourceX: 424,
    sourceY: 918,
    sourceSize: 176,
    atlasColumn: 3,
    atlasRow: 0,
  },
  {
    name: 'maw',
    strip: 'actor.portrait.player.maw',
    family: 'player',
    pose: 22,
    sourceX: 423,
    sourceY: 1221,
    sourceSize: 176,
    atlasColumn: 4,
    atlasRow: 0,
  },
  {
    name: 'sentinel',
    strip: 'actor.portrait.boss.sentinel',
    family: 'boss',
    pose: 2,
    sourceX: 494,
    sourceY: 23,
    sourceSize: 176,
    atlasColumn: 0,
    atlasRow: 1,
  },
  {
    name: 'warden',
    strip: 'actor.portrait.boss.warden',
    family: 'boss',
    pose: 7,
    sourceX: 486,
    sourceY: 278,
    sourceSize: 192,
    atlasColumn: 1,
    atlasRow: 1,
  },
  {
    name: 'magistrate',
    strip: 'actor.portrait.boss.magistrate',
    family: 'boss',
    pose: 12,
    sourceX: 494,
    sourceY: 542,
    sourceSize: 176,
    atlasColumn: 2,
    atlasRow: 1,
  },
  {
    name: 'chancellor',
    strip: 'actor.portrait.boss.chancellor',
    family: 'boss',
    pose: 17,
    sourceX: 494,
    sourceY: 793,
    sourceSize: 176,
    atlasColumn: 3,
    atlasRow: 1,
  },
  {
    name: 'regent',
    strip: 'actor.portrait.boss.regent',
    family: 'boss',
    pose: 22,
    sourceX: 494,
    sourceY: 1022,
    sourceSize: 176,
    atlasColumn: 4,
    atlasRow: 1,
  },
] as const;

function portraitStrip(x: number, y: number): PackBulletStrip {
  return {
    x,
    y,
    frameW: V4_DIALOGUE_PORTRAIT_FRAME,
    frameH: V4_DIALOGUE_PORTRAIT_FRAME,
    frames: 1,
    stride: V4_DIALOGUE_PORTRAIT_FRAME,
    ticksPerFrame: 1,
    mode: 'once',
    color: 'baked',
  };
}

/** The pack-manifest actor family paired with the generated PNG bytes. */
export function v4DialoguePortraitSheet(): PackActorSheet {
  return {
    sheet: V4_DIALOGUE_PORTRAIT_SHEET,
    strips: Object.fromEntries(
      V4_DIALOGUE_PORTRAIT_CROPS.map((crop) => [
        crop.strip,
        portraitStrip(
          crop.atlasColumn * V4_DIALOGUE_PORTRAIT_FRAME,
          crop.atlasRow * V4_DIALOGUE_PORTRAIT_FRAME,
        ),
      ]),
    ),
  };
}

interface Component {
  readonly pixels: number[];
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly cx: number;
  readonly cy: number;
}

interface PoseGrid {
  readonly x: readonly number[];
  readonly y: readonly number[];
  readonly normalizeX: number;
  readonly normalizeY: number;
}

const PLAYER_POSE_GRID: PoseGrid = {
  x: [104, 306, 510, 716, 920],
  y: [178, 480, 785, 1084, 1355],
  normalizeX: 205,
  normalizeY: 302,
};

const BOSS_POSE_GRID: PoseGrid = {
  x: [104, 344, 582, 830, 1082],
  y: [150, 423, 667, 920, 1149],
  normalizeX: 240,
  normalizeY: 250,
};

const BOSS_TOUCH_SPLIT_Y = 800;

/**
 * Generated black carries a faint 1–11/255 compression haze. Twelve is the
 * first stable component threshold; 24 and above is accepted as opaque art.
 */
export function v4PortraitKeyedAlpha(
  red: number,
  green: number,
  blue: number,
  sourceAlpha: number,
): number {
  const peak = Math.max(red, green, blue);
  if (peak <= BLACK_FLOOR || sourceAlpha === 0) return 0;
  if (peak >= OPAQUE_FLOOR) return sourceAlpha;
  return Math.round(
    sourceAlpha *
      (peak - BLACK_FLOOR) /
      (OPAQUE_FLOOR - BLACK_FLOOR),
  );
}

function foregroundComponents(
  rgba: Uint8Array,
  width: number,
  height: number,
): Component[] {
  const foreground = new Uint8Array(width * height);
  for (let point = 0; point < foreground.length; point++) {
    const at = point * 4;
    foreground[point] =
      v4PortraitKeyedAlpha(
        rgba[at]!,
        rgba[at + 1]!,
        rgba[at + 2]!,
        rgba[at + 3]!,
      ) > 0
        ? 1
        : 0;
  }

  const seen = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const components: Component[] = [];

  for (let seed = 0; seed < foreground.length; seed++) {
    if (foreground[seed] === 0 || seen[seed] !== 0) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = seed;
    seen[seed] = 1;
    const pixels: number[] = [];
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let sumX = 0;
    let sumY = 0;

    while (head < tail) {
      const point = queue[head++]!;
      const y = Math.floor(point / width);
      const x = point - y * width;
      pixels.push(point);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      sumX += x;
      sumY += y;

      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          if (offsetX === 0 && offsetY === 0) continue;
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (
            nextX < 0 ||
            nextX >= width ||
            nextY < 0 ||
            nextY >= height
          ) {
            continue;
          }
          const next = nextY * width + nextX;
          if (foreground[next] === 0 || seen[next] !== 0) continue;
          seen[next] = 1;
          queue[tail++] = next;
        }
      }
    }

    components.push({
      pixels,
      minX,
      minY,
      maxX,
      maxY,
      cx: sumX / pixels.length,
      cy: sumY / pixels.length,
    });
  }
  return components;
}

function nearestPose(cx: number, cy: number, grid: PoseGrid): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let row = 0; row < 5; row++) {
    for (let column = 0; column < 5; column++) {
      const dx = (cx - grid.x[column]!) / grid.normalizeX;
      const dy = (cy - grid.y[row]!) / grid.normalizeY;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = row * 5 + column;
      }
    }
  }
  return best;
}

function assignPosePixels(
  rgba: Uint8Array,
  width: number,
  height: number,
  family: V4DialoguePortraitFamily,
): Int8Array {
  const assignment = new Int8Array(width * height);
  assignment.fill(-1);
  const grid = family === 'player' ? PLAYER_POSE_GRID : BOSS_POSE_GRID;

  for (const component of foregroundComponents(rgba, width, height)) {
    const crossesBossTouch =
      family === 'boss' &&
      component.minX <= BOSS_POSE_GRID.x[2]! &&
      component.maxX >= BOSS_POSE_GRID.x[2]! &&
      component.minY < BOSS_TOUCH_SPLIT_Y &&
      component.maxY > BOSS_TOUCH_SPLIT_Y;

    if (crossesBossTouch) {
      // Magistrate cast and Chancellor cast touch through a black-valley bridge.
      // The accepted Boss compiler owns the same split and drops no bridge pixel.
      for (const point of component.pixels) {
        const y = Math.floor(point / width);
        assignment[point] = y <= BOSS_TOUCH_SPLIT_Y ? 12 : 17;
      }
      continue;
    }

    const pose = nearestPose(component.cx, component.cy, grid);
    for (const point of component.pixels) assignment[point] = pose;
  }
  return assignment;
}

function foregroundCount(rgba: Uint8Array): number {
  let count = 0;
  for (let at = 0; at < rgba.length; at += 4) {
    if (
      v4PortraitKeyedAlpha(
        rgba[at]!,
        rgba[at + 1]!,
        rgba[at + 2]!,
        rgba[at + 3]!,
      ) > 0
    ) {
      count++;
    }
  }
  return count;
}

function assignedCount(assignment: Int8Array): number {
  let count = 0;
  for (const pose of assignment) {
    if (pose >= 0) count++;
  }
  return count;
}

function channel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export interface V4DialoguePortraitAlphaBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface V4DialoguePortraitPlacement {
  readonly name: string;
  readonly strip: string;
  readonly family: V4DialoguePortraitFamily;
  readonly pose: number;
  readonly sourceX: number;
  readonly sourceY: number;
  readonly sourceSize: number;
  readonly destX: number;
  readonly destY: number;
  readonly destSize: number;
  readonly sourcePixels: number;
  readonly sourceAlpha: number;
  readonly outputPixels: number;
  readonly outputBounds: V4DialoguePortraitAlphaBounds;
}

export interface V4DialoguePortraitAtlasBuild {
  readonly bytes: Uint8Array;
  readonly playerSourceForegroundPixels: number;
  readonly playerAssignedForegroundPixels: number;
  readonly bossSourceForegroundPixels: number;
  readonly bossAssignedForegroundPixels: number;
  readonly placements: readonly V4DialoguePortraitPlacement[];
}

interface DecodedSource {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
  readonly assignment: Int8Array;
}

function checkedSource(
  family: V4DialoguePortraitFamily,
  bytes: Uint8Array,
  expectedHash: string,
  expectedWidth: number,
  expectedHeight: number,
): {
  readonly source: DecodedSource;
  readonly sourceForegroundPixels: number;
  readonly assignedForegroundPixels: number;
} {
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== expectedHash) {
    throw new Error(
      `${family} portrait master SHA-256 is ${hash}, expected ${expectedHash}`,
    );
  }
  const decoded = decodePng(bytes);
  if (decoded.width !== expectedWidth || decoded.height !== expectedHeight) {
    throw new Error(
      `${family} portrait master is ${decoded.width}×${decoded.height}, ` +
        `expected ${expectedWidth}×${expectedHeight}`,
    );
  }
  const assignment = assignPosePixels(
    decoded.rgba,
    decoded.width,
    decoded.height,
    family,
  );
  const sourceForegroundPixels = foregroundCount(decoded.rgba);
  const assignedForegroundPixels = assignedCount(assignment);
  if (assignedForegroundPixels !== sourceForegroundPixels) {
    throw new Error(
      `${family} portrait assignment lost ` +
        `${sourceForegroundPixels - assignedForegroundPixels} pixels`,
    );
  }
  return {
    source: {
      width: decoded.width,
      height: decoded.height,
      rgba: decoded.rgba,
      assignment,
    },
    sourceForegroundPixels,
    assignedForegroundPixels,
  };
}

interface MutablePlacement {
  readonly crop: V4DialoguePortraitCrop;
  readonly destX: number;
  readonly destY: number;
  readonly sourcePixels: number;
  readonly sourceAlpha: number;
}

function validateCrop(
  crop: V4DialoguePortraitCrop,
  source: DecodedSource,
): void {
  if (
    crop.sourceX < 0 ||
    crop.sourceY < 0 ||
    crop.sourceX + crop.sourceSize > source.width ||
    crop.sourceY + crop.sourceSize > source.height
  ) {
    throw new Error(
      `${crop.family} portrait "${crop.name}" crop ` +
        `${crop.sourceX},${crop.sourceY} ${crop.sourceSize}×${crop.sourceSize} ` +
        `exceeds ${source.width}×${source.height}`,
    );
  }
  if (
    crop.atlasColumn < 0 ||
    crop.atlasColumn >= V4_DIALOGUE_PORTRAIT_COLUMNS ||
    crop.atlasRow < 0 ||
    crop.atlasRow >= V4_DIALOGUE_PORTRAIT_ROWS
  ) {
    throw new Error(
      `${crop.family} portrait "${crop.name}" atlas cell is outside ` +
        `${V4_DIALOGUE_PORTRAIT_COLUMNS}×${V4_DIALOGUE_PORTRAIT_ROWS}`,
    );
  }
}

function sourceAudit(
  crop: V4DialoguePortraitCrop,
  source: DecodedSource,
): { pixels: number; alpha: number } {
  let pixels = 0;
  let alpha = 0;
  for (let y = crop.sourceY; y < crop.sourceY + crop.sourceSize; y++) {
    for (let x = crop.sourceX; x < crop.sourceX + crop.sourceSize; x++) {
      const point = y * source.width + x;
      if (source.assignment[point] !== crop.pose) continue;
      const at = point * 4;
      const sourceAlpha = v4PortraitKeyedAlpha(
        source.rgba[at]!,
        source.rgba[at + 1]!,
        source.rgba[at + 2]!,
        source.rgba[at + 3]!,
      );
      if (sourceAlpha === 0) continue;
      pixels++;
      alpha += sourceAlpha;
    }
  }
  return { pixels, alpha };
}

/**
 * Bilinear-scale one strict source crop into the 240px inner destination.
 *
 * Samples outside the authored crop are transparent, even when another part
 * of the same pose continues there. This keeps the ledger's square a real crop
 * and lets the bilinear kernel antialias its lower bust boundary instead of
 * borrowing a hidden row of pixels.
 */
function paintCrop(
  output: Uint8Array,
  crop: V4DialoguePortraitCrop,
  source: DecodedSource,
): MutablePlacement {
  validateCrop(crop, source);
  const destX =
    crop.atlasColumn * V4_DIALOGUE_PORTRAIT_FRAME +
    V4_DIALOGUE_PORTRAIT_GUTTER;
  const destY =
    crop.atlasRow * V4_DIALOGUE_PORTRAIT_FRAME +
    V4_DIALOGUE_PORTRAIT_GUTTER;
  const audit = sourceAudit(crop, source);
  if (audit.pixels < 100) {
    throw new Error(
      `${crop.family} portrait "${crop.name}" has only ${audit.pixels} source pixels`,
    );
  }

  for (let dy = 0; dy < V4_DIALOGUE_PORTRAIT_INNER; dy++) {
    const sourceY =
      crop.sourceY +
      ((dy + 0.5) * crop.sourceSize) / V4_DIALOGUE_PORTRAIT_INNER -
      0.5;
    const firstY = Math.floor(sourceY);
    const fractionY = sourceY - firstY;

    for (let dx = 0; dx < V4_DIALOGUE_PORTRAIT_INNER; dx++) {
      const sourceX =
        crop.sourceX +
        ((dx + 0.5) * crop.sourceSize) / V4_DIALOGUE_PORTRAIT_INNER -
        0.5;
      const firstX = Math.floor(sourceX);
      const fractionX = sourceX - firstX;
      let weightedAlpha = 0;
      let premultipliedRed = 0;
      let premultipliedGreen = 0;
      let premultipliedBlue = 0;

      for (let offsetY = 0; offsetY <= 1; offsetY++) {
        const y = firstY + offsetY;
        if (y < crop.sourceY || y >= crop.sourceY + crop.sourceSize) continue;
        const yWeight = offsetY === 0 ? 1 - fractionY : fractionY;
        for (let offsetX = 0; offsetX <= 1; offsetX++) {
          const x = firstX + offsetX;
          if (x < crop.sourceX || x >= crop.sourceX + crop.sourceSize) continue;
          const xWeight = offsetX === 0 ? 1 - fractionX : fractionX;
          const weight = xWeight * yWeight;
          const point = y * source.width + x;
          if (source.assignment[point] !== crop.pose) continue;
          const at = point * 4;
          const alpha =
            v4PortraitKeyedAlpha(
              source.rgba[at]!,
              source.rgba[at + 1]!,
              source.rgba[at + 2]!,
              source.rgba[at + 3]!,
            ) / 255;
          if (alpha === 0) continue;

          weightedAlpha += alpha * weight;
          // RGB is already premultiplied over the master's black background.
          // Accumulate it without multiplying by alpha a second time.
          premultipliedRed += source.rgba[at]! * weight;
          premultipliedGreen += source.rgba[at + 1]! * weight;
          premultipliedBlue += source.rgba[at + 2]! * weight;
        }
      }

      if (weightedAlpha === 0) continue;
      const outputAlpha = channel(weightedAlpha * 255);
      if (outputAlpha === 0) continue;
      const outputAt =
        (((destY + dy) * V4_DIALOGUE_PORTRAIT_ATLAS_WIDTH) + destX + dx) * 4;
      output[outputAt] = channel(premultipliedRed / weightedAlpha);
      output[outputAt + 1] = channel(premultipliedGreen / weightedAlpha);
      output[outputAt + 2] = channel(premultipliedBlue / weightedAlpha);
      output[outputAt + 3] = outputAlpha;
    }
  }

  return {
    crop,
    destX,
    destY,
    sourcePixels: audit.pixels,
    sourceAlpha: audit.alpha,
  };
}

function outputAudit(
  output: Uint8Array,
  placement: MutablePlacement,
): V4DialoguePortraitPlacement {
  let outputPixels = 0;
  let minX = V4_DIALOGUE_PORTRAIT_FRAME;
  let minY = V4_DIALOGUE_PORTRAIT_FRAME;
  let maxX = -1;
  let maxY = -1;
  const frameX =
    placement.crop.atlasColumn * V4_DIALOGUE_PORTRAIT_FRAME;
  const frameY =
    placement.crop.atlasRow * V4_DIALOGUE_PORTRAIT_FRAME;

  for (let y = 0; y < V4_DIALOGUE_PORTRAIT_FRAME; y++) {
    for (let x = 0; x < V4_DIALOGUE_PORTRAIT_FRAME; x++) {
      const at =
        ((((frameY + y) * V4_DIALOGUE_PORTRAIT_ATLAS_WIDTH) + frameX + x) * 4);
      if (output[at + 3] === 0) continue;
      outputPixels++;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (outputPixels === 0) {
    throw new Error(
      `${placement.crop.family} portrait "${placement.crop.name}" is empty`,
    );
  }
  if (
    minX < V4_DIALOGUE_PORTRAIT_GUTTER ||
    minY < V4_DIALOGUE_PORTRAIT_GUTTER ||
    maxX >= V4_DIALOGUE_PORTRAIT_FRAME - V4_DIALOGUE_PORTRAIT_GUTTER ||
    maxY >= V4_DIALOGUE_PORTRAIT_FRAME - V4_DIALOGUE_PORTRAIT_GUTTER
  ) {
    throw new Error(
      `${placement.crop.family} portrait "${placement.crop.name}" crosses its gutter`,
    );
  }

  return {
    name: placement.crop.name,
    strip: placement.crop.strip,
    family: placement.crop.family,
    pose: placement.crop.pose,
    sourceX: placement.crop.sourceX,
    sourceY: placement.crop.sourceY,
    sourceSize: placement.crop.sourceSize,
    destX: placement.destX,
    destY: placement.destY,
    destSize: V4_DIALOGUE_PORTRAIT_INNER,
    sourcePixels: placement.sourcePixels,
    sourceAlpha: placement.sourceAlpha,
    outputPixels,
    outputBounds: { minX, minY, maxX, maxY },
  };
}

/** Compile and return both PNG bytes and audit evidence for the ten cells. */
export function buildV4DialoguePortraitAtlasWithAudit(
  playerSourceBytes: Uint8Array = readFileSync(V4_PORTRAIT_PLAYER_MASTER),
  bossSourceBytes: Uint8Array = readFileSync(V4_PORTRAIT_BOSS_MASTER),
): V4DialoguePortraitAtlasBuild {
  const player = checkedSource(
    'player',
    playerSourceBytes,
    V4_PORTRAIT_PLAYER_MASTER_SHA256,
    PLAYER_SOURCE_WIDTH,
    PLAYER_SOURCE_HEIGHT,
  );
  const boss = checkedSource(
    'boss',
    bossSourceBytes,
    V4_PORTRAIT_BOSS_MASTER_SHA256,
    BOSS_SOURCE_WIDTH,
    BOSS_SOURCE_HEIGHT,
  );
  const output = new Uint8Array(
    V4_DIALOGUE_PORTRAIT_ATLAS_WIDTH *
      V4_DIALOGUE_PORTRAIT_ATLAS_HEIGHT *
      4,
  );
  const mutable: MutablePlacement[] = [];

  for (const crop of V4_DIALOGUE_PORTRAIT_CROPS) {
    mutable.push(
      paintCrop(
        output,
        crop,
        crop.family === 'player' ? player.source : boss.source,
      ),
    );
  }
  const placements = mutable.map((placement) =>
    outputAudit(output, placement),
  );

  const bytes = encodePng(
    V4_DIALOGUE_PORTRAIT_ATLAS_WIDTH,
    V4_DIALOGUE_PORTRAIT_ATLAS_HEIGHT,
    ColourType.RGBA,
    (x, y) => {
      const at = (y * V4_DIALOGUE_PORTRAIT_ATLAS_WIDTH + x) * 4;
      return [
        output[at]!,
        output[at + 1]!,
        output[at + 2]!,
        output[at + 3]!,
      ];
    },
  );
  const checked = parsePng(bytes);
  if (
    checked.width !== V4_DIALOGUE_PORTRAIT_ATLAS_WIDTH ||
    checked.height !== V4_DIALOGUE_PORTRAIT_ATLAS_HEIGHT ||
    checked.colourType !== ColourType.RGBA
  ) {
    throw new Error(
      `compiled portrait atlas is ${checked.width}×${checked.height} ` +
        `type ${checked.colourType}, expected ` +
        `${V4_DIALOGUE_PORTRAIT_ATLAS_WIDTH}×` +
        `${V4_DIALOGUE_PORTRAIT_ATLAS_HEIGHT} RGBA`,
    );
  }

  return {
    bytes,
    playerSourceForegroundPixels: player.sourceForegroundPixels,
    playerAssignedForegroundPixels: player.assignedForegroundPixels,
    bossSourceForegroundPixels: boss.sourceForegroundPixels,
    bossAssignedForegroundPixels: boss.assignedForegroundPixels,
    placements,
  };
}

export function buildV4DialoguePortraitAtlas(
  playerSourceBytes: Uint8Array = readFileSync(V4_PORTRAIT_PLAYER_MASTER),
  bossSourceBytes: Uint8Array = readFileSync(V4_PORTRAIT_BOSS_MASTER),
): Uint8Array {
  return buildV4DialoguePortraitAtlasWithAudit(
    playerSourceBytes,
    bossSourceBytes,
  ).bytes;
}
