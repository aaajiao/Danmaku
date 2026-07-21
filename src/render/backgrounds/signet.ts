/**
 * `signet` — sentinel's fight (the stage-1 boss). The seal STATED plainly.
 *
 * ## The seal family, and this one's filter
 *
 * The five boss scenes are one cell — `SEAL_GLSL`, a bounding ring enclosing an
 * N-fold rosette — stamped through five filters, the visual counterpart of the
 * audio round's one CELL through five treatments. `signet` is the cell said
 * plainly and answered by rest: a **whole** ring, a **full six-spoke rosette**,
 * a calm rotation, and the field **outside the ring empty** — the seal entire,
 * the rest around it silent. It rhymes with `nemesis`'s STATED cell.
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
 * MEASURED live (`bun run dev`, scene on the real quad, `__background.name`
 * verified, sprites masked, Rec.709, bloom on), the way `vault`/`stratum` quote
 * theirs; the analytic derivation stays beside each figure. Also verified in its
 * genuine consumer: the sentinel fight, stamped at the first card and held
 * through Vigil Unbroken.
 *
 *   - Peak luminance MEASURED 0.0926 whole-field (field mean 0.0267). The
 *     as-designed body measured 0.0565 — below the pre-round 0.068 hold-band
 *     and, by the user's live verdict, imperceptibly different from the old
 *     rendering — so the acceptance calibration raised the shared-cell gain
 *     0.90 -> 1.50, spending the headroom the decisions doc licenses (peaks may
 *     sit anywhere under the 0.1 law). Analytic: m_max ~= 1.28 (0.03 + 1.50 *
 *     0.83), base_lum ~0.0111 + glow_lum ~0.0720 -> 0.092, matching measured.
 *     Under the 0.1 `background.ts` asks for.
 *   - Device period: the family ring train is (2*pi/36)*640 ~= 112px analytic,
 *     measured 106px on `regnum`. The bounding ring is now the engraved K=16
 *     annulus (FWHM ~94px analytic vs the old ~215px), still bullet-coarse
 *     (sigma_f 0.00563 < 0.00625 cyc/px, ~90% of budget; K-ceiling ~17.8).
 *     Bullet-band (16-30px) amplitude measured 1.2% of the device amplitude
 *     (sinusoid projection on the detrended radial profile; the calibration
 *     gain scales both terms linearly, so the ratio is gain-invariant).
 *   - Palette relation R/G 1.33 measured masked-mean (1.36 exact off the GLOW
 *     vec3), unchanged — BASE/GLOW untouched. Clear of cordon 0.92, intaglio
 *     1.02, and the two reds.
 *   - Rotation ~0.00048 rad/tick average (ROT 0.0006 * scrollSpeed 0.8), now
 *     RATCHETED into SEAL_DETENT (~7.5deg) steps — a calm tick, not a continuous
 *     turn. The bright ring is rotation-invariant, so the step carries no
 *     luminance change on the class marker (see SEAL_GLSL motion).
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
        0.0006,            /* calm rotation */
        0.0,               /* no moire */
        3.0,               /* centre falloff */
        2.4                /* top-lane falloff */
      );
      return BASE + GLOW * m;
    }
  `,
});
