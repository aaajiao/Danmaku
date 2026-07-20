/**
 * The format-2 acceptance test — reachability, proven for pack content.
 *
 * `reachability.test.ts` drives the real `StateMachine` to prove no built-in is
 * registered-but-unreachable. Pack content is exempt from *that* scan (its names
 * carry '/'), precisely because a built-in playthrough never enters a pack
 * campaign — so the proof that pack content is reachable has to live here, and it
 * is the same proof shaped to a pack: inject the real `example` pack, drive the
 * real machine through title → its campaign row → character select → playing, and
 * assert the wire holds end to end.
 *
 *   - the campaign row appears under START and selecting it starts the pack's
 *     entry stage (not the built-in `stage-1`),
 *   - both pack enemies actually spawn (registration is not reachability — an
 *     enemy no wave fires would pass injection's dead-content check by being
 *     referenced, yet still never appear if the wire from schedule to field were
 *     broken),
 *   - the `next` chain advances into the second pack stage,
 *   - the built-in boss the second stage names actually arrives, and
 *   - the replay the run records carries the campaign's strict `packsData`
 *     identity, the meta a mismatched-content playback is refused on.
 *
 * The pilot is the compressed-competent one from `reachability.test.ts`: immortal
 * by construction (this measures *can a player reach this*, not *survive it*) and
 * aimed, because a boss that is never damaged times its cards out and never dies,
 * which would read as unreachable content rather than as the probe's own inertia.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import '../content'; // built-in patterns, behaviours, enemies, bosses, stages
import '../sim/item'; // built-in items; content imports it type-only
import '../render/backgrounds'; // registers the scenes the injector resolves against
import { Button } from '../core/input';
import { backgroundNames } from '../render/background';
import { BULLET_CELLS } from '../render/procedural';
import { getStage } from '../content/stage';
import { StateMachine } from '../game/state';
import { TitleState, type Campaign, type GameContext } from '../game/states';
import type { Run } from '../game/run';
import type { Replay } from '../sim/replay';
import { validateManifest } from './manifest';
import { injectPack } from './inject';

const DIR = join(import.meta.dir, '..', '..', 'packs', 'example');

/**
 * A synthetic pack identity. In production the loader hashes the pack's bytes;
 * here any stable string does, because the claim under test is that whatever the
 * campaign carries reaches replay meta unaltered — not what the hash is.
 */
const PACKS_DATA = 'example@deadbeef01ab';

/** Inject the committed pack against the real render name sets, once. */
function injectExample(): Campaign[] {
  const parsed = validateManifest(
    JSON.parse(readFileSync(join(DIR, 'pack.json'), 'utf8')),
    'example',
  );
  if ('errors' in parsed) {
    throw new Error(`packs/example/pack.json failed validation:\n${parsed.errors.join('\n')}`);
  }
  // Idempotent per pack name: `example-pack.test.ts` may have injected `example`
  // already in this shared process; this returns that first result rather than
  // re-registering and throwing a duplicate. The campaign shape the loader
  // returns is `{ label, stage }`; `main.ts` attaches the entering pack's
  // identity per campaign, which is what this test does next.
  const injected = injectPack(parsed.manifest, {
    sprites: [...BULLET_CELLS, 'ship'],
    scenes: backgroundNames(),
  });
  return injected.campaigns.map((c) => ({ ...c, packsData: PACKS_DATA }));
}

interface Coverage {
  states: Set<string>;
  stages: Set<string>;
  enemies: Set<string>;
  bosses: Set<string>;
  scenes: Set<string>;
  replays: Replay[];
  ticks: number;
}

/**
 * Play the example campaign from the title screen to ALL CLEAR.
 *
 * Menus are driven by pulsing a button on alternate ticks, because `Edges` reads
 * a press as an edge and suppresses its first update — a held button confirms
 * once and then sits. The title needs two moves: step the cursor down to the
 * campaign row (index 1, under START), then confirm it.
 */
function playCampaign(campaigns: readonly Campaign[], limit = 300_000): Coverage {
  const machine = new StateMachine();
  let seed = 1;
  const cover: Coverage = {
    states: new Set(),
    stages: new Set(),
    enemies: new Set(),
    bosses: new Set(),
    scenes: new Set(),
    replays: [],
    ticks: 0,
  };
  const ctx: GameContext = {
    machine,
    nextSeed: () => 0x51ee + seed++,
    campaigns,
    onReplay: (r) => cover.replays.push(r),
  };
  machine.push(new TitleState(ctx));

  let pulse = 0;
  let lastRun: Run | undefined;
  let aimX: number | undefined;
  let playerX = 240;
  let playerY = 400;
  let fightingBoss = false;

  for (let tick = 0; tick < limit; tick++) {
    cover.ticks = tick;
    const top = machine.stack[machine.stack.length - 1];
    const name = top?.name ?? '?';
    cover.states.add(name);

    let buttons = 0;
    if (name === 'title') {
      // Walk to the campaign row (index 1), then confirm it. Pulsed, because the
      // first `Edges` update is suppressed — a single press would be swallowed.
      const view = top?.view?.() as { selected?: number } | undefined;
      const selected = view?.selected ?? 0;
      pulse ^= 1;
      if (selected < 1) buttons = pulse ? Button.Down : 0;
      else buttons = pulse ? Button.Shot : 0;
    } else if (name === 'playing') {
      buttons = Button.Shot;
      if (aimX === undefined) {
        buttons |= Math.floor(tick / 70) % 2 === 0 ? Button.Left : Button.Right;
      } else if (aimX < playerX - 4) {
        buttons |= Button.Left;
      } else if (aimX > playerX + 4) {
        buttons |= Button.Right;
      }
      // Sit low under a boss so shots (which travel up) reach it; rise otherwise.
      const stationY = !fightingBoss && Math.floor(tick / 240) % 3 === 0 ? 60 : 380;
      if (playerY > stationY + 6) buttons |= Button.Up;
      else if (playerY < stationY - 6) buttons |= Button.Down;
    } else {
      // character-select and the STAGE CLEAR card: the cursor rests on the first
      // entry (a character, then NEXT STAGE), so pulsing confirm is enough.
      pulse ^= 1;
      buttons = pulse ? Button.Shot : 0;
    }

    machine.tick(buttons);

    for (const state of machine.stack) {
      const run = (state as { run?: Run }).run;
      if (run === undefined) continue;

      if (run !== lastRun) {
        lastRun = run;
        cover.stages.add(run.stageName);
      }

      // Immortal by construction: reachability, not survival, is the question.
      if (run.player.lives < 3) run.player.lives = 3;
      run.player.alive = true;
      run.player.invuln = 999;

      playerX = run.player.x;
      playerY = run.player.y;
      const scene = run.scene;
      if (scene !== undefined) cover.scenes.add(scene);
      const boss = run.boss.boss;
      if (boss?.alive) cover.bosses.add(boss.name);
      fightingBoss = boss?.alive === true;
      aimX = boss?.alive && !boss.entering ? boss.x : run.enemies.enemies[0]?.x;

      for (const enemy of run.enemies.enemies) cover.enemies.add(enemy.name);
    }

    // Stop only at the *last* stage's clear card — breaking on the first `cleared`
    // would stop at STAGE CLEAR and never measure stage two.
    const finished =
      lastRun !== undefined &&
      getStage(lastRun.stageName).next === undefined &&
      lastRun.outcome === 'cleared';
    if (finished && machine.stack[machine.stack.length - 1]?.name === 'cleared') break;
  }

  return cover;
}

describe('the example pack is reachable and its content runs', () => {
  const campaigns = injectExample();
  const cover = playCampaign(campaigns);

  test('injection contributes exactly the entry campaign row', () => {
    expect(campaigns).toEqual([
      { label: 'example/gauntlet', stage: 'example/gauntlet', packsData: PACKS_DATA },
    ]);
  });

  test('the run played to ALL CLEAR rather than falling out early', () => {
    expect(cover.ticks).toBeGreaterThan(1_000);
    expect(cover.states.has('cleared')).toBe(true);
  });

  test('both pack stages ran — the entry, and its next chain', () => {
    expect(cover.stages.has('example/gauntlet')).toBe(true);
    expect(cover.stages.has('example/ashfall')).toBe(true);
    // The built-in starter was never entered: the campaign row steered the run.
    expect(cover.stages.has('stage-1')).toBe(false);
  });

  test('both pack enemies actually spawned, under their qualified names', () => {
    expect(cover.enemies.has('example/ember')).toBe(true);
    expect(cover.enemies.has('example/drone')).toBe(true);
  });

  test('the built-in boss the second stage names arrived', () => {
    expect(cover.bosses.has('sentinel')).toBe(true);
  });

  test('each pack stage entered its declared built-in scene', () => {
    expect(cover.scenes.has('expanse')).toBe(true);
    expect(cover.scenes.has('undertow')).toBe(true);
  });

  test("every replay carries the campaign's strict packsData identity", () => {
    // One recording per stage; both runs read the identity live off the context,
    // so every one records it. This is the meta a mismatched-content replay is
    // refused on (unlike presentation `packs`, which only warns).
    expect(cover.replays.length).toBeGreaterThanOrEqual(2);
    for (const replay of cover.replays) {
      expect(replay.meta?.packsData).toBe(PACKS_DATA);
    }
    const last = cover.replays[cover.replays.length - 1];
    expect(last?.meta?.stage).toBe('example/ashfall');
  });
});
