/**
 * The background field: a registry of full-screen fragment shaders.
 *
 * ## Why this is a registry and not a scrolling ground plane
 *
 * Upstream drew its background as a textured plane scrolled by a counter. That
 * is one background, and the only way to get a second is to edit the drawer.
 * The backgrounds this project wants — noise fields, particle flow, raymarched
 * tunnels, none of them decided yet — have nothing in common with each other
 * except that they fill the screen and advance with the clock.
 *
 * So the shared part is all this module owns: a full-screen quad at
 * `Layer.Background`, a fixed set of uniforms, and a cross-fade. Everything that
 * makes a background *look* like anything lives in a registered `BackgroundSpec`,
 * which is a file you write and import — the same shape as every other extension
 * point (see AGENTS/CLAUDE.md, "How this is extended").
 *
 * ## The clock is ticks, and only ticks
 *
 * `uTick` advances in `step()` and nowhere else. There is no `performance.now`
 * in this file and there must never be one. A background driven by wall-clock
 * drifts with frame rate, which means a replay played back on a 144Hz display
 * does not look like the recording — and "a replay looks the same twice" is the
 * whole product (CLAUDE.md, rule 1). The interpolated view layer may smooth
 * sprite positions; the background does not get that licence, because it has no
 * previous state to interpolate from.
 *
 * GLSL `sin`/`cos` are used freely in the shaders below. Rule 3 bans the
 * approximated `Math` functions from `sim`, `content` and `core` because their
 * results integrate into positions and eventually flip a hit test. Nothing here
 * feeds back into the simulation: these values reach the framebuffer and stop.
 *
 * ## Standard uniforms
 *
 * Every registered background is compiled against these, whether it reads them
 * or not:
 *
 *   uTick       float  whole ticks elapsed since this Background was constructed
 *   uScroll     float  accumulated scroll distance, `scrollSpeed` px per tick
 *   uRes        vec2   field size in pixels, for aspect correction
 *   uIntensity  float  0..1 master dim, for backing off under a spell card
 *
 * A spec may add its own; they are merged over the standard set, per instance,
 * so two `Background` objects never share a uniform object.
 *
 * ## Writing a background
 *
 * `spec.fragment` is fragment-shader source appended after the standard uniform
 * declarations. It may declare extra uniforms and helper functions, and it must
 * define the entry point:
 *
 *     vec3 background(vec2 uv)
 *
 * `uv` is 0..1 across the field with **y increasing downward**, matching the
 * space content is authored in. Return linear colour; the wrapper applies
 * `uIntensity` and the cross-fade alpha. Prepend `BACKGROUND_NOISE_GLSL` if you
 * want the value-noise helpers the shipped backgrounds use.
 *
 * Bright enough to see, dark enough to play — 亮到能看,暗到能玩. The fixed
 * "peak near 0.1" ceiling is RETIRED (see the shader-ports round): the diversity
 * rounds proved the structure was present all along and only the ceiling made it
 * invisible, so scenes now ship at their ported reference's native visual richness
 * with a per-scene EXPOSURE constant tuned for playability. Structured peaks land
 * in roughly the 0.25-0.35 raw band (the user-confirmed anchor, ~×3 the old
 * ceiling), graded by role: the menu (`drift`) brightest, the stages a touch below
 * to leave a bullet curtain its headroom, the seals a calmer boss station. What
 * still binds every scene is not a number but four properties: per-tick luminance
 * steps stay bounded (coherent motion, no strobing), no structure at a bullet's
 * spatial frequency in the play band (a bright scene must not counterfeit
 * bullets), and bullets/UI win the contrast fight (bullets are 1.0-white + bloom;
 * the scene never approaches that). The exposure that ships is MEASURED in the
 * acceptance pass — the density page and `bun run dev` under real curtains are the
 * arbiter — and the numbers describe what shipped, they do not prescribe it. A
 * scene that runs its projection to infinity (a spiral or perspective one) still
 * decays its structured terms faster than its brightness, because a projection
 * samples noise faster than the pixel grid can carry and what that aliases into
 * looks exactly like sparse bullets.
 *
 * Written scenes live in `src/v4/backgrounds/`, one per file, imported by that
 * directory's index. Nothing in *this* file names a scene.
 *
 * ## Cross-fading without coupling
 *
 * `transitionTo` never mixes two shaders in one program — a background that had
 * to know about its successor would not be a drop-in. The incoming background
 * takes over the base mesh opaquely, the outgoing one is re-parented to a second
 * quad one renderOrder above it, and its alpha is driven to zero over N ticks.
 * The blend happens in the framebuffer, where it costs nothing conceptually and
 * neither shader learns the other exists.
 *
 * ## Manual verification
 *
 * There is no test file for the rendering half: every line of it needs a live GL
 * context. `background.test.ts` covers the registry and shader assembly, which
 * do not. Verify the rest by hand, in `src/main.ts`:
 *
 *   1. Construct after the stage, before the sprite batches:
 *
 *        const background = new Background(stage, 'drift');
 *
 *      and call `background.step()` inside the fixed-tick callback, next to the
 *      simulation step — **not** in the render callback.
 *
 *   2. `bun run dev`, open the page. The menu field (`drift`) must be a lit,
 *      rippling moonlit water — the brightest scene in the game — with the moon low
 *      in the frame and the water filling the bottom. Whatever scene is up, bullets
 *      and the player must read cleanly against it; if you find yourself losing a
 *      bullet, the shader is too bright or too detailed in the play band, not the
 *      sprite — lower that scene's EXPOSURE constant, or coarsen its structure.
 *
 *   3. **Draw order:** the background must be behind everything, including the
 *      HUD. If a sprite disappears behind it, it was added at a layer below
 *      `Layer.Background` — nothing legitimately is.
 *
 *   4. **Frame-rate independence — the one that matters.** Throttle the tab to
 *      30fps (DevTools → Rendering → "Frame Rendering Stats" is not enough; use
 *      CPU throttling, or cap the display to 30Hz). The scroll must slow down by
 *      exactly half in wall-clock terms and stay identical per tick. If it keeps
 *      the same apparent speed, something is reading a wall clock and this module
 *      has failed its only hard requirement.
 *
 *   5. **Determinism by eye:** from the console, build two and step them the same
 *      number of times —
 *
 *        const a = new Background(stage, 'drift');
 *        for (let i = 0; i < 600; i++) a.step();
 *
 *      — and confirm the result is pixel-identical to a run that reached tick 600
 *      through gameplay. Uniform state is the whole state; there is nowhere else
 *      for a difference to hide.
 *
 *   6. **Cross-fade:** `background.transitionTo('surge', 120)`. Over two seconds
 *      the field should bloom into the red radial pattern with no flash, no gap
 *      to black, and no seam where the two overlap. Call it again mid-fade with
 *      `transitionTo('drift', 120)`: the in-flight fade is dropped and a new one
 *      starts from what is currently on the base mesh. It should be abrupt but
 *      never black.
 *
 *   7. **Intensity:** `background.setIntensity(0.3)` during a dense pattern. The
 *      field dims; the bullets do not. At `0` the screen must be pure black —
 *      any residual glow means something is added rather than multiplied.
 *
 *   8. **Leaks:** `background.dispose()`, then `stage.stats.programs` in the
 *      debug HUD. Constructing and disposing ten backgrounds in a loop must not
 *      grow that count without bound.
 */

import * as THREE from 'three';
import { Layer } from './stage';
import type { Stage } from './stage';

export interface BackgroundSpec {
  /** Fragment shader body. Receives the uniforms below. */
  fragment: string;
  /** Extra uniforms, merged with the standard set. */
  uniforms?: Record<string, { value: unknown }>;
  /** Scroll rate in "world units per tick" — frame-locked like everything. */
  scrollSpeed?: number;
}

const registry = new Map<string, BackgroundSpec>();

export function defineBackground(name: string, spec: BackgroundSpec): void {
  if (registry.has(name)) {
    throw new Error(`background "${name}" is already defined`);
  }
  registry.set(name, spec);
}

export function getBackgroundSpec(name: string): BackgroundSpec {
  const spec = registry.get(name);
  if (!spec) throw new Error(`unknown background "${name}"`);
  return spec;
}

export function backgroundNames(): readonly string[] {
  return [...registry.keys()];
}

/**
 * `vUv` is derived from the quad's own vertices rather than its UV attribute so
 * that its orientation is a property of this file rather than of whatever
 * `PlaneGeometry` happens to emit. The mesh sits in the y-down world the ortho
 * camera projects, so local +y is screen-down and `vUv.y` grows downward.
 */
const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = position.xy + 0.5;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Reusable value noise, exported so a background defined in another file gets
 * the same smooth low-frequency character without copying it.
 *
 * Three octaves, not four: the fourth lands at a spatial frequency close to a
 * bullet's, and a background that looks like sparse bullets is a gameplay bug.
 */
export const BACKGROUND_NOISE_GLSL = /* glsl */ `
  float bgHash(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }

  float bgNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 w = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(bgHash(i), bgHash(i + vec2(1.0, 0.0)), w.x),
      mix(bgHash(i + vec2(0.0, 1.0)), bgHash(i + vec2(1.0, 1.0)), w.x),
      w.y
    );
  }

  float bgFbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 3; i++) {
      sum += amp * bgNoise(p);
      p *= 2.03;
      amp *= 0.5;
    }
    return sum;
  }
`;

/**
 * The boss scenes no longer share an engine-drawn cell.
 *
 * There used to be a `SEAL_GLSL` export here — one engraved compass-and-rule ring
 * that every boss and 出神 scene stamped through a thin per-scene filter (arc,
 * invert, fill, ratchet, dither, vortex pull). It is RETIRED. The seal family is
 * now per-scene NEAR-IDENTICAL ports of the pbakaus/radiant references (MIT),
 * because identity comes from porting the reference, not from our grammar wearing
 * a palette: an engine cell with a reference's colour grafted on read as our
 * shader, not as the original, and only the direct ports passed acceptance.
 *
 * The later no-repeat ruling is stricter: one reference, one scene. The former
 * `GOLD_GLSL` sharing across signet/cordon/regnum and `VEIL_GLSL` sharing across
 * umbra/decree were dissolved; each authored scene is now a standalone port in
 * its own file and the v4 background index test forbids sibling-scene imports.
 * Generic mathematical helpers may remain engine-owned, but a picture never is.
 * Exposure is PER SCENE: each file ships an
 * `EXPOSURE` constant graded by role — stages a step below the menu, the seals a
 * calmer boss station, the 出神 pair the dimmest of all — MEASURED in the
 * acceptance pass, never chosen in advance (the luminance law in this file's
 * header governs them all; each scene's own header records what shipped).
 *
 * What this module still owns is below: the standard uniform set and the
 * torn-paper cross-fade (`composeFragmentShader`), and the ticks-only clock law
 * (this file's header). None of that moved with the retired cell.
 */

/**
 * Assemble a full fragment shader from a spec's body.
 *
 * Exported for `background.test.ts`: the standard uniform block is a contract
 * with every background ever written, and a silent change to it would only show
 * up as a shader that fails to compile in a browser nobody has opened yet.
 *
 * ## The torn-paper tear on the outgoing alpha
 *
 * The final alpha is `uAlpha · tearMask(vUv, 1 - uAlpha)`, a per-pixel tear —
 * NOT a flat `uAlpha`. During a cross-fade the outgoing (stage) quad sits one
 * `renderOrder` above the incoming (seal) quad with NormalBlending and its
 * `uAlpha` ramps 1->0, so parting its alpha along a coarse (~183px) vertical seam
 * reveals the seal beneath — the stage tears open onto it. **Reuses `uAlpha`, no
 * new uniform.**
 *
 * The load-bearing guarantee is `p=0 ⇒ mask≡1`: with `p = 1 - uAlpha`, at
 * `uAlpha=1` (every non-fading quad, including the incoming seal) the threshold
 * `gap = -0.05 < dist` so `tearMask` returns 1.0 everywhere and the alpha is
 * exactly `uAlpha` — byte-identical to before this edit. Nothing tears outside a
 * cross-fade. Instant cuts (`ticks<=0`) never fade, so never tear. The helpers
 * are LOCAL and distinctly named (`tearHash`/`tearNoise`/`tearMask`) so they
 * cannot collide with the `bgFbm` (and each scene's own ported helpers — `lg*`,
 * `veil*`, and the like) already in each fragment; they are appended AFTER the
 * fragment so `background()` is defined before `main` calls it.
 * uScroll/uTick only — no wall clock. Torn-paper technique studied from
 * pbakaus/radiant (MIT); our GLSL.
 */
export function composeFragmentShader(fragment: string): string {
  return /* glsl */ `
    uniform float uTick;
    uniform float uScroll;
    uniform vec2 uRes;
    uniform float uIntensity;
    uniform float uAlpha;

    varying vec2 vUv;

${fragment}

    /* Local, distinctly-named helpers so nothing collides with the bgFbm or a
       scene's own ported helpers (lg*, veil*, …) already in each fragment. */
    float tearHash(float y) { return fract(sin(y * 91.17) * 43758.5453); }
    float tearNoise(float y) {
      float i = floor(y), f = fract(y); f = f * f * (3.0 - 2.0 * f);
      return mix(tearHash(i), tearHash(i + 1.0), f);
    }
    /* The torn-paper stamp. p = 1 - uAlpha (fade progress): p=0 -> mask==1
       EVERYWHERE (steady state untouched — every non-fading quad, including the
       incoming seal at uAlpha=1, is byte-identical to before this edit); p->1 ->
       torn away everywhere. Only the OUTGOING crossfade quad (uAlpha 1->0, one
       renderOrder above the incoming seal, NormalBlending) fades, so its stage
       parts along a coarse ~183px vertical seam to reveal the seal beneath.
       Reuses uAlpha — no new uniform. */
    float tearMask(vec2 uv, float p) {
      float seam = 0.5 + 0.16 * (tearNoise(uv.y * 3.5) - 0.5);
      float dist = abs(uv.x - seam);
      const float SOFT = 0.02, OFF = 0.05, MAXGAP = 1.2;
      float gap = p * (MAXGAP + OFF) - OFF;
      return smoothstep(gap - SOFT, gap + SOFT, dist);
    }

    void main() {
      float p = 1.0 - uAlpha;
      gl_FragColor = vec4(background(vUv) * uIntensity, uAlpha * tearMask(vUv, p));
    }
  `;
}

/** One compiled background. A `Background` holds one, or two while fading. */
interface Compiled {
  readonly name: string;
  readonly material: THREE.ShaderMaterial;
  readonly scrollSpeed: number;
  readonly uTick: THREE.IUniform<number>;
  readonly uScroll: THREE.IUniform<number>;
  readonly uIntensity: THREE.IUniform<number>;
  readonly uAlpha: THREE.IUniform<number>;
  /** Accumulated in ticks here rather than read back off the uniform. */
  scroll: number;
}

export class Background {
  readonly mesh: THREE.Mesh;

  readonly #stage: Stage;
  readonly #geometry: THREE.PlaneGeometry;

  #current: Compiled;

  /** The background being faded out. Non-null only mid-transition. */
  #outgoing: Compiled | null = null;
  #fadeMesh: THREE.Mesh | null = null;
  #fadeElapsed = 0;
  #fadeTicks = 0;

  #tick = 0;
  #intensity = 1;

  constructor(stage: Stage, name: string) {
    this.#stage = stage;

    // A unit quad scaled to the field, so `vUv` is 0..1 regardless of size and
    // the shaders never have to know the play field's dimensions to sample it.
    this.#geometry = new THREE.PlaneGeometry(1, 1);

    this.#current = this.#compile(name);

    this.mesh = new THREE.Mesh(this.#geometry, this.#current.material);
    this.mesh.scale.set(stage.width, stage.height, 1);
    this.mesh.position.set(stage.width / 2, stage.height / 2, 0);
    this.mesh.frustumCulled = false;
    stage.add(this.mesh, 'Background');
  }

  #compile(name: string): Compiled {
    const spec = getBackgroundSpec(name);

    const uTick: THREE.IUniform<number> = { value: this.#tick };
    const uScroll: THREE.IUniform<number> = { value: 0 };
    const uIntensity: THREE.IUniform<number> = { value: this.#intensity };
    const uAlpha: THREE.IUniform<number> = { value: 1 };

    const uniforms: Record<string, THREE.IUniform> = {};
    // Cloned one level deep: sharing the spec's uniform objects would make two
    // Backgrounds — or a background and its own fading predecessor — write over
    // each other's values through the registry.
    for (const [key, uniform] of Object.entries(spec.uniforms ?? {})) {
      uniforms[key] = { value: uniform.value };
    }
    uniforms['uTick'] = uTick;
    uniforms['uScroll'] = uScroll;
    uniforms['uRes'] = { value: new THREE.Vector2(this.#stage.width, this.#stage.height) };
    uniforms['uIntensity'] = uIntensity;
    uniforms['uAlpha'] = uAlpha;

    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: composeFragmentShader(spec.fragment),
      uniforms,
      transparent: true,
      // The y-down projection reverses winding, so culling must be off
      // (CLAUDE.md, rule 6). This is exactly the "anything that builds its own
      // material" the rule warns about.
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });

    return {
      name,
      material,
      scrollSpeed: spec.scrollSpeed ?? 0,
      uTick,
      uScroll,
      uIntensity,
      uAlpha,
      scroll: 0,
    };
  }

  /** Advance by one whole tick. The only thing that moves a background. */
  step(): void {
    this.#tick += 1;

    this.#advance(this.#current);

    const outgoing = this.#outgoing;
    if (!outgoing) return;

    this.#advance(outgoing);
    this.#fadeElapsed += 1;

    if (this.#fadeElapsed >= this.#fadeTicks) {
      this.#endFade();
      return;
    }

    outgoing.uAlpha.value = 1 - this.#fadeElapsed / this.#fadeTicks;
  }

  #advance(compiled: Compiled): void {
    compiled.scroll += compiled.scrollSpeed;
    compiled.uScroll.value = compiled.scroll;
    compiled.uTick.value = this.#tick;
  }

  /**
   * Cross-fade to another registered background over N ticks.
   *
   * A transition requested while one is in flight drops the in-flight outgoing
   * immediately and fades from whatever is on the base mesh. The alternative —
   * a queue of overlapping fades — would need N quads and N draws of full-screen
   * fill for a case the game does not have.
   */
  transitionTo(name: string, ticks: number): void {
    if (name === this.#current.name && !this.#outgoing) return;

    if (this.#outgoing) this.#endFade();

    const incoming = this.#compile(name);

    if (ticks <= 0) {
      this.#current.material.dispose();
      this.#current = incoming;
      this.mesh.material = incoming.material;
      return;
    }

    this.#outgoing = this.#current;
    this.#current = incoming;
    this.mesh.material = incoming.material;

    this.#fadeElapsed = 0;
    this.#fadeTicks = ticks;

    // One renderOrder above the base quad, so the outgoing background composites
    // over the incoming one. Both materials are transparent, which is what makes
    // renderOrder the deciding key rather than three's opaque/transparent split.
    const fadeMesh = this.#fadeMesh ?? this.#createFadeMesh();
    fadeMesh.material = this.#outgoing.material;
    this.#stage.add(fadeMesh, Layer.Background + 1);
  }

  #createFadeMesh(): THREE.Mesh {
    const mesh = new THREE.Mesh(this.#geometry, this.#current.material);
    mesh.scale.copy(this.mesh.scale);
    mesh.position.copy(this.mesh.position);
    mesh.frustumCulled = false;
    this.#fadeMesh = mesh;
    return mesh;
  }

  #endFade(): void {
    const outgoing = this.#outgoing;
    if (!outgoing) return;

    if (this.#fadeMesh) {
      this.#stage.remove(this.#fadeMesh);
      // Point it somewhere live before the material goes: a Mesh holding a
      // disposed material is a crash waiting for the next time it is added.
      this.#fadeMesh.material = this.#current.material;
    }

    outgoing.material.dispose();
    this.#outgoing = null;
    this.#fadeElapsed = 0;
    this.#fadeTicks = 0;
  }

  /** 0..1 master dim, applied multiplicatively to whatever is on screen. */
  setIntensity(value: number): void {
    const clamped = value < 0 ? 0 : value > 1 ? 1 : value;
    this.#intensity = clamped;
    this.#current.uIntensity.value = clamped;
    if (this.#outgoing) this.#outgoing.uIntensity.value = clamped;
  }

  get intensity(): number {
    return this.#intensity;
  }

  /** Whole ticks elapsed — the value the shaders see as `uTick`. */
  get tick(): number {
    return this.#tick;
  }

  /** The background currently on the base quad. Changes at the *start* of a fade. */
  get name(): string {
    return this.#current.name;
  }

  dispose(): void {
    this.#endFade();

    this.#stage.remove(this.mesh);
    if (this.#fadeMesh) this.#stage.remove(this.#fadeMesh);

    this.#current.material.dispose();
    this.#geometry.dispose();
    this.#fadeMesh = null;
  }
}

// The backgrounds themselves live in `./backgrounds/`, one scene per file, and
// reach the game through that directory's index. This file is the engine and
// deliberately knows the name of no scene at all — see `backgrounds/index.ts`.
