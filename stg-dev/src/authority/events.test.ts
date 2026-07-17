import {describe, expect, it} from "vitest";
import eventSchema from "../../../1bit-stg-complete-asset-kit-v4/manifests/runtime/event-schema-v4.json";
import {
  assertCanonicalEventEnvelope,
  CANONICAL_EVENT_IDS,
  CANONICAL_EVENT_REGISTRY,
  CanonicalEventBus,
  EVENT_PHASE_PRIORITY,
  EVENT_SCHEMA_ID,
  EVENT_SCHEMA_VERSION,
  serializeCanonicalEvents,
  simulationTimeMsForTick,
  type GameplayEventDraft,
  type ReadonlyFeedbackSink,
} from "./events";

const damageDraft = (overrides: Partial<GameplayEventDraft> = {}): GameplayEventDraft => ({
  id: "player.damage.commit",
  tick120: 12,
  entityStableId: "player:0",
  localSequence: 0,
  occurrenceKey: "damage:12:0",
  payload: {amount: 1, healthAfter: 2, sourceId: "projectile:9", branch: "non-fatal"},
  ...overrides,
});

describe("V4 canonical event registry", () => {
  it("loads the 72 unique IDs directly from the V4 schema", () => {
    const schemaIds = eventSchema.events.map((event) => event.id);
    expect(EVENT_SCHEMA_VERSION).toBe("4.0.0");
    expect(EVENT_SCHEMA_ID).toBe("1bit.event-schema.v4");
    expect(CANONICAL_EVENT_IDS).toHaveLength(72);
    expect(new Set(CANONICAL_EVENT_IDS)).toHaveLength(72);
    expect(CANONICAL_EVENT_IDS).toEqual(schemaIds);
    expect(Object.keys(CANONICAL_EVENT_REGISTRY)).toEqual(schemaIds);
  });

  it("rejects unknown IDs instead of creating aliases", () => {
    const bus = new CanonicalEventBus();
    expect(() => bus.enqueue(damageDraft({id: "player.damage"}))).toThrow(
      /unknown canonical gameplay event id/,
    );
    expect(bus.events()).toEqual([]);
  });
});

describe("envelope and payload validation", () => {
  it("checks required payload fields and commits a valid immutable envelope", () => {
    const bus = new CanonicalEventBus();
    bus.enqueue(damageDraft());
    const event = bus.flush()[0];
    expect(event).toBeDefined();
    assertCanonicalEventEnvelope(event);
    expect(event).toMatchObject({
      authority: "gameplay",
      tick120: 12,
      simulationTimeMs: 100,
      phasePriority: EVENT_PHASE_PRIORITY.stateOrDamageCommit,
      sequence: 0,
    });
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event?.payload)).toBe(true);

    expect(() => new CanonicalEventBus().enqueue(damageDraft({
      payload: {amount: 1, healthAfter: 2, sourceId: "projectile:9"},
    }))).toThrow(/missing required payload field: branch/);
    expect(() => new CanonicalEventBus().enqueue(damageDraft({
      payload: {amount: Number.NaN, healthAfter: 2, sourceId: "projectile:9", branch: "non-fatal"},
    }))).toThrow(/non-finite number/);
  });

  it("validates V4 fields plus the 120Hz authority extension", () => {
    const bus = new CanonicalEventBus();
    bus.enqueue(damageDraft());
    const event = bus.flush()[0];
    expect(event).toBeDefined();
    const wrongAuthority = {...event, authority: "feedback"};
    expect(() => assertCanonicalEventEnvelope(wrongAuthority)).toThrow(/authority must be gameplay/);
    const fractionalTick = {...event, tick120: 12.5};
    expect(() => assertCanonicalEventEnvelope(fractionalTick)).toThrow(/non-negative safe integer/);
    const mismatchedTime = {...event, simulationTimeMs: 99};
    expect(() => assertCanonicalEventEnvelope(mismatchedTime)).toThrow(/derived exactly from tick120/);
    expect(simulationTimeMsForTick(1)).toBe(1000 / 120);
  });
});

describe("ordered authority bus", () => {
  it("deduplicates occurrence keys across pending and committed events", () => {
    const bus = new CanonicalEventBus();
    bus.enqueue(damageDraft());
    expect(() => bus.enqueue(damageDraft({localSequence: 1}))).toThrow(
      /duplicate authoritative occurrence key/,
    );
    bus.flush();
    expect(() => bus.enqueue(damageDraft({tick120: 13, localSequence: 2}))).toThrow(
      /duplicate authoritative occurrence key/,
    );
  });

  it("orders one tick by phase, stable entity ID, then local sequence", () => {
    const bus = new CanonicalEventBus();
    const tick120 = 30;
    bus.enqueue({
      id: "projectile.spawn.commit",
      tick120,
      entityStableId: "projectile:2",
      localSequence: 0,
      occurrenceKey: "spawn",
      payload: {instanceId: "projectile:2", generation: 1, archetypeId: "packet"},
    });
    bus.enqueue({
      id: "player.collision.on",
      tick120,
      entityStableId: "player:0",
      localSequence: 0,
      occurrenceKey: "collision-on",
      payload: {owner: "damage", reason: "lease-release"},
    });
    bus.enqueue(damageDraft({
      tick120,
      entityStableId: "player:z",
      localSequence: 1,
      occurrenceKey: "damage-z-1",
    }));
    bus.enqueue(damageDraft({
      tick120,
      entityStableId: "player:a",
      localSequence: 2,
      occurrenceKey: "damage-a-2",
    }));
    bus.enqueue(damageDraft({
      tick120,
      entityStableId: "player:a",
      localSequence: 1,
      occurrenceKey: "damage-a-1",
    }));
    bus.enqueue({
      id: "player.collision.off",
      tick120,
      entityStableId: "player:0",
      localSequence: 0,
      occurrenceKey: "collision-off",
      payload: {owner: "damage", reason: "hit"},
    });

    const events = bus.flush();
    expect(events.map((event) => event.occurrenceKey)).toEqual([
      "collision-off",
      "damage-a-1",
      "damage-a-2",
      "damage-z-1",
      "collision-on",
      "spawn",
    ]);
    expect(events.map((event) => event.sequence)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("dispatches feedback last and blocks every reverse gameplay write", () => {
    const bus = new CanonicalEventBus();
    bus.enqueue(damageDraft());
    bus.enqueue({
      id: "player.collision.off",
      tick120: 12,
      entityStableId: "player:0",
      localSequence: 0,
      occurrenceKey: "feedback-order-collision-off",
      payload: {owner: "damage", reason: "hit"},
    });
    bus.enqueue({
      id: "player.collision.on",
      tick120: 12,
      entityStableId: "player:0",
      localSequence: 1,
      occurrenceKey: "feedback-order-collision-on",
      payload: {owner: "damage", reason: "lease-release"},
    });
    bus.enqueue({
      id: "projectile.spawn.commit",
      tick120: 12,
      entityStableId: "projectile:0",
      localSequence: 0,
      occurrenceKey: "feedback-order-spawn",
      payload: {instanceId: "projectile:0", generation: 1, archetypeId: "packet"},
    });
    const observed: string[] = [];
    const sink: ReadonlyFeedbackSink = {
      consume(event, context) {
        observed.push(`${context.phasePriority}:${event.id}`);
        expect(context.phasePriority).toBe(EVENT_PHASE_PRIORITY.feedbackDispatch);
        expect(bus.events().map((entry) => entry.id)).toEqual([
          "player.collision.off",
          "player.damage.commit",
          "player.collision.on",
          "projectile.spawn.commit",
        ]);
        expect(Object.isFrozen(event)).toBe(true);
        expect(() => bus.enqueue(damageDraft({
          tick120: 13,
          occurrenceKey: "feedback-forged-damage",
        }))).toThrow(/feedback sinks cannot emit gameplay events/);
      },
    };
    bus.flush([sink]);
    expect(observed).toEqual([
      "4:player.collision.off",
      "4:player.damage.commit",
      "4:player.collision.on",
      "4:projectile.spawn.commit",
    ]);
    expect(bus.events()).toHaveLength(4);

    const returningSink = {
      consume: () => damageDraft({occurrenceKey: "returned-event"}),
    } as unknown as ReadonlyFeedbackSink;
    const secondBus = new CanonicalEventBus();
    secondBus.enqueue(damageDraft());
    expect(() => secondBus.flush([returningSink])).toThrow(
      /feedback sinks cannot return gameplay events or commands/,
    );
    expect(secondBus.events()).toHaveLength(1);
  });

  it("serializes canonically regardless of enqueue and payload key order", () => {
    const makeBus = (reverse: boolean): CanonicalEventBus => {
      const bus = new CanonicalEventBus();
      const early: GameplayEventDraft = {
        id: "player.damage.commit",
        tick120: 40,
        entityStableId: "player:0",
        localSequence: 0,
        occurrenceKey: "deterministic-damage",
        payload: reverse
          ? {sourceId: "p:1", branch: "non-fatal", healthAfter: 2, amount: 1, nested: {z: 2, a: 1}}
          : {amount: 1, healthAfter: 2, nested: {a: 1, z: 2}, branch: "non-fatal", sourceId: "p:1"},
      };
      const late: GameplayEventDraft = {
        id: "snapshot.complete",
        tick120: 41,
        entityStableId: "snapshot:0",
        localSequence: 0,
        occurrenceKey: "deterministic-snapshot",
        payload: {runId: "run:0"},
      };
      for (const draft of reverse ? [late, early] : [early, late]) bus.enqueue(draft);
      bus.flush();
      return bus;
    };

    const forward = makeBus(false);
    const reverse = makeBus(true);
    expect(forward.canonicalSerialization()).toBe(reverse.canonicalSerialization());
    expect(forward.canonicalSerialization()).toBe(serializeCanonicalEvents(forward.events()));
    expect(forward.canonicalSerialization()).toBe(forward.canonicalSerialization());
  });
});
