import { describe, expect, test } from 'bun:test';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  relocateV4Assets,
  V4_BUNDLED_ASSET_STEMS,
} from './relocate-v4-assets';

async function fixture(
  omittedStem?: string,
  unreferencedStem?: string,
): Promise<{ root: string; distDir: string; names: string[] }> {
  const root = await mkdtemp(join(tmpdir(), 'danmaku-relocate-v4-'));
  const distDir = join(root, 'dist');
  await mkdir(join(distDir, 'packs', 'v4'), { recursive: true });
  const names: string[] = [];
  const references: string[] = [];
  for (const [index, stem] of V4_BUNDLED_ASSET_STEMS.entries()) {
    if (stem === omittedStem) continue;
    const name = `${stem}-hash${index}.png`;
    names.push(name);
    await writeFile(join(distDir, name), `png:${stem}`);
    if (stem !== unreferencedStem) references.push(`const a${index}="./${name}";`);
  }
  await writeFile(join(distDir, 'index-deadbeef.js'), references.join('\n'));
  await writeFile(join(distDir, 'manifest-webhash.webmanifest'), 'hashed manifest');
  await writeFile(join(distDir, 'favicon-32-iconhash.png'), 'hashed favicon');
  await writeFile(join(distDir, 'apple-touch-icon-applehash.png'), 'hashed apple icon');
  await writeFile(
    join(distDir, 'index.html'),
    [
      '<link rel="manifest" href="./manifest-webhash.webmanifest">',
      '<link rel="icon" href="./favicon-32-iconhash.png">',
      '<link rel="apple-touch-icon" href="./apple-touch-icon-applehash.png">',
      '<script src="./index-deadbeef.js"></script>',
    ].join('\n'),
  );
  return { root, distDir, names };
}

describe('V4 production asset relocation', () => {
  test('moves the closed inventory and rewrites Bun bundle URLs', async () => {
    const { root, distDir, names } = await fixture();
    try {
      const result = await relocateV4Assets(distDir);
      const bundle = await readFile(join(distDir, 'index-deadbeef.js'), 'utf8');
      const html = await readFile(join(distDir, 'index.html'), 'utf8');
      const rootFiles = await readdir(distDir);

      expect(result.assets).toEqual([...names].sort());
      expect(result.destination).toBe('packs/v4/assets');
      expect(result.removedPwaAliases).toEqual([
        'apple-touch-icon-applehash.png',
        'favicon-32-iconhash.png',
        'manifest-webhash.webmanifest',
      ]);
      expect(result.rewrittenFiles).toEqual(['index-deadbeef.js', 'index.html']);
      expect(rootFiles).not.toContain('v4');
      for (const name of names) {
        expect(rootFiles).not.toContain(name);
        expect(await readFile(
          join(distDir, 'packs', 'v4', 'assets', name),
          'utf8',
        ))
          .toBe(`png:${name.replace(/-hash\d+\.png$/, '')}`);
        expect(bundle).toContain(`"/packs/v4/assets/${name}"`);
        expect(bundle).not.toContain(`"./${name}"`);
      }
      expect(html).toContain('href="/manifest.webmanifest"');
      expect(html).toContain('href="/icons/favicon-32.png"');
      expect(html).toContain('href="/icons/apple-touch-icon.png"');
      for (const alias of result.removedPwaAliases) {
        expect(rootFiles).not.toContain(alias);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('fails before mutation when an expected asset is missing', async () => {
    const missing = V4_BUNDLED_ASSET_STEMS[2];
    const { root, distDir, names } = await fixture(missing);
    try {
      await expect(relocateV4Assets(distDir)).rejects.toThrow(
        `expected exactly one ${missing}-<hash>.png`,
      );
      expect(
        await stat(join(distDir, 'packs', 'v4', 'assets')).catch(() => undefined),
      ).toBeUndefined();
      expect(await readdir(distDir)).toEqual(
        expect.arrayContaining(names),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rejects an unclassified V4 PNG instead of silently sweeping it in', async () => {
    const { root, distDir } = await fixture();
    try {
      await writeFile(join(distDir, 'new-v4-art-hash.png'), 'unknown');
      await expect(relocateV4Assets(distDir)).rejects.toThrow(
        'unclassified V4 PNG(s) in dist root: new-v4-art-hash.png',
      );
      expect(
        await stat(join(distDir, 'packs', 'v4', 'assets')).catch(() => undefined),
      ).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rejects emitted art with no bundle reference before moving it', async () => {
    const unreferenced = V4_BUNDLED_ASSET_STEMS[5];
    const { root, distDir } = await fixture(undefined, unreferenced);
    try {
      await expect(relocateV4Assets(distDir)).rejects.toThrow(
        'have no text-bundle reference',
      );
      expect(
        await stat(join(distDir, 'packs', 'v4', 'assets')).catch(() => undefined),
      ).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rejects a missing temporary PWA alias before changing output', async () => {
    const { root, distDir } = await fixture();
    try {
      await rm(join(distDir, 'favicon-32-iconhash.png'));
      await expect(relocateV4Assets(distDir)).rejects.toThrow(
        'expected exactly one temporary favicon-32-<hash>.png',
      );
      expect(
        await stat(join(distDir, 'packs', 'v4', 'assets')).catch(() => undefined),
      ).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
