/**
 * `decree` — chancellor's "Sealed" AND regent's "Sine Die" (both Lunatic only).
 * The seal UNMOORED and DRAINING. SHARED by both cards.
 *
 * ## One scene for two cards, exactly as one track for two
 *
 * `fiat` is a single music track sounded by both the chancellor's "Sealed" and
 * the regent's "Sine Die" — the whole cell dissolving, locrian. `decree` is the
 * visual of that shared track: one scene both fiat cards name, the tighter rhyme
 * (one track <-> one scene, chancellor + regent sharing both). This MOVES "Sine
 * Die" off `vault` — the trade the design accepted: it loses "drains to the gold
 * of the empty seat" and gains the shared-fiat rhyme. `vault` stays the stage-4
 * scene, so it is still declared and reachable.
 *
 * ## The filter — the fill draining out
 *
 * The `regnum` cell coming apart: its FILLED rosette DRAINS, the device thinning
 * to a bare drifting ring, off-station and precessing, with the same RADIAL-only
 * moiré swimming through it. The court decreeing without a device — authority
 * with nothing left to press.
 *
 * ## Bounded by the seal budget — the hard rule
 *
 * As with `umbra`: the 出神 threshold is crossed by coherence and motion, never
 * luminance. The moiré is RADIAL-ONLY (non-integer detune safe on `r`, no crack;
 * beat far longer than either ring; angular spokes stay INTEGER 6) and only
 * multiplies down. `decree` is bounded by the seal FAMILY's readability budget
 * (peak well under 0.1) — the doctrine that protects the fullest screen — not by
 * each fight's own seal. It stays below `regnum` (measured 0.057), the seal its
 * crimson is bleached from and which it shares with the regent. But `decree` is
 * ONE scene serving TWO fights: in the chancellor fight the other seal is
 * `sable`, the DARKEST of the five (measured 0.032), and a single shared scene
 * cannot be dimmer than both a 0.057 and a 0.032 seal at once — so against
 * sable, `decree` (measured 0.038) sits brighter. This does not break the doctrine: the 出神 threshold there is
 * still crossed by coherence and motion, and readability holds because the peak
 * stays far under the 0.1 ceiling. Splitting `decree` into a second, dimmed
 * variant for the chancellor was rejected to keep the shared-fiat rhyme (one track
 * <-> one scene), exactly as the design chose.
 *
 * ## Hue — crimson bleached toward cold rose-grey
 *
 * Regnum's crimson drained of its heat, R/G ~1.4 — a cold rose-grey, the red
 * bleaching out as the seal dissolves. Cooler and dimmer than the resolved seal
 * it comes apart from.
 *
 * ## Clock
 *
 * Driven by `uScroll` only (see `background.ts`, rule 1); drift and precession
 * are `sin`/`cos` of `uScroll`. `backgrounds/index.test.ts` scans for wall-clock
 * sources.
 *
 * ## Numbers
 *
 * MEASURED live (`bun run dev`, scene on the real quad, `__background.name`
 * verified, sprites masked, Rec.709, bloom on); analytic derivations kept. The
 * shared-card wiring (chancellor "Sealed" + regent "Sine Die") is content,
 * verified in base-pack.json.
 *
 *   - Peak luminance 0.038 measured: below regnum's measured 0.057, above
 *     sable's 0.032 — exactly the family-budget doctrine above (analytic
 *     ceiling ~0.05: Rec.709 of BASE + GLOW * m_max with the fill drained and
 *     the moiré pulling down; base_lum ~0.0110, glow_lum ~0.0546).
 *   - Device period: ring train ~112px analytic (measured 106px on `regnum`).
 *   - Moire beat ~620px analytic ((2*pi/|42.48-36|)*640), one beat across the
 *     field, far coarser than the ring; the swim was motion-verified on the
 *     sibling `umbra` (same moiré construction — see its header).
 *   - Palette relation R/G 1.38 measured masked-mean (1.40 exact off GLOW).
 *     Regnum's crimson bleached toward cold rose-grey.
 *   - Precession: centre circles at radius ~0.05 uv (~32px) at ~0.004 rad per
 *     scroll unit — the device adrift and unfilled.
 */

import { BACKGROUND_NOISE_GLSL, SEAL_GLSL, defineBackground } from '../background';

defineBackground('decree', {
  scrollSpeed: 1.2,
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}
${SEAL_GLSL}

    /* Crimson bleached toward cold rose-grey, R/G ~1.4 — regnum's red drained of
       heat as the seal dissolves. See the header. */
    const vec3 BASE = vec3(0.014, 0.010, 0.012);
    const vec3 GLOW = vec3(0.070, 0.050, 0.055);

    vec3 background(vec2 uv) {
      /* The device drifts off-station and precesses, unfilled. sin/cos of
         uScroll only — ticks, no wall clock. */
      vec2 centre = vec2(0.5, 0.42)
        + 0.05 * vec2(cos(uScroll * 0.004), sin(uScroll * 0.004));

      float m = sealField(
        uv, uRes.x / uRes.y, uScroll,
        centre,            /* drifting, precessing */
        0.34,              /* bounding ring radius */
        36.0,              /* ring frequency (~112px device period) */
        6.0,               /* six-fold rosette (integer, untouched) */
        4.0,               /* arcHalf > PI -> whole ring, but the fill is gone */
        0.0,               /* the fill DRAINED: a bare drifting ring, not regnum's fill */
        0.0,               /* device bright */
        0.0010,            /* the reigning turn, now unanchored */
        42.48,             /* second radial ring: 36 * 1.18, RADIAL-only detune */
        2.8,               /* centre falloff */
        2.4                /* top-lane falloff */
      );

      return BASE + GLOW * m;
    }
  `,
});
