/**
 * `drift` — the neutral field, rebuilt as moonlit-ripple.
 *
 * A lit water plane under a low moon: the defining image is the lit-vs-unlit jump
 * of a diffuse-shaded height field, with a moon **reflection column** low in the
 * frame. It is the ONE scene in the set with `dot(N, L)` — a genuinely lit
 * surface, not a self-luminous haze — which is what makes it classifiable alone at
 * thumbnail. This is also the title-screen field, so the neutral it departs from
 * is now a moonlit water rather than a featureless cloud.
 *
 * The vertical placement is preserved in spirit: the bright ripples and the
 * reflection column live LOW (`near = uv.y`, 1 at the viewer's bottom edge), and
 * the top of the frame — where enemies enter and patterns form — stays a flat dark
 * ambient. Nothing structured sits in the entry lane.
 *
 * ## The freeze is lifted (scene-diversity round)
 *
 * The previous header froze this body "because a pack depends on it". That freeze
 * is LIFTED by the scene-diversity binding, which rewrites drift and surge
 * together. `packs/example` still names `drift` for its boss `pyre`; it inherits
 * the new moonlit look, and **no contract is broken** — a pack names a scene by
 * STRING (there is no pixel contract), the simulation is untouched, and the golden
 * replay gate holds because a background is not content. The pack simply looks
 * different now, which is the point of the round.
 *
 * The old hue-collision worry with `expanse` is retired by the wheel commit:
 * `drift` (blue-silver ~212) and `expanse` (cyan ~212) are close in hue but are
 * NOT grid-adjacent (surge sits between them) and differ completely in structure —
 * a lit rippling water plane versus a lens-whispered horizon wash — so a thumbnail
 * classifies them apart by histogram and lighting, not by colour alone.
 *
 * ## The core move — analytic normals, no dFdx
 *
 * `ripple()` sums four rotated sine waves and returns the height AND its exact
 * gradient (the derivative of each `sin` is a `cos` with the same phase), so the
 * surface normal is computed analytically — deterministic and screen-space-
 * derivative-free. Frequencies are capped: the finest octave is 5.90 cyc over
 * 640px ~= 108px, above the ~100px bullet-band floor, and the gradient contribution
 * `amp*freq` DECAYS across octaves (2.4, 1.62, 1.09, 0.74), so the finest octave
 * carries the LEAST normal energy. The specular is broad (`pow`, exponent 12 — a
 * value ramp, never a pinpoint) and gated to the low-centre reflection column, so
 * it is never a fake bullet.
 *
 * ## Clock
 *
 * Driven by `uScroll` only (`t = uScroll * 0.03`), which advances in `step()` and
 * nowhere else. No `performance.now`, no wall clock — a pure function of ticks, so
 * a replay looks identical twice (see `background.ts`, rule 1).
 * `backgrounds/index.test.ts` scans this file for wall-clock sources.
 *
 * ## Numbers
 *
 *   - Peak luminance ~0.069 [EST] (derived worst-case; measured in acceptance).
 *     `lit` maxes at 0.30 + 0.55 + 0.22 = 1.07 -> `col = BASE + LIFT*1.07 =
 *     (0.0487, 0.0686, 0.1297)`, Rec.709 Y = 0.0688 < 0.09, comfortable margin.
 *     Top-lane (near=0): `lit = 0.30`, flat ambient, Y ~= 0.029 — dark and
 *     structureless where it must be.
 *   - Bullet-band: finest octave ~108px (>100); gradient energy decays across
 *     octaves; specular broad (exp 12) and gated by `column*near` to low-centre.
 *     Watch item in `test:density`; **fallback** — drop the `spec` term (diffuse-
 *     only ripples still read as moonlit-ripple), then lower the top ripple octave.
 *   - Motion: sheen shimmer, phase `t = uScroll*0.03`, per-tick step << 0.02
 *     ([EST], motion-strip in acceptance).
 *   - Palette relation: blue-silver (B highest), hue ~212 off `LIFT`.
 *   - moonlit-ripple technique studied from pbakaus/radiant (MIT); our GLSL, noise
 *     and clock.
 */

import { BACKGROUND_NOISE_GLSL, defineBackground } from '../background';

defineBackground('drift', {
  scrollSpeed: 0.6,
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}

    /* moonlit-ripple: a lit water plane under a low moon. */
    const vec3 BASE = vec3(0.008, 0.013, 0.028);   /* deep blue-black water */
    const vec3 LIFT = vec3(0.038, 0.052, 0.095);   /* moonlit periwinkle-silver */
    const vec2 MOON = vec2(0.0, -0.85);            /* light direction, low in frame */

    /* Height field; freqs capped so analytic normals never reach the bullet band
       (highest octave 5.90 cyc over 640px ~= 108px). Returns (h, dh/dx, dh/dy). */
    vec3 ripple(vec2 p, float t) {
      float h = 0.0;
      vec2  dh = vec2(0.0);
      float amp = 1.0, freq = 2.4, ang = 0.0;      /* freq: 2.4, 3.24, 4.37, 5.90 */
      for (int i = 0; i < 4; i++) {
        vec2  dir = vec2(cos(ang), sin(ang));
        float ph  = dot(p, dir) * freq + t * (0.6 + 0.2 * float(i));
        h  += amp * sin(ph);
        dh += amp * freq * cos(ph) * dir;          /* exact derivative, no dFdx */
        amp *= 0.5; freq *= 1.35; ang += 1.7;
      }
      return vec3(h, dh) * 0.5;
    }

    vec3 background(vec2 uv) {
      float aspect = uRes.x / uRes.y;
      vec2  p = vec2(uv.x * aspect, uv.y);
      float near = uv.y;                            /* 1 at viewer (bottom), 0 at dark horizon */
      vec3  hd = ripple(p, uScroll * 0.03);
      vec3  N  = normalize(vec3(-hd.y, -hd.z, 2.5));/* analytic normal (the core move) */
      vec3  L  = normalize(vec3(MOON, 0.9));
      float diff = max(dot(N, L), 0.0);
      vec3  H    = normalize(L + vec3(0.0, 0.0, 1.0));
      float spec = pow(max(dot(N, H), 0.0), 12.0);  /* BROAD — never a pinpoint; DROPPABLE */
      /* Reflection column, low-centre. Squared by MULTIPLICATION, never pow(): the
         base (uv.x-0.5)*aspect*2.2 is signed and GLSL pow() is undefined for x<0. */
      float cx = (uv.x - 0.5) * aspect * 2.2;
      float column = exp(-cx * cx);
      float lit = 0.30 + 0.55 * diff * near + 0.22 * spec * column * near;
      return BASE + LIFT * lit;
    }
  `,
});
