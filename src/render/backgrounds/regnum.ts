/**
 * `regnum` — the regent's fight (the stage-4 boss). A NEAR-IDENTICAL port of
 * pbakaus/radiant `topographic` (MIT): a warm topographic contour map — amber,
 * coral and gold elevation lines traced over a near-black field, the whole relief
 * evolving slowly as the terrain morphs. The contour lines ARE the picture, and
 * this replaces the retired liquid-gold variant (the GOLD_GLSL import is gone —
 * no-repeat law: one reference, one scene).
 *
 * ## The reference's real form, and the one unavoidable adaptation
 *
 * `topographic` is NOT a fragment shader. It is a Canvas-2D renderer: it samples a
 * 4-octave 3D-simplex fbm into a grid, min/max-normalises it to 0..1, then extracts
 * iso-lines at 14 evenly-spaced thresholds with **marching squares** and strokes
 * each as line segments — twice (a wide faint glow pass, a thin bright sharp pass),
 * every 5th contour a thicker/brighter "major" line, coloured coral→amber→gold by
 * elevation and dimmed toward the extremes. There is no GLSL to lift, so the port
 * reconstructs the identical IMAGE the only way a full-screen fragment shader can:
 * per-pixel **analytic iso-line rendering**. Instead of walking cells and emitting
 * segments, each pixel measures its own distance to the nearest contour and shades
 * a constant-pixel-width stroke — the GPU-native equivalent of marching squares,
 * producing the same lines. Every OTHER element is ported term-for-term:
 *
 *   - the fbm (4 octaves, freq×2 / amp×½ per octave, the time axis held common to
 *     all octaves so the relief morphs coherently — exactly the reference's
 *     `noise3D(x*freq, y*freq, z)` with an unscaled `z`);
 *   - the contour thresholds `(c+1)/(LEVELS+1)`, the coral→amber→gold ramp, the
 *     centre-bright / extreme-dim alpha curve, the every-5th "major" line, and the
 *     glow+sharp double stroke — all reproduced from the reference's own constants;
 *   - the radial vignette darkening the corners.
 *
 * ## Adaptation to our surface (every departure from the near-identical bar, justified)
 *
 *   - **Extraction mechanism** (above): CPU marching-squares segments → per-pixel
 *     iso-distance strokes. Same lines, different machinery; a fragment shader is
 *     per-pixel by nature and cannot walk a segment list. Line WIDTH is held
 *     constant in pixels by normalising the iso-distance by the field's analytic
 *     gradient (finite differences, deterministic — no `dFdx`), exactly as the
 *     stroke width was constant in the reference.
 *   - **Noise basis.** 3D simplex → a compact 3D **value** noise (`tpNoise3`). The
 *     reference's seed-permuted simplex table cannot be reproduced in GLSL and its
 *     precise pixels were never the identity; both are smooth isotropic 3D noise and
 *     read identically as terrain. This is the same class of substitution every
 *     ported scene here makes (`drift`'s `mrHash`, `signet`'s `lgNoise`).
 *   - **Normalisation.** The reference re-derives min/max **every frame** and
 *     stretches the field to fill 0..1 — a global reduction a fragment shader has no
 *     way to compute, and one that makes every contour breathe slightly frame to
 *     frame as the extremes wander. A fixed statistical transform (`FIELD_STRETCH`
 *     around the value-noise mean of 0.5) reproduces the same contour density
 *     without that global flicker — calmer under a curtain, which a seal wants.
 *   - **Excised: the pointer and the labels.** The mouse elevation bump/dent and the
 *     `Math.random()`-placed elevation number labels are dropped — our uniform
 *     surface has no pointer (rule 1 forbids anything but a tick clock), and the
 *     labels are non-deterministic CPU text with no fragment-shader analogue.
 *   - **Clock.** `t = uScroll * TOPO_TIME`; see below.
 *   - **y-down uv** is used directly — a contour map has no up, so no flip is needed;
 *     `uv` is only aspect-corrected so the relief is isotropic on the 3:4 frame.
 *
 * ## Exposure & the bullet-band grading
 *
 * Seal tier — a boss station, a step below the open stages. EXPOSURE 0.55 is the
 * final gain; a mid-elevation major line (the brightest thing on the field) crests
 * ~0.22-0.27 raw across the morph [MEASURED-IN-ACCEPTANCE], the near-black relief between the lines sits
 * ~0.01, always far under a bullet's 1.0-white + bloom. The image is bimodal by
 * nature — thin bright lines over a dark field — which is the readable shape a seal
 * wants; the arbiter is bullet readability under a real curtain (`bun run dev` and
 * the density page), and these numbers describe what the code produces, not a target
 * set in advance.
 *
 * Two knobs keep bright detail out of the bullet band (16-30px):
 *   1. **`CONTOUR_SPACING` grade (the primary knob).** Contour *pitch* is the
 *      readability parameter. Where the relief steepens, adjacent iso-lines crowd
 *      together — and a stack of bright ~20px-spaced parallel lines would read as a
 *      bullet curtain. The grade dims a line wherever its neighbours fall inside
 *      the play band — flooring at `TIGHT_FLOOR` (0.45), not zero: zeroing was
 *      measured in acceptance deleting most of the picture (mean .010, the map
 *      invisible). A floored in-band line peaks ~.12 raw — in-band-but-dim, the
 *      same grade sable's fizz uses — while full brightness is reserved for lines
 *      pitched WELL above the band. A line's constant ~1-4px *width* is far finer
 *      than a 16-30px bullet and reads as a line, never a blob; it is line
 *      SPACING, not width, that the band cares about.
 *   2. **`FIELD_SCALE` / octave count.** The field's spatial frequency is set so even
 *      the finest (4th) octave lands its cells ~42px — clear of the band — so the
 *      relief's own crinkle never counterfeits a curtain either.
 *
 * No strobing: `TOPO_TIME` is held a touch below the reference's morph rate so a
 * contour line drifting across the field steps well under a line-width per tick —
 * coherent motion, bounded per-tick luminance step.
 *
 * ## Clock
 *
 * `uScroll` only, which advances in `step()` and nowhere else — no `performance.now`,
 * so a replay looks identical twice (`background.ts`, rule 1).
 * `backgrounds/index.test.ts` scans this file for wall-clock sources.
 *
 * topographic by pbakaus/radiant, MIT. Ported near-identically; our clock, y-down
 * projection, per-pixel iso-line extraction, value-noise basis, fixed normalisation
 * and seal-tier exposure are the only departures.
 */

import { defineBackground } from '../background';

defineBackground('regnum', {
  scrollSpeed: 0.8,
  fragment: /* glsl */ `
    /* Seal tier — a boss station a step below the open stages. See the header. */
    const float EXPOSURE = 0.55;

    /* Ported from the reference's constants. LEVELS is NUM_CONTOURS (14). */
    const float LEVELS = 14.0;

    /* THE READABILITY KNOB (spatial). FIELD_SCALE sets the relief's frequency; at
       1.8 the coarse humps span the 3:4 frame and the bulk of the contour pitch
       clears the 16-30px bullet band. FIELD_STRETCH replaces the reference's
       per-frame min/max renormalisation with a fixed transform around the
       value-noise mean (0.5), giving the same contour density without a global
       per-frame breathe. Lower FIELD_SCALE / STRETCH = flatter relief, wider pitch. */
    const float FIELD_SCALE = 1.8;
    const float FIELD_STRETCH = 1.7;

    /* Contour-pitch grade (the primary bullet-band knob). A line GRADES DOWN where
       its neighbours crowd inside the play band and holds full brightness once the
       pitch clears it — but it floors at TIGHT_FLOOR rather than zero. Zeroing was
       measured deleting most of the picture (acceptance: mean .010, the contour
       field invisible); a floored line peaks ~.12 raw against a 1.0+bloom bullet,
       in-band-but-dim, so the map stays a map and nothing counterfeits a shot.
       TIGHT_OK sits above the 30px band ceiling. */
    const float TIGHT_MIN = 20.0;
    const float TIGHT_OK  = 44.0;
    const float TIGHT_FLOOR = 0.45;

    /* Clock: net morph ~0.0012 per tick (scrollSpeed 0.8 × TOPO_TIME), held well
       under the reference's ~0.0025/tick so a drifting contour steps a fraction of a
       line-width per tick — the seal stays serene, the per-tick luminance step stays
       bounded (no strobe). uScroll advances only in step() — rule 1. */
    const float TOPO_TIME = 0.0015;

    /* The reference's near-black field and its coral→amber→gold elevation ramp
       (its rgb/255). */
    const vec3 BASE  = vec3(0.030, 0.024, 0.018);
    const vec3 CORAL = vec3(0.878, 0.471, 0.314);
    const vec3 AMBER = vec3(0.784, 0.584, 0.424);
    const vec3 GOLD  = vec3(0.831, 0.647, 0.455);

    /* Compact 3D value noise (tp* so nothing collides with bgFbm or the tear* in
       the compose wrapper). Pure arithmetic — deterministic across GPUs. */
    float tpHash(vec3 p) {
      p = fract(p * vec3(0.1031, 0.1030, 0.0973));
      p += dot(p, p.yxz + 33.33);
      return fract((p.x + p.y) * p.z);
    }

    float tpNoise3(vec3 x) {
      vec3 i = floor(x);
      vec3 f = fract(x);
      vec3 u = f * f * (3.0 - 2.0 * f);
      float n000 = tpHash(i + vec3(0.0, 0.0, 0.0));
      float n100 = tpHash(i + vec3(1.0, 0.0, 0.0));
      float n010 = tpHash(i + vec3(0.0, 1.0, 0.0));
      float n110 = tpHash(i + vec3(1.0, 1.0, 0.0));
      float n001 = tpHash(i + vec3(0.0, 0.0, 1.0));
      float n101 = tpHash(i + vec3(1.0, 0.0, 1.0));
      float n011 = tpHash(i + vec3(0.0, 1.0, 1.0));
      float n111 = tpHash(i + vec3(1.0, 1.0, 1.0));
      float nx00 = mix(n000, n100, u.x);
      float nx10 = mix(n010, n110, u.x);
      float nx01 = mix(n001, n101, u.x);
      float nx11 = mix(n011, n111, u.x);
      return mix(mix(nx00, nx10, u.y), mix(nx01, nx11, u.y), u.z);
    }

    /* The reference fbm, ported: 4 octaves, freq×2 / amp×½, the time axis (z) held
       common to every octave so the whole relief morphs coherently. Normalised by
       the amplitude sum, then stretched about 0.5 (fixed, not per-frame min/max). */
    float tpField(vec2 uv, float aspect, float t) {
      vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5) * FIELD_SCALE;
      float val = 0.0, amp = 1.0, freq = 1.0, sum = 0.0;
      for (int o = 0; o < 4; o++) {
        val += tpNoise3(vec3(p * freq, t)) * amp;
        sum += amp;
        amp *= 0.5;
        freq *= 2.0;
      }
      float f = val / sum;                                  /* ~[0,1], centred ~0.5 */
      return clamp((f - 0.5) * FIELD_STRETCH + 0.5, 0.0, 1.0);
    }

    vec3 background(vec2 uv) {
      float aspect = uRes.x / uRes.y;
      float t = uScroll * TOPO_TIME;

      /* Field, and its analytic gradient by one-pixel finite differences (no dFdx,
         deterministic). |df| per pixel drives constant-width strokes and the pitch. */
      float fc = tpField(uv, aspect, t);
      vec2 texel = 1.0 / uRes;
      float fx = tpField(uv + vec2(texel.x, 0.0), aspect, t);
      float fy = tpField(uv + vec2(0.0, texel.y), aspect, t);
      float gradMag = length(vec2(fx - fc, fy - fc));       /* |df| / pixel */

      /* g crosses an integer at every contour; the nearest one is this pixel's line. */
      float g = fc * (LEVELS + 1.0);
      float level = floor(g + 0.5);
      float distG = abs(g - level);                         /* to nearest line, g-units */
      float dgdpx = gradMag * (LEVELS + 1.0);               /* g change per pixel */
      float distPx = distG / max(dgdpx, 1e-6);              /* pixel distance to line */
      float spacingPx = 1.0 / max(dgdpx, 1e-6);             /* pitch to the neighbour */

      vec3 col = BASE;

      /* Only the interior thresholds (1..LEVELS) carry a line, exactly as the
         reference's (c+1)/(LEVELS+1) for c in 0..LEVELS-1. */
      if (level >= 1.0 && level <= LEVELS) {
        float threshold = level / (LEVELS + 1.0);

        /* coral→amber→gold by elevation (the reference's blend). */
        vec3 lineColor = threshold < 0.5
          ? mix(CORAL, AMBER, threshold * 2.0)
          : mix(AMBER, GOLD, (threshold - 0.5) * 2.0);

        /* Centre-bright / extreme-dim alpha, and every 5th line "major". */
        float distFromCenter = abs(threshold - 0.5) * 2.0;
        float baseAlpha = 0.25 + (1.0 - distFromCenter) * 0.45;   /* 0.25..0.70 */
        float isMajor = mod(level - 1.0, 5.0) < 0.5 ? 1.0 : 0.0;

        /* Glow (wide, faint) + sharp (thin, bright) double stroke — the reference's
           widths in px, rendered as constant-width iso-distance falloffs. */
        float glowWidth  = mix(2.5, 4.5, isMajor);
        float sharpWidth = mix(0.6, 1.2, isMajor);
        float glowAlpha  = baseAlpha * 0.25;
        float sharpAlpha = baseAlpha * mix(0.8, 1.0, isMajor);
        /* AA half-bands: the sharp stroke is softened to ~2px (SHARP_AA 1.1) so a
           sub-pixel-hard line cannot pop a single pixel on in one tick as it crawls
           (no-strobe); this also matches the reference's actual round-cap strokes,
           which AA to ~2px on screen. Peak is unchanged (distPx=0 stays 1.0) — only
           the falloff widens. */
        float glow  = 1.0 - smoothstep(glowWidth * 0.5 - 0.9, glowWidth * 0.5 + 0.9, distPx);
        float sharp = 1.0 - smoothstep(sharpWidth * 0.5 - 1.1, sharpWidth * 0.5 + 1.1, distPx);
        float lineTerm = glow * glowAlpha + sharp * sharpAlpha;

        /* BULLET-BAND KNOB — grade the line down (to TIGHT_FLOOR, not zero) where
           the contour pitch crowds into the play band; full brightness above it. */
        lineTerm *= mix(TIGHT_FLOOR, 1.0, smoothstep(TIGHT_MIN, TIGHT_OK, spacingPx));

        col += lineColor * lineTerm;
      }

      /* Radial vignette (the reference's), aspect-corrected. */
      vec2 vc = (uv - 0.5) * vec2(aspect, 1.0);
      col *= 1.0 - 0.4 * smoothstep(0.15, 0.55, length(vc));

      return col * EXPOSURE;
    }
  `,
});
