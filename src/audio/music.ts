/**
 * Music.
 *
 * A stage's theme is not decoration. In this genre reading a curtain is half
 * rhythm: a player memorises where the waves fall against the music, and a boss
 * theme cutting in on entry is how the fight announces itself before a single
 * bullet is on screen. So music is a first-class stage and boss property here —
 * named by a stage or a boss exactly the way a background is — not something
 * bolted onto the shell after the fact.
 *
 * Everything the sound module's header says applies here too: audio is
 * render-side and nothing else, every entry point is total (`play` on an unknown
 * name is a no-op), and nothing here may throw into the game loop. A missing
 * asset, a refused `AudioContext`, or a runtime with no WebAudio degrades to
 * silence. As with sounds (CLAUDE.md rule 9) the floor is synthesised at
 * runtime — original by construction, never borrowed — so the game is never
 * blocked on an asset. A track given a `url` loads that file instead, and
 * swapping the synthesis for a real recording is one `defineMusic` call.
 *
 * ## The engine is a subtraction, not a wall of sound
 *
 * `MusicSynth` (below) is an additive composer: a handful of terms summed
 * sample by sample into one whole-cycle loop. It is deliberately small, and the
 * three aaajiao filters it answers to are documented on that interface — 做减法
 * (at most three voices), the Internet Void (the loop is the negative space the
 * player's own graze/pickup cues sound *into*, so it leaves the 1.5–3kHz
 * behavior band measurably empty), and 入神/出神 (the two stances, opposites).
 * The mix doctrine those produce — BGM RMS under the SFX peaks, the vacated
 * behavior band, the click-free seam — is measured in `mix.test.ts` and printed
 * by `tools/measure-audio.ts`, not asserted in prose (the audio analogue of a
 * background's "peak luminance near 0.1").
 *
 * ## Clock honesty — do NOT move this onto `uTick`
 *
 * Backgrounds advance on `uTick` and nowhere else, because a scene run on a wall
 * clock desynchronises *visually* from a replay while every test stays green
 * (see `render/background.ts`). Music is the opposite case and the rule is
 * deliberately inverted: it runs on the **audio clock**, not the sim tick. A
 * track restarting when a new stage begins, and a boss theme crossfading in on
 * entry, are the genre's own behaviour and carry no replay claim whatsoever —
 * nothing about what plays, or when it loops, feeds back into the simulation.
 * Welding music to `uTick` would buy nothing and would stutter the loop under a
 * frame-rate hitch. Someone will read this file, see the wall clock, and want to
 * "fix" it to match backgrounds. That is the wrong fix. The two clocks are
 * different on purpose.
 *
 * ## Sitting under the mix
 *
 * The drone floor is low in pitch and quiet by construction: the bass register
 * does not mask a bullet's cue, which lives in the SFX band, and the master
 * ceiling here is set well under the sound effects so the theme never competes
 * with the readability of play. Its own master bus, separate from the sound
 * engine's, is what lets the shell duck music on pause without touching a single
 * SFX voice. The two buses may still share one `AudioContext`, which is required
 * when a recorder needs one mixed audio track.
 *
 * ## Randomness — there is none
 *
 * The composer draws from no RNG stream at all: not `sim`, not `fx`, never
 * `Math.random`. Its only source of per-track variation is a hash of the track
 * *name* (`hashName`), which seeds micro-detail (the bass sway rate, the chord
 * count) deterministically. Same name → bit-identical buffer every boot, so a
 * track can be taste-tuned and a test can assert it byte-for-byte (`mix.test.ts`
 * M11). Everything that distinguishes one track from another is authored in its
 * `MusicSynth` spec below, not drawn.
 */

/* Trigonometry note: this module is `src/audio`, which CLAUDE.md rule 3's
 * determinism guard does not scan (only `sim`, `content`, `core`, `game` are).
 * `Math.sin`/`Math.imul` here reach the speakers and stop; they never integrate
 * into a position, so the exact-trig rule does not bind them — the same licence
 * `audio/index.ts` already takes. */

import { AudioOutput } from './output';

/**
 * A track's composition, read by the additive engine below. Every field is
 * optional and every default is the darkest, quietest choice — a track that
 * names only a `root` is still a coherent 入神 loop.
 *
 * The three aaajiao filters live in these fields, not in prose:
 *  - **做减法 (subtraction):** `voices` is hard-capped at three. If a track
 *    works with a voice removed, it names two. Never more.
 *  - **Internet Void (behavior over content):** the loop is negative space. Its
 *    voices sit sub-400Hz and its melodic notes are gated to silence at every
 *    slot boundary, so the 1.5–3kHz behavior band — where the player's own
 *    graze/pickup cues live — stays measurably empty. The player's play is the
 *    lead the mix is missing.
 *  - **入神 / 出神 (absorption / trance):** `stance` drives the whole envelope.
 *    `absorption` is the equal-tempered pulse a threading player sinks into;
 *    `trance` removes the floor — `detune` unmoors the pitch, the pulse voice
 *    drops out, the envelopes widen. They are opposites and must sound like it.
 */
export interface MusicSynth {
  /**
   * Tonic frequency, in Hz. Absent means one derived from the track name's
   * hash, so two tracks sound different without either naming a number. Kept in
   * the 38–55Hz institutional band.
   */
  root?: number;
  /** Semitone offsets of the scale, e.g. minor `[0,2,3,5,7,8,10]`. Default minor. */
  mode?: number[];
  /** Loop length in seconds, 6–24. Replaces the old fixed 6s drone. */
  loopSeconds?: number;
  /**
   * Octaves the lead sits above the tonic. **Default 1** — `2^1 = 2` reproduces
   * the historical `rootHz * 2` bit-for-bit, so any spec omitting this field (and
   * every guest-pack track) renders identically: backward-compat and replay
   * determinism hold by construction, not by luck. The base tracks all set `3`
   * explicitly, lifting the melody from the sub-220Hz negative space (where the
   * ear does not parse melody) into the perceptible 300–1000Hz mid-lane, while the
   * 1.5–3kHz behavior band stays SFX-only. Fractional allowed (a "too piercing"
   * verdict is a `3 → 2.7` edit); the seam discipline holds for any octave, since
   * `snapCycles` still rounds to whole cycles and `noteEnvelope` still zeros at
   * slot edges.
   */
  leadOctave?: number;
  /** Beat slots the lead and pulse are gridded onto. Default 8. */
  beatsPerLoop?: number;
  /** Which voices sound. Capped at three, 做减法; a fourth is dropped, not summed. */
  voices?: ('bass' | 'lead' | 'pulse')[];
  /**
   * The lead phrase, as scale-degree indices into `mode`. Negative indices and
   * indices past the mode length wrap by octave, so an inversion is `[-x]` and an
   * upper register is `[+n]`. A `NaN` entry is a rest. Slots past the motif's end
   * are rests too — that is where the structural silence comes from.
   */
  motif?: number[];
  /** Detune, in cents. Zero for 入神; nonzero unmoors the pitch for 出神. */
  detune?: number;
  /** `absorption` (入神, the default) or `trance` (出神). */
  stance?: 'absorption' | 'trance';
}

export interface MusicSpec {
  /** Generated procedurally when absent, as with sounds. */
  url?: string;
  /**
   * Loop region, in seconds. Playback starts at 0 so any intro runs once, then
   * the region `[loopStart, loopEnd)` repeats forever. Both are clamped to the
   * decoded buffer at play time — the duration is only knowable after decode, so
   * an out-of-range pair falls back to looping the whole track rather than
   * throwing. `loopStart` defaults to 0 and `loopEnd` to the buffer end.
   */
  loopStart?: number;
  loopEnd?: number;
  volume?: number;
  /**
   * Tuning for the synthesised placeholder. A decoded `url` takes precedence,
   * but the synth remains the failure floor when that asset cannot be fetched
   * or decoded.
   */
  synth?: MusicSynth;
}

/** A registered track, every default resolved. */
interface Music_ {
  readonly url: string | undefined;
  readonly loopStart: number;
  readonly loopEnd: number | undefined;
  readonly volume: number;
  readonly synth: MusicSynth | undefined;
}

/** Well under the SFX table (shots ~0.3): the theme must never bury a cue. */
const DEFAULT_TRACK_VOLUME = 0.7;

const registry = new Map<string, Music_>();

/** Spec values arrive from content files unvalidated; NaN would poison a gain. */
function finite(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number | undefined, fallback: number): number {
  const v = finite(value, fallback);
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

/**
 * Register a track, or replace one already registered.
 *
 * Like `defineSound`, a duplicate name is deliberately not an error: the built-in
 * placeholders exist to be replaced, and a content file (or a pack) swapping one
 * for a real asset must not require editing this module — that would make the
 * engine own the content.
 *
 * Loop-point sanity that needs the decoded duration is checked at play time, and
 * for packs the manifest checks the `start < end` shape. Here the only guard is
 * against NaN reaching a scheduler.
 */
export function defineMusic(name: string, spec: MusicSpec): void {
  registry.set(name, {
    url: spec.url,
    loopStart: Math.max(0, finite(spec.loopStart, 0)),
    loopEnd:
      spec.loopEnd !== undefined && Number.isFinite(spec.loopEnd)
        ? spec.loopEnd
        : undefined,
    volume: clamp01(spec.volume, DEFAULT_TRACK_VOLUME),
    synth: spec.synth,
  });
}

/**
 * Overlay a partial replacement onto a registered track.
 *
 * Pack assets use this seam instead of `defineMusic`: adding a `url` must not
 * discard the built-in synth that keeps a missing or undecodable file audible,
 * nor should an omitted mix or loop field reset edition-authored defaults.
 * A name that does not exist yet is still legal and receives the ordinary
 * `defineMusic` defaults, so packs may introduce their own tracks too.
 *
 * `defineMusic` deliberately keeps its historical whole-entry overwrite
 * semantics. The distinction is useful: authored code can replace a definition
 * outright, while a fetched asset can safely decorate the built-in floor.
 */
export function replaceMusic(name: string, spec: MusicSpec): void {
  const previous = registry.get(name);
  if (!previous) {
    defineMusic(name, spec);
    return;
  }

  registry.set(name, {
    url: spec.url ?? previous.url,
    loopStart: Math.max(0, finite(spec.loopStart, previous.loopStart)),
    loopEnd:
      spec.loopEnd !== undefined && Number.isFinite(spec.loopEnd)
        ? spec.loopEnd
        : previous.loopEnd,
    volume: clamp01(spec.volume, previous.volume),
    synth: spec.synth ?? previous.synth,
  });
}

export function musicNames(): readonly string[] {
  return [...registry.keys()];
}

/**
 * The phrase geometry of a registered track — its beat grid and how many of those
 * slots actually sound a lead note — derived exactly as `compose()` reads the spec.
 *
 * Exposed so `mix.test.ts` (M15′, the phrase-density floor that encodes "a phrase,
 * not a blip") and `tools/measure-audio.ts` measure the sounded-slot count from its
 * single source of truth rather than re-deriving the slot defaults and drifting. Pure
 * and deterministic — no RNG, no context, the same discipline as the composer. Returns
 * `undefined` for a name with no registered synth (a `url` track carries no phrase).
 */
export function trackPhrase(
  name: string,
): { beats: number; sounded: number; trance: boolean } | undefined {
  const music = registry.get(name);
  if (!music || !music.synth) return undefined;
  const synth = music.synth;
  const beats = Math.max(1, Math.round(finite(synth.beatsPerLoop, 8)));
  const motif = synth.motif ?? [];
  let sounded = 0;
  for (let s = 0; s < beats; s++) {
    const deg = motif[s];
    if (deg !== undefined && !Number.isNaN(deg)) sounded++;
  }
  return { beats, sounded, trance: synth.stance === 'trance' };
}

/* ------------------------------------------------------------------ */
/* Synthesis — the additive composer                                   */
/* ------------------------------------------------------------------ */

/**
 * BGM is rendered at 22050Hz, not the context's usual 44100. Every voice lives
 * under ~400Hz, far below the 11025Hz Nyquist, so nothing is lost — but the
 * decoded buffer halves in memory and the render is band-limited away from the
 * behavior band in one move. WebAudio resamples on playback (browser-only path,
 * unmeasurable here — see `mix.test.ts` M13, a boot check).
 */
const BGM_RATE = 22050;

/** Peak sample the loop is attenuated to if it would exceed it. Well under explosion's 0.55,
 * and low enough that the summed RMS stays a negative space beneath the SFX (mix.test M1/M2). */
const BGM_PEAK = 0.4;

/** Loop length when a track names none. */
const DEFAULT_LOOP_SECONDS = 16;

/** Per-voice gains. Tuned so the summed peak lands near `BGM_PEAK`; the clamp is the floor.
 * The lead is now the primary voice (0.40 > bass 0.24): this is what kills the scout's
 * "the lead is the quietest voice", the mechanical cause of "人类基本听不出来". The bass
 * recedes (it was the RMS/centroid winner masking the melody); the pulse keeps its 0.30 —
 * it is the tempo spine the 16-slot phrases walk on. */
const BASS_AMP = 0.24;
const LEAD_AMP = 0.4;
const PULSE_AMP = 0.3;

/** Generic default scale — semitone offsets from the tonic. */
const MINOR = [0, 2, 3, 5, 7, 8, 10];

/** FNV-1a over the name: deterministic, so a track always sounds the same. */
function hashName(name: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Cycles that complete a **whole** number of times over the loop, ≥1. The seam discipline. */
function snapCycles(hz: number, loopSeconds: number): number {
  return Math.max(1, Math.round(hz * loopSeconds));
}

/** A scale degree (wrapping by octave for negatives and indices past the mode) to semitones. */
function degreeToSemitone(mode: number[], degree: number): number {
  const n = mode.length;
  const oct = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return (mode[idx] as number) + 12 * oct;
}

/** Distance on the unit circle, [0, 0.5] — for the periodic bass windows. */
function circularDistance(a: number, b: number): number {
  let d = Math.abs(a - b) % 1;
  if (d > 0.5) d = 1 - d;
  return d;
}

/**
 * A melodic note's envelope within its slot, local position `u` in [0,1).
 *
 * Attack to a peak, exponential decay, and a `(1 - u)` factor that forces the
 * value to **exactly zero at the slot boundary**. This is the seam-as-rest
 * graft: it is why the loop wraps click-free (every melodic voice is zero at
 * t=0 and t=1) AND why the structural rests exist (a slot with no note is
 * silent) — 做减法 and click-free are the one mechanism. 出神 widens the tail.
 */
function noteEnvelope(u: number, trance: boolean): number {
  // Absorption onset sharpened 0.06 → 0.03: a faster attack both cuts under the SFX
  // transient and articulates each note of the 16-slot phrase (density is half the cure).
  // Trance stays 0.12 — 出神 keeps its veiled, unmoored onset.
  const attack = trance ? 0.12 : 0.03;
  const decay = trance ? 1.4 : 3;
  const a = u < attack ? u / attack : Math.exp(-decay * (u - attack));
  return a * (1 - u);
}

/** A pulse hit's envelope across its short window `v` in [0,1). Zero at both ends. */
function pulseEnvelope(v: number): number {
  const a = v < 0.1 ? v / 0.1 : Math.exp(-6 * (v - 0.1));
  return a * (1 - v);
}

/**
 * Compose one loop from a `MusicSynth`, as a sum of additive terms — no node
 * graph, no RNG. Every voice's frequency is snapped to whole cycles over the
 * buffer, so the bass drone crosses the seam continuously; every melodic note is
 * enveloped to zero at its slot edges, so the lead and pulse never cross it at
 * all. The peak is attenuated (never amplified) to `BGM_PEAK`, so the mix keeps
 * its headroom under the SFX.
 */
function compose(
  ctx: BaseAudioContext,
  name: string,
  synth: MusicSynth | undefined,
): AudioBuffer {
  const h = hashName(name);
  const loopSeconds = clamp(finite(synth?.loopSeconds, DEFAULT_LOOP_SECONDS), 6, 24);
  const length = Math.max(1, Math.round(loopSeconds * BGM_RATE));
  const buffer = ctx.createBuffer(1, length, BGM_RATE);
  const data = buffer.getChannelData(0);

  const mode = synth?.mode ?? MINOR;
  const rootHz = synth?.root ?? 44 + (h % 12);
  const trance = synth?.stance === 'trance';
  const detuneMul = Math.pow(2, finite(synth?.detune, 0) / 1200);
  const beats = Math.max(1, Math.round(finite(synth?.beatsPerLoop, 8)));
  const motif = synth?.motif ?? [];

  // 做减法: at most three voices, and the pulse never survives 出神.
  const voices = (synth?.voices ?? ['bass', 'lead']).slice(0, 3);
  const hasBass = voices.includes('bass');
  const hasLead = voices.includes('lead');
  const hasPulse = voices.includes('pulse') && !trance;

  // Bass: an institutional falling line, i–VII–VI–V, truncated by the loop's own
  // hash so the arc is real (2–4 chord roots) and not a static drone. Each root
  // is a whole-cycle partial under a periodic Hann window; the windows overlap
  // 50% and sum to a constant, so the bass amplitude holds while its pitch moves.
  const DESCENT = [0, -2, -4, -5];
  const nRoots = 2 + (h % 3);
  const bassCycles: number[] = [];
  for (let k = 0; k < nRoots; k++) {
    const semi = DESCENT[k] as number;
    bassCycles.push(snapCycles(rootHz * Math.pow(2, semi / 12) * detuneMul, loopSeconds));
  }
  const bassSway = 2 + ((h >> 8) % 3);

  // Lead: `leadOctave` octaves above the tonic for presence. Default 1 → `rootHz * 2`,
  // the historical value bit-for-bit; the base tracks set 3, lifting the melody into
  // the perceptible 300–1000Hz lane while the behavior band stays SFX-only.
  const leadBaseHz = rootHz * Math.pow(2, finite(synth?.leadOctave, 1)) * detuneMul;
  const leadCycles: number[] = [];
  for (let s = 0; s < beats; s++) {
    const deg = motif[s];
    if (deg === undefined || Number.isNaN(deg)) {
      leadCycles.push(0);
      continue;
    }
    const hz = leadBaseHz * Math.pow(2, degreeToSemitone(mode, deg) / 12);
    leadCycles.push(snapCycles(hz, loopSeconds));
  }

  // Pulse: a sub-200Hz thud on the beat grid — never in the behavior band.
  const pulseCycles = snapCycles(Math.min(rootHz * detuneMul, 180), loopSeconds);
  const PULSE_WIDTH = 0.18;

  const TAU = Math.PI * 2;
  let peak = 0;
  for (let i = 0; i < length; i++) {
    const t = i / length;
    let sample = 0;

    if (hasBass) {
      let bass = 0;
      for (let k = 0; k < nRoots; k++) {
        const center = (k + 0.5) / nRoots;
        const hw = 1 / nRoots;
        const d = circularDistance(t, center);
        if (d < hw) {
          const w = 0.5 * (1 + Math.cos((Math.PI * d) / hw));
          bass += w * Math.sin(TAU * (bassCycles[k] as number) * t);
        }
      }
      const sway = 0.78 + 0.22 * Math.sin(TAU * bassSway * t);
      sample += BASS_AMP * bass * sway;
    }

    if (hasLead) {
      const slot = Math.min(beats - 1, Math.floor(t * beats));
      const cyc = leadCycles[slot] as number;
      if (cyc > 0) {
        const u = t * beats - slot;
        // PASS 2 (held, gated on the ear): the lead harmonic stack goes HERE, replacing
        // this single sine with AMPS = [1.0, 0.45, 0.20] over whole-cycle partials, a 1500Hz
        // guard breaking before any partial enters the behavior band. Seam-safe and RNG-free
        // by construction. It is NOT built in pass 1 — ship the measurable density+register
        // substrate first, so an ear-reject of "thin/beepy" is isolable to this one lever.
        // See design-bgm-binding.md §1 "Held for pass 2".
        sample += LEAD_AMP * noteEnvelope(u, trance) * Math.sin(TAU * cyc * t);
      }
    }

    if (hasPulse) {
      const beatPos = t * beats;
      const u = beatPos - Math.floor(beatPos);
      if (u < PULSE_WIDTH) {
        sample += PULSE_AMP * pulseEnvelope(u / PULSE_WIDTH) * Math.sin(TAU * pulseCycles * t);
      }
    }

    data[i] = sample;
    const a = Math.abs(sample);
    if (a > peak) peak = a;
  }

  if (peak > BGM_PEAK) {
    const scale = BGM_PEAK / peak;
    for (let i = 0; i < length; i++) data[i] = (data[i] as number) * scale;
  }

  return buffer;
}

/* ------------------------------------------------------------------ */
/* Playback                                                            */
/* ------------------------------------------------------------------ */

/** The one track currently sounding, or the one fading out under a crossfade. */
interface Playing {
  readonly name: string;
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
}

interface BufferedMusic {
  readonly music: Music_;
  readonly buffer: AudioBuffer;
}

interface MusicLoad {
  readonly music: Music_;
  readonly promise: Promise<void>;
}

export interface MusicOptions {
  readonly masterVolume?: number;
  /** Inject the same output into `Audio` and `Music` to share one context. */
  readonly output?: AudioOutput;
}

export class Music {
  readonly #output: AudioOutput;
  #ctx: AudioContext | undefined;
  /** The music bus. Its ceiling sits under the SFX so the theme never buries a cue. */
  #master: GainNode | undefined;
  #masterVolume: number;
  #unlocked = false;
  #unlocking: Promise<void> | undefined;

  #buffers = new Map<string, BufferedMusic>();
  /** The newest in-flight definition per name; every waiter shares its promise. */
  #inflight = new Map<string, MusicLoad>();
  /**
   * URL failures remembered by track name. The shell reconciles music every
   * tick; without this guard a guest track with no synth would refetch sixty
   * times a second forever. Storing the URL, rather than only the name, still
   * permits a later replacement asset for the same track to be attempted.
   */
  #failedUrls = new Map<string, string>();

  /** The track sounding now, and the one it is fading out over. */
  #playing: Playing | undefined;
  #fading: Playing | undefined;

  /** The track this instance intends to be playing — set only once it starts. */
  #current: string | undefined;

  constructor(options?: MusicOptions) {
    this.#output = options?.output ?? new AudioOutput();
    this.#masterVolume = clamp01(options?.masterVolume, 0.55);
  }

  /**
   * Start the audio graph. Browsers refuse to run one outside a user gesture, so
   * the shell calls this from the same first input that unlocks the sound engine.
   * Where WebAudio does not exist this is harmless: the game stays silent and
   * `unlocked` stays false.
   */
  async unlock(): Promise<void> {
    if (this.#unlocked) return;
    const pending = this.#unlocking;
    if (pending) return pending;

    this.#unlocking = this.#start();
    try {
      await this.#unlocking;
    } finally {
      this.#unlocking = undefined;
    }
  }

  async #start(): Promise<void> {
    const ctx = await this.#output.unlock();
    if (!ctx) return;

    try {
      const master = this.#output.bus('music');
      if (!master) return;
      master.gain.value = this.#masterVolume;

      this.#ctx = ctx;
      this.#master = master;
      this.#unlocked = true;
      // Nothing is started here. `#current` stays undefined, so the shell's
      // reconcile — which compares `run.music` against `current` every tick —
      // starts the intended track on the first tick after unlock. That is the
      // same idempotent path a stage change takes; unlock needs no special case.
    } catch {
      this.#ctx = undefined;
      this.#master = undefined;
      this.#unlocked = false;
    }
  }

  /**
   * Play `name`, crossfading from whatever is playing over `fadeSeconds`.
   *
   * Idempotent: playing the track already current is a no-op, which is what lets
   * the shell call this every tick and only actually switch on a real change.
   * Before unlock, or while a `url` track is still decoding, this leaves
   * `current` unset and returns — the next reconcile tick simply tries again.
   */
  play(name: string, fadeSeconds = 0): void {
    const spec = registry.get(name);
    if (!spec) return;
    if (name === this.#current) return;

    const ctx = this.#ctx;
    const master = this.#master;
    if (!ctx || !master) return;

    try {
      const buffer = this.#ensure(name, spec);
      if (!buffer) return; // A url still loading; retry on the next reconcile.

      const now = ctx.currentTime;
      const fade = fadeSeconds > 0 ? fadeSeconds : 0;

      const gain = ctx.createGain();
      if (fade > 0) {
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(spec.volume, now + fade);
      } else {
        gain.gain.setValueAtTime(spec.volume, now);
      }
      gain.connect(master);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      // Only now, with the buffer decoded, is its duration known — so the loop
      // region is clamped here rather than at registration. An inverted or
      // out-of-range pair falls back to looping the whole track.
      const start = clamp(spec.loopStart, 0, buffer.duration);
      const end =
        spec.loopEnd !== undefined ? clamp(spec.loopEnd, 0, buffer.duration) : buffer.duration;
      if (end > start) {
        source.loopStart = start;
        source.loopEnd = end;
      }
      source.connect(gain);
      source.start();

      // Fade the outgoing track out under the incoming, on the audio clock.
      this.#fadeOut(now, fade);
      this.#playing = { name, source, gain };
      this.#current = name;
    } catch {
      // Audio must never throw into the frame that reconciled it.
    }
  }

  /**
   * Decode named tracks without starting a voice.
   *
   * Boss intros are one-shot material: waiting until the arrival frame to begin
   * their first URL decode can put the audible attack behind the visual one on
   * a cold cache. The shell warms the small authored boss set after unlock,
   * while guest tracks and the rest of the open registry remain lazy.
   */
  async preload(names: readonly string[] = musicNames()): Promise<void> {
    if (!this.#ctx) return;
    const waits: Promise<void>[] = [];
    for (const name of names) {
      const spec = registry.get(name);
      if (!spec) continue;
      try {
        this.#ensure(name, spec);
        const load = this.#inflight.get(name);
        if (load?.music === spec) waits.push(load.promise);
      } catch {
        // Preloading is an optimisation. The normal play/fallback path remains
        // the authority, and no failed warm-up may escape into the game loop.
      }
    }
    await Promise.allSettled(waits);
  }

  /**
   * Fade the current track to silence and stop it on the clock. Only ever one
   * track fades at a time — a fresh change drops any still-fading outgoing
   * immediately, exactly as `Background.transitionTo` drops an in-flight scene.
   */
  #fadeOut(now: number, fade: number): void {
    // A previous fade still in flight: cut it now rather than layer a second.
    if (this.#fading) this.#stop(this.#fading);
    this.#fading = undefined;

    const out = this.#playing;
    if (!out) return;

    try {
      if (fade > 0) {
        const g = out.gain.gain;
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(0, now + fade);
        out.source.stop(now + fade);
        out.source.onended = () => this.#release(out);
        this.#fading = out;
      } else {
        this.#stop(out);
      }
    } catch {
      this.#stop(out);
    }
    this.#playing = undefined;
  }

  #stop(voice: Playing): void {
    try {
      voice.source.stop();
    } catch {
      // Already stopped, or never started.
    }
    this.#release(voice);
    if (this.#fading === voice) this.#fading = undefined;
  }

  #release(voice: Playing): void {
    try {
      voice.source.disconnect();
      voice.gain.disconnect();
    } catch {
      // Already torn down.
    }
  }

  /** Stop everything and forget what was playing — a hard reset, not a fade. */
  stopAll(): void {
    if (this.#playing) this.#stop(this.#playing);
    if (this.#fading) this.#stop(this.#fading);
    this.#playing = undefined;
    this.#fading = undefined;
    this.#current = undefined;
  }

  /** The track intended to be playing, or `undefined` before the first starts. */
  get current(): string | undefined {
    return this.#current;
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

  /** The buffer for a track, generating or fetching it on first ask. */
  #ensure(name: string, music: Music_): AudioBuffer | undefined {
    const cached = this.#buffers.get(name);
    if (cached?.music === music) return cached.buffer;
    if (cached) this.#buffers.delete(name);

    const ctx = this.#ctx;
    if (!ctx) return undefined;

    if (music.url !== undefined) {
      if (this.#failedUrls.get(name) === music.url) {
        if (!music.synth) return undefined;
        const buffer = compose(ctx, name, music.synth);
        this.#buffers.set(name, { music, buffer });
        return buffer;
      }
      void this.#startLoad(name, music, ctx);
      return undefined; // Silent until the fetch lands.
    }

    const buffer = compose(ctx, name, music.synth);
    this.#buffers.set(name, { music, buffer });
    return buffer;
  }

  #startLoad(name: string, music: Music_, ctx: AudioContext): Promise<void> {
    const existing = this.#inflight.get(name);
    if (existing?.music === music) return existing.promise;

    let promise: Promise<void>;
    promise = this.#load(name, music, ctx).finally(() => {
      if (this.#inflight.get(name)?.promise === promise) this.#inflight.delete(name);
    });
    this.#inflight.set(name, { music, promise });
    return promise;
  }

  async #load(name: string, music: Music_, ctx: AudioContext): Promise<void> {
    let loaded = false;
    try {
      const response = await fetch(music.url as string);
      if (!response.ok) return;
      const encoded = await response.arrayBuffer();
      const buffer = await ctx.decodeAudioData(encoded);
      if (this.#ctx === ctx && registry.get(name) === music) {
        this.#buffers.set(name, { music, buffer });
        this.#failedUrls.delete(name);
        loaded = true;
      }
    } catch {
      // The fallback below is the total-degradation path. The failure never
      // reaches the caller, which runs inside a frame's reconcile step.
    } finally {
      if (!loaded) this.#installFallback(name, music, ctx);
    }
  }

  /**
   * Remember one failed URL and, for an overlaid built-in track, restore its
   * synthesised floor. A genuinely new URL-only track has no floor and remains
   * silent after one attempt rather than becoming a retry storm.
   */
  #installFallback(name: string, music: Music_, ctx: AudioContext): void {
    // A replacement may have landed while the old URL was in flight. Never
    // install that stale request's fallback over the newer definition.
    if (this.#ctx !== ctx || registry.get(name) !== music) return;
    this.#failedUrls.set(name, music.url as string);
    if (!music.synth) return;

    try {
      this.#buffers.set(name, { music, buffer: compose(ctx, name, music.synth) });
    } catch {
      // Even a hostile synth spec may only make this track silent.
    }
  }
}
