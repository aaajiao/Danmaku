import accessibilityProfilesManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/runtime/accessibility-profiles-v4.json";
import assetBindingsManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/integration/asset-bindings-v4.json";
import bindingValidationManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/integration/asset-bindings-validation-v4.json";
import bossRigsManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/boss-rigs-v4.json";
import eventProjectionsManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/integration/event-projections-v4.json";
import feedbackBindingsManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/runtime/feedback-bindings-v4.json";
import {
  isCanonicalEventId,
  type CanonicalGameplayEvent,
  type JsonValue,
} from "../authority/events";
import {
  v4AudioOrNull,
  v4FrameOrNull,
  type V4AudioAsset,
  type V4AudioBus,
  type V4FrameBinding,
} from "../assets/shared-v4";

/*
 * The single generic feedback subscriber.
 *
 * This is the one place a canonical gameplay fact becomes presentation intent.
 * It is pure: it renders nothing, plays nothing, touches no DOM, owns no timer
 * and holds no reference to any authority command port. It reads a frozen
 * committed-event suffix through a read-only cursor and returns a frozen cue
 * batch. The renderer, the audio trace and the HUD consume that batch.
 *
 * Authority direction (asset-bindings-v4.json authorityFlow):
 *   gameplay event -> feedback binding -> cue resolver -> passive subscriber.
 *
 * Nothing in this module can be read back by gameplay. The only mutable state
 * it keeps is presentation cadence (the authored gaze pulse interval), a
 * once-only evidence projection key set, and the consumed-sequence cursor —
 * none of which is ever handed to an authority module.
 *
 * A cue V4 does not author is silence. There is no substitute frame, no
 * substitute sound, no generic default. An event id outside the canonical
 * registry is a hard error, never a default cue.
 */

/* ------------------------------------------------------------------ *
 * Manifest parsing. Every id, count, slug and condition below is read
 * from V4 at module load and fails closed on drift.
 * ------------------------------------------------------------------ */

type Dictionary = Record<string, unknown>;

function isRecord(value: unknown): value is Dictionary {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Dictionary {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  return value;
}

function requireArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}

function requireId(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new Error(`${path} must be a trimmed non-empty string`);
  }
  return value;
}

function assertSchemaVersion(label: string, actual: unknown, expected: string): void {
  if (actual !== expected) {
    throw new Error(`${label} schema drifted: expected ${expected}, found ${String(actual)}`);
  }
}

assertSchemaVersion(
  "V4 asset bindings",
  assetBindingsManifest.schemaVersion,
  "4.0.0-asset-bindings",
);
assertSchemaVersion(
  "V4 event projections",
  eventProjectionsManifest.schemaVersion,
  "4.0.0-event-projections",
);
assertSchemaVersion("V4 feedback bindings", feedbackBindingsManifest.schemaVersion, "4.0.0");
assertSchemaVersion(
  "V4 accessibility profiles",
  accessibilityProfilesManifest.schemaVersion,
  "4.0.0",
);
assertSchemaVersion(
  "V4 binding validation",
  bindingValidationManifest.schemaVersion,
  "4.0.0-binding-qa",
);

if (bindingValidationManifest.status !== "PASS" || bindingValidationManifest.errors.length > 0) {
  throw new Error("V4 asset binding validation is not PASS");
}

/**
 * The authored dispatch policy. Presentation may never write gameplay, and one
 * binding fires at most once per event occurrence — the read cursor below is
 * that dedupe rule's implementation.
 */
const FEEDBACK_POLICY = feedbackBindingsManifest.policy;
if (
  FEEDBACK_POLICY.sourceKind !== "gameplay-event"
  || FEEDBACK_POLICY.sinkMayEmitGameplay !== false
  || FEEDBACK_POLICY.acyclic !== true
  || FEEDBACK_POLICY.dedupeKey !== "bindingId:eventOccurrenceKey"
) {
  throw new Error("V4 feedback authority policy drifted");
}

/* ---- accessibility axes ------------------------------------------- */

const ACCESSIBILITY_AXES: Readonly<Record<string, readonly string[]>> = (() => {
  const axes = requireRecord(accessibilityProfilesManifest.axes, "accessibility axes");
  const parsed: Record<string, readonly string[]> = {};
  for (const [axis, definition] of Object.entries(axes)) {
    const values = requireArray(
      requireRecord(definition, `accessibility axis ${axis}`).values,
      `accessibility axis ${axis}.values`,
    ).map((value, index) => requireId(value, `accessibility axis ${axis}.values[${index}]`));
    parsed[axis] = Object.freeze(values);
  }
  if (accessibilityProfilesManifest.gameplayEventTraceInvariant !== true) {
    throw new Error("V4 accessibility profiles no longer guarantee gameplay trace parity");
  }
  return Object.freeze(parsed);
})();

export type FeedbackAccessibilityProfile = Readonly<Record<string, string>>;

/**
 * Presets are authored. `full` is the identity profile: it selects every base
 * resolver and no fallback.
 */
export const FEEDBACK_ACCESSIBILITY_PRESETS: Readonly<
  Record<string, FeedbackAccessibilityProfile>
> = (() => {
  const presets = requireRecord(accessibilityProfilesManifest.presets, "accessibility presets");
  const parsed: Record<string, FeedbackAccessibilityProfile> = {};
  for (const [name, value] of Object.entries(presets)) {
    const profile = requireRecord(value, `accessibility preset ${name}`);
    const resolved: Record<string, string> = {};
    for (const axis of Object.keys(ACCESSIBILITY_AXES)) {
      const axisValue = requireId(profile[axis], `accessibility preset ${name}.${axis}`);
      if (!ACCESSIBILITY_AXES[axis]?.includes(axisValue)) {
        throw new Error(`accessibility preset ${name}.${axis} is not an authored axis value`);
      }
      resolved[axis] = axisValue;
    }
    parsed[name] = Object.freeze(resolved);
  }
  return Object.freeze(parsed);
})();

const DEFAULT_ACCESSIBILITY_PROFILE: FeedbackAccessibilityProfile = (() => {
  const preset = FEEDBACK_ACCESSIBILITY_PRESETS["full"];
  if (preset === undefined) {
    throw new Error("V4 accessibility presets no longer author the full profile");
  }
  return preset;
})();

/** An authored `when` entry, e.g. `motion:reduced`. */
interface AccessibilityCondition {
  readonly raw: string;
  readonly axis: string;
  readonly value: string;
}

function parseAccessibilityCondition(raw: unknown, path: string): AccessibilityCondition {
  const text = requireId(raw, path);
  const separator = text.indexOf(":");
  if (separator <= 0 || separator === text.length - 1) {
    throw new Error(`${path} must be an axis:value condition, found ${text}`);
  }
  const axis = text.slice(0, separator);
  const value = text.slice(separator + 1);
  if (!ACCESSIBILITY_AXES[axis]?.includes(value)) {
    throw new Error(`${path} references an unauthored accessibility state: ${text}`);
  }
  return Object.freeze({raw: text, axis, value});
}

export function normalizeAccessibilityProfile(
  profile: FeedbackAccessibilityProfile,
): FeedbackAccessibilityProfile {
  const resolved: Record<string, string> = {};
  for (const axis of Object.keys(ACCESSIBILITY_AXES)) {
    const value = profile[axis] ?? DEFAULT_ACCESSIBILITY_PROFILE[axis];
    if (value === undefined || !ACCESSIBILITY_AXES[axis]?.includes(value)) {
      throw new Error(`accessibility profile axis ${axis} is not an authored value`);
    }
    resolved[axis] = value;
  }
  for (const axis of Object.keys(profile)) {
    if (!Object.hasOwn(ACCESSIBILITY_AXES, axis)) {
      throw new Error(`accessibility profile has an unauthored axis: ${axis}`);
    }
  }
  return Object.freeze(resolved);
}

/**
 * A fallback applies when ANY listed condition holds. V4 authors the condition
 * list but not the join, and an accessibility substitution that under-applies
 * is the harmful direction: `["motion:reduced","flashing:off"]` guards a cue
 * that is both a motion and a flash, so either setting must retire it.
 */
function conditionsHold(
  conditions: readonly AccessibilityCondition[],
  profile: FeedbackAccessibilityProfile,
): readonly string[] {
  const matched = conditions
    .filter((condition) => profile[condition.axis] === condition.value)
    .map((condition) => condition.raw);
  return Object.freeze(matched);
}

/* ---- selectors ----------------------------------------------------- */

const SELECTORS = requireRecord(assetBindingsManifest.selectors, "asset bindings selectors");

function parseSlugTable(key: string): Readonly<Record<string, string>> {
  const table = requireRecord(SELECTORS[key], `selectors.${key}`);
  const parsed: Record<string, string> = {};
  const seen = new Set<string>();
  for (const [canonical, slug] of Object.entries(table)) {
    const value = requireId(slug, `selectors.${key}.${canonical}`);
    if (seen.has(value)) throw new Error(`selectors.${key} reuses slug ${value}`);
    seen.add(value);
    parsed[canonical] = value;
  }
  return Object.freeze(parsed);
}

/**
 * The room slug trap, resolved in exactly one place. FORCED_ALIGNMENT is the
 * canonical room id; `forced_choice` is its asset slug. Nothing here slugifies
 * a room id by transformation — the table is the only authority.
 */
const ROOM_SLUG = parseSlugTable("roomSlug");
const WEATHER_SLUG = parseSlugTable("weatherSlug");

const BOSS_CANONICAL_PREFIX = "boss.";

/** Authored phase order per rig; phaseIndex is the 1-based position in it. */
const BOSS_PHASE_ORDER: Readonly<Record<string, readonly string[]>> = (() => {
  const rigs = requireArray(bossRigsManifest.rigs, "boss rigs");
  const parsed: Record<string, readonly string[]> = {};
  for (const [index, rawRig] of rigs.entries()) {
    const rig = requireRecord(rawRig, `boss rigs[${index}]`);
    const id = requireId(rig.id, `boss rigs[${index}].id`);
    if (!id.startsWith(BOSS_CANONICAL_PREFIX)) {
      throw new Error(`boss rig id must carry the canonical prefix: ${id}`);
    }
    const phases = requireArray(rig.phases, `boss rigs[${index}].phases`).map(
      (rawPhase, phaseIndex) =>
        requireId(
          requireRecord(rawPhase, `boss rigs[${index}].phases[${phaseIndex}]`).id,
          `boss rigs[${index}].phases[${phaseIndex}].id`,
        ),
    );
    parsed[id] = Object.freeze(phases);
  }
  return Object.freeze(parsed);
})();

const PLACEHOLDER_PATTERN = /\{([A-Za-z]+)\}/g;
const SUPPORTED_PLACEHOLDERS = Object.freeze([
  "roomSlug",
  "weatherSlug",
  "bossSlug",
  "bossCanonicalId",
  "phaseIndex",
] as const);
export type FeedbackPlaceholder = (typeof SUPPORTED_PLACEHOLDERS)[number];

for (const placeholder of SUPPORTED_PLACEHOLDERS) {
  if (!Object.hasOwn(SELECTORS, placeholder)) {
    throw new Error(`selectors block no longer authors ${placeholder}`);
  }
}

/* ---- resolver shapes ----------------------------------------------- */

export interface FeedbackHapticPulse {
  readonly atMs: number;
  readonly durationMs: number;
  readonly strength: number;
}

type ResolverSpec =
  | Readonly<{shape: "literal"; id: string}>
  | Readonly<{
    shape: "selector";
    selector: string;
    fallback: string;
    placeholders: readonly FeedbackPlaceholder[];
    mix: "mono" | null;
  }>
  | Readonly<{shape: "haptic"; pulses: readonly FeedbackHapticPulse[]}>;

export type FeedbackCueKind = "visual" | "audio" | "ui" | "haptic";

const CUE_KINDS: readonly FeedbackCueKind[] = Object.freeze([
  "visual",
  "audio",
  "ui",
  "haptic",
]);

function parseHapticPulses(value: Dictionary, path: string): readonly FeedbackHapticPulse[] {
  const pulses = requireArray(value.pulses, `${path}.pulses`);
  if (pulses.length === 0) throw new Error(`${path}.pulses must not be empty`);
  return Object.freeze(pulses.map((rawPulse, index) => {
    const pulse = requireRecord(rawPulse, `${path}.pulses[${index}]`);
    const {atMs, durationMs, strength} = pulse;
    if (
      typeof atMs !== "number" || !Number.isFinite(atMs) || atMs < 0
      || typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs <= 0
      || typeof strength !== "number" || !Number.isFinite(strength)
      || strength < 0 || strength > 1
    ) {
      throw new Error(`${path}.pulses[${index}] is not an authored pulse recipe`);
    }
    return Object.freeze({atMs, durationMs, strength});
  }));
}

function parseResolver(value: unknown, path: string): ResolverSpec {
  if (typeof value === "string") {
    return Object.freeze({shape: "literal", id: requireId(value, path)} as const);
  }
  const record = requireRecord(value, path);
  if (Object.hasOwn(record, "pulses")) {
    return Object.freeze({shape: "haptic", pulses: parseHapticPulses(record, path)} as const);
  }
  const selector = requireId(record.selector, `${path}.selector`);
  const fallback = requireId(record.fallback, `${path}.fallback`);
  const placeholders: FeedbackPlaceholder[] = [];
  PLACEHOLDER_PATTERN.lastIndex = 0;
  let match = PLACEHOLDER_PATTERN.exec(selector);
  while (match !== null) {
    const name = match[1];
    if (
      name === undefined
      || !(SUPPORTED_PLACEHOLDERS as readonly string[]).includes(name)
    ) {
      throw new Error(`${path}.selector uses an unauthored placeholder: ${String(name)}`);
    }
    placeholders.push(name as FeedbackPlaceholder);
    match = PLACEHOLDER_PATTERN.exec(selector);
  }
  if (placeholders.length === 0) {
    throw new Error(`${path}.selector declares no placeholder`);
  }
  const rawMix = record.mix;
  if (rawMix !== undefined && rawMix !== "mono") {
    throw new Error(`${path}.mix is not an authored downmix: ${String(rawMix)}`);
  }
  return Object.freeze({
    shape: "selector",
    selector,
    fallback,
    placeholders: Object.freeze(placeholders),
    mix: rawMix === "mono" ? "mono" : null,
  } as const);
}

/* ---- id universes --------------------------------------------------- */

function frameExists(id: string): boolean {
  return v4FrameOrNull(id) !== null;
}

function audioExists(id: string): boolean {
  return v4AudioOrNull(id) !== null;
}

/**
 * `ui` resolvers name a HUD cue, not an asset: `state_snapshot.observations`
 * exists in no frame or audio universe by design. They are validated as ids and
 * passed through for the HUD layer to bind.
 */
function idExistsForKind(kind: FeedbackCueKind, id: string): boolean {
  if (kind === "visual") return frameExists(id);
  if (kind === "audio") return audioExists(id);
  return true;
}

function assertResolvableSpec(spec: ResolverSpec, kind: FeedbackCueKind, path: string): void {
  if (spec.shape === "haptic") {
    if (kind !== "haptic") throw new Error(`${path} binds a pulse recipe to a ${kind} sink`);
    return;
  }
  if (kind === "haptic") throw new Error(`${path} binds a haptic sink to a non-pulse resolver`);
  if (spec.shape === "literal") {
    if (!idExistsForKind(kind, spec.id)) {
      throw new Error(`${path} references an id outside the authored ${kind} universe: ${spec.id}`);
    }
    return;
  }
  // A selector may legitimately miss — that is precisely what `fallback` is
  // authored for. The fallback itself may never miss.
  if (!idExistsForKind(kind, spec.fallback)) {
    throw new Error(
      `${path} fallback is outside the authored ${kind} universe: ${spec.fallback}`,
    );
  }
}

/* ---- runtime cue resolvers (34) ------------------------------------- */

export interface RuntimeCueBinding {
  readonly bindingId: string;
  readonly eventId: string;
  readonly kind: FeedbackCueKind;
  readonly cueId: string;
  readonly gameplayCritical: boolean;
  readonly resolver: ResolverSpec;
  readonly fallbackCueId: string | null;
  readonly fallbackConditions: readonly AccessibilityCondition[];
  readonly fallbackResolver: ResolverSpec | null;
}

const RUNTIME_BINDINGS: readonly RuntimeCueBinding[] = (() => {
  const declared = requireArray(
    feedbackBindingsManifest.bindings,
    "feedback bindings",
  );
  const declaredById = new Map<string, Dictionary>();
  for (const [index, raw] of declared.entries()) {
    const binding = requireRecord(raw, `feedback bindings[${index}]`);
    const id = requireId(binding.id, `feedback bindings[${index}].id`);
    if (declaredById.has(id)) throw new Error(`duplicate feedback binding id: ${id}`);
    declaredById.set(id, binding);
  }

  const resolvers = requireArray(
    assetBindingsManifest.runtimeCueResolvers,
    "runtimeCueResolvers",
  );
  const parsed: RuntimeCueBinding[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of resolvers.entries()) {
    const path = `runtimeCueResolvers[${index}]`;
    const entry = requireRecord(raw, path);
    const bindingId = requireId(entry.bindingId, `${path}.bindingId`);
    if (seen.has(bindingId)) throw new Error(`duplicate runtime cue binding: ${bindingId}`);
    seen.add(bindingId);
    const eventId = requireId(entry.eventId, `${path}.eventId`);
    if (!isCanonicalEventId(eventId)) {
      throw new Error(`${path}.eventId is not a canonical gameplay event: ${eventId}`);
    }
    const kind = requireId(entry.kind, `${path}.kind`);
    if (!CUE_KINDS.includes(kind as FeedbackCueKind)) {
      throw new Error(`${path}.kind is not an authored sink kind: ${kind}`);
    }
    const cueId = requireId(entry.cueId, `${path}.cueId`);
    const resolver = parseResolver(entry.resolver, `${path}.resolver`);
    assertResolvableSpec(resolver, kind as FeedbackCueKind, `${path}.resolver`);

    let fallbackCueId: string | null = null;
    let fallbackConditions: readonly AccessibilityCondition[] = Object.freeze([]);
    let fallbackResolver: ResolverSpec | null = null;
    if (entry.accessibilityFallback !== undefined) {
      const fallback = requireRecord(entry.accessibilityFallback, `${path}.accessibilityFallback`);
      fallbackCueId = requireId(fallback.cueId, `${path}.accessibilityFallback.cueId`);
      fallbackConditions = Object.freeze(
        requireArray(fallback.when, `${path}.accessibilityFallback.when`).map(
          (condition, conditionIndex) => parseAccessibilityCondition(
            condition,
            `${path}.accessibilityFallback.when[${conditionIndex}]`,
          ),
        ),
      );
      if (fallbackConditions.length === 0) {
        throw new Error(`${path}.accessibilityFallback.when must not be empty`);
      }
      fallbackResolver = parseResolver(
        fallback.resolver,
        `${path}.accessibilityFallback.resolver`,
      );
      assertResolvableSpec(
        fallbackResolver,
        kind as FeedbackCueKind,
        `${path}.accessibilityFallback.resolver`,
      );
    }

    // Cross-check the two manifests that both author this binding.
    const declaredBinding = declaredById.get(bindingId);
    if (declaredBinding === undefined) {
      throw new Error(`runtime cue ${bindingId} has no feedback-bindings entry`);
    }
    const sink = requireRecord(declaredBinding.sink, `feedback binding ${bindingId}.sink`);
    if (
      declaredBinding.eventId !== eventId
      || sink.kind !== kind
      || sink.cueId !== cueId
    ) {
      throw new Error(`V4 feedback identity drifted for ${bindingId}`);
    }
    const declaredFallback = declaredBinding.fallback;
    if ((declaredFallback === undefined) !== (fallbackCueId === null)) {
      throw new Error(`V4 feedback fallback presence drifted for ${bindingId}`);
    }
    if (declaredFallback !== undefined) {
      const declaredFallbackRecord = requireRecord(
        declaredFallback,
        `feedback binding ${bindingId}.fallback`,
      );
      const declaredWhen = requireArray(
        declaredFallbackRecord.when,
        `feedback binding ${bindingId}.fallback.when`,
      );
      if (
        declaredFallbackRecord.cueId !== fallbackCueId
        || declaredWhen.length !== fallbackConditions.length
        || declaredWhen.some((value, whenIndex) => value !== fallbackConditions[whenIndex]?.raw)
      ) {
        throw new Error(`V4 feedback fallback identity drifted for ${bindingId}`);
      }
    }
    if (typeof declaredBinding.gameplayCritical !== "boolean") {
      throw new Error(`feedback binding ${bindingId}.gameplayCritical must be a boolean`);
    }
    // `policy.criticalConditionalCueRequiresFallback` is deliberately NOT
    // reinterpreted here as "every selector-shaped critical cue needs a
    // fallback": room-world-swap-visual is critical, selector-shaped, has no
    // accessibility fallback, and asset-bindings-validation-v4.json still
    // reports PASS. Inventing a stricter reading would fail closed on authored,
    // valid content.

    parsed.push(Object.freeze({
      bindingId,
      eventId,
      kind: kind as FeedbackCueKind,
      cueId,
      gameplayCritical: declaredBinding.gameplayCritical,
      resolver,
      fallbackCueId,
      fallbackConditions,
      fallbackResolver,
    }));
  }

  if (declaredById.size !== parsed.length) {
    throw new Error("feedback bindings and runtime cue resolvers are not 1:1");
  }
  if (parsed.length !== bindingValidationManifest.runtimeBindings) {
    throw new Error(
      `runtime cue resolver count drifted: ${parsed.length} vs declared `
      + `${bindingValidationManifest.runtimeBindings}`,
    );
  }
  return Object.freeze(parsed);
})();

const RUNTIME_BINDINGS_BY_EVENT: ReadonlyMap<string, readonly RuntimeCueBinding[]> = (() => {
  const grouped = new Map<string, RuntimeCueBinding[]>();
  for (const binding of RUNTIME_BINDINGS) {
    const bucket = grouped.get(binding.eventId);
    if (bucket === undefined) grouped.set(binding.eventId, [binding]);
    else bucket.push(binding);
  }
  return new Map(
    [...grouped].map(([eventId, bindings]) => [eventId, Object.freeze(bindings)] as const),
  );
})();

/** Every canonical event the requiredCriticalEvents list insists is bound. */
for (const [index, required] of feedbackBindingsManifest.requiredCriticalEvents.entries()) {
  const eventId = requireId(required, `requiredCriticalEvents[${index}]`);
  if (!RUNTIME_BINDINGS_BY_EVENT.has(eventId)) {
    throw new Error(`required critical event has no runtime cue binding: ${eventId}`);
  }
}

/* ---- narrative projections (37) + narrative cues (37) ---------------- */

export interface NarrativeProjectionRule {
  readonly narrativeEvent: string;
  readonly canonicalSources: readonly string[];
  readonly predicate: string;
  readonly identity: boolean;
}

const IDENTITY_PREDICATE = "identity";

const NARRATIVE_PROJECTIONS: readonly NarrativeProjectionRule[] = (() => {
  const rules = requireArray(eventProjectionsManifest.rules, "event projection rules");
  const parsed: NarrativeProjectionRule[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of rules.entries()) {
    const path = `event projection rules[${index}]`;
    const rule = requireRecord(raw, path);
    const narrativeEvent = requireId(rule.narrativeEvent, `${path}.narrativeEvent`);
    if (seen.has(narrativeEvent)) {
      throw new Error(`duplicate narrative projection: ${narrativeEvent}`);
    }
    seen.add(narrativeEvent);
    if (rule.authority !== "read-only projection") {
      throw new Error(`${path} is not a read-only projection`);
    }
    const canonicalSources = requireArray(
      rule.canonicalSources,
      `${path}.canonicalSources`,
    ).map((source, sourceIndex) => {
      const id = requireId(source, `${path}.canonicalSources[${sourceIndex}]`);
      if (!isCanonicalEventId(id)) {
        throw new Error(`${path}.canonicalSources[${sourceIndex}] is not canonical: ${id}`);
      }
      return id;
    });
    if (canonicalSources.length === 0) {
      throw new Error(`${path}.canonicalSources must not be empty`);
    }
    const predicate = requireId(rule.predicate, `${path}.predicate`);
    parsed.push(Object.freeze({
      narrativeEvent,
      canonicalSources: Object.freeze(canonicalSources),
      predicate,
      identity: predicate === IDENTITY_PREDICATE,
    }));
  }
  if (
    parsed.length !== eventProjectionsManifest.projectionCount
    || parsed.length !== bindingValidationManifest.eventProjections
  ) {
    throw new Error(`event projection count drifted: ${parsed.length}`);
  }
  return Object.freeze(parsed);
})();

export interface NarrativeCueBinding {
  readonly cueId: string;
  readonly narrativeEvent: string;
  readonly frame: ResolverSpec;
  readonly audio: ResolverSpec;
  /**
   * V4 authors the narrative UI and haptic columns as prose ("flower bar notch
   * 1", "soft 18ms"), not as machine ids. They are carried verbatim: parsing
   * prose into a pulse recipe would mint content V4 did not author.
   */
  readonly uiNote: string;
  readonly hapticNote: string;
}

const NARRATIVE_CUES: readonly NarrativeCueBinding[] = (() => {
  const resolvers = requireArray(
    assetBindingsManifest.narrativeCueResolvers,
    "narrativeCueResolvers",
  );
  const projectionNames = new Set(NARRATIVE_PROJECTIONS.map((rule) => rule.narrativeEvent));
  const parsed: NarrativeCueBinding[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of resolvers.entries()) {
    const path = `narrativeCueResolvers[${index}]`;
    const entry = requireRecord(raw, path);
    const cueId = requireId(entry.cueId, `${path}.cueId`);
    if (seen.has(cueId)) throw new Error(`duplicate narrative cue: ${cueId}`);
    seen.add(cueId);
    const narrativeEvent = requireId(entry.event, `${path}.event`);
    if (!projectionNames.has(narrativeEvent)) {
      throw new Error(
        `${path}.event is not minted by event-projections-v4.json: ${narrativeEvent}`,
      );
    }
    const frame = parseResolver(entry.frame, `${path}.frame`);
    assertResolvableSpec(frame, "visual", `${path}.frame`);
    const audio = parseResolver(entry.audio, `${path}.audio`);
    assertResolvableSpec(audio, "audio", `${path}.audio`);
    parsed.push(Object.freeze({
      cueId,
      narrativeEvent,
      frame,
      audio,
      uiNote: requireId(entry.ui, `${path}.ui`),
      hapticNote: requireId(entry.haptic, `${path}.haptic`),
    }));
  }
  if (parsed.length !== bindingValidationManifest.narrativeCues) {
    throw new Error(`narrative cue count drifted: ${parsed.length}`);
  }
  if (parsed.length !== projectionNames.size) {
    throw new Error("narrative cues and event projections are not 1:1");
  }
  return Object.freeze(parsed);
})();

const NARRATIVE_CUE_BY_EVENT: ReadonlyMap<string, NarrativeCueBinding> = new Map(
  NARRATIVE_CUES.map((cue) => [cue.narrativeEvent, cue] as const),
);

const PROJECTIONS_BY_SOURCE: ReadonlyMap<string, readonly NarrativeProjectionRule[]> = (() => {
  const grouped = new Map<string, NarrativeProjectionRule[]>();
  for (const rule of NARRATIVE_PROJECTIONS) {
    for (const source of rule.canonicalSources) {
      const bucket = grouped.get(source);
      if (bucket === undefined) grouped.set(source, [rule]);
      else bucket.push(rule);
    }
  }
  return new Map([...grouped].map(([source, rules]) => [source, Object.freeze(rules)] as const));
})();

/* ------------------------------------------------------------------ *
 * Substitution context, derived from the canonical payload only.
 * ------------------------------------------------------------------ */

interface CueSubstitution {
  readonly roomId: string | null;
  readonly weatherId: string | null;
  readonly bossCanonicalId: string | null;
  readonly phaseIndex: number | null;
}

const EMPTY_SUBSTITUTION: CueSubstitution = Object.freeze({
  roomId: null,
  weatherId: null,
  bossCanonicalId: null,
  phaseIndex: null,
});

function payloadString(payload: Readonly<Record<string, JsonValue>>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Payload field names come from the canonical event schema's requiredPayload
 * (`toRoom`, `weather`, `bossId`, `toPhaseId`); phase order comes from
 * boss-rigs-v4.json. Nothing is guessed from the event name.
 */
function deriveSubstitution(event: CanonicalGameplayEvent): CueSubstitution {
  const payload = event.payload as Readonly<Record<string, JsonValue>>;
  const roomId = payloadString(payload, "toRoom") ?? payloadString(payload, "roomId");
  const weatherId = payloadString(payload, "weather");
  const bossCanonicalId = payloadString(payload, "bossId");
  let phaseIndex: number | null = null;
  if (bossCanonicalId !== null) {
    const phaseId = payloadString(payload, "toPhaseId") ?? payloadString(payload, "finalPhaseId");
    const order = BOSS_PHASE_ORDER[bossCanonicalId];
    if (phaseId !== null && order !== undefined) {
      const position = order.indexOf(phaseId);
      if (position >= 0) phaseIndex = position + 1;
    }
  }
  if (
    roomId === null && weatherId === null && bossCanonicalId === null && phaseIndex === null
  ) {
    return EMPTY_SUBSTITUTION;
  }
  return Object.freeze({roomId, weatherId, bossCanonicalId, phaseIndex});
}

function placeholderValue(
  placeholder: FeedbackPlaceholder,
  substitution: CueSubstitution,
): string | null {
  switch (placeholder) {
    case "roomSlug": {
      const roomId = substitution.roomId;
      return roomId === null ? null : ROOM_SLUG[roomId] ?? null;
    }
    case "weatherSlug": {
      const weatherId = substitution.weatherId;
      return weatherId === null ? null : WEATHER_SLUG[weatherId] ?? null;
    }
    case "bossCanonicalId":
      return substitution.bossCanonicalId;
    case "bossSlug": {
      const bossCanonicalId = substitution.bossCanonicalId;
      if (bossCanonicalId === null || !bossCanonicalId.startsWith(BOSS_CANONICAL_PREFIX)) {
        return null;
      }
      return bossCanonicalId.slice(BOSS_CANONICAL_PREFIX.length);
    }
    case "phaseIndex":
      return substitution.phaseIndex === null ? null : String(substitution.phaseIndex);
    default:
      return null;
  }
}

export type FeedbackResolvedVia = "literal" | "selector" | "fallback";

interface ResolvedId {
  readonly id: string;
  readonly via: FeedbackResolvedVia;
  readonly mix: "mono" | null;
}

function resolveId(
  spec: ResolverSpec,
  kind: FeedbackCueKind,
  substitution: CueSubstitution,
): ResolvedId | null {
  if (spec.shape === "haptic") return null;
  if (spec.shape === "literal") {
    return Object.freeze({id: spec.id, via: "literal" as const, mix: null});
  }
  let candidate: string | null = spec.selector;
  for (const placeholder of spec.placeholders) {
    const value = placeholderValue(placeholder, substitution);
    if (value === null) {
      candidate = null;
      break;
    }
    candidate = candidate.split(`{${placeholder}}`).join(value);
  }
  if (candidate !== null && idExistsForKind(kind, candidate)) {
    return Object.freeze({id: candidate, via: "selector" as const, mix: spec.mix});
  }
  return Object.freeze({id: spec.fallback, via: "fallback" as const, mix: spec.mix});
}

/* ------------------------------------------------------------------ *
 * The narrative projection context.
 *
 * Predicates that read gameplay state are NOT evaluated here — that would be
 * a second narrative authority. The conductor already owns them; the caller
 * passes the facts it has already committed. Every field defaults to absent,
 * and an absent fact projects nothing: authored silence, not a guess.
 * ------------------------------------------------------------------ */

export type FlowerBand = "QUIET" | "MIDDLE" | "LOUD";

export interface NarrativeProjectionContext {
  /** Band crossed by the flower.intensity.commit being consumed, if any. */
  readonly flowerBandEntered?: FlowerBand | null;
  /** GAZE_RECOVERY commit reached its authored target band. */
  readonly flowerRecoveryBandReached?: boolean;
  /** Available evidence crossed the current Override cost. */
  readonly evidenceThresholdReady?: boolean;
  /** narrative/room-thresholds-v4.json evaluated true after this commit. */
  readonly roomThresholdCommitted?: boolean;
  /** world-reaction-graph Cable node evaluated true. */
  readonly cableUploadBegan?: boolean;
  /** world-reaction-graph Cable/Burn-in node evaluated true. */
  readonly cableBurnInWrote?: boolean;
  /** witness-conditions evaluated true for an intensity commit. */
  readonly witnessConditionMet?: boolean;
  /** The No-Dusk guard is true for an ECLIPSE activation. */
  readonly noDuskGuardActive?: boolean;
}

const EMPTY_CONTEXT: NarrativeProjectionContext = Object.freeze({});

interface PredicateInput {
  readonly event: CanonicalGameplayEvent;
  readonly payload: Readonly<Record<string, JsonValue>>;
  readonly context: NarrativeProjectionContext;
  readonly claimEvidenceKey: (key: string) => boolean;
}

type NarrativePredicate = (input: PredicateInput) => boolean;

function bandPredicate(band: FlowerBand): NarrativePredicate {
  return ({context}) => context.flowerBandEntered === band;
}

function weatherPredicate(weatherId: string): NarrativePredicate {
  return ({payload}) => payload["weather"] === weatherId;
}

/**
 * Only the non-identity predicates need an evaluator; `identity` is read from
 * the manifest and needs no code. Module load asserts this table covers exactly
 * the non-identity rules, so a new authored predicate fails closed rather than
 * silently never firing.
 */
const NARRATIVE_PREDICATES: Readonly<Record<string, NarrativePredicate>> = Object.freeze({
  "flower.band.enter.quiet": bandPredicate("QUIET"),
  "flower.band.enter.middle": bandPredicate("MIDDLE"),
  "flower.band.enter.loud": bandPredicate("LOUD"),
  "flower.recovery.complete": ({payload, context}) =>
    payload["source"] === "GAZE_RECOVERY" && context.flowerRecoveryBandReached === true,
  "gaze.clamp.pulse": () => false, // driven by the authored presentation cadence below
  "graze.evidence.accepted": ({event, payload, claimEvidenceKey}) => {
    if (event.id === "projectile.graze.commit") {
      const projectileId = payloadString(payload, "projectileId");
      if (projectileId === null) return false;
      const generation = payload["projectileGeneration"];
      return claimEvidenceKey(`projectile:${projectileId}:${String(generation)}`);
    }
    const sourceKey = payloadString(payload, "sourceKey");
    return sourceKey !== null && claimEvidenceKey(`evidence:${sourceKey}`);
  },
  "evidence.threshold.ready": ({context}) => context.evidenceThresholdReady === true,
  "overrideScar.materialize": ({payload}) => payload["scarType"] === "overrideScar",
  "room.threshold.commit": ({context}) => context.roomThresholdCommitted === true,
  "cable.upload.begin": ({context}) => context.cableUploadBegan === true,
  "cable.burnIn.write": ({context}) => context.cableBurnInWrote === true,
  "burnIn.capture": ({payload}) => {
    const counts = payload["materialCounts"];
    if (!isRecord(counts)) return false;
    const burnIn = counts["burnIn"];
    return typeof burnIn === "number" && burnIn > 0;
  },
  "witness.turn": ({event, context}) =>
    event.id === "witness.turn" || context.witnessConditionMet === true,
  "snapshot.handoff": ({payload}) => payloadString(payload, "snapshotHash") !== null,
  "noDusk.binaryTimeCut.begin": ({event, payload, context}) => {
    if (event.id === "boss.phase.swap") return payload["bossId"] === "boss.no_dusk";
    return payload["weather"] === "ECLIPSE" && context.noDuskGuardActive === true;
  },
  "weather.STATIC.phase": weatherPredicate("STATIC"),
  "weather.RAIN.phase": weatherPredicate("RAIN"),
  "weather.ASH.phase": weatherPredicate("ASH"),
  "weather.WIND.phase": weatherPredicate("WIND"),
  "weather.ECLIPSE.phase": weatherPredicate("ECLIPSE"),
});

(() => {
  const declared = new Set(Object.keys(NARRATIVE_PREDICATES));
  for (const rule of NARRATIVE_PROJECTIONS) {
    if (rule.identity) {
      if (declared.has(rule.narrativeEvent)) {
        throw new Error(`identity projection ${rule.narrativeEvent} must not carry a predicate`);
      }
      continue;
    }
    if (!declared.delete(rule.narrativeEvent)) {
      throw new Error(`authored predicate has no evaluator: ${rule.narrativeEvent}`);
    }
  }
  if (declared.size > 0) {
    throw new Error(`predicate evaluators without an authored rule: ${[...declared].join(", ")}`);
  }
})();

/**
 * The gaze pulse is a presentation cadence, authored as "every >=700ms while
 * clamped; emits no gameplay fact". Milliseconds become a tick count by
 * round-up, the same rule gameplay time uses.
 */
const GAZE_PULSE_INTERVAL_MS = 700;
const TICKS_PER_SECOND = 120;
const GAZE_PULSE_INTERVAL_TICKS = Math.ceil(GAZE_PULSE_INTERVAL_MS * TICKS_PER_SECOND / 1000);
const GAZE_PULSE_NARRATIVE_EVENT = "gaze.clamp.pulse";

/* ------------------------------------------------------------------ *
 * Cue batch — the frozen output.
 * ------------------------------------------------------------------ */

interface FeedbackCueBase {
  readonly source: "runtime" | "narrative";
  /** Runtime bindingId, or the narrative cueId for a projected cue. */
  readonly bindingId: string;
  readonly cueId: string;
  /** Canonical event id, or the narrative event name for a projected cue. */
  readonly eventName: string;
  readonly canonicalEventId: string;
  readonly occurrenceKey: string;
  readonly tick120: number;
  readonly dedupeKey: string;
  /** Empty when the base resolver was used. */
  readonly accessibilityConditions: readonly string[];
  readonly resolvedVia: FeedbackResolvedVia;
}

export interface FeedbackVisualCue extends FeedbackCueBase {
  readonly kind: "visual";
  readonly frameId: string;
  readonly frame: V4FrameBinding;
}

export interface FeedbackAudioCue extends FeedbackCueBase {
  readonly kind: "audio";
  readonly audioId: string;
  readonly asset: V4AudioAsset;
  readonly bus: V4AudioBus;
  readonly mix: "mono" | null;
}

export interface FeedbackUiCue extends FeedbackCueBase {
  readonly kind: "ui";
  readonly uiCueId: string;
  /** Authored prose for a narrative cue; empty for a runtime cue. */
  readonly note: string;
}

export interface FeedbackHapticCue extends FeedbackCueBase {
  readonly kind: "haptic";
  readonly pulses: readonly FeedbackHapticPulse[];
}

export interface FeedbackSilentEvent {
  readonly canonicalEventId: string;
  readonly occurrenceKey: string;
  readonly tick120: number;
}

export interface FeedbackCueBatch {
  readonly tick120: number;
  readonly consumedEventCount: number;
  readonly visual: readonly FeedbackVisualCue[];
  readonly audio: readonly FeedbackAudioCue[];
  readonly ui: readonly FeedbackUiCue[];
  readonly haptic: readonly FeedbackHapticCue[];
  /** Consumed events that no binding claims. Observable authored silence. */
  readonly silent: readonly FeedbackSilentEvent[];
}

const EMPTY_BATCH_LISTS = Object.freeze({
  visual: Object.freeze([]) as readonly FeedbackVisualCue[],
  audio: Object.freeze([]) as readonly FeedbackAudioCue[],
  ui: Object.freeze([]) as readonly FeedbackUiCue[],
  haptic: Object.freeze([]) as readonly FeedbackHapticCue[],
  silent: Object.freeze([]) as readonly FeedbackSilentEvent[],
});

/**
 * The read-only port this subscriber needs from the canonical event bus. It is
 * deliberately narrower than CanonicalEventBus: there is no enqueue, no flush,
 * no way for presentation to reach authority.
 */
export interface FeedbackEventSource {
  committedEventCount(): number;
  committedEventsFrom(startIndex: number): readonly CanonicalGameplayEvent[];
}

export interface FeedbackSubscriberOptions {
  readonly accessibility?: FeedbackAccessibilityProfile;
}

export class FeedbackSubscriber {
  #cursor = 0;
  #tick120 = -1;
  #accessibility: FeedbackAccessibilityProfile;
  #gazeClamped = false;
  #nextGazePulseTick = 0;
  #gazeClampEvent: CanonicalGameplayEvent | null = null;
  readonly #evidenceKeys = new Set<string>();

  constructor(options: FeedbackSubscriberOptions = {}) {
    this.#accessibility = options.accessibility === undefined
      ? DEFAULT_ACCESSIBILITY_PROFILE
      : normalizeAccessibilityProfile(options.accessibility);
  }

  /** Index of the next committed event this subscriber will read. */
  get consumedSequence(): number {
    return this.#cursor;
  }

  get accessibility(): FeedbackAccessibilityProfile {
    return this.#accessibility;
  }

  /**
   * Presentation-only. Changing this may only change which authored resolver a
   * cue uses; it can never change which events are consumed, at which tick, or
   * in which order.
   */
  setAccessibilityProfile(profile: FeedbackAccessibilityProfile): void {
    this.#accessibility = normalizeAccessibilityProfile(profile);
  }

  /**
   * Consume every committed event appended since the last call and return the
   * cue batch for this tick. Each event is read exactly once: the cursor only
   * ever moves forward by the number of events actually handed over.
   */
  consumeTick(
    tick120: number,
    source: FeedbackEventSource,
    context: NarrativeProjectionContext = EMPTY_CONTEXT,
  ): FeedbackCueBatch {
    if (!Number.isSafeInteger(tick120) || tick120 < 0) {
      throw new Error(`feedback tick120 must be a non-negative safe integer: ${String(tick120)}`);
    }
    if (tick120 < this.#tick120) {
      throw new Error(
        `feedback tick120 must not move backward: ${this.#tick120} -> ${tick120}`,
      );
    }
    this.#tick120 = tick120;

    const events = source.committedEventsFrom(this.#cursor);
    this.#cursor += events.length;

    const visual: FeedbackVisualCue[] = [];
    const audio: FeedbackAudioCue[] = [];
    const ui: FeedbackUiCue[] = [];
    const haptic: FeedbackHapticCue[] = [];
    const silent: FeedbackSilentEvent[] = [];

    for (const event of events) {
      if (!isCanonicalEventId(event.id)) {
        throw new Error(`feedback received a non-canonical gameplay event id: ${String(event.id)}`);
      }
      const before = visual.length + audio.length + ui.length + haptic.length;
      this.#trackGazeClamp(event);
      this.#emitRuntimeCues(event, visual, audio, ui, haptic);
      this.#emitNarrativeCues(event, context, visual, audio, ui);
      if (visual.length + audio.length + ui.length + haptic.length === before) {
        silent.push(Object.freeze({
          canonicalEventId: event.id,
          occurrenceKey: event.occurrenceKey,
          tick120: event.tick120,
        }));
      }
    }

    this.#emitGazePulse(tick120, visual, audio, ui);

    return Object.freeze({
      tick120,
      consumedEventCount: events.length,
      visual: visual.length === 0 ? EMPTY_BATCH_LISTS.visual : Object.freeze(visual),
      audio: audio.length === 0 ? EMPTY_BATCH_LISTS.audio : Object.freeze(audio),
      ui: ui.length === 0 ? EMPTY_BATCH_LISTS.ui : Object.freeze(ui),
      haptic: haptic.length === 0 ? EMPTY_BATCH_LISTS.haptic : Object.freeze(haptic),
      silent: silent.length === 0 ? EMPTY_BATCH_LISTS.silent : Object.freeze(silent),
    });
  }

  /* -------------------------------------------------------------- */

  #trackGazeClamp(event: CanonicalGameplayEvent): void {
    if (event.id === "gaze.clamp.commit") {
      this.#gazeClamped = true;
      this.#gazeClampEvent = event;
      this.#nextGazePulseTick = event.tick120;
      return;
    }
    if (event.id === "gaze.clamp.release") {
      this.#gazeClamped = false;
      this.#gazeClampEvent = null;
    }
  }

  #emitGazePulse(
    tick120: number,
    visual: FeedbackVisualCue[],
    audio: FeedbackAudioCue[],
    ui: FeedbackUiCue[],
  ): void {
    if (!this.#gazeClamped) return;
    const anchor = this.#gazeClampEvent;
    if (anchor === null || tick120 < this.#nextGazePulseTick) return;
    const cue = NARRATIVE_CUE_BY_EVENT.get(GAZE_PULSE_NARRATIVE_EVENT);
    if (cue === undefined) return;
    this.#nextGazePulseTick = tick120 + GAZE_PULSE_INTERVAL_TICKS;
    this.#pushNarrativeCue(
      cue,
      anchor,
      `${cue.cueId}:pulse:${tick120}`,
      tick120,
      visual,
      audio,
      ui,
    );
  }

  #emitRuntimeCues(
    event: CanonicalGameplayEvent,
    visual: FeedbackVisualCue[],
    audio: FeedbackAudioCue[],
    ui: FeedbackUiCue[],
    haptic: FeedbackHapticCue[],
  ): void {
    const bindings = RUNTIME_BINDINGS_BY_EVENT.get(event.id);
    if (bindings === undefined) return;
    const substitution = deriveSubstitution(event);
    for (const binding of bindings) {
      const matched = binding.fallbackResolver === null
        ? Object.freeze([])
        : conditionsHold(binding.fallbackConditions, this.#accessibility);
      const useFallback = matched.length > 0 && binding.fallbackResolver !== null;
      const spec = useFallback && binding.fallbackResolver !== null
        ? binding.fallbackResolver
        : binding.resolver;
      const cueId = useFallback && binding.fallbackCueId !== null
        ? binding.fallbackCueId
        : binding.cueId;
      const base = {
        source: "runtime" as const,
        bindingId: binding.bindingId,
        cueId,
        eventName: event.id,
        canonicalEventId: event.id,
        occurrenceKey: event.occurrenceKey,
        tick120: event.tick120,
        dedupeKey: `${binding.bindingId}:${event.occurrenceKey}`,
        accessibilityConditions: matched,
      };

      if (binding.kind === "haptic") {
        if (spec.shape !== "haptic") continue;
        // `haptics:off` is an authored axis value, so suppressing the pulse is
        // authored silence, not an invented policy.
        if (this.#accessibility["haptics"] === "off") continue;
        haptic.push(Object.freeze({
          ...base,
          kind: "haptic" as const,
          resolvedVia: "literal" as const,
          pulses: spec.pulses,
        }));
        continue;
      }

      const resolved = resolveId(spec, binding.kind, substitution);
      if (resolved === null) continue;
      if (binding.kind === "visual") {
        const frame = v4FrameOrNull(resolved.id);
        if (frame === null) continue; // unbound frame is silence, never a substitute
        visual.push(Object.freeze({
          ...base,
          kind: "visual" as const,
          resolvedVia: resolved.via,
          frameId: resolved.id,
          frame,
        }));
        continue;
      }
      if (binding.kind === "audio") {
        const asset = v4AudioOrNull(resolved.id);
        if (asset === null) continue;
        audio.push(Object.freeze({
          ...base,
          kind: "audio" as const,
          resolvedVia: resolved.via,
          audioId: resolved.id,
          asset,
          bus: asset.bus,
          mix: resolved.mix,
        }));
        continue;
      }
      ui.push(Object.freeze({
        ...base,
        kind: "ui" as const,
        resolvedVia: resolved.via,
        uiCueId: resolved.id,
        note: "",
      }));
    }
  }

  #emitNarrativeCues(
    event: CanonicalGameplayEvent,
    context: NarrativeProjectionContext,
    visual: FeedbackVisualCue[],
    audio: FeedbackAudioCue[],
    ui: FeedbackUiCue[],
  ): void {
    const rules = PROJECTIONS_BY_SOURCE.get(event.id);
    if (rules === undefined) return;
    const payload = event.payload as Readonly<Record<string, JsonValue>>;
    const input: PredicateInput = {
      event,
      payload,
      context,
      claimEvidenceKey: (key: string): boolean => {
        if (this.#evidenceKeys.has(key)) return false;
        this.#evidenceKeys.add(key);
        return true;
      },
    };
    for (const rule of rules) {
      if (!rule.identity) {
        const predicate = NARRATIVE_PREDICATES[rule.narrativeEvent];
        if (predicate === undefined || !predicate(input)) continue;
      }
      const cue = NARRATIVE_CUE_BY_EVENT.get(rule.narrativeEvent);
      if (cue === undefined) continue;
      this.#pushNarrativeCue(
        cue,
        event,
        `${cue.cueId}:${event.occurrenceKey}`,
        event.tick120,
        visual,
        audio,
        ui,
      );
    }
  }

  #pushNarrativeCue(
    cue: NarrativeCueBinding,
    event: CanonicalGameplayEvent,
    dedupeKey: string,
    tick120: number,
    visual: FeedbackVisualCue[],
    audio: FeedbackAudioCue[],
    ui: FeedbackUiCue[],
  ): void {
    const substitution = deriveSubstitution(event);
    const base = {
      source: "narrative" as const,
      bindingId: cue.cueId,
      cueId: cue.cueId,
      eventName: cue.narrativeEvent,
      canonicalEventId: event.id,
      occurrenceKey: event.occurrenceKey,
      tick120,
      dedupeKey,
      accessibilityConditions: Object.freeze([]) as readonly string[],
    };
    const frameResolution = resolveId(cue.frame, "visual", substitution);
    if (frameResolution !== null) {
      const frame = v4FrameOrNull(frameResolution.id);
      if (frame !== null) {
        visual.push(Object.freeze({
          ...base,
          kind: "visual" as const,
          resolvedVia: frameResolution.via,
          frameId: frameResolution.id,
          frame,
        }));
      }
    }
    const audioResolution = resolveId(cue.audio, "audio", substitution);
    if (audioResolution !== null) {
      const asset = v4AudioOrNull(audioResolution.id);
      if (asset !== null) {
        audio.push(Object.freeze({
          ...base,
          kind: "audio" as const,
          resolvedVia: audioResolution.via,
          audioId: audioResolution.id,
          asset,
          bus: asset.bus,
          mix: audioResolution.mix,
        }));
      }
    }
    // The narrative UI column is authored prose, carried verbatim so the HUD can
    // bind it. "none" is an authored absence and emits nothing.
    if (cue.uiNote !== "none") {
      ui.push(Object.freeze({
        ...base,
        kind: "ui" as const,
        resolvedVia: "literal" as const,
        uiCueId: cue.cueId,
        note: cue.uiNote,
      }));
    }
  }
}

/* ------------------------------------------------------------------ *
 * Read-only introspection for tests and for the layers that bind cues.
 * ------------------------------------------------------------------ */

export const FEEDBACK_RUNTIME_BINDINGS = RUNTIME_BINDINGS;
export const FEEDBACK_NARRATIVE_CUES = NARRATIVE_CUES;
export const FEEDBACK_NARRATIVE_PROJECTIONS = NARRATIVE_PROJECTIONS;
export const FEEDBACK_ROOM_SLUGS = ROOM_SLUG;
export const FEEDBACK_WEATHER_SLUGS = WEATHER_SLUG;
export const FEEDBACK_BOSS_PHASE_ORDER = BOSS_PHASE_ORDER;
export const FEEDBACK_GAZE_PULSE_INTERVAL_TICKS = GAZE_PULSE_INTERVAL_TICKS;
