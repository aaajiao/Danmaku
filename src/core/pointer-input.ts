/**
 * Pointer input adapters.
 *
 * The browser may know an absolute cursor target or a clicked menu row, but the
 * simulation never does. Both adapters collapse those facts into the same
 * digital `Buttons` mask sampled by `Input` once per fixed tick
 * (CLAUDE.md, rule 4).
 */

import {
  Button,
  type Buttons,
  type DigitalInputSource,
} from './input';

/** Close enough to the cursor target to stop without oscillating past it. */
export const POINTER_TARGET_DEADZONE = 5;

export interface PointerSurface extends EventTarget {
  getBoundingClientRect(): Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Turns an absolute cursor target into digital steering.
 *
 * `setOrigin` receives the current player position from the browser shell. The
 * target remains private here; `consume()` is the only value that reaches the
 * game, so recordings remain frame-indexed button masks.
 */
export class PointerPositionInput implements DigitalInputSource {
  readonly #width: number;
  readonly #height: number;
  #surface: PointerSurface | undefined;
  #target: Point | undefined;
  #origin: Point | undefined;

  constructor(width: number, height: number) {
    this.#width = width;
    this.#height = height;
  }

  #onPointerMove = (event: Event): void => {
    const pointer = event as PointerEvent;
    if (pointer.pointerType !== '' && pointer.pointerType !== 'mouse') return;

    const rect = this.#surface?.getBoundingClientRect();
    if (
      rect === undefined
      || rect.width <= 0
      || rect.height <= 0
      || !Number.isFinite(pointer.clientX)
      || !Number.isFinite(pointer.clientY)
    ) {
      return;
    }

    const x = Math.round(
      (pointer.clientX - rect.left) * this.#width / rect.width,
    );
    const y = Math.round(
      (pointer.clientY - rect.top) * this.#height / rect.height,
    );
    this.#target = {
      x: Math.max(0, Math.min(this.#width, x)),
      y: Math.max(0, Math.min(this.#height, y)),
    };
  };

  #onPointerLeave = (): void => {
    this.clearTarget();
  };

  attach(surface: PointerSurface): void {
    if (this.#surface === surface) return;
    this.detach();
    this.#surface = surface;
    surface.addEventListener('pointermove', this.#onPointerMove);
    surface.addEventListener('pointerleave', this.#onPointerLeave);
  }

  detach(): void {
    this.#surface?.removeEventListener('pointermove', this.#onPointerMove);
    this.#surface?.removeEventListener('pointerleave', this.#onPointerLeave);
    this.#surface = undefined;
    this.reset();
  }

  /** Arm steering for the current tick from the player's deterministic pose. */
  setOrigin(x: number, y: number): void {
    this.#origin = { x, y };
  }

  /** Menus and paused/result screens do not consume cursor steering. */
  clearOrigin(): void {
    this.#origin = undefined;
  }

  /** A state transition requires a fresh pointer move before steering resumes. */
  clearTarget(): void {
    this.#target = undefined;
  }

  consume(): Buttons {
    if (this.#origin === undefined || this.#target === undefined) return 0;

    let buttons = 0;
    if (this.#target.x < this.#origin.x - POINTER_TARGET_DEADZONE) {
      buttons |= Button.Left;
    } else if (this.#target.x > this.#origin.x + POINTER_TARGET_DEADZONE) {
      buttons |= Button.Right;
    }
    if (this.#target.y < this.#origin.y - POINTER_TARGET_DEADZONE) {
      buttons |= Button.Up;
    } else if (this.#target.y > this.#origin.y + POINTER_TARGET_DEADZONE) {
      buttons |= Button.Down;
    }
    return buttons;
  }

  reset(): void {
    this.#target = undefined;
    this.#origin = undefined;
  }
}

/**
 * Convert a direct menu-row click into ordinary navigation/confirm masks.
 *
 * A zero tick separates repeated directions because menus act on press edges.
 * The shortest wrapping path is used; ties move forward.
 */
export function menuPointerSequence(
  selected: number,
  target: number,
  count: number,
): readonly Buttons[] {
  if (
    !Number.isInteger(selected)
    || !Number.isInteger(target)
    || !Number.isInteger(count)
    || count <= 0
    || selected < 0
    || selected >= count
    || target < 0
    || target >= count
  ) {
    return [];
  }

  const forward = (target - selected + count) % count;
  const backward = (selected - target + count) % count;
  const steps = Math.min(forward, backward);
  const direction = forward <= backward ? Button.Down : Button.Up;
  const sequence: Buttons[] = [];
  for (let step = 0; step < steps; step++) {
    sequence.push(direction, 0);
  }
  sequence.push(Button.Shot);
  return sequence;
}

/** Event-fed queue used by transparent DOM hit targets over canvas menu rows. */
export class MenuPointerInput implements DigitalInputSource {
  #queue: Buttons[] = [];
  #next = 0;

  queueSelection(selected: number, target: number, count: number): void {
    this.#queue = [...menuPointerSequence(selected, target, count)];
    this.#next = 0;
  }

  consume(): Buttons {
    const buttons = this.#queue[this.#next] ?? 0;
    if (this.#next < this.#queue.length) this.#next++;
    if (this.#next >= this.#queue.length) {
      this.#queue = [];
      this.#next = 0;
    }
    return buttons;
  }

  reset(): void {
    this.#queue = [];
    this.#next = 0;
  }
}
