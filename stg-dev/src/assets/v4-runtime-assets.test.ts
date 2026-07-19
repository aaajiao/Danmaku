import {describe, expect, it} from "vitest";
import atlasIndexManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/v4/atlas-index-v4.json";
import frameIndexManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/v4/frame-index-v4.json";
import backgroundsManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/v4/backgrounds-v4.json";
import audioManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/narrative/audio-manifest-v4.json";
import {
  CANONICAL_RUN_V4_ASSETS,
  canonicalRunAssetRoom,
  canonicalRunBackground,
  canonicalRunFeedbackAudio,
  canonicalRunRoomBed,
} from "./chapters/canonical-run-v4";
import {V4_SHARED_ASSETS} from "./shared-v4";

function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

describe("manifest-derived V4 runtime assets", () => {
  it("closes the shared frame universe and resolves chapter media without copied paths", () => {
    const manifestAtlasIds = atlasIndexManifest.atlases.map((entry) => entry.id);
    expect(CANONICAL_RUN_V4_ASSETS.atlasIds).toEqual(sorted(manifestAtlasIds));
    expect(Object.keys(V4_SHARED_ASSETS.atlases)).toHaveLength(7);
    expect(frameIndexManifest.frames).toHaveLength(448);
    expect(frameIndexManifest.frames.every((frame) => V4_SHARED_ASSETS.atlases[frame.atlas] !== undefined))
      .toBe(true);

    const manifestBackgrounds = new Map(
      backgroundsManifest.baseComposites.map((entry) => [entry.room, entry]),
    );
    for (const asset of Object.values(V4_SHARED_ASSETS.backgrounds)) {
      const source = manifestBackgrounds.get(asset.id);
      expect(source?.file).toBe(asset.sourcePath);
      expect(source?.sha256).toBe(asset.sha256);
      expect(asset.sourcePath).not.toMatch(/(?:preview|\/qa\/)/u);
      expect(Object.isFrozen(asset)).toBe(true);
    }

    const audioById = new Map(audioManifest.assets.map((entry) => [entry.id, entry]));
    for (const asset of [
      ...Object.values(V4_SHARED_ASSETS.roomBeds),
      ...Object.values(V4_SHARED_ASSETS.feedbackAudio),
    ]) {
      const source = audioById.get(asset.id);
      expect(source?.path).toBe(asset.sourcePath);
      expect(source?.sha256).toBe(asset.sha256);
      expect(asset.sourcePath).not.toMatch(/(?:preview|\/qa\/)/u);
    }

    expect(canonicalRunAssetRoom("AWAKENING")).toBe("INFORMATION");
    expect(canonicalRunAssetRoom("COMMON")).toBe("INFORMATION");
    expect(canonicalRunAssetRoom("TRANSITION")).toBe("IN_BETWEEN");
    expect(canonicalRunBackground("FORCED_ALIGNMENT").sourcePath)
      .toBe("backgrounds/composites/forced_choice-gameplay.png");
    expect(canonicalRunRoomBed("POLARIZED").id).toBe("room.polarized.bed");
    expect(canonicalRunFeedbackAudio("damage")?.id).toBe("sfx.player_damage");
    expect(canonicalRunFeedbackAudio("unbound-event")).toBeNull();
    expect(() => canonicalRunAssetRoom("UNKNOWN_ROOM")).toThrow(/no V4 room asset projection/);

    expect(Object.isFrozen(V4_SHARED_ASSETS)).toBe(true);
    expect(Object.isFrozen(CANONICAL_RUN_V4_ASSETS)).toBe(true);
    expect(Object.isFrozen(CANONICAL_RUN_V4_ASSETS.atlasIds)).toBe(true);
    expect(Object.isFrozen(CANONICAL_RUN_V4_ASSETS.roomAssetSource)).toBe(true);
  });
});
