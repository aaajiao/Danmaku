/**
 * Browser-only sizing and touch-control discovery for the authored frame.
 *
 * The shell owns the flags passed through the accessors below. This module
 * only wires viewport/pointer events to those owners; no game or input state
 * crosses this boundary.
 */

export function installStageFit(
  stageSlot: HTMLElement,
  stageElement: HTMLElement,
  fieldWidth: number,
  fieldHeight: number,
): () => void {
  /**
   * Fit the fixed logical frame to its available viewport slot.
   *
   * Touch portrait layout reserves a sibling controller deck below this slot;
   * landscape puts controls in the side gutters. Measuring the slot rather than
   * `innerWidth`/`innerHeight` handles both without teaching the stage or sim
   * that a controller exists. Integer scales above 1× keep the pixel art crisp;
   * below 1× a fractional fit beats clipping.
   */
  const fitStage = (): void => {
    const rect = stageSlot.getBoundingClientRect();
    const availableWidth = rect.width || window.innerWidth;
    const availableHeight = rect.height || window.innerHeight;
    const raw = Math.min(
      availableWidth / fieldWidth,
      availableHeight / fieldHeight,
    );
    const scale = raw >= 1 ? Math.max(1, Math.floor(raw)) : raw;
    stageElement.style.setProperty('--stage-scale', `${Math.max(0, scale)}`);
  };

  window.addEventListener('resize', fitStage);
  window.visualViewport?.addEventListener('resize', fitStage);
  if ('ResizeObserver' in window) {
    new ResizeObserver(fitStage).observe(stageSlot);
  }
  return fitStage;
}

export interface TouchControlReveal {
  readonly enabled: () => boolean;
  readonly pending: () => boolean;
  readonly setPending: (pending: boolean) => void;
  readonly enable: () => void;
}

/**
 * A hybrid laptop keeps the desktop layout until it actually sees touch.
 * Deferring the reveal until the gesture ends prevents the canvas from moving
 * between a menu row's down and click events.
 */
export function installTouchControlReveal(state: TouchControlReveal): void {
  const revealTouchControlsAfterGesture = (): void => {
    if (!state.pending()) return;
    state.setPending(false);
    window.removeEventListener(
      'pointerup',
      revealTouchControlsAfterGesture,
      true,
    );
    window.removeEventListener(
      'pointercancel',
      revealTouchControlsAfterGesture,
      true,
    );
    window.removeEventListener(
      'touchend',
      revealTouchControlsAfterGesture,
      true,
    );
    window.removeEventListener(
      'touchcancel',
      revealTouchControlsAfterGesture,
      true,
    );
    window.requestAnimationFrame(state.enable);
  };

  window.addEventListener('pointerdown', (event) => {
    if (
      state.enabled()
      || state.pending()
      || event.pointerType !== 'touch'
    ) {
      return;
    }
    state.setPending(true);
    window.addEventListener('pointerup', revealTouchControlsAfterGesture, {
      capture: true,
      once: true,
    });
    window.addEventListener('pointercancel', revealTouchControlsAfterGesture, {
      capture: true,
      once: true,
    });
  }, { capture: true });
  window.addEventListener('touchstart', () => {
    if (state.enabled() || state.pending()) return;
    state.setPending(true);
    window.addEventListener('touchend', revealTouchControlsAfterGesture, {
      capture: true,
      once: true,
    });
    window.addEventListener('touchcancel', revealTouchControlsAfterGesture, {
      capture: true,
      once: true,
    });
  }, { capture: true, passive: true });
}
