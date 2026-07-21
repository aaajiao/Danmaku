/**
 * `surge` — spell cards, rebuilt as ink-dissolve.
 *
 * The defining image is organic tendrils from a double domain-warp with a
 * hard-but-organic threshold boundary, and an edge-glow living exactly on the
 * transition (`ink*(1-ink)*4`) — the ink-dissolve signature. The bloom grows from
 * the **low-left corner**, not the centre: `surge` becomes the set's one
 * asymmetric-origin cell, which is what makes it unconfusable with the radially
 * symmetric scenes at thumbnail. ink-dissolve is organic and asymmetric by nature,
 * so the corner origin is the reference read honestly rather than a contrivance.
 *
 * This one stays flat on purpose. It is a STATE, not a place — it overlays whatever
 * scene the stage was already in, and a second perspective fighting the stage's own
 * would read as the camera cutting rather than the fight escalating. And it is the
 * background that most has to disappear underneath the bullets, so it carries NO hot
 * core: only a broad halo plus the thin transition edge, with a `falloff` that
 * spares the player's hitbox zone.
 *
 * ## The freeze is lifted (scene-diversity round)
 *
 * The previous header froze this body "because the packs name it". That freeze is
 * LIFTED by the scene-diversity binding, which rewrites drift and surge together.
 * `packs/example` names `surge`, and `packs/clearing` names it as a HOME scene
 * (`manifest-floor`); both inherit the new ink-dissolve look, and **no contract is
 * broken** — a pack names a scene by STRING (no pixel contract), the simulation is
 * untouched, and the golden replay gate holds because a background is not content.
 * The base campaign does not name `surge` (its spell cards stamp the seal family);
 * `surge` stays REGISTERED and reachable through those packs, kept in
 * `index.test.ts`'s `SHIPPED` array.
 *
 * ## Clock
 *
 * Driven by `uScroll` only (the warp scrolls `uScroll*0.0015..0.004`), which
 * advances in `step()` and nowhere else. No wall clock — a pure function of ticks,
 * so a replay looks identical twice (see `background.ts`, rule 1).
 * `backgrounds/index.test.ts` scans this file for wall-clock sources.
 *
 * ## Numbers
 *
 *   - Peak luminance ~0.046 [EST] (derived worst-case; measured in acceptance).
 *     `0.35*ink + 0.65*edge` maxes at ink~0.567 -> ~0.838 (fill and edge do not
 *     crest together); `col = BASE + GLOW*0.838 = (0.1164, 0.0228, 0.0747)`,
 *     Rec.709 Y = 0.046 — below the old surge's 0.058. Correctly a dim overlay that
 *     vanishes under bullets.
 *   - Bullet-band (a round watch item): edge width = 0.32/|grad field|; the coarse
 *     warp (scale 2.4, ~130px lobes) keeps |grad| gentle, so the edge is tens of px
 *     wide. `test:density` is the arbiter; **fallback** — widen the threshold to
 *     `smoothstep(-0.22, 0.22, .)` and drop the `edge` term -> a pure ink wash
 *     (still ink-dissolve).
 *   - Motion: ink creep, boundary velocity << 0.02/tick ([EST], motion-strip in
 *     acceptance).
 *   - Palette relation: magenta-red (R-dominant), hue ~328 off `GLOW` — the
 *     pack-consistent red the stage scenes were each chosen to sit clear of.
 *   - ink-dissolve technique studied from pbakaus/radiant (MIT); our GLSL, noise
 *     and clock.
 */

import { BACKGROUND_NOISE_GLSL, defineBackground } from '../background';

defineBackground('surge', {
  scrollSpeed: 1.4,
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}

    /* ink-dissolve: an organic threshold bloom; a spell-card STATE overlay. */
    const vec3 BASE = vec3(0.020, 0.006, 0.016);   /* deep magenta-black */
    const vec3 GLOW = vec3(0.115, 0.020, 0.070);   /* magenta-red (pack-consistent hue) */

    /* Double domain-warp — the tendrils come from warping, not from more octaves. */
    float inkField(vec2 p) {
      float q = bgFbm(p + vec2(0.0, uScroll * 0.004));
      float r = bgFbm(p + 2.5 * q + vec2(1.7, 0.0));
      return bgFbm(p + 2.2 * r + uScroll * 0.0015);
    }

    vec3 background(vec2 uv) {
      float aspect = uRes.x / uRes.y;
      vec2  q0 = (uv - vec2(0.15, 0.95)) * vec2(aspect, 1.0);  /* bloom from low-left corner */
      float field = inkField(q0 * 2.4);                       /* scale 2.4 -> ~130px features */
      float ink  = smoothstep(-0.16, 0.16, field - 0.5);      /* WIDE band -> edge stays coarse */
      float edge = ink * (1.0 - ink) * 4.0;                   /* the ink-dissolve signature */
      float falloff = smoothstep(1.05, 0.15, length(q0));     /* spare the player hitbox zone */
      float m = falloff * (0.35 * ink + 0.65 * edge);         /* halo + edge; NO hot core */
      return BASE + GLOW * m;
    }
  `,
});
