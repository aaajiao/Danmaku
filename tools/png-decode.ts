/**
 * A full PNG *decoder* — the half `tools/png.ts` deliberately does not have.
 *
 * `tools/png.ts`'s `parsePng` is a strict *re-reader* for the files this repo
 * *writes*: it rejects any scanline whose filter byte is not 0, because the
 * encoder never emits another kind. Third-party art does — Aseprite, Photoshop
 * and every other exporter pick adaptive Sub/Up/Average/Paeth filters per line,
 * and many write indexed (palette) or grey PNGs. `parsePng` throws on all of
 * that. This module reconstructs them: it inflates IDAT, undoes all five filter
 * types, and expands colour types 0/2/3/4/6 at bit depth 8 (plus sub-8-bit
 * palette) to straight-alpha RGBA. Interlaced PNGs are refused with a clear
 * message — no BulletPack file is interlaced, and Adam7 is a lot of code for a
 * case that does not occur.
 *
 * It shares nothing with `tools/png.ts`'s encoder on purpose: this reads art we
 * did not make, so it must derive everything from the bytes.
 */

import { inflateSync } from 'node:zlib';

export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  /** Straight-alpha RGBA, 4 bytes per pixel, row-major top-to-bottom. */
  readonly rgba: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePng(bytes: Uint8Array): DecodedImage {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (bytes[i] !== SIGNATURE[i]) throw new Error(`not a PNG: bad signature at byte ${i}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = 0;
  let interlace = 0;
  let palette: Uint8Array | undefined; // RGB triples
  let trns: Uint8Array | undefined; // palette alpha, or per-channel key
  const idat: Uint8Array[] = [];

  let at = 8;
  while (at < bytes.length) {
    const length = view.getUint32(at, false);
    const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!);
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(at + 8, false);
      height = view.getUint32(at + 12, false);
      bitDepth = bytes[at + 16]!;
      colourType = bytes[at + 17]!;
      interlace = bytes[at + 20]!;
    } else if (type === 'PLTE') {
      palette = data.slice();
    } else if (type === 'tRNS') {
      trns = data.slice();
    } else if (type === 'IDAT') {
      idat.push(data.slice());
    } else if (type === 'IEND') {
      break;
    }
    at += 12 + length;
  }

  if (width === 0 || height === 0) throw new Error('PNG has a zero dimension or no IHDR');
  if (interlace !== 0) throw new Error('interlaced PNG (Adam7) not supported by this decoder');

  const channelsOf: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const channels = channelsOf[colourType];
  if (channels === undefined) throw new Error(`unsupported PNG colour type ${colourType}`);
  if (colourType === 3) {
    if (![1, 2, 4, 8].includes(bitDepth)) throw new Error(`palette PNG bit depth ${bitDepth} unsupported`);
    if (palette === undefined) throw new Error('palette (type 3) PNG has no PLTE chunk');
  } else if (bitDepth !== 8) {
    throw new Error(`PNG bit depth ${bitDepth} unsupported for colour type ${colourType} (only 8)`);
  }

  const raw = new Uint8Array(inflateSync(concat(idat)));

  // Unfilter into a packed-sample buffer.
  const bitsPerPixel = channels * bitDepth;
  const bpp = Math.max(1, bitsPerPixel >> 3); // filter step, in bytes
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
  const out = new Uint8Array(height * rowBytes);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++]!;
    const row = y * rowBytes;
    const prev = row - rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const rawByte = raw[src++]!;
      const a = x >= bpp ? out[row + x - bpp]! : 0;
      const b = y > 0 ? out[prev + x]! : 0;
      const c = y > 0 && x >= bpp ? out[prev + x - bpp]! : 0;
      let val: number;
      switch (filter) {
        case 0: val = rawByte; break;
        case 1: val = rawByte + a; break;
        case 2: val = rawByte + b; break;
        case 3: val = rawByte + ((a + b) >> 1); break;
        case 4: val = rawByte + paeth(a, b, c); break;
        default: throw new Error(`scanline ${y}: unknown filter type ${filter}`);
      }
      out[row + x] = val & 0xff;
    }
  }

  // Expand to RGBA.
  const rgba = new Uint8Array(width * height * 4);
  const readSample = (row: number, index: number): number => {
    // 8-bit fast path
    if (bitDepth === 8) return out[row + index]!;
    // sub-8-bit (palette only here): index is the pixel index
    const bitPos = index * bitDepth;
    const byte = out[row + (bitPos >> 3)]!;
    const shift = 8 - bitDepth - (bitPos & 7);
    return (byte >> shift) & ((1 << bitDepth) - 1);
  };

  for (let y = 0; y < height; y++) {
    const row = y * rowBytes;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (colourType === 6) {
        const i = row + x * 4;
        rgba[o] = out[i]!; rgba[o + 1] = out[i + 1]!; rgba[o + 2] = out[i + 2]!; rgba[o + 3] = out[i + 3]!;
      } else if (colourType === 2) {
        const i = row + x * 3;
        rgba[o] = out[i]!; rgba[o + 1] = out[i + 1]!; rgba[o + 2] = out[i + 2]!; rgba[o + 3] = 255;
      } else if (colourType === 0) {
        const g = out[row + x]!;
        rgba[o] = g; rgba[o + 1] = g; rgba[o + 2] = g; rgba[o + 3] = 255;
      } else if (colourType === 4) {
        const i = row + x * 2;
        const g = out[i]!;
        rgba[o] = g; rgba[o + 1] = g; rgba[o + 2] = g; rgba[o + 3] = out[i + 1]!;
      } else {
        // palette
        const idx = readSample(row, x);
        const p = palette!;
        rgba[o] = p[idx * 3]!; rgba[o + 1] = p[idx * 3 + 1]!; rgba[o + 2] = p[idx * 3 + 2]!;
        rgba[o + 3] = trns && idx < trns.length ? trns[idx]! : 255;
      }
    }
  }

  return { width, height, rgba };
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
