/**
 * The laser skin registry — render-side, string-named.
 *
 * A beam names its look with `b.style.sprite`, exactly as a stage names its
 * scene with `StageSpec.background`: a **string**, resolved in the shell, never
 * an import the sim reaches for. The sim knows a bullet is a line (it carries a
 * `LaserSpec`); it does not know a beam has a *body strip* and a *cap flash*, or
 * that either is tiled or stretched — that anatomy lives here, in `render/`,
 * behind a name. So this module is imported by the shell alone; `sim`,
 * `content` and `game` never see it (the import boundary, CLAUDE.md).
 *
 * A skin binds a content-facing name to two strips on the laser atlas (a `body`
 * and a `cap`) plus how to fit them. The strips themselves — the pixels — are
 * the procedural floor (rule 9) or a pack reskin; this only says which strip a
 * beam wears and how wide to draw it. When `b.style.sprite` names no skin the
 * shell falls back to the legacy stretched quad, so a beam is reskinned by
 * changing one string in its spec and nothing else.
 *
 * The base game's eight beam skins register at module load, below.
 */

export type LaserFit = 'tile' | 'stretch';

export interface LaserSkin {
  /** Body strip on the laser atlas (tiled or stretched along the beam). */
  body: string;
  /** Cap strip drawn at the tip while the beam can kill. */
  cap: string;
  /**
   * `'stretch'` draws the whole beam as one scaled quad (whole-beam art);
   * `'tile'` repeats the body cell along the length (a tileable `t` body), so
   * texel density is constant at any length.
   */
  fit: LaserFit;
  /**
   * Rendered cross-axis px — the VISUAL beam width. The hitbox is the sim's
   * `radius` and is deliberately smaller: the danger is the thin centre line,
   * the glow around it is presentation.
   */
  thickness: number;
  /**
   * On-beam px per tile when `fit === 'tile'`. Omitted, the shell uses the body
   * strip's own `frameW` — so the procedural floor and a native pack reskin each
   * tile at their own native cell width without this table hard-coding a px that
   * must match whatever atlas supplied the pixels.
   */
  tileLength?: number;
}

const skins = new Map<string, LaserSkin>();

/**
 * Register a skin under a content-facing name. Throws on a duplicate: two skins
 * answering to one name is a silent repoint, the failure the string seam exists
 * to make loud.
 */
export function defineLaserSkin(name: string, skin: LaserSkin): void {
  if (skins.has(name)) throw new Error(`laser skin "${name}" is already defined`);
  skins.set(name, skin);
}

/** The skin a beam wears, or undefined — the shell falls back to the legacy quad. */
export function getLaserSkin(name: string): LaserSkin | undefined {
  return skins.get(name);
}

/** Every registered skin name, for the resolution test and the build-time check. */
export function laserSkinNames(): readonly string[] {
  return [...skins.keys()];
}

/* ------------------------------------------------------------------ */
/* The base campaign's beam skins                                     */
/* ------------------------------------------------------------------ */

/**
 * The eight base skins, one per beam the campaign fires. Each names a body strip
 * (also its own name — a skin and its body share a name, distinct namespaces)
 * and one of three shared cap strips. The strip names here are the atlas ledger
 * that `LASER_STRIPS` in `procedural.ts` must cover exactly; `laser-skin.test.ts`
 * cross-checks the two so a skin can never name a strip the sheet never paints.
 *
 * Fit is authored per beam: the whole-beam strips (`v3`, `blue`, `cyan`) stretch;
 * the tileable bodies (`slim`, `heavy`, `warm`, `stream`, `v3.stream`) tile.
 */
export const BASE_LASER_SKINS: Record<string, LaserSkin> = {
  'beam.v3': { body: 'beam.v3', cap: 'cap.v3', fit: 'stretch', thickness: 18 },
  'beam.slim': { body: 'beam.slim', cap: 'cap.green', fit: 'tile', thickness: 12 },
  'beam.heavy': { body: 'beam.heavy', cap: 'cap.green', fit: 'tile', thickness: 28 },
  'beam.blue': { body: 'beam.blue', cap: 'cap.v3', fit: 'stretch', thickness: 22 },
  'beam.cyan': { body: 'beam.cyan', cap: 'cap.v3', fit: 'stretch', thickness: 20 },
  'beam.warm': { body: 'beam.warm', cap: 'cap.yellow', fit: 'tile', thickness: 24 },
  'beam.stream': { body: 'beam.stream', cap: 'cap.green', fit: 'tile', thickness: 16 },
  'beam.v3.stream': { body: 'beam.v3.stream', cap: 'cap.v3', fit: 'tile', thickness: 30 },
};

for (const [name, skin] of Object.entries(BASE_LASER_SKINS)) {
  defineLaserSkin(name, skin);
}
