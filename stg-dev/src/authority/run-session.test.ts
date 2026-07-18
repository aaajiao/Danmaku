import {describe, expect, it} from "vitest";
import {
  PLAYER_FOCUS_MAX_SPEED_PX_PER_SECOND,
  PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND,
} from "./pattern-executor";
import {
  CanonicalRunSession,
  type CanonicalRunSessionOptions,
  type CanonicalRunSessionSnapshot,
  type CanonicalRunSessionStepInput,
} from "./run-session";

const OPTIONS = Object.freeze({
  seed: 0x1b17c0de,
  grazeRadiusPx: 18,
  projectileDamage: 1,
  projectilePoolClasses: Object.freeze({"bullet.micro.notch_e": "micro" as const}),
});

function neutralInput(tick120: number): CanonicalRunSessionStepInput {
  return {
    tick120,
    movement: {x: 0, y: 0},
    signalActive: false,
    focused: false,
    gaze: {skyEyeVisible: true, pitchDegrees: 0, alignment: 0},
  };
}

function qualifiedGazeInput(tick120: number): CanonicalRunSessionStepInput {
  return {
    ...neutralInput(tick120),
    gaze: {skyEyeVisible: true, pitchDegrees: 60, alignment: 1},
  };
}

/** Two separated signal rising edges satisfy the authored meaningful-input guard. */
function prologueInput(tick120: number): CanonicalRunSessionStepInput {
  return {
    ...neutralInput(tick120),
    signalActive: tick120 === 1 || tick120 === 3,
  };
}

function isDeepFrozen(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value !== "object" || value === null || seen.has(value)) return true;
  seen.add(value);
  if (!Object.isFrozen(value)) return false;
  return Object.values(value).every((entry) => isDeepFrozen(entry, seen));
}

function stepTo(session: CanonicalRunSession, targetTick120: number): CanonicalRunSessionSnapshot {
  let snapshot = session.snapshot();
  for (let tick120 = snapshot.tick120 + 1; tick120 <= targetTick120; tick120 += 1) {
    snapshot = session.step(prologueInput(tick120));
  }
  return snapshot;
}

describe("manifest-backed canonical V4 run session prologue", () => {
  it("coalesces simultaneous movement and signal rises into one device-neutral fact", () => {
    const session = new CanonicalRunSession(OPTIONS);

    const firstContact = session.step({
      ...neutralInput(1),
      movement: {x: 1, y: 0},
      signalActive: true,
    });
    expect(firstContact.player).toMatchObject({
      meaningfulInputCount: 1,
      signalInputCount: 1,
    });
    const held = session.step({
      ...neutralInput(2),
      movement: {x: 1, y: 0},
      signalActive: true,
    });
    expect(held.player).toMatchObject({meaningfulInputCount: 1, signalInputCount: 1});
    session.step(neutralInput(3));
    const secondContact = session.step({
      ...neutralInput(4),
      movement: {x: 1, y: 0},
      signalActive: true,
    });
    expect(secondContact.player).toMatchObject({
      meaningfulInputCount: 2,
      signalInputCount: 2,
    });
  });

  it("exposes the guarded 8-second policy, fresh bootstrap, and initial flower authority event", () => {
    const session = new CanonicalRunSession(OPTIONS);
    const snapshot = session.snapshot();

    expect(snapshot).toMatchObject({
      authority: "canonical-run-session-v4",
      seed: OPTIONS.seed,
      phase: "quiet_awakening",
      tick120: 0,
      segmentTick120: 0,
      player: {
        position: {x: 180, y: 570},
        focused: false,
        inputEnabled: true,
        flower: {
          authority: "v4-flower-intensity",
          authorityId: "player-flower",
          tick120: 0,
          commitCount: 1,
          resolution: {source: "signal", targetIntensity: 0.3},
        },
        meaningfulInputCount: 0,
        signalInputCount: 0,
        damage: null,
      },
      gaze: {
        authority: "v4-gaze",
        authorityId: "gaze",
        tick120: null,
        state: "idle",
        clampActive: false,
        cycle: 0,
        releaseAttempt: 0,
        deadlineTick120: null,
        eventCount: 0,
      },
      combat: null,
      discovery: {signalFallbackVisible: false},
      handoff: {
        state: "not_started",
        ready: false,
        sourcePatternId: "common.eye_acquisition",
        atTick120: null,
        barriers: {
          combatDrained: false,
          gazeClampCommitted: false,
          gazeClampReleased: false,
          flowerRecoveryComplete: false,
        },
        sourceCombat: null,
      },
      adapterPolicy: {
        provenance: "application-policy-within-v4-contract",
        awakeningDurationMs: 8000,
        awakeningManifestRangeMs: [6000, 10000],
        awakeningSelection: "fixed-midpoint-plus-meaningful-input-guard",
        awakeningExitGuard: {
          minimumDurationMs: 6000,
          selectedDurationMs: 8000,
          meaningfulInputCount: 2,
        },
        meaningfulInput: {
          movementRisingThreshold: 0.15,
          signalRisingEdge: true,
          simultaneousMovementAndSignal: "one-aggregate-fact",
          sustainedInputRepeats: false,
          provenance: "application-required-v4-omission",
        },
        signal: {
          mapping: "binary-action-to-intensity",
          inactiveIntensity: 0.3,
          activeIntensity: 0.5,
          fallbackAtMs: 60000,
          fallbackCopyId: "prompt.signal",
          provenance: "application-required-v4-omission",
        },
        pauseInputPolicy: "discard-paused-edges-reconcile-held-at-next-tick",
        wallGapInputPolicy: "hold-last-sample-until-backlog-drained",
        presentation: {
          firstEyeTargetFrame: "eye.reveal",
          firstEyeTargetFact: "first-eye-phase-enter-eye-horizon-appear",
          gazeAcquireReadFrames: "committed-gaze-state-only",
          gazeAcquiringFrame: "eye.acquire",
          gazeClampedFrame: "eye.read",
          playerLifeFrames: "stable-state-representatives-not-clip-phase",
          deadFrame: "player.residue_hold",
          deadReducedMotionFrame: "player.residue_appear",
          respawningFrame: "player.respawn_asymmetric.frame_04",
          respawningReducedMotionFrame: "player.respawn_asymmetric.frame_05",
          runEndedFrame: "player.digital_delete",
          provenance: "application-required-v4-omission",
        },
        freshSessionBootstrap: {
          scope: "fresh-session-without-previous-run-material",
          narrativeStateOrder: [
            "BOOT_REHYDRATE",
            "GHOST_REPLAY",
            "WITNESS_ORIENTATION",
            "AWAKENING",
          ],
          previousMaterial: "absent",
          previousGhostRoute: "absent",
          witnessSources: "absent",
          inputAvailableAtTick120: 0,
          syntheticRestoreEvents: false,
        },
        playerBounds: {minX: 0, maxX: 360, minY: 0, maxY: 640},
        playerSpeedPxPerSecond: {
          normal: PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND,
          focused: PLAYER_FOCUS_MAX_SPEED_PX_PER_SECOND,
        },
        firstEye: {
          patternId: "common.eye_acquisition",
          occurrenceId: "run:first-eye:0",
          roomId: "INFORMATION",
          difficulty: "EASY",
          combatOwnership: "strictly-sequential-shared-run-state",
          tickClosure: "irreversible-exact-next-tick",
          postReleaseTimers: "shared-idle-advance",
          roomDifficultyProvenance: "application-required-v4-omission",
          seedAuthority: "caller-resolved-v4-encounter-seed",
          manifestDurationRangeMs: [7000, 12000],
          authoredPatternDurationMs: 8600,
          exit: "combat-drain+gaze-release+flower-recovery",
          gazeSampleAuthority: "caller-supplied-device-neutral-sample",
          gazeAcquireTicks120: 60,
          gazeReleaseDelayTicks120: 54,
          flowerRecoveryAuthority: "pending-v4-omission",
          overrideAvailability: "withheld-until-local-resistance-authority",
        },
      },
    });
    expect(session.events()).toHaveLength(1);
    expect(session.events()[0]).toMatchObject({
      id: "flower.intensity.commit",
      authority: "gameplay",
      tick120: 0,
      simulationTimeMs: 0,
      entityStableId: "player-flower",
      localSequence: 0,
      sequence: 0,
      occurrenceKey: "player-flower:1",
      payload: {source: "signal", targetIntensity: 0.3},
    });
    expect(isDeepFrozen(snapshot)).toBe(true);
  });

  it("enters first_eye at exact tick 960 after two meaningful edges without resetting position", () => {
    const session = new CanonicalRunSession(OPTIONS);
    let snapshot = session.snapshot();
    for (let tick120 = 1; tick120 <= 960; tick120 += 1) {
      snapshot = session.step({
        tick120,
        movement: tick120 <= 480 ? {x: 0.1, y: 0} : {x: 0, y: -0.1},
        signalActive: tick120 === 1 || tick120 === 3,
        focused: tick120 > 480,
        gaze: {skyEyeVisible: true, pitchDegrees: 0, alignment: 0},
      });
      if (tick120 === 959) {
        expect(snapshot).toMatchObject({phase: "quiet_awakening", segmentTick120: 959});
      }
    }

    expect(snapshot).toMatchObject({
      phase: "first_eye",
      tick120: 960,
      segmentTick120: 0,
      player: {
        focused: false,
        inputEnabled: true,
        meaningfulInputCount: 2,
        signalInputCount: 2,
        flower: {resolution: {source: "signal", targetIntensity: 0.3}},
      },
      combat: {
        patternId: "common.eye_acquisition",
        occurrenceId: "run:first-eye:0",
        startTick120: 960,
        tick120: 960,
        relativeTick120: 0,
      },
      handoff: {state: "awaiting_first_eye_barriers", ready: false},
    });
    expect(snapshot.player.position.x).toBeCloseTo(180 + 188 * 4 * 0.1, 10);
    expect(snapshot.player.position.y).toBeCloseTo(570 - 188 * 4 * 0.1, 10);
    expect(snapshot.combat?.playerPosition).toEqual(snapshot.player.position);
    expect(isDeepFrozen(snapshot)).toBe(true);

    const firstEyeSample = session.step({...neutralInput(961), focused: true});
    expect(firstEyeSample.player).toMatchObject({
      focused: true,
      flower: {resolution: {source: "focus"}},
    });
  });

  it("keeps Focus locked, counts only rising edges, and waits past tick 960 for the guard", () => {
    const session = new CanonicalRunSession(OPTIONS);
    const first = session.step({
      tick120: 1,
      movement: {x: 0.1, y: 0},
      signalActive: false,
      focused: true,
      gaze: {skyEyeVisible: true, pitchDegrees: 0, alignment: 0},
    });
    expect(first.player.position.x).toBeCloseTo(180 + 188 / 120 * 0.1, 10);
    expect(first.player).toMatchObject({
      focused: false,
      meaningfulInputCount: 0,
      flower: {resolution: {source: "signal", targetIntensity: 0.3}},
    });

    let snapshot = first;
    for (let tick120 = 2; tick120 <= 960; tick120 += 1) {
      snapshot = session.step({
        tick120,
        movement: {x: 0.16, y: 0},
        signalActive: false,
        focused: true,
        gaze: {skyEyeVisible: true, pitchDegrees: 0, alignment: 0},
      });
    }
    expect(snapshot).toMatchObject({
      phase: "quiet_awakening",
      tick120: 960,
      player: {focused: false, meaningfulInputCount: 1, signalInputCount: 0},
    });

    snapshot = session.step(neutralInput(961));
    expect(snapshot).toMatchObject({phase: "quiet_awakening", player: {meaningfulInputCount: 1}});
    snapshot = session.step({...neutralInput(962), signalActive: true, focused: true});
    expect(snapshot).toMatchObject({
      phase: "first_eye",
      tick120: 962,
      segmentTick120: 0,
      player: {
        focused: false,
        meaningfulInputCount: 2,
        signalInputCount: 1,
        flower: {resolution: {source: "signal", targetIntensity: 0.5}},
      },
      combat: {startTick120: 962, relativeTick120: 0},
    });
  });

  it("shows the V4 signal fallback at 60 seconds and dismisses it on first signal input", () => {
    const session = new CanonicalRunSession(OPTIONS);
    let snapshot = session.snapshot();
    for (let tick120 = 1; tick120 < 7200; tick120 += 1) {
      snapshot = session.step(neutralInput(tick120));
    }
    expect(snapshot).toMatchObject({
      phase: "quiet_awakening",
      tick120: 7199,
      discovery: {signalFallbackVisible: false},
      player: {meaningfulInputCount: 0, signalInputCount: 0},
    });

    snapshot = session.step(neutralInput(7200));
    expect(snapshot.discovery.signalFallbackVisible).toBe(true);
    snapshot = session.step({...neutralInput(7201), signalActive: true});
    expect(snapshot).toMatchObject({
      phase: "quiet_awakening",
      discovery: {signalFallbackVisible: false},
      player: {
        meaningfulInputCount: 1,
        signalInputCount: 1,
        flower: {resolution: {source: "signal", targetIntensity: 0.5}},
      },
    });
  });

  it("withholds First Eye Override input until local-resistance authority exists", () => {
    const session = new CanonicalRunSession(OPTIONS);
    stepTo(session, 960);

    const pressed = session.step({
      ...neutralInput(961),
      overridePressed: true,
      overrideDirection: {x: 0, y: -1},
    });
    expect(pressed.override).toMatchObject({
      state: "idle",
      cycle: 0,
      deadlineTick120: null,
      localVoid: null,
      scarCount: 0,
    });
    const released = session.step({...neutralInput(962), overrideReleased: true});
    expect(released.override).toMatchObject({state: "idle", cycle: 0});
    stepTo(session, 1100);
    expect(session.events().filter((event) => event.id.startsWith("player.override."))).toEqual([]);
  });

  it("gates movement, Focus, and Flower signal while the retained player is non-alive", () => {
    const session = new CanonicalRunSession({...OPTIONS, seed: 1, projectileDamage: 3});
    stepTo(session, 960);
    let snapshot = session.snapshot();
    while (snapshot.player.damage?.state !== "dead" && snapshot.tick120 < 1900) {
      snapshot = session.step({
        ...neutralInput(snapshot.tick120 + 1),
        movement: {x: -1, y: 0},
      });
    }
    expect(snapshot.player).toMatchObject({
      position: {x: 0, y: 570},
      focused: false,
      inputEnabled: false,
      damage: {state: "dead", health: 0},
    });
    const heldPosition = snapshot.player.position;
    const resumeAtTick120 = snapshot.player.damage?.respawnCompleteAtTick120;
    expect(resumeAtTick120).not.toBeNull();

    const deadInput = session.step({
      ...neutralInput(snapshot.tick120 + 1),
      movement: {x: 1, y: 0},
      signalActive: true,
      focused: true,
    });
    expect(deadInput.player).toMatchObject({
      position: heldPosition,
      focused: false,
      inputEnabled: false,
      flower: {resolution: {source: "signal", targetIntensity: 0.3}},
      damage: {state: "dead"},
    });

    snapshot = deadInput;
    while (snapshot.tick120 < (resumeAtTick120 ?? snapshot.tick120 + 1) - 1) {
      snapshot = session.step({
        ...neutralInput(snapshot.tick120 + 1),
        movement: {x: 1, y: 0},
        signalActive: true,
        focused: true,
      });
    }
    expect(snapshot.player).toMatchObject({
      position: heldPosition,
      focused: false,
      inputEnabled: false,
      damage: {state: "respawning"},
    });

    const resumed = session.step({
      ...neutralInput(resumeAtTick120 as number),
      movement: {x: 1, y: 0},
      signalActive: true,
      focused: true,
    });
    expect(resumed.player).toMatchObject({
      focused: true,
      inputEnabled: true,
      flower: {resolution: {source: "focus", targetIntensity: 0.35}},
      damage: {state: "alive"},
    });
    expect(resumed.player.position.x).toBeCloseTo(
      heldPosition.x + PLAYER_FOCUS_MAX_SPEED_PX_PER_SECOND / 120,
      12,
    );
  });

  it("never rewrites qualified gaze into a release when the player body dies", () => {
    const session = new CanonicalRunSession({...OPTIONS, seed: 1, projectileDamage: 3});
    stepTo(session, 960);
    let snapshot = session.snapshot();
    for (let tick120 = 961; tick120 <= 1021; tick120 += 1) {
      snapshot = session.step(qualifiedGazeInput(tick120));
    }
    expect(snapshot).toMatchObject({
      phase: "first_clamp_recovery",
      gaze: {state: "clamped", clampActive: true},
      handoff: {barriers: {gazeClampCommitted: true, gazeClampReleased: false}},
    });

    while (snapshot.player.damage?.state !== "dead" && snapshot.tick120 < 1900) {
      snapshot = session.step({
        ...qualifiedGazeInput(snapshot.tick120 + 1),
        movement: {x: -1, y: 0},
      });
    }
    expect(snapshot.player.damage?.state).toBe("dead");
    const deathTick120 = snapshot.tick120;
    while (snapshot.tick120 < deathTick120 + 60) {
      snapshot = session.step(qualifiedGazeInput(snapshot.tick120 + 1));
    }

    expect(snapshot).toMatchObject({
      gaze: {
        state: "clamped",
        clampActive: true,
        cycle: 1,
        deadlineTick120: null,
      },
      handoff: {
        ready: false,
        barriers: {gazeClampCommitted: true, gazeClampReleased: false},
      },
    });
    expect(session.events().filter((event) =>
      event.id === "gaze.release.begin" || event.id === "gaze.clamp.release"))
      .toEqual([]);
  });

  it("retains exact source drain facts but cannot bypass the independent gaze barrier", () => {
    const session = new CanonicalRunSession(OPTIONS);
    stepTo(session, 960);

    const atAuthoredPatternEnd = stepTo(session, 960 + 1032);
    expect(atAuthoredPatternEnd).toMatchObject({
      phase: "first_eye",
      combat: {patternComplete: true, projectileLifecycleDrained: false, handoffReady: false},
      gaze: {state: "idle", cycle: 0},
      handoff: {
        state: "awaiting_first_eye_barriers",
        ready: false,
        barriers: {
          combatDrained: false,
          gazeClampCommitted: false,
          gazeClampReleased: false,
          flowerRecoveryComplete: false,
        },
        sourceCombat: null,
      },
    });

    let drained = atAuthoredPatternEnd;
    while (drained.handoff.sourceCombat === null && drained.tick120 < 960 + 1800) {
      drained = session.step(neutralInput(drained.tick120 + 1));
    }
    expect(drained).toMatchObject({
      phase: "first_eye",
      combat: {
        patternComplete: true,
        projectileLifecycleDrained: true,
        handoffReady: true,
      },
      player: {inputEnabled: true},
      gaze: {state: "idle", cycle: 0, eventCount: 0},
      handoff: {
        state: "awaiting_first_eye_barriers",
        ready: false,
        atTick120: null,
        barriers: {
          combatDrained: true,
          gazeClampCommitted: false,
          gazeClampReleased: false,
          flowerRecoveryComplete: false,
        },
        sourceCombat: {
          patternComplete: true,
          projectileLifecycleDrained: true,
          handoffReady: true,
          liveEntities: 0,
          liveColliders: 0,
        },
      },
    });
    expect(drained.handoff.sourceCombat?.tick120).toBe(drained.tick120);
    expect(drained.player.damage).not.toBeNull();
    expect(drained.evidence).not.toBeNull();
    expect(drained.override).toMatchObject({state: "idle", deadlineTick120: null});
    expect(session.events().filter((event) => event.id.startsWith("gaze."))).toEqual([]);

    const releasedInternal = session as unknown as {
      readonly combat: {step(input: unknown): never} | null;
    };
    if (releasedInternal.combat === null) throw new Error("released First Eye fixture lost combat");
    Object.defineProperty(releasedInternal.combat, "step", {
      configurable: true,
      value: () => {
        throw new Error("released occurrence engine must not be stepped");
      },
    });
    const positionBefore = drained.player.position;
    const next = session.step({
      ...neutralInput(drained.tick120 + 1),
      movement: {x: 1, y: 0},
      signalActive: true,
      focused: true,
    });
    expect(next).toMatchObject({
      phase: "first_eye",
      player: {inputEnabled: true},
      handoff: {
        ready: false,
        sourceCombat: drained.handoff.sourceCombat,
      },
    });
    expect(next.player.position.x).toBeGreaterThan(positionBefore.x);
    expect(isDeepFrozen(next)).toBe(true);
  });

  it("derives handoff from current shared timers after the occurrence engine releases", () => {
    const session = new CanonicalRunSession(OPTIONS);
    stepTo(session, 2321);
    const internal = session as unknown as {
      readonly combat: {
        step(input: Readonly<Record<string, unknown>>): unknown;
      } | null;
    };
    if (internal.combat === null) throw new Error("timer continuity fixture lost First Eye combat");
    const originalStep = internal.combat.step.bind(internal.combat);
    // The player-facing fragment withholds this edge. Injecting it at the
    // internal boundary models any future run-owned timer that outlives the
    // final projectile residue without delaying occurrence release.
    Object.defineProperty(internal.combat, "step", {
      configurable: true,
      value: (input: Readonly<Record<string, unknown>>) => originalStep({
        ...input,
        overridePressed: true,
        overrideDirection: {x: 0, y: -1},
      }),
    });

    let snapshot = session.step(neutralInput(2322));
    const timerDeadline = snapshot.override?.deadlineTick120;
    expect(timerDeadline).not.toBeNull();
    expect(snapshot).toMatchObject({
      combat: {
        projectileLifecycleDrained: true,
        runTimedStateQuiescent: false,
        handoffReady: false,
      },
      override: {state: "charging"},
      handoff: {sourceCombat: null, barriers: {combatDrained: false}},
    });

    while (snapshot.tick120 < (timerDeadline as number)) {
      snapshot = session.step(neutralInput(snapshot.tick120 + 1));
    }
    expect(snapshot.combat).toMatchObject({
      tick120: 2322,
      projectileLifecycleDrained: true,
      handoffReady: false,
    });
    expect(snapshot.override).toMatchObject({state: "idle", deadlineTick120: null});
    expect(snapshot.handoff).toMatchObject({
      sourceCombat: {
        tick120: timerDeadline,
        projectileLifecycleDrained: true,
        handoffReady: true,
      },
      barriers: {combatDrained: true},
    });
  });

  it("commits clamp before Flower, releases at exact V4 ticks, and stops at recovery authority", () => {
    const session = new CanonicalRunSession(OPTIONS);
    stepTo(session, 960);

    let snapshot = session.snapshot();
    for (let tick120 = 961; tick120 <= 1021; tick120 += 1) {
      snapshot = session.step(qualifiedGazeInput(tick120));
    }
    expect(snapshot).toMatchObject({
      phase: "first_clamp_recovery",
      tick120: 1021,
      segmentTick120: 0,
      gaze: {
        state: "clamped",
        clampActive: true,
        cycle: 1,
        deadlineTick120: null,
      },
      player: {
        flower: {
          tick120: 1021,
          resolution: {source: "gaze", targetIntensity: 0.1},
        },
      },
      handoff: {
        ready: false,
        barriers: {
          gazeClampCommitted: true,
          gazeClampReleased: false,
          flowerRecoveryComplete: false,
        },
      },
    });
    expect(session.events()
      .filter((event) => event.tick120 === 1021)
      .filter((event) => event.id === "gaze.clamp.commit" || event.id === "flower.intensity.commit")
      .map((event) => event.id))
      .toEqual(["gaze.clamp.commit", "flower.intensity.commit"]);

    for (let tick120 = 1022; tick120 <= 1076; tick120 += 1) {
      snapshot = session.step(neutralInput(tick120));
    }
    expect(snapshot).toMatchObject({
      phase: "first_clamp_recovery",
      tick120: 1076,
      segmentTick120: 55,
      gaze: {
        state: "idle",
        clampActive: false,
        cycle: 1,
        releaseAttempt: 1,
        deadlineTick120: null,
      },
      player: {
        flower: {
          tick120: 1075,
          resolution: {source: "gaze", targetIntensity: 0.1},
        },
      },
      handoff: {
        state: "awaiting_first_eye_barriers",
        ready: false,
        barriers: {
          gazeClampCommitted: true,
          gazeClampReleased: true,
          flowerRecoveryComplete: false,
        },
      },
    });
    expect(session.events().find((event) => event.id === "gaze.clamp.release"))
      .toMatchObject({tick120: 1076});

    while (snapshot.handoff.sourceCombat === null && snapshot.tick120 < 960 + 1800) {
      snapshot = session.step(neutralInput(snapshot.tick120 + 1));
    }
    expect(snapshot).toMatchObject({
      phase: "first_clamp_recovery",
      player: {
        inputEnabled: true,
        flower: {resolution: {source: "gaze", targetIntensity: 0.1}},
      },
      handoff: {
        state: "flower_recovery_authority_pending",
        ready: false,
        atTick120: null,
        barriers: {
          combatDrained: true,
          gazeClampCommitted: true,
          gazeClampReleased: true,
          flowerRecoveryComplete: false,
        },
        sourceCombat: {
          patternComplete: true,
          projectileLifecycleDrained: true,
          handoffReady: true,
          liveEntities: 0,
          liveColliders: 0,
        },
      },
    });
  });

  it("rejects repeated, skipped, accessor-backed, and malformed samples without consuming state", () => {
    const session = new CanonicalRunSession(OPTIONS);
    const initial = session.snapshot();
    let gazeAccessorReads = 0;
    const accessorGaze = Object.defineProperty(
      {pitchDegrees: 60, alignment: 1},
      "skyEyeVisible",
      {
        enumerable: true,
        get() {
          gazeAccessorReads += 1;
          return true;
        },
      },
    );
    const invalidSamples: unknown[] = [
      neutralInput(2),
      {tick120: 1, movement: {x: 0, y: 0}, focused: false},
      {tick120: 1, movement: {x: Number.NaN, y: 0}, signalActive: false, focused: false},
      {tick120: 1, movement: {x: 1, y: 1}, signalActive: false, focused: false},
      {tick120: 1, movement: {x: 0, y: 0}, signalActive: "false", focused: false},
      {tick120: 1, movement: {x: 0, y: 0}, signalActive: false, focused: "false"},
      {
        tick120: 1,
        movement: {x: 0, y: 0},
        signalActive: false,
        focused: false,
        overridePressed: true,
        overrideReleased: true,
        overrideDirection: {x: 0, y: -1},
      },
      {
        tick120: 1,
        movement: {x: 0, y: 0},
        signalActive: false,
        focused: false,
        overridePressed: true,
      },
      {...neutralInput(1), gaze: {skyEyeVisible: true, pitchDegrees: Number.NaN, alignment: 1}},
      {...neutralInput(1), gaze: accessorGaze},
      Object.defineProperty(
        {
          movement: {x: 0, y: 0},
          signalActive: false,
          focused: false,
          gaze: {skyEyeVisible: true, pitchDegrees: 0, alignment: 0},
        },
        "tick120",
        {get: () => 1, enumerable: true},
      ),
    ];
    for (const sample of invalidSamples) {
      expect(() => session.step(sample as CanonicalRunSessionStepInput)).toThrow();
      expect(session.snapshot()).toEqual(initial);
    }
    expect(gazeAccessorReads).toBe(0);

    session.step(neutralInput(1));
    const atOne = session.snapshot();
    expect(() => session.step(neutralInput(1))).toThrow(/one tick at a time/);
    expect(() => session.step(neutralInput(3))).toThrow(/one tick at a time/);
    expect(session.snapshot()).toEqual(atOne);
  });

  it("rejects descriptor-trap reentrancy before one session tick can execute twice", () => {
    const session = new CanonicalRunSession(OPTIONS);
    const before = session.snapshot();
    const eventsBefore = session.canonicalEventSerialization();
    let reentryAttempts = 0;
    const movement = new Proxy({x: 1, y: 0}, {
      getOwnPropertyDescriptor(target, key) {
        if (key === "x" && reentryAttempts === 0) {
          reentryAttempts += 1;
          session.step(neutralInput(1));
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    expect(() => session.step({...neutralInput(1), movement}))
      .toThrow(/step is already in progress/);
    expect(reentryAttempts).toBe(1);
    expect(session.snapshot()).toEqual(before);
    expect(session.canonicalEventSerialization()).toBe(eventsBefore);
    expect(session.step(neutralInput(1)).tick120).toBe(1);
  });

  it("becomes permanently fail-stop after a cross-authority internal failure", () => {
    const session = new CanonicalRunSession(OPTIONS);
    stepTo(session, 960);
    const internal = session as unknown as {
      readonly combat: {step(input: unknown): never} | null;
    };
    if (internal.combat === null) throw new Error("fail-stop fixture lost combat authority");
    Object.defineProperty(internal.combat, "step", {
      configurable: true,
      value: () => {
        throw new Error("injected combat invariant failure");
      },
    });

    expect(() => session.step(qualifiedGazeInput(961)))
      .toThrow(/injected combat invariant failure/);
    expect(() => session.snapshot()).toThrow(/session is faulted/);
    expect(() => session.events()).toThrow(/session is faulted/);
    expect(() => session.canonicalEventSerialization()).toThrow(/session is faulted/);
    expect(() => session.step(neutralInput(961))).toThrow(/session is faulted/);
  });

  it("validates adapter options before the first tick and snapshots a defensive pool mapping", () => {
    expect(() => new CanonicalRunSession({...OPTIONS, seed: -1})).toThrow(/uint32/);
    expect(() => new CanonicalRunSession({...OPTIONS, seed: 0x1_0000_0000})).toThrow(/uint32/);
    expect(() => new CanonicalRunSession({...OPTIONS, grazeRadiusPx: 1})).toThrow(/grazeRadiusPx/);
    expect(() => new CanonicalRunSession({...OPTIONS, projectileDamage: 0})).toThrow(/projectileDamage/);
    expect(() => new CanonicalRunSession({...OPTIONS, projectilePoolClasses: {}}))
      .toThrow(/exact first-eye/);
    expect(() => new CanonicalRunSession({
      ...OPTIONS,
      projectilePoolClasses: {"bullet.micro.notch_e": "invalid"},
    } as unknown as CanonicalRunSessionOptions)).toThrow(/not a V4 pool class/);

    const mutableMapping = {"bullet.micro.notch_e": "micro" as const};
    const session = new CanonicalRunSession({...OPTIONS, projectilePoolClasses: mutableMapping});
    (mutableMapping as {"bullet.micro.notch_e": string})["bullet.micro.notch_e"] = "heavy";
    expect(session.snapshot().adapterPolicy.firstEye.patternId).toBe("common.eye_acquisition");
    expect(stepTo(session, 960).combat?.adapterGaps.projectilePoolClasses).toEqual({
      "bullet.micro.notch_e": "micro",
    });
  });

  it("replays identical seed and sampled input to the same snapshots and canonical event trace", () => {
    const first = new CanonicalRunSession(OPTIONS);
    const second = new CanonicalRunSession(OPTIONS);
    const firstTrace: string[] = [];
    const secondTrace: string[] = [];
    for (let tick120 = 1; tick120 <= 1500; tick120 += 1) {
      const input: CanonicalRunSessionStepInput = {
        tick120,
        movement: {
          x: tick120 % 180 < 90 ? 0.2 : -0.2,
          y: tick120 % 240 < 120 ? -0.1 : 0.1,
        },
        signalActive: tick120 % 240 < 60,
        focused: tick120 % 300 < 100,
        gaze: {
          skyEyeVisible: tick120 >= 960,
          pitchDegrees: tick120 % 360 < 120 ? 60 : 0,
          alignment: tick120 % 480 < 180 ? 1 : 0,
        },
      };
      firstTrace.push(JSON.stringify(first.step(input)));
      secondTrace.push(JSON.stringify(second.step(input)));
    }
    expect(secondTrace).toEqual(firstTrace);
    expect(second.snapshot()).toEqual(first.snapshot());
    expect(second.canonicalEventSerialization()).toBe(first.canonicalEventSerialization());
  });
});
