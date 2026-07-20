// Build step: stage packs/ for a static host.
//
// The dev server (tools/serve.ts) synthesizes /packs/index.json per request;
// a static host cannot. So the build copies the packs/ tree into dist/packs/
// verbatim and writes the same index.json alongside it — the listing the
// loader fetches, precomputed. On any static host the built output then works
// with no wrapper. Skips (with a log line) when packs/ is absent, so a repo
// with no packs still builds.

import { cp, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const PACKS_DIR = new URL("../packs/", import.meta.url).pathname;
const DIST_PACKS_DIR = new URL("../dist/packs/", import.meta.url).pathname;

async function packIndex(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const names: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      const s = await stat(join(dir, e.name, "pack.json"));
      if (s.isFile()) names.push(e.name);
    } catch {
      // not a pack — skipped.
    }
  }
  return names.sort();
}

let hasPacks = true;
try {
  const s = await stat(PACKS_DIR);
  hasPacks = s.isDirectory();
} catch {
  hasPacks = false;
}

if (!hasPacks) {
  console.log("copy-packs: no packs/ directory — nothing to stage.");
} else {
  await cp(PACKS_DIR, DIST_PACKS_DIR, { recursive: true });
  const packs = await packIndex(PACKS_DIR);
  await mkdir(DIST_PACKS_DIR, { recursive: true });
  await writeFile(
    join(DIST_PACKS_DIR, "index.json"),
    JSON.stringify({ packs }),
  );
  console.log(`copy-packs: staged ${packs.length} pack(s) → dist/packs/`);
}
