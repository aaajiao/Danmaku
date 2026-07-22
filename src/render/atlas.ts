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

/**
 * How a strip's frames advance. Declared by the ART, never by content: a
 * one-shot plays once and holds its last frame (an explosion), a loop wraps
 * forever (a breathing pickup glow). Ignored when `frames === 1`.
 */
export type StripMode = 'once' | 'loop';

/**
 * Where a strip's colour lives.
 *
 * - `'tinted'` — the pixels are white and colour is the per-instance tint,
 *   the bullet law. The saturation gate applies (a coloured tinted sheet is a
 *   mistake the tint would double). Bullet cells, the procedural fx floor, the
 *   ship and every shared floor cell are tinted.
 * - `'baked'` — colour lives in the pixels (a coloured explosion, a shaded
 *   ship). The saturation gate is SKIPPED; the tint becomes a modulation
 *   (`texel * tint`), identity-white by default. This is the loss-free import
 *   path for coloured native art, and it is only ever a NAMED variant, never a
 *   floor-cell reskin (a floor cell is shared and tint-coded — see docs/packs.md).
 */
export type StripColor = 'tinted' | 'baked';

/**
 * A strip is what a cell always was, generalized on one axis: a named atlas
 * entry that resolves to *frame 0's rect plus how to walk right for the rest*.
 * A static cell is the degenerate `frames: 1`. There is one vocabulary — the
 * `Atlas` stores every entry as a `Strip` — and a plain region is a 1-frame
 * strip, so every existing draw site is byte-identical (`get`/`uvOf` return
 * frame 0). Frame selection is a pure, integer, tick-clocked function that
 * lives in `render/strip.ts`; nothing in the engine fixes a global frame count
 * or size, so each strip carries its own geometry (self-describing).
 */
export interface Strip {
  /** Frame 0's top-left on the sheet, px. */
  x: number;
  y: number;
  /** One frame's size, px — free of the 32px bullet grid. */
  frameW: number;
  frameH: number;
  /** Frame count; `>= 1`, and `1` is a static cell. */
  frames: number;
  /** Px between successive frame origins; `>= frameW`, default `frameW`. */
  stride: number;
  /** Ticks each frame is held; ignored when `frames === 1`. */
  ticksPerFrame: number;
  /** Playback; ignored when `frames === 1`. Declared by the art. */
  mode: StripMode;
  /** Colour mode; default `'tinted'`. */
  color: StripColor;
  /**
   * Engine DISPLAY size, px — the Law of Geometry field (docs/packs.md, the
   * asset-fidelity round). This is the QUAD size the entity draws at; `frameW`/
   * `frameH` stay the UV/texel size, so a pack's extra detail is supersampled and
   * shown small rather than resampled away, and a reskin never changes on-screen
   * geometry. It is filled ONLY at a pack seam (`displayW = engineContent(N) ×
   * frameW / contentW`, `render/procedural.ts`); every procedural floor strip and
   * every legacy-grid cell leaves it ABSENT, and a consumer reads
   * `displayW ?? frameW`, so the default is byte-identical to before this field
   * existed. Not read by `frameOf`/`uv`: texel sampling must not change.
   */
  displayW?: number;
  displayH?: number;
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

  readonly #strips = new Map<string, Strip>();
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

  /**
   * Name a region so content can reference art without knowing coordinates.
   * Stored as a 1-frame tinted strip — the degenerate case of the one
   * vocabulary, so `get`/`uvOf` on it are byte-identical to a plain region.
   */
  define(name: string, region: Region): this {
    this.#strips.set(name, {
      x: region.x,
      y: region.y,
      frameW: region.w,
      frameH: region.h,
      frames: 1,
      stride: region.w,
      ticksPerFrame: 1,
      mode: 'once',
      color: 'tinted',
    });
    return this;
  }

  /**
   * Name a multi-frame strip. The superset surface `define`/`defineGrid` sit
   * under: an animated or native-sized entry the atlas that owns the pixels
   * describes for itself. `stride` defaults to `frameW`, `color` to `'tinted'`.
   * Content references a strip by name exactly as it does a static cell; frames
   * exist only in the view layer (`render/strip.ts`), never in the sim.
   *
   * `displayW`/`displayH` (the Law of Geometry field) ride through the `...s`
   * spread when a pack seam supplies them and stay ABSENT otherwise, so a caller
   * that omits them (every procedural floor, the legacy grid) is byte-identical.
   */
  defineStrip(
    name: string,
    s: Omit<Strip, 'stride' | 'color'> & { stride?: number; color?: StripColor },
  ): this {
    this.#strips.set(name, {
      ...s,
      stride: s.stride ?? s.frameW,
      color: s.color ?? 'tinted',
    });
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

  /** Back-compat: a region is frame 0 of the strip the name resolves to. */
  get(name: string): Region {
    const s = this.#strips.get(name);
    if (!s) throw new Error(`atlas region "${name}" is not defined`);
    return this.frameOf(s, 0);
  }

  /** The full strip an entity clocks its frames off. */
  strip(name: string): Strip {
    const s = this.#strips.get(name);
    if (!s) throw new Error(`atlas strip "${name}" is not defined`);
    return s;
  }

  /** The rect of one frame. `frames <= 1` always yields frame 0; the clamp is a net. */
  frameOf(s: Strip, frame: number): Region {
    const f = s.frames <= 1 ? 0 : Math.max(0, Math.min(s.frames - 1, frame | 0));
    return { x: s.x + f * s.stride, y: s.y, w: s.frameW, h: s.frameH };
  }

  has(name: string): boolean {
    return this.#strips.has(name);
  }

  get names(): readonly string[] {
    return [...this.#strips.keys()];
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
