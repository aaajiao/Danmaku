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
  // The boss scenes: independently authored v4 adaptations of distinct spatial
  // references, not one engine cell — one reference, one scene, no sharing (the
  // no-repeat ruling; the structural test below enforces it). Each is named by
  // a spell card.
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
  cordon: { scrollSpeed: 0.6, bodySha256: '9619728977ca0a8c022a3f0b289826fe46548797edc99d839ca6755f89fcfc2c', assembledSha256: 'c99078aab9904352e96166091e2b3b6c9b8c090cff9402f7821bb3688ab2128c' },
  decree: { scrollSpeed: 1.2, bodySha256: '0bfc1742f6ca59dfacafdd069adc5306c96c322cd397775ed040a15eff137182', assembledSha256: 'd9cef95a7ac12e9b6a29c2acbe5ca49ecf8aeb0127d88fa05ef659af84c28f6f' },
  drift: { scrollSpeed: 0.6, bodySha256: 'cfd6c0401389ae6d7e544da6619a943e58a290a1fb6bd8a4f344240231884239', assembledSha256: 'ae507376fd29eedaf434558304066a524145027c0fdadd278a53f9e949ee0f7e' },
  expanse: { scrollSpeed: 0.7, bodySha256: 'f4ba4f67072cc6eb4216abae0142a47fed5eda79c72550726b2f65bcacd26670', assembledSha256: 'f4ab96063849f2b5463e45e8186ffaaaf7bcdb05cc80c116b81b6679531dee52' },
  intaglio: { scrollSpeed: 0.9, bodySha256: '6a0db83ff713031d2c69452e032d7ecd57f65364cce085a1e7baefbbdea814d8', assembledSha256: 'e962e85207947c714136e81c9a6ca67562431918504fa9f01a722dad5485a698' },
  regnum: { scrollSpeed: 0.8, bodySha256: 'dc0790809352173a070c9c1dc4c454fa5fed60c7fa1dff74966ad0c31d6e2567', assembledSha256: 'fbd67903607eda7ec8267bc16c77a54e74bc18c3a37f2ff64fad45ac866cd83f' },
  sable: { scrollSpeed: 0.6, bodySha256: 'f006266116b7c9608a564b88433013eeab0251d8983a38c40b21098f0568a355', assembledSha256: '1b0dda9b94ec5938a66d035166bdc57c2409f885ee887336bd06d2a652daaf83' },
  'signal-decay': { scrollSpeed: 1, bodySha256: '3bbb5fd5d907a9d85e982d0a2b83c5c7edb13a0b86a36618c0f1cf2f7e0918c8', assembledSha256: '8fee30d65e3315e57663c144301c131f0ef51b9539479145457fd4b451c7fdca' },
  signet: { scrollSpeed: 0.8, bodySha256: 'a86e0fd4f681a95c2981c85036bc36754df0612769b934db118872544e9eaf9d', assembledSha256: '2e8ce862554677c9642e56edaa4fdc036fde7461cb2c88400cc28d4ee92d708f' },
  stratum: { scrollSpeed: 0.7, bodySha256: 'e8247546a079ce9233db4207abe1f89a1d0088ecba479fb490033fb6d9960c2f', assembledSha256: '60407a0e8b4efad19d8e198bc7e77d6eeb72f4868e1f0adb154c19d49f0afa28' },
  surge: { scrollSpeed: 1.4, bodySha256: 'a9c188404e880e8a86341fa0b231baa9bbb397d35bba5588bdebd51b16ad5d33', assembledSha256: '89a7371f20da6d3b07c9144ad0cff97ef4cd3cb123e50e8dd8a72d221a74c28e' },
  umbra: { scrollSpeed: 1.1, bodySha256: 'b60bf3aaa9ffe263dfafac957be234b35a1218d5627d63a43561d66eff7945a5', assembledSha256: '6d48d4ebaebb482b679e617d4cfe06d52381d159c661520f0e491813c2eca789' },
  undertow: { scrollSpeed: 0.9, bodySha256: '9f09b69eb4dc9d0e6bfe27a705063857ce310ff33445cedc3a6b0bb0ac5c5d63', assembledSha256: 'a15389906d79eb9fdf1e65675972c26323e9f52a4e9fb0b3ef099173ff00702e' },
  vault: { scrollSpeed: 0.5, bodySha256: 'c935acacfb4356991d339ed248a907ba84d8d27a7dc82bff49a683a63184d2a9', assembledSha256: '711980dddaeaab8af467e0b178c79677147c3ee1e31714bef1557ef898854aea' },
};

const REVIEWED_ART = {
  expanse: {
    file: new URL('../../assets/v4/backgrounds/expanse-v4.png', import.meta.url),
    width: 480,
    height: 640,
    bytes: 26640,
    sha256: '5e507b52270cae88753dd0bf88cf3b5ba3e5c15a1c7886f27cf25aa06765dc31',
  },
  undertow: {
    file: new URL('../../assets/v4/backgrounds/undertow-v4.png', import.meta.url),
    width: 480,
    height: 640,
    bytes: 36555,
    sha256: 'dc2975906cf53b3c0bba1cb8892879794532a9fac22a642dc461ee3ae1049d81',
  },
  stratum: {
    file: new URL('../../assets/v4/backgrounds/stratum-v4.png', import.meta.url),
    width: 480,
    height: 640,
    bytes: 29362,
    sha256: '3052cfe6d2d56ab56e451fcc4e7a7b8dd98bdee2a69ae4f97f5712a49088a8bf',
  },
  vault: {
    file: new URL('../../assets/v4/backgrounds/vault-v4.png', import.meta.url),
    width: 480,
    height: 640,
    bytes: 29008,
    sha256: 'f3817c5b68a82aa5589627cf11ea6ef5d93d2a29266f70cf65306cd6d659a0b8',
  },
} as const;

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

  test('the four reviewed stage scenes bind byte-locked 3:4 painted plates', async () => {
    const painted = SHIPPED.filter((name) => getBackgroundSpec(name).art !== undefined);
    expect(painted).toEqual(Object.keys(REVIEWED_ART));

    for (const [name, contract] of Object.entries(REVIEWED_ART)) {
      const art = getBackgroundSpec(name).art;
      expect(art).toBeDefined();
      expect(art?.width).toBe(contract.width);
      expect(art?.height).toBe(contract.height);
      expect(art?.url.endsWith(`/${name}-v4.png`)).toBe(true);

      const bytes = await Bun.file(contract.file).bytes();
      expect(bytes.byteLength, name).toBe(contract.bytes);
      expect(new Bun.CryptoHasher('sha256').update(bytes).digest('hex'), name)
        .toBe(contract.sha256);
    }
  });

  test('every painted stage keeps a smooth shader-only branch and snaps production', () => {
    for (const name of Object.keys(REVIEWED_ART)) {
      const fragment = getBackgroundSpec(name).fragment;
      expect(fragment, name).toContain('uniform sampler2D uArt;');
      expect(fragment, name).toContain('uniform vec2 uArtRes;');
      expect(fragment, name).toContain('uniform float uArtMode;');
      expect(fragment, name).toContain('if (uArtMode < 0.5)');
      expect(fragment, name).toContain('floor(safeUv * uArtRes) + 0.5');
    }
  });

  test('stratum production keeps the original shader as its luminous base', () => {
    const fragment = getBackgroundSpec('stratum').fragment;
    const production = fragment.slice(fragment.indexOf('vec3 background(vec2 uv)'));
    expect(production).toContain('vec3 shaderColor = stratumShader(pixelUv);');
    expect(production).toContain('vec3 hybrid = shaderColor * reliefGain;');
    expect(production).not.toContain('stratumArtFlow');
    expect(production).not.toContain('stratumHybridMotion');
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

  test('surge opens the shipped stage-2 boss on every difficulty', () => {
    const arraignment = getBossSpec('magistrate').phases[0];
    expect(arraignment?.name).toBe('Arraignment');
    expect(arraignment?.background).toBe('surge');
    expect(arraignment?.difficulties).toBeUndefined();
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
