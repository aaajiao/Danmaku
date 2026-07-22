import { describe, expect, test } from 'bun:test';
import {
  V4_UI_ATLAS_HEIGHT,
  V4_UI_ATLAS_WIDTH,
  V4_UI_CELLS,
  V4_UI_PANEL_CORNER,
  V4_UI_SCREEN,
} from '../src/render/v4-ui-layout';
import {
  generateV4UiAtlas,
  V4_UI_ORNAMENT_SOURCE,
  V4_UI_ORNAMENTS,
} from './make-v4-ui';
import { decodePng } from './png-decode';

const file = new URL('../src/assets/v4/ui-v4.png', import.meta.url);

const PRODUCTION_CELLS = {
  'ui.dialogue.frame': { x: 0, y: 256, w: 456, h: 164 },
  'ui.character.frame': { x: 456, y: 256, w: 170, h: 300 },
  'ui.status.frame': { x: 724, y: 256, w: 300, h: 436 },
  'ui.title.masthead': { x: 0, y: 420, w: 400, h: 96 },
  'ui.boss.ornament': { x: 0, y: 516, w: 440, h: 72 },
  'ui.menu.row': { x: 0, y: 588, w: 300, h: 50 },
} as const;
const PRODUCTION_CELL_NAMES = Object.keys(PRODUCTION_CELLS) as Array<keyof typeof PRODUCTION_CELLS>;

describe('v4 engine-owned UI atlas', () => {
  test('matches the fixed 480×640 overlay contract and every entry has paint', async () => {
    const png = decodePng(await Bun.file(file).bytes());
    expect(png.width).toBe(V4_UI_ATLAS_WIDTH);
    expect(png.height).toBe(V4_UI_ATLAS_HEIGHT);

    for (const [name, cell] of Object.entries(V4_UI_CELLS)) {
      expect(cell.x).toBeGreaterThanOrEqual(0);
      expect(cell.y).toBeGreaterThanOrEqual(0);
      expect(cell.x + cell.frameW * cell.frames).toBeLessThanOrEqual(png.width);
      expect(cell.y + cell.frameH).toBeLessThanOrEqual(png.height);
      expect(cell.displayW).toBeGreaterThan(0);
      expect(cell.displayH).toBeGreaterThan(0);

      for (let frame = 0; frame < cell.frames; frame++) {
        let painted = 0;
        for (let y = 0; y < cell.frameH; y++) {
          for (let x = 0; x < cell.frameW; x++) {
            const px = cell.x + frame * cell.frameW + x;
            const py = cell.y + y;
            if (png.rgba[(py * png.width + px) * 4 + 3]! > 0) painted++;
          }
        }
        expect(painted, `${name} frame ${frame} is empty`).toBeGreaterThan(3);
      }
    }
  });

  test('retains the 32-cell procedural vocabulary and adds six production ornaments', () => {
    expect(Object.keys(V4_UI_CELLS)).toHaveLength(38);
    expect(V4_UI_ORNAMENTS.map(({ name }) => name).sort()).toEqual([...PRODUCTION_CELL_NAMES].sort());

    for (const name of PRODUCTION_CELL_NAMES) {
      const expected = PRODUCTION_CELLS[name];
      const cell = V4_UI_CELLS[name];
      expect(cell).toEqual({
        x: expected.x,
        y: expected.y,
        frameW: expected.w,
        frameH: expected.h,
        frames: 1,
        displayW: expected.w,
        displayH: expected.h,
      });
    }
  });

  test('uses the committed masters and deterministically reproduces the atlas', async () => {
    const source = await Bun.file(V4_UI_ORNAMENT_SOURCE).bytes();
    expect(new Bun.CryptoHasher('sha256').update(source).digest('hex')).toBe(
      '7bbe7b2478b62d37b7c6b34c1c6099c5bf31f8248d5bfdffc22e4f00a2174d5a',
    );
    const generated = generateV4UiAtlas(source);
    const committed = await Bun.file(file).bytes();
    expect(generated).toEqual(committed);
  });

  test('keeps the original 256-row procedural atlas pixel-exact', async () => {
    const png = decodePng(await Bun.file(file).bytes());
    const originalRows = png.rgba.slice(0, V4_UI_ATLAS_WIDTH * 256 * 4);
    expect(new Bun.CryptoHasher('sha256').update(originalRows).digest('hex')).toBe(
      '65447c632c0116ec8139ceb106cb0cde8a80a14d9882d408a064b7cb3cba8bda',
    );
  });

  test('production ornaments have transparent mattes, antialias coverage and no green flood', async () => {
    const png = decodePng(await Bun.file(file).bytes());
    for (const name of PRODUCTION_CELL_NAMES) {
      const cell = V4_UI_CELLS[name];
      let transparent = 0;
      let partial = 0;
      let painted = 0;
      let keyGreen = 0;
      for (let y = 0; y < cell.frameH; y++) {
        for (let x = 0; x < cell.frameW; x++) {
          const at = ((cell.y + y) * png.width + cell.x + x) * 4;
          const alpha = png.rgba[at + 3]!;
          if (alpha === 0) {
            transparent++;
            continue;
          }
          painted++;
          if (alpha < 255) partial++;
          const red = png.rgba[at]!;
          const green = png.rgba[at + 1]!;
          const blue = png.rgba[at + 2]!;
          if (green > red + 24 && green > blue + 24) keyGreen++;
        }
      }
      expect(transparent, `${name} has no transparent field`).toBeGreaterThan(100);
      expect(partial, `${name} lost its antialiased matte`).toBeGreaterThan(100);
      expect(keyGreen / painted, `${name} retained the green screen`).toBeLessThan(0.001);
    }
  });

  test('named source rectangles do not overlap', () => {
    const cells = Object.entries(V4_UI_CELLS);
    for (let i = 0; i < cells.length; i++) {
      const [aName, a] = cells[i]!;
      for (let j = i + 1; j < cells.length; j++) {
        const [bName, b] = cells[j]!;
        const overlaps =
          a.x < b.x + b.frameW * b.frames &&
          a.x + a.frameW * a.frames > b.x &&
          a.y < b.y + b.frameH &&
          a.y + a.frameH > b.y;
        expect(overlaps, `${aName} overlaps ${bName}`).toBe(false);
      }
    }
  });

  test('the scalable panel preserves practical one-pixel corners', () => {
    const panel = V4_UI_CELLS['ui.panel.9slice'];
    expect(V4_UI_PANEL_CORNER).toBe(12);
    expect(panel.frameW).toBe(48);
    expect(panel.frameH).toBe(48);
    expect(panel.frameW - V4_UI_PANEL_CORNER * 2).toBeGreaterThan(0);
    expect(panel.frameH - V4_UI_PANEL_CORNER * 2).toBeGreaterThan(0);
  });

  test('the character-select composition crops padding and keeps the enlarged actor inside its card', () => {
    const { frame, actorSource, actor, crest, menu, copy } = V4_UI_SCREEN.character;
    expect(frame).toEqual({ x: 45, y: 104, w: 170, h: 300 });
    expect(actorSource).toEqual({ x: 24, y: 4, w: 80, h: 120 });
    expect(actorSource.x + actorSource.w).toBeLessThanOrEqual(128);
    expect(actorSource.y + actorSource.h).toBeLessThanOrEqual(128);
    expect(actor.x).toBeGreaterThanOrEqual(frame.x);
    expect(actor.y).toBeGreaterThanOrEqual(frame.y);
    expect(actor.x + actor.w).toBeLessThanOrEqual(frame.x + frame.w);
    expect(actor.y + actor.h).toBeLessThanOrEqual(frame.y + frame.h);
    expect(actor).toEqual({ x: 50, y: 134, w: 160, h: 240 });
    expect(actor.w / actorSource.w).toBe(2);
    expect(actor.h / actorSource.h).toBe(2);
    expect(actor.h / frame.h).toBe(0.8);
    expect(crest.x + crest.w / 2).toBe(frame.x + frame.w / 2);
    expect(menu.x).toBeGreaterThan(frame.x + frame.w);
    expect(copy.x - copy.w / 2).toBeGreaterThanOrEqual(menu.x);
  });

  test('animated graze feedback is a four-frame fixed-size strip', () => {
    const graze = V4_UI_CELLS['ui.graze.arc'];
    expect(graze.frames).toBe(4);
    expect(graze.frameW).toBe(32);
    expect(graze.frameH).toBe(32);
    expect(graze.displayW).toBe(32);
    expect(graze.displayH).toBe(32);
  });
});
