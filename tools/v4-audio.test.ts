/**
 * Acceptance contract for the committed v4 WAV files.
 *
 * This reads `packs/v4`, not the fallback synth and not an in-memory parameter
 * table. The independent RIFF parser is what makes a malformed or silent
 * release file fail even when its generator still believes it wrote audio.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import {
  SOUND_NAMES,
  type PackManifest,
  type SoundName,
} from '../src/packs/manifest';
import {
  bandFraction,
  bandRms,
  decodePcm16Wav,
  mean,
  peak,
  rms,
  type DecodedPcm16Wav,
} from './audio-analysis';
import {
  V4_AUDIO_SAMPLE_RATE,
  V4_MUSIC_MANIFEST,
  V4_RELEASE_MUSIC_NAMES,
  V4_SOUND_MANIFEST,
  V4_SOUND_SPECS,
  V4_TRACK_SPECS,
  buildV4AudioFiles,
} from './v4-audio';
import { V4_PACK_DIR } from './make-v4-pack';

const MUSIC_MASTER = 0.55;
const manifest = JSON.parse(
  readFileSync(join(V4_PACK_DIR, 'pack.json'), 'utf8'),
) as PackManifest;

function committed(relative: string): Uint8Array {
  return readFileSync(join(V4_PACK_DIR, relative));
}

const tracks = new Map<string, DecodedPcm16Wav>(
  V4_TRACK_SPECS.map((spec) => [
    spec.name,
    decodePcm16Wav(committed(`audio/music/${spec.name}.wav`)),
  ]),
);
const sounds = new Map<SoundName, DecodedPcm16Wav>(
  V4_SOUND_SPECS.map((spec) => [
    spec.name,
    decodePcm16Wav(committed(`audio/sfx/${spec.name}.wav`)),
  ]),
);

function allDiskAudio(): string[] {
  const out: string[] = [];
  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(join(directory, entry.name), relative);
      else out.push(`audio/${relative}`);
    }
  };
  walk(join(V4_PACK_DIR, 'audio'), '');
  return out.sort();
}

function effectiveTrackRms(name: string): number {
  const spec = V4_TRACK_SPECS.find((entry) => entry.name === name)!;
  return rms(tracks.get(name)!.samples) * spec.volume * MUSIC_MASTER;
}

function effectiveSoundPeak(name: SoundName): number {
  const spec = V4_SOUND_SPECS.find((entry) => entry.name === name)!;
  return peak(sounds.get(name)!.samples) * spec.volume;
}

const durationBounds: Record<SoundName, readonly [number, number]> = {
  death: [0.5, 1],
  explosion: [0.3, 0.7],
  toll: [0.35, 0.9],
  break: [0.12, 0.3],
  declare: [0.18, 0.45],
  hit: [0.04, 0.14],
  clear: [0.2, 0.6],
  pickup: [0.08, 0.25],
  shot: [0.035, 0.1],
  graze: [0.06, 0.18],
  'ui-confirm': [0.035, 0.09],
  'ui-cancel': [0.035, 0.09],
  'ui-move': [0.015, 0.05],
  'ui-advance': [0.02, 0.07],
  'ui-pause': [0.04, 0.12],
};

const peakBounds: Record<SoundName, readonly [number, number]> = {
  death: [0.55, 0.8],
  explosion: [0.35, 0.55],
  toll: [0.24, 0.38],
  break: [0.17, 0.25],
  declare: [0.17, 0.25],
  hit: [0.14, 0.21],
  clear: [0.13, 0.21],
  pickup: [0.12, 0.19],
  shot: [0.08, 0.15],
  graze: [0.05, 0.09],
  'ui-confirm': [0.04, 0.075],
  'ui-cancel': [0.04, 0.075],
  'ui-move': [0.035, 0.07],
  'ui-advance': [0.035, 0.07],
  'ui-pause': [0.035, 0.07],
};

describe('v4 release-audio inventory', () => {
  test('manifest and disk contain exactly thirteen tracks and fifteen cues', () => {
    expect(manifest.sounds).toEqual(V4_SOUND_MANIFEST);
    expect(manifest.music).toEqual(V4_MUSIC_MANIFEST);
    expect(Object.keys(manifest.sounds ?? {})).toEqual([...SOUND_NAMES]);
    expect(Object.keys(manifest.music ?? {})).toEqual([...V4_RELEASE_MUSIC_NAMES]);

    const declared = [
      ...Object.values(manifest.sounds ?? {}).map((value) =>
        typeof value === 'string' ? value : value.file,
      ),
      ...Object.values(manifest.music ?? {}).map((value) => value.file),
    ].sort();
    expect(declared).toHaveLength(28);
    expect(new Set(declared).size).toBe(28);
    expect(allDiskAudio()).toEqual(declared);
  });

  test('every cue carries explicit release mix and repetition policy', () => {
    for (const name of SOUND_NAMES) {
      const value = manifest.sounds?.[name];
      expect(typeof value, name).toBe('object');
      if (typeof value !== 'object' || value === null) continue;
      expect(value.volume, name).toBeNumber();
      expect(value.polyphony, name).toBeInteger();
      expect(value.throttleMs, name).toBeNumber();
    }
  });
});

describe('v4 PCM release format and hygiene', () => {
  test('all 28 files are canonical, nonempty mono PCM16 at 22050Hz', () => {
    for (const [name, decoded] of [...tracks, ...sounds]) {
      expect(decoded.channels, name).toBe(1);
      expect(decoded.bitsPerSample, name).toBe(16);
      expect(decoded.sampleRate, name).toBe(V4_AUDIO_SAMPLE_RATE);
      expect(decoded.blockAlign, name).toBe(2);
      expect(decoded.byteRate, name).toBe(V4_AUDIO_SAMPLE_RATE * 2);
      expect(decoded.samples.length, name).toBeGreaterThan(0);
      expect(peak(decoded.samples), name).toBeGreaterThanOrEqual(0.2 - 1 / 32768);
      expect(peak(decoded.samples), name).toBeLessThanOrEqual(0.8);
      expect(Math.abs(mean(decoded.samples)), name).toBeLessThanOrEqual(0.005);
    }
  });

  test('every cue has real attack/release and silent endpoints', () => {
    for (const spec of V4_SOUND_SPECS) {
      const decoded = sounds.get(spec.name)!;
      expect(spec.attackSeconds, spec.name).toBeGreaterThanOrEqual(0.002);
      expect(spec.releaseSeconds, spec.name).toBeGreaterThanOrEqual(0.002);
      expect(Math.abs(decoded.samples[0]!), spec.name).toBeLessThanOrEqual(0.01);
      expect(Math.abs(decoded.samples.at(-1)!), spec.name).toBeLessThanOrEqual(0.01);

      const edgeFrames = Math.max(1, Math.round(decoded.sampleRate * 0.001));
      const rawPeak = peak(decoded.samples);
      expect(peak(decoded.samples.subarray(0, edgeFrames)), spec.name).toBeLessThan(
        rawPeak * 0.75,
      );
      expect(peak(decoded.samples.subarray(-edgeFrames)), spec.name).toBeLessThan(
        rawPeak * 0.75,
      );
    }
  });

  test('cue durations occupy their semantic windows', () => {
    for (const spec of V4_SOUND_SPECS) {
      const decoded = sounds.get(spec.name)!;
      const seconds = decoded.samples.length / decoded.sampleRate;
      const [lo, hi] = durationBounds[spec.name];
      expect(seconds, spec.name).toBeGreaterThanOrEqual(lo);
      expect(seconds, spec.name).toBeLessThanOrEqual(hi);
    }
  });
});

describe('v4 formal score', () => {
  test('loop duration, level and quantised seam satisfy the release contract', () => {
    for (const spec of V4_TRACK_SPECS) {
      const decoded = tracks.get(spec.name)!;
      const expectedFrames = Math.round(spec.loopSeconds * decoded.sampleRate);
      expect(decoded.samples.length, spec.name).toBe(expectedFrames);
      expect(effectiveTrackRms(spec.name), spec.name).toBeGreaterThanOrEqual(0.025);
      expect(effectiveTrackRms(spec.name), spec.name).toBeLessThanOrEqual(0.075);

      const seam = Math.abs(decoded.samples[0]! - decoded.samples.at(-1)!);
      expect(seam, spec.name).toBeLessThanOrEqual(0.02);
      const edge = 64;
      const before = rms(decoded.samples.subarray(-edge));
      const after = rms(decoded.samples.subarray(0, edge));
      expect(Math.abs(before - after), spec.name).toBeLessThanOrEqual(0.03);
    }
  });

  test('music vacates behavior frequencies while keeping an audible lead lane', () => {
    for (const spec of V4_TRACK_SPECS) {
      const decoded = tracks.get(spec.name)!;
      const behavior = bandFraction(decoded.samples, decoded.sampleRate, 1500, 3000);
      expect(behavior, spec.name).toBeLessThanOrEqual(
        spec.stance === 'trance' ? 0.08 : 0.06,
      );

      const lead = bandRms(decoded.samples, decoded.sampleRate, 300, 1000);
      expect(lead, spec.name).toBeGreaterThanOrEqual(0.025);
      expect(lead / rms(decoded.samples), spec.name).toBeGreaterThanOrEqual(0.34);
    }
  });

  test('absorption phrases sound at least half their grid and end with a real breath', () => {
    for (const spec of V4_TRACK_SPECS.filter((entry) => entry.stance === 'absorption')) {
      const sounded = spec.motif.filter((degree) => !Number.isNaN(degree)).length;
      expect(sounded / spec.beats, spec.name).toBeGreaterThanOrEqual(0.5);

      const decoded = tracks.get(spec.name)!;
      const tailFrames = Math.round(decoded.sampleRate * 0.4);
      const tail = decoded.samples.subarray(-tailFrames);
      expect(bandRms(tail, decoded.sampleRate, 300, 1000), spec.name).toBeLessThan(
        0.01,
      );
    }
  });
});

describe('v4 cue hierarchy and the menu behavior lane', () => {
  test('every effective peak is inside its semantic window', () => {
    for (const name of SOUND_NAMES) {
      const [lo, hi] = peakBounds[name];
      const value = effectiveSoundPeak(name);
      expect(value, name).toBeGreaterThanOrEqual(lo);
      expect(value, name).toBeLessThanOrEqual(hi);
    }
  });

  test('priority groups are strictly ordered with no cross-layer ambiguity', () => {
    const range = (names: readonly SoundName[]): readonly [number, number] => {
      const values = names.map(effectiveSoundPeak);
      return [Math.min(...values), Math.max(...values)];
    };
    const groups: readonly (readonly SoundName[])[] = [
      ['death'],
      ['explosion'],
      ['toll'],
      ['break', 'declare'],
      ['hit', 'clear', 'pickup'],
      ['shot'],
      ['graze'],
      ['ui-move', 'ui-confirm', 'ui-cancel', 'ui-pause', 'ui-advance'],
    ];
    for (let i = 0; i < groups.length - 1; i++) {
      expect(range(groups[i]!)[0], `${groups[i]!.join('/')} > ${groups[i + 1]!.join('/')}`)
        .toBeGreaterThan(range(groups[i + 1]!)[1]);
    }
  });

  test('graze and navigation occupy the frequency space the menu leaves open', () => {
    for (const name of ['graze', 'ui-move', 'ui-confirm', 'ui-cancel'] as const) {
      const decoded = sounds.get(name)!;
      expect(
        bandFraction(decoded.samples, decoded.sampleRate, 1500, 3000),
        name,
      ).toBeGreaterThanOrEqual(0.5);
    }

    const menu = effectiveTrackRms('menu');
    for (const name of ['ui-move', 'ui-confirm', 'ui-cancel'] as const) {
      const cue = effectiveSoundPeak(name);
      expect(20 * Math.log10(cue / menu), name).toBeGreaterThanOrEqual(3);
      expect(cue, name).toBeLessThan(effectiveSoundPeak('graze'));
    }
  });

  test('continuous shot feedback stays at least 7dB above the loudest score RMS', () => {
    const loudest = Math.max(
      ...V4_TRACK_SPECS.map((spec) => effectiveTrackRms(spec.name)),
    );
    const ratioDb = 20 * Math.log10(effectiveSoundPeak('shot') / loudest);
    expect(ratioDb).toBeGreaterThanOrEqual(7);
  });
});

describe('v4 release-audio determinism', () => {
  test('two uncached builds are byte-identical and independently allocated', () => {
    const first = buildV4AudioFiles();
    const second = buildV4AudioFiles();
    expect([...first.keys()]).toEqual([...second.keys()]);
    for (const path of first.keys()) {
      const a = first.get(path)!;
      const b = second.get(path)!;
      expect(a, path).not.toBe(b);
      expect(a.byteLength, path).toBe(b.byteLength);
      expect(Buffer.compare(Buffer.from(a), Buffer.from(b)), path).toBe(0);
    }
  });
});
