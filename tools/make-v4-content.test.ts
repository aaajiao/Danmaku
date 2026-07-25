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
  options?: {
    [key: string]: unknown;
    spec?: {
      [key: string]: unknown;
      style?: { [key: string]: unknown; sprite?: string };
    };
    form?: string;
    role?: string;
    anchor?: number;
  };
  difficulty?: unknown;
  startAt?: number;
  stopAt?: number;
}

interface BossPhaseProbe {
  name: string;
  patterns: PatternSlotProbe[];
  motion?: {
    r?: number;
    behaviour?: string;
    options?: Record<string, unknown>;
  };
}

function spatialSignature(patterns: readonly PatternSlotProbe[]): string {
  return patterns.map((slot) => (
    `${slot.pattern}:${slot.options?.spec?.style?.sprite ?? '<no-sprite>'}`
  )).join('|');
}

/**
 * Canonical simulation-bearing shape of a value.
 *
 * Bullet `style` and the `anchor` marker are presentation only: changing a
 * projectile cell or moving the one visual anchor must not make two identical
 * attacks look distinct to this guard. Everything else — pattern/form/role,
 * bullet motion and collision geometry, tier overrides and slot timing — stays.
 */
function simulationShape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(simulationShape);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (key === 'style' || key === 'anchor') continue;
      const field = (value as Record<string, unknown>)[key];
      if (field !== undefined) out[key] = simulationShape(field);
    }
    return out;
  }
  return value;
}

function simulationSignature(value: unknown): string {
  return JSON.stringify(simulationShape(value));
}

function phaseAttackSignature(patterns: readonly PatternSlotProbe[]): string {
  return simulationSignature(patterns.map((slot) => ({
    pattern: slot.pattern,
    options: slot.options,
    difficulty: slot.difficulty,
    startAt: slot.startAt,
    stopAt: slot.stopAt,
  })));
}

const SHARED_PATTERN_NAMES = new Set([
  'ring',
  'spiral',
  'aimed-fan',
  'spray',
  'alternating-fan',
  'gap-ring',
  'weave',
  'lane-wall',
]);

const MAIN_BOSS_CONTRACT = {
  sentinel: {
    family: 'moon-gate',
    movement: 'lunar-arc',
    phases: [
      { form: 'scan', roles: ['sweep', 'wheel'], anchor: 'wheel' },
      { form: 'corolla', roles: ['tide', 'stamen'], anchor: 'tide' },
      { form: 'vigil', roles: ['iris', 'wheel', 'crosshair'], anchor: 'wheel' },
      { form: 'eclipse', roles: ['corona', 'closure', 'occlusion'], anchor: 'closure' },
    ],
  },
  magistrate: {
    family: 'verdict-shear',
    movement: 'verdict-dash',
    phases: [
      { form: 'arraignment', roles: ['summons', 'docket', 'ruling'], anchor: 'ruling' },
      { form: 'pursuit', roles: ['hooks', 'escrow', 'judgment'], anchor: 'escrow' },
      { form: 'colonnade', roles: ['columns', 'hardening'], anchor: 'hardening' },
      { form: 'assize', roles: ['docket', 'seal', 'columns', 'scissor'], anchor: 'scissor' },
    ],
  },
  chancellor: {
    family: 'archive-trace',
    movement: 'archive-stamp',
    phases: [
      { form: 'appeal', roles: ['trace', 'margins'], anchor: 'trace' },
      { form: 'precedent', roles: ['binding', 'chain'], anchor: 'chain' },
      { form: 'wax', roles: ['imprint', 'witness', 'service'], anchor: 'witness' },
      { form: 'assay', roles: ['rake', 'staves', 'trace', 'underline'], anchor: 'trace' },
      { form: 'estoppel', roles: ['bars', 'redaction'], anchor: 'redaction' },
      { form: 'sealed', roles: ['overprint', 'trace', 'closure'], anchor: 'trace' },
    ],
  },
  regent: {
    family: 'memory-groove',
    movement: 'memory-loom',
    phases: [
      { form: 'session', roles: ['pressure', 'groove'], anchor: 'groove' },
      { form: 'corolla', roles: ['inner', 'outer', 'groove'], anchor: 'groove' },
      { form: 'portcullis', roles: ['lattice', 'groove'], anchor: 'groove' },
      { form: 'attainder', roles: ['warrants', 'groove', 'edict'], anchor: 'groove' },
      { form: 'statute', roles: ['wheel', 'groove', 'inscribe'], anchor: 'groove' },
      { form: 'sine-die', roles: ['unwind', 'groove', 'peel'], anchor: 'groove' },
    ],
  },
} as const;

type MainBossName = keyof typeof MAIN_BOSS_CONTRACT;
const MAIN_BOSS_NAMES = Object.keys(MAIN_BOSS_CONTRACT) as MainBossName[];

function finiteOption(options: Record<string, unknown>, name: string, where: string): number {
  const value = options[name];
  expect(typeof value, `${where}.${name}`).toBe('number');
  expect(Number.isFinite(value), `${where}.${name}`).toBe(true);
  return value as number;
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

test('attack signatures ignore projectile presentation rather than blessing a reskin', () => {
  const base: PatternSlotProbe[] = [{
    pattern: 'moon-gate',
    options: {
      form: 'scan',
      role: 'wheel',
      anchor: 1,
      count: 18,
      spec: {
        radius: 4,
        motion: { r: 2, theta: 90 },
        style: { sprite: 'petal.blue', r: 0.5, g: 0.8, b: 1 },
      },
    },
  }];
  const reskin: PatternSlotProbe[] = [{
    pattern: 'moon-gate',
    options: {
      form: 'scan',
      role: 'wheel',
      count: 18,
      spec: {
        radius: 4,
        motion: { r: 2, theta: 90 },
        style: { sprite: 'needle.red', r: 1, g: 0.2, b: 0.2 },
      },
    },
  }];
  const changedGeometry: PatternSlotProbe[] = [{
    ...reskin[0]!,
    options: {
      ...reskin[0]!.options,
      count: 19,
    },
  }];

  expect(phaseAttackSignature(base)).toBe(phaseAttackSignature(reskin));
  expect(phaseAttackSignature(base)).not.toBe(phaseAttackSignature(changedGeometry));
});

test('the four main Bosses own disjoint attack and movement vocabularies in every phase', () => {
  const pack = JSON.parse(buildV4ContentJson()) as {
    content: {
      bosses: Record<string, { phases: BossPhaseProbe[] }>;
    };
  };

  expect(Object.keys(pack.content.bosses)).toHaveLength(5);
  expect(new Set(MAIN_BOSS_NAMES.map((name) => MAIN_BOSS_CONTRACT[name].family)).size)
    .toBe(MAIN_BOSS_NAMES.length);
  expect(new Set(MAIN_BOSS_NAMES.map((name) => MAIN_BOSS_CONTRACT[name].movement)).size)
    .toBe(MAIN_BOSS_NAMES.length);

  const ownerFamilies = new Set<string>(
    MAIN_BOSS_NAMES.map((name) => MAIN_BOSS_CONTRACT[name].family),
  );
  const warden = pack.content.bosses['warden'];
  expect(warden).toBeDefined();
  for (const phase of warden?.phases ?? []) {
    expect(
      phase.patterns.some((slot) => ownerFamilies.has(slot.pattern)),
      `warden/${phase.name} must not consume a main-Boss family`,
    ).toBe(false);
  }

  const allAttackSignatures = new Map<string, string>();
  for (const bossName of MAIN_BOSS_NAMES) {
    const boss = pack.content.bosses[bossName];
    const contract = MAIN_BOSS_CONTRACT[bossName];
    expect(boss, bossName).toBeDefined();
    expect(boss!.phases, bossName).toHaveLength(contract.phases.length);

    const attackSignatures = new Set<string>();
    const movementSignatures = new Set<string>();
    for (let phaseIndex = 0; phaseIndex < contract.phases.length; phaseIndex++) {
      const phase = boss!.phases[phaseIndex];
      const expected = contract.phases[phaseIndex];
      const where = `${bossName}/${phase?.name ?? `phase-${phaseIndex}`}`;
      expect(phase, where).toBeDefined();
      expect(phase!.patterns, where).toHaveLength(expected!.roles.length);

      expect(
        phase!.patterns.map((slot) => slot.pattern),
        `${where} pattern family`,
      ).toEqual(new Array(expected!.roles.length).fill(contract.family));
      expect(
        phase!.patterns.some((slot) => SHARED_PATTERN_NAMES.has(slot.pattern)),
        `${where} must not fall back to shared attack vocabulary`,
      ).toBe(false);
      expect(
        phase!.patterns.map((slot) => slot.options?.form),
        `${where} form`,
      ).toEqual(new Array(expected!.roles.length).fill(expected!.form));
      expect(
        phase!.patterns.map((slot) => slot.options?.role),
        `${where} role order`,
      ).toEqual([...expected!.roles]);

      const anchors = phase!.patterns.filter((slot) => slot.options?.anchor === 1);
      expect(anchors, `${where} visual anchor`).toHaveLength(1);
      expect(anchors[0]!.options?.role, `${where} anchor role`).toBe(expected!.anchor);
      for (const slot of phase!.patterns) {
        const marked = slot.options?.role === expected!.anchor;
        expect(
          slot.options?.anchor,
          `${where}/${slot.options?.role ?? '<missing-role>'} anchor marker`,
        ).toBe(marked ? 1 : undefined);
      }

      const attackSignature = phaseAttackSignature(phase!.patterns);
      expect(attackSignatures.has(attackSignature), `${where} repeats an attack geometry`).toBe(false);
      const priorAttack = allAttackSignatures.get(attackSignature);
      expect(priorAttack, `${where} repeats ${priorAttack ?? '<none>'}`).toBeUndefined();
      attackSignatures.add(attackSignature);
      allAttackSignatures.set(attackSignature, where);

      const motion = phase!.motion;
      expect(motion, `${where} movement`).toBeDefined();
      expect(motion?.behaviour, `${where} movement family`).toBe(contract.movement);
      const options = motion?.options;
      expect(options, `${where} movement options`).toBeDefined();
      if (options === undefined) continue;

      finiteOption(options, 'centerX', `${where}.motion.options`);
      finiteOption(options, 'centerY', `${where}.motion.options`);
      const spanX = finiteOption(options, 'spanX', `${where}.motion.options`);
      const spanY = finiteOption(options, 'spanY', `${where}.motion.options`);
      const maxSpeed = finiteOption(options, 'maxSpeed', `${where}.motion.options`);
      expect(spanX, `${where}.motion.options.spanX`).toBeGreaterThanOrEqual(0);
      expect(spanY, `${where}.motion.options.spanY`).toBeGreaterThanOrEqual(0);
      expect(
        spanX > 0 || spanY > 0,
        `${where} must author a non-zero movement span`,
      ).toBe(true);
      expect(maxSpeed, `${where}.motion.options.maxSpeed`).toBeGreaterThan(0);
      expect(finiteOption(options, 'duration', `${where}.motion.options`)).toBe(4096);

      if (contract.movement === 'lunar-arc' || contract.movement === 'memory-loom') {
        const period = finiteOption(options, 'period', `${where}.motion.options`);
        expect(Number.isInteger(period), `${where}.motion.options.period`).toBe(true);
        expect(period, `${where}.motion.options.period`).toBeGreaterThan(0);
      }
      if (contract.movement === 'verdict-dash' || contract.movement === 'archive-stamp') {
        const interval = finiteOption(options, 'interval', `${where}.motion.options`);
        const travel = finiteOption(options, 'travel', `${where}.motion.options`);
        expect(Number.isInteger(interval), `${where}.motion.options.interval`).toBe(true);
        expect(Number.isInteger(travel), `${where}.motion.options.travel`).toBe(true);
        expect(interval, `${where}.motion.options.interval`).toBeGreaterThan(0);
        expect(travel, `${where}.motion.options.travel`).toBeGreaterThan(0);
        expect(travel, `${where}.motion.options.travel <= interval`).toBeLessThanOrEqual(interval);
      }
      if (contract.movement === 'memory-loom') {
        const lobes = finiteOption(options, 'lobes', `${where}.motion.options`);
        expect(Number.isInteger(lobes), `${where}.motion.options.lobes`).toBe(true);
        expect(lobes, `${where}.motion.options.lobes`).toBeGreaterThanOrEqual(2);
      }

      movementSignatures.add(simulationSignature(options));
    }
    expect(attackSignatures.size, `${bossName} attack signatures`).toBe(contract.phases.length);
    expect(movementSignatures.size, `${bossName} movement options`).toBe(contract.phases.length);
  }
  expect(allAttackSignatures.size).toBe(V4_BOSS_PHASE_VISUALS.length);
});

test('all 20 main Boss phases fire their unique presentation anchor', () => {
  const pack = JSON.parse(buildV4ContentJson()) as {
    content: {
      bosses: Record<string, { phases: BossPhaseProbe[] }>;
    };
  };

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
    const anchors = phase!.patterns.filter((slot) => slot.options?.anchor === 1);
    expect(anchors, `${visual.boss}/${phase!.name}`).toHaveLength(1);
    expect(
      anchors[0]?.options?.spec?.style?.sprite,
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
