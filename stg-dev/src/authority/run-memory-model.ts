import type {RoomId} from "../../../1bit-stg-complete-asset-kit-v4/runtime/world";

export const RUN_MEMORY_SCHEMA_VERSION = "4.0.0-run-memory" as const;
export const GHOST_SAMPLE_INTERVAL_MS = 120 as const;
export const GHOST_QUANTIZATION = "1/1024 logical extent" as const;
export const FINGERPRINT_GENERATOR = "route×light×gaze×seam×weather×four-remainders" as const;

export const REHYDRATION_ORDER = [
  "overrideScars",
  "deathTraces",
  "burnIns",
  "ghostRoute",
  "ghostResidues",
  "witnessOrientation",
  "returnInput",
] as const;

const ROOMS = ["INFORMATION", "FORCED_ALIGNMENT", "IN_BETWEEN", "POLARIZED"] as const;
const WEATHER = ["STATIC", "RAIN", "ASH", "WIND", "ECLIPSE"] as const;
const DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
const GHOST_FLAGS = ["GAZE", "GRAZE", "DAMAGE", "OVERRIDE", "ROOM_ENTER", "SEAM_CROSS"] as const;
const RESOLUTION_REASONS = [
  "BODY_COLLAPSE",
  "PROTOCOL_WITHDRAWAL",
  "READING_FAILED",
  "STABLE_INTERSECTION",
  "SEAM_CROSSED_UNCLAIMED",
  "RULE_INTERRUPTED_BY_SCAR",
  "NO_DUSK_WITHDRAWAL",
  "ABSOLUTE_READER_INCOMPLETE",
  "RECEIVER_TIMED_OUT",
  "QUEUE_EXHAUSTED",
  "STRUCTURAL_RUPTURE",
] as const;
const WITNESS_STATES = [
  "ISOLATED",
  "RESONANT",
  "HEAD_DOWN",
  "FACING_EYE",
  "FACING_SCAR",
  "FACING_GHOST_END",
  "RESISTANCE_TRANSMISSION",
] as const;

export type WeatherId = (typeof WEATHER)[number];
export type Direction8 = (typeof DIRECTIONS)[number];
export type GhostFlag = (typeof GHOST_FLAGS)[number];
export type ResolutionReason = (typeof RESOLUTION_REASONS)[number];
export type WitnessState = (typeof WITNESS_STATES)[number];

export interface BehaviorMetrics {
  meanLight: number;
  quietLightRatio: number;
  middleLightRatio: number;
  loudLightRatio: number;
  lightBandChanges: number;
  gazeRatio: number;
  gazeClampCount: number;
  gazeAcquireCount: number;
  gazeStillMaxMs: number;
  incompleteReads: number;
  readPredictionMismatchStreak: number;
  focusDwellRatio: number;
  focusEntryCount: number;
  focusReleaseBeforeImpactCount: number;
  grazeEvidenceCount: number;
  grazeEvidenceSpent: number;
  uniqueBulletsGrazed: number;
  overrideCount: number;
  overrideDirectionUniqueCount: number;
  overrideDuringGazeCount: number;
  overrideScarRuleIntersections: number;
  witnessResistanceTransmissionCount: number;
  damageCount: number;
  seamDwellRatio: number;
  seamCrossings: number;
  fallResetCount: number;
  stableIntersectionDwellMs: number;
  routeWidth: number;
  distinctRoomsVisited: number;
  roomReentries: number;
  roomThresholdCrossings: number;
  dominantRoom: RoomId;
  cableUploadEvents: number;
  snapshotEchoCount: number;
  witnessesTurnedDuringEclipse: number;
  noDuskCycles: number;
  roomTimeMs: Record<RoomId, number>;
  weatherExposureMs: Record<WeatherId, number>;
}

export interface MaterialPosition {
  room: RoomId;
  xNorm: number;
  yNorm: number;
}

export interface OverrideScar {
  id: string;
  position: MaterialPosition;
  direction8: Direction8;
  localVoidRadiusPx: number;
  createdAtTick: number;
  persistenceRuns: number;
}

export interface DeathTrace {
  id: string;
  position: MaterialPosition;
  damageVector: [number, number];
  createdAtTick: number;
  causeArchetype: string;
}

export interface BurnIn {
  id: string;
  room: RoomId;
  captureDigest: string;
  gazeStillMs: number;
  decayTicks: number;
}

export interface GhostResidue {
  id: string;
  position: MaterialPosition;
  sourceRouteDigest: string;
  createdAfterReplay: true;
  persistenceRuns: number;
}

export interface MaterialMemory {
  overrideScars: OverrideScar[];
  deathTraces: DeathTrace[];
  burnIns: BurnIn[];
  ghostResidues: GhostResidue[];
}

export interface GhostPoint {
  tMs: number;
  xNorm: number;
  yNorm: number;
  room: RoomId;
  flower: number;
  focus: boolean;
  flags: GhostFlag[];
}

export interface GhostRoute {
  source: "ACTUAL_PLAYER_ROUTE";
  sampleIntervalMs: typeof GHOST_SAMPLE_INTERVAL_MS;
  quantization: typeof GHOST_QUANTIZATION;
  routeDigest: string;
  replayCount: 1;
  collisionClass: "NONE";
  rewardClass: "NONE";
  points: GhostPoint[];
}

export interface WitnessMemory {
  id: string;
  room: RoomId;
  state: WitnessState;
  facingTarget: string | null;
  sourceFactIds: string[];
}

export interface RunMemory {
  schemaVersion: typeof RUN_MEMORY_SCHEMA_VERSION;
  run: {
    id: string;
    seed: number;
    startedAtTick: number;
    endedAtTick: number;
    durationMs: number;
    roomsVisited: RoomId[];
  };
  metrics: BehaviorMetrics;
  resolution: {
    reason: ResolutionReason;
    bossId: string | null;
    factEventId: string;
  };
  fingerprint: {
    seed: number;
    generator: typeof FINGERPRINT_GENERATOR;
    digestSha256: string;
    bitDepth: 1;
  };
  materialMemory: MaterialMemory;
  ghostRoute: GhostRoute | null;
  witnessMemory: WitnessMemory[];
  snapshot?: {
    observationIds: string[];
    behaviorTags: string[];
  };
  rehydrationOrder: [...typeof REHYDRATION_ORDER];
}

type RecursiveReadonly<T> = T extends readonly unknown[]
  ? {readonly [Index in keyof T]: RecursiveReadonly<T[Index]>}
  : T extends object
    ? {readonly [Key in keyof T]: RecursiveReadonly<T[Key]>}
    : T;

/** The recursively frozen record returned only by RunMemoryRecorder.finalize(). */
export type FinalizedRunMemory = RecursiveReadonly<RunMemory>;

export type BehaviorFactKind =
  | "LIGHT_SAMPLE"
  | "LIGHT_BAND_CHANGE"
  | "GAZE_DWELL"
  | "GAZE_CLAMP"
  | "GAZE_ACQUIRE"
  | "GAZE_STILL"
  | "INCOMPLETE_READ"
  | "READ_MISMATCH_STREAK"
  | "FOCUS_DWELL"
  | "FOCUS_ENTER"
  | "FOCUS_RELEASE_BEFORE_IMPACT"
  | "GRAZE_EVIDENCE"
  | "GRAZE_EVIDENCE_SPENT"
  | "OVERRIDE_COMMIT"
  | "OVERRIDE_DURING_GAZE"
  | "OVERRIDE_SCAR_RULE_INTERSECTION"
  | "WITNESS_RESISTANCE_TRANSMISSION"
  | "DAMAGE_COMMIT"
  | "SEAM_DWELL"
  | "SEAM_CROSS"
  | "FALL_RESET"
  | "STABLE_INTERSECTION_DWELL"
  | "ROOM_ENTER"
  | "ROOM_DWELL"
  | "ROOM_THRESHOLD_CROSS"
  | "CABLE_UPLOAD"
  | "SNAPSHOT_ECHO"
  | "WITNESS_TURN_DURING_ECLIPSE"
  | "NO_DUSK_CYCLE"
  | "WEATHER_EXPOSURE";

/** A traceable event tied to one director segment. It is an input fact, never a grade. */
export interface SegmentBehaviorFact {
  segmentId: string;
  room: RoomId;
  atTick: number;
  eventId: string;
  kind: BehaviorFactKind;
  amount?: number;
  sourceId?: string;
  direction8?: Direction8;
  weather?: WeatherId;
}

export interface RunMemoryRecorderOptions {
  runId: string;
  seed: number;
  startedAtTick: number;
  tickHz?: number;
}

export interface RunMemoryFinalizeOptions {
  endedAtTick: number;
  durationMs?: number;
  roomsVisited?: readonly RoomId[];
  resolution: RunMemory["resolution"];
  observationIds?: readonly string[];
  behaviorTags?: readonly string[];
}

export interface RunMemoryValidation {
  ok: boolean;
  errors: string[];
}

const COUNT_METRICS = [
  "lightBandChanges",
  "gazeClampCount",
  "gazeAcquireCount",
  "gazeStillMaxMs",
  "incompleteReads",
  "readPredictionMismatchStreak",
  "focusEntryCount",
  "focusReleaseBeforeImpactCount",
  "grazeEvidenceCount",
  "grazeEvidenceSpent",
  "uniqueBulletsGrazed",
  "overrideCount",
  "overrideDirectionUniqueCount",
  "overrideDuringGazeCount",
  "overrideScarRuleIntersections",
  "witnessResistanceTransmissionCount",
  "damageCount",
  "seamCrossings",
  "fallResetCount",
  "stableIntersectionDwellMs",
  "distinctRoomsVisited",
  "roomReentries",
  "roomThresholdCrossings",
  "cableUploadEvents",
  "snapshotEchoCount",
  "witnessesTurnedDuringEclipse",
  "noDuskCycles",
] as const;

const RATIO_METRICS = [
  "meanLight",
  "quietLightRatio",
  "middleLightRatio",
  "loudLightRatio",
  "gazeRatio",
  "focusDwellRatio",
  "seamDwellRatio",
  "routeWidth",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => key in value) && Object.keys(value).every((key) => allowed.has(key));
}

function isIntegerAtLeast(value: unknown, minimum: number): value is number {
  return Number.isInteger(value) && (value as number) >= minimum;
}

function isRatio(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isRoom(value: unknown): value is RoomId {
  return typeof value === "string" && (ROOMS as readonly string[]).includes(value);
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function uniqueStrings(value: unknown, minimum = 0, maximum = Number.POSITIVE_INFINITY): value is string[] {
  return Array.isArray(value)
    && value.length >= minimum
    && value.length <= maximum
    && value.every((entry) => typeof entry === "string")
    && new Set(value).size === value.length;
}

function validatePosition(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, ["room", "xNorm", "yNorm"])
    && isRoom(value.room)
    && isRatio(value.xNorm)
    && isRatio(value.yNorm);
}

function validateMaterialMemory(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ["overrideScars", "deathTraces", "burnIns", "ghostResidues"])) return false;
  if (!Array.isArray(value.overrideScars) || !value.overrideScars.every((entry) => isRecord(entry)
    && hasExactKeys(entry, ["id", "position", "direction8", "localVoidRadiusPx", "createdAtTick", "persistenceRuns"])
    && typeof entry.id === "string"
    && validatePosition(entry.position)
    && typeof entry.direction8 === "string" && (DIRECTIONS as readonly string[]).includes(entry.direction8)
    && typeof entry.localVoidRadiusPx === "number" && Number.isFinite(entry.localVoidRadiusPx) && entry.localVoidRadiusPx > 0
    && isIntegerAtLeast(entry.createdAtTick, 0)
    && isIntegerAtLeast(entry.persistenceRuns, 1) && entry.persistenceRuns <= 4)) return false;
  if (!Array.isArray(value.deathTraces) || !value.deathTraces.every((entry) => isRecord(entry)
    && hasExactKeys(entry, ["id", "position", "damageVector", "createdAtTick", "causeArchetype"])
    && typeof entry.id === "string"
    && validatePosition(entry.position)
    && Array.isArray(entry.damageVector) && entry.damageVector.length === 2
    && entry.damageVector.every((part) => typeof part === "number" && Number.isFinite(part))
    && isIntegerAtLeast(entry.createdAtTick, 0)
    && typeof entry.causeArchetype === "string")) return false;
  if (!Array.isArray(value.burnIns) || !value.burnIns.every((entry) => isRecord(entry)
    && hasExactKeys(entry, ["id", "room", "captureDigest", "gazeStillMs", "decayTicks"])
    && typeof entry.id === "string" && isRoom(entry.room) && isDigest(entry.captureDigest)
    && isIntegerAtLeast(entry.gazeStillMs, 0) && isIntegerAtLeast(entry.decayTicks, 1))) return false;
  return Array.isArray(value.ghostResidues) && value.ghostResidues.every((entry) => isRecord(entry)
    && hasExactKeys(entry, ["id", "position", "sourceRouteDigest", "createdAfterReplay", "persistenceRuns"])
    && typeof entry.id === "string" && validatePosition(entry.position) && isDigest(entry.sourceRouteDigest)
    && entry.createdAfterReplay === true && isIntegerAtLeast(entry.persistenceRuns, 1) && entry.persistenceRuns <= 2);
}

function validateGhostRoute(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value) || !hasExactKeys(value, [
    "source", "sampleIntervalMs", "quantization", "routeDigest", "replayCount", "collisionClass", "rewardClass", "points",
  ])) return false;
  if (value.source !== "ACTUAL_PLAYER_ROUTE" || value.sampleIntervalMs !== GHOST_SAMPLE_INTERVAL_MS
    || value.quantization !== GHOST_QUANTIZATION || !isDigest(value.routeDigest)
    || value.replayCount !== 1 || value.collisionClass !== "NONE" || value.rewardClass !== "NONE"
    || !Array.isArray(value.points) || value.points.length < 2 || value.points.length > 4096) return false;
  let previous = -1;
  for (const point of value.points) {
    if (!isRecord(point) || !hasExactKeys(point, ["tMs", "xNorm", "yNorm", "room", "flower", "focus", "flags"])
      || !isIntegerAtLeast(point.tMs, 0) || point.tMs <= previous
      || !isRatio(point.xNorm) || !isRatio(point.yNorm) || !isRoom(point.room)
      || !isRatio(point.flower) || typeof point.focus !== "boolean"
      || !uniqueStrings(point.flags)
      || !point.flags.every((flag) => (GHOST_FLAGS as readonly string[]).includes(flag))) return false;
    previous = point.tMs;
  }
  return true;
}

function findForbiddenSemantics(value: unknown, path = "$", errors: string[] = []): string[] {
  const forbidden = /(^|[^a-z])(score|rank|victory|good|bad)([^a-z]|$)/i;
  if (typeof value === "string" && forbidden.test(value)) errors.push(`${path}: forbidden evaluative semantic`);
  if (Array.isArray(value)) value.forEach((entry, index) => findForbiddenSemantics(entry, `${path}[${index}]`, errors));
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (forbidden.test(key)) errors.push(`${path}.${key}: forbidden evaluative field`);
      findForbiddenSemantics(entry, `${path}.${key}`, errors);
    }
  }
  return errors;
}

export function validateRunMemory(value: unknown): RunMemoryValidation {
  const errors: string[] = [];
  if (!isRecord(value) || !hasExactKeys(value, [
    "schemaVersion", "run", "metrics", "resolution", "fingerprint", "materialMemory", "ghostRoute", "witnessMemory", "rehydrationOrder",
  ], ["snapshot"])) {
    return {ok: false, errors: ["$: invalid top-level run-memory shape"]};
  }
  if (value.schemaVersion !== RUN_MEMORY_SCHEMA_VERSION) errors.push("$.schemaVersion: unsupported version");

  const run = value.run;
  if (!isRecord(run) || !hasExactKeys(run, ["id", "seed", "startedAtTick", "endedAtTick", "durationMs", "roomsVisited"])
    || !nonEmpty(run.id) || !isIntegerAtLeast(run.seed, 0) || !isIntegerAtLeast(run.startedAtTick, 0)
    || !isIntegerAtLeast(run.endedAtTick, 0) || (typeof run.startedAtTick === "number" && typeof run.endedAtTick === "number" && run.endedAtTick < run.startedAtTick)
    || !isIntegerAtLeast(run.durationMs, 0) || !Array.isArray(run.roomsVisited) || run.roomsVisited.length < 1
    || !run.roomsVisited.every(isRoom) || new Set(run.roomsVisited).size !== run.roomsVisited.length) errors.push("$.run: invalid run identity or timing");

  const metrics = value.metrics;
  if (!isRecord(metrics) || !hasExactKeys(metrics, [
    ...RATIO_METRICS, ...COUNT_METRICS, "dominantRoom", "roomTimeMs", "weatherExposureMs",
  ])) {
    errors.push("$.metrics: invalid metric shape");
  } else {
    for (const key of RATIO_METRICS) if (!isRatio(metrics[key])) errors.push(`$.metrics.${key}: expected ratio`);
    for (const key of COUNT_METRICS) if (!isIntegerAtLeast(metrics[key], 0)) errors.push(`$.metrics.${key}: expected non-negative integer`);
    if (typeof metrics.overrideDirectionUniqueCount === "number" && metrics.overrideDirectionUniqueCount > 8) errors.push("$.metrics.overrideDirectionUniqueCount: exceeds 8");
    if (typeof metrics.distinctRoomsVisited === "number" && (metrics.distinctRoomsVisited < 1 || metrics.distinctRoomsVisited > 4)) errors.push("$.metrics.distinctRoomsVisited: outside 1..4");
    if (!isRoom(metrics.dominantRoom)) errors.push("$.metrics.dominantRoom: unknown room");
    const roomTimeMs = metrics.roomTimeMs;
    if (!isRecord(roomTimeMs) || !hasExactKeys(roomTimeMs, ROOMS)
      || !ROOMS.every((room) => isIntegerAtLeast(roomTimeMs[room], 0))) errors.push("$.metrics.roomTimeMs: invalid room timings");
    const weatherExposureMs = metrics.weatherExposureMs;
    if (!isRecord(weatherExposureMs) || !hasExactKeys(weatherExposureMs, WEATHER)
      || !WEATHER.every((weather) => isIntegerAtLeast(weatherExposureMs[weather], 0))) errors.push("$.metrics.weatherExposureMs: invalid weather timings");
  }

  const resolution = value.resolution;
  if (!isRecord(resolution) || !hasExactKeys(resolution, ["reason", "bossId", "factEventId"])
    || typeof resolution.reason !== "string" || !(RESOLUTION_REASONS as readonly string[]).includes(resolution.reason)
    || !(resolution.bossId === null || typeof resolution.bossId === "string") || !nonEmpty(resolution.factEventId)) errors.push("$.resolution: invalid factual resolution");

  const fingerprint = value.fingerprint;
  if (!isRecord(fingerprint) || !hasExactKeys(fingerprint, ["seed", "generator", "digestSha256", "bitDepth"])
    || !isIntegerAtLeast(fingerprint.seed, 0) || fingerprint.generator !== FINGERPRINT_GENERATOR
    || !isDigest(fingerprint.digestSha256) || fingerprint.bitDepth !== 1) errors.push("$.fingerprint: invalid fingerprint");

  if (!validateMaterialMemory(value.materialMemory)) errors.push("$.materialMemory: invalid typed material remainder");
  if (!validateGhostRoute(value.ghostRoute)) errors.push("$.ghostRoute: invalid actual-route replay");

  if (!Array.isArray(value.witnessMemory) || !value.witnessMemory.every((entry) => isRecord(entry)
    && hasExactKeys(entry, ["id", "room", "state", "facingTarget", "sourceFactIds"])
    && typeof entry.id === "string" && isRoom(entry.room)
    && typeof entry.state === "string" && (WITNESS_STATES as readonly string[]).includes(entry.state)
    && (entry.facingTarget === null || typeof entry.facingTarget === "string")
    && uniqueStrings(entry.sourceFactIds, 1))) errors.push("$.witnessMemory: invalid witness fact references");

  if (value.snapshot !== undefined) {
    const snapshot = value.snapshot;
    if (!isRecord(snapshot) || !hasExactKeys(snapshot, ["observationIds", "behaviorTags"])
      || !uniqueStrings(snapshot.observationIds, 1, 3) || !uniqueStrings(snapshot.behaviorTags)) errors.push("$.snapshot: invalid observation snapshot");
  }

  const rehydrationOrder = value.rehydrationOrder;
  if (!Array.isArray(rehydrationOrder)
    || rehydrationOrder.length !== REHYDRATION_ORDER.length
    || !REHYDRATION_ORDER.every((entry, index) => rehydrationOrder[index] === entry)) errors.push("$.rehydrationOrder: unsafe restore order");

  errors.push(...findForbiddenSemantics(value));
  return {ok: errors.length === 0, errors};
}

export function assertRunMemory(value: unknown): asserts value is RunMemory {
  const validation = validateRunMemory(value);
  if (!validation.ok) throw new Error(`Invalid V4 run memory: ${validation.errors.join("; ")}`);
}

export function parseRunMemory(serialized: string): RunMemory {
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error("Invalid V4 run memory: malformed JSON");
  }
  assertRunMemory(value);
  return value;
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function quantizeRatio(value: number): number {
  return Math.round(clampRatio(value) * 1024) / 1024;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function pushCborUnsigned(output: number[], value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("canonical CBOR route fields must be unsigned safe integers");
  if (value < 24) output.push(value);
  else if (value <= 0xff) output.push(0x18, value);
  else if (value <= 0xffff) output.push(0x19, (value >>> 8) & 0xff, value & 0xff);
  else if (value <= 0xffffffff) output.push(0x1a, (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
  else {
    const high = Math.floor(value / 0x1_0000_0000);
    const low = value >>> 0;
    output.push(0x1b, (high >>> 24) & 0xff, (high >>> 16) & 0xff, (high >>> 8) & 0xff, high & 0xff,
      (low >>> 24) & 0xff, (low >>> 16) & 0xff, (low >>> 8) & 0xff, low & 0xff);
  }
}

function pushCborArrayHeader(output: number[], length: number): void {
  const start = output.length;
  pushCborUnsigned(output, length);
  output[start] = (output[start] ?? 0) | 0x80;
}

function canonicalRouteBytes(points: readonly GhostPoint[]): Uint8Array {
  const output: number[] = [];
  pushCborArrayHeader(output, points.length);
  for (const point of points) {
    pushCborArrayHeader(output, 7);
    const flagMask = point.flags.reduce((mask, flag) => mask | (1 << GHOST_FLAGS.indexOf(flag)), 0);
    const fields = [
      point.tMs,
      Math.round(point.xNorm * 1024),
      Math.round(point.yNorm * 1024),
      ROOMS.indexOf(point.room),
      Math.round(point.flower * 1024),
      point.focus ? 1 : 0,
      flagMask,
    ];
    fields.forEach((field) => pushCborUnsigned(output, field));
  }
  return new Uint8Array(output);
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
  const hash = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const a = words[index - 15] ?? 0;
      const b = words[index - 2] ?? 0;
      const s0 = rotateRight(a, 7) ^ rotateRight(a, 18) ^ (a >>> 3);
      const s1 = rotateRight(b, 17) ^ rotateRight(b, 19) ^ (b >>> 10);
      words[index] = ((words[index - 16] ?? 0) + s0 + (words[index - 7] ?? 0) + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sigma1 = rotateRight(e ?? 0, 6) ^ rotateRight(e ?? 0, 11) ^ rotateRight(e ?? 0, 25);
      const choice = ((e ?? 0) & (f ?? 0)) ^ (~(e ?? 0) & (g ?? 0));
      const temp1 = ((h ?? 0) + sigma1 + choice + (constants[index] ?? 0) + (words[index] ?? 0)) >>> 0;
      const sigma0 = rotateRight(a ?? 0, 2) ^ rotateRight(a ?? 0, 13) ^ rotateRight(a ?? 0, 22);
      const majority = ((a ?? 0) & (b ?? 0)) ^ ((a ?? 0) & (c ?? 0)) ^ ((b ?? 0) & (c ?? 0));
      const temp2 = (sigma0 + majority) >>> 0;
      h = g; g = f; f = e; e = ((d ?? 0) + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

declare const recorderIssuedRunMemoryTokenBrand: unique symbol;

/** Opaque proof that an unchanged in-memory recorder result owns its route provenance. */
export interface RecorderIssuedRunMemoryToken {
  readonly [recorderIssuedRunMemoryTokenBrand]: "RecorderIssuedRunMemoryToken";
}

const RECORDER_ISSUED_RUN_MEMORY = new WeakMap<object, FinalizedRunMemory>();
const RECORDER_ISSUED_RUN_MEMORY_TOKENS = new WeakMap<
  RecorderIssuedRunMemoryToken,
  FinalizedRunMemory
>();

function deepFreezeRunMemoryValue<T>(value: T): RecursiveReadonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value as RecursiveReadonly<T>;
  }
  for (const key of Reflect.ownKeys(value)) {
    deepFreezeRunMemoryValue((value as Record<PropertyKey, unknown>)[key]);
  }
  return Object.freeze(value) as RecursiveReadonly<T>;
}

function registerRecorderIssuedRunMemory(memory: RunMemory): FinalizedRunMemory {
  const snapshot = deepFreezeRunMemoryValue(clone(memory));
  // The exact recorder result is immutable before it becomes a provenance
  // capability. Capture can therefore inspect only recorder-authored data
  // properties; callers cannot substitute getters or stale values afterward.
  const finalizedMemory = deepFreezeRunMemoryValue(memory);
  RECORDER_ISSUED_RUN_MEMORY.set(finalizedMemory, snapshot);
  return finalizedMemory;
}

/**
 * Mint an authority capability only from the unchanged object returned by
 * RunMemoryRecorder.finalize(). A parsed, cloned, or edited shape-valid record
 * cannot recover the unavailable uncompressed route provenance.
 */
export function captureRecorderIssuedRunMemory(
  value: unknown,
): RecorderIssuedRunMemoryToken {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("trusted run memory capture requires a recorder-issued in-memory result");
  }
  const snapshot = RECORDER_ISSUED_RUN_MEMORY.get(value);
  if (snapshot === undefined) {
    throw new Error(
      "trusted run memory capture rejects raw, cloned, parsed, or persisted records",
    );
  }
  const token = Object.freeze(Object.create(null)) as RecorderIssuedRunMemoryToken;
  RECORDER_ISSUED_RUN_MEMORY_TOKENS.set(token, snapshot);
  return token;
}

/** Internal-authority read of a recorder-issued immutable snapshot. */
export function readRecorderIssuedRunMemory(
  tokenValue: unknown,
): FinalizedRunMemory {
  if (typeof tokenValue !== "object" || tokenValue === null) {
    throw new Error("cross-run restore requires an opaque recorder-issued run memory token");
  }
  const memory = RECORDER_ISSUED_RUN_MEMORY_TOKENS.get(
    tokenValue as RecorderIssuedRunMemoryToken,
  );
  if (memory === undefined) {
    throw new Error("cross-run restore requires an opaque recorder-issued run memory token");
  }
  return memory;
}

function isEventPin(point: GhostPoint): boolean {
  return point.flags.length > 0;
}

function perpendicularDistance(point: GhostPoint, start: GhostPoint, end: GhostPoint): number {
  const dx = end.xNorm - start.xNorm;
  const dy = end.yNorm - start.yNorm;
  if (dx === 0 && dy === 0) return Math.hypot(point.xNorm - start.xNorm, point.yNorm - start.yNorm);
  const projection = ((point.xNorm - start.xNorm) * dx + (point.yNorm - start.yNorm) * dy) / (dx * dx + dy * dy);
  const x = start.xNorm + projection * dx;
  const y = start.yNorm + projection * dy;
  return Math.hypot(point.xNorm - x, point.yNorm - y);
}

function simplifyUnpinned(points: readonly GhostPoint[], tolerance: number): GhostPoint[] {
  if (points.length <= 2) return [...points];
  let maximum = -1;
  let split = 0;
  const start = points[0] as GhostPoint;
  const end = points[points.length - 1] as GhostPoint;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = perpendicularDistance(points[index] as GhostPoint, start, end);
    if (distance > maximum) {
      maximum = distance;
      split = index;
    }
  }
  if (maximum <= tolerance) return [start, end];
  const left = simplifyUnpinned(points.slice(0, split + 1), tolerance);
  const right = simplifyUnpinned(points.slice(split), tolerance);
  return [...left.slice(0, -1), ...right];
}

function compressWithPins(points: readonly GhostPoint[], tolerance: number): GhostPoint[] {
  if (points.length <= 2) return [...points];
  const pinIndices = points.map((point, index) => isEventPin(point) ? index : -1).filter((index) => index >= 0);
  const boundaries = Array.from(new Set([0, ...pinIndices, points.length - 1])).sort((a, b) => a - b);
  const result: GhostPoint[] = [];
  for (let index = 1; index < boundaries.length; index += 1) {
    const start = boundaries[index - 1] as number;
    const end = boundaries[index] as number;
    const section = simplifyUnpinned(points.slice(start, end + 1), tolerance);
    result.push(...(result.length === 0 ? section : section.slice(1)));
  }
  return result;
}

function canonicalFactOrder(left: SegmentBehaviorFact, right: SegmentBehaviorFact): number {
  const segmentOrder = left.segmentId < right.segmentId ? -1 : left.segmentId > right.segmentId ? 1 : 0;
  const eventOrder = left.eventId < right.eventId ? -1 : left.eventId > right.eventId ? 1 : 0;
  return left.atTick - right.atTick || segmentOrder || eventOrder;
}

export class RunMemoryRecorder {
  readonly runId: string;
  readonly seed: number;
  readonly startedAtTick: number;
  readonly tickHz: number;

  private readonly facts: SegmentBehaviorFact[] = [];
  private readonly routeSamples: GhostPoint[] = [];
  private readonly materialMemory: MaterialMemory = {overrideScars: [], deathTraces: [], burnIns: [], ghostResidues: []};
  private readonly witnesses: WitnessMemory[] = [];

  constructor(options: RunMemoryRecorderOptions) {
    if (!nonEmpty(options.runId)) throw new Error("run id must be non-empty");
    if (!isIntegerAtLeast(options.seed, 0)) throw new Error("run seed must be a non-negative integer");
    if (!isIntegerAtLeast(options.startedAtTick, 0)) throw new Error("start tick must be a non-negative integer");
    if (!(typeof options.tickHz === "undefined" || (Number.isFinite(options.tickHz) && options.tickHz > 0))) throw new Error("tick rate must be positive");
    this.runId = options.runId;
    this.seed = options.seed;
    this.startedAtTick = options.startedAtTick;
    this.tickHz = options.tickHz ?? 60;
  }

  recordBehaviorFact(fact: SegmentBehaviorFact): void {
    if (!nonEmpty(fact.segmentId) || !nonEmpty(fact.eventId) || !isRoom(fact.room) || !isIntegerAtLeast(fact.atTick, this.startedAtTick)) {
      throw new Error("behavior fact has invalid identity, room, or tick");
    }
    if (fact.amount !== undefined && (!Number.isFinite(fact.amount) || fact.amount < 0)) throw new Error("behavior fact amount must be finite and non-negative");
    if (fact.kind === "LIGHT_SAMPLE" && (fact.amount === undefined || fact.amount > 1)) throw new Error("light sample must be a ratio");
    if (fact.kind === "OVERRIDE_COMMIT" && (fact.direction8 === undefined || !DIRECTIONS.includes(fact.direction8))) throw new Error("Override fact requires a direction");
    if (fact.kind === "WEATHER_EXPOSURE" && (fact.weather === undefined || !WEATHER.includes(fact.weather))) throw new Error("weather exposure requires a weather id");
    if (findForbiddenSemantics(fact).length > 0) throw new Error("behavior fact contains evaluative semantics");
    this.facts.push(clone(fact));
  }

  behaviorFacts(): readonly SegmentBehaviorFact[] {
    return this.facts.map(clone).sort(canonicalFactOrder);
  }

  recordGhostPoint(point: GhostPoint): void {
    if (!isIntegerAtLeast(point.tMs, 0) || !isRatio(point.xNorm) || !isRatio(point.yNorm) || !isRoom(point.room)
      || !isRatio(point.flower) || typeof point.focus !== "boolean"
      || !Array.isArray(point.flags) || !point.flags.every((flag) => GHOST_FLAGS.includes(flag))
      || new Set(point.flags).size !== point.flags.length) throw new Error("ghost point violates the V4 actual-route contract");
    if (this.routeSamples.some((sample) => sample.tMs === point.tMs)) throw new Error("ghost route timestamps must be unique");
    this.routeSamples.push({
      ...clone(point),
      xNorm: quantizeRatio(point.xNorm),
      yNorm: quantizeRatio(point.yNorm),
      flower: quantizeRatio(point.flower),
      flags: [...point.flags].sort((left, right) => GHOST_FLAGS.indexOf(left) - GHOST_FLAGS.indexOf(right)),
    });
  }

  addOverrideScar(value: OverrideScar): void { this.materialMemory.overrideScars.push(clone(value)); }
  addDeathTrace(value: DeathTrace): void { this.materialMemory.deathTraces.push(clone(value)); }
  addBurnIn(value: BurnIn): void { this.materialMemory.burnIns.push(clone(value)); }
  addGhostResidue(value: GhostResidue): void { this.materialMemory.ghostResidues.push(clone(value)); }
  recordWitness(value: WitnessMemory): void { this.witnesses.push(clone(value)); }

  finalize(options: RunMemoryFinalizeOptions): FinalizedRunMemory {
    if (!isIntegerAtLeast(options.endedAtTick, this.startedAtTick)) throw new Error("end tick precedes the run start");
    const durationMs = options.durationMs ?? Math.round((options.endedAtTick - this.startedAtTick) * 1000 / this.tickHz);
    if (!isIntegerAtLeast(durationMs, 0)) throw new Error("duration must be a non-negative integer");
    const facts = this.behaviorFacts();
    const ghostRoute = this.buildGhostRoute();
    const inferredRooms = [...facts.map((fact) => fact.room), ...(ghostRoute?.points.map((point) => point.room) ?? [])];
    const roomsVisited = Array.from(new Set(options.roomsVisited ?? inferredRooms));
    if (roomsVisited.length < 1 || !roomsVisited.every(isRoom)) throw new Error("run memory needs at least one visited room");
    const metrics = this.aggregateMetrics(facts, ghostRoute, durationMs, roomsVisited);
    const materialMemory = clone(this.materialMemory);
    const witnessMemory = clone(this.witnesses);
    const fingerprintSource = {
      seed: this.seed,
      facts,
      ghostRouteDigest: ghostRoute?.routeDigest ?? null,
      materialMemory,
      witnessMemory,
      resolution: options.resolution,
    };
    const fingerprintBytes = new TextEncoder().encode(stableStringify(fingerprintSource));
    const memory: RunMemory = {
      schemaVersion: RUN_MEMORY_SCHEMA_VERSION,
      run: {
        id: this.runId,
        seed: this.seed,
        startedAtTick: this.startedAtTick,
        endedAtTick: options.endedAtTick,
        durationMs,
        roomsVisited,
      },
      metrics,
      resolution: clone(options.resolution),
      fingerprint: {
        seed: this.seed,
        generator: FINGERPRINT_GENERATOR,
        digestSha256: sha256(fingerprintBytes),
        bitDepth: 1,
      },
      materialMemory,
      ghostRoute,
      witnessMemory,
      rehydrationOrder: [...REHYDRATION_ORDER],
    };
    if (options.observationIds !== undefined || options.behaviorTags !== undefined) {
      memory.snapshot = {
        observationIds: Array.from(new Set(options.observationIds ?? [])),
        behaviorTags: Array.from(new Set(options.behaviorTags ?? [])),
      };
    }
    assertRunMemory(memory);
    return registerRecorderIssuedRunMemory(memory);
  }

  private buildGhostRoute(): GhostRoute | null {
    const ordered = this.routeSamples.map(clone).sort((left, right) => left.tMs - right.tMs);
    if (ordered.length < 2) return null;
    const captured: GhostPoint[] = [];
    let lastPeriodicSampleMs = Number.NEGATIVE_INFINITY;
    ordered.forEach((point, index) => {
      const periodic = index === 0 || point.tMs - lastPeriodicSampleMs >= GHOST_SAMPLE_INTERVAL_MS;
      const endpoint = index === ordered.length - 1;
      if (periodic || endpoint || isEventPin(point)) captured.push(point);
      if (periodic) lastPeriodicSampleMs = point.tMs;
    });
    let tolerance = 0.75 / 1024;
    let compressed = compressWithPins(captured, tolerance);
    while (compressed.length > 4096 && tolerance < 1) {
      tolerance *= 2;
      compressed = compressWithPins(captured, tolerance);
    }
    if (compressed.length > 4096) throw new Error("ghost route contains more than 4096 event pins");
    return {
      source: "ACTUAL_PLAYER_ROUTE",
      sampleIntervalMs: GHOST_SAMPLE_INTERVAL_MS,
      quantization: GHOST_QUANTIZATION,
      routeDigest: sha256(canonicalRouteBytes(captured)),
      replayCount: 1,
      collisionClass: "NONE",
      rewardClass: "NONE",
      points: compressed,
    };
  }

  private aggregateMetrics(
    facts: readonly SegmentBehaviorFact[],
    ghostRoute: GhostRoute | null,
    durationMs: number,
    roomsVisited: readonly RoomId[],
  ): BehaviorMetrics {
    const roomTimeMs: Record<RoomId, number> = {INFORMATION: 0, FORCED_ALIGNMENT: 0, IN_BETWEEN: 0, POLARIZED: 0};
    const weatherExposureMs: Record<WeatherId, number> = {STATIC: 0, RAIN: 0, ASH: 0, WIND: 0, ECLIPSE: 0};
    const lightSamples: number[] = [];
    const uniqueGrazes = new Set<string>();
    const overrideDirections = new Set<Direction8>();
    let gazeDwellMs = 0;
    let focusDwellMs = 0;
    let seamDwellMs = 0;
    const metrics: BehaviorMetrics = {
      meanLight: 0,
      quietLightRatio: 0,
      middleLightRatio: 0,
      loudLightRatio: 0,
      lightBandChanges: 0,
      gazeRatio: 0,
      gazeClampCount: 0,
      gazeAcquireCount: 0,
      gazeStillMaxMs: 0,
      incompleteReads: 0,
      readPredictionMismatchStreak: 0,
      focusDwellRatio: 0,
      focusEntryCount: 0,
      focusReleaseBeforeImpactCount: 0,
      grazeEvidenceCount: 0,
      grazeEvidenceSpent: 0,
      uniqueBulletsGrazed: 0,
      overrideCount: 0,
      overrideDirectionUniqueCount: 0,
      overrideDuringGazeCount: 0,
      overrideScarRuleIntersections: 0,
      witnessResistanceTransmissionCount: 0,
      damageCount: 0,
      seamDwellRatio: 0,
      seamCrossings: 0,
      fallResetCount: 0,
      stableIntersectionDwellMs: 0,
      routeWidth: 0,
      distinctRoomsVisited: roomsVisited.length,
      roomReentries: 0,
      roomThresholdCrossings: 0,
      dominantRoom: roomsVisited[0] as RoomId,
      cableUploadEvents: 0,
      snapshotEchoCount: 0,
      witnessesTurnedDuringEclipse: 0,
      noDuskCycles: 0,
      roomTimeMs,
      weatherExposureMs,
    };
    const amount = (fact: SegmentBehaviorFact, fallback = 1): number => Math.round(fact.amount ?? fallback);
    for (const fact of facts) {
      switch (fact.kind) {
        case "LIGHT_SAMPLE": lightSamples.push(fact.amount as number); break;
        case "LIGHT_BAND_CHANGE": metrics.lightBandChanges += amount(fact); break;
        case "GAZE_DWELL": gazeDwellMs += amount(fact); break;
        case "GAZE_CLAMP": metrics.gazeClampCount += amount(fact); break;
        case "GAZE_ACQUIRE": metrics.gazeAcquireCount += amount(fact); break;
        case "GAZE_STILL": metrics.gazeStillMaxMs = Math.max(metrics.gazeStillMaxMs, amount(fact)); break;
        case "INCOMPLETE_READ": metrics.incompleteReads += amount(fact); break;
        case "READ_MISMATCH_STREAK": metrics.readPredictionMismatchStreak = Math.max(metrics.readPredictionMismatchStreak, amount(fact)); break;
        case "FOCUS_DWELL": focusDwellMs += amount(fact); break;
        case "FOCUS_ENTER": metrics.focusEntryCount += amount(fact); break;
        case "FOCUS_RELEASE_BEFORE_IMPACT": metrics.focusReleaseBeforeImpactCount += amount(fact); break;
        case "GRAZE_EVIDENCE":
          metrics.grazeEvidenceCount += amount(fact);
          uniqueGrazes.add(fact.sourceId ?? fact.eventId);
          break;
        case "GRAZE_EVIDENCE_SPENT": metrics.grazeEvidenceSpent += amount(fact); break;
        case "OVERRIDE_COMMIT":
          metrics.overrideCount += amount(fact);
          if (fact.direction8) overrideDirections.add(fact.direction8);
          break;
        case "OVERRIDE_DURING_GAZE": metrics.overrideDuringGazeCount += amount(fact); break;
        case "OVERRIDE_SCAR_RULE_INTERSECTION": metrics.overrideScarRuleIntersections += amount(fact); break;
        case "WITNESS_RESISTANCE_TRANSMISSION": metrics.witnessResistanceTransmissionCount += amount(fact); break;
        case "DAMAGE_COMMIT": metrics.damageCount += amount(fact); break;
        case "SEAM_DWELL": seamDwellMs += amount(fact); break;
        case "SEAM_CROSS": metrics.seamCrossings += amount(fact); break;
        case "FALL_RESET": metrics.fallResetCount += amount(fact); break;
        case "STABLE_INTERSECTION_DWELL": metrics.stableIntersectionDwellMs += amount(fact); break;
        case "ROOM_ENTER": break;
        case "ROOM_DWELL": roomTimeMs[fact.room] += amount(fact); break;
        case "ROOM_THRESHOLD_CROSS": metrics.roomThresholdCrossings += amount(fact); break;
        case "CABLE_UPLOAD": metrics.cableUploadEvents += amount(fact); break;
        case "SNAPSHOT_ECHO": metrics.snapshotEchoCount += amount(fact); break;
        case "WITNESS_TURN_DURING_ECLIPSE": metrics.witnessesTurnedDuringEclipse += amount(fact); break;
        case "NO_DUSK_CYCLE": metrics.noDuskCycles += amount(fact); break;
        case "WEATHER_EXPOSURE":
          if (fact.weather) weatherExposureMs[fact.weather] += amount(fact);
          break;
      }
    }
    const enteredRooms = facts.filter((fact) => fact.kind === "ROOM_ENTER").map((fact) => fact.room);
    metrics.roomReentries = enteredRooms.reduce((count, room, index) => enteredRooms.indexOf(room) < index ? count + 1 : count, 0);
    metrics.uniqueBulletsGrazed = uniqueGrazes.size;
    metrics.overrideDirectionUniqueCount = overrideDirections.size;
    const safeDuration = Math.max(1, durationMs);
    metrics.gazeRatio = clampRatio(gazeDwellMs / safeDuration);
    metrics.focusDwellRatio = clampRatio(focusDwellMs / safeDuration);
    metrics.seamDwellRatio = clampRatio(seamDwellMs / safeDuration);
    if (lightSamples.length > 0) {
      metrics.meanLight = lightSamples.reduce((sum, value) => sum + value, 0) / lightSamples.length;
      metrics.quietLightRatio = lightSamples.filter((value) => value < 1 / 3).length / lightSamples.length;
      metrics.middleLightRatio = lightSamples.filter((value) => value >= 1 / 3 && value <= 2 / 3).length / lightSamples.length;
      metrics.loudLightRatio = lightSamples.filter((value) => value > 2 / 3).length / lightSamples.length;
    }
    if (ghostRoute) {
      const xs = ghostRoute.points.map((point) => point.xNorm);
      metrics.routeWidth = clampRatio(Math.max(...xs) - Math.min(...xs));
    }
    metrics.dominantRoom = roomsVisited.reduce((dominant, room) => roomTimeMs[room] > roomTimeMs[dominant] ? room : dominant, roomsVisited[0] as RoomId);
    return metrics;
  }
}
