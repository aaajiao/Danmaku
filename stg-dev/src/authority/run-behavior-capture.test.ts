import {describe, expect, it, vi} from "vitest";

import {
  createCanonicalRunPreRoomBehaviorCapture,
  type CanonicalRunPreRoomBehaviorCaptureAvailable,
} from "./run-behavior-capture";
import {
  CanonicalRunBehaviorFactLedger,
  type CanonicalRunBehaviorCountEntry,
} from "./run-behavior-facts";
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
