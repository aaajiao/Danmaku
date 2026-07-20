/**
 * Procedurally generated placeholder art.
 *
 * Upstream's sprites are Touhou Project derivatives and cannot ship (CLAUDE.md,
 * rule 9). Rather than block on art, the engine generates its own sheet at
 * runtime — original by construction, and license-clean.
 *
 * This doubles as the executable specification for the real art set: the grid
 * geometry, cell count and pivot conventions defined here are exactly what
 * `docs/assets.md` asks an artist or an image model to match. Replacing this
 * with a loaded PNG must not require touching anything else.
 *
 * Bullets are drawn **white** and tinted per-instance by the shader. One
 * greyscale shape therefore serves every colour in the game, which is why the
 * sheet is small and why the art spec asks for luminance, not colour.
 */

import * as THREE from 'three';
import { Atlas, type GridSpec } from './atlas';

/** Every generated sheet uses this grid. The real art set must match it. */
export const BULLET_GRID: GridSpec = { cellW: 32, cellH: 32 };
export const BULLET_COLUMNS = 8;
export const BULLET_ROWS = 2;

/**
 * Cell names in row-major order. Content references these, never indices —
 * so re-packing the sheet cannot silently repoint a bullet at the wrong art.
 */
export const BULLET_CELLS = [
  'orb.small',
  'orb.medium',
  'orb.large',
  'ring',
  'kunai',
  'scale',
  'star',
  'shard',
  'glow.small',
  'glow.medium',
  'glow.large',
  'halo',
  'needle',
  'petal',
  'spark',
  'mote',
] as const;

export type BulletCell = (typeof BULLET_CELLS)[number];

type Ctx = CanvasRenderingContext2D;

function canvas(width: number, height: number): { el: HTMLCanvasElement; ctx: Ctx } {
  const el = document.createElement('canvas');
  el.width = width;
  el.height = height;
  const ctx = el.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return { el, ctx };
}

/** Soft radial body — the core shape most danmaku sprites are built from. */
function orb(ctx: Ctx, cx: number, cy: number, radius: number, coreRatio = 0.45): void {
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(coreRatio, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.82, 'rgba(255,255,255,0.35)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
}

/** Hollow ring — reads clearly against dense fire, so it suits aimed shots. */
function ring(ctx: Ctx, cx: number, cy: number, radius: number, thickness: number): void {
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = thickness;
  ctx.beginPath();
  ctx.arc(cx, cy, radius - thickness / 2, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = thickness * 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius - thickness / 2, 0, Math.PI * 2);
  ctx.stroke();
}

/** Elongated blade, pointing along +x so rotation matches heading. */
function blade(ctx: Ctx, cx: number, cy: number, len: number, wide: number): void {
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.moveTo(cx + len / 2, cy);
  ctx.quadraticCurveTo(cx, cy - wide / 2, cx - len / 2, cy);
  ctx.quadraticCurveTo(cx, cy + wide / 2, cx + len / 2, cy);
  ctx.fill();
}

function star(ctx: Ctx, cx: number, cy: number, radius: number, points: number): void {
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? radius : radius * 0.42;
    const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function shard(ctx: Ctx, cx: number, cy: number, len: number, wide: number): void {
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.moveTo(cx + len / 2, cy);
  ctx.lineTo(cx, cy - wide / 2);
  ctx.lineTo(cx - len / 2, cy);
  ctx.lineTo(cx, cy + wide / 2);
  ctx.closePath();
  ctx.fill();
}

function petal(ctx: Ctx, cx: number, cy: number, radius: number): void {
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.moveTo(cx + radius, cy);
  ctx.quadraticCurveTo(cx, cy - radius * 0.9, cx - radius, cy);
  ctx.quadraticCurveTo(cx, cy + radius * 0.5, cx + radius, cy);
  ctx.fill();
}

const PAINTERS: Record<BulletCell, (ctx: Ctx, cx: number, cy: number) => void> = {
  'orb.small': (c, x, y) => orb(c, x, y, 5),
  'orb.medium': (c, x, y) => orb(c, x, y, 8),
  'orb.large': (c, x, y) => orb(c, x, y, 13),
  ring: (c, x, y) => ring(c, x, y, 12, 3),
  kunai: (c, x, y) => blade(c, x, y, 26, 9),
  scale: (c, x, y) => shard(c, x, y, 20, 12),
  star: (c, x, y) => star(c, x, y, 13, 5),
  shard: (c, x, y) => shard(c, x, y, 26, 7),
  'glow.small': (c, x, y) => orb(c, x, y, 7, 0.15),
  'glow.medium': (c, x, y) => orb(c, x, y, 11, 0.12),
  'glow.large': (c, x, y) => orb(c, x, y, 15, 0.1),
  halo: (c, x, y) => ring(c, x, y, 15, 2),
  needle: (c, x, y) => blade(c, x, y, 28, 5),
  petal: (c, x, y) => petal(c, x, y, 11),
  spark: (c, x, y) => star(c, x, y, 11, 4),
  mote: (c, x, y) => orb(c, x, y, 3),
};

/**
 * Render the bullet sheet into a texture.
 *
 * Everything is white; colour comes from the per-instance tint. Cells are
 * padded by construction — shapes are drawn well inside their 32px cell — so
 * NEAREST sampling cannot bleed a neighbour in at the edges.
 */
export function createBulletAtlas(): Atlas {
  const { cellW, cellH } = BULLET_GRID;
  const width = cellW * BULLET_COLUMNS;
  const height = cellH * BULLET_ROWS;
  const { el, ctx } = canvas(width, height);

  BULLET_CELLS.forEach((name, index) => {
    const col = index % BULLET_COLUMNS;
    const row = Math.floor(index / BULLET_COLUMNS);
    const cx = col * cellW + cellW / 2;
    const cy = row * cellH + cellH / 2;
    PAINTERS[name](ctx, cx, cy);
  });

  const texture = new THREE.CanvasTexture(el);
  texture.magFilter = THREE.LinearFilter; // generated art is smooth, not pixel art
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace; // display-referred; see atlas.ts
  texture.flipY = false;
  texture.needsUpdate = true;

  const atlas = new Atlas(texture, width, height, BULLET_GRID);
  atlas.defineGrid([...BULLET_CELLS]);
  return atlas;
}

/** A simple ship silhouette, pointing up (-y). Placeholder for the player. */
export function createShipAtlas(): Atlas {
  const size = 64;
  const { el, ctx } = canvas(size, size);
  const cx = size / 2;
  const cy = size / 2;

  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 22);
  ctx.lineTo(cx + 16, cy + 18);
  ctx.lineTo(cx, cy + 9);
  ctx.lineTo(cx - 16, cy + 18);
  ctx.closePath();
  ctx.fill();

  // Hitbox marker. In danmaku the hitbox is far smaller than the sprite, and
  // showing it is a genuine readability feature, not a debug affordance.
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.beginPath();
  ctx.arc(cx, cy + 2, 3, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(el);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace; // display-referred; see atlas.ts
  texture.flipY = false;
  texture.needsUpdate = true;

  const atlas = new Atlas(texture, size, size);
  atlas.define('ship', { x: 0, y: 0, w: size, h: size });
  return atlas;
}
