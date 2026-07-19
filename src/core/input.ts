/**
 * Input: keyboard and gamepad collapsed into one digital button mask.
 *
 * The simulation never sees a device. It sees `Buttons`, a bitmask sampled
 * exactly once per tick. This is what makes input recordable and replayable:
 * a replay is a frame-indexed log of this mask and nothing else.
 *
 * Two hazards this module exists to contain — see CLAUDE.md, rule 2:
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

/** Below this magnitude a stick reads as centred. Fixed — never make it a setting. */
const DEADZONE = 0.5;

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
    this.#previous = this.#current;
    this.#current = this.#keys | this.#latched | this.#pollPads();
    this.#latched = 0;
    return this.#current;
  }

  #pollPads(): Buttons {
    // getGamepads may be absent (older/locked-down browsers) and returns a
    // sparse array with nulls for disconnected slots.
    const pads = navigator.getGamepads?.() ?? [];
    let mask = 0;

    for (const pad of pads) {
      if (!pad?.connected) continue;

      for (const [index, bit] of PAD_BUTTON_MAP) {
        if (pad.buttons[index]?.pressed) mask |= bit;
      }

      // Left stick → digital directions. Quantized, so analog precision never
      // reaches the sim and a replay can reproduce it exactly.
      const x = pad.axes[0] ?? 0;
      const y = pad.axes[1] ?? 0;
      if (x <= -DEADZONE) mask |= Button.Left;
      if (x >= DEADZONE) mask |= Button.Right;
      if (y <= -DEADZONE) mask |= Button.Up;
      if (y >= DEADZONE) mask |= Button.Down;
    }

    return mask;
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
}
