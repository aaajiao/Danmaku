/// <reference types="node" />

import {createHash} from "node:crypto";
import {readdir, readFile} from "node:fs/promises";
import {posix, resolve, sep} from "node:path";

type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = {[key: string]: JsonValue};

const PACKAGE_MANIFEST_PATH = "manifests/v4/package-manifest-v4.json";
const CHECKSUM_MANIFEST_PATH = "checksums-sha256.txt";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const CONTENT_AUTHORITY_SCHEMA_VERSION = "4.0.0-content-authority";

/**
 * These are the only mutable/self-referential files outside the frozen checksum
 * universe. Every other regular file in the package must have one checksum row.
 */
export const CHECKSUM_EXCLUSIONS = Object.freeze([
  CHECKSUM_MANIFEST_PATH,
  "tools/qa/V4_INTEGRATION_VALIDATION_REPORT_ZH.md",
  "tools/qa/v4-integration-validation-report.json",
] as const);

const EXPECTED_ENTRYPOINT_VERSIONS = Object.freeze({
  animations: "4.0.0-animations",
  assetBindings: "4.0.0-asset-bindings",
  atlases: "4.0.0",
  audio: "4.0.0-audio",
  backgrounds: "4.0.0-backgrounds",
  entityVisualBindings: "4.0.0-entity-visual-bindings",
  eventProjections: "4.0.0-event-projections",
  frames: "4.0.0",
  gameplay: "4.0.0",
  narrative: "4.0.0-narrative-manifest",
  runtime: "4.0.0",
  semanticAliases: "4.0.0-semantic-aliases",
  ui: "4.0.0-ui-layout",
});

const EXPECTED_GAMEPLAY_FILES = Object.freeze([
  "boss-rigs-v4.json",
  "encounter-director-v4.json",
  "enemy-archetypes-v4.json",
  "executable-patterns-v4.json",
  "laser-geometries-v4.json",
  "motion-operators-v4.json",
  "projectile-lifecycle-v4.json",
  "room-composers-v4.json",
  "run-director-v4.json",
]);

const EXPECTED_RUNTIME_MANIFESTS = Object.freeze([
  "accessibility",
  "contract",
  "events",
  "feedbackBindings",
  "stateMachines",
]);

const EXPECTED_NARRATIVE_VERSIONS = Object.freeze({
  audio: "4.0.0-audio",
  bossResolutions: "4.0.0-boss-resolutions",
  feedbackCues: "4.0.0-feedback-cues",
  ghostReplay: "4.0.0-ghost-replay",
  roomThresholds: "4.0.0-room-thresholds",
  runMemoryExample: "4.0.0-run-memory",
  snapshotObservations: "4.0.0-snapshot-observations",
  stateMachine: "4.0.0-narrative-state-machine",
  uiCopy: "4.0.0-ui-copy",
  uiLayouts: "4.0.0-ui-layout",
  weather: "4.0.0-weather",
  witnessConditions: "4.0.0-witness-conditions",
  worldReactionGraph: "4.0.0-world-reaction-graph",
});

export const CANONICAL_V4_COUNTS = Object.freeze({
  accessibilityCombinations: 216,
  atlases: 7,
  audioAssets: 48,
  baseBackgrounds: 4,
  bosses: 8,
  bossPhases: 24,
  bossSequenceAnimations: 8,
  enemyArchetypes: 16,
  executablePatterns: 48,
  laserTopologies: 8,
  legacyVisualClips: 41,
  motionOperators: 12,
  narrativeFeedbackCues: 37,
  patternAnimations: 48,
  physicalFrames: 448,
  reactionOverlays: 16,
  runtimeEvents: 72,
  runtimeFeedbackBindings: 34,
  runtimeStateSystems: 12,
  snapshotObservations: 64,
  v4StateLibraries: 24,
  v4UiScreens: 9,
  weatherTypes: 5,
});

export type ContentAuthorityErrorCode =
  | "COUNT_MISMATCH"
  | "DUPLICATE_ID"
  | "INTEGRITY_HASH_MISMATCH"
  | "INTEGRITY_INVALID_MANIFEST"
  | "INTEGRITY_ORPHAN_ENTRY"
  | "INTEGRITY_SIZE_MISMATCH"
  | "INTEGRITY_UNKNOWN_FILE"
  | "INVALID_CONTENT"
  | "INVALID_PATH"
  | "MISSING_FILE"
  | "ORPHAN_REFERENCE"
  | "SCHEMA_MISMATCH"
  | "UNKNOWN_CONTRACT_ENTRY"
  | "UNKNOWN_REFERENCE"
  | "VERSION_MISMATCH";

export class ContentAuthorityError extends Error {
  readonly code: ContentAuthorityErrorCode;
  readonly contentPath: string;
  readonly detail: string;

  constructor(code: ContentAuthorityErrorCode, contentPath: string, detail: string) {
    super(`${code} ${contentPath}: ${detail}`);
    this.name = "ContentAuthorityError";
    this.code = code;
    this.contentPath = contentPath;
    this.detail = detail;
  }
}

export interface ContentSource {
  listFiles(): Promise<readonly string[]>;
  readBytes(contentPath: string): Promise<Uint8Array>;
}

export class DiskContentSource implements ContentSource {
  readonly root: string;

  constructor(packageRoot: string) {
    this.root = resolve(packageRoot);
  }

  async readBytes(contentPath: string): Promise<Uint8Array> {
    const safePath = normalizeContentPath(contentPath);
    const absolutePath = resolve(this.root, ...safePath.split("/"));
    const prefix = this.root.endsWith(sep) ? this.root : `${this.root}${sep}`;
    if (absolutePath !== this.root && !absolutePath.startsWith(prefix)) {
      fail("INVALID_PATH", contentPath, "path escapes the V4 package root");
    }
    try {
      return await readFile(absolutePath);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      fail("MISSING_FILE", safePath, reason);
    }
  }

  async listFiles(): Promise<readonly string[]> {
    const files: string[] = [];
    const visit = async (absoluteDirectory: string, relativeDirectory: string): Promise<void> => {
      const entries = await readdir(absoluteDirectory, {withFileTypes: true});
      entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
      for (const entry of entries) {
        const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
        const absolutePath = resolve(absoluteDirectory, entry.name);
        if (entry.isDirectory()) {
          await visit(absolutePath, relativePath);
        } else if (entry.isFile()) {
          files.push(normalizeContentPath(relativePath));
        } else {
          fail("INTEGRITY_UNKNOWN_FILE", relativePath, "symlinks and special filesystem entries are forbidden");
        }
      }
    };
    await visit(this.root, "");
    return files.sort(compareText);
  }
}

export interface ContentUniverseFact {
  count: number;
  digestSha256: string;
}

export interface ContentAuthoritySnapshot {
  schemaVersion: typeof CONTENT_AUTHORITY_SCHEMA_VERSION;
  packageId: string;
  packageSchemaVersion: "4.0.0";
  packageManifest: typeof PACKAGE_MANIFEST_PATH;
  packageManifestSha256: string;
  checksumManifest: typeof CHECKSUM_MANIFEST_PATH;
  checksumManifestSha256: string;
  contentDigestSha256: string;
  checksumEntries: number;
  checksumExclusions: readonly string[];
  authorityOrder: readonly string[];
  entrypoints: Readonly<Record<string, string>>;
  counts: Readonly<Record<keyof typeof CANONICAL_V4_COUNTS, number>>;
  schemaVersions: Readonly<Record<string, string>>;
  universes: Readonly<Record<string, ContentUniverseFact>>;
  snapshotDigestSha256: string;
}

export interface ContentAuthorityCheck {
  id: string;
  status: "PASS";
  detail: string;
}

export interface ContentAuthorityReport {
  schemaVersion: typeof CONTENT_AUTHORITY_SCHEMA_VERSION;
  status: "PASS";
  checks: readonly ContentAuthorityCheck[];
  snapshot: ContentAuthoritySnapshot;
}

export interface ContentAuthorityFailureReport {
  schemaVersion: typeof CONTENT_AUTHORITY_SCHEMA_VERSION;
  status: "FAIL";
  error: {
    code: ContentAuthorityErrorCode;
    path: string;
    detail: string;
  };
}

interface ChecksumEntry {
  hash: string;
  path: string;
}

interface Catalogs {
  animationIndex: JsonObject;
  assetBindings: JsonObject;
  atlases: JsonObject;
  audio: JsonObject;
  backgrounds: JsonObject;
  bossResolutions: JsonObject;
  bosses: JsonObject;
  composers: JsonObject;
  encounterDirector: JsonObject;
  enemies: JsonObject;
  entityVisualBindings: JsonObject;
  eventProjections: JsonObject;
  feedbackCues: JsonObject;
  frames: JsonObject;
  lasers: JsonObject;
  motionOperators: JsonObject;
  narrativeManifest: JsonObject;
  observations: JsonObject;
  patterns: JsonObject;
  roomThresholds: JsonObject;
  runDirector: JsonObject;
  runMemoryExample: JsonObject;
  runMemorySchema: JsonObject;
  runtimeAccessibility: JsonObject;
  runtimeBindings: JsonObject;
  runtimeContract: JsonObject;
  runtimeEvents: JsonObject;
  runtimeMachines: JsonObject;
  runtimeManifest: JsonObject;
  semanticAliases: JsonObject;
  uiCopy: JsonObject;
  uiLayouts: JsonObject;
  witnessConditions: JsonObject;
  weather: JsonObject;
}

class AuthorityReader {
  readonly source: ContentSource;
  readonly bytes = new Map<string, Uint8Array>();
  readonly json = new Map<string, JsonObject>();

  constructor(source: ContentSource) {
    this.source = source;
  }

  async readBytes(contentPath: string): Promise<Uint8Array> {
    const safePath = normalizeContentPath(contentPath);
    const cached = this.bytes.get(safePath);
    if (cached) return cached;
    const value = await this.source.readBytes(safePath);
    this.bytes.set(safePath, value);
    return value;
  }

  async readText(contentPath: string): Promise<string> {
    const bytes = await this.readBytes(contentPath);
    try {
      return new TextDecoder("utf-8", {fatal: true}).decode(bytes);
    } catch {
      fail("INVALID_CONTENT", contentPath, "file is not valid UTF-8");
    }
  }

  async readJson(contentPath: string): Promise<JsonObject> {
    const safePath = normalizeContentPath(contentPath);
    const cached = this.json.get(safePath);
    if (cached) return cached;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await this.readText(safePath));
    } catch (error) {
      if (error instanceof ContentAuthorityError) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      fail("INVALID_CONTENT", safePath, `invalid JSON: ${reason}`);
    }
    const object = requireObject(parsed, safePath);
    this.json.set(safePath, object);
    return object;
  }
}

export async function loadContentAuthority(
  sourceOrRoot: ContentSource | string,
): Promise<ContentAuthorityReport> {
  const source = typeof sourceOrRoot === "string" ? new DiskContentSource(sourceOrRoot) : sourceOrRoot;
  const reader = new AuthorityReader(source);
  const checks: ContentAuthorityCheck[] = [];
  const schemaVersions = new Map<string, string>();
  const declaredPaths = new Set<string>([PACKAGE_MANIFEST_PATH, CHECKSUM_MANIFEST_PATH]);

  const checksumBytes = await reader.readBytes(CHECKSUM_MANIFEST_PATH);
  const checksumEntries = parseChecksumManifest(new TextDecoder().decode(checksumBytes));
  const packageManifest = await reader.readJson(PACKAGE_MANIFEST_PATH);
  assertVersion(packageManifest, "4.0.0", PACKAGE_MANIFEST_PATH, schemaVersions);
  requireString(packageManifest.id, `${PACKAGE_MANIFEST_PATH}.id`, "1bit-stg-complete-asset-kit-v4");
  const authorityOrder = requireStringArray(packageManifest.authorityOrder, `${PACKAGE_MANIFEST_PATH}.authorityOrder`);
  requireExactStrings(
    authorityOrder,
    ["runtime", "gameplay", "narrative", "integration", "visual-audio-ui"],
    `${PACKAGE_MANIFEST_PATH}.authorityOrder`,
  );

  const entrypoints = requireStringRecord(packageManifest.entrypoints, `${PACKAGE_MANIFEST_PATH}.entrypoints`);
  requireExactKeys(entrypoints, Object.keys(EXPECTED_ENTRYPOINT_VERSIONS), `${PACKAGE_MANIFEST_PATH}.entrypoints`);
  for (const [name, expectedVersion] of sortedEntries(EXPECTED_ENTRYPOINT_VERSIONS)) {
    const contentPath = normalizeContentPath(requireString(entrypoints[name], `${PACKAGE_MANIFEST_PATH}.entrypoints.${name}`));
    declaredPaths.add(contentPath);
    const document = await reader.readJson(contentPath);
    assertVersion(document, expectedVersion, contentPath, schemaVersions);
  }
  checks.push(pass("package.entrypoints", `${Object.keys(entrypoints).length} canonical entrypoints, one V4 authority root`));

  const gameplayIndexPath = entrypoints.gameplay as string;
  const gameplayIndex = await reader.readJson(gameplayIndexPath);
  const gameplayFiles = requireArray(gameplayIndex.files, `${gameplayIndexPath}.files`);
  const gameplayFileNames = gameplayFiles.map((row, index) =>
    requireString(requireObject(row, `${gameplayIndexPath}.files[${index}]`).path, `${gameplayIndexPath}.files[${index}].path`),
  );
  requireExactStrings(gameplayFileNames, EXPECTED_GAMEPLAY_FILES, `${gameplayIndexPath}.files`);
  requireString(gameplayIndex.canonicalPatternManifest, `${gameplayIndexPath}.canonicalPatternManifest`, "executable-patterns-v4.json");

  const gameplayDocuments = new Map<string, {document: JsonObject; path: string}>();
  for (const [index, rawRow] of gameplayFiles.entries()) {
    const row = requireObject(rawRow, `${gameplayIndexPath}.files[${index}]`);
    const relativePath = requireString(row.path, `${gameplayIndexPath}.files[${index}].path`);
    const contentPath = resolveReference(gameplayIndexPath, relativePath);
    declaredPaths.add(contentPath);
    const document = await reader.readJson(contentPath);
    assertVersion(document, "4.0.0", contentPath, schemaVersions);
    const schemaReference = requireString(document.$schema, `${contentPath}.$schema`);
    const schemaPath = resolveReference(contentPath, schemaReference);
    declaredPaths.add(schemaPath);
    const schema = await reader.readJson(schemaPath);
    requireString(schema.$schema, `${schemaPath}.$schema`, "https://json-schema.org/draft/2020-12/schema");
    requireString(schema.$id, `${schemaPath}.$id`, posix.basename(schemaPath));
    validateJsonSchema(document, schema, schema, "$", contentPath);
    gameplayDocuments.set(relativePath, {document, path: contentPath});
  }

  const runtimeManifestPath = entrypoints.runtime as string;
  const runtimeManifest = await reader.readJson(runtimeManifestPath);
  const runtimeRefs = requireStringRecord(runtimeManifest.manifests, `${runtimeManifestPath}.manifests`);
  requireExactKeys(runtimeRefs, EXPECTED_RUNTIME_MANIFESTS, `${runtimeManifestPath}.manifests`);
  const runtimeDocuments = new Map<string, {document: JsonObject; path: string}>();
  for (const [name, contentPathRaw] of sortedEntries(runtimeRefs)) {
    const contentPath = normalizeContentPath(contentPathRaw);
    declaredPaths.add(contentPath);
    const document = await reader.readJson(contentPath);
    assertVersion(document, "4.0.0", contentPath, schemaVersions);
    runtimeDocuments.set(name, {document, path: contentPath});
  }
  collectDeclaredFileRecord(runtimeManifest.referenceImplementation, `${runtimeManifestPath}.referenceImplementation`, declaredPaths);
  collectDeclaredFileRecord(runtimeManifest.qaArtifacts, `${runtimeManifestPath}.qaArtifacts`, declaredPaths);

  const narrativeManifestPath = entrypoints.narrative as string;
  const narrativeManifest = await reader.readJson(narrativeManifestPath);
  const narrativeRefs = requireStringRecord(narrativeManifest.canonicalFiles, `${narrativeManifestPath}.canonicalFiles`);
  const expectedNarrativeKeys = [...Object.keys(EXPECTED_NARRATIVE_VERSIONS), "runMemorySchema"];
  requireExactKeys(narrativeRefs, expectedNarrativeKeys, `${narrativeManifestPath}.canonicalFiles`);
  const narrativeDocuments = new Map<string, {document: JsonObject; path: string}>();
  for (const [name, contentPathRaw] of sortedEntries(narrativeRefs)) {
    const contentPath = normalizeContentPath(contentPathRaw);
    declaredPaths.add(contentPath);
    const document = await reader.readJson(contentPath);
    if (name === "runMemorySchema") {
      requireString(document.$schema, `${contentPath}.$schema`, "https://json-schema.org/draft/2020-12/schema");
      requireString(document.$id, `${contentPath}.$id`, "urn:1bit:v4:run-memory");
      const properties = requireObject(document.properties, `${contentPath}.properties`);
      const schemaVersion = requireObject(properties.schemaVersion, `${contentPath}.properties.schemaVersion`);
      requireString(schemaVersion.const, `${contentPath}.properties.schemaVersion.const`, "4.0.0-run-memory");
    } else {
      const expectedVersion = EXPECTED_NARRATIVE_VERSIONS[name as keyof typeof EXPECTED_NARRATIVE_VERSIONS];
      if (!expectedVersion) fail("UNKNOWN_CONTRACT_ENTRY", `${narrativeManifestPath}.canonicalFiles.${name}`, "unknown narrative authority");
      assertVersion(document, expectedVersion, contentPath, schemaVersions);
    }
    narrativeDocuments.set(name, {document, path: contentPath});
  }
  requireString(entrypoints.audio, `${PACKAGE_MANIFEST_PATH}.entrypoints.audio`, narrativeRefs.audio);
  requireString(entrypoints.ui, `${PACKAGE_MANIFEST_PATH}.entrypoints.ui`, narrativeRefs.uiLayouts);
  const runMemorySchema = requireCatalog(narrativeDocuments, "runMemorySchema");
  const runMemoryExample = requireCatalog(narrativeDocuments, "runMemoryExample");
  // The package contract asks this authority layer to pin schema identity and
  // schemaVersion. Full RunMemory instance validation belongs to the runtime
  // serializer gate; the shipped V4 example contains three 63-character opaque
  // sample digests and is intentionally not rewritten or normalized here.

  const animationsPath = entrypoints.animations as string;
  const animations = await reader.readJson(animationsPath);
  const animationIndexPath = normalizeContentPath(requireString(animations.executableMotionPreviews, `${animationsPath}.executableMotionPreviews`));
  declaredPaths.add(animationIndexPath);
  const animationIndex = await reader.readJson(animationIndexPath);
  assertVersion(animationIndex, "4.0.0-motion-previews", animationIndexPath, schemaVersions);

  checks.push(pass("schemas.versions-and-shapes", `${schemaVersions.size} versioned authorities plus 9 local schemas validated`));

  const catalogs: Catalogs = {
    animationIndex,
    assetBindings: await reader.readJson(entrypoints.assetBindings as string),
    atlases: await reader.readJson(entrypoints.atlases as string),
    audio: await reader.readJson(entrypoints.audio as string),
    backgrounds: await reader.readJson(entrypoints.backgrounds as string),
    bossResolutions: requireCatalog(narrativeDocuments, "bossResolutions"),
    bosses: requireGameplay(gameplayDocuments, "boss-rigs-v4.json"),
    composers: requireGameplay(gameplayDocuments, "room-composers-v4.json"),
    encounterDirector: requireGameplay(gameplayDocuments, "encounter-director-v4.json"),
    enemies: requireGameplay(gameplayDocuments, "enemy-archetypes-v4.json"),
    entityVisualBindings: await reader.readJson(entrypoints.entityVisualBindings as string),
    eventProjections: await reader.readJson(entrypoints.eventProjections as string),
    feedbackCues: requireCatalog(narrativeDocuments, "feedbackCues"),
    frames: await reader.readJson(entrypoints.frames as string),
    lasers: requireGameplay(gameplayDocuments, "laser-geometries-v4.json"),
    motionOperators: requireGameplay(gameplayDocuments, "motion-operators-v4.json"),
    narrativeManifest,
    observations: requireCatalog(narrativeDocuments, "snapshotObservations"),
    patterns: requireGameplay(gameplayDocuments, "executable-patterns-v4.json"),
    roomThresholds: requireCatalog(narrativeDocuments, "roomThresholds"),
    runDirector: requireGameplay(gameplayDocuments, "run-director-v4.json"),
    runMemoryExample,
    runMemorySchema,
    runtimeAccessibility: requireCatalog(runtimeDocuments, "accessibility"),
    runtimeBindings: requireCatalog(runtimeDocuments, "feedbackBindings"),
    runtimeContract: requireCatalog(runtimeDocuments, "contract"),
    runtimeEvents: requireCatalog(runtimeDocuments, "events"),
    runtimeMachines: requireCatalog(runtimeDocuments, "stateMachines"),
    runtimeManifest,
    semanticAliases: await reader.readJson(entrypoints.semanticAliases as string),
    uiCopy: requireCatalog(narrativeDocuments, "uiCopy"),
    uiLayouts: requireCatalog(narrativeDocuments, "uiLayouts"),
    witnessConditions: requireCatalog(narrativeDocuments, "witnessConditions"),
    weather: requireCatalog(narrativeDocuments, "weather"),
  };

  const counts = validateCanonicalCounts(packageManifest, animations, catalogs);
  checks.push(pass("content.canonical-counts", "23 canonical package counts pinned; 22 corroborated by reachable inventories and UI count pinned by package authority"));

  const universes = validateIdUniqueness(catalogs);
  checks.push(pass("content.id-uniqueness", `${Object.values(universes).reduce((sum, ids) => sum + ids.length, 0)} canonical IDs are unique in their namespaces`));

  validateReferences(catalogs, universes, declaredPaths, animationIndexPath);
  checks.push(pass("content.reference-closure", "gameplay, runtime, narrative, integration, visual and audio references are closed"));

  await validateDeclaredHashes(reader, gameplayIndexPath, gameplayFiles, catalogs, declaredPaths);
  checks.push(pass("content.declared-hashes", "gameplay index and asset-local byte/SHA-256 declarations match material files"));

  const physicalFiles = [...await source.listFiles()].map(normalizeContentPath).sort(compareText);
  validateFileUniverse(physicalFiles, checksumEntries, declaredPaths);
  checks.push(pass("integrity.file-universe", `${physicalFiles.length} physical files; ${checksumEntries.length} frozen rows; 3 explicit exclusions`));

  for (const entry of checksumEntries) {
    const bytes = await reader.readBytes(entry.path);
    const actual = sha256(bytes);
    if (actual !== entry.hash) {
      fail("INTEGRITY_HASH_MISMATCH", entry.path, `expected ${entry.hash}, received ${actual}`);
    }
  }
  checks.push(pass("integrity.sha256", `${checksumEntries.length} checksum rows verified`));

  const sortedEntrypoints = Object.fromEntries(sortedEntries(entrypoints).map(([key, value]) => [key, normalizeContentPath(value)]));
  const universeFacts = Object.fromEntries(
    sortedEntries(universes).map(([name, ids]) => [name, universeFact(ids)]),
  );
  const packageBytes = await reader.readBytes(PACKAGE_MANIFEST_PATH);
  const contentDigest = sha256(
    new TextEncoder().encode(checksumEntries.map((entry) => `${entry.hash}\0${entry.path}\n`).join("")),
  );
  const snapshotWithoutDigest = {
    schemaVersion: CONTENT_AUTHORITY_SCHEMA_VERSION as typeof CONTENT_AUTHORITY_SCHEMA_VERSION,
    packageId: packageManifest.id as string,
    packageSchemaVersion: "4.0.0" as const,
    packageManifest: PACKAGE_MANIFEST_PATH as typeof PACKAGE_MANIFEST_PATH,
    packageManifestSha256: sha256(packageBytes),
    checksumManifest: CHECKSUM_MANIFEST_PATH as typeof CHECKSUM_MANIFEST_PATH,
    checksumManifestSha256: sha256(checksumBytes),
    contentDigestSha256: contentDigest,
    checksumEntries: checksumEntries.length,
    checksumExclusions: [...CHECKSUM_EXCLUSIONS],
    authorityOrder: [...authorityOrder],
    entrypoints: sortedEntrypoints,
    counts,
    schemaVersions: Object.fromEntries([...schemaVersions.entries()].sort(([left], [right]) => compareText(left, right))),
    universes: universeFacts,
  };
  const snapshot: ContentAuthoritySnapshot = {
    ...snapshotWithoutDigest,
    snapshotDigestSha256: sha256(new TextEncoder().encode(stableStringify(snapshotWithoutDigest))),
  };
  return {
    schemaVersion: CONTENT_AUTHORITY_SCHEMA_VERSION,
    status: "PASS",
    checks,
    snapshot,
  };
}

export function contentAuthorityFailureReport(error: unknown): ContentAuthorityFailureReport {
  if (error instanceof ContentAuthorityError) {
    return {
      schemaVersion: CONTENT_AUTHORITY_SCHEMA_VERSION,
      status: "FAIL",
      error: {code: error.code, path: error.contentPath, detail: error.detail},
    };
  }
  const detail = error instanceof Error ? error.message : String(error);
  return {
    schemaVersion: CONTENT_AUTHORITY_SCHEMA_VERSION,
    status: "FAIL",
    error: {code: "INVALID_CONTENT", path: PACKAGE_MANIFEST_PATH, detail},
  };
}

export function stableStringify(value: unknown, indentation = 0): string {
  const canonicalize = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(canonicalize);
    if (isObject(entry)) {
      return Object.fromEntries(
        Object.entries(entry)
          .sort(([left], [right]) => compareText(left, right))
          .map(([key, child]) => [key, canonicalize(child)]),
      );
    }
    return entry;
  };
  return JSON.stringify(canonicalize(value), null, indentation);
}

function validateCanonicalCounts(
  packageManifest: JsonObject,
  animations: JsonObject,
  catalogs: Catalogs,
): Record<keyof typeof CANONICAL_V4_COUNTS, number> {
  const declared = requireNumberRecord(packageManifest.counts, `${PACKAGE_MANIFEST_PATH}.counts`);
  requireExactKeys(declared, Object.keys(CANONICAL_V4_COUNTS), `${PACKAGE_MANIFEST_PATH}.counts`);
  for (const [name, expected] of sortedEntries(CANONICAL_V4_COUNTS)) {
    const actual = declared[name];
    if (actual !== expected) fail("COUNT_MISMATCH", `${PACKAGE_MANIFEST_PATH}.counts.${name}`, `${actual} != canonical ${expected}`);
  }

  const axes = requireObject(catalogs.runtimeAccessibility.axes, "runtime.accessibility.axes");
  let accessibilityCombinations = 1;
  for (const [index, rawAxis] of Object.values(axes).entries()) {
    const axis = requireObject(rawAxis, `runtime.accessibility.axes[${index}]`);
    accessibilityCombinations *= requireArray(axis.values, `runtime.accessibility.axes[${index}].values`).length;
  }
  const bossRows = rows(catalogs.bosses, "rigs", "gameplay.bosses");
  const measured: Omit<Record<keyof typeof CANONICAL_V4_COUNTS, number>, "v4UiScreens"> = {
    accessibilityCombinations,
    atlases: rows(catalogs.atlases, "atlases", "v4.atlases").length,
    audioAssets: rows(catalogs.audio, "assets", "narrative.audio").length,
    baseBackgrounds: rows(catalogs.backgrounds, "baseComposites", "v4.backgrounds").length,
    bosses: bossRows.length,
    bossPhases: bossRows.reduce((sum, boss, index) => sum + rows(boss, "phases", `gameplay.bosses[${index}]`).length, 0),
    bossSequenceAnimations: rows(catalogs.animationIndex, "bossSequences", "gameplay.animations").length,
    enemyArchetypes: rows(catalogs.enemies, "enemies", "gameplay.enemies").length,
    executablePatterns: rows(catalogs.patterns, "patterns", "gameplay.patterns").length,
    laserTopologies: rows(catalogs.lasers, "lasers", "gameplay.lasers").length,
    legacyVisualClips: Object.keys(requireObject(animations.legacyVisualClips, "v4.animations.legacyVisualClips")).length,
    motionOperators: rows(catalogs.motionOperators, "operators", "gameplay.motionOperators").length,
    narrativeFeedbackCues: rows(catalogs.feedbackCues, "cues", "narrative.feedbackCues").length,
    patternAnimations: rows(catalogs.animationIndex, "patterns", "gameplay.animations").length,
    physicalFrames: rows(catalogs.frames, "frames", "v4.frames").length,
    reactionOverlays: rows(catalogs.backgrounds, "reactionOverlays", "v4.backgrounds").length,
    runtimeEvents: rows(catalogs.runtimeEvents, "events", "runtime.events").length,
    runtimeFeedbackBindings: rows(catalogs.runtimeBindings, "bindings", "runtime.bindings").length,
    runtimeStateSystems: rows(catalogs.runtimeMachines, "machines", "runtime.machines").length,
    snapshotObservations: rows(catalogs.observations, "observations", "narrative.observations").length,
    v4StateLibraries: requireArray(animations.v4StateLibraries, "v4.animations.v4StateLibraries").length,
    weatherTypes: Object.keys(requireObject(catalogs.weather.weather, "narrative.weather.weather")).length,
  };
  for (const [name, actual] of sortedEntries(measured)) {
    const expected = CANONICAL_V4_COUNTS[name as keyof typeof CANONICAL_V4_COUNTS];
    if (actual !== expected) fail("COUNT_MISMATCH", `inventory.${name}`, `${actual} != canonical ${expected}`);
  }
  // V4 exposes the UI screen count only in the signed package manifest. Unlike
  // gameplay/runtime/narrative inventories, it has no second canonical entrypoint.
  return Object.fromEntries(sortedEntries(CANONICAL_V4_COUNTS)) as Record<keyof typeof CANONICAL_V4_COUNTS, number>;
}

function validateIdUniqueness(catalogs: Catalogs): Record<string, string[]> {
  const universes: Record<string, string[]> = {
    atlases: uniqueIds(rows(catalogs.atlases, "atlases", "v4.atlases"), "id", "v4.atlases"),
    audioAssets: uniqueIds(rows(catalogs.audio, "assets", "narrative.audio"), "id", "narrative.audio"),
    bosses: uniqueIds(rows(catalogs.bosses, "rigs", "gameplay.bosses"), "id", "gameplay.bosses"),
    composers: uniqueIds(rows(catalogs.composers, "composers", "gameplay.composers"), "id", "gameplay.composers"),
    enemies: uniqueIds(rows(catalogs.enemies, "enemies", "gameplay.enemies"), "id", "gameplay.enemies"),
    frames: uniqueIds(rows(catalogs.frames, "frames", "v4.frames"), "semanticId", "v4.frames"),
    lasers: uniqueIds(rows(catalogs.lasers, "lasers", "gameplay.lasers"), "id", "gameplay.lasers"),
    motionOperators: uniqueIds(rows(catalogs.motionOperators, "operators", "gameplay.motionOperators"), "id", "gameplay.motionOperators"),
    narrativeCues: uniqueIds(rows(catalogs.feedbackCues, "cues", "narrative.feedbackCues"), "id", "narrative.feedbackCues"),
    observations: uniqueIds(rows(catalogs.observations, "observations", "narrative.observations"), "id", "narrative.observations"),
    patterns: uniqueIds(rows(catalogs.patterns, "patterns", "gameplay.patterns"), "id", "gameplay.patterns"),
    runtimeBindings: uniqueIds(rows(catalogs.runtimeBindings, "bindings", "runtime.bindings"), "id", "runtime.bindings"),
    runtimeEvents: uniqueIds(rows(catalogs.runtimeEvents, "events", "runtime.events"), "id", "runtime.events"),
    runtimeMachines: uniqueIds(rows(catalogs.runtimeMachines, "machines", "runtime.machines"), "id", "runtime.machines"),
  };
  uniqueIds(rows(catalogs.bossResolutions, "bosses", "narrative.bossResolutions"), "id", "narrative.bossResolutions");
  uniqueIds(rows(catalogs.bossResolutions, "bosses", "narrative.bossResolutions"), "resolutionId", "narrative.bossResolutionIds");
  uniqueIds(rows(catalogs.eventProjections, "rules", "integration.eventProjections"), "narrativeEvent", "integration.eventProjections");
  uniqueIds(rows(catalogs.witnessConditions, "states", "narrative.witnessConditions"), "id", "narrative.witnessConditions");
  uniqueIds(rows(catalogs.animationIndex, "patterns", "gameplay.animationPatterns"), "patternId", "gameplay.animationPatterns");
  uniqueIds(rows(catalogs.animationIndex, "bossSequences", "gameplay.animationBosses"), "bossId", "gameplay.animationBosses");
  uniqueIds(rows(catalogs.assetBindings, "narrativeCueResolvers", "integration.assetBindings.narrative"), "cueId", "integration.assetBindings.narrative");
  uniqueIds(rows(catalogs.assetBindings, "runtimeCueResolvers", "integration.assetBindings.runtime"), "bindingId", "integration.assetBindings.runtime");
  uniqueIds(rows(catalogs.backgrounds, "reactionOverlays", "v4.backgrounds.reactionOverlays"), "id", "v4.backgrounds.reactionOverlays");
  uniqueIds(rows(catalogs.entityVisualBindings, "enemies", "integration.entityVisual.enemies"), "entityId", "integration.entityVisual.enemies");
  uniqueIds(rows(catalogs.entityVisualBindings, "bosses", "integration.entityVisual.bosses"), "entityId", "integration.entityVisual.bosses");
  const thresholdIds = Object.values(requireObject(catalogs.roomThresholds.rooms, "narrative.roomThresholds.rooms"))
    .flatMap((room, index) => rows(requireObject(room, `narrative.roomThresholds.rooms[${index}]`), "thresholds", `narrative.roomThresholds.rooms[${index}]`));
  uniqueIds(thresholdIds, "id", "narrative.roomThresholds");
  return Object.fromEntries(sortedEntries(universes).map(([name, ids]) => [name, [...ids].sort(compareText)]));
}

function validateReferences(
  catalogs: Catalogs,
  universes: Record<string, string[]>,
  declaredPaths: Set<string>,
  animationIndexPath: string,
): void {
  const operatorIds = new Set(universes.motionOperators);
  const patternIds = new Set(universes.patterns);
  const enemyIds = new Set(universes.enemies);
  const bossIds = new Set(universes.bosses);
  const laserIds = new Set(universes.lasers);
  const eventIds = new Set(universes.runtimeEvents);
  const bindingIds = new Set(universes.runtimeBindings);
  const cueIds = new Set(universes.narrativeCues);
  const audioIds = new Set(universes.audioAssets);
  const frameIds = new Set(universes.frames);
  const atlasIds = new Set(universes.atlases);
  const runtimeBindingRows = rows(catalogs.runtimeBindings, "bindings", "runtime.bindings");
  const runtimeBindingsById = new Map(runtimeBindingRows.map((binding, index) => [
    requireString(binding.id, `runtime.bindings[${index}].id`),
    binding,
  ]));
  const cueRows = rows(catalogs.feedbackCues, "cues", "narrative.feedbackCues");
  const cuesById = new Map(cueRows.map((cue, index) => [
    requireString(cue.id, `narrative.feedbackCues[${index}].id`),
    cue,
  ]));

  for (const [index, pattern] of rows(catalogs.patterns, "patterns", "gameplay.patterns").entries()) {
    const label = `gameplay.patterns[${index}]`;
    for (const [emitterIndex, emitter] of rows(pattern, "emitters", `${label}.emitters`).entries()) {
      for (const [motionIndex, motion] of rows(emitter, "motionStack", `${label}.emitters[${emitterIndex}].motionStack`).entries()) {
        assertKnown(operatorIds, motion.operator, `${label}.emitters[${emitterIndex}].motionStack[${motionIndex}].operator`);
      }
    }
    if (typeof pattern.laserGeometry === "string") assertKnown(laserIds, pattern.laserGeometry, `${label}.laserGeometry`);
  }
  for (const [index, enemy] of rows(catalogs.enemies, "enemies", "gameplay.enemies").entries()) {
    const cadence = requireObject(enemy.cadence, `gameplay.enemies[${index}].cadence`);
    assertKnown(patternIds, cadence.patternId, `gameplay.enemies[${index}].cadence.patternId`);
  }
  for (const [index, composer] of rows(catalogs.composers, "composers", "gameplay.composers").entries()) {
    for (const [poolIndex, pool] of rows(composer, "patternPool", `gameplay.composers[${index}].patternPool`).entries()) {
      assertKnown(patternIds, pool.patternId, `gameplay.composers[${index}].patternPool[${poolIndex}].patternId`);
    }
  }
  for (const [index, phase] of rows(catalogs.runDirector, "phases", "gameplay.runDirector").entries()) {
    for (const [patternIndex, patternId] of requireOptionalStringArray(phase.patterns, `gameplay.runDirector.phases[${index}].patterns`).entries()) {
      assertKnown(patternIds, patternId, `gameplay.runDirector.phases[${index}].patterns[${patternIndex}]`);
    }
  }
  const encounterPool = requireObject(catalogs.encounterDirector.parallelEncounterPools, "gameplay.encounterDirector.parallelEncounterPools");
  for (const [poolName, rawPool] of sortedEntries(encounterPool)) {
    const pool = requireObject(rawPool, `gameplay.encounterDirector.parallelEncounterPools.${poolName}`);
    for (const [index, patternId] of requireStringArray(pool.patternIds, `gameplay.encounterDirector.parallelEncounterPools.${poolName}.patternIds`).entries()) {
      assertKnown(patternIds, patternId, `gameplay.encounterDirector.parallelEncounterPools.${poolName}.patternIds[${index}]`);
    }
  }
  for (const [index, boss] of rows(catalogs.bosses, "rigs", "gameplay.bosses").entries()) {
    for (const [phaseIndex, phase] of rows(boss, "phases", `gameplay.bosses[${index}].phases`).entries()) {
      assertKnown(patternIds, phase.patternId, `gameplay.bosses[${index}].phases[${phaseIndex}].patternId`);
      if (typeof phase.laserGeometry === "string") assertKnown(laserIds, phase.laserGeometry, `gameplay.bosses[${index}].phases[${phaseIndex}].laserGeometry`);
    }
  }
  for (const [index, laser] of rows(catalogs.lasers, "lasers", "gameplay.lasers").entries()) {
    assertKnown(bossIds, laser.bossId, `gameplay.lasers[${index}].bossId`);
  }
  const narrativeBossRows = rows(catalogs.bossResolutions, "bosses", "narrative.bossResolutions");
  const narrativeBossesById = new Map(narrativeBossRows.map((boss, index) => [
    `boss.${requireString(boss.id, `narrative.bossResolutions[${index}].id`)}`,
    boss,
  ]));
  for (const [index, boss] of rows(catalogs.bosses, "rigs", "gameplay.bosses").entries()) {
    const bossId = requireString(boss.id, `gameplay.bosses[${index}].id`);
    const narrativeBoss = narrativeBossesById.get(bossId);
    if (!narrativeBoss) fail("UNKNOWN_REFERENCE", `gameplay.bosses[${index}].id`, `${bossId} has no narrative resolution`);
    const resolution = requireObject(boss.resolution, `gameplay.bosses[${index}].resolution`);
    const parityFields: Array<[string, JsonValue | undefined, JsonValue | undefined]> = [
      ["resolutionId", resolution.resolutionId, narrativeBoss.resolutionId],
      ["condition", resolution.condition, narrativeBoss.condition],
      ["terminalEvent", resolution.terminalEvent, narrativeBoss.terminalEvent],
      ["materialRemainder", resolution.materialRemainder, narrativeBoss.materialRemainder],
    ];
    for (const [field, gameplayValue, narrativeValue] of parityFields) {
      if (!deepEqual(gameplayValue, narrativeValue)) {
        fail("UNKNOWN_REFERENCE", `gameplay.bosses[${index}].resolution.${field}`, "differs from narrative boss resolution authority");
      }
    }
    requireString(resolution.canonicalBossId, `gameplay.bosses[${index}].resolution.canonicalBossId`, bossId);
  }

  const usedRuntimeEvents = new Set<string>();
  for (const [machineIndex, machine] of rows(catalogs.runtimeMachines, "machines", "runtime.machines").entries()) {
    for (const [transitionIndex, transition] of rows(machine, "transitions", `runtime.machines[${machineIndex}].transitions`).entries()) {
      for (const [eventIndex, eventId] of requireStringArray(transition.events, `runtime.machines[${machineIndex}].transitions[${transitionIndex}].events`).entries()) {
        assertKnown(eventIds, eventId, `runtime.machines[${machineIndex}].transitions[${transitionIndex}].events[${eventIndex}]`);
        usedRuntimeEvents.add(eventId);
      }
    }
  }
  const unusedEvents = [...eventIds].filter((eventId) => !usedRuntimeEvents.has(eventId)).sort(compareText);
  if (unusedEvents.length) fail("ORPHAN_REFERENCE", "runtime.events", `events are not owned by a state machine: ${unusedEvents.join(", ")}`);

  for (const [index, binding] of runtimeBindingRows.entries()) {
    assertKnown(eventIds, binding.eventId, `runtime.bindings[${index}].eventId`);
  }
  const projectionEvents = new Set<string>();
  for (const [index, projection] of rows(catalogs.eventProjections, "rules", "integration.eventProjections").entries()) {
    const narrativeEvent = requireString(projection.narrativeEvent, `integration.eventProjections[${index}].narrativeEvent`);
    projectionEvents.add(narrativeEvent);
    for (const [sourceIndex, source] of requireStringArray(projection.canonicalSources, `integration.eventProjections[${index}].canonicalSources`).entries()) {
      assertKnown(eventIds, source, `integration.eventProjections[${index}].canonicalSources[${sourceIndex}]`);
    }
  }
  const cueEvents = new Set<string>();
  for (const [index, cue] of cueRows.entries()) {
    const event = requireString(cue.event, `narrative.feedbackCues[${index}].event`);
    cueEvents.add(event);
    const audio = cue.audio;
    if (typeof audio === "string" && audio !== "none" && audio !== "boss.{bossId}.signal") {
      assertKnown(audioIds, audio, `narrative.feedbackCues[${index}].audio`);
    }
  }
  assertSameSet(cueEvents, projectionEvents, "narrative.feedbackCues.event", "integration.eventProjections.narrativeEvent");

  const narrativeResolverIds = new Set<string>();
  for (const [index, resolver] of rows(catalogs.assetBindings, "narrativeCueResolvers", "integration.assetBindings.narrative").entries()) {
    const cueId = requireString(resolver.cueId, `integration.assetBindings.narrative[${index}].cueId`);
    assertKnown(cueIds, cueId, `integration.assetBindings.narrative[${index}].cueId`);
    narrativeResolverIds.add(cueId);
    const cue = cuesById.get(cueId);
    if (!cue) fail("UNKNOWN_REFERENCE", `integration.assetBindings.narrative[${index}].cueId`, cueId);
    requireString(resolver.event, `integration.assetBindings.narrative[${index}].event`, requireString(cue.event, `narrative.feedbackCues.${cueId}.event`));
    const frame = resolver.frame;
    if (typeof frame === "string") assertKnown(frameIds, frame, `integration.assetBindings.narrative[${index}].frame`);
    else if (isObject(frame)) assertFrameSelector(frame, frameIds, `integration.assetBindings.narrative[${index}].frame`);
    const audio = resolver.audio;
    if (typeof audio === "string" && audio !== "none") assertKnown(audioIds, audio, `integration.assetBindings.narrative[${index}].audio`);
    else if (isObject(audio)) assertAudioSelector(audio, audioIds, `integration.assetBindings.narrative[${index}].audio`);
  }
  assertSameSet(narrativeResolverIds, cueIds, "integration.assetBindings.narrativeCueResolvers", "narrative.feedbackCues");

  const runtimeResolverIds = new Set<string>();
  for (const [index, resolver] of rows(catalogs.assetBindings, "runtimeCueResolvers", "integration.assetBindings.runtime").entries()) {
    const bindingId = requireString(resolver.bindingId, `integration.assetBindings.runtime[${index}].bindingId`);
    assertKnown(bindingIds, bindingId, `integration.assetBindings.runtime[${index}].bindingId`);
    runtimeResolverIds.add(bindingId);
    const binding = runtimeBindingsById.get(bindingId);
    if (!binding) fail("UNKNOWN_REFERENCE", `integration.assetBindings.runtime[${index}].bindingId`, bindingId);
    const sink = requireObject(binding.sink, `runtime.bindings.${bindingId}.sink`);
    const kind = requireString(resolver.kind, `integration.assetBindings.runtime[${index}].kind`);
    requireString(resolver.eventId, `integration.assetBindings.runtime[${index}].eventId`, requireString(binding.eventId, `runtime.bindings.${bindingId}.eventId`));
    requireString(kind, `integration.assetBindings.runtime[${index}].kind`, requireString(sink.kind, `runtime.bindings.${bindingId}.sink.kind`));
    requireString(resolver.cueId, `integration.assetBindings.runtime[${index}].cueId`, requireString(sink.cueId, `runtime.bindings.${bindingId}.sink.cueId`));
    validateRuntimeAssetResolver(kind, resolver.resolver, frameIds, audioIds, catalogs.uiLayouts, `integration.assetBindings.runtime[${index}].resolver`);
    if (isObject(resolver.accessibilityFallback)) {
      validateRuntimeAssetResolver(kind, resolver.accessibilityFallback.resolver, frameIds, audioIds, catalogs.uiLayouts, `integration.assetBindings.runtime[${index}].accessibilityFallback.resolver`);
    }
  }
  assertSameSet(runtimeResolverIds, bindingIds, "integration.assetBindings.runtimeCueResolvers", "runtime.feedbackBindings");

  const visualEnemyIds = new Set<string>();
  for (const [index, visual] of rows(catalogs.entityVisualBindings, "enemies", "integration.entityVisual.enemies").entries()) {
    const entityId = requireString(visual.entityId, `integration.entityVisual.enemies[${index}].entityId`);
    assertKnown(enemyIds, entityId, `integration.entityVisual.enemies[${index}].entityId`);
    visualEnemyIds.add(entityId);
    for (const field of ["bodyFrame", "entryCueFrame", "movementCueFrame", "attackCueFrame", "shutdownCueFrame", "residueFrame"] as const) {
      assertKnown(frameIds, visual[field], `integration.entityVisual.enemies[${index}].${field}`);
    }
  }
  assertSameSet(visualEnemyIds, enemyIds, "integration.entityVisual.enemies", "gameplay.enemies");

  const visualBossIds = new Set<string>();
  for (const [index, visual] of rows(catalogs.entityVisualBindings, "bosses", "integration.entityVisual.bosses").entries()) {
    const entityId = requireString(visual.entityId, `integration.entityVisual.bosses[${index}].entityId`);
    assertKnown(bossIds, entityId, `integration.entityVisual.bosses[${index}].entityId`);
    visualBossIds.add(entityId);
    assertKnown(laserIds, visual.laserGeometryId, `integration.entityVisual.bosses[${index}].laserGeometryId`);
    assertKnown(audioIds, visual.audioSignalId, `integration.entityVisual.bosses[${index}].audioSignalId`);
    const rigReference = requireString(visual.gameplayRig, `integration.entityVisual.bosses[${index}].gameplayRig`);
    const [rigPath, rigFragment, ...extraFragments] = rigReference.split("#");
    if (extraFragments.length || normalizeContentPath(rigPath ?? "") !== "manifests/gameplay/boss-rigs-v4.json" || rigFragment !== entityId) {
      fail("UNKNOWN_REFERENCE", `integration.entityVisual.bosses[${index}].gameplayRig`, rigReference);
    }
    for (const [frameIndex, frameId] of requireStringArray(visual.baseFrames, `integration.entityVisual.bosses[${index}].baseFrames`).entries()) {
      assertKnown(frameIds, frameId, `integration.entityVisual.bosses[${index}].baseFrames[${frameIndex}]`);
    }
    for (const [frameIndex, frameId] of requireStringArray(visual.phaseFrames, `integration.entityVisual.bosses[${index}].phaseFrames`).entries()) {
      assertKnown(frameIds, frameId, `integration.entityVisual.bosses[${index}].phaseFrames[${frameIndex}]`);
    }
  }
  assertSameSet(visualBossIds, bossIds, "integration.entityVisual.bosses", "gameplay.bosses");

  const narrativeBossIds = new Set(rows(catalogs.bossResolutions, "bosses", "narrative.bossResolutions").map((boss, index) => `boss.${requireString(boss.id, `narrative.bossResolutions[${index}].id`)}`));
  assertSameSet(narrativeBossIds, bossIds, "narrative.bossResolutions", "gameplay.bosses");

  for (const [index, frame] of rows(catalogs.frames, "frames", "v4.frames").entries()) {
    assertKnown(atlasIds, frame.atlas, `v4.frames[${index}].atlas`);
    const semanticId = requireString(frame.semanticId, `v4.frames[${index}].semanticId`);
    if (typeof frame.id === "string" && frame.id !== semanticId) {
      fail("UNKNOWN_REFERENCE", `v4.frames[${index}].id`, `${frame.id} differs from semanticId ${semanticId}`);
    }
  }
  const frameCounts = new Map<string, number>();
  for (const frame of rows(catalogs.frames, "frames", "v4.frames")) {
    const atlas = frame.atlas as string;
    frameCounts.set(atlas, (frameCounts.get(atlas) ?? 0) + 1);
  }
  for (const atlasId of atlasIds) {
    if (frameCounts.get(atlasId) !== 64) fail("ORPHAN_REFERENCE", `v4.atlases.${atlasId}`, `${frameCounts.get(atlasId) ?? 0} frames; expected 64`);
  }

  for (const [groupName, rawAliases] of [
    ["readAliases", catalogs.semanticAliases.readAliases],
    ["deprecatedPhysicalFrames", catalogs.semanticAliases.deprecatedPhysicalFrames],
  ] as const) {
    const aliases = requireStringRecord(rawAliases, `v4.semanticAliases.${groupName}`);
    for (const [alias, target] of sortedEntries(aliases)) assertKnown(frameIds, target, `v4.semanticAliases.${groupName}.${alias}`);
  }

  const copyUniverse = new Set(Object.keys(requireObject(catalogs.uiCopy.copy, "narrative.uiCopy.copy")));
  const copyReferences = new Set<string>();
  collectUiCopyReferences(catalogs.uiLayouts, copyReferences);
  for (const copyReference of [...copyReferences].sort(compareText)) {
    assertKnown(copyUniverse, copyReference, `narrative.uiLayouts.copy:${copyReference}`);
  }

  const animationPatternIds = new Set(rows(catalogs.animationIndex, "patterns", "gameplay.animations").map((row) => row.patternId as string));
  const animationBossIds = new Set(rows(catalogs.animationIndex, "bossSequences", "gameplay.animations").map((row) => row.bossId as string));
  assertSameSet(animationPatternIds, patternIds, "gameplay.animations.patterns", "gameplay.patterns");
  assertSameSet(animationBossIds, bossIds, "gameplay.animations.bossSequences", "gameplay.bosses");
  const animationDirectory = posix.dirname(animationIndexPath);
  for (const [index, row] of rows(catalogs.animationIndex, "patterns", "gameplay.animations").entries()) {
    collectAnimationFiles(row, `${animationDirectory}/patterns`, `gameplay.animations.patterns[${index}]`, declaredPaths);
  }
  for (const [index, row] of rows(catalogs.animationIndex, "bossSequences", "gameplay.animations").entries()) {
    collectAnimationFiles(row, `${animationDirectory}/boss-sequences`, `gameplay.animations.bossSequences[${index}]`, declaredPaths);
  }
}

async function validateDeclaredHashes(
  reader: AuthorityReader,
  gameplayIndexPath: string,
  gameplayFiles: JsonValue[],
  catalogs: Catalogs,
  declaredPaths: Set<string>,
): Promise<void> {
  for (const [index, rawRow] of gameplayFiles.entries()) {
    const row = requireObject(rawRow, `${gameplayIndexPath}.files[${index}]`);
    const contentPath = resolveReference(gameplayIndexPath, requireString(row.path, `${gameplayIndexPath}.files[${index}].path`));
    await assertBytesAndHash(reader, contentPath, row, `${gameplayIndexPath}.files[${index}]`);
  }
  const externalAuthorities = requireArray((await reader.readJson(gameplayIndexPath)).externalAuthorities, `${gameplayIndexPath}.externalAuthorities`);
  if (externalAuthorities.length !== 1) fail("COUNT_MISMATCH", `${gameplayIndexPath}.externalAuthorities`, `${externalAuthorities.length} != 1`);
  const authority = requireObject(externalAuthorities[0], `${gameplayIndexPath}.externalAuthorities[0]`);
  const authorityPath = resolveReference(gameplayIndexPath, requireString(authority.path, `${gameplayIndexPath}.externalAuthorities[0].path`));
  declaredPaths.add(authorityPath);
  await assertHash(reader, authorityPath, requireString(authority.sha256, `${gameplayIndexPath}.externalAuthorities[0].sha256`));

  for (const [index, atlas] of rows(catalogs.atlases, "atlases", "v4.atlases").entries()) {
    const path = normalizeContentPath(requireString(atlas.file, `v4.atlases[${index}].file`));
    declaredPaths.add(path);
    await assertHash(reader, path, requireString(atlas.sha256, `v4.atlases[${index}].sha256`));
    const source = typeof atlas.source === "string" ? atlas.source : atlas.sourceSketch;
    if (typeof source === "string") declaredPaths.add(normalizeContentPath(source));
  }
  for (const collection of ["baseComposites", "reactionOverlays"] as const) {
    for (const [index, item] of rows(catalogs.backgrounds, collection, `v4.backgrounds.${collection}`).entries()) {
      const path = normalizeContentPath(requireString(item.file, `v4.backgrounds.${collection}[${index}].file`));
      declaredPaths.add(path);
      await assertHash(reader, path, requireString(item.sha256, `v4.backgrounds.${collection}[${index}].sha256`));
    }
  }
  for (const [index, asset] of rows(catalogs.audio, "assets", "narrative.audio").entries()) {
    const path = normalizeContentPath(requireString(asset.path, `narrative.audio.assets[${index}].path`));
    declaredPaths.add(path);
    await assertBytesAndHash(reader, path, asset, `narrative.audio.assets[${index}]`);
  }
}

function validateFileUniverse(
  physicalFiles: readonly string[],
  checksumEntries: readonly ChecksumEntry[],
  declaredPaths: ReadonlySet<string>,
): void {
  const physical = new Set(physicalFiles);
  const checksummed = new Set(checksumEntries.map((entry) => entry.path));
  for (const entry of checksumEntries) {
    if (!physical.has(entry.path)) fail("INTEGRITY_ORPHAN_ENTRY", entry.path, "checksum row has no physical file");
  }
  const exclusions = new Set<string>(CHECKSUM_EXCLUSIONS);
  for (const path of physicalFiles) {
    if (!checksummed.has(path) && !exclusions.has(path)) {
      fail("INTEGRITY_UNKNOWN_FILE", path, "physical file is absent from checksums-sha256.txt");
    }
  }
  for (const path of declaredPaths) {
    if (!physical.has(path)) fail("ORPHAN_REFERENCE", path, "declared content reference has no physical file");
  }
}

function parseChecksumManifest(text: string): ChecksumEntry[] {
  if (!text.endsWith("\n")) fail("INTEGRITY_INVALID_MANIFEST", CHECKSUM_MANIFEST_PATH, "must end with a newline");
  const entries: ChecksumEntry[] = [];
  const seen = new Set<string>();
  for (const [index, line] of text.slice(0, -1).split("\n").entries()) {
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
    if (!match) fail("INTEGRITY_INVALID_MANIFEST", `${CHECKSUM_MANIFEST_PATH}:${index + 1}`, "expected '<sha256><two spaces><path>'");
    const hash = match[1] as string;
    const path = normalizeContentPath(match[2] as string);
    if (new Set<string>(CHECKSUM_EXCLUSIONS).has(path)) {
      fail("INTEGRITY_INVALID_MANIFEST", `${CHECKSUM_MANIFEST_PATH}:${index + 1}`, `${path} is an explicit exclusion`);
    }
    if (seen.has(path)) fail("INTEGRITY_INVALID_MANIFEST", `${CHECKSUM_MANIFEST_PATH}:${index + 1}`, `duplicate path ${path}`);
    seen.add(path);
    entries.push({hash, path});
  }
  const sorted = [...entries].sort((left, right) => compareText(left.path, right.path));
  if (entries.some((entry, index) => entry.path !== sorted[index]?.path)) {
    fail("INTEGRITY_INVALID_MANIFEST", CHECKSUM_MANIFEST_PATH, "rows must be sorted by path");
  }
  return entries;
}

function validateJsonSchema(
  value: JsonValue,
  schema: JsonObject,
  rootSchema: JsonObject,
  valuePath: string,
  schemaOwnerPath: string,
): void {
  if (typeof schema.$ref === "string") {
    const target = resolveJsonPointer(rootSchema, schema.$ref, schemaOwnerPath);
    validateJsonSchema(value, target, rootSchema, valuePath, schemaOwnerPath);
    return;
  }
  if (Array.isArray(schema.oneOf)) {
    const accepted = schema.oneOf.filter((candidate) => {
      try {
        validateJsonSchema(value, requireObject(candidate, `${schemaOwnerPath}.oneOf`), rootSchema, valuePath, schemaOwnerPath);
        return true;
      } catch (error) {
        if (error instanceof ContentAuthorityError && error.code === "SCHEMA_MISMATCH") return false;
        throw error;
      }
    });
    if (accepted.length !== 1) schemaFail(schemaOwnerPath, valuePath, `oneOf matched ${accepted.length} branches`);
    return;
  }
  if (schema.type !== undefined && !matchesSchemaType(value, schema.type)) {
    schemaFail(schemaOwnerPath, valuePath, `expected type ${stableStringify(schema.type)}, received ${jsonType(value)}`);
  }
  if (Object.hasOwn(schema, "const") && !deepEqual(value, schema.const)) {
    schemaFail(schemaOwnerPath, valuePath, `does not equal const ${stableStringify(schema.const)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => deepEqual(candidate, value))) {
    schemaFail(schemaOwnerPath, valuePath, `value is outside enum`);
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) schemaFail(schemaOwnerPath, valuePath, `length ${value.length} < ${schema.minLength}`);
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) schemaFail(schemaOwnerPath, valuePath, `does not match ${schema.pattern}`);
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) schemaFail(schemaOwnerPath, valuePath, `${value} < minimum ${schema.minimum}`);
    if (typeof schema.maximum === "number" && value > schema.maximum) schemaFail(schemaOwnerPath, valuePath, `${value} > maximum ${schema.maximum}`);
    if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) schemaFail(schemaOwnerPath, valuePath, `${value} <= exclusiveMinimum ${schema.exclusiveMinimum}`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) schemaFail(schemaOwnerPath, valuePath, `${value.length} < minItems ${schema.minItems}`);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) schemaFail(schemaOwnerPath, valuePath, `${value.length} > maxItems ${schema.maxItems}`);
    if (schema.uniqueItems === true && new Set(value.map((entry) => stableStringify(entry))).size !== value.length) schemaFail(schemaOwnerPath, valuePath, "array items are not unique");
    if (Array.isArray(schema.prefixItems)) {
      for (const [index, childSchema] of schema.prefixItems.entries()) {
        const child = value[index];
        if (child !== undefined) validateJsonSchema(child, requireObject(childSchema, `${schemaOwnerPath}.prefixItems[${index}]`), rootSchema, `${valuePath}[${index}]`, schemaOwnerPath);
      }
    }
    if (isObject(schema.items)) {
      for (const [index, child] of value.entries()) validateJsonSchema(child, schema.items, rootSchema, `${valuePath}[${index}]`, schemaOwnerPath);
    }
  }
  if (isObject(value)) {
    const required = schema.required === undefined ? [] : requireStringArray(schema.required, `${schemaOwnerPath}.required`);
    for (const key of required) if (!Object.hasOwn(value, key)) schemaFail(schemaOwnerPath, valuePath, `missing required property ${key}`);
    const properties = schema.properties === undefined ? {} : requireObject(schema.properties, `${schemaOwnerPath}.properties`);
    if (schema.additionalProperties === false) {
      const unknown = Object.keys(value).filter((key) => !Object.hasOwn(properties, key));
      if (unknown.length) schemaFail(schemaOwnerPath, valuePath, `unknown properties: ${unknown.sort(compareText).join(", ")}`);
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) validateJsonSchema(value[key] as JsonValue, requireObject(childSchema, `${schemaOwnerPath}.properties.${key}`), rootSchema, `${valuePath}.${key}`, schemaOwnerPath);
    }
  }
}

function resolveJsonPointer(root: JsonObject, reference: string, schemaOwnerPath: string): JsonObject {
  if (!reference.startsWith("#/")) schemaFail(schemaOwnerPath, "$schema", `only local JSON pointers are supported: ${reference}`);
  let value: JsonValue = root;
  for (const encoded of reference.slice(2).split("/")) {
    const key = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isObject(value) || !Object.hasOwn(value, key)) schemaFail(schemaOwnerPath, "$schema", `unresolved $ref ${reference}`);
    value = value[key] as JsonValue;
  }
  return requireObject(value, `${schemaOwnerPath}:${reference}`);
}

function matchesSchemaType(value: JsonValue, type: JsonValue): boolean {
  if (Array.isArray(type)) return type.some((candidate) => typeof candidate === "string" && matchesSchemaType(value, candidate));
  if (typeof type !== "string") return false;
  switch (type) {
    case "array": return Array.isArray(value);
    case "boolean": return typeof value === "boolean";
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "null": return value === null;
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "object": return isObject(value);
    case "string": return typeof value === "string";
    default: return false;
  }
}

function validateDeclaredPath(path: string): string {
  if (path.includes("\\") || path.includes("\0") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    fail("INVALID_PATH", path, "content paths must be package-relative POSIX paths");
  }
  const normalized = posix.normalize(path);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized !== path) {
    fail("INVALID_PATH", path, `path must already be normalized (received ${normalized})`);
  }
  return normalized;
}

function normalizeContentPath(path: string): string {
  return validateDeclaredPath(path);
}

function resolveReference(ownerPath: string, reference: string): string {
  if (reference.includes("\\") || reference.includes("\0") || reference.startsWith("/") || /^[A-Za-z]:/.test(reference)) {
    fail("INVALID_PATH", `${ownerPath} -> ${reference}`, "reference must be a package-relative POSIX path");
  }
  const normalized = posix.normalize(posix.join(posix.dirname(ownerPath), reference));
  if (normalized === ".." || normalized.startsWith("../")) fail("INVALID_PATH", `${ownerPath} -> ${reference}`, "reference escapes package root");
  return normalizeContentPath(normalized);
}

function assertVersion(document: JsonObject, expected: string, contentPath: string, versions: Map<string, string>): void {
  const actual = requireString(document.schemaVersion, `${contentPath}.schemaVersion`);
  if (actual !== expected) fail("VERSION_MISMATCH", `${contentPath}.schemaVersion`, `${actual} != ${expected}`);
  versions.set(contentPath, actual);
}

function uniqueIds(items: readonly JsonObject[], field: string, label: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    const id = requireString(item[field], `${label}[${index}].${field}`);
    if (seen.has(id)) fail("DUPLICATE_ID", `${label}[${index}].${field}`, id);
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function assertKnown(universe: ReadonlySet<string>, rawValue: JsonValue | undefined, path: string): void {
  const value = requireString(rawValue, path);
  if (!universe.has(value)) fail("UNKNOWN_REFERENCE", path, value);
}

function assertSameSet(left: ReadonlySet<string>, right: ReadonlySet<string>, leftLabel: string, rightLabel: string): void {
  const missing = [...right].filter((value) => !left.has(value)).sort(compareText);
  const unknown = [...left].filter((value) => !right.has(value)).sort(compareText);
  if (unknown.length) fail("UNKNOWN_REFERENCE", leftLabel, `${unknown.join(", ")} absent from ${rightLabel}`);
  if (missing.length) fail("ORPHAN_REFERENCE", rightLabel, `${missing.join(", ")} absent from ${leftLabel}`);
}

function assertFrameSelector(selector: JsonObject, frameIds: ReadonlySet<string>, path: string): void {
  const fallback = requireString(selector.fallback, `${path}.fallback`);
  assertKnown(frameIds, fallback, `${path}.fallback`);
  requireString(selector.selector, `${path}.selector`);
}

function assertAudioSelector(selector: JsonObject, audioIds: ReadonlySet<string>, path: string): void {
  const fallback = requireString(selector.fallback, `${path}.fallback`);
  assertKnown(audioIds, fallback, `${path}.fallback`);
  requireString(selector.selector, `${path}.selector`);
}

function validateRuntimeAssetResolver(
  kind: string,
  rawResolver: JsonValue | undefined,
  frameIds: ReadonlySet<string>,
  audioIds: ReadonlySet<string>,
  uiLayouts: JsonObject,
  path: string,
): void {
  if (kind === "visual") {
    if (typeof rawResolver === "string") assertKnown(frameIds, rawResolver, path);
    else assertFrameSelector(requireObject(rawResolver, path), frameIds, path);
    return;
  }
  if (kind === "audio") {
    if (typeof rawResolver === "string") assertKnown(audioIds, rawResolver, path);
    else assertAudioSelector(requireObject(rawResolver, path), audioIds, path);
    return;
  }
  if (kind === "ui") {
    const resolver = requireString(rawResolver, path);
    const screenId = resolver.split(".", 1)[0] as string;
    const screens = requireObject(uiLayouts.screens, "narrative.uiLayouts.screens");
    if (!Object.hasOwn(screens, screenId)) fail("UNKNOWN_REFERENCE", path, `${resolver} names unknown UI screen ${screenId}`);
    return;
  }
  if (kind === "haptic") {
    requireObject(rawResolver, path);
    return;
  }
  fail("UNKNOWN_REFERENCE", path, `unknown feedback sink kind ${kind}`);
}

function collectUiCopyReferences(value: JsonValue, references: Set<string>): void {
  if (Array.isArray(value)) {
    for (const child of value) collectUiCopyReferences(child, references);
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if ((key === "labelCopy" || key === "copy" || key === "copyNote") && typeof child === "string") references.add(child);
    collectUiCopyReferences(child as JsonValue, references);
  }
}

function collectAnimationFiles(row: JsonObject, directory: string, label: string, declaredPaths: Set<string>): void {
  const files = requireStringRecord(row.files, `${label}.files`);
  requireExactKeys(files, ["apng", "gif", "timeline"], `${label}.files`);
  for (const reference of Object.values(files)) declaredPaths.add(normalizeContentPath(`${directory}/${reference}`));
}

function collectDeclaredFileRecord(value: JsonValue | undefined, label: string, declaredPaths: Set<string>): void {
  const record = requireStringRecord(value, label);
  for (const path of Object.values(record)) declaredPaths.add(normalizeContentPath(path));
}

async function assertBytesAndHash(reader: AuthorityReader, contentPath: string, row: JsonObject, label: string): Promise<void> {
  const bytes = await reader.readBytes(contentPath);
  const expectedBytes = requireNumber(row.bytes, `${label}.bytes`);
  if (bytes.byteLength !== expectedBytes) fail("INTEGRITY_SIZE_MISMATCH", contentPath, `${bytes.byteLength} != ${expectedBytes}`);
  await assertHash(reader, contentPath, requireString(row.sha256, `${label}.sha256`));
}

async function assertHash(reader: AuthorityReader, contentPath: string, expected: string): Promise<void> {
  if (!SHA256_PATTERN.test(expected)) fail("INTEGRITY_INVALID_MANIFEST", contentPath, `invalid declared SHA-256 ${expected}`);
  const actual = sha256(await reader.readBytes(contentPath));
  if (actual !== expected) fail("INTEGRITY_HASH_MISMATCH", contentPath, `expected ${expected}, received ${actual}`);
}

function rows(document: JsonObject, field: string, label: string): JsonObject[] {
  return requireArray(document[field], `${label}.${field}`).map((row, index) => requireObject(row, `${label}.${field}[${index}]`));
}

function requireGameplay(catalogs: Map<string, {document: JsonObject}>, name: string): JsonObject {
  const result = catalogs.get(name);
  if (!result) fail("ORPHAN_REFERENCE", `gameplay-index:${name}`, "declared gameplay file was not loaded");
  return result.document;
}

function requireCatalog(catalogs: Map<string, {document: JsonObject}>, name: string): JsonObject {
  const result = catalogs.get(name);
  if (!result) fail("ORPHAN_REFERENCE", name, "declared canonical file was not loaded");
  return result.document;
}

function requireExactKeys(record: object, expectedKeys: readonly string[], label: string): void {
  const actual = Object.keys(record).sort(compareText);
  const expected = [...expectedKeys].sort(compareText);
  const unknown = actual.filter((key) => !expected.includes(key));
  const missing = expected.filter((key) => !actual.includes(key));
  if (unknown.length) fail("UNKNOWN_CONTRACT_ENTRY", label, `unknown keys: ${unknown.join(", ")}`);
  if (missing.length) fail("ORPHAN_REFERENCE", label, `missing keys: ${missing.join(", ")}`);
}

function requireExactStrings(actualValues: readonly string[], expectedValues: readonly string[], label: string): void {
  const actual = [...actualValues].sort(compareText);
  const expected = [...expectedValues].sort(compareText);
  const unknown = actual.filter((value) => !expected.includes(value));
  const missing = expected.filter((value) => !actual.includes(value));
  if (new Set(actual).size !== actual.length) fail("DUPLICATE_ID", label, "list contains duplicates");
  if (unknown.length) fail("UNKNOWN_CONTRACT_ENTRY", label, `unknown values: ${unknown.join(", ")}`);
  if (missing.length) fail("ORPHAN_REFERENCE", label, `missing values: ${missing.join(", ")}`);
}

function requireObject(value: unknown, label: string): JsonObject {
  if (!isObject(value)) fail("INVALID_CONTENT", label, `expected object, received ${jsonType(value)}`);
  return value as JsonObject;
}

function requireArray(value: unknown, label: string): JsonValue[] {
  if (!Array.isArray(value)) fail("INVALID_CONTENT", label, `expected array, received ${jsonType(value)}`);
  return value as JsonValue[];
}

function requireString(value: unknown, label: string, expected?: string): string {
  if (typeof value !== "string" || value.length === 0) fail("INVALID_CONTENT", label, "expected non-empty string");
  if (expected !== undefined && value !== expected) fail("SCHEMA_MISMATCH", label, `${value} != ${expected}`);
  return value;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail("INVALID_CONTENT", label, "expected finite number");
  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  return requireArray(value, label).map((entry, index) => requireString(entry, `${label}[${index}]`));
}

function requireOptionalStringArray(value: unknown, label: string): string[] {
  return value === undefined ? [] : requireStringArray(value, label);
}

function requireStringRecord(value: unknown, label: string): Record<string, string> {
  const object = requireObject(value, label);
  return Object.fromEntries(Object.entries(object).map(([key, child]) => [key, requireString(child, `${label}.${key}`)]));
}

function requireNumberRecord(value: unknown, label: string): Record<string, number> {
  const object = requireObject(value, label);
  return Object.fromEntries(Object.entries(object).map(([key, child]) => [key, requireNumber(child, `${label}.${key}`)]));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function deepEqual(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

function schemaFail(schemaOwnerPath: string, valuePath: string, detail: string): never {
  fail("SCHEMA_MISMATCH", `${schemaOwnerPath}:${valuePath}`, detail);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function universeFact(ids: readonly string[]): ContentUniverseFact {
  const canonical = [...ids].sort(compareText);
  return {
    count: canonical.length,
    digestSha256: sha256(new TextEncoder().encode(canonical.map((id) => `${id}\n`).join(""))),
  };
}

function pass(id: string, detail: string): ContentAuthorityCheck {
  return {id, status: "PASS", detail};
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedEntries<T extends object>(record: T): Array<[string, T[keyof T]]> {
  return Object.entries(record).sort(([left], [right]) => compareText(left, right)) as Array<[string, T[keyof T]]>;
}

function fail(code: ContentAuthorityErrorCode, contentPath: string, detail: string): never {
  throw new ContentAuthorityError(code, contentPath, detail);
}
