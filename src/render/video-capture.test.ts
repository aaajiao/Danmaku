import { describe, expect, test } from 'bun:test';

import type { FrameCapture } from './capture';
import {
  MemoryVideoChunkSink,
  ReplayVideoCapture,
  VIDEO_CAPTURE_FPS,
  VIDEO_CAPTURE_MEMORY_LIMIT_BYTES,
  VIDEO_CAPTURE_PENDING_WRITE_LIMIT_BYTES,
  VIDEO_CAPTURE_TIMESLICE_MS,
  VIDEO_MIME_CANDIDATES,
  type VideoChunkSink,
  type VideoCaptureGlobals,
  type VideoMediaRecorder,
  type VideoMediaRecorderConstructor,
  type VideoMediaStreamConstructor,
  unexpectedVideoCaptureEndError,
  videoExtensionForMime,
} from './video-capture';

class FakeTrack {
  stops = 0;
  readyState: MediaStreamTrackState = 'live';

  constructor(readonly kind: 'audio' | 'video') {}

  stop(): void {
    this.stops++;
    this.readyState = 'ended';
  }

  asTrack(): MediaStreamTrack {
    return this as unknown as MediaStreamTrack;
  }
}

function streamOf(tracks: readonly FakeTrack[]): MediaStream {
  const values = tracks.map((track) => track.asTrack());
  return {
    getTracks: () => [...values],
    getAudioTracks: () => values.filter((track) => track.kind === 'audio'),
    getVideoTracks: () => values.filter((track) => track.kind === 'video'),
  } as unknown as MediaStream;
}

interface RecorderAttempt {
  readonly mimeType: string | undefined;
  readonly options: MediaRecorderOptions;
}

interface RecorderHarnessOptions {
  readonly supported?: (mimeType: string) => boolean;
  readonly failConstruction?: ReadonlySet<string | undefined>;
  readonly failStart?: ReadonlySet<string | undefined>;
  readonly actualMime?: (requested: string | undefined) => string;
}

class FakeRecorder implements VideoMediaRecorder {
  readonly stream: MediaStream;
  readonly options: MediaRecorderOptions;
  readonly requestedMimeType: string | undefined;
  readonly mimeType: string;
  state = 'inactive';
  ondataavailable: ((event: { readonly data: Blob }) => void) | null = null;
  onstop: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  starts = 0;
  stops = 0;
  timeslice: number | undefined;
  failStart = false;

  constructor(
    stream: MediaStream,
    options: MediaRecorderOptions,
    actualMime: string,
  ) {
    this.stream = stream;
    this.options = options;
    this.requestedMimeType = options.mimeType;
    this.mimeType = actualMime;
  }

  start(timeslice?: number): void {
    this.starts++;
    this.timeslice = timeslice;
    if (this.failStart) throw new Error(`start refused for ${String(this.requestedMimeType)}`);
    this.state = 'recording';
  }

  stop(): void {
    this.stops++;
    this.state = 'inactive';
  }

  emitData(data: Blob): void {
    this.ondataavailable?.({ data });
  }

  emitStop(): void {
    this.onstop?.({ type: 'stop' } as Event);
  }

  emitError(error: Error): void {
    this.onerror?.({ type: 'error', error } as unknown as Event);
  }
}

interface RecorderHarness {
  readonly globals: VideoCaptureGlobals;
  readonly attempts: RecorderAttempt[];
  readonly recorders: FakeRecorder[];
  readonly streams: MediaStream[];
  readonly supportChecks: string[];
}

function recorderHarness(options: RecorderHarnessOptions = {}): RecorderHarness {
  const attempts: RecorderAttempt[] = [];
  const recorders: FakeRecorder[] = [];
  const streams: MediaStream[] = [];
  const supportChecks: string[] = [];

  class HarnessStream {
    readonly #tracks: MediaStreamTrack[];

    constructor(tracks: MediaStreamTrack[] = []) {
      this.#tracks = [...tracks];
      streams.push(this as unknown as MediaStream);
    }

    getTracks(): MediaStreamTrack[] {
      return [...this.#tracks];
    }

    getAudioTracks(): MediaStreamTrack[] {
      return this.#tracks.filter((track) => track.kind === 'audio');
    }

    getVideoTracks(): MediaStreamTrack[] {
      return this.#tracks.filter((track) => track.kind === 'video');
    }
  }

  class HarnessRecorder {
    static isTypeSupported(mimeType: string): boolean {
      supportChecks.push(mimeType);
      return options.supported?.(mimeType) ?? true;
    }

    constructor(stream: MediaStream, init: MediaRecorderOptions = {}) {
      const requested = init.mimeType;
      attempts.push({ mimeType: requested, options: { ...init } });
      if (options.failConstruction?.has(requested)) {
        throw new Error(`constructor refused for ${String(requested)}`);
      }
      const recorder = new FakeRecorder(
        stream,
        init,
        options.actualMime?.(requested) ?? requested ?? 'video/webm',
      );
      recorder.failStart = options.failStart?.has(requested) ?? false;
      recorders.push(recorder);
      return recorder;
    }
  }

  return {
    globals: {
      MediaRecorder: HarnessRecorder as unknown as VideoMediaRecorderConstructor,
      MediaStream: HarnessStream as unknown as VideoMediaStreamConstructor,
    },
    attempts,
    recorders,
    streams,
    supportChecks,
  };
}

interface CanvasFixture {
  readonly frame: Pick<FrameCapture, 'canvas'>;
  readonly video: FakeTrack;
  readonly rates: number[];
}

function canvasFixture(extraTracks: readonly FakeTrack[] = []): CanvasFixture {
  const video = new FakeTrack('video');
  const rates: number[] = [];
  const stream = streamOf([video, ...extraTracks]);
  const canvas = {
    captureStream(rate?: number): MediaStream {
      if (rate !== undefined) rates.push(rate);
      return stream;
    },
  } as unknown as HTMLCanvasElement;
  return { frame: { canvas }, video, rates };
}

function lastRecorder(harness: RecorderHarness): FakeRecorder {
  const recorder = harness.recorders.at(-1);
  if (recorder === undefined) throw new Error('test: no recorder was constructed');
  return recorder;
}

function assertRecorded(
  outcome: Awaited<ReturnType<ReplayVideoCapture['stop']>>,
): asserts outcome is Extract<typeof outcome, { status: 'recorded' }> {
  expect(outcome.status).toBe('recorded');
  if (outcome.status !== 'recorded') {
    throw new Error(`test: expected recorded outcome, got ${outcome.status}`);
  }
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function flushUntil(predicate: () => boolean): Promise<void> {
  for (let turn = 0; turn < 20; turn++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('test: promise chain did not advance');
}

class FakeChunkSink implements VideoChunkSink {
  readonly kind = 'memory' as const;
  readonly calls: string[] = [];
  readonly chunks: Blob[] = [];
  readonly writeWaits: Deferred<void>[] = [];
  finalizeError: Error | undefined;
  finalizeWait: Deferred<void> | undefined;
  discardError: Error | undefined;
  discards = 0;
  writesStarted = 0;

  async write(chunk: Blob): Promise<void> {
    this.calls.push(`write:${++this.writesStarted}`);
    const wait = this.writeWaits.shift();
    if (wait !== undefined) await wait.promise;
    this.chunks.push(chunk);
  }

  async finalize(mimeType: string): Promise<Blob> {
    this.calls.push('finalize');
    if (this.finalizeWait !== undefined) await this.finalizeWait.promise;
    if (this.finalizeError !== undefined) throw this.finalizeError;
    return new Blob(this.chunks, { type: mimeType });
  }

  async discard(): Promise<void> {
    this.calls.push('discard');
    this.discards++;
    if (this.discardError !== undefined) throw this.discardError;
    this.chunks.length = 0;
  }
}

describe('ReplayVideoCapture', () => {
  test('serializes writes and waits for the final chunk before finalizing', async () => {
    const harness = recorderHarness();
    const sink = new FakeChunkSink();
    const headWritten = deferred<void>();
    const tailWritten = deferred<void>();
    sink.writeWaits.push(headWritten, tailWritten);
    const capture = new ReplayVideoCapture(canvasFixture().frame, {
      globals: harness.globals,
      sink,
    });
    expect(capture.start()).toBe(true);
    const recorder = lastRecorder(harness);

    recorder.emitData(new Blob(['head'], { type: 'video/webm' }));
    await Promise.resolve();
    expect(sink.calls).toEqual(['write:1']);
    recorder.emitData(new Blob(['tail'], { type: 'video/webm' }));
    const completion = capture.stop();
    recorder.emitStop();
    await Promise.resolve();
    expect(sink.calls).toEqual(['write:1']);

    headWritten.resolve();
    await flushUntil(() => sink.calls.length === 2);
    expect(sink.calls).toEqual(['write:1', 'write:2']);
    expect(capture.state).toBe('stopping');

    tailWritten.resolve();
    const outcome = await completion;
    assertRecorded(outcome);
    expect(await outcome.blob.text()).toBe('headtail');
    expect(sink.calls).toEqual(['write:1', 'write:2', 'finalize']);
    expect(sink.discards).toBe(0);
  });

  test('cancel ignores its final recorder chunk and waits for prior writes before discard', async () => {
    const harness = recorderHarness();
    const sink = new FakeChunkSink();
    const headWritten = deferred<void>();
    sink.writeWaits.push(headWritten);
    const capture = new ReplayVideoCapture(canvasFixture().frame, {
      globals: harness.globals,
      sink,
    });
    expect(capture.start()).toBe(true);
    const recorder = lastRecorder(harness);
    recorder.emitData(new Blob(['keep-until-discard'], { type: 'video/webm' }));
    await Promise.resolve();

    const completion = capture.cancel();
    recorder.emitData(new Blob(['ignored-final'], { type: 'video/webm' }));
    recorder.emitStop();
    await Promise.resolve();
    expect(sink.calls).toEqual(['write:1']);

    headWritten.resolve();
    expect(await completion).toEqual({ status: 'cancelled' });
    expect(sink.calls).toEqual(['write:1', 'discard']);
    expect(sink.discards).toBe(1);
  });

  test('cancel supersedes a requested stop before the recorder stop event', async () => {
    const harness = recorderHarness();
    const sink = new FakeChunkSink();
    const capture = new ReplayVideoCapture(canvasFixture().frame, {
      globals: harness.globals,
      sink,
    });
    expect(capture.start()).toBe(true);
    const recorder = lastRecorder(harness);
    recorder.emitData(new Blob(['head'], { type: 'video/webm' }));

    const completion = capture.stop();
    expect(capture.cancel()).toBe(completion);
    recorder.emitData(new Blob(['ignored-final'], { type: 'video/webm' }));
    recorder.emitStop();

    expect(await completion).toEqual({ status: 'cancelled' });
    expect(sink.calls).toEqual(['write:1', 'discard']);
    expect(sink.calls).not.toContain('finalize');
  });

  test('cancel during pending finalize discards the completed artifact', async () => {
    const harness = recorderHarness();
    const sink = new FakeChunkSink();
    const finalizeWait = deferred<void>();
    sink.finalizeWait = finalizeWait;
    const capture = new ReplayVideoCapture(canvasFixture().frame, {
      globals: harness.globals,
      sink,
    });
    expect(capture.start()).toBe(true);
    const recorder = lastRecorder(harness);
    recorder.emitData(new Blob(['complete'], { type: 'video/webm' }));

    const completion = capture.stop();
    recorder.emitStop();
    await flushUntil(() => sink.calls.includes('finalize'));
    expect(capture.cancel()).toBe(completion);
    finalizeWait.resolve();

    expect(await completion).toEqual({ status: 'cancelled' });
    expect(sink.calls).toEqual(['write:1', 'finalize', 'discard']);
    expect(sink.discards).toBe(1);
  });

  test('a sink write failure stops the recorder, discards once, and wins over late events', async () => {
    const harness = recorderHarness();
    const sink = new FakeChunkSink();
    const refused = deferred<void>();
    sink.writeWaits.push(refused);
    const capture = new ReplayVideoCapture(canvasFixture().frame, {
      globals: harness.globals,
      sink,
    });
    expect(capture.start()).toBe(true);
    const recorder = lastRecorder(harness);
    recorder.emitData(new Blob(['chunk'], { type: 'video/webm' }));
    await Promise.resolve();
    recorder.emitData(new Blob(['queued-after-failing-write'], { type: 'video/webm' }));
    refused.reject(new Error('disk full'));

    const outcome = await capture.completion;
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.error.message).toBe('disk full');
    expect(recorder.stops).toBe(1);
    expect(sink.writesStarted).toBe(1);
    expect(sink.discards).toBe(1);

    recorder.emitData(new Blob(['late'], { type: 'video/webm' }));
    recorder.emitStop();
    recorder.emitError(new Error('late encoder error'));
    expect(sink.discards).toBe(1);
  });

  test('bounds queued and in-flight encoded Blobs while preserving the exact boundary', async () => {
    expect(VIDEO_CAPTURE_PENDING_WRITE_LIMIT_BYTES).toBe(32 * 1024 * 1024);
    const harness = recorderHarness();
    const sink = new FakeChunkSink();
    const headWritten = deferred<void>();
    sink.writeWaits.push(headWritten);
    const capture = new ReplayVideoCapture(canvasFixture().frame, {
      globals: harness.globals,
      sink,
      pendingWriteLimitBytes: 8,
    });
    expect(capture.start()).toBe(true);
    const recorder = lastRecorder(harness);

    recorder.emitData(new Blob(['1234'], { type: 'video/webm' }));
    await Promise.resolve();
    recorder.emitData(new Blob(['5678'], { type: 'video/webm' }));
    expect(recorder.stops).toBe(0);
    recorder.emitData(new Blob(['9'], { type: 'video/webm' }));
    expect(recorder.stops).toBe(1);
    expect(sink.writesStarted).toBe(1);

    headWritten.resolve();
    const outcome = await capture.completion;
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error.message).toMatch(/pending encoded data exceeded/);
    }
    expect(sink.writesStarted).toBe(1);
    expect(sink.discards).toBe(1);
  });

  test('a finalize failure discards the stored chunks and returns the original error', async () => {
    const harness = recorderHarness();
    const sink = new FakeChunkSink();
    sink.finalizeError = new Error('close refused');
    const capture = new ReplayVideoCapture(canvasFixture().frame, {
      globals: harness.globals,
      sink,
    });
    expect(capture.start()).toBe(true);
    const recorder = lastRecorder(harness);
    recorder.emitData(new Blob(['chunk'], { type: 'video/webm' }));
    const completion = capture.stop();
    recorder.emitStop();

    const outcome = await completion;
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.error.message).toBe('close refused');
    expect(sink.calls).toEqual(['write:1', 'finalize', 'discard']);
    expect(sink.discards).toBe(1);
  });

  test('an unexpected recorder stop fails directly and never finalizes a partial file', async () => {
    const harness = recorderHarness();
    const sink = new FakeChunkSink();
    const capture = new ReplayVideoCapture(canvasFixture().frame, {
      globals: harness.globals,
      sink,
    });
    expect(capture.start()).toBe(true);
    const recorder = lastRecorder(harness);
    recorder.emitData(new Blob(['partial'], { type: 'video/webm' }));
    recorder.emitStop();

    const outcome = await capture.completion;
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error.message).toMatch(/stopped before replay completed/);
    }
    expect(sink.calls).toEqual(['write:1', 'discard']);
    expect(sink.calls).not.toContain('finalize');
  });

  test('a start failure discards its prepared sink exactly once', async () => {
    const sink = new FakeChunkSink();
    const capture = new ReplayVideoCapture(canvasFixture().frame, {
      globals: {},
      sink,
    });

    expect(capture.start()).toBe(false);
    const outcome = await capture.completion;
    expect(outcome.status).toBe('failed');
    expect(sink.calls).toEqual(['discard']);
  });

  test('MediaRecorder.start exhaustion also discards its prepared sink once', async () => {
    const sink = new FakeChunkSink();
    const harness = recorderHarness({
      failStart: new Set<string | undefined>([
        ...VIDEO_MIME_CANDIDATES,
        undefined,
      ]),
    });
    const capture = new ReplayVideoCapture(canvasFixture().frame, {
      globals: harness.globals,
      sink,
    });

    expect(capture.start()).toBe(false);
    const outcome = await capture.completion;
    expect(outcome.status).toBe('failed');
    expect(harness.attempts).toHaveLength(VIDEO_MIME_CANDIDATES.length + 1);
    expect(sink.discards).toBe(1);
  });

  test('records the composited canvas plus one mixed audio track at 60fps', async () => {
    const canvas = canvasFixture();
    const audio = new FakeTrack('audio');
    const harness = recorderHarness();
    const capture = new ReplayVideoCapture(canvas.frame, {
      audioStream: streamOf([audio]),
      requireAudio: true,
      globals: harness.globals,
    });

    expect(capture.start()).toBe(true);
    expect(capture.start()).toBe(true);
    expect(canvas.rates).toEqual([VIDEO_CAPTURE_FPS]);
    expect(harness.attempts).toHaveLength(1);

    const recorder = lastRecorder(harness);
    expect(recorder.stream.getVideoTracks()).toHaveLength(1);
    expect(recorder.stream.getAudioTracks()).toHaveLength(1);
    expect(recorder.timeslice).toBe(VIDEO_CAPTURE_TIMESLICE_MS);
    expect(recorder.options.videoBitsPerSecond).toBe(4_000_000);
    expect(recorder.options.audioBitsPerSecond).toBe(128_000);

    recorder.emitData(new Blob(['head'], { type: 'video/webm' }));
    const first = capture.stop();
    const second = capture.stop();
    expect(second).toBe(first);
    expect(recorder.stops).toBe(1);

    // MediaRecorder emits one last dataavailable after stop() and before stop.
    recorder.emitData(new Blob(['tail'], { type: 'video/webm' }));
    recorder.emitStop();
    const outcome = await first;
    assertRecorded(outcome);
    expect(outcome.extension).toBe('webm');
    expect(outcome.mimeType).toBe('video/webm');
    expect(await outcome.blob.text()).toBe('headtail');
    expect(canvas.video.stops).toBe(1);
    expect(audio.stops).toBe(1);
  });

  test('tries codec/container candidates in order, then omitted MIME', async () => {
    const allExplicit = new Set<string | undefined>(VIDEO_MIME_CANDIDATES);
    const failStart = new Set<string | undefined>([VIDEO_MIME_CANDIDATES[1]]);
    const harness = recorderHarness({
      failConstruction: new Set(
        [...allExplicit].filter((mime) => mime !== VIDEO_MIME_CANDIDATES[1]),
      ),
      failStart,
      actualMime: (requested) => requested ?? 'video/mp4',
    });
    const canvas = canvasFixture();
    const capture = new ReplayVideoCapture(canvas.frame, { globals: harness.globals });

    expect(capture.start()).toBe(true);
    expect(harness.attempts.map((attempt) => attempt.mimeType)).toEqual([
      ...VIDEO_MIME_CANDIDATES,
      undefined,
    ]);
    expect(harness.recorders[0]?.ondataavailable).toBeNull();
    expect(lastRecorder(harness).requestedMimeType).toBeUndefined();

    const done = capture.stop();
    lastRecorder(harness).emitData(new Blob(['mp4'], { type: 'video/mp4' }));
    lastRecorder(harness).emitStop();
    const outcome = await done;
    assertRecorded(outcome);
    expect(outcome.extension).toBe('mp4');
    expect(outcome.blob.type).toBe('video/mp4');
    expect(canvas.video.stops).toBe(1);
  });

  test('skips explicitly unsupported MIME candidates', () => {
    const harness = recorderHarness({
      supported: (mime) => mime === 'video/mp4',
    });
    const capture = new ReplayVideoCapture(canvasFixture().frame, {
      globals: harness.globals,
    });

    expect(capture.start()).toBe(true);
    expect(harness.attempts.map((attempt) => attempt.mimeType)).toEqual(['video/mp4']);
    expect(harness.supportChecks).toEqual([...VIDEO_MIME_CANDIDATES]);
    void capture.cancel();
    lastRecorder(harness).emitStop();
  });

  test('uses emitted MIME, not the requested candidate, for extension and Blob', async () => {
    const harness = recorderHarness({
      actualMime: () => 'video/webm;codecs=vp9,opus',
    });
    const capture = new ReplayVideoCapture(canvasFixture().frame, {
      globals: harness.globals,
    });
    expect(capture.start()).toBe(true);

    const done = capture.stop();
    lastRecorder(harness).emitData(new Blob(['actual'], {
      type: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    }));
    lastRecorder(harness).emitStop();
    const outcome = await done;
    assertRecorded(outcome);
    expect(outcome.mimeType).toBe('video/mp4;codecs=avc1.42e01e,mp4a.40.2');
    expect(outcome.extension).toBe('mp4');
    expect(outcome.blob.type).toBe('video/mp4;codecs=avc1.42e01e,mp4a.40.2');
  });

  test('an encoder that emits no bytes fails instead of downloading an empty file', async () => {
    const harness = recorderHarness();
    const capture = new ReplayVideoCapture(canvasFixture().frame, {
      globals: harness.globals,
    });
    expect(capture.start()).toBe(true);

    const done = capture.stop();
    lastRecorder(harness).emitData(new Blob([], { type: 'video/webm' }));
    lastRecorder(harness).emitStop();
    const outcome = await done;
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error.message).toMatch(/no video data/);
    }
  });

  test('cancel is idempotent, discards chunks, and cleans every track once', async () => {
    const canvasExtra = new FakeTrack('audio');
    const canvas = canvasFixture([canvasExtra]);
    const audio = new FakeTrack('audio');
    const harness = recorderHarness();
    const capture = new ReplayVideoCapture(canvas.frame, {
      audioStream: streamOf([audio]),
      globals: harness.globals,
    });
    expect(capture.start()).toBe(true);
    const recorder = lastRecorder(harness);
    recorder.emitData(new Blob(['discard me'], { type: 'video/webm' }));

    const first = capture.cancel();
    const second = capture.cancel();
    expect(second).toBe(first);
    expect(recorder.stops).toBe(1);
    // Mirrors the shell releasing its mixed-audio route before MediaRecorder
    // later emits stop. Controller cleanup must not stop that track twice.
    audio.stop();
    recorder.emitData(new Blob(['final discard'], { type: 'video/webm' }));
    recorder.emitStop();

    expect(await first).toEqual({ status: 'cancelled' });
    expect(capture.state).toBe('cancelled');
    expect(canvas.video.stops).toBe(1);
    expect(canvasExtra.stops).toBe(1);
    expect(audio.stops).toBe(1);
    recorder.emitStop();
    expect(canvas.video.stops).toBe(1);
  });

  test('MediaRecorder error wins, settles once, and tears tracks down', async () => {
    const canvas = canvasFixture();
    const audio = new FakeTrack('audio');
    const harness = recorderHarness();
    const sink = new FakeChunkSink();
    const capture = new ReplayVideoCapture(canvas.frame, {
      audioStream: streamOf([audio]),
      globals: harness.globals,
      sink,
    });
    expect(capture.start()).toBe(true);
    const recorder = lastRecorder(harness);
    recorder.stop = function stopSynchronously(): void {
      this.stops++;
      this.state = 'inactive';
      this.emitStop();
    };

    recorder.emitError(new Error('encoder vanished'));
    const outcome = await capture.completion;
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error.message).toBe('encoder vanished');
    }
    expect(capture.state).toBe('failed');
    expect(sink.discards).toBe(1);
    expect(canvas.video.stops).toBe(1);
    expect(audio.stops).toBe(1);

    recorder.emitError(new Error('late error'));
    recorder.emitData(new Blob(['late'], { type: 'video/webm' }));
    recorder.emitStop();
    expect(canvas.video.stops).toBe(1);
    expect(audio.stops).toBe(1);
  });

  test('required audio refuses silence and cleans the canvas stream', async () => {
    const canvas = canvasFixture();
    const harness = recorderHarness();
    const capture = new ReplayVideoCapture(canvas.frame, {
      requireAudio: true,
      globals: harness.globals,
    });

    expect(capture.start()).toBe(false);
    const outcome = await capture.completion;
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error.message).toMatch(/mixed audio track is required/);
    }
    expect(harness.attempts).toHaveLength(0);
    expect(canvas.video.stops).toBe(1);
  });

  test('refuses an unmixed multi-track audio stream and cleans all tracks', async () => {
    const canvas = canvasFixture();
    const audioA = new FakeTrack('audio');
    const audioB = new FakeTrack('audio');
    const harness = recorderHarness();
    const capture = new ReplayVideoCapture(canvas.frame, {
      audioStream: streamOf([audioA, audioB]),
      globals: harness.globals,
    });

    expect(capture.start()).toBe(false);
    const outcome = await capture.completion;
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error.message).toMatch(/at most one audio track/);
    }
    expect(canvas.video.stops).toBe(1);
    expect(audioA.stops).toBe(1);
    expect(audioB.stops).toBe(1);
  });

  test('missing browser APIs fail without throwing into the caller', async () => {
    const canvas = canvasFixture();
    const capture = new ReplayVideoCapture(canvas.frame, { globals: {} });

    expect(capture.start()).toBe(false);
    const outcome = await capture.completion;
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error.message).toMatch(/MediaRecorder is unavailable/);
    }
    expect(canvas.rates).toEqual([]);
    expect(canvas.video.stops).toBe(0);
  });

  test('stop before start is a stable failure and never starts later', async () => {
    const harness = recorderHarness();
    const canvas = canvasFixture();
    const capture = new ReplayVideoCapture(canvas.frame, {
      globals: harness.globals,
    });

    const first = capture.stop();
    const second = capture.cancel();
    expect(second).toBe(first);
    const outcome = await first;
    expect(outcome.status).toBe('failed');
    expect(capture.start()).toBe(false);
    expect(canvas.rates).toEqual([]);
  });

  test('unknown actual MIME fails instead of inventing an extension', async () => {
    const canvas = canvasFixture();
    const harness = recorderHarness({ actualMime: () => 'video/ogg' });
    const capture = new ReplayVideoCapture(canvas.frame, {
      globals: harness.globals,
    });
    expect(capture.start()).toBe(true);

    const done = capture.stop();
    lastRecorder(harness).emitData(new Blob(['ogg'], { type: 'video/ogg' }));
    lastRecorder(harness).emitStop();
    const outcome = await done;
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error.message).toMatch(/unsupported recorded MIME type/);
    }
    expect(canvas.video.stops).toBe(1);
  });
});

describe('MemoryVideoChunkSink', () => {
  test('accepts the exact hard boundary and preserves chunk order', async () => {
    const sink = new MemoryVideoChunkSink(8);
    await sink.write(new Blob(['head']));
    await sink.write(new Blob(['tail']));
    const blob = await sink.finalize('video/webm');
    expect(blob.size).toBe(8);
    expect(blob.type).toBe('video/webm');
    expect(await blob.text()).toBe('headtail');
  });

  test('rejects the first chunk beyond the configured memory limit', async () => {
    expect(VIDEO_CAPTURE_MEMORY_LIMIT_BYTES).toBe(128 * 1024 * 1024);
    const sink = new MemoryVideoChunkSink(4);
    await sink.write(new Blob(['1234']));
    await expect(sink.write(new Blob(['5']))).rejects.toThrow(/memory limit/);
    await sink.discard();
    await sink.discard();
  });
});

describe('videoExtensionForMime', () => {
  test('maps only actual WebM and MP4 MIME essences', () => {
    expect(videoExtensionForMime('video/webm;codecs=vp8,opus')).toBe('webm');
    expect(videoExtensionForMime(' VIDEO/MP4 ; codecs=avc1 ')).toBe('mp4');
    expect(videoExtensionForMime('video/ogg')).toBeUndefined();
    expect(videoExtensionForMime('')).toBeUndefined();
  });
});

describe('unexpectedVideoCaptureEndError', () => {
  test('rejects a recorder-produced Blob when shutdown was not requested', () => {
    const error = unexpectedVideoCaptureEndError({
      status: 'recorded',
      blob: new Blob(['truncated'], { type: 'video/webm' }),
      mimeType: 'video/webm',
      extension: 'webm',
    });
    expect(error.message).toMatch(/stopped before replay completed/);
  });

  test('preserves encoder failures and labels cancellation', () => {
    const encoderError = new Error('encoder fault');
    expect(unexpectedVideoCaptureEndError({
      status: 'failed',
      error: encoderError,
    })).toBe(encoderError);
    expect(unexpectedVideoCaptureEndError({
      status: 'cancelled',
    }).message).toMatch(/recording was cancelled/);
  });
});
