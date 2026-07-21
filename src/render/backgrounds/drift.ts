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
 *
 * ## Where it sits, and why the body must not move
 *
 * `drift` is the neutral cool blue-gray the saturated stage scenes DEPART from,
 * and it is also pack-reachable: `packs/example` names it for its boss `pyre`, so
 * its palette is frozen exactly as `surge`'s is frozen for the packs that name
 * that — this file gains its missing numbers block, and nothing in the body.
 *
 * The one relation worth recording is with `expanse`, the scene the title screen
 * hands off to. `expanse` and `drift` were the closest hue pair in the game, both
 * blue-dominant, and the title -> stage-1 continuity is intentional — but a
 * hand-off should still be a step, not a fade to the same thing. The `expanse`
 * cyan-ice graft (`GROUND_LIFT` pulled to R/G ~0.37) is what opens that step: it
 * is measurably more cyan than `drift`, which sits nearer R/G ~0.60. The
 * collision is closed on the expanse side by the graft, NOT by repainting `drift`
 * (which a pack now depends on).
 *
 * ## Numbers
 *
 * MEASURED live (`bun run dev`, title screen, Rec.709 — its genuine consumer,
 * since the shell holds the title on `drift`):
 *
 *   - Peak luminance 0.074 measured (analytic bottom-edge ceiling ~0.095:
 *     Rec.709 of deep + lift = (0.060, 0.097, 0.180); the live crest sits
 *     below it, and the top of the frame far darker still). Under the 0.1
 *     `background.ts` asks for.
 *   - Palette relation R/G 0.63 measured mean (0.60 exact off `lift`),
 *     blue-dominant (B highest). Separated from `expanse`'s post-graft measured
 *     R/G 0.48 by a clear step — the hand-off reads as one.
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
