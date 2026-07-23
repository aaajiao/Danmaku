import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { V4_UI_SCREEN } from '../src/render/v4-ui-layout';
import { decodePng } from './png-decode';
import {
  V4_BOSS_ACTOR_NAMES,
  V4_ENEMY_ACTOR_NAMES,
  V4_PLAYER_ACTOR_NAMES,
  buildV4BossActorAtlasWithAudit,
} from './v4-actor-assets';

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
    url: new URL('../packs/v4/actors/players.png', import.meta.url),
    frame: 128,
    columns: 5,
    rows: 5,
    semanticStrip: 5,
  },
  {
    name: 'enemies',
    url: new URL('../packs/v4/actors/enemies.png', import.meta.url),
    frame: 128,
    columns: 8,
    rows: 8,
    semanticStrip: 4,
  },
  {
    name: 'bosses',
    url: new URL('../packs/v4/actors/bosses.png', import.meta.url),
    frame: 192,
    columns: 5,
    rows: 5,
    semanticStrip: 5,
  },
];

const V4_BOSS_ACTOR_ATLAS_SHA256 =
  'ed0f0bcfadaf4e07c24006a8c716f8e5d67086bd3d7ad30451479cac25f8e814';
const V4_BOSS_RUNTIME_ANCHORS = [
  [96, 94],
  [96, 97],
  [96, 89],
  [96, 93],
  [96, 103],
] as const;

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
  test('pack manifest owns every actor strip in semantic order', async () => {
    const manifest = await Bun.file(
      new URL('../packs/v4/pack.json', import.meta.url),
    ).json() as {
      assets: {
        actors: {
          players: { strips: Record<string, unknown> };
          enemies: { strips: Record<string, unknown> };
          bosses: { strips: Record<string, unknown> };
        };
      };
    };
    expect(Object.keys(manifest.assets.actors.players.strips)).toEqual(
      V4_PLAYER_ACTOR_NAMES.map((name) => `actor.player.${name}`),
    );
    expect(Object.keys(manifest.assets.actors.enemies.strips)).toEqual(
      V4_ENEMY_ACTOR_NAMES.map((name) => `actor.enemy.${name}`),
    );
    expect(Object.keys(manifest.assets.actors.bosses.strips)).toEqual(
      V4_BOSS_ACTOR_NAMES.map((name) => `actor.boss.${name}`),
    );
  });

  test('committed Boss sheet is a byte-exact rebuild of the isolation master', async () => {
    const committed = await Bun.file(SHEETS[2]!.url).bytes();
    const rebuilt = buildV4BossActorAtlasWithAudit();
    expect(Buffer.compare(Buffer.from(committed), Buffer.from(rebuilt.bytes))).toBe(0);
    expect(createHash('sha256').update(rebuilt.bytes).digest('hex')).toBe(
      V4_BOSS_ACTOR_ATLAS_SHA256,
    );
  });

  test('Boss compilation preserves thresholded foreground and one fixed anchor per identity', () => {
    const rebuilt = buildV4BossActorAtlasWithAudit();
    expect(rebuilt.sourceForegroundPixels).toBe(414_898);
    expect(rebuilt.assignedForegroundPixels).toBe(rebuilt.sourceForegroundPixels);
    expect(rebuilt.placements).toHaveLength(25);
    expect(
      rebuilt.placements.reduce((sum, placement) => sum + placement.sourcePixels, 0),
    ).toBe(rebuilt.sourceForegroundPixels);

    for (let row = 0; row < 5; row++) {
      const poses = rebuilt.placements.slice(row * 5, row * 5 + 5);
      const anchorXs = poses.map((pose) => pose.anchorX);
      const anchorYs = poses.map((pose) => pose.anchorY);
      expect(
        poses.map((pose) => [pose.anchorX, pose.anchorY]),
      ).toEqual(Array.from({ length: 5 }, () => [...V4_BOSS_RUNTIME_ANCHORS[row]!]));
      expect(
        Math.max(...anchorXs) - Math.min(...anchorXs),
        `Boss row ${row} x pivot`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.max(...anchorYs) - Math.min(...anchorYs),
        `Boss row ${row} y pivot`,
      ).toBeLessThanOrEqual(1);

      for (const pose of poses) {
        const frameX = pose.destX - pose.column * 192;
        const frameY = pose.destY - pose.row * 192;
        expect(frameX, `Boss pose ${pose.pose} left gutter`).toBeGreaterThanOrEqual(8);
        expect(frameY, `Boss pose ${pose.pose} top gutter`).toBeGreaterThanOrEqual(8);
        expect(
          frameX + pose.destW,
          `Boss pose ${pose.pose} right gutter`,
        ).toBeLessThanOrEqual(184);
        expect(
          frameY + pose.destH,
          `Boss pose ${pose.pose} bottom gutter`,
        ).toBeLessThanOrEqual(184);
      }
    }
  });

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

  test('every neutral player pose fits the character-select preview crop', async () => {
    const players = SHEETS[0]!;
    const image = decodePng(await Bun.file(players.url).bytes());
    const crop = V4_UI_SCREEN.character.actorSource;

    for (let row = 0; row < players.rows; row++) {
      const neutral = frameAlpha(image.rgba, image.width, players.frame, 2, row);
      expect(
        neutral.minX,
        `player row ${row} paints left of the preview crop`,
      ).toBeGreaterThanOrEqual(crop.x);
      expect(
        neutral.minY,
        `player row ${row} paints above the preview crop`,
      ).toBeGreaterThanOrEqual(crop.y);
      expect(neutral.maxX, `player row ${row} paints right of the preview crop`).toBeLessThan(
        crop.x + crop.w,
      );
      expect(neutral.maxY, `player row ${row} paints below the preview crop`).toBeLessThan(
        crop.y + crop.h,
      );
    }
  });
});
