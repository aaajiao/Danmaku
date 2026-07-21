/**
 * `vault` — stage 4, the bottom of the descent. A gold LOG-SPIRAL winding inward
 * toward a dark central oculus — the pull into the empty seat the whole apparatus
 * was built over (被拽出画框, the pull into the void).
 *
 * ## The vortex, the fourth of four spaces, distinct from all three priors
 *
 * `expanse` is an open plane converging on a horizon; `undertow` is a forward
 * shaft; `stratum` is horizontal bands settling downward. This is none of them:
 * it is a **vortex**, and it RECEDES — the spiral arms wind into the oculus, the
 * biggest motion delta in the game placed where the terminal descent needs it
 * most. This replaces the pre-rebuild in-place coffered dome (the game's most
 * static scene); the spiral is the loud, identity-correct answer to the terminal
 * pull into the boss station/void.
 *
 * There is deliberately **no perspective divide** here — no `depth = SCALE / r`,
 * the trick `undertow` leans on. A projection running to infinity samples noise
 * faster than the pixel grid can carry, which is the run-to-infinity aliasing
 * both perspective scenes have to decay their structure to fight. This scene has
 * no vanishing point: `r` and the angle are read straight (the log-spiral offsets
 * the angle by `log(r)*PITCH`), so that class of seam never arises. The vortex's
 * own tight centre (r -> 0.03, arm spacing narrowing) is the analogue of that
 * aliasing, and it is killed the same way — see the crowded-zones section.
 *
 * ## Structure — a spiral, coarse by an order of magnitude
 *
 * - Arms: `sin(ARM_COUNT * (angle + log(r)*PITCH) - uScroll*SWIRL_RATE)` with
 *   `ARM_COUNT` an **integer** (3), so the arms stay a-periodic across the atan
 *   wrap and no crack runs out of the centre — the `undertow` flute lesson. Arm
 *   spacing is ~200px mid-field (PITCH 1.7). Subtracting `uScroll*SWIRL_RATE`
 *   winds the arms inward: the recession-pull.
 * - Rings: `sin((r + uScroll*CONTRACT_RATE) * RING_FREQ)`, the faint contracting
 *   radial ring kept for the dome read.
 * - Grain is sampled against the arm value, never the raw angle, so nothing can
 *   crack along the ray where `atan` wraps.
 *
 * ## The two crowded zones stay smooth and dark
 *
 * Two zones are where bullets crowd: the **central oculus**, where the Regent
 * stations, and the **top entry lane**, where trash enters. Detail decays faster
 * than glow toward *both* — `nearC * nearC` on the radial axis toward the centre
 * and `nearTop * nearTop` on the vertical toward the top — so the finest arms
 * have dissolved into a smooth dark well before they reach where bullets form.
 * The tight vortex centre (detail = nearC^2 ~= 0.013 at r -> 0.03) is suppressed
 * to ~1% structure there — **this centre-decay is the load-bearing safety, verify
 * it in `test:density`**. The oculus itself darkens toward zero: the empty seat
 * reads as absence, and
 * the dense zone is a smooth dark backdrop the amber-tinted boss sprite reads
 * cleanly against. Same doctrine as the three scenes before it, on two axes at
 * once.
 *
 * ## Palette — dim gold / amber
 *
 * The colour of the seal, of wax and brass, of authority itself. It reads
 * R > G > B with G about 0.7 of R — a clear yellow-gold at R/G near 1.4. It is
 * the fourth of four stage scenes chosen to occupy four hue quadrants and four
 * geometry families, no two mistaken for each other: `expanse` cyan-ice / horizon
 * line (R/G ~0.37 post-graft), `undertow` indigo / vanishing point (B-high),
 * `stratum` verdigris / flat bands (G-dominant), this one gold / spiral vortex
 * (R/G ~1.4) — the only scene that winds inward. And it sits clear of the RED
 * of the seal its own boss stamps: the regent's `regnum` (crimson, R/G ~2.56) is
 * heat entering the terminal gold, so the stage-4 -> boss transition reads as the
 * fight changing gear, not the lights coming up. (`surge`'s red, R/G ~3, holds
 * the same relation, but that comparandum is pack-only now — the base game no
 * longer cross-fades to it.) It reads *terminal*.
 *
 * The regent's "Sine Die" no longer drains to this gold (it takes the shared
 * 出神 scene `decree` now), but `vault` remains the stage-4 scene, so it is still
 * declared and reachable.
 *
 * ## Clock
 *
 * Driven by `uScroll` only, which advances in `step()` and nowhere else. No
 * `performance.now`, no wall clock — a pure function of accumulated ticks, so a
 * replay looks identical twice (see `background.ts`, rule 1).
 * `backgrounds/index.test.ts` scans this file for wall-clock sources.
 *
 * ## Numbers
 *
 * The vortex-spiral rebuild (§4.4) replaced the in-place coffers; figures are
 * design-derived [EST], to be re-measured in acceptance (`__background.name ===
 * 'vault'` verified BEFORE reading a pixel, the stage-3 lesson; Rec.709 on the
 * linear framebuffer, bloom on).
 *
 *   - Peak luminance ~0.079 [EST] — `lit` approaches `DEEP + LIFT` with the
 *     structure sum `0.28 + 0.42 + 0.30 = 1.0`, in-family with the pre-rebuild
 *     ~0.073 (the coffers measured ~0.07). Under the 0.1 `background.ts` asks for.
 *     The two crowded zones fall away as designed: `light -> ~0.28` hazes to `DEEP`
 *     at the oculus and `detail = nearC^2` suppresses centre structure to ~1%.
 *   - Arm spacing ~200px mid-field (`Δr = (2π/ARM_COUNT)·r/PITCH`), an order coarser
 *     than a 16-30px bullet; the contracting radial ring is ~112px analytic
 *     (`RING_FREQ` 36 over 640px). The tight centre (r -> 0.03, Δr -> ~24px, in-band)
 *     is the run-to-infinity analogue, killed by the centre-decay above.
 *   - Palette relation R/G ~1.42 (`0.085/0.060`, gold), unchanged — DEEP/LIFT hue
 *     untouched — clear of `regnum`'s crimson (R/G ~2.56).
 *   - Motion: recession-pull, one arm-pass ~140t (1.5-2s, the most obvious motion
 *     in the game, thematically the pull into the void) + radial rings contract
 *     ~218t. [EST, motion-strip in acceptance.]
 *   - Vortex studied from pbakaus/radiant (MIT); our GLSL.
 *
 * The capture is of the shader's raw output (pre-bloom); bloom only adds glow
 * above this floor and cannot lower it, so the sub-0.1 result holds on screen.
 */

import { BACKGROUND_NOISE_GLSL, defineBackground } from '../background';

defineBackground('vault', {
  scrollSpeed: 0.5,
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}

    /* A log-spiral winding INWARD -- the pull into the empty seat, the biggest
       delta where the terminal descent needs it most. */

    /* Spiral arm count. INTEGER, so the arms stay a-periodic across the atan wrap
       and no crack runs out of the centre (the undertow flute lesson). */
    const int ARM_COUNT = 3;

    /* Log-spiral pitch: the radial spacing of successive arm passes. 1.7 keeps
       arm spacing >= ~200px mid-field, an order coarser than a bullet. */
    const float PITCH = 1.7;

    /* Swirl rate -- the signature recession. One arm-pass sweeps a fixed point
       about every 140 ticks (1.5-2s): the most obvious motion in the game, the
       thematic pull into the void. */
    const float SWIRL_RATE = 0.090;

    /* Faint contracting radial ring, kept for the dome read. */
    const float RING_FREQ = 36.0;
    const float CONTRACT_RATE = 0.0016;

    /* How fast structure decays toward each crowded zone, relative to the glow.
       CENTER_FALLOFF raised 3.4 -> 3.8 to widen the dark centre well: the vortex
       centre (r -> 0.03) is the analogue of run-to-infinity aliasing, and this
       decay is the load-bearing safety that kills it. Detail uses the square of
       each, glow the first power, so detail always dies first. */
    const float CENTER_FALLOFF = 3.8;
    const float TOP_FALLOFF = 2.6;

    /* Dim gold / amber -- the seal, wax, brass. R > G > B with G ~ 0.7 R, a clear
       yellow-gold. See the header for why the hue is chosen against expanse's
       ice-blue, undertow's indigo, stratum's verdigris, and above all surge's
       red. */
    const vec3 HAZE = vec3(0.010, 0.007, 0.002);
    const vec3 DEEP = vec3(0.022, 0.016, 0.005);
    const vec3 LIFT = vec3(0.085, 0.060, 0.018);

    vec3 background(vec2 uv) {
      float aspect = uRes.x / uRes.y;

      /* Centred on the oculus, aspect-corrected so the spiral stays circular. */
      vec2 c = (uv - vec2(0.5, 0.5)) * vec2(aspect, 1.0);
      float r = length(c);
      float a = atan(c.y, c.x);

      /* Log-spiral coordinate: angle offset by log(r)*PITCH. The clamp on r keeps
         log() finite and holds the tight centre in-band rather than aliasing. */
      float spa   = a + log(max(r, 0.03)) * PITCH;
      float arms  = 0.5 + 0.5 * sin(float(ARM_COUNT) * spa - uScroll * SWIRL_RATE);

      /* The contracting radial ring, for the dome read. */
      float rings = 0.5 + 0.5 * sin((r + uScroll * CONTRACT_RATE) * RING_FREQ);

      /* The spiral lattice: arms modulated by the rings. */
      float lattice = arms * (0.55 + 0.45 * rings);

      /* Grain sampled against the arm value rather than the raw angle, so it
         inherits the periodicity and cannot shear across the wrap. */
      float grain = bgFbm(vec2(arms * 2.2, r * 3.0 - uScroll * 0.010));

      /* The two crowded zones. nearC is 0 at the oculus and grows outward; nearTop
         is 0 at the top entry lane and grows downward. Both cap at 1. */
      float nearC = clamp(r * CENTER_FALLOFF, 0.0, 1.0);
      float nearTop = clamp(uv.y * TOP_FALLOFF, 0.0, 1.0);

      /* Brightness falls gently toward the oculus (which darkens toward zero -- the
         empty seat as absence); detail falls far faster, and toward the top lane as
         well, so the finest arms dissolve into a smooth dark well before they reach
         where bullets crowd -- and the tight vortex centre (detail = nearC^2 ~=
         0.013 there) is suppressed to ~1% structure, the centre-decay safety. */
      float light = clamp(0.20 + 0.80 * nearC, 0.0, 1.0);
      float detail = nearC * nearC * nearTop * nearTop;

      vec3 lit = DEEP + LIFT * (0.28 + detail * (0.42 * grain + 0.30 * lattice));
      return mix(HAZE, lit, light);
    }
  `,
});
