import {
  advanceCanonicalRunFirstContinuationNextOccurrenceMaterialHold,
  advanceCanonicalRunFirstContinuationSuccessorMaterialHold,
  commitPreparedCanonicalRunFirstContinuationNextOccurrenceAdmission,
  commitPreparedCanonicalRunFirstContinuationNextOccurrenceMaterialTransfer,
  commitPreparedCanonicalRunFirstContinuationSuccessorMaterialTransfer,
  inspectPreparedCanonicalRunFirstContinuationNextOccurrenceAdmission,
  inspectPreparedCanonicalRunFirstContinuationNextOccurrenceMaterialTransfer,
  inspectPreparedCanonicalRunFirstContinuationSuccessorMaterialTransfer,
  prepareCanonicalRunFirstContinuationNextOccurrenceAdmission,
  prepareCanonicalRunFirstContinuationNextOccurrenceMaterialTransfer,
  prepareCanonicalRunFirstContinuationSuccessorMaterialTransfer,
  type CanonicalCombatSnapshot,
  type CanonicalCombatStepInput,
  type CanonicalRoomThresholdMaterialCarryoverSnapshot,
  type CanonicalRunCombatStateSnapshot,
  type CanonicalRunFirstContinuationNextOccurrenceAdmissionWithheld,
  type CanonicalRunFirstContinuationNextOccurrenceDormantOwner,
  type CanonicalRunFirstContinuationNextOccurrenceDormantOwnerSnapshot,
  type CanonicalRunFirstContinuationNextOccurrenceMaterialCarryover,
  type CanonicalRunFirstContinuationNextOccurrenceMaterialCarryoverSnapshot,
  type CanonicalRunFirstContinuationSuccessorBoundaryTicks,
  type CanonicalRunOccurrenceMaterialCarryover,
  type CanonicalRunOccurrenceMaterialCarryoverSnapshot,
} from "../../combat-kernel";
import {
  inspectCanonicalRunFirstContinuationDormantSuccessorOwner,
  stepCanonicalRunFirstContinuationSuccessor,
  type CanonicalRunFirstContinuationDormantSuccessorOwner,
  type CanonicalRunFirstContinuationDormantSuccessorOwnerSnapshot,
} from "./first-continuation-room-admission-authority";
import type {CanonicalRunFirstContinuationNextOccurrencePlanPayload} from
  "./first-continuation-next-occurrence-plan";
import {
  inspectCanonicalRunFirstContinuationNextOccurrenceOwner,
  stepCanonicalRunFirstContinuationNextOccurrence,
} from "./first-continuation-next-occurrence";
import type {CanonicalRunFirstContinuationRoomPlanPayload} from
  "./first-continuation-room-plan";

const AUTHORITY = "canonical-run-first-continuation-room-progression-v1" as const;
const EXTENSION_POLICY = "EXT-2026-025" as const;

type ProgressMaterialSnapshot =
  | CanonicalRoomThresholdMaterialCarryoverSnapshot
  | CanonicalRunOccurrenceMaterialCarryoverSnapshot
  | CanonicalRunFirstContinuationNextOccurrenceMaterialCarryoverSnapshot;

type ProgressPlan =
  | CanonicalRunFirstContinuationRoomPlanPayload
  | CanonicalRunFirstContinuationNextOccurrencePlanPayload;

type ProgressCombinedPoolAdmission = Readonly<{
  readonly state: "committed";
  readonly evaluation:
    | CanonicalRunFirstContinuationDormantSuccessorOwnerSnapshot[
      "combinedPoolAdmission"
    ]["evaluation"]
    | CanonicalRunFirstContinuationNextOccurrenceDormantOwnerSnapshot[
      "combinedPoolAdmission"
    ]["evaluation"];
  readonly reservation?:
    CanonicalRunFirstContinuationDormantSuccessorOwnerSnapshot[
      "combinedPoolAdmission"
    ]["reservation"];
  readonly reservationCommitted: true;
  readonly canonicalEventWrites?: 0;
  readonly tickAdvance?: 0;
}>;

export type CanonicalRunFirstContinuationRoomProgressionStage =
  | "first-occurrence"
  | "first-material-withheld"
  | "second-occurrence"
  | "second-material";

export interface CanonicalRunFirstContinuationRoomProgressionSnapshot {
  readonly authority: typeof AUTHORITY;
  readonly extensionPolicy: typeof EXTENSION_POLICY;
  readonly stage: CanonicalRunFirstContinuationRoomProgressionStage;
  readonly phase:
    | CanonicalRunFirstContinuationDormantSuccessorOwnerSnapshot["phase"]
    | CanonicalRunFirstContinuationNextOccurrenceDormantOwnerSnapshot["authoredPhase"]
    | "material-hold";
  readonly tick120: number;
  readonly relativeTick120: number;
  readonly boundaryTicks120: Readonly<CanonicalRunFirstContinuationSuccessorBoundaryTicks>;
  readonly targetRoom: ProgressPlan["targetRoom"];
  readonly worldRoom: ProgressPlan["targetRoom"];
  readonly patternId: string;
  readonly occurrenceId: string;
  readonly difficulty: ProgressPlan["occurrence"]["difficulty"];
  readonly plan: ProgressPlan;
  readonly combinedPoolAdmission: ProgressCombinedPoolAdmission;
  readonly material: ProgressMaterialSnapshot;
  readonly runCombat: CanonicalRunCombatStateSnapshot;
  readonly canonicalEventCount: number;
  readonly combat: CanonicalCombatSnapshot | null;
  readonly targetVisible: false;
  readonly nextMasterTickAction:
    | CanonicalRunFirstContinuationDormantSuccessorOwnerSnapshot["nextMasterTickAction"]
    | CanonicalRunFirstContinuationNextOccurrenceDormantOwnerSnapshot["nextMasterTickAction"]
    | "advance-material-hold";
  readonly inputOwnership: Readonly<{
    readonly movement: "continued";
    readonly focus: "continued";
    readonly signal: "requested-unconsumed";
    readonly gazeInput: "requested-unconsumed";
    readonly flowerAuthority: "frozen";
    readonly gazeAuthority: "frozen";
    readonly override: "locked";
  }>;
  readonly roomCompletion: "withheld";
  readonly roomHandoff: "withheld";
  readonly admissionWithheld:
    CanonicalRunFirstContinuationNextOccurrenceAdmissionWithheld | null;
  readonly child:
    | Readonly<{
      readonly stage: "first-occurrence";
      readonly occurrence: CanonicalRunFirstContinuationDormantSuccessorOwnerSnapshot;
    }>
    | Readonly<{
      readonly stage: "first-material-withheld";
      readonly material: CanonicalRunOccurrenceMaterialCarryoverSnapshot;
      readonly admission: CanonicalRunFirstContinuationNextOccurrenceAdmissionWithheld;
    }>
    | Readonly<{
      readonly stage: "second-occurrence";
      readonly occurrence:
        CanonicalRunFirstContinuationNextOccurrenceDormantOwnerSnapshot;
    }>
    | Readonly<{
      readonly stage: "second-material";
      readonly material:
        CanonicalRunFirstContinuationNextOccurrenceMaterialCarryoverSnapshot;
    }>;
}

interface FirstIdentity {
  readonly plan: CanonicalRunFirstContinuationRoomPlanPayload;
  readonly boundaryTicks120: Readonly<CanonicalRunFirstContinuationSuccessorBoundaryTicks>;
  readonly combinedPoolAdmission:
    CanonicalRunFirstContinuationDormantSuccessorOwnerSnapshot["combinedPoolAdmission"];
}

interface SecondIdentity {
  readonly plan: CanonicalRunFirstContinuationNextOccurrencePlanPayload;
  readonly boundaryTicks120: Readonly<CanonicalRunFirstContinuationSuccessorBoundaryTicks>;
  readonly combinedPoolAdmission:
    CanonicalRunFirstContinuationNextOccurrenceDormantOwnerSnapshot["combinedPoolAdmission"];
}

type ProgressionState =
  | Readonly<{
    readonly stage: "first-occurrence";
    readonly owner: CanonicalRunFirstContinuationDormantSuccessorOwner;
  }>
  | Readonly<{
    readonly stage: "first-material-withheld";
    readonly owner: CanonicalRunOccurrenceMaterialCarryover;
    readonly admission: CanonicalRunFirstContinuationNextOccurrenceAdmissionWithheld;
  }>
  | Readonly<{
    readonly stage: "second-occurrence";
    readonly owner: CanonicalRunFirstContinuationNextOccurrenceDormantOwner;
    readonly identity: SecondIdentity;
  }>
  | Readonly<{
    readonly stage: "second-material";
    readonly owner: CanonicalRunFirstContinuationNextOccurrenceMaterialCarryover;
    readonly identity: SecondIdentity;
  }>;

interface ProgressionRecord {
  readonly first: FirstIdentity;
  state: ProgressionState;
  lastRunCombat: CanonicalRunCombatStateSnapshot;
  canonicalEventCount: number;
  stepping: boolean;
  fatalError: Error | null;
}

const PROGRESSION_RECORDS = new WeakMap<
  CanonicalRunFirstContinuationRoomProgression,
  ProgressionRecord
>();
const REGISTERED_FIRST_OWNERS = new WeakSet<
  CanonicalRunFirstContinuationDormantSuccessorOwner
>();
const CREATE_PROGRESSION = Symbol("create-first-continuation-room-progression");

const INPUT_OWNERSHIP = Object.freeze({
  movement: "continued" as const,
  focus: "continued" as const,
  signal: "requested-unconsumed" as const,
  gazeInput: "requested-unconsumed" as const,
  flowerAuthority: "frozen" as const,
  gazeAuthority: "frozen" as const,
  override: "locked" as const,
});

function requireProgression(
  progression: CanonicalRunFirstContinuationRoomProgression,
): ProgressionRecord {
  if (
    typeof progression !== "object"
    || progression === null
    || Object.getPrototypeOf(progression)
      !== CanonicalRunFirstContinuationRoomProgression.prototype
  ) {
    throw new Error("first continuation room progression must be exact");
  }
  const record = PROGRESSION_RECORDS.get(progression);
  if (record === undefined) {
    throw new Error("first continuation room progression is not registered");
  }
  if (record.fatalError !== null) {
    throw new Error(
      `first continuation room progression is faulted: ${record.fatalError.message}`,
      {cause: record.fatalError},
    );
  }
  return record;
}

function freezeFirstIdentity(
  snapshot: CanonicalRunFirstContinuationDormantSuccessorOwnerSnapshot,
): FirstIdentity {
  return Object.freeze({
    plan: snapshot.plan,
    boundaryTicks120: snapshot.boundaryTicks120,
    combinedPoolAdmission: snapshot.combinedPoolAdmission,
  });
}

function freezeSecondIdentity(
  snapshot: CanonicalRunFirstContinuationNextOccurrenceDormantOwnerSnapshot,
): SecondIdentity {
  return Object.freeze({
    plan: snapshot.plan,
    boundaryTicks120: snapshot.boundaryTicks120,
    combinedPoolAdmission: snapshot.combinedPoolAdmission,
  });
}

function sameOccurrenceClaims(
  left: CanonicalRunCombatStateSnapshot,
  right: CanonicalRunCombatStateSnapshot,
): boolean {
  return left.claimedOccurrenceIds.length === right.claimedOccurrenceIds.length
    && left.claimedOccurrenceIds.every((occurrenceId, index) =>
      occurrenceId === right.claimedOccurrenceIds[index]);
}

function firstOccurrenceSnapshot(
  record: ProgressionRecord,
  occurrence: CanonicalRunFirstContinuationDormantSuccessorOwnerSnapshot,
): CanonicalRunFirstContinuationRoomProgressionSnapshot {
  if (
    occurrence.runCombat.tick120 !== occurrence.tick120
    || occurrence.canonicalEventCount !== record.canonicalEventCount
  ) {
    throw new Error("first continuation first occurrence lost progression synchronization");
  }
  return Object.freeze({
    authority: AUTHORITY,
    extensionPolicy: EXTENSION_POLICY,
    stage: "first-occurrence" as const,
    phase: occurrence.phase,
    tick120: occurrence.tick120,
    relativeTick120: occurrence.relativeTick120,
    boundaryTicks120: occurrence.boundaryTicks120,
    targetRoom: occurrence.targetRoom,
    worldRoom: occurrence.worldRoom,
    patternId: occurrence.patternId,
    occurrenceId: occurrence.occurrenceId,
    difficulty: occurrence.difficulty,
    plan: occurrence.plan,
    combinedPoolAdmission: occurrence.combinedPoolAdmission,
    material: occurrence.material,
    runCombat: occurrence.runCombat,
    canonicalEventCount: occurrence.canonicalEventCount,
    combat: occurrence.combat,
    targetVisible: false as const,
    nextMasterTickAction: occurrence.nextMasterTickAction,
    inputOwnership: INPUT_OWNERSHIP,
    roomCompletion: "withheld" as const,
    roomHandoff: "withheld" as const,
    admissionWithheld: null,
    child: Object.freeze({
      stage: "first-occurrence" as const,
      occurrence,
    }),
  });
}

function firstMaterialWithheldSnapshot(
  record: ProgressionRecord,
  state: Extract<ProgressionState, {readonly stage: "first-material-withheld"}>,
): CanonicalRunFirstContinuationRoomProgressionSnapshot {
  const material = state.owner.snapshot();
  const plan = record.first.plan;
  if (
    material.tick120 !== record.lastRunCombat.tick120
    || material.sourcePatternId !== plan.occurrence.patternId
    || material.sourceOccurrenceId !== plan.occurrence.occurrenceId
    || state.admission.materialOwnerConsumed
  ) {
    throw new Error("withheld second occurrence lost its first material owner");
  }
  return Object.freeze({
    authority: AUTHORITY,
    extensionPolicy: EXTENSION_POLICY,
    stage: "first-material-withheld" as const,
    phase: "material-hold" as const,
    tick120: material.tick120,
    relativeTick120: material.tick120 - record.first.boundaryTicks120.handoffTick120,
    boundaryTicks120: record.first.boundaryTicks120,
    targetRoom: plan.targetRoom,
    worldRoom: plan.targetRoom,
    patternId: material.sourcePatternId,
    occurrenceId: material.sourceOccurrenceId,
    difficulty: plan.occurrence.difficulty,
    plan,
    combinedPoolAdmission: record.first.combinedPoolAdmission,
    material,
    runCombat: record.lastRunCombat,
    canonicalEventCount: record.canonicalEventCount,
    combat: null,
    targetVisible: false as const,
    nextMasterTickAction: "advance-material-hold" as const,
    inputOwnership: INPUT_OWNERSHIP,
    roomCompletion: "withheld" as const,
    roomHandoff: "withheld" as const,
    admissionWithheld: state.admission,
    child: Object.freeze({
      stage: "first-material-withheld" as const,
      material,
      admission: state.admission,
    }),
  });
}

function secondOccurrenceSnapshot(
  record: ProgressionRecord,
  state: Extract<ProgressionState, {readonly stage: "second-occurrence"}>,
): CanonicalRunFirstContinuationRoomProgressionSnapshot {
  const occurrence = inspectCanonicalRunFirstContinuationNextOccurrenceOwner(state.owner);
  const plan = state.identity.plan;
  if (
    occurrence.plan !== plan
    || occurrence.tick120 !== occurrence.runCombat.tick120
    || occurrence.canonicalEventCount !== record.canonicalEventCount
  ) {
    throw new Error("second occurrence lost progression synchronization");
  }
  return Object.freeze({
    authority: AUTHORITY,
    extensionPolicy: EXTENSION_POLICY,
    stage: "second-occurrence" as const,
    phase: occurrence.authoredPhase,
    tick120: occurrence.tick120,
    relativeTick120: occurrence.relativeTick120,
    boundaryTicks120: occurrence.boundaryTicks120,
    targetRoom: plan.targetRoom,
    worldRoom: plan.targetRoom,
    patternId: plan.occurrence.patternId,
    occurrenceId: plan.occurrence.occurrenceId,
    difficulty: plan.occurrence.difficulty,
    plan,
    combinedPoolAdmission: occurrence.combinedPoolAdmission,
    material: occurrence.material,
    runCombat: occurrence.runCombat,
    canonicalEventCount: occurrence.canonicalEventCount,
    combat: occurrence.combat,
    targetVisible: false as const,
    nextMasterTickAction: occurrence.nextMasterTickAction,
    inputOwnership: INPUT_OWNERSHIP,
    roomCompletion: occurrence.roomCompletion,
    roomHandoff: occurrence.roomHandoff,
    admissionWithheld: null,
    child: Object.freeze({
      stage: "second-occurrence" as const,
      occurrence,
    }),
  });
}

function secondMaterialSnapshot(
  record: ProgressionRecord,
  state: Extract<ProgressionState, {readonly stage: "second-material"}>,
): CanonicalRunFirstContinuationRoomProgressionSnapshot {
  const material = state.owner.snapshot();
  const plan = state.identity.plan;
  if (
    material.tick120 !== record.lastRunCombat.tick120
    || material.sourcePatternId !== plan.occurrence.patternId
    || material.sourceOccurrenceId !== plan.occurrence.occurrenceId
  ) {
    throw new Error("second occurrence material lost progression synchronization");
  }
  return Object.freeze({
    authority: AUTHORITY,
    extensionPolicy: EXTENSION_POLICY,
    stage: "second-material" as const,
    phase: "material-hold" as const,
    tick120: material.tick120,
    relativeTick120: material.tick120 - state.identity.boundaryTicks120.handoffTick120,
    boundaryTicks120: state.identity.boundaryTicks120,
    targetRoom: plan.targetRoom,
    worldRoom: plan.targetRoom,
    patternId: material.sourcePatternId,
    occurrenceId: material.sourceOccurrenceId,
    difficulty: plan.occurrence.difficulty,
    plan,
    combinedPoolAdmission: state.identity.combinedPoolAdmission,
    material,
    runCombat: record.lastRunCombat,
    canonicalEventCount: record.canonicalEventCount,
    combat: null,
    targetVisible: false as const,
    nextMasterTickAction: "advance-material-hold" as const,
    inputOwnership: INPUT_OWNERSHIP,
    roomCompletion: material.roomCompletion,
    roomHandoff: material.roomHandoff,
    admissionWithheld: null,
    child: Object.freeze({
      stage: "second-material" as const,
      material,
    }),
  });
}

function inspectRecord(record: ProgressionRecord): CanonicalRunFirstContinuationRoomProgressionSnapshot {
  switch (record.state.stage) {
    case "first-occurrence":
      return firstOccurrenceSnapshot(
        record,
        inspectCanonicalRunFirstContinuationDormantSuccessorOwner(record.state.owner),
      );
    case "first-material-withheld":
      return firstMaterialWithheldSnapshot(record, record.state);
    case "second-occurrence":
      return secondOccurrenceSnapshot(record, record.state);
    case "second-material":
      return secondMaterialSnapshot(record, record.state);
  }
}

function transferFirstOccurrence(
  record: ProgressionRecord,
  owner: CanonicalRunFirstContinuationDormantSuccessorOwner,
  complete: CanonicalRunFirstContinuationDormantSuccessorOwnerSnapshot,
): void {
  if (
    complete.phase !== "complete"
    || complete.nextMasterTickAction !== "advance-complete-hold"
    || complete.tick120 !== complete.boundaryTicks120.sliceCompleteTick120
  ) {
    throw new Error("first continuation progression requires the exact first slice close");
  }
  const transfer = prepareCanonicalRunFirstContinuationSuccessorMaterialTransfer(owner);
  const transferView = inspectPreparedCanonicalRunFirstContinuationSuccessorMaterialTransfer(
    transfer,
  );
  if (
    transferView.tick120 !== complete.tick120
    || transferView.canonicalEventWrites !== 0
    || transferView.rngCallsConsumedByTransfer !== 0
    || transferView.tickAdvance !== 0
  ) {
    throw new Error("first occurrence material transfer changed the flushed boundary");
  }
  const materialOwner = commitPreparedCanonicalRunFirstContinuationSuccessorMaterialTransfer(
    transfer,
  );
  const material = materialOwner.snapshot();
  if (
    material.tick120 !== complete.tick120
    || material.sourcePatternId !== complete.patternId
    || material.sourceOccurrenceId !== complete.occurrenceId
    || material.rngCallsConsumed !== complete.combat?.rngCallsConsumed
  ) {
    throw new Error("first occurrence material transfer lost its exact source");
  }
  const admission = prepareCanonicalRunFirstContinuationNextOccurrenceAdmission(
    materialOwner,
  );
  if (admission.state === "withheld") {
    if (
      admission.material.tick120 !== complete.tick120
      || admission.materialOwnerConsumed
      || admission.canonicalEventWrites !== 0
      || admission.authorityMutations !== 0
    ) {
      throw new Error("withheld second occurrence mutated the material boundary");
    }
    record.state = Object.freeze({
      stage: "first-material-withheld" as const,
      owner: materialOwner,
      admission,
    });
    record.lastRunCombat = complete.runCombat;
    return;
  }
  const admissionView = inspectPreparedCanonicalRunFirstContinuationNextOccurrenceAdmission(
    admission.proposal,
  );
  if (
    admissionView.preparedAtTick120 !== complete.tick120
    || admissionView.canonicalEventWrites !== 0
    || admissionView.occurrenceClaimWrites !== 0
    || admissionView.tickAdvance !== 0
  ) {
    throw new Error("second occurrence admission changed the flushed boundary");
  }
  const nextOwner = commitPreparedCanonicalRunFirstContinuationNextOccurrenceAdmission(
    admission.proposal,
  );
  const next = inspectCanonicalRunFirstContinuationNextOccurrenceOwner(nextOwner);
  if (
    next.phase !== "dormant"
    || next.nextMasterTickAction !== "telegraph"
    || next.tick120 !== complete.tick120
    || next.runCombat.tick120 !== complete.tick120
    || next.canonicalEventCount !== complete.canonicalEventCount
    || !sameOccurrenceClaims(next.runCombat, complete.runCombat)
  ) {
    throw new Error("second occurrence admission lost its zero-tick dormant boundary");
  }
  record.state = Object.freeze({
    stage: "second-occurrence" as const,
    owner: nextOwner,
    identity: freezeSecondIdentity(next),
  });
  record.lastRunCombat = next.runCombat;
  record.canonicalEventCount = next.canonicalEventCount;
}

function transferSecondOccurrence(
  record: ProgressionRecord,
  owner: CanonicalRunFirstContinuationNextOccurrenceDormantOwner,
  complete: CanonicalRunFirstContinuationNextOccurrenceDormantOwnerSnapshot,
  identity: SecondIdentity,
): void {
  if (
    complete.phase !== "complete"
    || complete.nextMasterTickAction !== "transfer-material"
    || complete.tick120 !== complete.boundaryTicks120.sliceCompleteTick120
  ) {
    throw new Error("first continuation progression requires the exact second slice close");
  }
  const transfer = prepareCanonicalRunFirstContinuationNextOccurrenceMaterialTransfer(owner);
  const view = inspectPreparedCanonicalRunFirstContinuationNextOccurrenceMaterialTransfer(
    transfer,
  );
  if (
    view.tick120 !== complete.tick120
    || view.canonicalEventWrites !== 0
    || view.rngCallsConsumedByTransfer !== 0
    || view.tickAdvance !== 0
  ) {
    throw new Error("second occurrence material transfer changed the flushed boundary");
  }
  const materialOwner =
    commitPreparedCanonicalRunFirstContinuationNextOccurrenceMaterialTransfer(transfer);
  const material = materialOwner.snapshot();
  if (
    material.tick120 !== complete.tick120
    || material.sourcePatternId !== complete.plan.occurrence.patternId
    || material.sourceOccurrenceId !== complete.plan.occurrence.occurrenceId
    || material.rngCallsConsumed !== complete.combat?.rngCallsConsumed
  ) {
    throw new Error("second occurrence material transfer lost its exact source");
  }
  record.state = Object.freeze({
    stage: "second-material" as const,
    owner: materialOwner,
    identity,
  });
  record.lastRunCombat = complete.runCombat;
  record.canonicalEventCount = complete.canonicalEventCount;
}

export class CanonicalRunFirstContinuationRoomProgression {
  constructor(
    firstOwner: CanonicalRunFirstContinuationDormantSuccessorOwner,
    creationToken?: symbol,
  ) {
    if (creationToken !== CREATE_PROGRESSION) {
      throw new Error("first continuation room progression requires a registered first owner");
    }
    const first = inspectCanonicalRunFirstContinuationDormantSuccessorOwner(firstOwner);
    if (
      REGISTERED_FIRST_OWNERS.has(firstOwner)
      || first.phase !== "dormant"
      || first.relativeTick120 !== 0
      || first.nextMasterTickAction !== "telegraph"
      || first.combat !== null
    ) {
      throw new Error("first continuation room progression requires the original dormant owner");
    }
    REGISTERED_FIRST_OWNERS.add(firstOwner);
    PROGRESSION_RECORDS.set(this, {
      first: freezeFirstIdentity(first),
      state: Object.freeze({stage: "first-occurrence" as const, owner: firstOwner}),
      lastRunCombat: first.runCombat,
      canonicalEventCount: first.canonicalEventCount,
      stepping: false,
      fatalError: null,
    });
    Object.freeze(this);
  }

  snapshot(): CanonicalRunFirstContinuationRoomProgressionSnapshot {
    return inspectRecord(requireProgression(this));
  }

  step(input: CanonicalCombatStepInput): CanonicalRunFirstContinuationRoomProgressionSnapshot {
    const record = requireProgression(this);
    if (record.stepping) {
      throw new Error("first continuation room progression step is already active");
    }
    record.stepping = true;
    let authoritativeTickAccepted = false;
    try {
      switch (record.state.stage) {
        case "first-occurrence": {
          const owner = record.state.owner;
          const occurrence = stepCanonicalRunFirstContinuationSuccessor(owner, input);
          authoritativeTickAccepted = true;
          record.lastRunCombat = occurrence.runCombat;
          record.canonicalEventCount = occurrence.canonicalEventCount;
          if (occurrence.nextMasterTickAction === "advance-complete-hold") {
            transferFirstOccurrence(record, owner, occurrence);
          }
          break;
        }
        case "first-material-withheld": {
          const result = advanceCanonicalRunFirstContinuationSuccessorMaterialHold(
            record.state.owner,
            input,
          );
          authoritativeTickAccepted = true;
          record.lastRunCombat = result.runCombat;
          record.canonicalEventCount += result.flushedEvents.length;
          break;
        }
        case "second-occurrence": {
          const {owner, identity} = record.state;
          const occurrence = stepCanonicalRunFirstContinuationNextOccurrence(owner, input);
          authoritativeTickAccepted = true;
          record.lastRunCombat = occurrence.runCombat;
          record.canonicalEventCount = occurrence.canonicalEventCount;
          if (occurrence.nextMasterTickAction === "transfer-material") {
            transferSecondOccurrence(record, owner, occurrence, identity);
          }
          break;
        }
        case "second-material": {
          const result = advanceCanonicalRunFirstContinuationNextOccurrenceMaterialHold(
            record.state.owner,
            input,
          );
          authoritativeTickAccepted = true;
          record.lastRunCombat = result.runCombat;
          record.canonicalEventCount += result.flushedEvents.length;
          break;
        }
      }
      const snapshot = inspectRecord(record);
      if (
        snapshot.tick120 !== input.tick120
        || snapshot.runCombat.tick120 !== input.tick120
        || snapshot.runCombat.pendingFlushTick120 !== null
      ) {
        throw new Error("first continuation room progression did not close one exact tick");
      }
      return snapshot;
    } catch (error) {
      if (authoritativeTickAccepted || record.lastRunCombat.faulted) {
        record.fatalError = error instanceof Error ? error : new Error(String(error));
      }
      throw error;
    } finally {
      record.stepping = false;
    }
  }
}

export function registerCanonicalRunFirstContinuationRoomProgression(
  firstOwner: CanonicalRunFirstContinuationDormantSuccessorOwner,
): CanonicalRunFirstContinuationRoomProgression {
  return new CanonicalRunFirstContinuationRoomProgression(firstOwner, CREATE_PROGRESSION);
}
