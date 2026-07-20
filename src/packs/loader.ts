/**
 * The browser half of the pack system: discover packs, validate their
 * manifests, fetch and machine-check their assets, and hand `main.ts` a flat
 * set of URLs and decoded icons to build atlases and re-register sounds from.
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

import { backgroundNames } from '../render/background';
import {
  BULLET_CELLS,
  SHIP_CELLS,
  BULLET_COLUMNS,
  BULLET_GRID,
  BULLET_ROWS,
  MAX_CELL_EXTENT,
} from '../render/procedural';
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
  /** Winning ship sheet URL, if any pack supplied one. */
  shipUrl?: string;
  /** Texture sampling for both sheets. `nearest` matches `loadTexture`. */
  filter: 'nearest' | 'linear';
  /** Registered-sound name → winning URL. Fed through `defineSound`'s url branch. */
  soundUrls: Record<string, string>;
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
  soundUrls: {},
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
 * CLAUDE.md), so a coloured sheet is a mistake the tint would then double. Pure
 * white or grey art — including its antialiased edges — measures ~0.
 */
const BULLET_SATURATION_MAX = 0.15;

/** Opacity a pixel needs before it counts toward a cell's saturation mean. */
const SATURATION_ALPHA_FLOOR = 128;

/** Hud icons stand in for a glyph and are drawn small; larger is a mistake. */
const HUD_ICON_MAX = 16;

/**
 * The two sheet slots, which lead the boot-report ordering. The full canonical
 * order files are fetched and hashed in — bullets, ship, sounds in
 * `SOUND_NAMES` order, then hud — is fixed by the call order of the `gather*`
 * functions, not by JSON key order, so the recorded hash is stable regardless
 * of how an author wrote their manifest.
 */
const RESOURCE_ORDER = ['assets.bullets', 'assets.ship'] as const;

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

  const only = packParam();
  if (only !== null) names = names.filter((name) => name === only);
  if (names.length === 0) {
    // Either genuinely no packs, or `?pack=` named one that is not on disk. The
    // first is identical to today; the second is worth surfacing, so the report
    // still runs when the query is present.
    report({ winners: new Map(), overrides: [], loaded: [], failures: [], only });
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
    sprites: [...BULLET_CELLS],
    shipSprites: [...SHIP_CELLS],
    scenes: backgroundNames(),
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

  report({ winners, overrides, loaded, failures, only });

  const soundUrls: Record<string, string> = {};
  for (const sound of SOUND_NAMES) {
    const url = winners.get(`sounds.${sound}`)?.url;
    if (url !== undefined) soundUrls[sound] = url;
  }

  return {
    bulletsUrl: winners.get('assets.bullets')?.url,
    shipUrl: winners.get('assets.ship')?.url,
    filter: (winners.get('assets.filter')?.value as 'nearest' | 'linear') ?? 'nearest',
    soundUrls,
    hudIcons: {
      life: winners.get('hud.life')?.image,
      bomb: winners.get('hud.bomb')?.image,
    },
    packsMeta: packsMetaString(loaded),
    campaigns,
    characterPacks,
  };
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
  /** A decoded hud icon, kept so `drawHud` need not decode it again. */
  image?: HTMLImageElement;
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
  const orderedBytes: Uint8Array[] = [];
  const reasons: string[] = [];

  await gatherAssets(name, manifest, slots, orderedBytes, reasons);
  await gatherSounds(name, manifest, slots, orderedBytes, reasons);
  await gatherHud(name, manifest, slots, orderedBytes, reasons);

  if (reasons.length > 0) throw new PackError(reasons);

  const hash = await hashPack(manifestBytes, orderedBytes);

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
  let campaigns: LoadedCampaign[] = [];
  let characterPacks: LoadedCharacterPack[] = [];
  try {
    ({ campaigns, characterPacks } = attachIdentity(
      injectPack(manifest, injectContext),
      packsData,
    ));
  } catch (error) {
    if (error instanceof PackInjectError) throw new PackError([...error.problems]);
    throw error;
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
  orderedBytes: Uint8Array[],
  reasons: string[],
): Promise<void> {
  const assets = manifest.assets;
  if (assets === undefined) return;

  if (assets.bullets !== undefined) {
    const url = fileUrl(name, assets.bullets);
    try {
      orderedBytes.push(await fetchBytes(url));
      const image = await loadImage(url);
      checkBulletSheet(name, assets.bullets, image, reasons);
      slots.set('assets.bullets', { url });
    } catch (error) {
      reasons.push(`pack "${name}": ${assets.bullets}: ${(error as Error).message}`);
    }
  }

  if (assets.ship !== undefined) {
    const url = fileUrl(name, assets.ship);
    try {
      orderedBytes.push(await fetchBytes(url));
      const image = await loadImage(url);
      checkShipSheet(name, assets.ship, image, reasons);
      slots.set('assets.ship', { url });
    } catch (error) {
      reasons.push(`pack "${name}": ${assets.ship}: ${(error as Error).message}`);
    }
  }

  // A value, not a file: it rides no bytes and orders after the sheets it tunes.
  if (assets.filter !== undefined) {
    slots.set('assets.filter', { value: assets.filter });
  }
}

async function gatherSounds(
  name: string,
  manifest: PackManifest,
  slots: Map<string, Resource>,
  orderedBytes: Uint8Array[],
  reasons: string[],
): Promise<void> {
  const sounds = manifest.sounds;
  if (sounds === undefined) return;

  // In `SOUND_NAMES` order, not object-key order, so the hash is stable.
  for (const sound of SOUND_NAMES) {
    const path = sounds[sound];
    if (path === undefined) continue;
    const url = fileUrl(name, path);
    try {
      orderedBytes.push(await fetchBytes(url));
      slots.set(`sounds.${sound}`, { url });
    } catch (error) {
      reasons.push(`pack "${name}": ${path}: ${(error as Error).message}`);
    }
  }
}

async function gatherHud(
  name: string,
  manifest: PackManifest,
  slots: Map<string, Resource>,
  orderedBytes: Uint8Array[],
  reasons: string[],
): Promise<void> {
  const hud = manifest.hud;
  if (hud === undefined) return;

  for (const slot of ['life', 'bomb'] as const) {
    const path = hud[slot];
    if (path === undefined) continue;
    const url = fileUrl(name, path);
    try {
      orderedBytes.push(await fetchBytes(url));
      const image = await loadImage(url);
      checkHudIcon(name, path, image, reasons);
      slots.set(`hud.${slot}`, { url, image });
    } catch (error) {
      reasons.push(`pack "${name}": ${path}: ${(error as Error).message}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Machine checks (need a real canvas — the framebuffer oracle stays test:assets) */
/* ------------------------------------------------------------------ */

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

/** RGBA pixels of an image via a scratch canvas, or undefined with no context. */
function pixels(image: HTMLImageElement, width: number, height: number): Uint8ClampedArray | undefined {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, width, height).data;
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
  only: string | null;
}): void {
  const { winners, overrides, loaded, failures, only } = state;
  const lines: string[] = ['packs: boot report'];

  const order = slotOrder();
  const active = order.filter((slot) => winners.has(slot));
  if (active.length === 0) {
    lines.push('  (no pack resources active — running on placeholders)');
  } else {
    for (const slot of active) {
      const winner = winners.get(slot);
      if (!winner) continue;
      const detail = winner.value ?? winner.url ?? '';
      lines.push(`  ${slot}: ${winner.source}${detail ? `  (${detail})` : ''}`);
    }
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

  if (only !== null || failures.length > 0) surface(text);
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
