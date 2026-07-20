/**
 * Post-processing: bloom over the play field.
 *
 * Bullets are drawn as white shapes tinted per instance (see `procedural.ts`),
 * which is efficient but makes a dense curtain read as flat stickers on black.
 * Bloom is what turns it back into light — the bright core of a bullet bleeds
 * into its neighbours the way an emissive object does, and the field gains the
 * depth that a danmaku screen needs to stay legible when it is full.
 *
 * The module builds nothing until it is enabled. Bloom is five extra
 * full-screen passes at half resolution and up; the game must be playable
 * without it, so enabling it is a decision the caller makes, not something that
 * happens by existing. `main.ts` makes that decision — it opts in at startup
 * and binds `B` to the toggle.
 *
 * ## Colour space
 *
 * The whole pipeline is display-referred and unmanaged on purpose: atlas
 * textures are tagged `NoColorSpace` and `SpriteBatch` writes a raw
 * `ShaderMaterial`, so the values authored in content tints are the values that
 * reach the framebuffer. See the long note in `atlas.ts` — it is not an
 * oversight to be corrected here.
 *
 * Bloom must therefore not reintroduce a decode. Two places could:
 *
 * - **The composer's render targets.** A target tagged `SRGBColorSpace` gets an
 *   `SRGB8_ALPHA8` internal format, and the GPU then decodes on *every* sample
 *   — invisible to the shader, unfixable from the shader. So the target is
 *   constructed here rather than left to `EffectComposer`, with `colorSpace`
 *   written out explicitly rather than inherited from a default that could
 *   change under us.
 * - **The final pass.** See below.
 *
 * The target is `HalfFloatType`, which is what makes the threshold behave.
 * `playerShots` and `effects` blend additively, so overlapping sprites legally
 * exceed 1.0; an 8-bit target would clamp that away before the high-pass ever
 * saw it, and the densest part of the screen — the part that should glow most —
 * would bloom the least.
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
 * There is no test file, and there cannot be a useful one: every line of this
 * needs a live GL context, and the thing being judged is what the framebuffer
 * looks like. Same reasoning as `test/visual/layer-order.ts`, without even a
 * pixel-readback assertion to fall back on — bloom has no pass/fail pixel, so
 * this check is run by eye and the eye needs to know what it is looking for.
 *
 * Run `bun run dev`, open the page, start a run, and reach the first dense
 * pattern. `main.ts` exposes the instance as `window.__post`.
 *
 *   1. **The A/B.** Press `B` repeatedly. This is the whole point of the key:
 *      off, the curtain is flat tinted stickers on black; on, the cores read as
 *      light. Nothing else may change between the two — no flicker, no resize,
 *      no hue shift, no jump in overall brightness. A brightness jump means a
 *      colour-space conversion has crept into the final pass (see above), not
 *      that bloom is "working".
 *
 *   2. **Black stays black.** The empty field must remain black with bloom on.
 *      If the whole screen has lifted off black, the threshold is too low.
 *
 *   3. **Threshold sweep.** `__post.setBloom(0.65, 0.45, t)` for t in 0.55 /
 *      0.95 / 1.0. Watch a *tinted* bullet, not a white one. At 0.55 the tints
 *      wash out to white and the curtain stops reading as separate coloured
 *      bullets — a gameplay failure, not just an ugly one. At 1.0 nothing
 *      blooms at all. See `DEFAULT_BLOOM` for the measured table; the eye
 *      should be confirming those numbers, not replacing them.
 *
 *   4. **Strength sweep.** `__post.setBloom(s, 0.45, 0.95)` for s in 0.65 /
 *      1.0 / 1.4. Watch the white enemy discs, not the bullets: the halo grows
 *      linearly and by 1.4 they are featureless blobs. Shape retention sets the
 *      ceiling, not brightness.
 *
 *   5. **Cost.** `stage.stats.calls` in the sidebar. With bloom off the count
 *      must be exactly what it was before this module existed; on, it grows by
 *      the bloom chain. If the off count moved, the disabled branch is not
 *      clean.
 *
 *   6. **Degradation.** Force the failure path — in the console, before
 *      enabling, break the build (e.g. stub `stage.renderer.getPixelRatio` to
 *      throw) and press `B`. The field must keep drawing unbloomed, and
 *      `__post.available` must go false. A black screen here is the bug this
 *      path exists to prevent.
 *
 *   7. **Resize.** `__post.setSize(w, h)` after resizing the renderer; the glow
 *      must stay registered with the sprites rather than offset or stretched.
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
 * Measured, not guessed — by rendering known tints through this chain twice in
 * one frame (bloom off, then on) and reading the framebuffer back. The numbers
 * below are pixel values at a sprite's centre, at a pixel ratio of 2.
 *
 * ## `threshold` is set by the palette, and the palette is bright
 *
 * `UnrealBloomPass` cuts on Rec.709 luminance, and **our bullets are white art
 * multiplied by a tint** — there is no separate brighter core for the cut to
 * find. A bullet's core luminance therefore *is* its tint's luminance, and
 * every tint the game currently ships is bright:
 *
 *     LANCE  0.578   COLUMN 0.650   BEAM   0.754   SPARK  0.758
 *     SHELL  0.807   SEEKER 0.821   EMBER  0.857   BOLT   0.900
 *
 * So a threshold chosen to catch "only the white cores" catches everything.
 * Measured at the 0.55 this file used to carry, 8 of 9 bullet tints clipped to
 * pure white — `SPARK` went 255,183,107 -> 255,255,255, losing its hue
 * outright. That is precisely the failure this comment used to claim it had
 * tuned away from: the curtain stops reading as separate coloured bullets.
 *
 * 0.95 sits above the brightest shipped tint (0.909) and below pure white, and
 * the sweep shows the plateau is wide and flat:
 *
 *     threshold   tints clipped to white   halo gain on a white sprite
 *       0.55            8 / 9                    +51
 *       0.85            2 / 9                    +51
 *       0.95            0 / 9                    +51
 *       1.00            0 / 9                      0
 *
 * The halo on white sprites is *identical* at 0.55 and 0.95 — the glow comes
 * from the white art, which clears every one of these cuts. Raising the
 * threshold buys back the tints for free. At 1.00 the cut is above the art and
 * bloom stops doing anything, which is the other cliff.
 *
 * Additive overlap still blooms regardless: `playerShots` and `effects` blend
 * additively into a `HalfFloatType` buffer, so stacked fire legally exceeds 1.0
 * and clears the cut on its own. Dense fire glowing more than sparse fire is
 * the effect worth having, and it survives here.
 *
 * `strength` 0.65 is shape retention: the halo gain scales linearly with it
 * (+51 at 0.65, +79 at 1.0, +111 at 1.4) and by 1.4 the white sprites have lost
 * their edges. `radius` 0.45 keeps the halo tight enough that a bullet's glow
 * still marks where the bullet is.
 */
const DEFAULT_BLOOM: BloomSettings = {
  strength: 0.65,
  radius: 0.45,
  threshold: 0.95,
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
  #available = true;

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

  /**
   * The composer's buffer, built here rather than left to `EffectComposer` so
   * the colour space is stated instead of inherited.
   *
   * `NoColorSpace` is the load-bearing line: it keeps the GPU from picking an
   * sRGB internal format and silently decoding on every sample, which would
   * undo the display-referred pipeline the rest of the renderer is built on.
   */
  #target(type: THREE.TextureDataType): THREE.WebGLRenderTarget {
    const ratio = this.stage.renderer.getPixelRatio();

    const target = new THREE.WebGLRenderTarget(
      this.#width * ratio,
      this.#height * ratio,
      { type, colorSpace: THREE.NoColorSpace },
    );
    target.texture.name = 'PostProcessing.rt';

    return target;
  }

  #build(): void {
    const { renderer, scene, camera } = this.stage;

    // Passes size themselves in device pixels, so the bloom mips match the
    // drawing buffer rather than the CSS box.
    const ratio = renderer.getPixelRatio();
    const resolution = new THREE.Vector2(this.#width * ratio, this.#height * ratio);

    // Half-float is what gives additive overlap somewhere to go above 1.0, but
    // it is an optional format. A context that refuses it gets a byte target
    // and a duller, clamped bloom — which is still a game, unlike a throw.
    let composer: EffectComposer;
    try {
      composer = new EffectComposer(renderer, this.#target(THREE.HalfFloatType));
    } catch {
      composer = new EffectComposer(renderer, this.#target(THREE.UnsignedByteType));
    }

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

    try {
      // An explicit zero rather than the composer's wall clock: no pass in this
      // chain is time-driven, and nothing that reads a clock belongs on the path
      // between the sim and the screen (CLAUDE.md, rule 1).
      this.#composer.render(0);
    } catch (error) {
      // A composer that built but cannot draw — a lost context, a framebuffer
      // the driver declares incomplete — must cost one bad frame, not the game.
      // Retrying every frame would also mean logging every frame, so this
      // stands down for good and leaves a note saying why.
      console.warn('post-processing disabled: composer render failed', error);
      this.#fail();
      this.stage.render(perspective);
    }
  }

  /** Tear the chain down and stay down. `available` reports it. */
  #fail(): void {
    this.dispose();
    this.#available = false;
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

  /**
   * Enabling can fail, so this does not simply store what it was given: read it
   * back to find out whether bloom is actually on. A HUD that shows the request
   * rather than the result would claim bloom while none was drawing.
   */
  set enabled(value: boolean) {
    if (value === this.#enabled) return;
    if (value && !this.#available) return;

    if (value && !this.#composer) {
      try {
        this.#build();
      } catch (error) {
        // Missing addon modules, a refused render target, a shader that will
        // not compile — none of them are worth a black screen. Fall back to the
        // stage's own draw and never try again.
        console.warn('post-processing unavailable, rendering without bloom', error);
        this.#fail();
        return;
      }
    }

    this.#enabled = value;
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  /** False once the chain has failed to build or draw; it will not be retried. */
  get available(): boolean {
    return this.#available;
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
