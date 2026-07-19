/**
 * Object pool.
 *
 * Bullet-hell simulation allocates and discards thousands of entities per
 * second; pooling keeps the GC out of the frame budget.
 *
 * ## Divergence from upstream
 *
 * Upstream's `FreeList` is fixed-size and, on exhaustion, calls `window.alert`
 * and throws — a modal dialog mid-game. Its global MoveVector pool (2000) sat
 * below the enemy-bullet cap (1000 bullets, each owning vectors), so an
 * ambitious pattern could take the game down.
 *
 * This pool grows instead, in blocks, and reports growth so limits surface as
 * telemetry rather than as a crash. Growth is bounded by `maxSize` to keep a
 * runaway spawn loop from exhausting memory silently.
 */

export interface PoolOptions<T> {
  /** Objects allocated up front. */
  initial: number;
  /** Hard ceiling. Beyond this, `acquire` returns undefined. */
  max?: number;
  /** How many to add when empty. Defaults to half the current size. */
  growBy?: number;
  /** Called when an object is handed out, to reset it. */
  reset?: (item: T) => void;
}

/**
 * Whether to pay for double-release detection.
 *
 * Releasing an object twice puts it on the free list twice, and the pool then
 * hands the same object to two live owners — which presents as two bullets
 * moving in lockstep, or one vanishing when the other dies. It is a genuinely
 * horrible bug to diagnose from the symptom.
 *
 * Guarding costs a set lookup on every release, in the hottest loop in the
 * game, so it is not something to pay for permanently. But the bug can only be
 * *introduced* while developing, and that is exactly when the check is cheap:
 * on in development, compiled out in production.
 */
const POOL_CHECKS =
  typeof process !== 'undefined' && process.env['NODE_ENV'] !== 'production';

/**
 * `T extends object` because the release guard tracks identity in a WeakSet.
 * Everything pooled here is a class instance, so this costs nothing in practice
 * and is more honest than casting a primitive-capable `T` at the call site.
 */
export class Pool<T extends object> {
  readonly #create: () => T;
  /** Only populated when POOL_CHECKS is on. Weak, so it never retains objects. */
  readonly #released = new WeakSet<T>();
  readonly #reset: ((item: T) => void) | undefined;
  readonly #max: number;
  readonly #growBy: number | undefined;

  #free: T[] = [];
  #size = 0;

  /** Times the pool has had to grow. Nonzero means `initial` was too small. */
  growthCount = 0;
  /** High-water mark of simultaneously live objects. */
  peakLive = 0;

  constructor(create: () => T, options: PoolOptions<T>) {
    this.#create = create;
    this.#reset = options.reset;
    this.#max = options.max ?? Number.MAX_SAFE_INTEGER;
    this.#growBy = options.growBy;
    this.#grow(options.initial);
  }

  #grow(count: number): number {
    const room = this.#max - this.#size;
    // Floor at zero: a negative `initial`, `growBy` or `max` would otherwise
    // drive `#size` negative and make `growthCount` report growth that never
    // allocated. These arrive from caller tuning options and are unvalidated.
    const n = Math.max(0, Math.min(count, room));
    for (let i = 0; i < n; i++) this.#free.push(this.#create());
    this.#size += n;
    return n;
  }

  /**
   * Take an object from the pool. Returns undefined only when the pool is at
   * `max` and everything is live — callers must decide whether to drop the
   * spawn or evict something, rather than being crashed.
   */
  acquire(): T | undefined {
    let item = this.#free.pop();

    if (item === undefined) {
      const added = this.#grow(this.#growBy ?? Math.max(8, this.#size >> 1));
      if (added === 0) return undefined;
      this.growthCount++;
      item = this.#free.pop();
      if (item === undefined) return undefined;
    }

    const live = this.#size - this.#free.length;
    if (live > this.peakLive) this.peakLive = live;

    // Handing it back out clears its released mark, so the next legitimate
    // release is not mistaken for a double one.
    if (POOL_CHECKS) this.#released.delete(item);

    this.#reset?.(item);
    return item;
  }

  release(item: T): void {
    if (POOL_CHECKS) {
      if (this.#released.has(item)) {
        throw new Error(
          'Pool.release called twice on the same object: it would enter the free ' +
            'list twice and later be handed to two live owners at once.',
        );
      }
      this.#released.add(item);
    }
    this.#free.push(item);
  }

  /** Total objects allocated, live or free. */
  get size(): number {
    return this.#size;
  }

  get available(): number {
    return this.#free.length;
  }

  get live(): number {
    return this.#size - this.#free.length;
  }
}
