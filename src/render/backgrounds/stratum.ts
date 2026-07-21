/**
 * `stratum` — stage 3. Broad horizontal strata of settled record, scrolling
 * slowly downward as the player descends through them.
 *
 * ## Lateral layering, the third of three spaces
 *
 * `expanse` is an open plane converging on a horizon; `undertow` is a shaft seen
 * from inside, both perspective scenes with a vanishing point. This one is
 * neither. It is flat, and it is horizontal: parallel bands of accumulated
 * sediment — the strata of authority the descent has been passing through —
 * stacked up the frame and settling downward past the viewer. Where the first
 * two levels convince the eye of depth, this one convinces it of *weight*: layer
 * on layer of what was decided before you arrived. That is a property of the
 * shape, not the palette.
 *
 * There is no perspective divide here, so no vanishing point and no radius clamp.
 * The near-far axis is simply the frame's own vertical: the bottom of the screen
 * is the stratum nearest the descent, the top is the oldest layer — and, not by
 * coincidence, the lane enemies enter through.
 *
 * ## The seam, and why it cannot crack the way a tunnel's does
 *
 * `undertow` had to fight an angular seam: sampling noise at `(angle, depth)`
 * cracks along the ray where `atan` wraps from +pi to -pi. There is no wrapped
 * coordinate here — the scroll is a plain vertical translation — so the class of
 * seam that discipline guards against does not exist. What remains is the milder
 * hazard that dust sampled directly against a raw scrolling coordinate would
 * shear across a band boundary. The fix is the same one `undertow` uses: build
 * the strata out of `sin`, which is smoothly periodic and continuous as a band
 * is born at the top and dies at the bottom, and sample the dust against that
 * band value rather than against the coordinate, so the grain rides the layers
 * instead of cutting across them.
 *
 * ## Detail decays faster than light
 *
 * Same doctrine as the two perspective scenes, honoured here on the vertical
 * axis: brightness falls gently toward the top of the frame, but band sharpness
 * and dust fall off far faster (`near * near` against a linear light term), so
 * the finest rules have dissolved into a smooth dark well well before they reach
 * the crowded entry lane where a fine detail would alias into sparse bullets.
 *
 * ## Palette — verdigris / oxidised bronze
 *
 * Cold green-grey: tarnished seals, patinated metal, the colour of a record left
 * to age. Chosen relationally, exactly as `undertow` chose indigo. It is the
 * third of four stage scenes chosen to occupy four hue quadrants and four
 * geometry families: `expanse` cyan-ice / horizon line (R/G ~0.37 post-graft),
 * `undertow` indigo / vanishing point (B-high), this one verdigris / flat bands
 * (G-dominant, G/B ~1.1), `vault` gold / concentric dome (R/G ~1.4) — no two
 * mistaken for each other. And it must sit far from the RED of the seal its own
 * boss stamps: the chancellor's `sable` (oxblood, R/G ~3) is the maximum red-vs-
 * green opposition against this verdigris, so the stage-3 -> boss transition
 * reads as the fight changing gear, not the lights coming up. (`surge`'s red is
 * the same relation, but that comparandum is pack-only now — the base game no
 * longer cross-fades to it.)
 *
 * ## Clock
 *
 * Driven by `uScroll` only, which advances in `step()` and nowhere else. No
 * `performance.now`, no wall clock — the scene is a pure function of accumulated
 * ticks, so a replay looks identical twice (see `background.ts`, rule 1).
 *
 * ## Numbers
 *
 * The tectonic fold-flow rebuild (§4.1) added a coarse domain warp and per-stratum
 * tone; figures are design-derived [EST], to be re-measured in acceptance.
 *
 *   - Peak luminance ~0.087 [EST] = the pre-rebuild ceiling: the warp only
 *     DISPLACES the band coordinate (luminance unchanged) and `tone` <= 1 only
 *     REDUCES some bands, so neither raises the ceiling. Under the 0.1
 *     `background.ts` asks for.
 *   - Band period ~112px analytic (`BAND_FREQ` 36 over 640px, ~six strata) — an
 *     order coarser than a 16-30px bullet. The warp is >= full-frame scale
 *     (WARP_FREQ 0.9) and `tone` is piecewise-constant per band (keyed to the band
 *     INDEX), so neither introduces a new spatial frequency.
 *   - Motion: fold-flow ~52px/120t (the signature — folds visibly migrate) + band
 *     settle ~71t/band (secondary). [EST, motion-strip in acceptance.]
 *   - Palette relation: green-dominant (G/B ~1.1, red lowest) against its boss seal
 *     `sable`'s red (oxblood), the maximum red-vs-green opposition, so the
 *     spell-card cross-fade reads as the hue turning over, not the lights coming
 *     up.
 *   - Painted-strata studied from pbakaus/radiant (MIT); our GLSL.
 */

import { BACKGROUND_NOISE_GLSL, defineBackground } from '../background';

defineBackground('stratum', {
  scrollSpeed: 0.7,
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}

    /* Bands per screen height. 36 puts about six broad strata across the frame
       (36 / 2pi), each spanning roughly a sixth of the 640px field — about
       112px. Unlike undertow's flute count this need not be an integer: there is
       no angular wrap to close, only a vertical scroll, so any value stays
       smooth. */
    const float BAND_FREQ = 36.0;

    /* Settle rate: at scrollSpeed 0.7 the band phase advances BAND_FREQ *
       SCROLL_RATE * 0.7 = 0.0882 rad/tick, so one stratum passes a fixed row
       about every 71 ticks — the secondary motion under the fold-flow. */
    const float SCROLL_RATE = 0.0035;

    /* Tectonic fold-flow — the signature motion. A coarse domain warp folds the
       band coordinate and migrates it laterally. WARP_FREQ 0.9 keeps folds at
       >= full-frame scale (never bullet-fine); WARP_AMP 0.075 displaces the band
       coord by <= +/-24px; WARP_RATE migrates the folds ~52px / 120 ticks. */
    const float WARP_FREQ = 0.9;
    const float WARP_AMP  = 0.075;
    const float WARP_RATE = 0.0009;

    /* Verdigris / oxidised bronze — cold green-grey. See the header for why the
       hue is chosen against expanse's ice-blue, undertow's indigo, and above all
       surge's red. */
    const vec3 HAZE = vec3(0.005, 0.014, 0.013);   /* was (0.006,0.014,0.012) */
    const vec3 DEEP = vec3(0.009, 0.022, 0.021);   /* was (0.010,0.022,0.019) */
    const vec3 LIFT = vec3(0.028, 0.082, 0.078);   /* teal 175; was (0.035,0.082,0.070) */

    vec3 background(vec2 uv) {
      float aspect = uRes.x / uRes.y;

      /* The near-far axis is the frame's own vertical: 1 at the near bottom, 0 at
         the far top. Structure is spent along it; brightness far less so. */
      float near = uv.y;

      /* The fold: a coarse migrating warp added to the band coordinate. It only
         DISPLACES the phase — luminance is unchanged — so the strata visibly
         fold and flow without brightening. */
      float warp = bgFbm(vec2(uv.x * aspect * WARP_FREQ, uv.y * WARP_FREQ - uScroll * WARP_RATE));

      /* Scroll subtracts, so a fixed stratum drifts to larger uv.y over time --
         the record settling downward past the viewer -- plus the fold offset. */
      float along = near - uScroll * SCROLL_RATE + WARP_AMP * (warp - 0.5);

      /* The strata. sin is smoothly periodic, so a band is continuous as it is
         born at the top and dies at the bottom — nothing here can crack the way a
         tunnel's angular seam can, because there is no wrapped coordinate. */
      float bands = 0.5 + 0.5 * sin(along * BAND_FREQ);

      /* Per-stratum tone, keyed to the band INDEX so it is piecewise-constant per
         band (never a new spatial frequency). tone <= 1, so it only ever REDUCES
         some bands -- luminance ceiling protected. The 0.25 index bias parks the
         step in the band trough so it never pops on a crest. */
      float bIdx = floor(along * BAND_FREQ / 6.2831853 + 0.25);
      float tone = 0.6 + 0.4 * bgHash(vec2(bIdx, 3.0));

      /* Dust between the strata, sampled against the band value rather than the
         raw coordinate so it rides the layers instead of shearing across them --
         the same trick undertow uses to keep grain seamless. */
      float grain = bgFbm(vec2(uv.x * aspect * 2.0, bands * 3.0 + along * 1.4));

      /* Brightness falls gently toward the top; detail falls far faster, so the
         finest rules have dissolved into a smooth dark well before they reach the
         crowded entry lane where they would alias into sparse bullets. */
      float light = 0.30 + 0.70 * near;
      float detail = near * near;

      vec3 lit = DEEP + LIFT * (0.30 + detail * (0.42 * grain + 0.28 * bands * tone));
      return mix(HAZE, lit, light);
    }
  `,
});
