import {assertExactDataContract} from "../exact-data-contract";

function deepFreezeJson<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => deepFreezeJson(entry))) as T;
  }
  if (typeof value === "object" && value !== null) {
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) copy[key] = deepFreezeJson(entry);
    return Object.freeze(copy) as T;
  }
  return value;
}

const MISREGISTRATION_CORRIDOR_PATTERN_CONTRACT = deepFreezeJson({
  id: "room.in_between.misregistration_corridor",
  category: "ROOM",
  room: "IN_BETWEEN",
  name: {zh: "套印偏差", en: "Misregistration corridor"},
  intent: "两套近似轨迹错开少量距离，空隙来自误差而非设计善意。",
  durationMs: 10600,
  clock: {
    authority: "GAMEPLAY",
    tickHz: 120,
    eventDispatch: "crossed-time-exactly-once",
    pausePolicy: "freeze",
    visualClockSeparated: true,
  },
  timeline: [
    {atMs: 0, event: "warning.begin"},
    {atMs: 747, event: "collision.arm"},
    {atMs: 747, event: "emit.begin"},
    {atMs: 5300, event: "pattern.midpoint"},
    {atMs: 9900, event: "emit.end"},
    {atMs: 10180, event: "residue.commit"},
    {atMs: 10600, event: "pattern.complete"},
  ],
  emitters: [
    {
      id: "print-a",
      kind: "projectile",
      anchor: {space: "viewport-normalized", x: 0.43, y: 0.16},
      geometry: {
        type: "spiral",
        variant: "clockwise-offset",
        count: 8,
        baseAngleDeg: 90,
        spreadDeg: 220,
        ordering: "clockwise-then-source-index",
      },
      cadence: {startMs: 747, intervalMs: 840, bursts: 11, intraBurstMs: 0},
      projectile: {
        archetype: "bullet.micro.notch_e",
        collisionRadiusPx: 2,
        armDelayMs: 40,
      },
      speedCurve: {type: "piecewise-linear", keys: [{atMs: 0, pxPerSec: 148}]},
      motionStack: [
        {
          operator: "op.orbit_release",
          params: {
            radiusPx: 34,
            angularDegPerSec: 88,
            releaseAtMs: 620,
            releaseHeadingDeg: 88,
          },
        },
        {operator: "op.linear", params: {}},
      ],
    },
    {
      id: "print-b",
      kind: "projectile",
      anchor: {space: "viewport-normalized", x: 0.57, y: 0.16},
      geometry: {
        type: "spiral",
        variant: "counter-offset",
        count: 8,
        baseAngleDeg: 90,
        spreadDeg: 220,
        ordering: "clockwise-then-source-index",
      },
      cadence: {startMs: 867, intervalMs: 840, bursts: 11, intraBurstMs: 0},
      projectile: {
        archetype: "bullet.micro.notch_e",
        collisionRadiusPx: 2,
        armDelayMs: 40,
      },
      speedCurve: {type: "piecewise-linear", keys: [{atMs: 0, pxPerSec: 148}]},
      motionStack: [
        {
          operator: "op.orbit_release",
          params: {
            radiusPx: 42,
            angularDegPerSec: -74,
            releaseAtMs: 780,
            releaseHeadingDeg: 92,
          },
        },
        {operator: "op.linear", params: {}},
      ],
    },
  ],
  safeGap: {
    type: "offset_corridor",
    minimumWidthPx: 30,
    focusMinimumWidthPx: 22,
    path: {
      centerX: 180,
      amplitudePx: 48,
      periodMs: 8200,
      phase: 0,
      laneX: [],
      maxTravelPxPerSec: 78,
    },
    enforcement: "spawn_omission",
    compileRule:
      "omit, gate, redirect, or visibly cancel any candidate whose swept circle violates the corridor envelope",
    readability: {leadMs: 520, neverColorOnly: true},
  },
  warning: {
    durationMs: 747,
    shape: "offset_orbit_capsules",
    coversSweptArea: true,
    collisionEnabled: false,
    flashIndependent: true,
  },
  cancel: {
    triggers: ["pattern_end", "source_withdrawn", "override_void", "room_transition"],
    mode: "digital_cancel_to_material_residue",
    collisionOffBeforeVisual: true,
    eventIdempotent: true,
  },
  residue: {
    type: "misregistration_flake",
    lifetimeMs: 3851,
    density: 0.24,
    inheritsSourceId: true,
    gameplayCollision: false,
  },
  difficulty: {
    EASY: {countMultiplier: 0.78, speedMultiplier: 0.88, cadenceMultiplier: 1.16, gapDeltaPx: 8},
    NORMAL: {countMultiplier: 1, speedMultiplier: 1, cadenceMultiplier: 1, gapDeltaPx: 0},
    HARD: {countMultiplier: 1.18, speedMultiplier: 1.12, cadenceMultiplier: 0.88, gapDeltaPx: -4},
  },
  seed: {
    algorithm: "mulberry32-v1",
    base: 4108504342,
    composition: "runSeed xor base xor encounterOrdinal xor difficultySalt",
    randomCalls: "emitter-order then burst-order then projectile-order",
  },
  accessibility: {
    reducedMotionGameplayParity: true,
    flashOffGameplayParity: true,
    telegraphNeverColorOnly: true,
  },
});

/** Exact descriptor-safe V4 contract for the live Misregistration Corridor capability. */
export function validateMisregistrationCorridorPatternContract(patternValue: unknown): void {
  assertExactDataContract(
    patternValue,
    MISREGISTRATION_CORRIDOR_PATTERN_CONTRACT,
    "room.in_between.misregistration_corridor",
  );
}
