import {describe, expect, it} from "vitest";
import {
  CanonicalEventBus,
  type CanonicalEventBatchReceipt,
  type CanonicalGameplayEvent,
} from "./events";
import {
  LASER_DEFINITIONS,
  LASER_TICK_HZ,
  LASER_VIEW_HEIGHT,
  LaserAuthority,
  buildLaserWarningFootprint,
  compileLaserGeometry,
  inspectPreparedLaserMutation,
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

function occupyOccurrence(
  bus: CanonicalEventBus,
  occurrenceKey: string,
  tick120: number,
): void {
  bus.enqueue({
    id: "boss.encounter.resolve",
    tick120,
    entityStableId: "laser-conflict-fixture",
    localSequence: 0,
    occurrenceKey,
    payload: {
      bossId: "boss.conflict_fixture",
      generation: 1,
      outcome: "occupied",
      finalPhaseId: "fixture",
    },
  });
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

  it("locks the Misreader adapter's deterministic capsule projection without calling it V4 count authority", () => {
    const geometry = compileLaserGeometry("laser.misread_bezier", {tick120: 0});
    expect(geometry.topology).toBe("quadratic_bezier");
    expect(geometry.capsules).toHaveLength(16);
    expect(geometry.capsules.every((capsule) => capsule.radius === 5.5)).toBe(true);
    expect(geometry.capsules.map((capsule) => capsule.stableId)).toEqual(
      Array.from({length: 16}, (_, index) => `curve:${index}`).sort(),
    );
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
    expect(() => new LaserAuthority(
      new CanonicalEventBus(),
      unknown as unknown as string,
      "unknown:0",
    )).toThrow(
      /requires a canonical V4 laser id/,
    );
    expect(() => new LaserAuthority(
      new CanonicalEventBus(),
      "laser.not-in-v4",
      "unknown:1",
    )).toThrow(/unknown V4 laser id/);
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
  it("rejects negative-zero ticks and preflights every lifecycle deadline in the safe range", () => {
    const definition = laserDefinition("laser.misread_bezier");
    expect(millisecondsToAuthorityTicks(0)).toBe(0);
    expect(Object.is(millisecondsToAuthorityTicks(0), -0)).toBe(false);
    expect(() => millisecondsToAuthorityTicks(Number.MAX_VALUE)).toThrow(/safe authority tick range/);
    expect(() => compileLaserGeometry(definition, {tick120: -0})).toThrow(
      /non-negative safe integer/,
    );

    const negativeZeroBus = new CanonicalEventBus();
    const negativeZero = new LaserAuthority(
      negativeZeroBus,
      definition.id,
      "laser:negative-zero",
    );
    expect(() => negativeZero.start(-0)).toThrow(/non-negative safe integer/);
    expect(() => negativeZero.advance(-0)).toThrow(/non-negative safe integer/);
    expect(() => negativeZero.collides(
      -0,
      0,
      {from: position(0, 0), to: position(0, 0), radius: 1},
    )).toThrow(/non-negative safe integer/);
    expect(() => negativeZero.collides(
      1,
      0,
      {from: position(0, 0), to: position(0, 0), radius: 1},
    )).toThrow(/monotonic/);
    expect(negativeZero.snapshot().state).toBe("idle");
    expect(negativeZeroBus.flush()).toEqual([]);

    const timing = definition.lifecycle.timingMs;
    const terminalOffset = millisecondsToAuthorityTicks(
      timing.telegraph + timing.charge + timing.grow,
    ) + millisecondsToAuthorityTicks(timing.live);
    const unsafeStart = Number.MAX_SAFE_INTEGER - terminalOffset;
    const overflowBus = new CanonicalEventBus();
    const overflow = new LaserAuthority(overflowBus, definition.id, "laser:overflow");
    expect(() => overflow.start(unsafeStart)).toThrow(/laser residue deadline exceeds/);
    expect(overflow.snapshot()).toMatchObject({state: "idle", currentTick120: 0});
    expect(overflowBus.flush()).toEqual([]);

    expect(() => laserIntersectsPlayerBetweenTicks(
      definition,
      0,
      0,
      Number.MAX_SAFE_INTEGER,
      1,
      {from: position(0, 0), to: position(0, 0), radius: 1},
    )).toThrow(/laser collision active deadline exceeds/);
  });

  it("arms collision on the exact cumulative manifest tick", () => {
    const definition = LASER_DEFINITIONS[0];
    expect(definition).toBeDefined();
    if (!definition) return;
    const bus = new CanonicalEventBus();
    const laser = new LaserAuthority(bus, definition.id, "laser:exact-arm");
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

  it("begins contact authority on the interval after collision-on, never on the entry tick", () => {
    const definition = laserDefinition("laser.misread_bezier");
    const activeTick = millisecondsToAuthorityTicks(
      definition.lifecycle.timingMs.telegraph
      + definition.lifecycle.timingMs.charge
      + definition.lifecycle.timingMs.grow,
    );
    const bus = new CanonicalEventBus();
    const laser = new LaserAuthority(bus, definition.id, "laser:first-contact-boundary");
    laser.start(0);
    bus.flush();
    laser.advance(activeTick);
    bus.flush();
    const capsule = laser.activeGeometry(activeTick).capsules[0];
    expect(capsule).toBeDefined();
    if (capsule === undefined) return;
    const onBeam = position(
      (capsule.from.x + capsule.to.x) / 2,
      (capsule.from.y + capsule.to.y) / 2,
    );
    expect(laser.collides(
      activeTick,
      activeTick,
      {from: onBeam, to: onBeam, radius: 3},
    )).toBe(false);
    laser.advance(activeTick + 1);
    expect(laser.collides(
      activeTick,
      activeTick + 1,
      {from: onBeam, to: onBeam, radius: 3},
    )).toBe(true);
  });

  it("ends contact authority before the interval whose endpoint commits collision-off", () => {
    const definition = laserDefinition("laser.misread_bezier");
    const bus = new CanonicalEventBus();
    const laser = new LaserAuthority(bus, definition.id, "laser:last-contact-boundary");
    laser.start(0);
    bus.flush();
    const terminalTick = laser.snapshot().terminalTick120;
    expect(terminalTick).not.toBeNull();
    if (terminalTick === null) return;
    laser.advance(terminalTick);
    const capsule = laser.activeGeometry(terminalTick - 1).capsules[0];
    expect(capsule).toBeDefined();
    if (capsule === undefined) return;
    const onBeam = position(
      (capsule.from.x + capsule.to.x) / 2,
      (capsule.from.y + capsule.to.y) / 2,
    );
    expect(laser.snapshot()).toMatchObject({state: "shutdown", collisionEnabled: false});
    expect(laser.collides(
      terminalTick - 1,
      terminalTick,
      {from: onBeam, to: onBeam, radius: 3},
    )).toBe(false);
    expect(laser.collides(
      terminalTick - 2,
      terminalTick,
      {from: onBeam, to: onBeam, radius: 3},
    )).toBe(true);
    const entersOnlyAfterCollisionOff = {
      from: position(179.2140625, 65.15),
      to: position(79.2140625, 65.15),
      radius: 0,
    };
    expect(laser.collides(
      terminalTick - 2,
      terminalTick,
      entersOnlyAfterCollisionOff,
    )).toBe(false);
    expect(laser.collides(
      terminalTick - 2,
      terminalTick - 1,
      {
        from: entersOnlyAfterCollisionOff.from,
        to: position(129.2140625, 65.15),
        radius: 0,
      },
    )).toBe(false);
  });

  it("exposes only frozen one-use current-revision proposals for composite append", () => {
    const bus = new CanonicalEventBus();
    const laser = new LaserAuthority(bus, "laser.misread_bezier", "laser:prepared-start");
    const start = laser.prepareStart(0);
    const startView = laser.validatePreparedMutation(start);
    expect(Object.isFrozen(start)).toBe(true);
    expect(Object.isFrozen(startView.drafts)).toBe(true);
    expect(inspectPreparedLaserMutation(start).kind).toBe("start");
    expect(() => laser.applyPreparedMutationAfterAppend(
      start,
      Object.freeze({}) as CanonicalEventBatchReceipt,
    )).toThrow(/receipt is not recognized/);
    expect(laser.snapshot().state).toBe("idle");
    const startReceipts = bus.enqueuePreparedBatch([startView.drafts]);
    expect(laser.applyPreparedMutationAfterAppend(
      start,
      startReceipts[0] as CanonicalEventBatchReceipt,
    )).toEqual(startView.preview);
    expect(() => laser.applyPreparedMutationAfterAppend(
      start,
      startReceipts[0] as CanonicalEventBatchReceipt,
    )).toThrow(/consumed/);
    expect(eventIds(bus.flush())).toEqual(["projectile.spawn.commit"]);

    const activeTick = laser.snapshot().activeTick120;
    expect(activeTick).not.toBeNull();
    if (activeTick === null) return;
    laser.advance(activeTick + 1);
    bus.flush();
    const impact = laser.prepareImpactAtCurrentTick(activeTick + 1, "player");
    const impactView = laser.validatePreparedMutation(impact);
    expect(impactView.kind).toBe("impact");
    const impactReceipts = bus.enqueuePreparedBatch([impactView.drafts]);
    expect(laser.applyPreparedMutationAfterAppend(
      impact,
      impactReceipts[0] as CanonicalEventBatchReceipt,
    )).toEqual(impactView.preview);
    expect(eventIds(bus.flush())).toEqual([
      "projectile.collision.off",
      "projectile.impact.commit",
    ]);

    const staleBus = new CanonicalEventBus();
    const staleLaser = new LaserAuthority(
      staleBus,
      "laser.misread_bezier",
      "laser:prepared-stale",
    );
    const stale = staleLaser.prepareStart(1);
    staleLaser.advance(1);
    expect(() => staleLaser.validatePreparedMutation(stale)).toThrow(/stale/);
    expect(() => inspectPreparedLaserMutation(stale)).toThrow(/stale/);
    expect(staleBus.flush()).toEqual([]);
  });

  it("makes impact and cancel mutually exclusive terminal facts", () => {
    const definition = LASER_DEFINITIONS[1];
    expect(definition).toBeDefined();
    if (!definition) return;
    const timing = definition.lifecycle.timingMs;
    const activeTick = millisecondsToAuthorityTicks(timing.telegraph + timing.charge + timing.grow);

    const cancelBus = new CanonicalEventBus();
    const cancelled = new LaserAuthority(cancelBus, definition.id, "laser:cancel");
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
    const impacted = new LaserAuthority(impactBus, definition.id, "laser:impact");
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

  it("keeps active entry atomic when a later occurrence conflicts", () => {
    const definition = laserDefinition("laser.misread_bezier");
    const timing = definition.lifecycle.timingMs;
    const warningEnd = millisecondsToAuthorityTicks(timing.telegraph);
    const activeTick = millisecondsToAuthorityTicks(timing.telegraph + timing.charge + timing.grow);
    const bus = new CanonicalEventBus();
    const laser = new LaserAuthority(bus, definition.id, "laser:atomic-active");
    laser.start(0);
    bus.flush();
    laser.advance(warningEnd);
    bus.flush();
    occupyOccurrence(bus, "laser:atomic-active:0:flight-begin", activeTick);
    const before = laser.snapshot();

    expect(() => laser.advance(activeTick)).toThrow(/duplicate authoritative occurrence key/);
    expect(laser.snapshot()).toEqual(before);
    expect(bus.flush().map((event) => event.entityStableId)).toEqual(["laser-conflict-fixture"]);
  });

  it("keeps cancel, impact, and natural terminal facts atomic under conflicts", () => {
    const definition = laserDefinition("laser.twin_offset_arcs");
    const timing = definition.lifecycle.timingMs;
    const activeTick = millisecondsToAuthorityTicks(timing.telegraph + timing.charge + timing.grow);
    const terminalTick = activeTick + millisecondsToAuthorityTicks(timing.live);

    const cases = [
      {
        instanceId: "laser:atomic-cancel",
        occurrenceSuffix: "cancel",
        tick120: activeTick + 1,
        invoke: (laser: LaserAuthority, tick120: number) => laser.cancel(tick120, "fixture"),
      },
      {
        instanceId: "laser:atomic-impact",
        occurrenceSuffix: "impact",
        tick120: activeTick + 1,
        invoke: (laser: LaserAuthority, tick120: number) => laser.impact(tick120, "player:0"),
      },
      {
        instanceId: "laser:atomic-natural",
        occurrenceSuffix: "cancel",
        tick120: terminalTick,
        invoke: (laser: LaserAuthority, tick120: number) => laser.advance(tick120),
      },
    ] as const;

    for (const fixture of cases) {
      const bus = new CanonicalEventBus();
      const laser = new LaserAuthority(bus, definition.id, fixture.instanceId);
      laser.start(0);
      bus.flush();
      laser.advance(activeTick);
      bus.flush();
      if (fixture.instanceId !== "laser:atomic-natural") {
        laser.advance(fixture.tick120);
        bus.flush();
      }
      occupyOccurrence(
        bus,
        `${fixture.instanceId}:0:${fixture.occurrenceSuffix}`,
        fixture.tick120,
      );
      const before = laser.snapshot();

      expect(() => fixture.invoke(laser, fixture.tick120)).toThrow(
        /duplicate authoritative occurrence key/,
      );
      expect(laser.snapshot()).toEqual(before);
      expect(bus.flush().map((event) => event.entityStableId)).toEqual([
        "laser-conflict-fixture",
      ]);
    }
  });

  it("keeps cleanup state and both cleanup facts atomic under a late conflict", () => {
    const definition = laserDefinition("laser.broken_packet_polyline");
    const timing = definition.lifecycle.timingMs;
    const activeTick = millisecondsToAuthorityTicks(timing.telegraph + timing.charge + timing.grow);
    const terminalTick = activeTick + millisecondsToAuthorityTicks(timing.live);
    const residueTick = terminalTick + millisecondsToAuthorityTicks(timing.shutdown);
    const cleanupTick = residueTick + millisecondsToAuthorityTicks(timing.residue);
    const bus = new CanonicalEventBus();
    const laser = new LaserAuthority(bus, definition.id, "laser:atomic-cleanup");
    laser.start(0);
    bus.flush();
    laser.advance(residueTick);
    bus.flush();
    occupyOccurrence(bus, "laser:atomic-cleanup:0:complete", cleanupTick);
    const before = laser.snapshot();
    expect(before.state).toBe("residue");

    expect(() => laser.advance(cleanupTick)).toThrow(/duplicate authoritative occurrence key/);
    expect(laser.snapshot()).toEqual(before);
    expect(bus.flush().map((event) => event.entityStableId)).toEqual(["laser-conflict-fixture"]);
  });

  it("dispatches every crossed boundary once and reaches material cleanup", () => {
    const definition = LASER_DEFINITIONS[2];
    expect(definition).toBeDefined();
    if (!definition) return;
    const bus = new CanonicalEventBus();
    const laser = new LaserAuthority(bus, definition.id, "laser:large-delta");
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
    const stepped = new LaserAuthority(steppedBus, definition.id, "laser:cadence");
    stepped.start(0);
    steppedBus.flush();
    for (let tick120 = 1; tick120 <= endTick; tick120 += 1) {
      stepped.advance(tick120);
      steppedBus.flush();
    }

    const jumpedBus = new CanonicalEventBus();
    const jumped = new LaserAuthority(jumpedBus, definition.id, "laser:cadence");
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
    const first = new LaserAuthority(bus, definition.id, "laser:duplicate");
    const duplicate = new LaserAuthority(bus, definition.id, "laser:duplicate");
    first.start(0);
    expect(() => duplicate.start(0)).toThrow(/duplicate authoritative occurrence key/);
    expect(duplicate.snapshot().state).toBe("idle");
  });

  it("does not let a feedback sink write gameplay back through the laser", () => {
    const definition = LASER_DEFINITIONS[5];
    expect(definition).toBeDefined();
    if (!definition) return;
    const bus = new CanonicalEventBus();
    const laser = new LaserAuthority(bus, definition.id, "laser:feedback-boundary");
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
    const laser = new LaserAuthority(bus, definition.id, "laser:reused");
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
