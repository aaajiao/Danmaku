/**
 * Build the three project-owned actor sheets shipped by `packs/v4`.
 *
 * Player/enemy sheets are the already accepted compiled production art. The
 * Boss sheet is rebuilt from the isolated 5×5 source master below: that master
 * is visually gridded, but several tall poses cross mathematical fifths of the
 * image, so equal-width/equal-height crops are expressly forbidden here.
 *
 * Instead, every non-black source pixel is assigned through its connected
 * foreground component to one of the 25 known pose centres. The only touching
 * pair (magistrate close / chancellor neutral) is separated at the measured
 * black-valley row. Each Boss identity then shares one scale across all five
 * poses, is bottom-aligned, and clears an 8px transparent gutter in its 192px
 * runtime frame. Forward area binning means every assigned source pixel
 * contributes to the compiled atlas; thin roots and chains cannot disappear
 * between nearest-neighbour samples.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  PackActorAssets,
  PackActorSheet,
  PackBulletStrip,
} from '../src/packs/manifest';
import { decodePng } from './png-decode';
import { ColourType, encodePng, parsePng } from './png';

const ROOT = join(import.meta.dir, '..');
const PLAYER_SOURCE = join(ROOT, 'src', 'assets', 'v4', 'actors-player-v4.png');
const ENEMY_SOURCE = join(ROOT, 'src', 'assets', 'v4', 'actors-enemies-v4.png');
export const V4_BOSS_ATLAS_MASTER = join(
  ROOT,
  'docs',
  'art',
  'v4',
  'boss-cast-ghoststyle-atlas-master.png',
);

export const V4_BOSS_ATLAS_MASTER_SHA256 = createHash('sha256')
  .update(readFileSync(V4_BOSS_ATLAS_MASTER))
  .digest('hex');

export const V4_PLAYER_ACTOR_NAMES = [
  'scout',
  'lance',
  'hound',
  'spire',
  'maw',
] as const;

export const V4_ENEMY_ACTOR_NAMES = [
  'grunt',
  'weaver',
  'turret',
  'drifter',
  'lash',
  'hunter',
  'censer',
  'bastion',
  'clerk',
  'stele',
  'summons',
  'ray',
  'assessor',
  'usher',
  'marshal',
  'notary',
] as const;

export const V4_BOSS_ACTOR_NAMES = [
  'sentinel',
  'warden',
  'magistrate',
  'chancellor',
  'regent',
] as const;

const BOSS_SOURCE_X = [104, 344, 582, 830, 1082] as const;
const BOSS_SOURCE_Y = [150, 423, 667, 920, 1149] as const;
const BOSS_TOUCH_SPLIT_Y = 800;
const BOSS_FRAME = 192;
const BOSS_GUTTER = 8;
const BOSS_INNER = BOSS_FRAME - BOSS_GUTTER * 2;
// The generated RGB master carries a faint 1–11/255 compression haze across
// nominal black. Treating that haze as foreground joins distant poses through
// the background; 12 is the first stable component threshold.
const BLACK_FLOOR = 12;
const OPAQUE_FLOOR = 24;

interface Component {
  readonly pixels: number[];
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly cx: number;
  readonly cy: number;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  count: number;
}

export interface V4ActorAssetsBuild {
  readonly assets: PackActorAssets;
  readonly files: ReadonlyMap<string, Uint8Array>;
}

function actorStrip(
  x: number,
  y: number,
  frameW: number,
  frameH: number,
  frames: number,
  ticksPerFrame: number,
  mode: 'loop' | 'once',
): PackBulletStrip {
  return {
    x,
    y,
    frameW,
    frameH,
    frames,
    stride: frameW,
    ticksPerFrame,
    mode,
    color: 'baked',
  };
}

function playerSheet(): PackActorSheet {
  return {
    sheet: 'actors/players.png',
    strips: Object.fromEntries(
      V4_PLAYER_ACTOR_NAMES.map((name, i) => [
        `actor.player.${name}`,
        actorStrip(0, i * 128, 128, 128, 5, 1, 'once'),
      ]),
    ),
  };
}

function enemySheet(): PackActorSheet {
  return {
    sheet: 'actors/enemies.png',
    strips: Object.fromEntries(
      V4_ENEMY_ACTOR_NAMES.map((name, i) => [
        `actor.enemy.${name}`,
        actorStrip((i % 2) * 512, Math.floor(i / 2) * 128, 128, 128, 4, 8, 'loop'),
      ]),
    ),
  };
}

function bossSheet(): PackActorSheet {
  return {
    sheet: 'actors/bosses.png',
    strips: Object.fromEntries(
      V4_BOSS_ACTOR_NAMES.map((name, i) => [
        `actor.boss.${name}`,
        actorStrip(0, i * BOSS_FRAME, BOSS_FRAME, BOSS_FRAME, 5, 12, 'loop'),
      ]),
    ),
  };
}

function keyedAlpha(r: number, g: number, b: number, sourceAlpha: number): number {
  const peak = Math.max(r, g, b);
  if (peak <= BLACK_FLOOR || sourceAlpha === 0) return 0;
  if (peak >= OPAQUE_FLOOR) return sourceAlpha;
  return Math.round(
    sourceAlpha * (peak - BLACK_FLOOR) / (OPAQUE_FLOOR - BLACK_FLOOR),
  );
}

function foregroundComponents(
  rgba: Uint8Array,
  width: number,
  height: number,
): Component[] {
  const foreground = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p++) {
    const at = p * 4;
    foreground[p] =
      keyedAlpha(rgba[at]!, rgba[at + 1]!, rgba[at + 2]!, rgba[at + 3]!) > 0
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

      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oy === 0) continue;
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const next = ny * width + nx;
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

function nearestPose(cx: number, cy: number): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let row = 0; row < 5; row++) {
    for (let column = 0; column < 5; column++) {
      // Source spacing is close to square. Normalising both axes makes the
      // assignment stable if a future accepted master changes resolution.
      const dx = (cx - BOSS_SOURCE_X[column]!) / 240;
      const dy = (cy - BOSS_SOURCE_Y[row]!) / 250;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = row * 5 + column;
      }
    }
  }
  return best;
}

function assignBossPixels(
  rgba: Uint8Array,
  width: number,
  height: number,
): Int8Array {
  const assignment = new Int8Array(width * height);
  assignment.fill(-1);

  for (const component of foregroundComponents(rgba, width, height)) {
    const crossesKnownTouch =
      component.minX <= BOSS_SOURCE_X[2]! &&
      component.maxX >= BOSS_SOURCE_X[2]! &&
      component.minY < BOSS_TOUCH_SPLIT_Y &&
      component.maxY > BOSS_TOUCH_SPLIT_Y;

    if (crossesKnownTouch) {
      // The two silhouettes meet through a few pixels at the projection valley.
      // Split the connected component without dropping that bridge: each pixel
      // goes to exactly one of the two adjacent poses.
      for (const point of component.pixels) {
        const y = Math.floor(point / width);
        assignment[point] = y <= BOSS_TOUCH_SPLIT_Y ? 12 : 17;
      }
      continue;
    }

    const pose = nearestPose(component.cx, component.cy);
    for (const point of component.pixels) assignment[point] = pose;
  }

  return assignment;
}

function boundsByPose(assignment: Int8Array, width: number): Bounds[] {
  const bounds = Array.from({ length: 25 }, (): Bounds => ({
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    count: 0,
  }));
  for (let point = 0; point < assignment.length; point++) {
    const pose = assignment[point]!;
    if (pose < 0) continue;
    const y = Math.floor(point / width);
    const x = point - y * width;
    const bound = bounds[pose]!;
    bound.minX = Math.min(bound.minX, x);
    bound.minY = Math.min(bound.minY, y);
    bound.maxX = Math.max(bound.maxX, x);
    bound.maxY = Math.max(bound.maxY, y);
    bound.count++;
  }
  for (let pose = 0; pose < bounds.length; pose++) {
    if (bounds[pose]!.count < 100) {
      throw new Error(`Boss source pose ${pose} has only ${bounds[pose]!.count} assigned pixels`);
    }
  }
  return bounds;
}

/**
 * Compile the isolated Boss source into the exact 960×960 runtime sheet.
 * Exported so tests can prove the committed pack file is a byte-exact rebuild.
 */
export function buildV4BossActorAtlas(sourceBytes = readFileSync(V4_BOSS_ATLAS_MASTER)): Uint8Array {
  const source = decodePng(sourceBytes);
  const assignment = assignBossPixels(source.rgba, source.width, source.height);
  const bounds = boundsByPose(assignment, source.width);
  const output = new Uint8Array(BOSS_FRAME * 5 * BOSS_FRAME * 5 * 4);

  for (let row = 0; row < 5; row++) {
    let commonW = 0;
    let commonH = 0;
    for (let column = 0; column < 5; column++) {
      const bound = bounds[row * 5 + column]!;
      commonW = Math.max(commonW, bound.maxX - bound.minX + 1);
      commonH = Math.max(commonH, bound.maxY - bound.minY + 1);
    }
    const scale = Math.min(BOSS_INNER / commonW, BOSS_INNER / commonH);

    for (let column = 0; column < 5; column++) {
      const pose = row * 5 + column;
      const bound = bounds[pose]!;
      const sourceW = bound.maxX - bound.minX + 1;
      const sourceH = bound.maxY - bound.minY + 1;
      const destW = Math.max(1, Math.round(sourceW * scale));
      const destH = Math.max(1, Math.round(sourceH * scale));
      const destX =
        column * BOSS_FRAME + BOSS_GUTTER + Math.floor((BOSS_INNER - destW) / 2);
      const destY =
        row * BOSS_FRAME + BOSS_GUTTER + BOSS_INNER - destH;
      const bins = destW * destH;
      const sumR = new Float64Array(bins);
      const sumG = new Float64Array(bins);
      const sumB = new Float64Array(bins);
      const sumAlpha = new Float64Array(bins);
      const maxAlpha = new Uint8Array(bins);

      // Forward binning: unlike point sampling, every source foreground pixel
      // reaches a destination pixel even when the pose is scaled down.
      for (let y = bound.minY; y <= bound.maxY; y++) {
        for (let x = bound.minX; x <= bound.maxX; x++) {
          const point = y * source.width + x;
          if (assignment[point] !== pose) continue;
          const at = point * 4;
          const alpha = keyedAlpha(
            source.rgba[at]!,
            source.rgba[at + 1]!,
            source.rgba[at + 2]!,
            source.rgba[at + 3]!,
          );
          if (alpha === 0) continue;
          const dx = Math.min(destW - 1, Math.floor((x - bound.minX) * destW / sourceW));
          const dy = Math.min(destH - 1, Math.floor((y - bound.minY) * destH / sourceH));
          const bin = dy * destW + dx;
          sumR[bin] = sumR[bin]! + source.rgba[at]! * alpha;
          sumG[bin] = sumG[bin]! + source.rgba[at + 1]! * alpha;
          sumB[bin] = sumB[bin]! + source.rgba[at + 2]! * alpha;
          sumAlpha[bin] = sumAlpha[bin]! + alpha;
          maxAlpha[bin] = Math.max(maxAlpha[bin]!, alpha);
        }
      }

      for (let dy = 0; dy < destH; dy++) {
        for (let dx = 0; dx < destW; dx++) {
          const bin = dy * destW + dx;
          if (sumAlpha[bin] === 0) continue;
          const outputAt =
            (((destY + dy) * BOSS_FRAME * 5) + destX + dx) * 4;
          output[outputAt] = Math.round(sumR[bin]! / sumAlpha[bin]!);
          output[outputAt + 1] = Math.round(sumG[bin]! / sumAlpha[bin]!);
          output[outputAt + 2] = Math.round(sumB[bin]! / sumAlpha[bin]!);
          output[outputAt + 3] = maxAlpha[bin]!;
        }
      }
    }
  }

  const bytes = encodePng(
    BOSS_FRAME * 5,
    BOSS_FRAME * 5,
    ColourType.RGBA,
    (x, y) => {
      const at = (y * BOSS_FRAME * 5 + x) * 4;
      return [
        output[at]!,
        output[at + 1]!,
        output[at + 2]!,
        output[at + 3]!,
      ];
    },
  );
  const checked = parsePng(bytes);
  if (checked.width !== 960 || checked.height !== 960) {
    throw new Error(`compiled Boss atlas is ${checked.width}×${checked.height}, expected 960×960`);
  }
  return bytes;
}

export function buildV4ActorAssets(): V4ActorAssetsBuild {
  const players = readFileSync(PLAYER_SOURCE);
  const enemies = readFileSync(ENEMY_SOURCE);
  const playerImage = decodePng(players);
  const enemyImage = decodePng(enemies);
  if (playerImage.width !== 640 || playerImage.height !== 640) {
    throw new Error(
      `compiled player atlas is ${playerImage.width}×${playerImage.height}, expected 640×640`,
    );
  }
  if (enemyImage.width !== 1024 || enemyImage.height !== 1024) {
    throw new Error(
      `compiled enemy atlas is ${enemyImage.width}×${enemyImage.height}, expected 1024×1024`,
    );
  }

  return {
    assets: {
      players: playerSheet(),
      enemies: enemySheet(),
      bosses: bossSheet(),
    },
    files: new Map([
      ['actors/players.png', players],
      ['actors/enemies.png', enemies],
      ['actors/bosses.png', buildV4BossActorAtlas()],
    ]),
  };
}
