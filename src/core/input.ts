/**
 * Input: keyboard and gamepad collapsed into one digital button mask.
 *
 * The simulation never sees a device. It sees `Buttons`, a bitmask sampled
 * exactly once per tick. This is what makes input recordable and replayable:
 * a replay is a frame-indexed log of this mask and nothing else.
 *
 * Two hazards this module exists to contain — see CLAUDE.md, rule 4:
 *
 *  - Gamepads are *polled*, not evented. Polling must happen on the tick, not
 *    on the render frame, or the sampled value depends on frame rate.
 *  - Sticks are *analog*. Raw axis values must never reach the sim. They are
 *    quantized here against fixed thresholds, so the same physical input always
 *    produces the same mask.
 */

export const Button = {
  Left: 1 << 0,
  Right: 1 << 1,
  Up: 1 << 2,
  Down: 1 << 3,
  Shot: 1 << 4,
  Bomb: 1 << 5,
  Slow: 1 << 6,
  Start: 1 << 7,
} as const;

export type Buttons = number;

/**
 * An event-fed device contributes one already-quantized digital mask per tick.
 * `consume()` owns tap latching; `Input.sample()` remains the only place where
 * live sources are merged for the simulation.
 */
export interface DigitalInputSource {
  consume(): Buttons;
  reset(): void;
  /**
   * True when this source is a game controller read by another path (the
   * WebHID Xbox reader). It never changes the mask; it only stops this
   * source's activity from counting as "the player's hands left the pad"
   * for `Input.activeGamepad`, because the same physical pad can arrive
   * through WebHID and the standard Gamepad API at once.
   */
  readonly isGamepad?: boolean;
}

/**
 * How many consecutive samples the standard pads must contribute nothing
 * before keyboard or non-pad source input counts as the player having moved
 * off the pad (half a second at 60 Hz). A hysteresis, so one stray mouse nudge
 * or key brush mid-fight cannot hand rumble away from the pad in the player's
 * hands. Presentation only: it affects `activeGamepad`, never the mask.
 */
export const PAD_HANDOVER_SAMPLES = 30;

/** Below this magnitude a stick reads as centred. Fixed — never make it a setting. */
export const STICK_DEADZONE = 0.5;

/**
 * Quantize a normalised left stick into the same digital directions for every
 * live input backend. Keeping this at the device boundary is load-bearing:
 * analog precision must never reach the simulation (CLAUDE.md, rule 4).
 */
export function quantizeStick(x: number, y: number): Buttons {
  let mask = 0;
  if (x <= -STICK_DEADZONE) mask |= Button.Left;
  if (x >= STICK_DEADZONE) mask |= Button.Right;
  if (y <= -STICK_DEADZONE) mask |= Button.Up;
  if (y >= STICK_DEADZONE) mask |= Button.Down;
  return mask;
}

const KEY_MAP: Readonly<Record<string, number>> = {
  ArrowLeft: Button.Left,
  ArrowRight: Button.Right,
  ArrowUp: Button.Up,
  ArrowDown: Button.Down,
  KeyZ: Button.Shot,
  KeyX: Button.Bomb,
  ShiftLeft: Button.Slow,
  ShiftRight: Button.Slow,
  Space: Button.Start,
};

/** Standard Gamepad layout button indices → our buttons. */
const PAD_BUTTON_MAP: ReadonlyArray<readonly [number, number]> = [
  [0, Button.Shot], // A / Cross
  [1, Button.Bomb], // B / Circle
  [2, Button.Bomb], // X / Square
  [4, Button.Slow], // L1
  [5, Button.Slow], // R1
  [6, Button.Slow], // L2
  [7, Button.Slow], // R2
  [9, Button.Start], // Start / Options
  [12, Button.Up], // D-pad
  [13, Button.Down],
  [14, Button.Left],
  [15, Button.Right],
];

export class Input {
  /** Keyboard state, updated by events between ticks. */
  #keys: Buttons = 0;
  readonly #sources: readonly DigitalInputSource[];

  /**
   * Sticky record of every key that went down since the last `sample()`.
   *
   * Key events arrive between ticks. A tap that both presses and releases
   * inside one tick interval would otherwise be invisible to the sim — the
   * bit is set and cleared before anything reads it. That drops bombs and
   * shots, which is unacceptable in a danmaku game. Latching guarantees a tap
   * is seen for at least one tick.
   */
  #latched: Buttons = 0;

  /** The mask the sim reads. Only `sample()` may write it. */
  #current: Buttons = 0;
  #previous: Buttons = 0;

  /*
   * Which pad the player is holding — for rumble output, never for the sim.
   *
   * None of this is simulation state: nothing in the mask, the latch or the
   * edges reads it, `reset()` leaves it alone and `override()` never touches
   * it. It is derived ONLY from values `sample()` already computes, so
   * tracking it cannot add a `consume()`, a `getGamepads()` call or a
   * reordering to the replay-relevant path (CLAUDE.md, rule 4).
   */
  #lastGamepad: number | undefined;
  /** Set by `#pollPads()`: did any standard pad contribute a non-zero mask this sample? */
  #padContributed = false;
  /** Consecutive samples, the current one included, in which no standard pad contributed. */
  #padIdleSamples = 0;
  /** Keyboard / non-pad input arrived after the pad had been idle long enough. */
  #handedOver = false;

  constructor(sources: readonly DigitalInputSource[] = []) {
    this.#sources = [...sources];
  }

  #onKeyDown = (e: KeyboardEvent): void => {
    const bit = KEY_MAP[e.code];
    if (bit === undefined) return;
    e.preventDefault();
    if (e.repeat) return; // OS auto-repeat is not a new press.
    this.#keys |= bit;
    this.#latched |= bit;
  };

  #onKeyUp = (e: KeyboardEvent): void => {
    const bit = KEY_MAP[e.code];
    if (bit === undefined) return;
    e.preventDefault();
    this.#keys &= ~bit;
  };

  attach(target: EventTarget = window): void {
    target.addEventListener('keydown', this.#onKeyDown as EventListener);
    target.addEventListener('keyup', this.#onKeyUp as EventListener);
  }

  detach(target: EventTarget = window): void {
    target.removeEventListener('keydown', this.#onKeyDown as EventListener);
    target.removeEventListener('keyup', this.#onKeyUp as EventListener);
  }

  /**
   * Collapse every connected device into one mask.
   * Call this once at the top of each tick — never from render.
   */
  sample(): Buttons {
    let sourced = 0;
    // Bits from sources that are NOT a game controller (pointer, touch). The
    // per-source result is captured from the one existing `consume()` call;
    // it only feeds `activeGamepad`, never the mask.
    let offPad = 0;
    for (const source of this.#sources) {
      const bits = source.consume();
      sourced |= bits;
      if (source.isGamepad !== true) offPad |= bits;
    }

    this.#previous = this.#current;
    // Same operands, same evaluation order as a single expression: keys,
    // latch, sources, then the pad poll.
    const keyed = this.#keys | this.#latched;
    const padded = this.#pollPads();
    this.#current = keyed | sourced | padded;
    this.#latched = 0;

    this.#trackHandover(keyed | offPad);
    return this.#current;
  }

  #pollPads(): Buttons {
    // getGamepads may be absent (older/locked-down browsers) and returns a
    // sparse array with nulls for disconnected slots.
    const pads = navigator.getGamepads?.() ?? [];
    let mask = 0;

    // Array position, counted rather than read from `pad.index`: the two are
    // equal in the Gamepad API, and counting works for every iterable this
    // loop already accepts. Every slot is still visited, in order.
    let slot = -1;
    let contributor: number | undefined;
    let lastStillConnected = false;

    for (const pad of pads) {
      slot++;
      if (!pad?.connected) continue;
      if (slot === this.#lastGamepad) lastStillConnected = true;

      let padMask = 0;
      for (const [index, bit] of PAD_BUTTON_MAP) {
        if (pad.buttons[index]?.pressed) padMask |= bit;
      }

      // Left stick → digital directions. Quantized, so analog precision never
      // reaches the sim and a replay can reproduce it exactly.
      padMask |= quantizeStick(pad.axes[0] ?? 0, pad.axes[1] ?? 0);

      mask |= padMask;
      // Two pads contributing in one sample: the later slot wins.
      if (padMask !== 0) contributor = slot;
    }

    if (!lastStillConnected) this.#lastGamepad = undefined;
    if (contributor !== undefined) this.#lastGamepad = contributor;
    this.#padContributed = contributor !== undefined;

    return mask;
  }

  /**
   * Hysteresis for `activeGamepad`. `offPad` is keyboard (held | latched)
   * plus every non-`isGamepad` source's bits for this sample.
   */
  #trackHandover(offPad: Buttons): void {
    if (this.#padContributed) {
      this.#padIdleSamples = 0;
      this.#handedOver = false;
      return;
    }
    if (this.#padIdleSamples < PAD_HANDOVER_SAMPLES) this.#padIdleSamples++;
    if (offPad !== 0 && this.#padIdleSamples >= PAD_HANDOVER_SAMPLES) {
      this.#handedOver = true;
    }
  }

  /**
   * Array position in `navigator.getGamepads()` of the standard pad that most
   * recently contributed a non-zero mask to `sample()`. Cleared only when that
   * slot is empty or disconnected at a later sample. Presentation only — the
   * rumble target, never read by the simulation.
   */
  get lastGamepad(): number | undefined {
    return this.#lastGamepad;
  }

  /**
   * `lastGamepad`, unless the player's hands have moved elsewhere: keyboard or
   * a non-`isGamepad` source produced input after the pads had contributed
   * nothing for at least `PAD_HANDOVER_SAMPLES` consecutive samples (the
   * current one included). It returns to the pad the next time any standard
   * pad contributes. An `isGamepad` source (the WebHID mirror of the same pad)
   * never hands it away.
   */
  get activeGamepad(): number | undefined {
    return this.#handedOver ? undefined : this.#lastGamepad;
  }

  /** State as of the last `sample()`. */
  get buttons(): Buttons {
    return this.#current;
  }

  held(button: number): boolean {
    return (this.#current & button) !== 0;
  }

  /** True only on the tick the button went down. */
  pressed(button: number): boolean {
    return (this.#current & button) !== 0 && (this.#previous & button) === 0;
  }

  released(button: number): boolean {
    return (this.#current & button) === 0 && (this.#previous & button) !== 0;
  }

  /** Feed a recorded mask instead of live devices, for replay playback. */
  override(buttons: Buttons): void {
    this.#previous = this.#current;
    this.#current = buttons;
  }

  /**
   * Clear all state for a fresh run.
   *
   * A button held or latched at game over would otherwise survive into tick 0
   * of the next run — `#keys` and `#latched` are only ever mutated by device
   * events, so nothing else clears them. `#previous` is cleared too, so the
   * tick after a reset cannot read a spurious `pressed`/`released` edge
   * against whatever was true before the reset.
   *
   * `lastGamepad` / `activeGamepad` are deliberately NOT cleared: they are
   * not simulation state, and the pad in the player's hands is the same one
   * after a restart.
   */
  reset(): void {
    this.#keys = 0;
    this.#latched = 0;
    this.#current = 0;
    this.#previous = 0;
    for (const source of this.#sources) source.reset();
  }
}
