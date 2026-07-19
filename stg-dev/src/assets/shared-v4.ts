import atlasIndexManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/v4/atlas-index-v4.json";
import frameIndexManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/v4/frame-index-v4.json";
import backgroundsManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/v4/backgrounds-v4.json";
import audioManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/narrative/audio-manifest-v4.json";
import coreAtlasUrl from "../../../1bit-stg-complete-asset-kit-v4/atlases/core-grammar-v3.png?url";
import bossAtlasUrl from "../../../1bit-stg-complete-asset-kit-v4/atlases/boss-topologies-v3.png?url";
import causalityAtlasUrl from "../../../1bit-stg-complete-asset-kit-v4/atlases/combat-causality-v3.png?url";
import narrativeAtlasUrl from "../../../1bit-stg-complete-asset-kit-v4/atlases/narrative-behavior-v3.png?url";
import playerWorldAtlasUrl from "../../../1bit-stg-complete-asset-kit-v4/atlases/player-world-behavior-v4.png?url";
import combatAtlasUrl from "../../../1bit-stg-complete-asset-kit-v4/atlases/combat-behavior-cues-v4.png?url";
import bossPhaseAtlasUrl from "../../../1bit-stg-complete-asset-kit-v4/atlases/boss-phase-components-v4.png?url";
import informationBackgroundUrl from "../../../1bit-stg-complete-asset-kit-v4/backgrounds/composites/information-gameplay.png?url";
import forcedBackgroundUrl from "../../../1bit-stg-complete-asset-kit-v4/backgrounds/composites/forced_choice-gameplay.png?url";
import betweenBackgroundUrl from "../../../1bit-stg-complete-asset-kit-v4/backgrounds/composites/in_between-gameplay.png?url";
import polarizedBackgroundUrl from "../../../1bit-stg-complete-asset-kit-v4/backgrounds/composites/polarized-gameplay.png?url";
import informationBedUrl from "../../../1bit-stg-complete-asset-kit-v4/audio/assets/rooms/information-bed.wav?url";
import forcedBedUrl from "../../../1bit-stg-complete-asset-kit-v4/audio/assets/rooms/forced-alignment-bed.wav?url";
import betweenBedUrl from "../../../1bit-stg-complete-asset-kit-v4/audio/assets/rooms/in-between-bed.wav?url";
import polarizedBedUrl from "../../../1bit-stg-complete-asset-kit-v4/audio/assets/rooms/polarized-bed.wav?url";
import grazeUrl from "../../../1bit-stg-complete-asset-kit-v4/audio/assets/sfx/graze-evidence.wav?url";
import damageUrl from "../../../1bit-stg-complete-asset-kit-v4/audio/assets/sfx/player-damage.wav?url";
import gazeHoldUrl from "../../../1bit-stg-complete-asset-kit-v4/audio/assets/sfx/gaze-hold-pulse.wav?url";
import overrideUrl from "../../../1bit-stg-complete-asset-kit-v4/audio/assets/sfx/override-tear.wav?url";
import deniedUrl from "../../../1bit-stg-complete-asset-kit-v4/audio/assets/sfx/override-charge.wav?url";
import protocolUrl from "../../../1bit-stg-complete-asset-kit-v4/audio/assets/sfx/protocol-withdraw.wav?url";
import {assertV4SchemaVersion, bindV4RuntimeAssets} from "./v4-runtime-asset";

const atlasUrlsBySourcePath = Object.freeze({
  "atlases/core-grammar-v3.png": coreAtlasUrl,
  "atlases/boss-topologies-v3.png": bossAtlasUrl,
  "atlases/combat-causality-v3.png": causalityAtlasUrl,
  "atlases/narrative-behavior-v3.png": narrativeAtlasUrl,
  "atlases/player-world-behavior-v4.png": playerWorldAtlasUrl,
  "atlases/combat-behavior-cues-v4.png": combatAtlasUrl,
  "atlases/boss-phase-components-v4.png": bossPhaseAtlasUrl,
});

const backgroundUrlsBySourcePath = Object.freeze({
  "backgrounds/composites/information-gameplay.png": informationBackgroundUrl,
  "backgrounds/composites/forced_choice-gameplay.png": forcedBackgroundUrl,
  "backgrounds/composites/in_between-gameplay.png": betweenBackgroundUrl,
  "backgrounds/composites/polarized-gameplay.png": polarizedBackgroundUrl,
});

const roomBedUrlsBySourcePath = Object.freeze({
  "audio/assets/rooms/information-bed.wav": informationBedUrl,
  "audio/assets/rooms/forced-alignment-bed.wav": forcedBedUrl,
  "audio/assets/rooms/in-between-bed.wav": betweenBedUrl,
  "audio/assets/rooms/polarized-bed.wav": polarizedBedUrl,
});

const feedbackAudioUrlsBySourcePath = Object.freeze({
  "audio/assets/sfx/graze-evidence.wav": grazeUrl,
  "audio/assets/sfx/player-damage.wav": damageUrl,
  "audio/assets/sfx/gaze-hold-pulse.wav": gazeHoldUrl,
  "audio/assets/sfx/override-tear.wav": overrideUrl,
  "audio/assets/sfx/override-charge.wav": deniedUrl,
  "audio/assets/sfx/protocol-withdraw.wav": protocolUrl,
});

assertV4SchemaVersion("V4 atlas index", atlasIndexManifest.schemaVersion, "4.0.0");
assertV4SchemaVersion("V4 frame index", frameIndexManifest.schemaVersion, "4.0.0");
assertV4SchemaVersion("V4 backgrounds", backgroundsManifest.schemaVersion, "4.0.0-backgrounds");
assertV4SchemaVersion("V4 audio", audioManifest.schemaVersion, "4.0.0-audio");

function manifestSize(catalog: string, id: string, size: readonly number[]): readonly [number, number] {
  const [width, height] = size;
  if (width === undefined || height === undefined || size.length !== 2) {
    throw new Error(`${catalog} ${id} requires an exact width/height pair`);
  }
  return [width, height];
}

const atlases = bindV4RuntimeAssets({
  catalog: "V4 atlas runtime registry",
  entries: atlasIndexManifest.atlases,
  urlsBySourcePath: atlasUrlsBySourcePath,
  keyOf: (entry) => entry.id,
  idOf: (entry) => entry.id,
  sourcePathOf: (entry) => entry.file,
  sha256Of: (entry) => entry.sha256,
  sizeOf: (entry) => manifestSize("V4 atlas", entry.id, entry.size),
});

if (
  atlasIndexManifest.atlasCount !== Object.keys(atlases).length
  || frameIndexManifest.frames.length !== atlasIndexManifest.frameCount
) {
  throw new Error("V4 atlas/frame runtime counts drifted");
}
for (const frame of frameIndexManifest.frames) {
  if (!Object.hasOwn(atlases, frame.atlas)) {
    throw new Error(`V4 frame ${frame.semanticId} references an unavailable atlas ${frame.atlas}`);
  }
}

const backgrounds = bindV4RuntimeAssets({
  catalog: "V4 background runtime registry",
  entries: backgroundsManifest.baseComposites,
  urlsBySourcePath: backgroundUrlsBySourcePath,
  keyOf: (entry) => entry.room,
  idOf: (entry) => entry.room,
  sourcePathOf: (entry) => entry.file,
  sha256Of: (entry) => entry.sha256,
  sizeOf: (entry) => manifestSize("V4 background", entry.room, entry.size),
});

const roomBedPaths = new Set(Object.keys(roomBedUrlsBySourcePath));
const roomBeds = bindV4RuntimeAssets({
  catalog: "V4 room-bed runtime registry",
  entries: audioManifest.assets.filter((entry) => roomBedPaths.has(entry.path)),
  urlsBySourcePath: roomBedUrlsBySourcePath,
  keyOf: (entry) => entry.room ?? "",
  idOf: (entry) => entry.id,
  sourcePathOf: (entry) => entry.path,
  sha256Of: (entry) => entry.sha256,
});

const feedbackAudioPaths = new Set(Object.keys(feedbackAudioUrlsBySourcePath));
const feedbackAudio = bindV4RuntimeAssets({
  catalog: "V4 feedback-audio runtime registry",
  entries: audioManifest.assets.filter((entry) => feedbackAudioPaths.has(entry.path)),
  urlsBySourcePath: feedbackAudioUrlsBySourcePath,
  keyOf: (entry) => entry.id,
  idOf: (entry) => entry.id,
  sourcePathOf: (entry) => entry.path,
  sha256Of: (entry) => entry.sha256,
});

/** Shared, passive media catalog. It owns URLs but no gameplay authority. */
export const V4_SHARED_ASSETS = Object.freeze({
  atlases,
  backgrounds,
  roomBeds,
  feedbackAudio,
});
