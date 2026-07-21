/**
 * `umbra` — sentinel's "Total Eclipse" (Lunatic only), and the SHARED BASIS of the
 * 出神 pair. A NEAR-IDENTICAL port of pbakaus/radiant `stardust-veil` (MIT): a
 * dense shimmering cosmic stardust curtain — a domain-warped FBM nebula in deep
 * purples and midnight blues, flowing aurora ribbons, multiple parallax layers of
 * drifting twinkling stardust, and a slow diagonal brightness wave sweeping the
 * whole field.
 *
 * ## The pair shares one basis by design
 *
 * `umbra` OWNS the ported picture and exports it as `VEIL_GLSL`; `decree` imports
 * it and applies its own variant. One nebula, two unmoored seals — the same reason
 * the seals shared `SEAL_GLSL`, except that cell is retired for this pair and the
 * shared thing is now a ported reference, not an engine grammar. Identity comes
 * from the port; each scene only grades and modulates it.
 *
 * ## The role kept, the picture replaced
 *
 * `umbra` is still the seal UNMOORED — sentinel's "Total Eclipse", reached only on
 * the Lunatic path, where the card also swaps music to `zenith`. What changed is
 * the picture: no more engraved-ring cell, no dither, no vortex pull, no SEAL_GLSL.
 * The unmooring now reads as a cosmic veil adrift — the whole field precesses
 * slowly off-station (a gentle circular sway) and a soft eclipse shadow crosses it.
 * The 出神 threshold is crossed by COHERENCE and MOTION (the drift, the shadow, the
 * wave), never by luminance: this pair is the DIMMEST family in the game.
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
 *   - STAR GRADING KNOB (the bullet-band guarantee). The reference draws each star
 *     as a sharp `smoothstep` core (radius ~7-17px) plus a soft glow. A bright
 *     sharp dot at 16-30px is exactly a fake bullet, so the core term is DROPPED
 *     ENTIRELY — `veilStars` emits no core, only the broad Gaussian glow: the
 *     reference's core weight (1.2) is simply gone, and what survives is the glow
 *     scaled by `VEIL_STAR_GLOW_GAIN` (the reference's 0.4 glow weight), widened
 *     ×`VEIL_STAR_GLOW_WIDEN` (1.8) and dimmed — a star becomes a soft dust blob
 *     (σ ≳ 20px), never a pinpoint. The near-star FLARE pulses (bright warm points)
 *     and the connecting THREADS (thin ~4px glowing lines) are dropped for the same
 *     reason, exactly as `expanse` dropped its cores/grain and `drift` its
 *     hyper-tight moon core. The aurora ridge FBM is reduced 4→3 octaves, trimming
 *     the finest ridge octave — but the finer surviving ridge (`rNoise2`, spatial
 *     ×4/×5, still 3 octaves) reaches near the play band, so bullet-band safety for
 *     the ribbons does NOT rest on that octave cut raising the minimum feature size;
 *     it rests on BRIGHTNESS grading — the low EXPOSURE (0.25), the small ribbon
 *     weight (0.18, with a further ×0.3 on the finer `ridged2` term), and the ridge
 *     elongation keeping every ribbon coherent and never point-like.
 *   - Film GRAIN dropped: a per-pixel high-frequency term reads as speckle in the
 *     play band (the `expanse` lesson).
 *   - Uniforms: the reference's `u_driftSpeed` (0.4) is baked to `VEIL_DRIFT`;
 *     `u_starDensity` (1.0) folds into `STAR_GAIN`; `u_mouse` (the gravitational
 *     lensing) is excised — our uniform surface has no pointer and rule 1 forbids
 *     anything but a tick clock.
 *   - Clock: `t = uScroll * 0.012`, so the veil animates at roughly the reference's
 *     wall-clock-seconds rate but frame-locked; the slower rate also keeps the
 *     per-tick twinkle/wave step well under the strobe bound. `uScroll` advances
 *     only in `step()`.
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
 * The 出神 pair is the RELATIVELY DIMMEST family of all — below `sable`, the
 * darkest stated seal. Structured aurora-ridge peaks land ~0.10-0.14 raw
 * [MEASURED-IN-ACCEPTANCE] at EXPOSURE 0.25, well under a bullet's 1.0-white +
 * bloom, and the eclipse shadow multiplies that further down as it crosses. The
 * stardust is a soft dim shimmer (glow-only, no cores), the nebula a near-black
 * deep-purple haze. Motion: field precession + shadow crossing + wave sweep + slow
 * twinkle, every per-tick step bounded [MEASURED-IN-ACCEPTANCE]. The knobs the
 * acceptance pass tunes are `EXPOSURE`, `STAR_GAIN`, and the shared
 * `VEIL_STAR_GLOW_*` constants.
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

import { BACKGROUND_NOISE_GLSL, defineBackground } from '../background';

/**
 * The ported stardust-veil, shared by the 出神 pair. `decree` imports this and
 * applies its own palette and drain. It is a **string constant only** — no new
 * uniform — and it reads `bgNoise` from `BACKGROUND_NOISE_GLSL`, so a scene must
 * prepend that before this. Its helpers are `veil`-prefixed so nothing collides
 * with the `bgHash`/`bgNoise`/`bgFbm` already in each fragment.
 *
 * `veilCompose(p, t, starGain)` returns the native-coloured veil in LINEAR space
 * (pre-tonemap); `veilGrade` pushes it toward a role hue; `veilTonemap` applies the
 * reference's soft-S-curve. Each scene composes: `veilCompose → veilGrade →
 * role multiply → veilTonemap → * EXPOSURE`.
 */
export const VEIL_GLSL = /* glsl */ `
  const float VEIL_PI  = 3.14159265359;
  const float VEIL_TAU = 6.28318530718;

  /* Reference u_driftSpeed (0.4) baked to its default: the celestial-wind rate. */
  const float VEIL_DRIFT = 0.4;

  /* THE BULLET-BAND KNOB. The reference star is a sharp smoothstep core (weight
     1.2, radius ~7-17px — a fake bullet) PLUS a soft glow (weight 0.4). The core is
     dropped; only the glow survives, widened so a star is a soft dust blob, never a
     pinpoint. Raise WIDEN or lower GAIN if a star ever reads as a bullet. */
  const float VEIL_STAR_GLOW_WIDEN = 1.8;   /* broadens the glow past the reference *4.0 */
  const float VEIL_STAR_GLOW_GAIN  = 0.4;   /* the reference glow weight; the 1.2 core weight is gone */

  /* --- Hash & noise primitives (reference-faithful, veil-prefixed) --- */
  float veilHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  vec2 veilHash2(vec2 p) {
    return vec2(
      fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453),
      fract(sin(dot(p, vec2(269.5, 183.3))) * 43758.5453));
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
    vec3 deepPurple  = vec3(0.06, 0.02, 0.10);
    vec3 midnightBlue = vec3(0.03, 0.03, 0.09);
    vec3 darkMauve   = vec3(0.08, 0.03, 0.07);
    vec3 col = mix(deepPurple, midnightBlue, n1);
    col = mix(col, darkMauve, smoothstep(0.3, 0.7, n1) * 0.5);
    col += smoothstep(0.35, 0.65, n1) * 0.06;   /* subtle brightness variation */
    return col;
  }

  /* --- Layer 2: aurora ribbons — ridged domain-warped noise, three bands.
     Ridge FBM reduced 4->3 octaves (trims the finest octave); the finer surviving
     ridge (rNoise2, x4/x5) still reaches near the play band, so band-safety here
     rests on BRIGHTNESS — low EXPOSURE, the 0.18 / x0.3 ribbon weights, and the
     elongated, coherent (never point-like) ribbons. Else the reference. --- */
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

      float rNoise = veilFbm(vec2(warped.x * 2.5 + t * 0.04 * drift, warped.y * 3.0 + yOffset) + fi * 5.0, 3);
      float ridged = 1.0 - abs(rNoise * 2.0 - 1.0);
      ridged = pow(ridged, 4.0);                 /* ridged in [0,1] -> pow safe */

      float rNoise2 = veilFbm(vec2(warped.x * 4.0 - t * 0.025 * drift, warped.y * 5.0 + yOffset * 1.5) + fi * 8.0, 3);
      float ridged2 = 1.0 - abs(rNoise2 * 2.0 - 1.0);
      ridged2 = pow(ridged2, 5.0);

      float ribbon = ridged * 0.7 + ridged2 * 0.3;

      vec3 bandColor;
      if (i == 0) bandColor = vec3(0.55, 0.45, 0.80);        /* lavender */
      else if (i == 1) bandColor = vec3(0.80, 0.50, 0.60);   /* soft pink */
      else bandColor = vec3(0.85, 0.75, 0.50);               /* pale gold */

      float breath = 0.6 + 0.4 * sin(t * 0.08 + fi * 1.3);
      col += bandColor * ribbon * breath * 0.18;
    }
    return col;
  }

  /* --- Layers 3-5: parallax stardust. Core DROPPED (the bullet-band knob) — only
     the broadened, dimmed Gaussian glow survives, so each star is a soft dust blob.
     Flares and connecting threads are dropped entirely. --- */
  float veilStars(vec2 uv, float scale, float threshold, float t, float speed, float seed) {
    vec2 p = uv * scale;
    p.y += t * speed * VEIL_DRIFT;
    p.x += t * speed * VEIL_DRIFT * 0.3 + sin(t * 0.05) * 0.2;

    vec2 cell = floor(p);
    vec2 f = fract(p);
    float stars = 0.0;

    for (int dy = -1; dy <= 1; dy++) {
      for (int dx = -1; dx <= 1; dx++) {
        vec2 neighbor = vec2(float(dx), float(dy));
        vec2 cellId = cell + neighbor;
        vec2 starCenter = veilHash2(cellId + seed);
        vec2 diff = neighbor + starCenter - f;
        float dist = length(diff);

        float present    = step(threshold, veilHash(cellId * 0.7 + seed + 77.0));
        float brightness = veilHash(cellId * 1.3 + seed + 33.0);
        float twPhase    = veilHash(cellId * 2.1 + seed + 99.0) * VEIL_TAU;
        float twSpeed    = 0.8 + veilHash(cellId * 3.7 + seed + 55.0) * 2.0;
        float twinkle    = 0.6 + 0.4 * sin(t * twSpeed + twPhase);   /* amplitude eased 0.5->0.4 */

        float starSize = 0.02 + brightness * 0.02;                  /* min raised so the glow is broader */
        float glow = exp(-dist * dist / (starSize * starSize * 4.0 * VEIL_STAR_GLOW_WIDEN));

        stars += glow * VEIL_STAR_GLOW_GAIN * brightness * twinkle * present;
      }
    }
    return stars;
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

  /* Compose the veil in LINEAR space (pre-tonemap). p is the reference's
     min-dimension-centred coord; starGain folds the reference u_starDensity and the
     per-scene dimming into one knob. */
  vec3 veilCompose(vec2 p, float t, float starGain) {
    vec3 col = veilNebula(p, t);
    col += veilAurora(p, t);

    col += vec3(0.65, 0.72, 0.90) * veilStars(p, 35.0, 0.35, t, 0.02, 0.0)   * 0.25 * starGain;  /* far, cool white-blue */
    col += vec3(0.80, 0.65, 0.85) * veilStars(p, 18.0, 0.45, t, 0.06, 100.0) * 0.45 * starGain;  /* mid, pink-lavender */
    col += vec3(0.90, 0.75, 0.60) * veilStars(p,  8.0, 0.65, t, 0.12, 200.0) * 0.55 * starGain;  /* near, warm gold-pink */
    /* flares (bright warm pulses) and connecting threads (thin lines) dropped — both bullet-band. */

    float wave = veilWave(p, t);
    col *= 1.0 + wave;
    col += vec3(0.70, 0.60, 0.85) * wave * 0.04;   /* lavender wind wash */

    /* Faint overall shimmer — low-frequency, uses the shared bgNoise. */
    float shimmer = bgNoise(p * 12.0 + t * 0.5) * bgNoise(p * 8.0 - t * 0.3);
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

    const float EXPOSURE  = 0.25;   /* 出神 pair — the dimmest family, below sable */
    const float STAR_GAIN = 0.5;    /* stardust dimmed well under a bullet */

    /* Cold blue-violet — the warmth drained as the seal unmoors. The reference
       nebula is already blue-violet, so umbra is "the veil as-is, dimmed". */
    const vec3 VEIL_TINT = vec3(0.72, 0.80, 1.14);

    vec3 background(vec2 uv) {
      float t = uScroll * 0.012;

      /* The whole veil precesses slowly off-station — the unmoored sway.
         sin/cos of uScroll only, a pure function of ticks, no wall clock. */
      vec2 drift = 0.03 * vec2(cos(uScroll * 0.004), sin(uScroll * 0.004));
      vec2 p = veilCoord(uv, drift);

      vec3 col = veilCompose(p, t, STAR_GAIN);
      col = veilGrade(col, VEIL_TINT, 0.32);

      /* Total Eclipse: a soft shadow band sweeps the field on uScroll. It only ever
         MULTIPLIES down (0.55..1.0), so luminance cannot rise above the veil —
         coherence and shadow cross, brightness does not. */
      float eclipse = 0.55 + 0.45 * (0.5 + 0.5 * sin(uScroll * 0.0025 - uv.y * 3.0));
      col *= eclipse;

      col = veilTonemap(col);
      return col * EXPOSURE;
    }
  `,
});
