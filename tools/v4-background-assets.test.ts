import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

import {
  buildV4BackgroundAsset,
  V4_BACKGROUND_ASSET_NAMES,
  V4_BACKGROUND_ASSET_SPECS,
  V4_BACKGROUND_HEIGHT,
  V4_BACKGROUND_PALETTES,
  V4_BACKGROUND_WIDTH,
  V4_BACKGROUND_WORK_HEIGHT,
  V4_BACKGROUND_WORK_WIDTH,
  type V4BackgroundAssetName,
} from './v4-background-assets';
import { decodePng } from './png-decode';
import { ColourType, parsePng } from './png';

const NAMES: V4BackgroundAssetName[] = [...V4_BACKGROUND_ASSET_NAMES];

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function ihdr(bytes: Uint8Array): {
  width: number;
  height: number;
  bitDepth: number;
  colourType: number;
} {
  // PNG signature (8), IHDR length/type (8), then the 13-byte IHDR payload.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: view.getUint32(16, false),
    height: view.getUint32(20, false),
    bitDepth: bytes[24]!,
    colourType: bytes[25]!,
  };
}

function luma(colour: readonly [number, number, number]): number {
  return (54 * colour[0] + 183 * colour[1] + 19 * colour[2] + 128) >> 8;
}

function brightComponents(
  name: V4BackgroundAssetName,
  indices: Uint8Array,
): Array<{ size: number; span: number }> {
  const spec = V4_BACKGROUND_ASSET_SPECS[name];
  const visited = new Uint8Array(indices.length);
  const queue = new Int32Array(indices.length);
  const components: Array<{ size: number; span: number }> = [];

  for (let start = 0; start < indices.length; start++) {
    if (
      visited[start]
      || luma(spec.palette[indices[start]!]!) < spec.brightFloor
    ) continue;
    let head = 0;
    let tail = 1;
    let minX = start % V4_BACKGROUND_WORK_WIDTH;
    let maxX = minX;
    let minY = Math.floor(start / V4_BACKGROUND_WORK_WIDTH);
    let maxY = minY;
    queue[0] = start;
    visited[start] = 1;

    while (head < tail) {
      const at = queue[head++]!;
      const x = at % V4_BACKGROUND_WORK_WIDTH;
      const y = Math.floor(at / V4_BACKGROUND_WORK_WIDTH);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (let oy = -1; oy <= 1; oy++) {
        const ny = y + oy;
        if (ny < 0 || ny >= V4_BACKGROUND_WORK_HEIGHT) continue;
        for (let ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oy === 0) continue;
          const nx = x + ox;
          if (nx < 0 || nx >= V4_BACKGROUND_WORK_WIDTH) continue;
          const neighbour = ny * V4_BACKGROUND_WORK_WIDTH + nx;
          if (
            visited[neighbour]
            || luma(spec.palette[indices[neighbour]!]!) < spec.brightFloor
          ) continue;
          visited[neighbour] = 1;
          queue[tail++] = neighbour;
        }
      }
    }
    components.push({
      size: tail,
      span: Math.max(maxX - minX + 1, maxY - minY + 1),
    });
  }
  return components;
}

describe('v4 background pixel assets', () => {
  test.each(NAMES)('%s master is the byte-locked accepted 3:4 RGB source', (name) => {
    const spec = V4_BACKGROUND_ASSET_SPECS[name];
    const bytes = readFileSync(spec.master);
    const png = ihdr(bytes);
    expect(sha256(bytes)).toBe(spec.sourceSha256);
    expect([png.width, png.height]).toEqual([spec.sourceWidth, spec.sourceHeight]);
    expect(png.bitDepth).toBe(8);
    expect(png.colourType).toBe(ColourType.RGB);
    expect(png.width * 4).toBe(png.height * 3);
  });

  test.each(NAMES)('%s committed runtime plate is generator-exact RGB without metadata', (name) => {
    const spec = V4_BACKGROUND_ASSET_SPECS[name];
    const generated = buildV4BackgroundAsset(name);
    const committed = readFileSync(spec.output);
    expect(generated.bytes).toEqual(committed);

    const png = parsePng(committed);
    expect([png.width, png.height]).toEqual([
      V4_BACKGROUND_WIDTH,
      V4_BACKGROUND_HEIGHT,
    ]);
    expect(png.bitDepth).toBe(8);
    expect(png.colourType).toBe(ColourType.RGB);
    // The in-repo encoder writes no sRGB, iCCP, eXIf or other inherited master
    // metadata: the runtime colour bytes have one unambiguous interpretation.
    expect(png.chunks).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  test.each(NAMES)('%s is a literal nearest-neighbour 2× plate on its finite palette', (name) => {
    const spec = V4_BACKGROUND_ASSET_SPECS[name];
    const decoded = decodePng(readFileSync(spec.output));
    const palette = new Set(
      V4_BACKGROUND_PALETTES[name].map((colour) => colour.join(',')),
    );
    const used = new Set<string>();
    const nonPalette: string[] = [];
    const brokenBlocks: string[] = [];
    let transparent = 0;

    for (let y = 0; y < V4_BACKGROUND_HEIGHT; y += 2) {
      for (let x = 0; x < V4_BACKGROUND_WIDTH; x += 2) {
        const topLeft = (y * decoded.width + x) * 4;
        const colour = [
          decoded.rgba[topLeft]!,
          decoded.rgba[topLeft + 1]!,
          decoded.rgba[topLeft + 2]!,
        ] as const;
        used.add(colour.join(','));
        if (!palette.has(colour.join(',')) && nonPalette.length < 8) {
          nonPalette.push(`${x},${y}:${colour.join(',')}`);
        }

        for (let oy = 0; oy < 2; oy++) {
          for (let ox = 0; ox < 2; ox++) {
            const at = ((y + oy) * decoded.width + x + ox) * 4;
            if (
              decoded.rgba[at] !== colour[0]
              || decoded.rgba[at + 1] !== colour[1]
              || decoded.rgba[at + 2] !== colour[2]
            ) {
              if (brokenBlocks.length < 8) brokenBlocks.push(`${x},${y}`);
            }
            if (decoded.rgba[at + 3] !== 255) transparent++;
          }
        }
      }
    }
    expect(nonPalette, `${name} has non-palette colours`).toEqual([]);
    expect(brokenBlocks, `${name} has non-nearest 2× blocks`).toEqual([]);
    expect(transparent, `${name} is not opaque`).toBe(0);
    // A finite palette is not permission to collapse the material to a flat
    // ramp: several authored material tiers must actually survive.
    expect(used.size).toBeGreaterThanOrEqual(12);
    expect(used.size).toBeLessThanOrEqual(V4_BACKGROUND_PALETTES[name].length);
  });

  test.each(NAMES)('%s has no projectile-sized bright component', (name) => {
    const build = buildV4BackgroundAsset(name);
    const components = brightComponents(name, build.workIndices);
    expect(components.length, `${name} lost every highlight`).toBeGreaterThan(0);
    expect(
      Math.min(...components.map(({ size }) => size)),
      `${name} contains an isolated bright cluster`,
    ).toBeGreaterThanOrEqual(V4_BACKGROUND_ASSET_SPECS[name].minimumBrightCluster);
    expect(
      Math.min(...components.map(({ span }) => span)),
      `${name} contains a bright component shorter than the safe span`,
    ).toBeGreaterThanOrEqual(V4_BACKGROUND_ASSET_SPECS[name].minimumBrightSpan);
  });

  test('background palettes reserve warm heart and neutral bone accents for actors', () => {
    // Expanse is the cold cyan Ghost register: no warm branch survives.
    expect(
      V4_BACKGROUND_PALETTES.expanse.every(([red, green, blue]) => (
        red <= green && green <= blue
      )),
    ).toBe(true);
    // Vault may be graphite or violet but never red-led, and its graphite
    // ceiling stays below the actors' bright skeleton tier.
    expect(
      V4_BACKGROUND_PALETTES.vault.every(([red, green, blue]) => (
        red <= Math.max(green, blue)
      )),
    ).toBe(true);
    expect(Math.max(...V4_BACKGROUND_PALETTES.vault.map(luma))).toBeLessThan(130);

    // Undertow stays blue/indigo and Stratum stays graphite/slate: neither may
    // introduce a red-led warm particle register into the gameplay field.
    for (const name of ['undertow', 'stratum'] as const) {
      expect(
        V4_BACKGROUND_PALETTES[name].every(([red, green, blue]) => (
          red <= Math.max(green, blue)
        )),
        `${name} contains a red-led swatch`,
      ).toBe(true);
      expect(Math.max(...V4_BACKGROUND_PALETTES[name].map(luma))).toBeLessThan(130);
    }
  });

  test('every stage asset contract has unique paths and a valid darker fallback', () => {
    const masters = new Set<string>();
    const outputs = new Set<string>();
    for (const name of NAMES) {
      const spec = V4_BACKGROUND_ASSET_SPECS[name];
      expect(masters.has(spec.master), `${name} reuses a master path`).toBe(false);
      expect(outputs.has(spec.output), `${name} reuses an output path`).toBe(false);
      masters.add(spec.master);
      outputs.add(spec.output);
      expect(spec.palette.length).toBeLessThanOrEqual(256);
      expect(spec.palette.some((colour) => luma(colour) < spec.brightFloor)).toBe(true);
    }
  });

  test.each(NAMES)('%s generation is byte deterministic', (name) => {
    const source = readFileSync(V4_BACKGROUND_ASSET_SPECS[name].master);
    expect(buildV4BackgroundAsset(name, source).bytes)
      .toEqual(buildV4BackgroundAsset(name, source).bytes);
  });
});
