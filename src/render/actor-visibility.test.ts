import { describe, expect, test } from 'bun:test';
import { decodePng } from '../../tools/png-decode';
import { V4_BOSS_ACTORS, V4_ENEMY_ACTORS } from './v4-actors';

function widestPaint(
  rgba: Uint8Array,
  sheetW: number,
  frameSize: number,
  startX: number,
  startY: number,
  frames: number,
): number {
  let widest = 0;
  for (let frame = 0; frame < frames; frame++) {
    let minX = frameSize;
    let maxX = -1;
    for (let y = 0; y < frameSize; y++) {
      for (let x = 0; x < frameSize; x++) {
        const alpha = rgba[((((startY + y) * sheetW) + startX + frame * frameSize + x) * 4) + 3]!;
        if (alpha === 0) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    }
    widest = Math.max(widest, maxX - minX + 1);
  }
  return widest;
}

describe('v4 actor contact visibility', () => {
  test('decoded enemy and boss paint covers every contact circle', async () => {
    const base = await Bun.file(new URL('../v4/content/campaign.json', import.meta.url)).json() as {
      content: {
        enemies: Record<string, { radius: number }>;
        bosses: Record<string, { radius: number }>;
      };
    };
    const enemyImage = decodePng(await Bun.file(new URL('../assets/v4/actors-enemies-v4.png', import.meta.url)).bytes());
    const bossImage = decodePng(await Bun.file(new URL('../assets/v4/actors-bosses-v4.png', import.meta.url)).bytes());

    Object.entries(V4_ENEMY_ACTORS).forEach(([name, actor], index) => {
      const sourceW = widestPaint(
        enemyImage.rgba,
        enemyImage.width,
        128,
        (index % 2) * 512,
        Math.floor(index / 2) * 128,
        4,
      );
      const visibleW = sourceW * actor.size / 128;
      expect(visibleW + 1e-9, name).toBeGreaterThanOrEqual(base.content.enemies[name]!.radius * 2);
    });

    Object.entries(V4_BOSS_ACTORS).forEach(([name, actor], index) => {
      const sourceW = widestPaint(bossImage.rgba, bossImage.width, 192, 0, index * 192, 5);
      const visibleW = sourceW * actor.size / 192;
      expect(visibleW + 1e-9, name).toBeGreaterThanOrEqual(base.content.bosses[name]!.radius * 2);
    });
  });
});
