/**
 * Generate the original, engine-owned v4 UI atlas.
 *
 * Pure TypeScript and the repository's PNG encoder only: no canvas, font,
 * native image library or network input.  Run with:
 *
 *     bun tools/make-v4-ui.ts
 *
 * The visual language follows `docs/art/v4/ui-style-lock.png` without copying
 * any third-party pixels: cold mycelium linework, heart cores and restrained
 * identity colour on transparent black.  Text stays runtime text so arbitrary
 * pack labels and Unicode remain legible.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  V4_CHARACTER_UI,
  V4_UI_ATLAS_HEIGHT,
  V4_UI_ATLAS_WIDTH,
  V4_UI_CELLS,
} from '../src/render/v4-ui-layout';
import { ColourType, encodePng, parsePng } from './png';

type RGB = readonly [number, number, number];

interface Image {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

const ICE: RGB = [211, 225, 235];
const DIM: RGB = [97, 113, 129];
const PINK: RGB = [255, 145, 189];
const GREEN: RGB = [112, 223, 162];
const BLUE: RGB = [140, 235, 255];
const VIOLET: RGB = [181, 140, 255];
const AMBER: RGB = [224, 184, 134];
const RED: RGB = [255, 121, 92];

function image(width: number, height: number): Image {
  return { width, height, rgba: new Uint8Array(width * height * 4) };
}

/** Straight-alpha source-over compositing. */
function over(img: Image, x: number, y: number, colour: RGB, alpha: number): void {
  x = Math.round(x);
  y = Math.round(y);
  if (alpha <= 0 || x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const at = (y * img.width + x) * 4;
  const da = img.rgba[at + 3]! / 255;
  const oa = alpha + da * (1 - alpha);
  if (oa <= 0) return;
  for (let channel = 0; channel < 3; channel++) {
    img.rgba[at + channel] = Math.round(
      (colour[channel]! * alpha + img.rgba[at + channel]! * da * (1 - alpha)) / oa,
    );
  }
  img.rgba[at + 3] = Math.round(oa * 255);
}

function block(
  img: Image,
  x: number,
  y: number,
  width: number,
  height: number,
  colour: RGB,
  alpha: number,
): void {
  for (let py = y; py < y + height; py++) {
    for (let px = x; px < x + width; px++) over(img, px, py, colour, alpha);
  }
}

function line(
  img: Image,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  colour: RGB,
  alpha = 1,
  thickness = 1,
): void {
  const targetX = Math.round(x1);
  const targetY = Math.round(y1);
  let x = Math.round(x0);
  let y = Math.round(y0);
  const dx = Math.abs(targetX - x);
  const sx = x < targetX ? 1 : -1;
  const dy = -Math.abs(targetY - y);
  const sy = y < targetY ? 1 : -1;
  let error = dx + dy;
  const radius = Math.floor(thickness / 2);
  while (true) {
    for (let yy = -radius; yy <= radius; yy++) {
      for (let xx = -radius; xx <= radius; xx++) over(img, x + xx, y + yy, colour, alpha);
    }
    if (x === targetX && y === targetY) break;
    const e2 = error * 2;
    if (e2 >= dy) {
      error += dy;
      x += sx;
    }
    if (e2 <= dx) {
      error += dx;
      y += sy;
    }
  }
}

function ring(
  img: Image,
  cx: number,
  cy: number,
  radius: number,
  colour: RGB,
  alpha = 1,
  start = 0,
  end = Math.PI * 2,
): void {
  const steps = Math.max(16, Math.ceil(radius * Math.abs(end - start) * 1.5));
  let px = cx + Math.cos(start) * radius;
  let py = cy + Math.sin(start) * radius;
  for (let i = 1; i <= steps; i++) {
    const angle = start + ((end - start) * i) / steps;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    line(img, px, py, x, y, colour, alpha);
    px = x;
    py = y;
  }
}

function glowPoint(img: Image, x: number, y: number, colour: RGB, alpha = 1): void {
  over(img, x, y, colour, alpha);
  over(img, x - 1, y, colour, alpha * 0.45);
  over(img, x + 1, y, colour, alpha * 0.45);
  over(img, x, y - 1, colour, alpha * 0.45);
  over(img, x, y + 1, colour, alpha * 0.45);
}

function diamond(img: Image, cx: number, cy: number, radius: number, colour: RGB, alpha = 1): void {
  line(img, cx, cy - radius, cx + radius, cy, colour, alpha);
  line(img, cx + radius, cy, cx, cy + radius, colour, alpha);
  line(img, cx, cy + radius, cx - radius, cy, colour, alpha);
  line(img, cx - radius, cy, cx, cy - radius, colour, alpha);
}

function heart(img: Image, cx: number, cy: number, radius: number, colour: RGB, alpha = 1): void {
  // Filled, geometric heart: readable at 8–48px and independent of a font.
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      const nx = x / radius;
      const ny = y / radius;
      const f = (nx * nx + ny * ny - 0.55) ** 3 - nx * nx * ny * ny * ny;
      if (f <= 0 && ny < 0.92) over(img, cx + x, cy + y, colour, alpha);
    }
  }
  glowPoint(img, cx - Math.max(1, Math.floor(radius / 4)), cy - Math.max(1, Math.floor(radius / 4)), ICE, alpha);
}

function branch(
  img: Image,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  colour: RGB,
  alpha = 1,
  twigs = 3,
): void {
  line(img, x0, y0, x1, y1, colour, alpha);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const nx = -dy / length;
  const ny = dx / length;
  for (let i = 1; i <= twigs; i++) {
    const t = i / (twigs + 1);
    const bx = x0 + dx * t;
    const by = y0 + dy * t;
    const side = i % 2 === 0 ? -1 : 1;
    const twig = 3 + (i % 2) * 2;
    line(img, bx, by, bx + nx * twig * side - dx * 0.035, by + ny * twig * side - dy * 0.035, colour, alpha * 0.82);
    glowPoint(img, bx, by, colour, alpha * 0.55);
  }
}

function thornRect(
  img: Image,
  x: number,
  y: number,
  width: number,
  height: number,
  colour: RGB,
  alpha = 1,
): void {
  line(img, x + 7, y + 2, x + width - 8, y + 2, colour, alpha);
  line(img, x + 7, y + height - 3, x + width - 8, y + height - 3, colour, alpha);
  line(img, x + 2, y + 7, x + 2, y + height - 8, colour, alpha);
  line(img, x + width - 3, y + 7, x + width - 3, y + height - 8, colour, alpha);
  for (const [cx, cy, sx, sy] of [
    [x + 3, y + 3, 1, 1],
    [x + width - 4, y + 3, -1, 1],
    [x + 3, y + height - 4, 1, -1],
    [x + width - 4, y + height - 4, -1, -1],
  ] as const) {
    branch(img, cx, cy, cx + sx * 10, cy + sy * 3, colour, alpha, 2);
    branch(img, cx, cy, cx + sx * 3, cy + sy * 10, colour, alpha, 2);
    diamond(img, cx, cy, 2, ICE, alpha);
  }
}

function paintLogo(img: Image): void {
  const { x, y, frameW: w, frameH: h } = V4_UI_CELLS['ui.logo'];
  const cx = x + w / 2;
  const cy = y + h / 2;
  branch(img, x + 12, cy, cx - 14, cy, ICE, 0.78, 10);
  branch(img, x + w - 13, cy, cx + 14, cy, ICE, 0.78, 10);
  branch(img, cx, y + 4, cx, cy - 11, ICE, 0.84, 3);
  branch(img, cx, y + h - 5, cx, cy + 12, ICE, 0.68, 3);
  ring(img, cx, cy, 23, DIM, 0.72);
  ring(img, cx, cy, 17, PINK, 0.45);
  heart(img, cx, cy, 10, PINK, 0.92);
  diamond(img, cx, y + 5, 4, ICE, 0.9);
  diamond(img, cx, y + h - 6, 3, ICE, 0.7);
  for (let i = 0; i < 5; i++) {
    glowPoint(img, x + 35 + i * 24, cy, ICE, 0.66);
    glowPoint(img, x + w - 36 - i * 24, cy, ICE, 0.66);
  }
}

function paintPanel(img: Image): void {
  const { x, y, frameW: w, frameH: h } = V4_UI_CELLS['ui.panel.9slice'];
  block(img, x + 2, y + 2, w - 4, h - 4, [5, 8, 13], 0.86);
  block(img, x + 8, y + 8, w - 16, h - 16, [10, 15, 23], 0.35);
  thornRect(img, x, y, w, h, ICE, 0.76);
  line(img, x + 12, y + 7, x + w - 13, y + 7, DIM, 0.55);
  line(img, x + 12, y + h - 8, x + w - 13, y + h - 8, DIM, 0.55);
}

function paintCursor(img: Image): void {
  const { x, y, frameW: w, frameH: h } = V4_UI_CELLS['ui.cursor'];
  const cx = x + w / 2;
  const cy = y + h / 2;
  diamond(img, cx, cy, 10, ICE, 0.86);
  heart(img, cx, cy, 4, PINK, 0.95);
  line(img, x + 1, cy, x + 7, cy, ICE, 0.7);
  line(img, x + w - 2, cy, x + w - 8, cy, ICE, 0.7);
}

function paintDivider(img: Image): void {
  const { x, y, frameW: w, frameH: h } = V4_UI_CELLS['ui.divider'];
  const cx = x + w / 2;
  const cy = y + h / 2;
  branch(img, x + 2, cy, cx - 8, cy, ICE, 0.65, 9);
  branch(img, x + w - 3, cy, cx + 8, cy, ICE, 0.65, 9);
  heart(img, cx, cy, 4, PINK, 0.88);
}

function paintFocus(img: Image): void {
  const { x, y, frameW: w, frameH: h } = V4_UI_CELLS['ui.focus.ring'];
  const cx = x + w / 2;
  const cy = y + h / 2;
  ring(img, cx, cy, 13, ICE, 0.86);
  ring(img, cx, cy, 9, BLUE, 0.55);
  line(img, cx, y + 1, cx, y + 7, ICE, 0.82);
  line(img, cx, y + h - 2, cx, y + h - 8, ICE, 0.82);
  line(img, x + 1, cy, x + 7, cy, ICE, 0.82);
  line(img, x + w - 2, cy, x + w - 8, cy, ICE, 0.82);
  diamond(img, cx, cy, 2, PINK, 0.8);
}

function paintGraze(img: Image): void {
  const spec = V4_UI_CELLS['ui.graze.arc'];
  for (let frame = 0; frame < spec.frames; frame++) {
    const x = spec.x + frame * spec.frameW;
    const cx = x + spec.frameW / 2;
    const cy = spec.y + spec.frameH / 2;
    const span = Math.PI * (0.55 + frame * 0.33);
    const start = -Math.PI / 2 - span / 2;
    ring(img, cx, cy, 10 + frame, VIOLET, 0.9 - frame * 0.12, start, start + span);
    ring(img, cx, cy, 14, ICE, 0.42 - frame * 0.07, start + 0.35, start + span - 0.35);
    for (let i = 0; i <= frame + 1; i++) {
      const angle = start + (span * (i + 1)) / (frame + 3);
      glowPoint(img, cx + Math.cos(angle) * 14, cy + Math.sin(angle) * 14, ICE, 0.8);
    }
  }
}

function paintSmallIcons(img: Image): void {
  const icons: readonly [keyof typeof V4_UI_CELLS, RGB, number][] = [
    ['ui.hud.score', AMBER, 0],
    ['ui.hud.graze', VIOLET, 1],
    ['ui.hud.life', PINK, 2],
    ['ui.hud.bomb', BLUE, 3],
    ['ui.hud.power', GREEN, 4],
  ];
  for (const [name, colour, kind] of icons) {
    const spec = V4_UI_CELLS[name];
    const cx = spec.x + 8;
    const cy = spec.y + 8;
    if (kind === 2) heart(img, cx, cy, 5, colour, 0.95);
    else if (kind === 1) {
      ring(img, cx, cy, 5, colour, 0.9);
      ring(img, cx, cy, 2, ICE, 0.8);
    } else {
      diamond(img, cx, cy, 5, colour, 0.9);
      line(img, cx - 6, cy, cx + 6, cy, ICE, 0.55);
      line(img, cx, cy - 6, cx, cy + 6, ICE, 0.55);
    }
  }
}

function paintCrest(
  img: Image,
  name: keyof typeof V4_CHARACTER_UI,
  variant: number,
): void {
  const identity = V4_CHARACTER_UI[name];
  const spec = V4_UI_CELLS[identity.crest];
  const colour = identity.rgb;
  const cx = spec.x + spec.frameW / 2;
  const cy = spec.y + spec.frameH / 2;
  ring(img, cx, cy, 19, ICE, 0.68);
  ring(img, cx, cy, 14, colour, 0.72);
  for (let i = 0; i < 4 + variant; i++) {
    const angle = (Math.PI * 2 * i) / (4 + variant) - Math.PI / 2;
    const x = cx + Math.cos(angle) * 19;
    const y = cy + Math.sin(angle) * 19;
    line(img, x, y, cx + Math.cos(angle) * 23, cy + Math.sin(angle) * 23, colour, 0.68);
    glowPoint(img, x, y, ICE, 0.72);
  }
  heart(img, cx, cy, 8, colour, 0.93);
  diamond(img, cx, cy, 11, ICE, 0.44);
}

function paintDifficulty(img: Image): void {
  const entries: readonly [keyof typeof V4_UI_CELLS, RGB, number][] = [
    ['ui.difficulty.easy', GREEN, 1],
    ['ui.difficulty.normal', BLUE, 2],
    ['ui.difficulty.hard', RED, 3],
    ['ui.difficulty.lunatic', VIOLET, 4],
  ];
  for (const [name, colour, tier] of entries) {
    const spec = V4_UI_CELLS[name];
    const cx = spec.x + 24;
    const cy = spec.y + 24;
    ring(img, cx, cy, 18, ICE, 0.62);
    ring(img, cx, cy, 13, colour, 0.82);
    for (let i = 0; i < tier + 2; i++) {
      const angle = (Math.PI * 2 * i) / (tier + 2) - Math.PI / 2;
      const px = cx + Math.cos(angle) * 18;
      const py = cy + Math.sin(angle) * 18;
      diamond(img, px, py, 2, colour, 0.82);
    }
    heart(img, cx, cy, 7, colour, 0.92);
  }
}

function paintStatus(img: Image): void {
  const entries: readonly [keyof typeof V4_UI_CELLS, RGB, number][] = [
    ['ui.status.pause', BLUE, 0],
    ['ui.status.clear', GREEN, 1],
    ['ui.status.gameover', RED, 2],
    ['ui.status.ending', VIOLET, 3],
    ['ui.status.result', AMBER, 4],
  ];
  for (const [name, colour, variant] of entries) {
    const spec = V4_UI_CELLS[name];
    const cx = spec.x + 28;
    const cy = spec.y + 28;
    ring(img, cx, cy, 23, ICE, 0.68);
    ring(img, cx, cy, 17, colour, 0.72);
    heart(img, cx, cy, 9, colour, 0.9);
    if (variant === 0) {
      line(img, cx - 5, cy - 5, cx - 5, cy + 5, ICE, 0.9, 2);
      line(img, cx + 5, cy - 5, cx + 5, cy + 5, ICE, 0.9, 2);
    } else if (variant === 2) {
      line(img, cx - 9, cy - 9, cx + 9, cy + 9, ICE, 0.8);
      line(img, cx + 9, cy - 9, cx - 9, cy + 9, ICE, 0.8);
    } else {
      diamond(img, cx, cy, 14 + (variant % 2) * 2, ICE, 0.5);
    }
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * i) / 4;
      const x = cx + Math.cos(angle) * 23;
      const y = cy + Math.sin(angle) * 23;
      line(img, x, y, cx + Math.cos(angle) * 27, cy + Math.sin(angle) * 27, colour, 0.7);
    }
  }
}

function paintBars(img: Image): void {
  const frameSpec = V4_UI_CELLS['ui.boss.frame'];
  thornRect(img, frameSpec.x, frameSpec.y, frameSpec.frameW, frameSpec.frameH, ICE, 0.68);
  heart(img, frameSpec.x + 12, frameSpec.y + 8, 5, PINK, 0.9);
  diamond(img, frameSpec.x + frameSpec.frameW - 10, frameSpec.y + 8, 5, ICE, 0.7);
  for (let i = 0; i < 18; i++) {
    glowPoint(img, frameSpec.x + 28 + i * 21, frameSpec.y + 8, DIM, 0.58);
  }

  for (const [name, colour] of [
    ['ui.boss.fill.normal', BLUE],
    ['ui.boss.fill.spell', PINK],
  ] as const) {
    const spec = V4_UI_CELLS[name];
    for (let x = 0; x < spec.frameW; x++) {
      const light = 0.48 + 0.5 * (1 - Math.abs(x / (spec.frameW - 1) - 0.5) * 2);
      block(img, spec.x + x, spec.y + 2, 1, 4, colour, light);
    }
    line(img, spec.x, spec.y + 1, spec.x + spec.frameW - 1, spec.y + 1, ICE, 0.45);
    line(img, spec.x, spec.y + 6, spec.x + spec.frameW - 1, spec.y + 6, DIM, 0.5);
  }

  const timer = V4_UI_CELLS['ui.boss.timer'];
  line(img, timer.x, timer.y + 1, timer.x + timer.frameW - 1, timer.y + 1, AMBER, 0.82, 2);
  for (let i = 0; i <= 12; i++) glowPoint(img, timer.x + i * 30, timer.y + 1, ICE, 0.7);
}

function paintPlates(img: Image): void {
  const name = V4_UI_CELLS['ui.nameplate'];
  block(img, name.x + 3, name.y + 3, name.frameW - 6, name.frameH - 6, [7, 10, 16], 0.72);
  thornRect(img, name.x, name.y, name.frameW, name.frameH, ICE, 0.66);
  heart(img, name.x + name.frameW / 2, name.y + name.frameH / 2, 5, PINK, 0.84);

  const prompt = V4_UI_CELLS['ui.prompt'];
  block(img, prompt.x + 3, prompt.y + 3, prompt.frameW - 6, prompt.frameH - 6, [7, 10, 16], 0.7);
  thornRect(img, prompt.x, prompt.y, prompt.frameW, prompt.frameH, ICE, 0.62);
  diamond(img, prompt.x + 12, prompt.y + 12, 4, PINK, 0.84);

  const assist = V4_UI_CELLS['ui.assist.seal'];
  const cx = assist.x + 24;
  const cy = assist.y + 24;
  ring(img, cx, cy, 18, ICE, 0.58);
  ring(img, cx, cy, 12, GREEN, 0.72);
  heart(img, cx, cy, 7, GREEN, 0.85);
  line(img, cx - 16, cy + 16, cx + 16, cy - 16, ICE, 0.5);
}

const atlas = image(V4_UI_ATLAS_WIDTH, V4_UI_ATLAS_HEIGHT);
paintLogo(atlas);
paintPanel(atlas);
paintCursor(atlas);
paintDivider(atlas);
paintFocus(atlas);
paintGraze(atlas);
paintSmallIcons(atlas);
(['scout', 'lance', 'hound', 'spire', 'maw'] as const).forEach((name, index) =>
  paintCrest(atlas, name, index),
);
paintDifficulty(atlas);
paintStatus(atlas);
paintBars(atlas);
paintPlates(atlas);

const bytes = encodePng(atlas.width, atlas.height, ColourType.RGBA, (x, y) => {
  const at = (y * atlas.width + x) * 4;
  return [atlas.rgba[at]!, atlas.rgba[at + 1]!, atlas.rgba[at + 2]!, atlas.rgba[at + 3]!];
});

const verified = parsePng(bytes);
if (
  verified.width !== V4_UI_ATLAS_WIDTH ||
  verified.height !== V4_UI_ATLAS_HEIGHT ||
  verified.colourType !== ColourType.RGBA
) {
  throw new Error(
    `v4 UI PNG verify failed: ${verified.width}×${verified.height}, colour type ${verified.colourType}`,
  );
}

const output = resolve(import.meta.dir, '../src/assets/v4/ui-v4.png');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, bytes);
console.log(`v4 UI atlas  ${V4_UI_ATLAS_WIDTH}×${V4_UI_ATLAS_HEIGHT}  ${Object.keys(V4_UI_CELLS).length} named entries`);
console.log(output);
