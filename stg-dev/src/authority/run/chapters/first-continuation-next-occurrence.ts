import {
  advanceCanonicalRunFirstContinuationNextOccurrencePreReadTick,
  advanceCanonicalRunFirstContinuationNextOccurrenceReadTick,
  advanceCanonicalRunFirstContinuationNextOccurrenceTailTick,
  inspectCanonicalRunFirstContinuationNextOccurrenceDormantOwner,
  startCanonicalRunFirstContinuationNextOccurrenceReadBinding,
  type CanonicalCombatStepInput,
  type CanonicalRunFirstContinuationNextOccurrenceDormantOwner,
  type CanonicalRunFirstContinuationNextOccurrenceDormantOwnerSnapshot,
} from "../../combat-kernel";
import {PLAYER_TIMER_ADVANCE_EVENT_IDS} from "../../player";

const ALLOWED_MATERIAL_EVENT_IDS = Object.freeze([
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
  if (events.some((event) => !ALLOWED_MATERIAL_EVENT_IDS.includes(
    event.id as (typeof ALLOWED_MATERIAL_EVENT_IDS)[number],
  ))) {
    throw new Error("first continuation next occurrence emitted a non-material event");
  }
}

function requireMaterialOrPlayerTimerOnly(
  events: readonly Readonly<{readonly id: string}>[],
): void {
  if (events.some((event) =>
    !ALLOWED_MATERIAL_EVENT_IDS.includes(
      event.id as (typeof ALLOWED_MATERIAL_EVENT_IDS)[number],
    ) && !PLAYER_TIMER_ADVANCE_EVENT_IDS.includes(event.id))) {
    throw new Error(
      "first continuation next occurrence tail emitted an unowned gameplay event",
    );
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
      || before.nextMasterTickAction === "advance-read"
      || before.nextMasterTickAction === "advance-material-settle"
      || before.nextMasterTickAction === "advance-rest"
      || before.nextMasterTickAction === "close-slice"
      || before.nextMasterTickAction === "transfer-material"
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
      || after.readPolicy !== "EXT-2026-022"
      || after.nextMasterTickAction !== "advance-read"
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

export function advanceCanonicalRunFirstContinuationNextOccurrenceRead(
  owner: CanonicalRunFirstContinuationNextOccurrenceDormantOwner,
  input: CanonicalCombatStepInput,
): CanonicalRunFirstContinuationNextOccurrenceDormantOwnerSnapshot {
  const record = requireOwner(owner);
  if (record.stepping) {
    throw new Error("first continuation next occurrence READ step is already active");
  }
  record.stepping = true;
  let authoritativeTickAccepted = false;
  try {
    const before = inspectCanonicalRunFirstContinuationNextOccurrenceDormantOwner(owner);
    if (
      before.phase !== "read"
      || before.authoredPhase !== "read"
      || before.nextMasterTickAction !== "advance-read"
      || before.combat === null
    ) {
      throw new Error(
        "first continuation next occurrence READ advance requires its active READ owner",
      );
    }
    const advanced = advanceCanonicalRunFirstContinuationNextOccurrenceReadTick(
      owner,
      input,
    );
    authoritativeTickAccepted = true;
    const after = inspectCanonicalRunFirstContinuationNextOccurrenceDormantOwner(owner);
    if (
      after.tick120 !== before.tick120 + 1
      || after.relativeTick120 !== before.relativeTick120 + 1
      || after.combat === null
      || advanced.combat === null
      || after.combat.tick120 !== advanced.combat.tick120
      || after.combat.relativeTick120 !== before.combat.relativeTick120 + 1
      || after.combat.patternId !== after.plan.occurrence.patternId
      || after.combat.occurrenceId !== after.plan.occurrence.occurrenceId
      || after.material.tick120 !== after.tick120
      || advanced.material.tick120 !== after.tick120
      || advanced.runCombat.tick120 !== after.tick120
      || after.runCombat.pendingFlushTick120 !== null
      || after.runCombat.claimedOccurrenceIds.filter((occurrenceId) =>
        occurrenceId === after.plan.occurrence.occurrenceId).length !== 1
      || (after.nextMasterTickAction !== "advance-read"
        && after.nextMasterTickAction !== "advance-material-settle")
      || (after.nextMasterTickAction === "advance-read"
        ? after.phase !== "read"
          || after.authoredPhase !== "read"
          || after.runCombat.activeOccurrenceId
            !== after.plan.occurrence.occurrenceId
        : after.phase !== "tail"
          || after.authoredPhase !== "material-settle"
          || after.runCombat.activeOccurrenceId !== null
          || !after.combat.patternComplete
          || !after.combat.digitalBodiesDrained
          || after.combat.poolUsage.liveColliders !== 0
          || after.combat.projectiles.some((projectile) =>
            projectile.state !== "residue" || projectile.collisionEnabled))
    ) {
      throw new Error("first continuation next occurrence READ lost its one-tick boundary");
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

export function advanceCanonicalRunFirstContinuationNextOccurrenceTail(
  owner: CanonicalRunFirstContinuationNextOccurrenceDormantOwner,
  input: CanonicalCombatStepInput,
): CanonicalRunFirstContinuationNextOccurrenceDormantOwnerSnapshot {
  const record = requireOwner(owner);
  if (record.stepping) {
    throw new Error("first continuation next occurrence material-tail step is already active");
  }
  record.stepping = true;
  let authoritativeTickAccepted = false;
  try {
    const before = inspectCanonicalRunFirstContinuationNextOccurrenceDormantOwner(owner);
    if (
      before.phase !== "tail"
      || before.combat === null
      || (before.nextMasterTickAction !== "advance-material-settle"
        && before.nextMasterTickAction !== "advance-rest")
    ) {
      throw new Error(
        "first continuation next occurrence material tail stops before slice close",
      );
    }
    const advanced = advanceCanonicalRunFirstContinuationNextOccurrenceTailTick(
      owner,
      input,
      "advance",
    );
    authoritativeTickAccepted = true;
    requireMaterialOrPlayerTimerOnly(advanced.flushedEvents);
    const after = inspectCanonicalRunFirstContinuationNextOccurrenceDormantOwner(owner);
    if (
      advanced.sliceComplete
      || after.tick120 !== before.tick120 + 1
      || after.relativeTick120 !== before.relativeTick120 + 1
      || after.phase !== "tail"
      || (after.authoredPhase !== "material-settle" && after.authoredPhase !== "rest")
      || after.combat === null
      || after.combat.tick120 !== after.tick120
      || after.combat.rngCallsConsumed !== before.combat.rngCallsConsumed
      || after.combat.poolUsage.liveColliders !== 0
      || after.combat.projectiles.some((projectile) =>
        projectile.state !== "residue" || projectile.collisionEnabled)
      || (after.nextMasterTickAction !== "advance-material-settle"
        && after.nextMasterTickAction !== "advance-rest"
        && after.nextMasterTickAction !== "close-slice")
      || advanced.combat.tick120 !== after.tick120
      || advanced.runCombat.tick120 !== after.tick120
      || advanced.material.tick120 !== after.tick120
      || after.runCombat.pendingFlushTick120 !== null
    ) {
      throw new Error(
        "first continuation next occurrence material tail lost its one-tick boundary",
      );
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

export function closeCanonicalRunFirstContinuationNextOccurrenceSlice(
  owner: CanonicalRunFirstContinuationNextOccurrenceDormantOwner,
  input: CanonicalCombatStepInput,
): CanonicalRunFirstContinuationNextOccurrenceDormantOwnerSnapshot {
  const record = requireOwner(owner);
  if (record.stepping) {
    throw new Error("first continuation next occurrence slice close is already active");
  }
  record.stepping = true;
  let authoritativeTickAccepted = false;
  try {
    const before = inspectCanonicalRunFirstContinuationNextOccurrenceDormantOwner(owner);
    if (
      before.phase !== "tail"
      || before.authoredPhase !== "rest"
      || before.nextMasterTickAction !== "close-slice"
      || before.combat === null
    ) {
      throw new Error(
        "first continuation next occurrence slice close requires its exact final rest tick",
      );
    }
    const advanced = advanceCanonicalRunFirstContinuationNextOccurrenceTailTick(
      owner,
      input,
      "close",
    );
    authoritativeTickAccepted = true;
    requireMaterialOrPlayerTimerOnly(advanced.flushedEvents);
    const after = inspectCanonicalRunFirstContinuationNextOccurrenceDormantOwner(owner);
    if (
      !advanced.sliceComplete
      || after.tick120 !== before.tick120 + 1
      || after.tick120 !== after.boundaryTicks120.sliceCompleteTick120
      || after.phase !== "complete"
      || after.authoredPhase !== "rest"
      || after.nextMasterTickAction !== "transfer-material"
      || after.combat === null
      || after.combat.tick120 !== after.tick120
      || after.combat.rngCallsConsumed !== before.combat.rngCallsConsumed
      || after.combat.poolUsage.liveColliders !== 0
      || after.combat.projectiles.some((projectile) =>
        projectile.state !== "residue" || projectile.collisionEnabled)
      || advanced.combat.tick120 !== after.tick120
      || advanced.runCombat.tick120 !== after.tick120
      || advanced.material.tick120 !== after.tick120
      || after.runCombat.pendingFlushTick120 !== null
    ) {
      throw new Error(
        "first continuation next occurrence slice close lost its exact transfer boundary",
      );
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

/** Single chapter-facing router; zero-tick material transfer remains separate. */
export function stepCanonicalRunFirstContinuationNextOccurrence(
  owner: CanonicalRunFirstContinuationNextOccurrenceDormantOwner,
  input: CanonicalCombatStepInput,
): CanonicalRunFirstContinuationNextOccurrenceDormantOwnerSnapshot {
  const before = inspectCanonicalRunFirstContinuationNextOccurrenceOwner(owner);
  switch (before.nextMasterTickAction) {
    case "telegraph":
    case "continue-telegraph":
    case "entry":
    case "continue-entry":
      return advanceCanonicalRunFirstContinuationNextOccurrencePreRead(owner, input);
    case "claim-read":
      return startCanonicalRunFirstContinuationNextOccurrenceRead(owner, input);
    case "advance-read":
      return advanceCanonicalRunFirstContinuationNextOccurrenceRead(owner, input);
    case "advance-material-settle":
    case "advance-rest":
      return advanceCanonicalRunFirstContinuationNextOccurrenceTail(owner, input);
    case "close-slice":
      return closeCanonicalRunFirstContinuationNextOccurrenceSlice(owner, input);
    case "transfer-material":
      throw new Error(
        "first continuation next occurrence missed its same-tick material transfer",
      );
  }
}
