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
 *   - Peak luminance ~0.22-0.24 raw [MEASURED-IN-ACCEPTANCE], at the shared
 *     `SEAL_GAIN` 3.6 (the 0.1 ceiling is retired). The `invert=1` swap makes the
 *     engraved LINEWORK the dark CUTS in a lit interior disk (the incised die), the
 *     lines TRUE black; figure/ground reads clearly. The arbiter is bullet
 *     readability under a real curtain (cordon is the binding seal).
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

    /* Cool-ivory near-neutral (hue ~210, leaning cool for wheel spread) — the
       grid's one desaturated anchor, the three channels close with B just ahead.
       The negative of the cut die; see the header. */
    const vec3 BASE = vec3(0.012, 0.012, 0.013);
    const vec3 GLOW = vec3(0.066, 0.070, 0.078);

    /* ink-dissolve: the lit interior reads as wet ink pooling in the incised die.
       Coarse organic threshold (~150px lobes), DOWN-only (max 1.0). Technique
       studied from pbakaus/radiant ink-dissolve (MIT); our GLSL, noise, clock. */
    float inkGround(vec2 uv, float aspect) {
      vec2 p = (uv - vec2(0.5, 0.44)) * vec2(aspect, 1.0);
      float q = bgFbm(p * 2.0 + uScroll * 0.003);
      float field = bgFbm(p * 2.0 + 2.2 * q);          /* ~150px, wide boundary */
      return mix(0.70, 1.0, smoothstep(-0.15, 0.15, field));  /* max 1.0 */
    }

    vec3 background(vec2 uv) {
      float aspect = uRes.x / uRes.y;
      float m = sealField(
        uv, aspect, uScroll,
        vec2(0.5, 0.42),   /* centred on the boss station */
        0.38,              /* bounding ring radius (spread: the largest) */
        40.0,              /* ring frequency (~100px device period) */
        6.0,               /* six-fold rosette (integer) */
        4.0,               /* arcHalf > PI -> a whole seal */
        0.0,               /* no extra fill; inversion supplies the ground */
        1.0,               /* INVERTED: the rosette is the cut void */
        0.001532,          /* eased ratchet, ~95t detent */
        0.0,               /* no moire */
        3.0,               /* centre falloff */
        2.4,               /* top-lane falloff */
        0.0                /* raking light from the right */
      );
      m *= inkGround(uv, aspect);   /* <=1 wet-ink ground: peak only falls */
      return BASE + GLOW * m;
    }
  `,
});
