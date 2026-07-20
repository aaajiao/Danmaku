/**
 * The semantic half of the pack system: it takes a manifest whose SHAPE
 * `manifest.ts` already accepted and turns its `content` into registered
 * content — enemies, stages, bosses, shots, characters, options, bombs,
 * effects and items — or rejects the pack whole.
 *
 * ## Where the two halves split
 *
 * `manifest.ts` is pure and knows only shape — fields, types, the covering
 * invariant. It cannot know whether a pattern name resolves, because that would
 * mean importing the registries, and importing them is exactly what keeps it
 * headless. This module is the other side: it imports `sim`, `content` and
 * `game` freely (that direction is legal — the forbidden one is
 * `sim`/`content`/`game` → `packs`, enforced by `architecture.test.ts`), and
 * every name a pack writes is resolved here against the real registries before
 * anything is registered.
 *
 * The `game` import is `defineCharacter`, and it is the first `packs` → `game`
 * edge in the codebase. It is sound for the same reason the `sim`/`content`
 * ones are: the ban is one-directional, `game` → `packs` (and it holds — `game`
 * declares its own `Campaign` shape rather than importing this module's).
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
 * neither the pack's nor built in is an error. Enemies, stages, bosses, shots,
 * options, bombs, effects and items all resolve pack-first — so a character may
 * fire a pack shot, a bomb may throw a pack effect, an enemy may drop a pack
 * item, and the qualified name is what lands in the built spec. Music tracks
 * resolve pack-first too — a stage or boss may name one the pack's own top-level
 * `music` section adds — with one caveat: a pack music key that matches a built-in
 * track name is a *replacement* registered bare, so a reference to it stays bare.
 * Backgrounds are **built-in only** (shaders are engine code), and so are patterns
 * and motion behaviours (the motion DSL is engine code named by a string).
 *
 * ## Injection order is a dependency order
 *
 * Within a pack: shots → options → bombs → effects → items → characters →
 * enemies → bosses → stages. A character resolves its `shot` name through the
 * shot registry at build time (exactly as `run.ts` does at module-eval), so its
 * pack shots must be registered first; that is the one ordering the build
 * genuinely needs, and the rest follow the same "references point backwards"
 * rule the enemies-before-stages order already followed.
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

import { musicNames } from '../audio/music';
import { patternNames } from '../content/patterns';
import { defineShot, getShot, shotNames, type ShotType } from '../content/shots';
import { defineStage, stageNames, type BossWave, type EnemyWave, type StageSpec, type WaveEntry } from '../content/stage';
import { defineCharacter, type CharacterSpec } from '../game/run';
import { bombNames, defineBomb, type BombSpec } from '../sim/bomb';
import { bossNames, defineBoss, phaseClock, phaseHp, type BossSpec, type PhasePattern, type SpellCard } from '../sim/boss';
import { activePhaseIndices, DIFFICULTIES } from '../sim/difficulty';
import { defineEffect, effectNames, type ParticleSpec } from '../sim/effects';
import { defineEnemy, enemyNames, type EnemySpec } from '../sim/enemy';
import { defineItem, itemNames, type ItemSpec } from '../sim/item';
import { behaviourNames } from '../sim/motion';
import { defineOptions, optionNames, type OptionSpec } from '../sim/option';
import type { ShotSpec } from '../sim/player';
import type {
  ContentBomb,
  ContentBoss,
  ContentCharacter,
  ContentEffect,
  ContentEnemy,
  ContentItem,
  ContentOptions,
  ContentPhasePattern,
  ContentShot,
  ContentSpellCard,
  ContentStage,
  ContentStageWave,
  PackManifest,
} from './manifest';

/**
 * Turn a `ContentEnemy` into an `EnemySpec`, qualifying its cross-registry
 * references pack-first (the `onHit`/`onDeath` effect and each `spoils` item
 * name), and casting only the motion-DSL fields whose deep shape `ContentEnemy`
 * leaves loose. The `{ ...e }` spread is also the compile-time drift guard: a
 * scalar renamed on either shape stops this assignment compiling.
 */
function toEnemySpec(
  e: ContentEnemy,
  refEffect: (name: string) => string,
  refItem: (name: string) => string,
): EnemySpec {
  const spec: EnemySpec = {
    ...e,
    motion: e.motion as unknown as EnemySpec['motion'],
    timeline: e.timeline as unknown as EnemySpec['timeline'],
  };
  if (e.onHit !== undefined) spec.onHit = refEffect(e.onHit);
  if (e.onDeath !== undefined) spec.onDeath = refEffect(e.onDeath);
  if (e.spoils !== undefined) {
    spec.spoils = e.spoils.map(([name, count]): readonly [string, number] => [refItem(name), count]);
  }
  return spec;
}

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
  /**
   * Bullet-sheet cell names this build can draw. Enemies, bosses, options,
   * shots, effects and items all wear these — every batch except the player's
   * is built on the bullet atlas.
   */
  sprites: readonly string[];
  /**
   * Ship-sheet region names — the only sprites a CHARACTER may wear, because
   * the player batch draws from the ship atlas. The two sheets are separate
   * namespaces; pooling them here once let a character pass validation with a
   * sprite the player batch could not resolve, and the reverse pool accepted
   * enemies wearing `ship`. Validated against the set that actually draws.
   */
  shipSprites: readonly string[];
  /** Registered background scene names. */
  scenes: readonly string[];
  /**
   * Registered built-in portrait names (`src/render/portrait.ts`) — the faces a
   * boss's `dialogue` speaker may name. Supplied like `sprites`/`scenes` because
   * the portrait registry is render-side and this module may not import it; a
   * pack's own `portraits` section extends this set pack-first.
   */
  portraits: readonly string[];
}

export interface InjectResult {
  campaigns: Campaign[];
  /**
   * The qualified names of the characters this pack registered
   * (`<pack>/<char>`), for the shell to pair with the pack's identity.
   *
   * A pack character drives the simulation with pack content — its pack shot,
   * option and bomb fire different bullets — even when flown off the plain
   * START row rather than a campaign. So the shell records the owning pack's
   * `name@hash` for a run flown by one of these, the same strict identity a
   * campaign carries; this list is how the shell learns which names are pack
   * characters and whose. Empty for a pack with no characters.
   */
  characters: string[];
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
  // equivalent, pack-scoped error above. Order is the dependency order —
  // shots → options → bombs → effects → items → characters → enemies → bosses
  // → stages — because a character's `player.shots` is resolved through the
  // shot registry here (as `run.ts` does at module-eval), so its pack shots
  // must already be registered, and every later kind names something earlier.
  for (const s of built.shots) defineShot(s.name, s.spec);
  for (const o of built.options) defineOptions(o.name, o.spec);
  for (const b of built.bombs) defineBomb(b.name, b.spec);
  for (const e of built.effects) defineEffect(e.name, e.spec);
  for (const it of built.items) defineItem(it.name, it.spec);
  for (const c of built.characters) {
    // Resolved past registration of the pack's own shots, so a pack character
    // firing a pack weapon finds it — the levels ladder is fetched here and
    // handed to `defineCharacter` in place, the same indirection `run.ts` uses.
    defineCharacter(c.name, toCharacterSpec(c.char, c.shotRef, c.optionsRef, c.bombRef));
  }
  for (const e of built.enemies) defineEnemy(e.name, e.spec);
  for (const b of built.bosses) defineBoss(b.name, b.spec);
  for (const s of built.stages) defineStage(s.name, s.spec);

  const result: InjectResult = { campaigns: built.campaigns, characters: built.characters.map((c) => c.name) };
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
interface BuiltBoss {
  name: string;
  spec: BossSpec;
}
interface BuiltStage {
  name: string;
  spec: StageSpec;
}
interface BuiltShot {
  name: string;
  spec: ShotType;
}
interface BuiltOptions {
  name: string;
  spec: OptionSpec;
}
interface BuiltBomb {
  name: string;
  spec: BombSpec;
}
interface BuiltEffect {
  name: string;
  spec: ParticleSpec;
}
interface BuiltItem {
  name: string;
  spec: ItemSpec;
}
/**
 * A character carries its resolved (qualified-or-bare) shot/option/bomb refs
 * rather than a finished spec, because its `player.shots` ladder is fetched
 * from the shot registry only after the pack's shots are registered — see
 * `injectPack`. The raw `ContentCharacter` rides along so the spec is built
 * there, once those names resolve.
 */
interface BuiltCharacter {
  name: string;
  char: ContentCharacter;
  shotRef: string;
  optionsRef: string;
  bombRef: string;
}
interface Built {
  campaigns: Campaign[];
  shots: BuiltShot[];
  options: BuiltOptions[];
  bombs: BuiltBomb[];
  effects: BuiltEffect[];
  items: BuiltItem[];
  characters: BuiltCharacter[];
  enemies: BuiltEnemy[];
  bosses: BuiltBoss[];
  stages: BuiltStage[];
}

/**
 * A phase's `hpSeconds` is SECONDS of intended drain, and the injector turns it
 * into health with `phaseHp`. A value beyond this many seconds is almost always
 * a units error — ticks typed where seconds belong. The ceiling is deliberately
 * generous: `phaseClock` already doubles the reference drain, so 180s of health
 * implies a timer past six minutes, longer than any real card runs.
 */
const MAX_HP_SECONDS = 180;

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
  const packBosses = content?.bosses ?? {};
  const packShots = content?.shots ?? {};
  const packOptions = content?.options ?? {};
  const packBombs = content?.bombs ?? {};
  const packEffects = content?.effects ?? {};
  const packItems = content?.items ?? {};
  const packCharacters = content?.characters ?? {};
  const enemyKeys = Object.keys(enemies);
  const stageKeys = Object.keys(stages);
  const bossKeys = Object.keys(packBosses);
  const shotKeys = Object.keys(packShots);
  const optionKeys = Object.keys(packOptions);
  const bombKeys = Object.keys(packBombs);
  const effectKeys = Object.keys(packEffects);
  const itemKeys = Object.keys(packItems);
  const characterKeys = Object.keys(packCharacters);

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
  // Music tracks resolve like backgrounds — a stage or boss names one — but
  // unlike a scene a pack MAY define new ones (its top-level `music` section, a
  // presentation sibling of `sounds`). So the known set is the built-in tracks
  // read live from the audio registry (audio-side, not render, so importable
  // here) UNION this pack's own new track names. A pack music key that matches a
  // built-in name is a *replacement* the loader registers bare, so it is NOT a
  // new name and references to it stay bare — hence `refMusic` qualifies only a
  // key that is the pack's AND not built in.
  const builtinMusic = new Set(musicNames());
  const packMusic = manifest.music ?? {};
  const packMusicNames = new Set(Object.keys(packMusic));
  const musicKnown = (name: string): boolean => packMusicNames.has(name) || builtinMusic.has(name);
  const refMusic = (name: string): string =>
    packMusicNames.has(name) && !builtinMusic.has(name) ? q(name) : name;
  // Portraits resolve pack-first, but UNLIKE music they qualify like content, not
  // like a reskin. A pack portrait is registered `<pack>/<name>` even when its
  // name matches a built-in — the render registry (`definePortrait`) forbids a
  // duplicate, so a bare replacement could not register anyway — so `refPortrait`
  // qualifies any name the pack's own `portraits` section carries, exactly as
  // `refEffect`/`refItem` do, and a bare name that is not the pack's resolves to
  // a built-in portrait. Built-in names come from the caller (render-side).
  const builtinPortraits = new Set(context.portraits);
  const packPortraits = manifest.portraits ?? {};
  const packPortraitNames = new Set(Object.keys(packPortraits));
  const portraitKnown = (name: string): boolean =>
    packPortraitNames.has(name) || builtinPortraits.has(name);
  const portraits = new Set([...context.portraits, ...packPortraitNames]);
  const builtinItems = new Set(itemNames());
  const builtinEffects = new Set(effectNames());
  const builtinShots = new Set(shotNames());
  const builtinOptions = new Set(optionNames());
  const builtinBombs = new Set(bombNames());
  const builtinBosses = new Set(bossNames());
  const builtinEnemies = new Set(enemyNames());
  const builtinStages = new Set(stageNames());
  const sprites = new Set(context.sprites);
  const shipSprites = new Set(context.shipSprites);
  const scenes = new Set(context.scenes);
  const packEnemies = new Set(enemyKeys);
  const packStages = new Set(stageKeys);
  const packBossNames = new Set(bossKeys);
  const packShotNames = new Set(shotKeys);
  const packOptionNames = new Set(optionKeys);
  const packBombNames = new Set(bombKeys);
  const packEffectNames = new Set(effectKeys);
  const packItemNames = new Set(itemKeys);

  // Every cross-registry reference resolves pack-first, then built-in — the one
  // rule, now that a pack may carry each of these kinds. A pack entry shadows a
  // built-in of the same name for bare references written inside the pack.
  const bossKnown = (name: string): boolean => packBossNames.has(name) || builtinBosses.has(name);
  const shotKnown = (name: string): boolean => packShotNames.has(name) || builtinShots.has(name);
  const optionKnown = (name: string): boolean => packOptionNames.has(name) || builtinOptions.has(name);
  const bombKnown = (name: string): boolean => packBombNames.has(name) || builtinBombs.has(name);
  const effectKnown = (name: string): boolean => packEffectNames.has(name) || builtinEffects.has(name);
  const itemKnown = (name: string): boolean => packItemNames.has(name) || builtinItems.has(name);

  const list = (names: Set<string>): string => [...names].sort().join(', ');

  // The sprite name carried inside a loosely-typed bullet spec (`style.sprite`),
  // and the behaviour names its motion and timeline reference — a pack shot and
  // a pack option each embed one such spec, and both need the same two checks
  // enemies already run against a motion object.
  const bulletSprite = (spec: unknown): string | undefined =>
    isRecord(spec) && isRecord(spec.style) && typeof spec.style.sprite === 'string'
      ? spec.style.sprite
      : undefined;
  const bulletBehaviours = (spec: unknown): (string | undefined)[] => {
    if (!isRecord(spec)) return [];
    const timeline = Array.isArray(spec.timeline) ? spec.timeline : [];
    return [spec.motion, ...timeline.map((seg) => (isRecord(seg) ? seg.motion : undefined))].map(
      motionBehaviour,
    );
  };

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

    // onHit/onDeath name effects, resolving pack-first. These went unchecked
    // before pack effects existed — a typo'd effect passed injection and threw
    // at runtime on the first hit — so validating them here is the gap the
    // effects section closes, the same shape as the item check below.
    for (const which of ['onHit', 'onDeath'] as const) {
      const effect = e[which];
      if (effect !== undefined && !effectKnown(effect)) {
        problems.push(
          `pack "${pack}": ${where} ${which} names unknown effect "${effect}" — no such effect in this pack or built in`,
        );
      }
    }

    for (const [item] of e.spoils ?? []) {
      if (!itemKnown(item)) {
        problems.push(
          `pack "${pack}": ${where} drops unknown item "${item}" — no such item in this pack or built in`,
        );
      }
    }
  }

  // --- bosses: sprite, phases, per-phase hpSeconds/patterns/background,
  //     behaviours, onDeath effect, spoils item names --------------------
  for (const name of bossKeys) {
    const b = packBosses[name] as ContentBoss;
    const where = `boss "${name}"`;

    if (!sprites.has(b.sprite)) {
      problems.push(
        `pack "${pack}": ${where} uses unknown sprite "${b.sprite}" — known sprites: ${list(sprites)}`,
      );
    }

    // Pre-check what `defineBoss` would otherwise throw on, so a bad boss is a
    // collected pack-scoped problem rather than a mid-injection throw that would
    // leave the pack half-registered.
    if (b.phases.length === 0) {
      problems.push(
        `pack "${pack}": ${where} declares no phases — a boss needs at least one phase`,
      );
    } else {
      // The engine's `defineBoss` would throw if a tier's `difficulties` gates
      // left it with no phase — a boss dead unfought there. Pre-check it per
      // tier so it is a collected pack-scoped problem rather than a mid-injection
      // throw, and word it exactly as the engine does past the pack prefix.
      for (const tier of DIFFICULTIES) {
        if (activePhaseIndices(b.phases, tier).length === 0) {
          problems.push(
            `pack "${pack}": ${where} has no phase on difficulty "${tier}" — every tier must keep at least one`,
          );
        }
      }
    }

    b.phases.forEach((card) => {
      const cw = `${where} phase "${card.name}"`;

      if (!(card.hpSeconds > 0)) {
        problems.push(
          `pack "${pack}": ${cw}: hpSeconds must be positive, got ${card.hpSeconds}`,
        );
      } else if (card.hpSeconds > MAX_HP_SECONDS) {
        problems.push(
          `pack "${pack}": ${cw}: hpSeconds ${card.hpSeconds} exceeds the ceiling of ${MAX_HP_SECONDS} — hpSeconds is SECONDS of intended drain, not ticks`,
        );
      }

      if (card.timeLimit !== undefined && (!Number.isInteger(card.timeLimit) || card.timeLimit < 0)) {
        problems.push(
          `pack "${pack}": ${cw}: timeLimit must be a whole tick count, got ${card.timeLimit}`,
        );
      }

      // Patterns are engine code — the motion DSL is named by a string, never
      // carried as pack data — so a pattern name must be built in.
      for (const slot of card.patterns) {
        if (!patterns.has(slot.pattern)) {
          problems.push(
            `pack "${pack}": ${cw} uses unknown pattern "${slot.pattern}" — patterns are engine code, not pack data; no such pattern is registered`,
          );
        }
      }

      const behaviourRefs = [card.motion, ...(card.timeline ?? []).map((seg) => (isRecord(seg) ? seg.motion : undefined))];
      for (const ref of behaviourRefs) {
        const behaviour = motionBehaviour(ref);
        if (behaviour !== undefined && !behaviours.has(behaviour)) {
          problems.push(
            `pack "${pack}": ${cw} uses unknown motion behaviour "${behaviour}" — no such behaviour is registered`,
          );
        }
      }

      if (card.background !== undefined && !scenes.has(card.background)) {
        problems.push(
          `pack "${pack}": ${cw} is set in unknown background "${card.background}" — known backgrounds: ${list(scenes)}`,
        );
      }
    });

    if (b.onDeath !== undefined && !effectKnown(b.onDeath)) {
      problems.push(
        `pack "${pack}": ${where} onDeath names unknown effect "${b.onDeath}" — no such effect in this pack or built in`,
      );
    }

    if (b.music !== undefined && !musicKnown(b.music)) {
      problems.push(
        `pack "${pack}": ${where} names unknown music "${b.music}" — no such music in this pack or built in`,
      );
    }

    // Each dialogue speaker names a portrait, resolved pack-first (the pack's own
    // `portraits` section) then built-in. A speaker with no such portrait is a
    // rejection — the shell would fall back to a procedural silhouette, but a
    // dangling name is more likely a typo, and the pack surface refuses those.
    (b.dialogue ?? []).forEach((line, i) => {
      if (!portraitKnown(line.speaker)) {
        problems.push(
          `pack "${pack}": ${where} dialogue line ${i} names unknown portrait "${line.speaker}" — known portraits: ${list(portraits)}`,
        );
      }
    });

    for (const [item] of b.spoils ?? []) {
      if (!itemKnown(item)) {
        problems.push(
          `pack "${pack}": ${where} drops unknown item "${item}" — no such item in this pack or built in`,
        );
      }
    }
  }

  // --- shots: each level's bullet sprite and behaviours -----------------
  for (const name of shotKeys) {
    const shot = packShots[name] as ContentShot;
    const where = `shot "${name}"`;
    shot.levels.forEach((level, i) => {
      const lw = `${where} level ${i}`;
      const sprite = bulletSprite(level.spec);
      if (sprite !== undefined && !sprites.has(sprite)) {
        problems.push(
          `pack "${pack}": ${lw} uses unknown sprite "${sprite}" — known sprites: ${list(sprites)}`,
        );
      }
      for (const behaviour of bulletBehaviours(level.spec)) {
        if (behaviour !== undefined && !behaviours.has(behaviour)) {
          problems.push(
            `pack "${pack}": ${lw} uses unknown motion behaviour "${behaviour}" — no such behaviour is registered`,
          );
        }
      }
    });
  }

  // --- options: the option sprite and its bullet's sprite/behaviours ----
  for (const name of optionKeys) {
    const opt = packOptions[name] as ContentOptions;
    const where = `options "${name}"`;
    if (!sprites.has(opt.sprite)) {
      problems.push(
        `pack "${pack}": ${where} uses unknown sprite "${opt.sprite}" — known sprites: ${list(sprites)}`,
      );
    }
    const shotSprite = bulletSprite(opt.shot);
    if (shotSprite !== undefined && !sprites.has(shotSprite)) {
      problems.push(
        `pack "${pack}": ${where} fires unknown sprite "${shotSprite}" — known sprites: ${list(sprites)}`,
      );
    }
    for (const behaviour of bulletBehaviours(opt.shot)) {
      if (behaviour !== undefined && !behaviours.has(behaviour)) {
        problems.push(
          `pack "${pack}": ${where} uses unknown motion behaviour "${behaviour}" — no such behaviour is registered`,
        );
      }
    }
  }

  // --- bombs: the blast effect, pack-first ------------------------------
  for (const name of bombKeys) {
    const bomb = packBombs[name] as ContentBomb;
    const where = `bomb "${name}"`;
    if (bomb.effect !== undefined && !effectKnown(bomb.effect)) {
      problems.push(
        `pack "${pack}": ${where} names unknown effect "${bomb.effect}" — no such effect in this pack or built in`,
      );
    }
  }

  // --- effects: the particle sprite -------------------------------------
  //
  // The engine declares effects through a `BulletCell`-typed seam that makes
  // the sprite a compile-time union; a pack has no compiler at author time, so
  // that union is enforced here as a runtime check against the sprite set.
  for (const name of effectKeys) {
    const effect = packEffects[name] as ContentEffect;
    const where = `effect "${name}"`;
    if (!sprites.has(effect.sprite)) {
      problems.push(
        `pack "${pack}": ${where} uses unknown sprite "${effect.sprite}" — known sprites: ${list(sprites)}`,
      );
    }
  }

  // --- items: the pickup sprite and its motion behaviour ----------------
  for (const name of itemKeys) {
    const item = packItems[name] as ContentItem;
    const where = `item "${name}"`;
    if (!sprites.has(item.sprite)) {
      problems.push(
        `pack "${pack}": ${where} uses unknown sprite "${item.sprite}" — known sprites: ${list(sprites)}`,
      );
    }
    const behaviour = motionBehaviour(item.motion);
    if (behaviour !== undefined && !behaviours.has(behaviour)) {
      problems.push(
        `pack "${pack}": ${where} uses unknown motion behaviour "${behaviour}" — no such behaviour is registered`,
      );
    }
  }

  // --- characters: sprite, and the shot/options/bomb it equips, pack-first
  for (const name of characterKeys) {
    const c = packCharacters[name] as ContentCharacter;
    const where = `character "${name}"`;
    // Characters wear the SHIP sheet, not the bullet sheet — the player batch
    // is the one batch built on the ship atlas.
    if (!shipSprites.has(c.sprite)) {
      problems.push(
        `pack "${pack}": ${where} uses unknown ship sprite "${c.sprite}" — characters wear the ship sheet; known ship sprites: ${list(shipSprites)}`,
      );
    }
    if (!shotKnown(c.shot)) {
      problems.push(
        `pack "${pack}": ${where} fires unknown shot "${c.shot}" — no such shot in this pack or built in`,
      );
    }
    if (!optionKnown(c.options)) {
      problems.push(
        `pack "${pack}": ${where} equips unknown options "${c.options}" — no such options in this pack or built in`,
      );
    }
    if (!bombKnown(c.bomb)) {
      problems.push(
        `pack "${pack}": ${where} equips unknown bomb "${c.bomb}" — no such bomb in this pack or built in`,
      );
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
        if (!bossKnown(w.boss)) {
          problems.push(
            `pack "${pack}": ${ww} references unknown boss "${w.boss}" — no such boss in this pack or built in`,
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

    if (s.boss !== undefined && !bossKnown(s.boss)) {
      problems.push(
        `pack "${pack}": ${where} names unknown boss "${s.boss}" — no such boss in this pack or built in`,
      );
    }
    if (s.background !== undefined && !scenes.has(s.background)) {
      problems.push(
        `pack "${pack}": ${where} is set in unknown background "${s.background}" — known backgrounds: ${list(scenes)}`,
      );
    }
    if (s.music !== undefined && !musicKnown(s.music)) {
      problems.push(
        `pack "${pack}": ${where} names unknown music "${s.music}" — no such music in this pack or built in`,
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

  // Every pack boss must be named by some pack stage — as its end boss or by a
  // boss wave — resolving pack-first. A boss no stage sends is dead content, the
  // same doctrine that governs enemies and stages.
  const bossReferenced = new Set<string>();
  for (const k of stageKeys) {
    const s = stages[k] as ContentStage;
    if (s.boss !== undefined && packBossNames.has(s.boss)) bossReferenced.add(s.boss);
    for (const w of s.waves) {
      if (w.boss !== undefined && packBossNames.has(w.boss)) bossReferenced.add(w.boss);
    }
  }
  for (const name of bossKeys) {
    if (!bossReferenced.has(name)) {
      problems.push(
        `pack "${pack}": boss "${name}" is named by no stage of this pack — dead content (registration is not reachability)`,
      );
    }
  }

  // Every pack shot, option and bomb must be equipped by some pack character,
  // resolving pack-first — a weapon nobody flies is the shipped-but-unreachable
  // defect one layer down. Characters themselves need no such check: a
  // registered character is always offered on the SELECT screen.
  const firedShots = new Set<string>();
  const equippedOptions = new Set<string>();
  const equippedBombs = new Set<string>();
  for (const k of characterKeys) {
    const c = packCharacters[k] as ContentCharacter;
    if (packShotNames.has(c.shot)) firedShots.add(c.shot);
    if (packOptionNames.has(c.options)) equippedOptions.add(c.options);
    if (packBombNames.has(c.bomb)) equippedBombs.add(c.bomb);
  }
  for (const name of shotKeys) {
    if (!firedShots.has(name)) {
      problems.push(
        `pack "${pack}": shot "${name}" is fired by no character of this pack — dead content (registration is not reachability)`,
      );
    }
  }
  for (const name of optionKeys) {
    if (!equippedOptions.has(name)) {
      problems.push(
        `pack "${pack}": options "${name}" are equipped by no character of this pack — dead content (registration is not reachability)`,
      );
    }
  }
  for (const name of bombKeys) {
    if (!equippedBombs.has(name)) {
      problems.push(
        `pack "${pack}": bomb "${name}" is equipped by no character of this pack — dead content (registration is not reachability)`,
      );
    }
  }

  // Every pack effect must be triggered by some pack enemy (onHit/onDeath),
  // boss (onDeath) or bomb (effect); every pack item dropped by some enemy or
  // boss spoils — all pack-first. A cosmetic nothing fires and a drop nothing
  // scatters are the same dead content as a stage no campaign reaches.
  const triggeredEffects = new Set<string>();
  const droppedItems = new Set<string>();
  for (const k of enemyKeys) {
    const e = enemies[k] as ContentEnemy;
    for (const which of ['onHit', 'onDeath'] as const) {
      const eff = e[which];
      if (eff !== undefined && packEffectNames.has(eff)) triggeredEffects.add(eff);
    }
    for (const [item] of e.spoils ?? []) if (packItemNames.has(item)) droppedItems.add(item);
  }
  for (const k of bossKeys) {
    const b = packBosses[k] as ContentBoss;
    if (b.onDeath !== undefined && packEffectNames.has(b.onDeath)) triggeredEffects.add(b.onDeath);
    for (const [item] of b.spoils ?? []) if (packItemNames.has(item)) droppedItems.add(item);
  }
  for (const k of bombKeys) {
    const bomb = packBombs[k] as ContentBomb;
    if (bomb.effect !== undefined && packEffectNames.has(bomb.effect)) triggeredEffects.add(bomb.effect);
  }
  for (const name of effectKeys) {
    if (!triggeredEffects.has(name)) {
      problems.push(
        `pack "${pack}": effect "${name}" is triggered by no enemy, boss or bomb of this pack — dead content (registration is not reachability)`,
      );
    }
  }
  for (const name of itemKeys) {
    if (!droppedItems.has(name)) {
      problems.push(
        `pack "${pack}": item "${name}" is dropped by no enemy or boss of this pack — dead content (registration is not reachability)`,
      );
    }
  }

  if (problems.length > 0) throw new PackInjectError(problems);

  // Pack-first qualification of a cross-registry reference: a name owned by the
  // pack becomes `<pack>/<name>`, a built-in stays bare. Applied to every
  // reference the built spec carries as a string the engine later resolves.
  const refEffect = (name: string): string => (packEffectNames.has(name) ? q(name) : name);
  const refItem = (name: string): string => (packItemNames.has(name) ? q(name) : name);
  const refShot = (name: string): string => (packShotNames.has(name) ? q(name) : name);
  const refOption = (name: string): string => (packOptionNames.has(name) ? q(name) : name);
  const refBomb = (name: string): string => (packBombNames.has(name) ? q(name) : name);
  const refPortrait = (name: string): string => (packPortraitNames.has(name) ? q(name) : name);

  // --- build (only past a clean validation) -----------------------------
  const builtShots: BuiltShot[] = shotKeys.map((name) => ({
    name: q(name),
    spec: toShotType(q(name), packShots[name] as ContentShot),
  }));
  const builtOptions: BuiltOptions[] = optionKeys.map((name) => ({
    name: q(name),
    spec: toOptionSpec(packOptions[name] as ContentOptions),
  }));
  const builtBombs: BuiltBomb[] = bombKeys.map((name) => ({
    name: q(name),
    spec: toBombSpec(packBombs[name] as ContentBomb, refEffect),
  }));
  const builtEffects: BuiltEffect[] = effectKeys.map((name) => ({
    name: q(name),
    spec: toEffectSpec(packEffects[name] as ContentEffect),
  }));
  const builtItems: BuiltItem[] = itemKeys.map((name) => ({
    name: q(name),
    spec: toItemSpec(packItems[name] as ContentItem),
  }));
  const builtCharacters: BuiltCharacter[] = characterKeys.map((name) => {
    const c = packCharacters[name] as ContentCharacter;
    return {
      name: q(name),
      char: c,
      shotRef: refShot(c.shot),
      optionsRef: refOption(c.options),
      bombRef: refBomb(c.bomb),
    };
  });
  const builtEnemies: BuiltEnemy[] = enemyKeys.map((name) => ({
    name: q(name),
    spec: toEnemySpec(enemies[name] as ContentEnemy, refEffect, refItem),
  }));
  const builtBosses: BuiltBoss[] = bossKeys.map((name) => ({
    name: q(name),
    spec: toBossSpec(packBosses[name] as ContentBoss, refEffect, refItem, refMusic, refPortrait),
  }));
  const builtStages: BuiltStage[] = stageKeys.map((name) => ({
    name: q(name),
    spec: toStageSpec(q(name), stages[name] as ContentStage, packEnemies, packBossNames, packStages, q, refMusic),
  }));
  const campaigns: Campaign[] = stageKeys
    .filter((k) => (stages[k] as ContentStage).entry === true)
    .map((k) => ({ label: q(k), stage: q(k) }));

  return {
    campaigns,
    shots: builtShots,
    options: builtOptions,
    bombs: builtBombs,
    effects: builtEffects,
    items: builtItems,
    characters: builtCharacters,
    enemies: builtEnemies,
    bosses: builtBosses,
    stages: builtStages,
  };
}

/**
 * Turn a `ContentStage` into a `StageSpec`: qualify the name, qualify each
 * wave's own-pack enemy and boss, resolve `next` (pack-first, `null` → the
 * spec's `undefined` "no next"), and drop `entry`, which is menu data the spec
 * has no field for. A boss, a `next` chain and the `music` track resolve
 * pack-first; backgrounds pass through bare — they are built-in.
 */
function toStageSpec(
  name: string,
  s: ContentStage,
  packEnemies: ReadonlySet<string>,
  packBosses: ReadonlySet<string>,
  packStages: ReadonlySet<string>,
  q: (entry: string) => string,
  refMusic: (name: string) => string,
): StageSpec {
  const waves: WaveEntry[] = s.waves.map((w) => toWave(w, packEnemies, packBosses, q));

  const spec: StageSpec = { name, waves };
  if (s.seed !== undefined) spec.seed = s.seed;
  if (s.outro !== undefined) spec.outro = s.outro;
  if (s.boss !== undefined) spec.boss = packBosses.has(s.boss) ? q(s.boss) : s.boss;
  if (s.background !== undefined) spec.background = s.background;
  if (s.music !== undefined) spec.music = refMusic(s.music);
  if (typeof s.next === 'string') {
    spec.next = packStages.has(s.next) ? q(s.next) : s.next;
  }
  return spec;
}

function toWave(
  w: ContentStageWave,
  packEnemies: ReadonlySet<string>,
  packBosses: ReadonlySet<string>,
  q: (entry: string) => string,
): WaveEntry {
  if (w.boss !== undefined) {
    const boss: BossWave = { at: w.at, boss: packBosses.has(w.boss) ? q(w.boss) : w.boss };
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

/**
 * Turn a `ContentBoss` into a `BossSpec`. Every scalar field passes through by
 * assignment — which is the compile-time drift guard: rename a field on either
 * shape and this stops compiling. `phases` is translated (a pack spell card
 * declares `hpSeconds` where the engine's `SpellCard` wants `hp`), and the
 * `onDeath` effect, `music` track, `spoils` item names and each dialogue
 * speaker's portrait are qualified pack-first.
 */
function toBossSpec(
  b: ContentBoss,
  refEffect: (name: string) => string,
  refItem: (name: string) => string,
  refMusic: (name: string) => string,
  refPortrait: (name: string) => string,
): BossSpec {
  const spec: BossSpec = {
    sprite: b.sprite,
    radius: b.radius,
    phases: b.phases.map(toSpellCard),
  };
  if (b.width !== undefined) spec.width = b.width;
  if (b.height !== undefined) spec.height = b.height;
  if (b.tint !== undefined) spec.tint = b.tint;
  if (b.entry !== undefined) spec.entry = b.entry;
  if (b.onDeath !== undefined) spec.onDeath = refEffect(b.onDeath);
  if (b.music !== undefined) spec.music = refMusic(b.music);
  if (b.spoils !== undefined) {
    spec.spoils = b.spoils.map(([name, count]): readonly [string, number] => [refItem(name), count]);
  }
  if (b.dialogue !== undefined) {
    // A pack speaker qualifies to its own portrait; a built-in speaker stays
    // bare. The shell reads `speaker` off `Run.dialogue` and hands it to
    // `portraitImage`, so the qualified name must match what the loader registered.
    spec.dialogue = b.dialogue.map((line) => ({ speaker: refPortrait(line.speaker), text: line.text }));
  }
  return spec;
}

/**
 * `hpSeconds` becomes `hp = phaseHp(hpSeconds)`, and an absent `timeLimit`
 * defaults to `phaseClock(hp)` — the same derivation the engine's own bosses
 * use, so a `REFERENCE_DPS` change re-sizes pack bosses too. `motion`/`timeline`
 * are cast for the reason `ContentEnemy`'s are: their deep shape is the motion
 * DSL's, resolved by name above, not re-typed here.
 */
function toSpellCard(c: ContentSpellCard): SpellCard {
  const hp = phaseHp(c.hpSeconds);
  const card: SpellCard = {
    name: c.name,
    hp,
    timeLimit: c.timeLimit ?? phaseClock(hp),
    patterns: c.patterns.map(toPhasePattern),
  };
  if (c.difficulties !== undefined) card.difficulties = c.difficulties;
  if (c.motion !== undefined) card.motion = c.motion as unknown as SpellCard['motion'];
  if (c.timeline !== undefined) card.timeline = c.timeline as unknown as SpellCard['timeline'];
  if (c.bonus !== undefined) card.bonus = c.bonus;
  if (c.isSpell !== undefined) card.isSpell = c.isSpell;
  if (c.background !== undefined) card.background = c.background;
  return card;
}

function toPhasePattern(p: ContentPhasePattern): PhasePattern {
  const slot: PhasePattern = { pattern: p.pattern };
  if (p.options !== undefined) slot.options = p.options;
  if (p.difficulty !== undefined) slot.difficulty = p.difficulty;
  if (p.startAt !== undefined) slot.startAt = p.startAt;
  if (p.stopAt !== undefined) slot.stopAt = p.stopAt;
  return slot;
}

/**
 * Turn a `ContentShot` into a `ShotType`, stamping the qualified `name` the
 * registry checks against its key. The bullet spec and offsets pass through by
 * cast: sprites are global atlas cells (not pack-namespaced) and behaviours are
 * engine code, both resolved by name above, so nothing inside needs rewriting.
 */
function toShotType(name: string, s: ContentShot): ShotType {
  const type: ShotType = {
    name,
    levels: s.levels.map(
      (l): ShotSpec => ({
        spec: l.spec as unknown as ShotSpec['spec'],
        offsets: l.offsets as unknown as ShotSpec['offsets'],
        period: l.period,
      }),
    ),
  };
  if (s.description !== undefined) type.description = s.description;
  return type;
}

/** Turn a `ContentOptions` into an `OptionSpec`; the bullet and slots pass through. */
function toOptionSpec(o: ContentOptions): OptionSpec {
  const spec: OptionSpec = {
    sprite: o.sprite,
    shot: o.shot as unknown as OptionSpec['shot'],
    period: o.period,
    levels: o.levels as unknown as OptionSpec['levels'],
  };
  if (o.followSpeed !== undefined) spec.followSpeed = o.followSpeed;
  if (o.tint !== undefined) spec.tint = o.tint;
  return spec;
}

/** Turn a `ContentBomb` into a `BombSpec`, qualifying its `effect` pack-first. */
function toBombSpec(b: ContentBomb, refEffect: (name: string) => string): BombSpec {
  const spec: BombSpec = {
    duration: b.duration,
    invulnTicks: b.invulnTicks,
    damagePerTick: b.damagePerTick,
  };
  if (b.radius !== undefined) spec.radius = b.radius;
  if (b.convertBullets !== undefined) spec.convertBullets = b.convertBullets;
  if (b.effect !== undefined) spec.effect = refEffect(b.effect);
  return spec;
}

/**
 * Turn a `ContentEffect` into a `ParticleSpec`. Every field passes through by
 * assignment — the drift guard — with the `Amount` and `scale` unions cast,
 * since `ContentEffect` types them structurally identical but nominally loose.
 */
function toEffectSpec(e: ContentEffect): ParticleSpec {
  const spec: ParticleSpec = {
    sprite: e.sprite,
    count: e.count,
    speed: e.speed,
    life: e.life,
  };
  if (e.spread !== undefined) spec.spread = e.spread;
  if (e.direction !== undefined) spec.direction = e.direction;
  if (e.drag !== undefined) spec.drag = e.drag;
  if (e.gravity !== undefined) spec.gravity = e.gravity;
  if (e.scale !== undefined) spec.scale = e.scale;
  if (e.alpha !== undefined) spec.alpha = e.alpha;
  if (e.spin !== undefined) spec.spin = e.spin;
  if (e.tint !== undefined) spec.tint = e.tint;
  if (e.additive !== undefined) spec.additive = e.additive;
  return spec;
}

/** Turn a `ContentItem` into an `ItemSpec`; the motion DSL field is cast. */
function toItemSpec(it: ContentItem): ItemSpec {
  const spec: ItemSpec = {
    sprite: it.sprite,
    radius: it.radius,
    value: it.value,
    kind: it.kind,
  };
  if (it.motion !== undefined) spec.motion = it.motion as unknown as ItemSpec['motion'];
  if (it.tint !== undefined) spec.tint = it.tint;
  if (it.magnetSpeed !== undefined) spec.magnetSpeed = it.magnetSpeed;
  return spec;
}

/**
 * Turn a `ContentCharacter` into a `CharacterSpec`, resolving its indirections:
 * the `shot` name becomes the weapon's `levels` ladder (fetched from the shot
 * registry, which is why this runs only after the pack's shots are registered —
 * see `injectPack`), and `options`/`bomb` carry the qualified names the run
 * resolves later. The `{ ...c.player, shots }` spread is the drift guard against
 * `PlayerConfig`: a required player field missing from `ContentPlayer` stops
 * this compiling.
 */
function toCharacterSpec(
  c: ContentCharacter,
  shotRef: string,
  optionsRef: string,
  bombRef: string,
): CharacterSpec {
  const spec: CharacterSpec = {
    label: c.label,
    sprite: c.sprite,
    options: optionsRef,
    bomb: bombRef,
    player: { ...c.player, shots: getShot(shotRef).levels },
  };
  if (c.blurb !== undefined) spec.blurb = c.blurb;
  if (c.width !== undefined) spec.width = c.width;
  if (c.height !== undefined) spec.height = c.height;
  return spec;
}
