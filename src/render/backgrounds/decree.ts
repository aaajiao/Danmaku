/**
 * `decree` — chancellor's "Sealed" AND regent's "Sine Die" (both Lunatic only).
 * The 出神 pair's sibling variant, SHARED by both cards. A NEAR-IDENTICAL port of
 * pbakaus/radiant `stardust-veil` (MIT), reusing the basis `umbra` owns.
 *
 * ## One scene for two cards, one basis for the pair
 *
 * `fiat` is a single music track sounded by both the chancellor's "Sealed" and the
 * regent's "Sine Die" — the whole cell dissolving, locrian. `decree` is the visual
 * of that shared track: one scene both fiat cards name, the tighter rhyme (one
 * track ↔ one scene, chancellor + regent sharing both). This MOVES "Sine Die" off
 * `vault` — the trade the design accepted: it loses "drains to the gold of the
 * empty seat" and gains the shared-fiat rhyme. `vault` stays the stage-4 scene, so
 * it is still declared and reachable.
 *
 * The picture is `umbra`'s exported `VEIL_GLSL` — the same domain-warped purple
 * nebula, aurora ribbons, parallax stardust and traveling wave. Identity comes from
 * the port; `decree` only grades and modulates it. The engraved-seal cell, the
 * dither and the vortex pull are all retired for this pair — no `SEAL_GLSL` import.
 *
 * ## The role kept, the picture replaced
 *
 * `decree` is still the seal UNMOORED and DRAINING — the court decreeing without a
 * device, authority with nothing left to press. Where the old cell drained its
 * filled rosette to a bare ring, the veil drains as a whole: a slow global dim plus
 * a faint downward run (the fill leaving the frame), over the same off-station
 * precession `umbra` uses. The 出神 threshold is crossed by COHERENCE and MOTION —
 * drift, drain, wave — never by luminance.
 *
 * ## The variant — bleached rose, draining
 *
 * `umbra` is cold blue-violet; `decree` bleaches the same nebula toward a cold
 * rose-grey (regnum's crimson drained of its heat) and desaturates it harder (a
 * larger `veilGrade` amount — the bleaching read). The drain modulation is
 * `decree`'s alone; everything else in the picture is the shared basis.
 *
 * ## Bounded by the seal FAMILY's budget — the hard rule
 *
 * As with `umbra`: the 出神 pair is the RELATIVELY DIMMEST family — below `sable`,
 * the darkest stated seal. `decree` serves TWO fights, in one of which the other
 * seal (`sable`) is the darkest of the five; a single shared scene cannot be dimmer
 * than both, so `decree` sits at the FAMILY BOTTOM rather than beneath each fight's
 * own seal. Readability holds because that bottom is still far under a bullet's
 * 1.0-white + bloom and the play band wins the contrast fight. Splitting `decree`
 * into a second, dimmed variant for the chancellor was rejected to keep the
 * shared-fiat rhyme (one track ↔ one scene), exactly as the design chose.
 *
 * ## The bullet-band knob (shared)
 *
 * Inherited whole from `VEIL_GLSL`: the reference's sharp star core is DROPPED, only
 * the broadened Gaussian glow survives (a soft dust blob, never a pinpoint); the
 * near-star flares and connecting threads are dropped; the aurora ridge FBM is
 * 4→3 octaves (finest ridge ~47px, above the play band); film grain dropped. See
 * `umbra.ts` for the full accounting.
 *
 * ## Exposure & readability
 *
 * Aurora-ridge peaks land ~0.11-0.14 raw [MEASURED-IN-ACCEPTANCE] at EXPOSURE 0.27,
 * the drain multiplying that further down. The stardust is a soft dim shimmer, the
 * nebula a near-black deep-purple haze bleached rose. Motion: precession + drain +
 * wave + slow twinkle, every per-tick step bounded [MEASURED-IN-ACCEPTANCE]. The
 * acceptance pass tunes `EXPOSURE`, `STAR_GAIN`, and the shared `VEIL_STAR_GLOW_*`.
 *
 * ## Clock
 *
 * `uScroll` only — no `performance.now`, no wall clock (see `background.ts`,
 * rule 1). Drift, precession, drain, twinkle and wave are all `sin`/`cos`/`fract`
 * of `uScroll`. `backgrounds/index.test.ts` scans this file for wall-clock sources.
 *
 * stardust-veil by pbakaus/radiant, MIT. Ported (basis in `umbra.ts`); our clock,
 * y-down projection, bleached-rose palette, drain modulation, and exposure.
 */

import { BACKGROUND_NOISE_GLSL, defineBackground } from '../background';
import { VEIL_GLSL } from './umbra';

defineBackground('decree', {
  scrollSpeed: 1.2,
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}
${VEIL_GLSL}

    const float EXPOSURE  = 0.27;   /* 出神 pair, family bottom — serves the sable fight too */
    const float STAR_GAIN = 0.5;    /* stardust dimmed well under a bullet (shared with umbra) */

    /* Bleached rose — regnum's crimson drained of its heat toward a cold rose-grey
       as the seal dissolves. Desaturated harder than umbra (the bleaching read). */
    const vec3 VEIL_TINT = vec3(1.12, 0.88, 0.96);

    vec3 background(vec2 uv) {
      float t = uScroll * 0.013;   /* the regent turns a touch faster than sentinel */

      /* The veil precesses slowly off-station, unfilled — the device adrift.
         sin/cos of uScroll only, ticks, no wall clock. */
      vec2 drift = 0.03 * vec2(cos(uScroll * 0.0038), sin(uScroll * 0.0038));
      vec2 p = veilCoord(uv, drift);

      vec3 col = veilCompose(p, t, STAR_GAIN);
      col = veilGrade(col, VEIL_TINT, 0.46);   /* stronger desaturation = the bleaching */

      /* The fill draining out: a slow global breathing dim plus a faint downward
         run, a ≤1 multiply on uScroll — luminance only ever drops, the authority
         leaving the frame. Never-brighter preserved. */
      float drain = mix(0.62, 1.0, 0.5 + 0.5 * sin(uScroll * 0.0018 - uv.y * 1.5));
      col *= drain;

      col = veilTonemap(col);
      return col * EXPOSURE;
    }
  `,
});
