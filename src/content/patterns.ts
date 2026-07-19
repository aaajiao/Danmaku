/**
 * Danmaku patterns.
 *
 * A pattern is a named emitter: given a tick and a position, it decides what to
 * fire. Patterns are registered rather than hard-coded so new content is added
 * by writing a file and importing it — never by editing the engine.
 *
 * Upstream authored patterns two ways at once: literal arrays in
 * `data/bullets_params.js` and imperative generators in `data/danmaku_helper.js`
 * that ran at script-parse time. The second is what made its data load-order
 * dependent. Here generation is explicit and happens when a pattern runs.
 */

import type { Random } from '../core/random';
import type { BulletSpec } from '../sim/bullet';
import type { BulletSystem, Faction } from '../sim/bullet';

export interface EmitContext {
  /** Ticks since this emitter started. */
  age: number;
  /** Emitter position. */
  x: number;
  y: number;
  /** Who to aim at. */
  targetX: number;
  targetY: number;
  bullets: BulletSystem;
  rng: Random;
  faction: Faction;
}

/** Returns false when the pattern is finished and may be removed. */
export type Pattern = (context: EmitContext) => boolean | void;

export interface PatternDefinition {
  name: string;
  /** Human description, surfaced in tooling. */
  description?: string;
  create(options?: Readonly<Record<string, unknown>>): Pattern;
}

const registry = new Map<string, PatternDefinition>();

export function definePattern(definition: PatternDefinition): void {
  if (registry.has(definition.name)) {
    throw new Error(`pattern "${definition.name}" is already defined`);
  }
  registry.set(definition.name, definition);
}

export function createPattern(
  name: string,
  options?: Readonly<Record<string, unknown>>,
): Pattern {
  const definition = registry.get(name);
  if (!definition) throw new Error(`unknown pattern "${name}"`);
  return definition.create(options);
}

export function patternNames(): readonly string[] {
  return [...registry.keys()];
}

export function patternDefinitions(): readonly PatternDefinition[] {
  return [...registry.values()];
}

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

const DEG = Math.PI / 180;

/** Fire `count` bullets evenly around a full circle. */
export function ring(
  context: EmitContext,
  spec: BulletSpec,
  count: number,
  offsetDeg = 0,
): void {
  const step = 360 / count;
  for (let i = 0; i < count; i++) {
    const bullet = context.bullets.spawn(
      context.x,
      context.y,
      spec,
      context.faction,
      context.rng,
    );
    if (!bullet) return;
    bullet.vector.theta = offsetDeg + i * step;
  }
}

/** Fire `count` bullets in an arc centred on `centreDeg`. */
export function fan(
  context: EmitContext,
  spec: BulletSpec,
  count: number,
  centreDeg: number,
  spreadDeg: number,
): void {
  // A lone bullet has no arc to spread over, so it belongs on the centre line.
  // Starting it at `centreDeg - spreadDeg / 2` would throw every count-1 fan
  // half a spread wide of its target.
  const step = count > 1 ? spreadDeg / (count - 1) : 0;
  const start = count > 1 ? centreDeg - spreadDeg / 2 : centreDeg;
  for (let i = 0; i < count; i++) {
    const bullet = context.bullets.spawn(
      context.x,
      context.y,
      spec,
      context.faction,
      context.rng,
    );
    if (!bullet) return;
    bullet.vector.theta = start + i * step;
  }
}

/** Angle from the emitter to its target, in degrees. */
export function aimAngle(context: EmitContext): number {
  return (
    Math.atan2(context.targetY - context.y, context.targetX - context.x) / DEG
  );
}

/* ------------------------------------------------------------------ */
/* Built-in patterns                                                   */
/* ------------------------------------------------------------------ */

interface RingOptions {
  spec: BulletSpec;
  count?: number;
  period?: number;
  /** Degrees added per volley — the classic rotating flower. */
  rotation?: number;
  duration?: number;
}

definePattern({
  name: 'ring',
  description: 'Evenly spaced full circle, optionally rotating each volley.',
  create(options) {
    const o = options as unknown as RingOptions;
    const count = o.count ?? 16;
    const period = o.period ?? 30;
    const rotation = o.rotation ?? 7;
    const duration = o.duration ?? 0;
    let volley = 0;

    return (context) => {
      if (duration > 0 && context.age >= duration) return false;
      if (context.age % period !== 0) return true;
      ring(context, o.spec, count, volley * rotation);
      volley++;
      return true;
    };
  },
});

interface SpiralOptions {
  spec: BulletSpec;
  /** Simultaneous arms. */
  arms?: number;
  /** Degrees advanced per tick. */
  step?: number;
  period?: number;
  duration?: number;
}

definePattern({
  name: 'spiral',
  description: 'Continuous rotating arms.',
  create(options) {
    const o = options as unknown as SpiralOptions;
    const arms = o.arms ?? 3;
    const step = o.step ?? 11;
    const period = o.period ?? 3;
    const duration = o.duration ?? 0;
    let angle = 0;

    return (context) => {
      if (duration > 0 && context.age >= duration) return false;
      if (context.age % period !== 0) return true;
      for (let i = 0; i < arms; i++) {
        const bullet = context.bullets.spawn(
          context.x,
          context.y,
          o.spec,
          context.faction,
          context.rng,
        );
        if (!bullet) break;
        bullet.vector.theta = angle + (360 / arms) * i;
      }
      angle += step;
      return true;
    };
  },
});

interface AimedOptions {
  spec: BulletSpec;
  count?: number;
  spread?: number;
  period?: number;
  duration?: number;
}

definePattern({
  name: 'aimed-fan',
  description: 'Spread fired at the player. The pressure staple.',
  create(options) {
    const o = options as unknown as AimedOptions;
    const count = o.count ?? 5;
    const spread = o.spread ?? 40;
    const period = o.period ?? 45;
    const duration = o.duration ?? 0;

    return (context) => {
      if (duration > 0 && context.age >= duration) return false;
      if (context.age % period !== 0) return true;
      fan(context, o.spec, count, aimAngle(context), spread);
      return true;
    };
  },
});

interface SprayOptions {
  spec: BulletSpec;
  count?: number;
  period?: number;
  /** Angular window; omit for a full circle. */
  centre?: number;
  spread?: number;
  duration?: number;
}

definePattern({
  name: 'spray',
  description: 'Randomised scatter. Draws from the sim stream.',
  create(options) {
    const o = options as unknown as SprayOptions;
    const count = o.count ?? 3;
    const period = o.period ?? 6;
    const spread = o.spread ?? 360;
    const duration = o.duration ?? 0;

    return (context) => {
      if (duration > 0 && context.age >= duration) return false;
      if (context.age % period !== 0) return true;
      const centre = o.centre ?? aimAngle(context);
      for (let i = 0; i < count; i++) {
        const bullet = context.bullets.spawn(
          context.x,
          context.y,
          o.spec,
          context.faction,
          context.rng,
        );
        if (!bullet) break;
        bullet.vector.theta = centre + context.rng.range(-spread / 2, spread / 2);
      }
      return true;
    };
  },
});

/**
 * A running instance of a pattern, bound to a position.
 * Emitters are what a stage script actually manipulates.
 */
export class Emitter {
  #pattern: Pattern;
  #age = 0;
  alive = true;

  constructor(
    pattern: Pattern | string,
    public x: number,
    public y: number,
    public faction: Faction = 'enemy',
    options?: Readonly<Record<string, unknown>>,
  ) {
    this.#pattern = typeof pattern === 'string' ? createPattern(pattern, options) : pattern;
  }

  step(bullets: BulletSystem, targetX: number, targetY: number, rng: Random): void {
    if (!this.alive) return;
    const result = this.#pattern({
      age: this.#age,
      x: this.x,
      y: this.y,
      targetX,
      targetY,
      bullets,
      rng,
      faction: this.faction,
    });
    if (result === false) this.alive = false;
    this.#age++;
  }

  get age(): number {
    return this.#age;
  }
}
