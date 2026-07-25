import { describe, expect, test } from 'bun:test';

import { createPattern, type EmitContext, type Pattern } from '../../content/pattern-registry';
import { Random } from '../../core/random';
import { atan2Deg } from '../../core/trig';
import { BulletSystem, type BulletSpec } from '../../sim/bullet';
import { V4_PATTERN_NAMES } from './patterns';

const SPEC: BulletSpec = {
  style: { sprite: 'orb.small' },
  radius: 3,
  motion: { r: 2, theta: -999 },
};

const NEW_PATTERNS = ['alternating-fan', 'gap-ring', 'weave', 'lane-wall'] as const;
const BOSS_PATTERNS = [
  'moon-gate',
  'verdict-shear',
  'archive-trace',
  'memory-groove',
] as const;
const DETERMINISTIC_PATTERNS = [...NEW_PATTERNS, ...BOSS_PATTERNS] as const;

interface FamilyCase {
  readonly pattern: (typeof BOSS_PATTERNS)[number];
  readonly form: string;
  readonly role: string;
}

const FAMILY_ROLES: readonly FamilyCase[] = [
  { pattern: 'moon-gate', form: 'scan', role: 'sweep' },
  { pattern: 'moon-gate', form: 'scan', role: 'wheel' },
  { pattern: 'moon-gate', form: 'corolla', role: 'tide' },
  { pattern: 'moon-gate', form: 'corolla', role: 'stamen' },
  { pattern: 'moon-gate', form: 'vigil', role: 'iris' },
  { pattern: 'moon-gate', form: 'vigil', role: 'wheel' },
  { pattern: 'moon-gate', form: 'vigil', role: 'crosshair' },
  { pattern: 'moon-gate', form: 'eclipse', role: 'corona' },
  { pattern: 'moon-gate', form: 'eclipse', role: 'closure' },
  { pattern: 'moon-gate', form: 'eclipse', role: 'occlusion' },

  { pattern: 'verdict-shear', form: 'arraignment', role: 'summons' },
  { pattern: 'verdict-shear', form: 'arraignment', role: 'docket' },
  { pattern: 'verdict-shear', form: 'arraignment', role: 'ruling' },
  { pattern: 'verdict-shear', form: 'pursuit', role: 'hooks' },
  { pattern: 'verdict-shear', form: 'pursuit', role: 'escrow' },
  { pattern: 'verdict-shear', form: 'pursuit', role: 'judgment' },
  { pattern: 'verdict-shear', form: 'colonnade', role: 'columns' },
  { pattern: 'verdict-shear', form: 'colonnade', role: 'hardening' },
  { pattern: 'verdict-shear', form: 'assize', role: 'docket' },
  { pattern: 'verdict-shear', form: 'assize', role: 'seal' },
  { pattern: 'verdict-shear', form: 'assize', role: 'columns' },
  { pattern: 'verdict-shear', form: 'assize', role: 'scissor' },

  { pattern: 'archive-trace', form: 'appeal', role: 'trace' },
  { pattern: 'archive-trace', form: 'appeal', role: 'margins' },
  { pattern: 'archive-trace', form: 'precedent', role: 'binding' },
  { pattern: 'archive-trace', form: 'precedent', role: 'chain' },
  { pattern: 'archive-trace', form: 'wax', role: 'imprint' },
  { pattern: 'archive-trace', form: 'wax', role: 'witness' },
  { pattern: 'archive-trace', form: 'wax', role: 'service' },
  { pattern: 'archive-trace', form: 'assay', role: 'rake' },
  { pattern: 'archive-trace', form: 'assay', role: 'staves' },
  { pattern: 'archive-trace', form: 'assay', role: 'trace' },
  { pattern: 'archive-trace', form: 'assay', role: 'underline' },
  { pattern: 'archive-trace', form: 'estoppel', role: 'bars' },
  { pattern: 'archive-trace', form: 'estoppel', role: 'redaction' },
  { pattern: 'archive-trace', form: 'sealed', role: 'overprint' },
  { pattern: 'archive-trace', form: 'sealed', role: 'trace' },
  { pattern: 'archive-trace', form: 'sealed', role: 'closure' },

  { pattern: 'memory-groove', form: 'session', role: 'pressure' },
  { pattern: 'memory-groove', form: 'session', role: 'groove' },
  { pattern: 'memory-groove', form: 'corolla', role: 'inner' },
  { pattern: 'memory-groove', form: 'corolla', role: 'outer' },
  { pattern: 'memory-groove', form: 'corolla', role: 'groove' },
  { pattern: 'memory-groove', form: 'portcullis', role: 'lattice' },
  { pattern: 'memory-groove', form: 'portcullis', role: 'groove' },
  { pattern: 'memory-groove', form: 'attainder', role: 'warrants' },
  { pattern: 'memory-groove', form: 'attainder', role: 'groove' },
  { pattern: 'memory-groove', form: 'attainder', role: 'edict' },
  { pattern: 'memory-groove', form: 'statute', role: 'wheel' },
  { pattern: 'memory-groove', form: 'statute', role: 'groove' },
  { pattern: 'memory-groove', form: 'statute', role: 'inscribe' },
  { pattern: 'memory-groove', form: 'sine-die', role: 'unwind' },
  { pattern: 'memory-groove', form: 'sine-die', role: 'groove' },
  { pattern: 'memory-groove', form: 'sine-die', role: 'peel' },
] as const;

/** One presentation-anchor role per authored main-Boss phase, in campaign order. */
const PHASE_FORMS: readonly FamilyCase[] = [
  { pattern: 'moon-gate', form: 'scan', role: 'wheel' },
  { pattern: 'moon-gate', form: 'corolla', role: 'tide' },
  { pattern: 'moon-gate', form: 'vigil', role: 'wheel' },
  { pattern: 'moon-gate', form: 'eclipse', role: 'closure' },
  { pattern: 'verdict-shear', form: 'arraignment', role: 'ruling' },
  { pattern: 'verdict-shear', form: 'pursuit', role: 'escrow' },
  { pattern: 'verdict-shear', form: 'colonnade', role: 'hardening' },
  { pattern: 'verdict-shear', form: 'assize', role: 'scissor' },
  { pattern: 'archive-trace', form: 'appeal', role: 'trace' },
  { pattern: 'archive-trace', form: 'precedent', role: 'chain' },
  { pattern: 'archive-trace', form: 'wax', role: 'witness' },
  { pattern: 'archive-trace', form: 'assay', role: 'trace' },
  { pattern: 'archive-trace', form: 'estoppel', role: 'redaction' },
  { pattern: 'archive-trace', form: 'sealed', role: 'trace' },
  { pattern: 'memory-groove', form: 'session', role: 'groove' },
  { pattern: 'memory-groove', form: 'corolla', role: 'groove' },
  { pattern: 'memory-groove', form: 'portcullis', role: 'groove' },
  { pattern: 'memory-groove', form: 'attainder', role: 'groove' },
  { pattern: 'memory-groove', form: 'statute', role: 'groove' },
  { pattern: 'memory-groove', form: 'sine-die', role: 'groove' },
] as const;

function system(capacity = 256): BulletSystem {
  return new BulletSystem({
    bounds: { width: 480, height: 640, margin: 48 },
    initial: capacity,
    max: capacity,
  });
}

function context(
  bullets: BulletSystem,
  age: number,
  overrides: Partial<EmitContext> = {},
): EmitContext {
  return {
    age,
    x: 100,
    y: 100,
    targetX: 100,
    targetY: 200,
    bullets,
    rng: new Random(0x5eed),
    faction: 'enemy',
    ...overrides,
  };
}

function drive(
  pattern: Pattern,
  bullets: BulletSystem,
  ticks: number,
  overrides: Partial<EmitContext> = {},
): number[] {
  const fired: number[] = [];
  for (let age = 0; age < ticks; age++) {
    const before = bullets.count;
    pattern(context(bullets, age, overrides));
    fired.push(bullets.count - before);
  }
  return fired;
}

function headings(bullets: BulletSystem): number[] {
  return bullets.bullets.map((bullet) => bullet.vector.theta);
}

function familyOptions(entry: FamilyCase): Record<string, unknown> {
  return {
    spec: SPEC,
    form: entry.form,
    role: entry.role,
    period: 1,
    delay: 2,
    trail: 1,
    count: 7,
    arms: 4,
    columns: 9,
    folios: 5,
    gates: 3,
    gap: 32,
    gapWidth: entry.form === 'portcullis' && entry.role === 'lattice' ? 2 : 72,
    radius: 34,
    rotation: 7,
    twist: 5,
    spread: 36,
    swing: 11,
    step: 9,
    spacing: 14,
    stagger: 3,
    speed: 2,
    driftScale: 3,
    maxDrift: 14,
    left: 0,
    right: 480,
  };
}

/**
 * A style-free spatial trace. It deliberately records only simulation facts,
 * so two forms cannot pass by changing a sprite/tint while emitting the same
 * attack.
 */
function familyTrace(
  entry: FamilyCase,
  movingSource = true,
  seed = 0x51a7,
  ticks = 18,
  optionOverrides: Readonly<Record<string, unknown>> = {},
  normalizeTranslation = false,
): string {
  const bullets = system(8192);
  const rng = new Random(seed);
  const pattern = createPattern(entry.pattern, {
    ...familyOptions(entry),
    ...optionOverrides,
  });
  const trace: (number | boolean)[][] = [];

  for (let age = 0; age < ticks; age++) {
    const before = bullets.count;
    const x = movingSource ? 170 + ((age * 17) % 140) : 240;
    const y = movingSource ? 88 + ((age * 5) % 24) : 96;
    pattern(context(bullets, age, {
      x,
      y,
      targetX: 60 + ((age * 29) % 360),
      targetY: 500 - ((age * 7) % 120),
      rng,
    }));
    for (const bullet of bullets.bullets.slice(before)) {
      trace.push([
        age,
        bullet.x,
        bullet.y,
        bullet.vector.theta,
        bullet.vector.r,
        bullet.radius,
        bullet.laser !== undefined,
        bullet.missile !== undefined,
      ]);
    }
  }

  if (normalizeTranslation && trace.length > 0) {
    const originX = trace[0]![1] as number;
    const originY = trace[0]![2] as number;
    return JSON.stringify(trace.map((row) => [
      row[0],
      (row[1] as number) - originX,
      (row[2] as number) - originY,
      ...row.slice(3),
    ]));
  }

  return JSON.stringify(trace);
}

/**
 * Removes only one global x/y translation from an executed trace. Relative
 * spawn geometry, timing, headings, speed and collision shape all remain, so a
 * phase cannot claim a unique attack merely by moving the same row downward.
 */
function normalizedFamilyTrace(
  entry: FamilyCase,
  optionOverrides: Readonly<Record<string, unknown>> = {},
): string {
  return familyTrace(entry, true, 0x51a7, 18, optionOverrides, true);
}

describe('v4 spatial pattern vocabulary', () => {
  test('the public inventory includes the shared and Boss-exclusive spatial patterns', () => {
    expect(V4_PATTERN_NAMES).toEqual(
      expect.arrayContaining([...DETERMINISTIC_PATTERNS]),
    );
  });

  test('every new pattern fails loudly when its bullet spec is missing', () => {
    for (const name of DETERMINISTIC_PATTERNS) {
      expect(() => createPattern(name)).toThrow(
        `pattern "${name}" requires a "spec" option`,
      );
    }
  });

  test('alternating-fan moves consecutive volleys to opposite sides of aim', () => {
    const bullets = system();
    const pattern = createPattern('alternating-fan', {
      spec: SPEC,
      count: 3,
      spread: 20,
      swing: 10,
      period: 2,
    });

    expect(drive(pattern, bullets, 3)).toEqual([3, 0, 3]);
    expect(headings(bullets)).toEqual([70, 80, 90, 90, 100, 110]);
  });

  test('gap-ring leaves the authored opening on the live player bearing', () => {
    const bullets = system();
    const pattern = createPattern('gap-ring', {
      spec: SPEC,
      count: 12,
      gap: 50,
      rotation: 7,
      period: 1,
    });

    pattern(context(bullets, 0, { targetX: 200, targetY: 100 }));

    expect(bullets.count).toBe(11);
    for (const theta of headings(bullets)) {
      const delta = ((theta + 540) % 360) - 180;
      expect(Math.abs(delta)).toBeGreaterThanOrEqual(25);
    }
  });

  test('gap-ring rotation advances even when the pool truncates a volley', () => {
    const bullets = system(2);
    const pattern = createPattern('gap-ring', {
      spec: SPEC,
      count: 8,
      gap: 1,
      rotation: 10,
      period: 1,
    });

    pattern(context(bullets, 0, { targetX: 200, targetY: 100 }));
    const first = headings(bullets);
    bullets.clear();
    pattern(context(bullets, 1, { targetX: 200, targetY: 100 }));

    expect(first).toEqual([45, 90]);
    expect(headings(bullets)).toEqual([10, 55]);
  });

  test('weave emits nested mirrored threads and moves their crossing', () => {
    const bullets = system();
    const pattern = createPattern('weave', {
      spec: SPEC,
      pairs: 2,
      amplitude: 30,
      step: 60,
      period: 1,
    });

    pattern(context(bullets, 0));
    pattern(context(bullets, 1));

    expect(headings(bullets).slice(0, 4)).toEqual([75, 105, 60, 120]);
    expect(headings(bullets).slice(4)).toEqual([82.5, 97.5, 75, 105]);
  });

  test('lane-wall places a wrapped multi-column opening inside authored bounds', () => {
    const bullets = system();
    const pattern = createPattern('lane-wall', {
      spec: SPEC,
      columns: 5,
      gapColumn: 2,
      gapWidth: 2,
      shift: 1,
      left: 0,
      right: 100,
      direction: 80,
      speed: 3,
      period: 1,
    });

    pattern(context(bullets, 0));
    expect(bullets.bullets.map((bullet) => bullet.x)).toEqual([10, 30, 90]);
    expect(headings(bullets)).toEqual([80, 80, 80]);
    expect(bullets.bullets.every((bullet) => bullet.vector.r === 3)).toBe(true);

    bullets.clear();
    pattern(context(bullets, 1));
    expect(bullets.bullets.map((bullet) => bullet.x)).toEqual([10, 30, 50]);
  });

  test('moon-gate declares three offset openings and a tangential tide', () => {
    const bullets = system();
    const pattern = createPattern('moon-gate', {
      spec: SPEC,
      count: 12,
      gates: 3,
      gap: 20,
      radius: 32,
      rotation: 0,
      twist: 7,
      period: 1,
    });

    pattern(context(bullets, 0, { targetX: 200, targetY: 100 }));

    expect(bullets.count).toBe(9);
    expect(headings(bullets)).toEqual([37, 67, 97, 157, 187, 217, 277, 307, 337]);
    expect(bullets.bullets.every((bullet) => bullet.x !== 100 || bullet.y !== 100)).toBe(true);
  });

  test('verdict-shear locks an appeal lane and reverses both rulings', () => {
    const bullets = system();
    const pattern = createPattern('verdict-shear', {
      spec: SPEC,
      columns: 7,
      gapWidth: 41,
      shear: 20,
      left: 0,
      right: 140,
      period: 1,
    });

    pattern(context(bullets, 0, { targetX: 70 }));
    expect(bullets.bullets.map((bullet) => bullet.x)).toEqual([10, 30, 110, 130]);
    expect(headings(bullets)).toEqual([70, 70, 110, 110]);

    bullets.clear();
    pattern(context(bullets, 1, { targetX: 70 }));
    expect(headings(bullets)).toEqual([110, 110, 70, 70]);
  });

  test('archive-trace files the exact delayed player position from parallel folios', () => {
    const bullets = system();
    const pattern = createPattern('archive-trace', {
      spec: SPEC,
      delay: 2,
      folios: 3,
      spacing: 20,
      stagger: 0,
      period: 1,
    });

    pattern(context(bullets, 0, { targetX: 120, targetY: 200 }));
    pattern(context(bullets, 1, { targetX: 200, targetY: 220 }));
    pattern(context(bullets, 2, { targetX: 300, targetY: 240 }));

    expect(bullets.bullets.map((bullet) => bullet.x)).toEqual([80, 100, 120]);
    expect(headings(bullets)).toEqual([
      atan2Deg(100, 40),
      atan2Deg(100, 20),
      atan2Deg(100, 0),
    ]);
  });

  test('memory-groove replays an old crossing and preserves its bounded drift', () => {
    const bullets = system();
    const pattern = createPattern('memory-groove', {
      spec: SPEC,
      delay: 2,
      trail: 1,
      columns: 5,
      gapWidth: 25,
      left: 0,
      right: 100,
      driftScale: 4,
      maxDrift: 12,
      period: 1,
    });

    pattern(context(bullets, 0, { targetX: 40 }));
    pattern(context(bullets, 1, { targetX: 80 }));
    pattern(context(bullets, 2, { targetX: 120 }));
    pattern(context(bullets, 3, { targetX: 160 }));

    expect(bullets.bullets.map((bullet) => bullet.x)).toEqual([10, 30, 50]);
    expect(headings(bullets)).toEqual([102, 102, 102]);
  });

  test('each memory-groove generation retains and reverses its own route drift', () => {
    const cases = [
      { form: 'session', generations: 1 },
      { form: 'corolla', generations: 2 },
      { form: 'statute', generations: 3 },
    ] as const;

    const run = (form: string, generations: number, routeStep: number): number[] => {
      const bullets = system();
      const pattern = createPattern('memory-groove', {
        spec: SPEC,
        form,
        role: 'groove',
        period: 1,
        delay: 2,
        trail: 2,
        columns: 5,
        gapWidth: 1,
        left: 0,
        right: 480,
        driftScale: 1,
        maxDrift: 20,
      });
      const result: number[] = [];

      for (let age = 0; age < 40 && result.length < generations; age++) {
        const before = bullets.count;
        pattern(context(bullets, age, {
          x: 240,
          y: 100,
          targetX: 240 + routeStep * age,
          targetY: 500,
        }));
        const first = bullets.bullets[before];
        if (first !== undefined) result.push(first.vector.theta);
      }

      return result;
    };

    for (const { form, generations } of cases) {
      const increasing = run(form, generations, 4);
      const stationary = run(form, generations, 0);
      const decreasing = run(form, generations, -4);

      expect(increasing, `${form} deterministic route trace`).toEqual(
        run(form, generations, 4),
      );
      expect(increasing).toHaveLength(generations);
      expect(stationary).toHaveLength(generations);
      expect(decreasing).toHaveLength(generations);

      for (let generation = 0; generation < generations; generation++) {
        const forwardDrift = increasing[generation]! - stationary[generation]!;
        const reverseDrift = decreasing[generation]! - stationary[generation]!;
        expect(forwardDrift, `${form} generation ${generation}`).toBeGreaterThan(0);
        expect(reverseDrift, `${form} generation ${generation}`).toBeLessThan(0);
        expect(forwardDrift).toBe(-reverseDrift);
      }
    }
  });

  test('built-in family forms still require one validated spec and a legal role', () => {
    for (const entry of PHASE_FORMS) {
      expect(() => createPattern(entry.pattern, {
        form: entry.form,
        role: entry.role,
      })).toThrow(`pattern "${entry.pattern}" requires a "spec" option`);
    }

    expect(() => createPattern('moon-gate', {
      spec: SPEC,
      form: 'scan',
      role: 'spiral',
    })).toThrow('pattern "moon-gate" form "scan" requires role sweep | wheel');
    expect(() => createPattern('memory-groove', {
      spec: SPEC,
      form: 'throne',
      role: 'groove',
    })).toThrow('pattern "memory-groove" does not support form "throne"');
  });

  test('all 54 authored family form/role slots have a live spatial implementation', () => {
    expect(FAMILY_ROLES).toHaveLength(54);
    for (const entry of FAMILY_ROLES) {
      expect(
        familyTrace(entry),
        `${entry.pattern}/${entry.form}.${entry.role}`,
      ).not.toBe('[]');
    }
  });

  test('all 20 phase-anchor forms have distinct translation-normalized style-free traces', () => {
    expect(PHASE_FORMS).toHaveLength(20);
    const traces = PHASE_FORMS.map((entry) => normalizedFamilyTrace(entry));
    expect(new Set(traces).size).toBe(PHASE_FORMS.length);
  });

  test('authored family geometry options change executed style-free traces', () => {
    const cases: readonly {
      readonly entry: FamilyCase;
      readonly option: string;
      readonly low: number;
      readonly high: number;
    }[] = [
      {
        entry: { pattern: 'moon-gate', form: 'corolla', role: 'stamen' },
        option: 'swing',
        low: 0,
        high: 17,
      },
      {
        entry: { pattern: 'moon-gate', form: 'eclipse', role: 'occlusion' },
        option: 'swing',
        low: 0,
        high: 19,
      },
      {
        entry: { pattern: 'verdict-shear', form: 'colonnade', role: 'columns' },
        option: 'rotation',
        low: 0,
        high: 21,
      },
      {
        entry: { pattern: 'verdict-shear', form: 'pursuit', role: 'hooks' },
        option: 'rotation',
        low: 0,
        high: 18,
      },
      {
        entry: { pattern: 'verdict-shear', form: 'pursuit', role: 'hooks' },
        option: 'gap',
        low: 12,
        high: 80,
      },
      {
        entry: { pattern: 'verdict-shear', form: 'colonnade', role: 'columns' },
        option: 'gap',
        low: 24,
        high: 160,
      },
      {
        entry: { pattern: 'verdict-shear', form: 'assize', role: 'seal' },
        option: 'rotation',
        low: 3,
        high: 27,
      },
      {
        entry: { pattern: 'verdict-shear', form: 'assize', role: 'seal' },
        option: 'gap',
        low: 12,
        high: 72,
      },
      {
        entry: { pattern: 'verdict-shear', form: 'assize', role: 'columns' },
        option: 'rotation',
        low: 0,
        high: 26,
      },
      {
        entry: { pattern: 'verdict-shear', form: 'assize', role: 'columns' },
        option: 'gap',
        low: 24,
        high: 160,
      },
      {
        entry: { pattern: 'archive-trace', form: 'assay', role: 'staves' },
        option: 'rotation',
        low: 2,
        high: 16,
      },
      {
        entry: { pattern: 'archive-trace', form: 'appeal', role: 'margins' },
        option: 'gap',
        low: 12,
        high: 70,
      },
      {
        entry: { pattern: 'archive-trace', form: 'assay', role: 'rake' },
        option: 'swing',
        low: 0,
        high: 18,
      },
      {
        entry: { pattern: 'archive-trace', form: 'assay', role: 'staves' },
        option: 'gap',
        low: 12,
        high: 70,
      },
      {
        entry: { pattern: 'archive-trace', form: 'assay', role: 'underline' },
        option: 'swing',
        low: 0,
        high: 18,
      },
      {
        entry: { pattern: 'archive-trace', form: 'estoppel', role: 'bars' },
        option: 'rotation',
        low: 2,
        high: 14,
      },
      {
        entry: { pattern: 'archive-trace', form: 'estoppel', role: 'bars' },
        option: 'gap',
        low: 12,
        high: 58,
      },
      {
        entry: { pattern: 'archive-trace', form: 'sealed', role: 'closure' },
        option: 'rotation',
        low: 2,
        high: 10,
      },
      {
        entry: { pattern: 'archive-trace', form: 'sealed', role: 'closure' },
        option: 'gap',
        low: 12,
        high: 58,
      },
      {
        entry: { pattern: 'memory-groove', form: 'portcullis', role: 'lattice' },
        option: 'gapColumn',
        low: 1,
        high: 6,
      },
      {
        entry: { pattern: 'memory-groove', form: 'portcullis', role: 'lattice' },
        option: 'shift',
        low: 0,
        high: 3,
      },
      {
        entry: { pattern: 'memory-groove', form: 'attainder', role: 'warrants' },
        option: 'rotation',
        low: 0,
        high: 11,
      },
      {
        entry: { pattern: 'memory-groove', form: 'attainder', role: 'warrants' },
        option: 'gap',
        low: 24,
        high: 68,
      },
      {
        entry: { pattern: 'memory-groove', form: 'sine-die', role: 'peel' },
        option: 'rotation',
        low: 0,
        high: 9,
      },
      {
        entry: { pattern: 'memory-groove', form: 'sine-die', role: 'peel' },
        option: 'gap',
        low: 24,
        high: 120,
      },
    ];

    for (const { entry, option, low, high } of cases) {
      expect(
        normalizedFamilyTrace(entry, { [option]: low }),
        `${entry.pattern}/${entry.form}.${entry.role} ${option}`,
      ).not.toBe(normalizedFamilyTrace(entry, { [option]: high }));
    }
  });

  test('all 20 phase-anchor forms change when the Boss source moves', () => {
    for (const entry of PHASE_FORMS) {
      expect(
        familyTrace(entry, true),
        `${entry.pattern}/${entry.form}.${entry.role}`,
      ).not.toBe(familyTrace(entry, false));
    }
  });

  test('family clocks advance even when each volley is truncated by the pool', () => {
    const cases: readonly FamilyCase[] = [
      { pattern: 'moon-gate', form: 'eclipse', role: 'closure' },
      { pattern: 'verdict-shear', form: 'assize', role: 'scissor' },
      { pattern: 'archive-trace', form: 'sealed', role: 'overprint' },
      { pattern: 'memory-groove', form: 'corolla', role: 'inner' },
    ];

    for (const entry of cases) {
      const bullets = system(1);
      const pattern = createPattern(entry.pattern, familyOptions(entry));
      const accepted: string[] = [];
      for (let age = 0; age < 18 && accepted.length < 2; age++) {
        pattern(context(bullets, age, {
          x: 240,
          y: 96,
          targetX: 320,
          targetY: 520,
        }));
        const bullet = bullets.bullets[0];
        if (bullet !== undefined) {
          accepted.push(JSON.stringify([bullet.x, bullet.y, bullet.vector.theta]));
          bullets.clear();
        }
      }

      expect(accepted, `${entry.pattern}/${entry.form}.${entry.role}`).toHaveLength(2);
      expect(accepted[1]).not.toBe(accepted[0]);
    }
  });

  test('every built-in family role leaves the supplied RNG stream untouched', () => {
    for (const entry of FAMILY_ROLES) {
      const bullets = system(8192);
      const rng = new Random(0xc0ffee);
      const before = rng.getState();
      const pattern = createPattern(entry.pattern, familyOptions(entry));
      for (let age = 0; age < 18; age++) {
        pattern(context(bullets, age, {
          x: 180 + age * 3,
          y: 96,
          targetX: 80 + age * 11,
          targetY: 520,
          rng,
        }));
      }
      expect(bullets.count, `${entry.pattern}/${entry.form}.${entry.role}`).toBeGreaterThan(0);
      expect(rng.getState()).toEqual(before);
    }
  });

  test('identical source and target paths reproduce all 20 family forms exactly', () => {
    for (const entry of PHASE_FORMS) {
      expect(familyTrace(entry, true, 314159)).toBe(
        familyTrace(entry, true, 314159),
      );
    }
  });

  test('all eight spatial patterns leave the supplied RNG stream untouched', () => {
    for (const name of DETERMINISTIC_PATTERNS) {
      const bullets = system();
      const rng = new Random(0xc0ffee);
      const before = rng.getState();
      const pattern = createPattern(name, {
        spec: SPEC,
        period: 1,
        delay: 2,
        trail: 1,
      });

      drive(pattern, bullets, 16, { rng });

      expect(bullets.count).toBeGreaterThan(0);
      expect(rng.getState()).toEqual(before);
    }
  });

  test('identical seeds and inputs reproduce every new pattern exactly', () => {
    const run = (name: (typeof DETERMINISTIC_PATTERNS)[number]): number[] => {
      const bullets = system(1024);
      const rng = new Random(314159);
      const pattern = createPattern(name, {
        spec: SPEC,
        period: 2,
        delay: 2,
        trail: 1,
      });
      drive(pattern, bullets, 40, { rng, targetX: 360, targetY: 520 });
      return headings(bullets);
    };

    for (const name of DETERMINISTIC_PATTERNS) expect(run(name)).toEqual(run(name));
  });
});
