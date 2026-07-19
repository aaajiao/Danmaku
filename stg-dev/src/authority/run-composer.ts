import bossManifestJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/boss-rigs-v4.json";
import encounterManifestJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/encounter-director-v4.json";
import patternManifestJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/executable-patterns-v4.json";
import roomManifestJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/room-composers-v4.json";
import runManifestJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/run-director-v4.json";
import signatureReportJson from "../../../1bit-stg-complete-asset-kit-v4/gameplay/reports/pattern-structure-signatures-v4.json";

type UnknownRecord = Record<string, unknown>;

const SCHEMA_VERSION = "4.0.0";
const QA_DEFAULT_ROOM_COUNT = 3 as const;
const QA_PATTERNS_PER_ROOM = 3 as const;
const QA_ROOM_ENTRY_DELAY_MS = 1200;
const IMMEDIATE_SIGNATURE_PENALTY = 0.15;
const MINIMUM_WEIGHT = 0.0001;
const UINT32_MAXIMUM = 0xffff_ffff;
const LIVE_RUNTIME_SEED_OMISSION = "difficulty-salt-not-authored" as const;

export const V4_RUN_COMPOSER_METRIC_IDS = Object.freeze([
  "avgFlower",
  "gazeRatio",
  "overrideRatio",
  "recentInputDensity",
  "unansweredActions",
  "sideCommitment",
  "crackRatio",
  "sideSwitches",
  "contextSwitches",
  "intersectionHold",
  "correctionLatency",
  "binarySwitches",
  "highLightRatio",
  "noDuskTicks",
] as const);

export type V4RunComposerMetricId = typeof V4_RUN_COMPOSER_METRIC_IDS[number];
export type V4RunComposerMetrics = Readonly<Record<V4RunComposerMetricId, number>>;
export type V4QaRoomCount = 2 | 3 | 4;

interface QaPattern {
  readonly id: string;
  readonly durationMs: number;
  readonly seedBase: number;
  readonly residueType: string;
  readonly structuralSignature: string;
}

interface QaPatternPoolEntry {
  readonly patternId: string;
  readonly baseWeight: number;
  readonly cooldownEncounters: number;
}

interface QaTier {
  readonly id: string;
  readonly difficulty: string;
  readonly restMs: number;
}

interface QaComposer {
  readonly id: string;
  readonly room: string;
  readonly patterns: readonly QaPatternPoolEntry[];
  readonly metricWeights: readonly (readonly [string, number])[];
  readonly tiers: readonly [QaTier, QaTier, QaTier];
}

interface QaBossPhase {
  readonly id: string;
  readonly patternId: string;
}

interface QaBoss {
  readonly id: string;
  readonly room: string;
  readonly terminalEvent: string;
  readonly phases: readonly QaBossPhase[];
}

interface QaCatalog {
  readonly patternsById: ReadonlyMap<string, QaPattern>;
  readonly composers: readonly QaComposer[];
  readonly bosses: readonly QaBoss[];
  readonly minimumRooms: number;
  readonly maximumRooms: number;
  readonly transitionPattern: QaPattern;
  readonly duskPattern: QaPattern;
}

export interface V4RunComposerOptions {
  /** Raw V4 Run seed. A caller-resolved First Eye encounter seed is not interchangeable. */
  readonly rawRunSeed: number;
  /** Explicit behavior ledger fixture. No live behavior metrics are inferred by this adapter. */
  readonly metrics: V4RunComposerMetrics;
  /** Omission means the immutable Python QA oracle default of three rooms, not a live policy. */
  readonly roomCount?: V4QaRoomCount;
}

export interface V4QaScheduleEvent {
  readonly atMs: number;
  readonly event: string;
  readonly room?: string;
  readonly roomOrdinal?: number;
  readonly patternId?: string;
  readonly difficulty?: string;
  readonly encounterOrdinal?: number;
  readonly seed?: number;
  readonly residue?: string;
  readonly bossId?: string;
  readonly resolution?: string;
  readonly phaseId?: string;
}

export interface V4RunComposerQaPayload {
  readonly runSeed: number;
  readonly metrics: V4RunComposerMetrics;
  readonly rooms: readonly string[];
  readonly bossId: string;
  readonly durationMs: number;
  readonly schedule: readonly V4QaScheduleEvent[];
  readonly traceSha256: string;
}

export type V4QaPatternSeedKind = "encounter" | "transition" | "boss-phase" | "dusk";

export interface V4QaPatternSeedRecord {
  readonly kind: V4QaPatternSeedKind;
  readonly patternId: string;
  readonly roomOrdinal: number | null;
  readonly encounterOrdinal: number | null;
  /** Encounter-director identity seed; it is not a complete executable-pattern seed. */
  readonly encounterIdentitySeed: number | null;
  /** Exact seed emitted by gameplay/tools/sim_core.py compose_run. */
  readonly qaPatternSeed: number;
  /** Deliberately unresolved because V4 names, but does not define, difficultySalt. */
  readonly liveRuntimePatternSeed: null;
  readonly liveRuntimeSeedOmission: typeof LIVE_RUNTIME_SEED_OMISSION;
}

export interface V4RunComposerPlan {
  readonly provenance: Readonly<{
    source: "v4-gameplay-tools-sim-core-compose-run";
    schemaVersion: typeof SCHEMA_VERSION;
    rawRunSeedAuthority: "caller-supplied-v4-run-seed";
    metricsAuthority: "caller-supplied-explicit-behavior-fixture";
    roomCountAuthority: "qa-oracle-default-3" | "caller-supplied-authored-range";
    canonicalEventBus: false;
    liveIntegration: false;
    parallelWeatherScheduled: false;
  }>;
  readonly qa: V4RunComposerQaPayload;
  readonly seedLedger: readonly V4QaPatternSeedRecord[];
}

export interface V4QaPatternCandidate {
  readonly id: string;
  readonly baseWeight: number;
  readonly structuralSignature: string;
}

function record(value: unknown, path: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as UnknownRecord;
}

function ownPlainDataRecord(value: unknown, path: string): UnknownRecord {
  const source = record(value, path);
  const prototype = Object.getPrototypeOf(source) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${path} must be a plain object`);
  }
  if (Object.getOwnPropertySymbols(source).length > 0) {
    throw new Error(`${path} must not contain symbol keys`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(source);
  const captured: UnknownRecord = Object.create(null) as UnknownRecord;
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!("value" in descriptor) || descriptor.enumerable !== true) {
      throw new Error(`${path}.${key} must be an enumerable own data property`);
    }
    captured[key] = descriptor.value;
  }
  return captured;
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${path} must be a non-empty string`);
  return value;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be finite`);
  return value;
}

function integer(value: unknown, path: string): number {
  const parsed = finite(value, path);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${path} must be a safe integer`);
  return parsed;
}

function nonNegativeInteger(value: unknown, path: string): number {
  const parsed = integer(value, path);
  if (parsed < 0) throw new Error(`${path} must be non-negative`);
  return parsed;
}

function positiveInteger(value: unknown, path: string): number {
  const parsed = nonNegativeInteger(value, path);
  if (parsed === 0) throw new Error(`${path} must be positive`);
  return parsed;
}

function uint32(value: unknown, path: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    Object.is(value, -0) ||
    value < 0 ||
    value > UINT32_MAXIMUM
  ) {
    throw new Error(`${path} must be a uint32`);
  }
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} must be boolean`);
  return value;
}

function hasOwn(value: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function uniqueStrings(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${path} must contain unique strings`);
}

function freezeRecord<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
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

function pythonRound(value: number, digits: number): number {
  const factor = 10 ** digits;
  const scaled = value * factor;
  const lower = Math.floor(scaled);
  const fraction = scaled - lower;
  if (Math.abs(fraction - 0.5) <= Number.EPSILON * Math.max(1, Math.abs(scaled)) * 2) {
    return (lower % 2 === 0 ? lower : lower + 1) / factor;
  }
  return Math.round(scaled) / factor;
}

function pythonCanonicalJson(
  value: unknown,
  numberModeAt: (
    path: readonly (string | number)[],
  ) => "default" | "python-float" | "json-fixture-number" = () => "default",
): string {
  const encode = (entry: unknown, path: readonly (string | number)[]): string => {
    if (entry === null) return "null";
    if (typeof entry === "boolean") return entry ? "true" : "false";
    if (typeof entry === "string") return JSON.stringify(entry);
    if (typeof entry === "number") {
      if (!Number.isFinite(entry)) throw new Error("Python canonical JSON cannot encode non-finite numbers");
      const numberMode = numberModeAt(path);
      if (numberMode === "python-float") return pythonFloatString(entry);
      if (numberMode === "json-fixture-number" && !Number.isInteger(entry)) {
        return pythonFloatString(entry);
      }
      if (Object.is(entry, -0)) return "-0.0";
      return String(entry);
    }
    if (Array.isArray(entry)) {
      return `[${entry.map((item, index) => encode(item, [...path, index])).join(",")}]`;
    }
    if (typeof entry === "object") {
      const object = entry as Record<string, unknown>;
      const keys = Object.keys(object).sort(compareCodePoints);
      return `{${keys.map((key) => `${JSON.stringify(key)}:${encode(object[key], [...path, key])}`).join(",")}}`;
    }
    throw new Error(`Python canonical JSON cannot encode ${typeof entry}`);
  };
  return encode(value, []);
}

function pythonFloatString(value: number): string {
  if (!Number.isFinite(value)) throw new Error("Python float must be finite");
  if (Object.is(value, -0)) return "-0.0";
  if (value === 0) return "0.0";
  const sign = value < 0 ? "-" : "";
  const [rawMantissa, rawExponent] = Math.abs(value).toExponential().split("e");
  if (rawMantissa === undefined || rawExponent === undefined) {
    throw new Error("JavaScript exponential formatting failed");
  }
  const exponent = Number(rawExponent);
  if (!Number.isSafeInteger(exponent)) throw new Error("Python float exponent must be an integer");
  if (exponent < -4 || exponent >= 16) {
    const exponentSign = exponent < 0 ? "-" : "+";
    return `${sign}${rawMantissa}e${exponentSign}${Math.abs(exponent).toString().padStart(2, "0")}`;
  }
  const digits = rawMantissa.replace(".", "");
  const decimalIndex = exponent + 1;
  if (decimalIndex <= 0) {
    return `${sign}0.${"0".repeat(-decimalIndex)}${digits}`;
  }
  if (decimalIndex >= digits.length) {
    return `${sign}${digits}${"0".repeat(decimalIndex - digits.length)}.0`;
  }
  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

function patternStructuralSignature(rawPattern: UnknownRecord, path: string): string {
  const durationMs = positiveInteger(rawPattern.durationMs, `${path}.durationMs`);
  const normalizedEmitters = array(rawPattern.emitters, `${path}.emitters`).map((rawEmitter, index) => {
    const emitter = record(rawEmitter, `${path}.emitters[${index}]`);
    const geometry = record(emitter.geometry, `${path}.emitters[${index}].geometry`);
    const cadence = record(emitter.cadence, `${path}.emitters[${index}].cadence`);
    const speedCurve = record(emitter.speedCurve, `${path}.emitters[${index}].speedCurve`);
    const speedKeys = array(speedCurve.keys, `${path}.emitters[${index}].speedCurve.keys`).map(
      (rawKey, keyIndex) => record(rawKey, `${path}.emitters[${index}].speedCurve.keys[${keyIndex}]`),
    );
    if (speedKeys.length === 0) throw new Error(`${path}.emitters[${index}].speedCurve.keys must not be empty`);
    const speeds = speedKeys.map((key, keyIndex) =>
      finite(key.pxPerSec, `${path}.emitters[${index}].speedCurve.keys[${keyIndex}].pxPerSec`));
    const firstSpeed = speeds[0] as number;
    const lastSpeed = speeds[speeds.length - 1] as number;
    const motion = array(emitter.motionStack, `${path}.emitters[${index}].motionStack`).map(
      (rawMotion, motionIndex) => record(rawMotion, `${path}.emitters[${index}].motionStack[${motionIndex}]`),
    );
    return {
      geometry: string(geometry.type, `${path}.emitters[${index}].geometry.type`),
      countBand: Math.floor(finite(geometry.count, `${path}.emitters[${index}].geometry.count`) / 3),
      spreadBand: Math.floor(finite(geometry.spreadDeg, `${path}.emitters[${index}].geometry.spreadDeg`) / 30),
      cadenceBand: Math.floor(finite(cadence.intervalMs, `${path}.emitters[${index}].cadence.intervalMs`) / 160),
      burstBand: Math.floor(finite(cadence.bursts, `${path}.emitters[${index}].cadence.bursts`) / 3),
      speedKeyCount: speedKeys.length,
      speedDirection: lastSpeed > firstSpeed ? "rise" : lastSpeed < firstSpeed ? "fall" : "flat",
      operators: motion.map((entry, motionIndex) =>
        string(entry.operator, `${path}.emitters[${index}].motionStack[${motionIndex}].operator`)),
      parameterShapes: motion.map((entry, motionIndex) =>
        Object.keys(record(
          entry.params,
          `${path}.emitters[${index}].motionStack[${motionIndex}].params`,
        )).sort(compareCodePoints)),
    };
  });
  const safeGap = record(rawPattern.safeGap, `${path}.safeGap`);
  const warning = record(rawPattern.warning, `${path}.warning`);
  const timelineRatios = array(rawPattern.timeline, `${path}.timeline`).map((rawEvent, eventIndex) => {
    const event = record(rawEvent, `${path}.timeline[${eventIndex}]`);
    return pythonRound(finite(event.atMs, `${path}.timeline[${eventIndex}].atMs`) / durationMs, 2);
  });
  const normalized = {
    emitterCount: normalizedEmitters.length,
    emitters: normalizedEmitters,
    gap: [
      string(safeGap.type, `${path}.safeGap.type`),
      string(safeGap.enforcement, `${path}.safeGap.enforcement`),
      Math.floor(finite(safeGap.minimumWidthPx, `${path}.safeGap.minimumWidthPx`) / 4),
    ],
    warning: string(warning.shape, `${path}.warning.shape`),
    timelineRatios,
    hasLaser: hasOwn(rawPattern, "laserGeometry"),
  };
  const encoded = pythonCanonicalJson(
    normalized,
    (canonicalPath) => canonicalPath[0] === "timelineRatios" && typeof canonicalPath[1] === "number"
      ? "python-float"
      : "default",
  );
  return sha256(new TextEncoder().encode(encoded));
}

function parsePatterns(): readonly QaPattern[] {
  const manifest = record(patternManifestJson, "executable patterns manifest");
  if (string(manifest.schemaVersion, "executable patterns manifest.schemaVersion") !== SCHEMA_VERSION) {
    throw new Error("run composer requires executable patterns schema 4.0.0");
  }
  const signatureReport = record(signatureReportJson, "pattern signature report");
  if (string(signatureReport.schemaVersion, "pattern signature report.schemaVersion") !== SCHEMA_VERSION) {
    throw new Error("run composer requires pattern signature report schema 4.0.0");
  }
  const signatureRows = array(signatureReport.patterns, "pattern signature report.patterns");
  const expectedSignatures = new Map<string, string>();
  for (const [index, rawRow] of signatureRows.entries()) {
    const row = record(rawRow, `pattern signature report.patterns[${index}]`);
    const id = string(row.patternId, `pattern signature report.patterns[${index}].patternId`);
    const digest = string(row.sha256, `pattern signature report.patterns[${index}].sha256`);
    if (!/^[0-9a-f]{64}$/u.test(digest)) throw new Error(`pattern signature report has invalid digest: ${id}`);
    if (expectedSignatures.has(id)) throw new Error(`pattern signature report duplicates pattern: ${id}`);
    expectedSignatures.set(id, digest);
  }
  const patterns = array(manifest.patterns, "executable patterns manifest.patterns").map((raw, index) => {
    const pattern = record(raw, `executable patterns manifest.patterns[${index}]`);
    const id = string(pattern.id, `executable patterns manifest.patterns[${index}].id`);
    const seed = record(pattern.seed, `executable patterns manifest.patterns[${index}].seed`);
    const composition = string(seed.composition, `executable patterns manifest.patterns[${index}].seed.composition`);
    if (composition !== "runSeed xor base xor encounterOrdinal xor difficultySalt") {
      throw new Error(`pattern seed composition drifted: ${id}`);
    }
    const residue = record(pattern.residue, `executable patterns manifest.patterns[${index}].residue`);
    const structuralSignature = patternStructuralSignature(
      pattern,
      `executable patterns manifest.patterns[${index}]`,
    );
    if (expectedSignatures.get(id) !== structuralSignature) {
      throw new Error(`pattern structural signature diverges from immutable report: ${id}`);
    }
    return freezeRecord({
      id,
      durationMs: positiveInteger(pattern.durationMs, `executable patterns manifest.patterns[${index}].durationMs`),
      seedBase: uint32(seed.base, `executable patterns manifest.patterns[${index}].seed.base`),
      residueType: string(residue.type, `executable patterns manifest.patterns[${index}].residue.type`),
      structuralSignature,
    });
  });
  const ids = patterns.map((pattern) => pattern.id);
  uniqueStrings(ids, "executable patterns manifest pattern IDs");
  if (expectedSignatures.size !== patterns.length || patterns.some((pattern) => !expectedSignatures.has(pattern.id))) {
    throw new Error("pattern signature report and executable pattern universe diverge");
  }
  return Object.freeze(patterns);
}

function parseComposers(patternsById: ReadonlyMap<string, QaPattern>): readonly QaComposer[] {
  const manifest = record(roomManifestJson, "room composers manifest");
  if (string(manifest.schemaVersion, "room composers manifest.schemaVersion") !== SCHEMA_VERSION) {
    throw new Error("run composer requires room composers schema 4.0.0");
  }
  const composers = array(manifest.composers, "room composers manifest.composers").map((raw, index) => {
    const composer = record(raw, `room composers manifest.composers[${index}]`);
    if (
      string(composer.algorithm, `room composers manifest.composers[${index}].algorithm`)
      !== "seeded_weighted_without_replacement_with_behavior_bias"
    ) {
      throw new Error(`room composer algorithm drifted at index ${index}`);
    }
    const patterns = array(
      composer.patternPool,
      `room composers manifest.composers[${index}].patternPool`,
    ).map((rawEntry, entryIndex) => {
      const entry = record(rawEntry, `room composers manifest.composers[${index}].patternPool[${entryIndex}]`);
      const patternId = string(
        entry.patternId,
        `room composers manifest.composers[${index}].patternPool[${entryIndex}].patternId`,
      );
      if (!patternsById.has(patternId)) throw new Error(`room composer references unknown pattern: ${patternId}`);
      const baseWeight = finite(
        entry.baseWeight,
        `room composers manifest.composers[${index}].patternPool[${entryIndex}].baseWeight`,
      );
      if (baseWeight <= 0) throw new Error(`room composer pattern weight must be positive: ${patternId}`);
      return freezeRecord({
        patternId,
        baseWeight,
        cooldownEncounters: nonNegativeInteger(
          entry.cooldownEncounters,
          `room composers manifest.composers[${index}].patternPool[${entryIndex}].cooldownEncounters`,
        ),
      });
    });
    uniqueStrings(patterns.map((entry) => entry.patternId), `room composer ${index} pattern IDs`);
    if (patterns.length < QA_PATTERNS_PER_ROOM) {
      throw new Error(`room composer ${index} has fewer than three QA patterns`);
    }
    const rawWeights = record(
      composer.behaviorMetricWeights,
      `room composers manifest.composers[${index}].behaviorMetricWeights`,
    );
    const metricWeights = Object.freeze(Object.keys(rawWeights).map((metric) => Object.freeze([
      metric,
      finite(rawWeights[metric], `room composers manifest.composers[${index}].behaviorMetricWeights.${metric}`),
    ] as const)));
    const rawTiers = array(composer.intensityTiers, `room composers manifest.composers[${index}].intensityTiers`);
    if (rawTiers.length !== 3) throw new Error(`room composer ${index} must keep three QA intensity tiers`);
    const tiers = rawTiers.map((rawTier, tierIndex) => {
      const tier = record(rawTier, `room composers manifest.composers[${index}].intensityTiers[${tierIndex}]`);
      const budget = record(
        tier.budget,
        `room composers manifest.composers[${index}].intensityTiers[${tierIndex}].budget`,
      );
      return freezeRecord({
        id: string(tier.id, `room composers manifest.composers[${index}].intensityTiers[${tierIndex}].id`),
        difficulty: string(
          tier.difficulty,
          `room composers manifest.composers[${index}].intensityTiers[${tierIndex}].difficulty`,
        ),
        restMs: positiveInteger(
          budget.restMs,
          `room composers manifest.composers[${index}].intensityTiers[${tierIndex}].budget.restMs`,
        ),
      });
    });
    const expectedTierIds = ["listen", "read", "enforce"];
    const expectedDifficulties = ["EASY", "NORMAL", "HARD"];
    if (
      !sameStrings(tiers.map((tier) => tier.id), expectedTierIds)
      || !sameStrings(tiers.map((tier) => tier.difficulty), expectedDifficulties)
    ) {
      throw new Error(`room composer ${index} tier declaration order drifted`);
    }
    const constraints = record(composer.constraints, `room composers manifest.composers[${index}].constraints`);
    if (
      boolean(constraints.samePatternConsecutive, `room composers manifest.composers[${index}].constraints.samePatternConsecutive`)
      || nonNegativeInteger(
        constraints.sameStructuralSignatureWithin,
        `room composers manifest.composers[${index}].constraints.sameStructuralSignatureWithin`,
      ) !== 3
    ) {
      throw new Error(`room composer ${index} selection constraints drifted`);
    }
    return freezeRecord({
      id: string(composer.id, `room composers manifest.composers[${index}].id`),
      room: string(composer.room, `room composers manifest.composers[${index}].room`),
      patterns: Object.freeze(patterns),
      metricWeights,
      tiers: Object.freeze(tiers) as unknown as readonly [QaTier, QaTier, QaTier],
    });
  });
  uniqueStrings(composers.map((composer) => composer.id), "room composer IDs");
  uniqueStrings(composers.map((composer) => composer.room), "room composer rooms");
  return Object.freeze(composers);
}

function parseBosses(patternsById: ReadonlyMap<string, QaPattern>): readonly QaBoss[] {
  const manifest = record(bossManifestJson, "boss rigs manifest");
  if (string(manifest.schemaVersion, "boss rigs manifest.schemaVersion") !== SCHEMA_VERSION) {
    throw new Error("run composer requires boss rigs schema 4.0.0");
  }
  const bosses = array(manifest.rigs, "boss rigs manifest.rigs").map((raw, index) => {
    const boss = record(raw, `boss rigs manifest.rigs[${index}]`);
    const phases = array(boss.phases, `boss rigs manifest.rigs[${index}].phases`).map((rawPhase, phaseIndex) => {
      const phase = record(rawPhase, `boss rigs manifest.rigs[${index}].phases[${phaseIndex}]`);
      const patternId = string(phase.patternId, `boss rigs manifest.rigs[${index}].phases[${phaseIndex}].patternId`);
      if (!patternsById.has(patternId)) throw new Error(`boss phase references unknown pattern: ${patternId}`);
      return freezeRecord({
        id: string(phase.id, `boss rigs manifest.rigs[${index}].phases[${phaseIndex}].id`),
        patternId,
      });
    });
    if (phases.length !== 3) throw new Error(`boss ${index} must keep exactly three QA phases`);
    const resolution = record(boss.resolution, `boss rigs manifest.rigs[${index}].resolution`);
    const terminal = string(resolution.terminal, `boss rigs manifest.rigs[${index}].resolution.terminal`);
    if (
      string(resolution.terminalEvent, `boss rigs manifest.rigs[${index}].resolution.terminalEvent`)
      !== terminal
    ) {
      throw new Error(`boss ${index} QA and canonical terminal events diverged`);
    }
    return freezeRecord({
      id: string(boss.id, `boss rigs manifest.rigs[${index}].id`),
      room: string(boss.room, `boss rigs manifest.rigs[${index}].room`),
      terminalEvent: terminal,
      phases: Object.freeze(phases),
    });
  });
  uniqueStrings(bosses.map((boss) => boss.id), "boss rig IDs");
  return Object.freeze(bosses);
}

function parseRunContract(composers: readonly QaComposer[]): Readonly<{minimumRooms: number; maximumRooms: number}> {
  const manifest = record(runManifestJson, "run director manifest");
  if (
    string(manifest.schemaVersion, "run director manifest.schemaVersion") !== SCHEMA_VERSION
    || string(manifest.id, "run director manifest.id") !== "director.run.v4"
  ) {
    throw new Error("run composer requires director.run.v4 schema 4.0.0");
  }
  const determinism = record(manifest.determinism, "run director manifest.determinism");
  if (string(determinism.seedAlgorithm, "run director manifest.determinism.seedAlgorithm") !== "mulberry32-v1") {
    throw new Error("run director seed algorithm drifted");
  }
  const sampling = record(manifest.roomSampling, "run director manifest.roomSampling");
  if (string(sampling.algorithm, "run director manifest.roomSampling.algorithm") !== "weighted_without_replacement") {
    throw new Error("run director room sampling algorithm drifted");
  }
  const roomOrder = array(sampling.rooms, "run director manifest.roomSampling.rooms").map((entry, index) =>
    string(entry, `run director manifest.roomSampling.rooms[${index}]`));
  if (!sameStrings(roomOrder, composers.map((composer) => composer.room))) {
    throw new Error("run director and room composer declaration order diverged");
  }
  const samplingPhase = array(manifest.phases, "run director manifest.phases")
    .map((raw, index) => ({phase: record(raw, `run director manifest.phases[${index}]`), index}))
    .find(({phase}) => hasOwn(phase, "roomsSampled"));
  if (samplingPhase === undefined) throw new Error("run director has no room sampling phase");
  const range = array(
    samplingPhase.phase.roomsSampled,
    `run director manifest.phases[${samplingPhase.index}].roomsSampled`,
  );
  if (range.length !== 2) throw new Error("run director room range must contain two values");
  const minimumRooms = positiveInteger(range[0], "run director minimum rooms");
  const maximumRooms = positiveInteger(range[1], "run director maximum rooms");
  if (minimumRooms !== 2 || maximumRooms !== 4 || QA_DEFAULT_ROOM_COUNT < minimumRooms || QA_DEFAULT_ROOM_COUNT > maximumRooms) {
    throw new Error("run director authored room range or QA default drifted");
  }
  const bossPolicy = record(manifest.bossPolicy, "run director manifest.bossPolicy");
  if (string(bossPolicy.selection, "run director manifest.bossPolicy.selection") !== "room_and_behavior_match") {
    throw new Error("run director boss selection contract drifted");
  }
  return freezeRecord({minimumRooms, maximumRooms});
}

function validateEncounterContract(): void {
  const manifest = record(encounterManifestJson, "encounter director manifest");
  if (
    string(manifest.schemaVersion, "encounter director manifest.schemaVersion") !== SCHEMA_VERSION
    || string(manifest.id, "encounter director manifest.id") !== "director.encounter.v4"
  ) {
    throw new Error("run composer requires director.encounter.v4 schema 4.0.0");
  }
  const scheduling = record(manifest.scheduling, "encounter director manifest.scheduling");
  if (string(scheduling.seed, "encounter director manifest.scheduling.seed") !== "runSeed xor roomOrdinal xor encounterOrdinal") {
    throw new Error("encounter identity seed contract drifted");
  }
  const pools = record(manifest.parallelEncounterPools, "encounter director manifest.parallelEncounterPools");
  const weatherEcho = record(pools.weatherEcho, "encounter director manifest.parallelEncounterPools.weatherEcho");
  if (
    string(weatherEcho.selectionSeed, "encounter director manifest.parallelEncounterPools.weatherEcho.selectionSeed")
      !== "runSeed xor encounterOrdinal xor 0xEC40"
    || nonNegativeInteger(
      weatherEcho.maximumConcurrent,
      "encounter director manifest.parallelEncounterPools.weatherEcho.maximumConcurrent",
    ) !== 1
    || boolean(
      weatherEcho.requiresWeatherState,
      "encounter director manifest.parallelEncounterPools.weatherEcho.requiresWeatherState",
    )
  ) {
    throw new Error("parallel weather pool contract drifted");
  }
}

function buildCatalog(): QaCatalog {
  const patterns = parsePatterns();
  const patternsById = new Map(patterns.map((pattern) => [pattern.id, pattern]));
  const composers = parseComposers(patternsById);
  const derivedMetricIds: string[] = [];
  for (const id of ["avgFlower", "gazeRatio", "overrideRatio"]) derivedMetricIds.push(id);
  for (const composer of composers) {
    for (const [metric] of composer.metricWeights) {
      if (!derivedMetricIds.includes(metric)) derivedMetricIds.push(metric);
    }
  }
  if (!sameStrings(derivedMetricIds, V4_RUN_COMPOSER_METRIC_IDS)) {
    throw new Error("room composer metric universe or declaration order drifted");
  }
  const bosses = parseBosses(patternsById);
  const run = parseRunContract(composers);
  for (const composer of composers) {
    if (!bosses.some((boss) => boss.room === composer.room)) {
      throw new Error(`room has no QA boss candidate: ${composer.room}`);
    }
  }
  const transitionPattern = patternsById.get("transition.room_threshold");
  const duskPattern = patternsById.get("transition.dusk_settle");
  if (transitionPattern === undefined || duskPattern === undefined) {
    throw new Error("run composer transition or dusk pattern is missing");
  }
  validateEncounterContract();
  return freezeRecord({
    patternsById,
    composers,
    bosses,
    minimumRooms: run.minimumRooms,
    maximumRooms: run.maximumRooms,
    transitionPattern,
    duskPattern,
  });
}

const CATALOG = buildCatalog();

export const V4_RUN_COMPOSER_CONTRACT = freezeRecord({
  schemaVersion: SCHEMA_VERSION,
  qaDefaultRoomCount: QA_DEFAULT_ROOM_COUNT,
  qaPatternsPerRoom: QA_PATTERNS_PER_ROOM,
  roomOrder: Object.freeze(CATALOG.composers.map((composer) => composer.room)),
  patternOrderByRoom: freezeRecord(Object.fromEntries(CATALOG.composers.map((composer) => [
    composer.room,
    Object.freeze(composer.patterns.map((entry) => entry.patternId)),
  ])) as Readonly<Record<string, readonly string[]>>),
  metricOrderByRoom: freezeRecord(Object.fromEntries(CATALOG.composers.map((composer) => [
    composer.room,
    Object.freeze(composer.metricWeights.map(([metric]) => metric)),
  ])) as Readonly<Record<string, readonly string[]>>),
  bossOrderByRoom: freezeRecord(Object.fromEntries(CATALOG.composers.map((composer) => [
    composer.room,
    Object.freeze(CATALOG.bosses.filter((boss) => boss.room === composer.room).map((boss) => boss.id)),
  ])) as Readonly<Record<string, readonly string[]>>),
  immediateStructuralSignaturePenalty: IMMEDIATE_SIGNATURE_PENALTY,
  liveRuntimeSeedOmission: LIVE_RUNTIME_SEED_OMISSION,
});

export function validateV4RunComposerMetrics(value: unknown): V4RunComposerMetrics {
  const metrics = ownPlainDataRecord(value, "run composer metrics");
  const keys = Object.keys(metrics);
  if (
    keys.length !== V4_RUN_COMPOSER_METRIC_IDS.length
    || keys.some((key) => !(V4_RUN_COMPOSER_METRIC_IDS as readonly string[]).includes(key))
  ) {
    throw new Error("run composer metrics must contain the exact explicit V4 QA metric universe");
  }
  const parsed: Partial<Record<V4RunComposerMetricId, number>> = {};
  for (const id of V4_RUN_COMPOSER_METRIC_IDS) parsed[id] = finite(metrics[id], `run composer metrics.${id}`);
  return Object.freeze(parsed) as V4RunComposerMetrics;
}

function pickWeighted<T>(
  candidates: readonly T[],
  weightFor: (candidate: T) => number,
  randomValue: number,
): T {
  if (candidates.length === 0) throw new Error("V4 QA weighted selection requires candidates");
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
    throw new Error("V4 QA weighted selection random value must be in [0,1)");
  }
  const weights = candidates.map((candidate) => Math.max(MINIMUM_WEIGHT, weightFor(candidate)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = randomValue * total;
  for (let index = 0; index < candidates.length; index += 1) {
    cursor -= weights[index] as number;
    if (cursor <= 0) return candidates[index] as T;
  }
  return candidates[candidates.length - 1] as T;
}

export function pickV4QaPatternCandidate(
  candidates: readonly V4QaPatternCandidate[],
  previousStructuralSignature: string | null,
  randomValue: number,
): V4QaPatternCandidate {
  const ids = candidates.map((candidate, index) => {
    if (candidate.id.length === 0) throw new Error(`V4 QA pattern candidate ${index} requires an ID`);
    if (!Number.isFinite(candidate.baseWeight) || candidate.baseWeight <= 0) {
      throw new Error(`V4 QA pattern candidate ${candidate.id} requires a positive finite weight`);
    }
    if (candidate.structuralSignature.length === 0) {
      throw new Error(`V4 QA pattern candidate ${candidate.id} requires a structural signature`);
    }
    return candidate.id;
  });
  uniqueStrings(ids, "V4 QA pattern candidate IDs");
  return pickWeighted(
    candidates,
    (candidate) => candidate.baseWeight
      * (candidate.structuralSignature === previousStructuralSignature ? IMMEDIATE_SIGNATURE_PENALTY : 1),
    randomValue,
  );
}

function intensityScore(metrics: V4RunComposerMetrics): number {
  return Math.max(0, Math.min(1, (
    (metrics.avgFlower ?? 0.4)
    + (metrics.gazeRatio ?? 0.2)
    + (metrics.overrideRatio ?? 0)
  ) / 2));
}

export function deriveV4QaIntensityTier(
  metricsValue: unknown,
  roomId = CATALOG.composers[0]?.room ?? "INFORMATION",
): Readonly<{id: string; difficulty: string; restMs: number; intensityScore: number}> {
  const metrics = validateV4RunComposerMetrics(metricsValue);
  const composer = CATALOG.composers.find((candidate) => candidate.room === roomId);
  if (composer === undefined) throw new Error(`unknown V4 QA room: ${roomId}`);
  const score = intensityScore(metrics);
  const tierIndex = score < 0.28 ? 0 : score < 0.58 ? 1 : 2;
  const tier = composer.tiers[tierIndex];
  if (tier === undefined) throw new Error(`room ${roomId} is missing QA tier ${tierIndex}`);
  return freezeRecord({...tier, intensityScore: score});
}

function xorUint32(...values: readonly number[]): number {
  let result = 0;
  for (const value of values) result = (result ^ value) >>> 0;
  return result;
}

function freezeSchedule(events: readonly V4QaScheduleEvent[]): readonly V4QaScheduleEvent[] {
  return Object.freeze(events.map((event) => freezeRecord({...event})));
}

function seedRecord(
  kind: V4QaPatternSeedKind,
  patternId: string,
  qaPatternSeed: number,
  roomOrdinal: number | null,
  encounterOrdinal: number | null,
  encounterIdentitySeed: number | null,
): V4QaPatternSeedRecord {
  return freezeRecord({
    kind,
    patternId,
    roomOrdinal,
    encounterOrdinal,
    encounterIdentitySeed,
    qaPatternSeed,
    liveRuntimePatternSeed: null,
    liveRuntimeSeedOmission: LIVE_RUNTIME_SEED_OMISSION,
  });
}

export function composeV4RunComposerPlan(options: V4RunComposerOptions): V4RunComposerPlan {
  const capturedOptions = ownPlainDataRecord(options, "run composer options");
  const optionKeys = Object.keys(capturedOptions);
  if (
    !hasOwn(capturedOptions, "rawRunSeed")
    || !hasOwn(capturedOptions, "metrics")
    || optionKeys.some((key) => !["rawRunSeed", "metrics", "roomCount"].includes(key))
  ) {
    throw new Error("run composer options must contain only rawRunSeed, metrics, and optional roomCount");
  }
  const rawRunSeed = uint32(capturedOptions.rawRunSeed, "run composer rawRunSeed");
  const metrics = validateV4RunComposerMetrics(capturedOptions.metrics);
  const roomCountProvided = hasOwn(capturedOptions, "roomCount");
  const roomCount = roomCountProvided
    ? integer(capturedOptions.roomCount, "run composer roomCount")
    : QA_DEFAULT_ROOM_COUNT;
  if (
    !Number.isSafeInteger(roomCount)
    || roomCount < CATALOG.minimumRooms
    || roomCount > CATALOG.maximumRooms
  ) {
    throw new Error("run composer roomCount must remain inside the authored 2..4 range");
  }
  const random = mulberry32(rawRunSeed);
  const remaining = CATALOG.composers.slice();
  const chosenRooms: QaComposer[] = [];
  const selectedRoomCount = Math.min(roomCount, remaining.length);
  while (chosenRooms.length < selectedRoomCount) {
    const selected = pickWeighted(
      remaining,
      (composer) => 1 + composer.metricWeights.reduce(
        (sum, [metric, weight]) => sum + ((metrics as Readonly<Record<string, number>>)[metric] ?? 0) * weight,
        0,
      ),
      random(),
    );
    chosenRooms.push(selected);
    remaining.splice(remaining.indexOf(selected), 1);
  }

  const schedule: V4QaScheduleEvent[] = [];
  const seedLedger: V4QaPatternSeedRecord[] = [];
  let clock = 0;
  let lastSignature: string | null = null;
  for (const [roomOrdinal, composer] of chosenRooms.entries()) {
    const score = intensityScore(metrics);
    const tierIndex = score < 0.28 ? 0 : score < 0.58 ? 1 : 2;
    const tier = composer.tiers[tierIndex];
    if (tier === undefined) throw new Error(`room ${composer.room} is missing QA tier ${tierIndex}`);
    const roomPatterns = composer.patterns.slice();
    const picks: QaPattern[] = [];
    while (roomPatterns.length > 0 && picks.length < QA_PATTERNS_PER_ROOM) {
      const candidates = roomPatterns.map((entry) => {
        const pattern = CATALOG.patternsById.get(entry.patternId);
        if (pattern === undefined) throw new Error(`room composer pattern disappeared: ${entry.patternId}`);
        return freezeRecord({
          id: entry.patternId,
          baseWeight: entry.baseWeight,
          structuralSignature: pattern.structuralSignature,
        });
      });
      const selectedCandidate = pickV4QaPatternCandidate(candidates, lastSignature, random());
      const selectedEntryIndex = roomPatterns.findIndex((entry) => entry.patternId === selectedCandidate.id);
      const selectedEntry = roomPatterns[selectedEntryIndex];
      const selectedPattern = selectedEntry === undefined
        ? undefined
        : CATALOG.patternsById.get(selectedEntry.patternId);
      if (selectedPattern === undefined) throw new Error("V4 QA pattern selection lost its manifest candidate");
      roomPatterns.splice(selectedEntryIndex, 1);
      picks.push(selectedPattern);
      lastSignature = selectedPattern.structuralSignature;
    }

    schedule.push({atMs: clock, event: "room.enter", room: composer.room, roomOrdinal});
    clock += QA_ROOM_ENTRY_DELAY_MS;
    for (const [encounterOrdinal, pattern] of picks.entries()) {
      const encounterIdentitySeed = xorUint32(rawRunSeed, roomOrdinal, encounterOrdinal);
      const qaPatternSeed = xorUint32(rawRunSeed, pattern.seedBase, roomOrdinal, encounterOrdinal);
      schedule.push({
        atMs: clock,
        event: "encounter.begin",
        patternId: pattern.id,
        difficulty: tier.difficulty,
        encounterOrdinal,
        seed: qaPatternSeed,
      });
      seedLedger.push(seedRecord(
        "encounter",
        pattern.id,
        qaPatternSeed,
        roomOrdinal,
        encounterOrdinal,
        encounterIdentitySeed,
      ));
      clock += pattern.durationMs;
      schedule.push({atMs: clock, event: "material.settle", residue: pattern.residueType});
      clock += tier.restMs;
    }
    schedule.push({atMs: clock, event: "room.withdraw", room: composer.room});
    if (roomOrdinal < chosenRooms.length - 1) {
      const transitionSeed = xorUint32(rawRunSeed, CATALOG.transitionPattern.seedBase, roomOrdinal);
      schedule.push({
        atMs: clock,
        event: "transition.begin",
        patternId: CATALOG.transitionPattern.id,
        seed: transitionSeed,
      });
      seedLedger.push(seedRecord(
        "transition",
        CATALOG.transitionPattern.id,
        transitionSeed,
        roomOrdinal,
        null,
        null,
      ));
      clock += CATALOG.transitionPattern.durationMs;
    }
  }

  const terminalRoom = chosenRooms[chosenRooms.length - 1]?.room ?? "INFORMATION";
  const eligibleBosses = CATALOG.bosses.filter((boss) => boss.room === terminalRoom);
  if (eligibleBosses.length === 0) throw new Error(`terminal room has no V4 QA boss: ${terminalRoom}`);
  const boss = eligibleBosses[Math.floor(random() * eligibleBosses.length) % eligibleBosses.length];
  if (boss === undefined) throw new Error(`terminal room boss selection failed: ${terminalRoom}`);
  schedule.push({
    atMs: clock,
    event: "boss.protocol.begin",
    bossId: boss.id,
    resolution: boss.terminalEvent,
  });
  for (const phase of boss.phases) {
    const pattern = CATALOG.patternsById.get(phase.patternId);
    if (pattern === undefined) throw new Error(`boss phase pattern disappeared: ${phase.patternId}`);
    const qaPatternSeed = xorUint32(rawRunSeed, pattern.seedBase);
    schedule.push({
      atMs: clock,
      event: "boss.phase.begin",
      bossId: boss.id,
      phaseId: phase.id,
      patternId: pattern.id,
      seed: qaPatternSeed,
    });
    seedLedger.push(seedRecord("boss-phase", pattern.id, qaPatternSeed, null, null, null));
    clock += pattern.durationMs;
  }
  schedule.push({atMs: clock, event: boss.terminalEvent, bossId: boss.id});
  const duskSeed = xorUint32(rawRunSeed, CATALOG.duskPattern.seedBase);
  schedule.push({atMs: clock, event: "dusk.begin", patternId: CATALOG.duskPattern.id, seed: duskSeed});
  seedLedger.push(seedRecord("dusk", CATALOG.duskPattern.id, duskSeed, null, null, null));
  clock += CATALOG.duskPattern.durationMs;
  schedule.push({atMs: clock, event: "snapshot.capture"});

  const frozenSchedule = freezeSchedule(schedule);
  const payloadWithoutHash = freezeRecord({
    runSeed: rawRunSeed,
    metrics,
    rooms: Object.freeze(chosenRooms.map((composer) => composer.room)),
    bossId: boss.id,
    durationMs: clock,
    schedule: frozenSchedule,
  });
  const traceSha256 = sha256(new TextEncoder().encode(pythonCanonicalJson(
    payloadWithoutHash,
    (path) => path[0] === "metrics" && typeof path[1] === "string"
      ? "json-fixture-number"
      : "default",
  )));
  const qa = freezeRecord({...payloadWithoutHash, traceSha256});
  return freezeRecord({
    provenance: freezeRecord({
      source: "v4-gameplay-tools-sim-core-compose-run" as const,
      schemaVersion: SCHEMA_VERSION,
      rawRunSeedAuthority: "caller-supplied-v4-run-seed" as const,
      metricsAuthority: "caller-supplied-explicit-behavior-fixture" as const,
      roomCountAuthority: !roomCountProvided
        ? "qa-oracle-default-3" as const
        : "caller-supplied-authored-range" as const,
      canonicalEventBus: false as const,
      liveIntegration: false as const,
      parallelWeatherScheduled: false as const,
    }),
    qa,
    seedLedger: Object.freeze(seedLedger),
  });
}
