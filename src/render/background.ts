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
 * Written scenes live in `./backgrounds/`, one per file, imported by that
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
 * THE SEAL — one shared cell the boss scenes stamp through five filters and two
 * unmoorings, exported here for the same reason `BACKGROUND_NOISE_GLSL` is: a
 * shape shared by many scenes lives once, and copying it would let the copies
 * drift. It is a **string constant only** — no new uniform, no cross-fade change.
 *
 * The cell is a **compass-and-rule engraving** — a bounding pressed-metal ring
 * with a **hexagram** (a radiant-geometry SDF) and **six radial rays** unioned
 * into it at the same stroke weight, over a subordinate train of concentric
 * device rings. It reads as an ornamental OBJECT, not a bare ring with a faint
 * decoration. The N-fold rosette is kept only as the grain carrier. This is the
 * class marker no stage scene contains: where the
 * stages are a luminous, evenly-textured haze (unimodal histogram, high mean, low
 * local contrast, translational drift), a seal is a **near-black frame with a
 * bright engraved device closing on itself** (bimodal histogram — a tall spike at
 * black, a thin tail reaching the peak), a mark *pressed into* a surface. A
 * squinted single frame classifies stage-vs-boss before any colour is named.
 *
 * The union is the safety spine: every stroke (ring, hexagram, ray) uses the
 * ring's OWN K=16 Gaussian cross-section (`strokeGlow`), so the engraving carries
 * exactly the frequency the accepted ring carries and no other; and union
 * composition (`max` of unit-peak strokes) makes the brightest union pixel the
 * brightest single stroke, so ornament is added without a new spatial frequency
 * and (analytically) without raising the ceiling.
 *
 * It is **flat**: there is no perspective divide, so the run-to-infinity aliasing
 * the two perspective scenes have to decay their structure to fight never arises —
 * and it arises least where it would hurt most, the crowded centre of a boss fight
 * (the `vault` argument, made once more). Disciplines that carry across:
 *
 *   - **Integer spokes.** The rosette count is an integer, so the angle only ever
 *     enters `sin`, and the `atan` wrap from +pi to -pi closes seamlessly — the
 *     `undertow`/`vault` flute lesson. The broken-arc gate reads a *wrapped*
 *     angle for the same reason, so even a rotating picket cannot crack. This is
 *     also why the only HARD edge is the *radial* bounding ring: at the seal
 *     radius an inked angular petal-outline would need a >=60px transition to stay
 *     bullet-coarse, at which point the threshold IS the sinusoid — so angular
 *     structure stays soft, and only `r` (no wrap) may be crisped.
 *   - **Grain confined to strokes.** It rides the rosette *value* (never the raw
 *     angle, so it cannot shear across the wrap ray) and multiplies `structure`,
 *     which -> 0 in the black field, so the grain dies there — an engraved edge,
 *     not a noisy smear. Trimmed to 0.18 amplitude.
 *   - **Detail decays toward the two crowded zones** — the centre (the boss
 *     station, the void the bright sprite reads against) and the top entry lane —
 *     and the field fades to nothing **outside the ring**: a seal is a STATE, not
 *     a place, and it is empty where it is not the seal (the rest around the
 *     device).
 *
 * ## Value structure — the inversion, and the engraved union
 *
 * The field between strokes falls to a hair of wax floor (0.03·body, deep black);
 * the engraved linework reads bright by local contrast AND by spending the
 * exposure the shader-ports law now allows. Structure is `arc·(0.82·primary +
 * 0.18·device)`, where `primary` is the engraved union (`max(ring, linework)`, or
 * the inverted/filled variants) at unit peak and `device` is the subordinate
 * `0.60·inner` ring train. The single shared exposure knob is **SEAL_GAIN** (in
 * the return, not this comment): raised from the retired peak~0.1 era's 1.35 to
 * **3.6**, so the engraving crests VIVID rather than invisible.
 *
 * **The luminance law that governs this cell (shader-ports round).** The fixed
 * "peak near 0.1" ceiling is RETIRED — the diversity rounds proved the structure
 * was present all along and only the ceiling made it invisible (the same pixels at
 * ×3 exposure are plainly distinct pictures). The seals now ship at the ported
 * liquid-gold material's native richness: structured engraving peaks land near
 * **~0.22-0.24 raw** (roughly ×3 the old ceiling, the user-confirmed anchor —
 * 亮到能看,暗到能玩), graded a step below the stages so a boss station stays a
 * calmer field than an open stage. What SURVIVES of the old law and still binds
 * every seal: per-tick luminance steps stay bounded (the ratchet EASES over >=10
 * ticks, the 出神 dither-wave steps stay small — no strobing); no structure at
 * bullet spatial frequency in the play band (every stroke rides the ring's K=16
 * cross-section, sigma_f 0.00563 < 0.00625 cyc/px); the boss-station centre stays
 * relatively calmer than its surround (`body`'s nearC falloff); and bullets/UI win
 * the contrast fight (bullets are 1.0-white + bloom; the engraving never
 * approaches that). Every number here is **[MEASURED-IN-ACCEPTANCE]** — the
 * arbiter is bullet readability over the live scene on the density page and in
 * `bun run dev` under real curtains, recorded from whatever ships, never a target
 * chosen in advance. If a seal reads too hot under a curtain, drop SEAL_GAIN;
 * cordon (chartreuse, luminance-expensive) is the seal most likely to want it, and
 * desaturating its G is the next rung.
 *
 * **The peak-neutral coverage axes still hold.** Each seal keeps its own
 * ringRadius (spread 0.20-0.38, a size cue), a distinct bevelDir (the directional
 * rake), a distinct hue (GLOW), and one <=1 secondary-material ornament in its own
 * body (cordon banded field, intaglio wet-ink ground, regnum cellular seams, sable
 * wax ramp) — every ornament max 1.0, so it only ever LOWERS the local value,
 * never raises the crest. All four ornaments are value-ramp / threshold / cellular
 * fields in the liquid-gold and ink-dissolve families (the user-given refs); none
 * scripts a rule. Seal hues: signet gold, cordon olive-chartreuse, intaglio
 * cool-ivory, sable oxblood, regnum orange-crimson; umbra cold blue-violet, decree
 * bleached rose.
 *
 * ## The engraved ring, and why it stays bullet-coarse
 *
 * The bounding ring is crisped from K=7 to K=16 (Gaussian `exp(-dr*dr)`,
 * `dr = (r-ringRadius)*16`), FWHM ~215px -> ~94px, still COARSE: `exp(-dr*dr)` is
 * `exp(-x^2/(2*sigma^2))` with sigma_x = 640/(16*sqrt2) = 28.3px (the Gaussian std
 * dev — NOT the e^-1 half-width 40px, which is sqrt(2)*sigma), so spatial frequency
 * sigma_f = 1/(2*pi*28.3) = 0.00563 cyc/px, under the 0.00625 bullet-band bound
 * (~90% of budget). The true K-ceiling where sigma_f reaches 0.00625 is K ~= 17.8,
 * so K=16 has only ~10% headroom — do NOT raise K past ~17 (an earlier note here
 * miscited sigma_f as 0.00398 with a K<=25 ceiling; that used sqrt(2)*sigma for
 * sigma and is wrong by a factor of sqrt(2)). A pressed-metal **bevel** carries the
 * material; there is deliberately NO glint/specular (a tight bright pinpoint is a
 * fake bullet). The bevel has TWO terms: a low-frequency radial ramp (inner rim
 * lit, outer rim shadowed) AND a **directional rake** keyed to the per-seal
 * `bevelDir` parameter — a raking light held FIXED in the frame while the engraving
 * ratchets under it (real metal catching a fixed light), which adds motion life to
 * the ratchet for free and is a peak-neutral thumbnail cue (each seal lit from a
 * different quarter). It is peak-neutral by construction: the 0.5/0.5 blend still
 * tops out at 1.0, so bright coverage only drops and the per-pixel ceiling is
 * unchanged; the rake is a smooth angular cosine (angular freq 1), no bullet-band
 * risk. The 出神 pair DRIFTS its `bevelDir` (`uScroll*0.003`) — the light itself
 * comes unmoored.
 *
 * The **engraved device** (`sdHexagram` + `spokeGlow`) is unioned into the ring
 * with `strokeGlow`, the ring's OWN K=16 cross-section — so no stroke introduces a
 * new spatial frequency, and `max`-union keeps the ceiling at the single brightest
 * stroke. The hexagram's strap vertices near the centre are the one genuine
 * bullet-band risk (local curvature narrows the effective feature): mitigated by
 * the spoke `rIn = 0.28·ringRadius` window and `body`'s `nearC` falloff keeping the
 * centre a dark well. The rays are **integer-folded** (`mod(a+pi/6, pi/3)`) so the
 * angle enters only via a closed 6-fold offset — no `atan` wrap crack, the same
 * discipline as the flutes. Verify the vertices in `test:density`; fallback raises
 * `rIn` or the centre falloff. Hexagram SDF (IQ regular-star construction) and the
 * value-ramp stroke studied from pbakaus/radiant liquid-gold & radiant-geometry
 * (MIT); our GLSL, noise and clocks.
 *
 * ## The inner concentric train stays UNSQUARED
 *
 * The device rings (`inner`, freq ~36 -> ~112px period) are the subordinate
 * `0.60·inner` device term now, coarse and floor-dropped to bright rings on black.
 * They are left UNSQUARED on purpose: squaring a sinusoid injects an exact 2nd
 * harmonic at ~56px, halving the bullet-band margin for a reveal the floor drop
 * already delivers. No thresholded petals, no thresholded rings — outlawed by the
 * angular bound above.
 *
 * ## Motion — three classes (stages drift, stated seals ease a RATCHET, 出神 drifts)
 *
 * The stated seals RATCHET their rotation with a **stepped-ease**: the whole
 * engraving HOLDS for the first 82% of each `SEAL_DETENT` period (`SEAL_STEP_HOLD`)
 * then EASES the detent over the last 18% — a mechanism, not a drift (the
 * 入神/Absorption reading, a seal press IS a ratchet). The engraving is now
 * angularly rich (hexagram + rays), and that is exactly what makes the tick
 * VISIBLE — which is also why it must ease rather than step: an instantaneous
 * `floor()` on a weighted moving term would be a temporal bullet, so easing over
 * 12-23 ticks (per-seal `rot`, retimed into a 70-130-tick detent band) is
 * mandatory and legal (each advance spans >=10 ticks). The whole engraving rotates
 * together (`cr = sealRot(rotAmount)·c`), and a continuous travelling light
 * (`sweep`, angular-freq 1) orbits the strokes during the hold as the second
 * motion. **The pre-rebuild rotation-invariance caveat is retired:** the engraving
 * now rotates visibly BY DESIGN, so there is no "the marker doesn't change under
 * rotation" claim to protect. cordon's broken-arc endpoint no longer jumps — the
 * stepped-ease sweeps its endpoint ~28px over ~13 ticks (~2.2px/tick), so the
 * pre-rebuild endpoint-jump pending note is retired for free. The 出神 pair
 * (`moireFreq > 0`) opts OUT automatically and keeps continuous drift — a ticking
 * mechanism that is simultaneously unmooring would be self-contradictory.
 *
 * ## The stamp draw-in (couples with the compose-wrapper tear)
 *
 * Keyed to the incoming seal's own `scroll` (`#compile` mints `uScroll=0` on every
 * `transitionTo`, so it re-stamps at any crossfade length): the seal inks in over
 * the first `STAMP_SCROLL` (40) units, frame -> centre. The ring frame lands first,
 * then the hexagram, rays and device; a coarse light-front (K=16, full-width,
 * transient, capped 0.85 of the sustained ring) rides the front and is gone by
 * `stampT=1`, where `mix(reveal,1.0,stampT)` forces the mask to exactly 1.0 (zero
 * residual). Only stage->seal arrivals stamp (stages never call `sealField`). It
 * couples with `composeFragmentShader`'s tear: the stage tears away (macro) while
 * the seal inscribes itself beneath (micro). Fallback: drop `frontEdge`, keep the
 * plain inward wipe.
 *
 * Each boss is a **thin call**: one filter geometry (`arcHalf`, `fill`, `invert`,
 * ring radius/frequency, rotation) plus one hue (the scene's `BASE`/`GLOW`).
 * Identity is in the cell; individuality is in filter + hue — the visual
 * counterpart of each `defineMusic` setting one `CELL_*` and one root.
 *
 * `sealField` returns a modulation in ~0..1 the scene lifts its `GLOW` by; **0 is
 * the dark void**. It reads `bgFbm`, so a scene must prepend `BACKGROUND_NOISE_GLSL`
 * before this. It reads no uniform — `aspect` and `scroll` are passed in — so it
 * stays a pure function of its arguments, and the ticks-only clock (rule 1) is the
 * caller's `uScroll`, never a wall clock. GLSL `sin`/`cos` are used freely here;
 * rule 3 binds `sim`/`content`/`core`/`game`, not values that reach the
 * framebuffer and stop.
 *
 * `sealBayer4`/`sealDither` (the 出神 quantization) are defined alongside for
 * `umbra`/`decree` to call; they take `uv`/`scroll` as arguments and read no
 * uniform, exactly as `sealField` does.
 */
export const SEAL_GLSL = /* glsl */ `
  const float SEAL_PI = 3.14159265;

  /* The seal presses inward slowly, the same cadence for every filter (identity
     in the cell): a fixed ring drifts to smaller r as scroll grows, exactly as
     vault's coffers contract. Deliberately tiny — at ring frequency 36 and scroll
     speed ~0.8 this advances the ring phase about 0.023 rad/tick, one ring past a
     fixed radius roughly every 270 ticks, the terminal register the seal wants. */
  const float SEAL_CONTRACT = 0.00080;

  /* 入神 tick size: 2*PI / (6 spokes * 8) ~= one detent per 7.5deg, keyed to the
     engraving's own six-fold symmetry so a step lands one lobe-fraction on. */
  const float SEAL_DETENT = 0.13089969;

  /* Stepped-ease ratchet: the seal HOLDS for the first 82% of each detent
     period, then eases the whole detent over the last 18% (12-23 ticks at the
     per-seal rates). The engraving is now angularly rich (hexagram + rays), so an
     instantaneous floor() step would strobe; easing over >=10 ticks keeps the
     visible tick temporally legal. */
  const float SEAL_STEP_HOLD = 0.82;

  /* 出神 dither knobs, named so the test:density fallback is a one-line change:
     cell 12 -> 16 game px, min levels floor 2 -> 3. */
  const float SEAL_DITHER_CELL = 12.0;        /* posterization cell, GAME px (readability unit) */
  const float SEAL_DITHER_MIN_LEVELS = 2.0;   /* coarsest quantization; raise to 3.0 to soften */
  const float SEAL_DITHER_MAX_LEVELS = 5.0;

  /* Canonical 4x4 ordered-dither matrix, values 0..15 -> (v+0.5)/16. No texture,
     no array (max GLSL-ES compat), no Math-approx call. Ordered-dither technique
     studied from pbakaus/radiant dither-gradient (MIT); the arithmetic is ours. */
  float sealBayer4(vec2 p) {
    vec2 q = floor(mod(p, 4.0));
    float x = q.x, y = q.y;
    float m =
        (x < 0.5) ? (y < 0.5 ?  0.0 : y < 1.5 ? 12.0 : y < 2.5 ?  3.0 : 15.0) :
        (x < 1.5) ? (y < 0.5 ?  8.0 : y < 1.5 ?  4.0 : y < 2.5 ? 11.0 :  7.0) :
        (x < 2.5) ? (y < 0.5 ?  2.0 : y < 1.5 ? 14.0 : y < 2.5 ?  1.0 : 13.0) :
                    (y < 0.5 ? 10.0 : y < 1.5 ?  6.0 : y < 2.5 ?  9.0 :  5.0);
    return (m + 0.5) / 16.0;
  }

  /* 出神 (umbra/decree only): the substrate losing bit depth. Structurally safe by
     three guarantees, none of which raise peak:
       - Never brighter — min(m, q) can only remove light; the seal -> 出神
         threshold is crossed by coherence/motion, the wave modulates LEVELS not
         amplitude.
       - Dark zones only — mask confines quantization to m < ~0.4, so the bright
         ring (m > 0.65) stays smooth and the largest dither steps land on the
         lowest-luminance regions (smallest absolute steps).
       - Bullet-band by AMPLITUDE not period — the 12px cell overlaps the bullet
         band in period, so safety is amplitude: on a <=0.041 field the dark-zone
         posterization steps are ~1.4% of a bullet's excursion. Gated on
         test:density; fallback raises the two named constants above.
     uv spans exactly the 480x640 field (vUv is geometry-derived, 0..1,
     retina-independent — see the quad in the Background class), so
     uv * vec2(480,640) is game px directly. uScroll clock (rule 1); no wall
     clock. */
  float sealDither(float m, vec2 uv, float scroll) {
    float levels = mix(
      SEAL_DITHER_MIN_LEVELS, SEAL_DITHER_MAX_LEVELS,
      0.5 + 0.5 * sin(scroll * 0.003 - uv.y * 4.0)   /* a traveling bit-depth wave */
    );
    vec2 cell = floor(uv * vec2(480.0, 640.0) / SEAL_DITHER_CELL);
    float q = floor(m * levels + sealBayer4(cell)) / levels;
    float mask = 1.0 - smoothstep(0.35, 0.65, m);    /* only the dark field quantizes */
    return mix(m, min(m, q), mask);                  /* min(): only ever removes light */
  }

  /* Rotate c-space by the ratchet amount so the whole engraving turns together. */
  mat2 sealRot(float t) { float s = sin(t), c = cos(t); return mat2(c, -s, s, c); }

  /* Edge-lit stroke = the bounding ring's OWN K=16 Gaussian cross-section, so
     every engraved line carries exactly the frequency the accepted ring carries
     and no other. sigma_x = 640/(16*sqrt2) = 28.3px, sigma_f = 0.00563 cyc/px <
     0.00625 bound (~90% of budget). A value ramp, never a glint (liquid-gold,
     pbakaus/radiant MIT; our GLSL). */
  float strokeGlow(float d) { float e = d * 16.0; return exp(-e * e); }

  /* Canonical hexagram SDF (IQ regular-star construction, MIT-class primitive).
     p in c-space (1 = 640px); r = circumradius. Returns signed distance. */
  float sdHexagram(vec2 p, float r) {
    const vec4 k = vec4(-0.5, 0.8660254038, 0.5773502692, 1.7320508076);
    p = abs(p);
    p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
    p -= 2.0 * min(dot(k.yx, p), 0.0) * k.yx;
    p -= vec2(clamp(p.x, r * k.z, r * k.w), r);
    return length(p) * sign(p.y);
  }

  /* 6 radial compass rays, integer-folded so the angle enters only via a closed
     6-fold offset (the undertow flute lesson — no wrap crack). r-windowed so the
     crowded centre stays a dark well. The angle already carries rotAmount. */
  float spokeGlow(float rlen, float a, float rIn, float rOut) {
    float da   = mod(a + 0.5235988, 1.0471976) - 0.5235988;   /* +/-30deg fold */
    float perp = rlen * abs(sin(da));                         /* c-space dist to ray */
    float win  = smoothstep(rIn - 0.03, rIn + 0.03, rlen)
               * (1.0 - smoothstep(rOut - 0.03, rOut + 0.03, rlen));
    return strokeGlow(perp) * win;
  }

  float sealField(
    vec2  uv,
    float aspect,
    float scroll,
    vec2  centre,      /* seal centre in uv; drifts for the unmoored 出神 pair */
    float ringRadius,  /* radius of the bounding ring */
    float ringFreq,    /* radial ring frequency (device rings; ~110px period) */
    float spokes,      /* INTEGER rosette lobe count */
    float arcHalf,     /* half-angle of ring present (>= PI => a whole seal) */
    float fill,        /* 0 sparse rosette .. 1 filled field (least rest) */
    float invert,      /* 0 device bright .. 1 figure/ground swapped (the cut void) */
    float rot,         /* rotation per unit scroll */
    float moireFreq,   /* second radial ring for the 出神 moiré; 0 = off */
    float centreFall,  /* centre-decay strength */
    float topFall,     /* top-lane-decay strength */
    float bevelDir     /* raking-light angle, FIXED in the frame (radians) */
  ) {
    vec2 c = (uv - centre) * vec2(aspect, 1.0);
    float r = length(c);

    /* 入神 tick: the engraving HOLDS, then eases one detent (stepped-ease
       ratchet). Deterministic, uScroll-derived (rule 1 safe), replay-identical.
       The whole engraving now rotates VISIBLY by design — the angularly-rich
       hexagram is exactly what makes the mechanism read as a press — so the tick
       is eased over the detent's last 18% (>=10 ticks) rather than stepped
       instantaneously, which would strobe. The 出神 pair (moireFreq > 0) takes the
       continuous path and never ticks. */
    float phase   = scroll * rot / SEAL_DETENT;
    float stepped = floor(phase) + smoothstep(SEAL_STEP_HOLD, 1.0, fract(phase));
    float rotAmount = (moireFreq > 0.001)
        ? scroll * rot                    /* 出神: continuous drift */
        : stepped * SEAL_DETENT;          /* stated seals: eased ratchet */
    float a = atan(c.y, c.x) + rotAmount;
    vec2  cr = sealRot(rotAmount) * c;    /* rotate the engraving with it */

    /* Wrapped angle for the arc gate. abs() of a value pulled back into
       (-pi, pi] is continuous across the seam (both sides reach pi), so a
       rotating broken arc still cannot crack. */
    float aw = mod(a + SEAL_PI, 2.0 * SEAL_PI) - SEAL_PI;

    /* N-fold rosette kept ONLY as the grain carrier (soft, angular — CANNOT be
       crisped, see the header's angular bound). Integer spokes -> sin closes
       across the wrap. */
    float rosette = 0.5 + 0.5 * sin(a * spokes);

    /* Grain against the rosette value, never the angle; confined to strokes
       because it multiplies structure, which -> 0 in the black field. */
    float grain = bgFbm(vec2(rosette * 2.2, r * 6.0 + scroll * 0.010));

    float pressed = r + scroll * SEAL_CONTRACT;

    /* The bounding ring: an inked, pressed-metal annulus — the engraved class
       marker no stage scene has. K=16 crisps it (FWHM ~215px -> ~94px), still
       COARSE (sigma_f 0.00563 < 0.00625 cyc/px, ~90% of budget; K-ceiling ~17.8).
       Square by multiplication, never pow(): GLSL pow(x, y) is undefined for
       x < 0, and (r - ringRadius) is negative inside the ring. */
    float dr = (r - ringRadius) * 16.0;
    float band = exp(-dr * dr);
    /* Pressed-metal bevel: a LOW-FREQUENCY ramp carrying the metal, never a glint
       (speculars dropped, not dimmed: a tight bright point is a fake bullet). Two
       terms compose it — a radial ramp (inner rim lit, outer rim shadowed) and a
       DIRECTIONAL rake: the light stays FIXED in the frame (bevelDir) while the
       engraving ratchets under it, so real metal catches a fixed light and the
       ratchet gains motion life for free. ringN is the UNROTATED frame outward
       normal, so the lit side does not turn with the engraving. Peak-neutral: the
       0.5/0.5 blend still tops out at 1.0 (requiring inner rim AND light-facing
       side), so bright COVERAGE only drops and the per-pixel ceiling is unchanged.
       rake is a smooth angular cosine (angular freq 1, broadest possible) — no new
       spatial frequency, no bullet-band risk. */
    float radialBevel = clamp((ringRadius - r) * 7.0, -1.0, 1.0);
    vec2  ringN = c / max(r, 1e-4);
    float rake  = dot(ringN, vec2(cos(bevelDir), sin(bevelDir)));
    float bevel = clamp(0.5 * radialBevel + 0.5 * rake, -1.0, 1.0);
    float ring  = band * (0.72 + 0.28 * bevel);

    /* Inner concentric device rings (soft, KEPT, UNSQUARED — see the header):
       radial, freq ~36 -> ~112px period, already live-measured coarse. Now the
       subordinate DEVICE term, no longer the primary structure. */
    float inner = 0.5 + 0.5 * sin(pressed * ringFreq);

    /* --- the engraved device: compass-and-rule linework, unioned into the ring.
       Every stroke uses the ring's OWN K=16 cross-section (strokeGlow), so the
       union adds no new spatial frequency, and union composition (max of
       unit-peak strokes) makes the brightest union pixel the brightest single
       stroke — ornament without raising the ceiling. IQ hexagram + liquid-gold
       value ramp, pbakaus/radiant MIT-class; our GLSL, noise and clocks. */
    float Rstar    = ringRadius * 0.70;                          /* hexagram scales with filter */
    float star     = strokeGlow(abs(sdHexagram(cr, Rstar)));     /* strapwork outline */
    float spoke    = spokeGlow(r, a, ringRadius * 0.28, Rstar);  /* 6 radial rays */
    float linework = max(star, spoke);

    float ground   = 1.0 - smoothstep(ringRadius - 0.02, ringRadius, r);   /* interior disk */

    /* Filter grammar preserved: invert -> the lines become dark CUTS in a lit
       ground (intaglio's incised die); fill -> the interior lights (regnum,
       least rest); otherwise the linework is the bright figure on the empty
       field (signet). */
    float lit_    = max(ring, linework);
    float cut_    = max(ring, ground * (1.0 - linework));
    float primary = mix(lit_, cut_, invert);
    primary       = max(primary, ground * fill);

    /* Travelling light: one broad bright lobe orbits the strokes (metal catching
       light as the seal turns) — the continuous second motion during a hold.
       Angular freq 1 = broadest possible, no bullet. Crest multiplier 1.0, so
       peak is preserved and never raised. */
    float sweep = 0.5 + 0.5 * sin(a - scroll * 0.024);
    primary *= (0.85 + 0.15 * sweep);

    /* Radial moiré (出神): a second ring RADIALLY detuned. r carries no angular
       wrap, so a non-integer detune is safe (no crack). It only ever multiplies
       the structure down, so coherence swims while luminance never rises. Floor
       0.45 keeps the unmoored pair clearly dimmer than the stated seals. */
    float beat = 1.0;
    if (moireFreq > 0.001) {
      float second = 0.5 + 0.5 * sin(pressed * moireFreq);
      beat = 0.45 + 0.40 * (inner * second + (1.0 - inner) * (1.0 - second));
    }

    /* Broken arc: present for |aw| < arcHalf, fading at the ends. A whole seal
       passes arcHalf >= PI and this is 1 everywhere. */
    float arc = 1.0 - smoothstep(arcHalf - 0.35, arcHalf + 0.08, abs(aw));

    /* Value structure: the engraved union is the primary; the device rings are
       subordinate. Weight-sum 1.00 (0.82 + 0.18) leaves the law's headroom;
       union max keeps the ceiling at the single brightest stroke. */
    float device    = 0.60 * inner;
    float structure = arc * (0.82 * primary + 0.18 * device);
    structure *= (0.82 + 0.18 * grain);                 /* grain rides strokes only */

    /* STAMP: the seal inks in over the first 40 scroll units, frame -> centre —
       the ring frame lands first (front passes ringRadius), then hexagram,
       spokes, device. A coarse light-front (K=16, full-width, transient, capped
       0.85 of the sustained ring) rides the front and is gone by stampT=1, where
       mix(reveal,1.0,stampT) forces the mask to exactly 1.0 (sustained seal, zero
       residual). Pure uScroll (rule 1); #compile mints uScroll=0 on every
       transitionTo, so this re-stamps for free at any crossfade length. Couples
       with the §3 tear: the stage tears away while the seal inscribes itself. */
    const float STAMP_SCROLL = 40.0;
    float stampT    = smoothstep(0.0, STAMP_SCROLL, scroll);
    float front     = mix(ringRadius + 0.20, -0.05, stampT);
    float reveal    = 1.0 - smoothstep(front - 0.05, front + 0.05, r);
    float frontEdge = strokeGlow(r - front) * (1.0 - stampT);
    structure = max(structure * mix(reveal, 1.0, stampT), frontEdge * arc * 0.85);

    /* The two crowded zones, and the empty field outside the ring. */
    float nearC = clamp(r * centreFall, 0.0, 1.0);
    float nearTop = clamp(uv.y * topFall, 0.0, 1.0);
    float outer = 1.0 - smoothstep(ringRadius, ringRadius + 0.16, r);
    float body = nearC * nearTop * outer;

    /* THE INVERSION: a hair of wax floor (0.03·GLOW, deep black) that structure
       lifts. The field between strokes stays near-black; the engraving reads as
       bright pressed-gold linework by local contrast AND by spending the exposure
       the shader-ports law now allows. SEAL_GAIN is the single shared exposure
       knob for the family — raised from the retired peak~0.1 era's 1.35 to 3.6, so
       the engraving crests VIVID (structured peak ~0.22-0.24 raw, roughly x3 the
       old ceiling — the user-confirmed anchor). The boss-station centre stays
       calmer than its surround through the body nearC falloff, so the bright sprite
       still wins the void. The 出神 pair rides the same gain but multiplies far
       back down (its beat floor, its dither and eclipse/pull), so it is always
       relatively dimmer than the seal it drifts from. Numbers are
       [MEASURED-IN-ACCEPTANCE]; the empirical arbiter is bullet readability under a
       real curtain, not this constant. */
    const float SEAL_GAIN = 3.6;
    return body * (0.03 + SEAL_GAIN * structure) * beat;
  }
`;

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
 * cannot collide with the `bgFbm`/`sealField` already in each fragment; they are
 * appended AFTER the fragment so `background()` is defined before `main` calls it.
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

    /* Local, distinctly-named helpers so nothing collides with the bgFbm/sealField
       already in each fragment. */
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
