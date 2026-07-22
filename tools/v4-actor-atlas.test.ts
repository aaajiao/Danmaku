import { describe, expect, test } from 'bun:test';
import { decodePng } from './png-decode';

interface SheetSpec {
  readonly name: string;
  readonly url: URL;
  readonly frame: number;
  readonly columns: number;
  readonly rows: number;
  readonly semanticStrip: number;
}

interface FrameAlpha {
  readonly count: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly hash: number;
}

const SHEETS: readonly SheetSpec[] = [
  {
    name: 'players',
    url: new URL('../src/assets/v4/actors-player-v4.png', import.meta.url),
    frame: 128,
    columns: 5,
    rows: 5,
    semanticStrip: 5,
  },
  {
    name: 'enemies',
    url: new URL('../src/assets/v4/actors-enemies-v4.png', import.meta.url),
    frame: 128,
    columns: 8,
    rows: 8,
    semanticStrip: 4,
  },
  {
    name: 'bosses',
    url: new URL('../src/assets/v4/actors-bosses-v4.png', import.meta.url),
    frame: 192,
    columns: 5,
    rows: 5,
    semanticStrip: 5,
  },
];

function frameAlpha(
  rgba: Uint8Array,
  sheetWidth: number,
  frame: number,
  column: number,
  row: number,
): FrameAlpha {
  let count = 0;
  let minX = frame;
  let minY = frame;
  let maxX = -1;
  let maxY = -1;
  let hash = 0x811c9dc5;
  for (let y = 0; y < frame; y++) {
    for (let x = 0; x < frame; x++) {
      const source = (((row * frame + y) * sheetWidth) + column * frame + x) * 4;
      const alpha = rgba[source + 3]!;
      hash ^= alpha;
      hash = Math.imul(hash, 0x01000193);
      if (alpha === 0) continue;
      count++;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { count, minX, minY, maxX, maxY, hash: hash >>> 0 };
}

describe('compiled v4 Ghost actor atlases', () => {
  for (const spec of SHEETS) {
    test(`${spec.name}: every authored pose is non-empty, padded and distinct`, async () => {
      const image = decodePng(await Bun.file(spec.url).bytes());
      expect(image.width).toBe(spec.columns * spec.frame);
      expect(image.height).toBe(spec.rows * spec.frame);

      const cells: FrameAlpha[] = [];
      for (let row = 0; row < spec.rows; row++) {
        for (let column = 0; column < spec.columns; column++) {
          const cell = frameAlpha(image.rgba, image.width, spec.frame, column, row);
          expect(cell.count).toBeGreaterThan(48);
          // Transparent gutters make linear/nearest filtering and neighbouring
          // frame sampling safe. Seven pixels is the rounded 8px build target.
          expect(cell.minX).toBeGreaterThanOrEqual(7);
          expect(cell.minY).toBeGreaterThanOrEqual(7);
          expect(cell.maxX).toBeLessThanOrEqual(spec.frame - 8);
          expect(cell.maxY).toBeLessThanOrEqual(spec.frame - 8);
          cells.push(cell);
        }
      }

      // Within each semantic strip, no two poses may collapse to the same
      // alpha silhouette. This catches an accidentally repeated crop even when
      // the PNG dimensions and non-empty checks still look healthy.
      if (spec.name === 'enemies') {
        for (let actor = 0; actor < 16; actor++) {
          const atlasRow = Math.floor(actor / 2);
          const start = (actor % 2) * 4;
          const hashes = Array.from({ length: 4 }, (_, frameIndex) =>
            cells[atlasRow * spec.columns + start + frameIndex]!.hash,
          );
          expect(new Set(hashes).size).toBe(4);
        }
      } else {
        for (let row = 0; row < spec.rows; row++) {
          const hashes = cells
            .slice(row * spec.semanticStrip, (row + 1) * spec.semanticStrip)
            .map((cell) => cell.hash);
          expect(new Set(hashes).size).toBe(spec.semanticStrip);
        }
      }
    });
  }
});
