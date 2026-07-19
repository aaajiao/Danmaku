/**
 * Deterministic trigonometry in degrees. The simulation's only trig.
 *
 * ## Why this module exists
 *
 * ECMAScript specifies `Math.sin`, `Math.cos` and `Math.atan2` as
 * *implementation-approximated*: an engine may return any value within an
 * unspecified tolerance, and engines disagree. Measured on this project, JSC
 * and V8 differ on 250 of 6000 sin/cos results by 1 ULP. That is enough. A
 * bundled 1200-tick run ended with 28 of 157 bullets at different coordinates,
 * and 4000 boundary hit-tests disagreed 81 times. A flipped hit-test changes a
 * death, a death changes how many draws the `sim` stream makes, and after one
 * extra draw the two runs are unrelated — not "slightly off", unrelated.
 *
 * Determinism is the product (CLAUDE.md, rule 2). So the sim cannot call the
 * platform's transcendentals at all.
 *
 * IEEE-754 `+ - * /` and `sqrt` *are* exactly specified, and ECMAScript
 * inherits that: correctly rounded, one representable answer, identical on
 * every conforming engine. Anything built from only those operations is
 * bit-reproducible by construction. That is the entire basis of this file.
 *
 * ## What is allowed in the output path
 *
 * `+ - * /`, `Math.floor`, `Math.abs`, `Math.min`, `Math.max`, `Math.round`
 * (all exact) and `Math.sqrt` (IEEE-exact). Nothing else. `trig.test.ts`
 * greps this source and fails on any other `Math.*`, so the rule outlives
 * anyone's memory of it.
 *
 * ## Approach: polynomials, not a table
 *
 * A lookup table built at load with `Math.sin` would defeat the entire
 * purpose — the *table* would then differ per engine, and we would have moved
 * the divergence rather than removed it. A table of shipped literals does not
 * have that flaw but does not pay for itself either: `theta` is continuous
 * (it accumulates through `w` in fractional steps), so any table needs
 * interpolation, and interpolation accurate to 1e-12 needs a polynomial
 * correction anyway. Having paid for the polynomial, the table only adds a
 * cache miss.
 *
 * So: exact range reduction in degrees, then a Taylor polynomial over a range
 * small enough that truncation lands near machine epsilon.
 *
 * Every coefficient is written as a quotient of small integers (`-1 / 6`,
 * `1 / 120`, …). Division is correctly rounded, so these evaluate to the same
 * bits everywhere, and unlike a pasted 17-digit decimal they cannot be
 * silently mistyped.
 *
 * ## Cost
 *
 * `sinDeg`/`cosDeg` are a reduction plus 8 multiply-adds; `atan2Deg` is two
 * divisions plus 10. No allocation, no memory traffic, no data-dependent
 * branch beyond the three-way band pick.
 *
 * Measured on Bun 1.3 / JSC, warm, best-of-five over 4M calls:
 *
 *   sinDeg      2.9 ns      Math.sin(x * DEG)    2.4 ns
 *   cosDeg      3.2 ns      Math.cos(x * DEG)    2.4 ns
 *   atan2Deg    5.7 ns      Math.atan2           9.1 ns
 *
 * So sin/cos cost about 1.3x the platform intrinsic, and atan2 is outright
 * cheaper than the one it replaces. At a few thousand bullets a tick that is
 * single-digit microseconds a frame — not a budget worth trading determinism
 * for. Upstream's `TODO.txt` wanted a "sin, cos, tan cache" and never built
 * one; at 3 ns a call the cache was never the interesting part, and a table
 * that missed cache would lose to this outright.
 *
 * ## Accuracy
 *
 * Measured worst case over a 2M-point sweep of [-720°, 720°], against the
 * platform's transcendentals as oracle:
 *
 *   sinDeg, cosDeg    1.1e-15 absolute
 *   atan2Deg          5.7e-14 absolute
 *
 * Both inside the 1e-12 target. atan2 is the looser of the two only because
 * the answer is reported in degrees: a 1e-15 error in radians is multiplied by
 * 57.3 on the way out, and the oracle's own radian-to-degree conversion
 * contributes a comparable share of what is being measured.
 *
 * Past about 1e5 degrees this module is *more* accurate than the platform, not
 * less. Reduction happens in degrees, where it is exact, whereas `Math.sin`
 * must first round `x * π/180` — at 1e6 degrees that rounding alone is ~1e-12.
 * `trig.test.ts` asserts this rather than assuming it.
 */

/**
 * `Math.PI / 180` and its inverse, as literals. `Math.PI` is a constant (the
 * double nearest π, uniquely determined) so deriving these at load would also
 * be deterministic — they are written out only so that a grep for `Math.` in
 * this file returns nothing that needs a second look.
 */
const DEG_TO_RAD = 0.017453292519943295;
const RAD_TO_DEG = 57.29577951308232;

// sin(x) on |x| <= π/4, Taylor through x^15. Truncation < 5e-17.
const S3 = -1 / 6;
const S5 = 1 / 120;
const S7 = -1 / 5040;
const S9 = 1 / 362880;
const S11 = -1 / 39916800;
const S13 = 1 / 6227020800;
const S15 = -1 / 1307674368000;

// cos(x) on |x| <= π/4, Taylor through x^16. Truncation < 3e-18.
const C2 = -1 / 2;
const C4 = 1 / 24;
const C6 = -1 / 720;
const C8 = 1 / 40320;
const C10 = -1 / 3628800;
const C12 = 1 / 479001600;
const C14 = -1 / 87178291200;
const C16 = 1 / 20922789888000;

// atan(u) on |u| <= tan(7.5°), Taylor through u^19. Truncation < 2e-20.
const T3 = -1 / 3;
const T5 = 1 / 5;
const T7 = -1 / 7;
const T9 = 1 / 9;
const T11 = -1 / 11;
const T13 = 1 / 13;
const T15 = -1 / 15;
const T17 = 1 / 17;
const T19 = -1 / 19;

/**
 * Tangents of the three band centres atan2 reduces to, and the two band
 * edges. Correctly-rounded literals for tan(7.5°), tan(22.5°), tan(37.5°);
 * tan(22.5°) is exactly √2 − 1.
 *
 * The centres carry a 1-ULP error, which enters the result as the difference
 * between the literal degree constant and the true `atan` of the literal
 * tangent — about 1e-16 degrees, four orders below the accuracy target. The
 * edges are only branch thresholds: near one, either neighbouring band gives
 * a valid reduction, so their accuracy does not matter at all.
 */
const TAN_7_5 = 0.13165249758739583;
const TAN_15 = 0.2679491924311227;
const TAN_22_5 = 0.4142135623730951;
const TAN_30 = 0.5773502691896256;
const TAN_37_5 = 0.7673269879789604;

/**
 * Wrap to [0, 360).
 *
 * Exact for every input the simulation can produce. `360` is representable, so
 * `360 * floor(d / 360)` is exact while the quotient stays under 2^47, and the
 * subtraction of two values that close is exact by construction — the result
 * is a multiple of `ulp(d)` smaller than 360, so it is representable. That
 * exactness is what makes `sinDeg(x + 360)` bit-identical to `sinDeg(x)`
 * rather than merely close.
 *
 * The clamps catch the one case the algebra cannot: `d / 360` is a rounded
 * division, so for `d` just below a multiple of 360 it can round up to the
 * integer above and push the result a hair outside the range.
 */
export function normalizeDeg(degrees: number): number {
  let d = degrees - 360 * Math.floor(degrees / 360);
  if (d < 0) d += 360;
  if (d >= 360) d -= 360;
  return d;
}

/** sin(x) for |x| <= π/4, radians. */
function sinCore(x: number): number {
  const x2 = x * x;
  return (
    x *
    (1 +
      x2 *
        (S3 +
          x2 * (S5 + x2 * (S7 + x2 * (S9 + x2 * (S11 + x2 * (S13 + x2 * S15)))))))
  );
}

/** cos(x) for |x| <= π/4, radians. */
function cosCore(x: number): number {
  const x2 = x * x;
  return (
    1 +
    x2 *
      (C2 +
        x2 *
          (C4 +
            x2 *
              (C6 + x2 * (C8 + x2 * (C10 + x2 * (C12 + x2 * (C14 + x2 * C16)))))))
  );
}

/**
 * sin of an angle already wrapped to [0, 360).
 *
 * Folds to [0°, 45°] through the half-turn and quarter-turn symmetries, both
 * of which are exact subtractions on this range, then evaluates whichever
 * polynomial keeps the argument small. Above 45° that is `cos` of the
 * complement, since sin(d) = cos(90 − d).
 */
function sinNormalized(normalized: number): number {
  let d = normalized;
  let sign = 1;
  if (d >= 180) {
    d -= 180;
    sign = -1;
  }
  if (d > 90) d = 180 - d;
  if (d > 45) return sign * cosCore((90 - d) * DEG_TO_RAD);
  return sign * sinCore(d * DEG_TO_RAD);
}

/**
 * Sine of an angle in DEGREES. The simulation's angular unit.
 *
 * The sign is stripped before wrapping rather than after, which makes
 * `sinDeg(-x) === -sinDeg(x)` hold bit-exactly for every input instead of
 * only for those where wrapping a negative happens to stay lossless.
 */
export function sinDeg(degrees: number): number {
  if (degrees < 0) return -sinNormalized(normalizeDeg(-degrees));
  return sinNormalized(normalizeDeg(degrees));
}

/**
 * Cosine of an angle in DEGREES.
 *
 * cos(x) = sin(x + 90) on the folded-to-positive argument, cos being even. The
 * quarter turn is added *after* wrapping: adding it first would round away for
 * large `theta`, where `ulp` already exceeds 90 degrees.
 */
export function cosDeg(degrees: number): number {
  let d = normalizeDeg(Math.abs(degrees)) + 90;
  if (d >= 360) d -= 360;
  return sinNormalized(d);
}

/**
 * atan(t) in degrees for t in [0, 1], result in [0°, 45°].
 *
 * Reduced to one of three 15°-wide bands by the tangent difference identity
 * atan(t) = C + atan((t − tan C) / (1 + t·tan C)), which leaves the polynomial
 * argument inside ±tan(7.5°). At that width the plain alternating series
 * reaches 1e-20 in ten terms; on [0, 1] undivided it would need forty and
 * still be worse.
 */
function atanUnitDeg(t: number): number {
  let centre: number;
  let tangent: number;
  if (t <= TAN_15) {
    centre = 7.5;
    tangent = TAN_7_5;
  } else if (t <= TAN_30) {
    centre = 22.5;
    tangent = TAN_22_5;
  } else {
    centre = 37.5;
    tangent = TAN_37_5;
  }

  const u = (t - tangent) / (1 + t * tangent);
  const u2 = u * u;
  const series =
    u *
    (1 +
      u2 *
        (T3 +
          u2 *
            (T5 +
              u2 *
                (T7 +
                  u2 * (T9 + u2 * (T11 + u2 * (T13 + u2 * (T15 + u2 * (T17 + u2 * T19)))))))));
  return centre + series * RAD_TO_DEG;
}

/**
 * Returns DEGREES in (-180, 180].
 *
 * The magnitudes are divided smaller-over-larger so the quotient never exceeds
 * 1, which keeps the reduction in its accurate range and avoids an overflow
 * when `x` is tiny. Signed zero in `y` is deliberately not distinguished:
 * `atan2(-0, -1)` is -180° in the platform's convention, which the stated
 * range excludes, so treating -0 as 0 is what keeps the contract honest.
 *
 * (0, 0) returns 0. It has no meaningful angle, and returning NaN would let a
 * single degenerate entity poison a whole frame of positions.
 */
export function atan2Deg(y: number, x: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);

  // The axes are special-cased so they come out exact. The band reduction
  // would leave atan(0) as a ~1e-16 residue, and an enemy aimed straight right
  // reading 0.0000000000000001 degrees is a needless wart on every fixture.
  // This also absorbs (0, 0).
  let reference: number;
  if (ay === 0) {
    reference = 0;
  } else if (ax === 0) {
    reference = 90;
  } else if (ay > ax) {
    reference = 90 - atanUnitDeg(ax / ay);
  } else {
    reference = atanUnitDeg(ay / ax);
  }

  if (x >= 0) return y >= 0 ? reference : -reference;
  return y >= 0 ? 180 - reference : reference - 180;
}

/**
 * Signed shortest turn from `a` to `b`, in (-180, 180].
 *
 * A half turn resolves to +180, not -180, so the result stays in the stated
 * range and turning is reproducible rather than depending on which way a
 * rounding fell.
 */
export function deltaDeg(a: number, b: number): number {
  const d = normalizeDeg(b - a);
  return d > 180 ? d - 360 : d;
}
