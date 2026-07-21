/**
 * `umbra` — sentinel's "Total Eclipse" (Lunatic only). The seal UNMOORED.
 *
 * ## The filter — the floor removed
 *
 * The `signet` cell with its floor taken away. The seal DRIFTS off the boss's
 * station and precesses, and a SECOND concentric ring beats against the first
 * into a slow RADIAL moiré that swims, with a slow eclipse-shadow crossing over
 * it. It is the STATED cell losing its floor — the visual counterpart of
 * `zenith` (nemesis unmoored, whole-tone, detuned). Reached only on the Lunatic
 * path, where the card also swaps music to `zenith`.
 *
 * ## Never brighter — the hard rule
 *
 * The threshold from a seal to a 出神 scene is crossed by COHERENCE and MOTION,
 * NEVER by luminance. Breaking readability at the fullest screen would betray the
 * whole doctrine, so peak luminance stays at/below the `signet` budget. Two
 * guarantees make that structural, not a tuning:
 *
 *   - The moiré is RADIAL-ONLY. `r` carries no `atan` wrap, so the non-integer
 *     detune (ringFreq * 1.18) is safe — no crack — and its beat period is far
 *     longer than either ring, coarser than a bullet by construction. The
 *     angular spokes stay INTEGER (6), untouched.
 *   - The moiré and the eclipse only ever MULTIPLY the structure down (both are
 *     <= 1; the moiré floor is 0.45 in the shared cell, keeping the unmoored pair
 *     clearly dimmer than the stated seals), so coherence swims and shadow
 *     crosses while the glow never rises above the seal it came from. `umbra` is
 *     if anything darker than `signet`.
 *
 * ## The quantized floor — 出神 dither
 *
 * `umbra` and `decree` add one line, `m = sealDither(m, uv, uScroll)`, that
 * separates the 出神 pair from the five stated seals as well as from the stages:
 * the substrate visibly loses bit depth (the visual twin of `zenith`'s detune).
 * It is legal by construction, not by tuning — coarse cells (>=12 GAME px, a
 * named `SEAL_DITHER_CELL` constant), DOWN-only (`min(m, q)` can only remove
 * light, so the seal -> 出神 threshold is crossed by coherence/motion, never
 * luminance), DARK zones only (a mask confines it to m < ~0.4, so the bright ring
 * stays smooth and the largest steps land on the lowest luminance), and a
 * traveling level wave clocked on `uScroll` (rule 1). Its bullet-band safety is
 * AMPLITUDE, not period: the 12px cell overlaps the band in period, so on this
 * <=0.041 field the dark-zone posterization steps are ~1.4% of a bullet's
 * excursion. This is the round's highest-risk element and is gated on
 * `test:density` (a single bullet stays findable; the dither must not read as
 * sparse bullets) — gate PENDING live acceptance; the fallback raises
 * `SEAL_DITHER_CELL` 12 -> 16 and floors `SEAL_DITHER_MIN_LEVELS` at 3.0, each a
 * one-line change.
 *
 * ## Motion — continuous drift, NO ratchet
 *
 * The stated seals ratchet their rotation (入神, the mechanism ticking); the 出神
 * pair deliberately does NOT — a ticking mechanism that is simultaneously
 * unmooring would be self-contradictory. `umbra` carries `moireFreq > 0`, so the
 * shared cell's ratchet branch selects the CONTINUOUS rotation path automatically;
 * the 出神 motion signature is continuous drift + precession + the bit-depth wave.
 *
 * ## Hue — gold cooled
 *
 * Signet's gold desaturated toward neutral, R/G ~1.07 — the warmth draining as
 * the seal comes unmoored. Cooler and dimmer than the stated cell it drifts from.
 *
 * ## Clock
 *
 * Driven by `uScroll` only (see `background.ts`, rule 1); the drift and
 * precession are `sin`/`cos` of `uScroll`, never a wall clock.
 * `backgrounds/index.test.ts` scans for wall-clock sources.
 *
 * ## Numbers
 *
 * MEASURED live (`bun run dev`, scene on the real quad, `__background.name`
 * verified, sprites masked, Rec.709, bloom on) — and entered in its genuine
 * consumer: `__background.name === 'umbra'` polled twice inside a live Lunatic
 * "Total Eclipse", the same card that swaps the music to `zenith`.
 *
 *   - Peak luminance MEASURED 0.0314 whole-field (field mean 0.0143) after the
 *     acceptance calibration raised the shared-cell gain 0.90 -> 1.50 (see
 *     signet.ts / background.ts SEAL_GLSL). The never-brighter doctrine binds
 *     umbra to its PARENT seal, signet, not to its own prior value: measured
 *     0.0314 < signet's measured 0.0926 ✓ with wide margin — the eclipse, moiré
 *     and down-only dither multipliers pull the calibrated cell far back down.
 *     Live frame-diff over 1.5s: bit-depth wave travels with per-pixel steps
 *     <= 0.017, mean 0.0009 — coherence motion, luminance ceiling unchanged.
 *   - Device period: ring train ~112px analytic, unchanged from signet
 *     (measured 106px on `regnum`, the family instrument).
 *   - Moire beat ~620px analytic ((2*pi/|42.48-36|)*640), one beat across the
 *     field. Its MOTION is the measured claim: the detrended radial profile
 *     captured 2s apart decorrelates at zero shift (corr -0.46) and realigns at
 *     an inward shift of ~60 game px (corr 0.78) — the pattern swims, coherence
 *     moves while luminance does not.
 *   - Palette relation R/G 1.02 measured masked-mean (1.07 exact off GLOW).
 *     Signet's gold cooled toward neutral.
 *   - Precession: the centre circles at radius ~0.05 uv (~32px) at ~0.004 rad per
 *     scroll unit — off-station and slowly turning, the seal adrift.
 */

import { BACKGROUND_NOISE_GLSL, SEAL_GLSL, defineBackground } from '../background';

defineBackground('umbra', {
  scrollSpeed: 1.1,
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}
${SEAL_GLSL}

    /* Signet's gold cooled toward neutral, R/G ~1.07 — the warmth draining as
       the seal comes unmoored. See the header. */
    const vec3 BASE = vec3(0.010, 0.010, 0.012);
    const vec3 GLOW = vec3(0.062, 0.058, 0.052);

    vec3 background(vec2 uv) {
      /* The seal drifts off-station and precesses. sin/cos of uScroll only —
         a pure function of ticks, no wall clock. */
      vec2 centre = vec2(0.5, 0.42)
        + 0.05 * vec2(cos(uScroll * 0.004), sin(uScroll * 0.004));

      float m = sealField(
        uv, uRes.x / uRes.y, uScroll,
        centre,            /* drifting, precessing */
        0.34,              /* bounding ring radius */
        36.0,              /* ring frequency (~112px device period) */
        6.0,               /* six-fold rosette (integer, untouched) */
        4.0,               /* arcHalf > PI -> whole seal, just adrift */
        0.0,               /* sparse rosette */
        0.0,               /* device bright */
        0.0006,            /* the calm turn continues, now unanchored */
        42.48,             /* second radial ring: 36 * 1.18, RADIAL-only detune */
        3.0,               /* centre falloff */
        2.4                /* top-lane falloff */
      );

      /* 出神: the substrate losing bit depth. Coarse ordered dither, DOWN-only
         (min -> never brighter), dark zones only, a traveling level wave —
         coherence motion with the luminance ceiling unchanged. uScroll clock. */
      m = sealDither(m, uv, uScroll);

      /* A slow eclipse-shadow crossing: a soft dark band swept by uScroll across
         the field. It only ever multiplies down (0.55..1), so luminance cannot
         rise above the seal — coherence and shadow cross, brightness does not. */
      float eclipse = 0.55 + 0.45 * (0.5 + 0.5 * sin(uScroll * 0.0025 - uv.y * 3.0));

      return BASE + GLOW * m * eclipse;
    }
  `,
});
