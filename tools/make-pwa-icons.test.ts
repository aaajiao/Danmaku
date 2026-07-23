import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { decodePng } from './png-decode';
import {
  buildPwaIcon,
  PWA_ICON_SOURCE,
  PWA_ICON_SPECS,
  PWA_MASKABLE_LAYOUT,
} from './make-pwa-icons';

const OUTPUT_DIR = join(import.meta.dir, '..', 'public', 'icons');
const MANIFEST = join(import.meta.dir, '..', 'public', 'manifest.webmanifest');

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('SCOUT PWA icons', () => {
  test('manifest uses the generated install icons from the root scope', async () => {
    const manifest = JSON.parse(await Bun.file(MANIFEST).text()) as {
      id: string;
      start_url: string;
      scope: string;
      display: string;
      icons: Array<{
        src: string;
        sizes: string;
        type: string;
        purpose: string;
      }>;
    };
    expect({
      id: manifest.id,
      startUrl: manifest.start_url,
      scope: manifest.scope,
      display: manifest.display,
    }).toEqual({
      id: '/',
      startUrl: '/',
      scope: '/',
      display: 'standalone',
    });
    expect(manifest.icons).toEqual([
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-maskable-1024.png',
        sizes: '1024x1024',
        type: 'image/png',
        purpose: 'maskable',
      },
    ]);
  });

  test('committed files are deterministic, opaque and correctly sized', async () => {
    const source = decodePng(await Bun.file(PWA_ICON_SOURCE).bytes());
    for (const spec of PWA_ICON_SPECS) {
      const actual = await Bun.file(join(OUTPUT_DIR, spec.name)).bytes();
      const expected = buildPwaIcon(source, spec);
      expect(sha256(actual)).toBe(sha256(expected));

      const decoded = decodePng(actual);
      expect([decoded.width, decoded.height]).toEqual([spec.size, spec.size]);
      let transparentPixels = 0;
      for (let i = 3; i < decoded.rgba.length; i += 4) {
        if (decoded.rgba[i] !== 255) transparentPixels++;
      }
      expect(transparentPixels).toBe(0);
    }
  });

  test('every painted SCOUT pixel stays inside the maskable safe circle', async () => {
    const source = decodePng(await Bun.file(PWA_ICON_SOURCE).bytes());
    let maxRadius = 0;
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        if (source.rgba[(y * source.width + x) * 4 + 3] === 0) continue;
        const u = PWA_MASKABLE_LAYOUT.targetX
          + ((x + 0.5) / PWA_MASKABLE_LAYOUT.sourceSize)
            * PWA_MASKABLE_LAYOUT.targetSize;
        const v = PWA_MASKABLE_LAYOUT.targetY
          + ((y + 0.5) / PWA_MASKABLE_LAYOUT.sourceSize)
            * PWA_MASKABLE_LAYOUT.targetSize;
        maxRadius = Math.max(maxRadius, Math.hypot(u - 0.5, v - 0.5));
      }
    }
    expect(maxRadius).toBeLessThanOrEqual(0.4);
  });
});
