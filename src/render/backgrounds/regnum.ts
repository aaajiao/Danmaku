/**
 * `regnum` — regent's fight (the stage-4 boss). The seal RESOLVED.
 *
 * ## The filter — made whole and filled
 *
 * The same cell, complete: a whole engraving and a FILLED interior — the disk
 * inside the ring lit too, so this is the **least empty** field of the five (least
 * rest), the seal finally pressed into the empty seat. A reigning turn, slow and
 * full. It rhymes with `interregnum`'s RESOLVED treatment, the cell made whole and
 * resolved to the tonic.
 *
 * The fill is a single `primary = max(primary, ground * fill)` inside the cell:
 * the interior disk is raised so the device reads as a full seal rather than a
 * sparse device. Identity kept; one parameter turned up.
 *
 * ## Hue — crimson (R >> G)
 *
 * Rich red, R/G ~2.56 — set against `vault`'s gold (R/G ~1.4) so the stage-4 ->
 * boss cross-fade reads as heat entering the terminal gold, the fight changing
 * gear. The **fullest** of the five seals — the only one with a filled field, so
 * the least empty (least rest), the resolved register reading fullest by fill and
 * chroma. Note this is fill and saturation, NOT peak luminance: the crimson glow
 * is red-heavy, and red carries the lowest Rec.709 weight (0.2126), so regnum's
 * PEAK sits below the neutral/olive seals (signet, cordon, intaglio) — it is the
 * fourth-brightest crest of the five, above only sable. What the design needs is
 * that it stays clearly brighter than sable's oxblood — its one hue-proximity
 * partner — which it does; the two are further separated by opposed geometry and
 * never sit adjacent in play.
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
 * (0.0769) no longer describes this code.
 *
 *   - Peak luminance ~0.0769 [EST, pre-rebuild; re-measure]. `fill=1` lights the
 *     whole interior disk (`primary = max(primary, ground*fill)`), so regnum reads
 *     as the seal that stays present while its siblings empty out — the least
 *     rest. R6 watch stands: if the high mean reads stage-like (haze), lower the
 *     fill contribution. Under 0.1 is the acceptance bar (shared-GAIN re-measure,
 *     cordon binding).
 *   - Device period: subordinate ring train ~112px analytic; every stroke uses the
 *     K=16 cross-section (sigma_f 0.00563 < 0.00625 cyc/px, ~90% of budget;
 *     K-ceiling ~17.8) — union-bounded, no new frequency.
 *   - Palette relation R/G ~2.56 off GLOW, unchanged — BASE/GLOW untouched.
 *     Adjacency to sable's red is real; the pair separates by luminance, filter
 *     geometry (filled-whole vs pressed-shut), and never being adjacent in play.
 *   - Motion: eased ratchet, ~85t detent, eased over ~15t (~1.3px/tick) — a full
 *     reigning tick on the filled engraving; plus the continuous `sweep` orbit.
 *     [EST, motion-strip in acceptance.]
 *   - Engraved linework studied from pbakaus/radiant radiant-geometry + liquid-gold
 *     (MIT); our GLSL, noise and clocks.
 */

import { BACKGROUND_NOISE_GLSL, SEAL_GLSL, defineBackground } from '../background';

defineBackground('regnum', {
  scrollSpeed: 1.0,
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}
${SEAL_GLSL}

    /* Crimson — rich red, R/G ~2.56. Set against vault's gold; the fullest
       (filled-field) seal, not the brightest-peaked — see the header. */
    const vec3 BASE = vec3(0.020, 0.008, 0.010);
    const vec3 GLOW = vec3(0.115, 0.045, 0.040);

    vec3 background(vec2 uv) {
      float m = sealField(
        uv, uRes.x / uRes.y, uScroll,
        vec2(0.5, 0.42),   /* the seal on the empty seat */
        0.36,              /* full bounding ring */
        36.0,              /* ring frequency (~112px device period) */
        6.0,               /* six-fold rosette (integer) */
        4.0,               /* arcHalf > PI -> a whole seal */
        1.0,               /* FILLED: the ground lights, least rest */
        0.0,               /* device bright */
        0.001541,          /* eased ratchet, ~85t detent */
        0.0,               /* no moire */
        2.8,               /* centre falloff */
        2.4                /* top-lane falloff */
      );
      return BASE + GLOW * m;
    }
  `,
});
