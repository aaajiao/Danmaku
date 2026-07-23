/**
 * Sound.
 *
 * Audio is a render-side concern and nothing else. It reads no simulation state
 * and can write none, so a missing asset, a refused AudioContext, or a runtime
 * with no WebAudio at all degrades to silence rather than taking the run down
 * with it. Every entry point here is total: `play` on an unknown name is a
 * no-op, and nothing this module does may throw into the game loop.
 *
 * Sounds are registered rather than hard-coded, so new content is added by
 * writing a file — never by editing the engine.
 *
 * ## Placeholder assets
 *
 * Upstream's audio is Touhou Project derivative and cannot ship (CLAUDE.md,
 * rule 9). As with `render/procedural.ts`, the engine synthesises its own
 * placeholders at runtime: original by construction, and licence-clean. A sound
 * given a `url` loads that file instead, so replacing a placeholder with real
 * work is a `defineSound` call from a content file and nothing more.
 *
 * ## Randomness
 *
 * Noise comes from the `fx` stream. Waveform synthesis is cosmetic; drawing it
 * from `sim` would weld the sound design to replay determinism, which is the
 * precise mistake CLAUDE.md rule 2 exists to prevent.
 */

import { fx } from '../core/random';

/**
 * Compact procedural fallback for an authored cue.
 *
 * Edition code may provide this alongside a sound name so a missing release
 * WAV still preserves the cue's identity instead of collapsing every extension
 * back onto the same generic beep.
 */
export interface SoundSynth {
  /** Seconds. */
  duration: number;
  /** Hz at the start and at the end; swept between the two. */
  from: number;
  to: number;
  /** 0 is a pure tone, 1 pure noise. */
  noise?: number;
  /** Exponential amplitude decay over the sound's length; higher is snappier. */
  decay?: number;
  /** Fade-in, in seconds. A waveform that starts off zero clicks without one. */
  attack?: number;
  /** Fold the sine towards a square, for a harsher retro edge. */
  square?: boolean;
  peak?: number;
}

export interface SoundSpec {
  /** Generated procedurally when absent. */
  url?: string;
  /** Authored procedural floor used when `url` is absent or fails to decode. */
  synth?: SoundSynth;
  volume?: number;
  /** Max simultaneous voices; further plays are dropped. */
  polyphony?: number;
  /** Ignore repeat plays within this many ms — stops machine-gun shot SFX. */
  throttleMs?: number;
}

/** A registered sound, with every default already resolved. */
interface Sound {
  readonly url: string | undefined;
  readonly synth: SoundSynth | undefined;
  readonly volume: number;
  readonly polyphony: number;
  readonly throttleMs: number;
}

const DEFAULT_POLYPHONY = 8;

const registry = new Map<string, Sound>();

/** Spec values arrive from content files unvalidated; NaN would poison a gain. */
function finite(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number | undefined, fallback: number): number {
  const v = finite(value, fallback);
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Register a sound, or replace one already registered.
 *
 * Unlike the pattern registry, a duplicate name is deliberately not an error.
 * The built-in placeholders exist to be replaced, and swapping one for a real
 * asset has to be possible from a content file — requiring an edit to this
 * module would make the engine own the content.
 */
export function defineSound(name: string, spec: SoundSpec): void {
  registry.set(name, {
    url: spec.url,
    synth: spec.synth,
    volume: clamp01(spec.volume, 1),
    // Floored at one: a sound registered with zero voices can never play, which
    // is a typo rather than an intent. Not registering it says that better.
    polyphony: Math.max(1, Math.floor(finite(spec.polyphony, DEFAULT_POLYPHONY))),
    throttleMs: Math.max(0, finite(spec.throttleMs, 0)),
  });
}

/**
 * Replace selected fields of a registered sound while preserving its authored
 * mix policy.
 *
 * Pack samples use this seam: a legacy path should replace only the waveform,
 * not accidentally turn a restrained UI tick into an unthrottled full-volume
 * eight-voice sound. `defineSound` remains the intentional whole-entry
 * replacement API for source-authored content.
 */
export function overrideSound(name: string, spec: SoundSpec): void {
  const previous = registry.get(name);
  defineSound(name, {
    url: spec.url ?? previous?.url,
    synth: spec.synth ?? previous?.synth,
    volume: spec.volume ?? previous?.volume,
    polyphony: spec.polyphony ?? previous?.polyphony,
    throttleMs: spec.throttleMs ?? previous?.throttleMs,
  });
}

export function soundNames(): readonly string[] {
  return [...registry.keys()];
}

/* ------------------------------------------------------------------ */
/* Synthesis                                                           */
/* ------------------------------------------------------------------ */

/** Seconds of fade-out. A tone cut mid-cycle clicks just as a hard start does. */
const RELEASE = 0.006;

const SYNTHS: Readonly<Record<string, SoundSynth>> = {
  // Sweep floor raised 420 → 640Hz (design §4, ordered fallback step 1): the BGM
  // lead now lives in [300,1000], and a downward square sweep bottoming at 420 put
  // the shot's own fundamental squarely in that lane (~90% of the shot's power) —
  // M16′ measured the loudest track only ~5dB over a real shot schedule in-lane,
  // ~0dB at playback. 640 clears the meat of the lane while staying an audible
  // downward "pew"; the effective peak barely moves (0.1137 → 0.1140), so the M8
  // effective-peak ladder is unchanged. The spectral fix — level and identity kept,
  // the behavior-on-top asset unspent (step 2, the 0.30→0.20 cut, NOT taken).
  shot: { duration: 0.07, from: 1050, to: 640, decay: 9, peak: 0.5, square: true },
  hit: { duration: 0.09, from: 700, to: 180, decay: 7, noise: 0.45, peak: 0.7 },
  explosion: { duration: 0.55, from: 260, to: 40, decay: 4, noise: 0.8, peak: 0.9 },
  graze: { duration: 0.13, from: 1900, to: 2600, decay: 8, peak: 0.4, attack: 0.004 },
  pickup: {
    duration: 0.16,
    from: 620,
    to: 1560,
    decay: 3.5,
    peak: 0.5,
    attack: 0.003,
    square: true,
  },
  death: { duration: 0.85, from: 420, to: 55, decay: 3, noise: 0.35, peak: 0.95 },

  // The boss ladder: toll (a card announces itself) → declare (a spell card is
  // declared) → break (a card is broken) → and the boss death keeps `explosion`,
  // the biggest report of all (做减法 — the death IS the largest explosion, no
  // `knell`). `toll` sits below the behavior band by pitch, so it announces
  // without camping the 1.5–3kHz the graze/pickup cues own; `declare`/`break` are
  // brief and bright so they pass through the band rather than sit in it.
  toll: { duration: 0.7, from: 160, to: 150, decay: 4, noise: 0.05, peak: 0.6 },
  declare: { duration: 0.35, from: 300, to: 520, decay: 8, peak: 0.45, square: true },
  break: { duration: 0.22, from: 1800, to: 600, decay: 18, noise: 0.4, peak: 0.5 },
  // Stage clear: a resolving rise, its own small stinger rather than the pickup chirp.
  clear: { duration: 0.25, from: 520, to: 780, decay: 6, peak: 0.4, attack: 0.003 },

  // The UI channel — 负空间 sounds: all under 0.09s and below every gameplay
  // cue, but navigation must still clear the menu theme. Move/confirm/cancel
  // therefore occupy the 1.5–3kHz lane the BGM leaves empty instead of hiding
  // inside its 300–1000Hz lead. Pause stays a soft low note; advance is a dry
  // high filament. Move is the faintest navigation tick, confirm rises, cancel
  // falls.
  'ui-move': { duration: 0.03, from: 2200, to: 2200, decay: 9, peak: 0.24 },
  'ui-confirm': { duration: 0.06, from: 1700, to: 2600, decay: 8, peak: 0.3 },
  'ui-cancel': { duration: 0.06, from: 2400, to: 1500, decay: 8, peak: 0.28 },
  'ui-pause': { duration: 0.07, from: 320, to: 220, decay: 8, peak: 0.26 },
  'ui-advance': { duration: 0.04, from: 2800, to: 2400, decay: 10, peak: 0.24 },
};

/** Stands in for a registered name nobody has authored a sound for yet. */
const DEFAULT_SYNTH: SoundSynth = { duration: 0.1, from: 800, to: 500, decay: 8, peak: 0.4 };

function render(ctx: BaseAudioContext, synth: SoundSynth): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.ceil(synth.duration * rate));
  const buffer = ctx.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);

  const noise = synth.noise ?? 0;
  const decay = synth.decay ?? 6;
  const peak = synth.peak ?? 0.6;
  const attack = Math.max(1, Math.round((synth.attack ?? 0.002) * rate));
  const release = Math.max(1, Math.round(RELEASE * rate));
  const ratio = synth.to / synth.from;

  let phase = 0;
  for (let i = 0; i < length; i++) {
    const t = i / length;

    // Exponential, not linear. Pitch is heard logarithmically, so a linear
    // sweep sounds like it stalls as it falls.
    const freq = synth.from * Math.pow(ratio, t);
    phase += (2 * Math.PI * freq) / rate;

    let sample = Math.sin(phase);
    if (synth.square) sample = Math.sign(sample) * (0.4 + 0.6 * Math.abs(sample));
    if (noise > 0) sample += (fx.random() * 2 - 1 - sample) * noise;

    let envelope = Math.exp(-decay * t) * peak;
    if (i < attack) envelope *= i / attack;
    const remaining = length - 1 - i;
    if (remaining < release) envelope *= remaining / release;

    data[i] = sample * envelope;
  }

  return buffer;
}

/* ------------------------------------------------------------------ */
/* Playback                                                            */
/* ------------------------------------------------------------------ */

type AudioContextCtor = new () => AudioContext;

/**
 * WebAudio is looked up, never referenced directly. `bun test` has no
 * AudioContext, and a module that read the global at load time could not be
 * imported there at all.
 */
function audioContextCtor(): AudioContextCtor | undefined {
  const scope = globalThis as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext;
}

/** Wall clock for throttling. Deliberately not the sim clock — audio has no tick. */
function now(): number {
  return globalThis.performance?.now() ?? Date.now();
}

/**
 * Throw away a context that failed to come up. Browsers cap the number of live
 * contexts per document, so a repeatedly retried unlock must not leak one each
 * time — and every step of the disposal is itself allowed to fail.
 */
function discard(ctx: AudioContext | undefined): void {
  try {
    void ctx?.close().catch(() => undefined);
  } catch {
    // An implementation without `close`, or one refusing to close a context
    // that never started. Nothing further is worth attempting.
  }
}

interface Voice {
  readonly name: string;
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
  /** Context time the sound finishes, used to retire it without an event. */
  readonly endsAt: number;
}

export class Audio {
  #ctx: AudioContext | undefined;
  #master: GainNode | undefined;
  #masterVolume: number;
  #unlocked = false;
  #unlocking: Promise<void> | undefined;
  /**
   * One-shot cues requested while the browser is still resuming its context.
   *
   * The title's first confirm is also the gesture that unlocks audio. Without
   * this bounded queue the cue runs in that same tick, sees no graph and is
   * silently lost.
   */
  #pending: string[] = [];
  /** One deferred replay per URL sample, so a long load cannot release a burst. */
  #pendingLoads = new Set<string>();

  #buffers = new Map<string, AudioBuffer>();
  #loading = new Set<string>();
  #voices: Voice[] = [];
  /** When each sound last actually started, for throttling. */
  #lastPlayed = new Map<string, number>();

  constructor(options?: { masterVolume?: number }) {
    this.#masterVolume = clamp01(options?.masterVolume, 1);
  }

  /**
   * Start the audio graph. Browsers refuse to run one outside a user gesture,
   * so call this from the first input. Calling it where WebAudio does not exist
   * is harmless: the engine simply stays silent and `unlocked` stays false.
   */
  async unlock(): Promise<void> {
    if (this.#unlocked) return;

    // One tap can deliver both a keydown and a pointerdown. Sharing the
    // in-flight promise stops the second one building a second context.
    const pending = this.#unlocking;
    if (pending) return pending;

    this.#unlocking = this.#start();
    try {
      await this.#unlocking;
    } finally {
      this.#unlocking = undefined;
      if (this.#unlocked) this.#flushPending();
      else this.#pending.length = 0;
    }
  }

  async #start(): Promise<void> {
    const Ctor = audioContextCtor();
    if (!Ctor) return;

    let ctx: AudioContext | undefined;
    try {
      ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = this.#masterVolume;
      master.connect(ctx.destination);

      // Contexts commonly start suspended even inside a gesture handler.
      if (ctx.state === 'suspended') await ctx.resume();

      this.#ctx = ctx;
      this.#master = master;
      this.#unlocked = true;

      // Synthesis costs milliseconds per sound. Paying it here keeps it off the
      // frame that fires the first shot.
      for (const [name, sound] of registry) this.#ensure(name, sound);
    } catch {
      // A refused or broken context leaves the game silent, never stopped.
      discard(ctx);
      this.#ctx = undefined;
      this.#master = undefined;
      this.#unlocked = false;
    }
  }

  play(name: string): void {
    const sound = registry.get(name);
    if (!sound) return;

    const ctx = this.#ctx;
    const master = this.#master;
    if (!ctx || !master) {
      if (this.#unlocking !== undefined) this.#queue(name);
      return;
    }

    try {
      const at = now();
      if (sound.throttleMs > 0) {
        const last = this.#lastPlayed.get(name);
        if (last !== undefined && at - last < sound.throttleMs) return;
      }

      this.#retire(ctx.currentTime);

      let live = 0;
      for (const voice of this.#voices) if (voice.name === name) live++;
      if (live >= sound.polyphony) return;

      const buffer = this.#ensure(name, sound);
      if (!buffer) {
        // URL samples load asynchronously. A one-shot cue requested in that
        // window must be heard when its buffer lands rather than silently lost.
        if (this.#pendingLoads.size < 32) this.#pendingLoads.add(name);
        return;
      }

      const gain = ctx.createGain();
      gain.gain.value = sound.volume;
      gain.connect(master);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      source.start();

      this.#voices.push({
        name,
        source,
        gain,
        endsAt: ctx.currentTime + buffer.duration,
      });
      // Stamped only once a voice actually started: a play dropped for
      // polyphony must not also swallow the next one.
      this.#lastPlayed.set(name, at);
    } catch {
      // Nothing audio does is worth interrupting a frame for.
    }
  }

  stopAll(): void {
    this.#pending.length = 0;
    this.#pendingLoads.clear();
    for (const voice of this.#voices) {
      try {
        voice.source.stop();
      } catch {
        // A source that never started, or has already ended, refuses `stop`.
      }
      this.#release(voice);
    }
    this.#voices.length = 0;
    // Throttle windows belong to the run that was interrupted. A fresh one must
    // not have its first shot swallowed by the old one's timing.
    this.#lastPlayed.clear();
  }

  set masterVolume(value: number) {
    this.#masterVolume = clamp01(value, this.#masterVolume);
    if (this.#master) this.#master.gain.value = this.#masterVolume;
  }

  get masterVolume(): number {
    return this.#masterVolume;
  }

  get unlocked(): boolean {
    return this.#unlocked;
  }

  /** Keep startup/load latency from growing an unbounded input backlog. */
  #queue(name: string): void {
    if (this.#pending.length < 32) this.#pending.push(name);
  }

  /** Replay the bounded cues that arrived while the context was unlocking. */
  #flushPending(): void {
    if (this.#pending.length === 0) return;
    const ready = this.#pending.splice(0);
    for (const name of ready) this.play(name);
  }

  /**
   * Drop voices that have finished. `ended` fires asynchronously and is easy to
   * miss on a stopped source, so the context clock is the reliable signal.
   */
  #retire(at: number): void {
    if (this.#voices.length === 0) return;

    const live: Voice[] = [];
    for (const voice of this.#voices) {
      if (voice.endsAt > at) live.push(voice);
      else this.#release(voice);
    }
    this.#voices = live;
  }

  #release(voice: Voice): void {
    try {
      voice.source.disconnect();
      voice.gain.disconnect();
    } catch {
      // Already torn down.
    }
  }

  /** The buffer for a sound, generating or fetching it on first ask. */
  #ensure(name: string, sound: Sound): AudioBuffer | undefined {
    const cached = this.#buffers.get(name);
    if (cached) return cached;

    const ctx = this.#ctx;
    if (!ctx) return undefined;

    if (sound.url !== undefined) {
      void this.#load(name, sound.url);
      return undefined; // A requested cue is queued until the fetch lands.
    }

    // A registered name with no synth of its own gets an audible placeholder
    // rather than silence, so a sound nobody authored is noticed instead of
    // quietly missing.
    const buffer = render(ctx, sound.synth ?? SYNTHS[name] ?? DEFAULT_SYNTH);
    this.#buffers.set(name, buffer);
    return buffer;
  }

  async #load(name: string, url: string): Promise<void> {
    if (this.#loading.has(name)) return;
    this.#loading.add(name);

    try {
      const response = await fetch(url);
      if (response.ok) {
        const encoded = await response.arrayBuffer();
        const buffer = await this.#ctx?.decodeAudioData(encoded);
        if (buffer) this.#buffers.set(name, buffer);
      }
    } catch {
      // The fallback below handles network and decode failures alike. Nothing
      // reaches the caller: `play` runs inside render.
    } finally {
      // A pack file is an enhancement, never the game's audibility floor. If
      // it disappears or cannot decode, restore the original named placeholder
      // (or the generic one for an extension name) and replay queued cues.
      try {
        const ctx = this.#ctx;
        if (!this.#buffers.has(name) && ctx) {
          const registered = registry.get(name);
          this.#buffers.set(
            name,
            render(ctx, registered?.synth ?? SYNTHS[name] ?? DEFAULT_SYNTH),
          );
        }
      } catch {
        // A broken WebAudio implementation may even reject buffer creation.
        // Total degradation still wins over surfacing the failure.
      }
      this.#loading.delete(name);
      const replay = this.#pendingLoads.delete(name);
      if (replay && this.#buffers.has(name)) this.play(name);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Built-in sounds                                                     */
/* ------------------------------------------------------------------ */

// Throttles are tuned against the events that fire them: the player shoots
// every few ticks, and grazes arrive in bursts of dozens.
defineSound('shot', { volume: 0.3, polyphony: 4, throttleMs: 40 });
defineSound('hit', { volume: 0.35, polyphony: 6, throttleMs: 20 });
defineSound('explosion', { volume: 0.55, polyphony: 4, throttleMs: 45 });
defineSound('graze', { volume: 0.22, polyphony: 3, throttleMs: 60 });
defineSound('pickup', { volume: 0.35, polyphony: 4, throttleMs: 25 });
// One death at a time, and never re-triggered by a follow-up frame.
defineSound('death', { volume: 0.8, polyphony: 1, throttleMs: 250 });

// The boss ladder (see `cues.ts`): each announces or resolves a moment that
// happens once, so a single voice and a throttle wide enough to swallow a
// double-fire on the same tick.
defineSound('toll', { volume: 0.6, polyphony: 1, throttleMs: 120 });
defineSound('declare', { volume: 0.5, polyphony: 2, throttleMs: 90 });
defineSound('break', { volume: 0.55, polyphony: 2, throttleMs: 60 });
defineSound('clear', { volume: 0.5, polyphony: 1, throttleMs: 200 });

// The UI channel stays below graze by effective peak, but its navigation
// transients clear the menu theme in the lane the score vacates. Single- or
// double-voice, throttled against a held-button double-tap. Played shell-side
// (`SHELL_CUES`), never off a run event.
defineSound('ui-move', { volume: 0.42, polyphony: 2, throttleMs: 30 });
defineSound('ui-confirm', { volume: 0.29, polyphony: 2, throttleMs: 40 });
defineSound('ui-cancel', { volume: 0.27, polyphony: 2, throttleMs: 40 });
defineSound('ui-pause', { volume: 0.24, polyphony: 1, throttleMs: 60 });
defineSound('ui-advance', { volume: 0.36, polyphony: 2, throttleMs: 30 });
