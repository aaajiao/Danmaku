/**
 * `cordon` — warden's fight (the stage-2 midboss). The seal TRUNCATED.
 *
 * ## The filter — cut short
 *
 * The same cell as `signet`, but the bounding ring closes only about halfway: a
 * **broken arc**, its two ends fading out, the rosette only partly drawn, swept
 * curtly. A picket line, not a closed seal — the cell cut short to two notes
 * ending on a rest, rhyming with `interdict`'s TRUNCATED treatment. Warden holds
 * a corridor; the seal it presses is a barrier, not a whole device.
 *
 * The arc gate reads a WRAPPED angle, so even though the picket sweeps as the
 * seal turns, `abs()` of the wrapped angle is continuous across the +pi/-pi seam
 * and the arc cannot crack there (the `undertow` flute lesson, applied to the
 * gate rather than the rosette).
 *
 * ## Hue — olive-brass (R ~= G)
 *
 * Deliberately NOT gold-on-indigo. Warden is met over `undertow`'s indigo, and a
 * warm gold seal there would read as the lights coming up. Olive-brass sits at
 * R/G ~0.90 — red and green nearly equal, a desaturated brass — so it separates
 * from the indigo by desaturation and geometry, not by a warm flash. The
 * deliberate move the design calls for: the stage-2 -> boss transition reads as
 * the fight changing gear because the SHAPE and the saturation change, not the
 * temperature.
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
 *   - Peak luminance 0.070 measured along the picket (analytic ceiling ~0.073:
 *     Rec.709 of BASE + GLOW * m_max, m_max ~0.83). Half the field is empty
 *     (the broken arc), so the field mean sits far lower. Under 0.1.
 *   - Device period: ring train ~112px analytic, measured 106px on `regnum`
 *     (the filled member of the family); here the arc envelope dominates,
 *     coarser still. No structure at a bullet's 16-30px.
 *   - Palette relation R/G 0.92 measured masked-mean (0.90 exact off GLOW).
 *     The least saturated of the five seals, by design.
 *   - Arc ~half the ring (arcHalf = PI/2), ends fading; curt sweep at ROT 0.0016
 *     * scrollSpeed 1.0 ~= 0.0016 rad/tick.
 */

import { BACKGROUND_NOISE_GLSL, SEAL_GLSL, defineBackground } from '../background';

defineBackground('cordon', {
  scrollSpeed: 1.0,
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}
${SEAL_GLSL}

    /* Olive-brass, R ~= G (R/G ~0.90) — a desaturated brass, NOT gold. Chosen to
       sit over undertow's indigo without a warm flash; see the header. */
    const vec3 BASE = vec3(0.012, 0.013, 0.006);
    const vec3 GLOW = vec3(0.070, 0.078, 0.030);

    vec3 background(vec2 uv) {
      float m = sealField(
        uv, uRes.x / uRes.y, uScroll,
        vec2(0.5, 0.42),   /* the picket holds the station */
        0.34,              /* bounding ring radius */
        36.0,              /* ring frequency (~112px device period) */
        6.0,               /* six-fold rosette (integer), partly drawn */
        1.5708,            /* arcHalf = PI/2 -> ~half the ring, a broken arc */
        0.0,               /* sparse rosette */
        0.0,               /* device bright */
        0.0016,            /* curt sweep */
        0.0,               /* no moire */
        3.0,               /* centre falloff */
        2.4                /* top-lane falloff */
      );
      return BASE + GLOW * m;
    }
  `,
});
