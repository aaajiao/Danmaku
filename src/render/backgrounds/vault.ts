/**
 * `vault` — stage 4, the bottom of the descent. A coffered dome seen from
 * within, looking up, its rings of gold coffers pressing slowly inward toward a
 * dark central oculus — the empty seat the whole apparatus was built over.
 *
 * ## Concentric, the fourth of four spaces, distinct from all three priors
 *
 * `expanse` is an open plane converging on a horizon; `undertow` is a forward
 * shaft; `stratum` is horizontal bands settling downward. This is none of them:
 * it is **concentric**, and it does not travel. The rings contract in place and
 * the whole field turns faintly about its centre — the seal forever pressing,
 * never closing. The descent is over; there is nowhere further down, and the
 * shape says so.
 *
 * There is deliberately **no perspective divide** here — no `depth = SCALE / r`,
 * the trick `undertow` leans on. A projection running to infinity samples noise
 * faster than the pixel grid can carry, which is the run-to-infinity aliasing
 * both perspective scenes have to decay their structure to fight. This scene has
 * no vanishing point at all: `r` and the angle are read straight, so that class
 * of seam never arises. It is why a concentric dome is safer than reusing a
 * polar shaft for the densest fight in the game.
 *
 * ## Structure — coffers, coarse by an order of magnitude
 *
 * - Coffers: `sin((r + uScroll * CONTRACT_RATE) * RING_FREQ)`, tuned to roughly
 *   five rings across the field so the band period is an order of magnitude
 *   coarser than a bullet. Adding scroll to the radial axis pulls a fixed ring
 *   to smaller `r` over time — the coffers contract inward.
 * - Ribs: `sin(angle * RIB_FREQ)` with `RIB_FREQ` an **integer**, so the angular
 *   wrap from +pi to -pi closes seamlessly — the `undertow` flute lesson. The
 *   grain is sampled against the rib value, never the raw angle, so nothing can
 *   crack along the ray where `atan` wraps.
 * - Rotation: a single slow term, `angle + uScroll * ROT_RATE` — the field turns
 *   in place, it does not spin.
 *
 * ## The two crowded zones stay smooth and dark
 *
 * Two zones are where bullets crowd: the **central oculus**, where the Regent
 * stations, and the **top entry lane**, where trash enters. Detail decays faster
 * than glow toward *both* — `nearC * nearC` on the radial axis toward the centre
 * and `nearTop * nearTop` on the vertical toward the top — so the finest coffers
 * have dissolved into a smooth dark well before they reach where bullets form.
 * The oculus itself darkens toward zero: the empty seat reads as absence, and
 * the dense zone is a smooth dark backdrop the amber-tinted boss sprite reads
 * cleanly against. Same doctrine as the three scenes before it, on two axes at
 * once.
 *
 * ## Palette — dim gold / amber
 *
 * The colour of the seal, of wax and brass, of authority itself. It reads
 * R > G > B with G about 0.7 of R — a clear yellow-gold at R/G near 1.4. Chosen
 * relationally, exactly as the three before it: it must not be mistaken for
 * `expanse`'s ice-blue, `undertow`'s indigo, or `stratum`'s green-dominant
 * verdigris, and above all it sits **far from `surge`'s red** (surge measures
 * R/G near 3, a magenta-red; vault sits near R/G 1.4, gold) so a spell card's
 * cross-fade to `surge` still reads as the fight changing gear, not the lights
 * coming up. It reads *terminal*.
 *
 * ## Clock
 *
 * Driven by `uScroll` only, which advances in `step()` and nowhere else. No
 * `performance.now`, no wall clock — a pure function of accumulated ticks, so a
 * replay looks identical twice (see `background.ts`, rule 1).
 * `backgrounds/index.test.ts` scans this file for wall-clock sources.
 *
 * ## Numbers
 *
 * Measured live in `bun run dev` from the scene's own GLSL rendered to a WebGL
 * framebuffer, with `__background.name === 'vault'` verified BEFORE reading a
 * pixel (the stage-3 lesson). A plain backbuffer stores `gl_FragColor` as-is, so
 * the bytes are the linear shader output and the luminance figures are Rec.709 on
 * that output — the same space `stratum` (0.07-0.09), `expanse` (0.09) and
 * `undertow` (0.07) quote theirs in:
 *
 *   - Peak luminance measures **0.073**, swept across `uScroll` phases so a crest
 *     is always in frame — under the 0.1 `background.ts` asks for, and the darkest
 *     scene in the game. Mid-field median ~0.041, 99th percentile ~0.066. The two
 *     crowded zones fall away as designed: the top entry lane measures ~0.036 and
 *     the oculus ~0.012, both smooth dark wells the amber-tinted boss reads
 *     against. (The analytic crest from the constants is ~0.08 — `lit` approaches
 *     `DEEP + LIFT` — and the live peak sits below it because `grain` and
 *     `lattice` never crest together and `detail` rarely reaches 1 at the
 *     brightest ring.)
 *   - Coffer period measures **~106-108px** by autocorrelation of a detrended
 *     radial luminance profile (the raw profile rides a monotonic `light` ramp
 *     that has to be high-passed out first), against the analytic 112 (`RING_FREQ`
 *     36 over a 640px field puts about five to six rings across it) — an order of
 *     magnitude coarser than a 16-30px bullet.
 *   - Palette relation holds on the framebuffer: R/G at the crest measures **1.39**
 *     (gold), against the analytic 1.42 (`0.085/0.060`), clear of the three prior
 *     scenes and far from `surge`'s red.
 *   - One coffer presses past a fixed radius about every 218 ticks
 *     (`RING_FREQ * CONTRACT_RATE * scrollSpeed` = 36 * 0.0016 * 0.5 = 0.0288
 *     rad/tick) — computed, since a rate needs video not a still: the slowest
 *     structured motion in the game, matched to the terminal register — the seal
 *     pressing, never closing.
 *
 * The capture is of the shader's raw output (pre-bloom); bloom only adds glow
 * above this floor and cannot lower it, so the sub-0.1 result holds on screen.
 */

import { BACKGROUND_NOISE_GLSL, defineBackground } from '../background';

defineBackground('vault', {
  scrollSpeed: 0.5,
  fragment: /* glsl */ `
${BACKGROUND_NOISE_GLSL}

    /* Rings across the field. 36 puts about six coffers across the diameter (36 /
       2pi), each spanning roughly a sixth of the 640px field -- about 110px, an
       order of magnitude coarser than a bullet. */
    const float RING_FREQ = 36.0;

    /* Radial advance per unit of scroll. along = r + uScroll * CONTRACT_RATE, so
       a fixed ring drifts to smaller r as scroll grows -- the coffers pressing
       inward. Deliberately tiny: at scrollSpeed 0.5 the ring phase advances
       RING_FREQ * CONTRACT_RATE * 0.5 = 0.0288 rad/tick, one coffer past a fixed
       radius about every 218 ticks. The slowest structured motion in the game. */
    const float CONTRACT_RATE = 0.0016;

    /* Radial ribs. Integer, or the angular wrap from +pi to -pi stops closing and
       a crack runs out of the centre (the undertow flute lesson). Eight ribs give
       the dome a built read a plain field should not have. */
    const float RIB_FREQ = 8.0;

    /* The faint secondary turn. The dome rotates in place -- it does not spin --
       so this is smaller still than the contraction. */
    const float ROT_RATE = 0.0009;

    /* How fast structure decays toward each crowded zone, relative to the glow.
       Larger means the smooth dark well reaches further out from the centre / down
       from the top lane. Detail uses the square of each, glow uses the first power,
       so detail always dies first -- the doctrine every scene shares. */
    const float CENTER_FALLOFF = 3.4;
    const float TOP_FALLOFF = 2.6;

    /* Dim gold / amber -- the seal, wax, brass. R > G > B with G ~ 0.7 R, a clear
       yellow-gold. See the header for why the hue is chosen against expanse's
       ice-blue, undertow's indigo, stratum's verdigris, and above all surge's
       red. */
    const vec3 HAZE = vec3(0.010, 0.007, 0.002);
    const vec3 DEEP = vec3(0.022, 0.016, 0.005);
    const vec3 LIFT = vec3(0.085, 0.060, 0.018);

    vec3 background(vec2 uv) {
      float aspect = uRes.x / uRes.y;

      /* Centred on the oculus, aspect-corrected so the coffers stay circular. */
      vec2 c = (uv - vec2(0.5, 0.5)) * vec2(aspect, 1.0);
      float r = length(c);
      float a = atan(c.y, c.x);

      /* Coffers contract inward: adding scroll to the radial axis pulls a fixed
         ring to smaller r over time. */
      float along = r + uScroll * CONTRACT_RATE;
      float coffers = 0.5 + 0.5 * sin(along * RING_FREQ);

      /* Ribs, turned slowly in place. Periodic in the angle, so it survives the
         atan wrap unbroken. */
      float ribs = 0.5 + 0.5 * sin((a + uScroll * ROT_RATE) * RIB_FREQ);

      /* The coffer grid: rings crossed with ribs. */
      float lattice = coffers * ribs;

      /* Grain sampled against the rib value rather than the raw angle, so it
         inherits the ribs' periodicity and cannot shear across the wrap -- the
         same trick undertow and stratum use. */
      float grain = bgFbm(vec2(ribs * 2.2, along * 3.0));

      /* The two crowded zones. nearC is 0 at the oculus and grows outward; nearTop
         is 0 at the top entry lane and grows downward. Both cap at 1. */
      float nearC = clamp(r * CENTER_FALLOFF, 0.0, 1.0);
      float nearTop = clamp(uv.y * TOP_FALLOFF, 0.0, 1.0);

      /* Brightness falls gently toward the oculus (which darkens toward zero -- the
         empty seat as absence); detail falls far faster, and toward the top lane as
         well, so the finest coffers dissolve into a smooth dark well before they
         reach where bullets crowd. */
      float light = clamp(0.20 + 0.80 * nearC, 0.0, 1.0);
      float detail = nearC * nearC * nearTop * nearTop;

      vec3 lit = DEEP + LIFT * (0.30 + detail * (0.45 * grain + 0.30 * lattice));
      return mix(HAZE, lit, light);
    }
  `,
});
