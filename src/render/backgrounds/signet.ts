/**
 * `signet` — sentinel's fight (the stage-1 boss). The seal STATED plainly.
 *
 * ## The seal family, and this one's filter
 *
 * The five boss scenes are one cell — `SEAL_GLSL`, a compass-and-rule engraving
 * (a bounding ring with a hexagram and six radial rays unioned in) — stamped
 * through five filters, the visual counterpart of the audio round's one CELL
 * through five treatments. `signet` is the cell said plainly and answered by
 * rest: a **whole** ring, the **full hexagram and six rays**, an eased ratchet,
 * and the field **outside the ring empty** — the seal entire, the rest around it
 * silent. It rhymes with `nemesis`'s STATED cell.
 *
 * It is a STATE, not a place (the `surge` doctrine): it stamps over whichever
 * stage field sentinel was met in when the first spell card lands, and builds no
 * competing perspective of its own, so nothing runs to infinity and aliases at
 * the crowded centre. Sentinel's named cards — Tidal Corolla, Vigil Unbroken —
 * both name it, so once the seal is down it stays down.
 *
 * ## Hue — gold
 *
 * The gold of wax and brass, chosen against BOTH sentinel's ice sprite (warmth
 * against cold) AND `expanse`'s cyan, so the stage-1 -> boss cross-fade reads as
 * the fight changing gear, not the lights coming up (the exact bar `undertow`'s
 * header held). R/G near 1.36 off the glow vec3, the warmest of the five seals
 * after sable/regnum's reds and clear of cordon's olive and intaglio's bone.
 *
 * ## Clock
 *
 * Driven by `uScroll` only, which advances in `step()` and nowhere else. No
 * `performance.now`, no wall clock — a pure function of accumulated ticks, so a
 * replay looks identical twice (see `background.ts`, rule 1).
 * `backgrounds/index.test.ts` scans this file for wall-clock sources.
 *
 * ## Numbers
 *
 * The engraved-union rebuild changed the picture; the figures below are the
 * design's derived worst-case, flagged [EST], to be replaced by live measurement
 * in the operator acceptance pass. The pre-rebuild MEASURED peak (0.0926) no
 * longer describes this code — it was a bare-ring cell, and the union raises the
 * coverage of primary~=1, so the peak shifts. (The pre-round complaint that the
 * old rendering was "imperceptibly different from the old" is exactly what this
 * rebuild fixes; that narration is retired.)
 *
 *   - Peak luminance ~0.22-0.24 raw [MEASURED-IN-ACCEPTANCE], at the retired-
 *     ceiling era's ×3 exposure (shared `SEAL_GAIN` 3.6). The 0.1 ceiling is gone
 *     (see background.ts SEAL_GLSL); the arbiter is bullet readability under a real
 *     curtain. If a seal reads too hot, drop SEAL_GAIN — cordon is the binding one.
 *   - Device period: the subordinate ring train is (2*pi/36)*640 ~= 112px
 *     analytic. Every stroke (ring, hexagram, ray) uses the K=16 cross-section
 *     (sigma_f 0.00563 < 0.00625 cyc/px, ~90% of budget; K-ceiling ~17.8) — no new
 *     spatial frequency, union-bounded. Hexagram strap vertices near the centre
 *     are the one bullet-band watch (test:density).
 *   - Palette relation R/G ~1.36 off the GLOW vec3, unchanged — BASE/GLOW
 *     untouched. Clear of cordon ~0.90, intaglio ~1.04, and the two reds.
 *   - Motion: eased ratchet, one SEAL_DETENT (~7.5deg) detent per ~100 ticks,
 *     eased over the last ~18t (~1.1px/tick at Rstar) — a VISIBLE tick now, the
 *     angularly-rich engraving turning; plus the travelling `sweep` orbiting the
 *     strokes continuously during the hold, and the ~270t contraction. Per-tick
 *     max |Δ| bounded by the ease span (>=10t, no temporal bullet). Displacement
 *     over 1s: a full detent lands within the ratchet band. [EST, motion-strip in
 *     acceptance.]
 *   - Engraved compass-and-rule linework studied from pbakaus/radiant
 *     radiant-geometry + liquid-gold (MIT); our GLSL, noise and clocks.
 */

import { BACKGROUND_NOISE_GLSL, SEAL_GLSL, defineBackground } from '../background';

defineBackground('signet', {
  scrollSpeed: 0.8,
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}
${SEAL_GLSL}

    /* Gold — wax, brass, the signet. R > G > B, R/G ~1.36. Chosen against
       sentinel's ice sprite and expanse's cyan; see the header. */
    const vec3 BASE = vec3(0.014, 0.011, 0.004);
    const vec3 GLOW = vec3(0.095, 0.070, 0.024);

    vec3 background(vec2 uv) {
      float m = sealField(
        uv, uRes.x / uRes.y, uScroll,
        vec2(0.5, 0.42),   /* centred on the boss station */
        0.34,              /* bounding ring radius */
        36.0,              /* ring frequency (~112px device period) */
        6.0,               /* six-fold rosette (integer) */
        4.0,               /* arcHalf > PI -> a whole seal */
        0.0,               /* sparse rosette: the field outside is rest */
        0.0,               /* device bright (not inverted) */
        0.001636,          /* eased ratchet, ~100t detent */
        0.0,               /* no moire */
        3.0,               /* centre falloff */
        2.4,               /* top-lane falloff */
        1.5708             /* raking light from the top (the reference control) */
      );
      return BASE + GLOW * m;
    }
  `,
});
