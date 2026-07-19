import stateMachinesJson from "../../../1bit-stg-complete-asset-kit-v4/manifests/runtime/state-machines-v4.json";
import {
  ROOM_TRANSITION_TIMING,
  canonicalizeRoomId,
  type RoomId,
} from "../../../1bit-stg-complete-asset-kit-v4/runtime/world";
import {
  CanonicalEventBus,
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

interface RoomTransitionProposal {
  state: RoomTransitionAuthorityState;
  currentRoom: RoomId;
  active: Readonly<ActiveRoomTransitionSnapshot> | null;
  readonly drafts: GameplayEventDraft[];
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
 *
 * Mutations are direct: each request/advance validates fully, appends its
 * canonical drafts to the shared bus, and only then commits FSM state, so a
 * rejected bus write leaves the authority untouched.
 */
export class RoomTransitionAuthority {
  private currentTick120Value: number | null = null;
  private stateValue: RoomTransitionAuthorityState = "idle";
  private currentRoomValue: RoomId;
  private activeValue: Readonly<ActiveRoomTransitionSnapshot> | null = null;
  private generationValue = 0;
  private eventCountValue = 0;

  constructor(
    private readonly bus: CanonicalEventBus,
    initialRoomValue: unknown,
  ) {
    if (!(bus instanceof CanonicalEventBus)) {
      throw new Error("room-transition event bus must be a CanonicalEventBus");
    }
    this.currentRoomValue = requireCanonicalRoomId(initialRoomValue, "initial room");
  }

  request(targetRoomValue: unknown, tick120Value: unknown): RoomTransitionAuthoritySnapshot {
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
    this.bus.enqueueBatch([draft]);
    this.currentTick120Value = tick120;
    this.stateValue = "preparing";
    this.activeValue = active;
    this.generationValue = generation;
    this.eventCountValue += 1;
    return this.snapshot();
  }

  advance(tick120Value: unknown): RoomTransitionAuthoritySnapshot {
    const tick120 = this.requireForwardTick(tick120Value, "room-transition advance tick120");
    const proposal = this.proposeAdvance(tick120);
    if (proposal.drafts.length > 0) this.bus.enqueueBatch(proposal.drafts);
    this.currentTick120Value = tick120;
    this.stateValue = proposal.state;
    this.currentRoomValue = proposal.currentRoom;
    this.activeValue = proposal.active;
    this.eventCountValue += proposal.drafts.length;
    return this.snapshot();
  }

  snapshot(): RoomTransitionAuthoritySnapshot {
    return Object.freeze({
      authority: "v4-room-transition",
      tick120: this.currentTick120Value,
      state: this.stateValue,
      currentRoom: this.currentRoomValue,
      targetRoom: this.activeValue?.toRoom ?? null,
      generation: this.generationValue,
      eventCount: this.eventCountValue,
      active: this.activeValue,
    });
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
}
