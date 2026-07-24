/**
 * V4 integration (2026-07-24): Umbra keeps the unmoored eclipse veil, but all
 * isolated stardust is disabled and the surviving aurora is coarser, colder and
 * lower-band calm. The eclipse remains subtractive: 出神 arrives through motion
 * and coherence, never a brightness spike.
 */

/**
 * `umbra` — sentinel's "Total Eclipse" (Lunatic only). A NEAR-IDENTICAL port of
 * pbakaus/radiant `stardust-veil` (MIT), and its ONLY home: a dense shimmering
 * cosmic stardust curtain — a domain-warped FBM nebula in deep purples and
 * midnight blues, flowing aurora ribbons, multiple parallax layers of drifting
 * twinkling stardust, and a slow diagonal brightness wave sweeping the whole
 * field.
 *
 * ## One reference, one scene
 *
 * The 出神 pair briefly shared this basis; the no-repeat ruling ("不要重复")
 * dissolved that too — `decree` is `moire-interference` now — so `umbra` alone
 * carries `stardust-veil` and `VEIL_GLSL` is internal to this file. What the
 * pair still shares is its RELATIVE DISCIPLINE, not a picture: both scenes are
 * unmoored from the seal grammar. Identity comes from the port; the scene only
 * grades and modulates it.
 *
 * ## The role kept, the picture replaced
 *
 * `umbra` is still the seal UNMOORED — sentinel's "Total Eclipse", reached only on
 * the Lunatic path, where the card also swaps music to `zenith`. What changed is
 * the picture: no more engraved-ring cell, no dither, no vortex pull, no SEAL_GLSL.
 * The unmooring now reads as a cosmic veil adrift — the whole field precesses
 * slowly off-station (a gentle circular sway) and a soft eclipse shadow crosses it.
 * The 出神 threshold is crossed by COHERENCE and MOTION (the drift, the shadow, the
 * wave), never by isolated luminance spikes.
 *
 * ## What was ported
 *
 * The reference verbatim in structure: the domain-warped FBM nebula (single warp,
 * 3+3+4 octaves) mixing deep-purple / midnight-blue / dark-mauve; the three flowing
 * aurora ribbons (ridged, domain-warped noise in lavender / soft-pink / pale-gold,
 * each with its slow breathing); the far / mid / near parallax stardust layers with
 * per-star twinkle and celestial-wind drift; the diagonal traveling brightness
 * wave; the faint overall shimmer; the vignette; and the reference's soft-S-curve
 * tonemap with its cool-shadow / warm-highlight grade. The nebula and aurora are
 * the defining image and are ported faithfully.
 *
 * ## Adaptation to our surface (the departures from the reference)
 *
 *   - The reference's complete star path is removed. Its cores (radius ~7–17px),
 *     glows, near-star flares and connecting threads all occupy the fake-bullet
 *     band; a zero-gain branch is not retained in the compiled source. The aurora
 *     ridge FBM is reduced 4→3 octaves, trimming
 *     the finest ridge octave. The finer surviving ridge (`rNoise2`, spatial
 *     ×4/×5) is reduced to two octaves; its small weight (0.18, with a further
 *     ×0.3 on `ridged2`) and elongated shape keep it coherent rather than
 *     point-like even after the production ×1 lift.
 *   - Film GRAIN dropped: a per-pixel high-frequency term reads as speckle in the
 *     play band (the `expanse` lesson).
 *   - Uniforms: the reference's `u_driftSpeed` (0.4) is baked to `VEIL_DRIFT`;
 *     `u_starDensity` disappears with the star path; `u_mouse` (the gravitational
 *     lensing) is excised — our uniform surface has no pointer and rule 1 forbids
 *     anything but a tick clock.
 *   - Clock: `t = uScroll * 0.014`, with the drift and eclipse clocks increased
 *     proportionally. Animation remains frame-locked; `uScroll` advances only in
 *     `step()`.
 *   - y-down uv → the reference's min-dimension-centred coords with the y flip
 *     retained (a vertical mirror of a near-symmetric field is cosmetic).
 *   - Palette pushed cold blue-violet — the warmth draining as the seal unmoors —
 *     over the already blue-violet nebula (the reference's native hue is nearly
 *     umbra's target, which is why "umbra = the veil as-is, dimmed").
 *   - Role modulation: a slow Total-Eclipse shadow band, a ≤1 multiply, so
 *     luminance only ever drops (never-brighter preserved).
 *
 * ## Exposure & readability
 *
 * `EXPOSURE 1.00` makes the cold veil and eclipse readable at production ×1
 * without restoring any isolated stardust. The shadow remains subtractive, so
 * field precession, shadow crossing and the wave sweep carry the motion while
 * bullets retain the only compact highlights.
 *
 * ## Clock
 *
 * `uScroll` only — no `performance.now`, no wall clock (see `background.ts`,
 * rule 1). Drift, precession, twinkle, shadow and wave are all `sin`/`cos`/`fract`
 * of `uScroll`, so a replay looks identical twice.
 * `backgrounds/index.test.ts` scans this file for wall-clock sources.
 *
 * stardust-veil by pbakaus/radiant, MIT. Ported; our clock, y-down projection,
 * cold-violet palette, eclipse modulation, dropped cores/flares/threads/grain, and
 * exposure.
 */

import { BACKGROUND_NOISE_GLSL, defineBackground } from '../../render/background';

/**
 * The ported stardust-veil. It is a **string constant only** — no new
 * uniform — and it reads `bgNoise` from `BACKGROUND_NOISE_GLSL`, so a scene must
 * prepend that before this. Its helpers are `veil`-prefixed so nothing collides
 * with the `bgHash`/`bgNoise`/`bgFbm` already in each fragment.
 *
 * `veilCompose(p, t)` returns the native-coloured veil in LINEAR space
 * (pre-tonemap); `veilGrade` pushes it toward a role hue; `veilTonemap` applies the
 * reference's soft-S-curve. Each scene composes: `veilCompose → veilGrade →
 * role multiply → veilTonemap → * EXPOSURE`.
 */
const VEIL_GLSL = /* glsl */ `
  /* Reference u_driftSpeed (0.4) baked to its default: the celestial-wind rate. */
  const float VEIL_DRIFT = 0.4;

  /* --- Hash & noise primitives (reference-faithful, veil-prefixed) --- */
  float veilHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float veilNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = veilHash(i);
    float b = veilHash(i + vec2(1.0, 0.0));
    float c = veilHash(i + vec2(0.0, 1.0));
    float d = veilHash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  /* FBM, up to 7 octaves selectable — the reference's exact frequency/amp/offset. */
  float veilFbm(vec2 p, int octaves) {
    float val = 0.0;
    float amp = 0.5;
    float freq = 1.0;
    for (int i = 0; i < 7; i++) {
      if (i >= octaves) break;
      val += amp * veilNoise(p * freq);
      freq *= 2.03;
      amp *= 0.49;
      p += vec2(1.7, 9.2);
    }
    return val;
  }
  /* Domain-warped FBM for the organic nebula shapes (single warp, 3+3+4). */
  float veilWarped(vec2 p, float t) {
    vec2 q = vec2(
      veilFbm(p + t * 0.02, 3),
      veilFbm(p + vec2(5.2, 1.3) + t * 0.015, 3));
    return veilFbm(p + 3.0 * q, 4);
  }

  /* --- Layer 1: background nebula, deep purples and midnight blues --- */
  vec3 veilNebula(vec2 uv, float t) {
    vec2 p = uv * 1.8;
    float n1 = veilWarped(p, t);
      vec3 deepPurple  = vec3(0.045, 0.035, 0.075);
      vec3 midnightBlue = vec3(0.025, 0.040, 0.075);
      vec3 darkMauve   = vec3(0.065, 0.045, 0.065);
    vec3 col = mix(deepPurple, midnightBlue, n1);
    col = mix(col, darkMauve, smoothstep(0.3, 0.7, n1) * 0.5);
    col += smoothstep(0.35, 0.65, n1) * 0.06;   /* subtle brightness variation */
    return col;
  }

  /* --- Layer 2: aurora ribbons — ridged domain-warped noise, three bands.
     Ridge FBM reduced 4->3 octaves and the finer rNoise2 branch to two; its
     0.18 / x0.3 weights plus elongated shape keep it coherent and non-pointlike.
     Else the reference. --- */
  vec3 veilAurora(vec2 uv, float t) {
    vec3 col = vec3(0.0);
    float drift = VEIL_DRIFT;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float yOffset = -0.4 + fi * 0.25 + sin(fi * 1.7) * 0.1;

      vec2 warpP = uv * vec2(1.5, 2.0) + vec2(t * 0.03 * drift + fi * 3.0, fi * 2.7);
      float warpX = veilFbm(warpP, 3) * 0.4;
      float warpY = veilFbm(warpP + vec2(3.3, 7.7), 3) * 0.3;
      vec2 warped = vec2(uv.x + warpX, uv.y + warpY);

      float rNoise = veilFbm(vec2(warped.x * 1.8 + t * 0.04 * drift, warped.y * 2.2 + yOffset) + fi * 5.0, 3);
      float ridged = 1.0 - abs(rNoise * 2.0 - 1.0);
      ridged = pow(ridged, 4.0);                 /* ridged in [0,1] -> pow safe */

      float rNoise2 = veilFbm(vec2(warped.x * 2.5 - t * 0.025 * drift, warped.y * 3.0 + yOffset * 1.5) + fi * 8.0, 2);
      float ridged2 = 1.0 - abs(rNoise2 * 2.0 - 1.0);
      ridged2 = pow(ridged2, 5.0);

      float ribbon = ridged * 0.7 + ridged2 * 0.3;

      vec3 bandColor;
      if (i == 0) bandColor = vec3(0.42, 0.52, 0.72);
      else if (i == 1) bandColor = vec3(0.66, 0.56, 0.64);
      else bandColor = vec3(0.58, 0.68, 0.74);

      float breath = 0.6 + 0.4 * sin(t * 0.08 + fi * 1.3);
      col += bandColor * ribbon * breath * 0.18;
    }
    return col;
  }

  /* --- Layer 7: traveling brightness wave, a slow diagonal sweep --- */
  float veilWave(vec2 uv, float t) {
    float diag = uv.x * 0.7 + uv.y * 0.3;
    float wavePeriod = 5.0;
    float wavePos = fract(t / wavePeriod) * 3.0 - 1.0;
    float waveWidth = 0.35;
    float wave = exp(-(diag - wavePos) * (diag - wavePos) / (waveWidth * waveWidth));
    float wavePos2 = fract((t + 2.5) / (wavePeriod * 1.3)) * 3.0 - 1.0;
    float wave2 = exp(-(diag - wavePos2) * (diag - wavePos2) / (waveWidth * 1.5 * waveWidth * 1.5));
    return wave * 0.35 + wave2 * 0.2;
  }

  /* Compose the starless veil in LINEAR space (pre-tonemap). p is the
     reference's min-dimension-centred coord. */
  vec3 veilCompose(vec2 p, float t) {
    vec3 col = veilNebula(p, t);
    col += veilAurora(p, t);

    float wave = veilWave(p, t);
    col *= 1.0 + wave;
    col += vec3(0.70, 0.60, 0.85) * wave * 0.04;   /* lavender wind wash */

    /* Faint overall shimmer — low-frequency, uses the shared bgNoise. */
    float shimmer = bgNoise(p * 4.0 + t * 0.3) * bgNoise(p * 3.0 - t * 0.2);
    col += vec3(0.75, 0.65, 0.85) * shimmer * 0.015;

    /* Vignette. */
    float d = length(p);
    float vignette = 1.0 - smoothstep(0.5, 1.4, d);
    col *= 0.7 + vignette * 0.3;

    return col;
  }

  /* Push the native veil toward a role hue by desaturating toward tint*luma. amt
     modest so the aurora's multi-hue survives. */
  vec3 veilGrade(vec3 col, vec3 tint, float amt) {
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    return mix(col, l * tint, amt);
  }

  /* The reference's soft-S-curve tonemap and cool-shadow / warm-highlight grade.
     col >= 0 here, so both pow() calls are safe. */
  vec3 veilTonemap(vec3 col) {
    col = max(col, vec3(0.0));
    col = col / (col + 0.85) * 1.15;
    col = pow(col, vec3(0.97, 1.0, 1.04));
    return col;
  }

  /* Convert our y-down 0..1 uv to the reference's min-dimension-centred coord
     (y flip retained), with a slow precession drift added — the unmoored sway. */
  vec2 veilCoord(vec2 uv, vec2 drift) {
    float minRes = min(uRes.x, uRes.y);
    return (uv - 0.5) * uRes / minRes + drift;
  }
`;

defineBackground('umbra', {
  scrollSpeed: 1.1,
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}
${VEIL_GLSL}

    const float EXPOSURE = 1.00;   /* production x1: veil texture stays legible */

    /* Cold blue-violet — the warmth drained as the seal unmoors. The reference
       nebula is already blue-violet, so umbra is "the veil as-is, dimmed". */
    const vec3 VEIL_TINT = vec3(0.72, 0.80, 1.14);

    vec3 background(vec2 uv) {
      float t = uScroll * 0.014;

      /* The whole veil precesses slowly off-station — the unmoored sway.
         sin/cos of uScroll only, a pure function of ticks, no wall clock. */
      vec2 drift = 0.03 * vec2(cos(uScroll * 0.0046), sin(uScroll * 0.0046));
      vec2 p = veilCoord(uv, drift);

      vec3 col = veilCompose(p, t);
      col = veilGrade(col, VEIL_TINT, 0.32);

      /* Total Eclipse: a soft shadow band sweeps the field on uScroll. It only ever
         MULTIPLIES down (0.55..1.0), so luminance cannot rise above the veil —
         coherence and shadow cross, brightness does not. */
      float eclipse = 0.55 + 0.45 * (0.5 + 0.5 * sin(uScroll * 0.0029 - uv.y * 3.0));
      col *= eclipse;

      col = veilTonemap(col);
      float activityCalm = 1.0 - 0.20 * smoothstep(0.62, 0.94, uv.y);
      return col * EXPOSURE * activityCalm;
    }
  `,
});
