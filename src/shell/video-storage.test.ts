import { describe, expect, test } from 'bun:test';

import type { VideoChunkSink } from '../render/video-capture';
import {
  VIDEO_CAPTURE_STORAGE_RESERVE_BYTES,
  VIDEO_CAPTURE_TEMP_DIRECTORY,
  VIDEO_CAPTURE_TEMP_MAX_AGE_MS,
  estimateVideoCaptureBytes,
  prepareVideoChunkSink,
  type VideoFileSystemDirectoryHandle,
  type VideoFileSystemFileHandle,
  type VideoFileSystemWritable,
  type VideoStorageEstimate,
  type VideoStorageManager,
} from './video-storage';

interface FakeFailures {
  readonly getDirectory?: Error;
  readonly getDirectoryHandle?: Error;
  readonly getFileHandle?: Error;
  readonly createWritable?: Error;
  readonly write?: Error;
  readonly close?: Error;
  readonly getFile?: Error;
  readonly abort?: Error;
  readonly remove?: Error;
  readonly estimate?: Error;
}

class FakeWritable implements VideoFileSystemWritable {
  readonly chunks: Blob[] = [];
  readonly calls: string[];
  readonly failures: FakeFailures;
  aborts = 0;
  closes = 0;

  constructor(calls: string[], failures: FakeFailures) {
    this.calls = calls;
    this.failures = failures;
  }

  async write(data: Blob): Promise<void> {
    this.calls.push(`write:${data.size}`);
    if (this.failures.write !== undefined) throw this.failures.write;
    this.chunks.push(data);
  }

  async close(): Promise<void> {
    this.calls.push('close');
    this.closes++;
    if (this.failures.close !== undefined) throw this.failures.close;
  }

  async abort(): Promise<void> {
    this.calls.push('abort');
    this.aborts++;
    if (this.failures.abort !== undefined) throw this.failures.abort;
  }
}

class FakeFileHandle implements VideoFileSystemFileHandle {
  readonly kind = 'file' as const;
  readonly name: string;
  readonly #calls: string[];
  readonly #failures: FakeFailures;
  readonly #writable: FakeWritable;
  readonly #lastModified: number;
  readonly #fixedSize: number | undefined;

  constructor(
    name: string,
    calls: string[],
    failures: FakeFailures,
    writable: FakeWritable,
    options: { readonly lastModified?: number; readonly fixedSize?: number } = {},
  ) {
    this.name = name;
    this.#calls = calls;
    this.#failures = failures;
    this.#writable = writable;
    this.#lastModified = options.lastModified ?? 0;
    this.#fixedSize = options.fixedSize;
  }

  async createWritable(): Promise<VideoFileSystemWritable> {
    this.#calls.push('createWritable');
    if (this.#failures.createWritable !== undefined) {
      throw this.#failures.createWritable;
    }
    return this.#writable;
  }

  async getFile(): Promise<File> {
    this.#calls.push(`getFile:${this.name}`);
    if (this.#failures.getFile !== undefined) throw this.#failures.getFile;
    const chunks = this.#fixedSize === undefined
      ? this.#writable.chunks
      : [new Uint8Array(this.#fixedSize)];
    return new File(chunks, this.name, { lastModified: this.#lastModified });
  }
}

class StaticFileHandle implements VideoFileSystemFileHandle {
  readonly kind = 'file' as const;
  readonly name: string;
  readonly #lastModified: number;
  readonly #calls: string[];
  readonly #failGetFile: boolean;

  constructor(
    name: string,
    lastModified: number,
    calls: string[],
    failGetFile = false,
  ) {
    this.name = name;
    this.#lastModified = lastModified;
    this.#calls = calls;
    this.#failGetFile = failGetFile;
  }

  async createWritable(): Promise<VideoFileSystemWritable> {
    throw new Error('test: stale file must not be opened for writing');
  }

  async getFile(): Promise<File> {
    this.#calls.push(`getFile:${this.name}`);
    if (this.#failGetFile) throw new Error('stale metadata failed');
    return new File([], this.name, { lastModified: this.#lastModified });
  }
}

class FakeDirectory implements VideoFileSystemDirectoryHandle {
  readonly kind = 'directory' as const;
  readonly name: string;
  readonly entriesByName = new Map<
    string,
    VideoFileSystemFileHandle | VideoFileSystemDirectoryHandle
  >();
  readonly removed: string[] = [];
  readonly #calls: string[];
  readonly #failures: FakeFailures;
  readonly #writable: FakeWritable;
  readonly #isRoot: boolean;
  #child: FakeDirectory | undefined;
  #createdFile: FakeFileHandle | undefined;
  #fixedSize: number | undefined;

  constructor(
    name: string,
    calls: string[],
    failures: FakeFailures,
    writable: FakeWritable,
    isRoot = false,
  ) {
    this.name = name;
    this.#calls = calls;
    this.#failures = failures;
    this.#writable = writable;
    this.#isRoot = isRoot;
  }

  set child(value: FakeDirectory) {
    this.#child = value;
  }

  set fixedSize(value: number | undefined) {
    this.#fixedSize = value;
  }

  get createdFile(): FakeFileHandle | undefined {
    return this.#createdFile;
  }

  async getDirectoryHandle(
    name: string,
    options?: { readonly create?: boolean },
  ): Promise<VideoFileSystemDirectoryHandle> {
    this.#calls.push(`getDirectoryHandle:${name}:${String(options?.create)}`);
    if (this.#failures.getDirectoryHandle !== undefined) {
      throw this.#failures.getDirectoryHandle;
    }
    if (!this.#isRoot || this.#child === undefined) {
      throw new Error('test: unexpected nested directory request');
    }
    return this.#child;
  }

  async getFileHandle(
    name: string,
    options?: { readonly create?: boolean },
  ): Promise<VideoFileSystemFileHandle> {
    this.#calls.push(`getFileHandle:${name}:${String(options?.create)}`);
    if (this.#failures.getFileHandle !== undefined) {
      throw this.#failures.getFileHandle;
    }
    const file = new FakeFileHandle(
      name,
      this.#calls,
      this.#failures,
      this.#writable,
      { fixedSize: this.#fixedSize },
    );
    this.#createdFile = file;
    this.entriesByName.set(name, file);
    return file;
  }

  async removeEntry(name: string): Promise<void> {
    this.#calls.push(`removeEntry:${name}`);
    this.removed.push(name);
    if (this.#failures.remove !== undefined) throw this.#failures.remove;
    this.entriesByName.delete(name);
  }

  async *entries(): AsyncIterableIterator<
    readonly [string, VideoFileSystemFileHandle | VideoFileSystemDirectoryHandle]
  > {
    this.#calls.push('entries');
    for (const entry of [...this.entriesByName.entries()]) {
      yield entry;
    }
  }
}

interface StorageHarness {
  readonly storage: VideoStorageManager;
  readonly calls: string[];
  readonly writable: FakeWritable;
  readonly directory: FakeDirectory;
  readonly root: FakeDirectory;
}

function storageHarness(
  options: {
    readonly failures?: FakeFailures;
    readonly estimate?: VideoStorageEstimate;
    readonly omitEstimate?: boolean;
    readonly fixedSize?: number;
  } = {},
): StorageHarness {
  const calls: string[] = [];
  const failures = options.failures ?? {};
  const writable = new FakeWritable(calls, failures);
  const directory = new FakeDirectory(
    VIDEO_CAPTURE_TEMP_DIRECTORY,
    calls,
    failures,
    writable,
  );
  directory.fixedSize = options.fixedSize;
  const root = new FakeDirectory('root', calls, failures, writable, true);
  root.child = directory;

  const storage: VideoStorageManager = {
    async getDirectory(): Promise<VideoFileSystemDirectoryHandle> {
      calls.push('getDirectory');
      if (failures.getDirectory !== undefined) throw failures.getDirectory;
      return root;
    },
  };
  if (!options.omitEstimate) {
    storage.estimate = async (): Promise<VideoStorageEstimate> => {
      calls.push('estimate');
      if (failures.estimate !== undefined) throw failures.estimate;
      return options.estimate ?? { quota: 2 ** 40, usage: 0 };
    };
  }

  return { storage, calls, writable, directory, root };
}

async function opfsSink(harness: StorageHarness): Promise<VideoChunkSink> {
  return prepareVideoChunkSink({
    expectedTicks: 60,
    storage: harness.storage,
    now: () => 10_000,
    randomId: () => 'unit/id?',
  });
}

describe('prepareVideoChunkSink', () => {
  test('estimates both encoded bitrates with 20% headroom', () => {
    expect(estimateVideoCaptureBytes(60)).toBe(619_200);
    expect(() => estimateVideoCaptureBytes(0)).toThrow('positive safe integer');
  });

  test('streams Blobs directly, closes before reading, and keeps a successful file', async () => {
    const harness = storageHarness();
    const sink = await opfsSink(harness);
    const head = new Blob(['head']);
    const tail = new Blob(['tail!']);
    harness.calls.length = 0;

    await sink.write(head);
    await sink.write(tail);
    expect(harness.writable.chunks[0]).toBe(head);
    expect(harness.writable.chunks[1]).toBe(tail);

    const result = await sink.finalize('video/webm');

    expect(sink.kind).toBe('opfs');
    expect(result.size).toBe(head.size + tail.size);
    expect(harness.calls).toEqual([
      `write:${head.size}`,
      `write:${tail.size}`,
      'close',
      'getFile:capture-10000-unitid.part',
    ]);
    expect(harness.directory.removed).toEqual([]);
    expect(await sink.finalize('video/mp4')).toBe(result);
  });

  test('a finalized file can still be explicitly discarded without aborting it', async () => {
    const harness = storageHarness();
    const sink = await opfsSink(harness);
    await sink.write(new Blob(['complete']));
    await sink.finalize('video/webm');

    const first = sink.discard();
    const second = sink.discard();
    expect(second).toBe(first);
    await first;

    expect(harness.writable.aborts).toBe(0);
    expect(harness.directory.removed).toEqual([
      'capture-10000-unitid.part',
    ]);
  });

  test('write failure preserves the original error and cleans up only once', async () => {
    const original = new DOMException('disk full', 'QuotaExceededError');
    const harness = storageHarness({
      failures: {
        write: original,
        abort: new Error('abort also failed'),
        remove: new Error('remove also failed'),
      },
    });
    const sink = await opfsSink(harness);

    await expect(sink.write(new Blob(['chunk']))).rejects.toBe(original);
    await sink.discard();
    await sink.discard();

    expect(harness.writable.aborts).toBe(1);
    expect(harness.directory.removed).toEqual([
      'capture-10000-unitid.part',
    ]);
    expect(sink.kind).toBe('opfs');
  });

  for (const layer of ['close', 'getFile', 'size'] as const) {
    test(`${layer} failure rejects and removes the incomplete file`, async () => {
      const original = new Error(`${layer} failed`);
      const harness = storageHarness({
        failures: layer === 'close'
          ? { close: original }
          : layer === 'getFile'
            ? { getFile: original }
            : {},
        fixedSize: layer === 'size' ? 0 : undefined,
      });
      const sink = await opfsSink(harness);
      await sink.write(new Blob(['x']));

      if (layer === 'size') {
        await expect(sink.finalize('video/webm')).rejects.toThrow(
          'stored file size mismatch',
        );
      } else {
        await expect(sink.finalize('video/webm')).rejects.toBe(original);
      }

      expect(harness.writable.aborts).toBe(layer === 'close' ? 1 : 0);
      expect(harness.directory.removed).toEqual([
        'capture-10000-unitid.part',
      ]);
    });
  }

  test('removes only application temp files older than 24 hours', async () => {
    const now = 100_000_000;
    const harness = storageHarness();
    const old = new StaticFileHandle(
      'capture-old.part',
      now - VIDEO_CAPTURE_TEMP_MAX_AGE_MS - 1,
      harness.calls,
    );
    const boundary = new StaticFileHandle(
      'capture-boundary.part',
      now - VIDEO_CAPTURE_TEMP_MAX_AGE_MS,
      harness.calls,
    );
    const recent = new StaticFileHandle('capture-recent.part', now - 1, harness.calls);
    const unrelated = new StaticFileHandle('notes.txt', 0, harness.calls);
    const damaged = new StaticFileHandle('capture-damaged.part', 0, harness.calls, true);
    harness.directory.entriesByName.set(old.name, old);
    harness.directory.entriesByName.set(boundary.name, boundary);
    harness.directory.entriesByName.set(recent.name, recent);
    harness.directory.entriesByName.set(unrelated.name, unrelated);
    harness.directory.entriesByName.set(damaged.name, damaged);
    harness.directory.entriesByName.set('nested', harness.root);

    const sink = await prepareVideoChunkSink({
      expectedTicks: 60,
      storage: harness.storage,
      now: () => now,
      randomId: () => 'fresh',
    });

    expect(sink.kind).toBe('opfs');
    expect(harness.directory.removed).toEqual(['capture-old.part']);
    expect(harness.calls).not.toContain('getFile:notes.txt');
  });

  test('insufficient estimated quota uses memory only for a bounded export', async () => {
    const expectedBytes = estimateVideoCaptureBytes(60);
    const harness = storageHarness({
      estimate: {
        quota: expectedBytes + VIDEO_CAPTURE_STORAGE_RESERVE_BYTES - 1,
        usage: 0,
      },
    });

    const sink = await prepareVideoChunkSink({
      expectedTicks: 60,
      storage: harness.storage,
      memoryLimit: expectedBytes,
      now: () => 1,
      randomId: () => 'unused',
    });

    expect(sink.kind).toBe('memory');
    expect(harness.calls.some((call) => call.startsWith('getFileHandle:'))).toBe(false);

    await expect(prepareVideoChunkSink({
      expectedTicks: 60,
      storage: harness.storage,
      memoryLimit: expectedBytes - 1,
      now: () => 1,
      randomId: () => 'unused',
    })).rejects.toThrow('export stages individually');
  });

  test('missing or failed quota estimates still attempt OPFS', async () => {
    const missing = storageHarness({ omitEstimate: true });
    const failed = storageHarness({
      failures: { estimate: new Error('estimate unavailable') },
    });

    expect((await opfsSink(missing)).kind).toBe('opfs');
    expect((await opfsSink(failed)).kind).toBe('opfs');
    expect(failed.calls).toContain('estimate');
    expect(failed.calls.some((call) => call.startsWith('getFileHandle:'))).toBe(true);
  });

  for (const layer of [
    'getDirectory',
    'getDirectoryHandle',
    'getFileHandle',
    'createWritable',
  ] as const) {
    test(`${layer} setup failure falls back only below the memory limit`, async () => {
      const expectedBytes = estimateVideoCaptureBytes(60);
      const harness = storageHarness({
        failures: { [layer]: new Error(`${layer} failed`) },
      });

      const fallback = await prepareVideoChunkSink({
        expectedTicks: 60,
        storage: harness.storage,
        memoryLimit: expectedBytes,
        now: () => 2,
        randomId: () => 'failure',
      });
      expect(fallback.kind).toBe('memory');

      const rejected = storageHarness({
        failures: { [layer]: new Error(`${layer} failed`) },
      });
      await expect(prepareVideoChunkSink({
        expectedTicks: 60,
        storage: rejected.storage,
        memoryLimit: expectedBytes - 1,
        now: () => 2,
        randomId: () => 'failure',
      })).rejects.toThrow('export stages individually');

      if (layer === 'getFileHandle' || layer === 'createWritable') {
        expect(harness.directory.removed).toEqual([
          'capture-2-failure.part',
        ]);
      }
    });
  }

  test('without OPFS, the exact estimated-size boundary controls memory fallback', async () => {
    const expectedBytes = estimateVideoCaptureBytes(60);
    const unavailable: VideoStorageManager = {};

    expect((await prepareVideoChunkSink({
      expectedTicks: 60,
      storage: unavailable,
      memoryLimit: expectedBytes,
    })).kind).toBe('memory');
    await expect(prepareVideoChunkSink({
      expectedTicks: 60,
      storage: unavailable,
      memoryLimit: expectedBytes - 1,
    })).rejects.toThrow('export stages individually');
  });
});
