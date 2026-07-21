/**
 * THE REPLAY REGRESSION — the base campaign's permanent behavioural guard.
 *
 * A full run of each stage, at Normal and at Lunatic, driven to its natural end
 * and committed as input masks plus a golden state trace: replaying the
 * committed masks must reproduce the committed trace exactly. Lunatic is the
 * tier that reaches `sentinel`'s tier-gated fourth card and fires the
 * per-pattern `difficulty` blocks, so between the two tiers the traces cover
 * the most content a run can touch.
 *
 * This file began as half of the base-pack port gate (decisions-basepack §"The
 * gate: byte-identity, or the port did not happen"). The other half — a
 * registry snapshot pinning the thirteen ported registrations byte-for-byte —
 * did its job when the port landed and was retired per that document's
 * §"After the port lands": structural drift is now the generator drift test's
 * problem (`tools/make-base-pack.test.ts` byte-diffs generator output against
 * the checked-in JSON), and behavioural drift is this file's. A change that
 * moves these traces is either a bug or a deliberate divergence — say which,
 * regenerate through `recordFixture`, and state it in the commit.
 *
 * The committed fixtures ARE the oracle: a run finds them and asserts against
 * them. When a fixture is absent — a first capture, or a fresh checkout that
 * never committed it — the run writes it AND FAILS, because a missing oracle is
 * an error, never a silent self-heal. Without that failure a checkout missing
 * the gate files would regenerate them from the CURRENT code and compare text
 * against itself, passing vacuously and masking the exact divergence this file
 * exists to catch. So `bun test` is stable across runs once the fixtures are
 * committed, and loud until they are.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// Imported the way the running game imports it after the port: the bundled base
// pack (`packs/bundled.ts`) injects `base-pack.json`, registering the same
// built-in campaign — grunt, sentinel, stage-1 — by the same bare names, now as
// pack data. This snapshot is what proves those names still resolve to
// byte-identical specs; before the port this line imported './content', which
// registered them as engine TypeScript.
import './packs/bundled';

import { Button } from './core/input';
import { fx, sim } from './core/random';
import { getStage } from './content/stage';
import { deserialize, type Replay } from './sim/replay';
import { defineCharacter, getCharacter, Run, type RunConfig } from './game/run';
import type { Difficulty } from './sim/difficulty';

/** Where the committed gate fixtures live. */
const FIXTURE_DIR = new URL('./base-content.gate/', import.meta.url);

// A run draws from the global `fx` stream for cosmetics (rule 2), never from
// `sim` — verified, and the reason the gate fingerprint reads only sim-determined
// gameplay state, which `config.seed` fixes regardless of what `fx` holds. But
// driving runs still advances `fx`, and `core/random.test.ts` asserts both global
// streams are pristine at its own import. So this file restores what it found,
// exactly as that file does for itself, and stays transparent to stream state.
const SIM_ENTRY_STATE = sim.getState();
const FX_ENTRY_STATE = fx.getState();
afterAll(() => {
  sim.setState(SIM_ENTRY_STATE);
  fx.setState(FX_ENTRY_STATE);
});

/* ------------------------------------------------------------------ */
/* Canonical serialization                                            */
/* ------------------------------------------------------------------ */

/**
 * Object keys sorted, arrays left in place, numbers required finite, functions
 * refused.
 *
 * Sorting keys makes the fixture independent of authoring order, so a spec whose
 * fields are reordered still snapshots identically — the gate is about *values*.
 * Arrays are ordered data (a spoils row, a phase sequence, a wave list) and are
 * never sorted: a reordered array IS a change the gate must catch.
 *
 * A non-finite number is refused rather than serialized: `JSON.stringify` turns
 * `NaN`/`Infinity` into `null` silently, which would let a corrupt fixture pass
 * as a clean one. A function value is refused outright — a fixture is data a
 * replay can carry, and data never carries code.
 */
function canonical(value: unknown, path: string): unknown {
  if (typeof value === 'function') {
    throw new Error(
      `base-content gate: function value at ${path} — a fixture is data, and ` +
        `data never carries code.`,
    );
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`base-content gate: non-finite number ${value} at ${path}`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, i) => canonical(entry, `${path}[${i}]`));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const field = (value as Record<string, unknown>)[key];
      if (field === undefined) continue; // absent and explicit-undefined snapshot alike
      out[key] = canonical(field, `${path}.${key}`);
    }
    return out;
  }
  return value; // string | boolean | null
}

/**
 * Read the committed fixture, returning `wrote: false`; or, when it is absent,
 * write it and return `wrote: true`. The caller ASSERTS `wrote === false`, so a
 * bootstrap — a first capture, or a fresh checkout that never committed the
 * fixture — is a loud failure rather than a vacuous pass against self-produced
 * text. The write still happens so a genuine first capture leaves the file
 * behind; it is the run that wrote it that fails.
 */
function committedText(name: string, produce: () => string): { committed: string; wrote: boolean } {
  const url = new URL(name, FIXTURE_DIR);
  if (existsSync(url)) {
    return { committed: readFileSync(url, 'utf8'), wrote: false };
  }
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const text = produce();
  writeFileSync(url, text);
  return { committed: text, wrote: true };
}

/* ------------------------------------------------------------------ */
/* Replay regression                                                  */
/* ------------------------------------------------------------------ */

/**
 * A ship with lives enough to reach the natural end of a whole stage, so the
 * recorded run finishes on its own (boss defeated or its cards timed out — a
 * timeout is a clear) rather than on a loop bound. `test`-prefixed so every
 * whole-tree probe (`reachability`, `balance`) filters it as a fixture.
 */
const ENDURANCE = 'test-base-gate-endurance';
defineCharacter(ENDURANCE, {
  ...getCharacter('scout'),
  label: 'GATE ENDURANCE',
  player: { ...getCharacter('scout').player, lives: 400 },
});

/** Generous ceiling; every recorded run finishes long before it. */
const RUN_LIMIT = 120_000;
/** Sample the full state on this cadence — dense enough to see a transient. */
const SAMPLE_INTERVAL = 30;

/** Everything a divergence could hide in, flattened to a comparable string. */
function fingerprint(run: Run): string {
  const parts: (string | number)[] = [
    run.tickCount,
    run.outcome,
    run.player.x,
    run.player.y,
    run.player.score,
    run.player.graze,
    run.player.lives,
    run.player.bombs,
    run.player.power,
    run.player.invuln,
    run.player.deathCount,
    run.enemies.count,
    run.bullets.count,
    run.items.count,
    run.boss.active ? 1 : 0,
  ];
  for (const b of run.bullets.bullets) parts.push(b.x, b.y, b.faction, b.vector.theta, b.vector.r);
  for (const e of run.enemies.enemies) parts.push(e.name, e.x, e.y, e.hp, e.age);
  for (const i of run.items.items) parts.push(i.name, i.x, i.y, i.age);
  for (const o of run.options.options) parts.push(o.x, o.y, o.angle, o.active ? 1 : 0);
  const boss = run.boss.boss;
  if (boss !== undefined) parts.push(boss.name, boss.x, boss.y, boss.hp, boss.phaseIndex, boss.phaseTicks);
  return parts.join('|');
}

interface Golden {
  outcome: string;
  tickCount: number;
  finalScore: number;
  finalGraze: number;
  sampleInterval: number;
  sampleCount: number;
  /** SHA-256 of the sampled fingerprints joined by newline — catches any drift. */
  traceSha256: string;
  /** The final full fingerprint, in the clear, so a failure shows a real diff. */
  finalFingerprint: string;
}

/** Drive a run tick by tick, sampling the fingerprint on the cadence. */
function traceRun(run: Run, drive: (tick: number) => number, limit: number): Golden {
  const samples: string[] = [];
  for (let t = 0; t < limit && !run.finished; t++) {
    run.tick(drive(t));
    if (t % SAMPLE_INTERVAL === 0) samples.push(fingerprint(run));
  }
  const last = fingerprint(run);
  return {
    outcome: run.outcome,
    tickCount: run.tickCount,
    finalScore: run.player.score,
    finalGraze: run.player.graze,
    sampleInterval: SAMPLE_INTERVAL,
    sampleCount: samples.length,
    traceSha256: createHash('sha256').update(samples.join('\n')).digest('hex'),
    finalFingerprint: last,
  };
}

/**
 * A competent, deterministic pilot for RECORDING only. It reads live run state
 * to steer — legal because the run is deterministic, so the same seed yields the
 * same decisions and the same masks — and the recorded masks are all the replay
 * keeps. Playback never runs this; it feeds the committed masks with `tick(0)`.
 *
 * It taps Shot through the pre-boss exchange (a fresh press advances a line),
 * tracks the boss when one is up so its health is actually spent, sweeps the
 * field otherwise so the stage script's spawns are met, and stays low so its
 * upward shots reach a boss above it rather than firing away from it.
 */
function pilot(run: Run): (tick: number) => number {
  let aimX: number | undefined;
  return (tick: number): number => {
    if (run.dialogue !== undefined) {
      // Pulse Shot: the edge advances the line, a held button does not.
      return tick % 2 === 0 ? Button.Shot : 0;
    }
    let buttons = Button.Shot;
    const boss = run.boss.boss;
    const fightingBoss = boss?.alive === true;
    aimX = boss?.alive && !boss.entering ? boss.x : run.enemies.enemies[0]?.x;

    const px = run.player.x;
    if (aimX === undefined) buttons |= Math.floor(tick / 70) % 2 === 0 ? Button.Left : Button.Right;
    else if (aimX < px - 4) buttons |= Button.Left;
    else if (aimX > px + 4) buttons |= Button.Right;

    // Rise to the collect line periodically when no boss is up; otherwise hold a
    // low station under the fight.
    const stationY = !fightingBoss && Math.floor(tick / 240) % 3 === 0 ? 60 : 380;
    if (run.player.y > stationY + 6) buttons |= Button.Up;
    else if (run.player.y < stationY - 6) buttons |= Button.Down;
    return buttons;
  };
}

function baseConfig(stage: string, difficulty: Difficulty): RunConfig {
  // The stage's own declared seed — the seed the real game plays it under.
  return { seed: getStage(stage).seed ?? 0x5747a1, character: ENDURANCE, stage, difficulty };
}

interface ReplayFixture {
  portGate: string;
  replay: Replay;
  golden: Golden;
}

const GATE_NOTE =
  'BASE CAMPAIGN REPLAY REGRESSION: replaying these masks against the bundled ' +
  'base-pack content must reproduce this golden trace exactly. A change that ' +
  'moves it is a bug or a declared divergence.';

/**
 * Record a full run: drive the live run with the pilot, then verify the recorded
 * replay reproduces the same trace under playback before committing it — a
 * fixture whose own replay does not reproduce is worthless as a gate.
 */
function recordFixture(stage: string, difficulty: Difficulty): string {
  const live = new Run(baseConfig(stage, difficulty));
  const golden = traceRun(live, pilot(live), RUN_LIMIT);
  if (live.outcome === 'playing') {
    throw new Error(`base-content gate: ${stage}/${difficulty} did not finish within ${RUN_LIMIT} ticks`);
  }
  const replay = live.finishRecording();

  // Self-check: the committed masks must reproduce the committed trace now, or
  // the fixture is already broken before the port ever touches it.
  const playback = new Run({ ...baseConfig(stage, difficulty), replay });
  const reproduced = traceRun(playback, () => 0, replay.length + 1);
  if (reproduced.traceSha256 !== golden.traceSha256) {
    throw new Error(`base-content gate: ${stage}/${difficulty} replay does not reproduce its own recording`);
  }

  const fixture: ReplayFixture = { portGate: GATE_NOTE, replay, golden };
  return JSON.stringify(canonical(fixture, 'fixture'), null, 2) + '\n';
}

describe('base campaign replay regression (the permanent behavioural guard)', () => {
  const CASES: readonly { stage: string; difficulty: Difficulty }[] = [
    { stage: 'stage-1', difficulty: 'normal' },
    { stage: 'stage-1', difficulty: 'lunatic' },
    { stage: 'stage-2', difficulty: 'normal' },
    { stage: 'stage-2', difficulty: 'lunatic' },
  ];

  for (const { stage, difficulty } of CASES) {
    test(`${stage} on ${difficulty} replays to the committed trace`, () => {
      const file = `replay.${stage}.${difficulty}.json`;
      const { committed, wrote } = committedText(file, () => recordFixture(stage, difficulty));
      // A bootstrapped oracle fails (see the registry snapshot test): a missing
      // committed trace is an error, not a self-healing pass.
      expect(wrote).toBe(false);
      const fixture = JSON.parse(committed) as ReplayFixture;

      // Deserialize and validate through the real replay path — the masks are
      // fed to a fresh run with no live input, exactly as a saved replay is.
      const replay = deserialize(JSON.stringify(fixture.replay));
      // `baseConfig` threads no `contentFingerprint`, and these fixtures carry no
      // `content` meta key, so the replay-meta check takes the legacy-warn path by
      // design: this gate proves gameplay by trace comparison, not by fingerprint,
      // and a content edit that should break gameplay is caught by the trace below.
      const playback = new Run({ ...baseConfig(stage, difficulty), replay });
      const reproduced = traceRun(playback, () => 0, replay.length + 1);

      // The endpoint scalars first, so a divergence reads as a concrete diff
      // rather than only as a changed hash.
      expect(reproduced.outcome).toBe(fixture.golden.outcome);
      expect(reproduced.tickCount).toBe(fixture.golden.tickCount);
      expect(reproduced.finalFingerprint).toBe(fixture.golden.finalFingerprint);
      // Then the whole trace: a divergence that later heals is invisible to an
      // endpoint check and caught here.
      expect(reproduced.traceSha256).toBe(fixture.golden.traceSha256);
    });
  }

  test('the recordings are not trivial — each fought its stage to a real end', () => {
    for (const { stage, difficulty } of CASES) {
      const committed = readFileSync(new URL(`replay.${stage}.${difficulty}.json`, FIXTURE_DIR), 'utf8');
      const fixture = JSON.parse(committed) as ReplayFixture;
      // A whole stage is thousands of ticks and a non-zero score; a fixture that
      // fell out early would gate almost nothing.
      expect(fixture.golden.tickCount).toBeGreaterThan(2000);
      expect(fixture.golden.finalScore).toBeGreaterThan(0);
      expect(fixture.replay.meta?.['stage']).toBe(stage);
      expect(fixture.replay.meta?.['difficulty']).toBe(difficulty);
      // Built-in content: no data pack shaped it. The port keeps it that way (a
      // bundled pack joins neither `packs` meta nor `packsData`), so this stays ''.
      expect(fixture.replay.meta?.['packsData']).toBe('');
    }
  });
});
