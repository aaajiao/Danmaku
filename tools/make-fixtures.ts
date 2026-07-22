/**
 * Generate the asset fixtures in `test/fixtures/`.
 *
 *     bun tools/make-fixtures.ts
 *
 * ## Why these files exist
 *
 * Everything the renderer and the audio registry have been tested against so
 * far was made in memory: `render/procedural.ts` paints into a canvas and
 * `audio/index.ts` synthesises its buffers. The code that reads an actual file
 * — `loadTexture`/`loadAtlas` (src/render/atlas.ts) and the `url` branch of
 * `Audio.#ensure` — has therefore never run. Those paths are where real
 * decoding, colour space, alpha and dimension arithmetic live.
 *
 * Upstream's PNGs cannot serve as the fixtures. They are Touhou derivatives
 * (CLAUDE.md rule 9), and they are all power-of-two with a clean alpha channel,
 * so they would exercise only the cases that already work. Generating our own
 * lets each file aim at a specific way a loader breaks. `test/fixtures/README.md`
 * records which failure each one is pointed at.
 *
 * ## Why the outputs are committed
 *
 * A test that regenerates its own inputs proves less than one with fixed
 * inputs: if the encoder and the decoder drift together, both stay green. The
 * files are a few kilobytes, so they are checked in and this script is the
 * record of how they were made, not a build step.
 *
 * ## The PNG encoder
 *
 * Lives in `tools/png.ts`, not here, so every asset generator can share the
 * same encoder and independent verifying parser. A second hand-rolled
 * implementation is exactly the kind of pair that drifts apart silently.
 *
 * A subtly wrong PNG is accepted by some decoders and rejected by others, which
 * would be a miserable thing to debug months from now. So this script verifies
 * what it wrote, with a parser independent of the encoder and with the system
 * decoders (`sips`, `afinfo`) as a second opinion — and it proves that check can
 * fail before trusting it. See `verify()` and `proveVerifierFails()`.
 */

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sinDeg } from '../src/core/trig';
import { BULLET_GRID, BULLET_COLUMNS, BULLET_ROWS } from '../src/render/procedural';
import { ColourType, encodePng, parsePng, pixelOf, crc32, type PngHeader } from './png';

const OUT = join(import.meta.dir, '..', 'test', 'fixtures');

/* ------------------------------------------------------------------ */
/* WAV encoding                                                        */
/* ------------------------------------------------------------------ */

const SAMPLE_RATE = 44100;

/** 16-bit PCM, one array per channel, samples in [-1, 1]. */
function encodeWav(channels: readonly Float64Array[]): Uint8Array {
  const count = channels[0]!.length;
  const channelCount = channels.length;
  const blockAlign = channelCount * 2;
  const dataBytes = count * blockAlign;

  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) out[at + i] = text.charCodeAt(i);
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true); // everything after this field
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // format: PCM
  view.setUint16(22, channelCount, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < count; i++) {
    for (let c = 0; c < channelCount; c++) {
      const sample = channels[c]![i]!;
      // Asymmetric on purpose: two's complement 16-bit reaches -32768 but only
      // +32767, and scaling both ends by 32768 wraps a full-scale positive
      // sample to a full-scale negative one — an audible click at the peak.
      const clamped = sample < -1 ? -1 : sample > 1 ? 1 : sample;
      view.setInt16(44 + i * blockAlign + c * 2, Math.round(clamped * 32767), true);
    }
  }

  return out;
}

/**
 * A decaying tone.
 *
 * `sinDeg` rather than `Math.sin` (CLAUDE.md rule 3). Nothing here reaches the
 * simulation, so this is not a correctness requirement — but `Math.sin` is
 * implementation-approximated, so regenerating these fixtures under a different
 * engine could produce different bytes for identical source. A fixture whose
 * checked-in form depends on who ran the script is not a fixture.
 */
function tone(seconds: number, hz: number, peak: number, decay: number): Float64Array {
  const count = Math.round(seconds * SAMPLE_RATE);
  const out = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    const degrees = (hz * t * 360) % 360;
    out[i] = sinDeg(degrees) * peak * Math.exp(-decay * t);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The fixtures                                                        */
/* ------------------------------------------------------------------ */

/**
 * Sixteen flat colours, one per cell of the bullet grid.
 *
 * Flat and maximally unlike each other so a UV or stride error presents as
 * plainly the wrong colour. A gradient or a shape would let an off-by-one cell
 * offset look like a rounding artefact; solid magenta where solid green belongs
 * cannot be mistaken for anything but a bug.
 */
const CELL_COLOURS: ReadonlyArray<readonly [number, number, number]> = [
  [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0],
  [255, 0, 255], [0, 255, 255], [255, 128, 0], [128, 0, 255],
  [0, 128, 64], [128, 64, 0], [64, 0, 128], [192, 192, 192],
  [255, 255, 255], [16, 16, 16], [0, 96, 255], [255, 0, 96],
];

/** Signals "you addressed a pixel that is not part of any whole cell". */
const OUT_OF_GRID: readonly [number, number, number, number] = [255, 0, 255, 255];

const files: Record<string, Uint8Array> = {};

// A proper grid matching BULLET_GRID, imported rather than restated so the
// fixture cannot drift from the geometry the game actually uses.
{
  const { cellW, cellH } = BULLET_GRID;
  const width = cellW * BULLET_COLUMNS;
  const height = cellH * BULLET_ROWS;
  files['grid-8x2.png'] = encodePng(width, height, ColourType.RGBA, (x, y) => {
    const index = Math.floor(y / cellH) * BULLET_COLUMNS + Math.floor(x / cellW);
    const [r, g, b] = CELL_COLOURS[index]!;
    return [r, g, b, 255];
  });
}

// Not a power of two in either dimension. WebGL1 required POT for wrapping and
// mipmaps; WebGL2 does not, and `loadTexture` disables mipmaps anyway. This
// file is here to prove we inherited none of that constraint.
files['npot.png'] = encodePng(100, 60, ColourType.RGBA, (x, y) => [
  Math.round((x / 99) * 255),
  Math.round((y / 59) * 255),
  64,
  // A real alpha ramp across x, so a decoder that drops or transposes the
  // channel produces a visibly wrong image rather than a plausible one.
  Math.round((x / 99) * 255),
]);

// Colour type 2: no alpha channel at all, not an opaque one. This is a defect
// upstream shipped — rumia.png had no alpha and drew on an opaque box — so the
// question this asks is what our loader does, and the answer should be
// "predictably treats it as fully opaque".
files['no-alpha.png'] = encodePng(64, 48, ColourType.RGB, (x, y) => [
  Math.round((x / 63) * 255),
  Math.round((y / 47) * 255),
  128,
  255, // ignored at this colour type
]);

// 100x40 against a 32x32 grid: three whole columns and one whole row, with a
// 4px strip on the right and an 8px strip on the bottom that belong to no cell.
// Those strips are magenta, so grid maths that walks off the end of a row or
// rounds the cell count up shows it as colour rather than as a silent read.
files['ragged.png'] = encodePng(100, 40, ColourType.RGBA, (x, y) => {
  const { cellW, cellH } = BULLET_GRID;
  const col = Math.floor(x / cellW);
  const row = Math.floor(y / cellH);
  const wholeCols = Math.floor(100 / cellW);
  const wholeRows = Math.floor(40 / cellH);
  if (col >= wholeCols || row >= wholeRows) return OUT_OF_GRID;
  const [r, g, b] = CELL_COLOURS[row * wholeCols + col]!;
  return [r, g, b, 255];
});

// The degenerate case. Half-transparent rather than opaque, because 1x1 is
// where a loader is most likely to take a shortcut, and a partial alpha is
// harder to produce by accident than 255.
files['one-pixel.png'] = encodePng(1, 1, ColourType.RGBA, () => [255, 128, 0, 128]);

files['blip.wav'] = encodeWav([tone(0.06, 880, 0.8, 18)]);

// Different content per channel, differing in both frequency and amplitude, so
// a channel swap is detectable two independent ways: a decoder that reads only
// peak level still sees it, and so does one that counts zero crossings. Two
// channels carrying the same tone at the same level would make a swap
// invisible, which is the whole failure this file exists to catch.
files['stereo.wav'] = encodeWav([tone(0.25, 220, 0.9, 3), tone(0.25, 1320, 0.25, 3)]);

/* ------------------------------------------------------------------ */
/* Verification                                                        */
/* ------------------------------------------------------------------ */

interface WavHeader {
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  frames: number;
}

function parseWav(bytes: Uint8Array): WavHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));

  if (tag(0) !== 'RIFF') throw new Error('not RIFF');
  if (tag(8) !== 'WAVE') throw new Error('not WAVE');
  // The RIFF size counts everything after the size field itself, a definition
  // easy to write off by eight.
  if (view.getUint32(4, true) !== bytes.length - 8) throw new Error('RIFF size wrong');
  if (tag(12) !== 'fmt ') throw new Error('no fmt chunk');
  if (view.getUint16(20, true) !== 1) throw new Error('not PCM');

  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  const blockAlign = view.getUint16(32, true);

  if (blockAlign !== (channels * bitsPerSample) / 8) throw new Error('blockAlign wrong');
  if (view.getUint32(28, true) !== sampleRate * blockAlign) throw new Error('byteRate wrong');
  if (tag(36) !== 'data') throw new Error('no data chunk');

  const dataBytes = view.getUint32(40, true);
  if (dataBytes !== bytes.length - 44) throw new Error('data size wrong');
  return { channels, sampleRate, bitsPerSample, frames: dataBytes / blockAlign };
}

/** Peak absolute level per channel, for confirming the two differ. */
function wavPeaks(bytes: Uint8Array, header: WavHeader): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const peaks = new Array<number>(header.channels).fill(0);
  const blockAlign = (header.channels * header.bitsPerSample) / 8;
  for (let i = 0; i < header.frames; i++) {
    for (let c = 0; c < header.channels; c++) {
      const s = Math.abs(view.getInt16(44 + i * blockAlign + c * 2, true)) / 32767;
      if (s > peaks[c]!) peaks[c] = s;
    }
  }
  return peaks;
}

/**
 * A second opinion from a decoder nobody here wrote.
 *
 * `sips` and `afinfo` are macOS system tools backed by ImageIO and CoreAudio.
 * They share no code with this script, so agreement between them and
 * `parsePng`/`parseWav` is real evidence rather than a tautology. Absent (a
 * non-macOS machine), the local parse still stands on its own and this returns
 * undefined rather than failing.
 */
function systemProbe(args: string[]): string | undefined {
  const result = Bun.spawnSync(args, { stderr: 'pipe' });
  if (!result.success) return undefined;
  return result.stdout.toString().trim();
}

const expected: Record<string, { width: number; height: number; colourType: ColourType }> = {
  'grid-8x2.png': { width: 256, height: 64, colourType: ColourType.RGBA },
  'npot.png': { width: 100, height: 60, colourType: ColourType.RGBA },
  'no-alpha.png': { width: 64, height: 48, colourType: ColourType.RGB },
  'ragged.png': { width: 100, height: 40, colourType: ColourType.RGBA },
  'one-pixel.png': { width: 1, height: 1, colourType: ColourType.RGBA },
};

/**
 * Confirm each file contains the image it was supposed to contain.
 *
 * A valid PNG of the wrong picture is still a useless fixture: `grid-8x2.png`
 * exists so a UV error shows up as the wrong cell colour, which it can only do
 * if the colours are where this script believes it put them. Read back through
 * `pixelOf`, which walks the decompressed bytes rather than trusting `files`.
 */
function checkPixels(name: string, png: PngHeader): void {
  const at = (x: number, y: number) => pixelOf(png, x, y).join(',');
  const expect = (x: number, y: number, want: readonly number[], why: string) => {
    if (at(x, y) !== want.join(',')) {
      throw new Error(`${name}: pixel (${x},${y}) is ${at(x, y)}, expected ${want.join(',')} — ${why}`);
    }
  };

  const { cellW, cellH } = BULLET_GRID;

  if (name === 'grid-8x2.png') {
    // Every cell centre, so a whole-cell offset in either axis is caught rather
    // than only a shift at the seams.
    for (let i = 0; i < CELL_COLOURS.length; i++) {
      const col = i % BULLET_COLUMNS;
      const row = Math.floor(i / BULLET_COLUMNS);
      const [r, g, b] = CELL_COLOURS[i]!;
      expect(col * cellW + cellW / 2, row * cellH + cellH / 2, [r, g, b, 255], `cell ${i} centre`);
    }
    // Adjacent cells across a boundary must differ, or "distinct colour per
    // cell" is not actually true and the fixture cannot show a UV error.
    if (at(cellW - 1, 0) === at(cellW, 0)) throw new Error(`${name}: cells 0 and 1 share a colour`);
  }

  if (name === 'ragged.png') {
    expect(0, 0, [...CELL_COLOURS[0]!, 255], 'first whole cell');
    // The two partial strips, which are the entire point of this file.
    expect(97, 0, [...OUT_OF_GRID], 'right-hand 4px strip belongs to no cell');
    expect(0, 35, [...OUT_OF_GRID], 'bottom 8px strip belongs to no cell');
    expect(95, 31, [...CELL_COLOURS[2]!, 255], 'last pixel still inside a whole cell');
  }

  if (name === 'one-pixel.png') expect(0, 0, [255, 128, 0, 128], 'the only pixel');

  if (name === 'npot.png') {
    expect(0, 0, [0, 0, 64, 0], 'alpha ramp starts transparent');
    expect(99, 59, [255, 255, 64, 255], 'alpha ramp ends opaque');
  }

  if (name === 'no-alpha.png') {
    // Reads as opaque because there is no alpha channel to read, not because a
    // 255 was stored — which is the distinction this fixture tests.
    expect(0, 0, [0, 0, 128, 255], 'RGB corner');
    expect(63, 47, [255, 255, 128, 255], 'RGB opposite corner');
  }
}

function verify(): string[] {
  const lines: string[] = [];

  for (const [name, want] of Object.entries(expected)) {
    const bytes = new Uint8Array(readFileSync(join(OUT, name)));
    const got = parsePng(bytes);

    if (got.width !== want.width || got.height !== want.height) {
      throw new Error(`${name}: ${got.width}x${got.height}, expected ${want.width}x${want.height}`);
    }
    if (got.colourType !== want.colourType) {
      throw new Error(`${name}: colour type ${got.colourType}, expected ${want.colourType}`);
    }
    if (got.bitDepth !== 8) throw new Error(`${name}: bit depth ${got.bitDepth}`);
    if (got.interlace !== 0) throw new Error(`${name}: interlaced`);

    checkPixels(name, got);

    const sips = systemProbe(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'hasAlpha', join(OUT, name)]);
    if (sips) {
      const read = (key: string) => sips.match(new RegExp(`${key}: (\\S+)`))?.[1];
      if (Number(read('pixelWidth')) !== want.width || Number(read('pixelHeight')) !== want.height) {
        throw new Error(`${name}: sips disagrees on dimensions\n${sips}`);
      }
      const alphaExpected = want.colourType === ColourType.RGBA;
      if ((read('hasAlpha') === 'yes') !== alphaExpected) {
        throw new Error(`${name}: sips reports hasAlpha=${read('hasAlpha')}, expected ${alphaExpected}`);
      }
    }

    lines.push(
      `${name.padEnd(15)} ${String(got.width).padStart(3)}x${String(got.height).padEnd(3)} ` +
        `colour type ${got.colourType} (${got.colourType === ColourType.RGBA ? 'RGBA' : 'RGB'}) ` +
        `${bytes.length} bytes  [${got.chunks.join(' ')}]  sips: ${sips ? 'agrees' : 'unavailable'}`,
    );
  }

  for (const name of ['blip.wav', 'stereo.wav']) {
    const bytes = new Uint8Array(readFileSync(join(OUT, name)));
    const got = parseWav(bytes);
    if (got.sampleRate !== SAMPLE_RATE) throw new Error(`${name}: ${got.sampleRate}Hz`);
    if (got.bitsPerSample !== 16) throw new Error(`${name}: ${got.bitsPerSample}-bit`);

    const peaks = wavPeaks(bytes, got);
    if (name === 'stereo.wav') {
      if (got.channels !== 2) throw new Error(`${name}: ${got.channels} channels`);
      // The reason this file exists: if the channels were interchangeable, a
      // swap would be undetectable and the fixture would be decorative.
      if (Math.abs(peaks[0]! - peaks[1]!) < 0.3) {
        throw new Error(`${name}: channel peaks ${peaks} are too close to distinguish a swap`);
      }
    } else if (got.channels !== 1) {
      throw new Error(`${name}: ${got.channels} channels`);
    }

    const afinfo = systemProbe(['afinfo', join(OUT, name)]);
    if (afinfo) {
      if (!afinfo.includes(`${SAMPLE_RATE} Hz`)) throw new Error(`${name}: afinfo disagrees\n${afinfo}`);
      const channels = afinfo.match(/(\d+) ch/)?.[1];
      if (Number(channels) !== got.channels) {
        throw new Error(`${name}: afinfo reports ${channels} channels, we wrote ${got.channels}`);
      }
    }

    lines.push(
      `${name.padEnd(15)} ${got.channels}ch ${got.sampleRate}Hz ${got.bitsPerSample}-bit ` +
        `${got.frames} frames (${(got.frames / SAMPLE_RATE).toFixed(3)}s) ${bytes.length} bytes  ` +
        `peaks [${peaks.map((p) => p.toFixed(2)).join(', ')}]  afinfo: ${afinfo ? 'agrees' : 'unavailable'}`,
    );
  }

  return lines;
}

/**
 * Prove the verifier can fail.
 *
 * `test/visual/layer-order.ts` sets the bar here: it re-runs its measurement
 * with the mechanism deliberately broken, because a check that has only ever
 * been seen green is not evidence. The same applies to a file validator — one
 * that accepts everything would report success on a corrupt PNG just as
 * cheerfully.
 *
 * So each mutation below is a plausible encoder bug, and every one must be
 * caught. `parsePng` throwing here is the passing outcome.
 */
function proveVerifierFails(): string[] {
  const original = new Uint8Array(readFileSync(join(OUT, 'grid-8x2.png')));

  const mutations: ReadonlyArray<[string, (b: Uint8Array) => void]> = [
    // A raw deflate stream in IDAT, or any other change to the compressed
    // payload, moves this byte and invalidates the chunk CRC.
    ['corrupt IDAT byte', (b) => { b[60] = b[60]! ^ 0xff; }],
    ['wrong width in IHDR', (b) => { b[19] = 99; }],
    // The same mutation with the CRC repaired, which is the one that matters.
    // A hand-rolled encoder writing a wrong width writes a *matching* CRC over
    // it, so every chunk checksum in the file is correct and only comparing
    // IHDR against the decompressed pixel count can tell. This mutation is here
    // because the version above passes for the wrong reason.
    ['wrong width, CRC fixed', (b) => {
      b[19] = 99;
      new DataView(b.buffer, b.byteOffset).setUint32(29, crc32(b.subarray(12, 29)), false);
    }],
    ['truncated file', () => undefined], // handled below
    ['broken signature', (b) => { b[1] = 0x00; }],
  ];

  const lines: string[] = [];
  for (const [label, mutate] of mutations) {
    let bytes = original.slice();
    if (label === 'truncated file') bytes = bytes.subarray(0, bytes.length - 12);
    else mutate(bytes);

    let caught: string | undefined;
    try {
      parsePng(bytes);
    } catch (error) {
      caught = (error as Error).message;
    }
    if (!caught) {
      throw new Error(`verifier accepted a PNG mutated by "${label}" — it proves nothing`);
    }
    lines.push(`  ${label.padEnd(22)} rejected: ${caught}`);
  }

  // And the same for WAV, whose header is arithmetic that is easy to get wrong
  // in a way no parser would notice unless it recomputed the sizes.
  const wav = new Uint8Array(readFileSync(join(OUT, 'stereo.wav')));
  const brokenWav = wav.slice();
  new DataView(brokenWav.buffer).setUint32(40, 999999, true);
  let wavCaught: string | undefined;
  try {
    parseWav(brokenWav);
  } catch (error) {
    wavCaught = (error as Error).message;
  }
  if (!wavCaught) throw new Error('verifier accepted a WAV with a wrong data size');
  lines.push(`  ${'wrong WAV data size'.padEnd(22)} rejected: ${wavCaught}`);

  // A mutation that must NOT be rejected, so this is a discriminating check
  // rather than a parser that throws at everything.
  parsePng(original);
  lines.push(`  ${'unmutated original'.padEnd(22)} accepted`);

  return lines;
}

/* ------------------------------------------------------------------ */

mkdirSync(OUT, { recursive: true });
for (const [name, bytes] of Object.entries(files)) writeFileSync(join(OUT, name), bytes);

console.log(`wrote ${Object.keys(files).length} fixtures to ${OUT}\n`);
console.log(verify().join('\n'));
console.log('\nmutation check — the verifier must reject each of these:');
console.log(proveVerifierFails().join('\n'));
