import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

import {
  buildV4BackgroundAsset,
  buildV4BackgroundSequenceAsset,
  V4_BACKGROUND_ASSET_NAMES,
  V4_BACKGROUND_ASSET_SPECS,
  V4_BACKGROUND_HEIGHT,
  V4_BACKGROUND_PALETTES,
  V4_BACKGROUND_SEQUENCE_COLUMNS,
  V4_BACKGROUND_SEQUENCE_FRAMES,
  V4_BACKGROUND_SEQUENCE_HEIGHT,
  V4_BACKGROUND_SEQUENCE_MOTION_PROFILES,
  V4_BACKGROUND_SEQUENCE_NAMES,
  V4_BACKGROUND_SEQUENCE_WIDTH,
  V4_BACKGROUND_WIDTH,
  V4_BACKGROUND_WORK_HEIGHT,
  V4_BACKGROUND_WORK_WIDTH,
  type V4BackgroundAssetName,
  type V4BackgroundSequenceName,
} from './v4-background-assets';
import { decodePng } from './png-decode';
import { ColourType, parsePng } from './png';

const NAMES: V4BackgroundAssetName[] = [...V4_BACKGROUND_ASSET_NAMES];
const SEQUENCE_NAMES: V4BackgroundSequenceName[] = [...V4_BACKGROUND_SEQUENCE_NAMES];

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

function frameChangeRatio(current: Uint8Array, next: Uint8Array): number {
  let changed = 0;
  for (let pixel = 0; pixel < current.length; pixel++) {
    if (current[pixel] !== next[pixel]) changed++;
  }
  return changed / current.length;
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

  test.each(NAMES)('%s committed base plate is generator-exact RGB without metadata', (name) => {
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

  test.each(SEQUENCE_NAMES)(
    '%s committed sequence is the exact sixteen-frame 4×4 RGB atlas',
    (name) => {
      const spec = V4_BACKGROUND_ASSET_SPECS[name];
      expect(spec.sequenceOutput).toBeDefined();
      const generated = buildV4BackgroundSequenceAsset(name);
      const committed = readFileSync(spec.sequenceOutput!);
      expect(generated.bytes).toEqual(committed);
      expect(generated.workFrames).toHaveLength(V4_BACKGROUND_SEQUENCE_FRAMES);

      const png = parsePng(committed);
      expect([png.width, png.height]).toEqual([
        V4_BACKGROUND_SEQUENCE_WIDTH,
        V4_BACKGROUND_SEQUENCE_HEIGHT,
      ]);
      expect(png.bitDepth).toBe(8);
      expect(png.colourType).toBe(ColourType.RGB);
      expect(png.chunks).toEqual(['IHDR', 'IDAT', 'IEND']);
    },
  );

  test('sixteen-frame motion profiles add authored phases instead of interpolated filler', () => {
    for (
      const [name, profile]
      of Object.entries(V4_BACKGROUND_SEQUENCE_MOTION_PROFILES)
    ) {
      for (const [layer, curve] of Object.entries(profile)) {
        let authoredOddPhases = 0;
        for (let phase = 1; phase < curve.length; phase += 2) {
          const previous = curve[phase - 1]!;
          const next = curve[(phase + 1) % curve.length]!;
          const midpoint = (previous + next) / 2;
          if (
            curve[phase] !== Math.floor(midpoint)
            && curve[phase] !== Math.ceil(midpoint)
          ) {
            authoredOddPhases++;
          }
        }
        expect(
          authoredOddPhases,
          `${name} ${layer} only densifies an eight-frame curve`,
        ).toBeGreaterThanOrEqual(4);
      }
    }
  });

  test.each(SEQUENCE_NAMES)(
    '%s owns sixteen unique poses with a materially different second half',
    (name) => {
      const frames = buildV4BackgroundSequenceAsset(name).workFrames;
      const hashes = frames.map((frame) => sha256(frame));
      expect(new Set(hashes).size).toBe(V4_BACKGROUND_SEQUENCE_FRAMES);

      const halfCycleFloor = name === 'expanse' ? 0.20 : 0.23;
      for (let frame = 0; frame < frames.length / 2; frame++) {
        expect(
          frameChangeRatio(frames[frame]!, frames[frame + frames.length / 2]!),
          `${name} frame ${frame} repeats its half-cycle partner`,
        ).toBeGreaterThan(halfCycleFloor);
      }
    },
  );

  test.each(SEQUENCE_NAMES)(
    '%s sequence frames stay opaque, finite-palette and bright-component safe',
    (name) => {
      const spec = V4_BACKGROUND_ASSET_SPECS[name];
      const build = buildV4BackgroundSequenceAsset(name);
      const decoded = decodePng(build.bytes);
      const palette = new Set(spec.palette.map((colour) => colour.join(',')));

      for (let frame = 0; frame < V4_BACKGROUND_SEQUENCE_FRAMES; frame++) {
        const tileX = frame % V4_BACKGROUND_SEQUENCE_COLUMNS;
        const tileY = Math.floor(frame / V4_BACKGROUND_SEQUENCE_COLUMNS);
        const indices = build.workFrames[frame]!;
        const components = brightComponents(name, indices);
        expect(components.length, `${name} frame ${frame} lost every highlight`)
          .toBeGreaterThan(0);
        expect(
          Math.min(...components.map(({ size }) => size)),
          `${name} frame ${frame} contains an isolated bright cluster`,
        ).toBeGreaterThanOrEqual(spec.minimumBrightCluster);
        expect(
          Math.min(...components.map(({ span }) => span)),
          `${name} frame ${frame} contains a short bright component`,
        ).toBeGreaterThanOrEqual(spec.minimumBrightSpan);

        const nonPalette: string[] = [];
        const mismatched: string[] = [];
        let transparent = 0;
        for (let y = 0; y < V4_BACKGROUND_WORK_HEIGHT; y++) {
          for (let x = 0; x < V4_BACKGROUND_WORK_WIDTH; x++) {
            const atlasX = tileX * V4_BACKGROUND_WORK_WIDTH + x;
            const atlasY = tileY * V4_BACKGROUND_WORK_HEIGHT + y;
            const at = (atlasY * decoded.width + atlasX) * 4;
            const colour = [
              decoded.rgba[at]!,
              decoded.rgba[at + 1]!,
              decoded.rgba[at + 2]!,
            ] as const;
            if (!palette.has(colour.join(',')) && nonPalette.length < 8) {
              nonPalette.push(`${x},${y}:${colour.join(',')}`);
            }
            if (decoded.rgba[at + 3] !== 255) transparent++;
            const paletteIndex = indices[y * V4_BACKGROUND_WORK_WIDTH + x]!;
            const expected = spec.palette[paletteIndex]!;
            if (
              (colour[0] !== expected[0]
                || colour[1] !== expected[1]
                || colour[2] !== expected[2])
              && mismatched.length < 8
            ) {
              mismatched.push(`${x},${y}`);
            }
          }
        }
        expect(nonPalette, `${name} frame ${frame} has non-palette colours`).toEqual([]);
        expect(mismatched, `${name} frame ${frame} does not match its work indices`)
          .toEqual([]);
        expect(transparent, `${name} frame ${frame} is not opaque`).toBe(0);
      }
    },
  );

  test.each(SEQUENCE_NAMES)(
    '%s sequence changes broad material on every edge of its seamless loop',
    (name) => {
      const frames = buildV4BackgroundSequenceAsset(name).workFrames;
      const corridorThreshold = name === 'expanse' ? 80 : 72;
      const changeBand = name === 'expanse'
        ? { minimum: 0.06, maximum: 0.28 }
        : { minimum: 0.27, maximum: 0.32 };
      for (let frame = 0; frame < frames.length; frame++) {
        const current = frames[frame]!;
        const next = frames[(frame + 1) % frames.length]!;
        let changed = 0;
        let changedInCorridor = 0;
        for (let pixel = 0; pixel < current.length; pixel++) {
          if (current[pixel] === next[pixel]) continue;
          changed++;
          const x = pixel % V4_BACKGROUND_WORK_WIDTH;
          if (Math.abs(x * 2 - (V4_BACKGROUND_WORK_WIDTH - 1)) < corridorThreshold) {
            changedInCorridor++;
          }
        }
        const ratio = changed / current.length;
        expect(ratio, `${name} ${frame}→${(frame + 1) % frames.length} is static`)
          .toBeGreaterThan(changeBand.minimum);
        expect(ratio, `${name} ${frame}→${(frame + 1) % frames.length} hard-cuts`)
          .toBeLessThan(changeBand.maximum);
        const corridorMessage =
          `${name} ${frame}→${(frame + 1) % frames.length} moves the play corridor`;
        if (name === 'expanse') {
          expect(changedInCorridor, corridorMessage).toBe(0);
        } else {
          /*
           * Undertow's component cleanup can settle ten edge-adjacent work
           * texels while keeping every moving source sample outside the shaft.
           */
          expect(changedInCorridor, corridorMessage).toBeLessThanOrEqual(10);
        }
      }
    },
  );

  test('expanse breath and undertow descent have different material-change cadence', () => {
    const edgeChanges = (name: V4BackgroundSequenceName): number[] => {
      const frames = buildV4BackgroundSequenceAsset(name).workFrames;
      return frames.map((frame, index) => (
        frameChangeRatio(frame, frames[(index + 1) % frames.length]!)
      ));
    };

    const breathEdges = edgeChanges('expanse');
    const descentEdges = edgeChanges('undertow');
    const breathChange = breathEdges.reduce((sum, value) => sum + value, 0)
      / breathEdges.length;
    const descentChange = descentEdges.reduce((sum, value) => sum + value, 0)
      / descentEdges.length;
    expect(breathChange).toBeGreaterThan(0.15);
    expect(breathChange).toBeLessThan(0.19);
    expect(descentChange).toBeGreaterThan(0.28);
    expect(descentChange).toBeLessThan(0.31);
    expect(Math.max(...breathEdges) - Math.min(...breathEdges))
      .toBeGreaterThan(0.15);
    expect(Math.max(...descentEdges) - Math.min(...descentEdges))
      .toBeGreaterThan(0.02);
    expect(Math.max(...descentEdges) - Math.min(...descentEdges))
      .toBeLessThan(0.05);
    expect(descentChange - breathChange).toBeGreaterThan(0.12);
  });

  test.each(SEQUENCE_NAMES)('%s sequence generation is byte deterministic', (name) => {
    const source = readFileSync(V4_BACKGROUND_ASSET_SPECS[name].master);
    expect(buildV4BackgroundSequenceAsset(name, source).bytes)
      .toEqual(buildV4BackgroundSequenceAsset(name, source).bytes);
  });
});
