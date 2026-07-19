import executablePatternsJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/executable-patterns-v4.json";
import roomComposersJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/room-composers-v4.json";
import {
  CanonicalCombatKernel,
  CanonicalRunCombatState,
  crossedTickCount,
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
 * One qualified, caller-resolved execution fixture. This digest includes the
 * supplied metric snapshot; it is deliberately not a room default or a
 * universal hash for Left/Right Gate.
 */
export const LIVE_ROOM_EXECUTION_FIXTURE_SHA256 =
  "b6a1eddf043960a43a3b2af99cadb355932b6ae26fafb9da1563232a642d2d1c" as const;

const EXPECTED_ROOM_ID = "FORCED_ALIGNMENT" as const;
const EXPECTED_TIER_ID = "listen" as const;
const EXPECTED_DIFFICULTY = "EASY" as const;
const EXPECTED_PATTERN_ID = "room.forced.left_right_gate" as const;
const EXPECTED_OCCURRENCE_ID = "room:0:encounter:0:room.forced.left_right_gate" as const;
const EXPECTED_RAW_RUN_SEED = 0x1234_5678;
const EXPECTED_METRIC_CAPTURE_TICK120 = 960;
const EXPECTED_DIFFICULTY_SALT = 0x1100;
const EXPECTED_RESOLVED_SEED = 0x7876_34f1;
const EXPECTED_SELECTION_SEED = 0x1234_ba38;
const RESIDUE_LIFETIME_MS = 2631;

const SERIAL_SEGMENTS_MS = Object.freeze({
  telegraph: 520,
  entry: 800,
  read: 10_200,
  materialSettle: 1050,
  rest: 1600,
  safeGapHandoff: 520,
});

const BUDGET_EVIDENCE = Object.freeze({
  interpretation: "observational-only-no-enforcement" as const,
  countingPolicy: "post-flush-active-arm-or-flight-entities" as const,
  peakDigitalBodies: 56,
  peakAllAuthorityEntitiesIncludingResidue: 77,
  cumulativeSpawnCommits: 86,
  authoredEmitters: 2,
  listenTierMaxProjectiles: 80,
  listenTierMaxEmitters: 2,
  unresolved:
    "v4-does-not-author-concurrent-vs-residue-vs-cumulative-projectile-budget-counting" as const,
});

function assertFixedFixtureSource(): void {
  const patterns = executablePatternsJson.patterns.filter((entry) =>
    entry.id === EXPECTED_PATTERN_ID);
  if (patterns.length !== 1) {
    throw new Error("qualified live-room fixture must resolve one immutable pattern");
  }
  const pattern = patterns[0];
  if (
    pattern === undefined
    || pattern.room !== EXPECTED_ROOM_ID
    || pattern.category !== "ROOM"
    || pattern.durationMs !== SERIAL_SEGMENTS_MS.read
    || pattern.seed.base !== 0x6a42_7389
    || pattern.emitters.length !== BUDGET_EVIDENCE.authoredEmitters
    || pattern.residue.type !== "seam_filament"
    || pattern.residue.lifetimeMs !== RESIDUE_LIFETIME_MS
    || pattern.residue.gameplayCollision !== false
  ) {
    throw new Error("qualified live-room pattern source drifted");
  }
  const composers = roomComposersJson.composers.filter((entry) =>
    entry.id === "composer.forced_alignment");
  if (composers.length !== 1) {
    throw new Error("qualified live-room fixture must resolve one immutable room composer");
  }
  const composer = composers[0];
  const listenTiers = composer?.intensityTiers.filter((entry) => entry.id === EXPECTED_TIER_ID) ?? [];
  const listen = listenTiers[0];
  if (
    composer === undefined
    || composer.room !== EXPECTED_ROOM_ID
    || !composer.patternPool.some((entry) => entry.patternId === EXPECTED_PATTERN_ID)
    || listenTiers.length !== 1
    || listen === undefined
    || listen.difficulty !== EXPECTED_DIFFICULTY
    || listen.budget.maxProjectiles !== BUDGET_EVIDENCE.listenTierMaxProjectiles
    || listen.budget.maxEmitters !== BUDGET_EVIDENCE.listenTierMaxEmitters
    || listen.budget.restMs !== SERIAL_SEGMENTS_MS.rest
  ) {
    throw new Error("qualified live-room tier source drifted");
  }
}

assertFixedFixtureSource();

export const LIVE_ROOM_SESSION_CONTRACT = Object.freeze({
  schemaVersion: "1.0.0-canonical-live-room-read-slice" as const,
  authority: "caller-resolved-singleton-read-slice-execution" as const,
  fixtureGameplaySha256: LIVE_ROOM_EXECUTION_FIXTURE_SHA256,
  roomId: EXPECTED_ROOM_ID,
  tierId: EXPECTED_TIER_ID,
  difficulty: EXPECTED_DIFFICULTY,
  patternId: EXPECTED_PATTERN_ID,
  composer: false as const,
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
  segmentProjection: "cumulative-first-non-early-tick120-from-read-entry" as const,
  patternLocalTickZero: "caller-established-read-entry" as const,
  metricCausality: "read-entry-at-or-after-metric-capture-plus-unexecuted-pre-read-duration" as const,
  terminalBoundary: "internal-neutral-close-from-quiescent-state" as const,
  nestedCombatReadiness: "occurrence-lifecycle-only-not-room-or-run-handoff" as const,
  safeGapHandoffSerialDuration: false as const,
  serialSegmentsMs: SERIAL_SEGMENTS_MS,
  budgetEvidence: BUDGET_EVIDENCE,
});

export interface CanonicalLiveRoomExecutionOptions {
  readonly expectedGameplaySha256: string;
  readonly startTick120: number;
  readonly initialPlayerPosition: Vec2;
  readonly grazeRadiusPx: number;
  readonly projectileDamage: number;
  readonly projectilePoolClasses: Readonly<Record<string, ProjectilePoolClass>>;
  readonly incomingReadBoundary: "caller-established-after-unexecuted-telegraph-and-entry";
  readonly incomingSafeGap: "not-claimed";
}

export type CanonicalLiveRoomExecutionPhase =
  | "read"
  | "material_settle"
  | "rest"
  | "slice_complete";

export interface CanonicalLiveRoomExecutionBoundaryTicks {
  readonly start: number;
  readonly read: number;
  readonly materialSettle: number;
  readonly rest: number;
  readonly fixedSliceComplete: number;
  readonly residueDeadline: number;
}

export type CanonicalLiveRoomOccurrenceSnapshot = Readonly<
  Omit<CanonicalCombatSnapshot, "handoffReady">
  & {readonly occurrenceLifecycleReady: boolean}
>;

export interface CanonicalLiveRoomExecutionSnapshot {
  readonly authority: "canonical-live-room-read-slice-v4";
  readonly admissionGameplaySha256: typeof LIVE_ROOM_EXECUTION_FIXTURE_SHA256;
  readonly metricCapturedAtTick120: typeof EXPECTED_METRIC_CAPTURE_TICK120;
  readonly tick120: number;
  readonly relativeTick120: number;
  readonly phase: CanonicalLiveRoomExecutionPhase;
  readonly boundaryTicks120: Readonly<CanonicalLiveRoomExecutionBoundaryTicks>;
  readonly roomId: typeof EXPECTED_ROOM_ID;
  readonly roomOrdinal: 0;
  readonly patternId: typeof EXPECTED_PATTERN_ID;
  readonly occurrenceId: typeof EXPECTED_OCCURRENCE_ID;
  readonly encounterOrdinal: 0;
  readonly tierId: typeof EXPECTED_TIER_ID;
  readonly difficulty: typeof EXPECTED_DIFFICULTY;
  readonly composer: false;
  readonly selectionAuthority: "caller-resolved";
  readonly parallel: false;
  readonly canonicalEventBus: true;
  readonly runHandoff: false;
  readonly fixedSliceComplete: boolean;
  readonly roomComplete: false;
  readonly timedStateQuiescent: boolean;
  readonly handoffReady: false;
  readonly faulted: boolean;
  readonly runCombat: CanonicalRunCombatStateSnapshot;
  readonly combat: CanonicalLiveRoomOccurrenceSnapshot;
  readonly adapterPolicy: Readonly<{
    readonly readBoundary: "caller-established-after-unexecuted-telegraph-and-entry";
    readonly incomingSafeGap: "not-claimed";
    readonly preReadAuthority: "telegraph-and-entry-outside-fragment-unexecuted";
    readonly segmentProjection: "cumulative-first-non-early-tick120-from-read-entry";
    readonly patternLocalTickZero: "caller-established-read-entry";
    readonly metricCausality: "read-entry-at-or-after-metric-capture-plus-unexecuted-pre-read-duration";
    readonly terminalBoundary: "internal-neutral-close-from-quiescent-state";
    readonly nestedCombatReadiness: "occurrence-lifecycle-only-not-room-or-run-handoff";
    readonly safeGapHandoff: "validated-scalar-not-a-serial-window-or-spatial-proof";
    readonly budget: typeof BUDGET_EVIDENCE;
    readonly provenance: "application-required-v4-omission";
  }>;
}

interface CapturedExecutionOptions extends CanonicalLiveRoomExecutionOptions {
  readonly initialPlayerPosition: Readonly<Vec2>;
  readonly projectilePoolClasses: Readonly<Record<string, ProjectilePoolClass>>;
}

interface PreflightResult {
  readonly options: CapturedExecutionOptions;
  readonly plan: LiveRoomCapabilityAdmittedPlan;
  readonly boundaries: Readonly<CanonicalLiveRoomExecutionBoundaryTicks>;
}

interface LiveRoomSessionInternals {
  readonly options: CapturedExecutionOptions;
  readonly plan: LiveRoomCapabilityAdmittedPlan;
  readonly boundaries: Readonly<CanonicalLiveRoomExecutionBoundaryTicks>;
  readonly runState: CanonicalRunCombatState;
  readonly kernel: CanonicalCombatKernel;
  tick120: number;
  fixedSliceComplete: boolean;
  fault: Error | null;
  advancing: boolean;
}

const SESSION_INTERNALS = new WeakMap<CanonicalLiveRoomExecutionFragment, LiveRoomSessionInternals>();

const ADAPTER_POLICY = Object.freeze({
  readBoundary: "caller-established-after-unexecuted-telegraph-and-entry" as const,
  incomingSafeGap: "not-claimed" as const,
  preReadAuthority: "telegraph-and-entry-outside-fragment-unexecuted" as const,
  segmentProjection: "cumulative-first-non-early-tick120-from-read-entry" as const,
  patternLocalTickZero: "caller-established-read-entry" as const,
  metricCausality: "read-entry-at-or-after-metric-capture-plus-unexecuted-pre-read-duration" as const,
  terminalBoundary: "internal-neutral-close-from-quiescent-state" as const,
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

function captureExecutionOptions(value: unknown): CapturedExecutionOptions {
  const record = ownDataRecord(value, "live room execution options", [
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
    throw new Error("live room execution expectedGameplaySha256 must be a lowercase SHA-256");
  }
  const startTick120 = safeNonNegativeInteger(
    record.startTick120,
    "live room execution startTick120",
  );
  const positionRecord = ownDataRecord(
    record.initialPlayerPosition,
    "live room execution initialPlayerPosition",
    ["x", "y"],
  );
  const x = finiteNumber(positionRecord.x, "live room execution initialPlayerPosition.x");
  const y = finiteNumber(positionRecord.y, "live room execution initialPlayerPosition.y");
  if (x < 0 || x > LOGICAL_VIEW_WIDTH || y < 0 || y > LOGICAL_VIEW_HEIGHT) {
    throw new Error("live room execution initialPlayerPosition must remain in the logical viewport");
  }
  const grazeRadiusPx = finiteNumber(record.grazeRadiusPx, "live room execution grazeRadiusPx");
  if (grazeRadiusPx <= PLAYER_NORMAL_COLLISION_RADIUS_PX) {
    throw new Error("live room execution grazeRadiusPx must exceed the normal collision radius");
  }
  if (
    !Number.isSafeInteger(record.projectileDamage)
    || (record.projectileDamage as number) <= 0
    || Object.is(record.projectileDamage, -0)
  ) {
    throw new Error("live room execution projectileDamage must be a positive safe integer");
  }
  const poolRecord = ownDataRecord(
    record.projectilePoolClasses,
    "live room execution projectilePoolClasses",
    ["bullet.micro.notch_e"],
  );
  if (poolRecord["bullet.micro.notch_e"] !== "micro") {
    throw new Error("live room execution requires the exact notch_e to micro pool mapping");
  }
  if (record.incomingReadBoundary !== "caller-established-after-unexecuted-telegraph-and-entry") {
    throw new Error("live room execution requires an explicit caller-established READ boundary");
  }
  if (record.incomingSafeGap !== "not-claimed") {
    throw new Error("live room execution cannot claim an unresolved incoming safe gap");
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
): Readonly<CanonicalLiveRoomExecutionBoundaryTicks> {
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
  const completeRelative = crossedTickCount(restEndMs);
  const residueRelative = crossedTickCount(segments.readMs)
    + crossedTickCount(RESIDUE_LIFETIME_MS);
  const relative = [
    materialSettleRelative,
    restRelative,
    residueRelative,
    completeRelative,
  ];
  if (relative.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error("live room execution relative boundary overflowed");
  }
  if (
    !(materialSettleRelative <= restRelative
      && restRelative <= completeRelative)
  ) {
    throw new Error("live room execution boundaries must be monotonic");
  }
  return Object.freeze({
    start: startTick120,
    read: startTick120,
    materialSettle: safeBoundary(
      startTick120,
      materialSettleRelative,
      "material-settle boundary",
    ),
    rest: safeBoundary(startTick120, restRelative, "rest boundary"),
    fixedSliceComplete: safeBoundary(
      startTick120,
      completeRelative,
      "fixed slice completion boundary",
    ),
    residueDeadline: safeBoundary(startTick120, residueRelative, "residue deadline"),
  });
}

function preflight(candidate: unknown, optionsValue: unknown): PreflightResult {
  const options = captureExecutionOptions(optionsValue);
  const admission = admitLiveRoomCapability(candidate);
  if (admission.status !== "admitted") {
    const detail = admission.rejections
      .map((entry) => `${entry.path}:${entry.code}`)
      .join(",");
    throw new Error(`live room execution admission rejected${detail.length > 0 ? `: ${detail}` : ""}`);
  }
  if (admission.gameplaySha256 !== options.expectedGameplaySha256) {
    throw new Error("live room execution gameplay SHA-256 does not match the caller expectation");
  }
  const plan = admission.plan;
  const room = plan.room;
  if (
    plan.rawRunSeed.domain !== "raw-run-seed"
    || plan.rawRunSeed.value !== EXPECTED_RAW_RUN_SEED
    || plan.metricSnapshot.capturedAtTick120 !== EXPECTED_METRIC_CAPTURE_TICK120
    || room.roomId !== EXPECTED_ROOM_ID
    || room.roomOrdinal !== 0
    || room.tierId !== EXPECTED_TIER_ID
    || room.difficulty !== EXPECTED_DIFFICULTY
    || room.encounters.length !== 1
  ) {
    throw new Error("live room execution candidate is outside the fixed singleton room scope");
  }
  const encounter = room.encounters[0];
  if (encounter === undefined) throw new Error("live room execution lost its singleton encounter");
  if (encounter.parallel.mode !== "none") {
    throw new Error("live room execution has no supported parallel budget envelope");
  }
  if (
    encounter.parallel.selectionSeed.domain !== "parallel-selection-seed"
    || encounter.parallel.selectionSeed.value !== EXPECTED_SELECTION_SEED
  ) {
    throw new Error("live room execution parallel-none selection seed drifted");
  }
  if (encounter.patternId !== EXPECTED_PATTERN_ID) {
    throw new Error(`live room execution has no qualified fixed-slice evidence for ${encounter.patternId}`);
  }
  if (
    encounter.occurrenceId !== EXPECTED_OCCURRENCE_ID
    || encounter.encounterOrdinal !== 0
    || encounter.difficulty !== EXPECTED_DIFFICULTY
    || encounter.difficultySalt !== EXPECTED_DIFFICULTY_SALT
    || encounter.resolvedSeed.domain !== "resolved-occurrence-seed"
    || encounter.resolvedSeed.value !== EXPECTED_RESOLVED_SEED
  ) {
    throw new Error("live room execution occurrence identity or resolved seed drifted");
  }
  const boundaries = boundariesFor(options.startTick120, encounter.segments);
  if (boundaries.residueDeadline > boundaries.fixedSliceComplete) {
    throw new Error("live room execution terminal residue tail exceeds the fixed slice end");
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
    throw new Error("live room execution segment fixture drifted");
  }
  const earliestReadTick120 = safeBoundary(
    plan.metricSnapshot.capturedAtTick120,
    crossedTickCount(segments.telegraphMs + segments.entryMs),
    "earliest causal READ boundary",
  );
  if (options.startTick120 < earliestReadTick120) {
    throw new Error(
      "live room execution READ boundary cannot precede metric capture plus telegraph/entry time",
    );
  }
  if (admission.gameplaySha256 !== LIVE_ROOM_EXECUTION_FIXTURE_SHA256) {
    throw new Error("live room execution candidate is not the qualified fixed fixture");
  }
  if (
    boundaries.read - options.startTick120 !== 0
    || boundaries.materialSettle - options.startTick120 !== 1224
    || boundaries.rest - options.startTick120 !== 1350
    || boundaries.residueDeadline - options.startTick120 !== 1540
    || boundaries.fixedSliceComplete - options.startTick120 !== 1542
  ) {
    throw new Error("live room execution cumulative tick projection drifted");
  }
  return Object.freeze({options, plan, boundaries});
}

function internalsFor(session: CanonicalLiveRoomExecutionFragment): LiveRoomSessionInternals {
  const internals = SESSION_INTERNALS.get(session);
  if (internals === undefined) throw new Error("unrecognized live room execution fragment");
  return internals;
}

function phaseAt(
  tick120: number,
  boundaries: CanonicalLiveRoomExecutionBoundaryTicks,
): CanonicalLiveRoomExecutionPhase {
  if (tick120 >= boundaries.fixedSliceComplete) return "slice_complete";
  if (tick120 >= boundaries.rest) return "rest";
  if (tick120 >= boundaries.materialSettle) return "material_settle";
  return "read";
}

function runSnapshot(internals: LiveRoomSessionInternals): CanonicalRunCombatStateSnapshot {
  return CanonicalRunCombatState.prototype.snapshot.call(internals.runState);
}

function combatSnapshot(internals: LiveRoomSessionInternals): CanonicalLiveRoomOccurrenceSnapshot {
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

function snapshotFor(internals: LiveRoomSessionInternals): CanonicalLiveRoomExecutionSnapshot {
  const runCombat = runSnapshot(internals);
  return Object.freeze({
    authority: "canonical-live-room-read-slice-v4" as const,
    admissionGameplaySha256: LIVE_ROOM_EXECUTION_FIXTURE_SHA256,
    metricCapturedAtTick120: EXPECTED_METRIC_CAPTURE_TICK120,
    tick120: internals.tick120,
    relativeTick120: internals.tick120 - internals.options.startTick120,
    phase: phaseAt(internals.tick120, internals.boundaries),
    boundaryTicks120: internals.boundaries,
    roomId: EXPECTED_ROOM_ID,
    roomOrdinal: 0 as const,
    patternId: EXPECTED_PATTERN_ID,
    occurrenceId: EXPECTED_OCCURRENCE_ID,
    encounterOrdinal: 0 as const,
    tierId: EXPECTED_TIER_ID,
    difficulty: EXPECTED_DIFFICULTY,
    composer: false as const,
    selectionAuthority: "caller-resolved" as const,
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
 * Executes exactly one prequalified caller-resolved READ window. It is not a
 * composer, room transition, parallel coordinator, or full-Run session.
 * Segment changes remain observable snapshot state because V4 declares no
 * canonical encounter/segment event IDs.
 */
export class CanonicalLiveRoomExecutionFragment {
  constructor(
    candidate: unknown,
    optionsValue: CanonicalLiveRoomExecutionOptions,
    _projectionContext?: unknown,
  ) {
    // Projection is intentionally opaque. Complete admission, adapter, tail,
    // and overflow preflight happens before the first event bus is created.
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
    SESSION_INTERNALS.set(this, {
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

  snapshot(): CanonicalLiveRoomExecutionSnapshot {
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

  /**
   * Closes the first non-early fixed boundary without accepting a new caller
   * gameplay frame. A live player timer cannot be stranded behind this
   * fragment: occurrence ownership and run-owned timers must already be
   * quiescent, and the internal boundary frame preserves focus while applying
   * no movement or edges.
   */
  closeSlice(): CanonicalLiveRoomExecutionSnapshot {
    const internals = internalsFor(this);
    if (internals.advancing) {
      const error = new Error("live room execution close is already in progress");
      if (internals.fault === null) internals.fault = error;
      throw error;
    }
    if (internals.fault !== null) {
      throw new Error(`live room execution is faulted: ${internals.fault.message}`, {
        cause: internals.fault,
      });
    }
    if (internals.fixedSliceComplete) {
      const error = new Error("live room READ slice is already closed");
      internals.fault = error;
      throw error;
    }
    internals.advancing = true;
    try {
      const nextTick120 = internals.tick120 + 1;
      if (nextTick120 !== internals.boundaries.fixedSliceComplete) {
        throw new Error("live room READ slice can close only at its exact fixed boundary");
      }
      const before = runSnapshot(internals);
      if (before.pendingFlushTick120 !== null) {
        throw new Error(`live room execution inherited unclosed tick ${before.pendingFlushTick120}`);
      }
      if (before.activeOccurrenceId !== null) {
        throw new Error("live room READ slice cannot close while its occurrence is active");
      }
      if (!timedStateQuiescent(before)) {
        throw new Error("live room READ slice cannot strand a run-owned timer at closure");
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
        throw new Error("live room execution neutral closure did not close exactly once");
      }
      if (CanonicalRunCombatState.prototype.events.call(internals.runState).length !== eventCount) {
        throw new Error("live room execution neutral closure emitted an unauthorized event");
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

  step(input: CanonicalCombatStepInput): CanonicalLiveRoomExecutionSnapshot {
    const internals = internalsFor(this);
    if (internals.advancing) {
      const error = new Error("live room execution step is already in progress");
      if (internals.fault === null) internals.fault = error;
      throw error;
    }
    if (internals.fault !== null) {
      throw new Error(`live room execution is faulted: ${internals.fault.message}`, {
        cause: internals.fault,
      });
    }
    if (internals.fixedSliceComplete) {
      const error = new Error("live room READ slice is already closed");
      internals.fault = error;
      throw error;
    }
    internals.advancing = true;
    try {
      const nextTick120 = internals.tick120 + 1;
      if (!Number.isSafeInteger(nextTick120)) {
        throw new Error("live room execution next tick exceeds the safe integer range");
      }
      if (nextTick120 >= internals.boundaries.fixedSliceComplete) {
        throw new Error("live room READ slice terminal boundary requires closeSlice(), not gameplay input");
      }
      const before = runSnapshot(internals);
      if (before.pendingFlushTick120 !== null) {
        throw new Error(`live room execution inherited unclosed tick ${before.pendingFlushTick120}`);
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
        throw new Error("live room execution delegated tick did not close exactly once");
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
