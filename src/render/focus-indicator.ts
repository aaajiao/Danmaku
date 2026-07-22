/** Pure fixed-tick layout for the focused player's lethal centre. */

export interface FocusIndicatorLayout {
  readonly ringX: number;
  readonly ringY: number;
  readonly ringSize: number;
  readonly ringRotation: number;
  readonly ringAlpha: number;
  readonly keylineRadius: number;
  readonly coreRadius: number;
}

export const FOCUS_RING_SIZE = 32;
export const FOCUS_RING_ALPHA = 0.58;
export const FOCUS_KEYLINE_EXTRA = 1.5;

/**
 * Read only position, the real collision radius and the run's integer tick.
 * The returned core radius is never inflated to make the UI more convenient.
 */
export function focusIndicatorLayout(
  x: number,
  y: number,
  hitRadius: number,
  tickCount: number,
): FocusIndicatorLayout {
  const radius = Math.max(0, hitRadius);
  const tick = Math.max(0, Math.floor(tickCount));
  return {
    ringX: x - FOCUS_RING_SIZE / 2,
    ringY: y - FOCUS_RING_SIZE / 2,
    ringSize: FOCUS_RING_SIZE,
    ringRotation: (tick % 120) * (Math.PI / 60),
    ringAlpha: FOCUS_RING_ALPHA,
    keylineRadius: radius + FOCUS_KEYLINE_EXTRA,
    coreRadius: radius,
  };
}
