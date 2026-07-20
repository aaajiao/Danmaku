/**
 * Every registered name a real run actually reaches.
 *
 * The third whole-tree test, alongside `determinism.test.ts` (approximated
 * `Math` in the headless trees) and `architecture.test.ts` (renderer imports in
 * them). Each exists because the thing it checks fails silently, and this one
 * covers the failure class that produced most of this project's audit:
 *
 *   **content that is written, registered, tested, and unreachable.**
 *
 * The distinction matters and it is exactly where the existing guards stop.
 * `content/index.ts` and its test prove every content module is *imported*, so
 * its `define*` calls run and its names resolve. That was itself written after
 * `behaviours`, `shots` and `stage-2` shipped absent from the bundle. It fixed
 * registration. It could not fix reachability, and the identical gap moved up
 * one layer — from the bundler to the state machine — where nothing was looking:
 *
 *  - Three bosses, ten phases, seven spell cards: registered, and no boss fight
 *    existed in the shipped game, because `GameContext` never named one.
 *  - Stage 2 entire — five enemy types, a midboss, a four-phase boss, both
 *    perspective backgrounds, all four motion behaviours: registered, and no
 *    sequence of inputs could reach it, because clearing a stage offered only
 *    RETRY and TITLE.
 *  - Three weapons at four tiers each: registered, and `getShot` had no
 *    production caller.
 *  - Four of five item kinds, three of six particle effects, four of six
 *    sounds: registered, emitted by nothing.
 *
 * Every one of those was green under 1289 passing tests, because a unit test
 * supplies the missing wire itself. `player.test.ts` built its own three-entry
 * shot table, so the clamp was tested against content that was not shipped;
 * `option.test.ts` passed `powerLevel` explicitly, proving tiers the game could
 * not reach. That is not a criticism of those tests — it is what a unit test
 * *is*. Reachability has to be asserted against the real machine or not at all.
 *
 * So this file drives the real `StateMachine` through the real `GameContext`,
 * the way `main.ts` does, and asserts that the registries are covered by what
 * actually happens.
 *
 * ## It has been watched failing
 *
 * Deleting two lines from `stage-1` — its `boss` and its `next`, which is
 * exactly the state the project shipped in — turns 24 passing assertions here
 * into 10, with 14 failures naming the stage, the bosses, their phases, the
 * scenes, four of five item kinds, the power ceiling, the ending screen and six
 * event types. The rest of the suite stays green throughout. That is the
 * measurement of what this file is worth, and it is why it exists rather than a
 * longer list of unit tests.
 *
 * ## The pilot is a competent player, compressed
 *
 * It is mortal for the opening of each run and untouchable afterwards, and both
 * halves are load-bearing. The deaths give `player-death` and the power-loss
 * economy real coverage. The clean stretch is what lets it capture spell cards,
 * and therefore what makes the score-gated `life` item reachable at all — a
 * flailing pilot finishes the game on 52,000 points and a clean one on 547,000,
 * so a probe that only flails would report the extend threshold as unreachable
 * content rather than as its own lack of skill.
 *
 * Lives are refilled regardless. This measures **can a player reach this**, not
 * **can a player survive this** — different questions, and only the first has an
 * objective answer. Difficulty belongs in `balance.test.ts`.
 */

import { describe, expect, test } from 'bun:test';

import '../content';
import { Button } from '../core/input';
import {
  activePhaseIndices,
  DEFAULT_DIFFICULTY,
  DIFFICULTIES,
  type Difficulty,
} from '../sim/difficulty';
import { bossNames, getBossSpec } from '../sim/boss';
import { effectNames, getEffectSpec } from '../sim/effects';
import { soundNames } from '../audio';
import { MENU_MUSIC, musicNames } from '../audio/music';
import { bombNames } from '../sim/bomb';
import { enemyNames } from '../sim/enemy';
import { itemNames } from '../sim/item';
import { getOptionSpec, optionNames } from '../sim/option';
import { getStage, stageNames } from '../content/stage';
import { getShot, shotNames } from '../content/shots';
import { EVENT_SOUNDS } from './cues';
import { StateMachine } from './state';
import { TitleState, type GameContext } from './states';
import { characterNames, type Run, type RunEventType } from './run';

/**
 * Ticks at the start of each run during which the pilot can be killed.
 * Comfortably before any boss arrives, so deaths land on the stage script and
 * spell-card captures are unaffected.
 */
const MORTAL_TICKS = 1500;

/**
 * Registered by a test rather than by the game: a fixture, not content.
 *
 * Two conventions are in use and both have to be caught. Most fixtures take a
 * `test`/`probe.`/`balance.` prefix; `shots.test.ts` instead names its after
 * its own file, as `shots.test.duplicate`. The `.test.` clause was added when
 * the shot-type assertion below passed alone and failed under the full suite —
 * a registry populated by whichever sibling happened to run first is exactly
 * the cross-file coupling this file exists to make visible, and it is worth
 * noting that the failure was *correct*: nothing was flying `shots.test.*`.
 */
const isFixture = (name: string): boolean =>
  name.startsWith('test') ||
  name.startsWith('probe.') ||
  name.startsWith('balance.') ||
  name.includes('.test.') ||
  // Pack content registers under a qualified `<pack>/<entry>` name and is
  // reachable only through its own campaign row, never a built-in playthrough
  // (decisions-f2). Exempting it here is what lets the example-pack acceptance
  // test inject a pack into this shared process without its namespaced entries
  // failing these built-in scans — that test is the proof they are reachable,
  // the same division of labour the format-1 packs already follow.
  name.includes('/');

const content = (names: readonly string[]): string[] => names.filter((n) => !isFixture(n));

const union = <T>(runs: readonly Coverage[], pick: (c: Coverage) => Set<T>): Set<T> =>
  new Set(runs.flatMap((run) => [...pick(run)]));

interface Coverage {
  states: Set<string>;
  stages: Set<string>;
  bosses: Set<string>;
  phases: Set<string>;
  items: Set<string>;
  effects: Set<string>;
  events: Set<RunEventType>;
  scenes: Set<string>;
  /** Music tracks a real run actually asked for, via `run.music`. */
  music: Set<string>;
  /** Characters actually flown, by registry name. */
  characters: Set<string>;
  /** Option formations a flown ship deployed, by registry name. */
  optionSets: Set<string>;
  /** Bombs that actually detonated, by registry name — not merely equipped. */
  bombsFired: Set<string>;
  /** Shot types a flown ship carried, by registry name. */
  shots: Set<string>;
  /** Enemy types that actually spawned, by registry name. */
  enemies: Set<string>;
  /** The tier each run in this coverage was actually flown on, via `run.difficulty`. */
  difficulties: Set<string>;
  maxPower: number;
  maxOptions: number;
  ticks: number;
}

/**
 * Which registered shot type this ship is carrying.
 *
 * `CharacterSpec` stores the resolved `levels` array rather than the name it
 * came from, so the name has to be recovered by identity. That is not a
 * weakness of the test: `getShot(n).levels` returns the registry's own array,
 * so a match is proof the character was built from that entry rather than from
 * a copy that happens to look like it.
 */
function shotNameOf(run: Run): string | undefined {
  return content(shotNames()).find((n) => getShot(n).levels === run.character.player.shots);
}

/**
 * Play the game from the title screen to the end, and report what was touched.
 *
 * Menus are driven by pulsing CONFIRM on alternate ticks, because `Edges` reads
 * a press as an edge — holding the button would confirm once and then sit.
 *
 * `characterIndex` selects a ship by pressing Down that many times on the
 * select screen before confirming. It exists because the first version of this
 * probe took the default and therefore flew `scout` every time, which left the
 * second half of three separate registries — `seeker` options, the `lance`
 * bomb, the `needle` ladder — touched by nothing that drives the real machine.
 * That is the same defect the file is named for, one menu index down, and it
 * survived here precisely because a probe that reaches the end of the game
 * looks like it has covered the game.
 */
function playThroughGame(
  characterIndex = 0,
  difficulty: Difficulty = DEFAULT_DIFFICULTY,
  limit = 400_000,
): Coverage {
  const machine = new StateMachine();
  let seed = 1;
  const ctx: GameContext = { machine, nextSeed: () => 0x51ee + seed++ };
  machine.push(new TitleState(ctx));

  // Steps of Down needed to move the difficulty cursor from its NORMAL default
  // onto the wanted tier, wrapping — the screen opens on Normal, so a tier below
  // it is reached the long way round, exactly as a player's Downs would.
  const tierSteps =
    (DIFFICULTIES.indexOf(difficulty) -
      DIFFICULTIES.indexOf(DEFAULT_DIFFICULTY) +
      DIFFICULTIES.length) %
    DIFFICULTIES.length;
  let tierDescended = 0;

  const cover: Coverage = {
    states: new Set(),
    stages: new Set(),
    bosses: new Set(),
    phases: new Set(),
    items: new Set(),
    effects: new Set(),
    events: new Set(),
    scenes: new Set(),
    music: new Set(),
    characters: new Set(),
    optionSets: new Set(),
    bombsFired: new Set(),
    shots: new Set(),
    enemies: new Set(),
    difficulties: new Set(),
    maxPower: 0,
    maxOptions: 0,
    ticks: 0,
  };

  let confirm = 0;
  let descended = 0;
  let seenRuns = 0;
  let lastRun: Run | undefined;
  /**
   * Where the pilot is steering, observed at the end of the previous tick.
   *
   * A sweeping pilot that never lines up under a boss times every card out
   * instead of damaging one — the first version of this probe cleared all ten
   * cards and emitted `boss-hit` zero times, which would have reported a
   * working damage path as broken content. Aiming is not optional in a probe
   * whose job is to prove things are reachable.
   */
  let aimX: number | undefined;
  let playerX = 240;
  let playerY = 400;
  let fightingBoss = false;
  /**
   * Whether the run was showing a dialogue line at the end of the previous tick.
   *
   * A boss carrying dialogue holds behind an exchange that a *fresh* Shot press
   * advances — a held Shot never does. The combat pilot holds Shot continuously,
   * so without this it would never produce the edge and would stall at the first
   * exchange until the tick limit, timing out with the boss unreached. Observed
   * from `run.dialogue` after each tick, and used to pulse Shot on the next one.
   */
  let inDialogue = false;

  for (let tick = 0; tick < limit; tick++) {
    cover.ticks = tick;
    const top = machine.stack[machine.stack.length - 1];
    const name = top?.name ?? '?';
    cover.states.add(name);

    let buttons = 0;
    if (name === 'playing' && inDialogue) {
      // Tap through the pre-boss exchange: a fresh Shot press advances a line, a
      // held one does not, so pulse it. The field is frozen, so nothing else the
      // combat pilot does matters — it only has to keep pressing to reach the
      // fight. This is the proof the feature sits on the real path.
      confirm ^= 1;
      buttons = confirm ? Button.Shot : 0;
    } else if (name === 'playing') {
      // Sweep across the field while firing, and lift toward the auto-collect
      // line periodically so drops are actually picked up rather than falling
      // past. Nothing here is skilful; it only has to touch things.
      buttons = Button.Shot;
      if (aimX === undefined) {
        // Nothing to track: sweep, so the stage script's spawns are covered.
        buttons |= Math.floor(tick / 70) % 2 === 0 ? Button.Left : Button.Right;
      } else if (aimX < playerX - 4) {
        buttons |= Button.Left;
      } else if (aimX > playerX + 4) {
        buttons |= Button.Right;
      }
      // Hold a station, rather than only ever pressing Up. Shots travel up, so
      // a pilot that drifts to the top of the field is *above* every boss and
      // fires away from it — the first version of this probe pressed Up a third
      // of the time, never pressed Down, sat at y=0 for every fight, timed out
      // all ten cards and emitted `boss-hit` zero times. It would have reported
      // a working damage path as unreachable content.
      //
      // The station rises periodically to cross the auto-collect line so drops
      // are gathered, and stays low while a boss is up.
      const stationY = !fightingBoss && Math.floor(tick / 240) % 3 === 0 ? 60 : 380;
      if (playerY > stationY + 6) buttons |= Button.Up;
      else if (playerY < stationY - 6) buttons |= Button.Down;
      // Bombs only while there is no boss up: a bomb voids the card's `clean`
      // flag, so bombing during one would cost the bonuses this pilot needs in
      // order to reach the extend thresholds.
      if (!fightingBoss && Math.floor(tick / 300) % 4 === 0) buttons |= Button.Bomb;
    } else if (name === 'difficulty-select' && tierDescended < tierSteps) {
      // Walk the tier cursor onto the wanted difficulty before confirming,
      // pulsed like every other menu move. Once it arrives the generic branch
      // below pulses CONFIRM and the run starts on this tier — so a probe asked
      // for Normal takes zero Downs and confirms the default, unchanged.
      confirm ^= 1;
      if (confirm) {
        buttons = Button.Down;
        tierDescended++;
      }
    } else if (name === 'character-select' && descended < characterIndex) {
      // Walk down to the requested ship first, pulsed for the same reason
      // CONFIRM is: `Edges` reads a press as an edge, so a held Down moves once.
      confirm ^= 1;
      if (confirm) {
        buttons = Button.Down;
        descended++;
      }
    } else {
      confirm ^= 1;
      buttons = confirm ? Button.Shot : 0;
    }

    machine.tick(buttons);

    for (const state of machine.stack) {
      const run = (state as { run?: Run }).run;
      if (run === undefined) continue;

      if (run !== lastRun) {
        lastRun = run;
        seenRuns++;
        cover.stages.add(run.stageName);
        cover.characters.add(run.characterName);
        cover.difficulties.add(run.difficulty);
        cover.optionSets.add(run.character.options);
        const shot = shotNameOf(run);
        if (shot !== undefined) cover.shots.add(shot);
      }

      // Sampled rather than declared. `BombSystem.name` is set on deploy and
      // cleared when the blast ends, so a name here is proof one detonated —
      // whereas `character.bomb` would only prove the ship was carrying it.
      if (run.bombs.name !== '') cover.bombsFired.add(run.bombs.name);

      // See the header: mortal early, untouchable later, always restocked.
      if (run.player.lives < 3) run.player.lives = 3;
      run.player.alive = true;
      if (run.tickCount > MORTAL_TICKS) run.player.invuln = 999;

      const scene = run.scene;
      if (scene !== undefined) cover.scenes.add(scene);

      const track = run.music;
      if (track !== undefined) cover.music.add(track);

      playerX = run.player.x;
      playerY = run.player.y;
      // Observed here, consumed by the pilot next tick to pulse Shot through it.
      inDialogue = run.dialogue !== undefined;
      const boss = run.boss.boss;
      if (boss?.alive) {
        cover.bosses.add(boss.name);
        cover.phases.add(`${boss.name}#${boss.phaseIndex}`);
      }
      // Track the boss when there is one, the nearest enemy otherwise.
      fightingBoss = boss?.alive === true;
      aimX = boss?.alive && !boss.entering ? boss.x : run.enemies.enemies[0]?.x;

      for (const enemy of run.enemies.enemies) cover.enemies.add(enemy.name);
      for (const item of run.items.items) cover.items.add(item.name);
      for (const particle of run.effects.particles) cover.effects.add(particle.spec.sprite);
      for (const event of run.drainEvents()) cover.events.add(event.type);

      if (run.player.power > cover.maxPower) cover.maxPower = run.player.power;
      const active = run.options.options.filter((o) => o.active).length;
      if (active > cover.maxOptions) cover.maxOptions = active;
    }

    // Stop only once the **last** stage has been cleared. Breaking on any
    // `cleared` screen would stop at the end of stage 1, and every assertion
    // about stage 2 would then be measuring a game that was never played — a
    // probe that exits early reports a coverage gap as a content gap.
    const finished =
      lastRun !== undefined &&
      getStage(lastRun.stageName).next === undefined &&
      lastRun.outcome === 'cleared';
    if (finished && machine.stack[machine.stack.length - 1]?.name === 'cleared') break;
  }

  return cover;
}

/**
 * One playthrough per registered character, unioned.
 *
 * Shared across every assertion below: each is a few hundred thousand ticks of
 * real simulation — cheap enough to run in `bun test`, not cheap enough to run
 * once per assertion.
 *
 * Per *character* rather than once, because a ship's loadout is three registry
 * entries — shot, options, bomb — and the only way a playthrough touches them
 * is by flying it. Unioning is honest here: the claim each assertion makes is
 * "a real player can reach this", and a real player picks a ship.
 */
const RUNS = content(characterNames()).map((_, index) => playThroughGame(index));

const COVER: Coverage = {
  states: union(RUNS, (c) => c.states),
  stages: union(RUNS, (c) => c.stages),
  bosses: union(RUNS, (c) => c.bosses),
  phases: union(RUNS, (c) => c.phases),
  items: union(RUNS, (c) => c.items),
  effects: union(RUNS, (c) => c.effects),
  events: union(RUNS, (c) => c.events),
  scenes: union(RUNS, (c) => c.scenes),
  music: union(RUNS, (c) => c.music),
  characters: union(RUNS, (c) => c.characters),
  optionSets: union(RUNS, (c) => c.optionSets),
  bombsFired: union(RUNS, (c) => c.bombsFired),
  shots: union(RUNS, (c) => c.shots),
  enemies: union(RUNS, (c) => c.enemies),
  difficulties: union(RUNS, (c) => c.difficulties),
  maxPower: Math.max(...RUNS.map((c) => c.maxPower)),
  maxOptions: Math.max(...RUNS.map((c) => c.maxOptions)),
  ticks: Math.max(...RUNS.map((c) => c.ticks)),
};

describe('a real playthrough reaches', () => {
  test('every registered stage', () => {
    // The failure: stage 2 was finished content behind a menu with no exit.
    expect([...COVER.stages].sort()).toEqual(content(stageNames()).sort());
  });

  test('every registered boss', () => {
    // The failure: `GameContext` never named a boss, so none of them existed.
    expect([...COVER.bosses].sort()).toEqual(content(bossNames()).sort());
  });

  test('every registered enemy type', () => {
    // Name *resolution* is already guarded — `StageRunner`'s constructor
    // resolves every enemy a wave names, eagerly, so a typo throws at load.
    // This is the other claim: that a registered enemy is actually placed by
    // some stage a real run reaches. An enemy defined and imported but named by
    // no wave resolves fine and spawns never, which registration cannot see.
    expect([...COVER.enemies].sort()).toEqual(content(enemyNames()).sort());
  });

  test('every phase of every boss active on the flown tier', () => {
    // A boss that spawns but whose later cards are never seen is the same bug
    // one level down — `magistrate` reached only phase 0 while its health was
    // sized against a damage figure no player could produce.
    //
    // These runs are all on Normal, and a tier-gated card (`sentinel`'s
    // Lunatic-only fourth phase) is not fought on Normal, so `expected` is the
    // phases *active on the flown tier*, not every declared phase. Reading the
    // whole `phases` array would demand coverage of content this playthrough
    // cannot by construction reach; the Lunatic-only card is proved reachable in
    // the per-tier pass below instead. This is the stated phase-coverage policy.
    const expected: string[] = [];
    for (const name of content(bossNames())) {
      const phases = getBossSpec(name).phases;
      for (const i of activePhaseIndices(phases, DEFAULT_DIFFICULTY)) {
        expected.push(`${name}#${i}`);
      }
    }
    expect([...COVER.phases].sort()).toEqual(expected.sort());
  });

  test('every scene a stage or a card declares', () => {
    // **Not** compared against the background registry, and the reason is the
    // import boundary: `backgroundNames` is a value in `src/render`, and this
    // file is in `src/game`, which may not import one (CLAUDE.md). That is not
    // an inconvenience being worked around — it is the rule doing its job. A
    // scene is a *string* here precisely so the simulation never learns that
    // fragment shaders exist.
    //
    // So this asserts the run side: every scene any reachable stage or spell
    // card declares is actually entered. That those strings resolve to real
    // shaders is `render/backgrounds/index.test.ts`'s job, and it imports both
    // halves for exactly that purpose. Between the two files the round trip is
    // covered, and neither has to break the boundary to do it.
    const declared = new Set<string>();
    for (const stage of content(stageNames())) {
      const background = getStage(stage).background;
      if (background !== undefined) declared.add(background);
    }
    for (const boss of content(bossNames())) {
      for (const phase of getBossSpec(boss).phases) {
        if (phase.background !== undefined) declared.add(phase.background);
      }
    }

    expect(declared.size).toBeGreaterThan(0);
    expect([...COVER.scenes].sort()).toEqual([...declared].sort());
  });

  test('every registered track a stage, a boss, or the menu declares', () => {
    // Music is wired like scenes (declared per stage and boss), not like sounds
    // (cued per event), so this mirrors the scene test above — with two seams.
    //
    // First, the menu. `run.music` never yields the menu theme (a run is a stage
    // or a boss, never the title), so the shell supplies `MENU_MUSIC` as the
    // fallback and the menu is what "reaches" it — hence it joins `declared`
    // here but is excluded from the entered-check below.
    //
    // Second, boss-level not per-phase: unlike a scene, which a spell card can
    // override, a track is `BossSpec.music` and holds across a fight's cards, so
    // this reads `getBossSpec(boss).music` with no phase loop. Both are the same
    // string-across-a-boundary the scene test relies on — `musicNames` is
    // audio-side, reachable from `src/game` (this test already imports
    // `soundNames`), while the sim never learns a track exists.
    const declared = new Set<string>([MENU_MUSIC]);
    for (const stage of content(stageNames())) {
      const track = getStage(stage).music;
      if (track !== undefined) declared.add(track);
    }
    for (const boss of content(bossNames())) {
      const track = getBossSpec(boss).music;
      if (track !== undefined) declared.add(track);
    }

    // No dead track: every registered track is named by a stage, a boss, or the
    // menu, and every name a stage or boss declares is registered.
    expect(content(musicNames()).sort()).toEqual([...declared].sort());

    // And every track a stage or boss declares is actually entered by the real
    // playthrough — the menu excepted, since no run ever reports it.
    for (const track of [...declared].filter((n) => n !== MENU_MUSIC)) {
      expect(`${track} entered: ${COVER.music.has(track)}`).toBe(`${track} entered: true`);
    }
  });

  test('every registered item kind', () => {
    // The failure: four of five kinds spawned only from a boss defeat, which
    // never happened, and `life` had no spawn site at all.
    expect([...COVER.items].sort()).toEqual(content(itemNames()).sort());
  });

  test('every registered particle effect', () => {
    // The failure: `graze`, `pickup` and `muzzle` were emitted by nothing.
    // Compared by sprite, which is what a live particle carries.
    const emitted = new Set(COVER.effects);
    for (const name of content(effectNames())) {
      const sprite = getEffectSpec(name).sprite;
      expect(`${name} (${sprite}) emitted: ${emitted.has(sprite)}`)
        .toBe(`${name} (${sprite}) emitted: true`);
    }
  });

  test('the top power tier, and therefore every weapon and option tier', () => {
    // The failure: `addPower` clamped to `shots.length - 1` = 0, so power never
    // rose, no option ever deployed, and the whole `defineShot` registry was
    // unreachable. Asserted through power rather than by instrumenting the
    // tables, because power is the single number that indexes both.
    const tiers = Math.max(
      ...content(shotNames()).map((n) => getShot(n).levels.length),
      ...content(optionNames()).map((n) => getOptionSpec(n).levels.length),
    );
    expect(COVER.maxPower).toBe(tiers - 1);
    expect(COVER.maxOptions).toBeGreaterThan(0);
  });

  test('every state screen', () => {
    expect([...COVER.states].sort()).toEqual(
      ['character-select', 'cleared', 'difficulty-select', 'playing', 'title'].sort(),
    );
  });

  test('every registered character', () => {
    // The select screen is data-driven from `characterNames()`, so a registered
    // ship is always *offered*. This asserts one was actually flown, which is
    // the claim the three assertions below depend on: a character is the only
    // thing that reaches a shot type, an option formation or a bomb.
    expect([...COVER.characters].sort()).toEqual(content(characterNames()).sort());
  });

  test('every registered shot type', () => {
    // `homing` and `laser` were registered, imported, unit-tested and equipped
    // by nobody — `getShot` had exactly two callers in the project — so two of
    // the four weapons in the game could not be fired by any sequence of
    // inputs. `hound` and `spire` are the consumers; this is the assertion that
    // stops the next weapon sitting in the same state.
    expect([...COVER.shots].sort()).toEqual(content(shotNames()).sort());
  });

  test('every registered option formation', () => {
    expect([...COVER.optionSets].sort()).toEqual(content(optionNames()).sort());
  });

  test('every registered sound, via an event something raises', () => {
    // Two claims, and the suite could previously make neither. The table lived
    // in `main.ts`, which no test can import, so a registered sound that
    // nothing pointed an event at was silent forever with everything green —
    // the state four of the six were in.
    //
    // Left column: every cue names a sound that exists. Right column: every
    // registered sound is named by some cue. Both are needed. A cue naming a
    // sound nobody registered is a mute event; a sound no cue names is an
    // asset someone will author and never hear.
    const cued = new Set(Object.values(EVENT_SOUNDS));
    for (const name of cued) {
      expect(`${name} is registered: ${soundNames().includes(name)}`).toBe(
        `${name} is registered: true`,
      );
    }
    expect([...cued].sort()).toEqual(content(soundNames()).sort());

    // And every registered sound is reachable through an event this probe
    // actually raised. Not "every cue-event is raised": `failed` (game over)
    // cues `death`, and this pilot is immortal by construction, so that row
    // never fires — but `death` is still heard, because `player-death` cues it
    // too. The claim that matters is that no sound is stranded behind only
    // unreachable events, and it is asserted per sound rather than per cue.
    const reachableSounds = new Set(
      (Object.entries(EVENT_SOUNDS) as [RunEventType, string][])
        .filter(([type]) => COVER.events.has(type))
        .map(([, sound]) => sound),
    );
    for (const name of content(soundNames())) {
      expect(`${name} reachable: ${reachableSounds.has(name)}`).toBe(
        `${name} reachable: true`,
      );
    }
  });

  test('every registered bomb, actually detonated', () => {
    // Sampled from `BombSystem.name` while a blast is live, so this proves a
    // bomb went off rather than that a ship was carrying one. Equipping is a
    // spec field; detonating is a code path, and `#resolveBombDamage` dealt
    // zero damage for the life of the project without either being noticed.
    expect([...COVER.bombsFired].sort()).toEqual(content(bombNames()).sort());
  });
});

describe('a real playthrough emits', () => {
  // Sounds and particles are chosen by event type in `main.ts`, so an event
  // nothing raises is a cue nothing plays. `'item-collected'` sat in that table
  // for the life of the project and matched no event that has ever existed.
  const EXPECTED: readonly RunEventType[] = [
    'shot',
    'shot-hit',
    'enemy-killed',
    'boss-hit',
    'graze',
    'bomb',
    'pickup',
    'extend',
    'player-death',
    'boss-entered',
    'boss-phase',
    'boss-cleared',
    'boss-defeated',
    'cleared',
  ];

  for (const type of EXPECTED) {
    test(`${type}`, () => {
      expect(`${type}: ${COVER.events.has(type)}`).toBe(`${type}: true`);
    });
  }
});

/**
 * The difficulty axis is wired end to end and its gated content is reachable.
 *
 * The full playthrough above stays on Normal — difficulty is not about survival
 * (that is `balance.test.ts`) but about which content exists, and the Normal
 * coverage is what every assertion above measures. This block adds the tier
 * dimension in the cheapest honest way.
 *
 * Cost measured: a full per-character Normal playthrough is ~150ms (the `RUNS`
 * union above is four of them, ~0.63s total). Running a full probe once per tier
 * would be ~0.6s more; but only Lunatic needs a full run, to reach the
 * Lunatic-only card that sits after the stage-1 boss's third phase. Easy, Normal
 * and Hard only need to prove the tier was selected and reached a run, which the
 * first few hundred ticks settle — so those are short smokes and Lunatic alone
 * is a full run. One full run + three smokes measured at ~0.34s here, well
 * inside the suite budget, so no truncated per-tier density check is needed.
 */
describe('each difficulty tier is reachable and real', () => {
  const LUNATIC = playThroughGame(0, 'lunatic');
  const SMOKE_LIMIT = 3000;
  const smokes = (['easy', 'normal', 'hard'] as const).map((tier) => ({
    tier,
    cover: playThroughGame(0, tier, SMOKE_LIMIT),
  }));

  test('the difficulty-select screen is on the path to every run', () => {
    // The screen `TitleState` now replaces into: no tier reaches a run without
    // passing through it, on the full Lunatic run and on every smoke alike.
    for (const { cover } of smokes) expect(cover.states.has('difficulty-select')).toBe(true);
    expect(LUNATIC.states.has('difficulty-select')).toBe(true);
  });

  test('each tier is the tier the run is actually flown on', () => {
    // Proves the selection wire — title → difficulty-select → character-select →
    // RunConfig.difficulty — carries the chosen tier all the way to the `Run`.
    for (const { tier, cover } of smokes) {
      expect(`${tier}: ${[...cover.difficulties].sort().join(',')}`).toBe(`${tier}: ${tier}`);
    }
    expect([...LUNATIC.difficulties]).toEqual(['lunatic']);
  });

  test('a Lunatic-only card is reached only on Lunatic', () => {
    // `sentinel`'s fourth phase is `difficulties: ['lunatic']`. The Normal
    // coverage must never touch it (the phase-coverage policy above depends on
    // that), and the real Lunatic playthrough must — proved by fighting it, not
    // asserted from the spec. Its spec index is the count of ungated phases.
    const spec = getBossSpec('sentinel');
    const gatedIndex = activePhaseIndices(spec.phases, DEFAULT_DIFFICULTY).length;
    const gated = `sentinel#${gatedIndex}`;
    expect(`normal has ${gated}: ${COVER.phases.has(gated)}`).toBe(`normal has ${gated}: false`);
    expect(`lunatic has ${gated}: ${LUNATIC.phases.has(gated)}`).toBe(`lunatic has ${gated}: true`);
  });
});

describe('the probe itself is honest', () => {
  test('it played a real game rather than falling out early', () => {
    expect(COVER.ticks).toBeGreaterThan(10_000);
    expect(COVER.states.has('cleared')).toBe(true);
  });

  test('the fixture filter matches fixtures and nothing else', () => {
    // Registries are process-global, so running the whole suite in one process
    // puts other files' fixtures in here alongside the real content. Asserted
    // on synthetic names rather than on the live registry, because when this
    // file runs *alone* there are no fixtures to find — and a check that
    // silently passes on an empty set is the thing being guarded against.
    expect(['test-other-boss', 'test.dupe', 'probe.sink', 'balance.empty'].filter(isFixture))
      .toHaveLength(4);
    expect(['sentinel', 'magistrate', 'stage-1', 'stage-2'].filter(isFixture))
      .toHaveLength(0);
    // The '/'-branch is surgical: a qualified pack name is a fixture here, and
    // no built-in name — none of which contains '/' — is caught by it.
    expect(['example/gauntlet', 'example/ember'].filter(isFixture)).toHaveLength(2);
    expect(['sentinel', 'magistrate', 'stage-1', 'stage-2', 'scout', 'lance'].some((n) => n.includes('/')))
      .toBe(false);
  });
});
