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
 * MEASURED live (`bun run dev`, scene on the real quad, `__background.name`
 * verified, sprites masked, Rec.709, bloom on); analytic derivations kept.
 *
 *   - Peak luminance MEASURED 0.0444 whole-field (field mean 0.0142), still the
 *     DARKEST stated seal, after the acceptance calibration raised the
 *     shared-cell gain 0.90 -> 1.50 (see signet.ts / background.ts SEAL_GLSL).
 *     The tight K=16 ring on the darkest field reads as a line, not a smear.
 *     R2 (ring-below-visibility watch) RESOLVED by the shared calibration — no
 *     per-scene GLOW.R exception was needed. Well under 0.1.
 *   - Device period: ring train ~112px analytic (measured 106px on `regnum`),
 *     read across a smaller ring radius (0.22); the tight bounding ring is now
 *     the engraved K=16 annulus (FWHM ~94px analytic, sigma_f 0.00563 < 0.00625
 *     cyc/px, ~90% of budget; K-ceiling ~17.8). Bullet-band amplitude: signet's
 *     measured ratio is 1.2% of the device amplitude and the shared cell scales
 *     linearly (gain-invariant ratio).
 *   - Palette relation R/G 2.56 measured masked-mean (3.08 exact off GLOW; the
 *     dark field mean dilutes toward the base's 2.67). The most red-dominant
 *     seal at the pixel it glows. Measured adjacency to regnum's 2.53 is real —
 *     the pair is separated by luminance (pre-inversion 0.057 vs 0.032, a 1.8x
 *     step; measured 0.0769 vs 0.0444 after calibration, a 1.7x step), by the
 *     most-opposed filter geometries (filled-whole vs pressed-shut), and by
 *     never being adjacent in play, exactly as designed.
 *   - Rotation ~0.00018 rad/tick average (ROT 0.0003 * scrollSpeed 0.6), the
 *     slowest of the five, now RATCHETED into SEAL_DETENT (~7.5deg) steps — a
 *     heavy slow tick, not a continuous press (see SEAL_GLSL motion).
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

    vec3 background(vec2 uv) {
      float m = sealField(
        uv, uRes.x / uRes.y, uScroll,
        vec2(0.5, 0.42),   /* centred on the boss station */
        0.22,              /* ring pressed nearly shut, small radius */
        36.0,              /* ring frequency (~112px device period) */
        6.0,               /* six-fold rosette (integer) */
        4.0,               /* arcHalf > PI -> a whole seal */
        0.0,               /* sparse rosette */
        0.0,               /* device bright */
        0.0003,            /* heavy slow press */
        0.0,               /* no moire */
        4.2,               /* stronger centre falloff: compressed inward */
        2.4                /* top-lane falloff */
      );
      return BASE + GLOW * m;
    }
  `,
});
