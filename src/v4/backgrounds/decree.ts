/**
 * `decree` — chancellor's Fiat "Sealed" AND regent's Last Fiat "Sine Die" (both
 * Lunatic only). One scene named by two spell cards, both sounding the one `fiat`
 * track — the tighter rhyme (one track ↔ one scene). A NEAR-IDENTICAL port of
 * pbakaus/radiant `moire-interference` (MIT): overlapping concentric-ring
 * interference — four sine ring-sources on slow Lissajous orbits at slightly
 * detuned frequencies, whose products beat into a warm-gold moiré field.
 *
 * ## No shared basis — the picture is decree's own now
 *
 * `decree` used to import `umbra`'s `VEIL_GLSL` and regrade it (the 出神 pair cut
 * from one stardust-veil). That is RETIRED: one reference, one scene — `umbra`
 * keeps the veil alone and `decree` is a standalone moiré port. The pair is still a
 * pair by ROLE (two unmoored seals, the dimmest family), not by a shared shader.
 *
 * ## What was ported
 *
 * The reference verbatim in structure: `uv` centred on the min dimension; four
 * ring-sources `c0..c3` on elliptical/Lissajous orbits (radii 0.17-0.25, unique
 * speeds and phases); each emitting `sin(dist * freq)` at a slightly detuned
 * frequency (`freq`, `×1.07`, `×0.93`, `×1.13`) — the frequency DIFFERENCES are the
 * moiré; the multiplicative product `r0·r1·r2·r3` (sum+difference beats) blended
 * `0.7 / 0.3` with the additive `(Σr)·0.25`; the slow `breathe` on ring spacing; the
 * three-stop warm-gold palette; the ring-based secondary shimmer; and the vignette.
 *
 * The warm gold is the reference's own, and it is exactly the "gold of the empty
 * seat" the role wants, so the palette ports with NO hue regrade — the two 出神
 * scenes read apart because they are now different references (cold veil vs warm
 * moiré), not because either is repainted.
 *
 * ## The role kept, the picture replaced
 *
 * `decree` is still the seal UNMOORED and DRAINING — the court decreeing without a
 * device, authority with nothing left to press. The drain is decree's alone: a slow
 * global breathing dim plus a faint downward run, a ≤1 multiply on `uScroll` (the
 * fill leaving the frame; luminance only ever drops). The 出神 threshold is crossed
 * by COHERENCE and MOTION — the slow orbit, the breathing, the drain — never by
 * luminance: this pair is the dimmest family in the game. It serves TWO fights, and
 * `sable` is the darkest stated seal of the other; a single shared scene cannot dip
 * under both, so `decree` sits at the FAMILY BOTTOM rather than beneath each fight's
 * own seal, and readability holds because that bottom is far under a bullet's
 * 1.0-white + bloom.
 *
 * ## The two knobs — moiré is exactly what the bullet-band law is for
 *
 * Interference fringes are fine periodic structure; a bad pitch would counterfeit a
 * bullet curtain, and a fast beat would strobe. Both are named constants:
 *
 *   - FRINGE_FREQ (the BULLET-BAND knob). The reference's `baseFreq` is 60; at our
 *     480px min dimension that puts individual rings at 3016/60 ≈ 50px and — worse —
 *     the four-way product's SUM term (×4.13) at ≈12px, squarely inside the play
 *     band (16-30px): a fake curtain. FRINGE_FREQ is cut to 30, which lifts the
 *     VISIBLE structure clear of the band — individual rings ≈100px, the additive
 *     term ≈89px, the shimmer ≈52px, the beat envelopes a few hundred px up to
 *     full-screen. The ONE term that
 *     stays inside the band is the multiplicative sum (×4.13 = 124 → ≈24px); it is
 *     intrinsic to the product and cannot be moved out without abandoning the
 *     picture, so it is BRIGHTNESS-graded instead (its ⅛ intrinsic amplitude, the
 *     dropped peak-boost, the dropped grain, and the low EXPOSURE land it near
 *     ~0.006 luma [MEASURED-IN-ACCEPTANCE], ~160× under a bullet). Coarse pitch AND
 *     brightness-grading, the two tactics the law allows, used together.
 *   - MOIRE_DRIFT (the STROBE knob). A high ring frequency makes fringe position
 *     hypersensitive to source motion, so a small orbit step can sweep a fine fringe
 *     many periods — flicker. MOIRE_DRIFT scales the source-orbit rate (the
 *     reference `DRIFT_SPEED` 0.5); with it and the slow clock (`t = uScroll*0.006`,
 *     slower than the stage tier — a still, solemn drift) the finest fringe crawls
 *     ~0.14px/tick, the per-tick luminance step far under the strobe bound
 *     [MEASURED-IN-ACCEPTANCE]. Lower it first if a fringe ever shimmers.
 *
 * Other departures, all the drift/umbra pattern: the reference's peak-luminance
 * BOOST is dropped (it sharpens exactly the finest full-alignment points, the "drop
 * the sharp core" move drift made on its moon and umbra on its stars); film GRAIN is
 * dropped (a per-pixel high-frequency term reads as speckle in the play band); and
 * the mouse-driven 5th source is EXCISED — our uniform surface has no pointer and
 * rule 1 forbids anything but a tick clock, so `c3` keeps its Lissajous path.
 *
 * ## Exposure & readability
 *
 * The 出神 pair is the RELATIVELY DIMMEST family — below `sable`. The moiré field is
 * natively bright (a filled amber interference, not a sparse star field), so decree
 * meets the family floor at a LOWER effective exposure than the veil: at EXPOSURE
 * 0.26 the recurring fringe crests land ~0.10-0.13 raw and rare full-alignment peaks
 * ~0.16 [MEASURED-IN-ACCEPTANCE], with the field mean well below that and the drain
 * pulling both further down. All far under a bullet's 1.0-white + bloom, and the
 * only band-touching term is the deeply-graded multiplicative sum above. Motion:
 * source orbit + spacing breathe + drain, every per-tick step bounded
 * [MEASURED-IN-ACCEPTANCE]. The acceptance pass tunes `EXPOSURE`, `FRINGE_FREQ` and
 * `MOIRE_DRIFT`.
 *
 * ## Clock
 *
 * `uScroll` only — no `performance.now`, no wall clock (see `background.ts`,
 * rule 1). Breathe, source orbits and drain are all `sin`/`cos` of `uScroll`, so a
 * replay looks identical twice. `backgrounds/index.test.ts` scans this file for
 * wall-clock sources.
 *
 * moiré-interference by pbakaus/radiant, MIT. Ported; our clock, y-down projection,
 * coarsened fringe pitch, dropped peak-boost/grain/mouse, drain modulation, and
 * exposure.
 */

import { BACKGROUND_NOISE_GLSL, defineBackground } from '../../render/background';

defineBackground('decree', {
  scrollSpeed: 1.2,
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}

    const float EXPOSURE = 0.26;   /* 出神 pair, family bottom — serves the sable fight too */

    /* THE BULLET-BAND KNOB. The reference baseFreq is 60 — individual rings ~50px
       and the four-way product's SUM term ~12px, inside the play band (16-30px). Cut
       to 30: visible structure (rings ~100px, additive ~89px, shimmer ~52px, beat
       envelopes hundreds of px) clears the band; the intrinsic ~24px
       multiplicative-sum term is
       brightness-graded instead (see the header). Lower it if any fringe reads as a
       bullet; raise it only if the field looks too empty. */
    const float FRINGE_FREQ = 30.0;

    /* THE STROBE KNOB. Scales the source-orbit rate (reference DRIFT_SPEED 0.5). A
       high FRINGE_FREQ makes fringe position sensitive to source motion, so this
       stays slow — with the slow clock below the finest fringe crawls ~0.14px/tick.
       Lower it first if a fringe ever shimmers. */
    const float MOIRE_DRIFT = 0.5;

    /* Concentric rings from a source: sine of distance. Prefixed so nothing
       collides with bgNoise or the appended tear* helpers. */
    float miRings(vec2 p, vec2 center, float freq) {
      return sin(length(p - center) * freq);
    }

    vec3 background(vec2 uv) {
      float minRes = min(uRes.x, uRes.y);
      /* y-down 0..1 -> the reference's min-dimension-centred coord (aspect on the
         long axis via uRes; the y flip is cosmetic on a centrally-symmetric field). */
      vec2 p = (uv - 0.5) * uRes / minRes;

      /* Clock: slow and solemn. uScroll only, ticks, no wall clock. */
      float t = uScroll * 0.006;

      /* Ring spacing breathes slowly (reference breathe). */
      float breathe = 1.0 + 0.04 * sin(t * 0.3) + 0.02 * sin(t * 0.17 + 1.0);
      float freq = FRINGE_FREQ * breathe;

      /* Four ring-sources on slow Lissajous orbits (reference c0..c3), the orbit
         rate folded to MOIRE_DRIFT. The reference's mouse-driven 5th source is
         excised (rule 1) — c3 keeps its own path. */
      float d = MOIRE_DRIFT;
      vec2 c0 = vec2(0.22 * cos(t * d * 0.31 + 0.0), 0.18 * sin(t * d * 0.43 + 0.0));
      vec2 c1 = vec2(0.25 * cos(t * d * 0.23 + 2.1), 0.20 * sin(t * d * 0.37 + 1.4));
      vec2 c2 = vec2(0.19 * sin(t * d * 0.41 + 4.2), 0.24 * cos(t * d * 0.29 + 3.1));
      vec2 c3 = vec2(0.21 * cos(t * d * 0.19 + 5.7), 0.17 * sin(t * d * 0.47 + 0.8));

      /* Slightly detuned frequencies — the differences ARE the moiré beats. */
      float r0 = miRings(p, c0, freq);
      float r1 = miRings(p, c1, freq * 1.07);
      float r2 = miRings(p, c2, freq * 0.93);
      float r3 = miRings(p, c3, freq * 1.13);

      /* Multiplicative (sum + difference frequencies = the interference) blended
         with the additive layer, exactly as the reference. */
      float moire = r0 * r1 * r2 * r3;
      float additive = (r0 + r1 + r2 + r3) * 0.25;
      float pattern = moire * 0.7 + additive * 0.3;

      float intensity = clamp(pattern * 0.5 + 0.5, 0.0, 1.0);

      /* Warm-gold palette — the reference's own, and the gold of the empty seat.
         Ported with no hue regrade. */
      vec3 darkColor   = vec3(0.05, 0.035, 0.025);   /* deep warm-black */
      vec3 midColor    = vec3(0.35, 0.22,  0.12);    /* deep amber-brown */
      vec3 brightColor = vec3(0.65, 0.42,  0.22);    /* warm amber */
      vec3 peakColor   = vec3(0.90, 0.78,  0.55);    /* gold-white */

      vec3 col;
      if (intensity < 0.35) {
        col = mix(darkColor, midColor, intensity / 0.35);
      } else if (intensity < 0.65) {
        col = mix(midColor, brightColor, (intensity - 0.35) / 0.3);
      } else {
        col = mix(brightColor, peakColor, (intensity - 0.65) / 0.35);
      }

      /* The reference's peak-luminance boost is DROPPED — it sharpens exactly the
         finest full-alignment points (the drift/umbra "drop the sharp core" move). */

      /* Secondary shimmer — ring-based (no wall clock), coarse (sum freq ~52px),
         kept faint exactly as the reference. */
      float shimmer = smoothstep(0.4, 0.8, r0 * r2 * 0.5 + 0.5);
      col += vec3(0.12, 0.08, 0.04) * shimmer * 0.2;

      /* Vignette (reference) — focuses the field, calms the play-field edges. */
      float vig = clamp(1.0 - dot(p * 0.9, p * 0.9), 0.0, 1.0);
      vig = pow(vig, 0.5);
      col *= vig;

      /* Film grain DROPPED — a per-pixel high-frequency term is speckle in the play
         band (the expanse/umbra lesson). */

      /* DECREE'S ROLE: the fill draining out — a slow global breathing dim plus a
         faint downward run (uv.y), a <=1 multiply on uScroll. Luminance only ever
         drops; the authority leaving the frame. Never-brighter preserved. */
      float drain = mix(0.62, 1.0, 0.5 + 0.5 * sin(uScroll * 0.0018 - uv.y * 1.5));
      col *= drain;

      /* Reference tonemap — keep blacks deep. col >= 0 here. */
      col = max(col, vec3(0.0));
      col = col / (1.0 + col * 0.2);

      return col * EXPOSURE;
    }
  `,
});
