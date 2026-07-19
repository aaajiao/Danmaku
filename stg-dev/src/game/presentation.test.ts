import {describe, expect, it} from "vitest";
import patternsManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/executable-patterns-v4.json";
import {
  CanonicalRunSession,
  type CanonicalRunSessionSnapshot,
} from "../authority/run-session";
import type {PatternDefinition} from "./types";
import {
  canonicalDirectionToView,
  canonicalPositionToView,
  projectCanonicalRunSession,
} from "./presentation";

const FIRST_EYE = (patternsManifest.patterns as PatternDefinition[])
  .find((pattern) => pattern.id === "common.eye_acquisition")!;
const FIRST_ROOM = (patternsManifest.patterns as PatternDefinition[])
  .find((pattern) => pattern.id === "room.forced.left_right_gate")!;
const FIRST_TRANSITION = (patternsManifest.patterns as PatternDefinition[])
  .find((pattern) => pattern.id === "transition.room_threshold")!;
const OPTIONS = Object.freeze({
  rawRunSeed: Object.freeze({domain: "raw-run-seed" as const, value: 0x1b17c0de}),
  grazeRadiusPx: 18,
  projectileDamage: 1,
  projectilePoolClasses: Object.freeze({"bullet.micro.notch_e": "micro" as const}),
});
const NEUTRAL_GAZE = Object.freeze({
  skyEyeVisible: true,
  pitchDegrees: 0,
  alignment: 0,
});

function stepTo(session: CanonicalRunSession, targetTick120: number): void {
  for (let tick120 = session.snapshot().tick120 + 1; tick120 <= targetTick120; tick120 += 1) {
    session.step({
      tick120,
      movement: {x: 0, y: 0},
      signalActive: tick120 === 1 || tick120 === 3,
      focused: false,
      gaze: NEUTRAL_GAZE,
    });
  }
}

function stepToFirstRoomHandoff(session: CanonicalRunSession): CanonicalRunSessionSnapshot {
  stepTo(session, 960);
  for (let tick120 = 961; tick120 <= 1021; tick120 += 1) {
    session.step({
      tick120,
      movement: {x: 0, y: 0},
      signalActive: false,
      focused: false,
      gaze: {skyEyeVisible: true, pitchDegrees: 60, alignment: 1},
    });
  }
  let snapshot = session.snapshot();
  while (snapshot.roomSampling === null && snapshot.tick120 < 2800) {
    session.step({
      tick120: snapshot.tick120 + 1,
      movement: {x: 0, y: 0},
      signalActive: false,
      focused: false,
      gaze: NEUTRAL_GAZE,
    });
    snapshot = session.snapshot();
  }
  if (snapshot.roomSampling === null) throw new Error("room projection fixture missed handoff");
  return snapshot;
}

describe("canonical run presentation", () => {
  it("converts the one canonical coordinate boundary exactly", () => {
    expect(canonicalPositionToView({x: 0, y: 0})).toEqual({x: -180, y: 320});
    expect(canonicalPositionToView({x: 180, y: 570})).toEqual({x: 0, y: -250});
    expect(canonicalPositionToView({x: 360, y: 640})).toEqual({x: 180, y: -320});
    expect(canonicalDirectionToView({x: 0.6, y: -0.8})).toEqual({x: 0.6, y: 0.8});
  });

  it("projects stable projectile identity and explicit lifecycle without authority write-back", () => {
    const session = new CanonicalRunSession(OPTIONS);
    stepTo(session, 1040);
    const authorityBefore = session.canonicalEventSerialization();
    const first = projectCanonicalRunSession(session.snapshot(), FIRST_EYE);
    const second = projectCanonicalRunSession(session.snapshot(), FIRST_EYE);
    expect(first.bullets.length).toBeGreaterThan(0);
    expect(first.bullets.map((bullet) => bullet.id)).toEqual(second.bullets.map((bullet) => bullet.id));
    expect(first.bullets.every((bullet) => bullet.lifecycleState !== undefined)).toBe(true);
    expect(first.player.position).toEqual({x: 0, y: -250});
    expect(first.gazeState).toBe("idle");
    expect(first.targetVisible).toBe(true);
    expect(first.safeGapCenterX).toBeTypeOf("number");
    expect(first.safeGapWidthPx).toBe(50);
    expect(session.canonicalEventSerialization()).toBe(authorityBefore);
  });

  it("projects the V4 flower target instead of deriving expression from Focus", () => {
    const session = new CanonicalRunSession(OPTIONS);
    expect(projectCanonicalRunSession(session.snapshot(), FIRST_EYE).player.expression).toBe(0.3);

    session.step({
      tick120: 1,
      movement: {x: 0, y: 0},
      signalActive: true,
      focused: true,
      gaze: NEUTRAL_GAZE,
    });
    expect(projectCanonicalRunSession(session.snapshot(), FIRST_EYE).player.expression).toBe(0.5);
    expect(session.snapshot().player.focused).toBe(false);

    session.step({
      tick120: 2,
      movement: {x: 0, y: 0},
      signalActive: false,
      focused: false,
      gaze: NEUTRAL_GAZE,
    });
    session.step({
      tick120: 3,
      movement: {x: 0, y: 0},
      signalActive: true,
      focused: false,
      gaze: NEUTRAL_GAZE,
    });
    stepTo(session, 960);
    session.step({
      tick120: 961,
      movement: {x: 0, y: 0},
      signalActive: true,
      focused: true,
      gaze: NEUTRAL_GAZE,
    });
    expect(projectCanonicalRunSession(session.snapshot(), FIRST_EYE).player.expression).toBe(0.35);
  });

  it("projects committed gaze state without exposing an authority command port", () => {
    const session = new CanonicalRunSession(OPTIONS);
    stepTo(session, 960);
    session.step({
      tick120: 961,
      movement: {x: 0, y: 0},
      signalActive: false,
      focused: false,
      gaze: {skyEyeVisible: true, pitchDegrees: 60, alignment: 1},
    });

    expect(session.snapshot().gaze.state).toBe("acquiring");
    expect(projectCanonicalRunSession(session.snapshot(), FIRST_EYE).gazeState).toBe("acquiring");
  });

  it("retains the phase-owned Eye after combat generation and residue drain", () => {
    const session = new CanonicalRunSession(OPTIONS);
    stepTo(session, 960);
    let snapshot = session.snapshot();
    while (snapshot.handoff.sourceCombat === null && snapshot.tick120 < 2760) {
      session.step({
        tick120: snapshot.tick120 + 1,
        movement: {x: 0, y: 0},
        signalActive: false,
        focused: false,
        gaze: NEUTRAL_GAZE,
      });
      snapshot = session.snapshot();
    }

    const projected = projectCanonicalRunSession(snapshot, FIRST_EYE);
    expect(snapshot).toMatchObject({phase: "first_eye", handoff: {ready: false}});
    expect(projected).toMatchObject({combatEnabled: false, targetVisible: true, gazeState: "idle"});
  });

  it("projects the fixed first room and continuation transition from their exact owners", {
    timeout: 30_000,
  }, () => {
    const session = new CanonicalRunSession(OPTIONS);
    let snapshot = stepToFirstRoomHandoff(session);
    const eventTraceAtHandoff = session.canonicalEventSerialization();
    expect(projectCanonicalRunSession(snapshot, FIRST_ROOM)).toMatchObject({
      room: "FORCED_ALIGNMENT",
      patternElapsedMs: 0,
      combatEnabled: false,
      targetVisible: false,
      bullets: [],
    });
    expect(session.canonicalEventSerialization()).toBe(eventTraceAtHandoff);

    const readTick120 = snapshot.roomSampling?.boundaryTicks120.read ?? 0;
    while (snapshot.tick120 < readTick120) {
      session.step({
        tick120: snapshot.tick120 + 1,
        movement: {x: 0, y: 0},
        signalActive: false,
        focused: false,
        gaze: NEUTRAL_GAZE,
      });
      snapshot = session.snapshot();
    }
    expect(projectCanonicalRunSession(snapshot, FIRST_ROOM)).toMatchObject({
      room: "FORCED_ALIGNMENT",
      patternElapsedMs: 0,
      combatEnabled: true,
      targetVisible: false,
      bullets: [],
    });

    const firstSpawnTick120 = readTick120 + 88;
    while (snapshot.tick120 < firstSpawnTick120) {
      session.step({
        tick120: snapshot.tick120 + 1,
        movement: {x: 0, y: 0},
        signalActive: false,
        focused: false,
        gaze: NEUTRAL_GAZE,
      });
      snapshot = session.snapshot();
    }
    const projected = projectCanonicalRunSession(snapshot, FIRST_ROOM);
    expect(projected.pattern.id).toBe("room.forced.left_right_gate");
    expect(projected.bullets.length).toBeGreaterThan(0);

    const combat = snapshot.combat;
    if (combat === null) throw new Error("room projection fixture lost READ combat");
    const staleCombat = {
      ...snapshot,
      combat: {...combat, patternId: "common.eye_acquisition"},
    } as unknown as CanonicalRunSessionSnapshot;
    expect(() => projectCanonicalRunSession(staleCombat, FIRST_ROOM))
      .toThrow(/combat pattern identity drifted/);

    const firstRoomStartTick120 = snapshot.roomSampling?.boundaryTicks120.start;
    if (firstRoomStartTick120 === undefined) throw new Error("room projection lost H");
    while (snapshot.tick120 < firstRoomStartTick120 + 1_702) {
      snapshot = session.step({
        tick120: snapshot.tick120 + 1,
        movement: {x: 0, y: 0},
        signalActive: false,
        focused: false,
        gaze: NEUTRAL_GAZE,
      });
    }
    const formalTarget = snapshot.firstContinuationRoomTarget;
    if (formalTarget.availability !== "available") {
      throw new Error("room projection lost its formal continuation target");
    }
    snapshot = session.step({
      tick120: snapshot.tick120 + 1,
      movement: {x: 0, y: 0},
      signalActive: true,
      focused: true,
      gaze: {skyEyeVisible: true, pitchDegrees: 60, alignment: 1},
    });
    let transitionProjection = projectCanonicalRunSession(snapshot, FIRST_TRANSITION);
    expect(transitionProjection).toMatchObject({
      pattern: {id: "transition.room_threshold"},
      room: "FORCED_ALIGNMENT",
      patternElapsedMs: 0,
      combatEnabled: true,
      targetVisible: false,
      player: {focused: true},
    });
    const transition = snapshot.firstContinuationTransition;
    if (transition === null) throw new Error("transition projection lost its chapter snapshot");
    while (snapshot.tick120 < transition.timeline.worldSwapTick120 - 1) {
      snapshot = session.step({
        tick120: snapshot.tick120 + 1,
        movement: {x: 0, y: 0},
        signalActive: false,
        focused: false,
        gaze: NEUTRAL_GAZE,
      });
    }
    expect(projectCanonicalRunSession(snapshot, FIRST_TRANSITION).room)
      .toBe("FORCED_ALIGNMENT");
    snapshot = session.step({
      tick120: snapshot.tick120 + 1,
      movement: {x: 0, y: 0},
      signalActive: false,
      focused: false,
      gaze: NEUTRAL_GAZE,
    });
    expect(projectCanonicalRunSession(snapshot, FIRST_TRANSITION).room)
      .toBe(formalTarget.targetRoom);

    while (snapshot.tick120 < transition.startTick120 + 100) {
      snapshot = session.step({
        tick120: snapshot.tick120 + 1,
        movement: {x: 0, y: 0},
        signalActive: false,
        focused: false,
        gaze: NEUTRAL_GAZE,
      });
    }
    transitionProjection = projectCanonicalRunSession(snapshot, FIRST_TRANSITION);
    expect(transitionProjection.bullets.length).toBeGreaterThan(0);
    expect(transitionProjection.bullets.some((bullet) => bullet.collisionEnabled)).toBe(true);

    while (snapshot.tick120 < transition.timeline.patternCompleteTick120 - 1) {
      snapshot = session.step({
        tick120: snapshot.tick120 + 1,
        movement: {x: 0, y: 0},
        signalActive: false,
        focused: false,
        gaze: NEUTRAL_GAZE,
      });
    }
    expect(snapshot.firstContinuationTransition).toMatchObject({
      phase: "transition_gameplay",
      material: null,
      gameplayExit: null,
    });
    snapshot = session.step({
      tick120: snapshot.tick120 + 1,
      movement: {x: 0, y: 0},
      signalActive: false,
      focused: false,
      gaze: NEUTRAL_GAZE,
    });
    const material = snapshot.firstContinuationTransition?.material;
    if (material === null || material === undefined) {
      throw new Error("transition projection lost material carryover");
    }
    const successorAtHandoff = snapshot.firstContinuationRoom;
    if (successorAtHandoff === null) {
      throw new Error("presentation fixture lost the admitted successor");
    }
    const successorPattern = (patternsManifest.patterns as PatternDefinition[])
      .find((pattern) => pattern.id === successorAtHandoff.patternId);
    if (successorPattern === undefined) {
      throw new Error("presentation fixture selected an unknown successor pattern");
    }
    let successorProjection = projectCanonicalRunSession(snapshot, successorPattern);
    expect(successorProjection).toMatchObject({
      pattern: {id: successorAtHandoff.patternId},
      room: formalTarget.targetRoom,
      patternElapsedMs: 0,
      combatEnabled: false,
      targetVisible: false,
    });
    expect(successorProjection.bullets).toHaveLength(material.materialCount);
    expect(successorProjection.bullets.every((bullet) =>
      bullet.lifecycleState === "residue" && bullet.collisionEnabled === false)).toBe(true);
    expect(() => projectCanonicalRunSession(snapshot, FIRST_TRANSITION))
      .toThrow(/pattern identity drifted/);

    const hostileMaterial = {
      ...snapshot,
      firstContinuationTransition: {
        ...snapshot.firstContinuationTransition,
        material: {...material, materialCount: material.materialCount + 1},
      },
    } as unknown as CanonicalRunSessionSnapshot;
    expect(() => projectCanonicalRunSession(hostileMaterial, successorPattern))
      .toThrow(/material identity drifted/);

    const readStartTick120 = successorAtHandoff.boundaryTicks120.readStartTick120;
    while (snapshot.tick120 < readStartTick120) {
      snapshot = session.step({
        tick120: snapshot.tick120 + 1,
        movement: {x: 0, y: 0},
        signalActive: false,
        focused: false,
        gaze: NEUTRAL_GAZE,
      });
    }
    successorProjection = projectCanonicalRunSession(snapshot, successorPattern);
    expect(successorProjection).toMatchObject({
      patternElapsedMs: 0,
      combatEnabled: true,
      targetVisible: false,
    });
    const successorAtRead = snapshot.firstContinuationRoom;
    if (successorAtRead === null) throw new Error("successor disappeared at READ");
    expect(successorProjection.bullets).toHaveLength(successorAtRead.material.materialCount);

    while (
      (snapshot.firstContinuationRoom?.combat?.projectiles.length ?? 0) === 0
      && snapshot.tick120 < readStartTick120 + 600
    ) {
      snapshot = session.step({
        tick120: snapshot.tick120 + 1,
        movement: {x: 0, y: 0},
        signalActive: false,
        focused: false,
        gaze: NEUTRAL_GAZE,
      });
    }
    const liveSuccessor = snapshot.firstContinuationRoom;
    if (liveSuccessor?.combat === null || liveSuccessor === null) {
      throw new Error("successor projection lost READ combat");
    }
    expect(liveSuccessor.combat.projectiles.length).toBeGreaterThan(0);
    expect(liveSuccessor.material.materialCount).toBeGreaterThan(0);
    successorProjection = projectCanonicalRunSession(snapshot, successorPattern);
    expect(successorProjection.bullets).toHaveLength(
      liveSuccessor.material.materialCount + liveSuccessor.combat.projectiles.length,
    );
    expect(successorProjection.bullets.slice(0, liveSuccessor.material.materialCount)
      .every((bullet) =>
        bullet.lifecycleState === "residue" && bullet.collisionEnabled === false)).toBe(true);
    expect(new Set(successorProjection.bullets.map((bullet) => bullet.id)).size)
      .toBe(successorProjection.bullets.length);

    while (snapshot.tick120 < successorAtHandoff.boundaryTicks120.sliceCompleteTick120) {
      snapshot = session.step({
        tick120: snapshot.tick120 + 1,
        movement: {x: 0, y: 0},
        signalActive: false,
        focused: false,
        gaze: NEUTRAL_GAZE,
      });
    }
    expect(snapshot.firstContinuationTransition).toMatchObject({
      phase: "target_room_idle",
      material: {drained: true, materialCount: 0},
    });
    expect(snapshot.firstContinuationRoom).toMatchObject({
      phase: "complete",
      material: {drained: true, materialCount: 0},
      combat: {
        patternComplete: true,
        digitalBodiesDrained: true,
        poolUsage: {liveColliders: 0},
      },
    });
    successorProjection = projectCanonicalRunSession(snapshot, successorPattern);
    expect(successorProjection.bullets.length).toBeGreaterThan(0);
    expect(successorProjection.bullets.every((bullet) =>
      bullet.lifecycleState === "residue" && bullet.collisionEnabled === false)).toBe(true);

    while ((snapshot.firstContinuationRoom?.combat?.projectiles.length ?? 0) > 0) {
      snapshot = session.step({
        tick120: snapshot.tick120 + 1,
        movement: {x: 0, y: 0},
        signalActive: false,
        focused: false,
        gaze: NEUTRAL_GAZE,
      });
    }
    expect(projectCanonicalRunSession(snapshot, successorPattern).bullets).toEqual([]);
  });

  it("projects retained life state and never presents a non-alive player as focused", () => {
    const session = new CanonicalRunSession(OPTIONS);
    const awakening = projectCanonicalRunSession(session.snapshot(), FIRST_EYE);
    expect("lifeState" in awakening.player).toBe(false);

    stepTo(session, 960);
    const aliveRun = session.snapshot();
    const aliveDamage = aliveRun.player.damage;
    expect(aliveDamage).not.toBeNull();
    if (aliveDamage === null) throw new Error("first-eye projection fixture lost player authority");
    expect(projectCanonicalRunSession(aliveRun, FIRST_EYE).player.lifeState).toBe("alive");

    const deadRun = {
      ...aliveRun,
      player: {
        ...aliveRun.player,
        focused: true,
        inputEnabled: false,
        damage: {
          ...aliveDamage,
          state: "dead",
          health: 0,
          collisionEnabled: false,
          respawnPlaceAtTick120: aliveRun.tick120 + 12,
          respawnCompleteAtTick120: aliveRun.tick120 + 96,
        },
      },
    } satisfies CanonicalRunSessionSnapshot;
    expect(projectCanonicalRunSession(deadRun, FIRST_EYE).player).toMatchObject({
      focused: false,
      lifeState: "dead",
      health: 0,
      collisionEnabled: false,
    });
  });

  it("fails closed on a mismatched presentation pattern", () => {
    const session = new CanonicalRunSession(OPTIONS);
    const other = (patternsManifest.patterns as PatternDefinition[])
      .find((pattern) => pattern.id === "common.graze_calibration")!;
    expect(() => projectCanonicalRunSession(session.snapshot(), other)).toThrow(/identity drifted/);
  });
});
