import {createHash} from "node:crypto";
import {describe, expect, it, vi} from "vitest";

import {
  assertCanonicalRunFirstOccurrenceObservationReadyForClosure,
  createCanonicalRunFirstOccurrenceObservationCapture,
  createCanonicalRunFirstRoomClosureCapture,
  createCanonicalRunPreRoomBehaviorCapture,
  firstRoomClosureFromCanonicalMetricSourceReceipt,
  issueCanonicalRunFirstRoomMetricSourceReceipt,
  type CanonicalRunFirstOccurrenceObservationCaptureAvailable,
  type CanonicalRunFirstRoomClosureCaptureAvailable,
  type CanonicalRunFirstRoomMetricSourceReceipt,
  type CanonicalRunPreRoomBehaviorCaptureAvailable,
} from "./run-behavior-capture";
import {
  CanonicalRunBehaviorFactLedger,
  type CanonicalRunBehaviorCountEntry,
  type CanonicalRunBehaviorFactsReceipt,
} from "./run-behavior-facts";
import {
  CanonicalRunSession,
  type CanonicalRunSessionSnapshot,
  type CanonicalRunSessionStepInput,
} from "./run-session";
import {CanonicalRunRoomSession} from "./run-room-session";

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

function ticks(entries: readonly CanonicalRunBehaviorCountEntry[], id: string): number {
  return entries.find((entry) => entry.id === id)?.ticks120 ?? 0;
}

function isDeepFrozen(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value !== "object" || value === null || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value) && Object.values(value).every((entry) => isDeepFrozen(entry, seen));
}

function frozenWithExtra<T extends object>(
  value: T,
  key: string,
  extra: unknown,
): T {
  const result = {...value};
  Object.defineProperty(result, key, {
    value: extra,
    enumerable: true,
    configurable: false,
    writable: false,
  });
  return Object.freeze(result) as T;
}

function reachH(session: CanonicalRunSession): Readonly<{
  beforeH: CanonicalRunSessionSnapshot;
  atH: CanonicalRunSessionSnapshot;
}> {
  let snapshot = session.snapshot();
  while (snapshot.tick120 < 960) {
    snapshot = session.step(prologueInput(snapshot.tick120 + 1));
  }
  while (snapshot.tick120 < 1021) {
    snapshot = session.step(qualifiedGazeInput(snapshot.tick120 + 1));
  }
  let beforeH = snapshot;
  while (snapshot.phase !== "room_sampling" && snapshot.tick120 < 3360) {
    beforeH = snapshot;
    snapshot = session.step(neutralInput(snapshot.tick120 + 1));
  }
  if (snapshot.phase !== "room_sampling") throw new Error("capture fixture did not reach H");
  return Object.freeze({beforeH, atH: snapshot});
}

function availableCapture(snapshot: CanonicalRunSessionSnapshot): CanonicalRunPreRoomBehaviorCaptureAvailable {
  const capture = snapshot.preRoomBehaviorCapture;
  if (capture.availability !== "available") throw new Error("pre-room capture is missing");
  return capture;
}

function availableFirstOccurrenceCapture(
  snapshot: CanonicalRunSessionSnapshot,
): CanonicalRunFirstOccurrenceObservationCaptureAvailable {
  const capture = snapshot.firstOccurrenceObservationCapture;
  if (capture.availability !== "available") {
    throw new Error("first-occurrence observation capture is missing");
  }
  return capture;
}

function availableFirstRoomClosureCapture(
  snapshot: CanonicalRunSessionSnapshot,
): CanonicalRunFirstRoomClosureCaptureAvailable {
  const capture = snapshot.firstRoomClosureCapture;
  if (capture.availability !== "available") {
    throw new Error("first-room closure capture is missing");
  }
  return capture;
}

function reachFirstOccurrenceSliceClose(session: CanonicalRunSession): Readonly<{
  atH: CanonicalRunSessionSnapshot;
  beforeClose: CanonicalRunSessionSnapshot;
  eventBytesBeforeClose: string;
  atClose: CanonicalRunSessionSnapshot;
}> {
  const atH = reachH(session).atH;
  const handoffTick120 = atH.handoff.atTick120;
  if (handoffTick120 === null) throw new Error("first-occurrence fixture lost H");
  let beforeClose = atH;
  while (beforeClose.tick120 < handoffTick120 + 1700) {
    beforeClose = session.step(neutralInput(beforeClose.tick120 + 1));
  }
  const eventBytesBeforeClose = session.canonicalEventSerialization();
  const atClose = session.step(neutralInput(handoffTick120 + 1701));
  return Object.freeze({atH, beforeClose, eventBytesBeforeClose, atClose});
}

describe("EXT-2026-007 pre-room behavior capture", () => {
  it("freezes the exact closed [1,H] prefix without room or composer authority", () => {
    const session = new CanonicalRunSession(OPTIONS);
    expect(session.snapshot().preRoomBehaviorCapture).toEqual({
      availability: "missing",
      reason: "pre-room-boundary-not-closed",
      metricProjection: false,
      selectionAllowed: false,
    });

    const {beforeH, atH} = reachH(session);
    expect(beforeH.phase).toBe("first_clamp_recovery");
    expect(beforeH.preRoomBehaviorCapture.availability).toBe("missing");
    const capture = availableCapture(atH);
    const handoffTick120 = atH.handoff.atTick120;
    if (handoffTick120 === null) throw new Error("capture fixture lost H");

    expect(capture).toMatchObject({
      authority: "canonical-run-pre-room-behavior-capture-v1",
      schemaVersion: "1.0.0-ext-2026-007",
      producerId: "canonical-run-session.pre-room-boundary-observer",
      producerVersion: "1.0.0",
      extensionPolicy: "EXT-2026-007",
      sourceEpoch: "current-run-pre-room-prefix",
      capturedAtTick120: handoffTick120,
      rawRunSeed: OPTIONS.rawRunSeed,
      contentIdentity: {
        contentAuthoritySchemaVersion: "4.0.0-content-authority",
        packageId: "1bit-stg-complete-asset-kit-v4",
        packageSchemaVersion: "4.0.0",
        packageManifestSha256: "d4810598bdb1795cb44b937eb219d4d86f8eeaf3b32c5789a1e9c642bf1dbe70",
        contentDigestSha256: "f5ad0e32d5c15aa9cae52a5b7948af217bc82951bfb7f8f4cb97c3a8c24bc2b2",
      },
      metricProjection: false,
      selectionAllowed: false,
    });
    expect(capture.behaviorFacts).toEqual(atH.behaviorFacts);
    expect(capture.behaviorFacts).toMatchObject({
      tick120: handoffTick120,
      acceptedTickCount: handoffTick120,
      sampling: {
        tickZeroExcluded: true,
        firstAcceptedTick120: 1,
        lastAcceptedTick120: handoffTick120,
      },
      context: {room: {availability: "missing", reason: "room-context-not-consumed-yet"}},
      composerAvailability: {
        status: "withheld-metric-projection-policy-not-authored",
        ready: false,
        selectionAllowed: false,
      },
      adapterPolicy: {canonicalEventWrites: 0, metricProjection: false},
    });
    expect(ticks(capture.behaviorFacts.sampling.ownerPhaseTickCounts, "room_sampling")).toBe(0);
    expect(ticks(capture.behaviorFacts.sampling.ownerPhaseTickCounts, "first_clamp_recovery"))
      .toBeGreaterThan(0);
    expect(capture.behaviorFacts.composerAvailability.unresolvedMetricIds).toHaveLength(14);

    const events = session.events();
    const eventFacts = capture.behaviorFacts.canonicalEvents;
    expect(eventFacts.tickZeroBaselineCount + eventFacts.observedCount).toBe(events.length);
    expect(eventFacts.lastObservedSequence).toBe(events.at(-1)?.sequence ?? null);
    const counts = new Map<string, number>();
    for (const event of events.slice(eventFacts.tickZeroBaselineCount)) {
      counts.set(event.id, (counts.get(event.id) ?? 0) + 1);
    }
    expect(eventFacts.countsById).toEqual(
      [...counts]
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([id, count]) => ({id, count})),
    );

    const serialized = JSON.stringify(capture);
    for (const forbidden of [
      "roomSampling",
      "FORCED_ALIGNMENT",
      "room.forced.left_right_gate",
      "patternId",
      "difficulty",
      "tierId",
      "metrics",
      "roomCount",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(isDeepFrozen(capture)).toBe(true);
  });

  it("never changes the H capture while the rolling ledger enters and completes the fixed slice", () => {
    const session = new CanonicalRunSession(OPTIONS);
    let {atH: snapshot} = reachH(session);
    const handoffTick120 = snapshot.tick120;
    const captureBytes = JSON.stringify(availableCapture(snapshot));

    for (const relativeTick120 of [1, 159, 1701]) {
      while (snapshot.tick120 < handoffTick120 + relativeTick120) {
        snapshot = session.step(neutralInput(snapshot.tick120 + 1));
      }
      expect(JSON.stringify(availableCapture(snapshot))).toBe(captureBytes);
    }
    expect(snapshot.behaviorFacts.tick120).toBe(handoffTick120 + 1701);
    expect(availableCapture(snapshot).behaviorFacts.tick120).toBe(handoffTick120);
    expect(ticks(snapshot.behaviorFacts.sampling.ownerPhaseTickCounts, "room_sampling")).toBe(1701);
    expect(snapshot.roomSampling).toMatchObject({
      relativeTick120: 1701,
      fixedSliceComplete: true,
      roomComplete: false,
      handoffReady: false,
    });
  });

  it("is deterministic, ignores rejected input, and fails closed on hostile source facts", () => {
    const first = new CanonicalRunSession(OPTIONS);
    const second = new CanonicalRunSession(OPTIONS);
    const initial = first.snapshot();
    expect(() => first.step(neutralInput(0))).toThrow(/advance one tick at a time/);
    expect(first.snapshot()).toEqual(initial);
    expect(first.snapshot().preRoomBehaviorCapture.availability).toBe("missing");

    const firstAtH = reachH(first).atH;
    const secondAtH = reachH(second).atH;
    const firstCapture = availableCapture(firstAtH);
    const secondCapture = availableCapture(secondAtH);
    expect(JSON.stringify(firstCapture)).toBe(JSON.stringify(secondCapture));

    const sourceEventCount = firstCapture.behaviorFacts.canonicalEvents.tickZeroBaselineCount
      + firstCapture.behaviorFacts.canonicalEvents.observedCount;
    expect(() => createCanonicalRunPreRoomBehaviorCapture({
      capturedAtTick120: firstCapture.capturedAtTick120 + 1,
      sourceEventCount,
      behaviorFacts: firstCapture.behaviorFacts,
    })).toThrow(/capture tick|capturedAtTick120|boundary/);
    expect(() => createCanonicalRunPreRoomBehaviorCapture({
      capturedAtTick120: firstCapture.capturedAtTick120,
      sourceEventCount,
      behaviorFacts: {...firstCapture.behaviorFacts},
    })).toThrow(/frozen|data-only/);

    const hostileFacts = [
      frozenWithExtra(firstCapture.behaviorFacts, "metrics", Object.freeze({avgFlower: 0})),
      Object.freeze({
        ...firstCapture.behaviorFacts,
        context: frozenWithExtra(
          firstCapture.behaviorFacts.context,
          "roomPlan",
          Object.freeze({roomId: "FORCED_ALIGNMENT"}),
        ),
      }),
      Object.freeze({
        ...firstCapture.behaviorFacts,
        adapterPolicy: frozenWithExtra(firstCapture.behaviorFacts.adapterPolicy, "rngState", 7),
      }),
      frozenWithExtra(firstCapture.behaviorFacts, "__proto__", "hostile-own-data-key"),
    ];
    for (const behaviorFacts of hostileFacts) {
      expect(() => createCanonicalRunPreRoomBehaviorCapture({
        capturedAtTick120: firstCapture.capturedAtTick120,
        sourceEventCount,
        behaviorFacts,
      })).toThrow(/exact schema fields/);
    }
  });

  it("faults the composite instead of exposing a half-capture when H validation fails", () => {
    const control = new CanonicalRunSession(OPTIONS);
    const handoffTick120 = reachH(control).atH.tick120;
    const session = new CanonicalRunSession(OPTIONS);
    let snapshot = session.snapshot();
    while (snapshot.tick120 < 960) {
      snapshot = session.step(prologueInput(snapshot.tick120 + 1));
    }
    while (snapshot.tick120 < 1021) {
      snapshot = session.step(qualifiedGazeInput(snapshot.tick120 + 1));
    }
    while (snapshot.tick120 < handoffTick120 - 1) {
      snapshot = session.step(neutralInput(snapshot.tick120 + 1));
    }
    expect(snapshot).toMatchObject({
      tick120: handoffTick120 - 1,
      phase: "first_clamp_recovery",
      preRoomBehaviorCapture: {availability: "missing"},
    });

    const originalSnapshot = CanonicalRunBehaviorFactLedger.prototype.snapshot;
    const hostileSource = vi.spyOn(CanonicalRunBehaviorFactLedger.prototype, "snapshot")
      .mockImplementation(function (this: CanonicalRunBehaviorFactLedger) {
        const facts = originalSnapshot.call(this);
        return facts.tick120 === handoffTick120
          ? frozenWithExtra(facts, "metrics", Object.freeze({avgFlower: 0}))
          : facts;
      });
    try {
      expect(() => session.step(neutralInput(handoffTick120))).toThrow(/exact schema fields/);
    } finally {
      hostileSource.mockRestore();
    }
    expect(() => session.snapshot()).toThrow(/faulted.*exact schema fields/);
    expect(() => session.events()).toThrow(/faulted.*exact schema fields/);
  });
});

describe("EXT-2026-008 first-occurrence observation capture", () => {
  it("freezes H+1701 after the drained fixed slice without granting continuation authority", () => {
    const session = new CanonicalRunSession(OPTIONS);
    expect(session.snapshot().firstOccurrenceObservationCapture).toEqual({
      availability: "missing",
      reason: "first-occurrence-slice-not-closed",
      roomComplete: false,
      distinctVisitedDelta: 0,
      continuationPolicyAvailable: false,
      metricProjection: false,
      selectionAllowed: false,
      transitionAllowed: false,
      targetRoom: null,
      selectionRngDraws: 0,
      canonicalEventWrites: 0,
    });

    const {atH, beforeClose, eventBytesBeforeClose, atClose} =
      reachFirstOccurrenceSliceClose(session);
    const handoffTick120 = atH.handoff.atTick120;
    if (handoffTick120 === null) throw new Error("first-occurrence fixture lost H");
    const preRoomCaptureBytes = JSON.stringify(availableCapture(atH));

    expect(atH.firstOccurrenceObservationCapture.availability).toBe("missing");
    expect(beforeClose).toMatchObject({
      tick120: handoffTick120 + 1700,
      firstOccurrenceObservationCapture: {availability: "missing"},
      roomSampling: {
        fixedSliceComplete: false,
        roomComplete: false,
        handoffReady: false,
        entities: {digitalBodies: 0, liveColliders: 0, residueVisuals: 0},
      },
    });
    const room = atClose.roomSampling;
    if (room === null) throw new Error("first-occurrence fixture lost its room snapshot");
    const capture = availableFirstOccurrenceCapture(atClose);

    expect(capture).toMatchObject({
      authority: "canonical-run-first-occurrence-observation-capture-v1",
      schemaVersion: "1.0.0-ext-2026-008",
      producerId: "canonical-run-session.first-occurrence-boundary-observer",
      producerVersion: "1.0.0",
      extensionPolicy: "EXT-2026-008",
      sourceEpoch: "current-run-through-first-occurrence-slice",
      capturedAtTick120: handoffTick120 + 1701,
      rawRunSeed: OPTIONS.rawRunSeed,
      contentIdentity: availableCapture(atH).contentIdentity,
      roomComplete: false,
      distinctVisitedDelta: 0,
      continuationPolicyAvailable: false,
      metricProjection: false,
      selectionAllowed: false,
      transitionAllowed: false,
      targetRoom: null,
      selectionRngDraws: 0,
      canonicalEventWrites: 0,
    });
    expect(Object.keys(capture).sort()).toEqual([
      "availability",
      "authority",
      "behaviorFacts",
      "canonicalEventWrites",
      "capturedAtTick120",
      "contentIdentity",
      "continuationPolicyAvailable",
      "distinctVisitedDelta",
      "extensionPolicy",
      "metricProjection",
      "producerId",
      "producerVersion",
      "rawRunSeed",
      "roomComplete",
      "schemaVersion",
      "selectionAllowed",
      "selectionRngDraws",
      "sourceBoundary",
      "sourceEpoch",
      "targetRoom",
      "transitionAllowed",
    ].sort());
    expect(capture.sourceBoundary).toEqual({
      preRoomTick120: handoffTick120,
      roomId: "FORCED_ALIGNMENT",
      roomOrdinal: 0,
      patternId: "room.forced.left_right_gate",
      occurrenceId: "room:0:encounter:0:room.forced.left_right_gate",
      encounterOrdinal: 0,
      readStartTick120: handoffTick120 + 159,
      occurrenceDrainedAtTick120: handoffTick120 + 1699,
      fixedSliceCompleteTick120: handoffTick120 + 1701,
      resolvedSeed: room.resolvedSeed,
    });
    expect(capture.behaviorFacts).toEqual(atClose.behaviorFacts);
    expect(capture.behaviorFacts).toMatchObject({
      tick120: handoffTick120 + 1701,
      acceptedTickCount: handoffTick120 + 1701,
      sampling: {lastAcceptedTick120: handoffTick120 + 1701},
      context: {
        room: {
          availability: "available",
          firstAvailableTick120: handoffTick120 + 1,
          lastAvailableTick120: handoffTick120 + 1701,
          sampleCount: 1701,
          aggregate: {roomTickCounts: [{id: "FORCED_ALIGNMENT", ticks120: 1701}]},
        },
      },
      composerAvailability: {ready: false, selectionAllowed: false},
      adapterPolicy: {canonicalEventWrites: 0, metricProjection: false},
    });
    expect(ticks(capture.behaviorFacts.sampling.ownerPhaseTickCounts, "room_sampling")).toBe(1701);
    if (capture.behaviorFacts.context.runCombat.availability !== "available") {
      throw new Error("first-occurrence capture lost run-combat facts");
    }
    expect(ticks(
      capture.behaviorFacts.context.runCombat.aggregate.activeOccurrenceTickCounts,
      "room:0:encounter:0:room.forced.left_right_gate",
    )).toBe(1540);
    expect(room).toMatchObject({
      phase: "first_room_slice_complete",
      fixedSliceComplete: true,
      roomComplete: false,
      handoffReady: false,
      entities: {digitalBodies: 0, liveColliders: 0, residueVisuals: 0},
      combat: {
        patternComplete: true,
        projectileLifecycleDrained: true,
        runTimedStateQuiescent: true,
        handoffReady: true,
      },
      runCombat: {
        activeOccurrenceId: null,
        pendingFlushTick120: null,
        faulted: false,
      },
    });
    const eventFacts = capture.behaviorFacts.canonicalEvents;
    expect(eventFacts.tickZeroBaselineCount + eventFacts.observedCount).toBe(session.events().length);
    expect(eventFacts.lastObservedSequence).toBe(session.events().at(-1)?.sequence ?? null);
    expect(session.canonicalEventSerialization()).toBe(eventBytesBeforeClose);
    expect(JSON.stringify(availableCapture(atClose))).toBe(preRoomCaptureBytes);
    expect(isDeepFrozen(capture)).toBe(true);

    const captureBytes = JSON.stringify(capture);
    expect(Buffer.byteLength(captureBytes)).toBe(5567);
    expect(createHash("sha256").update(captureBytes).digest("hex"))
      .toBe("a31c3b06dd17ce5403865fac265f86d04345da08524f51d0951f67e061b5fa29");
    expect(atClose.firstRoomClosureCapture).toMatchObject({
      availability: "missing",
      roomComplete: false,
      handoffReady: false,
    });
    expect(session.canonicalEventSerialization()).toBe(eventBytesBeforeClose);
  });

  it("is deterministic and rejects non-frozen, extra-field, or wrong-boundary sources", () => {
    const first = new CanonicalRunSession(OPTIONS);
    const second = new CanonicalRunSession(OPTIONS);
    const firstClose = reachFirstOccurrenceSliceClose(first).atClose;
    const secondClose = reachFirstOccurrenceSliceClose(second).atClose;
    const firstCapture = availableFirstOccurrenceCapture(firstClose);
    const secondCapture = availableFirstOccurrenceCapture(secondClose);
    expect(JSON.stringify(firstCapture)).toBe(JSON.stringify(secondCapture));

    const roomSnapshot = firstClose.roomSampling;
    if (roomSnapshot === null) throw new Error("hostile-source fixture lost its room snapshot");
    const preRoomCapture = availableCapture(firstClose);
    const sourceEventCount = first.events().length;
    expect(() => createCanonicalRunFirstOccurrenceObservationCapture({
      behaviorFacts: {...firstCapture.behaviorFacts},
      sourceEventCount,
      preRoomCapture,
      roomSnapshot,
    })).toThrow(/frozen/);
    expect(() => createCanonicalRunFirstOccurrenceObservationCapture({
      behaviorFacts: frozenWithExtra(
        firstCapture.behaviorFacts,
        "metrics",
        Object.freeze({avgFlower: 0}),
      ),
      sourceEventCount,
      preRoomCapture,
      roomSnapshot,
    })).toThrow(/exact schema fields/);
    expect(() => createCanonicalRunFirstOccurrenceObservationCapture({
      behaviorFacts: firstCapture.behaviorFacts,
      sourceEventCount,
      preRoomCapture,
      roomSnapshot: Object.freeze({...roomSnapshot, tick120: roomSnapshot.tick120 - 1}),
    })).toThrow(/boundar|H\+1701/);

    expect(() => createCanonicalRunFirstOccurrenceObservationCapture({
      behaviorFacts: firstCapture.behaviorFacts,
      sourceEventCount,
      preRoomCapture,
      roomSnapshot: frozenWithExtra(roomSnapshot, "metrics", Object.freeze({roomComplete: 1})),
    })).toThrow(/exact schema fields/);
    expect(() => createCanonicalRunFirstOccurrenceObservationCapture({
      behaviorFacts: firstCapture.behaviorFacts,
      sourceEventCount,
      preRoomCapture,
      roomSnapshot: Object.freeze({
        ...roomSnapshot,
        resolvedSeed: Object.freeze({
          ...roomSnapshot.resolvedSeed,
          value: roomSnapshot.resolvedSeed.value ^ 1,
        }),
      }),
    })).toThrow(/seed.*composition/);

    const runCombatFacts = firstCapture.behaviorFacts.context.runCombat;
    if (runCombatFacts.availability !== "available") {
      throw new Error("hostile-source fixture lost run-combat facts");
    }
    const occurrenceCountDrift = Object.freeze(runCombatFacts.aggregate.activeOccurrenceTickCounts.map(
      (entry) => Object.freeze(entry.id === roomSnapshot.occurrenceId
        ? {...entry, ticks120: entry.ticks120 - 1}
        : {...entry}),
    ));
    expect(() => createCanonicalRunFirstOccurrenceObservationCapture({
      behaviorFacts: Object.freeze({
        ...firstCapture.behaviorFacts,
        context: Object.freeze({
          ...firstCapture.behaviorFacts.context,
          runCombat: Object.freeze({
            ...runCombatFacts,
            aggregate: Object.freeze({
              ...runCombatFacts.aggregate,
              activeOccurrenceTickCounts: occurrenceCountDrift,
            }),
          }),
        }),
      }),
      sourceEventCount,
      preRoomCapture,
      roomSnapshot,
    })).toThrow(/1540 accepted ticks/);

    const ownerCounts = firstCapture.behaviorFacts.sampling.ownerPhaseTickCounts;
    const preRoomOwners = ownerCounts.filter((entry) => entry.id !== "room_sampling");
    const firstOwner = preRoomOwners[0];
    const secondOwner = preRoomOwners[1];
    if (firstOwner === undefined || secondOwner === undefined || secondOwner.ticks120 <= 1) {
      throw new Error("hostile-source fixture lost two adjustable pre-room owners");
    }
    const ownerPrefixDrift = Object.freeze(ownerCounts.map((entry) => Object.freeze({
      ...entry,
      ticks120: entry.id === firstOwner.id
        ? entry.ticks120 + 1
        : entry.id === secondOwner.id
          ? entry.ticks120 - 1
          : entry.ticks120,
    })));
    expect(() => createCanonicalRunFirstOccurrenceObservationCapture({
      behaviorFacts: Object.freeze({
        ...firstCapture.behaviorFacts,
        sampling: Object.freeze({
          ...firstCapture.behaviorFacts.sampling,
          ownerPhaseTickCounts: ownerPrefixDrift,
        }),
      }),
      sourceEventCount,
      preRoomCapture,
      roomSnapshot,
    })).toThrow(/pre-room owner phase .* changed after H/);
  }, 10_000);

  it("faults the composite instead of exposing a half-capture when H+1701 validation fails", () => {
    const session = new CanonicalRunSession(OPTIONS);
    const atH = reachH(session).atH;
    const handoffTick120 = atH.handoff.atTick120;
    if (handoffTick120 === null) throw new Error("fault fixture lost H");

    let beforeClose = atH;
    while (beforeClose.tick120 < handoffTick120 + 1700) {
      beforeClose = session.step(neutralInput(beforeClose.tick120 + 1));
    }
    expect(beforeClose.firstOccurrenceObservationCapture.availability).toBe("missing");

    const originalSnapshot = CanonicalRunBehaviorFactLedger.prototype.snapshot;
    const hostileSource = vi.spyOn(CanonicalRunBehaviorFactLedger.prototype, "snapshot")
      .mockImplementation(function (this: CanonicalRunBehaviorFactLedger) {
        const facts = originalSnapshot.call(this);
        return facts.tick120 === handoffTick120 + 1701
          ? frozenWithExtra(facts, "metrics", Object.freeze({avgFlower: 0}))
          : facts;
      });
    try {
      expect(() => session.step(neutralInput(handoffTick120 + 1701)))
        .toThrow(/exact schema fields/);
    } finally {
      hostileSource.mockRestore();
    }

    expect(() => session.snapshot()).toThrow(/faulted.*exact schema fields/);
    expect(() => session.events()).toThrow(/faulted.*exact schema fields/);
    expect(() => session.canonicalEventSerialization()).toThrow(/faulted.*exact schema fields/);
    expect(() => session.behaviorFactSerialization()).toThrow(/faulted.*exact schema fields/);
  });
});

describe("EXT-2026-009 first fixed room closure capture", () => {
  it("closes exactly at H+1702, freezes one visit fact, and preserves H+1701 bytes", () => {
    const session = new CanonicalRunSession(OPTIONS);
    expect(session.snapshot().firstRoomClosureCapture).toEqual({
      availability: "missing",
      reason: "first-fixed-room-not-closed",
      roomComplete: false,
      distinctVisitedDelta: 0,
      handoffReady: false,
      metricProjection: false,
      selectionAllowed: false,
      transitionAllowed: false,
      targetRoom: null,
      selectionRngDraws: 0,
      canonicalEventWrites: 0,
    });
    const atObservation = reachFirstOccurrenceSliceClose(session).atClose;
    const handoffTick120 = atObservation.handoff.atTick120;
    if (handoffTick120 === null) throw new Error("first-room closure fixture lost H");
    const observation = availableFirstOccurrenceCapture(atObservation);
    const observationBytes = JSON.stringify(observation);
    const eventsAtObservation = session.events().length;

    const atClosure = session.step({
      ...neutralInput(handoffTick120 + 1702),
      focused: true,
    });
    const room = atClosure.roomSampling;
    if (room === null) throw new Error("first-room closure fixture lost its room snapshot");
    const capture = availableFirstRoomClosureCapture(atClosure);
    expect(capture).toMatchObject({
      authority: "canonical-run-first-room-closure-capture-v1",
      schemaVersion: "1.0.0-ext-2026-009",
      producerId: "canonical-run-session.first-room-closure-observer",
      producerVersion: "1.0.0",
      extensionPolicy: "EXT-2026-009",
      sourceEpoch: "current-run-through-first-room-closure",
      capturedAtTick120: handoffTick120 + 1702,
      rawRunSeed: OPTIONS.rawRunSeed,
      contentIdentity: observation.contentIdentity,
      plannedOccurrenceCount: 1,
      completedOccurrenceCount: 1,
      remainingOccurrenceCount: 0,
      roomComplete: true,
      completedRoomVisit: {roomId: "FORCED_ALIGNMENT", roomOrdinal: 0},
      distinctVisitedDelta: 1,
      handoffReady: false,
      metricProjection: false,
      selectionAllowed: false,
      transitionAllowed: false,
      targetRoom: null,
      selectionRngDraws: 0,
      canonicalEventWrites: 0,
    });
    expect(Object.keys(capture).sort()).toEqual([
      "availability",
      "authority",
      "behaviorFacts",
      "canonicalEventWrites",
      "capturedAtTick120",
      "completedOccurrenceCount",
      "completedRoomVisit",
      "contentIdentity",
      "distinctVisitedDelta",
      "extensionPolicy",
      "handoffReady",
      "metricProjection",
      "plannedOccurrenceCount",
      "producerId",
      "producerVersion",
      "rawRunSeed",
      "remainingOccurrenceCount",
      "roomComplete",
      "schemaVersion",
      "selectionAllowed",
      "selectionRngDraws",
      "sourceBoundary",
      "sourceEpoch",
      "targetRoom",
      "transitionAllowed",
    ].sort());
    expect(capture.sourceBoundary).toEqual({
      preRoomTick120: handoffTick120,
      firstOccurrenceObservationTick120: handoffTick120 + 1701,
      roomClosureTick120: handoffTick120 + 1702,
      roomId: "FORCED_ALIGNMENT",
      roomOrdinal: 0,
      patternId: "room.forced.left_right_gate",
      occurrenceId: "room:0:encounter:0:room.forced.left_right_gate",
      encounterOrdinal: 0,
      resolvedSeed: room.resolvedSeed,
    });
    expect(capture.behaviorFacts).toEqual(atClosure.behaviorFacts);
    expect(capture.behaviorFacts).toMatchObject({
      tick120: handoffTick120 + 1702,
      acceptedTickCount: handoffTick120 + 1702,
      sampling: {lastAcceptedTick120: handoffTick120 + 1702},
      context: {
        room: {
          firstAvailableTick120: handoffTick120 + 1,
          lastAvailableTick120: handoffTick120 + 1702,
          sampleCount: 1702,
          aggregate: {roomTickCounts: [{id: "FORCED_ALIGNMENT", ticks120: 1702}]},
        },
      },
      composerAvailability: {ready: false, selectionAllowed: false},
    });
    expect(ticks(capture.behaviorFacts.sampling.ownerPhaseTickCounts, "room_sampling")).toBe(1702);
    if (capture.behaviorFacts.context.runCombat.availability !== "available") {
      throw new Error("first-room closure capture lost run-combat facts");
    }
    expect(ticks(
      capture.behaviorFacts.context.runCombat.aggregate.activeOccurrenceTickCounts,
      "room:0:encounter:0:room.forced.left_right_gate",
    )).toBe(1540);
    expect(room).toMatchObject({
      extensionPolicy: "EXT-2026-009",
      phase: "first_room_complete",
      relativeTick120: 1702,
      roomComplete: true,
      handoffReady: false,
      entities: {digitalBodies: 0, liveColliders: 0, residueVisuals: 0},
      runCombat: {activeOccurrenceId: null, pendingFlushTick120: null, faulted: false},
    });
    expect(session.events()).toHaveLength(eventsAtObservation + 1);
    expect(session.events().at(-1)).toMatchObject({
      id: "flower.intensity.commit",
      tick120: handoffTick120 + 1702,
      payload: {source: "focus"},
    });
    expect(capture.behaviorFacts.canonicalEvents.tickZeroBaselineCount
      + capture.behaviorFacts.canonicalEvents.observedCount).toBe(session.events().length);
    expect(JSON.stringify(availableFirstOccurrenceCapture(atClosure))).toBe(observationBytes);
    expect(isDeepFrozen(capture)).toBe(true);

    expect(() => issueCanonicalRunFirstRoomMetricSourceReceipt(capture))
      .toThrow(/exact canonical closure capture/);
    expect(() => firstRoomClosureFromCanonicalMetricSourceReceipt(
      Object.freeze(Object.create(null)) as CanonicalRunFirstRoomMetricSourceReceipt,
    )).toThrow(/not issued by the canonical closure factory/);

    const closureBytes = JSON.stringify(capture);
    const eventBytesAtClosure = session.canonicalEventSerialization();
    const later = session.step({
      ...neutralInput(handoffTick120 + 1703),
      focused: true,
    });
    expect(JSON.stringify(availableFirstOccurrenceCapture(later))).toBe(observationBytes);
    expect(JSON.stringify(availableFirstRoomClosureCapture(later))).toBe(closureBytes);
    expect(later.behaviorFacts.tick120).toBe(handoffTick120 + 1703);
    expect(availableFirstRoomClosureCapture(later).behaviorFacts.tick120)
      .toBe(handoffTick120 + 1702);
    expect(later.roomSampling).toMatchObject({roomComplete: true, handoffReady: false});
    expect(session.canonicalEventSerialization()).toBe(eventBytesAtClosure);

    expect(() => createCanonicalRunFirstRoomClosureCapture({
      behaviorFactsReceipt: Object.freeze({}) as CanonicalRunBehaviorFactsReceipt,
      sourceEventCount: session.events().length,
      preRoomCapture: availableCapture(atClosure),
      firstOccurrenceObservationCapture: observation,
      roomSnapshot: room,
    })).toThrow(/receipt.*not issued/);
    expect(() => assertCanonicalRunFirstOccurrenceObservationReadyForClosure(
      frozenWithExtra(
        observation,
        "continuationToken",
        "forged",
      ),
      availableCapture(atClosure),
    )).toThrow(/exact schema fields/);
  }, 15_000);

  it("faults the composite instead of exposing a half-capture at H+1702", () => {
    const session = new CanonicalRunSession(OPTIONS);
    const atObservation = reachFirstOccurrenceSliceClose(session).atClose;
    const handoffTick120 = atObservation.handoff.atTick120;
    if (handoffTick120 === null) throw new Error("first-room closure fault fixture lost H");
    expect(atObservation.firstRoomClosureCapture.availability).toBe("missing");
    expect(atObservation.roomSampling).toMatchObject({roomComplete: false});

    const originalSnapshot = CanonicalRunRoomSession.prototype.snapshot;
    const hostileSource = vi.spyOn(CanonicalRunRoomSession.prototype, "snapshot")
      .mockImplementation(function (this: CanonicalRunRoomSession) {
        const room = originalSnapshot.call(this);
        return room.tick120 === handoffTick120 + 1702
          ? Object.freeze({...room, selectionAuthority: "forged-composer"}) as unknown as typeof room
          : room;
      });
    try {
      expect(() => session.step(neutralInput(handoffTick120 + 1702)))
        .toThrow(/source identity/);
    } finally {
      hostileSource.mockRestore();
    }
    expect(() => session.snapshot()).toThrow(/faulted.*source identity/);
    expect(() => session.events()).toThrow(/faulted.*source identity/);
    expect(() => session.canonicalEventSerialization()).toThrow(/faulted.*source identity/);
    expect(() => session.behaviorFactSerialization()).toThrow(/faulted.*source identity/);
    expect(() => session.step(neutralInput(handoffTick120 + 1703)))
      .toThrow(/faulted.*source identity/);
  }, 15_000);
});
