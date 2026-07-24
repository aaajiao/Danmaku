/**
 * `intaglio` — Magistrate's travelling verdict plate.
 *
 * V4 translates the original `bass-ripple` material rather than replacing its
 * identity. The perforated honeycomb remains, but it is now a softly engraved
 * Ghost-metal membrane: broad recessed cells, bone-grey ridges and three cold
 * studio lights reveal waves travelling through the plate. The mesh is dense
 * enough to read as one material instead of a few hard polygons, yet every cell
 * is far larger than a bullet at the production 480×640 size.
 *
 * The reference's beat-flash is replaced by continuous low-frequency drumhead
 * motion. The same concentric, standing, angular and off-centre families still
 * steer the metal normal and its sweeping reflections. Dynamic sheen and texture
 * recede in the player's lower activity band; the large engraved silhouette does
 * not disappear there.
 *
 * Motion reads `uScroll` only (CLAUDE.md rule 1). No wall clock, audio input or
 * pointer is consulted, so equal ticks produce equal frames.
 *
 * Spatial/material ancestry: `bass-ripple` by pbakaus/radiant, MIT. V4 palette,
 * continuous motion, frequency grading and gameplay calm are original here.
 */

import { BACKGROUND_NOISE_GLSL, defineBackground } from '../../render/background';

defineBackground('intaglio', {
  scrollSpeed: 0.9,
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}

    const float BR_PI = 3.14159265359;
    const float EXPOSURE = 0.78;

    /*
     * About four to five cells span the 480px portrait field. This restores the
     * perforated-material read lost in the first giant-cell pass while keeping
     * each recess safely above bullet scale.
     */
    const float MESH_SCALE = 5.0;

    mat2 rot2(float a) {
      float c = cos(a);
      float s = sin(a);
      return mat2(c, -s, s, c);
    }

    /*
     * The original six wave families survive as one continuous drumhead. Their
     * phases use shader time directly rather than a resetting beat fraction, so
     * neither displacement nor light can jump between ticks.
     */
    float displacement(vec2 p, float t) {
      float dist = length(p);
      float angle = atan(p.y, p.x);
      float breath = 0.5 - 0.5 * cos(t * 0.72);

      float concentric = sin(dist * 10.0 - t * 1.85) * 0.34;
      float residue = sin(dist * 6.5 + t * 0.92 + 0.8) * 0.20;
      float wideResidue = sin(dist * 4.2 - t * 0.48 + 2.1) * 0.10;

      float standing = sin(p.x * 7.0 + t * 0.22);
      standing *= sin(p.y * 6.0 - t * 0.17) * 0.075;

      float drumhead = sin(dist * 8.0 - t * 0.70);
      drumhead *= cos(angle * 3.0 + t * 0.11) * 0.11;

      vec2 source = vec2(
        0.18 * sin(t * 0.10),
        0.16 * cos(t * 0.085)
      );
      float offCentre = sin(length(p - source) * 7.4 - t * 1.12) * 0.15;

      float dome = 1.0 - smoothstep(0.12, 0.88, dist);
      dome *= (breath - 0.5) * 0.25;

      float idle = sin(dist * 3.2 + t * 0.31) * 0.035;
      return concentric + residue + wideResidue + standing
        + drumhead + offCentre + dome + idle;
    }

    vec3 calcNormal(vec2 p, float t, float centreHeight) {
      float eps = 0.003;
      float hx = displacement(p + vec2(eps, 0.0), t);
      float hy = displacement(p + vec2(0.0, eps), t);
      return normalize(vec3(
        -(hx - centreHeight) / eps * 0.16,
        -(hy - centreHeight) / eps * 0.16,
        1.0
      ));
    }

    /* Distance to the nearest edge of the original offset hexagonal lattice. */
    vec3 hexGrid(vec2 p, float scale) {
      p *= scale;
      vec2 r = vec2(1.0, 1.732);
      vec2 halfCell = r * 0.5;
      vec2 a = mod(p, r) - halfCell;
      vec2 b = mod(p - halfCell, r) - halfCell;
      vec2 localCell = (dot(a, a) < dot(b, b)) ? a : b;
      float edgeDistance = 0.5 - max(
        abs(localCell.x) + abs(localCell.y) * 0.577,
        abs(localCell.y) * 1.155
      );
      return vec3(edgeDistance, p - localCell);
    }

    float fresnel(float cosTheta, float f0) {
      float facing = 1.0 - clamp(cosTheta, 0.0, 1.0);
      return f0 + (1.0 - f0) * pow(facing, 5.0);
    }

    vec3 background(vec2 uv) {
      float aspect = uRes.x / uRes.y;
      float t = uScroll * 0.021;
      vec2 centred = vec2((uv.x - 0.5) * aspect, 0.5 - uv.y);

      /*
       * Preserve the reference's oblique metal sheet and slow camera drift. The
       * displacement changes reflected light; it does not pop cell positions.
       */
      vec2 meshUv = centred;
      meshUv.x += sin(t * 0.13) * 0.025;
      meshUv.y /= 0.76 + cos(t * 0.10) * 0.018;
      meshUv.y += 0.055;
      meshUv = rot2(0.045 + sin(t * 0.075) * 0.018) * meshUv;

      float height = displacement(meshUv, t);
      vec3 normal = calcNormal(meshUv, t, height);

      float activityCalm = 1.0 - 0.52 * smoothstep(0.56, 0.94, uv.y);
      vec2 materialWarp = normal.xy * 0.032 * activityCalm;
      vec3 hex = hexGrid(meshUv + materialWarp, MESH_SCALE);
      float edgeDistance = hex.x;

      /*
       * A wide ridge, shoulder and recessed centre replace the old binary wire
       * mask. At ×1 they blend into embossed metal instead of hard geometry.
       */
      float ridge = 1.0 - smoothstep(0.018, 0.145, edgeDistance);
      float shoulderIn = smoothstep(0.055, 0.165, edgeDistance);
      float shoulderOut = 1.0 - smoothstep(0.205, 0.315, edgeDistance);
      float shoulder = shoulderIn * shoulderOut;
      float recess = smoothstep(0.185, 0.355, edgeDistance);

      vec3 viewDir = normalize(vec3(
        -centred.x * 0.22,
        -centred.y * 0.22 + 0.15,
        1.0
      ));
      float ndv = max(dot(normal, viewDir), 0.0);
      float metalFresnel = fresnel(ndv, 0.62);

      /*
       * Three moving lights are the original scene's signature. All lobes are
       * deliberately broad; they read as travelling sheets of sheen, never dots.
       */
      vec3 keyDir = normalize(vec3(
        0.34 + sin(t * 0.23) * 0.30,
        0.56 + cos(t * 0.16) * 0.20,
        1.0
      ));
      vec3 fillDir = normalize(vec3(
        -0.68 + sin(t * 0.12) * 0.16,
        0.30,
        0.84
      ));
      vec3 accentDir = normalize(vec3(
        0.22 + sin(t * 0.19) * 0.18,
        -0.62,
        0.72
      ));

      float keyDiffuse = max(dot(normal, keyDir), 0.0);
      float fillDiffuse = max(dot(normal, fillDir), 0.0);
      float accentDiffuse = max(dot(normal, accentDir), 0.0);

      float keyHalf = max(dot(normal, normalize(keyDir + viewDir)), 0.0);
      float fillHalf = max(dot(normal, normalize(fillDir + viewDir)), 0.0);
      float accentHalf = max(dot(normal, normalize(accentDir + viewDir)), 0.0);

      float keySheen = pow(keyHalf, 16.0) + pow(keyHalf, 7.0) * 0.38;
      float fillSheen = pow(fillHalf, 12.0) + pow(fillHalf, 6.0) * 0.26;
      float accentSheen = pow(accentHalf, 10.0) * 0.34;

      vec3 voidInk = vec3(0.010, 0.016, 0.030);
      vec3 indigoDepth = vec3(0.035, 0.055, 0.105);
      vec3 boneShadow = vec3(0.175, 0.220, 0.285);
      vec3 ghostMetal = vec3(0.350, 0.405, 0.475);
      vec3 boneLight = vec3(0.720, 0.770, 0.805);
      vec3 mutedHeart = vec3(0.420, 0.300, 0.385);

      /*
       * Coarse brushed variation belongs to the whole sheet. It is a tonal wash,
       * not bright per-cell noise, and is reduced around the player.
       */
      float brushA = bgNoise(meshUv * 3.2 + vec2(t * 0.020, 0.0));
      float brushB = bgNoise(meshUv * 6.0 + vec2(4.7, -t * 0.014));
      float brush = (brushA * 0.68 + brushB * 0.32 - 0.5) * activityCalm;

      vec3 plate = mix(boneShadow, ghostMetal, 0.42 + brush * 0.24);
      plate *= 0.46
        + keyDiffuse * 0.34
        + fillDiffuse * 0.15
        + accentDiffuse * 0.05;

      vec3 cavity = mix(voidInk, indigoDepth, 0.64 + brush * 0.16);
      float reflectedWave = clamp(height * 0.32 + 0.5, 0.0, 1.0);
      cavity += indigoDepth * reflectedWave * 0.17 * activityCalm;

      vec3 col = mix(plate, cavity, recess * 0.32);
      col += ghostMetal * shoulder * 0.045;
      col += boneLight * ridge * (0.052 + keyDiffuse * 0.040);

      float waveBody = clamp(height * 0.34 + 0.5, 0.0, 1.0);
      float waveCrest = smoothstep(0.54, 0.82, waveBody);
      float waveTrough = 1.0 - smoothstep(0.20, 0.46, waveBody);
      col += ghostMetal * waveCrest * 0.28 * activityCalm;
      col *= 1.0 - waveTrough * 0.18 * activityCalm;
      col += indigoDepth * waveBody * 0.12 * activityCalm;

      vec3 travellingSheen = vec3(0.0);
      travellingSheen += boneLight * keySheen * 0.38;
      travellingSheen += vec3(0.25, 0.37, 0.56) * fillSheen * 0.24;
      travellingSheen += mutedHeart * accentSheen * 0.11;
      travellingSheen *= metalFresnel * activityCalm;
      col += travellingSheen * (0.30 + ridge * 0.70 + shoulder * 0.34);

      /*
       * The original studio reflection stays as a large environmental movement.
       * It is deliberately softer and cooler than the Ghost-metal ridge.
       */
      vec3 reflected = reflect(-viewDir, normal);
      vec3 environment = vec3(0.018, 0.026, 0.052);
      environment += vec3(0.135, 0.170, 0.215)
        * pow(max(reflected.y, 0.0), 2.0);
      environment += vec3(0.070, 0.115, 0.205)
        * pow(max(-reflected.x, 0.0), 2.0);
      environment += vec3(0.110, 0.075, 0.125)
        * pow(max(-reflected.y, 0.0), 3.0);
      float softbox = pow(max(
        dot(reflected, normalize(vec3(0.2, 0.8, 0.5))),
        0.0
      ), 6.0);
      environment += boneLight * softbox * 0.22;
      col += environment * metalFresnel * (ridge + shoulder * 0.38)
        * 0.34 * activityCalm;

      /* Macro-lens falloff from the source, softened for portrait gameplay. */
      vec2 vignetteUv = uv - 0.5;
      float vignette = 1.0 - smoothstep(
        0.20,
        0.78,
        dot(vignetteUv, vignetteUv) * 1.65
      );
      col *= 0.69 + 0.31 * vignette;

      float lensDistance = length(centred);
      float edgeDepth = smoothstep(0.34, 0.72, lensDistance);
      col = mix(col, col * vec3(0.78, 0.82, 0.92), edgeDepth * 0.18);

      col = col / (vec3(1.35) + col);
      col = pow(max(col, vec3(0.0)), vec3(0.92));
      return col * EXPOSURE;
    }
  `,
});
