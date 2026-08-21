import { describe, expect, test } from 'bun:test';
import { v4MenuRowGeometry } from '../render/v4-ui-layout';
import {
  REPLAY_UI_LAYOUT,
  replayMenuScope,
  replayMenuWindow,
  replayStageScale,
  replayTouchStageSlot,
} from './replay-ui-layout';

describe('Replay authored layout', () => {
  test('bounds summary copy above the first menu row', () => {
    const summaryBottom = REPLAY_UI_LAYOUT.summaryBaseline
      + (REPLAY_UI_LAYOUT.summaryRows - 1) * REPLAY_UI_LAYOUT.summaryLineHeight;
    const firstRow = v4MenuRowGeometry(
      REPLAY_UI_LAYOUT.menuFirstBaseline,
      REPLAY_UI_LAYOUT.menuStep,
    );
    expect(summaryBottom).toBeLessThan(firstRow.top);
  });

  test('windows every saved Replay plus IMPORT and BACK around selection', () => {
    const count = 14;
    expect(replayMenuWindow(count, 0)).toEqual({
      first: 0,
      visibleCount: 8,
      selected: 0,
    });
    expect(replayMenuWindow(count, 12)).toEqual({
      first: 6,
      visibleCount: 8,
      selected: 6,
    });
    expect(replayMenuWindow(count, 13)).toEqual({
      first: 6,
      visibleCount: 8,
      selected: 7,
    });
  });

  test('gives Replay session, stages, and stage detail distinct DOM scopes', () => {
    expect(new Set([
      replayMenuScope('replay-session', 'REPLAY SESSION'),
      replayMenuScope('replay-session', 'STAGES'),
      replayMenuScope('replay-session', 'STAGE 1'),
    ]).size).toBe(3);
    expect(replayMenuScope('replay-session', 'STAGES', 'stages 1–5 of 12')).not.toBe(
      replayMenuScope('replay-session', 'STAGES', 'stages 6–10 of 12'),
    );
  });

  test('retains a legible row in the real touch-enabled small stage slots', () => {
    const portraitSlot = replayTouchStageSlot(320, 568);
    const landscapeSlot = replayTouchStageSlot(568, 320);
    expect(portraitSlot).toEqual({ width: 320, height: 394 });
    expect(landscapeSlot.width).toBeCloseTo(318.08, 2);
    expect(landscapeSlot.height).toBe(320);
    const portraitScale = replayStageScale(portraitSlot.width, portraitSlot.height);
    const landscapeScale = replayStageScale(landscapeSlot.width, landscapeSlot.height);
    expect(REPLAY_UI_LAYOUT.menuFontSize * portraitScale).toBeGreaterThanOrEqual(9);
    expect(REPLAY_UI_LAYOUT.menuFontSize * landscapeScale).toBeGreaterThanOrEqual(7);
    expect(REPLAY_UI_LAYOUT.menuWidth * landscapeScale).toBeGreaterThanOrEqual(176);
  });
});
