import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanPublishMetadata, stagePacks } from './copy-packs';

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

  test('omits hidden and platform metadata while preserving nested pack assets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'danmaku-copy-packs-'));
    try {
      const packs = join(root, 'packs');
      const source = join(packs, 'v4');
      const distPacks = join(root, 'dist', 'packs');
      await writeManifest(source, 'CC0-1.0');
      await mkdir(join(source, 'art', 'nested'), { recursive: true });
      await writeFile(join(source, 'art', 'nested', 'sprite.png'), 'pixels');
      await writeFile(join(source, '.DS_Store'), 'finder metadata');
      await writeFile(join(source, 'art', '.notes'), 'editor metadata');
      await mkdir(join(source, '.cache'), { recursive: true });
      await writeFile(join(source, '.cache', 'preview.png'), 'cached preview');
      await writeFile(join(source, 'Thumbs.db'), 'windows metadata');
      await mkdir(join(source, '__MACOSX'), { recursive: true });
      await writeFile(join(source, '__MACOSX', 'sprite.png'), 'resource fork');

      expect(await stagePacks(packs, distPacks)).toEqual({
        hasPacks: true,
        ship: ['v4'],
        skipped: [],
      });
      expect(await readFile(join(distPacks, 'v4', 'art', 'nested', 'sprite.png'), 'utf8')).toBe('pixels');
      expect(existsSync(join(distPacks, 'v4', '.DS_Store'))).toBe(false);
      expect(existsSync(join(distPacks, 'v4', 'art', '.notes'))).toBe(false);
      expect(existsSync(join(distPacks, 'v4', '.cache'))).toBe(false);
      expect(existsSync(join(distPacks, 'v4', 'Thumbs.db'))).toBe(false);
      expect(existsSync(join(distPacks, 'v4', '__MACOSX'))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('removes stale metadata outside packs from incremental build output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'danmaku-copy-packs-'));
    try {
      const dist = join(root, 'dist');
      await mkdir(join(dist, 'assets', '__MACOSX'), { recursive: true });
      await writeFile(join(dist, '.DS_Store'), 'stale finder metadata');
      await writeFile(join(dist, 'assets', 'Thumbs.db'), 'stale windows metadata');
      await writeFile(join(dist, 'assets', '__MACOSX', 'fork'), 'resource fork');
      await writeFile(join(dist, 'assets', 'game.js'), 'keep');

      await cleanPublishMetadata(dist);

      expect(existsSync(join(dist, '.DS_Store'))).toBe(false);
      expect(existsSync(join(dist, 'assets', 'Thumbs.db'))).toBe(false);
      expect(existsSync(join(dist, 'assets', '__MACOSX'))).toBe(false);
      expect(await readFile(join(dist, 'assets', 'game.js'), 'utf8')).toBe('keep');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
