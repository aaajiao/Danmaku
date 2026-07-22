/** Browser-side access to the engine-owned v4 UI atlas. */

import UI_URL from '../assets/v4/ui-v4.png';
import { loadAtlas, type Atlas } from './atlas';
import {
  V4_UI_ATLAS_HEIGHT,
  V4_UI_ATLAS_WIDTH,
  V4_UI_CELLS,
  V4_UI_PANEL_CORNER,
  type V4UiCellName,
} from './v4-ui-layout';

/** Load once at shell boot and reject a stale generated file immediately. */
export async function loadV4UiAtlas(): Promise<Atlas> {
  const atlas = await loadAtlas(UI_URL);
  if (atlas.width !== V4_UI_ATLAS_WIDTH || atlas.height !== V4_UI_ATLAS_HEIGHT) {
    throw new Error(
      `v4 UI atlas must be ${V4_UI_ATLAS_WIDTH}×${V4_UI_ATLAS_HEIGHT}, got ${atlas.width}×${atlas.height}`,
    );
  }
  for (const [name, spec] of Object.entries(V4_UI_CELLS)) {
    atlas.defineStrip(name, {
      x: spec.x,
      y: spec.y,
      frameW: spec.frameW,
      frameH: spec.frameH,
      frames: spec.frames,
      ticksPerFrame: 4,
      mode: 'once',
      color: 'baked',
      displayW: spec.displayW,
      displayH: spec.displayH,
    });
  }
  return atlas;
}

export interface V4UiDrawOptions {
  readonly frame?: number;
  readonly width?: number;
  readonly height?: number;
  readonly alpha?: number;
  readonly rotation?: number;
}

/** Draw one named entry at its exact logical size unless explicitly overridden. */
export function drawV4Ui(
  ctx: CanvasRenderingContext2D,
  atlas: Atlas,
  name: V4UiCellName,
  x: number,
  y: number,
  options: V4UiDrawOptions = {},
): void {
  const spec = V4_UI_CELLS[name];
  const strip = atlas.strip(name);
  const frame = atlas.frameOf(strip, Math.max(0, Math.min(strip.frames - 1, options.frame ?? 0)));
  const w = options.width ?? spec.displayW;
  const h = options.height ?? spec.displayH;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha *= options.alpha ?? 1;
  if (options.rotation !== undefined) {
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(options.rotation);
    ctx.drawImage(
      atlas.texture.image as CanvasImageSource,
      frame.x,
      frame.y,
      frame.w,
      frame.h,
      -w / 2,
      -h / 2,
      w,
      h,
    );
  } else {
    ctx.drawImage(
      atlas.texture.image as CanvasImageSource,
      frame.x,
      frame.y,
      frame.w,
      frame.h,
      x,
      y,
      w,
      h,
    );
  }
  ctx.restore();
}

/**
 * Scale the panel's centre and straight edge spans only.  The 12px corners are
 * copied 1:1, preserving the authored thorn geometry at every panel size.
 */
export function drawV4UiPanel(
  ctx: CanvasRenderingContext2D,
  atlas: Atlas,
  x: number,
  y: number,
  w: number,
  h: number,
  alpha = 1,
): void {
  const spec = V4_UI_CELLS['ui.panel.9slice'];
  const c = V4_UI_PANEL_CORNER;
  const midSourceW = spec.frameW - c * 2;
  const midSourceH = spec.frameH - c * 2;
  const midTargetW = Math.max(0, w - c * 2);
  const midTargetH = Math.max(0, h - c * 2);
  const image = atlas.texture.image as CanvasImageSource;

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha *= alpha;
  const slice = (
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void => {
    if (dw <= 0 || dh <= 0) return;
    ctx.drawImage(image, spec.x + sx, spec.y + sy, sw, sh, dx, dy, dw, dh);
  };

  slice(0, 0, c, c, x, y, c, c);
  slice(c, 0, midSourceW, c, x + c, y, midTargetW, c);
  slice(spec.frameW - c, 0, c, c, x + w - c, y, c, c);
  slice(0, c, c, midSourceH, x, y + c, c, midTargetH);
  slice(c, c, midSourceW, midSourceH, x + c, y + c, midTargetW, midTargetH);
  slice(spec.frameW - c, c, c, midSourceH, x + w - c, y + c, c, midTargetH);
  slice(0, spec.frameH - c, c, c, x, y + h - c, c, c);
  slice(c, spec.frameH - c, midSourceW, c, x + c, y + h - c, midTargetW, c);
  slice(spec.frameW - c, spec.frameH - c, c, c, x + w - c, y + h - c, c, c);
  ctx.restore();
}

export { V4_CHARACTER_UI, V4_DIFFICULTY_UI, V4_UI_CELLS, V4_UI_SCREEN } from './v4-ui-layout';
export type { V4UiCellName } from './v4-ui-layout';
