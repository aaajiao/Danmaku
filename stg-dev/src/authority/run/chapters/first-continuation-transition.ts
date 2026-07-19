import {
  CanonicalRoomThresholdMaterialCarryover,
  CanonicalRunCombatState,
  advanceCanonicalRunIdleWithRoomThresholdMaterial,
  advanceCanonicalRunRoomThresholdTransitionTick,
  applyCanonicalRoomThresholdMaterialDetachBeforeFlush,
  commitCanonicalRoomThresholdMaterialDetachAfterFlush,
  commitPreparedCanonicalRunRoomThresholdStart,
  failStopCanonicalRunCombatAfterAcceptedTransitionAppend,
  prepareCanonicalRunRoomThresholdStartNextTick,
  type CanonicalCombatKernel,
  type CanonicalCombatSnapshot,
  type CanonicalCombatStepInput,
  type CanonicalRoomThresholdMaterialCarryoverSnapshot,
  type CanonicalRunRoomThresholdTargetRoom,
  type CanonicalRunFirstContinuationDormantSuccessorTransferCapability,
} from "../../combat-kernel";
import {type CanonicalEventBus} from "../../events";
import {
  issueCanonicalRunFirstContinuationRoomTransitionReceipt,
  type CanonicalRunFirstContinuationRoomTargetAvailable,
} from "../../run-first-continuation-room-target";
import {
  RoomTransitionAuthority,
  type RoomTransitionAuthoritySnapshot,
} from "../../room-transition";
import type {CollisionBlockerLease, PlayerLifeState} from "../../player";
import {
  canonicalRunFirstContinuationRoomHandoffWasCommitted,
  registerCanonicalRunFirstContinuationRoomHandoffReceipt,
  type CanonicalRunFirstContinuationRoomHandoffReceipt,
} from "./first-continuation-room-admission-authority";

export {
  inspectCanonicalRunFirstContinuationRoomHandoffReceipt,
  type CanonicalRunFirstContinuationRoomHandoffReceipt,
  type CanonicalRunFirstContinuationRoomHandoffReceiptView,
} from "./first-continuation-room-admission-authority";

const TRANSITION_PATTERN_ID = "transition.room_threshold" as const;
const TRANSITION_OCCURRENCE_ID =
  "run:room:0-to-1:transition:transition.room_threshold" as const;
const TRANSITION_SOURCE_ROOM = "FORCED_ALIGNMENT" as const;
const NEXT_ROOM_ADMISSION =
  "withheld-pending-room-plan-and-combined-pool-budget" as const;
const PATTERN_DURATION_TICKS120 = 936;
const CREATE_CHAPTER = Symbol("create-first-continuation-transition-chapter");

export const CANONICAL_FIRST_CONTINUATION_TRANSITION_CONTRACT = Object.freeze({
  authority: "canonical-run-first-continuation-transition-v1" as const,
  extensionPolicy: "EXT-2026-013" as const,
  sourceRoom: TRANSITION_SOURCE_ROOM,
  patternId: TRANSITION_PATTERN_ID,
  occurrenceId: TRANSITION_OCCURRENCE_ID,
  difficulty: "NORMAL" as const,
  transitionEncounterOrdinal: 0 as const,
  transitionDifficultySalt: 0 as const,
  patternDurationTicks120: PATTERN_DURATION_TICKS120,
  nextRoomAdmission: NEXT_ROOM_ADMISSION,
});

export type CanonicalRunFirstContinuationTransitionPhase =
  | "transition_gameplay"
  | "material_carryover"
  | "target_room_idle";

export interface CanonicalRunFirstContinuationGameplayExitSnapshot {
  readonly atTick120: number;
  readonly patternComplete: true;
  readonly digitalBodiesDrained: true;
  readonly liveDigitalBodies: 0;
  readonly liveColliders: 0;
  readonly materialCount: number;
}

export interface CanonicalRunFirstContinuationRoomHandoffSnapshot {
  readonly state:
    | "withheld-transition-gameplay"
    | "awaiting-player-quiescence"
    | "ready-pending-room-plan-and-combined-pool-budget"
    | "run-ended";
  readonly ready: boolean;
  readonly atTick120: number | null;
  readonly targetRoom: CanonicalRunRoomThresholdTargetRoom;
  readonly playerState: PlayerLifeState;
  readonly runTimedStateQuiescent: boolean;
  readonly materialDrainingAtHandoff: boolean;
  readonly nextRoomAdmission: typeof NEXT_ROOM_ADMISSION;
}

export interface CanonicalRunFirstContinuationTransitionSnapshot {
  readonly authority: "canonical-run-first-continuation-transition-v1";
  readonly extensionPolicy: "EXT-2026-013";
  readonly ownership: "active" | "transferred-to-dormant-successor";
  readonly phase: CanonicalRunFirstContinuationTransitionPhase;
  readonly sourceRoom: typeof TRANSITION_SOURCE_ROOM;
  readonly targetRoom: CanonicalRunRoomThresholdTargetRoom;
  readonly worldRoom: RoomTransitionAuthoritySnapshot["currentRoom"];
  readonly patternId: typeof TRANSITION_PATTERN_ID;
  readonly occurrenceId: typeof TRANSITION_OCCURRENCE_ID;
  readonly difficulty: "NORMAL";
  readonly resolvedSeed: Readonly<{
    readonly domain: "ext-013-first-continuation-room-transition";
    readonly value: number;
  }>;
  readonly transitionEncounterOrdinal: 0;
  readonly transitionDifficultySalt: 0;
  readonly startTick120: number;
  readonly timeline: Readonly<{
    readonly requestTick120: number;
    readonly worldSwapTick120: number;
    readonly roomReadyTick120: number;
    readonly completeTick120: number;
    readonly patternCompleteTick120: number;
  }>;
  readonly roomTransition: RoomTransitionAuthoritySnapshot;
  readonly collisionLeaseReleased: boolean;
  /** Final gameplay snapshot remains frozen after material ownership detaches. */
  readonly combat: CanonicalCombatSnapshot;
  readonly material: CanonicalRoomThresholdMaterialCarryoverSnapshot | null;
  readonly gameplayExit: CanonicalRunFirstContinuationGameplayExitSnapshot | null;
  readonly handoff: CanonicalRunFirstContinuationRoomHandoffSnapshot;
}

export interface CanonicalRunFirstContinuationTransitionStartOptions {
  readonly formalTarget: CanonicalRunFirstContinuationRoomTargetAvailable;
  readonly runState: CanonicalRunCombatState;
  readonly eventBus: CanonicalEventBus;
  readonly input: CanonicalCombatStepInput;
}

interface ChapterRecord {
  readonly formalTarget: CanonicalRunFirstContinuationRoomTargetAvailable;
  readonly runState: CanonicalRunCombatState;
  readonly eventBus: CanonicalEventBus;
  readonly roomTransition: RoomTransitionAuthority;
  readonly kernel: CanonicalCombatKernel;
  readonly successorTransferCapability:
    CanonicalRunFirstContinuationDormantSuccessorTransferCapability;
  readonly collisionLease: CollisionBlockerLease;
  readonly targetRoom: CanonicalRunRoomThresholdTargetRoom;
  readonly startTick120: number;
  readonly timeline: CanonicalRunFirstContinuationTransitionSnapshot["timeline"];
  combat: CanonicalCombatSnapshot;
  material: CanonicalRoomThresholdMaterialCarryover | null;
  gameplayExit: CanonicalRunFirstContinuationGameplayExitSnapshot | null;
  handoffSnapshot: CanonicalRunFirstContinuationRoomHandoffSnapshot;
  handoffReceipt: CanonicalRunFirstContinuationRoomHandoffReceipt | null;
  fatalError: Error | null;
  stepping: boolean;
}

const CHAPTER_RECORDS = new WeakMap<
  CanonicalRunFirstContinuationTransitionChapter,
  ChapterRecord
>();

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function runTimedStateQuiescent(
  runCombat: ReturnType<CanonicalRunCombatState["snapshot"]>,
): boolean {
  return runCombat.player.recoveryAtTick120 === null
    && runCombat.player.respawnPlaceAtTick120 === null
    && runCombat.player.respawnCompleteAtTick120 === null
    && runCombat.override.state === "idle"
    && runCombat.override.deadlineTick120 === null
    && runCombat.override.localVoid === null;
}

function withheldHandoff(
  targetRoom: CanonicalRunRoomThresholdTargetRoom,
  runCombat: ReturnType<CanonicalRunCombatState["snapshot"]>,
): CanonicalRunFirstContinuationRoomHandoffSnapshot {
  return Object.freeze({
    state: "withheld-transition-gameplay" as const,
    ready: false,
    atTick120: null,
    targetRoom,
    playerState: runCombat.player.state,
    runTimedStateQuiescent: runTimedStateQuiescent(runCombat),
    materialDrainingAtHandoff: false,
    nextRoomAdmission: NEXT_ROOM_ADMISSION,
  });
}

function requireChapter(
  owner: CanonicalRunFirstContinuationTransitionChapter,
): ChapterRecord {
  const record = CHAPTER_RECORDS.get(owner);
  if (
    record === undefined
    || Object.getPrototypeOf(owner) !== CanonicalRunFirstContinuationTransitionChapter.prototype
    || Object.prototype.hasOwnProperty.call(owner, "step")
    || Object.prototype.hasOwnProperty.call(owner, "snapshot")
    || Object.prototype.hasOwnProperty.call(owner, "handoff")
  ) {
    throw new Error("unrecognized first-continuation transition chapter owner");
  }
  if (record.fatalError !== null) {
    throw new Error(
      `first-continuation transition chapter is faulted: ${record.fatalError.message}`,
      {cause: record.fatalError},
    );
  }
  return record;
}

function validateStartedResult(
  formalTarget: CanonicalRunFirstContinuationRoomTargetAvailable,
  startTick120: number,
  result: ReturnType<typeof commitPreparedCanonicalRunRoomThresholdStart>,
): CanonicalRunFirstContinuationTransitionSnapshot["timeline"] {
  const active = result.roomTransition.active;
  if (
    active === null
    || result.combat.patternId !== TRANSITION_PATTERN_ID
    || result.combat.occurrenceId !== TRANSITION_OCCURRENCE_ID
    || result.combat.difficulty !== "NORMAL"
    || result.combat.startTick120 !== startTick120
    || result.combat.tick120 !== startTick120
    || result.combat.relativeTick120 !== 0
    || result.roomTransition.tick120 !== startTick120
    || result.roomTransition.state !== "preparing"
    || result.roomTransition.currentRoom !== TRANSITION_SOURCE_ROOM
    || result.roomTransition.targetRoom !== formalTarget.targetRoom
    || active.generation !== 1
    || active.fromRoom !== TRANSITION_SOURCE_ROOM
    || active.toRoom !== formalTarget.targetRoom
    || active.requestTick120 !== startTick120
  ) {
    throw new Error("first-continuation transition start lost its EXT-013 lineage");
  }
  return Object.freeze({
    requestTick120: active.requestTick120,
    worldSwapTick120: active.worldSwapTick120,
    roomReadyTick120: active.roomReadyTick120,
    completeTick120: active.completeTick120,
    patternCompleteTick120: startTick120 + PATTERN_DURATION_TICKS120,
  });
}

function freezeGameplayExit(
  record: ChapterRecord,
  material: CanonicalRoomThresholdMaterialCarryoverSnapshot,
): CanonicalRunFirstContinuationGameplayExitSnapshot {
  const combat = record.combat;
  if (
    combat.tick120 !== record.timeline.patternCompleteTick120
    || combat.relativeTick120 !== PATTERN_DURATION_TICKS120
    || combat.patternComplete !== true
    || combat.digitalBodiesDrained !== true
    || combat.poolUsage.liveColliders !== 0
    || combat.projectiles.length !== material.materialCount
    || material.detachedAtTick120 !== combat.tick120
    || material.tick120 !== combat.tick120
    || material.poolUsage.liveColliders !== 0
    || material.projectiles.some((projectile) =>
      projectile.state !== "residue" || projectile.collisionEnabled)
  ) {
    throw new Error("first-continuation gameplay exit was not a material-only boundary");
  }
  return Object.freeze({
    atTick120: combat.tick120,
    patternComplete: true,
    digitalBodiesDrained: true,
    liveDigitalBodies: 0,
    liveColliders: 0,
    materialCount: material.materialCount,
  });
}

function refreshHandoff(
  owner: CanonicalRunFirstContinuationTransitionChapter,
  record: ChapterRecord,
): void {
  if (record.handoffReceipt !== null) return;
  const runCombat = record.runState.snapshot();
  const quiescent = runTimedStateQuiescent(runCombat);
  if (runCombat.player.state === "run-ended") {
    record.handoffSnapshot = Object.freeze({
      state: "run-ended" as const,
      ready: false,
      atTick120: null,
      targetRoom: record.targetRoom,
      playerState: runCombat.player.state,
      runTimedStateQuiescent: quiescent,
      materialDrainingAtHandoff: false,
      nextRoomAdmission: NEXT_ROOM_ADMISSION,
    });
    return;
  }
  if (record.gameplayExit === null || record.material === null) {
    record.handoffSnapshot = withheldHandoff(record.targetRoom, runCombat);
    return;
  }
  const material = record.material.snapshot();
  if (!quiescent) {
    record.handoffSnapshot = Object.freeze({
      state: "awaiting-player-quiescence" as const,
      ready: false,
      atTick120: null,
      targetRoom: record.targetRoom,
      playerState: runCombat.player.state,
      runTimedStateQuiescent: false,
      materialDrainingAtHandoff: false,
      nextRoomAdmission: NEXT_ROOM_ADMISSION,
    });
    return;
  }
  if (runCombat.player.state !== "alive") {
    throw new Error(
      "first-continuation handoff requires an alive player at the quiescent boundary",
    );
  }
  const handoff = Object.freeze({
    state: "ready-pending-room-plan-and-combined-pool-budget" as const,
    ready: true,
    atTick120: runCombat.tick120,
    targetRoom: record.targetRoom,
    playerState: runCombat.player.state,
    runTimedStateQuiescent: true,
    materialDrainingAtHandoff: !material.drained,
    nextRoomAdmission: NEXT_ROOM_ADMISSION,
  });
  const view = Object.freeze({
    authority: "canonical-run-first-continuation-room-handoff-v1" as const,
    extensionPolicy: "EXT-2026-013" as const,
    targetRoom: record.targetRoom,
    atTick120: runCombat.tick120,
    nextRoomAdmission: NEXT_ROOM_ADMISSION,
  });
  record.handoffSnapshot = handoff;
  const receipt = registerCanonicalRunFirstContinuationRoomHandoffReceipt({
    owner,
    formalTarget: record.formalTarget,
    runState: record.runState,
    eventBus: record.eventBus,
    roomTransition: record.roomTransition,
    carryover: record.material,
    successorTransferCapability: record.successorTransferCapability,
    view,
    validateLineage: (candidate) => {
      const ownerRecord = requireChapter(owner);
      if (
        ownerRecord.formalTarget !== record.formalTarget
        || ownerRecord.runState !== record.runState
        || ownerRecord.eventBus !== record.eventBus
        || ownerRecord.roomTransition !== record.roomTransition
        || ownerRecord.material !== record.material
        || ownerRecord.gameplayExit !== record.gameplayExit
        || ownerRecord.handoffSnapshot !== handoff
        || ownerRecord.handoffReceipt !== candidate
      ) {
        throw new Error("first-continuation room handoff receipt lost its exact authority lineage");
      }
    },
  });
  record.handoffReceipt = receipt;
}

/**
 * Chapter-owned EXT-013 coordinator. Shared combat and event authority remain
 * external; this owner seals their chapter-specific start, tick, detach, and
 * handoff sequence behind four narrow ports.
 */
export class CanonicalRunFirstContinuationTransitionChapter {
  private constructor(creationToken: symbol) {
    if (creationToken !== CREATE_CHAPTER) {
      throw new Error("first-continuation transition chapter must start from a formal target");
    }
    Object.freeze(this);
  }

  static start(
    options: CanonicalRunFirstContinuationTransitionStartOptions,
  ): CanonicalRunFirstContinuationTransitionChapter {
    const roomTransition = new RoomTransitionAuthority(
      options.eventBus,
      TRANSITION_SOURCE_ROOM,
    );
    const transitionReceipt = issueCanonicalRunFirstContinuationRoomTransitionReceipt(
      options.formalTarget,
    );
    const proposal = prepareCanonicalRunRoomThresholdStartNextTick(
      options.runState,
      roomTransition,
      transitionReceipt,
      options.input,
    );
    const committed = commitPreparedCanonicalRunRoomThresholdStart(proposal);
    let timeline: CanonicalRunFirstContinuationTransitionSnapshot["timeline"];
    try {
      timeline = validateStartedResult(
        options.formalTarget,
        committed.combat.tick120,
        committed,
      );
    } catch (error) {
      failStopCanonicalRunCombatAfterAcceptedTransitionAppend(
        options.runState,
        committed.kernel,
        error,
      );
      throw error;
    }

    const owner = new CanonicalRunFirstContinuationTransitionChapter(CREATE_CHAPTER);
    const runCombat = committed.runCombat;
    CHAPTER_RECORDS.set(owner, {
      formalTarget: options.formalTarget,
      runState: options.runState,
      eventBus: options.eventBus,
      roomTransition,
      kernel: committed.kernel,
      successorTransferCapability: committed.successorTransferCapability,
      collisionLease: committed.collisionLease,
      targetRoom: options.formalTarget.targetRoom,
      startTick120: committed.combat.tick120,
      timeline,
      combat: committed.combat,
      material: null,
      gameplayExit: null,
      handoffSnapshot: withheldHandoff(options.formalTarget.targetRoom, runCombat),
      handoffReceipt: null,
      fatalError: null,
      stepping: false,
    });
    try {
      // Validate the chapter projection while the accepted batch can still be
      // fail-stopped through the exact pending-flush proof. After this check,
      // the existing Run owner closes the one authoritative start tick.
      owner.snapshot();
      options.runState.flushTick(committed.combat.tick120);
      return owner;
    } catch (error) {
      if (!options.runState.snapshot().faulted) {
        failStopCanonicalRunCombatAfterAcceptedTransitionAppend(
          options.runState,
          committed.kernel,
          error,
        );
      }
      CHAPTER_RECORDS.delete(owner);
      throw error;
    }
  }

  step(input: CanonicalCombatStepInput): CanonicalRunFirstContinuationTransitionSnapshot {
    const record = requireChapter(this);
    if (
      record.handoffReceipt !== null
      && canonicalRunFirstContinuationRoomHandoffWasCommitted(record.handoffReceipt)
    ) {
      throw new Error("first-continuation transition ownership was transferred to the dormant successor");
    }
    if (record.stepping) throw new Error("first-continuation transition step is already active");
    record.stepping = true;
    let authoritativeTickAccepted = false;
    try {
      if (record.material === null) {
        const advanced = advanceCanonicalRunRoomThresholdTransitionTick(
          record.kernel,
          input,
        );
        authoritativeTickAccepted = true;
        record.combat = advanced.combat;
        if (advanced.materialDetach === null) {
          record.runState.flushTick(advanced.combat.tick120);
          refreshHandoff(this, record);
        } else {
          applyCanonicalRoomThresholdMaterialDetachBeforeFlush(advanced.materialDetach);
          record.runState.flushTick(advanced.combat.tick120);
          record.material = commitCanonicalRoomThresholdMaterialDetachAfterFlush(
            advanced.materialDetach,
          );
          record.gameplayExit = freezeGameplayExit(record, record.material.snapshot());
          refreshHandoff(this, record);
        }
      } else {
        const advanced = advanceCanonicalRunIdleWithRoomThresholdMaterial(
          record.runState,
          record.material,
          input,
          record.targetRoom,
        );
        authoritativeTickAccepted = true;
        record.runState.flushTick(advanced.runCombat.tick120);
        refreshHandoff(this, record);
      }
      return this.snapshot();
    } catch (error) {
      if (authoritativeTickAccepted || record.runState.snapshot().faulted) {
        record.fatalError = asError(error);
      }
      throw error;
    } finally {
      record.stepping = false;
    }
  }

  snapshot(): CanonicalRunFirstContinuationTransitionSnapshot {
    const record = requireChapter(this);
    const runCombat = record.runState.snapshot();
    const roomTransition = record.roomTransition.snapshot();
    const material = record.material?.snapshot() ?? null;
    const ownership = record.handoffReceipt !== null
      && canonicalRunFirstContinuationRoomHandoffWasCommitted(record.handoffReceipt)
      ? "transferred-to-dormant-successor" as const
      : "active" as const;
    const phase: CanonicalRunFirstContinuationTransitionPhase = material === null
      ? "transition_gameplay"
      : material.drained
        ? "target_room_idle"
        : "material_carryover";
    const activeRoomTransition = roomTransition.active;
    const leaseIsActive = runCombat.player.activeLeases.includes(record.collisionLease);
    const collisionLeaseReleased = !leaseIsActive;
    if (
      record.formalTarget.targetRoom !== record.targetRoom
      || record.startTick120 !== record.formalTarget.selectedAtTick120 + 1
      || record.timeline.requestTick120 !== record.startTick120
      || record.timeline.patternCompleteTick120 !== record.startTick120 + PATTERN_DURATION_TICKS120
      || record.combat.patternId !== TRANSITION_PATTERN_ID
      || record.combat.occurrenceId !== TRANSITION_OCCURRENCE_ID
      || record.combat.difficulty !== "NORMAL"
      || record.combat.startTick120 !== record.startTick120
      || runCombat.tick120 !== roomTransition.tick120
      || !(
        roomTransition.currentRoom === TRANSITION_SOURCE_ROOM
        || roomTransition.currentRoom === record.targetRoom
      )
      || (activeRoomTransition !== null && (
        activeRoomTransition.generation !== 1
        || activeRoomTransition.fromRoom !== TRANSITION_SOURCE_ROOM
        || activeRoomTransition.toRoom !== record.targetRoom
        || activeRoomTransition.requestTick120 !== record.timeline.requestTick120
        || activeRoomTransition.worldSwapTick120 !== record.timeline.worldSwapTick120
        || activeRoomTransition.roomReadyTick120 !== record.timeline.roomReadyTick120
        || activeRoomTransition.completeTick120 !== record.timeline.completeTick120
      ))
      || (material === null && record.combat.tick120 !== runCombat.tick120)
      || (material !== null && material.tick120 !== runCombat.tick120)
      || (material !== null && (
        material.sourcePatternId !== TRANSITION_PATTERN_ID
        || material.sourceOccurrenceId !== TRANSITION_OCCURRENCE_ID
        || material.detachedAtTick120 !== record.timeline.patternCompleteTick120
        || material.poolUsage.liveColliders !== 0
        || material.projectiles.some((projectile) =>
          projectile.state !== "residue" || projectile.collisionEnabled)
      ))
      || (material !== null && record.gameplayExit === null)
      || (roomTransition.state === "idle"
        && roomTransition.generation === 1
        && roomTransition.currentRoom === record.targetRoom
        && !collisionLeaseReleased)
      || (roomTransition.active !== null
        && roomTransition.active.completeTick120 > runCombat.tick120
        && collisionLeaseReleased)
      || record.handoffSnapshot.targetRoom !== record.targetRoom
    ) {
      const error = new Error("first-continuation transition projection lost its exact authority lineage");
      record.fatalError = error;
      throw error;
    }
    return Object.freeze({
      authority: "canonical-run-first-continuation-transition-v1" as const,
      extensionPolicy: "EXT-2026-013" as const,
      ownership,
      phase,
      sourceRoom: TRANSITION_SOURCE_ROOM,
      targetRoom: record.targetRoom,
      worldRoom: roomTransition.currentRoom,
      patternId: TRANSITION_PATTERN_ID,
      occurrenceId: TRANSITION_OCCURRENCE_ID,
      difficulty: "NORMAL" as const,
      resolvedSeed: Object.freeze({
        domain: "ext-013-first-continuation-room-transition" as const,
        value: record.combat.seed,
      }),
      transitionEncounterOrdinal: 0 as const,
      transitionDifficultySalt: 0 as const,
      startTick120: record.startTick120,
      timeline: record.timeline,
      roomTransition,
      collisionLeaseReleased,
      combat: record.combat,
      material,
      gameplayExit: record.gameplayExit,
      handoff: record.handoffSnapshot,
    });
  }

  handoff(): CanonicalRunFirstContinuationRoomHandoffReceipt | null {
    return requireChapter(this).handoffReceipt;
  }
}
