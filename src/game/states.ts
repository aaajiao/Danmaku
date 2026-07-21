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
import { getStage } from '../content/stage';
import { DEFAULT_DIFFICULTY, DIFFICULTIES, type Difficulty } from '../sim/difficulty';
import type { Replay } from '../sim/replay';
import { Edges, type GameState, type StateMachine, type StateView } from './state';
import { characterNames, getCharacter, Run, type PlayerCarry } from './run';

/**
 * What every state needs and none of them should construct for itself.
 *
 * `nextSeed` is injected rather than read from a clock, which is the difference
 * between a game whose runs are reproducible and one whose runs merely happen to
 * be. `main.ts` can hand it a clock; a test hands it a constant and gets the
 * same run every time without the states knowing which is which.
 */
/**
 * One selectable campaign, all plain data.
 *
 * `stage` is the qualified entry-stage name (`<pack>/<entry>`) the run starts
 * on; `packsData` is the entering pack's `name@hash`, recorded strictly into
 * replay meta (see `RunConfig.packsData`). The identity travels on the campaign,
 * not on the context, because that is what lets the plain START row record `''`:
 * a run only carries a pack's identity when it entered that pack's campaign.
 *
 * Declared here rather than imported from `src/packs`, because `src/game` must
 * not import that tree at all (`architecture.test.ts` enforces it). A campaign
 * crosses the boundary as this flat record; the shell fills it, the game reads
 * it, and neither side learns what a pack is.
 */
export interface Campaign {
  /** Menu row label. */
  readonly label: string;
  /** Qualified entry stage (`<pack>/<entry>`) the run plays. */
  readonly stage: string;
  /** Entering pack's identity (`name@hash`), for `RunConfig.packsData`. */
  readonly packsData: string;
}

/**
 * A pack character and the identity of the pack that owns it, all plain data.
 *
 * A pack character (`<pack>/<name>`) drives the simulation with pack content —
 * its pack shot, option and bomb fire different bullets — even when flown off
 * the plain START row rather than a campaign. A campaign arms `packsData` when
 * chosen; this is the one path a campaign row does not cover, so the identity
 * rides the character too, and `CharacterSelectState` arms `packsData` from it
 * when a namespaced character is confirmed. Without this a replay flown with a
 * pack character records `packsData ''` and plays back under different content.
 *
 * Declared here, not imported from `src/packs`, for the same reason `Campaign`
 * is: `src/game` must not import that tree. The shell fills it; the game reads it.
 */
export interface CharacterPack {
  /** Qualified character name (`<pack>/<name>`) as registered. */
  readonly character: string;
  /** Owning pack's identity (`name@hash`), for `RunConfig.packsData`. */
  readonly packsData: string;
}

export interface GameContext {
  readonly machine: StateMachine;
  /** Seed for the next run. */
  nextSeed(): number;
  /** Stage every run plays. Defaults to the engine's own starter stage. */
  stage?: string;
  /** Boss sent once the stage script runs out. */
  boss?: string;
  /**
   * Identity of the resource packs loaded for this run, as a plain string
   * (`name@hash` pairs comma-joined, or unset when none). `main.ts` sets it
   * from the loader; forwarded into `RunConfig.packs` so `finishRecording`
   * records what was active. A string by contract — `src/game` never learns
   * what a pack is (see `RunConfig.packs`).
   */
  packs?: string;
  /**
   * Identity of the data pack whose campaign this run entered (`name@hash`),
   * armed by `TitleState` when a campaign row is chosen and forwarded into
   * `RunConfig.packsData`. Unset for a built-in run, so it records `''` — a
   * data pack changes the simulation, and that mismatch REFUSES a replay where
   * `packs` only warns (see `RunConfig.packsData`).
   */
  packsData?: string;
  /**
   * Campaigns offered under START on the title screen — one per pack entry
   * stage, empty or unset for a built-in-only build. `main.ts` fills it from
   * the loader as plain data. Empty means today's menu, exactly.
   */
  campaigns?: readonly Campaign[];
  /**
   * The pack characters this build registered and the identity of the pack that
   * owns each — one entry per `<pack>/<name>` character on the SELECT screen,
   * empty or unset for a built-in-only build. `main.ts` fills it from the loader
   * as plain data (mirroring `campaigns`). `CharacterSelectState` reads it to arm
   * strict `packsData` when a pack character is flown off the plain START row.
   */
  characterPacks?: readonly CharacterPack[];
  /**
   * The difficulty tier chosen on the DIFFICULTY screen, forwarded into
   * `RunConfig.difficulty`. Unset means the run defaults to Normal — the value
   * `DifficultySelectState` lands here by default, and the value a shell that
   * skips the screen entirely (a test, a debug launch) leaves it at.
   */
  difficulty?: Difficulty;
  /**
   * The infinite-lives assist, toggled on the DIFFICULTY screen and forwarded
   * into `RunConfig.infiniteLives`. Unset means off — the default the screen
   * lands and a shell that skips it (a test, a debug launch) leaves.
   */
  infiniteLives?: boolean;
  /**
   * Fingerprint of the bundled base content, forwarded into
   * `RunConfig.contentFingerprint`. `main.ts` sets it from the generated pack
   * constant; a string by contract, like `packs` (see `RunConfig.contentFingerprint`).
   * Unset for a shell that opted out — nothing is recorded and nothing is checked.
   */
  contentFingerprint?: string;
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

  /**
   * The UI sound the shell plays for this tick's action, or undefined for none.
   * Set at the semantic move/confirm/cancel below and cleared once, at the top
   * of `tick` — one place, so it can never be left stale into a later frame. A
   * string the game names and the shell resolves (see `game/cues.ts` and rule:
   * `src/game` imports no audio). Public so `main.ts` can read it off the state
   * that ticked; the reachability probe reads it the same way.
   */
  cue?: string;

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
    // Clear last tick's cue here — the one place it is cleared, so it never
    // leaks into a frame where nothing happened (the foot-gun a per-site clear
    // would be). Set again below only on an actual move/confirm/cancel.
    this.cue = undefined;

    this.edges.update(buttons);
    if (this.intercept()) return;

    const count = this.entries.length;
    if (count > 0) {
      // Vertical and horizontal both move the cursor. Which axis a menu "is"
      // depends on how it is drawn, and the states do not draw themselves.
      const back = this.edges.pressed(Button.Up) || this.edges.pressed(Button.Left);
      const forward =
        this.edges.pressed(Button.Down) || this.edges.pressed(Button.Right);
      if (count > 1 && (back || forward)) this.cue = 'ui-move';
      if (back) this.selected = (this.selected + count - 1) % count;
      if (forward) this.selected = (this.selected + 1) % count;
    }

    if (this.edges.pressed(CONFIRM)) {
      // Set before `confirm`, which usually transitions this state away — the
      // shell reads the cue off this same object afterwards regardless.
      this.cue = 'ui-confirm';
      this.confirm(this.selected);
      return;
    }
    if (this.edges.pressed(CANCEL)) {
      this.cue = 'ui-cancel';
      this.cancel();
    }
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
    // START, then one row per campaign. An empty (or unset) list spreads to
    // nothing, so a built-in-only build renders `['START']` byte-identically.
    return ['START', ...(this.ctx.campaigns ?? []).map((c) => c.label)];
  }

  protected confirm(index: number): void {
    // Row 0 is START: it steers nothing, so `ctx.stage`/`ctx.packsData` are
    // left exactly as they were and a built-in run records `packsData: ''`.
    // Every later row is a campaign (index - 1 into the list); selecting one
    // arms both the qualified stage and the entering pack's identity before the
    // normal character-select flow, the same way a boss override is left on the
    // context to steer the run that starts later.
    const campaign = (this.ctx.campaigns ?? [])[index - 1];
    if (campaign !== undefined) {
      this.ctx.stage = campaign.stage;
      this.ctx.packsData = campaign.packsData;
    }
    // The tier screen sits between here and character select — the genre's
    // order — and applies to campaign rows as much as to START, since it steers
    // only `ctx.difficulty` and leaves the stage the campaign just armed alone.
    this.ctx.machine.replace(new DifficultySelectState(this.ctx));
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
/* Difficulty select                                                   */
/* ------------------------------------------------------------------ */

/** Short forms shown on the menu, in the tier order `DIFFICULTIES` declares. */
const DIFFICULTY_LABELS: Readonly<Record<Difficulty, string>> = {
  easy: 'EASY',
  normal: 'NORMAL',
  hard: 'HARD',
  lunatic: 'LUNATIC',
};

/** One-line descriptions, the genre's traditional register kept brief. */
const DIFFICULTY_BLURBS: Readonly<Record<Difficulty, string>> = {
  easy: 'fewer bullets, wider gaps — room to learn',
  normal: 'the fight as it is authored',
  hard: 'denser fire, tighter gaps',
  lunatic: 'the densest curtain, and cards only it will show',
};

/**
 * The assist toggle row, shown beneath the tiers. The label carries its own
 * state (`OFF`/`ON`) the way a tier label carries its name, so the menu reads it
 * without a second widget. The blurb is in the tiers' register, kept brief.
 */
const INFINITE_LIVES_OFF = 'INFINITE LIVES  OFF';
const INFINITE_LIVES_ON = 'INFINITE LIVES  ON';
const INFINITE_LIVES_BLURB = 'deaths never end the run — a mark on the score says so';

/**
 * The tier screen, between title and character select.
 *
 * Mirrors `CharacterSelectState`'s construction exactly — a menu read from data,
 * a blurb line for the cursor, `confirm` resolving an index to a value it lands
 * on the context, then `replace` onward. The one deliberate difference is the
 * cursor: it opens on NORMAL rather than the first row, so the tier is chosen
 * without moving the cursor.
 *
 * This screen adds one confirm to the default path — title → difficulty →
 * character → play is three presses, where it was two before the tier axis
 * existed. Each screen advances on a press *edge* (`edges.pressed(CONFIRM)`, and
 * `enter` calls `edges.reset()`), so a held button does not auto-advance across
 * screens: the player releases and presses once per screen. Opening on NORMAL
 * keeps that added press a single tap of the same button with no cursor movement.
 *
 * ## The assist toggle row
 *
 * One extra row sits beneath the four tiers: the infinite-lives assist. It is
 * navigated like any row, but CONFIRM on it *flips it in place and stays* rather
 * than advancing — a value edited, not a destination — while CONFIRM on a tier
 * confirms and carries the toggle's current state onward. The state lives on
 * `ctx.infiniteLives` so it persists if the player backs out and returns, and it
 * is read (not held locally) so the label always reports the live value. This is
 * digital bits only, tap-latched by `Edges` like every other menu press (rule 4);
 * the alternative — a separate assist screen — was rejected for the same reason
 * this screen fought to open on NORMAL: the default path must stay cheap.
 */
export class DifficultySelectState extends MenuState {
  readonly name = 'difficulty-select';

  constructor(ctx: GameContext) {
    super(ctx);
    // Default onto NORMAL. `DIFFICULTIES` lists the tiers ascending, so this is
    // index 1, and confirming without moving keeps `ctx.difficulty` at Normal.
    this.selected = DIFFICULTIES.indexOf(DEFAULT_DIFFICULTY);
  }

  /** The toggle row's index: one past the last tier. */
  private get toggleRow(): number {
    return DIFFICULTIES.length;
  }

  private get infiniteLives(): boolean {
    return this.ctx.infiniteLives ?? false;
  }

  protected get entries(): readonly string[] {
    return [
      ...DIFFICULTIES.map((tier) => DIFFICULTY_LABELS[tier]),
      this.infiniteLives ? INFINITE_LIVES_ON : INFINITE_LIVES_OFF,
    ];
  }

  protected confirm(index: number): void {
    // The toggle row flips in place and stays; a tier row confirms and advances,
    // carrying whatever the toggle currently reads.
    if (index === this.toggleRow) {
      this.ctx.infiniteLives = !this.infiniteLives;
      return;
    }
    const tier = DIFFICULTIES[index];
    if (tier === undefined) return;
    this.ctx.difficulty = tier;
    this.ctx.machine.replace(new CharacterSelectState(this.ctx));
  }

  protected override cancel(): void {
    this.ctx.machine.replace(new TitleState(this.ctx));
  }

  view(): StateView {
    const tier = DIFFICULTIES[this.selected];
    const line =
      this.selected === this.toggleRow
        ? INFINITE_LIVES_BLURB
        : tier === undefined
          ? undefined
          : DIFFICULTY_BLURBS[tier];
    return {
      kind: 'difficulty-select',
      title: 'DIFFICULTY',
      lines: line === undefined ? [] : [line],
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
    // A pack character drives the simulation with pack content, so its run must
    // record the owning pack's identity strictly — even off the plain START row,
    // where the campaign wire never armed `packsData`. Campaigns cover the stage
    // path; this covers the character path, the one a built-in campaign leaves
    // empty. A built-in character (no owner) touches nothing, so it still records
    // whatever the campaign left — `''` off START.
    const owner = (this.ctx.characterPacks ?? []).find((c) => c.character === name);
    if (owner !== undefined) this.ctx.packsData = owner.packsData;
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

/** What a `PlayingState` needs beyond the character, all optional. */
export interface PlayingOptions {
  seed?: number;
  /** Overrides `GameContext.stage`. Set when advancing past the first stage. */
  stage?: string;
  /** Resources carried in from the stage before. */
  carry?: PlayerCarry;
}

export class PlayingState implements GameState {
  readonly name = 'playing';
  readonly run: Run;
  readonly characterName: string;

  readonly #ctx: GameContext;
  readonly #edges = new Edges();

  /** The recording is taken once, on the tick the run ends. */
  #recorded = false;

  constructor(ctx: GameContext, characterName: string, options: PlayingOptions = {}) {
    this.#ctx = ctx;
    this.characterName = characterName;
    const stage = options.stage ?? ctx.stage;
    this.run = new Run({
      seed: options.seed ?? ctx.nextSeed(),
      character: characterName,
      ...(stage === undefined ? {} : { stage }),
      // Still an override, and now rarely used: a stage names its own boss.
      // Left on the context so a debug shell can point one stage at another's
      // fight without authoring a stage to hold it.
      ...(ctx.boss === undefined ? {} : { boss: ctx.boss }),
      ...(options.carry === undefined ? {} : { carry: options.carry }),
      // Recorded into replay meta, not consumed by the run — the pack identity
      // travels on the context the same way the boss override does.
      ...(ctx.packs === undefined ? {} : { packs: ctx.packs }),
      // Same channel as `packs`, but a strict one: a data pack's content moved
      // the simulation, so a replay under a different one is refused, not warned.
      ...(ctx.packsData === undefined ? {} : { packsData: ctx.packsData }),
      // Strict like `packsData`: the tier changes what bullets are in the air, so
      // it is recorded and checked on playback. Unset defaults to Normal in `Run`.
      ...(ctx.difficulty === undefined ? {} : { difficulty: ctx.difficulty }),
      // The assist, strict on playback like `difficulty` (see RunConfig). Unset
      // is off, and forwarding only when set keeps an ordinary run's config and
      // recording byte-identical to before the assist existed.
      ...(ctx.infiniteLives === undefined ? {} : { infiniteLives: ctx.infiniteLives }),
      // The base-content fingerprint, recorded so a replay played against drifted
      // base content is caught. Absent means the shell opted out (see RunConfig).
      ...(ctx.contentFingerprint === undefined ? {} : { contentFingerprint: ctx.contentFingerprint }),
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
    //
    // A cleared run forks on whether a stage follows. The ordinary case is
    // another `ClearedState` (STAGE CLEAR / NEXT STAGE). But clearing a stage
    // that declares no `next` — a `null` on the last stage of a campaign — is the
    // *game's* ending, not a stage's, so it raises `EndingScreenState` first: the
    // apparatus going quiet, in the game's own voice, before the ALL CLEAR
    // results screen that `EndingScreenState` replaces itself with on the last
    // page. `nextStage === undefined` is the same "no next stage" the
    // `ClearedState` below already reads (`advance`/`#hasNext`); this only splits
    // the terminal case out ahead of the results card.
    const ending =
      this.run.outcome === 'cleared'
        ? this.nextStage === undefined
          ? new EndingScreenState(this.#ctx, this)
          : new ClearedState(this.#ctx, this)
        : new GameOverState(this.#ctx, this);
    this.#ctx.machine.push(ending);
  }

  /**
   * A genuinely fresh run — new seed, nothing carried, and back to the stage
   * this run was actually played on rather than to the start of the game.
   */
  restart(): PlayingState {
    return new PlayingState(this.#ctx, this.characterName, {
      stage: this.run.stageName,
    });
  }

  /**
   * The next stage, flown by the same ship, carrying what was earned.
   *
   * Returns undefined when this stage declares no `next` — the last stage of
   * the game, where clearing means the game is over rather than continuing.
   */
  advance(): PlayingState | undefined {
    const next = this.nextStage;
    if (next === undefined) return undefined;
    return new PlayingState(this.#ctx, this.characterName, {
      stage: next,
      carry: this.run.carry,
    });
  }

  /**
   * The name of the stage after this one, or undefined at the end of the game.
   *
   * Separate from `advance()` so a screen can ask *whether* there is more
   * without building a `Run` to find out — constructing one draws a seed from
   * `nextSeed()`, and a seed drawn to answer a question about a menu entry is
   * a seed the run that eventually starts will not have.
   */
  get nextStage(): string | undefined {
    return getStage(this.run.stageName).next;
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
    const lines = [
      `score ${player.score}`,
      `graze ${player.graze}`,
      `deaths ${player.deathCount}`,
    ];
    // Honesty is a marker, not a penalty (decisions §A.5): score arithmetic is
    // untouched, but an assist run is tagged wherever its result is shown, so a
    // screenshot or a replay viewer can always tell it flew with help.
    if (this.playing.run.config.infiniteLives === true) {
      return [...lines, 'assist — infinite lives'];
    }
    return lines;
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

/**
 * Clearing a stage is the one ending that might not be an ending.
 *
 * Before stages declared a `next`, this screen offered RETRY and TITLE and
 * nothing else, so stage 2 — a finished stage with five enemy types, a midboss,
 * and a four-phase boss — was reachable by no sequence of inputs at all. The
 * only thing missing was somewhere to go from here.
 */
export class ClearedState extends EndingState {
  readonly name = 'cleared';

  /**
   * Whether a stage follows, decided once on entry. The `PlayingState` for it
   * is built on confirm rather than here, so declining costs no seed.
   */
  readonly #hasNext: boolean;

  constructor(ctx: GameContext, playing: PlayingState) {
    super(ctx, playing);
    this.#hasNext = playing.nextStage !== undefined;
  }

  protected override get entries(): readonly string[] {
    return this.#hasNext ? ['NEXT STAGE', ...super.entries] : super.entries;
  }

  protected override confirm(index: number): void {
    if (!this.#hasNext) {
      super.confirm(index);
      return;
    }
    if (index > 0) {
      // The base class numbers its own entries from zero; this screen prepended
      // one, so shift before delegating. Passing the raw index would make TITLE
      // retry and RETRY advance.
      super.confirm(index - 1);
      return;
    }

    const next = this.playing.advance();
    if (next === undefined) return;
    // Same order as RETRY: the card leaves first, then the finished run beneath
    // it is swapped for the next stage's.
    this.ctx.machine.pop();
    this.ctx.machine.replace(next);
  }

  view(): StateView {
    return {
      kind: 'cleared',
      title: this.#hasNext ? 'STAGE CLEAR' : 'ALL CLEAR',
      lines: this.scoreLines(),
      menu: this.entries,
      selected: this.selected,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Ending                                                              */
/* ------------------------------------------------------------------ */

/**
 * The game's own closing words, before the coda and the results screen. Cold and
 * archetypal — a *seat*, a *descent*, a *gate* — so they read true for the base
 * campaign and acceptably for any descent-shaped guest campaign that declares an
 * end, without naming a single boss. This is the game's institutional voice, never
 * the final boss's: an administrator with a death-speech would contradict the whole
 * reveal, and a dead empty seat cannot speak. The apparatus simply goes quiet.
 */
const ENDING_OPENING: readonly string[] = [
  'You have reached the bottom of the descent.',
  'The seat at the centre is empty.',
  'It was never occupied — only kept.',
];

/**
 * The closing block. The blank middle line is intentional — a beat before the last
 * words — carried as an empty string through `lines`. "No one is watching the gate"
 * answers the campaign's opening "The gate is me": four strata later, no one is.
 */
const ENDING_CLOSING: readonly string[] = [
  'The strata stand open. No one is watching the gate.',
  '',
  'Adjourned, sine die.',
];

/**
 * The per-character coda, keyed off the ship that flew the run. Pure data
 * selection off `PlayingState.characterName` — the same shape `dialogueFor` uses,
 * no new field. A character the map does not name (a guest ship, a test pilot) gets
 * a neutral archetypal line rather than nothing, so the ending always has its
 * middle page.
 *
 * Exported for `states.test.ts`: the four base ships live in the bundled pack,
 * which a `src/game` test may not import, so the selection is proved against the
 * literal names here rather than by flying a registered ship.
 */
const ENDING_CODAS: Readonly<Record<string, string>> = {
  scout: 'You were only ever passing through.',
  lance: 'Nothing down here yields. You leave it standing.',
  hound: 'You found the source. There was nothing to hold it.',
  spire: 'The seat is empty. You climbed anyway.',
};

const ENDING_CODA_DEFAULT = 'You reached the centre, and no one answered.';

export function endingCoda(characterName: string): string {
  return ENDING_CODAS[characterName] ?? ENDING_CODA_DEFAULT;
}

/**
 * The game's ending, shown on clearing a stage that declares no `next`.
 *
 * A menu-layer screen over a finished run: it holds no sim state and does not tick
 * the simulation, so a recorded run replays to the same clear tick exactly and the
 * ending is then driven by fresh menu input — the same relationship `ClearedState`
 * has to a finished run today, and therefore no source of replay divergence. It
 * extends `MenuState` purely to reuse the latched `edges.pressed(CONFIRM)` every
 * menu and the pre-fight dialogue already read, so the same input vocabulary pages
 * it through. Its `entries` are empty: it is paged text, not a cursor, so it holds
 * its own `#page` counter and ignores the `index` a confirm carries.
 *
 * On confirming the last page it `replace`s itself with `ClearedState`, so the
 * existing ALL CLEAR results screen (score / graze / deaths, the assist marker,
 * RETRY / TITLE) still appears and the results-and-replay path is intact — the run
 * still reaches `'cleared'`. The field it ended on stays on the stack beneath, so
 * the emptied play field and HUD keep drawing under the text.
 *
 * `music` is the one shell-level seam: the reconcile in `main.ts` reads it off the
 * stack the same way it reads `MENU_MUSIC` as the no-run fallback, so entering this
 * screen crossfades whatever the fight sounded to `adjourn` — the apparatus going
 * quiet, which is the reveal. A `Run` cannot express this (after the boss dies it
 * falls back to the stage track), which is why it is a state-level field rather than
 * `run.music`.
 */
export class EndingScreenState extends MenuState {
  readonly name = 'ending';

  /**
   * Read by `main.ts`'s music reconcile off the stack, exactly as `MENU_MUSIC` is
   * the no-run fallback. Independent of any `Run`: a finished run's `run.music`
   * has fallen back to the stage theme, so the ending's track has to live here.
   */
  readonly music = 'adjourn';

  readonly #playing: PlayingState;

  /** Which page is shown. Advanced by a CONFIRM edge; the last one exits. */
  #page = 0;

  readonly #pages: readonly (readonly string[])[];

  constructor(ctx: GameContext, playing: PlayingState) {
    super(ctx);
    this.#playing = playing;
    this.#pages = [
      ENDING_OPENING,
      [endingCoda(playing.characterName)],
      ENDING_CLOSING,
    ];
  }

  protected get entries(): readonly string[] {
    return [];
  }

  protected confirm(): void {
    this.#page += 1;
    if (this.#page >= this.#pages.length) {
      // The ALL CLEAR results screen the game already has. Replace, not push: the
      // ending is done, and the finished-run field beneath it stays put so the
      // card sits over it exactly as `ClearedState` does after a stage.
      this.ctx.machine.replace(new ClearedState(this.ctx, this.#playing));
    }
  }

  view(): StateView {
    const page = this.#pages[Math.min(this.#page, this.#pages.length - 1)] ?? [];
    return {
      kind: 'ending',
      lines: page,
      menu: [],
    };
  }
}
