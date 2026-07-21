/**
 * `expanse` — stage 1. An open plane running out to a high horizon.
 *
 * ## Depth from projection, not from parallax
 *
 * `drift` fakes depth the cheap way: two noise layers scrolling at different
 * rates. It reads as *motion* and never quite as *distance*, because nothing in
 * it converges. This one does the actual perspective divide.
 *
 * For a screen point below the horizon, the plane it is looking at sits at
 *
 *     depth = PLANE_SCALE / (uv.y - HORIZON)
 *
 * which is the standard y-over-w inversion: depth runs to infinity at the
 * horizon line and shrinks to nothing at the viewer's feet. Feeding that back
 * into the horizontal coordinate — `x * depth` — is what makes the same world
 * width cover fewer and fewer pixels as it recedes. Everything converges on one
 * vanishing line, which is the cue the brain actually reads as space.
 *
 * Scroll is added to the depth axis, so features are born at the horizon and
 * flow toward the player. The field falls toward you rather than past you.
 *
 * ## Why the far half is deliberately empty
 *
 * Two independent reasons, and they happen to want the same thing.
 *
 * The gameplay one: the top of the screen is where enemies enter and where the
 * densest patterns form. It has to be the darkest, least detailed part of the
 * frame, or bullets get lost in it. `background.ts` states the constraint —
 * peak luminance near 0.1, no detail at a bullet's spatial frequency. The kept
 * perspective plane measured 0.080 at the crest pre-rebuild; the lens-whisper
 * layer is now added over it (§4.3), so the crest shifts — analytic worst-case
 * ~0.093 [EST], to be re-measured in acceptance. `GROUND_LIFT` G is trimmed
 * 0.104->0.092 to buy the lens its headroom, and the lens is `max`-composited so a
 * light can only reveal where the plane is darker, never stack over it. The lights
 * are confined to uv.y 0.35-0.50, clear of the top entry lane. Rib row-period
 * ~117px; lens streak ~30x107px and the bokeh ring is a hollow K=14 wall (sigma_f
 * 0.0050 < 0.00625) — no tight cores. Lens-whisper studied from pbakaus/radiant
 * (MIT); our GLSL.
 *
 * Motion: lens drift ~60px/120t lateral + ring breathe +-13px over ~200t — the
 * lens apparatus visibly drifts and pulses. [EST, motion-strip in acceptance.]
 *
 * The numerical one: as `uv.y` approaches the horizon, `depth` grows without
 * bound and adjacent pixels land arbitrarily far apart in world space. Sampling
 * noise there aliases into exactly the fine speckle that reads as bullets. So
 * `detail` decays much faster than `fog` does: the structured terms are gone
 * well before the sampling rate breaks down, and what survives near the horizon
 * is a smooth gradient with nothing to alias.
 *
 * Atmospheric falloff is a `mix` toward `HAZE` rather than a fade to black, and
 * the sky converges on the same `HAZE` at the horizon from above. Both sides of
 * the seam therefore arrive at an identical colour and the horizon line itself
 * is invisible — there is no geometry there, only where two formulas meet.
 */

import { BACKGROUND_NOISE_GLSL, defineBackground } from '../background';

defineBackground('expanse', {
  scrollSpeed: 0.7,
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}

    /* Screen y of the vanishing line, in 0..1 y-down. High, so the plane owns
       most of the frame and the crowded top of the field stays empty. */
    const float HORIZON = 0.20;

    /* Numerator of the perspective divide. Larger pushes the whole plane away. */
    const float PLANE_SCALE = 0.30;

    /* Clamp on the divisor. Without it the horizon row divides by zero; with it
       the maximum representable depth is PLANE_SCALE / MIN_BELOW, and fog has
       already taken that to nothing. */
    const float MIN_BELOW = 0.004;

    /* Depth advance per unit of scroll.
       Small, and it has to be. The rib period is 2*pi/RIB_FREQ in depth units,
       so ticks-per-rib is that over (scrollSpeed * this). At 0.7 px/tick and the
       frequency below, one band passes the bottom of the screen about every 75
       ticks — a steady walk. An earlier value of 0.05 made it 15 ticks, which
       strobes. */
    const float SCROLL_RATE = 0.010;

    /* Bands per depth unit.
       This was 2.2 and the field read as flat, which is worth recording because
       the projection was already correct: depth only spans about 0.4 to 1.0
       across the near two-thirds of the screen, so at 2.2 there was less than a
       quarter of a cycle in the entire region the player looks at. Convergence
       you cannot see is not convergence. The cue needs several bands visible at
       once for the eye to read them as compressing. */
    const float RIB_FREQ = 12.0;

    const vec3 HAZE        = vec3(0.014, 0.020, 0.044);
    const vec3 SKY_TOP     = vec3(0.004, 0.006, 0.014);
    const vec3 SKY_LIFT    = vec3(0.016, 0.034, 0.055);
    const vec3 GROUND_DEEP = vec3(0.016, 0.024, 0.050);
    /* G trimmed 0.104 -> 0.092 to buy the lens layer its headroom. */
    const vec3 GROUND_LIFT = vec3(0.038, 0.092, 0.152);

    /* Lens-whisper: distant lights seen through a lens, drifting and breathing.
       Studied from pbakaus/radiant lens-whisper (MIT); our GLSL. Centres sit in
       the mid-lower band (uv.y 0.38-0.46); the streak's y-Gaussian and the bokeh
       ring carry the visible feature to ~uv.y 0.27-0.57, still clear of the top
       entry lane (uv.y -> 0). max-composited so a light never STACKS over the
       plane. Tight Gaussian cores
       are deliberately absent (a bright pinpoint is a fake bullet): the streak is
       broad on both axes and the bokeh is a hollow ring wall. */
    const vec3  CYAN_LIGHT = vec3(0.030, 0.070, 0.090);   /* <= 0.1 */
    const float DRIFT_RATE = 0.005;   /* lateral ~0.5px/tick */
    const float BREATHE    = 0.017;   /* ring radius pulses over ~200t */

    vec3 lensLayer(vec2 uv, float aspect) {
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 3; i++) {
        float fi = float(i);
        vec2  lp = vec2(0.30 + 0.20 * sin(uScroll * DRIFT_RATE + fi), 0.38 + 0.04 * fi);  /* centres y 0.38-0.46; tails reach ~0.27-0.57 */
        vec2  dd = (uv - lp) * vec2(aspect, 1.0);
        float streak = exp(-(dd.y * dd.y) * 220.0) * exp(-(dd.x * dd.x) * 18.0);  /* anamorphic: ~30x107px, no core */
        float rr     = 0.09 + 0.02 * sin(uScroll * BREATHE);                      /* breathes +-13px */
        float rd     = (length(dd) - rr) * 14.0;
        float ring   = exp(-rd * rd);                                             /* bokeh wall K=14, hollow */
        float pulse  = 0.7 + 0.3 * sin(uScroll * 0.02 + fi * 2.1);
        acc = max(acc, (streak * 0.6 + ring * 0.5) * pulse * CYAN_LIGHT);         /* max -> never stack */
      }
      return acc;
    }

    vec3 background(vec2 uv) {
      float aspect = uRes.x / uRes.y;

      /* ---- the plane, below the horizon ---- */

      float below = max(uv.y - HORIZON, 0.0);
      float depth = PLANE_SCALE / max(below, MIN_BELOW);

      /* World point under this pixel. Multiplying x by depth is the whole
         perspective effect — it is what makes parallel lines converge. */
      vec2 w = vec2((uv.x - 0.5) * aspect * depth, depth + uScroll * SCROLL_RATE);

      float fog = exp(-depth * 0.16);

      /* Structure dies far sooner than brightness does; see the header. */
      float detail = exp(-depth * 0.28);

      float ground = bgFbm(w * vec2(0.85, 2.4));

      /* Bands of constant depth. They compress toward the horizon, which is the
         single strongest read of distance available in a flat image. */
      float ribs = 0.5 + 0.5 * sin(w.y * RIB_FREQ);

      vec3 lit = GROUND_DEEP + GROUND_LIFT * (0.35 + detail * (0.40 * ground + 0.25 * ribs));
      vec3 plane = mix(HAZE, lit, fog);

      /* ---- the sky, above it ---- */

      float above = max(HORIZON - uv.y, 0.0);
      float lift = smoothstep(0.0, HORIZON, above);

      /* A hump, so the band contributes nothing at either end: zero at the
         horizon keeps the seam exact, zero at the top keeps the entry lane
         clean. Sampled almost still — the sky is the far layer, and a distant
         thing that moves at the speed of the ground is not distant. */
      float hump = 4.0 * lift * (1.0 - lift);
      float band = bgFbm(vec2(uv.x * aspect * 1.5, uv.y * 4.0 - uScroll / uRes.y * 0.30));

      vec3 sky = mix(HAZE, SKY_TOP, lift) + SKY_LIFT * band * hump;

      /* Both sides already agree at the horizon; the smoothstep is only here to
         antialias the row where the two formulas swap over. */
      vec3 col = mix(sky, plane, smoothstep(HORIZON - 0.004, HORIZON + 0.004, uv.y));

      /* The lens layer over the kept plane, max-composited so it can only reveal
         a light where the plane is darker, never brighten the plane itself. */
      return max(col, lensLayer(uv, aspect));
    }
  `,
});
