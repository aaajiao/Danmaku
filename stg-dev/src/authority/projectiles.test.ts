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

    expect(pool.spawn({
      tick120: 0,
      occurrenceKey: "heavy-overflow",
      archetypeId: "bullet.heavy.test",
      position: {x: 999, y: 0},
      armDelayTicks: 0,
      residueTicks: 10,
    })).toBeNull();

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
    pool.cancel(first, 0, "pattern_end");

    const second = requireHandle(pool.spawn({...spawn, occurrenceKey: "next-generation"}));
    expect(second).toEqual({instanceId: first.instanceId, generation: 1});
    expect(() => pool.move(first, 0, {x: 1, y: 1})).toThrow(/stale or inactive/);
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
