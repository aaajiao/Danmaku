/**
 * Instanced sprite batch.
 *
 * One draw call per batch, one instance per sprite. Position, rotation, scale,
 * UV rect and tint are per-instance attributes, so the vertex shader does the
 * rotation and only the instance buffers move each frame.
 *
 * ## Why this rather than a faithful port
 *
 * Upstream was already well batched — roughly 17 draw calls a frame regardless
 * of bullet count. Its cost was elsewhere: a full `bufferData` re-upload of
 * four buffers per drawer per frame, and `Math.cos`/`Math.sin` per vertex in
 * JS (upstream source/Element.js:417). Instancing addresses exactly those
 * two, which is the real performance argument for the port.
 *
 * Usage is immediate-mode, once per frame:
 *
 *     batch.begin();
 *     for (const b of bullets) batch.draw(b.x, b.y, b.uv, b.style);
 *     batch.end();
 */

import * as THREE from 'three';
import type { Atlas, Region, UVRect } from './atlas';

export type BlendMode = 'normal' | 'additive' | 'multiply';

export interface SpriteStyle {
  /** Radians. Rotation happens on the GPU. */
  rotation?: number;
  /** Pixel size. Defaults to the region's own size. */
  width?: number;
  height?: number;
  /** Tint, multiplied with the texel. 0..1. */
  r?: number;
  g?: number;
  b?: number;
  a?: number;
}

export interface SpriteBatchOptions {
  /** Instances allocated up front. The batch grows if exceeded. */
  capacity?: number;
  blending?: BlendMode;
  /**
   * Draw order. Depth testing is off — order is explicit and must be, since
   * the whole scene is coplanar. See CLAUDE.md, rule 5.
   */
  renderOrder?: number;
  /** Discard threshold for alpha. Keeps sprite edges crisp. */
  alphaTest?: number;
}

const VERTEX_SHADER = /* glsl */ `
  attribute vec3 iPosition;
  attribute float iRotation;
  attribute vec2 iScale;
  attribute vec4 iUV;
  attribute vec4 iColor;

  varying vec2 vUv;
  varying vec4 vColor;

  void main() {
    float c = cos(iRotation);
    float s = sin(iRotation);

    vec2 scaled = position.xy * iScale;
    vec2 rotated = vec2(
      scaled.x * c - scaled.y * s,
      scaled.x * s + scaled.y * c
    );

    vec4 world = vec4(rotated + iPosition.xy, iPosition.z, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * world;

    vUv = iUV.xy + uv * iUV.zw;
    vColor = iColor;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D map;
  uniform float alphaTest;

  varying vec2 vUv;
  varying vec4 vColor;

  void main() {
    vec4 texel = texture2D(map, vUv);
    vec4 color = texel * vColor;
    if (color.a < alphaTest) discard;
    gl_FragColor = color;
  }
`;

const BLENDING: Record<BlendMode, THREE.Blending> = {
  normal: THREE.NormalBlending,
  additive: THREE.AdditiveBlending,
  multiply: THREE.MultiplyBlending,
};

export class SpriteBatch {
  readonly mesh: THREE.Mesh;
  readonly atlas: Atlas;

  #geometry: THREE.InstancedBufferGeometry;
  #material: THREE.ShaderMaterial;

  #capacity: number;
  #count = 0;

  #position!: Float32Array;
  #rotation!: Float32Array;
  #scale!: Float32Array;
  #uv!: Float32Array;
  #color!: Float32Array;

  /** Instances requested last frame, before any capacity clamp. */
  lastRequested = 0;

  constructor(atlas: Atlas, options: SpriteBatchOptions = {}) {
    this.atlas = atlas;
    this.#capacity = options.capacity ?? 1024;

    // Unit quad centred on the origin; instance scale gives it pixel size.
    const base = new THREE.PlaneGeometry(1, 1);
    this.#geometry = new THREE.InstancedBufferGeometry();
    this.#geometry.index = base.index;
    this.#geometry.attributes['position'] = base.attributes['position']!;
    this.#geometry.attributes['uv'] = base.attributes['uv']!;
    base.dispose();

    this.#allocate(this.#capacity);

    this.#material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        map: { value: atlas.texture },
        alphaTest: { value: options.alphaTest ?? 0.01 },
      },
      transparent: true,
      blending: BLENDING[options.blending ?? 'normal'],
      // The y-down projection reverses winding, so culling must be off.
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(this.#geometry, this.#material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = options.renderOrder ?? 0;
  }

  #allocate(capacity: number): void {
    const previous = {
      position: this.#position,
      rotation: this.#rotation,
      scale: this.#scale,
      uv: this.#uv,
      color: this.#color,
    };

    this.#position = new Float32Array(capacity * 3);
    this.#rotation = new Float32Array(capacity);
    this.#scale = new Float32Array(capacity * 2);
    this.#uv = new Float32Array(capacity * 4);
    this.#color = new Float32Array(capacity * 4);

    if (previous.position) {
      this.#position.set(previous.position);
      this.#rotation.set(previous.rotation);
      this.#scale.set(previous.scale);
      this.#uv.set(previous.uv);
      this.#color.set(previous.color);
    }

    const attr = (data: Float32Array, size: number): THREE.InstancedBufferAttribute => {
      const a = new THREE.InstancedBufferAttribute(data, size);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };

    this.#geometry.setAttribute('iPosition', attr(this.#position, 3));
    this.#geometry.setAttribute('iRotation', attr(this.#rotation, 1));
    this.#geometry.setAttribute('iScale', attr(this.#scale, 2));
    this.#geometry.setAttribute('iUV', attr(this.#uv, 4));
    this.#geometry.setAttribute('iColor', attr(this.#color, 4));

    this.#capacity = capacity;
  }

  /** Start a frame. Everything drawn after this replaces the previous frame. */
  begin(): void {
    this.#count = 0;
    this.lastRequested = 0;
  }

  draw(
    x: number,
    y: number,
    source: Region | UVRect | string,
    style: SpriteStyle = {},
  ): void {
    this.lastRequested++;

    if (this.#count >= this.#capacity) {
      // Grow rather than silently dropping sprites — a dropped bullet is a
      // gameplay bug, not a rendering detail.
      this.#allocate(Math.ceil(this.#capacity * 1.5));
    }

    let uv: UVRect;
    let w: number;
    let h: number;

    if (typeof source === 'string') {
      const region = this.atlas.get(source);
      uv = this.atlas.uv(region);
      w = region.w;
      h = region.h;
    } else if (Array.isArray(source)) {
      uv = source as UVRect;
      w = uv[2] * this.atlas.width;
      h = uv[3] * this.atlas.height;
    } else {
      const region = source as Region;
      uv = this.atlas.uv(region);
      w = region.w;
      h = region.h;
    }

    const i = this.#count++;

    this.#position[i * 3] = x;
    this.#position[i * 3 + 1] = y;
    this.#position[i * 3 + 2] = 0;

    this.#rotation[i] = style.rotation ?? 0;

    this.#scale[i * 2] = style.width ?? w;
    this.#scale[i * 2 + 1] = style.height ?? h;

    this.#uv[i * 4] = uv[0];
    this.#uv[i * 4 + 1] = uv[1];
    this.#uv[i * 4 + 2] = uv[2];
    this.#uv[i * 4 + 3] = uv[3];

    this.#color[i * 4] = style.r ?? 1;
    this.#color[i * 4 + 1] = style.g ?? 1;
    this.#color[i * 4 + 2] = style.b ?? 1;
    this.#color[i * 4 + 3] = style.a ?? 1;
  }

  /** Upload this frame's instances. */
  end(): void {
    this.#geometry.instanceCount = this.#count;

    if (this.#count === 0) return;

    // Only the range actually written is dirty.
    for (const [name, size] of [
      ['iPosition', 3],
      ['iRotation', 1],
      ['iScale', 2],
      ['iUV', 4],
      ['iColor', 4],
    ] as const) {
      const attribute = this.#geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
      attribute.addUpdateRange(0, this.#count * size);
      attribute.needsUpdate = true;
    }
  }

  get count(): number {
    return this.#count;
  }

  get capacity(): number {
    return this.#capacity;
  }

  setBlending(mode: BlendMode): void {
    this.#material.blending = BLENDING[mode];
  }

  dispose(): void {
    this.#geometry.dispose();
    this.#material.dispose();
  }
}
