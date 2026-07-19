import {beforeAll, describe, expect, it} from "vitest";

import {
  advanceCanonicalRunFirstContinuationSuccessorMaterialHold,
  CanonicalRunCombatState,
  commitPreparedCanonicalRunFirstContinuationNextOccurrenceAdmission,
  commitPreparedCanonicalRunFirstContinuationSuccessorMaterialTransfer,
  inspectPreparedCanonicalRunFirstContinuationNextOccurrenceAdmission,
  inspectPreparedCanonicalRunFirstContinuationSuccessorMaterialTransfer,
  prepareCanonicalRunFirstContinuationNextOccurrenceAdmission,
  prepareCanonicalRunFirstContinuationSuccessorMaterialTransfer,
  type CanonicalCombatSnapshot,
  type CanonicalCombatStepInput,
} from "../../combat-kernel";
import {runtime60DeadlineTick} from "../../clock";
import {CanonicalEventBus} from "../../events";
import {PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND} from "../../pattern-executor";
import {
  issueCanonicalRunFirstRoomMetricSourceReceipt,
  type CanonicalRunFirstRoomClosureCaptureAvailable,
  type CanonicalRunFirstRoomMetricSourceReceipt,
} from "../../run-behavior-capture";
import {
  type CanonicalRunBehaviorFactLedger,
  type CanonicalRunFirstRoomRecentInputSupplementReceipt,
} from "../../run-behavior-facts";
import {
  createCanonicalRunFirstContinuationRoomTarget,
  type CanonicalRunFirstContinuationRoomTargetAvailable,
} from "../../run-first-continuation-room-target";
import {
  createCanonicalRunFirstRoomMetricProjection,
  issueCanonicalRunFirstRoomMetricProjectionReceipt,
} from "../../run-metric-projection";
import {
  CanonicalRunSession,
  type CanonicalRunSessionSnapshot,
  type CanonicalRunSessionStepInput,
} from "../../run-session";
import {
  CanonicalRunFirstContinuationTransitionChapter,
  inspectCanonicalRunFirstContinuationRoomHandoffReceipt,
} from "./first-continuation-transition";
import {
  advanceCanonicalRunFirstContinuationSuccessorCompleteHold,
  advanceCanonicalRunFirstContinuationSuccessorPreRead,
  advanceCanonicalRunFirstContinuationSuccessorRead,
  advanceCanonicalRunFirstContinuationSuccessorTail,
  cancelPreparedCanonicalRunFirstContinuationRoomAdmission,
  closeCanonicalRunFirstContinuationSuccessorSlice,
  commitPreparedCanonicalRunFirstContinuationRoomAdmission,
  inspectCanonicalRunFirstContinuationDormantSuccessorOwner,
  prepareCanonicalRunFirstContinuationRoomAdmission,
  startCanonicalRunFirstContinuationSuccessorRead,
} from "./first-continuation-room-admission-authority";
import {
  advanceCanonicalRunFirstContinuationNextOccurrencePreRead,
  inspectCanonicalRunFirstContinuationNextOccurrenceOwner,
  startCanonicalRunFirstContinuationNextOccurrenceRead,
} from "./first-continuation-next-occurrence";

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

function combatInput(tick120: number): CanonicalCombatStepInput {
  return {
    tick120,
    movement: {x: 0, y: 0},
    focused: false,
    overridePressed: false,
    overrideReleased: false,
  };
}

function movementToward(
  from: Readonly<{x: number; y: number}>,
  to: Readonly<{x: number; y: number}>,
  maxDistancePx = 0,
): Readonly<{x: number; y: number}> {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distancePx = Math.hypot(dx, dy);
  if (distancePx === 0) return Object.freeze({x: 0, y: 0});
  const divisor = Math.max(distancePx, maxDistancePx);
  return Object.freeze({x: dx / divisor, y: dy / divisor});
}

function moveTowardPoint(
  combat: CanonicalCombatSnapshot,
  tick120: number,
  target: Readonly<{x: number; y: number}>,
): CanonicalCombatStepInput {
  return {
    ...combatInput(tick120),
    movement: movementToward(
      combat.playerPosition,
      target,
      PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND / 120,
    ),
  };
}

interface FormalTargetSource {
  readonly sourceReceipt: CanonicalRunFirstRoomMetricSourceReceipt;
  readonly supplementReceipt: CanonicalRunFirstRoomRecentInputSupplementReceipt;
  readonly selectedAtTick120: number;
  readonly initialPlayerPosition: Readonly<{x: number; y: number}>;
}

let formalTargetSource: FormalTargetSource;

function produceFormalTargetSource(): FormalTargetSource {
  const session = new CanonicalRunSession({
    rawRunSeed: {domain: "raw-run-seed", value: 1},
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
  const firstRoomStartTick120 = snapshot.handoff.atTick120;
  if (snapshot.phase !== "room_sampling" || firstRoomStartTick120 === null) {
    throw new Error("chapter fixture did not reach the first room");
  }
  while (snapshot.tick120 < firstRoomStartTick120 + 1_702) {
    snapshot = session.step(runInput(snapshot.tick120 + 1));
  }
  const internals = session as unknown as Readonly<{
    behaviorFacts: CanonicalRunBehaviorFactLedger;
    combatState: CanonicalRunCombatState | null;
    firstRoomClosureCaptureValue: CanonicalRunFirstRoomClosureCaptureAvailable | null;
  }>;
  if (
    snapshot.firstContinuationRoomTarget.availability !== "available"
    || internals.combatState === null
    || internals.firstRoomClosureCaptureValue === null
  ) {
    throw new Error("chapter fixture lost its exact H+1702 authority capabilities");
  }
  return Object.freeze({
    sourceReceipt: issueCanonicalRunFirstRoomMetricSourceReceipt(
      internals.firstRoomClosureCaptureValue,
    ),
    supplementReceipt: internals.behaviorFacts.issueFirstRoomRecentInputSupplementReceipt(),
    selectedAtTick120: snapshot.tick120,
    initialPlayerPosition: internals.combatState.snapshot().playerPosition,
  });
}

function freshFormalTarget(projectileDamage = 1): Readonly<{
  eventBus: CanonicalEventBus;
  runState: CanonicalRunCombatState;
  formalTarget: CanonicalRunFirstContinuationRoomTargetAvailable;
}> {
  const eventBus = new CanonicalEventBus();
  const runState = new CanonicalRunCombatState({
    startTick120: formalTargetSource.selectedAtTick120,
    initialPlayerPosition: formalTargetSource.initialPlayerPosition,
    grazeRadiusPx: 18,
    projectileDamage,
    projectilePoolClasses: {"bullet.micro.notch_e": "micro"},
  }, eventBus);
  const projection = createCanonicalRunFirstRoomMetricProjection(
    formalTargetSource.sourceReceipt,
    formalTargetSource.supplementReceipt,
  );
  const projectionReceipt = issueCanonicalRunFirstRoomMetricProjectionReceipt(projection);
  return Object.freeze({
    eventBus,
    runState,
    formalTarget: createCanonicalRunFirstContinuationRoomTarget(projectionReceipt, runState),
  });
}

beforeAll(() => {
  formalTargetSource = produceFormalTargetSource();
}, 30_000);

function reachLiveMaterialHandoff() {
  const fixture = freshFormalTarget();
  const startTick120 = fixture.formalTarget.selectedAtTick120 + 1;
  const chapter = CanonicalRunFirstContinuationTransitionChapter.start({
    formalTarget: fixture.formalTarget,
    runState: fixture.runState,
    eventBus: fixture.eventBus,
    input: combatInput(startTick120),
  });
  let transition = chapter.snapshot();
  while (transition.combat.tick120 < transition.timeline.patternCompleteTick120) {
    transition = chapter.step(combatInput(transition.combat.tick120 + 1));
  }
  const handoffReceipt = chapter.handoff();
  if (handoffReceipt === null) throw new Error("formal admission fixture lost its handoff");
  return Object.freeze({fixture, chapter, transition, handoffReceipt});
}

describe("first continuation transition chapter owner", () => {
  it("atomically transfers a live material handoff to one dormant successor owner", {
    timeout: 30_000,
  }, () => {
    const {fixture, chapter, transition, handoffReceipt} = reachLiveMaterialHandoff();
    const handoffTick120 = transition.combat.tick120;
    expect(transition.material).toMatchObject({drained: false});
    expect(transition.material?.materialCount).toBeGreaterThan(0);

    expect(() => prepareCanonicalRunFirstContinuationRoomAdmission(
      Object.freeze({}) as typeof handoffReceipt,
    )).toThrow(/not registered/);
    const eventsBefore = fixture.eventBus.events().length;
    const runBefore = fixture.runState.snapshot();
    const materialBefore = transition.material;
    const preparation = prepareCanonicalRunFirstContinuationRoomAdmission(handoffReceipt);
    if (preparation.state !== "prepared") {
      throw new Error(`expected admissible fixture, received ${preparation.reason}`);
    }
    expect(preparation.view).toMatchObject({
      state: "prepared",
      preparedAtTick120: handoffTick120,
      handoff: {targetRoom: fixture.formalTarget.targetRoom, atTick120: handoffTick120},
      plan: {
        targetRoom: fixture.formalTarget.targetRoom,
        occurrence: {roomOrdinal: 1, encounterOrdinal: 0},
      },
      combinedPoolAdmission: {
        state: "admissible",
        admissible: true,
        reservationCommitted: false,
      },
      transfer: {
        tick120: handoffTick120,
        targetRoom: fixture.formalTarget.targetRoom,
        materialDraining: true,
        liveColliders: 0,
        canonicalEventWrites: 0,
        tickAdvance: 0,
      },
      canonicalEventWrites: 0,
      tickAdvance: 0,
    });
    expect(fixture.runState.snapshot()).toEqual(runBefore);
    expect(fixture.eventBus.events()).toHaveLength(eventsBefore);
    expect(fixture.eventBus.pendingEventCount()).toBe(0);
    expect(() => prepareCanonicalRunFirstContinuationRoomAdmission(handoffReceipt))
      .toThrow(/in-flight admission proposal/);

    const owner = commitPreparedCanonicalRunFirstContinuationRoomAdmission(
      preparation.proposal,
    );
    const successor = inspectCanonicalRunFirstContinuationDormantSuccessorOwner(owner);
    expect(Object.isFrozen(owner)).toBe(true);
    expect(Reflect.ownKeys(owner)).toEqual([]);
    expect(successor).toMatchObject({
      phase: "dormant",
      tick120: handoffTick120,
      targetRoom: fixture.formalTarget.targetRoom,
      patternId: preparation.view.plan.occurrence.patternId,
      occurrenceId: preparation.view.plan.occurrence.occurrenceId,
      difficulty: preparation.view.plan.occurrence.difficulty,
      combinedPoolAdmission: {
        state: "committed",
        evaluation: {state: "admissible", admissible: true},
        reservationCommitted: true,
      },
      material: {
        tick120: handoffTick120,
        materialCount: materialBefore?.materialCount,
        drained: false,
        poolUsage: {liveColliders: 0},
      },
      combat: null,
      targetVisible: false,
      nextMasterTickAction: "telegraph",
      inputOwnership: {
        movement: "continued",
        focus: "continued",
        signal: "requested-unconsumed",
        gazeInput: "requested-unconsumed",
        flowerAuthority: "frozen",
        gazeAuthority: "frozen",
        override: "locked",
      },
    });
    expect(fixture.runState.snapshot()).toEqual(runBefore);
    expect(fixture.eventBus.events()).toHaveLength(eventsBefore);
    expect(fixture.eventBus.pendingEventCount()).toBe(0);
    expect(chapter.snapshot()).toMatchObject({
      ownership: "transferred-to-dormant-successor",
      material: materialBefore,
    });
    expect(inspectCanonicalRunFirstContinuationRoomHandoffReceipt(handoffReceipt))
      .toEqual(preparation.view.handoff);
    expect(() => chapter.step(combatInput(handoffTick120 + 1)))
      .toThrow(/ownership was transferred/);
    expect(() => fixture.runState.stepIdle(
      combatInput(handoffTick120 + 1),
      fixture.formalTarget.targetRoom,
    )).toThrow(/dormant successor owner/);
    expect(() => prepareCanonicalRunFirstContinuationRoomAdmission(handoffReceipt))
      .toThrow(/already committed/);
    expect(() => commitPreparedCanonicalRunFirstContinuationRoomAdmission(
      preparation.proposal,
    )).toThrow(/proposal is committed/);
    expect(fixture.runState.snapshot()).toEqual(runBefore);
    expect(fixture.eventBus.events()).toHaveLength(eventsBefore);
  });

  it("owns H+1 through H+158 as collisionless telegraph and entry", {
    timeout: 30_000,
  }, () => {
    const {fixture, chapter, transition, handoffReceipt} = reachLiveMaterialHandoff();
    const preparation = prepareCanonicalRunFirstContinuationRoomAdmission(handoffReceipt);
    if (preparation.state !== "prepared") {
      throw new Error(`expected admissible fixture, received ${preparation.reason}`);
    }
    const owner = commitPreparedCanonicalRunFirstContinuationRoomAdmission(
      preparation.proposal,
    );
    const dormant = inspectCanonicalRunFirstContinuationDormantSuccessorOwner(owner);
    const handoffTick120 = transition.combat.tick120;
    const runAtHandoff = fixture.runState.snapshot();
    const eventsAtHandoff = fixture.eventBus.events();
    const reservationAtHandoff = JSON.stringify(dormant.combinedPoolAdmission.reservation);
    expect(dormant).toMatchObject({
      phase: "dormant",
      tick120: handoffTick120,
      relativeTick120: 0,
      boundaryTicks120: {
        handoffTick120,
        telegraphStartTick120: handoffTick120 + 1,
        entryStartTick120: handoffTick120 + 63,
        readStartTick120: handoffTick120 + 159,
      },
      runCombat: {activeOccurrenceId: null, pendingFlushTick120: null},
      material: {poolUsage: {liveColliders: 0}},
      combat: null,
      targetVisible: false,
      nextMasterTickAction: "telegraph",
    });

    expect(() => advanceCanonicalRunFirstContinuationSuccessorPreRead(
      owner,
      combatInput(handoffTick120),
    )).toThrow(/advance one tick at a time/);
    expect(() => advanceCanonicalRunFirstContinuationSuccessorPreRead(owner, {
      ...combatInput(handoffTick120 + 1),
      overridePressed: true,
      overrideDirection: {x: 1, y: 0},
    })).toThrow(/cannot admit an Override edge/);
    expect(fixture.runState.snapshot()).toEqual(runAtHandoff);
    expect(fixture.eventBus.events()).toEqual(eventsAtHandoff);
    expect(inspectCanonicalRunFirstContinuationDormantSuccessorOwner(owner)).toEqual(dormant);

    const initialX = runAtHandoff.playerPosition.x;
    let successor = advanceCanonicalRunFirstContinuationSuccessorPreRead(owner, {
      ...combatInput(handoffTick120 + 1),
      movement: {x: 1, y: 0},
      focused: true,
    });
    expect(successor).toMatchObject({
      phase: "telegraph",
      tick120: handoffTick120 + 1,
      relativeTick120: 1,
      runCombat: {
        focused: true,
        activeOccurrenceId: null,
        pendingFlushTick120: null,
      },
      combat: null,
    });
    expect(successor.runCombat.playerPosition.x).toBeGreaterThan(initialX);
    expect(successor.material.materialCount).toBeGreaterThan(0);

    while (successor.tick120 < handoffTick120 + 62) {
      successor = advanceCanonicalRunFirstContinuationSuccessorPreRead(
        owner,
        combatInput(successor.tick120 + 1),
      );
      expect(successor.material.poolUsage.liveColliders).toBe(0);
      expect(successor.runCombat.activeOccurrenceId).toBeNull();
      expect(successor.combat).toBeNull();
    }
    expect(successor).toMatchObject({
      phase: "telegraph",
      tick120: handoffTick120 + 62,
      nextMasterTickAction: "entry",
    });

    successor = advanceCanonicalRunFirstContinuationSuccessorPreRead(
      owner,
      combatInput(handoffTick120 + 63),
    );
    expect(successor).toMatchObject({
      phase: "entry",
      tick120: handoffTick120 + 63,
      nextMasterTickAction: "continue-entry",
    });
    while (successor.tick120 < handoffTick120 + 158) {
      successor = advanceCanonicalRunFirstContinuationSuccessorPreRead(
        owner,
        combatInput(successor.tick120 + 1),
      );
      expect(successor.material.poolUsage.liveColliders).toBe(0);
      expect(successor.runCombat.activeOccurrenceId).toBeNull();
      expect(successor.combat).toBeNull();
    }
    expect(successor).toMatchObject({
      phase: "entry",
      tick120: handoffTick120 + 158,
      relativeTick120: 158,
      nextMasterTickAction: "claim-read",
      runCombat: {activeOccurrenceId: null, pendingFlushTick120: null},
      combat: null,
      targetVisible: false,
    });
    expect(JSON.stringify(successor.combinedPoolAdmission.reservation))
      .toBe(reservationAtHandoff);
    expect(successor.plan).toBe(dormant.plan);
    const preReadEvents = fixture.eventBus.events().slice(eventsAtHandoff.length);
    expect(preReadEvents.every((event) =>
      event.id === "projectile.residue.remove"
      || event.id === "projectile.lifecycle.complete")).toBe(true);

    const runBeforeRead = fixture.runState.snapshot();
    const eventsBeforeRead = fixture.eventBus.events();
    expect(() => advanceCanonicalRunFirstContinuationSuccessorPreRead(
      owner,
      combatInput(handoffTick120 + 159),
    )).toThrow(/stops before the exact READ claim tick/);
    expect(fixture.runState.snapshot()).toEqual(runBeforeRead);
    expect(fixture.eventBus.events()).toEqual(eventsBeforeRead);
    expect(() => chapter.step(combatInput(handoffTick120 + 159)))
      .toThrow(/ownership was transferred/);
    expect(() => fixture.runState.stepIdle(
      combatInput(handoffTick120 + 159),
      fixture.formalTarget.targetRoom,
    )).toThrow(/dormant successor owner/);
  });

  it("installs READ, starts reserved successor combat, and closes its exact slice", {
    timeout: 30_000,
  }, () => {
    const {fixture, chapter, transition, handoffReceipt} = reachLiveMaterialHandoff();
    const preparation = prepareCanonicalRunFirstContinuationRoomAdmission(handoffReceipt);
    if (preparation.state !== "prepared") {
      throw new Error(`expected admissible fixture, received ${preparation.reason}`);
    }
    const owner = commitPreparedCanonicalRunFirstContinuationRoomAdmission(
      preparation.proposal,
    );
    const handoffTick120 = transition.combat.tick120;
    let successor = inspectCanonicalRunFirstContinuationDormantSuccessorOwner(owner);
    while (successor.tick120 < handoffTick120 + 158) {
      successor = advanceCanonicalRunFirstContinuationSuccessorPreRead(
        owner,
        combatInput(successor.tick120 + 1),
      );
    }
    expect(successor).toMatchObject({
      phase: "entry",
      tick120: handoffTick120 + 158,
      nextMasterTickAction: "claim-read",
      combat: null,
    });
    const runBeforeRead = fixture.runState.snapshot();
    const eventsBeforeRead = fixture.eventBus.events();
    const reservationAtHandoff = JSON.stringify(successor.combinedPoolAdmission.reservation);

    expect(() => startCanonicalRunFirstContinuationSuccessorRead(
      owner,
      combatInput(handoffTick120 + 158),
    )).toThrow(/advance one tick at a time/);
    expect(() => startCanonicalRunFirstContinuationSuccessorRead(owner, {
      ...combatInput(handoffTick120 + 159),
      overridePressed: true,
      overrideDirection: {x: 1, y: 0},
    })).toThrow(/Override locked/);
    expect(fixture.runState.snapshot()).toEqual(runBeforeRead);
    expect(fixture.eventBus.events()).toEqual(eventsBeforeRead);

    const read = startCanonicalRunFirstContinuationSuccessorRead(owner, {
      ...combatInput(handoffTick120 + 159),
      movement: {x: 1, y: 0},
      focused: true,
    });
    expect(read).toMatchObject({
      phase: "read",
      tick120: handoffTick120 + 159,
      relativeTick120: 159,
      nextMasterTickAction: "advance-read",
      runCombat: {
        tick120: handoffTick120 + 159,
        focused: true,
        activeOccurrenceId: preparation.view.plan.occurrence.occurrenceId,
        pendingFlushTick120: null,
      },
      combat: {
        tick120: handoffTick120 + 159,
        relativeTick120: 0,
        patternId: preparation.view.plan.occurrence.patternId,
        occurrenceId: preparation.view.plan.occurrence.occurrenceId,
        projectiles: [],
        poolUsage: {liveColliders: 0},
      },
      material: {
        tick120: handoffTick120 + 159,
        poolUsage: {liveColliders: 0},
      },
      targetVisible: false,
    });
    expect(read.runCombat.claimedOccurrenceIds.filter((occurrenceId) =>
      occurrenceId === preparation.view.plan.occurrence.occurrenceId)).toHaveLength(1);
    expect(read.plan).toBe(successor.plan);
    expect(JSON.stringify(read.combinedPoolAdmission.reservation)).toBe(reservationAtHandoff);
    expect(fixture.eventBus.pendingEventCount()).toBe(0);
    expect(fixture.eventBus.events().slice(eventsBeforeRead.length).every((event) =>
      event.id === "projectile.residue.remove"
      || event.id === "projectile.lifecycle.complete")).toBe(true);

    const runAfterRead = fixture.runState.snapshot();
    const eventsAfterRead = fixture.eventBus.events();
    expect(() => startCanonicalRunFirstContinuationSuccessorRead(
      owner,
      combatInput(handoffTick120 + 160),
    )).toThrow(/exact H\+158 entry boundary/);
    expect(() => advanceCanonicalRunFirstContinuationSuccessorPreRead(
      owner,
      combatInput(handoffTick120 + 160),
    )).toThrow(/lost its exact committed owner/);
    expect(() => chapter.step(combatInput(handoffTick120 + 160)))
      .toThrow(/ownership was transferred/);
    expect(() => fixture.runState.stepIdle(
      combatInput(handoffTick120 + 160),
      fixture.formalTarget.targetRoom,
    )).toThrow(/dormant successor owner/);
    expect(fixture.runState.snapshot()).toEqual(runAfterRead);
    expect(fixture.eventBus.events()).toEqual(eventsAfterRead);

    expect(() => advanceCanonicalRunFirstContinuationSuccessorRead(owner, {
      ...combatInput(handoffTick120 + 160),
      overridePressed: true,
      overrideDirection: {x: 1, y: 0},
    })).toThrow(/before Local Resistance/);
    expect(fixture.runState.snapshot()).toEqual(runAfterRead);
    expect(fixture.eventBus.events()).toEqual(eventsAfterRead);

    const active = advanceCanonicalRunFirstContinuationSuccessorRead(
      owner,
      combatInput(handoffTick120 + 160),
    );
    expect(active).toMatchObject({
      phase: "read",
      tick120: handoffTick120 + 160,
      relativeTick120: 160,
      nextMasterTickAction: "advance-read",
      runCombat: {
        tick120: handoffTick120 + 160,
        activeOccurrenceId: preparation.view.plan.occurrence.occurrenceId,
        pendingFlushTick120: null,
      },
      combat: {
        tick120: handoffTick120 + 160,
        relativeTick120: 1,
        patternId: preparation.view.plan.occurrence.patternId,
        occurrenceId: preparation.view.plan.occurrence.occurrenceId,
      },
      material: {
        tick120: handoffTick120 + 160,
        poolUsage: {liveColliders: 0},
      },
      inputOwnership: {override: "locked"},
    });
    if (active.combat === null) throw new Error("READ combat disappeared after H+160");
    let firstProjectile = active;
    while (
      firstProjectile.combat !== null
      && firstProjectile.combat.projectiles.length === 0
      && firstProjectile.combat.relativeTick120 < 600
    ) {
      firstProjectile = advanceCanonicalRunFirstContinuationSuccessorRead(
        owner,
        combatInput(firstProjectile.tick120 + 1),
      );
    }
    if (firstProjectile.combat === null) throw new Error("READ combat disappeared before spawn");
    expect(firstProjectile.combat.projectiles.length).toBeGreaterThan(0);
    const reservation = firstProjectile.combinedPoolAdmission.reservation;
    const reservedClass = reservation.projectilePoolClass;
    expect(firstProjectile.combat.poolUsage.allocatedSlots[reservedClass])
      .toBeLessThanOrEqual(reservation.requestedProjectileSlots);
    for (const poolClass of ["micro", "medium", "heavy", "splitChildren"] as const) {
      expect(
        firstProjectile.material.poolUsage.allocatedSlots[poolClass]
          + firstProjectile.combat.poolUsage.allocatedSlots[poolClass],
      ).toBeLessThanOrEqual(reservation.combinedAllocatedSlots[poolClass]);
      if (poolClass !== reservedClass) {
        expect(firstProjectile.combat.poolUsage.allocatedSlots[poolClass]).toBe(0);
      }
    }
    expect(
      firstProjectile.material.poolUsage.residueVisuals
        + firstProjectile.combat.poolUsage.residueVisuals,
    ).toBeLessThanOrEqual(reservation.combinedResidueVisuals);
    expect(firstProjectile.material.projectiles.every((projectile) =>
      projectile.state === "residue" && !projectile.collisionEnabled)).toBe(true);
    expect(fixture.eventBus.events().slice(eventsAfterRead.length).some((event) =>
      event.id === "projectile.spawn.commit")).toBe(true);
    expect(fixture.eventBus.pendingEventCount()).toBe(0);

    let slice = firstProjectile;
    while (slice.nextMasterTickAction === "advance-read") {
      if (slice.tick120 >= slice.boundaryTicks120.sliceCompleteTick120) {
        throw new Error("successor READ crossed its authored slice boundary");
      }
      slice = advanceCanonicalRunFirstContinuationSuccessorRead(
        owner,
        combatInput(slice.tick120 + 1),
      );
    }
    expect(slice.nextMasterTickAction === "advance-tail"
      || slice.nextMasterTickAction === "close-slice").toBe(true);
    expect(slice.runCombat).toMatchObject({
      activeOccurrenceId: null,
      pendingFlushTick120: null,
    });
    expect(slice.combat).toMatchObject({
      occurrenceId: preparation.view.plan.occurrence.occurrenceId,
      patternComplete: true,
      digitalBodiesDrained: true,
      poolUsage: {liveColliders: 0},
    });
    expect(slice.combat?.projectiles.every((projectile) =>
      projectile.state === "residue" && !projectile.collisionEnabled)).toBe(true);

    while (slice.nextMasterTickAction === "advance-tail") {
      if (slice.tick120 >= slice.boundaryTicks120.sliceCompleteTick120 - 1) {
        throw new Error("successor tail crossed its exact close boundary");
      }
      slice = advanceCanonicalRunFirstContinuationSuccessorTail(
        owner,
        combatInput(slice.tick120 + 1),
      );
    }
    expect(slice).toMatchObject({
      tick120: slice.boundaryTicks120.sliceCompleteTick120 - 1,
      nextMasterTickAction: "close-slice",
      runCombat: {
        activeOccurrenceId: null,
        pendingFlushTick120: null,
      },
    });
    const runBeforeCloseTransfer = fixture.runState.snapshot();
    const eventsBeforeCloseTransfer = fixture.eventBus.events();
    const eventSerializationBeforeCloseTransfer = fixture.eventBus.canonicalSerialization();
    expect(() => prepareCanonicalRunFirstContinuationSuccessorMaterialTransfer(owner))
      .toThrow(/exact flushed slice-close boundary/);
    expect(fixture.runState.snapshot()).toEqual(runBeforeCloseTransfer);
    expect(fixture.eventBus.events()).toEqual(eventsBeforeCloseTransfer);
    expect(fixture.eventBus.canonicalSerialization())
      .toBe(eventSerializationBeforeCloseTransfer);

    const complete = closeCanonicalRunFirstContinuationSuccessorSlice(
      owner,
      combatInput(slice.tick120 + 1),
    );
    expect(complete).toMatchObject({
      terminalPolicy: "EXT-2026-016",
      phase: "complete",
      tick120: complete.boundaryTicks120.sliceCompleteTick120,
      nextMasterTickAction: "advance-complete-hold",
      runCombat: {
        activeOccurrenceId: null,
        pendingFlushTick120: null,
      },
      material: {
        drained: true,
        materialCount: 0,
        poolUsage: {liveColliders: 0},
      },
      combat: {
        occurrenceId: preparation.view.plan.occurrence.occurrenceId,
        patternComplete: true,
        digitalBodiesDrained: true,
        poolUsage: {liveColliders: 0},
      },
    });
    expect(complete.combat?.projectiles.every((projectile) =>
      projectile.state === "residue" && !projectile.collisionEnabled)).toBe(true);
    expect(complete.combat?.projectiles.length).toBeGreaterThan(0);
    expect(complete.combat?.projectileLifecycleDrained).toBe(false);
    expect(complete.material.poolUsage.allocatedSlots).toEqual({
      micro: 78,
      medium: 0,
      heavy: 0,
      splitChildren: 0,
    });
    if (complete.combat === null) {
      throw new Error("successor slice close lost its collisionless material");
    }
    expect(complete.combat.projectiles).toHaveLength(46);
    expect(complete.combat.poolUsage).toEqual({
      active: {micro: 46, medium: 0, heavy: 0, splitChildren: 0},
      allocatedSlots: {micro: 80, medium: 0, heavy: 0, splitChildren: 0},
      liveColliders: 0,
      residueVisuals: 46,
    });

    const closeProjectiles = complete.combat.projectiles;
    const closeRngCallsConsumed = complete.combat.rngCallsConsumed;
    const closeClaims = complete.runCombat.claimedOccurrenceIds;
    const closeEventSerialization = fixture.eventBus.canonicalSerialization();
    const transfer = prepareCanonicalRunFirstContinuationSuccessorMaterialTransfer(owner);
    expect(inspectPreparedCanonicalRunFirstContinuationSuccessorMaterialTransfer(transfer))
      .toMatchObject({
        authority:
          "canonical-run-first-continuation-successor-material-transfer-v1",
        extensionPolicy: "EXT-2026-019",
        tick120: complete.tick120,
        sourcePatternId: preparation.view.plan.occurrence.patternId,
        sourceOccurrenceId: preparation.view.plan.occurrence.occurrenceId,
        materialCount: 46,
        poolUsage: {
          active: {micro: 46, medium: 0, heavy: 0, splitChildren: 0},
          allocatedSlots: {micro: 80, medium: 0, heavy: 0, splitChildren: 0},
          liveColliders: 0,
          residueVisuals: 46,
        },
        predecessorMaterialLease: "retire-on-commit",
        gameplayAuthority: "released",
        roomCompletion: "withheld",
        roomHandoff: "withheld",
        nextOccurrenceAdmission:
          "withheld-pending-plan-and-combined-pool-admission",
        canonicalEventWrites: 0,
        rngCallsConsumedByTransfer: 0,
        tickAdvance: 0,
      });
    expect(() => prepareCanonicalRunFirstContinuationSuccessorMaterialTransfer(owner))
      .toThrow(/in-flight|prepared lease/);
    expect(fixture.runState.snapshot()).toEqual(complete.runCombat);
    expect(fixture.eventBus.canonicalSerialization()).toBe(closeEventSerialization);

    const materialOwner =
      commitPreparedCanonicalRunFirstContinuationSuccessorMaterialTransfer(transfer);
    const transferredMaterial = materialOwner.snapshot();
    expect(transferredMaterial).toMatchObject({
      authority: "canonical-run-occurrence-material-carryover-v1",
      extensionPolicy: "EXT-2026-019",
      sourcePatternId: preparation.view.plan.occurrence.patternId,
      sourceOccurrenceId: preparation.view.plan.occurrence.occurrenceId,
      transferredAtTick120: complete.tick120,
      tick120: complete.tick120,
      materialCount: 46,
      drained: false,
      poolUsage: {
        active: {micro: 46, medium: 0, heavy: 0, splitChildren: 0},
        allocatedSlots: {micro: 80, medium: 0, heavy: 0, splitChildren: 0},
        liveColliders: 0,
        residueVisuals: 46,
      },
      rngCallsConsumed: closeRngCallsConsumed,
      predecessorMaterialLease: "retired",
      gameplayAuthority: "released",
      roomCompletion: "withheld",
      roomHandoff: "withheld",
      nextOccurrenceAdmission:
        "withheld-pending-plan-and-combined-pool-admission",
    });
    expect(transferredMaterial.projectiles).toEqual(closeProjectiles);
    transferredMaterial.projectiles.forEach((projectile, index) => {
      expect(projectile).toMatchObject({
        instanceId: closeProjectiles[index]?.instanceId,
        generation: closeProjectiles[index]?.generation,
        sourceId: closeProjectiles[index]?.sourceId,
        sourceIndex: closeProjectiles[index]?.sourceIndex,
        burstIndex: closeProjectiles[index]?.burstIndex,
        terminalCause: closeProjectiles[index]?.terminalCause,
      });
    });
    expect(fixture.eventBus.canonicalSerialization()).toBe(closeEventSerialization);
    expect(fixture.runState.snapshot().claimedOccurrenceIds).toEqual(closeClaims);
    expect(() => commitPreparedCanonicalRunFirstContinuationSuccessorMaterialTransfer(transfer))
      .toThrow(/committed/);

    const runBeforeRejectedOldOwner = fixture.runState.snapshot();
    const eventsBeforeRejectedOldOwner = fixture.eventBus.events();
    expect(() => advanceCanonicalRunFirstContinuationSuccessorCompleteHold(
      owner,
      combatInput(complete.tick120 + 1),
    )).toThrow(/binding|transferred|owner/);
    expect(fixture.runState.snapshot()).toEqual(runBeforeRejectedOldOwner);
    expect(fixture.eventBus.events()).toEqual(eventsBeforeRejectedOldOwner);

    const runBeforeNextAdmission = fixture.runState.snapshot();
    const eventsBeforeNextAdmission = fixture.eventBus.events();
    const eventSerializationBeforeNextAdmission =
      fixture.eventBus.canonicalSerialization();
    const nextPreparation =
      prepareCanonicalRunFirstContinuationNextOccurrenceAdmission(materialOwner);
    if (nextPreparation.state !== "prepared") {
      throw new Error(`expected next occurrence admission, received ${nextPreparation.reason}`);
    }
    const nextView = inspectPreparedCanonicalRunFirstContinuationNextOccurrenceAdmission(
      nextPreparation.proposal,
    );
    expect(nextView).toEqual(nextPreparation.view);
    expect(nextView).toMatchObject({
      authority:
        "canonical-run-first-continuation-next-occurrence-admission-v1",
      extensionPolicy: "EXT-2026-020",
      state: "prepared",
      preparedAtTick120: complete.tick120,
      material: {
        tick120: complete.tick120,
        materialCount: 46,
        drained: false,
        poolUsage: {
          allocatedSlots: {micro: 80, medium: 0, heavy: 0, splitChildren: 0},
          liveColliders: 0,
          residueVisuals: 46,
        },
        nextOccurrenceAdmission:
          "withheld-pending-plan-and-combined-pool-admission",
      },
      plan: {
        authority:
          "canonical-run-first-continuation-next-occurrence-plan-v1",
        extensionPolicy: "EXT-2026-020",
        plannedAtTick120: complete.tick120,
        targetRoom: "IN_BETWEEN",
        roomOrdinal: 1,
        intensity: {
          score: 0.14810056112410605,
          tierId: "listen",
          difficulty: "EASY",
          budget: {maxProjectiles: 80, maxEmitters: 2, restMs: 1_600},
        },
        selection: {
          removedPatternIds: ["room.in_between.context_switch"],
          previousPatternId: "room.in_between.context_switch",
          candidateOrder: [
            "room.in_between.stable_intersection",
            "room.in_between.misregistration_corridor",
            "room.in_between.borrowed_rule",
          ],
          rng: {
            continuedFromStateAfterDrawUint32: 3_663_131_627,
            drawOrdinal: 2,
            drawValue: 0.5274470399599522,
            stateAfterDrawUint32: 1_199_730_144,
            selectionRngDrawsTotal: 3,
          },
          selectedPatternId: "room.in_between.misregistration_corridor",
          rerollCount: 0,
          capabilityFilteringApplied: false,
        },
        occurrence: {
          occurrenceId:
            "run:room:1:encounter:1:room.in_between.misregistration_corridor",
          patternId: "room.in_between.misregistration_corridor",
          roomId: "IN_BETWEEN",
          roomOrdinal: 1,
          encounterOrdinal: 1,
          difficulty: "EASY",
          difficultySalt: 0x2201,
          resolvedSeed: {value: 4_108_513_047},
          segmentsMs: {
            telegraph: 520,
            entry: 800,
            read: 10_600,
            materialSettle: 900,
            rest: 1_600,
            safeGapHandoff: 520,
          },
          parallel: {mode: "none", patternId: null},
        },
        patternCapability: {status: "supported"},
        roomCompletion: "withheld",
        roomHandoff: "withheld",
        canonicalEventWrites: 0,
        authorityMutations: 0,
      },
      combinedPoolAdmission: {
        state: "admissible",
        admissible: true,
        evaluatedAtTick120: complete.tick120,
        poolClassResolution: {state: "resolved", poolClass: "micro"},
        carryover: {
          allocatedSlots: {micro: 80, medium: 0, heavy: 0, splitChildren: 0},
          residueVisuals: 46,
          liveColliders: 0,
        },
        successor: {
          requestedProjectileSlots: 80,
          requestedResidueVisualSlots: 80,
          emitterCount: 2,
          maxEmitters: 2,
          reservationByClass: {micro: 80, medium: 0, heavy: 0, splitChildren: 0},
        },
        combined: {
          allocatedSlots: {micro: 160, medium: 0, heavy: 0, splitChildren: 0},
          residueVisuals: 126,
        },
        limits: {
          poolBudgets: {micro: 2_048},
          residueVisualOnly: 1_536,
          difficultyProjectiles: 120,
        },
        reservationCommitted: false,
      },
      roomCompletion: "withheld",
      roomHandoff: "withheld",
      canonicalEventWrites: 0,
      occurrenceClaimWrites: 0,
      tickAdvance: 0,
    });
    expect(nextView.plan.selection.candidateTotalWeight).toBeCloseTo(3.48, 12);
    expect(nextView.plan.selection.rng.cursorInitial)
      .toBeCloseTo(1.8355156990606338, 12);
    expect(() => prepareCanonicalRunFirstContinuationNextOccurrenceAdmission(
      materialOwner,
    )).toThrow(/in-flight/);
    expect(() => advanceCanonicalRunFirstContinuationSuccessorMaterialHold(
      materialOwner,
      combatInput(complete.tick120 + 1),
    )).toThrow(/lease/);
    expect(fixture.runState.snapshot()).toEqual(runBeforeNextAdmission);
    expect(fixture.eventBus.events()).toEqual(eventsBeforeNextAdmission);
    expect(fixture.eventBus.canonicalSerialization())
      .toBe(eventSerializationBeforeNextAdmission);

    const nextOwner =
      commitPreparedCanonicalRunFirstContinuationNextOccurrenceAdmission(
        nextPreparation.proposal,
      );
    const nextDormant =
      inspectCanonicalRunFirstContinuationNextOccurrenceOwner(nextOwner);
    expect(nextDormant).toMatchObject({
      authority:
        "canonical-run-first-continuation-next-occurrence-dormant-owner-v1",
      extensionPolicy: "EXT-2026-020",
      executionPolicy: "EXT-2026-021",
      phase: "dormant",
      authoredPhase: "dormant",
      tick120: complete.tick120,
      relativeTick120: 0,
      boundaryTicks120: {
        handoffTick120: complete.tick120,
        telegraphStartTick120: complete.tick120 + 1,
        entryStartTick120: complete.tick120 + 63,
        readStartTick120: complete.tick120 + 159,
      },
      telegraphStartTick120: complete.tick120 + 1,
      nextMasterTickAction: "telegraph",
      plan: nextView.plan,
      combinedPoolAdmission: {
        state: "committed",
        evaluation: nextView.combinedPoolAdmission,
        reservationCommitted: true,
      },
      material: {
        tick120: complete.tick120,
        materialCount: 46,
        nextOccurrenceAdmission: "committed-to-dormant-next-occurrence",
      },
      runCombat: {
        tick120: complete.tick120,
        activeOccurrenceId: null,
        pendingFlushTick120: null,
        claimedOccurrenceIds: closeClaims,
      },
      canonicalEventCount: eventsBeforeNextAdmission.length,
      roomCompletion: "withheld",
      roomHandoff: "withheld",
    });
    expect(nextDormant.tick120).toBe(6_788);
    expect(nextDormant.combat).toBeNull();
    expect(nextDormant.material.projectiles).toEqual(closeProjectiles);
    expect(() => commitPreparedCanonicalRunFirstContinuationNextOccurrenceAdmission(
      nextPreparation.proposal,
    )).toThrow(/committed/);
    expect(() => prepareCanonicalRunFirstContinuationNextOccurrenceAdmission(
      materialOwner,
    )).toThrow(/exact flushed|binding/);
    expect(() => advanceCanonicalRunFirstContinuationSuccessorMaterialHold(
      materialOwner,
      combatInput(complete.tick120 + 1),
    )).toThrow(/lease/);
    expect(fixture.runState.snapshot()).toEqual(runBeforeNextAdmission);
    expect(fixture.eventBus.events()).toEqual(eventsBeforeNextAdmission);
    expect(fixture.eventBus.canonicalSerialization())
      .toBe(eventSerializationBeforeNextAdmission);

    const nextExecutionStartTick120 = nextDormant.tick120;
    const nextExecutionEvents = fixture.eventBus.events();
    const runBeforeHostileNextTick = fixture.runState.snapshot();
    const ownerBeforeHostileNextTick =
      inspectCanonicalRunFirstContinuationNextOccurrenceOwner(nextOwner);
    expect(() => advanceCanonicalRunFirstContinuationNextOccurrencePreRead(
      nextOwner,
      combatInput(nextExecutionStartTick120 + 2),
    )).toThrow(/advance one tick|one-tick/);
    expect(() => advanceCanonicalRunFirstContinuationNextOccurrencePreRead(
      nextOwner,
      combatInput(nextExecutionStartTick120),
    )).toThrow(/advance one tick|one-tick/);
    expect(() => advanceCanonicalRunFirstContinuationNextOccurrencePreRead(nextOwner, {
      ...combatInput(nextExecutionStartTick120 + 1),
      overridePressed: true,
      overrideDirection: {x: 1, y: 0},
    })).toThrow(/Override locked/);
    expect(fixture.runState.snapshot()).toEqual(runBeforeHostileNextTick);
    expect(fixture.eventBus.events()).toEqual(nextExecutionEvents);
    expect(inspectCanonicalRunFirstContinuationNextOccurrenceOwner(nextOwner))
      .toEqual(ownerBeforeHostileNextTick);

    let nextOccurrence =
      advanceCanonicalRunFirstContinuationNextOccurrencePreRead(
        nextOwner,
        combatInput(nextExecutionStartTick120 + 1),
      );
    expect(nextOccurrence).toMatchObject({
      phase: "pre-read",
      authoredPhase: "telegraph",
      tick120: nextExecutionStartTick120 + 1,
      relativeTick120: 1,
      nextMasterTickAction: "continue-telegraph",
      runCombat: {activeOccurrenceId: null, pendingFlushTick120: null},
      combat: null,
    });
    while (nextOccurrence.tick120 < nextExecutionStartTick120 + 62) {
      nextOccurrence = advanceCanonicalRunFirstContinuationNextOccurrencePreRead(
        nextOwner,
        combatInput(nextOccurrence.tick120 + 1),
      );
    }
    expect(nextOccurrence).toMatchObject({
      authoredPhase: "telegraph",
      tick120: nextExecutionStartTick120 + 62,
      relativeTick120: 62,
      nextMasterTickAction: "entry",
      combat: null,
    });

    nextOccurrence = advanceCanonicalRunFirstContinuationNextOccurrencePreRead(
      nextOwner,
      combatInput(nextExecutionStartTick120 + 63),
    );
    expect(nextOccurrence).toMatchObject({
      phase: "pre-read",
      authoredPhase: "entry",
      tick120: nextExecutionStartTick120 + 63,
      relativeTick120: 63,
      nextMasterTickAction: "continue-entry",
      combat: null,
    });
    while (nextOccurrence.tick120 < nextExecutionStartTick120 + 78) {
      nextOccurrence = advanceCanonicalRunFirstContinuationNextOccurrencePreRead(
        nextOwner,
        combatInput(nextOccurrence.tick120 + 1),
      );
    }
    expect(nextOccurrence.material).toMatchObject({
      tick120: nextExecutionStartTick120 + 78,
      materialCount: 0,
      drained: true,
      poolUsage: {
        allocatedSlots: {micro: 80, medium: 0, heavy: 0, splitChildren: 0},
        liveColliders: 0,
        residueVisuals: 0,
      },
    });
    const cleanupAtDrain = fixture.eventBus.events().slice(nextExecutionEvents.length);
    expect(cleanupAtDrain).toHaveLength(92);
    expect(cleanupAtDrain.every((event) =>
      event.id === "projectile.residue.remove"
      || event.id === "projectile.lifecycle.complete")).toBe(true);

    while (nextOccurrence.tick120 < nextExecutionStartTick120 + 158) {
      nextOccurrence = advanceCanonicalRunFirstContinuationNextOccurrencePreRead(
        nextOwner,
        combatInput(nextOccurrence.tick120 + 1),
      );
    }
    expect(nextOccurrence).toMatchObject({
      phase: "pre-read",
      authoredPhase: "entry",
      tick120: nextExecutionStartTick120 + 158,
      relativeTick120: 158,
      nextMasterTickAction: "claim-read",
      material: {
        drained: true,
        materialCount: 0,
        poolUsage: {
          allocatedSlots: {micro: 80, medium: 0, heavy: 0, splitChildren: 0},
          liveColliders: 0,
          residueVisuals: 0,
        },
      },
      combinedPoolAdmission: {
        evaluation: {
          combined: {
            allocatedSlots: {micro: 160, medium: 0, heavy: 0, splitChildren: 0},
            residueVisuals: 126,
          },
        },
      },
      runCombat: {activeOccurrenceId: null, pendingFlushTick120: null},
      combat: null,
    });
    const nextOccurrenceId = nextView.plan.occurrence.occurrenceId;
    expect(nextOccurrence.runCombat.claimedOccurrenceIds.filter((occurrenceId) =>
      occurrenceId === nextOccurrenceId)).toHaveLength(0);
    expect(fixture.eventBus.events().slice(nextExecutionEvents.length)).toEqual(cleanupAtDrain);

    const runBeforeNextRead = fixture.runState.snapshot();
    const eventsBeforeNextRead = fixture.eventBus.events();
    const ownerBeforeNextRead =
      inspectCanonicalRunFirstContinuationNextOccurrenceOwner(nextOwner);
    expect(() => startCanonicalRunFirstContinuationNextOccurrenceRead(
      nextOwner,
      combatInput(nextExecutionStartTick120 + 158),
    )).toThrow(/advance one tick/);
    expect(() => startCanonicalRunFirstContinuationNextOccurrenceRead(
      nextOwner,
      combatInput(nextExecutionStartTick120 + 160),
    )).toThrow(/advance one tick/);
    expect(() => startCanonicalRunFirstContinuationNextOccurrenceRead(nextOwner, {
      ...combatInput(nextExecutionStartTick120 + 159),
      overridePressed: true,
      overrideDirection: {x: 1, y: 0},
    })).toThrow(/Override locked/);
    expect(fixture.runState.snapshot()).toEqual(runBeforeNextRead);
    expect(fixture.eventBus.events()).toEqual(eventsBeforeNextRead);
    expect(inspectCanonicalRunFirstContinuationNextOccurrenceOwner(nextOwner))
      .toEqual(ownerBeforeNextRead);

    const nextRead = startCanonicalRunFirstContinuationNextOccurrenceRead(nextOwner, {
      ...combatInput(nextExecutionStartTick120 + 159),
      movement: {x: -1, y: 0},
      focused: true,
    });
    expect(nextRead).toMatchObject({
      executionPolicy: "EXT-2026-021",
      phase: "read",
      authoredPhase: "read",
      tick120: 6_947,
      relativeTick120: 159,
      nextMasterTickAction: "read-advance-withheld",
      material: {
        drained: true,
        materialCount: 0,
        poolUsage: {
          allocatedSlots: {micro: 80, medium: 0, heavy: 0, splitChildren: 0},
          liveColliders: 0,
          residueVisuals: 0,
        },
      },
      combinedPoolAdmission: {
        evaluation: {
          combined: {
            allocatedSlots: {micro: 160, medium: 0, heavy: 0, splitChildren: 0},
            residueVisuals: 126,
          },
        },
      },
      runCombat: {
        tick120: 6_947,
        focused: true,
        activeOccurrenceId: nextOccurrenceId,
        pendingFlushTick120: null,
      },
      combat: {
        tick120: 6_947,
        relativeTick120: 0,
        patternId: nextView.plan.occurrence.patternId,
        occurrenceId: nextOccurrenceId,
        rngCallsConsumed: 0,
        projectiles: [],
        poolUsage: {liveColliders: 0},
      },
    });
    expect(nextRead.runCombat.claimedOccurrenceIds.filter((occurrenceId) =>
      occurrenceId === nextOccurrenceId)).toHaveLength(1);
    expect(nextRead.runCombat.playerPosition.x)
      .toBeLessThan(runBeforeNextRead.playerPosition.x);
    expect(fixture.eventBus.events().slice(nextExecutionEvents.length)).toHaveLength(92);
    expect(fixture.eventBus.pendingEventCount()).toBe(0);

    const runAfterNextRead = fixture.runState.snapshot();
    const eventsAfterNextRead = fixture.eventBus.events();
    expect(() => startCanonicalRunFirstContinuationNextOccurrenceRead(
      nextOwner,
      combatInput(nextExecutionStartTick120 + 160),
    )).toThrow(/exact entry boundary/);
    expect(() => advanceCanonicalRunFirstContinuationNextOccurrencePreRead(
      nextOwner,
      combatInput(nextExecutionStartTick120 + 160),
    )).toThrow(/stops before the exact READ claim tick/);
    expect(fixture.runState.snapshot()).toEqual(runAfterNextRead);
    expect(fixture.eventBus.events()).toEqual(eventsAfterNextRead);
    expect(inspectCanonicalRunFirstContinuationNextOccurrenceOwner(nextOwner)).toEqual(nextRead);
    expect(complete.runCombat.claimedOccurrenceIds.filter((occurrenceId) =>
      occurrenceId === preparation.view.plan.occurrence.occurrenceId)).toHaveLength(1);
    expect(fixture.eventBus.events().slice(eventsBeforeRead.length).some((event) =>
      event.id === "room.transition.complete")).toBe(false);
    expect(fixture.eventBus.pendingEventCount()).toBe(0);
  });

  it("cancels a prepared admission without consuming the handoff, then retries", {
    timeout: 30_000,
  }, () => {
    const {fixture, chapter, transition, handoffReceipt} = reachLiveMaterialHandoff();
    const runBefore = fixture.runState.snapshot();
    const eventsBefore = fixture.eventBus.events();
    const first = prepareCanonicalRunFirstContinuationRoomAdmission(handoffReceipt);
    if (first.state !== "prepared") {
      throw new Error(`expected admissible fixture, received ${first.reason}`);
    }

    cancelPreparedCanonicalRunFirstContinuationRoomAdmission(first.proposal);
    expect(fixture.runState.snapshot()).toEqual(runBefore);
    expect(fixture.eventBus.events()).toEqual(eventsBefore);
    expect(fixture.eventBus.pendingEventCount()).toBe(0);
    expect(chapter.snapshot()).toEqual(transition);
    expect(() => commitPreparedCanonicalRunFirstContinuationRoomAdmission(first.proposal))
      .toThrow(/proposal is cancelled/);

    const retry = prepareCanonicalRunFirstContinuationRoomAdmission(handoffReceipt);
    if (retry.state !== "prepared") {
      throw new Error(`expected retry to remain admissible, received ${retry.reason}`);
    }
    const owner = commitPreparedCanonicalRunFirstContinuationRoomAdmission(retry.proposal);
    expect(inspectCanonicalRunFirstContinuationDormantSuccessorOwner(owner)).toMatchObject({
      phase: "dormant",
      tick120: transition.combat.tick120,
      targetRoom: fixture.formalTarget.targetRoom,
    });
    expect(fixture.runState.snapshot()).toEqual(runBefore);
    expect(fixture.eventBus.events()).toEqual(eventsBefore);
  });

  it("rejects a stale prepared admission without blocking the original owner", {
    timeout: 30_000,
  }, () => {
    const {fixture, chapter, transition, handoffReceipt} = reachLiveMaterialHandoff();
    const preparation = prepareCanonicalRunFirstContinuationRoomAdmission(handoffReceipt);
    if (preparation.state !== "prepared") {
      throw new Error(`expected admissible fixture, received ${preparation.reason}`);
    }

    const advanced = chapter.step(combatInput(transition.combat.tick120 + 1));
    const runAfterAdvance = fixture.runState.snapshot();
    const eventsAfterAdvance = fixture.eventBus.events();
    expect(() => commitPreparedCanonicalRunFirstContinuationRoomAdmission(
      preparation.proposal,
    )).toThrow(/stale/);
    expect(fixture.runState.snapshot()).toEqual(runAfterAdvance);
    expect(fixture.eventBus.events()).toEqual(eventsAfterAdvance);
    expect(fixture.eventBus.pendingEventCount()).toBe(0);
    expect(chapter.snapshot()).toEqual(advanced);
    expect(() => commitPreparedCanonicalRunFirstContinuationRoomAdmission(
      preparation.proposal,
    )).toThrow(/proposal is failed/);
    expect(() => prepareCanonicalRunFirstContinuationRoomAdmission(handoffReceipt))
      .toThrow(/stale or no longer flushed/);

    const advancedMaterialTick120 = advanced.material?.tick120;
    if (advancedMaterialTick120 === undefined) {
      throw new Error("stale admission fixture lost its material clock");
    }
    const continued = chapter.step(combatInput(advancedMaterialTick120 + 1));
    expect(continued.material?.tick120).toBe(advancedMaterialTick120 + 1);
    expect(continued.ownership).toBe("active");
  });

  it("owns start through material handoff without exposing mutable authorities", {
    timeout: 30_000,
  }, () => {
    const fixture = freshFormalTarget();
    const startTick120 = fixture.formalTarget.selectedAtTick120 + 1;
    const eventsBefore = fixture.eventBus.events().length;
    const chapter = CanonicalRunFirstContinuationTransitionChapter.start({
      formalTarget: fixture.formalTarget,
      runState: fixture.runState,
      eventBus: fixture.eventBus,
      input: combatInput(startTick120),
    });
    let snapshot = chapter.snapshot();
    expect(Object.isFrozen(chapter)).toBe(true);
    expect(Reflect.ownKeys(chapter)).toEqual([]);
    expect(snapshot).toMatchObject({
      phase: "transition_gameplay",
      sourceRoom: "FORCED_ALIGNMENT",
      targetRoom: fixture.formalTarget.targetRoom,
      worldRoom: "FORCED_ALIGNMENT",
      patternId: "transition.room_threshold",
      occurrenceId: "run:room:0-to-1:transition:transition.room_threshold",
      difficulty: "NORMAL",
      startTick120,
      collisionLeaseReleased: false,
      combat: {tick120: startTick120, relativeTick120: 0},
      gameplayExit: null,
      handoff: {state: "withheld-transition-gameplay", ready: false},
    });
    expect(fixture.eventBus.events().slice(eventsBefore).map((event) => event.id)).toEqual([
      "player.collision.off",
      "room.transition.begin",
    ]);

    for (let tick120 = startTick120 + 1; tick120 <= snapshot.timeline.patternCompleteTick120; tick120 += 1) {
      snapshot = chapter.step(combatInput(tick120));
      if (tick120 === snapshot.timeline.worldSwapTick120) {
        expect(snapshot.worldRoom).toBe(fixture.formalTarget.targetRoom);
      }
      if (tick120 === snapshot.timeline.completeTick120) {
        expect(snapshot).toMatchObject({
          worldRoom: fixture.formalTarget.targetRoom,
          collisionLeaseReleased: true,
          roomTransition: {state: "idle", targetRoom: null, active: null},
        });
      }
    }

    expect(snapshot).toMatchObject({
      phase: "material_carryover",
      worldRoom: fixture.formalTarget.targetRoom,
      collisionLeaseReleased: true,
      combat: {
        patternComplete: true,
        digitalBodiesDrained: true,
        poolUsage: {liveColliders: 0},
      },
      gameplayExit: {
        atTick120: snapshot.timeline.patternCompleteTick120,
        patternComplete: true,
        digitalBodiesDrained: true,
        liveDigitalBodies: 0,
        liveColliders: 0,
      },
      handoff: {
        state: "ready-pending-room-plan-and-combined-pool-budget",
        ready: true,
        atTick120: snapshot.timeline.patternCompleteTick120,
        nextRoomAdmission: "withheld-pending-room-plan-and-combined-pool-budget",
      },
    });
    expect(snapshot.material?.materialCount).toBeGreaterThan(0);
    const receipt = chapter.handoff();
    if (receipt === null) throw new Error("chapter did not issue its ready handoff receipt");
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Reflect.ownKeys(receipt)).toEqual([]);
    expect(inspectCanonicalRunFirstContinuationRoomHandoffReceipt(receipt)).toEqual({
      authority: "canonical-run-first-continuation-room-handoff-v1",
      extensionPolicy: "EXT-2026-013",
      targetRoom: fixture.formalTarget.targetRoom,
      atTick120: snapshot.timeline.patternCompleteTick120,
      nextRoomAdmission: "withheld-pending-room-plan-and-combined-pool-budget",
    });
    expect(() => inspectCanonicalRunFirstContinuationRoomHandoffReceipt(
      Object.freeze({}) as typeof receipt,
    )).toThrow(/not registered/);

    let tick120 = snapshot.timeline.patternCompleteTick120;
    while (snapshot.phase !== "target_room_idle" && tick120 < snapshot.timeline.patternCompleteTick120 + 500) {
      tick120 += 1;
      snapshot = chapter.step(combatInput(tick120));
    }
    expect(snapshot).toMatchObject({
      phase: "target_room_idle",
      worldRoom: fixture.formalTarget.targetRoom,
      material: {drained: true, materialCount: 0},
    });
    expect(chapter.handoff()).toBe(receipt);
    expect(() => prepareCanonicalRunFirstContinuationRoomAdmission(receipt))
      .toThrow(/stale or no longer flushed/);
  });

  it("waits for the exact player recovery boundary without waiting for material drain", {
    timeout: 30_000,
  }, () => {
    const fixture = freshFormalTarget();
    const startTick120 = fixture.formalTarget.selectedAtTick120 + 1;
    const eventsBefore = fixture.eventBus.events().length;
    const chapter = CanonicalRunFirstContinuationTransitionChapter.start({
      formalTarget: fixture.formalTarget,
      runState: fixture.runState,
      eventBus: fixture.eventBus,
      input: combatInput(startTick120),
    });
    let snapshot = chapter.snapshot();
    for (let relativeTick120 = 1; relativeTick120 <= 936; relativeTick120 += 1) {
      const tick120 = startTick120 + relativeTick120;
      snapshot = chapter.step(relativeTick120 >= 852
        ? moveTowardPoint(snapshot.combat, tick120, {x: 159.5, y: 592})
        : combatInput(tick120));
    }

    const transitionEvents = fixture.eventBus.events().slice(eventsBefore);
    const damageEvents = transitionEvents.filter((event) => event.id === "player.damage.commit");
    const impactEvents = transitionEvents.filter((event) => event.id === "projectile.impact.commit");
    const damageTick120 = startTick120 + 874;
    expect(damageEvents.map((event) => event.tick120)).toEqual([damageTick120]);
    expect(impactEvents.map((event) => event.tick120)).toEqual([damageTick120]);
    const recoveryTick120 = runtime60DeadlineTick(damageTick120, 1_000);
    expect(recoveryTick120).toBe(startTick120 + 995);
    expect(fixture.runState.snapshot().player).toMatchObject({
      state: "alive",
      health: 2,
      lives: 3,
      collisionEnabled: false,
      recoveryAtTick120: recoveryTick120,
    });
    expect(snapshot).toMatchObject({
      phase: "material_carryover",
      gameplayExit: {atTick120: startTick120 + 936},
      handoff: {
        state: "awaiting-player-quiescence",
        ready: false,
        runTimedStateQuiescent: false,
      },
    });
    expect(chapter.handoff()).toBeNull();

    for (
      let tick120 = snapshot.timeline.patternCompleteTick120 + 1;
      tick120 < recoveryTick120;
      tick120 += 1
    ) {
      snapshot = chapter.step(combatInput(tick120));
    }
    expect(snapshot.handoff).toMatchObject({
      state: "awaiting-player-quiescence",
      ready: false,
    });
    expect(chapter.handoff()).toBeNull();

    snapshot = chapter.step(combatInput(recoveryTick120));
    expect(fixture.runState.snapshot().player).toMatchObject({
      state: "alive",
      health: 2,
      lives: 3,
      collisionEnabled: true,
      activeLeases: [],
      recoveryAtTick120: null,
    });
    expect(snapshot).toMatchObject({
      phase: "material_carryover",
      material: {drained: false},
      handoff: {
        state: "ready-pending-room-plan-and-combined-pool-budget",
        ready: true,
        atTick120: recoveryTick120,
        runTimedStateQuiescent: true,
        materialDrainingAtHandoff: true,
      },
    });
    expect(chapter.handoff()).not.toBeNull();
  });

  it("withholds handoff through respawn and releases it on the exact completion tick", {
    timeout: 30_000,
  }, () => {
    const fixture = freshFormalTarget(2);
    const startTick120 = fixture.formalTarget.selectedAtTick120 + 1;
    const eventsBefore = fixture.eventBus.events().length;
    const chapter = CanonicalRunFirstContinuationTransitionChapter.start({
      formalTarget: fixture.formalTarget,
      runState: fixture.runState,
      eventBus: fixture.eventBus,
      input: combatInput(startTick120),
    });
    let snapshot = chapter.snapshot();
    for (let relativeTick120 = 1; relativeTick120 <= 936; relativeTick120 += 1) {
      snapshot = chapter.step(moveTowardPoint(
        snapshot.combat,
        startTick120 + relativeTick120,
        {x: 180, y: 300},
      ));
    }

    const respawnCompleteTick120 = startTick120 + 945;
    expect(fixture.runState.snapshot().player).toMatchObject({
      state: "respawning",
      health: 3,
      lives: 2,
      collisionEnabled: false,
      respawnPlaceAtTick120: null,
      respawnCompleteAtTick120: respawnCompleteTick120,
    });
    expect(snapshot).toMatchObject({
      phase: "material_carryover",
      gameplayExit: {atTick120: startTick120 + 936},
      handoff: {
        state: "awaiting-player-quiescence",
        ready: false,
        playerState: "respawning",
        runTimedStateQuiescent: false,
      },
    });
    expect(chapter.handoff()).toBeNull();
    const transitionEvents = fixture.eventBus.events().slice(eventsBefore);
    expect(transitionEvents
      .filter((event) => event.id === "player.damage.commit")
      .map((event) => event.tick120)).toEqual([startTick120 + 488]);
    expect(transitionEvents
      .filter((event) => event.id === "player.death.commit")
      .map((event) => event.tick120)).toEqual([startTick120 + 728]);
    expect(transitionEvents
      .filter((event) => event.id === "player.respawn.place")
      .map((event) => event.tick120)).toEqual([startTick120 + 861]);

    for (
      let tick120 = snapshot.timeline.patternCompleteTick120 + 1;
      tick120 < respawnCompleteTick120;
      tick120 += 1
    ) {
      snapshot = chapter.step(combatInput(tick120));
    }
    expect(snapshot.handoff).toMatchObject({
      state: "awaiting-player-quiescence",
      ready: false,
      playerState: "respawning",
    });
    expect(chapter.handoff()).toBeNull();

    snapshot = chapter.step(combatInput(respawnCompleteTick120));
    expect(fixture.runState.snapshot().player).toMatchObject({
      state: "alive",
      health: 3,
      lives: 2,
      collisionEnabled: true,
      activeLeases: [],
      recoveryAtTick120: null,
      respawnPlaceAtTick120: null,
      respawnCompleteAtTick120: null,
    });
    expect(snapshot).toMatchObject({
      phase: "material_carryover",
      material: {drained: false},
      handoff: {
        state: "ready-pending-room-plan-and-combined-pool-budget",
        ready: true,
        atTick120: respawnCompleteTick120,
        playerState: "alive",
        runTimedStateQuiescent: true,
        materialDrainingAtHandoff: true,
      },
    });
    expect(chapter.handoff()).not.toBeNull();
  });

  it("ends the run through real projectile contact and never issues a room handoff", {
    timeout: 30_000,
  }, () => {
    const fixture = freshFormalTarget(3);
    const startTick120 = fixture.formalTarget.selectedAtTick120 + 1;
    const eventsBefore = fixture.eventBus.events().length;
    const chapter = CanonicalRunFirstContinuationTransitionChapter.start({
      formalTarget: fixture.formalTarget,
      runState: fixture.runState,
      eventBus: fixture.eventBus,
      input: combatInput(startTick120),
    });
    let snapshot = chapter.snapshot();
    for (let relativeTick120 = 1; relativeTick120 <= 750; relativeTick120 += 1) {
      snapshot = chapter.step(moveTowardPoint(
        snapshot.combat,
        startTick120 + relativeTick120,
        {x: 180, y: 160},
      ));
    }

    expect(fixture.runState.snapshot().player).toMatchObject({
      tick120: startTick120 + 750,
      state: "run-ended",
      health: 0,
      lives: 0,
      collisionEnabled: false,
      handoff: {reason: "lives-exhausted", tick120: startTick120 + 750},
    });
    expect(snapshot.handoff).toMatchObject({
      state: "run-ended",
      ready: false,
      atTick120: null,
      playerState: "run-ended",
      runTimedStateQuiescent: true,
    });
    expect(chapter.handoff()).toBeNull();
    const terminalEvents = fixture.eventBus.events().slice(eventsBefore);
    expect(terminalEvents
      .filter((event) => event.id === "player.death.commit")
      .map((event) => event.tick120)).toEqual([
      startTick120 + 270,
      startTick120 + 510,
      startTick120 + 750,
    ]);
    expect(terminalEvents
      .filter((event) => event.id === "player.life.consume")
      .map((event) => event.tick120)).toEqual([
      startTick120 + 270,
      startTick120 + 510,
      startTick120 + 750,
    ]);
    expect(terminalEvents
      .filter((event) => event.id === "run.end.commit")
      .map((event) => event.tick120)).toEqual([startTick120 + 750]);

    for (let relativeTick120 = 751; relativeTick120 <= 936; relativeTick120 += 1) {
      snapshot = chapter.step(combatInput(startTick120 + relativeTick120));
    }
    expect(snapshot).toMatchObject({
      phase: "material_carryover",
      gameplayExit: {atTick120: startTick120 + 936},
      handoff: {state: "run-ended", ready: false, atTick120: null},
    });
    expect(chapter.handoff()).toBeNull();
    snapshot = chapter.step(combatInput(startTick120 + 937));
    expect(snapshot.handoff).toMatchObject({state: "run-ended", ready: false});
    expect(chapter.handoff()).toBeNull();
  });
});
