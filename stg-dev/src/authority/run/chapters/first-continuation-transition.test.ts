import {beforeAll, describe, expect, it} from "vitest";

import {
  CanonicalRunCombatState,
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

describe("first continuation transition chapter owner", () => {
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
