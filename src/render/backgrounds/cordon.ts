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
 * Engraved-union rebuild; figures are the design's derived worst-case [EST], to be
 * replaced by live measurement in acceptance. The pre-rebuild MEASURED peak
 * (0.0949) no longer describes this code.
 *
 *   - Peak luminance ~0.0949 [EST, pre-rebuild; re-measure] — cordon was the
 *     brightest of the family and is **the binding constraint** for the shared
 *     GAIN: every seal must re-measure <0.1, and if any exceeds it the shared GAIN
 *     drops first (see background.ts SEAL_GLSL peak-discipline). The dropped floor
 *     makes the absent half of the picket DEEP BLACK, so "half a seal" reads as a
 *     hard bright arc, not a soft half-blob.
 *   - Device period: subordinate ring train ~112px analytic; the lit half of the
 *     engraving uses the K=16 stroke cross-section (sigma_f 0.00563 < 0.00625
 *     cyc/px, ~90% of budget; K-ceiling ~17.8) — union-bounded, no new frequency.
 *   - Palette relation R/G ~0.90 off GLOW, unchanged — BASE/GLOW untouched. The
 *     least saturated of the five seals.
 *   - Motion: eased ratchet, ~70t detent, eased over ~13t. Because the whole
 *     engraving rotates together and the ease spans ~13 ticks, cordon's broken-arc
 *     ENDPOINT now SWEEPS ~28px over those ~13 ticks (~2.2px/tick) instead of
 *     jumping one detent in a single frame. **The pre-rebuild endpoint-jump
 *     pending note is retired** — the stepped-ease made it a smooth sweep, exactly
 *     as the design intended. Plus the continuous `sweep` orbit. [EST,
 *     motion-strip in acceptance: verify the endpoint sweeps smoothly.]
 *   - Engraved linework studied from pbakaus/radiant radiant-geometry + liquid-gold
 *     (MIT); our GLSL, noise and clocks.
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
        0.001871,          /* eased ratchet, ~70t detent (endpoint sweeps, no jump) */
        0.0,               /* no moire */
        3.0,               /* centre falloff */
        2.4                /* top-lane falloff */
      );
      return BASE + GLOW * m;
    }
  `,
});
