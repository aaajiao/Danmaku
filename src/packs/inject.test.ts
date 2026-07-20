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
import { getShot } from '../content/shots';
import { getStage, hasStage } from '../content/stage';
import { getCharacter } from '../game/run';
import { getBombSpec } from '../sim/bomb';
import { getBossSpec, hasBoss, phaseClock, phaseHp } from '../sim/boss';
import { getEffectSpec } from '../sim/effects';
import { getEnemySpec, hasEnemy } from '../sim/enemy';
import { getItemSpec } from '../sim/item';
import { getOptionSpec } from '../sim/option';
import { injectPack, PackInjectError, type Campaign } from './inject';
import type {
  ContentBoss,
  ContentCharacter,
  ContentEnemy,
  ContentStage,
  PackContent,
  PackManifest,
  PackMusic,
} from './manifest';

const CTX = {
  sprites: ['orb.large', 'ring', 'halo', 'shard'],
  shipSprites: ['ship'],
  scenes: ['expanse', 'undertow'],
};

let counter = 0;
/** A unique pack name carrying `.test.` so its qualified content is fixture-exempt. */
function uniqueName(): string {
  return `p.test.${counter++}`;
}

function manifest(name: string, content: PackContent, music?: PackMusic): PackManifest {
  const requires: string[] = [];
  if (content.enemies) requires.push('content.enemies');
  if (content.stages) requires.push('content.stages');
  if (content.bosses) requires.push('content.bosses');
  if (content.shots) requires.push('content.shots');
  if (content.characters) requires.push('content.characters');
  if (content.options) requires.push('content.options');
  if (content.bombs) requires.push('content.bombs');
  if (content.effects) requires.push('content.effects');
  if (content.items) requires.push('content.items');
  const m: PackManifest = { format: 1, name, version: '1.0.0', author: 'x', license: 'CC0-1.0', requires, content };
  if (music) m.music = music;
  return m;
}

/** Ship stats for a pack character — the shape a `ContentPlayer` expects. */
function player(): ContentCharacter['player'] {
  return {
    x: 240, y: 560, speed: 3.6, focusSpeed: 1.5, radius: 2.5,
    grazeRadius: 20, lives: 3, bombs: 3, invulnTicks: 90,
  };
}

/** A minimal well-formed enemy. */
function enemy(over: Partial<ContentEnemy> = {}): ContentEnemy {
  return { sprite: 'orb.large', hp: 10, radius: 6, ...over };
}

/** A minimal well-formed boss: one phase naming a built-in pattern. */
function boss(over: Partial<ContentBoss> = {}): ContentBoss {
  return {
    sprite: 'orb.large',
    radius: 16,
    phases: [{ name: 'opening', hpSeconds: 10, patterns: [{ pattern: 'ring' }] }],
    ...over,
  };
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
      `pack "${name}": enemy "ember" uses unknown sprite "orb.huge" — known sprites: halo, orb.large, ring, shard`,
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
      `pack "${name}": enemy "ember" drops unknown item "powr" — no such item in this pack or built in`,
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
      `pack "${name}": stage "gauntlet" wave 1 references unknown boss "sentinl" — no such boss in this pack or built in`,
    );
  });

  test('unknown end-of-stage boss', () => {
    const name = uniqueName();
    expect(problemsOf(manifest(name, {
      enemies: { ember: enemy() },
      stages: { gauntlet: stage({ boss: 'overlord' }) },
    }))).toContain(
      `pack "${name}": stage "gauntlet" names unknown boss "overlord" — no such boss in this pack or built in`,
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

describe('content.bosses — a pack boss registers and is reached by a pack stage', () => {
  test('boss lands under a qualified name, named pack-first by stage.boss and a boss wave', () => {
    const name = uniqueName();
    injectPack(
      manifest(name, {
        enemies: { ember: enemy() },
        bosses: {
          warlord: boss({ onDeath: 'explosion', spoils: [['power', 3]] }),
        },
        stages: {
          gauntlet: {
            entry: true,
            boss: 'warlord', // pack boss, resolved pack-first and qualified
            waves: [
              { at: 0, enemy: 'ember', x: 100, y: -20 },
              { at: 120, boss: 'warlord' }, // pack boss in a wave, qualified too
            ],
          },
        },
      }),
      CTX,
    );

    expect(hasBoss(`${name}/warlord`)).toBe(true);
    const stage = getStage(`${name}/gauntlet`);
    expect(stage.boss).toBe(`${name}/warlord`);
    const bossWave = stage.waves.find((w) => 'boss' in w);
    expect(bossWave && 'boss' in bossWave ? bossWave.boss : undefined).toBe(`${name}/warlord`);
  });

  test('hpSeconds becomes hp via phaseHp, and an absent timeLimit defaults to phaseClock', () => {
    const name = uniqueName();
    injectPack(
      manifest(name, {
        enemies: { ember: enemy() },
        bosses: {
          warlord: boss({
            phases: [{ name: 'opening', hpSeconds: 12, patterns: [{ pattern: 'ring' }] }],
          }),
        },
        stages: {
          gauntlet: { entry: true, boss: 'warlord', waves: [{ at: 0, enemy: 'ember', x: 0, y: 0 }] },
        },
      }),
      CTX,
    );

    // The whole point of hpSeconds over a raw hp: pack boss health is DERIVED
    // from phaseHp exactly as the engine's own bosses are, so it stays coupled
    // to REFERENCE_DPS. If REFERENCE_DPS moves, phaseHp(12) moves, and this
    // assertion fails on PACK content — the same coupling balance.test.ts holds
    // on built-in content. Asserting against phaseHp directly (not a literal) is
    // what keeps a tuning constant no test can measure from drifting silently.
    const phase = getBossSpec(`${name}/warlord`).phases[0];
    expect(phase?.hp).toBe(phaseHp(12));
    expect(phase?.timeLimit).toBe(phaseClock(phaseHp(12)));
  });

  test('an explicit timeLimit overrides the phaseClock default; a card background passes through', () => {
    const name = uniqueName();
    injectPack(
      manifest(name, {
        enemies: { ember: enemy() },
        bosses: {
          warlord: boss({
            phases: [
              { name: 'move', hpSeconds: 8, isSpell: false, patterns: [{ pattern: 'ring' }] },
              {
                name: 'spell',
                hpSeconds: 15,
                timeLimit: 1800,
                isSpell: true,
                background: 'undertow', // per-card scene override, a built-in
                patterns: [{ pattern: 'ring' }],
              },
            ],
          }),
        },
        stages: {
          gauntlet: { entry: true, boss: 'warlord', waves: [{ at: 0, enemy: 'ember', x: 0, y: 0 }] },
        },
      }),
      CTX,
    );

    const phases = getBossSpec(`${name}/warlord`).phases;
    expect(phases[1]?.timeLimit).toBe(1800);
    expect(phases[1]?.background).toBe('undertow');
  });

  test('a pack boss name that shadows a built-in resolves pack-first', () => {
    const name = uniqueName();
    injectPack(
      manifest(name, {
        enemies: { ember: enemy() },
        // 'sentinel' is also a built-in boss; the pack's own must win inside the pack.
        bosses: { sentinel: boss() },
        stages: {
          gauntlet: { entry: true, boss: 'sentinel', waves: [{ at: 0, enemy: 'ember', x: 0, y: 0 }] },
        },
      }),
      CTX,
    );

    expect(hasBoss(`${name}/sentinel`)).toBe(true);
    expect(hasBoss('sentinel')).toBe(true); // the built-in is untouched
    expect(getStage(`${name}/gauntlet`).boss).toBe(`${name}/sentinel`);
  });
});

describe('music resolves pack-first — like a background, but a pack may add its own', () => {
  test('a stage naming a built-in track keeps it bare', () => {
    const name = uniqueName();
    injectPack(
      manifest(name, { enemies: { ember: enemy() }, stages: { gauntlet: stage({ music: 'vigil' }) } }),
      CTX,
    );
    expect(getStage(`${name}/gauntlet`).music).toBe('vigil');
  });

  test("a stage naming the pack's own new track qualifies it", () => {
    const name = uniqueName();
    injectPack(
      manifest(
        name,
        { enemies: { ember: enemy() }, stages: { gauntlet: stage({ music: 'ashen' }) } },
        { ashen: { file: 'ashen.wav' } },
      ),
      CTX,
    );
    expect(getStage(`${name}/gauntlet`).music).toBe(`${name}/ashen`);
  });

  test('a boss holds a pack track, qualified — boss-level, not per-phase', () => {
    const name = uniqueName();
    injectPack(
      manifest(
        name,
        {
          enemies: { ember: enemy() },
          bosses: { warlord: boss({ music: 'ashen' }) },
          stages: {
            gauntlet: { entry: true, boss: 'warlord', waves: [{ at: 0, enemy: 'ember', x: 0, y: 0 }] },
          },
        },
        { ashen: { file: 'ashen.wav' } },
      ),
      CTX,
    );
    expect(getBossSpec(`${name}/warlord`).music).toBe(`${name}/ashen`);
  });

  test('a pack music key matching a built-in name is a replacement — the reference stays bare', () => {
    const name = uniqueName();
    // A pack track called `vigil` (a built-in name) is a replacement the loader
    // registers bare, so a stage naming `vigil` resolves to the bare built-in name,
    // never a qualified pack name — the one exception to pack-first.
    injectPack(
      manifest(
        name,
        { enemies: { ember: enemy() }, stages: { gauntlet: stage({ music: 'vigil' }) } },
        { vigil: { file: 'vigil.wav' } },
      ),
      CTX,
    );
    expect(getStage(`${name}/gauntlet`).music).toBe('vigil');
  });

  test('an unknown stage track is a golden error', () => {
    const name = uniqueName();
    expect(
      problemsOf(
        manifest(name, { enemies: { ember: enemy() }, stages: { gauntlet: stage({ music: 'nope' }) } }),
      ),
    ).toContain(
      `pack "${name}": stage "gauntlet" names unknown music "nope" — no such music in this pack or built in`,
    );
  });

  test('an unknown boss track is a golden error', () => {
    const name = uniqueName();
    expect(
      problemsOf(
        manifest(name, {
          enemies: { ember: enemy() },
          bosses: { warlord: boss({ music: 'nope' }) },
          stages: {
            gauntlet: { entry: true, boss: 'warlord', waves: [{ at: 0, enemy: 'ember', x: 0, y: 0 }] },
          },
        }),
      ),
    ).toContain(
      `pack "${name}": boss "warlord" names unknown music "nope" — no such music in this pack or built in`,
    );
  });
});

describe('content.bosses — atomicity with a bad boss', () => {
  test('a good boss alongside a bad one leaves neither registered', () => {
    const name = uniqueName();
    const m = manifest(name, {
      enemies: { ember: enemy() },
      bosses: {
        warlord: boss(),
        broken: boss({ sprite: 'no-such-sprite' }),
      },
      stages: {
        gauntlet: {
          entry: true,
          waves: [
            { at: 0, enemy: 'ember', x: 0, y: 0 },
            { at: 60, boss: 'warlord' },
            { at: 120, boss: 'broken' },
          ],
        },
      },
    });
    expect(() => injectPack(m, CTX)).toThrow(PackInjectError);
    expect(hasBoss(`${name}/warlord`)).toBe(false);
    expect(hasBoss(`${name}/broken`)).toBe(false);
    expect(hasStage(`${name}/gauntlet`)).toBe(false);
  });
});

describe('content.bosses — name resolution errors are golden', () => {
  /** A pack whose single boss is referenced by its entry stage, so only the boss's own error shows. */
  function packWithBoss(name: string, over: Partial<ContentBoss>): PackManifest {
    return manifest(name, {
      enemies: { ember: enemy() },
      bosses: { warlord: boss(over) },
      stages: {
        gauntlet: { entry: true, boss: 'warlord', waves: [{ at: 0, enemy: 'ember', x: 0, y: 0 }] },
      },
    });
  }

  test('unknown boss sprite', () => {
    const name = uniqueName();
    expect(problemsOf(packWithBoss(name, { sprite: 'orb.huge' }))).toContain(
      `pack "${name}": boss "warlord" uses unknown sprite "orb.huge" — known sprites: halo, orb.large, ring, shard`,
    );
  });

  test('no phases', () => {
    const name = uniqueName();
    expect(problemsOf(packWithBoss(name, { phases: [] }))).toContain(
      `pack "${name}": boss "warlord" declares no phases — a boss needs at least one phase`,
    );
  });

  test('non-positive hpSeconds', () => {
    const name = uniqueName();
    expect(problemsOf(packWithBoss(name, {
      phases: [{ name: 'opening', hpSeconds: 0, patterns: [{ pattern: 'ring' }] }],
    }))).toContain(
      `pack "${name}": boss "warlord" phase "opening": hpSeconds must be positive, got 0`,
    );
  });

  test('hpSeconds beyond the ceiling reads as a ticks-for-seconds units error', () => {
    const name = uniqueName();
    expect(problemsOf(packWithBoss(name, {
      phases: [{ name: 'opening', hpSeconds: 1800, patterns: [{ pattern: 'ring' }] }],
    }))).toContain(
      `pack "${name}": boss "warlord" phase "opening": hpSeconds 1800 exceeds the ceiling of 180 — hpSeconds is SECONDS of intended drain, not ticks`,
    );
  });

  test('unknown pattern names patterns as engine code', () => {
    const name = uniqueName();
    expect(problemsOf(packWithBoss(name, {
      phases: [{ name: 'opening', hpSeconds: 10, patterns: [{ pattern: 'sprial' }] }],
    }))).toContain(
      `pack "${name}": boss "warlord" phase "opening" uses unknown pattern "sprial" — patterns are engine code, not pack data; no such pattern is registered`,
    );
  });

  test('unknown per-card background', () => {
    const name = uniqueName();
    expect(problemsOf(packWithBoss(name, {
      phases: [{ name: 'opening', hpSeconds: 10, background: 'nebula', patterns: [{ pattern: 'ring' }] }],
    }))).toContain(
      `pack "${name}": boss "warlord" phase "opening" is set in unknown background "nebula" — known backgrounds: expanse, undertow`,
    );
  });

  test('unknown onDeath effect', () => {
    const name = uniqueName();
    expect(problemsOf(packWithBoss(name, { onDeath: 'sparkl' }))).toContain(
      `pack "${name}": boss "warlord" onDeath names unknown effect "sparkl" — no such effect in this pack or built in`,
    );
  });

  test('unknown spoils item', () => {
    const name = uniqueName();
    expect(problemsOf(packWithBoss(name, { spoils: [['powr', 1]] }))).toContain(
      `pack "${name}": boss "warlord" drops unknown item "powr" — no such item in this pack or built in`,
    );
  });
});

describe('content.bosses — reachability (registration is not reachability)', () => {
  test('a pack boss no stage names is dead content', () => {
    const name = uniqueName();
    expect(problemsOf(manifest(name, {
      enemies: { ember: enemy() },
      bosses: { warlord: boss(), ghost: boss() },
      stages: {
        gauntlet: { entry: true, boss: 'warlord', waves: [{ at: 0, enemy: 'ember', x: 0, y: 0 }] },
      },
    }))).toContain(
      `pack "${name}": boss "ghost" is named by no stage of this pack — dead content (registration is not reachability)`,
    );
  });
});

/* ------------------------------------------------------------------ */
/* The pure-data tier: shots, options, bombs, effects, items,          */
/* characters                                                          */
/* ------------------------------------------------------------------ */

/**
 * A pack that exercises every new section at least once and wires them all so
 * nothing is dead content: a character fires a pack shot, equips a pack option
 * and a pack bomb; the bomb throws a pack effect; an enemy drops a pack item and
 * triggers the same pack effect on death; a stage spawns the enemy.
 */
function fullDataPack(name: string): PackManifest {
  return manifest(name, {
    shots: {
      blaster: {
        levels: [
          {
            spec: { style: { sprite: 'shard' }, radius: 4, motion: { r: 9, theta: 270 }, damage: 1 },
            offsets: [{ x: 0, y: -10, angle: 270 }],
            period: 5,
          },
        ],
      },
    },
    options: {
      wing: {
        sprite: 'shard',
        shot: { style: { sprite: 'shard' }, radius: 3, motion: { r: 8, theta: 270 } },
        period: 6,
        levels: [[{ x: -20, y: 0, focusX: -8, focusY: 0 }]],
      },
    },
    bombs: { nova: { duration: 120, invulnTicks: 150, damagePerTick: 3, effect: 'flash' } },
    effects: { flash: { sprite: 'shard', count: 8, speed: 2, life: 30 } },
    items: { crystal: { sprite: 'shard', radius: 12, value: 1, kind: 'power' } },
    characters: {
      raider: { label: 'RAIDER', shot: 'blaster', options: 'wing', bomb: 'nova', sprite: 'ship', player: player() },
    },
    enemies: { grunt: enemy({ spoils: [['crystal', 1]], onDeath: 'flash' }) },
    stages: { field: { entry: true, waves: [{ at: 0, enemy: 'grunt', x: 100, y: -20 }] } },
  });
}

describe('the data tier registers into the real registries under qualified names', () => {
  test('every new kind lands, and cross-references resolve pack-first', () => {
    const name = uniqueName();
    const result = injectPack(fullDataPack(name), CTX);

    // Each kind is registered under its qualified name.
    expect(() => getShot(`${name}/blaster`)).not.toThrow();
    expect(() => getOptionSpec(`${name}/wing`)).not.toThrow();
    expect(() => getBombSpec(`${name}/nova`)).not.toThrow();
    expect(() => getEffectSpec(`${name}/flash`)).not.toThrow();
    expect(() => getItemSpec(`${name}/crystal`)).not.toThrow();
    expect(() => getCharacter(`${name}/raider`)).not.toThrow();

    // The shot registry stamps the qualified name onto the type.
    expect(getShot(`${name}/blaster`).name).toBe(`${name}/blaster`);

    // The character resolves its shot into the levels ladder, its option set and
    // bomb into the qualified names the run resolves later.
    const raider = getCharacter(`${name}/raider`);
    expect(raider.player.shots).toBe(getShot(`${name}/blaster`).levels);
    expect(raider.options).toBe(`${name}/wing`);
    expect(raider.bomb).toBe(`${name}/nova`);

    // A bomb's effect, an enemy's onDeath effect and its spoils item all qualify
    // pack-first to the pack's own entries.
    expect(getBombSpec(`${name}/nova`).effect).toBe(`${name}/flash`);
    const grunt = getEnemySpec(`${name}/grunt`);
    expect(grunt.onDeath).toBe(`${name}/flash`);
    expect(grunt.spoils).toEqual([[`${name}/crystal`, 1]]);

    // The pack reports its qualified character names for the shell to pair with
    // the pack identity (the pack-character replay wire).
    expect(result.characters).toEqual([`${name}/raider`]);
  });

  test('a character may fire a BUILT-IN shot; the reference stays bare', () => {
    const name = uniqueName();
    injectPack(
      manifest(name, {
        characters: {
          scout2: { label: 'S2', shot: 'spread', options: 'standard', bomb: 'spread', sprite: 'ship', player: player() },
        },
      }),
      CTX,
    );
    // `spread` is a built-in shot; the character's ladder is the built-in's.
    expect(getCharacter(`${name}/scout2`).player.shots).toBe(getShot('spread').levels);
    expect(getCharacter(`${name}/scout2`).options).toBe('standard');
  });
});

describe('the data tier — name resolution errors are golden', () => {
  test('a shot level naming an unknown sprite', () => {
    const name = uniqueName();
    expect(problemsOf(manifest(name, {
      shots: { blaster: { levels: [{ spec: { style: { sprite: 'nope' } }, offsets: [], period: 5 }] } },
      characters: { raider: { label: 'R', shot: 'blaster', options: 'standard', bomb: 'spread', sprite: 'ship', player: player() } },
    }))).toContain(
      `pack "${name}": shot "blaster" level 0 uses unknown sprite "nope" — known sprites: halo, orb.large, ring, shard`,
    );
  });

  test('a character firing an unknown shot', () => {
    const name = uniqueName();
    expect(problemsOf(manifest(name, {
      characters: { raider: { label: 'R', shot: 'phantom', options: 'standard', bomb: 'spread', sprite: 'ship', player: player() } },
    }))).toContain(
      `pack "${name}": character "raider" fires unknown shot "phantom" — no such shot in this pack or built in`,
    );
  });

  // The regression the browser caught and every headless fixture missed: a
  // character validates against the SHIP sheet, and a bullet cell — however
  // valid for everything else — is not on it. The pooled-set version of this
  // check accepted 'ship' on enemies and would have accepted 'orb.large' here.
  test('a character wearing a bullet cell is rejected', () => {
    const name = uniqueName();
    expect(problemsOf(manifest(name, {
      characters: { raider: { label: 'R', shot: 'spread', options: 'standard', bomb: 'spread', sprite: 'orb.large', player: player() } },
    }))).toContain(
      `pack "${name}": character "raider" uses unknown ship sprite "orb.large" — characters wear the ship sheet; known ship sprites: ship`,
    );
  });

  test('a character equipping an unknown bomb', () => {
    const name = uniqueName();
    expect(problemsOf(manifest(name, {
      characters: { raider: { label: 'R', shot: 'spread', options: 'standard', bomb: 'phantom', sprite: 'ship', player: player() } },
    }))).toContain(
      `pack "${name}": character "raider" equips unknown bomb "phantom" — no such bomb in this pack or built in`,
    );
  });

  test('a bomb naming an unknown effect', () => {
    const name = uniqueName();
    expect(problemsOf(manifest(name, {
      bombs: { nova: { duration: 1, invulnTicks: 1, damagePerTick: 1, effect: 'nope' } },
      characters: { raider: { label: 'R', shot: 'spread', options: 'standard', bomb: 'nova', sprite: 'ship', player: player() } },
    }))).toContain(
      `pack "${name}": bomb "nova" names unknown effect "nope" — no such effect in this pack or built in`,
    );
  });

  test('an effect naming an unknown sprite', () => {
    const name = uniqueName();
    expect(problemsOf(manifest(name, {
      effects: { flash: { sprite: 'nope', count: 1, speed: 1, life: 1 } },
      enemies: { grunt: enemy({ onDeath: 'flash' }) },
      stages: { field: { entry: true, waves: [{ at: 0, enemy: 'grunt', x: 0, y: 0 }] } },
    }))).toContain(
      `pack "${name}": effect "flash" uses unknown sprite "nope" — known sprites: halo, orb.large, ring, shard`,
    );
  });

  test('a pack enemy onDeath naming an unknown effect — the gap the section closes', () => {
    const name = uniqueName();
    expect(problemsOf(manifest(name, {
      enemies: { grunt: enemy({ onDeath: 'phantom' }) },
      stages: { field: { entry: true, waves: [{ at: 0, enemy: 'grunt', x: 0, y: 0 }] } },
    }))).toContain(
      `pack "${name}": enemy "grunt" onDeath names unknown effect "phantom" — no such effect in this pack or built in`,
    );
  });
});

describe('the data tier — reachability (registration is not reachability)', () => {
  test('a pack shot no character fires is dead content', () => {
    const name = uniqueName();
    expect(problemsOf(manifest(name, {
      shots: { blaster: { levels: [{ spec: { style: { sprite: 'shard' } }, offsets: [], period: 5 }] } },
    }))).toContain(
      `pack "${name}": shot "blaster" is fired by no character of this pack — dead content (registration is not reachability)`,
    );
  });

  test('a pack option no character equips is dead content', () => {
    const name = uniqueName();
    expect(problemsOf(manifest(name, {
      options: { wing: { sprite: 'shard', shot: { style: { sprite: 'shard' } }, period: 6, levels: [[]] } },
    }))).toContain(
      `pack "${name}": options "wing" are equipped by no character of this pack — dead content (registration is not reachability)`,
    );
  });

  test('a pack effect nothing triggers is dead content', () => {
    const name = uniqueName();
    expect(problemsOf(manifest(name, {
      effects: { flash: { sprite: 'shard', count: 1, speed: 1, life: 1 } },
    }))).toContain(
      `pack "${name}": effect "flash" is triggered by no enemy, boss or bomb of this pack — dead content (registration is not reachability)`,
    );
  });

  test('a pack item nothing drops is dead content', () => {
    const name = uniqueName();
    expect(problemsOf(manifest(name, {
      items: { crystal: { sprite: 'shard', radius: 12, value: 1, kind: 'power' } },
    }))).toContain(
      `pack "${name}": item "crystal" is dropped by no enemy or boss of this pack — dead content (registration is not reachability)`,
    );
  });
});

describe('the data tier — atomic (a bad entry lands none of the pack)', () => {
  test('an unresolved character shot rejects the whole pack, registering nothing', () => {
    const name = uniqueName();
    expect(() => injectPack(manifest(name, {
      shots: { blaster: { levels: [{ spec: { style: { sprite: 'shard' } }, offsets: [], period: 5 }] } },
      characters: { raider: { label: 'R', shot: 'phantom', options: 'standard', bomb: 'spread', sprite: 'ship', player: player() } },
    }), CTX)).toThrow(PackInjectError);

    // The pack's own valid shot never registered — the rejection is whole.
    expect(() => getShot(`${name}/blaster`)).toThrow();
  });
});
