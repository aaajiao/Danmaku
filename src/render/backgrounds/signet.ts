/**
 * `signet` — sentinel's fight (the stage-1 boss). A NEAR-IDENTICAL port of
 * pbakaus/radiant `liquid-gold` (MIT), and its ONLY home.
 *
 * ## One reference, one scene
 *
 * The old engraved-ring `SEAL_GLSL` cell is retired, and so is the brief "gold
 * trio": the no-repeat ruling ("不要重复") gave every boss scene its own
 * reference — `cordon` is `hologram-glitch`, `regnum` is `topographic` — so
 * `signet` alone carries `liquid-gold` and `GOLD_GLSL` is internal to this file.
 * The picture is the reference; the engine only grades it.
 *
 * `signet` renders the basis at the NEUTRAL variant set — no hue grade (tint
 * `vec3(1)`), no extra fill / saturation / station-calm — so it reads as
 * `liquid-gold` said plainly. The bullet-band grade below (broadened speculars,
 * coarsened ripple) is what the readability contract requires, so `signet` is the
 * reference FIELD at neutral params — the closest the contract allows to the
 * original — not a pixel-identical copy of it.
 *
 * ## The reference's defining image
 *
 * Molten metal flow: a domain-warped FBM height field (three nested warp layers —
 * slow currents, medium flow, fine tension ripples) carrying seven slow metaball
 * bulges, shaded as a metallic gold surface — three analytic lights, Blinn-Phong
 * speculars with white-hot peaks, a Fresnel term, a fake warm environment
 * reflection off the surface normal — with surface-tension lines where the
 * metaballs meet, a radial vignette darkening the edges, and a central pool that
 * glows. ACES tone map, a slight warmth push. A pool of liquid gold, lit and
 * viscous.
 *
 * ## What was adapted (each departure from the near-identical bar, justified)
 *
 *   - Uniforms: the reference's `u_flowSpeed`/`u_viscosity` are baked to their
 *     shipped defaults (0.4 / 0.6) as `LG_FLOW`/`LG_VISC`. `u_mouse` — a pointer
 *     bump/dent in the surface — is EXCISED (its `if (u_mouse.x > 0.0)` gate is
 *     false whenever no pointer hovers, so the shipped picture never showed it);
 *     our uniform surface has no pointer and rule 1 forbids anything but a tick
 *     clock. The reference's unused `height` local (dead after the mouse excision)
 *     is dropped. Nothing else in the field math changed.
 *   - Clock: `t = uScroll * LG_FLOW`. At `scrollSpeed` 0.8 that advances `t` at
 *     ~0.4/s, the reference's `u_time * u_flowSpeed` rate. `uScroll` advances only
 *     in `step()` — no `performance.now`, so a replay looks identical twice
 *     (`background.ts`, rule 1). `backgrounds/index.test.ts` scans for wall clocks.
 *   - y-down 0..1 uv -> the reference's centred, y-up, min-axis-normalised coords
 *     (`(gl_FragCoord - res*0.5)/min(res)`), reconstructed from uv + aspect so the
 *     feature scale relative to the short axis matches the reference exactly.
 *   - Variant seam: the palette, exposure, fill, saturation and a boss-station calm
 *     are parameters of `goldScene`. The seam was cut for a shared gold family that
 *     the no-repeat ruling then dissolved; it is kept because it is the honest
 *     structure of the port (the reference's own tunables), and `signet` passes the
 *     neutral set.
 *
 * ## Exposure & the bullet-band grading
 *
 * Boss-station tier. EXPOSURE 0.30 is a final gain on the tone-mapped picture so
 * the structured molten peaks land ~0.24-0.28 raw [MEASURED-IN-ACCEPTANCE] — a
 * step below the stages, a calmer field for the fight, but the ported material's
 * native richness, not the retired peak~0.1 ceiling.
 *
 * Two knobs keep bright detail out of the bullet band (16-30px), both in
 * `GOLD_GLSL` and labelled there:
 *   1. SPECULAR EXPONENTS broadened (ref 120/80/200 -> 26/18/34) and weighted down:
 *      a tight `pow()` glint on the molten normals would drop a bullet-sized bright
 *      dot; a broad highlight is coarser than any bullet.
 *   2. The FINE RIPPLE highlight coarsened (`noise(uv*15)` -> `*6.5`, ~32px ->
 *      ~74px cells) and kept faint, so its bright specks can never counterfeit a
 *      bullet.
 * The domain-warp FBM keeps its bullet-band octave, but it only textures a broad
 * colour ramp (low local contrast); every BRIGHT term is graded coarse. Per-tick
 * luminance step is small (slow flow, `t` ~0.4/s) — coherent motion, no strobing.
 *
 * ## Hue — gold
 *
 * The reference gold, hue-ungraded: R > G > B off the palette.
 *
 * liquid-gold by pbakaus/radiant, MIT. Ported near-identically; our clock, y-down
 * projection, exposure and the variant seam are the only departures.
 */

import { defineBackground } from '../background';

/**
 * The ported `liquid-gold` basis. A pure function of its arguments (uv, aspect,
 * scroll) plus a small variant set; it reads no uniform, so the ticks-only clock
 * (rule 1) is always the caller's `uScroll`. Self-contained noise (the
 * reference's own hash/value-noise, prefixed `lg` so nothing collides with
 * `bgFbm` or the compose wrapper's `tear*`). GLSL `sin`/`cos` are free here —
 * these values reach the framebuffer and stop.
 */
const GOLD_GLSL = /* glsl */ `
  const float LG_PI   = 3.14159265359;
  const float LG_VISC = 0.6;      /* u_viscosity, baked to its shipped default */
  const float LG_FLOW = 0.00833;  /* scroll -> t: at scrollSpeed 0.8, ~0.4/s == ref u_flowSpeed */

  float lgHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float lgNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = lgHash(i);
    float b = lgHash(i + vec2(1.0, 0.0));
    float c = lgHash(i + vec2(0.0, 1.0));
    float d = lgHash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  /* FBM with viscosity-controlled octave decay (u_viscosity baked in). */
  float lgFbm(vec2 p, float t) {
    float val = 0.0;
    float amp = 0.5;
    float freq = 1.0;
    float decay = 0.45 + LG_VISC * 0.2;
    for (int i = 0; i < 6; i++) {
      val += amp * lgNoise(p * freq + t);
      freq *= 2.0 + LG_VISC * 0.3;
      amp *= decay;
      p += vec2(1.7, 9.2);
    }
    return val;
  }

  /* Domain warping for viscous flow: three nested warp layers. */
  float lgWarp(vec2 p, float t) {
    vec2 q = vec2(
      lgFbm(p + vec2(0.0, 0.0), t * 0.5),
      lgFbm(p + vec2(5.2, 1.3), t * 0.5)
    );
    vec2 r = vec2(
      lgFbm(p + 3.0 * q + vec2(1.7, 9.2), t * 0.7),
      lgFbm(p + 3.0 * q + vec2(8.3, 2.8), t * 0.7)
    );
    float f = lgFbm(p + 2.5 * r, t * 0.4);
    return f + length(q) * 0.4 + length(r) * 0.3;
  }

  /* Seven slow metaball bulges. */
  float lgMeta(vec2 p, float t) {
    float val = 0.0;
    for (int i = 0; i < 7; i++) {
      float fi = float(i);
      vec2 center = vec2(
        sin(t * 0.3 + fi * 2.1) * 0.6 + cos(t * 0.2 + fi * 1.3) * 0.3,
        cos(t * 0.25 + fi * 1.7) * 0.6 + sin(t * 0.15 + fi * 2.5) * 0.3
      );
      float radius = 0.15 + 0.1 * sin(t * 0.4 + fi * 3.0);
      float d = length(p - center);
      val += radius / (d + 0.05);
    }
    return val;
  }

  /* Surface normal from analytic finite differences (deterministic, no dFdx). */
  vec3 lgNormal(vec2 p, float t, float warpCenter) {
    float eps = 0.005;
    float hC = warpCenter + lgMeta(p, t) * 0.08;
    float hR = lgWarp(p + vec2(eps, 0.0), t) + lgMeta(p + vec2(eps, 0.0), t) * 0.08;
    float hU = lgWarp(p + vec2(0.0, eps), t) + lgMeta(p + vec2(0.0, eps), t) * 0.08;
    return normalize(vec3((hC - hR) / eps, (hC - hU) / eps, 1.0));
  }

  float lgFresnel(float cosTheta, float f0) {
    return f0 + (1.0 - f0) * pow(1.0 - cosTheta, 5.0);   /* cosTheta clamped >=0 -> pow safe */
  }

  /* The reference scene, with a small variant set so cordon/regnum re-use it:
       tint      gold-family hue grade (signet vec3(1) = the reference)
       exposure  per-scene final gain (structured peaks ~0.24-0.28 raw)
       fill      0 reference vignette (dark rest) .. 1 fuller field (regnum, least rest)
       sat       chroma multiply around luma (regnum > 1)
       calm      0 none .. gentle radial dim at the boss station (cordon) */
  vec3 goldScene(
    vec2 uv, float aspect, float scroll,
    vec3 tint, float exposure, float fill, float sat, float calm
  ) {
    /* y-down 0..1 uv -> the reference's centred, y-up, min-axis-normalised coords. */
    vec2 ruv;
    if (aspect <= 1.0) ruv = vec2(uv.x - 0.5, (0.5 - uv.y) / aspect);
    else               ruv = vec2((uv.x - 0.5) * aspect, 0.5 - uv.y);

    float t = scroll * LG_FLOW;

    float field  = lgWarp(ruv * 2.0, t);
    float meta   = lgMeta(ruv, t);
    vec3  normal = lgNormal(ruv * 2.0, t, field);

    vec3 viewDir   = vec3(0.0, 0.0, 1.0);
    vec3 lightDir1 = normalize(vec3(0.4, 0.5, 0.9));
    vec3 lightDir2 = normalize(vec3(-0.6, -0.3, 0.7));
    vec3 lightDir3 = normalize(vec3(0.0, 0.8, 0.5));

    vec3 goldBase   = vec3(0.83, 0.61, 0.22);
    vec3 goldBright = vec3(1.0, 0.84, 0.45);
    vec3 goldDeep   = vec3(0.55, 0.35, 0.08);
    vec3 goldShadow = vec3(0.18, 0.10, 0.02);
    vec3 whiteHot   = vec3(1.0, 0.97, 0.88);

    float f0 = 0.8;

    float NdotL1 = max(dot(normal, lightDir1), 0.0);
    float NdotL2 = max(dot(normal, lightDir2), 0.0);
    float NdotL3 = max(dot(normal, lightDir3), 0.0);

    vec3 halfVec1 = normalize(lightDir1 + viewDir);
    vec3 halfVec2 = normalize(lightDir2 + viewDir);
    vec3 halfVec3 = normalize(lightDir3 + viewDir);

    /* BULLET-BAND KNOB 1 — specular exponents broadened from the reference's
       120/80/200 to 26/18/34: a tight pow() glint on the molten normals lands a
       bright dot at bullet scale; a broad highlight is coarser than any bullet. */
    float spec1 = pow(max(dot(normal, halfVec1), 0.0), 26.0);
    float spec2 = pow(max(dot(normal, halfVec2), 0.0), 18.0);
    float spec3 = pow(max(dot(normal, halfVec3), 0.0), 34.0);

    float NdotV = max(dot(normal, viewDir), 0.0);
    float fres  = lgFresnel(NdotV, f0);

    /* Base gold tone varies with the surface field. */
    float fieldNorm = smoothstep(0.3, 1.8, field);
    vec3 baseColor = mix(goldShadow, goldDeep,  smoothstep(0.0, 0.3, fieldNorm));
    baseColor      = mix(baseColor,  goldBase,  smoothstep(0.3, 0.6, fieldNorm));
    baseColor      = mix(baseColor,  goldBright, smoothstep(0.6, 0.9, fieldNorm));

    vec3 diffuse = baseColor * (NdotL1 * 0.5 + NdotL2 * 0.3 + NdotL3 * 0.2);

    vec3 specColor1 = mix(goldBright, whiteHot, spec1);
    vec3 specColor2 = mix(goldBright, whiteHot, spec2 * 0.5);
    vec3 specColor3 = mix(goldBright, whiteHot, spec3);

    /* Specular weights trimmed from the reference's 1.2/0.6/1.5 to 0.7/0.4/0.7
       alongside the broadened exponents, so no white-hot peak nears a bullet's
       1.0 core. */
    vec3 specular = specColor1 * spec1 * 0.7
                  + specColor2 * spec2 * 0.4
                  + specColor3 * spec3 * 0.7;

    /* Fake warm environment reflection off the surface normal. */
    vec2 reflUv = normal.xy * 0.5 + 0.5;
    vec3 envRefl = mix(vec3(0.12, 0.07, 0.02), vec3(0.45, 0.30, 0.12), reflUv.y);
    envRefl = mix(envRefl, vec3(0.7, 0.55, 0.25), smoothstep(0.6, 1.0, reflUv.y));

    vec3 col = diffuse * 0.4 + specular * fres + envRefl * fres * 0.5;
    col += baseColor * 0.12;   /* warm ambient fill */

    /* Surface-tension lines where metaballs meet — low frequency, kept. */
    float metaGrad = abs(meta - 3.5);
    float tensionLine = smoothstep(0.5, 0.0, metaGrad) * 0.3;
    col += goldBright * tensionLine;

    /* BULLET-BAND KNOB 2 — the fine ripple sheen. The reference's noise(uv*15)
       lands its bright specks near 32px (dead in the bullet band); coarsened to
       *6.5 (~74px cells) and kept faint (fres-gated) so a speck can never read as
       a bullet. */
    float ripple = lgNoise(ruv * 6.5 + t * 2.0);
    ripple = ripple * ripple;
    float rippleHighlight = smoothstep(0.6, 0.9, ripple) * 0.06;
    col += whiteHot * rippleHighlight * fres;

    /* Radial vignette + central pool. fill raises the floor (less dark rest) and
       widens the pool for regnum's fuller field; signet/cordon keep the reference
       floor 0.35. */
    float dist = length(ruv);
    float vignette = 1.0 - smoothstep(0.3, 1.2, dist);
    float vigFloor = mix(0.35, 0.62, fill);
    col *= vigFloor + vignette * (1.0 - vigFloor);
    float poolGlow = smoothstep(0.8, 0.0, dist) * mix(0.15, 0.24, fill);
    col += goldBright * poolGlow;

    /* ACES-like tone map + the reference's slight warmth push. */
    col = col * (2.51 * col + 0.03) / (col * (2.43 * col + 0.59) + 0.14);
    col = pow(max(col, 0.0), vec3(0.95, 1.0, 1.08));   /* base clamped >=0 -> pow safe */

    /* Gold-family hue grade (signet passes vec3(1) = the reference). */
    col *= tint;

    /* Saturation push (regnum) around Rec.601 luma; clamp so no channel goes neg. */
    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    col = max(mix(vec3(luma), col, sat), 0.0);

    /* Gentle radial calm at the boss station (cordon): modulation only, <=1, so it
       only ever dims the centre-upper field where the boss and bullets read. */
    if (calm > 0.001) {
      vec2 st = (uv - vec2(0.5, 0.42)) * vec2(aspect, 1.0);
      col *= 1.0 - calm * exp(-dot(st, st) * 10.0);
    }

    return col * exposure;
  }
`;

defineBackground('signet', {
  scrollSpeed: 0.8,
  fragment: /* glsl */ `
${GOLD_GLSL}

    const float EXPOSURE = 0.30;   /* boss-station tier; peaks ~0.24-0.28 raw */

    vec3 background(vec2 uv) {
      return goldScene(
        uv, uRes.x / uRes.y, uScroll,
        vec3(1.0),   /* the reference gold, ungraded */
        EXPOSURE,
        0.0,         /* reference vignette (a dark rest around the pool) */
        1.0,         /* reference saturation */
        0.0          /* no station calm */
      );
    }
  `,
});
