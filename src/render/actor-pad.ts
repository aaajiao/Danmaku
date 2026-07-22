/**
 * Small, actor-local darkness plates for v4's translucent women.
 *
 * These are normal-blend sprites, not a vignette: one follows each visible
 * actor and extends only a role-sized margin beyond her display box.  They
 * never affect the simulation and carry no clock or random input.  Their only
 * job is to keep the surface/skeleton/mycelium silhouette legible when an
 * authored scene is locally busy; bullets still draw hundreds of render-order
 * steps above them.
 */

import * as THREE from 'three';
import { Atlas } from './atlas';
import { Layer } from './stage';

export type ActorPadRole = 'enemy' | 'boss' | 'player';

export interface ActorPadLayout {
  readonly width: number;
  readonly height: number;
  readonly alpha: number;
}

export const ACTOR_PAD_CELL = 'actor.pad';
export const ACTOR_PAD_TEXTURE_SIZE = 64;
export const ACTOR_PAD_RENDER_ORDER = {
  enemy: Layer.Enemies - 1,
  player: Layer.Player - 2,
} as const;

const PAD_STYLE: Readonly<Record<ActorPadRole, { margin: number; alpha: number }>> = {
  enemy: { margin: 12, alpha: 0.2 },
  boss: { margin: 18, alpha: 0.3 },
  player: { margin: 14, alpha: 0.22 },
};

/** Resolve a local pad's logical size without teaching the renderer actor names. */
export function actorPadLayout(role: ActorPadRole, actorSize: number): ActorPadLayout {
  const style = PAD_STYLE[role];
  const size = Math.max(1, actorSize);
  return {
    width: size + style.margin * 2,
    height: size + style.margin * 2,
    alpha: style.alpha,
  };
}

/**
 * Alpha for one texel of the reusable pad.
 *
 * A solid centre makes the actor's internal greys reliable; the squared fade
 * reaches zero before the texture edge, so linear filtering has a transparent
 * gutter and no rectangular seam can appear around a woman.
 */
export function actorPadAlphaAt(x: number, y: number, size = ACTOR_PAD_TEXTURE_SIZE): number {
  const half = size / 2;
  const dx = (x + 0.5 - half) / half;
  const dy = (y + 0.5 - half) / half;
  const distance2 = dx * dx + dy * dy;
  const inner2 = 0.42 * 0.42;
  const outer2 = 0.88 * 0.88;
  if (distance2 <= inner2) return 255;
  if (distance2 >= outer2) return 0;
  const fade = (outer2 - distance2) / (outer2 - inner2);
  return Math.round(255 * fade * fade);
}

/** Build the one-cell, project-owned procedural texture used by both pad batches. */
export function createActorPadAtlas(): Atlas {
  const size = ACTOR_PAD_TEXTURE_SIZE;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4;
      pixels[offset] = 3;
      pixels[offset + 1] = 5;
      pixels[offset + 2] = 9;
      pixels[offset + 3] = actorPadAlphaAt(x, y, size);
    }
  }

  const texture = new THREE.DataTexture(
    pixels,
    size,
    size,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;

  return new Atlas(texture, size, size).define(ACTOR_PAD_CELL, {
    x: 0,
    y: 0,
    w: size,
    h: size,
  });
}
