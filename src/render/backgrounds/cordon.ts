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
 *   - Peak luminance ~0.22-0.24 raw [MEASURED-IN-ACCEPTANCE], at the shared
 *     `SEAL_GAIN` 3.6. cordon is still **the binding constraint** of the family
 *     (chartreuse is luminance-expensive): if any seal reads too hot under a real
 *     curtain the shared gain drops first, and cordon's G desaturates next (see
 *     background.ts SEAL_GLSL). The dropped floor makes the absent half of the
 *     picket DEEP BLACK, so "half a seal" reads as a hard bright arc, not a blob.
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

    /* Olive-chartreuse, toward green (hue ~74) — a barrier of quantized force,
       NOT gold. G held at 0.078 (chartreuse is luminance-expensive; see header)
       so cordon, the binding seal, stays under the ceiling. */
    const vec3 BASE = vec3(0.012, 0.013, 0.006);
    const vec3 GLOW = vec3(0.058, 0.078, 0.026);

    /* A banded confocal field under the broken picket — a barrier that reads as a
       force diagram. DOWN-only (max 1.0), a value-ramp banding in the liquid-gold /
       dither family (the user-given refs). The seal centre stays PINNED at
       (0.5,0.42) so the boss-station void does not move; the band field gets its
       OWN internal pole offset here. Our GLSL, noise, clock. */
    float fieldLines(vec2 uv, float aspect) {
      vec2 c = (uv - vec2(0.50, 0.40)) * vec2(aspect, 1.0);          /* internal to the ornament */
      float R = length(c - vec2(0.0, 0.16)) + length(c + vec2(0.0, 0.16)); /* confocal coord */
      const float SP = 0.16;                                        /* ~102px band spacing */
      float s = abs(R - floor(R / SP + 0.5) * SP) / SP;
      float line = 1.0 - smoothstep(0.0, 0.45, s);                  /* BROAD soft band */
      /* DENSITY-GATE FALLBACK (test:density): if the confocal lines read as
         bullets, replace the two lines above with soft dipole LOBES (drops the
         quantized banding, keeps the two-pole placement):
           float line = exp(-6.0 * min(length(c - vec2(0.0,0.16)),
                                        length(c + vec2(0.0,0.16)))); */
      float pulse = 0.9 + 0.1 * sin(R * 6.0 - uScroll * 0.03);      /* coherence motion only */
      return mix(0.82, 1.0, line * pulse);                         /* gaps dim to .82, lines max 1.0 */
    }

    vec3 background(vec2 uv) {
      float aspect = uRes.x / uRes.y;
      float m = sealField(
        uv, aspect, uScroll,
        vec2(0.5, 0.42),   /* the picket holds the station (void PINNED) */
        0.30,              /* bounding ring radius (spread: smaller) */
        30.0,              /* ring frequency (~134px device period) */
        6.0,               /* six-fold rosette (integer), partly drawn */
        1.5708,            /* arcHalf = PI/2 -> ~half the ring, a broken arc */
        0.0,               /* sparse rosette */
        0.0,               /* device bright */
        0.001871,          /* eased ratchet, ~70t detent (endpoint sweeps, no jump) */
        0.0,               /* no moire */
        3.0,               /* centre falloff */
        2.4,               /* top-lane falloff */
        3.9270             /* raking light from lower-left (5*PI/4) */
      );
      m *= fieldLines(uv, aspect);   /* <=1 material multiply: peak only falls */
      return BASE + GLOW * m;
    }
  `,
});
