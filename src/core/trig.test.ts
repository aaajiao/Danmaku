import { describe, expect, test } from 'bun:test';
import { atan2Deg, cosDeg, deltaDeg, normalizeDeg, sinDeg } from './trig';

/**
 * The platform's own transcendentals are the oracle here, which looks circular
 * given that this module exists precisely because they are not reproducible.
 * It is not. They are *approximated*, not *wrong*: every engine lands within a
 * few ULP of true, four orders tighter than the 1e-12 target. So they can
 * measure accuracy even though they cannot be trusted to agree bit-for-bit —
 * which is the whole distinction this module turns on.
 */
const TOLERANCE = 1e-12;

const DEG = Math.PI / 180;

describe('sinDeg / cosDeg accuracy', () => {
  test('matches the oracle across a fine sweep of one turn', () => {
    let worstSin = 0;
    let worstCos = 0;
    // A step that is not a divisor of any symmetry boundary, so the sweep
    // lands inside every reduction branch rather than only on its seams.
    for (let d = -720; d <= 720; d += 0.013) {
      worstSin = Math.max(worstSin, Math.abs(sinDeg(d) - Math.sin(d * DEG)));
      worstCos = Math.max(worstCos, Math.abs(cosDeg(d) - Math.cos(d * DEG)));
    }
    expect(worstSin).toBeLessThan(TOLERANCE);
    expect(worstCos).toBeLessThan(TOLERANCE);
  });

  test('is exact on the axes', () => {
    // Exactly zero, and better than the platform: Math.sin(Math.PI) is 1.2e-16,
    // because π is not representable. Reducing in degrees has no such residue.
    //
    // The half turn comes out as -0, since folding sin(d) = -sin(d - 180)
    // negates an exact zero. Only Object.is and division by it can tell the
    // difference, and the sim does neither, so `===` is the assertion that
    // matches what actually matters.
    expect(sinDeg(0)).toBe(0);
    expect(sinDeg(180) === 0).toBe(true);
    expect(cosDeg(90) === 0).toBe(true);
    expect(cosDeg(0)).toBe(1);
    expect(Math.abs(sinDeg(90) - 1)).toBeLessThan(TOLERANCE);
    expect(Math.abs(cosDeg(180) + 1)).toBeLessThan(TOLERANCE);
    expect(Math.abs(sinDeg(270) + 1)).toBeLessThan(TOLERANCE);
  });

  test('holds accuracy at the reduction seams', () => {
    for (const d of [0, 45, 90, 135, 180, 225, 270, 315, 360, -45, -90, -180]) {
      expect(Math.abs(sinDeg(d) - Math.sin(d * DEG))).toBeLessThan(TOLERANCE);
      expect(Math.abs(cosDeg(d) - Math.cos(d * DEG))).toBeLessThan(TOLERANCE);
    }
  });

  test('stays accurate for angles far outside one turn', () => {
    // `theta` accumulates unbounded through `w`; a bullet alive for a long time
    // is routinely thousands of degrees around.
    //
    // The oracle has to be reduced first. `Math.sin(d * DEG)` is not usable at
    // this magnitude because `d * DEG` itself rounds: at d = 1e6 an ULP of the
    // radian product is already ~3e-12, so the reference would be wrong by more
    // than the tolerance being asserted. Reducing in degrees first costs
    // nothing, because normalizeDeg is exact.
    for (const d of [3600.5, -3600.5, 123456.75, -987654.25, 1e7 + 0.5]) {
      const s = Math.sin(normalizeDeg(d) * DEG);
      const c = Math.cos(normalizeDeg(d) * DEG);
      expect(Math.abs(sinDeg(d) - s)).toBeLessThan(TOLERANCE);
      expect(Math.abs(cosDeg(d) - c)).toBeLessThan(TOLERANCE);
    }
  });

  test('beats the platform on large angles', () => {
    // Not a boast — a load-bearing consequence. Reducing in degrees keeps the
    // argument exact, where the platform must first round `d * π/180`. If this
    // ever stops holding, the reduction has silently lost its exactness.
    const d = -987654.25;
    const truth = Math.sin(normalizeDeg(d) * DEG);
    const ours = Math.abs(sinDeg(d) - truth);
    const platform = Math.abs(Math.sin(d * DEG) - truth);
    expect(ours).toBeLessThan(platform);
  });

  test('stays accurate for angles very close to zero', () => {
    for (const d of [1e-6, -1e-6, 1e-12, -1e-12]) {
      expect(Math.abs(sinDeg(d) - Math.sin(d * DEG))).toBeLessThan(TOLERANCE);
    }
  });
});

describe('identities', () => {
  test('sin^2 + cos^2 === 1 within tolerance', () => {
    for (let d = -400; d <= 400; d += 0.37) {
      const s = sinDeg(d);
      const c = cosDeg(d);
      expect(Math.abs(s * s + c * c - 1)).toBeLessThan(TOLERANCE);
    }
  });

  test('a full turn is bit-identical, not merely close', () => {
    // This is the property that makes wrapping safe. If it were only
    // approximate, a bullet that had been alive longer would drift away from
    // an identical one spawned later, and replays would diverge over time.
    //
    // The step is dyadic on purpose. `d + 360` has to be exact for the identity
    // to be testable at all, and 0.31 is not representable — `0.31 + 360` is a
    // slightly different angle, so a failure would be measuring the test's own
    // addition rather than this module.
    //
    // `===` rather than `toBe`, which is Object.is: at the half turn the odd
    // symmetry legitimately produces -0 on one side and +0 on the other. Those
    // differ in bits but are indistinguishable under every operation the sim
    // performs on a sine — add, multiply, compare — so `===` is the honest
    // equality here, and it is what the contract states.
    for (let d = -180; d <= 180; d += 0.25) {
      expect(sinDeg(d + 360) === sinDeg(d)).toBe(true);
      expect(sinDeg(d + 720) === sinDeg(d)).toBe(true);
      expect(cosDeg(d + 360) === cosDeg(d)).toBe(true);
    }
  });

  test('sin is exactly odd', () => {
    for (let d = 0.05; d <= 400; d += 0.29) {
      expect(sinDeg(-d)).toBe(-sinDeg(d));
    }
  });

  test('cos is exactly even', () => {
    for (let d = 0.05; d <= 400; d += 0.29) {
      expect(cosDeg(-d)).toBe(cosDeg(d));
    }
  });

  test('cos leads sin by a quarter turn', () => {
    for (let d = -200; d <= 200; d += 0.43) {
      expect(Math.abs(cosDeg(d) - sinDeg(d + 90))).toBeLessThan(TOLERANCE);
    }
  });
});

describe('atan2Deg', () => {
  test('is exact on the four axes', () => {
    expect(atan2Deg(0, 1)).toBe(0);
    expect(atan2Deg(1, 0)).toBe(90);
    expect(atan2Deg(0, -1)).toBe(180);
    expect(atan2Deg(-1, 0)).toBe(-90);
  });

  test('returns 0 for the degenerate (0, 0)', () => {
    // No meaningful angle exists. NaN would spread from one degenerate entity
    // into every position derived from it, so 0 is the containing answer.
    expect(atan2Deg(0, 0)).toBe(0);
  });

  test('places each quadrant correctly', () => {
    expect(Math.abs(atan2Deg(1, 1) - 45)).toBeLessThan(TOLERANCE);
    expect(Math.abs(atan2Deg(1, -1) - 135)).toBeLessThan(TOLERANCE);
    expect(Math.abs(atan2Deg(-1, -1) + 135)).toBeLessThan(TOLERANCE);
    expect(Math.abs(atan2Deg(-1, 1) + 45)).toBeLessThan(TOLERANCE);
  });

  test('matches the oracle across all quadrants and magnitudes', () => {
    let worst = 0;
    for (let i = -40; i <= 40; i++) {
      for (let j = -40; j <= 40; j++) {
        // Offset off the lattice so the sweep does not only sample nice ratios.
        const y = i * 1.7 + 0.03;
        const x = j * 1.3 - 0.07;
        const expected = (Math.atan2(y, x) * 180) / Math.PI;
        worst = Math.max(worst, Math.abs(atan2Deg(y, x) - expected));
      }
    }
    expect(worst).toBeLessThan(TOLERANCE);
  });

  test('matches the oracle at extreme aspect ratios', () => {
    for (const [y, x] of [
      [1e-9, 1],
      [1, 1e-9],
      [-1e-9, -1],
      [1e8, 3],
      [3, -1e8],
    ] as const) {
      const expected = (Math.atan2(y, x) * 180) / Math.PI;
      expect(Math.abs(atan2Deg(y, x) - expected)).toBeLessThan(TOLERANCE);
    }
  });

  test('stays within (-180, 180]', () => {
    for (let i = -30; i <= 30; i++) {
      for (let j = -30; j <= 30; j++) {
        const a = atan2Deg(i + 0.5, j + 0.5);
        expect(a).toBeGreaterThan(-180);
        expect(a).toBeLessThanOrEqual(180);
      }
    }
  });

  test('resolves the half turn to +180, never -180', () => {
    // The platform returns -180 for a negative-zero y; the stated range
    // excludes it, so signed zero must not leak through.
    expect(atan2Deg(-0, -1)).toBe(180);
    expect(atan2Deg(0, -1)).toBe(180);
  });

  test('round-trips through sinDeg and cosDeg', () => {
    for (let d = -179; d <= 180; d += 1) {
      const back = atan2Deg(sinDeg(d), cosDeg(d));
      expect(Math.abs(back - d)).toBeLessThan(1e-10);
    }
  });
});

describe('normalizeDeg', () => {
  test('wraps into [0, 360)', () => {
    expect(normalizeDeg(0)).toBe(0);
    expect(normalizeDeg(360)).toBe(0);
    expect(normalizeDeg(-360)).toBe(0);
    expect(normalizeDeg(90)).toBe(90);
    expect(normalizeDeg(450)).toBe(90);
    expect(normalizeDeg(-90)).toBe(270);
    expect(normalizeDeg(-450)).toBe(270);
  });

  test('normalizes -0 to +0', () => {
    expect(Object.is(normalizeDeg(-0), 0)).toBe(true);
  });

  test('holds the range for large magnitudes', () => {
    for (const d of [1e6 + 12.5, -1e6 - 12.5, 1e9 + 7, -1e9 - 7, 1e12]) {
      const n = normalizeDeg(d);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(360);
    }
  });

  test('is exactly idempotent', () => {
    for (let d = -1000; d <= 1000; d += 7.3) {
      expect(normalizeDeg(normalizeDeg(d))).toBe(normalizeDeg(d));
    }
  });

  test('subtracting a whole turn is exact', () => {
    // Dyadic step, so that `d + 360` is itself exact and the assertion is about
    // the reduction rather than about the test's own rounding.
    for (let d = 0; d < 360; d += 0.25) {
      expect(normalizeDeg(d + 360)).toBe(normalizeDeg(d));
      expect(normalizeDeg(d + 1440)).toBe(normalizeDeg(d));
    }
  });
});

describe('deltaDeg', () => {
  test('gives the signed shortest turn', () => {
    expect(deltaDeg(0, 90)).toBe(90);
    expect(deltaDeg(90, 0)).toBe(-90);
    expect(deltaDeg(0, 270)).toBe(-90);
    expect(deltaDeg(270, 0)).toBe(90);
    expect(deltaDeg(10, 10)).toBe(0);
  });

  test('crosses the wrap boundary the short way', () => {
    expect(deltaDeg(350, 10)).toBe(20);
    expect(deltaDeg(10, 350)).toBe(-20);
    expect(deltaDeg(-170, 170)).toBe(-20);
  });

  test('resolves a half turn to +180', () => {
    expect(deltaDeg(0, 180)).toBe(180);
    expect(deltaDeg(180, 0)).toBe(180);
    expect(deltaDeg(90, 270)).toBe(180);
  });

  test('stays within (-180, 180] for large magnitudes', () => {
    for (let i = -50; i <= 50; i++) {
      const a = i * 137.5;
      const b = i * -911.3 + 44;
      const d = deltaDeg(a, b);
      expect(d).toBeGreaterThan(-180);
      expect(d).toBeLessThanOrEqual(180);
    }
  });

  test('is unaffected by adding whole turns to either side', () => {
    // Dyadic operands, so the whole turns land exactly and the comparison
    // measures deltaDeg rather than the rounding of `a + 720`.
    for (let i = 0; i < 40; i++) {
      const a = i * 9.75;
      const b = i * -13.25;
      expect(deltaDeg(a + 720, b - 360)).toBe(deltaDeg(a, b));
    }
  });
});

describe('determinism guard', () => {
  /**
   * Only operations IEEE-754 specifies exactly may appear in the output path.
   * `Math.PI` is a constant, and floor/abs/min/max/round/sqrt are exact. Every
   * other `Math` member is implementation-approximated and would reintroduce
   * exactly the cross-engine divergence this module was written to remove.
   */
  const ALLOWED = new Set(['floor', 'abs', 'min', 'max', 'round', 'sqrt', 'PI']);

  /** Strip comments so the prose above may name the very calls it forbids. */
  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  }

  function forbiddenIn(source: string): string[] {
    const found: string[] = [];
    for (const match of stripComments(source).matchAll(/Math\s*\.\s*(\w+)/g)) {
      const member = match[1];
      if (member !== undefined && !ALLOWED.has(member)) found.push(member);
    }
    return found;
  }

  test('the scanner actually detects a violation', () => {
    // An assertion that can only pass is worse than no assertion. Prove the
    // scanner bites before trusting it to guard the real file.
    expect(forbiddenIn('const a = Math.sin(x);')).toEqual(['sin']);
    expect(forbiddenIn('const a = Math . atan2(y, x);')).toEqual(['atan2']);
    expect(forbiddenIn('/* Math.cos */ const a = Math.floor(x);')).toEqual([]);
    expect(forbiddenIn('// Math.tan\nconst a = Math.sqrt(x);')).toEqual([]);
  });

  test('trig.ts calls no implementation-approximated Math member', async () => {
    const source = await Bun.file(new URL('./trig.ts', import.meta.url)).text();
    expect(forbiddenIn(source)).toEqual([]);
  });

  test('trig.ts has not been emptied out from under the guard', () => {
    // The scan above passes trivially on a missing or truncated file.
    expect(typeof sinDeg(1)).toBe('number');
    expect(typeof atan2Deg(1, 1)).toBe('number');
  });
});
