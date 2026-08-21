/**
 * Real-time video recording of the already-composited authored frame.
 *
 * `FrameCapture` owns the 480×640 canvas that combines the WebGL field and the
 * Canvas2D overlay. This class records that canvas; it never reaches back into
 * either renderer, and it never asks for the screen or a browser tab.
 *
 * MediaRecorder is deliberately treated as a negotiated browser capability:
 * container/codec support differs between engines, and even a type reported by
 * `isTypeSupported` may still fail at construction or start. The successful
 * recorder and its emitted chunks are the authority for the result's MIME type
 * and filename extension.
 *
 * One instance is one attempt. Every terminal path owns and stops all canvas and
 * supplied-audio tracks exactly once. The caller should therefore pass a
 * dedicated mixed-audio capture stream, not an application-lifetime stream.
 */

import type { FrameCapture } from './capture';

export const VIDEO_CAPTURE_FPS = 60;
export const VIDEO_CAPTURE_TIMESLICE_MS = 1000;
export const VIDEO_CAPTURE_BITRATE = 4_000_000;
export const AUDIO_CAPTURE_BITRATE = 128_000;
export const VIDEO_CAPTURE_MEMORY_LIMIT_BYTES = 128 * 1024 * 1024;
export const VIDEO_CAPTURE_PENDING_WRITE_LIMIT_BYTES = 32 * 1024 * 1024;

export const VIDEO_MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
] as const;

export type VideoExtension = 'webm' | 'mp4';

export interface RecordedVideo {
  readonly status: 'recorded';
  readonly blob: Blob;
  readonly mimeType: string;
  readonly extension: VideoExtension;
}

export interface CancelledVideoCapture {
  readonly status: 'cancelled';
}

export interface FailedVideoCapture {
  readonly status: 'failed';
  readonly error: Error;
}

export type VideoCaptureOutcome =
  | RecordedVideo
  | CancelledVideoCapture
  | FailedVideoCapture;

/**
 * Destination for the recorder's ordered `dataavailable` chunks.
 *
 * The capture controller serializes every call. Implementations may therefore
 * stream each Blob to durable browser storage without retaining the complete
 * recording in JavaScript memory. `discard` is idempotent and remains valid
 * after `finalize`, so a caller can remove an artifact it later rejects.
 */
export interface VideoChunkSink {
  readonly kind: 'memory' | 'opfs';
  write(chunk: Blob): Promise<void>;
  finalize(mimeType: string): Promise<Blob>;
  discard(): Promise<void>;
}

/** Bounded fallback for browsers where origin-private file storage is absent. */
export class MemoryVideoChunkSink implements VideoChunkSink {
  readonly kind = 'memory' as const;

  readonly #limitBytes: number;
  #chunks: Blob[] = [];
  #size = 0;
  #terminal = false;

  constructor(limitBytes = VIDEO_CAPTURE_MEMORY_LIMIT_BYTES) {
    if (!Number.isFinite(limitBytes) || limitBytes <= 0) {
      throw new Error('video capture: memory limit must be a positive finite number');
    }
    this.#limitBytes = Math.floor(limitBytes);
  }

  async write(chunk: Blob): Promise<void> {
    if (this.#terminal) {
      throw new Error('video capture: chunk sink is already closed');
    }
    if (chunk.size > this.#limitBytes - this.#size) {
      throw new Error(
        `video capture: recording exceeded the ${formatMemoryLimit(this.#limitBytes)} memory limit`,
      );
    }
    this.#chunks.push(chunk);
    this.#size += chunk.size;
  }

  async finalize(mimeType: string): Promise<Blob> {
    if (this.#terminal) {
      throw new Error('video capture: chunk sink is already closed');
    }
    this.#terminal = true;
    const chunks = this.#chunks;
    this.#chunks = [];
    return new Blob(chunks, { type: mimeType });
  }

  async discard(): Promise<void> {
    this.#terminal = true;
    this.#chunks = [];
    this.#size = 0;
  }
}

/**
 * Convert a terminal recorder event that arrived before the caller requested
 * shutdown into the export failure it represents. A non-empty Blob is not proof
 * of success here: an encoder can stop itself halfway through a replay.
 */
export function unexpectedVideoCaptureEndError(
  outcome: VideoCaptureOutcome,
): Error {
  if (outcome.status === 'failed') return outcome.error;
  if (outcome.status === 'recorded') {
    return new Error('video export: recorder stopped before replay completed');
  }
  return new Error('video export: recording was cancelled');
}

export type VideoCaptureState =
  | 'idle'
  | 'recording'
  | 'stopping'
  | 'recorded'
  | 'cancelled'
  | 'failed';

/**
 * The smallest MediaRecorder surface the controller needs.
 *
 * Kept structural so Bun tests can inject a deterministic fake without
 * pretending to implement unrelated browser properties.
 */
export interface VideoMediaRecorder {
  readonly mimeType: string;
  readonly state: string;
  ondataavailable: ((event: { readonly data: Blob }) => void) | null;
  onstop: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  start(timeslice?: number): void;
  stop(): void;
}

export interface VideoMediaRecorderConstructor {
  new(stream: MediaStream, options?: MediaRecorderOptions): VideoMediaRecorder;
  isTypeSupported?(mimeType: string): boolean;
}

export interface VideoMediaStreamConstructor {
  new(tracks?: MediaStreamTrack[]): MediaStream;
}

/** Browser globals are injectable because Bun deliberately has neither API. */
export interface VideoCaptureGlobals {
  readonly MediaRecorder?: VideoMediaRecorderConstructor;
  readonly MediaStream?: VideoMediaStreamConstructor;
}

export interface VideoCaptureOptions {
  /**
   * A dedicated stream containing zero or one already-mixed audio track.
   *
   * Its tracks become this controller's responsibility and are stopped on every
   * terminal path. More than one audio track is refused: MediaRecorder is not a
   * mixer, so callers must combine SFX and music before this boundary.
   */
  readonly audioStream?: MediaStream;
  /** Refuse to start silently when no mixed audio track is available. */
  readonly requireAudio?: boolean;
  readonly timesliceMs?: number;
  readonly videoBitsPerSecond?: number;
  readonly audioBitsPerSecond?: number;
  /** Maximum encoded bytes waiting for their sink writes to finish. */
  readonly pendingWriteLimitBytes?: number;
  /** Prepared chunk destination; ownership transfers to this capture attempt. */
  readonly sink?: VideoChunkSink;
  readonly globals?: VideoCaptureGlobals;
}

type TerminalIntent = 'stop' | 'cancel';

export class ReplayVideoCapture {
  readonly completion: Promise<VideoCaptureOutcome>;

  readonly #frame: Pick<FrameCapture, 'canvas'>;
  readonly #audioStream: MediaStream | undefined;
  readonly #requireAudio: boolean;
  readonly #timesliceMs: number;
  readonly #videoBitsPerSecond: number;
  readonly #audioBitsPerSecond: number;
  readonly #pendingWriteLimitBytes: number;
  readonly #sink: VideoChunkSink;
  readonly #globals: VideoCaptureGlobals;

  readonly #tracks = new Set<MediaStreamTrack>();

  #resolveCompletion!: (outcome: VideoCaptureOutcome) => void;
  #state: VideoCaptureState = 'idle';
  #recorder: VideoMediaRecorder | undefined;
  #selectedMimeType: string | undefined;
  #intent: TerminalIntent | undefined;
  #settled: VideoCaptureOutcome | undefined;
  #writeQueue: Promise<void> = Promise.resolve();
  #writeError: Error | undefined;
  #bytesReceived = 0;
  #pendingWriteBytes = 0;
  #lastChunkMimeType: string | undefined;
  #terminalizing = false;
  #cleaned = false;

  constructor(
    frame: Pick<FrameCapture, 'canvas'>,
    options: VideoCaptureOptions = {},
  ) {
    this.#frame = frame;
    this.#audioStream = options.audioStream;
    this.#requireAudio = options.requireAudio ?? false;
    this.#timesliceMs = positiveFinite(
      options.timesliceMs,
      VIDEO_CAPTURE_TIMESLICE_MS,
    );
    this.#videoBitsPerSecond = positiveFinite(
      options.videoBitsPerSecond,
      VIDEO_CAPTURE_BITRATE,
    );
    this.#audioBitsPerSecond = positiveFinite(
      options.audioBitsPerSecond,
      AUDIO_CAPTURE_BITRATE,
    );
    this.#pendingWriteLimitBytes = positiveFinite(
      options.pendingWriteLimitBytes,
      VIDEO_CAPTURE_PENDING_WRITE_LIMIT_BYTES,
    );
    this.#sink = options.sink ?? new MemoryVideoChunkSink();
    this.#globals = options.globals ?? browserGlobals();
    this.completion = new Promise((resolve) => {
      this.#resolveCompletion = resolve;
    });
  }

  get state(): VideoCaptureState {
    return this.#state;
  }

  /**
   * Begin recording. Repeated calls never create another stream or recorder.
   *
   * Returns false after any terminal result, or when setup failed. The failure
   * itself is available through `completion`; browser capability errors never
   * escape into the render loop.
   */
  start(): boolean {
    if (this.#state !== 'idle') return this.#state === 'recording';

    try {
      const Recorder = this.#globals.MediaRecorder;
      const Stream = this.#globals.MediaStream;
      if (Recorder === undefined) {
        throw new Error('video capture: MediaRecorder is unavailable');
      }
      if (Stream === undefined) {
        throw new Error('video capture: MediaStream is unavailable');
      }

      const canvasStream = captureCanvas(this.#frame.canvas);
      this.#own(canvasStream.getTracks());

      const videoTracks = canvasStream.getVideoTracks();
      if (videoTracks.length !== 1) {
        throw new Error(
          `video capture: canvas must provide exactly one video track, got ${videoTracks.length}`,
        );
      }

      const audioTracks = this.#audioStream?.getAudioTracks() ?? [];
      if (this.#audioStream !== undefined) {
        this.#own(this.#audioStream.getTracks());
        const unexpectedVideo = this.#audioStream.getVideoTracks().length;
        if (unexpectedVideo > 0) {
          throw new Error(
            `video capture: mixed audio stream contains ${unexpectedVideo} video track(s)`,
          );
        }
      }
      if (audioTracks.length > 1) {
        throw new Error(
          `video capture: mixed audio stream must contain at most one audio track, got ${audioTracks.length}`,
        );
      }
      if (this.#requireAudio && audioTracks.length !== 1) {
        throw new Error('video capture: one mixed audio track is required');
      }

      const output = new Stream([
        videoTracks[0] as MediaStreamTrack,
        ...(audioTracks[0] === undefined ? [] : [audioTracks[0]]),
      ]);

      const selected = this.#startRecorder(Recorder, output, audioTracks.length === 1);
      if (this.#settled !== undefined || this.#terminalizing) return false;
      this.#recorder = selected.recorder;
      this.#selectedMimeType = selected.mimeType;
      this.#state = 'recording';
      return true;
    } catch (error) {
      this.#beginFailure(
        asError(error, 'video capture: could not start recording'),
      );
      return false;
    }
  }

  /**
   * Request a successful finish.
   *
   * Resolution waits for MediaRecorder's `stop` event, which follows its final
   * `dataavailable`; resolving at the `stop()` call would silently drop that last
   * chunk. Repeated stop/cancel calls return the same completion promise. A
   * later cancel may supersede an in-flight successful stop until the artifact
   * is settled, so leaving FINALIZING can still discard its OPFS file.
   */
  stop(): Promise<VideoCaptureOutcome> {
    this.#requestFinish('stop');
    return this.completion;
  }

  /** Stop recording but discard every encoded chunk. */
  cancel(): Promise<VideoCaptureOutcome> {
    this.#requestFinish('cancel');
    return this.completion;
  }

  #requestFinish(intent: TerminalIntent): void {
    if (this.#settled !== undefined) return;
    if (intent === 'cancel' && this.#intent === 'stop') {
      this.#intent = 'cancel';
      return;
    }
    if (this.#terminalizing) return;

    if (this.#state === 'idle') {
      this.#intent = intent;
      if (intent === 'cancel') {
        this.#beginCancellation();
      } else {
        this.#beginFailure(
          new Error('video capture: cannot stop before recording starts'),
        );
      }
      return;
    }
    if (this.#state !== 'recording' || this.#intent !== undefined) return;

    this.#intent = intent;
    this.#state = 'stopping';
    const recorder = this.#recorder;
    if (recorder === undefined || recorder.state === 'inactive') {
      this.#handleStop();
      return;
    }
    try {
      recorder.stop();
    } catch (error) {
      this.#beginFailure(
        asError(error, 'video capture: MediaRecorder.stop failed'),
      );
    }
  }

  #startRecorder(
    Recorder: VideoMediaRecorderConstructor,
    stream: MediaStream,
    hasAudio: boolean,
  ): { recorder: VideoMediaRecorder; mimeType: string | undefined } {
    let lastError: Error | undefined;

    for (const mimeType of [...VIDEO_MIME_CANDIDATES, undefined]) {
      if (
        mimeType !== undefined
        && Recorder.isTypeSupported !== undefined
        && !Recorder.isTypeSupported(mimeType)
      ) {
        continue;
      }

      let recorder: VideoMediaRecorder | undefined;
      try {
        const options: MediaRecorderOptions = {
          videoBitsPerSecond: this.#videoBitsPerSecond,
          ...(hasAudio
            ? { audioBitsPerSecond: this.#audioBitsPerSecond }
            : {}),
          ...(mimeType === undefined ? {} : { mimeType }),
        };
        recorder = new Recorder(stream, options);
        // Bind the active candidate before `start`: an implementation is allowed
        // to report an error synchronously from that call, and the handler must
        // still know which recorder and MIME it is settling.
        this.#recorder = recorder;
        this.#selectedMimeType = mimeType;
        this.#bind(recorder);
        recorder.start(this.#timesliceMs);
        return { recorder, mimeType };
      } catch (error) {
        if (recorder !== undefined) this.#unbind(recorder);
        this.#recorder = undefined;
        this.#selectedMimeType = undefined;
        if (this.#settled !== undefined || this.#terminalizing) throw error;
        lastError = asError(error, 'MediaRecorder candidate failed');
      }
    }

    throw new Error(
      'video capture: no supported MediaRecorder configuration'
      + (lastError === undefined ? '' : ` (${lastError.message})`),
    );
  }

  #bind(recorder: VideoMediaRecorder): void {
    recorder.ondataavailable = this.#handleData;
    recorder.onstop = this.#handleStop;
    recorder.onerror = this.#handleError;
  }

  #unbind(recorder: VideoMediaRecorder): void {
    recorder.ondataavailable = null;
    recorder.onstop = null;
    recorder.onerror = null;
  }

  #handleData = (event: { readonly data: Blob }): void => {
    if (
      this.#settled !== undefined
      || this.#terminalizing
      || this.#state === 'idle'
      || this.#intent === 'cancel'
      || this.#writeError !== undefined
      || event.data.size === 0
    ) {
      return;
    }

    if (event.data.size > this.#pendingWriteLimitBytes - this.#pendingWriteBytes) {
      this.#failChunkStorage(new Error(
        `video capture: pending encoded data exceeded the ${formatMemoryLimit(this.#pendingWriteLimitBytes)} limit`,
      ));
      return;
    }

    this.#bytesReceived += event.data.size;
    this.#pendingWriteBytes += event.data.size;
    const type = event.data.type.trim();
    if (type !== '') this.#lastChunkMimeType = type;
    const chunk = event.data;
    this.#writeQueue = this.#writeQueue.then(async () => {
      try {
        if (this.#writeError === undefined) await this.#sink.write(chunk);
      } catch (error) {
        const failure = asError(error, 'video capture: could not store encoded data');
        this.#failChunkStorage(failure);
      } finally {
        this.#pendingWriteBytes -= chunk.size;
      }
    });
  };

  #failChunkStorage(error: Error): void {
    if (this.#writeError !== undefined || this.#settled !== undefined) return;
    this.#writeError = error;
    this.#beginFailure(error);
    const recorder = this.#recorder;
    if (recorder === undefined || recorder.state === 'inactive') return;
    try {
      recorder.stop();
    } catch {
      // The storage failure remains authoritative; terminal cleanup is underway.
    }
  }

  #handleStop = (): void => {
    if (this.#settled !== undefined || this.#terminalizing) return;
    this.#terminalizing = true;
    this.#unbindRecorder();
    this.#cleanup();
    void this.#finishAfterRecorderStop();
  };

  #handleError = (event: Event): void => {
    if (this.#settled !== undefined || this.#terminalizing) return;
    const raw = (event as Event & { readonly error?: unknown }).error;
    const error = raw === undefined
      ? new Error('video capture: MediaRecorder reported an error')
      : asError(raw, 'video capture: MediaRecorder reported an error');
    const recorder = this.#recorder;
    const shouldStop = recorder !== undefined && recorder.state !== 'inactive';
    // Settle and detach handlers first. Some fakes and browser implementations
    // dispatch `stop` synchronously from `stop()` after an error; allowing that
    // callback to run first could incorrectly turn an encoder failure into a
    // successful recording.
    this.#beginFailure(error);
    try {
      if (shouldStop) recorder.stop();
    } catch {
      // The error itself remains the useful result; teardown below owns tracks.
    }
  };

  #actualMimeType(): string {
    if (this.#lastChunkMimeType !== undefined) return this.#lastChunkMimeType;
    const recorderType = this.#recorder?.mimeType.trim();
    if (recorderType !== undefined && recorderType !== '') return recorderType;
    const selected = this.#selectedMimeType?.trim();
    if (selected !== undefined && selected !== '') return selected;
    throw new Error('video capture: recorder did not report an output MIME type');
  }

  async #finishAfterRecorderStop(): Promise<void> {
    await this.#writeQueue;

    if (this.#intent === 'cancel') {
      await this.#discardSink();
      this.#finish({ status: 'cancelled' });
      return;
    }
    if (this.#writeError !== undefined) {
      await this.#discardSink();
      this.#finish({ status: 'failed', error: this.#writeError });
      return;
    }
    if (this.#intent !== 'stop') {
      await this.#discardSink();
      this.#finish({
        status: 'failed',
        error: new Error('video export: recorder stopped before replay completed'),
      });
      return;
    }

    try {
      if (this.#bytesReceived === 0) {
        throw new Error('video capture: recorder produced no video data');
      }
      const mimeType = this.#actualMimeType();
      const extension = videoExtensionForMime(mimeType);
      if (extension === undefined) {
        throw new Error(`video capture: unsupported recorded MIME type "${mimeType}"`);
      }
      const blob = await this.#sink.finalize(mimeType);
      if (this.#cancelRequested()) {
        await this.#discardSink();
        this.#finish({ status: 'cancelled' });
        return;
      }
      if (blob.size !== this.#bytesReceived) {
        throw new Error(
          `video capture: stored ${blob.size} bytes, expected ${this.#bytesReceived}`,
        );
      }
      this.#finish({
        status: 'recorded',
        blob,
        mimeType,
        extension,
      });
    } catch (error) {
      await this.#discardSink();
      if (this.#cancelRequested()) {
        this.#finish({ status: 'cancelled' });
        return;
      }
      this.#finish({
        status: 'failed',
        error: asError(error, 'video capture: could not assemble recording'),
      });
    }
  }

  #beginCancellation(): void {
    if (this.#settled !== undefined || this.#terminalizing) return;
    this.#terminalizing = true;
    this.#state = 'cancelled';
    this.#unbindRecorder();
    this.#cleanup();
    void this.#writeQueue.then(async () => {
      await this.#discardSink();
      this.#finish({ status: 'cancelled' });
    });
  }

  #beginFailure(error: Error): void {
    if (this.#settled !== undefined || this.#terminalizing) return;
    this.#terminalizing = true;
    this.#state = 'failed';
    this.#unbindRecorder();
    this.#cleanup();
    void this.#writeQueue.then(async () => {
      await this.#discardSink();
      this.#finish({ status: 'failed', error });
    });
  }

  async #discardSink(): Promise<void> {
    try {
      await this.#sink.discard();
    } catch {
      // Preserve the encoder/storage error or cancellation that caused cleanup.
      // A later OPFS stale-file sweep gets another chance to remove the artifact.
    }
  }

  #cancelRequested(): boolean {
    return this.#intent === 'cancel';
  }

  #unbindRecorder(): void {
    if (this.#recorder !== undefined) this.#unbind(this.#recorder);
  }

  #finish(outcome: VideoCaptureOutcome): void {
    if (this.#settled !== undefined) return;
    this.#settled = outcome;
    this.#state =
      outcome.status === 'recorded'
        ? 'recorded'
        : outcome.status === 'cancelled'
          ? 'cancelled'
          : 'failed';
    this.#unbindRecorder();
    this.#cleanup();
    this.#resolveCompletion(outcome);
  }

  #own(tracks: readonly MediaStreamTrack[]): void {
    for (const track of tracks) this.#tracks.add(track);
  }

  #cleanup(): void {
    if (this.#cleaned) return;
    this.#cleaned = true;
    for (const track of this.#tracks) {
      try {
        // The shared audio lease may have been released first on cancellation.
        // `stop()` is normally harmless twice, but honour the exactly-once
        // ownership contract across both teardown paths.
        if (track.readyState !== 'ended') track.stop();
      } catch {
        // A broken/ended track cannot make cleanup of its siblings fail.
      }
    }
    this.#tracks.clear();
  }
}

export function videoExtensionForMime(
  mimeType: string,
): VideoExtension | undefined {
  const essence = mimeType.split(';', 1)[0]?.trim().toLowerCase();
  if (essence === 'video/webm') return 'webm';
  if (essence === 'video/mp4') return 'mp4';
  return undefined;
}

function captureCanvas(canvas: HTMLCanvasElement): MediaStream {
  const capture = canvas.captureStream;
  if (typeof capture !== 'function') {
    throw new Error('video capture: canvas.captureStream is unavailable');
  }
  return capture.call(canvas, VIDEO_CAPTURE_FPS);
}

function positiveFinite(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function formatMemoryLimit(bytes: number): string {
  const mib = bytes / (1024 * 1024);
  return `${Number.isInteger(mib) ? mib : mib.toFixed(1)} MiB`;
}

function asError(value: unknown, fallback: string): Error {
  if (value instanceof Error) return value;
  return new Error(
    value === undefined ? fallback : `${fallback}: ${String(value)}`,
  );
}

function browserGlobals(): VideoCaptureGlobals {
  const scope = globalThis as unknown as {
    readonly MediaRecorder?: VideoMediaRecorderConstructor;
    readonly MediaStream?: VideoMediaStreamConstructor;
  };
  return {
    MediaRecorder: scope.MediaRecorder,
    MediaStream: scope.MediaStream,
  };
}
