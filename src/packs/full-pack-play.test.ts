/**
 * Full-surface fixture acceptance — reachability, proven for pack content.
 *
 * `reachability.test.ts` drives the real `StateMachine` to prove no built-in is
 * registered-but-unreachable. Pack content is exempt from *that* scan (its names
 * carry '/'), precisely because a built-in playthrough never enters a pack
 * campaign nor flies a pack ship — so the proof that pack content is reachable
 * has to live here, and it is the same proof shaped to a pack: validate and
 * inject the in-memory fixture, then drive the real machine through title → its campaign row →
 * character select → PLAYING THE PACK SHIP, and assert the whole tier holds end
 * to end:
 *
 *   - the campaign row appears under START and selecting it starts the pack's
 *     entry stage (not the built-in `stage-1`),
 *   - SELECT offers the pack character and the run flies IT, not a built-in,
 *   - the pack shot fires (player bullets exist — a pack weapon resolved through
 *     the shot registry into the ship's `player.shots`),
 *   - both pack enemies spawn (registration is not reachability — an enemy no
 *     wave fires would pass injection's dead-content check by being referenced,
 *     yet still never appear if the wire from schedule to field were broken),
 *   - the pack effect fires on a pack enemy's death, and the pack item drops
 *     from its spoils and is collected,
 *   - the `next` chain advances into the second pack stage,
 *   - the pack END boss arrives, transitions phases, and its spell card's background
 *     override is reported by `Run.scene`,
 *   - the campaign clears through the pack boss, and
 *   - the replay the run records carries the campaign's strict `packsData`
 *     identity, the meta a mismatched-content playback is refused on.
 *
 * A separate, focused test proves the data tier's one subtle MUST from the other
 * direction: a pack ship flown off the plain START row — a built-in stage, no
 * campaign — still records the owning pack's `packsData`, because a pack
 * character drives the simulation with pack content even when no campaign armed
 * the identity.
 *
 * The pilot is the compressed-competent one from `reachability.test.ts`: immortal
 * by construction (this measures *can a player reach this*, not *survive it*) and
 * aimed, because a boss that is never damaged times its cards out and never dies,
 * which would read as unreachable content rather than as the probe's own inertia.
 */

import { describe, expect, test } from 'bun:test';
import '../packs/bundled';
import '../sim/item'; // built-in items; content imports it type-only
import '../render/backgrounds'; // registers the scenes the injector resolves against
import { Button } from '../core/input';
import { backgroundNames } from '../render/background';
import { laserSkinNames } from '../render/laser-skin';
import { portraitNames } from '../render/portrait';
import { BULLET_CELLS, MISSILE_STRIP_CELLS, SHIP_CELLS } from '../render/procedural';
import { getStage } from '../content/stage';
import { StateMachine } from '../game/state';
import { characterNames, Run, type RunEventType } from '../game/run';
import type { Difficulty } from '../sim/difficulty';
import {
  TitleState,
  type Campaign,
  type CharacterPack,
  type GameContext,
} from '../game/states';
import type { Replay } from '../sim/replay';
import { validateManifest } from './manifest';
import { injectPack } from './inject';
import { attachIdentity } from './loader';
import {
  FULL_PACK_NAME,
  fullPackFixture,
  fullPackQualified as q,
} from './full-pack.fixture';

/** The pack character SELECT offers and this test flies, under its qualified name. */
const PACK_CHARACTER = q('voyager');

/**
 * A synthetic pack identity. In production the loader hashes the pack's bytes;
 * here any stable string does, because the claim under test is that whatever the
 * campaign (or the pack character) carries reaches replay meta unaltered — not
 * what the hash is.
 */
const PACKS_DATA = `${FULL_PACK_NAME}@deadbeef01ab`;

/** The render name sets the browser loader would hand the injector. */
const CTX_NAMES = { sprites: [...BULLET_CELLS], shipSprites: [...SHIP_CELLS], laserSprites: laserSkinNames(), missileSprites: [...MISSILE_STRIP_CELLS], scenes: backgroundNames(), portraits: portraitNames() };

/** Validate and inject the in-memory full fixture once (idempotent per name). */
function injectFixture(): { campaigns: Campaign[]; characterPacks: CharacterPack[] } {
  const parsed = validateManifest(fullPackFixture(), FULL_PACK_NAME);
  if ('errors' in parsed) {
    throw new Error(`full pack fixture failed validation:\n${parsed.errors.join('\n')}`);
  }
  // Idempotent per pack name: `full-pack.test.ts` may have injected the fixture
  // already in this shared process; this returns that first result rather than
  // re-registering and throwing a duplicate. The pairing goes through the
  // loader's real `attachIdentity` — NOT a copy of it — so this test drives the
  // same producer the shell does: the campaign row and the pack character each
  // carry the pack's identity, the two paths a run can enter one. If the loader
  // ever stopped pairing characters, this would go empty and the tests below
  // (which assert the identity reaches the run) would fail, which is the whole
  // point — the previous copy-as-fixture kept a broken shell wire green.
  const injected = injectPack(parsed.manifest, CTX_NAMES);
  return attachIdentity(injected, PACKS_DATA);
}

interface Coverage {
  states: Set<string>;
  stages: Set<string>;
  characters: Set<string>;
  enemies: Set<string>;
  bosses: Set<string>;
  scenes: Set<string>;
  /** Tracks `Run.music` reported — a pack track is observed by its qualified name. */
  music: Set<string>;
  /** Sprites of live particles — a pack effect is observed by the cell it emits. */
  effectSprites: Set<string>;
  /** Names of items on the field — a pack item is observed by its qualified name. */
  items: Set<string>;
  /** Speakers seen in `Run.dialogue` — a pack portrait shows under its qualified name. */
  dialogueSpeakers: Set<string>;
  events: Set<RunEventType>;
  /** Ticks on which at least one player bullet was in the air. */
  playerBulletTicks: number;
  replays: Replay[];
  ticks: number;
}

/**
 * Play the fixture campaign from the title screen to ALL CLEAR, flying the pack
 * ship.
 *
 * Menus are driven by pulsing a button on alternate ticks, because `Edges` reads
 * a press as an edge and suppresses its first update — a held button confirms
 * once and then sits. The title steps down to the campaign row (index 1, under
 * START) and confirms it; SELECT steps down to the pack character's row and
 * confirms that.
 */
function playCampaign(
  campaigns: readonly Campaign[],
  characterPacks: readonly CharacterPack[],
  limit = 300_000,
): Coverage {
  const machine = new StateMachine();
  let seed = 1;
  const cover: Coverage = {
    states: new Set(),
    stages: new Set(),
    characters: new Set(),
    enemies: new Set(),
    bosses: new Set(),
    scenes: new Set(),
    music: new Set(),
    effectSprites: new Set(),
    items: new Set(),
    dialogueSpeakers: new Set(),
    events: new Set(),
    playerBulletTicks: 0,
    replays: [],
    ticks: 0,
  };
  const ctx: GameContext = {
    machine,
    nextSeed: () => 0x51ee + seed++,
    campaigns,
    characterPacks,
    onReplay: (r) => cover.replays.push(r),
  };
  machine.push(new TitleState(ctx));

  // The pack character registers last, but its exact index is what indexOf
  // reports whatever else shares the process — navigate to it rather than assume.
  const fixtureCharacterIndex = characterNames().indexOf(PACK_CHARACTER);
  if (fixtureCharacterIndex < 0) throw new Error(`expected ${PACK_CHARACTER} in the character registry`);

  let pulse = 0;
  let lastRun: Run | undefined;
  let aimX: number | undefined;
  let playerX = 240;
  let playerY = 400;
  let fightingBoss = false;
  /**
   * Whether the run was showing a dialogue line at the end of the previous tick.
   *
   * The fixture boss carries a pre-fight exchange that a *fresh* Shot press
   * advances (a held one does not). This combat pilot holds Shot
   * continuously, so without pulsing it here it would stall at the first exchange
   * until the tick limit and never reach the pack end boss. Mirrors the same
   * branch in `reachability.test.ts`, and generic — it taps through any dialogue.
   */
  let inDialogue = false;

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
    } else if (name === 'character-select') {
      // Step down to the pack ship's row, then confirm — the run must fly the
      // pack character, not the built-in the cursor rests on.
      const view = top?.view?.() as { selected?: number } | undefined;
      const selected = view?.selected ?? 0;
      pulse ^= 1;
      if (selected < fixtureCharacterIndex) buttons = pulse ? Button.Down : 0;
      else buttons = pulse ? Button.Shot : 0;
    } else if (name === 'playing' && inDialogue) {
      // Tap through the pre-boss exchange: a fresh Shot advances a line, a held
      // one does not, so pulse it. The field is frozen — the pilot only has to
      // keep pressing to reach the fight.
      pulse ^= 1;
      buttons = pulse ? Button.Shot : 0;
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
      // The STAGE CLEAR card: the cursor rests on the first entry (NEXT STAGE),
      // so pulsing confirm is enough.
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
      // Observed here, consumed by the pilot next tick to pulse Shot through it.
      inDialogue = run.dialogue !== undefined;
      if (run.dialogue !== undefined) cover.dialogueSpeakers.add(run.dialogue.speaker);
      cover.characters.add(run.characterName);
      const scene = run.scene;
      if (scene !== undefined) cover.scenes.add(scene);
      const music = run.music;
      if (music !== undefined) cover.music.add(music);
      const boss = run.boss.boss;
      if (boss?.alive) cover.bosses.add(boss.name);
      fightingBoss = boss?.alive === true;
      aimX = boss?.alive && !boss.entering ? boss.x : run.enemies.enemies[0]?.x;

      for (const enemy of run.enemies.enemies) cover.enemies.add(enemy.name);
      // A pack shot puts player-faction bullets in the air; the pack effect emits
      // particles; the pack item lands as a named drop; events surface the shot,
      // the boss phase change and the pickup.
      let sawPlayerBullet = false;
      for (const b of run.bullets.bullets) {
        if (b.alive && b.faction === 'player') sawPlayerBullet = true;
      }
      if (sawPlayerBullet) cover.playerBulletTicks++;
      for (const particle of run.effects.particles) cover.effectSprites.add(particle.spec.sprite);
      for (const item of run.items.items) cover.items.add(item.name);
      for (const event of run.drainEvents()) cover.events.add(event.type);
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

describe('the in-memory full pack fixture is reachable and its content runs', () => {
  const { campaigns, characterPacks } = injectFixture();
  const cover = playCampaign(campaigns, characterPacks);

  test('injection contributes exactly the entry campaign row and the pack character', () => {
    expect(campaigns).toEqual([
      { label: q('trial'), stage: q('trial'), packsData: PACKS_DATA },
    ]);
    expect(characterPacks).toEqual([{ character: PACK_CHARACTER, packsData: PACKS_DATA }]);
  });

  test('the run played to ALL CLEAR rather than falling out early', () => {
    expect(cover.ticks).toBeGreaterThan(500);
    expect(cover.states.has('cleared')).toBe(true);
  });

  test('SELECT offered the pack character and the run flew it, not a built-in', () => {
    expect(characterNames()).toContain(PACK_CHARACTER);
    expect(cover.characters.has(PACK_CHARACTER)).toBe(true);
    expect(cover.characters.size).toBe(1);
  });

  test('the pack shot fired — player bullets were in the air', () => {
    expect(cover.playerBulletTicks).toBeGreaterThan(0);
    expect(cover.events.has('shot')).toBe(true);
  });

  test('both pack stages ran — the entry, and its next chain', () => {
    expect(cover.stages.has(q('trial'))).toBe(true);
    expect(cover.stages.has(q('finale'))).toBe(true);
    // The built-in starter was never entered: the campaign row steered the run.
    expect(cover.stages.has('stage-1')).toBe(false);
  });

  test('both pack enemies actually spawned, under their qualified names', () => {
    expect(cover.enemies.has(q('emitter'))).toBe(true);
    expect(cover.enemies.has(q('drone'))).toBe(true);
  });

  test('the pack effect fired and the pack item dropped and was collected', () => {
    // `spark` paints `mote` particles — a cell no built-in effect emits, so a
    // live `mote` particle can only be the pack effect fired by the emitter's death.
    expect(cover.effectSprites.has('mote')).toBe(true);
    // `token` drops from the emitter's spoils, landing under its qualified name.
    expect(cover.items.has(q('token'))).toBe(true);
    // And the pickup mechanic ran — the immortal pilot swept up drops.
    expect(cover.events.has('pickup')).toBe(true);
  });

  test('the pack end boss arrived and advanced beyond its opening phase', () => {
    expect(cover.bosses.has(q('keeper'))).toBe(true);
    // The pack boss transitioned past its opening phase.
    expect(cover.events.has('boss-phase')).toBe(true);
  });

  test('the pack boss dialogue was reached — its exchange is on the real path', () => {
    // `keeper` carries a two-line exchange the pilot taps through before the fight.
    // Seeing its qualified portrait as a dialogue speaker proves the whole wire: the pack
    // `portraits` name qualified onto the boss spec, the Run entered the dialogue
    // phase on boss-send, and the getter exposed the speaker — the honesty-rule
    // feature is on the campaign's real path, not merely registered.
    expect(cover.dialogueSpeakers.has(q('keeper'))).toBe(true);
  });

  test('each pack stage entered its declared built-in scene, and the pack boss overrode it', () => {
    expect(cover.scenes.has('expanse')).toBe(true);
    expect(cover.scenes.has('undertow')).toBe(true);
    // The fixture spell card overrides the scene to `drift` — a background nothing
    // else in this campaign names, so seeing it proves the card's override was
    // reported by `Run.scene`.
    expect(cover.scenes.has('drift')).toBe(true);
  });

  test('the pack track scored the entry stage — Run.music reported it, qualified', () => {
    // `trial.music: "pulse"` qualifies to the fixture pack's track; the getter reports
    // it live for the life of that stage, exactly as `Run.scene` reports the
    // stage's background. This is the headless half of the music feature — the
    // reconcile-and-crossfade that turns the string into sound is browser-judged.
    expect(cover.music.has(q('pulse'))).toBe(true);
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
    expect(last?.meta?.stage).toBe(q('finale'));
  });
});

/**
 * The data tier's one subtle MUST, from the other direction: a pack ship flown
 * off the plain START row — a built-in stage, no campaign to arm `packsData` —
 * still records the owning pack's identity, because a pack character drives the
 * simulation with pack content. Without this, a replay of that run records
 * `packsData ''` and would play back under different content unchecked.
 *
 * Proved at the states level with a synthetic character in `states.test.ts`; here
 * it is the fixture's real pack character driven through the real machine, off a menu
 * with no campaign row at all.
 */
describe('a pack ship flown off the plain START row records the pack identity', () => {
  test('finishRecording carries packsData though the stage is a built-in', () => {
    // Source `characterPacks` from the loader's real pairing, NOT a hand-built
    // fixture: the identity must reach the run through the same producer the
    // shell uses, or a broken shell wire (the `characters` half unmapped) would
    // pass here while failing in the browser — the exact gap this test closes.
    const { characterPacks } = injectFixture();
    const machine = new StateMachine();
    let seed = 1;
    const ctx: GameContext = {
      machine,
      nextSeed: () => 0x51ee + seed++,
      // No campaigns: START is the only title row, so the campaign wire never
      // arms `packsData`. The character path is the only thing that can.
      campaigns: [],
      characterPacks,
    };
    machine.push(new TitleState(ctx));

    const fixtureCharacterIndex = characterNames().indexOf(PACK_CHARACTER);
    expect(fixtureCharacterIndex).toBeGreaterThanOrEqual(0);

    // Drive title (START, row 0) → character select → the pack ship. A short cap:
    // this only needs to reach PLAYING, not clear anything.
    let pulse = 0;
    let playing: { run: Run; characterName: string } | undefined;
    for (let tick = 0; tick < 2_000 && playing === undefined; tick++) {
      const top = machine.stack[machine.stack.length - 1];
      const nm = top?.name ?? '?';
      let buttons = 0;
      if (nm === 'character-select') {
        const view = top?.view?.() as { selected?: number } | undefined;
        const selected = view?.selected ?? 0;
        pulse ^= 1;
        if (selected < fixtureCharacterIndex) buttons = pulse ? Button.Down : 0;
        else buttons = pulse ? Button.Shot : 0;
      } else {
        // Title (single START row) — pulse confirm.
        pulse ^= 1;
        buttons = pulse ? Button.Shot : 0;
      }
      machine.tick(buttons);
      const cur = machine.stack[machine.stack.length - 1];
      if (cur?.name === 'playing') {
        playing = cur as unknown as { run: Run; characterName: string };
      }
    }

    if (playing === undefined) throw new Error('never reached PLAYING with the pack ship');
    expect(playing.characterName).toBe(PACK_CHARACTER);
    // A built-in stage — no campaign steered it — yet the pack identity is armed.
    expect(playing.run.stageName).toBe('stage-1');
    expect(ctx.packsData).toBe(PACKS_DATA);
    expect(playing.run.finishRecording().meta?.packsData).toBe(PACKS_DATA);
  });
});

/**
 * Difficulty is real on pack content, not just built-ins: the same seed over the
 * pack's own entry stage fires a different curtain per tier, and a replay of a
 * pack campaign is refused across tiers exactly as a mismatched stage or
 * character is. Driven at the `Run` level (not through the menus) so the claim is
 * the simulation's, isolated from the difficulty-select screen the other tests
 * already exercise.
 */
describe('difficulty is real on pack content', () => {
  // Ensure the fixture entry stage is registered (idempotent per pack name).
  injectFixture();

  /** Enemy-faction bullets summed over a fixed window of the entry run at `tier`. */
  function entryEnemyExposure(tier: Difficulty, ticks = 700): number {
    const run = new Run({ seed: 0x9a12, character: 'scout', stage: q('trial'), difficulty: tier });
    let total = 0;
    for (let t = 0; t < ticks && !run.finished; t++) {
      // Immortal and firing nothing (input 0): the only bullets in the air are the
      // enemies' own, so the count is a clean read of what the tier put up.
      run.player.lives = 9;
      run.player.alive = true;
      run.player.invuln = 999;
      run.tick(0);
      for (const b of run.bullets.bullets) {
        if (b.alive && b.faction === 'enemy') total++;
      }
    }
    return total;
  }

  test('an entry run at Lunatic fires a denser curtain than Normal, and Easy thinner', () => {
    // The emitter's aimed-fan carries a `difficulty` block (count 2/3/·/6), so
    // the same seed puts more bullets up as the tier rises. This is the honesty
    // guard for the pack surface: if a refactor drops
    // the blocks, `mergeOptions` returns the base on every tier and this collapses.
    const easy = entryEnemyExposure('easy');
    const normal = entryEnemyExposure('normal');
    const lunatic = entryEnemyExposure('lunatic');
    expect(normal).toBeGreaterThan(easy);
    expect(lunatic).toBeGreaterThan(normal);
  });

  test('a replay of a pack campaign is refused across tiers, accepted on the same one', () => {
    const seed = 0x4242;
    const live = new Run({ seed, character: 'scout', stage: q('trial'), difficulty: 'normal' });
    for (let t = 0; t < 200; t++) live.tick(0);
    const replay = live.finishRecording();
    // Same tier, same pack stage: accepted.
    expect(
      () => new Run({ seed, character: 'scout', stage: q('trial'), difficulty: 'normal', replay }),
    ).not.toThrow();
    // A different tier is a different run — the tier changed what bullets are in
    // the air — so it is refused, strict like a mismatched stage or character.
    expect(
      () => new Run({ seed, character: 'scout', stage: q('trial'), difficulty: 'lunatic', replay }),
    ).toThrow(/difficulty/);
  });
});
