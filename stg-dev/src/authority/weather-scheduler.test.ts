import {describe, expect, it} from "vitest";

import {CanonicalEventBus, type CanonicalGameplayEvent} from "./events";
import {crossedTickCount} from "./tick120";
import {
  ECLIPSE_MINIMUM_RUN_ELAPSED_MS,
  WEATHER_RESIDUE_TOKENS,
  WeatherScheduler,
  clampPresentationBias,
  composeWeatherCycleSeed,
} from "./weather-scheduler";

const MIN_COOLDOWN_TICKS = crossedTickCount(70_000);
const MAX_COOLDOWN_TICKS = crossedTickCount(150_000);

const AUTHORED_RESIDUE_BY_CLASS: Readonly<Record<string, string>> = Object.freeze({
  STATIC: "characterPuddle",
  RAIN: "binaryPuddle",
  ASH: "routeAsh",
  WIND: "misalignedShadowScuff",
  ECLIPSE: "eclipseInversion",
});

function runSchedule(
  runSeed: number,
  roomId: string,
  visitIndex: number,
  throughTick120: number,
): {bus: CanonicalEventBus; scheduler: WeatherScheduler; events: readonly CanonicalGameplayEvent[]} {
  const bus = new CanonicalEventBus();
  const scheduler = new WeatherScheduler(bus, runSeed);
  scheduler.enterRoom(roomId, visitIndex, 0);
  scheduler.advanceTo(throughTick120);
  bus.flush();
  return {bus, scheduler, events: bus.events()};
}

function eventsOfCycle(
  events: readonly CanonicalGameplayEvent[],
  cycle: number,
): readonly CanonicalGameplayEvent[] {
  return events.filter((event) => event.payload["cycle"] === cycle);
}

describe("composeWeatherCycleSeed", () => {
  it("freezes the authored uint32 composition for the unspecified V4 hash", () => {
    // seed = runSeed ^ (visitIndex * 0x9E3779B9 mod 2^32) ^ (ordinal * 0x85EBCA6B mod 2^32)
    expect(composeWeatherCycleSeed(0, 0, 0)).toBe(0);
    expect(composeWeatherCycleSeed(7, 0, 0)).toBe(7);
    expect(composeWeatherCycleSeed(0x1234_5678, 3, 2)).toBe(3_276_124_037);
    expect(composeWeatherCycleSeed(0x1234_5678, 3, 2)).toBe(
      ((0x1234_5678 ^ (Math.imul(3, 0x9e37_79b9) >>> 0) ^ (Math.imul(2, 0x85eb_ca6b) >>> 0)) >>> 0),
    );
  });
});

describe("WeatherScheduler determinism", () => {
  it("produces an identical canonical schedule for the same run seed", () => {
    const first = runSchedule(0xdead_beef, "INFORMATION", 0, 72_000);
    const second = runSchedule(0xdead_beef, "INFORMATION", 0, 72_000);
    expect(first.events.length).toBeGreaterThan(5);
    expect(first.bus.canonicalSerialization()).toBe(second.bus.canonicalSerialization());
  });

  it("changes the schedule when the run seed changes", () => {
    const first = runSchedule(12_345, "INFORMATION", 0, 72_000);
    const second = runSchedule(54_321, "INFORMATION", 0, 72_000);
    expect(first.bus.canonicalSerialization()).not.toBe(second.bus.canonicalSerialization());
  });

  it("derives an independent stream per room visitIndex", () => {
    expect(composeWeatherCycleSeed(1001, 0, 0)).not.toBe(composeWeatherCycleSeed(1001, 1, 0));

    const visitZero = runSchedule(1001, "IN_BETWEEN", 0, 72_000);
    const visitOne = runSchedule(1001, "IN_BETWEEN", 1, 72_000);
    const firstOmenTick = (events: readonly CanonicalGameplayEvent[]): number => {
      const omen = events.find((event) => event.id === "weather.omen.begin");
      if (omen === undefined) throw new Error("expected at least one omen");
      return omen.tick120;
    };
    // Frozen composition: seed 1001 draws 81294ms (visit 0) vs 129034ms (visit 1).
    expect(firstOmenTick(visitZero.events)).toBe(crossedTickCount(81_294));
    expect(firstOmenTick(visitOne.events)).toBe(crossedTickCount(129_034));
  });
});

describe("WeatherScheduler cooldown windows", () => {
  it("honors the authored 70-150s cooldown on the integer tick grid", () => {
    const {events} = runSchedule(0x0bad_cafe, "IN_BETWEEN", 0, 144_000);
    const cooldowns = events.filter((event) => event.id === "weather.cooldown.begin");
    const omens = events.filter((event) => event.id === "weather.omen.begin");
    const completes = events.filter((event) => event.id === "weather.complete");
    expect(cooldowns.length).toBeGreaterThanOrEqual(3);
    expect(omens.length).toBeGreaterThanOrEqual(3);

    const firstCooldown = cooldowns[0];
    if (firstCooldown === undefined) throw new Error("expected a first cooldown");
    expect(firstCooldown.tick120).toBe(0);

    for (const [index, omen] of omens.entries()) {
      const cooldown = cooldowns[index];
      if (cooldown === undefined) throw new Error("expected a cooldown per omen");
      const gapTicks = omen.tick120 - cooldown.tick120;
      expect(Number.isSafeInteger(gapTicks)).toBe(true);
      expect(gapTicks).toBeGreaterThanOrEqual(MIN_COOLDOWN_TICKS);
      expect(gapTicks).toBeLessThanOrEqual(MAX_COOLDOWN_TICKS);
      expect(gapTicks).toBe(crossedTickCount(cooldown.payload["cooldownMs"] as number));
    }

    // The next cycle's cooldown starts exactly at the previous completion tick.
    for (const [index, complete] of completes.entries()) {
      const nextCooldown = cooldowns[index + 1];
      if (nextCooldown === undefined) continue;
      expect(nextCooldown.tick120).toBe(complete.tick120);
      expect(nextCooldown.sequence).toBeGreaterThan(complete.sequence);
    }
  });
});

describe("WeatherScheduler lifecycle", () => {
  it("emits omen -> active -> aftermath in canonical order with derived timing", () => {
    const {events} = runSchedule(42, "FORCED_ALIGNMENT", 0, 72_000);
    const cycleZero = eventsOfCycle(events, 0);
    expect(cycleZero.map((event) => event.id)).toEqual([
      "weather.cooldown.begin",
      "weather.omen.begin",
      "weather.active.begin",
      "weather.aftermath.begin",
      "weather.complete",
    ]);
    for (let index = 1; index < cycleZero.length; index += 1) {
      const previous = cycleZero[index - 1];
      const current = cycleZero[index];
      if (previous === undefined || current === undefined) throw new Error("cycle truncated");
      expect(current.tick120).toBeGreaterThanOrEqual(previous.tick120);
      expect(current.sequence).toBeGreaterThan(previous.sequence);
    }

    const omen = cycleZero[1];
    const active = cycleZero[2];
    if (omen === undefined || active === undefined) throw new Error("cycle truncated");
    expect(omen.payload["activeAtMs"]).toBe(active.simulationTimeMs);
    const weatherId = omen.payload["weather"];
    expect(typeof weatherId).toBe("string");
    for (const event of cycleZero) expect(event.payload["weather"]).toBe(weatherId);
  });

  it("walks snapshot phases and records the authored room-local residue", () => {
    const probe = runSchedule(4242, "POLARIZED", 0, 72_000);
    const cycleZero = eventsOfCycle(probe.events, 0);
    const [cooldown, omen, active, aftermath, complete] = cycleZero;
    if (
      cooldown === undefined || omen === undefined || active === undefined
      || aftermath === undefined || complete === undefined
    ) {
      throw new Error("cycle truncated");
    }

    const bus = new CanonicalEventBus();
    const scheduler = new WeatherScheduler(bus, 4242);
    expect(scheduler.snapshot().phase).toBe("idle");

    scheduler.enterRoom("POLARIZED", 0, 0);
    scheduler.advanceTo(omen.tick120 - 1);
    expect(scheduler.snapshot().phase).toBe("cooldown");
    expect(scheduler.snapshot().classId).toBeNull();
    expect(scheduler.snapshot().residues).toEqual([]);

    scheduler.advanceTo(omen.tick120);
    expect(scheduler.snapshot().phase).toBe("omen");
    expect(scheduler.snapshot().classId).toBe(omen.payload["weather"]);

    scheduler.advanceTo(active.tick120);
    const activeSnapshot = scheduler.snapshot();
    expect(activeSnapshot.phase).toBe("active");
    expect(activeSnapshot.witnessFacePlayerException).toBe(
      activeSnapshot.classId === "ECLIPSE",
    );

    scheduler.advanceTo(aftermath.tick120);
    const aftermathSnapshot = scheduler.snapshot();
    expect(aftermathSnapshot.phase).toBe("aftermath");
    expect(aftermathSnapshot.residues).toHaveLength(1);
    const residue = aftermathSnapshot.residues[0];
    if (residue === undefined) throw new Error("expected a residue fact");
    expect(residue.weather).toBe(omen.payload["weather"]);
    expect(residue.residue).toBe(AUTHORED_RESIDUE_BY_CLASS[residue.weather]);
    expect(residue.persistence).toBe("room-local");
    expect((WEATHER_RESIDUE_TOKENS as readonly string[])).toContain(residue.residue);

    scheduler.advanceTo(complete.tick120);
    const completeSnapshot = scheduler.snapshot();
    expect(completeSnapshot.phase).toBe("cooldown");
    expect(completeSnapshot.classId).toBeNull();
    expect(completeSnapshot.residues).toHaveLength(1);

    // Residues are room-local: entering another room clears the slate.
    scheduler.enterRoom("INFORMATION", 0, complete.tick120 + 1);
    expect(scheduler.snapshot().residues).toEqual([]);
  });
});

describe("WeatherScheduler ECLIPSE rarity gate", () => {
  it("never begins ECLIPSE before 180s elapsed and one completed cycle", () => {
    let eclipseOmenCount = 0;
    for (let runSeed = 0; runSeed < 150; runSeed += 1) {
      const {events} = runSchedule(runSeed, "POLARIZED", 0, 72_000);
      for (const event of events) {
        if (event.id !== "weather.omen.begin") continue;
        if (event.payload["weather"] !== "ECLIPSE") continue;
        eclipseOmenCount += 1;
        expect(event.simulationTimeMs).toBeGreaterThanOrEqual(ECLIPSE_MINIMUM_RUN_ELAPSED_MS);
        expect(event.payload["cycle"] as number).toBeGreaterThanOrEqual(1);
      }
      // Cycle 0 can never satisfy completedCount >= 1.
      const cycleZeroOmen = events.find(
        (event) => event.id === "weather.omen.begin" && event.payload["cycle"] === 0,
      );
      if (cycleZeroOmen !== undefined) {
        expect(cycleZeroOmen.payload["weather"]).not.toBe("ECLIPSE");
        expect(cycleZeroOmen.simulationTimeMs).toBeLessThan(ECLIPSE_MINIMUM_RUN_ELAPSED_MS);
      }
    }
    // The gate must be tested against reachable ECLIPSE selections.
    expect(eclipseOmenCount).toBeGreaterThan(0);
  });
});

describe("WeatherScheduler presentation-only boundary", () => {
  it("clamps behavior bias into the authored +/-30% presentation envelope", () => {
    expect(clampPresentationBias(0.75)).toBe(0.3);
    expect(clampPresentationBias(-2)).toBe(-0.3);
    expect(clampPresentationBias(0.12)).toBe(0.12);
    expect(clampPresentationBias(-0.05)).toBe(-0.05);
    expect(() => clampPresentationBias(0.1, -1)).toThrow();
    expect(() => clampPresentationBias(Number.NaN)).toThrow();

    const {scheduler} = runSchedule(9, "INFORMATION", 0, 1);
    const biasView = scheduler.snapshot().biasView;
    const staticBias = biasView["STATIC"];
    if (staticBias === undefined) throw new Error("expected STATIC bias view");
    expect(staticBias["meanLight"]).toBe(0.22);
    for (const classBias of Object.values(biasView)) {
      for (const value of Object.values(classBias)) {
        expect(Math.abs(value)).toBeLessThanOrEqual(0.3);
      }
    }
  });

  it("exposes no gameplay write surface and emits only weather.* commit-phase facts", () => {
    const publicApi = Object.getOwnPropertyNames(WeatherScheduler.prototype).sort();
    expect(publicApi).toEqual(["advanceTo", "constructor", "enterRoom", "snapshot"]);

    const {events, scheduler} = runSchedule(77, "IN_BETWEEN", 0, 72_000);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.id.startsWith("weather.")).toBe(true);
      // stateOrDamageCommit only: never collision-off/on or spawn phases.
      expect(event.phasePriority).toBe(1);
    }

    const snapshot = scheduler.snapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.biasView)).toBe(true);
    expect(Object.isFrozen(snapshot.residues)).toBe(true);
    for (const residue of snapshot.residues) expect(Object.isFrozen(residue)).toBe(true);
  });

  it("fails closed on invalid construction and inputs", () => {
    const bus = new CanonicalEventBus();
    expect(() => new WeatherScheduler({} as CanonicalEventBus, 1)).toThrow();
    expect(() => new WeatherScheduler(bus, -1)).toThrow();
    expect(() => new WeatherScheduler(bus, 2 ** 32)).toThrow();
    expect(() => new WeatherScheduler(bus, 0.5)).toThrow();

    const scheduler = new WeatherScheduler(bus, 1);
    expect(() => scheduler.enterRoom("UNKNOWN_ROOM", 0, 0)).toThrow();
    expect(() => scheduler.enterRoom("INFORMATION", -1, 0)).toThrow();
    expect(() => scheduler.enterRoom("INFORMATION", 0.5, 0)).toThrow();
    expect(() => scheduler.advanceTo(-1)).toThrow();

    scheduler.enterRoom("INFORMATION", 0, 100);
    expect(() => scheduler.advanceTo(99)).toThrow();
    expect(() => scheduler.enterRoom("IN_BETWEEN", 0, 99)).toThrow();
  });
});
