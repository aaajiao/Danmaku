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
  'toll',
  'declare',
  'break',
  'clear',
  'ui-move',
  'ui-confirm',
  'ui-cancel',
  'ui-pause',
  'ui-advance',
] as const;

export type SoundName = (typeof SOUND_NAMES)[number];

/**
 * One animation strip in `assets.effects`: a per-file sheet of frames laid out
 * horizontally, frame 0 leftmost. Self-describing (graft B): the strip carries
 * its own geometry, so the engine never fixes a global frame count or size and
 * the import round adds a new animation by declaring one, not by editing a table.
 * Presentation — warn-only reskin material, exactly like the bullet sheet.
 */
export interface PackStrip {
  /** Sheet path, frames laid horizontally, frame 0 leftmost. */
  src: string;
  /** Frame count, a positive integer. */
  frames: number;
  frameW: number;
  frameH: number;
  /** Whole ticks per frame (rule 1). Default 1. */
  ticksPerFrame?: number;
  mode: 'loop' | 'once';
  /** Default `'tinted'` (white + engine tint); `'baked'` for coloured art. */
  color?: 'tinted' | 'baked';
  /**
   * The strip's un-margined painted content bound, px — the Law of Geometry seam
   * input (the asset-fidelity round). Additive and optional: it describes the
   * pack's OWN pixels (the painted box inside `frameW/H`), and the render seam
   * uses it to scale the quad to the engine's content size (`displayW =
   * engineContent × frameW / contentW`). Absent → the strip draws at native
   * `frameW/H`, exactly as before this field existed.
   */
  contentW?: number;
  contentH?: number;
}

/**
 * One native bullet strip on a self-describing shared sheet. Frame 0 sits at
 * `x,y` (offsets, NON-NEGATIVE — 0 is the sheet origin, where the legacy grid's
 * frame 0 sits); the rest are counts/sizes (positive). Because bullets stay one
 * texture / one batch, every native strip is packed onto ONE sheet with explicit
 * placement — the legacy 256×64 grid is the degenerate case.
 */
export interface PackBulletStrip {
  x: number;
  y: number;
  frameW: number;
  frameH: number;
  frames?: number;
  stride?: number;
  ticksPerFrame?: number;
  mode?: 'loop' | 'once';
  color?: 'tinted' | 'baked';
  /** Un-margined painted content bound, px — the Law of Geometry seam input
   *  (additive/optional; absent → native `frameW/H`). See `PackStrip.contentW`. */
  contentW?: number;
  contentH?: number;
}

/** The object form of `assets.bullets`: one shared PNG, every strip packed onto it. */
export interface PackBulletSheet {
  sheet: string;
  strips: Record<string, PackBulletStrip>;
}

/** The object form of `assets.ship`: a native strip bank in one PNG (no x/y). */
export interface PackShipStrip {
  src: string;
  frameW: number;
  frameH: number;
  frames?: number;
  stride?: number;
  ticksPerFrame?: number;
  mode?: 'loop' | 'once';
  color?: 'tinted' | 'baked';
  /** Un-margined painted content bound, px — the Law of Geometry seam input
   *  (additive/optional; absent → native `frameW/H`). See `PackStrip.contentW`. */
  contentW?: number;
  contentH?: number;
}

export interface PackAssets {
  /**
   * The bullet art. Either the legacy string (a 256×64 grid PNG, 8×2 cells of
   * 32×32 — UNCHANGED, still valid) OR a self-describing object of native strips
   * (native size and animation, the whole bullet atlas). Dimensions and per-frame
   * geometry are machine-checked in the loader.
   */
  bullets?: string | PackBulletSheet;
  /**
   * The ship art. Either the legacy string (a 64×64 `ship` region — UNCHANGED)
   * OR a native strip bank object drawn at frame 0 this round.
   */
  ship?: string | PackShipStrip;
  /** Sampling for the sheets. Default `nearest`, matching `loadTexture`. */
  filter?: 'nearest' | 'linear';
  /**
   * Per-file animation strips: a map of strip name → `PackStrip`. Warn-only
   * reskin material — the pixels of a floor-name reskin or a new strip; the
   * effect SPEC that names a strip is content, the pixels are not.
   */
  effects?: Record<string, PackStrip>;
  /**
   * Per-file LASER strips: a map of laser-strip name (a body like `beam.warm` or
   * a cap like `cap.yellow`, `src/render/laser-skin.ts`) → `PackStrip`. Structurally
   * identical to `effects` — one PNG per strip, frames laid horizontally — and
   * warn-only presentation for the same reason: a beam names its SKIN (content),
   * the pixels the skin wears are not. The laser system's own strips ride the
   * laser atlas (a third sheet), so they are a separate section from `effects`.
   */
  lasers?: Record<string, PackStrip>;
  /**
   * Per-file MISSILE body strips: a map of missile-body name (`missile.0` …
   * `missile.11`, `missile.massive`, `src/render/procedural.ts`) → `PackStrip`.
   * Structurally identical to `effects` and `lasers` — one PNG per strip, frames
   * laid horizontally — and warn-only presentation for the same reason: a bullet
   * names its missile body (content), the pixels the body wears are not. The
   * missile bodies ride the missile atlas (a fourth sheet), so they are a separate
   * section from `lasers`.
   */
  missiles?: Record<string, PackStrip>;
  /**
   * Per-file PICKUP body strips: a map of pickup-skin name (`pickup.coin.silver`,
   * `pickup.coin.gold`, `pickup.gem.*`, `pickup.bar`, `src/render/procedural.ts`)
   * → `PackStrip`. Structurally identical to `effects`, `lasers` and `missiles` —
   * one PNG per strip, frames laid horizontally — and warn-only presentation for
   * the same reason: an item names its pickup skin (content), the pixels the coin
   * or gem wears are not. The pickup skins ride the pickup atlas (a fifth sheet),
   * so they are a separate section from `missiles`.
   */
  pickups?: Record<string, PackStrip>;
}

export type PackSounds = Partial<Record<SoundName, string>>;

export interface PackHud {
  /** Small icon PNG (≤ 16×16) drawn in place of the ♥ glyph. */
  life?: string;
  /** Small icon PNG (≤ 16×16) drawn in place of the ★ glyph. */
  bomb?: string;
}

/**
 * One track in the top-level `music` section. A pack music track is presentation,
 * exactly like a `sounds` entry: a file the loader fetches and registers through
 * `defineMusic` (`src/audio/music.ts`). Unlike a sound, a track may name a **new**
 * name — one no built-in track carries — which registers namespaced (`<pack>/<name>`)
 * and can then be named by this pack's own `content.stages`/`content.bosses`
 * `music` field; a name that matches a built-in track (`menu`, and one per
 * built-in stage/boss) *replaces* that track's synthesised placeholder, last-wins.
 *
 * `loopStart`/`loopEnd` are the intro/loop split in seconds: playback runs from 0
 * so any intro plays once, then `[loopStart, loopEnd)` repeats forever. This module
 * checks only the shape it can without decoding — `loopStart < loopEnd`, both
 * non-negative. The `loopEnd ≤ duration` bound needs the decoded track, so the
 * loader measures it at load with the real duration in the error (the same split
 * as the sheet pixel checks: shape here, measured pixels/samples in the browser).
 */
export interface PackMusicTrack {
  /** Path to an audio file the browser can decode (a WAV, e.g.). */
  file: string;
  /** Loop region start, seconds. Default 0 (whole-track loop). Non-negative. */
  loopStart?: number;
  /** Loop region end, seconds. Default the track's end. Must exceed `loopStart`. */
  loopEnd?: number;
  /** Track gain, 0..1. The music bus already sits under the SFX; this trims within it. */
  volume?: number;
}

export type PackMusic = Record<string, PackMusicTrack>;

/**
 * The top-level `portraits` section: a map of portrait name → image file. A
 * portrait is presentation — the face the shell draws beside a dialogue line —
 * exactly like a `sounds` or `music` entry: a file the loader fetches,
 * dimension-checks against the shell's fixed cell size, and registers through
 * `definePortrait` (`src/render/portrait.ts`). A NEW name (one no built-in
 * portrait carries) registers namespaced `<pack>/<name>` and this pack's own
 * boss `dialogue` may then name it *bare* (pack-first resolution). Names are
 * open-ended — a pack invents its speakers — so this module checks only the
 * shape it owns: each value is a string path. The `PORTRAIT_SIZE` dimension
 * bound needs the decoded image, so the loader measures it (the same split as
 * the sheet pixel checks: shape here, measured pixels in the browser).
 */
export type PackPortraits = Record<string, string>;

/**
 * The difficulty tiers a pack may name — the closed union, mirrored from
 * `Difficulty` (`src/sim/difficulty.ts`). Redeclared here rather than imported
 * because this module stays pure (a value *or type* import from `sim` breaches
 * the boundary `manifest.test.ts` proves by reading this file's source); the two
 * are kept in step by `inject.ts`, which assigns one shape to the other.
 */
export type ContentDifficulty = 'easy' | 'normal' | 'hard' | 'lunatic';

/**
 * A pattern slot's sparse per-tier option overrides. `options` is the Normal
 * truth; each tier that differs names only the fields it changes, and the engine
 * shallow-merges them at instantiation (`mergeOptions`, `src/sim/difficulty.ts`).
 * The merge is one level deep — a nested object under a tier replaces the base
 * field whole, it is not merged into — so shape validation here checks only that
 * each key is a tier and each value an object; the deeper shape is the option's,
 * exactly as the base `options` is typed loosely.
 */
export type ContentDifficultyOverrides = Partial<
  Record<ContentDifficulty, Record<string, unknown>>
>;

/**
 * One pattern slot on a pack enemy. Mirrors `EnemyPattern` (`src/sim/enemy.ts`),
 * `difficulty` block included.
 */
export interface ContentEnemyPattern {
  pattern: string;
  options?: Record<string, unknown>;
  difficulty?: ContentDifficultyOverrides;
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
  /**
   * The track this stage is scored to (`StageSpec.music`), resolved pack-first
   * then built-in — the same legality as `background`. A bare string; the
   * injector resolves it against the pack's own music names ∪ the built-in ones.
   */
  music?: string;
}

/**
 * One pattern slot on a boss phase. Mirrors `PhasePattern` (`src/sim/boss.ts`),
 * whose shape is identical to a pack enemy's pattern slot — the same motion-DSL
 * vocabulary drives both, so the fields do not diverge.
 */
export interface ContentPhasePattern {
  pattern: string;
  options?: Record<string, unknown>;
  difficulty?: ContentDifficultyOverrides;
  startAt?: number;
  stopAt?: number;
}

/**
 * A pack-format-2 spell card. Mirrors `SpellCard` (`src/sim/boss.ts`) with one
 * deliberate substitution: **`hpSeconds` replaces `hp`**. Content states the unit
 * a designer thinks in — seconds a competent player needs — and the injector
 * computes `hp = phaseHp(hpSeconds)`. `timeLimit` (ticks) stays optional; absent,
 * the injector defaults it to `phaseClock(hp)`. This keeps the balance.test
 * coupling alive for pack content: a tuning constant no test can measure drifts
 * from the thing it describes, so pack bosses re-derive when `REFERENCE_DPS` moves.
 *
 * `motion`/`timeline` are typed loosely for the same reason `ContentEnemy`'s are:
 * their deep shape belongs to the motion DSL; the injector resolves the behaviour
 * names inside them against the real registry.
 */
export interface ContentSpellCard {
  name: string;
  /** SECONDS of intended drain, not ticks — the injector computes `hp = phaseHp(hpSeconds)`. */
  hpSeconds: number;
  /** Ticks before the phase times out. Absent means the injector's `phaseClock(hp)` default. */
  timeLimit?: number;
  /**
   * The tiers this card exists on (`SpellCard.difficulties`, `src/sim/boss.ts`).
   * Absent means every tier; listing tiers makes a Lunatic-only card the way the
   * genre ships them, `["lunatic"]`. The injector enforces the engine's rule that
   * every tier keeps at least one phase, so a gated card can never leave a boss
   * unfought on some tier.
   */
  difficulties?: readonly ContentDifficulty[];
  patterns: readonly ContentPhasePattern[];
  motion?: Record<string, unknown>;
  timeline?: readonly Record<string, unknown>[];
  bonus?: number;
  isSpell?: boolean;
  background?: string;
  /**
   * The card's own theme while it is active (`SpellCard.music`), resolved
   * pack-first then built-in — the same legality as `background`, and it overrides
   * the boss's track for this card's duration. A bare string; unset holds the
   * boss's own track.
   */
  music?: string;
}

/**
 * One line of a pre-fight exchange, mirroring `DialogueLine` (`src/sim/boss.ts`).
 * `speaker` is a PORTRAIT NAME — a registry name the shell resolves against
 * built-in portraits ∪ the pack's own `portraits` section (pack-first); the
 * simulation never learns portraits exist. `text` is the plain line spoken.
 * Redeclared here rather than imported so this module stays pure; `inject.ts`
 * assigns one shape to the other.
 */
export interface DialogueLine {
  speaker: string;
  text: string;
}

/**
 * A pack-format-2 boss: the JSON that becomes a `BossSpec` (`src/sim/boss.ts`).
 * Mirrors it field for field, except each phase is a `ContentSpellCard`
 * (`hpSeconds`, not `hp`). The injector qualifies its name, resolves the names
 * inside (patterns, backgrounds, the `onDeath` effect, spoils item names, and
 * each dialogue speaker's portrait), and hands the built spec to `defineBoss`.
 * Redeclared here rather than imported so this module stays pure; `inject.ts` is
 * the single place that assigns one shape to the other, where a scalar-field
 * drift is a compile error.
 */
export interface ContentBoss {
  sprite: string;
  radius: number;
  width?: number;
  height?: number;
  tint?: { r?: number; g?: number; b?: number };
  entry?: { x: number; y: number; ticks: number };
  phases: readonly ContentSpellCard[];
  onDeath?: string;
  spoils?: readonly (readonly [name: string, count: number])[];
  /**
   * The theme this boss holds across its cards (`BossSpec.music`), resolved
   * pack-first then built-in. Deliberately **boss-level, not per-phase**, unlike
   * `background`, which lives on each `ContentSpellCard`: a fight announces itself
   * with one theme on entry and keeps it, so the music belongs to the boss and not
   * to a card.
   */
  music?: string;
  /**
   * A pre-fight exchange (`BossSpec.dialogue`): when present and non-empty, the
   * Run enters a dialogue phase before this boss spawns, one line advanced per
   * fresh Shot press. Each speaker names a portrait resolved pack-first (the
   * pack's own `portraits` section) then built-in. Identical for every player
   * character in this format; a character with a `dialogueFor` entry gets that
   * exchange instead.
   */
  dialogue?: readonly DialogueLine[];
  /**
   * Per-character dialogue variants (`BossSpec.dialogueFor`). Keys are character
   * names — built-in ∪ this pack's own — and each value is an exchange used in
   * place of `dialogue` when that character flies the fight. Every speaker
   * validates exactly as `dialogue`'s does (portrait names, pack-first); an
   * unknown character key is a rejection. Unset means every character shares
   * `dialogue`.
   */
  dialogueFor?: Record<string, readonly DialogueLine[]>;
}

/**
 * One power tier of a pack shot. Mirrors `ShotSpec` (`src/sim/player.ts`). The
 * `spec` is a `BulletSpec` and `offsets` are muzzle vectors — both belong to the
 * bullet and motion models, whose deep shape this module does not own, so they
 * are typed loosely and the injector resolves the sprite and behaviour names
 * inside them against the real registries.
 */
export interface ContentShotSpec {
  spec: Record<string, unknown>;
  offsets: readonly Record<string, unknown>[];
  period: number;
}

/**
 * A pack-format-2 shot: the JSON that becomes a `ShotType` (`src/content/shots.ts`).
 * The section key is the name — as with enemies and stages, the shape omits it —
 * and the injector qualifies it and fills `ShotType.name`. A character equips a
 * shot by name; the injector resolves that reference and hands `defineCharacter`
 * the levels ladder in place (`CharacterSpec.player.shots`).
 */
export interface ContentShot {
  levels: readonly ContentShotSpec[];
  description?: string;
}

/**
 * A pack-format-2 option set: the JSON that becomes an `OptionSpec`
 * (`src/sim/option.ts`). `shot` is a `BulletSpec` and `levels` are slot layouts,
 * both typed loosely for the same reason `ContentShotSpec`'s are; the injector
 * resolves the two sprite names (`sprite`, `shot.style.sprite`) and any behaviour
 * names against the real registries.
 */
export interface ContentOptions {
  sprite: string;
  shot: Record<string, unknown>;
  period: number;
  levels: readonly (readonly Record<string, unknown>[])[];
  followSpeed?: number;
  tint?: { r?: number; g?: number; b?: number };
}

/**
 * A pack-format-2 bomb: the JSON that becomes a `BombSpec` (`src/sim/bomb.ts`),
 * mirrored field for field. `effect` names a particle effect resolved pack-first
 * then built-in; a character equips a bomb by name (`CharacterSpec.bomb`).
 */
export interface ContentBomb {
  duration: number;
  invulnTicks: number;
  damagePerTick: number;
  radius?: number;
  convertBullets?: boolean;
  effect?: string;
}

/**
 * A pack-format-2 effect: the JSON that becomes a `ParticleSpec`
 * (`src/sim/effects.ts`). Its `sprite` is validated against the injected
 * sprite-name set — the same set enemy and boss sprites resolve against. The
 * engine's own effects are declared through a `BulletCell`-typed seam that makes
 * the sprite a compile-time union; a pack has no compiler at author time, so that
 * union becomes a **runtime** check here, against the passed-in sprite list.
 */
export interface ContentEffect {
  sprite: string;
  count: number | { min: number; max: number };
  speed: number | { min: number; max: number };
  life: number | { min: number; max: number };
  spread?: number;
  direction?: number;
  drag?: number;
  gravity?: number;
  scale?: number | { from: number; to: number };
  alpha?: { from: number; to: number };
  spin?: number;
  tint?: { r?: number; g?: number; b?: number };
  additive?: boolean;
}

/**
 * A pack-format-2 item: the JSON that becomes an `ItemSpec` (`src/sim/item.ts`).
 *
 * `kind` is restricted to the engine's existing union — a new kind is a new game
 * *rule* (the game layer reads `kind` to decide what a pickup does), not pack
 * data, so an unfamiliar kind is refused by name. A pack item becomes droppable
 * by being named in some pack enemy's or boss's `spoils`, resolving pack-first.
 */
export interface ContentItem {
  sprite: string;
  radius: number;
  value: number;
  kind: 'power' | 'score' | 'life' | 'bomb';
  motion?: Record<string, unknown>;
  tint?: { r?: number; g?: number; b?: number };
  magnetSpeed?: number;
}

/**
 * A pack-format-2 character's ship stats. Mirrors `PlayerConfig`
 * (`src/sim/player.ts`) minus `bounds` (the run owns the field) and minus
 * `shots` — the character declares its weapon by name (`ContentCharacter.shot`)
 * and the injector fills the ladder in.
 */
export interface ContentPlayer {
  x: number;
  y: number;
  speed: number;
  focusSpeed: number;
  radius: number;
  grazeRadius: number;
  lives: number;
  bombs: number;
  invulnTicks: number;
  maxPower?: number;
}

/**
 * A pack-format-2 character: the JSON that becomes a `CharacterSpec`
 * (`src/game/run.ts`). Mirrors it except for the shot indirection — a built-in
 * character carries its shot table inline, but a pack **names** the shot
 * (`shot: "<name>"`, pack-first then built-in) and the injector resolves it via
 * the shot registry into `player.shots`. `options` and `bomb` are likewise names
 * resolved pack-first. A pack character appears on the SELECT screen exactly as a
 * built-in does, because that screen enumerates the registry it registers into.
 */
export interface ContentCharacter {
  label: string;
  shot: string;
  player: ContentPlayer;
  options: string;
  bomb: string;
  blurb?: string;
  sprite: string;
  width?: number;
  height?: number;
}

export interface PackContent {
  enemies?: Record<string, ContentEnemy>;
  stages?: Record<string, ContentStage>;
  bosses?: Record<string, ContentBoss>;
  shots?: Record<string, ContentShot>;
  characters?: Record<string, ContentCharacter>;
  options?: Record<string, ContentOptions>;
  bombs?: Record<string, ContentBomb>;
  effects?: Record<string, ContentEffect>;
  items?: Record<string, ContentItem>;
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
   * Background music tracks. A top-level presentation section, sibling to
   * `sounds` — a track is a file, not game data, so it lives here and not under
   * `content`; a stage or boss references one only by NAME (`content.stages`/
   * `content.bosses` `music`). The loader registers these through `defineMusic`.
   */
  music?: PackMusic;
  /**
   * Dialogue portrait images. A top-level presentation section, sibling to
   * `sounds` and `music` — a portrait is a file, not game data; a boss's
   * `content.bosses.<name>.dialogue` references one only by NAME. The loader
   * fetches, dimension-checks and registers these through `definePortrait`.
   */
  portraits?: PackPortraits;
  /**
   * Declared engine capabilities. A capability the engine implements
   * (`IMPLEMENTED_CAPABILITIES`) is honoured; anything else is refused. Every
   * `content.*` section present must be covered by a matching capability here,
   * and vice versa — the covering invariant, which is what lets an engine that
   * lacks a capability refuse on `requires` before it ever parses `content`.
   */
  requires?: string[];
  /**
   * Format-2 game content — enemies, stages, bosses, shots, characters,
   * options, bombs, effects and items. Present only alongside the matching
   * `requires` entries. The injector (`inject.ts`) resolves the names inside
   * against the real registries and registers it; this module validates shape
   * only.
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
  'content.bosses',
  'content.shots',
  'content.characters',
  'content.options',
  'content.bombs',
  'content.effects',
  'content.items',
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
  'music',
  'portraits',
  'requires',
  'content',
] as const;

/**
 * Sections that belong to a later format. They are refused by name so an author
 * who read a later draft learns precisely what is fiction, rather than seeing a
 * generic "unknown field". Names have left this list as the engine grew:
 * `content` when its enemies and stages sections became real, `music` when the
 * top-level `music` section did, `difficulty` when per-pattern tier overrides
 * became part of the content shapes, and `dialog` when boss dialogue landed
 * (`ContentBoss.dialogue`) and portraits became a real top-level `portraits`
 * section. What is left is not a future *content* kind at all but the one
 * permanent code line: `backgrounds` are shader code the engine owns, named by a
 * string and never shipped as pack data — the same boundary as patterns,
 * behaviours and sim rules. The sections still reserved *inside* `content` are
 * `CONTENT_RESERVED`.
 */
const RESERVED_TOP = ['backgrounds'] as const;

const ASSET_FIELDS = ['bullets', 'ship', 'filter', 'effects', 'lasers', 'missiles', 'pickups'] as const;
/** The fields of one native bullet strip (`PackBulletStrip`). x/y are offsets. */
const BULLET_STRIP_FIELDS = [
  'x',
  'y',
  'frameW',
  'frameH',
  'frames',
  'stride',
  'ticksPerFrame',
  'mode',
  'color',
  'contentW',
  'contentH',
] as const;
/** The fields of a native ship strip bank (`PackShipStrip`) — no x/y (one file). */
const SHIP_STRIP_FIELDS = [
  'src',
  'frameW',
  'frameH',
  'frames',
  'stride',
  'ticksPerFrame',
  'mode',
  'color',
  'contentW',
  'contentH',
] as const;
/** The fields of one `assets.effects` strip (`PackStrip`). */
const EFFECT_STRIP_FIELDS = [
  'src',
  'frames',
  'frameW',
  'frameH',
  'ticksPerFrame',
  'mode',
  'color',
  'contentW',
  'contentH',
] as const;
const MUSIC_TRACK_FIELDS = ['file', 'loopStart', 'loopEnd', 'volume'] as const;
const HUD_FIELDS = ['life', 'bomb'] as const;
/** Hud resources a later format will carry; refused by name today. */
const HUD_RESERVED = ['digits', 'font', 'bossBar', 'frame'] as const;

/** `content.*` sections this engine implements. */
const CONTENT_FIELDS = [
  'enemies',
  'stages',
  'bosses',
  'shots',
  'characters',
  'options',
  'bombs',
  'effects',
  'items',
] as const;
/**
 * `content.*` sections still refused by name. Only `backgrounds` remains, and it
 * is not a future *content* kind: a background is a shader — engine code, named
 * by a string, never pack data — so it stays reserved permanently, the same code
 * line as patterns, behaviours and sim rules. `dialog` left this list when boss
 * dialogue became real (`ContentBoss.dialogue`, with portraits a top-level
 * section); no pure-data content kind is reserved any longer. (Neither music nor
 * difficulty is here: music is a top-level presentation section, and difficulty
 * is not a `content` section at all — it lives inside pattern slots and spell
 * cards as a per-tier override — so `content.music`/`content.difficulty` read as
 * plain unknown fields, not reserved ones.)
 */
const CONTENT_RESERVED = ['backgrounds'] as const;

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
/** A pattern slot's fields — shared by a pack enemy and a pack boss phase. */
const PATTERN_SLOT_FIELDS = ['pattern', 'options', 'difficulty', 'startAt', 'stopAt'] as const;
const STAGE_FIELDS = [
  'entry',
  'seed',
  'waves',
  'outro',
  'boss',
  'next',
  'background',
  'music',
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
const BOSS_FIELDS = [
  'sprite',
  'radius',
  'width',
  'height',
  'tint',
  'entry',
  'phases',
  'onDeath',
  'spoils',
  'music',
  'dialogue',
  'dialogueFor',
] as const;
const BOSS_ENTRY_FIELDS = ['x', 'y', 'ticks'] as const;
/** The fields of one `dialogue` line — a speaker (portrait name) and its text. */
const DIALOGUE_LINE_FIELDS = ['speaker', 'text'] as const;
const SPELLCARD_FIELDS = [
  'name',
  'hpSeconds',
  'timeLimit',
  'difficulties',
  'patterns',
  'motion',
  'timeline',
  'bonus',
  'isSpell',
  'background',
  'music',
] as const;
const SHOT_FIELDS = ['levels', 'description'] as const;
const SHOT_LEVEL_FIELDS = ['spec', 'offsets', 'period'] as const;
const OPTIONS_FIELDS = ['sprite', 'shot', 'period', 'levels', 'followSpeed', 'tint'] as const;
const BOMB_FIELDS = [
  'duration',
  'invulnTicks',
  'damagePerTick',
  'radius',
  'convertBullets',
  'effect',
] as const;
const EFFECT_FIELDS = [
  'sprite',
  'count',
  'speed',
  'life',
  'spread',
  'direction',
  'drag',
  'gravity',
  'scale',
  'alpha',
  'spin',
  'tint',
  'additive',
] as const;
const ITEM_FIELDS = ['sprite', 'radius', 'value', 'kind', 'motion', 'tint', 'magnetSpeed'] as const;
const CHARACTER_FIELDS = [
  'label',
  'shot',
  'player',
  'options',
  'bomb',
  'blurb',
  'sprite',
  'width',
  'height',
] as const;
const PLAYER_FIELDS = [
  'x',
  'y',
  'speed',
  'focusSpeed',
  'radius',
  'grazeRadius',
  'lives',
  'bombs',
  'invulnTicks',
  'maxPower',
] as const;
/** The item kinds the game has rules for — an unfamiliar kind is refused by name. */
const ITEM_KINDS = ['power', 'score', 'life', 'bomb'] as const;
/** The difficulty tiers a pattern override or a card gate may name (`ContentDifficulty`). */
const DIFFICULTY_TIERS = ['easy', 'normal', 'hard', 'lunatic'] as const;

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

  // --- music (optional object) ------------------------------------------
  if ('music' in raw) validateMusic(raw.music, prefix, errors);

  // --- hud (optional object) --------------------------------------------
  if ('hud' in raw) validateHud(raw.hud, prefix, errors);

  // --- portraits (optional object) --------------------------------------
  if ('portraits' in raw) validatePortraits(raw.portraits, prefix, errors);

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

  // Either the legacy string (unchanged, still valid) or the new self-describing
  // object. The verbatim "must be a string" error is KEPT for the neither case
  // (e.g. a number) — a compatibility-contract string asserted in manifest.test;
  // the object form is a new legal branch with new strings.
  if ('bullets' in assets) {
    if (typeof assets.bullets === 'string') {
      // legacy grid — ok
    } else if (isRecord(assets.bullets)) {
      validateBulletSheet(assets.bullets, prefix, errors);
    } else {
      errors.push(`${prefix}assets.bullets must be a string (a path to a PNG)`);
    }
  }

  if ('ship' in assets) {
    if (typeof assets.ship === 'string') {
      // legacy 64×64 — ok
    } else if (isRecord(assets.ship)) {
      validateShipStrip(assets.ship, prefix, errors);
    } else {
      errors.push(`${prefix}assets.ship must be a string (a path to a PNG)`);
    }
  }

  if ('filter' in assets && assets.filter !== 'nearest' && assets.filter !== 'linear') {
    errors.push(`${prefix}assets.filter must be "nearest" or "linear"`);
  }

  if ('effects' in assets && assets.effects !== undefined) {
    validateEffectStrips(assets.effects, prefix, errors);
  }

  if ('lasers' in assets && assets.lasers !== undefined) {
    validateLaserStrips(assets.lasers, prefix, errors);
  }

  if ('missiles' in assets && assets.missiles !== undefined) {
    validateMissileStrips(assets.missiles, prefix, errors);
  }

  if ('pickups' in assets && assets.pickups !== undefined) {
    validatePickupStrips(assets.pickups, prefix, errors);
  }

  for (const key of Object.keys(assets)) {
    if ((ASSET_FIELDS as readonly string[]).includes(key)) continue;
    errors.push(unknownField(prefix, key, ASSET_FIELDS));
  }
}

/** A non-negative integer field (an x/y offset — 0 is the sheet origin). */
function stripOffset(
  raw: Record<string, unknown>,
  field: string,
  where: string,
  prefix: string,
  errors: string[],
): void {
  const v = raw[field];
  if (v === undefined) return;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    errors.push(`${prefix}${where}.${field} must be a non-negative integer`);
  }
}

/** A positive integer field (a size or count — 0 is never legal). */
function stripCount(
  raw: Record<string, unknown>,
  field: string,
  where: string,
  prefix: string,
  errors: string[],
  required: boolean,
): void {
  const v = raw[field];
  if (v === undefined) {
    if (required) errors.push(`${prefix}${where}.${field} must be a positive integer`);
    return;
  }
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
    errors.push(`${prefix}${where}.${field} must be a positive integer`);
  }
}

/** `mode` / `color` enum fields, shared by every strip surface. */
function stripEnums(
  raw: Record<string, unknown>,
  where: string,
  prefix: string,
  errors: string[],
  modeRequired: boolean,
): void {
  if (modeRequired ? 'mode' in raw : 'mode' in raw && raw.mode !== undefined) {
    if (raw.mode !== 'loop' && raw.mode !== 'once') {
      errors.push(`${prefix}${where}.mode must be "loop" or "once"`);
    }
  } else if (modeRequired) {
    errors.push(`${prefix}${where}.mode must be "loop" or "once"`);
  }
  if ('color' in raw && raw.color !== undefined && raw.color !== 'tinted' && raw.color !== 'baked') {
    errors.push(`${prefix}${where}.color must be "tinted" or "baked"`);
  }
}

/** `stride >= frameW`, when both are present and numbers. */
function stripStride(raw: Record<string, unknown>, where: string, prefix: string, errors: string[]): void {
  const { stride, frameW } = raw;
  if (typeof stride === 'number' && typeof frameW === 'number' && stride < frameW) {
    errors.push(`${prefix}${where}.stride ${stride} must be at least frameW ${frameW}`);
  }
}

/** The object form of `assets.bullets`: `{ sheet, strips }`, every strip native. */
function validateBulletSheet(sheet: Record<string, unknown>, prefix: string, errors: string[]): void {
  if (typeof sheet.sheet !== 'string') {
    errors.push(`${prefix}assets.bullets.sheet must be a string (a path to the shared PNG)`);
  }
  if (!('strips' in sheet) || !isRecord(sheet.strips)) {
    errors.push(`${prefix}assets.bullets.strips must be a JSON object of name → strip`);
  } else {
    for (const [key, strip] of Object.entries(sheet.strips)) {
      const where = `assets.bullets.strips."${key}"`;
      if (!isRecord(strip)) {
        errors.push(`${prefix}${where} must be a JSON object`);
        continue;
      }
      stripOffset(strip, 'x', where, prefix, errors);
      stripOffset(strip, 'y', where, prefix, errors);
      stripCount(strip, 'frameW', where, prefix, errors, true);
      stripCount(strip, 'frameH', where, prefix, errors, true);
      stripCount(strip, 'frames', where, prefix, errors, false);
      stripCount(strip, 'stride', where, prefix, errors, false);
      stripCount(strip, 'ticksPerFrame', where, prefix, errors, false);
      stripCount(strip, 'contentW', where, prefix, errors, false);
      stripCount(strip, 'contentH', where, prefix, errors, false);
      stripStride(strip, where, prefix, errors);
      stripEnums(strip, where, prefix, errors, false);
      for (const field of Object.keys(strip)) {
        if ((BULLET_STRIP_FIELDS as readonly string[]).includes(field)) continue;
        errors.push(unknownField(`${prefix}${where}: `, field, BULLET_STRIP_FIELDS));
      }
    }
  }
  for (const field of Object.keys(sheet)) {
    if (field === 'sheet' || field === 'strips') continue;
    errors.push(unknownField(`${prefix}assets.bullets: `, field, ['sheet', 'strips']));
  }
}

/** The object form of `assets.ship`: a native strip bank in one file. */
function validateShipStrip(ship: Record<string, unknown>, prefix: string, errors: string[]): void {
  const where = 'assets.ship';
  if (typeof ship.src !== 'string') {
    errors.push(`${prefix}assets.ship.src must be a string (a path to a PNG)`);
  }
  stripCount(ship, 'frameW', where, prefix, errors, true);
  stripCount(ship, 'frameH', where, prefix, errors, true);
  stripCount(ship, 'frames', where, prefix, errors, false);
  stripCount(ship, 'stride', where, prefix, errors, false);
  stripCount(ship, 'ticksPerFrame', where, prefix, errors, false);
  stripCount(ship, 'contentW', where, prefix, errors, false);
  stripCount(ship, 'contentH', where, prefix, errors, false);
  stripStride(ship, where, prefix, errors);
  stripEnums(ship, where, prefix, errors, false);
  for (const field of Object.keys(ship)) {
    if ((SHIP_STRIP_FIELDS as readonly string[]).includes(field)) continue;
    errors.push(unknownField(`${prefix}${where}: `, field, SHIP_STRIP_FIELDS));
  }
}

/** `assets.effects`: a map of strip name → `PackStrip`. */
function validateEffectStrips(effects: unknown, prefix: string, errors: string[]): void {
  validatePackStripMap(effects, 'effects', prefix, errors);
}

/**
 * `assets.lasers` — the laser body/cap strips. Structurally identical to
 * `assets.effects` (one PNG per strip, the `PackStrip` shape), so it runs the
 * same per-strip validation, only the section name differs in the messages.
 */
function validateLaserStrips(lasers: unknown, prefix: string, errors: string[]): void {
  validatePackStripMap(lasers, 'lasers', prefix, errors);
}

/**
 * `assets.missiles` — the missile body strips. Structurally identical to
 * `assets.effects` and `assets.lasers` (one PNG per strip, the `PackStrip` shape),
 * so it runs the same per-strip validation, only the section name differs in the
 * messages.
 */
function validateMissileStrips(missiles: unknown, prefix: string, errors: string[]): void {
  validatePackStripMap(missiles, 'missiles', prefix, errors);
}

/**
 * `assets.pickups` — the coin/gem/bar body strips. Structurally identical to
 * `assets.effects`, `assets.lasers` and `assets.missiles` (one PNG per strip, the
 * `PackStrip` shape), so it runs the same per-strip validation, only the section
 * name differs in the messages.
 */
function validatePickupStrips(pickups: unknown, prefix: string, errors: string[]): void {
  validatePackStripMap(pickups, 'pickups', prefix, errors);
}

/**
 * The shared `Record<string, PackStrip>` validation behind `assets.effects`,
 * `assets.lasers`, `assets.missiles` and `assets.pickups`. Factored out so the
 * sections cannot drift; the section name is the only thing that varies, so the
 * effect strings the compatibility contract pins (`assets.effects.…`) are
 * byte-identical to before.
 */
function validatePackStripMap(
  strips: unknown,
  section: 'effects' | 'lasers' | 'missiles' | 'pickups',
  prefix: string,
  errors: string[],
): void {
  if (!isRecord(strips)) {
    errors.push(`${prefix}assets.${section} must be a JSON object`);
    return;
  }
  for (const [key, strip] of Object.entries(strips)) {
    const where = `assets.${section}.${key}`;
    if (!isRecord(strip)) {
      errors.push(`${prefix}${where} must be a JSON object`);
      continue;
    }
    if (typeof strip.src !== 'string') {
      errors.push(`${prefix}${where}.src must be a string (a path to a PNG)`);
    }
    // The two golden effect strings from design §5, verbatim.
    stripCount(strip, 'frames', where, prefix, errors, true);
    stripCount(strip, 'frameW', where, prefix, errors, true);
    stripCount(strip, 'frameH', where, prefix, errors, true);
    stripCount(strip, 'ticksPerFrame', where, prefix, errors, false);
    stripCount(strip, 'contentW', where, prefix, errors, false);
    stripCount(strip, 'contentH', where, prefix, errors, false);
    stripEnums(strip, where, prefix, errors, true);
    for (const field of Object.keys(strip)) {
      if ((EFFECT_STRIP_FIELDS as readonly string[]).includes(field)) continue;
      errors.push(unknownField(`${prefix}${where}: `, field, EFFECT_STRIP_FIELDS));
    }
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

/**
 * The top-level `music` section: a map of track name → `{file, loopStart?,
 * loopEnd?, volume?}`. Shape only — the `loopEnd ≤ duration` bound needs the
 * decoded track, so it is the loader's, measured with the real duration. Here:
 * `file` required, the loop points non-negative numbers, and `loopStart < loopEnd`
 * when both are given (a reversed or empty region is an author error, caught
 * before a byte is fetched).
 */
function validateMusic(music: unknown, prefix: string, errors: string[]): void {
  if (!isRecord(music)) {
    errors.push(`${prefix}music must be a JSON object`);
    return;
  }
  for (const [key, track] of Object.entries(music)) {
    const where = `music."${key}"`;
    if (!isRecord(track)) {
      errors.push(`${prefix}${where} must be a JSON object`);
      continue;
    }
    if (!('file' in track) || track.file === undefined) {
      errors.push(`${prefix}${where} is missing required field "file" — a path to an audio file`);
    } else if (typeof track.file !== 'string') {
      errors.push(`${prefix}${where}.file must be a string (a path to an audio file)`);
    }
    validateLoopPoint(track, 'loopStart', where, prefix, errors);
    validateLoopPoint(track, 'loopEnd', where, prefix, errors);
    if ('volume' in track && typeof track.volume !== 'number') {
      errors.push(`${prefix}${where}.volume must be a number`);
    }
    const { loopStart, loopEnd } = track;
    if (
      typeof loopStart === 'number' &&
      typeof loopEnd === 'number' &&
      !(loopStart < loopEnd)
    ) {
      errors.push(
        `${prefix}${where}: loopStart ${loopStart} must be less than loopEnd ${loopEnd}`,
      );
    }
    for (const field of Object.keys(track)) {
      if ((MUSIC_TRACK_FIELDS as readonly string[]).includes(field)) continue;
      errors.push(unknownField(`${prefix}${where}: `, field, MUSIC_TRACK_FIELDS));
    }
  }
}

/** A loop point: an optional non-negative number of seconds. */
function validateLoopPoint(
  track: Record<string, unknown>,
  field: 'loopStart' | 'loopEnd',
  where: string,
  prefix: string,
  errors: string[],
): void {
  if (!(field in track) || track[field] === undefined) return;
  const value = track[field];
  if (typeof value !== 'number') {
    errors.push(`${prefix}${where}.${field} must be a number (seconds)`);
  } else if (value < 0) {
    errors.push(`${prefix}${where}.${field} must not be negative, got ${value}`);
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
 * The top-level `portraits` section: a map of portrait name → image file path.
 * Open-ended names (a pack invents its speakers), so unlike `sounds` there is no
 * closed name list to check against — only that each value is a string. The
 * `PORTRAIT_SIZE` dimension bound needs the decoded image, so it is the loader's,
 * measured with the real size in the error.
 */
function validatePortraits(portraits: unknown, prefix: string, errors: string[]): void {
  if (!isRecord(portraits)) {
    errors.push(`${prefix}portraits must be a JSON object`);
    return;
  }
  for (const [key, file] of Object.entries(portraits)) {
    if (typeof file !== 'string') {
      errors.push(`${prefix}portraits."${key}" must be a string (a path to a PNG)`);
    }
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
  if ('bosses' in content && content.bosses !== undefined) {
    validateBosses(content.bosses, prefix, errors);
  }
  if ('shots' in content && content.shots !== undefined) {
    validateSection(content.shots, 'shots', validateShot, prefix, errors);
  }
  if ('characters' in content && content.characters !== undefined) {
    validateSection(content.characters, 'characters', validateCharacter, prefix, errors);
  }
  if ('options' in content && content.options !== undefined) {
    validateSection(content.options, 'options', validateOptions, prefix, errors);
  }
  if ('bombs' in content && content.bombs !== undefined) {
    validateSection(content.bombs, 'bombs', validateBomb, prefix, errors);
  }
  if ('effects' in content && content.effects !== undefined) {
    validateSection(content.effects, 'effects', validateEffect, prefix, errors);
  }
  if ('items' in content && content.items !== undefined) {
    validateSection(content.items, 'items', validateItem, prefix, errors);
  }
}

/**
 * The shared shape of every keyed content section: reject a non-object, else
 * validate each entry with `each`, keyed by its section name. Enemies, stages
 * and bosses predate this helper and keep their own copies; the six new sections
 * share it, since the only thing that varied between the old copies was the
 * per-entry validator.
 */
function validateSection(
  section: unknown,
  name: string,
  each: (raw: unknown, where: string, prefix: string, errors: string[]) => void,
  prefix: string,
  errors: string[],
): void {
  if (!isRecord(section)) {
    errors.push(`${prefix}content.${name} must be a JSON object`);
    return;
  }
  for (const [key, entry] of Object.entries(section)) {
    each(entry, `content.${name}."${key}"`, prefix, errors);
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
        validatePatternSlot(slot, `${where}.patterns[${i}]`, prefix, errors),
      );
    }
  }

  validateSpoils(raw, where, prefix, errors);

  for (const key of Object.keys(raw)) {
    if ((ENEMY_FIELDS as readonly string[]).includes(key)) continue;
    errors.push(unknownField(`${prefix}${where}: `, key, ENEMY_FIELDS));
  }
}

/** A `spoils` list, shared by enemies and bosses: an array of [name, count] pairs. */
function validateSpoils(
  raw: Record<string, unknown>,
  where: string,
  prefix: string,
  errors: string[],
): void {
  if (!('spoils' in raw)) return;
  if (!Array.isArray(raw.spoils)) {
    errors.push(`${prefix}${where}.spoils must be an array`);
    return;
  }
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

function validatePatternSlot(
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
  if ('difficulty' in raw && raw.difficulty !== undefined) {
    validatePatternDifficulty(raw.difficulty, where, prefix, errors);
  }
  for (const key of Object.keys(raw)) {
    if ((PATTERN_SLOT_FIELDS as readonly string[]).includes(key)) continue;
    errors.push(unknownField(`${prefix}${where}: `, key, PATTERN_SLOT_FIELDS));
  }
}

/** Did-you-mean for a bad difficulty tier, mirroring `unknownField`'s two forms. */
function tierHint(tier: string): string {
  const suggestion = nearest(tier, DIFFICULTY_TIERS);
  return suggestion
    ? `did you mean "${suggestion}"?`
    : `valid tiers: ${DIFFICULTY_TIERS.join(', ')}`;
}

/**
 * A pattern slot's `difficulty` block: `{ easy: {...}, hard: {...} }`. Each key
 * must be a tier from the closed union — an unknown one is refused by name with a
 * did-you-mean — and each value an object of option overrides. Only the two
 * checks this module owns run here: the override's deeper shape is the pattern
 * option's, merged one level deep by the engine, so a nested value inside it is
 * left alone exactly as the base `options` object is.
 */
function validatePatternDifficulty(
  raw: unknown,
  where: string,
  prefix: string,
  errors: string[],
): void {
  if (!isRecord(raw)) {
    errors.push(`${prefix}${where}.difficulty must be a JSON object`);
    return;
  }
  for (const [tier, override] of Object.entries(raw)) {
    if (!(DIFFICULTY_TIERS as readonly string[]).includes(tier)) {
      errors.push(
        `${prefix}${where}.difficulty: "${tier}" is not a difficulty tier — ${tierHint(tier)}`,
      );
      continue;
    }
    if (!isRecord(override)) {
      errors.push(
        `${prefix}${where}.difficulty.${tier} must be a JSON object of option overrides`,
      );
    }
  }
}

/**
 * A spell card's `difficulties` gate: an array of tiers, `["lunatic"]` for a
 * Lunatic-only card. Absent means every tier. An unknown tier is refused by name
 * with a did-you-mean, the same idiom an unknown field gets.
 */
function validateDifficultyGate(
  raw: unknown,
  where: string,
  prefix: string,
  errors: string[],
): void {
  if (!Array.isArray(raw)) {
    errors.push(`${prefix}${where}.difficulties must be an array of difficulty tiers`);
    return;
  }
  raw.forEach((tier, i) => {
    if (typeof tier !== 'string') {
      errors.push(`${prefix}${where}.difficulties[${i}] must be a string`);
    } else if (!(DIFFICULTY_TIERS as readonly string[]).includes(tier)) {
      errors.push(
        `${prefix}${where}.difficulties[${i}] "${tier}" is not a difficulty tier — ${tierHint(tier)}`,
      );
    }
  });
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
  optField(raw, 'music', 'string', where, prefix, errors);
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

function validateBosses(bosses: unknown, prefix: string, errors: string[]): void {
  if (!isRecord(bosses)) {
    errors.push(`${prefix}content.bosses must be a JSON object`);
    return;
  }
  for (const [name, boss] of Object.entries(bosses)) {
    validateBoss(boss, `content.bosses."${name}"`, prefix, errors);
  }
}

function validateBoss(
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
  requireField(raw, 'radius', 'number', where, prefix, errors, 'a number');
  optField(raw, 'width', 'number', where, prefix, errors);
  optField(raw, 'height', 'number', where, prefix, errors);
  optField(raw, 'tint', 'object', where, prefix, errors);
  optField(raw, 'onDeath', 'string', where, prefix, errors);
  optField(raw, 'music', 'string', where, prefix, errors);

  if ('entry' in raw && raw.entry !== undefined) {
    validateBossEntry(raw.entry, `${where}.entry`, prefix, errors);
  }

  if ('dialogue' in raw && raw.dialogue !== undefined) {
    validateDialogue(raw.dialogue, `${where}.dialogue`, prefix, errors);
  }

  if ('dialogueFor' in raw && raw.dialogueFor !== undefined) {
    validateDialogueFor(raw.dialogueFor, `${where}.dialogueFor`, prefix, errors);
  }

  if (!('phases' in raw) || raw.phases === undefined) {
    errors.push(`${prefix}${where} is missing required field "phases" — an array of spell cards`);
  } else if (!Array.isArray(raw.phases)) {
    errors.push(`${prefix}${where}.phases must be an array`);
  } else {
    raw.phases.forEach((card, i) =>
      validateSpellCard(card, `${where}.phases[${i}]`, prefix, errors),
    );
  }

  validateSpoils(raw, where, prefix, errors);

  for (const key of Object.keys(raw)) {
    if ((BOSS_FIELDS as readonly string[]).includes(key)) continue;
    errors.push(unknownField(`${prefix}${where}: `, key, BOSS_FIELDS));
  }
}

/**
 * A boss's `dialogue`: an array of `{speaker, text}` lines. Shape only — the
 * speaker names a portrait, but whether that portrait resolves (against built-in
 * portraits ∪ the pack's own `portraits` section) is a registry question, so it
 * belongs to `inject.ts`, not this pure module. Here: an array, each entry a
 * `{speaker, text}` object of two strings, with a did-you-mean on an unknown line
 * field the same as everywhere else.
 */
function validateDialogue(
  raw: unknown,
  where: string,
  prefix: string,
  errors: string[],
): void {
  if (!Array.isArray(raw)) {
    errors.push(`${prefix}${where} must be an array of {speaker, text} lines`);
    return;
  }
  raw.forEach((line, i) => {
    const lw = `${where}[${i}]`;
    if (!isRecord(line)) {
      errors.push(`${prefix}${lw} must be a JSON object`);
      return;
    }
    requireField(line, 'speaker', 'string', lw, prefix, errors, 'a portrait name');
    requireField(line, 'text', 'string', lw, prefix, errors, 'the line spoken');
    for (const key of Object.keys(line)) {
      if ((DIALOGUE_LINE_FIELDS as readonly string[]).includes(key)) continue;
      errors.push(unknownField(`${prefix}${lw}: `, key, DIALOGUE_LINE_FIELDS));
    }
  });
}

/**
 * A boss's `dialogueFor`: an object mapping a character name to a variant exchange.
 * Shape only — each value is validated exactly as `dialogue` is, and whether the
 * KEY names a real character (built-in ∪ the pack's own) is a registry question
 * that belongs to `inject.ts`, not this pure module.
 */
function validateDialogueFor(
  raw: unknown,
  where: string,
  prefix: string,
  errors: string[],
): void {
  if (!isRecord(raw)) {
    errors.push(`${prefix}${where} must be a JSON object mapping a character name to its lines`);
    return;
  }
  for (const [character, variant] of Object.entries(raw)) {
    validateDialogue(variant, `${where}."${character}"`, prefix, errors);
  }
}

function validateBossEntry(
  raw: unknown,
  where: string,
  prefix: string,
  errors: string[],
): void {
  if (!isRecord(raw)) {
    errors.push(`${prefix}${where} must be a JSON object`);
    return;
  }
  requireField(raw, 'x', 'number', where, prefix, errors, 'a number');
  requireField(raw, 'y', 'number', where, prefix, errors, 'a number');
  requireField(raw, 'ticks', 'number', where, prefix, errors, 'a whole tick count');
  for (const key of Object.keys(raw)) {
    if ((BOSS_ENTRY_FIELDS as readonly string[]).includes(key)) continue;
    errors.push(unknownField(`${prefix}${where}: `, key, BOSS_ENTRY_FIELDS));
  }
}

function validateSpellCard(
  raw: unknown,
  where: string,
  prefix: string,
  errors: string[],
): void {
  if (!isRecord(raw)) {
    errors.push(`${prefix}${where} must be a JSON object`);
    return;
  }
  requireField(raw, 'name', 'string', where, prefix, errors, 'a card name');
  requireField(raw, 'hpSeconds', 'number', where, prefix, errors, 'seconds of health a competent player needs');
  optField(raw, 'timeLimit', 'number', where, prefix, errors);
  optField(raw, 'motion', 'object', where, prefix, errors);
  optField(raw, 'timeline', 'array', where, prefix, errors);
  optField(raw, 'bonus', 'number', where, prefix, errors);
  optField(raw, 'isSpell', 'boolean', where, prefix, errors);
  optField(raw, 'background', 'string', where, prefix, errors);
  optField(raw, 'music', 'string', where, prefix, errors);
  if ('difficulties' in raw && raw.difficulties !== undefined) {
    validateDifficultyGate(raw.difficulties, where, prefix, errors);
  }

  if (!('patterns' in raw) || raw.patterns === undefined) {
    errors.push(`${prefix}${where} is missing required field "patterns" — an array of pattern slots`);
  } else if (!Array.isArray(raw.patterns)) {
    errors.push(`${prefix}${where}.patterns must be an array`);
  } else {
    raw.patterns.forEach((slot, i) =>
      validatePatternSlot(slot, `${where}.patterns[${i}]`, prefix, errors),
    );
  }

  for (const key of Object.keys(raw)) {
    if ((SPELLCARD_FIELDS as readonly string[]).includes(key)) continue;
    errors.push(unknownField(`${prefix}${where}: `, key, SPELLCARD_FIELDS));
  }
}

/* --- shots ------------------------------------------------------------ */

function validateShot(raw: unknown, where: string, prefix: string, errors: string[]): void {
  if (!isRecord(raw)) {
    errors.push(`${prefix}${where} must be a JSON object`);
    return;
  }
  optField(raw, 'description', 'string', where, prefix, errors);

  if (!('levels' in raw) || raw.levels === undefined) {
    errors.push(`${prefix}${where} is missing required field "levels" — an array of power tiers`);
  } else if (!Array.isArray(raw.levels)) {
    errors.push(`${prefix}${where}.levels must be an array`);
  } else {
    raw.levels.forEach((lvl, i) =>
      validateShotLevel(lvl, `${where}.levels[${i}]`, prefix, errors),
    );
  }

  for (const key of Object.keys(raw)) {
    if ((SHOT_FIELDS as readonly string[]).includes(key)) continue;
    errors.push(unknownField(`${prefix}${where}: `, key, SHOT_FIELDS));
  }
}

function validateShotLevel(
  raw: unknown,
  where: string,
  prefix: string,
  errors: string[],
): void {
  if (!isRecord(raw)) {
    errors.push(`${prefix}${where} must be a JSON object`);
    return;
  }
  requireField(raw, 'spec', 'object', where, prefix, errors, 'a bullet spec');
  requireField(raw, 'offsets', 'array', where, prefix, errors, 'an array of muzzle offsets');
  requireField(raw, 'period', 'number', where, prefix, errors, 'ticks between volleys');
  for (const key of Object.keys(raw)) {
    if ((SHOT_LEVEL_FIELDS as readonly string[]).includes(key)) continue;
    errors.push(unknownField(`${prefix}${where}: `, key, SHOT_LEVEL_FIELDS));
  }
}

/* --- options ---------------------------------------------------------- */

function validateOptions(raw: unknown, where: string, prefix: string, errors: string[]): void {
  if (!isRecord(raw)) {
    errors.push(`${prefix}${where} must be a JSON object`);
    return;
  }
  requireField(raw, 'sprite', 'string', where, prefix, errors, 'an atlas cell name');
  requireField(raw, 'shot', 'object', where, prefix, errors, 'a bullet spec');
  requireField(raw, 'period', 'number', where, prefix, errors, 'ticks between volleys');
  requireField(raw, 'levels', 'array', where, prefix, errors, 'slot layouts by power tier');
  optField(raw, 'followSpeed', 'number', where, prefix, errors);
  optField(raw, 'tint', 'object', where, prefix, errors);
  for (const key of Object.keys(raw)) {
    if ((OPTIONS_FIELDS as readonly string[]).includes(key)) continue;
    errors.push(unknownField(`${prefix}${where}: `, key, OPTIONS_FIELDS));
  }
}

/* --- bombs ------------------------------------------------------------ */

function validateBomb(raw: unknown, where: string, prefix: string, errors: string[]): void {
  if (!isRecord(raw)) {
    errors.push(`${prefix}${where} must be a JSON object`);
    return;
  }
  requireField(raw, 'duration', 'number', where, prefix, errors, 'ticks the bomb burns');
  requireField(raw, 'invulnTicks', 'number', where, prefix, errors, 'ticks of player invulnerability');
  requireField(raw, 'damagePerTick', 'number', where, prefix, errors, 'damage per tick in range');
  optField(raw, 'radius', 'number', where, prefix, errors);
  optField(raw, 'convertBullets', 'boolean', where, prefix, errors);
  optField(raw, 'effect', 'string', where, prefix, errors);
  for (const key of Object.keys(raw)) {
    if ((BOMB_FIELDS as readonly string[]).includes(key)) continue;
    errors.push(unknownField(`${prefix}${where}: `, key, BOMB_FIELDS));
  }
}

/* --- effects ---------------------------------------------------------- */

/** An `Amount` (`src/sim/effects.ts`): a scalar or a `{min, max}` range. */
function isAmount(v: unknown): boolean {
  return (
    typeof v === 'number' ||
    (isRecord(v) && typeof v.min === 'number' && typeof v.max === 'number')
  );
}

function requireAmount(
  raw: Record<string, unknown>,
  field: string,
  where: string,
  prefix: string,
  errors: string[],
  hint: string,
): void {
  if (!(field in raw) || raw[field] === undefined) {
    errors.push(`${prefix}${where} is missing required field "${field}" — ${hint}`);
  } else if (!isAmount(raw[field])) {
    errors.push(`${prefix}${where}.${field} must be a number or a {min, max} range`);
  }
}

function validateEffect(raw: unknown, where: string, prefix: string, errors: string[]): void {
  if (!isRecord(raw)) {
    errors.push(`${prefix}${where} must be a JSON object`);
    return;
  }
  requireField(raw, 'sprite', 'string', where, prefix, errors, 'an atlas cell name');
  requireAmount(raw, 'count', where, prefix, errors, 'particles per emit');
  requireAmount(raw, 'speed', where, prefix, errors, 'initial speed, px/tick');
  requireAmount(raw, 'life', where, prefix, errors, 'ticks before a particle expires');
  optField(raw, 'spread', 'number', where, prefix, errors);
  optField(raw, 'direction', 'number', where, prefix, errors);
  optField(raw, 'drag', 'number', where, prefix, errors);
  optField(raw, 'gravity', 'number', where, prefix, errors);
  if ('scale' in raw && raw.scale !== undefined && typeof raw.scale !== 'number' && !isRecord(raw.scale)) {
    errors.push(`${prefix}${where}.scale must be a number or a {from, to} range`);
  }
  optField(raw, 'alpha', 'object', where, prefix, errors);
  optField(raw, 'spin', 'number', where, prefix, errors);
  optField(raw, 'tint', 'object', where, prefix, errors);
  optField(raw, 'additive', 'boolean', where, prefix, errors);
  for (const key of Object.keys(raw)) {
    if ((EFFECT_FIELDS as readonly string[]).includes(key)) continue;
    errors.push(unknownField(`${prefix}${where}: `, key, EFFECT_FIELDS));
  }
}

/* --- items ------------------------------------------------------------ */

function validateItem(raw: unknown, where: string, prefix: string, errors: string[]): void {
  if (!isRecord(raw)) {
    errors.push(`${prefix}${where} must be a JSON object`);
    return;
  }
  requireField(raw, 'sprite', 'string', where, prefix, errors, 'an atlas cell name');
  requireField(raw, 'radius', 'number', where, prefix, errors, 'a pickup radius');
  requireField(raw, 'value', 'number', where, prefix, errors, 'a power fraction or score points');
  if (!('kind' in raw) || raw.kind === undefined) {
    errors.push(
      `${prefix}${where} is missing required field "kind" — one of ${ITEM_KINDS.join(', ')}`,
    );
  } else if (typeof raw.kind !== 'string') {
    errors.push(`${prefix}${where}.kind must be a string`);
  } else if (!(ITEM_KINDS as readonly string[]).includes(raw.kind)) {
    // A new kind is a new game RULE — the game layer switches on `kind` to
    // decide what a pickup does — so a pack cannot introduce one as data.
    errors.push(
      `${prefix}${where}.kind "${raw.kind}" is not a kind this game has — a new kind is a new game rule, not pack data; valid kinds: ${ITEM_KINDS.join(', ')}`,
    );
  }
  optField(raw, 'motion', 'object', where, prefix, errors);
  optField(raw, 'tint', 'object', where, prefix, errors);
  optField(raw, 'magnetSpeed', 'number', where, prefix, errors);
  for (const key of Object.keys(raw)) {
    if ((ITEM_FIELDS as readonly string[]).includes(key)) continue;
    errors.push(unknownField(`${prefix}${where}: `, key, ITEM_FIELDS));
  }
}

/* --- characters ------------------------------------------------------- */

function validateCharacter(raw: unknown, where: string, prefix: string, errors: string[]): void {
  if (!isRecord(raw)) {
    errors.push(`${prefix}${where} must be a JSON object`);
    return;
  }
  requireField(raw, 'label', 'string', where, prefix, errors, 'shown on the select screen');
  requireField(raw, 'shot', 'string', where, prefix, errors, 'a registered shot name');
  requireField(raw, 'options', 'string', where, prefix, errors, 'a registered option set name');
  requireField(raw, 'bomb', 'string', where, prefix, errors, 'a registered bomb name');
  requireField(raw, 'sprite', 'string', where, prefix, errors, 'an atlas cell name');
  optField(raw, 'blurb', 'string', where, prefix, errors);
  optField(raw, 'width', 'number', where, prefix, errors);
  optField(raw, 'height', 'number', where, prefix, errors);

  if (!('player' in raw) || raw.player === undefined) {
    errors.push(`${prefix}${where} is missing required field "player" — the ship's stats`);
  } else if (!isRecord(raw.player)) {
    errors.push(`${prefix}${where}.player must be a JSON object`);
  } else {
    validatePlayer(raw.player, `${where}.player`, prefix, errors);
  }

  for (const key of Object.keys(raw)) {
    if ((CHARACTER_FIELDS as readonly string[]).includes(key)) continue;
    errors.push(unknownField(`${prefix}${where}: `, key, CHARACTER_FIELDS));
  }
}

function validatePlayer(
  raw: Record<string, unknown>,
  where: string,
  prefix: string,
  errors: string[],
): void {
  requireField(raw, 'x', 'number', where, prefix, errors, 'a number');
  requireField(raw, 'y', 'number', where, prefix, errors, 'a number');
  requireField(raw, 'speed', 'number', where, prefix, errors, 'px/tick, unfocused');
  requireField(raw, 'focusSpeed', 'number', where, prefix, errors, 'px/tick, focused');
  requireField(raw, 'radius', 'number', where, prefix, errors, 'the lethal hitbox');
  requireField(raw, 'grazeRadius', 'number', where, prefix, errors, 'the graze radius');
  requireField(raw, 'lives', 'number', where, prefix, errors, 'a whole life count');
  requireField(raw, 'bombs', 'number', where, prefix, errors, 'a whole bomb count');
  requireField(raw, 'invulnTicks', 'number', where, prefix, errors, 'a whole tick count');
  optField(raw, 'maxPower', 'number', where, prefix, errors);
  for (const key of Object.keys(raw)) {
    if ((PLAYER_FIELDS as readonly string[]).includes(key)) continue;
    errors.push(unknownField(`${prefix}${where}: `, key, PLAYER_FIELDS));
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
