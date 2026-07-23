import { describe, expect, test } from 'bun:test';
import type { Region } from './atlas';
import { v4CharacterActorSource } from './v4-ui-layout';

describe('v4 character-select actor crop', () => {
  test('preserves the accepted 128px crop exactly at an offset atlas frame', () => {
    expect(v4CharacterActorSource({ x: 640, y: 256, w: 128, h: 128 })).toEqual({
      x: 664,
      y: 260,
      w: 80,
      h: 120,
    });
  });

  test('normalises the crop for smaller and supersampled pack frames', () => {
    expect(v4CharacterActorSource({ x: 128, y: 64, w: 64, h: 64 })).toEqual({
      x: 140,
      y: 66,
      w: 40,
      h: 60,
    });
    expect(v4CharacterActorSource({ x: 512, y: 192, w: 256, h: 192 })).toEqual({
      x: 560,
      y: 198,
      w: 160,
      h: 180,
    });
  });

  test('never samples outside even the smallest legal self-described frame', () => {
    const frames: Region[] = [
      { x: 0, y: 0, w: 1, h: 1 },
      { x: 7, y: 11, w: 3, h: 5 },
      { x: 320, y: 256, w: 63, h: 91 },
      { x: 1024, y: 512, w: 257, h: 193 },
    ];

    for (const frame of frames) {
      const source = v4CharacterActorSource(frame);
      expect(source.w, `${frame.w}×${frame.h} crop width`).toBeGreaterThanOrEqual(1);
      expect(source.h, `${frame.w}×${frame.h} crop height`).toBeGreaterThanOrEqual(1);
      expect(source.x, `${frame.w}×${frame.h} crop left`).toBeGreaterThanOrEqual(frame.x);
      expect(source.y, `${frame.w}×${frame.h} crop top`).toBeGreaterThanOrEqual(frame.y);
      expect(source.x + source.w, `${frame.w}×${frame.h} crop right`).toBeLessThanOrEqual(
        frame.x + frame.w,
      );
      expect(source.y + source.h, `${frame.w}×${frame.h} crop bottom`).toBeLessThanOrEqual(
        frame.y + frame.h,
      );
    }
  });
});
