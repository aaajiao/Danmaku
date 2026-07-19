import {describe, expect, it} from "vitest";
import patternsManifest from "../../../1bit-stg-complete-asset-kit-v4/manifests/gameplay/executable-patterns-v4.json";
import type {PatternDefinition} from "./types";
import {
  canonicalDirectionToView,
  canonicalPositionToView,
  projectPresentationRunFacts,
  projectPresentationSnapshot,
  projectileCausalitySelection,
  projectileVisualLifecycle,
  PROJECTILE_AUTHORITY_LIFECYCLE_STATES,
  PROJECTILE_VISUAL_LIFECYCLE_BY_AUTHORITY_STATE,
  type PresentationProjectileSnapshot,
  type PresentationSourceSnapshot,
  type ProjectileAuthorityLifecycleState,
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

  it("collapses all seven authority lifecycle states totally and explicitly", () => {
    // The authored universe, minus `pooled` which owns no gameplay snapshot.
    expect([...PROJECTILE_AUTHORITY_LIFECYCLE_STATES]).toEqual([
      "spawn",
      "arm",
      "flight",
      "impact",
      "cancel",
      "residue",
      "cleanup",
    ]);
    // Totality: every authority state has an explicit visual state, no `else`.
    expect(Object.keys(PROJECTILE_VISUAL_LIFECYCLE_BY_AUTHORITY_STATE).sort())
      .toEqual([...PROJECTILE_AUTHORITY_LIFECYCLE_STATES].sort());
    expect(PROJECTILE_VISUAL_LIFECYCLE_BY_AUTHORITY_STATE).toEqual({
      spawn: "arm",
      arm: "arm",
      flight: "flight",
      impact: "residue",
      cancel: "residue",
      residue: "residue",
      cleanup: "residue",
    });
    for (const state of PROJECTILE_AUTHORITY_LIFECYCLE_STATES) {
      const collisionEnabled = state === "flight";
      expect(projectileVisualLifecycle(state, collisionEnabled))
        .toBe(PROJECTILE_VISUAL_LIFECYCLE_BY_AUTHORITY_STATE[state]);
    }
  });

  it("projects the uncollapsed authority state and terminal cause alongside the visual one", () => {
    const source = sourceFixture({
      projectiles: PROJECTILE_AUTHORITY_LIFECYCLE_STATES.map((state, index) =>
        projectileFixture({
          instanceId: `projectile-${index}`,
          state,
          collisionEnabled: state === "flight",
          terminalCause: state === "impact"
            ? "impact"
            : state === "cancel" || state === "residue" || state === "cleanup"
              ? "cancel"
              : null,
        })),
    });
    const projected = projectPresentationSnapshot(source, FIRST_EYE);
    expect(projected.bullets.map((bullet) => bullet.authorityLifecycleState))
      .toEqual(["spawn", "arm", "flight", "impact", "cancel", "residue", "cleanup"]);
    expect(projected.bullets.map((bullet) => bullet.lifecycleState))
      .toEqual(["arm", "arm", "flight", "residue", "residue", "residue", "residue"]);
    // The collapse loses stage, never the collision fact or the terminal cause.
    expect(projected.bullets.map((bullet) => bullet.collisionEnabled))
      .toEqual([false, false, true, false, false, false, false]);
    expect(projected.bullets.map((bullet) => bullet.terminalCause))
      .toEqual([null, null, null, "impact", "cancel", "cancel", "cancel"]);
  });

  it("fails closed when a non-flight state claims collision authority", () => {
    for (const state of PROJECTILE_AUTHORITY_LIFECYCLE_STATES) {
      if (state === "flight") continue;
      expect(() => projectileVisualLifecycle(state, true))
        .toThrow(/cannot own collision/);
      expect(() => projectPresentationSnapshot(
        sourceFixture({projectiles: [projectileFixture({state, collisionEnabled: true})]}),
        FIRST_EYE,
      )).toThrow(/cannot own collision/);
    }
    const unknown = "settling" as ProjectileAuthorityLifecycleState;
    expect(() => projectileVisualLifecycle(unknown, false)).toThrow(/unknown canonical/);
    expect(() => projectileVisualLifecycle(
      "flight",
      undefined as unknown as boolean,
    )).toThrow(/explicit collision fact/);
  });

  it("selects the EXT-026 causality binding from lifecycle plus collision alone", () => {
    // arm binding: the body exists, collision has not arrived yet.
    for (const state of ["spawn", "arm"] as const) {
      expect(projectileCausalitySelection({state, collisionEnabled: false}))
        .toEqual({binding: "arm", variant: "full"});
    }
    // live binding: collision authority has been taken.
    expect(projectileCausalitySelection({state: "flight", collisionEnabled: true}))
      .toEqual({binding: "live", variant: "full"});
    // flight without collision keeps its own archetype — the collision-off fact
    // must stay visible rather than being hidden behind the armed cue.
    expect(projectileCausalitySelection({state: "flight", collisionEnabled: false})).toBeNull();
    // Every terminal state withdraws the cue immediately, no animation tail.
    for (const state of ["impact", "cancel", "residue", "cleanup"] as const) {
      expect(projectileCausalitySelection({state, collisionEnabled: false})).toBeNull();
    }
  });

  it("uses the authored steady fallback under reduced motion, never a substitute", () => {
    expect(projectileCausalitySelection({state: "arm", collisionEnabled: false}, true))
      .toEqual({binding: "arm", variant: "reduced-motion"});
    // The live binding authors no reduced-motion variant; silence stays authored.
    expect(projectileCausalitySelection({state: "flight", collisionEnabled: true}, true))
      .toEqual({binding: "live", variant: "full"});
    // Reduced motion may change `variant` and nothing else: not which binding
    // applies, not whether a cue exists at all.
    for (const state of PROJECTILE_AUTHORITY_LIFECYCLE_STATES) {
      const collisionEnabled = state === "flight";
      const full = projectileCausalitySelection({state, collisionEnabled}, false);
      const reduced = projectileCausalitySelection({state, collisionEnabled}, true);
      expect(reduced === null).toBe(full === null);
      expect(reduced?.binding).toBe(full?.binding);
    }
  });

  it("keeps the gameplay-facing projection identical under any accessibility mode", () => {
    // Structural proof: reduced motion is not an input to the snapshot
    // projection at all, so the projected gameplay trace cannot vary with it.
    const source = sourceFixture({
      projectiles: PROJECTILE_AUTHORITY_LIFECYCLE_STATES.map((state, index) =>
        projectileFixture({
          instanceId: `projectile-${index}`,
          state,
          collisionEnabled: state === "flight",
        })),
    });
    const gameplayFacing = (snapshot: ReturnType<typeof projectPresentationSnapshot>) =>
      snapshot.bullets.map((bullet) => ({
        id: bullet.id,
        authorityLifecycleState: bullet.authorityLifecycleState,
        lifecycleState: bullet.lifecycleState,
        collisionEnabled: bullet.collisionEnabled,
        position: bullet.position,
        radius: bullet.radius,
      }));
    expect(gameplayFacing(projectPresentationSnapshot(source, FIRST_EYE)))
      .toEqual(gameplayFacing(projectPresentationSnapshot(source, FIRST_EYE)));
    expect(projectPresentationSnapshot.length).toBe(2);
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

const RUN_SOURCE_FACTS = {
  authority: "run-conductor",
  runId: "run-0001",
  runPhase: "ROOM_TRAVERSAL",
  runComplete: false,
  runEndReason: null,
  inputPolicy: "full",
  visitedRooms: ["INFORMATION", "FORCED_ALIGNMENT"],
  weather: {
    authority: "weather-presentation",
    phase: "omen",
    classId: "weather.eclipse",
    biasView: {INFORMATION: {drift: 0.12}},
    residues: [{
      weather: "weather.eclipse",
      residue: "routeAsh",
      cycle: 2,
      tick120: 900,
      persistence: "room-local",
    }],
    witnessFacePlayerException: false,
  },
  hud: {
    inputPolicy: "full",
    inputReturned: true,
    flowerIntensity: 0.42,
    evidenceAvailable: 3,
    gazeTotalMs: 1_250,
    flowerForcedDimCount: 1,
    overrideEligible: true,
    overrideActive: false,
    distinctRoomsVisited: 2,
    runElapsedMs: 8_666,
  },
  observations: [{
    id: "observation.gaze_duration",
    category: "reading",
    zhCN: "你注视了很久。",
    en: "You looked for a long time.",
    trace: [{path: "metrics.gazeTotalMs", value: 1_250}],
  }],
  restoreTimeline: [
    {phase: "material", tick120: 0},
    {phase: "witness", tick120: 240},
  ],
  restoreProgress: [{phase: "material", tick120: 0}],
  entryOmens: [{
    tick120: 720,
    roomId: "FORCED_ALIGNMENT",
    event: "room.threshold.omen",
    distancePx: 48,
    audioLeadTicks120: 30,
    transitionRequestTick120: 750,
  }],
} as const satisfies Partial<PresentationSourceSnapshot>;

function conductorSourceFixture(
  overrides: Partial<PresentationSourceSnapshot> = {},
): PresentationSourceSnapshot {
  return sourceFixture({...RUN_SOURCE_FACTS, ...overrides});
}

describe("run conductor fact projection", () => {
  it("projects no run block for a source that claims no run authority", () => {
    const projected = projectPresentationSnapshot(sourceFixture(), FIRST_EYE);
    expect("run" in projected).toBe(false);
    expect(projectPresentationRunFacts(sourceFixture())).toBeNull();
  });

  it("projects the run, room, weather, hud, observation and restore facts", () => {
    const projected = projectPresentationSnapshot(
      conductorSourceFixture({roomId: "FORCED_ALIGNMENT"}),
      FIRST_EYE,
    );
    const run = projected.run!;
    expect(run.authority).toBe("run-conductor");
    expect(run.runId).toBe("run-0001");
    expect(run.runPhase).toBe("ROOM_TRAVERSAL");
    expect(run.runComplete).toBe(false);
    expect(run.runEndReason).toBeNull();
    // The room id is resolved by the authority; presentation never slugifies.
    expect(run.roomId).toBe("FORCED_ALIGNMENT");
    expect(projected.room).toBe("FORCED_ALIGNMENT");
    expect(run.visitedRooms).toEqual(["INFORMATION", "FORCED_ALIGNMENT"]);
    expect(run.weather.authority).toBe("weather-presentation");
    expect(run.weather.phase).toBe("omen");
    expect(run.weather.classId).toBe("weather.eclipse");
    expect(run.weather.biasView).toEqual({INFORMATION: {drift: 0.12}});
    expect(run.weather.residues[0]!.residue).toBe("routeAsh");
    expect(run.hud.flowerIntensity).toBeCloseTo(0.42, 10);
    expect(run.hud.evidenceAvailable).toBe(3);
    expect(run.hud.distinctRoomsVisited).toBe(2);
    expect(run.hud.inputPolicy).toBe("full");
    expect(run.observations).toHaveLength(1);
    expect(run.observations[0]!.zhCN).toBe("你注视了很久。");
    expect(run.observations[0]!.trace[0]).toEqual({path: "metrics.gazeTotalMs", value: 1_250});
    expect(run.restoreTimeline.map((step) => step.phase)).toEqual(["material", "witness"]);
    expect(run.restoreProgress).toEqual([{phase: "material", tick120: 0}]);
    expect(run.entryOmens[0]).toEqual({
      tick120: 720,
      roomId: "FORCED_ALIGNMENT",
      event: "room.threshold.omen",
      distancePx: 48,
      audioLeadTicks120: 30,
      transitionRequestTick120: 750,
    });
  });

  it("freezes every projected run fact", () => {
    const run = projectPresentationSnapshot(conductorSourceFixture(), FIRST_EYE).run!;
    expect(Object.isFrozen(run)).toBe(true);
    expect(Object.isFrozen(run.hud)).toBe(true);
    expect(Object.isFrozen(run.weather)).toBe(true);
    expect(Object.isFrozen(run.weather.biasView)).toBe(true);
    expect(Object.isFrozen(run.weather.residues)).toBe(true);
    expect(Object.isFrozen(run.observations)).toBe(true);
    expect(Object.isFrozen(run.observations[0]!)).toBe(true);
    expect(Object.isFrozen(run.observations[0]!.trace)).toBe(true);
    expect(Object.isFrozen(run.restoreTimeline)).toBe(true);
    expect(Object.isFrozen(run.restoreProgress)).toBe(true);
    expect(Object.isFrozen(run.entryOmens)).toBe(true);
    expect(Object.isFrozen(run.visitedRooms)).toBe(true);
  });

  it("carries the threshold target into the run block only while one is owned", () => {
    const idle = projectPresentationSnapshot(conductorSourceFixture(), FIRST_EYE);
    expect(idle.run!.roomThresholdTargetRoom).toBeNull();

    const transitioning = projectPresentationSnapshot(
      conductorSourceFixture({roomThresholdTargetRoom: "POLARIZED"}),
      FIRST_EYE,
    );
    expect(transitioning.run!.roomThresholdTargetRoom).toBe("POLARIZED");
    expect(transitioning.roomThresholdTargetRoom).toBe("POLARIZED");
  });

  it("projects a completed run as observation and handoff, never a judgment", () => {
    const run = projectPresentationSnapshot(
      conductorSourceFixture({runComplete: true, runEndReason: "PROTOCOL_WITHDRAWAL"}),
      FIRST_EYE,
    ).run!;
    expect(run.runComplete).toBe(true);
    expect(run.runEndReason).toBe("PROTOCOL_WITHDRAWAL");
    const serialized = JSON.stringify(run).toLowerCase();
    for (const banned of ["score", "rank", "grade", "leaderboard", "victory", "defeat", "good_end", "bad_end"]) {
      expect(serialized).not.toContain(banned);
    }
  });

  it("fails closed on a drifted run authority", () => {
    expect(() => projectPresentationRunFacts(conductorSourceFixture({
      authority: "presentation-owned" as unknown as "run-conductor",
    }))).toThrow(/run authority drifted/);
  });

  it("fails closed on a partially declared run rather than defaulting it", () => {
    const missing: readonly (keyof typeof RUN_SOURCE_FACTS)[] = [
      "runId",
      "runPhase",
      "runComplete",
      "runEndReason",
      "visitedRooms",
      "weather",
      "hud",
      "observations",
      "restoreTimeline",
      "restoreProgress",
      "entryOmens",
    ];
    for (const key of missing) {
      const source = conductorSourceFixture({[key]: undefined} as Partial<PresentationSourceSnapshot>);
      expect(() => projectPresentationRunFacts(source))
        .toThrow(new RegExp(`missing ${key}`));
    }
  });

  it("fails closed on non-finite and mistyped run facts", () => {
    expect(() => projectPresentationRunFacts(conductorSourceFixture({
      hud: {...RUN_SOURCE_FACTS.hud, flowerIntensity: Number.NaN},
    }))).toThrow(/hud.flowerIntensity must be a finite number/);
    expect(() => projectPresentationRunFacts(conductorSourceFixture({
      hud: {...RUN_SOURCE_FACTS.hud, runElapsedMs: Number.POSITIVE_INFINITY},
    }))).toThrow(/hud.runElapsedMs must be a finite number/);
    expect(() => projectPresentationRunFacts(conductorSourceFixture({
      hud: {...RUN_SOURCE_FACTS.hud, overrideActive: 1 as unknown as boolean},
    }))).toThrow(/hud.overrideActive must be a boolean/);
    expect(() => projectPresentationRunFacts(conductorSourceFixture({
      runId: "",
    }))).toThrow(/runId must be a non-empty string/);
    expect(() => projectPresentationRunFacts(conductorSourceFixture({
      weather: {
        ...RUN_SOURCE_FACTS.weather,
        authority: "gameplay" as unknown as "weather-presentation",
      },
    }))).toThrow(/weather must stay presentation-only/);
    expect(() => projectPresentationRunFacts(conductorSourceFixture({
      weather: {...RUN_SOURCE_FACTS.weather, biasView: {INFORMATION: {drift: Number.NaN}}},
    }))).toThrow(/weather.biasView.INFORMATION.drift must be a finite number/);
  });
});
