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
 * Uniform spatial hash for broad-phase culling.
 *
 * Upstream tested every pair: player bullets against enemies is 500 x 200 =
 * 100k tests per tick, with no partitioning at all (`TODO.txt` lists "divide
 * area" as never done). A grid keeps that proportional to actual density,
 * which is what makes room for the much denser patterns we want to author.
 *
 * Unbounded in every direction: the field's width is not a parameter, because
 * bullets legitimately live outside it.
 */
export class SpatialGrid<T> {
  readonly #cellSize: number;
  readonly #cells = new Map<number, T[]>();

  constructor(cellSize: number) {
    this.#cellSize = cellSize;
  }

  #key(x: number, y: number): number {
    return packCell(Math.floor(x / this.#cellSize), Math.floor(y / this.#cellSize));
  }

  clear(): void {
    // Keep the arrays, drop their contents — this runs every tick.
    for (const bucket of this.#cells.values()) bucket.length = 0;
  }

  insert(x: number, y: number, item: T): void {
    const key = this.#key(x, y);
    let bucket = this.#cells.get(key);
    if (bucket === undefined) {
      bucket = [];
      this.#cells.set(key, bucket);
    }
    bucket.push(item);
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
        for (const item of bucket) visit(item);
      }
    }
  }
}
