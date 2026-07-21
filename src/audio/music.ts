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
 * silence. As with sounds (CLAUDE.md rule 9) the permanent floor is a
 * synthesised placeholder — a dark drone per track — so the game is never
 * blocked on an asset and never tempted to borrow one. A track given a `url`
 * loads that file instead, and swapping a placeholder for real work is one
 * `defineMusic` call.
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
 * with the readability of play. Its own `AudioContext`, separate from the sound
 * engine's, is what lets the shell duck music on pause without touching a single
 * SFX voice.
 *
 * ## Randomness
 *
 * The drone's per-track variation is seeded from a hash of the track *name*, not
 * from any RNG stream and never from `Math.random`. Audio is `fx`-side, but a
 * placeholder that changed run to run could not be taste-tuned, so it is made
 * reproducible instead — the same name always synthesises the same drone.
 */

/* Trigonometry note: this module is `src/audio`, which CLAUDE.md rule 3's
 * determinism guard does not scan (only `sim`, `content`, `core`, `game` are).
 * `Math.sin`/`Math.imul` here reach the speakers and stop; they never integrate
 * into a position, so the exact-trig rule does not bind them — the same licence
 * `audio/index.ts` already takes. */

export interface MusicSynth {
  /**
   * Base frequency of the placeholder drone, in Hz. Absent means one derived
   * from the track name's hash, so two tracks sound different without either
   * naming a number.
   */
  root?: number;
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
  /** Tuning for the synthesised placeholder; ignored once a `url` is present. */
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

/**
 * The track the title and menu screens sit on. Named here rather than as a bare
 * string in the shell so both the shell and `reachability.test.ts` mean the same
 * thing by "the menu names a track": a registered track nothing reaches is dead
 * content, and the menu is what reaches this one.
 */
export const MENU_MUSIC = 'menu';

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

export function musicNames(): readonly string[] {
  return [...registry.keys()];
}

/* ------------------------------------------------------------------ */
/* Synthesis — the dark-drone floor                                    */
/* ------------------------------------------------------------------ */

/** Seconds of the generated loop. A few seconds, seamless — see `drone`. */
const DRONE_SECONDS = 6;

/** Peak sample of the drone before the track and master gains scale it down. */
const DRONE_PEAK = 0.5;

/** FNV-1a over the name: deterministic, so a track always sounds the same. */
function hashName(name: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * A low, quiet, seamless drone stand-in for a track nobody has authored yet.
 *
 * Every partial and the amplitude sway complete a **whole** number of cycles
 * across the buffer, so the whole-track loop wraps with no click — that is what
 * lets the placeholder default to `loopEnd = buffer end` and still loop cleanly.
 * The pitch sits in the bass so it cannot mask a bullet's SFX cue.
 */
function drone(ctx: BaseAudioContext, name: string, synth: MusicSynth | undefined): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.round(DRONE_SECONDS * rate));
  const buffer = ctx.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);

  const h = hashName(name);

  // A low root, whole cycles over the loop so it wraps seamlessly. The name's
  // hash spreads tracks across a small band so they are audibly distinct.
  const rootHz = synth?.root ?? 44 + (h % 12);
  const rootCycles = Math.max(1, Math.round(rootHz * DRONE_SECONDS));
  // A quiet fifth and octave for colour — rounded to keep whole cycles.
  const fifthCycles = Math.round(rootCycles * 1.5);
  const octaveCycles = rootCycles * 2;
  // A slow breath over the whole loop; integer so it too wraps cleanly.
  const swayCycles = 2 + ((h >> 8) % 3);

  const TAU = Math.PI * 2;
  const norm = 1 / (1 + 0.5 + 0.28);
  for (let i = 0; i < length; i++) {
    const t = i / length;
    const tone =
      Math.sin(TAU * rootCycles * t) +
      0.5 * Math.sin(TAU * fifthCycles * t) +
      0.28 * Math.sin(TAU * octaveCycles * t);
    const sway = 0.72 + 0.28 * Math.sin(TAU * swayCycles * t);
    data[i] = tone * norm * sway * DRONE_PEAK;
  }

  return buffer;
}

/* ------------------------------------------------------------------ */
/* Playback                                                            */
/* ------------------------------------------------------------------ */

type AudioContextCtor = new () => AudioContext;

/**
 * WebAudio is looked up, never referenced directly — `bun test` has no
 * `AudioContext`, and a module reading the global at load time could not be
 * imported there. This is the exact shape `audio/index.ts` uses.
 */
function audioContextCtor(): AudioContextCtor | undefined {
  const scope = globalThis as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext;
}

function discard(ctx: AudioContext | undefined): void {
  try {
    void ctx?.close().catch(() => undefined);
  } catch {
    // No `close`, or a context that never started. Nothing further to try.
  }
}

/** The one track currently sounding, or the one fading out under a crossfade. */
interface Playing {
  readonly name: string;
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
}

export class Music {
  #ctx: AudioContext | undefined;
  /** The music bus. Its ceiling sits under the SFX so the theme never buries a cue. */
  #master: GainNode | undefined;
  #masterVolume: number;
  #unlocked = false;
  #unlocking: Promise<void> | undefined;

  #buffers = new Map<string, AudioBuffer>();
  #loading = new Set<string>();

  /** The track sounding now, and the one it is fading out over. */
  #playing: Playing | undefined;
  #fading: Playing | undefined;

  /** The track this instance intends to be playing — set only once it starts. */
  #current: string | undefined;

  constructor(options?: { masterVolume?: number }) {
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
    const Ctor = audioContextCtor();
    if (!Ctor) return;

    let ctx: AudioContext | undefined;
    try {
      ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = this.#masterVolume;
      master.connect(ctx.destination);

      if (ctx.state === 'suspended') await ctx.resume();

      this.#ctx = ctx;
      this.#master = master;
      this.#unlocked = true;
      // Nothing is started here. `#current` stays undefined, so the shell's
      // reconcile — which compares `run.music` against `current` every tick —
      // starts the intended track on the first tick after unlock. That is the
      // same idempotent path a stage change takes; unlock needs no special case.
    } catch {
      discard(ctx);
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
    if (cached) return cached;

    const ctx = this.#ctx;
    if (!ctx) return undefined;

    if (music.url !== undefined) {
      void this.#load(name, music.url);
      return undefined; // Silent until the fetch lands.
    }

    const buffer = drone(ctx, name, music.synth);
    this.#buffers.set(name, buffer);
    return buffer;
  }

  async #load(name: string, url: string): Promise<void> {
    if (this.#loading.has(name)) return;
    this.#loading.add(name);

    try {
      const response = await fetch(url);
      if (!response.ok) return;
      const encoded = await response.arrayBuffer();
      const buffer = await this.#ctx?.decodeAudioData(encoded);
      if (buffer) this.#buffers.set(name, buffer);
    } catch {
      // A missing or undecodable track stays silent; the failure never reaches
      // the caller, which runs inside the reconcile step of a frame.
    } finally {
      this.#loading.delete(name);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Built-in tracks                                                     */
/* ------------------------------------------------------------------ */

// The launch set, kept small (decisions-bgm): the menu, one theme per built-in
// stage, one boss theme every boss shares, and one per-card track. Each is a
// synthesised drone until a content file or a pack gives it a `url`. Their names
// are wired onto the built-in stages and bosses (`StageSpec.music` /
// `BossSpec.music` / `SpellCard.music`) so the feature is real, not merely
// registered — the honesty rule that `reachability.test.ts` enforces for music
// the same way it does for scenes.
defineMusic(MENU_MUSIC, {});
defineMusic('vigil', {});
defineMusic('descent', {});
defineMusic('nemesis', {});
// The one per-spell-card track: sentinel's Lunatic-only fourth card names it (the
// first `SpellCard.music` in the game), so it is reached only on Lunatic — which
// is why `reachability.test.ts`'s music check unions the Lunatic run for it.
defineMusic('zenith', {});
// Stage 3's theme, named by `stages['stage-3'].music`. The heaviest, slowest
// settling in the game: the root is pinned to the bottom of the drone band (44Hz,
// the floor `hashName` can reach) so two close low tones beat against each other
// as ballast — "what was decided before you arrived binds you," the metronome the
// enemies play against. Pinned rather than name-derived so the weight is a
// property of the track, not of how its letters happen to hash.
defineMusic('precedent', { synth: { root: 44 } });
// Stage 3's Lunatic-only final card (`Fiat "Sealed"`) names this via
// `SpellCard.music`, the second per-card track after `zenith` and reached the
// same way — only on the shared Lunatic run. Pitched a little higher than
// `precedent` (55Hz, the top of the band) so it reads as drier and closer: the
// moment the court stops hearing and simply decrees.
defineMusic('fiat', { synth: { root: 55 } });

// Stage 4's theme, named by `stages['stage-4'].music`. The terminal register:
// pinned a hair below `precedent`'s 44 — the single lowest STAGE tone in the
// game, stage 4 felt beneath stage 3 more than heard. The descending progression
// 44 (precedent) → 41 (ordinance) → 38 (adjourn) is the whole band settling. Pinned
// rather than name-derived so the weight is a property of the track. Registered
// live now that its declarer exists (`stages['stage-4'].music: 'ordinance'` in
// `base-pack.json`): `reachability.test.ts`'s music-honesty check binds the two
// in both directions — a track no stage names is dead content, a stage naming a
// track no one registers is an equally loud red — so they cannot drift apart.
defineMusic('ordinance', { synth: { root: 41 } });

// The ending track: the shell's ENDING screen crossfades to it on every clear
// (`states.ts`'s `EndingScreenState`, read off the stack in `main.ts` the same way
// `MENU_MUSIC` is). Pinned to 38 — BELOW the entire authority band (44–55) and
// below even the stage floor: you have gone beneath everything. When the Regent
// falls the music must audibly change — the apparatus going quiet is the reveal,
// and carrying the fight or menu track through it would undercut that. A single
// hollow low tone.
defineMusic('adjourn', { synth: { root: 38 } });
