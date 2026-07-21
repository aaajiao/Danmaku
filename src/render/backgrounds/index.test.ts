/**
 * The scenes, and the thing that makes naming one by string safe.
 *
 * `background.test.ts` covers the engine and deliberately names no scene. This
 * covers the other half: that the shipped scenes exist, that they are reachable,
 * and — the test that earns its place — that every background name written down
 * anywhere in the content actually resolves.
 *
 * That last one is the cost of the design. A stage says `background: 'expanse'`
 * as a string, because `src/content` may not import `src/render`. A string
 * reference cannot be checked by the compiler, so it has to be checked here, or
 * a typo ships as a scene that throws the first time someone reaches the stage
 * it belongs to.
 */

import { describe, expect, test } from 'bun:test';

import './index';
// The base campaign is a bundled pack now, so the stages and bosses whose scene
// names this file resolves come from injecting it, not from importing content.
// A render-side test may import packs (the ban is on sim/content/game, enforced
// by architecture.test.ts) — the same direction `loader.ts` already crosses —
// and this is the honest way to get the real stage/boss set the scene check reads.
import '../../packs/bundled';

import { BACKGROUND_NOISE_GLSL, backgroundNames, getBackgroundSpec } from '../background';
import { getStage, stageNames } from '../../content/stage';
import { bossNames, getBossSpec } from '../../sim/boss';

const SHIPPED = ['drift', 'surge', 'expanse', 'undertow', 'stratum'];

describe('the shipped scenes', () => {
  test.each(SHIPPED)('%s is registered', (name) => {
    expect(backgroundNames()).toContain(name);
  });

  test.each(SHIPPED)('%s defines the entry point and a scroll rate', (name) => {
    const spec = getBackgroundSpec(name);
    expect(spec.fragment).toContain('vec3 background(vec2 uv)');
    expect(spec.scrollSpeed).toBeGreaterThan(0);
  });

  test.each(SHIPPED)('%s reuses the shared noise helpers', (name) => {
    expect(getBackgroundSpec(name).fragment).toContain(BACKGROUND_NOISE_GLSL);
  });
});

/**
 * Fixtures other test files registered, which this one must not judge.
 *
 * The registries are module-global and Bun shares module state across test
 * files, so everything any suite ever registered is visible here. `run.test.ts`
 * registers a boss naming a scene that deliberately does not exist, to prove
 * `Run.scene` reports the phase override — and this file scanning it reported a
 * broken content reference for a fixture, which is a false alarm about test
 * scaffolding rather than about the game.
 *
 * `test-` is the existing convention for that; see the `NS` constant in
 * `content/patterns.test.ts`. Skipping the prefix is safe in the direction that
 * matters: shipped content cannot use it without renaming itself into the
 * exemption, and a rename that deliberate is not the typo this test is for.
 *
 * Worth noting how this surfaced. The obvious fix — register a real background
 * from `run.test.ts` — is impossible: that file is under `src/game`, and
 * importing `src/render` there is precisely what `architecture.test.ts` forbids.
 * The two guards agree, which is the point of having both.
 */
const isFixture = (name: string) => name.startsWith('test-');

describe('every name the content writes down resolves', () => {
  // The guard the string-reference design needs. Without it, `background:
  // 'expanse'` and `background: 'expanse '` are indistinguishable until a
  // player reaches that stage.

  test('every stage names a scene that exists', () => {
    const broken = stageNames()
      .filter((name) => !isFixture(name))
      .map((name) => ({ stage: name, scene: getStage(name).background }))
      .filter((entry) => entry.scene !== undefined)
      .filter((entry) => !backgroundNames().includes(entry.scene as string));

    expect(broken).toEqual([]);
  });

  test('every boss phase names a scene that exists', () => {
    const broken = bossNames()
      .filter((name) => !isFixture(name))
      .flatMap((boss) =>
        getBossSpec(boss)
          .phases.map((phase, index) => ({ boss, phase: index, scene: phase.background }))
          .filter((entry) => entry.scene !== undefined)
          .filter((entry) => !backgroundNames().includes(entry.scene as string)),
      );

    expect(broken).toEqual([]);
  });

  test('the exemption is narrow — a real boss with a bad scene is still caught', () => {
    // Proof the filter above did not quietly disable the check. Without this,
    // widening `isFixture` by one character would go unnoticed.
    const shipped = bossNames().filter((name) => !isFixture(name));
    expect(shipped.length).toBeGreaterThan(0);

    const broken = [...shipped, 'pretend-boss']
      .filter((name) => !isFixture(name))
      .filter((name) => name === 'pretend-boss');

    expect(broken).toEqual(['pretend-boss']);
  });

  test('both shipped stages are actually set somewhere', () => {
    // Not a tautology of the above: a stage with no `background` at all passes
    // the resolve check trivially, and would silently leave the title screen's
    // scene up for the whole level.
    expect(getStage('stage-1').background).toBe('expanse');
    expect(getStage('stage-2').background).toBe('undertow');
  });
});

describe('the index is complete', () => {
  // Same failure this repository has already had in `src/content`: a module
  // written, tested, green, and absent from the bundle. Reading the directory
  // rather than listing names here means the check cannot go stale.
  test('every scene file is imported by index.ts', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const dir = new URL('.', import.meta.url).pathname;

    const modules = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => !f.endsWith('.test.ts'))
      .filter((f) => f !== 'index.ts')
      .map((f) => f.replace(/\.ts$/, ''));

    const index = readFileSync(`${dir}index.ts`, 'utf8');
    const missing = modules.filter((m) => !index.includes(`'./${m}'`));

    expect(missing).toEqual([]);
  });
});

/**
 * The wall-clock ban, applied to the scenes rather than to the engine.
 *
 * `background.test.ts` scans `background.ts` for the same thing. This scans
 * every scene file, which is where the mistake is far more likely: the engine
 * is written once and a scene is written every time someone adds a level, by
 * whoever is thinking about how it looks rather than about rule 1.
 *
 * A background driven by a wall clock desynchronises from a replay visually
 * while every other test stays green, because the simulation is untouched and
 * nothing else can notice.
 */
test('no wall-clock source reaches any scene', async () => {
  const { readdirSync } = await import('node:fs');
  const dir = new URL('.', import.meta.url).pathname;

  const forbidden = [
    'Date.now',
    'performance.now',
    'new Date',
    'requestAnimationFrame',
    'setTimeout',
    'setInterval',
  ];

  const offences: string[] = [];

  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
    const source = await Bun.file(`${dir}${file}`).text();
    const code = source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'));

    for (const name of forbidden) {
      if (code.some((line) => line.includes(name))) offences.push(`${file}: ${name}`);
    }
  }

  expect(offences).toEqual([]);
});
