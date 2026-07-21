/**
 * `intaglio` — a NEAR-IDENTICAL port of pbakaus/radiant `bass-ripple` (MIT): a
 * perforated metal honeycomb — a hexagonal grille of brushed-gunmetal wires over
 * dark holes — with beat-synced light waves travelling out across the mesh, lit by
 * three sweeping speculars (amber key, copper fill, gold accent) over a studio
 * environment reflection. Perforated, engraved metal IS this scene's name: the
 * incised die read as the plate it is cut from.
 *
 * ## What was ported (the reference's defining image, kept verbatim in structure)
 *
 * The whole material pipeline is the reference's, term for term:
 *
 *   - The **hexagonal grille** (`hexGrid`): two offset lattices, nearest-cell
 *     select, an analytic edge distance, split into a `wire` mask and a `hole`
 *     mask. This is the picture — a field of pressed-metal honeycomb.
 *   - The **traveling light waves** (`displacement` + `calcNormal`): six beat-synced
 *     wave modes (concentric ripples from centre, two prior-beat residues, a
 *     standing cross-hatch, radial drumhead angular modes, an off-centre drifting
 *     source) plus a low-frequency dome push and an idle vibration, summed into a
 *     height field whose forward-difference normal steers every specular. The mesh
 *     does not move; the *light* ripples across it, which is the reference's whole
 *     idea and ours.
 *   - The **three-light metal** (key/fill/accent + top fill + rim), the gunmetal
 *     base with fresnel, the dark hole interior with its beat light-leak, the beat
 *     colour wash, and the fake studio-HDRI environment reflection — all ported
 *     unchanged in structure and palette.
 *
 * ## Adaptation to our surface (every departure from the reference, and why)
 *
 *   - **Uniforms.** The reference's audio drivers `u_bassFreq`/`u_bassIntensity`
 *     are baked to their defaults (`BASS_FREQ 0.4`, `BASS_INTENSITY 1.0`) as
 *     constants, and `u_mouse` (the pointer ripple source, `mouseWave`) is excised
 *     entirely — our uniform surface has no pointer and rule 1 forbids anything but
 *     a tick clock.
 *   - **Clock.** `t = uScroll * 0.0185`, so at `scrollSpeed 0.9` one tick advances
 *     `t` by ~0.0167 — i.e. `t` tracks seconds at 60Hz, matching the reference's
 *     `u_time = now*0.001`. The bass period is `1/0.4 = 2.5s`, so a beat lands every
 *     ~150 ticks. `uScroll` advances only in `step()`; a replay looks identical
 *     twice (rule 1). No `performance.now` — `backgrounds/index.test.ts` scans this
 *     file for wall-clock sources.
 *   - **y-down uv → the reference's y-up screen coords** via `(0.5 - uv.y)`, so the
 *     hemisphere ambient (warm above) and the `meshUV.y += 0.08` offset read the
 *     way they do in the original.
 *   - **The sharp beat attack is softened (no-strobe law).** The reference's
 *     `exp(-beatFrac*3.5)` snaps from ~0.03 to 1.0 in a single frame on every beat —
 *     a full-brightness flash, which is exactly the per-tick strobe rule 1's cousin
 *     forbids. `beatEnv()` multiplies that decay by a `smoothstep(0,0.08,x)` attack,
 *     so the pulse SWELLS in over ~12 ticks instead of snapping. The beat-flare and
 *     hole-leak gains are also trimmed (`*1.0 → *0.35`) so the surviving pulse step
 *     stays well under the strobe bound. The prior-beat residues pass `x>1`, where
 *     the attack term is already 1 — so residue behaviour is untouched.
 *   - **The tightest speculars are broadened.** `pow(NdH,180/120/90)` on a
 *     slow-varying wave normal draws a *bullet-thin bright contour* across the
 *     field — a fake bullet. Cut to `60/45/40`, so each highlight reads as a sheen
 *     band wider than a bullet (the same move `drift` made dropping the moon's
 *     `pow(,400)` pinpoint). See the bullet-band note below.
 *   - **Film grain and chromatic aberration dropped.** Per-pixel white noise is
 *     high-frequency bright detail by definition — the clearest bullet-band
 *     violation — and both were cosmetic macro-photography touches keyed to
 *     `gl_FragCoord`, not part of the metal. The vignette, DOF-edge darken and
 *     Reinhard tone-map are kept.
 *   - **Reinhard white point 1.5 → 2.2** so the bright specular tail compresses
 *     further off white, keeping the crest a metal sheen and never a bullet.
 *
 * ## The bullet-band knob — `MESH_SCALE`
 *
 * The honeycomb period is the readability parameter. At the reference's
 * `meshScale 45` a hexagon spans ~14px in this 480×640 field — *below* the bullet
 * band, a fine bright grille that would counterfeit a curtain. `MESH_SCALE 12`
 * enlarges the cell to ~53px, well ABOVE the 16-30px bullet band: the grille reads
 * as coarse pressed metal, never as bullets. Two finer terms are graded rather than
 * resized: the micro cross-hatch (`microGrid`, ~3× the mesh frequency, so ~18px) is
 * kept only as sub-perceptual scratches — its peak contribution is ~0.02 raw before
 * exposure, an order of magnitude under a bullet's 1.0-white, so a bullet-frequency
 * mesh is admissible purely because it is DIM; and the gunmetal base texture is
 * coarsened (`bgNoise ×30/×80 → ×18/×40`, ~35px) and is a ±3% diffuse tint, not a
 * bright dot. The broadened speculars (above) are the third guard: no highlight is
 * a pinpoint.
 *
 * ## Exposure & readability
 *
 * Seal tier — a boss station, a step below the open stages. The composed HDR is
 * Reinhard-compressed (bounded tail) then scaled by `EXPOSURE 0.32`: dark holes
 * settle near ~0.004 raw, mid wire ~0.06, and the brightest travelling sheen crests
 * ~0.22-0.26 raw [MEASURED-IN-ACCEPTANCE] — bimodal (dark voids, bright wire),
 * always well under a bullet's 1.0-white + bloom. The arbiter is bullet readability
 * under a real curtain on the density page and in `bun run dev`; these numbers
 * describe what the code produces, they do not prescribe it. The seal-station
 * radial calm of the retired SEAL machinery is NOT carried — the reference's own
 * vignette (centre bright, corners dark) is the picture, and readability rests on
 * the coarse period and the capped crest, not on a centre well.
 *
 * ## Clock
 *
 * `uScroll` only — no `performance.now`, no wall clock. A pure function of ticks,
 * so a replay looks identical twice (see `background.ts`, rule 1).
 * `backgrounds/index.test.ts` scans this file for wall-clock sources.
 *
 * bass-ripple by pbakaus/radiant, MIT. Ported; our clock, y-down projection,
 * softened beat envelope, broadened speculars, coarsened mesh and exposure.
 */

import { BACKGROUND_NOISE_GLSL, defineBackground } from '../background';

defineBackground('intaglio', {
  scrollSpeed: 0.9,
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}

    const float BR_PI = 3.14159265359;

    /* Seal tier — a boss station a step below the open stages. See the header. */
    const float EXPOSURE = 0.32;

    /* Baked from the reference's audio drivers (u_bassFreq / u_bassIntensity). */
    const float BASS_FREQ = 0.4;
    const float BASS_INTENSITY = 1.0;

    /* THE READABILITY KNOB. Reference meshScale was 45 -> ~14px hexagons (below the
       bullet band); 12 gives ~53px cells, well above it. Lower = coarser/safer. */
    const float MESH_SCALE = 12.0;

    mat2 rot2(float a) {
      float c = cos(a), s = sin(a);
      return mat2(c, -s, s, c);
    }

    /* Softened beat envelope (no-strobe law). The reference's bare exp(-x*3.5)
       snaps to full brightness in one frame on every beat; the smoothstep attack
       swells it in over ~12 ticks. Prior-beat residues pass x>1, where the attack
       term is already 1, so their decay is untouched. */
    float beatEnv(float x) {
      return smoothstep(0.0, 0.08, x) * exp(-x * 3.5);
    }

    /* Beat-synced height displacement — the traveling waves. Combines six wave
       modes, a dome push and an idle vibration, exactly as the reference does. The
       pointer ripple (u_mouse) is excised. */
    float displacement(vec2 p, float t) {
      float period = 1.0 / max(BASS_FREQ, 0.01);
      float phase = t / period;
      float beatFrac = fract(phase);

      float envelope = beatEnv(beatFrac);
      float prevEnv  = beatEnv(beatFrac + 1.0);   /* previous beat residue */
      float prevEnv2 = beatEnv(beatFrac + 2.0);   /* second prior beat */

      float dist = length(p);
      float angle = atan(p.y, p.x);

      /* Mode 1: concentric ripples from centre — the primary bass hit. */
      float wave1 = sin(dist * 14.0 - beatFrac * 22.0) * envelope;
      /* Mode 2: slower, wider concentric from centre (prev beat residue). */
      float wave2 = sin(dist * 9.0 - (beatFrac + 1.0) * 16.0) * prevEnv * 0.6;
      /* Mode 3: second prev beat — wider, fainter. */
      float wave3 = sin(dist * 6.0 - (beatFrac + 2.0) * 12.0) * prevEnv2 * 0.3;
      /* Mode 4: standing wave (cross-hatch). */
      float standing = (sin(p.x * 18.0) * sin(p.y * 18.0)) * envelope * 0.3;
      /* Mode 5: radial drumhead modes (angular patterns). */
      float radialMode = sin(dist * 22.0) * cos(angle * 3.0) * envelope * 0.2;
      radialMode += sin(dist * 16.0) * cos(angle * 5.0 + 1.0) * prevEnv * 0.1;
      /* Mode 6: off-centre ripple source, drifts slowly. */
      vec2 offCenter = vec2(0.3 * sin(t * 0.2), 0.25 * cos(t * 0.25));
      float dist2 = length(p - offCenter);
      float wave6 = sin(dist2 * 12.0 - beatFrac * 18.0) * envelope * 0.35;

      /* Low-frequency dome push — the whole mesh pushes out on the beat. */
      float dome = (1.0 - smoothstep(0.0, 1.0, dist)) * envelope * 0.8;

      float h = (wave1 + wave2 + wave3 + standing + radialMode + wave6 + dome) * BASS_INTENSITY;

      /* Subtle idle vibration between beats. */
      float idle = sin(dist * 8.0 + t * 3.0) * 0.03 * (1.0 - envelope);
      idle += sin(dist * 5.0 - t * 1.5) * 0.015 * (1.0 - envelope);
      h += idle * BASS_INTENSITY;

      return h;
    }

    /* Normal from displacement via forward differences (analytic, deterministic). */
    vec3 calcNormal(vec2 p, float t, float hc) {
      float eps = 0.002;
      float hx = displacement(p + vec2(eps, 0.0), t);
      float hy = displacement(p + vec2(0.0, eps), t);
      return normalize(vec3(-(hx - hc) / eps * 0.35, -(hy - hc) / eps * 0.35, 1.0));
    }

    /* Hexagonal grid distance: x = distance to nearest hex edge, yz = cell id. */
    vec3 hexGrid(vec2 p, float scale) {
      p *= scale;
      vec2 r = vec2(1.0, 1.732);
      vec2 h = r * 0.5;
      vec2 a = mod(p, r) - h;
      vec2 b = mod(p - h, r) - h;
      vec2 g = (dot(a, a) < dot(b, b)) ? a : b;
      float edgeDist = 0.5 - max(abs(g.x) * 1.0 + abs(g.y) * 0.577, abs(g.y) * 1.155);
      vec2 cellId = p - g;
      return vec3(edgeDist, cellId);
    }

    /* Metallic fresnel (Schlick). cosTheta is a clamped dot, so the pow base is
       in [0,1] and safe. */
    float fresnel(float cosTheta, float f0) {
      return f0 + (1.0 - f0) * pow(1.0 - cosTheta, 5.0);
    }

    vec3 background(vec2 uv) {
      float aspect = uRes.x / uRes.y;
      float t = uScroll * 0.0185;   /* ~seconds at 60Hz; beat every ~150 ticks */

      /* y-down uv -> the reference's y-up centred, aspect-corrected coords.
         Both axes centre on 0 (x in [-0.5,0.5]*aspect, y in [-0.5,0.5]); the y
         term is (0.5 - uv.y), NOT (0.5 - uv.y) - 0.5 — the latter simplifies to
         -uv.y and shoves the whole mesh (ripple source, dome push, drumhead modes)
         down to the top edge instead of the vertical centre the reference uses. */
      vec2 cuv = vec2((uv.x - 0.5) * aspect, 0.5 - uv.y);

      /* Camera / view — slightly off-axis, with a slow drift for life. */
      float camDriftX = sin(t * 0.15) * 0.03;
      float camDriftY = cos(t * 0.12) * 0.02;
      float foreshorten = 0.7 + camDriftY * 0.5;   /* perspective compress on y */

      vec2 meshUV = cuv;
      meshUV.x += camDriftX;
      meshUV.y = meshUV.y / foreshorten;
      meshUV.y += 0.08;
      meshUV = rot2(0.06 + sin(t * 0.08) * 0.02) * meshUV;

      /* Displacement — beat-synced wave patterns — and its normal. */
      float h = displacement(meshUV, t);
      vec3 N = calcNormal(meshUV, t, h);

      /* Hexagonal mesh. MESH_SCALE keeps the cell above the bullet band. */
      float meshScale = MESH_SCALE;
      vec3 hex = hexGrid(meshUV + N.xy * 0.003, meshScale);
      float hexEdge = hex.x;

      float wireWidth = 0.06;
      float wire = 1.0 - smoothstep(0.0, wireWidth, hexEdge);
      float hole = smoothstep(wireWidth, wireWidth + 0.02, hexEdge);

      /* Fine secondary cross-hatch — kept only as sub-perceptual scratches (graded
         by BRIGHTNESS, not resized), so a ~18px period is admissible. See header. */
      vec2 microGrid = fract(meshUV * meshScale * 3.0 + N.xy * 0.01);
      float microWire = smoothstep(0.04, 0.0, min(microGrid.x, microGrid.y));
      microWire += smoothstep(0.04, 0.0, min(1.0 - microGrid.x, 1.0 - microGrid.y));
      microWire *= 0.15;

      /* View direction. */
      vec3 V = normalize(vec3(-cuv.x * 0.3, -cuv.y * 0.3 + 0.2, 1.0));

      /* Beat envelope for light modulation (softened, see beatEnv). */
      float period = 1.0 / max(BASS_FREQ, 0.01);
      float bFrac = fract(t / period);
      float bEnv = beatEnv(bFrac);

      /* Key light — warm amber, sweeps slowly. Sharp specular broadened 180->60. */
      vec3 L1 = normalize(vec3(0.4 + sin(t * 0.25) * 0.4, 0.6 + cos(t * 0.18) * 0.3, 1.0));
      float NdL1 = max(dot(N, L1), 0.0);
      vec3 H1 = normalize(L1 + V);
      float NdH1 = max(dot(N, H1), 0.0);
      float spec1 = pow(NdH1, 60.0);
      float spec1med = pow(NdH1, 28.0);
      float spec1soft = pow(NdH1, 12.0);
      vec3 lightCol1 = vec3(1.0, 0.82, 0.55);

      /* Fill light — copper/bronze from the left. Broadened 120->45. */
      vec3 L2 = normalize(vec3(-0.8 + sin(t * 0.15) * 0.2, 0.4, 0.8));
      float NdL2 = max(dot(N, L2), 0.0);
      vec3 H2 = normalize(L2 + V);
      float NdH2 = max(dot(N, H2), 0.0);
      float spec2 = pow(NdH2, 45.0);
      float spec2soft = pow(NdH2, 25.0);
      vec3 lightCol2 = vec3(0.85, 0.55, 0.3);

      /* Accent light — gold, moves with the beat. Broadened 90->40. */
      vec3 L3 = normalize(vec3(0.3 + bEnv * 0.3, -0.6, 0.6));
      float NdL3 = max(dot(N, L3), 0.0);
      vec3 H3 = normalize(L3 + V);
      float NdH3 = max(dot(N, H3), 0.0);
      float spec3 = pow(NdH3, 40.0);
      float spec3soft = pow(NdH3, 18.0);
      vec3 lightCol3 = vec3(1.0, 0.7, 0.25);

      /* Top-down fill. */
      vec3 L4 = normalize(vec3(0.0, 0.1, 1.0));
      float NdL4 = max(dot(N, L4), 0.0);

      /* Rim / backlight. */
      float NdV = max(dot(N, V), 0.0);
      float rim = pow(1.0 - NdV, 4.0);
      vec3 rimCol = vec3(0.9, 0.55, 0.2);

      /* Material: metallic gunmetal. Base texture coarsened 30/80 -> 18/40. */
      vec3 baseColor = vec3(0.38, 0.32, 0.25);
      baseColor += vec3(0.035, 0.025, 0.015) * bgNoise(meshUV * 18.0);
      baseColor += vec3(0.02, 0.015, 0.01) * bgNoise(meshUV * 40.0 + 5.0);

      float f0 = 0.75;
      float fres = fresnel(NdV, f0);

      /* Wire material. Diffuse — generous so the wire reads as metal. */
      vec3 diffuse = baseColor * (NdL1 * lightCol1 * 1.0 + NdL2 * lightCol2 * 0.5
                                + NdL3 * lightCol3 * 0.25 + NdL4 * 0.4);
      diffuse += baseColor * 0.18;
      vec3 hemiAmb = mix(vec3(0.04, 0.03, 0.02), vec3(0.08, 0.06, 0.04), N.y * 0.5 + 0.5);
      diffuse += hemiAmb;

      /* Specular — sheen bands (broadened), never pinpoints. */
      vec3 specular = vec3(0.0);
      specular += spec1 * lightCol1 * 3.5;
      specular += spec1med * lightCol1 * 1.2;
      specular += spec1soft * lightCol1 * 0.25;
      specular += spec2 * lightCol2 * 2.5;
      specular += spec2soft * lightCol2 * 0.5;
      specular += spec3 * lightCol3 * 3.0;
      specular += spec3soft * lightCol3 * 0.4;
      specular *= fres;

      /* Beat flare on specular — trimmed 1.0 -> 0.35 (softened, no strobe). */
      specular *= 1.0 + bEnv * 0.35 * BASS_INTENSITY;

      /* Anisotropic edge highlight on the wire ridge. */
      float wireCenter = abs(hexEdge - wireWidth * 0.5) / max(wireWidth, 0.001);
      float aniso = pow(max(1.0 - wireCenter, 0.0), 3.0);
      specular += aniso * wire * vec3(0.55, 0.4, 0.2) * fres * 0.5;

      vec3 wireCol = diffuse + specular;
      wireCol += rim * rimCol * 0.5;
      wireCol += microWire * vec3(0.15, 0.1, 0.06) * fres;

      /* Hole interior — dark void with depth and a beat light-leak. */
      vec3 holeCol = vec3(0.015, 0.01, 0.006);
      float coneRefl = max(dot(N, vec3(0.0, 0.0, 1.0)), 0.0);
      holeCol += vec3(0.03, 0.02, 0.01) * coneRefl;
      float conePush = max(h * 0.4, 0.0);
      holeCol += vec3(0.06, 0.04, 0.02) * conePush;
      /* Warm/copper leak through the grille — trimmed 0.35/0.15 gains, softened. */
      holeCol += vec3(0.2, 0.12, 0.04) * bEnv * 0.35 * BASS_INTENSITY;
      holeCol += vec3(0.12, 0.06, 0.02) * bEnv * 0.15 * BASS_INTENSITY;

      /* Combine wire + hole. */
      vec3 col = mix(holeCol, wireCol, wire);
      col += microWire * vec3(0.02, 0.018, 0.025) * (1.0 - hole * 0.7);

      /* Beat colour wash — alternates amber and copper. */
      vec3 beatColor = mix(vec3(0.5, 0.3, 0.1), vec3(0.4, 0.2, 0.08), sin(t * 0.4) * 0.5 + 0.5);
      col += beatColor * bEnv * 0.03 * BASS_INTENSITY;

      /* Environment reflection on the wire — fake studio HDRI. */
      vec3 refl = reflect(-V, N);
      vec3 envCol = vec3(0.03, 0.03, 0.06);
      envCol += vec3(0.12, 0.08, 0.06) * pow(max(refl.y, 0.0), 2.0);       /* overhead */
      envCol += vec3(0.15, 0.08, 0.03) * pow(max(-refl.x, 0.0), 2.0);      /* side */
      envCol += vec3(0.2, 0.1, 0.04) * pow(max(-refl.y, 0.0), 3.0);        /* copper below */
      float softbox = pow(max(dot(refl, normalize(vec3(0.2, 0.8, 0.5))), 0.0), 8.0);
      envCol += vec3(0.3, 0.28, 0.25) * softbox;
      envCol *= 1.0 + bEnv * 0.5 * BASS_INTENSITY;
      col += envCol * fres * wire * 0.5;

      /* Post — vignette (macro lens) and edge DOF darken. Grain and chromatic
         aberration dropped (bullet-band / cosmetic); see header. */
      vec2 vc = uv - 0.5;
      float vig = smoothstep(0.0, 1.0, 1.0 - dot(vc, vc) * 2.0);
      col *= vig;

      float dofDist = length(cuv);
      float dof = smoothstep(0.3, 0.8, dofDist);
      col = mix(col, col * vec3(0.7, 0.65, 0.75), dof * 0.3);

      /* Reinhard (white 1.5 -> 2.2, holds the specular tail off white), gentle
         gamma, then seal-tier exposure. col clamped >= 0 before pow. */
      col = col / (col + vec3(2.2));
      col = pow(max(col, vec3(0.0)), vec3(0.9));
      return col * EXPOSURE;
    }
  `,
});
