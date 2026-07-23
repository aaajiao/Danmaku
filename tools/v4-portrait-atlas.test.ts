import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';

import { decodePng } from './png-decode';
import { ColourType, parsePng } from './png';
import {
  V4_DIALOGUE_PORTRAIT_ATLAS_HEIGHT,
  V4_DIALOGUE_PORTRAIT_ATLAS_WIDTH,
  V4_DIALOGUE_PORTRAIT_COLUMNS,
  V4_DIALOGUE_PORTRAIT_CROPS,
  V4_DIALOGUE_PORTRAIT_FRAME,
  V4_DIALOGUE_PORTRAIT_GUTTER,
  V4_DIALOGUE_PORTRAIT_INNER,
  V4_DIALOGUE_PORTRAIT_ROWS,
  V4_DIALOGUE_PORTRAIT_SHEET,
  V4_PORTRAIT_PLAYER_MASTER,
  buildV4DialoguePortraitAtlasWithAudit,
  v4DialoguePortraitSheet,
  v4PortraitKeyedAlpha,
  type V4DialoguePortraitAtlasBuild,
} from './v4-portrait-assets';

const EXPECTED_STRIPS: string[] = [
  'actor.portrait.player.scout',
  'actor.portrait.player.lance',
  'actor.portrait.player.hound',
  'actor.portrait.player.spire',
  'actor.portrait.player.maw',
  'actor.portrait.boss.sentinel',
  'actor.portrait.boss.warden',
  'actor.portrait.boss.magistrate',
  'actor.portrait.boss.chancellor',
  'actor.portrait.boss.regent',
];

const EXPECTED_SOURCE_AUDIT: Array<[string, number, number]> = [
  ['scout', 12_084, 3_034_949],
  ['lance', 11_829, 2_940_374],
  ['hound', 16_024, 4_004_828],
  ['spire', 11_481, 2_892_325],
  ['maw', 16_966, 4_260_096],
  ['sentinel', 13_603, 3_433_131],
  ['warden', 14_573, 3_636_540],
  ['magistrate', 10_734, 2_712_823],
  ['chancellor', 14_765, 3_720_769],
  ['regent', 13_048, 3_272_680],
];

const EXPECTED_OUTPUT_AUDIT: Array<[string, number, number[]]> = [
  ['scout', 23_867, [31, 18, 223, 247]],
  ['lance', 23_795, [36, 18, 218, 247]],
  ['hound', 31_965, [8, 18, 245, 247]],
  ['spire', 22_508, [22, 18, 226, 247]],
  ['maw', 33_471, [10, 18, 239, 247]],
  ['sentinel', 26_828, [25, 18, 230, 247]],
  ['warden', 25_057, [8, 17, 247, 247]],
  ['magistrate', 21_043, [41, 18, 218, 247]],
  ['chancellor', 28_964, [29, 18, 229, 247]],
  ['regent', 25_694, [29, 18, 227, 247]],
];

const V4_DIALOGUE_PORTRAIT_ATLAS_SHA256 =
  '32ff8e6be2ad4c1de2db3b2159f74880b67809840c3fcffc5ec605b570693829';

let cached: V4DialoguePortraitAtlasBuild | undefined;

function built(): V4DialoguePortraitAtlasBuild {
  cached ??= buildV4DialoguePortraitAtlasWithAudit();
  return cached;
}

function fnvCell(
  rgba: Uint8Array,
  width: number,
  column: number,
  row: number,
): number {
  let hash = 0x811c9dc5;
  for (let y = 0; y < V4_DIALOGUE_PORTRAIT_FRAME; y++) {
    for (let x = 0; x < V4_DIALOGUE_PORTRAIT_FRAME; x++) {
      const at =
        ((((row * V4_DIALOGUE_PORTRAIT_FRAME + y) * width) +
          column * V4_DIALOGUE_PORTRAIT_FRAME +
          x) *
          4);
      for (let channel = 0; channel < 4; channel++) {
        hash ^= rgba[at + channel]!;
        hash = Math.imul(hash, 0x01000193);
      }
    }
  }
  return hash >>> 0;
}

describe('v4 high-resolution dialogue portrait atlas', () => {
  test('the sheet ledger is one deterministic 5×2 grid in semantic order', () => {
    expect(V4_DIALOGUE_PORTRAIT_FRAME).toBe(256);
    expect(V4_DIALOGUE_PORTRAIT_COLUMNS).toBe(5);
    expect(V4_DIALOGUE_PORTRAIT_ROWS).toBe(2);
    expect(V4_DIALOGUE_PORTRAIT_INNER).toBe(240);
    expect(V4_DIALOGUE_PORTRAIT_GUTTER).toBe(8);
    expect(V4_DIALOGUE_PORTRAIT_CROPS.map((crop) => crop.strip)).toEqual(
      EXPECTED_STRIPS,
    );
    expect(new Set(EXPECTED_STRIPS).size).toBe(10);

    const sheet = v4DialoguePortraitSheet();
    expect(sheet.sheet).toBe(V4_DIALOGUE_PORTRAIT_SHEET);
    expect(Object.keys(sheet.strips)).toEqual(EXPECTED_STRIPS);
    for (const crop of V4_DIALOGUE_PORTRAIT_CROPS) {
      expect(sheet.strips[crop.strip]).toEqual({
        x: crop.atlasColumn * V4_DIALOGUE_PORTRAIT_FRAME,
        y: crop.atlasRow * V4_DIALOGUE_PORTRAIT_FRAME,
        frameW: V4_DIALOGUE_PORTRAIT_FRAME,
        frameH: V4_DIALOGUE_PORTRAIT_FRAME,
        frames: 1,
        stride: V4_DIALOGUE_PORTRAIT_FRAME,
        ticksPerFrame: 1,
        mode: 'once',
        color: 'baked',
      });
    }
  });

  test('the black-key matte keeps haze transparent and edge coverage fractional', () => {
    expect(v4PortraitKeyedAlpha(12, 1, 2, 255)).toBe(0);
    expect(v4PortraitKeyedAlpha(13, 1, 2, 255)).toBe(21);
    expect(v4PortraitKeyedAlpha(18, 1, 2, 255)).toBe(128);
    expect(v4PortraitKeyedAlpha(23, 1, 2, 255)).toBe(234);
    expect(v4PortraitKeyedAlpha(24, 1, 2, 255)).toBe(255);
    expect(v4PortraitKeyedAlpha(18, 1, 2, 128)).toBe(64);
    expect(v4PortraitKeyedAlpha(255, 255, 255, 0)).toBe(0);
  });

  test('two builds and the committed pack atlas are byte-identical', async () => {
    const first = built();
    const second = buildV4DialoguePortraitAtlasWithAudit();
    expect(
      Buffer.compare(Buffer.from(first.bytes), Buffer.from(second.bytes)),
    ).toBe(0);
    expect(createHash('sha256').update(first.bytes).digest('hex')).toBe(
      V4_DIALOGUE_PORTRAIT_ATLAS_SHA256,
    );
    const committed = await Bun.file(
      new URL(`../packs/v4/${V4_DIALOGUE_PORTRAIT_SHEET}`, import.meta.url),
    ).bytes();
    expect(
      Buffer.compare(Buffer.from(first.bytes), Buffer.from(committed)),
    ).toBe(0);
  });

  test('the PNG is the exact RGBA atlas size and all source foreground is owned', () => {
    const rebuilt = built();
    const png = parsePng(rebuilt.bytes);
    expect(png.width).toBe(V4_DIALOGUE_PORTRAIT_ATLAS_WIDTH);
    expect(png.height).toBe(V4_DIALOGUE_PORTRAIT_ATLAS_HEIGHT);
    expect(png.bitDepth).toBe(8);
    expect(png.colourType).toBe(ColourType.RGBA);
    expect(rebuilt.playerSourceForegroundPixels).toBe(527_071);
    expect(rebuilt.playerAssignedForegroundPixels).toBe(
      rebuilt.playerSourceForegroundPixels,
    );
    expect(rebuilt.bossSourceForegroundPixels).toBe(414_898);
    expect(rebuilt.bossAssignedForegroundPixels).toBe(
      rebuilt.bossSourceForegroundPixels,
    );
  });

  test('the authored crops retain their measured face/heart source evidence', () => {
    const placements = built().placements;
    expect(placements).toHaveLength(10);
    expect(
      placements.map((placement) => [
        placement.name,
        placement.sourcePixels,
        placement.sourceAlpha,
      ]),
    ).toEqual(EXPECTED_SOURCE_AUDIT);

    for (let index = 0; index < placements.length; index++) {
      const placement = placements[index]!;
      const crop = V4_DIALOGUE_PORTRAIT_CROPS[index]!;
      expect({
        family: placement.family,
        pose: placement.pose,
        sourceX: placement.sourceX,
        sourceY: placement.sourceY,
        sourceSize: placement.sourceSize,
        destX: placement.destX,
        destY: placement.destY,
        destSize: placement.destSize,
      }).toEqual({
        family: crop.family,
        pose: crop.pose,
        sourceX: crop.sourceX,
        sourceY: crop.sourceY,
        sourceSize: crop.sourceSize,
        destX:
          crop.atlasColumn * V4_DIALOGUE_PORTRAIT_FRAME +
          V4_DIALOGUE_PORTRAIT_GUTTER,
        destY:
          crop.atlasRow * V4_DIALOGUE_PORTRAIT_FRAME +
          V4_DIALOGUE_PORTRAIT_GUTTER,
        destSize: V4_DIALOGUE_PORTRAIT_INNER,
      });
    }
  });

  test('all ten cells are distinct, soft-edged and stay inside the 8px gutter', () => {
    const rebuilt = built();
    expect(
      rebuilt.placements.map((placement) => [
        placement.name,
        placement.outputPixels,
        [
          placement.outputBounds.minX,
          placement.outputBounds.minY,
          placement.outputBounds.maxX,
          placement.outputBounds.maxY,
        ],
      ]),
    ).toEqual(EXPECTED_OUTPUT_AUDIT);

    const image = decodePng(rebuilt.bytes);
    const hashes: number[] = [];
    let partialAlphaPixels = 0;
    let gutterViolations = 0;
    for (const crop of V4_DIALOGUE_PORTRAIT_CROPS) {
      hashes.push(
        fnvCell(
          image.rgba,
          image.width,
          crop.atlasColumn,
          crop.atlasRow,
        ),
      );
      for (let y = 0; y < V4_DIALOGUE_PORTRAIT_FRAME; y++) {
        for (let x = 0; x < V4_DIALOGUE_PORTRAIT_FRAME; x++) {
          const at =
            ((((crop.atlasRow * V4_DIALOGUE_PORTRAIT_FRAME + y) *
              image.width) +
              crop.atlasColumn * V4_DIALOGUE_PORTRAIT_FRAME +
              x) *
              4);
          const alpha = image.rgba[at + 3]!;
          const outsideInner =
            x < V4_DIALOGUE_PORTRAIT_GUTTER ||
            y < V4_DIALOGUE_PORTRAIT_GUTTER ||
            x >=
              V4_DIALOGUE_PORTRAIT_FRAME -
                V4_DIALOGUE_PORTRAIT_GUTTER ||
            y >=
              V4_DIALOGUE_PORTRAIT_FRAME -
                V4_DIALOGUE_PORTRAIT_GUTTER;
          if (outsideInner && alpha !== 0) gutterViolations++;
          if (alpha > 0 && alpha < 255) partialAlphaPixels++;
        }
      }
    }
    expect(new Set(hashes).size).toBe(10);
    expect(partialAlphaPixels).toBeGreaterThan(10_000);
    expect(gutterViolations).toBe(0);

    // Transparent pixels carry zero RGB, so filtering against the gutter
    // cannot reveal a hidden black/coloured fringe.
    let transparentRgbViolations = 0;
    for (let at = 0; at < image.rgba.length; at += 4) {
      if (image.rgba[at + 3] !== 0) continue;
      if (
        image.rgba[at] !== 0 ||
        image.rgba[at + 1] !== 0 ||
        image.rgba[at + 2] !== 0
      ) {
        transparentRgbViolations++;
      }
    }
    expect(transparentRgbViolations).toBe(0);
  });

  test('a drifted master is refused before crop geometry can bless it', async () => {
    const bytes = new Uint8Array(await Bun.file(V4_PORTRAIT_PLAYER_MASTER).bytes());
    bytes[bytes.length - 20] = bytes[bytes.length - 20]! ^ 1;
    expect(() => buildV4DialoguePortraitAtlasWithAudit(bytes)).toThrow(
      'player portrait master SHA-256',
    );
  });
});
