/**
 * `cordon` — the warden's station, re-authored from the original hologram-glitch
 * port. Its morphing rotated-FBM volume and smooth horizontal displacement remain
 * the scene's identity. V4 removes the CRT costume — RGB splitting, scanlines,
 * grain, bright sweep and block bursts — and treats the same signal as a coherent
 * indigo Ghost membrane with a few broad spectral folds. It is an organic
 * projection, not a door or a mechanical seal, and is graded to read at ×1.
 *
 * Clock: fixed-tick `uScroll` only (CLAUDE.md rule 1). The underlying volume is
 * derived from pbakaus/radiant `hologram-glitch` (MIT).
 */

import { defineBackground } from '../../render/background';

defineBackground('cordon', {
  scrollSpeed: 0.6,
  fragment: /* glsl */ `
    const float EXPOSURE = 1.02;
    const float HOLO_CLOCK = 0.016;
    const float HOLO_COHERE = 0.24;
    const float HOLO_CALM = 0.12;

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
      /* Ease through the former env<0.1 cutoff. Multiplying a continuous gate
         preserves the quiet interval without snapping the sampled field sideways. */
      float onset = smoothstep(0.06, 0.14, env);
      float band1 = smoothstep(0.78, 0.82, holoVnoise(vec2(y * 15.0, t * 8.0)))  * 0.14;
      float band2 = smoothstep(0.83, 0.87, holoVnoise(vec2(y * 40.0, t * 15.0))) * 0.07;
      float band3 = smoothstep(0.80, 0.84, holoVnoise(vec2(y * 5.0,  t * 4.0)))  * 0.25;
      float dir   = clamp((holoVnoise(vec2(y * 20.0, t * 6.0)) - 0.5) * 4.0, -1.0, 1.0);
      return (band1 + band2 + band3) * dir * env * onset;
    }

    vec3 background(vec2 uv) {
      float aspect = uRes.x / uRes.y;
      vec2 rUv = vec2(uv.x, 1.0 - uv.y);
      vec2 centeredUV = (rUv - 0.5) * vec2(aspect, 1.0);
      float t = uScroll * HOLO_CLOCK;

      float bandOffset = holoBand(rUv.y, t) * HOLO_COHERE;
      vec2 glitchedUV = rUv + vec2(bandOffset, 0.0);
      float slowT = t * 0.22;

      float fieldA = holoFbm(glitchedUV * 2.35 + vec2(slowT, -slowT * 0.62));
      float fieldB = holoFbm(
        glitchedUV * 1.45
        + vec2(-slowT * 0.42, slowT * 0.36)
        + vec2(7.3, 2.1)
      );
      float fieldC = holoFbm(
        glitchedUV * 3.60
        + vec2(slowT * 0.35, slowT * 0.18)
        + vec2(1.4, 8.2)
      );

      float body = smoothstep(0.32, 0.69, fieldA + (fieldB - 0.5) * 0.36);
      float depth = smoothstep(0.34, 0.70, fieldB + (fieldC - 0.5) * 0.28);
      float fold = 1.0 - smoothstep(0.045, 0.26, abs(fieldA - fieldB));
      float bandPhase = (fieldA * 0.72 + fieldB * 0.28) * 13.0 + t * 0.14;
      float membraneBand = smoothstep(
        0.58,
        0.92,
        sin(bandPhase) * 0.5 + 0.5
      );
      float cavity = smoothstep(0.48, 0.74, fieldC);

      float dx = holoFbm((glitchedUV + vec2(0.009, 0.0)) * 2.35 + vec2(slowT, -slowT * 0.62));
      float dy = holoFbm((glitchedUV + vec2(0.0, 0.009)) * 2.35 + vec2(slowT, -slowT * 0.62));
      float edge = smoothstep(0.012, 0.085, length(vec2(dx - fieldA, dy - fieldA)));

      vec3 ink = vec3(0.014, 0.024, 0.052);
      vec3 indigo = vec3(0.085, 0.155, 0.335);
      vec3 violet = vec3(0.235, 0.205, 0.430);
      vec3 ghost = vec3(0.340, 0.520, 0.660);
      vec3 bone = vec3(0.710, 0.770, 0.795);
      vec3 heart = vec3(0.410, 0.185, 0.300);

      float spectral = sin(centeredUV.x * 3.6 + centeredUV.y * 2.2 + t * 0.26) * 0.5 + 0.5;
      vec3 membrane = mix(indigo, violet, spectral * 0.42);
      vec3 baseColor = mix(ink, membrane, 0.10 + body * 0.78);
      baseColor = mix(baseColor, ghost, depth * 0.34);
      baseColor += ghost * fold * body * 0.12;
      baseColor += bone * edge * body * 0.16;
      baseColor += mix(violet, bone, fold * 0.46)
        * membraneBand * body * 0.27;
      baseColor += bone * membraneBand * body * fold * 0.075;
      baseColor *= 1.0 - cavity * (1.0 - body) * 0.28;

      vec2 heartP = centeredUV - vec2(0.08, 0.02);
      float heartWash = exp(-dot(heartP, heartP) * 9.0);
      baseColor += heart * heartWash * body * 0.035;

      float vignette = 1.0 - smoothstep(0.42, 0.88, length(centeredUV * vec2(0.86, 0.72)));
      baseColor *= 0.72 + 0.28 * vignette;

      vec2 st = (uv - vec2(0.5, 0.42)) * vec2(aspect, 1.0);
      baseColor *= 1.0 - HOLO_CALM * exp(-dot(st, st) * 10.0);

      float activityCalm = 1.0 - 0.10 * smoothstep(0.60, 0.96, uv.y);
      baseColor = baseColor / (1.0 + baseColor * 0.32);
      return max(baseColor, 0.0) * EXPOSURE * activityCalm;
    }
  `,
});
