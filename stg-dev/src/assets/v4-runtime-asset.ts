const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

export interface V4RuntimeAsset {
  readonly id: string;
  readonly sourcePath: string;
  readonly sha256: string;
  readonly url: string;
  readonly size: readonly [number, number] | null;
}

interface BindV4RuntimeAssetsOptions<Entry> {
  readonly catalog: string;
  readonly entries: readonly Entry[];
  readonly urlsBySourcePath: Readonly<Record<string, string>>;
  readonly keyOf: (entry: Entry) => string;
  readonly idOf: (entry: Entry) => string;
  readonly sourcePathOf: (entry: Entry) => string;
  readonly sha256Of: (entry: Entry) => string;
  readonly sizeOf?: (entry: Entry) => readonly [number, number];
}

function validIdentity(value: string): boolean {
  return value.length > 0 && value.trim() === value;
}

function validSourcePath(value: string): boolean {
  return validIdentity(value)
    && !value.startsWith("/")
    && !value.split("/").includes("..");
}

/**
 * Joins literal Vite URL imports to their canonical manifest entries. The
 * manifest owns identity and metadata; this adapter owns only browser URLs.
 */
export function bindV4RuntimeAssets<Entry>(
  options: BindV4RuntimeAssetsOptions<Entry>,
): Readonly<Record<string, Readonly<V4RuntimeAsset>>> {
  const assets: Record<string, Readonly<V4RuntimeAsset>> = {};
  const manifestIds = new Set<string>();
  const manifestPaths = new Set<string>();

  for (const entry of options.entries) {
    const key = options.keyOf(entry);
    const id = options.idOf(entry);
    const sourcePath = options.sourcePathOf(entry);
    const sha256 = options.sha256Of(entry);
    if (!validIdentity(key) || !validIdentity(id)) {
      throw new Error(`${options.catalog} contains an invalid runtime identity`);
    }
    if (!validSourcePath(sourcePath)) {
      throw new Error(`${options.catalog} contains an invalid source path: ${sourcePath}`);
    }
    if (!SHA256_PATTERN.test(sha256)) {
      throw new Error(`${options.catalog} contains an invalid SHA-256 for ${id}`);
    }
    if (Object.hasOwn(assets, key)) {
      throw new Error(`${options.catalog} contains duplicate runtime key ${key}`);
    }
    if (manifestIds.has(id)) {
      throw new Error(`${options.catalog} contains duplicate manifest ID ${id}`);
    }
    if (manifestPaths.has(sourcePath)) {
      throw new Error(`${options.catalog} contains duplicate source path ${sourcePath}`);
    }
    const url = options.urlsBySourcePath[sourcePath];
    if (typeof url !== "string" || url.length === 0) {
      throw new Error(`${options.catalog} has no browser URL for ${sourcePath}`);
    }
    const rawSize = options.sizeOf?.(entry);
    if (
      rawSize !== undefined
      && (!Number.isInteger(rawSize[0]) || rawSize[0] <= 0
        || !Number.isInteger(rawSize[1]) || rawSize[1] <= 0)
    ) {
      throw new Error(`${options.catalog} contains an invalid size for ${id}`);
    }
    const size = rawSize === undefined
      ? null
      : Object.freeze([rawSize[0], rawSize[1]] as const);
    assets[key] = Object.freeze({id, sourcePath, sha256, url, size});
    manifestIds.add(id);
    manifestPaths.add(sourcePath);
  }

  for (const sourcePath of Object.keys(options.urlsBySourcePath)) {
    if (!manifestPaths.has(sourcePath)) {
      throw new Error(`${options.catalog} has an unbound browser URL for ${sourcePath}`);
    }
  }
  return Object.freeze(assets);
}

export function assertV4SchemaVersion(
  catalog: string,
  actual: string,
  expected: string,
): void {
  if (actual !== expected) {
    throw new Error(`${catalog} schema drifted: expected ${expected}, received ${actual}`);
  }
}
