#!/usr/bin/env bun

import {mkdir, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {
  contentAuthorityFailureReport,
  loadContentAuthority,
  stableStringify,
  type ContentAuthoritySnapshot,
} from "../../src/content/content-authority.ts";
import {V4_CONTENT_IDENTITY} from "../../src/content/v4-content-identity.ts";

function assertPinnedV4ContentIdentity(snapshot: ContentAuthoritySnapshot): void {
  const actual = {
    contentAuthoritySchemaVersion: snapshot.schemaVersion,
    packageId: snapshot.packageId,
    packageSchemaVersion: snapshot.packageSchemaVersion,
    packageManifestSha256: snapshot.packageManifestSha256,
    contentDigestSha256: snapshot.contentDigestSha256,
  } as const;

  for (const field of Object.keys(V4_CONTENT_IDENTITY) as Array<keyof typeof V4_CONTENT_IDENTITY>) {
    if (actual[field] !== V4_CONTENT_IDENTITY[field]) {
      throw new Error(
        `V4 content identity drift at ${field}: expected ${V4_CONTENT_IDENTITY[field]}, received ${actual[field]}`,
      );
    }
  }
}

const defaultRoot = fileURLToPath(new URL("../../../1bit-stg-complete-asset-kit-v4/", import.meta.url));
const args = process.argv.slice(2);
let packageRoot = defaultRoot;
let outputPath: string | undefined;

for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  const value = args[index + 1];
  if ((argument === "--root" || argument === "--out") && value) {
    if (argument === "--root") packageRoot = resolve(value);
    else outputPath = resolve(value);
    index += 1;
  } else {
    process.stderr.write(`Unknown or incomplete argument: ${argument ?? ""}\n`);
    process.exit(2);
  }
}

try {
  const report = await loadContentAuthority(packageRoot);
  assertPinnedV4ContentIdentity(report.snapshot);
  const serialized = `${stableStringify(report, 2)}\n`;
  if (outputPath) {
    await mkdir(dirname(outputPath), {recursive: true});
    await writeFile(outputPath, serialized, "utf8");
  }
  process.stdout.write(serialized);
} catch (error) {
  const serialized = `${stableStringify(contentAuthorityFailureReport(error), 2)}\n`;
  if (outputPath) {
    await mkdir(dirname(outputPath), {recursive: true});
    await writeFile(outputPath, serialized, "utf8");
  }
  process.stderr.write(serialized);
  process.exitCode = 1;
}
