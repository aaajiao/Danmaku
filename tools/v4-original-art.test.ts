import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { decodePng } from './png-decode';

const ART = new URL('../docs/art/v4/', import.meta.url);
const MANIFEST = new URL('originals-manifest.json', ART);

interface OriginalEntry {
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly sha256: string;
}

interface OriginalsManifest {
  readonly schema: number;
  readonly kind: string;
  readonly files: readonly OriginalEntry[];
}

describe('accepted v4 generated originals', () => {
  test('manifest is the exact top-level PNG set and every original is byte-locked', async () => {
    const manifest = JSON.parse(await Bun.file(MANIFEST).text()) as OriginalsManifest;
    expect(manifest.schema).toBe(1);
    expect(manifest.kind).toBe('accepted-generated-v4-originals');

    const actual = (await readdir(ART.pathname)).filter((name) => name.endsWith('.png')).sort();
    const declared = manifest.files.map((entry) => entry.path).sort();
    expect(declared).toEqual(actual);
    expect(new Set(declared).size).toBe(declared.length);

    for (const entry of manifest.files) {
      expect(entry.path).not.toContain('/');
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      const bytes = await Bun.file(new URL(entry.path, ART)).bytes();
      const png = decodePng(bytes);
      expect(bytes.byteLength, entry.path).toBe(entry.bytes);
      expect(createHash('sha256').update(bytes).digest('hex'), entry.path).toBe(entry.sha256);
      expect(png.width, entry.path).toBe(entry.width);
      expect(png.height, entry.path).toBe(entry.height);
    }
  });

  test('obsolete colour-pose archive is absent', () => {
    expect(existsSync(new URL('archive/', ART))).toBe(false);
  });
});
