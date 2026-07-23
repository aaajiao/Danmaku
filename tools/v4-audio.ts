/**
 * Deterministic release-audio construction for `packs/v4`.
 *
 * No recording, sample, soundfont or third-party asset enters this module. The
 * score and cues are written directly as mono PCM16 from the v4 audio direction:
 * surface (a low continuous field), skeleton (dry temporal joints), mycelium
 * (sparse connecting filaments) and heart (the memorable motif/semantic hit).
 *
 * `tools/make-v4-pack.ts` is the only writer. This module returns bytes and
 * metadata; it never touches the filesystem and never reads global RNG state.
 */

import { sinDeg } from '../src/core/trig';
import {
  SOUND_NAMES,
  type PackMusic,
  type PackSounds,
  type SoundName,
} from '../src/packs/manifest';

export const V4_AUDIO_SAMPLE_RATE = 22050;
export const V4_AUDIO_GENERATOR_VERSION = 'v4-audio-pcm16-mono-22050-v1';

type Stance = 'absorption' | 'trance';

export interface V4TrackBuildSpec {
  readonly name: string;
  readonly stance: Stance;
  readonly loopSeconds: number;
  readonly volume: number;
  readonly root: number;
  readonly mode: readonly number[];
  readonly beats: number;
  readonly motif: readonly number[];
  readonly targetPeak: number;
}

export interface V4SoundBuildSpec {
  readonly name: SoundName;
  readonly durationSeconds: number;
  readonly attackSeconds: number;
  readonly releaseSeconds: number;
  readonly volume: number;
  readonly polyphony: number;
  readonly throttleMs: number;
  readonly targetPeak: number;
}

const R = Number.NaN;
const MINOR = [0, 2, 3, 5, 7, 8, 10] as const;
const DORIAN = [0, 2, 3, 5, 7, 9, 10] as const;
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10] as const;
const WHOLE_TONE = [0, 2, 4, 6, 8, 10] as const;
const LOCRIAN = [0, 1, 3, 5, 6, 8, 10] as const;

const CELL = [0, 2, 4, 3] as const;
const CELL_INVERTED = [0, -2, -4, -3] as const;
const CELL_DARKENED = [0, 1, 4, 3] as const;
const CELL_WHOLE = [0, 2, 4, 3, 4, 2, 0] as const;

export const V4_TRACK_SPECS: readonly V4TrackBuildSpec[] = [
  {
    name: 'menu',
    stance: 'absorption',
    loopSeconds: 16,
    volume: 0.7,
    root: 43,
    mode: MINOR,
    beats: 16,
    motif: [4, R, 2, 4, R, R, 7, 4, 2, R, 0, 2, R, R, R, R],
    targetPeak: 0.46,
  },
  {
    name: 'vigil',
    stance: 'absorption',
    loopSeconds: 16,
    volume: 0.7,
    root: 45,
    mode: MINOR,
    beats: 16,
    motif: [0, 4, 2, 4, 7, 4, 2, 0, R, R, 4, 2, 4, R, R, R],
    targetPeak: 0.47,
  },
  {
    name: 'descent',
    stance: 'absorption',
    loopSeconds: 12,
    volume: 0.7,
    root: 46,
    mode: MINOR,
    beats: 16,
    motif: [0, 3, R, 2, 0, 3, 5, 3, R, R, 2, 0, 3, R, R, R],
    targetPeak: 0.47,
  },
  {
    name: 'precedent',
    stance: 'absorption',
    loopSeconds: 16,
    volume: 0.7,
    root: 44,
    mode: DORIAN,
    beats: 16,
    motif: [0, 2, 3, 2, 0, 2, 3, 5, 0, 2, 3, 2, R, R, R, R],
    targetPeak: 0.48,
  },
  {
    name: 'ordinance',
    stance: 'absorption',
    loopSeconds: 14,
    volume: 0.7,
    root: 41,
    mode: MINOR,
    beats: 16,
    motif: [0, 4, 5, 4, 2, 4, 0, 4, 5, 4, 2, R, R, R, R, R],
    targetPeak: 0.48,
  },
  {
    name: 'nemesis',
    stance: 'absorption',
    loopSeconds: 14,
    volume: 0.7,
    root: 47,
    mode: MINOR,
    beats: 16,
    motif: [...CELL, ...CELL, R, R, 4, 3, R, R, R, R],
    targetPeak: 0.5,
  },
  {
    name: 'interdict',
    stance: 'absorption',
    loopSeconds: 8,
    volume: 0.7,
    root: 50,
    mode: MINOR,
    beats: 8,
    motif: [0, 2, R, R, 0, 2, R, R],
    targetPeak: 0.48,
  },
  {
    name: 'docket',
    stance: 'absorption',
    loopSeconds: 16,
    volume: 0.7,
    root: 48,
    mode: MINOR,
    beats: 16,
    motif: [...CELL_INVERTED, ...CELL_INVERTED, R, -4, -3, R, R, R, R, R],
    targetPeak: 0.49,
  },
  {
    name: 'sanction',
    stance: 'absorption',
    loopSeconds: 16,
    volume: 0.7,
    root: 52,
    mode: PHRYGIAN,
    beats: 16,
    motif: [...CELL_DARKENED, ...CELL_DARKENED, 0, 1, R, R, R, R, R, R],
    targetPeak: 0.5,
  },
  {
    name: 'interregnum',
    stance: 'absorption',
    loopSeconds: 16,
    volume: 0.8,
    root: 55,
    mode: MINOR,
    beats: 16,
    motif: [...CELL_WHOLE, R, ...CELL_WHOLE, R],
    targetPeak: 0.45,
  },
  {
    name: 'zenith',
    stance: 'trance',
    loopSeconds: 13,
    volume: 0.7,
    root: 47,
    mode: WHOLE_TONE,
    beats: 16,
    motif: [0, R, 2, R, R, 4, R, 3, R, R, R, R, R, R, R, R],
    targetPeak: 0.45,
  },
  {
    name: 'fiat',
    stance: 'trance',
    loopSeconds: 17,
    volume: 0.7,
    root: 55,
    mode: LOCRIAN,
    beats: 16,
    motif: [0, 2, R, 3, R, 2, R, 0, R, R, R, R, R, R, R, R],
    targetPeak: 0.46,
  },
  {
    name: 'adjourn',
    stance: 'trance',
    loopSeconds: 24,
    volume: 0.7,
    root: 38,
    mode: MINOR,
    beats: 16,
    motif: [4, R, 3, R, 2, R, 1, R, 0, R, R, R, R, R, R, R],
    targetPeak: 0.45,
  },
];

/**
 * Release-sample gains are deliberately independent from the fallback gains.
 * In particular, the very short UI WAVs are normalised above raw peak 0.2 and
 * therefore need less manifest gain than their quieter synth counterparts.
 */
export const V4_SOUND_SPECS: readonly V4SoundBuildSpec[] = [
  { name: 'shot', durationSeconds: 0.07, attackSeconds: 0.0025, releaseSeconds: 0.008, volume: 0.3, polyphony: 4, throttleMs: 40, targetPeak: 0.5 },
  { name: 'hit', durationSeconds: 0.09, attackSeconds: 0.0025, releaseSeconds: 0.012, volume: 0.35, polyphony: 6, throttleMs: 20, targetPeak: 0.51 },
  { name: 'explosion', durationSeconds: 0.55, attackSeconds: 0.004, releaseSeconds: 0.06, volume: 0.55, polyphony: 4, throttleMs: 45, targetPeak: 0.78 },
  { name: 'graze', durationSeconds: 0.13, attackSeconds: 0.003, releaseSeconds: 0.018, volume: 0.22, polyphony: 3, throttleMs: 60, targetPeak: 0.36 },
  { name: 'pickup', durationSeconds: 0.16, attackSeconds: 0.003, releaseSeconds: 0.02, volume: 0.35, polyphony: 4, throttleMs: 25, targetPeak: 0.46 },
  { name: 'death', durationSeconds: 0.85, attackSeconds: 0.005, releaseSeconds: 0.1, volume: 0.8, polyphony: 1, throttleMs: 250, targetPeak: 0.78 },
  { name: 'toll', durationSeconds: 0.7, attackSeconds: 0.004, releaseSeconds: 0.1, volume: 0.6, polyphony: 1, throttleMs: 120, targetPeak: 0.53 },
  { name: 'declare', durationSeconds: 0.35, attackSeconds: 0.003, releaseSeconds: 0.04, volume: 0.5, polyphony: 2, throttleMs: 90, targetPeak: 0.42 },
  { name: 'break', durationSeconds: 0.22, attackSeconds: 0.0025, releaseSeconds: 0.035, volume: 0.55, polyphony: 2, throttleMs: 60, targetPeak: 0.4 },
  { name: 'clear', durationSeconds: 0.35, attackSeconds: 0.004, releaseSeconds: 0.05, volume: 0.5, polyphony: 1, throttleMs: 200, targetPeak: 0.34 },
  { name: 'ui-move', durationSeconds: 0.03, attackSeconds: 0.0025, releaseSeconds: 0.006, volume: 0.31, polyphony: 2, throttleMs: 30, targetPeak: 0.22 },
  { name: 'ui-confirm', durationSeconds: 0.06, attackSeconds: 0.0025, releaseSeconds: 0.01, volume: 0.29, polyphony: 2, throttleMs: 40, targetPeak: 0.23 },
  { name: 'ui-cancel', durationSeconds: 0.06, attackSeconds: 0.0025, releaseSeconds: 0.01, volume: 0.27, polyphony: 2, throttleMs: 40, targetPeak: 0.245 },
  { name: 'ui-pause', durationSeconds: 0.07, attackSeconds: 0.003, releaseSeconds: 0.012, volume: 0.24, polyphony: 1, throttleMs: 60, targetPeak: 0.23 },
  { name: 'ui-advance', durationSeconds: 0.04, attackSeconds: 0.0025, releaseSeconds: 0.008, volume: 0.28, polyphony: 2, throttleMs: 30, targetPeak: 0.2 },
];

export const V4_RELEASE_MUSIC_NAMES = V4_TRACK_SPECS.map((spec) => spec.name);

export const V4_SOUND_MANIFEST: PackSounds = Object.fromEntries(
  V4_SOUND_SPECS.map((spec) => [
    spec.name,
    {
      file: `audio/sfx/${spec.name}.wav`,
      volume: spec.volume,
      polyphony: spec.polyphony,
      throttleMs: spec.throttleMs,
    },
  ]),
) as PackSounds;

export const V4_MUSIC_MANIFEST: PackMusic = Object.fromEntries(
  V4_TRACK_SPECS.map((spec) => [
    spec.name,
    {
      file: `audio/music/${spec.name}.wav`,
      loopStart: 0,
      loopEnd: spec.loopSeconds,
      volume: spec.volume,
    },
  ]),
);

const SEMITONE = [
  1,
  1.0594630943592953,
  1.122462048309373,
  1.189207115002721,
  1.2599210498948732,
  1.3348398541700344,
  1.4142135623730951,
  1.4983070768766815,
  1.587401051,
  1.681792830507429,
  1.7817974362806785,
  1.8877486253633868,
] as const;

function sine(hz: number, seconds: number): number {
  return sinDeg((hz * seconds * 360) % 360);
}

function smoothstep(x: number): number {
  const clamped = x < 0 ? 0 : x > 1 ? 1 : x;
  return clamped * clamped * (3 - 2 * clamped);
}

function snappedFrequency(hz: number, loopSeconds: number): number {
  return Math.round(hz * loopSeconds) / loopSeconds;
}

function scaleFrequency(root: number, mode: readonly number[], degree: number): number {
  const size = mode.length;
  const octave = Math.floor(degree / size);
  const index = ((degree % size) + size) % size;
  const semitones = (mode[index] ?? 0) + octave * 12;
  const semitone = ((semitones % 12) + 12) % 12;
  const register = Math.floor(semitones / 12);
  return root * 8 * 2 ** register * (SEMITONE[semitone] ?? 1);
}

function gate(local: number, attack: number, releaseAt: number): number {
  if (local < attack) return smoothstep(local / attack);
  if (local > releaseAt) return smoothstep((1 - local) / (1 - releaseAt));
  return 1;
}

function removeDcAndNormalise(samples: Float64Array, targetPeak: number): void {
  let mean = 0;
  for (const sample of samples) mean += sample;
  mean /= samples.length;

  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = (samples[i] ?? 0) - mean;
    samples[i] = value;
    peak = Math.max(peak, Math.abs(value));
  }
  const gain = peak > 0 ? targetPeak / peak : 0;
  for (let i = 0; i < samples.length; i++) samples[i] = (samples[i] ?? 0) * gain;
}

function renderTrack(spec: V4TrackBuildSpec): Float64Array {
  const count = Math.round(spec.loopSeconds * V4_AUDIO_SAMPLE_RATE);
  const out = new Float64Array(count);
  const surfaceRoot = snappedFrequency(spec.root, spec.loopSeconds);
  const surfaceFifth = snappedFrequency(spec.root * 1.5, spec.loopSeconds);
  const slotLength = count / spec.beats;
  const trance = spec.stance === 'trance';

  for (let i = 0; i < count; i++) {
    const t = i / V4_AUDIO_SAMPLE_RATE;
    const loopPhase = i / count;
    const breath = 0.72 + 0.28 * sine(2 / spec.loopSeconds, t);

    // surface — a low, whole-loop field. Every oscillator is cycle-snapped.
    let sample =
      breath *
      (0.115 * sine(surfaceRoot, t) +
        0.038 * sine(surfaceRoot * 2, t) +
        0.022 * sine(surfaceFifth, t));

    const slot = Math.floor(i / slotLength);
    const local = (i - slot * slotLength) / slotLength;
    const degree = spec.motif[slot];
    if (degree !== undefined && !Number.isNaN(degree)) {
      const leadFrequency = scaleFrequency(spec.root, spec.mode, degree);
      const leadGate = trance ? gate(local, 0.16, 0.84) : gate(local, 0.055, 0.62);
      const leadBody =
        0.205 * sine(leadFrequency, t) +
        0.032 * sine(leadFrequency * 2, t);
      // heart — the one memorable cell/hook.
      sample += leadBody * leadGate;
    }

    if (!trance) {
      // skeleton — dry joints on the authored grid, below the behavior band.
      const jointEvery = spec.name === 'descent' || spec.name === 'precedent' ? 2 : 4;
      if (slot % jointEvery === 0 && local < 0.34) {
        const jointEnvelope =
          smoothstep(local / 0.035) * smoothstep((0.34 - local) / 0.29);
        const jointFrequency = 170 + (spec.root % 7) * 17;
        sample +=
          jointEnvelope *
          (0.095 * sine(jointFrequency, t) + 0.028 * sine(jointFrequency * 2, t));
      }
    } else {
      // mycelium — pulse floor removed; one sparse filament crosses the loop.
      const branchEnvelope =
        smoothstep(Math.min(1, loopPhase * 10)) *
        smoothstep(Math.min(1, (1 - loopPhase) * 10));
      const branch = snappedFrequency(760 + (spec.root % 5) * 67, spec.loopSeconds);
      const wander = 0.65 + 0.35 * sine(3 / spec.loopSeconds, t);
      sample += 0.052 * branchEnvelope * wander * sine(branch, t);
    }

    out[i] = sample;
  }

  removeDcAndNormalise(out, spec.targetPeak);
  return out;
}

function hashNoise(index: number, seed: number): number {
  let value = Math.imul(index + 1, 0x45d9f3b) ^ seed;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return ((value >>> 0) / 0xffffffff) * 2 - 1;
}

function sfxEnvelope(i: number, count: number, spec: V4SoundBuildSpec): number {
  const attack = Math.max(1, Math.round(spec.attackSeconds * V4_AUDIO_SAMPLE_RATE));
  const release = Math.max(1, Math.round(spec.releaseSeconds * V4_AUDIO_SAMPLE_RATE));
  const inGain = i < attack ? smoothstep(i / attack) : 1;
  const remaining = count - 1 - i;
  const outGain = remaining < release ? smoothstep(remaining / release) : 1;
  const progress = i / Math.max(1, count - 1);
  return inGain * outGain * (1 - progress) ** 1.35;
}

function renderSound(spec: V4SoundBuildSpec, seed: number): Float64Array {
  const count = Math.round(spec.durationSeconds * V4_AUDIO_SAMPLE_RATE);
  const out = new Float64Array(count);
  let sweepPhase = 0;
  let lowNoise = 0;

  for (let i = 0; i < count; i++) {
    const t = i / V4_AUDIO_SAMPLE_RATE;
    const p = i / Math.max(1, count - 1);
    const envelope = sfxEnvelope(i, count, spec);
    const noise = hashNoise(i, seed);
    lowNoise += (noise - lowNoise) * 0.14;
    let sample = 0;

    switch (spec.name) {
      case 'shot': {
        const hz = 1120 * (1 - p) + 650 * p;
        sweepPhase += (360 * hz) / V4_AUDIO_SAMPLE_RATE;
        sample = 0.8 * sinDeg(sweepPhase % 360) + 0.2 * sinDeg((sweepPhase * 2) % 360);
        break;
      }
      case 'hit': {
        const hz = 720 * (1 - p) + 190 * p;
        sweepPhase += (360 * hz) / V4_AUDIO_SAMPLE_RATE;
        sample = 0.58 * sinDeg(sweepPhase % 360) + 0.42 * lowNoise;
        break;
      }
      case 'explosion':
        sample = 0.68 * lowNoise + 0.22 * sine(86 - 28 * p, t) + 0.1 * noise;
        break;
      case 'graze': {
        const hz = 1750 + 900 * p;
        sweepPhase += (360 * hz) / V4_AUDIO_SAMPLE_RATE;
        sample = 0.9 * sinDeg(sweepPhase % 360) + 0.1 * noise;
        break;
      }
      case 'pickup': {
        const step = p < 0.42 ? 680 : p < 0.72 ? 980 : 1450;
        sample = 0.88 * sine(step, t) + 0.12 * sine(step * 0.5, t);
        break;
      }
      case 'death': {
        const hz = 420 * (1 - p) + 48 * p;
        sweepPhase += (360 * hz) / V4_AUDIO_SAMPLE_RATE;
        sample = 0.57 * sinDeg(sweepPhase % 360) + 0.27 * lowNoise + 0.16 * sine(72, t);
        break;
      }
      case 'toll':
        sample = 0.72 * sine(154, t) + 0.2 * sine(231, t) + 0.08 * sine(462, t);
        break;
      case 'declare': {
        const hz = 310 + 250 * p;
        sweepPhase += (360 * hz) / V4_AUDIO_SAMPLE_RATE;
        sample = 0.78 * sinDeg(sweepPhase % 360) + 0.22 * sine(940, t);
        break;
      }
      case 'break': {
        const hz = 2300 * (1 - p) + 620 * p;
        sweepPhase += (360 * hz) / V4_AUDIO_SAMPLE_RATE;
        sample = 0.66 * sinDeg(sweepPhase % 360) + 0.34 * noise;
        break;
      }
      case 'clear': {
        const step = p < 0.45 ? 520 : p < 0.75 ? 690 : 880;
        sample = 0.82 * sine(step, t) + 0.18 * sine(step * 0.5, t);
        break;
      }
      case 'ui-move':
        sample = sine(2200, t);
        break;
      case 'ui-confirm': {
        const hz = 1720 + 880 * p;
        sweepPhase += (360 * hz) / V4_AUDIO_SAMPLE_RATE;
        sample = sinDeg(sweepPhase % 360);
        break;
      }
      case 'ui-cancel': {
        const hz = 2460 - 900 * p;
        sweepPhase += (360 * hz) / V4_AUDIO_SAMPLE_RATE;
        sample = sinDeg(sweepPhase % 360);
        break;
      }
      case 'ui-pause':
        sample = 0.82 * sine(320, t) + 0.18 * sine(480, t);
        break;
      case 'ui-advance':
        sample = 0.9 * sine(2650, t) + 0.1 * noise;
        break;
    }

    out[i] = sample * envelope;
  }

  removeDcAndNormalise(out, spec.targetPeak);
  // Quantised files must begin and end at exact zero, not merely near it.
  out[0] = 0;
  out[out.length - 1] = 0;
  return out;
}

function encodeMonoPcm16(samples: Float64Array): Uint8Array {
  const dataBytes = samples.length * 2;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const ascii = (at: number, text: string): void => {
    for (let i = 0; i < text.length; i++) out[at + i] = text.charCodeAt(i);
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, V4_AUDIO_SAMPLE_RATE, true);
  view.setUint32(28, V4_AUDIO_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, Math.round(value * 32767), true);
  }
  return out;
}

/** Build a fresh set on every call so determinism tests cannot pass via cache. */
export function buildV4AudioFiles(): ReadonlyMap<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  for (const spec of V4_TRACK_SPECS) {
    files.set(`audio/music/${spec.name}.wav`, encodeMonoPcm16(renderTrack(spec)));
  }
  for (let i = 0; i < V4_SOUND_SPECS.length; i++) {
    const spec = V4_SOUND_SPECS[i]!;
    files.set(`audio/sfx/${spec.name}.wav`, encodeMonoPcm16(renderSound(spec, 0x56440000 + i)));
  }
  return files;
}

if (import.meta.main) {
  const files = buildV4AudioFiles();
  const bytes = [...files.values()].reduce((sum, file) => sum + file.byteLength, 0);
  console.log(
    `v4 audio: ${V4_TRACK_SPECS.length} music + ${V4_SOUND_SPECS.length} sfx, ` +
      `${(bytes / (1024 * 1024)).toFixed(2)} MiB (${V4_AUDIO_GENERATOR_VERSION})`,
  );
  if (V4_SOUND_SPECS.map((spec) => spec.name).join(',') !== SOUND_NAMES.join(',')) {
    throw new Error('v4 sound order drifted from SOUND_NAMES');
  }
}
