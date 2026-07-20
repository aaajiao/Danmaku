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

import {
  BULLET_CELLS,
  BULLET_COLUMNS,
  BULLET_GRID,
  BULLET_ROWS,
  MAX_CELL_EXTENT,
} from '../render/procedural';
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
}

const NONE: LoadedPacks = {
  filter: 'nearest',
  soundUrls: {},
  hudIcons: {},
  packsMeta: '',
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

  const winners = new Map<string, Winner>();
  const overrides: string[] = [];
  const loaded: { name: string; hash: string }[] = [];
  const failures: { name: string; reasons: string[] }[] = [];

  for (const name of names) {
    try {
      const pack = await loadOnePack(name);
      for (const [slot, resource] of pack.slots) {
        const prior = winners.get(slot);
        if (prior) overrides.push(`${slot} ← "${name}" (overrode "${prior.source}")`);
        winners.set(slot, { source: name, ...resource });
      }
      loaded.push({ name, hash: pack.hash });
    } catch (error) {
      // Skipped whole, named — a partly-applied pack is worse than no pack.
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

interface OnePack {
  slots: Map<string, Resource>;
  hash: string;
}

/**
 * Validate one pack and fetch every resource it declares, all-or-nothing.
 *
 * Every reason is collected before the first is thrown, because a hand-editing
 * author wants the whole list, and the pack is rejected as a unit either way.
 */
async function loadOnePack(name: string): Promise<OnePack> {
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
  return { slots, hash };
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
  loaded: { name: string; hash: string }[];
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
