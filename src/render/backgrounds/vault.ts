/**
 * `vault` — stage 4, the bottom of the descent. A port of pbakaus/radiant
 * `ink-calligraphy` (MIT) via the closed-form substitute the references doc
 * scoped for it: the reference is Canvas2D with a wall clock, mouse-driven brushes
 * and canvas-feedback accumulation — portable=NO as authored — so its DEFINING
 * IMAGE (a directional calligraphic mark that swells early and tapers gracefully)
 * is re-derived as an SDF stroke along a parametric LOG-SPIRAL winding into a dark
 * central oculus, with the swell/taper envelope re-expressed as a function of
 * arc-length (radius) instead of animation time, and curvature->width replacing
 * the reference's speed->width (there is no cursor). Gold ink on a near-black
 * ground — the calligraphic gesture as the terminal pull into the empty seat
 * (被拽出画框).
 *
 * ## Why the substitute, not the file
 *
 * The fetched `ink-calligraphy.html` has no fragment shader at all: two SimplexNoise
 * brushes stroke quadratic curves onto off-screen canvases, `diffuse()`/`fade()`
 * read canvas history every frame, and `simTime` is a `requestAnimationFrame`
 * accumulator (a wall clock, forbidden by rule 1). None of that ports. What ports
 * is the gesture — a mark with a beginning, a swell, and a taper — which the refs
 * doc names as the only legal path, and which a log-spiral SDF expresses exactly.
 *
 * ## Structure
 *
 *   - A single continuous log-spiral stroke, `sp = a + log(r)*PITCH`, wound inward
 *     by the clock (the recession — the biggest motion delta in the game, placed
 *     where the terminal descent needs it). `ARM_COUNT` is an INTEGER (3), so the
 *     stroke stays a-periodic across the `atan` wrap and no crack runs out of the
 *     centre (the flute lesson). `log(max(r,0.03))` guards the divide.
 *   - The width envelope `wEnv` is a function of RADIUS (arc-length): the stroke
 *     begins thin at the outer edge, swells mid-field, and tapers to nothing at the
 *     oculus — the calligraphic swell/taper, and the load-bearing centre-decay that
 *     keeps the crowded boss station a smooth dark well (no fine structure where
 *     bullets form). A gold-leaf shimmer rides the stroke only.
 *
 * ## Adaptation & hygiene
 *
 *   - Clock: `t = uScroll * 0.03`; `uScroll` advances only in `step()`.
 *   - The reference's bright gold-leaf SPECKS (individual arcs) are re-expressed as
 *     a broad shimmer that multiplies the stroke — a bright pinpoint is a fake
 *     bullet. Canvas feedback and mouse brushes are gone by construction.
 *   - EXPOSURE 0.26: stage 4 is the terminal, most crowded scene; the oculus
 *     darkens toward zero (the empty seat as absence) and the top lane stays calm.
 *
 * ## Exposure & readability
 *
 * Stage-4 tier. Gold stroke crests in the ~0.22-0.28 band
 * [MEASURED-IN-ACCEPTANCE]; the oculus and the top lane fall to near-black. Arm
 * spacing is ~200px mid-field, an order coarser than a bullet, and the envelope
 * kills all structure before the arms narrow near the centre. Motion: the spiral
 * winds inward, one arm-pass over ~1.5-2s, per-tick step under the strobe bound
 * [MEASURED-IN-ACCEPTANCE].
 *
 * ## Clock
 *
 * `uScroll` only — no wall clock (see `background.ts`, rule 1);
 * `backgrounds/index.test.ts` scans this file for wall-clock sources.
 *
 * ink-calligraphy by pbakaus/radiant, MIT. Re-derived as a log-spiral SDF stroke
 * (the refs-doc substitute); our GLSL, clock, palette and exposure.
 */

import { BACKGROUND_NOISE_GLSL, defineBackground } from '../background';

defineBackground('vault', {
  scrollSpeed: 0.5,
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}

    const float VA_TAU = 6.28318530718;
    const float EXPOSURE = 0.26;   /* stage 4 — terminal, most crowded */

    /* INTEGER arm count -> a-periodic across the atan wrap, no centre crack. */
    const int   ARM_COUNT = 3;
    /* Log-spiral pitch -> ~200px arm spacing mid-field, coarser than a bullet. */
    const float PITCH = 1.7;
    /* Inward winding rate (the recession). One arm-pass ~1.5-2s. */
    const float SWIRL = 0.9;
    /* Faint contracting radial ring, for the dome read. */
    const float RING_FREQ = 36.0;
    const float CONTRACT_RATE = 0.01;

    /* Near-black warm ground and the gold calligraphic ink. */
    const vec3 BASE = vec3(0.010, 0.007, 0.002);
    const vec3 INK  = vec3(0.95, 0.70, 0.30);   /* gold leaf, R > G > B */

    vec3 background(vec2 uv) {
      float aspect = uRes.x / uRes.y;
      vec2 c = (uv - vec2(0.5, 0.5)) * vec2(aspect, 1.0);
      float r = length(c);
      float a = atan(c.y, c.x);
      float t = uScroll * 0.03;

      /* Log-spiral coordinate; clamp keeps log() finite and the tight centre
         in-band. Square by multiplication elsewhere; here log is guarded. */
      float lr = log(max(r, 0.03));
      float sp = a + lr * PITCH;

      /* Continuous arm index; winds inward with the clock. ARM_COUNT integer, so
         the a-seam jump (a -> a+2*pi) shifts the index by an integer and fract()
         stays continuous — no crack out of the oculus. */
      float g = float(ARM_COUNT) * sp / VA_TAU - t * SWIRL;
      float cell = abs(fract(g) - 0.5) * 2.0;   /* 0 on the stroke centreline */

      /* Calligraphic width envelope as a function of arc-length (radius): thin at
         the outer edge, swelling mid-field, tapering to nothing at the oculus.
         This is the centre-decay safety — no fine structure where bullets crowd. */
      float wEnv = smoothstep(0.58, 0.34, r) * smoothstep(0.04, 0.17, r);

      /* The stroke: soft calligraphic edges; width couples to the envelope
         (curvature->width in the arc-length sense). */
      float W = 0.20 + 0.22 * wEnv;
      float stroke = (1.0 - smoothstep(0.0, W, cell)) * wEnv;

      /* Gold-leaf shimmer rides the stroke only (never a bright pinpoint). */
      float shimmer = bgFbm(vec2(g * 1.5, r * 4.0 - t * 2.0));
      stroke *= 0.72 + 0.28 * shimmer;

      /* Faint contracting radial ring for the dome read (subordinate). */
      float rings = 0.5 + 0.5 * sin((r + uScroll * CONTRACT_RATE) * RING_FREQ);
      stroke *= 0.80 + 0.20 * rings;

      /* The oculus darkens toward zero (the empty seat as absence); the top entry
         lane stays calm. */
      float oculus = smoothstep(0.02, 0.22, r);
      float nearLane = smoothstep(0.0, 0.26, uv.y);
      float look = stroke * oculus * (0.35 + 0.65 * nearLane);

      return (BASE + INK * look) * EXPOSURE;
    }
  `,
});
