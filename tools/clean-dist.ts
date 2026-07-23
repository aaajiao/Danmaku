/**
 * Remove the disposable build tree before bundling.
 *
 * Bun's HTML bundler overwrites current entry points but does not remove old
 * content-hashed files. A service worker must never precache those unreachable
 * bundles, so every production build begins from the exact `dist/` child the
 * repository already treats as disposable.
 */

import { rm } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST_DIR = fileURLToPath(new URL('../dist/', import.meta.url));

if (basename(DIST_DIR) !== 'dist') {
  throw new Error(`clean-dist: refusing unexpected target ${DIST_DIR}`);
}

await rm(DIST_DIR, { recursive: true, force: true });
console.log('clean-dist: removed stale dist/ output');
