#!/usr/bin/env bun

import {mkdir, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {
  contentAuthorityFailureReport,
  loadContentAuthority,
  stableStringify,
} from "../../src/content/content-authority.ts";

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
