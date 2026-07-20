/**
 * Sprite sheet addressing.
 *
 * Upstream addressed sheets as a uniform grid: UVs were computed from a cell
 * index and the entity's own width/height (`ElementView._initCoordinates`,
 * upstream source/Element.js:307). That is simple and it works, but it
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
}

// A pivot field lived here and was never read — SpriteBatch always centres the
// quad, and rotation happens about that centre in the vertex shader. Adding one
// means widening an instance attribute to carry the offset and applying it
// before rotation, which is worth doing when a sprite actually needs an
// off-centre origin, and not before.

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
 *
 * ## Colour is display-referred, and that is deliberate
 *
 * `colorSpace` is `NoColorSpace`, so texels reach the shader unchanged.
 *
 * Tagging textures `SRGBColorSpace` makes the GPU decode sRGB to linear on
 * sample. That is correct in a linear pipeline — but `SpriteBatch` writes a raw
 * `ShaderMaterial`, and three.js only applies output encoding to materials that
 * include its own colorspace fragment chunk. Ours does not, so linear values
 * landed straight in an sRGB framebuffer and everything drew dark. Measured
 * before the fix: 128 in the source became 55 on screen, 96 became 30.
 *
 * There are two ways out, and the choice is not obvious:
 *
 * - Encode back to sRGB in the fragment shader, keeping a linear pipeline.
 *   Physically correct, and the right answer if lighting were being computed.
 * - Skip colour management entirely, which is what this does.
 *
 * The second wins here because the art is generated white and every colour in
 * the game is a hand-authored tint like `{ r: 0.45, g: 0.75, b: 1 }`. Those
 * numbers mean "the colour I want to see". A linear pipeline would require the
 * person writing them to mentally convert, forever, in exchange for physical
 * correctness that a 2D game with no lighting model never collects on.
 *
 * If real lighting or HDR bloom arrives, revisit this — but change both ends
 * together, and re-tune the content tints, rather than restoring the sRGB tag
 * on its own and reintroducing the dark render.
 */
export async function loadTexture(url: string): Promise<THREE.Texture> {
  const texture = await new THREE.TextureLoader().loadAsync(url);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.colorSpace = THREE.NoColorSpace;

  return texture;
}

export async function loadAtlas(url: string, grid?: GridSpec): Promise<Atlas> {
  const texture = await loadTexture(url);
  const { width, height } = texture.image as { width: number; height: number };
  return new Atlas(texture, width, height, grid);
}
