/**
 * Seeded xorshift128. The only source of randomness in the simulation.
 *
 * `Math.random()` must never appear in sim code — it cannot be seeded, so it
 * would make runs unreproducible and replays worthless. See CLAUDE.md, rule 2.
 *
 * ## Streams
 *
 * Randomness is split into independent named streams. Upstream drew cosmetic
 * effect scatter from the same generator as gameplay, which welds visuals to
 * determinism: adding one particle shifts every subsequent bullet. Keeping
 * `fx` separate means visual work can never desync the simulation.
 *
 * ## Divergence from upstream
 *
 * Upstream's generator returns `(w % 0x7fffffff) / 0x7fffffff` where `w` is a
 * *signed* 32-bit value, so it yields (-1, 1) — negative draws push randomized
 * parameters below their declared minimum. We treat that as the bug it is and
 * return [0, 1). Content ported from upstream may therefore need its random
 * ranges re-tuned; that is intended, not drift.
 *
 * Upstream also mixes with *arithmetic* shifts (`w >> 19`, `t >> 8`), which
 * sign-extend and make it a different generator from canonical xorshift128.
 * We use the unsigned `>>>` form, so our sequence does not match upstream's
 * even before the scaling above. Upstream replay fixtures cannot validate this
 * generator; ours must be recorded fresh.
 */

const DEFAULT_X = 123456789;
const DEFAULT_Y = 362436069;
const DEFAULT_Z = 521288629;
const DEFAULT_W = 88675123;

export class Random {
  #x = DEFAULT_X;
  #y = DEFAULT_Y;
  #z = DEFAULT_Z;
  #w = DEFAULT_W;

  constructor(seed?: number) {
    if (seed !== undefined) this.seed(seed);
  }

  /** Reset to a known state. Same seed ⇒ same sequence, always. */
  seed(seed: number): void {
    this.#x = DEFAULT_X;
    this.#y = DEFAULT_Y;
    this.#z = DEFAULT_Z;
    this.#w = seed | 0;
  }

  /** Raw 32-bit unsigned draw. */
  next(): number {
    const t = this.#x ^ (this.#x << 11);
    this.#x = this.#y;
    this.#y = this.#z;
    this.#z = this.#w;
    this.#w = (this.#w ^ (this.#w >>> 19)) ^ (t ^ (t >>> 8));
    return this.#w >>> 0;
  }

  /** Uniform in [0, 1). */
  random(): number {
    return this.next() / 0x100000000;
  }

  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number {
    if (max <= min) return min;
    return min + Math.floor(this.random() * (max - min + 1));
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.random() * (max - min);
  }

  /** Uniform angle in degrees, matching the motion DSL's units. */
  angle(): number {
    return this.random() * 360;
  }

  pick<T>(items: readonly T[]): T | undefined {
    if (items.length === 0) return undefined;
    return items[Math.floor(this.random() * items.length)];
  }

  /** Snapshot the generator state, for save/replay checkpoints. */
  getState(): readonly [number, number, number, number] {
    return [this.#x, this.#y, this.#z, this.#w];
  }

  setState(state: readonly [number, number, number, number]): void {
    [this.#x, this.#y, this.#z, this.#w] = state;
  }
}

/**
 * Simulation randomness. Every draw here is part of the determinism contract:
 * changing the number or order of calls changes the outcome of a replay.
 */
export const sim = new Random();

/**
 * Cosmetic randomness — particles, screen shake, debris scatter. Deliberately
 * separate so visual changes never move the simulation. Safe to draw from
 * freely, and safe to reseed per frame.
 */
export const fx = new Random(0x9e3779b9);

/** Reseed the simulation stream. Call once when a run starts. */
export function seedRun(seed: number): void {
  sim.seed(seed);
}
