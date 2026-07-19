import {describe, expect, it} from "vitest";
import {
  CrossRunArchiveStore,
  RUN_MEMORY_ARCHIVE_CAP,
  RUN_MEMORY_CORRUPT_PAYLOAD_CAP,
  RUN_MEMORY_CORRUPT_STORAGE_KEY,
  RUN_MEMORY_ENVELOPE_FORMAT_VERSION,
  RUN_MEMORY_STORAGE_KEY,
  type ArchiveStorageBackend,
} from "./persistence";
import {
  RunMemoryRecorder,
  parseRunMemory,
  type FinalizedRunMemory,
} from "./run-memory-model";

class MemoryStorage implements ArchiveStorageBackend {
  readonly #entries = new Map<string, string>();

  getItem(key: string): string | null {
    return this.#entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.#entries.set(key, value);
  }

  removeItem(key: string): void {
    this.#entries.delete(key);
  }
}

function makeRecord(runId: string, seed = 0x1234): FinalizedRunMemory {
  const recorder = new RunMemoryRecorder({runId, seed, startedAtTick: 0});
  recorder.recordBehaviorFact({
    segmentId: "segment-1",
    room: "INFORMATION",
    atTick: 12,
    eventId: `${runId}:enter`,
    kind: "ROOM_ENTER",
  });
  return recorder.finalize({
    endedAtTick: 720,
    resolution: {reason: "BODY_COLLAPSE", bossId: null, factEventId: `${runId}:end`},
  });
}

function quarantine(storage: MemoryStorage): string[] {
  const raw = storage.getItem(RUN_MEMORY_CORRUPT_STORAGE_KEY);
  return raw === null ? [] : (JSON.parse(raw) as string[]);
}

describe("CrossRunArchiveStore construction", () => {
  it("fails closed without a Storage-like backend", () => {
    expect(() => new CrossRunArchiveStore({})).toThrow(/Storage-like backend/);
    expect(() => new CrossRunArchiveStore(null)).toThrow(/Storage-like backend/);
    expect(() => new CrossRunArchiveStore({getItem: () => null})).toThrow(/Storage-like backend/);
  });
});

describe("CrossRunArchiveStore round-trip", () => {
  it("persists a finalized record and loads a structurally identical frozen copy", () => {
    const storage = new MemoryStorage();
    const store = new CrossRunArchiveStore(storage);
    const record = makeRecord("run-alpha");

    store.persist(record);
    const loaded = store.load();

    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(JSON.parse(JSON.stringify(record)));
    expect(Object.isFrozen(loaded[0])).toBe(true);
    expect(Object.isFrozen(loaded[0]?.metrics)).toBe(true);
    expect(store.loadLatest()).toEqual(loaded[0]);
    expect(() => parseRunMemory(JSON.stringify(loaded[0]))).not.toThrow();
  });

  it("writes the schema-versioned envelope under the v1 key", () => {
    const storage = new MemoryStorage();
    const store = new CrossRunArchiveStore(storage);

    store.persist(makeRecord("run-alpha"));
    const envelope = JSON.parse(storage.getItem(RUN_MEMORY_STORAGE_KEY) as string) as {
      formatVersion: number;
      records: unknown[];
    };

    expect(envelope.formatVersion).toBe(RUN_MEMORY_ENVELOPE_FORMAT_VERSION);
    expect(envelope.records).toHaveLength(1);
  });

  it("rejects an invalid record at the write boundary", () => {
    const store = new CrossRunArchiveStore(new MemoryStorage());
    expect(() => store.persist({} as FinalizedRunMemory)).toThrow(/invalid run memory/);
  });

  it("clear removes the archive so the next boot is a null-route", () => {
    const store = new CrossRunArchiveStore(new MemoryStorage());
    store.persist(makeRecord("run-alpha"));
    store.clear();
    expect(store.load()).toEqual([]);
    expect(store.loadLatest()).toBeNull();
  });
});

describe("CrossRunArchiveStore ordering and burnout", () => {
  it("returns records newest-first", () => {
    const store = new CrossRunArchiveStore(new MemoryStorage());
    store.persist(makeRecord("run-a"));
    store.persist(makeRecord("run-b"));
    store.persist(makeRecord("run-c"));

    expect(store.load().map((record) => record.run.id)).toEqual(["run-c", "run-b", "run-a"]);
    expect(store.loadLatest()?.run.id).toBe("run-c");
  });

  it("keeps the newest 8 and burns out oldest-first", () => {
    const store = new CrossRunArchiveStore(new MemoryStorage());
    for (let index = 1; index <= 10; index += 1) store.persist(makeRecord(`run-${index}`));

    const ids = store.load().map((record) => record.run.id);
    expect(ids).toHaveLength(RUN_MEMORY_ARCHIVE_CAP);
    expect(ids).toEqual(["run-10", "run-9", "run-8", "run-7", "run-6", "run-5", "run-4", "run-3"]);
  });
});

describe("CrossRunArchiveStore corruption isolation", () => {
  it("isolates garbage JSON and boots as a null-route", () => {
    const storage = new MemoryStorage();
    const store = new CrossRunArchiveStore(storage);
    storage.setItem(RUN_MEMORY_STORAGE_KEY, "{not json at all");

    expect(store.load()).toEqual([]);
    expect(store.loadLatest()).toBeNull();
    expect(storage.getItem(RUN_MEMORY_STORAGE_KEY)).toBeNull();
    expect(quarantine(storage)).toEqual(["{not json at all"]);
  });

  it("isolates an unknown envelope format version", () => {
    const storage = new MemoryStorage();
    const store = new CrossRunArchiveStore(storage);
    store.persist(makeRecord("run-alpha"));
    const envelope = JSON.parse(storage.getItem(RUN_MEMORY_STORAGE_KEY) as string) as {
      formatVersion: number;
      records: unknown[];
    };
    const tampered = JSON.stringify({...envelope, formatVersion: 2});
    storage.setItem(RUN_MEMORY_STORAGE_KEY, tampered);

    expect(store.load()).toEqual([]);
    expect(storage.getItem(RUN_MEMORY_STORAGE_KEY)).toBeNull();
    expect(quarantine(storage)).toEqual([tampered]);
  });

  it("isolates the whole payload when one record is tampered — never coerces partials", () => {
    const storage = new MemoryStorage();
    const store = new CrossRunArchiveStore(storage);
    store.persist(makeRecord("run-a"));
    store.persist(makeRecord("run-b"));
    const envelope = JSON.parse(storage.getItem(RUN_MEMORY_STORAGE_KEY) as string) as {
      formatVersion: number;
      records: {resolution: {reason: string}}[];
    };
    (envelope.records[1] as {resolution: {reason: string}}).resolution.reason = "UNKNOWN_REASON";
    const tampered = JSON.stringify(envelope);
    storage.setItem(RUN_MEMORY_STORAGE_KEY, tampered);

    expect(store.load()).toEqual([]);
    expect(store.loadLatest()).toBeNull();
    expect(storage.getItem(RUN_MEMORY_STORAGE_KEY)).toBeNull();
    expect(quarantine(storage)).toEqual([tampered]);
  });

  it("persists a fresh envelope after isolating a corrupt one", () => {
    const storage = new MemoryStorage();
    const store = new CrossRunArchiveStore(storage);
    storage.setItem(RUN_MEMORY_STORAGE_KEY, "garbage");

    store.persist(makeRecord("run-alpha"));

    expect(store.load().map((record) => record.run.id)).toEqual(["run-alpha"]);
    expect(quarantine(storage)).toEqual(["garbage"]);
  });

  it("caps the quarantine, dropping oldest payloads first", () => {
    const storage = new MemoryStorage();
    const store = new CrossRunArchiveStore(storage);
    for (let index = 1; index <= 10; index += 1) {
      storage.setItem(RUN_MEMORY_STORAGE_KEY, `garbage-${index}`);
      expect(store.load()).toEqual([]);
    }

    const entries = quarantine(storage);
    expect(entries).toHaveLength(RUN_MEMORY_CORRUPT_PAYLOAD_CAP);
    expect(entries[0]).toBe("garbage-3");
    expect(entries[entries.length - 1]).toBe("garbage-10");
  });
});

describe("CrossRunArchiveStore backend failure tolerance", () => {
  it("tolerates quota-exceeded writes without crashing", () => {
    const storage = new MemoryStorage();
    const throwingStorage: ArchiveStorageBackend = {
      getItem: (key) => storage.getItem(key),
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: (key) => storage.removeItem(key),
    };
    const store = new CrossRunArchiveStore(throwingStorage);

    expect(() => store.persist(makeRecord("run-alpha"))).not.toThrow();
    expect(store.load()).toEqual([]);
    expect(store.loadLatest()).toBeNull();
  });

  it("never throws out of load paths when the backend read fails", () => {
    const readFailingStorage: ArchiveStorageBackend = {
      getItem: () => {
        throw new Error("backend unavailable");
      },
      setItem: () => {},
      removeItem: () => {},
    };
    const store = new CrossRunArchiveStore(readFailingStorage);

    expect(store.load()).toEqual([]);
    expect(store.loadLatest()).toBeNull();
    expect(() => store.clear()).not.toThrow();
  });
});
