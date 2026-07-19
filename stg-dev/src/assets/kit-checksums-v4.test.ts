import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";
import {V4_UNMANIFESTED_CHECKSUMS, v4UnmanifestedChecksum} from "./kit-checksums-v4";

const KIT_ROOT = new URL("../../../1bit-stg-complete-asset-kit-v4/", import.meta.url);

async function kitChecksumRows(): Promise<Map<string, string>> {
  const text = await readFile(fileURLToPath(new URL("checksums-sha256.txt", KIT_ROOT)), "utf8");
  const rows = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    const match = /^([0-9a-f]{64})\s{2}(.+)$/u.exec(line);
    expect(match, `unparsable checksum row: ${line}`).not.toBeNull();
    rows.set(match![2]!, match![1]!);
  }
  return rows;
}

describe("V4 unmanifested checksum pins", () => {
  it("mirrors the kit's own checksum rows for files no JSON manifest describes", async () => {
    const rows = await kitChecksumRows();
    const pinned = Object.entries(V4_UNMANIFESTED_CHECKSUMS);
    expect(pinned).toHaveLength(3);
    for (const [sourcePath, sha256] of pinned) {
      expect(rows.get(sourcePath), `${sourcePath} is absent from checksums-sha256.txt`)
        .toBe(sha256);
      const bytes = await readFile(fileURLToPath(new URL(sourcePath, KIT_ROOT)));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
    }
  });

  it("fails closed on an unpinned path", () => {
    expect(() => v4UnmanifestedChecksum("ui/atlas/missing.png" as never))
      .toThrow(/no pinned checksum/u);
  });

  it("freezes the pin table", () => {
    expect(Object.isFrozen(V4_UNMANIFESTED_CHECKSUMS)).toBe(true);
  });
});
