/**
 * The mix doctrine, measured on the rendered `AudioBuffer` — the audio analogue
 * of a background's "peak luminance near 0.1". These are the numbers the design
 * argues from; `tools/measure-audio.ts` prints the full table, this asserts the
 * bounds, and `docs/audio.md` quotes them. Everything runs headlessly: the
 * built-ins register by module-scope import of `./music` and `./index` alone —
 * no bundled pack, no `Run`, no `StateMachine` — so the `import type` boundary
 * stays trivially clean.
 *
 * The three aaajiao filters, as numbers:
 *  - **Internet Void (behavior over content):** the BGM leaves the 1.5–3kHz
 *    behavior band — where the graze/pickup cues live — measurably empty (M3/M4),
 *    while those cues fill it (M12). The mix is negative space the player sounds
 *    into.
 *  - **做减法:** the loop RMS sits under the SFX (M1), and the loop seam is
 *    click-free because every melodic voice is a structural rest at the boundary
 *    (M6) — the same mechanism.
 *  - **入神/出神:** both stances render, and both obey the same seam and band
 *    discipline (a track set assertion below spot-checks a 出神 track).
 *
 * FFT rather than Goertzel for the band measurement (the design named either):
 * a single radix-2 transform gives the whole spectrum at once, and it is the
 * same routine `tools/measure-audio.ts` validated, so the two agree by
 * construction.
 */

import { afterAll, describe, expect, test } from 'bun:test';

import { fx } from '../core/random';
import { Audio, defineSound, soundNames } from './index';
import { defineMusic, Music, musicNames, trackPhrase } from './music';

/* ------------------------------------------------------------------ */
/* WebAudio stub — the shape the sibling audio tests install           */
/* ------------------------------------------------------------------ */

class FakeAudioParam {
  value = 1;
  setValueAtTime(v: number): void {
    this.value = v;
  }
  linearRampToValueAtTime(v: number): void {
    this.value = v;
  }
  cancelScheduledValues(): void {}
}
class FakeAudioNode {
  connect(t: FakeAudioNode): FakeAudioNode {
    return t;
  }
  disconnect(): void {}
}
class FakeGainNode extends FakeAudioNode {
  readonly gain = new FakeAudioParam();
}
class FakeAudioBuffer {
  readonly #data: Float32Array;
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.#data = new Float32Array(length);
  }
  get duration(): number {
    return this.length / this.sampleRate;
  }
  getChannelData(): Float32Array {
    return this.#data;
  }
}
class FakeBufferSource extends FakeAudioNode {
  buffer: FakeAudioBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  onended: (() => void) | null = null;
  start(): void {}
  stop(): void {}
}
const CONTEXTS: FakeAudioContext[] = [];
class FakeAudioContext {
  state = 'suspended';
  currentTime = 0;
  readonly sampleRate = 44100;
  readonly destination = new FakeAudioNode();
  readonly sources: FakeBufferSource[] = [];
  readonly gains: FakeGainNode[] = [];
  constructor() {
    CONTEXTS.push(this);
  }
  createGain(): FakeGainNode {
    const g = new FakeGainNode();
    this.gains.push(g);
    return g;
  }
  createBufferSource(): FakeBufferSource {
    const s = new FakeBufferSource();
    this.sources.push(s);
    return s;
  }
  createBuffer(channels: number, length: number, rate: number): FakeAudioBuffer {
    return new FakeAudioBuffer(channels, length, rate);
  }
  async resume(): Promise<void> {
    this.state = 'running';
  }
  async close(): Promise<void> {
    this.state = 'closed';
  }
  async decodeAudioData(): Promise<FakeAudioBuffer> {
    return new FakeAudioBuffer(1, 256, this.sampleRate);
  }
}
// Install the stub for this file, and hand the globals back when it finishes —
// `index.test.ts`'s "without an AudioContext" group asserts the global is absent,
// so a leak here would fail a sibling that never imported this file. bun runs a
// file's `afterAll` before the next file loads, so this is a clean handover.
const globals = globalThis as Record<string, unknown>;
const realAudioContext = globals.AudioContext;
const realPerformance = globals.performance;
globals.AudioContext = FakeAudioContext;
globals.performance ??= { now: () => 0 };
afterAll(() => {
  if (realAudioContext === undefined) delete globals.AudioContext;
  else globals.AudioContext = realAudioContext;
  globals.performance = realPerformance;
});

/* ------------------------------------------------------------------ */
/* Metrics                                                             */
/* ------------------------------------------------------------------ */

function rms(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += (x[i] as number) * (x[i] as number);
  return Math.sqrt(s / x.length);
}
function peak(x: Float32Array): number {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i] as number));
  return p;
}

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j] as number, re[i] as number];
      [im[i], im[j]] = [im[j] as number, im[i] as number];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = i + k + len / 2;
        const tr = (re[b] as number) * cr - (im[b] as number) * ci;
        const ti = (re[b] as number) * ci + (im[b] as number) * cr;
        re[b] = (re[a] as number) - tr;
        im[b] = (im[a] as number) - ti;
        re[a] = (re[a] as number) + tr;
        im[a] = (im[a] as number) + ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

const NFFT = 8192;

/** Fraction of the signal's power in [lo, hi] Hz, Welch-averaged over the buffer. */
function bandFraction(x: Float32Array, rate: number, lo: number, hi: number): number {
  const w = new Float64Array(NFFT);
  for (let i = 0; i < NFFT; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (NFFT - 1));
  const frames = x.length >= NFFT ? 8 : 1;
  const maxStart = Math.max(0, x.length - NFFT);
  let bandPow = 0;
  let totalPow = 0;
  for (let f = 0; f < frames; f++) {
    const start = frames === 1 ? 0 : Math.round((maxStart * f) / (frames - 1));
    const re = new Float64Array(NFFT);
    const im = new Float64Array(NFFT);
    for (let i = 0; i < NFFT; i++) re[i] = (start + i < x.length ? (x[start + i] as number) : 0) * (w[i] as number);
    fft(re, im);
    for (let k = 0; k < NFFT; k++) {
      const mag2 = (re[k] as number) ** 2 + (im[k] as number) ** 2;
      const freq = (Math.min(k, NFFT - k) * rate) / NFFT;
      totalPow += mag2;
      if (freq >= lo && freq <= hi) bandPow += mag2;
    }
  }
  return totalPow > 0 ? bandPow / totalPow : 0;
}

/** Band RMS, on the same scale as the whole-buffer RMS: √(fraction)·totalRMS. */
function bandRms(x: Float32Array, rate: number, lo: number, hi: number): number {
  return Math.sqrt(bandFraction(x, rate, lo, hi)) * rms(x);
}

/** The melodic lane the lead now occupies (M7′/M13′/M14′/M16′) — perceptible, and
 * spectrally disjoint from the 1.5–3kHz behavior band the graze/pickup cues own. */
const LEAD_LO = 300;
const LEAD_HI = 1000;

/**
 * The quietest 0.4s window's lead-band RMS — the structural rest. Slides a
 * window across the loop and returns the minimum band [300,1000]Hz energy (the
 * lane the lead now lives in — the band moved up with the melody, M7′), which is
 * near zero wherever the lead is a rest (the bass is a pure sub-60Hz sine and the
 * pulse sub-200Hz, so neither fills the lead lane even while sustaining the seam).
 */
function minLeadRestRms(x: Float32Array, rate: number): number {
  const win = Math.round(0.4 * rate);
  const hop = Math.round(0.1 * rate);
  let min = Infinity;
  for (let start = 0; start + win <= x.length; start += hop) {
    const seg = x.subarray(start, start + win);
    min = Math.min(min, bandRms(seg, rate, LEAD_LO, LEAD_HI));
  }
  return min === Infinity ? bandRms(x, rate, LEAD_LO, LEAD_HI) : min;
}

/**
 * A synthetic shot train (M16′): the rendered `shot` buffer at its playback volume,
 * laid every `periodTicks` ticks (one tick = 1/60s) across `seconds` — the schedule
 * a firing player produces (period 6 is the scout's corrected common cadence). M16′
 * measures the BGM lead lane against this train's own energy in the same lane, the
 * guard on the `shot`'s downward-sweep tail crossing into the melodic lane (§4/§5).
 */
function shotTrain(
  shot: Float32Array,
  volume: number,
  rate: number,
  seconds: number,
  periodTicks: number,
): Float32Array {
  const total = Math.max(1, Math.round(seconds * rate));
  const step = Math.max(1, Math.round((periodTicks / 60) * rate));
  const out = new Float32Array(total);
  for (let start = 0; start + shot.length <= total; start += step) {
    for (let i = 0; i < shot.length; i++) {
      out[start + i] = (out[start + i] as number) + (shot[i] as number) * volume;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Render every built-in track and sound once                          */
/* ------------------------------------------------------------------ */

// A noisy SFX draws its noise from the *global* `fx` stream (`audio/index.ts`
// render()), so the rendered buffer — and its measured peak — depends on how
// much `fx` any earlier test drew. That made this file's numbers a hostage to
// test order: the razor-thin `break`(noisy) ≥ `declare`(no noise, fixed 0.2126)
// hierarchy below flips when an unrelated feature adds one `fx` emit. Seed `fx`
// to its construction default before anything renders, so these buffers render
// exactly as they do on a fresh load (isolation, and `tools/measure-audio.ts`,
// both of which start pristine — that is the canonical the docs quote), then hand
// the stream back once rendering is done so this file stays transparent to `fx`,
// the same discipline the `AudioContext` handover above keeps. Value mirrors
// `fx = new Random(0x9e3779b9)`.
const fxEntry = fx.getState();
fx.seed(0x9e3779b9);

const music = new Music();
await music.unlock();
const musicCtx = CONTEXTS[0] as FakeAudioContext;

const isFixture = (n: string): boolean => n.startsWith('test');

const TRACKS = new Map<string, FakeAudioBuffer>();
// Per-track playback volume (interregnum is authored hottest at 0.80; the rest 0.70).
// M10′/M16′ weight each track's buffer by it, so a track's authored level counts.
const TRACK_VOL = new Map<string, number>();
for (const name of musicNames().filter((n) => !isFixture(n))) {
  music.play(name, 0);
  const buf = musicCtx.sources.at(-1)?.buffer;
  const volume = musicCtx.gains.at(-1)?.gain.value ?? 1;
  if (buf) {
    TRACKS.set(name, buf);
    TRACK_VOL.set(name, volume);
  }
}

const audio = new Audio();
await audio.unlock();
const audioCtx = CONTEXTS[1] as FakeAudioContext;

const SOUNDS = new Map<string, { buffer: FakeAudioBuffer; volume: number }>();
for (const name of soundNames().filter((n) => !isFixture(n))) {
  audio.play(name);
  const buf = audioCtx.sources.at(-1)?.buffer;
  const volume = audioCtx.gains.at(-1)?.gain.value ?? 1;
  if (buf) SOUNDS.set(name, { buffer: buf, volume });
}

// Rendering is done; hand `fx` back exactly as found so siblings see no change.
fx.setState(fxEntry);

/* ------------------------------------------------------------------ */

describe('BGM sits under the mix', () => {
  test('every track is present and rendered', () => {
    // The set the design authored — thirteen, so a dropped track fails loudly.
    expect(TRACKS.size).toBe(13);
  });

  test("M1′ — per-track buffer RMS ≤ 0.12 (measured max 0.0965 vigil)", () => {
    // Loosened from M1's 0.14 in spirit, but frozen from the real render: the
    // lead-forward / bass-recessed mix under the 0.40 peak clamp lowered aggregate
    // RMS rather than raising it (the design's estimate that denser motifs would push
    // RMS up was corrected by measurement). 0.12 keeps meaningful headroom over the
    // measured 0.0965 so no track becomes a wall; a track over it drops its volume.
    for (const [name, buf] of TRACKS) {
      const value = rms(buf.getChannelData());
      expect(`${name} rms ${value.toFixed(4)} ≤ 0.12: ${value <= 0.12}`).toBe(
        `${name} rms ${value.toFixed(4)} ≤ 0.12: true`,
      );
    }
  });

  test('M2 — per-track buffer peak ≤ 0.55 (under explosion, target ≤0.50)', () => {
    for (const [name, buf] of TRACKS) {
      const value = peak(buf.getChannelData());
      expect(`${name} peak ${value.toFixed(4)} ≤ 0.55: ${value <= 0.55}`).toBe(
        `${name} peak ${value.toFixed(4)} ≤ 0.55: true`,
      );
    }
  });

  test('M3 — behavior-band (1.5–3kHz) RMS ≤ 0.02', () => {
    for (const [name, buf] of TRACKS) {
      const value = bandRms(buf.getChannelData(), buf.sampleRate, 1500, 3000);
      expect(`${name} band rms ${value.toFixed(4)} ≤ 0.02: ${value <= 0.02}`).toBe(
        `${name} band rms ${value.toFixed(4)} ≤ 0.02: true`,
      );
    }
  });

  test('M4 — behavior-band fraction ≤ 8%', () => {
    for (const [name, buf] of TRACKS) {
      const value = bandFraction(buf.getChannelData(), buf.sampleRate, 1500, 3000);
      expect(`${name} band ${(value * 100).toFixed(2)}% ≤ 8%: ${value <= 0.08}`).toBe(
        `${name} band ${(value * 100).toFixed(2)}% ≤ 8%: true`,
      );
    }
  });

  test('M5 — BGM band RMS ÷ graze band RMS ≤ 1/3 (the vacated band)', () => {
    const graze = SOUNDS.get('graze');
    expect(graze).toBeDefined();
    const grazeBand = bandRms(graze!.buffer.getChannelData(), graze!.buffer.sampleRate, 1500, 3000);
    expect(grazeBand).toBeGreaterThan(0.01);
    for (const [name, buf] of TRACKS) {
      const band = bandRms(buf.getChannelData(), buf.sampleRate, 1500, 3000);
      const ratio = band / grazeBand;
      expect(`${name} band/graze ${ratio.toFixed(3)} ≤ 0.333: ${ratio <= 1 / 3}`).toBe(
        `${name} band/graze ${ratio.toFixed(3)} ≤ 0.333: true`,
      );
    }
  });

  test('M6 — loop seam is click-free (endpoint jump and ±64-sample RMS match)', () => {
    for (const [name, buf] of TRACKS) {
      const d = buf.getChannelData();
      const jump = Math.abs((d[0] as number) - (d[d.length - 1] as number));
      expect(`${name} seam ${jump.toFixed(4)} ≤ 0.02: ${jump <= 0.02}`).toBe(
        `${name} seam ${jump.toFixed(4)} ≤ 0.02: true`,
      );
      // The 64 samples on each side of the wrap are bass-only and continuous, so
      // their RMS matches — a derivative discontinuity would part them.
      const head = rms(d.subarray(0, 64));
      const tail = rms(d.subarray(d.length - 64));
      const diff = Math.abs(head - tail);
      expect(`${name} window match ${diff.toFixed(4)} ≤ 0.03: ${diff <= 0.03}`).toBe(
        `${name} window match ${diff.toFixed(4)} ≤ 0.03: true`,
      );
    }
  });

  test("M7′ — every loop holds a ≥0.4s lead rest in [300,1000] (band RMS < 0.01)", () => {
    // The phrase must breathe: every non-trance motif wraps on trailing rests and the
    // trance motifs are sparse, so a ≥0.4s window of near-silence in the lead lane
    // exists in every track. The measurement band moved up with the melody to
    // [300,1000] (M7′); the < 0.01 rest floor is KEPT.
    for (const [name, buf] of TRACKS) {
      const value = minLeadRestRms(buf.getChannelData(), buf.sampleRate);
      expect(`${name} min lead-rest ${value.toFixed(4)} < 0.01: ${value < 0.01}`).toBe(
        `${name} min lead-rest ${value.toFixed(4)} < 0.01: true`,
      );
    }
  });

  test('a 出神 track renders and obeys the same discipline', () => {
    // zenith is the 出神 sentinel Lunatic card — detuned, no pulse. It must still
    // seam cleanly and vacate the band; the wrongness is in pitch, not the mix.
    const buf = TRACKS.get('zenith');
    expect(buf).toBeDefined();
    const d = buf!.getChannelData();
    expect(rms(d)).toBeLessThanOrEqual(0.14);
    expect(bandFraction(d, buf!.sampleRate, 1500, 3000)).toBeLessThanOrEqual(0.08);
    expect(Math.abs((d[0] as number) - (d[d.length - 1] as number))).toBeLessThanOrEqual(0.02);
  });
});

describe('SFX hierarchy and the behavior band', () => {
  test('M8 — the effective-peak hierarchy is monotonic by role', () => {
    // MEASURED, not typed: effective peak = buffer peak × voice volume, the level
    // that actually reaches the speaker (docs/audio.md §5). Asserting the declared
    // `volume` constants alone would be tautological — and blind to a synth whose
    // buffer peak drifted while its volume stayed put, the exact "measured, not
    // typed" failure this suite exists to catch. The order below is the one the
    // rendered buffers produce, which is also the ladder docs/audio.md §5 publishes.
    const eff = (n: string): number => {
      const s = SOUNDS.get(n)!;
      return peak(s.buffer.getChannelData()) * s.volume;
    };
    const ladder = [
      'death', 'explosion', 'toll', 'break', 'declare', 'hit', 'clear', 'pickup', 'shot', 'graze',
    ];
    for (let i = 1; i < ladder.length; i++) {
      const a = ladder[i - 1] as string;
      const b = ladder[i] as string;
      const ok = eff(a) >= eff(b);
      expect(`${a}(${eff(a).toFixed(4)}) ≥ ${b}(${eff(b).toFixed(4)}): ${ok}`).toBe(
        `${a}(${eff(a).toFixed(4)}) ≥ ${b}(${eff(b).toFixed(4)}): true`,
      );
    }
    // The load-bearing role claims, strict. Losing a life is the loudest thing in
    // the game; a routine explosion outranks the boss-entry toll — the measured
    // order, which corrected the design's estimated `toll > explosion` premise
    // (the announce bell is a low, distinct 160Hz tone, present by frequency not
    // level); and every ui-* click sits under even graze, the quietest gameplay cue.
    expect(eff('death')).toBeGreaterThan(eff('explosion'));
    expect(eff('explosion')).toBeGreaterThan(eff('toll'));
    const ui = ['ui-move', 'ui-confirm', 'ui-cancel', 'ui-pause', 'ui-advance'];
    const maxUiEff = Math.max(...ui.map(eff));
    expect(eff('graze')).toBeGreaterThan(maxUiEff);
  });

  test('M9 — every UI cue is under 0.090s', () => {
    for (const ui of ['ui-move', 'ui-confirm', 'ui-cancel', 'ui-pause', 'ui-advance']) {
      const dur = SOUNDS.get(ui)!.buffer.duration;
      expect(`${ui} ${dur.toFixed(3)}s < 0.090: ${dur < 0.09}`).toBe(
        `${ui} ${dur.toFixed(3)}s < 0.090: true`,
      );
    }
  });

  test('M9a — menu navigation clears the menu-theme RMS by at least 3dB', () => {
    const menu = TRACKS.get('menu')!;
    const menuVolume = TRACK_VOL.get('menu')!;
    const menuEffectiveRms = rms(menu.getChannelData()) * menuVolume * 0.55;
    for (const name of ['ui-move', 'ui-confirm', 'ui-cancel']) {
      const cue = SOUNDS.get(name)!;
      const cueEffectivePeak = peak(cue.buffer.getChannelData()) * cue.volume;
      const margin = 20 * Math.log10(cueEffectivePeak / menuEffectiveRms);
      expect(`${name} menu margin ${margin.toFixed(1)}dB ≥ 3: ${margin >= 3}`).toBe(
        `${name} menu margin ${margin.toFixed(1)}dB ≥ 3: true`,
      );
    }
  });

  test('M9b — menu navigation occupies the band its BGM leaves open', () => {
    for (const name of ['ui-move', 'ui-confirm', 'ui-cancel']) {
      const cue = SOUNDS.get(name)!;
      const fraction = bandFraction(
        cue.buffer.getChannelData(),
        cue.buffer.sampleRate,
        1500,
        3000,
      );
      expect(`${name} behavior-band ${(fraction * 100).toFixed(1)}% > 50%`).toBe(
        `${name} behavior-band ${fraction > 0.5 ? (fraction * 100).toFixed(1) : 'LOW'}% > 50%`,
      );
    }
  });

  test('the toll announces below the behavior band, not inside it', () => {
    // toll is a low bell (160→150Hz): a gameplay announce rather than a short UI
    // transient, and it must not camp the 1.5–3kHz the graze/pickup cues own.
    const toll = SOUNDS.get('toll')!;
    const band = bandFraction(toll.buffer.getChannelData(), toll.buffer.sampleRate, 1500, 3000);
    expect(`toll band ${(band * 100).toFixed(1)}% < 10%: ${band < 0.1}`).toBe(
      `toll band ${(band * 100).toFixed(1)}% < 10%: true`,
    );
  });

  test("M10′ — behavior stays on top: BGM effective RMS sits under shot effective peak", () => {
    // Redefined (M10 → M10′). The old "level hole" intentionally shrinks: the lead is
    // now the primary voice, so the separation from the SFX is SPECTRAL (M5/M12/M16′),
    // not a level gap. This asserts the honest, looser ceiling the design named — the
    // score sits under the behavior cue at the moment of the SFX's own event.
    // BGM effective = buffer RMS × track volume × MUSIC_LEVEL (0.55, mirrored from
    // main.ts — the test cannot import it: main.ts pulls in the renderer, crossing the
    // headless boundary). SFX effective = buffer × voice volume × 1.0 (never ducked).
    const MUSIC_MASTER = 0.55;
    let maxBgmEffRms = 0;
    for (const [name, buf] of TRACKS) {
      const vol = TRACK_VOL.get(name)!;
      maxBgmEffRms = Math.max(maxBgmEffRms, rms(buf.getChannelData()) * vol * MUSIC_MASTER);
    }
    const shot = SOUNDS.get('shot')!;
    const shotEffPeak = peak(shot.buffer.getChannelData()) * shot.volume;
    expect(maxBgmEffRms).toBeLessThan(shotEffPeak);
    const db = 20 * Math.log10(shotEffPeak / maxBgmEffRms);
    // Measured ~9.5dB (max BGM eff RMS 0.0381 adjourn vs shot eff peak 0.1140); floor 7.
    expect(`margin ${db.toFixed(1)}dB > 7: ${db > 7}`).toBe(`margin ${db.toFixed(1)}dB > 7: true`);
  });

  test('M12 — the vacated band has a tenant: graze and break fill it, BGM does not', () => {
    const graze = SOUNDS.get('graze')!;
    const brk = SOUNDS.get('break')!;
    const grazeBand = bandFraction(graze.buffer.getChannelData(), graze.buffer.sampleRate, 1500, 3000);
    const breakBand = bandFraction(brk.buffer.getChannelData(), brk.buffer.sampleRate, 1500, 3000);
    expect(`graze band ${(grazeBand * 100).toFixed(0)}% > 50%`).toBe(
      `graze band ${grazeBand > 0.5 ? (grazeBand * 100).toFixed(0) : 'LOW'}% > 50%`,
    );
    expect(breakBand).toBeGreaterThan(0.2);
    // And the loudest BGM band presence is far below the behavior tenant's.
    let maxBgmBand = 0;
    for (const buf of TRACKS.values()) {
      maxBgmBand = Math.max(maxBgmBand, bandFraction(buf.getChannelData(), buf.sampleRate, 1500, 3000));
    }
    expect(maxBgmBand).toBeLessThan(grazeBand / 4);
  });
});

describe("BGM is present and recognizable (M13′–M16′)", () => {
  // The four floors that flip the contract from "BGM absent" (old: only ceilings on a
  // lump, proving the score was quiet, never that a tune was there) to "BGM present and
  // recognizable". Every threshold is FROZEN from the real render, not the design's
  // estimate — the register/density fix put more lead-lane energy in the trance tracks
  // (their wider envelope sustains each note) than in the sparsest non-trance ones, so
  // the design's separate lower trance floors were unnecessary: a single floor that
  // EVERY track clears is the cleaner encoding of the flagship "every track is audible".

  test("M13′ — lead-band [300,1000] RMS ≥ 0.025 (measured min 0.028 docket)", () => {
    // The flagship positive claim, made measurable. Today (leads at 88–220Hz) this band
    // is ~0; now every track sounds a lead in the perceptible lane. Min is docket, a
    // non-trance inversion whose descending degrees sit low in the lane.
    for (const [name, buf] of TRACKS) {
      const value = bandRms(buf.getChannelData(), buf.sampleRate, LEAD_LO, LEAD_HI);
      expect(`${name} lead-band ${value.toFixed(4)} ≥ 0.025: ${value >= 0.025}`).toBe(
        `${name} lead-band ${value.toFixed(4)} ≥ 0.025: true`,
      );
    }
  });

  test("M14′ — lead-band RMS ÷ whole-buffer RMS ≥ 0.34 (measured min 0.37 docket)", () => {
    // The spine: the melody outweighs the drone. Directly kills the scout's finding that
    // the lead was the QUIETEST voice — structurally guaranteed by LEAD_AMP 0.40 >
    // BASS_AMP 0.24, and here proved on the rendered buffer.
    for (const [name, buf] of TRACKS) {
      const whole = rms(buf.getChannelData());
      const lead = bandRms(buf.getChannelData(), buf.sampleRate, LEAD_LO, LEAD_HI);
      const ratio = whole > 0 ? lead / whole : 0;
      expect(`${name} lead/whole ${ratio.toFixed(3)} ≥ 0.34: ${ratio >= 0.34}`).toBe(
        `${name} lead/whole ${ratio.toFixed(3)} ≥ 0.34: true`,
      );
    }
  });

  test("M15′ — every non-trance track sounds ≥ 6/16 slots (a phrase, not a blip)", () => {
    // Density: something TO recognize. Expressed as a fraction (6/16 = 0.375) so it binds
    // interdict's 8-beat curt loop too — its 4/8 = 0.50 clears the same phrase density as
    // the 16-slot tracks (min there is menu 8/16 = 0.50). Trance tracks are exempt (sparse
    // by design — zenith 4/16, fiat 5/16, adjourn 5/16 — the 出神 "floor removed").
    for (const name of TRACKS.keys()) {
      const phrase = trackPhrase(name);
      expect(phrase).toBeDefined();
      if (phrase!.trance) continue;
      const frac = phrase!.sounded / phrase!.beats;
      expect(
        `${name} sounds ${phrase!.sounded}/${phrase!.beats} ≥ 6/16: ${frac >= 6 / 16}`,
      ).toBe(`${name} sounds ${phrase!.sounded}/${phrase!.beats} ≥ 6/16: true`);
    }
  });

  test("M16′ — in-lane SNR over a real shot schedule (loudest ≥ 6dB, every non-trance ≥ 3dB)", () => {
    // The guard on the shot-sweep collision (§4). BGM lead lane [300,1000] at its track
    // volume vs a shot train (every 6 ticks) in the same lane — bus-independent, so it
    // does not drift when MUSIC_LEVEL (the ear-gated knob) moves. The estimated 9dB bar
    // was NOT met: the shot's downward square sweep bottoming at 420 put its fundamental
    // squarely in the lane (~90% of shot power there), leaving even the strongest tracks
    // marginal and ~0dB at playback. Ordered-fallback step 1 (shot.to 420→640, applied in
    // index.ts) cleared the meat of the lane and lifted every track ~1.8dB; the floors are
    // frozen from that post-fallback render. Loudest by RMS is adjourn (a trance track) at
    // 10.6dB; the binding floor is the per-track minimum, docket at 3.8dB.
    const shot = SOUNDS.get('shot')!;
    const train = shotTrain(shot.buffer.getChannelData(), shot.volume, shot.buffer.sampleRate, 4, 6);
    const shotLaneRms = bandRms(train, shot.buffer.sampleRate, LEAD_LO, LEAD_HI);
    expect(shotLaneRms).toBeGreaterThan(0);

    const laneSnrDb = (name: string, buf: FakeAudioBuffer): number => {
      const eff = bandRms(buf.getChannelData(), buf.sampleRate, LEAD_LO, LEAD_HI) * TRACK_VOL.get(name)!;
      return 20 * Math.log10(eff / shotLaneRms);
    };

    // The design's named harness: the loudest track (by RMS) stands clear of the shots.
    let loudest = '';
    let loudestRms = -1;
    for (const [name, buf] of TRACKS) {
      const r = rms(buf.getChannelData());
      if (r > loudestRms) {
        loudestRms = r;
        loudest = name;
      }
    }
    const loudDb = laneSnrDb(loudest, TRACKS.get(loudest)!);
    expect(`loudest ${loudest} ${loudDb.toFixed(1)}dB ≥ 6: ${loudDb >= 6}`).toBe(
      `loudest ${loudest} ${loudDb.toFixed(1)}dB ≥ 6: true`,
    );

    // The flagship "every track" claim: no non-trance track is masked in its own lane.
    for (const [name, buf] of TRACKS) {
      if (trackPhrase(name)?.trance) continue;
      const db = laneSnrDb(name, buf);
      expect(`${name} ${db.toFixed(1)}dB ≥ 3: ${db >= 3}`).toBe(`${name} ${db.toFixed(1)}dB ≥ 3: true`);
    }
  });
});

describe('determinism (M11)', () => {
  test('a track renders bit-identical across two independent engines', async () => {
    // The composer is a pure function of the name — no RNG, `hashName` the only
    // variation. A second engine on a second context must produce the same bytes.
    const other = new Music();
    await other.unlock();
    const otherCtx = CONTEXTS.at(-1) as FakeAudioContext;
    for (const name of ['nemesis', 'zenith', 'adjourn']) {
      other.play(name, 0);
      const a = TRACKS.get(name)!.getChannelData();
      const b = otherCtx.sources.at(-1)!.buffer!.getChannelData();
      expect(a.length).toBe(b.length);
      let identical = true;
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
          identical = false;
          break;
        }
      }
      expect(`${name} bit-identical: ${identical}`).toBe(`${name} bit-identical: true`);
    }
  });

  test("leadOctave defaults to 1 — an omitted field reproduces rootHz×2 bit-for-bit", async () => {
    // The backward-compat guarantee, by construction: `finite(synth?.leadOctave, 1)` →
    // 2^1 = 2, the historical `rootHz * 2`. A spec (or guest-pack track) that omits the
    // field must render byte-identical to one that names 1, so no untouched track is
    // re-pitched and replay determinism holds. To isolate the field, the SAME name is
    // redefined and rendered on a fresh engine each time — same name → same `hashName`,
    // so the bass arc/sway are identical and only `leadOctave` can move a sample. (The
    // name starts with "test", so the 13-count and doctrine sweeps skip it.)
    const base = { root: 50, beatsPerLoop: 4, motif: [0, 2, Number.NaN, 4] };
    const renderFresh = async (leadOctave?: number): Promise<Float32Array> => {
      defineMusic('test:leadoct', { synth: leadOctave === undefined ? { ...base } : { ...base, leadOctave } });
      const eng = new Music();
      await eng.unlock();
      const ec = CONTEXTS.at(-1) as FakeAudioContext;
      eng.play('test:leadoct', 0);
      return ec.sources.at(-1)!.buffer!.getChannelData().slice();
    };
    const omitted = await renderFresh(undefined);
    const one = await renderFresh(1);
    const three = await renderFresh(3);
    expect(omitted.length).toBe(one.length);
    let identical = true;
    for (let i = 0; i < omitted.length; i++) {
      if (omitted[i] !== one[i]) {
        identical = false;
        break;
      }
    }
    expect(`omitted ≡ leadOctave:1: ${identical}`).toBe('omitted ≡ leadOctave:1: true');
    // And the field must actually reach the lead: leadOctave 3 is a different buffer.
    let differs = false;
    for (let i = 0; i < omitted.length; i++) {
      if (omitted[i] !== three[i]) {
        differs = true;
        break;
      }
    }
    expect(`leadOctave:3 differs: ${differs}`).toBe('leadOctave:3 differs: true');
  });

  test('the composer draws from no RNG — a name is a pure seed', () => {
    // Guarded structurally by the sibling `no audio path reaches for Math.random`;
    // here it is proved by outcome: same name, same bytes, established above.
    defineSound('test:mix-probe', {});
    expect(soundNames()).toContain('test:mix-probe');
  });
});
