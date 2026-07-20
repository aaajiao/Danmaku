/**
 * The injector's contract, proved against the REAL registries.
 *
 * `manifest.test.ts` covers shape; this covers semantics — every name a pack
 * writes must resolve, the reachability rules must hold, and a clean pack must
 * actually register into `sim`/`content` under qualified names. Two properties
 * are load-bearing here and are asserted directly:
 *
 * - **Atomic.** One bad name rejects the whole pack, and the registries are
 *   proved untouched afterwards — no half of a pack ever lands.
 * - **Idempotent per name.** The registries are process-global (a fact this
 *   whole suite relies on), so a second injection of a name must be a no-op
 *   rather than a duplicate-definition throw. Every test that wants a fresh
 *   injection therefore uses a unique, `.test.`-bearing pack name — which also
 *   exempts the qualified content from `reachability.test.ts` (names with '/').
 */

import { describe, expect, test } from 'bun:test';
import '../content'; // registers built-in patterns, behaviours, enemies, bosses, stages
import '../sim/item'; // registers built-in items (power, score, …) — content imports it type-only
import { getStage, hasStage } from '../content/stage';
import { hasEnemy } from '../sim/enemy';
import { injectPack, PackInjectError, type Campaign } from './inject';
import type { ContentEnemy, ContentStage, PackContent, PackManifest } from './manifest';

const CTX = {
  sprites: ['ship', 'orb.large', 'ring', 'halo', 'shard'],
  scenes: ['expanse', 'undertow'],
};

let counter = 0;
/** A unique pack name carrying `.test.` so its qualified content is fixture-exempt. */
function uniqueName(): string {
  return `p.test.${counter++}`;
}

function manifest(name: string, content: PackContent): PackManifest {
  const requires: string[] = [];
  if (content.enemies) requires.push('content.enemies');
  if (content.stages) requires.push('content.stages');
  return { format: 1, name, version: '1.0.0', author: 'x', license: 'CC0-1.0', requires, content };
}

/** A minimal well-formed enemy. */
function enemy(over: Partial<ContentEnemy> = {}): ContentEnemy {
  return { sprite: 'ship', hp: 10, radius: 6, ...over };
}

/** A minimal well-formed stage that spawns `ember`. */
function stage(over: Partial<ContentStage> = {}): ContentStage {
  return { entry: true, waves: [{ at: 0, enemy: 'ember', x: 100, y: -20 }], ...over };
}

/** The problems from a rejected injection, or fail loudly if it unexpectedly passed. */
function problemsOf(m: PackManifest): string[] {
  try {
    injectPack(m, CTX);
  } catch (e) {
    if (e instanceof PackInjectError) return [...e.problems];
    throw e;
  }
  throw new Error('expected injectPack to reject, but it succeeded');
}

describe('a clean pack registers into the real registries', () => {
  test('enemies and stages land under qualified names, campaigns returned', () => {
    const name = uniqueName();
    const result = injectPack(
      manifest(name, {
        enemies: {
          ember: enemy({
            patterns: [{ pattern: 'ring', options: {} }],
            spoils: [['power', 2]],
            motion: { r: 2 },
          }),
        },
        stages: {
          gauntlet: stage({ background: 'expanse', next: 'second' }),
          second: {
            waves: [{ at: 0, enemy: 'ember', x: 100, y: -20 }],
            boss: 'sentinel',
            next: null,
          },
        },
      }),
      CTX,
    );

    expect(hasEnemy(`${name}/ember`)).toBe(true);
    expect(hasStage(`${name}/gauntlet`)).toBe(true);
    expect(hasStage(`${name}/second`)).toBe(true);

    // Only the entry stage becomes a campaign row, labelled by its qualified name.
    expect(result.campaigns).toEqual([{ label: `${name}/gauntlet`, stage: `${name}/gauntlet` }]);
  });

  test('a wave naming the pack\'s own enemy is qualified; a built-in stays bare', () => {
    const name = uniqueName();
    injectPack(
      manifest(name, {
        enemies: { ember: enemy() },
        stages: {
          gauntlet: {
            entry: true,
            waves: [
              { at: 0, enemy: 'ember', x: 100, y: -20 },
              { at: 60, enemy: 'grunt', x: 200, y: -20 }, // built-in, unqualified
            ],
          },
        },
      }),
      CTX,
    );

    const waves = getStage(`${name}/gauntlet`).waves;
    const names = waves.map((w) => ('enemy' in w ? w.enemy : `boss:${w.boss}`));
    expect(names).toContain(`${name}/ember`);
    expect(names).toContain('grunt');
  });

  test('a pack name that shadows a built-in resolves pack-first', () => {
    const name = uniqueName();
    injectPack(
      manifest(name, {
        // 'grunt' is also a built-in; the pack's own must win inside the pack.
        enemies: { grunt: enemy() },
        stages: {
          gauntlet: { entry: true, waves: [{ at: 0, enemy: 'grunt', x: 100, y: -20 }] },
        },
      }),
      CTX,
    );

    expect(hasEnemy(`${name}/grunt`)).toBe(true);
    expect(hasEnemy('grunt')).toBe(true); // the built-in is untouched
    const first = getStage(`${name}/gauntlet`).waves[0];
    expect(first && 'enemy' in first ? first.enemy : undefined).toBe(`${name}/grunt`);
  });

  test('a boss wave and an end-of-stage boss both name built-ins bare', () => {
    const name = uniqueName();
    injectPack(
      manifest(name, {
        enemies: { ember: enemy() },
        stages: {
          gauntlet: {
            entry: true,
            boss: 'warden',
            waves: [
              { at: 0, enemy: 'ember', x: 100, y: -20 },
              { at: 120, boss: 'magistrate' },
            ],
          },
        },
      }),
      CTX,
    );
    const spec = getStage(`${name}/gauntlet`);
    expect(spec.boss).toBe('warden');
    const bossWave = spec.waves.find((w) => 'boss' in w);
    expect(bossWave && 'boss' in bossWave ? bossWave.boss : undefined).toBe('magistrate');
  });

  test('next chains pack-first to a qualified stage, or leaves the pack bare', () => {
    const name = uniqueName();
    injectPack(
      manifest(name, {
        enemies: { ember: enemy() },
        stages: {
          gauntlet: stage({ next: 'second' }),
          second: { waves: [{ at: 0, enemy: 'ember', x: 0, y: 0 }], next: 'stage-1' },
        },
      }),
      CTX,
    );
    expect(getStage(`${name}/gauntlet`).next).toBe(`${name}/second`);
    expect(getStage(`${name}/second`).next).toBe('stage-1'); // built-in, unqualified
  });
});

describe('idempotency', () => {
  test('a second injection of the same pack name is a no-op returning the same campaigns', () => {
    const name = uniqueName();
    const m = manifest(name, {
      enemies: { ember: enemy() },
      stages: { gauntlet: stage() },
    });
    const first: Campaign[] = injectPack(m, CTX).campaigns;
    // Would throw "enemy already defined" if it re-registered.
    const second = injectPack(m, CTX).campaigns;
    expect(second).toEqual(first);
  });
});

describe('atomicity — one bad name rejects the whole pack, registries untouched', () => {
  test('a good enemy alongside a bad one leaves neither registered', () => {
    const name = uniqueName();
    const m = manifest(name, {
      enemies: {
        good: enemy(),
        bad: enemy({ sprite: 'no-such-sprite' }),
      },
      stages: {
        gauntlet: {
          entry: true,
          waves: [
            { at: 0, enemy: 'good', x: 0, y: 0 },
            { at: 10, enemy: 'bad', x: 0, y: 0 },
          ],
        },
      },
    });
    expect(() => injectPack(m, CTX)).toThrow(PackInjectError);
    expect(hasEnemy(`${name}/good`)).toBe(false);
    expect(hasEnemy(`${name}/bad`)).toBe(false);
    expect(hasStage(`${name}/gauntlet`)).toBe(false);
  });
});

describe('name resolution errors are golden', () => {
  test('unknown sprite', () => {
    const name = uniqueName();
    expect(problemsOf(manifest(name, {
      enemies: { ember: enemy({ sprite: 'orb.huge' }) },
      stages: { gauntlet: stage() },
    }))).toContain(
      `pack "${name}": enemy "ember" uses unknown sprite "orb.huge" — known sprites: halo, orb.large, ring, shard, ship`,
    );
  });

  test('unknown pattern', () => {
    const name = uniqueName();
    expect(problemsOf(manifest(name, {
      enemies: { ember: enemy({ patterns: [{ pattern: 'sprial' }] }) },
      stages: { gauntlet: stage() },
    }))).toContain(
      `pack "${name}": enemy "ember" uses unknown pattern "sprial" — no such pattern is registered`,
    );
  });

  test('unknown motion behaviour', () => {
    const name = uniqueName();
    expect(problemsOf(manifest(name, {
      enemies: { ember: enemy({ motion: { behaviour: 'homng' } }) },
      stages: { gauntlet: stage() },
    }))).toContain(
      `pack "${name}": enemy "ember" uses unknown motion behaviour "homng" — no such behaviour is registered`,
    );
  });

  test('unknown spoils item', () => {
    const name = uniqueName();
    expect(problemsOf(manifest(name, {
      enemies: { ember: enemy({ spoils: [['powr', 1]] }) },
      stages: { gauntlet: stage() },
    }))).toContain(
      `pack "${name}": enemy "ember" drops unknown item "powr" — no such item is registered`,
    );
  });

  test('unknown enemy in a wave', () => {
    const name = uniqueName();
    expect(problemsOf(manifest(name, {
      enemies: { ember: enemy() },
      stages: {
        gauntlet: {
          entry: true,
          waves: [
            { at: 0, enemy: 'ember', x: 0, y: 0 },
            { at: 10, enemy: 'gremlin', x: 0, y: 0 },
          ],
        },
      },
    }))).toContain(
      `pack "${name}": stage "gauntlet" wave 1 references unknown enemy "gremlin" — no such enemy in this pack or built in`,
    );
  });

  test('unknown boss in a boss wave', () => {
    const name = uniqueName();
    expect(problemsOf(manifest(name, {
      enemies: { ember: enemy() },
      stages: {
        gauntlet: {
          entry: true,
          waves: [
            { at: 0, enemy: 'ember', x: 0, y: 0 },
            { at: 10, boss: 'sentinl' },
          ],
        },
      },
    }))).toContain(
      `pack "${name}": stage "gauntlet" wave 1 references unknown boss "sentinl" — pack stages may name a built-in boss only; no built-in boss "sentinl" exists`,
    );
  });

  test('unknown end-of-stage boss', () => {
    const name = uniqueName();
    expect(problemsOf(manifest(name, {
      enemies: { ember: enemy() },
      stages: { gauntlet: stage({ boss: 'overlord' }) },
    }))).toContain(
      `pack "${name}": stage "gauntlet" names unknown boss "overlord" — pack stages may name a built-in boss only; no built-in boss "overlord" exists`,
    );
  });

  test('unknown background', () => {
    const name = uniqueName();
    expect(problemsOf(manifest(name, {
      enemies: { ember: enemy() },
      stages: { gauntlet: stage({ background: 'nebula' }) },
    }))).toContain(
      `pack "${name}": stage "gauntlet" is set in unknown background "nebula" — known backgrounds: expanse, undertow`,
    );
  });

  test('unknown next stage', () => {
    const name = uniqueName();
    expect(problemsOf(manifest(name, {
      enemies: { ember: enemy() },
      stages: { gauntlet: stage({ next: 'stage-99' }) },
    }))).toContain(
      `pack "${name}": stage "gauntlet" chains next into unknown stage "stage-99" — no such stage in this pack or built in`,
    );
  });
});

describe('numeric wave errors are golden (kept pack-scoped, not thrown by defineStage)', () => {
  test('fractional at', () => {
    const name = uniqueName();
    expect(problemsOf(manifest(name, {
      enemies: { ember: enemy() },
      stages: { gauntlet: { entry: true, waves: [{ at: 12.5, enemy: 'ember', x: 0, y: 0 }] } },
    }))).toContain(`pack "${name}": stage "gauntlet" wave 0: "at" must be a whole tick count, got 12.5`);
  });

  test('non-positive count', () => {
    const name = uniqueName();
    expect(problemsOf(manifest(name, {
      enemies: { ember: enemy() },
      stages: { gauntlet: { entry: true, waves: [{ at: 0, enemy: 'ember', x: 0, y: 0, count: 0 }] } },
    }))).toContain(`pack "${name}": stage "gauntlet" wave 0: "count" must be a positive whole number, got 0`);
  });

  test('negative interval', () => {
    const name = uniqueName();
    expect(problemsOf(manifest(name, {
      enemies: { ember: enemy() },
      stages: { gauntlet: { entry: true, waves: [{ at: 0, enemy: 'ember', x: 0, y: 0, count: 2, interval: -1 }] } },
    }))).toContain(`pack "${name}": stage "gauntlet" wave 0: "interval" must be a whole tick count, got -1`);
  });

  test('fractional outro', () => {
    const name = uniqueName();
    expect(problemsOf(manifest(name, {
      enemies: { ember: enemy() },
      stages: { gauntlet: stage({ outro: 1.5 }) },
    }))).toContain(`pack "${name}": stage "gauntlet": outro must be a whole tick count, got 1.5`);
  });
});

describe('reachability errors are golden (registration is not reachability)', () => {
  test('stages present but none marked entry', () => {
    const name = uniqueName();
    expect(problemsOf(manifest(name, {
      enemies: { ember: enemy() },
      stages: { gauntlet: { waves: [{ at: 0, enemy: 'ember', x: 0, y: 0 }] } },
    }))).toContain(
      `pack "${name}": has content.stages but no entry stage — mark a campaign start with "entry": true`,
    );
  });

  test('a stage neither entry nor any stage\'s next is dead content', () => {
    const name = uniqueName();
    expect(problemsOf(manifest(name, {
      enemies: { ember: enemy() },
      stages: {
        gauntlet: stage(),
        orphan: { waves: [{ at: 0, enemy: 'ember', x: 0, y: 0 }] },
      },
    }))).toContain(
      `pack "${name}": stage "orphan" is neither an entry nor any stage's next — dead content (registration is not reachability)`,
    );
  });

  test('an enemy spawned by no wave is dead content', () => {
    const name = uniqueName();
    expect(problemsOf(manifest(name, {
      enemies: { ember: enemy(), ghost: enemy() },
      stages: { gauntlet: stage() },
    }))).toContain(
      `pack "${name}": enemy "ghost" is spawned by no wave of any pack stage — dead content (registration is not reachability)`,
    );
  });
});

describe('a presentation-only pack (no content) injects nothing', () => {
  test('no campaigns, no throw', () => {
    const name = uniqueName();
    const result = injectPack(
      { format: 1, name, version: '1.0.0', author: 'x', license: 'CC0-1.0' },
      CTX,
    );
    expect(result.campaigns).toEqual([]);
  });
});
