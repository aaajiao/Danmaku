/**
 * `cordon` — warden's fight (the stage-2 midboss). A NEAR-IDENTICAL port of
 * pbakaus/radiant `hologram-glitch` (MIT).
 *
 * ## This REPLACES the liquid-gold variant
 *
 * `cordon` used to import `signet`'s ported `liquid-gold` basis (`GOLD_GLSL`) and
 * grade it cooler — one of three gold seals cut from a shared picture. Under the
 * no-repeat law ("不要重复": one reference, one scene) that shared basis is gone
 * from here: the `./signet` import is removed and `cordon` is now its OWN scene,
 * a standalone port of a different reference. `signet` still owns `GOLD_GLSL` for
 * `regnum`; this file no longer touches it.
 *
 * ## The reference's defining image
 *
 * An abstract holographic projection: morphing organic cyan/magenta blobs built
 * from layered rotated FBM noise, split into red/green/blue channels by a pulsing
 * chromatic aberration, overlaid with CRT scanlines (a fine pitch, three scrolling
 * per-channel medium bands, a slow broad sweep, and one bright line sweeping up),
 * a static interlace dropout, occasional horizontal glitch-band displacement and
 * noise-burst rectangles, an edge glow where the holographic volume meets the
 * dark, a position-dependent shimmer, and a deep blue-black vignette. ACES-ish
 * S-curve tone map with film grain. A hologram catching the light, glitching.
 *
 * ## What was adapted (each departure from the near-identical bar, justified)
 *
 *   - Uniforms & mouse: the reference's `u_glitchIntensity`/`u_scanSpeed` (both
 *     shipped at 1.0) are baked to `HOLO_COHERE`/`HOLO_SCAN`. `u_mouse` — a glitch
 *     epicentre that amplified bands and chromatic aberration under the cursor — is
 *     EXCISED (our uniform surface has no pointer; rule 1 forbids anything but a
 *     tick clock). Every `(1.0 + mouseInfluence * k)` factor collapses to 1.0.
 *   - Clock: `t = uScroll * HOLO_CLOCK`. At scrollSpeed 0.6 that advances `t` at
 *     ~0.5/s — HALF the reference's `u_time` rate, a boss-station calm applied at
 *     the clock so every motion (blob morph, hue cycle, scanline scroll, glitch
 *     rhythm) slows together. `uScroll` advances only in `step()`.
 *   - y-down uv -> the reference's y-up device coords: `fragCoord = vec2(uv.x,
 *     1-uv.y) * uRes`, and `centeredUV` / `rUv` rebuilt from it, so the ported
 *     body runs verbatim in the reference's orientation, flipped once at input.
 *   - GLITCH COHERENCE (no-strobe): the reference glitches on hard temporal
 *     quantization — `floor(t*8..30)` reseeds, `step()` band gates, a `sign()`
 *     direction flip, a `step(0.92,hash(floor(t*5)))` chromatic JUMP, a 30Hz
 *     interlace flicker and a 20Hz random line-flicker, a per-slot noise-burst
 *     pop. Every one of those is a per-tick luminance/displacement discontinuity —
 *     a strobe. They are tamed (see HOLO_COHERE below): floors -> continuous drift,
 *     `step` -> `smoothstep`, `sign` -> a smooth signed ramp, the chromatic jump
 *     and both flickers' TIME terms dropped (the line dropout survives as a static
 *     texture), and the burst faded in/out within its slot so its position snap is
 *     invisible. The still image is the reference; only its temporal snaps are made
 *     coherent.
 *   - Boss-station calm: a gentle radial dim (`HOLO_CALM`) centred on the station
 *     (~0.5, 0.42), a `<=1` multiply — MODULATION ONLY, it can only darken that
 *     region so the boss and its bullets keep the void, never an added highlight.
 *     Same device as the retired gold variant carried, now applied to this picture.
 *   - EXPOSURE 0.30 is a final gain on the tone-mapped picture for the seal tier.
 *
 * ## Exposure & readability
 *
 * Seal tier (a boss station), calmer than the stages. Structured holographic peaks
 * land ~0.22-0.27 raw [MEASURED-IN-ACCEPTANCE] — well under a bullet's 1.0-white +
 * bloom, and the near-white blob cores are blob-scale (coarse), never bullet-sized.
 * The deep vignette leaves the corners at a playable ~0.02.
 *
 * ## Bullet-band & strobe knobs (both named)
 *
 *   1. HOLO_COHERE — the tamed glitch strength AND coherence gain (the reference's
 *      `u_glitchIntensity`, held to 0.4). It scales the band displacement, the
 *      chromatic spike and the noise burst; together with the floors->continuous /
 *      step->smoothstep / flicker-time-dropped structure above, per-tick luminance
 *      and displacement steps stay bounded — coherent motion, no strobing.
 *   2. HOLO_SCANPITCH — the fine scanline pitch in pixels (2.5px), set OUTSIDE the
 *      bullet band (16-30px) on the fine side (<16px) and, as a darkening
 *      modulation, unable to counterfeit a bright bullet even if it aliases. The
 *      medium scanlines sit at ~42px and the broad sweep at ~209px — both supra-
 *      band — so no scanline structure ever lands in 16-30px. The chromatic fringe
 *      (~4px) and grain (1px) are sub-band; the FBM blobs and every bright additive
 *      term (alignment cores, bright sweep, edge glow) are blob-scale and coarse.
 *
 * No strobe: the fastest smooth term (per-channel medium scanline scroll) steps
 * <0.1 rad/tick; the fine scanline and interlace/line dropout are static; the burst
 * fades through zero at every position change [MEASURED-IN-ACCEPTANCE].
 *
 * ## Clock
 *
 * `uScroll` only, which advances in `step()` and nowhere else — no
 * `performance.now`, so a replay looks identical twice (`background.ts`, rule 1).
 * `backgrounds/index.test.ts` scans this file for wall-clock sources.
 *
 * hologram-glitch by pbakaus/radiant, MIT. Ported near-identically; our clock,
 * y-down projection, exposure, the glitch-coherence taming and the station calm
 * are the only departures.
 */

import { defineBackground } from '../../render/background';

defineBackground('cordon', {
  scrollSpeed: 0.6,
  fragment: /* glsl */ `
    const float HOLO_PI    = 3.14159265359;
    const float EXPOSURE    = 0.30;    /* seal tier; peaks ~0.22-0.27 raw */
    const float HOLO_CLOCK  = 0.014;   /* uScroll -> t: ~0.5/s at scrollSpeed 0.6 (half ref) */
    const float HOLO_COHERE = 0.4;     /* KNOB 1: tamed glitch strength + coherence gain (ref 1.0) */
    const float HOLO_SCANPITCH = 2.5;  /* KNOB 2: fine scanline pitch in px, sub-bullet-band (<16px) */
    const float HOLO_SCAN   = 1.0;     /* baked u_scanSpeed */
    const float HOLO_CALM   = 0.35;    /* boss-station radial dim (modulation only, <=1) */

    float holoHash(float n) {
      return fract(sin(n) * 43758.5453123);
    }

    float holoHash2(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    float holoVnoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(holoHash2(i), holoHash2(i + vec2(1.0, 0.0)), f.x),
        mix(holoHash2(i + vec2(0.0, 1.0)), holoHash2(i + vec2(1.0, 1.0)), f.x),
        f.y
      );
    }

    /* FBM, four octaves, each rotated (the reference's morphing organic detail). */
    float holoFbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      vec2 shift = vec2(100.0);
      mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
      for (int i = 0; i < 4; i++) {
        v += a * holoVnoise(p);
        p = rot * p * 2.0 + shift;
        a *= 0.5;
      }
      return v;
    }

    /* Rhythmic glitch envelope. The reference's hard fast spike
       (step(0.88, hash(floor(t*12)))) is DROPPED — a 12Hz 0->0.7 jump is a
       strobe; the slow/medium sinusoidal bursts are kept and stay smooth. */
    float holoEnvelope(float t) {
      float slow = sin(t * 0.7) * sin(t * 1.1);
      float med  = sin(t * 3.3) * 0.5 + 0.5;
      float envelope = smoothstep(0.15, 0.5, slow) * (0.5 + 0.5 * med);
      return clamp(envelope, 0.0, 1.0);
    }

    /* Horizontal glitch-band displacement. COHERENCE: the reference's
       floor(t*8..6) reseeds become continuous drift at the same inner rates, the
       step() band gates become smoothstep (amplitude ramps, never snaps), and the
       sign() direction flip becomes a smooth signed ramp. */
    float holoBand(float y, float t) {
      float env = holoEnvelope(t);
      if (env < 0.1) return 0.0;
      float band1 = smoothstep(0.78, 0.82, holoVnoise(vec2(y * 15.0, t * 8.0)))  * 0.14;
      float band2 = smoothstep(0.83, 0.87, holoVnoise(vec2(y * 40.0, t * 15.0))) * 0.07;
      float band3 = smoothstep(0.80, 0.84, holoVnoise(vec2(y * 5.0,  t * 4.0)))  * 0.25;
      float dir   = clamp((holoVnoise(vec2(y * 20.0, t * 6.0)) - 0.5) * 4.0, -1.0, 1.0);
      return (band1 + band2 + band3) * dir * env;
    }

    /* Noise-burst rectangle. COHERENCE: the slot rate is slowed (t*6 -> t*3) and,
       crucially, the block fades in and out within its slot (sin over fract), so
       its position SNAP at each slot boundary happens while it is invisible — no
       per-tick pop. The internal ~1.5px noise is sub-band. */
    float holoBurst(vec2 uv, float t) {
      float env = holoEnvelope(t + 1.5);
      if (env < 0.3) return 0.0;
      float blockT = t * 3.0;
      float bi = floor(blockT);
      float blockFade = sin(fract(blockT) * HOLO_PI);
      float bx = holoHash(bi * 7.3)  * 0.8 - 0.4;
      float by = holoHash(bi * 11.7) * 0.8 - 0.4;
      float bw = holoHash(bi * 3.1)  * 0.3 + 0.05;
      float bh = holoHash(bi * 5.9)  * 0.1 + 0.02;
      float inBlock = step(bx, uv.x) * step(uv.x, bx + bw) *
                      step(by, uv.y) * step(uv.y, by + bh);
      float n = holoHash2(floor(uv * 300.0) + bi * 100.0);
      return inBlock * n * env * blockFade;
    }

    vec3 background(vec2 uv) {
      float aspect = uRes.x / uRes.y;

      /* y-down 0..1 uv -> the reference's y-up device coords and centred coords. */
      vec2 fragCoord   = vec2(uv.x, 1.0 - uv.y) * uRes;
      vec2 rUv         = fragCoord / uRes;                       /* == vec2(uv.x, 1-uv.y) */
      vec2 centeredUV  = (fragCoord - uRes * 0.5) / uRes.y;
      float t          = uScroll * HOLO_CLOCK;

      /* Horizontal glitch-band displacement (tamed, coherent). */
      float bandOffset = holoBand(rUv.y, t) * HOLO_COHERE;
      vec2 glitchedUV  = rUv;
      glitchedUV.x    += bandOffset;

      /* Chromatic aberration: a smooth pulsing base plus a tamed envelope spike.
         The reference's hard chromatic JUMP (step(0.92,hash(floor(t*5)))) is
         dropped as a strobe. */
      float chromBase   = 0.008 + 0.006 * sin(t * 1.2);
      float chromSpike  = holoEnvelope(t) * 0.035 * HOLO_COHERE;
      float chromAmount = chromBase + chromSpike;

      vec2 uvR = glitchedUV + vec2(-chromAmount, 0.0);
      vec2 uvG = glitchedUV;
      vec2 uvB = glitchedUV + vec2(chromAmount, 0.0);
      uvR.y += chromAmount * 0.5;
      uvB.y -= chromAmount * 0.5;

      /* Base flowing holographic blobs, sampled per channel (morphing organic
         FBM). Blob-scale, coarse — the *10 octave is the only bullet-band term and
         it only perturbs blob edges at low amplitude, never a bright dot. */
      float slowT = t * 0.15;

      float patR = holoFbm(uvR * 3.0 + vec2(slowT, slowT * 0.7));
      patR += holoFbm(uvR * 5.0 - vec2(slowT * 0.5, slowT * 1.2)) * 0.5;
      patR += holoFbm(uvR * 1.5 + vec2(slowT * 0.3, -slowT * 0.4)) * 0.7;
      patR += holoFbm(uvR * 10.0 + vec2(slowT * 1.5, -slowT * 0.8)) * 0.15;

      float patG = holoFbm(uvG * 3.0 + vec2(slowT, slowT * 0.7));
      patG += holoFbm(uvG * 5.0 - vec2(slowT * 0.5, slowT * 1.2)) * 0.5;
      patG += holoFbm(uvG * 1.5 + vec2(slowT * 0.3, -slowT * 0.4)) * 0.7;
      patG += holoFbm(uvG * 10.0 + vec2(slowT * 1.5, -slowT * 0.8)) * 0.15;

      float patB = holoFbm(uvB * 3.0 + vec2(slowT, slowT * 0.7));
      patB += holoFbm(uvB * 5.0 - vec2(slowT * 0.5, slowT * 1.2)) * 0.5;
      patB += holoFbm(uvB * 1.5 + vec2(slowT * 0.3, -slowT * 0.4)) * 0.7;
      patB += holoFbm(uvB * 10.0 + vec2(slowT * 1.5, -slowT * 0.8)) * 0.15;

      patR /= 2.45;
      patG /= 2.45;
      patB /= 2.45;

      patR = smoothstep(0.35, 0.55, patR);
      patG = smoothstep(0.35, 0.55, patG);
      patB = smoothstep(0.35, 0.55, patB);

      patR = patR * patR * (3.0 - 2.0 * patR);
      patG = patG * patG * (3.0 - 2.0 * patG);
      patB = patB * patB * (3.0 - 2.0 * patB);

      /* Holographic hue cycle (cyan -> magenta -> yellow -> white). */
      float hueShift = t * 0.2;
      float hue1 = sin(hueShift) * 0.5 + 0.5;
      float hue2 = sin(hueShift + 2.094) * 0.5 + 0.5;
      float hue3 = sin(hueShift + 4.189) * 0.5 + 0.5;
      float spatialHue = sin(centeredUV.x * 4.0 + centeredUV.y * 3.0 + t * 0.3) * 0.5 + 0.5;

      vec3 col1 = vec3(0.0, 1.0, 1.2);   /* electric cyan */
      vec3 col2 = vec3(1.2, 0.1, 0.9);   /* hot magenta */
      vec3 col3 = vec3(1.2, 1.25, 1.3);  /* bright white */
      vec3 col4 = vec3(1.0, 0.95, 0.2);  /* yellow */

      vec3 palette = mix(col1, col2, hue1 * spatialHue);
      palette = mix(palette, col3, hue2 * 0.3);
      palette = mix(palette, col4, hue3 * spatialHue * 0.4);

      vec3 baseColor;
      baseColor.r = patR * palette.r;
      baseColor.g = patG * palette.g;
      baseColor.b = patB * palette.b;

      /* Near-white cores where all channels align — blob-scale, coarse. */
      float alignment = patR * patG * patB;
      baseColor += vec3(0.9, 0.95, 1.0) * pow(alignment, 1.5) * 1.2;

      /* Scanline overlay. */
      float scanY = fragCoord.y;

      /* Fine scanlines — KNOB 2: pitch outside the bullet band, and a darkening
         (never a bright add), so it cannot counterfeit a bullet. */
      float fineScan = sin(scanY * (2.0 * HOLO_PI / HOLO_SCANPITCH)) * 0.5 + 0.5;
      fineScan = pow(fineScan, 1.5);

      /* Medium scanlines — ~42px pitch (supra-band), scrolling per channel. */
      float medScanR = sin((scanY + t * 60.0 * HOLO_SCAN) * 0.15) * 0.5 + 0.5;
      float medScanG = sin((scanY + t * 75.0 * HOLO_SCAN) * 0.15) * 0.5 + 0.5;
      float medScanB = sin((scanY + t * 55.0 * HOLO_SCAN) * 0.15) * 0.5 + 0.5;

      /* Broad sweep — ~209px pitch. */
      float broadScan = sin((scanY + t * 30.0 * HOLO_SCAN) * 0.03) * 0.5 + 0.5;
      broadScan = smoothstep(0.3, 0.7, broadScan);

      float scanR = mix(0.45, 1.0, fineScan) * mix(0.7, 1.0, medScanR) * mix(0.6, 1.0, broadScan);
      float scanG = mix(0.45, 1.0, fineScan) * mix(0.7, 1.0, medScanG) * mix(0.6, 1.0, broadScan);
      float scanB = mix(0.45, 1.0, fineScan) * mix(0.7, 1.0, medScanB) * mix(0.6, 1.0, broadScan);

      /* One bright line sweeping up (slow, smooth). */
      float brightScanPos = mod(t * 40.0 * HOLO_SCAN, uRes.y);
      float brightScan = exp(-abs(scanY - brightScanPos) * 0.12) * 0.7;

      baseColor.r *= scanR;
      baseColor.g *= scanG;
      baseColor.b *= scanB;
      baseColor += vec3(0.3, 0.8, 1.0) * brightScan;

      /* Interlace + line dropout, COHERENCE: both TIME terms dropped. The reference
         flickered these at 30Hz / 20Hz — pure strobe. Here the interlace is a
         static 1px darkening and the dropout lines are fixed (some lines simply
         permanently dimmer), so the CRT texture survives as a still. */
      float interlace = mod(scanY, 2.0);
      float interlaceFlicker = mix(0.78, 1.0, interlace);
      float lineFlicker = 1.0 - step(0.95, holoHash(floor(scanY * 0.5))) * 0.5;
      baseColor *= interlaceFlicker * lineFlicker;

      /* Noise burst (tamed, faded through zero at position changes). */
      float burst = holoBurst(centeredUV, t);
      baseColor += vec3(0.5, 0.9, 1.0) * burst * HOLO_COHERE;

      /* Edge glow where the holographic volume meets the dark (blob-scale). */
      float patCenter = holoFbm(glitchedUV * 3.0 + vec2(slowT, slowT * 0.7));
      float patDx = holoFbm((glitchedUV + vec2(0.005, 0.0)) * 3.0 + vec2(slowT, slowT * 0.7));
      float patDy = holoFbm((glitchedUV + vec2(0.0, 0.005)) * 3.0 + vec2(slowT, slowT * 0.7));
      float edgeStrength = length(vec2(patDx - patCenter, patDy - patCenter)) * 20.0;
      edgeStrength = smoothstep(0.2, 0.8, edgeStrength);
      vec3 edgeColor = mix(vec3(0.2, 0.9, 1.2), vec3(1.2, 0.3, 1.0), spatialHue) * edgeStrength * 0.6;
      baseColor += edgeColor;

      /* Position-dependent shimmer (coarse, >180px). */
      float shimmer = sin(centeredUV.x * 20.0 + centeredUV.y * 15.0 + t * 2.0) * 0.15 + 0.85;
      shimmer *= sin(centeredUV.x * 8.0 - centeredUV.y * 12.0 + t * 1.3) * 0.1 + 0.9;
      baseColor *= shimmer;

      /* Moments of clarity (smooth). */
      float clarity = sin(t * 0.4) * 0.15 + 0.85;
      baseColor *= clarity;

      /* Vignette — corners to deep blue-black (the playable floor). */
      float vDist = length(centeredUV * vec2(1.0, 0.85));
      float vignette = 1.0 - smoothstep(0.45, 1.1, vDist);
      vec3 vignetteColor = vec3(0.02, 0.03, 0.06);
      baseColor = mix(vignetteColor, baseColor, vignette);

      /* Film grain — 1px (sub-band), reseed slowed and amplitude trimmed. */
      float grain = (holoHash2(fragCoord + fract(t * 12.0) * 1000.0) - 0.5) * 0.045;
      baseColor += grain;

      /* Tone map — S-curve with contrast (the reference's). */
      baseColor = baseColor / (baseColor + vec3(0.65));
      baseColor = pow(max(baseColor, vec3(0.0)), vec3(0.95));   /* base clamped >=0 -> pow safe */

      /* Boss-station radial calm: modulation only, <=1, dims the station where the
         boss and its bullets read; never adds light. */
      vec2 st = (uv - vec2(0.5, 0.42)) * vec2(aspect, 1.0);
      baseColor *= 1.0 - HOLO_CALM * exp(-dot(st, st) * 10.0);

      return baseColor * EXPOSURE;
    }
  `,
});
