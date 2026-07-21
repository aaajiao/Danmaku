/**
 * `sable` — chancellor's fight (the stage-3 boss). A NEAR-IDENTICAL port of
 * pbakaus/radiant `champagne-fizz` (MIT): a near-black glass with a slow stream
 * of warm amber bubbles rising in columns from the bottom, wobbling as they
 * climb, growing a hair with the falling pressure, and popping out at a faint
 * undulating surface line near the top. sable is the DARKEST stated seal, and a
 * dark liquid field is the reference's native home — the two fit without forcing.
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
 *   - Column count MATCHES the reference (12 nucleation sites, `NUM_SITES`), so the
 *     rising streams are as dense as the ref's; a per-cell existence gate (~65%)
 *     keeps a little breathing room. The one departure that REMAINS is bubble SIZE —
 *     larger/softer than the ref's dense 1-13px pool — and it is genuinely forced by
 *     the bullet-band law: a dense field of fine BRIGHT bubbles is a fake curtain,
 *     so it cannot be closed without reintroducing that violation. The size/
 *     brightness grade below is the adaptation that satisfies both. See the grading
 *     section.
 *   - Clock: `t = uScroll * 0.02`, so bubbles cross the field in ~540 ticks (~9s),
 *     the reference's gentle champagne rise. `uScroll` advances only in `step()`.
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
 *   - `SIG_MIN`/`SIG_MAX` (0.032-0.052 height-units, ~20-33px) set the soft
 *     gaussian radius. The BRIGHT bubbles are the large ones: at `SIG_MAX` a bubble
 *     is a ~66px soft disc, sigma_f ~0.0048 cyc/px, under the 0.00625 bullet bound —
 *     out of band by construction.
 *   - `bri` tracks size (`mix(0.4,1.0,sizeF)`): the small end (whose sigma_f does
 *     reach into the band) is DIM — a 20px bubble crests ~0.03 raw, ~3% of a
 *     1.0-white bullet, so it carries band frequency without band CONTRAST. The
 *     rule is "no *bright* detail at bullet frequency"; the bright detail is the
 *     out-of-band large discs, the in-band-frequency detail is not bright.
 *   - `FIZZ_COLS` (12, the ref `NUM_SITES`) and `FIZZ_ROWH` (0.155, ~99px) set a
 *     ~40x99px lattice; the ~40px column pitch still sits above the 16-30px band,
 *     the existence gate thins the field, and the jitter/wobble break any grid read.
 *   - Soft gaussians only — no hard rim, no specular, no sparkle points (dropped
 *     above). The peak stays amber, never approaching bullet-white.
 *
 * ## Exposure & readability
 *
 * Darkest stated seal — the relative floor the 出神 pair (umbra/decree) stays
 * under. `EXPOSURE 0.20`: a single bright bubble crests ~0.13-0.15 raw
 * [MEASURED-IN-ACCEPTANCE], the near-black glass between them ~0.016, the surface
 * line ~0.06 and the vertical streams ~0.008 — dark by role, but the picture still
 * READS (the old invisible-at-0.1 failure is the retired law, not a target). Rare
 * bubble overlaps run a touch hotter; a gentle soft-clip tames them. Motion:
 * bubbles rise ~1.2px/tick with slow wobble and smooth fade-in/pop envelopes —
 * per-tick luminance step well under the strobe bound [MEASURED-IN-ACCEPTANCE].
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

import { BACKGROUND_NOISE_GLSL, defineBackground } from '../background';

defineBackground('sable', {
  scrollSpeed: 0.6,
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}

    const float FIZZ_TAU = 6.28318530718;

    /* Champagne-fizz amber (ref bubble body/rim/highlight family). AMBER is the
       bright core tint — warm gold, deliberately NOT white (the white specular is
       dropped). CHAMPAGNE is the ref label accent, for the streams and surface. */
    const vec3  FIZZ_BG   = vec3(0.016, 0.012, 0.009);   /* warm near-black, ref #0a0a0a graded down */
    const vec3  AMBER     = vec3(1.00, 0.80, 0.52);
    const vec3  CHAMPAGNE = vec3(0.78, 0.58, 0.42);

    /* Darkest stated seal. Bubble crest ~0.13-0.15 raw [MEASURED-IN-ACCEPTANCE]. */
    const float EXPOSURE  = 0.20;

    /* Field geometry / grading knobs — see header 'Bullet-band grading'. */
    const int   FIZZ_COLS = 12;       /* nucleation columns (ref NUM_SITES=12, ~40px apart) */
    const float FIZZ_ROWH = 0.155;    /* vertical bubble spacing, frac of height (~99px >> bullet) */
    const float FIZZ_RISE = 1.0;      /* rows risen per unit t (gentle; see clock note) */
    const float SIG_MIN   = 0.032;    /* smallest bubble sigma, height-units (~20px), SOFT + dim */
    const float SIG_MAX   = 0.052;    /* largest bubble sigma (~33px) — the BRIGHT, out-of-band end */
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

          float exists = step(0.35, rExist);   /* ~65% populated — sparser than the ref pool */

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
          float wamp  = 0.010 + rHue * 0.018;
          float wob   = sin(screenY * wfreq + rHue * FIZZ_TAU) * wamp;

          float xCenter = (cx + 0.5 + (rXjit - 0.5) * 0.7) / float(FIZZ_COLS) + wob;
          float dx = uv.x - xCenter;

          vec2  dp = vec2(dx * aspect, dy);     /* round on screen */
          float d2 = dot(dp, dp);
          float glow = exp(-d2 / (2.0 * sig * sig));   /* soft gaussian: no rim, no specular */

          /* opacity * size-tracked cap, faded in at birth, popped at the surface */
          float bri   = (0.45 + 0.55 * rBri) * mix(0.4, 1.0, sizeF);
          float envIn = smoothstep(1.05, 0.90, screenY);                  /* fade in near bottom */
          float envUp = smoothstep(SURFACE_Y, SURFACE_Y + 0.05, screenY); /* pop at the surface */
          float env   = envIn * envUp * exists;

          /* faint per-bubble hue jitter (ref hueShift): warmer or a touch cooler */
          vec3 tint = AMBER + vec3((rHue - 0.5) * 0.16, 0.0, -(rHue - 0.5) * 0.10);

          acc += tint * (glow * bri * env);
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
      float line = exp(-dpx * dpx / 6.0)   * 0.55;     /* thin dim line */
      float band = exp(-dpx * dpx / 900.0) * 0.28;     /* soft glow band (holds the popped-sparkle energy) */
      return line + band;
    }

    /* Very faint vertical light columns (ref drawAmbientStreams): broad, dim, and
       brighter at the bottom — soft bands, nowhere near bullet frequency. */
    float fizzStreams(vec2 uv, float t) {
      float s = 0.0;
      for (int i = 0; i < 5; i++) {
        float fi = float(i);
        float sx = mix(0.15, 0.85, fi / 4.0) + sin(t * 0.3 + fi * 2.1) * 0.035;
        float d  = (uv.x - sx) / 0.05;
        s += exp(-d * d);
      }
      return s * uv.y;   /* brighter at the bottom (y-down), fading up the column */
    }

    vec3 background(vec2 uv) {
      float aspect = uRes.x / uRes.y;
      float t = uScroll * 0.02;   /* bubbles cross the field in ~540 ticks (~9s) */

      vec3 col = FIZZ_BG;
      col += fizzBubbles(uv, t, aspect) * EXPOSURE;
      col += AMBER     * fizzSurface(uv, t) * (EXPOSURE * 0.40);
      col += CHAMPAGNE * fizzStreams(uv, t) * (EXPOSURE * 0.05);

      /* ref corner vignette: darken toward the corners, the centre untouched. */
      vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
      float vig = 1.0 - smoothstep(0.22, 0.75, length(c)) * 0.45;
      col *= vig;

      return col;
    }
  `,
});
