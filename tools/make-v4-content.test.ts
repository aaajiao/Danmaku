/**
 * Drift guard for the generated v4 campaign.
 *
 * `src/v4/content/campaign.json` is committed, and `tools/make-v4-content.ts`
 * assembles it from structural/simulation authoring plus the edition-owned words
 * in `src/v4/content/narrative.ts` — the JSON is machinery. If someone edits the
 * JSON by hand, or edits either source without regenerating, the two diverge and
 * the commentary stops describing the shipped pack. This regenerates in memory
 * and byte-diffs.
 *
 * A failure means exactly one action: run `bun tools/make-v4-content.ts` and
 * commit the result (having first confirmed the change was intended — the replay
 * traces in `src/base-content.golden.test.ts` prove whether it moves gameplay).
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { expect, test } from 'bun:test';

import { V4_BOSS_PHASE_VISUALS } from '../src/v4/presentation/boss-phase-visuals';
import {
  V4_CONTENT_FINGERPRINT_PATH,
  V4_CONTENT_PATH,
  V4_GAMEPLAY_FINGERPRINT_PATHS,
  buildV4ContentFingerprint,
  buildV4ContentJson,
  fingerprintV4Edition,
} from './make-v4-content';

test('the committed v4 campaign is byte-identical to the generator output', () => {
  const committed = readFileSync(V4_CONTENT_PATH, 'utf8');
  const generated = buildV4ContentJson();
  // Compare lengths first so a size mismatch reports as a number, not a wall of
  // diff, then the exact-equality assertion pins the content.
  expect(generated.length).toBe(committed.length);
  expect(generated).toBe(committed);
});

test('the committed v4 edition fingerprint is byte-identical to the generator output', () => {
  // The fingerprint is derived from campaign JSON plus compiled pattern and
  // behaviour source. Drift means one of those changed without regeneration, or
  // the generated module was hand-edited. One generator command fixes either.
  const committed = readFileSync(V4_CONTENT_FINGERPRINT_PATH, 'utf8');
  const generated = buildV4ContentFingerprint();
  expect(generated.length).toBe(committed.length);
  expect(generated).toBe(committed);
});

test('the replay identity changes for data and executable danmaku independently', () => {
  const campaign = buildV4ContentJson();
  const gameplay = V4_GAMEPLAY_FINGERPRINT_PATHS.map(
    (path): readonly [string, string] => [basename(path), readFileSync(path, 'utf8')],
  );
  const baseline = fingerprintV4Edition(campaign, gameplay);

  expect(fingerprintV4Edition(`${campaign}\n`, gameplay)).not.toBe(baseline);
  expect(
    fingerprintV4Edition(campaign, gameplay.map((entry, index) => (
      index === 0 ? [entry[0], `${entry[1]}\n// algorithm probe`] as const : entry
    ))),
  ).not.toBe(baseline);
});

interface PatternSlotProbe {
  pattern: string;
  options?: { spec?: { style?: { sprite?: string } } };
}

function spatialSignature(patterns: readonly PatternSlotProbe[]): string {
  return patterns.map((slot) => (
    `${slot.pattern}:${slot.options?.spec?.style?.sprite ?? '<no-sprite>'}`
  )).join('|');
}

test('all sixteen enemy roles have a distinct authored danmaku signature', () => {
  const pack = JSON.parse(buildV4ContentJson()) as {
    content: { enemies: Record<string, { patterns?: PatternSlotProbe[] }> };
  };
  const entries = Object.entries(pack.content.enemies);
  expect(entries).toHaveLength(16);

  const seen = new Map<string, string>();
  for (const [name, enemy] of entries) {
    expect(enemy.patterns?.length ?? 0).toBeGreaterThanOrEqual(1);
    const signature = spatialSignature(enemy.patterns ?? []);
    expect(seen.get(signature)).toBeUndefined();
    seen.set(signature, name);
  }
  expect(seen.size).toBe(entries.length);
});

test('every shipped actor has a closed hit material and the four profiles are represented', () => {
  const pack = JSON.parse(buildV4ContentJson()) as {
    content: { enemies: Record<string, { hitMaterial?: string }>; bosses: Record<string, { hitMaterial?: string }> };
  };
  const materials = new Set(['surface', 'skeleton', 'mycelium', 'heart']);
  const seen = new Set<string>();
  for (const actor of [...Object.values(pack.content.enemies), ...Object.values(pack.content.bosses)]) {
    expect(materials.has(actor.hitMaterial ?? '')).toBe(true);
    seen.add(actor.hitMaterial!);
  }
  expect(seen).toEqual(materials);
  expect(Object.fromEntries(Object.entries(pack.content.bosses).map(([name, actor]) => (
    [name, actor.hitMaterial]
  )))).toEqual({
    sentinel: 'surface',
    warden: 'skeleton',
    magistrate: 'mycelium',
    chancellor: 'surface',
    regent: 'heart',
  });
});

test('every main Boss carries one exclusive spatial verb through every phase', () => {
  const pack = JSON.parse(buildV4ContentJson()) as {
    content: {
      bosses: Record<string, { phases: { name: string; patterns: PatternSlotProbe[] }[] }>;
    };
  };
  const signatures = {
    sentinel: 'moon-gate',
    magistrate: 'verdict-shear',
    chancellor: 'archive-trace',
    regent: 'memory-groove',
  } as const;
  const signatureNames = new Set<string>(Object.values(signatures));
  const spriteOwner = new Map<string, string>();

  expect(Object.keys(pack.content.bosses)).toHaveLength(5);
  for (const [bossName, boss] of Object.entries(pack.content.bosses)) {
    expect(boss.phases.length).toBeGreaterThanOrEqual(3);

    const phaseSignatures = new Set<string>();
    for (const phase of boss.phases) {
      expect(phase.patterns.length).toBeGreaterThanOrEqual(2);
      const signature = spatialSignature(phase.patterns);
      expect(phaseSignatures.has(signature)).toBe(false);
      phaseSignatures.add(signature);

      if (bossName === 'warden') {
        expect(phase.patterns.some((slot) => signatureNames.has(slot.pattern))).toBe(false);
        continue;
      }

      const own = signatures[bossName as keyof typeof signatures];
      const identitySlots = phase.patterns.filter((slot) => signatureNames.has(slot.pattern));
      expect(identitySlots, `${bossName}/${phase.name}`).toHaveLength(1);
      expect(identitySlots[0]!.pattern, `${bossName}/${phase.name}`).toBe(own);

      const sprite = identitySlots[0]!.options?.spec?.style?.sprite;
      expect(typeof sprite, `${bossName}/${phase.name}`).toBe('string');
      const prior = spriteOwner.get(sprite!);
      expect(prior === undefined || prior === bossName, `${sprite} is shared by ${prior} and ${bossName}`).toBe(true);
      spriteOwner.set(sprite!, bossName);
    }
    expect(phaseSignatures.size).toBe(boss.phases.length);
  }
});

test('all 20 main Boss phases fire their unique presentation anchor', () => {
  const pack = JSON.parse(buildV4ContentJson()) as {
    content: {
      bosses: Record<string, { phases: { name: string; patterns: PatternSlotProbe[] }[] }>;
    };
  };
  const signatures = {
    sentinel: 'moon-gate',
    magistrate: 'verdict-shear',
    chancellor: 'archive-trace',
    regent: 'memory-groove',
  } as const;

  expect(V4_BOSS_PHASE_VISUALS).toHaveLength(20);
  expect(new Set(V4_BOSS_PHASE_VISUALS.map((visual) => visual.projectile)).size).toBe(20);
  expect(new Set(V4_BOSS_PHASE_VISUALS.map((visual) => visual.castStrip)).size).toBe(20);
  expect(new Set(V4_BOSS_PHASE_VISUALS.map((visual) => (
    `${visual.bulletSequence.frameW}x${visual.bulletSequence.frameH}/` +
    `${visual.bulletSequence.frames}@${visual.bulletSequence.ticksPerFrame}`
  ))).size).toBe(20);
  expect(new Set(V4_BOSS_PHASE_VISUALS.map((visual) => (
    `${visual.castSequence.frameW}x${visual.castSequence.frameH}/` +
    `${visual.castSequence.frames}@${visual.castSequence.ticksPerFrame}`
  ))).size).toBe(20);

  for (const visual of V4_BOSS_PHASE_VISUALS) {
    const phase = pack.content.bosses[visual.boss]?.phases[visual.phaseIndex];
    expect(phase, `${visual.boss} phase ${visual.phaseIndex}`).toBeDefined();
    const identity = phase!.patterns.filter(
      (slot) => slot.pattern === signatures[visual.boss],
    );
    expect(identity, `${visual.boss}/${phase!.name}`).toHaveLength(1);
    expect(
      identity[0]?.options?.spec?.style?.sprite,
      `${visual.boss}/${phase!.name}`,
    ).toBe(visual.projectile);
  }
});

test('every authored boss exchange leaves the player a voice', () => {
  const pack = JSON.parse(buildV4ContentJson()) as {
    content: {
      bosses: Record<string, {
        dialogue?: readonly { speaker: string; text: string }[];
        dialogueFor?: Readonly<Record<string, readonly { speaker: string; text: string }[]>>;
      }>;
    };
  };

  for (const [bossName, boss] of Object.entries(pack.content.bosses)) {
    const exchanges = [
      ['default', boss.dialogue] as const,
      ...Object.entries(boss.dialogueFor ?? {}),
    ];
    for (const [variant, lines] of exchanges) {
      expect(lines?.length ?? 0, `${bossName}/${variant}`).toBeGreaterThan(0);
      expect(
        lines?.some((line) => line.speaker === 'player'),
        `${bossName}/${variant}`,
      ).toBe(true);
    }
  }
});

interface PlayerShotTierProbe {
  spec: Record<string, unknown>;
  offsets: readonly Record<string, unknown>[];
  period: number;
  focused?: {
    spec?: Record<string, unknown>;
    offsets?: readonly Record<string, unknown>[];
    period?: number;
  };
}

test('all five player weapons author a distinct focus-held shot at every power tier', () => {
  const pack = JSON.parse(buildV4ContentJson()) as {
    content: { shots: Record<string, { levels: PlayerShotTierProbe[] }> };
  };
  const shots = Object.entries(pack.content.shots);
  expect(shots).toHaveLength(5);

  for (const [name, shot] of shots) {
    expect(shot.levels).toHaveLength(4);
    let previousFocused: { offsets: readonly Record<string, unknown>[]; period: number } | undefined;
    for (const [tier, level] of shot.levels.entries()) {
      expect(level.focused, `${name} tier ${tier}`).toBeDefined();
      const focused = {
        spec: level.focused?.spec ?? level.spec,
        offsets: level.focused?.offsets ?? level.offsets,
        period: level.focused?.period ?? level.period,
      };
      expect(JSON.stringify(focused), `${name} tier ${tier}`).not.toBe(JSON.stringify({
        spec: level.spec,
        offsets: level.offsets,
        period: level.period,
      }));
      if (previousFocused !== undefined) {
        expect(focused.offsets.length).toBeGreaterThanOrEqual(previousFocused.offsets.length);
        expect(focused.period).toBeLessThanOrEqual(previousFocused.period);
      }
      previousFocused = focused;
    }
  }
});

test('all player shot tiers preserve an explicit semantic contact-feedback family', () => {
  const pack = JSON.parse(buildV4ContentJson()) as {
    content: {
      shots: Record<string, { levels: PlayerShotTierProbe[] }>;
      options: Record<string, { shot: Record<string, unknown> }>;
    };
  };
  const expected = new Set(['needle', 'round', 'tracking', 'beam', 'scatter']);
  const seen = new Set<string>();

  for (const [name, shot] of Object.entries(pack.content.shots)) {
    for (const [tier, level] of shot.levels.entries()) {
      const feedback = level.spec.feedback;
      expect(typeof feedback, `${name} tier ${tier}`).toBe('string');
      expect(expected.has(feedback as string), `${name} tier ${tier}`).toBe(true);
      seen.add(feedback as string);

      const focusedFeedback = (level.focused?.spec ?? level.spec).feedback;
      expect(focusedFeedback, `${name} focused tier ${tier}`).toBe(feedback);
    }
  }
  for (const [name, option] of Object.entries(pack.content.options)) {
    const feedback = option.shot.feedback;
    expect(typeof feedback, `${name} option`).toBe('string');
    expect(expected.has(feedback as string), `${name} option`).toBe(true);
    seen.add(feedback as string);
  }
  expect(seen).toEqual(expected);
});

test('the five heroines do not share their shot, option formation, or bomb identity', () => {
  const pack = JSON.parse(buildV4ContentJson()) as {
    content: {
      characters: Record<string, { shot: string; options: string; bomb: string }>;
      shots: Record<string, unknown>;
      options: Record<string, unknown>;
      bombs: Record<string, unknown>;
    };
  };
  const characters = Object.values(pack.content.characters);
  expect(characters).toHaveLength(5);
  expect(new Set(characters.map((c) => c.shot)).size).toBe(5);
  expect(new Set(characters.map((c) => c.options)).size).toBe(5);
  expect(new Set(characters.map((c) => c.bomb)).size).toBe(5);
  expect(Object.keys(pack.content.shots)).toHaveLength(5);
  expect(Object.keys(pack.content.options)).toHaveLength(5);
  expect(Object.keys(pack.content.bombs)).toHaveLength(5);
});

test('the five bombs have five distinct gameplay signatures', () => {
  const pack = JSON.parse(buildV4ContentJson()) as {
    content: { bombs: Record<string, Record<string, unknown>> };
  };
  const bombs = Object.entries(pack.content.bombs);
  expect(bombs).toHaveLength(5);
  const signatures = bombs.map(([, spec]) => JSON.stringify(spec));
  expect(new Set(signatures).size).toBe(5);
});

test('every stage fields a mid-stage bomb carrier — a wave enemy whose spoils drop a bomb', () => {
  // The drop economy (decisions §B) restores bombs through play: each stage names
  // one trash type whose spoils include `bomb`, chosen so the stage hands back 2-4
  // mid-stage bombs on every tier. This is a data property nothing else pins — a
  // wave set can be re-authored to drop the carrier and the game still boots, still
  // clears, and every other test stays green while the economy silently regresses to
  // boss-only bombs. This asserts the invariant over the shipped pack directly, so
  // that regression fails the build. It counts only wave enemies, not the boss: the
  // point is bombs *before* the boss door, which a boss drop cannot supply.
  const pack = JSON.parse(readFileSync(V4_CONTENT_PATH, 'utf8'));
  const enemies: Record<string, { spoils?: [string, number][] }> = pack.content.enemies;
  const dropsBomb = (name: string): boolean =>
    (enemies[name]?.spoils ?? []).some(([kind]) => kind === 'bomb');

  const stages: Record<string, { waves: { enemy: string }[] }> = pack.content.stages;
  for (const stage of Object.values(stages)) {
    const carriers = [...new Set(stage.waves.map((w) => w.enemy))].filter(dropsBomb);
    expect(carriers.length).toBeGreaterThanOrEqual(1);
  }
});
