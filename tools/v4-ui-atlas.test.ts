import { describe, expect, test } from 'bun:test';
import {
  V4_UI_ATLAS_HEIGHT,
  V4_UI_ATLAS_WIDTH,
  V4_UI_CELLS,
  V4_UI_PANEL_CORNER,
} from '../src/render/v4-ui-layout';
import { decodePng } from './png-decode';

const file = new URL('../src/assets/v4/ui-v4.png', import.meta.url);

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

  test('animated graze feedback is a four-frame fixed-size strip', () => {
    const graze = V4_UI_CELLS['ui.graze.arc'];
    expect(graze.frames).toBe(4);
    expect(graze.frameW).toBe(32);
    expect(graze.frameH).toBe(32);
    expect(graze.displayW).toBe(32);
    expect(graze.displayH).toBe(32);
  });
});
