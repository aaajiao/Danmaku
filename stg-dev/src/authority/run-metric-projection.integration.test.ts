import {createHash} from "node:crypto";
import {describe, expect, it} from "vitest";

import firstRoomClosureFixtureJson from "./test-fixtures/first-room-closure-capture-v1.json";
import {
  issueCanonicalRunFirstRoomMetricSourceReceipt,
  type CanonicalRunFirstRoomClosureCaptureAvailable,
} from "./run-behavior-capture";
import {
  CanonicalRunBehaviorFactLedger,
  type CanonicalRunFirstRoomRecentInputSupplementSource,
} from "./run-behavior-facts";
import {
  createCanonicalRunFirstRoomMetricProjection,
  deriveCanonicalRunFirstRoomMetricProjectionUnbranded,
  issueCanonicalRunFirstRoomMetricProjectionReceipt,
  type CanonicalRunFirstRoomMetricAvailableEntry,
  type CanonicalRunFirstRoomMetricProjectionAvailable,
} from "./run-metric-projection";
import {
  createCanonicalRunFirstContinuationRoomTarget,
  deriveCanonicalRunFirstContinuationRoomTargetUnbranded,
  type CanonicalRunFirstContinuationRoomTargetAvailable,
} from "./run-first-continuation-room-target";
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

const FIXTURE_CANONICAL_BYTES = 5686;
const FIXTURE_SHA256 = "d15ddcef736728ab86eedcf2e061771c6e615b0db4731f45c5fb2165ef388389";

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

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const entry of Object.values(value)) deepFreeze(entry, seen);
  return Object.freeze(value);
}

function isDeepFrozen(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value !== "object" || value === null || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value)
    && Object.values(value).every((entry) => isDeepFrozen(entry, seen));
}

function reachFirstRoomRelativeTick(
  session: CanonicalRunSession,
  relativeTick120: number,
): Readonly<{
  handoffTick120: number;
  snapshot: CanonicalRunSessionSnapshot;
}> {
  let snapshot = session.snapshot();
  while (snapshot.tick120 < 960) {
    snapshot = session.step(prologueInput(snapshot.tick120 + 1));
  }
  while (snapshot.tick120 < 1021) {
    snapshot = session.step(qualifiedGazeInput(snapshot.tick120 + 1));
  }
  while (snapshot.phase !== "room_sampling" && snapshot.tick120 < 3360) {
    snapshot = session.step(neutralInput(snapshot.tick120 + 1));
  }
  const handoffTick120 = snapshot.handoff.atTick120;
  if (snapshot.phase !== "room_sampling" || handoffTick120 === null) {
    throw new Error("metric integration fixture did not reach the first room");
  }
  while (snapshot.tick120 < handoffTick120 + relativeTick120) {
    snapshot = session.step(neutralInput(snapshot.tick120 + 1));
  }
  return Object.freeze({handoffTick120, snapshot});
}

function availableProjection(
  snapshot: CanonicalRunSessionSnapshot,
): CanonicalRunFirstRoomMetricProjectionAvailable {
  const projection = snapshot.firstRoomMetricProjection;
  if (projection.availability !== "available") {
    throw new Error("first-room metric projection is missing");
  }
  return projection;
}

function availableEntry(
  projection: CanonicalRunFirstRoomMetricProjectionAvailable,
  id: "avgFlower" | "gazeRatio" | "recentInputDensity",
): CanonicalRunFirstRoomMetricAvailableEntry {
  const entry = projection.metricEntries.find((candidate) => candidate.id === id);
  if (entry?.availability !== "available") throw new Error(`${id} is not available`);
  return entry;
}

function availableContinuationTarget(
  snapshot: CanonicalRunSessionSnapshot,
): CanonicalRunFirstContinuationRoomTargetAvailable {
  const target = snapshot.firstContinuationRoomTarget;
  if (target.availability !== "available") {
    throw new Error("first continuation room target is missing");
  }
  return target;
}

function metricInternals(session: CanonicalRunSession): Readonly<{
  behaviorFacts: CanonicalRunBehaviorFactLedger;
  firstRoomClosureCaptureValue: CanonicalRunFirstRoomClosureCaptureAvailable | null;
  firstRoomMetricProjectionValue: CanonicalRunFirstRoomMetricProjectionAvailable | null;
}> {
  return session as unknown as Readonly<{
    behaviorFacts: CanonicalRunBehaviorFactLedger;
    firstRoomClosureCaptureValue: CanonicalRunFirstRoomClosureCaptureAvailable | null;
    firstRoomMetricProjectionValue: CanonicalRunFirstRoomMetricProjectionAvailable | null;
  }>;
}

describe("EXT-2026-011/012 first-room metric and continuation-target integration", () => {
  it("atomically projects H+1702 and selects only the next target without transition or event writes", () => {
    const fixture = deepFreeze(firstRoomClosureFixtureJson) as unknown as CanonicalRunFirstRoomClosureCaptureAvailable;
    const fixtureBytes = JSON.stringify(fixture);
    expect(Buffer.byteLength(fixtureBytes)).toBe(FIXTURE_CANONICAL_BYTES);
    expect(createHash("sha256").update(fixtureBytes).digest("hex")).toBe(FIXTURE_SHA256);

    const session = new CanonicalRunSession(OPTIONS);
    expect(session.snapshot().firstRoomMetricProjection).toEqual({
      availability: "missing",
      reason: "first-room-metric-source-not-closed",
      ready: false,
      selectionAllowed: false,
    });
    expect(session.snapshot().firstContinuationRoomTarget).toEqual({
      availability: "missing",
      reason: "first-room-metric-projection-not-available",
      selectionComplete: false,
      selectionRngDraws: 0,
      transitionAllowed: false,
      handoffReady: false,
    });

    const atObservation = reachFirstRoomRelativeTick(session, 1701);
    expect(atObservation.snapshot.tick120).toBe(atObservation.handoffTick120 + 1701);
    expect(atObservation.snapshot.firstRoomMetricProjection.availability).toBe("missing");
    expect(atObservation.snapshot.firstContinuationRoomTarget.availability).toBe("missing");
    const eventBytesBeforeClosure = session.canonicalEventSerialization();

    const atClosure = session.step({
      ...neutralInput(atObservation.handoffTick120 + 1702),
      focused: true,
    });
    if (atClosure.firstRoomClosureCapture.availability !== "available") {
      throw new Error("first-room closure capture is missing");
    }
    expect(JSON.stringify(atClosure.firstRoomClosureCapture)).toBe(fixtureBytes);
    expect(session.canonicalEventSerialization()).not.toBe(eventBytesBeforeClosure);

    const projection = availableProjection(atClosure);
    const fixtureSupplement = deepFreeze({
      availability: "available" as const,
      authority: "canonical-run-first-room-recent-input-supplement-v1" as const,
      schemaVersion: "1.0.0-ext-2026-011" as const,
      producerId: "canonical-run-behavior-facts.first-room-recent-input-observer" as const,
      producerVersion: "1.0.0" as const,
      extensionPolicy: "EXT-2026-011" as const,
      sourceEpoch: "first-authored-room-input-window" as const,
      capturedAtTick120: atObservation.handoffTick120 + 1702,
      rawRunSeed: OPTIONS.rawRunSeed,
      sourceWindow: {
        firstTick120: atObservation.handoffTick120 + 1,
        lastTick120: atObservation.handoffTick120 + 1702,
      },
      roomTickCount: 1702,
      activeUnionTickCount: 1,
      canonicalEventWrites: 0 as const,
    }) satisfies CanonicalRunFirstRoomRecentInputSupplementSource;
    const fixtureProjection = deriveCanonicalRunFirstRoomMetricProjectionUnbranded(
      fixture,
      fixtureSupplement,
    );
    expect(JSON.stringify(projection)).toBe(JSON.stringify(fixtureProjection));
    expect(Object.keys(projection).sort()).toEqual([
      "availability",
      "authority",
      "availableMetricCount",
      "canonicalEventWrites",
      "capturedAtTick120",
      "contentIdentity",
      "extensionPolicy",
      "metricEntries",
      "missingMetricCount",
      "producerId",
      "producerVersion",
      "projectionStatus",
      "rawRunSeed",
      "ready",
      "schemaVersion",
      "selectionAllowed",
      "selectionRngDraws",
      "sourceBoundary",
      "sourceEpoch",
      "targetRoom",
      "transitionAllowed",
    ].sort());
    expect(projection).toMatchObject({
      schemaVersion: "1.1.0-ext-2026-011",
      producerVersion: "1.1.0",
      extensionPolicy: "EXT-2026-011",
      capturedAtTick120: atObservation.handoffTick120 + 1702,
      projectionStatus: "partial",
      availableMetricCount: 3,
      missingMetricCount: 11,
      ready: false,
      selectionAllowed: false,
      selectionRngDraws: 0,
      canonicalEventWrites: 0,
      targetRoom: null,
      transitionAllowed: false,
    });
    expect("metrics" in projection).toBe(false);
    expect(projection.metricEntries).toHaveLength(14);
    expect(projection.metricEntries.filter((entry) => entry.availability === "missing"))
      .toHaveLength(11);

    const avgFlower = availableEntry(projection, "avgFlower");
    expect(avgFlower.numerator.value).toBe(1190.5999999999124);
    expect(avgFlower.denominator.value).toBe(4024);
    expect(avgFlower.value).toBe(1190.5999999999124 / 4024);
    expect(avgFlower.sampleWindow).toEqual({firstTick120: 1, lastTick120: 4024});
    const gazeRatio = availableEntry(projection, "gazeRatio");
    expect(gazeRatio.numerator.value).toBe(1);
    expect(gazeRatio.denominator.value).toBe(3064);
    expect(gazeRatio.value).toBe(1 / 3064);
    expect(gazeRatio.sampleWindow).toEqual({firstTick120: 961, lastTick120: 4024});
    const recentInputDensity = availableEntry(projection, "recentInputDensity");
    expect(recentInputDensity).toMatchObject({
      formulaId: "first-room-active-input-union-ratio-v1",
      numerator: {sourcePath: "metricSupplement.activeUnionTickCount", value: 1},
      denominator: {
        sourcePath: "metricSupplement.roomTickCount",
        value: 1702,
      },
      sampleWindow: {
        firstTick120: atObservation.handoffTick120 + 1,
        lastTick120: atObservation.handoffTick120 + 1702,
      },
    });
    expect(recentInputDensity.value).toBe(1 / 1702);
    expect(atClosure.firstRoomClosureCapture).toMatchObject({
      metricProjection: false,
      selectionAllowed: false,
      selectionRngDraws: 0,
      canonicalEventWrites: 0,
      targetRoom: null,
      transitionAllowed: false,
    });
    expect(isDeepFrozen(projection)).toBe(true);

    const continuationTarget = availableContinuationTarget(atClosure);
    const fixtureTarget = deriveCanonicalRunFirstContinuationRoomTargetUnbranded(projection);
    expect(JSON.stringify(continuationTarget)).toBe(JSON.stringify(fixtureTarget));
    expect(continuationTarget).toMatchObject({
      selectedAtTick120: atObservation.handoffTick120 + 1702,
      completedRoomVisit: {roomId: "FORCED_ALIGNMENT", roomOrdinal: 0},
      candidateOrder: ["INFORMATION", "IN_BETWEEN", "POLARIZED"],
      candidateTotalWeight: 3.089092738732555,
      rng: {
        algorithm: "mulberry32-v1",
        seed: {
          domain: "ext-012-first-continuation-room-selection",
          value: OPTIONS.rawRunSeed.value,
        },
        drawOrdinal: 0,
        drawValue: 0.7038787782657892,
        stateAfterDrawUint32: 2_286_107_347,
        cursorInitial: 2.1743468228887917,
      },
      selectionComplete: true,
      selectionRngDraws: 1,
      canonicalEventWrites: 0,
      targetRoom: "POLARIZED",
      targetRoomOrdinal: 1,
      roomCount: null,
      difficulty: null,
      transitionAllowed: false,
      handoffReady: false,
    });
    expect(continuationTarget.candidateWeights.map((candidate) => candidate.totalWeight)).toEqual([
      1.0890209371659756,
      1.0000718015665797,
      1,
    ]);
    expect(continuationTarget.candidateWeights.flatMap((candidate) => candidate.metricTerms)
      .filter((term) => term.availability === "missing")
      .every((term) => !("value" in term) && !("contribution" in term))).toBe(true);
    expect(isDeepFrozen(continuationTarget)).toBe(true);

    expect(() => issueCanonicalRunFirstRoomMetricProjectionReceipt(projection))
      .toThrow(/original formal projection/);
    const internalProjection = metricInternals(session).firstRoomMetricProjectionValue;
    if (internalProjection === null) throw new Error("formal metric projection is missing");
    const internalReceipt = issueCanonicalRunFirstRoomMetricProjectionReceipt(internalProjection);
    expect(issueCanonicalRunFirstRoomMetricProjectionReceipt(internalProjection)).toBe(internalReceipt);
    expect(() => createCanonicalRunFirstContinuationRoomTarget(internalReceipt))
      .toThrow(/already selected/);

    const projectionBytes = JSON.stringify(projection);
    const targetBytes = JSON.stringify(continuationTarget);
    const closureBytes = JSON.stringify(atClosure.firstRoomClosureCapture);
    const eventBytesAtClosure = session.canonicalEventSerialization();
    const later = session.step({
      ...neutralInput(atObservation.handoffTick120 + 1703),
      focused: true,
    });
    expect(JSON.stringify(availableProjection(later))).toBe(projectionBytes);
    expect(JSON.stringify(availableContinuationTarget(later))).toBe(targetBytes);
    expect(JSON.stringify(later.firstRoomClosureCapture)).toBe(closureBytes);
    expect(session.canonicalEventSerialization()).toBe(eventBytesAtClosure);
    expect(later.behaviorFacts.tick120).toBe(atObservation.handoffTick120 + 1703);
  }, 10_000);

  it("excludes neutral-tail movement and rejects a valid supplement from another session", () => {
    const session = new CanonicalRunSession(OPTIONS);
    const atDrain = reachFirstRoomRelativeTick(session, 1699);
    const H = atDrain.handoffTick120;
    expect(atDrain.snapshot.player.inputEnabled).toBe(true);

    session.step({...neutralInput(H + 1700), movement: {x: 1, y: 0}});
    session.step({...neutralInput(H + 1701), movement: {x: 1, y: 0}});
    const atClosure = session.step(neutralInput(H + 1702));

    const recentInputDensity = availableEntry(
      availableProjection(atClosure),
      "recentInputDensity",
    );
    expect(recentInputDensity.numerator.value).toBe(0);
    expect(recentInputDensity.denominator.value).toBe(1702);
    expect(recentInputDensity.value).toBe(0);

    const sourceSession = new CanonicalRunSession(OPTIONS);
    const sourceObservation = reachFirstRoomRelativeTick(sourceSession, 1701);
    sourceSession.step({
      ...neutralInput(sourceObservation.handoffTick120 + 1702),
      focused: true,
    });
    const source = metricInternals(sourceSession);
    const sourceCapture = source.firstRoomClosureCaptureValue;
    if (sourceCapture === null) throw new Error("cross-session source closure is missing");
    const sourceReceipt = issueCanonicalRunFirstRoomMetricSourceReceipt(sourceCapture);
    const sourceSupplementReceipt = source.behaviorFacts
      .issueFirstRoomRecentInputSupplementReceipt();
    expect(createCanonicalRunFirstRoomMetricProjection(
      sourceReceipt,
      sourceSupplementReceipt,
    )).toEqual(availableProjection(sourceSession.snapshot()));

    const foreignSupplementReceipt = metricInternals(session).behaviorFacts
      .issueFirstRoomRecentInputSupplementReceipt();
    expect(() => createCanonicalRunFirstRoomMetricProjection(
      sourceReceipt,
      foreignSupplementReceipt,
    )).toThrow(/share one opaque ledger lineage/);
  }, 10_000);
});
