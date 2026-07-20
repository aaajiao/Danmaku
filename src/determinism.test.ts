/**
 * A tree-wide guard on the determinism contract.
 *
 * ## Why this file exists
 *
 * ECMAScript specifies the transcendental `Math` functions as
 * *implementation-approximated*: engines are free to be off by an ULP, and they
 * are. Measured across JavaScriptCore and V8, `sin`, `cos`, `tan`, `atan2`,
 * `exp`, `log` and `hypot` all disagree; only `sqrt` and the basic operators are
 * exactly specified.
 *
 * That disagreement reaches gameplay. `moveX`/`moveY` integrate into position,
 * so a one-ULP difference moves a bullet, and a moved bullet eventually flips a
 * hit test. A flipped hit changes a death, a death changes how many draws come
 * off the `sim` stream, and from there two runs are unrelated rather than close.
 *
 * ## Why a grep, and why here
 *
 * This was fixed once already and the fix was incomplete: `src/sim/motion.ts`
 * was converted while `src/content/patterns.ts` was left calling `Math.atan2`,
 * and the whole suite stayed green. It stayed green because the divergence is
 * *silent* — the RNG draw count was identical across engines, so nothing failed;
 * bullets simply flew along slightly different paths.
 *
 * A behavioural test cannot catch that without running two engines, which no
 * unit suite does. A source scan can, and it catches the next one too — a new
 * module reaching for `Math.sin` fails here rather than shipping.
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Directories whose contents run inside the simulation and therefore must be
 * bit-reproducible. `src/render` is deliberately absent — it draws, it does not
 * decide anything.
 *
 * `game` is here because `run.ts` owns the tick *order* — the sequence of
 * system calls that a replay reproduces — and settles score, drops, deaths and
 * boss transitions. It is simulation by every test this guard applies, and it
 * was outside the scan while holding the most decision-making code in the
 * project: the guard would have reported green on a `Math.atan2` in the aim
 * target, which is the exact regression its header describes.
 */
const SIMULATION_TREES = ['sim', 'content', 'core', 'game'];

/**
 * Math members the spec permits an engine to approximate. `sqrt` is absent
 * because IEEE-754 requires it to be correctly rounded, as are `+ - * /`.
 * `abs`, `floor`, `ceil`, `round`, `sign`, `min`, `max`, `trunc` are exact.
 */
const APPROXIMATED = [
  'sin', 'cos', 'tan',
  'asin', 'acos', 'atan', 'atan2',
  'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
  'exp', 'expm1', 'log', 'log2', 'log10', 'log1p',
  'pow', 'cbrt', 'hypot', 'fround',
] as const;

/**
 * Deliberate exceptions, each with the reason it is safe.
 *
 * An entry here is a claim that the file's approximated math never influences
 * simulation state. Adding one should require making that argument, which is
 * why they live in the test rather than in a comment at the call site.
 */
const ALLOWED: Readonly<Record<string, string>> = {
  // Particle scatter, drawn from the `fx` stream and never read by the sim.
  // Verified structurally: effects.ts imports only `fx`, and no simulation
  // module imports effects.ts.
  'sim/effects.ts': 'cosmetic particles on the fx stream',
};

function tsFilesUnder(dir: string): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out = out.concat(tsFilesUnder(path));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(path);
    }
  }
  return out;
}

/**
 * Strip comments and string literals before scanning.
 *
 * Without this the guard trips on its own prose — every one of these modules
 * explains in a comment why it does not call `Math.sin`. A guard that cannot be
 * documented next to the thing it guards is a guard people delete.
 */
function stripNonCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:\\.|[^`\\])*`/g, ' ')
    .replace(/'(?:\\.|[^'\\])*'/g, ' ')
    .replace(/"(?:\\.|[^"\\])*"/g, ' ');
}

/** Approximated Math members actually called in `source`. */
function forbiddenIn(source: string): string[] {
  const code = stripNonCode(source);
  const found = new Set<string>();
  for (const name of APPROXIMATED) {
    // Tolerate whitespace around the dot: `Math . sin(x)` is legal JS.
    if (new RegExp(`\\bMath\\s*\\.\\s*${name}\\s*\\(`).test(code)) found.add(name);
  }
  return [...found].sort();
}

const SRC = new URL('.', import.meta.url).pathname;

describe('the simulation contains no engine-approximated math', () => {
  const offenders: string[] = [];

  for (const tree of SIMULATION_TREES) {
    for (const file of tsFilesUnder(join(SRC, tree))) {
      const relative = file.slice(SRC.length);
      const found = forbiddenIn(readFileSync(file, 'utf8'));
      if (found.length > 0 && ALLOWED[relative] === undefined) {
        offenders.push(`${relative}: Math.${found.join(', Math.')}`);
      }
    }
  }

  test('no simulation module calls an approximated Math function', () => {
    expect(offenders).toEqual([]);
  });

  test('the trees it scans actually exist and contain code', () => {
    // A typo in SIMULATION_TREES would make this suite pass by scanning nothing,
    // which is the failure mode a source-scanning guard is most prone to.
    for (const tree of SIMULATION_TREES) {
      expect(tsFilesUnder(join(SRC, tree)).length).toBeGreaterThan(0);
    }
  });

  test('every allowlist entry names a file that still exists', () => {
    for (const relative of Object.keys(ALLOWED)) {
      expect(() => statSync(join(SRC, relative))).not.toThrow();
    }
  });
});

describe('the scanner itself', () => {
  // The guard is only worth what its detector is worth, so the detector is
  // tested against the shapes it has to survive.
  test('detects a direct call', () => {
    expect(forbiddenIn('const a = Math.sin(x);')).toEqual(['sin']);
  });

  test('detects whitespace around the member access', () => {
    expect(forbiddenIn('const a = Math . atan2(y, x);')).toEqual(['atan2']);
  });

  test('ignores mentions in block and line comments', () => {
    expect(forbiddenIn('/* Math.cos(x) */ const a = 1;')).toEqual([]);
    expect(forbiddenIn('// Math.tan(x)\nconst a = 1;')).toEqual([]);
  });

  test('ignores mentions inside strings and templates', () => {
    expect(forbiddenIn('const s = "Math.sin(x)";')).toEqual([]);
    expect(forbiddenIn('const s = `Math.log(x)`;')).toEqual([]);
  });

  test('permits the exactly-specified members', () => {
    expect(
      forbiddenIn('Math.sqrt(a); Math.abs(b); Math.floor(c); Math.max(d, e);'),
    ).toEqual([]);
  });

  test('permits constants, which are not calls', () => {
    expect(forbiddenIn('const r = t * Math.PI; const h = Math.SQRT1_2;')).toEqual([]);
  });

  test('reports several distinct offenders from one file', () => {
    expect(forbiddenIn('Math.sin(a); Math.hypot(b, c); Math.sin(d);')).toEqual([
      'hypot',
      'sin',
    ]);
  });

  // The regression that motivated the whole file.
  test('would have caught the aimAngle miss', () => {
    const before = 'return Math.atan2(context.targetY - context.y, dx) / DEG;';
    expect(forbiddenIn(before)).toEqual(['atan2']);
  });
});
