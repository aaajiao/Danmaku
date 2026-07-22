/**
 * Danmaku pattern registry and engine primitives.
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
import { atan2Deg } from '../core/trig';
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

/** Non-throwing existence check, for a validator resolving a name before use. */
export function hasPattern(name: string): boolean {
  return registry.has(name);
}

export function patternDefinitions(): readonly PatternDefinition[] {
  return [...registry.values()];
}

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

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

/**
 * Angle from the emitter to its target, in degrees.
 *
 * `atan2Deg`, never `Math.atan2`: aimed fire writes this straight into a
 * bullet's heading, so a 1-ULP disagreement between engines is a bullet on a
 * different trajectory, and eventually a hit test that falls the other way.
 * See `core/trig`.
 */
export function aimAngle(context: EmitContext): number {
  return atan2Deg(context.targetY - context.y, context.targetX - context.x);
}

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
