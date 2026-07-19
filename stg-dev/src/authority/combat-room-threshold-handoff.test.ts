import {beforeAll, describe, expect, it} from "vitest";

import {
  CanonicalCombatKernel,
  CanonicalRunCombatState,
  advanceCanonicalRunIdleWithRoomThresholdMaterial,
  advanceCanonicalRunRoomThresholdTransitionTick,
  applyCanonicalRoomThresholdMaterialDetachBeforeFlush,
  commitCanonicalRoomThresholdMaterialDetachAfterFlush,
  commitPreparedCanonicalRunRoomThresholdStart,
  failStopCanonicalRunCombatAfterAcceptedTransitionAppend,
  inspectPreparedCanonicalRunRoomThresholdStart,
  prepareCanonicalRoomThresholdMaterialDetach,
  prepareCanonicalRunRoomThresholdStartNextTick,
  type CanonicalCombatStepInput,
  type CanonicalRoomThresholdMaterialCarryover,
  type PreparedCanonicalRoomThresholdMaterialDetach,
  type PreparedCanonicalRunRoomThresholdStart,
} from "./combat-kernel";
import {CanonicalEventBus} from "./events";
import {
  firstContinuationRoomTargetFromCanonicalTransitionReceipt,
  issueCanonicalRunFirstContinuationRoomTransitionReceipt,
  type CanonicalRunFirstContinuationRoomId,
  type CanonicalRunFirstContinuationRoomTargetAvailable,
  type CanonicalRunFirstContinuationRoomTransitionReceipt,
} from "./run-first-continuation-room-target";
import {RoomTransitionAuthority} from "./room-transition";
import {
  CanonicalRunSession,
  type CanonicalRunSessionSnapshot,
  type CanonicalRunSessionStepInput,
} from "./run-session";

const OCCURRENCE_ID = "run:room:0-to-1:transition:transition.room_threshold";
const FORMAL_TARGET_SEEDS = Object.freeze({
  INFORMATION: 0x92d4_860b,
  IN_BETWEEN: 1,
  POLARIZED: 2,
} as const);

interface FormalRunContext {
  readonly session: CanonicalRunSession;
  readonly eventBus: CanonicalEventBus;
  readonly runState: CanonicalRunCombatState;
  readonly formalTarget: CanonicalRunFirstContinuationRoomTargetAvailable;
  readonly publicTarget: CanonicalRunFirstContinuationRoomTargetAvailable;
}

let contextsByTarget: Readonly<Record<CanonicalRunFirstContinuationRoomId, FormalRunContext[]>>;

function runInput(
  tick120: number,
  gaze: CanonicalRunSessionStepInput["gaze"] = {
    skyEyeVisible: true,
    pitchDegrees: 0,
    alignment: 0,
  },
): CanonicalRunSessionStepInput {
  return {
    tick120,
    movement: {x: 0, y: 0},
    signalActive: false,
    focused: false,
    gaze,
  };
}

function reachFormalRun(rawRunSeed: number): FormalRunContext {
  const session = new CanonicalRunSession({
    rawRunSeed: {domain: "raw-run-seed", value: rawRunSeed},
    grazeRadiusPx: 18,
    projectileDamage: 1,
    projectilePoolClasses: {"bullet.micro.notch_e": "micro"},
  });
  let snapshot: CanonicalRunSessionSnapshot = session.snapshot();
  while (snapshot.tick120 < 960) {
    const tick120 = snapshot.tick120 + 1;
    snapshot = session.step({
      ...runInput(tick120),
      signalActive: tick120 === 1 || tick120 === 3,
    });
  }
  while (snapshot.tick120 < 1_021) {
    snapshot = session.step(runInput(snapshot.tick120 + 1, {
      skyEyeVisible: true,
      pitchDegrees: 60,
      alignment: 1,
    }));
  }
  while (snapshot.phase !== "room_sampling" && snapshot.tick120 < 3_360) {
    snapshot = session.step(runInput(snapshot.tick120 + 1));
  }
  const handoffTick120 = snapshot.handoff.atTick120;
  if (snapshot.phase !== "room_sampling" || handoffTick120 === null) {
    throw new Error("formal Room Threshold fixture did not reach the first room");
  }
  while (snapshot.tick120 < handoffTick120 + 1_702) {
    snapshot = session.step(runInput(snapshot.tick120 + 1));
  }
  if (snapshot.firstContinuationRoomTarget.availability !== "available") {
    throw new Error("formal Room Threshold fixture did not reach H+1702 target selection");
  }
  const internals = session as unknown as Readonly<{
    bus: CanonicalEventBus;
    combatState: CanonicalRunCombatState | null;
    firstContinuationRoomTargetValue: CanonicalRunFirstContinuationRoomTargetAvailable | null;
  }>;
  if (internals.combatState === null || internals.firstContinuationRoomTargetValue === null) {
    throw new Error("formal Room Threshold fixture lost its private Run capabilities");
  }
  if (internals.combatState.snapshot().tick120 !== snapshot.tick120) {
    throw new Error("formal Room Threshold fixture Run state lost H+1702 synchronization");
  }
  return Object.freeze({
    session,
    eventBus: internals.bus,
    runState: internals.combatState,
    formalTarget: internals.firstContinuationRoomTargetValue,
    publicTarget: snapshot.firstContinuationRoomTarget,
  });
}

beforeAll(() => {
  contextsByTarget = Object.freeze({
    INFORMATION: [
      reachFormalRun(FORMAL_TARGET_SEEDS.INFORMATION),
      reachFormalRun(FORMAL_TARGET_SEEDS.INFORMATION),
    ],
    IN_BETWEEN: [
      reachFormalRun(FORMAL_TARGET_SEEDS.IN_BETWEEN),
    ],
    POLARIZED: [
      reachFormalRun(FORMAL_TARGET_SEEDS.POLARIZED),
      reachFormalRun(FORMAL_TARGET_SEEDS.POLARIZED),
    ],
  });
}, 30_000);

function takeContext(targetRoom: CanonicalRunFirstContinuationRoomId): FormalRunContext {
  const context = contextsByTarget[targetRoom].shift();
  if (context === undefined) throw new Error(`formal context pool exhausted for ${targetRoom}`);
  expect(context.formalTarget.targetRoom).toBe(targetRoom);
  return context;
}

function inputAt(
  tick120: number,
  movement: Readonly<{x: number; y: number}> = {x: 0, y: 0},
): CanonicalCombatStepInput {
  return {tick120, movement, focused: false, overridePressed: false, overrideReleased: false};
}

function enqueueIntruder(eventBus: CanonicalEventBus, tick120: number, suffix: string): void {
  eventBus.enqueue({
    id: "room.transition.complete",
    tick120,
    entityStableId: `fixture:intruder:${suffix}`,
    localSequence: 0,
    occurrenceKey: `fixture:intruder:${suffix}:tick:${tick120}`,
    payload: {generation: 99, room: "INFORMATION"},
  });
}

function prepareStart(
  context: FormalRunContext,
  movement: Readonly<{x: number; y: number}> = {x: 0, y: 0},
): Readonly<{
  receipt: CanonicalRunFirstContinuationRoomTransitionReceipt;
  roomTransition: RoomTransitionAuthority;
  proposal: PreparedCanonicalRunRoomThresholdStart;
  startTick120: number;
}> {
  const receipt = issueCanonicalRunFirstContinuationRoomTransitionReceipt(
    context.formalTarget,
  );
  const roomTransition = new RoomTransitionAuthority(context.eventBus, "FORCED_ALIGNMENT");
  const startTick120 = context.formalTarget.selectedAtTick120 + 1;
  const proposal = prepareCanonicalRunRoomThresholdStartNextTick(
    context.runState,
    roomTransition,
    receipt,
    inputAt(startTick120, movement),
  );
  return Object.freeze({receipt, roomTransition, proposal, startTick120});
}

function install(
  context: FormalRunContext,
  movement: Readonly<{x: number; y: number}> = {x: 0, y: 0},
) {
  const prepared = prepareStart(context, movement);
  const result = commitPreparedCanonicalRunRoomThresholdStart(prepared.proposal);
  context.runState.flushTick(prepared.startTick120);
  return Object.freeze({
    ...prepared,
    ...result,
    roomTransition: prepared.roomTransition,
  });
}

function advanceToDetach(
  runState: CanonicalRunCombatState,
  kernel: CanonicalCombatKernel,
): Readonly<{
  detach: PreparedCanonicalRoomThresholdMaterialDetach;
  detachTick120: number;
}> {
  const startTick120 = kernel.snapshot().startTick120;
  const detachTick120 = startTick120 + 936;
  let detach: PreparedCanonicalRoomThresholdMaterialDetach | null = null;
  for (
    let tick120 = runState.snapshot().tick120 + 1;
    tick120 <= detachTick120;
    tick120 += 1
  ) {
    const result = advanceCanonicalRunRoomThresholdTransitionTick(kernel, inputAt(tick120));
    detach = result.materialDetach ?? detach;
    if (tick120 < detachTick120) runState.flushTick(tick120);
  }
  if (detach === null) throw new Error("sealed Room Threshold did not return mandatory detach");
  return Object.freeze({detach, detachTick120});
}

function mintMaterial(
  runState: CanonicalRunCombatState,
  kernel: CanonicalCombatKernel,
): Readonly<{
  carryover: CanonicalRoomThresholdMaterialCarryover;
  detachTick120: number;
}> {
  const {detach, detachTick120} = advanceToDetach(runState, kernel);
  applyCanonicalRoomThresholdMaterialDetachBeforeFlush(detach);
  runState.flushTick(detachTick120);
  return Object.freeze({
    carryover: commitCanonicalRoomThresholdMaterialDetachAfterFlush(detach),
    detachTick120,
  });
}

function claimSuccessor(
  runState: CanonicalRunCombatState,
  roomId: CanonicalRunFirstContinuationRoomId,
): CanonicalCombatKernel {
  const snapshot = runState.snapshot();
  return new CanonicalCombatKernel({
    patternId: "transition.room_threshold",
    occurrenceId: `fixture:successor:${snapshot.tick120}`,
    seed: 1,
    startTick120: snapshot.tick120,
    roomId,
    difficulty: "NORMAL",
    initialPlayerPosition: snapshot.playerPosition,
    grazeRadiusPx: snapshot.adapterPolicy.grazeRadiusPx,
    projectileDamage: snapshot.adapterPolicy.projectileDamage,
    projectilePoolClasses: snapshot.adapterPolicy.projectilePoolClasses,
  }, runState);
}

describe("EXT-013 Room Threshold run-combat seam", () => {
  it("consumes only the original formal target, then drains its material and releases the Run", {
    timeout: 30_000,
  }, () => {
    const context = takeContext("INFORMATION");
    expect(() => issueCanonicalRunFirstContinuationRoomTransitionReceipt(
      context.publicTarget,
    )).toThrow(/original formal target/);

    const fakeReceipt = Object.freeze({}) as CanonicalRunFirstContinuationRoomTransitionReceipt;
    const fakeRoom = new RoomTransitionAuthority(context.eventBus, "FORCED_ALIGNMENT");
    expect(() => prepareCanonicalRunRoomThresholdStartNextTick(
      context.runState,
      fakeRoom,
      fakeReceipt,
      inputAt(context.formalTarget.selectedAtTick120 + 1),
    )).toThrow(/receipt is not registered/);

    const foreignContext = contextsByTarget.POLARIZED[0];
    if (foreignContext === undefined) throw new Error("foreign formal Run fixture is missing");
    const foreignReceipt = issueCanonicalRunFirstContinuationRoomTransitionReceipt(
      context.formalTarget,
    );
    const ownerRunBefore = context.runState.snapshot();
    const foreignRunBefore = foreignContext.runState.snapshot();
    const foreignEventsBefore = foreignContext.eventBus.events();
    const foreignPendingBefore = foreignContext.eventBus.pendingEventCount();
    const foreignRoom = new RoomTransitionAuthority(
      foreignContext.eventBus,
      "FORCED_ALIGNMENT",
    );
    const foreignRoomBefore = foreignRoom.snapshot();
    expect(() => prepareCanonicalRunRoomThresholdStartNextTick(
      foreignContext.runState,
      foreignRoom,
      foreignReceipt,
      inputAt(foreignContext.formalTarget.selectedAtTick120 + 1),
    )).toThrow(/different Run combat authority/);
    expect(foreignContext.formalTarget.targetRoom).not.toBe(context.formalTarget.targetRoom);
    expect(context.runState.snapshot()).toEqual(ownerRunBefore);
    expect(foreignContext.runState.snapshot()).toEqual(foreignRunBefore);
    expect(foreignContext.eventBus.events()).toEqual(foreignEventsBefore);
    expect(foreignContext.eventBus.pendingEventCount()).toBe(foreignPendingBefore);
    expect(foreignRoom.snapshot()).toEqual(foreignRoomBefore);
    expect(() => firstContinuationRoomTargetFromCanonicalTransitionReceipt(foreignReceipt))
      .toThrow(/already cancelled/);

    const before = context.runState.snapshot();
    const prepared = prepareStart(context, {x: 1, y: 0});
    const view = inspectPreparedCanonicalRunRoomThresholdStart(prepared.proposal);
    expect(Object.isFrozen(prepared.proposal)).toBe(true);
    expect(Reflect.ownKeys(prepared.proposal)).toEqual([]);
    expect(view).toMatchObject({
      tick120: prepared.startTick120,
      patternId: "transition.room_threshold",
      occurrenceId: OCCURRENCE_ID,
      rawRunSeed: FORMAL_TARGET_SEEDS.INFORMATION,
      transitionEncounterOrdinal: 0,
      transitionDifficultySalt: 0,
      resolvedSeed: (FORMAL_TARGET_SEEDS.INFORMATION ^ 577_557_179) >>> 0,
      targetRoom: "INFORMATION",
      eventIds: ["player.collision.off", "room.transition.begin"],
      playerPreview: {state: "alive", collisionEnabled: false},
      roomTransitionPreview: {
        state: "preparing",
        currentRoom: "FORCED_ALIGNMENT",
        targetRoom: "INFORMATION",
      },
    });
    expect("eventBus" in view).toBe(false);
    expect("drafts" in view).toBe(false);
    expect(context.runState.snapshot()).toEqual(before);
    expect(context.eventBus.pendingEventCount()).toBe(0);
    expect(() => prepareCanonicalRunRoomThresholdStartNextTick(
      context.runState,
      prepared.roomTransition,
      prepared.receipt,
      inputAt(prepared.startTick120),
    )).toThrow(/already owns a Room Threshold start proposal/);

    const started = commitPreparedCanonicalRunRoomThresholdStart(prepared.proposal);
    expect(started.runCombat).toMatchObject({
      tick120: prepared.startTick120,
      activeOccurrenceId: OCCURRENCE_ID,
      pendingFlushTick120: prepared.startTick120,
      player: {collisionEnabled: false, activeLeases: [view.playerLease]},
    });
    expect(() => firstContinuationRoomTargetFromCanonicalTransitionReceipt(prepared.receipt))
      .toThrow(/already committed/);
    expect(context.runState.flushTick(prepared.startTick120).map((event) => event.id)).toEqual([
      "player.collision.off",
      "room.transition.begin",
    ]);

    const completeTick120 = started.roomTransition.active?.completeTick120 as number;
    const detachTick120 = started.combat.startTick120 + 936;
    let detach: PreparedCanonicalRoomThresholdMaterialDetach | null = null;
    for (let tick120 = prepared.startTick120 + 1; tick120 <= detachTick120; tick120 += 1) {
      const result = advanceCanonicalRunRoomThresholdTransitionTick(
        started.kernel,
        inputAt(tick120),
      );
      detach = result.materialDetach ?? detach;
      if (tick120 < detachTick120) {
        const events = context.runState.flushTick(tick120);
        if (tick120 === completeTick120) {
          expect(events.filter((event) =>
            event.id === "room.transition.complete" || event.id === "player.collision.on")
            .map((event) => event.id)).toEqual([
            "room.transition.complete",
            "player.collision.on",
          ]);
        }
      }
    }
    if (detach === null) throw new Error("happy path lost mandatory material detach");
    expect(() => context.runState.flushTick(detachTick120))
      .toThrow(/detach must request release/);
    expect(context.runState.snapshot()).toMatchObject({faulted: false, activeOccurrenceId: OCCURRENCE_ID});
    applyCanonicalRoomThresholdMaterialDetachBeforeFlush(detach);
    context.runState.flushTick(detachTick120);
    expect(() => context.runState.advanceIdleTick(inputAt(detachTick120 + 1), "INFORMATION"))
      .toThrow(/reserved by the active EXT-013/);
    expect(() => claimSuccessor(context.runState, "INFORMATION"))
      .toThrow(/material ownership releases/);

    const beforeDetachProjectiles = started.kernel.snapshot().projectiles;
    const carryover = commitCanonicalRoomThresholdMaterialDetachAfterFlush(detach);
    const detached = carryover.snapshot();
    expect(detached.projectiles).toEqual(beforeDetachProjectiles);
    expect(detached.projectiles.every((projectile) =>
      projectile.state === "residue" && !projectile.collisionEnabled)).toBe(true);
    expect(new Set(detached.projectiles.map((projectile) => projectile.sourceId)))
      .toEqual(new Set(["departing-rule", "arriving-rule"]));
    expect(() => advanceCanonicalRunIdleWithRoomThresholdMaterial(
      context.runState,
      carryover,
      inputAt(detachTick120 + 1),
      "POLARIZED",
    )).toThrow(/formal EXT-013 target/);
    expect(() => advanceCanonicalRunIdleWithRoomThresholdMaterial(
      context.runState,
      carryover,
      {
        ...inputAt(detachTick120 + 1),
        overridePressed: true,
        overrideDirection: {x: 1, y: 0},
      },
      "INFORMATION",
    )).toThrow(/cannot admit an Override edge/);

    const eventsBeforeMaterial = context.runState.events().length;
    let tick120 = detachTick120;
    while (!carryover.snapshot().drained && tick120 < detachTick120 + 500) {
      tick120 += 1;
      advanceCanonicalRunIdleWithRoomThresholdMaterial(
        context.runState,
        carryover,
        inputAt(tick120),
        "INFORMATION",
      );
      context.runState.flushTick(tick120);
    }
    expect(tick120).toBe(detachTick120 + 329);
    expect(carryover.snapshot()).toMatchObject({
      tick120,
      materialCount: 0,
      drained: true,
      poolUsage: {liveColliders: 0, residueVisuals: 0},
    });
    expect(prepared.roomTransition.snapshot()).toMatchObject({
      tick120,
      state: "idle",
      currentRoom: "INFORMATION",
      targetRoom: null,
      generation: 1,
      eventCount: 4,
      active: null,
    });
    const materialEvents = context.runState.events().slice(eventsBeforeMaterial);
    expect(new Set(materialEvents.map((event) => event.id))).toEqual(new Set([
      "projectile.residue.remove",
      "projectile.lifecycle.complete",
    ]));
    expect(materialEvents.filter((event) => event.id === "projectile.residue.remove"))
      .toHaveLength(detached.materialCount);
    context.runState.advanceIdleTick(inputAt(tick120 + 1), "INFORMATION");
    expect(context.runState.flushTick(tick120 + 1)).toEqual([]);
  });

  it("admits IN_BETWEEN, releases the exact lease, and rejects a dirty material queue", {
    timeout: 30_000,
  }, () => {
    const context = takeContext("IN_BETWEEN");
    const installed = install(context);
    const beforeRun = context.runState.snapshot();
    const beforeCombat = installed.kernel.snapshot();
    const beforeRoom = installed.roomTransition.snapshot();
    const nextTick120 = installed.startTick120 + 1;
    expect(() => advanceCanonicalRunRoomThresholdTransitionTick(installed.kernel, {
      ...inputAt(nextTick120),
      overridePressed: true,
      overrideDirection: {x: 1, y: 0},
    })).toThrow(/cannot admit an Override edge/);
    expect(context.runState.snapshot()).toEqual(beforeRun);
    expect(installed.kernel.snapshot()).toEqual(beforeCombat);
    expect(installed.roomTransition.snapshot()).toEqual(beforeRoom);

    const completeTick120 = installed.roomTransition.snapshot().active?.completeTick120 as number;
    for (let tick120 = nextTick120; tick120 <= completeTick120; tick120 += 1) {
      const result = advanceCanonicalRunRoomThresholdTransitionTick(
        installed.kernel,
        inputAt(tick120),
      );
      if (tick120 < completeTick120) {
        expect(result.runCombat.player.activeLeases).toEqual([installed.collisionLease]);
      } else {
        expect(result.collisionLeaseReleased).toBe(true);
        expect(result.roomTransition).toMatchObject({
          state: "idle",
          currentRoom: "IN_BETWEEN",
          targetRoom: null,
        });
      }
      context.runState.flushTick(tick120);
    }
    const {carryover, detachTick120} = mintMaterial(context.runState, installed.kernel);
    const beforeMaterial = carryover.snapshot();
    enqueueIntruder(context.eventBus, detachTick120 + 1, "material-before-advance");
    expect(() => advanceCanonicalRunIdleWithRoomThresholdMaterial(
      context.runState,
      carryover,
      inputAt(detachTick120 + 1),
      "IN_BETWEEN",
    )).toThrow(/empty shared event queue/);
    expect(context.runState.snapshot()).toMatchObject({tick120: detachTick120, faulted: true});
    expect(carryover.snapshot()).toEqual(beforeMaterial);
  });

  it("admits POLARIZED and faults if a caller adds an event before the sealed flush", () => {
    const context = takeContext("POLARIZED");
    const installed = install(context);
    const tick120 = installed.startTick120 + 1;
    advanceCanonicalRunRoomThresholdTransitionTick(installed.kernel, inputAt(tick120));
    const committedBeforeInjection = context.eventBus.events();
    enqueueIntruder(context.eventBus, tick120, "transition-after-return");
    Object.defineProperty(installed.kernel, "snapshot", {
      configurable: true,
      value: () => ({tick120: Number.MAX_SAFE_INTEGER, relativeTick120: 936}),
    });
    expect(() => prepareCanonicalRoomThresholdMaterialDetach(installed.kernel))
      .toThrow(/exact live EXT-013 kernel/);
    expect(() => failStopCanonicalRunCombatAfterAcceptedTransitionAppend(
      context.runState,
      installed.kernel,
      new Error("fixture fault"),
    )).toThrow(/exact active EXT-013 kernel proof/);
    expect(context.runState.snapshot().faulted).toBe(false);
    expect(() => context.runState.flushTick(tick120))
      .toThrow(/sealed tick event batch changed/);
    expect(context.runState.snapshot()).toMatchObject({tick120, faulted: true});
    expect(context.eventBus.events()).toEqual(committedBeforeInjection);
  });

  it("faults material ownership if a caller adds an event after advance", {
    timeout: 30_000,
  }, () => {
    const context = takeContext("POLARIZED");
    const installed = install(context);
    const {carryover, detachTick120} = mintMaterial(context.runState, installed.kernel);
    const tick120 = detachTick120 + 1;
    advanceCanonicalRunIdleWithRoomThresholdMaterial(
      context.runState,
      carryover,
      inputAt(tick120),
      "POLARIZED",
    );
    const committedBeforeInjection = context.eventBus.events();
    enqueueIntruder(context.eventBus, tick120, "material-before-flush");
    expect(() => context.runState.flushTick(tick120))
      .toThrow(/sealed tick event batch changed/);
    expect(context.runState.snapshot()).toMatchObject({tick120, faulted: true});
    expect(context.eventBus.events()).toEqual(committedBeforeInjection);
  });

  it("faults if the idle target-room FSM silently advances outside material ownership", {
    timeout: 30_000,
  }, () => {
    const context = takeContext("INFORMATION");
    const installed = install(context);
    const {carryover, detachTick120} = mintMaterial(context.runState, installed.kernel);
    const tick120 = detachTick120 + 1;
    advanceCanonicalRunIdleWithRoomThresholdMaterial(
      context.runState,
      carryover,
      inputAt(tick120),
      "INFORMATION",
    );
    expect(context.eventBus.pendingEventCount()).toBe(0);
    expect(installed.roomTransition.advance(tick120 + 1_000)).toMatchObject({
      tick120: tick120 + 1_000,
      state: "idle",
      currentRoom: "INFORMATION",
      eventCount: 4,
    });
    expect(context.eventBus.pendingEventCount()).toBe(0);
    expect(() => context.runState.flushTick(tick120))
      .toThrow(/target-room FSM.*lost sealed synchronization/);
    expect(context.runState.snapshot()).toMatchObject({tick120, faulted: true});
  });

  it("withholds EXT-013 capabilities from a direct shared Room Threshold kernel", () => {
    const runState = new CanonicalRunCombatState({
      startTick120: 0,
      initialPlayerPosition: {x: 180, y: 570},
      grazeRadiusPx: 18,
      projectileDamage: 1,
      projectilePoolClasses: {"bullet.micro.notch_e": "micro"},
    });
    const kernel = new CanonicalCombatKernel({
      patternId: "transition.room_threshold",
      occurrenceId: OCCURRENCE_ID,
      seed: 1,
      startTick120: 0,
      roomId: "FORCED_ALIGNMENT",
      difficulty: "NORMAL",
      initialPlayerPosition: {x: 180, y: 570},
      grazeRadiusPx: 18,
      projectileDamage: 1,
      projectilePoolClasses: {"bullet.micro.notch_e": "micro"},
    }, runState);
    expect(() => prepareCanonicalRoomThresholdMaterialDetach(kernel))
      .toThrow(/exact live EXT-013 kernel/);
    kernel.advanceTick(inputAt(1));
    expect(() => failStopCanonicalRunCombatAfterAcceptedTransitionAppend(
      runState,
      kernel,
      new Error("fixture fault"),
    )).toThrow(/exact active EXT-013 kernel proof/);
    expect(runState.snapshot().faulted).toBe(false);
  });
});
