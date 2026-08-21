import type { ReplayExportState } from '../game/states';
import {
  serializeReplaySession,
  type ReplaySession,
} from '../replay/session';

/** Keep disk-backed Blob URLs alive long enough for the browser to consume them. */
export const DOWNLOAD_BLOB_URL_LIFETIME_MS = 60_000;

export function downloadBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(href);
  }, DOWNLOAD_BLOB_URL_LIFETIME_MS);
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
  if (exporting.sessionWide) {
    const scope = exporting.sessionKind === 'full-campaign' ? 'campaign' : 'attempt';
    return `danmaku-${scope}-${stamp}.${extension}`;
  }
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
