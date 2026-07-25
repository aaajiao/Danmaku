/**
 * `wear-field` — the v4 terminal ending.
 *
 * The accepted master records broad passages worn into slate and muted-heart
 * material. A deterministic sixteen-frame sequence lets independent sections
 * of its left, right and lower paths emerge, slip out of register and recede.
 * Unlike Expanse's horizontal breath or Undertow's vertical current, no camera
 * or whole wall moves; the centre remains byte-still and low-information so the
 * ending text and the frozen curtain beneath it retain priority.
 *
 * Its motion keeps the terminal screen's signal grammar: six long Ghost ribbons
 * begin legibly and lose amplitude into a low-frequency floor fog. This is a
 * separate implementation rather than an import from `signal-decay`, because
 * the ending's worn material and GAME OVER's dissolving signal are distinct
 * pictures even when they share a broad visual verb. Every change is a pure
 * function of fixed-tick `uScroll` or `uTick` (CLAUDE.md rule 1).
 */

import WEAR_FIELD_ART_URL from '../../assets/v4/backgrounds/wear-field-v4-sequence.png';
import { BACKGROUND_NOISE_GLSL, defineBackground } from '../../render/background';

defineBackground('wear-field', {
  scrollSpeed: 0.72,
  uniforms: {
    // The ending state drives this down once per page: the worn record recedes
    // while the fixed-tick signal remains. A scalar is cloned per Background,
    // so page changes never mutate registry data or another renderer instance.
    uEndingArt: { value: 0.30 },
  },
  art: {
    url: WEAR_FIELD_ART_URL,
    width: 960,
    height: 1280,
  },
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}

    uniform sampler2D uArt;
    uniform vec2 uArtRes;
    uniform float uArtMode;  /* 0 shader, 1 painted plate, 2 production hybrid */
    uniform float uEndingArt;

    const float WF_EXPOSURE = 0.38;
    const float WF_TAU = 6.28318530718;
    const vec2 WF_ATLAS_GRID = vec2(4.0, 4.0);
    const float WF_ART_FRAMES = 16.0;
    const float WF_FRAME_TICKS = 11.0;

    float wearRibbon(float y, float centre, float width) {
      float d = abs(y - centre);
      float core = 1.0 - smoothstep(width, width + 0.004, d);
      float haze = exp(-d / max(width * 4.6, 0.0001)) * 0.30;
      return core * 0.38 + haze;
    }

    vec2 wearScenePixelUv(vec2 uv) {
      vec2 safeUv = clamp(
        uv,
        vec2(0.0),
        vec2(1.0) - 0.5 / uRes
      );
      return (floor(safeUv * uRes) + 0.5) / uRes;
    }

    vec2 wearArtPixelUv(vec2 uv) {
      vec2 frameRes = uArtRes / WF_ATLAS_GRID;
      vec2 safeUv = clamp(
        uv,
        vec2(0.0),
        vec2(1.0) - 0.5 / frameRes
      );
      return (floor(safeUv * frameRes) + 0.5) / frameRes;
    }

    vec3 wearArtFrame(vec2 pixelUv, float frame) {
      float wrapped = mod(frame, WF_ART_FRAMES);
      vec2 tile = vec2(
        mod(wrapped, WF_ATLAS_GRID.x),
        floor(wrapped / WF_ATLAS_GRID.x)
      );
      vec2 atlasUv = (tile + pixelUv) / WF_ATLAS_GRID;
      vec3 painted = texture2D(uArt, atlasUv).rgb;

      /* Material density rises through moderate exposure and luma-preserving
         chroma, not an additive white floor. Silver/heart separation therefore
         reads at x1 while the frozen projectile and ending-copy tiers still win. */
      painted = pow(max(painted, vec3(0.0)), vec3(1.04)) * 0.55;
      float paintedLuma = dot(painted, vec3(0.2126, 0.7152, 0.0722));
      vec3 chroma = painted - vec3(paintedLuma);
      painted = vec3(paintedLuma) + chroma * 1.28;
      return min(max(painted, vec3(0.0)), vec3(0.36));
    }

    vec3 wearArt(vec2 pixelUv) {
      float phase = mod(uTick / WF_FRAME_TICKS, WF_ART_FRAMES);
      float frame = floor(phase);
      float travel = fract(phase);
      /* A short rest brackets each section hand-off. The atlas owns the
         reveal/misregistration/fade; interpolation only removes hard cuts. */
      float transfer = clamp((travel - 0.08) / 0.84, 0.0, 1.0);
      float blend = transfer * transfer * (3.0 - 2.0 * transfer);
      return mix(
        wearArtFrame(pixelUv, frame),
        wearArtFrame(pixelUv, frame + 1.0),
        blend
      );
    }

    vec3 wearSignal(vec2 uv) {
      float aspect = uRes.x / uRes.y;
      float t = uScroll * 0.005;
      vec2 p = vec2((uv.x - 0.5) * aspect, uv.y);

      vec3 col = mix(vec3(0.012, 0.017, 0.026), vec3(0.020, 0.017, 0.027), uv.y);
      vec3 bone = vec3(0.58, 0.66, 0.72);
      vec3 ghost = vec3(0.26, 0.36, 0.47);
      vec3 heart = vec3(0.52, 0.39, 0.48);

      for (int i = 0; i < 6; i++) {
        float fi = float(i);
        float baseY = 0.10 + fi * 0.135;
        float decay = smoothstep(0.16, 0.92, baseY);

        float primary = sin(
          (p.x * (1.20 + fi * 0.10) + t * (0.34 + fi * 0.028) + fi * 0.81)
          * WF_TAU
        );
        float secondary = sin(
          (p.x * 0.54 - t * 0.18 + fi * 1.09) * WF_TAU
        );
        float warp = bgFbm(vec2(
          p.x * 0.78 + fi * 3.3,
          t * 0.08 + baseY * 2.2
        )) - 0.5;
        float amplitude = mix(0.008, 0.028, decay);
        float waveY = baseY
          + (primary * 0.70 + secondary * 0.30) * amplitude
          + warp * decay * 0.022;

        float missing = 0.70 + 0.30 * sin(t * 0.28 + fi * 1.37 + p.x * 1.55);
        float line = wearRibbon(uv.y, waveY, mix(0.0018, 0.0052, decay));
        vec3 lineColour = mix(bone, ghost, decay * 0.84);
        lineColour = mix(
          lineColour,
          heart,
          smoothstep(0.50, 0.84, decay) * 0.16
        );
        col += lineColour * line * missing;
      }

      /* The record thins at the lower edge rather than resolving into a new
         centre. Broad fog only: no grain, scan line or projectile-sized dash. */
      float floorMask = smoothstep(0.64, 1.0, uv.y);
      float fog = bgFbm(vec2(p.x * 1.05 + t * 0.030, uv.y * 2.5 - t * 0.020));
      col += vec3(0.10, 0.14, 0.20) * fog * floorMask * 0.20;
      col *= 1.0 - floorMask * (0.18 + 0.16 * fog);

      /* The authored centre stays quiet; reinforce that subtraction behind the
         paged ending without drawing a literal empty object there. */
      vec2 textP = (uv - vec2(0.5, 0.34)) * vec2(aspect, 1.0);
      col *= 1.0 - 0.26 * exp(-dot(textP, textP) * 8.5);

      vec2 vc = (uv - 0.5) * vec2(aspect, 0.84);
      float vignette = 1.0 - smoothstep(0.34, 0.80, length(vc));
      col *= 0.54 + 0.46 * vignette;

      col = col / (1.0 + col * 0.62);
      return max(col, 0.0) * WF_EXPOSURE;
    }

    vec3 background(vec2 uv) {
      if (uArtMode < 0.5) return wearSignal(uv);

      /* Shader-only keeps its smooth diagnostic branch. Art samples deliberate
         240x320 blocks; production keeps the signal on the 480x640 scene grid. */
      vec2 scenePixelUv = wearScenePixelUv(uv);
      vec2 artPixelUv = wearArtPixelUv(uv);
      vec3 painted = wearArt(artPixelUv);
      if (uArtMode < 1.5) return painted;
      vec3 signal = wearSignal(scenePixelUv);

      float paintedLuma = dot(painted, vec3(0.2126, 0.7152, 0.0722));
      vec3 hybrid = signal * (1.0 + paintedLuma * uEndingArt * 0.34);
      hybrid += painted * uEndingArt;
      return hybrid / (vec3(1.0) + hybrid * 0.30);
    }
  `,
});
