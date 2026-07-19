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

export class Pool<T> {
  readonly #create: () => T;
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

    this.#reset?.(item);
    return item;
  }

  release(item: T): void {
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
