/**
 * `surge` — the spell-card / pack overlay. A NEAR-IDENTICAL port of
 * pbakaus/radiant `ink-dissolve` (MIT): double domain-warped simplex tendrils
 * thresholded into an organic ink boundary, with the edge-glow living exactly on
 * the transition (`ink*(1-ink)*4`) — the ink-dissolve signature.
 *
 * ## What was ported
 *
 * The reference verbatim in structure: Ashima simplex `snoise`, the rotated
 * `fbm4`, the DOUBLE domain warp (`q = fbm(p+t); r = fbm(p+2.5q+t); field =
 * fbm(p+2.2r+t)`) that grows reaction-diffusion tendrils, the three slow drifting
 * circular ink-source envelopes plus a centre bias, the fine secondary tendrils,
 * the multi-band edge glow (soft/mid/hot), the caustic-shimmered liquid base, the
 * subsurface bleed, the ambient-from-below term, and the vignette + warm gamma.
 *
 * ## Adaptation to our surface (the only departures from the reference)
 *
 *   - Uniforms baked: `u_spread` (0.4) folds into the clock, `u_detail` (1.0) is
 *     constant; `u_mouse` (the cursor ink source) is excised — no pointer on our
 *     surface, and rule 1 permits only a tick clock.
 *   - Clock: `t = uScroll * 0.0026`, slowed below the reference's `u_time*0.4` rate
 *     because the sharp ink boundary sweeping quickly gives a large per-tick
 *     luminance step (the surviving no-strobing property wins over rate-fidelity).
 *     `uScroll` advances only in `step()`.
 *   - Palette recoloured from the reference's warm amber to surge's magenta-red
 *     (its pack-consistent role-hue, the red the stage scenes were each chosen to
 *     sit clear of) — the value ramp (dark ink -> hot edge) is preserved, only the
 *     hue is turned.
 *   - EXPOSURE 0.22: surge overlays whatever scene the stage was in and must vanish
 *     under a bullet curtain, so it is the dimmest of the "own picture" cells.
 *
 * ## Exposure & readability
 *
 * Overlay tier. The hot ink edge is the identity and crests near the exposure
 * ceiling (~0.22 raw) [MEASURED-IN-ACCEPTANCE] — bright enough to read as
 * dissolving ink, dim enough that a bullet still wins the contrast fight. The
 * threshold band is kept WIDE (`smoothstep(-0.2, 0.1, field)`, width 0.3 — the
 * reference's own band) so the glowing edge stays tens of px wide, never a
 * bullet-frequency line. Motion: ink creep, the
 * boundary velocity well under the strobe bound [MEASURED-IN-ACCEPTANCE].
 *
 * ## Clock
 *
 * `uScroll` only — no wall clock. A pure function of ticks (see `background.ts`,
 * rule 1); `backgrounds/index.test.ts` scans this file for wall-clock sources.
 *
 * ink-dissolve by pbakaus/radiant, MIT. Ported; our clock and palette.
 */

import { BACKGROUND_NOISE_GLSL, defineBackground } from '../background';

defineBackground('surge', {
  scrollSpeed: 1.4,
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}

    const float EXPOSURE = 0.22;   /* overlay tier — must vanish under bullets */

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
        fbm4(p + vec2(0.0, 0.0) + t * 0.04),
        fbm4(p + vec2(5.2, 1.3) + t * 0.03)
      );
      vec2 r = vec2(
        fbm4(p + 2.5 * q + vec2(1.7, 9.2) + t * 0.022),
        fbm4(p + 2.5 * q + vec2(8.3, 2.8) + t * 0.032)
      );
      return fbm4(p + 2.2 * r + t * 0.015);
    }

    vec3 background(vec2 uv) {
      float aspect = uRes.x / uRes.y;
      /* Reference's centred coord (y-down is immaterial here — the field is
         radially organic and the envelopes are symmetric about centre). */
      vec2 sc = vec2((uv.x - 0.5) * aspect, (uv.y - 0.5));
      float t = uScroll * 0.0026;   /* slowed below the reference rate: the sharp ink
                                       edge sweeping fast gives a large per-tick step */

      float field = inkField(sc * 0.8, t);

      /* Three slow drifting ink sources + centre bias (mouse source dropped). */
      float envelope = 0.0;
      float a1 = t * 0.05;
      envelope += smoothstep(0.95, 0.0, length(sc - vec2(cos(a1)*0.15, sin(a1*0.7)*0.12)));
      float a2 = t * 0.04 + 2.2;
      envelope += smoothstep(0.85, 0.0, length(sc - vec2(cos(a2)*0.25, sin(a2*0.6)*0.2)));
      float a3 = t * 0.048 + 4.7;
      envelope += smoothstep(0.75, 0.0, length(sc - vec2(cos(a3*0.8)*0.2, sin(a3)*0.16)));
      envelope += smoothstep(0.65, 0.0, length(sc)) * 0.6;
      envelope = clamp(envelope, 0.0, 1.0);

      float inkRaw = smoothstep(-0.2, 0.1, field);
      float ink = inkRaw * envelope;

      float fineField = fbm3(sc * 2.5 + vec2(t * 0.02, -t * 0.015));
      float fineTendril = smoothstep(-0.1, 0.12, fineField) * envelope;
      float combinedInk = max(ink, fineTendril * 0.35);

      float edgeRaw = combinedInk * (1.0 - combinedInk) * 4.0;
      float edgeSoft = smoothstep(0.05, 0.5, edgeRaw);
      float edgeMid = smoothstep(0.25, 0.8, edgeRaw);
      float edgeHot = smoothstep(0.6, 1.0, edgeRaw);

      float fineEdge = fineTendril * (1.0 - fineTendril) * 4.0;
      fineEdge = smoothstep(0.3, 0.9, fineEdge) * 0.4;

      /* Magenta-red ramp (surge role-hue) — the reference's amber value ramp,
         hue turned toward red. */
      vec3 inkDark   = vec3(0.020, 0.006, 0.014);
      vec3 redDim    = vec3(0.070, 0.014, 0.040);
      vec3 redDeep   = vec3(0.200, 0.045, 0.090);
      vec3 redWarm   = vec3(0.460, 0.130, 0.220);
      vec3 redGlow   = vec3(0.820, 0.320, 0.400);
      vec3 redBright = vec3(1.000, 0.520, 0.560);
      vec3 redHot    = vec3(1.000, 0.760, 0.720);

      float liqVar = 0.5 + 0.5 * fbm3(sc * 2.0 + t * 0.03);
      vec3 liquid = mix(redDim, redDeep, liqVar * 0.7);

      float c1 = 0.5 + 0.5 * snoise(sc * 6.0 + vec2(t * 0.05, -t * 0.035));
      float c2 = 0.5 + 0.5 * snoise(sc * 10.0 + vec2(-t * 0.03, t * 0.04));
      liquid += redWarm * c1 * c2 * 0.05 * (1.0 - combinedInk);

      vec3 col = mix(liquid, inkDark, combinedInk);
      col += redDeep   * edgeSoft * 0.7;
      col += redGlow   * edgeMid * 0.4;
      col += redBright * edgeHot * 0.45;
      col += redHot    * edgeHot * edgeHot * 0.25;
      col += redWarm   * fineEdge * 0.3;
      col += redGlow   * fineEdge * fineEdge * 0.15;

      float inkTex = 0.5 + 0.5 * snoise(sc * 3.5 + t * 0.01);
      col += vec3(0.015, 0.006, 0.010) * inkTex * combinedInk;

      float thinInk = smoothstep(0.5, 0.1, combinedInk);
      col += redDim * thinInk * edgeSoft * 0.3;

      float vertGlow = smoothstep(0.6, -0.3, uv.y);
      col += vec3(0.025, 0.008, 0.014) * vertGlow * (1.0 - combinedInk * 0.6);

      float vig = 1.0 - smoothstep(0.35, 1.2, length(sc));
      col *= 0.5 + 0.5 * vig;

      col = pow(max(col, 0.0), vec3(0.93, 0.99, 1.02));
      return col * EXPOSURE;
    }
  `,
});
