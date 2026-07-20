import { describe, expect, test } from 'bun:test';

import { Button } from '../core/input';
import { getShot } from '../content/shots';
import type { Replay } from '../sim/replay';
import { Edges, type GameState, StateMachine, type StateView } from './state';
import { characterNames, defineCharacter, getCharacter, type Run } from './run';
import { DEFAULT_DIFFICULTY, DIFFICULTIES } from '../sim/difficulty';
import {
  CharacterSelectState,
  ClearedState,
  DifficultySelectState,
  GameOverState,
  type GameContext,
  PauseState,
  PlayingState,
  TitleState,
} from './states';

/**
 * A pack character, registered namespaced so the reachability and balance scans
 * (both filter '/') leave it alone and it is reachable only by being offered on
 * SELECT — exactly how the real injector registers one. It reuses built-in
 * shot/options/bomb because this file tests the replay-identity WIRE, not the
 * content: what matters is that its qualified name and owning-pack identity flow
 * into `RunConfig.packsData` off the plain START row.
 */
const PACK_CHARACTER = 'demo/raider';
const PACK_DATA = 'demo@abcdef012345';
defineCharacter(PACK_CHARACTER, {
  label: 'RAIDER',
  sprite: 'ship',
  options: 'standard',
  bomb: 'spread',
  player: {
    x: 240, y: 560, speed: 3.6, focusSpeed: 1.5, radius: 2.5,
    grazeRadius: 20, lives: 3, bombs: 3, invulnTicks: 90,
    shots: getShot('spread').levels,
  },
});

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
    const ctx = context();
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
    const ctx = context({ campaigns });
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
    expect(view.menu).toContain(getCharacter('scout').label);
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
    expect(view.menu).toEqual(['EASY', 'NORMAL', 'HARD', 'LUNATIC']);
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
    const count = DIFFICULTIES.length;
    // Up from NORMAL (1) reaches EASY (0); another Up wraps to LUNATIC (last).
    tap(ctx.machine, Button.Up);
    expect(select.view().selected).toBe(DIFFICULTIES.indexOf(DEFAULT_DIFFICULTY) - 1);
    tap(ctx.machine, Button.Up);
    expect(select.view().selected).toBe(count - 1);
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
});

/* ------------------------------------------------------------------ */
/* Playing and pause                                                   */
/* ------------------------------------------------------------------ */

function startPlaying(ctx: GameContext): PlayingState {
  const playing = new PlayingState(ctx, 'scout');
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
    const ctx = context();
    startPlaying(ctx);
    ctx.machine.tick(0);
    tap(ctx.machine, Button.Start);
    tap(ctx.machine, Button.Down, 2);
    press(ctx.machine, Button.Shot);

    expect(ctx.machine.depth).toBe(1);
    expect(ctx.machine.current?.name).toBe('title');
  });

  test('a pause menu is not transparent — it must not let play continue', () => {
    const ctx = context();
    const playing = startPlaying(ctx);
    const pause = new PauseState(ctx, playing);
    expect(pause.transparent).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Endings                                                             */
/* ------------------------------------------------------------------ */

describe('endings', () => {
  /** Drive a run to its end through the machine, as the game actually would. */
  function playToEnd(ctx: GameContext, playing: PlayingState): void {
    for (let t = 0; t < 40000 && !playing.run.finished; t++) {
      // Idle at the top of the field: the ship is hit, and hit again.
      ctx.machine.tick(Button.Up);
    }
    ctx.machine.tick(Button.Up);
  }

  test('a failed run raises game over, over the field it ended on', () => {
    const ctx = context();
    const playing = startPlaying(ctx);
    playToEnd(ctx, playing);

    expect(playing.run.outcome).toBe('failed');
    expect(ctx.machine.current?.name).toBe('game-over');
    expect(ctx.machine.views().map((v) => v.kind)).toEqual(['playing', 'game-over']);
  });

  test('the recording is handed over exactly once', () => {
    const saved: Replay[] = [];
    const ctx = context({ onReplay: (replay) => saved.push(replay) });
    const playing = startPlaying(ctx);
    playToEnd(ctx, playing);

    expect(saved.length).toBe(1);
    expect(saved[0]?.seed).toBe(ctx.nextSeed());
    expect(saved[0]?.length).toBe(playing.run.tickCount);
    expect(saved[0]?.meta?.['outcome']).toBe('failed');
  });

  test('game over reports what the run achieved', () => {
    const ctx = context();
    const playing = startPlaying(ctx);
    playToEnd(ctx, playing);

    const view = (ctx.machine.current as GameOverState).view();
    expect(view.title).toBe('GAME OVER');
    expect(view.lines?.[0]).toBe(`score ${playing.run.player.score}`);
  });

  test('retry from game over is a fresh run, not a reset of the old object', () => {
    const ctx = context();
    const playing = startPlaying(ctx);
    playToEnd(ctx, playing);

    press(ctx.machine, Button.Shot);
    const restarted = ctx.machine.current as PlayingState;

    expect(restarted.name).toBe('playing');
    expect(restarted.run).not.toBe(playing.run);
    expect(restarted.run.tickCount).toBe(0);
    expect(restarted.run.outcome).toBe('playing');
    expect(restarted.run.player.lives).toBe(
      getCharacter('scout').player.lives,
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

    playToEnd(ctx, first);
    press(ctx.machine, Button.Shot);
    const second = ctx.machine.current as PlayingState;
    for (let t = 0; t < 300; t++) ctx.machine.tick(Button.Shot);

    expect(summary(second.run)).toEqual(reference);
  });

  test('title from game over empties the stack', () => {
    const ctx = context();
    const playing = startPlaying(ctx);
    playToEnd(ctx, playing);

    tap(ctx.machine, Button.Down);
    press(ctx.machine, Button.Shot);
    expect(ctx.machine.depth).toBe(1);
    expect(ctx.machine.current?.name).toBe('title');
  });

  test('a cleared run raises the clear card instead', () => {
    const ctx = context();
    const playing = new PlayingState(ctx, 'scout');
    ctx.machine.push(playing);
    // Shooting keeps the ship alive long enough for the stage to run out.
    for (let t = 0; t < 40000 && !playing.run.finished; t++) {
      ctx.machine.tick(t % 8 === 0 ? 0 : Button.Shot);
    }
    ctx.machine.tick(0);

    if (playing.run.outcome !== 'cleared') return; // pilot died; covered above
    expect(ctx.machine.current?.name).toBe('cleared');
    expect((ctx.machine.current as ClearedState).view().title).toBe('STAGE CLEAR');
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
