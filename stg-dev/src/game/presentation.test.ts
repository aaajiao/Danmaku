import {describe, expect, it} from "vitest";
import patternsManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/executable-patterns-v4.json";
import type {PatternDefinition} from "./types";
import {
  canonicalDirectionToView,
  canonicalPositionToView,
  projectPresentationSnapshot,
  type PresentationProjectileSnapshot,
  type PresentationSourceSnapshot,
} from "./presentation";

const FIRST_EYE = (patternsManifest.patterns as PatternDefinition[])
  .find((pattern) => pattern.id === "common.eye_acquisition")!;
const GRAZE_CALIBRATION = (patternsManifest.patterns as PatternDefinition[])
  .find((pattern) => pattern.id === "common.graze_calibration")!;
const FIRST_EYE_EMITTER_ID = FIRST_EYE.emitters[0]!.id;

function projectileFixture(
  overrides: Partial<PresentationProjectileSnapshot> = {},
): PresentationProjectileSnapshot {
  return {
    instanceId: "projectile-1",
    generation: 1,
    archetypeId: "bullet.micro.notch_e",
    collisionRadiusPx: 3,
    state: "flight",
    collisionEnabled: true,
    previousPosition: {x: 180, y: 100},
    position: {x: 180, y: 101},
    spawnedAtTick: 1_000,
    armAtTick: 1_012,
    sourceId: FIRST_EYE_EMITTER_ID,
    headingDegrees: 90,
    speedPxPerSecond: 120,
    ...overrides,
  };
}

function sourceFixture(
  overrides: Partial<PresentationSourceSnapshot> = {},
): PresentationSourceSnapshot {
  return {
    tick120: 1_040,
    relativeTick120: 40,
    patternId: "common.eye_acquisition",
    roomId: "INFORMATION",
    difficulty: "NORMAL",
    projectiles: [projectileFixture()],
    combatEnabled: true,
    targetVisible: true,
    player: {
      position: {x: 180, y: 570},
      focused: false,
      damage: {state: "alive", health: 3, lives: 3, collisionEnabled: true},
      evidence: 0,
      expression: 0.3,
    },
    gazeState: "idle",
    gazeClampReleased: false,
    localVoid: null,
    ...overrides,
  };
}

describe("canonical run presentation", () => {
  it("converts the one canonical coordinate boundary exactly", () => {
    expect(canonicalPositionToView({x: 0, y: 0})).toEqual({x: -180, y: 320});
    expect(canonicalPositionToView({x: 180, y: 570})).toEqual({x: 0, y: -250});
    expect(canonicalPositionToView({x: 360, y: 640})).toEqual({x: 180, y: -320});
    expect(canonicalDirectionToView({x: 0.6, y: -0.8})).toEqual({x: 0.6, y: 0.8});
  });

  it("rejects non-finite canonical coordinates", () => {
    expect(() => canonicalPositionToView({x: Number.NaN, y: 0})).toThrow(/finite/);
    expect(() => canonicalDirectionToView({x: 0, y: Number.POSITIVE_INFINITY})).toThrow(/finite/);
  });

  it("projects stable projectile identity and explicit lifecycle", () => {
    const source = sourceFixture();
    const first = projectPresentationSnapshot(source, FIRST_EYE);
    const second = projectPresentationSnapshot(source, FIRST_EYE);
    expect(first.bullets.length).toBe(1);
    expect(first.bullets.map((bullet) => bullet.id))
      .toEqual(second.bullets.map((bullet) => bullet.id));
    expect(first.bullets[0]!.id).toBe("projectile-1:1");
    expect(first.bullets[0]!.lifecycleState).toBe("flight");
    expect(first.bullets[0]!.collisionEnabled).toBe(true);
    expect(first.player.position).toEqual({x: 0, y: -250});
    expect(first.gazeState).toBe("idle");
    expect(first.targetVisible).toBe(true);
    expect(first.room).toBe("INFORMATION");
    expect(first.nowMs).toBeCloseTo(1_040 * 1000 / 120, 10);
    expect(first.patternElapsedMs).toBeCloseTo(40 * 1000 / 120, 10);
    expect(first.safeGapCenterX).toBeTypeOf("number");
    // eye_acquisition minimumWidthPx 42 + NORMAL gapDeltaPx 0.
    expect(first.safeGapWidthPx).toBe(42);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.bullets)).toBe(true);
    expect(Object.isFrozen(first.player)).toBe(true);
  });

  it("maps authority lifecycle states onto the renderer's three-state model", () => {
    const source = sourceFixture({
      projectiles: [
        projectileFixture({instanceId: "a", state: "spawn"}),
        projectileFixture({instanceId: "b", state: "arm"}),
        projectileFixture({instanceId: "c", state: "flight"}),
        projectileFixture({instanceId: "d", state: "residue", collisionEnabled: false}),
      ],
    });
    const projected = projectPresentationSnapshot(source, FIRST_EYE);
    expect(projected.bullets.map((bullet) => bullet.lifecycleState))
      .toEqual(["arm", "arm", "flight", "residue"]);
    expect(projected.bullets[3]!.collisionEnabled).toBe(false);
  });

  it("reconstructs velocity from integer-tick motion with a heading fallback", () => {
    const moving = projectPresentationSnapshot(sourceFixture(), FIRST_EYE).bullets[0]!;
    // Canonical y-down +1px/tick becomes view y-up -120 px/s.
    expect(moving.velocity.x).toBeCloseTo(0, 10);
    expect(moving.velocity.y).toBeCloseTo(-120, 10);

    const stationary = projectPresentationSnapshot(
      sourceFixture({
        projectiles: [projectileFixture({
          previousPosition: {x: 180, y: 100},
          position: {x: 180, y: 100},
          headingDegrees: 90,
          speedPxPerSecond: 120,
        })],
      }),
      FIRST_EYE,
    ).bullets[0]!;
    expect(stationary.velocity.x).toBeCloseTo(0, 6);
    expect(stationary.velocity.y).toBeCloseTo(-120, 6);
  });

  it("fails closed when two projectiles project the same identity", () => {
    const source = sourceFixture({
      projectiles: [projectileFixture(), projectileFixture()],
    });
    expect(() => projectPresentationSnapshot(source, FIRST_EYE))
      .toThrow(/identity collided/);
  });

  it("projects retained life state and never presents a non-alive player as focused", () => {
    const awakening = projectPresentationSnapshot(
      sourceFixture({
        player: {
          position: {x: 180, y: 570},
          focused: true,
          damage: null,
          evidence: 0,
          expression: 0.3,
        },
      }),
      FIRST_EYE,
    );
    expect("lifeState" in awakening.player).toBe(false);
    expect(awakening.player).toMatchObject({
      focused: true,
      health: 3,
      lives: 3,
      collisionEnabled: true,
    });

    const dead = projectPresentationSnapshot(
      sourceFixture({
        player: {
          position: {x: 180, y: 570},
          focused: true,
          damage: {state: "dead", health: 0, lives: 2, collisionEnabled: false},
          evidence: 2,
          expression: 0.5,
        },
      }),
      FIRST_EYE,
    );
    expect(dead.player).toMatchObject({
      focused: false,
      lifeState: "dead",
      health: 0,
      lives: 2,
      collisionEnabled: false,
    });
  });

  it("projects the V4 flower target instead of deriving expression locally", () => {
    const projected = projectPresentationSnapshot(
      sourceFixture({
        player: {
          position: {x: 180, y: 570},
          focused: false,
          damage: null,
          evidence: 0,
          expression: 0.5,
        },
      }),
      FIRST_EYE,
    );
    expect(projected.player.expression).toBe(0.5);
  });

  it("projects Override as a local sector void, absent by default", () => {
    const closed = projectPresentationSnapshot(sourceFixture(), FIRST_EYE);
    expect(closed.overrideUntilMs).toBe(0);
    expect(closed.overrideView).toMatchObject({active: false, radius: 0});

    const open = projectPresentationSnapshot(
      sourceFixture({
        localVoid: {
          active: true,
          direction: {x: 0, y: -1},
          radius: 96,
          halfAngleDegrees: 45,
          closesAtTick120: 1_160,
        },
      }),
      FIRST_EYE,
    );
    expect(open.overrideUntilMs).toBeCloseTo(1_160 * 1000 / 120, 10);
    expect(open.overrideView).toMatchObject({
      active: true,
      radius: 96,
      halfAngleDegrees: 45,
    });
    expect(open.overrideView!.direction).toEqual({x: 0, y: 1});
  });

  it("surfaces the room-threshold target only while the transition FSM owns one", () => {
    const idle = projectPresentationSnapshot(sourceFixture(), FIRST_EYE);
    expect("roomThresholdTargetRoom" in idle).toBe(false);

    const transitioning = projectPresentationSnapshot(
      sourceFixture({roomThresholdTargetRoom: "IN_BETWEEN"}),
      FIRST_EYE,
    );
    expect(transitioning.roomThresholdTargetRoom).toBe("IN_BETWEEN");
  });

  it("fails closed on a mismatched presentation pattern", () => {
    expect(() => projectPresentationSnapshot(sourceFixture(), GRAZE_CALIBRATION))
      .toThrow(/identity drifted/);
  });
});
