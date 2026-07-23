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
export const V4_AUDIO_GENERATOR_VERSION = 'v4-audio-pcm16-mono-22050-v2';

type Stance = 'absorption' | 'trance';
type TrackArchitecture =
  | 'menu'
  | 'open-signal'
  | 'descending-corridor'
  | 'accreted-record'
  | 'closing-vault'
  | 'sentinel-orbit'
  | 'warden-latch'
  | 'magistrate-scan'
  | 'chancellor-seal'
  | 'regent-recapitulation'
  | 'unmoored-signal'
  | 'terminal-cadence';

export interface V4TrackBuildSpec {
  readonly name: string;
  readonly stance: Stance;
  /**
   * The track's temporal/spectral grammar. Root and motif identify the shared
   * campaign cell; architecture is what stops thirteen transpositions of one
   * renderer from pretending to be thirteen pieces.
   */
  readonly architecture: TrackArchitecture;
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
    architecture: 'menu',
    loopSeconds: 16,
    volume: 0.56,
    root: 43,
    mode: MINOR,
    beats: 16,
    motif: [4, R, 2, 4, R, R, 7, 4, 2, R, 0, 2, R, R, R, R],
    targetPeak: 0.46,
  },
  {
    name: 'vigil',
    stance: 'absorption',
    architecture: 'open-signal',
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
    architecture: 'descending-corridor',
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
    architecture: 'accreted-record',
    loopSeconds: 16,
    volume: 0.7,
    root: 44,
    mode: DORIAN,
    beats: 16,
    motif: [0, 2, 3, 2, 0, 2, 3, 5, 0, 2, 3, 2, R, R, R, R],
    targetPeak: 0.45,
  },
  {
    name: 'ordinance',
    stance: 'absorption',
    architecture: 'closing-vault',
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
    architecture: 'sentinel-orbit',
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
    architecture: 'warden-latch',
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
    architecture: 'magistrate-scan',
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
    architecture: 'chancellor-seal',
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
    architecture: 'regent-recapitulation',
    loopSeconds: 16,
    volume: 0.7,
    root: 55,
    mode: MINOR,
    beats: 16,
    motif: [...CELL_WHOLE, R, ...CELL_WHOLE, R],
    targetPeak: 0.45,
  },
  {
    name: 'zenith',
    stance: 'trance',
    architecture: 'unmoored-signal',
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
    architecture: 'unmoored-signal',
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
    architecture: 'terminal-cadence',
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
  // Four equal-loudness weapon tiers. Strength is encoded by internal pulse
  // grammar and spectrum, never by turning the player's held-fire loop louder.
  { name: 'shot-tier-1', durationSeconds: 0.06, attackSeconds: 0.0025, releaseSeconds: 0.008, volume: 0.29, polyphony: 4, throttleMs: 35, targetPeak: 0.5 },
  { name: 'shot-tier-2', durationSeconds: 0.065, attackSeconds: 0.0025, releaseSeconds: 0.009, volume: 0.28, polyphony: 4, throttleMs: 35, targetPeak: 0.52 },
  { name: 'shot-tier-3', durationSeconds: 0.07, attackSeconds: 0.0025, releaseSeconds: 0.01, volume: 0.27, polyphony: 4, throttleMs: 35, targetPeak: 0.54 },
  // A tier crossing is rarer and more important than collecting one fractional
  // power chip, so it receives a short, rising code of its own.
  { name: 'power-up-1', durationSeconds: 0.18, attackSeconds: 0.003, releaseSeconds: 0.025, volume: 0.48, polyphony: 1, throttleMs: 80, targetPeak: 0.38 },
  { name: 'power-up-2', durationSeconds: 0.23, attackSeconds: 0.003, releaseSeconds: 0.03, volume: 0.47, polyphony: 1, throttleMs: 80, targetPeak: 0.41 },
  { name: 'power-up-3', durationSeconds: 0.29, attackSeconds: 0.003, releaseSeconds: 0.04, volume: 0.46, polyphony: 1, throttleMs: 80, targetPeak: 0.44 },
  // Boss entry identities mirror their actual spatial verbs: orbit, latch,
  // scan, seal, and the final authority's closing walls.
  { name: 'boss-enter-warden', durationSeconds: 0.48, attackSeconds: 0.003, releaseSeconds: 0.07, volume: 0.6, polyphony: 1, throttleMs: 120, targetPeak: 0.52 },
  { name: 'boss-enter-magistrate', durationSeconds: 0.7, attackSeconds: 0.004, releaseSeconds: 0.1, volume: 0.59, polyphony: 1, throttleMs: 120, targetPeak: 0.54 },
  { name: 'boss-enter-chancellor', durationSeconds: 0.76, attackSeconds: 0.004, releaseSeconds: 0.11, volume: 0.58, polyphony: 1, throttleMs: 120, targetPeak: 0.56 },
  { name: 'boss-enter-regent', durationSeconds: 0.9, attackSeconds: 0.005, releaseSeconds: 0.14, volume: 0.57, polyphony: 1, throttleMs: 140, targetPeak: 0.6 },
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
  let scanPhase = 0;

  for (let i = 0; i < count; i++) {
    const t = i / V4_AUDIO_SAMPLE_RATE;
    const loopPhase = i / count;
    const breath = 0.72 + 0.28 * sine(2 / spec.loopSeconds, t);
    const slot = Math.floor(i / slotLength);
    const local = (i - slot * slotLength) / slotLength;
    const sub = Math.min(3, Math.floor(local * 4));
    const subLocal = local * 4 - sub;
    // Authored structures stop before the loop edge. The low continuous field
    // carries the seam; every data pulse and scanner lands in real silence.
    const structureGain = 1 - smoothstep((loopPhase - 0.88) / 0.08);

    // Surface — every architecture owns a different low-frequency room. These
    // are all whole-loop/cycle-snapped, so diversity does not spend the seam.
    let sample = 0;
    switch (spec.architecture) {
      case 'menu':
        sample = breath * (0.09 * sine(surfaceRoot, t) + 0.02 * sine(surfaceFifth, t));
        break;
      case 'open-signal':
        sample =
          breath *
          (0.095 * sine(surfaceRoot, t) +
            0.025 * sine(surfaceFifth, t) +
            0.016 * sine(surfaceRoot * 2, t));
        break;
      case 'descending-corridor': {
        const binaryLevels = [1, 0.42, 0.72, 0.18] as const;
        const from = binaryLevels[slot % 4] ?? 0;
        const to = binaryLevels[(slot + 1) % 4] ?? 0;
        // Interpolate the binary word into its next cell. The data identity
        // stays audible, but the final cell now arrives at the first cell's
        // level so a Web Audio loop cannot expose a gain discontinuity.
        const binaryGate = from + (to - from) * smoothstep(local);
        sample =
          binaryGate *
          (0.074 * sine(surfaceRoot, t) + 0.041 * sine(surfaceRoot * 2, t));
        break;
      }
      case 'accreted-record': {
        sample = 0.067 * sine(surfaceRoot, t);
        const layerTwo =
          smoothstep((loopPhase - 0.12) / 0.08) *
          (1 - smoothstep((loopPhase - 0.82) / 0.1));
        const layerThree =
          smoothstep((loopPhase - 0.3) / 0.08) *
          (1 - smoothstep((loopPhase - 0.73) / 0.09));
        const layerFour =
          smoothstep((loopPhase - 0.48) / 0.07) *
          (1 - smoothstep((loopPhase - 0.64) / 0.08));
        sample += 0.035 * layerTwo * sine(surfaceFifth, t);
        sample += 0.024 * layerThree * sine(surfaceRoot * 2, t);
        sample += 0.014 * layerFour * sine(surfaceFifth * 2, t);
        sample *= breath;
        break;
      }
      case 'closing-vault':
        sample =
          breath *
          (0.12 * sine(surfaceRoot, t) +
            0.032 * sine(surfaceRoot * 2, t) +
            0.018 * sine(surfaceFifth, t));
        break;
      case 'sentinel-orbit': {
        const neighbour = snappedFrequency(spec.root + 1 / spec.loopSeconds, spec.loopSeconds);
        sample =
          breath *
          (0.078 * sine(surfaceRoot, t) +
            0.058 * sine(neighbour, t) +
            0.02 * sine(surfaceFifth, t));
        break;
      }
      case 'warden-latch': {
        const latchWord = [1, 1, 0, 1, 0, 0, 1, 0] as const;
        const from = latchWord[slot % 8] ?? 0;
        const to = latchWord[(slot + 1) % 8] ?? 0;
        const latched = from + (to - from) * smoothstep(local);
        sample = latched * (0.105 * sine(surfaceRoot, t) + 0.038 * sine(surfaceRoot * 2, t));
        break;
      }
      case 'magistrate-scan':
        sample =
          breath *
          (0.076 * sine(surfaceRoot, t) +
            0.041 * sine(surfaceFifth, t) +
            0.018 * sine(surfaceRoot * 2, t));
        break;
      case 'chancellor-seal':
        sample =
          breath *
          (0.086 * sine(surfaceRoot, t) +
            0.032 * sine(surfaceRoot * 2, t) +
            0.018 * sine(surfaceFifth * 2, t));
        break;
      case 'regent-recapitulation':
        sample =
          breath *
          (0.118 * sine(surfaceRoot, t) +
            0.034 * sine(surfaceFifth, t) +
            0.018 * sine(surfaceRoot * 2, t));
        break;
      case 'unmoored-signal':
        sample =
          breath *
          (0.095 * sine(surfaceRoot, t) +
            0.03 * sine(surfaceFifth, t) +
            0.014 * sine(surfaceRoot * 2, t));
        break;
      case 'terminal-cadence':
        sample =
          breath *
          (0.083 * sine(surfaceRoot, t) +
            0.025 * sine(surfaceFifth, t) +
            0.014 * sine(surfaceRoot * 2, t));
        break;
    }

    // Heart — the campaign cell stays related, while attack/release and partial
    // balance follow the room it is being stated in.
    const degree = spec.motif[slot];
    if (degree !== undefined && !Number.isNaN(degree)) {
      const leadFrequency = scaleFrequency(spec.root, spec.mode, degree);
      let attack = trance ? 0.16 : 0.055;
      let releaseAt = trance ? 0.84 : 0.62;
      let leadAmplitude = trance ? 0.205 : 0.195;
      switch (spec.architecture) {
        case 'open-signal':
          releaseAt = 0.48;
          break;
        case 'descending-corridor':
          attack = 0.025;
          releaseAt = 0.38;
          leadAmplitude = 0.185;
          break;
        case 'accreted-record':
          releaseAt = 0.72;
          break;
        case 'closing-vault':
          attack = 0.075;
          releaseAt = 0.56;
          leadAmplitude = 0.21;
          break;
        case 'sentinel-orbit':
          releaseAt = 0.68;
          leadAmplitude = 0.215;
          break;
        case 'warden-latch':
          attack = 0.02;
          releaseAt = 0.32;
          leadAmplitude = 0.22;
          break;
        case 'magistrate-scan':
          attack = 0.035;
          releaseAt = 0.5;
          break;
        case 'chancellor-seal':
          attack = 0.018;
          releaseAt = 0.28;
          leadAmplitude = 0.22;
          break;
        case 'regent-recapitulation':
          attack = 0.07;
          releaseAt = 0.66;
          leadAmplitude = 0.22;
          break;
        default:
          break;
      }
      const leadGate = gate(local, attack, releaseAt);
      const leadBody =
        leadAmplitude * sine(leadFrequency, t) +
        0.032 * sine(leadFrequency * 2, t);
      sample += leadBody * leadGate;
    }

    // Skeleton / mycelium — the actual per-track grammar. A tiny, deliberately
    // supra-behaviour-band data tick (≥3.4kHz) nods to binary transcription
    // without occupying the 1.5–3kHz lane reserved for play.
    const microEnvelope =
      subLocal < 0.3
        ? smoothstep(subLocal / 0.055) * smoothstep((0.3 - subLocal) / 0.22)
        : 0;
    const highData = 3400 + (spec.root % 5) * 530;
    switch (spec.architecture) {
      case 'menu':
        break;
      case 'open-signal': {
        if ((slot === 0 || slot === 8) && sub === 0) {
          sample += structureGain * microEnvelope * 0.02 * sine(highData, t);
        }
        break;
      }
      case 'descending-corridor': {
        const code = [1, 0, 1, 1, 0, 1, 0, 0][(slot * 4 + sub) % 8] ?? 0;
        if (code > 0) {
          const descent = 940 - 520 * ((slot + local) / spec.beats);
          scanPhase += (360 * descent) / V4_AUDIO_SAMPLE_RATE;
          sample +=
            structureGain *
            microEnvelope *
            (0.052 * sinDeg(scanPhase % 360) + 0.012 * sine(highData, t));
        }
        break;
      }
      case 'accreted-record': {
        const layers = 1 + Math.min(3, Math.floor(loopPhase * 4));
        const frequencies = [330, 495, 660, 825] as const;
        for (let layer = 0; layer < layers; layer++) {
          const division = layer + 2;
          if ((slot * 4 + sub + layer) % division !== 0) continue;
          sample +=
            structureGain *
            microEnvelope *
            (0.018 / (1 + layer * 0.18)) *
            sine(frequencies[layer] ?? 330, t);
        }
        break;
      }
      case 'closing-vault': {
        if (slot % 4 === 0 && local < 0.34) {
          const heart = smoothstep(local / 0.035) * smoothstep((0.34 - local) / 0.25);
          sample += structureGain * heart * (0.072 * sine(118, t) + 0.025 * sine(236, t));
        }
        if ([0, 5, 11].includes(slot) && sub < 2) {
          sample += structureGain * microEnvelope * 0.016 * sine(highData + sub * 740, t);
        }
        break;
      }
      case 'sentinel-orbit': {
        if (slot % 2 === 0 && sub === (slot / 2) % 4) {
          const orbit = 430 + 90 * sine(1 / spec.loopSeconds, t);
          sample +=
            structureGain *
            microEnvelope *
            (0.042 * sine(orbit, t) + 0.014 * sine(highData, t));
        }
        break;
      }
      case 'warden-latch': {
        const latch = local < 0.18 || (local > 0.28 && local < 0.42);
        if (latch) {
          const latchLocal = local < 0.18 ? local / 0.18 : (local - 0.28) / 0.14;
          const latchEnvelope =
            smoothstep(latchLocal / 0.12) * smoothstep((1 - latchLocal) / 0.5);
          sample +=
            structureGain *
            latchEnvelope *
            (0.065 * sine(260, t) + 0.028 * sine(520, t));
        }
        break;
      }
      case 'magistrate-scan': {
        const scanPosition = ((slot % 4) + local) / 4;
        const scanHz = 980 - 620 * scanPosition;
        scanPhase += (360 * scanHz) / V4_AUDIO_SAMPLE_RATE;
        if (slot % 4 !== 3 && local < 0.72) {
          const scanEnvelope =
            smoothstep(local / 0.04) * smoothstep((0.72 - local) / 0.18);
          sample +=
            structureGain *
            scanEnvelope *
            (0.048 * sinDeg(scanPhase % 360) + 0.012 * sine(highData, t));
        }
        break;
      }
      case 'chancellor-seal': {
        if ([0, 3, 7, 10].includes(slot) && local < 0.24) {
          const stamp = smoothstep(local / 0.025) * smoothstep((0.24 - local) / 0.18);
          sample +=
            structureGain *
            stamp *
            (0.075 * sine(210, t) + 0.035 * sine(840, t) + 0.01 * sine(highData, t));
        }
        break;
      }
      case 'regent-recapitulation': {
        const quarter = Math.min(3, Math.floor(loopPhase * 4));
        if (quarter === 0 && slot % 2 === 0 && sub === 0) {
          sample += structureGain * microEnvelope * 0.04 * sine(430, t);
        } else if (quarter === 1 && (sub === 0 || sub === 1)) {
          sample += structureGain * microEnvelope * 0.042 * sine(260, t);
        } else if (quarter === 2) {
          const scanHz = 900 - 470 * local;
          scanPhase += (360 * scanHz) / V4_AUDIO_SAMPLE_RATE;
          sample += structureGain * 0.035 * gate(local, 0.035, 0.58) * sinDeg(scanPhase % 360);
        } else if (quarter === 3 && slot % 3 === 0) {
          sample +=
            structureGain *
            gate(local, 0.025, 0.2) *
            (0.055 * sine(210, t) + 0.022 * sine(840, t));
        }
        break;
      }
      case 'unmoored-signal': {
        // Pulse floor removed; one sparse filament crosses the loop.
        const branchEnvelope =
          smoothstep(Math.min(1, loopPhase * 10)) *
          smoothstep(Math.min(1, (1 - loopPhase) * 10));
        const branch = snappedFrequency(3600 + (spec.root % 5) * 430, spec.loopSeconds);
        const wander = 0.65 + 0.35 * sine(3 / spec.loopSeconds, t);
        sample += 0.025 * branchEnvelope * wander * sine(branch, t);
        break;
      }
      case 'terminal-cadence':
        break;
    }

    if (trance && spec.architecture === 'terminal-cadence') {
      // The ending is the one 出神 form whose direction is resolution rather
      // than suspended data: no pulse, no high filament, only a disappearing
      // half-speed shadow under the authored descent.
      const branchEnvelope =
        smoothstep(Math.min(1, loopPhase * 10)) *
        smoothstep(Math.min(1, (1 - loopPhase) * 10));
      sample +=
        0.032 *
        branchEnvelope *
        (1 - loopPhase) *
        sine(snappedFrequency(spec.root * 4, spec.loopSeconds), t);
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
      case 'shot-tier-1': {
        const packet = p < 0.48 ? 0 : 1;
        const local = packet === 0 ? p / 0.48 : (p - 0.48) / 0.52;
        const hz = (packet === 0 ? 1380 : 1120) * (1 - local * 0.28);
        sweepPhase += (360 * hz) / V4_AUDIO_SAMPLE_RATE;
        sample =
          0.72 * sinDeg(sweepPhase % 360) +
          0.2 * sine(360, t) +
          0.08 * sine(3600, t);
        break;
      }
      case 'shot-tier-2': {
        const bit = Math.min(2, Math.floor(p * 3));
        const hz = [1740, 1320, 1040][bit] ?? 1040;
        sweepPhase += (360 * hz) / V4_AUDIO_SAMPLE_RATE;
        sample =
          0.62 * sinDeg(sweepPhase % 360) +
          0.25 * sine(420, t) +
          0.08 * sine(4200, t) +
          0.05 * lowNoise;
        break;
      }
      case 'shot-tier-3': {
        const bit = Math.min(3, Math.floor(p * 4));
        const hz = [2180, 1740, 1420, 1160][bit] ?? 1160;
        sweepPhase += (360 * hz) / V4_AUDIO_SAMPLE_RATE;
        sample =
          0.54 * sinDeg(sweepPhase % 360) +
          0.27 * sine(520, t) +
          0.11 * sine(4680 + bit * 310, t) +
          0.08 * lowNoise;
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
      case 'toll': {
        // Sentinel: two close orbital tones cross, then the low gate itself
        // lands. The high scan stays short and above the behavior band.
        const scan = p < 0.34 ? sine(3600 + 2200 * p, t) : 0;
        const gate = p > 0.22 ? sine(154, t) : 0;
        sample =
          0.38 * sine(462, t) +
          0.28 * sine(469, t) +
          0.25 * gate +
          0.09 * scan;
        break;
      }
      case 'boss-enter-warden': {
        // Four dry locks: the rotating beam cross closes one arm at a time.
        const lock = Math.min(3, Math.floor(p * 4));
        const local = p * 4 - lock;
        const latch = local < 0.38 ? smoothstep(local / 0.06) * smoothstep((0.38 - local) / 0.26) : 0;
        sample =
          latch *
          (0.58 * sine(210 + lock * 23, t) +
            0.27 * sine(840 + lock * 71, t) +
            0.15 * lowNoise);
        break;
      }
      case 'boss-enter-magistrate': {
        // Three quantised downward scans end in one low docket ripple.
        const verdict = Math.min(2, Math.floor(p * 3));
        const local = p * 3 - verdict;
        const hz = [1160, 820, 560][verdict] ?? 560;
        sweepPhase += (360 * hz) / V4_AUDIO_SAMPLE_RATE;
        const scanGate = local < 0.7 ? smoothstep(local / 0.05) * smoothstep((0.7 - local) / 0.18) : 0;
        sample =
          scanGate * (0.63 * sinDeg(sweepPhase % 360) + 0.12 * sine(3900, t)) +
          (p > 0.62 ? 0.25 * sine(132, t) : 0);
        break;
      }
      case 'boss-enter-chancellor': {
        // Twelve rising data grains are cut off by a single wax-seal stamp.
        const grain = Math.min(11, Math.floor(p * 12));
        const local = p * 12 - grain;
        const grainGate = local < 0.22 ? smoothstep(local / 0.045) * smoothstep((0.22 - local) / 0.13) : 0;
        const stamp = p > 0.72 ? smoothstep((p - 0.72) / 0.035) : 0;
        sample =
          grainGate * (0.34 * sine(620 + grain * 47, t) + 0.1 * sine(4100 + grain * 31, t)) +
          stamp * (0.46 * sine(188, t) + 0.1 * lowNoise);
        break;
      }
      case 'boss-enter-regent': {
        // Fourteen contour marks, every fifth weighted, close onto the absent
        // centre. The final low half-wave is pressure, not a louder explosion.
        const contour = Math.min(13, Math.floor(p * 14));
        const local = p * 14 - contour;
        const clickGate = local < 0.18 ? smoothstep(local / 0.04) * smoothstep((0.18 - local) / 0.1) : 0;
        const major = contour % 5 === 0 ? 1 : 0.55;
        const crown = p > 0.76 ? smoothstep((p - 0.76) / 0.04) : 0;
        sample =
          clickGate *
            major *
            (0.28 * sine(760 + contour * 29, t) + 0.13 * sine(4800 + contour * 37, t)) +
          crown * (0.48 * sine(55, t) + 0.11 * sine(110, t));
        break;
      }
      case 'power-up-1': {
        const hz = p < 0.48 ? 920 : 1380;
        sample = 0.82 * sine(hz, t) + 0.18 * sine(3600, t);
        break;
      }
      case 'power-up-2': {
        const step = Math.min(2, Math.floor(p * 3));
        const hz = [820, 1180, 1660][step] ?? 1660;
        sample = 0.72 * sine(hz, t) + 0.18 * sine(hz * 0.5, t) + 0.1 * sine(4100, t);
        break;
      }
      case 'power-up-3': {
        const step = Math.min(3, Math.floor(p * 4));
        const hz = [760, 1080, 1520, 2040][step] ?? 2040;
        sample =
          0.62 * sine(hz, t) +
          0.24 * sine(hz * 0.5, t) +
          0.1 * sine(4600 + step * 180, t) +
          0.04 * lowNoise;
        break;
      }
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
