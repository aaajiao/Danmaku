/**
 * `drift` — the neutral field.
 *
 * A slow cloud drifting toward the player, with no spatial structure to it on
 * purpose: this is the background for anywhere that has not decided what it
 * looks like yet, including the title screen. Stages that want a place name a
 * scene of their own (`expanse`, `undertow`).
 *
 * The vertical gradient is deliberate and not decorative. The top of the screen
 * is where enemies enter and where the densest patterns form, so it is kept
 * darkest; the brighter end sits below the player, where nothing needs reading.
 */

import { BACKGROUND_NOISE_GLSL, defineBackground } from '../background';

defineBackground('drift', {
  scrollSpeed: 0.6,
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}

    vec3 background(vec2 uv) {
      float aspect = uRes.x / uRes.y;

      // Subtracting scroll moves features down-screen, since uv.y is y-down.
      vec2 p = vec2(uv.x * aspect, uv.y - uScroll / uRes.y);

      // Two layers at different rates read as depth without any parallax
      // machinery — the far one is slower because it is sampled at a coarser
      // scale against the same scroll.
      float far = bgFbm(p * 1.6);
      float near = bgFbm(p * 3.1 + vec2(0.0, -uScroll / uRes.y));

      float cloud = far * 0.65 + near * 0.35;
      float depth = 0.30 + 0.70 * uv.y;

      vec3 deep = vec3(0.015, 0.022, 0.050);
      vec3 lift = vec3(0.045, 0.075, 0.130);

      return deep + lift * (0.40 + 0.60 * cloud) * depth;
    }
  `,
});
