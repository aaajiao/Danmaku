/**
 * The shared WebAudio output graph.
 *
 * Sound effects and music keep independent master gains, but may opt into one
 * `AudioContext`. Each master always reaches the speakers. While a capture
 * lease is live, both masters also reach one `MediaStreamAudioDestinationNode`,
 * so a recorder receives one already-mixed audio track rather than having to
 * combine tracks itself.
 *
 * Constructing an output is inert. `unlock` still has to be called from a user
 * gesture, and every failure degrades to an unavailable output instead of
 * escaping into the game loop.
 */

export type AudioBus = 'sfx' | 'music';

export interface AudioCaptureLease {
  readonly stream: MediaStream;
  readonly track: MediaStreamTrack;
  /** Idempotent. Stops only this capture route, never the shared context. */
  release(): void;
}

type AudioContextCtor = new () => AudioContext;

interface CaptureState {
  readonly destination: MediaStreamAudioDestinationNode;
  readonly track: MediaStreamTrack;
  active: boolean;
}

/**
 * WebAudio is looked up at unlock time. Headless runtimes can therefore import
 * every audio module without installing DOM globals first.
 */
function audioContextCtor(): AudioContextCtor | undefined {
  const scope = globalThis as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext;
}

/** Dispose a context that failed to start without surfacing disposal failures. */
function discard(ctx: AudioContext | undefined): void {
  try {
    void ctx?.close().catch(() => undefined);
  } catch {
    // Some partial WebAudio implementations omit or reject `close`.
  }
}

export class AudioOutput {
  #ctx: AudioContext | undefined;
  #unlocking: Promise<AudioContext | undefined> | undefined;
  #buses = new Map<AudioBus, GainNode>();
  #capture: CaptureState | undefined;

  /**
   * Resume (or create and resume) the one context owned by this output.
   *
   * Concurrent callers share the same attempt. A failed attempt is discarded
   * and may be retried by a later user gesture. An existing context is checked
   * every time: browsers may suspend it after the original unlock while a tab
   * is backgrounded or system audio is interrupted.
   */
  async unlock(): Promise<AudioContext | undefined> {
    const pending = this.#unlocking;
    if (pending) return pending;

    this.#unlocking = this.#ctx === undefined
      ? this.#start()
      : this.#resume(this.#ctx);
    try {
      return await this.#unlocking;
    } finally {
      this.#unlocking = undefined;
    }
  }

  async #resume(ctx: AudioContext): Promise<AudioContext | undefined> {
    try {
      if (ctx.state !== 'running') await ctx.resume();
      return ctx.state === 'running' ? ctx : undefined;
    } catch {
      return undefined;
    }
  }

  async #start(): Promise<AudioContext | undefined> {
    const Ctor = audioContextCtor();
    if (!Ctor) return undefined;

    let ctx: AudioContext | undefined;
    try {
      ctx = new Ctor();
      const running = await this.#resume(ctx);
      if (running === undefined) {
        discard(ctx);
        return undefined;
      }
      this.#ctx = ctx;
      return ctx;
    } catch {
      discard(ctx);
      return undefined;
    }
  }

  /**
   * Return the channel's single master gain, creating its speaker route lazily.
   *
   * Laziness preserves the old standalone shape: a default `Audio` or `Music`
   * instance still creates only the bus it needs. Injecting the same output
   * into both instances creates the two independent masters on one context.
   */
  bus(channel: AudioBus): GainNode | undefined {
    const existing = this.#buses.get(channel);
    if (existing) return existing;

    const ctx = this.#ctx;
    if (!ctx) return undefined;

    try {
      const bus = ctx.createGain();
      bus.connect(ctx.destination);
      this.#buses.set(channel, bus);

      const capture = this.#capture;
      if (capture?.active) {
        try {
          bus.connect(capture.destination);
        } catch {
          // A capture missing one master is not a valid mixed lease. Tear down
          // only that lease; normal speaker playback remains connected.
          this.#releaseCapture(capture);
        }
      }
      return bus;
    } catch {
      return undefined;
    }
  }

  /**
   * Lease one mixed audio track for a recorder.
   *
   * There is deliberately one live lease at a time. Every successful call
   * creates a fresh destination and track, because a recorder commonly stops
   * its input tracks when it finishes. Locked or unsupported runtimes return
   * `undefined` without disturbing speaker playback.
   */
  capture(): AudioCaptureLease | undefined {
    const ctx = this.#ctx;
    if (!ctx || ctx.state !== 'running' || this.#capture?.active) {
      return undefined;
    }

    const createDestination = (
      ctx as AudioContext & {
        createMediaStreamDestination?: () => MediaStreamAudioDestinationNode;
      }
    ).createMediaStreamDestination;
    if (typeof createDestination !== 'function') return undefined;

    let destination: MediaStreamAudioDestinationNode;
    try {
      destination = createDestination.call(ctx);
    } catch {
      return undefined;
    }

    let tracks: MediaStreamTrack[];
    try {
      tracks = destination.stream.getAudioTracks();
    } catch {
      return undefined;
    }
    if (tracks.length !== 1) {
      for (const track of tracks) {
        try {
          track.stop();
        } catch {
          // A malformed stream is already unusable; best-effort cleanup only.
        }
      }
      return undefined;
    }

    const track = tracks[0] as MediaStreamTrack;
    const state: CaptureState = { destination, track, active: true };
    try {
      for (const bus of this.#buses.values()) bus.connect(destination);
    } catch {
      this.#releaseCapture(state);
      return undefined;
    }

    this.#capture = state;
    return {
      stream: destination.stream,
      track,
      release: () => this.#releaseCapture(state),
    };
  }

  get unlocked(): boolean {
    return this.#ctx?.state === 'running';
  }

  #releaseCapture(state: CaptureState): void {
    if (!state.active) return;
    state.active = false;

    for (const bus of this.#buses.values()) {
      try {
        // The destination-specific overload preserves the speaker edge.
        bus.disconnect(state.destination);
      } catch {
        // A partial WebAudio implementation may not support targeted removal.
        // Never fall back to `disconnect()` here: that would mute speakers.
      }
    }
    try {
      // ReplayVideoCapture may already have ended the shared track on normal
      // recorder shutdown. Disconnect this lease without stopping it twice.
      if (state.track.readyState !== 'ended') state.track.stop();
    } catch {
      // Already stopped by MediaRecorder or another owner.
    }
    if (this.#capture === state) this.#capture = undefined;
  }
}
