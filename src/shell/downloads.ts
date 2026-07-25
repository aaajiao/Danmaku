import type { ReplayExportState } from '../game/states';
import {
  serializeReplaySession,
  type ReplaySession,
} from '../replay/session';

export function downloadBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(href);
  }, 0);
}

export function replayFilename(session: ReplaySession): string {
  const stamp = session.createdAt
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace('.000', '');
  return `danmaku-replay-${stamp}.json`;
}

export function videoFilename(
  exporting: ReplayExportState,
  extension: 'webm' | 'mp4',
): string {
  const stamp = exporting.session.createdAt
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace('.000', '');
  const stage = exporting.replay.meta?.['stage'];
  const safeStage = (
    typeof stage === 'string'
      ? stage
      : `stage-${exporting.segmentIndex + 1}`
  )
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'stage';
  return `danmaku-video-${stamp}-${safeStage}.${extension}`;
}

export function downloadReplayFile(session: ReplaySession): void {
  downloadBlob(
    new Blob([serializeReplaySession(session)], { type: 'application/json' }),
    replayFilename(session),
  );
}
