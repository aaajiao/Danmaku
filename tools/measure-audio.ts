/**
 * Measure the audio, headlessly — the audio analogue of `test:assets`.
 *
 *     bun tools/measure-audio.ts
 *
 * Renders every BGM track and every SFX through the same fake `AudioContext`
 * the unit tests use, then PRINTS (never asserts) the numbers the mix doctrine
 * is judged on: per track its RMS, peak, spectral centroid, the 1.5–3kHz
 * behavior-band RMS and its fraction of the total, the loop seam, and the loop
 * length; per sound its buffer peak, effective peak (buffer × voice volume) and
 * duration. `mix.test.ts` asserts the bounds; this is the source of the figures
 * `docs/audio.md` quotes, the way "expanse 0.085 vs a bullet's 1.0" is quoted.
 *
 * Not a test: it imports the audio engine and drives it, so it lives in `tools/`
 * beside `make-*-pack.ts`. BGM-vs-scene legibility stays a listening call handed
 * to the user (`test:density` renders on black, no scene).
 */

import { Audio, soundNames } from '../src/audio/index';
import { Music, musicNames } from '../src/audio/music';

/* ------------------------------------------------------------------ */
/* Fake WebAudio — the same shape the audio tests install              */
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
  /** The gain this source was routed through, so a caller can read its volume. */
  gainValue = 1;
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

(globalThis as Record<string, unknown>).AudioContext = FakeAudioContext;
(globalThis as Record<string, unknown>).performance = { now: () => Date.now() };

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

/** Iterative radix-2 Cooley–Tukey FFT, in place on split re/im. */
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

interface Spectrum {
  centroid: number;
  bandRms: number;
  bandFraction: number;
}

/**
 * Welch-averaged spectrum: Hann-windowed frames spread across the buffer, so a
 * loop's lead is captured even when one frame lands in a rest. Band RMS is
 * recovered to time-domain scale via the window power, comparable to the
 * whole-buffer RMS (`meanBand(x²) ≈ (Σ|Xw|²)/(N²·meanW²)`).
 */
function spectrum(x: Float32Array, rate: number, loBand = 1500, hiBand = 3000): Spectrum {
  const w = new Float64Array(NFFT);
  let meanW2 = 0;
  for (let i = 0; i < NFFT; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (NFFT - 1));
    meanW2 += (w[i] as number) * (w[i] as number);
  }
  meanW2 /= NFFT;

  const frames = x.length >= NFFT ? 8 : 1;
  const maxStart = Math.max(0, x.length - NFFT);
  const magSum = new Float64Array(NFFT / 2);
  let bandPow = 0;
  let totalPow = 0;
  let usedFrames = 0;

  for (let f = 0; f < frames; f++) {
    const start = frames === 1 ? 0 : Math.round((maxStart * f) / (frames - 1));
    const re = new Float64Array(NFFT);
    const im = new Float64Array(NFFT);
    for (let i = 0; i < NFFT; i++) {
      const s = start + i < x.length ? (x[start + i] as number) : 0;
      re[i] = s * (w[i] as number);
    }
    fft(re, im);
    usedFrames++;
    for (let k = 0; k < NFFT; k++) {
      const mag2 = (re[k] as number) * (re[k] as number) + (im[k] as number) * (im[k] as number);
      const freq = (Math.min(k, NFFT - k) * rate) / NFFT;
      totalPow += mag2;
      if (freq >= loBand && freq <= hiBand) bandPow += mag2;
      if (k < NFFT / 2) magSum[k] = (magSum[k] as number) + Math.sqrt(mag2);
    }
  }

  let numer = 0;
  let denom = 0;
  for (let k = 1; k < NFFT / 2; k++) {
    const freq = (k * rate) / NFFT;
    numer += freq * (magSum[k] as number);
    denom += magSum[k] as number;
  }
  const centroid = denom > 0 ? numer / denom : 0;
  const bandRms = Math.sqrt(bandPow / usedFrames / (NFFT * NFFT) / meanW2);
  const bandFraction = totalPow > 0 ? bandPow / totalPow : 0;
  return { centroid, bandRms, bandFraction };
}

/** Loop seam: endpoint jump, plus the ±64-sample RMS on each side of the wrap. */
function seamJump(x: Float32Array): number {
  return Math.abs((x[0] as number) - (x[x.length - 1] as number));
}

/* ------------------------------------------------------------------ */
/* Drive the engine and print                                          */
/* ------------------------------------------------------------------ */

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}
function num(v: number, d = 4): string {
  return v.toFixed(d);
}

async function main(): Promise<void> {
  const music = new Music();
  await music.unlock();
  const musicCtx = CONTEXTS[0]!;

  console.log('BGM — one loop per track (rendered at 22050Hz)\n');
  console.log(
    `  ${pad('track', 13)} ${pad('loop s', 7)} ${pad('rms', 8)} ${pad('peak', 7)} ` +
      `${pad('centroid', 10)} ${pad('bandRMS', 9)} ${pad('band%', 7)} ${pad('seam', 8)}`,
  );
  for (const name of musicNames().filter((n) => !n.startsWith('test')).sort()) {
    music.play(name, 0);
    const buf = musicCtx.sources.at(-1)?.buffer;
    if (!buf) {
      console.log(`  ${pad(name, 13)} (no buffer)`);
      continue;
    }
    const data = buf.getChannelData();
    const sp = spectrum(data, buf.sampleRate);
    console.log(
      `  ${pad(name, 13)} ${pad(num(buf.duration, 1), 7)} ${pad(num(rms(data)), 8)} ` +
        `${pad(num(peak(data)), 7)} ${pad(num(sp.centroid, 0) + 'Hz', 10)} ${pad(num(sp.bandRms), 9)} ` +
        `${pad(num(sp.bandFraction * 100, 2) + '%', 7)} ${pad(num(seamJump(data)), 8)}`,
    );
  }

  console.log('\nSFX — buffer peak, effective peak (buffer × voice volume), band share\n');
  console.log(
    `  ${pad('sound', 13)} ${pad('dur s', 7)} ${pad('bufPeak', 9)} ${pad('effPeak', 9)} ` +
      `${pad('volume', 7)} ${pad('centroid', 10)} ${pad('band%', 7)}`,
  );
  const audio = new Audio();
  await audio.unlock();
  const audioCtx = CONTEXTS[1]!;
  for (const name of soundNames().filter((n) => !n.startsWith('test')).sort()) {
    audio.play(name);
    const src = audioCtx.sources.at(-1);
    const buf = src?.buffer;
    const volume = audioCtx.gains.at(-1)?.gain.value ?? 1;
    if (!buf) {
      console.log(`  ${pad(name, 13)} (no buffer)`);
      continue;
    }
    const data = buf.getChannelData();
    const bp = peak(data);
    const sp = spectrum(data, buf.sampleRate);
    console.log(
      `  ${pad(name, 13)} ${pad(num(buf.duration, 3), 7)} ${pad(num(bp), 9)} ` +
        `${pad(num(bp * volume), 9)} ${pad(num(volume, 2), 7)} ${pad(num(sp.centroid, 0) + 'Hz', 10)} ` +
        `${pad(num(sp.bandFraction * 100, 1) + '%', 7)}`,
    );
  }
}

await main();
