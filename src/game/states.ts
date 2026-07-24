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
import type { ReplaySession } from '../replay/session';
import { DEFAULT_DIFFICULTY, DIFFICULTIES, type Difficulty } from '../sim/difficulty';
import type { Replay } from '../sim/replay';
import { Edges, type GameState, type StateMachine, type StateView } from './state';
import {
  characterNames,
  decodeCarry,
  getCharacter,
  Run,
  type PlayerCarry,
  type RunConfig,
} from './run';

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
 * on; `packsData` is this campaign pack's `name@hash`, later unioned with a pack
 * character identity when necessary and recorded strictly into replay meta (see
 * `RunConfig.packsData`). The identity travels on the campaign because that is
 * what lets the plain START row record `''`.
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
   * Canonical comma-joined identity of data packs whose content this run uses.
   * A campaign arms its pack; a pack character unions in its owner. Unset for a
   * wholly built-in run, so it records `''` — content mismatch REFUSES where
   * presentation-only `packs` merely warns (see `RunConfig.packsData`).
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
   * strict `packsData` when a pack character is flown off the plain START row,
   * or union its owner with a different pack campaign.
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
   * Whether the next attempt records a replay, toggled on the RUN SETUP screen.
   *
   * This is shell workflow, not simulation configuration: it decides whether a
   * `PlayingState` retains the input log `Run` already produces and never enters
   * `RunConfig` or replay determinism. Unset means off.
   */
  recordReplay?: boolean;
  /**
   * Fingerprint of the bundled base content, forwarded into
   * `RunConfig.contentFingerprint`. `main.ts` sets it from the generated pack
   * constant; a string by contract, like `packs` (see `RunConfig.contentFingerprint`).
   * Unset for a shell that opted out — nothing is recorded and nothing is checked.
   */
  contentFingerprint?: string;
  /**
   * Sessions currently available to the player. `undefined` means this shell
   * has no replay-library surface; an empty array means the library is enabled
   * and offers IMPORT/BACK even before the first run has been saved.
   */
  replaySessions?: readonly ReplaySession[];
  /** A fresh attempt/campaign id. Advanced stages keep the same id. */
  beginReplaySession?(): string;
  /** Handed the recording when a run ends, with its shell-owned session id. */
  onReplay?(replay: Replay, sessionId?: string): void;
  /** Shell actions: file APIs and persistence never enter `src/game`. */
  onImportReplay?(): void;
  onDownloadReplay?(session: ReplaySession): void;
  onDeleteReplaySession?(session: ReplaySession): void;
  onReplayError?(message: string): void;
  onScreenshot?(): void;
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
  /** Fixed-tick presentation clock, reset whenever this screen is entered. */
  protected age = 0;

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
    this.age++;

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
    this.age = 0;
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
    return [
      'START',
      ...(this.ctx.campaigns ?? []).map((c) => c.label),
      ...(this.ctx.replaySessions === undefined ? [] : ['REPLAYS']),
    ];
  }

  protected confirm(index: number): void {
    const campaigns = this.ctx.campaigns ?? [];
    if (this.ctx.replaySessions !== undefined && index === campaigns.length + 1) {
      this.ctx.machine.replace(new ReplayLibraryState(this.ctx));
      return;
    }

    // Row 0 is START: it steers nothing, so `ctx.stage`/`ctx.packsData` are
    // left exactly as they were and a built-in run records `packsData: ''`.
    // Every later row is a campaign (index - 1 into the list); selecting one
    // arms both the qualified stage and the entering pack's identity before the
    // normal character-select flow, the same way a boss override is left on the
    // context to steer the run that starts later.
    const campaign = campaigns[index - 1];
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
      age: this.age,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Replay library                                                      */
/* ------------------------------------------------------------------ */

function sessionLabel(session: ReplaySession): string {
  const first = session.segments[0];
  const last = session.segments.at(-1);
  const character = stringMeta(first, 'character') ?? 'UNKNOWN';
  const count = session.segments.length;
  const date = session.createdAt.slice(0, 10);
  const status = replayStatus(last);
  return `${date}  ${character.toUpperCase()}  ${count} STAGE${count === 1 ? '' : 'S'}`
    + `  ${status.toUpperCase()}`;
}

function segmentLabel(replay: Replay, index: number): string {
  const stage = stringMeta(replay, 'stage') ?? `STAGE ${index + 1}`;
  const difficulty = stringMeta(replay, 'difficulty') ?? DEFAULT_DIFFICULTY;
  const status = replayStatus(replay);
  return `${stage.toUpperCase()}  ${difficulty.toUpperCase()}  ${status.toUpperCase()}`
    + `  ${replayDuration(replay.length)}`;
}

function segmentExportLabel(replay: Replay, index: number): string {
  const stage = stringMeta(replay, 'stage') ?? `STAGE ${index + 1}`;
  return `EXPORT ${stage.toUpperCase()} VIDEO`;
}

function stringMeta(replay: Replay | undefined, key: string): string | undefined {
  const value = replay?.meta?.[key];
  return typeof value === 'string' ? value : undefined;
}

function numberMeta(replay: Replay, key: string): number | undefined {
  const value = replay.meta?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function replayEndReason(replay: Replay | undefined): ReplayEndReason | undefined {
  const reason = stringMeta(replay, 'endReason');
  return reason === 'quit' || reason === 'retry' ? reason : undefined;
}

function replayStatus(replay: Replay | undefined): string {
  const reason = replayEndReason(replay);
  if (reason === 'retry') return 'retried';
  if (reason === 'quit') return 'quit';
  return stringMeta(replay, 'outcome') ?? 'recorded';
}

function replayDuration(ticks: number): string {
  const seconds = Math.floor(Math.max(0, ticks) / 60);
  const minutes = Math.floor(seconds / 60);
  return `${minutes.toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

function findSession(ctx: GameContext, id: string | undefined): ReplaySession | undefined {
  if (id === undefined) return undefined;
  return ctx.replaySessions?.find((session) => session.id === id);
}

export class ReplayLibraryState extends MenuState {
  readonly name = 'replay-library';

  constructor(ctx: GameContext) {
    super(ctx);
  }

  protected get entries(): readonly string[] {
    return [
      ...(this.ctx.replaySessions ?? []).map(sessionLabel),
      'IMPORT REPLAY',
      'BACK',
    ];
  }

  protected confirm(index: number): void {
    const sessions = this.ctx.replaySessions ?? [];
    const session = sessions[index];
    if (session !== undefined) {
      this.ctx.machine.replace(new ReplaySessionState(this.ctx, session));
      return;
    }
    if (index === sessions.length) {
      this.ctx.onImportReplay?.();
      return;
    }
    this.ctx.machine.replace(new TitleState(this.ctx));
  }

  protected override cancel(): void {
    this.ctx.machine.replace(new TitleState(this.ctx));
  }

  view(): StateView {
    const count = this.ctx.replaySessions?.length ?? 0;
    return {
      kind: 'replay-library',
      title: 'REPLAYS',
      lines: [count === 0 ? 'no saved runs — import a replay file' : `${count} saved session${count === 1 ? '' : 's'}`],
      menu: this.entries,
      selected: this.selected,
      menuActions: [
        ...(this.ctx.replaySessions ?? []).map(() => undefined),
        'import-replay',
        undefined,
      ],
      age: this.age,
    };
  }
}

export class ReplaySessionState extends MenuState {
  readonly name = 'replay-session';
  readonly #session: ReplaySession;
  #error: string | undefined;

  constructor(ctx: GameContext, session: ReplaySession) {
    super(ctx);
    this.#session = session;
  }

  protected get entries(): readonly string[] {
    return [
      'WATCH SESSION',
      ...this.#session.segments.map(segmentLabel),
      ...this.#session.segments.map(segmentExportLabel),
      'DOWNLOAD SESSION',
      ...(this.ctx.onDeleteReplaySession === undefined ? [] : ['DELETE SESSION']),
      'BACK',
    ];
  }

  protected confirm(index: number): void {
    if (index === 0) {
      try {
        this.ctx.machine.replace(new ReplayPlayingState(this.ctx, this.#session, 0, {
          continuous: true,
        }));
        this.#error = undefined;
      } catch (error) {
        this.#error = (error as Error).message;
        this.ctx.onReplayError?.(this.#error);
      }
      return;
    }

    const replay = this.#session.segments[index - 1];
    if (replay !== undefined) {
      try {
        this.ctx.machine.replace(
          new ReplayPlayingState(this.ctx, this.#session, index - 1),
        );
        this.#error = undefined;
      } catch (error) {
        this.#error = (error as Error).message;
        this.ctx.onReplayError?.(this.#error);
      }
      return;
    }

    const exportIndex = index - this.#session.segments.length - 1;
    if (this.#session.segments[exportIndex] !== undefined) {
      try {
        this.ctx.machine.replace(
          new ReplayExportState(this.ctx, this.#session, exportIndex),
        );
        this.#error = undefined;
      } catch (error) {
        this.#error = (error as Error).message;
        this.ctx.onReplayError?.(this.#error);
      }
      return;
    }

    const downloadIndex = this.#session.segments.length * 2 + 1;
    if (index === downloadIndex) {
      this.ctx.onDownloadReplay?.(this.#session);
      return;
    }
    if (
      this.ctx.onDeleteReplaySession !== undefined
      && index === downloadIndex + 1
    ) {
      this.ctx.machine.replace(new ReplayDeleteConfirmState(this.ctx, this.#session));
      return;
    }
    this.ctx.machine.replace(new ReplayLibraryState(this.ctx));
  }

  protected override cancel(): void {
    this.ctx.machine.replace(new ReplayLibraryState(this.ctx));
  }

  view(): StateView {
    const first = this.#session.segments[0];
    const character = stringMeta(first, 'character') ?? 'unknown pilot';
    return {
      kind: 'replay-session',
      title: 'REPLAY SESSION',
      lines: [
        `${character} · ${this.#session.segments.length} recorded stage${this.#session.segments.length === 1 ? '' : 's'}`,
        ...(this.#error === undefined ? [] : [this.#error]),
      ],
      menu: this.entries,
      selected: this.selected,
      age: this.age,
    };
  }
}

/**
 * A deliberately separate destructive step.
 *
 * The cursor opens on CANCEL, so entering this screen and pressing confirm
 * cannot erase a replay. The shell owns the actual persistence operation; this
 * state only identifies the exact immutable session the player approved.
 */
export class ReplayDeleteConfirmState extends MenuState {
  readonly name = 'replay-delete-confirm';
  readonly #session: ReplaySession;

  constructor(ctx: GameContext, session: ReplaySession) {
    super(ctx);
    this.#session = session;
  }

  protected get entries(): readonly string[] {
    return ['CANCEL', 'DELETE FOREVER'];
  }

  protected confirm(index: number): void {
    if (index === 0) {
      this.ctx.machine.replace(new ReplaySessionState(this.ctx, this.#session));
      return;
    }
    this.ctx.onDeleteReplaySession?.(this.#session);
    this.ctx.machine.replace(new ReplayLibraryState(this.ctx));
  }

  protected override cancel(): void {
    this.ctx.machine.replace(new ReplaySessionState(this.ctx, this.#session));
  }

  view(): StateView {
    const first = this.#session.segments[0];
    const character = stringMeta(first, 'character') ?? 'unknown pilot';
    return {
      kind: 'replay-delete-confirm',
      title: 'DELETE SESSION?',
      lines: [
        `${character} · ${this.#session.segments.length} recorded stage${this.#session.segments.length === 1 ? '' : 's'}`,
        'this cannot be undone',
      ],
      menu: this.entries,
      selected: this.selected,
      age: this.age,
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
const RECORD_REPLAY_OFF = 'RECORD REPLAY  OFF';
const RECORD_REPLAY_ON = 'RECORD REPLAY  ON';
const RECORD_REPLAY_BLURB = 'save this attempt — clears, failures, quits and retries';

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
 * ## Setup toggle rows
 *
 * Two rows sit beneath the four tiers: the infinite-lives assist and explicit
 * replay recording. They are navigated like any row, but CONFIRM on either
 * *flips it in place and stays* rather than advancing — values edited, not
 * destinations — while CONFIRM on a tier confirms and carries both live values
 * onward. Their state lives on `GameContext` so it persists if the player backs
 * out and returns. This is digital bits only, tap-latched by `Edges` like every
 * other menu press (rule 4); the default path stays one confirm on NORMAL.
 */
export class DifficultySelectState extends MenuState {
  readonly name = 'difficulty-select';

  constructor(ctx: GameContext) {
    super(ctx);
    // Default onto NORMAL. `DIFFICULTIES` lists the tiers ascending, so this is
    // index 1, and confirming without moving keeps `ctx.difficulty` at Normal.
    this.selected = DIFFICULTIES.indexOf(DEFAULT_DIFFICULTY);
  }

  /** The assist row's index: one past the last tier. */
  private get infiniteLivesRow(): number {
    return DIFFICULTIES.length;
  }

  /** Replay recording sits directly beneath the assist. */
  private get recordReplayRow(): number {
    return DIFFICULTIES.length + 1;
  }

  private get infiniteLives(): boolean {
    return this.ctx.infiniteLives ?? false;
  }

  private get recordReplay(): boolean {
    return this.ctx.recordReplay ?? false;
  }

  protected get entries(): readonly string[] {
    return [
      ...DIFFICULTIES.map((tier) => DIFFICULTY_LABELS[tier]),
      this.infiniteLives ? INFINITE_LIVES_ON : INFINITE_LIVES_OFF,
      this.recordReplay ? RECORD_REPLAY_ON : RECORD_REPLAY_OFF,
    ];
  }

  protected confirm(index: number): void {
    // Toggle rows flip in place and stay; a tier row confirms and advances.
    if (index === this.infiniteLivesRow) {
      this.ctx.infiniteLives = !this.infiniteLives;
      return;
    }
    if (index === this.recordReplayRow) {
      this.ctx.recordReplay = !this.recordReplay;
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
      this.selected === this.infiniteLivesRow
        ? INFINITE_LIVES_BLURB
        : this.selected === this.recordReplayRow
          ? RECORD_REPLAY_BLURB
        : tier === undefined
          ? undefined
          : DIFFICULTY_BLURBS[tier];
    return {
      kind: 'difficulty-select',
      title: 'RUN SETUP',
      lines: line === undefined ? [] : [line],
      menu: this.entries,
      selected: this.selected,
      age: this.age,
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
    if (owner !== undefined) {
      // A pack ship may fly another pack's campaign. Both packs then change the
      // simulation, so the strict identity is their canonical union rather than
      // one silently overwriting the other.
      this.ctx.packsData = mergeContentIdentities(this.ctx.packsData, owner.packsData);
    }
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
      age: this.age,
      ...(name === undefined ? {} : { character: name }),
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
  /** Shell-owned campaign/attempt identity; preserved only when advancing. */
  sessionId?: string;
  /** Snapshot of the setup toggle, preserved across this attempt's stages. */
  recordReplay?: boolean;
}

export type ReplayEndReason = 'quit' | 'retry';

export class PlayingState implements GameState {
  readonly name = 'playing';
  readonly run: Run;
  readonly characterName: string;
  readonly sessionId: string | undefined;
  /** Setup choice frozen for this attempt; never read back from the live menu. */
  readonly recordReplay: boolean;

  readonly #ctx: GameContext;
  readonly #edges = new Edges();

  /** The recording is retained once, whether the run ends or is abandoned. */
  #recorded = false;

  constructor(ctx: GameContext, characterName: string, options: PlayingOptions = {}) {
    this.#ctx = ctx;
    this.characterName = characterName;
    this.recordReplay = options.recordReplay ?? ctx.recordReplay ?? false;
    this.sessionId = this.recordReplay
      ? options.sessionId ?? ctx.beginReplaySession?.()
      : undefined;
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
    this.finalizeReplay();

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
      recordReplay: this.recordReplay,
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
      recordReplay: this.recordReplay,
      ...(this.sessionId === undefined ? {} : { sessionId: this.sessionId }),
    });
  }

  /**
   * Retain the exact input prefix once.
   *
   * Natural endings carry no extra marker and remain byte-compatible with
   * historical Replay v1 documents. An explicit quit/retry ends while the Run
   * is still `playing`, so the shell-only `endReason` tells the viewer that this
   * exact prefix is intentional rather than a damaged/truncated recording.
   */
  finalizeReplay(endReason?: ReplayEndReason): Replay | undefined {
    if (this.#recorded) return undefined;
    if (endReason === undefined && !this.run.finished) {
      throw new Error('replay recording: an unfinished run needs an end reason');
    }
    if (endReason !== undefined && this.run.finished) {
      throw new Error('replay recording: a finished run cannot have an end reason');
    }
    this.#recorded = true;
    if (!this.recordReplay) return undefined;

    const recorded = this.run.finishRecording();
    const replay = endReason === undefined
      ? recorded
      : {
          ...recorded,
          meta: {
            ...recorded.meta,
            endReason,
          },
        };
    this.#ctx.onReplay?.(replay, this.sessionId);
    return replay;
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
    return {
      kind: 'playing',
      run: this.run,
      recording: this.recordReplay && !this.#recorded,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Replay playback                                                     */
/* ------------------------------------------------------------------ */

/**
 * Reconstruct one recorded Run against the identities loaded RIGHT NOW.
 *
 * Character/stage/carry describe what the file asks to watch. Content and pack
 * identities come from the live environment, never copied back out of the file:
 * feeding a recording its own fingerprint would let it certify itself and turn
 * every strict mismatch check in `Run` into theatre.
 */
export function replayRunConfig(
  ctx: GameContext,
  replay: Replay,
  carryOverride?: PlayerCarry,
): RunConfig {
  validateReplayViewerMeta(replay);
  const recordedDifficulty = stringMeta(replay, 'difficulty');
  if (
    recordedDifficulty !== undefined
    && !(DIFFICULTIES as readonly string[]).includes(recordedDifficulty)
  ) {
    throw new Error(`replay viewer: unsupported difficulty "${recordedDifficulty}"`);
  }

  const carryText = stringMeta(replay, 'carry');
  const assistText = stringMeta(replay, 'infiniteLives');
  if (assistText !== undefined && assistText !== 'true' && assistText !== 'false') {
    throw new Error(`replay viewer: invalid infiniteLives marker "${assistText}"`);
  }

  const recordedData = stringMeta(replay, 'packsData');
  const character = stringMeta(replay, 'character');
  const stage = stringMeta(replay, 'stage');
  const stageNamespace = contentNamespace(stage);
  const stageOwner = stageNamespace === undefined
    ? undefined
    : (ctx.campaigns ?? []).find(
      (campaign) => contentNamespace(campaign.stage) === stageNamespace,
    )?.packsData;
  const characterOwner = character === undefined
    ? undefined
    : (ctx.characterPacks ?? []).find(
      (candidate) => candidate.character === character,
    )?.packsData;

  const availableData = new Set(
    [
      ...(ctx.campaigns ?? []).map((campaign) => campaign.packsData),
      ...(ctx.characterPacks ?? []).map((candidate) => candidate.packsData),
    ].flatMap(contentIdentities),
  );
  const requiredData = new Set(
    [stageOwner, characterOwner].flatMap(contentIdentities),
  );
  const recordedIdentities = contentIdentities(recordedData);
  const canonicalRecorded = canonicalContentIdentities(recordedIdentities);
  if (recordedData !== undefined && recordedData !== canonicalRecorded) {
    throw new Error(`replay viewer: packsData "${recordedData}" is not canonically encoded`);
  }
  if (requiredData.size > 0 && recordedData === undefined) {
    throw new Error(
      `replay viewer: ${stage ?? character ?? 'recording'} is missing its content-pack identity`,
    );
  }
  const unavailable = recordedIdentities.find((identity) => !availableData.has(identity));
  if (unavailable !== undefined) {
    throw new Error(
      `replay viewer: recorded packsData "${unavailable}" is not loaded`,
    );
  }
  const missing = [...requiredData].find((identity) => !recordedIdentities.includes(identity));
  if (missing !== undefined) {
    throw new Error(
      `replay viewer: recorded packsData "${recordedData ?? ''}" does not include `
      + `the loaded stage/character identity "${missing}"`,
    );
  }

  const carry = carryOverride ?? (
    carryText === undefined || carryText === ''
      ? undefined
      : decodeCarry(carryText)
  );
  return {
    seed: replay.seed,
    replay,
    ...(character === undefined ? {} : { character }),
    ...(stage === undefined ? {} : { stage }),
    ...(carry === undefined ? {} : { carry }),
    ...(ctx.packs === undefined ? {} : { packs: ctx.packs }),
    packsData: recordedData ?? '',
    difficulty: (recordedDifficulty as Difficulty | undefined) ?? DEFAULT_DIFFICULTY,
    ...(assistText === 'true' ? { infiniteLives: true } : {}),
    ...(ctx.contentFingerprint === undefined
      ? {}
      : { contentFingerprint: ctx.contentFingerprint }),
  };
}

function contentNamespace(name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  const slash = name.indexOf('/');
  return slash <= 0 ? undefined : name.slice(0, slash);
}

function contentIdentities(encoded: string | undefined): string[] {
  if (encoded === undefined || encoded === '') return [];
  return encoded.split(',').filter((identity) => identity !== '');
}

function canonicalContentIdentities(identities: readonly string[]): string {
  return [...new Set(identities)].sort().join(',');
}

function mergeContentIdentities(
  current: string | undefined,
  added: string,
): string {
  return canonicalContentIdentities([
    ...contentIdentities(current),
    ...contentIdentities(added),
  ]);
}

function validateReplayViewerMeta(replay: Replay): void {
  const meta = replay.meta;
  if (meta === undefined) return;

  const stringKeys = [
    'character',
    'stage',
    'boss',
    'carry',
    'packsData',
    'difficulty',
    'infiniteLives',
    'content',
    'packs',
    'outcome',
    'endReason',
  ] as const;
  for (const key of stringKeys) {
    const value = meta[key];
    if (value !== undefined && typeof value !== 'string') {
      throw new Error(`replay viewer: meta.${key} must be a string`);
    }
  }

  const outcome = meta['outcome'];
  if (
    typeof outcome === 'string'
    && outcome !== 'playing'
    && outcome !== 'cleared'
    && outcome !== 'failed'
  ) {
    throw new Error(`replay viewer: invalid outcome "${outcome}"`);
  }

  const endReason = meta['endReason'];
  if (
    typeof endReason === 'string'
    && endReason !== 'quit'
    && endReason !== 'retry'
  ) {
    throw new Error(`replay viewer: invalid endReason "${endReason}"`);
  }
  if (endReason !== undefined && outcome !== 'playing') {
    throw new Error('replay viewer: an ended replay must have outcome "playing"');
  }

  const score = meta['score'];
  if (
    score !== undefined
    && (
      typeof score !== 'number'
      || !Number.isSafeInteger(score)
      || score < 0
    )
  ) {
    throw new Error('replay viewer: meta.score must be a non-negative safe integer');
  }
  if (endReason !== undefined && score === undefined) {
    throw new Error('replay viewer: an ended replay must record its score');
  }
}

function replayMatchesRun(replay: Replay, run: Run): boolean {
  const expectedOutcome = stringMeta(replay, 'outcome');
  const expectedScore = numberMeta(replay, 'score');
  const endedEarly = replayEndReason(replay) !== undefined;
  return (
    (endedEarly
      ? !run.finished && run.outcome === 'playing' && expectedOutcome === 'playing'
      : run.finished)
    && run.tickCount === replay.length
    && (expectedOutcome === undefined || run.outcome === expectedOutcome)
    && (expectedScore === undefined || run.player.score === expectedScore)
  );
}

export type ReplayExportPhase =
  | 'preparing'
  | 'recording'
  | 'finished'
  | 'stopping'
  | 'done';

/**
 * Whether shell presentation should advance across this fixed tick.
 *
 * A recording -> finished tick belongs to the replay only when it consumed an
 * input tick, and must step its background/effects once. A zero-length partial
 * consumes none; subsequent tail/finalization ticks hold the exact composition.
 */
export function replayExportPresentationAdvances(
  before: ReplayExportPhase | undefined,
  after: ReplayExportPhase | undefined,
  replayTickAdvanced = true,
): boolean {
  return (
    after === undefined
    || after === 'recording'
    || (before === 'recording' && replayTickAdvanced)
  );
}

/**
 * Replay-driven source for a single-stage video export.
 *
 * This state owns only the deterministic part: rebuilding the Run and advancing
 * it by exactly one recorded mask per fixed tick. The browser shell owns media
 * devices, codecs, real-time audio capture and the download. Until the shell
 * calls `arm`, and after the exact recorded finish, the Run is frozen.
 */
export class ReplayExportState implements GameState {
  readonly name = 'replay-export';
  readonly run: Run;

  readonly #ctx: GameContext;
  readonly #session: ReplaySession;
  readonly #segmentIndex: number;
  readonly #replay: Replay;
  readonly #edges = new Edges();
  #phase: ReplayExportPhase = 'preparing';

  constructor(
    ctx: GameContext,
    session: ReplaySession,
    segmentIndex: number,
  ) {
    const replay = session.segments[segmentIndex];
    if (replay === undefined) {
      throw new Error(`replay export: session has no segment ${segmentIndex}`);
    }
    this.#ctx = ctx;
    this.#session = session;
    this.#segmentIndex = segmentIndex;
    this.#replay = replay;
    this.run = new Run(replayRunConfig(ctx, replay));
  }

  enter(): void {
    this.#edges.reset();
  }

  tick(buttons: number): void {
    this.#edges.update(buttons);
    if (
      this.#edges.pressed(Button.Start)
      || this.#edges.pressed(Button.Bomb)
    ) {
      this.fail('video export cancelled');
      return;
    }

    if (this.#phase !== 'recording') return;

    if (this.run.tickCount < this.#replay.length && !this.run.finished) {
      // Live controls belong only to cancel. The simulation reads the replay
      // attached in `replayRunConfig`, exactly like the ordinary viewer.
      this.run.tick(0);
    }

    if (
      this.run.tickCount >= this.#replay.length
      || this.run.finished
    ) {
      if (!this.matchesRecording()) {
        this.fail(
          `replay export: ${this.run.stageName} did not reproduce the recorded outcome`,
        );
        return;
      }
      this.#phase = 'finished';
    }
  }

  /** Called by the shell only after audio is ready and tick-zero was composed. */
  arm(): boolean {
    if (this.#ctx.machine.current !== this || this.#phase !== 'preparing') {
      return false;
    }
    this.#phase = 'recording';
    return true;
  }

  /** Called after the shell has retained the exact final frame for its audio tail. */
  beginStopping(): boolean {
    if (this.#ctx.machine.current !== this || this.#phase !== 'finished') {
      return false;
    }
    this.#phase = 'stopping';
    return true;
  }

  complete(filename: string): boolean {
    if (this.#ctx.machine.current !== this || this.#phase !== 'stopping') {
      return false;
    }
    this.#phase = 'done';
    this.#ctx.machine.replace(
      new ReplayExportResultState(this.#ctx, this.#session, this.#segmentIndex, {
        filename,
      }),
    );
    return true;
  }

  fail(message: string): boolean {
    if (this.#ctx.machine.current !== this || this.#phase === 'done') {
      return false;
    }
    this.#phase = 'done';
    this.#ctx.onReplayError?.(message);
    this.#ctx.machine.replace(
      new ReplayExportResultState(this.#ctx, this.#session, this.#segmentIndex, {
        error: message,
      }),
    );
    return true;
  }

  matchesRecording(): boolean {
    return replayMatchesRun(this.#replay, this.run);
  }

  get phase(): ReplayExportPhase {
    return this.#phase;
  }

  get replay(): Replay {
    return this.#replay;
  }

  get session(): ReplaySession {
    return this.#session;
  }

  get segmentIndex(): number {
    return this.#segmentIndex;
  }

  view(): StateView {
    // The export itself contains gameplay, HUD, dialogue and the existing
    // REPLAY marker — never a preparation/progress card.
    return { kind: 'playing', run: this.run };
  }
}

export class ReplayPlayingState implements GameState {
  readonly name = 'replay-playing';
  readonly run: Run;

  readonly #ctx: GameContext;
  readonly #session: ReplaySession;
  readonly #segmentIndex: number;
  readonly #replay: Replay;
  readonly #continuous: boolean;
  readonly #entryCarry: PlayerCarry | undefined;
  readonly #edges = new Edges();
  #completed = false;

  constructor(
    ctx: GameContext,
    session: ReplaySession,
    segmentIndex: number,
    options: { readonly continuous?: boolean; readonly carry?: PlayerCarry } = {},
  ) {
    const replay = session.segments[segmentIndex];
    if (replay === undefined) {
      throw new Error(`replay viewer: session has no segment ${segmentIndex}`);
    }
    this.#ctx = ctx;
    this.#session = session;
    this.#segmentIndex = segmentIndex;
    this.#replay = replay;
    this.#continuous = options.continuous ?? false;
    this.#entryCarry = options.carry;
    this.run = new Run(replayRunConfig(ctx, replay, options.carry));
  }

  tick(buttons: number): void {
    this.#edges.update(buttons);
    if (this.#edges.pressed(Button.Start)) {
      this.#ctx.machine.push(new ReplayPauseState(this.#ctx, this));
      return;
    }
    if (this.#edges.pressed(Button.Bomb)) {
      this.#ctx.machine.replace(this.back());
      return;
    }

    if (this.run.tickCount < this.#replay.length && !this.run.finished) {
      // The Run reads the recorded mask internally. Live input belongs solely
      // to viewer controls above and never reaches the simulated flight.
      this.run.tick(0);
    }
    if (
      !this.#completed
      && (this.run.tickCount >= this.#replay.length || this.run.finished)
    ) {
      this.#completed = true;
      if (!this.matchesRecording()) {
        this.#ctx.onReplayError?.(
          `replay viewer: ${this.run.stageName} did not reproduce the recorded outcome`,
        );
      }
      this.#ctx.machine.push(new ReplayCompleteState(this.#ctx, this));
    }
  }

  restart(): ReplayPlayingState {
    return new ReplayPlayingState(this.#ctx, this.#session, this.#segmentIndex, {
      continuous: this.#continuous,
      ...(this.#entryCarry === undefined ? {} : { carry: this.#entryCarry }),
    });
  }

  next(): ReplayPlayingState | undefined {
    if (!this.hasNext) return undefined;
    const nextIndex = this.#segmentIndex + 1;
    // Use what the preceding segment ACTUALLY ended with. Run's strict carry
    // metadata check then verifies that the session chain is honest.
    return new ReplayPlayingState(this.#ctx, this.#session, nextIndex, {
      continuous: true,
      carry: this.run.carry,
    });
  }

  get hasNext(): boolean {
    return (
      this.#continuous
      && this.matchesRecording()
      && replayEndReason(this.#replay) === undefined
      && stringMeta(this.#replay, 'outcome') === 'cleared'
      && this.#session.segments[this.#segmentIndex + 1] !== undefined
    );
  }

  back(): ReplaySessionState {
    return new ReplaySessionState(this.#ctx, this.#session);
  }

  get replay(): Replay {
    return this.#replay;
  }

  get session(): ReplaySession {
    return this.#session;
  }

  get segmentIndex(): number {
    return this.#segmentIndex;
  }

  matchesRecording(): boolean {
    return replayMatchesRun(this.#replay, this.run);
  }

  view(): StateView {
    // `playing` makes the shell skip a second menu overlay while still finding
    // this state's public `run` for the ordinary field/HUD renderer.
    return { kind: 'playing', run: this.run };
  }
}

class ReplayPauseState extends MenuState {
  readonly name = 'replay-pause';
  readonly transparent = false;
  readonly #playing: ReplayPlayingState;

  constructor(ctx: GameContext, playing: ReplayPlayingState) {
    super(ctx);
    this.#playing = playing;
  }

  protected get entries(): readonly string[] {
    return ['RESUME', 'RESTART REPLAY', 'EXIT REPLAY'];
  }

  protected confirm(index: number): void {
    if (index === 0) {
      this.ctx.machine.pop();
      return;
    }
    this.ctx.machine.pop();
    this.ctx.machine.replace(index === 1 ? this.#playing.restart() : this.#playing.back());
  }

  protected override cancel(): void {
    this.ctx.machine.pop();
  }

  protected override intercept(): boolean {
    if (!this.edges.pressed(Button.Start)) return false;
    this.ctx.machine.pop();
    return true;
  }

  view(): StateView {
    return {
      kind: 'replay-pause',
      title: 'REPLAY PAUSED',
      menu: this.entries,
      selected: this.selected,
      age: this.age,
    };
  }
}

class ReplayCompleteState extends MenuState {
  readonly name = 'replay-complete';
  readonly transparent = false;
  readonly #playing: ReplayPlayingState;

  constructor(ctx: GameContext, playing: ReplayPlayingState) {
    super(ctx);
    this.#playing = playing;
  }

  protected get entries(): readonly string[] {
    return [
      ...(this.#playing.hasNext ? ['NEXT STAGE'] : []),
      'WATCH AGAIN',
      'EXPORT VIDEO',
      'DOWNLOAD SESSION',
      'BACK',
    ];
  }

  protected confirm(index: number): void {
    if (this.#playing.hasNext && index === 0) {
      try {
        const next = this.#playing.next();
        if (next === undefined) return;
        this.ctx.machine.pop();
        this.ctx.machine.replace(next);
      } catch (error) {
        this.ctx.onReplayError?.((error as Error).message);
      }
      return;
    }
    if (this.#playing.hasNext) index -= 1;
    if (index === 1) {
      const exporting = new ReplayExportState(
        this.ctx,
        this.#playing.session,
        this.#playing.segmentIndex,
      );
      this.ctx.machine.pop();
      this.ctx.machine.replace(exporting);
      return;
    }
    if (index === 2) {
      this.ctx.onDownloadReplay?.(this.#playing.session);
      return;
    }
    this.ctx.machine.pop();
    this.ctx.machine.replace(index === 0 ? this.#playing.restart() : this.#playing.back());
  }

  protected override cancel(): void {
    this.ctx.machine.pop();
    this.ctx.machine.replace(this.#playing.back());
  }

  view(): StateView {
    const replay = this.#playing.replay;
    const run = this.#playing.run;
    const matches = this.#playing.matchesRecording();
    const status = replayStatus(replay).toUpperCase();
    return {
      kind: 'replay-complete',
      title: matches
        ? replayEndReason(replay) === undefined
          ? 'REPLAY COMPLETE'
          : `REPLAY ENDED · ${status}`
        : 'REPLAY MISMATCH',
      lines: [
        `${run.stageName} · ${run.tickCount} / ${replay.length} ticks`,
        ...(matches ? [] : ['recorded outcome did not reproduce exactly']),
      ],
      menu: this.entries,
      selected: this.selected,
      age: this.age,
    };
  }
}

interface ReplayExportResult {
  readonly filename?: string;
  readonly error?: string;
}

class ReplayExportResultState extends MenuState {
  readonly name = 'replay-export-result';
  readonly #session: ReplaySession;
  readonly #segmentIndex: number;
  readonly #result: ReplayExportResult;

  constructor(
    ctx: GameContext,
    session: ReplaySession,
    segmentIndex: number,
    result: ReplayExportResult,
  ) {
    super(ctx);
    this.#session = session;
    this.#segmentIndex = segmentIndex;
    this.#result = result;
  }

  protected get entries(): readonly string[] {
    return ['EXPORT AGAIN', 'BACK'];
  }

  protected confirm(index: number): void {
    this.ctx.machine.replace(
      index === 0
        ? new ReplayExportState(this.ctx, this.#session, this.#segmentIndex)
        : new ReplaySessionState(this.ctx, this.#session),
    );
  }

  protected override cancel(): void {
    this.ctx.machine.replace(new ReplaySessionState(this.ctx, this.#session));
  }

  view(): StateView {
    const error = this.#result.error;
    return {
      kind: 'replay-export-result',
      title: error === undefined ? 'VIDEO EXPORTED' : 'VIDEO EXPORT FAILED',
      lines: [
        error ?? this.#result.filename ?? 'video download ready',
      ],
      menu: this.entries,
      selected: this.selected,
      age: this.age,
    };
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
    const retainingReplay = this.#playing.recordReplay;
    return [
      'RESUME',
      ...(this.ctx.onScreenshot === undefined ? [] : ['TAKE SCREENSHOT']),
      retainingReplay ? 'SAVE + RETRY' : 'RETRY',
      retainingReplay ? 'SAVE + QUIT' : 'QUIT',
    ];
  }

  protected confirm(index: number): void {
    const machine = this.ctx.machine;
    if (this.ctx.onScreenshot !== undefined && index === 1) {
      this.ctx.onScreenshot();
      return;
    }
    if (this.ctx.onScreenshot !== undefined && index > 1) index -= 1;
    switch (index) {
      case 0:
        machine.pop();
        return;
      case 1:
        // Queued in order: the pause leaves first, then the run beneath it is
        // swapped for a new one. Doing it the other way round would replace the
        // pause menu with a run and leave the old one buried under it.
        this.#playing.finalizeReplay('retry');
        machine.pop();
        machine.replace(this.#playing.restart());
        return;
      default:
        this.#playing.finalizeReplay('quit');
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
      age: this.age,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Endings                                                             */
/* ------------------------------------------------------------------ */

/**
 * The pickup-atlas cells the results-card coin tally names — the gold and silver
 * TALLY twins (shadow-correct on a lit card, unlike a field drop). Strings the
 * shell resolves; `states.ts` names them exactly as it names a `scene`, and never
 * imports the renderer. Kept as constants so the two sites that could drift (here
 * and `procedural.ts`'s `pickup.tally.coin.*` floor) read the same name.
 */
const TALLY_COIN_GOLD = 'pickup.tally.coin.gold';
const TALLY_COIN_SILVER = 'pickup.tally.coin.silver';

abstract class EndingState extends MenuState {
  protected readonly playing: PlayingState;

  protected constructor(ctx: GameContext, playing: PlayingState) {
    super(ctx);
    this.playing = playing;
  }

  protected get entries(): readonly string[] {
    return [
      ...(this.session === undefined
        ? []
        : ['WATCH REPLAY', 'EXPORT VIDEO', 'DOWNLOAD REPLAY']),
      'RETRY',
      'TITLE',
    ];
  }

  protected confirm(index: number): void {
    const machine = this.ctx.machine;
    const session = this.session;
    if (session !== undefined) {
      if (index === 0) {
        const segmentIndex = session.segments.length - 1;
        try {
          const replay = new ReplayPlayingState(this.ctx, session, segmentIndex);
          // The result card leaves, then the finished live run beneath it is
          // replaced by the viewer. Same two-step stack discipline as RETRY.
          machine.pop();
          machine.replace(replay);
        } catch (error) {
          this.ctx.onReplayError?.((error as Error).message);
        }
        return;
      }
      if (index === 1) {
        const segmentIndex = session.segments.length - 1;
        try {
          const exporting = new ReplayExportState(this.ctx, session, segmentIndex);
          machine.pop();
          machine.replace(exporting);
        } catch (error) {
          this.ctx.onReplayError?.((error as Error).message);
        }
        return;
      }
      if (index === 2) {
        this.ctx.onDownloadReplay?.(session);
        return;
      }
      index -= 3;
    }
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

  private get session(): ReplaySession | undefined {
    return findSession(this.ctx, this.playing.sessionId);
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

  /**
   * The run's loot as a two-coin tally for the results card (战役扩容轮). Both
   * denominations are always present so the renderer's coin names always resolve,
   * even at zero. `sprite` is a string the shell maps to a pickup-atlas cell — the
   * game never learns the coins are drawn (the `background`/`scene` boundary).
   */
  protected coinTally(): readonly { readonly sprite: string; readonly count: number }[] {
    const coins = this.playing.run.coins;
    return [
      { sprite: TALLY_COIN_GOLD, count: coins.gold },
      { sprite: TALLY_COIN_SILVER, count: coins.silver },
    ];
  }
}

export class GameOverState extends EndingState {
  readonly name = 'game-over';

  /**
   * The scene the shell reconciles to while game over is up — the twin of
   * `EndingScreenState.music`, read off the stack the same way (`main.ts`'s scene
   * reconcile, mirroring music precedence). The finished run's own `run.scene`
   * has fallen back to the stage or boss field it died on; the run's END wants
   * its own — `signal-decay`, clean harmonics dissolving into warm noise. A
   * string the game names and the shell resolves; `src/game` imports no renderer.
   */
  readonly scene = 'signal-decay';

  constructor(ctx: GameContext, playing: PlayingState) {
    super(ctx, playing);
  }

  view(): StateView {
    return {
      kind: 'game-over',
      title: 'GAME OVER',
      lines: this.scoreLines(),
      tally: this.coinTally(),
      menu: this.entries,
      selected: this.selected,
      age: this.age,
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
      tally: this.coinTally(),
      menu: this.entries,
      selected: this.selected,
      age: this.age,
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

  /**
   * The scene the shell reconciles to for the ending, the visual twin of `music`
   * above and read off the stack exactly the same way (`main.ts`'s scene
   * reconcile, mirroring music precedence). The finished run's own `run.scene`
   * reports the field it cleared on; the ending wants its own — `signal-decay`,
   * the apparatus decaying into noise as it goes quiet. A string, resolved in the
   * shell, because `src/game` may not import the renderer.
   */
  readonly scene = 'signal-decay';

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
      age: this.age,
    };
  }
}
