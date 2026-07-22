/**
 * The bundled v4 campaign — the game's own campaign, injected as pack data.
 *
 * All four stages, sixteen enemy types, five bosses and the complete player
 * side now live in `campaign.json` (authored by `tools/make-v4-content.ts`) and
 * register through the same validate+inject pipeline as any fetched pack. The
 * manifest's old stage-1/stage-2 description is deliberately frozen for this
 * ownership-only migration: changing those JSON bytes would change the replay
 * fingerprint without changing gameplay.
 *
 * ## Bundled semantics
 *
 * This module statically imports the JSON — the bundler inlines it, so there is
 * zero network and no `packs/` directory: the never-blocked floor holds. It
 * injects with `bundled: true`, which means the content registers UNQUALIFIED
 * (`grunt`, `sentinel`, `stage-1`) because it is the base game, not a guest, and
 * contributes no campaign row — its entry stage `stage-1` takes the plain START
 * row (`TitleState` keeps resolving `'stage-1'`). It joins neither `packs` meta
 * nor `packsData`: its identity is the build itself, exactly as engine-defined
 * content was, which is why the port declares no replay divergence.
 *
 * ## Import-time, and loud
 *
 * Injection runs when this module is evaluated — a side effect, like every
 * content module — so `main.ts` (and every composed-game test) gets the base
 * campaign by importing it. It must run AFTER `content` (the patterns and
 * behaviours the pack names), AFTER the background scenes and portraits are
 * registered (their names must resolve), and BEFORE `loadPacks` (so a fetched
 * pack naming `grunt` still qualifies away from the base one). Those side-effect
 * imports below make this module self-sufficient wherever it is imported; the
 * built `InjectContext` is the same one `loader.ts` hands a fetched pack.
 *
 * A bundled pack that fails validation is a BUILD defect, not a user-file
 * problem, so this throws at import rather than degrading — a broken base pack
 * can never reach a running game, and a test importing this module fails loudly.
 */

// Side-effect imports: the v4 campaign names patterns, behaviours, background
// scenes and portraits, all of which must be registered before its enemies,
// bosses and stages resolve against them. Importing them here makes this module
// inject correctly no matter what imported it (main.ts already imports the first
// two; a headless test imports only this).
import '../gameplay/behaviours';
import '../gameplay/patterns';
import '../../content/shots';
import '../../content/stage';
import '../backgrounds';
import { backgroundNames } from '../../render/background';
import { portraitNames } from '../../render/portrait';
import { BULLET_CELLS, BULLET_VARIANT_CELLS, MISSILE_STRIP_CELLS, SHIP_CELLS } from '../../render/procedural';
import { laserSkinNames } from '../../render/laser-skin';

import { injectPack, type InjectContext } from '../../packs/inject';
import { validateManifest, type PackManifest } from '../../packs/manifest';
import campaignJson from './campaign.json';

/** The bundled pack's name — bare, distinct from any real `packs/` directory. */
export const BASE_PACK_NAME = 'base';

// Re-exported so the shell (main.ts) can thread it into `RunConfig.contentFingerprint`
// without importing the generated module directly — the bundled data + compiled
// danmaku identity in replay meta, a plain string the sim carries opaquely (see
// RunConfig.contentFingerprint).
export { CONTENT_FINGERPRINT } from './campaign.fingerprint';

const manifest = campaignJson as unknown as PackManifest;

// Validate through the real manifest validator first, the same gate a fetched
// pack passes in `loadOnePack`. A generated, drift-tested pack passes at runtime;
// running the check anyway keeps the pipeline identical and turns a hand-edited
// `campaign.json` into a loud boot failure rather than a silent bad injection.
const validation = validateManifest(manifest, manifest.name);
if ('errors' in validation) {
  throw new Error(`bundled base pack failed validation:\n  ${validation.errors.join('\n  ')}`);
}

// The same context `loader.ts` builds for a fetched pack: the sets injection
// resolves against but may not read directly, because reading them would import
// `render`. Built here (this module may import `render`, like `loader.ts`), so
// injection stays free of that boundary.
const context: InjectContext = {
  // Floor cells ∪ the per-family variant names the base campaign fires (both
  // resolvable procedurally — the floor aliases each variant to its base cell), so
  // the bundled base pack's specs naming a variant validate. Same set `loader.ts`
  // builds for a fetched pack.
  sprites: [...BULLET_CELLS, ...BULLET_VARIANT_CELLS],
  shipSprites: [...SHIP_CELLS],
  // The beam skins a laser bullet may wear — the third sprite pool (laser atlas),
  // resolved through the render-side registry the same way `scenes`/`portraits`
  // are. `LANCE`/`COLUMN`/`RAKE`/`RAY_BEAM` and the player's `GUN_BEAM` name these.
  laserSprites: laserSkinNames(),
  // The missile bodies a `missile` bullet may wear — the fourth sprite pool
  // (missile atlas). The base campaign's writs (`CITATION`…`EDICT`) name these,
  // routed there in the shell by `b.missile !== undefined` (导弹轮 design §c.1).
  missileSprites: [...MISSILE_STRIP_CELLS],
  scenes: backgroundNames(),
  portraits: portraitNames(),
};

// Inject with bundled semantics — bare names, no campaign row, throw on any
// problem. Idempotent per pack name, so repeated imports in one process are a
// no-op. The returned campaigns/characters are intentionally discarded: a
// bundled pack contributes neither, and never touches `packs`/`packsData` meta.
injectPack(validation.manifest, context, { bundled: true });
