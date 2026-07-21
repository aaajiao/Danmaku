/**
 * `regnum` — regent's fight (the stage-4 boss). The FULLEST gold seal.
 *
 * ## The variant — the same molten gold, warmer and filled to the edges
 *
 * `regnum` imports `signet`'s ported `liquid-gold` basis (`GOLD_GLSL`) and grades
 * it to the fullest register of the family. It is the same pool of liquid gold —
 * the reference material — shifted a shade warmer toward rose (the tint pulls green
 * and blue down), its chroma pushed up, and its field FILLED: the reference vignette
 * darkens the edges to a dark rest, and `regnum` raises that floor so the molten
 * surface carries all the way out. It is the least empty of the three — the seal
 * finally pressed into the whole seat, a reigning fullness.
 *
 * The fullness is `fill = 1`: the vignette floor lifts (0.35 -> 0.62) and the
 * central pool widens. This is fill and SATURATION, not peak — see below.
 *
 * ## Hue — rose-gold (warmer), and why its peak is not the family's brightest
 *
 * The tint `vec3(1.0, 0.85, 0.72)` keeps red full and pulls green and blue down, so
 * the gold warms toward rose; `sat = 1.15` then pushes the chroma. Because the grade
 * lowers the green channel — green carries most of the luminance weight — regnum's
 * PEAK sits below cordon's and signet's even though it is the fullest FIELD. That is
 * the intended reading: regnum is the fullest by fill and chroma (least rest), not
 * the brightest by crest. Set against `vault`'s terminal gold, the warmer rose reads
 * as heat entering the fight, still unmistakably `liquid-gold`.
 *
 * ## Exposure & bullet-band grading
 *
 * EXPOSURE 0.28, the lowest of the three; peaks ~0.22-0.26 raw
 * [MEASURED-IN-ACCEPTANCE]. Raising the vignette floor lifts the DIM field, not the
 * crest, so a fuller field costs no peak. The two bullet-band knobs live in
 * `GOLD_GLSL` (broadened speculars; coarsened fine ripple) and cover this variant
 * unchanged — the tint, saturation and fill only redistribute value, adding no new
 * spatial frequency. Per-tick step is small (slow molten flow), coherent, no
 * strobing.
 *
 * ## Clock
 *
 * `uScroll` only, which advances in `step()` and nowhere else — no
 * `performance.now`, so a replay looks identical twice (`background.ts`, rule 1).
 * `backgrounds/index.test.ts` scans this file for wall-clock sources.
 *
 * liquid-gold by pbakaus/radiant, MIT (basis in `signet.ts`). Ported
 * near-identically; regnum grades hue/exposure/saturation and fills the field.
 */

import { defineBackground } from '../background';
import { GOLD_GLSL } from './signet';

defineBackground('regnum', {
  scrollSpeed: 0.8,
  fragment: /* glsl */ `
${GOLD_GLSL}

    const float EXPOSURE = 0.28;   /* lowest of the three: fullest field, not highest peak */

    vec3 background(vec2 uv) {
      return goldScene(
        uv, uRes.x / uRes.y, uScroll,
        vec3(1.0, 0.85, 0.72),   /* rose-gold: warmer, red-heavy so peak sits below the others */
        EXPOSURE,
        1.0,                     /* FILLED: floor lifts, pool widens — the least-rest field */
        1.15,                    /* chroma push — the fullest register */
        0.0                      /* no station calm */
      );
    }
  `,
});
