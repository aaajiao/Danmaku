/**
 * `decree` — the shared Fiat / Sine Die field, re-authored from the original
 * moiré-interference port. Four detuned ring sources on Lissajous orbits still
 * generate every visible form; V4 remaps their broad beats into ink, smoke,
 * controlled amber and bone instead of replacing them with a generic veil. The
 * fine four-way product is only a faint material undertone. The filled field is
 * bright enough to read at ×1 while the lower player band stays slightly calmer.
 *
 * Clock: fixed-tick `uScroll` only (CLAUDE.md rule 1). The interference
 * construction is derived from pbakaus/radiant `moire-interference` (MIT).
 */

import { defineBackground } from '../../render/background';

defineBackground('decree', {
  scrollSpeed: 1.2,
  fragment: /* glsl */ `
    const float EXPOSURE = 1.10;
    const float FRINGE_FREQ = 30.0;
    const float MOIRE_DRIFT = 0.34;

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

      float t = uScroll * 0.0068;

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

      float pairA = r0 * r1;
      float pairB = r2 * r3;
      float beat = clamp(0.5 + 0.5 * (pairA * 0.56 + pairB * 0.44), 0.0, 1.0);
      float chorus = clamp(0.5 + 0.5 * (r0 + r1 + r2 + r3) * 0.25, 0.0, 1.0);
      float fine = 0.5 + 0.5 * (r0 * r1 * r2 * r3);

      float body = smoothstep(0.16, 0.86, beat * 0.74 + chorus * 0.26);
      float fold = smoothstep(0.16, 0.78, abs(pairA - pairB));
      float ridge = smoothstep(0.63, 0.91, body);

      vec3 voidInk = vec3(0.018, 0.021, 0.034);
      vec3 smoke = vec3(0.105, 0.105, 0.125);
      vec3 amber = vec3(0.420, 0.285, 0.170);
      vec3 ghost = vec3(0.320, 0.365, 0.410);
      vec3 bone = vec3(0.745, 0.680, 0.570);

      vec3 col = mix(voidInk, smoke, 0.34 + body * 0.66);
      col = mix(col, amber, chorus * 0.38);
      col += ghost * fold * 0.14;
      col += bone * ridge * 0.12;
      col += amber * (fine - 0.5) * 0.055;

      float vig = clamp(1.0 - dot(p * 0.9, p * 0.9), 0.0, 1.0);
      vig = pow(vig, 0.5);
      col *= 0.72 + 0.28 * vig;

      float drain = mix(0.86, 1.0, 0.5 + 0.5 * sin(uScroll * 0.0012 - uv.y * 1.5));
      col *= drain;

      col = max(col, vec3(0.0));
      col = col / (1.0 + col * 0.30);

      float activityCalm = 1.0 - 0.08 * smoothstep(0.62, 0.96, uv.y);
      return col * EXPOSURE * activityCalm;
    }
  `,
});
