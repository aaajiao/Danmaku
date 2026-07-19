import {
  CanonicalRoomThresholdMaterialCarryover,
  CanonicalRunCombatState,
  bindCanonicalRunFirstContinuationDormantSuccessorTransferCapability,
  cancelPreparedCanonicalRunFirstContinuationDormantSuccessorTransfer,
  commitPreparedCanonicalRunFirstContinuationDormantSuccessorTransfer,
  inspectPreparedCanonicalRunFirstContinuationDormantSuccessorTransfer,
  prepareCanonicalRunFirstContinuationDormantSuccessorTransfer,
  type CanonicalRunFirstContinuationDormantSuccessorTransferCapability,
  type PreparedCanonicalRunFirstContinuationDormantSuccessorTransfer,
} from "../../combat-kernel";
import {isExactCanonicalEventBus, type CanonicalEventBus} from "../../events";
import {
  isExactRoomTransitionAuthority,
  type RoomTransitionAuthority,
} from "../../room-transition";
import type {CanonicalRunFirstContinuationRoomTargetAvailable} from
  "../../run-first-continuation-room-target";
import {
  evaluateCanonicalRunFirstContinuationCombinedPoolAdmissionUnbranded,
  type CanonicalRunFirstContinuationCombinedPoolAdmissionEvaluation,
} from "./first-continuation-room-admission";
import {
  deriveCanonicalRunFirstContinuationRoomPlanUnbranded,
  type CanonicalRunFirstContinuationRoomPlanPayload,
  type CanonicalRunFirstContinuationRoomPlanSourceView,
} from "./first-continuation-room-plan";
import {deriveCanonicalRunFirstContinuationRoomPlanSourceUnbranded} from
  "./first-continuation-room-plan-source";
import {registerCanonicalRunFirstContinuationSuccessorOwner} from
  "./first-continuation-room-successor";

export {
  advanceCanonicalRunFirstContinuationSuccessorCompleteHold,
  advanceCanonicalRunFirstContinuationSuccessorPreRead,
  advanceCanonicalRunFirstContinuationSuccessorRead,
  advanceCanonicalRunFirstContinuationSuccessorTail,
  closeCanonicalRunFirstContinuationSuccessorSlice,
  inspectCanonicalRunFirstContinuationDormantSuccessorOwner,
  startCanonicalRunFirstContinuationSuccessorRead,
  type CanonicalRunFirstContinuationDormantSuccessorOwnerSnapshot,
  type CanonicalRunFirstContinuationSuccessorPreReadPhase,
} from "./first-continuation-room-successor";

const NEXT_ROOM_ADMISSION =
  "withheld-pending-room-plan-and-combined-pool-budget" as const;
const HANDOFF_AUTHORITY = "canonical-run-first-continuation-room-handoff-v1" as const;
const PROPOSAL_AUTHORITY = "canonical-run-first-continuation-room-admission-proposal-v1" as const;
const EXTENSION_POLICY = "EXT-2026-015" as const;

declare const canonicalRunFirstContinuationRoomHandoffReceiptBrand: unique symbol;

export type CanonicalRunFirstContinuationRoomHandoffReceipt = Readonly<{
  readonly [canonicalRunFirstContinuationRoomHandoffReceiptBrand]: true;
}>;

export interface CanonicalRunFirstContinuationRoomHandoffReceiptView {
  readonly authority: typeof HANDOFF_AUTHORITY;
  readonly extensionPolicy: "EXT-2026-013";
  readonly targetRoom: CanonicalRunFirstContinuationRoomPlanPayload["targetRoom"];
  readonly atTick120: number;
  readonly nextRoomAdmission: typeof NEXT_ROOM_ADMISSION;
}

export interface CanonicalRunFirstContinuationRoomHandoffRegistration {
  readonly owner: object;
  readonly formalTarget: CanonicalRunFirstContinuationRoomTargetAvailable;
  readonly runState: CanonicalRunCombatState;
  readonly eventBus: CanonicalEventBus;
  readonly roomTransition: RoomTransitionAuthority;
  readonly carryover: CanonicalRoomThresholdMaterialCarryover;
  readonly successorTransferCapability:
    CanonicalRunFirstContinuationDormantSuccessorTransferCapability;
  readonly view: CanonicalRunFirstContinuationRoomHandoffReceiptView;
  readonly validateLineage: (
    receipt: CanonicalRunFirstContinuationRoomHandoffReceipt,
  ) => void;
}

type HandoffStatus = "available" | "committed";

interface HandoffRecord {
  readonly owner: object;
  readonly formalTarget: CanonicalRunFirstContinuationRoomTargetAvailable;
  readonly runState: CanonicalRunCombatState;
  readonly eventBus: CanonicalEventBus;
  readonly roomTransition: RoomTransitionAuthority;
  readonly carryover: CanonicalRoomThresholdMaterialCarryover;
  readonly successorTransferCapability:
    CanonicalRunFirstContinuationDormantSuccessorTransferCapability;
  readonly view: CanonicalRunFirstContinuationRoomHandoffReceiptView;
  readonly validateLineage: CanonicalRunFirstContinuationRoomHandoffRegistration["validateLineage"];
  status: HandoffStatus;
  activeProposal: PreparedCanonicalRunFirstContinuationRoomAdmission | null;
}

const HANDOFF_RECORDS = new WeakMap<
  CanonicalRunFirstContinuationRoomHandoffReceipt,
  HandoffRecord
>();
const HANDOFF_RECEIPT_BY_OWNER = new WeakMap<
  object,
  CanonicalRunFirstContinuationRoomHandoffReceipt
>();

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`first continuation room admission ${message}`);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requireHandoff(
  receipt: CanonicalRunFirstContinuationRoomHandoffReceipt,
): HandoffRecord {
  invariant(
    typeof receipt === "object" && receipt !== null,
    "handoff receipt must be opaque",
  );
  const record = HANDOFF_RECORDS.get(receipt);
  invariant(record !== undefined, "handoff receipt is not registered");
  record.validateLineage(receipt);
  invariant(
    HANDOFF_RECEIPT_BY_OWNER.get(record.owner) === receipt,
    "handoff receipt lost its exact owner reservation",
  );
  return record;
}

/** Transition-only minting port; live authorities remain sealed in this module. */
export function registerCanonicalRunFirstContinuationRoomHandoffReceipt(
  registration: CanonicalRunFirstContinuationRoomHandoffRegistration,
): CanonicalRunFirstContinuationRoomHandoffReceipt {
  invariant(
    typeof registration.owner === "object"
      && registration.owner !== null
      && !HANDOFF_RECEIPT_BY_OWNER.has(registration.owner),
    "transition owner already registered a handoff",
  );
  invariant(
    typeof registration.validateLineage === "function",
    "handoff registration requires its sealed lineage validator",
  );
  const run = registration.runState.snapshot();
  const material = registration.carryover.snapshot();
  const room = registration.roomTransition.snapshot();
  const view = registration.view;
  invariant(
    Object.isFrozen(view)
      && view.authority === HANDOFF_AUTHORITY
      && view.extensionPolicy === "EXT-2026-013"
      && view.nextRoomAdmission === NEXT_ROOM_ADMISSION
      && view.targetRoom === registration.formalTarget.targetRoom
      && view.atTick120 === run.tick120
      && material.tick120 === run.tick120
      && material.poolUsage.liveColliders === 0
      && room.tick120 === run.tick120
      && room.state === "idle"
      && room.currentRoom === view.targetRoom
      && room.targetRoom === null
      && room.active === null
      && isExactCanonicalEventBus(registration.eventBus)
      && isExactRoomTransitionAuthority(registration.roomTransition)
      && registration.eventBus.pendingEventCount() === 0
      && run.activeOccurrenceId === null
      && run.pendingFlushTick120 === null
      && run.faulted === false
      && run.player.state === "alive"
      && run.player.collisionEnabled === true
      && run.player.activeLeases.length === 0
      && run.player.recoveryAtTick120 === null
      && run.player.respawnPlaceAtTick120 === null
      && run.player.respawnCompleteAtTick120 === null
      && run.override.state === "idle"
      && run.override.deadlineTick120 === null
      && run.override.localVoid === null,
    "handoff registration is not the exact flushed alive material boundary",
  );
  const receipt = Object.freeze({}) as CanonicalRunFirstContinuationRoomHandoffReceipt;
  bindCanonicalRunFirstContinuationDormantSuccessorTransferCapability(
    registration.successorTransferCapability,
    registration.formalTarget,
    registration.runState,
    registration.eventBus,
    registration.roomTransition,
    registration.carryover,
    receipt,
  );
  HANDOFF_RECORDS.set(receipt, {
    owner: registration.owner,
    formalTarget: registration.formalTarget,
    runState: registration.runState,
    eventBus: registration.eventBus,
    roomTransition: registration.roomTransition,
    carryover: registration.carryover,
    successorTransferCapability: registration.successorTransferCapability,
    view,
    validateLineage: registration.validateLineage,
    status: "available",
    activeProposal: null,
  });
  HANDOFF_RECEIPT_BY_OWNER.set(registration.owner, receipt);
  return receipt;
}

export function inspectCanonicalRunFirstContinuationRoomHandoffReceipt(
  receipt: CanonicalRunFirstContinuationRoomHandoffReceipt,
): CanonicalRunFirstContinuationRoomHandoffReceiptView {
  return requireHandoff(receipt).view;
}

export function canonicalRunFirstContinuationRoomHandoffWasCommitted(
  receipt: CanonicalRunFirstContinuationRoomHandoffReceipt,
): boolean {
  return requireHandoff(receipt).status === "committed";
}

function sourceFromExactHandoff(
  record: HandoffRecord,
): CanonicalRunFirstContinuationRoomPlanSourceView {
  invariant(record.status === "available", "handoff receipt was already committed");
  const run = record.runState.snapshot();
  const material = record.carryover.snapshot();
  const room = record.roomTransition.snapshot();
  invariant(
    run.tick120 === record.view.atTick120
      && material.tick120 === record.view.atTick120
      && material.poolUsage.liveColliders === 0
      && room.tick120 === record.view.atTick120
      && room.currentRoom === record.view.targetRoom
      && room.state === "idle"
      && room.active === null
      && record.eventBus.pendingEventCount() === 0,
    "handoff material summary is stale or no longer flushed",
  );
  return deriveCanonicalRunFirstContinuationRoomPlanSourceUnbranded(
    record.formalTarget,
    record.view,
    material,
  );
}

declare const preparedRoomAdmissionBrand: unique symbol;

export type PreparedCanonicalRunFirstContinuationRoomAdmission = Readonly<{
  readonly [preparedRoomAdmissionBrand]: true;
}>;

export interface CanonicalRunFirstContinuationRoomAdmissionProposalView {
  readonly authority: typeof PROPOSAL_AUTHORITY;
  readonly extensionPolicy: typeof EXTENSION_POLICY;
  readonly state: "prepared";
  readonly preparedAtTick120: number;
  readonly handoff: CanonicalRunFirstContinuationRoomHandoffReceiptView;
  readonly plan: CanonicalRunFirstContinuationRoomPlanPayload;
  readonly combinedPoolAdmission: CanonicalRunFirstContinuationCombinedPoolAdmissionEvaluation;
  readonly transfer: ReturnType<
    typeof inspectPreparedCanonicalRunFirstContinuationDormantSuccessorTransfer
  >;
  readonly canonicalEventWrites: 0;
  readonly tickAdvance: 0;
}

export interface CanonicalRunFirstContinuationRoomAdmissionWithheld {
  readonly authority: typeof PROPOSAL_AUTHORITY;
  readonly extensionPolicy: typeof EXTENSION_POLICY;
  readonly state: "withheld";
  readonly reason: Exclude<
    CanonicalRunFirstContinuationCombinedPoolAdmissionEvaluation["state"],
    "admissible"
  >;
  readonly handoff: CanonicalRunFirstContinuationRoomHandoffReceiptView;
  readonly plan: CanonicalRunFirstContinuationRoomPlanPayload;
  readonly combinedPoolAdmission: CanonicalRunFirstContinuationCombinedPoolAdmissionEvaluation;
  readonly handoffConsumed: false;
  readonly canonicalEventWrites: 0;
  readonly authorityMutations: 0;
}

export type CanonicalRunFirstContinuationRoomAdmissionPreparation =
  | Readonly<{
    readonly state: "prepared";
    readonly proposal: PreparedCanonicalRunFirstContinuationRoomAdmission;
    readonly view: CanonicalRunFirstContinuationRoomAdmissionProposalView;
  }>
  | CanonicalRunFirstContinuationRoomAdmissionWithheld;

type AdmissionProposalStatus = "prepared" | "committed" | "cancelled" | "failed";

interface AdmissionProposalRecord {
  readonly handoffReceipt: CanonicalRunFirstContinuationRoomHandoffReceipt;
  readonly handoff: HandoffRecord;
  readonly source: CanonicalRunFirstContinuationRoomPlanSourceView;
  readonly plan: CanonicalRunFirstContinuationRoomPlanPayload;
  readonly evaluation: CanonicalRunFirstContinuationCombinedPoolAdmissionEvaluation;
  readonly successorOwner: CanonicalRunFirstContinuationDormantSuccessorOwner;
  readonly kernelProposal: PreparedCanonicalRunFirstContinuationDormantSuccessorTransfer;
  readonly view: CanonicalRunFirstContinuationRoomAdmissionProposalView;
  status: AdmissionProposalStatus;
}

const ADMISSION_PROPOSALS = new WeakMap<
  PreparedCanonicalRunFirstContinuationRoomAdmission,
  AdmissionProposalRecord
>();

function requireAdmissionProposal(
  proposal: PreparedCanonicalRunFirstContinuationRoomAdmission,
): AdmissionProposalRecord {
  invariant(typeof proposal === "object" && proposal !== null, "proposal must be opaque");
  const record = ADMISSION_PROPOSALS.get(proposal);
  invariant(record !== undefined, "proposal is not registered");
  invariant(record.status === "prepared", `proposal is ${record.status}`);
  invariant(record.handoff.activeProposal === proposal, "proposal lost its handoff reservation");
  return record;
}

declare const dormantSuccessorOwnerBrand: unique symbol;

export type CanonicalRunFirstContinuationDormantSuccessorOwner = Readonly<{
  readonly [dormantSuccessorOwnerBrand]: true;
}>;

export function prepareCanonicalRunFirstContinuationRoomAdmission(
  handoffReceipt: CanonicalRunFirstContinuationRoomHandoffReceipt,
): CanonicalRunFirstContinuationRoomAdmissionPreparation {
  const handoff = requireHandoff(handoffReceipt);
  invariant(handoff.status === "available", "handoff receipt was already committed");
  invariant(handoff.activeProposal === null, "handoff already has an in-flight admission proposal");
  const source = sourceFromExactHandoff(handoff);
  const plan = deriveCanonicalRunFirstContinuationRoomPlanUnbranded(source);
  const evaluation = evaluateCanonicalRunFirstContinuationCombinedPoolAdmissionUnbranded(
    plan,
    handoff.runState.snapshot().adapterPolicy.projectilePoolClasses,
  );
  if (!evaluation.admissible) {
    invariant(evaluation.state !== "admissible", "withheld evaluation lost its reason");
    return Object.freeze({
      authority: PROPOSAL_AUTHORITY,
      extensionPolicy: EXTENSION_POLICY,
      state: "withheld" as const,
      reason: evaluation.state,
      handoff: handoff.view,
      plan,
      combinedPoolAdmission: evaluation,
      handoffConsumed: false as const,
      canonicalEventWrites: 0 as const,
      authorityMutations: 0 as const,
    });
  }
  const successorOwner = Object.freeze({}) as
    CanonicalRunFirstContinuationDormantSuccessorOwner;
  const kernelProposal = prepareCanonicalRunFirstContinuationDormantSuccessorTransfer(
    handoff.successorTransferCapability,
    handoffReceipt,
    handoff.runState,
    handoff.eventBus,
    handoff.carryover,
    successorOwner,
  );
  const transfer = inspectPreparedCanonicalRunFirstContinuationDormantSuccessorTransfer(
    kernelProposal,
  );
  try {
    invariant(
      sameJson(transfer.plan, plan)
        && sameJson(transfer.combinedPoolAdmission, evaluation),
      "kernel proof diverged from the formal admission",
    );
  } catch (error) {
    cancelPreparedCanonicalRunFirstContinuationDormantSuccessorTransfer(kernelProposal);
    throw error;
  }
  const proposal = Object.freeze({}) as PreparedCanonicalRunFirstContinuationRoomAdmission;
  const view = Object.freeze({
    authority: PROPOSAL_AUTHORITY,
    extensionPolicy: EXTENSION_POLICY,
    state: "prepared" as const,
    preparedAtTick120: plan.plannedAtTick120,
    handoff: handoff.view,
    plan,
    combinedPoolAdmission: evaluation,
    transfer,
    canonicalEventWrites: 0 as const,
    tickAdvance: 0 as const,
  });
  ADMISSION_PROPOSALS.set(proposal, {
    handoffReceipt,
    handoff,
    source,
    plan,
    evaluation,
    successorOwner,
    kernelProposal,
    view,
    status: "prepared",
  });
  handoff.activeProposal = proposal;
  return Object.freeze({state: "prepared" as const, proposal, view});
}

export function inspectPreparedCanonicalRunFirstContinuationRoomAdmission(
  proposal: PreparedCanonicalRunFirstContinuationRoomAdmission,
): CanonicalRunFirstContinuationRoomAdmissionProposalView {
  return requireAdmissionProposal(proposal).view;
}

export function cancelPreparedCanonicalRunFirstContinuationRoomAdmission(
  proposal: PreparedCanonicalRunFirstContinuationRoomAdmission,
): void {
  const record = requireAdmissionProposal(proposal);
  cancelPreparedCanonicalRunFirstContinuationDormantSuccessorTransfer(
    record.kernelProposal,
  );
  record.status = "cancelled";
  record.handoff.activeProposal = null;
}

export function commitPreparedCanonicalRunFirstContinuationRoomAdmission(
  proposal: PreparedCanonicalRunFirstContinuationRoomAdmission,
): CanonicalRunFirstContinuationDormantSuccessorOwner {
  const record = requireAdmissionProposal(proposal);
  let kernelCommitAttempted = false;
  try {
    const handoff = requireHandoff(record.handoffReceipt);
    invariant(handoff === record.handoff && handoff.status === "available", "handoff became stale");
    const source = sourceFromExactHandoff(handoff);
    invariant(sameJson(source, record.source), "prepared source became stale");
    const plan = deriveCanonicalRunFirstContinuationRoomPlanUnbranded(source);
    invariant(sameJson(plan, record.plan), "prepared plan became stale");
    const evaluation = evaluateCanonicalRunFirstContinuationCombinedPoolAdmissionUnbranded(
      plan,
      handoff.runState.snapshot().adapterPolicy.projectilePoolClasses,
    );
    invariant(
      evaluation.admissible && sameJson(evaluation, record.evaluation),
      "prepared combined pool admission became stale",
    );
    registerCanonicalRunFirstContinuationSuccessorOwner({
      owner: record.successorOwner,
      runState: handoff.runState,
      eventBus: handoff.eventBus,
      carryover: handoff.carryover,
      plan: record.view.transfer.plan,
      evaluation: record.view.transfer.combinedPoolAdmission,
    });
    kernelCommitAttempted = true;
    commitPreparedCanonicalRunFirstContinuationDormantSuccessorTransfer(
      record.kernelProposal,
    );
    record.status = "committed";
    handoff.status = "committed";
    handoff.activeProposal = null;
    return record.successorOwner;
  } catch (error) {
    if (!kernelCommitAttempted) {
      cancelPreparedCanonicalRunFirstContinuationDormantSuccessorTransfer(
        record.kernelProposal,
      );
    }
    record.status = "failed";
    record.handoff.activeProposal = null;
    throw error;
  }
}
