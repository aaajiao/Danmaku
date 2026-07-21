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
 * ## The quantized floor — 出神 dither
 *
 * `decree` and `umbra` add one line, `m = sealDither(m, uv, uScroll)`, that
 * separates the 出神 pair from the five stated seals: the substrate visibly loses
 * bit depth (the visual twin of `fiat`'s dissolving cell). Legal by construction,
 * not by tuning — coarse cells (>=12 GAME px, the named `SEAL_DITHER_CELL`),
 * DOWN-only (`min(m, q)` only removes light, so the seal -> 出神 threshold is
 * crossed by coherence/motion, never luminance), DARK zones only (masked to
 * m < ~0.4, the bright ring stays smooth), traveling level wave on `uScroll`
 * (rule 1). Bullet-band safety is AMPLITUDE not period: the 12px cell overlaps the
 * band in period, so on this <=0.039 field the dark-zone posterization steps are
 * ~1.4% of a bullet's excursion. Highest-risk element of the round, gated on
 * `test:density` — gate PENDING live acceptance; the fallback raises
 * `SEAL_DITHER_CELL` 12 -> 16 and floors `SEAL_DITHER_MIN_LEVELS` at 3.0, each a
 * one-line change. (The moiré floor in the shared cell is 0.45, keeping the pair
 * clearly dimmer than the stated seals.)
 *
 * ## Motion — continuous drift, NO ratchet
 *
 * The stated seals ratchet their rotation (入神); the 出神 pair deliberately does
 * not. `decree` carries `moireFreq > 0`, so the shared cell's ratchet branch takes
 * the CONTINUOUS rotation path automatically — the 出神 signature is continuous
 * drift + precession + the bit-depth wave, not a tick.
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
 *   - Peak luminance ~0.0392 [EST, pre-rebuild; re-measure]. Below regnum's
 *     pre-rebuild 0.0769 — the 出神 pair sits at the bottom of the family with its
 *     parent doctrine intact (decree < regnum). The moiré, down-only dither AND the
 *     new §6 vortex `pull` (all <= 1) multiply the calibrated cell back down; the
 *     Bayer field is plainly visible in a still, which is the point. Re-measure in
 *     acceptance since the engraved union raises coverage before those multipliers.
 *   - Device period: subordinate ring train ~112px analytic.
 *   - Moire beat ~620px analytic ((2*pi/|42.48-36|)*640), one beat across the
 *     field, far coarser than the ring; the swim shares umbra's construction.
 *   - §6 vortex recession: a log-spiral `pull` (integer arm count 3, geometry-only,
 *     <= 1) adds a second unmooring MEANING (被拽出画框) beside the dither. First to
 *     revert if a readability gate complains.
 *   - Palette relation R/G ~1.40 off GLOW. Regnum's crimson bleached toward cold
 *     rose-grey.
 *   - Precession: centre circles at radius ~0.05 uv (~32px) at ~0.004 rad per
 *     scroll unit — the device adrift and unfilled.
 */

import { BACKGROUND_NOISE_GLSL, SEAL_GLSL, defineBackground } from '../background';

defineBackground('decree', {
  scrollSpeed: 1.2,
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}
${SEAL_GLSL}

    /* Bleached rose (hue ~341) — regnum's crimson drained of its heat toward a
       cold rose as the seal dissolves. See the header. */
    const vec3 BASE = vec3(0.014, 0.010, 0.012);
    const vec3 GLOW = vec3(0.078, 0.040, 0.052);

    vec3 background(vec2 uv) {
      /* The device drifts off-station and precesses, unfilled. sin/cos of
         uScroll only — ticks, no wall clock. */
      vec2 centre = vec2(0.5, 0.42)
        + 0.05 * vec2(cos(uScroll * 0.004), sin(uScroll * 0.004));

      float m = sealField(
        uv, uRes.x / uRes.y, uScroll,
        centre,            /* drifting, precessing */
        0.30,              /* bounding ring radius (spread) */
        36.0,              /* ring frequency (~112px device period) */
        6.0,               /* six-fold rosette (integer, untouched) */
        4.0,               /* arcHalf > PI -> whole ring, but the fill is gone */
        0.0,               /* the fill DRAINED: a bare drifting ring, not regnum's fill */
        0.0,               /* device bright */
        0.0010,            /* the reigning turn, now unanchored */
        42.48,             /* second radial ring: 36 * 1.18, RADIAL-only detune */
        2.8,               /* centre falloff */
        2.4,               /* top-lane falloff */
        uScroll * 0.003    /* raking light DRIFTS: the light itself comes unmoored */
      );

      /* 出神: the substrate losing bit depth. Coarse ordered dither, DOWN-only
         (min -> never brighter), dark zones only, a traveling level wave —
         coherence motion with the luminance ceiling unchanged. uScroll clock. */
      m = sealDither(m, uv, uScroll);

      /* 出神 second vocabulary — vortex recession (被拽出画框): a log-spiral pull,
         a second unmooring MEANING beside dither's bit-depth loss. Integer arm
         count (3) closes the atan wrap; pull <= 1, so it only ever multiplies the
         peak-bounded structure DOWN — never-brighter preserved, geometry only.
         First to revert if a readability gate complains. */
      vec2 cc = (uv - centre) * vec2(uRes.x / uRes.y, 1.0);
      float spa = atan(cc.y, cc.x) + log(max(length(cc), 0.03)) * 1.5;
      float pull = 0.6 + 0.4 * (0.5 + 0.5 * sin(3.0 * spa - uScroll * 0.05));

      return BASE + GLOW * m * pull;
    }
  `,
});
