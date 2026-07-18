import {describe, expect, it} from "vitest";

import {CanonicalEventBus} from "./events";
import {
  PLAYER_FOCUS_COLLISION_RADIUS_PX,
  PLAYER_NORMAL_COLLISION_RADIUS_PX,
  PROJECTILE_POOL_BUDGETS,
  ProjectileAuthorityPool,
  type ProjectileArchetype,
  type ProjectileHandle,
  sweepCircleAgainstCapsule,
  sweepCircleAgainstCircle,
  V4_PROJECTILE_LIFECYCLE_STATES,
} from "./projectiles";

const ARCHETYPES = Object.freeze([
  {id: "bullet.micro.test", poolClass: "micro", collisionRadiusPx: 1},
  {id: "bullet.medium.test", poolClass: "medium", collisionRadiusPx: 3},
  {id: "bullet.heavy.test", poolClass: "heavy", collisionRadiusPx: 6},
  {id: "bullet.split.test", poolClass: "splitChildren", collisionRadiusPx: 1},
] as const satisfies readonly ProjectileArchetype[]);

function makeAuthority(authorityId = "projectiles/test"): {
  readonly bus: CanonicalEventBus;
  readonly pool: ProjectileAuthorityPool;
} {
  const bus = new CanonicalEventBus();
  return {
    bus,
    pool: new ProjectileAuthorityPool(bus, {authorityId, archetypes: ARCHETYPES}),
  };
}

function requireHandle(handle: ProjectileHandle | null): ProjectileHandle {
  expect(handle).not.toBeNull();
  if (handle === null) throw new Error("expected projectile allocation");
  return handle;
}

describe("V4 projectile contract", () => {
  it("derives the seven entity-owned states, radii, and exact pool budgets from the manifest", () => {
    expect(V4_PROJECTILE_LIFECYCLE_STATES).toEqual([
      "spawn",
      "arm",
      "flight",
      "impact",
      "cancel",
      "residue",
      "cleanup",
    ]);
    expect(PROJECTILE_POOL_BUDGETS).toEqual({
      micro: 2048,
      medium: 768,
      heavy: 192,
      splitChildren: 1024,
      residueVisualOnly: 1536,
    });
    expect(PLAYER_NORMAL_COLLISION_RADIUS_PX).toBe(3);
    expect(PLAYER_FOCUS_COLLISION_RADIUS_PX).toBe(2);
  });

  it("commits spawn, exact arm tick, indefinite flight, impact, residue, and cleanup", () => {
    const {bus, pool} = makeAuthority();
    const handle = requireHandle(pool.spawn({
      tick120: 10,
      occurrenceKey: "spawn-main",
      archetypeId: "bullet.micro.test",
      position: {x: 12, y: 24},
      armDelayTicks: 3,
      residueTicks: 4,
    }));

    expect(pool.snapshot(handle)).toMatchObject({
      state: "arm",
      collisionEnabled: false,
      spawnedAtTick: 10,
      armAtTick: 13,
    });
    pool.advanceTo(12);
    expect(pool.snapshot(handle).state).toBe("arm");
    pool.advanceTo(13);
    expect(pool.snapshot(handle)).toMatchObject({state: "flight", collisionEnabled: true});

    // Flight deliberately has no expiry derived from visual duration or a default timeout.
    pool.advanceTo(50_000);
    expect(pool.snapshot(handle)).toMatchObject({state: "flight", collisionEnabled: true});

    pool.impact(handle, 50_001, "player/0");
    expect(pool.snapshot(handle)).toMatchObject({
      state: "residue",
      collisionEnabled: false,
      terminalCause: "impact",
    });
    pool.advanceTo(50_004);
    expect(pool.isActive(handle)).toBe(true);
    pool.advanceTo(50_005);
    expect(pool.isActive(handle)).toBe(false);

    const events = bus.flush();
    const armed = events.find((event) => event.id === "projectile.armed");
    expect(armed?.tick120).toBe(13);
    expect(armed?.simulationTimeMs).toBe(13 * 1000 / 120);

    // ADR-002 is phase-authoritative: a new entity is exposed only after the
    // tick's state/collision work, irrespective of enqueue call order.
    expect(events.filter((event) => event.tick120 === 10).map((event) => `${event.id}`)).toEqual([
      "projectile.arm.begin",
      "projectile.spawn.commit",
    ]);
    expect(events.filter((event) => event.tick120 === 13).map((event) => `${event.id}`)).toEqual([
      "projectile.armed",
      "projectile.flight.begin",
      "projectile.collision.on",
    ]);
    expect(events.filter((event) => event.tick120 === 50_001).map((event) => `${event.id}`)).toEqual([
      "projectile.collision.off",
      "projectile.impact.commit",
      "projectile.residue.begin",
    ]);

    const collisionOffIndex = events.findIndex((event) => event.id === "projectile.collision.off");
    const impactIndex = events.findIndex((event) => event.id === "projectile.impact.commit");
    const residueIndex = events.findIndex((event) => event.id === "projectile.residue.begin");
    expect(collisionOffIndex).toBeLessThan(impactIndex);
    expect(impactIndex).toBeLessThan(residueIndex);
    expect(events.find((event) => event.id === "projectile.residue.remove")?.tick120).toBe(50_005);
    expect(events.find((event) => event.id === "projectile.lifecycle.complete")?.tick120).toBe(50_005);
  });

  it("keeps a motion-owned collision gate inside one flight generation", () => {
    const {bus, pool} = makeAuthority();
    const handle = requireHandle(pool.spawn({
      tick120: 10,
      occurrenceKey: "spawn-gated",
      archetypeId: "bullet.micro.test",
      position: {x: 12, y: 24},
      armDelayTicks: 3,
      residueTicks: 4,
      collisionEnabledAtArm: false,
    }));

    pool.advanceTo(13);
    expect(pool.snapshot(handle)).toMatchObject({
      state: "flight",
      collisionEnabled: false,
      armAtTick: 13,
    });
    expect(() => pool.setFlightCollision(handle, 13, true, "dual_clock_gate"))
      .toThrow(/activation tick/);

    pool.move(handle, 14, {x: 14, y: 28});
    expect(pool.setFlightCollision(handle, 14, true, "dual_clock_gate")).toMatchObject({
      state: "flight",
      collisionEnabled: true,
      position: {x: 14, y: 28},
    });
    pool.setFlightCollision(handle, 14, true, "dual_clock_gate");
    pool.advanceTo(15);
    pool.setFlightCollision(handle, 15, false, "dual_clock_gate");
    pool.move(handle, 16, {x: 18, y: 36});
    pool.setFlightCollision(handle, 16, true, "phase_gate");
    pool.advanceTo(17);
    pool.setFlightCollision(handle, 17, false, "phase_gate");
    expect(pool.snapshot(handle)).toMatchObject({
      state: "flight",
      collisionEnabled: false,
      position: {x: 18, y: 36},
      movedAtTick120: 16,
    });
    pool.cancel(handle, 18, "pattern_end");

    const events = bus.flush();
    expect(events.filter((event) => event.tick120 === 13).map((event) => event.id)).toEqual([
      "projectile.armed",
      "projectile.flight.begin",
    ]);
    expect(events.filter((event) =>
      event.id === "projectile.collision.on" || event.id === "projectile.collision.off")
      .map((event) => [event.tick120, event.id, event.payload.reason ?? null])).toEqual([
        [14, "projectile.collision.on", null],
        [15, "projectile.collision.off", "dual_clock_gate"],
        [16, "projectile.collision.on", null],
        [17, "projectile.collision.off", "phase_gate"],
        [18, "projectile.collision.off", "pattern_end"],
      ]);
    expect(new Set(events.map((event) => event.occurrenceKey)).size).toBe(events.length);
  });

  it("preaccepts a reversible collider batch before any member can mutate", () => {
    const {bus, pool} = makeAuthority();
    const first = requireHandle(pool.spawn({
      tick120: 10,
      occurrenceKey: "gate-batch-first",
      archetypeId: "bullet.micro.test",
      position: {x: 10, y: 20},
      armDelayTicks: 3,
      residueTicks: 4,
      collisionEnabledAtArm: false,
    }));
    const second = requireHandle(pool.spawn({
      tick120: 10,
      occurrenceKey: "gate-batch-second",
      archetypeId: "bullet.micro.test",
      position: {x: 30, y: 40},
      armDelayTicks: 3,
      residueTicks: 4,
      collisionEnabledAtArm: false,
    }));
    pool.advanceTo(14);
    const prepared = pool.prepareFlightCollisionBatch(14, Object.freeze([
      Object.freeze({handle: first, enabled: true, reason: "dual_clock_gate"}),
      Object.freeze({handle: second, enabled: true, reason: "dual_clock_gate"}),
    ]));
    bus.enqueue({
      id: "projectile.collision.on",
      tick120: 14,
      entityStableId: second.instanceId,
      localSequence: 4,
      occurrenceKey: `${second.instanceId}:${second.generation}:collision-gate:0:on`,
      payload: {instanceId: second.instanceId, generation: second.generation},
    });

    expect(() => pool.beginPreparedFlightCollisionBatch(prepared))
      .toThrow(/duplicate authoritative occurrence key/);
    expect(pool.snapshot(first).collisionEnabled).toBe(false);
    expect(pool.snapshot(second).collisionEnabled).toBe(false);
    expect(bus.flush().filter((event) => event.id === "projectile.collision.on")
      .map((event) => event.entityStableId)).toEqual([second.instanceId]);
  });

  it("rejects a future due-arm gate call without advancing any projectile", () => {
    const {bus, pool} = makeAuthority();
    const handle = requireHandle(pool.spawn({
      tick120: 10,
      occurrenceKey: "future-gate",
      archetypeId: "bullet.micro.test",
      position: {x: 12, y: 24},
      armDelayTicks: 3,
      residueTicks: 4,
      collisionEnabledAtArm: false,
    }));
    expect(() => pool.setFlightCollision(handle, 13, true, "dual_clock_gate"))
      .toThrow(/exact tick/);
    expect(pool.snapshot(handle)).toMatchObject({
      state: "arm",
      collisionEnabled: false,
      armAtTick: 13,
    });
    expect(bus.events().some((event) =>
      event.id === "projectile.armed" || event.id === "projectile.flight.begin")).toBe(false);
  });

  it("makes cancel and impact mutually exclusive while preserving cancel event order", () => {
    const {bus, pool} = makeAuthority();
    const cancelled = requireHandle(pool.spawn({
      tick120: 0,
      occurrenceKey: "spawn-cancelled",
      archetypeId: "bullet.micro.test",
      position: {x: 0, y: 0},
      armDelayTicks: 8,
      residueTicks: 3,
    }));
    pool.cancel(cancelled, 2, "override_void");
    expect(() => pool.impact(cancelled, 2, "player/0")).toThrow(/cannot impact from residue/);

    const impacted = requireHandle(pool.spawn({
      tick120: 2,
      occurrenceKey: "spawn-impacted",
      archetypeId: "bullet.micro.test",
      position: {x: 5, y: 5},
      armDelayTicks: 0,
      residueTicks: 3,
    }));
    pool.impact(impacted, 3, "player/0");
    expect(() => pool.cancel(impacted, 3, "pattern_end")).toThrow(/cannot cancel from residue/);

    const events = bus.flush();
    const cancelEvents = events.filter((event) => event.entityStableId === cancelled.instanceId);
    expect(cancelEvents.findIndex((event) => event.id === "projectile.collision.off")).toBeLessThan(
      cancelEvents.findIndex((event) => event.id === "projectile.cancel.commit"),
    );
    expect(cancelEvents.findIndex((event) => event.id === "projectile.cancel.commit")).toBeLessThan(
      cancelEvents.findIndex((event) => event.id === "projectile.residue.begin"),
    );
    expect(cancelEvents.find((event) => event.id === "projectile.cancel.commit")?.payload).toMatchObject({
      instanceId: cancelled.instanceId,
      generation: cancelled.generation,
      reason: "override_void",
    });
  });

  it("cancels at the exact arm tick without exposing flight or collision-on", () => {
    const {bus, pool} = makeAuthority();
    const handle = requireHandle(pool.spawn({
      tick120: 10,
      occurrenceKey: "spawn-same-tick-cancel",
      archetypeId: "bullet.micro.test",
      position: {x: 0, y: 0},
      armDelayTicks: 3,
      residueTicks: 2,
    }));

    pool.cancel(handle, 13, "source_withdrawn");

    expect(pool.snapshot(handle)).toMatchObject({
      state: "residue",
      collisionEnabled: false,
      terminalCause: "cancel",
    });
    const targetEvents = bus.flush().filter((event) => event.entityStableId === handle.instanceId);
    const targetEventsAtCancel = targetEvents.filter((event) => event.tick120 === 13);
    expect(targetEventsAtCancel.map((event) => `${event.id}`)).toEqual([
      "projectile.collision.off",
      "projectile.cancel.commit",
      "projectile.residue.begin",
    ]);
    expect(targetEventsAtCancel.some((event) => [
      "projectile.armed",
      "projectile.flight.begin",
      "projectile.collision.on",
    ].includes(`${event.id}`))).toBe(false);
    expect(targetEvents.filter((event) =>
      event.id === "projectile.collision.on" || event.id === "projectile.collision.off").at(-1)?.id)
      .toBe("projectile.collision.off");
  });

  it("atomically cancels mixed arm and flight handles while arming untargeted due slots", () => {
    const {bus, pool} = makeAuthority();
    const flight = requireHandle(pool.spawn({
      tick120: 0,
      occurrenceKey: "spawn-batch-flight",
      archetypeId: "bullet.micro.test",
      position: {x: 0, y: 0},
      armDelayTicks: 4,
      residueTicks: 2,
    }));
    const exactTickArm = requireHandle(pool.spawn({
      tick120: 0,
      occurrenceKey: "spawn-batch-exact-arm",
      archetypeId: "bullet.micro.test",
      position: {x: 1, y: 0},
      armDelayTicks: 5,
      residueTicks: 2,
    }));
    const untargetedDue = requireHandle(pool.spawn({
      tick120: 0,
      occurrenceKey: "spawn-batch-untargeted",
      archetypeId: "bullet.micro.test",
      position: {x: 2, y: 0},
      armDelayTicks: 5,
      residueTicks: 2,
    }));

    pool.advanceTo(4);
    pool.cancelMany([exactTickArm, flight], 5, "pattern_end");

    expect(pool.snapshot(flight)).toMatchObject({state: "residue", collisionEnabled: false});
    expect(pool.snapshot(exactTickArm)).toMatchObject({state: "residue", collisionEnabled: false});
    expect(pool.snapshot(untargetedDue)).toMatchObject({state: "flight", collisionEnabled: true});

    const events = bus.flush();
    const exactTickTargetEvents = events.filter((event) =>
      event.tick120 === 5 && event.entityStableId === exactTickArm.instanceId);
    expect(exactTickTargetEvents.map((event) => `${event.id}`)).toEqual([
      "projectile.collision.off",
      "projectile.cancel.commit",
      "projectile.residue.begin",
    ]);
    expect(events.filter((event) =>
      event.tick120 === 5 && event.entityStableId === untargetedDue.instanceId
    ).map((event) => `${event.id}`)).toEqual([
      "projectile.armed",
      "projectile.flight.begin",
      "projectile.collision.on",
    ]);
    for (const handle of [flight, exactTickArm]) {
      const collisionTrace = events.filter((event) =>
        event.entityStableId === handle.instanceId
        && (event.id === "projectile.collision.on" || event.id === "projectile.collision.off"));
      expect(collisionTrace.at(-1)?.id).toBe("projectile.collision.off");
    }
  });

  it("fails a duplicate cancellation batch closed before advancing any projectile", () => {
    const {bus, pool} = makeAuthority();
    const target = requireHandle(pool.spawn({
      tick120: 0,
      occurrenceKey: "spawn-duplicate-batch-target",
      archetypeId: "bullet.micro.test",
      position: {x: 0, y: 0},
      armDelayTicks: 3,
      residueTicks: 1,
    }));
    const untargetedDue = requireHandle(pool.spawn({
      tick120: 0,
      occurrenceKey: "spawn-duplicate-batch-untargeted",
      archetypeId: "bullet.micro.test",
      position: {x: 1, y: 0},
      armDelayTicks: 3,
      residueTicks: 1,
    }));

    expect(() => pool.cancelMany([target, target], 3, "pattern_end"))
      .toThrow(/duplicate projectile cancel handle/);

    expect(pool.snapshot(target)).toMatchObject({state: "arm", collisionEnabled: false});
    expect(pool.snapshot(untargetedDue)).toMatchObject({state: "arm", collisionEnabled: false});
    expect(bus.flush().some((event) => event.tick120 === 3)).toBe(false);
  });

  it("rejects an invalid move before advancing target or unrelated due work", () => {
    const {bus, pool} = makeAuthority();
    const target = requireHandle(pool.spawn({
      tick120: 0,
      occurrenceKey: "spawn-invalid-move-target",
      archetypeId: "bullet.micro.test",
      position: {x: 0, y: 0},
      armDelayTicks: 3,
      residueTicks: 1,
    }));
    const unrelated = requireHandle(pool.spawn({
      tick120: 0,
      occurrenceKey: "spawn-invalid-move-unrelated",
      archetypeId: "bullet.micro.test",
      position: {x: 1, y: 0},
      armDelayTicks: 3,
      residueTicks: 1,
    }));

    expect(() => pool.move(target, 3, {x: Number.NaN, y: 0})).toThrow(/next position/);
    expect(pool.snapshot(target)).toMatchObject({state: "arm", collisionEnabled: false});
    expect(pool.snapshot(unrelated)).toMatchObject({state: "arm", collisionEnabled: false});
    expect(bus.flush().some((event) => event.tick120 === 3)).toBe(false);

    pool.move(target, 3, {x: 2, y: 0});
    expect(pool.snapshot(target)).toMatchObject({state: "flight", position: {x: 2, y: 0}});
    expect(pool.snapshot(unrelated)).toMatchObject({state: "flight", collisionEnabled: true});
  });

  it("rejects zero-delay same-tick cancel and impact without contradicting activation", () => {
    const {bus, pool} = makeAuthority();
    const handle = requireHandle(pool.spawn({
      tick120: 7,
      occurrenceKey: "spawn-zero-delay-terminal",
      archetypeId: "bullet.micro.test",
      position: {x: 0, y: 0},
      armDelayTicks: 0,
      residueTicks: 2,
    }));

    expect(() => pool.cancel(handle, 7, "pattern_end")).toThrow(/cannot cancel on activation tick 7/);
    expect(() => pool.impact(handle, 7, "player\/0")).toThrow(/cannot impact on activation tick 7/);

    expect(pool.snapshot(handle)).toMatchObject({
      state: "flight",
      collisionEnabled: true,
      terminalCause: null,
    });
    const events = bus.flush().filter((event) => event.entityStableId === handle.instanceId);
    expect(events.some((event) => [
      "projectile.collision.off",
      "projectile.cancel.commit",
      "projectile.impact.commit",
      "projectile.residue.begin",
    ].includes(`${event.id}`))).toBe(false);
    expect(events.filter((event) =>
      event.id === "projectile.collision.on" || event.id === "projectile.collision.off"
    ).map((event) => `${event.id}`)).toEqual(["projectile.collision.on"]);
  });

  it("rejects cancel and impact after explicit same-tick activation without mutation", () => {
    const {bus, pool} = makeAuthority();
    const cancelTarget = requireHandle(pool.spawn({
      tick120: 0,
      occurrenceKey: "spawn-advance-then-cancel",
      archetypeId: "bullet.micro.test",
      position: {x: 0, y: 0},
      armDelayTicks: 3,
      residueTicks: 2,
    }));
    const impactTarget = requireHandle(pool.spawn({
      tick120: 0,
      occurrenceKey: "spawn-advance-then-impact",
      archetypeId: "bullet.micro.test",
      position: {x: 1, y: 0},
      armDelayTicks: 3,
      residueTicks: 2,
    }));

    pool.advanceTo(3);
    expect(() => pool.cancelMany([cancelTarget], 3, "source_withdrawn"))
      .toThrow(/cannot cancel on activation tick 3/);
    expect(() => pool.impact(impactTarget, 3, "player\/0"))
      .toThrow(/cannot impact on activation tick 3/);

    expect(pool.snapshot(cancelTarget)).toMatchObject({state: "flight", collisionEnabled: true});
    expect(pool.snapshot(impactTarget)).toMatchObject({state: "flight", collisionEnabled: true});
    const events = bus.flush();
    for (const handle of [cancelTarget, impactTarget]) {
      const targetEvents = events.filter((event) => event.entityStableId === handle.instanceId);
      expect(targetEvents.some((event) => [
        "projectile.collision.off",
        "projectile.cancel.commit",
        "projectile.impact.commit",
        "projectile.residue.begin",
      ].includes(`${event.id}`))).toBe(false);
      expect(targetEvents.filter((event) =>
        event.id === "projectile.collision.on" || event.id === "projectile.collision.off"
      ).map((event) => `${event.id}`)).toEqual(["projectile.collision.on"]);
    }
  });

  it("rejects an unadvanced exact-arm impact before advancing any projectile", () => {
    const {bus, pool} = makeAuthority();
    const target = requireHandle(pool.spawn({
      tick120: 0,
      occurrenceKey: "spawn-unadvanced-impact-target",
      archetypeId: "bullet.micro.test",
      position: {x: 0, y: 0},
      armDelayTicks: 3,
      residueTicks: 1,
    }));
    const untargetedDue = requireHandle(pool.spawn({
      tick120: 0,
      occurrenceKey: "spawn-unadvanced-impact-untargeted",
      archetypeId: "bullet.micro.test",
      position: {x: 1, y: 0},
      armDelayTicks: 3,
      residueTicks: 1,
    }));

    expect(() => pool.impact(target, 3, "player\/0"))
      .toThrow(/cannot impact on activation tick 3/);

    expect(pool.snapshot(target)).toMatchObject({state: "arm", collisionEnabled: false});
    expect(pool.snapshot(untargetedDue)).toMatchObject({state: "arm", collisionEnabled: false});
    expect(bus.flush().some((event) => event.tick120 === 3)).toBe(false);
  });
});

describe("continuous projectile collision", () => {
  it("detects a high-speed circle crossing that endpoint overlap would miss", () => {
    const hit = sweepCircleAgainstCircle(
      {x: 0, y: 0},
      {x: 100, y: 0},
      1,
      {center: {x: 50, y: 0}, radius: 2},
    );
    expect(hit).not.toBeNull();
    expect(hit?.timeOfImpact).toBeCloseTo(0.47, 12);
    expect(hit?.projectileCenter).toEqual({x: 47, y: 0});
    expect(hit?.normal).toEqual({x: -1, y: 0});
  });

  it("detects the finite side and round cap of a capsule without false infinite-line hits", () => {
    const sideHit = sweepCircleAgainstCapsule(
      {x: 0, y: 0},
      {x: 100, y: 0},
      1,
      {start: {x: 50, y: -10}, end: {x: 50, y: 10}, radius: 2},
    );
    expect(sideHit?.timeOfImpact).toBeCloseTo(0.47, 12);

    const capHit = sweepCircleAgainstCapsule(
      {x: 0, y: 13},
      {x: 100, y: 13},
      1,
      {start: {x: 50, y: -10}, end: {x: 50, y: 10}, radius: 2},
    );
    expect(capHit?.timeOfImpact).toBeCloseTo(0.5, 12);

    expect(sweepCircleAgainstCapsule(
      {x: 0, y: 20},
      {x: 100, y: 20},
      1,
      {start: {x: 50, y: -10}, end: {x: 50, y: 10}, radius: 2},
    )).toBeNull();
  });

  it("uses the entity's previous and current positions for authoritative sweep", () => {
    const {pool} = makeAuthority();
    const handle = requireHandle(pool.spawn({
      tick120: 0,
      occurrenceKey: "spawn-sweep",
      archetypeId: "bullet.micro.test",
      position: {x: 0, y: 0},
      armDelayTicks: 0,
      residueTicks: 1,
    }));
    pool.move(handle, 1, {x: 100, y: 0});

    const hit = pool.sweepAgainstCircle(handle, {center: {x: 50, y: 0}, radius: 2});
    expect(hit?.timeOfImpact).toBeCloseTo(0.47, 12);
    pool.impact(handle, 1, "player/0");
    expect(pool.sweepAgainstCircle(handle, {center: {x: 50, y: 0}, radius: 2})).toBeNull();
  });
});

describe("fixed-budget projectile pooling", () => {
  it("rejects overflow with a stable audit record and leaves every live collider untouched", () => {
    const {pool} = makeAuthority();
    const handles: ProjectileHandle[] = [];
    for (let index = 0; index < PROJECTILE_POOL_BUDGETS.heavy; index += 1) {
      handles.push(requireHandle(pool.spawn({
        tick120: 0,
        occurrenceKey: `heavy-${index}`,
        archetypeId: "bullet.heavy.test",
        position: {x: index, y: 0},
        armDelayTicks: 0,
        residueTicks: 10,
      })));
    }
    const firstBeforeOverflow = pool.snapshot(handles[0] as ProjectileHandle);

    const overflowRequest = {
      tick120: 0,
      occurrenceKey: "heavy-overflow",
      archetypeId: "bullet.heavy.test",
      position: {x: 999, y: 0},
      armDelayTicks: 0,
      residueTicks: 10,
    } as const;
    expect(pool.spawn(overflowRequest)).toBeNull();
    expect(() => pool.spawn(overflowRequest)).toThrow(/duplicate projectile spawn occurrence/);

    expect(pool.usage()).toMatchObject({
      active: {heavy: 192},
      allocatedSlots: {heavy: 192},
      liveColliders: 192,
    });
    expect(pool.snapshot(handles[0] as ProjectileHandle)).toEqual(firstBeforeOverflow);
    expect(pool.auditLog()).toEqual([{
      sequence: 0,
      tick120: 0,
      occurrenceKey: "projectiles/test:heavy-overflow:spawn-rejected",
      kind: "projectile.spawn.rejected",
      reason: "budget_exhausted",
      poolClass: "heavy",
      archetypeId: "bullet.heavy.test",
      budget: 192,
    }]);
    expect(pool.canonicalAuditSerialization()).toContain("projectile.spawn.rejected");
  });

  it("does not reuse a residue-owning slot, then reuses only after cleanup with a new generation", () => {
    const {pool} = makeAuthority();
    const handles: ProjectileHandle[] = [];
    for (let index = 0; index < PROJECTILE_POOL_BUDGETS.heavy; index += 1) {
      handles.push(requireHandle(pool.spawn({
        tick120: 0,
        occurrenceKey: `occupied-${index}`,
        archetypeId: "bullet.heavy.test",
        position: {x: index, y: 0},
        armDelayTicks: 0,
        residueTicks: 10,
      })));
    }
    const retiring = handles[0] as ProjectileHandle;
    pool.cancel(retiring, 1, "pattern_end");
    expect(pool.snapshot(retiring).state).toBe("residue");

    expect(pool.spawn({
      tick120: 10,
      occurrenceKey: "before-cleanup",
      archetypeId: "bullet.heavy.test",
      position: {x: 1, y: 1},
      armDelayTicks: 0,
      residueTicks: 1,
    })).toBeNull();

    pool.advanceTo(11);
    expect(pool.isActive(retiring)).toBe(false);
    const replacement = requireHandle(pool.spawn({
      tick120: 11,
      occurrenceKey: "after-cleanup",
      archetypeId: "bullet.heavy.test",
      position: {x: 1, y: 1},
      armDelayTicks: 0,
      residueTicks: 1,
    }));
    expect(replacement).toEqual({instanceId: retiring.instanceId, generation: 1});
    expect(() => pool.snapshot(retiring)).toThrow(/stale or inactive/);
  });

  it("caps visual-only residue without changing authoritative cleanup", () => {
    const {pool} = makeAuthority();
    const handles: ProjectileHandle[] = [];
    for (let index = 0; index <= PROJECTILE_POOL_BUDGETS.residueVisualOnly; index += 1) {
      handles.push(requireHandle(pool.spawn({
        tick120: 0,
        occurrenceKey: `residue-${index}`,
        archetypeId: "bullet.micro.test",
        position: {x: index, y: 0},
        armDelayTicks: 0,
        residueTicks: 1,
      })));
    }
    for (const handle of handles) pool.cancel(handle, 1, "pattern_end");

    expect(pool.usage()).toMatchObject({
      active: {micro: PROJECTILE_POOL_BUDGETS.residueVisualOnly + 1},
      liveColliders: 0,
      residueVisuals: PROJECTILE_POOL_BUDGETS.residueVisualOnly,
    });
    expect(pool.auditLog().at(-1)).toMatchObject({
      kind: "projectile.residue-visual.rejected",
      reason: "budget_exhausted",
      poolClass: "residueVisualOnly",
      budget: 1536,
    });

    pool.advanceTo(2);
    expect(pool.activeSnapshots()).toHaveLength(0);
    expect(pool.usage().residueVisuals).toBe(0);
  });

  it("throws on replayed spawn occurrences and stale generations", () => {
    const {pool} = makeAuthority();
    const spawn = {
      tick120: 0,
      occurrenceKey: "deduplicated-spawn",
      archetypeId: "bullet.micro.test",
      position: {x: 0, y: 0},
      armDelayTicks: 0,
      residueTicks: 0,
    } as const;
    const first = requireHandle(pool.spawn(spawn));
    expect(() => pool.spawn(spawn)).toThrow(/duplicate projectile spawn occurrence/);
    pool.cancel(first, 1, "pattern_end");

    const second = requireHandle(pool.spawn({...spawn, tick120: 1, occurrenceKey: "next-generation"}));
    expect(second).toEqual({instanceId: first.instanceId, generation: 1});
    expect(() => pool.move(first, 1, {x: 1, y: 1})).toThrow(/stale or inactive/);
  });

  it("does not claim an occurrence until the complete spawn request is valid", () => {
    const {pool} = makeAuthority();
    const occurrenceKey = "corrected-request";
    expect(() => pool.spawn({
      tick120: 0,
      occurrenceKey,
      archetypeId: "bullet.missing",
      position: {x: 0, y: 0},
      armDelayTicks: 0,
      residueTicks: 1,
    })).toThrow(/unknown projectile archetype/);

    expect(pool.spawn({
      tick120: 0,
      occurrenceKey,
      archetypeId: "bullet.micro.test",
      position: {x: 0, y: 0},
      armDelayTicks: 0,
      residueTicks: 1,
    })).not.toBeNull();
  });
});

describe("projectile determinism", () => {
  function scenario(): {readonly events: string; readonly audit: string} {
    const {bus, pool} = makeAuthority("projectiles/determinism");
    const handles = [0, 1, 2].map((index) => requireHandle(pool.spawn({
      tick120: 0,
      occurrenceKey: `deterministic-${index}`,
      archetypeId: "bullet.micro.test",
      position: {x: index * 4, y: 0},
      armDelayTicks: 2,
      residueTicks: 3,
    })));
    pool.advanceTo(2);
    pool.move(handles[0] as ProjectileHandle, 3, {x: 20, y: 40});
    pool.cancel(handles[1] as ProjectileHandle, 3, "source_withdrawn");
    pool.impact(handles[2] as ProjectileHandle, 4, "player/0");
    pool.advanceTo(7);
    bus.flush();
    return {
      events: bus.canonicalSerialization(),
      audit: pool.canonicalAuditSerialization(),
    };
  }

  it("produces byte-identical canonical events and audit logs for the same tick inputs", () => {
    expect(scenario()).toEqual(scenario());
  });
});
