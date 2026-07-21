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
 *   - Peak luminance 0.068 measured (analytic ceiling ~0.071: Rec.709 of
 *     BASE + GLOW * m_max, m_max ~= 0.83, base_lum ~0.0111 + glow_lum ~0.0720).
 *     Under the 0.1 `background.ts` asks for; the crest sits just below its
 *     ceiling, as vault's does.
 *   - Device period: the family ring train is (2*pi/36)*640 ~= 112px analytic,
 *     measured 106px on `regnum` (the filled seal, where the rings span the
 *     field). Here the sparse filter leaves the single ring-band envelope
 *     dominant — coarser still. Bullet-band (16-30px) spectral amplitude
 *     measures 9% of the dominant structure: an order of magnitude down.
 *   - Palette relation R/G 1.33 measured masked-mean (1.36 exact off the GLOW
 *     vec3). Clear of cordon 0.92, intaglio 1.02, and the two reds.
 *   - Rotation ~0.00048 rad/tick (ROT 0.0006 * scrollSpeed 0.8): a calm turn, the
 *     cell stated without hurry.
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
