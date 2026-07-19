import {describe, expect, it} from "vitest";

import {EventTrace} from "../../../1bit-stg-complete-asset-kit-v4/runtime/events.ts";
import {
  FlowerIntensityResolver as V4FlowerIntensityResolver,
  type FlowerInputs,
} from "../../../1bit-stg-complete-asset-kit-v4/runtime/perception.ts";

import {CanonicalEventBus, simulationTimeMsForTick} from "./events";
import {FlowerIntensityAuthority} from "./flower";

const baseInputs = (overrides: Partial<FlowerInputs> = {}): FlowerInputs => ({
  signalIntensity: 0.8,
  focusActive: false,
  gazeClampActive: false,
  overrideActive: false,
  ...overrides,
});

describe("V4 flower intensity authority", () => {
  it("uses the immutable V4 resolver for priority, clamping, and change events", () => {
    const samples = [
      baseInputs(),
      baseInputs({focusActive: true}),
      baseInputs({focusActive: true, gazeClampActive: true}),
      baseInputs({
        signalIntensity: 0.1,
        focusActive: true,
        gazeClampActive: true,
        overrideActive: true,
      }),
      baseInputs({signalIntensity: -4}),
      baseInputs({signalIntensity: 7}),
    ] as const;
    const trace = new EventTrace();
    const oracle = new V4FlowerIntensityResolver(trace);
    const bus = new CanonicalEventBus();
    const authority = new FlowerIntensityAuthority(bus);

    const oracleResolutions = samples.map((inputs, tick120) =>
      oracle.resolve(inputs, simulationTimeMsForTick(tick120)));
    const authorityResolutions = samples.map((inputs, tick120) =>
      authority.resolve(inputs, tick120));

    expect(authorityResolutions).toEqual(oracleResolutions);
    const committed = bus.flush();
    expect(committed.map(({id, tick120, simulationTimeMs, entityStableId, occurrenceKey, payload}) => ({
      id,
      tick120,
      simulationTimeMs,
      entityStableId,
      occurrenceKey,
      payload,
    }))).toEqual(trace.events().map((event, tick120) => ({
      id: event.id,
      tick120,
      simulationTimeMs: event.simulationTimeMs,
      entityStableId: "flower",
      occurrenceKey: event.occurrenceKey,
      payload: event.payload,
    })));
    expect(committed.map((event) => event.payload.source)).toEqual([
      "signal",
      "focus",
      "gaze",
      "override",
      "signal",
      "signal",
    ]);
  });

  it("passes optional resolver parameters through to V4 without adding a signal policy", () => {
    const trace = new EventTrace();
    const oracle = new V4FlowerIntensityResolver(trace, 2, -1);
    const bus = new CanonicalEventBus();
    const authority = new FlowerIntensityAuthority(bus, {
      authorityId: "flower:custom",
      gazeIntensity: 2,
      focusCap: -1,
    });
    const samples = [
      baseInputs({signalIntensity: 0.62, focusActive: true}),
      baseInputs({signalIntensity: 0.62, focusActive: true, gazeClampActive: true}),
      baseInputs({signalIntensity: 0.37}),
    ] as const;

    expect(samples.map((inputs, tick120) => authority.resolve(inputs, tick120))).toEqual(
      samples.map((inputs, tick120) =>
        oracle.resolve(inputs, simulationTimeMsForTick(tick120))),
    );
    expect(bus.flush().map((event) => ({
      occurrenceKey: event.occurrenceKey,
      source: event.payload.source,
      targetIntensity: event.payload.targetIntensity,
    }))).toEqual([
      {occurrenceKey: "flower:custom:1", source: "focus", targetIntensity: 0},
      {occurrenceKey: "flower:custom:2", source: "gaze", targetIntensity: 1},
      {occurrenceKey: "flower:custom:3", source: "signal", targetIntensity: 0.37},
    ]);
  });

  it("emits only resolution changes with gap-free stable occurrence identities", () => {
    const bus = new CanonicalEventBus();
    const authority = new FlowerIntensityAuthority(bus);

    authority.resolve(baseInputs({signalIntensity: 0.25}), 0);
    authority.resolve(baseInputs({signalIntensity: 0.25}), 1);
    authority.resolve(baseInputs({signalIntensity: 0.2, focusActive: true}), 2);
    authority.resolve(baseInputs({signalIntensity: 0.3, focusActive: true}), 3);
    authority.resolve(baseInputs({signalIntensity: 0.9, focusActive: true}), 4);
    authority.resolve(baseInputs({signalIntensity: 1, focusActive: true}), 5);
    authority.resolve(baseInputs({gazeClampActive: true}), 5);
    authority.resolve(baseInputs({gazeClampActive: true, overrideActive: true}), 5);

    const events = bus.flush();
    expect(events.map((event) => event.occurrenceKey)).toEqual([
      "flower:1",
      "flower:2",
      "flower:3",
      "flower:4",
      "flower:5",
      "flower:6",
    ]);
    expect(events.map((event) => event.localSequence)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(events.map((event) => event.tick120)).toEqual([0, 2, 3, 4, 5, 5]);
    expect(authority.snapshot()).toMatchObject({
      tick120: 5,
      commitCount: 6,
      resolution: {source: "override", targetIntensity: 1},
    });
  });

  it("exposes copied, deeply frozen read-only observations", () => {
    const bus = new CanonicalEventBus();
    const authority = new FlowerIntensityAuthority(bus);
    const initial = authority.snapshot();
    expect(Object.isFrozen(initial)).toBe(true);
    expect(initial).toEqual({
      authority: "v4-flower-intensity",
      authorityId: "flower",
      tick120: null,
      commitCount: 0,
      resolution: null,
    });

    const inputs = baseInputs({signalIntensity: 0.42});
    const returned = authority.resolve(inputs, 12);
    const snapshot = authority.snapshot();
    expect(Object.isFrozen(returned)).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.resolution)).toBe(true);
    expect(Reflect.set(snapshot.resolution as object, "targetIntensity", 1)).toBe(false);

    (inputs as {signalIntensity: number}).signalIntensity = 0.99;
    expect(snapshot.resolution).toEqual({source: "signal", targetIntensity: 0.42});
    expect(authority.snapshot()).not.toBe(snapshot);
    const [event] = bus.flush();
    expect(Object.isFrozen(event?.payload)).toBe(true);
    expect(event?.payload).toEqual({source: "signal", targetIntensity: 0.42});
  });

  it("rejects malformed inputs, accessors, invalid ticks, and backward time without mutation", () => {
    const bus = new CanonicalEventBus();
    const authority = new FlowerIntensityAuthority(bus);
    authority.resolve(baseInputs({signalIntensity: 0.4}), 8);
    const before = authority.snapshot();

    for (const tick of [-1, -0, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => authority.resolve(baseInputs(), tick)).toThrow(/tick120/);
      expect(authority.snapshot()).toEqual(before);
    }
    expect(() => authority.resolve(baseInputs(), 7)).toThrow(/cannot move backward/);
    expect(authority.snapshot()).toEqual(before);

    for (const signalIntensity of [Number.NaN, Number.POSITIVE_INFINITY, "0.5"]) {
      expect(() => authority.resolve(
        baseInputs({signalIntensity: signalIntensity as number}),
        9,
      )).toThrow(/signalIntensity must be finite/);
      expect(authority.snapshot()).toEqual(before);
    }
    expect(() => authority.resolve(
      baseInputs({focusActive: 1 as unknown as boolean}),
      9,
    )).toThrow(/focusActive must be boolean/);
    expect(authority.snapshot()).toEqual(before);

    let reads = 0;
    const accessorInput = {
      get signalIntensity() {
        reads += 1;
        return 0.5;
      },
      focusActive: false,
      gazeClampActive: false,
      overrideActive: false,
    } as FlowerInputs;
    expect(() => authority.resolve(accessorInput, 9)).toThrow(/must not be an accessor/);
    expect(reads).toBe(0);
    expect(authority.snapshot()).toEqual(before);
  });

  it("captures options without invoking accessors and validates resolver parameters", () => {
    let reads = 0;
    const accessorOptions = Object.defineProperty({}, "gazeIntensity", {
      enumerable: true,
      get() {
        reads += 1;
        return 0.1;
      },
    });
    expect(() => new FlowerIntensityAuthority(
      new CanonicalEventBus(),
      accessorOptions,
    )).toThrow(/must not be an accessor/);
    expect(reads).toBe(0);
    expect(() => new FlowerIntensityAuthority(new CanonicalEventBus(), {
      gazeIntensity: Number.NaN,
    })).toThrow(/gazeIntensity must be finite/);
    expect(() => new FlowerIntensityAuthority(new CanonicalEventBus(), {
      focusCap: Number.POSITIVE_INFINITY,
    })).toThrow(/focusCap must be finite/);
    expect(() => new FlowerIntensityAuthority(new CanonicalEventBus(), {
      authorityId: " ",
    })).toThrow(/authorityId must be a non-empty string/);
  });

  it("does not consume state or an occurrence when the canonical bus rejects the write", () => {
    const bus = new CanonicalEventBus();
    bus.enqueue({
      id: "player.invulnerability.begin",
      tick120: 5,
      entityStableId: "player",
      localSequence: 0,
      occurrenceKey: "player:invulnerability:5",
      payload: {reason: "test-boundary"},
    });
    bus.flush();
    const authority = new FlowerIntensityAuthority(bus);
    const before = authority.snapshot();

    expect(() => authority.resolve(baseInputs({signalIntensity: 0.4}), 5)).toThrow(
      /tick 5 is already closed/,
    );
    expect(authority.snapshot()).toEqual(before);

    expect(authority.resolve(baseInputs({signalIntensity: 0.4}), 6)).toEqual({
      source: "signal",
      targetIntensity: 0.4,
    });
    expect(authority.snapshot()).toMatchObject({tick120: 6, commitCount: 1});
    const newEvents = bus.flush();
    expect(newEvents).toHaveLength(1);
    expect(newEvents[0]?.occurrenceKey).toBe("flower:1");
  });
});
