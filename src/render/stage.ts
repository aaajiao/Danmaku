/**
 * The render stage: a three.js scene organised into explicit, ordered layers.
 *
 * ## Why layers are a first-class concept
 *
 * Depth testing is off, because the play field is coplanar and sprites must
 * composite in a defined order (CLAUDE.md, rule 4). Upstream got that ordering
 * implicitly, from the sequence of calls in `StageState._displayElements`. That
 * works right up until you want to insert something — a new effect, a 3D prop,
 * a post-processed pass — and then the ordering lives in the middle of a method
 * nobody wants to touch.
 *
 * Naming the layers makes insertion a data change. It also gives the 3D content
 * we intend to add somewhere to live that is unambiguously in front of the
 * background and behind the HUD.
 */

import * as THREE from 'three';

/**
 * Draw order, back to front. Values are spaced so new layers can be slotted
 * between existing ones without renumbering.
 */
export const Layer = {
  Background: 0,
  BackgroundProps: 100,
  Enemies: 200,
  Items: 300,
  Player: 400,
  PlayerShots: 500,
  EnemyShots: 600,
  Effects: 700,
  Foreground: 800,
  Overlay: 900,
} as const;

export type LayerName = keyof typeof Layer;

export interface StageOptions {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** Device pixel ratio cap. Retina at 2x doubles fill cost for little gain. */
  maxPixelRatio?: number;
}

export class Stage {
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  readonly width: number;
  readonly height: number;

  /**
   * Screen-space camera: (0,0) top-left, y down, one unit per pixel — the space
   * all content data is authored in.
   *
   * The y-flip gives the projection a negative Y scale, which reverses triangle
   * winding. Materials must not cull; SpriteBatch already sets DoubleSide.
   */
  readonly camera: THREE.OrthographicCamera;

  /**
   * A perspective camera over the same field, for 3D content. Upstream had a
   * hint of this — pressing Y switched to a 60-degree view following the
   * fighter — and it is the direction three.js actually buys us.
   */
  readonly camera3D: THREE.PerspectiveCamera;

  #useDepth = false;

  constructor(options: StageOptions) {
    this.width = options.width;
    this.height = options.height;

    this.renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      antialias: false,
      alpha: false,
    });
    this.renderer.setPixelRatio(
      Math.min(devicePixelRatio, options.maxPixelRatio ?? 2),
    );
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.setClearColor(0x000000, 1);

    // Order is explicit via renderOrder; three.js must not reorder for us.
    this.renderer.sortObjects = false;

    this.camera = new THREE.OrthographicCamera(
      0,
      this.width,
      0,
      this.height,
      -1000,
      1000,
    );

    this.camera3D = new THREE.PerspectiveCamera(
      60,
      this.width / this.height,
      1,
      2000,
    );
    this.camera3D.position.set(this.width / 2, this.height / 2, -600);
    this.camera3D.up.set(0, -1, 0); // y-down, to match the sprite space
    this.camera3D.lookAt(this.width / 2, this.height / 2, 0);
  }

  /** Add an object at a named layer. */
  add(object: THREE.Object3D, layer: LayerName | number, offset = 0): void {
    object.renderOrder = (typeof layer === 'number' ? layer : Layer[layer]) + offset;
    this.scene.add(object);
  }

  remove(object: THREE.Object3D): void {
    this.scene.remove(object);
  }

  /**
   * Enable depth testing for 3D content.
   *
   * Sprites keep `depthTest: false` regardless, so they always composite by
   * renderOrder. This only lets meshes that opt in occlude each other.
   */
  set depthEnabled(enabled: boolean) {
    this.#useDepth = enabled;
    this.renderer.state.buffers.depth.setTest(enabled);
  }

  get depthEnabled(): boolean {
    return this.#useDepth;
  }

  render(perspective = false): void {
    this.renderer.render(this.scene, perspective ? this.camera3D : this.camera);
  }

  /** Frame timing and draw-call counters, for the debug HUD. */
  get stats(): { calls: number; triangles: number; programs: number } {
    const info = this.renderer.info;
    return {
      calls: info.render.calls,
      triangles: info.render.triangles,
      programs: info.programs?.length ?? 0,
    };
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
