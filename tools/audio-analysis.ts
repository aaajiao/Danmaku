/** Independent PCM/WAV analysis used to judge committed release assets. */

export interface DecodedPcm16Wav {
  readonly channels: number;
  readonly sampleRate: number;
  readonly bitsPerSample: number;
  readonly blockAlign: number;
  readonly byteRate: number;
  readonly samples: Float32Array;
}

function tag(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + 4));
}

/**
 * Parse RIFF chunks instead of assuming the generator's canonical 44-byte
 * header. This keeps the verifier independent from the writer it is checking.
 */
export function decodePcm16Wav(bytes: Uint8Array): DecodedPcm16Wav {
  if (bytes.byteLength < 12 || tag(bytes, 0) !== 'RIFF' || tag(bytes, 8) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffSize = view.getUint32(4, true);
  if (riffSize + 8 !== bytes.byteLength) throw new Error('RIFF size does not match file length');

  let format: {
    audioFormat: number;
    channels: number;
    sampleRate: number;
    byteRate: number;
    blockAlign: number;
    bitsPerSample: number;
  } | undefined;
  let data: Uint8Array | undefined;

  for (let at = 12; at + 8 <= bytes.byteLength; ) {
    const size = view.getUint32(at + 4, true);
    const start = at + 8;
    const end = start + size;
    if (end > bytes.byteLength) throw new Error(`RIFF chunk ${tag(bytes, at)} overruns file`);
    const kind = tag(bytes, at);
    if (kind === 'fmt ') {
      if (size < 16) throw new Error('short fmt chunk');
      format = {
        audioFormat: view.getUint16(start, true),
        channels: view.getUint16(start + 2, true),
        sampleRate: view.getUint32(start + 4, true),
        byteRate: view.getUint32(start + 8, true),
        blockAlign: view.getUint16(start + 12, true),
        bitsPerSample: view.getUint16(start + 14, true),
      };
    } else if (kind === 'data') {
      data = bytes.subarray(start, end);
    }
    at = end + (size & 1);
  }

  if (!format) throw new Error('missing fmt chunk');
  if (!data) throw new Error('missing data chunk');
  if (format.audioFormat !== 1) throw new Error(`expected PCM format 1, got ${format.audioFormat}`);
  if (format.channels !== 1) throw new Error(`expected mono, got ${format.channels} channels`);
  if (format.bitsPerSample !== 16) {
    throw new Error(`expected PCM16, got ${format.bitsPerSample} bits`);
  }
  if (format.blockAlign !== 2 || format.byteRate !== format.sampleRate * 2) {
    throw new Error('inconsistent PCM16 mono rate/alignment');
  }
  if (data.byteLength === 0 || data.byteLength % format.blockAlign !== 0) {
    throw new Error('empty or partial PCM data');
  }

  const samples = new Float32Array(data.byteLength / 2);
  const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = dataView.getInt16(i * 2, true) / 32768;
  }
  return {
    channels: format.channels,
    sampleRate: format.sampleRate,
    bitsPerSample: format.bitsPerSample,
    blockAlign: format.blockAlign,
    byteRate: format.byteRate,
    samples,
  };
}

export function mean(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample;
  return sum / samples.length;
}

export function rms(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

export function peak(samples: Float32Array): number {
  let value = 0;
  for (const sample of samples) value = Math.max(value, Math.abs(sample));
  return value;
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
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
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
        const nextReal = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nextReal;
      }
    }
  }
}

function fftSize(length: number): number {
  let size = 1024;
  while (size < length && size < 8192) size <<= 1;
  return size;
}

/** Welch-averaged power fraction in a frequency band. */
export function bandFraction(
  samples: Float32Array,
  sampleRate: number,
  lo: number,
  hi: number,
): number {
  const size = fftSize(samples.length);
  const window = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  }
  const frameCount = samples.length >= size ? 8 : 1;
  const maxStart = Math.max(0, samples.length - size);
  let bandPower = 0;
  let totalPower = 0;

  for (let frame = 0; frame < frameCount; frame++) {
    const start =
      frameCount === 1 ? 0 : Math.round((maxStart * frame) / (frameCount - 1));
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      re[i] = (start + i < samples.length ? (samples[start + i] as number) : 0) *
        (window[i] as number);
    }
    fft(re, im);
    for (let bin = 0; bin < size; bin++) {
      const magnitude =
        (re[bin] as number) ** 2 + (im[bin] as number) ** 2;
      const frequency = (Math.min(bin, size - bin) * sampleRate) / size;
      totalPower += magnitude;
      if (frequency >= lo && frequency <= hi) bandPower += magnitude;
    }
  }
  return totalPower > 0 ? bandPower / totalPower : 0;
}

export function bandRms(
  samples: Float32Array,
  sampleRate: number,
  lo: number,
  hi: number,
): number {
  return Math.sqrt(bandFraction(samples, sampleRate, lo, hi)) * rms(samples);
}
