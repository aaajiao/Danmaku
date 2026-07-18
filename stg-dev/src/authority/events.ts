import eventSchemaJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/runtime/event-schema-v4.json";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

declare const canonicalEventIdBrand: unique symbol;

/**
 * A V4 event ID validated against the sole canonical registry. The brand keeps
 * arbitrary strings out of committed envelopes without copying the 72 IDs into
 * a second TypeScript catalog.
 */
export type CanonicalEventId = string & {
  readonly [canonicalEventIdBrand]: "CanonicalEventId";
};

export type EventCriticality = "critical" | "support";

export interface CanonicalEventDefinition {
  readonly id: CanonicalEventId;
  readonly domain: string;
  readonly criticality: EventCriticality;
  readonly requiredPayload: readonly string[];
}

export const EVENT_PHASE_PRIORITY = Object.freeze({
  collisionDisable: 0,
  stateOrDamageCommit: 1,
  collisionEnable: 2,
  entitySpawn: 3,
  feedbackDispatch: 4,
} as const);

export type GameplayPhasePriority =
  | typeof EVENT_PHASE_PRIORITY.collisionDisable
  | typeof EVENT_PHASE_PRIORITY.stateOrDamageCommit
  | typeof EVENT_PHASE_PRIORITY.collisionEnable
  | typeof EVENT_PHASE_PRIORITY.entitySpawn;

export interface CanonicalGameplayEvent {
  readonly id: CanonicalEventId;
  readonly authority: "gameplay";
  readonly tick120: number;
  readonly simulationTimeMs: number;
  readonly phasePriority: GameplayPhasePriority;
  readonly entityStableId: string;
  readonly localSequence: number;
  readonly sequence: number;
  readonly occurrenceKey: string;
  readonly payload: JsonObject;
}

export interface GameplayEventDraft {
  readonly id: string;
  readonly tick120: number;
  readonly entityStableId: string;
  readonly localSequence: number;
  readonly occurrenceKey: string;
  readonly payload: unknown;
}

export interface FeedbackDispatchContext {
  readonly tick120: number;
  readonly phasePriority: typeof EVENT_PHASE_PRIORITY.feedbackDispatch;
}

/**
 * A presentation-only terminal edge. It receives no authority command port,
 * and the bus rejects re-entrant gameplay writes while this callback runs.
 */
export interface ReadonlyFeedbackSink {
  consume(event: CanonicalGameplayEvent, context: FeedbackDispatchContext): void;
}

interface ParsedEventSchema {
  readonly schemaVersion: string;
  readonly schemaId: string;
  readonly envelopeRequired: readonly string[];
  readonly envelopeTypes: Readonly<Record<string, string>>;
  readonly ids: readonly CanonicalEventId[];
  readonly registry: Readonly<Record<string, CanonicalEventDefinition>>;
}

interface PendingEvent {
  readonly id: CanonicalEventId;
  readonly tick120: number;
  readonly simulationTimeMs: number;
  readonly phasePriority: GameplayPhasePriority;
  readonly entityStableId: string;
  readonly localSequence: number;
  readonly occurrenceKey: string;
  readonly payload: JsonObject;
  readonly insertionIndex: number;
}

const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  return value;
}

function requireNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function requireNonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || Object.is(value, -0)) {
    throw new Error(`${path} must be a non-negative safe integer`);
  }
  return value as number;
}

function parseStringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  const result = value.map((entry, index) => requireNonEmptyString(entry, `${path}[${index}]`));
  return Object.freeze(result);
}

const SUPPORTED_ENVELOPE_TYPE_DESCRIPTORS = new Set([
  "catalog-event-id",
  "literal:gameplay",
  "finite-number>=0",
  "integer>=0",
  "non-empty-unique-string",
  "json-object",
]);

function parseEventSchema(value: unknown): ParsedEventSchema {
  const schema = requireRecord(value, "event schema");
  const schemaVersion = requireNonEmptyString(schema.schemaVersion, "event schema.schemaVersion");
  const schemaId = requireNonEmptyString(schema.id, "event schema.id");
  const envelope = requireRecord(schema.envelope, "event schema.envelope");
  if (envelope.authority !== "gameplay") {
    throw new Error("event schema envelope authority must be gameplay");
  }

  const envelopeRequired = parseStringArray(envelope.required, "event schema.envelope.required");
  const rawTypes = requireRecord(envelope.types, "event schema.envelope.types");
  const envelopeTypes: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const field of envelopeRequired) {
    const descriptor = requireNonEmptyString(rawTypes[field], `event schema.envelope.types.${field}`);
    if (!SUPPORTED_ENVELOPE_TYPE_DESCRIPTORS.has(descriptor)) {
      throw new Error(`unsupported V4 envelope type descriptor: ${descriptor}`);
    }
    envelopeTypes[field] = descriptor;
  }

  if (!Array.isArray(schema.events)) throw new Error("event schema.events must be an array");
  const ids: CanonicalEventId[] = [];
  const registry: Record<string, CanonicalEventDefinition> = Object.create(null) as Record<
    string,
    CanonicalEventDefinition
  >;
  for (const [index, rawDefinition] of schema.events.entries()) {
    const definition = requireRecord(rawDefinition, `event schema.events[${index}]`);
    const rawId = requireNonEmptyString(definition.id, `event schema.events[${index}].id`);
    if (registry[rawId] !== undefined) throw new Error(`duplicate canonical event id: ${rawId}`);
    const id = rawId as CanonicalEventId;
    const domain = requireNonEmptyString(definition.domain, `event schema.events[${index}].domain`);
    if (definition.criticality !== "critical" && definition.criticality !== "support") {
      throw new Error(`event schema.events[${index}].criticality is invalid`);
    }
    const requiredPayload = parseStringArray(
      definition.requiredPayload,
      `event schema.events[${index}].requiredPayload`,
    );
    if (new Set(requiredPayload).size !== requiredPayload.length) {
      throw new Error(`duplicate required payload field for canonical event: ${rawId}`);
    }
    const frozenDefinition = Object.freeze({
      id,
      domain,
      criticality: definition.criticality,
      requiredPayload,
    });
    ids.push(id);
    registry[id] = frozenDefinition;
  }

  return Object.freeze({
    schemaVersion,
    schemaId,
    envelopeRequired,
    envelopeTypes: Object.freeze(envelopeTypes),
    ids: Object.freeze(ids),
    registry: Object.freeze(registry),
  });
}

const PARSED_SCHEMA = parseEventSchema(eventSchemaJson);

export const EVENT_SCHEMA_VERSION = PARSED_SCHEMA.schemaVersion;
export const EVENT_SCHEMA_ID = PARSED_SCHEMA.schemaId;
export const V4_ENVELOPE_REQUIRED_FIELDS = PARSED_SCHEMA.envelopeRequired;
export const CANONICAL_EVENT_IDS = PARSED_SCHEMA.ids;
export const CANONICAL_EVENT_REGISTRY = PARSED_SCHEMA.registry;

export function isCanonicalEventId(value: unknown): value is CanonicalEventId {
  return typeof value === "string" && CANONICAL_EVENT_REGISTRY[value] !== undefined;
}

export function requireCanonicalEventId(value: unknown): CanonicalEventId {
  if (!isCanonicalEventId(value)) throw new Error(`unknown canonical gameplay event id: ${String(value)}`);
  return value;
}

/** Derive scheduling phase without creating a second event-domain taxonomy. */
export function phasePriorityFor(id: CanonicalEventId): GameplayPhasePriority {
  if (id.endsWith(".collision.off")) return EVENT_PHASE_PRIORITY.collisionDisable;
  if (id.endsWith(".collision.on")) return EVENT_PHASE_PRIORITY.collisionEnable;
  if (id.endsWith(".spawn.commit")) return EVENT_PHASE_PRIORITY.entitySpawn;
  return EVENT_PHASE_PRIORITY.stateOrDamageCommit;
}

export function simulationTimeMsForTick(tick120: number): number {
  const tick = requireNonNegativeInteger(tick120, "tick120");
  return tick * 1000 / 120;
}

function canonicalizeJson(value: unknown, path: string, ancestors = new WeakSet<object>()): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} contains a non-finite number`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") throw new Error(`${path} contains a non-JSON value`);
  if (ancestors.has(value)) throw new Error(`${path} contains a cycle`);
  ancestors.add(value);

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!hasOwn(value, index)) throw new Error(`${path} contains a sparse array`);
    }
    const result = value.map((entry, index) => canonicalizeJson(entry, `${path}[${index}]`, ancestors));
    ancestors.delete(value);
    return Object.freeze(result);
  }

  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${path} must contain only plain JSON objects`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error(`${path} contains symbol keys`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  for (const key of Object.keys(descriptors).sort()) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !descriptor.enumerable) continue;
    if (!("value" in descriptor)) throw new Error(`${path}.${key} must not be an accessor`);
    result[key] = canonicalizeJson(descriptor.value, `${path}.${key}`, ancestors);
  }
  ancestors.delete(value);
  return Object.freeze(result);
}

function canonicalizePayload(value: unknown): JsonObject {
  const canonical = canonicalizeJson(value, "payload");
  if (canonical === null || Array.isArray(canonical) || typeof canonical !== "object") {
    throw new Error("payload must be a JSON object");
  }
  return canonical as JsonObject;
}

function assertRequiredPayload(definition: CanonicalEventDefinition, payload: JsonObject): void {
  for (const field of definition.requiredPayload) {
    if (!hasOwn(payload, field)) {
      throw new Error(`event ${definition.id} is missing required payload field: ${field}`);
    }
  }
}

function validateSchemaEnvelopeFields(envelope: Record<string, unknown>): void {
  for (const field of V4_ENVELOPE_REQUIRED_FIELDS) {
    if (!hasOwn(envelope, field)) throw new Error(`event envelope is missing required field: ${field}`);
    const value = envelope[field];
    const descriptor = PARSED_SCHEMA.envelopeTypes[field];
    switch (descriptor) {
      case "catalog-event-id":
        requireCanonicalEventId(value);
        break;
      case "literal:gameplay":
        if (value !== "gameplay") throw new Error("event authority must be gameplay");
        break;
      case "finite-number>=0":
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
          throw new Error(`${field} must be finite and non-negative`);
        }
        break;
      case "integer>=0":
        requireNonNegativeInteger(value, field);
        break;
      case "non-empty-unique-string":
        requireNonEmptyString(value, field);
        break;
      case "json-object":
        canonicalizePayload(value);
        break;
      default:
        throw new Error(`unsupported V4 envelope field descriptor: ${String(descriptor)}`);
    }
  }
}

export function assertCanonicalEventEnvelope(value: unknown): asserts value is CanonicalGameplayEvent {
  const envelope = requireRecord(value, "event envelope");
  validateSchemaEnvelopeFields(envelope);
  const id = requireCanonicalEventId(envelope.id);
  const tick120 = requireNonNegativeInteger(envelope.tick120, "tick120");
  const phasePriority = requireNonNegativeInteger(envelope.phasePriority, "phasePriority");
  if (phasePriority !== phasePriorityFor(id)) {
    throw new Error(`event ${id} has an invalid phasePriority`);
  }
  requireNonEmptyString(envelope.entityStableId, "entityStableId");
  requireNonNegativeInteger(envelope.localSequence, "localSequence");
  if (envelope.simulationTimeMs !== simulationTimeMsForTick(tick120)) {
    throw new Error("simulationTimeMs must be derived exactly from tick120");
  }
  const payload = canonicalizePayload(envelope.payload);
  const definition = CANONICAL_EVENT_REGISTRY[id];
  if (definition === undefined) throw new Error(`unknown canonical gameplay event id: ${id}`);
  assertRequiredPayload(definition, payload);
}

function comparePending(a: PendingEvent, b: PendingEvent): number {
  return a.tick120 - b.tick120
    || a.phasePriority - b.phasePriority
    || compareStableId(a.entityStableId, b.entityStableId)
    || a.localSequence - b.localSequence
    || a.insertionIndex - b.insertionIndex;
}

function compareCommitted(a: CanonicalGameplayEvent, b: CanonicalGameplayEvent): number {
  return a.tick120 - b.tick120
    || a.phasePriority - b.phasePriority
    || compareStableId(a.entityStableId, b.entityStableId)
    || a.localSequence - b.localSequence
    || a.sequence - b.sequence;
}

function compareStableId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value, "canonical serialization"));
}

export function serializeCanonicalEvents(events: readonly CanonicalGameplayEvent[]): string {
  const occurrenceKeys = new Set<string>();
  for (const event of events) {
    assertCanonicalEventEnvelope(event);
    if (occurrenceKeys.has(event.occurrenceKey)) {
      throw new Error(`duplicate authoritative occurrence key: ${event.occurrenceKey}`);
    }
    occurrenceKeys.add(event.occurrenceKey);
  }
  return canonicalStringify(events.slice().sort(compareCommitted));
}

/**
 * Tick-atomic ordered authority bus. Callers enqueue every fact for a tick,
 * then flush once; feedback is dispatched only after gameplay envelopes commit.
 */
export class CanonicalEventBus {
  private readonly pending: PendingEvent[] = [];
  private readonly committed: CanonicalGameplayEvent[] = [];
  private readonly occurrenceKeys = new Set<string>();
  private nextSequence = 0;
  private nextInsertionIndex = 0;
  private lastFlushedTick = -1;
  private feedbackDispatching = false;

  enqueue(draft: GameplayEventDraft): void {
    this.enqueueBatch([draft]);
  }

  /**
   * Validate a related set of authority facts before claiming any occurrence
   * key. This is the write primitive for state transitions whose envelopes and
   * in-memory mutation must either all commit or all remain untouched.
   */
  enqueueBatch(drafts: readonly GameplayEventDraft[]): void {
    if (this.feedbackDispatching) {
      throw new Error("feedback sinks cannot emit gameplay events");
    }
    if (!Array.isArray(drafts)) throw new Error("event batch must be an array");

    const batchOccurrenceKeys = new Set<string>();
    const pending = drafts.map((draft, index): PendingEvent => {
      const path = `event batch[${index}]`;
      const id = requireCanonicalEventId(draft?.id);
      const tick120 = requireNonNegativeInteger(draft?.tick120, `${path}.tick120`);
      if (tick120 <= this.lastFlushedTick) {
        throw new Error(`tick ${tick120} is already closed for authoritative writes`);
      }
      const entityStableId = requireNonEmptyString(draft?.entityStableId, `${path}.entityStableId`);
      const localSequence = requireNonNegativeInteger(draft?.localSequence, `${path}.localSequence`);
      const occurrenceKey = requireNonEmptyString(draft?.occurrenceKey, `${path}.occurrenceKey`);
      if (this.occurrenceKeys.has(occurrenceKey) || batchOccurrenceKeys.has(occurrenceKey)) {
        throw new Error(`duplicate authoritative occurrence key: ${occurrenceKey}`);
      }
      batchOccurrenceKeys.add(occurrenceKey);
      const payload = canonicalizePayload(draft?.payload);
      const definition = CANONICAL_EVENT_REGISTRY[id];
      if (definition === undefined) throw new Error(`unknown canonical gameplay event id: ${id}`);
      assertRequiredPayload(definition, payload);

      return Object.freeze({
        id,
        tick120,
        simulationTimeMs: simulationTimeMsForTick(tick120),
        phasePriority: phasePriorityFor(id),
        entityStableId,
        localSequence,
        occurrenceKey,
        payload,
        insertionIndex: this.nextInsertionIndex + index,
      });
    });

    for (const event of pending) this.occurrenceKeys.add(event.occurrenceKey);
    this.pending.push(...pending);
    this.nextInsertionIndex += pending.length;
  }

  flush(feedbackSinks: readonly ReadonlyFeedbackSink[] = []): readonly CanonicalGameplayEvent[] {
    if (this.feedbackDispatching) throw new Error("feedback sinks cannot flush gameplay events");
    if (this.pending.length === 0) return Object.freeze([]);

    const sorted = this.pending.slice().sort(comparePending);
    this.pending.length = 0;
    const flushed = sorted.map((pending) => {
      const event: CanonicalGameplayEvent = Object.freeze({
        id: pending.id,
        authority: "gameplay",
        tick120: pending.tick120,
        simulationTimeMs: pending.simulationTimeMs,
        phasePriority: pending.phasePriority,
        entityStableId: pending.entityStableId,
        localSequence: pending.localSequence,
        sequence: this.nextSequence,
        occurrenceKey: pending.occurrenceKey,
        payload: pending.payload,
      });
      this.nextSequence += 1;
      return event;
    });
    this.lastFlushedTick = sorted[sorted.length - 1]?.tick120 ?? this.lastFlushedTick;
    this.committed.push(...flushed);

    if (feedbackSinks.length > 0) {
      this.feedbackDispatching = true;
      try {
        for (const event of flushed) {
          const context = Object.freeze({
            tick120: event.tick120,
            phasePriority: EVENT_PHASE_PRIORITY.feedbackDispatch,
          });
          for (const sink of feedbackSinks) {
            if (typeof sink?.consume !== "function") throw new Error("feedback sink must provide consume()");
            const result: unknown = sink.consume(event, context);
            if (result !== undefined) {
              throw new Error("feedback sinks cannot return gameplay events or commands");
            }
          }
        }
      } finally {
        this.feedbackDispatching = false;
      }
    }

    return Object.freeze(flushed);
  }

  events(): readonly CanonicalGameplayEvent[] {
    return Object.freeze(this.committed.slice());
  }

  canonicalSerialization(): string {
    return serializeCanonicalEvents(this.committed);
  }
}
