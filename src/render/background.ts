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
 * Keep it dark and keep it smooth. The play field has to stay readable on top,
 * which in practice means peak luminance around 0.1 and no detail fine enough to
 * be confused with a bullet. Every shipped background sits under that, and the
 * two perspective ones (`expanse`, `undertow`) additionally decay their
 * structured terms faster than their brightness, because a projection that runs
 * to infinity samples noise faster than the pixel grid can carry — and what that
 * aliases into looks exactly like sparse bullets.
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
 *   2. `bun run dev`, open the page. The field must be a dark blue-grey cloud
 *      drifting steadily **downward**, brighter toward the bottom of the screen.
 *      Bullets and the player must read cleanly against it; if you find yourself
 *      losing a bullet, the shader is too bright or too detailed, not the sprite.
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
 * The cell is an engraved, pressed-metal **ring** — a crisp bright annulus lit
 * like a mark stamped into a dark surface — enclosing an N-fold **rosette** (the
 * signet's device, the notary's seal the fiction already carries) and a train of
 * soft concentric device rings. This is the class marker no stage scene contains:
 * where the stages are a luminous, evenly-textured haze (unimodal histogram, high
 * mean, low local contrast, translational drift), a seal is a **near-black frame
 * with a thin bright ring closing on itself** (bimodal histogram — a tall spike at
 * black, a thin tail reaching the peak), a mark *pressed into* a surface. A
 * squinted single frame classifies stage-vs-boss before any colour is named.
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
 * ## Value structure — the inversion (why the ring reads as a hard line)
 *
 * The field between strokes falls to a hair of wax floor (0.03·body, deep black);
 * the bright ring reads as a hard bright line by local contrast AND by spending
 * the luminance headroom the law leaves. Peak `structure` ~= 0.90·ring_peak +
 * 0.20·inner·device ~= 0.83, and the structure gain is **1.50** (acceptance
 * calibration, was the design's 0.90): `return_max = body·(0.03 + 1.50·0.83)·beat
 * ~= 1.28·body`. The design's own gain measured signet at 0.0565 — below the
 * pre-round 0.068 and, by the user's live verdict, imperceptibly different from
 * the old soft rendering. The decisions doc licenses peaks anywhere under the
 * 0.1 law ("headroom INSIDE the law to be more present"), so the calibration
 * spends it: measured peaks signet 0.0926 · cordon 0.0949 · intaglio 0.0899 ·
 * regnum 0.0769 · sable 0.0444 · decree 0.0392 · umbra 0.0314 — all under 0.1,
 * sable darkest stated seal, 出神 pair below their parents. A scene tunes GLOW,
 * not this floor, if a peak lands wrong.
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
 * sigma and is wrong by a factor of sqrt(2)). A pressed-metal **bevel** — a LOW-FREQUENCY linear radial ramp,
 * inner rim lit, outer rim shadowed — carries the material; there is deliberately
 * NO glint/specular (a tight bright pinpoint is a fake bullet). Value-ramp + rim
 * lighting studied from pbakaus/radiant liquid-gold & moonlit-ripple (MIT); the
 * ink-contour `lobe*(1-lobe)` from ink-dissolve; our GLSL, noise and clocks.
 *
 * ## The inner concentric train stays UNSQUARED
 *
 * The device rings (`inner`, freq ~36 -> ~112px period) are the compass-and-rule
 * geometry-discipline the class contrast wants, already live-measured coarse, and
 * the floor drop alone turns them into bright rings on black. They are left
 * UNSQUARED on purpose: squaring a sinusoid injects an exact 2nd harmonic at
 * ~56px, halving the bullet-band margin for a reveal the floor drop already
 * delivers. No thresholded petals, no thresholded rings — outlawed by the angular
 * bound above.
 *
 * ## Motion — three classes (stages drift, stated seals TICK, 出神 pair drifts)
 *
 * The stated seals RATCHET their rotation: `rot` advances in `SEAL_DETENT`
 * detents rather than continuously — a mechanism, not a drift (the 入神/Absorption
 * reading). This is licensed where the decisions-doc would normally forbid a
 * ratchet, by a rotation-invariance proof: the bright `ring` TERM is a function of
 * `r` alone, so `d(ring)/d(rotation) = 0` — a detent step produces NO luminance
 * change on the class marker; only the DIM, coarse, subordinate rosette advances,
 * under coarse angular gradients. The step's luminance edge near bullets is
 * provably zero on the marker and negligible on the device. **This holds only for
 * WHOLE seals (arcHalf >= pi, arc == 1 everywhere).** The visible bright marker is
 * `arc * ring`, and for a BROKEN-arc seal (cordon, arcHalf = pi/2) the `arc` gate
 * is rotation-DEPENDENT (it reads `abs(aw)`, and `aw` carries `rotAmount`), so a
 * detent steps the lit arc's ENDPOINTS by one detent (~0.131 rad; at ringRadius
 * 0.34 that sweeps the endpoint ~28px). The radial luminance profile is still
 * invariant, so the §8.7 gate that inspects only the radial profile would MISS
 * this — the ratchet-capture gate must also inspect the arc-END luminance for
 * broken-arc seals, and if the endpoint jump reads near bullets, exempt them from
 * the ratchet (continuous path) or coarsen their detent. The 出神 pair
 * (`moireFreq > 0`) opts OUT automatically and keeps continuous drift — a ticking
 * mechanism that is simultaneously unmooring would be self-contradictory.
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
     rosette's own six-fold symmetry so a step lands one lobe-fraction on. */
  const float SEAL_DETENT = 0.13089969;

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
    float topFall      /* top-lane-decay strength */
  ) {
    vec2 c = (uv - centre) * vec2(aspect, 1.0);
    float r = length(c);

    /* 入神 tick: rotation advances in detents, a mechanism not a drift.
       Deterministic, uScroll-derived (rule 1 safe), replay-identical. The bright
       ring term is ROTATION-INVARIANT (a function of r alone), so a step produces
       NO luminance change on the class marker — only the dim soft rosette advances.
       Caveat: the VISIBLE marker is arc * ring; for a WHOLE seal arc == 1 so the
       invariance holds outright, but for a BROKEN arc (arcHalf < pi, cordon) the
       arc gate is rotation-dependent, so a detent steps the lit arc's endpoints
       (see the header's motion section). The 出神 pair (moireFreq > 0) takes the
       continuous path and never ticks. */
    float rotAmount = (moireFreq > 0.001)
        ? scroll * rot                                       /* 出神: continuous drift */
        : floor(scroll * rot / SEAL_DETENT) * SEAL_DETENT;   /* stated seals: ratcheted */
    float a = atan(c.y, c.x) + rotAmount;

    /* Wrapped angle for the arc gate. abs() of a value pulled back into
       (-pi, pi] is continuous across the seam (both sides reach pi), so a
       rotating broken arc still cannot crack. */
    float aw = mod(a + SEAL_PI, 2.0 * SEAL_PI) - SEAL_PI;

    /* N-fold rosette (soft, angular — CANNOT be crisped, see the header's angular
       bound). Integer spokes -> sin closes across the wrap. */
    float rosette = 0.5 + 0.5 * sin(a * spokes);
    float lobe = mix(rosette, 1.0 - rosette, invert);   /* inverted: lobes are the cut */
    lobe = mix(lobe, max(lobe, 0.7), fill);             /* filled: the ground lights too */
    /* Ink-contour glow on the lobe boundary; technique from ink-dissolve. SMOOTH
       (a sinusoid, never a hard line), but NOT wide: lobe*(1-lobe) squares the
       rosette, so for fill=invert=0 it is 0.5 + 0.5*cos(2*spokes*a) — a sinusoid
       at 2*spokes, HALF the rosette period (bullet-coarse at the seal radius,
       entering the 16-30px band only for r < ~57px). Safe by AMPLITUDE, not
       period: its return contribution is ~body*0.081*inner*petalEdge times GLOW,
       a swing <~0.5% of a bullet's excursion — bounded by the ~0.04-0.07 field
       peak, not by frequency. */
    float petalEdge = lobe * (1.0 - lobe) * 4.0;
    float device = 0.55 * lobe + 0.45 * petalEdge;

    /* Grain against the rosette value, never the angle; confined to strokes
       because it multiplies structure, which -> 0 in the black field. */
    float grain = bgFbm(vec2(rosette * 2.2, r * 6.0 + scroll * 0.010));

    float pressed = r + scroll * SEAL_CONTRACT;

    /* The bounding ring: an inked, pressed-metal annulus — the engraved class
       marker no stage scene has. K=16 crisps it (FWHM ~215px -> ~94px), still
       COARSE (sigma_f 0.00563 < 0.00625 cyc/px, ~90% of budget; K-ceiling ~17.8).
       Square by multiplication, never
       pow(): GLSL pow(x, y) is undefined for x < 0, and (r - ringRadius) is
       negative inside the ring. */
    float dr = (r - ringRadius) * 16.0;
    float band = exp(-dr * dr);
    /* Pressed-metal bevel: a LOW-FREQUENCY linear radial ramp, inner rim lit,
       outer rim shadowed. It adds material across the band's support, not a new
       edge — the RAMP carries the metal, never a glint (speculars dropped, not
       dimmed: a tight bright point is a fake bullet). */
    float bevel = clamp((ringRadius - r) * 7.0, -1.0, 1.0);
    float ring  = band * (0.72 + 0.28 * bevel);

    /* Inner concentric device rings (soft, KEPT, UNSQUARED — see the header):
       radial, freq ~36 -> ~112px period, already live-measured coarse. The floor
       drop below turns these into bright rings on black; squaring them would
       inject a 56px 2nd harmonic toward the bullet band for no gain. */
    float inner = 0.5 + 0.5 * sin(pressed * ringFreq);

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

    /* Value structure: the bright ring dominates; device + inner rings subordinate. */
    float structure = arc * (0.90 * ring + 0.20 * inner * device);
    structure *= (0.82 + 0.18 * grain);                 /* grain rides strokes only */

    /* The two crowded zones, and the empty field outside the ring. */
    float nearC = clamp(r * centreFall, 0.0, 1.0);
    float nearTop = clamp(uv.y * topFall, 0.0, 1.0);
    float outer = 1.0 - smoothstep(ringRadius, ringRadius + 0.16, r);
    float body = nearC * nearTop * outer;

    /* THE INVERSION: a hair of wax floor (0.03), structure lifts it. The field
       between strokes falls to ~BASE (deep black); the ring reads as a hard
       bright line by local contrast AND by peak — the 1.50 gain is the
       acceptance calibration (design's 0.90 measured imperceptible; see the
       header's value-structure section for the measured family). */
    return body * (0.03 + 1.50 * structure) * beat;
  }
`;

/**
 * Assemble a full fragment shader from a spec's body.
 *
 * Exported for `background.test.ts`: the standard uniform block is a contract
 * with every background ever written, and a silent change to it would only show
 * up as a shader that fails to compile in a browser nobody has opened yet.
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

    void main() {
      gl_FragColor = vec4(background(vUv) * uIntensity, uAlpha);
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
