/**
 * `intaglio` — magistrate's fight (the stage-2 boss). The seal INVERTED.
 *
 * ## The filter — figure and ground swapped
 *
 * The same cell, read from its negative. In `signet` the engraved linework is the
 * bright device against an empty field; here the linework is the **cut void** and
 * the interior disk is the **lit ground** — the reverse-cut die (intaglio) read as
 * the impression it leaves, with a steady inward read. It rhymes with `docket`'s
 * INVERTED treatment: the same material, turned over.
 *
 * The swap is a single `mix(lit_, cut_, invert)` inside the cell — identity kept,
 * individuality one parameter. Because the rays are integer-folded and the
 * hexagram is a signed distance, the inverted linework closes across the wrap
 * exactly as the upright device does.
 *
 * ## Hue — bone / desaturated
 *
 * Magistrate is also met over `undertow`'s indigo, and like `cordon` it must not
 * light the indigo up. Bone is a pale desaturated near-neutral, R/G ~1.04 — the
 * three channels close together, the colour of old paper and worn ivory. It
 * reads against the indigo by desaturation, the deliberate second seal over the
 * same stage that refuses the gold-on-indigo flash.
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
 * (0.0899) no longer describes this code.
 *
 *   - Peak luminance ~0.0899 [EST, pre-rebuild; re-measure]. Now the `invert=1`
 *     swap makes the engraved LINEWORK the dark CUTS in a lit interior disk (the
 *     incised die), the lines TRUE black; figure/ground reads clearly. Under 0.1
 *     is the acceptance bar, subject to the shared-GAIN re-measure (cordon binding).
 *   - Device period: subordinate ring train ~112px analytic; every stroke uses the
 *     K=16 cross-section (sigma_f 0.00563 < 0.00625 cyc/px, ~90% of budget;
 *     K-ceiling ~17.8) — union-bounded, no new frequency.
 *   - Palette relation R/G ~1.04 off GLOW, unchanged — BASE/GLOW untouched. The
 *     most neutral seal.
 *   - Motion: eased ratchet, ~95t detent, eased over ~17t (~1.2px/tick) — a
 *     visible tick on the incised engraving; plus the continuous `sweep` orbit.
 *     [EST, motion-strip in acceptance.]
 *   - Engraved linework studied from pbakaus/radiant radiant-geometry + liquid-gold
 *     (MIT); our GLSL, noise and clocks.
 */

import { BACKGROUND_NOISE_GLSL, SEAL_GLSL, defineBackground } from '../background';

defineBackground('intaglio', {
  scrollSpeed: 0.9,
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}
${SEAL_GLSL}

    /* Bone — pale, desaturated, R/G ~1.04, the three channels close. The
       negative of the cut die; see the header. */
    const vec3 BASE = vec3(0.012, 0.012, 0.011);
    const vec3 GLOW = vec3(0.075, 0.072, 0.060);

    vec3 background(vec2 uv) {
      float m = sealField(
        uv, uRes.x / uRes.y, uScroll,
        vec2(0.5, 0.42),   /* centred on the boss station */
        0.34,              /* bounding ring radius */
        36.0,              /* ring frequency (~112px device period) */
        6.0,               /* six-fold rosette (integer) */
        4.0,               /* arcHalf > PI -> a whole seal */
        0.0,               /* no extra fill; inversion supplies the ground */
        1.0,               /* INVERTED: the rosette is the cut void */
        0.001532,          /* eased ratchet, ~95t detent */
        0.0,               /* no moire */
        3.0,               /* centre falloff */
        2.4                /* top-lane falloff */
      );
      return BASE + GLOW * m;
    }
  `,
});
