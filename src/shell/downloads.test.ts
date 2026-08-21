import { describe, expect, test } from 'bun:test';

import type { ReplayExportState, ReplaySessionKind } from '../game/states';
import { createReplaySession } from '../replay/session';
import type { Replay } from '../sim/replay';
import { videoFilename } from './downloads';

const REPLAY: Replay = {
  version: 1,
  seed: 17,
  length: 4,
  inputs: [],
  meta: { stage: 'stage-1' },
};

const SESSION = createReplaySession(
  { id: 'download-test', now: '2026-07-24T10:20:30.000Z' },
  [REPLAY],
);

function exporting(
  sessionWide: boolean,
  sessionKind?: ReplaySessionKind,
): ReplayExportState {
  return {
    session: SESSION,
    replay: REPLAY,
    segmentIndex: 0,
    sessionWide,
    sessionKind,
  } as unknown as ReplayExportState;
}

describe('videoFilename', () => {
  test('keeps the historical stage-scoped name for one-segment export', () => {
    expect(videoFilename(exporting(false), 'webm')).toBe(
      'danmaku-video-20260724T102030Z-stage-1.webm',
    );
  });

  test('names a complete session as one campaign file', () => {
    expect(videoFilename(exporting(true, 'full-campaign'), 'mp4')).toBe(
      'danmaku-campaign-20260724T102030Z.mp4',
    );
  });

  test('never labels a partial session as a complete campaign', () => {
    expect(videoFilename(exporting(true, 'recorded-attempt'), 'webm')).toBe(
      'danmaku-attempt-20260724T102030Z.webm',
    );
  });
});
