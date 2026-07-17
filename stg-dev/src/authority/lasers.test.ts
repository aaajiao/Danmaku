import {describe, expect, it} from "vitest";
import {CanonicalEventBus, type CanonicalGameplayEvent} from "./events";
import {
  LASER_DEFINITIONS,
  LASER_TICK_HZ,
  LASER_VIEW_HEIGHT,
  LaserAuthority,
  buildLaserWarningFootprint,
  compileLaserGeometry,
  laserDefinition,
  laserIntersectsPlayerBetweenTicks,
  millisecondsToAuthorityTicks,
  playerSweepIntersectsCapsule,
  warningFootprintCoversSnapshot,
  type CapsuleSegment,
  type LaserDefinition,
  type Vec2,
} from "./lasers";

const position = (x: number, y: number): Vec2 => ({x, y});

function completeTick(definition: LaserDefinition, startTick120 = 0): number {
  const timing = definition.lifecycle.timingMs;
  const activeTick = startTick120
    + millisecondsToAuthorityTicks(timing.telegraph + timing.charge + timing.grow);
  const terminalTick = activeTick + millisecondsToAuthorityTicks(timing.live);
  return terminalTick
    + millisecondsToAuthorityTicks(timing.shutdown)
    + millisecondsToAuthorityTicks(timing.residue);
}

function eventIds(events: readonly CanonicalGameplayEvent[]): string[] {
  return events.map((event) => event.id);
}

describe("manifest-derived V4 laser geometry", () => {
  it("compiles all eight manifest topologies without a copied topology catalog", () => {
    expect(LASER_DEFINITIONS).toHaveLength(8);
    expect(new Set(LASER_DEFINITIONS.map((definition) => definition.geometry.type)).size).toBe(8);
    for (const definition of LASER_DEFINITIONS) {
      const first = compileLaserGeometry(definition, {tick120: 0});
      const repeat = compileLaserGeometry(definition, {tick120: 0});
      expect(first, definition.geometry.type).toEqual(repeat);
      expect(first.capsules.length + first.sectors.length, definition.geometry.type).toBeGreaterThan(0);
      expect(first.capsules.map((entry) => entry.stableId), definition.id).toEqual(
        [...first.capsules.map((entry) => entry.stableId)].sort(),
      );
    }
  });

  it("fails before gameplay for unknown ids and unknown topology behavior", () => {
    expect(() => laserDefinition("laser.not-in-v4")).toThrow(/unknown V4 laser id/);
    const source = LASER_DEFINITIONS[0];
    expect(source).toBeDefined();
    if (!source) return;
    const unknown: LaserDefinition = {
      ...source,
      id: "laser.fixture.unknown",
      geometry: {...source.geometry, type: "unknown_topology"},
    };
    expect(() => compileLaserGeometry(unknown, {tick120: 0})).toThrow(
      /unknown V4 laser topology: unknown_topology/,
    );
    expect(() => new LaserAuthority(new CanonicalEventBus(), unknown, "unknown:0")).toThrow(
      /unknown V4 laser topology/,
    );
  });

  it("uses the manifest tolerance as the explicit width fallback where V4 omits beam width", () => {
    for (const id of ["laser.broken_packet_polyline", "laser.scrolling_comb"]) {
      const definition = laserDefinition(id);
      const geometry = compileLaserGeometry(definition, {tick120: 0});
      expect(geometry.capsules.every((entry) =>
        entry.radius === definition.collision.sampleTolerancePx), id).toBe(true);
    }
  });

  it("moves authored dynamic geometry from integer ticks only", () => {
    const comb = laserDefinition("laser.scrolling_comb");
    const at0 = compileLaserGeometry(comb, {tick120: 0});
    const at1 = compileLaserGeometry(comb, {tick120: 1});
    const tooth0 = at0.capsules.find((entry) => entry.stableId === "tooth:0");
    const tooth1 = at1.capsules.find((entry) => entry.stableId === "tooth:0");
    expect(tooth0).toBeDefined();
    expect(tooth1).toBeDefined();
    expect((tooth1?.from.y ?? 0) - (tooth0?.from.y ?? 0)).toBeCloseTo(42 / LASER_TICK_HZ, 12);

    const sweep = laserDefinition("laser.single_decree_sweep");
    const duration = millisecondsToAuthorityTicks(sweep.lifecycle.timingMs.live);
    const start = compileLaserGeometry(sweep, {tick120: 0, activeDurationTicks: duration});
    const end = compileLaserGeometry(sweep, {tick120: duration, activeDurationTicks: duration});
    expect(start.capsules[0]?.to.x).toBeGreaterThan(end.capsules[0]?.to.x ?? Number.POSITIVE_INFINITY);
  });

  it("keeps the broken polyline's authored absence collision-free", () => {
    const geometry = compileLaserGeometry("laser.broken_packet_polyline", {tick120: 0});
    expect(geometry.capsules.map((entry) => entry.stableId)).toEqual([
      "segment:0",
      "segment:1",
      "segment:3",
    ]);
  });
});

describe("exact swept warning and continuous collision", () => {
  it("covers every active geometry sample for all eight topologies", () => {
    for (const definition of LASER_DEFINITIONS) {
      const footprint = buildLaserWarningFootprint(definition);
      expect(footprint.snapshots).toHaveLength(footprint.activeDurationTicks + 1);
      for (const snapshot of footprint.snapshots) {
        expect(warningFootprintCoversSnapshot(footprint, snapshot),
          `${definition.id}@${snapshot.tick120}`).toBe(true);
      }
      const hasMovingCapsule = footprint.snapshots.some((snapshot, index) => {
        const previous = footprint.snapshots[index - 1];
        if (!previous) return false;
        return snapshot.capsules.some((entry) => {
          const prior = previous.capsules.find((candidate) => candidate.stableId === entry.stableId);
          return prior !== undefined && (prior.from.x !== entry.from.x || prior.from.y !== entry.from.y
            || prior.to.x !== entry.to.x || prior.to.y !== entry.to.y);
        });
      });
      if (hasMovingCapsule) expect(footprint.sweptCapsules.length, definition.id).toBeGreaterThan(0);
    }
  });

  it("detects a high-speed player crossing a static capsule between endpoints", () => {
    const vertical: CapsuleSegment = {
      kind: "capsule",
      stableId: "high-speed-fixture",
      from: position(180, 0),
      to: position(180, LASER_VIEW_HEIGHT),
      radius: 2,
    };
    expect(playerSweepIntersectsCapsule({
      from: position(0, 320),
      to: position(360, 320),
      radius: 2,
    }, vertical)).toBe(true);
    expect(playerSweepIntersectsCapsule({
      from: position(0, 700),
      to: position(360, 700),
      radius: 2,
    }, vertical)).toBe(false);
  });

  it("detects a stationary player crossed by the rotating decree beam", () => {
    const definition = laserDefinition("laser.single_decree_sweep");
    const duration = millisecondsToAuthorityTicks(definition.lifecycle.timingMs.live);
    const pivot = position(0.5 * 360, 0.15 * 640);
    expect(laserIntersectsPlayerBetweenTicks(
      definition,
      0,
      duration,
      0,
      duration,
      {
        from: position(pivot.x, pivot.y + 280),
        to: position(pivot.x, pivot.y + 280),
        radius: 2,
      },
    )).toBe(true);
    expect(laserIntersectsPlayerBetweenTicks(
      definition,
      0,
      duration,
      0,
      duration,
      {
        from: position(pivot.x - 280, pivot.y),
        to: position(pivot.x - 280, pivot.y),
        radius: 2,
      },
    )).toBe(false);
  });

  it("preserves the broken iris wedge as an actual safe opening", () => {
    const geometry = compileLaserGeometry("laser.broken_iris_cone", {tick120: 0});
    const origin = geometry.sectors[0]?.origin;
    expect(origin).toBeDefined();
    if (!origin) return;
    expect(laserIntersectsPlayerBetweenTicks(
      "laser.broken_iris_cone",
      0,
      0,
      0,
      1,
      {
        from: position(origin.x, origin.y + 200),
        to: position(origin.x, origin.y + 200),
        radius: 1,
      },
    )).toBe(false);
    const angle = 70 * Math.PI / 180;
    expect(laserIntersectsPlayerBetweenTicks(
      "laser.broken_iris_cone",
      0,
      0,
      0,
      1,
      {
        from: position(origin.x + Math.cos(angle) * 200, origin.y + Math.sin(angle) * 200),
        to: position(origin.x + Math.cos(angle) * 200, origin.y + Math.sin(angle) * 200),
        radius: 1,
      },
    )).toBe(true);
  });
});

describe("120 Hz entity-owned laser lifecycle", () => {
  it("arms collision on the exact cumulative manifest tick", () => {
    const definition = LASER_DEFINITIONS[0];
    expect(definition).toBeDefined();
    if (!definition) return;
    const bus = new CanonicalEventBus();
    const laser = new LaserAuthority(bus, definition, "laser:exact-arm");
    const startTick = 17;
    const timing = definition.lifecycle.timingMs;
    const warningEnd = startTick + millisecondsToAuthorityTicks(timing.telegraph);
    const activeTick = startTick
      + millisecondsToAuthorityTicks(timing.telegraph + timing.charge + timing.grow);
    laser.start(startTick);
    expect(eventIds(bus.flush())).toEqual(["projectile.spawn.commit"]);
    laser.advance(warningEnd);
    expect(laser.snapshot().state).toBe("arming");
    expect(eventIds(bus.flush())).toEqual(["projectile.arm.begin"]);
    laser.advance(activeTick - 1);
    expect(laser.snapshot().collisionEnabled).toBe(false);
    expect(bus.flush()).toEqual([]);
    laser.advance(activeTick);
    const activeEvents = bus.flush();
    expect(activeEvents.every((event) => event.tick120 === activeTick)).toBe(true);
    expect(eventIds(activeEvents)).toEqual([
      "projectile.armed",
      "projectile.flight.begin",
      "projectile.collision.on",
    ]);
    expect(laser.snapshot().state).toBe("active");
    expect(laser.snapshot().collisionEnabled).toBe(true);
  });

  it("makes impact and cancel mutually exclusive terminal facts", () => {
    const definition = LASER_DEFINITIONS[1];
    expect(definition).toBeDefined();
    if (!definition) return;
    const timing = definition.lifecycle.timingMs;
    const activeTick = millisecondsToAuthorityTicks(timing.telegraph + timing.charge + timing.grow);

    const cancelBus = new CanonicalEventBus();
    const cancelled = new LaserAuthority(cancelBus, definition, "laser:cancel");
    cancelled.start(0);
    cancelBus.flush();
    cancelled.advance(activeTick);
    cancelBus.flush();
    cancelled.cancel(activeTick + 1, "local-void");
    expect(() => cancelled.impact(activeTick + 1, "player:0")).toThrow(/cannot impact from shutdown/);
    const cancelEvents = cancelBus.flush();
    expect(eventIds(cancelEvents)).toEqual([
      "projectile.collision.off",
      "projectile.cancel.commit",
    ]);
    expect(cancelEvents.some((event) => event.id === "projectile.impact.commit")).toBe(false);

    const impactBus = new CanonicalEventBus();
    const impacted = new LaserAuthority(impactBus, definition, "laser:impact");
    impacted.start(0);
    impactBus.flush();
    impacted.advance(activeTick);
    impactBus.flush();
    impacted.impact(activeTick + 1, "player:0");
    expect(() => impacted.cancel(activeTick + 1, "late-cancel")).toThrow(/cannot cancel from shutdown/);
    const impactEvents = impactBus.flush();
    expect(eventIds(impactEvents)).toEqual([
      "projectile.collision.off",
      "projectile.impact.commit",
    ]);
    expect(impactEvents.some((event) => event.id === "projectile.cancel.commit")).toBe(false);
  });

  it("dispatches every crossed boundary once and reaches material cleanup", () => {
    const definition = LASER_DEFINITIONS[2];
    expect(definition).toBeDefined();
    if (!definition) return;
    const bus = new CanonicalEventBus();
    const laser = new LaserAuthority(bus, definition, "laser:large-delta");
    laser.start(0);
    bus.flush();
    laser.advance(completeTick(definition));
    const events = bus.flush();
    expect(eventIds(events)).toEqual([
      "projectile.arm.begin",
      "projectile.armed",
      "projectile.flight.begin",
      "projectile.collision.on",
      "projectile.collision.off",
      "projectile.cancel.commit",
      "projectile.residue.begin",
      "projectile.residue.remove",
      "projectile.lifecycle.complete",
    ]);
    expect(new Set(events.map((event) => event.occurrenceKey)).size).toBe(events.length);
    expect(laser.snapshot().state).toBe("cleanup");
    expect(laser.snapshot().collisionEnabled).toBe(false);
  });

  it("has identical event cadence for per-tick and one-large-delta advancement", () => {
    const definition = LASER_DEFINITIONS[3];
    expect(definition).toBeDefined();
    if (!definition) return;
    const endTick = completeTick(definition);
    const steppedBus = new CanonicalEventBus();
    const stepped = new LaserAuthority(steppedBus, definition, "laser:cadence");
    stepped.start(0);
    steppedBus.flush();
    for (let tick120 = 1; tick120 <= endTick; tick120 += 1) {
      stepped.advance(tick120);
      steppedBus.flush();
    }

    const jumpedBus = new CanonicalEventBus();
    const jumped = new LaserAuthority(jumpedBus, definition, "laser:cadence");
    jumped.start(0);
    jumpedBus.flush();
    jumped.advance(endTick);
    jumpedBus.flush();
    expect(jumpedBus.canonicalSerialization()).toBe(steppedBus.canonicalSerialization());
  });

  it("rejects duplicate occurrence identity for the same stable laser generation", () => {
    const definition = LASER_DEFINITIONS[4];
    expect(definition).toBeDefined();
    if (!definition) return;
    const bus = new CanonicalEventBus();
    const first = new LaserAuthority(bus, definition, "laser:duplicate");
    const duplicate = new LaserAuthority(bus, definition, "laser:duplicate");
    first.start(0);
    expect(() => duplicate.start(0)).toThrow(/duplicate authoritative occurrence key/);
    expect(duplicate.snapshot().state).toBe("idle");
  });

  it("does not let a feedback sink write gameplay back through the laser", () => {
    const definition = LASER_DEFINITIONS[5];
    expect(definition).toBeDefined();
    if (!definition) return;
    const bus = new CanonicalEventBus();
    const laser = new LaserAuthority(bus, definition, "laser:feedback-boundary");
    laser.start(0);
    expect(() => bus.flush([{
      consume: () => {
        laser.cancel(0, "presentation-command");
      },
    }])).toThrow(/feedback sinks cannot emit gameplay events/);
    expect(laser.snapshot().state).toBe("warning");
    expect(laser.snapshot().terminalCause).toBeNull();
  });

  it("increments generation while retaining stable entity ordering on reuse", () => {
    const definition = LASER_DEFINITIONS[6];
    expect(definition).toBeDefined();
    if (!definition) return;
    const bus = new CanonicalEventBus();
    const laser = new LaserAuthority(bus, definition, "laser:reused");
    laser.start(0);
    bus.flush();
    const end = completeTick(definition);
    laser.advance(end);
    bus.flush();
    laser.start(end + 1);
    const spawn = bus.flush()[0];
    expect(laser.snapshot().generation).toBe(1);
    expect(spawn?.entityStableId).toBe("laser:reused");
    expect(spawn?.payload.generation).toBe(1);
    expect(spawn?.occurrenceKey).toBe("laser:reused:1:spawn");
  });
});
