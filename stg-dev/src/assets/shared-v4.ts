import assetBindingsManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/integration/asset-bindings-v4.json";
import atlasIndexManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/v4/atlas-index-v4.json";
import frameIndexManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/v4/frame-index-v4.json";
import backgroundsManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/v4/backgrounds-v4.json";
import audioManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/narrative/audio-manifest-v4.json";
import notoSansScUrl from "../../../1bit-stg-complete-asset-kit-v4/fonts/NotoSansSC-Variable.ttf?url";
import notoSansScLicenseUrl from "../../../1bit-stg-complete-asset-kit-v4/fonts/OFL.txt?url";
import {v4UnmanifestedChecksum} from "./kit-checksums-v4";
import {V4_UI_ATLAS} from "./ui-atlas-v4";
import {
  assertV4SchemaVersion,
  bindV4RuntimeAssets,
  type V4RuntimeAsset,
} from "./v4-runtime-asset";

/**
 * Browser URLs for every PRODUCTION binary the V4 kit ships. Each glob is
 * scoped to a production directory so QA/preview material (gameplay/previews,
 * gameplay/animations, ui/mockups, reports, sources, legacy-v3 art) can never
 * enter the runtime graph. `bindV4RuntimeAssets` then closes the set in both
 * directions: a manifest row without a URL and a URL without a manifest row are
 * both fatal.
 */
const KIT_PREFIX = "../../../1bit-stg-complete-asset-kit-v4/";

function kitUrls(
  globbed: Readonly<Record<string, unknown>>,
  catalog: string,
): Readonly<Record<string, string>> {
  const urls: Record<string, string> = {};
  for (const [globPath, url] of Object.entries(globbed)) {
    if (!globPath.startsWith(KIT_PREFIX)) {
      throw new Error(`${catalog} resolved a URL outside the V4 kit: ${globPath}`);
    }
    if (typeof url !== "string" || url.length === 0) {
      throw new Error(`${catalog} resolved an invalid URL for ${globPath}`);
    }
    urls[globPath.slice(KIT_PREFIX.length)] = url;
  }
  return Object.freeze(urls);
}

const atlasUrlsBySourcePath = kitUrls(
  import.meta.glob("../../../1bit-stg-complete-asset-kit-v4/atlases/*.png", {
    query: "?url",
    import: "default",
    eager: true,
  }),
  "V4 atlas runtime registry",
);

const backgroundUrlsBySourcePath = kitUrls(
  import.meta.glob("../../../1bit-stg-complete-asset-kit-v4/backgrounds/composites/*.png", {
    query: "?url",
    import: "default",
    eager: true,
  }),
  "V4 background runtime registry",
);

const reactionUrlsBySourcePath = kitUrls(
  import.meta.glob("../../../1bit-stg-complete-asset-kit-v4/backgrounds/reactions/*/*.png", {
    query: "?url",
    import: "default",
    eager: true,
  }),
  "V4 reaction overlay runtime registry",
);

const audioUrlsBySourcePath = kitUrls(
  import.meta.glob("../../../1bit-stg-complete-asset-kit-v4/audio/assets/**/*.wav", {
    query: "?url",
    import: "default",
    eager: true,
  }),
  "V4 audio runtime registry",
);

assertV4SchemaVersion("V4 atlas index", atlasIndexManifest.schemaVersion, "4.0.0");
assertV4SchemaVersion("V4 frame index", frameIndexManifest.schemaVersion, "4.0.0");
assertV4SchemaVersion("V4 backgrounds", backgroundsManifest.schemaVersion, "4.0.0-backgrounds");
assertV4SchemaVersion("V4 audio", audioManifest.schemaVersion, "4.0.0-audio");
assertV4SchemaVersion(
  "V4 asset bindings",
  assetBindingsManifest.schemaVersion,
  "4.0.0-asset-bindings",
);

function manifestSize(catalog: string, id: string, size: readonly number[]): readonly [number, number] {
  const [width, height] = size;
  if (width === undefined || height === undefined || size.length !== 2) {
    throw new Error(`${catalog} ${id} requires an exact width/height pair`);
  }
  return [width, height];
}

// ---------------------------------------------------------------------------
// Room identity. Manifests disagree by design: run-director/composers/asset
// bindings use FORCED_ALIGNMENT while backgrounds/frame-index use
// forced_choice. selectors.roomSlug is the only authority for that mapping.
// ---------------------------------------------------------------------------

const roomSlugSelector = assetBindingsManifest.selectors.roomSlug as Readonly<Record<string, string>>;
const V4_ROOM_IDS = Object.freeze(Object.keys(roomSlugSelector));
const roomIdBySlug: Record<string, string> = {};
for (const roomId of V4_ROOM_IDS) {
  const slug = roomSlugSelector[roomId];
  if (typeof slug !== "string" || slug.length === 0 || Object.hasOwn(roomIdBySlug, slug)) {
    throw new Error(`V4 room slug selector drifted at ${roomId}`);
  }
  roomIdBySlug[slug] = roomId;
}

/**
 * frame-index-v4.json spells its room column as the UPPERCASED slug
 * (FORCED_CHOICE), a third spelling next to the canonical room id
 * (FORCED_ALIGNMENT) and the background/audio slug (forced_choice). Everything
 * still resolves through selectors.roomSlug; nothing is slugified naively.
 */
const roomIdByFrameIndexRoom: Record<string, string> = {};
for (const [slug, roomId] of Object.entries(roomIdBySlug)) {
  roomIdByFrameIndexRoom[roomId] = roomId;
  roomIdByFrameIndexRoom[slug.toUpperCase()] = roomId;
}

export function v4RoomSlug(roomId: string): string {
  const slug = roomSlugSelector[roomId];
  if (slug === undefined) throw new Error(`V4 has no room slug for ${roomId}`);
  return slug;
}

function roomIdForSlug(slug: string, catalog: string): string {
  const roomId = roomIdBySlug[slug];
  if (roomId === undefined) throw new Error(`${catalog} references unknown room slug ${slug}`);
  return roomId;
}

// ---------------------------------------------------------------------------
// Atlases and the full 448-frame index.
// ---------------------------------------------------------------------------

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

interface V4FrameManifestEntry {
  readonly id: string;
  readonly semanticId: string;
  readonly atlas: string;
  readonly frameIndex: number;
  readonly index: number;
  readonly row: number;
  readonly column: number;
  readonly rect: readonly number[];
  readonly pivot: readonly number[];
  readonly kind: string;
  readonly room: string;
  readonly paletteRole: string;
  readonly logicalSize: number;
  readonly alphaMode: string;
  readonly durationMs?: number;
  readonly collisionClass?: string;
  readonly threatRole?: string;
  readonly safeMarginPx?: number;
}

/**
 * One addressable V4 frame. `atlasUrl` is carried alongside `atlasId` so a
 * renderer never has to re-resolve the atlas to draw a frame.
 */
export interface V4FrameBinding {
  readonly semanticId: string;
  readonly atlasId: string;
  readonly atlasUrl: string;
  readonly index: number;
  readonly frameIndex: number;
  readonly row: number;
  readonly column: number;
  /** [x, y, width, height] in top-left-origin atlas pixels. */
  readonly rect: readonly [number, number, number, number];
  readonly pivot: readonly [number, number];
  readonly logicalSize: number;
  readonly kind: string;
  /** Canonical room id, or "ANY" for room-agnostic frames. */
  readonly room: string;
  readonly paletteRole: string;
  readonly alphaMode: string;
  readonly durationMs: number | null;
  readonly collisionClass: string | null;
  readonly threatRole: string | null;
  readonly safeMarginPx: number | null;
}

const frameEntries = frameIndexManifest.frames as unknown as readonly V4FrameManifestEntry[];
const frameOrder: string[] = [];
const frames: Record<string, Readonly<V4FrameBinding>> = {};

for (const entry of frameEntries) {
  const atlas = atlases[entry.atlas];
  if (atlas === undefined) {
    throw new Error(`V4 frame ${entry.semanticId} references an unavailable atlas ${entry.atlas}`);
  }
  if (entry.id !== entry.semanticId) {
    throw new Error(`V4 frame ${entry.semanticId} has a divergent physical id`);
  }
  if (Object.hasOwn(frames, entry.semanticId)) {
    throw new Error(`V4 frame index contains duplicate semantic id ${entry.semanticId}`);
  }
  const [x, y, width, height] = entry.rect;
  const [pivotX, pivotY] = entry.pivot;
  if (
    entry.rect.length !== 4
    || x === undefined || y === undefined || width === undefined || height === undefined
    || !Number.isInteger(x) || !Number.isInteger(y)
    || !Number.isInteger(width) || width <= 0
    || !Number.isInteger(height) || height <= 0
    || entry.pivot.length !== 2 || pivotX === undefined || pivotY === undefined
    || !Number.isFinite(pivotX) || !Number.isFinite(pivotY)
  ) {
    throw new Error(`V4 frame ${entry.semanticId} has an invalid rect or pivot`);
  }
  const room = entry.room === "ANY" ? "ANY" : roomIdByFrameIndexRoom[entry.room];
  if (room === undefined) {
    throw new Error(`V4 frame ${entry.semanticId} references unknown room ${entry.room}`);
  }
  frames[entry.semanticId] = Object.freeze({
    semanticId: entry.semanticId,
    atlasId: entry.atlas,
    atlasUrl: atlas.url,
    index: entry.index,
    frameIndex: entry.frameIndex,
    row: entry.row,
    column: entry.column,
    rect: Object.freeze([x, y, width, height] as const),
    pivot: Object.freeze([pivotX, pivotY] as const),
    logicalSize: entry.logicalSize,
    kind: entry.kind,
    room,
    paletteRole: entry.paletteRole,
    alphaMode: entry.alphaMode,
    durationMs: entry.durationMs ?? null,
    collisionClass: entry.collisionClass ?? null,
    threatRole: entry.threatRole ?? null,
    safeMarginPx: entry.safeMarginPx ?? null,
  });
  frameOrder.push(entry.semanticId);
}
if (frameOrder.length !== frameIndexManifest.frameCount) {
  throw new Error("V4 frame index count drifted");
}

// ---------------------------------------------------------------------------
// Backgrounds: 4 base composites plus 16 reaction overlays.
// ---------------------------------------------------------------------------

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

const V4_REACTION_STATES = Object.freeze(
  backgroundsManifest.reactionStates as readonly string[],
);

export type V4ReactionState = (typeof V4_REACTION_STATES)[number];

/** A reaction overlay is a visual subscriber only: it never carries collision. */
export interface V4ReactionOverlay extends V4RuntimeAsset {
  readonly room: string;
  readonly state: string;
  readonly visiblePixels: number;
}

const reactionBase = bindV4RuntimeAssets({
  catalog: "V4 reaction overlay runtime registry",
  entries: backgroundsManifest.reactionOverlays,
  urlsBySourcePath: reactionUrlsBySourcePath,
  keyOf: (entry) => entry.id,
  idOf: (entry) => entry.id,
  sourcePathOf: (entry) => entry.file,
  sha256Of: (entry) => entry.sha256,
  sizeOf: (entry) => manifestSize("V4 reaction overlay", entry.id, entry.size),
});

const reactionsByRoom: Record<string, Record<string, Readonly<V4ReactionOverlay>>> = {};
for (const entry of backgroundsManifest.reactionOverlays) {
  const asset = reactionBase[entry.id];
  if (asset === undefined) throw new Error(`V4 reaction overlay ${entry.id} lost its binding`);
  if (entry.collision !== false || entry.authority !== "visual-subscriber") {
    throw new Error(`V4 reaction overlay ${entry.id} claims gameplay authority`);
  }
  if (!V4_REACTION_STATES.includes(entry.state)) {
    throw new Error(`V4 reaction overlay ${entry.id} uses unauthored state ${entry.state}`);
  }
  if (!Number.isInteger(entry.visiblePixels) || entry.visiblePixels <= 0) {
    throw new Error(`V4 reaction overlay ${entry.id} has an invalid visible pixel count`);
  }
  const roomId = roomIdForSlug(entry.room, "V4 reaction overlay registry");
  const perRoom = reactionsByRoom[roomId] ?? (reactionsByRoom[roomId] = {});
  if (Object.hasOwn(perRoom, entry.state)) {
    throw new Error(`V4 reaction overlays duplicate ${roomId} ${entry.state}`);
  }
  perRoom[entry.state] = Object.freeze({
    ...asset,
    room: roomId,
    state: entry.state,
    visiblePixels: entry.visiblePixels,
  });
}
for (const roomId of V4_ROOM_IDS) {
  const perRoom = reactionsByRoom[roomId];
  if (perRoom === undefined || Object.keys(perRoom).length !== V4_REACTION_STATES.length) {
    throw new Error(`V4 reaction overlays are incomplete for ${roomId}`);
  }
  if (backgrounds[roomId] === undefined) {
    throw new Error(`V4 background composite is missing for ${roomId}`);
  }
  reactionsByRoom[roomId] = Object.freeze(perRoom);
}
const reactions = Object.freeze(reactionsByRoom);

// ---------------------------------------------------------------------------
// Audio: all 48 authored assets with their mix metadata.
// ---------------------------------------------------------------------------

const mixContract = audioManifest.mixContract;
const V4_AUDIO_BUSES = Object.freeze(mixContract.buses as readonly string[]);
const EXPECTED_BUSES = ["room", "boss", "events", "weather", "ui"] as const;
if (
  V4_AUDIO_BUSES.length !== EXPECTED_BUSES.length
  || EXPECTED_BUSES.some((bus, index) => V4_AUDIO_BUSES[index] !== bus)
) {
  throw new Error("V4 audio mix bus contract drifted");
}

export type V4AudioBus = (typeof EXPECTED_BUSES)[number];
export type V4AudioCategory = "room-bed" | "boss-signal" | "sfx";

export interface V4AudioAsset extends V4RuntimeAsset {
  readonly category: V4AudioCategory;
  /**
   * Mix bus, projected from the authored category and the authored weather
   * slug universe: room-bed -> room, boss-signal -> boss, sfx.weather_<slug>
   * -> weather (one per selectors.weatherSlug entry), every other sfx ->
   * events. The `ui` bus carries no authored audio asset: UI cue resolvers
   * resolve to localized copy and HUD state, never to a sound. That silence is
   * authored, so no substitute is invented for it.
   */
  readonly bus: V4AudioBus;
  readonly loop: boolean;
  readonly loopCrossfadeMs: number;
  readonly durationMs: number;
  readonly sampleRate: number;
  readonly channels: number;
  readonly bitDepth: number;
  readonly peak: number;
  readonly rms: number;
  readonly bytes: number;
  /** Canonical room id for room beds, otherwise null. */
  readonly room: string | null;
  /** Boss slug (no `boss.` prefix) for boss signals, otherwise null. */
  readonly bossId: string | null;
}

interface V4AudioManifestEntry {
  readonly id: string;
  readonly category: string;
  readonly path: string;
  readonly sha256: string;
  readonly loop: boolean;
  readonly loopCrossfadeMs?: number;
  readonly durationMs: number;
  readonly sampleRate: number;
  readonly channels: number;
  readonly bitDepth: number;
  readonly peak: number;
  readonly rms: number;
  readonly bytes: number;
  readonly room?: string;
  readonly bossId?: string;
}

const weatherSlugSelector = assetBindingsManifest.selectors.weatherSlug as Readonly<
  Record<string, string>
>;
const weatherAudioIds = new Set(
  Object.values(weatherSlugSelector).map((slug) => `sfx.weather_${slug}`),
);

const audioEntries = audioManifest.assets as unknown as readonly V4AudioManifestEntry[];

function audioBus(entry: V4AudioManifestEntry): V4AudioBus {
  if (entry.category === "room-bed") return "room";
  if (entry.category === "boss-signal") return "boss";
  if (entry.category === "sfx") return weatherAudioIds.has(entry.id) ? "weather" : "events";
  throw new Error(`V4 audio ${entry.id} has unauthored category ${entry.category}`);
}

const audioBase = bindV4RuntimeAssets({
  catalog: "V4 audio runtime registry",
  entries: audioEntries,
  urlsBySourcePath: audioUrlsBySourcePath,
  keyOf: (entry) => entry.id,
  idOf: (entry) => entry.id,
  sourcePathOf: (entry) => entry.path,
  sha256Of: (entry) => entry.sha256,
});

const audio: Record<string, Readonly<V4AudioAsset>> = {};
const roomBeds: Record<string, Readonly<V4AudioAsset>> = {};
const bossSignals: Record<string, Readonly<V4AudioAsset>> = {};
const feedbackAudio: Record<string, Readonly<V4AudioAsset>> = {};

for (const entry of audioEntries) {
  const base = audioBase[entry.id];
  if (base === undefined) throw new Error(`V4 audio ${entry.id} lost its binding`);
  for (const [field, value] of [
    ["durationMs", entry.durationMs],
    ["sampleRate", entry.sampleRate],
    ["channels", entry.channels],
    ["bitDepth", entry.bitDepth],
    ["bytes", entry.bytes],
  ] as const) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`V4 audio ${entry.id} has an invalid ${field}`);
    }
  }
  if (
    typeof entry.loop !== "boolean"
    || !Number.isFinite(entry.peak) || entry.peak <= 0 || entry.peak > 1
    || !Number.isFinite(entry.rms) || entry.rms <= 0 || entry.rms > 1
  ) {
    throw new Error(`V4 audio ${entry.id} has invalid level metadata`);
  }
  const category = entry.category as V4AudioCategory;
  const bus = audioBus(entry);
  const asset: Readonly<V4AudioAsset> = Object.freeze({
    ...base,
    category,
    bus,
    loop: entry.loop,
    loopCrossfadeMs: entry.loopCrossfadeMs ?? 0,
    durationMs: entry.durationMs,
    sampleRate: entry.sampleRate,
    channels: entry.channels,
    bitDepth: entry.bitDepth,
    peak: entry.peak,
    rms: entry.rms,
    bytes: entry.bytes,
    room: entry.room ?? null,
    bossId: entry.bossId ?? null,
  });
  audio[entry.id] = asset;

  if (category === "room-bed") {
    if (asset.room === null || !Object.hasOwn(roomSlugSelector, asset.room)) {
      throw new Error(`V4 room bed ${entry.id} references unknown room ${String(asset.room)}`);
    }
    if (!asset.loop) throw new Error(`V4 room bed ${entry.id} must loop`);
    if (Object.hasOwn(roomBeds, asset.room)) {
      throw new Error(`V4 room beds duplicate ${asset.room}`);
    }
    roomBeds[asset.room] = asset;
  } else if (category === "boss-signal") {
    if (asset.bossId === null || asset.bossId.startsWith("boss.")) {
      throw new Error(`V4 boss signal ${entry.id} has an invalid boss slug`);
    }
    if (Object.hasOwn(bossSignals, asset.bossId)) {
      throw new Error(`V4 boss signals duplicate ${asset.bossId}`);
    }
    bossSignals[asset.bossId] = asset;
  } else {
    feedbackAudio[entry.id] = asset;
  }
}

if (Object.keys(roomBeds).length !== V4_ROOM_IDS.length) {
  throw new Error("V4 room beds are incomplete");
}
if (Object.keys(audio).length !== audioEntries.length) {
  throw new Error("V4 audio registry count drifted");
}
for (const audioId of weatherAudioIds) {
  const asset = audio[audioId];
  if (asset === undefined || asset.bus !== "weather") {
    throw new Error(`V4 weather audio is missing for ${audioId}`);
  }
}

// ---------------------------------------------------------------------------
// Fonts. The kit ships no JSON manifest row for these; identity is pinned from
// checksums-sha256.txt (see kit-checksums-v4.ts).
// ---------------------------------------------------------------------------

const fonts = Object.freeze({
  ui: Object.freeze({
    id: "NotoSansSC-Variable",
    sourcePath: "fonts/NotoSansSC-Variable.ttf",
    sha256: v4UnmanifestedChecksum("fonts/NotoSansSC-Variable.ttf"),
    url: notoSansScUrl,
    size: null,
  } satisfies V4RuntimeAsset),
  license: Object.freeze({
    id: "NotoSansSC-OFL",
    sourcePath: "fonts/OFL.txt",
    sha256: v4UnmanifestedChecksum("fonts/OFL.txt"),
    url: notoSansScLicenseUrl,
    size: null,
  } satisfies V4RuntimeAsset),
});

/** Shared, passive media catalog. It owns URLs but no gameplay authority. */
export const V4_SHARED_ASSETS = Object.freeze({
  /** 7 atlases keyed by atlas id. */
  atlases,
  /** All 448 frames keyed by semantic id. */
  frames: Object.freeze(frames),
  /** The 448 semantic ids in authored manifest order. */
  frameOrder: Object.freeze(frameOrder),
  /** 4 base room composites keyed by canonical room id. */
  backgrounds,
  /** 16 reaction overlays: room id -> reaction state -> overlay. */
  reactions,
  /** The 4 authored reaction states. */
  reactionStates: V4_REACTION_STATES,
  /** 4 looping room beds keyed by canonical room id. */
  roomBeds: Object.freeze(roomBeds),
  /** 8 boss signals keyed by boss slug (no `boss.` prefix). */
  bossSignals: Object.freeze(bossSignals),
  /** The 36 sfx keyed by audio id. */
  feedbackAudio: Object.freeze(feedbackAudio),
  /** All 48 audio assets keyed by audio id. */
  audio: Object.freeze(audio),
  /** Authored mix contract: headroom, room crossfade, gaze low-pass, buses. */
  audioMix: Object.freeze({
    headroomDb: mixContract.headroomDb,
    roomCrossfadeMs: mixContract.roomCrossfadeMs,
    gazeLowPassHz: Object.freeze({
      open: mixContract.gazeLowPassHz.open,
      clamped: mixContract.gazeLowPassHz.clamped,
    }),
    buses: V4_AUDIO_BUSES,
  }),
  /** UI atlas plus its 64 cells. */
  ui: V4_UI_ATLAS,
  /** UI typeface and its license. */
  fonts,
  /** The 4 canonical room ids, in selector order. */
  roomIds: V4_ROOM_IDS,
});

export function v4Atlas(atlasId: string): Readonly<V4RuntimeAsset> {
  const atlas = atlases[atlasId];
  if (atlas === undefined) throw new Error(`V4 has no atlas ${atlasId}`);
  return atlas;
}

export function v4Frame(semanticId: string): Readonly<V4FrameBinding> {
  const frame = frames[semanticId];
  if (frame === undefined) throw new Error(`V4 has no frame ${semanticId}`);
  return frame;
}

export function v4FrameOrNull(semanticId: string): Readonly<V4FrameBinding> | null {
  return frames[semanticId] ?? null;
}

export function v4RoomBackground(roomId: string): Readonly<V4RuntimeAsset> {
  const background = backgrounds[roomId];
  if (background === undefined) throw new Error(`V4 has no room background for ${roomId}`);
  return background;
}

export function v4RoomReaction(roomId: string, state: string): Readonly<V4ReactionOverlay> {
  const overlay = reactions[roomId]?.[state];
  if (overlay === undefined) {
    throw new Error(`V4 has no ${state} reaction overlay for ${roomId}`);
  }
  return overlay;
}

/** A room/state pair with no authored overlay draws nothing. */
export function v4RoomReactionOrNull(
  roomId: string,
  state: string,
): Readonly<V4ReactionOverlay> | null {
  return reactions[roomId]?.[state] ?? null;
}

export function v4RoomBed(roomId: string): Readonly<V4AudioAsset> {
  const bed = roomBeds[roomId];
  if (bed === undefined) throw new Error(`V4 has no room bed for ${roomId}`);
  return bed;
}

/** Accepts the gameplay rig id with or without its authored `boss.` prefix. */
export function v4BossSignal(bossCanonicalId: string): Readonly<V4AudioAsset> {
  const slug = bossCanonicalId.startsWith("boss.")
    ? bossCanonicalId.slice("boss.".length)
    : bossCanonicalId;
  const signal = bossSignals[slug];
  if (signal === undefined) throw new Error(`V4 has no boss signal for ${bossCanonicalId}`);
  return signal;
}

export function v4Audio(audioId: string): Readonly<V4AudioAsset> {
  const asset = audio[audioId];
  if (asset === undefined) throw new Error(`V4 has no audio asset ${audioId}`);
  return asset;
}

/** A cue with no authored audio is intentional silence, never a substitute. */
export function v4AudioOrNull(audioId: string): Readonly<V4AudioAsset> | null {
  return audio[audioId] ?? null;
}

export {v4UiCell, v4UiCellOrNull} from "./ui-atlas-v4";
export type {V4UiCell, V4UiCellCategory} from "./ui-atlas-v4";
