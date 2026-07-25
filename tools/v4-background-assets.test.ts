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

interface ChangeBand {
  readonly minimum: number;
  readonly maximum: number;
}

interface CadenceBand {
  readonly average: ChangeBand;
  readonly spread: ChangeBand;
}

/*
 * These ranges describe four different kinds of authored material motion, not
 * one generic "animated enough" floor. They are deliberately wider than a
 * byte-exact fixture while still rejecting a static loop or a hard cut.
 */
const HALF_CYCLE_CHANGE_BANDS = {
  expanse: { minimum: 0.20, maximum: 0.30 },
  undertow: { minimum: 0.23, maximum: 0.29 },
  regnum: { minimum: 0.09, maximum: 0.26 },
  'wear-field': { minimum: 0.25, maximum: 0.31 },
} as const satisfies Record<V4BackgroundSequenceName, ChangeBand>;

const ADJACENT_CHANGE_BANDS = {
  expanse: { minimum: 0.06, maximum: 0.28 },
  undertow: { minimum: 0.27, maximum: 0.32 },
  regnum: { minimum: 0.04, maximum: 0.23 },
  'wear-field': { minimum: 0.28, maximum: 0.32 },
} as const satisfies Record<V4BackgroundSequenceName, ChangeBand>;

const CADENCE_BANDS = {
  expanse: {
    average: { minimum: 0.15, maximum: 0.19 },
    spread: { minimum: 0.15, maximum: 0.22 },
  },
  undertow: {
    average: { minimum: 0.28, maximum: 0.31 },
    spread: { minimum: 0.02, maximum: 0.05 },
  },
  regnum: {
    average: { minimum: 0.12, maximum: 0.14 },
    spread: { minimum: 0.15, maximum: 0.19 },
  },
  'wear-field': {
    average: { minimum: 0.29, maximum: 0.31 },
    spread: { minimum: 0.01, maximum: 0.025 },
  },
} as const satisfies Record<V4BackgroundSequenceName, CadenceBand>;

const REGNUM_BOSS_QUIET_BOTTOM = 72;
const REGNUM_PLAYER_QUIET_TOP = 220;
const REGNUM_MATERIAL_FAMILIES = {
  lacquer: { first: 3, last: 8, minimumParticipation: 0.50 },
  ash: { first: 9, last: 14, minimumParticipation: 0.10 },
  pearl: { first: 15, last: 18, minimumParticipation: 0.30 },
} as const;

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

function rowBandChangeRatio(
  current: Uint8Array,
  next: Uint8Array,
  top: number,
  bottom: number,
): number {
  let changed = 0;
  const first = top * V4_BACKGROUND_WORK_WIDTH;
  const last = bottom * V4_BACKGROUND_WORK_WIDTH;
  for (let pixel = first; pixel < last; pixel++) {
    if (current[pixel] !== next[pixel]) changed++;
  }
  return changed / (last - first);
}

/**
 * Find the uniform integer translation that explains the largest fraction of
 * REGNUM's non-void middle material. The generator moves by at most three work
 * pixels; if one such translation explains almost the whole frame, the intended
 * asynchronous strata have silently collapsed into a camera move.
 */
function bestRegnumUniformTranslationMatch(
  frame: Uint8Array,
  base: Uint8Array,
): number {
  let best = 0;
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      let compared = 0;
      let matching = 0;
      for (let y = REGNUM_BOSS_QUIET_BOTTOM; y < REGNUM_PLAYER_QUIET_TOP; y++) {
        for (let x = 0; x < V4_BACKGROUND_WORK_WIDTH; x++) {
          const destination = y * V4_BACKGROUND_WORK_WIDTH + x;
          // Indices 0..2 are the intentionally fixed near-void register.
          if (base[destination]! <= 2) continue;
          const sourceX = x + dx;
          const sourceY = y + dy;
          if (
            sourceX < 0
            || sourceX >= V4_BACKGROUND_WORK_WIDTH
            || sourceY < REGNUM_BOSS_QUIET_BOTTOM
            || sourceY >= REGNUM_PLAYER_QUIET_TOP
          ) continue;
          compared++;
          const source = sourceY * V4_BACKGROUND_WORK_WIDTH + sourceX;
          if (frame[destination] === base[source]) matching++;
        }
      }
      best = Math.max(best, matching / compared);
    }
  }
  return best;
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

  test('background palettes keep actor and projectile accents restrained', () => {
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

    // The ending may retain a trace of muted-heart wear, but not a new warm
    // projectile register: only two subdued swatches are red-led and even the
    // broad worn-silver tier remains far below white.
    const wearField = V4_BACKGROUND_PALETTES['wear-field'];
    expect(
      wearField.filter(([red, green, blue]) => red > Math.max(green, blue)),
    ).toHaveLength(2);
    expect(Math.max(...wearField.map(luma))).toBeLessThan(150);
  });

  test('every background asset contract has unique paths and a valid darker fallback', () => {
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

      const halfCycleBand = HALF_CYCLE_CHANGE_BANDS[name];
      for (let frame = 0; frame < frames.length / 2; frame++) {
        const ratio = frameChangeRatio(
          frames[frame]!,
          frames[frame + frames.length / 2]!,
        );
        expect(ratio, `${name} frame ${frame} repeats its half-cycle partner`)
          .toBeGreaterThan(halfCycleBand.minimum);
        expect(ratio, `${name} frame ${frame} hard-cuts to its half-cycle partner`)
          .toBeLessThan(halfCycleBand.maximum);
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
      const changeBand = ADJACENT_CHANGE_BANDS[name];
      for (let frame = 0; frame < frames.length; frame++) {
        const current = frames[frame]!;
        const next = frames[(frame + 1) % frames.length]!;
        let changed = 0;
        let changedInCorridor = 0;
        let changedInEndingCopy = 0;
        let changedInRegnumQuietBand = 0;
        for (let pixel = 0; pixel < current.length; pixel++) {
          if (current[pixel] === next[pixel]) continue;
          changed++;
          const x = pixel % V4_BACKGROUND_WORK_WIDTH;
          const y = Math.floor(pixel / V4_BACKGROUND_WORK_WIDTH);
          if (
            (name === 'expanse' || name === 'undertow')
            && Math.abs(x * 2 - (V4_BACKGROUND_WORK_WIDTH - 1))
              < (name === 'expanse' ? 80 : 72)
          ) {
            changedInCorridor++;
          }
          if (
            name === 'wear-field'
            && x >= 58
            && x < 182
            && y >= 40
            && y < 168
          ) {
            changedInEndingCopy++;
          }
          if (
            name === 'regnum'
            && (y < REGNUM_BOSS_QUIET_BOTTOM || y >= REGNUM_PLAYER_QUIET_TOP)
          ) {
            changedInRegnumQuietBand++;
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
        } else if (name === 'undertow') {
          /*
           * Undertow's component cleanup can settle ten edge-adjacent work
           * texels while keeping every moving source sample outside the shaft.
           */
          expect(changedInCorridor, corridorMessage).toBeLessThanOrEqual(10);
        } else if (name === 'wear-field') {
          expect(
            changedInEndingCopy,
            `${name} ${frame}→${(frame + 1) % frames.length} moves the ending copy`,
          ).toBe(0);
        } else {
          expect(
            changedInRegnumQuietBand,
            `${name} ${frame}→${(frame + 1) % frames.length} moves a quiet band`,
          ).toBe(0);
        }
      }
    },
  );

  test('the four sequence atlases keep distinct material-change cadence', () => {
    const edgeChanges = (name: V4BackgroundSequenceName): number[] => {
      const frames = buildV4BackgroundSequenceAsset(name).workFrames;
      return frames.map((frame, index) => (
        frameChangeRatio(frame, frames[(index + 1) % frames.length]!)
      ));
    };

    const metrics = Object.fromEntries(SEQUENCE_NAMES.map((name) => {
      const edges = edgeChanges(name);
      return [
        name,
        {
          average: edges.reduce((sum, value) => sum + value, 0) / edges.length,
          spread: Math.max(...edges) - Math.min(...edges),
        },
      ];
    })) as Record<
      V4BackgroundSequenceName,
      { readonly average: number; readonly spread: number }
    >;

    for (const name of SEQUENCE_NAMES) {
      const expected = CADENCE_BANDS[name];
      const actual = metrics[name];
      expect(actual.average, `${name} cadence average is too static`)
        .toBeGreaterThan(expected.average.minimum);
      expect(actual.average, `${name} cadence average is too abrupt`)
        .toBeLessThan(expected.average.maximum);
      expect(actual.spread, `${name} cadence lost its authored variation`)
        .toBeGreaterThan(expected.spread.minimum);
      expect(actual.spread, `${name} cadence variation is unstable`)
        .toBeLessThan(expected.spread.maximum);
    }

    expect(metrics.expanse.average - metrics.regnum.average).toBeGreaterThan(0.025);
    expect(metrics.undertow.average - metrics.expanse.average).toBeGreaterThan(0.12);
    expect(metrics['wear-field'].average - metrics.expanse.average)
      .toBeGreaterThan(0.11);
    expect(metrics.regnum.spread - metrics.undertow.spread).toBeGreaterThan(0.12);
    expect(metrics.undertow.spread - metrics['wear-field'].spread)
      .toBeGreaterThan(0.008);
  });

  test('regnum shears three material families while its Boss and player bands stay still', () => {
    const frames = buildV4BackgroundSequenceAsset('regnum').workFrames;
    const base = buildV4BackgroundAsset('regnum').workIndices;

    for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
      const frame = frames[frameIndex]!;
      const bossQuietEnd =
        REGNUM_BOSS_QUIET_BOTTOM * V4_BACKGROUND_WORK_WIDTH;
      const playerQuietStart =
        REGNUM_PLAYER_QUIET_TOP * V4_BACKGROUND_WORK_WIDTH;
      expect(
        frame.subarray(0, bossQuietEnd),
        `regnum frame ${frameIndex} moves the Boss station`,
      ).toEqual(base.subarray(0, bossQuietEnd));
      expect(
        frame.subarray(playerQuietStart),
        `regnum frame ${frameIndex} moves the player band`,
      ).toEqual(base.subarray(playerQuietStart));

      const next = frames[(frameIndex + 1) % frames.length]!;
      const middleChange = rowBandChangeRatio(
        frame,
        next,
        REGNUM_BOSS_QUIET_BOTTOM,
        REGNUM_PLAYER_QUIET_TOP,
      );
      expect(middleChange, `regnum frame ${frameIndex} leaves its middle static`)
        .toBeGreaterThan(0.10);
      expect(middleChange, `regnum frame ${frameIndex} hard-cuts its middle`)
        .toBeLessThan(0.49);

      expect(
        bestRegnumUniformTranslationMatch(frame, base),
        `regnum frame ${frameIndex} collapses its strata into one camera move`,
      ).toBeLessThan(0.84);
    }

    const familyParticipation = Object.fromEntries(
      Object.entries(REGNUM_MATERIAL_FAMILIES).map(([name, family]) => {
        let population = 0;
        let changed = 0;
        let participatingFrames = 0;
        for (
          let y = REGNUM_BOSS_QUIET_BOTTOM;
          y < REGNUM_PLAYER_QUIET_TOP;
          y++
        ) {
          for (let x = 0; x < V4_BACKGROUND_WORK_WIDTH; x++) {
            const pixel = y * V4_BACKGROUND_WORK_WIDTH + x;
            const index = base[pixel]!;
            if (index >= family.first && index <= family.last) population++;
          }
        }
        for (const frame of frames) {
          let frameChanged = 0;
          for (
            let y = REGNUM_BOSS_QUIET_BOTTOM;
            y < REGNUM_PLAYER_QUIET_TOP;
            y++
          ) {
            for (let x = 0; x < V4_BACKGROUND_WORK_WIDTH; x++) {
              const pixel = y * V4_BACKGROUND_WORK_WIDTH + x;
              const index = base[pixel]!;
              if (
                index >= family.first
                && index <= family.last
                && frame[pixel] !== index
              ) {
                changed++;
                frameChanged++;
              }
            }
          }
          if (frameChanged > 0) participatingFrames++;
        }
        expect(population, `regnum has no ${name} material in its moving band`)
          .toBeGreaterThan(0);
        expect(participatingFrames, `regnum ${name} only appears in part of the loop`)
          .toBe(V4_BACKGROUND_SEQUENCE_FRAMES);
        const participation = changed / (population * frames.length);
        expect(participation, `regnum ${name} material does not visibly move`)
          .toBeGreaterThan(family.minimumParticipation);
        return [name, participation];
      }),
    ) as Record<keyof typeof REGNUM_MATERIAL_FAMILIES, number>;

    /*
     * Material-dependent response is the distinguishing feature of this atlas.
     * A uniform camera translation would not preserve these three wide tiers.
     */
    expect(familyParticipation.lacquer - familyParticipation.pearl)
      .toBeGreaterThan(0.12);
    expect(familyParticipation.pearl - familyParticipation.ash)
      .toBeGreaterThan(0.12);
  });

  test('wear-field animates three worn edges while its ending-copy zone stays still', () => {
    const frames = buildV4BackgroundSequenceAsset('wear-field').workFrames;
    const base = buildV4BackgroundAsset('wear-field').workIndices;
    const edgeZones = [
      { name: 'left', x0: 0, x1: 92, y0: 72, y1: V4_BACKGROUND_WORK_HEIGHT },
      {
        name: 'right',
        x0: 148,
        x1: V4_BACKGROUND_WORK_WIDTH,
        y0: 116,
        y1: V4_BACKGROUND_WORK_HEIGHT,
      },
      {
        name: 'bottom',
        x0: 0,
        x1: V4_BACKGROUND_WORK_WIDTH,
        y0: 198,
        y1: V4_BACKGROUND_WORK_HEIGHT,
      },
    ] as const;

    let changedInCopy = 0;
    for (const frame of frames) {
      for (let y = 40; y < 168; y++) {
        for (let x = 58; x < 182; x++) {
          const pixel = y * V4_BACKGROUND_WORK_WIDTH + x;
          if (frame[pixel] !== base[pixel]) changedInCopy++;
        }
      }
    }
    expect(changedInCopy, 'wear-field moves the ending-copy zone').toBe(0);

    for (const zone of edgeZones) {
      let changed = 0;
      let measured = 0;
      for (let frame = 0; frame < frames.length; frame++) {
        const current = frames[frame]!;
        const next = frames[(frame + 1) % frames.length]!;
        for (let y = zone.y0; y < zone.y1; y++) {
          for (let x = zone.x0; x < zone.x1; x++) {
            const pixel = y * V4_BACKGROUND_WORK_WIDTH + x;
            measured++;
            if (current[pixel] !== next[pixel]) changed++;
          }
        }
      }
      expect(
        changed / measured,
        `wear-field ${zone.name} path does not materially animate`,
      ).toBeGreaterThan(0.44);
    }
  });

  test.each(SEQUENCE_NAMES)('%s sequence generation is byte deterministic', (name) => {
    const source = readFileSync(V4_BACKGROUND_ASSET_SPECS[name].master);
    expect(buildV4BackgroundSequenceAsset(name, source).bytes)
      .toEqual(buildV4BackgroundSequenceAsset(name, source).bytes);
  });
});
