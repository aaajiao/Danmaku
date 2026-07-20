/**
 * The semantic half of the pack system: it takes a manifest whose SHAPE
 * `manifest.ts` already accepted and turns its `content` into registered
 * enemies and stages, or rejects the pack whole.
 *
 * ## Where the two halves split
 *
 * `manifest.ts` is pure and knows only shape — fields, types, the covering
 * invariant. It cannot know whether a pattern name resolves, because that would
 * mean importing the registries, and importing them is exactly what keeps it
 * headless. This module is the other side: it imports `sim` and `content`
 * freely (that direction is legal — the forbidden one is `sim`/`content`/`game`
 * → `packs`, enforced by `architecture.test.ts`), and every name a pack writes
 * is resolved here against the real registries before anything is registered.
 *
 * It still must not import `render`. A sprite is an atlas cell and a background
 * is a shader, both of which live behind that boundary, so the sets of valid
 * sprite and scene names are **passed in** by the caller — the loader hands it
 * the render registries' lists; a test hands it the same lists. That is what
 * keeps injection provable in `bun test` with no GL context.
 *
 * ## Pack-first resolution, then built-in
 *
 * A pack's own entries are written bare in its JSON and qualified to
 * `<pack>/<entry>` at registration. A bare name inside the pack resolves to the
 * pack's entry first and a built-in second, so a pack may reuse a built-in name
 * without collision. Cross-pack references are not supported: a name that is
 * neither the pack's nor built in is an error. Bosses and backgrounds are
 * **built-in only** — `content.bosses` is reserved, and shaders are engine code.
 *
 * ## Atomic and idempotent
 *
 * Every problem is collected first; if there is one, the pack registers nothing
 * and `injectPack` throws with the whole list. That is what makes "a failed
 * data pack simply has no campaign row" structural rather than a convention.
 * And injection is idempotent per pack name — a second call returns the first
 * call's campaigns without re-registering — so test files sharing one process
 * (registries are process-global) cannot double-register and throw a duplicate.
 */

import { patternNames } from '../content/patterns';
import { defineStage, stageNames, type BossWave, type EnemyWave, type StageSpec, type WaveEntry } from '../content/stage';
import { bossNames } from '../sim/boss';
import { defineEnemy, enemyNames, type EnemySpec } from '../sim/enemy';
import { itemNames } from '../sim/item';
import { behaviourNames } from '../sim/motion';
import type { ContentEnemy, ContentStage, ContentStageWave, PackManifest } from './manifest';

/**
 * Compile-time drift guard. A pack enemy is handed to `defineEnemy` as an
 * `EnemySpec` with no rebuild, so the two shapes must agree. The `motion` and
 * `timeline` fields are deliberately loose in `ContentEnemy` (their deep shape
 * belongs to the motion DSL), so they are cast; every other field is checked by
 * this assignment. Rename a scalar on either side and this stops compiling.
 */
const _enemyMirror = (e: ContentEnemy): EnemySpec => ({
  ...e,
  motion: e.motion as unknown as EnemySpec['motion'],
  timeline: e.timeline as unknown as EnemySpec['timeline'],
});

/** A campaign the title menu can offer: one row per `entry: true` stage. */
export interface Campaign {
  /** Menu label — the qualified stage name, e.g. `example/gauntlet`. */
  label: string;
  /** The qualified stage a run starts on when this row is chosen. */
  stage: string;
}

/**
 * Name sets injection needs but may not read directly, because reading them
 * would mean importing `render`. The caller supplies them.
 */
export interface InjectContext {
  /** Atlas cell names this build can draw. */
  sprites: readonly string[];
  /** Registered background scene names. */
  scenes: readonly string[];
}

export interface InjectResult {
  campaigns: Campaign[];
}

/**
 * Thrown when a pack's content fails semantic validation. Carries every problem
 * so an author editing by hand sees the whole list, not the first line.
 */
export class PackInjectError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(problems.join('\n'));
    this.name = 'PackInjectError';
    this.problems = problems;
  }
}

/** Idempotency ledger — pack name → the campaigns its first injection produced. */
const injected = new Map<string, InjectResult>();

/**
 * Register a pack's content, or reject it whole.
 *
 * `manifest` must already have passed `validateManifest`; this reads only
 * `name` and `content`. Returns the campaigns the pack contributes (empty for a
 * presentation-only pack with no `content`). Throws `PackInjectError`, having
 * registered nothing, if any name fails to resolve or any reachability rule is
 * broken.
 */
export function injectPack(manifest: PackManifest, context: InjectContext): InjectResult {
  const cached = injected.get(manifest.name);
  if (cached) return cached;

  const built = validateAndBuild(manifest, context);

  // Reached only when zero problems were collected, so no `define*` below can
  // throw: every condition those guards reject was pre-checked with an
  // equivalent, pack-scoped error above. Enemies first so a stage's own
  // qualified enemies exist by the time its `StageRunner` is later built.
  for (const e of built.enemies) defineEnemy(e.name, e.spec);
  for (const s of built.stages) defineStage(s.name, s.spec);

  const result: InjectResult = { campaigns: built.campaigns };
  injected.set(manifest.name, result);
  return result;
}

/**
 * Forget every injection. Test-only: the ledger is process-global, and a test
 * that wants to observe a fresh injection of a name another test already used
 * would otherwise get the cached no-op.
 */
export function resetInjectedForTest(): void {
  injected.clear();
}

interface BuiltEnemy {
  name: string;
  spec: EnemySpec;
}
interface BuiltStage {
  name: string;
  spec: StageSpec;
}
interface Built {
  campaigns: Campaign[];
  enemies: BuiltEnemy[];
  stages: BuiltStage[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The behaviour name a motion object references, if any. */
function motionBehaviour(motion: unknown): string | undefined {
  if (isRecord(motion) && typeof motion.behaviour === 'string') return motion.behaviour;
  return undefined;
}

function validateAndBuild(manifest: PackManifest, context: InjectContext): Built {
  const pack = manifest.name;
  const content = manifest.content;
  const enemies = content?.enemies ?? {};
  const stages = content?.stages ?? {};
  const enemyKeys = Object.keys(enemies);
  const stageKeys = Object.keys(stages);

  const problems: string[] = [];
  const q = (entry: string): string => `${pack}/${entry}`;

  // Resolution sets. Built-ins are read live from the registries; sprites and
  // scenes come in from the caller.
  //
  // Only the caller-supplied sets (sprites, scenes) are listed in error
  // messages. The registry-backed sets are process-global and other test files
  // register fixtures into them, so a message listing their contents would not
  // be a stable golden string — the resolution still uses them, the message
  // just names the bad value and says it did not resolve.
  const patterns = new Set(patternNames());
  const behaviours = new Set(behaviourNames());
  const items = new Set(itemNames());
  const bosses = new Set(bossNames());
  const builtinEnemies = new Set(enemyNames());
  const builtinStages = new Set(stageNames());
  const sprites = new Set(context.sprites);
  const scenes = new Set(context.scenes);
  const packEnemies = new Set(enemyKeys);
  const packStages = new Set(stageKeys);

  const list = (names: Set<string>): string => [...names].sort().join(', ');

  // --- enemies: sprite, patterns, behaviours, spoils item names ---------
  for (const name of enemyKeys) {
    const e = enemies[name] as ContentEnemy;
    const where = `enemy "${name}"`;

    if (!sprites.has(e.sprite)) {
      problems.push(
        `pack "${pack}": ${where} uses unknown sprite "${e.sprite}" — known sprites: ${list(sprites)}`,
      );
    }

    for (const slot of e.patterns ?? []) {
      if (!patterns.has(slot.pattern)) {
        problems.push(
          `pack "${pack}": ${where} uses unknown pattern "${slot.pattern}" — no such pattern is registered`,
        );
      }
    }

    const behaviourRefs = [e.motion, ...(e.timeline ?? []).map((seg) => (isRecord(seg) ? seg.motion : undefined))];
    for (const ref of behaviourRefs) {
      const behaviour = motionBehaviour(ref);
      if (behaviour !== undefined && !behaviours.has(behaviour)) {
        problems.push(
          `pack "${pack}": ${where} uses unknown motion behaviour "${behaviour}" — no such behaviour is registered`,
        );
      }
    }

    for (const [item] of e.spoils ?? []) {
      if (!items.has(item)) {
        problems.push(
          `pack "${pack}": ${where} drops unknown item "${item}" — no such item is registered`,
        );
      }
    }
  }

  // --- stages: numbers, name resolution ---------------------------------
  for (const name of stageKeys) {
    const s = stages[name] as ContentStage;
    const where = `stage "${name}"`;

    if (s.outro !== undefined && (!Number.isInteger(s.outro) || s.outro < 0)) {
      problems.push(`pack "${pack}": ${where}: outro must be a whole tick count, got ${s.outro}`);
    }

    s.waves.forEach((w, i) => {
      const ww = `${where} wave ${i}`;
      if (!Number.isInteger(w.at) || w.at < 0) {
        problems.push(`pack "${pack}": ${ww}: "at" must be a whole tick count, got ${w.at}`);
      }

      if (w.boss !== undefined) {
        if (!bosses.has(w.boss)) {
          problems.push(
            `pack "${pack}": ${ww} references unknown boss "${w.boss}" — pack stages may name a built-in boss only; no built-in boss "${w.boss}" exists`,
          );
        }
        return;
      }

      const enemy = w.enemy as string;
      if (!packEnemies.has(enemy) && !builtinEnemies.has(enemy)) {
        problems.push(
          `pack "${pack}": ${ww} references unknown enemy "${enemy}" — no such enemy in this pack or built in`,
        );
      }
      const count = w.count ?? 1;
      if (!Number.isInteger(count) || count < 1) {
        problems.push(`pack "${pack}": ${ww}: "count" must be a positive whole number, got ${count}`);
      }
      const interval = w.interval ?? 0;
      if (!Number.isInteger(interval) || interval < 0) {
        problems.push(`pack "${pack}": ${ww}: "interval" must be a whole tick count, got ${interval}`);
      }
    });

    if (s.boss !== undefined && !bosses.has(s.boss)) {
      problems.push(
        `pack "${pack}": ${where} names unknown boss "${s.boss}" — pack stages may name a built-in boss only; no built-in boss "${s.boss}" exists`,
      );
    }
    if (s.background !== undefined && !scenes.has(s.background)) {
      problems.push(
        `pack "${pack}": ${where} is set in unknown background "${s.background}" — known backgrounds: ${list(scenes)}`,
      );
    }
    if (typeof s.next === 'string' && !packStages.has(s.next) && !builtinStages.has(s.next)) {
      problems.push(
        `pack "${pack}": ${where} chains next into unknown stage "${s.next}" — no such stage in this pack or built in`,
      );
    }
  }

  // --- reachability: registration is not reachability -------------------
  if (stageKeys.length > 0) {
    const hasEntry = stageKeys.some((k) => (stages[k] as ContentStage).entry === true);
    if (!hasEntry) {
      problems.push(
        `pack "${pack}": has content.stages but no entry stage — mark a campaign start with "entry": true`,
      );
    }

    // A pack stage is reachable if it is an entry or the `next` of some pack
    // stage. Only pack-internal `next` targets count — a built-in `next` leaves
    // the pack, it does not reach back into it.
    const reachedByNext = new Set<string>();
    for (const k of stageKeys) {
      const nx = (stages[k] as ContentStage).next;
      if (typeof nx === 'string' && packStages.has(nx)) reachedByNext.add(nx);
    }
    for (const k of stageKeys) {
      const s = stages[k] as ContentStage;
      if (s.entry === true || reachedByNext.has(k)) continue;
      problems.push(
        `pack "${pack}": stage "${k}" is neither an entry nor any stage's next — dead content (registration is not reachability)`,
      );
    }
  }

  // Every pack enemy must be spawned by a wave of some pack stage (pack-first,
  // so a bare wave name resolving to the pack enemy counts).
  const referenced = new Set<string>();
  for (const k of stageKeys) {
    for (const w of (stages[k] as ContentStage).waves) {
      if (w.boss === undefined && typeof w.enemy === 'string' && packEnemies.has(w.enemy)) {
        referenced.add(w.enemy);
      }
    }
  }
  for (const name of enemyKeys) {
    if (!referenced.has(name)) {
      problems.push(
        `pack "${pack}": enemy "${name}" is spawned by no wave of any pack stage — dead content (registration is not reachability)`,
      );
    }
  }

  if (problems.length > 0) throw new PackInjectError(problems);

  // --- build (only past a clean validation) -----------------------------
  const builtEnemies: BuiltEnemy[] = enemyKeys.map((name) => ({
    name: q(name),
    spec: enemies[name] as unknown as EnemySpec,
  }));
  const builtStages: BuiltStage[] = stageKeys.map((name) => ({
    name: q(name),
    spec: toStageSpec(q(name), stages[name] as ContentStage, packEnemies, packStages, q),
  }));
  const campaigns: Campaign[] = stageKeys
    .filter((k) => (stages[k] as ContentStage).entry === true)
    .map((k) => ({ label: q(k), stage: q(k) }));

  return { campaigns, enemies: builtEnemies, stages: builtStages };
}

/**
 * Turn a `ContentStage` into a `StageSpec`: qualify the name, qualify each
 * wave's own-pack enemy, resolve `next` (pack-first, `null` → the spec's
 * `undefined` "no next"), and drop `entry`, which is menu data the spec has no
 * field for. Bosses and backgrounds pass through bare — they are built-in.
 */
function toStageSpec(
  name: string,
  s: ContentStage,
  packEnemies: ReadonlySet<string>,
  packStages: ReadonlySet<string>,
  q: (entry: string) => string,
): StageSpec {
  const waves: WaveEntry[] = s.waves.map((w) => toWave(w, packEnemies, q));

  const spec: StageSpec = { name, waves };
  if (s.seed !== undefined) spec.seed = s.seed;
  if (s.outro !== undefined) spec.outro = s.outro;
  if (s.boss !== undefined) spec.boss = s.boss;
  if (s.background !== undefined) spec.background = s.background;
  if (typeof s.next === 'string') {
    spec.next = packStages.has(s.next) ? q(s.next) : s.next;
  }
  return spec;
}

function toWave(
  w: ContentStageWave,
  packEnemies: ReadonlySet<string>,
  q: (entry: string) => string,
): WaveEntry {
  if (w.boss !== undefined) {
    const boss: BossWave = { at: w.at, boss: w.boss };
    if (w.x !== undefined) boss.x = w.x;
    if (w.y !== undefined) boss.y = w.y;
    return boss;
  }
  const named = w.enemy as string;
  const wave: EnemyWave = {
    at: w.at,
    enemy: packEnemies.has(named) ? q(named) : named,
    x: w.x ?? 0,
    y: w.y ?? 0,
  };
  if (w.count !== undefined) wave.count = w.count;
  if (w.interval !== undefined) wave.interval = w.interval;
  if (w.stepX !== undefined) wave.stepX = w.stepX;
  if (w.stepY !== undefined) wave.stepY = w.stepY;
  return wave;
}
