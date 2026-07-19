import {beforeAll, describe, expect, it} from "vitest";

import {V4_CONTENT_IDENTITY} from "../content/v4-content-identity";
import {
  CANONICAL_RUN_FIRST_ROOM_METRIC_IDS,
  type CanonicalRunFirstRoomMetricProjectionPayload,
  type CanonicalRunFirstRoomMetricProjectionReceipt,
} from "./run-metric-projection";
import {
  CANONICAL_RUN_FIRST_CONTINUATION_ROOM_TARGET_MISSING,
  assertCanonicalRunFirstContinuationRoomTransitionReceiptOwner,
  cancelCanonicalRunFirstContinuationRoomTransitionReceipt,
  commitCanonicalRunFirstContinuationRoomTransitionReceipt,
  createCanonicalRunFirstContinuationRoomTarget,
  deriveCanonicalRunFirstContinuationRoomTargetUnbranded,
  firstContinuationRoomTargetFromCanonicalTransitionReceipt,
  issueCanonicalRunFirstContinuationRoomTransitionReceipt,
  quarantineCanonicalRunFirstContinuationRoomTransitionReceipt,
  type CanonicalRunFirstContinuationCandidateWeight,
  type CanonicalRunFirstContinuationRoomTargetAvailable,
  type CanonicalRunFirstContinuationRoomTransitionReceipt,
} from "./run-first-continuation-room-target";
import type {CanonicalRunCombatState} from "./combat-kernel";
import {executablePattern} from "./pattern-executor";
import {RUN_ROOM_SESSION_CONTRACT} from "./run-room-session";
import {
  CanonicalRunSession,
  type CanonicalRunSessionSnapshot,
  type CanonicalRunSessionStepInput,
} from "./run-session";

const PRE_ROOM_TICK120 = 100;
const CLOSURE_TICK120 = 1802;

// The first seed makes Mulberry32's state wrap to zero and therefore exercises
// the exact weighted-selection boundary where cursorInitial is zero.
const FORMAL_TARGET_SEEDS = Object.freeze([0x92d4_860b, 1, 2] as const);

interface FormalTargetFixture {
  readonly formal: CanonicalRunFirstContinuationRoomTargetAvailable;
  readonly publicSnapshot: CanonicalRunFirstContinuationRoomTargetAvailable;
  readonly runCombatOwner: CanonicalRunCombatState;
}

let formalTargetFixtures: readonly FormalTargetFixture[] = [];

const MISSING_REASONS = Object.freeze({
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

function projectionFixture(rawRunSeed: number): CanonicalRunFirstRoomMetricProjectionPayload {
  const resolvedSeed = (
    rawRunSeed
    ^ executablePattern(RUN_ROOM_SESSION_CONTRACT.patternId).seed.base
    ^ RUN_ROOM_SESSION_CONTRACT.encounterOrdinal
    ^ RUN_ROOM_SESSION_CONTRACT.difficultySalt
  ) >>> 0;
  const metricEntries = CANONICAL_RUN_FIRST_ROOM_METRIC_IDS.map((id) => {
    if (id === "avgFlower") {
      return {
        id,
        availability: "available" as const,
        value: 900.5 / 1802,
        unit: "ratio-0-1" as const,
        formulaId: "committed-flower-target-mean-v1" as const,
        numerator: {
          sourcePath: "behaviorFacts.committed.flower.aggregate.targetIntensitySum",
          value: 900.5,
        },
        denominator: {
          sourcePath: "behaviorFacts.committed.flower.sampleCount",
          value: 1802,
        },
        sampleWindow: {firstTick120: 1, lastTick120: CLOSURE_TICK120},
      };
    }
    if (id === "gazeRatio") {
      return {
        id,
        availability: "available" as const,
        value: 10 / 1792,
        unit: "ratio-0-1" as const,
        formulaId: "committed-gaze-clamped-state-ratio-v1" as const,
        numerator: {
          sourcePath: "behaviorFacts.committed.gaze.aggregate.stateTickCounts[clamped].ticks120",
          value: 10,
        },
        denominator: {
          sourcePath: "behaviorFacts.committed.gaze.sampleCount",
          value: 1792,
        },
        sampleWindow: {firstTick120: 11, lastTick120: CLOSURE_TICK120},
      };
    }
    if (id === "recentInputDensity") {
      return {
        id,
        availability: "available" as const,
        value: 200 / 1702,
        unit: "ratio-0-1" as const,
        formulaId: "first-room-active-input-union-ratio-v1" as const,
        numerator: {sourcePath: "metricSupplement.activeUnionTickCount", value: 200},
        denominator: {sourcePath: "metricSupplement.roomTickCount", value: 1702},
        sampleWindow: {firstTick120: PRE_ROOM_TICK120 + 1, lastTick120: CLOSURE_TICK120},
      };
    }
    return {
      id,
      availability: "missing" as const,
      reason: MISSING_REASONS[id],
    };
  });
  return deepFreeze({
    availability: "available" as const,
    authority: "canonical-run-first-room-metric-projection-v1" as const,
    schemaVersion: "1.1.0-ext-2026-011" as const,
    producerId: "canonical-run-session.first-room-metric-projector" as const,
    producerVersion: "1.1.0" as const,
    extensionPolicy: "EXT-2026-011" as const,
    sourceEpoch: "current-run-through-first-room-closure" as const,
    capturedAtTick120: CLOSURE_TICK120,
    rawRunSeed: {domain: "raw-run-seed" as const, value: rawRunSeed},
    contentIdentity: V4_CONTENT_IDENTITY,
    sourceBoundary: {
      preRoomTick120: PRE_ROOM_TICK120,
      firstOccurrenceObservationTick120: CLOSURE_TICK120 - 1,
      roomClosureTick120: CLOSURE_TICK120,
      roomId: RUN_ROOM_SESSION_CONTRACT.roomId,
      roomOrdinal: RUN_ROOM_SESSION_CONTRACT.roomOrdinal,
      patternId: RUN_ROOM_SESSION_CONTRACT.patternId,
      occurrenceId: RUN_ROOM_SESSION_CONTRACT.occurrenceId,
      encounterOrdinal: RUN_ROOM_SESSION_CONTRACT.encounterOrdinal,
      resolvedSeed: {domain: "resolved-occurrence-seed" as const, value: resolvedSeed},
    },
    projectionStatus: "partial" as const,
    availableMetricCount: 3 as const,
    missingMetricCount: 11 as const,
    metricEntries,
    ready: false as const,
    selectionAllowed: false as const,
    selectionRngDraws: 0 as const,
    canonicalEventWrites: 0 as const,
    targetRoom: null,
    transitionAllowed: false as const,
  });
}

function hostileFixture(
  mutate: (draft: Record<string, any>) => void,
  freeze = true,
): CanonicalRunFirstRoomMetricProjectionPayload {
  const draft = JSON.parse(JSON.stringify(projectionFixture(1))) as Record<string, any>;
  mutate(draft);
  return (freeze ? deepFreeze(draft) : draft) as CanonicalRunFirstRoomMetricProjectionPayload;
}

function candidate(
  candidates: readonly CanonicalRunFirstContinuationCandidateWeight[],
  roomId: CanonicalRunFirstContinuationCandidateWeight["roomId"],
): CanonicalRunFirstContinuationCandidateWeight {
  const result = candidates.find((entry) => entry.roomId === roomId);
  if (result === undefined) throw new Error(`fixture lost ${roomId}`);
  return result;
}

function neutralRunInput(tick120: number): CanonicalRunSessionStepInput {
  return {
    tick120,
    movement: {x: 0, y: 0},
    signalActive: false,
    focused: false,
    gaze: {skyEyeVisible: true, pitchDegrees: 0, alignment: 0},
  };
}

function prologueRunInput(tick120: number): CanonicalRunSessionStepInput {
  return {...neutralRunInput(tick120), signalActive: tick120 === 1 || tick120 === 3};
}

function qualifiedGazeRunInput(tick120: number): CanonicalRunSessionStepInput {
  return {
    ...neutralRunInput(tick120),
    gaze: {skyEyeVisible: true, pitchDegrees: 60, alignment: 1},
  };
}

function reachFormalTarget(rawRunSeed: number): FormalTargetFixture {
  const session = new CanonicalRunSession({
    rawRunSeed: {domain: "raw-run-seed", value: rawRunSeed},
    grazeRadiusPx: 18,
    projectileDamage: 1,
    projectilePoolClasses: {"bullet.micro.notch_e": "micro"},
  });
  let snapshot: CanonicalRunSessionSnapshot = session.snapshot();
  while (snapshot.tick120 < 960) {
    snapshot = session.step(prologueRunInput(snapshot.tick120 + 1));
  }
  while (snapshot.tick120 < 1021) {
    snapshot = session.step(qualifiedGazeRunInput(snapshot.tick120 + 1));
  }
  while (snapshot.phase !== "room_sampling" && snapshot.tick120 < 3360) {
    snapshot = session.step(neutralRunInput(snapshot.tick120 + 1));
  }
  const handoffTick120 = snapshot.handoff.atTick120;
  if (snapshot.phase !== "room_sampling" || handoffTick120 === null) {
    throw new Error("formal target fixture did not reach first room");
  }
  while (snapshot.tick120 < handoffTick120 + 1702) {
    snapshot = session.step(neutralRunInput(snapshot.tick120 + 1));
  }
  const publicSnapshot = snapshot.firstContinuationRoomTarget;
  if (publicSnapshot.availability !== "available") {
    throw new Error("formal target fixture did not reach target selection");
  }
  const internals = session as unknown as Readonly<{
    combatState: CanonicalRunCombatState | null;
    firstContinuationRoomTargetValue: CanonicalRunFirstContinuationRoomTargetAvailable | null;
  }>;
  const formal = internals.firstContinuationRoomTargetValue;
  if (
    formal === null
    || formal.availability !== "available"
    || internals.combatState === null
  ) {
    throw new Error("formal target fixture lost its internal target");
  }
  return Object.freeze({
    formal,
    publicSnapshot,
    runCombatOwner: internals.combatState,
  });
}

beforeAll(() => {
  formalTargetFixtures = Object.freeze(FORMAL_TARGET_SEEDS.map(reachFormalTarget));
}, 30_000);

describe("EXT-2026-012 first continuation room target", () => {
  it("keeps typed absence while applying only available V4 bias in stable order", () => {
    const source = projectionFixture(1);
    const target = deriveCanonicalRunFirstContinuationRoomTargetUnbranded(source);
    const avgFlower = 900.5 / 1802;
    const gazeRatio = 10 / 1792;
    const recentInputDensity = 200 / 1702;

    expect(Object.keys(target).sort()).toEqual([
      "availability",
      "authority",
      "schemaVersion",
      "producerId",
      "producerVersion",
      "extensionPolicy",
      "sourceEpoch",
      "selectedAtTick120",
      "rawRunSeed",
      "contentIdentity",
      "sourceBoundary",
      "sourceProjection",
      "completedRoomVisit",
      "candidateOrder",
      "candidateWeights",
      "candidateTotalWeight",
      "rng",
      "selectionComplete",
      "selectionRngDraws",
      "canonicalEventWrites",
      "targetRoom",
      "targetRoomOrdinal",
      "roomCount",
      "difficulty",
      "transitionAllowed",
      "handoffReady",
    ].sort());
    expect(target).toMatchObject({
      availability: "available",
      authority: "canonical-run-first-continuation-room-target-v1",
      schemaVersion: "1.0.0-ext-2026-012",
      producerId: "canonical-run-session.first-continuation-room-selector",
      producerVersion: "1.0.0",
      extensionPolicy: "EXT-2026-012",
      sourceEpoch: "current-run-through-first-room-closure",
      selectedAtTick120: CLOSURE_TICK120,
      completedRoomVisit: {roomId: "FORCED_ALIGNMENT", roomOrdinal: 0},
      candidateOrder: ["INFORMATION", "IN_BETWEEN", "POLARIZED"],
      selectionComplete: true,
      selectionRngDraws: 1,
      canonicalEventWrites: 0,
      targetRoom: "IN_BETWEEN",
      targetRoomOrdinal: 1,
      roomCount: null,
      difficulty: null,
      transitionAllowed: false,
      handoffReady: false,
    });

    const information = candidate(target.candidateWeights, "INFORMATION");
    expect(information.metricTerms.map((term) => term.id)).toEqual([
      "avgFlower",
      "gazeRatio",
      "recentInputDensity",
      "unansweredActions",
    ]);
    const informationBehaviorBias = avgFlower * 0.3
      + gazeRatio * 0.18
      + recentInputDensity * 0.34;
    expect(information.totalWeight).toBe(1 + informationBehaviorBias);
    const inBetween = candidate(target.candidateWeights, "IN_BETWEEN");
    expect(inBetween.metricTerms.map((term) => term.id)).toEqual([
      "contextSwitches",
      "correctionLatency",
      "gazeRatio",
      "intersectionHold",
    ]);
    expect(inBetween.totalWeight).toBe(1 + gazeRatio * 0.22);
    const polarized = candidate(target.candidateWeights, "POLARIZED");
    expect(polarized.metricTerms.map((term) => term.id)).toEqual([
      "binarySwitches",
      "highLightRatio",
      "noDuskTicks",
      "overrideRatio",
    ]);
    expect(polarized.totalWeight).toBe(1);

    const missingTerms = target.candidateWeights.flatMap((entry) => entry.metricTerms)
      .filter((term) => term.availability === "missing");
    expect(missingTerms.length).toBeGreaterThan(0);
    for (const term of missingTerms) {
      expect(Object.keys(term).sort()).toEqual(["authoredWeight", "availability", "id", "reason"]);
      expect("value" in term).toBe(false);
      expect("contribution" in term).toBe(false);
    }
    expect("metrics" in target).toBe(false);
    expect(isDeepFrozen(target)).toBe(true);
    expect(JSON.stringify(deriveCanonicalRunFirstContinuationRoomTargetUnbranded(source)))
      .toBe(JSON.stringify(target));
  });

  it.each([
    [0, "INFORMATION", 0.26642920868471265, 1_831_565_813],
    [1, "IN_BETWEEN", 0.6270739405881613, 1_831_565_814],
    [2, "POLARIZED", 0.7342509443406016, 1_831_565_815],
  ] as const)("keeps every remaining room reachable for seed %i", (seed, roomId, drawValue, state) => {
    const target = deriveCanonicalRunFirstContinuationRoomTargetUnbranded(projectionFixture(seed));
    expect(target.targetRoom).toBe(roomId);
    expect(target.rng).toMatchObject({
      algorithm: "mulberry32-v1",
      seed: {domain: "ext-012-first-continuation-room-selection", value: seed},
      drawOrdinal: 0,
      drawValue,
      stateAfterDrawUint32: state,
    });
    expect(target.rng.cursorInitial).toBe(drawValue * target.candidateTotalWeight);
  });

  it.each([
    ["mutable source", (draft: Record<string, any>) => draft, false, /recursively frozen/],
    ["extra root field", (draft: Record<string, any>) => { draft.metrics = {}; }, true, /exact schema fields/],
    ["wrong content", (draft: Record<string, any>) => {
      draft.contentIdentity.contentDigestSha256 = "0".repeat(64);
    }, true, /content identity/],
    ["wrong completed room", (draft: Record<string, any>) => {
      draft.sourceBoundary.roomId = "INFORMATION";
    }, true, /completed fixed first room/],
    ["wrong resolved seed", (draft: Record<string, any>) => {
      draft.sourceBoundary.resolvedSeed.value ^= 1;
    }, true, /resolved seed provenance/],
    ["metric order drift", (draft: Record<string, any>) => {
      [draft.metricEntries[0], draft.metricEntries[1]] = [draft.metricEntries[1], draft.metricEntries[0]];
    }, true, /order\/ID drifted/],
    ["numeric missing", (draft: Record<string, any>) => {
      const missing = draft.metricEntries.find((entry: Record<string, unknown>) => entry.availability === "missing");
      missing.value = 0;
    }, true, /exact schema fields/],
    ["out-of-range available", (draft: Record<string, any>) => {
      const available = draft.metricEntries.find((entry: Record<string, unknown>) => entry.availability === "available");
      available.value = 2;
      available.numerator.value = available.denominator.value * 2;
    }, true, /inside \[0,1\]/],
    ["available formula drift", (draft: Record<string, any>) => {
      const available = draft.metricEntries.find((entry: Record<string, unknown>) => entry.availability === "available");
      available.formulaId = "caller-formula";
    }, true, /formulaId drifted/],
  ] as const)("fails closed on %s", (_label, mutate, freeze, error) => {
    expect(() => deriveCanonicalRunFirstContinuationRoomTargetUnbranded(
      hostileFixture(mutate, freeze),
    )).toThrow(error);
  });

  it("rejects a forged formal receipt and exposes an exact pre-source sentinel", () => {
    expect(() => createCanonicalRunFirstContinuationRoomTarget(
      Object.freeze({}) as CanonicalRunFirstRoomMetricProjectionReceipt,
      Object.freeze({}),
    )).toThrow(/receipt is not registered/);
    expect(CANONICAL_RUN_FIRST_CONTINUATION_ROOM_TARGET_MISSING).toEqual({
      availability: "missing",
      reason: "first-room-metric-projection-not-available",
      selectionComplete: false,
      selectionRngDraws: 0,
      transitionAllowed: false,
      handoffReady: false,
    });
    expect(Object.isFrozen(CANONICAL_RUN_FIRST_CONTINUATION_ROOM_TARGET_MISSING)).toBe(true);
  });

  it("reserves every legal formal target without consuming it, rejects concurrency, and commits once", () => {
    expect(formalTargetFixtures.map(({formal}) => formal.targetRoom)).toEqual([
      "INFORMATION",
      "IN_BETWEEN",
      "POLARIZED",
    ]);
    formalTargetFixtures.forEach(({formal, runCombatOwner}, index) => {
      const first = issueCanonicalRunFirstContinuationRoomTransitionReceipt(formal);
      expect(Object.isFrozen(first)).toBe(true);
      expect(Reflect.ownKeys(first)).toEqual([]);
      expect(firstContinuationRoomTargetFromCanonicalTransitionReceipt(first)).toBe(formal);
      expect(() => assertCanonicalRunFirstContinuationRoomTransitionReceiptOwner(
        first,
        runCombatOwner,
      )).not.toThrow();
      expect(() => assertCanonicalRunFirstContinuationRoomTransitionReceiptOwner(
        first,
        Object.freeze({}),
      )).toThrow(/different Run combat authority/);
      expect(() => issueCanonicalRunFirstContinuationRoomTransitionReceipt(formal))
        .toThrow(/in-flight transition receipt/);

      cancelCanonicalRunFirstContinuationRoomTransitionReceipt(first);
      expect(() => firstContinuationRoomTargetFromCanonicalTransitionReceipt(first))
        .toThrow(/already cancelled/);
      expect(() => commitCanonicalRunFirstContinuationRoomTransitionReceipt(first))
        .toThrow(/already cancelled/);

      if (index < 2) {
        const retry = issueCanonicalRunFirstContinuationRoomTransitionReceipt(formal);
        expect(commitCanonicalRunFirstContinuationRoomTransitionReceipt(retry)).toBe(formal);
        expect(() => firstContinuationRoomTargetFromCanonicalTransitionReceipt(retry))
          .toThrow(/already committed/);
        expect(() => commitCanonicalRunFirstContinuationRoomTransitionReceipt(retry))
          .toThrow(/already committed/);
        expect(() => issueCanonicalRunFirstContinuationRoomTransitionReceipt(formal))
          .toThrow(/already committed/);
      }
    });
  });

  it("rejects public clones, JSON copies, unbranded derivations, and fake receipts", () => {
    const fixture = formalTargetFixtures[2];
    if (fixture === undefined) throw new Error("POLARIZED formal target fixture is missing");
    const {formal, publicSnapshot} = fixture;
    const jsonClone = deepFreeze(
      JSON.parse(JSON.stringify(formal)),
    ) as CanonicalRunFirstContinuationRoomTargetAvailable;
    const unbranded = deriveCanonicalRunFirstContinuationRoomTargetUnbranded(projectionFixture(2));
    for (const impostor of [publicSnapshot, jsonClone, unbranded]) {
      expect(() => issueCanonicalRunFirstContinuationRoomTransitionReceipt(
        impostor as CanonicalRunFirstContinuationRoomTargetAvailable,
      )).toThrow(/original formal target/);
    }

    const fake = Object.freeze({}) as CanonicalRunFirstContinuationRoomTransitionReceipt;
    expect(() => firstContinuationRoomTargetFromCanonicalTransitionReceipt(fake))
      .toThrow(/not registered/);
    expect(() => commitCanonicalRunFirstContinuationRoomTransitionReceipt(fake))
      .toThrow(/not registered/);
    expect(() => cancelCanonicalRunFirstContinuationRoomTransitionReceipt(fake))
      .toThrow(/not registered/);
    expect(() => quarantineCanonicalRunFirstContinuationRoomTransitionReceipt(fake))
      .toThrow(/not registered/);
  });

  it("quarantines an impossible post-append failure without making the target reusable", () => {
    const fixture = formalTargetFixtures[2];
    if (fixture === undefined) throw new Error("POLARIZED formal target fixture is missing");
    const {formal} = fixture;
    const receipt = issueCanonicalRunFirstContinuationRoomTransitionReceipt(formal);
    quarantineCanonicalRunFirstContinuationRoomTransitionReceipt(receipt);
    expect(() => firstContinuationRoomTargetFromCanonicalTransitionReceipt(receipt))
      .toThrow(/already quarantined/);
    expect(() => cancelCanonicalRunFirstContinuationRoomTransitionReceipt(receipt))
      .toThrow(/already quarantined/);
    expect(() => issueCanonicalRunFirstContinuationRoomTransitionReceipt(formal))
      .toThrow(/quarantined/);
  });
});
