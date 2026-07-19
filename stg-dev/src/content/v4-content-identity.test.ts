/// <reference types="node" />

import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";
import {loadContentAuthority} from "./content-authority";
import {V4_CONTENT_IDENTITY} from "./v4-content-identity";

const V4_ROOT = fileURLToPath(new URL("../../../1bit-stg-complete-asset-kit-v4/", import.meta.url));

describe("browser-safe V4 content identity", () => {
  it("exactly matches the validated V4 content authority snapshot", async () => {
    const report = await loadContentAuthority(V4_ROOT);

    expect({
      contentAuthoritySchemaVersion: report.snapshot.schemaVersion,
      packageId: report.snapshot.packageId,
      packageSchemaVersion: report.snapshot.packageSchemaVersion,
      packageManifestSha256: report.snapshot.packageManifestSha256,
      contentDigestSha256: report.snapshot.contentDigestSha256,
    }).toStrictEqual(V4_CONTENT_IDENTITY);
    expect(Object.isFrozen(V4_CONTENT_IDENTITY)).toBe(true);
  }, 30_000);
});
