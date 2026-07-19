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

/**
 * A single-owner capability for coordinators that close one authoritative tick
 * at a time. Holding the capability disables the bus's ambient `flush()` API.
 */
export interface CanonicalEventBusTickFlushAuthority {
  flushTick(
    tick120: number,
    feedbackSinks?: readonly ReadonlyFeedbackSink[],
  ): readonly CanonicalGameplayEvent[];
}

declare const canonicalEventBatchReceiptBrand: unique symbol;

/**
 * Opaque proof that one prepared draft group was accepted as part of a single
 * event-bus append. The receipt is bound to the exact bus and draft identities
 * and may be consumed by exactly one prepared authority mutation.
 */
export interface CanonicalEventBatchReceipt {
  readonly [canonicalEventBatchReceiptBrand]: "CanonicalEventBatchReceipt";
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

function captureDensePlainArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new Error(`${path} must be a plain array`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error(`${path} must not contain symbol keys`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const lengthDescriptor = descriptors["length"] as PropertyDescriptor | undefined;
  const lengthValue = lengthDescriptor !== undefined && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (
    lengthDescriptor === undefined
    || lengthValue === undefined
    || !Number.isSafeInteger(lengthValue)
    || (lengthValue as number) < 0
  ) {
    throw new Error(`${path}.length must be an own non-negative safe integer`);
  }
  const length = lengthValue as number;
  const expectedKeys = Array.from({length}, (_, index) => String(index)).sort(compareStableId);
  const actualKeys = Object.keys(descriptors)
    .filter((key) => key !== "length")
    .sort(compareStableId);
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error(`${path} must be dense and contain no metadata`);
  }
  const captured: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      descriptor === undefined
      || !("value" in descriptor)
      || descriptor.enumerable !== true
    ) {
      throw new Error(`${path}[${index}] must be an own enumerable data element`);
    }
    captured.push(descriptor.value);
  }
  return Object.freeze(captured);
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
    const captured = captureDensePlainArray(value, path);
    const result: JsonValue[] = [];
    for (let index = 0; index < captured.length; index += 1) {
      result.push(canonicalizeJson(captured[index], `${path}[${index}]`, ancestors));
    }
    ancestors.delete(value);
    return Object.freeze(result) as readonly JsonValue[];
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

const GAMEPLAY_EVENT_DRAFT_FIELDS = Object.freeze([
  "id",
  "tick120",
  "entityStableId",
  "localSequence",
  "occurrenceKey",
  "payload",
] as const);

function captureGameplayEventDraft(
  value: unknown,
  path: string,
): Readonly<Record<typeof GAMEPLAY_EVENT_DRAFT_FIELDS[number], unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be a plain event draft`);
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${path} must be a plain event draft`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error(`${path} must not contain symbol keys`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actualKeys = Object.keys(descriptors).sort(compareStableId);
  const expectedKeys = [...GAMEPLAY_EVENT_DRAFT_FIELDS].sort(compareStableId);
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error(`${path} field contract drifted`);
  }
  const captured = Object.create(null) as Record<
    typeof GAMEPLAY_EVENT_DRAFT_FIELDS[number],
    unknown
  >;
  for (const field of GAMEPLAY_EVENT_DRAFT_FIELDS) {
    const descriptor = descriptors[field];
    if (
      descriptor === undefined
      || !("value" in descriptor)
      || descriptor.enumerable !== true
    ) {
      throw new Error(`${path}.${field} must be an own enumerable data property`);
    }
    captured[field] = descriptor.value;
  }
  return Object.freeze(captured);
}

export function serializeCanonicalEvents(events: readonly CanonicalGameplayEvent[]): string {
  const captured = captureDensePlainArray(events, "canonical events");
  const occurrenceKeys = new Set<string>();
  const validated: CanonicalGameplayEvent[] = [];
  for (const value of captured) {
    const event = value as CanonicalGameplayEvent;
    assertCanonicalEventEnvelope(event);
    if (occurrenceKeys.has(event.occurrenceKey)) {
      throw new Error(`duplicate authoritative occurrence key: ${event.occurrenceKey}`);
    }
    occurrenceKeys.add(event.occurrenceKey);
    validated.push(event);
  }
  return canonicalStringify(validated.sort(compareCommitted));
}

const EXACT_CANONICAL_EVENT_BUS_INSTANCES = new WeakSet<object>();
interface CanonicalEventBatchReceiptRecord {
  readonly bus: CanonicalEventBus;
  readonly groupIdentity: readonly GameplayEventDraft[];
  readonly drafts: readonly unknown[];
  status: "prepared" | "accepted" | "rejected" | "consumed";
}

const CANONICAL_EVENT_BATCH_RECEIPTS = new WeakMap<
  CanonicalEventBatchReceipt,
  CanonicalEventBatchReceiptRecord
>();

/**
 * Consume one accepted append proof after checking exact bus and draft-group
 * identity. Authority modules call this immediately before their prevalidated,
 * allocation-free scalar after-state assignment.
 */
export function consumeCanonicalEventBatchReceipt(
  receipt: CanonicalEventBatchReceipt,
  expectedBus: CanonicalEventBus,
  expectedDraftsValue: readonly GameplayEventDraft[],
): void {
  const record = CANONICAL_EVENT_BATCH_RECEIPTS.get(receipt);
  if (record === undefined) throw new Error("event-batch receipt is not recognized");
  if (record.status !== "accepted") {
    throw new Error(`event-batch receipt is ${record.status}`);
  }
  if (record.bus !== expectedBus) throw new Error("event-batch receipt belongs to another bus");
  if (expectedDraftsValue !== record.groupIdentity) {
    throw new Error("event-batch receipt does not cover the prepared draft group");
  }
  const expectedDrafts = captureDensePlainArray(
    expectedDraftsValue,
    "event-batch receipt expected drafts",
  );
  if (
    expectedDrafts.length !== record.drafts.length
    || expectedDrafts.some((draft, index) => draft !== record.drafts[index])
  ) {
    throw new Error("event-batch receipt does not cover the prepared draft group");
  }
  record.status = "consumed";
}

const CANONICAL_EVENT_BUS_METHOD_NAMES = Object.freeze([
  "enqueue",
  "enqueueBatch",
  "enqueuePreparedBatch",
  "claimExclusiveTickFlush",
  "flush",
  "committedEventCount",
  "committedEventsFrom",
  "events",
  "canonicalSerialization",
] as const);

/** Reject subclasses and proxies at authority-composition boundaries. */
export function isExactCanonicalEventBus(value: unknown): value is CanonicalEventBus {
  return typeof value === "object"
    && value !== null
    && EXACT_CANONICAL_EVENT_BUS_INSTANCES.has(value)
    && Object.getPrototypeOf(value) === CanonicalEventBus.prototype;
}

/**
 * Tick-atomic ordered authority bus. Callers enqueue every fact for a tick,
 * then flush once; feedback is dispatched only after gameplay envelopes commit.
 */
export class CanonicalEventBus {
  readonly #pending: PendingEvent[] = [];
  readonly #committed: CanonicalGameplayEvent[] = [];
  readonly #occurrenceKeys = new Set<string>();
  #nextSequence = 0;
  #nextInsertionIndex = 0;
  #lastFlushedTick = -1;
  #feedbackDispatching = false;
  #enqueueLocked = false;
  #exclusiveFlushOwner: Readonly<{readonly id: string; readonly token: symbol}> | null = null;

  constructor() {
    if (new.target === CanonicalEventBus) EXACT_CANONICAL_EVENT_BUS_INSTANCES.add(this);
  }

  enqueue(draft: GameplayEventDraft): void {
    this.enqueueBatch([draft]);
  }

  /**
   * Validate a related set of authority facts before claiming any occurrence
   * key. This is event-append atomicity only; a caller composing multiple
   * mutable authorities must still prepare and commit those mutations together.
   */
  enqueueBatch(drafts: readonly GameplayEventDraft[]): void {
    if (this.#feedbackDispatching) {
      throw new Error("feedback sinks cannot emit gameplay events");
    }
    if (this.#enqueueLocked) throw new Error("event-bus enqueue validation is already in progress");
    this.#enqueueLocked = true;
    try {
      this.#enqueueBatchUnlocked(drafts);
    } finally {
      this.#enqueueLocked = false;
    }
  }

  /**
   * Append several prepared authority draft groups as one validated batch and
   * return one preallocated receipt per group. Receipts become accepted only
   * after the complete flattened batch has been appended.
   */
  enqueuePreparedBatch(
    draftGroupsValue: readonly (readonly GameplayEventDraft[])[],
  ): readonly CanonicalEventBatchReceipt[] {
    if (this.#feedbackDispatching) {
      throw new Error("feedback sinks cannot emit gameplay events");
    }
    if (this.#enqueueLocked) throw new Error("event-bus enqueue validation is already in progress");
    const capturedGroups = captureDensePlainArray(
      draftGroupsValue,
      "prepared event-batch groups",
    );
    if (capturedGroups.length === 0) {
      throw new Error("prepared event batch requires at least one draft group");
    }
    const groups = capturedGroups.map((group, index) => Object.freeze({
      identity: group as readonly GameplayEventDraft[],
      drafts: captureDensePlainArray(group, `prepared event-batch groups[${index}]`),
    }));
    const flattened = Object.freeze(
      groups.flatMap((group) => group.drafts),
    ) as readonly GameplayEventDraft[];
    const records: CanonicalEventBatchReceiptRecord[] = [];
    const receipts = groups.map((group): CanonicalEventBatchReceipt => {
      const receipt = Object.freeze(Object.create(null)) as CanonicalEventBatchReceipt;
      const record: CanonicalEventBatchReceiptRecord = {
        bus: this,
        groupIdentity: group.identity,
        drafts: group.drafts,
        status: "prepared",
      };
      records.push(record);
      CANONICAL_EVENT_BATCH_RECEIPTS.set(receipt, record);
      return receipt;
    });
    const frozenReceipts = Object.freeze(receipts);

    this.#enqueueLocked = true;
    try {
      this.#enqueueBatchUnlocked(flattened);
      for (const record of records) record.status = "accepted";
      return frozenReceipts;
    } catch (error) {
      for (const record of records) record.status = "rejected";
      throw error;
    } finally {
      this.#enqueueLocked = false;
    }
  }

  #enqueueBatchUnlocked(drafts: readonly GameplayEventDraft[]): void {
    const capturedDrafts = captureDensePlainArray(drafts, "event batch");

    const batchOccurrenceKeys = new Set<string>();
    const pending: PendingEvent[] = [];
    for (let index = 0; index < capturedDrafts.length; index += 1) {
      const draft = capturedDrafts[index];
      const path = `event batch[${index}]`;
      const captured = captureGameplayEventDraft(draft, path);
      const id = requireCanonicalEventId(captured.id);
      const tick120 = requireNonNegativeInteger(captured.tick120, `${path}.tick120`);
      if (tick120 <= this.#lastFlushedTick) {
        throw new Error(`tick ${tick120} is already closed for authoritative writes`);
      }
      if (
        this.#exclusiveFlushOwner !== null
        && tick120 !== this.#lastFlushedTick + 1
      ) {
        throw new Error(
          `leased event bus accepts only next tick ${this.#lastFlushedTick + 1}, received ${tick120}`,
        );
      }
      const entityStableId = requireNonEmptyString(captured.entityStableId, `${path}.entityStableId`);
      const localSequence = requireNonNegativeInteger(captured.localSequence, `${path}.localSequence`);
      const occurrenceKey = requireNonEmptyString(captured.occurrenceKey, `${path}.occurrenceKey`);
      if (this.#occurrenceKeys.has(occurrenceKey) || batchOccurrenceKeys.has(occurrenceKey)) {
        throw new Error(`duplicate authoritative occurrence key: ${occurrenceKey}`);
      }
      batchOccurrenceKeys.add(occurrenceKey);
      const payload = canonicalizePayload(captured.payload);
      const definition = CANONICAL_EVENT_REGISTRY[id];
      if (definition === undefined) throw new Error(`unknown canonical gameplay event id: ${id}`);
      assertRequiredPayload(definition, payload);

      pending.push(Object.freeze({
        id,
        tick120,
        simulationTimeMs: simulationTimeMsForTick(tick120),
        phasePriority: phasePriorityFor(id),
        entityStableId,
        localSequence,
        occurrenceKey,
        payload,
        insertionIndex: this.#nextInsertionIndex + index,
      }));
    }

    for (const event of pending) this.#occurrenceKeys.add(event.occurrenceKey);
    this.#pending.push(...pending);
    this.#nextInsertionIndex += pending.length;
  }

  /**
   * Permanently assign exact-tick closure to one coordinator. The bus must be
   * between ticks when claimed; `closedThroughTick120` becomes closed even if
   * no event was emitted there.
   */
  claimExclusiveTickFlush(
    ownerIdValue: string,
    closedThroughTick120Value: number,
  ): CanonicalEventBusTickFlushAuthority {
    if (this.#enqueueLocked) throw new Error("event-bus enqueue validation is already in progress");
    if (this.#feedbackDispatching) {
      throw new Error("feedback sinks cannot claim event-bus flush ownership");
    }
    const ownerId = requireNonEmptyString(ownerIdValue, "event-bus flush ownerId");
    const closedThroughTick120 = requireNonNegativeInteger(
      closedThroughTick120Value,
      "event-bus closedThroughTick120",
    );
    if (this.#exclusiveFlushOwner !== null) {
      throw new Error(`event-bus flush is already owned by ${this.#exclusiveFlushOwner.id}`);
    }
    if (this.#pending.length > 0) {
      throw new Error("event-bus flush ownership requires an empty pending queue");
    }
    if (closedThroughTick120 < this.#lastFlushedTick) {
      throw new Error(
        `event-bus cannot move its closed tick backward: ${this.#lastFlushedTick} -> ${closedThroughTick120}`,
      );
    }
    for (const methodName of CANONICAL_EVENT_BUS_METHOD_NAMES) {
      if (hasOwn(this, methodName)) {
        throw new Error(`event-bus authority method must not be shadowed: ${methodName}`);
      }
    }
    const token = Symbol(ownerId);
    this.#exclusiveFlushOwner = Object.freeze({id: ownerId, token});
    this.#lastFlushedTick = closedThroughTick120;
    Object.preventExtensions(this);
    return Object.freeze({
      flushTick: (
        tick120Value: number,
        feedbackSinks: readonly ReadonlyFeedbackSink[] = [],
      ): readonly CanonicalGameplayEvent[] => this.#flushOwnedTick(
        token,
        tick120Value,
        feedbackSinks,
      ),
    });
  }

  flush(feedbackSinks: readonly ReadonlyFeedbackSink[] = []): readonly CanonicalGameplayEvent[] {
    if (this.#enqueueLocked) throw new Error("event-bus enqueue validation is already in progress");
    if (this.#exclusiveFlushOwner !== null) {
      throw new Error(`event-bus flush is exclusively owned by ${this.#exclusiveFlushOwner.id}`);
    }
    return this.#commitPending(feedbackSinks, null);
  }

  #flushOwnedTick(
    token: symbol,
    tick120Value: number,
    feedbackSinks: readonly ReadonlyFeedbackSink[],
  ): readonly CanonicalGameplayEvent[] {
    if (this.#enqueueLocked) throw new Error("event-bus enqueue validation is already in progress");
    if (this.#feedbackDispatching) throw new Error("feedback sinks cannot flush gameplay events");
    if (this.#exclusiveFlushOwner?.token !== token) {
      throw new Error("event-bus tick flush capability is not the active owner");
    }
    const tick120 = requireNonNegativeInteger(tick120Value, "event-bus flush tick120");
    if (tick120 !== this.#lastFlushedTick + 1) {
      throw new Error(
        `event-bus owned flush must close next tick ${this.#lastFlushedTick + 1}, received ${tick120}`,
      );
    }
    const outOfTick = this.#pending.find((event) => event.tick120 !== tick120);
    if (outOfTick !== undefined) {
      throw new Error(
        `event-bus cannot close tick ${tick120} while tick ${outOfTick.tick120} is pending`,
      );
    }
    return this.#commitPending(feedbackSinks, tick120);
  }

  #commitPending(
    feedbackSinks: readonly ReadonlyFeedbackSink[],
    closedThroughTick120: number | null,
  ): readonly CanonicalGameplayEvent[] {
    if (this.#feedbackDispatching) throw new Error("feedback sinks cannot flush gameplay events");
    if (this.#pending.length === 0) {
      if (closedThroughTick120 !== null) this.#lastFlushedTick = closedThroughTick120;
      return Object.freeze([]);
    }

    const sorted = this.#pending.slice().sort(comparePending);
    this.#pending.length = 0;
    const flushed = sorted.map((pending) => {
      const event: CanonicalGameplayEvent = Object.freeze({
        id: pending.id,
        authority: "gameplay",
        tick120: pending.tick120,
        simulationTimeMs: pending.simulationTimeMs,
        phasePriority: pending.phasePriority,
        entityStableId: pending.entityStableId,
        localSequence: pending.localSequence,
        sequence: this.#nextSequence,
        occurrenceKey: pending.occurrenceKey,
        payload: pending.payload,
      });
      this.#nextSequence += 1;
      return event;
    });
    this.#lastFlushedTick = closedThroughTick120
      ?? sorted[sorted.length - 1]?.tick120
      ?? this.#lastFlushedTick;
    this.#committed.push(...flushed);

    if (feedbackSinks.length > 0) {
      this.#feedbackDispatching = true;
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
        this.#feedbackDispatching = false;
      }
    }

    return Object.freeze(flushed);
  }

  events(): readonly CanonicalGameplayEvent[] {
    return Object.freeze(this.#committed.slice());
  }

  /** O(1) read cursor for observers that must not copy the complete trace. */
  committedEventCount(): number {
    return this.#committed.length;
  }

  /**
   * Return an immutable committed suffix without exposing the mutable trace.
   * This is a read port only; ordering and event authority remain bus-owned.
   */
  committedEventsFrom(startIndexValue: number): readonly CanonicalGameplayEvent[] {
    const startIndex = requireNonNegativeInteger(startIndexValue, "committed event start index");
    if (startIndex > this.#committed.length) {
      throw new Error(
        `committed event start index exceeds trace length: ${startIndex} > ${this.#committed.length}`,
      );
    }
    return Object.freeze(this.#committed.slice(startIndex));
  }

  canonicalSerialization(): string {
    return serializeCanonicalEvents(this.#committed);
  }
}
