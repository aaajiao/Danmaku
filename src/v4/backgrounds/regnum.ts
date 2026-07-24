/**
 * `regnum` — the Regent's field, re-authored from the original topographic port.
 * The unfurled four-octave terrain and fourteen analytic contour levels again
 * generate the whole picture; no throne, face, seat or bilateral emblem is
 * inserted into the elevation. V4 supplies a visible lacquer relief beneath
 * violet/crimson/cold-silver lines, widens their shoulders and grades crowded
 * pitches down. The organic map remains legible at production ×1.
 *
 * Clock: fixed-tick `uScroll` only (CLAUDE.md rule 1). The source image and
 * analytic iso-line technique derive from pbakaus/radiant `topographic` (MIT).
 */

import { defineBackground } from '../../render/background';

defineBackground('regnum', {
  scrollSpeed: 0.8,
  fragment: /* glsl */ `
    /* Final-boss station: clearly present at ×1, still below actors and bullets. */
    const float EXPOSURE = 1.80;

    /* Preserve the original renderer's defining fourteen elevations. */
    const float LEVELS = 14.0;

    /* Lower frequency and stretch widen the relief without deleting its levels. */
    const float FIELD_SCALE = 1.35;
    const float FIELD_STRETCH = 1.45;

    /* Contours crowded near bullet-scale pitch remain present but subordinate. */
    const float TIGHT_MIN = 26.0;
    const float TIGHT_OK  = 56.0;
    const float TIGHT_FLOOR = 0.34;

    /* Wide bright lines move slowly enough to remain continuous at production ×1. */
    const float TOPO_TIME = 0.0017;

    const vec3 BASE        = vec3(0.008, 0.007, 0.016);
    const vec3 WASH_LOW    = vec3(0.070, 0.050, 0.130);
    const vec3 WASH_HIGH   = vec3(0.180, 0.045, 0.105);
    const vec3 LINE_LOW    = vec3(0.300, 0.105, 0.390);
    const vec3 LINE_MID    = vec3(0.690, 0.150, 0.305);
    const vec3 LINE_HIGH   = vec3(0.610, 0.735, 0.850);

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

    vec3 background(vec2 uv) {
      float aspect = uRes.x / uRes.y;
      float t = uScroll * TOPO_TIME;

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
      float distPx = distG / max(dgdpx, 1e-6);              /* pixel distance to line */
      float spacingPx = 1.0 / max(dgdpx, 1e-6);             /* pitch to the neighbour */

      /* A low-frequency lacquer fill makes the relief readable before a line is
         encountered; its largest variation spans the whole field. */
      float relief = smoothstep(0.12, 0.88, fc);
      vec3 wash = mix(WASH_LOW, WASH_HIGH, smoothstep(0.38, 0.76, fc));
      vec3 col = BASE + wash * (0.16 + relief * 0.18);

      /* Only the interior thresholds (1..LEVELS) carry a line, exactly as the
         reference's (c+1)/(LEVELS+1) for c in 0..LEVELS-1. */
      if (level >= 1.0 && level <= LEVELS) {
        float threshold = level / (LEVELS + 1.0);

        /* Imperial violet → restrained crimson → cold silver by elevation. */
        vec3 lineColor = threshold < 0.5
          ? mix(LINE_LOW, LINE_MID, threshold * 2.0)
          : mix(LINE_MID, LINE_HIGH, (threshold - 0.5) * 2.0);

        /* Centre-bright / extreme-dim alpha; the original every-fifth major line. */
        float distFromCenter = abs(threshold - 0.5) * 2.0;
        float baseAlpha = 0.28 + (1.0 - distFromCenter) * 0.38;
        float isMajor = mod(level - 1.0, 5.0) < 0.5 ? 1.0 : 0.0;

        /* A visible shoulder plus a continuous spine. Width, not diagnostic gain,
           makes the lines survive the 480×640 production view. */
        float glowWidth  = mix(6.5, 10.0, isMajor);
        float sharpWidth = mix(2.4, 4.0, isMajor);
        float glowAlpha  = baseAlpha * 0.18;
        float sharpAlpha = baseAlpha * mix(0.34, 0.50, isMajor);
        float glow  = 1.0 - smoothstep(glowWidth * 0.5 - 1.5, glowWidth * 0.5 + 1.5, distPx);
        float sharp = 1.0 - smoothstep(sharpWidth * 0.5 - 1.4, sharpWidth * 0.5 + 1.4, distPx);
        float lineTerm = glow * glowAlpha + sharp * sharpAlpha;

        /* Grade crowded lines without deleting the field. In the lower activity
           band the same continuous contours remain, at 72% of their upper contrast. */
        lineTerm *= mix(TIGHT_FLOOR, 1.0, smoothstep(TIGHT_MIN, TIGHT_OK, spacingPx));
        lineTerm *= 1.0 - 0.28 * smoothstep(0.62, 0.94, uv.y);

        col += lineColor * lineTerm;
      }

      /* A restrained lacquer vignette—enough depth, not enough to erase the map. */
      vec2 vc = (uv - 0.5) * vec2(aspect, 1.0);
      col *= 1.0 - 0.22 * smoothstep(0.22, 0.58, length(vc));

      return col * EXPOSURE;
    }
  `,
});
