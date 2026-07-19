import executablePatternsJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/executable-patterns-v4.json";
import encounterDirectorJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/encounter-director-v4.json";
import roomComposersJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/room-composers-v4.json";
import {
  CanonicalCombatKernel,
  CanonicalRunCombatState,
  crossedTickCount,
  validateAlternatingVerdictPatternContract,
  type CanonicalCombatSnapshot,
  type CanonicalCombatStepInput,
  type CanonicalRunCombatStateSnapshot,
} from "./combat-kernel";
import {
  CanonicalEventBus,
  type CanonicalGameplayEvent,
} from "./events";
import {
  admitLiveRoomCapability,
  type LiveRoomCapabilityAdmittedPlan,
} from "./live-run-admission";
import {
  LOGICAL_VIEW_HEIGHT,
  LOGICAL_VIEW_WIDTH,
} from "./pattern-executor";
import {
  PLAYER_NORMAL_COLLISION_RADIUS_PX,
  type ProjectilePoolClass,
  type Vec2,
} from "./projectiles";

/**
 * Hash of the one caller-resolved POLARIZED/listen fixture admitted below.
 * It includes the raw seed and exact fourteen-metric ledger snapshot; it is
 * neither a pattern hash nor a room default.
 */
export const ALTERNATING_VERDICT_READ_FIXTURE_SHA256 =
  "36da160cd1a63e96a71c6c5978c1d3b73398e177c8b447ef08274c6215824131" as const;

const EXPECTED_ROOM_ID = "POLARIZED" as const;
const EXPECTED_ROOM_ORDINAL = 0 as const;
const EXPECTED_TIER_ID = "listen" as const;
const EXPECTED_DIFFICULTY = "EASY" as const;
const EXPECTED_PATTERN_ID = "room.polarized.alternating_verdict" as const;
const EXPECTED_OCCURRENCE_ID =
  "room:0:encounter:0:room.polarized.alternating_verdict" as const;
const EXPECTED_ENCOUNTER_ORDINAL = 0 as const;
const EXPECTED_RAW_RUN_SEED = 0x1234_5678;
const EXPECTED_METRIC_CAPTURE_TICK120 = 960;
const EXPECTED_DIFFICULTY_SALT = 0x2200;
const EXPECTED_RESOLVED_SEED = 0xe9f3_33c4;
const EXPECTED_SELECTION_SEED = 0x1234_ba38;
const EXPECTED_METRIC_COUNT = 14;
const RESIDUE_LIFETIME_MS = 2422;

const SERIAL_SEGMENTS_MS = Object.freeze({
  telegraph: 520,
  entry: 800,
  read: 11_600,
  materialSettle: 900,
  rest: 1600,
  safeGapHandoff: 520,
});

const BUDGET_EVIDENCE = Object.freeze({
  interpretation: "observational-only-no-enforcement" as const,
  countingPolicy: "post-flush-authority-snapshots" as const,
  observationProfile: "stationary-center-unfocused-graze10-damage1" as const,
  peakDigitalBodies: 52,
  peakLiveColliders: 52,
  peakAllAuthorityEntitiesIncludingResidue: 83,
  peakResidueVisuals: 83,
  allocatedMicroHighWater: 83,
  cumulativeSpawnCommits: 150,
  authoredRngCallsConsumed: 162,
  preflightOmissions: 12,
  authoredEmitters: 2,
  listenTierMaxProjectiles: 80,
  listenTierMaxEmitters: 2,
  encounterEasyMaxProjectileBudget: 120,
  unresolved:
    "v4-does-not-author-concurrent-vs-residue-vs-cumulative-projectile-budget-counting" as const,
});

function assertFixedFixtureSource(): void {
  const patterns = executablePatternsJson.patterns.filter((entry) =>
    entry.id === EXPECTED_PATTERN_ID);
  if (patterns.length !== 1 || patterns[0] === undefined) {
    throw new Error("Alternating Verdict fixture must resolve one immutable V4 pattern");
  }
  validateAlternatingVerdictPatternContract(patterns[0]);

  const composers = roomComposersJson.composers.filter((entry) =>
    entry.id === "composer.polarized");
  if (composers.length !== 1 || composers[0] === undefined) {
    throw new Error("Alternating Verdict fixture must resolve one immutable V4 room composer");
  }
  const composer = composers[0];
  const poolEntries = composer.patternPool.filter((entry) =>
    entry.patternId === EXPECTED_PATTERN_ID);
  const listenTiers = composer.intensityTiers.filter((entry) => entry.id === EXPECTED_TIER_ID);
  const poolEntry = poolEntries[0];
  const listen = listenTiers[0];
  if (
    composer.room !== EXPECTED_ROOM_ID
    || poolEntries.length !== 1
    || poolEntry === undefined
    || poolEntry.baseWeight !== 1.16
    || poolEntry.cooldownEncounters !== 2
    || listenTiers.length !== 1
    || listen === undefined
    || listen.difficulty !== EXPECTED_DIFFICULTY
    || listen.budget.maxProjectiles !== BUDGET_EVIDENCE.listenTierMaxProjectiles
    || listen.budget.maxEmitters !== BUDGET_EVIDENCE.listenTierMaxEmitters
    || listen.budget.restMs !== SERIAL_SEGMENTS_MS.rest
    || composer.constraints.safeGapMustOverlapPreviousForMs !== SERIAL_SEGMENTS_MS.safeGapHandoff
    || composer.constraints.restWindowCannotBeRemovedByDifficulty !== true
    || composer.constraints.scoreReward !== null
    || encounterDirectorJson.scheduling.maxProjectileBudget.EASY
      !== BUDGET_EVIDENCE.encounterEasyMaxProjectileBudget
    || encounterDirectorJson.scheduling.safeGapHandoffMs !== SERIAL_SEGMENTS_MS.safeGapHandoff
  ) {
    throw new Error("Alternating Verdict fixed tier, director, or pattern-pool source drifted");
  }
}

assertFixedFixtureSource();

export const ALTERNATING_VERDICT_READ_CONTRACT = Object.freeze({
  schemaVersion: "1.0.0-canonical-alternating-verdict-read-fragment" as const,
  authority: "caller-resolved-singleton-alternating-verdict-read" as const,
  fixtureGameplaySha256: ALTERNATING_VERDICT_READ_FIXTURE_SHA256,
  roomId: EXPECTED_ROOM_ID,
  roomOrdinal: EXPECTED_ROOM_ORDINAL,
  tierId: EXPECTED_TIER_ID,
  difficulty: EXPECTED_DIFFICULTY,
  patternId: EXPECTED_PATTERN_ID,
  metricCount: EXPECTED_METRIC_COUNT,
  composer: false as const,
  scheduler: false as const,
  selectionAuthority: "caller-resolved" as const,
  selectionRngConsumed: false as const,
  parallel: false as const,
  canonicalEventBus: true as const,
  canonicalSegmentEvents: false as const,
  runHandoff: false as const,
  roomComplete: false as const,
  handoffReady: false as const,
  roomTransition: "absent-not-invoked" as const,
  telegraphAuthority: "outside-fragment-unexecuted" as const,
  entryAuthority: "outside-fragment-unexecuted" as const,
  incomingSafeGap: "not-claimed" as const,
  segmentProjection: "snapshot-phase-only-cumulative-first-non-early-tick120" as const,
  patternLocalTickZero: "caller-established-read-entry" as const,
  metricCausality:
    "read-entry-at-or-after-metric-capture-plus-unexecuted-pre-read-duration" as const,
  terminalBoundary: "eventless-neutral-close-from-quiescent-state" as const,
  nestedCombatReadiness: "occurrence-lifecycle-only-not-room-or-run-handoff" as const,
  safeGapHandoffSerialDuration: false as const,
  safeGapHandoffSpatialProof: false as const,
  sourceWithdrawnInNeutralTrace: false as const,
  weatherAuthority: false as const,
  presentationAffectsGameplay: false as const,
  budgetEnforced: false as const,
  serialSegmentsMs: SERIAL_SEGMENTS_MS,
  budgetEvidence: BUDGET_EVIDENCE,
});

export interface CanonicalAlternatingVerdictReadOptions {
  readonly expectedGameplaySha256: string;
  readonly startTick120: number;
  readonly initialPlayerPosition: Vec2;
  readonly grazeRadiusPx: number;
  readonly projectileDamage: number;
  readonly projectilePoolClasses: Readonly<Record<string, ProjectilePoolClass>>;
  readonly incomingReadBoundary: "caller-established-after-unexecuted-telegraph-and-entry";
  readonly incomingSafeGap: "not-claimed";
}

export type CanonicalAlternatingVerdictReadPhase =
  | "read"
  | "material_settle"
  | "rest"
  | "slice_complete";

export interface CanonicalAlternatingVerdictReadBoundaryTicks {
  readonly start: number;
  readonly read: number;
  readonly materialSettle: number;
  readonly rest: number;
  readonly residueDeadline: number;
  readonly fixedSliceComplete: number;
}

export type CanonicalAlternatingVerdictOccurrenceSnapshot = Readonly<
  Omit<CanonicalCombatSnapshot, "handoffReady">
  & {readonly occurrenceLifecycleReady: boolean}
>;

export interface CanonicalAlternatingVerdictReadSnapshot {
  readonly authority: "canonical-alternating-verdict-read-fragment-v4";
  readonly admissionGameplaySha256: typeof ALTERNATING_VERDICT_READ_FIXTURE_SHA256;
  readonly metricCapturedAtTick120: typeof EXPECTED_METRIC_CAPTURE_TICK120;
  readonly tick120: number;
  readonly relativeTick120: number;
  readonly phase: CanonicalAlternatingVerdictReadPhase;
  readonly boundaryTicks120: Readonly<CanonicalAlternatingVerdictReadBoundaryTicks>;
  readonly roomId: typeof EXPECTED_ROOM_ID;
  readonly roomOrdinal: typeof EXPECTED_ROOM_ORDINAL;
  readonly patternId: typeof EXPECTED_PATTERN_ID;
  readonly occurrenceId: typeof EXPECTED_OCCURRENCE_ID;
  readonly encounterOrdinal: typeof EXPECTED_ENCOUNTER_ORDINAL;
  readonly tierId: typeof EXPECTED_TIER_ID;
  readonly difficulty: typeof EXPECTED_DIFFICULTY;
  readonly safeGapHandoffMs: typeof SERIAL_SEGMENTS_MS.safeGapHandoff;
  readonly composer: false;
  readonly scheduler: false;
  readonly selectionAuthority: "caller-resolved";
  readonly selectionRngConsumed: false;
  readonly parallel: false;
  readonly canonicalEventBus: true;
  readonly runHandoff: false;
  readonly fixedSliceComplete: boolean;
  readonly roomComplete: false;
  readonly timedStateQuiescent: boolean;
  readonly handoffReady: false;
  readonly faulted: boolean;
  readonly runCombat: CanonicalRunCombatStateSnapshot;
  readonly combat: CanonicalAlternatingVerdictOccurrenceSnapshot;
  readonly adapterPolicy: Readonly<{
    readonly readBoundary: "caller-established-after-unexecuted-telegraph-and-entry";
    readonly incomingSafeGap: "not-claimed";
    readonly preReadAuthority: "telegraph-and-entry-outside-fragment-unexecuted";
    readonly segmentProjection: "snapshot-phase-only-cumulative-first-non-early-tick120";
    readonly patternLocalTickZero: "caller-established-read-entry";
    readonly metricCausality:
      "read-entry-at-or-after-metric-capture-plus-unexecuted-pre-read-duration";
    readonly terminalBoundary: "eventless-neutral-close-from-quiescent-state";
    readonly nestedCombatReadiness: "occurrence-lifecycle-only-not-room-or-run-handoff";
    readonly safeGapHandoff: "validated-scalar-not-a-serial-window-or-spatial-proof";
    readonly budget: typeof BUDGET_EVIDENCE;
    readonly provenance: "application-required-v4-omission";
  }>;
}

interface CapturedReadOptions extends CanonicalAlternatingVerdictReadOptions {
  readonly initialPlayerPosition: Readonly<Vec2>;
  readonly projectilePoolClasses: Readonly<Record<string, ProjectilePoolClass>>;
}

interface PreflightResult {
  readonly options: CapturedReadOptions;
  readonly plan: LiveRoomCapabilityAdmittedPlan;
  readonly boundaries: Readonly<CanonicalAlternatingVerdictReadBoundaryTicks>;
}

interface AlternatingVerdictReadInternals {
  readonly options: CapturedReadOptions;
  readonly plan: LiveRoomCapabilityAdmittedPlan;
  readonly boundaries: Readonly<CanonicalAlternatingVerdictReadBoundaryTicks>;
  readonly runState: CanonicalRunCombatState;
  readonly kernel: CanonicalCombatKernel;
  tick120: number;
  fixedSliceComplete: boolean;
  fault: Error | null;
  advancing: boolean;
}

const READ_INTERNALS = new WeakMap<
  CanonicalAlternatingVerdictReadFragment,
  AlternatingVerdictReadInternals
>();

const ADAPTER_POLICY = Object.freeze({
  readBoundary: "caller-established-after-unexecuted-telegraph-and-entry" as const,
  incomingSafeGap: "not-claimed" as const,
  preReadAuthority: "telegraph-and-entry-outside-fragment-unexecuted" as const,
  segmentProjection: "snapshot-phase-only-cumulative-first-non-early-tick120" as const,
  patternLocalTickZero: "caller-established-read-entry" as const,
  metricCausality:
    "read-entry-at-or-after-metric-capture-plus-unexecuted-pre-read-duration" as const,
  terminalBoundary: "eventless-neutral-close-from-quiescent-state" as const,
  nestedCombatReadiness: "occurrence-lifecycle-only-not-room-or-run-handoff" as const,
  safeGapHandoff: "validated-scalar-not-a-serial-window-or-spatial-proof" as const,
  budget: BUDGET_EVIDENCE,
  provenance: "application-required-v4-omission" as const,
});

function ownDataRecord(
  value: unknown,
  path: string,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be a plain object`);
  }
  let prototype: object | null;
  let keys: readonly PropertyKey[];
  try {
    prototype = Reflect.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    throw new Error(`${path} must be inspectable without traps`);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${path} must have Object.prototype or null prototype`);
  }
  for (const key of keys) {
    if (typeof key !== "string") throw new Error(`${path} must not contain symbol keys`);
    if (!expectedKeys.includes(key)) throw new Error(`${path}.${key} is not an owned field`);
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of expectedKeys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    } catch {
      throw new Error(`${path}.${key} must be inspectable without traps`);
    }
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new Error(`${path}.${key} must be an own data property`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be finite`);
  }
  return value;
}

function safeNonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || Object.is(value, -0)) {
    throw new Error(`${path} must be a non-negative safe integer without negative zero`);
  }
  return value as number;
}

function captureReadOptions(value: unknown): CapturedReadOptions {
  const record = ownDataRecord(value, "Alternating Verdict read options", [
    "expectedGameplaySha256",
    "startTick120",
    "initialPlayerPosition",
    "grazeRadiusPx",
    "projectileDamage",
    "projectilePoolClasses",
    "incomingReadBoundary",
    "incomingSafeGap",
  ]);
  if (
    typeof record.expectedGameplaySha256 !== "string"
    || !/^[0-9a-f]{64}$/.test(record.expectedGameplaySha256)
  ) {
    throw new Error("Alternating Verdict expectedGameplaySha256 must be a lowercase SHA-256");
  }
  const startTick120 = safeNonNegativeInteger(
    record.startTick120,
    "Alternating Verdict startTick120",
  );
  const positionRecord = ownDataRecord(
    record.initialPlayerPosition,
    "Alternating Verdict initialPlayerPosition",
    ["x", "y"],
  );
  const x = finiteNumber(positionRecord.x, "Alternating Verdict initialPlayerPosition.x");
  const y = finiteNumber(positionRecord.y, "Alternating Verdict initialPlayerPosition.y");
  if (x < 0 || x > LOGICAL_VIEW_WIDTH || y < 0 || y > LOGICAL_VIEW_HEIGHT) {
    throw new Error("Alternating Verdict initialPlayerPosition must remain in the logical viewport");
  }
  const grazeRadiusPx = finiteNumber(record.grazeRadiusPx, "Alternating Verdict grazeRadiusPx");
  if (grazeRadiusPx <= PLAYER_NORMAL_COLLISION_RADIUS_PX) {
    throw new Error("Alternating Verdict grazeRadiusPx must exceed the normal collision radius");
  }
  if (
    !Number.isSafeInteger(record.projectileDamage)
    || (record.projectileDamage as number) <= 0
    || Object.is(record.projectileDamage, -0)
  ) {
    throw new Error("Alternating Verdict projectileDamage must be a positive safe integer");
  }
  const poolRecord = ownDataRecord(
    record.projectilePoolClasses,
    "Alternating Verdict projectilePoolClasses",
    ["bullet.micro.notch_e"],
  );
  if (poolRecord["bullet.micro.notch_e"] !== "micro") {
    throw new Error("Alternating Verdict requires the exact notch_e to micro pool mapping");
  }
  if (record.incomingReadBoundary !== "caller-established-after-unexecuted-telegraph-and-entry") {
    throw new Error("Alternating Verdict requires an explicit caller-established READ boundary");
  }
  if (record.incomingSafeGap !== "not-claimed") {
    throw new Error("Alternating Verdict cannot claim an unresolved incoming safe gap");
  }
  return Object.freeze({
    expectedGameplaySha256: record.expectedGameplaySha256,
    startTick120,
    initialPlayerPosition: Object.freeze({x, y}),
    grazeRadiusPx,
    projectileDamage: record.projectileDamage as number,
    projectilePoolClasses: Object.freeze({"bullet.micro.notch_e": "micro" as const}),
    incomingReadBoundary: "caller-established-after-unexecuted-telegraph-and-entry" as const,
    incomingSafeGap: "not-claimed" as const,
  });
}

function safeBoundary(startTick120: number, relativeTick120: number, path: string): number {
  const boundary = startTick120 + relativeTick120;
  if (!Number.isSafeInteger(boundary) || boundary < startTick120) {
    throw new Error(`${path} exceeds the safe tick120 range`);
  }
  return boundary;
}

function boundariesFor(
  startTick120: number,
  segments: LiveRoomCapabilityAdmittedPlan["room"]["encounters"][number]["segments"],
): Readonly<CanonicalAlternatingVerdictReadBoundaryTicks> {
  const readEndMs = segments.readMs;
  const settleEndMs = readEndMs + segments.materialSettleMs;
  const restEndMs = settleEndMs + segments.restMs;
  for (const [path, value] of [
    ["read cumulative duration", readEndMs],
    ["material-settle cumulative duration", settleEndMs],
    ["rest cumulative duration", restEndMs],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${path} exceeds the safe millisecond range`);
    }
  }
  const materialSettleRelative = crossedTickCount(readEndMs);
  const restRelative = crossedTickCount(settleEndMs);
  const residueRelative = crossedTickCount(segments.readMs)
    + crossedTickCount(RESIDUE_LIFETIME_MS);
  const completeRelative = crossedTickCount(restEndMs);
  if (
    !(materialSettleRelative <= restRelative
      && restRelative <= residueRelative
      && residueRelative <= completeRelative)
  ) {
    throw new Error("Alternating Verdict read boundaries must be monotonic");
  }
  return Object.freeze({
    start: startTick120,
    read: startTick120,
    materialSettle: safeBoundary(
      startTick120,
      materialSettleRelative,
      "Alternating Verdict material-settle boundary",
    ),
    rest: safeBoundary(startTick120, restRelative, "Alternating Verdict rest boundary"),
    residueDeadline: safeBoundary(
      startTick120,
      residueRelative,
      "Alternating Verdict residue deadline",
    ),
    fixedSliceComplete: safeBoundary(
      startTick120,
      completeRelative,
      "Alternating Verdict fixed slice completion boundary",
    ),
  });
}

function preflight(candidate: unknown, optionsValue: unknown): PreflightResult {
  const options = captureReadOptions(optionsValue);
  const admission = admitLiveRoomCapability(candidate);
  if (admission.status !== "admitted") {
    const detail = admission.rejections
      .map((entry) => `${entry.path}:${entry.code}`)
      .join(",");
    throw new Error(
      `Alternating Verdict read admission rejected${detail.length > 0 ? `: ${detail}` : ""}`,
    );
  }
  if (admission.gameplaySha256 !== options.expectedGameplaySha256) {
    throw new Error("Alternating Verdict gameplay SHA-256 does not match the caller expectation");
  }
  const plan = admission.plan;
  const room = plan.room;
  if (
    plan.rawRunSeed.domain !== "raw-run-seed"
    || plan.rawRunSeed.value !== EXPECTED_RAW_RUN_SEED
    || plan.metricSnapshot.capturedAtTick120 !== EXPECTED_METRIC_CAPTURE_TICK120
    || Object.keys(plan.metricSnapshot.metrics).length !== EXPECTED_METRIC_COUNT
    || room.roomId !== EXPECTED_ROOM_ID
    || room.roomOrdinal !== EXPECTED_ROOM_ORDINAL
    || room.tierId !== EXPECTED_TIER_ID
    || room.difficulty !== EXPECTED_DIFFICULTY
    || room.encounters.length !== 1
  ) {
    throw new Error("Alternating Verdict candidate is outside the fixed singleton room scope");
  }
  const encounter = room.encounters[0];
  if (encounter === undefined) {
    throw new Error("Alternating Verdict candidate lost its singleton encounter");
  }
  if (encounter.parallel.mode !== "none") {
    throw new Error("Alternating Verdict read has no supported parallel budget envelope");
  }
  if (
    encounter.parallel.selectionSeed.domain !== "parallel-selection-seed"
    || encounter.parallel.selectionSeed.value !== EXPECTED_SELECTION_SEED
  ) {
    throw new Error("Alternating Verdict parallel-none selection seed drifted");
  }
  if (encounter.patternId !== EXPECTED_PATTERN_ID) {
    throw new Error(
      `Alternating Verdict read has no qualified fixed-slice evidence for ${encounter.patternId}`,
    );
  }
  if (
    encounter.occurrenceId !== EXPECTED_OCCURRENCE_ID
    || encounter.encounterOrdinal !== EXPECTED_ENCOUNTER_ORDINAL
    || encounter.difficulty !== EXPECTED_DIFFICULTY
    || encounter.difficultySalt !== EXPECTED_DIFFICULTY_SALT
    || encounter.resolvedSeed.domain !== "resolved-occurrence-seed"
    || encounter.resolvedSeed.value !== EXPECTED_RESOLVED_SEED
  ) {
    throw new Error("Alternating Verdict occurrence identity or resolved seed drifted");
  }
  const segments = encounter.segments;
  if (
    segments.telegraphMs !== SERIAL_SEGMENTS_MS.telegraph
    || segments.entryMs !== SERIAL_SEGMENTS_MS.entry
    || segments.readMs !== SERIAL_SEGMENTS_MS.read
    || segments.materialSettleMs !== SERIAL_SEGMENTS_MS.materialSettle
    || segments.restMs !== SERIAL_SEGMENTS_MS.rest
    || segments.safeGapHandoffMs !== SERIAL_SEGMENTS_MS.safeGapHandoff
  ) {
    throw new Error("Alternating Verdict fixed segment fixture drifted");
  }
  const boundaries = boundariesFor(options.startTick120, segments);
  const earliestReadTick120 = safeBoundary(
    plan.metricSnapshot.capturedAtTick120,
    crossedTickCount(segments.telegraphMs + segments.entryMs),
    "Alternating Verdict earliest causal READ boundary",
  );
  if (options.startTick120 < earliestReadTick120) {
    throw new Error(
      "Alternating Verdict READ boundary cannot precede metric capture plus telegraph/entry time",
    );
  }
  if (admission.gameplaySha256 !== ALTERNATING_VERDICT_READ_FIXTURE_SHA256) {
    throw new Error("Alternating Verdict candidate is not the qualified fixed fixture");
  }
  if (
    boundaries.read - options.startTick120 !== 0
    || boundaries.materialSettle - options.startTick120 !== 1392
    || boundaries.rest - options.startTick120 !== 1500
    || boundaries.residueDeadline - options.startTick120 !== 1683
    || boundaries.fixedSliceComplete - options.startTick120 !== 1692
  ) {
    throw new Error("Alternating Verdict cumulative tick projection drifted");
  }
  return Object.freeze({options, plan, boundaries});
}

function internalsFor(
  fragment: CanonicalAlternatingVerdictReadFragment,
): AlternatingVerdictReadInternals {
  const internals = READ_INTERNALS.get(fragment);
  if (internals === undefined) throw new Error("unrecognized Alternating Verdict read fragment");
  return internals;
}

function phaseAt(
  tick120: number,
  boundaries: CanonicalAlternatingVerdictReadBoundaryTicks,
): CanonicalAlternatingVerdictReadPhase {
  if (tick120 >= boundaries.fixedSliceComplete) return "slice_complete";
  if (tick120 >= boundaries.rest) return "rest";
  if (tick120 >= boundaries.materialSettle) return "material_settle";
  return "read";
}

function runSnapshot(
  internals: AlternatingVerdictReadInternals,
): CanonicalRunCombatStateSnapshot {
  return CanonicalRunCombatState.prototype.snapshot.call(internals.runState);
}

function combatSnapshot(
  internals: AlternatingVerdictReadInternals,
): CanonicalAlternatingVerdictOccurrenceSnapshot {
  const snapshot: CanonicalCombatSnapshot = CanonicalCombatKernel.prototype.snapshot.call(
    internals.kernel,
  );
  const {handoffReady: occurrenceLifecycleReady, ...occurrence} = snapshot;
  return Object.freeze({...occurrence, occurrenceLifecycleReady});
}

function timedStateQuiescent(snapshot: CanonicalRunCombatStateSnapshot): boolean {
  return snapshot.player.recoveryAtTick120 === null
    && snapshot.player.respawnPlaceAtTick120 === null
    && snapshot.player.respawnCompleteAtTick120 === null
    && snapshot.override.state === "idle"
    && snapshot.override.deadlineTick120 === null;
}

function snapshotFor(
  internals: AlternatingVerdictReadInternals,
): CanonicalAlternatingVerdictReadSnapshot {
  const runCombat = runSnapshot(internals);
  return Object.freeze({
    authority: "canonical-alternating-verdict-read-fragment-v4" as const,
    admissionGameplaySha256: ALTERNATING_VERDICT_READ_FIXTURE_SHA256,
    metricCapturedAtTick120: EXPECTED_METRIC_CAPTURE_TICK120,
    tick120: internals.tick120,
    relativeTick120: internals.tick120 - internals.options.startTick120,
    phase: phaseAt(internals.tick120, internals.boundaries),
    boundaryTicks120: internals.boundaries,
    roomId: EXPECTED_ROOM_ID,
    roomOrdinal: EXPECTED_ROOM_ORDINAL,
    patternId: EXPECTED_PATTERN_ID,
    occurrenceId: EXPECTED_OCCURRENCE_ID,
    encounterOrdinal: EXPECTED_ENCOUNTER_ORDINAL,
    tierId: EXPECTED_TIER_ID,
    difficulty: EXPECTED_DIFFICULTY,
    safeGapHandoffMs: SERIAL_SEGMENTS_MS.safeGapHandoff,
    composer: false as const,
    scheduler: false as const,
    selectionAuthority: "caller-resolved" as const,
    selectionRngConsumed: false as const,
    parallel: false as const,
    canonicalEventBus: true as const,
    runHandoff: false as const,
    fixedSliceComplete: internals.fixedSliceComplete,
    roomComplete: false as const,
    timedStateQuiescent: timedStateQuiescent(runCombat),
    handoffReady: false as const,
    faulted: internals.fault !== null,
    runCombat,
    combat: combatSnapshot(internals),
    adapterPolicy: ADAPTER_POLICY,
  });
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * Executes the READ and terminal material tail of exactly one admitted
 * Alternating Verdict occurrence. It does not compose, select, schedule,
 * parallelize, transition, complete a room, or authorize a run handoff.
 * Segment changes are snapshot phases because V4 declares no segment events.
 */
export class CanonicalAlternatingVerdictReadFragment {
  constructor(
    candidate: unknown,
    optionsValue: CanonicalAlternatingVerdictReadOptions,
    _projectionContext?: unknown,
  ) {
    // Every hostile field, hash, scope, lifecycle, and overflow check completes
    // before the first event bus exists. Projection remains deliberately opaque.
    const prepared = preflight(candidate, optionsValue);
    const eventBus = new CanonicalEventBus();
    const runState = new CanonicalRunCombatState({
      startTick120: prepared.options.startTick120,
      initialPlayerPosition: prepared.options.initialPlayerPosition,
      grazeRadiusPx: prepared.options.grazeRadiusPx,
      projectileDamage: prepared.options.projectileDamage,
      projectilePoolClasses: prepared.options.projectilePoolClasses,
    }, eventBus);
    const kernel = new CanonicalCombatKernel({
      patternId: EXPECTED_PATTERN_ID,
      occurrenceId: EXPECTED_OCCURRENCE_ID,
      seed: EXPECTED_RESOLVED_SEED,
      startTick120: prepared.options.startTick120,
      roomId: EXPECTED_ROOM_ID,
      difficulty: EXPECTED_DIFFICULTY,
      grazeRadiusPx: prepared.options.grazeRadiusPx,
      projectileDamage: prepared.options.projectileDamage,
      projectilePoolClasses: prepared.options.projectilePoolClasses,
    }, runState);
    READ_INTERNALS.set(this, {
      options: prepared.options,
      plan: prepared.plan,
      boundaries: prepared.boundaries,
      runState,
      kernel,
      tick120: prepared.options.startTick120,
      fixedSliceComplete: false,
      fault: null,
      advancing: false,
    });
    Object.freeze(this);
  }

  snapshot(): CanonicalAlternatingVerdictReadSnapshot {
    return snapshotFor(internalsFor(this));
  }

  admittedPlan(): LiveRoomCapabilityAdmittedPlan {
    return internalsFor(this).plan;
  }

  events(): readonly CanonicalGameplayEvent[] {
    return CanonicalRunCombatState.prototype.events.call(internalsFor(this).runState);
  }

  canonicalEventSerialization(): string {
    return CanonicalRunCombatState.prototype.canonicalEventSerialization.call(
      internalsFor(this).runState,
    );
  }

  /** Close +1692 with one neutral, eventless run-owned tick. */
  closeSlice(): CanonicalAlternatingVerdictReadSnapshot {
    const internals = internalsFor(this);
    if (internals.advancing) {
      const error = new Error("Alternating Verdict read close is already in progress");
      if (internals.fault === null) internals.fault = error;
      throw error;
    }
    if (internals.fault !== null) {
      throw new Error(`Alternating Verdict read is faulted: ${internals.fault.message}`, {
        cause: internals.fault,
      });
    }
    if (internals.fixedSliceComplete) {
      const error = new Error("Alternating Verdict READ slice is already closed");
      internals.fault = error;
      throw error;
    }
    internals.advancing = true;
    try {
      const nextTick120 = internals.tick120 + 1;
      if (nextTick120 !== internals.boundaries.fixedSliceComplete) {
        throw new Error("Alternating Verdict READ slice can close only at its exact fixed boundary");
      }
      const before = runSnapshot(internals);
      if (before.pendingFlushTick120 !== null) {
        throw new Error(`Alternating Verdict inherited unclosed tick ${before.pendingFlushTick120}`);
      }
      if (before.activeOccurrenceId !== null) {
        throw new Error("Alternating Verdict READ slice cannot close while its occurrence is active");
      }
      if (!timedStateQuiescent(before)) {
        throw new Error("Alternating Verdict READ slice cannot strand a run-owned player/Override timer");
      }
      const eventCount = CanonicalRunCombatState.prototype.events.call(internals.runState).length;
      CanonicalRunCombatState.prototype.stepIdle.call(
        internals.runState,
        Object.freeze({
          tick120: nextTick120,
          movement: Object.freeze({x: 0, y: 0}),
          focused: before.focused,
        }),
        EXPECTED_ROOM_ID,
      );
      const after = runSnapshot(internals);
      if (
        after.tick120 !== nextTick120
        || after.pendingFlushTick120 !== null
        || after.activeOccurrenceId !== null
        || !timedStateQuiescent(after)
      ) {
        throw new Error("Alternating Verdict neutral closure did not close exactly once");
      }
      if (CanonicalRunCombatState.prototype.events.call(internals.runState).length !== eventCount) {
        throw new Error("Alternating Verdict neutral closure emitted an unauthorized event");
      }
      internals.tick120 = nextTick120;
      internals.fixedSliceComplete = true;
      return snapshotFor(internals);
    } catch (error) {
      internals.fault = asError(error);
      throw error;
    } finally {
      internals.advancing = false;
    }
  }

  /** Advance exactly one gameplay tick through +1691. */
  step(input: CanonicalCombatStepInput): CanonicalAlternatingVerdictReadSnapshot {
    const internals = internalsFor(this);
    if (internals.advancing) {
      const error = new Error("Alternating Verdict read step is already in progress");
      if (internals.fault === null) internals.fault = error;
      throw error;
    }
    if (internals.fault !== null) {
      throw new Error(`Alternating Verdict read is faulted: ${internals.fault.message}`, {
        cause: internals.fault,
      });
    }
    if (internals.fixedSliceComplete) {
      const error = new Error("Alternating Verdict READ slice is already closed");
      internals.fault = error;
      throw error;
    }
    internals.advancing = true;
    try {
      const nextTick120 = internals.tick120 + 1;
      if (!Number.isSafeInteger(nextTick120)) {
        throw new Error("Alternating Verdict next tick exceeds the safe integer range");
      }
      if (nextTick120 >= internals.boundaries.fixedSliceComplete) {
        throw new Error("Alternating Verdict terminal boundary requires closeSlice(), not gameplay input");
      }
      const before = runSnapshot(internals);
      if (before.pendingFlushTick120 !== null) {
        throw new Error(`Alternating Verdict inherited unclosed tick ${before.pendingFlushTick120}`);
      }
      if (before.activeOccurrenceId !== null) {
        CanonicalCombatKernel.prototype.step.call(internals.kernel, input);
      } else {
        CanonicalRunCombatState.prototype.stepIdle.call(
          internals.runState,
          input,
          EXPECTED_ROOM_ID,
        );
      }
      const after = runSnapshot(internals);
      if (after.tick120 !== nextTick120 || after.pendingFlushTick120 !== null) {
        throw new Error("Alternating Verdict delegated tick did not close exactly once");
      }
      internals.tick120 = nextTick120;
      return snapshotFor(internals);
    } catch (error) {
      internals.fault = asError(error);
      throw error;
    } finally {
      internals.advancing = false;
    }
  }
}
