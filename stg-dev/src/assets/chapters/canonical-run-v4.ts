import {V4_SHARED_ASSETS} from "../shared-v4";
import type {V4RuntimeAsset} from "../v4-runtime-asset";

const roomAssetSource = Object.freeze({
  AWAKENING: "INFORMATION",
  INFORMATION: "INFORMATION",
  FORCED_ALIGNMENT: "FORCED_ALIGNMENT",
  IN_BETWEEN: "IN_BETWEEN",
  POLARIZED: "POLARIZED",
  COMMON: "INFORMATION",
  TRANSITION: "IN_BETWEEN",
} as const);

const feedbackAudioIdByType = Object.freeze({
  graze: "sfx.graze_evidence",
  damage: "sfx.player_damage",
  override: "sfx.override_tear",
  "override-denied": "sfx.override_charge",
  protocol: "sfx.protocol_withdraw",
} as const);

export type CanonicalRunAssetRoom = keyof typeof V4_SHARED_ASSETS.backgrounds;

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requiredAsset(
  catalog: Readonly<Record<string, Readonly<V4RuntimeAsset>>>,
  id: string,
  role: string,
): Readonly<V4RuntimeAsset> {
  const asset = catalog[id];
  if (asset === undefined) throw new Error(`Canonical Run ${role} references unknown V4 asset ${id}`);
  return asset;
}

for (const assetRoom of Object.values(roomAssetSource)) {
  requiredAsset(V4_SHARED_ASSETS.backgrounds, assetRoom, "background");
  requiredAsset(V4_SHARED_ASSETS.roomBeds, assetRoom, "room bed");
}
for (const audioId of Object.values(feedbackAudioIdByType)) {
  requiredAsset(V4_SHARED_ASSETS.feedbackAudio, audioId, "feedback audio");
}

/**
 * Chapter-level selection only: physical paths remain owned by the shared V4
 * catalog. All seven atlases are required while GameView accepts all 448 V4
 * frames; a later lazy chapter loader may narrow this after that API changes.
 */
export const CANONICAL_RUN_V4_ASSETS = Object.freeze({
  atlasIds: Object.freeze(Object.keys(V4_SHARED_ASSETS.atlases).sort(compareCodePoints)),
  roomAssetSource,
  feedbackAudioIdByType,
});

export function canonicalRunAssetRoom(room: string): CanonicalRunAssetRoom {
  const assetRoom = (roomAssetSource as Readonly<Record<string, CanonicalRunAssetRoom | undefined>>)[room];
  if (assetRoom === undefined) throw new Error(`Canonical Run has no V4 room asset projection for ${room}`);
  return assetRoom;
}

export function canonicalRunBackground(room: string): Readonly<V4RuntimeAsset> {
  const assetRoom = canonicalRunAssetRoom(room);
  return requiredAsset(V4_SHARED_ASSETS.backgrounds, assetRoom, "background");
}

export function canonicalRunRoomBed(room: string): Readonly<V4RuntimeAsset> {
  const assetRoom = canonicalRunAssetRoom(room);
  return requiredAsset(V4_SHARED_ASSETS.roomBeds, assetRoom, "room bed");
}

/** A missing binding is intentional silence, not a generic substitute. */
export function canonicalRunFeedbackAudio(type: string): Readonly<V4RuntimeAsset> | null {
  const audioId = (feedbackAudioIdByType as Readonly<Record<string, string | undefined>>)[type];
  return audioId === undefined
    ? null
    : requiredAsset(V4_SHARED_ASSETS.feedbackAudio, audioId, "feedback audio");
}
