/**
 * V4 integration (2026-07-24): champagne fizz is reinterpreted as sparse archive
 * blisters in cold glass. Every visible membrane is at least about 46px,
 * concentrated away from the centre/lower flight band, with no rim, specular
 * point or pop. Historical amber notes describe the source, not current colour.
 */

/**
 * `sable` — chancellor's fight (the stage-3 boss). A NEAR-IDENTICAL port of
 * pbakaus/radiant `champagne-fizz` (MIT): a near-black glass with a slow stream
 * of warm amber bubbles rising in columns from the bottom, wobbling as they
 * climb, growing a hair with the falling pressure, and popping out at a faint
 * undulating surface line near the top. V4 retains that rising-field identity but
 * enlarges it into sparse cold archive blisters that remain legible at production
 * ×1.
 *
 * ## The reference is not GLSL — it is reconstructed
 *
 * Unlike the five direct ports (drift/surge/expanse/undertow/stratum), the
 * champagne-fizz reference carries **no fragment shader**: it is a Canvas2D
 * particle simulation (a bubble pool spawned at nucleation sites, integrated on a
 * wall clock, drawn with `arc`/`createRadialGradient`). There is nothing to lift
 * verbatim. So the *picture* is ported, not the code: the bubble pool becomes a
 * deterministic tiled field — one soft bubble per grid cell, the grid scrolling
 * upward so cells rise, each cell hashed to the reference's per-bubble properties
 * (size, opacity, x-jitter, wobble, hue-shift). Same image, reconstructed as a
 * pure function of `uv` and the tick clock, which is what our surface requires.
 *
 * ## What was ported (the defining image)
 *
 * The reference's identity verbatim: rising bubbles concentrated in a handful of
 * nucleation columns; a per-bubble sinusoidal side-to-side wobble that makes each
 * path sinuous; a size distribution biased tiny with occasional larger ones; a
 * slight growth as a bubble rises (the reference's pressure-drop expansion); a
 * fade-in at birth near the bottom and a pop (fade-out) at the surface line near
 * the top; the amber/champagne palette (ref bubble body `rgb(200,180,140)`, rim
 * `rgb(220,190,150)`, warm-white highlight family); the faint undulating surface
 * line with its soft glow band; the very faint vertical light streams suggesting a
 * liquid column; and the corner vignette.
 *
 * ## Adaptation to our surface (the only departures from the reference)
 *
 *   - Reconstructed as a tiled field (above), because the ref is Canvas2D. Motion
 *     is a scrolling grid, not an integrated pool; visually identical, and a pure
 *     function of ticks so a replay looks the same twice.
 *   - The reference's mouse (hold-to-spawn, hover-push) is excised — no pointer on
 *     our uniform surface (rule 1). Bubbles spawn only from the fixed columns.
 *   - DROPPED, because each is a bright bullet-sized pinpoint (a fake bullet, the
 *     same call drift made for the moon core and expanse for the light core): the
 *     bubble's hard bright RIM stroke, its white SPECULAR dot (`rgb(255,252,240)`),
 *     and the surface POP-SPARKLE bursts (`rgb(255,250,235)` starbursts). A bubble
 *     is a single SOFT gaussian here; the sparkle energy folds into the surface
 *     glow band. The fizz identity survives as the soft amber discs themselves.
 *   - Six sparse columns replace the reference's 12 nucleation sites. Their broad
 *     membranes and deterministic existence gate preserve the upward field without
 *     turning the play band into a curtain of compact bright discs.
 *   - Clock: `t = uScroll * 0.023`; at the shipped scroll rate a blister crosses
 *     the field in roughly 290 ticks. `uScroll` advances only in `step()`.
 *   - Engine seal machinery (SEAL_GLSL, the stamp/ratchet/dither/vortex) is DROPPED
 *     entirely — this round retires it. No boss-station centre-calm is grafted on:
 *     the reference's own corner vignette plus the low exposure keep the bright
 *     sprite winning the upper-centre void, so a grafted radial dimming would only
 *     be a departure from the reference for no gain.
 *
 * ## Bullet-band grading (the critical adaptation)
 *
 * The reference's bubbles are 1-13px and mostly 1-3px — dead in the bullet band
 * (16-30px) and, at full amber, exactly a curtain of fake bullets. Two knobs grade
 * them out, on the two axes the band law cares about — SIZE for the bright end,
 * BRIGHTNESS for the small end:
 *
 *   - `SIG_MIN`/`SIG_MAX` (0.072-0.115 height-units, roughly 46-74px) keep every
 *     membrane broader than the bullet band.
 *   - `bri` still tracks size (`mix(0.4,1.0,sizeF)`), so the smaller surviving
 *     blisters never become the brightest marks.
 *   - `FIZZ_COLS` (6) and `FIZZ_ROWH` (0.24) set a sparse field; the existence
 *     gate, jitter and wobble prevent the large cells from reading as a grid.
 *   - Soft gaussians only — no hard rim, no specular, no sparkle points (dropped
 *     above). The peak stays amber, never approaching bullet-white.
 *
 * ## Exposure & readability
 *
 * `EXPOSURE 0.90` keeps the cold glass, membranes and upward movement readable at
 * production ×1. Rare overlaps are tamed by the soft clip. At the shipped scroll
 * rate the field rises about 2.1px/tick, with slow wobble and smooth birth/surface
 * envelopes rather than pop flashes.
 *
 * ## Clock
 *
 * `uScroll` only — no `performance.now`, no wall clock. A pure function of ticks,
 * so a replay looks identical twice (see `background.ts`, rule 1).
 * `backgrounds/index.test.ts` scans this file for wall-clock sources.
 *
 * champagne-fizz by pbakaus/radiant, MIT (a Canvas2D sketch). Its picture ported;
 * our GLSL reconstruction, tick clock, y-down field, grading and exposure.
 */

import { BACKGROUND_NOISE_GLSL, defineBackground } from '../../render/background';

defineBackground('sable', {
  scrollSpeed: 0.6,
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}

    const float FIZZ_TAU = 6.28318530718;

    /* v4 archive-glass palette: cold void, ghost membrane, faint heart-pink seal. */
    const vec3  FIZZ_BG   = vec3(0.009, 0.012, 0.020);
    const vec3  AMBER     = vec3(0.54, 0.66, 0.74);
    const vec3  CHAMPAGNE = vec3(0.46, 0.34, 0.40);

    /* Production x1: cold-glass membranes remain legible without diagnostic gain. */
    const float EXPOSURE  = 0.90;

    /* Field geometry / grading knobs — see header 'Bullet-band grading'. */
    const int   FIZZ_COLS = 6;        /* sparse archive blisters, ~80px apart */
    const float FIZZ_ROWH = 0.24;     /* broad vertical separation */
    const float FIZZ_RISE = 1.0;      /* rows risen per unit t (gentle; see clock note) */
    const float SIG_MIN   = 0.072;    /* smallest membrane is ~46px: above bullet scale */
    const float SIG_MAX   = 0.115;    /* broad archive blister, never a compact point */
    const float SURFACE_Y = 0.040;    /* liquid surface line (ref height*0.04), y-down near top */

    /* The rising bubble field: one soft gaussian per grid cell, the grid scrolling
       up so cells rise. Each cell is hashed to the ref's per-bubble properties. A
       3-row x 7-column neighbourhood is summed so a large soft bubble leaves no
       perceptible seam at a cell boundary — the ±3 column reach is set by the
       denser ref column count (12); at 7 columns ±2 sufficed. Round via aspect. */
    vec3 fizzBubbles(vec2 uv, float t, float aspect) {
      vec3 acc = vec3(0.0);
      float g   = uv.y / FIZZ_ROWH + t * FIZZ_RISE;   /* rising row coordinate */
      float xc  = uv.x * float(FIZZ_COLS);
      int   ir  = int(floor(g));
      int   icx = int(floor(xc));

      for (int dj = -1; dj <= 1; dj++) {
        for (int di = -3; di <= 3; di++) {
          float cx = float(icx + di);
          float cy = float(ir + dj);
          vec2  cell = vec2(cx, cy);

          /* per-bubble randoms (independent hash offsets) */
          float rExist = bgHash(cell + vec2(19.3, 4.1));
          float rSize  = bgHash(cell + vec2(0.13, 7.7));
          float rBri   = bgHash(cell + vec2(5.19, 1.3));
          float rXjit  = bgHash(cell + vec2(1.71, 9.9));
          float rYjit  = bgHash(cell + vec2(3.37, 2.2));
          float rHue   = bgHash(cell + vec2(11.7, 6.5));
          float rWfreq = bgHash(cell + vec2(9.11, 3.8));

          float exists = step(0.48, rExist);

          /* size distribution biased tiny (ref: mostly 1-3px), mapped to a soft
             sigma band; brightness tracks size so the band-frequency small end is
             dim and only the out-of-band large end is bright (see header). */
          float sizeF = rSize * rSize;
          float sig   = mix(SIG_MIN, SIG_MAX, sizeF);

          /* bubble current screen height (y-down): invert the rising transform */
          float yjit    = (rYjit - 0.5) * 0.7;
          float dyRows  = g - (cy + 0.5 + yjit);
          float dy      = dyRows * FIZZ_ROWH;
          float screenY = uv.y - dy;            /* bubble centre uv.y */

          /* grow slightly as it rises (ref pressure-drop expansion) */
          float heightFrac = clamp(1.0 - screenY, 0.0, 1.0);
          sig *= 1.0 + heightFrac * 0.15;

          /* sinuous wobble keyed to current height (ref sinusoidal wobble), a
             sub-column amplitude so a bubble stays within its neighbourhood */
          float wfreq = 5.0 + rWfreq * 6.0;
          float wamp  = 0.006 + rHue * 0.010;
          float wob   = sin(screenY * wfreq + rHue * FIZZ_TAU) * wamp;

          float xCenter = (cx + 0.5 + (rXjit - 0.5) * 0.7) / float(FIZZ_COLS) + wob;
          float dx = uv.x - xCenter;

          vec2  dp = vec2(dx * aspect, dy);     /* round on screen */
          float d2 = dot(dp, dp);
          float glow = exp(-d2 / (2.0 * sig * sig));   /* soft gaussian: no rim, no specular */

          /* opacity * size-tracked cap, faded in at birth, popped at the surface */
          float bri   = (0.45 + 0.55 * rBri) * mix(0.4, 1.0, sizeF);
          float envIn = 1.0 - smoothstep(0.90, 1.05, screenY);            /* fade in near bottom */
          float envUp = smoothstep(SURFACE_Y, SURFACE_Y + 0.05, screenY); /* pop at the surface */
          float env   = envIn * envUp * exists;

          /* faint per-bubble hue jitter (ref hueShift): warmer or a touch cooler */
          vec3 tint = AMBER + vec3((rHue - 0.5) * 0.06, 0.0, (rHue - 0.5) * 0.04);

          float edgeKeep = mix(0.34, 1.0, smoothstep(0.08, 0.34, abs(uv.x - 0.5)));
          float lowerCalm = 1.0 - 0.62 * smoothstep(0.60, 0.94, screenY);
          acc += tint * (glow * bri * env * edgeKeep * lowerCalm);
        }
      }

      /* gentle soft-clip so rare overlaps do not run away past the crest */
      acc /= (1.0 + max(max(acc.r, acc.g), acc.b) * 0.30);
      return acc;
    }

    /* Undulating liquid surface near the top (ref drawSurface): a soft glow band
       and a thin dim line — a full-width horizontal rule, never a compact point. */
    float fizzSurface(vec2 uv, float t) {
      float wave = sin(uv.x * 9.0  + t * 1.2) * 0.0016
                 + sin(uv.x * 22.0 + t * 0.8) * 0.0009
                 + sin(uv.x * 5.0  + t * 0.5) * 0.0022;
      float sy  = SURFACE_Y + wave;
      float dpx = (uv.y - sy) * 640.0;                 /* px from the surface */
      float band = exp(-dpx * dpx / 1800.0) * 0.24;
      return band;
    }

    /* Very faint vertical light columns (ref drawAmbientStreams): broad, dim, and
       brighter at the bottom — soft bands, nowhere near bullet frequency. */
    float fizzStreams(vec2 uv, float t) {
      float s = 0.0;
      for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float sx = mix(0.16, 0.84, fi / 2.0) + sin(t * 0.3 + fi * 2.1) * 0.028;
        float d  = (uv.x - sx) / 0.085;
        s += exp(-d * d);
      }
      return s * uv.y;   /* brighter at the bottom (y-down), fading up the column */
    }

    vec3 background(vec2 uv) {
      float aspect = uRes.x / uRes.y;
      float t = uScroll * 0.023;

      vec3 col = FIZZ_BG;
      col += fizzBubbles(uv, t, aspect) * EXPOSURE;
      col += AMBER     * fizzSurface(uv, t) * (EXPOSURE * 0.40);
      col += CHAMPAGNE * fizzStreams(uv, t) * (EXPOSURE * 0.05);

      /* ref corner vignette: darken toward the corners, the centre untouched. */
      vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
      float vig = 1.0 - smoothstep(0.22, 0.75, length(c)) * 0.45;
      col *= vig;

      float activityCalm = 1.0 - 0.26 * smoothstep(0.60, 0.93, uv.y);
      return col * activityCalm;
    }
  `,
});
