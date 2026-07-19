import {
  advanceCanonicalRunFirstContinuationDormantSuccessorPreReadTick,
  advanceCanonicalRunFirstContinuationSuccessorReadTick,
  advanceCanonicalRunFirstContinuationSuccessorTailTick,
  inspectCanonicalRunFirstContinuationDormantSuccessorBinding,
  startCanonicalRunFirstContinuationSuccessorRead as startCanonicalRunFirstContinuationSuccessorReadBinding,
  type CanonicalCombatSnapshot,
  type CanonicalCombatStepInput,
  type CanonicalRoomThresholdMaterialCarryover,
  type CanonicalRunCombatState,
  type CanonicalRunFirstContinuationDormantSuccessorReservation,
  type CanonicalRunFirstContinuationSuccessorBoundaryTicks,
} from "../../combat-kernel";
import type {CanonicalEventBus} from "../../events";
import type {CanonicalRunFirstContinuationCombinedPoolAdmissionEvaluation} from
  "./first-continuation-room-admission";
import type {CanonicalRunFirstContinuationDormantSuccessorOwner} from
  "./first-continuation-room-admission-authority";
import type {CanonicalRunFirstContinuationRoomPlanPayload} from
  "./first-continuation-room-plan";

const OWNER_AUTHORITY = "canonical-run-first-continuation-room-dormant-owner-v1" as const;
const EXTENSION_POLICY = "EXT-2026-015" as const;
const TERMINAL_POLICY = "EXT-2026-016" as const;
const ALLOWED_PRE_READ_EVENT_IDS = Object.freeze([
  "projectile.residue.remove",
  "projectile.lifecycle.complete",
] as const);

interface SuccessorOwnerRecord {
  readonly runState: CanonicalRunCombatState;
  readonly eventBus: CanonicalEventBus;
  readonly carryover: CanonicalRoomThresholdMaterialCarryover;
  readonly plan: CanonicalRunFirstContinuationRoomPlanPayload;
  readonly evaluation: CanonicalRunFirstContinuationCombinedPoolAdmissionEvaluation;
  stepping: boolean;
  fatalError: Error | null;
}

const SUCCESSOR_OWNER_RECORDS = new WeakMap<
  CanonicalRunFirstContinuationDormantSuccessorOwner,
  SuccessorOwnerRecord
>();

export interface CanonicalRunFirstContinuationSuccessorRegistration {
  readonly owner: CanonicalRunFirstContinuationDormantSuccessorOwner;
  readonly runState: CanonicalRunCombatState;
  readonly eventBus: CanonicalEventBus;
  readonly carryover: CanonicalRoomThresholdMaterialCarryover;
  readonly plan: CanonicalRunFirstContinuationRoomPlanPayload;
  readonly evaluation: CanonicalRunFirstContinuationCombinedPoolAdmissionEvaluation;
}

/** Admission-only registration; the opaque owner is not exposed until after this call. */
export function registerCanonicalRunFirstContinuationSuccessorOwner(
  registration: CanonicalRunFirstContinuationSuccessorRegistration,
): void {
  if (SUCCESSOR_OWNER_RECORDS.has(registration.owner)) {
    throw new Error("first continuation successor owner was already registered");
  }
  SUCCESSOR_OWNER_RECORDS.set(registration.owner, {
    runState: registration.runState,
    eventBus: registration.eventBus,
    carryover: registration.carryover,
    plan: registration.plan,
    evaluation: registration.evaluation,
    stepping: false,
    fatalError: null,
  });
}

function requireOwner(
  owner: CanonicalRunFirstContinuationDormantSuccessorOwner,
): SuccessorOwnerRecord {
  if (typeof owner !== "object" || owner === null) {
    throw new Error("first continuation successor owner must be opaque");
  }
  const record = SUCCESSOR_OWNER_RECORDS.get(owner);
  if (record === undefined) {
    throw new Error("first continuation successor owner is not registered");
  }
  if (record.fatalError !== null) {
    throw new Error(`first continuation successor owner is faulted: ${record.fatalError.message}`, {
      cause: record.fatalError,
    });
  }
  return record;
}

export type CanonicalRunFirstContinuationSuccessorPreReadPhase =
  | "dormant"
  | "telegraph"
  | "entry"
  | "read"
  | "material-settle"
  | "rest"
  | "complete";

export interface CanonicalRunFirstContinuationDormantSuccessorOwnerSnapshot {
  readonly authority: typeof OWNER_AUTHORITY;
  readonly extensionPolicy: typeof EXTENSION_POLICY;
  readonly terminalPolicy: typeof TERMINAL_POLICY;
  readonly phase: CanonicalRunFirstContinuationSuccessorPreReadPhase;
  readonly tick120: number;
  readonly relativeTick120: number;
  readonly boundaryTicks120: Readonly<CanonicalRunFirstContinuationSuccessorBoundaryTicks>;
  readonly targetRoom: CanonicalRunFirstContinuationRoomPlanPayload["targetRoom"];
  readonly worldRoom: CanonicalRunFirstContinuationRoomPlanPayload["targetRoom"];
  readonly patternId: string;
  readonly occurrenceId: string;
  readonly difficulty: CanonicalRunFirstContinuationRoomPlanPayload["occurrence"]["difficulty"];
  readonly plan: CanonicalRunFirstContinuationRoomPlanPayload;
  readonly combinedPoolAdmission: Readonly<{
    readonly authority: "canonical-run-first-continuation-combined-pool-admission-commit-v1";
    readonly extensionPolicy: typeof EXTENSION_POLICY;
    readonly state: "committed";
    readonly evaluation: CanonicalRunFirstContinuationCombinedPoolAdmissionEvaluation;
    readonly reservation: CanonicalRunFirstContinuationDormantSuccessorReservation;
    readonly reservationCommitted: true;
    readonly canonicalEventWrites: 0;
    readonly tickAdvance: 0;
  }>;
  readonly material: ReturnType<CanonicalRoomThresholdMaterialCarryover["snapshot"]>;
  readonly runCombat: ReturnType<CanonicalRunCombatState["snapshot"]>;
  readonly canonicalEventCount: number;
  readonly combat: CanonicalCombatSnapshot | null;
  readonly targetVisible: false;
  readonly nextMasterTickAction:
    | "telegraph"
    | "continue-telegraph"
    | "entry"
    | "continue-entry"
    | "claim-read"
    | "advance-read"
    | "advance-tail"
    | "close-slice"
    | "advance-complete-hold";
  readonly inputOwnership: Readonly<{
    readonly movement: "continued";
    readonly focus: "continued";
    readonly signal: "requested-unconsumed";
    readonly gazeInput: "requested-unconsumed";
    readonly flowerAuthority: "frozen";
    readonly gazeAuthority: "frozen";
    readonly override: "locked";
  }>;
}

export function inspectCanonicalRunFirstContinuationDormantSuccessorOwner(
  owner: CanonicalRunFirstContinuationDormantSuccessorOwner,
): CanonicalRunFirstContinuationDormantSuccessorOwnerSnapshot {
  const record = requireOwner(owner);
  const binding = inspectCanonicalRunFirstContinuationDormantSuccessorBinding(
    record.runState,
    record.eventBus,
    record.carryover,
    owner,
  );
  const boundaryTicks120 = binding.boundaryTicks120;
  if (
    binding.plan !== record.plan
    || binding.terminalPolicy !== TERMINAL_POLICY
    || binding.targetRoom !== record.plan.targetRoom
    || binding.reservation.occurrenceId !== record.plan.occurrence.occurrenceId
    || binding.reservation.patternId !== record.plan.occurrence.patternId
    || binding.admittedAtTick120 !== boundaryTicks120.handoffTick120
  ) {
    throw new Error("first continuation successor binding and formal plan diverged");
  }
  const relativeTick120 = binding.tick120 - boundaryTicks120.handoffTick120;
  const phase: CanonicalRunFirstContinuationSuccessorPreReadPhase =
    binding.phase === "dormant"
      ? "dormant"
      : binding.phase === "pre-read"
        ? binding.tick120 < boundaryTicks120.entryStartTick120
          ? "telegraph"
          : "entry"
        : binding.phase === "complete"
          ? "complete"
          : binding.tick120 < boundaryTicks120.materialSettleStartTick120
            ? "read"
            : binding.tick120 < boundaryTicks120.restStartTick120
              ? "material-settle"
              : "rest";
  if (
    relativeTick120 < 0
    || ((phase === "dormant" || phase === "telegraph" || phase === "entry")
      ? binding.tick120 >= boundaryTicks120.readStartTick120
        || binding.combat !== null
      : binding.tick120 < boundaryTicks120.readStartTick120
        || binding.combat === null)
    || (phase === "dormant" && binding.phase !== "dormant")
    || ((phase === "telegraph" || phase === "entry") && binding.phase !== "pre-read")
    || (phase === "complete" && binding.phase !== "complete")
    || ((phase === "read" || phase === "material-settle" || phase === "rest")
      && binding.phase !== "read"
      && binding.phase !== "tail")
  ) {
    throw new Error("first continuation successor authored segment phase drifted");
  }
  const nextMasterTickAction = phase === "dormant"
    ? "telegraph" as const
    : binding.phase === "read"
      ? "advance-read" as const
      : binding.phase === "tail"
        ? binding.nextMasterTickAction === "close-slice"
          ? "close-slice" as const
          : "advance-tail" as const
        : binding.phase === "complete"
          ? "advance-complete-hold" as const
      : binding.tick120 === boundaryTicks120.readStartTick120 - 1
        ? "claim-read" as const
        : binding.tick120 === boundaryTicks120.entryStartTick120 - 1
          ? "entry" as const
          : phase === "telegraph"
            ? "continue-telegraph" as const
            : "continue-entry" as const;
  const runCombat = record.runState.snapshot();
  if (
    runCombat.tick120 !== binding.tick120
    || (binding.phase === "read"
      ? runCombat.activeOccurrenceId !== record.plan.occurrence.occurrenceId
      : runCombat.activeOccurrenceId !== null)
    || runCombat.pendingFlushTick120 !== null
  ) {
    throw new Error("first continuation successor lost its exact combat ownership or flush");
  }
  return Object.freeze({
    authority: OWNER_AUTHORITY,
    extensionPolicy: EXTENSION_POLICY,
    terminalPolicy: TERMINAL_POLICY,
    phase,
    tick120: binding.tick120,
    relativeTick120,
    boundaryTicks120,
    targetRoom: binding.targetRoom,
    worldRoom: binding.targetRoom,
    patternId: record.plan.occurrence.patternId,
    occurrenceId: record.plan.occurrence.occurrenceId,
    difficulty: record.plan.occurrence.difficulty,
    plan: record.plan,
    combinedPoolAdmission: Object.freeze({
      authority: "canonical-run-first-continuation-combined-pool-admission-commit-v1" as const,
      extensionPolicy: EXTENSION_POLICY,
      state: "committed" as const,
      evaluation: record.evaluation,
      reservation: binding.reservation,
      reservationCommitted: true as const,
      canonicalEventWrites: 0 as const,
      tickAdvance: 0 as const,
    }),
    material: binding.material,
    runCombat,
    canonicalEventCount: record.eventBus.events().length,
    combat: binding.combat,
    targetVisible: false as const,
    nextMasterTickAction,
    inputOwnership: Object.freeze({
      movement: "continued" as const,
      focus: "continued" as const,
      signal: "requested-unconsumed" as const,
      gazeInput: "requested-unconsumed" as const,
      flowerAuthority: "frozen" as const,
      gazeAuthority: "frozen" as const,
      override: "locked" as const,
    }),
  });
}

export function advanceCanonicalRunFirstContinuationSuccessorPreRead(
  owner: CanonicalRunFirstContinuationDormantSuccessorOwner,
  input: CanonicalCombatStepInput,
): CanonicalRunFirstContinuationDormantSuccessorOwnerSnapshot {
  const record = requireOwner(owner);
  if (record.stepping) {
    throw new Error("first continuation successor pre-READ step is already active");
  }
  record.stepping = true;
  let authoritativeTickAccepted = false;
  try {
    const before = inspectCanonicalRunFirstContinuationDormantSuccessorOwner(owner);
    const advanced = advanceCanonicalRunFirstContinuationDormantSuccessorPreReadTick(
      record.runState,
      record.eventBus,
      record.carryover,
      owner,
      input,
    );
    authoritativeTickAccepted = true;
    const flushed = record.runState.flushTick(advanced.runCombat.tick120);
    if (flushed.some((event) => !ALLOWED_PRE_READ_EVENT_IDS.includes(
      event.id as (typeof ALLOWED_PRE_READ_EVENT_IDS)[number],
    ))) {
      throw new Error("first continuation successor pre-READ emitted a non-material event");
    }
    const after = inspectCanonicalRunFirstContinuationDormantSuccessorOwner(owner);
    if (after.tick120 !== before.tick120 + 1 || after.combat !== null) {
      throw new Error("first continuation successor pre-READ lost its exact one-tick advance");
    }
    return after;
  } catch (error) {
    if (authoritativeTickAccepted || record.runState.snapshot().faulted) {
      record.fatalError = error instanceof Error ? error : new Error(String(error));
    }
    throw error;
  } finally {
    record.stepping = false;
  }
}

export function startCanonicalRunFirstContinuationSuccessorRead(
  owner: CanonicalRunFirstContinuationDormantSuccessorOwner,
  input: CanonicalCombatStepInput,
): CanonicalRunFirstContinuationDormantSuccessorOwnerSnapshot {
  const record = requireOwner(owner);
  if (record.stepping) {
    throw new Error("first continuation successor READ start is already active");
  }
  record.stepping = true;
  let authoritativeTickAccepted = false;
  try {
    const before = inspectCanonicalRunFirstContinuationDormantSuccessorOwner(owner);
    if (before.phase !== "entry" || before.nextMasterTickAction !== "claim-read") {
      throw new Error("first continuation successor READ requires the exact H+158 entry boundary");
    }
    startCanonicalRunFirstContinuationSuccessorReadBinding(
      record.runState,
      record.eventBus,
      record.carryover,
      owner,
      input,
    );
    authoritativeTickAccepted = true;
    const after = inspectCanonicalRunFirstContinuationDormantSuccessorOwner(owner);
    if (
      after.tick120 !== before.tick120 + 1
      || after.phase !== "read"
      || after.relativeTick120 !== 159
      || after.combat === null
      || after.combat.relativeTick120 !== 0
      || after.combat.patternId !== after.plan.occurrence.patternId
      || after.combat.occurrenceId !== after.plan.occurrence.occurrenceId
      || after.combat.projectiles.length !== 0
      || after.combat.poolUsage.liveColliders !== 0
      || after.nextMasterTickAction !== "advance-read"
    ) {
      throw new Error("first continuation successor READ local-tick-zero snapshot drifted");
    }
    return after;
  } catch (error) {
    if (authoritativeTickAccepted || record.runState.snapshot().faulted) {
      record.fatalError = error instanceof Error ? error : new Error(String(error));
    }
    throw error;
  } finally {
    record.stepping = false;
  }
}

export function advanceCanonicalRunFirstContinuationSuccessorRead(
  owner: CanonicalRunFirstContinuationDormantSuccessorOwner,
  input: CanonicalCombatStepInput,
): CanonicalRunFirstContinuationDormantSuccessorOwnerSnapshot {
  const record = requireOwner(owner);
  if (record.stepping) {
    throw new Error("first continuation successor READ step is already active");
  }
  record.stepping = true;
  let authoritativeTickAccepted = false;
  try {
    const before = inspectCanonicalRunFirstContinuationDormantSuccessorOwner(owner);
    if (
      before.nextMasterTickAction !== "advance-read"
      || before.combat === null
    ) {
      throw new Error("first continuation successor READ advance requires its active READ owner");
    }
    const advanced = advanceCanonicalRunFirstContinuationSuccessorReadTick(
      record.runState,
      record.eventBus,
      record.carryover,
      owner,
      input,
    );
    authoritativeTickAccepted = true;
    const after = inspectCanonicalRunFirstContinuationDormantSuccessorOwner(owner);
    if (
      after.tick120 !== before.tick120 + 1
      || after.relativeTick120 !== before.relativeTick120 + 1
      || after.combat === null
      || after.combat.tick120 !== advanced.combat.tick120
      || after.combat.relativeTick120 !== before.combat.relativeTick120 + 1
      || after.combat.patternId !== after.plan.occurrence.patternId
      || after.combat.occurrenceId !== after.plan.occurrence.occurrenceId
      || after.material.tick120 !== after.tick120
      || after.material.poolUsage.liveColliders !== 0
      || after.runCombat.pendingFlushTick120 !== null
      || (after.nextMasterTickAction !== "advance-read"
        && after.nextMasterTickAction !== "advance-tail"
        && after.nextMasterTickAction !== "close-slice")
      || after.inputOwnership.override !== "locked"
    ) {
      throw new Error("first continuation successor READ lost its exact one-tick advance");
    }
    return after;
  } catch (error) {
    if (authoritativeTickAccepted || record.runState.snapshot().faulted) {
      record.fatalError = error instanceof Error ? error : new Error(String(error));
    }
    throw error;
  } finally {
    record.stepping = false;
  }
}

export function advanceCanonicalRunFirstContinuationSuccessorTail(
  owner: CanonicalRunFirstContinuationDormantSuccessorOwner,
  input: CanonicalCombatStepInput,
): CanonicalRunFirstContinuationDormantSuccessorOwnerSnapshot {
  const record = requireOwner(owner);
  if (record.stepping) {
    throw new Error("first continuation successor tail step is already active");
  }
  record.stepping = true;
  let authoritativeTickAccepted = false;
  try {
    const before = inspectCanonicalRunFirstContinuationDormantSuccessorOwner(owner);
    if (
      before.nextMasterTickAction !== "advance-tail"
      || before.combat === null
      || !before.combat.patternComplete
      || !before.combat.digitalBodiesDrained
      || before.combat.poolUsage.liveColliders !== 0
    ) {
      throw new Error("first continuation successor tail advance requires its released slice owner");
    }
    const advanced = advanceCanonicalRunFirstContinuationSuccessorTailTick(
      record.runState,
      record.eventBus,
      record.carryover,
      owner,
      input,
      "advance",
    );
    authoritativeTickAccepted = true;
    const after = inspectCanonicalRunFirstContinuationDormantSuccessorOwner(owner);
    if (
      after.tick120 !== before.tick120 + 1
      || after.relativeTick120 !== before.relativeTick120 + 1
      || after.combat !== advanced.combat
      || after.combat === null
      || after.combat.tick120 !== after.tick120
      || !after.combat.patternComplete
      || !after.combat.digitalBodiesDrained
      || after.combat.poolUsage.liveColliders !== 0
      || advanced.sliceComplete
      || after.runCombat.activeOccurrenceId !== null
      || after.runCombat.pendingFlushTick120 !== null
      || after.material.tick120 !== after.tick120
      || after.material.poolUsage.liveColliders !== 0
      || (after.nextMasterTickAction !== "advance-tail"
        && after.nextMasterTickAction !== "close-slice")
    ) {
      throw new Error("first continuation successor tail lost its exact one-tick advance");
    }
    return after;
  } catch (error) {
    if (authoritativeTickAccepted || record.runState.snapshot().faulted) {
      record.fatalError = error instanceof Error ? error : new Error(String(error));
    }
    throw error;
  } finally {
    record.stepping = false;
  }
}

export function closeCanonicalRunFirstContinuationSuccessorSlice(
  owner: CanonicalRunFirstContinuationDormantSuccessorOwner,
  input: CanonicalCombatStepInput,
): CanonicalRunFirstContinuationDormantSuccessorOwnerSnapshot {
  const record = requireOwner(owner);
  if (record.stepping) {
    throw new Error("first continuation successor slice close is already active");
  }
  record.stepping = true;
  let authoritativeTickAccepted = false;
  try {
    const before = inspectCanonicalRunFirstContinuationDormantSuccessorOwner(owner);
    if (
      before.nextMasterTickAction !== "close-slice"
      || before.combat === null
      || !before.combat.patternComplete
      || !before.combat.digitalBodiesDrained
      || before.combat.poolUsage.liveColliders !== 0
    ) {
      throw new Error("first continuation successor close requires its exact terminal boundary");
    }
    const advanced = advanceCanonicalRunFirstContinuationSuccessorTailTick(
      record.runState,
      record.eventBus,
      record.carryover,
      owner,
      input,
      "close",
    );
    authoritativeTickAccepted = true;
    const after = inspectCanonicalRunFirstContinuationDormantSuccessorOwner(owner);
    if (
      after.tick120 !== before.boundaryTicks120.sliceCompleteTick120
      || after.phase !== "complete"
      || after.nextMasterTickAction !== "advance-complete-hold"
      || after.combat !== advanced.combat
      || after.combat === null
      || after.combat.tick120 !== after.tick120
      || !after.combat.patternComplete
      || !after.combat.digitalBodiesDrained
      || after.combat.poolUsage.liveColliders !== 0
      || after.combat.projectiles.some((projectile) =>
        projectile.state !== "residue" || projectile.collisionEnabled)
      || !advanced.sliceComplete
      || after.runCombat.activeOccurrenceId !== null
      || after.runCombat.pendingFlushTick120 !== null
      || !after.material.drained
      || after.material.materialCount !== 0
    ) {
      throw new Error("first continuation successor slice close did not seal its terminal snapshot");
    }
    return after;
  } catch (error) {
    if (authoritativeTickAccepted || record.runState.snapshot().faulted) {
      record.fatalError = error instanceof Error ? error : new Error(String(error));
    }
    throw error;
  } finally {
    record.stepping = false;
  }
}

export function advanceCanonicalRunFirstContinuationSuccessorCompleteHold(
  owner: CanonicalRunFirstContinuationDormantSuccessorOwner,
  input: CanonicalCombatStepInput,
): CanonicalRunFirstContinuationDormantSuccessorOwnerSnapshot {
  const record = requireOwner(owner);
  if (record.stepping) {
    throw new Error("first continuation successor complete hold is already active");
  }
  record.stepping = true;
  let authoritativeTickAccepted = false;
  try {
    const before = inspectCanonicalRunFirstContinuationDormantSuccessorOwner(owner);
    if (
      before.phase !== "complete"
      || before.nextMasterTickAction !== "advance-complete-hold"
      || before.combat === null
      || !before.combat.patternComplete
      || !before.combat.digitalBodiesDrained
      || before.combat.poolUsage.liveColliders !== 0
      || !before.material.drained
    ) {
      throw new Error(
        "first continuation successor complete hold requires its sealed material owner",
      );
    }
    const advanced = advanceCanonicalRunFirstContinuationSuccessorTailTick(
      record.runState,
      record.eventBus,
      record.carryover,
      owner,
      input,
      "hold",
    );
    authoritativeTickAccepted = true;
    const after = inspectCanonicalRunFirstContinuationDormantSuccessorOwner(owner);
    if (
      after.phase !== "complete"
      || after.nextMasterTickAction !== "advance-complete-hold"
      || after.tick120 !== before.tick120 + 1
      || after.relativeTick120 !== before.relativeTick120 + 1
      || after.combat !== advanced.combat
      || after.combat === null
      || after.combat.tick120 !== after.tick120
      || !after.combat.patternComplete
      || !after.combat.digitalBodiesDrained
      || after.combat.poolUsage.liveColliders !== 0
      || after.combat.projectiles.some((projectile) =>
        projectile.state !== "residue" || projectile.collisionEnabled)
      || !advanced.sliceComplete
      || after.runCombat.activeOccurrenceId !== null
      || after.runCombat.pendingFlushTick120 !== null
      || !after.material.drained
      || after.material.materialCount !== 0
    ) {
      throw new Error("first continuation successor complete hold lost its one-tick boundary");
    }
    return after;
  } catch (error) {
    if (authoritativeTickAccepted || record.runState.snapshot().faulted) {
      record.fatalError = error instanceof Error ? error : new Error(String(error));
    }
    throw error;
  } finally {
    record.stepping = false;
  }
}
