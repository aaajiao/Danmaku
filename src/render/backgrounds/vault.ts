/**
 * `vault` — stage 4, the bottom of the descent, and the most crowded play field
 * in the game. A NEAR-IDENTICAL port of pbakaus/radiant `fluid-amber` (MIT): a
 * domain-warped simplex-noise field (Iñigo Quilez's "fbm of fbm") in a warm amber
 * palette — dense flowing molten marble. The flow IS the identity; its density and
 * warmth are kept as the terminal chamber's slow, heavy churn.
 *
 * ## What was ported (verbatim in structure)
 *
 * The reference's whole field math, carried across unchanged:
 *   - its exact Simplex noise (`snoise`, the Ashima/IQ `mod289`/`permute`
 *     construction — no trig, all IEEE-exact ops) and 5-octave `fbm` (freq ×2.1,
 *     `amp *= u_ampDecay`, per-octave domain offset, temporal shift `t*0.3`);
 *   - the two-stage domain warp verbatim — `q = fbm(p), fbm(p+off)`, then
 *     `r = fbm(p + 4·q + off)`, then `f = fbm(p + 3.5·r)`, with the reference's
 *     staggered clocks (`t`, `t·1.2`, `t·0.8`);
 *   - the palette verbatim — the dark base `mix` on `f·f`, the two amber lifts on
 *     `length(q)` and `length(r.x)`, the `smoothstep` highlight, and the `pow(,1.1)`
 *     grade. Constants copied exactly.
 * This is a straight port, not a re-derivation: identity comes from the reference.
 *
 * ## Adaptation to our surface (the only departures from the reference)
 *
 *   - Uniforms: `u_timeScale` and `u_ampDecay` are baked to their reference
 *     defaults (`0.15`, `0.48`). `u_mouse` — a cursor swirl warp — is EXCISED: the
 *     reference's default resting state (`u_mouse.x < 0`) skips that block entirely,
 *     so dropping it *is* the faithful no-cursor appearance, not a substitution. No
 *     new uniform is added (rule 1 allows only the tick clock).
 *   - Clock: `t = uScroll * 0.005`. At `scrollSpeed = 0.5` that is `0.0025/tick =
 *     0.15/s`, exactly the reference's `u_time * u_timeScale` rate at 60 ticks/s
 *     (the same derivation drift uses). `uScroll` advances only in `step()`.
 *   - y-down uv → the reference's y-up centred coords (`0.5 - uv.y`), normalised by
 *     the short axis exactly as the reference divides by `min(u_res)`.
 *   - FIELD_SCALE 0.8 coarsens the marble (the bullet-band knob, below).
 *   - EXPOSURE 0.34 dims the reference's bright native output to the stage floor.
 *
 * ## Exposure & readability
 *
 * Stage-4 tier, toward the LOWER stage band because the curtain above it is the
 * heaviest in the game. The reference outputs a bright warm field (hot amber veins
 * near ~0.8 raw); EXPOSURE 0.34 brings the structured amber crests down to roughly
 * the 0.26-0.30 band on the R-dominant veins [MEASURED-IN-ACCEPTANCE] (luminance
 * lower still, amber being R>G>B), with the marble's dark inter-vein channels
 * falling to ~0.02-0.03 — the playable gaps a curtain reads through. Bullets stay
 * 1.0-white + bloom, well clear.
 *
 * ## Bullet-band grading (the marble vein width)
 *
 * The DOMINANT amber veins are the low-octave ridges of the domain warp (freq ~1-2,
 * period ~240-480px), an order of magnitude coarser than a bullet — never a
 * concern. The only structure near the play band is the finest of the 5 fbm
 * octaves: at native scale its period on the 480px short axis is ~25px, inside the
 * 16-30px bullet band. Two graders keep it from counterfeiting a bullet:
 *   - **FIELD_SCALE (the vein-width knob)** multiplies `p` by 0.8, coarsening every
 *     octave; the finest lands at ~31px, above the band. Lower it if the marble
 *     reads too fine under a curtain; raise toward 1.0 for the reference's native
 *     scale.
 *   - **Amplitude grading**: that octave carries `amp = 0.5·0.48^4 ≈ 0.027`, an
 *     order below the bright veins, and the palette's highlight term keys off the
 *     LOW-frequency warp (`f`, `r`), so the fine octave is never selectively
 *     brightened. It textures; it cannot alternate bright/dark at bullet scale.
 *
 * ## Motion
 *
 * The noise input drifts by `t·0.3 = 0.00075/tick` (per octave, not multiplied by
 * frequency), so the whole marble churns very slowly and coherently — per-tick
 * luminance step well under the strobe bound [MEASURED-IN-ACCEPTANCE].
 *
 * ## Clock
 *
 * `uScroll` only — no `performance.now`, no wall clock. A pure function of ticks,
 * so a replay looks identical twice (see `background.ts`, rule 1).
 * `backgrounds/index.test.ts` scans this file for wall-clock sources.
 *
 * fluid-amber by pbakaus/radiant, MIT. Ported near-identically; our clock, y-down
 * projection, field scale and exposure. The cursor swirl is excised (no pointer).
 */

import { defineBackground } from '../background';

defineBackground('vault', {
  scrollSpeed: 0.5,
  fragment: /* glsl */ `
    const float EXPOSURE = 0.34;   /* stage 4 — terminal, heaviest curtain */

    /* Vein-width knob: <1 coarsens the marble so the finest fbm octave clears the
       bullet band (~25px -> ~31px at 0.8). Raise toward 1.0 for native scale. */
    const float FIELD_SCALE = 0.8;

    /* Reference defaults, baked (were u_ampDecay / u_timeScale uniforms). */
    const float AMP_DECAY = 0.48;

    /* --- The reference's exact Simplex noise (Ashima/IQ). No trig; IEEE-exact. */
    vec3 mod289(vec3 x)  { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec2 mod289v2(vec2 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

    float snoise(vec2 v) {
      const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                         -0.577350269189626, 0.024390243902439);
      vec2 i  = floor(v + dot(v, C.yy));
      vec2 x0 = v - i + dot(i, C.xx);
      vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      vec4 x12 = x0.xyxy + C.xxzz;
      x12.xy -= i1;
      i = mod289v2(i);
      vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
      vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
      m = m * m;
      m = m * m;
      vec3 x  = 2.0 * fract(p * C.www) - 1.0;
      vec3 h  = abs(x) - 0.5;
      vec3 ox = floor(x + 0.5);
      vec3 a0 = x - ox;
      m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
      vec3 g;
      g.x  = a0.x * x0.x + h.x * x0.y;
      g.yz = a0.yz * x12.xz + h.yz * x12.yw;
      return 130.0 * dot(m, g);
    }

    /* 5-octave fbm, verbatim: freq x2.1, amp x AMP_DECAY, per-octave domain shift,
       and the reference's temporal drift t*0.3 (added to the noise input, so the
       churn is slow and octave-independent — no strobing). */
    float fbm(vec2 p, float t) {
      float val  = 0.0;
      float amp  = 0.5;
      float freq = 1.0;
      for (int i = 0; i < 5; i++) {
        val  += amp * snoise(p * freq + t * 0.3);
        freq *= 2.1;
        amp  *= AMP_DECAY;
        p    += vec2(1.7, 9.2);
      }
      return val;
    }

    vec3 background(vec2 uv) {
      /* y-down uv -> the reference's y-up centred coords, normalised by the short
         axis exactly as the reference divides by min(u_res). */
      float m = min(uRes.x, uRes.y);
      vec2 p = vec2((uv.x - 0.5) * uRes.x, (0.5 - uv.y) * uRes.y) / m;
      p *= FIELD_SCALE;

      float t = uScroll * 0.005;   /* = 0.15/s at 60 ticks/s; ticks only (rule 1) */

      /* Two-stage domain warp — the fluid marble — carried across verbatim. */
      vec2 q = vec2(fbm(p + vec2(0.0, 0.0), t),
                    fbm(p + vec2(5.2, 1.3), t));

      vec2 r = vec2(fbm(p + 4.0 * q + vec2(1.7, 9.2), t * 1.2),
                    fbm(p + 4.0 * q + vec2(8.3, 2.8), t * 1.2));

      float f = fbm(p + 3.5 * r, t * 0.8);

      /* Palette verbatim: dark warm base, two amber lifts, a broad highlight. */
      vec3 col = mix(vec3(0.075, 0.065, 0.055), vec3(0.20, 0.14, 0.07), clamp(f * f * 2.0, 0.0, 1.0));
      col = mix(col, vec3(0.78, 0.58, 0.24), clamp(length(q) * 0.5, 0.0, 1.0));
      col = mix(col, vec3(0.95, 0.75, 0.35), clamp(length(r.x) * 0.6, 0.0, 1.0));

      float highlight = smoothstep(0.5, 1.2, f * f * 3.0 + length(r) * 0.5);
      col += vec3(0.18, 0.12, 0.04) * highlight;

      col = pow(max(col, vec3(0.0)), vec3(1.1));   /* col >= 0 -> pow safe */
      return col * EXPOSURE;
    }
  `,
});
