import { describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildPwa } from './build-pwa';

const WORKER_TEMPLATE = `
const BUILD_ID = "__BUILD_ID__";
const PRECACHE_URLS = /* __PRECACHE_URLS__ */ [];
`;

async function fixture(): Promise<{
  root: string;
  publicDir: string;
  distDir: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'danmaku-build-pwa-'));
  const publicDir = join(root, 'public');
  const distDir = join(root, 'dist');
  await mkdir(join(publicDir, 'icons'), { recursive: true });
  await mkdir(join(distDir, 'packs', 'v4', 'audio'), { recursive: true });
  await writeFile(
    join(publicDir, 'manifest.webmanifest'),
    JSON.stringify({ name: 'Danmaku' }),
  );
  await writeFile(join(publicDir, 'sw.js'), WORKER_TEMPLATE);
  await writeFile(join(publicDir, 'icons', 'icon-192.png'), 'icon');
  await writeFile(join(distDir, 'index.html'), '<script src="./index-new.js"></script>');
  await writeFile(join(distDir, 'index-new.js'), 'current bundle');
  await writeFile(join(distDir, 'packs', 'index.json'), '{"packs":["v4"]}');
  await writeFile(join(distDir, 'packs', 'v4', 'pack.json'), '{"name":"v4"}');
  await writeFile(join(distDir, 'packs', 'v4', 'audio', 'theme.wav'), 'music');
  await mkdir(join(distDir, 'icons'), { recursive: true });
  await writeFile(join(distDir, 'icons', 'stale.png'), 'stale icon');
  return { root, publicDir, distDir };
}

describe('content-addressed PWA build', () => {
  test('stages metadata and precaches the exact app plus pack tree', async () => {
    const { root, publicDir, distDir } = await fixture();
    try {
      const first = await buildPwa(publicDir, distDir);
      const worker = await readFile(join(distDir, 'sw.js'), 'utf8');

      expect(first.files).toContain('./');
      expect(first.files).toContain('./index-new.js');
      expect(first.files).toContain('./manifest.webmanifest');
      expect(first.files).toContain('./icons/icon-192.png');
      expect(first.files).toContain('./packs/index.json');
      expect(first.files).toContain('./packs/v4/audio/theme.wav');
      expect(first.files).not.toContain('./index.html');
      expect(first.files).not.toContain('./sw.js');
      expect(worker).toContain(first.buildId);
      expect(worker).not.toContain('"__BUILD_ID__"');
      expect(worker).not.toContain('stale.png');

      const second = await buildPwa(publicDir, distDir);
      expect(second).toEqual(first);
      expect(await readFile(join(distDir, 'sw.js'), 'utf8')).toBe(worker);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('changes the release identity when an un-hashed pack resource changes', async () => {
    const { root, publicDir, distDir } = await fixture();
    try {
      const before = await buildPwa(publicDir, distDir);
      await writeFile(join(distDir, 'packs', 'v4', 'audio', 'theme.wav'), 'new music');
      const after = await buildPwa(publicDir, distDir);
      expect(after.buildId).not.toBe(before.buildId);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
