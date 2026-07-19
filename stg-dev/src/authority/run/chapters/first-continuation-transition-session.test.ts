import {describe, expect, it} from "vitest";

import type {CanonicalRunBehaviorCountEntry} from "../../run-behavior-facts";
import {
  CanonicalRunSession,
  type CanonicalRunSessionSnapshot,
  type CanonicalRunSessionStepInput,
} from "../../run-session";

const OPTIONS = Object.freeze({
  rawRunSeed: Object.freeze({domain: "raw-run-seed" as const, value: 1}),
  grazeRadiusPx: 18,
  projectileDamage: 1,
  projectilePoolClasses: Object.freeze({"bullet.micro.notch_e": "micro" as const}),
});

function input(
  tick120: number,
  overrides: Partial<CanonicalRunSessionStepInput> = {},
): CanonicalRunSessionStepInput {
  return {
    tick120,
    movement: {x: 0, y: 0},
    signalActive: false,
    focused: false,
    gaze: {skyEyeVisible: true, pitchDegrees: 0, alignment: 0},
    ...overrides,
  };
}

function reachFirstRoomClosure(session: CanonicalRunSession): CanonicalRunSessionSnapshot {
  let snapshot = session.snapshot();
  while (snapshot.tick120 < 960) {
    const tick120 = snapshot.tick120 + 1;
    snapshot = session.step(input(tick120, {
      signalActive: tick120 === 1 || tick120 === 3,
    }));
  }
  while (snapshot.tick120 < 1_021) {
    snapshot = session.step(input(snapshot.tick120 + 1, {
      gaze: {skyEyeVisible: true, pitchDegrees: 60, alignment: 1},
    }));
  }
  while (snapshot.phase !== "room_sampling" && snapshot.tick120 < 3_360) {
    snapshot = session.step(input(snapshot.tick120 + 1));
  }
  const firstRoomStartTick120 = snapshot.handoff.atTick120;
  if (snapshot.phase !== "room_sampling" || firstRoomStartTick120 === null) {
    throw new Error("session transition fixture did not reach the first room");
  }
  while (snapshot.tick120 < firstRoomStartTick120 + 1_702) {
    snapshot = session.step(input(snapshot.tick120 + 1));
  }
  if (snapshot.firstContinuationRoomTarget.availability !== "available") {
    throw new Error("session transition fixture did not close H+1702");
  }
  return snapshot;
}

function count(entries: readonly CanonicalRunBehaviorCountEntry[], id: string): number {
  return entries.find((entry) => entry.id === id)?.ticks120 ?? 0;
}

function availableSampleCount(
  entry: Readonly<{availability: "missing"} | {availability: "available"; sampleCount: number}>,
): number {
  if (entry.availability !== "available") throw new Error("expected an available fact aggregate");
  return entry.sampleCount;
}

describe("first continuation transition session integration", () => {
  it("hands one session owner from transition through successor READ and material hold", {
    timeout: 30_000,
  }, () => {
    const session = new CanonicalRunSession(OPTIONS);
    const atClosure = reachFirstRoomClosure(session);
    const target = atClosure.firstContinuationRoomTarget;
    if (target.availability !== "available") throw new Error("formal target disappeared");
    expect(atClosure).toMatchObject({
      phase: "room_sampling",
      tick120: target.selectedAtTick120,
      roomSampling: {
        phase: "first_room_complete",
        roomComplete: true,
        tick120: target.selectedAtTick120,
      },
      firstContinuationTransition: null,
    });

    const frozenFlower = JSON.stringify(atClosure.player.flower);
    const frozenGaze = JSON.stringify(atClosure.gaze);
    const frozenFlowerFacts = JSON.stringify(atClosure.behaviorFacts.committed.flower);
    const frozenGazeFacts = JSON.stringify(atClosure.behaviorFacts.committed.gaze);
    const frozenRoomFacts = JSON.stringify(atClosure.behaviorFacts.context.room);
    const frozenClosure = JSON.stringify(atClosure.firstRoomClosureCapture);
    const frozenProjection = JSON.stringify(atClosure.firstRoomMetricProjection);
    const frozenTarget = JSON.stringify(atClosure.firstContinuationRoomTarget);
    const requestedBefore = atClosure.behaviorFacts.requested;
    const playerFactsBefore = atClosure.behaviorFacts.committed.player;
    const runCombatBefore = atClosure.behaviorFacts.context.runCombat;
    if (
      requestedBefore.availability !== "available"
      || playerFactsBefore.availability !== "available"
      || runCombatBefore.availability !== "available"
    ) {
      throw new Error("session transition fixture lost its H+1702 behavior facts");
    }
    const eventsBefore = session.events().length;
    const positionBefore = atClosure.player.position;
    const startTick120 = target.selectedAtTick120 + 1;
    let snapshot = session.step(input(startTick120, {
      movement: {x: 1, y: 0},
      signalActive: true,
      focused: true,
      gaze: {skyEyeVisible: true, pitchDegrees: 60, alignment: 1},
      overridePressed: true,
      overrideDirection: {x: 1, y: 0},
    }));

    expect(snapshot).toMatchObject({
      phase: "first_continuation_transition",
      tick120: startTick120,
      segmentTick120: 0,
      player: {focused: true},
      combat: {
        patternId: "transition.room_threshold",
        occurrenceId: "run:room:0-to-1:transition:transition.room_threshold",
        tick120: startTick120,
      },
      roomSampling: {
        phase: "first_room_complete",
        tick120: target.selectedAtTick120,
      },
      firstContinuationTransition: {
        phase: "transition_gameplay",
        sourceRoom: "FORCED_ALIGNMENT",
        targetRoom: target.targetRoom,
        worldRoom: "FORCED_ALIGNMENT",
        patternId: "transition.room_threshold",
        occurrenceId: "run:room:0-to-1:transition:transition.room_threshold",
        startTick120,
        combat: {tick120: startTick120, relativeTick120: 0},
        gameplayExit: null,
        handoff: {state: "withheld-transition-gameplay", ready: false},
      },
    });
    expect(snapshot.player.position.x).toBeGreaterThan(positionBefore.x);
    expect(JSON.stringify(snapshot.player.flower)).toBe(frozenFlower);
    expect(JSON.stringify(snapshot.gaze)).toBe(frozenGaze);
    expect(JSON.stringify(snapshot.firstRoomClosureCapture)).toBe(frozenClosure);
    expect(JSON.stringify(snapshot.firstRoomMetricProjection)).toBe(frozenProjection);
    expect(JSON.stringify(snapshot.firstContinuationRoomTarget)).toBe(frozenTarget);
    expect(session.events().slice(eventsBefore).map((event) => event.id)).toEqual([
      "player.collision.off",
      "room.transition.begin",
    ]);
    expect(snapshot.behaviorFacts.requested).toMatchObject({
      availability: "available",
      lastAvailableTick120: startTick120,
      sampleCount: requestedBefore.sampleCount + 1,
      aggregate: {
        signalActiveTickCount: requestedBefore.aggregate.signalActiveTickCount + 1,
        signalRisingEdgeCount: requestedBefore.aggregate.signalRisingEdgeCount + 1,
        focusRequestedTickCount: requestedBefore.aggregate.focusRequestedTickCount + 1,
        gazeQualifiedInputTickCount: requestedBefore.aggregate.gazeQualifiedInputTickCount + 1,
        overridePressedEdgeCount: requestedBefore.aggregate.overridePressedEdgeCount + 1,
        overrideDirectionRequestCount:
          requestedBefore.aggregate.overrideDirectionRequestCount + 1,
      },
    });
    expect(snapshot.behaviorFacts.committed.player).toMatchObject({
      availability: "available",
      lastAvailableTick120: startTick120,
      sampleCount: playerFactsBefore.sampleCount + 1,
      aggregate: {focusedTickCount: playerFactsBefore.aggregate.focusedTickCount + 1},
    });
    expect(JSON.stringify(snapshot.behaviorFacts.committed.flower)).toBe(frozenFlowerFacts);
    expect(JSON.stringify(snapshot.behaviorFacts.committed.gaze)).toBe(frozenGazeFacts);
    expect(JSON.stringify(snapshot.behaviorFacts.context.room)).toBe(frozenRoomFacts);
    if (snapshot.behaviorFacts.context.runCombat.availability !== "available") {
      throw new Error("transition Run combat fact was not recorded");
    }
    expect(snapshot.behaviorFacts.context.runCombat).toMatchObject({
      lastAvailableTick120: startTick120,
      sampleCount: runCombatBefore.sampleCount + 1,
    });
    expect(count(
      snapshot.behaviorFacts.context.runCombat.aggregate.activeOccurrenceTickCounts,
      "run:room:0-to-1:transition:transition.room_threshold",
    )).toBe(1);

    const patternCompleteTick120 = snapshot.firstContinuationTransition?.timeline
      .patternCompleteTick120;
    if (patternCompleteTick120 === undefined) throw new Error("transition timeline disappeared");
    while (snapshot.tick120 < patternCompleteTick120) {
      snapshot = session.step(input(snapshot.tick120 + 1, {
        signalActive: true,
        focused: true,
        gaze: {skyEyeVisible: true, pitchDegrees: 60, alignment: 1},
        overrideReleased: snapshot.tick120 === startTick120,
      }));
    }
    expect(snapshot).toMatchObject({
      phase: "first_continuation_room",
      tick120: patternCompleteTick120,
      segmentTick120: 0,
      player: {focused: true},
      combat: null,
      firstContinuationTransition: {
        ownership: "transferred-to-dormant-successor",
        phase: "material_carryover",
        worldRoom: target.targetRoom,
        collisionLeaseReleased: true,
        combat: {
          patternComplete: true,
          digitalBodiesDrained: true,
          poolUsage: {liveColliders: 0},
        },
        gameplayExit: {
          atTick120: patternCompleteTick120,
          patternComplete: true,
          digitalBodiesDrained: true,
          liveDigitalBodies: 0,
          liveColliders: 0,
        },
        material: {drained: false},
        handoff: {
          state: "ready-pending-room-plan-and-combined-pool-budget",
          ready: true,
          atTick120: patternCompleteTick120,
          materialDrainingAtHandoff: true,
          nextRoomAdmission: "withheld-pending-room-plan-and-combined-pool-budget",
        },
      },
      firstContinuationRoom: {
        phase: "dormant",
        tick120: patternCompleteTick120,
        relativeTick120: 0,
        targetRoom: target.targetRoom,
        worldRoom: target.targetRoom,
        patternId: "room.in_between.context_switch",
        combat: null,
        targetVisible: false,
        nextMasterTickAction: "telegraph",
        combinedPoolAdmission: {
          state: "committed",
          reservationCommitted: true,
          canonicalEventWrites: 0,
          tickAdvance: 0,
        },
      },
      firstContinuationRoomAdmissionWithheld: null,
    });
    expect(snapshot.firstContinuationTransition?.material?.materialCount).toBeGreaterThan(0);
    expect(snapshot.firstContinuationRoom?.material).toEqual(
      snapshot.firstContinuationTransition?.material,
    );
    expect(JSON.stringify(snapshot.player.flower)).toBe(frozenFlower);
    expect(JSON.stringify(snapshot.gaze)).toBe(frozenGaze);
    expect(JSON.stringify(snapshot.behaviorFacts.committed.flower)).toBe(frozenFlowerFacts);
    expect(JSON.stringify(snapshot.behaviorFacts.committed.gaze)).toBe(frozenGazeFacts);
    expect(JSON.stringify(snapshot.behaviorFacts.context.room)).toBe(frozenRoomFacts);
    expect(JSON.stringify(snapshot.firstRoomClosureCapture)).toBe(frozenClosure);
    expect(JSON.stringify(snapshot.firstRoomMetricProjection)).toBe(frozenProjection);
    expect(JSON.stringify(snapshot.firstContinuationRoomTarget)).toBe(frozenTarget);
    expect(availableSampleCount(snapshot.behaviorFacts.requested))
      .toBe(availableSampleCount(atClosure.behaviorFacts.requested) + 937);
    expect(availableSampleCount(snapshot.behaviorFacts.context.runCombat))
      .toBe(availableSampleCount(atClosure.behaviorFacts.context.runCombat) + 937);
    expect(count(
      snapshot.behaviorFacts.sampling.ownerPhaseTickCounts,
      "room_sampling",
    )).toBe(count(
      atClosure.behaviorFacts.sampling.ownerPhaseTickCounts,
      "room_sampling",
    ) + 937);
    expect(session.events().slice(eventsBefore).some((event) =>
      event.id === "flower.intensity.commit"
      || event.id === "gaze.clamp.commit"
      || event.id === "gaze.clamp.release")).toBe(false);

    const successorAtHandoff = snapshot.firstContinuationRoom;
    if (successorAtHandoff === null) throw new Error("successor owner was not admitted");
    const roomTransitionCompleteCount = session.events().filter((event) =>
      event.id === "room.transition.complete").length;
    const overridePressesAtHandoff = snapshot.behaviorFacts.requested.availability === "available"
      ? snapshot.behaviorFacts.requested.aggregate.overridePressedEdgeCount
      : 0;

    snapshot = session.step(input(patternCompleteTick120 + 1, {
      signalActive: true,
      focused: true,
      gaze: {skyEyeVisible: true, pitchDegrees: 60, alignment: 1},
      overridePressed: true,
      overrideDirection: {x: 1, y: 0},
    }));
    expect(snapshot).toMatchObject({
      phase: "first_continuation_room",
      tick120: patternCompleteTick120 + 1,
      firstContinuationTransition: {
        ownership: "transferred-to-dormant-successor",
        phase: "material_carryover",
        handoff: {ready: true, atTick120: patternCompleteTick120},
      },
      firstContinuationRoom: {
        phase: "telegraph",
        relativeTick120: 1,
        combat: null,
        nextMasterTickAction: "continue-telegraph",
        inputOwnership: {override: "locked"},
      },
      combat: null,
      override: {state: "idle", localVoid: null},
    });
    expect(snapshot.behaviorFacts.requested).toMatchObject({
      availability: "available",
      aggregate: {overridePressedEdgeCount: overridePressesAtHandoff + 1},
    });
    expect(JSON.stringify(snapshot.player.flower)).toBe(frozenFlower);
    expect(JSON.stringify(snapshot.gaze)).toBe(frozenGaze);
    expect(JSON.stringify(snapshot.behaviorFacts.committed.flower)).toBe(frozenFlowerFacts);
    expect(JSON.stringify(snapshot.behaviorFacts.committed.gaze)).toBe(frozenGazeFacts);
    expect(JSON.stringify(snapshot.behaviorFacts.context.room)).toBe(frozenRoomFacts);

    const readStartTick120 = successorAtHandoff.boundaryTicks120.readStartTick120;
    while (snapshot.tick120 < readStartTick120) {
      snapshot = session.step(input(snapshot.tick120 + 1, {
        signalActive: true,
        focused: true,
        gaze: {skyEyeVisible: true, pitchDegrees: 60, alignment: 1},
        overrideReleased: snapshot.tick120 === patternCompleteTick120 + 1,
      }));
    }
    expect(snapshot).toMatchObject({
      phase: "first_continuation_room",
      tick120: readStartTick120,
      firstContinuationRoom: {
        phase: "read",
        relativeTick120: 159,
        combat: {
          relativeTick120: 0,
          patternId: "room.in_between.context_switch",
          projectiles: [],
        },
      },
      combat: {
        relativeTick120: 0,
        patternId: "room.in_between.context_switch",
        projectiles: [],
      },
      override: {state: "idle", localVoid: null},
    });

    while (
      (snapshot.firstContinuationRoom?.combat?.projectiles.length ?? 0) === 0
      && snapshot.tick120 < readStartTick120 + 600
    ) {
      snapshot = session.step(input(snapshot.tick120 + 1));
    }
    expect(snapshot.firstContinuationRoom?.combat?.projectiles.length).toBeGreaterThan(0);
    const reservation = snapshot.firstContinuationRoom?.combinedPoolAdmission.reservation;
    if (reservation === undefined) throw new Error("successor pool reservation disappeared");
    expect(
      (snapshot.firstContinuationRoom?.material.poolUsage.residueVisuals ?? 0)
        + (snapshot.firstContinuationRoom?.combat?.poolUsage.residueVisuals ?? 0),
    ).toBeLessThanOrEqual(reservation.combinedResidueVisuals);

    const sliceCompleteTick120 = successorAtHandoff.boundaryTicks120.sliceCompleteTick120;
    while (snapshot.tick120 < sliceCompleteTick120) {
      snapshot = session.step(input(snapshot.tick120 + 1, {
        signalActive: true,
        focused: true,
        gaze: {skyEyeVisible: true, pitchDegrees: 60, alignment: 1},
      }));
    }
    expect(snapshot).toMatchObject({
      phase: "first_continuation_room",
      tick120: sliceCompleteTick120,
      firstContinuationTransition: {
        ownership: "transferred-to-dormant-successor",
        material: {drained: true, materialCount: 0},
      },
      firstContinuationRoom: {
        phase: "complete",
        nextMasterTickAction: "advance-complete-hold",
        material: {drained: true, materialCount: 0},
        runCombat: {activeOccurrenceId: null, pendingFlushTick120: null},
        combat: {
          patternComplete: true,
          digitalBodiesDrained: true,
          poolUsage: {liveColliders: 0},
        },
      },
    });
    expect(snapshot.firstContinuationRoom?.combat?.projectiles.every((projectile) =>
      projectile.state === "residue" && !projectile.collisionEnabled)).toBe(true);
    expect(snapshot.firstContinuationRoom?.combat?.projectiles.length).toBeGreaterThan(0);

    while ((snapshot.firstContinuationRoom?.combat?.projectiles.length ?? 0) > 0) {
      snapshot = session.step(input(snapshot.tick120 + 1));
    }
    const drainedAtTick120 = snapshot.tick120;
    snapshot = session.step(input(drainedAtTick120 + 1));
    expect(snapshot).toMatchObject({
      phase: "first_continuation_room",
      tick120: drainedAtTick120 + 1,
      firstContinuationRoom: {
        phase: "complete",
        nextMasterTickAction: "advance-complete-hold",
        combat: {
          projectileLifecycleDrained: true,
          projectiles: [],
          poolUsage: {liveColliders: 0},
        },
      },
    });
    expect(snapshot.firstContinuationRoom?.runCombat.claimedOccurrenceIds.filter((occurrenceId) =>
      occurrenceId === snapshot.firstContinuationRoom?.occurrenceId)).toHaveLength(1);
    expect(session.events().filter((event) => event.id === "room.transition.complete"))
      .toHaveLength(roomTransitionCompleteCount);
    expect(session.events().some((event) => event.id === "player.override.local_void.open"))
      .toBe(false);
    expect(JSON.stringify(snapshot.player.flower)).toBe(frozenFlower);
    expect(JSON.stringify(snapshot.gaze)).toBe(frozenGaze);
    expect(JSON.stringify(snapshot.behaviorFacts.committed.flower)).toBe(frozenFlowerFacts);
    expect(JSON.stringify(snapshot.behaviorFacts.committed.gaze)).toBe(frozenGazeFacts);
    expect(JSON.stringify(snapshot.behaviorFacts.context.room)).toBe(frozenRoomFacts);
    expect(JSON.stringify(snapshot.firstRoomClosureCapture)).toBe(frozenClosure);
    expect(JSON.stringify(snapshot.firstRoomMetricProjection)).toBe(frozenProjection);
    expect(JSON.stringify(snapshot.firstContinuationRoomTarget)).toBe(frozenTarget);
  });
});
