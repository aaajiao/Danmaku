/**
 * `signal-decay` — the run's end: game-over, and the ending/results screens.
 * A NEAR-IDENTICAL port of pbakaus/radiant `signal-decay` (MIT): clean warm
 * harmonics at the top of the frame dissolving, band by band, into warm noise at
 * the bottom — six FM/AM harmonics per track, ten stacked tracks, each carried
 * through a progressive degradation chain (soft-clip -> hard-clip -> bit-crush ->
 * noise injection) whose onset rises with depth, plus per-scanline glitch, a
 * chromatic warm-split in the chaos zone, and a noise floor of ghost echoes.
 *
 * ## What was ported
 *
 * The reference fragment verbatim in structure: `sdHash`/`sdVNoise`/`sdFbm`, the
 * three degradation stages, `sdDegradedWave` (phase distortion + FM carrier + AM
 * beating + the smoothstep-gated clip/crush/noise chain), `sdCompositeWave`'s six
 * harmonics on the golden-ratio ladder (1.0, 1.618, 2.414, 3.302, 4.236, 5.879),
 * the `sdGlowLine` SDF, `sdGlitch`, the ten-track accumulation with its dash
 * fragmentation and warm chromatic aberration, the bottom-25% noise floor with
 * three ghost lines, the warm ambient glow, the warmer-at-bottom background
 * gradient, the vignette, and the gentle smoothstep tone map. The amber ->
 * orange -> near-white-gold -> sepia palette is the reference's own, unchanged.
 *
 * ## Adaptation to our surface (the only departures from the reference)
 *
 *   - Uniforms: `u_signalSpeed`/`u_decayIntensity` are baked to their defaults
 *     (`SD_SIGNAL_SPEED = 0.5`, `SD_DECAY = 1.0`); `u_mouse` (which slid the decay
 *     boundary under the cursor) is excised — our uniform surface has no pointer
 *     and rule 1 forbids anything but a tick clock, so `decayShift = 0` and the
 *     decay boundary is fixed to the reference's default (clean top, noisy floor).
 *   - Clock: `t = uScroll * 0.014`, so at 60 ticks/s the phase/glitch/grain clock
 *     advances at ~0.84 of the reference's `u_time` (seconds), a touch under it
 *     for calmer end-screen reading. `uScroll` advances only in `step()`; there is
 *     no `performance.now`. `backgrounds/index.test.ts` scans this file for it.
 *   - y-down uv -> the reference's y-up screen space via `ruv = (uv.x, 1 - uv.y)`
 *     and `frag = ruv * uRes` (its `gl_FragCoord.xy`), so the clean harmonics sit
 *     at the TOP of the frame (where a menu/results title is drawn) and the noise
 *     floor fills the bottom — the reference's own orientation, reconstructed.
 *   - EXPOSURE 0.34 (terminal tier, menu-adjacent — there are no bullets to
 *     protect on a game-over/ending screen), applied after the reference's tone
 *     map so the hot gold line cores land in the acceptable band rather than at
 *     the reference's near-1.0.
 *
 * ## Exposure & readability
 *
 * Terminal/menu-adjacent tier. Hot line-core peaks land ~0.30-0.36 raw
 * [MEASURED-IN-ACCEPTANCE] at EXPOSURE 0.34; the mean is far darker (a black
 * field crossed by thin lit lines). This scene composites NO bullets — it is only
 * ever up over game-over/ending text — so the contrast fight is with the overlaid
 * end-screen glyphs, not a curtain.
 *
 * ## The bullet-band / strobe knob
 *
 * `SD_GRAIN` — the reference's per-pixel film grain — is the one graded knob:
 * dropped from 0.022 to 0.006. Full-strength per-pixel grain is the only term
 * here at a fine (single-pixel) spatial frequency AND the only one that resamples
 * every tick, so it is both the readability risk under end-screen text and the
 * strobe risk; grading it down keeps the per-tick luminance step bounded and lets
 * the text read calmly. Everything else that moves is coarse and coherent: the
 * waveform lines are line features spanning many pixels, the glitch and dash
 * reshuffles are time-quantized steps (they advance in coarse `floor(t*k)`
 * increments, not per pixel), and the noise floor lives in the bottom quarter,
 * below where a menu/results title sits. There is no play band to defend, so no
 * structure is tuned against a bullet's 16-30px frequency beyond this.
 *
 * ## Clock
 *
 * `uScroll` only — no `performance.now`, no wall clock (see `background.ts`,
 * rule 1). Every animated term — harmonic phase, FM/AM, the degradation seeds,
 * glitch, dash, noise floor and grain — is `sin`/`cos`/`fract` of `t = uScroll *
 * k`, so a replay looks identical twice. `backgrounds/index.test.ts` scans this
 * file for wall-clock sources.
 *
 * signal-decay by pbakaus/radiant, MIT. Ported; our clock, y-down projection,
 * baked signal/decay constants, excised pointer, graded grain, and exposure.
 */

import { defineBackground } from '../background';

defineBackground('signal-decay', {
  scrollSpeed: 1.0,
  fragment: /* glsl */ `
    #define SD_TAU 6.28318530
    #define SD_NUM_TRACKS 10

    const float EXPOSURE          = 0.34;   /* terminal tier — no bullets to protect */
    const float SD_SIGNAL_SPEED   = 0.5;    /* u_signalSpeed default, baked */
    const float SD_DECAY          = 1.0;    /* u_decayIntensity default, baked */
    const float SD_GRAIN          = 0.006;  /* graded down from 0.022 — the strobe/text knob */

    /* ── Hash ── */
    float sdHash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    /* ── Value noise ── */
    float sdVNoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = sdHash(i);
      float b = sdHash(i + vec2(1.0, 0.0));
      float c = sdHash(i + vec2(0.0, 1.0));
      float d = sdHash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    /* ── FBM ── */
    float sdFbm(vec2 p) {
      float f = 0.0, a = 0.5;
      for (int i = 0; i < 5; i++) {
        f += a * sdVNoise(p);
        p *= 2.07;
        a *= 0.5;
      }
      return f;
    }

    /* ── Soft clip (rational tanh approximation) ── */
    float sdSoftClip(float x, float amt) {
      float k = mix(1.0, 5.0, amt);
      float kx = k * x;
      float ax = abs(kx);
      return (kx / (1.0 + ax + 0.28 * kx * kx));
    }

    /* ── Hard clip ── */
    float sdHardClip(float x, float amt) {
      float th = mix(1.0, 0.2, amt);
      return clamp(x, -th, th) / max(th, 0.001);
    }

    /* ── Bit crush (quantize) ── */
    float sdBitCrush(float x, float amt) {
      float levels = mix(128.0, 3.0, amt * amt);
      return floor(x * levels + 0.5) / levels;
    }

    /* ── One degraded harmonic. decay: 0=clean, 1=destroyed. ── */
    float sdDegradedWave(float x, float t, float freq, float ph, float amp, float decay) {
      float speed = SD_SIGNAL_SPEED;
      float phase = x * freq * SD_TAU + ph + t * speed * (1.5 + freq * 0.2);

      /* Phase distortion (increases with decay) */
      float pd = decay * decay * 2.0;
      phase += pd * sin(phase * 1.7 + t * 0.3) + pd * 0.4 * sin(phase * 3.1);

      /* FM synthesis — modulator riding on carrier */
      float fm = decay * 1.2;
      float w = sin(phase + fm * sin(phase * 2.13 + t * 0.5));

      /* AM — beating patterns */
      float am = 1.0 - decay * 0.35 * (0.5 + 0.5 * sin(x * 2.5 + t * speed * 1.3 + ph));
      w *= am;

      /* Progressive degradation chain */
      float sc = smoothstep(0.08, 0.35, decay);
      w = mix(w, sdSoftClip(w, sc), sc);

      float hc = smoothstep(0.25, 0.55, decay);
      w = mix(w, sdHardClip(w, hc), hc);

      float bc = smoothstep(0.45, 0.8, decay);
      w = mix(w, sdBitCrush(w, bc), bc);

      float ni = smoothstep(0.35, 0.9, decay);
      float noise = (sdHash(vec2(x * 50.0 + ph, t * 7.0 + freq)) - 0.5) * 2.0;
      w = mix(w, w + noise * 0.4, ni);

      return w * amp;
    }

    /* ── Full composite: 6 harmonics on the golden-ratio ladder ── */
    float sdCompositeWave(float x, float t, float decay) {
      float w = 0.0;
      w += sdDegradedWave(x, t, 1.0,   0.0,   0.32, decay);
      w += sdDegradedWave(x, t, 1.618, 1.047, 0.26, decay);
      w += sdDegradedWave(x, t, 2.414, 2.094, 0.20, decay);
      w += sdDegradedWave(x, t, 3.302, 3.665, 0.16, decay);
      w += sdDegradedWave(x, t, 4.236, 0.524, 0.12, decay);
      w += sdDegradedWave(x, t, 5.879, 4.189, 0.09, decay);
      return w;
    }

    /* ── Glowing line SDF ── */
    float sdGlowLine(float d, float w, float g) {
      float core = smoothstep(w, 0.0, abs(d));
      float bloom = exp(-abs(d) / max(g, 0.0001)) * 0.45;
      return core + bloom;
    }

    /* ── Glitch horizontal offset (chaos zone only) ── */
    float sdGlitch(float y, float t, float decay) {
      float amt = smoothstep(0.3, 0.7, decay);
      float g1 = step(0.96, sdHash(vec2(floor(y * 60.0), floor(t * 4.0))));
      float g2 = step(0.93, sdHash(vec2(floor(y * 30.0), floor(t * 6.0 + 77.0))));
      float offset = g1 * (sdHash(vec2(y * 11.0, t * 3.0)) - 0.5) * 0.1;
      offset += g2 * (sdHash(vec2(y * 23.0, t * 5.0 + 50.0)) - 0.5) * 0.05;
      return offset * amt;
    }

    vec3 background(vec2 uv) {
      float ar = uRes.x / uRes.y;
      float t = uScroll * 0.014;   /* ~0.84x the reference's 1.0 s/s, ticks only */

      /* Reconstruct the reference's y-up screen space from our y-down uv, so the
         clean harmonics sit at the TOP of the frame and the noise floor fills the
         bottom — the reference's own orientation. */
      vec2 ruv = vec2(uv.x, 1.0 - uv.y);
      vec2 frag = ruv * uRes;               /* the reference's gl_FragCoord.xy */

      /* yNorm: 0 at top of screen, 1 at bottom. The pointer that slid this in the
         reference is excised, so the boundary is fixed (rule 1/4). */
      float yNorm = 1.0 - ruv.y;
      float decayShift = 0.0;
      float decay = clamp(pow(max(yNorm + decayShift, 0.0), 0.75) * SD_DECAY, 0.0, 1.0);

      /* Glitch offset for this scanline */
      float gOff = sdGlitch(yNorm, t, decay);

      /* ── Accumulate waveform lines ── */
      vec3 col = vec3(0.0);

      /* Color palette */
      vec3 colClean    = vec3(0.78, 0.58, 0.42);  /* warm amber */
      vec3 colDistort  = vec3(1.0,  0.76, 0.45);  /* bright orange */
      vec3 colHot      = vec3(1.0,  0.92, 0.72);  /* near-white gold */
      vec3 colNoise    = vec3(0.62, 0.45, 0.30);  /* sepia */

      float trackH = 1.0 / float(SD_NUM_TRACKS);

      for (int i = 0; i < SD_NUM_TRACKS; i++) {
        float fi = float(i);
        float trackCenter = (fi + 0.5) * trackH;

        /* This track's decay from its vertical position */
        float tYNorm = 1.0 - trackCenter;
        float tDecay = clamp(pow(tYNorm, 0.75) * SD_DECAY, 0.0, 1.0);

        /* Frequency/phase offset per track (variety) */
        float tOff = fi * 0.391;

        /* Horizontal position with glitch shift */
        float x = (ruv.x + gOff) * ar + tOff;

        /* Degraded composite waveform for this track */
        float wave = sdCompositeWave(x, t + fi * 0.17, tDecay);

        /* Map waveform to vertical position */
        float ampScale = trackH * 0.38 * (1.0 + tDecay * 0.6);
        float waveY = trackCenter + wave * ampScale;

        float dist = ruv.y - waveY;

        float lw = mix(0.0006, 0.0025, tDecay);
        float gw = mix(0.003, 0.014, tDecay * tDecay);

        /* ── Dash/fragment mask (chaos zone) ── */
        float fragAmt = smoothstep(0.5, 0.85, tDecay);
        float dashMask = 1.0;
        float dashFreq = mix(25.0, 90.0, fragAmt);
        float dashSeed = sdHash(vec2(floor(x * dashFreq), fi + floor(t * 2.5)));
        dashMask = mix(1.0, step(0.28, dashSeed), fragAmt);

        float line = sdGlowLine(dist, lw, gw) * dashMask;

        /* ── Color for this track ── */
        vec3 tCol = mix(colClean, colDistort, smoothstep(0.15, 0.5, tDecay));
        tCol = mix(tCol, colHot, smoothstep(0.45, 0.75, tDecay));

        /* ── Warm chromatic aberration (chaos zone) ── */
        float chromaStr = smoothstep(0.45, 0.85, tDecay) * 0.008;
        vec3 lineCol = tCol * line;

        if (chromaStr > 0.0001) {
          float xA = x + chromaStr * ar * 8.0;
          float xB = x - chromaStr * ar * 8.0;
          float waveA = sdCompositeWave(xA, t + fi * 0.17, tDecay);
          float waveB = sdCompositeWave(xB, t + fi * 0.17, tDecay);
          float waveYA = trackCenter + waveA * ampScale;
          float waveYB = trackCenter + waveB * ampScale;
          float lineA = sdGlowLine(ruv.y - waveYA, lw, gw) * dashMask;
          float lineBv = sdGlowLine(ruv.y - waveYB, lw, gw) * dashMask;
          vec3 warmA = vec3(1.0, 0.55, 0.25);  /* copper-red */
          vec3 warmB = vec3(1.0, 0.85, 0.4);   /* warm gold */
          float chromaMix = smoothstep(0.45, 0.85, tDecay);
          vec3 monoLine = tCol * line;
          vec3 chromaLine = warmA * lineA * 0.5 + warmB * lineBv * 0.35 + tCol * line * 0.3;
          lineCol = mix(monoLine, chromaLine, chromaMix);
        }

        col += lineCol;
      }

      /* ── Noise floor (bottom 25%) ── */
      float nfAmt = smoothstep(0.65, 1.0, yNorm) * SD_DECAY;
      if (nfAmt > 0.001) {
        float n1 = sdFbm(frag * 0.012 + vec2(t * 0.4, 0.0));
        float n2 = sdVNoise(frag * vec2(0.25, 0.008) + vec2(t * 2.5, 0.0));
        float band = sdVNoise(vec2(t * 3.5, frag.y * 0.08)) * 0.5 + 0.5;
        float nf = n1 * 0.55 + n2 * 0.3 + band * 0.15;

        /* Ghost lines — faint echoes of the clean signal near the bottom */
        float ghostX = ruv.x * ar;
        for (int gi = 0; gi < 3; gi++) {
          float gfi = float(gi);
          float gWave = sdCompositeWave(ghostX + gfi * 0.5, t + gfi * 0.3, 0.0);
          float gLine = exp(-abs((1.0 - ruv.y) - (0.88 + gfi * 0.03) - gWave * 0.015) * 250.0);
          nf += gLine * 0.12;
        }

        vec3 nfCol = colNoise + vec3(0.08, -0.02, -0.05) * sdVNoise(frag * 0.05 + t);
        col += nfCol * nf * nfAmt * 0.7;
      }

      /* ── Warm ambient glow increasing with decay ── */
      col += vec3(0.42, 0.28, 0.16) * decay * 0.018;

      /* ── Background: very subtle gradient (slightly warmer at bottom) ── */
      vec3 bg = mix(vec3(0.035, 0.035, 0.038), vec3(0.05, 0.04, 0.035), yNorm);
      col += bg;

      /* ── Vignette ── */
      vec2 vc = ruv - 0.5;
      float vig = 1.0 - dot(vc * vec2(0.9, 0.55), vc * vec2(0.9, 0.55)) * 1.4;
      col *= clamp(0.45 + 0.55 * vig, 0.0, 1.0);

      /* ── Film grain (graded down for calm text / no strobe — SD_GRAIN) ── */
      float grain = (sdHash(frag + fract(t * 0.07) * 137.0) - 0.5) * SD_GRAIN;
      col += grain;

      /* ── Tone map: gentle S-curve ── */
      col = clamp(col, 0.0, 1.0);
      col = col * col * (3.0 - 2.0 * col);

      return col * EXPOSURE;
    }
  `,
});
