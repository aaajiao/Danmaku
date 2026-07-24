/**
 * `stratum` — stage 3, re-authored from the original dither-gradient port.
 *
 * Its real identity is the slowly rotating three-centre gradient whose bit depth
 * travels across the field. That remains the whole image. V4 enlarges the
 * quantisation into broad settling terraces: no Bayer grid, halftone dots,
 * cross-hatch or archive-panel iconography. Cold soot, grey-brown sediment,
 * controlled amber and bone replace verdigris. The grade is designed for
 * production ×1, with only a mild reduction through the lower player band.
 *
 * V4 hybrid pass: the original moving three-centre field remains the complete
 * luminous image. The soot-and-slate Ghost plate is never composited as an
 * opaque colour layer; production reduces it to low-frequency relief and chroma
 * that grade the moving shader underneath. The result keeps the illustrated
 * sediment silhouette without hiding the shader's internal motion, and the
 * complete production blend remains locked to the logical pixel grid.
 *
 * Clock: fixed-tick `uScroll` only (CLAUDE.md rule 1). The field is derived from
 * pbakaus/radiant `dither-gradient` (MIT).
 */

import STRATUM_ART_URL from '../../assets/v4/backgrounds/stratum-v4.png';
import { defineBackground } from '../../render/background';

defineBackground('stratum', {
  scrollSpeed: 0.7,
  art: {
    url: STRATUM_ART_URL,
    width: 480,
    height: 640,
  },
  fragment: /* glsl */ `
    uniform sampler2D uArt;
    uniform vec2 uArtRes;
    uniform float uArtMode;  /* 0 shader, 1 painted plate, 2 production hybrid */

    const float DG_TAU = 6.28318530718;
    const float EXPOSURE = 0.92;
    const float STRATUM_TIME = 0.014375; /* reviewed +15% internal pace */

    float dgHash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    float dgNoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(dgHash(i), dgHash(i + vec2(1.0, 0.0)), f.x),
                 mix(dgHash(i + vec2(0.0, 1.0)), dgHash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    float dgFbm(vec2 p) {
      float v = 0.0, a = 0.5;
      mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
      for (int i = 0; i < 4; i++) { v += a * dgNoise(p); p = rot * p * 2.0 + vec2(100.0); a *= 0.5; }
      return v;
    }

    /* The reference's flowing three-centre gradient, returned as a scalar field. */
    float baseGradient(vec2 uv, float t) {
      float angle = t * 0.05;
      mat2 rot = mat2(cos(angle), sin(angle), -sin(angle), cos(angle));
      vec2 ruv = rot * uv;
      vec2 c1 = vec2(0.35 * sin(t * 0.07), 0.25 * cos(t * 0.09));
      vec2 c2 = vec2(-0.3 * cos(t * 0.06 + 1.0), 0.3 * sin(t * 0.08 + 2.0));
      vec2 c3 = vec2(0.2 * sin(t * 0.11 + 3.0), -0.35 * cos(t * 0.05 + 1.5));
      float d1 = length(ruv - c1), d2 = length(ruv - c2), d3 = length(ruv - c3);
      float a1 = atan(ruv.y - c1.y, ruv.x - c1.x);
      float a2 = atan(ruv.y - c2.y, ruv.x - c2.x);
      float g1 = sin(d1 * 3.0 - t * 0.15 + a1 * 0.5) * 0.5 + 0.5;
      float g2 = cos(d2 * 2.5 + t * 0.12 - a2 * 0.3) * 0.5 + 0.5;
      float g3 = sin(d3 * 4.0 + t * 0.1 + d1 * 2.0) * 0.5 + 0.5;
      float warp = dgFbm(ruv * 2.0 + t * 0.05) * 0.3;
      float f = clamp(g1 * 0.4 + g2 * 0.35 + g3 * 0.25 + warp, 0.0, 1.0);
      return f;
    }

    vec3 stratumShader(vec2 uv) {
      float aspect = uRes.x / uRes.y;
      vec2 sc = vec2((uv.x - 0.5) * aspect, (uv.y - 0.5));
      float t = uScroll * STRATUM_TIME;

      float gradientField = baseGradient(sc, t);

      /* The original traveling bit-depth wave now moves broad tonal terraces. */
      float waveAngle = t * 0.08;
      vec2 waveDir = vec2(cos(waveAngle), sin(waveAngle));
      float wavePos = dot(sc, waveDir);
      float wave1 = sin(wavePos * 4.0 - t * 0.3) * 0.5 + 0.5;
      float wave2 = sin(dot(sc, vec2(sin(t * 0.05), cos(t * 0.07))) * 6.0 + t * 0.2) * 0.5 + 0.5;
      float waveMix = wave1 * 0.6 + wave2 * 0.4;
      float levels = mix(3.5, 7.0, waveMix);
      float threshold = dgFbm(sc * 1.05 + vec2(t * 0.035, -t * 0.025));
      float layerCoord = sc.y
        + (gradientField - 0.5) * 0.22
        + dgFbm(vec2(sc.x * 1.35, sc.y * 0.58) + vec2(t * 0.035, 12.0)) * 0.12
        + waveMix * 0.050
        + threshold * 0.025;
      float terracePhase = layerCoord * levels * DG_TAU - t * 0.72;
      float terraceWave = sin(terracePhase) * 0.5 + 0.5;
      float terrace = smoothstep(0.14, 0.86, terraceWave);

      float settling = sin(layerCoord * 10.0 - t * 0.36) * 0.5 + 0.5;
      float shelf = smoothstep(0.38, 0.76, settling);
      vec3 soot = vec3(0.022, 0.028, 0.040);
      vec3 sediment = vec3(0.205, 0.195, 0.195);
      vec3 bone = vec3(0.510, 0.495, 0.465);
      vec3 smoothColor = mix(
        soot,
        sediment,
        smoothstep(0.12, 0.82, gradientField)
      );
      smoothColor = mix(
        smoothColor,
        bone,
        smoothstep(0.68, 0.96, gradientField) * 0.32
      );

      vec3 finalColor = smoothColor * mix(0.62, 1.24, terrace);
      finalColor += vec3(0.145, 0.128, 0.112) * shelf * 0.060;

      float travelingBand = smoothstep(0.24, 0.80, waveMix);
      finalColor += vec3(0.135, 0.130, 0.128) * travelingBand * 0.050;

      float vig = clamp(1.0 - dot(sc * 0.72, sc * 0.72), 0.0, 1.0);
      finalColor *= 0.78 + 0.22 * vig;

      float activityCalm = 1.0 - 0.12 * smoothstep(0.58, 0.96, uv.y);
      finalColor = finalColor / (1.0 + finalColor * 0.25);
      return max(finalColor, 0.0) * EXPOSURE * activityCalm;
    }

    vec2 stratumPixelUv(vec2 uv) {
      vec2 safeUv = clamp(uv, vec2(0.0), vec2(1.0) - 0.5 / uArtRes);
      return (floor(safeUv * uArtRes) + 0.5) / uArtRes;
    }

    vec3 stratumArt(vec2 pixelUv) {
      vec2 sampleUv = clamp(
        pixelUv,
        0.5 / uArtRes,
        vec2(1.0) - 0.5 / uArtRes
      );
      vec3 painted = texture2D(uArt, sampleUv).rgb;
      /* Broad connected slate edges survive at x1; the runtime palette omits
         bone-white and every saturated projectile register. */
      painted = pow(max(painted, vec3(0.0)), vec3(1.10)) * 0.52;
      return min(painted, vec3(0.29));
    }

    float stratumLuma(vec3 colour) {
      return dot(colour, vec3(0.2126, 0.7152, 0.0722));
    }

    vec3 background(vec2 uv) {
      if (uArtMode < 0.5) return stratumShader(uv);

      /* Production snaps the entire hybrid, while shader-only keeps the smooth
         reviewed source for diagnostics and motion comparisons. */
      vec2 pixelUv = stratumPixelUv(uv);
      vec3 painted = stratumArt(pixelUv);
      if (uArtMode < 1.5) return painted;

      /* Shader first: the plate is sampled only as a relief map. Its 240×320
         authored cells were expanded 2×, so two texture pixels reach the next
         independent sample. No painted RGB term can cover the moving field. */
      vec2 cellStep = 2.0 / uArtRes;
      float paintedLuma = stratumLuma(painted);
      float neighbourLuma = (
        stratumLuma(stratumArt(pixelUv + vec2(cellStep.x, 0.0)))
        + stratumLuma(stratumArt(pixelUv - vec2(cellStep.x, 0.0)))
        + stratumLuma(stratumArt(pixelUv + vec2(0.0, cellStep.y)))
        + stratumLuma(stratumArt(pixelUv - vec2(0.0, cellStep.y)))
      ) * 0.25;
      float broadRelief = smoothstep(
        0.018,
        0.155,
        mix(neighbourLuma, paintedLuma, 0.68)
      );
      float localRelief = paintedLuma - neighbourLuma;

      vec3 shaderColor = stratumShader(pixelUv);
      float reliefGain = clamp(
        0.90 + broadRelief * 0.20 + localRelief * 1.35,
        0.86,
        1.14
      );
      vec3 hybrid = shaderColor * reliefGain;

      /* Preserve only a small near-isoluminant trace of the plate palette.
         Motion and luminance remain those of stratumShader(). */
      vec3 plateChroma = painted - vec3(paintedLuma);
      hybrid += plateChroma * (0.055 + broadRelief * 0.060);
      return min(max(hybrid, vec3(0.0)), vec3(0.32));
    }
  `,
});
