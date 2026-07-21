/**
 * `sable` — chancellor's fight (the stage-3 boss). The seal DARKENED.
 *
 * ## The filter — pressed nearly shut
 *
 * The same cell, compressed and dimmed: the rosette pulled toward its own centre
 * and the bounding ring pressed nearly shut on a small radius, a heavy slow
 * press. The wax hardening, the negative space drawn down toward the root — the
 * visual of `sanction`'s DARKENED treatment, its flat-2 pulled to the tonic. It
 * is the **darkest** of the five seals by construction, which is the whole point
 * of a darkening filter.
 *
 * ## Hue — oxblood (R >> G)
 *
 * Deep red-brown, R/G ~3.0 — the most red-dominant of the seals, set against
 * `stratum`'s green-dominant verdigris for the maximum red-vs-green opposition on
 * the stage-3 -> boss cross-fade. It is close in hue to `regnum`'s crimson, but
 * the two never sit adjacent in play (s3 vs s4) and are separated anyway by
 * luminance (sable is the darkest, regnum the richest) and by the most-opposed
 * filter geometries (pressed-shut vs whole-and-filled).
 *
 * ## Clock
 *
 * Driven by `uScroll` only (see `background.ts`, rule 1);
 * `backgrounds/index.test.ts` scans for wall-clock sources.
 *
 * ## Numbers
 *
 * Engraved-union rebuild; figures are the design's derived worst-case [EST], to be
 * replaced by live measurement in acceptance. The pre-rebuild MEASURED peak
 * (0.0444) no longer describes this code.
 *
 *   - Peak luminance ~0.12-0.15 raw [MEASURED-IN-ACCEPTANCE], at the shared
 *     `SEAL_GAIN` 3.6 (the 0.1 ceiling is retired) — still the DARKEST stated seal
 *     by the dim GLOW and the small ring radius (0.20). The tight K=16 strokes on
 *     the darkest field read as lines, not a smear. The arbiter is bullet
 *     readability under a real curtain.
 *   - Device period: subordinate ring train ~112px analytic across the smaller
 *     ring radius; every stroke uses the K=16 cross-section (sigma_f 0.00563 <
 *     0.00625 cyc/px, ~90% of budget; K-ceiling ~17.8) — union-bounded.
 *   - Palette relation R/G ~3.08 off GLOW, unchanged — BASE/GLOW untouched. The
 *     most red-dominant seal. Adjacency to regnum's red separates by luminance,
 *     the most-opposed filter geometries (filled-whole vs pressed-shut), and never
 *     being adjacent in play.
 *   - Motion: eased ratchet, ~130t detent (the slowest of the five), eased over
 *     ~23t (~0.9px/tick) — a heavy slow tick on the small engraving; plus the
 *     continuous `sweep` orbit. [EST, motion-strip in acceptance.]
 *   - Engraved linework studied from pbakaus/radiant radiant-geometry + liquid-gold
 *     (MIT); our GLSL, noise and clocks.
 */

import { BACKGROUND_NOISE_GLSL, SEAL_GLSL, defineBackground } from '../background';

defineBackground('sable', {
  scrollSpeed: 0.6,
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}
${SEAL_GLSL}

    /* Oxblood — deep red-brown, R/G ~3.0, the most red-dominant seal. Set
       against stratum's verdigris; see the header. Dimmest GLOW of the five,
       which is what makes this the darkest scene. */
    const vec3 BASE = vec3(0.016, 0.006, 0.006);
    const vec3 GLOW = vec3(0.080, 0.026, 0.020);

    /* liquid-gold: pressed molten wax, a value RAMP (a few smoothstep stops, no
       glint) — the reference's natural home is a wax seal. Coarse (~135px lobes),
       DOWN-only (max 1.0). Technique studied from pbakaus/radiant liquid-gold
       (MIT); our GLSL, noise, clock. */
    float waxRamp(vec2 uv, float aspect) {
      vec2 p = (uv - vec2(0.5, 0.43)) * vec2(aspect, 1.0);
      float fld = bgFbm(p * 2.4 + uScroll * 0.002);
      float ramp = smoothstep(0.35, 0.45, fld) * 0.4 + smoothstep(0.50, 0.62, fld) * 0.6;
      return mix(0.60, 1.0, ramp);   /* max 1.0 */
    }

    vec3 background(vec2 uv) {
      float aspect = uRes.x / uRes.y;
      float m = sealField(
        uv, aspect, uScroll,
        vec2(0.5, 0.42),   /* centred on the boss station */
        0.20,              /* ring pressed nearly shut, the smallest radius */
        30.0,              /* ring frequency (~134px device period) */
        6.0,               /* six-fold rosette (integer) */
        4.0,               /* arcHalf > PI -> a whole seal */
        0.0,               /* sparse rosette */
        0.0,               /* device bright */
        0.001679,          /* eased ratchet, ~130t detent */
        0.0,               /* no moire */
        4.4,               /* stronger centre falloff: compressed inward */
        2.4,               /* top-lane falloff */
        0.7854             /* raking light from upper-right (PI/4) */
      );
      m *= waxRamp(uv, aspect);   /* <=1 wax value-ramp: peak only falls */
      return BASE + GLOW * m;
    }
  `,
});
