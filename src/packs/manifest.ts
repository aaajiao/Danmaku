/**
 * The pure half of the pack system: manifest validation, index parsing, and
 * content hashing. Nothing here touches the DOM, the network, or a GL context,
 * and it imports no value from `render`, `sim`, `content` or `game` — pack
 * identity crosses those boundaries as a plain string. That is what lets every
 * rejection path be proved in `bun test`, headless (see `manifest.test.ts`).
 *
 * ## The error strings are the interface
 *
 * A pack author never sees this code; they see the strings it emits. So the
 * strings are golden — asserted verbatim in `manifest.test.ts`, and rewording
 * one is a breaking change. The `assets.bulets`-ships-silently failure class is
 * the one this repository is scarred by, so an unknown field is an ERROR with a
 * did-you-mean, never a warning nobody reads. The only exception is a reserved
 * future-format section, which is refused by name with a pointer rather than
 * guessed at.
 *
 * Validation is all-or-nothing per pack and collects every error, not the first
 * — a hand-editing author wants the whole list, and the loader rejects the pack
 * as a unit while the procedural placeholders carry on unaffected.
 */

/** Formats this engine can load. A list from day one so format 2 slots in. */
export const SUPPORTED_FORMATS: readonly number[] = [1];

/** The registered sound names a pack may replace. A pack file per name. */
export const SOUND_NAMES = [
  'shot',
  'hit',
  'explosion',
  'graze',
  'pickup',
  'death',
] as const;

export type SoundName = (typeof SOUND_NAMES)[number];

export interface PackAssets {
  /** 256×64 sheet, 8×2 cells of 32×32. Dimensions are checked in the loader. */
  bullets?: string;
  /** 64×64, one `ship` region. Dimensions are checked in the loader. */
  ship?: string;
  /** Sampling for both sheets. Default `nearest`, matching `loadTexture`. */
  filter?: 'nearest' | 'linear';
}

export type PackSounds = Partial<Record<SoundName, string>>;

export interface PackHud {
  /** Small icon PNG (≤ 16×16) drawn in place of the ♥ glyph. */
  life?: string;
  /** Small icon PNG (≤ 16×16) drawn in place of the ★ glyph. */
  bomb?: string;
}

export interface PackManifest {
  format: number;
  /** Must equal the pack's directory name and match `[a-z0-9-]{1,32}`. */
  name: string;
  version: string;
  author: string;
  /** Required: CLAUDE.md rule 9 — every shipped asset needs declared provenance. */
  license: string;
  description?: string;
  assets?: PackAssets;
  sounds?: PackSounds;
  hud?: PackHud;
  /** Declared engine capabilities. Format 1 implements none; any entry refuses. */
  requires?: string[];
}

export type ValidationResult =
  | { manifest: PackManifest }
  | { errors: string[] };

/** Top-level fields format 1 understands, in the order the "valid fields" list prints. */
const TOP_FIELDS = [
  'format',
  'name',
  'version',
  'author',
  'license',
  'description',
  'assets',
  'sounds',
  'hud',
  'requires',
] as const;

/**
 * Sections that belong to a later format. They are refused by name so an author
 * who read a format-2 draft learns precisely what is fiction, rather than seeing
 * a generic "unknown field".
 */
const RESERVED_TOP = [
  'content',
  'music',
  'difficulty',
  'dialog',
  'backgrounds',
] as const;

const ASSET_FIELDS = ['bullets', 'ship', 'filter'] as const;
const HUD_FIELDS = ['life', 'bomb'] as const;
/** Hud resources a later format will carry; refused by name today. */
const HUD_RESERVED = ['digits', 'font', 'bossBar', 'frame'] as const;

const NAME_PATTERN = /^[a-z0-9-]{1,32}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Levenshtein edit distance. Vendored rather than pulled in as a dependency:
 * the whole did-you-mean is a dozen lines and a package would be the larger risk.
 */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const row: number[] = [];
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0] as number;
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const above = row[j] as number;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(
        (row[j] as number) + 1,
        (row[j - 1] as number) + 1,
        prev + cost,
      );
      prev = above;
    }
  }
  return row[n] as number;
}

/** Nearest valid key within edit distance 2, or undefined if none is close. */
function nearest(key: string, valid: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of valid) {
    const d = editDistance(key, candidate);
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  return bestDistance <= 2 ? best : undefined;
}

/**
 * Validate a parsed manifest against `folderName`. The caller has already turned
 * bytes into JSON (a syntax error is reported before this runs); here `raw` is
 * whatever `JSON.parse` produced, of unknown shape.
 */
export function validateManifest(
  raw: unknown,
  folderName: string,
): ValidationResult {
  const prefix = `pack "${folderName}": pack.json: `;
  const errors: string[] = [];

  if (!isRecord(raw)) {
    return { errors: [`${prefix}the manifest root must be a JSON object`] };
  }

  // --- format ------------------------------------------------------------
  if (!('format' in raw)) {
    errors.push(
      `${prefix}missing required field "format" — expected 1 (this engine supports formats: ${SUPPORTED_FORMATS.join(', ')})`,
    );
  } else if (typeof raw.format !== 'number') {
    errors.push(
      `${prefix}field "format" must be a number — this engine supports formats: ${SUPPORTED_FORMATS.join(', ')}`,
    );
  } else if (!SUPPORTED_FORMATS.includes(raw.format)) {
    errors.push(
      `${prefix}format ${raw.format} is not supported — this engine supports formats: ${SUPPORTED_FORMATS.join(', ')}`,
    );
  }

  // --- name --------------------------------------------------------------
  if (!('name' in raw)) {
    errors.push(
      `${prefix}missing required field "name" — it must equal the directory name "${folderName}" and match [a-z0-9-]{1,32}`,
    );
  } else if (typeof raw.name !== 'string') {
    errors.push(`${prefix}field "name" must be a string`);
  } else if (raw.name !== folderName || !NAME_PATTERN.test(raw.name)) {
    errors.push(
      `${prefix}name "${raw.name}" must equal the directory name "${folderName}" and match [a-z0-9-]{1,32}`,
    );
  }

  // --- version / author --------------------------------------------------
  requireString(raw, 'version', `${prefix}missing required field "version" — a string, e.g. "1.0.0"`, prefix, errors);
  requireString(
    raw,
    'author',
    `${prefix}missing required field "author" — name the author (provenance; CLAUDE.md rule 9)`,
    prefix,
    errors,
  );

  // --- license (rule 9) --------------------------------------------------
  if (!('license' in raw)) {
    errors.push(
      `${prefix}missing required field "license" — state the provenance of this art (everything shipped must be original; CLAUDE.md rule 9)`,
    );
  } else if (typeof raw.license !== 'string') {
    errors.push(`${prefix}field "license" must be a string`);
  }

  // --- description (optional) -------------------------------------------
  if ('description' in raw && typeof raw.description !== 'string') {
    errors.push(`${prefix}field "description" must be a string`);
  }

  // --- requires (capability gate) ---------------------------------------
  if ('requires' in raw) {
    const req = raw.requires;
    if (!Array.isArray(req) || req.some((r) => typeof r !== 'string')) {
      errors.push(`${prefix}requires must be an array of strings`);
    } else if (req.length > 0) {
      errors.push(
        `${prefix}requires lists capabilities format 1 does not implement: ${req.join(', ')} — format 1 implements none; see docs/packs.md §Future`,
      );
    }
  }

  // --- assets (optional object) -----------------------------------------
  if ('assets' in raw) validateAssets(raw.assets, prefix, errors);

  // --- sounds (optional object) -----------------------------------------
  if ('sounds' in raw) validateSounds(raw.sounds, prefix, errors);

  // --- hud (optional object) --------------------------------------------
  if ('hud' in raw) validateHud(raw.hud, prefix, errors);

  // --- unknown / reserved top-level fields ------------------------------
  for (const key of Object.keys(raw)) {
    if ((TOP_FIELDS as readonly string[]).includes(key)) continue;
    if ((RESERVED_TOP as readonly string[]).includes(key)) {
      errors.push(
        `${prefix}${key} is a pack-format-2 section and this engine implements format 1 — nothing in it would load; see docs/packs.md §Future`,
      );
      continue;
    }
    errors.push(unknownField(prefix, key, TOP_FIELDS));
  }

  if (errors.length > 0) return { errors };
  return { manifest: raw as unknown as PackManifest };
}

function requireString(
  raw: Record<string, unknown>,
  field: string,
  missingMessage: string,
  prefix: string,
  errors: string[],
): void {
  if (!(field in raw)) {
    errors.push(missingMessage);
  } else if (typeof raw[field] !== 'string') {
    errors.push(`${prefix}field "${field}" must be a string`);
  }
}

function unknownField(
  prefix: string,
  key: string,
  valid: readonly string[],
): string {
  const suggestion = nearest(key, valid);
  return suggestion
    ? `${prefix}unknown field "${key}" — did you mean "${suggestion}"?`
    : `${prefix}unknown field "${key}" — valid fields here: ${valid.join(', ')}`;
}

function validateAssets(assets: unknown, prefix: string, errors: string[]): void {
  if (!isRecord(assets)) {
    errors.push(`${prefix}assets must be a JSON object`);
    return;
  }
  if ('bullets' in assets && typeof assets.bullets !== 'string') {
    errors.push(`${prefix}assets.bullets must be a string (a path to a PNG)`);
  }
  if ('ship' in assets && typeof assets.ship !== 'string') {
    errors.push(`${prefix}assets.ship must be a string (a path to a PNG)`);
  }
  if ('filter' in assets && assets.filter !== 'nearest' && assets.filter !== 'linear') {
    errors.push(`${prefix}assets.filter must be "nearest" or "linear"`);
  }
  for (const key of Object.keys(assets)) {
    if ((ASSET_FIELDS as readonly string[]).includes(key)) continue;
    errors.push(unknownField(prefix, key, ASSET_FIELDS));
  }
}

function validateSounds(sounds: unknown, prefix: string, errors: string[]): void {
  if (!isRecord(sounds)) {
    errors.push(`${prefix}sounds must be a JSON object`);
    return;
  }
  for (const key of Object.keys(sounds)) {
    if (!(SOUND_NAMES as readonly string[]).includes(key)) {
      errors.push(
        `${prefix}sounds."${key}" is not a sound this game plays — valid names: ${SOUND_NAMES.join(', ')}`,
      );
      continue;
    }
    if (typeof sounds[key] !== 'string') {
      errors.push(`${prefix}sounds.${key} must be a string (a path to a WAV)`);
    }
  }
}

function validateHud(hud: unknown, prefix: string, errors: string[]): void {
  if (!isRecord(hud)) {
    errors.push(`${prefix}hud must be a JSON object`);
    return;
  }
  if ('life' in hud && typeof hud.life !== 'string') {
    errors.push(`${prefix}hud.life must be a string (a path to a PNG)`);
  }
  if ('bomb' in hud && typeof hud.bomb !== 'string') {
    errors.push(`${prefix}hud.bomb must be a string (a path to a PNG)`);
  }
  for (const key of Object.keys(hud)) {
    if ((HUD_FIELDS as readonly string[]).includes(key)) continue;
    if ((HUD_RESERVED as readonly string[]).includes(key)) {
      errors.push(
        `${prefix}hud.${key} is a pack-format-2 resource and this engine implements format 1 — nothing in it would load; see docs/packs.md §Future`,
      );
      continue;
    }
    errors.push(unknownField(prefix, key, HUD_FIELDS));
  }
}

/**
 * Parse `/packs/index.json` — the synthesized listing of pack directory names.
 * The not-JSON case (an old server returning the HTML entry) is the caller's to
 * catch; here `raw` is already-parsed JSON of unknown shape, and the job is to
 * refuse anything that is not an array of strings.
 */
export function parseIndex(raw: unknown): string[] | { error: string } {
  if (!Array.isArray(raw)) {
    return { error: 'packs/index.json must be a JSON array of pack directory names' };
  }
  for (let i = 0; i < raw.length; i++) {
    if (typeof raw[i] !== 'string') {
      return { error: `packs/index.json[${i}] must be a string` };
    }
  }
  return raw as string[];
}

/**
 * SHA-256 over the manifest bytes followed by each loaded file's bytes, in the
 * order the manifest declared them, reduced to the first 12 hex characters. The
 * order is part of the identity — two packs with the same bytes in a different
 * order are different packs — which is why the bytes are concatenated rather than
 * combined commutatively. Presentation-only, so a replay mismatch warns; the
 * hash is what it warns about.
 */
export async function hashPack(
  manifestBytes: Uint8Array,
  files: readonly Uint8Array[],
): Promise<string> {
  let total = manifestBytes.length;
  for (const file of files) total += file.length;

  const buffer = new Uint8Array(total);
  let offset = 0;
  buffer.set(manifestBytes, offset);
  offset += manifestBytes.length;
  for (const file of files) {
    buffer.set(file, offset);
    offset += file.length;
  }

  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex.slice(0, 12);
}

/**
 * The replay-meta string: `name@hash` for each loaded pack, comma-joined, and
 * '' when none loaded. A plain string with no imports — it is recorded into
 * replay meta by `finishRecording` and compared on playback.
 */
export function packsMetaString(
  loaded: readonly { name: string; hash: string }[],
): string {
  return loaded.map((p) => `${p.name}@${p.hash}`).join(',');
}
