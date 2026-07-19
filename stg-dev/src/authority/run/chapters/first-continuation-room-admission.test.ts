import {describe, expect, it} from "vitest";

import {
  CANONICAL_RUN_FIRST_CONTINUATION_COMBINED_POOL_ADMISSION_CONTRACT,
  evaluateCanonicalRunFirstContinuationCombinedPoolAdmissionUnbranded,
  type CanonicalRunFirstContinuationCombinedPoolAdmissionInput,
} from "./first-continuation-room-admission";

interface FixtureOptions {
  readonly activeMicro?: number;
  readonly allocatedMicro?: number;
  readonly residueVisuals?: number;
  readonly patternId?: string;
  readonly archetypeId?: string;
  readonly capability?: "supported" | "unsupported";
  readonly requestState?:
    | "withheld-pending-combined-pool-admission"
    | "withheld-missing-split-child-upper-bound"
    | "withheld-unsupported-pattern-capability";
  readonly splitChildren?: boolean;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

function inputFixture(
  options: FixtureOptions = {},
): CanonicalRunFirstContinuationCombinedPoolAdmissionInput {
  const activeMicro = options.activeMicro ?? 12;
  const allocatedMicro = options.allocatedMicro ?? 20;
  const residueVisuals = options.residueVisuals ?? activeMicro;
  const patternId = options.patternId ?? "room.information.stale_packet_retry";
  const splitChildren = options.splitChildren ?? false;
  return deepFreeze({
    plannedAtTick120: 4_000,
    targetRoom: "INFORMATION" as const,
    intensity: {
      formula: "clamp01((avgFlower + gazeRatio + overrideRatio) / 2)" as const,
      avgFlower: 0.1,
      gazeRatio: 0.1,
      overrideRatio: {
        sourceAvailability: "missing" as const,
        missingReason: "override-not-eligible-in-source-window" as const,
        policy: "authored-fallback-not-observed" as const,
        value: 0 as const,
      },
      score: 0.1,
      tierId: "listen" as const,
      difficulty: "EASY" as const,
      budget: {maxProjectiles: 80, maxEmitters: 2, restMs: 1600},
    },
    occurrence: {
      occurrenceId: `run:room:1:encounter:0:${patternId}`,
      patternId,
      roomId: "INFORMATION" as const,
      roomOrdinal: 1 as const,
      encounterOrdinal: 0 as const,
      difficulty: "EASY" as const,
      difficultySalt: 0x2200 as const,
      resolvedSeed: {
        domain: "resolved-occurrence-seed" as const,
        composition: "rawRunSeed xor pattern.base xor encounterOrdinal xor difficultySalt" as const,
        value: 1,
      },
      segmentsMs: {
        telegraph: 520 as const,
        entry: 800 as const,
        read: 8_800,
        materialSettle: 900 as const,
        rest: 1600,
        safeGapHandoff: 520 as const,
      },
      parallel: {mode: "none" as const, patternId: null},
    },
    patternCapability: {
      patternId,
      source: "SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS" as const,
      status: options.capability ?? "supported",
    },
    poolReservationRequest: {
      state: options.requestState ?? "withheld-pending-combined-pool-admission",
      carryover: {
        authority: "room-threshold-material-carryover-v1" as const,
        sourcePatternId: "transition.room_threshold" as const,
        sourceOccurrenceId: "run:room:0-to-1:transition:transition.room_threshold" as const,
        detachedAtTick120: 3_990,
        observedAtTick120: 4_000,
        materialCount: activeMicro,
        drained: activeMicro === 0,
        activeSlots: {micro: activeMicro, medium: 0, heavy: 0, splitChildren: 0},
        allocatedSlots: {micro: allocatedMicro, medium: 0, heavy: 0, splitChildren: 0},
        liveColliders: 0 as const,
        residueVisuals,
      },
      successor: {
        patternId,
        projectileArchetypeId: options.archetypeId ?? "bullet.micro.notch_e",
        requestedProjectileSlots: 80,
        requestedResidueVisualSlots: 80,
        emitterCount: 1,
        maxEmitters: 2,
        poolClassResolution: "required-at-combined-admission" as const,
        splitChildren: splitChildren
          ? {
            requiresSplitChildren: true as const,
            upperBound: null,
            status: "missing" as const,
          }
          : {
            requiresSplitChildren: false as const,
            upperBound: 0 as const,
            status: "not-required" as const,
          },
      },
      combinedAdmissionEvaluated: false as const,
      reservationCommitted: false as const,
    },
  }) as CanonicalRunFirstContinuationCombinedPoolAdmissionInput;
}

describe("EXT-2026-015 combined pool admission evaluator", () => {
  it("admits exact projectile and residue capacity while material remains visible", () => {
    const evaluation = evaluateCanonicalRunFirstContinuationCombinedPoolAdmissionUnbranded(
      inputFixture({
        activeMicro: 1_456,
        allocatedMicro: 1_968,
        residueVisuals: 1_456,
      }),
      Object.freeze({"bullet.micro.notch_e": "micro" as const}),
    );

    expect(CANONICAL_RUN_FIRST_CONTINUATION_COMBINED_POOL_ADMISSION_CONTRACT)
      .toMatchObject({
        poolAccounting: "carryover-allocated-plus-successor-reservation",
        materialDrainRequired: false,
        canonicalEventWrites: 0,
        authorityMutations: 0,
      });
    expect(evaluation).toMatchObject({
      state: "admissible",
      admissible: true,
      poolClassResolution: {state: "resolved", poolClass: "micro"},
      carryover: {allocatedSlots: {micro: 1_968}, residueVisuals: 1_456},
      successor: {reservationByClass: {micro: 80}},
      combined: {allocatedSlots: {micro: 2_048}, residueVisuals: 1_536},
      limits: {
        poolBudgets: {micro: 2_048},
        residueVisualOnly: 1_536,
        difficultyProjectiles: 120,
      },
      checks: {
        emitterCapacity: true,
        difficultyProjectileCapacity: true,
        projectilePoolCapacity: true,
        residueVisualCapacity: true,
      },
      reservationCommitted: false,
      canonicalEventWrites: 0,
      authorityMutations: 0,
    });
  });

  it.each([
    [
      "allocated slots",
      {activeMicro: 12, allocatedMicro: 1_969, residueVisuals: 12},
      "withheld-projectile-pool-capacity",
      {projectilePoolCapacity: false, residueVisualCapacity: true},
    ],
    [
      "residue visuals",
      {activeMicro: 1_457, allocatedMicro: 1_968, residueVisuals: 1_457},
      "withheld-residue-visual-capacity",
      {projectilePoolCapacity: true, residueVisualCapacity: false},
    ],
  ] as const)("withholds when %s exceed exact capacity by one", (
    _label,
    fixtureOptions,
    state,
    checks,
  ) => {
    const evaluation = evaluateCanonicalRunFirstContinuationCombinedPoolAdmissionUnbranded(
      inputFixture(fixtureOptions),
      Object.freeze({"bullet.micro.notch_e": "micro" as const}),
    );

    expect(evaluation.state).toBe(state);
    expect(evaluation.admissible).toBe(false);
    expect(evaluation.checks).toMatchObject(checks);
    expect(evaluation.reservationCommitted).toBe(false);
  });

  it("withholds a supported pattern when its exact Run mapping is absent", () => {
    const evaluation = evaluateCanonicalRunFirstContinuationCombinedPoolAdmissionUnbranded(
      inputFixture({archetypeId: "bullet.micro.dash"}),
      Object.freeze({"bullet.micro.notch_e": "micro" as const}),
    );

    expect(evaluation).toMatchObject({
      state: "withheld-missing-pool-class-mapping",
      admissible: false,
      poolClassResolution: {
        state: "missing",
        archetypeId: "bullet.micro.dash",
        poolClass: null,
      },
      combined: null,
      checks: {poolClassMapping: false},
      reservationCommitted: false,
    });
  });

  it("rejects hidden mapping values and accessors without executing them", () => {
    const hidden = Object.freeze(Object.defineProperty({}, "bullet.micro.notch_e", {
      value: "rogue",
      enumerable: false,
    })) as Readonly<Record<string, "micro">>;
    expect(() => evaluateCanonicalRunFirstContinuationCombinedPoolAdmissionUnbranded(
      inputFixture(),
      hidden,
    )).toThrow(/own enumerable V4 data mapping/);

    let getterReads = 0;
    const accessor = Object.freeze(Object.defineProperty({}, "bullet.micro.notch_e", {
      get: () => {
        getterReads += 1;
        return "micro";
      },
      enumerable: true,
    })) as Readonly<Record<string, "micro">>;
    expect(() => evaluateCanonicalRunFirstContinuationCombinedPoolAdmissionUnbranded(
      inputFixture(),
      accessor,
    )).toThrow(/own enumerable V4 data mapping/);
    expect(getterReads).toBe(0);
  });

  it.each([
    [
      "unsupported capability",
      {
        patternId: "room.in_between.borrowed_rule",
        capability: "unsupported" as const,
        requestState: "withheld-unsupported-pattern-capability" as const,
      },
      "withheld-unsupported-pattern-capability",
    ],
    [
      "missing split upper bound",
      {
        patternId: "room.information.missing_ack",
        capability: "unsupported" as const,
        requestState: "withheld-missing-split-child-upper-bound" as const,
        splitChildren: true,
      },
      "withheld-missing-split-child-upper-bound",
    ],
  ] as const)("preserves upstream %s without entering mapping or budget authority", (
    _label,
    fixtureOptions,
    state,
  ) => {
    const evaluation = evaluateCanonicalRunFirstContinuationCombinedPoolAdmissionUnbranded(
      inputFixture(fixtureOptions),
      {},
    );

    expect(evaluation).toMatchObject({
      state,
      admissible: false,
      poolClassResolution: {state: "not-evaluated", poolClass: null},
      successor: {reservationByClass: null},
      combined: null,
      checks: {
        poolClassMapping: null,
        projectilePoolCapacity: null,
        residueVisualCapacity: null,
      },
      reservationCommitted: false,
      canonicalEventWrites: 0,
      authorityMutations: 0,
    });
  });
});
