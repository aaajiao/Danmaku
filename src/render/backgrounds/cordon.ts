/**
 * `cordon` — warden's fight (the stage-2 midboss). The BINDING gold seal.
 *
 * ## The variant — the same molten gold, cooler and brightest
 *
 * `cordon` imports `signet`'s ported `liquid-gold` basis (`GOLD_GLSL`) and grades
 * it. It is the same pool of liquid gold — the reference material, unmistakably —
 * shifted a shade cooler toward brass (the tint pulls green up and blue down) and
 * run at the family's TOP exposure. It is the picket line, the barrier warden
 * presses; the barrier reads as gold caught brighter, not as a different scene.
 *
 * ## Why cordon is the binding one
 *
 * It is sized against the exposure law FIRST: if any of the three gold seals reads
 * hot under a real curtain, `cordon` is the one whose EXPOSURE drops, and the other
 * two follow. So it carries the family's brightest allowed peak — the ceiling the
 * rest sit at or below — which is exactly why the header numbers are the ones the
 * acceptance pass measures against.
 *
 * ## The boss-station calm
 *
 * warden holds a corridor and the fight crowds the centre-upper field, so `cordon`
 * is the one variant that passes a `calm` > 0: a gentle radial dim centred on the
 * boss station (~0.5, 0.42). It is MODULATION ONLY — a `<=1` multiply that can only
 * darken that region so the boss and its bullets keep the void — never an added
 * highlight. Everywhere else the molten gold is the reference.
 *
 * ## Hue — brass-gold (cooler)
 *
 * The tint `vec3(0.95, 1.0, 0.80)` leaves the green channel at full and pulls red
 * and blue down a little, so the gold cools toward brass. Met over `undertow`'s
 * indigo, a brass reading separates the boss from the stage by temperature without
 * ever leaving the `liquid-gold` family. The G channel is untouched, so cordon
 * keeps the family's highest luminance even at its cooler hue — consistent with it
 * being the brightest.
 *
 * ## Exposure & bullet-band grading
 *
 * EXPOSURE 0.33, the family top; peaks ~0.26-0.28 raw [MEASURED-IN-ACCEPTANCE].
 * The two bullet-band knobs live in `GOLD_GLSL` (broadened speculars; coarsened
 * fine ripple) and cover this variant unchanged — the tint and calm only lower
 * values, they add no new spatial frequency. Per-tick step is small (slow molten
 * flow), coherent, no strobing.
 *
 * ## Clock
 *
 * `uScroll` only, which advances in `step()` and nowhere else — no
 * `performance.now`, so a replay looks identical twice (`background.ts`, rule 1).
 * `backgrounds/index.test.ts` scans this file for wall-clock sources.
 *
 * liquid-gold by pbakaus/radiant, MIT (basis in `signet.ts`). Ported
 * near-identically; cordon grades hue/exposure and adds the station calm.
 */

import { defineBackground } from '../background';
import { GOLD_GLSL } from './signet';

defineBackground('cordon', {
  scrollSpeed: 0.8,
  fragment: /* glsl */ `
${GOLD_GLSL}

    const float EXPOSURE = 0.33;   /* the family's brightest allowed (the binding seal) */

    vec3 background(vec2 uv) {
      return goldScene(
        uv, uRes.x / uRes.y, uScroll,
        vec3(0.95, 1.0, 0.80),   /* brass-gold: cooler, G full so luma stays highest */
        EXPOSURE,
        0.0,                     /* reference vignette */
        1.0,                     /* reference saturation */
        0.35                     /* gentle radial calm at the boss station (modulation only) */
      );
    }
  `,
});
