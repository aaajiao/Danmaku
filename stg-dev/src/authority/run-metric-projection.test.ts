import {describe, expect, it} from "vitest";

import {V4_CONTENT_IDENTITY} from "../content/v4-content-identity";
import type {CanonicalEventId} from "./events";
import type {
  CanonicalRunFirstRoomClosureCaptureAvailable,
  CanonicalRunFirstRoomMetricSourceReceipt,
} from "./run-behavior-capture";
import type {
  CanonicalRunFirstRoomRecentInputSupplementReceipt,
  CanonicalRunFirstRoomRecentInputSupplementSource,
} from "./run-behavior-facts";
import {
  CANONICAL_RUN_FIRST_ROOM_METRIC_IDS,
  CANONICAL_RUN_FIRST_ROOM_METRIC_PROJECTION_MISSING,
  createCanonicalRunFirstRoomMetricProjection,
  deriveCanonicalRunFirstRoomMetricProjectionUnbranded,
  type CanonicalRunFirstRoomMetricAvailableEntry,
  type CanonicalRunFirstRoomMetricId,
  type CanonicalRunFirstRoomMetricMissingEntry,
  type CanonicalRunFirstRoomMetricProjectionPayload,
} from "./run-metric-projection";

const RAW_RUN_SEED = 1;
const PRE_ROOM_TICK120 = 100;
const CLOSURE_TICK120 = 1802;
const RESOLVED_SEED = 1_782_735_496;

/** The fixture names only V4 IDs; keep the nominal-type escape test-local. */
function canonicalEventId(id: string): CanonicalEventId {
  return id as CanonicalEventId;
}

const EXPECTED_METRIC_IDS = Object.freeze([
  "avgFlower",
  "binarySwitches",
  "contextSwitches",
  "correctionLatency",
  "crackRatio",
  "gazeRatio",
  "highLightRatio",
  "intersectionHold",
  "noDuskTicks",
  "overrideRatio",
  "recentInputDensity",
  "sideCommitment",
  "sideSwitches",
  "unansweredActions",
] as const satisfies readonly CanonicalRunFirstRoomMetricId[]);

const EXPECTED_MISSING = Object.freeze({
  binarySwitches: "binary-authority-not-observed",
  contextSwitches: "context-transition-sequence-not-recorded",
  correctionLatency: "correction-pairs-not-recorded",
  crackRatio: "crack-band-samples-not-recorded",
  highLightRatio: "high-light-threshold-samples-not-recorded",
  intersectionHold: "intersection-authority-not-observed",
  noDuskTicks: "no-dusk-authority-not-observed",
  overrideRatio: "override-not-eligible-in-source-window",
  sideCommitment: "side-band-samples-not-recorded",
  sideSwitches: "side-transition-sequence-not-recorded",
  unansweredActions: "action-response-contract-not-authored",
} as const);

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const entry of Object.values(value)) deepFreeze(entry, seen);
  return Object.freeze(value);
}

function isDeepFrozen(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value !== "object" || value === null || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value) && Object.values(value).every((entry) => isDeepFrozen(entry, seen));
}

/** Strict, recursively frozen source-shaped input for the explicitly unbranded pure core. */
function frozenClosureFixture(): CanonicalRunFirstRoomClosureCaptureAvailable {
  const capture = {
    availability: "available",
    authority: "canonical-run-first-room-closure-capture-v1",
    schemaVersion: "1.0.0-ext-2026-009",
    producerId: "canonical-run-session.first-room-closure-observer",
    producerVersion: "1.0.0",
    extensionPolicy: "EXT-2026-009",
    sourceEpoch: "current-run-through-first-room-closure",
    capturedAtTick120: CLOSURE_TICK120,
    rawRunSeed: {domain: "raw-run-seed", value: RAW_RUN_SEED},
    contentIdentity: V4_CONTENT_IDENTITY,
    sourceBoundary: {
      preRoomTick120: PRE_ROOM_TICK120,
      firstOccurrenceObservationTick120: CLOSURE_TICK120 - 1,
      roomClosureTick120: CLOSURE_TICK120,
      roomId: "FORCED_ALIGNMENT",
      roomOrdinal: 0,
      patternId: "room.forced.left_right_gate",
      occurrenceId: "room:0:encounter:0:room.forced.left_right_gate",
      encounterOrdinal: 0,
      resolvedSeed: {domain: "resolved-occurrence-seed", value: RESOLVED_SEED},
    },
    behaviorFacts: {
      authority: "canonical-run-behavior-facts-v1",
      schemaVersion: "1.0.0-ext-2026-006",
      producerId: "canonical-run-session.accepted-tick-observer",
      producerVersion: "1.0.0",
      extensionPolicy: "EXT-2026-006",
      rawRunSeed: {domain: "raw-run-seed", value: RAW_RUN_SEED},
      tick120: CLOSURE_TICK120,
      acceptedTickCount: CLOSURE_TICK120,
      sampling: {
        tickZeroExcluded: true,
        firstAcceptedTick120: 1,
        lastAcceptedTick120: CLOSURE_TICK120,
        ownerPhaseTickCounts: [
          {id: "first_clamp_recovery", ticks120: 50},
          {id: "first_eye", ticks120: 40},
          {id: "quiet_awakening", ticks120: 10},
          {id: "room_sampling", ticks120: 1702},
        ],
      },
      requested: {
        availability: "available",
        firstAvailableTick120: 1,
        lastAvailableTick120: CLOSURE_TICK120,
        sampleCount: CLOSURE_TICK120,
        aggregate: {
          movementNonZeroTickCount: 120,
          movementXSum: 10,
          movementYSum: -5,
          movementMagnitudeSum: 130,
          signalActiveTickCount: 200,
          signalRisingEdgeCount: 4,
          focusRequestedTickCount: 80,
          gazeVisibleTickCount: 1792,
          gazePitchDegreesMin: 0,
          gazePitchDegreesMax: 60,
          gazeAlignmentSum: 70,
          gazeQualifiedInputTickCount: 70,
          overridePressedEdgeCount: 0,
          overrideReleasedEdgeCount: 0,
          overrideDirectionRequestCount: 0,
        },
      },
      committed: {
        player: {
          availability: "available",
          firstAvailableTick120: 1,
          lastAvailableTick120: CLOSURE_TICK120,
          sampleCount: CLOSURE_TICK120,
          aggregate: {
            inputEnabledTickCount: CLOSURE_TICK120,
            focusedTickCount: 80,
            positionXSum: 324_360,
            positionYSum: 1_027_140,
            positionMinX: 170,
            positionMaxX: 190,
            positionMinY: 560,
            positionMaxY: 580,
            lifeStateObservedTickCount: 1792,
            lifeStateTickCounts: [{id: "alive", ticks120: 1792}],
          },
        },
        flower: {
          availability: "available",
          firstAvailableTick120: 1,
          lastAvailableTick120: CLOSURE_TICK120,
          sampleCount: CLOSURE_TICK120,
          aggregate: {
            targetIntensitySum: 900.5,
            sourceTickCounts: [
              {id: "focus", ticks120: 2},
              {id: "gaze", ticks120: 100},
              {id: "signal", ticks120: 1700},
            ],
          },
        },
        gaze: {
          availability: "available",
          firstAvailableTick120: 11,
          lastAvailableTick120: CLOSURE_TICK120,
          sampleCount: 1792,
          aggregate: {
            clampActiveTickCount: 64,
            stateTickCounts: [
              {id: "acquiring", ticks120: 60},
              {id: "clamped", ticks120: 10},
              {id: "idle", ticks120: 1668},
              {id: "release-delay", ticks120: 54},
            ],
          },
        },
        override: {
          availability: "available",
          firstAvailableTick120: 11,
          lastAvailableTick120: CLOSURE_TICK120,
          sampleCount: 1792,
          aggregate: {
            stateTickCounts: [{id: "idle", ticks120: 1792}],
            maximumCycle: 0,
            maximumScarCount: 0,
          },
        },
      },
      context: {
        room: {
          availability: "available",
          firstAvailableTick120: PRE_ROOM_TICK120 + 1,
          lastAvailableTick120: CLOSURE_TICK120,
          sampleCount: 1702,
          aggregate: {
            roomTickCounts: [{id: "FORCED_ALIGNMENT", ticks120: 1702}],
          },
        },
        runCombat: {
          availability: "available",
          firstAvailableTick120: 11,
          lastAvailableTick120: CLOSURE_TICK120,
          sampleCount: 1792,
          aggregate: {
            noActiveOccurrenceTickCount: 162,
            activeOccurrenceTickCounts: [
              {id: "room:0:encounter:0:room.forced.left_right_gate", ticks120: 1540},
              {id: "run:first-eye:0", ticks120: 90},
            ],
          },
        },
      },
      canonicalEvents: {
        tickZeroBaselineCount: 1,
        observedCount: 7,
        lastObservedSequence: 7,
        countsById: [
          {id: canonicalEventId("flower.intensity.commit"), count: 3},
          {id: canonicalEventId("gaze.acquire.begin"), count: 1},
          {id: canonicalEventId("gaze.clamp.commit"), count: 1},
          {id: canonicalEventId("gaze.clamp.release"), count: 1},
          {id: canonicalEventId("gaze.release.begin"), count: 1},
        ],
      },
      composerAvailability: {
        status: "withheld-metric-projection-policy-not-authored",
        ready: false,
        selectionAllowed: false,
        unresolvedMetricIds: EXPECTED_METRIC_IDS,
      },
      adapterPolicy: {
        sampleBoundary: "post-authority-after-closed-canonical-tick",
        ownerPhase: "captured-before-phase-specific-step",
        storage: "bounded-rolling-aggregates-no-per-tick-history",
        requestCommitSeparation: true,
        canonicalEventWrites: 0,
        metricProjection: false,
        provenance: "application-policy-EXT-2026-006",
      },
    },
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
  } satisfies CanonicalRunFirstRoomClosureCaptureAvailable;
  return deepFreeze(capture);
}

function frozenSupplementFixture(): CanonicalRunFirstRoomRecentInputSupplementSource {
  return deepFreeze({
    availability: "available",
    authority: "canonical-run-first-room-recent-input-supplement-v1",
    schemaVersion: "1.0.0-ext-2026-011",
    producerId: "canonical-run-behavior-facts.first-room-recent-input-observer",
    producerVersion: "1.0.0",
    extensionPolicy: "EXT-2026-011",
    sourceEpoch: "first-authored-room-input-window",
    capturedAtTick120: CLOSURE_TICK120,
    rawRunSeed: {domain: "raw-run-seed", value: RAW_RUN_SEED},
    sourceWindow: {
      firstTick120: PRE_ROOM_TICK120 + 1,
      lastTick120: CLOSURE_TICK120,
    },
    roomTickCount: 1702,
    activeUnionTickCount: 200,
    canonicalEventWrites: 0,
  });
}

function hostileFixture(
  mutate: (draft: Record<string, any>) => void,
  freeze = true,
): CanonicalRunFirstRoomClosureCaptureAvailable {
  const draft = JSON.parse(JSON.stringify(frozenClosureFixture())) as Record<string, any>;
  mutate(draft);
  return (freeze ? deepFreeze(draft) : draft) as CanonicalRunFirstRoomClosureCaptureAvailable;
}

function hostileSupplementFixture(
  mutate: (draft: Record<string, any>) => void,
  freeze = true,
): CanonicalRunFirstRoomRecentInputSupplementSource {
  const draft = JSON.parse(JSON.stringify(frozenSupplementFixture())) as Record<string, any>;
  mutate(draft);
  return (freeze ? deepFreeze(draft) : draft) as CanonicalRunFirstRoomRecentInputSupplementSource;
}

function availableEntry(
  payload: CanonicalRunFirstRoomMetricProjectionPayload,
  id: "avgFlower" | "gazeRatio" | "recentInputDensity",
): CanonicalRunFirstRoomMetricAvailableEntry {
  const entry = payload.metricEntries.find((candidate) => candidate.id === id);
  if (entry === undefined || entry.availability !== "available") {
    throw new Error(`available metric fixture lost ${id}`);
  }
  return entry;
}

describe("EXT-2026-011 unbranded first-room metric derivation", () => {
  it("projects three ratios and eleven exact absences without minting composer input", () => {
    const source = frozenClosureFixture();
    const supplement = frozenSupplementFixture();
    const payload = deriveCanonicalRunFirstRoomMetricProjectionUnbranded(source, supplement);

    expect(Object.keys(payload).sort()).toEqual([
      "availability",
      "authority",
      "schemaVersion",
      "producerId",
      "producerVersion",
      "extensionPolicy",
      "sourceEpoch",
      "capturedAtTick120",
      "rawRunSeed",
      "contentIdentity",
      "sourceBoundary",
      "projectionStatus",
      "availableMetricCount",
      "missingMetricCount",
      "metricEntries",
      "ready",
      "selectionAllowed",
      "selectionRngDraws",
      "canonicalEventWrites",
      "targetRoom",
      "transitionAllowed",
    ].sort());
    expect(payload).toMatchObject({
      availability: "available",
      authority: "canonical-run-first-room-metric-projection-v1",
      schemaVersion: "1.1.0-ext-2026-011",
      producerId: "canonical-run-session.first-room-metric-projector",
      producerVersion: "1.1.0",
      extensionPolicy: "EXT-2026-011",
      sourceEpoch: "current-run-through-first-room-closure",
      capturedAtTick120: CLOSURE_TICK120,
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
    expect(payload.metricEntries.map((entry) => entry.id)).toEqual(EXPECTED_METRIC_IDS);
    expect(CANONICAL_RUN_FIRST_ROOM_METRIC_IDS).toEqual(EXPECTED_METRIC_IDS);

    expect(availableEntry(payload, "avgFlower")).toEqual({
      id: "avgFlower",
      availability: "available",
      value: 900.5 / 1802,
      unit: "ratio-0-1",
      formulaId: "committed-flower-target-mean-v1",
      numerator: {
        sourcePath: "behaviorFacts.committed.flower.aggregate.targetIntensitySum",
        value: 900.5,
      },
      denominator: {
        sourcePath: "behaviorFacts.committed.flower.sampleCount",
        value: 1802,
      },
      sampleWindow: {firstTick120: 1, lastTick120: 1802},
    });
    expect(availableEntry(payload, "gazeRatio")).toEqual({
      id: "gazeRatio",
      availability: "available",
      value: 10 / 1792,
      unit: "ratio-0-1",
      formulaId: "committed-gaze-clamped-state-ratio-v1",
      numerator: {
        sourcePath: "behaviorFacts.committed.gaze.aggregate.stateTickCounts[clamped].ticks120",
        value: 10,
      },
      denominator: {
        sourcePath: "behaviorFacts.committed.gaze.sampleCount",
        value: 1792,
      },
      sampleWindow: {firstTick120: 11, lastTick120: 1802},
    });
    expect(availableEntry(payload, "recentInputDensity")).toEqual({
      id: "recentInputDensity",
      availability: "available",
      value: 200 / 1702,
      unit: "ratio-0-1",
      formulaId: "first-room-active-input-union-ratio-v1",
      numerator: {
        sourcePath: "metricSupplement.activeUnionTickCount",
        value: 200,
      },
      denominator: {
        sourcePath: "metricSupplement.roomTickCount",
        value: 1702,
      },
      sampleWindow: {firstTick120: 101, lastTick120: 1802},
    });

    const missing = Object.fromEntries(payload.metricEntries
      .filter((entry): entry is CanonicalRunFirstRoomMetricMissingEntry => entry.availability === "missing")
      .map((entry) => [entry.id, entry.reason]));
    expect(missing).toEqual(EXPECTED_MISSING);
    expect("metrics" in payload).toBe(false);
    expect("metricProjection" in payload).toBe(false);
    expect(Reflect.ownKeys(payload).every((key) => typeof key === "string")).toBe(true);
    expect(isDeepFrozen(payload)).toBe(true);
    expect(payload.sourceBoundary).not.toBe(source.sourceBoundary);
    expect(JSON.stringify(deriveCanonicalRunFirstRoomMetricProjectionUnbranded(source, supplement)))
      .toBe(JSON.stringify(payload));
  });

  it("treats a missing clamped row as an observed zero rather than missing", () => {
    const source = hostileFixture((draft) => {
      const gaze = draft.behaviorFacts.committed.gaze.aggregate;
      gaze.stateTickCounts = gaze.stateTickCounts.filter((entry: {id: string}) => entry.id !== "clamped");
      gaze.stateTickCounts.find((entry: {id: string}) => entry.id === "idle").ticks120 += 10;
      gaze.clampActiveTickCount = 54;
    });
    const entry = availableEntry(
      deriveCanonicalRunFirstRoomMetricProjectionUnbranded(source, frozenSupplementFixture()),
      "gazeRatio",
    );
    expect(entry.numerator.value).toBe(0);
    expect(entry.value).toBe(0);
  });

  it.each([
    ["wrong content", (draft: Record<string, any>) => {
      draft.contentIdentity.contentDigestSha256 = "0".repeat(64);
    }, /content identity/],
    ["wrong closure boundary", (draft: Record<string, any>) => {
      draft.sourceBoundary.firstOccurrenceObservationTick120 -= 1;
    }, /exact H\/H\+1701\/H\+1702/],
    ["extra source field", (draft: Record<string, any>) => {
      draft.metrics = {};
    }, /exact schema fields/],
    ["wrong behavior-facts seed", (draft: Record<string, any>) => {
      draft.behaviorFacts.rawRunSeed.value += 1;
    }, /raw Run seed diverged/],
    ["zero Flower denominator", (draft: Record<string, any>) => {
      draft.behaviorFacts.committed.flower.sampleCount = 0;
    }, /flower\.sampleCount must be positive/i],
    ["non-finite Flower numerator", (draft: Record<string, any>) => {
      draft.behaviorFacts.committed.flower.aggregate.targetIntensitySum = Number.NaN;
    }, /finite JSON number/],
    ["negative-zero Flower numerator", (draft: Record<string, any>) => {
      draft.behaviorFacts.committed.flower.aggregate.targetIntensitySum = -0;
    }, /finite JSON number/],
    ["Flower numerator beyond denominator", (draft: Record<string, any>) => {
      draft.behaviorFacts.committed.flower.aggregate.targetIntensitySum = 1803;
    }, /Flower aggregate/],
    ["Gaze state-count gap", (draft: Record<string, any>) => {
      draft.behaviorFacts.committed.gaze.aggregate.stateTickCounts[0].ticks120 -= 1;
    }, /Gaze aggregate/],
    ["Gaze availability gap", (draft: Record<string, any>) => {
      draft.behaviorFacts.committed.gaze.firstAvailableTick120 += 1;
    }, /gaze availability window/i],
    ["Gaze clamp-state contradiction", (draft: Record<string, any>) => {
      draft.behaviorFacts.committed.gaze.aggregate.clampActiveTickCount -= 1;
    }, /Gaze aggregate/],
  ] as const)("fails closed on %s", (_label, mutate, error) => {
    expect(() => deriveCanonicalRunFirstRoomMetricProjectionUnbranded(
      hostileFixture(mutate),
      frozenSupplementFixture(),
    )).toThrow(error);
  });

  it.each([
    ["extra supplement field", (draft: Record<string, any>) => {
      draft.metrics = {};
    }, /exact schema fields/],
    ["wrong supplement identity", (draft: Record<string, any>) => {
      draft.producerVersion = "1.0.1";
    }, /supplement identity/],
    ["wrong supplement seed", (draft: Record<string, any>) => {
      draft.rawRunSeed.value += 1;
    }, /exact event-free/],
    ["wrong supplement capture tick", (draft: Record<string, any>) => {
      draft.capturedAtTick120 -= 1;
    }, /exact event-free/],
    ["wrong supplement first tick", (draft: Record<string, any>) => {
      draft.sourceWindow.firstTick120 += 1;
    }, /exact event-free/],
    ["wrong supplement last tick", (draft: Record<string, any>) => {
      draft.sourceWindow.lastTick120 -= 1;
    }, /exact event-free/],
    ["zero supplement denominator", (draft: Record<string, any>) => {
      draft.roomTickCount = 0;
    }, /roomTickCount must be positive/],
    ["wrong supplement denominator", (draft: Record<string, any>) => {
      draft.roomTickCount -= 1;
    }, /exact event-free/],
    ["active union beyond denominator", (draft: Record<string, any>) => {
      draft.activeUnionTickCount = 1703;
    }, /exact event-free/],
    ["negative active union", (draft: Record<string, any>) => {
      draft.activeUnionTickCount = -1;
    }, /non-negative safe integer/],
    ["negative-zero active union", (draft: Record<string, any>) => {
      draft.activeUnionTickCount = -0;
    }, /finite JSON number/],
    ["supplement event write", (draft: Record<string, any>) => {
      draft.canonicalEventWrites = 1;
    }, /exact event-free/],
  ] as const)("fails closed on %s", (_label, mutate, error) => {
    expect(() => deriveCanonicalRunFirstRoomMetricProjectionUnbranded(
      frozenClosureFixture(),
      hostileSupplementFixture(mutate),
    )).toThrow(error);
  });

  it("rejects mutable source/supplement data and forged formal receipts", () => {
    const mutable = hostileFixture(() => undefined, false);
    expect(() => deriveCanonicalRunFirstRoomMetricProjectionUnbranded(
      mutable,
      frozenSupplementFixture(),
    ))
      .toThrow(/recursively frozen/);
    expect(() => deriveCanonicalRunFirstRoomMetricProjectionUnbranded(
      frozenClosureFixture(),
      hostileSupplementFixture(() => undefined, false),
    )).toThrow(/recursively frozen/);
    expect(() => createCanonicalRunFirstRoomMetricProjection(
      Object.freeze({}) as CanonicalRunFirstRoomMetricSourceReceipt,
      Object.freeze({}) as CanonicalRunFirstRoomRecentInputSupplementReceipt,
    )).toThrow(/receipt.*not issued/);
  });

  it("keeps the pre-source sentinel structurally incapable of selection", () => {
    expect(CANONICAL_RUN_FIRST_ROOM_METRIC_PROJECTION_MISSING).toEqual({
      availability: "missing",
      reason: "first-room-metric-source-not-closed",
      ready: false,
      selectionAllowed: false,
    });
    expect(isDeepFrozen(CANONICAL_RUN_FIRST_ROOM_METRIC_PROJECTION_MISSING)).toBe(true);
  });
});
