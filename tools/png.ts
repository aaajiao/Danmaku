/**
 * PNG encode and decode — the minimal implementation this repo needs.
 *
 * Filter type 0 (None) on every scanline, hand-built zlib framing around
 * `Bun.deflateSync`, and colour types RGB/RGBA only: enough to write and
 * independently re-read the small sheets and icons this repo generates, and
 * no more. Neither Bun nor three.js can write a PNG, and pulling in a
 * dependency to produce a handful of small files is a poor trade.
 *
 * `parsePng` shares no code with `encodePng`. Every generator under `tools/`
 * writes bytes with the encoder half and checks them back with the decoder
 * half, so a subtly wrong PNG — one some real-world decoders accept and
 * others reject — cannot pass just because the same code that wrote it also
 * read it back. `tools/make-fixtures.ts`'s header has the fuller argument,
 * and its `proveVerifierFails` is the evidence the check can actually reject
 * something rather than having only ever been seen green.
 *
 * `ColourType` is a plain (not `const`) enum on purpose: this project builds
 * with `isolatedModules`, which transpiles each file independently, and a
 * `const enum`'s values can only be inlined within the file that declares
 * them — importing one elsewhere is exactly the cross-file information
 * `isolatedModules` rules out.
 */

import { inflateSync } from 'node:zlib';

/** PNG colour types. Only the two this repo generates are named. */
export enum ColourType {
  RGB = 2,
  RGBA = 6,
}

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * Exported because callers that mutate an already-encoded PNG to prove a
 * check can fail (`make-fixtures.ts`'s `proveVerifierFails`) need to repair
 * the chunk CRC after the mutation — otherwise every such test trips the CRC
 * check instead of the one it means to exercise.
 */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/**
 * Wrap raw DEFLATE output in a zlib container.
 *
 * `Bun.deflateSync` returns a *raw* deflate stream — no 0x78 header, no
 * trailing Adler-32 — which PNG's IDAT does not accept. Measured: the first
 * bytes are `63 64`, not `78 9c`. Handing that straight to a decoder produces
 * exactly the half-valid file this module exists to avoid, so the two-byte
 * header and the checksum are added here.
 *
 * 0x78 0x01: 32K window, "no compression / fastest" level hint. The hint is
 * advisory only — decoders ignore it — and the actual level is whatever Bun
 * chose.
 */
function zlib(raw: Uint8Array<ArrayBuffer>): Uint8Array {
  const deflated = Bun.deflateSync(raw);
  const out = new Uint8Array(2 + deflated.length + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  out.set(deflated, 2);
  new DataView(out.buffer).setUint32(2 + deflated.length, adler32(raw), false);
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** RGBA sample at a pixel, each channel 0-255. */
export type Painter = (x: number, y: number) => readonly [number, number, number, number];

/**
 * Encode an image by sampling `paint` over every pixel.
 *
 * Filter type 0 (None) on every scanline. Filtering exists to help the
 * compressor, and these files are tiny — a predictable byte layout is worth
 * more here than the bytes it would save, because a mis-filtered scanline is
 * one of the failure modes that reads as a valid file to half the decoders out
 * there.
 */
export function encodePng(width: number, height: number, colour: ColourType, paint: Painter): Uint8Array {
  const channels = colour === ColourType.RGBA ? 4 : 3;
  const stride = width * channels;
  const raw = new Uint8Array(height * (1 + stride));

  for (let y = 0; y < height; y++) {
    const row = y * (1 + stride);
    raw[row] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = paint(x, y);
      const at = row + 1 + x * channels;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
      if (channels === 4) raw[at + 3] = a;
    }
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colour;
  // compression 0, filter 0, interlace 0 — the only values PNG defines for the
  // first two, and the one we want for the third.

  return concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** A decoded PNG: header fields plus decompressed, still filter-tagged scanlines. */
export interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  colourType: number;
  interlace: number;
  /** Every chunk type in file order, so a missing IEND is visible. */
  chunks: string[];
  /** Decompressed scanlines, each prefixed by its filter byte. */
  raw: Uint8Array;
}

/**
 * Read a PNG back with no help from `encodePng`.
 *
 * Deliberately re-derives everything from the bytes — signature, chunk
 * lengths, CRCs, the IHDR fields — because a verifier that shared the
 * encoder's idea of the format would agree with it about anything, including
 * a mistake.
 */
export function parsePng(bytes: Uint8Array): PngHeader {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (bytes[i] !== SIGNATURE[i]) throw new Error(`bad signature at byte ${i}`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: string[] = [];
  const idat: Uint8Array[] = [];
  let header: Omit<PngHeader, 'raw'> | undefined;
  let at = 8;

  while (at < bytes.length) {
    const length = view.getUint32(at, false);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const declared = view.getUint32(at + 8 + length, false);
    const actual = crc32(bytes.subarray(at + 4, at + 8 + length));
    if (declared !== actual) {
      throw new Error(`${type} CRC mismatch: declared ${declared}, computed ${actual}`);
    }
    chunks.push(type);

    if (type === 'IHDR') {
      if (length !== 13) throw new Error(`IHDR is ${length} bytes, must be 13`);
      header = {
        width: view.getUint32(at + 8, false),
        height: view.getUint32(at + 12, false),
        bitDepth: bytes[at + 16]!,
        colourType: bytes[at + 17]!,
        interlace: bytes[at + 20]!,
        chunks,
      };
    } else if (type === 'IDAT') {
      idat.push(bytes.subarray(at + 8, at + 8 + length));
    }
    at += 12 + length;
  }

  if (at !== bytes.length) throw new Error(`trailing bytes after last chunk`);
  if (!header) throw new Error('no IHDR');
  if (chunks[0] !== 'IHDR') throw new Error('IHDR is not the first chunk');
  if (chunks.at(-1) !== 'IEND') throw new Error('IEND is not the last chunk');
  if (idat.length === 0) throw new Error('no IDAT');
  if (header.width === 0 || header.height === 0) throw new Error('zero dimension');

  // `node:zlib` rather than `Bun.inflateSync`, which like its deflate
  // counterpart speaks raw DEFLATE. This one expects the zlib container and
  // validates the trailing Adler-32, so it independently checks the wrapper
  // `zlib()` builds by hand — the part of the encoder most likely to be wrong
  // in a way that only some decoders notice.
  const raw = new Uint8Array(inflateSync(concat(idat)));

  // The check a CRC cannot make. Every field above could be internally
  // consistent and still describe an image of the wrong size: the CRC covers
  // whatever IHDR says, not whether IHDR agrees with the pixels. Only
  // recomputing the expected byte count from the decompressed data catches an
  // encoder that wrote the dimensions or the channel count wrongly.
  const channels = header.colourType === ColourType.RGBA ? 4 : 3;
  const expectedBytes = header.height * (1 + header.width * channels);
  if (raw.length !== expectedBytes) {
    throw new Error(
      `IDAT decompresses to ${raw.length} bytes; ` +
        `${header.width}x${header.height} at colour type ${header.colourType} needs ${expectedBytes}`,
    );
  }

  for (let y = 0; y < header.height; y++) {
    const filter = raw[y * (1 + header.width * channels)]!;
    if (filter !== 0) throw new Error(`scanline ${y} has filter type ${filter}, expected 0`);
  }

  return { ...header, raw };
}

/** RGBA at a pixel, read back out of the decompressed scanlines. */
export function pixelOf(png: PngHeader, x: number, y: number): [number, number, number, number] {
  const channels = png.colourType === ColourType.RGBA ? 4 : 3;
  const at = y * (1 + png.width * channels) + 1 + x * channels;
  return [
    png.raw[at]!,
    png.raw[at + 1]!,
    png.raw[at + 2]!,
    channels === 4 ? png.raw[at + 3]! : 255,
  ];
}
