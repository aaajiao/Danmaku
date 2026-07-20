/**
 * Collision.
 *
 * ## Divergence from upstream
 *
 * Upstream's `Element.checkCollision` tested five points of box B (its four
 * corners plus centre) for containment in box A. That misses the case where B
 * fully encloses A — a large laser passing over a small hitbox registers no
 * hit. It is also asymmetric: `a.check(b)` and `b.check(a)` can disagree.
 *
 * A proper AABB overlap is both cheaper and correct.
 */

export interface Box {
  /** Centre, screen space. */
  x: number;
  y: number;
  /** Half-extents. Danmaku hitboxes are much smaller than sprites. */
  halfW: number;
  halfH: number;
}

export function overlaps(a: Box, b: Box): boolean {
  return (
    Math.abs(a.x - b.x) <= a.halfW + b.halfW &&
    Math.abs(a.y - b.y) <= a.halfH + b.halfH
  );
}

/** Circle test — the honest shape for a bullet, and cheaper than a box. */
export function circlesOverlap(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  const r = ar + br;
  return dx * dx + dy * dy <= r * r;
}

/**
 * Closest-point test between a segment and a circle.
 *
 * Built only from `+ - * /` and comparisons, all IEEE-exact, so it is
 * bit-reproducible on any engine (CLAUDE.md, rule 3). Squared distances
 * throughout — `Math.sqrt` would be exact too, but there is nothing to spend it
 * on when both sides can be compared squared.
 *
 * This is the shape half of the genre. A danmaku hitbox is almost never a
 * circle: a beam is a segment anchored at its muzzle, and a needle or a kunai
 * is a segment centred on itself. Standing a circle in for either is wrong in
 * *both* directions at once — it overhangs the thin axis, killing players the
 * blade visibly missed, and undercovers the long one, so most of the sweep the
 * player dodged was never lethal to begin with.
 */
export function segmentHitsCircle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  radius: number,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;

  // A zero-length segment is its own endpoint — the degenerate case a bare
  // projection would divide by zero on.
  let t = 0;
  if (lengthSq > 0) {
    t = ((cx - ax) * dx + (cy - ay) * dy) / lengthSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }

  const nearX = ax + t * dx - cx;
  const nearY = ay + t * dy - cy;
  return nearX * nearX + nearY * nearY <= radius * radius;
}

/**
 * Cell coordinates pack into a single integer key, and that packing must be
 * injective over every cell an item can reach — negative cells above and left
 * of the field, and cells past the right edge, both of which are routine while
 * bullets stream in and out.
 *
 * A row-stride key (`cy * cols + cx`) is not injective once `cx` leaves
 * `[0, cols)`: it wraps onto a neighbouring row. That aliased two unrelated
 * regions onto one bucket, so a query both saw items from somewhere else
 * entirely and revisited the same bucket several times in one sweep — a caller
 * that accumulates rather than short-circuits would apply a hit twice.
 *
 * Clamping is safe where wrapping was not: coordinates beyond the window merge
 * into the edge bucket, which can only ever add extra candidates for the
 * caller's exact test, never hide one.
 */
const CELL_MIN = -0x8000;
const CELL_MAX = 0x7fff;
const CELL_SPAN = 0x10000;

function packCell(cx: number, cy: number): number {
  const px = Math.min(Math.max(cx, CELL_MIN), CELL_MAX) - CELL_MIN;
  const py = Math.min(Math.max(cy, CELL_MIN), CELL_MAX) - CELL_MIN;
  return px * CELL_SPAN + py;
}

/**
 * Hard ceiling on distinct buckets retained at once.
 *
 * Live density in real play — the union of cells actually touched in a
 * single tick — stays in the low hundreds even for a generously oversized
 * field (a few hundred px per side at a 32px cell). This is an order of
 * magnitude above that: enough headroom that it never binds under honest
 * play, so eviction (below) is what actually reclaims space from bullets
 * that streamed off into cells nothing will ever revisit.
 */
const MAX_BUCKETS = 4096;

/**
 * Clears a bucket must sit empty before it is eligible for eviction.
 *
 * At one clear per tick and 60 ticks/sec this is ~5 seconds — long enough
 * that no bucket still in rotation (a bullet lane, a boss's cell) is ever
 * mistaken for abandoned, short enough that cells left behind by bullets that
 * have moved on are reclaimed well within a session.
 */
const IDLE_LIMIT = 300;

/**
 * Buckets `#evictStale` may examine per new-key insert.
 *
 * Only a bound on worst-case work, not a tuning knob: one reclaim per creation
 * is all that is needed to hold the cap, and the extra budget just lets a run
 * of live buckets at the front be stepped over in the same call.
 */
const EVICT_SCAN = 8;

interface Bucket<T> {
  readonly items: T[];
  /** Generation (see `#generation`) at which this bucket last held an item. */
  touchedAt: number;
}

/**
 * Uniform spatial hash for broad-phase culling.
 *
 * Upstream tested every pair: player bullets against enemies is 500 x 200 =
 * 100k tests per tick, with no partitioning at all (`TODO.txt` lists "divide
 * area" as never done). A grid keeps that proportional to actual density,
 * which is what makes room for the much denser patterns we want to author.
 *
 * Unbounded in every direction: the field's width is not a parameter, because
 * bullets legitimately live outside it.
 *
 * ## Bucket retention
 *
 * `clear()` keeps each bucket's array and only empties it, so a tick that
 * reuses the same cells never reallocates. Left unchecked that means the key
 * set grows with the *union of every cell ever touched*, not with live
 * density — bullets stream far outside the field over a long session, so it
 * grows without bound.
 *
 * `clear()` therefore walks only the keys this tick populated, and reclamation
 * is driven from `insert()` — a scan of the whole map every tick would be a
 * worse bug than the leak it replaces:
 *
 *  - Every bucket stamps `touchedAt` with the generation it last held an item.
 *    That stamp, not the bucket's position in the map, is what decides whether
 *    it is idle. Writing an integer is all the hot path pays.
 *  - Creating a genuinely new key, and only then, checks whether the map has
 *    reached `MAX_BUCKETS`, and if so evicts buckets that have sat empty for at
 *    least `IDLE_LIMIT` clears — never one touched more recently, no matter how
 *    full the map is.
 *
 * ### Why the LRU ordering is maintained from the eviction path, not `insert()`
 *
 * `#evictStale` scans from the front of the map, so it wants iteration order to
 * approximate least-recently-used. Maintaining that by re-linking (`delete`
 * then `set`) each bucket as it wakes up puts a `Map` delete and insert in the
 * per-bullet path of every tick — and the cap is deliberately set high enough
 * that honest play never evicts at all, so that would be pure cost. Measured on
 * the workload `BulletSystem.hitTest` actually produces (a few hundred cells,
 * ~1500 bullets), re-linking from `insert()` ran 2.9x slower per tick than not.
 *
 * Instead `#evictStale` re-links the buckets it *skips*: a live bucket at the
 * front is moved to the back so the scan makes progress rather than re-reading
 * it on every creation. All of that cost lands under cap pressure, which is
 * where it belongs, and the hot path keeps the plain `Map.get` it had before.
 *
 * Eviction is bounded per creation (`EVICT_SCAN`), so `insert()` stays O(1)
 * even when most of the front is still live.
 */
export class SpatialGrid<T> {
  readonly #cellSize: number;
  readonly #cells = new Map<number, Bucket<T>>();
  /** Keys touched this tick — exactly what `clear()` needs to revisit. */
  readonly #touched: number[] = [];
  /** Incremented once per `clear()`; the clock `touchedAt` is measured against. */
  #generation = 0;

  constructor(cellSize: number) {
    this.#cellSize = cellSize;
  }

  #key(x: number, y: number): number {
    return packCell(Math.floor(x / this.#cellSize), Math.floor(y / this.#cellSize));
  }

  /**
   * Reclaim idle buckets from the front, or move live ones out of the way.
   *
   * Bounded rather than looping to exhaustion: eviction only has to keep pace
   * with bucket *creation*, and it gets a fresh budget on every creation, so a
   * front full of live buckets costs a constant per insert instead of a walk
   * proportional to how many are live.
   */
  #evictStale(): void {
    for (let examined = 0; examined < EVICT_SCAN; examined++) {
      if (this.#cells.size < MAX_BUCKETS) return;
      const front = this.#cells.entries().next();
      if (front.done) return;
      const [key, bucket] = front.value;
      this.#cells.delete(key);
      // Still live — put it back at the most-recently-used end rather than
      // dropping it. Re-linking here, in the cold path, is what keeps the
      // scan moving without charging every insert for the ordering.
      if (this.#generation - bucket.touchedAt < IDLE_LIMIT) this.#cells.set(key, bucket);
    }
  }

  clear(): void {
    this.#generation++;
    // Only ever the buckets this tick populated — never the full map.
    for (const key of this.#touched) {
      const bucket = this.#cells.get(key);
      if (bucket !== undefined) bucket.items.length = 0;
    }
    this.#touched.length = 0;
  }

  insert(x: number, y: number, item: T): void {
    const key = this.#key(x, y);
    let bucket = this.#cells.get(key);

    if (bucket === undefined) {
      this.#evictStale();
      bucket = { items: [], touchedAt: this.#generation };
      this.#cells.set(key, bucket);
      this.#touched.push(key);
    } else if (bucket.items.length === 0) {
      // First item this tick for a bucket that was idle. Stamping the
      // generation is the whole of what eviction reads; the map ordering is
      // fixed up in `#evictStale`, which is the only place it matters.
      bucket.touchedAt = this.#generation;
      this.#touched.push(key);
    }

    bucket.items.push(item);
  }

  /**
   * Visit every item in the cells overlapping the given circle.
   * May yield items outside the radius — this is broad phase; the caller
   * still runs an exact test.
   */
  query(x: number, y: number, radius: number, visit: (item: T) => void): void {
    const minCx = Math.floor((x - radius) / this.#cellSize);
    const maxCx = Math.floor((x + radius) / this.#cellSize);
    const minCy = Math.floor((y - radius) / this.#cellSize);
    const maxCy = Math.floor((y + radius) / this.#cellSize);

    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = this.#cells.get(packCell(cx, cy));
        if (bucket === undefined) continue;
        for (const item of bucket.items) visit(item);
      }
    }
  }

  /** Distinct buckets currently retained. Diagnostic — exercised by tests, not the sim. */
  get bucketCount(): number {
    return this.#cells.size;
  }
}
