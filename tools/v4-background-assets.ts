/**
 * Compile the accepted v4 stage-background masters, Regent station and terminal
 * wear field into runtime pixel plates. Expanse, Undertow, Regnum and Wear Field
 * additionally receive deterministic sixteen-frame atlases: scene-specific
 * integer deformation derived from each accepted master, never independently
 * generated frames, so their painted silhouettes can move without visual drift
 * or sharing one motion language.
 *
 * The masters remain full-resolution composition references. Runtime art is
 * deliberately a different surface: an integer area reduction to 240×320,
 * scene-specific finite Ghost palettes, deterministic speck cleanup, then a
 * literal nearest-neighbour 2× expansion to the 480×640 play field. There is
 * no error diffusion or ordered dithering — either would create projectile-
 * sized noise in a surface whose first job is to stay behind the danmaku.
 *
 * Pure TypeScript and the repository PNG codecs only: no canvas, native image
 * library, colour profile, network input or platform-dependent resampler.
 * Run with:
 *
 *     bun tools/v4-background-assets.ts
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { decodePng, type DecodedImage } from './png-decode';
import { ColourType, encodePng, parsePng } from './png';

export const V4_BACKGROUND_WORK_WIDTH = 240;
export const V4_BACKGROUND_WORK_HEIGHT = 320;
export const V4_BACKGROUND_WIDTH = 480;
export const V4_BACKGROUND_HEIGHT = 640;
export const V4_BACKGROUND_SEQUENCE_COLUMNS = 4;
export const V4_BACKGROUND_SEQUENCE_ROWS = 4;
export const V4_BACKGROUND_SEQUENCE_FRAMES =
  V4_BACKGROUND_SEQUENCE_COLUMNS * V4_BACKGROUND_SEQUENCE_ROWS;
export const V4_BACKGROUND_SEQUENCE_WIDTH =
  V4_BACKGROUND_WORK_WIDTH * V4_BACKGROUND_SEQUENCE_COLUMNS;
export const V4_BACKGROUND_SEQUENCE_HEIGHT =
  V4_BACKGROUND_WORK_HEIGHT * V4_BACKGROUND_SEQUENCE_ROWS;

type RGB = readonly [number, number, number];
export const V4_BACKGROUND_ASSET_NAMES = [
  'expanse',
  'undertow',
  'stratum',
  'vault',
  'regnum',
  'wear-field',
] as const;
export type V4BackgroundAssetName = (typeof V4_BACKGROUND_ASSET_NAMES)[number];
export const V4_BACKGROUND_SEQUENCE_NAMES = [
  'expanse',
  'undertow',
  'regnum',
  'wear-field',
] as const;
export type V4BackgroundSequenceName = (typeof V4_BACKGROUND_SEQUENCE_NAMES)[number];

interface V4BackgroundAssetSpec {
  readonly name: V4BackgroundAssetName;
  readonly master: string;
  readonly output: string;
  readonly sequenceOutput?: string;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly sourceSha256: string;
  readonly palette: readonly RGB[];
  /**
   * Palette luma at or above this value is a highlight component. Components
   * below either the minimum area or the minimum bounding-box span are folded
   * into a darker swatch rather than surviving as false bullet-sized marks.
   */
  readonly brightFloor: number;
  readonly minimumBrightCluster: number;
  readonly minimumBrightSpan: number;
}

const ROOT = join(import.meta.dir, '..');

/**
 * Cold surface / skeleton / mycelium ramps derived for the four stage roles.
 *
 * These are finite authored palettes rather than a median-cut result. That
 * keeps the same master byte-identical across platforms and prevents a small
 * source edit from reassigning unrelated palette entries. Expanse keeps a
 * blue-slate membrane only; vault keeps black lacquer, cool graphite and
 * imperial violet. Bone-white and heart colours remain actor/projectile
 * identities and are intentionally absent from the background palettes.
 */
export const V4_BACKGROUND_PALETTES = {
  expanse: [
    [4, 10, 17],
    [7, 17, 27],
    [10, 25, 39],
    [14, 33, 48],
    [19, 42, 58],
    [26, 52, 69],
    [35, 63, 81],
    [46, 76, 94],
    [60, 90, 107],
    [77, 106, 122],
    [96, 124, 139],
    [119, 145, 158],
    [145, 167, 177],
  ],
  undertow: [
    [3, 6, 13],
    [6, 11, 21],
    [9, 17, 31],
    [13, 23, 42],
    [18, 30, 52],
    [24, 38, 63],
    [31, 47, 74],
    [39, 57, 86],
    [50, 68, 98],
    [63, 82, 111],
    [79, 97, 126],
    [96, 114, 142],
    [20, 15, 40],
    [31, 22, 57],
    [44, 31, 76],
    [59, 42, 96],
    [75, 55, 115],
  ],
  stratum: [
    [3, 7, 12],
    [7, 14, 23],
    [11, 22, 34],
    [16, 31, 44],
    [22, 40, 54],
    [30, 51, 66],
    [40, 63, 79],
    [52, 76, 91],
    [66, 91, 107],
    [84, 108, 122],
    [105, 127, 139],
    [18, 15, 27],
    [29, 22, 41],
    [43, 31, 56],
    [59, 44, 72],
    [77, 59, 88],
    [95, 78, 105],
  ],
  vault: [
    [3, 3, 5],
    [7, 7, 10],
    [12, 12, 17],
    [18, 18, 25],
    [26, 25, 34],
    [36, 34, 44],
    [48, 46, 56],
    [63, 60, 70],
    [81, 77, 87],
    [101, 98, 108],
    [116, 118, 128],
    [15, 10, 25],
    [24, 14, 40],
    [36, 20, 57],
    [50, 28, 75],
    [67, 38, 95],
    [87, 51, 117],
    [105, 68, 132],
  ],
  regnum: [
    [3, 4, 7],
    [7, 8, 12],
    [12, 14, 20],
    [18, 21, 28],
    [26, 29, 37],
    [35, 39, 48],
    [46, 51, 61],
    [59, 65, 75],
    [74, 81, 91],
    [18, 9, 14],
    [30, 13, 20],
    [44, 18, 28],
    [59, 25, 38],
    [76, 34, 49],
    [94, 46, 62],
    [47, 44, 48],
    [63, 59, 64],
    [80, 75, 80],
    [98, 91, 96],
  ],
  'wear-field': [
    [3, 6, 11],
    [7, 11, 18],
    [11, 17, 26],
    [16, 24, 35],
    [22, 32, 45],
    [29, 41, 55],
    [38, 51, 66],
    [49, 63, 78],
    [62, 76, 91],
    [77, 91, 105],
    [94, 108, 121],
    [113, 127, 138],
    [134, 146, 155],
    [24, 18, 29],
    [37, 26, 41],
    [52, 36, 55],
    [70, 49, 70],
    [90, 66, 87],
    [111, 84, 104],
  ],
} as const satisfies Record<V4BackgroundAssetName, readonly RGB[]>;

export const V4_BACKGROUND_ASSET_SPECS: Readonly<
  Record<V4BackgroundAssetName, V4BackgroundAssetSpec>
> = {
  expanse: {
    name: 'expanse',
    master: join(ROOT, 'docs', 'art', 'v4', 'background-expanse-v4-master.png'),
    output: join(ROOT, 'src', 'assets', 'v4', 'backgrounds', 'expanse-v4.png'),
    sequenceOutput: join(
      ROOT,
      'src',
      'assets',
      'v4',
      'backgrounds',
      'expanse-v4-sequence.png',
    ),
    sourceWidth: 1086,
    sourceHeight: 1448,
    sourceSha256: '8bdcb00184337d72ce090d33207797e947faf18ccab8c480f6c2afe218570f82',
    palette: V4_BACKGROUND_PALETTES.expanse,
    brightFloor: 122,
    minimumBrightCluster: 6,
    minimumBrightSpan: 24,
  },
  undertow: {
    name: 'undertow',
    master: join(ROOT, 'docs', 'art', 'v4', 'background-undertow-v4-master.png'),
    output: join(ROOT, 'src', 'assets', 'v4', 'backgrounds', 'undertow-v4.png'),
    sequenceOutput: join(
      ROOT,
      'src',
      'assets',
      'v4',
      'backgrounds',
      'undertow-v4-sequence.png',
    ),
    sourceWidth: 1086,
    sourceHeight: 1448,
    sourceSha256: '58cadaff21e3d2765bf3a739460097c2372b96047d66cf20edc9aa3794df01f8',
    palette: V4_BACKGROUND_PALETTES.undertow,
    brightFloor: 104,
    minimumBrightCluster: 6,
    minimumBrightSpan: 24,
  },
  stratum: {
    name: 'stratum',
    master: join(ROOT, 'docs', 'art', 'v4', 'background-stratum-v4-master.png'),
    output: join(ROOT, 'src', 'assets', 'v4', 'backgrounds', 'stratum-v4.png'),
    sourceWidth: 1086,
    sourceHeight: 1448,
    sourceSha256: '1dd319951f39c9be644fe1b53fafa818f41c18eb52a2cc403fe25baa118a0cd1',
    palette: V4_BACKGROUND_PALETTES.stratum,
    brightFloor: 106,
    minimumBrightCluster: 6,
    minimumBrightSpan: 24,
  },
  vault: {
    name: 'vault',
    master: join(ROOT, 'docs', 'art', 'v4', 'background-vault-v4-master.png'),
    output: join(ROOT, 'src', 'assets', 'v4', 'backgrounds', 'vault-v4.png'),
    sourceWidth: 1086,
    sourceHeight: 1448,
    sourceSha256: '3c20a487fdab0c161c29164ecfe8a05e8bc9148f681396b27aa65f1d26bb7d86',
    palette: V4_BACKGROUND_PALETTES.vault,
    brightFloor: 106,
    minimumBrightCluster: 6,
    minimumBrightSpan: 24,
  },
  regnum: {
    name: 'regnum',
    master: join(ROOT, 'docs', 'art', 'v4', 'background-regnum-v4-master.png'),
    output: join(ROOT, 'src', 'assets', 'v4', 'backgrounds', 'regnum-v4.png'),
    sequenceOutput: join(
      ROOT,
      'src',
      'assets',
      'v4',
      'backgrounds',
      'regnum-v4-sequence.png',
    ),
    sourceWidth: 1086,
    sourceHeight: 1448,
    sourceSha256: '7ae4c4a50136da08eca99ea0710f50051ac471a852fc841dc35fe96e84fbfa20',
    palette: V4_BACKGROUND_PALETTES.regnum,
    brightFloor: 58,
    minimumBrightCluster: 6,
    minimumBrightSpan: 24,
  },
  'wear-field': {
    name: 'wear-field',
    master: join(ROOT, 'docs', 'art', 'v4', 'background-wear-field-v4-master.png'),
    output: join(ROOT, 'src', 'assets', 'v4', 'backgrounds', 'wear-field-v4.png'),
    sequenceOutput: join(
      ROOT,
      'src',
      'assets',
      'v4',
      'backgrounds',
      'wear-field-v4-sequence.png',
    ),
    sourceWidth: 1086,
    sourceHeight: 1448,
    sourceSha256: 'adc73524223bed522be0fd41380c9755f9bc8f006822466a143e9eecdcc7e172',
    palette: V4_BACKGROUND_PALETTES['wear-field'],
    brightFloor: 106,
    minimumBrightCluster: 6,
    minimumBrightSpan: 24,
  },
};

export interface V4BackgroundAssetBuild {
  readonly name: V4BackgroundAssetName;
  readonly bytes: Uint8Array;
  /** Quantized 240×320 palette indices, exposed for structural tests. */
  readonly workIndices: Uint8Array;
}

export interface V4BackgroundSequenceBuild {
  readonly name: V4BackgroundSequenceName;
  readonly bytes: Uint8Array;
  /** Sixteen quantized 240×320 frames, packed four across by four down. */
  readonly workFrames: readonly Uint8Array[];
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, value));
}

function luma(colour: RGB): number {
  // Integer Rec. 709 approximation: coefficients sum to 256.
  return (54 * colour[0] + 183 * colour[1] + 19 * colour[2] + 128) >> 8;
}

/**
 * Exact box reduction expressed in integer overlap units.
 *
 * A source x pixel occupies `[sx*targetW, (sx+1)*targetW)` and a destination
 * x pixel occupies `[dx*sourceW, (dx+1)*sourceW)` in the same integer space.
 * The 2D denominator is therefore always `sourceW*sourceH`; no floating-point
 * boundary or native-library rounding can alter which source pixels contribute.
 */
function areaReduceOpaque(
  source: DecodedImage,
  targetWidth: number,
  targetHeight: number,
): Uint8Array {
  const out = new Uint8Array(targetWidth * targetHeight * 3);
  const denominator = source.width * source.height;

  for (let dy = 0; dy < targetHeight; dy++) {
    const targetY0 = dy * source.height;
    const targetY1 = (dy + 1) * source.height;
    const sourceY0 = Math.floor(targetY0 / targetHeight);
    const sourceY1 = Math.ceil(targetY1 / targetHeight);

    for (let dx = 0; dx < targetWidth; dx++) {
      const targetX0 = dx * source.width;
      const targetX1 = (dx + 1) * source.width;
      const sourceX0 = Math.floor(targetX0 / targetWidth);
      const sourceX1 = Math.ceil(targetX1 / targetWidth);
      let red = 0;
      let green = 0;
      let blue = 0;

      for (let sy = sourceY0; sy < sourceY1; sy++) {
        const overlapY = Math.min((sy + 1) * targetHeight, targetY1)
          - Math.max(sy * targetHeight, targetY0);
        for (let sx = sourceX0; sx < sourceX1; sx++) {
          const overlapX = Math.min((sx + 1) * targetWidth, targetX1)
            - Math.max(sx * targetWidth, targetX0);
          const weight = overlapX * overlapY;
          const at = (sy * source.width + sx) * 4;
          red += source.rgba[at]! * weight;
          green += source.rgba[at + 1]! * weight;
          blue += source.rgba[at + 2]! * weight;
        }
      }

      const at = (dy * targetWidth + dx) * 3;
      out[at] = clampByte(Math.floor((red + denominator / 2) / denominator));
      out[at + 1] = clampByte(Math.floor((green + denominator / 2) / denominator));
      out[at + 2] = clampByte(Math.floor((blue + denominator / 2) / denominator));
    }
  }
  return out;
}

/**
 * Luma leads the choice, while two opponent axes retain the master's scene hue.
 * All arithmetic is integer and ties resolve to the earlier authored swatch.
 */
function paletteDistance(red: number, green: number, blue: number, colour: RGB): number {
  const sourceLuma = (54 * red + 183 * green + 19 * blue + 128) >> 8;
  const paletteLuma = luma(colour);
  const sourceOrange = red - blue;
  const paletteOrange = colour[0] - colour[2];
  const sourceGreen = green * 2 - red - blue;
  const paletteGreen = colour[1] * 2 - colour[0] - colour[2];
  const deltaLuma = sourceLuma - paletteLuma;
  const deltaOrange = sourceOrange - paletteOrange;
  const deltaGreen = sourceGreen - paletteGreen;
  return deltaLuma * deltaLuma * 6
    + deltaOrange * deltaOrange
    + deltaGreen * deltaGreen;
}

function nearestPaletteIndex(
  red: number,
  green: number,
  blue: number,
  palette: readonly RGB[],
  maximumLuma = 255,
): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < palette.length; index++) {
    const colour = palette[index]!;
    if (luma(colour) > maximumLuma) continue;
    const distance = paletteDistance(red, green, blue, colour);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

function quantize(rgb: Uint8Array, palette: readonly RGB[]): Uint8Array {
  const indices = new Uint8Array(rgb.length / 3);
  for (let pixel = 0; pixel < indices.length; pixel++) {
    const at = pixel * 3;
    indices[pixel] = nearestPaletteIndex(
      rgb[at]!,
      rgb[at + 1]!,
      rgb[at + 2]!,
      palette,
    );
  }
  return indices;
}

/**
 * Fold one-pixel palette islands into a neighbouring cluster.
 *
 * Only true singletons move. A thin line whose next pixel is diagonal remains
 * authored structure; a lone quantization fleck does not. Candidate selection
 * favours the most common neighbour, then the swatch closest to the area sample,
 * then the lower authored palette index.
 */
function foldSingletons(
  sourceRgb: Uint8Array,
  input: Uint8Array,
  palette: readonly RGB[],
  width: number,
  height: number,
): Uint8Array {
  let current = input;
  for (let pass = 0; pass < 2; pass++) {
    const next = current.slice();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = y * width + x;
        const own = current[at]!;
        let ownNeighbours = 0;
        const counts = new Uint8Array(palette.length);

        for (let oy = -1; oy <= 1; oy++) {
          const ny = y + oy;
          if (ny < 0 || ny >= height) continue;
          for (let ox = -1; ox <= 1; ox++) {
            if (ox === 0 && oy === 0) continue;
            const nx = x + ox;
            if (nx < 0 || nx >= width) continue;
            const neighbour = current[ny * width + nx]!;
            counts[neighbour] = counts[neighbour]! + 1;
            if (neighbour === own) ownNeighbours++;
          }
        }
        if (ownNeighbours > 0) continue;

        let best = own;
        let bestCount = 0;
        let bestDistance = Number.POSITIVE_INFINITY;
        const rgbAt = at * 3;
        for (let index = 0; index < palette.length; index++) {
          const count = counts[index]!;
          if (count === 0) continue;
          const distance = paletteDistance(
            sourceRgb[rgbAt]!,
            sourceRgb[rgbAt + 1]!,
            sourceRgb[rgbAt + 2]!,
            palette[index]!,
          );
          if (
            count > bestCount
            || (count === bestCount && distance < bestDistance)
            || (count === bestCount && distance === bestDistance && index < best)
          ) {
            best = index;
            bestCount = count;
            bestDistance = distance;
          }
        }
        next[at] = best;
      }
    }
    current = next;
  }
  return current;
}

/**
 * Remove compact connected highlight islands without smoothing broad forms.
 *
 * Connectivity is 8-way so a diagonal authored highlight counts as one form.
 * Both area and bounding span bind: a compact 3×4 mark is rejected even though
 * it is not a singleton, while a long mycelium filament can survive. A rejected
 * component is remapped pixel-by-pixel to the closest darker palette swatch,
 * which keeps its local hue instead of painting a flat patch.
 */
function foldSmallBrightComponents(
  sourceRgb: Uint8Array,
  input: Uint8Array,
  palette: readonly RGB[],
  width: number,
  height: number,
  brightFloor: number,
  minimumCluster: number,
  minimumSpan: number,
): Uint8Array {
  const output = input.slice();
  const visited = new Uint8Array(input.length);
  const queue = new Int32Array(input.length);

  for (let start = 0; start < input.length; start++) {
    if (visited[start] || luma(palette[input[start]!]!) < brightFloor) continue;
    let head = 0;
    let tail = 1;
    let minX = start % width;
    let maxX = minX;
    let minY = Math.floor(start / width);
    let maxY = minY;
    queue[0] = start;
    visited[start] = 1;

    while (head < tail) {
      const at = queue[head++]!;
      const x = at % width;
      const y = Math.floor(at / width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (let oy = -1; oy <= 1; oy++) {
        const ny = y + oy;
        if (ny < 0 || ny >= height) continue;
        for (let ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oy === 0) continue;
          const nx = x + ox;
          if (nx < 0 || nx >= width) continue;
          const neighbour = ny * width + nx;
          if (
            visited[neighbour]
            || luma(palette[input[neighbour]!]!) < brightFloor
          ) continue;
          visited[neighbour] = 1;
          queue[tail++] = neighbour;
        }
      }
    }

    const span = Math.max(maxX - minX + 1, maxY - minY + 1);
    if (tail >= minimumCluster && span >= minimumSpan) continue;
    for (let index = 0; index < tail; index++) {
      const pixel = queue[index]!;
      const rgbAt = pixel * 3;
      output[pixel] = nearestPaletteIndex(
        sourceRgb[rgbAt]!,
        sourceRgb[rgbAt + 1]!,
        sourceRgb[rgbAt + 2]!,
        palette,
        brightFloor - 1,
      );
    }
  }
  return output;
}

function compileWorkIndices(
  sourceRgb: Uint8Array,
  spec: V4BackgroundAssetSpec,
): Uint8Array {
  let indices = quantize(sourceRgb, spec.palette);
  indices = foldSingletons(
    sourceRgb,
    indices,
    spec.palette,
    V4_BACKGROUND_WORK_WIDTH,
    V4_BACKGROUND_WORK_HEIGHT,
  );
  indices = foldSmallBrightComponents(
    sourceRgb,
    indices,
    spec.palette,
    V4_BACKGROUND_WORK_WIDTH,
    V4_BACKGROUND_WORK_HEIGHT,
    spec.brightFloor,
    spec.minimumBrightCluster,
    spec.minimumBrightSpan,
  );
  return foldSingletons(
    sourceRgb,
    indices,
    spec.palette,
    V4_BACKGROUND_WORK_WIDTH,
    V4_BACKGROUND_WORK_HEIGHT,
  );
}

function encodeNearest2x(indices: Uint8Array, palette: readonly RGB[]): Uint8Array {
  return encodePng(
    V4_BACKGROUND_WIDTH,
    V4_BACKGROUND_HEIGHT,
    ColourType.RGB,
    (x, y) => {
      const sourceX = x >> 1;
      const sourceY = y >> 1;
      const colour = palette[indices[sourceY * V4_BACKGROUND_WORK_WIDTH + sourceX]!]!;
      return [colour[0], colour[1], colour[2], 255];
    },
  );
}

/**
 * The four sequenced plates deliberately do not share a motion loop.
 *
 * Expanse is a slow lateral breath with a slightly uneven inhale/exhale. Its
 * phase is offset down the frame so the distant banks flex in sections rather
 * than translating like one card. Undertow is a travelling vertical pulse:
 * subtracting its phase down the wall makes the fold crest descend and wrap
 * through the sixteen-frame loop. Wear Field does not move either wall or
 * camera: independent path sections emerge, misregister by a few logical
 * pixels, then recede while the ending-copy rectangle stays byte-still. Regnum
 * shifts only its middle ash/pearl strata along three unequal tangents while
 * the Boss station, dark lacquer and player band stay fixed. Every curve closes
 * without a duplicate frame.
 */
type SequenceCurve = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

const EXPANSE_BREATH_CURVE = [
  -3, -3, -1, 1, 3, 4, 3, 3,
  1, 1, -1, -2, -4, -4, -2, -2,
] as const satisfies SequenceCurve;

const EXPANSE_LIFT_CURVE = [
  0, 0, 2, 2, 0, 0, -2, -2,
  0, 0, 2, 2, 0, 1, -1, 1,
] as const satisfies SequenceCurve;

const UNDERTOW_FALL_CURVE = [
  -3, -3, -1, 1, 3, 3, 1, -1,
  -3, -3, -1, 2, 4, 4, 2, -1,
] as const satisfies SequenceCurve;

const UNDERTOW_PRESSURE_CURVE = [
  0, 0, 1, 1, -1, -1, 0, 0,
  1, 1, -1, -2, -1, -1, 1, 1,
] as const satisfies SequenceCurve;

const WEAR_REVEAL_CURVE = [
  -1, -1, 0, 1, 0, -1, 0, 1,
  0, 1, 1, -1, 0, -1, 1, 0,
] as const satisfies SequenceCurve;

const WEAR_MISREGISTER_CURVE = [
  0, 1, 1, -1, 2, 0, -2, -1,
  0, 2, -1, 1, 0, -2, 1, -1,
] as const satisfies SequenceCurve;

const REGNUM_SHEAR_CURVE = [
  0, 1, 3, 2, 3, 2, 1, 2,
  0, -1, -3, -2, -3, -2, -1, -2,
] as const satisfies SequenceCurve;

const REGNUM_SETTLE_CURVE = [
  0, 0, 2, 1, -1, -2, 0, 1,
  2, 0, -2, -1, 1, 2, 0, -1,
] as const satisfies SequenceCurve;

export const V4_BACKGROUND_SEQUENCE_MOTION_PROFILES = {
  expanse: {
    primary: EXPANSE_BREATH_CURVE,
    secondary: EXPANSE_LIFT_CURVE,
  },
  undertow: {
    primary: UNDERTOW_FALL_CURVE,
    secondary: UNDERTOW_PRESSURE_CURVE,
  },
  regnum: {
    primary: REGNUM_SHEAR_CURVE,
    secondary: REGNUM_SETTLE_CURVE,
  },
  'wear-field': {
    primary: WEAR_REVEAL_CURVE,
    secondary: WEAR_MISREGISTER_CURVE,
  },
} as const;

function wrapSequencePhase(phase: number): number {
  return ((phase % V4_BACKGROUND_SEQUENCE_FRAMES)
    + V4_BACKGROUND_SEQUENCE_FRAMES) % V4_BACKGROUND_SEQUENCE_FRAMES;
}

function divideRoundNearest(value: number, divisor: number): number {
  if (value < 0) {
    return -Math.floor((-value + Math.floor(divisor / 2)) / divisor);
  }
  return Math.floor((value + Math.floor(divisor / 2)) / divisor);
}

/**
 * Read a discrete loop along the plate height with integer interpolation.
 * `direction = -1` produces a downward-travelling crest as frames advance.
 */
function sampleCurveDownPlate(
  curve: SequenceCurve,
  frame: number,
  y: number,
  phaseSpan: number,
  direction: 1 | -1,
): number {
  const scaled = y * phaseSpan;
  const wholePhase = Math.floor(scaled / V4_BACKGROUND_WORK_HEIGHT);
  const remainder = scaled % V4_BACKGROUND_WORK_HEIGHT;
  const phase = frame + direction * wholePhase;
  const nextPhase = phase + direction;
  const current = curve[wrapSequencePhase(phase)]!;
  const next = curve[wrapSequencePhase(nextPhase)]!;
  return divideRoundNearest(
    current * (V4_BACKGROUND_WORK_HEIGHT - remainder) + next * remainder,
    V4_BACKGROUND_WORK_HEIGHT,
  );
}

function rampDisplacement(
  value: number,
  distanceFromCentre: number,
  corridor: number,
  rampWidth: number,
): number {
  const amount = Math.max(0, Math.min(rampWidth, distanceFromCentre - corridor));
  return divideRoundNearest(value * amount, rampWidth);
}

function halfTowardZero(value: number): number {
  return value < 0 ? Math.ceil(value / 2) : Math.floor(value / 2);
}

function workRgbLuma(rgb: Uint8Array, x: number, y: number): number {
  const at = (y * V4_BACKGROUND_WORK_WIDTH + x) * 3;
  return (
    54 * rgb[at]!
    + 183 * rgb[at + 1]!
    + 19 * rgb[at + 2]!
    + 128
  ) >> 8;
}

function copyWorkRgbPixel(
  source: Uint8Array,
  output: Uint8Array,
  destinationX: number,
  destinationY: number,
  sourceX: number,
  sourceY: number,
): void {
  const x = Math.max(0, Math.min(V4_BACKGROUND_WORK_WIDTH - 1, sourceX));
  const y = Math.max(0, Math.min(V4_BACKGROUND_WORK_HEIGHT - 1, sourceY));
  const from = (y * V4_BACKGROUND_WORK_WIDTH + x) * 3;
  const to = (destinationY * V4_BACKGROUND_WORK_WIDTH + destinationX) * 3;
  output[to] = source[from]!;
  output[to + 1] = source[from + 1]!;
  output[to + 2] = source[from + 2]!;
}

const WEAR_COOL_LAST = 12;
const WEAR_HEART_FIRST = 13;
const WEAR_TEXT_LEFT = 58;
const WEAR_TEXT_RIGHT = 182;
const WEAR_TEXT_TOP = 40;
const WEAR_TEXT_BOTTOM = 168;
const WEAR_SECTION_JITTER = [
  -7, 3, -2, 8, 0, -5, 6, 2,
  -4, 7, -1, 4, -6, 1, 5, -3,
] as const satisfies SequenceCurve;

function inWearTextQuietZone(x: number, y: number): boolean {
  return (
    x >= WEAR_TEXT_LEFT
    && x < WEAR_TEXT_RIGHT
    && y >= WEAR_TEXT_TOP
    && y < WEAR_TEXT_BOTTOM
  );
}

function wearSectionJitter(value: number, stride: number, phase: number): number {
  const index = wrapSequencePhase(Math.floor(value / stride) + phase);
  return WEAR_SECTION_JITTER[index]!;
}

/**
 * Assign one of four worn routes and a coarse section along it.
 *
 * These are deliberately broad partitions, not painted lines: a left-edge scar,
 * a right-edge crossing and two bottom passages divide the master's existing
 * material into independently timed sections. `-1` leaves the accepted plate
 * alone. The central ending-copy rectangle never receives a route.
 */
function wearRouteSection(x: number, y: number): number {
  if (inWearTextQuietZone(x, y)) return -1;
  const leftEdge = 78 + wearSectionJitter(y, 28, 1);
  if (x < leftEdge && y >= 72) {
    return Math.min(
      7,
      Math.max(0, Math.floor((y - 72 + wearSectionJitter(x, 13, 4)) / 34)),
    );
  }
  const rightEdge = 162 + wearSectionJitter(y, 31, 7);
  if (x >= rightEdge && y >= 116) {
    return 8 + Math.min(
      7,
      Math.max(
        0,
        Math.floor((y - 116 + wearSectionJitter(x, 15, 10)) / 32),
      ),
    );
  }
  const bottomEdge = 208 + wearSectionJitter(x, 24, 12);
  if (y >= bottomEdge && x < 110) {
    return 16 + Math.min(
      7,
      Math.max(0, Math.floor((x + wearSectionJitter(y, 17, 2)) / 24)),
    );
  }
  if (y >= bottomEdge && x >= 134) {
    return 24 + Math.min(
      7,
      Math.max(
        0,
        Math.floor(
          (V4_BACKGROUND_WORK_WIDTH - 1 - x + wearSectionJitter(y, 19, 6)) / 24,
        ),
      ),
    );
  }
  return -1;
}

function shiftWearPaletteIndex(index: number, delta: number): number {
  if (index < WEAR_HEART_FIRST) {
    return Math.max(0, Math.min(WEAR_COOL_LAST, index + delta));
  }
  return Math.max(
    WEAR_HEART_FIRST,
    Math.min(V4_BACKGROUND_PALETTES['wear-field'].length - 1, index + delta),
  );
}

function workIndicesRgb(
  indices: Uint8Array,
  palette: readonly RGB[],
): Uint8Array {
  const rgb = new Uint8Array(indices.length * 3);
  for (let pixel = 0; pixel < indices.length; pixel++) {
    const colour = palette[indices[pixel]!]!;
    const at = pixel * 3;
    rgb[at] = colour[0];
    rgb[at + 1] = colour[1];
    rgb[at + 2] = colour[2];
  }
  return rgb;
}

/**
 * Reveal, misregister and fade the existing worn paths section by section.
 *
 * Palette-index motion stays within either the cool-silver or muted-heart ramp,
 * so a reveal increases material density without drifting toward white. Small
 * route-aligned source offsets create a damaged registration rather than
 * Expanse's horizontal breath or Undertow's vertical current. Dark void and the
 * central ending-copy rectangle remain fixed.
 */
function wearSequenceFrame(
  baseIndices: Uint8Array,
  frame: number,
  spec: V4BackgroundAssetSpec,
): Uint8Array {
  const staged = baseIndices.slice();

  for (let y = 0; y < V4_BACKGROUND_WORK_HEIGHT; y++) {
    for (let x = 0; x < V4_BACKGROUND_WORK_WIDTH; x++) {
      const at = y * V4_BACKGROUND_WORK_WIDTH + x;
      const baseIndex = baseIndices[at]!;
      const routeSection = wearRouteSection(x, y);
      if (routeSection < 0 || luma(spec.palette[baseIndex]!) < 49) continue;

      const route = Math.floor(routeSection / 8);
      const section = routeSection % 8;
      const revealPhase = wrapSequencePhase(frame + route * 3 + section * 2);
      const offsetPhase = wrapSequencePhase(frame + route * 5 + section);
      const reveal = WEAR_REVEAL_CURVE[revealPhase]!;
      const offset = WEAR_MISREGISTER_CURVE[offsetPhase]!;

      let sourceX = x;
      let sourceY = y;
      if (route === 0) {
        sourceX += offset;
      } else if (route === 1) {
        sourceX -= offset;
        sourceY += offset;
      } else if (route === 2) {
        sourceX += offset;
        sourceY -= offset;
      } else {
        sourceX -= offset;
        sourceY -= offset;
      }
      sourceX = Math.max(0, Math.min(V4_BACKGROUND_WORK_WIDTH - 1, sourceX));
      sourceY = Math.max(0, Math.min(V4_BACKGROUND_WORK_HEIGHT - 1, sourceY));
      if (inWearTextQuietZone(sourceX, sourceY)) {
        sourceX = x;
        sourceY = y;
      }

      const sampled = baseIndices[sourceY * V4_BACKGROUND_WORK_WIDTH + sourceX]!;
      const materialSample = luma(spec.palette[sampled]!) >= 40 ? sampled : baseIndex;
      staged[at] = shiftWearPaletteIndex(materialSample, reveal);
    }
  }

  /*
   * Re-run the same cleanup as a base plate after registration shifts, then
   * restore the copy zone exactly. The restoration is safe because that region
   * is already cleanup-approved in `baseIndices`.
   */
  const cleaned = compileWorkIndices(workIndicesRgb(staged, spec.palette), spec);
  for (let y = WEAR_TEXT_TOP; y < WEAR_TEXT_BOTTOM; y++) {
    for (let x = WEAR_TEXT_LEFT; x < WEAR_TEXT_RIGHT; x++) {
      const at = y * V4_BACKGROUND_WORK_WIDTH + x;
      cleaned[at] = baseIndices[at]!;
    }
  }
  return cleaned;
}

const REGNUM_LACQUER_LAST = 8;
const REGNUM_ASH_FIRST = 9;
const REGNUM_ASH_LAST = 14;
const REGNUM_PEARL_LAST = 18;
const REGNUM_BOSS_QUIET_BOTTOM = 72;
const REGNUM_PLAYER_QUIET_TOP = 220;
const REGNUM_SECTION_JITTER = [
  2, -5, 7, -1, 4, -7, 1, 6,
  -3, 5, -6, 0, 7, -2, 3, -4,
] as const satisfies SequenceCurve;

function regnumSectionJitter(value: number, stride: number, phase: number): number {
  const index = wrapSequencePhase(Math.floor(value / stride) + phase);
  return REGNUM_SECTION_JITTER[index]!;
}

/**
 * Split the moving middle material into three unequal, off-axis strata.
 *
 * The masks only select how already-authored pixels register; they never draw
 * a visible edge. Full-width quiet bands above and below remain byte-identical
 * to the accepted plate so neither REGENT nor the player lane gains a moving
 * frame around it.
 */
function regnumStratum(x: number, y: number): number {
  if (
    y < REGNUM_BOSS_QUIET_BOTTOM
    || y >= REGNUM_PLAYER_QUIET_TOP
  ) return -1;

  const upperRight = 144
    - Math.floor((y - REGNUM_BOSS_QUIET_BOTTOM) / 6)
    + regnumSectionJitter(y, 27, 2);
  if (y < 166 && x >= upperRight) return 0;

  const leftMiddle = 76
    + Math.floor((y - REGNUM_BOSS_QUIET_BOTTOM) / 4)
    + regnumSectionJitter(y, 31, 7);
  if (x < leftMiddle) return 1;

  return 2;
}

function regnumMaterialOffset(index: number, value: number): number {
  if (index <= 2) return 0;
  if (index <= REGNUM_LACQUER_LAST) return halfTowardZero(value);
  if (index >= REGNUM_ASH_FIRST && index <= REGNUM_ASH_LAST) return value;
  return halfTowardZero(value);
}

function shiftRegnumPaletteIndex(index: number, delta: number): number {
  if (delta === 0 || index <= 2) return index;
  if (index <= REGNUM_LACQUER_LAST) {
    return Math.max(3, Math.min(REGNUM_LACQUER_LAST, index + delta));
  }
  if (index <= REGNUM_ASH_LAST) {
    return Math.max(
      REGNUM_ASH_FIRST,
      Math.min(REGNUM_ASH_LAST, index + delta),
    );
  }
  return Math.max(
    REGNUM_ASH_LAST + 1,
    Math.min(REGNUM_PEARL_LAST, index + delta),
  );
}

/**
 * REGNUM's painted layer performs an asynchronous stratum registration shift.
 *
 * Ash rose takes the full two/three-pixel tangent motion, muted pearl and the
 * upper lacquer tiers follow at half distance, and the deepest lacquer stays
 * fixed. Three coarse strata use different curve phases and tangents, so the
 * plate does not breathe, descend, reveal edge routes or translate as a camera.
 */
function regnumSequenceFrame(
  baseIndices: Uint8Array,
  frame: number,
  spec: V4BackgroundAssetSpec,
): Uint8Array {
  const staged = baseIndices.slice();

  for (let y = REGNUM_BOSS_QUIET_BOTTOM; y < REGNUM_PLAYER_QUIET_TOP; y++) {
    for (let x = 0; x < V4_BACKGROUND_WORK_WIDTH; x++) {
      const at = y * V4_BACKGROUND_WORK_WIDTH + x;
      const baseIndex = baseIndices[at]!;
      const stratum = regnumStratum(x, y);
      if (stratum < 0 || baseIndex <= 2) continue;

      const primary = REGNUM_SHEAR_CURVE[
        wrapSequencePhase(frame + stratum * 5)
      ]!;
      const secondary = REGNUM_SETTLE_CURVE[
        wrapSequencePhase(frame + stratum * 3 + 2)
      ]!;
      const shift = regnumMaterialOffset(baseIndex, primary);
      const settle = regnumMaterialOffset(baseIndex, secondary);

      let sourceX = x;
      let sourceY = y;
      if (stratum === 0) {
        sourceX += shift;
        sourceY -= halfTowardZero(shift) + halfTowardZero(settle);
      } else if (stratum === 1) {
        sourceX += shift;
        sourceY += halfTowardZero(settle);
      } else {
        sourceX += shift;
        sourceY -= halfTowardZero(settle);
      }
      sourceX = Math.max(0, Math.min(V4_BACKGROUND_WORK_WIDTH - 1, sourceX));
      sourceY = Math.max(
        REGNUM_BOSS_QUIET_BOTTOM,
        Math.min(REGNUM_PLAYER_QUIET_TOP - 1, sourceY),
      );

      const sampled = baseIndices[sourceY * V4_BACKGROUND_WORK_WIDTH + sourceX]!;
      /*
       * Never pull a dark void across a coloured material boundary. Keeping the
       * destination there creates a restrained registration slip rather than a
       * black tear or a new contour.
       */
      if (baseIndex >= REGNUM_ASH_FIRST && sampled <= REGNUM_LACQUER_LAST) {
        continue;
      }
      const grade = secondary < 0 ? -1 : secondary > 0 ? 1 : 0;
      staged[at] = shiftRegnumPaletteIndex(sampled, grade);
    }
  }

  const cleaned = compileWorkIndices(workIndicesRgb(staged, spec.palette), spec);
  for (let y = 0; y < V4_BACKGROUND_WORK_HEIGHT; y++) {
    if (y >= REGNUM_BOSS_QUIET_BOTTOM && y < REGNUM_PLAYER_QUIET_TOP) continue;
    const row = y * V4_BACKGROUND_WORK_WIDTH;
    cleaned.set(
      baseIndices.subarray(row, row + V4_BACKGROUND_WORK_WIDTH),
      row,
    );
  }
  return cleaned;
}

/**
 * Animate the authored membranes, not the camera.
 *
 * The two stage warp profiles leave their central play corridor untouched.
 * Expanse's
 * left and right cloud/bone banks breathe laterally with a five-phase
 * top-to-bottom lag, independent material timing and a small opposed lift.
 * Undertow instead sends a two-crest, sixteen-phase descending wave through
 * asymmetrically timed walls. Bright
 * material receives the full displacement while dark mass receives a smaller
 * one, creating restrained parallax strata from the same accepted master
 * without inventing new marks. Palette cleanup may settle a few Undertow
 * corridor-boundary texels; the output test caps that residue explicitly.
 */
function warpSequenceFrame(
  name: 'expanse' | 'undertow',
  reducedRgb: Uint8Array,
  frame: number,
): Uint8Array {
  const output = new Uint8Array(reducedRgb.length);

  for (let y = 0; y < V4_BACKGROUND_WORK_HEIGHT; y++) {
    for (let x = 0; x < V4_BACKGROUND_WORK_WIDTH; x++) {
      const distanceFromCentre = Math.abs(x * 2 - (V4_BACKGROUND_WORK_WIDTH - 1));
      const isLeft = x * 2 < V4_BACKGROUND_WORK_WIDTH;
      const side = isLeft ? 1 : -1;
      const materialLuma = workRgbLuma(reducedRgb, x, y);
      let sourceX = x;
      let sourceY = y;

      if (name === 'expanse') {
        // 80-work-pixel / 160-screen-pixel central negative-space corridor.
        if (distanceFromCentre >= 80) {
          const bright = materialLuma >= 82;
          const sidePhase = frame + (isLeft ? 0 : 2) + (bright ? 0 : -1);
          const breath = sampleCurveDownPlate(
            EXPANSE_BREATH_CURVE,
            sidePhase,
            y,
            5,
            1,
          );
          const lift = EXPANSE_LIFT_CURVE[
            wrapSequencePhase(frame + (isLeft ? 0 : 8))
          ]!;
          const materialX = bright ? breath : halfTowardZero(breath);
          const materialY = bright ? lift : halfTowardZero(lift);
          const dx = rampDisplacement(materialX, distanceFromCentre, 80, 48);
          const dy = rampDisplacement(materialY, distanceFromCentre, 80, 32);
          sourceX += side * dx;
          sourceY += dy;
        }
      } else if (name === 'undertow') {
        // 72-work-pixel / 144-screen-pixel shaft stays calm. A full travelling
        // phase crosses the wall height; the right wall and bright strata lag,
        // so this reads as a descending undertow rather than Expanse's breath.
        if (distanceFromCentre >= 72) {
          const bright = materialLuma >= 72;
          const wallPhase = frame + (isLeft ? 0 : 5) + (bright ? 2 : 0);
          const fall = sampleCurveDownPlate(
            UNDERTOW_FALL_CURVE,
            wallPhase,
            y,
            16,
            -1,
          );
          const pressure = sampleCurveDownPlate(
            UNDERTOW_PRESSURE_CURVE,
            frame + (isLeft ? 0 : 8),
            y,
            8,
            -1,
          );
          const materialY = bright
            ? fall
            : divideRoundNearest(fall * 2, 3);
          const dx = rampDisplacement(
            pressure,
            distanceFromCentre,
            72,
            36,
          );
          const dy = rampDisplacement(
            materialY,
            distanceFromCentre,
            72,
            28,
          );
          sourceX += side * dx;
          sourceY += dy;
        }
      } else {
        throw new Error('wear-field uses its sectioned palette sequence');
      }

      copyWorkRgbPixel(reducedRgb, output, x, y, sourceX, sourceY);
    }
  }
  return output;
}

function encodeSequenceAtlas(
  frames: readonly Uint8Array[],
  palette: readonly RGB[],
): Uint8Array {
  return encodePng(
    V4_BACKGROUND_SEQUENCE_WIDTH,
    V4_BACKGROUND_SEQUENCE_HEIGHT,
    ColourType.RGB,
    (x, y) => {
      const tileX = Math.floor(x / V4_BACKGROUND_WORK_WIDTH);
      const tileY = Math.floor(y / V4_BACKGROUND_WORK_HEIGHT);
      const frame = tileY * V4_BACKGROUND_SEQUENCE_COLUMNS + tileX;
      const workX = x % V4_BACKGROUND_WORK_WIDTH;
      const workY = y % V4_BACKGROUND_WORK_HEIGHT;
      const colour = palette[
        frames[frame]![workY * V4_BACKGROUND_WORK_WIDTH + workX]!
      ]!;
      return [colour[0], colour[1], colour[2], 255];
    },
  );
}

function validateSource(source: DecodedImage, spec: V4BackgroundAssetSpec): void {
  if (source.width !== spec.sourceWidth || source.height !== spec.sourceHeight) {
    throw new Error(
      `${spec.name} master is ${source.width}×${source.height}; `
      + `expected ${spec.sourceWidth}×${spec.sourceHeight}`,
    );
  }
  if (source.width * 4 !== source.height * 3) {
    throw new Error(`${spec.name} master must be exact 3:4`);
  }
  for (let at = 3; at < source.rgba.length; at += 4) {
    if (source.rgba[at] !== 255) {
      throw new Error(`${spec.name} master must be opaque`);
    }
  }
}

/** Build one asset in memory so tests can byte-diff it against the commit. */
export function buildV4BackgroundAsset(
  name: V4BackgroundAssetName,
  masterBytes: Uint8Array = readFileSync(V4_BACKGROUND_ASSET_SPECS[name].master),
): V4BackgroundAssetBuild {
  const spec = V4_BACKGROUND_ASSET_SPECS[name];
  const actualSourceSha256 = sha256(masterBytes);
  if (actualSourceSha256 !== spec.sourceSha256) {
    throw new Error(
      `${name} master SHA-256 ${actualSourceSha256}; expected ${spec.sourceSha256}`,
    );
  }

  const source = decodePng(masterBytes);
  validateSource(source, spec);
  const reduced = areaReduceOpaque(
    source,
    V4_BACKGROUND_WORK_WIDTH,
    V4_BACKGROUND_WORK_HEIGHT,
  );
  const indices = compileWorkIndices(reduced, spec);

  const bytes = encodeNearest2x(indices, spec.palette);
  const verified = parsePng(bytes);
  if (
    verified.width !== V4_BACKGROUND_WIDTH
    || verified.height !== V4_BACKGROUND_HEIGHT
    || verified.bitDepth !== 8
    || verified.colourType !== ColourType.RGB
    || verified.chunks.join(',') !== 'IHDR,IDAT,IEND'
  ) {
    throw new Error(
      `${name} runtime PNG verify failed: ${verified.width}×${verified.height}, `
      + `bit depth ${verified.bitDepth}, colour type ${verified.colourType}, `
      + `chunks ${verified.chunks.join('/')}`,
    );
  }
  return { name, bytes, workIndices: indices };
}

/** Build one fixed-tick art sequence atlas from an accepted project master. */
export function buildV4BackgroundSequenceAsset(
  name: V4BackgroundSequenceName,
  masterBytes: Uint8Array = readFileSync(V4_BACKGROUND_ASSET_SPECS[name].master),
): V4BackgroundSequenceBuild {
  const spec = V4_BACKGROUND_ASSET_SPECS[name];
  const actualSourceSha256 = sha256(masterBytes);
  if (actualSourceSha256 !== spec.sourceSha256) {
    throw new Error(
      `${name} master SHA-256 ${actualSourceSha256}; expected ${spec.sourceSha256}`,
    );
  }

  const source = decodePng(masterBytes);
  validateSource(source, spec);
  const reduced = areaReduceOpaque(
    source,
    V4_BACKGROUND_WORK_WIDTH,
    V4_BACKGROUND_WORK_HEIGHT,
  );
  const baseIndices = compileWorkIndices(reduced, spec);
  const workFrames = Array.from(
    { length: V4_BACKGROUND_SEQUENCE_FRAMES },
    (_, frame) => {
      switch (name) {
        case 'wear-field':
          return wearSequenceFrame(baseIndices, frame, spec);
        case 'regnum':
          return regnumSequenceFrame(baseIndices, frame, spec);
        case 'expanse':
        case 'undertow':
          return compileWorkIndices(warpSequenceFrame(name, reduced, frame), spec);
      }
    },
  );
  const bytes = encodeSequenceAtlas(workFrames, spec.palette);
  const verified = parsePng(bytes);
  if (
    verified.width !== V4_BACKGROUND_SEQUENCE_WIDTH
    || verified.height !== V4_BACKGROUND_SEQUENCE_HEIGHT
    || verified.bitDepth !== 8
    || verified.colourType !== ColourType.RGB
    || verified.chunks.join(',') !== 'IHDR,IDAT,IEND'
  ) {
    throw new Error(
      `${name} sequence PNG verify failed: ${verified.width}×${verified.height}, `
      + `bit depth ${verified.bitDepth}, colour type ${verified.colourType}, `
      + `chunks ${verified.chunks.join('/')}`,
    );
  }
  return { name, bytes, workFrames };
}

export function writeV4BackgroundAssets(): void {
  for (const name of V4_BACKGROUND_ASSET_NAMES) {
    const spec = V4_BACKGROUND_ASSET_SPECS[name];
    const build = buildV4BackgroundAsset(name);
    mkdirSync(dirname(spec.output), { recursive: true });
    writeFileSync(spec.output, build.bytes);
    console.log(
      `${name.padEnd(7)} ${V4_BACKGROUND_WORK_WIDTH}×${V4_BACKGROUND_WORK_HEIGHT} `
      + `→ ${V4_BACKGROUND_WIDTH}×${V4_BACKGROUND_HEIGHT} RGB  `
      + `${spec.palette.length} swatches  ${sha256(build.bytes)}`,
    );
  }
  for (const name of V4_BACKGROUND_SEQUENCE_NAMES) {
    const spec = V4_BACKGROUND_ASSET_SPECS[name];
    if (!spec.sequenceOutput) throw new Error(`${name} has no sequence output`);
    const build = buildV4BackgroundSequenceAsset(name);
    mkdirSync(dirname(spec.sequenceOutput), { recursive: true });
    writeFileSync(spec.sequenceOutput, build.bytes);
    console.log(
      `${name.padEnd(7)} ${V4_BACKGROUND_SEQUENCE_FRAMES}× `
      + `${V4_BACKGROUND_WORK_WIDTH}×${V4_BACKGROUND_WORK_HEIGHT} `
      + `→ ${V4_BACKGROUND_SEQUENCE_WIDTH}×${V4_BACKGROUND_SEQUENCE_HEIGHT} RGB  `
      + `${sha256(build.bytes)}`,
    );
  }
}

if (import.meta.main) writeV4BackgroundAssets();
