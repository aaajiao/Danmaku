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
 *   - Peak luminance MEASURED 0.0949 whole-field (field mean 0.0199) after the
 *     acceptance calibration raised the shared-cell gain 0.90 -> 1.50 (the
 *     as-shipped body was imperceptibly different from the old rendering — see
 *     signet.ts and background.ts SEAL_GLSL for the calibration story). The
 *     dropped floor makes the absent half of the picket DEEP BLACK, so "half a
 *     seal" reads as a hard bright arc, not a soft half-blob. Under 0.1 — the
 *     brightest of the five by a hair, at ~95% of the law's ceiling.
 *   - Device period: ring train ~112px analytic, measured 106px on `regnum`; the
 *     lit half of the bounding ring is now the engraved K=16 annulus (FWHM ~94px
 *     analytic, sigma_f 0.00563 < 0.00625 cyc/px, ~90% of budget; K-ceiling ~17.8).
 *     Bullet-band amplitude: signet's measured ratio is 1.2% of the device
 *     amplitude and the shared cell scales linearly, so the family stays an
 *     order down (gain-invariant ratio).
 *   - Palette relation R/G 0.92 measured masked-mean (0.90 exact off GLOW),
 *     unchanged — BASE/GLOW untouched. The least saturated of the five seals.
 *   - Arc ~half the ring (arcHalf = PI/2), ends fading; sweep at ROT 0.0016 *
 *     scrollSpeed 1.0 ~= 0.0016 rad/tick average, now RATCHETED into SEAL_DETENT
 *     (~7.5deg) steps — a curt tick, not a continuous sweep (see SEAL_GLSL motion).
 *     Live frame-diff across detents: worst endpoint luminance step 0.036 (the
 *     arc-END jump the whole-ring invariance proof does not cover; ~1/28 of a
 *     bullet's excursion, once per ~82 ticks. If play shows it distracting, the
 *     remedy is the broken-arc ratchet exemption noted in SEAL_GLSL's motion
 *     comment — continuous rotation for arcHalf < PI).
 *     Broken-arc caveat: unlike a whole seal, cordon's marker is `arc * ring` and
 *     `arc` is rotation-dependent, so each detent steps the lit arc's ENDPOINTS by
 *     one detent (~0.131 rad; at ringRadius 0.34 the endpoint sweeps ~28px). The
 *     ring's RADIAL profile stays invariant, but the ratchet-capture gate (§8.7)
 *     must also inspect the arc-END luminance; if the ~28px endpoint jump reads
 *     near bullets, exempt cordon from the ratchet (continuous path) or coarsen
 *     its detent. PENDING live acceptance.
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
