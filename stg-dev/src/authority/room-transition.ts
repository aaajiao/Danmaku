import stateMachinesJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/runtime/state-machines-v4.json";
import {
  ROOM_TRANSITION_TIMING,
  canonicalizeRoomId,
  type RoomId,
} from "../../../1bit-stg-complete-asset-kit-v4/runtime/world";
import {
  CanonicalEventBus,
  consumeCanonicalEventBatchReceipt,
  isExactCanonicalEventBus,
  type CanonicalEventBatchReceipt,
  type GameplayEventDraft,
} from "./events";
import {
  MASTER_TICK_HZ,
  runtime60DeadlineTick,
} from "./clock";

const AUTHORITY_ID = "room-transition";

const EXPECTED_STATES = Object.freeze(["idle", "preparing", "swapping", "stabilizing"]);
const EXPECTED_TRANSITIONS = Object.freeze([
  Object.freeze({
    from: "idle",
    to: "preparing",
    trigger: "accepted-room-request",
    events: Object.freeze(["room.transition.begin"]),
  }),
  Object.freeze({
    from: "preparing",
    to: "swapping",
    trigger: "240ms",
    events: Object.freeze(["room.transition.world_swap.commit"]),
  }),
  Object.freeze({
    from: "swapping",
    to: "stabilizing",
    trigger: "500ms",
    events: Object.freeze(["room.transition.room_ready"]),
  }),
  Object.freeze({
    from: "stabilizing",
    to: "idle",
    trigger: "650ms",
    events: Object.freeze(["room.transition.complete"]),
  }),
]);

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function stringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value.map((entry, index) => string(entry, `${path}[${index}]`));
}

function assertExactStrings(actual: readonly string[], expected: readonly string[], path: string): void {
  if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) {
    throw new Error(`${path} drifted from the V4 room-transition contract`);
  }
}

function assertImmutableSourceContract(): void {
  const manifest = record(stateMachinesJson, "state-machine manifest");
  if (manifest.schemaVersion !== "4.0.0" || manifest.id !== "1bit.state-machines.v4") {
    throw new Error("V4 state-machine manifest identity drifted");
  }
  if (!Array.isArray(manifest.machines)) throw new Error("state-machine manifest.machines must be an array");
  const candidates = manifest.machines.filter((entry) =>
    typeof entry === "object" && entry !== null && !Array.isArray(entry)
      && (entry as Record<string, unknown>).id === "roomTransition");
  if (candidates.length !== 1) throw new Error("V4 must declare exactly one roomTransition machine");
  const machine = record(candidates[0], "state-machine manifest.roomTransition");
  if (
    machine.implementation !== "RoomTransitionMachine"
    || machine.type !== "atomic-world-swap-fsm"
    || machine.initialState !== "idle"
  ) {
    throw new Error("V4 roomTransition machine identity drifted");
  }
  assertExactStrings(
    stringArray(machine.states, "state-machine manifest.roomTransition.states"),
    EXPECTED_STATES,
    "state-machine manifest.roomTransition.states",
  );
  if (!Array.isArray(machine.transitions) || machine.transitions.length !== EXPECTED_TRANSITIONS.length) {
    throw new Error("V4 roomTransition transition count drifted");
  }
  for (const [index, expected] of EXPECTED_TRANSITIONS.entries()) {
    const transition = record(
      machine.transitions[index],
      `state-machine manifest.roomTransition.transitions[${index}]`,
    );
    if (
      transition.from !== expected.from
      || transition.to !== expected.to
      || transition.trigger !== expected.trigger
    ) {
      throw new Error(`V4 roomTransition transition ${index} drifted`);
    }
    assertExactStrings(
      stringArray(
        transition.events,
        `state-machine manifest.roomTransition.transitions[${index}].events`,
      ),
      expected.events,
      `state-machine manifest.roomTransition.transitions[${index}].events`,
    );
  }
  if (
    ROOM_TRANSITION_TIMING.worldSwapAtMs !== 240
    || ROOM_TRANSITION_TIMING.roomReadyAtMs !== 500
    || ROOM_TRANSITION_TIMING.completeAtMs !== 650
  ) {
    throw new Error("V4 RoomTransitionMachine timing drifted");
  }
}

assertImmutableSourceContract();

if (
  runtime60DeadlineTick(0, ROOM_TRANSITION_TIMING.worldSwapAtMs) !== 30
  || runtime60DeadlineTick(0, ROOM_TRANSITION_TIMING.roomReadyAtMs) !== 60
  || runtime60DeadlineTick(0, ROOM_TRANSITION_TIMING.completeAtMs) !== 78
) throw new Error("V4 room-transition runtime60 projection drifted");

export const ROOM_TRANSITION_AUTHORITY_CONTRACT = Object.freeze({
  authority: "v4-room-transition" as const,
  masterTickHz: MASTER_TICK_HZ,
  boundaryPolicy: "first-non-early-runtime60-boundary" as const,
  runtimeTimingMs: Object.freeze({
    worldSwap: ROOM_TRANSITION_TIMING.worldSwapAtMs,
    roomReady: ROOM_TRANSITION_TIMING.roomReadyAtMs,
    complete: ROOM_TRANSITION_TIMING.completeAtMs,
  }),
  runtimeBoundaryTick120: "even" as const,
});

export type RoomTransitionAuthorityState = "idle" | "preparing" | "swapping" | "stabilizing";

export interface ActiveRoomTransitionSnapshot {
  readonly generation: number;
  readonly fromRoom: RoomId;
  readonly toRoom: RoomId;
  readonly requestTick120: number;
  readonly worldSwapTick120: number;
  readonly roomReadyTick120: number;
  readonly completeTick120: number;
}

export interface RoomTransitionAuthoritySnapshot {
  readonly authority: "v4-room-transition";
  readonly tick120: number | null;
  readonly state: RoomTransitionAuthorityState;
  readonly currentRoom: RoomId;
  readonly targetRoom: RoomId | null;
  readonly generation: number;
  readonly eventCount: number;
  readonly active: Readonly<ActiveRoomTransitionSnapshot> | null;
}

declare const preparedRoomTransitionMutationBrand: unique symbol;

/** Opaque identity for one staged request or advance of the atomic FSM. */
export interface PreparedRoomTransitionMutation {
  readonly [preparedRoomTransitionMutationBrand]: "PreparedRoomTransitionMutation";
}

export interface PreparedRoomTransitionMutationView {
  readonly authority: "v4-room-transition-prepared-mutation";
  readonly kind: "request" | "advance";
  readonly eventBus: CanonicalEventBus;
  readonly tick120: number;
  readonly revision: number;
  readonly drafts: readonly GameplayEventDraft[];
  readonly preview: RoomTransitionAuthoritySnapshot;
}

interface RoomTransitionProposal {
  state: RoomTransitionAuthorityState;
  currentRoom: RoomId;
  active: Readonly<ActiveRoomTransitionSnapshot> | null;
  readonly drafts: GameplayEventDraft[];
}

interface RoomTransitionAuthorityStateRecord {
  readonly tick120: number | null;
  readonly state: RoomTransitionAuthorityState;
  readonly currentRoom: RoomId;
  readonly active: Readonly<ActiveRoomTransitionSnapshot> | null;
  readonly generation: number;
  readonly eventCount: number;
}

interface PreparedRoomTransitionMutationRecord {
  readonly owner: RoomTransitionAuthority;
  readonly eventBus: CanonicalEventBus;
  readonly revision: number;
  readonly before: RoomTransitionAuthorityStateRecord;
  readonly after: RoomTransitionAuthorityStateRecord;
  readonly view: PreparedRoomTransitionMutationView;
  status: "prepared" | "applied";
}

const PREPARED_ROOM_TRANSITION_MUTATIONS = new WeakMap<
  object,
  PreparedRoomTransitionMutationRecord
>();
const EXACT_ROOM_TRANSITION_AUTHORITIES = new WeakSet<RoomTransitionAuthority>();
const ROOM_TRANSITION_COMPOSITE_METHODS = Object.freeze([
  "snapshot",
  "prepareRequest",
  "prepareAdvance",
  "validatePreparedMutation",
  "applyPreparedMutationAfterAppend",
] as const);

/** Exact production identity used by the EXT-013 cross-authority coordinator. */
export function isExactRoomTransitionAuthority(
  value: unknown,
): value is RoomTransitionAuthority {
  return typeof value === "object"
    && value !== null
    && EXACT_ROOM_TRANSITION_AUTHORITIES.has(value as RoomTransitionAuthority)
    && Object.getPrototypeOf(value) === RoomTransitionAuthority.prototype
    && ROOM_TRANSITION_COMPOSITE_METHODS.every((method) =>
      !Object.prototype.hasOwnProperty.call(value, method));
}

function requireTick120(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || Object.is(value, -0)) {
    throw new Error(`${path} must be a non-negative safe integer`);
  }
  return value as number;
}

function requireCanonicalRoomId(value: unknown, path: string): RoomId {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a canonical V4 room ID`);
  }
  let canonical: RoomId;
  try {
    canonical = canonicalizeRoomId(value);
  } catch {
    throw new Error(`${path} must be a canonical V4 room ID`);
  }
  if (canonical !== value) {
    throw new Error(`${path} must not use a migration alias`);
  }
  return canonical;
}

function freezeActive(value: ActiveRoomTransitionSnapshot): Readonly<ActiveRoomTransitionSnapshot> {
  return Object.freeze({...value});
}

/**
 * Exact tick120 adapter for V4's 650 ms atomic world-swap FSM.
 *
 * This is deliberately separate from the 7800 ms executable pattern
 * `transition.room_threshold`: that pattern authors combat/material behavior,
 * while this machine owns only the atomic room identity handoff. Neither may
 * infer or complete the other from presentation time.
 */
export class RoomTransitionAuthority {
  private currentTick120Value: number | null = null;
  private stateValue: RoomTransitionAuthorityState = "idle";
  private currentRoomValue: RoomId;
  private activeValue: Readonly<ActiveRoomTransitionSnapshot> | null = null;
  private generationValue = 0;
  private eventCountValue = 0;
  private mutationRevision = 0;
  private mutationLocked = false;

  constructor(
    private readonly bus: CanonicalEventBus,
    initialRoomValue: unknown,
  ) {
    if (!isExactCanonicalEventBus(bus)) {
      throw new Error("room-transition event bus must be an exact CanonicalEventBus");
    }
    this.currentRoomValue = requireCanonicalRoomId(initialRoomValue, "initial room");
    if (new.target === RoomTransitionAuthority) EXACT_ROOM_TRANSITION_AUTHORITIES.add(this);
  }

  request(targetRoomValue: unknown, tick120Value: unknown): RoomTransitionAuthoritySnapshot {
    const proposal = RoomTransitionAuthority.prototype.prepareRequest.call(
      this,
      targetRoomValue,
      tick120Value,
    );
    return this.commitPreparedMutation(proposal);
  }

  advance(tick120Value: unknown): RoomTransitionAuthoritySnapshot {
    const proposal = RoomTransitionAuthority.prototype.prepareAdvance.call(this, tick120Value);
    return this.commitPreparedMutation(proposal);
  }

  /** Stage an accepted-room request without touching either bus or live FSM. */
  prepareRequest(
    targetRoomValue: unknown,
    tick120Value: unknown,
  ): PreparedRoomTransitionMutation {
    return this.withMutationLock(() => this.prepareRequestUnlocked(
      targetRoomValue,
      tick120Value,
    ));
  }

  /** Stage all FSM boundaries crossed by an exact advance without appending. */
  prepareAdvance(tick120Value: unknown): PreparedRoomTransitionMutation {
    return this.withMutationLock(() => this.prepareAdvanceUnlocked(tick120Value));
  }

  /** Revalidate exact owner, bus, state, tick, and revision before append. */
  validatePreparedMutation(
    proposal: PreparedRoomTransitionMutation,
    expectedBus: CanonicalEventBus,
  ): PreparedRoomTransitionMutationView {
    if (this.mutationLocked) {
      throw new Error("room transition mutation is already in progress");
    }
    return this.requirePreparedMutation(proposal, expectedBus).view;
  }

  /** Apply a staged FSM state only after its exact draft group was appended. */
  applyPreparedMutationAfterAppend(
    proposal: PreparedRoomTransitionMutation,
    expectedBus: CanonicalEventBus,
    receipt: CanonicalEventBatchReceipt,
  ): RoomTransitionAuthoritySnapshot {
    return this.withMutationLock(() => {
      const prepared = this.requirePreparedMutation(proposal, expectedBus);
      consumeCanonicalEventBatchReceipt(receipt, expectedBus, prepared.view.drafts);
      const after = prepared.after;
      this.currentTick120Value = after.tick120;
      this.stateValue = after.state;
      this.currentRoomValue = after.currentRoom;
      this.activeValue = after.active;
      this.generationValue = after.generation;
      this.eventCountValue = after.eventCount;
      prepared.status = "applied";
      this.mutationRevision += 1;
      return prepared.view.preview;
    });
  }

  snapshot(): RoomTransitionAuthoritySnapshot {
    return this.snapshotFromState(this.captureState());
  }

  private prepareRequestUnlocked(
    targetRoomValue: unknown,
    tick120Value: unknown,
  ): PreparedRoomTransitionMutation {
    const targetRoom = requireCanonicalRoomId(targetRoomValue, "target room");
    const tick120 = this.requireForwardTick(tick120Value, "room-transition request tick120");
    if (this.stateValue !== "idle" || this.activeValue !== null) {
      throw new Error("room transition request is concurrent with an active transition");
    }
    if (targetRoom === this.currentRoomValue) {
      throw new Error("room transition target must differ from the current room");
    }
    if (!Number.isSafeInteger(this.generationValue + 1)) {
      throw new Error("room transition generation exhausted the safe integer range");
    }
    const generation = this.generationValue + 1;
    const active = freezeActive({
      generation,
      fromRoom: this.currentRoomValue,
      toRoom: targetRoom,
      requestTick120: tick120,
      worldSwapTick120: runtime60DeadlineTick(tick120, ROOM_TRANSITION_TIMING.worldSwapAtMs),
      roomReadyTick120: runtime60DeadlineTick(tick120, ROOM_TRANSITION_TIMING.roomReadyAtMs),
      completeTick120: runtime60DeadlineTick(tick120, ROOM_TRANSITION_TIMING.completeAtMs),
    });
    const draft = this.draft(
      active,
      "room.transition.begin",
      tick120,
      this.nextLocalSequence(0),
      "begin",
      {
      generation,
      fromRoom: active.fromRoom,
      toRoom: active.toRoom,
      },
    );
    return this.createPreparedMutation(
      "request",
      tick120,
      Object.freeze([draft]),
      Object.freeze({
        tick120,
        state: "preparing",
        currentRoom: this.currentRoomValue,
        active,
        generation,
        eventCount: this.eventCountValue + 1,
      }),
    );
  }

  private prepareAdvanceUnlocked(tick120Value: unknown): PreparedRoomTransitionMutation {
    const tick120 = this.requireForwardTick(tick120Value, "room-transition advance tick120");
    const proposal = this.proposeAdvance(tick120);
    const drafts = Object.freeze(proposal.drafts.slice());
    return this.createPreparedMutation(
      "advance",
      tick120,
      drafts,
      Object.freeze({
        tick120,
        state: proposal.state,
        currentRoom: proposal.currentRoom,
        active: proposal.active,
        generation: this.generationValue,
        eventCount: this.eventCountValue + drafts.length,
      }),
    );
  }

  private requireForwardTick(value: unknown, path: string): number {
    const tick120 = requireTick120(value, path);
    if (this.currentTick120Value !== null && tick120 < this.currentTick120Value) {
      throw new Error(
        `room transition cannot move backward from tick ${this.currentTick120Value} to ${tick120}`,
      );
    }
    return tick120;
  }

  private proposeAdvance(tick120: number): RoomTransitionProposal {
    const proposal: RoomTransitionProposal = {
      state: this.stateValue,
      currentRoom: this.currentRoomValue,
      active: this.activeValue,
      drafts: [],
    };
    const active = proposal.active;
    if (proposal.state === "idle") {
      if (active !== null) throw new Error("idle room transition retained active state");
      return proposal;
    }
    if (active === null) throw new Error("active room transition lost its transition record");

    if (proposal.state === "preparing" && tick120 >= active.worldSwapTick120) {
      proposal.currentRoom = active.toRoom;
      proposal.state = "swapping";
      proposal.drafts.push(this.draft(
        active,
        "room.transition.world_swap.commit",
        active.worldSwapTick120,
        this.nextLocalSequence(proposal.drafts.length),
        "world-swap",
        {generation: active.generation, fromRoom: active.fromRoom, toRoom: active.toRoom},
      ));
    }
    if (proposal.state === "swapping" && tick120 >= active.roomReadyTick120) {
      proposal.state = "stabilizing";
      proposal.drafts.push(this.draft(
        active,
        "room.transition.room_ready",
        active.roomReadyTick120,
        this.nextLocalSequence(proposal.drafts.length),
        "room-ready",
        {generation: active.generation, room: active.toRoom},
      ));
    }
    if (proposal.state === "stabilizing" && tick120 >= active.completeTick120) {
      proposal.state = "idle";
      proposal.active = null;
      proposal.drafts.push(this.draft(
        active,
        "room.transition.complete",
        active.completeTick120,
        this.nextLocalSequence(proposal.drafts.length),
        "complete",
        {generation: active.generation, room: active.toRoom},
      ));
    }
    return proposal;
  }

  private draft(
    active: Readonly<ActiveRoomTransitionSnapshot>,
    id: string,
    tick120: number,
    localSequence: number,
    occurrenceSuffix: string,
    payload: Record<string, string | number>,
  ): GameplayEventDraft {
    return Object.freeze({
      id,
      tick120,
      entityStableId: AUTHORITY_ID,
      localSequence,
      occurrenceKey: `${AUTHORITY_ID}:${active.generation}:${occurrenceSuffix}`,
      payload: Object.freeze({...payload}),
    });
  }

  private nextLocalSequence(additionalDrafts: number): number {
    const sequence = this.eventCountValue + additionalDrafts;
    const committedEventCount = sequence + 1;
    if (!Number.isSafeInteger(sequence) || !Number.isSafeInteger(committedEventCount)) {
      throw new Error("room transition event sequence exhausted the safe integer range");
    }
    return sequence;
  }

  private captureState(): RoomTransitionAuthorityStateRecord {
    return Object.freeze({
      tick120: this.currentTick120Value,
      state: this.stateValue,
      currentRoom: this.currentRoomValue,
      active: this.activeValue,
      generation: this.generationValue,
      eventCount: this.eventCountValue,
    });
  }

  private snapshotFromState(
    state: RoomTransitionAuthorityStateRecord,
  ): RoomTransitionAuthoritySnapshot {
    return Object.freeze({
      authority: "v4-room-transition",
      tick120: state.tick120,
      state: state.state,
      currentRoom: state.currentRoom,
      targetRoom: state.active?.toRoom ?? null,
      generation: state.generation,
      eventCount: state.eventCount,
      active: state.active,
    });
  }

  private createPreparedMutation(
    kind: PreparedRoomTransitionMutationView["kind"],
    tick120: number,
    drafts: readonly GameplayEventDraft[],
    after: RoomTransitionAuthorityStateRecord,
  ): PreparedRoomTransitionMutation {
    const nextRevision = this.mutationRevision + 1;
    if (!Number.isSafeInteger(nextRevision)) {
      throw new Error("room transition mutation revision exhausted the safe integer range");
    }
    const before = this.captureState();
    const view: PreparedRoomTransitionMutationView = Object.freeze({
      authority: "v4-room-transition-prepared-mutation" as const,
      kind,
      eventBus: this.bus,
      tick120,
      revision: this.mutationRevision,
      drafts,
      preview: this.snapshotFromState(after),
    });
    const proposal = Object.freeze(Object.create(null)) as PreparedRoomTransitionMutation;
    PREPARED_ROOM_TRANSITION_MUTATIONS.set(proposal, {
      owner: this,
      eventBus: this.bus,
      revision: this.mutationRevision,
      before,
      after,
      view,
      status: "prepared",
    });
    return proposal;
  }

  private requirePreparedMutation(
    proposal: PreparedRoomTransitionMutation,
    expectedBus: CanonicalEventBus,
  ): PreparedRoomTransitionMutationRecord {
    if (!isExactCanonicalEventBus(expectedBus)) {
      throw new Error("room transition proposal requires an exact CanonicalEventBus");
    }
    if (typeof proposal !== "object" || proposal === null) {
      throw new Error("room transition mutation proposal must be opaque");
    }
    const prepared = PREPARED_ROOM_TRANSITION_MUTATIONS.get(proposal as object);
    if (prepared === undefined || prepared.owner !== this) {
      throw new Error("room transition mutation proposal is unknown or owned by another authority");
    }
    if (prepared.eventBus !== expectedBus || this.bus !== expectedBus) {
      throw new Error("room transition mutation proposal event bus does not match");
    }
    if (prepared.status !== "prepared") {
      throw new Error("room transition mutation proposal was already applied");
    }
    if (prepared.revision !== this.mutationRevision) {
      throw new Error("room transition mutation proposal is stale");
    }
    if (!this.matchesState(prepared.before)) {
      throw new Error("room transition mutation proposal state or tick is stale");
    }
    return prepared;
  }

  private matchesState(expected: RoomTransitionAuthorityStateRecord): boolean {
    return this.currentTick120Value === expected.tick120
      && this.stateValue === expected.state
      && this.currentRoomValue === expected.currentRoom
      && this.activeValue === expected.active
      && this.generationValue === expected.generation
      && this.eventCountValue === expected.eventCount;
  }

  private commitPreparedMutation(
    proposal: PreparedRoomTransitionMutation,
  ): RoomTransitionAuthoritySnapshot {
    const view = RoomTransitionAuthority.prototype.validatePreparedMutation.call(
      this,
      proposal,
      this.bus,
    );
    const receipts = CanonicalEventBus.prototype.enqueuePreparedBatch.call(
      this.bus,
      Object.freeze([view.drafts]),
    );
    return RoomTransitionAuthority.prototype.applyPreparedMutationAfterAppend.call(
      this,
      proposal,
      this.bus,
      receipts[0] as CanonicalEventBatchReceipt,
    );
  }

  private withMutationLock<Result>(operation: () => Result): Result {
    if (this.mutationLocked) {
      throw new Error("room transition mutation is already in progress");
    }
    this.mutationLocked = true;
    try {
      return operation();
    } finally {
      this.mutationLocked = false;
    }
  }
}
