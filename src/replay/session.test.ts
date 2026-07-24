import { describe, expect, test } from 'bun:test';

import type { Replay } from '../sim/replay';
import {
  appendReplay,
  createReplaySession,
  deserializeReplayDocument,
  deserializeReplaySession,
  REPLAY_SESSION_KIND,
  serializeReplaySession,
} from './session';

const FIRST: Replay = {
  version: 1,
  seed: 17,
  length: 4,
  inputs: [{ tick: 1, buttons: 16 }],
  meta: { character: 'scout', stage: 'stage-1' },
};

const SECOND: Replay = {
  version: 1,
  seed: 23,
  length: 2,
  inputs: [],
  meta: { character: 'scout', stage: 'stage-2' },
};

const IDENTITY = { id: 'session-1', now: '2026-07-24T10:20:30.000Z' };

describe('ReplaySession', () => {
  test('wraps independent stage replays without changing their payload', () => {
    const initial = createReplaySession(IDENTITY, [FIRST]);
    const session = appendReplay(initial, SECOND, '2026-07-24T10:30:00.000Z');

    expect(session.kind).toBe(REPLAY_SESSION_KIND);
    expect(session.segments).toEqual([FIRST, SECOND]);
    expect(session.createdAt).toBe(IDENTITY.now);
    expect(session.updatedAt).toBe('2026-07-24T10:30:00.000Z');
  });

  test('round-trips through strict nested replay validation', () => {
    const session = appendReplay(
      createReplaySession(IDENTITY, [FIRST]),
      SECOND,
      '2026-07-24T10:30:00.000Z',
    );
    expect(deserializeReplaySession(serializeReplaySession(session))).toEqual(session);
  });

  test('accepts a legacy bare replay as a one-segment session', () => {
    const session = deserializeReplayDocument(JSON.stringify(FIRST), IDENTITY);
    expect(session.id).toBe(IDENTITY.id);
    expect(session.segments).toEqual([FIRST]);
  });

  test('refuses an invalid replay nested inside a valid-looking wrapper', () => {
    const session = createReplaySession(IDENTITY, [FIRST]);
    const raw = JSON.parse(serializeReplaySession(session)) as Record<string, unknown>;
    raw['segments'] = [{ ...FIRST, inputs: [{ tick: 99, buttons: 1 }] }];
    expect(() => deserializeReplaySession(JSON.stringify(raw))).toThrow(/segment 0.*past the run length/);
  });

  test('refuses an imported session with no playable segments', () => {
    const empty = createReplaySession(IDENTITY);
    expect(() => deserializeReplaySession(serializeReplaySession(empty))).toThrow(
      /segments must be a non-empty array/,
    );
  });

  test('requires canonical UTC timestamps in chronological order', () => {
    const session = createReplaySession(IDENTITY, [FIRST]);
    const nonCanonical = {
      ...session,
      createdAt: '2026-07-24T12:20:30+02:00',
    };
    expect(() => deserializeReplaySession(JSON.stringify(nonCanonical))).toThrow(
      /invalid createdAt/,
    );
    const backwards = {
      ...session,
      createdAt: '2026-07-24T10:20:30.000Z',
      updatedAt: '2026-07-24T10:19:30.000Z',
    };
    expect(() => deserializeReplaySession(JSON.stringify(backwards))).toThrow(
      /updatedAt must not precede createdAt/,
    );
  });

  test('a backwards local clock cannot move an appended session backwards', () => {
    const session = createReplaySession(IDENTITY, [FIRST]);
    const appended = appendReplay(
      session,
      SECOND,
      '2026-07-24T10:19:30.000Z',
    );
    expect(appended.updatedAt).toBe(IDENTITY.now);
  });

  test('copies replay inputs so callers cannot mutate a saved session', () => {
    const input = { tick: 1, buttons: 16 };
    const replay: Replay = { ...FIRST, inputs: [input] };
    const session = createReplaySession(IDENTITY, [replay]);
    input.buttons = 0;
    expect(session.segments[0]?.inputs[0]?.buttons).toBe(16);
  });
});
