/**
 * `expanse` — stage 1. A NEAR-IDENTICAL port of pbakaus/radiant `lens-whisper`
 * (MIT): point lights seen through an anamorphic lens, each drawn as a
 * horizontally-stretched streak with per-channel chromatic split and concentric
 * bokeh-ring halos, drifting on slow Lissajous orbits over a near-black haze.
 *
 * ## What was ported
 *
 * The reference verbatim in structure: six lights with per-light hashed tints
 * (cobalt, amber, teal, warm white, rose, cool white) on independent Lissajous
 * orbits with noise perturbation and a subtle brightness pulse; per light the
 * anamorphic streak (very wide in x, tight in y) with the warm-orange-left /
 * cool-blue-right chromatic fringe, the secondary wider streak, and the two
 * concentric bokeh-ring halos; the FBM haze field; and the compressive tonemap.
 *
 * ## Adaptation to our surface (the only departures from the reference)
 *
 *   - The tight Gaussian point CORE (`exp(-d*d*160)`) is DROPPED — a bright
 *     bullet-sized pinpoint is exactly a fake bullet. The anamorphic streaks and
 *     hollow bokeh rings (the actual lens-whisper identity) carry the picture.
 *   - The lens-dust sparkle and film grain are DROPPED — both are per-pixel
 *     high-frequency terms that read as speckle/bullets in the play band.
 *   - The two bokeh-ring walls are broadened (`3500->520`, `5000->380`) so the
 *     ring sits bullet-COARSE rather than at ~6px; the streak's y-tightness is
 *     eased likewise. Everything else is the reference.
 *   - Uniforms baked: `u_flareSpread` (1.0), `u_driftSpeed` (0.5 -> the clock);
 *     `u_mouse` (the cursor light) is excised.
 *   - Clock: `t = uScroll * 0.012`, matching the reference's `u_time*0.5` rate at
 *     60 ticks/s. `uScroll` advances only in `step()`.
 *   - EXPOSURE 0.42 over the compressive tonemap: stage 1 opens the game, so it is
 *     the dimmest of the "own picture" scenes and leaves the most curtain headroom
 *     of the stages — the field is near-black between flares.
 *
 * ## Exposure & readability
 *
 * Stage-1 tier. Bright streaks crest in the ~0.25-0.33 band, the near-black haze
 * between them far below [MEASURED-IN-ACCEPTANCE]. No tight cores, no per-pixel
 * terms; the sharpest surviving feature (a bokeh ring wall) is broadened to
 * bullet-coarse. Motion: lens drift + ring breathe, per-tick step under the strobe
 * bound [MEASURED-IN-ACCEPTANCE].
 *
 * ## Clock
 *
 * `uScroll` only — no wall clock (see `background.ts`, rule 1);
 * `backgrounds/index.test.ts` scans this file for wall-clock sources.
 *
 * lens-whisper by pbakaus/radiant, MIT. Ported; our clock, cores/grain dropped,
 * bokeh broadened, exposure ours.
 */

import { BACKGROUND_NOISE_GLSL, defineBackground } from '../../render/background';

defineBackground('expanse', {
  scrollSpeed: 0.7,
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}

    const float LW_PI = 3.14159265359;
    const float EXPOSURE = 0.42;   /* stage 1 — most curtain headroom */

    float lwHash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    float lwHash1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
    float lwNoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(lwHash(i), lwHash(i + vec2(1.0, 0.0)), f.x),
        mix(lwHash(i + vec2(0.0, 1.0)), lwHash(i + vec2(1.0, 1.0)), f.x),
        f.y);
    }
    float lwFbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 4; i++) {
        v += a * lwNoise(p);
        p = p * 2.1 + vec2(1.7, 3.2);
        a *= 0.5;
      }
      return v;
    }

    vec3 lightTint(int idx) {
      if (idx == 0) return vec3(0.30, 0.45, 1.00);
      if (idx == 1) return vec3(1.00, 0.65, 0.20);
      if (idx == 2) return vec3(0.20, 0.85, 0.75);
      if (idx == 3) return vec3(1.00, 0.92, 0.80);
      if (idx == 4) return vec3(0.95, 0.40, 0.55);
      return vec3(0.75, 0.85, 1.00);
    }

    vec2 lightPos(int idx, float t) {
      float fi = float(idx);
      float seed = fi * 47.3;
      float ax = 0.30 + lwHash1(seed) * 0.20;
      float ay = 0.35 + lwHash1(seed + 1.0) * 0.20;
      float fx = 0.07 + lwHash1(seed + 2.0) * 0.05;
      float fy = 0.05 + lwHash1(seed + 3.0) * 0.04;
      float px = lwHash1(seed + 4.0) * LW_PI * 2.0;
      float py = lwHash1(seed + 5.0) * LW_PI * 2.0;
      float nx = lwNoise(vec2(t * 0.03 + fi * 10.0, 0.0)) * 0.08 - 0.04;
      float ny = lwNoise(vec2(0.0, t * 0.025 + fi * 10.0)) * 0.06 - 0.03;
      return vec2(sin(t * fx + px) * ax + nx, sin(t * fy + py) * ay + ny);
    }
    float lightBrightness(int idx, float t) {
      float fi = float(idx);
      float base = 0.45 + lwHash1(fi * 13.7 + 100.0) * 0.25;
      float pulse = sin(t * (0.15 + lwHash1(fi * 23.1) * 0.1) + fi * 2.0) * 0.12;
      return base + pulse;
    }

    /* Anamorphic flare, tight core removed, bokeh walls broadened. */
    vec3 anamorphicFlare(vec2 uv, vec2 lp, float brightness, vec3 tint) {
      vec2 delta = uv - lp;
      float stretch = 7.0;
      float coreD = length(delta);

      float streakDx = delta.x / stretch;
      float streakDy = delta.y;
      float streakD = streakDx * streakDx * 12.0 + streakDy * streakDy * 420.0;
      float streak = exp(-streakD) * brightness * 0.35;

      float chromaOffset = 0.015;
      float streakR_dx = (delta.x - chromaOffset) / stretch;
      float streakB_dx = (delta.x + chromaOffset) / stretch;
      float streakR_d = streakR_dx * streakR_dx * 12.0 + streakDy * streakDy * 420.0;
      float streakB_d = streakB_dx * streakB_dx * 12.0 + streakDy * streakDy * 420.0;
      float streakR = exp(-streakR_d) * brightness * 0.35;
      float streakB = exp(-streakB_d) * brightness * 0.35;

      float edgeness = smoothstep(0.0, 0.35, abs(delta.x));
      vec3 warmFringe = vec3(1.00, 0.55, 0.15);
      vec3 coolFringe = vec3(0.15, 0.35, 1.00);
      vec3 leftColor = mix(tint, warmFringe, edgeness);
      vec3 rightColor = mix(tint, coolFringe, edgeness);
      vec3 streakTint = mix(leftColor, rightColor, smoothstep(-0.1, 0.1, delta.x));

      vec3 streakCol = vec3(0.0);
      streakCol.r = streakR * streakTint.r;
      streakCol.g = streak * streakTint.g;
      streakCol.b = streakB * streakTint.b;

      float wideStretch = stretch * 1.6;
      float wideDx = delta.x / wideStretch;
      float wideD = wideDx * wideDx * 8.0 + streakDy * streakDy * 500.0;
      float wideStreak = exp(-wideD) * brightness * 0.15;
      vec3 wideCol = mix(tint * 0.6, mix(warmFringe, coolFringe, smoothstep(-0.2, 0.2, delta.x)) * 0.4, edgeness) * wideStreak;

      /* Bokeh rings, broadened to bullet-coarse (3500->520, 5000->380). */
      float haloR = 0.05 + brightness * 0.015;
      float haloDist = abs(coreD - haloR);
      float halo = exp(-haloDist * haloDist * 520.0) * brightness * 0.12;
      float haloR2 = haloR * 1.8;
      float haloDist2 = abs(coreD - haloR2);
      float halo2 = exp(-haloDist2 * haloDist2 * 380.0) * brightness * 0.05;
      vec3 haloCol = tint * 0.8 * halo + vec3(0.50, 0.60, 0.80) * halo2;

      return streakCol + wideCol + haloCol;
    }

    vec3 background(vec2 uv) {
      float aspect = uRes.x / uRes.y;
      float t = uScroll * 0.012;
      /* Reference centred coord (min-dimension normalized, y-down retained). */
      vec2 sc = vec2((uv.x - 0.5) * aspect, (uv.y - 0.5));

      vec3 col = vec3(0.0);

      vec2 hazeUV = sc * 1.5 + vec2(t * 0.01, t * 0.007);
      float hazeNoise = lwFbm(hazeUV);
      float hazeNoise2 = lwFbm(hazeUV * 0.7 + vec2(5.3, 2.1));
      vec3 hazeColor = mix(vec3(0.20, 0.28, 0.45), vec3(0.12, 0.18, 0.35), hazeNoise2);
      col += hazeColor * hazeNoise * 0.03;

      for (int i = 0; i < 6; i++) {
        vec2 lp = lightPos(i, t);
        float bright = lightBrightness(i, t);
        vec3 tint = lightTint(i);
        col += anamorphicFlare(sc, lp, bright, tint);
      }

      float vd = length(sc * vec2(1.2, 1.0));
      float vignette = 1.0 - smoothstep(0.3, 0.95, vd);
      vignette = vignette * vignette;
      col *= vignette;

      col = max(col, vec3(0.0));
      col = col / (col + vec3(0.6)) * 1.5;   /* reference compressive tonemap */
      return col * EXPOSURE;
    }
  `,
});
