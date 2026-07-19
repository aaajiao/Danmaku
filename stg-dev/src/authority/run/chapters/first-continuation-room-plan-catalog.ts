import encounterDirectorJson from "../../../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/encounter-director-v4.json";
import executablePatternsJson from "../../../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/executable-patterns-v4.json";
import projectileLifecycleJson from "../../../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/projectile-lifecycle-v4.json";
import roomComposersJson from "../../../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/room-composers-v4.json";
import patternSignaturesJson from "../../../../../1bit-stg-complete-asset-kit-v4/gameplay/reports/pattern-structure-signatures-v4.json";

const PREVIOUS_PATTERN_ID = "room.forced.left_right_gate" as const;
const TARGET_ROOM_ORDER = Object.freeze([
  "INFORMATION",
  "IN_BETWEEN",
  "POLARIZED",
] as const);
const COMPOSER_ORDER = Object.freeze([
  "INFORMATION",
  "FORCED_ALIGNMENT",
  "IN_BETWEEN",
  "POLARIZED",
] as const);
const COMPOSER_ID_ORDER = Object.freeze([
  "composer.information",
  "composer.forced_alignment",
  "composer.in_between",
  "composer.polarized",
] as const);
const TIER_ORDER = Object.freeze(["listen", "read", "enforce"] as const);
const DIFFICULTY_ORDER = Object.freeze(["EASY", "NORMAL", "HARD"] as const);
const PROJECTILE_POOL_CLASS_ORDER = Object.freeze([
  "micro",
  "medium",
  "heavy",
  "splitChildren",
] as const);

export type CanonicalRunFirstContinuationRoomPlanCatalogRoomId =
  typeof TARGET_ROOM_ORDER[number];
export type CanonicalRunFirstContinuationRoomPlanCatalogTierId =
  typeof TIER_ORDER[number];
export type CanonicalRunFirstContinuationRoomPlanCatalogDifficulty =
  typeof DIFFICULTY_ORDER[number];
export type CanonicalRunFirstContinuationRoomPlanCatalogProjectilePoolClass =
  typeof PROJECTILE_POOL_CLASS_ORDER[number];

export interface CanonicalRunFirstContinuationRoomPlanCatalogPattern {
  readonly id: string;
  readonly durationMs: number;
  readonly seedBase: number;
  readonly emitterCount: number;
  readonly projectileArchetypeId: string;
  readonly requiresSplitChildren: boolean;
}

export interface CanonicalRunFirstContinuationRoomPlanCatalogCandidate {
  readonly pattern: CanonicalRunFirstContinuationRoomPlanCatalogPattern;
  readonly baseWeight: number;
  readonly structuralSignatureSha256: string;
}

export interface CanonicalRunFirstContinuationRoomPlanCatalogTier {
  readonly id: CanonicalRunFirstContinuationRoomPlanCatalogTierId;
  readonly difficulty: CanonicalRunFirstContinuationRoomPlanCatalogDifficulty;
  readonly maxProjectiles: number;
  readonly maxEmitters: number;
  readonly restMs: number;
}

export interface CanonicalRunFirstContinuationRoomPlanCatalogComposer {
  readonly roomId: CanonicalRunFirstContinuationRoomPlanCatalogRoomId;
  readonly candidates: readonly CanonicalRunFirstContinuationRoomPlanCatalogCandidate[];
  readonly tiers: readonly CanonicalRunFirstContinuationRoomPlanCatalogTier[];
}

export interface CanonicalRunFirstContinuationRoomPlanCatalogPoolBudgets {
  readonly micro: number;
  readonly medium: number;
  readonly heavy: number;
  readonly splitChildren: number;
}

type UnknownRecord = Record<string, unknown>;

interface ParsedPattern extends CanonicalRunFirstContinuationRoomPlanCatalogPattern {
  readonly category: string;
  readonly roomId: string;
}

interface CatalogRecord {
  readonly composers: ReadonlyMap<
    CanonicalRunFirstContinuationRoomPlanCatalogRoomId,
    CanonicalRunFirstContinuationRoomPlanCatalogComposer
  >;
  readonly previousStructuralSignatureSha256: string;
  readonly poolBudgets: CanonicalRunFirstContinuationRoomPlanCatalogPoolBudgets;
  readonly residueVisualOnlyBudget: number;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`first continuation room plan catalog ${message}`);
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function plainDataRecord(value: unknown, path: string): UnknownRecord {
  invariant(typeof value === "object" && value !== null && !Array.isArray(value), `${path} must be a plain object`);
  const prototype = Object.getPrototypeOf(value);
  invariant(prototype === Object.prototype || prototype === null, `${path} must be a plain object`);
  invariant(Object.getOwnPropertySymbols(value).length === 0, `${path} must not contain symbol keys`);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    invariant("value" in descriptor && descriptor.enumerable === true, `${path}.${key} must be an enumerable data field`);
  }
  return value as UnknownRecord;
}

function exactKeys(value: unknown, expected: readonly string[], path: string): UnknownRecord {
  const record = plainDataRecord(value, path);
  const actual = Object.keys(record).sort(compareCodePoints);
  const sortedExpected = [...expected].sort(compareCodePoints);
  invariant(
    actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]),
    `${path} must contain only its exact schema fields`,
  );
  return record;
}

function list(value: unknown, path: string): readonly unknown[] {
  invariant(Array.isArray(value), `${path} must be an array`);
  return value;
}

function text(value: unknown, path: string): string {
  invariant(typeof value === "string" && value.length > 0, `${path} must be a non-empty string`);
  return value;
}

function finite(value: unknown, path: string): number {
  invariant(
    typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0),
    `${path} must be finite and not negative zero`,
  );
  return value as number;
}

function safeNonNegativeInteger(value: unknown, path: string): number {
  const parsed = finite(value, path);
  invariant(Number.isSafeInteger(parsed) && parsed >= 0, `${path} must be a non-negative safe integer`);
  return parsed;
}

function safePositiveInteger(value: unknown, path: string): number {
  const parsed = safeNonNegativeInteger(value, path);
  invariant(parsed > 0, `${path} must be positive`);
  return parsed;
}

function uint32(value: unknown, path: string): number {
  const parsed = safeNonNegativeInteger(value, path);
  invariant(parsed <= 0xffff_ffff, `${path} must be uint32`);
  return parsed;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function sha256(value: unknown, path: string): string {
  const parsed = text(value, path);
  invariant(/^[0-9a-f]{64}$/.test(parsed), `${path} must be a lowercase SHA-256`);
  return parsed;
}

function parseCatalog(): CatalogRecord {
  const encounter = exactKeys(encounterDirectorJson, [
    "$schema",
    "coordinateSystem",
    "failurePolicy",
    "id",
    "parallelEncounterPools",
    "scheduling",
    "schemaVersion",
    "segments",
    "weatherDecoupling",
  ], "encounter director manifest");
  invariant(
    encounter.schemaVersion === "4.0.0" && encounter.id === "director.encounter.v4",
    "encounter director identity drifted",
  );
  const segments = list(encounter.segments, "encounter director segments");
  const expectedSegments = Object.freeze([
    ["telegraph", 520, 900],
    ["entry", 800, 1600],
    ["read", 7000, 14000],
    ["material_settle", 900, 1800],
    ["rest", 820, 1800],
  ] as const);
  invariant(segments.length === expectedSegments.length, "encounter segment cardinality drifted");
  segments.forEach((rawSegment, index) => {
    const expected = expectedSegments[index];
    invariant(expected !== undefined, `encounter segment ${index} has no contract`);
    const segment = plainDataRecord(rawSegment, `encounter director segments[${index}]`);
    const duration = list(segment.durationMs, `encounter director segments[${index}].durationMs`)
      .map((entry, durationIndex) => safePositiveInteger(
        entry,
        `encounter director segments[${index}].durationMs[${durationIndex}]`,
      ));
    invariant(
      segment.id === expected[0]
        && duration.length === 2
        && duration[0] === expected[1]
        && duration[1] === expected[2],
      `encounter segment ${index} drifted`,
    );
  });
  const scheduling = plainDataRecord(encounter.scheduling, "encounter director scheduling");
  const maxProjectileBudget = exactKeys(
    scheduling.maxProjectileBudget,
    [...DIFFICULTY_ORDER],
    "encounter director scheduling.maxProjectileBudget",
  );
  invariant(
    scheduling.safeGapHandoffMs === 520
      && maxProjectileBudget.EASY === 120
      && maxProjectileBudget.NORMAL === 200
      && maxProjectileBudget.HARD === 280,
    "encounter scheduling budget/safe-gap drifted",
  );
  const parallelPools = plainDataRecord(encounter.parallelEncounterPools, "encounter director parallel pools");
  const weatherEcho = plainDataRecord(parallelPools.weatherEcho, "encounter director weatherEcho pool");
  invariant(weatherEcho.maximumConcurrent === 1, "encounter parallel policy drifted");

  const lifecycle = exactKeys(projectileLifecycleJson, [
    "$schema",
    "authority",
    "cancelConsequences",
    "collision",
    "grazeEvidence",
    "id",
    "invariants",
    "poolBudgets",
    "schemaVersion",
    "states",
  ], "projectile lifecycle manifest");
  invariant(
    lifecycle.schemaVersion === "4.0.0"
      && lifecycle.id === "projectile.lifecycle.v4"
      && lifecycle.authority === "entity-owned gameplay state; never animation duration or sprite alpha",
    "projectile lifecycle identity drifted",
  );
  const rawPoolBudgets = exactKeys(lifecycle.poolBudgets, [
    ...PROJECTILE_POOL_CLASS_ORDER,
    "residueVisualOnly",
    "overflowPolicy",
  ], "projectile lifecycle poolBudgets");
  invariant(
    rawPoolBudgets.overflowPolicy === "reject_new_spawn_and_log; never recycle a live collider",
    "projectile overflow policy drifted",
  );
  const poolBudgetEntries = PROJECTILE_POOL_CLASS_ORDER.map((poolClass) => [
    poolClass,
    safePositiveInteger(rawPoolBudgets[poolClass], `projectile lifecycle poolBudgets.${poolClass}`),
  ] as const);
  const poolBudgets = Object.freeze(Object.fromEntries(poolBudgetEntries)) as unknown as
    CanonicalRunFirstContinuationRoomPlanCatalogPoolBudgets;
  const residueVisualOnlyBudget = safePositiveInteger(
    rawPoolBudgets.residueVisualOnly,
    "projectile lifecycle poolBudgets.residueVisualOnly",
  );

  const patternsManifest = exactKeys(executablePatternsJson, [
    "$schema",
    "coordinateSystem",
    "counts",
    "patterns",
    "runtimeContract",
    "schemaVersion",
  ], "executable patterns manifest");
  invariant(patternsManifest.schemaVersion === "4.0.0", "executable pattern schema drifted");
  const patternById = new Map<string, ParsedPattern>();
  for (const [index, rawPattern] of list(patternsManifest.patterns, "executable patterns").entries()) {
    const pattern = plainDataRecord(rawPattern, `executable patterns[${index}]`);
    const id = text(pattern.id, `executable patterns[${index}].id`);
    invariant(!patternById.has(id), `executable pattern ${id} is duplicated`);
    const category = text(pattern.category, `executable pattern ${id}.category`);
    const roomId = text(pattern.room, `executable pattern ${id}.room`);
    const durationMs = safePositiveInteger(pattern.durationMs, `executable pattern ${id}.durationMs`);
    const seed = plainDataRecord(pattern.seed, `executable pattern ${id}.seed`);
    const seedBase = uint32(seed.base, `executable pattern ${id}.seed.base`);
    invariant(
      seed.algorithm === "mulberry32-v1"
        && seed.composition === "runSeed xor base xor encounterOrdinal xor difficultySalt",
      `executable pattern ${id} seed contract drifted`,
    );
    const emitters = list(pattern.emitters, `executable pattern ${id}.emitters`);
    let requiresSplitChildren = false;
    const archetypes = emitters.map((rawEmitter, emitterIndex) => {
      const emitter = plainDataRecord(rawEmitter, `executable pattern ${id}.emitters[${emitterIndex}]`);
      const motionStack = list(
        emitter.motionStack,
        `executable pattern ${id}.emitters[${emitterIndex}].motionStack`,
      );
      motionStack.forEach((rawMotion, motionIndex) => {
        const motion = plainDataRecord(
          rawMotion,
          `executable pattern ${id}.emitters[${emitterIndex}].motionStack[${motionIndex}]`,
        );
        const operator = text(
          motion.operator,
          `executable pattern ${id}.emitters[${emitterIndex}].motionStack[${motionIndex}].operator`,
        );
        if (operator === "op.split_generation") requiresSplitChildren = true;
      });
      const projectile = plainDataRecord(
        emitter.projectile,
        `executable pattern ${id}.emitters[${emitterIndex}].projectile`,
      );
      return text(projectile.archetype, `executable pattern ${id}.emitters[${emitterIndex}].projectile.archetype`);
    });
    if (id.startsWith("room.") || category === "ROOM") {
      invariant(
        id.startsWith("room.")
          && category === "ROOM"
          && (COMPOSER_ORDER as readonly string[]).includes(roomId),
        `ROOM pattern ${id} category/room identity drifted`,
      );
      invariant(emitters.length > 0, `ROOM pattern ${id} has no emitter`);
      invariant(new Set(archetypes).size === 1, `ROOM pattern ${id} no longer has one projectile archetype`);
    }
    patternById.set(id, Object.freeze({
      id,
      category,
      roomId,
      durationMs,
      seedBase,
      emitterCount: emitters.length,
      projectileArchetypeId: archetypes[0] ?? "",
      requiresSplitChildren,
    }));
  }

  const signatureReport = exactKeys(patternSignaturesJson, [
    "duplicateGroups",
    "normalizationExcludes",
    "patterns",
    "schemaVersion",
    "uniqueSignatureCount",
  ], "pattern signature report");
  invariant(signatureReport.schemaVersion === "4.0.0", "pattern signature report schema drifted");
  const signatureEntries = list(signatureReport.patterns, "pattern signature report.patterns");
  invariant(
    safePositiveInteger(signatureReport.uniqueSignatureCount, "pattern signature report.uniqueSignatureCount")
      === signatureEntries.length,
    "pattern signature uniqueness count drifted",
  );
  invariant(
    list(signatureReport.duplicateGroups, "pattern signature report.duplicateGroups").length === 0,
    "pattern signature report duplicate groups drifted",
  );
  const signatureByPatternId = new Map<string, string>();
  signatureEntries.forEach((rawEntry, index) => {
    const entry = exactKeys(rawEntry, [
      "normalized",
      "patternId",
      "sha256",
    ], `pattern signature report.patterns[${index}]`);
    const patternId = text(entry.patternId, `pattern signature report.patterns[${index}].patternId`);
    invariant(patternById.has(patternId), `pattern signature report has unknown ${patternId}`);
    invariant(!signatureByPatternId.has(patternId), `pattern signature report duplicates ${patternId}`);
    const normalized = plainDataRecord(entry.normalized, `pattern signature report.patterns[${index}].normalized`);
    const pattern = patternById.get(patternId);
    invariant(pattern !== undefined, `pattern signature report lost ${patternId}`);
    invariant(
      safeNonNegativeInteger(normalized.emitterCount, `pattern signature report ${patternId}.emitterCount`)
        === pattern.emitterCount,
      `pattern signature report ${patternId} emitter count drifted`,
    );
    signatureByPatternId.set(patternId, sha256(entry.sha256, `pattern signature report ${patternId}.sha256`));
  });
  invariant(signatureByPatternId.size === patternById.size, "pattern signature report does not cover every pattern");

  const composersManifest = exactKeys(roomComposersJson, [
    "$schema",
    "composers",
    "schemaVersion",
  ], "room composers manifest");
  invariant(composersManifest.schemaVersion === "4.0.0", "room composer schema drifted");
  const rawComposers = list(composersManifest.composers, "room composers manifest.composers");
  invariant(rawComposers.length === COMPOSER_ORDER.length, "room composer cardinality drifted");
  const composers = new Map<
    CanonicalRunFirstContinuationRoomPlanCatalogRoomId,
    CanonicalRunFirstContinuationRoomPlanCatalogComposer
  >();
  rawComposers.forEach((rawComposer, composerIndex) => {
    const composer = plainDataRecord(rawComposer, `room composers[${composerIndex}]`);
    const expectedRoom = COMPOSER_ORDER[composerIndex];
    const expectedId = COMPOSER_ID_ORDER[composerIndex];
    invariant(
      expectedRoom !== undefined
        && expectedId !== undefined
        && composer.room === expectedRoom
        && composer.id === expectedId
        && composer.algorithm === "seeded_weighted_without_replacement_with_behavior_bias",
      `room composer ${composerIndex} identity drifted`,
    );
    const constraints = plainDataRecord(composer.constraints, `room composer ${expectedRoom}.constraints`);
    invariant(
      constraints.samePatternConsecutive === false
        && constraints.sameStructuralSignatureWithin === 3
        && constraints.safeGapMustOverlapPreviousForMs === 520
        && constraints.restWindowCannotBeRemovedByDifficulty === true
        && constraints.scoreReward === null,
      `room composer ${expectedRoom} constraints drifted`,
    );
    const tiers = list(composer.intensityTiers, `room composer ${expectedRoom}.intensityTiers`)
      .map((rawTier, tierIndex): CanonicalRunFirstContinuationRoomPlanCatalogTier => {
        const tier = plainDataRecord(rawTier, `room composer ${expectedRoom}.intensityTiers[${tierIndex}]`);
        const expectedTierId = TIER_ORDER[tierIndex];
        const expectedDifficulty = DIFFICULTY_ORDER[tierIndex];
        invariant(
          expectedTierId !== undefined
            && expectedDifficulty !== undefined
            && tier.id === expectedTierId
            && tier.difficulty === expectedDifficulty,
          `room composer ${expectedRoom} tier ${tierIndex} identity drifted`,
        );
        const budget = exactKeys(tier.budget, [
          "maxEmitters",
          "maxProjectiles",
          "restMs",
        ], `room composer ${expectedRoom}.intensityTiers[${tierIndex}].budget`);
        const expectedMaxProjectiles = [80, 150, 240][tierIndex];
        const expectedMaxEmitters = [2, 3, 4][tierIndex];
        const expectedRestMs = [1600, 1100, 820][tierIndex];
        invariant(
          budget.maxProjectiles === expectedMaxProjectiles
            && budget.maxEmitters === expectedMaxEmitters
            && budget.restMs === expectedRestMs,
          `room composer ${expectedRoom} tier ${tierIndex} budget drifted`,
        );
        invariant(
          safePositiveInteger(budget.maxProjectiles, `room composer ${expectedRoom} maxProjectiles`)
            <= safePositiveInteger(maxProjectileBudget[expectedDifficulty], `encounter max ${expectedDifficulty}`),
          `room composer ${expectedRoom} tier ${expectedTierId} exceeds encounter budget`,
        );
        return Object.freeze({
          id: expectedTierId,
          difficulty: expectedDifficulty,
          maxProjectiles: budget.maxProjectiles as number,
          maxEmitters: budget.maxEmitters as number,
          restMs: budget.restMs as number,
        });
      });
    invariant(tiers.length === TIER_ORDER.length, `room composer ${expectedRoom} tier cardinality drifted`);
    const candidates = list(composer.patternPool, `room composer ${expectedRoom}.patternPool`)
      .map((rawCandidate, candidateIndex): CanonicalRunFirstContinuationRoomPlanCatalogCandidate => {
        const candidate = exactKeys(rawCandidate, [
          "baseWeight",
          "cooldownEncounters",
          "patternId",
        ], `room composer ${expectedRoom}.patternPool[${candidateIndex}]`);
        const patternId = text(candidate.patternId, `room composer ${expectedRoom} patternId`);
        const pattern = patternById.get(patternId);
        invariant(pattern !== undefined, `room composer ${expectedRoom} references unknown ${patternId}`);
        invariant(
          patternId.startsWith("room.")
            && pattern.category === "ROOM"
            && pattern.roomId === expectedRoom,
          `room composer ${expectedRoom} pattern ${patternId} category/room mismatch`,
        );
        invariant(
          pattern.durationMs >= 7000 && pattern.durationMs <= 14000,
          `room composer ${expectedRoom} pattern ${patternId} read duration left V4 range`,
        );
        const baseWeight = finite(candidate.baseWeight, `room composer ${expectedRoom} ${patternId}.baseWeight`);
        invariant(
          baseWeight > 0 && candidate.cooldownEncounters === 2,
          `room composer ${expectedRoom} ${patternId} weight/cooldown drifted`,
        );
        const structuralSignatureSha256 = signatureByPatternId.get(patternId);
        invariant(structuralSignatureSha256 !== undefined, `room composer ${expectedRoom} ${patternId} lost signature`);
        const patternDto = Object.freeze({
          id: pattern.id,
          durationMs: pattern.durationMs,
          seedBase: pattern.seedBase,
          emitterCount: pattern.emitterCount,
          projectileArchetypeId: pattern.projectileArchetypeId,
          requiresSplitChildren: pattern.requiresSplitChildren,
        });
        return Object.freeze({pattern: patternDto, baseWeight, structuralSignatureSha256});
      });
    invariant(candidates.length === 4, `room composer ${expectedRoom} must retain its complete four-pattern pool`);
    if ((TARGET_ROOM_ORDER as readonly string[]).includes(expectedRoom)) {
      composers.set(expectedRoom as CanonicalRunFirstContinuationRoomPlanCatalogRoomId, Object.freeze({
        roomId: expectedRoom as CanonicalRunFirstContinuationRoomPlanCatalogRoomId,
        candidates: Object.freeze(candidates),
        tiers: Object.freeze(tiers),
      }));
    }
  });
  invariant(sameStrings([...composers.keys()], TARGET_ROOM_ORDER), "target composer order drifted");
  const previousStructuralSignatureSha256 = signatureByPatternId.get(PREVIOUS_PATTERN_ID);
  invariant(previousStructuralSignatureSha256 !== undefined, "previous Left/Right signature is missing");
  return Object.freeze({
    composers,
    previousStructuralSignatureSha256,
    poolBudgets,
    residueVisualOnlyBudget,
  });
}

const CATALOG = parseCatalog();

export function canonicalRunFirstContinuationRoomPlanCatalogTargetRoomOrder():
readonly CanonicalRunFirstContinuationRoomPlanCatalogRoomId[] {
  return TARGET_ROOM_ORDER;
}

export function canonicalRunFirstContinuationRoomPlanCatalogProjectilePoolClassOrder():
readonly CanonicalRunFirstContinuationRoomPlanCatalogProjectilePoolClass[] {
  return PROJECTILE_POOL_CLASS_ORDER;
}

export function canonicalRunFirstContinuationRoomPlanCatalogComposer(
  roomId: CanonicalRunFirstContinuationRoomPlanCatalogRoomId,
): CanonicalRunFirstContinuationRoomPlanCatalogComposer {
  const composer = CATALOG.composers.get(roomId);
  invariant(composer !== undefined, `target ${roomId} has no composer`);
  return composer;
}

export function canonicalRunFirstContinuationRoomPlanCatalogPreviousStructuralSignatureSha256(): string {
  return CATALOG.previousStructuralSignatureSha256;
}

export function canonicalRunFirstContinuationRoomPlanCatalogPoolBudgets():
CanonicalRunFirstContinuationRoomPlanCatalogPoolBudgets {
  return CATALOG.poolBudgets;
}

export function canonicalRunFirstContinuationRoomPlanCatalogResidueVisualOnlyBudget(): number {
  return CATALOG.residueVisualOnlyBudget;
}
