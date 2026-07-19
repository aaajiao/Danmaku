import {V4_SHARED_ASSETS} from "../shared-v4";
import {
  requiredFeedbackResolver,
  requiredFrame,
  requiredHapticPulses,
  requiredRoomSelector,
  requiredStringResolver,
} from "../v4-feedback";
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

const gazeAcquireVisual = requiredFeedbackResolver(
  "gaze-acquire-visual",
  "gaze.acquire.begin",
  "visual",
);
const gazeClampVisual = requiredFeedbackResolver(
  "gaze-clamp-visual",
  "gaze.clamp.commit",
  "visual",
);
const gazeClampAudio = requiredFeedbackResolver(
  "gaze-clamp-audio",
  "gaze.clamp.commit",
  "audio",
);
const gazeClampHaptic = requiredFeedbackResolver(
  "gaze-clamp-haptic",
  "gaze.clamp.commit",
  "haptic",
);
const gazeReleaseVisual = requiredFeedbackResolver(
  "gaze-release-visual",
  "gaze.clamp.release",
  "visual",
);
const gazeClampFallback = gazeClampVisual.resolver.accessibilityFallback;
if (gazeClampFallback === undefined || !gazeClampFallback.when.includes("motion:reduced")) {
  throw new Error("Canonical Run V4 gaze clamp requires its reduced-motion fallback");
}

export const CANONICAL_RUN_FIRST_EYE_V4_FEEDBACK = Object.freeze({
  acquire: Object.freeze({
    eventId: gazeAcquireVisual.binding.eventId,
    visual: Object.freeze({
      bindingId: gazeAcquireVisual.binding.id,
      cueId: gazeAcquireVisual.binding.sink.cueId,
      frameId: requiredFrame(gazeAcquireVisual.resolver.resolver, gazeAcquireVisual.binding.id),
    }),
  }),
  clamp: Object.freeze({
    eventId: gazeClampVisual.binding.eventId,
    visual: Object.freeze({
      bindingId: gazeClampVisual.binding.id,
      cueId: gazeClampVisual.binding.sink.cueId,
      frameId: requiredFrame(gazeClampVisual.resolver.resolver, gazeClampVisual.binding.id),
      reducedMotionFrameId: requiredFrame(
        gazeClampFallback.resolver,
        gazeClampVisual.binding.id,
      ),
    }),
    audio: Object.freeze({
      bindingId: gazeClampAudio.binding.id,
      cueId: gazeClampAudio.binding.sink.cueId,
      asset: requiredAsset(
        V4_SHARED_ASSETS.feedbackAudio,
        requiredStringResolver(gazeClampAudio.resolver.resolver, gazeClampAudio.binding.id),
        "First Eye clamp audio",
      ),
    }),
    haptic: Object.freeze({
      bindingId: gazeClampHaptic.binding.id,
      cueId: gazeClampHaptic.binding.sink.cueId,
      pulses: requiredHapticPulses(gazeClampHaptic.resolver.resolver, gazeClampHaptic.binding.id),
    }),
  }),
  release: Object.freeze({
    eventId: gazeReleaseVisual.binding.eventId,
    visual: Object.freeze({
      bindingId: gazeReleaseVisual.binding.id,
      cueId: gazeReleaseVisual.binding.sink.cueId,
      frameId: requiredFrame(gazeReleaseVisual.resolver.resolver, gazeReleaseVisual.binding.id),
    }),
  }),
});

const roomTransitionVisual = requiredFeedbackResolver(
  "room-transition-visual",
  "room.transition.begin",
  "visual",
);
const roomWorldSwapVisual = requiredFeedbackResolver(
  "room-world-swap-visual",
  "room.transition.world_swap.commit",
  "visual",
);
const roomTransitionFallback = roomTransitionVisual.resolver.accessibilityFallback;
if (
  roomTransitionFallback === undefined
  || !roomTransitionFallback.when.includes("motion:reduced")
) {
  throw new Error("Canonical Run V4 room threshold requires its reduced-motion fallback");
}
const canonicalThresholdRooms = Object.freeze(
  Object.keys(V4_SHARED_ASSETS.backgrounds).sort(compareCodePoints),
);
const roomThresholdFrames = requiredRoomSelector(
  roomTransitionVisual.resolver.resolver,
  roomTransitionVisual.binding.id,
  "threshold.{roomSlug}",
  canonicalThresholdRooms,
  (frameId) => requiredFrame(frameId, roomTransitionVisual.binding.id),
);
const reducedRoomThresholdFrames = requiredRoomSelector(
  roomTransitionFallback.resolver,
  roomTransitionVisual.binding.id,
  "threshold.{roomSlug}",
  canonicalThresholdRooms,
  (frameId) => requiredFrame(frameId, roomTransitionVisual.binding.id),
);
const worldSwapThresholdFrames = requiredRoomSelector(
  roomWorldSwapVisual.resolver.resolver,
  roomWorldSwapVisual.binding.id,
  "threshold.{roomSlug}",
  canonicalThresholdRooms,
  (frameId) => requiredFrame(frameId, roomWorldSwapVisual.binding.id),
);

function sameRoomFrameSelection(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftRooms = Object.keys(left);
  const rightRooms = Object.keys(right);
  return leftRooms.length === rightRooms.length
    && leftRooms.every((room) => left[room] === right[room]);
}

if (
  !sameRoomFrameSelection(roomThresholdFrames.byRoom, reducedRoomThresholdFrames.byRoom)
  || !sameRoomFrameSelection(roomThresholdFrames.byRoom, worldSwapThresholdFrames.byRoom)
  || roomThresholdFrames.fallback !== reducedRoomThresholdFrames.fallback
  || roomThresholdFrames.fallback !== worldSwapThresholdFrames.fallback
) {
  throw new Error("Canonical Run V4 room threshold frame selection drifted across feedback profiles");
}

export const CANONICAL_RUN_ROOM_THRESHOLD_V4_FEEDBACK = Object.freeze({
  selector: roomThresholdFrames.selector,
  frameByRoom: roomThresholdFrames.byRoom,
  fallbackFrameId: roomThresholdFrames.fallback,
  begin: Object.freeze({
    eventId: roomTransitionVisual.binding.eventId,
    bindingId: roomTransitionVisual.binding.id,
    cueId: roomTransitionVisual.binding.sink.cueId,
    reducedMotionCueId: roomTransitionFallback.cueId,
  }),
  worldSwap: Object.freeze({
    eventId: roomWorldSwapVisual.binding.eventId,
    bindingId: roomWorldSwapVisual.binding.id,
    cueId: roomWorldSwapVisual.binding.sink.cueId,
  }),
});

export function canonicalRunRoomThresholdFrame(room: string): string {
  const frameId = CANONICAL_RUN_ROOM_THRESHOLD_V4_FEEDBACK.frameByRoom[room];
  if (frameId === undefined) {
    throw new Error(`Canonical Run has no V4 room threshold projection for ${room}`);
  }
  return frameId;
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
