/**
 * `signal-decay` — Game Over, Ending and Results.
 *
 * The scene still moves from legible harmonics at the top into dissolution at
 * the bottom, but v4 expresses that loss as broad layer displacement and missing
 * amplitude. The old bit-crush, per-scanline glitch, RGB separation, dash noise
 * and film grain were a full-screen glitch wall and fought the result text.
 *
 * Six long Ghost ribbons now lose coherence into a low-frequency mycelial fog.
 * Bone white owns the clean signal; heart-pink appears only as a restrained
 * transition wash. Everything is a pure function of `uScroll` (rule 1).
 *
 * Spatial ancestry: signal-decay by pbakaus/radiant, MIT. The v4 signal grammar,
 * palette and frequency grading are original to this project.
 */

import { BACKGROUND_NOISE_GLSL, defineBackground } from '../../render/background';

defineBackground('signal-decay', {
  scrollSpeed: 1.0,
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}

    const float EXPOSURE = 0.46;
    const float SD_TAU = 6.28318530718;

    float ribbon(float y, float centre, float width) {
      float d = abs(y - centre);
      float core = 1.0 - smoothstep(width, width + 0.004, d);
      float haze = exp(-d / max(width * 4.2, 0.0001)) * 0.34;
      return core * 0.42 + haze;
    }

    vec3 background(vec2 uv) {
      float aspect = uRes.x / uRes.y;
      float t = uScroll * 0.006;
      vec2 p = vec2((uv.x - 0.5) * aspect, uv.y);

      vec3 col = mix(vec3(0.014, 0.020, 0.030), vec3(0.022, 0.018, 0.030), uv.y);
      vec3 bone = vec3(0.72, 0.80, 0.84);
      vec3 ghost = vec3(0.32, 0.43, 0.54);
      vec3 heart = vec3(0.64, 0.50, 0.58);

      for (int i = 0; i < 6; i++) {
        float fi = float(i);
        float baseY = 0.11 + fi * 0.13;
        float decay = smoothstep(0.18, 0.92, baseY);

        /* Clean at the top; lower ribbons bend and lose amplitude coherently. */
        float primary = sin((p.x * (1.35 + fi * 0.11) + t * (0.42 + fi * 0.035) + fi * 0.73) * SD_TAU);
        float secondary = sin((p.x * 0.62 - t * 0.22 + fi * 1.17) * SD_TAU);
        float warp = bgFbm(vec2(p.x * 0.85 + fi * 3.7, t * 0.10 + baseY * 2.0)) - 0.5;
        float amplitude = mix(0.010, 0.032, decay);
        float waveY = baseY + (primary * 0.72 + secondary * 0.28) * amplitude + warp * decay * 0.026;

        float missing = 0.74 + 0.26 * sin(t * 0.36 + fi * 1.41 + p.x * 1.8);
        float line = ribbon(uv.y, waveY, mix(0.0018, 0.0055, decay));
        vec3 lineColour = mix(bone, ghost, decay * 0.82);
        lineColour = mix(lineColour, heart, smoothstep(0.46, 0.78, decay) * 0.18);
        col += lineColour * line * missing;
      }

      /* Lower-quarter dissolution: broad fog and three ghost echoes, no grain. */
      float floorMask = smoothstep(0.66, 1.0, uv.y);
      float fog = bgFbm(vec2(p.x * 1.15 + t * 0.035, uv.y * 2.7 - t * 0.025));
      col += vec3(0.12, 0.17, 0.23) * fog * floorMask * 0.24;
      col *= 1.0 - floorMask * (0.20 + 0.18 * fog);

      /* Result text occupies the upper centre, so the field subtracts there. */
      vec2 textP = (uv - vec2(0.5, 0.27)) * vec2(aspect, 1.0);
      col *= 1.0 - 0.30 * exp(-dot(textP, textP) * 10.0);

      vec2 vc = (uv - 0.5) * vec2(aspect, 0.82);
      float vignette = 1.0 - smoothstep(0.34, 0.78, length(vc));
      col *= 0.52 + 0.48 * vignette;

      col = col / (1.0 + col * 0.65);
      return max(col, 0.0) * EXPOSURE;
    }
  `,
});
