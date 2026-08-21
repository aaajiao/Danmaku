/**
 * Browser storage policy for replay-video chunks.
 *
 * Long campaign exports are streamed into the origin-private file system so a
 * complete recording never has to remain resident in JavaScript memory.  The
 * in-memory sink is deliberately only a bounded fallback for recordings whose
 * estimated encoded size fits its hard limit.
 */

import {
  AUDIO_CAPTURE_BITRATE,
  MemoryVideoChunkSink,
  VIDEO_CAPTURE_BITRATE,
  VIDEO_CAPTURE_FPS,
  VIDEO_CAPTURE_MEMORY_LIMIT_BYTES,
  type VideoChunkSink,
} from '../render/video-capture';

export const VIDEO_CAPTURE_ESTIMATE_HEADROOM = 1.2;
export const VIDEO_CAPTURE_STORAGE_RESERVE_BYTES = 16 * 1024 * 1024;
export const VIDEO_CAPTURE_TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const VIDEO_CAPTURE_TEMP_DIRECTORY = 'danmaku-video-exports';

const VIDEO_CAPTURE_TEMP_PREFIX = 'capture-';
const VIDEO_CAPTURE_TEMP_SUFFIX = '.part';

/** Structural browser surfaces kept small so Bun tests can provide fakes. */
export interface VideoStorageEstimate {
  readonly quota?: number;
  readonly usage?: number;
}

export interface VideoFile {
  readonly size: number;
  readonly lastModified: number;
}

export interface VideoFileSystemWritable {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

export interface VideoFileSystemFileHandle {
  readonly kind: 'file';
  readonly name: string;
  createWritable(): Promise<VideoFileSystemWritable>;
  getFile(): Promise<Blob & VideoFile>;
}

export interface VideoFileSystemDirectoryHandle {
  readonly kind: 'directory';
  readonly name: string;
  getDirectoryHandle(
    name: string,
    options?: { readonly create?: boolean },
  ): Promise<VideoFileSystemDirectoryHandle>;
  getFileHandle(
    name: string,
    options?: { readonly create?: boolean },
  ): Promise<VideoFileSystemFileHandle>;
  removeEntry(name: string): Promise<void>;
  entries?(): AsyncIterableIterator<
    readonly [string, VideoFileSystemFileHandle | VideoFileSystemDirectoryHandle]
  >;
}

export interface VideoStorageManager {
  estimate?(): Promise<VideoStorageEstimate>;
  getDirectory?(): Promise<VideoFileSystemDirectoryHandle>;
}

export interface PrepareVideoChunkSinkOptions {
  /** Expected duration in fixed 60 Hz ticks, including the one-second tail. */
  readonly expectedTicks: number;
  readonly storage?: VideoStorageManager;
  readonly now?: () => number;
  readonly randomId?: () => string;
  readonly memoryLimit?: number;
}

/** Estimated encoded bytes, including conservative container/encoder headroom. */
export function estimateVideoCaptureBytes(expectedTicks: number): number {
  assertExpectedTicks(expectedTicks);
  const seconds = expectedTicks / VIDEO_CAPTURE_FPS;
  return Math.ceil(
    (seconds * (VIDEO_CAPTURE_BITRATE + AUDIO_CAPTURE_BITRATE)
      * VIDEO_CAPTURE_ESTIMATE_HEADROOM) / 8,
  );
}

/**
 * Prepare storage before recording starts.
 *
 * OPFS is always preferred.  If it cannot be opened, only an export estimated
 * to fit the bounded memory sink is allowed to fall back.  Once OPFS recording
 * has begun, write failures remain failures; switching stores mid-stream would
 * silently omit all chunks already released to disk.
 */
export async function prepareVideoChunkSink(
  options: PrepareVideoChunkSinkOptions,
): Promise<VideoChunkSink> {
  const expectedBytes = estimateVideoCaptureBytes(options.expectedTicks);
  const memoryLimit = options.memoryLimit ?? VIDEO_CAPTURE_MEMORY_LIMIT_BYTES;
  assertMemoryLimit(memoryLimit);

  const storage = options.storage ?? browserStorage();
  if (storage?.getDirectory === undefined) {
    return memoryFallbackOrThrow(expectedBytes, memoryLimit);
  }

  const now = options.now ?? Date.now;
  const randomId = options.randomId ?? browserRandomId;
  let directory: VideoFileSystemDirectoryHandle;

  try {
    const root = await storage.getDirectory();
    directory = await root.getDirectoryHandle(VIDEO_CAPTURE_TEMP_DIRECTORY, {
      create: true,
    });
  } catch (error) {
    return memoryFallbackOrThrow(expectedBytes, memoryLimit, error);
  }

  const timestamp = finiteTimestamp(now());
  await removeExpiredVideoCaptures(directory, timestamp);

  const estimate = await readStorageEstimate(storage);
  if (estimate !== undefined) {
    const available = estimate.quota - estimate.usage;
    if (available < expectedBytes + VIDEO_CAPTURE_STORAGE_RESERVE_BYTES) {
      return memoryFallbackOrThrow(
        expectedBytes,
        memoryLimit,
        new Error('video export: origin-private storage has insufficient free space'),
      );
    }
  }

  const filename = temporaryFilename(timestamp, randomId());
  let fileHandle: VideoFileSystemFileHandle;
  try {
    fileHandle = await directory.getFileHandle(filename, { create: true });
  } catch (error) {
    await removeEntryBestEffort(directory, filename);
    return memoryFallbackOrThrow(expectedBytes, memoryLimit, error);
  }

  try {
    const writable = await fileHandle.createWritable();
    return new OpfsVideoChunkSink(directory, fileHandle, writable);
  } catch (error) {
    await removeEntryBestEffort(directory, filename);
    return memoryFallbackOrThrow(expectedBytes, memoryLimit, error);
  }
}

class OpfsVideoChunkSink implements VideoChunkSink {
  readonly kind = 'opfs' as const;

  readonly #directory: VideoFileSystemDirectoryHandle;
  readonly #fileHandle: VideoFileSystemFileHandle;
  readonly #writable: VideoFileSystemWritable;

  #bytesWritten = 0;
  #closed = false;
  #result: Blob | undefined;
  #discardPromise: Promise<void> | undefined;

  constructor(
    directory: VideoFileSystemDirectoryHandle,
    fileHandle: VideoFileSystemFileHandle,
    writable: VideoFileSystemWritable,
  ) {
    this.#directory = directory;
    this.#fileHandle = fileHandle;
    this.#writable = writable;
  }

  async write(chunk: Blob): Promise<void> {
    this.#assertWritable();
    try {
      // Pass the Blob straight through. Converting it to an ArrayBuffer would
      // make a full-size transient copy and defeat the point of disk streaming.
      await this.#writable.write(chunk);
      this.#bytesWritten += chunk.size;
    } catch (error) {
      await this.discard();
      throw error;
    }
  }

  async finalize(_mimeType: string): Promise<Blob> {
    if (this.#result !== undefined) return this.#result;
    this.#assertWritable();

    try {
      await this.#writable.close();
      this.#closed = true;
      const file = await this.#fileHandle.getFile();
      if (file.size !== this.#bytesWritten) {
        throw new Error(
          `video export: stored file size mismatch (expected ${this.#bytesWritten}, got ${file.size})`,
        );
      }
      this.#result = file;
      return file;
    } catch (error) {
      await this.discard();
      throw error;
    }
  }

  discard(): Promise<void> {
    if (this.#discardPromise !== undefined) return this.#discardPromise;
    this.#discardPromise = this.#discard();
    return this.#discardPromise;
  }

  async #discard(): Promise<void> {
    if (!this.#closed) {
      try {
        await this.#writable.abort();
      } catch {
        // Cleanup is best effort and must not hide the capture's original error.
      }
    }
    await removeEntryBestEffort(this.#directory, this.#fileHandle.name);
  }

  #assertWritable(): void {
    if (this.#discardPromise !== undefined) {
      throw new Error('video export: chunk sink has been discarded');
    }
    if (this.#closed) {
      throw new Error('video export: chunk sink has already been finalized');
    }
  }
}

async function removeExpiredVideoCaptures(
  directory: VideoFileSystemDirectoryHandle,
  now: number,
): Promise<void> {
  const entries = directory.entries?.();
  if (entries === undefined) return;

  try {
    for await (const [name, handle] of entries) {
      if (
        handle.kind !== 'file'
        || !name.startsWith(VIDEO_CAPTURE_TEMP_PREFIX)
        || !name.endsWith(VIDEO_CAPTURE_TEMP_SUFFIX)
      ) {
        continue;
      }

      try {
        const file = await handle.getFile();
        if (now - file.lastModified > VIDEO_CAPTURE_TEMP_MAX_AGE_MS) {
          await removeEntryBestEffort(directory, name);
        }
      } catch {
        // One damaged or concurrently removed stale entry must not block export.
      }
    }
  } catch {
    // Directory iteration is cleanup, not a prerequisite for a new recording.
  }
}

async function readStorageEstimate(
  storage: VideoStorageManager,
): Promise<{ readonly quota: number; readonly usage: number } | undefined> {
  if (storage.estimate === undefined) return undefined;
  try {
    const estimate = await storage.estimate();
    if (
      typeof estimate.quota !== 'number'
      || !Number.isFinite(estimate.quota)
      || estimate.quota < 0
      || typeof estimate.usage !== 'number'
      || !Number.isFinite(estimate.usage)
      || estimate.usage < 0
    ) {
      return undefined;
    }
    return { quota: estimate.quota, usage: estimate.usage };
  } catch {
    // estimate() is advisory. The real OPFS write remains authoritative.
    return undefined;
  }
}

function memoryFallbackOrThrow(
  expectedBytes: number,
  memoryLimit: number,
  cause?: unknown,
): VideoChunkSink {
  if (expectedBytes <= memoryLimit) {
    return new MemoryVideoChunkSink(memoryLimit);
  }

  throw new Error(
    'video export: browser file storage is unavailable for this full recording; export stages individually',
    cause === undefined ? undefined : { cause },
  );
}

async function removeEntryBestEffort(
  directory: VideoFileSystemDirectoryHandle,
  name: string,
): Promise<void> {
  try {
    await directory.removeEntry(name);
  } catch {
    // Removal can race another tab or fail under storage pressure; it is safe to
    // retry through the next preparation's stale-file sweep.
  }
}

function temporaryFilename(timestamp: number, randomId: string): string {
  const safeId = randomId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'id';
  return `${VIDEO_CAPTURE_TEMP_PREFIX}${timestamp}-${safeId}${VIDEO_CAPTURE_TEMP_SUFFIX}`;
}

function finiteTimestamp(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error('video export: current time is invalid');
  }
  return Math.trunc(value);
}

function assertExpectedTicks(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('video export: expectedTicks must be a positive safe integer');
  }
}

function assertMemoryLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('video export: memoryLimit must be a positive safe integer');
  }
}

function browserStorage(): VideoStorageManager | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return navigator.storage as unknown as VideoStorageManager | undefined;
}

function browserRandomId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID !== undefined) {
    return crypto.randomUUID();
  }
  throw new Error('video export: crypto.randomUUID is unavailable');
}
