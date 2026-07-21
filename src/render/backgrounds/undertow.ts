/**
 * `undertow` — stage 2. A shaft, seen from inside, falling forward.
 *
 * ## Enclosure, as the counterpart to stage 1
 *
 * `expanse` is an open plane under an open sky and its vanishing line runs the
 * full width of the screen. This is the opposite space: the vanishing point is
 * a single dark hole near the top of the frame, and the walls wrap all the way
 * around the viewer. Same projection trick, inverted geometry — stage 2 should
 * feel like the ceiling came down, and that is a property of the shape rather
 * than of the palette.
 *
 * The projection is the polar form of the same divide. For a screen point at
 * radius `r` from the vanishing point,
 *
 *     depth = SHAFT_SCALE / r
 *
 * so the wall runs to infinity at the centre and passes closest at the corners.
 * Adding scroll to that axis pulls the walls outward past the viewer, which is
 * forward motion down the shaft.
 *
 * ## The seam problem, and why there are exactly six flutes
 *
 * The obvious way to texture a tunnel is to sample noise at `(angle, depth)`.
 * It does not work: `atan` jumps from +pi to -pi across one ray, the noise
 * either side of that ray is unrelated, and the result is a hard crack running
 * out of the vanishing point. Nothing in the shader can hide it, because it is
 * a discontinuity in the coordinate rather than in the noise.
 *
 * So the angular coordinate here is only ever fed through functions that are
 * genuinely periodic in it. `sin(a * 6.0)` closes exactly — six is an integer,
 * so the value and every derivative match across the wrap — and the noise is
 * then sampled against *that* rather than against the angle. Seamless by
 * construction rather than by a fudge factor, and the six-fold repeat gives the
 * shaft a built read that an open plane should not have.
 *
 * ## Detail decays faster than light
 *
 * Same reasoning as `expanse`, and more necessary here: angle varies infinitely
 * fast at the vanishing point, so anything derived from it aliases there. The
 * `detail` term takes every structured contribution to zero before the sampling
 * rate goes, leaving a smooth dark well exactly where enemies enter and where
 * speckle would be read as bullets.
 *
 * The palette is indigo, deliberately, and its job is now distinctness from the
 * seals rather than from `surge`. The base game no longer cross-fades to `surge`
 * (that comparandum is pack-only now); instead the stage-2 bosses stamp two seals
 * over this indigo — warden's `cordon` (olive-brass) and magistrate's `intaglio`
 * (bone). Neither is a gold-on-indigo flash: both are separated from the indigo
 * by desaturation (R ~= G) and by the seal's flat centred geometry, so the
 * stage -> boss transition reads as the fight changing gear, not the lights
 * coming up — the exact bar this header always held, now held against the seals.
 *
 * ## Four places, four quadrants
 *
 * `undertow` is the second of four stage scenes chosen to occupy four hue
 * quadrants, four geometry families, and a spread of periods, so no two are
 * mistaken for each other: `expanse` cyan-ice / horizon line (R/G ~0.37 post-
 * graft), `undertow` indigo / vanishing point (R/G ~2.1, B-high), `stratum`
 * verdigris / flat bands (G-dominant), `vault` gold / concentric dome (R/G ~1.4).
 * This one is the B-high polar shaft: vanishing POINT, six integer flutes, ring
 * ~50 ticks, peak ~0.072 [EST] — the shaft substrate is unchanged, so the peak is
 * near the pre-rebuild ~0.07 and re-measured in acceptance.
 *
 * ## Refractive chromatic-swim (tropical-heat, §4.2)
 *
 * The shaft is factored into `vec3 shaft(vec2 uv)` (projection, flutes, rings —
 * unchanged) and sampled PER CHANNEL at heat-flow offsets: R at +d, B at -d, and
 * **G undisplaced**. G carries 0.72 of Rec.709 luma, so the luminance ceiling is
 * protected and only the chroma fringe (R-B separation <= ~10px, < a 16px bullet)
 * moves — a dim low-contrast colour fringe on a smooth ramp, never a compact bright
 * blob. Motion: chromatic-swim ~55px/120t (high-salience even at low luminance) +
 * the shaft's ring forward-fall ~50t. `test:density` is the arbiter; fallback
 * lowers `HEAT_AMP` or drops the chroma on ring transitions. Tropical-heat studied
 * from pbakaus/radiant (MIT); our GLSL. [EST, motion-strip in acceptance.]
 */

import { BACKGROUND_NOISE_GLSL, defineBackground } from '../background';

defineBackground('undertow', {
  scrollSpeed: 0.9,
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}

    /* Where the shaft runs away to. High and centred: the far point sits in the
       entry lane, and the far point is the darkest thing on screen. */
    const vec2 VANISHING = vec2(0.5, 0.16);

    const float SHAFT_SCALE = 0.26;

    /* Radius clamp. Guards the divide, and caps depth at a value fog has
       already taken to nothing. */
    const float MIN_RADIUS = 0.002;

    /* Integer, or the angular wrap stops closing and the crack comes back. */
    const float FLUTES = 6.0;

    /* See expanse.ts for the arithmetic behind both of these. Same trap, same
       fix: the depth range actually visible on screen is roughly 0.3 to 1.7, so
       a ring frequency of 3 put barely half a cycle in the whole frame and the
       shaft read as a flat vignette. */
    const float SCROLL_RATE = 0.010;

    /* Measured rather than chosen: at 9.0 a readback across the visible radius
       showed about one ring in the whole frame, because the depth range on
       screen is only ~0.3 to 1.0. This puts two or three in view, which is
       enough to read as compressing without the walls turning into stripes.
       One ring passes about every 50 ticks — quicker than expanse's 75, and a
       shaft you are falling down should feel quicker than an open plain. */
    const float RING_FREQ = 14.0;

    const vec3 HAZE      = vec3(0.020, 0.008, 0.032);   /* was (0.018,0.010,0.030) */
    const vec3 WALL_DEEP = vec3(0.032, 0.012, 0.048);   /* was (0.026,0.014,0.044) */
    const vec3 WALL_LIFT = vec3(0.120, 0.036, 0.150);   /* violet 284; was (0.100,0.048,0.150) */

    /* Tropical-heat refractive swim (studied from pbakaus/radiant; our GLSL). A
       coarse flowing field displaces R and B in opposite directions while G is
       sampled UNDISPLACED — G carries 0.72 of Rec.709 luma, so the luminance
       ceiling is protected and only the chroma fringe moves. HEAT_FREQ 1.4 keeps
       the field at full-frame lobes; HEAT_RATE flows it ~55px / 120 ticks;
       HEAT_AMP 0.016 holds the R<->B separation <= ~10px (< a 16px bullet). */
    const float HEAT_FREQ = 1.4;
    const float HEAT_RATE = 0.0009;
    const float HEAT_AMP  = 0.016;

    /* The shaft itself, factored out so the chromatic pass can sample it per
       channel at heat-flow offsets. Projection, six flutes, rings — unchanged. */
    vec3 shaft(vec2 uv) {
      float aspect = uRes.x / uRes.y;

      vec2 c = (uv - VANISHING) * vec2(aspect, 1.0);
      float r = max(length(c), MIN_RADIUS);
      float a = atan(c.y, c.x);

      float depth = SHAFT_SCALE / r;
      float along = depth + uScroll * SCROLL_RATE;

      float fog = exp(-depth * 0.22);
      float detail = exp(-depth * 0.30);

      /* Periodic in the angle, so it survives the atan wrap unbroken. */
      float flutes = 0.5 + 0.5 * sin(a * FLUTES);

      /* Noise sampled against the flutes rather than the angle, which inherits
         their periodicity. Seamless, and it stops the six lobes from reading as
         six identical copies. */
      float grain = bgFbm(vec2(flutes * 2.2, along * 1.6));

      /* Rings of constant depth, compressing toward the vanishing point. This
         is the term that actually sells the forward motion. */
      float ridges = 0.5 + 0.5 * sin(along * RING_FREQ);

      vec3 lit = WALL_DEEP + WALL_LIFT * (0.34 + detail * (0.38 * grain + 0.28 * ridges));

      return mix(HAZE, lit, fog);
    }

    vec3 background(vec2 uv) {
      float aspect = uRes.x / uRes.y;

      /* Two coarse flowing fields drive the per-channel offset. G undisplaced. */
      float h1 = bgFbm(vec2(uv.x * aspect * HEAT_FREQ,       uv.y * HEAT_FREQ - uScroll * HEAT_RATE));
      float h2 = bgFbm(vec2(uv.x * aspect * HEAT_FREQ + 3.1, uv.y * HEAT_FREQ - uScroll * HEAT_RATE * 0.8));
      vec2  d  = (vec2(h1, h2) - 0.5) * HEAT_AMP;

      float R = shaft(uv + d).r;
      float G = shaft(uv    ).g;   /* undisplaced -> ceiling protected */
      float B = shaft(uv - d).b;
      return vec3(R, G, B);
    }
  `,
});
