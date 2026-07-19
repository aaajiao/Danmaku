import {describe, expect, it} from "vitest";

import {EventTrace} from "../../../1bit-stg-complete-asset-kit-v4/runtime/events.ts";
import {
  GazeMachine as V4GazeMachine,
  type GazeSample,
} from "../../../1bit-stg-complete-asset-kit-v4/runtime/perception.ts";

import {tick120ToMilliseconds} from "./clock";
import {CanonicalEventBus} from "./events";
import {
  GAZE_AUTHORITY_CONTRACT,
  GazeAuthority,
} from "./gaze";

const qualified = (overrides: Partial<GazeSample> = {}): GazeSample => ({
  skyEyeVisible: true,
  pitchDegrees: 60,
  alignment: 1,
  ...overrides,
});
const unqualified = (overrides: Partial<GazeSample> = {}): GazeSample => ({
  skyEyeVisible: true,
  pitchDegrees: 0,
  alignment: 1,
  ...overrides,
});

function comparableCanonicalEvents(bus: CanonicalEventBus): readonly unknown[] {
  return bus.flush().map((event) => ({
    id: event.id,
    simulationTimeMs: event.simulationTimeMs,
    occurrenceKey: event.occurrenceKey,
    payload: event.payload,
  }));
}

function comparableOracleEvents(trace: EventTrace): readonly unknown[] {
  return trace.events().map((event) => ({
    id: event.id,
    simulationTimeMs: event.simulationTimeMs,
    occurrenceKey: event.occurrenceKey,
    payload: event.payload,
  }));
}

describe("V4 gaze authority", () => {
  it("pins the manifest FSM and immutable runtime parameters to exact tick120 durations", () => {
    expect(GAZE_AUTHORITY_CONTRACT).toEqual({
      source: "state-machines-v4+runtime-perception",
      pitchThresholdDegrees: 45,
      alignmentThreshold: 0.72,
      acquireMs: 500,
      acquireTicks120: 60,
      releaseDelayMs: 450,
      releaseDelayTicks120: 54,
      forcedIntensity: 0.1,
    });
    expect(Object.isFrozen(GAZE_AUTHORITY_CONTRACT)).toBe(true);
  });

  it("matches the V4 oracle across cancel, clamp, release-cancel, and release", () => {
    const trace = new EventTrace();
    const oracle = new V4GazeMachine(trace);
    const bus = new CanonicalEventBus();
    const authority = new GazeAuthority(bus);
    const observe = (sample: GazeSample, tick120: number): void => {
      oracle.observe(sample, tick120ToMilliseconds(tick120));
      const snapshot = authority.observe(sample, tick120);
      expect(snapshot.state).toBe(oracle.state);
      expect(snapshot.clampActive).toBe(oracle.clampActive);
    };
    const advance = (tick120: number): void => {
      oracle.advance(tick120ToMilliseconds(tick120));
      const snapshot = authority.advance(tick120);
      expect(snapshot.state).toBe(oracle.state);
      expect(snapshot.clampActive).toBe(oracle.clampActive);
    };

    observe(qualified(), 0);
    observe(unqualified(), 24);
    observe(qualified(), 36);
    advance(96);
    observe(unqualified(), 108);
    observe(qualified(), 120);
    observe(unqualified(), 132);
    advance(186);

    expect(comparableCanonicalEvents(bus)).toEqual(comparableOracleEvents(trace));
    expect(authority.snapshot()).toMatchObject({
      tick120: 186,
      state: "idle",
      clampActive: false,
      cycle: 2,
      releaseAttempt: 2,
      deadlineTick120: null,
      eventCount: 8,
    });
  });

  it("preserves V4 advance-before-observe ordering when a deadline and sample share a tick", () => {
    const trace = new EventTrace();
    const oracle = new V4GazeMachine(trace);
    const bus = new CanonicalEventBus();
    const authority = new GazeAuthority(bus);

    oracle.observe(qualified(), 0);
    authority.observe(qualified(), 0);
    oracle.observe(unqualified(), 500);
    authority.observe(unqualified(), 60);
    oracle.advance(950);
    authority.advance(114);
    oracle.observe(qualified(), 950);
    authority.observe(qualified(), 114);

    expect(comparableCanonicalEvents(bus)).toEqual(comparableOracleEvents(trace));
    expect(trace.events().map((event) => event.id)).toEqual([
      "gaze.acquire.begin",
      "gaze.clamp.commit",
      "gaze.release.begin",
      "gaze.clamp.release",
      "gaze.acquire.begin",
    ]);
    expect(authority.snapshot()).toMatchObject({
      state: "acquiring",
      cycle: 2,
      releaseAttempt: 0,
      deadlineTick120: 174,
    });
  });

  it("uses inclusive thresholds, V4 alignment clamping, and sky-eye visibility", () => {
    const bus = new CanonicalEventBus();
    const authority = new GazeAuthority(bus);

    authority.observe(qualified({
      pitchDegrees: GAZE_AUTHORITY_CONTRACT.pitchThresholdDegrees,
      alignment: 4,
    }), 0);
    expect(authority.snapshot().state).toBe("acquiring");
    authority.observe(qualified({skyEyeVisible: false}), 1);
    expect(authority.snapshot().state).toBe("idle");
    authority.observe(qualified({
      pitchDegrees: GAZE_AUTHORITY_CONTRACT.pitchThresholdDegrees,
      alignment: GAZE_AUTHORITY_CONTRACT.alignmentThreshold,
    }), 2);
    expect(authority.snapshot().state).toBe("acquiring");
    authority.observe(qualified({alignment: -4}), 3);
    expect(authority.snapshot().state).toBe("idle");

    expect(bus.flush().map((event) => event.id)).toEqual([
      "gaze.acquire.begin",
      "gaze.acquire.cancel",
      "gaze.acquire.begin",
      "gaze.acquire.cancel",
    ]);
  });

  it("returns copied frozen snapshots without exposing a command surface", () => {
    const authority = new GazeAuthority(new CanonicalEventBus(), {authorityId: "eye:gaze"});
    const initial = authority.snapshot();
    expect(initial).toEqual({
      authority: "v4-gaze",
      authorityId: "eye:gaze",
      tick120: null,
      state: "idle",
      clampActive: false,
      cycle: 0,
      releaseAttempt: 0,
      deadlineTick120: null,
      eventCount: 0,
    });
    expect(Object.isFrozen(initial)).toBe(true);

    const next = authority.observe(qualified(), 9);
    expect(Object.isFrozen(next)).toBe(true);
    expect(Reflect.set(next as object, "state", "clamped")).toBe(false);
    expect(authority.snapshot()).not.toBe(next);
    expect(authority.snapshot()).toEqual(next);
  });

  it("rejects malformed samples, accessors, invalid ticks, and backward time without mutation", () => {
    const bus = new CanonicalEventBus();
    const authority = new GazeAuthority(bus);
    authority.observe(qualified(), 8);
    const before = authority.snapshot();

    for (const tick of [-1, -0, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => authority.advance(tick)).toThrow(/tick120/);
      expect(authority.snapshot()).toEqual(before);
    }
    expect(() => authority.advance(7)).toThrow(/cannot move backward/);
    expect(authority.snapshot()).toEqual(before);

    for (const sample of [
      qualified({pitchDegrees: Number.NaN}),
      qualified({alignment: Number.POSITIVE_INFINITY}),
      qualified({skyEyeVisible: 1 as unknown as boolean}),
    ]) {
      expect(() => authority.observe(sample, 9)).toThrow();
      expect(authority.snapshot()).toEqual(before);
    }

    let reads = 0;
    const accessorSample = {
      get skyEyeVisible() {
        reads += 1;
        return true;
      },
      pitchDegrees: 60,
      alignment: 1,
    } as GazeSample;
    expect(() => authority.observe(accessorSample, 9)).toThrow(/must not be an accessor/);
    expect(reads).toBe(0);
    expect(authority.snapshot()).toEqual(before);
  });

  it("captures options without invoking accessors", () => {
    let reads = 0;
    const options = Object.defineProperty({}, "authorityId", {
      enumerable: true,
      get() {
        reads += 1;
        return "gaze:test";
      },
    });
    expect(() => new GazeAuthority(new CanonicalEventBus(), options)).toThrow(/must not be an accessor/);
    expect(reads).toBe(0);
    expect(() => new GazeAuthority(new CanonicalEventBus(), {authorityId: " "})).toThrow(
      /non-empty string/,
    );
  });

  it("does not mutate its FSM or consume a cycle when the canonical bus rejects a write", () => {
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
    const authority = new GazeAuthority(bus);
    const before = authority.snapshot();

    expect(() => authority.observe(qualified(), 5)).toThrow(/tick 5 is already closed/);
    expect(authority.snapshot()).toEqual(before);

    expect(authority.observe(qualified(), 6)).toMatchObject({
      tick120: 6,
      state: "acquiring",
      cycle: 1,
      eventCount: 1,
    });
    const [event] = bus.flush();
    expect(event?.occurrenceKey).toBe("gaze:1:acquire");
  });

  it("fails atomically when a crossed deadline is already closed on the event bus", () => {
    const bus = new CanonicalEventBus();
    const authority = new GazeAuthority(bus);
    authority.observe(qualified(), 1);
    bus.flush();
    bus.enqueue({
      id: "player.invulnerability.begin",
      tick120: 61,
      entityStableId: "player",
      localSequence: 0,
      occurrenceKey: "player:invulnerability:61",
      payload: {reason: "close-gaze-deadline"},
    });
    bus.flush();
    const before = authority.snapshot();

    expect(() => authority.advance(80)).toThrow(/tick 61 is already closed/);
    expect(authority.snapshot()).toEqual(before);
  });
});
