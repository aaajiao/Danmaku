/**
 * `surge` — spell cards.
 *
 * The same restraint as everywhere else, aimed outward from the boss. "More
 * aggressive" has to mean more *motion*, not more contrast: a spell card is the
 * moment the screen is fullest, so this is the background that most has to
 * disappear underneath the bullets. The rings are low amplitude and fade out
 * well before the edges, which is where the player's own hitbox spends its time.
 *
 * This one is flat on purpose. It is a state, not a place — it overlays whatever
 * scene the stage was already in, and a second perspective fighting the stage's
 * own would read as the camera cutting rather than the fight escalating.
 *
 * ## Pack-only now, like drift
 *
 * The base campaign no longer names `surge`: its spell cards stamp the seal
 * family instead (`signet`/`cordon`/`intaglio`/`sable`/`regnum`, plus the two
 * 出神 scenes), one shared cell through five filters. `surge` stays REGISTERED
 * and unchanged because the fetched packs use it — `packs/example`, and
 * `packs/clearing` names it as a HOME scene (`manifest-floor`) — so its palette
 * and motion are frozen exactly as `drift` (the menu scene) is frozen for
 * `packs/example`'s `pyre`. It is reachable through those packs, not the base
 * game, which is why it is kept in `index.test.ts`'s `SHIPPED` array but is no
 * longer in the base reachability run's declared scenes.
 *
 * ## Numbers
 *
 * Measured from live framebuffer captures in `bun run dev` (sprites masked out),
 * the way the stage scenes quote theirs:
 *
 *   - Peak luminance measures 0.058 this pass (up to ~0.069 at other pulse
 *     phases), below the 0.1 `background.ts` asks for.
 *   - Palette relation R/G 3.9 measured masked-mean, red-dominant (a magenta-red): base
 *     (0.030, 0.010, 0.028), glow (0.130, 0.028, 0.075). This is the red the
 *     four stage scenes were each chosen to sit clear of, back when the base
 *     game cross-faded to it — a relation now inherited by the packs that name it.
 */

import { BACKGROUND_NOISE_GLSL, defineBackground } from '../background';

defineBackground('surge', {
  scrollSpeed: 1.4,
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}

    vec3 background(vec2 uv) {
      float aspect = uRes.x / uRes.y;

      // Centred a little above the middle, roughly where a boss holds station.
      vec2 c = (uv - vec2(0.5, 0.40)) * vec2(aspect, 1.0);
      float d = length(c);
      float angle = atan(c.y, c.x);

      // Driven by uScroll, so the pulse rate is a property of the spec rather
      // than of how fast the machine happens to be drawing.
      float rings = sin(d * 13.0 - uScroll * 0.09);

      // Slow rotational churn. Sampling fbm in (angle, radius) keeps the
      // structure radial without a second noise field.
      float churn = bgFbm(vec2(angle * 0.9, d * 2.6 - uScroll / uRes.y));

      float falloff = smoothstep(0.95, 0.05, d);

      vec3 base = vec3(0.030, 0.010, 0.028);
      vec3 glow = vec3(0.130, 0.028, 0.075);

      return base + glow * falloff * (0.45 + 0.20 * rings + 0.35 * churn);
    }
  `,
});
