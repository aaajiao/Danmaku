/**
 * Keep compiled, edition-owned V4 art out of the publish root.
 *
 * The source modules deliberately use bundler-resolved default imports
 * (CLAUDE.md's "Stay bundler-agnostic" contract). Bun currently emits those
 * PNGs beside index.html, so this post-build step moves the exact known set to
 * dist/packs/v4/assets/ and rewrites the URLs Bun put in text bundles. It runs
 * after copy-packs because that step replaces dist/packs/ as one clean tree.
 *
 * The HTML bundler also hashes the three PWA links authored against public/.
 * Their canonical copies are staged later by build-pwa, so this same pass
 * rewrites the built HTML to canonical root URLs and removes those temporary
 * hashed aliases.
 *
 * This is intentionally a closed inventory. A new V4 image must be added here
 * rather than being silently swept up by a broad filename glob.
 */

import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST_DIR = fileURLToPath(new URL('../dist/', import.meta.url));
const DESTINATION = join('packs', 'v4', 'assets');
const DESTINATION_URL = '/packs/v4/assets';

export const V4_BUNDLED_ASSET_STEMS = [
  'expanse-v4-sequence',
  'undertow-v4-sequence',
  'stratum-v4',
  'vault-v4',
  'regnum-v4-sequence',
  'wear-field-v4-sequence',
  'ui-v4',
] as const;

const PWA_BUNDLED_ALIASES = [
  {
    stem: 'manifest',
    extension: 'webmanifest',
    canonical: '/manifest.webmanifest',
  },
  {
    stem: 'favicon-32',
    extension: 'png',
    canonical: '/icons/favicon-32.png',
  },
  {
    stem: 'apple-touch-icon',
    extension: 'png',
    canonical: '/icons/apple-touch-icon.png',
  },
] as const;

const TEXT_OUTPUT_EXTENSIONS = new Set(['.css', '.html', '.js', '.map']);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extension(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot < 0 ? '' : path.slice(dot);
}

function looksLikeV4Png(name: string): boolean {
  return name.endsWith('.png')
    && (name.startsWith('ui-v4-') || name.includes('-v4-'));
}

async function regularTextOutputs(
  root: string,
  dir = root,
): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const outputs: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      outputs.push(...await regularTextOutputs(root, path));
    } else if (entry.isFile() && TEXT_OUTPUT_EXTENSIONS.has(extension(entry.name))) {
      outputs.push(path);
    }
  }
  return outputs.sort();
}

interface PlannedRewrite {
  readonly path: string;
  readonly contents: string;
}

export interface RelocateV4AssetsResult {
  readonly assets: readonly string[];
  readonly removedPwaAliases: readonly string[];
  readonly rewrittenFiles: readonly string[];
  readonly destination: string;
}

/**
 * Move the exact Bun-emitted V4 PNG inventory into one edition-owned folder.
 *
 * The function expects the clean output produced immediately by `bun build`.
 * It validates the complete plan before creating or changing any file.
 */
export async function relocateV4Assets(
  distDir: string,
): Promise<RelocateV4AssetsResult> {
  const info = await stat(distDir).catch(() => undefined);
  if (info === undefined || !info.isDirectory()) {
    throw new Error(`relocate-v4-assets: dist directory is missing: ${distDir}`);
  }

  const destinationDir = join(distDir, DESTINATION);
  if (await stat(destinationDir).catch(() => undefined) !== undefined) {
    throw new Error(
      `relocate-v4-assets: destination already exists; expected a clean build: ${destinationDir}`,
    );
  }

  const rootEntries = await readdir(distDir, { withFileTypes: true });
  const rootFiles = rootEntries
    .filter((entry: Dirent) => entry.isFile())
    .map((entry: Dirent) => entry.name)
    .sort();
  const v4Pngs = rootFiles.filter(looksLikeV4Png);
  const matched = new Map<string, string>();

  for (const stem of V4_BUNDLED_ASSET_STEMS) {
    const pattern = new RegExp(`^${escapeRegExp(stem)}-[a-z0-9]+\\.png$`, 'i');
    const matches = rootFiles.filter((name) => pattern.test(name));
    if (matches.length !== 1) {
      throw new Error(
        `relocate-v4-assets: expected exactly one ${stem}-<hash>.png in dist root; found ${matches.length}`,
      );
    }
    matched.set(stem, matches[0]!);
  }

  const expectedNames = new Set(matched.values());
  const unknown = v4Pngs.filter((name) => !expectedNames.has(name));
  if (unknown.length > 0) {
    throw new Error(
      `relocate-v4-assets: unclassified V4 PNG(s) in dist root: ${unknown.join(', ')}`,
    );
  }

  const pwaAliases = new Map<string, string>();
  for (const alias of PWA_BUNDLED_ALIASES) {
    const pattern = new RegExp(
      `^${escapeRegExp(alias.stem)}-[a-z0-9]+\\.${alias.extension}$`,
      'i',
    );
    const matches = rootFiles.filter((name) => pattern.test(name));
    if (matches.length !== 1) {
      throw new Error(
        `relocate-v4-assets: expected exactly one temporary ${alias.stem}-<hash>.${alias.extension} in dist root; found ${matches.length}`,
      );
    }
    pwaAliases.set(alias.stem, matches[0]!);
  }

  const textOutputs = await regularTextOutputs(distDir);
  const sourceByPath = new Map<string, string>();
  for (const path of textOutputs) {
    sourceByPath.set(path, await readFile(path, 'utf8'));
  }

  const replacements = new Map<string, number>();
  const pwaReplacements = new Map<string, number>();
  const planned: PlannedRewrite[] = [];
  for (const path of textOutputs) {
    let contents = sourceByPath.get(path)!;
    const original = contents;
    for (const name of expectedNames) {
      const emittedUrl = `./${name}`;
      const count = contents.split(emittedUrl).length - 1;
      if (count > 0) {
        replacements.set(name, (replacements.get(name) ?? 0) + count);
        contents = contents.replaceAll(
          emittedUrl,
          `${DESTINATION_URL}/${name}`,
        );
      }
    }
    for (const alias of PWA_BUNDLED_ALIASES) {
      const name = pwaAliases.get(alias.stem)!;
      const emittedUrl = `./${name}`;
      const count = contents.split(emittedUrl).length - 1;
      if (count > 0) {
        pwaReplacements.set(
          name,
          (pwaReplacements.get(name) ?? 0) + count,
        );
        contents = contents.replaceAll(emittedUrl, alias.canonical);
      }
    }
    if (contents !== original) planned.push({ path, contents });
  }

  const unreferenced = [...expectedNames].filter(
    (name) => (replacements.get(name) ?? 0) === 0,
  );
  if (unreferenced.length > 0) {
    throw new Error(
      `relocate-v4-assets: emitted V4 PNG(s) have no text-bundle reference: ${unreferenced.join(', ')}`,
    );
  }
  const unreferencedPwa = [...pwaAliases.values()].filter(
    (name) => (pwaReplacements.get(name) ?? 0) === 0,
  );
  if (unreferencedPwa.length > 0) {
    throw new Error(
      `relocate-v4-assets: temporary PWA alias(es) have no HTML reference: ${unreferencedPwa.join(', ')}`,
    );
  }

  await mkdir(destinationDir, { recursive: true });
  for (const name of [...expectedNames].sort()) {
    await rename(join(distDir, name), join(destinationDir, name));
  }
  for (const rewrite of planned) {
    await writeFile(rewrite.path, rewrite.contents);
  }
  const removedPwaAliases = [...pwaAliases.values()].sort();
  for (const name of removedPwaAliases) {
    await rm(join(distDir, name));
  }

  const assets = [...expectedNames].sort();
  const rewrittenFiles = planned
    .map(({ path }) => relative(distDir, path).split(sep).join('/'))
    .sort();
  return {
    assets,
    removedPwaAliases,
    rewrittenFiles,
    destination: DESTINATION,
  };
}

if (import.meta.main) {
  const result = await relocateV4Assets(DIST_DIR);
  console.log(
    `relocate-v4-assets: moved ${result.assets.length} PNG(s) → dist/${result.destination}/; removed ${result.removedPwaAliases.length} PWA alias(es); rewrote ${result.rewrittenFiles.length} bundle(s)`,
  );
}
