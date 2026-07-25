import type { PointerPositionInput } from '../core/pointer-input';
import type { TouchInput } from '../core/touch-input';

export interface TouchActivityState {
  readonly pointers: Map<number, string>;
  readonly touches: Set<number>;
}

export interface TouchStickVisualState {
  readonly pointerIds: Set<number>;
  readonly touchIds: Set<number>;
}

function syncTouchControlActivity(
  touchControls: HTMLElement,
  state: TouchActivityState,
): void {
  if (state.pointers.size > 0 || state.touches.size > 0) {
    touchControls.dataset.operating = 'true';
  } else {
    delete touchControls.dataset.operating;
  }
}

export function resetTouchControlActivity(
  touchControls: HTMLElement,
  state: TouchActivityState,
): void {
  state.pointers.clear();
  state.touches.clear();
  syncTouchControlActivity(touchControls, state);
}

/**
 * Track real contacts separately from the digital input source. This only
 * dims browser chrome; neither pointer identity nor count reaches the sim.
 */
export function installTouchControlActivity(
  touchControls: HTMLElement,
  state: TouchActivityState,
): void {
  touchControls.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    state.pointers.set(event.pointerId, event.pointerType);
    syncTouchControlActivity(touchControls, state);
  }, { capture: true });
  touchControls.addEventListener('touchstart', (event) => {
    for (let index = 0; index < event.changedTouches.length; index++) {
      const touch = event.changedTouches.item(index);
      if (touch !== null) state.touches.add(touch.identifier);
    }
    syncTouchControlActivity(touchControls, state);
  }, { capture: true, passive: true });

  const endTouchControlPointer = (event: PointerEvent): void => {
    const pointerType = state.pointers.get(event.pointerId);
    if (pointerType === undefined) return;
    state.pointers.delete(event.pointerId);
    if (pointerType === 'touch' && state.pointers.size === 0) {
      // A dual-stream browser may omit the matching legacy touch end.
      state.touches.clear();
    }
    syncTouchControlActivity(touchControls, state);
  };
  const endTouchControlTouch = (event: TouchEvent): void => {
    for (let index = 0; index < event.changedTouches.length; index++) {
      const touch = event.changedTouches.item(index);
      if (touch !== null) state.touches.delete(touch.identifier);
    }
    if (event.touches.length === 0) {
      // Preserve a simultaneous mouse press, but clear mirrored touch pointers.
      for (const [id, type] of state.pointers) {
        if (type === 'touch') state.pointers.delete(id);
      }
    }
    syncTouchControlActivity(touchControls, state);
  };
  window.addEventListener('pointerup', endTouchControlPointer, {
    capture: true,
  });
  window.addEventListener('pointercancel', endTouchControlPointer, {
    capture: true,
  });
  touchControls.addEventListener(
    'lostpointercapture',
    endTouchControlPointer,
    { capture: true },
  );
  window.addEventListener('touchend', endTouchControlTouch, { capture: true });
  window.addEventListener('touchcancel', endTouchControlTouch, {
    capture: true,
  });
}

function moveTouchStickVisual(
  touchStick: HTMLElement,
  clientX: number,
  clientY: number,
): void {
  const rect = touchStick.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;

  let x = clientX - (rect.left + rect.width / 2);
  let y = clientY - (rect.top + rect.height / 2);
  const limit = Math.min(rect.width, rect.height) * 0.24;
  const distance = Math.hypot(x, y);
  if (distance > limit && distance > 0) {
    const scale = limit / distance;
    x *= scale;
    y *= scale;
  }

  touchStick.style.setProperty('--touch-stick-x', `${x}px`);
  touchStick.style.setProperty('--touch-stick-y', `${y}px`);
  touchStick.dataset.active = 'true';
}

export function resetTouchStickVisual(
  touchStick: HTMLElement,
  state: TouchStickVisualState,
): void {
  state.pointerIds.clear();
  state.touchIds.clear();
  touchStick.style.setProperty('--touch-stick-x', '0px');
  touchStick.style.setProperty('--touch-stick-y', '0px');
  delete touchStick.dataset.active;
}

/**
 * Follow continuous browser coordinates for presentation only. `TouchInput`
 * independently quantizes the gesture before the fixed tick samples it
 * (CLAUDE.md, rule 4).
 */
export function installTouchStickVisual(
  touchStick: HTMLElement,
  state: TouchStickVisualState,
): void {
  touchStick.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    state.pointerIds.add(event.pointerId);
    moveTouchStickVisual(touchStick, event.clientX, event.clientY);
  });
  touchStick.addEventListener('pointermove', (event) => {
    if (!state.pointerIds.has(event.pointerId)) return;
    moveTouchStickVisual(touchStick, event.clientX, event.clientY);
  });

  const moveTouchStickFromTouches = (
    event: TouchEvent,
    start: boolean,
  ): void => {
    for (let index = 0; index < event.changedTouches.length; index++) {
      const touch = event.changedTouches.item(index);
      if (touch === null) continue;
      if (start) state.touchIds.add(touch.identifier);
      if (!state.touchIds.has(touch.identifier)) continue;
      moveTouchStickVisual(touchStick, touch.clientX, touch.clientY);
    }
  };
  touchStick.addEventListener('touchstart', (event) => {
    moveTouchStickFromTouches(event, true);
  }, { passive: true });
  touchStick.addEventListener('touchmove', (event) => {
    moveTouchStickFromTouches(event, false);
  }, { passive: true });

  const endTouchStickPointer = (event: PointerEvent): void => {
    if (!state.pointerIds.has(event.pointerId)) return;
    resetTouchStickVisual(touchStick, state);
  };
  const endTouchStickTouch = (event: TouchEvent): void => {
    for (let index = 0; index < event.changedTouches.length; index++) {
      const touch = event.changedTouches.item(index);
      if (touch !== null && state.touchIds.has(touch.identifier)) {
        resetTouchStickVisual(touchStick, state);
        return;
      }
    }
  };
  window.addEventListener('pointerup', endTouchStickPointer, { capture: true });
  window.addEventListener('pointercancel', endTouchStickPointer, {
    capture: true,
  });
  window.addEventListener('touchend', endTouchStickTouch, { capture: true });
  window.addEventListener('touchcancel', endTouchStickTouch, {
    capture: true,
  });
}

export interface TouchResetLifecycle {
  readonly pointerPositionInput: PointerPositionInput;
  readonly touchInput: TouchInput;
  readonly resetChrome: () => void;
}

export function installTouchResetLifecycle(
  stageElement: HTMLElement,
  lifecycle: TouchResetLifecycle,
): void {
  lifecycle.pointerPositionInput.attach(stageElement);
  window.addEventListener('blur', () => {
    lifecycle.pointerPositionInput.clearTarget();
    lifecycle.touchInput.reset();
    lifecycle.resetChrome();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    lifecycle.pointerPositionInput.clearTarget();
    lifecycle.touchInput.reset();
    lifecycle.resetChrome();
  });
  window.addEventListener('pagehide', () => {
    lifecycle.touchInput.reset();
    lifecycle.resetChrome();
  });
}
