import {createHash} from "node:crypto";
import {describe, expect, it} from "vitest";

import firstRoomClosureFixtureJson from "./test-fixtures/first-room-closure-capture-v1.json";
import type {CanonicalRunFirstRoomClosureCaptureAvailable} from "./run-behavior-capture";
import {
  deriveCanonicalRunFirstRoomMetricProjectionUnbranded,
  type CanonicalRunFirstRoomMetricAvailableEntry,
  type CanonicalRunFirstRoomMetricProjectionAvailable,
} from "./run-metric-projection";
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

function reachFirstRoomObservation(session: CanonicalRunSession): Readonly<{
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
  while (snapshot.tick120 < handoffTick120 + 1701) {
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
  id: "avgFlower" | "gazeRatio",
): CanonicalRunFirstRoomMetricAvailableEntry {
  const entry = projection.metricEntries.find((candidate) => candidate.id === id);
  if (entry?.availability !== "available") throw new Error(`${id} is not available`);
  return entry;
}

describe("EXT-2026-010 first-room metric projection integration", () => {
  it("projects the exact H+1702 closure once without selecting or writing events", () => {
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

    const atObservation = reachFirstRoomObservation(session);
    expect(atObservation.snapshot.tick120).toBe(atObservation.handoffTick120 + 1701);
    expect(atObservation.snapshot.firstRoomMetricProjection.availability).toBe("missing");
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
    const fixtureProjection = deriveCanonicalRunFirstRoomMetricProjectionUnbranded(fixture);
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
      capturedAtTick120: atObservation.handoffTick120 + 1702,
      projectionStatus: "partial",
      availableMetricCount: 2,
      missingMetricCount: 12,
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
      .toHaveLength(12);

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
    expect(atClosure.firstRoomClosureCapture).toMatchObject({
      metricProjection: false,
      selectionAllowed: false,
      selectionRngDraws: 0,
      canonicalEventWrites: 0,
      targetRoom: null,
      transitionAllowed: false,
    });
    expect(isDeepFrozen(projection)).toBe(true);

    const projectionBytes = JSON.stringify(projection);
    const closureBytes = JSON.stringify(atClosure.firstRoomClosureCapture);
    const eventBytesAtClosure = session.canonicalEventSerialization();
    const later = session.step({
      ...neutralInput(atObservation.handoffTick120 + 1703),
      focused: true,
    });
    expect(JSON.stringify(availableProjection(later))).toBe(projectionBytes);
    expect(JSON.stringify(later.firstRoomClosureCapture)).toBe(closureBytes);
    expect(session.canonicalEventSerialization()).toBe(eventBytesAtClosure);
    expect(later.behaviorFacts.tick120).toBe(atObservation.handoffTick120 + 1703);
  }, 10_000);
});
