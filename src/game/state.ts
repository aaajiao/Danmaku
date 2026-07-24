/**
 * The game's state machine — a stack, not an index.
 *
 * Upstream kept its screens in a flat array and "switched" by assigning an
 * index (`source/Game.js`), which cannot express an overlay: a pause menu or a
 * spell-card announcement drawn *over* live play has nowhere to live, because
 * the moment you select the overlay the screen underneath stops existing. A
 * stack has room for both, and popping restores what was there rather than
 * rebuilding it.
 *
 * ## Two axes, deliberately separate
 *
 * `transparent` governs **ticking** only: a transparent state lets the one
 * beneath it keep simulating, which is what a spell-card announcement wants and
 * what a pause menu must never have.
 *
 * **Rendering always walks the whole stack, bottom-up.** A state does not have
 * to declare anything to be drawn under: a fullscreen state simply paints over
 * what is beneath it. Tying "draws through" to "ticks through" would force pause
 * to choose between freezing the field and showing it, and it wants both.
 *
 * ## Transitions are deferred
 *
 * A state calling `push`/`pop`/`replace` from inside its own `tick` is the
 * normal case, not an edge case — that is how every screen change happens. So
 * transitions queue and are applied after the tick walk finishes. Applying them
 * immediately would mutate the array being iterated, and the state that just
 * asked to be popped would keep ticking through the rest of the walk.
 *
 * ## No renderer here
 *
 * Nothing in `src/game` imports three.js. States describe *what* to draw as
 * plain data (`view()`); `main.ts` decides how. That is the same rule that keeps
 * `src/sim` engine-agnostic, applied one layer up, and it is what lets a state
 * be driven headlessly in a test.
 */

/**
 * A state's declaration of what should be on screen. Plain data: no colours, no
 * fonts, no coordinates. The renderer owns presentation, and a state that
 * started specifying pixels would have to be edited to restyle the game.
 *
 * `run` is how `PlayingState` hands the live simulation to the renderer without
 * either of them knowing about the other's types.
 */
export interface StateView {
  /** Stable discriminator for the renderer to switch on. */
  readonly kind: string;
  readonly title?: string;
  /** Free-form label lines, drawn in order. */
  readonly lines?: readonly string[];
  /** Selectable entries, if this state is a menu. */
  readonly menu?: readonly string[];
  /** Index into `menu`. */
  readonly selected?: number;
  /**
   * Optional shell-only actions aligned with `menu`.
   *
   * Used for browser gestures such as opening a file chooser. The game names an
   * opaque action string; the shell resolves it from the real DOM click/keydown
   * before the fixed-tick menu path consumes the gesture.
   */
  readonly menuActions?: readonly (string | undefined)[];
  /**
   * Fixed-tick age of a presentation state.  Used only for deterministic UI
   * animation (cursor pulse, result coins); it never enters a Run or replay.
   */
  readonly age?: number;
  /**
   * Character registry name selected by a roster view. A string across the
   * boundary; the game layer never learns whether it resolves to a sprite,
   * portrait or neither.
   */
  readonly character?: string;
  /**
   * Icon-and-count rows for a results card (the ending screens' coin tally).
   * `sprite` is a STRING the renderer resolves to a pickup-atlas cell — the same
   * name-across-the-boundary rule `StageSpec.background` follows, so `state.ts`
   * never learns the coins are drawn from an atlas.
   */
  readonly tally?: readonly { readonly sprite: string; readonly count: number }[];
  /** Shell-only live replay-retention marker for the in-field HUD. */
  readonly recording?: boolean;
  /** The live simulation, if this state owns one. Typed loosely on purpose:
   *  `state.ts` must not depend on `run.ts`, or the two cannot be read apart. */
  readonly run?: unknown;
}

export interface GameState {
  readonly name: string;

  /** `previous` is the state this one displaced or was pushed over. */
  enter?(previous?: GameState): void;
  exit?(): void;

  /**
   * One simulation tick, with the button mask sampled for it.
   *
   * A state drives the machine by calling `push`/`pop`/`replace` on the machine
   * it was constructed with, rather than by returning a state. Returning one
   * can express "go here next" and nothing else — not "push an overlay and stay
   * beneath it", not "pop two", not "do nothing but start a fade".
   */
  tick(buttons: number): void;

  /** Optional per-frame hook. `alpha` is the 0..1 interpolation factor. */
  render?(alpha: number): void;

  /** What should be on screen. Omit for a state that draws nothing itself. */
  view?(): StateView;

  /** When true, the state below still ticks. See the header. */
  readonly transparent?: boolean;

  /**
   * A one-tick UI sound the SHELL should play, named as a string the game does
   * not resolve — exactly like a scene name (`src/game` imports no audio). Set
   * by a menu on the tick of a semantic move/confirm/cancel and cleared at the
   * top of its next tick, so it names the sound for exactly the frame the action
   * happened. Read in `main.ts` off the state that *ticked* (captured before the
   * tick, because a confirm/cancel transitions that state away before the read).
   * Only menu/pause/ending states ever set it — never a `Run` or anything a
   * golden/replay pilot drives (see `game/cues.ts` `SHELL_CUES`).
   */
  cue?: string;
}

type Transition =
  | { readonly kind: 'push'; readonly state: GameState }
  | { readonly kind: 'pop' }
  | { readonly kind: 'replace'; readonly state: GameState }
  | { readonly kind: 'clear' };

export class StateMachine {
  readonly #stack: GameState[] = [];

  /** Queued while a tick walk is in progress. See the header. */
  readonly #pending: Transition[] = [];
  #walking = false;

  get current(): GameState | undefined {
    return this.#stack[this.#stack.length - 1];
  }

  /** Bottom-first. The renderer walks this to draw overlays over their base. */
  get stack(): readonly GameState[] {
    return this.#stack;
  }

  get depth(): number {
    return this.#stack.length;
  }

  push(state: GameState): void {
    this.#request({ kind: 'push', state });
  }

  pop(): void {
    this.#request({ kind: 'pop' });
  }

  replace(state: GameState): void {
    this.#request({ kind: 'replace', state });
  }

  /** Empty the stack, exiting everything. For teardown and for tests. */
  clear(): void {
    this.#request({ kind: 'clear' });
  }

  #request(transition: Transition): void {
    if (this.#walking) {
      this.#pending.push(transition);
      return;
    }
    this.#apply(transition);
  }

  #apply(transition: Transition): void {
    switch (transition.kind) {
      case 'push': {
        const previous = this.current;
        this.#stack.push(transition.state);
        transition.state.enter?.(previous);
        return;
      }
      case 'pop': {
        const state = this.#stack.pop();
        state?.exit?.();
        return;
      }
      case 'replace': {
        const previous = this.#stack.pop();
        previous?.exit?.();
        this.#stack.push(transition.state);
        // The displaced state is handed over, not the one now beneath: a
        // replacement usually wants to know what it came from.
        transition.state.enter?.(previous);
        return;
      }
      case 'clear': {
        while (this.#stack.length > 0) {
          this.#stack.pop()?.exit?.();
        }
        return;
      }
    }
  }

  /**
   * Tick the top of the stack, and everything beneath it that a `transparent`
   * state is letting through.
   *
   * The walk runs bottom-up within that span, so the world has already advanced
   * by the time an overlay above it reads anything.
   */
  tick(buttons: number): void {
    const base = this.#base();
    if (base < 0) return;

    // Snapshot: a transition applied mid-walk would otherwise shift indices.
    // (It cannot — transitions are deferred — but the walk must also survive a
    // state that reaches for the machine through some other path.)
    const span = this.#stack.slice(base);

    this.#walking = true;
    try {
      for (const state of span) state.tick(buttons);
    } finally {
      this.#walking = false;
    }

    this.#flush();
  }

  /** Every state draws, bottom-up. See the header for why this is not gated. */
  render(alpha: number): void {
    const span = this.#stack.slice();

    this.#walking = true;
    try {
      for (const state of span) state.render?.(alpha);
    } finally {
      this.#walking = false;
    }

    this.#flush();
  }

  /**
   * Lowest index that ticks this frame: walk down from the top while each
   * state is transparent. The bottom of the stack always stops the walk.
   */
  #base(): number {
    let index = this.#stack.length - 1;
    while (index > 0 && this.#stack[index]?.transparent === true) index--;
    return index;
  }

  #flush(): void {
    // Applied in the order requested, and `#apply` may not itself queue —
    // `#walking` is false by now, so a transition raised from `enter`/`exit`
    // takes effect immediately and in place, which is what makes a state that
    // enters and instantly redirects behave the same as one that does it on
    // its first tick.
    while (this.#pending.length > 0) {
      const transition = this.#pending.shift();
      if (transition !== undefined) this.#apply(transition);
    }
  }

  /** Bottom-up views for the renderer. Skips states that describe nothing. */
  views(): readonly StateView[] {
    const views: StateView[] = [];
    for (const state of this.#stack) {
      const view = state.view?.();
      if (view !== undefined) views.push(view);
    }
    return views;
  }
}

/**
 * Press-edge tracker.
 *
 * Menus need "was pressed this tick", not "is held" — a title screen reading
 * held bits falls through three screens in three ticks. Derived here from the
 * mask rather than read from `Input.pressed`, because a replay is a log of
 * masks and nothing else (CLAUDE.md, rule 4): anything the sim reacts to has to
 * be reconstructible from that log alone.
 *
 * The first `update` of a state's life reports no edges at all. A state pushed
 * on the tick a button went down would otherwise see that same press as its own
 * edge and act on it immediately — the bug where opening a pause menu closes it
 * on the same press.
 */
export class Edges {
  #previous = 0;
  #edges = 0;
  #first = true;

  /** Call once per tick, before reading. */
  update(buttons: number): void {
    this.#edges = this.#first ? 0 : buttons & ~this.#previous;
    this.#previous = buttons;
    this.#first = false;
  }

  /** True if `bit` went down on this tick. */
  pressed(bit: number): boolean {
    return (this.#edges & bit) !== 0;
  }

  held(bit: number): boolean {
    return (this.#previous & bit) !== 0;
  }

  /** Back to "nothing has been seen yet", so the next tick reports no edges. */
  reset(): void {
    this.#previous = 0;
    this.#edges = 0;
    this.#first = true;
  }
}
