// Build step: stage packs/ for a static host.
//
// The dev server (tools/serve.ts) synthesizes /packs/index.json per request;
// a static host cannot. So the build replaces dist/packs/ from the current
// shippable packs and writes index.json alongside them — the listing the loader
// fetches, precomputed. Replacing the directory is load-bearing: a deleted or
// newly unconfirmed pack must not survive in a later deploy as stale output.
// When packs/ is absent, the stale destination is still removed and the build
// continues with a log line.
//
// A pack whose pack.json `license` begins with "UNCONFIRMED" is staged by
// neither the copy nor the index (CLAUDE.md rule 9: everything we ship must be
// original/clearable). `.gitignore` keeps such a pack out of the commit, but
// `bun run build` + a static-host deploy is a second path onto the public web,
// and a whole-tree `cp` would have carried the art down it. So each pack is
// copied individually and the unconfirmed ones are skipped out loud — never
// silently — so a licence that clears later is the only thing needed to ship it.

import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { basename, dirname, join } from "node:path";

const PACKS_DIR = new URL("../packs/", import.meta.url).pathname;
const DIST_PACKS_DIR = new URL("../dist/packs/", import.meta.url).pathname;

export interface StagePacksResult {
  hasPacks: boolean;
  ship: string[];
  skipped: string[];
}

/** True when a pack's declared licence forbids distribution until cleared. */
function isUnconfirmed(license: unknown): boolean {
  return typeof license === "string" && license.trimStart().startsWith("UNCONFIRMED");
}

function isPlatformMetadataName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === ".ds_store"
    || lower.startsWith("._")
    || lower === ".appledouble"
    || lower === "thumbs.db"
    || lower === "desktop.ini"
    || lower === "__macosx";
}

/** OS/editor metadata is never a runtime pack resource and must not ship. */
function shouldStagePackEntry(source: string): boolean {
  const name = basename(source);
  return !name.startsWith(".") && !isPlatformMetadataName(name);
}

/** Remove stale metadata that an incremental build may have left anywhere in dist/. */
export async function cleanPublishMetadata(root: string): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (isPlatformMetadataName(entry.name)) {
      await rm(path, { recursive: true, force: true });
    } else if (entry.isDirectory()) {
      await cleanPublishMetadata(path);
    }
  }
}

/**
 * The packs eligible to ship: every directory with a pack.json whose licence is
 * not UNCONFIRMED. Returns the names to stage and copy, plus the names skipped
 * so the caller can report them.
 */
async function surveyPacks(dir: string): Promise<{ ship: string[]; skipped: string[] }> {
  const entries = await readdir(dir, { withFileTypes: true });
  const ship: string[] = [];
  const skipped: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const manifest = join(dir, e.name, "pack.json");
    try {
      const s = await stat(manifest);
      if (!s.isFile()) continue;
    } catch {
      // not a pack — skipped, but not "skipped for licence".
      continue;
    }
    let license: unknown;
    try {
      license = JSON.parse(await readFile(manifest, "utf8")).license;
    } catch {
      license = undefined; // unreadable/invalid manifest — treat as no licence field.
    }
    if (isUnconfirmed(license)) skipped.push(e.name);
    else ship.push(e.name);
  }
  ship.sort();
  skipped.sort();
  return { ship, skipped };
}

/** Replace one build destination from the packs currently eligible to ship. */
export async function stagePacks(
  packsDir: string,
  distPacksDir: string,
): Promise<StagePacksResult> {
  let hasPacks = true;
  try {
    const s = await stat(packsDir);
    hasPacks = s.isDirectory();
  } catch {
    hasPacks = false;
  }

  // `dist/` is disposable build output. Clear this exact child even when the
  // source directory disappeared, so no previously staged pack can be deployed.
  await rm(distPacksDir, { recursive: true, force: true });
  await cleanPublishMetadata(dirname(distPacksDir));
  if (!hasPacks) return { hasPacks: false, ship: [], skipped: [] };

  const { ship, skipped } = await surveyPacks(packsDir);
  await mkdir(distPacksDir, { recursive: true });
  for (const name of ship) {
    await cp(join(packsDir, name), join(distPacksDir, name), {
      recursive: true,
      filter: shouldStagePackEntry,
    });
  }
  await writeFile(
    join(distPacksDir, "index.json"),
    JSON.stringify({ packs: ship }),
  );
  return { hasPacks: true, ship, skipped };
}

if (import.meta.main) {
  const { hasPacks, ship, skipped } = await stagePacks(PACKS_DIR, DIST_PACKS_DIR);
  if (!hasPacks) {
    console.log("copy-packs: no packs/ directory — nothing to stage.");
  } else {
    console.log(`copy-packs: staged ${ship.length} pack(s) → dist/packs/`);
    if (skipped.length > 0) {
      console.log(
        `copy-packs: skipped ${skipped.length} unconfirmed-licence pack(s): ${skipped.join(", ")}`,
      );
    }
  }
}
