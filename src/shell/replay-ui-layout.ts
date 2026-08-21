/**
 * Replay-only authored layout.
 *
 * The game frame remains 480x640. Replay labels carry substantially more
 * identity than ordinary menu verbs, so they receive a larger logical font and
 * are ellipsized rather than horizontally compressed. The complete source text
 * remains available through the shell's accessible DOM mirror.
 */
export const REPLAY_UI_LAYOUT = {
  headingBaseline: 76,
  summaryBaseline: 116,
  summaryLineHeight: 16,
  summaryRows: 3,
  summaryWidth: 336,
  summaryFontSize: 13,
  menuX: 40,
  menuFirstBaseline: 208,
  menuWidth: 400,
  menuStep: 48,
  menuRows: 8,
  menuFontSize: 15,
} as const;

export interface ReplayMenuWindow {
  readonly first: number;
  readonly visibleCount: number;
  readonly selected: number;
}

/** Replay subpages share a state name but not a DOM button identity. */
export function replayMenuScope(
  kind: string,
  title: string | undefined,
  detail?: string,
): string {
  return `${kind}:${title ?? 'REPLAYS'}:${detail ?? ''}`;
}

/** Keep the selected Replay row inside one stable eight-row authored window. */
export function replayMenuWindow(
  count: number,
  selected: number,
  rows = REPLAY_UI_LAYOUT.menuRows,
): ReplayMenuWindow {
  const boundedCount = Math.max(0, Math.floor(count));
  const visibleCount = Math.min(boundedCount, Math.max(1, Math.floor(rows)));
  const boundedSelected = boundedCount === 0
    ? 0
    : Math.max(0, Math.min(boundedCount - 1, Math.floor(selected)));
  const first = visibleCount === 0
    ? 0
    : Math.max(
        0,
        Math.min(
          boundedSelected - Math.floor(visibleCount / 2),
          boundedCount - visibleCount,
        ),
      );
  return {
    first,
    visibleCount,
    selected: boundedSelected - first,
  };
}

/** Mirrors the fixed-frame fit contract for layout/readability tests. */
export function replayStageScale(
  viewportWidth: number,
  viewportHeight: number,
  fieldWidth = 480,
  fieldHeight = 640,
): number {
  const raw = Math.min(viewportWidth / fieldWidth, viewportHeight / fieldHeight);
  return raw >= 1 ? Math.max(1, Math.floor(raw)) : Math.max(0, raw);
}

/** Mirror the touch-enabled CSS slot, excluding its portrait dock/gutters. */
export function replayTouchStageSlot(
  viewportWidth: number,
  viewportHeight: number,
): { readonly width: number; readonly height: number } {
  if (viewportWidth > viewportHeight) {
    const gutter = Math.max(120, Math.min(240, viewportWidth * 0.22));
    return {
      width: Math.max(0, viewportWidth - gutter * 2),
      height: Math.max(0, viewportHeight),
    };
  }
  const dock = Math.max(174, Math.min(218, viewportHeight * 0.25));
  return {
    width: Math.max(0, viewportWidth),
    height: Math.max(0, viewportHeight - dock),
  };
}
