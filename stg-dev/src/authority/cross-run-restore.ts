import stateMachinesJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/runtime/state-machines-v4.json";
import runtimeContractJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/runtime/runtime-contract-v4.json";
import eventSchemaJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/runtime/event-schema-v4.json";
import feedbackBindingsJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/runtime/feedback-bindings-v4.json";
import ghostReplayContractJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/narrative/ghost-replay-contract-v4.json";
import assetBindingsJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/integration/asset-bindings-v4.json";
import {
  CROSS_RUN_RESTORE_OFFSETS,
  deriveCrossRunRestoreTiming,
} from "../../../1bit-stg-complete-asset-kit-v4/runtime/world";
import {
  CanonicalEventBus,
  isExactCanonicalEventBus,
  type GameplayEventDraft,
} from "./events";
import {
  MASTER_TICK_HZ,
  MAXIMUM_BOUNDARIES_PER_ADVANCE,
  runtime60DeadlineTick,
} from "./clock";
import {
  assertRunMemory,
  readRecorderIssuedRunMemory,
  type BurnIn,
  type DeathTrace,
  type FinalizedRunMemory,
  type GhostPoint,
  type GhostResidue,
  type OverrideScar,
  type RecorderIssuedRunMemoryToken,
  type RunMemory,
} from "./run-memory-model";

const AUTHORITY_ID = "cross-run-restore";
const WITNESS_PRIORITY = Object.freeze([
  "nearbyOverrideScar",
  "ghostEndpoint",
  "resistanceTransmission",
  "eclipse",
  "resonance",
  "clamp",
  "idle",
]);

const EXPECTED_MACHINE = Object.freeze({
  id: "crossRunRestore",
  implementation: "CrossRunRestoreMachine",
  type: "next-run-hydration-fsm",
  states: Object.freeze([
    "idle",
    "waiting-ghost",
    "replaying-ghost",
    "materializing-residue",
    "waiting-witness",
    "orienting-witnesses",
    "ready",
  ]),
  initialState: "idle",
  orderedSteps: Object.freeze([
    "overrideScar",
    "deathTrace",
    "burnIn",
    "actual-ghost-route",
    "ghostResidue",
    "witnessOrientation",
    "returnInput",
  ]),
  routeDurationAuthority: "last actual ghostRoute point tMs",
  transitions: Object.freeze([
    Object.freeze({
      from: "idle",
      to: "waiting-ghost",
      trigger: "next-run-start@0ms",
      events: Object.freeze([
        "player.input.off",
        "cross_run.restore.begin",
        "overrideScar.rehydrate",
        "deathTrace.rehydrate",
        "burnIn.rehydrate",
      ]),
    }),
    Object.freeze({
      from: "waiting-ghost",
      to: "replaying-ghost",
      trigger: "420ms",
      events: Object.freeze(["ghost.replay.begin"]),
    }),
    Object.freeze({
      from: "replaying-ghost",
      to: "materializing-residue",
      trigger: "routeDuration+420ms",
      events: Object.freeze(["ghost.replay.complete"]),
    }),
    Object.freeze({
      from: "materializing-residue",
      to: "waiting-witness",
      trigger: "routeDuration+421ms",
      events: Object.freeze(["ghost.residue.write"]),
    }),
    Object.freeze({
      from: "waiting-witness",
      to: "orienting-witnesses",
      trigger: "routeDuration+700ms",
      events: Object.freeze(["witness.turn"]),
    }),
    Object.freeze({
      from: "orienting-witnesses",
      to: "ready",
      trigger: "routeDuration+1140ms",
      events: Object.freeze(["returnInput", "cross_run.restore.complete"]),
    }),
  ]),
});

const EXPECTED_EVENT_DEFINITIONS = Object.freeze([
  Object.freeze({id: "player.input.off", domain: "player", criticality: "critical", requiredPayload: Object.freeze(["reason"])}),
  Object.freeze({id: "cross_run.restore.begin", domain: "cross-run", criticality: "critical", requiredPayload: Object.freeze(["fromRunId", "nextRunId", "routeDigest", "routeDurationMs"])}),
  Object.freeze({id: "overrideScar.rehydrate", domain: "cross-run", criticality: "critical", requiredPayload: Object.freeze(["fromRunId", "nextRunId", "recordType", "count", "records"])}),
  Object.freeze({id: "deathTrace.rehydrate", domain: "cross-run", criticality: "critical", requiredPayload: Object.freeze(["fromRunId", "nextRunId", "recordType", "count", "records"])}),
  Object.freeze({id: "burnIn.rehydrate", domain: "cross-run", criticality: "critical", requiredPayload: Object.freeze(["fromRunId", "nextRunId", "recordType", "count", "records"])}),
  Object.freeze({id: "ghost.replay.begin", domain: "cross-run", criticality: "critical", requiredPayload: Object.freeze(["fromRunId", "nextRunId", "routeDigest", "routeDurationMs", "pointCount", "routePoints", "timeScale", "collisionClass", "rewardClass", "emitterClass"])}),
  Object.freeze({id: "ghost.replay.complete", domain: "cross-run", criticality: "critical", requiredPayload: Object.freeze(["fromRunId", "nextRunId", "routeDigest", "routeDurationMs", "finalPoint", "burnAfterRead"])}),
  Object.freeze({id: "ghost.residue.write", domain: "cross-run", criticality: "critical", requiredPayload: Object.freeze(["fromRunId", "nextRunId", "recordType", "residueId", "sourceRouteDigest", "createdAfterReplay", "persistenceRuns", "position", "priorGhostResidueCount"])}),
  Object.freeze({id: "witness.turn", domain: "cross-run", criticality: "critical", requiredPayload: Object.freeze(["fromRunId", "nextRunId", "evaluatedAfterGhostResidue", "overrideScarIds", "ghostEndpoint", "priority"])}),
  Object.freeze({id: "returnInput", domain: "cross-run", criticality: "critical", requiredPayload: Object.freeze(["fromRunId", "nextRunId", "inputState", "routeDurationMs"])}),
  Object.freeze({id: "cross_run.restore.complete", domain: "cross-run", criticality: "critical", requiredPayload: Object.freeze(["fromRunId", "nextRunId", "routeDigest", "routeDurationMs"])}),
]);

const EXPECTED_FEEDBACK_BINDINGS = Object.freeze([
  Object.freeze({id: "cross-run-restore-ui", eventId: "cross_run.restore.begin", sink: Object.freeze({kind: "ui", cueId: "cross-run.restore-order-marker"}), gameplayCritical: true, modifiers: Object.freeze({})}),
  Object.freeze({id: "override-scar-rehydrate-visual", eventId: "overrideScar.rehydrate", sink: Object.freeze({kind: "visual", cueId: "material.override-scar-rehydrate-steady"}), gameplayCritical: true, modifiers: Object.freeze({contrastAware: true})}),
  Object.freeze({id: "death-trace-rehydrate-visual", eventId: "deathTrace.rehydrate", sink: Object.freeze({kind: "visual", cueId: "material.death-trace-rehydrate-steady"}), gameplayCritical: true, modifiers: Object.freeze({contrastAware: true})}),
  Object.freeze({id: "burn-in-rehydrate-visual", eventId: "burnIn.rehydrate", sink: Object.freeze({kind: "visual", cueId: "material.burn-in-rehydrate-steady"}), gameplayCritical: true, modifiers: Object.freeze({contrastAware: true})}),
  Object.freeze({id: "ghost-replay-begin-visual", eventId: "ghost.replay.begin", sink: Object.freeze({kind: "visual", cueId: "ghost.actual-route-linear"}), gameplayCritical: true, modifiers: Object.freeze({motionSensitive: true, contrastAware: true}), fallback: Object.freeze({cueId: "ghost.actual-route-event-pins", when: Object.freeze(["motion:reduced"])})}),
  Object.freeze({id: "ghost-replay-complete-visual", eventId: "ghost.replay.complete", sink: Object.freeze({kind: "visual", cueId: "ghost.burnout-oldest-to-newest"}), gameplayCritical: true, modifiers: Object.freeze({motionSensitive: true}), fallback: Object.freeze({cueId: "ghost.burnout-final-point-steady", when: Object.freeze(["motion:reduced"])})}),
  Object.freeze({id: "ghost-residue-write-visual", eventId: "ghost.residue.write", sink: Object.freeze({kind: "visual", cueId: "material.ghost-residue-write-steady"}), gameplayCritical: true, modifiers: Object.freeze({contrastAware: true})}),
  Object.freeze({id: "witness-turn-visual", eventId: "witness.turn", sink: Object.freeze({kind: "visual", cueId: "witness.fact-directed-turn"}), gameplayCritical: true, modifiers: Object.freeze({motionSensitive: true}), fallback: Object.freeze({cueId: "witness.fact-directed-facing-steady", when: Object.freeze(["motion:reduced"])})}),
  Object.freeze({id: "cross-run-input-ui", eventId: "returnInput", sink: Object.freeze({kind: "ui", cueId: "cross-run.input-return-marker"}), gameplayCritical: true, modifiers: Object.freeze({})}),
]);

const EXPECTED_ASSET_BINDINGS = Object.freeze([
  Object.freeze({bindingId: "cross-run-restore-ui", eventId: "cross_run.restore.begin", kind: "ui", cueId: "cross-run.restore-order-marker", resolver: "cross_run_transition.authoritativeTimeline"}),
  Object.freeze({bindingId: "override-scar-rehydrate-visual", eventId: "overrideScar.rehydrate", kind: "visual", cueId: "material.override-scar-rehydrate-steady", resolver: "memory.scar_rehydrate"}),
  Object.freeze({bindingId: "death-trace-rehydrate-visual", eventId: "deathTrace.rehydrate", kind: "visual", cueId: "material.death-trace-rehydrate-steady", resolver: "memory.death_trace"}),
  Object.freeze({bindingId: "burn-in-rehydrate-visual", eventId: "burnIn.rehydrate", kind: "visual", cueId: "material.burn-in-rehydrate-steady", resolver: "memory.burnin"}),
  Object.freeze({bindingId: "ghost-replay-begin-visual", eventId: "ghost.replay.begin", kind: "visual", cueId: "ghost.actual-route-linear", resolver: "ghost.retrace", accessibilityFallback: Object.freeze({cueId: "ghost.actual-route-event-pins", when: Object.freeze(["motion:reduced"]), resolver: "ghost.path_endpoint"})}),
  Object.freeze({bindingId: "ghost-replay-complete-visual", eventId: "ghost.replay.complete", kind: "visual", cueId: "ghost.burnout-oldest-to-newest", resolver: "ghost.burnout", accessibilityFallback: Object.freeze({cueId: "ghost.burnout-final-point-steady", when: Object.freeze(["motion:reduced"]), resolver: "ghost.material_residue"})}),
  Object.freeze({bindingId: "ghost-residue-write-visual", eventId: "ghost.residue.write", kind: "visual", cueId: "material.ghost-residue-write-steady", resolver: "ghost.material_residue"}),
  Object.freeze({bindingId: "witness-turn-visual", eventId: "witness.turn", kind: "visual", cueId: "witness.fact-directed-turn", resolver: "witness.turn_player", accessibilityFallback: Object.freeze({cueId: "witness.fact-directed-facing-steady", when: Object.freeze(["motion:reduced"]), resolver: "witness.turn_player"})}),
  Object.freeze({bindingId: "cross-run-input-ui", eventId: "returnInput", kind: "ui", cueId: "cross-run.input-return-marker", resolver: "cross_run_transition.returnInput"}),
]);

const RESTORE_EVENT_IDS = new Set(EXPECTED_EVENT_DEFINITIONS.map(({id}) => id));
const FEEDBACK_EVENT_IDS = new Set(EXPECTED_FEEDBACK_BINDINGS.map(({eventId}) => eventId));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  return value;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

function assertExactJson(actual: unknown, expected: unknown, path: string): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`${path} drifted from the immutable V4 contract`);
  }
}

function filterObjectsByStringField(
  value: unknown,
  path: string,
  field: string,
  accepted: ReadonlySet<string>,
): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value.filter((entry): entry is Record<string, unknown> => {
    const object = requireRecord(entry, `${path} entry`);
    return typeof object[field] === "string" && accepted.has(object[field]);
  });
}

function assertImmutableSourceContracts(): void {
  const stateMachines = requireRecord(stateMachinesJson, "state-machine manifest");
  if (stateMachines.schemaVersion !== "4.0.0" || stateMachines.id !== "1bit.state-machines.v4") {
    throw new Error("V4 state-machine manifest identity drifted");
  }
  const machines = filterObjectsByStringField(
    stateMachines.machines,
    "state-machine manifest.machines",
    "id",
    new Set(["crossRunRestore"]),
  );
  if (machines.length !== 1) throw new Error("V4 must declare exactly one crossRunRestore machine");
  assertExactJson(machines[0], EXPECTED_MACHINE, "V4 crossRunRestore machine");

  const runtime = requireRecord(runtimeContractJson, "runtime contract");
  if (runtime.schemaVersion !== "4.0.0" || runtime.id !== "1bit.runtime-contract.v4") {
    throw new Error("V4 runtime contract identity drifted");
  }
  assertExactJson(runtime.authority, {
    gameplayClock: "monotonic-fixed-step-simulation",
    fixedStepMs: 16.6666666667,
    visualClock: "derived-read-only",
    audioClock: "derived-read-only",
    hapticClock: "derived-read-only",
    largeDeltaPolicy: "traverse-every-crossed-authoritative-boundary",
    maximumBoundariesPerAdvance: 1024,
  }, "V4 runtime authority");
  assertExactJson(runtime.sameTimestampOrdering, [
    "collision-disable",
    "state-or-damage-commit",
    "collision-enable",
    "entity-spawn",
    "feedback-dispatch",
  ], "V4 same-timestamp ordering");
  const separation = requireRecord(runtime.snapshotSeparation, "runtime snapshot separation");
  assertExactJson(separation, {
    snapshotResponsibility: "observe-serialize-present-current-run",
    archiveResponsibility: "persist-immutable-record",
    restoreResponsibility: "hydrate-next-run",
    snapshotMayRestoreNextRun: false,
    restoreOrder: ["overrideScar", "deathTrace", "burnIn", "actual-ghost-route", "ghostResidue", "witnessOrientation", "returnInput"],
    materialTypesAreDisjoint: true,
    routeDurationAuthority: "last-authoritative-ghostRoute-point-tMs",
  }, "V4 snapshot/restore separation");
  const timing = requireRecord(runtime.canonicalTimingMs, "runtime canonical timing");
  assertExactJson(timing.crossRunRestore, {
    materialRehydrate: 0,
    ghostReplayBegin: 420,
    ghostReplayComplete: "routeDurationMs+420",
    ghostResidueWrite: "routeDurationMs+421",
    witnessTurn: "routeDurationMs+700",
    inputReturn: "routeDurationMs+1140",
  }, "V4 cross-run timing");
  assertExactJson(runtime.accessibilityInvariant, {
    gameplayAuthorityUnaffected: true,
    axesAreOrthogonal: true,
    requiredParityProfiles: ["full", "reducedMotion", "flashOff"],
    parityDefinition: "same-event-id-same-simulation-time-same-payload-same-order",
    collisionMayDependOnAccessibility: false,
    rngMayDependOnAccessibility: false,
    bossOrPatternTimingMayDependOnAccessibility: false,
  }, "V4 accessibility invariant");
  assertExactJson(runtime.feedbackInvariant, {
    direction: "gameplay-event-to-feedback-sink-only",
    feedbackMayEmitGameplay: false,
    gameplayCriticalConditionalCueRequiresFallback: true,
    visualFeedbackMayDetermineCollision: false,
  }, "V4 feedback invariant");

  assertExactJson(CROSS_RUN_RESTORE_OFFSETS, {
    materialRehydrateAtMs: 0,
    ghostReplayBeginAtMs: 420,
    ghostReplayCompleteOffsetMs: 420,
    ghostResidueWriteOffsetMs: 421,
    witnessTurnOffsetMs: 700,
    inputReturnOffsetMs: 1140,
  }, "V4 CrossRunRestoreMachine offsets");
  assertExactJson(deriveCrossRunRestoreTiming(960), {
    materialRehydrateAtMs: 0,
    ghostReplayBeginAtMs: 420,
    ghostReplayCompleteAtMs: 1380,
    ghostResidueWriteAtMs: 1381,
    witnessTurnAtMs: 1660,
    inputReturnAtMs: 2100,
  }, "V4 CrossRunRestoreMachine derived timing");

  const ghost = requireRecord(ghostReplayContractJson, "ghost replay contract");
  if (ghost.schemaVersion !== "4.0.0-ghost-replay" || ghost.id !== "ghost.actual-route.once") {
    throw new Error("V4 ghost replay contract identity drifted");
  }
  assertExactJson(ghost.capture, {
    source: "actual player transform after authoritative movement resolution",
    sampleIntervalMs: 120,
    eventPins: ["ROOM_ENTER", "SEAM_CROSS", "GAZE", "GRAZE", "DAMAGE", "OVERRIDE"],
    fields: ["tMs", "xNorm", "yNorm", "room", "flower", "focus", "flags"],
    quantization: "1/1024 logical extent",
    compression: {algorithm: "Ramer-Douglas-Peucker with event pins", toleranceLogicalPx: 0.75, maximumPoints: 4096},
    digest: "sha256(canonical CBOR of uncompressed quantized samples)",
    forbidden: ["authored replacement path", "random path", "prediction path", "enemy target path"],
  }, "V4 ghost capture");
  assertExactJson(ghost.replay, {
    count: 1,
    clock: "gameplayClock",
    timeScale: 1,
    collisionClass: "NONE",
    rewardClass: "NONE",
    emitterClass: "NONE",
    inputPolicyDuringReplay: "held",
    visualInterpolation: "linear between captured authoritative points; never changes event pins",
    reducedMotion: "show event pins and final point at original gameplay timestamps",
    flashOff: "same as full motion, no luminance inversion",
  }, "V4 ghost replay");
  assertExactJson(ghost.ordering, [
    "overrideScar.rehydrate",
    "deathTrace.rehydrate",
    "burnIn.rehydrate",
    "ghost.replay.begin",
    "ghost.replay.complete",
    "ghost.residue.write",
    "witness.evaluate",
    "witness.turn",
    "returnInput",
  ], "V4 ghost replay ordering");
  assertExactJson(ghost.burnout, {
    trigger: "ghost.replay.complete",
    digital: "route samples extinguish from oldest to newest",
    material: "one ghostResidue is written at the actual final point",
    persistenceRuns: 1,
    idempotencyKey: "previousRun.id + routeDigest",
  }, "V4 ghost burnout");
  assertExactJson(ghost.validation, [
    "First and last replay positions equal captured endpoints after quantization.",
    "Every event pin occurs at the same gameplay tick in all accessibility modes.",
    "A consumed route cannot replay again for the same nextRunId.",
    "No ghost point can collide, graze, score, collect evidence, trigger gaze or open Override.",
  ], "V4 ghost replay validation");

  const eventSchema = requireRecord(eventSchemaJson, "event schema");
  if (eventSchema.schemaVersion !== "4.0.0" || eventSchema.id !== "1bit.event-schema.v4") {
    throw new Error("V4 event schema identity drifted");
  }
  const eventDefinitions = filterObjectsByStringField(
    eventSchema.events,
    "event schema.events",
    "id",
    RESTORE_EVENT_IDS,
  );
  assertExactJson(eventDefinitions, EXPECTED_EVENT_DEFINITIONS, "V4 cross-run event definitions");

  const feedback = requireRecord(feedbackBindingsJson, "feedback bindings");
  if (feedback.schemaVersion !== "4.0.0" || feedback.id !== "1bit.feedback-bindings.v4") {
    throw new Error("V4 feedback-binding identity drifted");
  }
  assertExactJson(feedback.policy, {
    sourceKind: "gameplay-event",
    sinkKinds: ["visual", "audio", "haptic", "ui"],
    sinkMayEmitGameplay: false,
    acyclic: true,
    dedupeKey: "bindingId:eventOccurrenceKey",
    criticalConditionalCueRequiresFallback: true,
  }, "V4 feedback policy");
  const feedbackBindings = filterObjectsByStringField(
    feedback.bindings,
    "feedback bindings.bindings",
    "eventId",
    FEEDBACK_EVENT_IDS,
  );
  assertExactJson(feedbackBindings, EXPECTED_FEEDBACK_BINDINGS, "V4 cross-run feedback bindings");

  const assets = requireRecord(assetBindingsJson, "asset bindings");
  if (assets.schemaVersion !== "4.0.0-asset-bindings") {
    throw new Error("V4 asset-binding identity drifted");
  }
  if (assets.authorityFlow !== "gameplay event -> feedback binding -> cue resolver -> passive asset subscriber") {
    throw new Error("V4 asset-binding authority flow drifted");
  }
  assertExactJson(assets.prohibitions, [
    "assets cannot enable collision",
    "animation completion cannot advance gameplay",
    "audio and haptic cannot mutate authoritative state",
    "accessibility fallbacks preserve event and collision timing",
  ], "V4 asset-binding prohibitions");
  const assetBindings = filterObjectsByStringField(
    assets.runtimeCueResolvers,
    "asset bindings.runtimeCueResolvers",
    "eventId",
    FEEDBACK_EVENT_IDS,
  );
  assertExactJson(assetBindings, EXPECTED_ASSET_BINDINGS, "V4 cross-run asset bindings");
}

assertImmutableSourceContracts();

if (MASTER_TICK_HZ !== 120 || MAXIMUM_BOUNDARIES_PER_ADVANCE !== 1024) {
  throw new Error("application clock drifted from the pinned V4 restore contract");
}
if (
  runtime60DeadlineTick(0, 0) !== 0
  || runtime60DeadlineTick(0, 420) !== 52
  || runtime60DeadlineTick(0, 1380) !== 166
  || runtime60DeadlineTick(0, 1381) !== 166
  || runtime60DeadlineTick(0, 1660) !== 200
  || runtime60DeadlineTick(0, 2100) !== 252
) {
  throw new Error("application runtime60 projection drifted from the V4 restore timeline");
}

export const CROSS_RUN_RESTORE_AUTHORITY_CONTRACT = Object.freeze({
  authority: "v4-cross-run-restore" as const,
  masterTickHz: MASTER_TICK_HZ,
  runtimeBoundaryTick120: "even" as const,
  acceptedStartTick120: "even-runtime60-boundary" as const,
  boundaryPolicy: "first-non-early-runtime60-boundary" as const,
  largeDeltaPolicy: "traverse-every-crossed-authoritative-boundary" as const,
  maximumBoundariesPerAdvance: MAXIMUM_BOUNDARIES_PER_ADVANCE,
  recordBoundary: "opaque-recorder-issued-in-memory-token-to-narrow-restore-record" as const,
  persistedOrParsedRunMemory: "unsupported" as const,
  compressedRouteDigestRecomputation: "forbidden" as const,
  runtimeSnapshotRecordSeedAdapter: "none" as const,
  routeRequirement: "non-null-actual-player-route" as const,
  inputPolicy: "withheld-until-returnInput" as const,
  presentationDirection: "canonical-event-to-passive-feedback-only" as const,
  runtimeTimingMs: Object.freeze({
    materialRehydrate: 0,
    ghostReplayBegin: 420,
    ghostReplayCompleteOffset: 420,
    ghostResidueWriteOffset: 421,
    witnessTurnOffset: 700,
    inputReturnOffset: 1140,
  }),
});

export type CrossRunRestoreAuthorityState =
  | "idle"
  | "waiting-ghost"
  | "replaying-ghost"
  | "materializing-residue"
  | "waiting-witness"
  | "orienting-witnesses"
  | "ready";

export interface CrossRunRestoreScheduleSnapshot {
  readonly materialRehydrateTick120: number;
  readonly ghostReplayBeginTick120: number;
  readonly ghostReplayCompleteTick120: number;
  readonly ghostResidueWriteTick120: number;
  readonly witnessTurnTick120: number;
  readonly inputReturnTick120: number;
}

export interface CrossRunRestoreAuthoritySnapshot {
  readonly authority: "v4-cross-run-restore";
  readonly tick120: number | null;
  readonly requestedStartTick120: number | null;
  readonly state: CrossRunRestoreAuthorityState;
  readonly fromRunId: string | null;
  readonly nextRunId: string | null;
  readonly routeDigest: string | null;
  readonly routeDurationMs: number | null;
  readonly inputWithheld: boolean;
  readonly nextStep: number;
  readonly eventCount: number;
  readonly schedule: Readonly<CrossRunRestoreScheduleSnapshot> | null;
}

interface CapturedRestoreRecord {
  readonly runId: string;
  readonly overrideScars: readonly Readonly<OverrideScar>[];
  readonly deathTraces: readonly Readonly<DeathTrace>[];
  readonly burnIns: readonly Readonly<BurnIn>[];
  readonly ghostResidues: readonly Readonly<GhostResidue>[];
  readonly routeDigest: string;
  readonly routePoints: readonly Readonly<GhostPoint>[];
  readonly routeDurationMs: number;
  readonly finalPoint: Readonly<GhostPoint>;
}

interface ScheduledRestoreStep {
  readonly dueTick120: number;
  readonly stateAfter: Exclude<CrossRunRestoreAuthorityState, "idle" | "waiting-ghost">;
  readonly drafts: readonly GameplayEventDraft[];
}

interface ActiveRestore {
  readonly requestedStartTick120: number;
  readonly record: CapturedRestoreRecord;
  readonly nextRunId: string;
  readonly schedule: Readonly<CrossRunRestoreScheduleSnapshot>;
  readonly steps: readonly ScheduledRestoreStep[];
}

function requireTick120(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || Object.is(value, -0)) {
    throw new Error(`${path} must be a non-negative safe integer`);
  }
  return value as number;
}

function requireNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function compareCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Capture only dense, acyclic plain data before running the application schema validator. */
function capturePlainData(value: unknown, path: string, ancestors = new WeakSet<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} number must be finite`);
    return value;
  }
  if (typeof value !== "object") throw new Error(`${path} must contain only plain JSON data`);
  if (ancestors.has(value)) throw new Error(`${path} must not be cyclic`);
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) {
    throw new Error(`${path} must contain only plain objects and arrays`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error(`${path} must not contain symbol properties`);
  }
  ancestors.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Array.isArray(value)) {
      const lengthDescriptor = descriptors.length;
      const length = lengthDescriptor !== undefined && "value" in lengthDescriptor
        ? lengthDescriptor.value
        : undefined;
      if (!Number.isSafeInteger(length) || (length as number) < 0) {
        throw new Error(`${path}.length must be a non-negative safe integer`);
      }
      const expectedKeys = Array.from({length: length as number}, (_, index) => String(index));
      const actualKeys = Object.keys(descriptors).filter((key) => key !== "length");
      if (actualKeys.length !== expectedKeys.length
        || expectedKeys.some((key) => !Object.prototype.hasOwnProperty.call(descriptors, key))) {
        throw new Error(`${path} must be dense and contain no metadata`);
      }
      return Object.freeze(expectedKeys.map((key) => {
        const descriptor = descriptors[key];
        if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
          throw new Error(`${path}[${key}] must be an enumerable data property`);
        }
        return capturePlainData(descriptor.value, `${path}[${key}]`, ancestors);
      }));
    }
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(descriptors).sort(compareCodePoint)) {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
        throw new Error(`${path}.${key} must be an enumerable data property`);
      }
      result[key] = capturePlainData(descriptor.value, `${path}.${key}`, ancestors);
    }
    return Object.freeze(result);
  } finally {
    ancestors.delete(value);
  }
}

function captureValidatedRestoreRecord(value: FinalizedRunMemory): CapturedRestoreRecord {
  let captured: unknown;
  try {
    captured = capturePlainData(value, "previous run memory");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid V4 run memory: ${message}`);
  }
  assertRunMemory(captured);
  const memory: RunMemory = captured;
  const route = memory.ghostRoute;
  if (route === null) {
    throw new Error("cross-run restore requires a non-null authored actual ghostRoute");
  }
  const firstPoint = route.points[0];
  const finalPoint = route.points.at(-1);
  if (firstPoint === undefined || finalPoint === undefined || firstPoint.tMs !== 0) {
    throw new Error("cross-run restore ghostRoute must begin at authored tMs 0");
  }
  for (const [index, point] of route.points.entries()) {
    if (!Number.isSafeInteger(point.tMs)) {
      throw new Error(`cross-run restore ghostRoute.points[${index}].tMs must be a safe integer`);
    }
  }
  requireNonEmptyString(memory.run.id, "previous run memory.run.id");
  return Object.freeze({
    runId: memory.run.id,
    overrideScars: memory.materialMemory.overrideScars,
    deathTraces: memory.materialMemory.deathTraces,
    burnIns: memory.materialMemory.burnIns,
    ghostResidues: memory.materialMemory.ghostResidues,
    routeDigest: route.routeDigest,
    routePoints: route.points,
    routeDurationMs: finalPoint.tMs,
    finalPoint,
  });
}

interface CrossRunRestoreConsumptionState {
  readonly nextRunIdByRoute: ReadonlyMap<string, string>;
  readonly routeByNextRunId: ReadonlyMap<string, string>;
  readonly routeDigestByPreviousRunId: ReadonlyMap<string, string>;
}

const CONSUMPTION_STATE = new WeakMap<
  CrossRunRestoreConsumptionLedger,
  CrossRunRestoreConsumptionState
>();

function routeConsumptionKey(previousRunId: string, routeDigest: string): string {
  return JSON.stringify([previousRunId, routeDigest]);
}

/**
 * Explicit host-owned guard for replay-once and ghost-residue idempotency.
 * Sharing one ledger across restore authority instances prevents a consumed
 * actual route from materializing again, including under a different next-run
 * identity for which V4 defines no skip-residue branch.
 */
export class CrossRunRestoreConsumptionLedger {
  constructor() {
    if (new.target !== CrossRunRestoreConsumptionLedger) {
      throw new Error("cross-run consumption ledger must not be subclassed");
    }
    CONSUMPTION_STATE.set(this, Object.freeze({
      nextRunIdByRoute: new Map(),
      routeByNextRunId: new Map(),
      routeDigestByPreviousRunId: new Map(),
    }));
    Object.freeze(this);
  }

  hasConsumed(previousRunIdValue: unknown, routeDigestValue: unknown): boolean {
    const previousRunId = requireNonEmptyString(previousRunIdValue, "previous run id");
    const routeDigest = requireNonEmptyString(routeDigestValue, "route digest");
    return CONSUMPTION_STATE.get(this)?.nextRunIdByRoute.has(
      routeConsumptionKey(previousRunId, routeDigest),
    ) ?? false;
  }

  consumedBy(previousRunIdValue: unknown, routeDigestValue: unknown): string | null {
    const previousRunId = requireNonEmptyString(previousRunIdValue, "previous run id");
    const routeDigest = requireNonEmptyString(routeDigestValue, "route digest");
    return CONSUMPTION_STATE.get(this)?.nextRunIdByRoute.get(
      routeConsumptionKey(previousRunId, routeDigest),
    ) ?? null;
  }

  hasClaimedNextRun(nextRunIdValue: unknown): boolean {
    const nextRunId = requireNonEmptyString(nextRunIdValue, "next run id");
    return CONSUMPTION_STATE.get(this)?.routeByNextRunId.has(nextRunId) ?? false;
  }
}

function requireExactLedger(value: unknown): CrossRunRestoreConsumptionLedger {
  if (typeof value !== "object" || value === null
    || Object.getPrototypeOf(value) !== CrossRunRestoreConsumptionLedger.prototype
    || !CONSUMPTION_STATE.has(value as CrossRunRestoreConsumptionLedger)) {
    throw new Error("cross-run restore requires an exact CrossRunRestoreConsumptionLedger");
  }
  return value as CrossRunRestoreConsumptionLedger;
}

function assertRouteAvailable(
  ledger: CrossRunRestoreConsumptionLedger,
  record: CapturedRestoreRecord,
  nextRunId: string,
): void {
  const state = CONSUMPTION_STATE.get(ledger);
  if (state === undefined) throw new Error("cross-run consumption ledger lost its state");
  const priorRouteDigest = state.routeDigestByPreviousRunId.get(record.runId);
  if (priorRouteDigest !== undefined && priorRouteDigest !== record.routeDigest) {
    throw new Error("cross-run previous run id is already claimed by a different route history");
  }
  const routeKey = routeConsumptionKey(record.runId, record.routeDigest);
  const priorNextRunId = state.nextRunIdByRoute.get(routeKey);
  if (priorNextRunId === nextRunId) {
    throw new Error("cross-run actual route was already consumed for this nextRunId");
  }
  if (priorNextRunId !== undefined) {
    throw new Error("cross-run actual route already materialized its idempotent ghost residue");
  }
  const priorRouteKey = state.routeByNextRunId.get(nextRunId);
  if (priorRouteKey !== undefined) {
    throw new Error("cross-run nextRunId is already claimed by another previous-run route");
  }
}

interface PreparedRouteConsumption {
  readonly before: CrossRunRestoreConsumptionState;
  readonly after: CrossRunRestoreConsumptionState;
}

function prepareRouteConsumption(
  ledger: CrossRunRestoreConsumptionLedger,
  record: CapturedRestoreRecord,
  nextRunId: string,
): PreparedRouteConsumption {
  assertRouteAvailable(ledger, record, nextRunId);
  const state = CONSUMPTION_STATE.get(ledger);
  if (state === undefined) throw new Error("cross-run consumption ledger lost its state");
  const routeKey = routeConsumptionKey(record.runId, record.routeDigest);
  const nextRunIdByRoute = new Map(state.nextRunIdByRoute);
  const routeByNextRunId = new Map(state.routeByNextRunId);
  const routeDigestByPreviousRunId = new Map(state.routeDigestByPreviousRunId);
  nextRunIdByRoute.set(routeKey, nextRunId);
  routeByNextRunId.set(nextRunId, routeKey);
  routeDigestByPreviousRunId.set(record.runId, record.routeDigest);
  return Object.freeze({
    before: state,
    after: Object.freeze({
      nextRunIdByRoute,
      routeByNextRunId,
      routeDigestByPreviousRunId,
    }),
  });
}

function commitRouteConsumption(
  ledger: CrossRunRestoreConsumptionLedger,
  prepared: PreparedRouteConsumption,
): void {
  if (CONSUMPTION_STATE.get(ledger) !== prepared.before) {
    throw new Error("cross-run consumption ledger changed during an atomic begin");
  }
  CONSUMPTION_STATE.set(ledger, prepared.after);
}

function freezeSchedule(value: CrossRunRestoreScheduleSnapshot): Readonly<CrossRunRestoreScheduleSnapshot> {
  const ticks = [
    value.materialRehydrateTick120,
    value.ghostReplayBeginTick120,
    value.ghostReplayCompleteTick120,
    value.ghostResidueWriteTick120,
    value.witnessTurnTick120,
    value.inputReturnTick120,
  ];
  if (ticks.some((tick) => tick % 2 !== 0)) {
    throw new Error("cross-run restore deadline must land on an even runtime60 boundary");
  }
  if (ticks.some((tick, index) => index > 0 && tick < (ticks[index - 1] as number))) {
    throw new Error("cross-run restore deadline order regressed");
  }
  return Object.freeze({...value});
}

/**
 * Route-present next-run hydration authority. It owns no archive, renderer, or
 * feedback command port: immutable application memory enters once, canonical
 * events leave through the supplied bus, and presentation remains downstream.
 */
export class CrossRunRestoreAuthority {
  private tick120Value: number | null = null;
  private stateValue: CrossRunRestoreAuthorityState = "idle";
  private activeValue: ActiveRestore | null = null;
  private inputWithheldValue = false;
  private nextStepValue = 0;
  private eventCountValue = 0;

  private readonly bus: CanonicalEventBus;
  private readonly consumptionLedger: CrossRunRestoreConsumptionLedger;

  constructor(busValue: unknown, consumptionLedgerValue: unknown) {
    if (!isExactCanonicalEventBus(busValue)) {
      throw new Error("cross-run restore event bus must be an exact CanonicalEventBus");
    }
    this.bus = busValue;
    this.consumptionLedger = requireExactLedger(consumptionLedgerValue);
  }

  begin(
    previousRunMemoryTokenValue: RecorderIssuedRunMemoryToken,
    nextRunIdValue: unknown,
    requestedStartTick120Value: unknown,
  ): CrossRunRestoreAuthoritySnapshot {
    if (this.stateValue !== "idle" || this.activeValue !== null) {
      throw new Error("cross-run restore already started");
    }
    const requestedStartTick120 = requireTick120(
      requestedStartTick120Value,
      "cross-run restore start tick120",
    );
    if (requestedStartTick120 % 2 !== 0) {
      throw new Error("cross-run restore must begin on an even runtime60 boundary");
    }
    const nextRunId = requireNonEmptyString(nextRunIdValue, "next run id");
    const trustedRunMemory = readRecorderIssuedRunMemory(previousRunMemoryTokenValue);
    const record = captureValidatedRestoreRecord(trustedRunMemory);
    const preparedConsumption = prepareRouteConsumption(
      this.consumptionLedger,
      record,
      nextRunId,
    );

    // The system handoff itself is a V4 runtime60 transition. Requiring its
    // accepted start to be an even boundary avoids queueing input-off in the
    // future while exposing a prematurely advanced authority snapshot.
    const materialRehydrateTick120 = requestedStartTick120;
    const timing = deriveCrossRunRestoreTiming(record.routeDurationMs);
    const schedule = freezeSchedule({
      materialRehydrateTick120,
      ghostReplayBeginTick120: runtime60DeadlineTick(
        materialRehydrateTick120,
        timing.ghostReplayBeginAtMs,
      ),
      ghostReplayCompleteTick120: runtime60DeadlineTick(
        materialRehydrateTick120,
        timing.ghostReplayCompleteAtMs,
      ),
      ghostResidueWriteTick120: runtime60DeadlineTick(
        materialRehydrateTick120,
        timing.ghostResidueWriteAtMs,
      ),
      witnessTurnTick120: runtime60DeadlineTick(
        materialRehydrateTick120,
        timing.witnessTurnAtMs,
      ),
      inputReturnTick120: runtime60DeadlineTick(
        materialRehydrateTick120,
        timing.inputReturnAtMs,
      ),
    });

    const prefix = `cross-run:${record.runId}:${nextRunId}`;
    const identity = Object.freeze({fromRunId: record.runId, nextRunId});
    const routeIdentity = Object.freeze({
      ...identity,
      routeDigest: record.routeDigest,
      routeDurationMs: record.routeDurationMs,
    });
    const finalPoint = Object.freeze({
      tMs: record.finalPoint.tMs,
      xNorm: record.finalPoint.xNorm,
      yNorm: record.finalPoint.yNorm,
      room: record.finalPoint.room,
    });
    const ghostEndpoint = Object.freeze({
      room: record.finalPoint.room,
      xNorm: record.finalPoint.xNorm,
      yNorm: record.finalPoint.yNorm,
    });
    const initialDrafts = Object.freeze([
      this.draft("player.input.off", schedule.materialRehydrateTick120, 0, `${prefix}:input-off`, {
        reason: "cross-run-restore",
      }),
      this.draft("cross_run.restore.begin", schedule.materialRehydrateTick120, 1, `${prefix}:begin`, routeIdentity),
      this.draft("overrideScar.rehydrate", schedule.materialRehydrateTick120, 2, `${prefix}:override-scar-rehydrate`, {
        ...identity,
        recordType: "overrideScar",
        count: record.overrideScars.length,
        records: record.overrideScars,
      }),
      this.draft("deathTrace.rehydrate", schedule.materialRehydrateTick120, 3, `${prefix}:death-trace-rehydrate`, {
        ...identity,
        recordType: "deathTrace",
        count: record.deathTraces.length,
        records: record.deathTraces,
      }),
      this.draft("burnIn.rehydrate", schedule.materialRehydrateTick120, 4, `${prefix}:burn-in-rehydrate`, {
        ...identity,
        recordType: "burnIn",
        count: record.burnIns.length,
        records: record.burnIns,
      }),
    ]);
    const steps = Object.freeze([
      Object.freeze({
        dueTick120: schedule.ghostReplayBeginTick120,
        stateAfter: "replaying-ghost" as const,
        drafts: Object.freeze([this.draft(
          "ghost.replay.begin",
          schedule.ghostReplayBeginTick120,
          5,
          `${prefix}:ghost-replay-begin`,
          {
            ...routeIdentity,
            pointCount: record.routePoints.length,
            routePoints: record.routePoints,
            timeScale: 1,
            collisionClass: "NONE",
            rewardClass: "NONE",
            emitterClass: "NONE",
          },
        )]),
      }),
      Object.freeze({
        dueTick120: schedule.ghostReplayCompleteTick120,
        stateAfter: "materializing-residue" as const,
        drafts: Object.freeze([this.draft(
          "ghost.replay.complete",
          schedule.ghostReplayCompleteTick120,
          6,
          `${prefix}:ghost-replay-complete`,
          {...routeIdentity, finalPoint, burnAfterRead: true},
        )]),
      }),
      Object.freeze({
        dueTick120: schedule.ghostResidueWriteTick120,
        stateAfter: "waiting-witness" as const,
        drafts: Object.freeze([this.draft(
          "ghost.residue.write",
          schedule.ghostResidueWriteTick120,
          7,
          `${prefix}:ghost-residue-write`,
          {
            ...identity,
            recordType: "ghostResidue",
            residueId: `ghost-residue:${record.runId}:${nextRunId}`,
            sourceRouteDigest: record.routeDigest,
            createdAfterReplay: true,
            persistenceRuns: 1,
            position: ghostEndpoint,
            priorGhostResidueCount: record.ghostResidues.length,
          },
        )]),
      }),
      Object.freeze({
        dueTick120: schedule.witnessTurnTick120,
        stateAfter: "orienting-witnesses" as const,
        drafts: Object.freeze([this.draft(
          "witness.turn",
          schedule.witnessTurnTick120,
          8,
          `${prefix}:witness-turn`,
          {
            ...identity,
            evaluatedAfterGhostResidue: true,
            overrideScarIds: Object.freeze(record.overrideScars.map(({id}) => id)),
            ghostEndpoint,
            priority: WITNESS_PRIORITY,
          },
        )]),
      }),
      Object.freeze({
        dueTick120: schedule.inputReturnTick120,
        stateAfter: "ready" as const,
        drafts: Object.freeze([
          this.draft("returnInput", schedule.inputReturnTick120, 9, `${prefix}:return-input`, {
            ...identity,
            inputState: "enabled",
            routeDurationMs: record.routeDurationMs,
          }),
          this.draft("cross_run.restore.complete", schedule.inputReturnTick120, 10, `${prefix}:complete`, routeIdentity),
        ]),
      }),
    ] satisfies readonly ScheduledRestoreStep[]);
    if (steps.length > MAXIMUM_BOUNDARIES_PER_ADVANCE) {
      throw new Error("cross-run restore schedule exceeds the V4 boundary traversal limit");
    }
    const active = Object.freeze({
      requestedStartTick120,
      record,
      nextRunId,
      schedule,
      steps,
    });

    // Validate and claim the complete same-tick material batch before either
    // the replay ledger or authority state changes.
    CanonicalEventBus.prototype.enqueueBatch.call(this.bus, initialDrafts);
    commitRouteConsumption(this.consumptionLedger, preparedConsumption);
    this.tick120Value = schedule.materialRehydrateTick120;
    this.stateValue = "waiting-ghost";
    this.activeValue = active;
    this.inputWithheldValue = true;
    this.nextStepValue = 0;
    this.eventCountValue = initialDrafts.length;
    return this.snapshot();
  }

  advance(tick120Value: unknown): CrossRunRestoreAuthoritySnapshot {
    const tick120 = requireTick120(tick120Value, "cross-run restore advance tick120");
    const active = this.activeValue;
    if (active === null || this.stateValue === "idle") {
      throw new Error("cross-run restore cannot advance before begin");
    }
    if (this.tick120Value !== null && tick120 < this.tick120Value) {
      throw new Error(`cross-run restore cannot move backward from tick ${this.tick120Value} to ${tick120}`);
    }
    let nextStep = this.nextStepValue;
    let state = this.stateValue;
    let inputWithheld = this.inputWithheldValue;
    const drafts: GameplayEventDraft[] = [];
    let traversed = 0;
    while (nextStep < active.steps.length) {
      const step = active.steps[nextStep];
      if (step === undefined) throw new Error("cross-run restore schedule lost a step");
      if (tick120 < step.dueTick120) break;
      traversed += 1;
      if (traversed > MAXIMUM_BOUNDARIES_PER_ADVANCE) {
        throw new Error("cross-run restore advance exceeded the V4 boundary traversal limit");
      }
      drafts.push(...step.drafts);
      state = step.stateAfter;
      if (state === "ready") inputWithheld = false;
      nextStep += 1;
    }

    if (drafts.length > 0) {
      CanonicalEventBus.prototype.enqueueBatch.call(this.bus, drafts);
    }
    this.tick120Value = tick120;
    this.stateValue = state;
    this.inputWithheldValue = inputWithheld;
    this.nextStepValue = nextStep;
    this.eventCountValue += drafts.length;
    return this.snapshot();
  }

  snapshot(): CrossRunRestoreAuthoritySnapshot {
    const active = this.activeValue;
    return Object.freeze({
      authority: "v4-cross-run-restore",
      tick120: this.tick120Value,
      requestedStartTick120: active?.requestedStartTick120 ?? null,
      state: this.stateValue,
      fromRunId: active?.record.runId ?? null,
      nextRunId: active?.nextRunId ?? null,
      routeDigest: active?.record.routeDigest ?? null,
      routeDurationMs: active?.record.routeDurationMs ?? null,
      inputWithheld: this.inputWithheldValue,
      nextStep: this.nextStepValue,
      eventCount: this.eventCountValue,
      schedule: active?.schedule ?? null,
    });
  }

  private draft(
    id: string,
    tick120: number,
    localSequence: number,
    occurrenceKey: string,
    payload: unknown,
  ): GameplayEventDraft {
    return Object.freeze({
      id,
      tick120,
      entityStableId: AUTHORITY_ID,
      localSequence,
      occurrenceKey,
      payload,
    });
  }
}
