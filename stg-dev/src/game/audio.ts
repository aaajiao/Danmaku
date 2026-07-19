import {
  V4_SHARED_ASSETS,
  v4AudioOrNull,
  v4RoomBed,
  type V4AudioAsset,
  type V4AudioBus,
} from "../assets/shared-v4";

/*
 * Audio is a read-only feedback subscriber.
 *
 * Nothing here may be read back by gameplay: there is no accessor for playback
 * position, no promise a caller can await to learn that a cue "finished", and
 * every public method returns void. Playback failure is swallowed here and
 * never surfaces to the game loop. The authored rule, from
 * manifests/narrative/audio-manifest-v4.json mixContract:
 * "Audio is feedback. It cannot gate gameplay or determine event completion."
 *
 * A cue with no authored binding is silence. No substitute sound is invented.
 */

/* ------------------------------------------------------------------ *
 * Structural WebAudio surface.
 *
 * jsdom ships no WebAudio implementation, so the context is injected. These
 * interfaces are the exact subset this module touches; a real AudioContext
 * satisfies them structurally, and tests supply a deterministic fake.
 * ------------------------------------------------------------------ */

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): unknown;
  linearRampToValueAtTime(value: number, endTime: number): unknown;
  cancelScheduledValues(cancelTime: number): unknown;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown;
  disconnect(): unknown;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
  channelCount: number;
  channelCountMode: string;
  channelInterpretation: string;
}

export interface BiquadFilterNodeLike extends AudioNodeLike {
  type: string;
  readonly frequency: AudioParamLike;
}

export interface AudioBufferLike {
  readonly duration: number;
}

export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  start(when?: number): unknown;
  stop(when?: number): unknown;
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: AudioNodeLike;
  readonly state: string;
  resume(): Promise<void>;
  createGain(): GainNodeLike;
  createBiquadFilter(): BiquadFilterNodeLike;
  createBufferSource(): AudioBufferSourceNodeLike;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>;
}

export interface AudioTraceDeps {
  /** Constructed on the first user gesture, never before. */
  readonly createContext: () => AudioContextLike;
  /** Fetches the encoded bytes for an authored asset url. */
  readonly fetchAudio: (url: string) => Promise<ArrayBuffer>;
}

/* ------------------------------------------------------------------ *
 * Authored mix contract. Every constant is read from the bound manifest;
 * none of it is invented here.
 * ------------------------------------------------------------------ */

const MIX = V4_SHARED_ASSETS.audioMix;
/** Bus identity comes from the manifest list, not from a local literal. */
const BUSES: readonly string[] = MIX.buses;
const HEADROOM_GAIN = 10 ** (MIX.headroomDb / 20);
const CROSSFADE_SECONDS = MIX.roomCrossfadeMs / 1000;
const LOWPASS_OPEN_HZ = MIX.gazeLowPassHz.open;
const LOWPASS_CLAMPED_HZ = MIX.gazeLowPassHz.clamped;

/**
 * Preloaded once the graph unlocks: short, event-critical material (every sfx
 * and every boss signal). Room beds are long and load per authoritative room
 * instead. A cue requested before its buffer has decoded is dropped, never
 * queued — an unlock must not fire a burst of stale feedback.
 */
function preloadableAssets(): readonly Readonly<V4AudioAsset>[] {
  return Object.values(V4_SHARED_ASSETS.audio).filter(
    (asset) => asset.category !== "room-bed",
  );
}

interface ActiveBed {
  readonly roomId: string;
  readonly source: AudioBufferSourceNodeLike;
  readonly gain: GainNodeLike;
}

export class AudioTrace {
  private readonly deps: AudioTraceDeps;
  private readonly buffers = new Map<string, AudioBufferLike>();
  private readonly loading = new Set<string>();
  private readonly buses = new Map<string, GainNodeLike>();

  private context: AudioContextLike | null = null;
  private master: GainNodeLike | null = null;
  private mono: GainNodeLike | null = null;
  private lowPass: BiquadFilterNodeLike | null = null;

  private enabled = true;
  private binauralMono = false;
  private gazeClamped = false;
  private roomId = "";
  private bed: ActiveBed | null = null;
  private disposed = false;

  constructor(deps: AudioTraceDeps) {
    this.deps = deps;
  }

  /**
   * Called from a real user-gesture handler. Before this runs there is no
   * AudioContext at all and every cue request is dropped silently.
   */
  unlock(): void {
    if (this.disposed || this.context !== null) return;
    try {
      const context = this.deps.createContext();
      this.#buildGraph(context);
      this.context = context;
      if (context.state !== "running") {
        void context.resume().catch(() => undefined);
      }
    } catch {
      this.context = null;
      this.master = null;
      this.mono = null;
      this.lowPass = null;
      this.buses.clear();
      return;
    }
    for (const asset of preloadableAssets()) {
      this.#loadBuffer(asset.url);
    }
    if (this.roomId !== "") this.#startBed(this.roomId);
  }

  /** Presentation-only mute. Leaves the gameplay event trace untouched. */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.#applyMasterGain();
  }

  /** accessibility.disableBinaural: downmix claims to mono. */
  setBinauralMono(mono: boolean): void {
    if (this.binauralMono === mono) return;
    this.binauralMono = mono;
    this.#applyMonoDownmix();
  }

  /**
   * Follows the authoritative gaze state. The manifest authors the two
   * endpoints and no transition time, so the corner frequency is set as
   * authored rather than ramped over an invented duration.
   */
  setGazeClamped(clamped: boolean): void {
    if (this.gazeClamped === clamped) return;
    this.gazeClamped = clamped;
    this.#applyGazeFilter();
  }

  /** Independent per-bus gain (accessibility.independentGains). */
  setBusGain(bus: V4AudioBus, value: number): void {
    const node = this.buses.get(bus);
    if (node === undefined || !Number.isFinite(value)) return;
    try {
      node.gain.value = Math.max(0, value);
    } catch {
      /* presentation-only; never reaches the game loop */
    }
  }

  /**
   * Authoritative room change. The 500 ms crossfade is scheduled on the audio
   * clock at the moment the room changes — this module owns no timer of its own
   * and never advances a room by itself.
   */
  setRoom(canonicalRoomId: string): void {
    if (this.disposed || canonicalRoomId === this.roomId) return;
    this.roomId = canonicalRoomId;
    this.#startBed(canonicalRoomId);
  }

  /**
   * Play an authored cue by audio id. An id V4 does not author is silence:
   * no fallback asset, no generic substitute.
   */
  playCue(audioId: string): void {
    const asset = v4AudioOrNull(audioId);
    if (asset === null) return;
    this.playAsset(asset);
  }

  playAsset(asset: Readonly<V4AudioAsset>): void {
    if (this.disposed || !this.enabled) return;
    const context = this.context;
    if (context === null) return;
    const buffer = this.buffers.get(asset.url);
    if (buffer === undefined) {
      // Not decoded yet: drop it. Queuing would replay a burst later, long
      // after the moment it was feedback for.
      this.#loadBuffer(asset.url);
      return;
    }
    const bus = this.buses.get(asset.bus);
    if (bus === undefined) return;
    try {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = false;
      source.connect(bus);
      source.start(context.currentTime);
    } catch {
      /* a cue that will not play is silence, not an exception */
    }
  }

  dispose(): void {
    this.disposed = true;
    this.#stopBed(0);
    this.buses.clear();
    this.buffers.clear();
    this.loading.clear();
    this.context = null;
    this.master = null;
    this.mono = null;
    this.lowPass = null;
  }

  /* -------------------------------------------------------------- */

  #buildGraph(context: AudioContextLike): void {
    const master = context.createGain();
    const mono = context.createGain();
    const lowPass = context.createBiquadFilter();
    lowPass.type = "lowpass";

    master.connect(context.destination);
    mono.connect(master);
    lowPass.connect(mono);

    this.buses.clear();
    for (const bus of BUSES) {
      const node = context.createGain();
      node.gain.value = 1;
      node.connect(lowPass);
      this.buses.set(bus, node);
    }

    this.master = master;
    this.mono = mono;
    this.lowPass = lowPass;
    this.#applyMasterGain();
    this.#applyMonoDownmix();
    this.#applyGazeFilterOn(context);
  }

  #applyMasterGain(): void {
    if (this.master === null) return;
    try {
      this.master.gain.value = this.enabled ? HEADROOM_GAIN : 0;
    } catch {
      /* presentation-only */
    }
  }

  #applyMonoDownmix(): void {
    if (this.mono === null) return;
    try {
      if (this.binauralMono) {
        this.mono.channelCount = 1;
        this.mono.channelCountMode = "explicit";
      } else {
        this.mono.channelCount = 2;
        this.mono.channelCountMode = "max";
      }
      this.mono.channelInterpretation = "speakers";
    } catch {
      /* presentation-only */
    }
  }

  #applyGazeFilter(): void {
    this.#applyGazeFilterOn(this.context);
  }

  #applyGazeFilterOn(context: AudioContextLike | null): void {
    if (this.lowPass === null) return;
    try {
      const frequency = this.gazeClamped ? LOWPASS_CLAMPED_HZ : LOWPASS_OPEN_HZ;
      this.lowPass.frequency.setValueAtTime(
        frequency,
        context === null ? 0 : context.currentTime,
      );
      this.lowPass.frequency.value = frequency;
    } catch {
      /* presentation-only */
    }
  }

  #startBed(roomId: string): void {
    const context = this.context;
    if (context === null) return;
    let asset: Readonly<V4AudioAsset>;
    try {
      asset = v4RoomBed(roomId);
    } catch {
      // Unbound room: authored silence. The previous bed still fades out, so
      // the authoritative room change is still honoured.
      this.#stopBed(CROSSFADE_SECONDS);
      return;
    }
    if (this.bed !== null && this.bed.roomId === roomId) return;
    const buffer = this.buffers.get(asset.url);
    if (buffer === undefined) {
      this.#loadBuffer(asset.url, () => {
        if (this.roomId === roomId) this.#startBed(roomId);
      });
      return;
    }
    const bus = this.buses.get(asset.bus);
    if (bus === undefined) return;
    try {
      const now = context.currentTime;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + CROSSFADE_SECONDS);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(gain);
      gain.connect(bus);
      source.start(now);
      this.#stopBed(CROSSFADE_SECONDS);
      this.bed = {roomId, source, gain};
    } catch {
      /* a bed that will not start is silence */
    }
  }

  #stopBed(fadeSeconds: number): void {
    const bed = this.bed;
    this.bed = null;
    if (bed === null) return;
    const context = this.context;
    try {
      const now = context === null ? 0 : context.currentTime;
      bed.gain.gain.cancelScheduledValues(now);
      bed.gain.gain.setValueAtTime(bed.gain.gain.value, now);
      bed.gain.gain.linearRampToValueAtTime(0, now + fadeSeconds);
      bed.source.stop(now + fadeSeconds);
    } catch {
      /* presentation-only */
    }
  }

  #loadBuffer(url: string, onReady?: () => void): void {
    if (this.buffers.has(url) || this.loading.has(url)) return;
    const context = this.context;
    if (context === null) return;
    this.loading.add(url);
    void (async () => {
      try {
        const bytes = await this.deps.fetchAudio(url);
        const decoded = await context.decodeAudioData(bytes);
        if (this.disposed) return;
        this.buffers.set(url, decoded);
        onReady?.();
      } catch {
        // A cue whose bytes never arrive stays silent forever. That failure
        // must never reach the game loop.
      } finally {
        this.loading.delete(url);
      }
    })();
  }
}
