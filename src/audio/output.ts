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

interface ResumeRound {
  readonly ctx: AudioContext;
  readonly promise: Promise<AudioContext | undefined>;
  readonly resolve: (ctx: AudioContext | undefined) => void;
  discardOnFailure: boolean;
  attempts: number;
  settled: boolean;
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
  #resumeRound: ResumeRound | undefined;
  #wakeBuffer:
    | {
      readonly ctx: AudioContext;
      readonly buffer: AudioBuffer;
    }
    | undefined;
  #needsWake = false;
  #buses = new Map<AudioBus, GainNode>();
  #capture: CaptureState | undefined;

  /**
   * Resume (or create and resume) the one context owned by this output.
   *
   * Ordinary concurrent callers share one round. `activateFromGesture` is the
   * deliberate exception: every independent browser gesture starts another
   * resume attempt on the same context. WebKit is allowed to leave a refused
   * `resume()` promise pending forever, so a drag rejected on `pointerup` must
   * not prevent a later trusted `touchend` or click from waking that context.
   */
  async unlock(): Promise<AudioContext | undefined> {
    const existing = this.#usableContext();
    const ctx = existing ?? this.#createContext();
    if (!ctx) return undefined;
    return this.#awaitRunning(ctx, existing === undefined);
  }

  /**
   * Synchronously poke WebAudio from a real input handler.
   *
   * The one-sample buffer is zero-filled by WebAudio and connects straight to
   * the destination, so it cannot alter the mix. Starting a source in the
   * gesture itself covers WebKit builds where `resume()` alone reports success
   * without opening the device. No promise is awaited here: the whole wake-up
   * operation remains on the browser's user-activation stack.
   */
  activateFromGesture(): void {
    const existing = this.#usableContext();
    const ctx = existing ?? this.#createContext();
    if (!ctx) return;

    if (ctx.state !== 'running' || this.#needsWake) this.#wake(ctx);
    if (ctx.state === 'running') {
      this.#settleRunning(ctx);
      return;
    }

    const round = this.#round(ctx, existing === undefined, true);
    // Unlike `unlock`, never join a possibly poisoned attempt. Each real
    // gesture gets one fresh call to `resume()` on the same AudioContext.
    this.#attemptResume(round, true);
  }

  /**
   * Revalidate an existing context after a page/PWA restore without creating
   * WebAudio before the player has interacted with the game.
   */
  async resumeIfStarted(): Promise<AudioContext | undefined> {
    const ctx = this.#usableContext();
    if (!ctx) return undefined;
    // A context can report `running` after iOS restores a PWA while the device
    // route is still silent. The next real gesture supplies one fresh poke.
    this.#needsWake = true;
    return this.#awaitRunning(ctx, false);
  }

  /**
   * Whether a consumer's nodes still belong to this output's live context.
   *
   * `Audio` and `Music` use this only at unlock boundaries. A closed context
   * cannot be resumed, so reporting it as foreign lets both buses rebuild once
   * on the replacement context created by the same later gesture.
   */
  isCurrentContext(ctx: AudioContext | undefined): boolean {
    return ctx !== undefined && this.#usableContext() === ctx;
  }

  #usableContext(): AudioContext | undefined {
    const ctx = this.#ctx;
    if (ctx === undefined) return undefined;
    if (ctx.state !== 'closed') return ctx;

    this.#abandonContext(ctx);
    return undefined;
  }

  #abandonContext(ctx: AudioContext): void {
    if (this.#ctx !== ctx) return;

    const round = this.#resumeRound;
    if (round !== undefined && round.ctx === ctx && !round.settled) {
      this.#settleRound(round, undefined);
    }
    const capture = this.#capture;
    if (capture?.active) this.#releaseCapture(capture);
    this.#buses.clear();
    this.#wakeBuffer = undefined;
    this.#needsWake = false;
    this.#ctx = undefined;
  }

  #createContext(): AudioContext | undefined {
    const Ctor = audioContextCtor();
    if (!Ctor) return undefined;

    try {
      const ctx = new Ctor();
      this.#ctx = ctx;
      this.#needsWake = true;
      return ctx;
    } catch {
      return undefined;
    }
  }

  #awaitRunning(
    ctx: AudioContext,
    fresh: boolean,
  ): Promise<AudioContext | undefined> {
    if (ctx.state === 'running') {
      this.#settleRunning(ctx);
      return Promise.resolve(ctx);
    }

    const round = this.#round(ctx, fresh);
    if (round.attempts === 0) {
      this.#attemptResume(round, round.discardOnFailure);
    }
    return round.promise;
  }

  #round(
    ctx: AudioContext,
    fresh: boolean,
    discardOnFailure = false,
  ): ResumeRound {
    const active = this.#resumeRound;
    if (active !== undefined && active.ctx === ctx && !active.settled) {
      if (discardOnFailure) active.discardOnFailure = true;
      return active;
    }

    let resolve!: (ctx: AudioContext | undefined) => void;
    const promise = new Promise<AudioContext | undefined>((done) => {
      resolve = done;
    });
    const round: ResumeRound = {
      ctx,
      promise,
      resolve,
      discardOnFailure: fresh || discardOnFailure,
      attempts: 0,
      settled: false,
    };
    this.#resumeRound = round;
    return round;
  }

  #attemptResume(
    round: ResumeRound,
    discardOnFailure = false,
  ): void {
    if (round.settled || this.#ctx !== round.ctx) return;
    round.attempts++;

    let attempt: Promise<void>;
    try {
      attempt = round.ctx.resume();
    } catch {
      this.#completeResume(round, discardOnFailure);
      return;
    }

    void attempt.then(
      () => this.#completeResume(round, discardOnFailure),
      () => this.#completeResume(round, discardOnFailure),
    );
  }

  #completeResume(
    round: ResumeRound,
    discardOnFailure: boolean,
  ): void {
    round.attempts = Math.max(0, round.attempts - 1);
    if (round.settled || this.#ctx !== round.ctx) return;

    if (round.ctx.state === 'running') {
      this.#settleRound(round, round.ctx);
      return;
    }
    if (round.ctx.state === 'closed') {
      this.#settleRound(round, undefined);
      this.#abandonContext(round.ctx);
      return;
    }
    // A definitive refusal from the newest real gesture is stronger evidence
    // than an older resume promise that WebKit left pending forever. Rotate the
    // context now instead of letting that poisoned attempt block every future
    // touch. Its eventual callback is harmless after the round is settled.
    if (discardOnFailure) {
      this.#settleRound(round, undefined);
      this.#abandonContext(round.ctx);
      discard(round.ctx);
      return;
    }
    // A pending sibling attempt may be the valid gesture. Do not discard its
    // context merely because an earlier Pointer/Touch stream was refused.
    if (round.attempts > 0) return;

    this.#settleRound(round, undefined);
    if (round.discardOnFailure && this.#ctx === round.ctx) {
      this.#abandonContext(round.ctx);
      discard(round.ctx);
    }
  }

  #settleRunning(ctx: AudioContext): void {
    const round = this.#resumeRound;
    if (round !== undefined && round.ctx === ctx && !round.settled) {
      this.#settleRound(round, ctx);
    }
  }

  #settleRound(
    round: ResumeRound,
    result: AudioContext | undefined,
  ): void {
    if (round.settled) return;
    round.settled = true;
    round.resolve(result);
    if (this.#resumeRound === round) this.#resumeRound = undefined;
  }

  #wake(ctx: AudioContext): void {
    try {
      let buffer = this.#wakeBuffer;
      if (buffer === undefined || buffer.ctx !== ctx) {
        buffer = {
          ctx,
          buffer: ctx.createBuffer(1, 1, ctx.sampleRate),
        };
        this.#wakeBuffer = buffer;
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer.buffer;
      source.connect(ctx.destination);
      source.onended = () => {
        try {
          source.disconnect();
        } catch {
          // A closed context may have already torn down the compatibility node.
        }
      };
      source.start(0);
      this.#needsWake = false;
    } catch {
      // The resume attempt below remains the standards path. A partial WebAudio
      // implementation refusing the compatibility poke may only stay silent.
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
    const ctx = this.#usableContext();
    if (!ctx) return undefined;

    const existing = this.#buses.get(channel);
    if (existing) return existing;

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
    const ctx = this.#usableContext();
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
    return this.#usableContext()?.state === 'running';
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
