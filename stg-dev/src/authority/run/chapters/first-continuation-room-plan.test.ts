import {describe, expect, it} from "vitest";

import {V4_CONTENT_IDENTITY} from "../../../content/v4-content-identity";
import {
  CANONICAL_RUN_FIRST_CONTINUATION_ROOM_PLAN_CONTRACT,
  deriveCanonicalRunFirstContinuationRoomPlanUnbranded,
  type CanonicalRunFirstContinuationRoomPlanSourceView,
} from "./first-continuation-room-plan";

const MULBERRY32_INCREMENT = 0x6d2b_79f5;
const HANDOFF_TICK120 = 4_000;

const EXPECTED_POOLS = Object.freeze({
  INFORMATION: Object.freeze([
    "room.information.stale_packet_retry",
    "room.information.unanswered_fan",
    "room.information.notification_overflow",
    "room.information.missing_ack",
  ]),
  IN_BETWEEN: Object.freeze([
    "room.in_between.context_switch",
    "room.in_between.stable_intersection",
    "room.in_between.misregistration_corridor",
    "room.in_between.borrowed_rule",
  ]),
  POLARIZED: Object.freeze([
    "room.polarized.clock_decree",
    "room.polarized.hard_cut_corridor",
    "room.polarized.alternating_verdict",
    "room.polarized.no_dusk_grid",
  ]),
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

function mulberry32DrawFromState(stateBeforeDrawUint32: number): Readonly<{
  readonly value: number;
  readonly stateAfterDrawUint32: number;
}> {
  const stateAfterDrawUint32 = (stateBeforeDrawUint32 + MULBERRY32_INCREMENT) >>> 0;
  let value = stateAfterDrawUint32;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return Object.freeze({
    value: ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296,
    stateAfterDrawUint32,
  });
}

function sourceFixture(
  roomId: CanonicalRunFirstContinuationRoomPlanSourceView["target"]["roomId"] = "INFORMATION",
  rawRunSeed = 2,
  avgFlower = 0.28,
  gazeRatio = 0.28,
): CanonicalRunFirstContinuationRoomPlanSourceView {
  const targetDraw = mulberry32DrawFromState(rawRunSeed);
  return deepFreeze({
    authority: "canonical-run-first-continuation-room-plan-source-v1" as const,
    schemaVersion: "1.0.0-ext-2026-015" as const,
    extensionPolicy: "EXT-2026-015" as const,
    contentIdentity: V4_CONTENT_IDENTITY,
    target: {
      authority: "canonical-run-first-continuation-room-target-v1" as const,
      extensionPolicy: "EXT-2026-012" as const,
      roomId,
      roomOrdinal: 1 as const,
    },
    rawRunSeed: {domain: "raw-run-seed" as const, value: rawRunSeed},
    targetSelectionRng: {
      algorithm: "mulberry32-v1" as const,
      domain: "ext-012-first-continuation-room-selection" as const,
      drawOrdinal: 0 as const,
      drawValue: targetDraw.value,
      stateAfterDrawUint32: targetDraw.stateAfterDrawUint32,
      selectionRngDraws: 1 as const,
    },
    handoff: {
      authority: "canonical-run-first-continuation-room-handoff-v1" as const,
      extensionPolicy: "EXT-2026-013" as const,
      targetRoom: roomId,
      atTick120: HANDOFF_TICK120,
      nextRoomAdmission: "withheld-pending-room-plan-and-combined-pool-budget" as const,
    },
    intensityMetrics: {
      avgFlower: {availability: "available" as const, value: avgFlower, unit: "ratio-0-1" as const},
      gazeRatio: {availability: "available" as const, value: gazeRatio, unit: "ratio-0-1" as const},
      overrideRatio: {
        availability: "missing" as const,
        reason: "override-not-eligible-in-source-window" as const,
      },
    },
    priorEncounter: {
      roomId: "FORCED_ALIGNMENT" as const,
      roomOrdinal: 0 as const,
      encounterOrdinal: 0 as const,
      patternId: "room.forced.left_right_gate" as const,
    },
    materialPoolSummary: {
      authority: "room-threshold-material-carryover-v1" as const,
      sourcePatternId: "transition.room_threshold" as const,
      sourceOccurrenceId: "run:room:0-to-1:transition:transition.room_threshold" as const,
      detachedAtTick120: HANDOFF_TICK120 - 7,
      observedAtTick120: HANDOFF_TICK120,
      materialCount: 12,
      drained: false,
      activeSlots: {micro: 12, medium: 0, heavy: 0, splitChildren: 0},
      allocatedSlots: {micro: 20, medium: 0, heavy: 0, splitChildren: 0},
      liveColliders: 0 as const,
      residueVisuals: 12,
    },
  });
}

function hostileFixture(
  mutate: (draft: Record<string, any>) => void,
  freeze = true,
): CanonicalRunFirstContinuationRoomPlanSourceView {
  const draft = JSON.parse(JSON.stringify(sourceFixture())) as Record<string, any>;
  mutate(draft);
  return (freeze ? deepFreeze(draft) : draft) as CanonicalRunFirstContinuationRoomPlanSourceView;
}

describe("EXT-2026-015 first continuation room pure plan", () => {
  it.each([
    ["INFORMATION", "room.information.unanswered_fan"],
    ["IN_BETWEEN", "room.in_between.stable_intersection"],
    ["POLARIZED", "room.polarized.hard_cut_corridor"],
  ] as const)("keeps the complete %s composer pool in declaration order", (roomId, selectedPatternId) => {
    const plan = deriveCanonicalRunFirstContinuationRoomPlanUnbranded(sourceFixture(roomId, 2));

    expect(plan.targetRoom).toBe(roomId);
    expect(plan.selection.candidateOrder).toEqual(EXPECTED_POOLS[roomId]);
    expect(plan.selection.candidates).toHaveLength(4);
    expect(plan.selection.candidates.map((candidate) => candidate.baseWeight)).toEqual([1, 1.08, 1.16, 1.24]);
    expect(plan.selection.candidates.every((candidate) => (
      /^[0-9a-f]{64}$/.test(candidate.structuralSignatureSha256)
      && candidate.sameAsPreviousStructuralSignature === false
      && candidate.structuralSignaturePenalty === 1
      && candidate.effectiveWeight === candidate.baseWeight
    ))).toBe(true);
    expect(plan.selection.selectedPatternId).toBe(selectedPatternId);
    expect(plan.selection.capabilityFilteringApplied).toBe(false);
    expect(plan.selection.rerollCount).toBe(0);
  });

  it.each([
    [0.279_999, "listen", "EASY", 80, 2, 1600],
    [0.28, "read", "NORMAL", 150, 3, 1100],
    [0.579_999, "read", "NORMAL", 150, 3, 1100],
    [0.58, "enforce", "HARD", 240, 4, 820],
  ] as const)("applies the exact V4 intensity boundary at %s", (
    metric,
    tierId,
    difficulty,
    maxProjectiles,
    maxEmitters,
    restMs,
  ) => {
    const plan = deriveCanonicalRunFirstContinuationRoomPlanUnbranded(
      sourceFixture("INFORMATION", 2, metric, metric),
    );
    expect(plan.intensity).toMatchObject({
      avgFlower: metric,
      gazeRatio: metric,
      score: metric,
      tierId,
      difficulty,
      budget: {maxProjectiles, maxEmitters, restMs},
      overrideRatio: {
        sourceAvailability: "missing",
        missingReason: "override-not-eligible-in-source-window",
        policy: "authored-fallback-not-observed",
        value: 0,
      },
    });
  });

  it("continues EXT-012 at draw 1 and derives the exact occurrence, seed and segments", () => {
    const source = sourceFixture("INFORMATION", 2);
    const plan = deriveCanonicalRunFirstContinuationRoomPlanUnbranded(source);

    expect(CANONICAL_RUN_FIRST_CONTINUATION_ROOM_PLAN_CONTRACT).toMatchObject({
      targetRoomOrdinal: 1,
      encounterOrdinal: 0,
      difficultySalt: 0x2200,
      targetSelectionDrawOrdinal: 0,
      patternSelectionDrawOrdinal: 1,
      selectionRngDrawsTotal: 2,
      parallel: "none",
      canonicalEventWrites: 0,
      authorityMutations: 0,
    });
    expect(plan.selection.rng).toEqual({
      algorithm: "mulberry32-v1",
      domain: "ext-012-first-continuation-room-selection",
      continuedFromStateAfterDrawUint32: 1_831_565_815,
      drawOrdinal: 1,
      drawValue: 0.32499843230471015,
      stateAfterDrawUint32: 3_663_131_628,
      cursorInitial: 0.32499843230471015 * 4.48,
      selectionRngDrawsTotal: 2,
    });
    expect(plan.occurrence).toEqual({
      occurrenceId: "run:room:1:encounter:0:room.information.unanswered_fan",
      patternId: "room.information.unanswered_fan",
      roomId: "INFORMATION",
      roomOrdinal: 1,
      encounterOrdinal: 0,
      difficulty: "NORMAL",
      difficultySalt: 0x2200,
      resolvedSeed: {
        domain: "resolved-occurrence-seed",
        composition: "rawRunSeed xor pattern.base xor encounterOrdinal xor difficultySalt",
        value: 1_444_524_168,
      },
      segmentsMs: {
        telegraph: 520,
        entry: 800,
        read: 10_400,
        materialSettle: 900,
        rest: 1100,
        safeGapHandoff: 520,
      },
      parallel: {mode: "none", patternId: null},
    });
    expect(plan.plannedAtTick120).toBe(HANDOFF_TICK120);
    expect(plan.canonicalEventWrites).toBe(0);
    expect(plan.authorityMutations).toBe(0);
  });

  it.each([
    ["IN_BETWEEN", "room.in_between.borrowed_rule"],
    ["POLARIZED", "room.polarized.no_dusk_grid"],
  ] as const)("retains an unsupported %s selection without filtering or reroll", (roomId, patternId) => {
    const plan = deriveCanonicalRunFirstContinuationRoomPlanUnbranded(sourceFixture(roomId, 5));

    expect(plan.selection.selectedPatternId).toBe(patternId);
    expect(plan.selection.candidateOrder).toEqual(EXPECTED_POOLS[roomId]);
    expect(plan.patternCapability).toEqual({
      patternId,
      source: "SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS",
      status: "unsupported",
    });
    expect(plan.poolReservationRequest).toMatchObject({
      state: "withheld-unsupported-pattern-capability",
      successor: {patternId},
      combinedAdmissionEvaluated: false,
      reservationCommitted: false,
    });
    expect(plan.selection.rerollCount).toBe(0);
    expect(plan.selection.capabilityFilteringApplied).toBe(false);
  });

  it("admits the selected Misregistration capability without filtering or reroll", () => {
    const plan = deriveCanonicalRunFirstContinuationRoomPlanUnbranded(
      sourceFixture("IN_BETWEEN", 8),
    );

    expect(plan.selection.selectedPatternId).toBe("room.in_between.misregistration_corridor");
    expect(plan.patternCapability).toEqual({
      patternId: "room.in_between.misregistration_corridor",
      source: "SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS",
      status: "supported",
    });
    expect(plan.poolReservationRequest).toMatchObject({
      state: "withheld-pending-combined-pool-admission",
      successor: {
        patternId: "room.in_between.misregistration_corridor",
        projectileArchetypeId: "bullet.micro.notch_e",
        emitterCount: 2,
      },
      combinedAdmissionEvaluated: false,
      reservationCommitted: false,
    });
    expect(plan.selection.rerollCount).toBe(0);
    expect(plan.selection.capabilityFilteringApplied).toBe(false);
  });

  it("withholds missing_ack for its independently parsed split-child upper-bound gap", () => {
    const plan = deriveCanonicalRunFirstContinuationRoomPlanUnbranded(
      sourceFixture("INFORMATION", 5),
    );

    expect(plan.selection.selectedPatternId).toBe("room.information.missing_ack");
    expect(plan.selection.candidateOrder).toEqual(EXPECTED_POOLS.INFORMATION);
    expect(plan.selection.rerollCount).toBe(0);
    expect(plan.selection.capabilityFilteringApplied).toBe(false);
    expect(plan.patternCapability).toMatchObject({
      patternId: "room.information.missing_ack",
      source: "SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS",
    });
    expect(plan.poolReservationRequest).toMatchObject({
      state: "withheld-missing-split-child-upper-bound",
      successor: {
        patternId: "room.information.missing_ack",
        splitChildren: {
          requiresSplitChildren: true,
          upperBound: null,
          status: "missing",
        },
      },
      combinedAdmissionEvaluated: false,
      reservationCommitted: false,
    });
  });

  it("emits a request, not combined admission, while preserving the exact material summary", () => {
    const source = sourceFixture("INFORMATION", 0, 0.27, 0.27);
    const plan = deriveCanonicalRunFirstContinuationRoomPlanUnbranded(source);

    expect(plan.patternCapability.status).toBe("supported");
    expect(plan.poolReservationRequest).toEqual({
      state: "withheld-pending-combined-pool-admission",
      carryover: source.materialPoolSummary,
      successor: {
        patternId: "room.information.stale_packet_retry",
        projectileArchetypeId: "bullet.micro.notch_e",
        requestedProjectileSlots: 80,
        requestedResidueVisualSlots: 80,
        emitterCount: 1,
        maxEmitters: 2,
        poolClassResolution: "required-at-combined-admission",
        splitChildren: {
          requiresSplitChildren: false,
          upperBound: 0,
          status: "not-required",
        },
      },
      combinedAdmissionEvaluated: false,
      reservationCommitted: false,
    });
    expect("poolClass" in plan.poolReservationRequest.successor).toBe(false);
    expect("admitted" in plan).toBe(false);
  });

  it("is clone-safe plain data but requires an exact recursively frozen schema", () => {
    const source = sourceFixture("IN_BETWEEN", 8, 0.58, 0.58);
    const plan = deriveCanonicalRunFirstContinuationRoomPlanUnbranded(source);
    const clone = deepFreeze(JSON.parse(JSON.stringify(source))) as CanonicalRunFirstContinuationRoomPlanSourceView;
    const clonePlan = deriveCanonicalRunFirstContinuationRoomPlanUnbranded(clone);

    expect(clonePlan).toEqual(plan);
    expect(JSON.stringify(clonePlan)).toBe(JSON.stringify(plan));
    expect(isDeepFrozen(plan)).toBe(true);
    expect(Object.getOwnPropertySymbols(plan)).toHaveLength(0);
    expect(Object.keys(plan).sort()).toEqual([
      "availability",
      "authority",
      "schemaVersion",
      "extensionPolicy",
      "contentIdentity",
      "plannedAtTick120",
      "targetRoom",
      "roomOrdinal",
      "intensity",
      "selection",
      "occurrence",
      "patternCapability",
      "poolReservationRequest",
      "canonicalEventWrites",
      "authorityMutations",
    ].sort());
    expect(() => deriveCanonicalRunFirstContinuationRoomPlanUnbranded(
      hostileFixture(() => {}, false),
    )).toThrow(/recursively frozen/);
    expect(() => deriveCanonicalRunFirstContinuationRoomPlanUnbranded(
      hostileFixture((draft) => { draft.receipt = {}; }),
    )).toThrow(/exact schema fields/);
  });

  it.each([
    ["content identity", (draft: Record<string, any>) => { draft.contentIdentity.contentDigestSha256 = "0".repeat(64); }, /contentIdentity.*drifted/],
    ["target mismatch", (draft: Record<string, any>) => { draft.handoff.targetRoom = "POLARIZED"; }, /exact target/],
    ["draw state", (draft: Record<string, any>) => { draft.targetSelectionRng.stateAfterDrawUint32 += 1; }, /draw\/state/],
    ["fabricated override", (draft: Record<string, any>) => {
      draft.intensityMetrics.overrideRatio = {availability: "available", value: 0};
    }, /exact schema fields|typed absence/],
    ["missing avgFlower", (draft: Record<string, any>) => {
      draft.intensityMetrics.avgFlower = {availability: "missing", reason: "not-observed"};
    }, /exact schema fields|must remain available/],
    ["wrong prior pattern", (draft: Record<string, any>) => { draft.priorEncounter.patternId = "room.forced.ballot_shift"; }, /Left\/Right/],
    ["stale material summary", (draft: Record<string, any>) => { draft.materialPoolSummary.observedAtTick120 -= 1; }, /stale or ahead/],
    ["live collider", (draft: Record<string, any>) => { draft.materialPoolSummary.liveColliders = 1; }, /collisionless exact carryover/],
    ["active beyond allocated", (draft: Record<string, any>) => { draft.materialPoolSummary.allocatedSlots.micro = 11; }, /exceeds allocated/],
    ["material count mismatch", (draft: Record<string, any>) => { draft.materialPoolSummary.materialCount = 11; }, /collisionless exact carryover/],
    ["pool budget overflow", (draft: Record<string, any>) => { draft.materialPoolSummary.allocatedSlots.micro = 2049; }, /exceeds V4 pool budget/],
    ["extra nested field", (draft: Record<string, any>) => { draft.target.selectedPatternId = "room.information.stale_packet_retry"; }, /exact schema fields/],
  ] as const)("rejects hostile %s input", (_label, mutate, expected) => {
    expect(() => deriveCanonicalRunFirstContinuationRoomPlanUnbranded(
      hostileFixture(mutate),
    )).toThrow(expected);
  });

  it("rejects non-finite data, symbol capabilities, accessors and cycles", () => {
    const nonFinite = JSON.parse(JSON.stringify(sourceFixture())) as Record<string, any>;
    nonFinite.intensityMetrics.avgFlower.value = Number.NaN;
    expect(() => deriveCanonicalRunFirstContinuationRoomPlanUnbranded(
      deepFreeze(nonFinite) as CanonicalRunFirstContinuationRoomPlanSourceView,
    )).toThrow(/finite/);

    const withSymbol = JSON.parse(JSON.stringify(sourceFixture())) as Record<string, any>;
    Object.defineProperty(withSymbol, Symbol("authority-capability"), {value: {}, enumerable: true});
    deepFreeze(withSymbol);
    expect(() => deriveCanonicalRunFirstContinuationRoomPlanUnbranded(
      withSymbol as CanonicalRunFirstContinuationRoomPlanSourceView,
    )).toThrow(/symbol keys/);

    const withAccessor = JSON.parse(JSON.stringify(sourceFixture())) as Record<string, any>;
    Object.defineProperty(withAccessor.target, "roomId", {
      get: () => "INFORMATION",
      enumerable: true,
      configurable: true,
    });
    for (const [key, entry] of Object.entries(withAccessor)) {
      if (key !== "target") deepFreeze(entry);
    }
    Object.freeze(withAccessor.target);
    Object.freeze(withAccessor);
    expect(() => deriveCanonicalRunFirstContinuationRoomPlanUnbranded(
      withAccessor as CanonicalRunFirstContinuationRoomPlanSourceView,
    )).toThrow(/enumerable data field/);

    const cyclic = JSON.parse(JSON.stringify(sourceFixture())) as Record<string, any>;
    cyclic.materialPoolSummary.cycle = cyclic;
    for (const [key, entry] of Object.entries(cyclic)) {
      if (key !== "materialPoolSummary") deepFreeze(entry);
    }
    for (const [key, entry] of Object.entries(cyclic.materialPoolSummary)) {
      if (key !== "cycle") deepFreeze(entry);
    }
    Object.freeze(cyclic.materialPoolSummary);
    Object.freeze(cyclic);
    expect(() => deriveCanonicalRunFirstContinuationRoomPlanUnbranded(
      cyclic as CanonicalRunFirstContinuationRoomPlanSourceView,
    )).toThrow(/cycle|exact schema fields/);
  });
});
