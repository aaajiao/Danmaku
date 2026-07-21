/**
 * `regnum` — regent's fight (the stage-4 boss). The seal RESOLVED.
 *
 * ## The filter — made whole and filled
 *
 * The same cell, complete: a whole bounding ring and a FILLED rosette — the
 * ground between the lobes lit too, so this is the **least empty** field of the
 * five (least rest), the seal finally pressed into the empty seat. A reigning
 * turn, slow and full. It rhymes with `interregnum`'s RESOLVED treatment, the
 * cell made whole and resolved to the tonic.
 *
 * The fill is a single `mix(lobe, max(lobe, 0.7), fill)` inside the cell: the
 * rosette's dark inter-lobe field is raised so the device reads as a full seal
 * rather than a sparse device. Identity kept; one parameter turned up.
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
 * MEASURED live (`bun run dev`, scene on the real quad, `__background.name`
 * verified, sprites masked, Rec.709, bloom on); analytic derivations kept.
 *
 *   - Peak luminance 0.057 measured (analytic ceiling ~0.067: Rec.709 of
 *     BASE + GLOW * m_max, with the fill raising modulation toward its ceiling,
 *     m_max ~0.95 rather than ~0.83). Under 0.1. The measured ordering the
 *     analytic predicted holds: this crest sits BELOW signet (0.068), cordon
 *     (0.070) and intaglio (0.063) — the red-heavy crimson carries the lowest
 *     Rec.709 weight — and above only sable (0.032): regnum is the fullest
 *     (filled-field) seal, not the brightest-peaked.
 *   - Device period 106px measured by radial sinusoid projection inside the
 *     ring (analytic 112px: (2*pi/36)*640 — within 5%, the same margin vault
 *     measures). Bullet-band (16-30px) amplitude is 12% of the dominant
 *     structure: an order of magnitude down.
 *   - Palette relation R/G 2.53 measured masked-mean (2.56 exact off GLOW).
 *     Measured adjacency to sable's 2.56 mean is real; the pair separates by
 *     luminance (0.057 vs 0.032), filter geometry (filled-whole vs
 *     pressed-shut), and never being adjacent in play — see sable's header.
 *   - Rotation ~0.0012 rad/tick (ROT 0.0012 * scrollSpeed 1.0): a full reigning
 *     turn, faster than the earlier seals but still a turn, not a spin.
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
        0.0012,            /* reigning turn */
        0.0,               /* no moire */
        2.8,               /* centre falloff */
        2.4                /* top-lane falloff */
      );
      return BASE + GLOW * m;
    }
  `,
});
