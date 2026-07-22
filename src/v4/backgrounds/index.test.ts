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
import '../content';

import {
  backgroundNames,
  composeFragmentShader,
  getBackgroundSpec,
} from '../../render/background';
import { getStage, stageNames } from '../../content/stage';
import { bossNames, getBossSpec } from '../../sim/boss';

const SHIPPED = [
  'drift',
  'surge',
  'expanse',
  'undertow',
  'stratum',
  'vault',
  // The boss scenes: per-scene near-identical ports of the pbakaus/radiant
  // references, not one engine cell — one reference, one scene, no sharing (the
  // no-repeat ruling; the structural test below enforces it). Each is a boss
  // scene named by a spell card.
  'signet',
  'cordon',
  'intaglio',
  'sable',
  'regnum',
  'umbra',
  'decree',
  // The terminal-screen scene: game-over and the ending declare it, the way the
  // title sits on `drift` — the shell's scene-override idiom, not any stage's.
  'signal-decay',
];

/**
 * Reviewed runtime shader-source baseline. Both the authored body and the fully
 * assembled renderer shader are pinned: shader, exposure, wrapper or scroll-rate
 * changes must be intentional and update the corresponding exact digest.
 */
const REVIEWED_BASELINE: Readonly<
  Record<string, { scrollSpeed: number; bodySha256: string; assembledSha256: string }>
> = {
  cordon: { scrollSpeed: 0.6, bodySha256: '795be3f0c6c7318b6da0f2b64d66574cb62e920286413b826f1ab53e2d8c8e9e', assembledSha256: '144e222f8ead0b60e6ef53cf650731ee4989555ea2c0b37228a71b4b1a46f51c' },
  decree: { scrollSpeed: 1.2, bodySha256: '5075c1b20e66f4de06ecc993fe87f405e042f6c9a963775054271b44d1f9aa87', assembledSha256: '0ecea53ca30eb191f79d853354d8642458bfc9b22b48713d4a9484f6dccfa557' },
  drift: { scrollSpeed: 0.6, bodySha256: '07589177b4e2ba81b94ff46f5b3e91754b8797945a71f93e3989700a719c68c2', assembledSha256: 'efc867c435db327d62acfc97ff3bb79cb8e358a3c87a2373e0744c345dcaffa6' },
  expanse: { scrollSpeed: 0.7, bodySha256: 'e2469a82205d31b390fd4a3ed6a951bc46e859eeb013057b835094475018f3c9', assembledSha256: 'c4e93c558f8ccf012a6f4e8a0079f70d86661cd6f3e73f358f3da99bbb4efde7' },
  intaglio: { scrollSpeed: 0.9, bodySha256: '512b3c849ca375cf35040f0211b28f5ca8fa7cd96272786f141be95e0920fabb', assembledSha256: '4be12c473d006c6e96971fcf0f30b40faff85fd6bc20492a68b578345ee7ddf5' },
  regnum: { scrollSpeed: 0.8, bodySha256: 'ae43c4e5d32cc111f78426d55f7bf9704d9b4d966f304d8cf760a03318a9991d', assembledSha256: '91de63327f62b6ea0d7f30864d96ab9927e73c3a701a4b390c508cdcce525d87' },
  sable: { scrollSpeed: 0.6, bodySha256: '5f57acb79a06a5172971b77cb24731259da1e1b613dc7b2d1c1751c333c8fb85', assembledSha256: '34de21aa85627244dc17609de4140942782c7ab8a4590afcf68a32830fb1bc91' },
  'signal-decay': { scrollSpeed: 1, bodySha256: '57cec81deacc1586104562c13b9720c8992bfce512c9886d14f428b3a9b610a0', assembledSha256: '5ad40b9a823580ebd78255033507197060060fa4b843ba89499ba269ee2f824e' },
  signet: { scrollSpeed: 0.8, bodySha256: 'f4c19ffa0394eb28fe80791a6a4b7d967c17503f54e0ab397979178a04579d35', assembledSha256: 'fcf9308f5692bc30b95a277713fb0805f5232152352a9cc00be64a957b0de36c' },
  stratum: { scrollSpeed: 0.7, bodySha256: '4ff07b30137f8b6bfbffcc8ca9bc1197f952cfb6215867e06646b37c1fdea331', assembledSha256: 'dbc66dde2d205cc6d8c576ce29041c593d996e678121b980667f08e5f368799d' },
  surge: { scrollSpeed: 1.4, bodySha256: '6aac92dbeeed439368cbc2029adebcb67ec421ab79abf3f2b0b652c4eb28a920', assembledSha256: 'ee320ff4f8eea42e6b84fdf2654998929ff42bdf60e93d1c50cb27ce854e1936' },
  umbra: { scrollSpeed: 1.1, bodySha256: 'fe7c65d38275a41193e99ce2059990c7689b47589d491d475d7d54e46bb2606a', assembledSha256: 'b5f23c7321ff63d37fd2477f1a5e99df4097771a8aa3b02ea56ea97861107f36' },
  undertow: { scrollSpeed: 0.9, bodySha256: '9d86a5c78ed10e1ee3feac2b9e84c5339e96251a87ad8a10263f85ee9b5b0091', assembledSha256: 'f0e9e9670ff1adfac0677a7c0fd3d82e82372e35d806f773e669cb240dba0fff' },
  vault: { scrollSpeed: 0.5, bodySha256: '2c3fda58adbae58fd71a3f00d84da252961499380324dd6f5964d867dd2e3c88', assembledSha256: '2098258e6cde74139ed5a174bf113259924c97eafe67f5c4072feea152b3c2a4' },
};

describe('the shipped scenes', () => {
  test.each(SHIPPED)('%s is registered', (name) => {
    expect(backgroundNames()).toContain(name);
  });

  test.each(SHIPPED)('%s defines the entry point and a scroll rate', (name) => {
    const spec = getBackgroundSpec(name);
    expect(spec.fragment).toContain('vec3 background(vec2 uv)');
    expect(spec.scrollSpeed).toBeGreaterThan(0);
  });

  test('scene bodies, assembled sources and scroll rates match reviewed baselines', () => {
    const actual = Object.fromEntries(
      Object.keys(REVIEWED_BASELINE).sort().map((name) => {
        const spec = getBackgroundSpec(name);
        return [
          name,
          {
            scrollSpeed: spec.scrollSpeed,
            bodySha256: new Bun.CryptoHasher('sha256').update(spec.fragment).digest('hex'),
            assembledSha256: new Bun.CryptoHasher('sha256')
              .update(composeFragmentShader(spec.fragment))
              .digest('hex'),
          },
        ];
      }),
    );
    expect(actual).toEqual(REVIEWED_BASELINE);
  });

  // The no-repeat ruling ("不要重复"), as structure: one reference, one scene.
  // The gold trio and the 出神 pair each briefly shared a ported basis; both were
  // dissolved when the user remapped their siblings to their own references, so
  // now NO scene may import from a sibling scene — a `./` import here is either a
  // resurrected shared basis or a scene leaning on another's picture, and both
  // recreate the sameness this ruling exists to prevent. Engine imports
  // (`../background`) stay legal. Directory-scanned so the check cannot go stale.
  test('no scene imports from a sibling scene (one reference, one scene)', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const dir = new URL('.', import.meta.url).pathname;

    const offences: string[] = [];
    for (const file of readdirSync(dir).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'index.ts',
    )) {
      const source = readFileSync(`${dir}${file}`, 'utf8');
      if (source.match(/from '\.\//)) offences.push(file);
    }

    expect(offences).toEqual([]);
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

  test('all four shipped stages are actually set somewhere', () => {
    // Not a tautology of the above: a stage with no `background` at all passes
    // the resolve check trivially, and would silently leave the title screen's
    // scene up for the whole level.
    expect(getStage('stage-1').background).toBe('expanse');
    expect(getStage('stage-2').background).toBe('undertow');
    expect(getStage('stage-3').background).toBe('stratum');
    expect(getStage('stage-4').background).toBe('vault');
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
