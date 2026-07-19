/**
 * Sprite sheet addressing.
 *
 * Upstream addressed sheets as a uniform grid: UVs were computed from a cell
 * index and the entity's own width/height (`ElementView._initCoordinates`,
 * toho-like-js/source/Element.js:307). That is simple and it works, but it
 * forces every cell on a sheet to be the same size and gives an artist no way
 * to pack tightly.
 *
 * We keep the grid as the common case and allow named regions on top, so a
 * hand-packed or generated atlas can be described without changing callers.
 */

import * as THREE from 'three';

export interface Region {
  /** Pixel rect within the source image. */
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Pivot in cell-relative units, 0..1. Defaults to centre. Bullets pivot
   * centrally; a character sprite may want its feet.
   */
  pivotX?: number;
  pivotY?: number;
}

/** UV rect, ready for an instance attribute: (offsetU, offsetV, scaleU, scaleV). */
export type UVRect = readonly [number, number, number, number];

export interface GridSpec {
  /** Cell size in pixels. */
  cellW: number;
  cellH: number;
  /** Optional gap between cells. */
  gapX?: number;
  gapY?: number;
  /** Optional offset of the first cell. */
  originX?: number;
  originY?: number;
}

export class Atlas {
  readonly texture: THREE.Texture;
  readonly width: number;
  readonly height: number;

  readonly #regions = new Map<string, Region>();
  readonly #grid: GridSpec | undefined;
  readonly #cols: number;

  constructor(texture: THREE.Texture, width: number, height: number, grid?: GridSpec) {
    this.texture = texture;
    this.width = width;
    this.height = height;
    this.#grid = grid;
    this.#cols = grid
      ? Math.max(1, Math.floor((width - (grid.originX ?? 0) + (grid.gapX ?? 0)) / (grid.cellW + (grid.gapX ?? 0))))
      : 1;
  }

  /** Name a region so content can reference art without knowing coordinates. */
  define(name: string, region: Region): this {
    this.#regions.set(name, region);
    return this;
  }

  /** Name every cell of the grid in row-major order. */
  defineGrid(names: readonly string[]): this {
    names.forEach((name, index) => {
      if (name) this.define(name, this.cell(index));
    });
    return this;
  }

  /** Region for a grid cell, by linear index or explicit column/row. */
  cell(index: number): Region;
  cell(col: number, row: number): Region;
  cell(a: number, b?: number): Region {
    const grid = this.#grid;
    if (!grid) throw new Error('atlas has no grid; use named regions');

    const col = b === undefined ? a % this.#cols : a;
    const row = b === undefined ? Math.floor(a / this.#cols) : b;

    return {
      x: (grid.originX ?? 0) + col * (grid.cellW + (grid.gapX ?? 0)),
      y: (grid.originY ?? 0) + row * (grid.cellH + (grid.gapY ?? 0)),
      w: grid.cellW,
      h: grid.cellH,
    };
  }

  get(name: string): Region {
    const region = this.#regions.get(name);
    if (!region) throw new Error(`atlas region "${name}" is not defined`);
    return region;
  }

  has(name: string): boolean {
    return this.#regions.has(name);
  }

  get names(): readonly string[] {
    return [...this.#regions.keys()];
  }

  /** Convert a region to normalized UVs. */
  uv(region: Region): UVRect {
    return [
      region.x / this.width,
      region.y / this.height,
      region.w / this.width,
      region.h / this.height,
    ];
  }

  uvOf(name: string): UVRect {
    return this.uv(this.get(name));
  }
}

/**
 * Load an image as a pixel-art texture.
 *
 * NearestFilter throughout: danmaku sprites are small and crisp, and linear
 * filtering on a grid sheet bleeds neighbouring cells into each other at the
 * edges. Upstream also rounded textures up to a power of two — a WebGL1
 * constraint we do not inherit.
 */
export async function loadTexture(url: string): Promise<THREE.Texture> {
  const texture = await new THREE.TextureLoader().loadAsync(url);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  return texture;
}

export async function loadAtlas(url: string, grid?: GridSpec): Promise<Atlas> {
  const texture = await loadTexture(url);
  const { width, height } = texture.image as { width: number; height: number };
  return new Atlas(texture, width, height, grid);
}
