/**
 * Dialogue portraits: a render-side registry of speaker faces.
 *
 * A `DialogueLine.speaker` (`src/sim/boss.ts`) is an opaque **portrait name** —
 * the simulation never learns portraits exist (the import boundary; CLAUDE.md).
 * The shell resolves that name here, the same drop-in-registry shape as every
 * other extension point: a boss says `speaker: 'sentinel'`, and what a sentinel
 * *looks* like is decided in this file and nowhere the sim can see.
 *
 * ## The procedural placeholder is the permanent floor
 *
 * Like bullets and ships, a portrait never blocks on art. `portraitImage(name)`
 * returns a drawable for **any** string — a registered face if one exists, a
 * deterministic tinted silhouette carrying the name otherwise. An unknown
 * speaker therefore renders a legible placeholder rather than throwing, which is
 * what lets a boss author dialogue before any portrait is drawn.
 *
 * The silhouette's tint is either declared (the built-ins tint themselves to
 * read as their boss) or **seeded from the name** — a deterministic hash, not an
 * RNG draw. This is presentation only and reaches the framebuffer and stops, so
 * it has the fx-side licence rule 2 draws the line at: no `sim` stream is
 * touched and no gameplay depends on the colour.
 *
 * ## Fixed cell size
 *
 * `PORTRAIT_SIZE` (96) is the one square a pack portrait must be — the manifest
 * loader enforces the identical number, the way `SHIP_SIZE` gates the ship
 * sheet. A supplied image registers as `PortraitSpec.image` and is drawn in
 * place of the silhouette; the tint path is the fallback for names with no art.
 *
 * ## Where the pixels live
 *
 * The painter needs a 2D canvas, so it runs in the browser only — `bun test` has
 * no DOM. What `bun test` proves is the registry (`definePortrait`,
 * `portraitNames`, `hasPortrait`) and the pure tint arithmetic (`tintFor`,
 * `seededTint`); the drawn result is judged in the browser, noted on the dialogue
 * visual check. Nothing here paints at import time — built-in registration
 * records tints only, so importing this module is DOM-free.
 */

/** The one square a portrait occupies. A pack portrait must match it exactly. */
export const PORTRAIT_SIZE = 96;

export interface PortraitSpec {
  /**
   * Silhouette tint (channels 0..1). Omit to seed a tint from the name — a
   * declared tint is how a built-in reads as its boss.
   */
  tint?: { r: number; g: number; b: number };
  /**
   * Supplied portrait art, drawn instead of the procedural silhouette. A pack
   * registers this after the loader has dimension-checked it against
   * `PORTRAIT_SIZE`; built-ins leave it unset and rely on the silhouette.
   */
  image?: CanvasImageSource;
}

const registry = new Map<string, PortraitSpec>();

/** Mirrors `defineBackground`: a duplicate name is a bug, not a silent override. */
export function definePortrait(name: string, spec: PortraitSpec): void {
  if (registry.has(name)) {
    throw new Error(`portrait "${name}" is already defined`);
  }
  registry.set(name, spec);
}

export function hasPortrait(name: string): boolean {
  return registry.has(name);
}

export function getPortraitSpec(name: string): PortraitSpec | undefined {
  return registry.get(name);
}

export function portraitNames(): readonly string[] {
  return [...registry.keys()];
}

/**
 * FNV-1a over the name — a stable hash, so a given speaker always seeds the same
 * colour across runs and machines. `Math.imul` and `>>>` are IEEE-exact integer
 * ops; this is presentation, but there is no reason to make it non-deterministic.
 */
function hashName(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Piecewise HSV→RGB, no trig — deterministic and headless-safe. `h` in [0,1). */
function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return { r: v, g: t, b: p };
    case 1: return { r: q, g: v, b: p };
    case 2: return { r: p, g: v, b: t };
    case 3: return { r: p, g: q, b: v };
    case 4: return { r: t, g: p, b: v };
    default: return { r: v, g: p, b: q };
  }
}

/**
 * A stable pastel tint for a name with no declared one. Mid saturation and value
 * keep it legible and distinct without approaching a bullet's white.
 */
export function seededTint(name: string): { r: number; g: number; b: number } {
  return hsvToRgb((hashName(name) % 360) / 360, 0.5, 0.85);
}

/** The tint a name paints with: its declared one, else the seeded fallback. */
export function tintFor(name: string): { r: number; g: number; b: number } {
  return getPortraitSpec(name)?.tint ?? seededTint(name);
}

/* ------------------------------------------------------------------ */
/* Painter (browser only — needs a 2D canvas)                          */
/* ------------------------------------------------------------------ */

const cache = new Map<string, HTMLCanvasElement>();

function channel(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/**
 * Paint the placeholder: a dark tinted panel, a bust silhouette, and the name.
 *
 * Kept under the negative-space budget — the fill peaks well below white and the
 * panel stays dark — because the box composites over a field the player is still
 * flying across even though the bullets are cleared.
 */
function paintSilhouette(name: string): HTMLCanvasElement {
  const size = PORTRAIT_SIZE;
  const el = document.createElement('canvas');
  el.width = size;
  el.height = size;
  const ctx = el.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  const { r, g, b } = tintFor(name);

  // Panel: a dark vertical gradient, faintly tinted so the whole cell reads as
  // this speaker's even before the silhouette is parsed.
  const bg = ctx.createLinearGradient(0, 0, 0, size);
  bg.addColorStop(0, `rgb(${channel(r * 26)},${channel(g * 26)},${channel(b * 30)})`);
  bg.addColorStop(1, `rgb(${channel(r * 12)},${channel(g * 12)},${channel(b * 16)})`);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  // Bust: shoulders rising from the base, a head above. Filled with the tint at
  // moderate luminance (~0.6 peak), never white.
  ctx.fillStyle = `rgba(${channel(r * 150)},${channel(g * 150)},${channel(b * 160)},0.9)`;
  const cx = size / 2;
  ctx.beginPath();
  ctx.moveTo(cx - 34, size);
  ctx.quadraticCurveTo(cx - 30, size - 34, cx - 16, size - 42);
  ctx.quadraticCurveTo(cx, size - 48, cx + 16, size - 42);
  ctx.quadraticCurveTo(cx + 30, size - 34, cx + 34, size);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, size - 54, 18, 0, Math.PI * 2);
  ctx.fill();

  // Name plate: the placeholder carries its own name so the exchange is legible
  // with zero art. Dim, low on the panel, monospace to match the HUD grammar.
  ctx.fillStyle = 'rgba(220,220,228,0.82)';
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(name.toUpperCase(), cx, size - 8, size - 8);

  return el;
}

/**
 * A drawable portrait for any speaker name — supplied art if a pack registered
 * it, the procedural silhouette otherwise. Never throws on an unknown name; the
 * silhouette is the total fallback. Results are cached, so a held dialogue line
 * repaints nothing.
 */
export function portraitImage(name: string): CanvasImageSource {
  const supplied = getPortraitSpec(name)?.image;
  if (supplied !== undefined) return supplied;
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  const painted = paintSilhouette(name);
  cache.set(name, painted);
  return painted;
}

/* ------------------------------------------------------------------ */
/* Built-in portraits                                                  */
/* ------------------------------------------------------------------ */

// One per built-in boss, tinted to that boss's own colour so a silhouette reads
// as that fight, plus the ship's own face for the player's side of an exchange.
// The tints mirror each boss's `tint` in sim/boss.ts and content/stage-2.ts;
// duplicated as a literal rather than imported so this render file stays free of
// a sim dependency for four small colour triples.
definePortrait('sentinel', { tint: { r: 0.8, g: 0.9, b: 1 } });
definePortrait('warden', { tint: { r: 1, g: 0.6, b: 0.72 } });
definePortrait('magistrate', { tint: { r: 0.72, g: 0.68, b: 1 } });
definePortrait('player', { tint: { r: 0.62, g: 0.88, b: 0.72 } });
