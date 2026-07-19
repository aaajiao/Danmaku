import {describe, expect, it} from "vitest";

import type {CanonicalCombatStepInput, CanonicalRunCombatState} from "../../combat-kernel";
import type {CanonicalEventBus} from "../../events";
import type {CanonicalRunFirstContinuationRoomTargetAvailable} from "../../run-first-continuation-room-target";
import {
  CanonicalRunSession,
  type CanonicalRunSessionSnapshot,
  type CanonicalRunSessionStepInput,
} from "../../run-session";
import {
  CanonicalRunFirstContinuationTransitionChapter,
  inspectCanonicalRunFirstContinuationRoomHandoffReceipt,
} from "./first-continuation-transition";

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

function reachFormalTarget(): Readonly<{
  eventBus: CanonicalEventBus;
  runState: CanonicalRunCombatState;
  formalTarget: CanonicalRunFirstContinuationRoomTargetAvailable;
}> {
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
    bus: CanonicalEventBus;
    combatState: CanonicalRunCombatState | null;
    firstContinuationRoomTargetValue: CanonicalRunFirstContinuationRoomTargetAvailable | null;
  }>;
  if (
    snapshot.firstContinuationRoomTarget.availability !== "available"
    || internals.combatState === null
    || internals.firstContinuationRoomTargetValue === null
  ) {
    throw new Error("chapter fixture lost its exact H+1702 authority capabilities");
  }
  return Object.freeze({
    eventBus: internals.bus,
    runState: internals.combatState,
    formalTarget: internals.firstContinuationRoomTargetValue,
  });
}

describe("first continuation transition chapter owner", () => {
  it("owns start through material handoff without exposing mutable authorities", {
    timeout: 30_000,
  }, () => {
    const fixture = reachFormalTarget();
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
  });
});
