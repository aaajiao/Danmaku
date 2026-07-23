/**
 * Stage PWA metadata and generate one content-addressed service worker.
 *
 * This runs after Bun has emitted the browser graph and copy-packs has replaced
 * `dist/packs/`. Every shippable byte is therefore final. The sorted path +
 * content hash names an atomic cache, and the generated URL list contains only
 * this clean build (tools/clean-dist.ts removes Bun's historical hash files
 * before bundling).
 */

import { createHash } from 'node:crypto';
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const DIST_DIR = fileURLToPath(new URL('../dist/', import.meta.url));
const BUILD_ID_DECLARATION = 'const BUILD_ID = "__BUILD_ID__";';
const PRECACHE_DECLARATION =
  'const PRECACHE_URLS = /* __PRECACHE_URLS__ */ [];';

function isPlatformMetadata(name: string): boolean {
  const lower = name.toLowerCase();
  return name.startsWith('.')
    || lower.startsWith('._')
    || lower === 'thumbs.db'
    || lower === 'desktop.ini'
    || lower === '__macosx';
}

function shouldCopy(source: string): boolean {
  return !isPlatformMetadata(basename(source));
}

async function regularFiles(root: string, dir = root): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (isPlatformMetadata(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await regularFiles(root, path));
    } else if (entry.isFile()) {
      const rel = relative(root, path).split(sep).join('/');
      if (rel !== 'sw.js') files.push(rel);
    }
  }
  return files.sort();
}

function fileUrl(path: string): string {
  return `./${path.split('/').map(encodeURIComponent).join('/')}`;
}

export interface PwaBuildResult {
  readonly buildId: string;
  readonly files: readonly string[];
  readonly bytes: number;
}

/**
 * Replace the PWA-owned outputs and emit a worker for the exact final dist.
 *
 * `distDir` must already contain the built app and staged packs. The manifest
 * and icon directory are copied before hashing so their bytes participate in
 * the same release identity as the JS, CSS, art, audio and pack manifests.
 */
export async function buildPwa(
  publicDir: string,
  distDir: string,
): Promise<PwaBuildResult> {
  const manifestSource = join(publicDir, 'manifest.webmanifest');
  const iconsSource = join(publicDir, 'icons');
  const workerTemplate = join(publicDir, 'sw.js');

  for (const required of [manifestSource, iconsSource, workerTemplate]) {
    const info = await stat(required).catch(() => undefined);
    if (info === undefined) {
      throw new Error(`build-pwa: missing required source ${required}`);
    }
  }

  await mkdir(distDir, { recursive: true });
  await rm(join(distDir, 'manifest.webmanifest'), { force: true });
  await rm(join(distDir, 'icons'), { recursive: true, force: true });
  await rm(join(distDir, 'sw.js'), { force: true });

  await cp(manifestSource, join(distDir, 'manifest.webmanifest'), {
    filter: shouldCopy,
  });
  await cp(iconsSource, join(distDir, 'icons'), {
    recursive: true,
    filter: shouldCopy,
  });

  const paths = await regularFiles(distDir);
  if (!paths.includes('index.html')) {
    throw new Error('build-pwa: dist/index.html is missing');
  }

  const template = await readFile(workerTemplate, 'utf8');
  if (
    !template.includes(BUILD_ID_DECLARATION)
    || !template.includes(PRECACHE_DECLARATION)
  ) {
    throw new Error('build-pwa: service-worker template placeholders are missing');
  }

  const hash = createHash('sha256');
  hash.update('danmaku-pwa-v1\0');
  hash.update(template);
  let bytes = 0;
  for (const path of paths) {
    const contents = await readFile(join(distDir, path));
    hash.update('\0');
    hash.update(path);
    hash.update('\0');
    hash.update(contents);
    bytes += contents.byteLength;
  }
  const buildId = hash.digest('hex').slice(0, 16);

  const files = [
    './',
    ...paths.filter((path) => path !== 'index.html').map(fileUrl),
  ];
  const generated = template
    .replace(
      BUILD_ID_DECLARATION,
      `const BUILD_ID = ${JSON.stringify(buildId)};`,
    )
    .replace(
      PRECACHE_DECLARATION,
      `const PRECACHE_URLS = ${JSON.stringify(files, null, 2)};`,
    );

  await writeFile(join(distDir, 'sw.js'), generated);
  return { buildId, files, bytes };
}

if (import.meta.main) {
  const result = await buildPwa(PUBLIC_DIR, DIST_DIR);
  const mib = (result.bytes / (1024 * 1024)).toFixed(2);
  console.log(
    `build-pwa: ${result.files.length} files / ${mib} MiB → ${result.buildId}`,
  );
}
