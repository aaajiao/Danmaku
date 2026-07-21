/**
 * `intaglio` — magistrate's fight (the stage-2 boss). The seal INVERTED.
 *
 * ## The filter — figure and ground swapped
 *
 * The same cell, read from its negative. In `signet` the rosette is the bright
 * device against an empty field; here the rosette is the **cut void** and the
 * ground is the **fill** — the reverse-cut die (intaglio) read as the impression
 * it leaves, item by item, with a steady inward read. It rhymes with `docket`'s
 * INVERTED treatment: the same material, turned over.
 *
 * The swap is a single `mix(rosette, 1.0 - rosette, invert)` inside the cell —
 * identity kept, individuality one parameter. Because the angle still only enters
 * `sin` with an integer spoke count, the inverted lobes close across the wrap
 * exactly as the upright ones do.
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
 * MEASURED live (`bun run dev`, scene on the real quad, `__background.name`
 * verified, sprites masked, Rec.709, bloom on); analytic derivations kept.
 *
 *   - Peak luminance 0.063 measured (analytic ceiling ~0.072: Rec.709 of
 *     BASE + GLOW * m_max, m_max ~0.83). The inversion fills the field between
 *     lobes, so the field MEAN sits higher than the sparse seals while the
 *     crest stays modest; both well under 0.1.
 *   - Device period: ring train ~112px analytic (measured 106px on `regnum`).
 *   - Palette relation R/G 1.02 measured masked-mean (1.04 exact off GLOW).
 *     The most neutral seal, between cordon's olive and the reds.
 *   - Rotation ~0.00045 rad/tick (ROT 0.0005 * scrollSpeed 0.9): a steady inward
 *     read, slower than cordon's sweep.
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
        0.0005,            /* steady inward read */
        0.0,               /* no moire */
        3.0,               /* centre falloff */
        2.4                /* top-lane falloff */
      );
      return BASE + GLOW * m;
    }
  `,
});
