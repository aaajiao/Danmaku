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
 * V4 hybrid pass: an original indigo Ghost sequence supplies the descending
 * membrane walls and central negative space. Sixteen deterministic 240×320
 * frames send two unequal, asymmetrically phased fold crests down the walls
 * around a calm shaft while a slower pressure cycle flexes their width.
 * Sixteen fixed-tick push/drag cadences keep the descent continuous without
 * repeating one odd/even rhythm, while the original refractive field remains
 * visible at the 480×640 logical grid.
 *
 * Clock: fixed-tick `uScroll` for the refractive field and `uTick` for the
 * sequence (CLAUDE.md rule 1), never a wall clock. The noise construction is
 * derived from pbakaus/radiant `tropical-heat` (MIT).
 */

import UNDERTOW_ART_URL from '../../assets/v4/backgrounds/undertow-v4-sequence.png';
import { defineBackground } from '../../render/background';

defineBackground('undertow', {
  scrollSpeed: 0.9,
  art: {
    url: UNDERTOW_ART_URL,
    width: 960,
    height: 1280,
  },
  fragment: /* glsl */ `
    uniform sampler2D uArt;
    uniform vec2 uArtRes;
    uniform float uArtMode;  /* 0 shader, 1 painted plate, 2 production hybrid */

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
    vec3 undertowShader(vec2 uv) {
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

      /* Preserve each field's midpoint while widening its shoulder. This
         removes rare slow-phase luma spikes without changing clock speed. */
      float body = smoothstep(-0.76, 0.82, flow * 0.82 + shoulder * 0.30);
      float undertow = smoothstep(-0.90, 0.72, rising - flow * 0.22);
      float fold = abs(flow - shoulder);
      /* Broaden the moving fold shoulder: the descending painted wave supplies
         silhouette contrast, so refraction can stay broad instead of flashing
         a narrow edge as simplex cells cross the logical pixel grid. */
      float refraction = smoothstep(0.04, 1.08, fold);

      vec3 ink = vec3(0.012, 0.018, 0.034);
      vec3 indigo = vec3(0.075, 0.125, 0.245);
      vec3 ghost = vec3(0.285, 0.410, 0.560);
      vec3 bone = vec3(0.660, 0.735, 0.790);
      vec3 heart = vec3(0.430, 0.185, 0.285);

      vec3 baseColor = mix(ink, indigo, 0.30 + body * 0.70);
      baseColor = mix(baseColor, ghost, undertow * 0.44);
      baseColor += bone * refraction * (0.025 + 0.032 * body);

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

    const vec2 UNDERTOW_ATLAS_GRID = vec2(4.0, 4.0);
    const float UNDERTOW_ART_FRAMES = 16.0;
    const float UNDERTOW_FRAME_TICKS = 10.0;

    vec2 undertowScenePixelUv(vec2 uv) {
      vec2 safeUv = clamp(uv, vec2(0.0), vec2(1.0) - 0.5 / uRes);
      return (floor(safeUv * uRes) + 0.5) / uRes;
    }

    vec2 undertowArtPixelUv(vec2 uv) {
      vec2 frameRes = uArtRes / UNDERTOW_ATLAS_GRID;
      vec2 safeUv = clamp(uv, vec2(0.0), vec2(1.0) - 0.5 / frameRes);
      return (floor(safeUv * frameRes) + 0.5) / frameRes;
    }

    vec3 undertowArtFrame(vec2 pixelUv, float frame) {
      float wrapped = mod(frame, UNDERTOW_ART_FRAMES);
      vec2 tile = vec2(mod(wrapped, UNDERTOW_ATLAS_GRID.x),
                       floor(wrapped / UNDERTOW_ATLAS_GRID.x));
      vec2 atlasUv = (tile + pixelUv) / UNDERTOW_ATLAS_GRID;
      vec3 painted = texture2D(uArt, atlasUv).rgb;
      /* The plate owns the deep shaft walls, not the light tier. Its brightest
         connected bone strata remain safely below bullets and actor skeletons. */
      painted = pow(max(painted, vec3(0.0)), vec3(1.08)) * 0.54;
      return min(painted, vec3(0.30));
    }

    float undertowCadence(float frame) {
      float phase = mod(frame, UNDERTOW_ART_FRAMES);
      if (phase < 1.0) return 0.010;
      if (phase < 2.0) return 0.017;
      if (phase < 3.0) return 0.020;
      if (phase < 4.0) return 0.013;
      if (phase < 5.0) return 0.003;
      if (phase < 6.0) return -0.008;
      if (phase < 7.0) return -0.017;
      if (phase < 8.0) return -0.020;
      if (phase < 9.0) return -0.013;
      if (phase < 10.0) return -0.002;
      if (phase < 11.0) return 0.008;
      if (phase < 12.0) return 0.015;
      if (phase < 13.0) return 0.012;
      if (phase < 14.0) return 0.002;
      if (phase < 15.0) return -0.010;
      return -0.015;
    }

    vec3 undertowArt(vec2 pixelUv) {
      float phase = mod(uTick / UNDERTOW_FRAME_TICKS, UNDERTOW_ART_FRAMES);
      float frame = floor(phase);
      float travel = fract(phase);
      /* Each authored span gets its own push/drag amount. sin² returns both
         value and derivative to the linear path at every frame boundary, while
         the bounded ±0.02 cadence stays monotonic and never stops to breathe. */
      float cadenceWave = sin(3.14159265 * travel);
      float blend = travel
                  + undertowCadence(frame) * cadenceWave * cadenceWave;
      return mix(
        undertowArtFrame(pixelUv, frame),
        undertowArtFrame(pixelUv, frame + 1.0),
        blend
      );
    }

    vec3 background(vec2 uv) {
      if (uArtMode < 0.5) return undertowShader(uv);

      vec2 scenePixelUv = undertowScenePixelUv(uv);
      vec2 artPixelUv = undertowArtPixelUv(uv);
      vec3 painted = undertowArt(artPixelUv);
      if (uArtMode < 1.5) return painted;
      vec3 shaderColor = undertowShader(scenePixelUv);

      /* The sequence owns silhouette and most visible motion. Low-weight live
         refraction preserves the original field, while a fixed indigo floor
         restores production ×1 visibility without amplifying temporal spikes. */
      float paintedLuma = dot(painted, vec3(0.2126, 0.7152, 0.0722));
      vec3 hybrid = shaderColor * (0.08 + paintedLuma * 0.03);
      hybrid += painted * 0.60;
      float currentLight = dot(shaderColor, vec3(0.2126, 0.7152, 0.0722));
      hybrid += painted * currentLight * 0.02;
      return hybrid * 1.30 + vec3(0.016, 0.026, 0.044);
    }
  `,
});
