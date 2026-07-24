import { describe, expect, test } from 'bun:test';

import { FrameCapture, isScreenshotShortcut, screenshotFilename } from './capture';

describe('capture shell helpers', () => {
  test('uses plain C without stealing browser shortcuts or key repeat', () => {
    const plain = { code: 'KeyC', repeat: false, altKey: false, ctrlKey: false, metaKey: false };
    expect(isScreenshotShortcut(plain)).toBe(true);
    expect(isScreenshotShortcut({ ...plain, repeat: true })).toBe(false);
    expect(isScreenshotShortcut({ ...plain, ctrlKey: true })).toBe(false);
    expect(isScreenshotShortcut({ ...plain, metaKey: true })).toBe(false);
    expect(isScreenshotShortcut({ ...plain, code: 'KeyR' })).toBe(false);
  });

  test('builds stable UTC filenames from run identity', () => {
    expect(screenshotFilename(
      new Date('2026-07-24T10:20:30.000Z'),
      { stage: 'demo/stage 1', difficulty: 'Lunatic', tick: 4321 },
    )).toBe('danmaku-20260724T102030Z-demo-stage-1-lunatic-tick-004321.png');
  });

  test('composes the WebGL field before the transparent HUD layer', () => {
    const calls: unknown[][] = [];
    const surface = {
      imageSmoothingEnabled: true,
      clearRect: (...args: unknown[]) => calls.push(['clear', ...args]),
      drawImage: (...args: unknown[]) => calls.push(['draw', ...args]),
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 480,
      height: 640,
      getContext: () => surface,
    } as unknown as HTMLCanvasElement;
    const field = { id: 'field' } as unknown as HTMLCanvasElement;
    const overlay = { id: 'overlay' } as unknown as HTMLCanvasElement;

    new FrameCapture(canvas).compose(field, overlay);

    expect(calls).toEqual([
      ['clear', 0, 0, 480, 640],
      ['draw', field, 0, 0, 480, 640],
      ['draw', overlay, 0, 0, 480, 640],
    ]);
  });
});
