/**
 * The import boundary, enforced.
 *
 * CLAUDE.md states it under "Repository layout": `src/sim/` and `src/content/`
 * must not import from `src/render/`. Until this file, **nothing checked it**.
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
 * `game` is here even though CLAUDE.md's layout section names only `sim` and
 * `content`. `src/main.ts` opens by declaring that all game logic lives under
 * `src/game/` and imports no three.js, because that is what lets a whole run be
 * simulated and replayed headlessly — so the directory already holds itself to
 * this rule, and a rule held by convention is one nobody has broken *yet*.
 * It passes today with no renderer import of any kind, type-only included.
 */
const HEADLESS_TREES = ['sim', 'content', 'game'];

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
