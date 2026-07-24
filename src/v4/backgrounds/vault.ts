/**
 * `vault` — stage 4, the terminal pressure chamber.
 *
 * The original `fluid-amber` double domain warp still supplies the material, but
 * V4 reads it as weight rather than liquid: a full-frame black-lacquer mass folds
 * into broad imperial-violet layers, with restrained crimson showing between
 * compressed strata and cold grey sliding across their shoulders. There is no
 * dissolve threshold, isolated membrane edge or fine flowing vein, so the result
 * cannot collapse into `surge`'s ink-boundary silhouette.
 *
 * Three coarse octaves keep every visible change well above bullet scale. The
 * source clock is exactly 10% faster than HEAD (`0.005 → 0.0055`) and is passed
 * through the original staggered domain-warp clocks without extra translation or
 * hidden time scaling. Motion reads fixed-tick `uScroll` only (CLAUDE.md rule 1).
 *
 * V4 hybrid pass: an original finite-palette black-violet Ghost plate supplies
 * monumental shoulders and graphite support strata. The plate stays locked to
 * the logical pixel grid; the procedural domain warp remains the motion source
 * above it, so motion never smears or crawls across the authored pixel edges.
 *
 * Spatial/material ancestry: `fluid-amber` by pbakaus/radiant, MIT. V4 lacquer
 * layering, palette, pressure lighting, pixel plate and gameplay calm are
 * original here.
 */

import VAULT_ART_URL from '../../assets/v4/backgrounds/vault-v4.png';
import { defineBackground } from '../../render/background';

defineBackground('vault', {
  scrollSpeed: 0.5,
  art: {
    url: VAULT_ART_URL,
    width: 480,
    height: 640,
  },
  fragment: /* glsl */ `
    uniform sampler2D uArt;
    uniform vec2 uArtRes;
    uniform float uArtMode;  /* 0 shader, 1 painted plate, 2 production hybrid */

    const float EXPOSURE = 2.90;   /* production x1: lacquer folds read without gain */

    /* Vein-width knob: <1 coarsens the marble. 0.48 keeps all retained levels
       comfortably broader than the bullet band. */
    const float FIELD_SCALE = 0.48;

    /* Reference defaults, baked (were u_ampDecay / u_timeScale uniforms). */
    const float AMP_DECAY = 0.48;

    /* --- The reference's exact Simplex noise (Ashima/IQ). No trig; IEEE-exact. */
    vec3 mod289(vec3 x)  { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec2 mod289v2(vec2 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

    float snoise(vec2 v) {
      const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                         -0.577350269189626, 0.024390243902439);
      vec2 i  = floor(v + dot(v, C.yy));
      vec2 x0 = v - i + dot(i, C.xx);
      vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      vec4 x12 = x0.xyxy + C.xxzz;
      x12.xy -= i1;
      i = mod289v2(i);
      vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
      vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
      m = m * m;
      m = m * m;
      vec3 x  = 2.0 * fract(p * C.www) - 1.0;
      vec3 h  = abs(x) - 0.5;
      vec3 ox = floor(x + 0.5);
      vec3 a0 = x - ox;
      m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
      vec3 g;
      g.x  = a0.x * x0.x + h.x * x0.y;
      g.yz = a0.yz * x12.xz + h.yz * x12.yw;
      return 130.0 * dot(m, g);
    }

    /* Three coarse octaves: material pressure, never fine liquid filaments. */
    float fbm(vec2 p, float t) {
      float val  = 0.0;
      float amp  = 0.5;
      float freq = 1.0;
      for (int i = 0; i < 3; i++) {
        val  += amp * snoise(p * freq + t * 0.3);
        freq *= 2.1;
        amp  *= AMP_DECAY;
        p    += vec2(1.7, 9.2);
      }
      return val;
    }

    vec3 vaultShader(vec2 uv, out vec2 q, out vec2 r) {
      /* y-down uv -> the reference's y-up centred coords, normalised by the short
         axis exactly as the reference divides by min(u_res). */
      float m = min(uRes.x, uRes.y);
      vec2 p = vec2((uv.x - 0.5) * uRes.x, (0.5 - uv.y) * uRes.y) / m;
      p *= FIELD_SCALE;

      /* HEAD was 0.005. No nested slowdown or added pan: total speed is +10%. */
      float t = uScroll * 0.0055;

      /* Original two-stage warp, retained as the pressure source. */
      q = vec2(fbm(p + vec2(0.0, 0.0), t),
               fbm(p + vec2(5.2, 1.3), t));

      r = vec2(fbm(p + 4.0 * q + vec2(1.7, 9.2), t * 1.2),
               fbm(p + 4.0 * q + vec2(8.3, 2.8), t * 1.2));

      float f = fbm(p + 3.5 * r, t * 0.8);

      /*
       * A pair of warped, near-horizontal layer coordinates turns the fluid
       * source into thick folded lacquer. Both cover roughly one cycle over the
       * portrait field, so they read as masses rather than repeated stripes.
       */
      float layerPhase = p.y * 9.0 + p.x * 2.2
        + q.x * 1.55 - r.y * 1.05 - t * 1.10;
      float counterPhase = p.y * 4.4 - p.x * 1.25
        + r.x * 1.35 + q.y * 0.65 + t * 0.42;
      float layerA = 0.5 + 0.5 * sin(layerPhase);
      float layerB = 0.5 + 0.5 * sin(counterPhase);
      float layerDepth = smoothstep(0.16, 0.86, layerA * 0.72 + layerB * 0.28);

      float pressure = clamp(
        0.46
        + f * 0.31
        + (length(q) - 0.42) * 0.17
        + (r.x - r.y) * 0.085,
        0.0,
        1.0
      );
      float underLayer = smoothstep(0.18, 0.86, layerB);

      /* Broad shoulder lighting; no reaction edge or narrow contour is formed. */
      float shoulder = 1.0 - abs(layerA * 2.0 - 1.0);
      shoulder *= shoulder;
      float pressureLift = smoothstep(0.26, 0.88, pressure);
      float lacquerSweep = 0.5 + 0.5 * cos(
        layerPhase * 0.43 + counterPhase * 0.17 + t * 0.31
      );
      lacquerSweep *= lacquerSweep;

      vec3 voidLacquer = vec3(0.017, 0.014, 0.028);
      vec3 blackViolet = vec3(0.060, 0.033, 0.086);
      vec3 imperialViolet = vec3(0.150, 0.066, 0.198);
      vec3 restrainedCrimson = vec3(0.255, 0.060, 0.108);
      vec3 coldGrey = vec3(0.420, 0.435, 0.470);

      vec3 col = mix(voidLacquer, blackViolet, 0.28 + pressure * 0.62);
      col = mix(col, imperialViolet, layerDepth * (0.24 + pressure * 0.18));
      col = mix(
        col,
        restrainedCrimson,
        underLayer * (1.0 - layerDepth * 0.52) * (0.10 + pressure * 0.14)
      );
      col += coldGrey * shoulder * pressureLift * 0.075;
      col += mix(imperialViolet, coldGrey, 0.34)
        * lacquerSweep * pressureLift * 0.052;

      /* Deep compression darkens valleys instead of outlining them. */
      float compression = smoothstep(0.12, 0.82, 1.0 - pressure);
      col *= 1.0 - compression * (1.0 - shoulder * 0.42) * 0.24;

      col = col / (1.0 + col * 0.30);
      col = pow(max(col, vec3(0.0)), vec3(1.04));
      float entryCalm = 0.62 + 0.38 * smoothstep(0.0, 0.24, uv.y);
      float activityCalm = 1.0 - 0.28 * smoothstep(0.58, 0.94, uv.y);
      return col * EXPOSURE * entryCalm * activityCalm;
    }

    vec2 vaultPixelUv(vec2 uv) {
      vec2 safeUv = clamp(uv, vec2(0.0), vec2(1.0) - 0.5 / uArtRes);
      return (floor(safeUv * uArtRes) + 0.5) / uArtRes;
    }

    vec3 vaultArt(vec2 pixelUv) {
      vec3 painted = texture2D(uArt, pixelUv).rgb;
      /* Keep the Ghost membranes readable at x1 while capping bone-silver
         supports well below the white-core bullet tier. */
      painted = pow(max(painted, vec3(0.0)), vec3(1.08)) * 0.46;
      return min(painted, vec3(0.34));
    }

    vec3 background(vec2 uv) {
      if (uArtMode < 0.5) {
        vec2 smoothQ;
        vec2 smoothR;
        return vaultShader(uv, smoothQ, smoothR);
      }

      /* Production modes snap the complete scene to the logical pixel grid;
         shader-only remains the exact smooth reference for comparison. */
      vec2 pixelUv = vaultPixelUv(uv);
      vec3 painted = vaultArt(pixelUv);
      if (uArtMode < 1.5) return painted;
      vec2 q;
      vec2 r;
      vec3 shaderColor = vaultShader(pixelUv, q, r);

      vec3 hybrid = mix(painted, shaderColor, 0.46);
      float pressureLight = dot(shaderColor, vec3(0.2126, 0.7152, 0.0722));
      hybrid += painted * pressureLight * 0.35;
      return hybrid;
    }
  `,
});
