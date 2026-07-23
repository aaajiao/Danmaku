/**
 * The browser half of the pack system: discover packs, validate their
 * manifests, fetch and machine-check their assets, and hand `main.ts` resolved
 * sound specs plus the URLs and decoded icons it needs to build atlases.
 *
 * This is the one pack module allowed to import `render` (it reads the sheet
 * geometry the checks measure against) and to touch the network, the DOM and a
 * canvas. Its pure counterpart is `manifest.ts`, which is where every golden
 * error string lives and is proved headlessly. The split is deliberate: what a
 * `bun test` can assert lives there; what needs a real framebuffer lives here
 * and is judged on `test:assets` and by eye in `bun run dev`.
 *
 * ## Everything is soft
 *
 * The game is never blocked on assets — procedural placeholders are the
 * permanent floor (CLAUDE.md rule 9 and `render/procedural.ts`). So every
 * failure path here returns rather than throws: no packs server, a broken
 * index, a pack that fails validation or whose sheet is the wrong size — each
 * degrades to "that resource stays procedural" and the run continues. A broken
 * pack is skipped **whole** and named in the boot report; a valid one's
 * resources join a last-wins override map.
 *
 * ## Determinism without the sim
 *
 * The loader never runs inside a tick and never touches the `sim` RNG (rule 2).
 * But the hash it records into replay meta must be stable, so ordering is fixed:
 * packs load in index order, and a pack's files are hashed in a canonical
 * resource order (`RESOURCE_ORDER` below), not in whatever order JSON keys
 * happened to be written.
 */

import type { SoundSpec } from '../audio';
import { musicNames, replaceMusic, type MusicSpec } from '../audio/music';
import { backgroundNames } from '../render/background';
import { laserSkinNames } from '../render/laser-skin';
import { definePortrait, hasPortrait, portraitNames, PORTRAIT_SIZE } from '../render/portrait';
import type {
  ActorSheetInput,
  ActorStripInput,
  V4ActorAtlasInputs,
} from '../render/v4-actors';
import {
  BULLET_CELLS,
  BULLET_VARIANT_CELLS,
  MISSILE_STRIP_CELLS,
  SHIP_CELLS,
  BULLET_COLUMNS,
  BULLET_GRID,
  BULLET_ROWS,
  MAX_CELL_EXTENT,
  FX_PAD,
  LASER_BODY_CELLS,
  type BulletSheetInput,
  type BulletStripInput,
  type EffectStripInput,
  type LaserStripInput,
  type MissileStripInput,
  type PickupStripInput,
  type ShipStripInput,
} from '../render/procedural';
import type {
  PackActorAssets,
  PackActorSheet,
  PackBulletSheet,
  PackBulletStrip,
  PackShipStrip,
  PackStrip,
} from './manifest';
import { injectPack, PackInjectError, type InjectContext, type InjectResult } from './inject';
import {
  hashPack,
  packsMetaString,
  parseIndex,
  SOUND_NAMES,
  validateManifest,
  type PackManifest,
} from './manifest';

/**
 * What the shell needs to build the game from a pack set. URLs, not textures:
 * `main.ts` owns atlas and sound construction, so the loader hands it the
 * inputs and stays out of the render graph it would otherwise have to know.
 * The hud icons are the exception — already decoded here for their dimension
 * check, and `drawHud` wants a `CanvasImageSource`, so returning the `Image`
 * avoids a second decode.
 */
export interface LoadedPacks {
  /** Winning bullet sheet URL, if any pack supplied one. */
  bulletsUrl?: string;
  /**
   * Winning self-describing native bullet sheet, if a pack shipped the object
   * form. Present alongside `bulletsUrl` (the resolved sheet URL); `main.ts`
   * hands both to `bulletAtlas(url, strips)` so the whole bullet atlas is native
   * strips. Absent means the legacy grid (or the procedural floor) is in force.
   */
  bulletsStrips?: BulletSheetInput;
  /** Winning ship sheet URL, if any pack supplied one. */
  shipUrl?: string;
  /** Winning native ship strip bank, if a pack shipped the object form. */
  shipStrip?: ShipStripInput;
  /** Winning pack-backed actor texture families, each independently optional. */
  actors?: V4ActorAtlasInputs;
  /**
   * Winning `assets.effects` strips (name → resolved URL + source geometry), if
   * any pack shipped one. `main.ts` hands these to `effectAtlas(undefined, …)`,
   * which composites them onto the single fx texture — a floor name a pack reskins
   * (`burst`/`burst.big`/`pulse`) takes its native pixels, the rest stay
   * procedural. Absent means the procedural fx floor is in force.
   */
  effectStrips?: Record<string, EffectStripInput>;
  /**
   * Winning `assets.lasers` strips (name → resolved URL + source geometry), if
   * any pack shipped one. Structurally identical to `effectStrips`; `main.ts`
   * hands these to `laserAtlas(undefined, …)`, which composites them onto the
   * single laser texture — a body/cap strip a pack reskins takes its native baked
   * pixels, the rest stay procedural. Absent means the procedural laser floor.
   */
  laserStrips?: Record<string, LaserStripInput>;
  /**
   * Winning `assets.missiles` strips (name → resolved URL + source geometry), if
   * any pack shipped one. Structurally identical to `laserStrips`; `main.ts` hands
   * these to `missileAtlas(undefined, …)`, which composites them onto the single
   * missile texture — a body strip a pack reskins takes its native baked pixels,
   * the rest stay procedural. Absent means the procedural missile floor.
   */
  missileStrips?: Record<string, MissileStripInput>;
  /**
   * Winning `assets.pickups` strips (name → resolved URL + source geometry), if
   * any pack shipped one. Structurally identical to `missileStrips`; `main.ts` hands
   * these to `pickupAtlas(undefined, …)`, which composites them onto the single
   * pickup texture — a coin/gem/bar strip a pack reskins takes its native baked
   * pixels, the rest stay procedural. Absent means the procedural pickup floor.
   */
  pickupStrips?: Record<string, PickupStripInput>;
  /** Texture sampling for both sheets. `nearest` matches `loadTexture`. */
  filter: 'nearest' | 'linear';
  /**
   * Registered-sound name → winning URL plus any pack-authored mix policy.
   * The shell applies these through `overrideSound`, preserving omitted
   * built-in settings for legacy string entries.
   */
  soundSpecs: Record<string, SoundSpec>;
  /** Decoded, dimension-checked hud icons, drawn in place of the ♥/★ glyphs. */
  hudIcons: { life?: HTMLImageElement; bomb?: HTMLImageElement };
  /** `name@hash` of every loaded pack, comma-joined, '' when none. Replay meta. */
  packsMeta: string;
  /**
   * One row per content pack's `entry: true` stage, in index order. The title
   * menu offers these under START. `packsData` is the entering pack's own
   * `name@hash`, carried on the row rather than on the context so the plain
   * START row records `''` — `main.ts` assigns this whole list to
   * `GameContext.campaigns` as plain data and never learns what a pack is.
   */
  campaigns: LoadedCampaign[];
  /**
   * One row per pack character (`<pack>/<name>`) and the pack that owns it, in
   * index order. A pack character drives the simulation with pack content even
   * flown off the plain START row, so `CharacterSelectState` arms strict
   * `packsData` from this when a namespaced ship is confirmed. `main.ts` assigns
   * it to `GameContext.characterPacks` beside `campaigns` — the two carry the
   * same identity down the two paths a run can take one.
   */
  characterPacks: LoadedCharacterPack[];
}

/**
 * A campaign a content pack contributes. Structurally the `Campaign` the game
 * reads off `GameContext` (`src/game/states.ts`), but declared here as plain
 * data: `src/packs` may not import `src/game`, and this crosses the boundary as
 * a flat record the shell assigns across.
 */
export interface LoadedCampaign {
  /** Menu label — the qualified stage name, e.g. `example/gauntlet`. */
  label: string;
  /** Qualified entry stage (`<pack>/<entry>`) a run starts on. */
  stage: string;
  /** Entering pack's identity (`name@hash`), strict replay meta. */
  packsData: string;
}

/**
 * A pack character and the identity of the pack that owns it. Structurally the
 * `CharacterPack` the game reads off `GameContext`, declared here as plain data
 * for the same boundary reason `LoadedCampaign` is.
 */
export interface LoadedCharacterPack {
  /** Qualified character name (`<pack>/<name>`) as registered. */
  character: string;
  /** Owning pack's identity (`name@hash`), strict replay meta. */
  packsData: string;
}

/**
 * Pair a pack's injected content with the pack's own identity, the same way for
 * both paths a run can carry one: a campaign row records it when entered, and a
 * pack character records it when flown — even off the plain START row, because a
 * pack character drives the simulation with pack content whether or not a
 * campaign armed the identity.
 *
 * Exported so the acceptance test builds its context from THIS pairing rather
 * than reproducing it as a fixture. A wire is only proven reachable if the test
 * exercises the producer, not a copy of it (the `characters` half went unwired
 * in the shell while a test that supplied its own mapping stayed green).
 */
export function attachIdentity(
  injected: InjectResult,
  packsData: string,
): { campaigns: LoadedCampaign[]; characterPacks: LoadedCharacterPack[] } {
  return {
    campaigns: injected.campaigns.map((c) => ({ ...c, packsData })),
    characterPacks: injected.characters.map((character) => ({ character, packsData })),
  };
}

const NONE: LoadedPacks = {
  filter: 'nearest',
  soundSpecs: {},
  hudIcons: {},
  packsMeta: '',
  campaigns: [],
  characterPacks: [],
};

const INDEX_URL = '/packs/index.json';

/** The one line the loader prints when the server cannot serve packs at all. */
const OLD_SERVER_MESSAGE = 'packs unavailable under this server — run bun run dev';

/* ------------------------------------------------------------------ */
/* Machine-check thresholds                                            */
/* ------------------------------------------------------------------ */

// These are the loader's own judgement calls, not golden strings (only
// `manifest.ts`'s error text is golden). They are stated as named constants so
// the doctrine an author reads in `docs/packs.md` and the number the loader
// enforces are the same value.

/**
 * Alpha at or above which a bullet-sheet texel counts as painted, for the
 * per-cell extent measurement. `MAX_CELL_EXTENT` is measured against paint, not
 * geometry (see its header in `render/procedural.ts`), so the floor is low —
 * anything fainter than this contributes no visible bleed across a seam.
 */
const BULLET_ALPHA_PAINTED = 16;

/**
 * Largest mean saturation a bullet cell's opaque body may carry. Bullets are
 * white and colour is the engine's per-instance tint (see `Rendering` in
 * CLAUDE.md), so a coloured sheet is a mistake **for a tinted strip** the tint
 * would then double. A `baked` variant declares its colour and skips this gate —
 * the single line that lets a pack's coloured native art import losslessly. Pure
 * white or grey art — including its antialiased edges — measures ~0.
 */
const BULLET_SATURATION_MAX = 0.15;

/**
 * Laser bodies are the one registered strip role whose +x edges must be painted:
 * a stretched body must meet muzzle/tip, and a tiled body must meet its neighbour.
 * Keep the exemption name-led and closed; caps, effects, missiles and pack-new
 * laser names retain the ordinary two-axis margin gate.
 */
const LASER_BODY_SET = new Set<string>(LASER_BODY_CELLS);

export function laserBodyAllowsLongAxisFill(strip: string): boolean {
  return LASER_BODY_SET.has(strip);
}

/** Opacity a pixel needs before it counts toward a cell's saturation mean. */
const SATURATION_ALPHA_FLOOR = 128;

/** Hud icons stand in for a glyph and are drawn small; larger is a mistake. */
const HUD_ICON_MAX = 16;

/**
 * The five fixed sheet-family slots which lead the boot-report ordering. The
 * full canonical first-URL order files are fetched and hashed in — bullets,
 * ship, player/enemy/Boss actors, effects, lasers, missiles, pickups, sounds in
 * `SOUND_NAMES` order, hud, music, then portraits (keyed
 * strip/music/portrait sections in manifest order) — and is fixed by the call
 * order of the `gather*` functions. A repeated URL occupies only its first
 * position. Music and portrait names are dynamic (a pack invents them), so they
 * cannot live in this fixed list; the report appends them sorted.
 */
const RESOURCE_ORDER = [
  'assets.bullets',
  'assets.ship',
  'assets.actors.players',
  'assets.actors.enemies',
  'assets.actors.bosses',
] as const;

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/** A pack that failed validation or a machine check, carrying every reason. */
class PackError extends Error {
  readonly reasons: string[];
  constructor(reasons: string[]) {
    super(reasons.join('; '));
    this.reasons = reasons;
  }
}

function reasonsOf(error: unknown): string[] {
  if (error instanceof PackError) return error.reasons;
  if (error instanceof Error) return [error.message];
  return [String(error)];
}

/** Project-owned v4 art wins the plain URL; the purchaser-local reference is fallback. */
export function implicitArtPack(names: readonly string[]): string | null {
  if (names.includes('v4')) return 'v4';
  if (names.includes('bulletpack')) return 'bulletpack';
  return null;
}

/* ------------------------------------------------------------------ */
/* Discovery                                                           */
/* ------------------------------------------------------------------ */

/**
 * Load every discovered pack and reconcile their resources.
 *
 * Runs at boot in `main.ts` **before** atlas construction and before the audio
 * graph can unlock, so the sheets and sound URLs it returns are in place before
 * anything reads them. Total by construction: it cannot throw into boot.
 */
export async function loadPacks(): Promise<LoadedPacks> {
  let names: string[];
  try {
    names = await discover();
  } catch {
    console.warn(OLD_SERVER_MESSAGE);
    return NONE;
  }

  // The project-owned v4 pack is the art direction of this build. A purchaser-
  // local BulletPack remains the compatibility/audit fallback when v4 is absent,
  // never a sample layered under an alphabetically later demo. An explicit
  // ?pack= still wins; without either art pack discovery keeps its ordinary
  // multi-pack behaviour.
  const requested = packParam();
  const only = requested ?? implicitArtPack(names);
  if (only !== null) names = names.filter((name) => name === only);
  if (names.length === 0) {
    // Either genuinely no packs, or `?pack=` named one that is not on disk. The
    // first is identical to today; the second is worth surfacing, so the report
    // still runs when the query is present.
    report({
      winners: new Map(),
      overrides: [],
      loaded: [],
      failures: [],
      surfaceRequested: requested !== null,
    });
    return NONE;
  }

  // The name sets injection resolves against, computed once for every pack.
  // `inject.ts` may not import `render` (a sprite is an atlas cell, a scene is a
  // shader — both behind that boundary), so the loader — which may — hands them
  // in. Everything except characters draws from the bullet atlas, so its cells
  // are the sprite set; characters wear the ship sheet, whose regions are a
  // separate namespace (this line shipped without it once, and the example
  // pack's character failed to load in the browser while every headless test —
  // whose fixtures supplied their own pooled set — stayed green); scenes are
  // the registered backgrounds, already imported by the time this runs (see
  // `main.ts`'s boot-order comment).
  const injectContext: InjectContext = {
    // Floor cells ∪ the base campaign's per-family variant names (both are always
    // resolvable — the procedural floor aliases every variant to its base cell),
    // so a spec naming a variant loads. A pack's own declared native strips are
    // added per-pack below (`packContext`).
    sprites: [...BULLET_CELLS, ...BULLET_VARIANT_CELLS],
    shipSprites: [...SHIP_CELLS],
    // The beam skins a laser bullet may wear (the third sprite pool, laser atlas).
    // A guest content pack may author a beam card naming one of these built-in
    // skins — it may not DEFINE a skin (engine code), the pack boundary.
    laserSprites: laserSkinNames(),
    // The missile bodies a `missile` bullet may wear (the fourth sprite pool,
    // missile atlas). Same boundary as beams: a guest pack may fire a missile
    // naming one of these built-in bodies, but may not define a new one.
    missileSprites: [...MISSILE_STRIP_CELLS],
    scenes: backgroundNames(),
    // Built-in portrait names a boss `dialogue` speaker may resolve against; a
    // pack's own `portraits` section extends this set pack-first inside injection.
    portraits: portraitNames(),
  };

  const winners = new Map<string, Winner>();
  const overrides: string[] = [];
  const loaded: LoadedRecord[] = [];
  const failures: { name: string; reasons: string[] }[] = [];
  const campaigns: LoadedCampaign[] = [];
  const characterPacks: LoadedCharacterPack[] = [];

  // Index order, which is deterministic (the server sorts directory names) —
  // both the last-wins override precedence and the campaign row order below it.
  for (const name of names) {
    try {
      const pack = await loadOnePack(name, injectContext);
      for (const [slot, resource] of pack.slots) {
        const prior = winners.get(slot);
        if (prior) overrides.push(`${slot} ← "${name}" (overrode "${prior.source}")`);
        winners.set(slot, { source: name, ...resource });
      }
      loaded.push({ name, hash: pack.hash, content: pack.content });
      campaigns.push(...pack.campaigns);
      characterPacks.push(...pack.characterPacks);
    } catch (error) {
      // Skipped whole, named — a partly-applied pack is worse than no pack. An
      // injection failure lands here like any other, so a broken data pack
      // simply has no campaign row to enter (decisions-f2: never silently fall
      // back under a failed data pack).
      failures.push({ name, reasons: reasonsOf(error) });
    }
  }

  report({ winners, overrides, loaded, failures, surfaceRequested: requested !== null });

  const soundSpecs: Record<string, SoundSpec> = {};
  for (const sound of SOUND_NAMES) {
    const spec = winners.get(`sounds.${sound}`)?.sound;
    if (spec !== undefined) soundSpecs[sound] = spec;
  }

  // The fx strips that won their slot, keyed by bare strip name for the
  // composite in `main.ts`. Insertion order is index order (last-wins is already
  // resolved in `winners`), stable enough — the fx texture is not hashed.
  const effectStrips: Record<string, EffectStripInput> = {};
  for (const [slot, winner] of winners) {
    if (!slot.startsWith('assets.effects.')) continue;
    const geo = winner.effectStrip;
    if (winner.url === undefined || geo === undefined) continue;
    effectStrips[slot.slice('assets.effects.'.length)] = { url: winner.url, ...geo };
  }

  // The laser strips that won their slot, the same shape as the fx ones.
  const laserStrips: Record<string, LaserStripInput> = {};
  for (const [slot, winner] of winners) {
    if (!slot.startsWith('assets.lasers.')) continue;
    const geo = winner.laserStrip;
    if (winner.url === undefined || geo === undefined) continue;
    laserStrips[slot.slice('assets.lasers.'.length)] = { url: winner.url, ...geo };
  }

  // The missile body strips that won their slot, the same shape again.
  const missileStrips: Record<string, MissileStripInput> = {};
  for (const [slot, winner] of winners) {
    if (!slot.startsWith('assets.missiles.')) continue;
    const geo = winner.missileStrip;
    if (winner.url === undefined || geo === undefined) continue;
    missileStrips[slot.slice('assets.missiles.'.length)] = { url: winner.url, ...geo };
  }

  // The pickup body strips that won their slot, the same shape again.
  const pickupStrips: Record<string, PickupStripInput> = {};
  for (const [slot, winner] of winners) {
    if (!slot.startsWith('assets.pickups.')) continue;
    const geo = winner.pickupStrip;
    if (winner.url === undefined || geo === undefined) continue;
    pickupStrips[slot.slice('assets.pickups.'.length)] = { url: winner.url, ...geo };
  }

  return {
    bulletsUrl: winners.get('assets.bullets')?.url,
    bulletsStrips: winners.get('assets.bullets')?.bulletStrips,
    shipUrl: winners.get('assets.ship')?.url,
    shipStrip: winners.get('assets.ship')?.shipStrip,
    actors: resolvedActorInputs(winners),
    filter: (winners.get('assets.filter')?.value as 'nearest' | 'linear') ?? 'nearest',
    effectStrips: Object.keys(effectStrips).length > 0 ? effectStrips : undefined,
    laserStrips: Object.keys(laserStrips).length > 0 ? laserStrips : undefined,
    missileStrips: Object.keys(missileStrips).length > 0 ? missileStrips : undefined,
    pickupStrips: Object.keys(pickupStrips).length > 0 ? pickupStrips : undefined,
    soundSpecs,
    hudIcons: {
      life: winners.get('hud.life')?.image,
      bomb: winners.get('hud.bomb')?.image,
    },
    packsMeta: packsMetaString(loaded),
    campaigns,
    characterPacks,
  };
}

function resolvedActorInputs(winners: Map<string, Winner>): V4ActorAtlasInputs | undefined {
  const input = (
    role: keyof V4ActorAtlasInputs,
  ): ActorSheetInput | undefined => {
    const winner = winners.get(`assets.actors.${role}`);
    if (winner?.url === undefined || winner.actorStrips === undefined) return undefined;
    return { url: winner.url, strips: winner.actorStrips };
  };
  const actors: V4ActorAtlasInputs = {
    players: input('players'),
    enemies: input('enemies'),
    bosses: input('bosses'),
  };
  return actors.players !== undefined ||
    actors.enemies !== undefined ||
    actors.bosses !== undefined
    ? actors
    : undefined;
}

/**
 * The pack directory names to load, in order.
 *
 * The server synthesizes `/packs/index.json` as `{"packs": [...]}` (see
 * `tools/serve.ts`); the bare `bun ./index.html` returns the HTML entry for the
 * same path, which `res.json()` cannot parse — that rejection is the signal
 * that packs are unavailable, and it propagates as a throw so the caller prints
 * one clear line and runs on placeholders.
 */
async function discover(): Promise<string[]> {
  const response = await fetch(INDEX_URL);
  const parsed = await response.json(); // throws on the HTML the old server returns
  const list = isRecord(parsed) ? (parsed as { packs?: unknown }).packs : parsed;
  const result = parseIndex(list);
  if (!Array.isArray(result)) {
    console.warn(`packs: ${result.error}`);
    return [];
  }
  return result;
}

/** The `?pack=` narrowing target, or null when absent. */
function packParam(): string | null {
  try {
    return new URLSearchParams(location.search).get('pack');
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* One pack                                                            */
/* ------------------------------------------------------------------ */

interface Resource {
  /** The URL a sheet or sound is served from. */
  url?: string;
  /** A non-file value, e.g. the filter mode. */
  value?: string;
  /** A packed sound's resolved URL and optional authored mix policy. */
  sound?: SoundSpec;
  /** A decoded hud icon, kept so `drawHud` need not decode it again. */
  image?: HTMLImageElement;
  /** A self-describing native bullet sheet (the object form of `assets.bullets`). */
  bulletStrips?: BulletSheetInput;
  /** A native ship strip bank (the object form of `assets.ship`). */
  shipStrip?: ShipStripInput;
  /** One self-describing actor sheet's strips, paired with `url` above. */
  actorStrips?: Readonly<Record<string, ActorStripInput>>;
  /** One `assets.effects` strip's source geometry, paired with `url` above. */
  effectStrip?: {
    x?: number;
    y?: number;
    frames: number;
    frameW: number;
    frameH: number;
    stride?: number;
    ticksPerFrame?: number;
    mode: 'loop' | 'once';
    color?: 'tinted' | 'baked';
    contentW?: number;
    contentH?: number;
  };
  /** One `assets.lasers` strip's source geometry, paired with `url` above. */
  laserStrip?: {
    x?: number;
    y?: number;
    frames: number;
    frameW: number;
    frameH: number;
    stride?: number;
    ticksPerFrame?: number;
    mode: 'loop' | 'once';
    color?: 'tinted' | 'baked';
    contentW?: number;
    contentH?: number;
  };
  /** One `assets.missiles` strip's source geometry, paired with `url` above. */
  missileStrip?: {
    x?: number;
    y?: number;
    frames: number;
    frameW: number;
    frameH: number;
    stride?: number;
    ticksPerFrame?: number;
    mode: 'loop' | 'once';
    color?: 'tinted' | 'baked';
    contentW?: number;
    contentH?: number;
  };
  /** One `assets.pickups` strip's source geometry, paired with `url` above. */
  pickupStrip?: {
    x?: number;
    y?: number;
    frames: number;
    frameW: number;
    frameH: number;
    stride?: number;
    ticksPerFrame?: number;
    mode: 'loop' | 'once';
    color?: 'tinted' | 'baked';
    contentW?: number;
    contentH?: number;
  };
}

interface Winner extends Resource {
  /** The pack whose resource won this slot. */
  source: string;
}

/** One content pack's registered content, for the boot report only. */
interface ContentSummary {
  /**
   * `[section, registered-count]` per non-empty content kind except stages,
   * in the manifest's canonical section order. One report line each: a kind
   * that registered silently is a kind whose author cannot tell it took
   * effect, which is the whole reason the report exists.
   */
  counts: readonly (readonly [section: string, n: number])[];
  /** Each entry stage's `next` chain, bare names joined by ` → `. */
  stageChains: string[];
}

/** A loaded pack as the report and replay-meta read it. */
interface LoadedRecord {
  name: string;
  hash: string;
  content?: ContentSummary;
}

interface OnePack {
  slots: Map<string, Resource>;
  hash: string;
  /** Campaigns this pack contributes — empty for a presentation-only pack. */
  campaigns: LoadedCampaign[];
  /** Pack characters this pack contributes — empty for a pack with none. */
  characterPacks: LoadedCharacterPack[];
  /** Content registered, for the report — absent when the pack has none. */
  content?: ContentSummary;
}

/**
 * One pack's file cache. A manifest may map many independently winning strips
 * onto one shared PNG, so a URL is fetched, decoded and appended to the pack
 * hash exactly once. The first declaration in canonical gather order owns the
 * byte position; later declarations still run their own geometry checks and
 * still create their own winner slots.
 */
class PackFiles {
  readonly orderedBytes: Uint8Array[] = [];

  private readonly bytesByUrl = new Map<string, Promise<Uint8Array>>();
  private readonly imagesByUrl = new Map<string, Promise<HTMLImageElement>>();
  private readonly durationsByUrl = new Map<string, Promise<number | undefined>>();

  bytes(url: string): Promise<Uint8Array> {
    const cached = this.bytesByUrl.get(url);
    if (cached !== undefined) return cached;

    const loaded = fetchBytes(url).then((bytes) => {
      this.orderedBytes.push(bytes);
      return bytes;
    });
    this.bytesByUrl.set(url, loaded);
    return loaded;
  }

  image(url: string): Promise<HTMLImageElement> {
    const cached = this.imagesByUrl.get(url);
    if (cached !== undefined) return cached;

    // Gate image decode on the byte fetch. Besides keeping a failed URL to one
    // request, this preserves the canonical first-seen hash order.
    const loaded = this.bytes(url).then(() => loadImage(url));
    this.imagesByUrl.set(url, loaded);
    return loaded;
  }

  duration(url: string): Promise<number | undefined> {
    const cached = this.durationsByUrl.get(url);
    if (cached !== undefined) return cached;

    const loaded = this.bytes(url).then((bytes) => measureDuration(bytes));
    this.durationsByUrl.set(url, loaded);
    return loaded;
  }
}

/**
 * Validate one pack, register its content, and fetch every resource it
 * declares, all-or-nothing.
 *
 * Every asset reason is collected before the first is thrown, because a
 * hand-editing author wants the whole list, and the pack is rejected as a unit
 * either way. Content is injected only **after** the assets are clean, so a pack
 * that fails a machine check registers nothing — injection is atomic per pack
 * (`inject.ts`), and this keeps the pack atomic across both halves: a failed
 * pack leaves neither a resource winner nor a registered enemy behind.
 */
async function loadOnePack(name: string, injectContext: InjectContext): Promise<OnePack> {
  const manifestBytes = await fetchBytes(`/packs/${name}/pack.json`).catch(() => {
    throw new PackError([`pack "${name}": pack.json: could not be fetched`]);
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch (error) {
    throw new PackError([
      `pack "${name}": pack.json: not valid JSON (${(error as Error).message})`,
    ]);
  }

  const validation = validateManifest(parsed, name);
  if ('errors' in validation) throw new PackError(validation.errors);
  const manifest = validation.manifest;

  const slots = new Map<string, Resource>();
  const files = new PackFiles();
  const reasons: string[] = [];
  const musicRegs: MusicRegistration[] = [];
  const portraitRegs: PortraitRegistration[] = [];

  await gatherAssets(name, manifest, slots, files, reasons);
  await gatherSounds(name, manifest, slots, files, reasons);
  await gatherHud(name, manifest, slots, files, reasons);
  await gatherMusic(name, manifest, slots, files, reasons, musicRegs);
  await gatherPortraits(name, manifest, slots, files, reasons, portraitRegs);

  if (reasons.length > 0) throw new PackError(reasons);

  const hash = await hashPack(manifestBytes, files.orderedBytes);

  // The pack's own identity, which every campaign it contributes records into
  // strict replay meta. A run only carries a pack's identity when it entered
  // that pack's campaign — so the identity rides the row, not the context.
  const packsData = packsMetaString([{ name, hash }]);

  // Register the content and take the campaigns and pack characters it exposes,
  // each paired with the pack's identity by `attachIdentity` — the one producer
  // both the shell and the acceptance test read, so the character path cannot be
  // wired for one and forgotten for the other. A semantic failure (an unresolved
  // name, a dead stage) is a `PackInjectError`; re-throw it as a `PackError` so
  // it reports like every other rejection. Idempotent per pack name, so a second
  // boot-time load of the same directory is a no-op.
  // Expand the sprite-name set this pack's content resolves against to
  // floor cells ∪ this pack's own declared native strip names (amendment
  // §Naming): a self-describing `assets.bullets` sheet may add pack-new variant
  // names (e.g. `msh.green`) that its own enemy/boss/shot specs reference bare,
  // and the runtime atlas registers them bare from the native sheet. A pack
  // loads all-or-nothing across assets AND injection, so the sheet and the
  // content that names its variants arrive together or the pack is skipped whole.
  const declared =
    manifest.assets !== undefined && typeof manifest.assets.bullets === 'object'
      ? Object.keys(manifest.assets.bullets.strips)
      : [];
  const packContext: InjectContext =
    declared.length > 0
      ? { ...injectContext, sprites: [...injectContext.sprites, ...declared] }
      : injectContext;

  let campaigns: LoadedCampaign[] = [];
  let characterPacks: LoadedCharacterPack[] = [];
  try {
    ({ campaigns, characterPacks } = attachIdentity(
      injectPack(manifest, packContext),
      packsData,
    ));
  } catch (error) {
    if (error instanceof PackInjectError) throw new PackError([...error.problems]);
    throw error;
  }

  // Register the pack's music LAST — only past both a clean asset gather and a
  // clean injection, so a pack rejected for any reason has registered no track,
  // the same all-or-nothing the content half holds. A built-in name replaces its
  // placeholder (bare, last-wins in the registry as in the slot map); a new name
  // registers namespaced, matching the qualified name `inject.ts` put in the
  // stage/boss spec. `replaceMusic` preserves a built-in synth as the failed-
  // asset floor and defines a pack-new name when none exists.
  for (const reg of musicRegs) replaceMusic(reg.name, reg.spec);

  // Register the pack's portraits LAST, past the same all-or-nothing gate as
  // music. Each is registered under its qualified `<pack>/<name>` — a pack
  // portrait is content-qualified, not a bare reskin, because `definePortrait`
  // forbids a duplicate (`src/render/portrait.ts`), so a bare built-in
  // replacement could not register in the first place; the `hasPortrait` guard
  // keeps a second boot-time load of the same directory a no-op rather than a
  // duplicate throw. `inject.ts` qualified the boss dialogue speaker to match.
  for (const reg of portraitRegs) {
    if (!hasPortrait(reg.name)) definePortrait(reg.name, { image: reg.image });
  }

  return { slots, hash, campaigns, characterPacks, content: contentSummary(manifest) };
}

/**
 * A content pack's registered content, described for the boot report. Read off
 * the manifest (the shape `manifest.ts` already accepted); `undefined` for a
 * presentation-only pack, which contributes no content lines.
 */
function contentSummary(manifest: PackManifest): ContentSummary | undefined {
  const content = manifest.content;
  if (content === undefined) return undefined;

  const counts: (readonly [string, number])[] = [];
  for (const section of ['shots', 'options', 'bombs', 'effects', 'items', 'characters', 'enemies', 'bosses'] as const) {
    const entries = content[section];
    if (entries === undefined) continue;
    const n = Object.keys(entries).length;
    if (n > 0) counts.push([section, n]);
  }
  const stages = content.stages ?? {};

  const chains: string[] = [];
  for (const key of Object.keys(stages)) {
    if (stages[key]?.entry !== true) continue;
    // Follow `next` within the pack, bare names for readability. `seen` guards
    // against a cyclic chain looping forever — the report never hangs boot.
    const parts: string[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined = key;
    while (cursor !== undefined && !seen.has(cursor)) {
      seen.add(cursor);
      parts.push(cursor);
      const next: string | null | undefined = stages[cursor]?.next;
      cursor = typeof next === 'string' && stages[next] !== undefined ? next : undefined;
    }
    chains.push(parts.join(' → '));
  }

  if (counts.length === 0 && chains.length === 0) return undefined;
  return { counts, stageChains: chains };
}

async function gatherAssets(
  name: string,
  manifest: PackManifest,
  slots: Map<string, Resource>,
  files: PackFiles,
  reasons: string[],
): Promise<void> {
  const assets = manifest.assets;
  if (assets === undefined) return;

  if (typeof assets.bullets === 'string') {
    const url = fileUrl(name, assets.bullets);
    try {
      await files.bytes(url);
      const image = await files.image(url);
      checkBulletSheet(name, assets.bullets, image, reasons);
      slots.set('assets.bullets', { url });
    } catch (error) {
      reasons.push(`pack "${name}": ${assets.bullets}: ${(error as Error).message}`);
    }
  } else if (assets.bullets !== undefined) {
    await gatherNativeBulletSheet(name, assets.bullets, slots, files, reasons);
  }

  if (typeof assets.ship === 'string') {
    const url = fileUrl(name, assets.ship);
    try {
      await files.bytes(url);
      const image = await files.image(url);
      checkShipSheet(name, assets.ship, image, reasons);
      slots.set('assets.ship', { url });
    } catch (error) {
      reasons.push(`pack "${name}": ${assets.ship}: ${(error as Error).message}`);
    }
  } else if (assets.ship !== undefined) {
    await gatherNativeShip(name, assets.ship, slots, files, reasons);
  }

  if (assets.actors !== undefined) {
    await gatherActorAssets(name, assets.actors, slots, files, reasons);
  }

  // A value, not a file: it rides no bytes and orders after the sheets it tunes.
  if (assets.filter !== undefined) {
    slots.set('assets.filter', { value: assets.filter });
  }

  // `assets.effects`: animation strips, warn-only reskin material. Several strip
  // slots may share a source URL; each keeps its own geometry and winner while
  // the source bytes/image/hash entry are cached once.
  if (assets.effects !== undefined) {
    await gatherEffectStrips(name, assets.effects, slots, files, reasons);
  }

  // `assets.lasers`: legacy-own-file/shared-source body/cap strips, with the same
  // treatment as `assets.effects`; composited onto the laser texture by `main.ts`
  // via `laserAtlas(undefined, …)`. Each winner is gated here.
  if (assets.lasers !== undefined) {
    await gatherLaserStrips(name, assets.lasers, slots, files, reasons);
  }

  // `assets.missiles`: legacy-own-file/shared-source body strips, with the same
  // treatment as `assets.lasers`; composited onto the missile texture by `main.ts`
  // via `missileAtlas(undefined, …)`. Each winner is gated here.
  if (assets.missiles !== undefined) {
    await gatherMissileStrips(name, assets.missiles, slots, files, reasons);
  }

  // `assets.pickups`: legacy-own-file/shared-source coin/gem/bar strips, with the
  // same treatment as `assets.missiles`; composited onto the pickup texture by
  // `main.ts` via `pickupAtlas(undefined, …)`. Each winner is gated here.
  if (assets.pickups !== undefined) {
    await gatherPickupStrips(name, assets.pickups, slots, files, reasons);
  }
}

async function gatherActorAssets(
  name: string,
  actors: PackActorAssets,
  slots: Map<string, Resource>,
  files: PackFiles,
  reasons: string[],
): Promise<void> {
  for (const role of ['players', 'enemies', 'bosses'] as const) {
    const sheet = actors[role];
    if (sheet === undefined) continue;
    await gatherActorSheet(name, role, sheet, slots, files, reasons);
  }
}

async function gatherActorSheet(
  name: string,
  role: keyof PackActorAssets,
  sheet: PackActorSheet,
  slots: Map<string, Resource>,
  files: PackFiles,
  reasons: string[],
): Promise<void> {
  const url = fileUrl(name, sheet.sheet);
  try {
    await files.bytes(url);
    const image = await files.image(url);
    checkNativeActorSheet(name, sheet.sheet, sheet.strips, image, reasons);
    slots.set(`assets.actors.${role}`, {
      url,
      actorStrips: resolveActorSheet(sheet),
    });
  } catch (error) {
    reasons.push(`pack "${name}": ${sheet.sheet}: ${(error as Error).message}`);
  }
}

function resolveActorSheet(
  sheet: PackActorSheet,
): Readonly<Record<string, ActorStripInput>> {
  const strips: Record<string, ActorStripInput> = {};
  for (const [name, strip] of Object.entries(sheet.strips)) {
    strips[name] = {
      x: strip.x,
      y: strip.y,
      frameW: strip.frameW,
      frameH: strip.frameH,
      frames: strip.frames,
      stride: strip.stride,
      ticksPerFrame: strip.ticksPerFrame,
      mode: strip.mode,
      color: strip.color,
      contentW: strip.contentW,
      contentH: strip.contentH,
    };
  }
  return strips;
}

/**
 * The object form of `assets.bullets`: one shared sheet, every strip on it. The
 * sheet is fetched, and each strip machine-checked over the loaded pixels —
 * coverage of all 16 floor cells, a baked floor cell WARNS (and falls back to
 * tinted treatment, it is not a rejection), per-strip bounds and inter-frame
 * seam for every strip, and mean-saturation only for a `tinted` strip. The
 * whole native sheet stays warn-only reskin material.
 */
async function gatherNativeBulletSheet(
  name: string,
  sheet: PackBulletSheet,
  slots: Map<string, Resource>,
  files: PackFiles,
  reasons: string[],
): Promise<void> {
  const url = fileUrl(name, sheet.sheet);
  try {
    await files.bytes(url);
    const image = await files.image(url);
    checkNativeBulletSheet(name, sheet.sheet, sheet.strips, image, reasons);
    slots.set('assets.bullets', { url, bulletStrips: resolveBulletSheet(sheet) });
  } catch (error) {
    reasons.push(`pack "${name}": ${sheet.sheet}: ${(error as Error).message}`);
  }
}

/** Copy a manifest bullet sheet into the render-side `BulletSheetInput` shape. */
function resolveBulletSheet(sheet: PackBulletSheet): BulletSheetInput {
  const strips: Record<string, BulletStripInput> = {};
  for (const [key, s] of Object.entries(sheet.strips)) {
    strips[key] = {
      x: s.x,
      y: s.y,
      frameW: s.frameW,
      frameH: s.frameH,
      frames: s.frames,
      stride: s.stride,
      ticksPerFrame: s.ticksPerFrame,
      mode: s.mode,
      color: s.color,
      contentW: s.contentW,
      contentH: s.contentH,
    };
  }
  return { sheet: sheet.sheet, strips };
}

/** The object form of `assets.ship`: a native strip bank drawn at frame 0. */
async function gatherNativeShip(
  name: string,
  ship: PackShipStrip,
  slots: Map<string, Resource>,
  files: PackFiles,
  reasons: string[],
): Promise<void> {
  const url = fileUrl(name, ship.src);
  try {
    await files.bytes(url);
    const image = await files.image(url);
    checkStripSheet(name, ship.src, 'ship', toStrip(ship), image, reasons);
    slots.set('assets.ship', {
      url,
      shipStrip: {
        frameW: ship.frameW,
        frameH: ship.frameH,
        frames: ship.frames,
        stride: ship.stride,
        ticksPerFrame: ship.ticksPerFrame,
        mode: ship.mode,
        color: ship.color,
          contentW: ship.contentW,
          contentH: ship.contentH,
          banking: ship.banking,
        },
    });
  } catch (error) {
    reasons.push(`pack "${name}": ${ship.src}: ${(error as Error).message}`);
  }
}

/** `assets.effects`: animation strips, each winner gated; shared URLs load once. */
async function gatherEffectStrips(
  name: string,
  effects: Record<string, PackStrip>,
  slots: Map<string, Resource>,
  files: PackFiles,
  reasons: string[],
): Promise<void> {
  // Manifest-declared order, so the hash is stable for a given manifest.
  for (const strip of Object.keys(effects)) {
    const spec = effects[strip];
    if (spec === undefined) continue;
    const url = fileUrl(name, spec.src);
    try {
      await files.bytes(url);
      const image = await files.image(url);
      checkStripSheet(name, spec.src, strip, toStrip(spec), image, reasons, spec);
      // Carry the declared geometry alongside the URL: `main.ts` composites these
      // strips onto the single fx texture (`effectAtlas`), so it needs
      // each strip's frame layout, not just where the pixels live.
      slots.set(`assets.effects.${strip}`, {
        url,
        effectStrip: {
          x: spec.x,
          y: spec.y,
          frames: spec.frames,
          frameW: spec.frameW,
          frameH: spec.frameH,
          stride: spec.stride,
          ticksPerFrame: spec.ticksPerFrame,
          mode: spec.mode,
          color: spec.color,
          contentW: spec.contentW,
          contentH: spec.contentH,
        },
      });
    } catch (error) {
      reasons.push(`pack "${name}": ${spec.src}: ${(error as Error).message}`);
    }
  }
}

/**
 * `assets.lasers`: laser strips, each winner gated — the
 * structural twin of `gatherEffectStrips`. The geometry is carried alongside the
 * URL so `main.ts` can composite each strip onto the one laser texture
 * (`laserAtlas`), a body/cap strip a pack reskins taking its baked pixels and the
 * rest staying procedural.
 */
async function gatherLaserStrips(
  name: string,
  lasers: Record<string, PackStrip>,
  slots: Map<string, Resource>,
  files: PackFiles,
  reasons: string[],
): Promise<void> {
  for (const strip of Object.keys(lasers)) {
    const spec = lasers[strip];
    if (spec === undefined) continue;
    const url = fileUrl(name, spec.src);
    try {
      await files.bytes(url);
      const image = await files.image(url);
      checkStripSheet(
        name,
        spec.src,
        strip,
        toStrip(spec),
        image,
        reasons,
        spec,
        laserBodyAllowsLongAxisFill(strip),
      );
      slots.set(`assets.lasers.${strip}`, {
        url,
        laserStrip: {
          x: spec.x,
          y: spec.y,
          frames: spec.frames,
          frameW: spec.frameW,
          frameH: spec.frameH,
          stride: spec.stride,
          ticksPerFrame: spec.ticksPerFrame,
          mode: spec.mode,
          color: spec.color,
          contentW: spec.contentW,
          contentH: spec.contentH,
        },
      });
    } catch (error) {
      reasons.push(`pack "${name}": ${spec.src}: ${(error as Error).message}`);
    }
  }
}

/**
 * `assets.missiles`: missile body strips, each winner gated — the structural
 * twin of `gatherLaserStrips`. The geometry is carried
 * alongside the URL so `main.ts` can composite each strip onto the one missile
 * texture (`missileAtlas`), a body strip a pack reskins taking its baked pixels
 * and the rest staying procedural.
 */
async function gatherMissileStrips(
  name: string,
  missiles: Record<string, PackStrip>,
  slots: Map<string, Resource>,
  files: PackFiles,
  reasons: string[],
): Promise<void> {
  for (const strip of Object.keys(missiles)) {
    const spec = missiles[strip];
    if (spec === undefined) continue;
    const url = fileUrl(name, spec.src);
    try {
      await files.bytes(url);
      const image = await files.image(url);
      checkStripSheet(name, spec.src, strip, toStrip(spec), image, reasons, spec);
      slots.set(`assets.missiles.${strip}`, {
        url,
        missileStrip: {
          x: spec.x,
          y: spec.y,
          frames: spec.frames,
          frameW: spec.frameW,
          frameH: spec.frameH,
          stride: spec.stride,
          ticksPerFrame: spec.ticksPerFrame,
          mode: spec.mode,
          color: spec.color,
          contentW: spec.contentW,
          contentH: spec.contentH,
        },
      });
    } catch (error) {
      reasons.push(`pack "${name}": ${spec.src}: ${(error as Error).message}`);
    }
  }
}

/**
 * `assets.pickups`: coin/gem/bar body strips, each winner gated — the structural
 * twin of `gatherMissileStrips`. The geometry is carried
 * alongside the URL so `main.ts` can composite each strip onto the one pickup
 * texture (`pickupAtlas`), a coin/gem/bar strip a pack reskins taking its baked
 * pixels and the rest staying procedural.
 */
async function gatherPickupStrips(
  name: string,
  pickups: Record<string, PackStrip>,
  slots: Map<string, Resource>,
  files: PackFiles,
  reasons: string[],
): Promise<void> {
  for (const strip of Object.keys(pickups)) {
    const spec = pickups[strip];
    if (spec === undefined) continue;
    const url = fileUrl(name, spec.src);
    try {
      await files.bytes(url);
      const image = await files.image(url);
      checkStripSheet(name, spec.src, strip, toStrip(spec), image, reasons, spec);
      slots.set(`assets.pickups.${strip}`, {
        url,
        pickupStrip: {
          x: spec.x,
          y: spec.y,
          frames: spec.frames,
          frameW: spec.frameW,
          frameH: spec.frameH,
          stride: spec.stride,
          ticksPerFrame: spec.ticksPerFrame,
          mode: spec.mode,
          color: spec.color,
          contentW: spec.contentW,
          contentH: spec.contentH,
        },
      });
    } catch (error) {
      reasons.push(`pack "${name}": ${spec.src}: ${(error as Error).message}`);
    }
  }
}

async function gatherSounds(
  name: string,
  manifest: PackManifest,
  slots: Map<string, Resource>,
  files: PackFiles,
  reasons: string[],
): Promise<void> {
  const sounds = manifest.sounds;
  if (sounds === undefined) return;

  // In `SOUND_NAMES` order, not object-key order, so the hash is stable.
  for (const sound of SOUND_NAMES) {
    const entry = sounds[sound];
    if (entry === undefined) continue;
    const path = typeof entry === 'string' ? entry : entry.file;
    const url = fileUrl(name, path);
    try {
      await files.bytes(url);
      const spec: SoundSpec = { url };
      if (typeof entry !== 'string') {
        if (entry.volume !== undefined) spec.volume = entry.volume;
        if (entry.polyphony !== undefined) spec.polyphony = entry.polyphony;
        if (entry.throttleMs !== undefined) spec.throttleMs = entry.throttleMs;
      }
      slots.set(`sounds.${sound}`, { url, sound: spec });
    } catch (error) {
      reasons.push(`pack "${name}": ${path}: ${(error as Error).message}`);
    }
  }
}

async function gatherHud(
  name: string,
  manifest: PackManifest,
  slots: Map<string, Resource>,
  files: PackFiles,
  reasons: string[],
): Promise<void> {
  const hud = manifest.hud;
  if (hud === undefined) return;

  for (const slot of ['life', 'bomb'] as const) {
    const path = hud[slot];
    if (path === undefined) continue;
    const url = fileUrl(name, path);
    try {
      await files.bytes(url);
      const image = await files.image(url);
      checkHudIcon(name, path, image, reasons);
      slots.set(`hud.${slot}`, { url, image });
    } catch (error) {
      reasons.push(`pack "${name}": ${path}: ${(error as Error).message}`);
    }
  }
}

/** A track to register via `replaceMusic` once the whole pack is proven clean. */
interface MusicRegistration {
  /** The name it registers under: bare for a built-in replacement, else `<pack>/<name>`. */
  name: string;
  spec: MusicSpec;
}

/**
 * Fetch and register the pack's `music` tracks.
 *
 * A track is presentation — a file, like a `sounds` entry — so its bytes join the
 * pack hash (in manifest-declared order, after the hud icons, keeping the hash
 * stable) and it lands in the slot map for the boot report. A NEW name (one no
 * built-in track carries) registers namespaced `<pack>/<name>`, so `inject.ts`'s
 * pack-first reference resolves to it; a name matching a built-in track REPLACES
 * that track's placeholder, bare and last-wins, exactly as a `sounds` reskin does.
 *
 * The `loopEnd ≤ duration` bound is the one check `manifest.ts` could not make —
 * it needs the decoded track — so it happens here, with the measured duration in
 * the error. Measuring is soft: no `OfflineAudioContext`, or a file that will not
 * decode, means the bound goes unchecked rather than rejecting the pack, because
 * the runtime (`Music.play`) clamps an out-of-range loop region to the whole track
 * anyway — the check is an authoring courtesy, not a safety gate.
 *
 * Nothing is registered here; the payloads are collected and `loadOnePack` calls
 * `replaceMusic` only once the whole pack is clean, so a rejected pack mutates no
 * registry.
 */
async function gatherMusic(
  name: string,
  manifest: PackManifest,
  slots: Map<string, Resource>,
  files: PackFiles,
  reasons: string[],
  registrations: MusicRegistration[],
): Promise<void> {
  const music = manifest.music;
  if (music === undefined) return;

  const builtin = new Set(musicNames());

  // Manifest-declared order, so the hash is stable for a given manifest.
  for (const track of Object.keys(music)) {
    const entry = music[track];
    if (entry === undefined) continue;
    const url = fileUrl(name, entry.file);
    try {
      await files.bytes(url);
    } catch (error) {
      reasons.push(`pack "${name}": ${entry.file}: ${(error as Error).message}`);
      continue;
    }
    // The one check that needs the decoded track. Soft — see the header.
    if (entry.loopEnd !== undefined) {
      const duration = await files.duration(url);
      if (duration !== undefined && entry.loopEnd > duration) {
        reasons.push(
          `pack "${name}": ${entry.file}: loopEnd ${entry.loopEnd}s is past the track's ` +
            `${duration.toFixed(3)}s — the loop would run off the end`,
        );
        continue;
      }
    }

    const registered = builtin.has(track) ? track : `${name}/${track}`;
    const spec: MusicSpec = { url };
    if (entry.loopStart !== undefined) spec.loopStart = entry.loopStart;
    if (entry.loopEnd !== undefined) spec.loopEnd = entry.loopEnd;
    if (entry.volume !== undefined) spec.volume = entry.volume;
    registrations.push({ name: registered, spec });
    slots.set(`music.${registered}`, { url });
  }
}

/** Decode `bytes` just far enough to read its duration, or `undefined` if it cannot. */
async function measureDuration(bytes: Uint8Array): Promise<number | undefined> {
  const Ctor = offlineAudioContextCtor();
  if (!Ctor) return undefined;
  try {
    const ctx = new Ctor(1, 1, 44100);
    // `decodeAudioData` detaches the buffer it is given, so hand it a copy — the
    // original bytes are still needed for the pack hash.
    const buffer = await ctx.decodeAudioData(bytes.slice().buffer);
    return buffer.duration;
  } catch {
    return undefined;
  }
}

type OfflineCtor = new (channels: number, length: number, sampleRate: number) => BaseAudioContext;

/** Looked up, never referenced directly — `bun test` has no `OfflineAudioContext`. */
function offlineAudioContextCtor(): OfflineCtor | undefined {
  const scope = globalThis as unknown as {
    OfflineAudioContext?: OfflineCtor;
    webkitOfflineAudioContext?: OfflineCtor;
  };
  return scope.OfflineAudioContext ?? scope.webkitOfflineAudioContext;
}

/** A portrait to register via `definePortrait` once the whole pack is clean. */
interface PortraitRegistration {
  /** The qualified name it registers under, `<pack>/<name>`. */
  name: string;
  /** The decoded, dimension-checked image drawn beside a dialogue line. */
  image: HTMLImageElement;
}

/**
 * Fetch, dimension-check and collect the pack's `portraits` for registration.
 *
 * A portrait is presentation — a file, like a `sounds` or `music` entry — so its
 * bytes join the pack hash (in manifest-declared order, after the music tracks,
 * keeping the hash stable) and it lands in the slot map for the boot report. It
 * registers under its qualified `<pack>/<name>` (see `loadOnePack`): a pack
 * portrait is content-qualified, matching the name `inject.ts` put in the boss
 * dialogue speaker, not a bare reskin of a built-in.
 *
 * The dimension check is EXACT — `PORTRAIT_SIZE`×`PORTRAIT_SIZE`, the ship-sheet
 * idiom, not the tolerant hud-icon bound — because the shell composites a portrait
 * into a fixed cell and a mismatch would stretch or crop it. The measured size is
 * named in the error, and a portrait bigger or smaller rejects the pack whole.
 *
 * Nothing is registered here; the payloads are collected and `loadOnePack` calls
 * `definePortrait` only once the whole pack is clean, so a rejected pack mutates
 * no registry.
 */
async function gatherPortraits(
  name: string,
  manifest: PackManifest,
  slots: Map<string, Resource>,
  files: PackFiles,
  reasons: string[],
  registrations: PortraitRegistration[],
): Promise<void> {
  const portraits = manifest.portraits;
  if (portraits === undefined) return;

  // Manifest-declared order, so the hash is stable for a given manifest.
  for (const portrait of Object.keys(portraits)) {
    const path = portraits[portrait];
    if (path === undefined) continue;
    const url = fileUrl(name, path);
    try {
      await files.bytes(url);
      const image = await files.image(url);
      checkPortrait(name, path, image, reasons);
      const registered = `${name}/${portrait}`;
      registrations.push({ name: registered, image });
      slots.set(`portrait.${registered}`, { url });
    } catch (error) {
      reasons.push(`pack "${name}": ${path}: ${(error as Error).message}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Machine checks (need a real canvas — the framebuffer oracle stays test:assets) */
/* ------------------------------------------------------------------ */

/**
 * A portrait must be exactly `PORTRAIT_SIZE`×`PORTRAIT_SIZE`. The shell draws it
 * into that fixed cell, so — unlike a hud icon, whose check is a `≤` bound — the
 * match is exact, the same discipline `checkShipSheet` holds the ship sheet to.
 */
function checkPortrait(
  name: string,
  path: string,
  image: HTMLImageElement,
  reasons: string[],
): void {
  if (image.naturalWidth !== PORTRAIT_SIZE || image.naturalHeight !== PORTRAIT_SIZE) {
    reasons.push(
      `pack "${name}": ${path}: portrait is ${image.naturalWidth}×${image.naturalHeight}, expected ${PORTRAIT_SIZE}×${PORTRAIT_SIZE}`,
    );
  }
}

/**
 * The bullet sheet must match the grid, keep every cell inside its padding, and
 * be white. The extent and whiteness checks are the browser-only half of the
 * spec `procedural.test.ts` cannot reach because `bun test` has no canvas.
 */
function checkBulletSheet(
  name: string,
  path: string,
  image: HTMLImageElement,
  reasons: string[],
): void {
  const width = BULLET_GRID.cellW * BULLET_COLUMNS;
  const height = BULLET_GRID.cellH * BULLET_ROWS;
  if (image.naturalWidth !== width || image.naturalHeight !== height) {
    reasons.push(
      `pack "${name}": ${path}: sheet is ${image.naturalWidth}×${image.naturalHeight}, ` +
        `expected ${width}×${height} (${BULLET_COLUMNS}×${BULLET_ROWS} cells of ${BULLET_GRID.cellW}×${BULLET_GRID.cellH})`,
    );
    return;
  }

  const data = pixels(image, width, height);
  if (data === undefined) return; // no 2D context — cannot check, do not reject

  BULLET_CELLS.forEach((cell, index) => {
    if (index >= BULLET_COLUMNS * BULLET_ROWS) return;
    const col = index % BULLET_COLUMNS;
    const row = Math.floor(index / BULLET_COLUMNS);
    const x0 = col * BULLET_GRID.cellW;
    const y0 = row * BULLET_GRID.cellH;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let satSum = 0;
    let satCount = 0;

    for (let y = y0; y < y0 + BULLET_GRID.cellH; y++) {
      for (let x = x0; x < x0 + BULLET_GRID.cellW; x++) {
        const i = (y * width + x) * 4;
        const a = data[i + 3] as number;
        if (a >= BULLET_ALPHA_PAINTED) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        if (a >= SATURATION_ALPHA_FLOOR) {
          satSum += saturation(data[i] as number, data[i + 1] as number, data[i + 2] as number);
          satCount++;
        }
      }
    }

    if (maxX >= minX) {
      const extentX = maxX - minX + 1;
      const extentY = maxY - minY + 1;
      const extent = Math.max(extentX, extentY);
      if (extent > MAX_CELL_EXTENT) {
        reasons.push(
          `pack "${name}": ${path}: cell "${cell}" paints ${extentX}×${extentY}px, ` +
            `over the ${MAX_CELL_EXTENT}px limit — a cell must clear 2px of margin or it bleeds across the seam`,
        );
      }
    }

    if (satCount > 0) {
      const mean = satSum / satCount;
      if (mean > BULLET_SATURATION_MAX) {
        reasons.push(
          `pack "${name}": ${path}: cell "${cell}" has mean saturation ${mean.toFixed(2)}, ` +
            `over ${BULLET_SATURATION_MAX} — bullets are white and colour is the engine's tint`,
        );
      }
    }
  });
}

/* ------------------------------------------------------------------ */
/* Native animation-strip gates (self-describing sheets)              */
/* ------------------------------------------------------------------ */

/** The measured geometry of a strip, defaults applied — the shape the gates read. */
export interface MeasuredStrip {
  frameW: number;
  frameH: number;
  frames: number;
  stride: number;
  color: 'tinted' | 'baked';
}

/**
 * Exclusive source boundary of a horizontal strip. The final frame begins at
 * `(frames - 1) * stride`; only its own `frameW` extends past that origin.
 */
export function stripSourceEnd(
  strip: Pick<MeasuredStrip, 'frameW' | 'frameH' | 'frames' | 'stride'>,
  x0 = 0,
  y0 = 0,
): { x: number; y: number } {
  return {
    x: x0 + (strip.frames - 1) * strip.stride + strip.frameW,
    y: y0 + strip.frameH,
  };
}

/** Normalize a manifest strip (bullet, ship or effect) to a `MeasuredStrip`. */
function toStrip(s: {
  frameW: number;
  frameH: number;
  frames?: number;
  stride?: number;
  color?: 'tinted' | 'baked';
}): MeasuredStrip {
  return {
    frameW: s.frameW,
    frameH: s.frameH,
    frames: s.frames ?? 1,
    stride: s.stride ?? s.frameW,
    color: s.color ?? 'tinted',
  };
}

/**
 * The per-frame seam + saturation measurement shared by every strip surface.
 * `x0,y0` is frame 0's origin on the sheet the pixels came from; frames walk
 * right by `stride`. Emits the inter-frame seam string (a frame's painted extent
 * over `frameW − 2·FX_PAD`, the same class `MAX_CELL_EXTENT` catches, now per
 * frame) and — only for a `tinted` strip — the mean-saturation string. A `baked`
 * strip skips saturation: it declares its colour and imports losslessly.
 */
export function measureStripFrames(
  name: string,
  path: string,
  stripName: string,
  strip: MeasuredStrip,
  data: Uint8ClampedArray,
  sheetW: number,
  x0: number,
  y0: number,
  reasons: string[],
  allowLongAxisFill = false,
): void {
  measureStripFramesWithPolicy(
    name,
    path,
    stripName,
    strip,
    data,
    sheetW,
    x0,
    y0,
    reasons,
    { allowLongAxisFill, requirePaint: false, independentMargins: false },
  );
}

/**
 * Actor-only frame gate.
 *
 * Unlike a projectile/effect strip, a known actor strip suppresses the ordinary
 * ship/bullet fallback. Every frame therefore has to contain paint, and padding
 * must be checked on each side independently: a narrow silhouette touching the
 * left edge can satisfy an extent-only test while still sampling its neighbour.
 */
export function measureActorStripFrames(
  name: string,
  path: string,
  stripName: string,
  strip: MeasuredStrip,
  data: Uint8ClampedArray,
  sheetW: number,
  x0: number,
  y0: number,
  reasons: string[],
): void {
  measureStripFramesWithPolicy(
    name,
    path,
    stripName,
    strip,
    data,
    sheetW,
    x0,
    y0,
    reasons,
    { allowLongAxisFill: false, requirePaint: true, independentMargins: true },
  );
}

interface StripFrameMeasurementPolicy {
  readonly allowLongAxisFill: boolean;
  readonly requirePaint: boolean;
  readonly independentMargins: boolean;
}

function measureStripFramesWithPolicy(
  name: string,
  path: string,
  stripName: string,
  strip: MeasuredStrip,
  data: Uint8ClampedArray,
  sheetW: number,
  x0: number,
  y0: number,
  reasons: string[],
  policy: StripFrameMeasurementPolicy,
): void {
  const { allowLongAxisFill, requirePaint, independentMargins } = policy;
  const limitX = allowLongAxisFill ? strip.frameW : strip.frameW - 2 * FX_PAD;
  const limitY = strip.frameH - 2 * FX_PAD;
  for (let f = 0; f < strip.frames; f++) {
    const fx0 = x0 + f * strip.stride;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let satSum = 0;
    let satCount = 0;
    for (let y = y0; y < y0 + strip.frameH; y++) {
      for (let x = fx0; x < fx0 + strip.frameW; x++) {
        const i = (y * sheetW + x) * 4;
        const a = data[i + 3] as number;
        if (a >= BULLET_ALPHA_PAINTED) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        if (a >= SATURATION_ALPHA_FLOOR) {
          satSum += saturation(data[i] as number, data[i + 1] as number, data[i + 2] as number);
          satCount++;
        }
      }
    }
    if (maxX >= minX) {
      const ex = maxX - minX + 1;
      const ey = maxY - minY + 1;
      if (independentMargins) {
        const margins = [
          ['left', minX - fx0],
          ['right', fx0 + strip.frameW - 1 - maxX],
          ['top', minY - y0],
          ['bottom', y0 + strip.frameH - 1 - maxY],
        ] as const;
        for (const [side, margin] of margins) {
          if (margin >= FX_PAD) continue;
          reasons.push(
            `pack "${name}": ${path}: strip "${stripName}" frame ${f} clears ${margin}px on its ${side} edge, ` +
              `expected at least ${FX_PAD}px — actor frames need an independent transparent gutter on every side`,
          );
        }
      } else {
        if (allowLongAxisFill && ex !== strip.frameW) {
          reasons.push(
            `pack "${name}": ${path}: strip "${stripName}" frame ${f} paints ${ex}px on +x, ` +
              `expected full frameW ${strip.frameW}px — a registered laser body must meet muzzle/tip and adjacent tiles`,
          );
        }
        if (ex > limitX || ey > limitY) {
          const seamRule = allowLongAxisFill
            ? 'a registered laser body may fill its +x axis, but must clear 2px of cross-axis margin'
            : 'a frame must clear 2px of margin on each axis or it bleeds into the next frame';
          reasons.push(
            `pack "${name}": ${path}: strip "${stripName}" frame ${f} paints ${ex}×${ey}px, ` +
              `over the ${limitX}×${limitY}px limit — ${seamRule}`,
          );
        }
      }
    } else if (requirePaint) {
      reasons.push(
        `pack "${name}": ${path}: strip "${stripName}" frame ${f} has no painted pixels — actor frames must not be empty`,
      );
    }
    if (strip.color === 'tinted' && satCount > 0) {
      const mean = satSum / satCount;
      if (mean > BULLET_SATURATION_MAX) {
        reasons.push(
          `pack "${name}": ${path}: strip "${stripName}" has mean saturation ${mean.toFixed(2)}, ` +
            `over ${BULLET_SATURATION_MAX} — a tinted strip is white and colour is the engine's tint (declare color: "baked" for coloured art)`,
        );
      }
    }
  }
}

/**
 * Validate an own-file strip or an explicitly placed strip on a shared PNG.
 * Legacy PackStrip declarations omit placement and retain the exact whole-file
 * check. An explicit x/y/stride switches to bounds-checking, so several winner
 * slots may crop different rows/columns out of one decoded source image.
 */
function checkStripSheet(
  name: string,
  path: string,
  stripName: string,
  strip: MeasuredStrip,
  image: HTMLImageElement,
  reasons: string[],
  placement?: { x?: number; y?: number; stride?: number },
  allowLongAxisFill = false,
): void {
  const w = image.naturalWidth;
  const h = image.naturalHeight;
  const explicitlyPlaced =
    placement !== undefined &&
    (placement.x !== undefined || placement.y !== undefined || placement.stride !== undefined);
  const x0 = placement?.x ?? 0;
  const y0 = placement?.y ?? 0;
  const end = stripSourceEnd(strip, x0, y0);

  if (explicitlyPlaced) {
    if (end.x > w || end.y > h) {
      reasons.push(
        `pack "${name}": ${path}: strip "${stripName}" runs to ${end.x}×${end.y}, ` +
          `past the ${w}×${h} sheet (${strip.frames} frames of ${strip.frameW}×${strip.frameH} at ${x0},${y0})`,
      );
      return;
    }
  } else if (w !== end.x || h !== end.y) {
    reasons.push(
      `pack "${name}": ${path}: strip "${stripName}" sheet is ${w}×${h}, ` +
        `expected ${end.x}×${end.y} (${strip.frames} frames of ${strip.frameW}×${strip.frameH})`,
    );
    return;
  }
  const data = pixels(image, w, h);
  if (data === undefined) return; // no 2D context — cannot measure, do not reject
  measureStripFrames(
    name,
    path,
    stripName,
    strip,
    data,
    w,
    x0,
    y0,
    reasons,
    allowLongAxisFill,
  );
}

/**
 * A self-describing native bullet sheet — the whole bullet atlas on one shared
 * PNG. It must cover every floor cell (a strips sheet replaces the atlas
 * wholesale); a floor cell declared `baked` WARNS and falls back to tinted
 * treatment (it never silently muds a tint-coded campaign — amendment §1.5), so
 * that is a console warning, not a rejection. Each strip is then bounds-checked
 * against the sheet and measured per frame for the seam and (if tinted) the
 * saturation gate.
 */
function checkNativeBulletSheet(
  name: string,
  path: string,
  strips: Record<string, PackBulletStrip>,
  image: HTMLImageElement,
  reasons: string[],
): void {
  const floor = new Set<string>(BULLET_CELLS as readonly string[]);
  for (const cell of BULLET_CELLS) {
    if (!(cell in strips)) {
      reasons.push(
        `pack "${name}": ${path}: self-describing bullet sheet is missing floor cell "${cell}" — ` +
          `a strips sheet is the whole bullet atlas and must define every one of the ${BULLET_CELLS.length} built-in cells (plus any new variants)`,
      );
    }
  }

  const w = image.naturalWidth;
  const h = image.naturalHeight;
  const data = pixels(image, w, h);

  for (const [stripName, raw] of Object.entries(strips)) {
    if (floor.has(stripName) && (raw.color ?? 'tinted') === 'baked') {
      // A warning, not a rejection — the sheet loads and the strip falls back to
      // tinted-white treatment so a baked floor cell cannot mud the campaign.
      console.warn(
        `pack "${name}": ${path}: floor cell "${stripName}" is declared color: "baked" — ` +
          `a floor cell is drawn with the per-instance tint content applies to it, which a baked colour fights; ship baked colour as a qualified variant instead`,
      );
    }
    // A floor cell is always drawn with the per-instance tint content applies to
    // it, so it is measured as tinted regardless of what it declared: that is the
    // "falls back to tinted treatment" the warning above promises. Forcing tinted
    // here is what makes the saturation gate run — a genuinely coloured floor cell
    // is then rejected rather than shipped to mud the campaign; an actually-white
    // baked-tagged cell passes untouched.
    const strip = toStrip(floor.has(stripName) ? { ...raw, color: 'tinted' } : raw);
    const { x: runsToX, y: runsToY } = stripSourceEnd(strip, raw.x, raw.y);
    if (runsToX > w || runsToY > h) {
      reasons.push(
        `pack "${name}": ${path}: strip "${stripName}" runs to ${runsToX}×${runsToY}, ` +
          `past the ${w}×${h} sheet (${strip.frames} frames of ${strip.frameW}×${strip.frameH} at ${raw.x},${raw.y})`,
      );
      continue;
    }
    if (data !== undefined) {
      measureStripFrames(name, path, stripName, strip, data, w, raw.x, raw.y, reasons);
    }
  }
}

/**
 * A self-describing actor sheet. It has no required floor vocabulary — actor
 * semantics decide which known strips they can use — but every declared strip
 * is bounds/seam checked against one decoded pixel buffer. Decoding once matters
 * here: v4 carries 26 actor strips across three large sheets.
 */
function checkNativeActorSheet(
  name: string,
  path: string,
  strips: Record<string, PackBulletStrip>,
  image: HTMLImageElement,
  reasons: string[],
): void {
  const w = image.naturalWidth;
  const h = image.naturalHeight;
  const data = pixels(image, w, h);
  for (const [stripName, raw] of Object.entries(strips)) {
    const strip = toStrip(raw);
    const { x: runsToX, y: runsToY } = stripSourceEnd(strip, raw.x, raw.y);
    if (runsToX > w || runsToY > h) {
      reasons.push(
        `pack "${name}": ${path}: strip "${stripName}" runs to ${runsToX}×${runsToY}, ` +
          `past the ${w}×${h} sheet (${strip.frames} frames of ${strip.frameW}×${strip.frameH} at ${raw.x},${raw.y})`,
      );
      continue;
    }
    if (data !== undefined) {
      measureActorStripFrames(name, path, stripName, strip, data, w, raw.x, raw.y, reasons);
    }
  }
}

/**
 * The ship sheet is one 64×64 cell. Only its dimensions are machine-checked
 * here; the hitbox marker a ship should carry (a bright centre disc, far
 * smaller than the silhouette — see `createShipAtlas`) is a readability
 * property no single pixel test measures reliably, so it is judged by eye on the
 * visual pages rather than asserted with a fabricated threshold.
 */
function checkShipSheet(
  name: string,
  path: string,
  image: HTMLImageElement,
  reasons: string[],
): void {
  if (image.naturalWidth !== 64 || image.naturalHeight !== 64) {
    reasons.push(
      `pack "${name}": ${path}: ship sheet is ${image.naturalWidth}×${image.naturalHeight}, expected 64×64`,
    );
  }
}

function checkHudIcon(
  name: string,
  path: string,
  image: HTMLImageElement,
  reasons: string[],
): void {
  if (image.naturalWidth > HUD_ICON_MAX || image.naturalHeight > HUD_ICON_MAX) {
    reasons.push(
      `pack "${name}": ${path}: hud icon is ${image.naturalWidth}×${image.naturalHeight}, ` +
        `over the ${HUD_ICON_MAX}×${HUD_ICON_MAX} limit — it stands in for a glyph, so it is drawn small`,
    );
  }
}

/** Saturation in [0,1] of an 8-bit RGB triple. 0 for any grey, white or black. */
function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  if (max === 0) return 0;
  const min = Math.min(r, g, b);
  return (max - min) / max;
}

/* ------------------------------------------------------------------ */
/* Fetch, decode, report                                              */
/* ------------------------------------------------------------------ */

function fileUrl(name: string, path: string): string {
  return `/packs/${name}/${path}`;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not be fetched (HTTP ${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Decode an image to an `HTMLImageElement`, rejecting on a load error. */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('could not be decoded as an image'));
    image.src = url;
  });
}

/** One decoded image may back many strips; read its full RGBA plane only once. */
const PIXELS_BY_IMAGE = new WeakMap<HTMLImageElement, { data: Uint8ClampedArray | undefined }>();

/** RGBA pixels of an image via a scratch canvas, or undefined with no context. */
function pixels(image: HTMLImageElement, width: number, height: number): Uint8ClampedArray | undefined {
  const cached = PIXELS_BY_IMAGE.get(image);
  if (cached !== undefined) return cached.data;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    PIXELS_BY_IMAGE.set(image, { data: undefined });
    return undefined;
  }
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, width, height).data;
  PIXELS_BY_IMAGE.set(image, { data });
  return data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The boot report: which pack won each slot, what overrode what, what failed.
 *
 * Always to the console; surfaced on screen only when a specific pack was asked
 * for (`?pack=`) or something failed — the two cases where a developer is
 * looking and the field alone cannot tell them whether it took effect.
 */
function report(state: {
  winners: Map<string, Winner>;
  overrides: string[];
  loaded: LoadedRecord[];
  failures: { name: string; reasons: string[] }[];
  /** True only for an explicit `?pack=` audit, never for the implicit v4 default. */
  surfaceRequested: boolean;
}): void {
  const { winners, overrides, loaded, failures, surfaceRequested } = state;
  const lines: string[] = ['packs: boot report'];

  const order = slotOrder();
  // Music and portrait slots are dynamic (their names come from the pack), so
  // they are not in the fixed `slotOrder`; append them sorted, after the fixed
  // resource slots, music before portraits to match the hash order.
  const musicSlots = [...winners.keys()].filter((slot) => slot.startsWith('music.')).sort();
  const portraitSlots = [...winners.keys()].filter((slot) => slot.startsWith('portrait.')).sort();
  const active = [...order, ...musicSlots, ...portraitSlots].filter((slot) => winners.has(slot));
  const stripLines = stripWinnerLines(winners);
  if (active.length === 0 && stripLines.length === 0) {
    lines.push('  (no pack resources active — running on placeholders)');
  } else {
    for (const slot of active) {
      const winner = winners.get(slot);
      if (!winner) continue;
      const detail = winner.value ?? winner.url ?? '';
      lines.push(`  ${slot}: ${winner.source}${detail ? `  (${detail})` : ''}`);
    }
    lines.push(...stripLines);
  }

  for (const line of overrides) lines.push(`  override: ${line}`);

  // Content a pack registered, one line per section, so a developer can see the
  // data — not just the reskin — took effect. Not golden: informational, like
  // the slot lines above.
  for (const pack of loaded) {
    if (pack.content === undefined) continue;
    for (const [section, n] of pack.content.counts) {
      lines.push(`  content.${section}: ${pack.name} (${n} registered)`);
    }
    for (const chain of pack.content.stageChains) {
      lines.push(`  content.stages: ${pack.name} (${chain})`);
    }
  }

  for (const failure of failures) {
    lines.push(`  FAILED ${failure.name}:`);
    for (const reason of failure.reasons) lines.push(`    - ${reason}`);
  }

  lines.push(`  meta: ${packsMetaString(loaded) || '(none)'}`);

  const text = lines.join('\n');
  if (failures.length > 0) console.warn(text);
  else console.log(text);

  if (shouldSurfacePackReport(surfaceRequested, failures.length)) surface(text);
}

/** Keep the plain v4 title clean while preserving explicit audits and failures. */
export function shouldSurfacePackReport(explicitPackQuery: boolean, failureCount: number): boolean {
  return explicitPackQuery || failureCount > 0;
}

/**
 * The four strip pools can carry dozens of independently winning slots. Report
 * them by pool and source rather than hiding them (the old fixed slot list did)
 * or printing one line per sprite. Per-strip winner resolution is unchanged;
 * this is only a compact view over the resolved map.
 */
function stripWinnerLines(winners: Map<string, Winner>): string[] {
  const lines: string[] = [];
  for (const section of ['effects', 'lasers', 'missiles', 'pickups'] as const) {
    const prefix = `assets.${section}.`;
    const counts = new Map<string, number>();
    for (const [slot, winner] of winners) {
      if (!slot.startsWith(prefix)) continue;
      counts.set(winner.source, (counts.get(winner.source) ?? 0) + 1);
    }
    for (const source of [...counts.keys()].sort()) {
      const count = counts.get(source) ?? 0;
      lines.push(`  assets.${section}: ${source} (${count} strip winner${count === 1 ? '' : 's'})`);
    }
  }
  return lines;
}

/** Every slot a pack can win, in report order. Sounds follow `SOUND_NAMES`. */
function slotOrder(): string[] {
  return [
    ...RESOURCE_ORDER,
    'assets.filter',
    ...SOUND_NAMES.map((sound) => `sounds.${sound}`),
    'hud.life',
    'hud.bomb',
  ];
}

/**
 * Paint the report over the field. A plain `<pre>`, non-interactive, so it
 * never intercepts input meant for the game beneath it. It dismisses itself on
 * the first keypress: pressing a key means the developer has read it and is
 * playing, and a panel that stayed would sit exactly where the HUD and the
 * opening wave draw. The full text is always in the console regardless.
 * Guarded because the loader must not throw into boot even if the DOM is not
 * what it expects.
 */
function surface(text: string): void {
  try {
    if (typeof document === 'undefined') return;
    const host = document.getElementById('stage') ?? document.body;
    if (!host) return;
    const pre = document.createElement('pre');
    pre.textContent = text;
    pre.style.cssText = [
      'position:absolute',
      'left:0',
      'top:0',
      'margin:0',
      'padding:8px',
      'max-width:100%',
      'box-sizing:border-box',
      'font:11px/1.4 monospace',
      'color:#9a9aa4',
      'background:rgba(0,0,0,0.75)',
      'white-space:pre-wrap',
      'pointer-events:none',
      'z-index:10',
    ].join(';');
    host.appendChild(pre);
    addEventListener('keydown', () => pre.remove(), { once: true });
  } catch {
    // Reporting is a courtesy; failing to draw it must never take down boot.
  }
}
