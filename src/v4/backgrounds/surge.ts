/**
 * `surge` — the extension surface, re-authored from the original ink-dissolve
 * port. Its double domain warp, drifting ink envelopes and reaction edge remain
 * the whole picture; V4 enlarges them into a Ghost membrane with a bone-silver
 * dissolution front and one diffuse heart stain. There are no inserted plates or
 * geometric cracks. The broad surface and edge are graded to read at ×1. Its
 * fixed clock is spent inside the two warp stages and membrane grain; whole-field
 * translation is intentionally almost imperceptible.
 *
 * Clock: fixed-tick `uScroll` only (CLAUDE.md rule 1). The field is derived from
 * pbakaus/radiant `ink-dissolve` (MIT).
 */

import { defineBackground } from '../../render/background';

defineBackground('surge', {
  scrollSpeed: 1.4,
  fragment: /* glsl */ `
    const float EXPOSURE = 1.70;

    /* Ashima simplex 2D noise (the reference's texture). */
    vec3 idMod289(vec3 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
    vec2 idMod289v2(vec2 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
    vec3 idPermute(vec3 x) { return idMod289(((x * 34.0) + 1.0) * x); }
    float snoise(vec2 v) {
      const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                         -0.577350269189626, 0.024390243902439);
      vec2 i = floor(v + dot(v, C.yy));
      vec2 x0 = v - i + dot(i, C.xx);
      vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      vec4 x12 = x0.xyxy + C.xxzz;
      x12.xy -= i1;
      i = idMod289v2(i);
      vec3 p = idPermute(idPermute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
      vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
      m = m*m; m = m*m;
      vec3 x = 2.0 * fract(p * C.www) - 1.0;
      vec3 h = abs(x) - 0.5;
      vec3 ox = floor(x + 0.5);
      vec3 a0 = x - ox;
      m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
      vec3 g;
      g.x = a0.x * x0.x + h.x * x0.y;
      g.yz = a0.yz * x12.xz + h.yz * x12.yw;
      return 130.0 * dot(m, g);
    }

    float fbm4(vec2 p) {
      float v = 0.0;
      float a = 0.55;
      mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
      v += a * snoise(p); a *= 0.45; p = rot * p * 2.02;
      v += a * snoise(p); a *= 0.45; p = rot * p * 2.03;
      v += a * snoise(p); a *= 0.4;  p = rot * p * 2.01;
      v += a * snoise(p) * 0.6;
      return v;
    }
    float fbm3(vec2 p) {
      float v = 0.0;
      mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
      v += 0.5 * snoise(p); p = rot * p * 2.02;
      v += 0.25 * snoise(p); p = rot * p * 2.03;
      v += 0.125 * snoise(p);
      return v;
    }

    float inkField(vec2 p, float t) {
      vec2 q = vec2(
        fbm4(p + vec2(t * 0.18, -t * 0.13)),
        fbm4(p + vec2(5.2 - t * 0.15, 1.3 + t * 0.19))
      );
      vec2 r = vec2(
        fbm4(p + 2.5 * q + vec2(1.7 - t * 0.25, 9.2 + t * 0.16)),
        fbm4(p + 2.5 * q + vec2(8.3 + t * 0.21, 2.8 - t * 0.23))
      );
      return fbm4(p + 2.2 * r + vec2(t * 0.17, -t * 0.20));
    }

    vec3 background(vec2 uv) {
      float aspect = uRes.x / uRes.y;
      vec2 sc = vec2((uv.x - 0.5) * aspect, (uv.y - 0.5));
      float t = uScroll * 0.00286;
      vec2 driftedSc = sc + vec2(t * 0.009, -t * 0.006);

      /* The reference's double domain warp, enlarged rather than replaced.
         Outer coordinates barely move; q and r counter-roll inside inkField. */
      float field = inkField(driftedSc * 0.62, t);

      /* Three slow drifting ink sources + centre bias (mouse source dropped). */
      float envelope = 0.0;
      float a1 = t * 0.05;
      envelope += 1.0 - smoothstep(
        0.0,
        0.74,
        length(sc - vec2(cos(a1) * 0.15, sin(a1 * 0.7) * 0.12))
      );
      float a2 = t * 0.04 + 2.2;
      envelope += 1.0 - smoothstep(
        0.0,
        0.64,
        length(sc - vec2(cos(a2) * 0.25, sin(a2 * 0.6) * 0.20))
      );
      float a3 = t * 0.048 + 4.7;
      envelope += 1.0 - smoothstep(
        0.0,
        0.58,
        length(sc - vec2(cos(a3 * 0.8) * 0.20, sin(a3) * 0.16))
      );
      envelope += (1.0 - smoothstep(0.0, 0.62, length(sc))) * 0.45;
      envelope = clamp(envelope, 0.0, 1.0);

      /* The broad boundary slowly dissolves and returns without a value jump. */
      float dissolveBias = sin(t * 1.65 + field * 0.45) * 0.042;
      float inkRaw = smoothstep(
        -0.40 + dissolveBias,
        0.30 + dissolveBias,
        field
      );
      float ink = inkRaw * envelope;

      /* One faint secondary branch retains the dissolve's tendrils at a scale
         safely broader than bullets. */
      float secondaryGuide = fbm3(
        driftedSc * 0.72 + vec2(4.1 - t * 0.17, 7.3 + t * 0.13)
      );
      vec2 secondaryCurl = vec2(
        secondaryGuide - 0.5,
        0.5 - fbm3(
          driftedSc * 0.68 + vec2(8.6 + t * 0.14, 1.2 - t * 0.16)
        )
      );
      float secondaryField = fbm3(
        driftedSc * 1.05
        + secondaryCurl * 0.72
        + vec2(-t * 0.20, t * 0.16)
      );
      float secondaryInk = smoothstep(-0.24, 0.26, secondaryField) * envelope;
      float combinedInk = max(ink, secondaryInk * 0.18);

      float edgeRaw = combinedInk * (1.0 - combinedInk) * 4.0;
      float edgeSoft = smoothstep(0.02, 0.62, edgeRaw);
      float edgeBody = smoothstep(0.30, 0.90, edgeRaw);

      vec3 voidInk = vec3(0.006, 0.009, 0.017);
      vec3 ghostShadow = vec3(0.030, 0.046, 0.064);
      vec3 ghostSurface = vec3(0.115, 0.155, 0.190);
      vec3 bone = vec3(0.650, 0.690, 0.710);
      vec3 heart = vec3(0.500, 0.330, 0.400);

      /* Two counter-moving surface samples make fibres roll within the membrane
         instead of riding along with a camera pan. */
      float membraneA = fbm3(
        sc * 0.82 + vec2(t * 0.16, -t * 0.12)
      );
      float membraneB = fbm3(
        sc * 0.66
        + vec2((membraneA - 0.5) * 0.55, (0.5 - membraneA) * 0.38)
        + vec2(6.4 - t * 0.14, 2.7 + t * 0.17)
      );
      float membrane = clamp(
        0.18 + membraneA * 0.46 + membraneB * 0.42,
        0.0,
        1.0
      );
      vec3 surface = mix(ghostShadow, ghostSurface, membrane * 0.78);
      vec3 col = mix(surface, voidInk, combinedInk * 0.94);

      /* The original reaction edge survives as one broad material transition. */
      col += ghostSurface * edgeSoft * 0.16;
      col += bone * edgeBody * 0.105;

      vec2 heartP = sc - vec2(-0.12, -0.10);
      float heartWash = exp(-dot(heartP, heartP) * 4.2);
      col += heart * edgeBody * heartWash * 0.034;

      float vig = 1.0 - smoothstep(0.36, 0.78, length(sc * vec2(0.94, 0.78)));
      col *= 0.74 + 0.26 * vig;

      float activityCalm = 1.0 - 0.12 * smoothstep(0.60, 0.94, uv.y);
      col = col / (1.0 + col * 0.42);
      return max(col, 0.0) * EXPOSURE * activityCalm;
    }
  `,
});
