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

/**
 * One pattern slot on a pack enemy. Mirrors `EnemyPattern` (`src/sim/enemy.ts`).
 */
export interface ContentEnemyPattern {
  pattern: string;
  options?: Record<string, unknown>;
  startAt?: number;
  stopAt?: number;
}

/**
 * A pack-format-2 enemy: the JSON that becomes an `EnemySpec` (`src/sim/enemy.ts`)
 * with no translation — the injector qualifies its name and hands the object to
 * `defineEnemy`. The shape is redeclared here rather than imported because this
 * module stays pure: a value **or type** import from `sim` would breach the
 * boundary `manifest.test.ts` proves by reading this file's own source. The two
 * shapes are kept in step by `inject.ts`, the single place that imports both and
 * assigns one to the other — a scalar-field drift there is a compile error.
 *
 * `motion`/`timeline` are typed loosely on purpose: their deep shape belongs to
 * the motion DSL, and validating it here would duplicate that model. Shape
 * validation checks the fields it owns; the injector resolves the names inside
 * (behaviours, patterns, item names) against the real registries.
 */
export interface ContentEnemy {
  sprite: string;
  hp: number;
  radius: number;
  width?: number;
  height?: number;
  motion?: Record<string, unknown>;
  timeline?: readonly Record<string, unknown>[];
  tint?: { r?: number; g?: number; b?: number };
  patterns?: readonly ContentEnemyPattern[];
  spoils?: readonly (readonly [name: string, count: number])[];
  scoreValue?: number;
  onHit?: string;
  onDeath?: string;
  despawnMargin?: number;
}

/**
 * A pack-format-2 wave. Mirrors `EnemyWave | BossWave` (`src/content/stage.ts`):
 * the two are distinguished structurally, a `boss` field making it a boss wave.
 */
export interface ContentStageWave {
  at: number;
  enemy?: string;
  boss?: string;
  x?: number;
  y?: number;
  count?: number;
  interval?: number;
  stepX?: number;
  stepY?: number;
}

/**
 * A pack-format-2 stage. Mirrors `StageSpec` (`src/content/stage.ts`) minus
 * `name` — the section key is the name — plus `entry`, which marks a campaign
 * start. `next: null` states "this is the last stage" explicitly, where a spec
 * uses `undefined`; the injector maps one to the other.
 */
export interface ContentStage {
  entry?: boolean;
  seed?: number;
  waves: readonly ContentStageWave[];
  outro?: number;
  boss?: string;
  next?: string | null;
  background?: string;
}

export interface PackContent {
  enemies?: Record<string, ContentEnemy>;
  stages?: Record<string, ContentStage>;
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
  /**
   * Declared engine capabilities. A capability the engine implements
   * (`IMPLEMENTED_CAPABILITIES`) is honoured; anything else is refused. Every
   * `content.*` section present must be covered by a matching capability here,
   * and vice versa — the covering invariant, which is what lets an engine that
   * lacks a capability refuse on `requires` before it ever parses `content`.
   */
  requires?: string[];
  /**
   * Format-2 game content — enemies and stages. Present only alongside the
   * matching `requires` entries. The injector (`inject.ts`) resolves the names
   * inside against the real registries and registers it; this module validates
   * shape only.
   */
  content?: PackContent;
}

export type ValidationResult =
  | { manifest: PackManifest }
  | { errors: string[] };

/**
 * Engine capabilities a `requires` entry may name. Each maps to one
 * `content.<section>`. This is the set that turned on when format-2 content
 * landed; a `requires` naming anything outside it is refused by name.
 */
export const IMPLEMENTED_CAPABILITIES = [
  'content.enemies',
  'content.stages',
] as const;

/** Top-level fields understood here, in the order the "valid fields" list prints. */
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
  'content',
] as const;

/**
 * Sections that belong to a later format. They are refused by name so an author
 * who read a later draft learns precisely what is fiction, rather than seeing a
 * generic "unknown field". `content` left this list when its enemies and stages
 * sections became real; the sections still reserved *inside* `content` are
 * `CONTENT_RESERVED`.
 */
const RESERVED_TOP = [
  'music',
  'difficulty',
  'dialog',
  'backgrounds',
] as const;

const ASSET_FIELDS = ['bullets', 'ship', 'filter'] as const;
const HUD_FIELDS = ['life', 'bomb'] as const;
/** Hud resources a later format will carry; refused by name today. */
const HUD_RESERVED = ['digits', 'font', 'bossBar', 'frame'] as const;

/** `content.*` sections this engine implements. */
const CONTENT_FIELDS = ['enemies', 'stages'] as const;
/** `content.*` sections a later format will carry; refused by name today. */
const CONTENT_RESERVED = [
  'bosses',
  'characters',
  'items',
  'music',
  'difficulty',
  'dialog',
  'backgrounds',
] as const;

const ENEMY_FIELDS = [
  'sprite',
  'hp',
  'radius',
  'width',
  'height',
  'motion',
  'timeline',
  'tint',
  'patterns',
  'spoils',
  'scoreValue',
  'onHit',
  'onDeath',
  'despawnMargin',
] as const;
const ENEMY_PATTERN_FIELDS = ['pattern', 'options', 'startAt', 'stopAt'] as const;
const STAGE_FIELDS = [
  'entry',
  'seed',
  'waves',
  'outro',
  'boss',
  'next',
  'background',
] as const;
const WAVE_FIELDS = [
  'at',
  'enemy',
  'boss',
  'x',
  'y',
  'count',
  'interval',
  'stepX',
  'stepY',
] as const;

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
    } else {
      const unimplemented = req.filter(
        (r) => !(IMPLEMENTED_CAPABILITIES as readonly string[]).includes(r),
      );
      if (unimplemented.length > 0) {
        errors.push(
          `${prefix}requires lists capabilities this engine does not implement: ${unimplemented.join(', ')} — implemented: ${IMPLEMENTED_CAPABILITIES.join(', ')}; see docs/packs.md §Future`,
        );
      }
    }
  }

  // --- assets (optional object) -----------------------------------------
  if ('assets' in raw) validateAssets(raw.assets, prefix, errors);

  // --- sounds (optional object) -----------------------------------------
  if ('sounds' in raw) validateSounds(raw.sounds, prefix, errors);

  // --- hud (optional object) --------------------------------------------
  if ('hud' in raw) validateHud(raw.hud, prefix, errors);

  // --- content (format-2 sections) + the requires↔content covering invariant
  validateContent(raw, prefix, errors);

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
 * Validate the `content` section and enforce the covering invariant.
 *
 * Two claims are checked together because they are one contract: every
 * `content.<section>` present must be declared in `requires`, and every
 * implemented capability declared in `requires` must have its section. That
 * exact agreement is what protects an older engine — it refuses on `requires`
 * before it ever parses `content`, so a section it cannot load can never appear
 * without a capability it will reject first.
 */
function validateContent(
  raw: Record<string, unknown>,
  prefix: string,
  errors: string[],
): void {
  const content = raw.content;
  const contentObj = isRecord(content) ? content : undefined;
  const req = Array.isArray(raw.requires)
    ? raw.requires.filter((r): r is string => typeof r === 'string')
    : [];

  for (const cap of IMPLEMENTED_CAPABILITIES) {
    const section = cap.slice('content.'.length);
    const declared = req.includes(cap);
    const present =
      contentObj !== undefined &&
      section in contentObj &&
      contentObj[section] !== undefined;
    if (declared && !present) {
      errors.push(
        `${prefix}requires lists "${cap}" but there is no content.${section} section — add the section or drop the capability`,
      );
    }
    if (present && !declared) {
      errors.push(
        `${prefix}content.${section} is present but "${cap}" is not in requires — an engine that lacks the capability must refuse on requires before parsing content`,
      );
    }
  }

  if (!('content' in raw)) return;
  if (!isRecord(content)) {
    errors.push(`${prefix}content must be a JSON object`);
    return;
  }

  for (const key of Object.keys(content)) {
    if ((CONTENT_FIELDS as readonly string[]).includes(key)) continue;
    if ((CONTENT_RESERVED as readonly string[]).includes(key)) {
      errors.push(
        `${prefix}content.${key} is a pack-format-2 section this engine does not implement — it implements ${IMPLEMENTED_CAPABILITIES.join(', ')} only; see docs/packs.md §Future`,
      );
      continue;
    }
    errors.push(unknownField(`${prefix}content: `, key, CONTENT_FIELDS));
  }

  if ('enemies' in content && content.enemies !== undefined) {
    validateEnemies(content.enemies, prefix, errors);
  }
  if ('stages' in content && content.stages !== undefined) {
    validateStages(content.stages, prefix, errors);
  }
}

function validateEnemies(enemies: unknown, prefix: string, errors: string[]): void {
  if (!isRecord(enemies)) {
    errors.push(`${prefix}content.enemies must be a JSON object`);
    return;
  }
  for (const [name, enemy] of Object.entries(enemies)) {
    validateEnemy(enemy, `content.enemies."${name}"`, prefix, errors);
  }
}

function validateEnemy(
  raw: unknown,
  where: string,
  prefix: string,
  errors: string[],
): void {
  if (!isRecord(raw)) {
    errors.push(`${prefix}${where} must be a JSON object`);
    return;
  }
  requireField(raw, 'sprite', 'string', where, prefix, errors, 'an atlas cell name');
  requireField(raw, 'hp', 'number', where, prefix, errors, 'a number');
  requireField(raw, 'radius', 'number', where, prefix, errors, 'a number');
  optField(raw, 'width', 'number', where, prefix, errors);
  optField(raw, 'height', 'number', where, prefix, errors);
  optField(raw, 'scoreValue', 'number', where, prefix, errors);
  optField(raw, 'despawnMargin', 'number', where, prefix, errors);
  optField(raw, 'onHit', 'string', where, prefix, errors);
  optField(raw, 'onDeath', 'string', where, prefix, errors);
  optField(raw, 'motion', 'object', where, prefix, errors);
  optField(raw, 'tint', 'object', where, prefix, errors);
  optField(raw, 'timeline', 'array', where, prefix, errors);

  if ('patterns' in raw) {
    if (!Array.isArray(raw.patterns)) {
      errors.push(`${prefix}${where}.patterns must be an array`);
    } else {
      raw.patterns.forEach((slot, i) =>
        validateEnemyPattern(slot, `${where}.patterns[${i}]`, prefix, errors),
      );
    }
  }

  if ('spoils' in raw) {
    if (!Array.isArray(raw.spoils)) {
      errors.push(`${prefix}${where}.spoils must be an array`);
    } else {
      raw.spoils.forEach((entry, i) => {
        if (
          !Array.isArray(entry) ||
          entry.length !== 2 ||
          typeof entry[0] !== 'string' ||
          typeof entry[1] !== 'number'
        ) {
          errors.push(
            `${prefix}${where}.spoils[${i}] must be a [name, count] pair — a string and a number`,
          );
        }
      });
    }
  }

  for (const key of Object.keys(raw)) {
    if ((ENEMY_FIELDS as readonly string[]).includes(key)) continue;
    errors.push(unknownField(`${prefix}${where}: `, key, ENEMY_FIELDS));
  }
}

function validateEnemyPattern(
  raw: unknown,
  where: string,
  prefix: string,
  errors: string[],
): void {
  if (!isRecord(raw)) {
    errors.push(`${prefix}${where} must be a JSON object`);
    return;
  }
  requireField(raw, 'pattern', 'string', where, prefix, errors, 'a registered pattern name');
  optField(raw, 'options', 'object', where, prefix, errors);
  optField(raw, 'startAt', 'number', where, prefix, errors);
  optField(raw, 'stopAt', 'number', where, prefix, errors);
  for (const key of Object.keys(raw)) {
    if ((ENEMY_PATTERN_FIELDS as readonly string[]).includes(key)) continue;
    errors.push(unknownField(`${prefix}${where}: `, key, ENEMY_PATTERN_FIELDS));
  }
}

function validateStages(stages: unknown, prefix: string, errors: string[]): void {
  if (!isRecord(stages)) {
    errors.push(`${prefix}content.stages must be a JSON object`);
    return;
  }
  for (const [name, stage] of Object.entries(stages)) {
    validateStage(stage, `content.stages."${name}"`, prefix, errors);
  }
}

function validateStage(
  raw: unknown,
  where: string,
  prefix: string,
  errors: string[],
): void {
  if (!isRecord(raw)) {
    errors.push(`${prefix}${where} must be a JSON object`);
    return;
  }
  optField(raw, 'entry', 'boolean', where, prefix, errors);
  optField(raw, 'seed', 'number', where, prefix, errors);
  optField(raw, 'outro', 'number', where, prefix, errors);
  optField(raw, 'boss', 'string', where, prefix, errors);
  optField(raw, 'background', 'string', where, prefix, errors);
  if ('next' in raw && typeof raw.next !== 'string' && raw.next !== null) {
    errors.push(`${prefix}${where}.next must be a string or null`);
  }

  if (!('waves' in raw)) {
    errors.push(`${prefix}${where} is missing required field "waves" — an array of waves`);
  } else if (!Array.isArray(raw.waves)) {
    errors.push(`${prefix}${where}.waves must be an array`);
  } else {
    raw.waves.forEach((wave, i) =>
      validateWave(wave, `${where}.waves[${i}]`, prefix, errors),
    );
  }

  for (const key of Object.keys(raw)) {
    if ((STAGE_FIELDS as readonly string[]).includes(key)) continue;
    errors.push(unknownField(`${prefix}${where}: `, key, STAGE_FIELDS));
  }
}

function validateWave(
  raw: unknown,
  where: string,
  prefix: string,
  errors: string[],
): void {
  if (!isRecord(raw)) {
    errors.push(`${prefix}${where} must be a JSON object`);
    return;
  }
  requireField(raw, 'at', 'number', where, prefix, errors, 'a whole tick count');

  const hasEnemy = 'enemy' in raw && raw.enemy !== undefined;
  const hasBoss = 'boss' in raw && raw.boss !== undefined;
  if (hasEnemy && hasBoss) {
    errors.push(
      `${prefix}${where} names both "enemy" and "boss" — a wave is one or the other`,
    );
  } else if (!hasEnemy && !hasBoss) {
    errors.push(`${prefix}${where} must name an "enemy" or a "boss"`);
  }
  optField(raw, 'enemy', 'string', where, prefix, errors);
  optField(raw, 'boss', 'string', where, prefix, errors);
  optField(raw, 'x', 'number', where, prefix, errors);
  optField(raw, 'y', 'number', where, prefix, errors);
  optField(raw, 'count', 'number', where, prefix, errors);
  optField(raw, 'interval', 'number', where, prefix, errors);
  optField(raw, 'stepX', 'number', where, prefix, errors);
  optField(raw, 'stepY', 'number', where, prefix, errors);

  for (const key of Object.keys(raw)) {
    if ((WAVE_FIELDS as readonly string[]).includes(key)) continue;
    errors.push(unknownField(`${prefix}${where}: `, key, WAVE_FIELDS));
  }
}

type FieldKind = 'string' | 'number' | 'boolean' | 'object' | 'array';

function typeMatches(value: unknown, kind: FieldKind): boolean {
  switch (kind) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isRecord(value);
  }
}

/** "must be a JSON object" reads better than "must be an object" for the record kind. */
function kindPhrase(kind: FieldKind): string {
  return kind === 'object' ? 'a JSON object' : kind === 'array' ? 'an array' : `a ${kind}`;
}

function requireField(
  raw: Record<string, unknown>,
  field: string,
  kind: FieldKind,
  where: string,
  prefix: string,
  errors: string[],
  hint: string,
): void {
  if (!(field in raw) || raw[field] === undefined) {
    errors.push(`${prefix}${where} is missing required field "${field}" — ${hint}`);
  } else if (!typeMatches(raw[field], kind)) {
    errors.push(`${prefix}${where}.${field} must be ${kindPhrase(kind)}`);
  }
}

function optField(
  raw: Record<string, unknown>,
  field: string,
  kind: FieldKind,
  where: string,
  prefix: string,
  errors: string[],
): void {
  if (field in raw && raw[field] !== undefined && !typeMatches(raw[field], kind)) {
    errors.push(`${prefix}${where}.${field} must be ${kindPhrase(kind)}`);
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
