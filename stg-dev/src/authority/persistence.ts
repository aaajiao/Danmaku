import {
  parseRunMemory,
  validateRunMemory,
  type FinalizedRunMemory,
  type RunMemory,
} from "./run-memory-model";

export const RUN_MEMORY_STORAGE_KEY = "danmaku.run-memory.v1" as const;
export const RUN_MEMORY_CORRUPT_STORAGE_KEY = "danmaku.run-memory.corrupt" as const;
export const RUN_MEMORY_ENVELOPE_FORMAT_VERSION = 1 as const;
/** Keep the newest 8 records; burnout drops oldest-first (ghost contract cap). */
export const RUN_MEMORY_ARCHIVE_CAP = 8 as const;
/** Quarantined raw payloads kept newest-first, oldest dropped. */
export const RUN_MEMORY_CORRUPT_PAYLOAD_CAP = 8 as const;

/**
 * Minimal Storage-like port. Browser boot passes localStorage (the default);
 * tests inject an in-memory fake. IndexedDB migration is deliberately deferred
 * to P1 hardening.
 */
export interface ArchiveStorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface ArchiveEnvelope {
  formatVersion: typeof RUN_MEMORY_ENVELOPE_FORMAT_VERSION;
  records: unknown[];
}

function isStorageBackend(value: unknown): value is ArchiveStorageBackend {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.getItem === "function"
    && typeof candidate.setItem === "function"
    && typeof candidate.removeItem === "function";
}

function isEnvelope(value: unknown): value is ArchiveEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  return keys.length === 2
    && candidate.formatVersion === RUN_MEMORY_ENVELOPE_FORMAT_VERSION
    && Array.isArray(candidate.records);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  }
  return Object.freeze(value);
}

/**
 * Durable cross-run archive over an injected Storage-like backend.
 *
 * Serialization decision (v1): the run-memory model exports no canonical
 * serializer, so records are written as plain JSON.stringify of the
 * already-validated frozen record, and every write asserts the payload
 * round-trips through parseRunMemory.
 *
 * Fail-closed corruption isolation: any parse, shape, or record-validation
 * failure moves the whole raw payload to the quarantine key and the load path
 * reports an empty archive (null-route) — never coerced partial records, never
 * fabricated history, never a throw out of a load path (boot must proceed).
 */
export class CrossRunArchiveStore {
  readonly #storage: ArchiveStorageBackend;

  constructor(storageValue?: unknown) {
    const backend = storageValue
      ?? (globalThis as {localStorage?: unknown}).localStorage;
    if (!isStorageBackend(backend)) {
      throw new Error(
        "cross-run archive store requires a Storage-like backend (getItem/setItem/removeItem)",
      );
    }
    this.#storage = backend;
  }

  /**
   * Validates, serializes, and prepends the record (newest-first), keeping the
   * newest 8 and burning out oldest-first. Invalid records throw (fail-closed
   * write); backend write failures such as quota exhaustion are tolerated
   * without crashing — the run simply leaves no durable trace.
   */
  persist(record: FinalizedRunMemory): void {
    const validation = validateRunMemory(record);
    if (!validation.ok) {
      throw new Error(
        `cross-run archive store rejects invalid run memory: ${validation.errors.join("; ")}`,
      );
    }
    const serialized = JSON.stringify(record);
    let reparsed: RunMemory;
    try {
      reparsed = parseRunMemory(serialized);
    } catch (error) {
      throw new Error(
        `cross-run archive store serialization does not round-trip: ${String(error)}`,
      );
    }
    const existing = this.load();
    const records: unknown[] = [reparsed, ...existing].slice(0, RUN_MEMORY_ARCHIVE_CAP);
    const envelope: ArchiveEnvelope = {
      formatVersion: RUN_MEMORY_ENVELOPE_FORMAT_VERSION,
      records,
    };
    try {
      this.#storage.setItem(RUN_MEMORY_STORAGE_KEY, JSON.stringify(envelope));
    } catch {
      // Quota exhaustion or backend failure: tolerated, never a crash.
    }
  }

  /** All archived records newest-first; empty on absence or any corruption. */
  load(): FinalizedRunMemory[] {
    let raw: string | null;
    try {
      raw = this.#storage.getItem(RUN_MEMORY_STORAGE_KEY);
    } catch {
      return [];
    }
    if (raw === null) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      this.#isolate(raw);
      return [];
    }
    if (!isEnvelope(parsed)) {
      this.#isolate(raw);
      return [];
    }
    const records: FinalizedRunMemory[] = [];
    for (const entry of parsed.records) {
      if (!validateRunMemory(entry).ok) {
        this.#isolate(raw);
        return [];
      }
      records.push(deepFreeze(entry) as FinalizedRunMemory);
    }
    return records;
  }

  /** Newest archived record, or null when the archive is absent or isolated. */
  loadLatest(): FinalizedRunMemory | null {
    const [latest] = this.load();
    return latest ?? null;
  }

  /** Removes the archive envelope. The quarantine key is left untouched. */
  clear(): void {
    try {
      this.#storage.removeItem(RUN_MEMORY_STORAGE_KEY);
    } catch {
      // Backend failure tolerated; a stale envelope is re-isolated on load.
    }
  }

  /**
   * Moves the raw payload to the quarantine key (append newest-last, capped,
   * oldest dropped) and removes the main key so the next boot is a clean
   * null-route. Never throws.
   */
  #isolate(rawPayload: string): void {
    try {
      let entries: string[] = [];
      const existingRaw = this.#storage.getItem(RUN_MEMORY_CORRUPT_STORAGE_KEY);
      if (existingRaw !== null) {
        try {
          const parsed = JSON.parse(existingRaw) as unknown;
          if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")) {
            entries = parsed as string[];
          }
        } catch {
          // An unreadable quarantine index is itself discarded.
        }
      }
      entries.push(rawPayload);
      const capped = entries.slice(-RUN_MEMORY_CORRUPT_PAYLOAD_CAP);
      this.#storage.setItem(RUN_MEMORY_CORRUPT_STORAGE_KEY, JSON.stringify(capped));
    } catch {
      // Quarantine write failure must not block boot.
    }
    try {
      this.#storage.removeItem(RUN_MEMORY_STORAGE_KEY);
    } catch {
      // Backend failure tolerated; the payload stays until a writable boot.
    }
  }
}
