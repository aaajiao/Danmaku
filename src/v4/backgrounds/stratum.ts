/**
 * `stratum` — stage 3. A NEAR-IDENTICAL port of pbakaus/radiant `dither-gradient`
 * (MIT): a smooth flowing gradient field quantized through ordered dither and a
 * traveling bit-depth wave, so "resolution bands sweep across the canvas" — which
 * reads, at stage 3, as broad geological STRATA settling past the descent. The
 * reference's own defining image (quantization as a visible class marker) IS the
 * strata identity; this is the round's principled home for a slot no single
 * user-given ref supplies natively.
 *
 * ## What was ported
 *
 * The reference verbatim in structure: the slowly-rotating three-center flowing
 * `baseGradient`, the four dither algorithms (Bayer-8x8, halftone, diagonal line,
 * cross-hatch) with FBM-drifting zone weights, the traveling bit-depth wave
 * (`baseLevels = mix(2,32,waveMix)` — the resolution bands = strata), the
 * per-channel chromatic dither separation, the band-edge emphasis and the
 * vignette. The amber ramp is recoloured to verdigris.
 *
 * ## Adaptation to our surface (the only departures from the reference)
 *
 *   - Uniforms baked: `u_ditherScale` (1.0), `u_bitDepth` (1.0); `u_mouse` (the
 *     analog-truth reveal and the halftone ring) is excised — no pointer (rule 1).
 *   - The dither cell is coarsened to GAME px (`uv * fieldSize / DITHER_CELL`,
 *     retina-independent — game-px units, not device-px) instead of per-device-pixel
 *     `gl_FragCoord`, so the ordered dither reads as textured banding, never as
 *     per-pixel speckle in the bullet band. The reference's per-pixel FILM GRAIN
 *     is dropped for the same reason.
 *   - A gentle top-lane calm multiplies structure toward `uv.y=0` — a stage scene
 *     must keep the entry lane dark and smooth; the reference fills uniformly.
 *   - Clock: `t = uScroll * 0.011`, slowed below the reference's raw `u_time` rate
 *     because an animated dither crawls (pixels flip between quantization levels) if
 *     the underlying field moves fast — slowing it keeps the crawl coherent, not a
 *     boil (the surviving no-strobing property). `uScroll` advances only in `step()`.
 *   - Palette recoloured to verdigris (stage 3's role-hue), value ramp preserved.
 *   - EXPOSURE 0.28 (stage 3, under a curtain).
 *
 * ## Exposure & readability
 *
 * Stage-3 tier. The bright strata crest in the ~0.24-0.30 band
 * [MEASURED-IN-ACCEPTANCE]. Dither safety is by AMPLITUDE, not period: it only
 * toggles between adjacent quantization levels of a SMOOTH field, so each step is
 * a small fraction of the local value, and the bit-depth wave carries more levels
 * (finer steps) where the field is brighter. Motion: the resolution bands sweep
 * and the gradient drifts, per-tick step under the strobe bound
 * [MEASURED-IN-ACCEPTANCE].
 *
 * ## Clock
 *
 * `uScroll` only — no wall clock (see `background.ts`, rule 1);
 * `backgrounds/index.test.ts` scans this file for wall-clock sources.
 *
 * dither-gradient by pbakaus/radiant, MIT. Ported; our clock, coarse game-px
 * cells, top-lane calm, verdigris palette, exposure ours.
 */

import { BACKGROUND_NOISE_GLSL, defineBackground } from '../../render/background';

defineBackground('stratum', {
  scrollSpeed: 0.7,
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}

    const float DG_PI = 3.14159265;
    const float DG_TAU = 6.28318530718;
    const float EXPOSURE = 0.28;      /* stage 3 — under a curtain */
    const float DITHER_CELL = 6.0;    /* GAME px per dither cell (coarse, retina-free) */

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

    /* Bayer 8x8 via three recursive 2x2 levels (WebGL1-safe, no array). */
    float bayer8(vec2 p) {
      vec2 fp = floor(mod(p, 8.0));
      float val = 0.0;
      float bx = step(4.0, fp.x), by = step(4.0, fp.y);
      float b = bx * 2.0 * (1.0 - by) + (1.0 - bx) * 3.0 * by + bx * by * 1.0;
      val += b * 16.0;
      float mx = mod(fp.x, 4.0), my = mod(fp.y, 4.0);
      bx = step(2.0, mx); by = step(2.0, my);
      b = bx * 2.0 * (1.0 - by) + (1.0 - bx) * 3.0 * by + bx * by * 1.0;
      val += b * 4.0;
      float lx = mod(fp.x, 2.0), ly = mod(fp.y, 2.0);
      bx = step(1.0, lx); by = step(1.0, ly);
      b = bx * 2.0 * (1.0 - by) + (1.0 - bx) * 3.0 * by + bx * by * 1.0;
      val += b;
      return val / 64.0;
    }
    float halftone(vec2 p, float size) {
      vec2 cell = floor(p / size) * size + size * 0.5;
      return clamp(length(p - cell) / (size * 0.5), 0.0, 1.0);
    }
    float lineDither(vec2 p, float size) { return mod(p.x + p.y, size) / size; }
    float crossHatch(vec2 p, float size) {
      return min(mod(p.x + p.y, size) / size, mod(p.x - p.y, size) / size);
    }
    float ditherQuantize(float val, float levels, float threshold) {
      float stepped = floor(val * levels) / levels;
      float next = stepped + 1.0 / levels;
      return fract(val * levels) > threshold ? next : stepped;
    }

    /* Flowing gradient field, verdigris ramp. */
    vec3 baseGradient(vec2 uv, float t) {
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
      /* Verdigris / oxidised bronze ramp. */
      vec3 col0 = vec3(0.020, 0.045, 0.038);
      vec3 col1 = vec3(0.060, 0.170, 0.140);
      vec3 col2 = vec3(0.210, 0.440, 0.360);
      vec3 col3 = vec3(0.560, 0.800, 0.640);
      vec3 col;
      if (f < 0.33) col = mix(col0, col1, f / 0.33);
      else if (f < 0.66) col = mix(col1, col2, (f - 0.33) / 0.33);
      else col = mix(col2, col3, (f - 0.66) / 0.34);
      return col;
    }

    vec3 background(vec2 uv) {
      float aspect = uRes.x / uRes.y;
      /* Reference centred coord; y-down retained (the strata scroll vertically). */
      vec2 sc = vec2((uv.x - 0.5) * aspect, (uv.y - 0.5));
      float t = uScroll * 0.011;   /* slowed below the reference rate: the animated
                                      dither crawls (pixels flip levels) if the field
                                      moves fast — slow it so the crawl stays coherent */

      vec3 smoothColor = baseGradient(sc, t);

      /* Coarse game-px cell coords (retina-free), never per-device-pixel. */
      vec2 ditherCoord = uv * vec2(480.0, 640.0) / DITHER_CELL;

      float regionNoise = dgFbm(sc * 1.5 + t * 0.04);
      float regionNoise2 = dgFbm(sc * 2.0 - t * 0.03 + vec2(50.0));
      float zoneBayer = smoothstep(0.3, 0.6, regionNoise);
      float zoneHalftone = smoothstep(0.4, 0.7, regionNoise2);
      float zoneLine = smoothstep(0.35, 0.65, sin(regionNoise * DG_TAU + t * 0.2) * 0.5 + 0.5);
      float zoneCross = 1.0 - zoneBayer;
      float tw = zoneBayer + zoneHalftone + zoneLine + zoneCross + 0.001;
      zoneBayer /= tw; zoneHalftone /= tw; zoneLine /= tw; zoneCross /= tw;

      /* Traveling bit-depth wave — the resolution bands = strata. */
      float waveAngle = t * 0.08;
      vec2 waveDir = vec2(cos(waveAngle), sin(waveAngle));
      float wavePos = dot(sc, waveDir);
      float wave1 = sin(wavePos * 4.0 - t * 0.3) * 0.5 + 0.5;
      float wave2 = sin(dot(sc, vec2(sin(t * 0.05), cos(t * 0.07))) * 6.0 + t * 0.2) * 0.5 + 0.5;
      float waveMix = wave1 * 0.6 + wave2 * 0.4;
      /* Coarsest level floored at 4 (not the reference's 2): on the darkest bands a
         2-level flip is the largest per-tick dither step (the crawl); 4 halves it. */
      float baseLevels = max(mix(4.0, 32.0, waveMix), 4.0);

      vec2 offsetR = vec2(0.0), offsetG = vec2(2.7, 1.3), offsetB = vec2(-1.5, 3.1);
      float threshR = bayer8(ditherCoord + offsetR) * zoneBayer
                    + halftone(ditherCoord + offsetR, 8.0) * zoneHalftone
                    + lineDither(ditherCoord + offsetR, 6.0) * zoneLine
                    + crossHatch(ditherCoord + offsetR, 6.0) * zoneCross;
      float threshG = bayer8(ditherCoord + offsetG) * zoneBayer
                    + halftone(ditherCoord + offsetG, 8.0) * zoneHalftone
                    + lineDither(ditherCoord + offsetG, 6.0) * zoneLine
                    + crossHatch(ditherCoord + offsetG, 6.0) * zoneCross;
      float threshB = bayer8(ditherCoord + offsetB) * zoneBayer
                    + halftone(ditherCoord + offsetB, 8.0) * zoneHalftone
                    + lineDither(ditherCoord + offsetB, 6.0) * zoneLine
                    + crossHatch(ditherCoord + offsetB, 6.0) * zoneCross;

      float levelsR = baseLevels, levelsG = baseLevels * 1.15, levelsB = baseLevels * 0.85;
      vec3 ditheredColor;
      ditheredColor.r = ditherQuantize(smoothColor.r, levelsR, threshR);
      ditheredColor.g = ditherQuantize(smoothColor.g, levelsG, threshG);
      ditheredColor.b = ditherQuantize(smoothColor.b, levelsB, threshB);

      vec3 finalColor = ditheredColor;
      float bandEdge = abs(fract(waveMix * 4.0) - 0.5) * 2.0;
      bandEdge = smoothstep(0.85, 1.0, bandEdge);
      finalColor += vec3(0.03, 0.08, 0.06) * bandEdge;

      float vig = clamp(1.0 - dot(sc * 0.85, sc * 0.85), 0.0, 1.0);
      vig = pow(vig, 0.4);
      finalColor *= vig;

      /* Top-lane calm: a stage scene keeps the entry lane dark and smooth. */
      float nearLane = smoothstep(0.0, 0.28, uv.y);
      finalColor *= 0.35 + 0.65 * nearLane;

      return max(finalColor, 0.0) * EXPOSURE;
    }
  `,
});
