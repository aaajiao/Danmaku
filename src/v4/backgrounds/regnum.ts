/**
 * `regnum` — the Regent's field, re-authored from the original topographic port.
 * The unfurled four-octave terrain and fourteen analytic contour levels again
 * generate the whole picture; no throne, face, seat or bilateral emblem is
 * inserted into the elevation. V4 supplies a visible charred-lacquer relief
 * beneath continuous ash-rose and warm-bone elevation grades drawn from the
 * Regent's Ghost body, root crown and restrained heart core. Broad slope
 * lighting exposes the existing four-octave detail while softened contour
 * shoulders keep the organic map legible at production ×1.
 *
 * Clock: fixed-tick `uScroll` only (CLAUDE.md rule 1). The source image and
 * analytic iso-line technique derive from pbakaus/radiant `topographic` (MIT).
 */

import REGNUM_ART_URL from '../../assets/v4/backgrounds/regnum-v4-sequence.png';
import { defineBackground } from '../../render/background';

defineBackground('regnum', {
  scrollSpeed: 0.8,
  art: {
    url: REGNUM_ART_URL,
    width: 960,
    height: 1280,
  },
  fragment: /* glsl */ `
    uniform sampler2D uArt;
    uniform vec2 uArtRes;
    uniform float uArtMode;  /* 0 shader, 1 painted plate, 2 production hybrid */

    /* Final-boss station: clearly present at ×1, still below actors and bullets. */
    const float EXPOSURE = 1.72;
    const vec2 REGNUM_ATLAS_GRID = vec2(4.0, 4.0);
    const float REGNUM_ART_FRAMES = 16.0;
    const float REGNUM_FRAME_TICKS = 14.0;
    const float REGNUM_TAU = 6.28318530718;

    /* Preserve the original renderer's defining fourteen elevations. */
    const float LEVELS = 14.0;

    /* Lower frequency and stretch widen the relief without deleting its levels. */
    const float FIELD_SCALE = 1.35;
    const float FIELD_STRETCH = 1.45;

    /* Contours crowded near bullet-scale pitch remain present but subordinate. */
    const float TIGHT_MIN = 26.0;
    const float TIGHT_OK  = 56.0;
    const float TIGHT_FLOOR = 0.20;

    /* Wide bright lines move slowly enough to remain continuous at production ×1. */
    const float TOPO_TIME = 0.0017;

    /* REGENT's runtime body is cold Ghost-grey with bone-white roots and one
       small pale heart. The field therefore uses charred lacquer, ash rose and
       warm pearl—not the legacy fallback's royal purple/gold registers. */
    const vec3 BASE        = vec3(0.012, 0.007, 0.011);
    const vec3 WASH_LOW    = vec3(0.075, 0.034, 0.048);
    const vec3 WASH_MID    = vec3(0.180, 0.060, 0.080);
    const vec3 WASH_ASH    = vec3(0.120, 0.110, 0.120);
    const vec3 LINE_LOW    = vec3(0.320, 0.080, 0.140);
    const vec3 LINE_MID    = vec3(0.580, 0.180, 0.270);
    const vec3 LINE_HEART  = vec3(0.680, 0.400, 0.480);
    const vec3 LINE_PEARL  = vec3(0.620, 0.560, 0.590);

    /* Compact 3D value noise (tp* so nothing collides with bgFbm or the tear* in
       the compose wrapper). Pure arithmetic — deterministic across GPUs. */
    float tpHash(vec3 p) {
      p = fract(p * vec3(0.1031, 0.1030, 0.0973));
      p += dot(p, p.yxz + 33.33);
      return fract((p.x + p.y) * p.z);
    }

    float tpNoise3(vec3 x) {
      vec3 i = floor(x);
      vec3 f = fract(x);
      vec3 u = f * f * (3.0 - 2.0 * f);
      float n000 = tpHash(i + vec3(0.0, 0.0, 0.0));
      float n100 = tpHash(i + vec3(1.0, 0.0, 0.0));
      float n010 = tpHash(i + vec3(0.0, 1.0, 0.0));
      float n110 = tpHash(i + vec3(1.0, 1.0, 0.0));
      float n001 = tpHash(i + vec3(0.0, 0.0, 1.0));
      float n101 = tpHash(i + vec3(1.0, 0.0, 1.0));
      float n011 = tpHash(i + vec3(0.0, 1.0, 1.0));
      float n111 = tpHash(i + vec3(1.0, 1.0, 1.0));
      float nx00 = mix(n000, n100, u.x);
      float nx10 = mix(n010, n110, u.x);
      float nx01 = mix(n001, n101, u.x);
      float nx11 = mix(n011, n111, u.x);
      return mix(mix(nx00, nx10, u.y), mix(nx01, nx11, u.y), u.z);
    }

    /* The original unfurled four-octave relief; no semantic shape is injected. */
    float tpField(vec2 uv, float aspect, float t) {
      vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5) * FIELD_SCALE;
      float val = 0.0, amp = 1.0, freq = 1.0, sum = 0.0;
      for (int o = 0; o < 4; o++) {
        val += tpNoise3(vec3(p * freq, t)) * amp;
        sum += amp;
        amp *= 0.5;
        freq *= 2.0;
      }
      return clamp((val / sum - 0.5) * FIELD_STRETCH + 0.5, 0.0, 1.0);
    }

    vec3 regnumWash(float height) {
      if (height < 0.46) {
        return mix(WASH_LOW, WASH_MID, smoothstep(0.06, 0.46, height));
      }
      return mix(WASH_MID, WASH_ASH, smoothstep(0.46, 0.92, height));
    }

    vec3 regnumLine(float height) {
      if (height < 0.40) {
        return mix(LINE_LOW, LINE_MID, smoothstep(0.04, 0.40, height));
      }
      if (height < 0.68) {
        return mix(LINE_MID, LINE_HEART, smoothstep(0.40, 0.68, height));
      }
      return mix(LINE_HEART, LINE_PEARL, smoothstep(0.68, 0.96, height));
    }

    vec2 regnumScenePixelUv(vec2 uv) {
      vec2 safeUv = clamp(
        uv,
        vec2(0.0),
        vec2(1.0) - 0.5 / uRes
      );
      return (floor(safeUv * uRes) + 0.5) / uRes;
    }

    vec2 regnumArtPixelUv(vec2 uv) {
      vec2 frameRes = uArtRes / REGNUM_ATLAS_GRID;
      vec2 safeUv = clamp(
        uv,
        vec2(0.0),
        vec2(1.0) - 0.5 / frameRes
      );
      return (floor(safeUv * frameRes) + 0.5) / frameRes;
    }

    vec3 regnumArtFrame(vec2 pixelUv, float frame) {
      float wrapped = mod(frame, REGNUM_ART_FRAMES);
      vec2 tile = vec2(
        mod(wrapped, REGNUM_ATLAS_GRID.x),
        floor(wrapped / REGNUM_ATLAS_GRID.x)
      );
      vec2 atlasUv = (tile + pixelUv) / REGNUM_ATLAS_GRID;
      vec3 painted = texture2D(uArt, atlasUv).rgb;

      /* The sequence is material, not a second light field. Lift its charred
         lacquer and ash colour enough to survive hybrid weighting while keeping
         the actor's true heart/bone tiers exclusive. */
      painted = pow(max(painted, vec3(0.0)), vec3(1.06)) * 0.70;
      float paintedLuma = dot(painted, vec3(0.2126, 0.7152, 0.0722));
      vec3 chroma = painted - vec3(paintedLuma);
      painted = vec3(paintedLuma) + chroma * 1.18;
      return min(max(painted, vec3(0.0)), vec3(0.25));
    }

    vec3 regnumArt(vec2 pixelUv) {
      /* uScroll is scene-local and advances by 0.8/tick, so the atlas begins at
         frame zero each time REGNUM enters without changing shader speed. */
      float sceneTick = uScroll / 0.8;
      float phase = mod(sceneTick / REGNUM_FRAME_TICKS, REGNUM_ART_FRAMES);
      float frame = floor(phase);
      float travel = fract(phase);
      /* Monotone push/drag: no rest, no fifth-order breath, no wall descent. */
      float blend = travel + 0.022 * sin(REGNUM_TAU * travel);
      return mix(
        regnumArtFrame(pixelUv, frame),
        regnumArtFrame(pixelUv, frame + 1.0),
        blend
      );
    }

    vec3 regnumShader(vec2 uv) {
      float aspect = uRes.x / uRes.y;
      /* A non-integer fixed phase avoids value-noise's zero-derivative start.
         Scroll speed and morph rate remain unchanged. */
      float t = 0.37 + uScroll * TOPO_TIME;

      /* Field, and its analytic gradient by one-pixel finite differences (no dFdx,
         deterministic). |df| per pixel drives constant-width strokes and the pitch. */
      float fc = tpField(uv, aspect, t);
      vec2 texel = 1.0 / uRes;
      float fx = tpField(uv + vec2(texel.x, 0.0), aspect, t);
      float fy = tpField(uv + vec2(0.0, texel.y), aspect, t);
      float gradMag = length(vec2(fx - fc, fy - fc));       /* |df| / pixel */

      /* g crosses an integer at every contour; the nearest one is this pixel's line. */
      float g = fc * (LEVELS + 1.0);
      float level = floor(g + 0.5);
      float distG = abs(g - level);                         /* to nearest line, g-units */
      float dgdpx = gradMag * (LEVELS + 1.0);               /* g change per pixel */
      /* Flat terrain can move an iso-line many pixels for a tiny field change.
         A minimum rendering gradient turns that would-be temporal pop into a
         broad shoulder; spacing still uses the true gradient for its grade. */
      float renderDgdpx = max(dgdpx, 0.060);
      float distPx = distG / renderDgdpx;                   /* pixel distance to line */
      float spacingPx = 1.0 / max(dgdpx, 1e-6);             /* pitch to the neighbour */

      /* Two slow, unequal fixed-tick curves let material bands pass through the
         same connected relief without pretending to know the kill-speed-dependent
         boss phase. The first twenty seconds gently finish unfurling the range. */
      float sceneTick = uScroll / 0.8;
      float paletteA = sin(sceneTick * 0.0031 + fc * 5.6);
      float paletteB = sin(sceneTick * 0.0017 - fc * 3.8 + 1.4);
      float settle = smoothstep(0.0, 1200.0, sceneTick);
      float paletteH = clamp(
        fc
          + paletteA * 0.030
          + paletteB * 0.014
          + (fc - 0.5) * 0.035 * settle,
        0.0,
        1.0
      );

      /* A low-frequency lacquer fill carries more of the picture than the line
         spines. Existing finite differences provide broad slope light, revealing
         the four authored octaves without adding a finer noise register. */
      float relief = smoothstep(0.12, 0.88, fc);
      vec3 wash = regnumWash(paletteH);
      vec3 col = BASE + wash * (0.27 + relief * 0.25);
      float slope = dot(
        vec2(fx - fc, fy - fc) * uRes,
        vec2(-0.26, 0.18)
      );
      float facing = smoothstep(-0.85, 0.85, slope);
      col *= 0.90 + 0.20 * facing;
      /* A cool shadow is kept inside the lacquer rather than promoted to a
         bright cyan line; the Regent's bone and projectile cores stay unique. */
      col += vec3(0.025, 0.034, 0.052)
        * (1.0 - facing)
        * (0.025 + relief * 0.035);
      /* One broad, connected pearl reflection makes the whole worn system read
         as final-boss material even when no contour spine crosses the viewport.
         It follows the authored slope and stays quiet in the player band. */
      float pearlGlaze = pow(facing, 2.2)
        * (0.024 + relief * 0.036)
        * (1.0 - 0.30 * smoothstep(0.62, 0.94, uv.y));
      col += LINE_PEARL * pearlGlaze;

      /* Her crown, face and distress heart occupy the upper station. Reserve
         contrast there without carving a centered symbol into the field. */
      float stationQuiet = smoothstep(0.20, 0.36, uv.y);
      col *= mix(0.72, 1.0, stationQuiet);

      /* Only the interior thresholds (1..LEVELS) carry a line, exactly as the
         reference's (c+1)/(LEVELS+1) for c in 0..LEVELS-1. */
      if (level >= 1.0 && level <= LEVELS) {
        float threshold = level / (LEVELS + 1.0);

        /* Charred pomegranate rises through ash rose into warm-bone pearl. The
           true #F0D8E2 heart colour remains exclusive to the actor. */
        vec3 lineColor = regnumLine(paletteH);

        /* Centre-bright / extreme-dim alpha; the original every-fifth major line. */
        float distFromCenter = abs(threshold - 0.5) * 2.0;
        float baseAlpha = 0.25 + (1.0 - distFromCenter) * 0.32;
        float isMajor = mod(level - 1.0, 5.0) < 0.5 ? 1.0 : 0.0;

        /* A visible shoulder plus a continuous spine. Width, not diagnostic gain,
           makes the lines survive the 480×640 production view. */
        float glowWidth  = mix(10.5, 15.5, isMajor);
        float sharpWidth = mix(5.0, 7.2, isMajor);
        float glowAlpha  = baseAlpha * 0.13;
        float sharpAlpha = baseAlpha * mix(0.15, 0.20, isMajor);
        float glow  = 1.0 - smoothstep(glowWidth * 0.5 - 1.5, glowWidth * 0.5 + 1.5, distPx);
        float sharp = 1.0 - smoothstep(sharpWidth * 0.5 - 1.4, sharpWidth * 0.5 + 1.4, distPx);
        float phaseGuard = 1.0 - smoothstep(0.30, 0.49, distG);
        float lineTerm = (glow * glowAlpha + sharp * sharpAlpha) * phaseGuard;

        /* Grade crowded lines without deleting the field. In the lower activity
           band the same continuous contours remain at one fifth contrast. */
        lineTerm *= mix(TIGHT_FLOOR, 1.0, smoothstep(TIGHT_MIN, TIGHT_OK, spacingPx));
        lineTerm *= mix(0.52, 1.0, stationQuiet);
        lineTerm *= 1.0 - 0.34 * smoothstep(0.62, 0.94, uv.y);

        col += lineColor * lineTerm;
      }

      /* A restrained lacquer vignette—enough depth, not enough to erase the map. */
      vec2 vc = (uv - 0.5) * vec2(aspect, 1.0);
      col *= 1.0 - 0.22 * smoothstep(0.22, 0.58, length(vc));

      return col * EXPOSURE;
    }

    vec3 background(vec2 uv) {
      if (uArtMode < 0.5) return regnumShader(uv);

      vec2 scenePixelUv = regnumScenePixelUv(uv);
      vec2 artPixelUv = regnumArtPixelUv(uv);
      vec3 painted = regnumArt(artPixelUv);
      if (uArtMode < 1.5) return painted;

      /* The low-frequency plate is underpaint only. The live fourteen-level
         topography stays at essentially full weight and is added last, so no
         atlas frame can cover its motion or highlights. */
      vec3 shaderColor = regnumShader(scenePixelUv);
      float shaderLuma = dot(shaderColor, vec3(0.2126, 0.7152, 0.0722));
      float paintedLuma = dot(painted, vec3(0.2126, 0.7152, 0.0722));
      float topKey = smoothstep(0.045, 0.22, shaderLuma);
      float stationCalm = mix(0.76, 1.0, smoothstep(0.20, 0.36, uv.y));
      float playerCalm = 1.0 - 0.18 * smoothstep(0.62, 0.94, uv.y);
      float underGain = mix(0.46, 0.28, topKey) * stationCalm * playerCalm;

      vec3 hybrid = painted * underGain;
      hybrid += shaderColor * (0.98 + paintedLuma * 0.08);
      return hybrid / (vec3(1.0) + hybrid * 0.30);
    }
  `,
});
