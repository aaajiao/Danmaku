/**
 * The screens, built on the stack in `state.ts`.
 *
 * Every state here describes what should be on screen as data and nothing else.
 * There is no three.js in this file and there must never be: a state that
 * reached for a renderer could not be driven in a test, and the states are where
 * "retry produces a genuinely fresh run" either holds or quietly stops holding.
 *
 * Text is placeholder. These are labels — screen furniture — not dialogue, which
 * is out of scope by the owner's decision.
 *
 * ## Why states hold the machine
 *
 * `GameState.tick` returns nothing, so a state changes screens by asking the
 * machine directly. Returning "the next state" can express one transition and no
 * others: not "push an overlay and keep the world beneath", not "pop two", not
 * "clear everything and start again". The transitions are deferred by the
 * machine, so a state calling `pop()` on itself finishes its own tick first.
 */

import { Button } from '../core/input';
import type { Replay } from '../sim/replay';
import { Edges, type GameState, type StateMachine, type StateView } from './state';
import { characterNames, getCharacter, Run } from './run';

/**
 * What every state needs and none of them should construct for itself.
 *
 * `nextSeed` is injected rather than read from a clock, which is the difference
 * between a game whose runs are reproducible and one whose runs merely happen to
 * be. `main.ts` can hand it a clock; a test hands it a constant and gets the
 * same run every time without the states knowing which is which.
 */
export interface GameContext {
  readonly machine: StateMachine;
  /** Seed for the next run. */
  nextSeed(): number;
  /** Stage every run plays. Defaults to the engine's own starter stage. */
  stage?: string;
  /** Boss sent once the stage script runs out. */
  boss?: string;
  /** Handed the recording when a run ends. */
  onReplay?(replay: Replay): void;
}

/** Buttons that mean "yes" everywhere. Start alone is not enough on a menu. */
const CONFIRM = Button.Start | Button.Shot;
const CANCEL = Button.Bomb;

/* ------------------------------------------------------------------ */
/* Menu                                                                */
/* ------------------------------------------------------------------ */

/**
 * Shared cursor for the menu screens.
 *
 * A base class rather than four copies of the same three lines, and it is worth
 * one because the wrapping is the part that gets written wrong: a bare `%` on a
 * decrement gives -1 in JavaScript, so pressing Up on the first entry lands on
 * nothing and the menu looks broken only at one edge.
 */
abstract class MenuState implements GameState {
  abstract readonly name: string;

  protected readonly edges = new Edges();
  protected selected = 0;

  protected constructor(protected readonly ctx: GameContext) {}

  protected abstract get entries(): readonly string[];
  protected abstract confirm(index: number): void;

  /** Cancel is optional: a title screen has nothing to back out to. */
  protected cancel(): void {}

  /**
   * Hook for a state with a button that outranks the cursor. Return true to
   * consume the tick.
   *
   * A hook rather than an override of `tick`, because the mask must be fed to
   * `Edges` exactly once per tick: a subclass that updated and then delegated
   * would compare the mask against itself, and every edge would read as false.
   */
  protected intercept(): boolean {
    return false;
  }

  tick(buttons: number): void {
    this.edges.update(buttons);
    if (this.intercept()) return;

    const count = this.entries.length;
    if (count > 0) {
      // Vertical and horizontal both move the cursor. Which axis a menu "is"
      // depends on how it is drawn, and the states do not draw themselves.
      const back = this.edges.pressed(Button.Up) || this.edges.pressed(Button.Left);
      const forward =
        this.edges.pressed(Button.Down) || this.edges.pressed(Button.Right);
      if (back) this.selected = (this.selected + count - 1) % count;
      if (forward) this.selected = (this.selected + 1) % count;
    }

    if (this.edges.pressed(CONFIRM)) {
      this.confirm(this.selected);
      return;
    }
    if (this.edges.pressed(CANCEL)) this.cancel();
  }

  enter(): void {
    // A state entered on the tick a button went down must not read that press
    // as its own. `Edges` suppresses its first update; re-arming here makes a
    // reused instance behave like a fresh one.
    this.edges.reset();
  }

  abstract view(): StateView;
}

/* ------------------------------------------------------------------ */
/* Title                                                               */
/* ------------------------------------------------------------------ */

export class TitleState extends MenuState {
  readonly name = 'title';

  constructor(ctx: GameContext) {
    super(ctx);
  }

  protected get entries(): readonly string[] {
    return ['START'];
  }

  protected confirm(): void {
    this.ctx.machine.replace(new CharacterSelectState(this.ctx));
  }

  view(): StateView {
    return {
      kind: 'title',
      title: 'DANMAKU',
      lines: ['press start'],
      menu: this.entries,
      selected: this.selected,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Character select                                                    */
/* ------------------------------------------------------------------ */

/**
 * Reads the character registry, so a character added in a new file appears here
 * without this state being told. That seam is the reason this screen exists at
 * one entry as readily as at six.
 */
export class CharacterSelectState extends MenuState {
  readonly name = 'character-select';

  constructor(ctx: GameContext) {
    super(ctx);
  }

  protected get entries(): readonly string[] {
    return characterNames().map((name) => getCharacter(name).label);
  }

  protected confirm(index: number): void {
    const name = characterNames()[index];
    if (name === undefined) return;
    this.ctx.machine.replace(new PlayingState(this.ctx, name));
  }

  protected override cancel(): void {
    this.ctx.machine.replace(new TitleState(this.ctx));
  }

  view(): StateView {
    const name = characterNames()[this.selected];
    const spec = name === undefined ? undefined : getCharacter(name);
    return {
      kind: 'character-select',
      title: 'SELECT',
      lines: spec?.blurb === undefined ? [] : [spec.blurb],
      menu: this.entries,
      selected: this.selected,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Playing                                                             */
/* ------------------------------------------------------------------ */

export class PlayingState implements GameState {
  readonly name = 'playing';
  readonly run: Run;
  readonly characterName: string;

  readonly #ctx: GameContext;
  readonly #edges = new Edges();

  /** The recording is taken once, on the tick the run ends. */
  #recorded = false;

  constructor(ctx: GameContext, characterName: string, seed?: number) {
    this.#ctx = ctx;
    this.characterName = characterName;
    this.run = new Run({
      seed: seed ?? ctx.nextSeed(),
      character: characterName,
      ...(ctx.stage === undefined ? {} : { stage: ctx.stage }),
      ...(ctx.boss === undefined ? {} : { boss: ctx.boss }),
    });
  }

  tick(buttons: number): void {
    this.#edges.update(buttons);

    // Pause before the run advances, so the frame the player asked to stop on
    // is the frame they are looking at.
    if (this.#edges.pressed(Button.Start) && !this.run.finished) {
      this.#ctx.machine.push(new PauseState(this.#ctx, this));
      return;
    }

    this.run.tick(buttons);
    if (!this.run.finished) return;

    this.#finish();
  }

  #finish(): void {
    if (this.#recorded) return;
    this.#recorded = true;
    this.#ctx.onReplay?.(this.run.finishRecording());

    // Pushed, not replaced: the ending screen is drawn over the field the run
    // ended on, and the machine renders the whole stack. Replacing would leave
    // a game-over card floating on nothing.
    const ending =
      this.run.outcome === 'cleared'
        ? new ClearedState(this.#ctx, this)
        : new GameOverState(this.#ctx, this);
    this.#ctx.machine.push(ending);
  }

  /** A genuinely fresh run — new seed, nothing carried. */
  restart(): PlayingState {
    return new PlayingState(this.#ctx, this.characterName);
  }

  view(): StateView {
    return { kind: 'playing', run: this.run };
  }
}

/* ------------------------------------------------------------------ */
/* Pause                                                               */
/* ------------------------------------------------------------------ */

/**
 * Not `transparent`: `transparent` means "the state below keeps *ticking*", and
 * a pause menu that let play continue would not be one. It is still drawn over
 * the live field, because the machine renders the whole stack regardless — the
 * two axes are deliberately separate. See `state.ts`.
 */
export class PauseState extends MenuState {
  readonly name = 'pause';
  readonly transparent = false;

  readonly #playing: PlayingState;

  constructor(ctx: GameContext, playing: PlayingState) {
    super(ctx);
    this.#playing = playing;
  }

  protected get entries(): readonly string[] {
    return ['RESUME', 'RETRY', 'QUIT'];
  }

  protected confirm(index: number): void {
    const machine = this.ctx.machine;
    switch (index) {
      case 0:
        machine.pop();
        return;
      case 1:
        // Queued in order: the pause leaves first, then the run beneath it is
        // swapped for a new one. Doing it the other way round would replace the
        // pause menu with a run and leave the old one buried under it.
        machine.pop();
        machine.replace(this.#playing.restart());
        return;
      default:
        machine.clear();
        machine.push(new TitleState(this.ctx));
    }
  }

  protected override cancel(): void {
    this.ctx.machine.pop();
  }

  protected override intercept(): boolean {
    // Start resumes as well as confirming, so the button that paused unpauses.
    // Ahead of the menu, or Start would confirm whatever is under the cursor.
    if (!this.edges.pressed(Button.Start)) return false;
    this.ctx.machine.pop();
    return true;
  }

  view(): StateView {
    return {
      kind: 'pause',
      title: 'PAUSED',
      menu: this.entries,
      selected: this.selected,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Endings                                                             */
/* ------------------------------------------------------------------ */

abstract class EndingState extends MenuState {
  protected readonly playing: PlayingState;

  protected constructor(ctx: GameContext, playing: PlayingState) {
    super(ctx);
    this.playing = playing;
  }

  protected get entries(): readonly string[] {
    return ['RETRY', 'TITLE'];
  }

  protected confirm(index: number): void {
    const machine = this.ctx.machine;
    if (index === 0) {
      // Pop this card, then swap the finished run for a brand new one. `Run`
      // is not reused: a retry that inherited a single counter would be a run
      // its own seed no longer describes.
      machine.pop();
      machine.replace(this.playing.restart());
      return;
    }
    machine.clear();
    machine.push(new TitleState(this.ctx));
  }

  protected scoreLines(): readonly string[] {
    const { player } = this.playing.run;
    return [
      `score ${player.score}`,
      `graze ${player.graze}`,
      `deaths ${player.deathCount}`,
    ];
  }
}

export class GameOverState extends EndingState {
  readonly name = 'game-over';

  constructor(ctx: GameContext, playing: PlayingState) {
    super(ctx, playing);
  }

  view(): StateView {
    return {
      kind: 'game-over',
      title: 'GAME OVER',
      lines: this.scoreLines(),
      menu: this.entries,
      selected: this.selected,
    };
  }
}

export class ClearedState extends EndingState {
  readonly name = 'cleared';

  constructor(ctx: GameContext, playing: PlayingState) {
    super(ctx, playing);
  }

  view(): StateView {
    return {
      kind: 'cleared',
      title: 'STAGE CLEAR',
      lines: this.scoreLines(),
      menu: this.entries,
      selected: this.selected,
    };
  }
}
