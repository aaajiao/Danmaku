/**
 * Touch controls collapsed into the same digital mask as every other device.
 *
 * Pointer/Touch callbacks only update private, already-quantized state. The
 * simulation observes that state once per fixed tick through
 * `Input.sample()` -> `consume()` (CLAUDE.md, rule 4).
 */

import {
  Button,
  type Buttons,
  type DigitalInputSource,
} from './input';

/** Fixed central neutral area, expressed as a fraction of the stick radius. */
export const TOUCH_STICK_DEADZONE = 0.24;

/**
 * tan(22.5deg), written as a constant so touch quantization needs no
 * engine-approximated trigonometry inside the deterministic core tree.
 */
const CARDINAL_SECTOR_RATIO = 0.41421356237309503;

type TouchActionButton =
  | typeof Button.Shot
  | typeof Button.Bomb
  | typeof Button.Start;

interface PointerCaptureSurface extends EventTarget {
  setPointerCapture?(pointerId: number): void;
  releasePointerCapture?(pointerId: number): void;
}

export interface TouchActionSurface extends PointerCaptureSurface {}

export interface TouchStickSurface extends PointerCaptureSurface {
  getBoundingClientRect(): Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;
}

interface StickPointer {
  direction: Buttons;
  order: number;
}

interface StickBinding {
  readonly surface: TouchStickSurface;
  readonly pointers: Map<number, StickPointer>;
  readonly touchPointerIds: Set<number>;
  readonly onPointerDown: EventListener;
  readonly onPointerMove: EventListener;
  readonly onPointerEnd: EventListener;
  readonly onLostPointerCapture: EventListener;
  readonly onTouchStart: EventListener;
  readonly onTouchMove: EventListener;
  readonly onTouchEnd: EventListener;
}

interface ActionBinding {
  readonly surface: TouchActionSurface;
  readonly button: TouchActionButton;
  readonly pointers: Set<number>;
  readonly touchPointerIds: Set<number>;
  readonly onPointerDown: EventListener;
  readonly onPointerEnd: EventListener;
  readonly onLostPointerCapture: EventListener;
  readonly onClick: EventListener;
  readonly onTouchStart: EventListener;
  readonly onTouchEnd: EventListener;
}

function pointerId(event: Event): number | undefined {
  const id = (event as PointerEvent).pointerId;
  return Number.isInteger(id) && id >= 0 ? id : undefined;
}

function isPrimaryPointerDown(event: Event): boolean {
  const button = (event as PointerEvent).button;
  return button === undefined || button === 0;
}

interface TouchPoint {
  readonly identifier: number;
  readonly clientX: number;
  readonly clientY: number;
}

/**
 * Touch identifiers are mapped below zero so they cannot collide with the
 * non-negative PointerEvent ids accepted above.
 */
function touchId(touch: TouchPoint): number | undefined {
  return Number.isInteger(touch.identifier) && touch.identifier >= 0
    ? -touch.identifier - 1
    : undefined;
}

function changedTouches(event: Event): readonly TouchPoint[] {
  const list = (event as TouchEvent).changedTouches;
  if (list === undefined) return [];

  const touches: TouchPoint[] = [];
  for (let index = 0; index < list.length; index++) {
    const touch = list.item(index);
    if (touch !== null) touches.push(touch);
  }
  return touches;
}

function capture(surface: PointerCaptureSurface, id: number): void {
  try {
    surface.setPointerCapture?.(id);
  } catch {
    // A detached surface or an already-ended pointer may refuse capture.
  }
}

function release(surface: PointerCaptureSurface, id: number): void {
  try {
    surface.releasePointerCapture?.(id);
  } catch {
    // Release is best-effort because browsers also release implicitly on up.
  }
}

/**
 * Convert one pointer coordinate to one of the stick's eight digital sectors.
 *
 * Coordinates are normalised per axis so a non-square CSS box does not skew
 * its diagonal sectors. Only exact arithmetic and `Math.abs` are used here:
 * no analog value or approximated angle reaches the simulation.
 */
function quantizeStickPoint(
  surface: TouchStickSurface,
  clientX: number,
  clientY: number,
): Buttons | undefined {
  const rect = surface.getBoundingClientRect();
  if (
    rect.width <= 0
    || rect.height <= 0
    || !Number.isFinite(rect.left)
    || !Number.isFinite(rect.top)
    || !Number.isFinite(rect.width)
    || !Number.isFinite(rect.height)
    || !Number.isFinite(clientX)
    || !Number.isFinite(clientY)
  ) {
    return undefined;
  }

  const x = (clientX - rect.left) * 2 / rect.width - 1;
  const y = (clientY - rect.top) * 2 / rect.height - 1;
  if (x * x + y * y <= TOUCH_STICK_DEADZONE * TOUCH_STICK_DEADZONE) {
    return 0;
  }

  const absX = Math.abs(x);
  const absY = Math.abs(y);
  const horizontal = x < 0 ? Button.Left : Button.Right;
  const vertical = y < 0 ? Button.Up : Button.Down;

  if (absY <= absX * CARDINAL_SECTOR_RATIO) return horizontal;
  if (absX <= absY * CARDINAL_SECTOR_RATIO) return vertical;
  return horizontal | vertical;
}

/**
 * Event-fed virtual stick plus A/B/Start source.
 *
 * Direction events keep only the latest sector, including neutral, until
 * sampled. This is deliberately an overwrite, not an OR: a quick Left -> Right
 * slide before one tick reports Right, while returning to centre cancels the
 * unsampled direction. Pointer release does not clear that pending sector, so
 * quick menu taps are not lost. Action buttons use rising-edge latches.
 */
export class TouchInput implements DigitalInputSource {
  #stick: StickBinding | undefined;
  readonly #actions = new Map<TouchActionSurface, ActionBinding>();
  #directionLatch: Buttons = 0;
  #hasDirectionLatch = false;
  #actionLatch: Buttons = 0;
  #eventOrder = 0;
  readonly #endTarget: EventTarget | undefined;

  /**
   * `endTarget` is normally `window`. It clears contacts that end outside a
   * control when an older WebKit build refuses explicit pointer capture.
   */
  constructor(endTarget?: EventTarget) {
    this.#endTarget = endTarget;
  }

  attachStick(surface: TouchStickSurface): void {
    if (this.#stick?.surface === surface) return;
    this.#detachStick();

    const pointers = new Map<number, StickPointer>();
    const touchPointerIds = new Set<number>();
    const updateDirection = (
      id: number,
      clientX: number,
      clientY: number,
    ): boolean => {
      const direction = quantizeStickPoint(surface, clientX, clientY);
      if (direction === undefined) return false;

      const order = ++this.#eventOrder;
      pointers.set(id, { direction, order });
      this.#directionLatch = direction;
      this.#hasDirectionLatch = true;
      return true;
    };
    const onPointerDown = ((event: Event): void => {
      const id = pointerId(event);
      if (id === undefined || !isPrimaryPointerDown(event)) return;
      const pointer = event as PointerEvent;
      if (!updateDirection(id, pointer.clientX, pointer.clientY)) return;

      event.preventDefault();
      capture(surface, id);
      if ((event as PointerEvent).pointerType === 'touch') {
        touchPointerIds.add(id);
      }
    }) as EventListener;
    const onPointerMove = ((event: Event): void => {
      const id = pointerId(event);
      if (id === undefined || !pointers.has(id)) return;
      const pointer = event as PointerEvent;
      if (!updateDirection(id, pointer.clientX, pointer.clientY)) return;

      event.preventDefault();
    }) as EventListener;
    const end = (event: Event, shouldRelease: boolean): void => {
      const id = pointerId(event);
      if (id === undefined || !pointers.delete(id)) return;
      const wasTouchPointer = touchPointerIds.delete(id);
      if (wasTouchPointer && touchPointerIds.size === 0) {
        for (const contact of pointers.keys()) {
          if (contact < 0) pointers.delete(contact);
        }
      }
      event.preventDefault();
      if (shouldRelease) release(surface, id);
    };
    const onPointerEnd = ((event: Event): void => {
      end(event, true);
    }) as EventListener;
    const onLostPointerCapture = ((event: Event): void => {
      end(event, false);
    }) as EventListener;
    const onTouchStart = ((event: Event): void => {
      let handled = false;
      for (const touch of changedTouches(event)) {
        const id = touchId(touch);
        if (id === undefined) continue;
        handled =
          updateDirection(id, touch.clientX, touch.clientY)
          || handled;
      }
      if (handled) event.preventDefault();
    }) as EventListener;
    const onTouchMove = ((event: Event): void => {
      let handled = false;
      for (const touch of changedTouches(event)) {
        const id = touchId(touch);
        if (id === undefined || !pointers.has(id)) continue;
        handled =
          updateDirection(id, touch.clientX, touch.clientY)
          || handled;
      }
      if (handled) event.preventDefault();
    }) as EventListener;
    const onTouchEnd = ((event: Event): void => {
      let handled = false;
      for (const touch of changedTouches(event)) {
        const id = touchId(touch);
        if (id !== undefined && pointers.delete(id)) handled = true;
      }
      let hasLegacyTouch = false;
      for (const contact of pointers.keys()) {
        if (contact < 0) {
          hasLegacyTouch = true;
          break;
        }
      }
      if (!hasLegacyTouch && touchPointerIds.size > 0) {
        for (const id of touchPointerIds) pointers.delete(id);
        touchPointerIds.clear();
        handled = true;
      }
      if (handled) event.preventDefault();
    }) as EventListener;

    this.#stick = {
      surface,
      pointers,
      touchPointerIds,
      onPointerDown,
      onPointerMove,
      onPointerEnd,
      onLostPointerCapture,
      onTouchStart,
      onTouchMove,
      onTouchEnd,
    };
    surface.addEventListener('pointerdown', onPointerDown);
    surface.addEventListener('pointermove', onPointerMove);
    surface.addEventListener('pointerup', onPointerEnd);
    surface.addEventListener('pointercancel', onPointerEnd);
    surface.addEventListener('lostpointercapture', onLostPointerCapture);
    surface.addEventListener('touchstart', onTouchStart, { passive: false });
    surface.addEventListener('touchmove', onTouchMove, { passive: false });
    surface.addEventListener('touchend', onTouchEnd, { passive: false });
    surface.addEventListener('touchcancel', onTouchEnd, { passive: false });
    this.#endTarget?.addEventListener('pointerup', onPointerEnd, {
      capture: true,
    });
    this.#endTarget?.addEventListener('pointercancel', onPointerEnd, {
      capture: true,
    });
    this.#endTarget?.addEventListener('touchend', onTouchEnd, {
      capture: true,
      passive: false,
    });
    this.#endTarget?.addEventListener('touchcancel', onTouchEnd, {
      capture: true,
      passive: false,
    });
  }

  attachAction(
    surface: TouchActionSurface,
    button: TouchActionButton,
  ): void {
    if (
      button !== Button.Shot
      && button !== Button.Bomb
      && button !== Button.Start
    ) {
      throw new RangeError('touch actions must be Shot, Bomb, or Start');
    }

    const existing = this.#actions.get(surface);
    if (existing?.button === button) return;
    if (existing !== undefined) this.#detachAction(existing);

    const pointers = new Set<number>();
    const touchPointerIds = new Set<number>();
    const onPointerDown = ((event: Event): void => {
      const id = pointerId(event);
      if (id === undefined || !isPrimaryPointerDown(event)) return;

      event.preventDefault();
      capture(surface, id);
      if (pointers.has(id)) return;
      const wasHeld = this.#actionHeld(button);
      pointers.add(id);
      if ((event as PointerEvent).pointerType === 'touch') {
        touchPointerIds.add(id);
      }
      if (!wasHeld) this.#actionLatch |= button;
    }) as EventListener;
    const end = (event: Event, shouldRelease: boolean): void => {
      const id = pointerId(event);
      if (id === undefined || !pointers.delete(id)) return;
      const wasTouchPointer = touchPointerIds.delete(id);
      if (wasTouchPointer && touchPointerIds.size === 0) {
        for (const contact of pointers) {
          if (contact < 0) pointers.delete(contact);
        }
      }
      event.preventDefault();
      if (shouldRelease) release(surface, id);
    };
    const onPointerEnd = ((event: Event): void => {
      end(event, true);
    }) as EventListener;
    const onLostPointerCapture = ((event: Event): void => {
      end(event, false);
    }) as EventListener;
    const onTouchStart = ((event: Event): void => {
      let handled = false;
      for (const touch of changedTouches(event)) {
        const id = touchId(touch);
        if (id === undefined || pointers.has(id)) continue;
        const wasHeld = this.#actionHeld(button);
        pointers.add(id);
        if (!wasHeld) this.#actionLatch |= button;
        handled = true;
      }
      if (handled) event.preventDefault();
    }) as EventListener;
    const onTouchEnd = ((event: Event): void => {
      let handled = false;
      for (const touch of changedTouches(event)) {
        const id = touchId(touch);
        if (id !== undefined && pointers.delete(id)) handled = true;
      }
      let hasLegacyTouch = false;
      for (const contact of pointers) {
        if (contact < 0) {
          hasLegacyTouch = true;
          break;
        }
      }
      if (!hasLegacyTouch && touchPointerIds.size > 0) {
        for (const id of touchPointerIds) pointers.delete(id);
        touchPointerIds.clear();
        handled = true;
      }
      if (handled) event.preventDefault();
    }) as EventListener;
    const onClick = ((event: Event): void => {
      // Pointer activation produces detail > 0 and was already latched on
      // pointerdown/touchstart. detail === 0 is the keyboard/screen-reader path.
      if ((event as MouseEvent).detail !== 0) return;
      event.preventDefault();
      this.#actionLatch |= button;
    }) as EventListener;

    const binding: ActionBinding = {
      surface,
      button,
      pointers,
      touchPointerIds,
      onPointerDown,
      onPointerEnd,
      onLostPointerCapture,
      onClick,
      onTouchStart,
      onTouchEnd,
    };
    this.#actions.set(surface, binding);
    surface.addEventListener('pointerdown', onPointerDown);
    surface.addEventListener('pointerup', onPointerEnd);
    surface.addEventListener('pointercancel', onPointerEnd);
    surface.addEventListener('lostpointercapture', onLostPointerCapture);
    surface.addEventListener('touchstart', onTouchStart, { passive: false });
    surface.addEventListener('touchend', onTouchEnd, { passive: false });
    surface.addEventListener('touchcancel', onTouchEnd, { passive: false });
    surface.addEventListener('click', onClick);
    this.#endTarget?.addEventListener('pointerup', onPointerEnd, {
      capture: true,
    });
    this.#endTarget?.addEventListener('pointercancel', onPointerEnd, {
      capture: true,
    });
    this.#endTarget?.addEventListener('touchend', onTouchEnd, {
      capture: true,
      passive: false,
    });
    this.#endTarget?.addEventListener('touchcancel', onTouchEnd, {
      capture: true,
      passive: false,
    });
  }

  consume(): Buttons {
    const heldDirection = this.#heldDirection();
    const direction = this.#hasDirectionLatch
      ? this.#directionLatch
      : heldDirection;
    const buttons = direction | this.#heldActions() | this.#actionLatch;
    this.#directionLatch = 0;
    this.#hasDirectionLatch = false;
    this.#actionLatch = 0;
    return buttons;
  }

  /**
   * Clear device state without removing listeners.
   *
   * This is the blur/visibility/run-boundary path. Captures are released so a
   * finger that ended while the page was inactive cannot leave a stuck button.
   */
  reset(): void {
    const stick = this.#stick;
    if (stick !== undefined) {
      const ids = [...stick.pointers.keys()];
      stick.pointers.clear();
      stick.touchPointerIds.clear();
      for (const id of ids) {
        if (id >= 0) release(stick.surface, id);
      }
    }

    for (const action of this.#actions.values()) {
      const ids = [...action.pointers];
      action.pointers.clear();
      action.touchPointerIds.clear();
      for (const id of ids) {
        if (id >= 0) release(action.surface, id);
      }
    }

    this.#directionLatch = 0;
    this.#hasDirectionLatch = false;
    this.#actionLatch = 0;
    this.#eventOrder = 0;
  }

  /** Remove every DOM listener and clear held/latched input. */
  detach(): void {
    this.reset();
    this.#detachStick();
    for (const action of [...this.#actions.values()]) {
      this.#detachAction(action);
    }
  }

  #heldDirection(): Buttons {
    let direction = 0;
    let latest = -1;
    for (const pointer of this.#stick?.pointers.values() ?? []) {
      if (pointer.order > latest) {
        direction = pointer.direction;
        latest = pointer.order;
      }
    }
    return direction;
  }

  #heldActions(): Buttons {
    let buttons = 0;
    for (const action of this.#actions.values()) {
      if (action.pointers.size > 0) buttons |= action.button;
    }
    return buttons;
  }

  #actionHeld(button: TouchActionButton): boolean {
    for (const action of this.#actions.values()) {
      if (action.button === button && action.pointers.size > 0) return true;
    }
    return false;
  }

  #detachStick(): void {
    const stick = this.#stick;
    if (stick === undefined) return;

    const ids = [...stick.pointers.keys()];
    stick.pointers.clear();
    stick.touchPointerIds.clear();
    for (const id of ids) {
      if (id >= 0) release(stick.surface, id);
    }
    stick.surface.removeEventListener('pointerdown', stick.onPointerDown);
    stick.surface.removeEventListener('pointermove', stick.onPointerMove);
    stick.surface.removeEventListener('pointerup', stick.onPointerEnd);
    stick.surface.removeEventListener('pointercancel', stick.onPointerEnd);
    stick.surface.removeEventListener(
      'lostpointercapture',
      stick.onLostPointerCapture,
    );
    stick.surface.removeEventListener('touchstart', stick.onTouchStart);
    stick.surface.removeEventListener('touchmove', stick.onTouchMove);
    stick.surface.removeEventListener('touchend', stick.onTouchEnd);
    stick.surface.removeEventListener('touchcancel', stick.onTouchEnd);
    this.#endTarget?.removeEventListener(
      'pointerup',
      stick.onPointerEnd,
      true,
    );
    this.#endTarget?.removeEventListener(
      'pointercancel',
      stick.onPointerEnd,
      true,
    );
    this.#endTarget?.removeEventListener('touchend', stick.onTouchEnd, true);
    this.#endTarget?.removeEventListener(
      'touchcancel',
      stick.onTouchEnd,
      true,
    );
    this.#stick = undefined;
    this.#directionLatch = 0;
    this.#hasDirectionLatch = false;
  }

  #detachAction(action: ActionBinding): void {
    const ids = [...action.pointers];
    action.pointers.clear();
    action.touchPointerIds.clear();
    for (const id of ids) {
      if (id >= 0) release(action.surface, id);
    }
    action.surface.removeEventListener('pointerdown', action.onPointerDown);
    action.surface.removeEventListener('pointerup', action.onPointerEnd);
    action.surface.removeEventListener('pointercancel', action.onPointerEnd);
    action.surface.removeEventListener(
      'lostpointercapture',
      action.onLostPointerCapture,
    );
    action.surface.removeEventListener('touchstart', action.onTouchStart);
    action.surface.removeEventListener('touchend', action.onTouchEnd);
    action.surface.removeEventListener('touchcancel', action.onTouchEnd);
    action.surface.removeEventListener('click', action.onClick);
    this.#endTarget?.removeEventListener(
      'pointerup',
      action.onPointerEnd,
      true,
    );
    this.#endTarget?.removeEventListener(
      'pointercancel',
      action.onPointerEnd,
      true,
    );
    this.#endTarget?.removeEventListener('touchend', action.onTouchEnd, true);
    this.#endTarget?.removeEventListener(
      'touchcancel',
      action.onTouchEnd,
      true,
    );
    this.#actions.delete(action.surface);
  }
}
