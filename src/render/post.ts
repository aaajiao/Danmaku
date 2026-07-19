/**
 * Post-processing: bloom over the play field.
 *
 * Bullets are drawn as white shapes tinted per instance (see `procedural.ts`),
 * which is efficient but makes a dense curtain read as flat stickers on black.
 * Bloom is what turns it back into light — the bright core of a bullet bleeds
 * into its neighbours the way an emissive object does, and the field gains the
 * depth that a danmaku screen needs to stay legible when it is full.
 *
 * It is **off by default**. Bloom is five extra full-screen passes at half
 * resolution and up; the game must be playable without it, so enabling it is a
 * decision the caller makes, not something that happens by existing.
 *
 * ## Why the chain ends in our own blit
 *
 * `SpriteBatch` uses a hand-written `ShaderMaterial`. three.js only injects its
 * output colour-space conversion into shaders that `#include
 * <colorspace_fragment>`, so the sprite shader writes its values to the
 * framebuffer untouched. Any three-managed material — `UnrealBloomPass`'s own
 * screen copy, or `OutputPass` — *does* apply linear→sRGB on the way out. Ending
 * the chain with either would brighten the whole image the moment bloom was
 * switched on, and that gamma jump would be read as "bloom looks wrong".
 *
 * So the last pass is a copy shader of our own with no conversion in it. The
 * enabled and disabled paths then differ by bloom and nothing else, which is the
 * only way the toggle is honest.
 *
 * (The uncorrected transfer in `SpriteBatch` is arguably a bug — the field is
 * darker than the source art. Fixing it belongs there, not here; this module's
 * job is to match whatever the stage does.)
 *
 * ## Manual verification
 *
 * There is no test file: every line of this needs a live GL context. Verify by
 * hand, in `src/main.ts`:
 *
 *   1. Construct after the stage, and swap the draw call:
 *
 *        const post = new PostProcessing(stage, { enabled: true });
 *        // main.ts:170 — replace `stage.render()` with:
 *        post.render();
 *
 *   2. `bun run dev`, open the page. **Disabled check:** set `enabled: false`
 *      and confirm the field is pixel-for-pixel what it was before this module
 *      existed — same brightness, same colours. If anything shifts, the branch
 *      is not clean.
 *
 *   3. **Enabled check:** set `enabled: true`. Bullet cores should gain a soft
 *      halo; the black background must stay black. If the whole screen has
 *      lifted off black, the threshold is too low (or a colour-space conversion
 *      has crept back in — see above).
 *
 *   4. **Threshold sweep:** from the console, `post.setBloom(0.85, 0.45, t)` for
 *      t in 0.3 / 0.6 / 0.9. At 0.3 mid-tinted bullets smear and the field goes
 *      milky; at 0.9 almost nothing blooms. 0.6 should catch white cores only.
 *
 *   5. **Toggle under load:** during a dense pattern, flip `post.enabled` back
 *      and forth. Nothing may flicker, resize, or change hue — only the glow.
 *
 *   6. **Cost:** watch `stage.stats.calls` in the debug HUD. Disabled must read
 *      exactly the same count as before; enabled adds the bloom chain.
 *
 *   7. **Resize:** call `post.setSize(w, h)` after resizing the renderer and
 *      confirm the glow stays aligned with the sprites rather than offset or
 *      stretched.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { Stage } from './stage';

export interface BloomSettings {
  strength: number;
  radius: number;
  threshold: number;
}

export interface PostOptions {
  bloom?: BloomSettings;
  /** Off by default: it costs fill rate and the game must run without it. */
  enabled?: boolean;
}

/**
 * Tuned for a near-black field of white-cored, per-instance-tinted sprites.
 *
 * `threshold` is the number that matters. The play field sits at luminance ~0,
 * and a bullet tinted (1, 0.3, 0.3) lands near 0.5 — below the cut, so its body
 * stays crisp. Only the white cores of `orb.*` and `glow.*` clear 0.6 and bloom.
 * Drop it much lower and the tinted bodies join in, the halos merge, and the
 * curtain stops reading as individual bullets — which is a gameplay failure,
 * not just an ugly one.
 */
const DEFAULT_BLOOM: BloomSettings = {
  strength: 0.85,
  radius: 0.45,
  threshold: 0.6,
};

/**
 * A pass-through copy, deliberately free of three.js' colour management.
 *
 * Without `#include <colorspace_fragment>` three injects nothing, so this
 * writes the composed buffer to the screen exactly as the stage would have.
 */
const BLIT_SHADER = {
  name: 'NeutralBlitShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;

    varying vec2 vUv;

    void main() {
      gl_FragColor = texture2D(tDiffuse, vUv);
    }
  `,
};

export class PostProcessing {
  readonly stage: Stage;

  #bloom: BloomSettings;
  #enabled = false;

  /**
   * Built on first enable, not in the constructor. Off by default means the
   * common case must not pay for render targets it never samples.
   */
  #composer: EffectComposer | null = null;
  #renderPass: RenderPass | null = null;
  #bloomPass: UnrealBloomPass | null = null;
  #blitPass: ShaderPass | null = null;

  #width: number;
  #height: number;

  constructor(stage: Stage, options: PostOptions = {}) {
    this.stage = stage;
    this.#bloom = { ...DEFAULT_BLOOM, ...options.bloom };
    this.#width = stage.width;
    this.#height = stage.height;

    if (options.enabled) this.enabled = true;
  }

  #build(): void {
    const { renderer, scene, camera } = this.stage;

    // Passes size themselves in device pixels, so the bloom mips match the
    // drawing buffer rather than the CSS box.
    const ratio = renderer.getPixelRatio();
    const resolution = new THREE.Vector2(this.#width * ratio, this.#height * ratio);

    const composer = new EffectComposer(renderer);
    composer.setSize(this.#width, this.#height);

    const renderPass = new RenderPass(scene, camera);

    const bloomPass = new UnrealBloomPass(
      resolution,
      this.#bloom.strength,
      this.#bloom.radius,
      this.#bloom.threshold,
    );

    const blitPass = new ShaderPass(BLIT_SHADER);
    // The quad covers the screen and is the final word on every pixel; blending
    // it would composite against whatever the previous frame left behind.
    blitPass.material.blending = THREE.NoBlending;
    blitPass.material.depthTest = false;
    blitPass.material.depthWrite = false;

    composer.addPass(renderPass);
    composer.addPass(bloomPass);
    composer.addPass(blitPass);

    this.#composer = composer;
    this.#renderPass = renderPass;
    this.#bloomPass = bloomPass;
    this.#blitPass = blitPass;
  }

  /**
   * Drop-in for `Stage.render()`. Disabled, this is the stage's own call behind
   * one branch.
   */
  render(perspective = false): void {
    if (!this.#enabled || !this.#composer || !this.#renderPass) {
      this.stage.render(perspective);
      return;
    }

    this.#renderPass.camera = perspective ? this.stage.camera3D : this.stage.camera;

    // An explicit zero rather than the composer's wall clock: no pass in this
    // chain is time-driven, and nothing that reads a clock belongs on the path
    // between the sim and the screen (CLAUDE.md, rule 1).
    this.#composer.render(0);
  }

  setSize(width: number, height: number): void {
    this.#width = width;
    this.#height = height;

    if (!this.#composer) return;

    // The renderer is the stage's to resize; picking its ratio back up here
    // keeps the bloom mips honest if the display changed underneath us.
    this.#composer.setPixelRatio(this.stage.renderer.getPixelRatio());
    this.#composer.setSize(width, height);
  }

  set enabled(value: boolean) {
    if (value === this.#enabled) return;
    this.#enabled = value;
    if (value && !this.#composer) this.#build();
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  get bloom(): Readonly<BloomSettings> {
    return this.#bloom;
  }

  setBloom(strength: number, radius: number, threshold: number): void {
    this.#bloom = { strength, radius, threshold };

    if (!this.#bloomPass) return;
    this.#bloomPass.strength = strength;
    this.#bloomPass.radius = radius;
    this.#bloomPass.threshold = threshold;
  }

  dispose(): void {
    this.#bloomPass?.dispose();
    this.#blitPass?.dispose();
    this.#renderPass?.dispose();
    this.#composer?.dispose();

    this.#composer = null;
    this.#renderPass = null;
    this.#bloomPass = null;
    this.#blitPass = null;
    this.#enabled = false;
  }
}
