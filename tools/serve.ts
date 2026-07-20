// Dev server for the pack system.
//
// Why this wrapper exists: `bun ./index.html` serves ONLY the bundler-resolved
// import graph. A GET for a path outside that graph — `/packs/anything` —
// returns the HTML entry with status 200, not the file and not a 404. So the
// loader can never discover packs on disk under the bare command. This process
// serves the same HTML import (identical dev-bundling: `/_bun/*` assets are
// still rewritten and served by Bun) AND, alongside it, the `packs/` tree as
// static files plus a `/packs/index.json` synthesized per-request from the
// directory listing — so dropping a folder into `packs/` and refreshing is the
// whole activation story.
//
// This is a DEV tool. Production is plain static files: `bun run build` copies
// `packs/` (and the same index.json) into `dist/` via tools/copy-packs.ts, and
// any static host serves them directly with no wrapper.

import { readdir, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join, normalize } from "node:path";
import index from "../index.html";

const PACKS_DIR = new URL("../packs/", import.meta.url).pathname;
const PORT = Number(process.env.PORT ?? 3000);

// Directory names under packs/ that contain a pack.json, sorted. Synthesized
// per request so a folder dropped in while the server runs is seen on refresh.
async function packIndex(): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(PACKS_DIR, { withFileTypes: true });
  } catch {
    return []; // packs/ absent — zero packs, identical to today.
  }
  const names: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      const s = await stat(join(PACKS_DIR, e.name, "pack.json"));
      if (s.isFile()) names.push(e.name);
    } catch {
      // no pack.json — not a pack, skipped silently (a stray dir is not an error).
    }
  }
  return names.sort();
}

// Serve one file from packs/, guarding against path traversal escaping the tree.
async function servePackFile(pathname: string): Promise<Response> {
  const rel = normalize(decodeURIComponent(pathname.slice("/packs/".length)));
  if (rel.startsWith("..") || rel.includes("\0")) {
    return new Response("forbidden", { status: 403 });
  }
  const file = Bun.file(join(PACKS_DIR, rel)); // content type inferred from extension
  if (!(await file.exists())) {
    return new Response("not found", { status: 404 });
  }
  return new Response(file);
}

const server = Bun.serve({
  port: PORT,
  routes: { "/": index },
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === "/packs/index.json") {
      return Response.json({ packs: await packIndex() });
    }
    if (pathname.startsWith("/packs/")) {
      return servePackFile(pathname);
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`dev server (packs-aware) on ${server.url}`);
