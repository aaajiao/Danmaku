import bossRigsJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/boss-rigs-v4.json";
import encounterDirectorJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/encounter-director-v4.json";
import executablePatternsJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/executable-patterns-v4.json";
import roomComposersJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/room-composers-v4.json";
import runDirectorJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/run-director-v4.json";
import {SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS} from "./combat-kernel";
import {V4_RUN_COMPOSER_METRIC_IDS} from "./run-composer";

type UnknownRecord = Record<string, unknown>;

const UINT32_MAXIMUM = 0xffff_ffff;
const PARALLEL_SELECTION_SALT = 0xec40;
const LIVE_RUN_SCHEMA_VERSION = "1.0.0-live-run-admission" as const;
const LIVE_RUN_AUTHORITY = "caller-resolved-live-run" as const;
const LIVE_ROOM_CAPABILITY_SCHEMA_VERSION = "1.0.0-live-room-capability" as const;
const LIVE_ROOM_CAPABILITY_AUTHORITY = "caller-resolved-live-room" as const;
const RAW_RUN_SEED_DOMAIN = "raw-run-seed" as const;
const RESOLVED_OCCURRENCE_SEED_DOMAIN = "resolved-occurrence-seed" as const;
const PARALLEL_SELECTION_SEED_DOMAIN = "parallel-selection-seed" as const;
const PATTERN_SEED_COMPOSITION = "runSeed xor base xor encounterOrdinal xor difficultySalt" as const;

const DIFFICULTIES = Object.freeze(["EASY", "NORMAL", "HARD"] as const);
type Difficulty = typeof DIFFICULTIES[number];

export const LIVE_RUN_ADMISSION_CONTRACT = Object.freeze({
  schemaVersion: LIVE_RUN_SCHEMA_VERSION,
  authority: LIVE_RUN_AUTHORITY,
  rawRunSeedDomain: RAW_RUN_SEED_DOMAIN,
  resolvedOccurrenceSeedDomain: RESOLVED_OCCURRENCE_SEED_DOMAIN,
  parallelSelectionSeedDomain: PARALLEL_SELECTION_SEED_DOMAIN,
  canonicalEventBus: false as const,
  composer: false as const,
  executionScheduled: false as const,
  qaDefaultsAccepted: false as const,
  presentationAffectsHash: false as const,
});

export const LIVE_ROOM_CAPABILITY_ADMISSION_CONTRACT = Object.freeze({
  schemaVersion: LIVE_ROOM_CAPABILITY_SCHEMA_VERSION,
  authority: LIVE_ROOM_CAPABILITY_AUTHORITY,
  rawRunSeedDomain: RAW_RUN_SEED_DOMAIN,
  resolvedOccurrenceSeedDomain: RESOLVED_OCCURRENCE_SEED_DOMAIN,
  parallelSelectionSeedDomain: PARALLEL_SELECTION_SEED_DOMAIN,
  canonicalEventBus: false as const,
  composer: false as const,
  executionScheduled: false as const,
  qaDefaultsAccepted: false as const,
  presentationAffectsHash: false as const,
});

export interface LiveRunAdmissionRejection {
  readonly path: string;
  readonly code: string;
  readonly detail: string;
}

export interface LiveRunAdmittedPlan {
  readonly schemaVersion: typeof LIVE_RUN_SCHEMA_VERSION;
  readonly authority: typeof LIVE_RUN_AUTHORITY;
  readonly rawRunSeed: Readonly<{readonly domain: typeof RAW_RUN_SEED_DOMAIN; readonly value: number}>;
  readonly roomCount: 2 | 3 | 4;
  readonly metricSnapshot: Readonly<{
    readonly producerId: string;
    readonly producerVersion: string;
    readonly capturedAtTick120: number;
    readonly metrics: Readonly<Record<typeof V4_RUN_COMPOSER_METRIC_IDS[number], number>>;
  }>;
  readonly rooms: readonly Readonly<{
    readonly roomId: string;
    readonly roomOrdinal: number;
    readonly tierId: string;
    readonly difficulty: Difficulty;
    readonly encounters: readonly Readonly<{
      readonly occurrenceId: string;
      readonly patternId: string;
      readonly encounterOrdinal: number;
      readonly difficulty: Difficulty;
      readonly difficultySalt: number;
      readonly resolvedSeed: Readonly<{
        readonly domain: typeof RESOLVED_OCCURRENCE_SEED_DOMAIN;
        readonly value: number;
      }>;
      readonly segments: Readonly<{
        readonly telegraphMs: number;
        readonly entryMs: number;
        readonly readMs: number;
        readonly materialSettleMs: number;
        readonly restMs: number;
        readonly safeGapHandoffMs: number;
      }>;
      readonly parallel:
        | Readonly<{
          readonly mode: "none";
          readonly selectionSeed: Readonly<{
            readonly domain: typeof PARALLEL_SELECTION_SEED_DOMAIN;
            readonly value: number;
          }>;
        }>
        | Readonly<{
          readonly mode: "member";
          readonly occurrenceId: string;
          readonly patternId: string;
          readonly difficulty: Difficulty;
          readonly difficultySalt: number;
          readonly resolvedSeed: Readonly<{
            readonly domain: typeof RESOLVED_OCCURRENCE_SEED_DOMAIN;
            readonly value: number;
          }>;
          readonly selectionSeed: Readonly<{
            readonly domain: typeof PARALLEL_SELECTION_SEED_DOMAIN;
            readonly value: number;
          }>;
        }>;
    }>[];
  }>[];
  readonly boss: Readonly<{
    readonly bossId: string;
    readonly phases: readonly Readonly<{
      readonly occurrenceId: string;
      readonly phaseId: string;
      readonly patternId: string;
      readonly encounterOrdinal: number;
      readonly difficulty: Difficulty;
      readonly difficultySalt: number;
      readonly resolvedSeed: Readonly<{
        readonly domain: typeof RESOLVED_OCCURRENCE_SEED_DOMAIN;
        readonly value: number;
      }>;
    }>[];
  }>;
  readonly canonicalEventBus: false;
  readonly composer: false;
  readonly executionScheduled: false;
  readonly gameplaySha256: string;
}

export type LiveRunAdmissionResult =
  | Readonly<{
    readonly status: "admitted";
    readonly gameplaySha256: string;
    readonly plan: LiveRunAdmittedPlan;
  }>
  | Readonly<{
    readonly status: "rejected";
    /** Available when the gameplay candidate is structurally complete but lacks capability. */
    readonly gameplaySha256: string | null;
    readonly rejections: readonly LiveRunAdmissionRejection[];
  }>;

export interface LiveRoomCapabilityAdmittedPlan {
  readonly schemaVersion: typeof LIVE_ROOM_CAPABILITY_SCHEMA_VERSION;
  readonly authority: typeof LIVE_ROOM_CAPABILITY_AUTHORITY;
  readonly rawRunSeed: LiveRunAdmittedPlan["rawRunSeed"];
  readonly metricSnapshot: LiveRunAdmittedPlan["metricSnapshot"];
  readonly room: LiveRunAdmittedPlan["rooms"][number];
  readonly canonicalEventBus: false;
  readonly composer: false;
  readonly executionScheduled: false;
  readonly gameplaySha256: string;
}

export type LiveRoomCapabilityAdmissionResult =
  | Readonly<{
    readonly status: "admitted";
    readonly gameplaySha256: string;
    readonly plan: LiveRoomCapabilityAdmittedPlan;
  }>
  | Readonly<{
    readonly status: "rejected";
    /** Available when the room facts are structurally complete but lack capability. */
    readonly gameplaySha256: string | null;
    readonly rejections: readonly LiveRunAdmissionRejection[];
  }>;

interface PatternDefinition {
  readonly id: string;
  readonly category: string;
  readonly room: string;
  readonly durationMs: number;
  readonly seedBase: number;
}

interface TierDefinition {
  readonly id: string;
  readonly difficulty: Difficulty;
  readonly restMs: number;
}

interface RoomDefinition {
  readonly room: string;
  readonly patternIds: ReadonlySet<string>;
  readonly tiers: ReadonlyMap<string, TierDefinition>;
}

interface BossPhaseDefinition {
  readonly id: string;
  readonly patternId: string;
}

interface BossDefinition {
  readonly id: string;
  readonly room: string;
  readonly phases: readonly BossPhaseDefinition[];
}

interface SourceContract {
  readonly patterns: ReadonlyMap<string, PatternDefinition>;
  readonly rooms: ReadonlyMap<string, RoomDefinition>;
  readonly bosses: ReadonlyMap<string, BossDefinition>;
  readonly segmentRanges: ReadonlyMap<string, readonly [number, number]>;
  readonly patternSlotRange: readonly [number, number];
  readonly safeGapHandoffMs: number;
  readonly parallelPatternIds: ReadonlySet<string>;
}

function sourceRecord(value: unknown, path: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as UnknownRecord;
}

function sourceArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}

function sourceString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${path} must be a string`);
  return value;
}

function sourceInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${path} must be an integer`);
  return value as number;
}

function sourcePair(value: unknown, path: string): readonly [number, number] {
  const values = sourceArray(value, path);
  if (values.length !== 2) throw new Error(`${path} must contain two values`);
  const minimum = sourceInteger(values[0], `${path}[0]`);
  const maximum = sourceInteger(values[1], `${path}[1]`);
  if (minimum > maximum) throw new Error(`${path} range is reversed`);
  return Object.freeze([minimum, maximum]);
}

function buildSourceContract(): SourceContract {
  const run = sourceRecord(runDirectorJson, "run director manifest");
  if (run.schemaVersion !== "4.0.0" || run.id !== "director.run.v4") {
    throw new Error("live admission requires director.run.v4 schema 4.0.0");
  }
  const mentalRoom = sourceArray(run.phases, "run director phases")
    .map((value, index) => sourceRecord(value, `run director phases[${index}]`))
    .find((phase) => phase.id === "mental_room_sampling");
  if (mentalRoom === undefined) throw new Error("run director lost mental_room_sampling");
  const roomRange = sourcePair(mentalRoom.roomsSampled, "mental_room_sampling.roomsSampled");
  if (roomRange[0] !== 2 || roomRange[1] !== 4) throw new Error("authored room-count range drifted");

  const rawPatterns = sourceRecord(executablePatternsJson, "pattern manifest");
  if (rawPatterns.schemaVersion !== "4.0.0") throw new Error("pattern schema drifted");
  const patterns = new Map<string, PatternDefinition>();
  for (const [index, value] of sourceArray(rawPatterns.patterns, "pattern manifest.patterns").entries()) {
    const pattern = sourceRecord(value, `pattern manifest.patterns[${index}]`);
    const seed = sourceRecord(pattern.seed, `pattern manifest.patterns[${index}].seed`);
    if (seed.composition !== PATTERN_SEED_COMPOSITION) {
      throw new Error(`pattern ${String(pattern.id)} seed composition drifted`);
    }
    const id = sourceString(pattern.id, `pattern manifest.patterns[${index}].id`);
    const seedBase = sourceInteger(seed.base, `${id}.seed.base`);
    if (seedBase < 0 || seedBase > UINT32_MAXIMUM) throw new Error(`${id}.seed.base must be uint32`);
    if (patterns.has(id)) throw new Error(`duplicate pattern: ${id}`);
    patterns.set(id, Object.freeze({
      id,
      category: sourceString(pattern.category, `${id}.category`),
      room: sourceString(pattern.room, `${id}.room`),
      durationMs: sourceInteger(pattern.durationMs, `${id}.durationMs`),
      seedBase,
    }));
  }
  if (patterns.size !== 48) throw new Error("live admission requires all 48 V4 patterns");

  const rawRooms = sourceRecord(roomComposersJson, "room composer manifest");
  if (rawRooms.schemaVersion !== "4.0.0") throw new Error("room composer schema drifted");
  const rooms = new Map<string, RoomDefinition>();
  for (const [index, value] of sourceArray(rawRooms.composers, "room composers").entries()) {
    const composer = sourceRecord(value, `room composers[${index}]`);
    const room = sourceString(composer.room, `room composers[${index}].room`);
    const patternIds = sourceArray(composer.patternPool, `${room}.patternPool`).map((entry, patternIndex) =>
      sourceString(sourceRecord(entry, `${room}.patternPool[${patternIndex}]`).patternId, `${room}.patternPool[${patternIndex}].patternId`));
    const tiers = new Map<string, TierDefinition>();
    for (const [tierIndex, entry] of sourceArray(composer.intensityTiers, `${room}.intensityTiers`).entries()) {
      const tier = sourceRecord(entry, `${room}.intensityTiers[${tierIndex}]`);
      const budget = sourceRecord(tier.budget, `${room}.intensityTiers[${tierIndex}].budget`);
      const difficulty = sourceString(tier.difficulty, `${room}.intensityTiers[${tierIndex}].difficulty`);
      if (!DIFFICULTIES.includes(difficulty as Difficulty)) throw new Error(`${room} has unknown difficulty`);
      const definition = Object.freeze({
        id: sourceString(tier.id, `${room}.intensityTiers[${tierIndex}].id`),
        difficulty: difficulty as Difficulty,
        restMs: sourceInteger(budget.restMs, `${room}.intensityTiers[${tierIndex}].budget.restMs`),
      });
      tiers.set(definition.id, definition);
    }
    rooms.set(room, Object.freeze({room, patternIds: new Set(patternIds), tiers}));
  }
  if (rooms.size !== 4) throw new Error("live admission requires four room composers");

  const rawBosses = sourceRecord(bossRigsJson, "boss rig manifest");
  if (rawBosses.schemaVersion !== "4.0.0") throw new Error("boss rig schema drifted");
  const bosses = new Map<string, BossDefinition>();
  for (const [index, value] of sourceArray(rawBosses.rigs, "boss rigs").entries()) {
    const boss = sourceRecord(value, `boss rigs[${index}]`);
    const id = sourceString(boss.id, `boss rigs[${index}].id`);
    const phases = sourceArray(boss.phases, `${id}.phases`).map((entry, phaseIndex) => {
      const phase = sourceRecord(entry, `${id}.phases[${phaseIndex}]`);
      return Object.freeze({
        id: sourceString(phase.id, `${id}.phases[${phaseIndex}].id`),
        patternId: sourceString(phase.patternId, `${id}.phases[${phaseIndex}].patternId`),
      });
    });
    if (phases.length !== 3) throw new Error(`${id} must retain three phases`);
    bosses.set(id, Object.freeze({
      id,
      room: sourceString(boss.room, `${id}.room`),
      phases: Object.freeze(phases),
    }));
  }
  if (bosses.size !== 8) throw new Error("live admission requires eight Boss rigs");

  const encounter = sourceRecord(encounterDirectorJson, "encounter director manifest");
  if (encounter.schemaVersion !== "4.0.0" || encounter.id !== "director.encounter.v4") {
    throw new Error("live admission requires director.encounter.v4 schema 4.0.0");
  }
  const segmentRanges = new Map<string, readonly [number, number]>();
  let patternSlotRange: readonly [number, number] | null = null;
  for (const [index, value] of sourceArray(encounter.segments, "encounter segments").entries()) {
    const segment = sourceRecord(value, `encounter segments[${index}]`);
    const id = sourceString(segment.id, `encounter segments[${index}].id`);
    segmentRanges.set(id, sourcePair(segment.durationMs, `encounter segment ${id}.durationMs`));
    if (id === "read") patternSlotRange = sourcePair(segment.patternSlots, "read.patternSlots");
  }
  for (const id of ["telegraph", "entry", "read", "material_settle", "rest"]) {
    if (!segmentRanges.has(id)) throw new Error(`encounter director lost segment ${id}`);
  }
  if (patternSlotRange?.[0] !== 1 || patternSlotRange[1] !== 3) {
    throw new Error("encounter pattern-slot range drifted");
  }
  const scheduling = sourceRecord(encounter.scheduling, "encounter scheduling");
  const safeGapHandoffMs = sourceInteger(scheduling.safeGapHandoffMs, "scheduling.safeGapHandoffMs");
  if (safeGapHandoffMs !== 520) throw new Error("safe-gap handoff drifted");
  const pools = sourceRecord(encounter.parallelEncounterPools, "parallel encounter pools");
  const weatherEcho = sourceRecord(pools.weatherEcho, "parallel encounter pools.weatherEcho");
  if (
    weatherEcho.selectionSeed !== "runSeed xor encounterOrdinal xor 0xEC40"
    || weatherEcho.maximumConcurrent !== 1
    || weatherEcho.requiresWeatherState !== false
  ) {
    throw new Error("parallel weather-echo admission contract drifted");
  }
  const parallelPatternIds = new Set(sourceArray(weatherEcho.patternIds, "weatherEcho.patternIds")
    .map((value, index) => sourceString(value, `weatherEcho.patternIds[${index}]`)));
  if (parallelPatternIds.size !== 3) throw new Error("weather-echo pool must contain three patterns");

  return Object.freeze({
    patterns,
    rooms,
    bosses,
    segmentRanges,
    patternSlotRange,
    safeGapHandoffMs,
    parallelPatternIds,
  });
}

const SOURCE = buildSourceContract();
const SUPPORTED_PATTERN_SET: ReadonlySet<string> = new Set(SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS);

interface MutableIssue {
  path: string;
  code: string;
  detail: string;
}

function issue(issues: MutableIssue[], path: string, code: string, detail: string): void {
  issues.push({path, code, detail});
}

function compareCodePoints(left: string, right: string): number {
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftPoint = left.codePointAt(leftIndex) as number;
    const rightPoint = right.codePointAt(rightIndex) as number;
    if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
    leftIndex += leftPoint > 0xffff ? 2 : 1;
    rightIndex += rightPoint > 0xffff ? 2 : 1;
  }
  return leftIndex < left.length ? 1 : rightIndex < right.length ? -1 : 0;
}

function inspectObject(
  value: unknown,
  path: string,
  allowed: readonly string[],
  required: readonly string[],
  issues: MutableIssue[],
): UnknownRecord | undefined {
  if (typeof value !== "object" || value === null) {
    issue(issues, path, "type", "must be a plain object");
    return undefined;
  }
  let prototype: object | null;
  let keys: readonly PropertyKey[];
  try {
    if (Array.isArray(value)) {
      issue(issues, path, "type", "must be a plain object");
      return undefined;
    }
    prototype = Object.getPrototypeOf(value) as object | null;
    keys = Reflect.ownKeys(value);
  } catch {
    issue(issues, path, "uninspectable", "object inspection failed");
    return undefined;
  }
  if (prototype !== Object.prototype && prototype !== null) {
    issue(issues, path, "prototype", "custom prototypes are forbidden");
  }
  const allowedSet = new Set(allowed);
  const captured: UnknownRecord = Object.create(null) as UnknownRecord;
  for (const key of keys) {
    if (typeof key !== "string") {
      issue(issues, path, "symbol-key", "symbol keys are forbidden");
      continue;
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      issue(issues, `${path}.${key}`, "uninspectable", "property inspection failed");
      continue;
    }
    if (descriptor === undefined || !("value" in descriptor)) {
      issue(issues, `${path}.${key}`, "accessor", "must be an own data property");
      continue;
    }
    if (descriptor.enumerable !== true) {
      issue(issues, `${path}.${key}`, "non-enumerable", "must be enumerable");
      continue;
    }
    if (!allowedSet.has(key)) {
      issue(issues, `${path}.${key}`, "unknown-field", "field is outside the admission contract");
      continue;
    }
    captured[key] = descriptor.value;
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(captured, key)) {
      issue(issues, `${path}.${key}`, "required", "field is required");
    }
  }
  return captured;
}

function inspectArray(
  value: unknown,
  path: string,
  maximumLength: number,
  issues: MutableIssue[],
): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(value)) {
      issue(issues, path, "type", "must be an array");
      return undefined;
    }
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      issue(issues, path, "prototype", "custom array prototypes are forbidden");
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      lengthDescriptor === undefined
      || !("value" in lengthDescriptor)
      || !Number.isInteger(lengthDescriptor.value)
      || lengthDescriptor.value < 0
    ) {
      issue(issues, `${path}.length`, "array-length", "must be the array's own non-negative integer length");
      return undefined;
    }
    const length = lengthDescriptor.value as number;
    if (length > maximumLength) {
      issue(issues, `${path}.length`, "array-length", `must not exceed ${maximumLength}`);
      return undefined;
    }
    const keys = Reflect.ownKeys(value);
    const captured: unknown[] = [];
    for (const key of keys) {
      if (typeof key === "symbol") {
        issue(issues, path, "symbol-key", "symbol keys are forbidden");
        continue;
      }
      if (key === "length") continue;
      if (!/^(0|[1-9]\d*)$/.test(key)) {
        issue(issues, `${path}.${key}`, "unknown-field", "array metadata is forbidden");
        continue;
      }
      const index = Number(key);
      if (!Number.isSafeInteger(index) || index >= length || String(index) !== key) {
        issue(issues, `${path}.${key}`, "unknown-field", "array metadata is forbidden");
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) {
        issue(issues, `${path}[${index}]`, "accessor", "must be an own data element");
        continue;
      }
      if (descriptor.enumerable !== true) {
        issue(issues, `${path}[${index}]`, "non-enumerable", "must be enumerable");
        continue;
      }
      captured[index] = descriptor.value;
    }
    for (let index = 0; index < Math.min(length, maximumLength); index += 1) {
      if (!Object.prototype.hasOwnProperty.call(captured, index)) {
        issue(issues, `${path}[${index}]`, "required", "array holes are forbidden");
      }
    }
    return captured;
  } catch {
    issue(issues, path, "uninspectable", "array inspection failed");
    return undefined;
  }
}

function text(value: unknown, path: string, issues: MutableIssue[]): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    issue(issues, path, "type", "must be a non-empty string");
    return undefined;
  }
  return value;
}

function literal<T extends string>(
  value: unknown,
  expected: T,
  path: string,
  issues: MutableIssue[],
): T | undefined {
  if (value !== expected) {
    issue(issues, path, "value", `must equal ${expected}`);
    return undefined;
  }
  return expected;
}

function uint32(value: unknown, path: string, issues: MutableIssue[]): number | undefined {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || Object.is(value, -0)
    || value < 0
    || value > UINT32_MAXIMUM
  ) {
    issue(issues, path, "uint32", "must be a non-negative uint32 without negative zero");
    return undefined;
  }
  return value;
}

function nonNegativeInteger(value: unknown, path: string, issues: MutableIssue[]): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || Object.is(value, -0) || value < 0) {
    issue(issues, path, "integer", "must be a non-negative safe integer without negative zero");
    return undefined;
  }
  return value;
}

function finite(value: unknown, path: string, issues: MutableIssue[]): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issue(issues, path, "finite", "must be a finite number");
    return undefined;
  }
  return value;
}

function difficulty(value: unknown, path: string, issues: MutableIssue[]): Difficulty | undefined {
  if (typeof value !== "string" || !DIFFICULTIES.includes(value as Difficulty)) {
    issue(issues, path, "difficulty", "must be EASY, NORMAL, or HARD");
    return undefined;
  }
  return value as Difficulty;
}

function taggedSeed<D extends string>(
  value: unknown,
  domain: D,
  path: string,
  issues: MutableIssue[],
): Readonly<{domain: D; value: number}> | undefined {
  const record = inspectObject(value, path, ["domain", "value"], ["domain", "value"], issues);
  if (record === undefined) return undefined;
  const parsedDomain = literal(record.domain, domain, `${path}.domain`, issues);
  const parsedValue = uint32(record.value, `${path}.value`, issues);
  if (parsedDomain === undefined || parsedValue === undefined) return undefined;
  return Object.freeze({domain: parsedDomain, value: parsedValue});
}

function xorUint32(...values: readonly number[]): number {
  return values.reduce((result, value) => (result ^ value) >>> 0, 0);
}

function validateResolvedSeed(
  rawRunSeed: number,
  pattern: PatternDefinition,
  encounterOrdinal: number,
  difficultySalt: number,
  resolvedSeed: Readonly<{domain: typeof RESOLVED_OCCURRENCE_SEED_DOMAIN; value: number}>,
  path: string,
  issues: MutableIssue[],
): void {
  const expected = xorUint32(rawRunSeed, pattern.seedBase, encounterOrdinal, difficultySalt);
  if (resolvedSeed.value !== expected) {
    issue(
      issues,
      `${path}.resolvedSeed.value`,
      "seed-mismatch",
      `must equal manifest XOR result ${expected}`,
    );
  }
}

function validateRange(
  value: number | undefined,
  id: string,
  path: string,
  issues: MutableIssue[],
): void {
  if (value === undefined) return;
  const range = SOURCE.segmentRanges.get(id);
  if (range === undefined) throw new Error(`source segment disappeared: ${id}`);
  if (value < range[0] || value > range[1]) {
    issue(issues, path, "segment-range", `must remain inside ${range[0]}..${range[1]}ms`);
  }
}

function deepFreezeCopy<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => deepFreezeCopy(entry))) as T;
  if (typeof value === "object" && value !== null) {
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) copy[key] = deepFreezeCopy(entry);
    return Object.freeze(copy) as T;
  }
  return value;
}

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256(bytes: Uint8Array): string {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);
  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const first = words[index - 15] ?? 0;
      const second = words[index - 2] ?? 0;
      const sigma0 = rotateRight(first, 7) ^ rotateRight(first, 18) ^ (first >>> 3);
      const sigma1 = rotateRight(second, 17) ^ rotateRight(second, 19) ^ (second >>> 10);
      words[index] = ((words[index - 16] ?? 0) + sigma0 + (words[index - 7] ?? 0) + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const upper = rotateRight(e ?? 0, 6) ^ rotateRight(e ?? 0, 11) ^ rotateRight(e ?? 0, 25);
      const choice = ((e ?? 0) & (f ?? 0)) ^ (~(e ?? 0) & (g ?? 0));
      const temp1 = ((h ?? 0) + upper + choice + (constants[index] ?? 0) + (words[index] ?? 0)) >>> 0;
      const lower = rotateRight(a ?? 0, 2) ^ rotateRight(a ?? 0, 13) ^ rotateRight(a ?? 0, 22);
      const majority = ((a ?? 0) & (b ?? 0)) ^ ((a ?? 0) & (c ?? 0)) ^ ((b ?? 0) & (c ?? 0));
      const temp2 = (lower + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = ((d ?? 0) + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = ((hash[0] ?? 0) + (a ?? 0)) >>> 0;
    hash[1] = ((hash[1] ?? 0) + (b ?? 0)) >>> 0;
    hash[2] = ((hash[2] ?? 0) + (c ?? 0)) >>> 0;
    hash[3] = ((hash[3] ?? 0) + (d ?? 0)) >>> 0;
    hash[4] = ((hash[4] ?? 0) + (e ?? 0)) >>> 0;
    hash[5] = ((hash[5] ?? 0) + (f ?? 0)) >>> 0;
    hash[6] = ((hash[6] ?? 0) + (g ?? 0)) >>> 0;
    hash[7] = ((hash[7] ?? 0) + (h ?? 0)) >>> 0;
  }
  return Array.from(hash, (part) => part.toString(16).padStart(8, "0")).join("");
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical admission JSON cannot encode non-finite values");
    return Object.is(value, -0) ? "-0" : String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort(compareCodePoints)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  throw new Error(`canonical admission JSON cannot encode ${typeof value}`);
}

function sortedRejections(issues: readonly MutableIssue[]): readonly LiveRunAdmissionRejection[] {
  const sorted = issues.slice().sort((left, right) =>
    compareCodePoints(left.path, right.path)
    || compareCodePoints(left.code, right.code)
    || compareCodePoints(left.detail, right.detail));
  return Object.freeze(sorted.map((entry) => Object.freeze({...entry})));
}

type LiveAdmissionScope = "run" | "room-capability";

/** Shared strict parser for caller-resolved run and isolated room facts. */
function admitResolvedPlan(
  candidate: unknown,
  scope: LiveAdmissionScope,
): LiveRunAdmissionResult | LiveRoomCapabilityAdmissionResult {
  const issues: MutableIssue[] = [];
  const roomCapability = scope === "room-capability";
  const rootFields = roomCapability
    ? ["schemaVersion", "authority", "rawRunSeed", "metricSnapshot", "room"]
    : ["schemaVersion", "authority", "rawRunSeed", "roomCount", "metricSnapshot", "rooms", "boss"];
  const root = inspectObject(
    candidate,
    "$",
    rootFields,
    rootFields,
    issues,
  );
  if (root === undefined) {
    return Object.freeze({status: "rejected", gameplaySha256: null, rejections: sortedRejections(issues)});
  }
  const schemaVersion = roomCapability
    ? literal(
      root.schemaVersion,
      LIVE_ROOM_CAPABILITY_SCHEMA_VERSION,
      "$.schemaVersion",
      issues,
    )
    : literal(root.schemaVersion, LIVE_RUN_SCHEMA_VERSION, "$.schemaVersion", issues);
  const authority = roomCapability
    ? literal(root.authority, LIVE_ROOM_CAPABILITY_AUTHORITY, "$.authority", issues)
    : literal(root.authority, LIVE_RUN_AUTHORITY, "$.authority", issues);
  const rawRunSeed = taggedSeed(root.rawRunSeed, RAW_RUN_SEED_DOMAIN, "$.rawRunSeed", issues);
  let roomCount: 2 | 3 | 4 | undefined;
  if (!roomCapability) {
    const roomCountValue = nonNegativeInteger(root.roomCount, "$.roomCount", issues);
    roomCount = roomCountValue === 2 || roomCountValue === 3 || roomCountValue === 4
      ? roomCountValue
      : undefined;
    if (roomCountValue !== undefined && roomCount === undefined) {
      issue(issues, "$.roomCount", "room-count", "must be explicitly 2, 3, or 4");
    }
  }

  const metricSnapshotValue = inspectObject(
    root.metricSnapshot,
    "$.metricSnapshot",
    ["producerId", "producerVersion", "capturedAtTick120", "metrics"],
    ["producerId", "producerVersion", "capturedAtTick120", "metrics"],
    issues,
  );
  let metricSnapshot: LiveRunAdmittedPlan["metricSnapshot"] | undefined;
  if (metricSnapshotValue !== undefined) {
    const producerId = text(metricSnapshotValue.producerId, "$.metricSnapshot.producerId", issues);
    const producerVersion = text(metricSnapshotValue.producerVersion, "$.metricSnapshot.producerVersion", issues);
    const capturedAtTick120 = nonNegativeInteger(
      metricSnapshotValue.capturedAtTick120,
      "$.metricSnapshot.capturedAtTick120",
      issues,
    );
    const rawMetrics = inspectObject(
      metricSnapshotValue.metrics,
      "$.metricSnapshot.metrics",
      V4_RUN_COMPOSER_METRIC_IDS,
      V4_RUN_COMPOSER_METRIC_IDS,
      issues,
    );
    const parsedMetrics: Record<string, number> = {};
    if (rawMetrics !== undefined) {
      for (const id of V4_RUN_COMPOSER_METRIC_IDS) {
        const parsed = finite(rawMetrics[id], `$.metricSnapshot.metrics.${id}`, issues);
        if (parsed !== undefined) parsedMetrics[id] = parsed;
      }
    }
    if (
      producerId !== undefined
      && producerVersion !== undefined
      && capturedAtTick120 !== undefined
      && Object.keys(parsedMetrics).length === V4_RUN_COMPOSER_METRIC_IDS.length
    ) {
      metricSnapshot = deepFreezeCopy({
        producerId,
        producerVersion,
        capturedAtTick120,
        metrics: parsedMetrics,
      }) as LiveRunAdmittedPlan["metricSnapshot"];
    }
  }

  const occurrenceIds = new Set<string>();
  const capabilityPaths: {path: string; patternId: string}[] = [];
  const rawRooms = roomCapability
    ? Object.freeze([root.room])
    : inspectArray(root.rooms, "$.rooms", 4, issues);
  const parsedRooms: Array<LiveRunAdmittedPlan["rooms"][number]> = [];
  const seenRooms = new Set<string>();
  if (rawRooms !== undefined) {
    if (!roomCapability && roomCount !== undefined && rawRooms.length !== roomCount) {
      issue(issues, "$.rooms", "room-count-mismatch", `must contain exactly ${roomCount} rooms`);
    }
    for (const [roomIndex, roomValue] of rawRooms.entries()) {
      const roomPath = roomCapability ? "$.room" : `$.rooms[${roomIndex}]`;
      const roomRecord = inspectObject(
        roomValue,
        roomPath,
        ["roomId", "roomOrdinal", "tierId", "difficulty", "encounters"],
        ["roomId", "roomOrdinal", "tierId", "difficulty", "encounters"],
        issues,
      );
      if (roomRecord === undefined) continue;
      const roomId = text(roomRecord.roomId, `${roomPath}.roomId`, issues);
      const roomOrdinal = nonNegativeInteger(roomRecord.roomOrdinal, `${roomPath}.roomOrdinal`, issues);
      const tierId = text(roomRecord.tierId, `${roomPath}.tierId`, issues);
      const parsedDifficulty = difficulty(roomRecord.difficulty, `${roomPath}.difficulty`, issues);
      const definition = roomId === undefined ? undefined : SOURCE.rooms.get(roomId);
      if (roomId !== undefined && definition === undefined) {
        issue(issues, `${roomPath}.roomId`, "room", "must be one of the four canonical rooms");
      }
      if (roomId !== undefined) {
        if (seenRooms.has(roomId)) issue(issues, `${roomPath}.roomId`, "duplicate", "rooms must be unique");
        seenRooms.add(roomId);
      }
      if (roomOrdinal !== undefined && roomOrdinal !== roomIndex) {
        issue(issues, `${roomPath}.roomOrdinal`, "room-order", `must equal declaration ordinal ${roomIndex}`);
      }
      const tier = tierId === undefined ? undefined : definition?.tiers.get(tierId);
      if (tierId !== undefined && definition !== undefined && tier === undefined) {
        issue(issues, `${roomPath}.tierId`, "tier", "tier is not declared by this room composer");
      }
      if (tier !== undefined && parsedDifficulty !== undefined && tier.difficulty !== parsedDifficulty) {
        issue(issues, `${roomPath}.difficulty`, "tier-difficulty", `must equal ${tier.difficulty}`);
      }

      const rawEncounters = inspectArray(roomRecord.encounters, `${roomPath}.encounters`, 3, issues);
      const parsedEncounters: Array<LiveRunAdmittedPlan["rooms"][number]["encounters"][number]> = [];
      if (rawEncounters !== undefined) {
        if (
          rawEncounters.length < SOURCE.patternSlotRange[0]
          || rawEncounters.length > SOURCE.patternSlotRange[1]
        ) {
          issue(issues, `${roomPath}.encounters`, "pattern-slots", "must explicitly contain 1..3 encounters");
        }
        const seenPatterns = new Set<string>();
        for (const [encounterIndex, encounterValue] of rawEncounters.entries()) {
          const encounterPath = `${roomPath}.encounters[${encounterIndex}]`;
          const encounter = inspectObject(
            encounterValue,
            encounterPath,
            [
              "occurrenceId",
              "patternId",
              "encounterOrdinal",
              "difficulty",
              "difficultySalt",
              "resolvedSeed",
              "segments",
              "parallel",
            ],
            [
              "occurrenceId",
              "patternId",
              "encounterOrdinal",
              "difficulty",
              "difficultySalt",
              "resolvedSeed",
              "segments",
              "parallel",
            ],
            issues,
          );
          if (encounter === undefined) continue;
          const occurrenceId = text(encounter.occurrenceId, `${encounterPath}.occurrenceId`, issues);
          const patternId = text(encounter.patternId, `${encounterPath}.patternId`, issues);
          const encounterOrdinal = uint32(
            encounter.encounterOrdinal,
            `${encounterPath}.encounterOrdinal`,
            issues,
          );
          const encounterDifficulty = difficulty(encounter.difficulty, `${encounterPath}.difficulty`, issues);
          const difficultySalt = uint32(encounter.difficultySalt, `${encounterPath}.difficultySalt`, issues);
          const resolvedSeed = taggedSeed(
            encounter.resolvedSeed,
            RESOLVED_OCCURRENCE_SEED_DOMAIN,
            `${encounterPath}.resolvedSeed`,
            issues,
          );
          if (occurrenceId !== undefined) {
            if (occurrenceIds.has(occurrenceId)) {
              issue(issues, `${encounterPath}.occurrenceId`, "duplicate", "occurrence IDs must be globally unique");
            }
            occurrenceIds.add(occurrenceId);
          }
          if (encounterOrdinal !== undefined && encounterOrdinal !== encounterIndex) {
            issue(
              issues,
              `${encounterPath}.encounterOrdinal`,
              "encounter-order",
              `must equal declaration ordinal ${encounterIndex}`,
            );
          }
          if (
            parsedDifficulty !== undefined
            && encounterDifficulty !== undefined
            && parsedDifficulty !== encounterDifficulty
          ) {
            issue(issues, `${encounterPath}.difficulty`, "tier-difficulty", "must equal the room tier difficulty");
          }
          const pattern = patternId === undefined ? undefined : SOURCE.patterns.get(patternId);
          if (patternId !== undefined && pattern === undefined) {
            issue(issues, `${encounterPath}.patternId`, "pattern", "unknown V4 pattern ID");
          }
          if (pattern !== undefined) {
            if (pattern.category !== "ROOM" || pattern.room !== roomId || !definition?.patternIds.has(pattern.id)) {
              issue(issues, `${encounterPath}.patternId`, "pattern-membership", "pattern is outside this room composer");
            }
            if (seenPatterns.has(pattern.id)) {
              issue(issues, `${encounterPath}.patternId`, "duplicate", "room encounters must be without replacement");
            }
            seenPatterns.add(pattern.id);
            capabilityPaths.push({path: `${encounterPath}.patternId`, patternId: pattern.id});
          }
          if (
            rawRunSeed !== undefined
            && pattern !== undefined
            && encounterOrdinal !== undefined
            && difficultySalt !== undefined
            && resolvedSeed !== undefined
          ) {
            validateResolvedSeed(
              rawRunSeed.value,
              pattern,
              encounterOrdinal,
              difficultySalt,
              resolvedSeed,
              encounterPath,
              issues,
            );
          }

          const segmentRecord = inspectObject(
            encounter.segments,
            `${encounterPath}.segments`,
            ["telegraphMs", "entryMs", "readMs", "materialSettleMs", "restMs", "safeGapHandoffMs"],
            ["telegraphMs", "entryMs", "readMs", "materialSettleMs", "restMs", "safeGapHandoffMs"],
            issues,
          );
          let segments: LiveRunAdmittedPlan["rooms"][number]["encounters"][number]["segments"] | undefined;
          if (segmentRecord !== undefined) {
            const telegraphMs = nonNegativeInteger(segmentRecord.telegraphMs, `${encounterPath}.segments.telegraphMs`, issues);
            const entryMs = nonNegativeInteger(segmentRecord.entryMs, `${encounterPath}.segments.entryMs`, issues);
            const readMs = nonNegativeInteger(segmentRecord.readMs, `${encounterPath}.segments.readMs`, issues);
            const materialSettleMs = nonNegativeInteger(
              segmentRecord.materialSettleMs,
              `${encounterPath}.segments.materialSettleMs`,
              issues,
            );
            const restMs = nonNegativeInteger(segmentRecord.restMs, `${encounterPath}.segments.restMs`, issues);
            const safeGapHandoffMs = nonNegativeInteger(
              segmentRecord.safeGapHandoffMs,
              `${encounterPath}.segments.safeGapHandoffMs`,
              issues,
            );
            validateRange(telegraphMs, "telegraph", `${encounterPath}.segments.telegraphMs`, issues);
            validateRange(entryMs, "entry", `${encounterPath}.segments.entryMs`, issues);
            validateRange(readMs, "read", `${encounterPath}.segments.readMs`, issues);
            validateRange(materialSettleMs, "material_settle", `${encounterPath}.segments.materialSettleMs`, issues);
            validateRange(restMs, "rest", `${encounterPath}.segments.restMs`, issues);
            if (pattern !== undefined && readMs !== undefined && readMs !== pattern.durationMs) {
              issue(
                issues,
                `${encounterPath}.segments.readMs`,
                "pattern-duration",
                `must equal authored pattern duration ${pattern.durationMs}`,
              );
            }
            if (tier !== undefined && restMs !== undefined && restMs !== tier.restMs) {
              issue(
                issues,
                `${encounterPath}.segments.restMs`,
                "tier-rest",
                `must equal authored tier rest ${tier.restMs}`,
              );
            }
            if (safeGapHandoffMs !== undefined && safeGapHandoffMs !== SOURCE.safeGapHandoffMs) {
              issue(
                issues,
                `${encounterPath}.segments.safeGapHandoffMs`,
                "safe-gap-handoff",
                `must equal ${SOURCE.safeGapHandoffMs}`,
              );
            }
            if ([telegraphMs, entryMs, readMs, materialSettleMs, restMs, safeGapHandoffMs]
              .every((value) => value !== undefined)) {
              segments = Object.freeze({
                telegraphMs: telegraphMs as number,
                entryMs: entryMs as number,
                readMs: readMs as number,
                materialSettleMs: materialSettleMs as number,
                restMs: restMs as number,
                safeGapHandoffMs: safeGapHandoffMs as number,
              });
            }
          }

          const parallelRecord = inspectObject(
            encounter.parallel,
            `${encounterPath}.parallel`,
            [
              "mode",
              "selectionSeed",
              "occurrenceId",
              "patternId",
              "difficulty",
              "difficultySalt",
              "resolvedSeed",
            ],
            ["mode", "selectionSeed"],
            issues,
          );
          let parallel: LiveRunAdmittedPlan["rooms"][number]["encounters"][number]["parallel"] | undefined;
          if (parallelRecord !== undefined) {
            const mode = parallelRecord.mode === "none" || parallelRecord.mode === "member"
              ? parallelRecord.mode
              : undefined;
            if (mode === undefined) issue(issues, `${encounterPath}.parallel.mode`, "value", "must be none or member");
            const selectionSeed = taggedSeed(
              parallelRecord.selectionSeed,
              PARALLEL_SELECTION_SEED_DOMAIN,
              `${encounterPath}.parallel.selectionSeed`,
              issues,
            );
            if (rawRunSeed !== undefined && encounterOrdinal !== undefined && selectionSeed !== undefined) {
              const expected = xorUint32(rawRunSeed.value, encounterOrdinal, PARALLEL_SELECTION_SALT);
              if (selectionSeed.value !== expected) {
                issue(
                  issues,
                  `${encounterPath}.parallel.selectionSeed.value`,
                  "selection-seed-mismatch",
                  `must equal ${expected}`,
                );
              }
            }
            const memberFields = ["occurrenceId", "patternId", "difficulty", "difficultySalt", "resolvedSeed"];
            if (mode === "none") {
              for (const field of memberFields) {
                if (Object.prototype.hasOwnProperty.call(parallelRecord, field)) {
                  issue(issues, `${encounterPath}.parallel.${field}`, "forbidden", "none mode cannot retain a member field");
                }
              }
              if (selectionSeed !== undefined) parallel = Object.freeze({mode, selectionSeed});
            } else if (mode === "member") {
              for (const field of memberFields) {
                if (!Object.prototype.hasOwnProperty.call(parallelRecord, field)) {
                  issue(issues, `${encounterPath}.parallel.${field}`, "required", "member field is required");
                }
              }
              const parallelOccurrenceId = text(
                parallelRecord.occurrenceId,
                `${encounterPath}.parallel.occurrenceId`,
                issues,
              );
              const parallelPatternId = text(parallelRecord.patternId, `${encounterPath}.parallel.patternId`, issues);
              const parallelDifficulty = difficulty(
                parallelRecord.difficulty,
                `${encounterPath}.parallel.difficulty`,
                issues,
              );
              const parallelSalt = uint32(
                parallelRecord.difficultySalt,
                `${encounterPath}.parallel.difficultySalt`,
                issues,
              );
              const parallelResolvedSeed = taggedSeed(
                parallelRecord.resolvedSeed,
                RESOLVED_OCCURRENCE_SEED_DOMAIN,
                `${encounterPath}.parallel.resolvedSeed`,
                issues,
              );
              if (parallelOccurrenceId !== undefined) {
                if (occurrenceIds.has(parallelOccurrenceId)) {
                  issue(
                    issues,
                    `${encounterPath}.parallel.occurrenceId`,
                    "duplicate",
                    "occurrence IDs must be globally unique",
                  );
                }
                occurrenceIds.add(parallelOccurrenceId);
              }
              if (
                encounterDifficulty !== undefined
                && parallelDifficulty !== undefined
                && encounterDifficulty !== parallelDifficulty
              ) {
                issue(
                  issues,
                  `${encounterPath}.parallel.difficulty`,
                  "tier-difficulty",
                  "must equal the primary encounter difficulty",
                );
              }
              const parallelPattern = parallelPatternId === undefined
                ? undefined
                : SOURCE.patterns.get(parallelPatternId);
              if (
                parallelPatternId !== undefined
                && (!SOURCE.parallelPatternIds.has(parallelPatternId)
                  || parallelPattern?.category !== "WEATHER_ECHO")
              ) {
                issue(
                  issues,
                  `${encounterPath}.parallel.patternId`,
                  "parallel-membership",
                  "must be a member of the independent weather-echo pool",
                );
              }
              if (parallelPattern !== undefined) {
                capabilityPaths.push({path: `${encounterPath}.parallel.patternId`, patternId: parallelPattern.id});
              }
              if (
                rawRunSeed !== undefined
                && parallelPattern !== undefined
                && encounterOrdinal !== undefined
                && parallelSalt !== undefined
                && parallelResolvedSeed !== undefined
              ) {
                validateResolvedSeed(
                  rawRunSeed.value,
                  parallelPattern,
                  encounterOrdinal,
                  parallelSalt,
                  parallelResolvedSeed,
                  `${encounterPath}.parallel`,
                  issues,
                );
              }
              if (
                parallelOccurrenceId !== undefined
                && parallelPatternId !== undefined
                && parallelDifficulty !== undefined
                && parallelSalt !== undefined
                && parallelResolvedSeed !== undefined
                && selectionSeed !== undefined
              ) {
                parallel = Object.freeze({
                  mode,
                  occurrenceId: parallelOccurrenceId,
                  patternId: parallelPatternId,
                  difficulty: parallelDifficulty,
                  difficultySalt: parallelSalt,
                  resolvedSeed: parallelResolvedSeed,
                  selectionSeed,
                });
              }
            }
          }

          if (
            occurrenceId !== undefined
            && patternId !== undefined
            && encounterOrdinal !== undefined
            && encounterDifficulty !== undefined
            && difficultySalt !== undefined
            && resolvedSeed !== undefined
            && segments !== undefined
            && parallel !== undefined
          ) {
            parsedEncounters.push(Object.freeze({
              occurrenceId,
              patternId,
              encounterOrdinal,
              difficulty: encounterDifficulty,
              difficultySalt,
              resolvedSeed,
              segments,
              parallel,
            }));
          }
        }
      }
      if (
        roomId !== undefined
        && roomOrdinal !== undefined
        && tierId !== undefined
        && parsedDifficulty !== undefined
        && rawEncounters !== undefined
        && parsedEncounters.length === rawEncounters.length
      ) {
        parsedRooms.push(Object.freeze({
          roomId,
          roomOrdinal,
          tierId,
          difficulty: parsedDifficulty,
          encounters: Object.freeze(parsedEncounters),
        }));
      }
    }
  }

  let parsedBoss: LiveRunAdmittedPlan["boss"] | undefined;
  const bossRecord = roomCapability
    ? undefined
    : inspectObject(
      root.boss,
      "$.boss",
      ["bossId", "phases"],
      ["bossId", "phases"],
      issues,
    );
  if (bossRecord !== undefined) {
    const bossId = text(bossRecord.bossId, "$.boss.bossId", issues);
    const boss = bossId === undefined ? undefined : SOURCE.bosses.get(bossId);
    if (bossId !== undefined && boss === undefined) issue(issues, "$.boss.bossId", "boss", "unknown V4 Boss ID");
    const terminalRoom = parsedRooms[parsedRooms.length - 1]?.roomId;
    if (boss !== undefined && terminalRoom !== undefined && boss.room !== terminalRoom) {
      issue(issues, "$.boss.bossId", "boss-room", `Boss must belong to terminal room ${terminalRoom}`);
    }
    const rawPhases = inspectArray(bossRecord.phases, "$.boss.phases", 3, issues);
    const parsedPhases: Array<LiveRunAdmittedPlan["boss"]["phases"][number]> = [];
    if (rawPhases !== undefined) {
      if (boss !== undefined && rawPhases.length !== boss.phases.length) {
        issue(issues, "$.boss.phases", "boss-phases", "must contain the complete three-phase rig");
      }
      for (const [phaseIndex, phaseValue] of rawPhases.entries()) {
        const phasePath = `$.boss.phases[${phaseIndex}]`;
        const phaseRecord = inspectObject(
          phaseValue,
          phasePath,
          [
            "occurrenceId",
            "phaseId",
            "patternId",
            "encounterOrdinal",
            "difficulty",
            "difficultySalt",
            "resolvedSeed",
          ],
          [
            "occurrenceId",
            "phaseId",
            "patternId",
            "encounterOrdinal",
            "difficulty",
            "difficultySalt",
            "resolvedSeed",
          ],
          issues,
        );
        if (phaseRecord === undefined) continue;
        const occurrenceId = text(phaseRecord.occurrenceId, `${phasePath}.occurrenceId`, issues);
        const phaseId = text(phaseRecord.phaseId, `${phasePath}.phaseId`, issues);
        const patternId = text(phaseRecord.patternId, `${phasePath}.patternId`, issues);
        const encounterOrdinal = uint32(
          phaseRecord.encounterOrdinal,
          `${phasePath}.encounterOrdinal`,
          issues,
        );
        const phaseDifficulty = difficulty(phaseRecord.difficulty, `${phasePath}.difficulty`, issues);
        const difficultySalt = uint32(phaseRecord.difficultySalt, `${phasePath}.difficultySalt`, issues);
        const resolvedSeed = taggedSeed(
          phaseRecord.resolvedSeed,
          RESOLVED_OCCURRENCE_SEED_DOMAIN,
          `${phasePath}.resolvedSeed`,
          issues,
        );
        if (occurrenceId !== undefined) {
          if (occurrenceIds.has(occurrenceId)) {
            issue(issues, `${phasePath}.occurrenceId`, "duplicate", "occurrence IDs must be globally unique");
          }
          occurrenceIds.add(occurrenceId);
        }
        const expectedPhase = boss?.phases[phaseIndex];
        if (
          expectedPhase !== undefined
          && (phaseId !== expectedPhase.id || patternId !== expectedPhase.patternId)
        ) {
          issue(
            issues,
            phasePath,
            "boss-phase-binding",
            `must equal ${expectedPhase.id}/${expectedPhase.patternId}`,
          );
        }
        const pattern = patternId === undefined ? undefined : SOURCE.patterns.get(patternId);
        if (patternId !== undefined && pattern === undefined) {
          issue(issues, `${phasePath}.patternId`, "pattern", "unknown V4 pattern ID");
        }
        if (pattern !== undefined) {
          if (pattern.category !== "BOSS") {
            issue(issues, `${phasePath}.patternId`, "boss-phase-binding", "Boss phase must use a Boss pattern");
          }
          capabilityPaths.push({path: `${phasePath}.patternId`, patternId: pattern.id});
        }
        if (
          rawRunSeed !== undefined
          && pattern !== undefined
          && encounterOrdinal !== undefined
          && difficultySalt !== undefined
          && resolvedSeed !== undefined
        ) {
          validateResolvedSeed(
            rawRunSeed.value,
            pattern,
            encounterOrdinal,
            difficultySalt,
            resolvedSeed,
            phasePath,
            issues,
          );
        }
        if (
          occurrenceId !== undefined
          && phaseId !== undefined
          && patternId !== undefined
          && encounterOrdinal !== undefined
          && phaseDifficulty !== undefined
          && difficultySalt !== undefined
          && resolvedSeed !== undefined
        ) {
          parsedPhases.push(Object.freeze({
            occurrenceId,
            phaseId,
            patternId,
            encounterOrdinal,
            difficulty: phaseDifficulty,
            difficultySalt,
            resolvedSeed,
          }));
        }
      }
    }
    if (bossId !== undefined && rawPhases !== undefined && parsedPhases.length === rawPhases.length) {
      parsedBoss = Object.freeze({bossId, phases: Object.freeze(parsedPhases)});
    }
  }

  const structurallyComplete = issues.length === 0
    && schemaVersion !== undefined
    && authority !== undefined
    && rawRunSeed !== undefined
    && metricSnapshot !== undefined
    && rawRooms !== undefined
    && parsedRooms.length === rawRooms.length
    && (roomCapability
      ? parsedRooms.length === 1
      : roomCount !== undefined && parsedBoss !== undefined);
  if (!structurallyComplete) {
    return Object.freeze({status: "rejected", gameplaySha256: null, rejections: sortedRejections(issues)});
  }

  const normalized = roomCapability
    ? deepFreezeCopy({
      schemaVersion,
      authority,
      rawRunSeed,
      metricSnapshot,
      room: parsedRooms[0] as LiveRunAdmittedPlan["rooms"][number],
    })
    : deepFreezeCopy({
      schemaVersion,
      authority,
      rawRunSeed,
      roomCount: roomCount as 2 | 3 | 4,
      metricSnapshot,
      rooms: parsedRooms,
      boss: parsedBoss as LiveRunAdmittedPlan["boss"],
    });
  const gameplaySha256 = sha256(new TextEncoder().encode(canonicalJson(normalized)));
  for (const capability of capabilityPaths) {
    if (!SUPPORTED_PATTERN_SET.has(capability.patternId)) {
      issue(
        issues,
        capability.path,
        "unsupported-pattern",
        `${capability.patternId} is not in the exported live-admission combat capability set`,
      );
    }
  }
  if (issues.length > 0) {
    return Object.freeze({status: "rejected", gameplaySha256, rejections: sortedRejections(issues)});
  }
  if (roomCapability) {
    const plan = deepFreezeCopy({
      ...normalized,
      canonicalEventBus: false as const,
      composer: false as const,
      executionScheduled: false as const,
      gameplaySha256,
    }) as LiveRoomCapabilityAdmittedPlan;
    return Object.freeze({status: "admitted", gameplaySha256, plan});
  }
  const plan = deepFreezeCopy({
    ...normalized,
    canonicalEventBus: false as const,
    composer: false as const,
    executionScheduled: false as const,
    gameplaySha256,
  }) as LiveRunAdmittedPlan;
  return Object.freeze({status: "admitted", gameplaySha256, plan});
}

/**
 * Validates an entirely caller-resolved mental-room/Boss plan. This boundary
 * deliberately has no event bus and never fills an omitted gameplay choice.
 * Projection context is opaque: presentation cannot veto or alter admission.
 */
export function admitLiveRun(candidate: unknown, _projectionContext?: unknown): LiveRunAdmissionResult {
  return admitResolvedPlan(candidate, "run") as LiveRunAdmissionResult;
}

/**
 * Admits one caller-resolved room capability slice without composing or
 * scheduling it. The distinct artifact cannot satisfy full-Run admission.
 */
export function admitLiveRoomCapability(
  candidate: unknown,
  _projectionContext?: unknown,
): LiveRoomCapabilityAdmissionResult {
  return admitResolvedPlan(candidate, "room-capability") as LiveRoomCapabilityAdmissionResult;
}
