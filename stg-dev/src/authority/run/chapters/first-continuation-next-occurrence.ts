import {
  advanceCanonicalRunFirstContinuationNextOccurrencePreReadTick,
  inspectCanonicalRunFirstContinuationNextOccurrenceDormantOwner,
  startCanonicalRunFirstContinuationNextOccurrenceReadBinding,
  type CanonicalCombatStepInput,
  type CanonicalRunFirstContinuationNextOccurrenceDormantOwner,
  type CanonicalRunFirstContinuationNextOccurrenceDormantOwnerSnapshot,
} from "../../combat-kernel";

const ALLOWED_PRE_READ_EVENT_IDS = Object.freeze([
  "projectile.residue.remove",
  "projectile.lifecycle.complete",
] as const);

interface NextOccurrenceOwnerRecord {
  stepping: boolean;
  fatalError: Error | null;
}

const NEXT_OCCURRENCE_OWNER_RECORDS = new WeakMap<
  CanonicalRunFirstContinuationNextOccurrenceDormantOwner,
  NextOccurrenceOwnerRecord
>();

function requireOwner(
  owner: CanonicalRunFirstContinuationNextOccurrenceDormantOwner,
): NextOccurrenceOwnerRecord {
  if (typeof owner !== "object" || owner === null) {
    throw new Error("first continuation next occurrence owner must be opaque");
  }
  let record = NEXT_OCCURRENCE_OWNER_RECORDS.get(owner);
  if (record === undefined) {
    inspectCanonicalRunFirstContinuationNextOccurrenceDormantOwner(owner);
    record = {stepping: false, fatalError: null};
    NEXT_OCCURRENCE_OWNER_RECORDS.set(owner, record);
  }
  if (record.fatalError !== null) {
    throw new Error(
      `first continuation next occurrence owner is faulted: ${record.fatalError.message}`,
      {cause: record.fatalError},
    );
  }
  return record;
}

function requireCleanupOnly(
  events: readonly Readonly<{readonly id: string}>[],
): void {
  if (events.some((event) => !ALLOWED_PRE_READ_EVENT_IDS.includes(
    event.id as (typeof ALLOWED_PRE_READ_EVENT_IDS)[number],
  ))) {
    throw new Error("first continuation next occurrence pre-READ emitted a non-material event");
  }
}

export function inspectCanonicalRunFirstContinuationNextOccurrenceOwner(
  owner: CanonicalRunFirstContinuationNextOccurrenceDormantOwner,
): CanonicalRunFirstContinuationNextOccurrenceDormantOwnerSnapshot {
  requireOwner(owner);
  return inspectCanonicalRunFirstContinuationNextOccurrenceDormantOwner(owner);
}

export function advanceCanonicalRunFirstContinuationNextOccurrencePreRead(
  owner: CanonicalRunFirstContinuationNextOccurrenceDormantOwner,
  input: CanonicalCombatStepInput,
): CanonicalRunFirstContinuationNextOccurrenceDormantOwnerSnapshot {
  const record = requireOwner(owner);
  if (record.stepping) {
    throw new Error("first continuation next occurrence pre-READ step is already active");
  }
  record.stepping = true;
  let authoritativeTickAccepted = false;
  try {
    const before = inspectCanonicalRunFirstContinuationNextOccurrenceDormantOwner(owner);
    if (
      before.combat !== null
      || before.nextMasterTickAction === "claim-read"
      || before.nextMasterTickAction === "read-advance-withheld"
    ) {
      throw new Error(
        "first continuation next occurrence pre-READ stops before the exact READ claim tick",
      );
    }
    const advanced = advanceCanonicalRunFirstContinuationNextOccurrencePreReadTick(
      owner,
      input,
    );
    authoritativeTickAccepted = true;
    requireCleanupOnly(advanced.flushedEvents);
    const after = inspectCanonicalRunFirstContinuationNextOccurrenceDormantOwner(owner);
    if (
      after.tick120 !== before.tick120 + 1
      || after.relativeTick120 !== before.relativeTick120 + 1
      || after.phase !== "pre-read"
      || (after.authoredPhase !== "telegraph" && after.authoredPhase !== "entry")
      || after.combat !== null
      || advanced.combat !== null
      || advanced.runCombat.tick120 !== after.tick120
      || advanced.material.tick120 !== after.tick120
      || after.runCombat.pendingFlushTick120 !== null
    ) {
      throw new Error("first continuation next occurrence pre-READ lost its one-tick boundary");
    }
    return after;
  } catch (error) {
    if (authoritativeTickAccepted) {
      record.fatalError = error instanceof Error ? error : new Error(String(error));
    }
    throw error;
  } finally {
    record.stepping = false;
  }
}

export function startCanonicalRunFirstContinuationNextOccurrenceRead(
  owner: CanonicalRunFirstContinuationNextOccurrenceDormantOwner,
  input: CanonicalCombatStepInput,
): CanonicalRunFirstContinuationNextOccurrenceDormantOwnerSnapshot {
  const record = requireOwner(owner);
  if (record.stepping) {
    throw new Error("first continuation next occurrence READ start is already active");
  }
  record.stepping = true;
  let authoritativeTickAccepted = false;
  try {
    const before = inspectCanonicalRunFirstContinuationNextOccurrenceDormantOwner(owner);
    if (
      before.phase !== "pre-read"
      || before.authoredPhase !== "entry"
      || before.nextMasterTickAction !== "claim-read"
      || before.combat !== null
    ) {
      throw new Error(
        "first continuation next occurrence READ requires its exact entry boundary",
      );
    }
    if (before.runCombat.claimedOccurrenceIds.some((occurrenceId) =>
      occurrenceId === before.plan.occurrence.occurrenceId)) {
      throw new Error("first continuation next occurrence was claimed before READ");
    }
    const advanced = startCanonicalRunFirstContinuationNextOccurrenceReadBinding(
      owner,
      input,
    );
    authoritativeTickAccepted = true;
    requireCleanupOnly(advanced.flushedEvents);
    const after = inspectCanonicalRunFirstContinuationNextOccurrenceDormantOwner(owner);
    if (
      after.tick120 !== before.tick120 + 1
      || after.relativeTick120 !== before.relativeTick120 + 1
      || after.tick120 !== after.boundaryTicks120.readStartTick120
      || after.phase !== "read"
      || after.authoredPhase !== "read"
      || after.nextMasterTickAction !== "read-advance-withheld"
      || after.combat === null
      || advanced.combat === null
      || after.combat.tick120 !== after.tick120
      || after.combat.relativeTick120 !== 0
      || after.combat.patternId !== after.plan.occurrence.patternId
      || after.combat.occurrenceId !== after.plan.occurrence.occurrenceId
      || after.combat.projectiles.length !== 0
      || after.combat.poolUsage.liveColliders !== 0
      || after.combat.rngCallsConsumed !== 0
      || advanced.runCombat.tick120 !== after.tick120
      || advanced.material.tick120 !== after.tick120
      || after.runCombat.activeOccurrenceId !== after.plan.occurrence.occurrenceId
      || after.runCombat.pendingFlushTick120 !== null
      || after.runCombat.claimedOccurrenceIds.filter((occurrenceId) =>
        occurrenceId === after.plan.occurrence.occurrenceId).length !== 1
    ) {
      throw new Error("first continuation next occurrence READ local-tick-zero drifted");
    }
    return after;
  } catch (error) {
    if (authoritativeTickAccepted) {
      record.fatalError = error instanceof Error ? error : new Error(String(error));
    }
    throw error;
  } finally {
    record.stepping = false;
  }
}
