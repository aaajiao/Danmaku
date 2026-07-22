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

import { afterAll, describe, expect, test } from 'bun:test';

import './v4';
// The v4 campaign data, walked by the beam-sweep coupling test below. Read as data
// here (root/composition layer) because `src/content` may not import `src/packs`
// at all — the pack boundary is total (architecture.test.ts) — so the invariant
// is pinned where the beam reachability collectors already live.
import basePack from './v4/content/campaign.json';
import { Button } from './core/input';
import { fx, sim } from './core/random';
import {
  activePhaseIndices,
  DEFAULT_DIFFICULTY,
  DIFFICULTIES,
  type Difficulty,
} from './sim/difficulty';
import { bossNames, getBossSpec } from './sim/boss';
import { effectNames, getEffectSpec } from './sim/effects';
import { soundNames } from './audio';
import { MENU_MUSIC, musicNames } from './audio/music';
import { bombNames } from './sim/bomb';
import { enemyNames } from './sim/enemy';
import { itemNames } from './sim/item';
import { getOptionSpec, optionNames } from './sim/option';
import { getStage, stageNames } from './content/stage';
import { getShot, shotNames } from './content/shots';
import type { Bullet } from './sim/bullet';
// The composed game's laser-skin registry (render-side). This file is the shell's
// layer — it already imports `render`-adjacent registries the way `main.ts` does —
// so it reads the skin names as the source of truth for the "every body reached"
// gate below, rather than hard-coding the eight.
import { laserSkinNames } from './render/laser-skin';
// The composed game's missile-body cells (render-side), read as the source of
// truth for the "every body reached" gate below — the `laserSkinNames` idiom for
// the missile sheet. This file is the shell's layer and already reads
// render-adjacent registries the way `main.ts` does.
import { MISSILE_STRIP_CELLS } from './render/procedural';
import { EVENT_SOUNDS, SHELL_CUES } from './game/cues';
import { StateMachine } from './game/state';
import { TitleState, type GameContext } from './game/states';
import { characterNames, type Run, type RunEventType } from './game/run';

// This file drives whole playthroughs at module load (the `RUNS` union below)
// and in its tests, which advances the global sim/fx streams. bun loads-and-runs
// test files one at a time, so core/random.test.ts — which asserts both streams
// are pristine at its own import — would see this file's leftovers when it loads
// next. Capture before any driving and restore on the way out, the good-citizen
// pattern base-content.golden.test.ts uses.
const SIM_ENTRY_STATE = sim.getState();
const FX_ENTRY_STATE = fx.getState();
afterAll(() => {
  sim.setState(SIM_ENTRY_STATE);
  fx.setState(FX_ENTRY_STATE);
});

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
  /**
   * Laser skins (`b.style.sprite`) a real run actually put on the field — the
   * reachability half of "all 11 consumed": every registered body skin must be
   * fired by reachable content (caps are render-only, proven by
   * `render/laser-skin.test.ts`, not here). Collected off `run.bullets.bullets`.
   */
  beamSkins: Set<string>;
  /** A beam was observed in its telegraph window (`age < warmup`, harmless-but-drawn). */
  beamTelegraphed: boolean;
  /** A beam was observed lethal — the segment hit-test path ran on a real beam. */
  beamLethal: boolean;
  /** A beam was observed in its decay window (`age ≥ life − cooldown`, harmless again). */
  beamDecaying: boolean;
  /**
   * `beam-sweep` actually turned a lethal beam: its `theta` moved between ticks
   * while `w === 0` (the vector integrates no turn), so the swing came from the
   * behaviour and not from `w`. Proves the round's one new verb RAN, not merely
   * registered.
   */
  beamSwept: boolean;
  /**
   * Missile body skins (`b.style.sprite`) a real run put on the field — the
   * reachability half of "all 13 missile bodies consumed": every registered body
   * (`MISSILE_STRIP_CELLS`, `render/procedural.ts`) must be fired by reachable
   * content. Collected off `run.bullets.bullets` where `b.missile !== undefined`,
   * exactly as `beamSkins` reads the laser field. The three `missile.pop.*`
   * detonation tiers need no field here — the existing "every registered particle
   * effect" scan already fails the build if a tier is emitted by nobody.
   */
  missileSkins: Set<string>;
  /**
   * The homing seek loop actually TURNED a missile: its `theta` moved between
   * ticks while `w === 0` (the vector integrates no turn), so the swing came from
   * the `homing` behaviour, not from `w` — the missile analogue of `beamSwept`,
   * and the proof homing RAN in a real fight rather than merely being registered.
   * A dumbfire missile (no `homing`) never sets this, which is correct.
   */
  missileHomed: boolean;
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
  // it is reached the long way round, exactly as a player's Downs would. The
  // screen now carries one extra row beneath the four tiers — the infinite-lives
  // assist toggle — and the cursor wraps over it too, so a downward wrap counts
  // that row. The toggle is only ever *passed through* here (a Down over it moves
  // on; only CONFIRM flips it), so the cursor still lands on the wanted tier.
  const DIFFICULTY_ROWS = DIFFICULTIES.length + 1;
  const tierSteps =
    (DIFFICULTIES.indexOf(difficulty) -
      DIFFICULTIES.indexOf(DEFAULT_DIFFICULTY) +
      DIFFICULTY_ROWS) %
    DIFFICULTY_ROWS;
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
    beamSkins: new Set(),
    beamTelegraphed: false,
    beamLethal: false,
    beamDecaying: false,
    beamSwept: false,
    missileSkins: new Set(),
    missileHomed: false,
    maxPower: 0,
    maxOptions: 0,
    ticks: 0,
  };

  // Per-beam heading at the end of the previous tick, keyed by (bullet, generation)
  // so a pooled slot reused for a new beam does not inherit the old one's angle —
  // the `beam-sweep` detector below compares against it to see a lethal beam turn.
  const priorTheta = new Map<Bullet, { generation: number; theta: number }>();
  // The same, for missiles: a homing missile's heading last tick, so the detector
  // below can see the `homing` behaviour turn it. Disjoint from `priorTheta` — a
  // bullet is a beam or a missile or neither, never both — but kept separate for
  // clarity, and generation-keyed for the same pooled-slot reason.
  const priorMissileTheta = new Map<Bullet, { generation: number; theta: number }>();

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
      // A state may declare a music track with no `Run` behind it — the ending
      // screen sounds `adjourn` this way, read off the stack in `main.ts`. Capture
      // it here so the entered-track check below sees it, mirroring that shell.
      const stateMusic = (state as { music?: string }).music;
      if (stateMusic !== undefined) cover.music.add(stateMusic);

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

      // Beams. A laser is a `Bullet` carrying a `LaserSpec`, so it lives in the
      // same array as every other bullet and is read here off the live field, the
      // way effects/items are. The five facts a real run must show — which skins
      // fired, that telegraph→lethal→decay all ran, and that `beam-sweep` turned a
      // lethal beam — are collected in one pass (design §e.2).
      for (const b of run.bullets.bullets) {
        // Missiles (导弹轮). A missile is a `Bullet` carrying `missile`, and — like
        // a beam — lives in the same array as every other bullet, so it is read
        // here off the live field. Two facts a real run must show: which body skins
        // fired, and that a homing missile actually TURNED (design §e.5). A missile
        // sets no `laser`, so the beam `continue` below skips it; collect it first.
        if (b.missile !== undefined) {
          cover.missileSkins.add(b.style.sprite);
          const mTheta = b.vector.theta;
          const mPrior = priorMissileTheta.get(b);
          // A missile whose heading moved since last tick while the vector
          // integrates no turn (`w === 0`) can only have been steered by the
          // `homing` behaviour — the proof it RAN. Keyed by generation so a reused
          // pool slot never counts a stale heading as a turn (the beamSwept idiom).
          if (b.vector.w === 0 && mPrior !== undefined && mPrior.generation === b.generation && mPrior.theta !== mTheta) {
            cover.missileHomed = true;
          }
          priorMissileTheta.set(b, { generation: b.generation, theta: mTheta });
        }
        if (b.laser === undefined) continue;
        cover.beamSkins.add(b.style.sprite);
        const warmup = b.laser.warmup ?? 0;
        const cooldown = b.laser.cooldown ?? 0;
        const theta = b.vector.theta;
        if (b.lethal) {
          cover.beamLethal = true;
          // A lethal beam whose heading moved since last tick while the vector is
          // integrating no turn (`w === 0`) can only have been swept by the
          // behaviour — the proof `beam-sweep` actually ran. Keyed by generation so
          // a reused pool slot never counts a stale heading as a sweep.
          const prior = priorTheta.get(b);
          if (b.vector.w === 0 && prior !== undefined && prior.generation === b.generation && prior.theta !== theta) {
            cover.beamSwept = true;
          }
        } else if (b.age < warmup) {
          cover.beamTelegraphed = true;
        } else if (b.life > 0 && b.age >= b.life - cooldown) {
          cover.beamDecaying = true;
        }
        priorTheta.set(b, { generation: b.generation, theta });
      }

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
  beamSkins: union(RUNS, (c) => c.beamSkins),
  beamTelegraphed: RUNS.some((c) => c.beamTelegraphed),
  beamLethal: RUNS.some((c) => c.beamLethal),
  beamDecaying: RUNS.some((c) => c.beamDecaying),
  beamSwept: RUNS.some((c) => c.beamSwept),
  missileSkins: union(RUNS, (c) => c.missileSkins),
  missileHomed: RUNS.some((c) => c.missileHomed),
  maxPower: Math.max(...RUNS.map((c) => c.maxPower)),
  maxOptions: Math.max(...RUNS.map((c) => c.maxOptions)),
  ticks: Math.max(...RUNS.map((c) => c.ticks)),
};

/**
 * One full Lunatic playthrough, shared.
 *
 * `RUNS` (and so `COVER`) is Normal only, so a track named by a Lunatic-only card
 * — `sentinel`'s fourth phase names `zenith` — is never entered there and could
 * not be proved reached. This one full Lunatic run reaches it, and the tier
 * describe below reuses it rather than paying for a second.
 */
const LUNATIC = playThroughGame(0, 'lunatic');

/**
 * The UI cue channel, driven the way `main.ts` reads it.
 *
 * `SHELL_CUES` are sounds the SHELL plays, not run events — a menu's transient
 * `.cue` (move/confirm/cancel), the pause enter edge, and a dialogue advance —
 * so they carry no `EVENT_SOUNDS` row and the gameplay probe above never touches
 * them. Registration is not reachability for UI sounds either: a `ui-*` sound
 * registered but reached by no menu is silent forever, exactly the failure this
 * file exists for. So this probe drives the real state stack through a
 * navigation, a cancel, a pause and a boss dialogue, reads the cue off the state
 * that *ticked* (captured before the tick, as `main.ts` does — a confirm/cancel
 * transitions that state away before the read), and returns which cues fired.
 */
function collectUiCues(): Set<string> {
  const cues = new Set<string>();
  const machine = new StateMachine();
  let seed = 1;
  const ctx: GameContext = { machine, nextSeed: () => 0x9a1 + seed++ };
  machine.push(new TitleState(ctx));

  let confirm = 0;
  let wasPaused = false;
  let cancelled = false;
  let movedTier = false;
  let paused = false;
  const dialogueIndex = new WeakMap<Run, number>();

  for (let tick = 0; tick < 60_000 && cues.size < SHELL_CUES.length; tick++) {
    const top = machine.stack[machine.stack.length - 1];
    const name = top?.name ?? '?';
    let buttons = 0;

    if (name === 'title') {
      // Confirm straight through — a single-entry menu's move sounds nothing.
      confirm ^= 1;
      buttons = confirm ? Button.Shot : 0;
    } else if (name === 'difficulty-select') {
      if (!cancelled) {
        // Back out once (ui-cancel); returns to title, then we come back here.
        confirm ^= 1;
        if (confirm) {
          buttons = Button.Bomb;
          cancelled = true;
        }
      } else if (!movedTier) {
        // A cursor move on a multi-row menu (ui-move).
        confirm ^= 1;
        if (confirm) {
          buttons = Button.Down;
          movedTier = true;
        }
      } else {
        confirm ^= 1;
        buttons = confirm ? Button.Shot : 0; // confirm the tier (ui-confirm)
      }
    } else if (name === 'character-select') {
      confirm ^= 1;
      buttons = confirm ? Button.Shot : 0;
    } else if (name === 'pause') {
      confirm ^= 1;
      buttons = confirm ? Button.Start : 0; // resume (intercept pops)
    } else if (name === 'playing') {
      const run = (top as { run?: Run }).run;
      if (run !== undefined && run.dialogue !== undefined) {
        confirm ^= 1;
        buttons = confirm ? Button.Shot : 0; // advance a line (ui-advance)
      } else if (!paused) {
        confirm ^= 1;
        if (confirm) {
          buttons = Button.Start; // open the pause menu once (ui-pause)
          paused = true;
        }
      } else {
        // Fly on so the boss and its dialogue come due.
        buttons = Button.Shot | (Math.floor(tick / 60) % 2 === 0 ? Button.Left : Button.Right);
      }
    } else {
      confirm ^= 1;
      buttons = confirm ? Button.Shot : 0;
    }

    const acted = machine.stack[machine.stack.length - 1] as { cue?: string } | undefined;
    machine.tick(buttons);
    if (acted?.cue !== undefined) cues.add(acted.cue);

    const nowPaused = machine.stack[machine.stack.length - 1]?.name === 'pause';
    if (nowPaused && !wasPaused) cues.add('ui-pause');
    wasPaused = nowPaused;

    for (const state of machine.stack) {
      const run = (state as { run?: Run }).run;
      if (run === undefined) continue;
      // Immortal, so the run survives to the boss dialogue (see MORTAL_TICKS note).
      if (run.player.lives < 3) run.player.lives = 3;
      run.player.alive = true;
      run.player.invuln = 999;
      const line = run.dialogue?.index;
      const last = dialogueIndex.get(run);
      if (line !== undefined && (last === undefined || line > last)) {
        if (last !== undefined) cues.add('ui-advance');
        dialogueIndex.set(run, line);
      }
    }
  }
  return cues;
}

/** The UI cues a real menu+dialogue+pause run actually played. */
const UI_CUES = collectUiCues();

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
    // shaders is `v4/backgrounds/index.test.ts`'s job, and it imports both
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
    // Union the Lunatic run with the Normal `COVER`, mirroring the music arm
    // below: the two 出神 scenes (`umbra` on sentinel's Total Eclipse, `decree`
    // on the chancellor's Sealed and the regent's Sine Die) are declared ONLY on
    // Lunatic-gated cards, so a Normal playthrough never enters them — exactly as
    // `zenith`/`fiat` sit on Lunatic-only cards for music. The five seals are all
    // Normal-reachable via each boss's non-Lunatic cards.
    const entered = new Set<string>([...COVER.scenes, ...LUNATIC.scenes]);
    expect([...entered].sort()).toEqual([...declared].sort());
  });

  test('every registered track a stage, a boss, a card, or the menu declares', () => {
    // Music is wired like scenes (declared per stage and boss), not like sounds
    // (cued per event), so this mirrors the scene test above — with two seams.
    //
    // First, the menu. `run.music` never yields the menu theme (a run is a stage
    // or a boss, never the title), so the shell supplies `MENU_MUSIC` as the
    // fallback and the menu is what "reaches" it — hence it joins `declared`
    // here but is excluded from the entered-check below.
    //
    // Second, a track is boss-level (`BossSpec.music`, held across a fight) but a
    // single spell card may override it for its duration (`SpellCard.music`),
    // exactly as a card may override the scene — so unlike an earlier version this
    // loops the phases too, the way the scene test does. All are the same
    // string-across-a-boundary — `musicNames` is audio-side, reachable from
    // `src/game`, while the sim never learns a track exists.
    // `adjourn` is the ending track, declared at the shell level exactly as
    // `MENU_MUSIC` is: no stage, boss or card names it — `EndingScreenState`
    // sounds it (read off the stack in `main.ts`), and the ending is what reaches
    // it. Unlike `MENU_MUSIC` it *is* entered by a real run (the probe clears the
    // final stage and pages the ending), so it is not excepted from the check below.
    const declared = new Set<string>([MENU_MUSIC, 'adjourn']);
    for (const stage of content(stageNames())) {
      const track = getStage(stage).music;
      if (track !== undefined) declared.add(track);
    }
    for (const boss of content(bossNames())) {
      const spec = getBossSpec(boss);
      if (spec.music !== undefined) declared.add(spec.music);
      for (const phase of spec.phases) {
        if (phase.music !== undefined) declared.add(phase.music);
      }
    }

    // No dead track: every registered track is named by a stage, a boss, a card,
    // or the menu, and every name declared is registered.
    expect(content(musicNames()).sort()).toEqual([...declared].sort());

    // And every declared track is actually entered by a real playthrough — the
    // menu excepted (no run reports it). A card-level track can sit on a
    // Lunatic-only card (`zenith` does), unreachable on Normal, so the entered set
    // unions the Lunatic run with the Normal `COVER`.
    const entered = new Set<string>([...COVER.music, ...LUNATIC.music]);
    for (const track of [...declared].filter((n) => n !== MENU_MUSIC)) {
      expect(`${track} entered: ${entered.has(track)}`).toBe(`${track} entered: true`);
    }
  });

  test('every registered item kind', () => {
    // The failure: four of five kinds spawned only from a boss defeat, which
    // never happened, and `life` had no spawn site at all.
    //
    // This equality self-extends: the pickup-variety round registers eight
    // score-TIER names (silver `score`, `coin.gold`, five `gem.*`, `bar.gold`), and
    // both sides of this `toEqual` must grow by them together — a registered tier
    // that nothing drops fails here, a dropped name that nothing registers throws in
    // the pack injector before this. The per-name test below names WHICH rung, so a
    // single missing gem reads as itself rather than as a sorted-array mismatch.
    expect([...COVER.items].sort()).toEqual(content(itemNames()).sort());
  });

  test('the pickup tier ladder is reachable — every rung, on its boss', () => {
    // The redenomination places each tier on a specific enemy, and colour is boss
    // identity: a full playthrough defeats every boss, so every rung reaches the
    // field. `bar.gold` is the jackpot the regent alone drops — the reachability
    // trap the design flagged (converting ALL `score` would strand the retained
    // silver chip) is avoided by keeping `score` on two trash carriers AND regent.
    const LADDER: readonly [name: string, source: string][] = [
      ['score', 'two trash carriers + regent (silver chip)'],
      ['coin.gold', 'magistrate'],
      ['gem.green', 'sentinel'],
      ['gem.yellow', 'warden'],
      ['gem.cyan', 'magistrate'],
      ['gem.pink', 'chancellor'],
      ['gem.purple', 'regent'],
      ['bar.gold', 'regent (jackpot)'],
    ];
    const reached = new Set<string>([...COVER.items, ...LUNATIC.items]);
    for (const [name, source] of LADDER) {
      expect(`${name} (from ${source}) reached: ${reached.has(name)}`)
        .toBe(`${name} (from ${source}) reached: true`);
    }
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

  test('every registered laser body skin, fired by reachable content', () => {
    // The reachability half of "all 11 laser files consumed": every registered
    // skin (`render/laser-skin.ts`) is put on the field by a real playthrough —
    // `LANCE`→beam.v3, the three `COLUMN` boss variants, `RAY_BEAM`→beam.slim,
    // the `chancellor` card's three stream/warm beams, and the player's
    // `GUN_BEAM`→beam.cyan. A skin nothing fires is dead presentation, the exact
    // failure this file exists for. Caps are render-only and proven by
    // `render/laser-skin.test.ts`, not here (design §d). Unioned with the Lunatic
    // run so a skin fired only on a gated card would still count.
    const fired = new Set<string>([...COVER.beamSkins, ...LUNATIC.beamSkins]);
    for (const skin of laserSkinNames()) {
      expect(`${skin} fired: ${fired.has(skin)}`).toBe(`${skin} fired: true`);
    }
  });

  test('the beam lifecycle — telegraph, lethal and decay all run in a real fight', () => {
    // The mandate's "fire, telegraph, hit-test", plus the decay phase the laser
    // round added: a beam is harmless while warming, kills once lethal, and turns
    // harmless again before it visually retracts. All three observed off live
    // beams, unioned with the Lunatic run.
    const telegraphed = COVER.beamTelegraphed || LUNATIC.beamTelegraphed;
    const lethal = COVER.beamLethal || LUNATIC.beamLethal;
    const decaying = COVER.beamDecaying || LUNATIC.beamDecaying;
    expect(`telegraphed=${telegraphed} lethal=${lethal} decaying=${decaying}`).toBe(
      'telegraphed=true lethal=true decaying=true',
    );
  });

  test('beam-sweep turned a lethal beam — the new verb ran, not merely registered', () => {
    // Registration proves `beam-sweep` resolves; this proves a real fight swept a
    // beam with it (a lethal laser whose theta moved while `w === 0`). `ray` fires
    // it as stage-3 trash and `chancellor`'s 'Sweeping Assay' card fires it too, so
    // it is reached robustly, not only at a deep boss card (design §b.5).
    const swept = COVER.beamSwept || LUNATIC.beamSwept;
    expect(`beam-sweep ran: ${swept}`).toBe('beam-sweep ran: true');
  });

  test('every registered missile body skin, fired by reachable content', () => {
    // The reachability half of "all 13 missile bodies consumed" (导弹轮 design §d):
    // every body in `MISSILE_STRIP_CELLS` is put on the field by a real
    // playthrough — the stage-1 tutorial `CITATION`→missile.0, weaver's `NOTICE`,
    // the stage-2/3/4 trash writs, and the four bosses' `MANDAMUS`/`JUDGMENT`/
    // `DOCKET`/`EDICT`. A body nothing fires is dead presentation, the exact
    // failure this file exists for. Unioned with the Lunatic run so a body fired
    // only on a gated card would still count (mirrors the laser-skin gate).
    const fired = new Set<string>([...COVER.missileSkins, ...LUNATIC.missileSkins]);
    for (const skin of MISSILE_STRIP_CELLS) {
      expect(`${skin} fired: ${fired.has(skin)}`).toBe(`${skin} fired: true`);
    }
  });

  test('homing turned a missile — the seek loop ran in a real fight, not merely registered', () => {
    // Registration proves the `homing` behaviour resolves; this proves a real
    // fight steered a missile with it (a missile whose theta moved while `w === 0`).
    // The dumbfire writs (`SERVICE`, `DISTRAINT`) never trigger it, so this is a
    // positive proof homing missiles specifically reach the field and curve — the
    // missile analogue of the beam-sweep assertion above (design §e.5).
    const homed = COVER.missileHomed || LUNATIC.missileHomed;
    expect(`missile homing ran: ${homed}`).toBe('missile homing ran: true');
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
    // `ending` joins the set: clearing a stage that declares no `next` raises
    // `EndingScreenState` before the ALL CLEAR results card. `cleared` stays —
    // non-final stage clears reach it directly, and the ending replaces itself
    // with it on the last page, so both are touched by a full playthrough.
    expect([...COVER.states].sort()).toEqual(
      ['character-select', 'cleared', 'difficulty-select', 'ending', 'playing', 'title'].sort(),
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
    //
    // Two cue tables now, not one: `EVENT_SOUNDS` (a run event → a sound) and
    // `SHELL_CUES` (the UI channel the shell plays with no run event behind it —
    // menu move/confirm/cancel, pause, dialogue advance). Both are unioned here,
    // because both name registered sounds and the equality closes over the whole
    // registry — a `ui-*` sound outside `SHELL_CUES` would be an unplayed asset
    // exactly as a stranded gameplay sound is.
    const cued = new Set([...Object.values(EVENT_SOUNDS), ...SHELL_CUES]);
    for (const name of cued) {
      expect(`${name} is registered: ${soundNames().includes(name)}`).toBe(
        `${name} is registered: true`,
      );
    }
    expect([...cued].sort()).toEqual(content(soundNames()).sort());

    // And every registered sound is reachable through an event this probe
    // actually raised — or, for the UI channel, a cue the menu/dialogue probe
    // actually played (`UI_CUES`). Not "every cue-event is raised": `failed`
    // (game over) cues `death`, and this pilot is immortal by construction, so
    // that row never fires — but `death` is still heard, because `player-death`
    // cues it too. The claim that matters is that no sound is stranded behind
    // only unreachable cues, and it is asserted per sound.
    const reachableSounds = new Set([
      ...(Object.entries(EVENT_SOUNDS) as [RunEventType, string][])
        .filter(([type]) => COVER.events.has(type))
        .map(([, sound]) => sound),
      ...UI_CUES,
    ]);
    for (const name of content(soundNames())) {
      expect(`${name} reachable: ${reachableSounds.has(name)}`).toBe(
        `${name} reachable: true`,
      );
    }
  });

  test('every UI cue is played by a real menu/pause/dialogue run', () => {
    // The §0 crux, asserted directly: registration is not reachability for the
    // UI channel either. The probe drove the state stack through a navigation, a
    // cancel, a pause and a boss dialogue; every `SHELL_CUES` name must have
    // sounded, or it is a registered-but-silent asset.
    for (const name of SHELL_CUES) {
      expect(`${name} played: ${UI_CUES.has(name)}`).toBe(`${name} played: true`);
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

describe('the base pack couples its swept beams honestly', () => {
  // Not a playthrough — a scan of the base-pack DATA, pinning the two couplings
  // `beam-sweep` depends on the way `balance.test.ts` measures the damage model
  // from real content rather than trusting a typed constant (design graft #6):
  //
  //  - `options.hold === laser.warmup`. The sweep begins at `vector.age === hold`
  //    and the beam turns lethal at `b.age === warmup`; for a single-segment beam
  //    the two clocks advance together, so `hold !== warmup` would sweep before it
  //    can kill or kill before it sweeps — a silent, drift-prone seam.
  //  - `motion.w === 0`. A nonzero `w` integrates from tick 0 and would sweep the
  //    beam DURING its own telegraph, the exact thing `beam-sweep` exists to avoid.
  //
  // Every `beam-sweep` spec the campaign ships is found by a generic tree walk, so
  // a sweep authored on any future enemy, boss card, shot or option is caught
  // without this test being touched.
  const sweeps = collectBeamSweeps(basePack);

  test('the scan actually found the base pack’s swept beams', () => {
    // `ray`'s RAY_BEAM and `chancellor`'s RAKE, at least — a vacuous scan (a
    // renamed behaviour, a moved spec) would pass the loop below on nothing.
    expect(sweeps.length).toBeGreaterThanOrEqual(2);
  });

  test('every beam-sweep spec sets hold == warmup', () => {
    for (const s of sweeps) {
      expect(`${s.where}: hold=${s.hold} warmup=${s.warmup}`).toBe(
        `${s.where}: hold=${s.warmup} warmup=${s.warmup}`,
      );
    }
  });

  test('every beam-sweep spec sets w == 0', () => {
    for (const s of sweeps) {
      expect(`${s.where}: w=${s.w}`).toBe(`${s.where}: w=0`);
    }
  });
});

describe('the base pack couples its homing missiles honestly (G3)', () => {
  // The missile analogue of the beam-sweep couplings above, and the same kind of
  // data scan: a homing missile whose `life` runs out before its seek window
  // (`delay + duration`) closes has authored tracking that never runs — dead
  // authoring, silent. `life > delay + duration` is the invariant, the missile
  // mirror of `beam-sweep`'s `hold === warmup`. A generic tree walk, so a missile
  // authored on any future enemy, boss card, shot or option is caught here with
  // no change.
  //
  // The scan LOGIC is proved first on constructed specs — the base campaign fires
  // no missiles yet this round (the 导弹轮 engine landed before its content), so
  // the base-pack walk below passes on zero today and becomes a live tripwire the
  // moment the content stage authors a homing missile.
  test('the scan flags a missile whose life ends before its seek window closes', () => {
    const dishonest = {
      spec: {
        missile: { explosion: 'x' },
        life: 30, // <= delay 10 + duration 40 = 50
        motion: { behaviour: 'homing', options: { delay: 10, duration: 40 } },
      },
    };
    const found = collectMissiles(dishonest, 'fixture');
    expect(found).toHaveLength(1);
    expect(found[0]!.life).toBeLessThanOrEqual(found[0]!.delay + found[0]!.duration);
  });

  test('the scan passes a missile whose life outlives its seek window', () => {
    const honest = {
      spec: {
        missile: { explosion: 'x' },
        life: 200, // > delay 16 + duration 70
        motion: { behaviour: 'homing', options: { delay: 16, duration: 70 } },
      },
    };
    const found = collectMissiles(honest, 'fixture');
    expect(found).toHaveLength(1);
    expect(found[0]!.life).toBeGreaterThan(found[0]!.delay + found[0]!.duration);
  });

  test('the scan reads the homing defaults when options omit delay and duration', () => {
    const found = collectMissiles({
      spec: { missile: { explosion: 'x' }, life: 100, motion: { behaviour: 'homing' } },
    });
    expect(found).toHaveLength(1);
    expect(found[0]!.delay).toBe(0);
    expect(found[0]!.duration).toBe(60); // the `homing` default (v4/gameplay/behaviours.ts)
  });

  test('a dumbfire missile (no homing behaviour) is not scanned — it has no window', () => {
    const found = collectMissiles({
      spec: { missile: { explosion: 'x' }, life: 20, motion: { r: 3, theta: 90 } },
    });
    expect(found).toHaveLength(0);
  });

  test('every homing missile the base pack ships outlives its seek window', () => {
    // The standing guard. Zero missiles this round, so it walks to nothing today;
    // when the content stage authors homing missiles it begins to bite, exactly
    // as the beam-sweep coupling does. The coupling itself is proved on the
    // fixtures above, so this is not its only witness.
    for (const m of collectMissiles(basePack)) {
      expect({
        where: m.where,
        life: m.life,
        window: m.delay + m.duration,
        outlivesWindow: m.life > m.delay + m.duration,
      }).toEqual({ where: m.where, life: m.life, window: m.delay + m.duration, outlivesWindow: true });
    }
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
  // The full Lunatic run is `LUNATIC` at module scope — shared with the music
  // assertion above, which needs it to reach the Lunatic-only card's track.
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

  test("chancellor's Lunatic-only card, and its track, are reached only on Lunatic", () => {
    // The stage-3 boss's fifth phase, `Fiat "Sealed"`, is `difficulties:
    // ['lunatic']` and the second per-card track in the game (`music: 'fiat'`).
    // Same proof as sentinel's above, one stage deeper: Normal must never touch
    // the card, the real Lunatic playthrough must fight it, and only the Lunatic
    // run can enter its track. Proved by fighting it, not asserted from the spec.
    const spec = getBossSpec('chancellor');
    const gatedIndex = activePhaseIndices(spec.phases, DEFAULT_DIFFICULTY).length;
    const gated = `chancellor#${gatedIndex}`;
    expect(`normal has ${gated}: ${COVER.phases.has(gated)}`).toBe(`normal has ${gated}: false`);
    expect(`lunatic has ${gated}: ${LUNATIC.phases.has(gated)}`).toBe(`lunatic has ${gated}: true`);
    expect(`normal entered fiat: ${COVER.music.has('fiat')}`).toBe('normal entered fiat: false');
    expect(`lunatic entered fiat: ${LUNATIC.music.has('fiat')}`).toBe('lunatic entered fiat: true');
  });

  test("regent's Lunatic-only card is reached only on Lunatic", () => {
    // The stage-4 boss's sixth phase, `Last Fiat "Sine Die"`, is `difficulties:
    // ['lunatic']` — the campaign's terminal card. Same proof as sentinel's and
    // chancellor's, at the source: Normal must never touch it, the real Lunatic
    // playthrough must fight it. It reuses `fiat` (proved entered above via the
    // chancellor) and drains to `vault` (the stage's own scene), so it declares no
    // new track or scene — only this phase needs proving reached, and only on tier.
    const spec = getBossSpec('regent');
    const gatedIndex = activePhaseIndices(spec.phases, DEFAULT_DIFFICULTY).length;
    const gated = `regent#${gatedIndex}`;
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

/** One base-pack bullet spec that steers with `beam-sweep`, and its couplings. */
interface BeamSweep {
  where: string;
  hold: unknown;
  warmup: unknown;
  w: unknown;
}

/**
 * Every object in the base-pack tree whose `motion.behaviour` is `beam-sweep`,
 * with the two coupled values pulled out (`options.hold`/`laser.warmup` and
 * `motion.w`). A generic walk over the raw JSON, so a sweep authored on any
 * enemy, boss card, shot or option in future is caught with no change here.
 */
function collectBeamSweeps(node: unknown, path = 'base-pack'): BeamSweep[] {
  const out: BeamSweep[] = [];
  if (Array.isArray(node)) {
    node.forEach((v, i) => out.push(...collectBeamSweeps(v, `${path}[${i}]`)));
    return out;
  }
  if (node !== null && typeof node === 'object') {
    const rec = node as Record<string, unknown>;
    const motion = rec.motion as Record<string, unknown> | undefined;
    if (motion !== undefined && motion.behaviour === 'beam-sweep') {
      const options = (motion.options ?? {}) as Record<string, unknown>;
      const laser = (rec.laser ?? {}) as Record<string, unknown>;
      out.push({ where: path, hold: options.hold, warmup: laser.warmup, w: motion.w });
    }
    for (const [k, v] of Object.entries(rec)) out.push(...collectBeamSweeps(v, `${path}.${k}`));
    return out;
  }
  return out;
}

/** One base-pack homing missile, with the numbers its `life > delay+duration` coupling reads. */
interface HomingMissile {
  where: string;
  life: number;
  delay: number;
  duration: number;
}

/**
 * Every object in the base-pack tree that is a homing missile with a finite
 * `life`: `missile` present, `motion.behaviour === 'homing'`, and a numeric
 * `life`. The `collectBeamSweeps` idiom, so a missile authored on any enemy, boss
 * card, shot or option in future is caught with no change here.
 *
 * `delay`/`duration` fall back to the `homing` behaviour's own defaults (0 and
 * 60, `v4/gameplay/behaviours.ts`), so a missile that omits them still has a real
 * seek window to be measured against.
 */
function collectMissiles(node: unknown, path = 'base-pack'): HomingMissile[] {
  const out: HomingMissile[] = [];
  if (Array.isArray(node)) {
    node.forEach((v, i) => out.push(...collectMissiles(v, `${path}[${i}]`)));
    return out;
  }
  if (node !== null && typeof node === 'object') {
    const rec = node as Record<string, unknown>;
    const motion = rec.motion as Record<string, unknown> | undefined;
    if (
      rec.missile !== undefined &&
      motion !== undefined &&
      motion.behaviour === 'homing' &&
      typeof rec.life === 'number'
    ) {
      const options = (motion.options ?? {}) as Record<string, number>;
      out.push({
        where: path,
        life: rec.life,
        delay: options.delay ?? 0,
        duration: options.duration ?? 60,
      });
    }
    for (const [k, v] of Object.entries(rec)) out.push(...collectMissiles(v, `${path}.${k}`));
    return out;
  }
  return out;
}
