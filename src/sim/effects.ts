/**
 * Cosmetic particle effects.
 *
 * Effects are pure decoration: they never collide, never score, never feed back
 * into the simulation. That constraint is the reason this module exists as its
 * own file, and the reason it draws exclusively from the `fx` stream.
 *
 * Upstream scattered damage-effect particles using its single global generator
 * (`upstream source/Effect.js:1244`), which welded visuals to determinism:
 * adding one particle shifted every subsequent bullet, and any change to effect
 * spawning desynced a replay. See CLAUDE.md, rule 2.
 *
 * The defence here is structural, not disciplinary. `EffectSystem` takes no
 * generator argument anywhere in its API, so there is no parameter through
 * which a caller could hand it the sim stream — the only reachable source of
 * randomness in this file is the module-level `fx` import.
 *
 * Interpolating scale and alpha on `age / life` is fine here in a way it would
 * not be in the sim: nothing downstream reads these values back.
 */

import { Pool } from '../core/pool';
import { fx } from '../core/random';
import type { BulletCell } from '../render/procedural';

/** A scalar, or a range drawn once per particle from the `fx` stream. */
type Amount = number | { min: number; max: number };

/** The four authored transient materials an actor can expose when struck. */
export type HitMaterial = 'surface' | 'skeleton' | 'mycelium' | 'heart';

export interface ParticleSpec {
  /** Atlas cell name. */
  sprite: string;
  /** Particles per emit. */
  count: Amount;
  /** Initial speed, px/tick. Never px/second: see CLAUDE.md, rule 1. */
  speed: Amount;
  /** Ticks before the particle expires. */
  life: Amount;
  /** Angular window in degrees. 360 = omnidirectional. Defaults to 360. */
  spread?: number;
  /** Centre of the spread, degrees. 0 = right, 90 = down, matching the motion DSL. */
  direction?: number;
  /** Per-tick multiplier on velocity, 0..1. Omit for none. */
  drag?: number;
  /** Constant downward acceleration, px/tick^2. Negative drifts upward. */
  gravity?: number;
  /** Constant size, or a size interpolated across the particle's life. */
  scale?: number | { from: number; to: number };
  /** Opacity interpolated across the particle's life. Defaults to a constant 1. */
  alpha?: { from: number; to: number };
  /** Constant spin, radians/tick. */
  spin?: number;
  /** Tint, 0..1, multiplied with the texel by the sprite shader. */
  tint?: { r?: number; g?: number; b?: number };
  /** Additive blending reads as light — right for sparks, wrong for smoke. */
  additive?: boolean;
}

const registry = new Map<string, ParticleSpec>();

export function defineEffect(name: string, spec: ParticleSpec): void {
  if (registry.has(name)) {
    throw new Error(`effect "${name}" is already defined`);
  }
  registry.set(name, spec);
}

export function getEffectSpec(name: string): ParticleSpec {
  const spec = registry.get(name);
  if (!spec) throw new Error(`unknown effect "${name}"`);
  return spec;
}

export function effectNames(): readonly string[] {
  return [...registry.keys()];
}

const DEG = Math.PI / 180;

function resolve(value: Amount): number {
  return typeof value === 'number' ? value : fx.range(value.min, value.max);
}

function resolveCount(value: Amount): number {
  if (typeof value === 'number') return Math.max(0, Math.floor(value));
  return fx.int(value.min, value.max);
}

/** Held by pooled particles that have never been emitted, so `spec` is never null. */
const IDLE: ParticleSpec = { sprite: 'mote', count: 0, speed: 0, life: 0 };

export class Particle {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  age = 0;
  life = 0;
  scale = 1;
  alpha = 1;
  /** Radians, matching `SpriteStyle.rotation`. */
  angle = 0;
  alive = false;

  /** The spec stays attached: the renderer reads sprite, tint and blending from it. */
  spec: ParticleSpec = IDLE;

  reset(): void {
    this.alive = false;
    this.age = 0;
  }
}

export interface EffectSystemOptions {
  initial?: number;
  max?: number;
}

export class EffectSystem {
  readonly particles: Particle[] = [];
  readonly #pool: Pool<Particle>;

  /**
   * Particles refused because the pool was at its ceiling. Dropping them is
   * always the right call — losing decoration costs nothing the player can
   * lose a run to, so this is telemetry, not an error path.
   */
  droppedParticles = 0;

  constructor(options: EffectSystemOptions = {}) {
    this.#pool = new Pool(() => new Particle(), {
      initial: options.initial ?? 256,
      max: options.max ?? 4096,
      reset: (p) => p.reset(),
    });
  }

  /** `direction` overrides the spec's, in degrees — for directional bursts like graze sparks. */
  emit(name: string, x: number, y: number, direction?: number): void {
    const spec = getEffectSpec(name);
    const count = resolveCount(spec.count);
    const centre = direction ?? spec.direction ?? 0;
    const spread = spec.spread ?? 360;
    const scaleFrom = typeof spec.scale === 'number' ? spec.scale : (spec.scale?.from ?? 1);
    const alphaFrom = spec.alpha?.from ?? 1;

    for (let i = 0; i < count; i++) {
      const p = this.#pool.acquire();
      if (!p) {
        this.droppedParticles += count - i;
        return;
      }

      const angle = (centre + fx.range(-spread / 2, spread / 2)) * DEG;
      const speed = resolve(spec.speed);

      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.age = 0;
      // Floor at one tick: a range that rounds to zero would otherwise emit a
      // particle that dies before it is ever drawn, and divide t by zero.
      p.life = Math.max(1, Math.round(resolve(spec.life)));
      p.scale = scaleFrom;
      p.alpha = alphaFrom;
      // Elongated cells (needle, shard) only read correctly pointing along
      // travel. Radially symmetric ones cannot tell, so this costs nothing.
      p.angle = angle;
      p.alive = true;
      p.spec = spec;

      this.particles.push(p);
    }
  }

  /**
   * Emit one actor-material response. This is deliberately a composition API,
   * not a new simulation state: it only expands to registered particles, whose
   * random draws are structurally confined to the module-level fx stream.
   */
  emitMaterialHit(material: HitMaterial, x: number, y: number): void {
    switch (material) {
      case 'surface': this.emit('material.surface', x, y); break;
      case 'skeleton': this.emit('material.skeleton', x, y); break;
      case 'mycelium': this.emit('material.mycelium', x, y); break;
      case 'heart': this.emit('material.heart', x, y); break;
    }
  }

  step(): void {
    let write = 0;
    for (let read = 0; read < this.particles.length; read++) {
      const p = this.particles[read];
      if (p === undefined) continue;
      const spec = p.spec;

      // Gravity before drag, so drag damps the accumulated fall and speed
      // settles at a terminal value instead of growing without bound.
      if (spec.gravity) p.vy += spec.gravity;
      if (spec.drag !== undefined) {
        p.vx *= spec.drag;
        p.vy *= spec.drag;
      }

      p.x += p.vx;
      p.y += p.vy;
      p.age++;

      if (spec.spin) p.angle += spec.spin;

      const t = p.age / p.life;
      if (typeof spec.scale === 'object') {
        p.scale = spec.scale.from + (spec.scale.to - spec.scale.from) * t;
      }
      if (spec.alpha) {
        p.alpha = spec.alpha.from + (spec.alpha.to - spec.alpha.from) * t;
      }

      if (p.age >= p.life) {
        p.alive = false;
        this.#pool.release(p);
        continue;
      }

      this.particles[write++] = p;
    }
    this.particles.length = write;
  }

  clear(): void {
    for (const p of this.particles) {
      p.alive = false;
      this.#pool.release(p);
    }
    this.particles.length = 0;
  }

  get count(): number {
    return this.particles.length;
  }

  get poolSize(): number {
    return this.#pool.size;
  }
}

/* ------------------------------------------------------------------ */
/* Starter set                                                         */
/* ------------------------------------------------------------------ */

/**
 * Typing `sprite` against the atlas here means a renamed or repacked cell
 * fails the build rather than silently drawing the wrong shape at runtime.
 * The import is type-only, so this file keeps no runtime dependency on the
 * render layer — effects must remain testable without a canvas.
 */
function defineSprite(
  name: string,
  sprite: BulletCell,
  spec: Omit<ParticleSpec, 'sprite'>,
): void {
  defineEffect(name, { ...spec, sprite });
}

defineSprite('explosion', 'glow.medium', {
  count: { min: 12, max: 18 },
  speed: { min: 0.8, max: 3.2 },
  life: { min: 18, max: 30 },
  drag: 0.92,
  scale: { from: 1.1, to: 0.2 },
  alpha: { from: 1, to: 0 },
  tint: { r: 1, g: 0.72, b: 0.38 },
  additive: true,
});

defineSprite('hit', 'spark', {
  count: { min: 4, max: 7 },
  speed: { min: 1.5, max: 3.5 },
  life: { min: 6, max: 10 },
  drag: 0.86,
  scale: { from: 0.55, to: 0.15 },
  alpha: { from: 1, to: 0 },
  tint: { r: 1, g: 0.95, b: 0.8 },
  additive: true,
});

// Player weapon contact language. All variance remains inside this FX-only
// system; the weapon semantic chooses a name, never a sprite heuristic.
defineSprite('impact.needle', 'needle', {
  count: { min: 1, max: 2 }, speed: { min: 1, max: 2 }, life: { min: 4, max: 7 }, spread: 18,
  drag: 0.8, scale: { from: 0.8, to: 0.15 }, alpha: { from: 1, to: 0 }, tint: { r: 1, g: 0.97, b: 0.86 }, additive: true,
});
defineSprite('impact.round', 'glow.small', {
  count: 1, speed: 0, life: 4, scale: { from: 0.75, to: 0.1 }, alpha: { from: 1, to: 0 }, tint: { r: 1, g: 0.38, b: 0.58 }, additive: true,
});
defineSprite('impact.tracking', 'shard', {
  count: { min: 2, max: 3 }, speed: { min: 1.2, max: 2.4 }, life: { min: 6, max: 10 }, spread: 54,
  drag: 0.86, gravity: 0.08, spin: 0.34, scale: { from: 0.65, to: 0.12 }, alpha: { from: 1, to: 0 }, tint: { r: 1, g: 0.86, b: 0.42 }, additive: true,
});
defineSprite('impact.beam', 'spark', {
  count: 2, speed: { min: 0.4, max: 1.1 }, life: { min: 4, max: 6 }, spread: 24,
  drag: 0.75, scale: { from: 0.5, to: 0.08 }, alpha: { from: 0.8, to: 0 }, tint: { r: 0.75, g: 0.95, b: 1 }, additive: true,
});
defineSprite('impact.scatter', 'glow.medium', {
  count: { min: 3, max: 5 }, speed: { min: 0.4, max: 1.5 }, life: { min: 5, max: 8 },
  drag: 0.72, scale: { from: 1.05, to: 0.12 }, alpha: { from: 1, to: 0 }, tint: { r: 1, g: 0.48, b: 0.22 }, additive: true,
});
defineSprite('impact.scatter.pause', 'glow.large', {
  count: 1, speed: 0, life: 3, scale: { from: 0.48, to: 0.26 }, alpha: { from: 0.72, to: 0 }, tint: { r: 1, g: 0.76, b: 0.45 }, additive: true,
});

// Actor material feedback. These use dedicated animated FX strips rather than
// recolouring the generic hit spark: each profile has its own readable motion.
defineEffect('material.surface', {
  sprite: 'material.surface', count: { min: 1, max: 2 }, speed: { min: 0, max: 0.25 }, life: 8,
  spread: 360, drag: 0.68, scale: { from: 0.72, to: 1.18 }, alpha: { from: 0.8, to: 0 }, tint: { r: 0.62, g: 0.82, b: 1 }, additive: true,
});
defineEffect('material.skeleton', {
  sprite: 'material.skeleton', count: { min: 2, max: 4 }, speed: { min: 0.8, max: 2.1 }, life: 8,
  spread: 360, drag: 0.82, spin: 0.22, scale: { from: 0.72, to: 0.22 }, alpha: { from: 0.95, to: 0 }, tint: { r: 0.94, g: 0.98, b: 1 }, additive: true,
});
defineEffect('material.mycelium', {
  sprite: 'material.mycelium', count: { min: 2, max: 3 }, speed: { min: 0.65, max: 1.35 }, life: 8,
  spread: 360, drag: 0.7, scale: { from: 0.78, to: 0.18 }, alpha: { from: 0.9, to: 0 }, tint: { r: 0.82, g: 0.94, b: 1 }, additive: true,
});
defineEffect('material.heart', {
  sprite: 'material.heart', count: 1, speed: 0, life: 8,
  scale: { from: 0.92, to: 1.08 }, alpha: { from: 1, to: 0 }, tint: { r: 1, g: 0.72, b: 0.82 }, additive: true,
});

// Graze is feedback on a near miss, so it fires along the bullet's heading and
// stays cool-toned — it must never be mistaken for taking damage.
defineSprite('graze', 'needle', {
  count: 3,
  speed: { min: 1, max: 2 },
  life: { min: 8, max: 14 },
  spread: 60,
  drag: 0.9,
  scale: { from: 0.5, to: 0.1 },
  alpha: { from: 0.9, to: 0 },
  tint: { r: 0.55, g: 0.8, b: 1 },
  additive: true,
});

defineSprite('pickup', 'star', {
  count: { min: 5, max: 8 },
  speed: { min: 0.6, max: 1.6 },
  life: { min: 20, max: 28 },
  drag: 0.95,
  gravity: -0.03, // drifts up, reading as a reward rather than as debris
  scale: { from: 0.5, to: 0.05 },
  alpha: { from: 1, to: 0 },
  spin: 0.12,
  tint: { r: 1, g: 0.88, b: 0.45 },
  additive: true,
});

// Fired from the player's gun, which points up the screen: y-down space, so -90.
defineSprite('muzzle', 'glow.small', {
  count: { min: 2, max: 4 },
  speed: { min: 0.5, max: 1.4 },
  life: { min: 4, max: 7 },
  spread: 50,
  direction: -90,
  scale: { from: 0.9, to: 0.2 },
  alpha: { from: 0.85, to: 0 },
  tint: { r: 0.8, g: 0.9, b: 1 },
  additive: true,
});

defineSprite('death.big', 'glow.large', {
  count: { min: 26, max: 34 },
  speed: { min: 1.2, max: 5 },
  life: { min: 30, max: 50 },
  drag: 0.94,
  gravity: 0.02,
  scale: { from: 1.6, to: 0.3 },
  alpha: { from: 1, to: 0 },
  tint: { r: 1, g: 0.55, b: 0.3 },
  additive: true,
});

/**
 * The frame-animated explosions (逐帧爆炸) — a single particle whose sprite is a
 * one-shot strip on the fx sheet, augmenting the scatter above (scatter = sparks
 * thrown off; the strip = the hero flash). `sprite` names an fx-atlas strip, not
 * a `BulletCell`, so these use `defineEffect` directly rather than the
 * atlas-typed `defineSprite` helper.
 *
 * `count: 1, speed: 0` make it a single stationary particle, and `life` is set
 * to the strip's `stripLength` (`frames × ticksPerFrame`) so the particle dies
 * exactly as its last frame finishes — no completion flag (CLAUDE.md rule 8), no
 * freeze-then-linger. That coupling is not typed here (render lives behind the
 * import boundary, so `stripLength` cannot be imported as a value): it is
 * MEASURED by `src/render/strip.test.ts`, which re-derives every once effect's
 * `stripLength` from `FX_STRIPS` and fails if this `life` drifts — the damage
 * model's "measure, don't type" discipline, applied to frame length.
 */
defineEffect('burst', {
  sprite: 'burst',
  count: 1,
  speed: 0,
  life: 24, // stripLength('burst') = 8 frames × 3 ticks; asserted in strip.test.ts
  scale: { from: 1, to: 1 },
  tint: { r: 1, g: 0.72, b: 0.38 },
  additive: true,
});

defineEffect('burst.big', {
  sprite: 'burst.big',
  count: 1,
  speed: 0,
  life: 36, // stripLength('burst.big') = 12 frames × 3 ticks; asserted in strip.test.ts
  scale: { from: 1, to: 1 },
  tint: { r: 1, g: 0.55, b: 0.3 },
  additive: true,
});

/**
 * The missile detonation tiers (导弹轮) — a missile's airburst where it dies, one
 * `count:1, speed:0` particle per tier whose sprite is a `once` fx strip
 * (`missile.pop.*` in `FX_STRIPS`), dying as its last frame finishes because
 * `life === stripLength` (rule 8 — no completion flag; measured, not typed, by
 * `src/render/strip.test.ts` like `burst`/`burst.big`). These are MISSILE-OWNED
 * and deliberately distinct from `burst`/`burst.big`: those keep serving generic
 * enemy/boss/player death, so a missile-explosion never plays on a trash kill.
 *
 * They live here — engine code, not pack data — because a base missile spec names
 * one by string (`MissileSpec.explosion`) and `effects.emit` throws on an unknown
 * name (line 69): the procedural floor must exist before any content names it
 * (the never-blocked floor, rule 9). Registered now, with the content stage that
 * first FIRES a missile — registering them any earlier would redden
 * `reachability.test.ts`'s "every registered particle effect" scan, which fails a
 * tier no firer reaches. The frame counts are the BulletPack `Exp` files' own
 * (tiny carries the most, 11; big the fewest, 8), warm-graded by threat.
 */
defineEffect('missile.pop.tiny', {
  sprite: 'missile.pop.tiny',
  count: 1,
  speed: 0,
  life: 22, // stripLength = 11 frames × 2 ticks; asserted in strip.test.ts
  scale: { from: 1, to: 1 },
  tint: { r: 1, g: 0.78, b: 0.42 },
  additive: true,
});

defineEffect('missile.pop.mid', {
  sprite: 'missile.pop.mid',
  count: 1,
  speed: 0,
  life: 18, // stripLength = 9 frames × 2 ticks; asserted in strip.test.ts
  scale: { from: 1, to: 1 },
  tint: { r: 1, g: 0.66, b: 0.34 },
  additive: true,
});

defineEffect('missile.pop.big', {
  sprite: 'missile.pop.big',
  count: 1,
  speed: 0,
  life: 24, // stripLength = 8 frames × 3 ticks; asserted in strip.test.ts
  scale: { from: 1, to: 1 },
  tint: { r: 1, g: 0.5, b: 0.26 },
  additive: true,
});

/**
 * The death-explosion tiers (战役扩容轮) — the fx a death emits, selected by tier
 * in `game/deathfx.ts` and fired at the three death sites in `run.ts`. Each is a
 * single `count:1, speed:0` particle on a `once` fx strip (`FX_STRIPS`), dying as
 * its last frame finishes because `life === stripLength` (rule 8 — no completion
 * flag; measured, not typed, by `render/strip.test.ts` like `burst`/`burst.big`),
 * EXCEPT `debris`, which scatters `count > 1` on a `loop` ember. They live here —
 * engine code, not pack data — because a death site names one by string and
 * `effects.emit` throws on an unknown name (the never-blocked floor, rule 9), and
 * because their sprites are fx-sheet strips, so they use `defineEffect` directly
 * rather than the atlas-typed `defineSprite`. Warm-graded by threat.
 *
 * `boom.boss.back` is the ONLY `additive: false` effect: it is the occluding back
 * plate of the layered boss blast, a dark-warm billow that draws normal-blend at
 * `Layer.BurstsBack` UNDER the bright additive core — `main.ts` routes it there by
 * `spec.additive === false`, not by a hardcoded name.
 */
defineEffect('boom.elite', {
  sprite: 'boom.elite',
  count: 1,
  speed: 0,
  life: 28, // stripLength = 28 frames × 1 tick; asserted in strip.test.ts
  scale: { from: 1, to: 1 },
  tint: { r: 1, g: 0.7, b: 0.36 },
  additive: true,
});

defineEffect('boom.elite.spray', {
  sprite: 'boom.elite.spray',
  count: 1,
  speed: 0,
  life: 39, // stripLength = 39 frames × 1 tick; asserted in strip.test.ts
  scale: { from: 1, to: 1 },
  tint: { r: 1, g: 0.82, b: 0.5 },
  additive: true,
});

defineEffect('boom.boss.back', {
  sprite: 'boom.boss.back',
  count: 1,
  speed: 0,
  life: 45, // stripLength = 15 frames × 3 ticks; asserted in strip.test.ts
  scale: { from: 1, to: 1 },
  // A dark-warm smoke, so the white billow floor reads as an occluding plate.
  tint: { r: 0.32, g: 0.18, b: 0.12 },
  additive: false,
});

defineEffect('boom.boss.top', {
  sprite: 'boom.boss.top',
  count: 1,
  speed: 0,
  life: 48, // stripLength = 16 frames × 3 ticks; asserted in strip.test.ts
  scale: { from: 1, to: 1 },
  tint: { r: 1, g: 0.62, b: 0.3 },
  additive: true,
});

defineEffect('boom.player', {
  sprite: 'boom.player',
  count: 1,
  speed: 0,
  life: 76, // stripLength = 38 frames × 2 ticks; asserted in strip.test.ts
  scale: { from: 1, to: 1 },
  // Cooler and whiter than an enemy blast — the pilot's own death reads apart.
  tint: { r: 0.9, g: 0.85, b: 1 },
  additive: true,
});

/**
 * `debris` — the ember scatter thrown off a boss or player death, the round's one
 * genuinely new fx draw (`count > 1`, design §a): fx-stream and order-independent
 * w.r.t. the sim, so harmless. Each ember animates the `debris` `loop` strip off
 * its OWN run-relative `p.age` (rule 1's analogue), fading on its particle alpha —
 * no `life === stripLength` coupling, because a loop never finishes.
 */
defineEffect('debris', {
  sprite: 'debris',
  count: { min: 8, max: 14 },
  speed: { min: 1, max: 4.5 },
  life: { min: 24, max: 44 },
  drag: 0.92,
  gravity: 0.03,
  scale: { from: 1.2, to: 0.5 },
  alpha: { from: 1, to: 0 },
  spin: 0.1,
  tint: { r: 1, g: 0.7, b: 0.4 },
  additive: true,
});
