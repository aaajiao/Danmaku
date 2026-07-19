import type {ProjectilePoolUsage} from "../../projectiles";
import type {CanonicalRunFirstContinuationRoomTargetAvailable} from
  "../../run-first-continuation-room-target";
import type {CanonicalRunFirstContinuationRoomPlanSourceView} from
  "./first-continuation-room-plan";

export interface CanonicalRunFirstContinuationRoomPlanMaterialSource {
  readonly authority: "room-threshold-material-carryover-v1";
  readonly sourcePatternId: "transition.room_threshold";
  readonly sourceOccurrenceId: "run:room:0-to-1:transition:transition.room_threshold";
  readonly detachedAtTick120: number;
  readonly tick120: number;
  readonly materialCount: number;
  readonly drained: boolean;
  readonly poolUsage: ProjectilePoolUsage;
}

export interface CanonicalRunFirstContinuationRoomPlanHandoffSource {
  readonly targetRoom: CanonicalRunFirstContinuationRoomTargetAvailable["targetRoom"];
  readonly atTick120: number;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`first continuation room plan source ${message}`);
}

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => deepFreeze(entry))) as T;
  if (typeof value === "object" && value !== null) {
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) copy[key] = deepFreeze(entry);
    return Object.freeze(copy) as T;
  }
  return value;
}

function availableMetricValue(
  target: CanonicalRunFirstContinuationRoomTargetAvailable,
  id: "avgFlower" | "gazeRatio",
): number {
  const values: number[] = [];
  for (const candidate of target.candidateWeights) {
    for (const term of candidate.metricTerms) {
      if (term.id === id && term.availability === "available") values.push(term.value);
    }
  }
  invariant(values.length > 0, `formal target lost available ${id}`);
  const value = values[0];
  invariant(
    value !== undefined
      && Number.isFinite(value)
      && value >= 0
      && value <= 1
      && values.every((entry) => entry === value),
    `formal target ${id} evidence diverged across composers`,
  );
  return value;
}

/** Pure source projection; possession of this cloneable view grants no authority. */
export function deriveCanonicalRunFirstContinuationRoomPlanSourceUnbranded(
  target: CanonicalRunFirstContinuationRoomTargetAvailable,
  handoff: CanonicalRunFirstContinuationRoomPlanHandoffSource,
  material: CanonicalRunFirstContinuationRoomPlanMaterialSource,
): CanonicalRunFirstContinuationRoomPlanSourceView {
  invariant(
    target.targetRoom === handoff.targetRoom
      && handoff.atTick120 === material.tick120
      && material.poolUsage.liveColliders === 0,
    "target, handoff, and material boundary diverged",
  );
  return deepFreeze({
    authority: "canonical-run-first-continuation-room-plan-source-v1" as const,
    schemaVersion: "1.0.0-ext-2026-015" as const,
    extensionPolicy: "EXT-2026-015" as const,
    contentIdentity: target.contentIdentity,
    target: {
      authority: "canonical-run-first-continuation-room-target-v1" as const,
      extensionPolicy: "EXT-2026-012" as const,
      roomId: target.targetRoom,
      roomOrdinal: 1 as const,
    },
    rawRunSeed: target.rawRunSeed,
    targetSelectionRng: {
      algorithm: "mulberry32-v1" as const,
      domain: "ext-012-first-continuation-room-selection" as const,
      drawOrdinal: 0 as const,
      drawValue: target.rng.drawValue,
      stateAfterDrawUint32: target.rng.stateAfterDrawUint32,
      selectionRngDraws: 1 as const,
    },
    handoff: {
      authority: "canonical-run-first-continuation-room-handoff-v1" as const,
      extensionPolicy: "EXT-2026-013" as const,
      targetRoom: handoff.targetRoom,
      atTick120: handoff.atTick120,
      nextRoomAdmission: "withheld-pending-room-plan-and-combined-pool-budget" as const,
    },
    intensityMetrics: {
      avgFlower: {
        availability: "available" as const,
        value: availableMetricValue(target, "avgFlower"),
        unit: "ratio-0-1" as const,
      },
      gazeRatio: {
        availability: "available" as const,
        value: availableMetricValue(target, "gazeRatio"),
        unit: "ratio-0-1" as const,
      },
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
      authority: material.authority,
      sourcePatternId: material.sourcePatternId,
      sourceOccurrenceId: material.sourceOccurrenceId,
      detachedAtTick120: material.detachedAtTick120,
      observedAtTick120: material.tick120,
      materialCount: material.materialCount,
      drained: material.drained,
      activeSlots: material.poolUsage.active,
      allocatedSlots: material.poolUsage.allocatedSlots,
      liveColliders: 0 as const,
      residueVisuals: material.poolUsage.residueVisuals,
    },
  });
}
