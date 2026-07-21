/**
 * `undertow` — stage 2. A NEAR-IDENTICAL port of pbakaus/radiant `tropical-heat`
 * (MIT): air as a refracting lens. A domain-warped simplex field drives BOTH a
 * rising heat-shimmer UV distortion AND a per-channel chromatic-aberration offset
 * that displaces what is sampled behind it — the one scene whose field bends its
 * own substrate — under a saturation-forward cosine palette with periodic colour
 * blooms.
 *
 * ## What was ported
 *
 * The reference verbatim in structure: Ashima `snoise`, the 6-octave `fbm`, the
 * domain-warped `warpedFbm`, the vertical-dominant rising `heatDistortion` field,
 * the per-channel (R/G/B) chromatic offset applied to the sampling coordinate, the
 * two cosine palettes (`tropicalColor`, `magentaOrange`), the hot magenta/orange
 * undercurrent mask, the teal accents, the three independently-timed radial colour
 * blooms with `pow(sin,6..12)` sharp peaks, the intensity-spike and heat-haze
 * highlight terms, the amber-DNA grounding, the vignette and the tonemap.
 *
 * ## Adaptation to our surface (the only departures from the reference)
 *
 *   - Uniforms baked: `u_heatIntensity` (1.0), `u_colorVibrancy` (0.8); `u_mouse`
 *     (the `heatCenter` shift) is excised — `heatCenter` stays fixed at frame
 *     centre. No pointer on our surface (rule 1).
 *   - Clock: `t = uScroll * 0.0105`, slowed below the reference's raw `u_time` rate
 *     because the fast heat shimmer and the sharp `pow(sin,8)` blooms give a large
 *     per-tick luminance step (the surviving no-strobing property wins over
 *     rate-fidelity). `uScroll` advances only in `step()`.
 *   - The heat-haze line term's vertical frequency is eased (12 -> 8) so its thin
 *     bright rules sit ~60px apart rather than in the bullet band; everything else
 *     is the reference. The chromatic separation stays ~6px (sub-bullet) and the
 *     shimmer displaces only a SMOOTH field, so no bullet-frequency counterfeit
 *     survives.
 *   - EXPOSURE 0.20 over the tonemap, plus a top-lane calm: tropical-heat is a busy
 *     full-frame field (the reference is hero-saturated by design), the worst case
 *     for a stage running under a bullet curtain — so it is sunk low, which also
 *     drops its per-tick step, and the entry lane is darkened.
 *
 * ## Exposure & readability
 *
 * Stage-2 tier. The blooms are the bright transient bursts, cresting in the
 * ~0.24-0.30 band [MEASURED-IN-ACCEPTANCE]; between them the warped field sits
 * lower. Displacement amplitude is the hard ceiling and stays well under a bullet
 * width. Motion: heat rise + chromatic swim + periodic blooms, per-tick step under
 * the strobe bound [MEASURED-IN-ACCEPTANCE].
 *
 * ## Clock
 *
 * `uScroll` only — no wall clock (see `background.ts`, rule 1);
 * `backgrounds/index.test.ts` scans this file for wall-clock sources.
 *
 * tropical-heat by pbakaus/radiant, MIT. Ported; our clock, fixed heat centre,
 * eased haze frequency, exposure ours.
 */

import { BACKGROUND_NOISE_GLSL, defineBackground } from '../background';

defineBackground('undertow', {
  scrollSpeed: 0.9,
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}

    const float EXPOSURE = 0.20;   /* stage 2 — a busy full-frame field; sunk low so
                                      the curtain wins and the per-tick step drops */
    const float VIBRANCY = 0.8;
    const float HEAT = 1.0;

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
      for (int i = 0; i < 6; i++) {
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
    vec3 tropicalColor(float t) {
      vec3 a = vec3(0.55, 0.3, 0.25), b = vec3(0.45, 0.35, 0.3);
      vec3 c = vec3(1.0, 0.8, 0.7), d = vec3(0.0, 0.15, 0.35);
      vec3 col = a + b * cos(6.28318 * (c * t + d));
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      return mix(vec3(lum), col, 1.0 + VIBRANCY * 0.6);
    }
    vec3 magentaOrange(float t) {
      vec3 a = vec3(0.6, 0.2, 0.35), b = vec3(0.4, 0.3, 0.25);
      vec3 c = vec3(1.2, 1.0, 0.6), d = vec3(0.1, 0.25, 0.45);
      vec3 col = a + b * cos(6.28318 * (c * t + d));
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      return mix(vec3(lum), col, 1.0 + VIBRANCY * 0.5);
    }

    vec3 background(vec2 uv) {
      float aspect = uRes.x / uRes.y;
      float t = uScroll * 0.0105;   /* slowed below the reference rate: the fast heat
                                       shimmer + sharp blooms give a large per-tick step */
      vec2 p = vec2((uv.x - 0.5) * aspect, (uv.y - 0.5));

      vec2 distort = heatDistortion(uv, t);
      float aberration = HEAT * 0.012;
      vec2 pR = p + distort * 1.3 + vec2(aberration, aberration * 0.5);
      vec2 pG = p + distort * 1.0;
      vec2 pB = p + distort * 0.7 - vec2(aberration * 0.8, aberration * 0.3);

      float warpR = warpedFbm(pR * 1.5, t * 0.3);
      float warpG = warpedFbm(pG * 1.5, t * 0.3 + 0.7);
      float warpB = warpedFbm(pB * 1.5, t * 0.3 + 1.4);

      vec3 baseColor;
      baseColor.r = tropicalColor(warpR * 0.8 + t * 0.05).r;
      baseColor.g = tropicalColor(warpG * 0.8 + t * 0.05 + 0.33).g;
      baseColor.b = magentaOrange(warpB * 0.8 + t * 0.05 + 0.66).b;

      float flow1 = snoise(p * 2.5 + vec2(t * 0.4, -t * 0.3));
      float flow2 = snoise(p * 3.8 + vec2(-t * 0.35, t * 0.25));
      float flowMask = smoothstep(-0.2, 0.6, flow1 * flow2);
      vec3 hotLayer = magentaOrange(flow1 * 0.5 + t * 0.08) * vec3(1.1, 0.7, 0.9);
      baseColor = mix(baseColor, hotLayer, flowMask * 0.4 * VIBRANCY);

      float tealNoise = snoise(p * 4.0 + vec2(t * 0.2, t * 0.15 + 5.0));
      float tealMask = smoothstep(0.3, 0.8, tealNoise) * 0.15 * VIBRANCY;
      baseColor = mix(baseColor, vec3(0.1, 0.45, 0.4), tealMask);

      /* Bloom exponents softened (6/8/7 -> 4/5/5) so the bursts ramp less sharply
         in time — the additive spikes were the largest per-tick step. */
      float bt1 = pow(sin(t * 0.4) * 0.5 + 0.5, 4.0);
      vec2 bc1 = vec2(snoise(vec2(t * 0.13, 0.0)) * 0.4, snoise(vec2(0.0, t * 0.11 + 3.0)) * 0.4);
      float bloom1 = bt1 * smoothstep(0.5, 0.0, length(p - bc1));
      float bt2 = pow(sin(t * 0.7 + 2.1) * 0.5 + 0.5, 5.0);
      vec2 bc2 = vec2(snoise(vec2(t * 0.17 + 7.0, 2.0)) * 0.35, snoise(vec2(3.0, t * 0.14 + 5.0)) * 0.35);
      float bloom2 = bt2 * smoothstep(0.35, 0.0, length(p - bc2));
      float bt3 = pow(sin(t * 0.55 + 4.3) * 0.5 + 0.5, 5.0);
      vec2 bc3 = vec2(snoise(vec2(t * 0.1 + 12.0, 8.0)) * 0.3, snoise(vec2(6.0, t * 0.09 + 10.0)) * 0.3);
      float bloom3 = bt3 * smoothstep(0.45, 0.0, length(p - bc3));
      baseColor += vec3(0.95, 0.4, 0.2) * bloom1 * 0.7 * VIBRANCY;
      baseColor += vec3(0.85, 0.15, 0.5) * bloom2 * 0.6 * VIBRANCY;
      baseColor += vec3(1.0, 0.65, 0.1) * bloom3 * 0.5 * VIBRANCY;

      float spike = pow(sin(t * 0.25) * 0.5 + 0.5, 7.0);
      float spikeWave = snoise(p * 1.5 - vec2(0.0, t * 0.8)) * 0.5 + 0.5;
      baseColor += vec3(0.2, 0.08, 0.03) * spike * spikeWave * HEAT;

      /* Heat-haze rules, vertical frequency eased 12 -> 8 for the play band. */
      float haze = snoise(vec2(p.x * 6.0, p.y * 8.0 - t * 2.0));
      float hazeLines = pow(smoothstep(0.4, 0.9, haze), 3.0);
      baseColor += vec3(0.15, 0.08, 0.04) * hazeLines * HEAT * 0.5;

      float lum = dot(baseColor, vec3(0.299, 0.587, 0.114));
      baseColor = mix(baseColor, vec3(0.78, 0.58, 0.42) * lum, 0.12);

      float vig = clamp(1.0 - dot(p, p) * 0.5, 0.0, 1.0);
      vig = pow(vig, 0.7);
      baseColor *= vig;

      baseColor = baseColor / (1.0 + baseColor * 0.25);
      baseColor = pow(max(baseColor, 0.0), vec3(0.95)) * vec3(1.05, 0.97, 0.88);

      /* Top-lane calm: a stage scene keeps the entry lane darker. */
      float nearLane = 0.45 + 0.55 * smoothstep(0.0, 0.28, uv.y);
      return baseColor * EXPOSURE * nearLane;
    }
  `,
});
