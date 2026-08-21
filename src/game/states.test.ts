import { describe, expect, test } from 'bun:test';

import { Button } from '../core/input';
import { defineBomb } from '../sim/bomb';
import { defineOptions } from '../sim/option';
import type { Replay } from '../sim/replay';
import { createReplaySession, type ReplaySession } from '../replay/session';
import { defineStage } from '../content/stage';
import '../content/patterns';
import { defineEnemy } from '../sim/enemy';
import { Edges, type GameState, StateMachine, type StateView } from './state';
import {
  characterNames,
  defineCharacter,
  getCharacter,
  Run,
  type PlayerCarry,
} from './run';
import { DEFAULT_DIFFICULTY, DIFFICULTIES } from '../sim/difficulty';
import {
  CharacterSelectState,
  ClearedState,
  DifficultySelectState,
  EndingScreenState,
  GameOverState,
  type CampaignEndings,
  type GameContext,
  PauseState,
  PlayingState,
  preflightReplaySession,
  ReplayExportState,
  type ReplayEndReason,
  ReplayDeleteConfirmState,
  ReplayLibraryState,
  ReplayPlayingState,
  ReplayStageState,
  ReplayStagesState,
  replayExportPresentationAdvances,
  replayRunConfig,
  REPLAY_EXPORT_TAIL_TICKS,
  REPLAY_SESSION_ENDING_PAGE_TICKS,
  REPLAY_SESSION_EXPORT_TARGET,
  REPLAY_SESSION_RESULT_HOLD_TICKS,
  REPLAY_SESSION_STAGE_HOLD_TICKS,
  ReplaySessionState,
  TitleState,
} from './states';

/**
 * Local player weapons. The shipped roster and its shots/options/bombs moved into
 * the bundled base pack (decisions-round2 §D), which a `src/game` test may not
 * import — so this file registers its own, `test.`-prefixed so the reachability
 * and balance scans skip them, and reused by both pilots below because this file
 * tests the SELECT/replay-identity WIRE, not weapon content.
 */
const PILOT_OPTIONS = 'test.states-options';
defineOptions(PILOT_OPTIONS, {
  sprite: 'orb.medium',
  shot: { style: { sprite: 'orb.small' }, radius: 4, motion: { r: 11, theta: 270 }, damage: 1 },
  period: 5,
  levels: [[], [{ x: -20, y: 0, focusX: -8, focusY: -10, angle: 270 }, { x: 20, y: 0, focusX: 8, focusY: -10, angle: 270 }]],
});
const PILOT_BOMB = 'test.states-bomb';
defineBomb(PILOT_BOMB, { duration: 90, invulnTicks: 150, damagePerTick: 2, convertBullets: true, effect: 'death.big' });
const PILOT_SHOTS = [
  { spec: { style: { sprite: 'glow.small' }, radius: 4, motion: { r: 9, theta: 270 }, damage: 1 }, offsets: [{ x: 0, y: -10, angle: 270 }], period: 5 },
];

/**
 * A bare built-in-style pilot — registered FIRST, so it takes SELECT row 0 the
 * way the shipped roster used to (the "row 0 is a built-in" case below relies on
 * it). It stands in for `scout` everywhere this file names one.
 */
const PILOT = 'test-pilot';
defineCharacter(PILOT, {
  label: 'PILOT',
  sprite: 'ship',
  options: PILOT_OPTIONS,
  bomb: PILOT_BOMB,
  player: {
    x: 240, y: 560, speed: 3.6, focusSpeed: 1.5, radius: 2.5,
    grazeRadius: 20, lives: 3, bombs: 3, invulnTicks: 90, shots: PILOT_SHOTS,
  },
});

/**
 * A pack character, registered namespaced (and LAST) so the reachability and
 * balance scans (both filter '/') leave it alone and it is reachable only by
 * being offered on SELECT — exactly how the real injector registers one. What
 * matters is that its qualified name and owning-pack identity flow into
 * `RunConfig.packsData` off the plain START row.
 */
const PACK_CHARACTER = 'demo/raider';
const PACK_DATA = 'demo@abcdef012345';
defineCharacter(PACK_CHARACTER, {
  label: 'RAIDER',
  sprite: 'ship',
  options: PILOT_OPTIONS,
  bomb: PILOT_BOMB,
  player: {
    x: 240, y: 560, speed: 3.6, focusSpeed: 1.5, radius: 2.5,
    grazeRadius: 20, lives: 3, bombs: 3, invulnTicks: 90, shots: PILOT_SHOTS,
  },
});

/**
 * Two synthetic stages for the ending fork, `test-`-prefixed so the reachability
 * and background scans skip them. Both are empty — no waves, no boss — so a run on
 * either clears within a tick or two without a pilot needing to survive anything,
 * which is what makes the ending branch testable deterministically rather than by
 * driving a whole real stage to its end. `FINAL_STAGE` declares no `next` (the last
 * stage of a campaign, `null` on the real one); `PENULTIMATE_STAGE` declares one, so
 * clearing it is a stage clear rather than the game's end.
 */
const FINAL_STAGE = 'test-ending-final';
defineStage(FINAL_STAGE, { name: FINAL_STAGE, waves: [] });
const UNAUTHORED_FINAL_STAGE = 'test-ending-unowned';
defineStage(UNAUTHORED_FINAL_STAGE, { name: UNAUTHORED_FINAL_STAGE, waves: [] });
const PENULTIMATE_STAGE = 'test-ending-penultimate';
defineStage(PENULTIMATE_STAGE, { name: PENULTIMATE_STAGE, waves: [], next: FINAL_STAGE });
const REPLAY_STAGE = 'test-replay-stage';
defineStage(REPLAY_STAGE, { name: REPLAY_STAGE, waves: [], outro: 18 });
const FAILED_REPLAY_ENEMY = 'test-states-failed-replay-enemy';
defineEnemy(FAILED_REPLAY_ENEMY, {
  sprite: 'orb.large',
  hp: 1_000_000,
  radius: 8,
  motion: { r: 0, theta: 90 },
  patterns: [{
    pattern: 'aimed-fan',
    startAt: 0,
    options: {
      spec: {
        style: { sprite: 'orb.small' },
        radius: 4,
        motion: { r: 0, theta: 90 },
      },
      count: 1,
      spread: 0,
      period: 1,
    },
  }],
});
const FAILED_REPLAY_STAGE = 'test-states-failed-replay-stage';
defineStage(FAILED_REPLAY_STAGE, {
  name: FAILED_REPLAY_STAGE,
  waves: [{ at: 0, enemy: FAILED_REPLAY_ENEMY, x: 240, y: 560 }],
  outro: 600,
});
const RECORDING_FINAL_STAGE = 'test-recording-final';
defineStage(RECORDING_FINAL_STAGE, {
  name: RECORDING_FINAL_STAGE,
  waves: [],
  outro: 18,
});
const RECORDING_PENULTIMATE_STAGE = 'test-recording-penultimate';
defineStage(RECORDING_PENULTIMATE_STAGE, {
  name: RECORDING_PENULTIMATE_STAGE,
  waves: [],
  next: RECORDING_FINAL_STAGE,
});
/**
 * The ordinary playing-state fixture.
 *
 * `Run` deliberately defaults to the edition-owned `stage-1`, but this unit
 * test does not import an edition composition root. Relying on another test to
 * inject v4 made this file pass in the full suite and fail on its own. A long,
 * empty local stage keeps pause/retry tests in flight, while the ending tests
 * explicitly choose whether to fail or let its outro clear.
 */
const PLAY_STAGE = 'test-states-playing';
defineStage(PLAY_STAGE, {
  name: PLAY_STAGE,
  waves: [],
  outro: 600,
  next: FINAL_STAGE,
});

/** Generic ending fixture: deliberately no v4 words or presentation names. */
const TEST_CAMPAIGN_ENDINGS = {
  [FINAL_STAGE]: {
    music: 'test-ending-music',
    scene: 'test-ending-scene',
    pages: [
      { lines: ['test opening one', 'test opening two'] },
      {
        lines: ['test fallback coda'],
        linesFor: {
          [PILOT]: ['test pilot coda'],
        },
      },
      { lines: ['test closing one', '', 'test closing two'] },
    ],
  },
} as const satisfies CampaignEndings;

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

/** Records what it was asked to do, so a test can assert on order. */
class Spy implements GameState {
  readonly log: string[];
  ticks = 0;
  renders = 0;

  constructor(
    readonly name: string,
    log: string[],
    readonly transparent = false,
  ) {
    this.log = log;
  }

  enter(previous?: GameState): void {
    this.log.push(`${this.name}:enter(${previous?.name ?? '-'})`);
  }

  exit(): void {
    this.log.push(`${this.name}:exit`);
  }

  tick(): void {
    this.ticks++;
    this.log.push(`${this.name}:tick`);
  }

  render(): void {
    this.renders++;
    this.log.push(`${this.name}:render`);
  }

  view(): StateView {
    return { kind: this.name };
  }
}

function context(overrides: Partial<GameContext> = {}): GameContext {
  const machine = new StateMachine();
  return {
    machine,
    // Constant, so a test that retries twice gets the same run both times and
    // any difference it sees is a real one rather than a new seed.
    nextSeed: () => 0x5747a1,
    campaignEndings: TEST_CAMPAIGN_ENDINGS,
    stage: PLAY_STAGE,
    ...overrides,
  };
}

/**
 * Push a state and give it one idle tick.
 *
 * The idle tick is not padding. A state suppresses edges on its very first
 * update, so that a state pushed on the tick a button went down cannot read
 * that press as its own — which is how the real game always pushes them, from
 * inside a tick where something was held. A test that pushes from outside a
 * tick has to hand the state that first update itself, or its opening press
 * lands during the suppressed one and vanishes.
 */
function open(machine: StateMachine, state: GameState): void {
  machine.push(state);
  machine.tick(0);
}

/**
 * One press tick, and nothing after it.
 *
 * Any transition it causes has been applied by the time this returns, and the
 * state it pushed has *not* ticked yet — which is what lets a test check that a
 * run starts at tick zero.
 */
function press(machine: StateMachine, button: number): void {
  machine.tick(button);
}

/**
 * Press and release.
 *
 * Menus act on press edges, so a test that simply held a button would move the
 * cursor once and then sit there. The release tick also arms whatever the press
 * pushed, so this is the right helper whenever a test keeps driving afterwards.
 */
function tap(machine: StateMachine, button: number, times = 1): void {
  for (let i = 0; i < times; i++) {
    machine.tick(button);
    machine.tick(0);
  }
}

/* ------------------------------------------------------------------ */
/* The machine                                                         */
/* ------------------------------------------------------------------ */

describe('StateMachine', () => {
  test('an empty machine ticks and renders without complaint', () => {
    const machine = new StateMachine();
    expect(machine.current).toBeUndefined();
    expect(machine.depth).toBe(0);
    machine.tick(0);
    machine.render(0);
  });

  test('push enters with the state it was pushed over', () => {
    const log: string[] = [];
    const machine = new StateMachine();
    machine.push(new Spy('a', log));
    machine.push(new Spy('b', log));
    expect(log).toEqual(['a:enter(-)', 'b:enter(a)']);
    expect(machine.current?.name).toBe('b');
    expect(machine.depth).toBe(2);
  });

  test('pop exits and reveals what was beneath', () => {
    const log: string[] = [];
    const machine = new StateMachine();
    machine.push(new Spy('a', log));
    machine.push(new Spy('b', log));
    machine.pop();
    expect(log.at(-1)).toBe('b:exit');
    expect(machine.current?.name).toBe('a');
  });

  test('replace swaps the top and hands over the state it displaced', () => {
    const log: string[] = [];
    const machine = new StateMachine();
    machine.push(new Spy('a', log));
    machine.replace(new Spy('b', log));
    expect(log).toEqual(['a:enter(-)', 'a:exit', 'b:enter(a)']);
    expect(machine.depth).toBe(1);
  });

  test('clear exits everything, top down', () => {
    const log: string[] = [];
    const machine = new StateMachine();
    machine.push(new Spy('a', log));
    machine.push(new Spy('b', log));
    log.length = 0;
    machine.clear();
    expect(log).toEqual(['b:exit', 'a:exit']);
    expect(machine.depth).toBe(0);
  });

  test('only the top state ticks when it is opaque', () => {
    const log: string[] = [];
    const machine = new StateMachine();
    const under = new Spy('under', log);
    machine.push(under);
    machine.push(new Spy('over', log));
    log.length = 0;

    machine.tick(0);
    expect(log).toEqual(['over:tick']);
    expect(under.ticks).toBe(0);
  });

  test('a transparent state lets the one beneath keep ticking', () => {
    const log: string[] = [];
    const machine = new StateMachine();
    machine.push(new Spy('under', log));
    machine.push(new Spy('over', log, true));
    log.length = 0;

    machine.tick(0);
    // Bottom-up: the world advances before the overlay above it reads anything.
    expect(log).toEqual(['under:tick', 'over:tick']);
  });

  test('transparency stacks all the way down', () => {
    const log: string[] = [];
    const machine = new StateMachine();
    machine.push(new Spy('a', log));
    machine.push(new Spy('b', log, true));
    machine.push(new Spy('c', log, true));
    log.length = 0;

    machine.tick(0);
    expect(log).toEqual(['a:tick', 'b:tick', 'c:tick']);
  });

  test('an opaque state stops the walk even under a transparent one', () => {
    const log: string[] = [];
    const machine = new StateMachine();
    machine.push(new Spy('a', log));
    machine.push(new Spy('b', log));
    machine.push(new Spy('c', log, true));
    log.length = 0;

    machine.tick(0);
    expect(log).toEqual(['b:tick', 'c:tick']);
  });

  test('render walks the whole stack regardless of transparency', () => {
    // The two axes are separate on purpose: a pause menu must freeze the field
    // and still show it. See the header of state.ts.
    const log: string[] = [];
    const machine = new StateMachine();
    machine.push(new Spy('a', log));
    machine.push(new Spy('b', log));
    log.length = 0;

    machine.render(0.5);
    expect(log).toEqual(['a:render', 'b:render']);
  });

  test('a transition raised during a tick is applied after the walk', () => {
    const log: string[] = [];
    const machine = new StateMachine();

    const under = new Spy('under', log);
    const over: GameState = {
      name: 'over',
      transparent: true,
      tick() {
        log.push('over:tick');
        machine.pop();
      },
    };
    machine.push(under);
    machine.push(over);
    log.length = 0;

    machine.tick(0);
    // The pop lands after both states have ticked. Applied immediately it would
    // mutate the array mid-walk and `under` would tick twice or not at all.
    expect(log).toEqual(['under:tick', 'over:tick']);
    expect(machine.depth).toBe(1);
    expect(machine.current?.name).toBe('under');
  });

  test('queued transitions apply in the order they were requested', () => {
    const log: string[] = [];
    const machine = new StateMachine();
    const replacement = new Spy('fresh', log);

    const top: GameState = {
      name: 'top',
      tick() {
        machine.pop();
        machine.replace(replacement);
      },
    };
    machine.push(new Spy('base', log));
    machine.push(top);
    log.length = 0;

    machine.tick(0);
    // pop removes `top`, then replace swaps `base`. Reversed, the replacement
    // would land on `top` and `base` would be stranded underneath.
    expect(machine.depth).toBe(1);
    expect(machine.current).toBe(replacement);
  });

  test('a transition raised from enter takes effect immediately', () => {
    const machine = new StateMachine();
    const target = new Spy('target', []);
    const redirect: GameState = {
      name: 'redirect',
      enter() {
        machine.replace(target);
      },
      tick() {},
    };
    machine.push(redirect);
    expect(machine.current).toBe(target);
  });

  test('views are bottom-up and skip states that describe nothing', () => {
    const machine = new StateMachine();
    machine.push(new Spy('a', []));
    machine.push({ name: 'silent', tick() {} });
    machine.push(new Spy('b', []));
    expect(machine.views().map((v) => v.kind)).toEqual(['a', 'b']);
  });
});

/* ------------------------------------------------------------------ */
/* Edges                                                               */
/* ------------------------------------------------------------------ */

describe('Edges', () => {
  test('a press is reported once, not for as long as it is held', () => {
    const edges = new Edges();
    edges.update(0);
    edges.update(Button.Shot);
    expect(edges.pressed(Button.Shot)).toBe(true);
    edges.update(Button.Shot);
    expect(edges.pressed(Button.Shot)).toBe(false);
    expect(edges.held(Button.Shot)).toBe(true);
  });

  test('the first update never reports an edge', () => {
    // The bug this exists to stop: a menu pushed on the tick a button went down
    // reading that same press as its own confirmation.
    const edges = new Edges();
    edges.update(Button.Start);
    expect(edges.pressed(Button.Start)).toBe(false);
  });

  test('release then press reports a second edge', () => {
    const edges = new Edges();
    edges.update(0);
    edges.update(Button.Bomb);
    edges.update(0);
    edges.update(Button.Bomb);
    expect(edges.pressed(Button.Bomb)).toBe(true);
  });

  test('reset re-arms the first-update suppression', () => {
    const edges = new Edges();
    edges.update(0);
    edges.reset();
    edges.update(Button.Start);
    expect(edges.pressed(Button.Start)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* The screens                                                         */
/* ------------------------------------------------------------------ */

describe('screens', () => {
  test('a held button advances exactly one screen, not three', () => {
    const ctx = context();
    open(ctx.machine, new TitleState(ctx));

    // Start held down and never released. On held bits rather than press edges
    // this walks title → difficulty → select → playing in four ticks, which is
    // the bug the whole `Edges` mechanism exists to prevent: the player taps
    // Start once and the game deals them a run they never chose.
    for (let t = 0; t < 10; t++) ctx.machine.tick(Button.Start);
    expect(ctx.machine.current?.name).toBe('difficulty-select');
  });

  test('title advances to difficulty select on a press', () => {
    const ctx = context();
    open(ctx.machine, new TitleState(ctx));
    press(ctx.machine, Button.Start);
    expect(ctx.machine.current?.name).toBe('difficulty-select');
  });

  test('with no campaigns the title menu is exactly START and steers nothing', () => {
    const ctx = context({ stage: undefined });
    const title = new TitleState(ctx);
    open(ctx.machine, title);
    // Byte-identical to the single-row menu that shipped before campaigns.
    expect(title.view().menu).toEqual(['START']);

    press(ctx.machine, Button.Shot);
    expect(ctx.machine.current?.name).toBe('difficulty-select');
    // START touches neither, so a built-in run defaults its stage and records
    // an empty pack identity.
    expect(ctx.stage).toBeUndefined();
    expect(ctx.packsData).toBeUndefined();
  });

  test('a campaign adds a row under START and steers the run when chosen', () => {
    const campaigns = [
      { label: 'example/gauntlet', stage: 'example/gauntlet', packsData: 'example@abcdef012345' },
    ];
    const ctx = context({ campaigns });
    const title = new TitleState(ctx);
    open(ctx.machine, title);
    expect(title.view().menu).toEqual(['START', 'example/gauntlet']);

    // Down to the campaign row, then confirm.
    tap(ctx.machine, Button.Down);
    press(ctx.machine, Button.Shot);

    // The tier screen is next; the campaign's steering is already applied.
    expect(ctx.machine.current?.name).toBe('difficulty-select');
    // The chosen campaign armed both the qualified stage and the strict pack
    // identity that will gate this run's replay.
    expect(ctx.stage).toBe('example/gauntlet');
    expect(ctx.packsData).toBe('example@abcdef012345');
  });

  test('choosing START leaves stage and packsData untouched even with campaigns present', () => {
    const campaigns = [
      { label: 'example/gauntlet', stage: 'example/gauntlet', packsData: 'example@abcdef012345' },
    ];
    const ctx = context({ campaigns, stage: undefined });
    open(ctx.machine, new TitleState(ctx));
    // Row 0 without moving the cursor.
    press(ctx.machine, Button.Shot);

    expect(ctx.machine.current?.name).toBe('difficulty-select');
    expect(ctx.stage).toBeUndefined();
    expect(ctx.packsData).toBeUndefined();
  });

  test('character select offers every registered character', () => {
    const ctx = context();
    const select = new CharacterSelectState(ctx);
    open(ctx.machine, select);
    const view = select.view();
    expect(view.menu?.length).toBe(characterNames().length);
    expect(view.menu).toContain(getCharacter(PILOT).label);
    expect(view.character).toBe(characterNames()[0]);
  });

  test('the cursor wraps in both directions', () => {
    const ctx = context();
    const select = new CharacterSelectState(ctx);
    open(ctx.machine, select);
    const count = characterNames().length;

    // Up from the first entry. A bare `%` on a decrement gives -1 here, which
    // is the edge the wrap exists for.
    tap(ctx.machine, Button.Up);
    expect(select.view().selected).toBe(count - 1);
    tap(ctx.machine, Button.Down);
    expect(select.view().selected).toBe(0);
  });

  test('confirming a character starts a run with it', () => {
    const ctx = context();
    open(ctx.machine, new CharacterSelectState(ctx));
    tap(ctx.machine, Button.Down);
    press(ctx.machine, Button.Shot);

    const second = characterNames()[1];
    // Throw rather than assert: this test is meaningless with one character,
    // and a silently-skipped seam test is worse than a missing one.
    if (second === undefined) throw new Error('expected a second character');

    const playing = ctx.machine.current;
    expect(playing?.name).toBe('playing');
    expect((playing as PlayingState).characterName).toBe(second);
  });

  test('cancelling out of character select returns to the title', () => {
    const ctx = context();
    open(ctx.machine, new CharacterSelectState(ctx));
    press(ctx.machine, Button.Bomb);
    expect(ctx.machine.current?.name).toBe('title');
  });

  test('the run does not advance on the tick the ship was chosen', () => {
    const ctx = context();
    open(ctx.machine, new CharacterSelectState(ctx));
    press(ctx.machine, Button.Shot);
    const playing = ctx.machine.current as PlayingState;
    expect(playing.run.tickCount).toBe(0);
  });

  test('a pack character flown off the plain START row records the owning pack', () => {
    // The one subtle MUST of the data tier: a pack character drives the
    // simulation with pack content, so even without a campaign row (packsData
    // left empty by START) the run must record the pack's identity strictly.
    const ctx = context({
      characterPacks: [{ character: PACK_CHARACTER, packsData: PACK_DATA }],
    });
    const index = characterNames().indexOf(PACK_CHARACTER);
    expect(index).toBeGreaterThanOrEqual(0);

    open(ctx.machine, new CharacterSelectState(ctx));
    tap(ctx.machine, Button.Down, index);
    press(ctx.machine, Button.Shot);

    // Armed even though the plain START row left packsData undefined.
    expect(ctx.packsData).toBe(PACK_DATA);
    const playing = ctx.machine.current as PlayingState;
    expect(playing.characterName).toBe(PACK_CHARACTER);
    // And it reaches the recording — where a mismatched replay is then refused
    // (proved strictly in run.test.ts).
    expect(playing.run.finishRecording().meta?.['packsData']).toBe(PACK_DATA);
  });

  test('a built-in character off START records no pack identity, even with a mapping present', () => {
    // The owning-pack lookup only fires for the character that was chosen: a
    // built-in ship is not in `characterPacks`, so it leaves packsData empty.
    const ctx = context({
      characterPacks: [{ character: PACK_CHARACTER, packsData: PACK_DATA }],
    });
    open(ctx.machine, new CharacterSelectState(ctx));
    // Row 0 is a built-in (registration order puts the pack character last).
    press(ctx.machine, Button.Shot);
    expect(ctx.packsData).toBeUndefined();
    expect((ctx.machine.current as PlayingState).characterName).not.toBe(PACK_CHARACTER);
  });

  test('a pack character unions its identity with a different pack campaign', () => {
    const ctx = context({
      stage: REPLAY_STAGE,
      packsData: 'alpha@111111111111',
      characterPacks: [{
        character: PACK_CHARACTER,
        packsData: 'beta@222222222222',
      }],
    });
    const select = new CharacterSelectState(ctx);
    open(ctx.machine, select);
    const target = characterNames().indexOf(PACK_CHARACTER);
    tap(ctx.machine, Button.Down, target);
    press(ctx.machine, Button.Shot);

    expect(ctx.packsData).toBe('alpha@111111111111,beta@222222222222');
    expect((ctx.machine.current as PlayingState).run.config.packsData).toBe(
      'alpha@111111111111,beta@222222222222',
    );
  });
});

/* ------------------------------------------------------------------ */
/* Replay library and viewer                                           */
/* ------------------------------------------------------------------ */

function recordStage(
  stage: string,
  seed: number,
  buttonsAt: (tick: number) => number = () => 0,
  carry?: PlayerCarry,
): { run: Run; replay: Replay } {
  const run = new Run({
    seed,
    character: PILOT,
    stage,
    ...(carry === undefined ? {} : { carry }),
  });
  for (let tick = 0; tick < 1000 && !run.finished; tick++) {
    run.tick(buttonsAt(tick));
  }
  if (!run.finished) throw new Error(`test replay stage "${stage}" did not finish`);
  return { run, replay: run.finishRecording() };
}

function replaySession(
  segments: readonly Replay[],
  id = 'test-session',
): ReplaySession {
  return createReplaySession(
    { id, now: '2026-07-24T10:20:30.000Z' },
    segments,
  );
}

function campaignContext(overrides: Partial<GameContext> = {}): GameContext {
  return context({
    campaigns: [{ label: 'test campaign', stage: PENULTIMATE_STAGE, packsData: '' }],
    ...overrides,
  });
}

function recordPartialStage(
  ticks: number,
  endReason: ReplayEndReason = 'quit',
  seed = 117,
): { run: Run; replay: Replay } {
  const run = new Run({
    seed,
    character: PILOT,
    stage: REPLAY_STAGE,
  });
  for (let tick = 0; tick < ticks; tick++) run.tick(tick % 2 === 0 ? Button.Right : 0);
  if (run.finished) throw new Error('partial replay fixture unexpectedly finished');
  const recorded = run.finishRecording();
  return {
    run,
    replay: {
      ...recorded,
      meta: { ...recorded.meta, endReason },
    },
  };
}

describe('replay library and viewer', () => {
  test('title exposes a replay library whose import row carries a shell action', () => {
    const { replay } = recordStage(REPLAY_STAGE, 101);
    const session = replaySession([replay]);
    let imports = 0;
    const ctx = context({
      replaySessions: [session],
      onImportReplay: () => imports++,
    });
    const title = new TitleState(ctx);
    open(ctx.machine, title);
    expect(title.view().menu).toEqual(['START', 'REPLAYS']);

    tap(ctx.machine, Button.Down);
    tap(ctx.machine, Button.Shot);
    expect(ctx.machine.current).toBeInstanceOf(ReplayLibraryState);
    const library = ctx.machine.current as ReplayLibraryState;
    expect(library.view().menu?.at(-2)).toBe('IMPORT REPLAY');
    expect(library.view().menuActions?.at(-2)).toBe('import-replay');

    // Open the session, then cancel back to the library.
    tap(ctx.machine, Button.Shot);
    expect(ctx.machine.current).toBeInstanceOf(ReplaySessionState);
    tap(ctx.machine, Button.Bomb);
    expect(ctx.machine.current).toBeInstanceOf(ReplayLibraryState);

    // One saved session means the next row is IMPORT.
    tap(ctx.machine, Button.Down);
    press(ctx.machine, Button.Shot);
    expect(imports).toBe(1);
  });

  test('deleting a session requires a cancel-first confirmation', () => {
    const { replay } = recordStage(REPLAY_STAGE, 123);
    const session = replaySession([
      replay,
      { ...replay, seed: 124 },
    ], 'delete-me');
    const deleted: ReplaySession[] = [];
    const ctx = context({
      replaySessions: [session],
      onDeleteReplaySession: (approved) => deleted.push(approved),
    });
    open(ctx.machine, new ReplaySessionState(ctx, session));

    const detail = ctx.machine.current as ReplaySessionState;
    const deleteIndex = detail.view().menu?.indexOf('DELETE') ?? -1;
    expect(deleteIndex).toBeGreaterThan(-1);
    expect(detail.view().menu?.slice(-3)).toEqual([
      'DOWNLOAD REPLAY DATA',
      'DELETE',
      'BACK',
    ]);

    // Entering the destructive screen lands on CANCEL, and Bomb also returns.
    tap(ctx.machine, Button.Down, deleteIndex);
    tap(ctx.machine, Button.Shot);
    expect(ctx.machine.current).toBeInstanceOf(ReplayDeleteConfirmState);
    expect(ctx.machine.current?.view?.()).toMatchObject({
      title: 'DELETE SESSION?',
      menu: ['CANCEL', 'DELETE FOREVER'],
      selected: 0,
    });
    tap(ctx.machine, Button.Bomb);
    expect(ctx.machine.current).toBeInstanceOf(ReplaySessionState);
    expect(deleted).toEqual([]);

    // A plain confirm is safe too: the cursor still rests on CANCEL.
    tap(ctx.machine, Button.Down, deleteIndex);
    tap(ctx.machine, Button.Shot);
    tap(ctx.machine, Button.Shot);
    expect(ctx.machine.current).toBeInstanceOf(ReplaySessionState);
    expect(deleted).toEqual([]);

    // Deletion needs a deliberate move to the second confirmation row.
    tap(ctx.machine, Button.Down, deleteIndex);
    tap(ctx.machine, Button.Shot);
    tap(ctx.machine, Button.Down);
    press(ctx.machine, Button.Shot);
    expect(deleted).toEqual([session]);
    expect(ctx.machine.current).toBeInstanceOf(ReplayLibraryState);
  });

  test('live flight buttons never enter replay simulation and exact completion is checked', () => {
    const { replay } = recordStage(REPLAY_STAGE, 102);
    const session = replaySession([replay]);
    const ctx = context({ replaySessions: [session] });
    const viewer = new ReplayPlayingState(ctx, session, 0);
    ctx.machine.push(viewer);

    for (let tick = 0; tick < 100 && ctx.machine.current?.name === 'replay-playing'; tick++) {
      ctx.machine.tick(Button.Shot | Button.Right | Button.Slow);
    }

    expect(ctx.machine.current?.name).toBe('replay-complete');
    expect(ctx.machine.current?.view?.().menu).toEqual([
      'WATCH AGAIN',
      'EXPORT VIDEO',
      'DOWNLOAD REPLAY DATA',
      'BACK',
    ]);
    expect(viewer.matchesRecording()).toBe(true);
    // The playback run records the file's masks, not the live mask above.
    expect(viewer.run.finishRecording().inputs).toEqual(replay.inputs);
  });

  test('an intentional QUIT prefix watches to its exact tick without a mismatch', () => {
    const { replay } = recordPartialStage(7, 'quit');
    const session = replaySession([replay]);
    const ctx = context({ replaySessions: [session] });
    const viewer = new ReplayPlayingState(ctx, session, 0);
    ctx.machine.push(viewer);

    for (let tick = 0; tick < replay.length + 2; tick++) ctx.machine.tick(Button.Shot);

    expect(ctx.machine.current?.name).toBe('replay-complete');
    expect(viewer.run.tickCount).toBe(replay.length);
    expect(viewer.run.finished).toBe(false);
    expect(viewer.matchesRecording()).toBe(true);
    expect(ctx.machine.current?.view?.().title).toBe('REPLAY ENDED · QUIT');

    const detail = new ReplayStageState(ctx, session, 0);
    expect(detail.view().lines?.[0]).toContain('QUIT');
    expect(detail.view().lines?.[0]).toContain('00:00');
  });

  test('an intentional RETRIED prefix exports through the same exact matcher', () => {
    const { replay } = recordPartialStage(9, 'retry', 118);
    const session = replaySession([replay]);
    const ctx = context({ replaySessions: [session] });
    const exporting = new ReplayExportState(ctx, session, 0);
    open(ctx.machine, exporting);
    expect(exporting.estimatedTicks).toBe(replay.length + REPLAY_EXPORT_TAIL_TICKS);
    expect(exporting.arm()).toBe(true);

    for (
      let tick = 0;
      tick < replay.length + 2 && exporting.phase === 'recording';
      tick++
    ) {
      ctx.machine.tick(Button.Left | Button.Shot);
    }

    expect(exporting.phase).toBe('finished');
    expect(exporting.run.tickCount).toBe(replay.length);
    expect(exporting.run.finished).toBe(false);
    expect(exporting.matchesRecording()).toBe(true);
  });

  test('a zero-tick quit is a valid watchable and exportable replay', () => {
    const { replay } = recordPartialStage(0, 'quit', 119);
    const session = replaySession([replay]);

    const watchCtx = context({ replaySessions: [session] });
    const viewer = new ReplayPlayingState(watchCtx, session, 0);
    open(watchCtx.machine, viewer);
    expect(watchCtx.machine.current?.name).toBe('replay-complete');
    expect(viewer.matchesRecording()).toBe(true);

    const exportCtx = context({ replaySessions: [session] });
    const exporting = new ReplayExportState(exportCtx, session, 0);
    open(exportCtx.machine, exporting);
    expect(exporting.estimatedTicks).toBe(1 + REPLAY_EXPORT_TAIL_TICKS);
    expect(exporting.arm()).toBe(true);
    exportCtx.machine.tick(0);
    expect(exporting.phase).toBe('finished');
    expect(exporting.run.tickCount).toBe(0);
    expect(exporting.matchesRecording()).toBe(true);
  });

  test('session preflight refuses an early-ended segment before an appended stage', () => {
    const partial = recordPartialStage(5, 'quit', 120).replay;
    const natural = recordStage(FINAL_STAGE, 121).replay;
    const session = replaySession([partial, natural]);
    const ctx = context({ replaySessions: [session] });
    expect(() => preflightReplaySession(ctx, session)).toThrow(
      /segment 1 must be a natural clear before segment 2/,
    );
    expect(() => new ReplayPlayingState(ctx, session, 0, { continuous: true })).toThrow(
      /segment 1 must be a natural clear before segment 2/,
    );
  });

  test('single-stage export freezes while preparing and advances only recorded input once armed', () => {
    const { replay } = recordStage(REPLAY_STAGE, 114);
    const session = replaySession([replay]);
    const ctx = context({ replaySessions: [session] });
    const exporting = new ReplayExportState(ctx, session, 0);
    open(ctx.machine, exporting);

    for (let tick = 0; tick < 12; tick++) {
      ctx.machine.tick(Button.Shot | Button.Right | Button.Slow);
    }
    expect(exporting.phase).toBe('preparing');
    expect(exporting.run.tickCount).toBe(0);

    expect(exporting.arm()).toBe(true);
    for (
      let tick = 0;
      tick < replay.length + 10 && exporting.phase === 'recording';
      tick++
    ) {
      ctx.machine.tick(Button.Shot | Button.Right | Button.Slow);
    }

    expect(ctx.machine.current).toBe(exporting);
    expect(exporting.phase).toBe('finished');
    expect(exporting.matchesRecording()).toBe(true);
    expect(exporting.run.finishRecording().inputs).toEqual(replay.inputs);
    expect(exporting.beginStopping()).toBe(true);
    expect(exporting.complete('danmaku-stage.webm')).toBe(true);
    expect(ctx.machine.current?.name).toBe('replay-export-result');
  });

  test('one session export instance plays every stage, ending page, and ALL CLEAR hold', () => {
    const first = recordStage(PENULTIMATE_STAGE, 140);
    const final = recordStage(FINAL_STAGE, 141, () => 0, first.run.carry);
    const session = replaySession([first.replay, final.replay]);
    const ctx = campaignContext({ replaySessions: [session] });
    const preflight = preflightReplaySession(ctx, session);
    expect(preflight.kind).toBe('full-campaign');
    expect(new ReplaySessionState(ctx, session).view().menu?.slice(0, 2)).toEqual([
      'WATCH FULL CAMPAIGN',
      'EXPORT FULL CAMPAIGN VIDEO',
    ]);

    const exporting = new ReplayExportState(ctx, session, REPLAY_SESSION_EXPORT_TARGET);
    open(ctx.machine, exporting);
    expect(exporting.arm()).toBe(true);
    expect(exporting.sessionWide).toBe(true);
    expect(exporting.sessionKind).toBe('full-campaign');
    expect(exporting.estimatedTicks).toBe(
      first.replay.length
      + final.replay.length
      + REPLAY_SESSION_STAGE_HOLD_TICKS
      + 3 * REPLAY_SESSION_ENDING_PAGE_TICKS
      + REPLAY_SESSION_RESULT_HOLD_TICKS
      + REPLAY_EXPORT_TAIL_TICKS,
    );

    for (let tick = 0; tick < first.replay.length + 2 && exporting.view().kind === 'playing'; tick++) {
      ctx.machine.tick(0);
    }
    expect(ctx.machine.current).toBe(exporting);
    expect(exporting.segmentIndex).toBe(0);
    expect(exporting.view()).toMatchObject({
      kind: 'cleared',
      title: 'STAGE CLEAR',
      menu: [],
      age: 0,
    });
    const frozen = exporting.run;
    for (let tick = 1; tick < REPLAY_SESSION_STAGE_HOLD_TICKS; tick++) {
      ctx.machine.tick(0);
      expect(exporting.run).toBe(frozen);
      expect(ctx.machine.current).toBe(exporting);
    }
    ctx.machine.tick(0);
    expect(ctx.machine.current).toBe(exporting);
    expect(exporting.segmentIndex).toBe(1);
    expect(exporting.run.stageName).toBe(FINAL_STAGE);
    expect(exporting.run.config.carry).toEqual(first.run.carry);

    for (let tick = 0; tick < final.replay.length + 2 && exporting.view().kind === 'playing'; tick++) {
      ctx.machine.tick(0);
    }
    expect(exporting.phase).toBe('recording');
    expect(exporting.view()).toMatchObject({
      kind: 'ending',
      lines: ['test opening one', 'test opening two'],
      endingPage: { index: 0, count: 3, age: 0 },
    });
    expect(exporting.music).toBe('test-ending-music');
    expect(exporting.scene).toBe('test-ending-scene');

    for (let page = 0; page < 3; page++) {
      for (let tick = 1; tick < REPLAY_SESSION_ENDING_PAGE_TICKS; tick++) {
        ctx.machine.tick(0);
        expect(ctx.machine.current).toBe(exporting);
        expect(exporting.phase).toBe('recording');
      }
      ctx.machine.tick(0);
      if (page < 2) {
        expect(exporting.view().endingPage).toMatchObject({ index: page + 1, age: 0 });
      }
    }

    expect(exporting.view()).toMatchObject({
      kind: 'cleared',
      title: 'ALL CLEAR',
      menu: [],
      age: 0,
    });
    expect(exporting.music).toBeUndefined();
    expect(exporting.scene).toBeUndefined();
    for (let tick = 1; tick < REPLAY_SESSION_RESULT_HOLD_TICKS; tick++) {
      ctx.machine.tick(0);
      expect(exporting.phase).toBe('recording');
    }
    ctx.machine.tick(0);
    expect(exporting.phase).toBe('finished');
    expect(ctx.machine.current).toBe(exporting);
    expect(exporting.beginStopping()).toBe(true);
    expect(exporting.complete('danmaku-campaign.webm')).toBe(true);
    ctx.machine.tick(0);
    press(ctx.machine, Button.Shot);
    const again = ctx.machine.current as ReplayExportState;
    expect(again).toBeInstanceOf(ReplayExportState);
    expect(again.sessionWide).toBe(true);
    expect(again.sessionKind).toBe('full-campaign');
  });

  test('a partial recorded attempt gets a deterministic non-ALL-CLEAR terminal card', () => {
    const first = recordStage(PENULTIMATE_STAGE, 142);
    const partialRun = new Run({
      seed: 143,
      character: PILOT,
      stage: FINAL_STAGE,
      carry: first.run.carry,
    });
    const recorded = partialRun.finishRecording();
    const partial: Replay = {
      ...recorded,
      meta: { ...recorded.meta, endReason: 'quit' },
    };
    const session = replaySession([first.replay, partial]);
    const ctx = campaignContext();
    expect(preflightReplaySession(ctx, session).kind).toBe('recorded-attempt');
    expect(new ReplaySessionState(ctx, session).view().menu?.slice(0, 2)).toEqual([
      'WATCH RECORDED ATTEMPT',
      'EXPORT RECORDED ATTEMPT VIDEO',
    ]);
    const exporting = new ReplayExportState(ctx, session, REPLAY_SESSION_EXPORT_TARGET);
    open(ctx.machine, exporting);
    expect(exporting.arm()).toBe(true);
    expect(exporting.estimatedTicks).toBe(
      first.replay.length
      + Math.max(1, partial.length)
      + REPLAY_SESSION_STAGE_HOLD_TICKS
      + REPLAY_SESSION_RESULT_HOLD_TICKS
      + REPLAY_EXPORT_TAIL_TICKS,
    );

    for (let tick = 0; tick < first.replay.length + REPLAY_SESSION_STAGE_HOLD_TICKS + 4; tick++) {
      ctx.machine.tick(0);
      if (exporting.segmentIndex === 1 && exporting.view().kind !== 'playing') break;
    }

    expect(exporting.view()).toMatchObject({
      kind: 'replay-complete',
      title: 'REPLAY ENDED · QUIT',
      menu: [],
      age: 0,
    });
    expect(exporting.view().title).not.toBe('ALL CLEAR');
    expect(exporting.view().kind).not.toBe('ending');
    for (let tick = 0; tick < REPLAY_SESSION_RESULT_HOLD_TICKS; tick++) ctx.machine.tick(0);
    expect(exporting.phase).toBe('finished');
  });

  test('a failed recorded attempt uses the deterministic GAME OVER card and silence', () => {
    const failed = recordStage(FAILED_REPLAY_STAGE, 144);
    expect(failed.run.outcome).toBe('failed');
    const session = replaySession([failed.replay]);
    const ctx = context({
      campaigns: [{ label: 'failed campaign', stage: FAILED_REPLAY_STAGE, packsData: '' }],
    });
    expect(preflightReplaySession(ctx, session).kind).toBe('recorded-attempt');
    const exporting = new ReplayExportState(ctx, session, REPLAY_SESSION_EXPORT_TARGET);
    open(ctx.machine, exporting);
    expect(exporting.arm()).toBe(true);

    for (let tick = 0; tick < failed.replay.length + 2 && exporting.view().kind === 'playing'; tick++) {
      ctx.machine.tick(0);
    }

    expect(exporting.matchesRecording()).toBe(true);
    expect(exporting.view()).toMatchObject({
      kind: 'game-over',
      title: 'GAME OVER',
      menu: [],
      age: 0,
    });
    expect(exporting.silenceMusic).toBe(true);
    expect(exporting.scene).toBe('signal-decay');
    for (let tick = 0; tick < REPLAY_SESSION_RESULT_HOLD_TICKS; tick++) ctx.machine.tick(0);
    expect(exporting.phase).toBe('finished');
  });

  test('presentation steps the final replay tick, then freezes its tail frame', () => {
    expect(replayExportPresentationAdvances(undefined, undefined)).toBe(true);
    expect(replayExportPresentationAdvances(undefined, 'preparing')).toBe(false);
    expect(replayExportPresentationAdvances('preparing', 'recording')).toBe(true);
    expect(replayExportPresentationAdvances('recording', 'recording')).toBe(true);
    expect(replayExportPresentationAdvances('recording', 'finished')).toBe(true);
    expect(replayExportPresentationAdvances('recording', 'finished', false)).toBe(false);
    expect(replayExportPresentationAdvances('finished', 'finished')).toBe(false);
    expect(replayExportPresentationAdvances('finished', 'stopping')).toBe(false);
  });

  test('session and STAGES menus keep whole-replay actions separate from per-stage export', () => {
    const { replay } = recordStage(REPLAY_STAGE, 115);
    const session = replaySession([replay]);
    const errors: string[] = [];
    const ctx = context({
      replaySessions: [session],
      onReplayError: (message) => errors.push(message),
    });
    const detail = new ReplaySessionState(ctx, session);
    open(ctx.machine, detail);
    expect(detail.view().menu).toEqual([
      'WATCH REPLAY',
      'EXPORT REPLAY VIDEO',
      'STAGES',
      'DOWNLOAD REPLAY DATA',
      'BACK',
    ]);

    tap(ctx.machine, Button.Down, 2);
    press(ctx.machine, Button.Shot);
    expect(ctx.machine.current).toBeInstanceOf(ReplayStagesState);
    expect(ctx.machine.current?.view?.().menu).toEqual([
      expect.stringContaining((replay.meta?.['stage'] as string).toUpperCase()),
      'BACK',
    ]);
    ctx.machine.tick(0);
    press(ctx.machine, Button.Shot);
    expect(ctx.machine.current).toBeInstanceOf(ReplayStageState);
    expect(ctx.machine.current?.view?.().menu).toEqual([
      'WATCH STAGE',
      'EXPORT STAGE VIDEO',
      'BACK',
    ]);
    ctx.machine.tick(0);
    tap(ctx.machine, Button.Down);
    press(ctx.machine, Button.Shot);
    const exporting = ctx.machine.current as ReplayExportState;
    expect(exporting).toBeInstanceOf(ReplayExportState);
    expect(exporting.sessionWide).toBe(false);
    ctx.machine.tick(0);
    expect(exporting.arm()).toBe(true);
    tap(ctx.machine, Button.Start);
    expect(ctx.machine.current?.name).toBe('replay-export-result');
    expect(errors.at(-1)).toBe('video export cancelled');
  });

  test('video export discards a replay whose recorded result does not reproduce', () => {
    const { replay } = recordStage(REPLAY_STAGE, 116);
    const mismatch: Replay = {
      ...replay,
      meta: {
        ...replay.meta,
        score: ((replay.meta?.['score'] as number | undefined) ?? 0) + 1,
      },
    };
    const session = replaySession([mismatch]);
    const errors: string[] = [];
    const ctx = context({ onReplayError: (message) => errors.push(message) });
    const exporting = new ReplayExportState(ctx, session, 0);
    open(ctx.machine, exporting);
    expect(exporting.arm()).toBe(true);

    for (
      let tick = 0;
      tick < mismatch.length + 10 && ctx.machine.current === exporting;
      tick++
    ) {
      ctx.machine.tick(0);
    }
    expect(ctx.machine.current?.name).toBe('replay-export-result');
    expect(errors.at(-1)).toMatch(/did not reproduce/);
  });

  test('a Start bit inside the recording does not open the viewer pause menu', () => {
    const { replay } = recordStage(
      REPLAY_STAGE,
      103,
      (tick) => tick === 3 ? Button.Start : 0,
    );
    expect(replay.inputs.some((entry) => (entry.buttons & Button.Start) !== 0)).toBe(true);
    const session = replaySession([replay]);
    const ctx = context({ replaySessions: [session] });
    ctx.machine.push(new ReplayPlayingState(ctx, session, 0));

    const visited: string[] = [];
    for (let tick = 0; tick < 100 && ctx.machine.current?.name === 'replay-playing'; tick++) {
      ctx.machine.tick(0);
      visited.push(ctx.machine.current?.name ?? '');
    }
    expect(visited).not.toContain('replay-pause');
    expect(ctx.machine.current?.name).toBe('replay-complete');
  });

  test('live Start freezes replay playback and live Bomb exits to its session', () => {
    const { replay } = recordStage(REPLAY_STAGE, 104);
    const session = replaySession([replay]);
    const ctx = context({ replaySessions: [session] });
    const viewer = new ReplayPlayingState(ctx, session, 0);
    ctx.machine.push(viewer);
    ctx.machine.tick(0);

    tap(ctx.machine, Button.Start);
    expect(ctx.machine.current?.name).toBe('replay-pause');
    const frozen = viewer.run.tickCount;
    for (let tick = 0; tick < 10; tick++) ctx.machine.tick(0);
    expect(viewer.run.tickCount).toBe(frozen);

    press(ctx.machine, Button.Start);
    expect(ctx.machine.current?.name).toBe('replay-playing');
    ctx.machine.tick(0);
    press(ctx.machine, Button.Bomb);
    expect(ctx.machine.current).toBeInstanceOf(ReplaySessionState);
  });

  test('WATCH SESSION holds the verified clear, then advances without a press using actual carry', () => {
    const first = recordStage(PENULTIMATE_STAGE, 105);
    const second = recordStage(FINAL_STAGE, 106, () => 0, first.run.carry);
    const session = replaySession([first.replay, second.replay]);
    const ctx = context({ replaySessions: [session] });
    open(ctx.machine, new ReplaySessionState(ctx, session));
    press(ctx.machine, Button.Shot);
    const firstViewer = ctx.machine.current as ReplayPlayingState;
    expect(firstViewer).toBeInstanceOf(ReplayPlayingState);

    for (let tick = 0; tick < first.replay.length + 2 && firstViewer.view().kind === 'playing'; tick++) {
      ctx.machine.tick(0);
    }
    expect(ctx.machine.current).toBe(firstViewer);
    expect(firstViewer.view()).toMatchObject({
      kind: 'cleared',
      title: 'STAGE CLEAR',
      menu: [],
      age: 0,
    });
    const frozenTick = firstViewer.run.tickCount;
    for (let tick = 1; tick < REPLAY_SESSION_STAGE_HOLD_TICKS; tick++) {
      ctx.machine.tick(0);
      expect(ctx.machine.current).toBe(firstViewer);
      expect(firstViewer.run.tickCount).toBe(frozenTick);
    }

    // The final hold tick swaps in stage two without any live Shot/Start input.
    ctx.machine.tick(0);
    const next = ctx.machine.current as ReplayPlayingState;
    expect(next.name).toBe('replay-playing');
    expect(next.run.stageName).toBe(FINAL_STAGE);
    expect(next.run.config.carry).toEqual(first.run.carry);

    for (let tick = 0; tick < second.replay.length + 2 && next.view().kind === 'playing'; tick++) {
      ctx.machine.tick(0);
    }
    expect(next.sessionKind).toBe('recorded-attempt');
    expect(next.view()).toMatchObject({
      kind: 'cleared',
      title: 'STAGE CLEAR',
      menu: [],
      age: 0,
    });
    expect(next.view().title).not.toBe('ALL CLEAR');
    for (let tick = 0; tick < REPLAY_SESSION_RESULT_HOLD_TICKS; tick++) {
      ctx.machine.tick(0);
    }
    expect(ctx.machine.current?.name).toBe('replay-complete');
  });

  test('WATCH FULL CAMPAIGN auto-pages its ending and keeps completion session-wide', () => {
    const first = recordStage(PENULTIMATE_STAGE, 145);
    const final = recordStage(FINAL_STAGE, 146, () => 0, first.run.carry);
    const session = replaySession([first.replay, final.replay]);
    const ctx = campaignContext({ replaySessions: [session] });
    open(ctx.machine, new ReplaySessionState(ctx, session));
    press(ctx.machine, Button.Shot);

    let finalViewer: ReplayPlayingState | undefined;
    for (let tick = 0; tick < 2_000; tick++) {
      const current = ctx.machine.current;
      if (current instanceof ReplayPlayingState && current.view().kind === 'ending') {
        finalViewer = current;
        break;
      }
      ctx.machine.tick(0);
    }
    expect(finalViewer).toBeInstanceOf(ReplayPlayingState);
    expect(finalViewer?.segmentIndex).toBe(1);
    expect(finalViewer?.sessionKind).toBe('full-campaign');
    expect(finalViewer?.view()).toMatchObject({
      kind: 'ending',
      lines: ['test opening one', 'test opening two'],
      endingPage: { index: 0, count: 3, age: 0 },
    });
    expect(finalViewer?.music).toBe('test-ending-music');
    expect(finalViewer?.scene).toBe('test-ending-scene');

    for (let page = 0; page < 3; page++) {
      for (let tick = 1; tick < REPLAY_SESSION_ENDING_PAGE_TICKS; tick++) {
        ctx.machine.tick(0);
        expect(ctx.machine.current).toBe(finalViewer);
      }
      ctx.machine.tick(0);
      if (page < 2) {
        expect(finalViewer?.view().endingPage).toMatchObject({ index: page + 1, age: 0 });
      }
    }

    expect(finalViewer?.view()).toMatchObject({
      kind: 'cleared',
      title: 'ALL CLEAR',
      menu: [],
      age: 0,
    });
    for (let tick = 0; tick < REPLAY_SESSION_RESULT_HOLD_TICKS; tick++) {
      ctx.machine.tick(0);
    }
    expect(ctx.machine.current?.name).toBe('replay-complete');
    expect(ctx.machine.current?.view?.().menu).toEqual([
      'WATCH AGAIN',
      'EXPORT FULL CAMPAIGN VIDEO',
      'DOWNLOAD REPLAY DATA',
      'BACK',
    ]);

    ctx.machine.tick(0);
    press(ctx.machine, Button.Shot);
    const restarted = ctx.machine.current as ReplayPlayingState;
    expect(restarted).toBeInstanceOf(ReplayPlayingState);
    expect(restarted.segmentIndex).toBe(0);
    expect(restarted.run.stageName).toBe(PENULTIMATE_STAGE);
    expect(restarted.sessionKind).toBe('full-campaign');

    for (let tick = 0; tick < 2_000 && ctx.machine.current?.name !== 'replay-complete'; tick++) {
      ctx.machine.tick(0);
    }
    expect(ctx.machine.current?.name).toBe('replay-complete');
    ctx.machine.tick(0);
    tap(ctx.machine, Button.Down);
    press(ctx.machine, Button.Shot);
    const exporting = ctx.machine.current as ReplayExportState;
    expect(exporting).toBeInstanceOf(ReplayExportState);
    expect(exporting.target).toBe(REPLAY_SESSION_EXPORT_TARGET);
    expect(exporting.sessionWide).toBe(true);
  });

  test('WATCH RECORDED ATTEMPT holds a partial card without an ending or ALL CLEAR', () => {
    const first = recordStage(PENULTIMATE_STAGE, 147);
    const partialRun = new Run({
      seed: 148,
      character: PILOT,
      stage: FINAL_STAGE,
      carry: first.run.carry,
    });
    const recorded = partialRun.finishRecording();
    const partial: Replay = {
      ...recorded,
      meta: { ...recorded.meta, endReason: 'quit' },
    };
    const session = replaySession([first.replay, partial]);
    const ctx = campaignContext({ replaySessions: [session] });
    open(ctx.machine, new ReplaySessionState(ctx, session));
    press(ctx.machine, Button.Shot);

    const observedKinds = new Set<string>();
    const observedTitles = new Set<string>();
    let finalViewer: ReplayPlayingState | undefined;
    for (let tick = 0; tick < 1_000; tick++) {
      const current = ctx.machine.current;
      const view = current?.view?.();
      if (view !== undefined) {
        observedKinds.add(view.kind);
        if (view.title !== undefined) observedTitles.add(view.title);
      }
      if (
        current instanceof ReplayPlayingState
        && view?.title === 'REPLAY ENDED · QUIT'
      ) {
        finalViewer = current;
        break;
      }
      ctx.machine.tick(0);
    }

    expect(finalViewer).toBeInstanceOf(ReplayPlayingState);
    expect(finalViewer?.sessionKind).toBe('recorded-attempt');
    expect(finalViewer?.view()).toMatchObject({
      kind: 'replay-complete',
      title: 'REPLAY ENDED · QUIT',
      menu: [],
      age: 0,
    });
    expect(observedKinds).not.toContain('ending');
    expect(observedTitles).not.toContain('ALL CLEAR');
    for (let tick = 0; tick < REPLAY_SESSION_RESULT_HOLD_TICKS; tick++) {
      ctx.machine.tick(0);
    }
    expect(ctx.machine.current?.name).toBe('replay-complete');
    expect(ctx.machine.current?.view?.().menu).toContain('EXPORT RECORDED ATTEMPT VIDEO');
  });

  test('session pause restarts the whole session while single replay pause stays local', () => {
    const first = recordStage(PENULTIMATE_STAGE, 149);
    const final = recordStage(FINAL_STAGE, 150, () => 0, first.run.carry);
    const session = replaySession([first.replay, final.replay]);
    const ctx = campaignContext();
    const finalViewer = new ReplayPlayingState(ctx, session, 1, {
      continuous: true,
      carry: first.run.carry,
    });
    ctx.machine.push(finalViewer);
    ctx.machine.tick(0);
    tap(ctx.machine, Button.Start);
    expect(ctx.machine.current?.view?.().menu).toEqual([
      'RESUME',
      'RESTART SESSION',
      'EXIT REPLAY',
    ]);
    tap(ctx.machine, Button.Down);
    press(ctx.machine, Button.Shot);
    const restarted = ctx.machine.current as ReplayPlayingState;
    expect(restarted.segmentIndex).toBe(0);
    expect(restarted.run.stageName).toBe(PENULTIMATE_STAGE);

    const singleCtx = context();
    const singleSession = replaySession([recordStage(REPLAY_STAGE, 151).replay]);
    const single = new ReplayPlayingState(singleCtx, singleSession, 0);
    singleCtx.machine.push(single);
    singleCtx.machine.tick(0);
    tap(singleCtx.machine, Button.Start);
    expect(singleCtx.machine.current?.view?.().menu).toEqual([
      'RESUME',
      'RESTART REPLAY',
      'EXIT REPLAY',
    ]);
  });

  test('session preflight rejects a wrong stage edge and a changed stable field', () => {
    const first = recordStage(PENULTIMATE_STAGE, 125);
    const final = recordStage(FINAL_STAGE, 126, () => 0, first.run.carry).replay;
    const wrongStage = {
      ...final,
      meta: { ...final.meta, stage: UNAUTHORED_FINAL_STAGE },
    };
    expect(() => preflightReplaySession(
      context(),
      replaySession([first.replay, wrongStage]),
    )).toThrow(/leads to .*test-ending-final.*not segment 2 stage .*test-ending-unowned/);

    const changedDifficulty = {
      ...final,
      meta: { ...final.meta, difficulty: 'hard' },
    };
    expect(() => preflightReplaySession(
      context(),
      replaySession([first.replay, changedDifficulty]),
    )).toThrow(/segment 2 changes difficulty from "normal" to "hard"/);

    const changedCharacter = {
      ...final,
      meta: { ...final.meta, character: PACK_CHARACTER },
    };
    expect(() => preflightReplaySession(
      context(),
      replaySession([first.replay, changedCharacter]),
    )).toThrow(/segment 2 changes character/);

    const changedAssist = {
      ...final,
      meta: { ...final.meta, infiniteLives: 'true' },
    };
    expect(() => preflightReplaySession(
      context(),
      replaySession([first.replay, changedAssist]),
    )).toThrow(/segment 2 changes infiniteLives from false to true/);

    const changedPacksData = {
      ...final,
      meta: { ...final.meta, packsData: PACK_DATA },
    };
    expect(() => preflightReplaySession(
      context({ campaigns: [{ label: 'demo', stage: 'demo/entry', packsData: PACK_DATA }] }),
      replaySession([first.replay, changedPacksData]),
    )).toThrow(/segment 2 changes packsData/);
  });

  test('invalid multi-session main menu permits only STAGES and replay-data operations', () => {
    const first = recordStage(PENULTIMATE_STAGE, 144);
    const final = recordStage(FINAL_STAGE, 145, () => 0, first.run.carry).replay;
    const wrongStage = {
      ...final,
      meta: { ...final.meta, stage: UNAUTHORED_FINAL_STAGE },
    };
    const session = replaySession([first.replay, wrongStage]);
    const ctx = context({ replaySessions: [session] });
    const detail = new ReplaySessionState(ctx, session);
    open(ctx.machine, detail);

    expect(detail.view().menu).toEqual(['STAGES', 'DOWNLOAD REPLAY DATA', 'BACK']);
    expect(detail.view().menu?.length).toBeLessThanOrEqual(8);
    expect(detail.view().lines?.at(-1)).toMatch(/leads to/);
    expect(() => new ReplayExportState(
      ctx,
      session,
      REPLAY_SESSION_EXPORT_TARGET,
    )).toThrow(/leads to/);

    press(ctx.machine, Button.Shot);
    expect(ctx.machine.current).toBeInstanceOf(ReplayStagesState);
    expect(ctx.machine.current?.view?.().menu?.length).toBeLessThanOrEqual(8);
    ctx.machine.tick(0);
    press(ctx.machine, Button.Shot);
    expect(ctx.machine.current).toBeInstanceOf(ReplayStageState);
    expect(ctx.machine.current?.view?.().menu).toEqual([
      'WATCH STAGE',
      'EXPORT STAGE VIDEO',
      'BACK',
    ]);
  });

  test('STAGES pagination never exposes more than eight menu rows', () => {
    const replay = recordStage(REPLAY_STAGE, 146).replay;
    const session = replaySession(Array.from({ length: 12 }, (_, index) => ({
      ...replay,
      seed: replay.seed + index,
    })));
    const ctx = context();
    for (const page of [0, 1, 2]) {
      const stages = new ReplayStagesState(ctx, session, page);
      expect(stages.view().menu?.length).toBeLessThanOrEqual(8);
    }
  });

  test('session preflight treats content pinning as stable attempt identity', () => {
    const fingerprint = 'test-content-fingerprint';
    const first = recordStage(PENULTIMATE_STAGE, 127);
    const final = recordStage(FINAL_STAGE, 128, () => 0, first.run.carry).replay;
    const pinnedFinal = {
      ...final,
      meta: { ...final.meta, content: fingerprint },
    };
    expect(() => preflightReplaySession(
      context({ contentFingerprint: fingerprint }),
      replaySession([first.replay, pinnedFinal]),
    )).toThrow(/segment 2 changes content from undefined to "test-content-fingerprint"/);
  });

  test('session preflight keeps legacy single-stage recordings watchable', () => {
    const recorded = recordStage(REPLAY_STAGE, 132).replay;
    const {
      difficulty: _difficulty,
      packsData: _packsData,
      content: _content,
      ...legacyMeta
    } = recorded.meta ?? {};
    const legacy = { ...recorded, meta: legacyMeta };
    const session = replaySession([legacy]);
    const ctx = context({ replaySessions: [session] });

    expect(() => preflightReplaySession(ctx, session)).not.toThrow();
    expect(() => new ReplayPlayingState(ctx, session, 0, {
      continuous: true,
    })).not.toThrow();
  });

  test('session preflight does not make presentation-only pack drift strict', () => {
    const first = recordStage(PENULTIMATE_STAGE, 133);
    const final = recordStage(FINAL_STAGE, 134, () => 0, first.run.carry).replay;
    const reskinnedFinal = {
      ...final,
      meta: { ...final.meta, packs: 'different-skin@abcdef012345' },
    };

    expect(() => preflightReplaySession(
      context(),
      replaySession([first.replay, reskinnedFinal]),
    )).not.toThrow();
  });

  test('continuous hand-off refuses a next replay whose recorded carry is not the actual prior result', () => {
    const first = recordStage(PENULTIMATE_STAGE, 130);
    const wrongCarry = { ...first.run.carry, lives: first.run.carry.lives + 1 };
    const second = recordStage(FINAL_STAGE, 131, () => 0, wrongCarry);
    const session = replaySession([first.replay, second.replay]);
    const errors: string[] = [];
    const ctx = context({ onReplayError: (message) => errors.push(message) });
    const viewer = new ReplayPlayingState(ctx, session, 0, { continuous: true });
    ctx.machine.push(viewer);

    for (let tick = 0; tick < first.replay.length + REPLAY_SESSION_STAGE_HOLD_TICKS + 4; tick++) {
      ctx.machine.tick(0);
      if (ctx.machine.current?.name === 'replay-complete') break;
    }

    expect(ctx.machine.current?.name).toBe('replay-complete');
    expect(errors.at(-1)).toMatch(/cannot continue session.*carry/);
    expect(viewer.sequenceError).toMatch(/carry/);
    expect(ctx.machine.current?.view?.().title).toBe('REPLAY SESSION ERROR');

    const exportErrors: string[] = [];
    const exportCtx = campaignContext({
      onReplayError: (message) => exportErrors.push(message),
    });
    const exporting = new ReplayExportState(
      exportCtx,
      session,
      REPLAY_SESSION_EXPORT_TARGET,
    );
    open(exportCtx.machine, exporting);
    expect(exporting.arm()).toBe(true);
    for (let tick = 0; tick < first.replay.length + REPLAY_SESSION_STAGE_HOLD_TICKS + 4; tick++) {
      exportCtx.machine.tick(0);
      if (exportCtx.machine.current !== exporting) break;
    }
    expect(exportCtx.machine.current?.name).toBe('replay-export-result');
    expect(exportErrors.at(-1)).toMatch(/cannot continue session.*carry/);
  });

  test('strict data-pack identity is checked against the running build', () => {
    const { replay } = recordStage(REPLAY_STAGE, 107);
    const incompatible: Replay = {
      ...replay,
      meta: { ...replay.meta, packsData: 'missing@abcdef012345' },
    };
    const session = replaySession([incompatible]);
    expect(() => new ReplayPlayingState(context(), session, 0)).toThrow(
      /packsData.*missing@abcdef012345.*not loaded/,
    );
  });

  test('one loaded pack identity cannot certify another pack’s stage', () => {
    const { replay } = recordStage(REPLAY_STAGE, 108);
    const forged: Replay = {
      ...replay,
      meta: {
        ...replay.meta,
        stage: 'alpha/later',
        packsData: 'beta@222222222222',
      },
    };
    const ctx = context({
      campaigns: [
        { label: 'alpha', stage: 'alpha/entry', packsData: 'alpha@111111111111' },
        { label: 'beta', stage: 'beta/entry', packsData: 'beta@222222222222' },
      ],
    });
    expect(() => replayRunConfig(ctx, forged)).toThrow(
      /does not include.*alpha@111111111111/,
    );
  });

  test('different campaign and character packs are both certified', () => {
    const { replay } = recordStage(REPLAY_STAGE, 111);
    const crossPack: Replay = {
      ...replay,
      meta: {
        ...replay.meta,
        stage: 'alpha/later',
        character: PACK_CHARACTER,
        packsData: 'alpha@111111111111,beta@222222222222',
      },
    };
    const ctx = context({
      campaigns: [
        { label: 'alpha', stage: 'alpha/entry', packsData: 'alpha@111111111111' },
      ],
      characterPacks: [
        { character: PACK_CHARACTER, packsData: 'beta@222222222222' },
      ],
    });
    expect(replayRunConfig(ctx, crossPack).packsData).toBe(
      'alpha@111111111111,beta@222222222222',
    );
  });

  test('a guest campaign identity survives a bare built-in next stage', () => {
    const { replay } = recordStage(FINAL_STAGE, 112);
    const continued: Replay = {
      ...replay,
      meta: { ...replay.meta, packsData: 'alpha@111111111111' },
    };
    const ctx = context({
      campaigns: [
        { label: 'alpha', stage: 'alpha/entry', packsData: 'alpha@111111111111' },
      ],
    });
    expect(replayRunConfig(ctx, continued).packsData).toBe('alpha@111111111111');
  });

  test('present but ill-typed outcome and score metadata are refused', () => {
    const { replay } = recordStage(REPLAY_STAGE, 113);
    const badOutcome: Replay = {
      ...replay,
      meta: { ...replay.meta, outcome: 1 },
    };
    const badScore: Replay = {
      ...replay,
      meta: { ...replay.meta, score: '999' },
    };
    expect(() => replayRunConfig(context(), badOutcome)).toThrow(
      /meta.outcome must be a string/,
    );
    expect(() => replayRunConfig(context(), badScore)).toThrow(
      /meta.score must be a non-negative safe integer/,
    );
  });

  test('early-end metadata is strict and cannot bless an arbitrary truncation', () => {
    const { run, replay } = recordPartialStage(6, 'quit', 122);
    const invalidReason: Replay = {
      ...replay,
      meta: { ...replay.meta, endReason: 'crash' },
    };
    const invalidOutcome: Replay = {
      ...replay,
      meta: { ...replay.meta, outcome: 'failed' },
    };
    const invalidType: Replay = {
      ...replay,
      meta: { ...replay.meta, endReason: 1 },
    };
    const { score: _score, ...withoutScore } = replay.meta ?? {};
    const missingScore: Replay = { ...replay, meta: withoutScore };

    expect(() => replayRunConfig(context(), invalidReason)).toThrow(/invalid endReason/);
    expect(() => replayRunConfig(context(), invalidOutcome)).toThrow(
      /must have outcome "playing"/,
    );
    expect(() => replayRunConfig(context(), invalidType)).toThrow(
      /meta.endReason must be a string/,
    );
    expect(() => replayRunConfig(context(), missingScore)).toThrow(/must record its score/);

    const unmarked = run.finishRecording();
    const session = replaySession([unmarked]);
    const viewer = new ReplayPlayingState(context(), session, 0);
    for (let tick = 0; tick < unmarked.length; tick++) viewer.tick(0);
    expect(viewer.run.finished).toBe(false);
    expect(viewer.matchesRecording()).toBe(false);
  });

  test('session preflight refuses an unbuildable later segment before playback', () => {
    const first = recordStage(PENULTIMATE_STAGE, 109);
    const invalidNext: Replay = {
      ...first.replay,
      seed: 110,
      meta: { ...first.replay.meta, stage: 'missing/replay-stage' },
    };
    const session = replaySession([first.replay, invalidNext]);
    expect(() => preflightReplaySession(context(), session)).toThrow(
      /segment 2 cannot be rebuilt.*missing\/replay-stage/,
    );
  });
});

/* ------------------------------------------------------------------ */
/* Difficulty select                                                   */
/* ------------------------------------------------------------------ */

describe('difficulty select', () => {
  test('offers the four tiers, cursor defaulting to NORMAL', () => {
    const ctx = context();
    const select = new DifficultySelectState(ctx);
    open(ctx.machine, select);
    const view = select.view();
    // The four tiers, then both setup toggles beneath LUNATIC (off by default).
    expect(view.title).toBe('RUN SETUP');
    expect(view.menu).toEqual([
      'EASY',
      'NORMAL',
      'HARD',
      'LUNATIC',
      'INFINITE LIVES  OFF',
      'RECORD REPLAY  OFF',
    ]);
    // Opening on NORMAL is what keeps the default path unchanged: hold confirm
    // through the menus and the run is Normal, as it was before this screen.
    expect(view.selected).toBe(DIFFICULTIES.indexOf(DEFAULT_DIFFICULTY));
    expect(view.lines?.length).toBe(1);
  });

  test('confirming without moving lands on Normal and advances to character select', () => {
    const ctx = context();
    open(ctx.machine, new DifficultySelectState(ctx));
    press(ctx.machine, Button.Shot);
    expect(ctx.difficulty).toBe('normal');
    expect(ctx.machine.current?.name).toBe('character-select');
  });

  test('moving the cursor selects a different tier', () => {
    const ctx = context();
    open(ctx.machine, new DifficultySelectState(ctx));
    // NORMAL (index 1) down one is HARD.
    tap(ctx.machine, Button.Down);
    press(ctx.machine, Button.Shot);
    expect(ctx.difficulty).toBe('hard');
  });

  test('the cursor wraps in both directions', () => {
    const ctx = context();
    const select = new DifficultySelectState(ctx);
    open(ctx.machine, select);
    const rows = select.view().menu?.length ?? 0; // four tiers plus both toggles
    // Up from NORMAL (1) reaches EASY (0); another Up wraps to the last row, now
    // the replay toggle beneath the assist rather than LUNATIC itself.
    tap(ctx.machine, Button.Up);
    expect(select.view().selected).toBe(DIFFICULTIES.indexOf(DEFAULT_DIFFICULTY) - 1);
    tap(ctx.machine, Button.Up);
    expect(select.view().selected).toBe(rows - 1);
  });

  test('cancelling out of difficulty select returns to the title', () => {
    const ctx = context();
    open(ctx.machine, new DifficultySelectState(ctx));
    press(ctx.machine, Button.Bomb);
    expect(ctx.machine.current?.name).toBe('title');
  });

  test('the chosen tier reaches the run and its recording, strictly', () => {
    // The whole point of the wire: difficulty-select → RunConfig.difficulty →
    // the live `Run` and the replay meta a mismatch then refuses (proved in
    // run.test.ts). NORMAL (1) down twice is LUNATIC (3).
    const ctx = context();
    open(ctx.machine, new DifficultySelectState(ctx));
    tap(ctx.machine, Button.Down, 2);
    tap(ctx.machine, Button.Shot);
    tap(ctx.machine, Button.Shot);

    const playing = ctx.machine.current as PlayingState;
    expect(playing.name).toBe('playing');
    expect(playing.run.difficulty).toBe('lunatic');
    expect(playing.run.finishRecording().meta?.['difficulty']).toBe('lunatic');
  });

  test('the full title flow threads the tier all the way in', () => {
    // End to end through the real machine: title → difficulty → character →
    // playing, no state constructed by hand. HARD is NORMAL down one.
    const ctx = context();
    open(ctx.machine, new TitleState(ctx));
    tap(ctx.machine, Button.Shot); // START → difficulty-select
    tap(ctx.machine, Button.Down); // NORMAL → HARD
    tap(ctx.machine, Button.Shot); // → character-select
    tap(ctx.machine, Button.Shot); // → playing

    const playing = ctx.machine.current as PlayingState;
    expect(playing.name).toBe('playing');
    expect(playing.run.difficulty).toBe('hard');
  });

  test('the assist toggle flips in place on Shot and does not advance', () => {
    const ctx = context();
    const select = new DifficultySelectState(ctx);
    open(ctx.machine, select);
    // Down from NORMAL (1) three rows lands on the toggle: HARD, LUNATIC, toggle.
    tap(ctx.machine, Button.Down, 3);
    expect(select.view().selected).toBe(DIFFICULTIES.length);

    // Shot flips the assist and stays on the screen — a value edited, not a move.
    tap(ctx.machine, Button.Shot);
    expect(ctx.infiniteLives).toBe(true);
    expect(ctx.machine.current?.name).toBe('difficulty-select');
    expect(select.view().menu?.[DIFFICULTIES.length]).toBe('INFINITE LIVES  ON');

    // And back off on a second press — the label follows the live state.
    tap(ctx.machine, Button.Shot);
    expect(ctx.infiniteLives).toBe(false);
    expect(ctx.machine.current?.name).toBe('difficulty-select');
    expect(select.view().menu?.[DIFFICULTIES.length]).toBe('INFINITE LIVES  OFF');
  });

  test('the toggle row carries its own blurb, not a tier', () => {
    const ctx = context();
    const select = new DifficultySelectState(ctx);
    open(ctx.machine, select);
    tap(ctx.machine, Button.Down, 3); // onto the toggle row
    expect(select.view().selected).toBe(DIFFICULTIES.length);
    // Still exactly one blurb line, now the assist's rather than a tier's.
    expect(select.view().lines?.length).toBe(1);
  });

  test('the replay toggle flips in place, persists on context, and starts off', () => {
    const ctx = context();
    const select = new DifficultySelectState(ctx);
    open(ctx.machine, select);
    expect(ctx.recordReplay ?? false).toBe(false);

    // NORMAL (1) down four rows reaches RECORD REPLAY (5).
    tap(ctx.machine, Button.Down, 4);
    expect(select.view().selected).toBe(DIFFICULTIES.length + 1);
    tap(ctx.machine, Button.Shot);

    expect(ctx.recordReplay).toBe(true);
    expect(ctx.machine.current).toBe(select);
    expect(select.view().menu?.[DIFFICULTIES.length + 1]).toBe('RECORD REPLAY  ON');
    expect(select.view().lines).toEqual([
      'save this attempt — clears, failures, quits and retries',
    ]);

    // A fresh setup state reads the same page-session choice.
    expect(new DifficultySelectState(ctx).view().menu?.[DIFFICULTIES.length + 1]).toBe(
      'RECORD REPLAY  ON',
    );
  });

  test('confirming a tier snapshots replay recording into the attempt', () => {
    let sessions = 0;
    const ctx = context({
      beginReplaySession: () => `recorded-${++sessions}`,
    });
    const select = new DifficultySelectState(ctx);
    open(ctx.machine, select);
    tap(ctx.machine, Button.Down, 4); // NORMAL → RECORD REPLAY
    tap(ctx.machine, Button.Shot);    // ON
    tap(ctx.machine, Button.Up, 4);   // RECORD REPLAY → NORMAL
    tap(ctx.machine, Button.Shot);    // → character select
    tap(ctx.machine, Button.Shot);    // → playing

    const playing = ctx.machine.current as PlayingState;
    expect(playing.recordReplay).toBe(true);
    expect(playing.sessionId).toBe('recorded-1');
    expect(playing.view().recording).toBe(true);

    // The active attempt remains armed even if an external shell mutates the
    // setup value before its next stage.
    ctx.recordReplay = false;
    expect(playing.advance()?.recordReplay).toBe(true);
    expect(playing.advance()?.sessionId).toBe('recorded-1');
  });

  test('confirming a tier carries the toggle state into the run config', () => {
    // The whole wire for feature A: difficulty-select toggle → GameContext →
    // RunConfig.infiniteLives on the live run and its recording.
    const ctx = context();
    open(ctx.machine, new DifficultySelectState(ctx));
    tap(ctx.machine, Button.Down, 3); // to the toggle row
    tap(ctx.machine, Button.Shot);    // flip the assist ON
    tap(ctx.machine, Button.Up);      // toggle → LUNATIC
    tap(ctx.machine, Button.Shot);    // confirm LUNATIC → character-select
    expect(ctx.machine.current?.name).toBe('character-select');
    expect(ctx.infiniteLives).toBe(true);

    tap(ctx.machine, Button.Shot);    // → playing
    const playing = ctx.machine.current as PlayingState;
    expect(playing.name).toBe('playing');
    expect(playing.run.config.infiniteLives).toBe(true);
    expect(playing.run.difficulty).toBe('lunatic');
    expect(playing.run.finishRecording().meta?.['infiniteLives']).toBe('true');
  });

  test('the default path leaves the assist off and writes no marker', () => {
    // Confirm a tier without touching the toggle: the run is a plain one and its
    // recording carries no assist key, so every existing replay stays valid.
    const ctx = context();
    open(ctx.machine, new DifficultySelectState(ctx));
    tap(ctx.machine, Button.Shot); // NORMAL, toggle untouched → character-select
    tap(ctx.machine, Button.Shot); // → playing
    const playing = ctx.machine.current as PlayingState;
    expect(playing.run.config.infiniteLives).toBeUndefined();
    expect(playing.run.finishRecording().meta?.['infiniteLives']).toBeUndefined();
    expect(playing.recordReplay).toBe(false);
    expect(playing.sessionId).toBeUndefined();
    expect(playing.view().recording).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Playing and pause                                                   */
/* ------------------------------------------------------------------ */

function startPlaying(ctx: GameContext): PlayingState {
  const playing = new PlayingState(ctx, PILOT);
  ctx.machine.push(playing);
  return playing;
}

describe('playing', () => {
  test('ticking the machine ticks the run', () => {
    const ctx = context();
    const playing = startPlaying(ctx);
    for (let t = 0; t < 30; t++) ctx.machine.tick(Button.Shot);
    expect(playing.run.tickCount).toBe(30);
  });

  test('start pauses, and the run stops advancing', () => {
    const ctx = context();
    const playing = startPlaying(ctx);
    ctx.machine.tick(0);
    tap(ctx.machine, Button.Start);
    expect(ctx.machine.current?.name).toBe('pause');

    const frozen = playing.run.tickCount;
    for (let t = 0; t < 20; t++) ctx.machine.tick(0);
    expect(playing.run.tickCount).toBe(frozen);
  });

  test('pause is drawn over the field it froze', () => {
    const ctx = context();
    startPlaying(ctx);
    ctx.machine.tick(0);
    tap(ctx.machine, Button.Start);
    // Both, bottom-up: the field is still on the stack and still described.
    expect(ctx.machine.views().map((v) => v.kind)).toEqual(['playing', 'pause']);
  });

  test('start resumes, and the press that resumed does not re-pause', () => {
    const ctx = context();
    const playing = startPlaying(ctx);
    ctx.machine.tick(0);
    tap(ctx.machine, Button.Start);
    expect(ctx.machine.current?.name).toBe('pause');

    ctx.machine.tick(Button.Start);
    expect(ctx.machine.current?.name).toBe('playing');

    // Still held on the following tick. Without the edge tracking this would
    // bounce straight back into the pause menu.
    const before = playing.run.tickCount;
    ctx.machine.tick(Button.Start);
    expect(ctx.machine.current?.name).toBe('playing');
    expect(playing.run.tickCount).toBe(before + 1);
  });

  test('pause opens on the frame the player asked to stop on', () => {
    const ctx = context();
    const playing = startPlaying(ctx);
    for (let t = 0; t < 10; t++) ctx.machine.tick(0);
    const stopped = playing.run.tickCount;
    ctx.machine.tick(Button.Start);
    expect(playing.run.tickCount).toBe(stopped);
  });

  test('retry from pause produces a genuinely fresh run', () => {
    const ctx = context();
    const playing = startPlaying(ctx);
    for (let t = 0; t < 120; t++) ctx.machine.tick(Button.Shot);
    ctx.machine.tick(0);
    tap(ctx.machine, Button.Start);

    tap(ctx.machine, Button.Down);
    press(ctx.machine, Button.Shot);

    const restarted = ctx.machine.current as PlayingState;
    expect(restarted.name).toBe('playing');
    expect(restarted).not.toBe(playing);
    expect(restarted.run).not.toBe(playing.run);
    expect(restarted.run.tickCount).toBe(0);
    expect(restarted.run.player.score).toBe(0);
    // The pause menu went with it rather than being left buried.
    expect(ctx.machine.depth).toBe(1);
  });

  test('quitting from pause empties the stack back to the title', () => {
    const saved: Replay[] = [];
    const ctx = context({ onReplay: (replay) => saved.push(replay) });
    startPlaying(ctx);
    ctx.machine.tick(0);
    tap(ctx.machine, Button.Start);
    tap(ctx.machine, Button.Down, 2);
    press(ctx.machine, Button.Shot);

    expect(ctx.machine.depth).toBe(1);
    expect(ctx.machine.current?.name).toBe('title');
    expect(saved).toEqual([]);
  });

  test('recording on saves an exact partial replay when quitting', () => {
    const saved: Array<{ replay: Replay; sessionId?: string }> = [];
    let ids = 0;
    const ctx = context({
      recordReplay: true,
      beginReplaySession: () => `attempt-${++ids}`,
      onReplay: (replay, sessionId) => saved.push({ replay, sessionId }),
    });
    const playing = startPlaying(ctx);
    for (let tick = 0; tick < 37; tick++) ctx.machine.tick(Button.Shot);
    ctx.machine.tick(0);
    tap(ctx.machine, Button.Start);
    const frozen = playing.run.tickCount;
    expect((ctx.machine.current as PauseState).view().menu).toEqual([
      'RESUME',
      'SAVE + RETRY',
      'SAVE + QUIT',
    ]);

    tap(ctx.machine, Button.Down, 2);
    press(ctx.machine, Button.Shot);

    expect(ctx.machine.current?.name).toBe('title');
    expect(saved).toHaveLength(1);
    expect(saved[0]?.sessionId).toBe('attempt-1');
    expect(saved[0]?.replay.length).toBe(frozen);
    expect(saved[0]?.replay.meta?.['outcome']).toBe('playing');
    expect(saved[0]?.replay.meta?.['endReason']).toBe('quit');
    expect(saved[0]?.replay.meta?.['score']).toBe(playing.run.player.score);
    expect(playing.finalizeReplay('quit')).toBeUndefined();
  });

  test('recording on saves RETRIED and gives the fresh attempt a new session', () => {
    const saved: Array<{ replay: Replay; sessionId?: string }> = [];
    let ids = 0;
    const ctx = context({
      recordReplay: true,
      beginReplaySession: () => `attempt-${++ids}`,
      onReplay: (replay, sessionId) => saved.push({ replay, sessionId }),
    });
    const playing = startPlaying(ctx);
    for (let tick = 0; tick < 23; tick++) ctx.machine.tick(Button.Right);
    ctx.machine.tick(0);
    tap(ctx.machine, Button.Start);
    const frozen = playing.run.tickCount;

    tap(ctx.machine, Button.Down);
    press(ctx.machine, Button.Shot);

    const restarted = ctx.machine.current as PlayingState;
    expect(restarted.name).toBe('playing');
    expect(restarted.sessionId).toBe('attempt-2');
    expect(restarted.run.tickCount).toBe(0);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.sessionId).toBe('attempt-1');
    expect(saved[0]?.replay.length).toBe(frozen);
    expect(saved[0]?.replay.meta?.['outcome']).toBe('playing');
    expect(saved[0]?.replay.meta?.['endReason']).toBe('retry');
  });

  test('a pause menu is not transparent — it must not let play continue', () => {
    const ctx = context();
    const playing = startPlaying(ctx);
    const pause = new PauseState(ctx, playing);
    expect(pause.transparent).toBe(false);
  });

  test('one attempt id advances with the campaign, while retry starts a new one', () => {
    let nextId = 0;
    const ctx = context({
      recordReplay: true,
      beginReplaySession: () => `attempt-${++nextId}`,
    });
    const playing = new PlayingState(ctx, PILOT, { stage: PENULTIMATE_STAGE });
    expect(playing.sessionId).toBe('attempt-1');
    expect(playing.advance()?.sessionId).toBe('attempt-1');
    expect(playing.restart().sessionId).toBe('attempt-2');
  });

  test('recording off creates no attempt id', () => {
    let ids = 0;
    const ctx = context({ beginReplaySession: () => `attempt-${++ids}` });
    const playing = new PlayingState(ctx, PILOT, { stage: PENULTIMATE_STAGE });
    expect(playing.recordReplay).toBe(false);
    expect(playing.sessionId).toBeUndefined();
    expect(ids).toBe(0);
  });

  test('the recording producer refuses contradictory finish markers', () => {
    const playing = new PlayingState(
      context({ recordReplay: true }),
      PILOT,
      { stage: REPLAY_STAGE },
    );
    expect(() => playing.finalizeReplay()).toThrow(/unfinished run needs an end reason/);
    while (!playing.run.finished) playing.run.tick(0);
    expect(() => playing.finalizeReplay('quit')).toThrow(
      /finished run cannot have an end reason/,
    );
  });

  test('the pause screenshot action captures without leaving or advancing the run', () => {
    let captures = 0;
    const ctx = context({ onScreenshot: () => captures++ });
    const playing = startPlaying(ctx);
    ctx.machine.tick(0);
    tap(ctx.machine, Button.Start);
    const pause = ctx.machine.current as PauseState;
    expect(pause.view().menu).toEqual([
      'RESUME',
      'TAKE SCREENSHOT',
      'RETRY',
      'QUIT',
    ]);

    const frozen = playing.run.tickCount;
    tap(ctx.machine, Button.Down);
    press(ctx.machine, Button.Shot);
    expect(captures).toBe(1);
    expect(ctx.machine.current).toBe(pause);
    expect(playing.run.tickCount).toBe(frozen);
  });
});

/* ------------------------------------------------------------------ */
/* Endings                                                             */
/* ------------------------------------------------------------------ */

describe('endings', () => {
  /** Exhaust the fixture pilot, then let the machine observe the failed run. */
  function failRun(ctx: GameContext, playing: PlayingState): void {
    while (playing.run.player.alive) {
      playing.run.player.invuln = 0;
      playing.run.player.kill();
    }
    ctx.machine.tick(0);
    // The failure card was pushed by the tick above; arm its edge detector the
    // same way `open()` does for a state pushed outside the machine.
    ctx.machine.tick(0);
  }

  test('a failed run raises game over, over the field it ended on', () => {
    const ctx = context();
    const playing = startPlaying(ctx);
    failRun(ctx, playing);

    expect(playing.run.outcome).toBe('failed');
    expect(ctx.machine.current?.name).toBe('game-over');
    expect(ctx.machine.views().map((v) => v.kind)).toEqual(['playing', 'game-over']);
  });

  test('the recording is handed over exactly once', () => {
    const saved: Replay[] = [];
    const ctx = context({
      recordReplay: true,
      onReplay: (replay) => saved.push(replay),
    });
    const playing = new PlayingState(ctx, PILOT, { stage: REPLAY_STAGE });
    ctx.machine.push(playing);
    while (!playing.run.finished) ctx.machine.tick(0);
    ctx.machine.tick(0);

    expect(saved.length).toBe(1);
    expect(saved[0]?.seed).toBe(ctx.nextSeed());
    expect(saved[0]?.length).toBe(playing.run.tickCount);
    expect(saved[0]?.meta?.['outcome']).toBe('cleared');
    expect(playing.view().recording).toBe(false);
  });

  test('a naturally finished run is not retained while recording is off', () => {
    const saved: Replay[] = [];
    const ctx = context({ onReplay: (replay) => saved.push(replay) });
    const playing = new PlayingState(ctx, PILOT, { stage: REPLAY_STAGE });
    ctx.machine.push(playing);
    while (!playing.run.finished) ctx.machine.tick(0);
    ctx.machine.tick(0);

    expect(playing.recordReplay).toBe(false);
    expect(playing.run.outcome).toBe('cleared');
    expect(saved).toEqual([]);
  });

  test('game over reports what the run achieved', () => {
    const ctx = context();
    const playing = startPlaying(ctx);
    failRun(ctx, playing);

    const view = (ctx.machine.current as GameOverState).view();
    expect(view.title).toBe('GAME OVER');
    expect(view.lines?.[0]).toBe(`score ${playing.run.player.score}`);
  });

  test('retry from game over is a fresh run, not a reset of the old object', () => {
    const ctx = context();
    const playing = startPlaying(ctx);
    failRun(ctx, playing);

    press(ctx.machine, Button.Shot);
    const restarted = ctx.machine.current as PlayingState;

    expect(restarted.name).toBe('playing');
    expect(restarted.run).not.toBe(playing.run);
    expect(restarted.run.tickCount).toBe(0);
    expect(restarted.run.outcome).toBe('playing');
    expect(restarted.run.player.lives).toBe(
      getCharacter(PILOT).player.lives,
    );
    // The card is gone and the old run went with it.
    expect(ctx.machine.depth).toBe(1);
  });

  test('the retried run plays the same as the original did', () => {
    // `nextSeed` is constant in this harness, so a retry is the same run again.
    // If retry leaked any state from the finished run, the two would diverge.
    const ctx = context();
    const first = startPlaying(ctx);
    for (let t = 0; t < 300; t++) ctx.machine.tick(Button.Shot);
    const reference = summary(first.run);

    failRun(ctx, first);
    press(ctx.machine, Button.Shot);
    const second = ctx.machine.current as PlayingState;
    for (let t = 0; t < 300; t++) ctx.machine.tick(Button.Shot);

    expect(summary(second.run)).toEqual(reference);
  });

  test('title from game over empties the stack', () => {
    const ctx = context();
    const playing = startPlaying(ctx);
    failRun(ctx, playing);

    tap(ctx.machine, Button.Down);
    press(ctx.machine, Button.Shot);
    expect(ctx.machine.depth).toBe(1);
    expect(ctx.machine.current?.name).toBe('title');
  });

  test('a cleared run raises the clear card instead', () => {
    const ctx = context();
    const playing = new PlayingState(ctx, PILOT);
    ctx.machine.push(playing);
    // Drive the local fixture through its authored outro.
    for (let t = 0; t < 40000 && !playing.run.finished; t++) {
      ctx.machine.tick(t % 8 === 0 ? 0 : Button.Shot);
    }
    ctx.machine.tick(0);

    expect(playing.run.outcome).toBe('cleared');
    expect(ctx.machine.current?.name).toBe('cleared');
    expect((ctx.machine.current as ClearedState).view().title).toBe('STAGE CLEAR');
  });

  test('an intermediate live clear keeps only campaign actions even when its replay is saved', () => {
    const saved = recordStage(PENULTIMATE_STAGE, 129).replay;
    const session = replaySession([saved], 'active-campaign');
    const ctx = context({
      recordReplay: true,
      beginReplaySession: () => session.id,
      replaySessions: [session],
    });
    const playing = new PlayingState(ctx, PILOT, { stage: PENULTIMATE_STAGE });
    ctx.machine.push(playing);
    for (let tick = 0; tick < 20 && !playing.run.finished; tick++) ctx.machine.tick(0);

    expect(ctx.machine.current).toBeInstanceOf(ClearedState);
    const menu = ctx.machine.current?.view?.().menu;
    expect(menu).toEqual(['NEXT STAGE', 'RETRY', 'TITLE']);
    expect(menu).not.toContain('WATCH REPLAY');
    expect(menu).not.toContain('EXPORT VIDEO');
    expect(menu).not.toContain('DOWNLOAD REPLAY');

    // The compact menu's second row is the live RETRY action, not the replay
    // action that occupied this index before intermediate clears were tightened.
    ctx.machine.tick(0);
    tap(ctx.machine, Button.Down);
    press(ctx.machine, Button.Shot);
    expect(ctx.machine.current).toBeInstanceOf(PlayingState);
    expect((ctx.machine.current as PlayingState).run.stageName).toBe(PENULTIMATE_STAGE);
  });

  test('a complete terminal result offers whole-campaign watch and export', () => {
    const first = recordStage(PENULTIMATE_STAGE, 147);
    const final = recordStage(FINAL_STAGE, 148, () => 0, first.run.carry);
    const session = replaySession([first.replay, final.replay], 'complete-campaign');
    const ctx = campaignContext({
      recordReplay: true,
      beginReplaySession: () => session.id,
      replaySessions: [session],
    });
    const playing = new PlayingState(ctx, PILOT, {
      stage: FINAL_STAGE,
      recordReplay: true,
      sessionId: session.id,
    });
    ctx.machine.push(playing);
    const result = new ClearedState(ctx, playing);
    open(ctx.machine, result);

    expect(result.view().menu?.slice(0, 3)).toEqual([
      'WATCH FULL CAMPAIGN',
      'EXPORT FULL CAMPAIGN VIDEO',
      'DOWNLOAD REPLAY DATA',
    ]);
    tap(ctx.machine, Button.Down);
    press(ctx.machine, Button.Shot);
    const exporting = ctx.machine.current as ReplayExportState;
    expect(exporting).toBeInstanceOf(ReplayExportState);
    expect(exporting.sessionWide).toBe(true);
    expect(exporting.sessionKind).toBe('full-campaign');
  });

  test('a cleared stage and later quit share one recorded campaign session', () => {
    const saved: Array<{ replay: Replay; sessionId?: string }> = [];
    let ids = 0;
    const ctx = context({
      recordReplay: true,
      beginReplaySession: () => `campaign-${++ids}`,
      onReplay: (replay, sessionId) => saved.push({ replay, sessionId }),
    });
    const first = new PlayingState(ctx, PILOT, { stage: RECORDING_PENULTIMATE_STAGE });
    ctx.machine.push(first);
    for (let tick = 0; tick < 20 && !first.run.finished; tick++) ctx.machine.tick(0);

    expect(ctx.machine.current?.name).toBe('cleared');
    expect(saved).toHaveLength(1);
    expect(saved[0]?.sessionId).toBe('campaign-1');
    expect(saved[0]?.replay.meta?.['outcome']).toBe('cleared');

    ctx.machine.tick(0); // arm the clear card's edge detector
    press(ctx.machine, Button.Shot); // NEXT STAGE
    const second = ctx.machine.current as PlayingState;
    expect(second.name).toBe('playing');
    expect(second.sessionId).toBe('campaign-1');
    expect(ids).toBe(1);

    ctx.machine.tick(0);
    tap(ctx.machine, Button.Start);
    tap(ctx.machine, Button.Down, 2);
    press(ctx.machine, Button.Shot);

    expect(ctx.machine.current?.name).toBe('title');
    expect(saved).toHaveLength(2);
    expect(saved[1]?.sessionId).toBe('campaign-1');
    expect(saved[1]?.replay.meta?.['endReason']).toBe('quit');
  });

  test('an assist run is marked on the results screen; a plain run is not', () => {
    // The marker is a property of how the run was configured — shown wherever a
    // result is — so it can be read off the ending card's own view lines without
    // driving a whole run to its natural end.
    const assistCtx = context({ infiniteLives: true });
    const assisted = new PlayingState(assistCtx, PILOT);
    expect(new ClearedState(assistCtx, assisted).view().lines).toContain('assist — infinite lives');
    expect(new GameOverState(assistCtx, assisted).view().lines).toContain('assist — infinite lives');

    const plainCtx = context();
    const plain = new PlayingState(plainCtx, PILOT);
    expect(new ClearedState(plainCtx, plain).view().lines).not.toContain('assist — infinite lives');
  });
});

/* ------------------------------------------------------------------ */
/* The ending                                                          */
/* ------------------------------------------------------------------ */

describe('the ending', () => {
  /**
   * Drive an empty stage to its clear through the machine, then give the pushed
   * ending/clear card one idle tick so its `Edges` first-update suppression is
   * spent — the same settling tick the real loop provides, and what lets the taps
   * that follow register as edges rather than vanishing into the suppressed update.
   */
  function clearRun(ctx: GameContext, playing: PlayingState): void {
    for (let t = 0; t < 4000 && !playing.run.finished; t++) ctx.machine.tick(Button.Shot);
    ctx.machine.tick(0);
  }

  test('clearing a stage with a next raises the clear card, unchanged', () => {
    const ctx = context();
    const playing = new PlayingState(ctx, PILOT, { stage: PENULTIMATE_STAGE });
    ctx.machine.push(playing);
    clearRun(ctx, playing);

    expect(playing.run.outcome).toBe('cleared');
    expect(ctx.machine.current?.name).toBe('cleared');
    expect((ctx.machine.current as ClearedState).view().title).toBe('STAGE CLEAR');
  });

  test('clearing a terminal stage with matching edition data raises the ending screen', () => {
    const ctx = context();
    const playing = new PlayingState(ctx, PILOT, { stage: FINAL_STAGE });
    ctx.machine.push(playing);
    clearRun(ctx, playing);

    expect(playing.run.outcome).toBe('cleared');
    expect(ctx.machine.current?.name).toBe('ending');
    // Drawn over the field it ended on: both are on the stack, bottom-up.
    expect(ctx.machine.views().map((v) => v.kind)).toEqual(['playing', 'ending']);
  });

  test('a terminal stage with no owned ending goes straight to neutral ALL CLEAR', () => {
    const ctx = context();
    const playing = new PlayingState(ctx, PILOT, { stage: UNAUTHORED_FINAL_STAGE });
    ctx.machine.push(playing);
    clearRun(ctx, playing);

    expect(playing.run.outcome).toBe('cleared');
    expect(ctx.machine.current?.name).toBe('cleared');
    expect((ctx.machine.current as ClearedState).view().title).toBe('ALL CLEAR');
    expect(ctx.machine.views().map((v) => v.kind)).toEqual(['playing', 'cleared']);
  });

  test('CONFIRM pages through the ending and then shows the ALL CLEAR results', () => {
    const ctx = context();
    const playing = new PlayingState(ctx, PILOT, { stage: FINAL_STAGE });
    ctx.machine.push(playing);
    clearRun(ctx, playing);

    const ending = ctx.machine.current as EndingScreenState;
    expect(ending.name).toBe('ending');

    // The generic state assigns no semantics to the three pages. It selects the
    // pilot-specific second page and preserves the authored blank in the third;
    // the third CONFIRM exits to the results screen.
    const opening = ending.view();
    expect(opening.lines).toEqual(['test opening one', 'test opening two']);
    expect(opening.character).toBe(PILOT);
    expect(opening.endingPage?.index).toBe(0);
    expect(opening.endingPage?.count).toBe(3);
    expect(opening.endingPage?.age).toBe(opening.age);

    // Page age is reset on the exact press tick. This is the deterministic
    // starting point for a renderer's page-to-page transition.
    press(ctx.machine, Button.Shot);
    const middle = (ctx.machine.current as EndingScreenState).view();
    expect(middle.lines).toEqual(['test pilot coda']);
    expect(middle.endingPage).toEqual({ index: 1, count: 3, age: 0 });
    ctx.machine.tick(0);

    press(ctx.machine, Button.Shot);
    const closing = (ctx.machine.current as EndingScreenState).view();
    expect(closing.lines).toEqual([
      'test closing one',
      '',
      'test closing two',
    ]);
    expect(closing.endingPage).toEqual({ index: 2, count: 3, age: 0 });
    ctx.machine.tick(0);

    // The last page's CONFIRM replaces the ending with the results card — still a
    // `cleared` screen, ALL CLEAR because this stage had no next, with the run's
    // score intact and the field still beneath it.
    tap(ctx.machine, Button.Shot);
    expect(ctx.machine.current?.name).toBe('cleared');
    const cleared = ctx.machine.current as ClearedState;
    expect(cleared.view().title).toBe('ALL CLEAR');
    expect(cleared.view().lines?.[0]).toBe(`score ${playing.run.player.score}`);
    expect(ctx.machine.views().map((v) => v.kind)).toEqual(['playing', 'cleared']);
  });

  test('an assist run carries its marker onto the ALL CLEAR results after the ending', () => {
    const ctx = context({ infiniteLives: true });
    const playing = new PlayingState(ctx, PILOT, { stage: FINAL_STAGE });
    ctx.machine.push(playing);
    clearRun(ctx, playing);

    // Page through all three pages to the results card.
    tap(ctx.machine, Button.Shot, 3);
    expect(ctx.machine.current?.name).toBe('cleared');
    expect((ctx.machine.current as ClearedState).view().lines).toContain(
      'assist — infinite lives',
    );
  });

  test('the ending exposes its edition-owned music and scene to the shell', () => {
    const ctx = context();
    const playing = new PlayingState(ctx, PILOT, { stage: FINAL_STAGE });
    ctx.machine.push(playing);
    clearRun(ctx, playing);

    const ending = ctx.machine.current as { music?: string; scene?: string };
    expect(ending.music).toBe('test-ending-music');
    expect(ending.scene).toBe('test-ending-scene');
  });

  test('an unlisted character receives the page fallback', () => {
    const ctx = context();
    const playing = new PlayingState(ctx, PACK_CHARACTER, { stage: FINAL_STAGE });
    ctx.machine.push(playing);
    clearRun(ctx, playing);

    tap(ctx.machine, Button.Shot);
    expect((ctx.machine.current as EndingScreenState).view().lines).toEqual([
      'test fallback coda',
    ]);
  });
});

function summary(run: Run): Record<string, number> {
  return {
    tick: run.tickCount,
    score: run.player.score,
    graze: run.player.graze,
    lives: run.player.lives,
    bullets: run.bullets.count,
    enemies: run.enemies.count,
  };
}
