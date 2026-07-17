import {describe, expect, it} from "vitest";
import {GameSimulation} from "./simulation";
import type {InputFrame} from "./input";
import type {
  BulletState,
  EmitterDefinition,
  MotionDefinition,
  PatternDefinition,
  SimulationEvent,
  SimulationSnapshot,
} from "./types";

const PLAYER_START_Y = -238;

interface EmitterOptions {
  id: string;
  x?: number;
  y?: number;
  count?: number;
  speed?: number;
  startMs?: number;
  intervalMs?: number;
  bursts?: number;
  geometryType?: string;
  baseAngleDeg?: number;
  spreadDeg?: number;
  radius?: number;
  armDelayMs?: number;
  motionStack?: MotionDefinition[];
}

function emitter({
  id,
  x = 80,
  y = 200,
  count = 1,
  speed = 1,
  startMs = 0,
  intervalMs = 1000,
  bursts = 1,
  geometryType = "fan",
  baseAngleDeg = 0,
  spreadDeg = 0,
  radius = 1,
  armDelayMs = 0,
  motionStack = [],
}: EmitterOptions): EmitterDefinition {
  return {
    id,
    kind: "test",
    anchor: {
      space: "field-normalized",
      x: (x + 180) / 360,
      y: (320 - y) / 640,
    },
    geometry: {
      type: geometryType,
      variant: "test",
      count,
      baseAngleDeg,
      spreadDeg,
      ordering: "index",
    },
    cadence: {startMs, intervalMs, bursts, intraBurstMs: 0},
    projectile: {
      archetype: "projectile.test",
      collisionRadiusPx: radius,
      armDelayMs,
    },
    speedCurve: {type: "constant", keys: [{atMs: 0, pxPerSec: speed}]},
    motionStack,
  };
}

function pattern(
  emitters: EmitterDefinition[],
  {id = "test.pattern", durationMs = 10_000, seed = 0x1b17}: {
    id?: string;
    durationMs?: number;
    seed?: number;
  } = {},
): PatternDefinition {
  const profile = {
    countMultiplier: 1,
    speedMultiplier: 1,
    cadenceMultiplier: 1,
    gapDeltaPx: 0,
  };
  return {
    id,
    category: "ROOM",
    room: "TEST",
    name: {zh: "测试", en: "Test"},
    intent: "An irreducible simulation contract fixture.",
    durationMs,
    clock: {authority: "gameplay", tickHz: 120},
    timeline: [],
    emitters,
    safeGap: {
      type: "none",
      minimumWidthPx: 0,
      focusMinimumWidthPx: 0,
      path: {centerX: 180, amplitudePx: 0, periodMs: 1000, phase: 0, laneX: []},
    },
    warning: {durationMs: 0, shape: "none"},
    difficulty: {
      EASY: {...profile},
      NORMAL: {...profile},
      HARD: {...profile},
    },
    seed: {algorithm: "mulberry32", base: seed},
  };
}

function input(overrides: Partial<InputFrame> = {}): InputFrame {
  return {
    move: {x: 0, y: 0},
    shoot: false,
    focus: false,
    overridePressed: false,
    pausePressed: false,
    ...overrides,
  };
}

function bulletDigest(bullet: BulletState): object {
  const {turned, ...state} = bullet;
  return {...state, turned: [...turned].sort()};
}

function snapshotDigest(snapshot: SimulationSnapshot): object {
  return {
    nowMs: snapshot.nowMs,
    patternElapsedMs: snapshot.patternElapsedMs,
    patternId: snapshot.pattern.id,
    bullets: snapshot.bullets.map(bulletDigest),
    shots: snapshot.shots.map((shot) => ({...shot})),
    player: {
      ...snapshot.player,
      position: {...snapshot.player.position},
    },
    protocol: snapshot.protocol,
    overrideUntilMs: snapshot.overrideUntilMs,
    paused: snapshot.paused,
  };
}

function makeSimulation(definition: PatternDefinition): {
  simulation: GameSimulation;
  events: SimulationEvent[];
} {
  const events: SimulationEvent[] = [];
  return {
    simulation: new GameSimulation([definition], (event) => events.push({...event})),
    events,
  };
}

describe("GameSimulation deterministic authority", () => {
  it("replays an identical fixed-step input trace to an identical state and event stream", () => {
    const definition = pattern([
      emitter({
        id: "deterministic-emitter",
        x: -80,
        y: 210,
        count: 5,
        speed: 80,
        intervalMs: 160,
        bursts: 4,
        geometryType: "history_chain",
        baseAngleDeg: 100,
        spreadDeg: 42,
        motionStack: [
          {operator: "op.turn_once", params: {atMs: 420, deltaDeg: 27}},
          {operator: "op.split_generation", params: {delayMs: 700, maxGeneration: 1}},
        ],
      }),
    ], {id: "deterministic-trace", seed: 0xc0ffee});
    const first = makeSimulation(definition);
    const second = makeSimulation(structuredClone(definition));
    const frameMs = 1000 / 120;

    for (let frame = 0; frame < 240; frame += 1) {
      const frameInput = input({
        move: {
          x: frame % 40 < 20 ? 0.35 : -0.35,
          y: frame % 60 < 30 ? 0.2 : -0.2,
        },
        shoot: frame % 3 !== 0,
        focus: frame % 17 < 5,
        overridePressed: frame === 70 || frame === 180,
        pausePressed: frame === 90 || frame === 102,
      });
      first.simulation.step(frameMs, frameInput);
      second.simulation.step(frameMs, frameInput);
    }

    expect(snapshotDigest(first.simulation.snapshot())).toEqual(snapshotDigest(second.simulation.snapshot()));
    expect(first.events).toEqual(second.events);
    expect(first.simulation.snapshot().nowMs).toBeCloseTo(1900, 8);
    expect(first.events.map((event) => event.detail)).toContain("gameplay.clock.freeze");
    expect(first.events.map((event) => event.detail)).toContain("gameplay.clock.resume");
    expect(first.simulation.snapshot().bullets.length).toBeGreaterThan(0);
  });

  it("commits at most one same-frame hit and preserves damage recovery and fatal ordering", () => {
    const definition = pattern([
      emitter({id: "hit-a", x: 0, y: PLAYER_START_Y}),
      emitter({id: "hit-b", x: 0, y: PLAYER_START_Y}),
      emitter({id: "hit-c", x: 0, y: PLAYER_START_Y}),
    ], {id: "damage-authority"});
    const {simulation, events} = makeSimulation(definition);

    simulation.step(1, input());
    expect(simulation.snapshot().player).toMatchObject({health: 2, lives: 3, collisionEnabled: false});
    expect(simulation.snapshot().bullets).toHaveLength(2);
    expect(simulation.snapshot().player.evidence).toBe(0);
    expect(events.filter((event) => event.type === "damage")).toEqual([
      {type: "damage", atMs: 1, detail: "player.damage.non-fatal"},
    ]);

    simulation.step(1000, input());
    expect(simulation.snapshot().player).toMatchObject({health: 1, lives: 3, collisionEnabled: false});
    expect(simulation.snapshot().bullets).toHaveLength(1);

    simulation.step(1000, input());
    expect(simulation.snapshot().player).toMatchObject({health: 0, lives: 2, collisionEnabled: false});
    expect(simulation.snapshot().bullets).toHaveLength(0);
    expect(events.filter((event) => event.type === "damage")).toEqual([
      {type: "damage", atMs: 1, detail: "player.damage.non-fatal"},
      {type: "damage", atMs: 1001, detail: "player.damage.non-fatal"},
      {type: "damage", atMs: 2001, detail: "player.damage.fatal"},
    ]);

    simulation.step(1099, input());
    expect(simulation.snapshot().player).toMatchObject({health: 0, lives: 2, collisionEnabled: false});
    simulation.step(1, input());
    expect(simulation.snapshot().player).toMatchObject({health: 3, lives: 2, collisionEnabled: false});
    simulation.step(699, input());
    expect(simulation.snapshot().player.collisionEnabled).toBe(false);
    simulation.step(1, input());
    expect(simulation.snapshot().player).toMatchObject({health: 3, lives: 2, collisionEnabled: true});
  });

  it("awards each projectile graze once and makes Override evidence-paid and directional", () => {
    const forwardY = PLAYER_START_Y + 10;
    const definition = pattern([
      emitter({id: "forward-a", x: 0, y: forwardY}),
      emitter({id: "forward-b", x: 0, y: forwardY}),
      emitter({id: "forward-c", x: 0, y: forwardY}),
      emitter({id: "side", x: 10, y: PLAYER_START_Y}),
    ], {id: "graze-override"});
    const {simulation, events} = makeSimulation(definition);

    // Override is evaluated before this frame's projectile movement/graze commits.
    simulation.step(1, input({overridePressed: true}));
    expect(simulation.snapshot().player.evidence).toBe(4);
    expect(simulation.snapshot().bullets.every((bullet) => bullet.grazed)).toBe(true);
    expect(events.filter((event) => event.type === "graze")).toHaveLength(4);
    expect(events.filter((event) => event.type === "override-denied")).toHaveLength(1);

    simulation.step(100, input());
    expect(simulation.snapshot().player.evidence).toBe(4);
    expect(events.filter((event) => event.type === "graze")).toHaveLength(4);

    simulation.step(1, input({overridePressed: true}));
    const afterOverride = simulation.snapshot();
    expect(afterOverride.player.evidence).toBe(1);
    expect(afterOverride.bullets).toHaveLength(1);
    expect(afterOverride.bullets[0]?.position.y).toBeCloseTo(PLAYER_START_Y);
    expect(afterOverride.overrideUntilMs).toBe(522);
    expect(events.filter((event) => event.type === "override")).toEqual([
      {type: "override", atMs: 102, detail: "local_void.open · 3 cancelled"},
    ]);

    simulation.step(1, input({overridePressed: true}));
    expect(simulation.snapshot().player.evidence).toBe(1);
    expect(simulation.snapshot().overrideUntilMs).toBe(522);
    expect(events.filter((event) => event.type === "override-denied")).toHaveLength(2);
  });

  it("loops a completed pattern at the exact duration boundary and re-arms its emitters", () => {
    const definition = pattern([
      emitter({id: "loop-emitter", x: 80, y: 200, speed: 10}),
    ], {id: "loop-contract", durationMs: 100});
    const {simulation, events} = makeSimulation(definition);

    simulation.step(99, input());
    expect(simulation.snapshot()).toMatchObject({nowMs: 99, patternElapsedMs: 99});
    expect(simulation.snapshot().bullets).toHaveLength(1);
    expect(simulation.snapshot().bullets[0]?.id).toBe(0);

    simulation.step(1, input());
    expect(simulation.snapshot()).toMatchObject({nowMs: 100, patternElapsedMs: 0});
    expect(simulation.snapshot().bullets).toHaveLength(0);
    expect(events).toEqual([
      {type: "pattern", atMs: 100, detail: "pattern.complete · loop-contract"},
      {type: "pattern", atMs: 100, detail: "pattern.begin · loop-contract"},
    ]);

    simulation.step(1, input());
    expect(simulation.snapshot()).toMatchObject({nowMs: 101, patternElapsedMs: 1});
    expect(simulation.snapshot().bullets).toHaveLength(1);
    expect(simulation.snapshot().bullets[0]?.id).toBe(1);
  });

  it("freezes all gameplay state while paused and resumes only on the next pause edge", () => {
    const definition = pattern([
      emitter({id: "pause-emitter", x: 80, y: 200, speed: 10}),
    ], {id: "pause-contract"});
    const {simulation, events} = makeSimulation(definition);

    simulation.step(10, input());
    const beforePause = snapshotDigest(simulation.snapshot());
    simulation.step(50, input({pausePressed: true}));
    expect(simulation.snapshot()).toMatchObject({paused: true, nowMs: 10, patternElapsedMs: 10});

    simulation.step(500, input({
      move: {x: 1, y: 1},
      shoot: true,
      focus: true,
      overridePressed: true,
    }));
    const whilePaused = snapshotDigest(simulation.snapshot()) as Record<string, unknown>;
    expect({...whilePaused, paused: false}).toEqual(beforePause);
    expect(events).toEqual([
      {type: "pattern", atMs: 10, detail: "gameplay.clock.freeze"},
    ]);

    simulation.step(25, input({pausePressed: true}));
    expect(simulation.snapshot()).toMatchObject({paused: false, nowMs: 35, patternElapsedMs: 35});
    expect(events).toEqual([
      {type: "pattern", atMs: 10, detail: "gameplay.clock.freeze"},
      {type: "pattern", atMs: 10, detail: "gameplay.clock.resume"},
    ]);
    expect(simulation.snapshot().bullets[0]?.ageMs).toBe(35);
  });

  it("rejects construction without a pattern authority", () => {
    expect(() => new GameSimulation([], () => undefined)).toThrow("At least one pattern is required");
  });
});
