/**
 * Round-trip coverage for `tools/png-decode.ts`.
 *
 * `tools/png.ts`'s `encodePng` only ever emits filter type 0 and colour types
 * RGB/RGBA, so it cannot exercise the decoder's reason to exist: the adaptive
 * Sub/Up/Average/Paeth unfilter and the greyscale / palette expansions that
 * third-party art (BulletPack included) actually uses. This test hand-builds
 * PNGs with each filter type on its own scanline and each supported colour
 * type, decodes them, and asserts the pixels come back exactly — so a
 * regression in the decoder stops being silent to `bun test`.
 *
 * The chunk framing here is independent of `png.ts`'s (only `crc32` is shared,
 * and it is pure arithmetic), and IDAT is wrapped by `node:zlib`'s
 * `deflateSync`, which produces a real zlib container the decoder's
 * `inflateSync` validates.
 */

import { describe, expect, test } from 'bun:test';
import { deflateSync } from 'node:zlib';
import { crc32 } from './png';
import { decodePng } from './png-decode';

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
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
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

interface Spec {
  width: number;
  height: number;
  bitDepth: number;
  colourType: number;
  /** Unfiltered, packed scanline bytes: height * rowBytes. */
  rows: Uint8Array;
  /** Filter type to apply to each row (length === height). */
  filters: number[];
  palette?: Uint8Array; // RGB triples
  trns?: Uint8Array;
}

/** Apply a PNG filter to one unfiltered scanline, byte-wise, against the prior row. */
function filterRow(
  cur: Uint8Array,
  prev: Uint8Array | null,
  filter: number,
  bpp: number,
): Uint8Array {
  const out = new Uint8Array(cur.length);
  for (let x = 0; x < cur.length; x++) {
    const a = x >= bpp ? cur[x - bpp]! : 0;
    const b = prev ? prev[x]! : 0;
    const c = prev && x >= bpp ? prev[x - bpp]! : 0;
    let f: number;
    switch (filter) {
      case 0: f = cur[x]!; break;
      case 1: f = cur[x]! - a; break;
      case 2: f = cur[x]! - b; break;
      case 3: f = cur[x]! - ((a + b) >> 1); break;
      case 4: f = cur[x]! - paeth(a, b, c); break;
      default: throw new Error(`bad filter ${filter}`);
    }
    out[x] = f & 0xff;
  }
  return out;
}

function encode(spec: Spec): Uint8Array {
  const channelsOf: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const channels = channelsOf[spec.colourType]!;
  const bitsPerPixel = channels * spec.bitDepth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const rowBytes = Math.ceil((spec.width * bitsPerPixel) / 8);

  const stream = new Uint8Array(spec.height * (1 + rowBytes));
  let prev: Uint8Array | null = null;
  for (let y = 0; y < spec.height; y++) {
    const cur = spec.rows.subarray(y * rowBytes, (y + 1) * rowBytes);
    const filtered = filterRow(cur, prev, spec.filters[y]!, bpp);
    stream[y * (1 + rowBytes)] = spec.filters[y]!;
    stream.set(filtered, y * (1 + rowBytes) + 1);
    prev = cur;
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, spec.width, false);
  view.setUint32(4, spec.height, false);
  ihdr[8] = spec.bitDepth;
  ihdr[9] = spec.colourType;

  const parts: Uint8Array[] = [SIGNATURE, chunk('IHDR', ihdr)];
  if (spec.palette) parts.push(chunk('PLTE', spec.palette));
  if (spec.trns) parts.push(chunk('tRNS', spec.trns));
  parts.push(chunk('IDAT', new Uint8Array(deflateSync(stream))));
  parts.push(chunk('IEND', new Uint8Array(0)));
  return concat(parts);
}

/** Build the expected straight-alpha RGBA for a spec, mirroring the decoder's contract. */
function expectedRgba(spec: Spec): Uint8Array {
  const channelsOf: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const channels = channelsOf[spec.colourType]!;
  const rowBytes = Math.ceil((spec.width * channels * spec.bitDepth) / 8);
  const rgba = new Uint8Array(spec.width * spec.height * 4);
  const sample = (row: number, index: number): number => {
    if (spec.bitDepth === 8) return spec.rows[row + index]!;
    const bitPos = index * spec.bitDepth;
    const byte = spec.rows[row + (bitPos >> 3)]!;
    const shift = 8 - spec.bitDepth - (bitPos & 7);
    return (byte >> shift) & ((1 << spec.bitDepth) - 1);
  };
  for (let y = 0; y < spec.height; y++) {
    const row = y * rowBytes;
    for (let x = 0; x < spec.width; x++) {
      const o = (y * spec.width + x) * 4;
      if (spec.colourType === 6) {
        const i = row + x * 4;
        rgba[o] = spec.rows[i]!; rgba[o + 1] = spec.rows[i + 1]!; rgba[o + 2] = spec.rows[i + 2]!; rgba[o + 3] = spec.rows[i + 3]!;
      } else if (spec.colourType === 2) {
        const i = row + x * 3;
        rgba[o] = spec.rows[i]!; rgba[o + 1] = spec.rows[i + 1]!; rgba[o + 2] = spec.rows[i + 2]!; rgba[o + 3] = 255;
      } else if (spec.colourType === 0) {
        const g = spec.rows[row + x]!;
        rgba[o] = g; rgba[o + 1] = g; rgba[o + 2] = g; rgba[o + 3] = 255;
      } else if (spec.colourType === 4) {
        const i = row + x * 2;
        const g = spec.rows[i]!;
        rgba[o] = g; rgba[o + 1] = g; rgba[o + 2] = g; rgba[o + 3] = spec.rows[i + 1]!;
      } else {
        const idx = sample(row, x);
        const p = spec.palette!;
        rgba[o] = p[idx * 3]!; rgba[o + 1] = p[idx * 3 + 1]!; rgba[o + 2] = p[idx * 3 + 2]!;
        rgba[o + 3] = spec.trns && idx < spec.trns.length ? spec.trns[idx]! : 255;
      }
    }
  }
  return rgba;
}

function roundTrip(spec: Spec): void {
  const decoded = decodePng(encode(spec));
  expect(decoded.width).toBe(spec.width);
  expect(decoded.height).toBe(spec.height);
  expect(Array.from(decoded.rgba)).toEqual(Array.from(expectedRgba(spec)));
}

// A 4-wide gradient so Sub/Average/Paeth (which read the left neighbour) have a
// non-trivial horizontal signal, over 5 rows so each filter type owns a row and
// Up/Average/Paeth (which read the row above) get a non-zero prior.
function rgbaRows(): Uint8Array {
  const w = 4, h = 5, rows = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      rows[i] = (x * 40 + y * 7) & 0xff;
      rows[i + 1] = (x * 13 + y * 50) & 0xff;
      rows[i + 2] = (200 - x * 30 - y * 11) & 0xff;
      rows[i + 3] = (255 - y * 20) & 0xff;
    }
  }
  return rows;
}

describe('decodePng round-trips', () => {
  const filters = [0, 1, 2, 3, 4]; // one filter type per row

  test('RGBA (type 6), every filter type', () => {
    roundTrip({ width: 4, height: 5, bitDepth: 8, colourType: 6, rows: rgbaRows(), filters });
  });

  test('RGB (type 2), every filter type', () => {
    const w = 4, h = 5, rows = new Uint8Array(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      rows[i] = (x * 40 + y * 7) & 0xff;
      rows[i + 1] = (x * 13 + y * 50) & 0xff;
      rows[i + 2] = (200 - x * 30 - y * 11) & 0xff;
    }
    roundTrip({ width: w, height: h, bitDepth: 8, colourType: 2, rows, filters });
  });

  test('greyscale (type 0), every filter type', () => {
    const w = 4, h = 5, rows = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rows[y * w + x] = (x * 40 + y * 30) & 0xff;
    roundTrip({ width: w, height: h, bitDepth: 8, colourType: 0, rows, filters });
  });

  test('greyscale+alpha (type 4), every filter type', () => {
    const w = 4, h = 5, rows = new Uint8Array(w * h * 2);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 2;
      rows[i] = (x * 40 + y * 30) & 0xff;
      rows[i + 1] = (255 - x * 20) & 0xff;
    }
    roundTrip({ width: w, height: h, bitDepth: 8, colourType: 4, rows, filters });
  });

  test('palette (type 3), 8-bit indices with a filtered row and tRNS', () => {
    // 4 palette entries; index 0 transparent via tRNS.
    const palette = Uint8Array.of(10, 20, 30, 200, 0, 0, 0, 200, 0, 40, 40, 40);
    const trns = Uint8Array.of(0, 255, 255); // entry 0 transparent, 1 & 2 opaque, 3 defaults opaque
    const w = 4, h = 3, rows = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rows[y * w + x] = (x + y) % 4;
    roundTrip({ width: w, height: h, bitDepth: 8, colourType: 3, rows, filters: [0, 1, 2], palette, trns });
  });

  test('palette (type 3), sub-8-bit (4bpp) unpacking', () => {
    const palette = Uint8Array.of(0, 0, 0, 255, 0, 0, 0, 255, 0, 255, 255, 255);
    const w = 3, h = 2;
    const rowBytes = Math.ceil((w * 4) / 8); // 2 bytes/row for 3 px at 4bpp
    const rows = new Uint8Array(rowBytes * h);
    // pixels: row0 = [1,2,3], row1 = [3,2,1]; pack two 4-bit indices per byte, high nibble first
    const px = [[1, 2, 3], [3, 2, 1]];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const bitPos = x * 4;
        rows[y * rowBytes + (bitPos >> 3)]! |= px[y]![x]! << (8 - 4 - (bitPos & 7));
      }
    }
    roundTrip({ width: w, height: h, bitDepth: 4, colourType: 3, rows, filters: [0, 0], palette });
  });
});
