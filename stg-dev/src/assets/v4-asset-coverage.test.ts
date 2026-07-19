import {describe, expect, it} from "vitest";
import assetBindingsManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/integration/asset-bindings-v4.json";
import atlasIndexManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/v4/atlas-index-v4.json";
import audioManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/narrative/audio-manifest-v4.json";
import backgroundsManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/v4/backgrounds-v4.json";
import frameIndexManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/v4/frame-index-v4.json";
import packageManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/v4/package-manifest-v4.json";
import {
  V4_SHARED_ASSETS,
  v4Atlas,
  v4Audio,
  v4AudioOrNull,
  v4BossSignal,
  v4Frame,
  v4FrameOrNull,
  v4RoomBackground,
  v4RoomBed,
  v4RoomReaction,
  v4RoomReactionOrNull,
  v4RoomSlug,
} from "./shared-v4";

const QA_PATH = /previews|animations|mockups|reports|sources|legacy-v3|\/qa\//u;

describe("V4 production asset coverage", () => {
  it("binds every atlas the manifest ships and nothing else", () => {
    expect(Object.keys(V4_SHARED_ASSETS.atlases)).toHaveLength(packageManifest.counts.atlases);
    expect(Object.keys(V4_SHARED_ASSETS.atlases)).toHaveLength(7);
    const manifestById = new Map(atlasIndexManifest.atlases.map((entry) => [entry.id, entry]));
    expect(manifestById.size).toBe(7);
    for (const [id, asset] of Object.entries(V4_SHARED_ASSETS.atlases)) {
      const source = manifestById.get(id);
      expect(source).toBeDefined();
      expect(asset.sourcePath).toBe(source!.file);
      expect(asset.sha256).toBe(source!.sha256);
      expect(asset.size).toEqual(source!.size);
      expect(asset.url).toContain(id);
      expect(asset.sourcePath).not.toMatch(QA_PATH);
      expect(Object.isFrozen(asset)).toBe(true);
    }
    expect(v4Atlas("core-grammar-v3").id).toBe("core-grammar-v3");
    expect(() => v4Atlas("core-grammar-v9")).toThrow(/no atlas/u);
  });

  it("addresses all 448 frames by semantic id, each pointing at a bound atlas", () => {
    expect(frameIndexManifest.frames).toHaveLength(448);
    expect(packageManifest.counts.physicalFrames).toBe(448);
    expect(Object.keys(V4_SHARED_ASSETS.frames)).toHaveLength(448);
    expect(V4_SHARED_ASSETS.frameOrder).toHaveLength(448);
    expect(V4_SHARED_ASSETS.frameOrder).toEqual(
      frameIndexManifest.frames.map((entry) => entry.semanticId),
    );

    for (const entry of frameIndexManifest.frames) {
      const frame = v4Frame(entry.semanticId);
      expect(frame.atlasId).toBe(entry.atlas);
      expect(frame.atlasUrl).toBe(V4_SHARED_ASSETS.atlases[entry.atlas]!.url);
      expect(frame.rect).toEqual(entry.rect);
      expect(frame.pivot).toEqual(entry.pivot);
      expect(frame.index).toBe(entry.index);
      expect(frame.frameIndex).toBe(entry.frameIndex);
      expect(frame.row).toBe(entry.row);
      expect(frame.column).toBe(entry.column);
      expect(frame.logicalSize).toBe(entry.logicalSize);
      expect(frame.kind).toBe(entry.kind);
      expect(frame.paletteRole).toBe(entry.paletteRole);
      expect(frame.alphaMode).toBe("binary");
      expect(Object.isFrozen(frame)).toBe(true);
    }
  });

  it("resolves the frame-index room spelling through the room slug selector", () => {
    // frame-index says FORCED_CHOICE; the canonical room id is FORCED_ALIGNMENT.
    const forcedFrames = frameIndexManifest.frames.filter((entry) => entry.room === "FORCED_CHOICE");
    expect(forcedFrames.length).toBeGreaterThan(0);
    for (const entry of forcedFrames) {
      expect(v4Frame(entry.semanticId).room).toBe("FORCED_ALIGNMENT");
    }
    expect(v4RoomSlug("FORCED_ALIGNMENT")).toBe("forced_choice");
    expect(() => v4RoomSlug("FORCED_CHOICE")).toThrow(/no room slug/u);
    expect(V4_SHARED_ASSETS.roomIds).toEqual(
      Object.keys(assetBindingsManifest.selectors.roomSlug),
    );
  });

  it("fails closed on an unknown frame", () => {
    expect(() => v4Frame("eye.invented")).toThrow(/no frame eye.invented/u);
    expect(v4FrameOrNull("eye.invented")).toBeNull();
  });

  it("binds 4 base composites and all 16 reaction overlays, keyed by room and state", () => {
    expect(packageManifest.counts.baseBackgrounds).toBe(4);
    expect(packageManifest.counts.reactionOverlays).toBe(16);
    expect(Object.keys(V4_SHARED_ASSETS.backgrounds)).toHaveLength(4);
    expect(V4_SHARED_ASSETS.reactionStates)
      .toEqual(["threshold", "dusk", "aftermath", "memory"]);

    const overlayById = new Map(
      backgroundsManifest.reactionOverlays.map((entry) => [entry.id, entry]),
    );
    expect(overlayById.size).toBe(16);

    let bound = 0;
    for (const roomId of V4_SHARED_ASSETS.roomIds) {
      expect(v4RoomBackground(roomId).sourcePath).toMatch(/^backgrounds\/composites\//u);
      const slug = v4RoomSlug(roomId);
      for (const state of V4_SHARED_ASSETS.reactionStates) {
        const overlay = v4RoomReaction(roomId, state);
        const source = overlayById.get(`reaction.${slug}.${state}`);
        expect(source).toBeDefined();
        expect(overlay.sourcePath).toBe(source!.file);
        expect(overlay.sha256).toBe(source!.sha256);
        expect(overlay.size).toEqual(source!.size);
        expect(overlay.room).toBe(roomId);
        expect(overlay.state).toBe(state);
        expect(overlay.visiblePixels).toBe(source!.visiblePixels);
        expect(overlay.sourcePath).toMatch(/^backgrounds\/reactions\//u);
        expect(overlay.sourcePath).not.toMatch(QA_PATH);
        expect(Object.isFrozen(overlay)).toBe(true);
        bound += 1;
      }
    }
    expect(bound).toBe(16);

    expect(() => v4RoomReaction("FORCED_ALIGNMENT", "aftermath")).not.toThrow();
    expect(() => v4RoomReaction("forced_choice", "aftermath")).toThrow(/no aftermath reaction/u);
    expect(() => v4RoomReaction("FORCED_ALIGNMENT", "elegy")).toThrow(/no elegy reaction/u);
    expect(v4RoomReactionOrNull("FORCED_ALIGNMENT", "elegy")).toBeNull();
    expect(() => v4RoomBackground("NOWHERE")).toThrow(/no room background/u);
  });

  it("binds all 48 audio assets with their authored mix metadata", () => {
    expect(audioManifest.assets).toHaveLength(48);
    expect(packageManifest.counts.audioAssets).toBe(48);
    expect(Object.keys(V4_SHARED_ASSETS.audio)).toHaveLength(48);
    expect(Object.keys(V4_SHARED_ASSETS.roomBeds)).toHaveLength(4);
    expect(Object.keys(V4_SHARED_ASSETS.bossSignals)).toHaveLength(8);
    expect(Object.keys(V4_SHARED_ASSETS.feedbackAudio)).toHaveLength(36);
    expect(packageManifest.counts.bosses).toBe(8);

    for (const entry of audioManifest.assets) {
      const asset = v4Audio(entry.id);
      expect(asset.sourcePath).toBe(entry.path);
      expect(asset.sha256).toBe(entry.sha256);
      expect(asset.category).toBe(entry.category);
      expect(asset.loop).toBe(entry.loop);
      expect(asset.durationMs).toBe(entry.durationMs);
      expect(asset.sampleRate).toBe(48000);
      expect(asset.channels).toBe(entry.channels);
      expect(asset.bitDepth).toBe(entry.bitDepth);
      expect(asset.peak).toBe(entry.peak);
      expect(asset.rms).toBe(entry.rms);
      expect(asset.bytes).toBe(entry.bytes);
      expect(asset.sourcePath).toMatch(/^audio\/assets\//u);
      expect(asset.sourcePath).not.toMatch(QA_PATH);
      expect(V4_SHARED_ASSETS.audioMix.buses).toContain(asset.bus);
      expect(Object.isFrozen(asset)).toBe(true);
    }
  });

  it("projects every audio asset onto an authored mix bus", () => {
    const byBus = new Map<string, string[]>();
    for (const asset of Object.values(V4_SHARED_ASSETS.audio)) {
      byBus.set(asset.bus, [...(byBus.get(asset.bus) ?? []), asset.id]);
    }
    expect(byBus.get("room")).toHaveLength(4);
    expect(byBus.get("boss")).toHaveLength(8);
    expect(byBus.get("weather")).toHaveLength(5);
    expect(byBus.get("events")).toHaveLength(31);
    // The `ui` bus is authored with no audio asset: UI cues are copy and HUD
    // state, never sound. Intentional silence, not a missing binding.
    expect(byBus.get("ui")).toBeUndefined();
    expect(V4_SHARED_ASSETS.audioMix.buses).toEqual(["room", "boss", "events", "weather", "ui"]);

    const weatherSlugs = Object.values(assetBindingsManifest.selectors.weatherSlug);
    expect(weatherSlugs).toHaveLength(5);
    for (const slug of weatherSlugs) {
      expect(v4Audio(`sfx.weather_${slug}`).bus).toBe("weather");
    }
  });

  it("carries the room/boss handles the audio layer selects by", () => {
    for (const roomId of V4_SHARED_ASSETS.roomIds) {
      const bed = v4RoomBed(roomId);
      expect(bed.bus).toBe("room");
      expect(bed.loop).toBe(true);
      expect(bed.room).toBe(roomId);
      expect(bed.durationMs).toBe(12000);
    }
    expect(v4RoomBed("POLARIZED").id).toBe("room.polarized.bed");
    expect(() => v4RoomBed("forced_choice")).toThrow(/no room bed/u);

    // selectors.bossSlug: the canonical rig id minus its leading `boss.`.
    expect(v4BossSignal("boss.absent_receiver").id).toBe("boss.absent_receiver.signal");
    expect(v4BossSignal("absent_receiver").id).toBe("boss.absent_receiver.signal");
    for (const signal of Object.values(V4_SHARED_ASSETS.bossSignals)) {
      expect(signal.bus).toBe("boss");
      expect(signal.loop).toBe(false);
      expect(signal.bossId).not.toMatch(/^boss\./u);
    }
    expect(() => v4BossSignal("boss.invented")).toThrow(/no boss signal/u);
  });

  it("treats an unbound audio id as intentional silence", () => {
    expect(() => v4Audio("sfx.invented")).toThrow(/no audio asset/u);
    expect(v4AudioOrNull("sfx.invented")).toBeNull();
  });

  it("carries the mix contract the audio layer needs", () => {
    expect(V4_SHARED_ASSETS.audioMix.headroomDb).toBe(audioManifest.mixContract.headroomDb);
    expect(V4_SHARED_ASSETS.audioMix.roomCrossfadeMs).toBe(500);
    expect(V4_SHARED_ASSETS.audioMix.gazeLowPassHz).toEqual({open: 20000, clamped: 400});
  });

  it("binds the UI typeface and its license", () => {
    expect(V4_SHARED_ASSETS.fonts.ui.sourcePath).toBe("fonts/NotoSansSC-Variable.ttf");
    expect(V4_SHARED_ASSETS.fonts.ui.url).toContain("NotoSansSC-Variable");
    expect(V4_SHARED_ASSETS.fonts.ui.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(V4_SHARED_ASSETS.fonts.license.sourcePath).toBe("fonts/OFL.txt");
    expect(Object.isFrozen(V4_SHARED_ASSETS.fonts)).toBe(true);
  });

  it("exposes the UI atlas with all 64 cells", () => {
    expect(Object.keys(V4_SHARED_ASSETS.ui.cells)).toHaveLength(64);
    expect(V4_SHARED_ASSETS.ui.atlas.size).toEqual([512, 512]);
  });

  it("freezes the whole catalog", () => {
    expect(Object.isFrozen(V4_SHARED_ASSETS)).toBe(true);
    for (const collection of [
      V4_SHARED_ASSETS.atlases,
      V4_SHARED_ASSETS.frames,
      V4_SHARED_ASSETS.frameOrder,
      V4_SHARED_ASSETS.backgrounds,
      V4_SHARED_ASSETS.reactions,
      V4_SHARED_ASSETS.roomBeds,
      V4_SHARED_ASSETS.bossSignals,
      V4_SHARED_ASSETS.feedbackAudio,
      V4_SHARED_ASSETS.audio,
      V4_SHARED_ASSETS.audioMix,
      V4_SHARED_ASSETS.ui.cells,
    ]) {
      expect(Object.isFrozen(collection)).toBe(true);
    }
  });
});
