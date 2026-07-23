/**
 * Deterministically derive the install icons from SCOUT, the default character.
 *
 * The source is the project-owned straight-alpha dialogue portrait shipped in
 * packs/v4 (CLAUDE.md rule 9), not the black-backed RGB art master and not the
 * tiny field actor. Ordinary icons crop to the face, heart and shoulders;
 * maskable icons retain the complete 256px portrait cell at 76% scale so every
 * painted pixel stays inside the specification's central 40%-radius safe circle.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { decodePng, type DecodedImage } from './png-decode';
import { ColourType, encodePng, parsePng } from './png';

const ROOT = join(import.meta.dir, '..');
export const PWA_ICON_SOURCE = join(
  ROOT,
  'packs',
  'v4',
  'actors',
  'portraits.png',
);
const OUTPUT_DIR = join(ROOT, 'public', 'icons');
const SOURCE_CELL = 256;

export interface PwaIconSpec {
  readonly name: string;
  readonly size: number;
  readonly maskable: boolean;
}

export const PWA_ICON_SPECS: readonly PwaIconSpec[] = [
  { name: 'favicon-32.png', size: 32, maskable: false },
  { name: 'apple-touch-icon.png', size: 180, maskable: false },
  { name: 'icon-192.png', size: 192, maskable: false },
  { name: 'icon-512.png', size: 512, maskable: false },
  { name: 'icon-maskable-512.png', size: 512, maskable: true },
  { name: 'icon-maskable-1024.png', size: 1024, maskable: true },
];

interface PortraitLayout {
  readonly sourceX: number;
  readonly sourceY: number;
  readonly sourceSize: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly targetSize: number;
}

const ANY_LAYOUT: PortraitLayout = {
  sourceX: 32,
  sourceY: 8,
  sourceSize: 192,
  targetX: -0.02,
  targetY: 0.01,
  targetSize: 1.04,
};

/** Exported so the safety-circle regression test measures this exact transform. */
export const PWA_MASKABLE_LAYOUT: PortraitLayout = {
  sourceX: 0,
  sourceY: 0,
  sourceSize: SOURCE_CELL,
  targetX: 0.122,
  targetY: 0.083,
  targetSize: 0.76,
};

type Premultiplied = readonly [number, number, number, number];
type Rgb = readonly [number, number, number];

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** Dark v4 UI floor plus a restrained SCOUT-cyan identity halo. */
function background(x: number, y: number, size: number): Rgb {
  const u = (x + 0.5) / size;
  const v = (y + 0.5) / size;
  const dx = u - 0.5;
  const dy = v - 0.38;
  const halo = Math.max(0, 1 - Math.hypot(dx / 0.58, dy / 0.62));
  const halo2 = halo * halo;
  const radius = Math.hypot(u - 0.5, v - 0.47);
  const ringWidth = Math.max(1.2 / size, 0.004);
  const ring = Math.exp(-(((radius - 0.355) / ringWidth) ** 2));
  const edge = Math.min(1, Math.hypot(dx / 0.72, (v - 0.5) / 0.72));
  const vignette = 1 - edge * edge * 0.36;

  return [
    clampByte((4 + v * 5 + halo2 * 10 + ring * 10) * vignette),
    clampByte((7 + v * 7 + halo2 * 25 + ring * 22) * vignette),
    clampByte((12 + v * 12 + halo2 * 34 + ring * 28) * vignette),
  ];
}

/**
 * Bilinear sample in premultiplied space. The portrait has soft straight-alpha
 * edges; interpolating its RGB without alpha would reintroduce a dark fringe.
 */
function samplePortrait(
  image: DecodedImage,
  sourceX: number,
  sourceY: number,
): Premultiplied {
  const x0 = Math.max(0, Math.min(SOURCE_CELL - 1, Math.floor(sourceX)));
  const y0 = Math.max(0, Math.min(SOURCE_CELL - 1, Math.floor(sourceY)));
  const x1 = Math.max(0, Math.min(SOURCE_CELL - 1, x0 + 1));
  const y1 = Math.max(0, Math.min(SOURCE_CELL - 1, y0 + 1));
  const tx = sourceX - Math.floor(sourceX);
  const ty = sourceY - Math.floor(sourceY);
  const samples = [
    [x0, y0, (1 - tx) * (1 - ty)],
    [x1, y0, tx * (1 - ty)],
    [x0, y1, (1 - tx) * ty],
    [x1, y1, tx * ty],
  ] as const;

  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (const [sx, sy, weight] of samples) {
    const at = (sy * image.width + sx) * 4;
    const alpha = image.rgba[at + 3]! / 255;
    r += image.rgba[at]! * alpha * weight;
    g += image.rgba[at + 1]! * alpha * weight;
    b += image.rgba[at + 2]! * alpha * weight;
    a += alpha * weight;
  }
  return [r, g, b, a];
}

export function buildPwaIcon(
  source: DecodedImage,
  spec: PwaIconSpec,
): Uint8Array {
  if (source.width < SOURCE_CELL || source.height < SOURCE_CELL) {
    throw new Error(
      `pwa icon source is ${source.width}×${source.height}, expected a 256px SCOUT cell`,
    );
  }
  const layout = spec.maskable ? PWA_MASKABLE_LAYOUT : ANY_LAYOUT;

  const bytes = encodePng(
    spec.size,
    spec.size,
    ColourType.RGBA,
    (x, y) => {
      const bg = background(x, y, spec.size);
      const u = ((x + 0.5) / spec.size - layout.targetX) / layout.targetSize;
      const v = ((y + 0.5) / spec.size - layout.targetY) / layout.targetSize;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) {
        return [bg[0], bg[1], bg[2], 255];
      }

      const sx = layout.sourceX + u * layout.sourceSize - 0.5;
      const sy = layout.sourceY + v * layout.sourceSize - 0.5;
      const [pr, pg, pb, alpha] = samplePortrait(source, sx, sy);
      const floor = 1 - alpha;
      return [
        clampByte(pr + bg[0] * floor),
        clampByte(pg + bg[1] * floor),
        clampByte(pb + bg[2] * floor),
        255,
      ];
    },
  );

  const checked = parsePng(bytes);
  if (checked.width !== spec.size || checked.height !== spec.size) {
    throw new Error(
      `generated ${spec.name} is ${checked.width}×${checked.height}, expected ${spec.size}×${spec.size}`,
    );
  }
  return bytes;
}

export async function makePwaIcons(outputDir = OUTPUT_DIR): Promise<void> {
  const source = decodePng(await Bun.file(PWA_ICON_SOURCE).bytes());
  await mkdir(outputDir, { recursive: true });
  for (const spec of PWA_ICON_SPECS) {
    await writeFile(join(outputDir, spec.name), buildPwaIcon(source, spec));
  }
}

if (import.meta.main) {
  await makePwaIcons();
  console.log(
    `make-pwa-icons: wrote ${PWA_ICON_SPECS.length} SCOUT icons → public/icons/`,
  );
}
