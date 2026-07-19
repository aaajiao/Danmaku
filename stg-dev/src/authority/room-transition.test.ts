import {describe, expect, it} from "vitest";
import {
  CanonicalEventBus,
  serializeCanonicalEvents,
  type CanonicalEventBatchReceipt,
} from "./events";
import {
  ROOM_TRANSITION_AUTHORITY_CONTRACT,
  RoomTransitionAuthority,
  isExactRoomTransitionAuthority,
  type PreparedRoomTransitionMutation,
} from "./room-transition";

function make(initialRoom = "INFORMATION"): Readonly<{
  bus: CanonicalEventBus;
  authority: RoomTransitionAuthority;
}> {
  const bus = new CanonicalEventBus();
  return Object.freeze({bus, authority: new RoomTransitionAuthority(bus, initialRoom)});
}

describe("immutable V4 room-transition contract", () => {
  it("pins runtime milliseconds to their first non-early 60 Hz boundaries", () => {
    expect(ROOM_TRANSITION_AUTHORITY_CONTRACT).toEqual({
      authority: "v4-room-transition",
      masterTickHz: 120,
      boundaryPolicy: "first-non-early-runtime60-boundary",
      runtimeTimingMs: {worldSwap: 240, roomReady: 500, complete: 650},
      runtimeBoundaryTick120: "even",
    });
    expect(Object.isFrozen(ROOM_TRANSITION_AUTHORITY_CONTRACT)).toBe(true);
    expect(Object.isFrozen(ROOM_TRANSITION_AUTHORITY_CONTRACT.runtimeTimingMs)).toBe(true);
  });

  it("rejects a non-canonical initial room and the runtime-only migration alias", () => {
    expect(() => new RoomTransitionAuthority(new CanonicalEventBus(), "UNKNOWN")).toThrow(
      /canonical V4 room ID/,
    );
    expect(() => new RoomTransitionAuthority(new CanonicalEventBus(), "INFO_OVERFLOW")).toThrow(
      /migration alias/,
    );
    expect(() => new RoomTransitionAuthority({} as CanonicalEventBus, "INFORMATION")).toThrow(
      /CanonicalEventBus/,
    );
    class DerivedBus extends CanonicalEventBus {}
    expect(() => new RoomTransitionAuthority(new DerivedBus(), "INFORMATION")).toThrow(
      /exact CanonicalEventBus/,
    );
  });

  it("exposes only an exact unshadowed authority identity to a composite", () => {
    const exact = make().authority;
    expect(isExactRoomTransitionAuthority(exact)).toBe(true);
    Object.defineProperty(exact, "prepareAdvance", {
      configurable: true,
      value: RoomTransitionAuthority.prototype.prepareAdvance,
    });
    expect(isExactRoomTransitionAuthority(exact)).toBe(false);
  });
});

describe("prepared room-transition mutations", () => {
  it("stages a frozen request view and applies only after its exact append receipt", () => {
    const {bus, authority} = make();
    const before = authority.snapshot();
    const proposal = authority.prepareRequest("IN_BETWEEN", 101);
    const view = authority.validatePreparedMutation(proposal, bus);

    expect(view).toMatchObject({
      authority: "v4-room-transition-prepared-mutation",
      kind: "request",
      eventBus: bus,
      tick120: 101,
      revision: 0,
      preview: {
        tick120: 101,
        state: "preparing",
        currentRoom: "INFORMATION",
        targetRoom: "IN_BETWEEN",
        generation: 1,
        eventCount: 1,
      },
    });
    expect(view.drafts.map((draft) => draft.id)).toEqual(["room.transition.begin"]);
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.drafts)).toBe(true);
    expect(Object.isFrozen(view.preview)).toBe(true);
    expect(authority.snapshot()).toEqual(before);
    expect(bus.events()).toEqual([]);

    expect(() => authority.applyPreparedMutationAfterAppend(
      proposal,
      bus,
      Object.freeze({}) as CanonicalEventBatchReceipt,
    )).toThrow(/receipt is not recognized/);
    expect(authority.snapshot()).toEqual(before);

    const receipts = bus.enqueuePreparedBatch([view.drafts]);
    expect(authority.snapshot()).toEqual(before);
    expect(authority.applyPreparedMutationAfterAppend(
      proposal,
      bus,
      receipts[0] as CanonicalEventBatchReceipt,
    )).toEqual(view.preview);
    expect(authority.snapshot()).toEqual(view.preview);
    expect(bus.flush().map((event) => event.id)).toEqual(["room.transition.begin"]);
    expect(() => authority.validatePreparedMutation(proposal, bus)).toThrow(/already applied/);
  });

  it("binds proposals to exact owner, bus, revision, state, tick, and draft identity", () => {
    const bus = new CanonicalEventBus();
    const otherBus = new CanonicalEventBus();
    const authority = new RoomTransitionAuthority(bus, "INFORMATION");
    const other = new RoomTransitionAuthority(bus, "INFORMATION");
    const first = authority.prepareRequest("IN_BETWEEN", 1);
    const competing = authority.prepareRequest("POLARIZED", 1);
    const firstView = authority.validatePreparedMutation(first, bus);
    const receipts = bus.enqueuePreparedBatch([firstView.drafts]);

    expect(() => other.validatePreparedMutation(first, bus)).toThrow(/owned by another/);
    expect(() => authority.validatePreparedMutation(first, otherBus)).toThrow(/bus does not match/);
    expect(() => authority.applyPreparedMutationAfterAppend(
      competing,
      bus,
      receipts[0] as CanonicalEventBatchReceipt,
    )).toThrow(/does not cover/);
    expect(authority.snapshot()).toMatchObject({tick120: null, state: "idle"});
    authority.applyPreparedMutationAfterAppend(
      first,
      bus,
      receipts[0] as CanonicalEventBatchReceipt,
    );
    expect(() => authority.validatePreparedMutation(competing, bus)).toThrow(/stale/);

    const staleTickBus = new CanonicalEventBus();
    const staleTick = new RoomTransitionAuthority(staleTickBus, "INFORMATION");
    const stale = staleTick.prepareAdvance(0);
    staleTick.advance(0);
    expect(() => staleTick.validatePreparedMutation(stale, staleTickBus)).toThrow(/stale/);

    const exactStateBus = new CanonicalEventBus();
    const exactState = new RoomTransitionAuthority(exactStateBus, "INFORMATION");
    const exactStateProposal = exactState.prepareRequest("IN_BETWEEN", 3);
    Object.assign(exactState as unknown as {currentTick120Value: number | null}, {
      currentTick120Value: 0,
    });
    expect(() => exactState.validatePreparedMutation(exactStateProposal, exactStateBus)).toThrow(
      /state or tick is stale/,
    );

    expect(() => authority.validatePreparedMutation(
      Object.freeze(Object.create(null)) as PreparedRoomTransitionMutation,
      bus,
    )).toThrow(/unknown/);
  });

  it("keeps complete as an FSM-only group for same-append player release", () => {
    const {bus, authority} = make();
    authority.request("IN_BETWEEN", 0);
    bus.flush();
    authority.advance(30);
    bus.flush();
    authority.advance(60);
    bus.flush();

    const proposal = authority.prepareAdvance(78);
    const view = authority.validatePreparedMutation(proposal, bus);
    expect(view.drafts.map((draft) => draft.id)).toEqual(["room.transition.complete"]);
    expect(view.preview).toMatchObject({state: "idle", targetRoom: null, eventCount: 4});
    const playerReleaseDraft = Object.freeze({
      id: "player.collision.on",
      tick120: 78,
      entityStableId: "player:0",
      localSequence: 0,
      occurrenceKey: "prepared-room-transition:player-release",
      payload: Object.freeze({owner: "room-transition", reason: "atomic-world-swap"}),
    });
    const releaseGroup = Object.freeze([playerReleaseDraft]);
    const receipts = bus.enqueuePreparedBatch([view.drafts, releaseGroup]);

    expect(authority.snapshot().state).toBe("stabilizing");
    authority.applyPreparedMutationAfterAppend(
      proposal,
      bus,
      receipts[0] as CanonicalEventBatchReceipt,
    );
    expect(bus.flush().map((event) => event.id)).toEqual([
      "room.transition.complete",
      "player.collision.on",
    ]);
  });
});

describe("atomic room-transition lifecycle", () => {
  it("begins at the request tick with exact payload and occurrence identity", () => {
    const {bus, authority} = make();
    const snapshot = authority.request("IN_BETWEEN", 100);

    expect(snapshot).toEqual({
      authority: "v4-room-transition",
      tick120: 100,
      state: "preparing",
      currentRoom: "INFORMATION",
      targetRoom: "IN_BETWEEN",
      generation: 1,
      eventCount: 1,
      active: {
        generation: 1,
        fromRoom: "INFORMATION",
        toRoom: "IN_BETWEEN",
        requestTick120: 100,
        worldSwapTick120: 130,
        roomReadyTick120: 160,
        completeTick120: 178,
      },
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.active)).toBe(true);

    const events = bus.flush();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: "room.transition.begin",
      tick120: 100,
      entityStableId: "room-transition",
      localSequence: 0,
      occurrenceKey: "room-transition:1:begin",
      payload: {generation: 1, fromRoom: "INFORMATION", toRoom: "IN_BETWEEN"},
    });
  });

  it("crosses no boundary early and swaps world identity on the next due 60 Hz tick", () => {
    const {bus, authority} = make();
    authority.request("IN_BETWEEN", 0);
    bus.flush();

    expect(authority.advance(29)).toMatchObject({state: "preparing", currentRoom: "INFORMATION"});
    expect(bus.flush()).toEqual([]);
    expect(authority.advance(30)).toMatchObject({state: "swapping", currentRoom: "IN_BETWEEN"});
    expect(bus.flush().map((event) => [event.id, event.tick120])).toEqual([
      ["room.transition.world_swap.commit", 30],
    ]);

    expect(authority.advance(59).state).toBe("swapping");
    expect(bus.flush()).toEqual([]);
    expect(authority.advance(60).state).toBe("stabilizing");
    expect(bus.flush().map((event) => [event.id, event.tick120])).toEqual([
      ["room.transition.room_ready", 60],
    ]);

    expect(authority.advance(77).state).toBe("stabilizing");
    expect(bus.flush()).toEqual([]);
    expect(authority.advance(78)).toMatchObject({
      state: "idle",
      currentRoom: "IN_BETWEEN",
      targetRoom: null,
      active: null,
      eventCount: 4,
    });
    expect(bus.flush().map((event) => [event.id, event.tick120])).toEqual([
      ["room.transition.complete", 78],
    ]);
  });

  it("retains every due tick and emits every boundary once on a large advance", () => {
    const {bus, authority} = make("FORCED_ALIGNMENT");
    authority.request("POLARIZED", 100);
    authority.advance(10_000);
    const events = bus.flush();

    expect(events.map((event) => event.id)).toEqual([
      "room.transition.begin",
      "room.transition.world_swap.commit",
      "room.transition.room_ready",
      "room.transition.complete",
    ]);
    expect(events.map((event) => event.tick120)).toEqual([100, 130, 160, 178]);
    expect(events.map((event) => event.localSequence)).toEqual([0, 1, 2, 3]);
    expect(events.map((event) => event.occurrenceKey)).toEqual([
      "room-transition:1:begin",
      "room-transition:1:world-swap",
      "room-transition:1:room-ready",
      "room-transition:1:complete",
    ]);
    expect(events.map((event) => event.payload)).toEqual([
      {generation: 1, fromRoom: "FORCED_ALIGNMENT", toRoom: "POLARIZED"},
      {generation: 1, fromRoom: "FORCED_ALIGNMENT", toRoom: "POLARIZED"},
      {generation: 1, room: "POLARIZED"},
      {generation: 1, room: "POLARIZED"},
    ]);

    authority.advance(10_000);
    authority.advance(10_001);
    expect(bus.flush()).toEqual([]);
    expect(bus.events()).toHaveLength(4);
  });

  it("has identical canonical trace for chunked and single-step advances", () => {
    const run = (ticks: readonly number[]): string => {
      const {bus, authority} = make();
      authority.request("POLARIZED", 11);
      for (const tick of ticks) authority.advance(tick);
      bus.flush();
      return serializeCanonicalEvents(bus.events());
    };

    expect(run([12, 39, 40, 71, 72, 89, 90])).toBe(run([90]));
  });

  it("maps an odd request tick to non-early even runtime boundaries", () => {
    const {bus, authority} = make();
    expect(authority.request("POLARIZED", 11).active).toMatchObject({
      worldSwapTick120: 40,
      roomReadyTick120: 72,
      completeTick120: 90,
    });
    authority.advance(90);
    const events = bus.flush();
    expect(events.map((event) => event.tick120)).toEqual([11, 40, 72, 90]);
    expect(events.slice(1).every((event) => event.tick120 % 2 === 0)).toBe(true);
  });

  it("uses the shared bus so collision-off precedes state and collision-on follows it", () => {
    const {bus, authority} = make();
    bus.enqueue({
      id: "player.collision.on",
      tick120: 5,
      entityStableId: "player:0",
      localSequence: 1,
      occurrenceKey: "ordering:collision-on",
      payload: {owner: "room-transition-test", reason: "lease-release"},
    });
    authority.request("IN_BETWEEN", 5);
    bus.enqueue({
      id: "player.collision.off",
      tick120: 5,
      entityStableId: "player:0",
      localSequence: 0,
      occurrenceKey: "ordering:collision-off",
      payload: {owner: "room-transition-test", reason: "room-boundary"},
    });

    expect(bus.flush().map((event) => event.id)).toEqual([
      "player.collision.off",
      "room.transition.begin",
      "player.collision.on",
    ]);
  });

  it("increments generation and keeps occurrence identity unique across transitions", () => {
    const {bus, authority} = make();
    authority.request("IN_BETWEEN", 0);
    authority.advance(78);
    authority.request("POLARIZED", 100);
    authority.advance(178);
    const events = bus.flush();

    expect(authority.snapshot()).toMatchObject({
      state: "idle",
      currentRoom: "POLARIZED",
      generation: 2,
      eventCount: 8,
    });
    expect(new Set(events.map((event) => event.occurrenceKey))).toHaveLength(8);
    expect(events.filter((event) => event.id === "room.transition.begin").map((event) =>
      event.payload.generation)).toEqual([1, 2]);
  });

  it("orders a generation-9 completion before a same-tick generation-10 begin", () => {
    const {bus, authority} = make();
    const rooms = ["IN_BETWEEN", "INFORMATION"] as const;
    let startTick120 = 0;
    for (let generation = 1; generation <= 8; generation += 1) {
      authority.request(rooms[(generation - 1) % rooms.length], startTick120);
      authority.advance(startTick120 + 78);
      bus.flush();
      startTick120 += 100;
    }

    authority.request("IN_BETWEEN", startTick120);
    bus.flush();
    authority.advance(startTick120 + 78);
    authority.request("INFORMATION", startTick120 + 78);
    const sameTick = bus.flush().filter((event) => event.tick120 === startTick120 + 78);

    expect(sameTick.map((event) => [event.id, event.payload.generation])).toEqual([
      ["room.transition.complete", 9],
      ["room.transition.begin", 10],
    ]);
    expect(sameTick.map((event) => event.entityStableId)).toEqual([
      "room-transition",
      "room-transition",
    ]);
    expect(sameTick.map((event) => event.localSequence)).toEqual([35, 36]);
  });
});

describe("transactional rejection", () => {
  it.each([
    ["", 1, /canonical V4 room ID/],
    ["UNKNOWN", 1, /canonical V4 room ID/],
    ["INFO_OVERFLOW", 1, /migration alias/],
    ["IN_BETWEEN", -1, /non-negative safe integer/],
    ["IN_BETWEEN", -0, /non-negative safe integer/],
    ["IN_BETWEEN", 1.5, /non-negative safe integer/],
    ["IN_BETWEEN", Number.NaN, /non-negative safe integer/],
  ] as const)("rejects invalid request (%s, %s) without mutation", (room, tick, message) => {
    const {bus, authority} = make();
    const before = authority.snapshot();
    expect(() => authority.request(room, tick)).toThrow(message);
    expect(authority.snapshot()).toEqual(before);
    expect(bus.flush()).toEqual([]);
  });

  it("rejects same-room, concurrent, and backward requests without partial mutation", () => {
    const same = make();
    const sameBefore = same.authority.snapshot();
    expect(() => same.authority.request("INFORMATION", 1)).toThrow(/differ/);
    expect(same.authority.snapshot()).toEqual(sameBefore);
    expect(same.bus.flush()).toEqual([]);

    const concurrent = make();
    concurrent.authority.request("IN_BETWEEN", 2);
    const concurrentBefore = concurrent.authority.snapshot();
    expect(() => concurrent.authority.request("POLARIZED", 3)).toThrow(/concurrent/);
    expect(concurrent.authority.snapshot()).toEqual(concurrentBefore);
    expect(concurrent.bus.flush()).toHaveLength(1);

    const backward = make();
    backward.authority.advance(10);
    const backwardBefore = backward.authority.snapshot();
    expect(() => backward.authority.request("IN_BETWEEN", 9)).toThrow(/backward/);
    expect(() => backward.authority.advance(9)).toThrow(/backward/);
    expect(backward.authority.snapshot()).toEqual(backwardBefore);
    expect(backward.bus.flush()).toEqual([]);
  });

  it("rejects deadline overflow before claiming an occurrence or changing state", () => {
    const {bus, authority} = make();
    const before = authority.snapshot();
    expect(() => authority.request("IN_BETWEEN", Number.MAX_SAFE_INTEGER - 77)).toThrow(
      /safe tick range/,
    );
    expect(authority.snapshot()).toEqual(before);
    expect(bus.flush()).toEqual([]);
  });

  it("rejects event-count overflow before enqueue or state mutation", () => {
    const {bus, authority} = make();
    Object.assign(authority as unknown as {eventCountValue: number}, {
      eventCountValue: Number.MAX_SAFE_INTEGER,
    });
    const before = authority.snapshot();
    expect(() => authority.request("IN_BETWEEN", 1)).toThrow(/event sequence/);
    expect(authority.snapshot()).toEqual(before);
    expect(bus.flush()).toEqual([]);
  });

  it("keeps state unchanged if the shared event bus rejects request or advance", () => {
    const requestBus = new CanonicalEventBus();
    requestBus.enqueue({
      id: "room.transition.complete",
      tick120: 10,
      entityStableId: "external:room",
      localSequence: 0,
      occurrenceKey: "external:closed-request-tick",
      payload: {generation: 99, room: "INFORMATION"},
    });
    requestBus.flush();
    const requestAuthority = new RoomTransitionAuthority(requestBus, "INFORMATION");
    const requestBefore = requestAuthority.snapshot();
    expect(() => requestAuthority.request("IN_BETWEEN", 10)).toThrow(/already closed/);
    expect(requestAuthority.snapshot()).toEqual(requestBefore);

    const advance = make();
    advance.authority.request("IN_BETWEEN", 20);
    advance.bus.flush();
    advance.bus.enqueue({
      id: "room.transition.complete",
      tick120: 200,
      entityStableId: "external:room",
      localSequence: 0,
      occurrenceKey: "external:closed-advance-ticks",
      payload: {generation: 99, room: "INFORMATION"},
    });
    advance.bus.flush();
    const advanceBefore = advance.authority.snapshot();
    expect(() => advance.authority.advance(200)).toThrow(/already closed/);
    expect(advance.authority.snapshot()).toEqual(advanceBefore);
  });
});
