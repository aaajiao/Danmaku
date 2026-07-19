import {createHash} from "node:crypto";
import {describe, expect, it} from "vitest";

import {
  CanonicalCombatKernel,
  SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS,
} from "../combat-kernel";
import {executablePattern} from "../pattern-executor";
import {validateMisregistrationCorridorPatternContract} from "./misregistration-corridor";

const PATTERN_ID = "room.in_between.misregistration_corridor";
const REPORT_SEED = 4_108_506_635;

function kernel(): CanonicalCombatKernel {
  return new CanonicalCombatKernel({
    patternId: PATTERN_ID,
    seed: REPORT_SEED,
    startTick120: 0,
    roomId: "IN_BETWEEN",
    difficulty: "NORMAL",
    initialPlayerPosition: {x: 8, y: 540},
    grazeRadiusPx: 9,
    projectileDamage: 1,
    projectilePoolClasses: {"bullet.micro.notch_e": "micro"},
  });
}

function step(authority: CanonicalCombatKernel, tick120: number): void {
  authority.step({
    tick120,
    movement: {x: 0, y: 0},
    focused: false,
  });
}

describe("V4 Misregistration Corridor live combat capability", () => {
  it("pins the complete descriptor and rejects hostile drift without invoking accessors", () => {
    const source = executablePattern(PATTERN_ID);
    expect(() => validateMisregistrationCorridorPatternContract(source)).not.toThrow();

    const changedRelease = structuredClone(source) as unknown as Record<string, any>;
    changedRelease.emitters[0].motionStack[0].params.releaseAtMs = 621;
    expect(() => validateMisregistrationCorridorPatternContract(changedRelease))
      .toThrow(/exact contract drifted/);

    const sparseTimeline = structuredClone(source) as unknown as Record<string, any>;
    delete sparseTimeline.timeline[3];
    expect(() => validateMisregistrationCorridorPatternContract(sparseTimeline))
      .toThrow(/dense/);

    let radiusReads = 0;
    const accessorParams = structuredClone(source) as unknown as Record<string, any>;
    Object.defineProperty(accessorParams.emitters[0].motionStack[0].params, "radiusPx", {
      enumerable: true,
      get() {
        radiusReads += 1;
        return 34;
      },
    });
    expect(() => validateMisregistrationCorridorPatternContract(accessorParams))
      .toThrow(/own data property/);
    expect(radiusReads).toBe(0);
  });

  it("preflights the whole orbit/release path, crosses release once, and drains material", () => {
    expect(SUPPORTED_CANONICAL_COMBAT_PATTERN_IDS).toContain(PATTERN_ID);
    const authority = kernel();

    for (let tick120 = 1; tick120 <= 90; tick120 += 1) step(authority, tick120);
    expect(authority.snapshot()).toMatchObject({
      tick120: 90,
      rngCallsConsumed: 8,
      projectiles: [],
      poolUsage: {liveColliders: 0, residueVisuals: 0},
    });
    expect(authority.events().filter((event) => event.id === "projectile.spawn.commit"))
      .toHaveLength(0);

    for (let tick120 = 91; tick120 <= 197; tick120 += 1) step(authority, tick120);
    const beforeRelease = authority.snapshot().projectiles[0];
    expect(beforeRelease).toMatchObject({
      instanceId: "combat:room.in_between.misregistration_corridor/micro/0000",
      state: "flight",
      collisionEnabled: true,
      headingDegrees: 91.18425133053213,
      speedPxPerSecond: 54.24483315198376,
      position: {x: 215.47695869720764, y: 61.67673736135711},
    });

    step(authority, 198);
    const released = authority.snapshot().projectiles[0];
    expect(released).toMatchObject({
      instanceId: beforeRelease?.instanceId,
      generation: beforeRelease?.generation,
      state: "flight",
      collisionEnabled: true,
      headingDegrees: 92,
      speedPxPerSecond: 148,
      position: {x: 215.18071041794934, y: 62.05064347435784},
    });
    expect(authority.snapshot().adapterGaps.misregistrationOrbitRelease).toEqual({
      order:
        "geometry-source-index>one-rng-jitter>full-orbit-release-swept-preflight>entity-spawn",
      phasePolicy: "ext-018-one-candidate-draw-times-tau",
      referenceDivergence: "qa-golden-ordinal-phase-remains-reference-only",
      releasePolicy: "exact-release-boundary>authored-absolute-heading>linear-remainder",
      armPolicy: "anchor-spawn>first-live-tick-radial-to-orbit-sweep",
      spawnIdentity: "assigned-only-after-preflight-pass",
      residue: "omitted-candidates-have-no-events-or-residue",
      runtimeViolation: "fail-stop-never-source-withdrawn",
    });

    for (let tick120 = 199; tick120 <= 1272; tick120 += 1) step(authority, tick120);
    expect(authority.snapshot()).toMatchObject({
      tick120: 1272,
      rngCallsConsumed: 176,
      patternComplete: true,
      digitalBodiesDrained: true,
      materialResidueDraining: true,
      projectileLifecycleDrained: false,
      poolUsage: {liveColliders: 0, residueVisuals: 103},
    });
    expect(authority.snapshot().projectiles.every((projectile) =>
      projectile.state === "residue" && projectile.collisionEnabled === false)).toBe(true);

    for (let tick120 = 1273; tick120 <= 1734; tick120 += 1) step(authority, tick120);
    expect(authority.snapshot()).toMatchObject({
      tick120: 1734,
      projectileLifecycleDrained: false,
      materialResidueDraining: true,
      poolUsage: {liveColliders: 0, residueVisuals: 71},
    });
    step(authority, 1735);
    expect(authority.snapshot()).toMatchObject({
      tick120: 1735,
      projectiles: [],
      projectileLifecycleDrained: true,
      materialResidueDraining: false,
      handoffReady: true,
      poolUsage: {liveColliders: 0, residueVisuals: 0},
    });

    const events = authority.events();
    const count = (id: string, reason?: string): number => events.filter((event) =>
      event.id === id && (reason === undefined || event.payload.reason === reason)).length;
    expect({
      candidates: authority.snapshot().rngCallsConsumed,
      admitted: count("projectile.spawn.commit"),
      armed: count("projectile.armed"),
      omittedWithoutIdentity: authority.snapshot().rngCallsConsumed
        - count("projectile.spawn.commit"),
      sourceWithdrawn: count("projectile.cancel.commit", "source_withdrawn"),
      outOfBounds: count("projectile.cancel.commit", "out_of_bounds"),
      patternEnd: count("projectile.cancel.commit", "pattern_end"),
      impacts: count("projectile.impact.commit"),
      damage: count("player.damage.commit"),
      residueRemoved: count("projectile.residue.remove"),
      traceSha256: createHash("sha256")
        .update(authority.canonicalEventSerialization())
        .digest("hex"),
    }).toEqual({
      candidates: 176,
      admitted: 113,
      armed: 113,
      omittedWithoutIdentity: 63,
      sourceWithdrawn: 0,
      outOfBounds: 42,
      patternEnd: 71,
      impacts: 0,
      damage: 0,
      residueRemoved: 113,
      traceSha256: "61dcdbc403ec1a0acfd4376f3112700e2ae02618e37cbbbfea749f50425dc7bd",
    });
  });
});
