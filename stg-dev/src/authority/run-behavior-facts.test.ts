import {describe, expect, it, vi} from "vitest";

import {CanonicalEventBus} from "./events";
import {
  CanonicalRunBehaviorFactLedger,
  type CanonicalRunBehaviorAcceptedTick,
  type CanonicalRunBehaviorCountEntry,
} from "./run-behavior-facts";
import {PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND} from "./pattern-executor";
import {
  CanonicalRunSession,
  type CanonicalRunSessionSnapshot,
  type CanonicalRunSessionStepInput,
} from "./run-session";

const OPTIONS = Object.freeze({
  rawRunSeed: Object.freeze({domain: "raw-run-seed" as const, value: 0x1b17c0de}),
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

function prologueInput(tick120: number): CanonicalRunSessionStepInput {
  return {...neutralInput(tick120), signalActive: tick120 === 1 || tick120 === 3};
}

function stepTo(session: CanonicalRunSession, targetTick120: number): CanonicalRunSessionSnapshot {
  let snapshot = session.snapshot();
  while (snapshot.tick120 < targetTick120) {
    snapshot = session.step(prologueInput(snapshot.tick120 + 1));
  }
  return snapshot;
}

function ticks(entries: readonly CanonicalRunBehaviorCountEntry[], id: string): number {
  return entries.find((entry) => entry.id === id)?.ticks120 ?? 0;
}

function acceptedLedgerTick(
  tick120: number,
  sourceEventCount: number,
): CanonicalRunBehaviorAcceptedTick {
  return {
    ownerPhase: "quiet_awakening",
    requested: {
      tick120,
      movement: {x: 0, y: 0},
      signalActive: false,
      focused: false,
      gaze: {skyEyeVisible: false, pitchDegrees: 0, alignment: 0},
      overridePressed: false,
      overrideReleased: false,
      overrideDirection: null,
    },
    committed: {
      player: {
        position: {x: 180, y: 570},
        inputEnabled: true,
        focused: false,
        lifeState: null,
      },
      flower: {
        authority: "v4-flower-intensity",
        authorityId: "atomicity-fixture",
        tick120,
        commitCount: tick120,
        resolution: {source: "signal", targetIntensity: 0.3},
      },
      gaze: {
        authority: "v4-gaze",
        authorityId: "atomicity-fixture",
        tick120: null,
        state: "idle",
        clampActive: false,
        cycle: 0,
        releaseAttempt: 0,
        deadlineTick120: null,
        eventCount: 0,
      },
      override: null,
      roomId: null,
      runCombatAvailable: false,
      activeOccurrenceId: null,
      canonicalEvents: [],
      sourceEventCount,
    },
  };
}

function rollingInput(tick120: number): CanonicalRunSessionStepInput {
  return {
    tick120,
    movement: {x: tick120 % 12 < 6 ? 0.25 : -0.25, y: 0},
    signalActive: tick120 % 20 < 5,
    focused: tick120 % 16 < 8,
    gaze: {
      skyEyeVisible: tick120 % 24 < 12,
      pitchDegrees: tick120 % 24 < 12 ? 60 : 0,
      alignment: tick120 % 24 < 12 ? 1 : 0,
    },
  };
}

function arrayCardinalities(
  value: unknown,
  path = "$",
  result: string[] = [],
): readonly string[] {
  if (Array.isArray(value)) {
    result.push(`${path}:${value.length}`);
    for (const entry of value) arrayCardinalities(entry, `${path}[]`, result);
    return result;
  }
  if (typeof value !== "object" || value === null) return result;
  for (const key of Object.keys(value).sort()) {
    arrayCardinalities((value as Record<string, unknown>)[key], `${path}.${key}`, result);
  }
  return result;
}

function isDeepFrozen(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value !== "object" || value === null || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value) && Object.values(value).every((entry) => isDeepFrozen(entry, seen));
}

describe("EXT-2026-006 canonical Run rolling behavior facts", () => {
  it("excludes the constructor baseline and exposes no metric or selection authority", () => {
    const session = new CanonicalRunSession(OPTIONS);
    const facts = session.snapshot().behaviorFacts;

    expect(facts).toMatchObject({
      authority: "canonical-run-behavior-facts-v1",
      schemaVersion: "1.0.0-ext-2026-006",
      producerId: "canonical-run-session.accepted-tick-observer",
      producerVersion: "1.0.0",
      extensionPolicy: "EXT-2026-006",
      rawRunSeed: OPTIONS.rawRunSeed,
      tick120: 0,
      acceptedTickCount: 0,
      sampling: {
        tickZeroExcluded: true,
        firstAcceptedTick120: null,
        lastAcceptedTick120: null,
        ownerPhaseTickCounts: [],
      },
      requested: {availability: "missing", reason: "no-accepted-tick"},
      committed: {
        player: {availability: "missing", reason: "no-accepted-tick"},
        flower: {availability: "missing", reason: "no-accepted-tick"},
        gaze: {availability: "missing", reason: "authority-not-consumed-yet"},
        override: {availability: "missing", reason: "authority-not-consumed-yet"},
      },
      context: {
        room: {availability: "missing", reason: "room-context-not-consumed-yet"},
        runCombat: {availability: "missing", reason: "run-combat-context-not-consumed-yet"},
      },
      canonicalEvents: {
        tickZeroBaselineCount: 1,
        observedCount: 0,
        lastObservedSequence: null,
        countsById: [],
      },
      composerAvailability: {
        status: "withheld-metric-projection-policy-not-authored",
        ready: false,
        selectionAllowed: false,
      },
      adapterPolicy: {
        storage: "bounded-rolling-aggregates-no-per-tick-history",
        canonicalEventWrites: 0,
        metricProjection: false,
      },
    });
    expect(facts.composerAvailability.unresolvedMetricIds).toHaveLength(14);
    expect(facts.composerAvailability.unresolvedMetricIds).toContain("avgFlower");
    expect(facts.composerAvailability.unresolvedMetricIds).toContain("noDuskTicks");
    expect("metrics" in facts).toBe(false);
    expect(isDeepFrozen(facts)).toBe(true);
  });

  it("separates accepted requests from committed authority and is mutation-atomic on rejection", () => {
    const session = new CanonicalRunSession(OPTIONS);
    const snapshot = session.step({
      tick120: 1,
      movement: {x: 0.6, y: 0.8},
      signalActive: true,
      focused: true,
      gaze: {skyEyeVisible: true, pitchDegrees: 60, alignment: 1},
      overridePressed: true,
      overrideDirection: {x: 0, y: -1},
    });
    const facts = snapshot.behaviorFacts;

    expect(facts.acceptedTickCount).toBe(1);
    expect(ticks(facts.sampling.ownerPhaseTickCounts, "quiet_awakening")).toBe(1);
    expect(facts.requested).toMatchObject({
      availability: "available",
      firstAvailableTick120: 1,
      lastAvailableTick120: 1,
      sampleCount: 1,
      aggregate: {
        movementNonZeroTickCount: 1,
        movementXSum: 0.6,
        movementYSum: 0.8,
        movementMagnitudeSum: 1,
        signalActiveTickCount: 1,
        signalRisingEdgeCount: 1,
        focusRequestedTickCount: 1,
        gazeVisibleTickCount: 1,
        gazePitchDegreesMin: 60,
        gazePitchDegreesMax: 60,
        gazeAlignmentSum: 1,
        gazeQualifiedInputTickCount: 1,
        overridePressedEdgeCount: 1,
        overrideReleasedEdgeCount: 0,
        overrideDirectionRequestCount: 1,
      },
    });
    expect(facts.committed.player).toMatchObject({
      availability: "available",
      sampleCount: 1,
      aggregate: {
        inputEnabledTickCount: 1,
        focusedTickCount: 0,
        lifeStateObservedTickCount: 0,
        lifeStateTickCounts: [],
      },
    });
    if (facts.committed.player.availability !== "available") throw new Error("player facts missing");
    expect(facts.committed.player.aggregate.positionXSum).toBeCloseTo(
      180 + 0.6 * PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND / 120,
      8,
    );
    expect(facts.committed.player.aggregate.positionYSum).toBeCloseTo(
      570 + 0.8 * PLAYER_NORMAL_MAX_SPEED_PX_PER_SECOND / 120,
      8,
    );
    expect(facts.committed.flower).toMatchObject({
      availability: "available",
      sampleCount: 1,
      aggregate: {
        targetIntensitySum: 0.5,
        sourceTickCounts: [{id: "signal", ticks120: 1}],
      },
    });
    expect(facts.committed.gaze.availability).toBe("missing");
    expect(facts.committed.override.availability).toBe("missing");
    expect(facts.context.room.availability).toBe("missing");
    expect(facts.context.runCombat.availability).toBe("missing");
    expect(facts.canonicalEvents).toMatchObject({
      tickZeroBaselineCount: 1,
      observedCount: 1,
      lastObservedSequence: 1,
      countsById: [{id: "flower.intensity.commit", count: 1}],
    });

    const beforeRejected = session.snapshot();
    const behaviorBeforeRejected = session.behaviorFactSerialization();
    const eventsBeforeRejected = session.canonicalEventSerialization();
    expect(() => session.step(neutralInput(3))).toThrow(/one tick at a time/);
    expect(session.snapshot()).toEqual(beforeRejected);
    expect(session.behaviorFactSerialization()).toBe(behaviorBeforeRejected);
    expect(session.canonicalEventSerialization()).toBe(eventsBeforeRejected);
    expect(isDeepFrozen(session.snapshot().behaviorFacts)).toBe(true);
  });

  it("replaces ledger state only after a late event-cursor invariant passes", () => {
    const ledger = new CanonicalRunBehaviorFactLedger({
      rawRunSeed: OPTIONS.rawRunSeed,
      baselineEvents: [],
    });
    ledger.recordAcceptedTick(acceptedLedgerTick(1, 0));
    const beforeLateFailure = ledger.canonicalSerialization();

    expect(() => ledger.recordAcceptedTick(acceptedLedgerTick(2, 1)))
      .toThrow(/event cursor diverged/);
    expect(ledger.canonicalSerialization()).toBe(beforeLateFailure);

    ledger.recordAcceptedTick(acceptedLedgerTick(2, 0));
    expect(ledger.snapshot()).toMatchObject({tick120: 2, acceptedTickCount: 2});
  });

  it("attributes transition ticks to the pre-step owner and withholds room context through H", () => {
    const session = new CanonicalRunSession(OPTIONS);
    let snapshot = stepTo(session, 960);
    expect(snapshot.phase).toBe("first_eye");
    expect(snapshot.behaviorFacts.acceptedTickCount).toBe(960);
    expect(ticks(snapshot.behaviorFacts.sampling.ownerPhaseTickCounts, "quiet_awakening")).toBe(960);
    expect(ticks(snapshot.behaviorFacts.sampling.ownerPhaseTickCounts, "first_eye")).toBe(0);
    expect(snapshot.behaviorFacts.committed.gaze.availability).toBe("missing");
    expect(snapshot.behaviorFacts.committed.override.availability).toBe("missing");
    expect(snapshot.behaviorFacts.context.runCombat.availability).toBe("missing");

    snapshot = session.step({
      ...qualifiedGazeInput(961),
      overridePressed: true,
      overrideDirection: {x: 0, y: -1},
    });
    expect(ticks(snapshot.behaviorFacts.sampling.ownerPhaseTickCounts, "first_eye")).toBe(1);
    expect(snapshot.behaviorFacts.requested).toMatchObject({
      availability: "available",
      aggregate: {
        overridePressedEdgeCount: 1,
        overrideDirectionRequestCount: 1,
      },
    });
    expect(snapshot.behaviorFacts.committed.gaze).toMatchObject({
      availability: "available",
      firstAvailableTick120: 961,
      sampleCount: 1,
      aggregate: {stateTickCounts: [{id: "acquiring", ticks120: 1}]},
    });
    expect(snapshot.behaviorFacts.committed.override).toMatchObject({
      availability: "available",
      firstAvailableTick120: 961,
      sampleCount: 1,
      aggregate: {stateTickCounts: [{id: "idle", ticks120: 1}]},
    });
    expect(snapshot.behaviorFacts.canonicalEvents.countsById)
      .not.toContainEqual(expect.objectContaining({id: "player.override.commit"}));
    expect(snapshot.behaviorFacts.context.runCombat).toMatchObject({
      availability: "available",
      firstAvailableTick120: 961,
      sampleCount: 1,
      aggregate: {
        noActiveOccurrenceTickCount: 0,
        activeOccurrenceTickCounts: [{id: "run:first-eye:0", ticks120: 1}],
      },
    });

    while (snapshot.tick120 < 1021) {
      snapshot = session.step(qualifiedGazeInput(snapshot.tick120 + 1));
    }
    let beforeH = snapshot;
    while (snapshot.phase !== "room_sampling" && snapshot.tick120 < 3360) {
      beforeH = snapshot;
      snapshot = session.step(neutralInput(snapshot.tick120 + 1));
    }
    expect(snapshot.phase).toBe("room_sampling");
    expect(beforeH.phase).toBe("first_clamp_recovery");
    const handoffTick120 = snapshot.handoff.atTick120;
    if (handoffTick120 === null) throw new Error("behavior facts fixture lost H");
    expect(handoffTick120).toBe(snapshot.tick120);
    const ownerAtH = beforeH.phase;
    expect(ticks(
      snapshot.behaviorFacts.sampling.ownerPhaseTickCounts,
      ownerAtH,
    )).toBe(ticks(beforeH.behaviorFacts.sampling.ownerPhaseTickCounts, ownerAtH) + 1);
    expect(ticks(snapshot.behaviorFacts.sampling.ownerPhaseTickCounts, "room_sampling")).toBe(0);
    expect(snapshot.behaviorFacts.context.room.availability).toBe("missing");

    const events = session.events();
    const baselineCount = snapshot.behaviorFacts.canonicalEvents.tickZeroBaselineCount;
    const observedEvents = events.slice(baselineCount);
    const observedCounts = new Map<string, number>();
    for (const event of observedEvents) {
      observedCounts.set(event.id, (observedCounts.get(event.id) ?? 0) + 1);
    }
    expect(snapshot.behaviorFacts.canonicalEvents.observedCount).toBe(observedEvents.length);
    expect(snapshot.behaviorFacts.canonicalEvents.lastObservedSequence)
      .toBe(observedEvents.at(-1)?.sequence ?? null);
    expect(snapshot.behaviorFacts.canonicalEvents.countsById).toEqual(
      [...observedCounts]
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([id, count]) => ({id, count})),
    );

    snapshot = session.step(neutralInput(handoffTick120 + 1));
    expect(ticks(snapshot.behaviorFacts.sampling.ownerPhaseTickCounts, "room_sampling")).toBe(1);
    expect(snapshot.behaviorFacts.context.room).toMatchObject({
      availability: "available",
      firstAvailableTick120: handoffTick120 + 1,
      lastAvailableTick120: handoffTick120 + 1,
      sampleCount: 1,
      aggregate: {roomTickCounts: [{id: "FORCED_ALIGNMENT", ticks120: 1}]},
    });
    if (snapshot.behaviorFacts.context.runCombat.availability !== "available") {
      throw new Error("run combat facts missing after H+1");
    }
    expect(ticks(
      snapshot.behaviorFacts.context.runCombat.aggregate.activeOccurrenceTickCounts,
      "room:0:encounter:0:room.forced.left_right_gate",
    )).toBe(0);

    while (snapshot.tick120 < handoffTick120 + 159) {
      snapshot = session.step(neutralInput(snapshot.tick120 + 1));
    }
    if (snapshot.behaviorFacts.context.runCombat.availability !== "available") {
      throw new Error("run combat facts missing at READ");
    }
    expect(ticks(
      snapshot.behaviorFacts.context.runCombat.aggregate.activeOccurrenceTickCounts,
      "room:0:encounter:0:room.forced.left_right_gate",
    )).toBe(1);
  });

  it("replays the same accepted inputs to the same bounded fact serialization", () => {
    const first = new CanonicalRunSession(OPTIONS);
    const second = new CanonicalRunSession(OPTIONS);
    for (let tick120 = 1; tick120 <= 180; tick120 += 1) {
      const input = rollingInput(tick120);
      first.step(input);
      second.step(input);
    }
    expect(second.behaviorFactSerialization()).toBe(first.behaviorFactSerialization());
    expect(second.snapshot().behaviorFacts).toEqual(first.snapshot().behaviorFacts);
    const cardinalitiesAt180 = arrayCardinalities(first.snapshot().behaviorFacts);
    for (let tick120 = 181; tick120 <= 900; tick120 += 1) first.step(rollingInput(tick120));
    expect(arrayCardinalities(first.snapshot().behaviorFacts)).toEqual(cardinalitiesAt180);
  });

  it("reads only the committed event delta while stepping", () => {
    const fullHistoryRead = vi.spyOn(CanonicalEventBus.prototype, "events");
    try {
      const session = new CanonicalRunSession(OPTIONS);
      for (let tick120 = 1; tick120 <= 32; tick120 += 1) session.step(prologueInput(tick120));
      session.snapshot();
      session.behaviorFactSerialization();
      expect(fullHistoryRead).not.toHaveBeenCalled();

      expect(session.events().length).toBeGreaterThan(0);
      expect(fullHistoryRead).toHaveBeenCalledTimes(1);
    } finally {
      fullHistoryRead.mockRestore();
    }
  });

  it("cannot fault gameplay when a valid finite gaze pitch exceeds summation range", () => {
    const session = new CanonicalRunSession(OPTIONS);
    for (const tick120 of [1, 2]) {
      session.step({
        ...neutralInput(tick120),
        gaze: {skyEyeVisible: true, pitchDegrees: Number.MAX_VALUE, alignment: 1},
      });
    }
    const snapshot = session.snapshot();
    expect(snapshot.tick120).toBe(2);
    expect(snapshot.behaviorFacts.requested).toMatchObject({
      availability: "available",
      sampleCount: 2,
      aggregate: {
        gazePitchDegreesMin: Number.MAX_VALUE,
        gazePitchDegreesMax: Number.MAX_VALUE,
        gazeQualifiedInputTickCount: 2,
      },
    });
    expect(() => session.canonicalEventSerialization()).not.toThrow();
    expect(() => session.behaviorFactSerialization()).not.toThrow();
  });
});
