/**
 * `drift` — the neutral/title field. A NEAR-IDENTICAL port of pbakaus/radiant
 * `moonlit-ripple` (MIT): a raymarched water plane under a low moon, lit by a
 * single analytical moon disc, Fresnel-mixing sky reflection against a dark sea.
 *
 * ## What was ported
 *
 * The reference verbatim in structure: a perspective camera (`ro = (0,8,0)`,
 * fixed tilt), seven rotated sine-wave layers with ANALYTIC normals (each `sin`'s
 * derivative is a `cos` at the same phase — no `dFdx`, deterministic), a moon disc
 * with a hash crater texture and limb darkening, a broad moon bloom, and the
 * Fresnel reflection/refraction mix on the wave surface with distance fog to the
 * horizon. This is the ONE scene with `dot(N,L)` — a genuinely lit surface — which
 * is what classifies it alone at a thumbnail.
 *
 * ## Adaptation to our surface (the only departures from the reference)
 *
 *   - Uniforms: the reference's `u_rippleSpeed/u_moonGlow/u_tilt/u_waves` are baked
 *     to their defaults; `u_mouse` (the concentric mouse ripple) is excised — our
 *     uniform surface has no pointer and rule 1 forbids anything but a tick clock.
 *   - Clock: `t = uScroll * 0.014`, so at 60 ticks/s the wave phase advances at the
 *     reference's `u_time*0.5` rate. `uScroll` advances only in `step()`.
 *   - y-down uv -> the reference's y-up screen coords via `(0.5 - uv.y)`, so the
 *     sky sits at the top (the entry lane) and the lit water fills the bottom.
 *   - Palette cooled to blue-silver (the reference's own note: "hue-rotates to cool
 *     moonlit blue") — drift's neutral role-hue, kept distinct from expanse.
 *   - EXPOSURE 0.55 (menu is the brightest tier — no bullets to protect on the
 *     title screen); the hyper-tight `pow(moonDot,400)` core is dropped so the moon
 *     reads as a disc, never a bullet-sized pinpoint.
 *
 * ## Exposure & readability
 *
 * Menu tier, brightest of the grid. Structured water peaks land in the
 * ~0.20-0.24 band [MEASURED-IN-ACCEPTANCE]; the moon disc is the hero highlight
 * and is a disc (>bullet), not a point. drift is also named by `packs/example`'s
 * boss `pyre`; under that fight the wave detail flattens with distance and the
 * exposure keeps the crest well under bullet-white. Motion: wave sheen + slow moon
 * drift, per-tick phase step well under the strobe bound [MEASURED-IN-ACCEPTANCE].
 *
 * ## Clock
 *
 * `uScroll` only — no `performance.now`, no wall clock. A pure function of ticks,
 * so a replay looks identical twice (see `background.ts`, rule 1).
 * `backgrounds/index.test.ts` scans this file for wall-clock sources.
 *
 * moonlit-ripple by pbakaus/radiant, MIT. Ported; our clock, y-down projection,
 * palette and exposure.
 */

import { BACKGROUND_NOISE_GLSL, defineBackground } from '../background';

defineBackground('drift', {
  scrollSpeed: 0.6,
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}

    const float MR_PI = 3.14159265359;
    const float EXPOSURE = 0.55;   /* menu tier — the brightest cell */

    /* Cool moonlit palette (drift's blue-silver role-hue). */
    const vec3 MOON_COL = vec3(0.86, 0.91, 1.00);

    float mrHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    /* Seven rotated sine layers; height AND analytic gradient (the core move). */
    vec4 sea(vec2 p, float t) {
      float h = 0.0;
      vec2 dh = vec2(0.0);
      float freq = 1.0;
      float amp = 0.2;
      float decay = 0.42;   /* u_waves = 1 -> mid decay */
      float angle = 0.0;
      for (int i = 0; i < 7; i++) {
        float c = cos(angle);
        float s = sin(angle);
        vec2 pp = vec2(c * p.x + s * p.y, -s * p.x + c * p.y);
        float fi = float(i);
        float spd = sqrt(freq) * 0.8;
        float phase = (pp.y + fi) * freq - t * spd;
        float sn = sin(phase);
        float cn = cos(phase);
        h += sn * amp;
        float dy = freq * amp * cn;
        dh += vec2(-s * dy, c * dy);
        angle += fi + 1.2;
        freq *= 1.3;
        amp *= decay;
      }
      vec3 N = normalize(vec3(-dh.x, 1.0, -dh.y));
      return vec4(h, N);
    }

    vec3 moonDir() { return normalize(vec3(0.15, 0.35, 1.0)); }

    /* Night sky with a textured moon disc (cool). */
    vec3 skyColor(vec3 rd) {
      vec3 md = moonDir();
      vec3 skyDark = vec3(0.020, 0.028, 0.050);
      vec3 skyHoriz = vec3(0.030, 0.042, 0.070);
      vec3 sky = mix(skyHoriz, skyDark, max(rd.y, 0.0));
      float moonDot = max(dot(rd, md), 0.0);
      float moonAngle = acos(clamp(moonDot, 0.0, 1.0));
      float moonRadius = 0.04;
      float disc = smoothstep(moonRadius, moonRadius * 0.7, moonAngle);
      if (disc > 0.0) {
        vec3 up = vec3(0.0, 1.0, 0.0);
        vec3 right = normalize(cross(up, md));
        vec3 mup = cross(md, right);
        vec2 muv = vec2(dot(rd - md, right), dot(rd - md, mup)) * 25.0;
        float crater = mrHash(floor(muv * 2.0)) * 0.25;
        crater += mrHash(floor(muv * 4.0)) * 0.15;
        float darkening = 1.0 - crater * smoothstep(moonRadius * 0.9, moonRadius * 0.4, moonAngle);
        float limb = smoothstep(0.0, moonRadius, moonAngle);
        darkening *= mix(1.0, 0.7, limb * limb);
        sky += MOON_COL * disc * 0.85 * darkening;
      }
      /* Broad bloom kept and widened (pow 40 -> 26) so the moon halo carries into
         frame as the menu's bright field; the hyper-tight pow(,400) core is dropped. */
      sky += MOON_COL * 0.35 * pow(moonDot, 26.0);
      return sky;
    }

    vec3 background(vec2 uv) {
      float aspect = uRes.x / uRes.y;
      float t = uScroll * 0.014;

      /* y-down 0..1 -> reference y-up screen coords, aspect on x. */
      vec2 sc = vec2((uv.x - 0.5) * 2.0 * aspect, (0.5 - uv.y) * 2.0);

      /* Fixed camera (u_tilt = 0.15). */
      float tiltRad = 0.15 * 0.7;
      vec3 ro = vec3(0.0, 8.0, 0.0);
      vec3 ww = normalize(vec3(0.0, -sin(tiltRad), cos(tiltRad)));
      vec3 uu = normalize(cross(vec3(0.0, 1.0, 0.0), ww));
      vec3 vv = normalize(cross(ww, uu));
      vec3 rd = normalize(sc.x * uu + sc.y * vv + 2.5 * ww);

      vec3 md = moonDir();
      vec3 sky = skyColor(rd);
      vec3 col = sky;

      float dsea = -ro.y / rd.y;
      if (dsea > 0.0) {
        vec3 wp = ro + dsea * rd;
        vec4 s = sea(wp.xz, t);
        float h = s.x;
        vec3 nor = s.yzw;

        nor = mix(nor, vec3(0.0, 1.0, 0.0), smoothstep(0.0, 300.0, dsea));

        float fre = clamp(1.0 - dot(-nor, rd), 0.0, 1.0);
        fre = pow(fre, 3.0);                       /* fre clamped >=0 -> pow safe */
        float dif = mix(0.25, 1.0, max(dot(nor, md), 0.0));

        vec3 refl = skyColor(reflect(rd, nor));
        vec3 seaCol1 = vec3(0.012, 0.020, 0.045);
        vec3 seaCol2 = vec3(0.040, 0.060, 0.110);
        vec3 refr = seaCol1 + dif * MOON_COL * seaCol2 * 0.15;

        col = mix(refr, 0.9 * refl, fre);

        float atten = max(1.0 - dsea * dsea * 0.0005, 0.0);
        col += seaCol2 * (wp.y - h) * 1.5 * atten;

        col = mix(col, sky, 1.0 - exp(-0.008 * dsea));
      }

      col = pow(max(col, vec3(0.0)), vec3(0.85));   /* col >=0 -> pow safe */
      return col * EXPOSURE;
    }
  `,
});
