import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  extendHorizontalEdges,
  frameClearsPadding,
  orientedFrameSize,
  stripEnd,
} from './import-bulletpack';

interface RawStrip {
  src: string;
  strip?: number;
  mode?: string;
  ticksPerFrame?: number;
  crop?: unknown;
}
interface RawMap {
  floor: Record<string, RawStrip>;
  variants: Record<string, RawStrip>;
  shots: Record<string, RawStrip>;
  effects: Record<string, RawStrip>;
  lasers: Record<string, RawStrip>;
  player: { ship: RawStrip; effects: Record<string, RawStrip & { allowEmpty?: boolean }> };
  variantsDuplicate: Record<string, unknown>;
}

const map = JSON.parse(
  readFileSync(join(import.meta.dir, 'bulletpack-map.json'), 'utf8'),
) as RawMap;

const enemy = (name: string): string => `Bullet Pack/Bullet Pack/${name}`;
const player = (name: string): string => `Bullet Pack/Player Bullets/${name}`;

const EXPECTED_SOURCE_FRAMES = new Map<string, number>();
const expectFrames = (frames: number, names: string[], path = enemy): void => {
  for (const name of names) EXPECTED_SOURCE_FRAMES.set(path(name), frames);
};

expectFrames(3, [
  'Bullet_tiny_green.png', 'Green_msh.png', 'medium_flamy.png',
  'Pink_msh.png', 'Tiny_Pink.png', 'Tr.png',
]);
expectFrames(4, [
  'Big_Purple.png', 'Gradius_Alt.png', 'Lines_purple.png',
  'Lines_purple_squary.png', 'Lines_Thicker_Green.png',
  'Lines_tiny_Bermuda.png', 'Lines_tiny_Green.png', 'Lines_yellow.png',
  'Medium_Big_Yellow_Red.png', 'Medium_gradius.png', 'Medium_Gradius2.png',
  'Rings.png', 'Tiny_Bullet_CianBermuda_strip4.png', 'Tiny_Gradius.png',
  'Tiny_purple.png',
]);
expectFrames(5, [
  'Bermuda_Medium.png', 'Big_Blue_Cian.png', 'Medium_Blue_Cian.png',
  'Medium_purple_blue_Oval.png', 'Medium_tiny_Pink_Yellow.png',
  'Medium_tiny_Yellow_Red.png', 'Pink_medium.png',
  'Tiny_Orange_Yellow_magenta.png', 'Tiny_Yellow_Cian.png',
]);
expectFrames(6, [
  'Big_Yellow_Cian.png', 'Big_Yellow_Orange_Red.png', 'Green_line_alt.png',
  'Lines_ovaly_Yellow_Orange.png', 'Massive_purple_yellow.png',
  'Massive_Red_Orange_Yellow.png', 'Medium_tiny_Yell_Orng_Magenta.png',
  'Tiny_Blue_cian.png',
]);
expectFrames(7, [
  'Bullet_Spiky_Bulky_strip7.png', 'Bullet_Spiky_Thinier_strip7.png',
  'Pink_Medium_Big.png',
]);
expectFrames(8, [
  'Medium_tiny_Pink_Puple_Yellow.png', 'Medium_tiny_Yellow_Purple.png',
]);
expectFrames(9, ['Medium_lava.png']);
expectFrames(18, ['Medium_Pink_Purple.png']);

expectFrames(1, ['P1_Bullet_Pink.png'], player);
expectFrames(2, [
  'New_P1Bullet_Cian_lvl0_strip2.png', 'New_P1Bullet_Cian_lvl1_strip2.png',
  'New_P1Bullet_Cian_lvl2_strip2.png',
  'New_P1Bullet_Pink_lvl0_strip2-sheet.png',
  'New_P1Bullet_Pink_lvl1_strip2-sheet.png',
  'New_P1Bullet_Pink_lvl2_strip2-sheet.png',
  'P1 Bullet Stream.png', 'P1_Bullet_Alt2.png', 'P1_Hyper_Bullet.png',
  'p1_Bullet_Alt.png',
], player);
expectFrames(3, [
  'P1 Bullet _Thinier_BermudaGreen.png', 'P1 Bullet_BermudaGreen.png',
  'P1 Bullet_Yellow.png', 'P1 Bullet_Yellow_Thinier.png',
], player);
expectFrames(5, ['P1_Bullet_Hit.png'], player);

describe('BulletPack source-cell contract', () => {
  test('all 61 unique enemy/player sources preserve their audited frame counts', () => {
    const actual = new Map<string, number>();
    const sections = [map.floor, map.variants, map.shots];
    let names = 0;
    for (const section of sections) {
      for (const [name, strip] of Object.entries(section)) {
        if (name.startsWith('$')) continue;
        names++;
        expect(strip.crop).toBeUndefined();
        expect(Number.isInteger(strip.strip)).toBe(true);
        expect(strip.strip).toBeGreaterThanOrEqual(1);
        expect(strip.mode).toBe('loop');
        const previous = actual.get(strip.src);
        if (previous !== undefined) expect(strip.strip).toBe(previous);
        actual.set(strip.src, strip.strip!);
      }
    }

    // 64 original bindings + six fired names that used to fall through to the
    // white+tint floor. The aliases reuse full audited rows, so unique sources
    // remain 61 while all four stages now stay on baked BulletPack colour.
    expect(names).toBe(70);
    expect(actual.size).toBe(61);
    expect(actual).toEqual(EXPECTED_SOURCE_FRAMES);
    expect(map.variantsDuplicate['Bullet Pack/Bullet Pack/Bermuda_Medium copy.png'])
      .toEqual({
        of: 'Bullet Pack/Bullet Pack/Bermuda_Medium.png',
        representedBy: 'orb.medium.bulwark',
      });
  });

  test('laser suffixes that count half-cell spacing keep complete logical cells', () => {
    expect(map.lasers['beam.heavy']?.strip).toBe(6);
    expect(map.lasers['beam.cyan']?.strip).toBe(5);
  });

  test('the 14-frame burst finishes inside its 24-tick effect life', () => {
    expect(map.effects.burst).toMatchObject({ strip: 14, mode: 'once' });
    expect(map.effects.burst?.ticksPerFrame).toBeUndefined(); // importer default: 1
  });

  test('all ten Player Ship PNGs have live strip consumers', () => {
    const entries = [map.player.ship, ...Object.values(map.player.effects)];
    expect(entries).toHaveLength(10);
    expect(new Set(entries.map((s) => s.src)).size).toBe(10);
    expect(map.player.ship).toMatchObject({ strip: 5, mode: 'loop' });
    expect(map.player.effects['player.option']).toMatchObject({ strip: 4, mode: 'loop' });
    expect(map.player.effects['player.bomb.field']).toMatchObject({ strip: 41, mode: 'once' });
    expect(map.player.effects['player.thruster.up']?.allowEmpty).toBe(true);
    expect(map.player.effects['player.thruster.cruise']?.allowEmpty).toBe(true);
  });
});

describe('shared category atlas geometry', () => {
  test('rectangular padding is enforced independently on X and Y', () => {
    expect(frameClearsPadding(20, 6, 24, 10, 2)).toBe(true);
    // This passed the retired max(ex,ey) <= frameW-2*pad check, but violates Y.
    expect(frameClearsPadding(20, 7, 24, 10, 2)).toBe(false);
    expect(frameClearsPadding(21, 6, 24, 10, 2)).toBe(false);
  });

  test('last-frame bound uses (frames-1)*stride + frameW', () => {
    expect(stripEnd(5, 7, 3, 12, 8, 10)).toEqual({ right: 37, bottom: 17 });
  });

  test('laser bodies fill +x while retaining the ordinary cross-axis margin', () => {
    expect(orientedFrameSize(25, 20, true)).toEqual({ frameW: 25, frameH: 26 });
    expect(orientedFrameSize(25, 20, false)).toEqual({ frameW: 31, frameH: 26 });
    expect(frameClearsPadding(25, 20, 25, 26, 2, true)).toBe(true);
    expect(frameClearsPadding(24, 20, 25, 26, 2, true)).toBe(false);
    expect(frameClearsPadding(25, 23, 25, 26, 2, true)).toBe(false);
  });

  test('a tile frame extends its painted scanline to both longitudinal edges', () => {
    const rgba = new Uint8Array(5 * 2 * 4);
    const put = (x: number, y: number, r: number): void => {
      const i = (y * 5 + x) * 4;
      rgba[i] = r;
      rgba[i + 3] = 255;
    };
    put(2, 0, 80);
    put(3, 0, 160);

    const out = extendHorizontalEdges({ w: 5, h: 2, rgba });
    expect([0, 1, 2, 3, 4].map((x) => out.rgba[x * 4])).toEqual([80, 80, 80, 160, 160]);
    // A transparent cross-axis row remains transparent; only +x is extended.
    expect([...out.rgba.slice(5 * 4)].every((v) => v === 0)).toBe(true);
  });
});
