/**
 * `undertow` — stage 2, re-authored from the original tropical-heat port.
 *
 * The identity stays refractive and full-frame: the original simplex domain warp
 * and rising heat displacement now describe a cold subterranean current. V4 only
 * changes the grade and scale — indigo fluid, broad Ghost refraction and a muted
 * heart undertone replace RGB separation, hot confetti and temporal bloom spikes.
 * The field is deliberately bright enough to read at production ×1; detail
 * softens through the lower player band while the large current remains visible.
 *
 * Clock: fixed-tick `uScroll` only (CLAUDE.md rule 1). The noise construction is
 * derived from pbakaus/radiant `tropical-heat` (MIT).
 */

import { defineBackground } from '../../render/background';

defineBackground('undertow', {
  scrollSpeed: 0.9,
  fragment: /* glsl */ `
    const float EXPOSURE = 1.15;
    const float HEAT = 0.48;

    vec3 thMod289(vec3 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
    vec2 thMod289v2(vec2 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
    vec3 thPermute(vec3 x) { return thMod289(((x * 34.0) + 1.0) * x); }
    float snoise(vec2 v) {
      const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                         -0.577350269189626, 0.024390243902439);
      vec2 i = floor(v + dot(v, C.yy));
      vec2 x0 = v - i + dot(i, C.xx);
      vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      vec4 x12 = x0.xyxy + C.xxzz;
      x12.xy -= i1;
      i = thMod289v2(i);
      vec3 p = thPermute(thPermute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
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

    float thFbm(vec2 p, float t) {
      float val = 0.0, amp = 0.5, freq = 1.0;
      for (int i = 0; i < 2; i++) {
        val += amp * snoise(p * freq + t * 0.25);
        freq *= 2.05; amp *= 0.5; p += vec2(1.7, 9.2);
      }
      return val;
    }
    float warpedFbm(vec2 p, float t) {
      vec2 q = vec2(thFbm(p + vec2(0.0, 0.0), t), thFbm(p + vec2(5.2, 1.3), t));
      vec2 r = vec2(thFbm(p + 3.0 * q + vec2(1.7, 9.2), t * 1.15),
                    thFbm(p + 3.0 * q + vec2(8.3, 2.8), t * 1.15));
      return thFbm(p + 2.5 * r, t * 0.9);
    }
    vec2 heatDistortion(vec2 uv, float t) {
      float n1 = snoise(vec2(uv.x * 3.0, uv.y * 6.0 - t * 1.8)) * 0.5;
      float n2 = snoise(vec2(uv.x * 5.0 + 1.3, uv.y * 10.0 - t * 2.5 + 3.7)) * 0.3;
      float n3 = snoise(vec2(uv.x * 8.0 - 2.1, uv.y * 4.0 - t * 1.2 + 7.1)) * 0.2;
      float h1 = snoise(vec2(uv.x * 4.0 + t * 0.8, uv.y * 7.0 - t * 1.5)) * 0.4;
      float h2 = snoise(vec2(uv.x * 7.0 - t * 0.5, uv.y * 3.0 + 2.3)) * 0.25;
      return vec2((h1 + h2) * HEAT * 0.025, (n1 + n2 + n3) * HEAT * 0.018);
    }
    vec3 background(vec2 uv) {
      float aspect = uRes.x / uRes.y;
      float t = uScroll * 0.012;
      float morphT = t * 0.04;
      vec2 p = vec2((uv.x - 0.5) * aspect, (uv.y - 0.5));

      vec2 distort = heatDistortion(uv, t * 0.22);
      vec2 sampleP = p + distort * 2.0 + vec2(t * 0.035, -t * 0.085);
      float flow = warpedFbm(sampleP * 0.60, morphT);
      float shoulder = warpedFbm(
        sampleP * 0.50 + vec2(3.7, -1.9),
        morphT * 0.82 + 1.7
      );
      float rising = snoise(vec2(p.x * 1.05 + flow * 0.22, p.y * 1.42 + t * 0.24));

      float body = smoothstep(-0.58, 0.64, flow * 0.82 + shoulder * 0.30);
      float undertow = smoothstep(-0.72, 0.54, rising - flow * 0.22);
      float fold = abs(flow - shoulder);
      float refraction = smoothstep(0.24, 0.82, fold);

      vec3 ink = vec3(0.012, 0.018, 0.034);
      vec3 indigo = vec3(0.075, 0.125, 0.245);
      vec3 ghost = vec3(0.285, 0.410, 0.560);
      vec3 bone = vec3(0.660, 0.735, 0.790);
      vec3 heart = vec3(0.430, 0.185, 0.285);

      vec3 baseColor = mix(ink, indigo, 0.30 + body * 0.70);
      baseColor = mix(baseColor, ghost, undertow * 0.44);
      baseColor += bone * refraction * (0.07 + 0.08 * body);

      /* A diffuse remnant of tropical heat, never a coloured point or flash. */
      vec2 heartP = p - vec2(-0.16, -0.08);
      float heartWash = exp(-dot(heartP, heartP) * 3.2);
      baseColor += heart * heartWash * (0.025 + 0.035 * undertow);

      float centreDepth = smoothstep(0.02, 0.48, abs(p.x + flow * 0.055));
      baseColor *= 0.74 + 0.26 * centreDepth;

      float vig = clamp(1.0 - dot(p * vec2(0.72, 0.58), p * vec2(0.72, 0.58)), 0.0, 1.0);
      baseColor *= 0.76 + 0.24 * vig;

      float activityCalm = 1.0 - 0.16 * smoothstep(0.56, 0.96, uv.y);
      baseColor = baseColor / (1.0 + baseColor * 0.35);
      return max(baseColor, 0.0) * EXPOSURE * activityCalm;
    }
  `,
});
