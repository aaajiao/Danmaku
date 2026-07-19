import bossManifestJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/boss-rigs-v4.json";
import encounterManifestJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/encounter-director-v4.json";
import patternManifestJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/executable-patterns-v4.json";
import roomManifestJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/room-composers-v4.json";
import runManifestJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/run-director-v4.json";
import eventSchemaJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/runtime/event-schema-v4.json";
import {MASTER_TICK_HZ} from "./clock";
import {
  CANONICAL_EVENT_IDS,
  CanonicalEventBus,
  consumeCanonicalEventBatchReceipt,
  type CanonicalEventBatchReceipt,
  type GameplayEventDraft,
} from "./events";

type UnknownRecord = Record<string, unknown>;

export interface EncounterManifestSource {
  readonly encounter: unknown;
  readonly bosses: unknown;
  readonly rooms: unknown;
  readonly run: unknown;
  readonly patterns: unknown;
  readonly events: unknown;
}

export interface EncounterSegmentDefinition {
  readonly id: string;
  readonly minimumDurationMs: number;
  readonly maximumDurationMs: number;
  readonly collision: boolean | null;
  readonly newSpawns: boolean | null;
  readonly required: boolean;
  readonly patternSlots: readonly [number, number] | null;
}

export interface ComposerPatternDefinition {
  readonly patternId: string;
  readonly baseWeight: number;
  readonly cooldownEncounters: number;
}

export interface IntensityTierDefinition {
  readonly id: string;
  readonly difficulty: string;
  readonly maximumProjectiles: number;
  readonly maximumEmitters: number;
  readonly restMs: number;
}

export interface RoomComposerDefinition {
  readonly id: string;
  readonly room: string;
  readonly patterns: readonly ComposerPatternDefinition[];
  readonly metricWeights: Readonly<Record<string, number>>;
  readonly tiers: readonly IntensityTierDefinition[];
}

export interface BossPhaseDefinition {
  readonly id: string;
  readonly patternId: string;
  readonly patternDurationMs: number;
  readonly entryCondition: string;
  readonly exitCondition: string;
  readonly resolutionCondition: string | null;
  readonly laserGeometry: string | null;
  readonly spatialLaw: string;
}

export interface BossDefinition {
  readonly id: string;
  readonly room: string;
  readonly phases: readonly BossPhaseDefinition[];
  readonly resolutionId: string;
  readonly resolutionCondition: string;
  readonly resolutionFact: string;
  readonly terminalEvent: string;
  readonly materialRemainder: string;
  readonly ruptureEvent: string;
  readonly residueType: string;
  readonly collisionOffBeforeVisual: true;
}

export interface ParallelEncounterPoolDefinition {
  readonly id: string;
  readonly patternIds: readonly string[];
  readonly maximumConcurrent: number;
  readonly requiresWeatherState: boolean;
  readonly selectionSalt: number;
}

export interface EncounterAuthorityCatalog {
  readonly schemaVersion: string;
  readonly segments: readonly EncounterSegmentDefinition[];
  readonly rooms: readonly RoomComposerDefinition[];
  readonly bosses: readonly BossDefinition[];
  readonly parallelPools: readonly ParallelEncounterPoolDefinition[];
  readonly runRoomOrder: readonly string[];
  readonly minimumRoomsPerRun: number;
  readonly maximumRoomsPerRun: number;
  readonly maximumBossesPerRun: number;
  readonly safeGapHandoffMs: number;
  readonly projectileBudgetByDifficulty: Readonly<Record<string, number>>;
  readonly failurePolicy: Readonly<{
    minimumUntelegraphedSpawnDistancePx: number;
    noForcedHitAtMaximumSpeed: true;
    collisionNeverFromAlpha: true;
  }>;
  readonly fallbackResolution: Readonly<{
    id: string;
    condition: string;
    fact: string;
    terminalEvent: string;
  }>;
  readonly weatherIsPresentationOnly: true;
  requireRoom(roomId: string): RoomComposerDefinition;
  requireBoss(bossId: string): BossDefinition;
  requirePatternDuration(patternId: string): number;
  bossesForRoom(roomId: string): readonly BossDefinition[];
}

export interface EncounterEnvelopeFixtureOptions {
  readonly seed: number;
  readonly roomCount?: number;
  readonly wavesPerRoom?: number;
  readonly tierId?: string;
  readonly behavior?: Readonly<Record<string, number>>;
  /** Presentation context is accepted so isolation can be regression-tested. */
  readonly presentationWeather?: Readonly<{id: string; seed: number}> | null;
}

export interface PlannedSegment {
  readonly id: string;
  readonly segmentOrdinal: number;
  readonly startTick120: number;
  readonly endTick120: number;
  readonly patternId: string | null;
  readonly collision: boolean | null;
  readonly newSpawns: boolean | null;
  readonly required: boolean;
}

export interface PlannedWave {
  readonly id: string;
  readonly room: string;
  readonly roomOrdinal: number;
  readonly waveOrdinal: number;
  readonly patternId: string;
  readonly seed: number;
  readonly tierId: string;
  readonly difficulty: string;
  readonly maximumProjectiles: number;
  readonly maximumEmitters: number;
  readonly parallelPatternId: string | null;
  readonly segments: readonly PlannedSegment[];
  readonly startTick120: number;
  readonly endTick120: number;
}

export interface PlannedRoom {
  readonly id: string;
  readonly room: string;
  readonly roomOrdinal: number;
  readonly startTick120: number;
  readonly endTick120: number;
  readonly waves: readonly PlannedWave[];
}

export interface PlannedBossPhase {
  readonly id: string;
  readonly phaseId: string;
  readonly phaseIndex: number;
  readonly patternId: string;
  readonly startTick120: number;
  readonly endTick120: number;
}

export interface PlannedBoss {
  readonly bossId: string;
  readonly generation: number;
  readonly startTick120: number;
  readonly endTick120: number;
  readonly phases: readonly PlannedBossPhase[];
}

/**
 * Deterministic non-live envelope fixture retained for segment/catalog tests.
 * It is not the V4 RunComposer oracle and must never write canonical events.
 */
export interface EncounterEnvelopeFixture {
  readonly id: string;
  readonly seed: number;
  readonly rooms: readonly PlannedRoom[];
  readonly boss: PlannedBoss;
  readonly handoffTick120: number;
}

export type EncounterObservationKind =
  | "room.enter"
  | "room.exit"
  | "wave.enter"
  | "wave.exit"
  | "segment.enter"
  | "segment.exit"
  | "boss.handoff";

export interface EncounterObservation {
  readonly kind: EncounterObservationKind;
  readonly tick120: number;
  readonly room: string;
  readonly waveId: string | null;
  readonly segmentId: string | null;
  readonly patternId: string | null;
  readonly bossId: string | null;
}

interface TimelineObservation extends EncounterObservation {
  readonly stableOrder: number;
}

interface ParsedPattern {
  readonly id: string;
  readonly durationMs: number;
}

function record(value: unknown, path: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as UnknownRecord;
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be finite`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  const parsed = finite(value, path);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || Object.is(parsed, -0)) {
    throw new Error(`${path} must be a non-negative safe integer`);
  }
  return parsed;
}

function positiveInteger(value: unknown, path: string): number {
  const parsed = nonNegativeInteger(value, path);
  if (parsed === 0) throw new Error(`${path} must be positive`);
  return parsed;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} must be boolean`);
  return value;
}

function nullableBoolean(value: unknown, path: string): boolean | null {
  return value === undefined ? null : boolean(value, path);
}

function uniqueById<T extends {readonly id: string}>(values: readonly T[], path: string): void {
  const ids = new Set<string>();
  for (const value of values) {
    if (ids.has(value.id)) throw new Error(`${path} contains duplicate id: ${value.id}`);
    ids.add(value.id);
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function parseRange(value: unknown, path: string): readonly [number, number] {
  const entries = array(value, path);
  if (entries.length !== 2) throw new Error(`${path} must contain two integers`);
  const minimum = positiveInteger(entries[0], `${path}[0]`);
  const maximum = positiveInteger(entries[1], `${path}[1]`);
  if (minimum > maximum) throw new Error(`${path} must be ascending`);
  return Object.freeze([minimum, maximum]);
}

function parsePatterns(value: unknown): readonly ParsedPattern[] {
  const manifest = record(value, "patterns manifest");
  const patterns = array(manifest.patterns, "patterns manifest.patterns").map((raw, index) => {
    const pattern = record(raw, `patterns manifest.patterns[${index}]`);
    return Object.freeze({
      id: string(pattern.id, `patterns manifest.patterns[${index}].id`),
      durationMs: positiveInteger(
        pattern.durationMs,
        `patterns manifest.patterns[${index}].durationMs`,
      ),
    });
  });
  uniqueById(patterns, "patterns manifest.patterns");
  return Object.freeze(patterns);
}

function parseSegments(value: unknown): readonly EncounterSegmentDefinition[] {
  const manifest = record(value, "encounter manifest");
  const segments = array(manifest.segments, "encounter manifest.segments").map((raw, index) => {
    const segment = record(raw, `encounter manifest.segments[${index}]`);
    const duration = parseRange(segment.durationMs, `encounter manifest.segments[${index}].durationMs`);
    let patternSlots: readonly [number, number] | null = null;
    if (segment.patternSlots !== undefined) {
      patternSlots = parseRange(
        segment.patternSlots,
        `encounter manifest.segments[${index}].patternSlots`,
      );
    }
    return Object.freeze({
      id: string(segment.id, `encounter manifest.segments[${index}].id`),
      minimumDurationMs: duration[0],
      maximumDurationMs: duration[1],
      collision: nullableBoolean(segment.collision, `encounter manifest.segments[${index}].collision`),
      newSpawns: nullableBoolean(segment.newSpawns, `encounter manifest.segments[${index}].newSpawns`),
      required: segment.required === undefined
        ? false
        : boolean(segment.required, `encounter manifest.segments[${index}].required`),
      patternSlots,
    });
  });
  uniqueById(segments, "encounter manifest.segments");
  if (segments.length === 0) throw new Error("encounter manifest must declare segments");
  const combatSegments = segments.filter((segment) => segment.patternSlots !== null);
  if (combatSegments.length !== 1) {
    throw new Error("encounter manifest must declare exactly one pattern-bearing segment");
  }
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (first?.collision !== false) throw new Error("first encounter segment must disable collision");
  if (last?.required !== true || last.newSpawns !== false) {
    throw new Error("final encounter segment must be a required spawn-free rest");
  }
  return Object.freeze(segments);
}

function parseRooms(value: unknown): readonly RoomComposerDefinition[] {
  const manifest = record(value, "room manifest");
  const rooms = array(manifest.composers, "room manifest.composers").map((raw, index) => {
    const composer = record(raw, `room manifest.composers[${index}]`);
    const patterns = array(
      composer.patternPool,
      `room manifest.composers[${index}].patternPool`,
    ).map((rawPattern, patternIndex) => {
      const pattern = record(
        rawPattern,
        `room manifest.composers[${index}].patternPool[${patternIndex}]`,
      );
      return Object.freeze({
        patternId: string(
          pattern.patternId,
          `room manifest.composers[${index}].patternPool[${patternIndex}].patternId`,
        ),
        baseWeight: finite(
          pattern.baseWeight,
          `room manifest.composers[${index}].patternPool[${patternIndex}].baseWeight`,
        ),
        cooldownEncounters: nonNegativeInteger(
          pattern.cooldownEncounters,
          `room manifest.composers[${index}].patternPool[${patternIndex}].cooldownEncounters`,
        ),
      });
    });
    const patternIds = patterns.map((entry) => entry.patternId);
    if (new Set(patternIds).size !== patternIds.length) {
      throw new Error(`room manifest.composers[${index}] contains duplicate pattern references`);
    }
    if (patterns.some((entry) => entry.baseWeight <= 0)) {
      throw new Error(`room manifest.composers[${index}] pattern weights must be positive`);
    }

    const rawWeights = record(
      composer.behaviorMetricWeights,
      `room manifest.composers[${index}].behaviorMetricWeights`,
    );
    const metricWeights: Record<string, number> = Object.create(null) as Record<string, number>;
    for (const metric of Object.keys(rawWeights).sort()) {
      metricWeights[metric] = finite(
        rawWeights[metric],
        `room manifest.composers[${index}].behaviorMetricWeights.${metric}`,
      );
    }

    const tiers = array(
      composer.intensityTiers,
      `room manifest.composers[${index}].intensityTiers`,
    ).map((rawTier, tierIndex) => {
      const tier = record(rawTier, `room manifest.composers[${index}].intensityTiers[${tierIndex}]`);
      const budget = record(
        tier.budget,
        `room manifest.composers[${index}].intensityTiers[${tierIndex}].budget`,
      );
      return Object.freeze({
        id: string(tier.id, `room manifest.composers[${index}].intensityTiers[${tierIndex}].id`),
        difficulty: string(
          tier.difficulty,
          `room manifest.composers[${index}].intensityTiers[${tierIndex}].difficulty`,
        ),
        maximumProjectiles: positiveInteger(
          budget.maxProjectiles,
          `room manifest.composers[${index}].intensityTiers[${tierIndex}].budget.maxProjectiles`,
        ),
        maximumEmitters: positiveInteger(
          budget.maxEmitters,
          `room manifest.composers[${index}].intensityTiers[${tierIndex}].budget.maxEmitters`,
        ),
        restMs: positiveInteger(
          budget.restMs,
          `room manifest.composers[${index}].intensityTiers[${tierIndex}].budget.restMs`,
        ),
      });
    });
    uniqueById(tiers, `room manifest.composers[${index}].intensityTiers`);
    if (patterns.length === 0 || tiers.length === 0) {
      throw new Error(`room manifest.composers[${index}] must declare patterns and tiers`);
    }
    return Object.freeze({
      id: string(composer.id, `room manifest.composers[${index}].id`),
      room: string(composer.room, `room manifest.composers[${index}].room`),
      patterns: Object.freeze(patterns),
      metricWeights: Object.freeze(metricWeights),
      tiers: Object.freeze(tiers),
    });
  });
  uniqueById(rooms, "room manifest.composers");
  const roomIds = rooms.map((composer) => composer.room);
  if (new Set(roomIds).size !== roomIds.length) {
    throw new Error("room manifest contains duplicate room authorities");
  }
  return Object.freeze(rooms);
}

function parseRun(value: unknown): Readonly<{
  schemaVersion: string;
  rooms: readonly string[];
  minimumRooms: number;
  maximumRooms: number;
  maximumBosses: number;
  patternRefs: readonly string[];
}> {
  const manifest = record(value, "run manifest");
  const sampling = record(manifest.roomSampling, "run manifest.roomSampling");
  const rooms = array(sampling.rooms, "run manifest.roomSampling.rooms").map((entry, index) =>
    string(entry, `run manifest.roomSampling.rooms[${index}]`));
  if (new Set(rooms).size !== rooms.length || rooms.length === 0) {
    throw new Error("run manifest room sampling must contain unique rooms");
  }
  const phases = array(manifest.phases, "run manifest.phases");
  const samplingPhase = phases
    .map((raw, index) => ({raw: record(raw, `run manifest.phases[${index}]`), index}))
    .find(({raw}) => raw.roomsSampled !== undefined);
  if (samplingPhase === undefined) throw new Error("run manifest has no room sampling phase");
  const range = parseRange(
    samplingPhase.raw.roomsSampled,
    `run manifest.phases[${samplingPhase.index}].roomsSampled`,
  );
  const patternRefs: string[] = [];
  for (const [phaseIndex, rawPhase] of phases.entries()) {
    const phase = record(rawPhase, `run manifest.phases[${phaseIndex}]`);
    if (phase.patterns === undefined) continue;
    for (const [patternIndex, rawPatternId] of array(
      phase.patterns,
      `run manifest.phases[${phaseIndex}].patterns`,
    ).entries()) {
      patternRefs.push(string(
        rawPatternId,
        `run manifest.phases[${phaseIndex}].patterns[${patternIndex}]`,
      ));
    }
  }
  const bossPolicy = record(manifest.bossPolicy, "run manifest.bossPolicy");
  return Object.freeze({
    schemaVersion: string(manifest.schemaVersion, "run manifest.schemaVersion"),
    rooms: Object.freeze(rooms),
    minimumRooms: range[0],
    maximumRooms: range[1],
    maximumBosses: positiveInteger(bossPolicy.maximumPerRun, "run manifest.bossPolicy.maximumPerRun"),
    patternRefs: Object.freeze(patternRefs),
  });
}

function parseBosses(
  value: unknown,
  patternDurations: ReadonlyMap<string, number>,
): Readonly<{
  bosses: readonly BossDefinition[];
  fallback: EncounterAuthorityCatalog["fallbackResolution"];
}> {
  const manifest = record(value, "boss manifest");
  const rawFallback = record(manifest.sharedFallbackResolution, "boss manifest.sharedFallbackResolution");
  const fallback = Object.freeze({
    id: string(rawFallback.id, "boss manifest.sharedFallbackResolution.id"),
    condition: string(rawFallback.condition, "boss manifest.sharedFallbackResolution.condition"),
    fact: string(rawFallback.fact, "boss manifest.sharedFallbackResolution.fact"),
    terminalEvent: string(
      rawFallback.terminalEvent,
      "boss manifest.sharedFallbackResolution.terminalEvent",
    ),
  });
  const bosses = array(manifest.rigs, "boss manifest.rigs").map((raw, index) => {
    const rig = record(raw, `boss manifest.rigs[${index}]`);
    const rawResolution = record(rig.resolution, `boss manifest.rigs[${index}].resolution`);
    const rawRupture = record(rig.rupture, `boss manifest.rigs[${index}].rupture`);
    const rawResidue = record(rig.materialResidue, `boss manifest.rigs[${index}].materialResidue`);
    const phases = array(rig.phases, `boss manifest.rigs[${index}].phases`).map(
      (rawPhase, phaseIndex) => {
        const phase = record(rawPhase, `boss manifest.rigs[${index}].phases[${phaseIndex}]`);
        const patternId = string(
          phase.patternId,
          `boss manifest.rigs[${index}].phases[${phaseIndex}].patternId`,
        );
        const durationMs = patternDurations.get(patternId);
        if (durationMs === undefined) {
          throw new Error(`boss manifest references unknown pattern: ${patternId}`);
        }
        return Object.freeze({
          id: string(phase.id, `boss manifest.rigs[${index}].phases[${phaseIndex}].id`),
          patternId,
          patternDurationMs: durationMs,
          entryCondition: string(
            phase.entryCondition,
            `boss manifest.rigs[${index}].phases[${phaseIndex}].entryCondition`,
          ),
          exitCondition: string(
            phase.exitCondition,
            `boss manifest.rigs[${index}].phases[${phaseIndex}].exitCondition`,
          ),
          resolutionCondition: phase.resolutionCondition === undefined
            ? null
            : string(
              phase.resolutionCondition,
              `boss manifest.rigs[${index}].phases[${phaseIndex}].resolutionCondition`,
            ),
          laserGeometry: phase.laserGeometry === null
            ? null
            : string(
              phase.laserGeometry,
              `boss manifest.rigs[${index}].phases[${phaseIndex}].laserGeometry`,
            ),
          spatialLaw: string(
            phase.spatialLaw,
            `boss manifest.rigs[${index}].phases[${phaseIndex}].spatialLaw`,
          ),
        });
      },
    );
    if (phases.length !== 3) throw new Error(`boss manifest.rigs[${index}] must contain three phases`);
    uniqueById(phases, `boss manifest.rigs[${index}].phases`);
    if (phases[0]?.entryCondition !== "encounter.begin") {
      throw new Error(`boss manifest.rigs[${index}] first phase must enter from encounter.begin`);
    }
    for (let phaseIndex = 1; phaseIndex < phases.length; phaseIndex += 1) {
      const previous = phases[phaseIndex - 1];
      const phase = phases[phaseIndex];
      if (previous === undefined || phase === undefined || phase.entryCondition !== `${previous.id}.exit`) {
        throw new Error(`boss manifest.rigs[${index}] phase entry chain is invalid`);
      }
    }
    const finalPhase = phases[phases.length - 1];
    const terminalEvent = string(
      rawResolution.terminalEvent,
      `boss manifest.rigs[${index}].resolution.terminalEvent`,
    );
    const resolutionCondition = string(
      rawResolution.condition,
      `boss manifest.rigs[${index}].resolution.condition`,
    );
    if (
      finalPhase === undefined
      || finalPhase.exitCondition !== terminalEvent
      || finalPhase.resolutionCondition !== resolutionCondition
    ) {
      throw new Error(`boss manifest.rigs[${index}] final phase is not resolution-canonical`);
    }
    const materialRemainder = string(
      rawResolution.materialRemainder,
      `boss manifest.rigs[${index}].resolution.materialRemainder`,
    );
    if (rawRupture.collisionOffBeforeVisual !== true) {
      throw new Error(`boss manifest.rigs[${index}] must disable collision before rupture visuals`);
    }
    if (string(rawRupture.event, `boss manifest.rigs[${index}].rupture.event`) !== terminalEvent) {
      throw new Error(`boss manifest.rigs[${index}] rupture event must equal its terminal event`);
    }
    if (
      string(
        rawResidue.canonicalRemainder,
        `boss manifest.rigs[${index}].materialResidue.canonicalRemainder`,
      ) !== materialRemainder
    ) {
      throw new Error(`boss manifest.rigs[${index}] material remainder diverges from resolution`);
    }
    return Object.freeze({
      id: string(rig.id, `boss manifest.rigs[${index}].id`),
      room: string(rig.room, `boss manifest.rigs[${index}].room`),
      phases: Object.freeze(phases),
      resolutionId: string(
        rawResolution.resolutionId,
        `boss manifest.rigs[${index}].resolution.resolutionId`,
      ),
      resolutionCondition,
      resolutionFact: string(
        rawResolution.fact,
        `boss manifest.rigs[${index}].resolution.fact`,
      ),
      terminalEvent,
      materialRemainder,
      ruptureEvent: terminalEvent,
      residueType: string(rawResidue.type, `boss manifest.rigs[${index}].materialResidue.type`),
      collisionOffBeforeVisual: true as const,
    });
  });
  uniqueById(bosses, "boss manifest.rigs");
  return Object.freeze({bosses: Object.freeze(bosses), fallback});
}

function parseParallelPools(value: unknown, knownPatterns: ReadonlySet<string>): readonly ParallelEncounterPoolDefinition[] {
  const manifest = record(value, "encounter manifest");
  const rawPools = record(manifest.parallelEncounterPools, "encounter manifest.parallelEncounterPools");
  const pools = Object.keys(rawPools).sort().map((poolId) => {
    const pool = record(rawPools[poolId], `encounter manifest.parallelEncounterPools.${poolId}`);
    const patternIds = array(
      pool.patternIds,
      `encounter manifest.parallelEncounterPools.${poolId}.patternIds`,
    ).map((entry, index) =>
      string(entry, `encounter manifest.parallelEncounterPools.${poolId}.patternIds[${index}]`));
    if (new Set(patternIds).size !== patternIds.length) {
      throw new Error(`parallel encounter pool ${poolId} contains duplicate pattern references`);
    }
    for (const patternId of patternIds) {
      if (!knownPatterns.has(patternId)) {
        throw new Error(`parallel encounter pool references unknown pattern: ${patternId}`);
      }
    }
    const seedExpression = string(
      pool.selectionSeed,
      `encounter manifest.parallelEncounterPools.${poolId}.selectionSeed`,
    );
    const saltMatch = /0x([0-9a-f]+)\s*$/iu.exec(seedExpression);
    if (saltMatch?.[1] === undefined) {
      throw new Error(`parallel encounter pool ${poolId} has an unsupported selection seed contract`);
    }
    const selectionSalt = Number.parseInt(saltMatch[1], 16);
    const maximumConcurrent = nonNegativeInteger(
      pool.maximumConcurrent,
      `encounter manifest.parallelEncounterPools.${poolId}.maximumConcurrent`,
    );
    if (maximumConcurrent > 1) {
      throw new Error(`parallel encounter pool ${poolId} exceeds the single-lane authority contract`);
    }
    const requiresWeatherState = boolean(
      pool.requiresWeatherState,
      `encounter manifest.parallelEncounterPools.${poolId}.requiresWeatherState`,
    );
    if (requiresWeatherState) {
      throw new Error(`parallel encounter pool ${poolId} must remain independent of weather state`);
    }
    return Object.freeze({
      id: poolId,
      patternIds: Object.freeze(patternIds.slice().sort()),
      maximumConcurrent,
      requiresWeatherState,
      selectionSalt,
    });
  });
  return Object.freeze(pools);
}

function assertWeatherIsolation(value: unknown): void {
  const manifest = record(value, "encounter manifest");
  const weather = record(manifest.weatherDecoupling, "encounter manifest.weatherDecoupling");
  const forbiddenBooleans = [
    "weatherEventCanTriggerPattern",
    "weatherEventCanSpawnProjectile",
    "weatherEventCanAlterProjectileMotion",
    "weatherEventCanAlterCollision",
    "weatherEventCanAlterSafeGap",
    "weatherRngEntersPatternSeed",
  ];
  for (const field of forbiddenBooleans) {
    if (weather[field] !== false) throw new Error(`encounter weather isolation requires ${field}=false`);
  }
  const scheduling = record(manifest.scheduling, "encounter manifest.scheduling");
  const forbiddenSeedInputs = array(
    scheduling.forbiddenSeedInputs,
    "encounter manifest.scheduling.forbiddenSeedInputs",
  ).map((entry, index) =>
    string(entry, `encounter manifest.scheduling.forbiddenSeedInputs[${index}]`));
  for (const required of ["weatherEvent", "weatherSeed", "weatherRng"]) {
    if (!forbiddenSeedInputs.includes(required)) {
      throw new Error(`encounter scheduling must forbid seed input: ${required}`);
    }
  }
}

function assertEventSchema(value: unknown): string {
  const manifest = record(value, "event schema");
  const schemaVersion = string(manifest.schemaVersion, "event schema.schemaVersion");
  string(manifest.id, "event schema.id");
  const events = array(manifest.events, "event schema.events").map((raw, index) => {
    const event = record(raw, `event schema.events[${index}]`);
    return string(event.id, `event schema.events[${index}].id`);
  });
  const eventIds = new Set(events);
  if (eventIds.size !== events.length) throw new Error("event schema contains duplicate event IDs");
  if (eventIds.size === 0) throw new Error("event schema must contain canonical event definitions");
  if (!sameStrings(events, CANONICAL_EVENT_IDS)) {
    throw new Error("encounter authority event schema diverges from the canonical bus registry");
  }
  return schemaVersion;
}

class Catalog implements EncounterAuthorityCatalog {
  readonly schemaVersion: string;
  readonly segments: readonly EncounterSegmentDefinition[];
  readonly rooms: readonly RoomComposerDefinition[];
  readonly bosses: readonly BossDefinition[];
  readonly parallelPools: readonly ParallelEncounterPoolDefinition[];
  readonly runRoomOrder: readonly string[];
  readonly minimumRoomsPerRun: number;
  readonly maximumRoomsPerRun: number;
  readonly maximumBossesPerRun: number;
  readonly safeGapHandoffMs: number;
  readonly projectileBudgetByDifficulty: Readonly<Record<string, number>>;
  readonly failurePolicy: EncounterAuthorityCatalog["failurePolicy"];
  readonly fallbackResolution: EncounterAuthorityCatalog["fallbackResolution"];
  readonly weatherIsPresentationOnly = true as const;
  private readonly roomsById: ReadonlyMap<string, RoomComposerDefinition>;
  private readonly bossesById: ReadonlyMap<string, BossDefinition>;
  private readonly patternDurations: ReadonlyMap<string, number>;

  constructor(source: EncounterManifestSource) {
    const encounter = record(source.encounter, "encounter manifest");
    const encounterVersion = string(encounter.schemaVersion, "encounter manifest.schemaVersion");
    const roomRoot = record(source.rooms, "room manifest");
    const bossRoot = record(source.bosses, "boss manifest");
    const patternRoot = record(source.patterns, "patterns manifest");
    const versions = [
      encounterVersion,
      string(roomRoot.schemaVersion, "room manifest.schemaVersion"),
      string(bossRoot.schemaVersion, "boss manifest.schemaVersion"),
      string(patternRoot.schemaVersion, "patterns manifest.schemaVersion"),
      assertEventSchema(source.events),
    ];
    const run = parseRun(source.run);
    versions.push(run.schemaVersion);
    if (!versions.every((version) => version === encounterVersion)) {
      throw new Error("encounter authority manifests must share one schema version");
    }

    const patterns = parsePatterns(source.patterns);
    this.patternDurations = new Map(patterns.map((pattern) => [pattern.id, pattern.durationMs]));
    const patternIds = new Set(this.patternDurations.keys());
    this.segments = parseSegments(source.encounter);
    this.rooms = parseRooms(source.rooms);
    const parsedBosses = parseBosses(source.bosses, this.patternDurations);
    this.bosses = parsedBosses.bosses;
    this.fallbackResolution = parsedBosses.fallback;
    this.parallelPools = parseParallelPools(source.encounter, patternIds);
    this.schemaVersion = encounterVersion;
    this.runRoomOrder = run.rooms;
    this.minimumRoomsPerRun = run.minimumRooms;
    this.maximumRoomsPerRun = run.maximumRooms;
    this.maximumBossesPerRun = run.maximumBosses;
    const scheduling = record(encounter.scheduling, "encounter manifest.scheduling");
    if (
      scheduling.enemyPatternStartsOnlyAfterTelegraph !== true
      || scheduling.crossedFrameEventsExactlyOnce !== true
      || scheduling.maxLaserAndDenseWallOverlapMs !== 0
    ) {
      throw new Error("encounter scheduling safety contract is unsupported or incomplete");
    }
    this.safeGapHandoffMs = positiveInteger(
      scheduling.safeGapHandoffMs,
      "encounter manifest.scheduling.safeGapHandoffMs",
    );
    const rawBudgets = record(
      scheduling.maxProjectileBudget,
      "encounter manifest.scheduling.maxProjectileBudget",
    );
    const projectileBudgets: Record<string, number> = Object.create(null) as Record<string, number>;
    for (const difficulty of Object.keys(rawBudgets).sort(compareText)) {
      projectileBudgets[difficulty] = positiveInteger(
        rawBudgets[difficulty],
        `encounter manifest.scheduling.maxProjectileBudget.${difficulty}`,
      );
    }
    this.projectileBudgetByDifficulty = Object.freeze(projectileBudgets);
    const rawFailure = record(encounter.failurePolicy, "encounter manifest.failurePolicy");
    if (rawFailure.noForcedHitAtMaximumSpeed !== true || rawFailure.collisionNeverFromAlpha !== true) {
      throw new Error("encounter failure policy must preserve reachability and collision authority");
    }
    this.failurePolicy = Object.freeze({
      minimumUntelegraphedSpawnDistancePx: positiveInteger(
        rawFailure.noUntelegraphedSpawnWithinPxOfPlayer,
        "encounter manifest.failurePolicy.noUntelegraphedSpawnWithinPxOfPlayer",
      ),
      noForcedHitAtMaximumSpeed: true,
      collisionNeverFromAlpha: true,
    });
    this.roomsById = new Map(this.rooms.map((composer) => [composer.room, composer]));
    this.bossesById = new Map(this.bosses.map((boss) => [boss.id, boss]));

    if (!sameStrings([...this.roomsById.keys()].sort(), this.runRoomOrder.slice().sort())) {
      throw new Error("run room references and room composer authorities must match exactly");
    }
    for (const composer of this.rooms) {
      for (const entry of composer.patterns) {
        if (!patternIds.has(entry.patternId)) {
          throw new Error(`room composer references unknown pattern: ${entry.patternId}`);
        }
      }
    }
    for (const patternId of run.patternRefs) {
      if (!patternIds.has(patternId)) throw new Error(`run director references unknown pattern: ${patternId}`);
    }
    for (const boss of this.bosses) {
      if (!this.roomsById.has(boss.room)) {
        throw new Error(`boss references unknown room: ${boss.room}`);
      }
    }
    for (const room of this.runRoomOrder) {
      if (!this.bosses.some((boss) => boss.room === room)) {
        throw new Error(`room has no boss handoff authority: ${room}`);
      }
    }
    assertWeatherIsolation(source.encounter);
    const patternSegment = this.segments.find((segment) => segment.patternSlots !== null);
    const finalSegment = this.segments[this.segments.length - 1];
    if (patternSegment === undefined || finalSegment === undefined) {
      throw new Error("encounter segment authority is incomplete");
    }
    if (finalSegment.minimumDurationMs < this.safeGapHandoffMs) {
      throw new Error("required rest is shorter than the safe-gap handoff contract");
    }
    for (const composer of this.rooms) {
      for (const entry of composer.patterns) {
        const duration = this.requirePatternDuration(entry.patternId);
        if (duration < patternSegment.minimumDurationMs || duration > patternSegment.maximumDurationMs) {
          throw new Error(`room pattern duration is outside the encounter read window: ${entry.patternId}`);
        }
      }
      for (const tier of composer.tiers) {
        if (tier.restMs < finalSegment.minimumDurationMs || tier.restMs > finalSegment.maximumDurationMs) {
          throw new Error(`room tier rest is outside the required encounter rest window: ${composer.room}`);
        }
        const authorityBudget = this.projectileBudgetByDifficulty[tier.difficulty];
        if (authorityBudget === undefined || tier.maximumProjectiles > authorityBudget) {
          throw new Error(`room tier exceeds encounter projectile authority: ${composer.room}:${tier.id}`);
        }
      }
    }
  }

  requireRoom(roomId: string): RoomComposerDefinition {
    const room = this.roomsById.get(roomId);
    if (room === undefined) throw new Error(`unknown authored room: ${roomId}`);
    return room;
  }

  requireBoss(bossId: string): BossDefinition {
    const boss = this.bossesById.get(bossId);
    if (boss === undefined) throw new Error(`unknown authored boss: ${bossId}`);
    return boss;
  }

  requirePatternDuration(patternId: string): number {
    const duration = this.patternDurations.get(patternId);
    if (duration === undefined) throw new Error(`unknown authored pattern: ${patternId}`);
    return duration;
  }

  bossesForRoom(roomId: string): readonly BossDefinition[] {
    this.requireRoom(roomId);
    return Object.freeze(this.bosses.filter((boss) => boss.room === roomId).sort((a, b) =>
      compareText(a.id, b.id)));
  }
}

export function defaultEncounterManifestSource(): EncounterManifestSource {
  return Object.freeze({
    encounter: encounterManifestJson,
    bosses: bossManifestJson,
    rooms: roomManifestJson,
    run: runManifestJson,
    patterns: patternManifestJson,
    events: eventSchemaJson,
  });
}

export function validateEncounterAuthorityManifests(
  source: EncounterManifestSource = defaultEncounterManifestSource(),
): EncounterAuthorityCatalog {
  return Object.freeze(new Catalog(source));
}

export const V4_ENCOUNTER_CATALOG = validateEncounterAuthorityManifests();

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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

function pickWeighted<T>(
  values: readonly T[],
  weightFor: (value: T) => number,
  random: () => number,
): T {
  if (values.length === 0) throw new Error("weighted selection requires candidates");
  const weights = values.map((value) => Math.max(0.0001, weightFor(value)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = random() * total;
  for (let index = 0; index < values.length; index += 1) {
    cursor -= weights[index] ?? 0;
    if (cursor <= 0) return values[index] as T;
  }
  return values[values.length - 1] as T;
}

function tickDurationForMs(durationMs: number): number {
  return Math.ceil(durationMs * MASTER_TICK_HZ / 1000);
}

function sampleInteger(minimum: number, maximum: number, random: () => number): number {
  if (minimum === maximum) return minimum;
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function requireSeed(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("encounter seed must be non-negative");
  return value >>> 0;
}

function behaviorWeight(
  composer: RoomComposerDefinition,
  behavior: Readonly<Record<string, number>>,
): number {
  let total = 1;
  for (const [metric, weight] of Object.entries(composer.metricWeights)) {
    const value = behavior[metric] ?? 0;
    if (!Number.isFinite(value)) throw new Error(`behavior metric must be finite: ${metric}`);
    total += value * weight;
  }
  return Math.max(0.0001, total);
}

/**
 * Compiles the repository's historical segment-envelope fixture. Its sampled
 * segment durations and weather choices are not authored V4 RunComposer
 * policy; live composition must use a separately resolved authority.
 */
export function compileEncounterEnvelopeFixture(
  options: EncounterEnvelopeFixtureOptions,
  catalog: EncounterAuthorityCatalog = V4_ENCOUNTER_CATALOG,
): EncounterEnvelopeFixture {
  const seed = requireSeed(options.seed);
  const roomCount = options.roomCount ?? catalog.maximumRoomsPerRun;
  if (
    !Number.isSafeInteger(roomCount)
    || roomCount < catalog.minimumRoomsPerRun
    || roomCount > catalog.maximumRoomsPerRun
    || roomCount > catalog.rooms.length
  ) {
    throw new Error("room count is outside the authored run range");
  }
  const combatSegment = catalog.segments.find((segment) => segment.patternSlots !== null);
  if (combatSegment?.patternSlots === null || combatSegment === undefined) {
    throw new Error("encounter catalog has no pattern-bearing segment");
  }
  const wavesPerRoom = options.wavesPerRoom ?? combatSegment.patternSlots[1];
  if (
    !Number.isSafeInteger(wavesPerRoom)
    || wavesPerRoom < combatSegment.patternSlots[0]
    || wavesPerRoom > combatSegment.patternSlots[1]
  ) {
    throw new Error("wave count is outside the authored pattern-slot range");
  }
  const behavior = options.behavior ?? Object.freeze({});
  // This read proves the context is accepted intentionally; it never enters any RNG or gameplay branch.
  void options.presentationWeather;
  const random = mulberry32(seed);
  const remainingRooms = catalog.rooms.slice().sort((a, b) => compareText(a.room, b.room));
  const chosenRooms: RoomComposerDefinition[] = [];
  while (chosenRooms.length < roomCount) {
    const selected = pickWeighted(
      remainingRooms,
      (composer) => behaviorWeight(composer, behavior),
      random,
    );
    chosenRooms.push(selected);
    remainingRooms.splice(remainingRooms.indexOf(selected), 1);
  }

  let clockTick120 = 0;
  const plannedRooms: PlannedRoom[] = [];
  for (const [roomOrdinal, composer] of chosenRooms.entries()) {
    const roomStart = clockTick120;
    const tier = options.tierId === undefined
      ? composer.tiers[0]
      : composer.tiers.find((candidate) => candidate.id === options.tierId);
    if (tier === undefined) throw new Error(`room ${composer.room} has no requested tier: ${options.tierId}`);
    const candidates = composer.patterns.slice().sort((a, b) => compareText(a.patternId, b.patternId));
    if (wavesPerRoom > candidates.length) {
      throw new Error(`room ${composer.room} has too few patterns for requested waves`);
    }
    const waves: PlannedWave[] = [];
    for (let waveOrdinal = 0; waveOrdinal < wavesPerRoom; waveOrdinal += 1) {
      const selected = pickWeighted(candidates, (entry) => entry.baseWeight, random);
      candidates.splice(candidates.indexOf(selected), 1);
      const encounterSeed = (seed ^ roomOrdinal ^ waveOrdinal) >>> 0;
      const segmentRandom = mulberry32(encounterSeed);
      const waveStart = clockTick120;
      const segments: PlannedSegment[] = [];
      for (const [segmentOrdinal, segment] of catalog.segments.entries()) {
        const isPatternSegment = segment.patternSlots !== null;
        const durationMs = isPatternSegment
          ? catalog.requirePatternDuration(selected.patternId)
          : segment.required && segment.newSpawns === false
            ? tier.restMs
            : sampleInteger(segment.minimumDurationMs, segment.maximumDurationMs, segmentRandom);
        const durationTick120 = tickDurationForMs(durationMs);
        const planned: PlannedSegment = Object.freeze({
          id: `${composer.room}:${roomOrdinal}:wave:${waveOrdinal}:segment:${segmentOrdinal}:${segment.id}`,
          segmentOrdinal,
          startTick120: clockTick120,
          endTick120: clockTick120 + durationTick120,
          patternId: isPatternSegment ? selected.patternId : null,
          collision: segment.collision,
          newSpawns: segment.newSpawns,
          required: segment.required,
        });
        segments.push(planned);
        clockTick120 = planned.endTick120;
      }

      let parallelPatternId: string | null = null;
      const pool = catalog.parallelPools[0];
      if (pool !== undefined && pool.maximumConcurrent > 0 && pool.patternIds.length > 0) {
        const stablePool = pool.patternIds.slice().sort(compareText);
        const parallelRandom = mulberry32((seed ^ waveOrdinal ^ pool.selectionSalt) >>> 0);
        parallelPatternId = stablePool[Math.floor(parallelRandom() * stablePool.length)] ?? null;
      }
      waves.push(Object.freeze({
        id: `${composer.room}:${roomOrdinal}:wave:${waveOrdinal}`,
        room: composer.room,
        roomOrdinal,
        waveOrdinal,
        patternId: selected.patternId,
        seed: encounterSeed,
        tierId: tier.id,
        difficulty: tier.difficulty,
        maximumProjectiles: tier.maximumProjectiles,
        maximumEmitters: tier.maximumEmitters,
        parallelPatternId,
        segments: Object.freeze(segments),
        startTick120: waveStart,
        endTick120: clockTick120,
      }));
    }
    plannedRooms.push(Object.freeze({
      id: `room:${roomOrdinal}:${composer.room}`,
      room: composer.room,
      roomOrdinal,
      startTick120: roomStart,
      endTick120: clockTick120,
      waves: Object.freeze(waves),
    }));
  }

  const terminalRoom = plannedRooms[plannedRooms.length - 1];
  if (terminalRoom === undefined) throw new Error("encounter plan requires a terminal room");
  const bossCandidates = catalog.bossesForRoom(terminalRoom.room);
  const boss = bossCandidates[Math.floor(random() * bossCandidates.length)];
  if (boss === undefined) throw new Error(`terminal room has no authored boss: ${terminalRoom.room}`);
  const bossStart = clockTick120;
  const bossPhases: PlannedBossPhase[] = [];
  for (const [phaseIndex, phase] of boss.phases.entries()) {
    const startTick120 = clockTick120;
    clockTick120 += tickDurationForMs(phase.patternDurationMs);
    bossPhases.push(Object.freeze({
      id: `${boss.id}:phase:${phaseIndex}:${phase.id}`,
      phaseId: phase.id,
      phaseIndex,
      patternId: phase.patternId,
      startTick120,
      endTick120: clockTick120,
    }));
  }
  const plannedBoss = Object.freeze({
    bossId: boss.id,
    generation: 1,
    startTick120: bossStart,
    endTick120: clockTick120,
    phases: Object.freeze(bossPhases),
  });
  return Object.freeze({
    id: `encounter-envelope-fixture-v4-${seed.toString(16).padStart(8, "0")}`,
    seed,
    rooms: Object.freeze(plannedRooms),
    boss: plannedBoss,
    handoffTick120: bossStart,
  });
}

function observation(
  stableOrder: number,
  kind: EncounterObservationKind,
  tick120: number,
  room: string,
  waveId: string | null,
  segmentId: string | null,
  patternId: string | null,
  bossId: string | null,
): TimelineObservation {
  return Object.freeze({stableOrder, kind, tick120, room, waveId, segmentId, patternId, bossId});
}

function compileObservationTimeline(plan: EncounterEnvelopeFixture): readonly TimelineObservation[] {
  const timeline: TimelineObservation[] = [];
  let stableOrder = 0;
  for (const room of plan.rooms) {
    timeline.push(observation(stableOrder++, "room.enter", room.startTick120, room.room, null, null, null, null));
    for (const wave of room.waves) {
      timeline.push(observation(
        stableOrder++,
        "wave.enter",
        wave.startTick120,
        room.room,
        wave.id,
        null,
        wave.patternId,
        null,
      ));
      for (const segment of wave.segments) {
        timeline.push(observation(
          stableOrder++,
          "segment.enter",
          segment.startTick120,
          room.room,
          wave.id,
          segment.id,
          segment.patternId,
          null,
        ));
        timeline.push(observation(
          stableOrder++,
          "segment.exit",
          segment.endTick120,
          room.room,
          wave.id,
          segment.id,
          segment.patternId,
          null,
        ));
      }
      timeline.push(observation(
        stableOrder++,
        "wave.exit",
        wave.endTick120,
        room.room,
        wave.id,
        null,
        wave.patternId,
        null,
      ));
    }
    timeline.push(observation(stableOrder++, "room.exit", room.endTick120, room.room, null, null, null, null));
  }
  const terminalRoom = plan.rooms[plan.rooms.length - 1];
  if (terminalRoom !== undefined) {
    timeline.push(observation(
      stableOrder++,
      "boss.handoff",
      plan.handoffTick120,
      terminalRoom.room,
      null,
      null,
      null,
      plan.boss.bossId,
    ));
  }
  timeline.sort((left, right) => left.tick120 - right.tick120 || left.stableOrder - right.stableOrder);
  return Object.freeze(timeline);
}

function publicObservation(value: TimelineObservation): EncounterObservation {
  return Object.freeze({
    kind: value.kind,
    tick120: value.tick120,
    room: value.room,
    waveId: value.waveId,
    segmentId: value.segmentId,
    patternId: value.patternId,
    bossId: value.bossId,
  });
}

export class EncounterEnvelopeObservationMachine {
  private readonly timeline: readonly TimelineObservation[];
  private cursor = 0;
  private lastAdvancedTick = -1;

  constructor(readonly plan: EncounterEnvelopeFixture) {
    this.timeline = compileObservationTimeline(plan);
  }

  advanceToTick(tick120: number): readonly EncounterObservation[] {
    const tick = nonNegativeInteger(tick120, "encounter scheduler tick120");
    if (tick < this.lastAdvancedTick) throw new Error("encounter scheduler cannot move backward");
    const crossed: EncounterObservation[] = [];
    while (this.cursor < this.timeline.length) {
      const next = this.timeline[this.cursor];
      if (next === undefined || next.tick120 > tick) break;
      crossed.push(publicObservation(next));
      this.cursor += 1;
    }
    this.lastAdvancedTick = tick;
    return Object.freeze(crossed);
  }

  complete(): boolean {
    return this.cursor >= this.timeline.length;
  }

  observationsRemaining(): number {
    return this.timeline.length - this.cursor;
  }
}

export type BossResolutionKind = "authored-condition" | "authoritative-duration";

export interface BossAuthoritySnapshot {
  readonly bossId: string;
  readonly generation: number;
  readonly state: "idle" | "active" | "resolved";
  readonly phaseIndex: number | null;
  readonly phaseId: string | null;
  readonly transitionLocked: boolean;
  readonly collisionEnabled: boolean;
  /** No standalone V4 rupture event exists; material state commits with resolution. */
  readonly structuralRupture: null;
  readonly resolution: Readonly<{
    kind: BossResolutionKind;
    tick120: number;
    outcome: string;
    fact: string;
    materialRemainder: string;
    terminalEvent: string;
  }> | null;
}

declare const preparedBossPhaseExitBrand: unique symbol;

/**
 * Opaque identity for one staged Boss phase exit. The proposal itself exposes
 * no mutation port; a coordinator must ask the owning authority for its frozen
 * view, append that view's drafts with every sibling proposal in one batch,
 * then apply the proposal on the same synchronous authority turn.
 */
export interface PreparedBossPhaseExit {
  readonly [preparedBossPhaseExitBrand]: "PreparedBossPhaseExit";
}

export interface PreparedBossPhaseExitView {
  readonly authority: "v4-boss-phase-exit-proposal";
  readonly bossId: string;
  readonly generation: number;
  readonly tick120: number;
  readonly fromPhaseId: string;
  readonly toPhaseId: string;
  readonly attackPlanId: string;
  readonly laserGeometry: string | null;
  readonly spatialLaw: string;
  readonly drafts: readonly GameplayEventDraft[];
}

interface PreparedBossPhaseExitRecord {
  readonly owner: BossPhaseAuthority;
  readonly bus: CanonicalEventBus;
  readonly revision: number;
  readonly nextRevision: number;
  readonly nextPhaseIndex: number;
  readonly view: PreparedBossPhaseExitView;
  status: "prepared" | "applied";
}

const PREPARED_BOSS_PHASE_EXITS = new WeakMap<object, PreparedBossPhaseExitRecord>();
const EXACT_BOSS_PHASE_AUTHORITIES = new WeakSet<BossPhaseAuthority>();
const BOSS_PHASE_AUTHORITY_COMPOSITE_METHODS = Object.freeze([
  "snapshot",
  "preparePhaseExit",
  "readPreparedPhaseExit",
  "applyPreparedPhaseExit",
] as const);

/** Exact production identity used by cross-authority prepared composition. */
export function isExactBossPhaseAuthority(value: unknown): value is BossPhaseAuthority {
  return typeof value === "object"
    && value !== null
    && EXACT_BOSS_PHASE_AUTHORITIES.has(value as BossPhaseAuthority)
    && Object.getPrototypeOf(value) === BossPhaseAuthority.prototype
    && BOSS_PHASE_AUTHORITY_COMPOSITE_METHODS.every((method) =>
      !Object.prototype.hasOwnProperty.call(value, method));
}

export class BossPhaseAuthority {
  readonly boss: BossDefinition;
  private readonly fallbackResolution: EncounterAuthorityCatalog["fallbackResolution"];
  private state: BossAuthoritySnapshot["state"] = "idle";
  private phaseIndex: number | null = null;
  private transitionLocked = false;
  private collisionEnabled = false;
  private lastTransitionTick = -1;
  private resolution: BossAuthoritySnapshot["resolution"] = null;
  private revision = 0;

  constructor(
    bossId: string,
    readonly generation: number,
    private readonly bus: CanonicalEventBus,
    catalog: EncounterAuthorityCatalog = V4_ENCOUNTER_CATALOG,
  ) {
    if (!Number.isSafeInteger(generation) || generation <= 0) {
      throw new Error("boss generation must be a positive safe integer");
    }
    this.boss = catalog.requireBoss(bossId);
    this.fallbackResolution = catalog.fallbackResolution;
    if (new.target === BossPhaseAuthority) EXACT_BOSS_PHASE_AUTHORITIES.add(this);
  }

  begin(tick120: number): void {
    if (this.state !== "idle") throw new Error("boss encounter cannot begin twice");
    const tick = nonNegativeInteger(tick120, "boss begin tick120");
    const phase = this.boss.phases[0];
    if (phase === undefined) throw new Error("boss has no first phase");
    this.withTransition(() => {
      this.bus.enqueueBatch([
        this.bossEventDraft("boss.encounter.begin", tick, 0, "encounter-begin", {
          bossId: this.boss.id,
          generation: this.generation,
          phaseCount: this.boss.phases.length,
        }),
        this.bossEventDraft("boss.phase.enter", tick, 1, `phase-enter:${phase.id}`, {
          bossId: this.boss.id,
          generation: this.generation,
          phaseId: phase.id,
          phaseIndex: 0,
        }),
        this.bossEventDraft(
          "boss.phase.attack_plan.commit",
          tick,
          2,
          `attack-plan:${phase.id}`,
          {
            bossId: this.boss.id,
            generation: this.generation,
            phaseId: phase.id,
            attackPlanId: phase.patternId,
          },
        ),
      ]);
      this.state = "active";
      this.phaseIndex = 0;
      this.collisionEnabled = true;
      this.lastTransitionTick = tick;
      this.revision += 1;
    });
  }

  /**
   * Stage the exact Boss facts and next-state assignment without touching the
   * event bus or live machine. A future laser coordinator may combine the
   * returned view's drafts with a laser-start proposal before either state is
   * applied. This is a narrow prepared mutation, not a rollback transaction.
   */
  preparePhaseExit(
    expectedPhaseId: string,
    tick120: number,
    cause: string,
  ): PreparedBossPhaseExit {
    return this.withTransition(() =>
      this.preparePhaseExitUnlocked(expectedPhaseId, tick120, cause));
  }

  /**
   * Read a frozen, plain-data proposal after verifying owner, bus, revision,
   * and one-use state. Call this immediately before the combined append.
   */
  readPreparedPhaseExit(
    proposal: PreparedBossPhaseExit,
    expectedBus: CanonicalEventBus,
  ): PreparedBossPhaseExitView {
    return this.withTransition(() =>
      this.requirePreparedPhaseExit(proposal, expectedBus).view);
  }

  /**
   * Apply only the already-prepared scalar state assignment. The expected use
   * is immediately after one combined `enqueueBatch()` has returned. Once the
   * proposal is verified on this synchronous turn, the unchecked assignment
   * performs no bus write, allocation, validation, callback, or flush.
   */
  applyPreparedPhaseExit(
    proposal: PreparedBossPhaseExit,
    expectedBus: CanonicalEventBus,
    receipt: CanonicalEventBatchReceipt,
  ): void {
    this.withTransition(() => {
      const prepared = this.requirePreparedPhaseExit(proposal, expectedBus);
      consumeCanonicalEventBatchReceipt(receipt, expectedBus, prepared.view.drafts);
      this.applyPreparedPhaseExitUnchecked(prepared);
    });
  }

  commitPhaseExit(expectedPhaseId: string, tick120: number, cause: string): void {
    this.withTransition(() => {
      const proposal = this.preparePhaseExitUnlocked(expectedPhaseId, tick120, cause);
      const prepared = this.requirePreparedPhaseExit(proposal, this.bus);
      const receipts = CanonicalEventBus.prototype.enqueuePreparedBatch.call(
        this.bus,
        Object.freeze([prepared.view.drafts]),
      );
      const receipt = receipts[0] as CanonicalEventBatchReceipt;
      consumeCanonicalEventBatchReceipt(receipt, this.bus, prepared.view.drafts);
      this.applyPreparedPhaseExitUnchecked(prepared);
    });
  }

  resolveFinal(expectedPhaseId: string, tick120: number, kind: BossResolutionKind): void {
    this.requireActivePhase(expectedPhaseId);
    const currentIndex = this.phaseIndex as number;
    const phase = this.boss.phases[currentIndex];
    if (phase === undefined || currentIndex !== this.boss.phases.length - 1) {
      throw new Error("boss protocol cannot resolve before its final phase");
    }
    if (kind !== "authored-condition" && kind !== "authoritative-duration") {
      throw new Error("boss resolution kind is not authored");
    }
    const tick = this.requireLaterTick(tick120, "boss resolve tick120");
    const resolution = kind === "authored-condition"
      ? Object.freeze({
        kind,
        tick120: tick,
        outcome: this.boss.resolutionId,
        fact: this.boss.resolutionFact,
        materialRemainder: this.boss.materialRemainder,
        terminalEvent: this.boss.terminalEvent,
      })
      : Object.freeze({
        kind,
        tick120: tick,
        outcome: this.fallbackResolution.id,
        fact: this.fallbackResolution.fact,
        materialRemainder: this.boss.materialRemainder,
        terminalEvent: this.fallbackResolution.terminalEvent,
      });
    this.withTransition(() => {
      this.bus.enqueueBatch([
        this.bossEventDraft("boss.phase.exit", tick, 0, `phase-exit:${phase.id}`, {
          bossId: this.boss.id,
          generation: this.generation,
          phaseId: phase.id,
          cause: kind,
        }),
        this.bossEventDraft("boss.encounter.resolve", tick, 1, "encounter-resolve", {
          bossId: this.boss.id,
          generation: this.generation,
          outcome: resolution.outcome,
          finalPhaseId: phase.id,
        }),
      ]);
      // Collision authority changes only after the complete canonical fact
      // batch is accepted; a rejected occurrence leaves the active phase intact.
      this.collisionEnabled = false;
      this.resolution = resolution;
      this.state = "resolved";
      this.lastTransitionTick = tick;
      this.revision += 1;
    });
  }

  snapshot(): BossAuthoritySnapshot {
    const phase = this.phaseIndex === null ? null : this.boss.phases[this.phaseIndex] ?? null;
    return Object.freeze({
      bossId: this.boss.id,
      generation: this.generation,
      state: this.state,
      phaseIndex: this.phaseIndex,
      phaseId: phase?.id ?? null,
      transitionLocked: this.transitionLocked,
      collisionEnabled: this.collisionEnabled,
      structuralRupture: null,
      resolution: this.resolution,
    });
  }

  private requireActivePhase(expectedPhaseId: string): void {
    if (this.state !== "active" || this.phaseIndex === null) {
      throw new Error("boss phase transition requires an active protocol");
    }
    const phase = this.boss.phases[this.phaseIndex];
    if (phase?.id !== expectedPhaseId) {
      throw new Error(`boss phase transition expected ${phase?.id ?? "none"}, received ${expectedPhaseId}`);
    }
  }

  private requireLaterTick(value: number, path: string): number {
    const tick = nonNegativeInteger(value, path);
    if (tick <= this.lastTransitionTick) throw new Error("boss phase transitions require a later exact tick");
    return tick;
  }

  private preparePhaseExitUnlocked(
    expectedPhaseIdValue: string,
    tick120Value: number,
    causeValue: string,
  ): PreparedBossPhaseExit {
    const expectedPhaseId = string(expectedPhaseIdValue, "boss expected phaseId");
    this.requireActivePhase(expectedPhaseId);
    const tick = this.requireLaterTick(tick120Value, "boss phase exit tick120");
    const cause = string(causeValue, "boss phase exit cause");
    const currentIndex = this.phaseIndex as number;
    const current = this.boss.phases[currentIndex];
    const next = this.boss.phases[currentIndex + 1];
    if (current === undefined || next === undefined) {
      throw new Error("final boss phase must use resolveFinal instead of phase exit");
    }
    const nextRevision = this.revision + 1;
    if (!Number.isSafeInteger(nextRevision)) {
      throw new Error("boss authority revision exceeds the safe integer range");
    }
    const drafts = Object.freeze([
      this.bossEventDraft("boss.phase.exit", tick, 0, `phase-exit:${current.id}`, {
        bossId: this.boss.id,
        generation: this.generation,
        phaseId: current.id,
        cause,
      }),
      this.bossEventDraft("boss.phase.swap", tick, 1, `phase-swap:${current.id}:${next.id}`, {
        bossId: this.boss.id,
        generation: this.generation,
        fromPhaseId: current.id,
        toPhaseId: next.id,
      }),
      this.bossEventDraft("boss.phase.enter", tick, 2, `phase-enter:${next.id}`, {
        bossId: this.boss.id,
        generation: this.generation,
        phaseId: next.id,
        phaseIndex: currentIndex + 1,
      }),
      this.bossEventDraft(
        "boss.phase.attack_plan.commit",
        tick,
        3,
        `attack-plan:${next.id}`,
        {
          bossId: this.boss.id,
          generation: this.generation,
          phaseId: next.id,
          attackPlanId: next.patternId,
        },
      ),
    ]);
    const view: PreparedBossPhaseExitView = Object.freeze({
      authority: "v4-boss-phase-exit-proposal" as const,
      bossId: this.boss.id,
      generation: this.generation,
      tick120: tick,
      fromPhaseId: current.id,
      toPhaseId: next.id,
      attackPlanId: next.patternId,
      laserGeometry: next.laserGeometry,
      spatialLaw: next.spatialLaw,
      drafts,
    });
    const proposal = Object.freeze(Object.create(null)) as PreparedBossPhaseExit;
    PREPARED_BOSS_PHASE_EXITS.set(proposal, {
      owner: this,
      bus: this.bus,
      revision: this.revision,
      nextRevision,
      nextPhaseIndex: currentIndex + 1,
      view,
      status: "prepared",
    });
    return proposal;
  }

  private requirePreparedPhaseExit(
    proposal: PreparedBossPhaseExit,
    expectedBus: CanonicalEventBus,
  ): PreparedBossPhaseExitRecord {
    if (typeof (proposal as unknown) !== "object" || proposal === null) {
      throw new Error("boss phase-exit proposal is not recognized");
    }
    const prepared = PREPARED_BOSS_PHASE_EXITS.get(proposal as object);
    if (prepared === undefined || prepared.owner !== this) {
      throw new Error("boss phase-exit proposal is not owned by this authority");
    }
    if (prepared.bus !== expectedBus) {
      throw new Error("boss phase-exit proposal event bus does not match");
    }
    if (prepared.status !== "prepared") {
      throw new Error("boss phase-exit proposal was already applied");
    }
    if (prepared.revision !== this.revision) {
      throw new Error("boss phase-exit proposal is stale");
    }
    return prepared;
  }

  private applyPreparedPhaseExitUnchecked(prepared: PreparedBossPhaseExitRecord): void {
    prepared.status = "applied";
    this.phaseIndex = prepared.nextPhaseIndex;
    this.lastTransitionTick = prepared.view.tick120;
    this.revision = prepared.nextRevision;
  }

  private withTransition<Result>(commit: () => Result): Result {
    if (this.transitionLocked) throw new Error("boss phase transition is already locked");
    this.transitionLocked = true;
    try {
      return commit();
    } finally {
      this.transitionLocked = false;
    }
  }

  private bossEventDraft(
    id: string,
    tick120: number,
    localSequence: number,
    occurrenceSuffix: string,
    payload: GameplayEventDraft["payload"],
  ): GameplayEventDraft {
    const frozenPayload = Object.freeze({...record(payload, `boss event ${id} payload`)});
    return Object.freeze({
      id,
      tick120,
      entityStableId: `boss:${this.boss.id}:generation:${this.generation}`,
      localSequence,
      occurrenceKey: `boss-authority:${this.boss.id}:${this.generation}:${occurrenceSuffix}`,
      payload: frozenPayload,
    });
  }
}
