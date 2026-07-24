import { describe, expect, test } from 'bun:test';

import type { Replay } from '../sim/replay';
import {
  MemoryReplaySessionStore,
  ReplayLibrary,
  loadReplayLibraryWithFallback,
  ReplaySessionPersistenceError,
  type ReplaySessionStore,
} from './library';
import { serializeReplaySession } from './session';

const REPLAY: Replay = {
  version: 1,
  seed: 5,
  length: 3,
  inputs: [{ tick: 0, buttons: 16 }],
  meta: { stage: 'stage-1', character: 'scout' },
};

function library(store: ReplaySessionStore = new MemoryReplaySessionStore()): ReplayLibrary {
  let id = 0;
  let minute = 0;
  return new ReplayLibrary(store, {
    id: () => `session-${++id}`,
    now: () => `2026-07-24T10:${String(minute++).padStart(2, '0')}:00.000Z`,
  });
}

describe('ReplayLibrary', () => {
  test('appends stage recordings to one session and persists them', async () => {
    const store = new MemoryReplaySessionStore();
    const first = library(store);
    const id = first.begin();
    await first.append(id, REPLAY);
    await first.append(id, { ...REPLAY, seed: 6, meta: { ...REPLAY.meta, stage: 'stage-2' } });

    const second = library(store);
    await second.load();
    expect(second.sessions).toHaveLength(1);
    expect(second.sessions[0]?.segments.map((segment) => segment.seed)).toEqual([5, 6]);
  });

  test('updates the in-memory library before slow storage finishes', async () => {
    let release: (() => void) | undefined;
    const store = {
      load: async () => [],
      put: () => new Promise<void>((resolve) => {
        release = resolve;
      }),
    };
    const replays = library(store);
    const pending = replays.append(replays.begin(), REPLAY);
    expect(replays.sessions[0]?.segments).toHaveLength(1);
    // The serialized write queue enters the store on its next microtask.
    await Promise.resolve();
    expect(release).toBeDefined();
    release?.();
    await pending;
  });

  test('imports bare replay files and wrapped sessions', async () => {
    const replays = library();
    const bare = await replays.import(JSON.stringify(REPLAY));
    const wrapped = await replays.import(serializeReplaySession(bare));
    expect(replays.sessions).toHaveLength(2);
    expect(wrapped.id).not.toBe(bare.id);
    expect(wrapped.segments).toEqual([REPLAY]);
  });

  test('sorts most recently updated sessions first', async () => {
    const replays = library();
    const first = replays.begin();
    const second = replays.begin();
    await replays.append(first, REPLAY);
    await replays.append(second, { ...REPLAY, seed: 7 });
    expect(replays.sessions.map((session) => session.id)).toEqual([second, first]);
  });

  test('serializes overlapping snapshots so an older write cannot land last', async () => {
    const writes: number[] = [];
    let releaseFirst: (() => void) | undefined;
    const store: ReplaySessionStore = {
      load: async () => [],
      put: async (session) => {
        writes.push(session.segments.length);
        if (session.segments.length === 1) {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
        }
      },
    };
    const replays = library(store);
    const id = replays.begin();
    const first = replays.append(id, REPLAY);
    await Promise.resolve();
    const second = replays.append(id, { ...REPLAY, seed: 8 });
    await Promise.resolve();

    expect(writes).toEqual([1]);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(writes).toEqual([1, 2]);
  });

  test('a hung persistent load degrades to memory within its deadline', async () => {
    let closed = false;
    const hanging: ReplaySessionStore = {
      load: () => new Promise(() => {}),
      put: async () => {},
      close: () => {
        closed = true;
      },
    };
    const loaded = await loadReplayLibraryWithFallback(
      hanging,
      new MemoryReplaySessionStore(),
      1,
    );
    expect(loaded.degraded).toBe(true);
    expect(loaded.error).toBeInstanceOf(Error);
    expect(closed).toBe(true);
    expect(loaded.library.sessions).toEqual([]);
  });

  test('a failed import write remains visible and later writes recover', async () => {
    let writes = 0;
    const store: ReplaySessionStore = {
      load: async () => [],
      put: async () => {
        writes++;
        if (writes === 1) throw new Error('quota');
      },
    };
    const replays = library(store);
    let failure: ReplaySessionPersistenceError | undefined;
    try {
      await replays.import(JSON.stringify(REPLAY));
    } catch (error) {
      failure = error as ReplaySessionPersistenceError;
    }
    expect(failure).toBeInstanceOf(ReplaySessionPersistenceError);
    if (failure === undefined) throw new Error('import unexpectedly persisted');
    expect(replays.sessions).toContainEqual(failure.session);

    await replays.append(replays.begin(), { ...REPLAY, seed: 9 });
    expect(writes).toBe(2);
  });
});
