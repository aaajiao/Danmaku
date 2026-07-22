import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stagePacks } from './copy-packs';

async function writeManifest(dir: string, license: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'pack.json'), JSON.stringify({ license }));
}

describe('copy-packs replaces its build output', () => {
  test('removes stale and unshippable packs before staging the current set', async () => {
    const root = await mkdtemp(join(tmpdir(), 'danmaku-copy-packs-'));
    try {
      const packs = join(root, 'packs');
      const distPacks = join(root, 'dist', 'packs');
      await writeManifest(join(packs, 'v4'), 'CC0-1.0');
      await writeFile(join(packs, 'v4', 'asset.txt'), 'current');
      await writeManifest(join(packs, 'blocked'), 'UNCONFIRMED-purchase');
      await mkdir(join(packs, 'example'), { recursive: true });
      await writeFile(join(packs, 'example', 'README.md'), 'placeholder');
      await writeManifest(join(distPacks, 'bulletpack'), 'CC0-1.0');

      const result = await stagePacks(packs, distPacks);

      expect(result).toEqual({ hasPacks: true, ship: ['v4'], skipped: ['blocked'] });
      expect((await readdir(distPacks)).sort()).toEqual(['index.json', 'v4']);
      expect(JSON.parse(await readFile(join(distPacks, 'index.json'), 'utf8'))).toEqual({ packs: ['v4'] });
      expect(await readFile(join(distPacks, 'v4', 'asset.txt'), 'utf8')).toBe('current');
      expect(existsSync(join(distPacks, 'bulletpack'))).toBe(false);
      expect(existsSync(join(distPacks, 'blocked'))).toBe(false);
      expect(existsSync(join(distPacks, 'example'))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('removes stale output even when the source packs directory is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'danmaku-copy-packs-'));
    try {
      const missingPacks = join(root, 'missing-packs');
      const distPacks = join(root, 'dist', 'packs');
      await writeManifest(join(distPacks, 'old-pack'), 'CC0-1.0');

      expect(await stagePacks(missingPacks, distPacks)).toEqual({
        hasPacks: false,
        ship: [],
        skipped: [],
      });
      expect(existsSync(distPacks)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
