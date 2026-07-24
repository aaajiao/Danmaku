/**
 * A player-facing replay document.
 *
 * `sim/replay.ts` remains the deterministic, one-Run format. A campaign creates
 * a fresh Run (and a fresh seed) for every stage, so the shell needs this thin
 * outer container to keep those independent recordings together without
 * changing Replay v1 or teaching the simulation that files and libraries exist.
 */

import {
  deserialize as deserializeReplay,
  type Replay,
} from '../sim/replay';

export const REPLAY_SESSION_KIND = 'danmaku-replay-session';
export const REPLAY_SESSION_VERSION = 1;

export interface ReplaySession {
  readonly kind: typeof REPLAY_SESSION_KIND;
  readonly version: typeof REPLAY_SESSION_VERSION;
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly segments: readonly Replay[];
}

export interface ReplaySessionIdentity {
  readonly id: string;
  readonly now: string;
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value === '') return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function validateIdentity(identity: ReplaySessionIdentity): void {
  if (identity.id.trim() === '') throw new Error('replay session: id must not be empty');
  if (!validTimestamp(identity.now)) {
    throw new Error(`replay session: invalid timestamp ${JSON.stringify(identity.now)}`);
  }
}

export function createReplaySession(
  identity: ReplaySessionIdentity,
  segments: readonly Replay[] = [],
): ReplaySession {
  validateIdentity(identity);
  return {
    kind: REPLAY_SESSION_KIND,
    version: REPLAY_SESSION_VERSION,
    id: identity.id,
    createdAt: identity.now,
    updatedAt: identity.now,
    segments: segments.map(copyReplay),
  };
}

export function appendReplay(
  session: ReplaySession,
  replay: Replay,
  updatedAt: string,
): ReplaySession {
  if (!validTimestamp(updatedAt)) {
    throw new Error(`replay session: invalid timestamp ${JSON.stringify(updatedAt)}`);
  }
  // A wall clock can be adjusted backwards while a campaign is in progress.
  // Preserve a monotonic session timestamp so sorting never moves a newly
  // appended recording behind its older snapshot.
  const monotonicUpdatedAt = updatedAt < session.updatedAt
    ? session.updatedAt
    : updatedAt;
  return {
    ...session,
    updatedAt: monotonicUpdatedAt,
    segments: [...session.segments.map(copyReplay), copyReplay(replay)],
  };
}

export function serializeReplaySession(session: ReplaySession): string {
  return JSON.stringify(session);
}

/**
 * Parse a session document and validate every nested Replay through the real
 * replay parser. A stored/imported wrapper is not allowed to weaken the inner
 * format's strict validation.
 */
export function deserializeReplaySession(text: string): ReplaySession {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`replay session: not valid JSON (${(error as Error).message})`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('replay session: expected a JSON object');
  }

  const raw = parsed as Record<string, unknown>;
  if (raw['kind'] !== REPLAY_SESSION_KIND) {
    throw new Error(`replay session: unsupported kind ${JSON.stringify(raw['kind'])}`);
  }
  if (raw['version'] !== REPLAY_SESSION_VERSION) {
    throw new Error(
      `replay session: version ${JSON.stringify(raw['version'])} is not supported `
      + `(expected ${REPLAY_SESSION_VERSION})`,
    );
  }

  const id = raw['id'];
  if (typeof id !== 'string' || id.trim() === '') {
    throw new Error('replay session: id must be a non-empty string');
  }
  const createdAt = raw['createdAt'];
  const updatedAt = raw['updatedAt'];
  if (!validTimestamp(createdAt)) {
    throw new Error(`replay session: invalid createdAt ${JSON.stringify(createdAt)}`);
  }
  if (!validTimestamp(updatedAt)) {
    throw new Error(`replay session: invalid updatedAt ${JSON.stringify(updatedAt)}`);
  }
  if (updatedAt < createdAt) {
    throw new Error('replay session: updatedAt must not precede createdAt');
  }

  const rawSegments = raw['segments'];
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
    throw new Error('replay session: segments must be a non-empty array');
  }
  const segments = rawSegments.map((segment, index) => {
    try {
      return deserializeReplay(JSON.stringify(segment));
    } catch (error) {
      throw new Error(`replay session: invalid segment ${index} (${(error as Error).message})`);
    }
  });

  return {
    kind: REPLAY_SESSION_KIND,
    version: REPLAY_SESSION_VERSION,
    id,
    createdAt,
    updatedAt,
    segments,
  };
}

/**
 * Accept both the new campaign wrapper and an existing bare Replay v1 file.
 * Bare recordings become a one-segment session with caller-supplied shell
 * identity; the deterministic payload itself is left untouched.
 */
export function deserializeReplayDocument(
  text: string,
  identity: ReplaySessionIdentity,
): ReplaySession {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Let the format-specific parser produce the useful syntax error below.
  }
  if (
    typeof parsed === 'object'
    && parsed !== null
    && !Array.isArray(parsed)
    && (parsed as Record<string, unknown>)['kind'] === REPLAY_SESSION_KIND
  ) {
    return deserializeReplaySession(text);
  }
  return createReplaySession(identity, [deserializeReplay(text)]);
}

function copyReplay(replay: Replay): Replay {
  return {
    version: replay.version,
    seed: replay.seed,
    length: replay.length,
    inputs: replay.inputs.map((entry) => ({ ...entry })),
    ...(replay.meta === undefined ? {} : { meta: { ...replay.meta } }),
  };
}
