/**
 * Per-character dialogue portrait identity for the committed v4 actor atlases.
 *
 * The v4 pack supplies dedicated close crops so dialogue can read the face,
 * heart and hands without enlarging a field sprite. Packs made before that
 * fourth actor family still use the deterministic frame anchors below. Both
 * paths are presentation-only views of the same project-owned masters.
 */

import type { Region } from './atlas';

export interface V4PortraitSpec {
  /** Semantic actor pose. Players use neutral; bosses use their cast gesture. */
  readonly pose: number;
  /** Square crop as a fraction of one atlas frame. */
  readonly crop: number;
  /** Normalized crop centre inside one frame. */
  readonly anchorX: number;
  readonly anchorY: number;
}

export const V4_PLAYER_PORTRAIT_STRIPS: Readonly<Record<string, string>> = {
  scout: 'actor.portrait.player.scout',
  lance: 'actor.portrait.player.lance',
  hound: 'actor.portrait.player.hound',
  spire: 'actor.portrait.player.spire',
  maw: 'actor.portrait.player.maw',
};

export const V4_BOSS_PORTRAIT_STRIPS: Readonly<Record<string, string>> = {
  sentinel: 'actor.portrait.boss.sentinel',
  warden: 'actor.portrait.boss.warden',
  magistrate: 'actor.portrait.boss.magistrate',
  chancellor: 'actor.portrait.boss.chancellor',
  regent: 'actor.portrait.boss.regent',
};

export function v4PortraitStrip(
  speaker: string,
  characterName: string,
): string | undefined {
  return speaker === 'player'
    ? V4_PLAYER_PORTRAIT_STRIPS[characterName]
    : V4_BOSS_PORTRAIT_STRIPS[speaker];
}

/** Compatibility crop ledger for packs that omit `assets.actors.portraits`. */
export const V4_PLAYER_PORTRAITS: Readonly<Record<string, V4PortraitSpec>> = {
  scout: { pose: 2, crop: 0.56, anchorX: 0.5, anchorY: 0.34 },
  lance: { pose: 2, crop: 0.58, anchorX: 0.5, anchorY: 0.34 },
  hound: { pose: 2, crop: 0.66, anchorX: 0.5, anchorY: 0.38 },
  spire: { pose: 2, crop: 0.62, anchorX: 0.5, anchorY: 0.34 },
  maw: { pose: 2, crop: 0.66, anchorX: 0.5, anchorY: 0.38 },
};

export const V4_BOSS_PORTRAITS: Readonly<Record<string, V4PortraitSpec>> = {
  sentinel: { pose: 2, crop: 0.58, anchorX: 0.5, anchorY: 0.36 },
  warden: { pose: 2, crop: 0.6, anchorX: 0.54, anchorY: 0.36 },
  magistrate: { pose: 2, crop: 0.6, anchorX: 0.5, anchorY: 0.36 },
  chancellor: { pose: 2, crop: 0.62, anchorX: 0.54, anchorY: 0.37 },
  regent: { pose: 2, crop: 0.62, anchorX: 0.55, anchorY: 0.36 },
};

export function v4PortraitSpec(
  speaker: string,
  characterName: string,
): V4PortraitSpec | undefined {
  return speaker === 'player'
    ? V4_PLAYER_PORTRAITS[characterName]
    : V4_BOSS_PORTRAITS[speaker];
}

/** Clamp a normalized anchor to an integer square wholly inside its source frame. */
export function v4PortraitSource(frame: Region, spec: V4PortraitSpec): Region {
  const crop = Math.max(1, Math.min(
    frame.w,
    frame.h,
    Math.round(Math.min(frame.w, frame.h) * spec.crop),
  ));
  const wantedX = frame.x + frame.w * spec.anchorX - crop / 2;
  const wantedY = frame.y + frame.h * spec.anchorY - crop / 2;
  const x = Math.round(Math.max(frame.x, Math.min(frame.x + frame.w - crop, wantedX)));
  const y = Math.round(Math.max(frame.y, Math.min(frame.y + frame.h - crop, wantedY)));
  return { x, y, w: crop, h: crop };
}
