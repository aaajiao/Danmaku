/**
 * Browser persistence for player replay sessions.
 *
 * The library updates its in-memory view before awaiting IndexedDB, so a result
 * screen can immediately offer WATCH/DOWNLOAD on the tick a run ends. Storage
 * failure remains visible to the caller, but never loses the just-recorded
 * in-memory session for the rest of the page lifetime.
 */

import type { Replay } from '../sim/replay';
import {
  appendReplay,
  createReplaySession,
  deserializeReplayDocument,
  deserializeReplaySession,
  type ReplaySession,
  type ReplaySessionIdentity,
} from './session';

export interface ReplaySessionStore {
  load(): Promise<readonly ReplaySession[]>;
  put(session: ReplaySession): Promise<void>;
  remove(id: string): Promise<void>;
  close?(): void;
}

export class MemoryReplaySessionStore implements ReplaySessionStore {
  readonly #sessions = new Map<string, ReplaySession>();

  async load(): Promise<readonly ReplaySession[]> {
    return [...this.#sessions.values()];
  }

  async put(session: ReplaySession): Promise<void> {
    this.#sessions.set(session.id, session);
  }

  async remove(id: string): Promise<void> {
    this.#sessions.delete(id);
  }
}

const DB_NAME = 'danmaku-replays';
const DB_VERSION = 1;
const SESSION_STORE = 'sessions';

export class IndexedDbReplaySessionStore implements ReplaySessionStore {
  readonly #factory: IDBFactory;
  #db: Promise<IDBDatabase> | undefined;
  #closed = false;

  constructor(factory: IDBFactory) {
    this.#factory = factory;
  }

  async load(): Promise<readonly ReplaySession[]> {
    const db = await this.#database();
    const raw = await requestResult<unknown[]>(db.transaction(SESSION_STORE).objectStore(SESSION_STORE).getAll());
    const sessions: ReplaySession[] = [];
    raw.forEach((value, index) => {
      try {
        sessions.push(deserializeReplaySession(JSON.stringify(value)));
      } catch (error) {
        // One damaged row must not hide every valid recording beside it.
        console.warn(`replay library: ignored invalid stored session ${index}`, error);
      }
    });
    return sessions;
  }

  async put(session: ReplaySession): Promise<void> {
    const db = await this.#database();
    const transaction = db.transaction(SESSION_STORE, 'readwrite');
    transaction.objectStore(SESSION_STORE).put(session);
    await transactionDone(transaction);
  }

  async remove(id: string): Promise<void> {
    const db = await this.#database();
    const transaction = db.transaction(SESSION_STORE, 'readwrite');
    transaction.objectStore(SESSION_STORE).delete(id);
    await transactionDone(transaction);
  }

  close(): void {
    this.#closed = true;
    const pending = this.#db;
    if (pending !== undefined) {
      void pending.then((db) => db.close(), () => {});
    }
  }

  #database(): Promise<IDBDatabase> {
    if (this.#closed) {
      return Promise.reject(new Error('replay library: IndexedDB store is closed'));
    }
    const existing = this.#db;
    if (existing !== undefined) return existing;

    this.#db = new Promise((resolve, reject) => {
      const request = this.#factory.open(DB_NAME, DB_VERSION);
      let settled = false;
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(SESSION_STORE)) {
          db.createObjectStore(SESSION_STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => {
        if (settled || this.#closed) {
          settled = true;
          request.result.close();
          if (this.#closed) {
            reject(new Error('replay library: IndexedDB store is closed'));
          }
          return;
        }
        settled = true;
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => {
        if (settled) return;
        settled = true;
        reject(request.error ?? new Error('replay library: cannot open IndexedDB'));
      };
      request.onblocked = () => {
        if (settled) return;
        settled = true;
        reject(new Error('replay library: IndexedDB upgrade is blocked'));
      };
    });
    return this.#db;
  }
}

export interface ReplayLibraryOptions {
  readonly now?: () => string;
  readonly id?: () => string;
}

export class ReplaySessionPersistenceError extends Error {
  readonly session: ReplaySession;
  override readonly cause: unknown;

  constructor(session: ReplaySession, cause: unknown) {
    super('replay library: imported session could not be persisted');
    this.name = 'ReplaySessionPersistenceError';
    this.session = session;
    this.cause = cause;
  }
}

export interface ReplayLibraryLoadResult {
  readonly library: ReplayLibrary;
  readonly degraded: boolean;
  readonly error?: unknown;
}

/**
 * Bound optional browser storage so replay persistence can never hold the game
 * boot hostage. A timed-out primary is closed even if its open request resolves
 * later; the fresh fallback remains fully usable for this page.
 */
export async function loadReplayLibraryWithFallback(
  primary: ReplaySessionStore,
  fallback: ReplaySessionStore,
  timeoutMs = 1500,
): Promise<ReplayLibraryLoadResult> {
  const library = new ReplayLibrary(primary);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      library.load(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`replay library: load timed out after ${timeoutMs}ms`));
        }, Math.max(0, timeoutMs));
      }),
    ]);
    return { library, degraded: false };
  } catch (error) {
    primary.close?.();
    const memory = new ReplayLibrary(fallback);
    await memory.load();
    return { library: memory, degraded: true, error };
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export class ReplayLibrary {
  readonly #store: ReplaySessionStore;
  readonly #now: () => string;
  readonly #id: () => string;
  readonly #sessions = new Map<string, ReplaySession>();
  readonly #sessionRevisions = new Map<string, number>();
  #nextRevision = 0;
  #writes: Promise<void> = Promise.resolve();

  constructor(store: ReplaySessionStore, options: ReplayLibraryOptions = {}) {
    this.#store = store;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#id = options.id ?? defaultId;
  }

  async load(): Promise<void> {
    const sessions = await this.#store.load();
    this.#sessions.clear();
    this.#sessionRevisions.clear();
    for (const session of sessions) {
      this.#sessions.set(session.id, session);
      this.#markChanged(session.id);
    }
  }

  /** New attempt/campaign identity. Empty sessions are not persisted. */
  begin(): string {
    return this.#uniqueId();
  }

  async append(sessionId: string, replay: Replay): Promise<ReplaySession> {
    const now = this.#now();
    const current =
      this.#sessions.get(sessionId)
      ?? createReplaySession({ id: sessionId, now });
    const next = appendReplay(current, replay, now);
    this.#sessions.set(next.id, next);
    this.#markChanged(next.id);
    await this.#persist(next);
    return next;
  }

  async import(text: string): Promise<ReplaySession> {
    const identity: ReplaySessionIdentity = { id: this.#uniqueId(), now: this.#now() };
    const parsed = deserializeReplayDocument(text, identity);
    const collisionTime = this.#now();
    const session = this.#sessions.has(parsed.id)
      ? {
        ...parsed,
        id: this.#uniqueId(),
        updatedAt: collisionTime < parsed.updatedAt
          ? parsed.updatedAt
          : collisionTime,
      }
      : parsed;
    this.#sessions.set(session.id, session);
    this.#markChanged(session.id);
    try {
      await this.#persist(session);
    } catch (error) {
      // Match live append semantics: the imported session remains usable in
      // memory, and the caller can report the precise page-only degradation.
      throw new ReplaySessionPersistenceError(session, error);
    }
    return session;
  }

  /**
   * Remove one complete attempt/campaign from memory and persistent storage.
   *
   * The in-memory view updates before the store finishes, matching `append`,
   * so the menu can leave the confirmation screen immediately. Deletes share
   * the write queue with appends: a pending final-stage write always lands
   * before its later deletion. If storage refuses the delete, restore the
   * session unless a newer mutation of the same id has superseded it.
   */
  async remove(id: string): Promise<boolean> {
    const session = this.#sessions.get(id);
    if (session === undefined) return false;
    this.#sessions.delete(id);
    const revision = this.#markChanged(id);

    const write = this.#writes.then(() => this.#store.remove(id));
    this.#writes = write.catch(() => {});
    try {
      await write;
    } catch (error) {
      // A newer append/remove of the same id owns the current truth. Restore
      // this snapshot only when no mutation has superseded this deletion.
      if (this.#sessionRevisions.get(id) === revision) {
        this.#sessions.set(id, session);
        this.#markChanged(id);
      }
      throw error;
    }
    return true;
  }

  get(id: string): ReplaySession | undefined {
    return this.#sessions.get(id);
  }

  get sessions(): readonly ReplaySession[] {
    return [...this.#sessions.values()].sort((a, b) => (
      b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)
    ));
  }

  #markChanged(id: string): number {
    this.#nextRevision++;
    this.#sessionRevisions.set(id, this.#nextRevision);
    return this.#nextRevision;
  }

  #uniqueId(): string {
    let id = this.#id();
    while (this.#sessions.has(id)) id = this.#id();
    return id;
  }

  async #persist(session: ReplaySession): Promise<void> {
    const write = this.#writes.then(() => this.#store.put(session));
    // A failed write is reported to its caller but cannot poison every later
    // append. Serialization prevents an older, slower snapshot overwriting a
    // newer multi-stage version of the same session.
    this.#writes = write.catch(() => {});
    await write;
  }
}

let fallbackId = 0;

function defaultId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  fallbackId += 1;
  return `session-${Date.now().toString(36)}-${fallbackId.toString(36)}`;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('replay library: IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(
      transaction.error ?? new Error('replay library: IndexedDB transaction failed'),
    );
    transaction.onabort = () => reject(
      transaction.error ?? new Error('replay library: IndexedDB transaction aborted'),
    );
  });
}
