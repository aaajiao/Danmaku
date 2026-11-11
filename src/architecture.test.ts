/**
 * The import boundary, enforced.
 *
 * CLAUDE.md states it under "Repository layout": `src/sim/`, `src/content/`,
 * `src/game/` and `src/v4/gameplay/` must not import from `src/render/`. Until
 * this file, **nothing checked it**.
 * The rule was written down, obeyed by hand for the life of the project, and one
 * careless import away from being false with every test still green — because
 * the thing it protects is not correctness. It is the ability to run the
 * simulation at all without a GL context, and that only fails once someone tries.
 *
 * ## Type-only imports are allowed, and the distinction is the whole point
 *
 * `import type` erases completely. It creates no runtime edge, pulls no three.js
 * into a headless run, and cannot drag a `WebGLRenderingContext` into a test
 * process. `src/sim/effects.ts` uses one to borrow `BulletCell` — a string union
 * naming atlas cells — and borrowing that name is better than duplicating it,
 * because two copies of a list of sprite names drift apart silently.
 *
 * So what is banned here is a **runtime** import, which is what the rule was
 * always about. A value import of anything under `src/render` fails this test.
 *
 * Anyone tempted to relax that: the escape hatch already exists and costs
 * nothing. If you need a *type* from the renderer, say `import type`. If you
 * need a *value* from it, the design is wrong — which is what the layout section
 * means by "the design is wrong, not the rule". The fix is to invert the
 * dependency, most often by having content name the thing as a string and
 * letting the shell resolve it. `StageSpec.background` is exactly that pattern.
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';

const ROOT = new URL('.', import.meta.url).pathname;

/**
 * Trees whose modules must be runnable with no renderer present.
 *
 * CLAUDE.md names all four trees because each must remain executable without a
 * GL context. `src/game/` owns the headless run/replay orchestration, while
 * `src/v4/gameplay/` owns this edition's compiled pattern and behaviour
 * registrations. A runtime renderer edge in any one of them would spend the
 * same headless-simulation guarantee.
 */
const HEADLESS_TREES = ['sim', 'content', 'game', 'v4/gameplay'];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = `${dir}/${entry}`;
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
      continue;
    }
    if (!entry.endsWith('.ts')) continue;
    // Tests are scanned too, and that is the deliberate choice.
    //
    // Exempting them is tempting — a test importing the renderer cannot break a
    // production build. But the only value import that ever survived in this
    // repository was in a test (`content/index.test.ts` pulled in
    // `backgroundNames`), and it survived precisely because it looked harmless.
    // It was not: the property being protected is that a headless run needs no
    // renderer, and `bun test` is the headless run. A test that drags three.js
    // in has already spent the thing the rule was buying.
    out.push(path);
  }
  return out;
}

/**
 * Every import of a `render` module, tagged with whether it is type-only.
 *
 * Deliberately crude — a regex over source rather than a parse. The alternative
 * is a TypeScript program in a unit test, and the thing being detected is a
 * literal line someone typed. A comment mentioning the path is not an import, so
 * only lines beginning with `import` or `export` are considered.
 */
function renderImports(source: string): { line: string; typeOnly: boolean }[] {
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(import|export)\b/.test(line))
    .filter((line) => /['"][^'"]*\brender\//.test(line))
    .map((line) => ({ line, typeOnly: erasesCompletely(line) }));
}

/**
 * Whether an import line leaves nothing behind after type erasure.
 *
 * Two forms qualify: the whole clause marked `import type {...}`, or every
 * specifier in the brace list individually marked `type`. A list with even one
 * unmarked specifier emits a real `require`, so it counts as a runtime edge —
 * which is why a mixed import is treated as an offence rather than pro-rated.
 *
 * A bare `import './x'` has no brace list and is the most runtime-y import
 * there is: it exists purely for its side effects.
 */
function erasesCompletely(line: string): boolean {
  if (/^(import|export)\s+type\b/.test(line)) return true;

  const braces = /\{([^}]*)\}/.exec(line);
  const inner = braces?.[1];
  if (inner === undefined) return false;

  const specifiers = inner
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return specifiers.length > 0 && specifiers.every((s) => /^type\s/.test(s));
}

describe('the simulation does not depend on the renderer at runtime', () => {
  test.each(HEADLESS_TREES)('src/%s imports no renderer value', (tree) => {
    const offences: string[] = [];

    for (const path of sourceFiles(`${ROOT}${tree}`)) {
      const source = readFileSync(path, 'utf8');
      for (const found of renderImports(source)) {
        if (found.typeOnly) continue;
        offences.push(`${path.slice(ROOT.length)}: ${found.line}`);
      }
    }

    expect(offences).toEqual([]);
  });

  test('the type-only escape hatch is genuinely in use, not theoretical', () => {
    // If this ever goes to zero the exemption above can be deleted and the rule
    // tightened to ban every mention of `render/` outright. Keeping the test
    // honest about which of the two worlds we are in costs one assertion.
    const withTypeImports = HEADLESS_TREES.flatMap((tree) => sourceFiles(`${ROOT}${tree}`))
      .filter((path) => renderImports(readFileSync(path, 'utf8')).some((i) => i.typeOnly));

    expect(withTypeImports.length).toBeGreaterThan(0);
  });
});

/**
 * A guard that can fail — the discipline every other check in this repository
 * is held to. A scanner nobody has seen reject anything is a scanner that might
 * be matching nothing at all.
 */
describe('the scanner detects what it claims to', () => {
  test('a value import of a render module is an offence', () => {
    const found = renderImports(`import { Layer } from '../render/stage';`);
    expect(found).toHaveLength(1);
    expect(found[0]?.typeOnly).toBe(false);
  });

  test('a type-only import is not', () => {
    const found = renderImports(`import type { BulletCell } from '../render/procedural';`);
    expect(found).toHaveLength(1);
    expect(found[0]?.typeOnly).toBe(true);
  });

  test('an inline type specifier is not', () => {
    const found = renderImports(`import { type BulletCell } from '../render/procedural';`);
    expect(found[0]?.typeOnly).toBe(true);
  });

  test('a mixed import is an offence, because half of it survives erasure', () => {
    const found = renderImports(`import { type BulletCell, Atlas } from '../render/atlas';`);
    expect(found[0]?.typeOnly).toBe(false);
  });

  test('prose naming the path is not an import', () => {
    expect(renderImports(` * see render/background.ts for why`)).toEqual([]);
    expect(renderImports(`// registering one means importing render/background`)).toEqual([]);
  });
});

/**
 * `src/packs` is browser-side and its boundary is **total** — stricter than the
 * render one above.
 *
 * The pack loader fetches over the network, decodes images against a canvas and
 * touches the DOM; none of that can exist in a headless run. But the deeper
 * reason is the same one `StageSpec.background` is a string: pack identity
 * reaches the simulation as a plain `name@hash` in replay meta and nowhere else.
 * There is no shared type worth coupling to, so unlike `render/` — where a
 * type-only import erases and is allowed — even a type import of `src/packs`
 * from sim, content or game is an offence. The shell computes pack identity and
 * passes it across as text; the sim never learns a pack exists.
 *
 * Deliberately crude for the same reason `renderImports` is: the thing detected
 * is a literal line someone typed, and a regex sees it without a TypeScript
 * program in a unit test.
 */
function packsImports(source: string): string[] {
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(import|export)\b/.test(line))
    .filter((line) => /['"][^'"]*\bpacks\//.test(line));
}

describe('the simulation does not depend on the pack loader', () => {
  test.each(HEADLESS_TREES)('src/%s imports nothing from src/packs', (tree) => {
    const offences: string[] = [];

    for (const path of sourceFiles(`${ROOT}${tree}`)) {
      const source = readFileSync(path, 'utf8');
      for (const line of packsImports(source)) {
        offences.push(`${path.slice(ROOT.length)}: ${line}`);
      }
    }

    expect(offences).toEqual([]);
  });
});

describe('the packs scanner detects what it claims to', () => {
  test('a value import of a packs module is an offence', () => {
    expect(packsImports(`import { validateManifest } from '../packs/manifest';`)).toHaveLength(1);
  });

  test('a type-only import is an offence too, because the boundary is total', () => {
    // The exemption that makes a render type-import safe does NOT apply here.
    expect(packsImports(`import type { PackManifest } from '../packs/manifest';`)).toHaveLength(1);
  });

  test('prose naming the path is not an import', () => {
    expect(packsImports(` * pack identity crosses as a string; see packs/loader.ts`)).toEqual([]);
    expect(packsImports(`// packs/manifest is the pure half`)).toEqual([]);
  });

  test('an unrelated path that merely contains the letters is not matched', () => {
    // `\bpacks/` requires a boundary before "packs", so "unpacks/" is not a hit.
    expect(packsImports(`import { thing } from './unpacks/util';`)).toEqual([]);
  });
});

/**
 * `src/haptics` is browser presentation and its boundary is **total**, like
 * `src/packs`.
 *
 * Rumble is an output channel the shell drives from drained `RunEvent`s,
 * beside audio. Its registry and mixer are pure, but its driver holds a wall
 * clock and its sinks call `GamepadHapticActuator` — and the property that
 * matters is not "would it run headless" but that nothing the simulation
 * computes can come to depend on whether a motor exists. So no headless tree
 * may import it, not even a type: the shapes `src/game` needs (`RumbleSetting`,
 * the event→cue table) are declared in `src/game/haptic-cues.ts` as plain
 * strings and numbers, and the shell resolves the names against the registry.
 * A cue crosses the boundary as a name, exactly as a scene does.
 *
 * The match is on a whole path segment named `haptics` — the bare directory
 * (`'../haptics'`, which resolves to its index) as well as any module inside
 * it — so `./haptic-cues` and a sibling such as `v4-haptics` are not hits.
 * A headless tree importing `src/v4/haptics` is caught too, correctly: that
 * module registers cues into `src/haptics`.
 *
 * Unlike the two scanners above, this one reads **statements, not lines**. A
 * per-line scan cannot see the house style for a long import —
 *
 *     import {
 *       HapticMixer,
 *       type HapticLevel,
 *     } from '../haptics/mixer';
 *
 * — because the line that starts with `import` names no module and the line
 * that names the module starts with `}`. A boundary that calls itself total
 * has to see the form an offence would most likely be written in, and a
 * dynamic `import('../haptics')` as well.
 *
 * `src/core` is scanned too, though it is not in `HEADLESS_TREES` (it
 * legitimately touches DOM input APIs, so the render rule does not bind it):
 * `core/input.ts` computes the one mask the simulation reads, and now also
 * the pad-in-use bookkeeping rumble targets. Nothing there has a reason to
 * know a motor exists.
 */
const HAPTICS_SPEC = String.raw`['"]((?:[^'"]*\/)?haptics(?:\/[^'"]*)?)['"]`;
/**
 * A static import/export whose module is a haptics path. The statement must
 * START a line, so prose (` * import … from '../haptics'`, `// import …`)
 * never anchors a match; `[^;'"]*?` may cross newlines but stops at the first
 * string or semicolon, so it cannot run on into a later statement.
 */
const STATIC_HAPTICS = new RegExp(
  String.raw`^[ \t]*(?:(?:import|export)\b[^;'"]*?\bfrom\s*|import\s*)` + HAPTICS_SPEC,
  'gm',
);
const DYNAMIC_HAPTICS = new RegExp(String.raw`\bimport\s*\(\s*` + HAPTICS_SPEC, 'g');

/** Each offence, whitespace-normalised to one line. */
function hapticsImports(source: string): string[] {
  const out = [...source.matchAll(STATIC_HAPTICS)].map((m) => m[0].replace(/\s+/g, ' ').trim());
  for (const line of source.split('\n')) {
    const text = line.trim();
    // Prose that mentions `import('../haptics')` is not a dynamic import.
    if (/^(\/\/|\/\*|\*)/.test(text)) continue;
    for (const m of text.matchAll(DYNAMIC_HAPTICS)) out.push(m[0]);
  }
  return out;
}

const HAPTICS_FREE_TREES = [...HEADLESS_TREES, 'core'];

describe('the simulation does not depend on haptics', () => {
  test.each(HAPTICS_FREE_TREES)('src/%s imports nothing from src/haptics', (tree) => {
    const offences: string[] = [];

    for (const path of sourceFiles(`${ROOT}${tree}`)) {
      const source = readFileSync(path, 'utf8');
      for (const line of hapticsImports(source)) {
        offences.push(`${path.slice(ROOT.length)}: ${line}`);
      }
    }

    expect(offences).toEqual([]);
  });
});

describe('the haptics scanner detects what it claims to', () => {
  test('a value import of the haptics index is an offence', () => {
    expect(hapticsImports(`import { defineHaptic } from '../haptics';`)).toHaveLength(1);
    expect(hapticsImports(`import { defineHaptic } from "../../haptics";`)).toHaveLength(1);
  });

  test('an import of a module inside haptics is an offence', () => {
    expect(hapticsImports(`import { HapticMixer } from '../haptics/mixer';`)).toHaveLength(1);
  });

  test('a type-only import is an offence too, because the boundary is total', () => {
    expect(hapticsImports(`import type { HapticLevel } from '../haptics/types';`)).toHaveLength(1);
    expect(hapticsImports(`import { type HapticSink } from '../haptics';`)).toHaveLength(1);
  });

  test('a re-export and a side-effect import are offences', () => {
    expect(hapticsImports(`export { getHaptic } from '../haptics';`)).toHaveLength(1);
    expect(hapticsImports(`import '../v4/haptics';`)).toHaveLength(1);
  });

  test('the game-side cue table is not matched', () => {
    expect(hapticsImports(`import { EVENT_HAPTICS } from './haptic-cues';`)).toEqual([]);
    expect(hapticsImports(`import type { RumbleSetting } from '../game/haptic-cues';`)).toEqual([]);
  });

  test('an unrelated path that merely contains the letters is not matched', () => {
    expect(hapticsImports(`import { thing } from './v4-haptics';`)).toEqual([]);
    expect(hapticsImports(`import { thing } from './haptics-old/util';`)).toEqual([]);
  });

  test('prose naming the path is not an import', () => {
    expect(hapticsImports(` * the shell owns src/haptics/output.ts`)).toEqual([]);
    expect(hapticsImports(`// see '../haptics' for the registry`)).toEqual([]);
    expect(hapticsImports(` * import { HapticMixer } from '../haptics/mixer';`)).toEqual([]);
    expect(hapticsImports(`// const m = await import('../haptics');`)).toEqual([]);
  });

  test('a multi-line import is an offence: the form a per-line scan cannot see', () => {
    const source = [
      `import {`,
      `  HapticMixer,`,
      `  type HapticLevel,`,
      `} from '../haptics/mixer';`,
    ].join('\n');
    expect(hapticsImports(source)).toEqual([
      `import { HapticMixer, type HapticLevel, } from '../haptics/mixer'`,
    ]);
  });

  test('a multi-line re-export is an offence', () => {
    expect(hapticsImports(`export {\n  defineHaptic,\n} from '../haptics';`)).toHaveLength(1);
  });

  test('a dynamic import is an offence', () => {
    expect(hapticsImports(`const m = await import('../haptics');`)).toHaveLength(1);
    expect(hapticsImports(`void import( "../haptics/mixer" );`)).toHaveLength(1);
  });

  test('a multi-line import of something else does not swallow a later string', () => {
    // The lazy run stops at the first string, so './run' ends the statement
    // and the unrelated literal after it is never read as its module.
    const source = [
      `import {`,
      `  characterNames,`,
      `} from './run';`,
      `const where = '../haptics';`,
      `export const label = 'haptics';`,
    ].join('\n');
    expect(hapticsImports(source)).toEqual([]);
  });

  test('the scan would catch a real offence in a headless tree file', () => {
    // End to end over a fabricated source, as the per-tree loop reads one.
    const source = [
      `import { Button } from '../core/input';`,
      `import type { HapticLevel } from '../haptics/types';`,
      `import { EVENT_HAPTICS } from './haptic-cues';`,
    ].join('\n');
    expect(hapticsImports(source)).toEqual([
      `import type { HapticLevel } from '../haptics/types'`,
    ]);
  });
});
