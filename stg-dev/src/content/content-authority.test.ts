/// <reference types="node" />

import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";
import {
  CANONICAL_V4_COUNTS,
  ContentAuthorityError,
  DiskContentSource,
  loadContentAuthority,
  stableStringify,
  type ContentSource,
} from "./content-authority";

const V4_ROOT = fileURLToPath(new URL("../../../1bit-stg-complete-asset-kit-v4/", import.meta.url));
const encoder = new TextEncoder();
const decoder = new TextDecoder();

class OverlayContentSource implements ContentSource {
  readonly base = new DiskContentSource(V4_ROOT);
  readonly overrides = new Map<string, Uint8Array>();
  readonly omitted = new Set<string>();
  readonly additions = new Map<string, Uint8Array>();

  async listFiles(): Promise<readonly string[]> {
    const baseFiles = (await this.base.listFiles()).filter((path) => !this.omitted.has(path));
    return [...baseFiles, ...this.additions.keys()].sort();
  }

  async readBytes(contentPath: string): Promise<Uint8Array> {
    if (this.omitted.has(contentPath)) throw new Error(`fixture omitted ${contentPath}`);
    return this.overrides.get(contentPath) ?? this.additions.get(contentPath) ?? this.base.readBytes(contentPath);
  }

  async mutateJson(contentPath: string, mutate: (document: Record<string, unknown>) => void): Promise<void> {
    const document = JSON.parse(decoder.decode(await this.base.readBytes(contentPath))) as Record<string, unknown>;
    mutate(document);
    this.overrides.set(contentPath, encoder.encode(`${JSON.stringify(document, null, 2)}\n`));
  }
}

async function expectAuthorityFailure(
  source: ContentSource,
  code: ContentAuthorityError["code"],
  pathFragment: string,
): Promise<void> {
  try {
    await loadContentAuthority(source);
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ContentAuthorityError);
    const authorityError = error as ContentAuthorityError;
    expect(authorityError.code).toBe(code);
    expect(authorityError.contentPath).toContain(pathFragment);
  }
}

describe("V4 content authority", () => {
  it("accepts the untouched V4 package and emits a deterministic snapshot", async () => {
    const first = await loadContentAuthority(V4_ROOT);
    const second = await loadContentAuthority(V4_ROOT);

    expect(first.status).toBe("PASS");
    expect(first.snapshot.counts).toEqual(CANONICAL_V4_COUNTS);
    expect(first.snapshot.checksumEntries).toBe(778);
    expect(first.snapshot.universes.patterns?.count).toBe(48);
    expect(first.snapshot.universes.frames?.count).toBe(448);
    expect(first.snapshot.snapshotDigestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(stableStringify(second)).toBe(stableStringify(first));
  }, 30_000);

  it("fails fast when a checksum row is tampered", async () => {
    const source = new OverlayContentSource();
    const original = decoder.decode(await source.base.readBytes("checksums-sha256.txt"));
    source.overrides.set("checksums-sha256.txt", encoder.encode(original.replace(/^[0-9a-f]{64}/, "0".repeat(64))));

    await expectAuthorityFailure(source, "INTEGRITY_HASH_MISMATCH", "README_ZH.md");
  }, 30_000);

  it("rejects a missing cross-manifest pattern reference before hash validation", async () => {
    const source = new OverlayContentSource();
    await source.mutateJson("manifests/gameplay/enemy-archetypes-v4.json", (document) => {
      const enemies = document.enemies as Array<Record<string, unknown>>;
      const cadence = enemies[0]?.cadence as Record<string, unknown>;
      cadence.patternId = "pattern.absent.from.v4";
    });

    await expectAuthorityFailure(source, "UNKNOWN_REFERENCE", "cadence.patternId");
  });

  it("rejects a duplicate canonical ID", async () => {
    const source = new OverlayContentSource();
    await source.mutateJson("manifests/gameplay/motion-operators-v4.json", (document) => {
      const operators = document.operators as Array<Record<string, unknown>>;
      if (operators[0] && operators[1]) operators[1].id = operators[0].id;
    });

    await expectAuthorityFailure(source, "DUPLICATE_ID", "gameplay.motionOperators");
  });

  it("rejects a wrong package schemaVersion before following entrypoints", async () => {
    const source = new OverlayContentSource();
    await source.mutateJson("manifests/v4/package-manifest-v4.json", (document) => {
      document.schemaVersion = "5.0.0";
    });

    await expectAuthorityFailure(source, "VERSION_MISMATCH", "package-manifest-v4.json.schemaVersion");
  });

  it("rejects unknown physical files and orphan checksum rows", async () => {
    const unknown = new OverlayContentSource();
    unknown.additions.set("unknown-content.bin", encoder.encode("not declared"));
    await expectAuthorityFailure(unknown, "INTEGRITY_UNKNOWN_FILE", "unknown-content.bin");

    const orphan = new OverlayContentSource();
    orphan.omitted.add("README_ZH.md");
    await expectAuthorityFailure(orphan, "INTEGRITY_ORPHAN_ENTRY", "README_ZH.md");
  }, 30_000);
});
