import uiLayoutsManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/narrative/ui-layouts-v4.json";
import uiCopyManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/narrative/ui-copy-v4.json";
import type {ConductorSnapshot} from "../authority/conductor";
import type {FinalizedRunMemory, ResolutionReason} from "../authority/run-memory-model";

/*
 * ============================================================================
 * HUD / RUN-SCREEN PROJECTION (rebuild slice S3)
 * ============================================================================
 * This module is a PURE PROJECTION of a frozen ConductorSnapshot plus
 * presentation-local observation state. It has no command port: nothing here
 * can write gameplay, and no gameplay fact may ever be derived from a DOM
 * read, a transition end, or an element's measured size.
 *
 * Every rect, bind path, visibility expression, prompt guard and copy string
 * comes from the two authored manifests below. Nothing is invented here:
 *   - manifests/narrative/ui-layouts-v4.json  (rects + bind expressions)
 *   - manifests/narrative/ui-copy-v4.json     (bilingual copy)
 * An unknown bind path, visibility expression or copy key FAILS CLOSED. A bind
 * whose authority fact does not exist yet resolves to an explicit `absent`
 * value — authored silence, never a generic substitute string.
 * ============================================================================
 */

export interface LocalizedText {
  readonly zhCN: string;
  readonly en: string;
}

export type UiLocale = "zh-CN" | "en";

// ---------------------------------------------------------------------------
// Manifest ingestion (fail-closed at module scope)
// ---------------------------------------------------------------------------

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, path: string): string | null {
  if (value === undefined || value === null) return null;
  return requireString(value, path);
}

function requireInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${path} must be an integer`);
  }
  return value;
}

export type UiRect = readonly [number, number, number, number];

export interface UiSafeArea {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface UiLayoutCommon {
  readonly logicalCanvas: readonly [number, number];
  readonly safeArea: UiSafeArea;
  readonly pixelScale: "integer-only";
  readonly typeface: string;
  readonly dataAuthority: string;
  readonly forbiddenSemantics: readonly string[];
}

export interface UiLayoutLayer {
  readonly id: string;
  readonly rect: UiRect | null;
  readonly bind: string;
  readonly labelCopy: string | null;
  readonly semantic: string | null;
  readonly orientation: string | null;
  readonly visibility: string | null;
  readonly format: string | null;
  readonly maximumLines: number | null;
  readonly interaction: string | null;
  readonly groups: readonly string[] | null;
}

export interface UiLayoutScreen {
  readonly id: string;
  /**
   * The authored `renameSemantic`, when the manifest renames the screen. The
   * `failure` key is authored as `run_interruption`: a route interruption, not
   * a judgement, and the interface must speak the renamed semantic.
   */
  readonly semanticId: string;
  readonly layers: readonly UiLayoutLayer[];
  readonly actions: readonly string[];
}

export interface UiDiscoveryPrompt {
  readonly id: string;
  readonly guard: string;
  readonly copyKey: string | null;
  readonly visual: string | null;
  readonly surface: string | null;
  readonly dismiss: string;
}

const layoutsRoot = requireRecord(uiLayoutsManifest, "ui-layouts-v4");

export const UI_LAYOUT_SCHEMA_VERSION = requireString(
  layoutsRoot.schemaVersion,
  "ui-layouts-v4.schemaVersion",
);
if (UI_LAYOUT_SCHEMA_VERSION !== "4.0.0-ui-layout") {
  throw new Error("ui-layouts-v4 schemaVersion is unsupported");
}

function parseCommon(value: unknown): UiLayoutCommon {
  const record = requireRecord(value, "ui-layouts-v4.common");
  const canvas = record.logicalCanvas;
  if (!Array.isArray(canvas) || canvas.length !== 2) {
    throw new Error("ui-layouts-v4.common.logicalCanvas must be [w, h]");
  }
  const safe = requireRecord(record.safeArea, "ui-layouts-v4.common.safeArea");
  const pixelScale = requireString(record.pixelScale, "ui-layouts-v4.common.pixelScale");
  if (pixelScale !== "integer-only") {
    throw new Error("ui-layouts-v4.common.pixelScale must be integer-only");
  }
  const forbidden = record.forbiddenSemantics;
  if (!Array.isArray(forbidden) || forbidden.length === 0) {
    throw new Error("ui-layouts-v4.common.forbiddenSemantics must be a non-empty array");
  }
  return Object.freeze({
    logicalCanvas: Object.freeze([
      requireInteger(canvas[0], "ui-layouts-v4.common.logicalCanvas[0]"),
      requireInteger(canvas[1], "ui-layouts-v4.common.logicalCanvas[1]"),
    ] as const),
    safeArea: Object.freeze({
      x: requireInteger(safe.x, "ui-layouts-v4.common.safeArea.x"),
      y: requireInteger(safe.y, "ui-layouts-v4.common.safeArea.y"),
      w: requireInteger(safe.w, "ui-layouts-v4.common.safeArea.w"),
      h: requireInteger(safe.h, "ui-layouts-v4.common.safeArea.h"),
    }),
    pixelScale: "integer-only",
    typeface: requireString(record.typeface, "ui-layouts-v4.common.typeface"),
    dataAuthority: requireString(record.dataAuthority, "ui-layouts-v4.common.dataAuthority"),
    forbiddenSemantics: Object.freeze(
      forbidden.map((entry, index) =>
        requireString(entry, `ui-layouts-v4.common.forbiddenSemantics[${index}]`),
      ),
    ),
  });
}

export const UI_LAYOUT_COMMON: UiLayoutCommon = parseCommon(layoutsRoot.common);

function parseRect(value: unknown, path: string): UiRect | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length !== 4) {
    throw new Error(`${path} must be [x, y, w, h]`);
  }
  return Object.freeze([
    requireInteger(value[0], `${path}[0]`),
    requireInteger(value[1], `${path}[1]`),
    requireInteger(value[2], `${path}[2]`),
    requireInteger(value[3], `${path}[3]`),
  ] as const);
}

function parseLayer(value: unknown, path: string): UiLayoutLayer {
  const record = requireRecord(value, path);
  const groups = record.groups;
  return Object.freeze({
    id: requireString(record.id, `${path}.id`),
    rect: parseRect(record.rect, `${path}.rect`),
    bind: requireString(record.bind, `${path}.bind`),
    labelCopy: optionalString(record.labelCopy, `${path}.labelCopy`),
    semantic: optionalString(record.semantic, `${path}.semantic`),
    orientation: optionalString(record.orientation, `${path}.orientation`),
    visibility: optionalString(record.visibility, `${path}.visibility`),
    format: optionalString(record.format, `${path}.format`),
    maximumLines:
      record.maximumLines === undefined
        ? null
        : requireInteger(record.maximumLines, `${path}.maximumLines`),
    interaction: optionalString(record.interaction, `${path}.interaction`),
    groups: Array.isArray(groups)
      ? Object.freeze(groups.map((entry, index) => requireString(entry, `${path}.groups[${index}]`)))
      : null,
  });
}

function parseScreens(value: unknown): Readonly<Record<string, UiLayoutScreen>> {
  const record = requireRecord(value, "ui-layouts-v4.screens");
  const screens: Record<string, UiLayoutScreen> = {};
  for (const [screenId, rawScreen] of Object.entries(record)) {
    const screenPath = `ui-layouts-v4.screens.${screenId}`;
    const screen = requireRecord(rawScreen, screenPath);
    const rawLayers = screen.layers;
    const layers = Array.isArray(rawLayers)
      ? rawLayers.map((layer, index) => parseLayer(layer, `${screenPath}.layers[${index}]`))
      : [];
    const rawActions = screen.actions;
    const actions = Array.isArray(rawActions)
      ? rawActions.map((action, index) => requireString(action, `${screenPath}.actions[${index}]`))
      : [];
    screens[screenId] = Object.freeze({
      id: screenId,
      semanticId: optionalString(screen.renameSemantic, `${screenPath}.renameSemantic`) ?? screenId,
      layers: Object.freeze(layers),
      actions: Object.freeze(actions),
    });
  }
  return Object.freeze(screens);
}

export const UI_LAYOUT_SCREENS = parseScreens(layoutsRoot.screens);

function parsePrompts(value: unknown): readonly UiDiscoveryPrompt[] {
  const screen = requireRecord(value, "ui-layouts-v4.screens.discovery_prompts");
  const raw = screen.prompts;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("ui-layouts-v4.screens.discovery_prompts.prompts must be a non-empty array");
  }
  return Object.freeze(
    raw.map((entry, index) => {
      const path = `ui-layouts-v4.screens.discovery_prompts.prompts[${index}]`;
      const record = requireRecord(entry, path);
      return Object.freeze({
        id: requireString(record.id, `${path}.id`),
        guard: requireString(record.guard, `${path}.guard`),
        copyKey: optionalString(record.copy, `${path}.copy`),
        visual: optionalString(record.visual, `${path}.visual`),
        surface: optionalString(record.surface, `${path}.surface`),
        dismiss: requireString(record.dismiss, `${path}.dismiss`),
      });
    }),
  );
}

export const UI_DISCOVERY_PROMPTS = parsePrompts(
  requireRecord(layoutsRoot.screens, "ui-layouts-v4.screens").discovery_prompts,
);

export interface UiCrossRunTransitionStep {
  readonly atGameplayMs: number | string;
  readonly event: string;
}

function parseCrossRunTimeline(value: unknown): readonly UiCrossRunTransitionStep[] {
  const screen = requireRecord(value, "ui-layouts-v4.screens.cross_run_transition");
  const raw = screen.authoritativeTimeline;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("cross_run_transition.authoritativeTimeline must be a non-empty array");
  }
  return Object.freeze(
    raw.map((entry, index) => {
      const path = `cross_run_transition.authoritativeTimeline[${index}]`;
      const record = requireRecord(entry, path);
      const at = record.atGameplayMs;
      if (typeof at !== "number" && typeof at !== "string") {
        throw new Error(`${path}.atGameplayMs must be a number or an authored expression`);
      }
      return Object.freeze({
        atGameplayMs: at,
        event: requireString(record.event, `${path}.event`),
      });
    }),
  );
}

export const UI_CROSS_RUN_TRANSITION_TIMELINE = parseCrossRunTimeline(
  requireRecord(layoutsRoot.screens, "ui-layouts-v4.screens").cross_run_transition,
);

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

const copyRoot = requireRecord(uiCopyManifest, "ui-copy-v4");
if (requireString(copyRoot.schemaVersion, "ui-copy-v4.schemaVersion") !== "4.0.0-ui-copy") {
  throw new Error("ui-copy-v4 schemaVersion is unsupported");
}

function parseCopy(value: unknown): Readonly<Record<string, LocalizedText>> {
  const record = requireRecord(value, "ui-copy-v4.copy");
  const copy: Record<string, LocalizedText> = {};
  for (const [key, entry] of Object.entries(record)) {
    const path = `ui-copy-v4.copy.${key}`;
    const localized = requireRecord(entry, path);
    copy[key] = Object.freeze({
      zhCN: requireString(localized["zh-CN"], `${path}["zh-CN"]`),
      en: requireString(localized.en, `${path}.en`),
    });
  }
  if (Object.keys(copy).length === 0) throw new Error("ui-copy-v4.copy is empty");
  return Object.freeze(copy);
}

const UI_COPY = parseCopy(copyRoot.copy);

export const UI_COPY_KEYS: readonly string[] = Object.freeze(Object.keys(UI_COPY));

/** The manifest's own case-insensitive banned vocabulary. Enforced by test. */
export const UI_FORBIDDEN_TOKENS: readonly string[] = Object.freeze(
  (() => {
    const raw = copyRoot.forbiddenTokensCaseInsensitive;
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error("ui-copy-v4.forbiddenTokensCaseInsensitive must be a non-empty array");
    }
    return raw.map((entry, index) =>
      requireString(entry, `ui-copy-v4.forbiddenTokensCaseInsensitive[${index}]`),
    );
  })(),
);

/** Fail-closed copy lookup: an unauthored key is a defect, never a blank. */
export function uiCopy(key: string): LocalizedText {
  const entry = UI_COPY[key];
  if (entry === undefined) throw new Error(`ui-copy-v4 does not author the key ${key}`);
  return entry;
}

/** Authored-silence form: a key that the manifest deliberately omits. */
export function uiCopyOrNull(key: string): LocalizedText | null {
  return UI_COPY[key] ?? null;
}

export function localize(text: LocalizedText, locale: UiLocale): string {
  return locale === "zh-CN" ? text.zhCN : text.en;
}

/**
 * Copy for the authored screen actions. `title` returns to a run carrying no
 * retained matter, which is exactly what `continue.withoutMemory` states, so
 * the authored sentence is reused rather than a new one written. `exportPng`
 * has no authored sentence at all: the control carries its own action token
 * in the shell's machine register, and no substitute copy is invented for it.
 */
const UI_ACTION_COPY_KEYS: Readonly<Record<string, string | null>> = Object.freeze({
  continueWithMemory: "continue.withMemory",
  newRunWithoutMemory: "continue.withoutMemory",
  title: "continue.withoutMemory",
  openSnapshot: "snapshot.title",
  exportPng: null,
});

export const UI_ACTION_IDS: readonly string[] = Object.freeze(Object.keys(UI_ACTION_COPY_KEYS));

/** Fail-closed on an unauthored action; null means authored silence. */
export function uiActionCopy(action: string): LocalizedText | null {
  if (!(action in UI_ACTION_COPY_KEYS)) {
    throw new Error(`ui-layouts-v4 does not author the action ${action}`);
  }
  const key = UI_ACTION_COPY_KEYS[action] ?? null;
  return key === null ? null : uiCopy(key);
}

// ---------------------------------------------------------------------------
// Integer-only pixel scale
// ---------------------------------------------------------------------------

/**
 * The authored canvas is 360x640 logical pixels and the manifest declares
 * integer-only scaling: the stage is always an exact integer multiple, so a
 * logical pixel never lands on a fractional device boundary.
 */
export function integerPixelScale(availableWidthPx: number, availableHeightPx: number): number {
  const [logicalWidth, logicalHeight] = UI_LAYOUT_COMMON.logicalCanvas;
  if (!Number.isFinite(availableWidthPx) || !Number.isFinite(availableHeightPx)) {
    throw new Error("integer pixel scale requires finite available dimensions");
  }
  const fit = Math.min(availableWidthPx / logicalWidth, availableHeightPx / logicalHeight);
  const scaled = Math.floor(fit);
  return scaled >= 1 ? scaled : 1;
}

export interface HudLayerBox {
  readonly leftPx: number;
  readonly topPx: number;
  readonly widthPx: number;
  readonly heightPx: number;
}

/** Logical rect -> device rect at an integer scale. Never produces fractions. */
export function scaleLayerRect(rect: UiRect, scale: number): HudLayerBox {
  if (!Number.isInteger(scale) || scale < 1) {
    throw new Error("layer rects may only be scaled by a positive integer");
  }
  return Object.freeze({
    leftPx: rect[0] * scale,
    topPx: rect[1] * scale,
    widthPx: rect[2] * scale,
    heightPx: rect[3] * scale,
  });
}

/** True when the authored rect stays inside the authored safe area. */
export function rectWithinSafeArea(rect: UiRect): boolean {
  const {x, y, w, h} = UI_LAYOUT_COMMON.safeArea;
  return rect[0] >= x && rect[1] >= y && rect[0] + rect[2] <= x + w && rect[1] + rect[3] <= y + h;
}

// ---------------------------------------------------------------------------
// Projection source
// ---------------------------------------------------------------------------

/**
 * The gameplay half of the source is exactly the conductor's frozen snapshot.
 * Declaring it as a Pick keeps a real ConductorSnapshot assignable while making
 * it explicit which authority facts the HUD is allowed to read.
 */
export type HudSnapshot = Pick<
  ConductorSnapshot,
  | "tick120"
  | "runPhase"
  | "roomId"
  | "inputPolicy"
  | "runComplete"
  | "hud"
  | "weather"
  | "observations"
  | "runEndReason"
  | "gazeState"
  | "player"
>;

/**
 * Discovery is "has the world already demonstrated this?" — the rule authored
 * on the discovery_prompts screen. These are authority-observed facts handed
 * to the HUD by the caller; the HUD never infers them from its own DOM.
 */
export interface HudDiscoveryFacts {
  readonly signalInputCount: number;
  readonly horizonVisible: boolean;
  readonly gazeThresholdCrossed: boolean;
  readonly tracePanelOpened: boolean;
  readonly hasEncounteredConditionComponent: boolean;
  readonly snapshotOpen: boolean;
}

/** Presentation-only. Toggling any of these must leave the event trace intact. */
export interface HudAccessibilityFacts {
  readonly reducedMotion: boolean;
  readonly flashingOff: boolean;
  readonly audioDescriptions: boolean;
}

/**
 * Boss facts are not produced by the conductor yet (the boss loop is a later
 * slice). Until they are, `boss` stays null and the boss layers resolve to
 * authored absence rather than to placeholder values.
 */
export interface HudBossFacts {
  readonly localizedName: LocalizedText;
  /**
   * Time-or-structure, NEVER life. Either the remaining authored protocol
   * interval, or how many authored phase components have been read.
   */
  readonly protocolRemaining:
    | {readonly kind: "interval"; readonly remainingMs: number; readonly totalMs: number}
    | {readonly kind: "structure"; readonly resolved: number; readonly total: number};
  readonly currentReadingFact: LocalizedText | null;
  readonly discoveredResolutionHint: LocalizedText | null;
}

export interface HudSource {
  readonly snapshot: HudSnapshot;
  readonly discovery: HudDiscoveryFacts;
  readonly accessibility: HudAccessibilityFacts;
  /** The current run's finalized record, once the run has been serialized. */
  readonly finalized: FinalizedRunMemory | null;
  /** The previous run's record, restored at boot; null on a null-route boot. */
  readonly previousRun: FinalizedRunMemory | null;
  readonly boss: HudBossFacts | null;
  /** Expand-only: an observation id enters this set and never leaves it. */
  readonly expandedObservationIds: readonly string[];
}

// ---------------------------------------------------------------------------
// Bind values
// ---------------------------------------------------------------------------

export interface HudTraceEntry {
  readonly observationId: string;
  readonly path: string;
  readonly value: string;
}

export interface HudObservationModel {
  readonly id: string;
  readonly category: string;
  readonly text: LocalizedText;
  readonly traceCount: number;
  readonly expanded: boolean;
}

export interface HudMaterialGroupModel {
  readonly group: string;
  readonly count: number;
  readonly ids: readonly string[];
}

export type HudBindValue =
  /** Continuous authored intensity in [0, 1]. */
  | {readonly kind: "meter"; readonly value: number}
  /** A count of authored facts. Never a currency and never a total. */
  | {readonly kind: "count"; readonly value: number}
  /** A language-neutral authority token (a room id, a resolution reason). */
  | {readonly kind: "token"; readonly value: string}
  /** One authored enum member presented in its own declared order. */
  | {
      readonly kind: "state";
      readonly stateId: string;
      readonly order: number;
      readonly ofOrder: number;
    }
  | {readonly kind: "interval"; readonly remainingMs: number; readonly totalMs: number}
  | {readonly kind: "structure"; readonly resolved: number; readonly total: number}
  | {readonly kind: "text"; readonly text: LocalizedText; readonly copyKey: string | null}
  | {readonly kind: "observations"; readonly items: readonly HudObservationModel[]}
  | {readonly kind: "traces"; readonly items: readonly HudTraceEntry[]}
  | {readonly kind: "material"; readonly groups: readonly HudMaterialGroupModel[]}
  | {
      readonly kind: "materialItem";
      readonly group: string;
      readonly id: string;
      readonly createdAtTick: number;
      readonly detail: string;
    }
  | {
      readonly kind: "fingerprint";
      readonly seed: number;
      readonly digestSha256: string;
      readonly bitDepth: 1;
    }
  /** Authored absence. Presentation shows nothing; it never substitutes. */
  | {readonly kind: "absent"; readonly reason: string};

const ABSENT = (reason: string): HudBindValue => Object.freeze({kind: "absent", reason} as const);

/**
 * The authority's own declared gaze states, in the order the authority
 * declares them. Presentation shows which state is current; it does not order
 * them from worse to better, and it does not invent a magnitude the authority
 * never produced.
 */
export const GAZE_STATE_ORDER = Object.freeze([
  "idle",
  "acquiring",
  "clamped",
  "release-delay",
] as const);

/**
 * Resolution reasons the copy manifest localizes. A reason with no authored
 * sentence stays a bare authority token — the design contract forbids filling
 * an authored gap with a generic line.
 */
const RESOLUTION_COPY_KEYS: Readonly<Partial<Record<ResolutionReason, string>>> = Object.freeze({
  BODY_COLLAPSE: "resolution.bodyCollapse",
  PROTOCOL_WITHDRAWAL: "resolution.protocolWithdrawal",
  READING_FAILED: "resolution.readingFailed",
  STABLE_INTERSECTION: "resolution.stableIntersection",
  NO_DUSK_WITHDRAWAL: "resolution.noDusk",
});

function materialMemoryOf(source: HudSource): FinalizedRunMemory["materialMemory"] | null {
  return source.finalized?.materialMemory ?? source.previousRun?.materialMemory ?? null;
}

function materialGroups(
  memory: FinalizedRunMemory["materialMemory"],
  groups: readonly string[],
): readonly HudMaterialGroupModel[] {
  return Object.freeze(
    groups.map((group) => {
      const entries = (memory as unknown as Record<string, readonly {id: string}[]>)[group];
      if (entries === undefined) {
        throw new Error(`material memory does not carry the authored group ${group}`);
      }
      return Object.freeze({
        group,
        count: entries.length,
        ids: Object.freeze(entries.map((entry) => entry.id)),
      });
    }),
  );
}

function observationModels(source: HudSource, maximumLines: number): readonly HudObservationModel[] {
  const expanded = new Set(source.expandedObservationIds);
  return Object.freeze(
    source.snapshot.observations.slice(0, maximumLines).map((observation) =>
      Object.freeze({
        id: observation.id,
        category: observation.category,
        text: Object.freeze({zhCN: observation.zhCN, en: observation.en}),
        traceCount: observation.trace.length,
        expanded: expanded.has(observation.id),
      }),
    ),
  );
}

function stringifyTraceValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  return JSON.stringify(value) ?? "null";
}

const MATERIAL_GROUPS = Object.freeze([
  "overrideScars",
  "deathTraces",
  "burnIns",
  "ghostResidues",
] as const);

type HudBindResolver = (source: HudSource) => HudBindValue;

/**
 * One resolver per authored bind path. The table is closed: a manifest bind
 * with no resolver, or a resolver with no manifest bind, is a hard test
 * failure rather than a silent blank in the interface.
 */
const HUD_BIND_RESOLVERS: Readonly<Record<string, HudBindResolver>> = Object.freeze({
  "player.flowerIntensity": (source) =>
    Object.freeze({kind: "meter", value: source.snapshot.hud.flowerIntensity} as const),

  "player.gazePressure": (source) => {
    const stateId = source.snapshot.gazeState;
    const order = GAZE_STATE_ORDER.indexOf(stateId);
    if (order < 0) throw new Error(`unknown authored gaze state ${stateId}`);
    return Object.freeze({
      kind: "state",
      stateId,
      order,
      ofOrder: GAZE_STATE_ORDER.length,
    } as const);
  },

  "player.grazeEvidenceAvailable": (source) =>
    Object.freeze({kind: "count", value: source.snapshot.hud.evidenceAvailable} as const),

  "run.materialMemoryCount": (source) => {
    const memory = materialMemoryOf(source);
    if (memory === null) return Object.freeze({kind: "count", value: 0} as const);
    const total = materialGroups(memory, MATERIAL_GROUPS).reduce(
      (sum, group) => sum + group.count,
      0,
    );
    return Object.freeze({kind: "count", value: total} as const);
  },

  "room.id": (source) => Object.freeze({kind: "token", value: source.snapshot.roomId} as const),

  "weather.phaseLabel": (source) => {
    const {phase, classId} = source.snapshot.weather;
    // Only the OMEN phase carries an authored sentence. Every other phase is
    // authored silence in ui-copy-v4, so nothing is shown for it.
    if (phase !== "omen" || classId === null) {
      return ABSENT(`weather phase ${phase} has no authored label`);
    }
    const copyKey = `weather.${classId}.OMEN`;
    const text = uiCopyOrNull(copyKey);
    if (text === null) return ABSENT(`ui-copy-v4 does not author ${copyKey}`);
    return Object.freeze({kind: "text", text, copyKey} as const);
  },

  "boss.localizedName": (source) =>
    source.boss === null
      ? ABSENT("no boss protocol is present")
      : Object.freeze({kind: "text", text: source.boss.localizedName, copyKey: null} as const),

  "boss.protocolRemaining": (source) => {
    if (source.boss === null) return ABSENT("no boss protocol is present");
    const remaining = source.boss.protocolRemaining;
    // time-or-structure-not-life: this layer never reads a health value.
    return remaining.kind === "interval"
      ? Object.freeze({
          kind: "interval",
          remainingMs: remaining.remainingMs,
          totalMs: remaining.totalMs,
        } as const)
      : Object.freeze({
          kind: "structure",
          resolved: remaining.resolved,
          total: remaining.total,
        } as const);
  },

  "boss.currentReadingFact": (source) => {
    const fact = source.boss?.currentReadingFact ?? null;
    return fact === null
      ? ABSENT("no boss reading fact has been produced")
      : Object.freeze({kind: "text", text: fact, copyKey: null} as const);
  },

  "boss.discoveredResolutionHint": (source) => {
    const hint = source.boss?.discoveredResolutionHint ?? null;
    return hint === null
      ? ABSENT("no resolution component has been discovered")
      : Object.freeze({kind: "text", text: hint, copyKey: null} as const);
  },

  "run.fingerprintBitmap": (source) => {
    const fingerprint = source.finalized?.fingerprint ?? null;
    return fingerprint === null
      ? ABSENT("this run has not been serialized yet")
      : Object.freeze({
          kind: "fingerprint",
          seed: fingerprint.seed,
          digestSha256: fingerprint.digestSha256,
          bitDepth: 1,
        } as const);
  },

  "snapshot.observationsLocalized": (source) => {
    const layer = layerOf("state_snapshot", "observations");
    const maximumLines = layer.maximumLines ?? source.snapshot.observations.length;
    return Object.freeze({kind: "observations", items: observationModels(source, maximumLines)} as const);
  },

  "snapshot.selectedObservationTraces": (source) => {
    const expanded = new Set(source.expandedObservationIds);
    const items: HudTraceEntry[] = [];
    for (const observation of source.snapshot.observations) {
      if (!expanded.has(observation.id)) continue;
      for (const trace of observation.trace) {
        items.push(
          Object.freeze({
            observationId: observation.id,
            path: trace.path,
            value: stringifyTraceValue(trace.value),
          }),
        );
      }
    }
    return Object.freeze({kind: "traces", items: Object.freeze(items)} as const);
  },

  "run.materialMemory": (source) => {
    const memory = materialMemoryOf(source);
    if (memory === null) return ABSENT("no material memory is present in this run");
    const layer = layerOf("state_snapshot", "material_memory");
    const groups = layer.groups ?? MATERIAL_GROUPS;
    return Object.freeze({kind: "material", groups: materialGroups(memory, groups)} as const);
  },

  "run.materialMemory.deathTraces.last": (source) => {
    const memory = materialMemoryOf(source);
    const traces = memory?.deathTraces ?? [];
    const last = traces.length === 0 ? null : traces[traces.length - 1];
    return last === undefined || last === null
      ? ABSENT("this route left no body trace")
      : Object.freeze({
          kind: "materialItem",
          group: "deathTraces",
          id: last.id,
          createdAtTick: last.createdAtTick,
          detail: last.causeArchetype,
        } as const);
  },

  "run.resolution.factLocalized": (source) => {
    const reason = source.finalized?.resolution.reason ?? source.snapshot.runEndReason;
    if (reason === null) return ABSENT("this route has not resolved yet");
    const copyKey = RESOLUTION_COPY_KEYS[reason];
    if (copyKey === undefined) {
      // No authored sentence for this reason: show the authority fact itself
      // rather than substituting a generic line.
      return Object.freeze({kind: "token", value: reason} as const);
    }
    return Object.freeze({kind: "text", text: uiCopy(copyKey), copyKey} as const);
  },
});

export const HUD_BIND_PATHS: readonly string[] = Object.freeze(Object.keys(HUD_BIND_RESOLVERS));

/** Fail-closed: an unauthored bind path is a defect, not an empty element. */
export function resolveHudBind(bind: string, source: HudSource): HudBindValue {
  const resolver = HUD_BIND_RESOLVERS[bind];
  if (resolver === undefined) throw new Error(`no HUD resolver for bind expression ${bind}`);
  return resolver(source);
}

// ---------------------------------------------------------------------------
// Visibility and discovery guards
// ---------------------------------------------------------------------------

type HudConditionResolver = (source: HudSource) => boolean;

/**
 * Keyed by the exact authored expression. This is deliberately NOT a general
 * expression evaluator: a typo or a manifest change must fail closed rather
 * than silently evaluate to false and hide an authored layer.
 */
const HUD_CONDITIONS: Readonly<Record<string, HudConditionResolver>> = Object.freeze({
  // The scheduler's resting phase is "idle"; the layout manifest spells the
  // same absence as NONE.
  "weather.phase != NONE || accessibility.audioDescriptions": (source) =>
    source.snapshot.weather.phase !== "idle" || source.accessibility.audioDescriptions,

  "discovery.hasEncounteredConditionComponent": (source) =>
    source.discovery.hasEncounteredConditionComponent,

  "run.elapsedMs >= 60000 && player.signalInputCount == 0": (source) =>
    source.snapshot.hud.runElapsedMs >= 60000 && source.discovery.signalInputCount === 0,

  "firstEye.horizonVisible && !discovery.gazeThresholdCrossed": (source) =>
    source.discovery.horizonVisible && !source.discovery.gazeThresholdCrossed,

  "override.eligibility": (source) => source.snapshot.hud.overrideEligible,

  "snapshot.open && !discovery.tracePanelOpened": (source) =>
    source.discovery.snapshotOpen && !source.discovery.tracePanelOpened,
});

export const HUD_CONDITION_EXPRESSIONS: readonly string[] = Object.freeze(
  Object.keys(HUD_CONDITIONS),
);

export function resolveHudCondition(expression: string, source: HudSource): boolean {
  const resolver = HUD_CONDITIONS[expression];
  if (expression.length === 0 || resolver === undefined) {
    throw new Error(`no HUD resolver for condition expression ${expression}`);
  }
  return resolver(source);
}

// ---------------------------------------------------------------------------
// Screen models
// ---------------------------------------------------------------------------

export function layerOf(screenId: string, layerId: string): UiLayoutLayer {
  const screen = UI_LAYOUT_SCREENS[screenId];
  if (screen === undefined) throw new Error(`ui-layouts-v4 does not author the screen ${screenId}`);
  const layer = screen.layers.find((entry) => entry.id === layerId);
  if (layer === undefined) {
    throw new Error(`ui-layouts-v4 screen ${screenId} does not author the layer ${layerId}`);
  }
  return layer;
}

export interface HudLayerModel {
  readonly id: string;
  readonly rect: UiRect | null;
  readonly label: LocalizedText | null;
  readonly labelCopyKey: string | null;
  readonly semantic: string | null;
  readonly visible: boolean;
  readonly value: HudBindValue;
}

export interface HudScreenModel {
  readonly screenId: string;
  readonly layers: readonly HudLayerModel[];
}

/** Projection only. Reads the frozen snapshot; writes nothing anywhere. */
export function projectHudScreen(screenId: string, source: HudSource): HudScreenModel {
  const screen = UI_LAYOUT_SCREENS[screenId];
  if (screen === undefined) throw new Error(`ui-layouts-v4 does not author the screen ${screenId}`);
  const layers = screen.layers.map((layer) => {
    const value = resolveHudBind(layer.bind, source);
    const visible =
      (layer.visibility === null || resolveHudCondition(layer.visibility, source)) &&
      value.kind !== "absent";
    return Object.freeze({
      id: layer.id,
      rect: layer.rect,
      label: layer.labelCopy === null ? null : uiCopy(layer.labelCopy),
      labelCopyKey: layer.labelCopy,
      semantic: layer.semantic,
      visible,
      value,
    });
  });
  return Object.freeze({screenId, layers: Object.freeze(layers)});
}

export interface HudPromptModel {
  readonly id: string;
  readonly visible: boolean;
  readonly text: LocalizedText | null;
  readonly copyKey: string | null;
  readonly visual: string | null;
  readonly surface: string | null;
  readonly dismiss: string;
}

/**
 * Discovery prompts REPLACE tutorials: a glyph only appears after the world
 * has already demonstrated the reaction (the flower fallback after 60s is the
 * one authored exception, and it is authored in the manifest guard itself).
 */
export function projectDiscoveryPrompts(source: HudSource): readonly HudPromptModel[] {
  return Object.freeze(
    UI_DISCOVERY_PROMPTS.map((prompt) =>
      Object.freeze({
        id: prompt.id,
        visible: resolveHudCondition(prompt.guard, source),
        // A prompt with no authored copy is a purely visual authored signal.
        text: prompt.copyKey === null ? null : uiCopy(prompt.copyKey),
        copyKey: prompt.copyKey,
        visual: prompt.visual,
        surface: prompt.surface,
        dismiss: prompt.dismiss,
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// DOM projection
// ---------------------------------------------------------------------------

/**
 * The minimal element surface the HUD writes to. Keeping it structural means
 * the projection can be exercised without a DOM, and it makes the read-only
 * direction explicit: the HUD assigns to these fields and never reads back a
 * measured or computed value.
 */
export interface HudWritableElement {
  textContent: string | null;
  hidden: boolean;
  readonly dataset: Record<string, string | undefined>;
  readonly style: {setProperty(property: string, value: string): void};
}

export interface HudElementSource {
  getElementById(id: string): HudWritableElement | null;
}

/**
 * Stable element ids in index.html, built from the screen's authored semantic
 * id (so the renamed run_interruption screen never surfaces the old key) and
 * the authored layer id.
 */
export function hudElementId(screenId: string, layerId: string): string {
  const screen = UI_LAYOUT_SCREENS[screenId];
  if (screen === undefined) throw new Error(`ui-layouts-v4 does not author the screen ${screenId}`);
  return `hud-${screen.semanticId.replaceAll("_", "-")}-${layerId.replaceAll("_", "-")}`;
}

export function promptElementId(promptId: string): string {
  return `hud-prompt-${promptId}`;
}

export function formatBindValue(value: HudBindValue, locale: UiLocale): string {
  switch (value.kind) {
    case "meter":
      return `${Math.round(value.value * 100)}%`;
    case "count":
      return String(value.value);
    case "token":
      return value.value;
    case "state":
      return value.stateId;
    case "interval":
      return `${Math.max(0, Math.round(value.remainingMs / 1000))}s`;
    case "structure":
      return `${value.resolved}/${value.total}`;
    case "text":
      return localize(value.text, locale);
    case "observations":
      return value.items.map((item) => localize(item.text, locale)).join("\n");
    case "traces":
      return value.items.map((item) => `${item.path} = ${item.value}`).join("\n");
    case "material":
      return value.groups.map((group) => `${group.group} ${group.count}`).join(" · ");
    case "materialItem":
      return `${value.id} @${value.createdAtTick} ${value.detail}`;
    case "fingerprint":
      return value.digestSha256.slice(0, 16);
    case "absent":
      return "";
  }
}

export interface HudViewOptions {
  readonly locale?: UiLocale;
}

/**
 * Applies a projected screen model onto the authored elements. It is a sink:
 * it holds no gameplay state, and nothing it writes is ever read back into
 * the conductor.
 */
export class HudView {
  readonly #document: HudElementSource;
  readonly #locale: UiLocale;
  readonly #expanded = new Set<string>();

  constructor(documentLike: HudElementSource, options: HudViewOptions = {}) {
    this.#document = documentLike;
    this.#locale = options.locale ?? "zh-CN";
  }

  /** Expand-only, exactly as the manifest authors the fact_traces layer. */
  expandObservation(observationId: string): void {
    if (observationId.length === 0) throw new Error("an observation id is required to expand it");
    this.#expanded.add(observationId);
  }

  get expandedObservationIds(): readonly string[] {
    return Object.freeze([...this.#expanded]);
  }

  /** Authored logical rect -> CSS custom properties. Geometry never lives in CSS. */
  #applyRect(element: HudWritableElement, rect: UiRect | null): void {
    if (rect === null) return;
    element.style.setProperty("--layer-x", String(rect[0]));
    element.style.setProperty("--layer-y", String(rect[1]));
    element.style.setProperty("--layer-w", String(rect[2]));
    element.style.setProperty("--layer-h", String(rect[3]));
  }

  renderScreen(screenId: string, source: HudSource): HudScreenModel {
    const model = projectHudScreen(screenId, source);
    for (const layer of model.layers) {
      const element = this.#document.getElementById(hudElementId(screenId, layer.id));
      if (element === null) continue;
      this.#applyRect(element, layer.rect);
      element.hidden = !layer.visible;
      element.textContent = layer.visible ? formatBindValue(layer.value, this.#locale) : "";
      element.dataset.bindKind = layer.value.kind;
      // The authored label lives beside the value element, so the markup never
      // duplicates (and never drifts from) ui-copy-v4.
      if (layer.label !== null) {
        const label = this.#document.getElementById(
          `${hudElementId(screenId, layer.id)}-label`,
        );
        if (label !== null) {
          this.#applyRect(label, layer.rect);
          label.hidden = !layer.visible;
          label.textContent = localize(layer.label, this.#locale);
        }
      }
      if (layer.value.kind === "meter") {
        element.style.setProperty("--hud-meter", String(layer.value.value));
      }
      if (layer.value.kind === "state") {
        element.dataset.stateId = layer.value.stateId;
        element.style.setProperty("--hud-state-order", String(layer.value.order));
      }
    }
    return model;
  }

  renderDiscoveryPrompts(source: HudSource): readonly HudPromptModel[] {
    const prompts = projectDiscoveryPrompts(source);
    for (const prompt of prompts) {
      const element = this.#document.getElementById(promptElementId(prompt.id));
      if (element === null) continue;
      element.hidden = !prompt.visible;
      element.textContent =
        prompt.visible && prompt.text !== null ? localize(prompt.text, this.#locale) : "";
    }
    return prompts;
  }

  /** Applies the integer stage scale as CSS custom properties, once per resize. */
  applyStageScale(stage: HudWritableElement, availableWidthPx: number, availableHeightPx: number): number {
    const scale = integerPixelScale(availableWidthPx, availableHeightPx);
    const [logicalWidth, logicalHeight] = UI_LAYOUT_COMMON.logicalCanvas;
    stage.style.setProperty("--stage-scale", String(scale));
    stage.style.setProperty("--stage-width", `${logicalWidth * scale}px`);
    stage.style.setProperty("--stage-height", `${logicalHeight * scale}px`);
    stage.dataset.stageScale = String(scale);
    return scale;
  }
}
