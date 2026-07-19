import {describe, expect, it} from "vitest";
import {
  CanonicalCombatKernel,
  CanonicalRunCombatState,
  type CanonicalCombatStepInput,
} from "./combat-kernel";
import {
  CanonicalEventBus,
  serializeCanonicalEvents,
  type CanonicalGameplayEvent,
} from "./events";
import type {CanonicalRunSessionHandoffSnapshot} from "./run-session";
import {
  RUN_ROOM_SESSION_CONTRACT,
  CanonicalRunRoomSession,
  type CanonicalRunRoomSessionOptions,
  type CanonicalRunRoomSessionSnapshot,
} from "./run-room-session";

const RAW_RUN_SEED = 0x1234_5678;
const RESOLVED_ROOM_SEED = 0x7876_34f1;
const SOURCE_EVENT_TICK120 = 0;
const DEFAULT_HANDOFF_TICK120 = 240;

function inputAt(
  tick120: number,
  overrides: Partial<CanonicalCombatStepInput> = {},
): CanonicalCombatStepInput {
  return {
    tick120,
    movement: {x: 0, y: 0},
    focused: false,
    ...overrides,
  };
}

function handoffAt(
  tick120: number,
  overrides: Partial<CanonicalRunSessionHandoffSnapshot> = {},
): CanonicalRunSessionHandoffSnapshot {
  return {
    state: "ready_for_room_sampling",
    targetNarrativeState: "ROOM_SAMPLING",
    ready: true,
    sourcePatternId: "common.eye_acquisition",
    atTick120: tick120,
    consumed: false,
    consumedAtTick120: null,
    consumerAuthority: null,
    barriers: {
      combatDrained: true,
      gazeClampCommitted: true,
      gazeClampReleased: true,
      flowerRecoveryComplete: true,
      gazeTimedStateQuiescent: true,
    },
    recovery: {
      delayTicks120: 30,
      dueAtTick120: tick120,
      completedAtTick120: tick120,
    },
    sourceCombat: {
      tick120,
      patternComplete: true,
      projectileLifecycleDrained: true,
      handoffReady: true,
      liveEntities: 0,
      liveColliders: 0,
    },
    ...overrides,
  } as CanonicalRunSessionHandoffSnapshot;
}

interface SourceFixture {
  readonly handoffTick120: number;
  readonly bus: CanonicalEventBus;
  readonly state: CanonicalRunCombatState;
  readonly handoff: CanonicalRunSessionHandoffSnapshot;
  readonly sourceEvents: readonly CanonicalGameplayEvent[];
  readonly sourceSerialization: string;
}

function sourceFixture(handoffTick120 = DEFAULT_HANDOFF_TICK120): SourceFixture {
  const bus = new CanonicalEventBus();
  bus.enqueue({
    id: "flower.intensity.commit",
    tick120: SOURCE_EVENT_TICK120,
    entityStableId: "source:first-eye",
    localSequence: 0,
    occurrenceKey: "source:first-eye:flower",
    payload: {source: "first-eye-test", targetIntensity: 0.4},
  });
  bus.flush();
  const state = new CanonicalRunCombatState({
    startTick120: handoffTick120,
    initialPlayerPosition: {x: 180, y: 570},
    grazeRadiusPx: 18,
    projectileDamage: 1,
    projectilePoolClasses: {"bullet.micro.notch_e": "micro"},
  }, bus);
  return {
    handoffTick120,
    bus,
    state,
    handoff: handoffAt(handoffTick120),
    sourceEvents: bus.events(),
    sourceSerialization: bus.canonicalSerialization(),
  };
}

function optionsFor(source: SourceFixture): CanonicalRunRoomSessionOptions {
  return {
    rawRunSeed: {domain: "raw-run-seed", value: RAW_RUN_SEED},
    handoff: source.handoff,
    eventBus: source.bus,
    runState: source.state,
  };
}

function stepTo(
  session: CanonicalRunRoomSession,
  targetTick120: number,
  input = inputAt,
): CanonicalRunRoomSessionSnapshot {
  let snapshot = session.snapshot();
  for (let tick120 = snapshot.tick120 + 1; tick120 <= targetTick120; tick120 += 1) {
    snapshot = session.step(input(tick120));
  }
  return snapshot;
}

function isDeepFrozen(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value !== "object" || value === null || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value)
    && Object.values(value).every((entry) => isDeepFrozen(entry, seen));
}

function realFirstEyeSource(): SourceFixture {
  const bus = new CanonicalEventBus();
  const state = new CanonicalRunCombatState({
    startTick120: 0,
    initialPlayerPosition: {x: 180, y: 570},
    grazeRadiusPx: 18,
    projectileDamage: 1,
    projectilePoolClasses: {"bullet.micro.notch_e": "micro"},
  }, bus);
  const firstEye = new CanonicalCombatKernel({
    patternId: "common.eye_acquisition",
    occurrenceId: "run:first-eye",
    seed: 99,
    startTick120: 0,
    roomId: "INFORMATION",
    difficulty: "EASY",
    initialPlayerPosition: {x: 180, y: 570},
    grazeRadiusPx: 18,
    projectileDamage: 1,
    projectilePoolClasses: {"bullet.micro.notch_e": "micro"},
  }, state);
  let sourceCombat = firstEye.snapshot();
  for (let tick120 = 1; tick120 <= 2000; tick120 += 1) {
    sourceCombat = firstEye.step(inputAt(tick120));
    if (sourceCombat.handoffReady && state.snapshot().activeOccurrenceId === null) break;
  }
  expect(sourceCombat.handoffReady).toBe(true);
  expect(state.snapshot().activeOccurrenceId).toBeNull();
  const handoffTick120 = state.snapshot().tick120;
  const sourceEvents = bus.events();
  return {
    handoffTick120,
    bus,
    state,
    handoff: handoffAt(handoffTick120, {
      sourceCombat: {
        tick120: sourceCombat.tick120,
        patternComplete: true,
        projectileLifecycleDrained: true,
        handoffReady: true,
        liveEntities: 0,
        liveColliders: 0,
      },
    }),
    sourceEvents,
    sourceSerialization: bus.canonicalSerialization(),
  };
}

describe("EXT-2026-005 fixed first-room bootstrap contract", () => {
  it("locks H without events or flushes and exposes both seed domains in a frozen snapshot", () => {
    const source = sourceFixture();
    const beforeState = source.state.snapshot();
    const beforeEvents = source.bus.events();
    const session = new CanonicalRunRoomSession(optionsFor(source));
    const snapshot = session.snapshot();

    expect(RUN_ROOM_SESSION_CONTRACT).toMatchObject({
      extensionPolicy: "EXT-2026-005",
      roomId: "FORCED_ALIGNMENT",
      tierId: "listen",
      difficulty: "EASY",
      patternId: "room.forced.left_right_gate",
      composer: false,
      weightedSelection: false,
      selectionRngDraws: 0,
      roomComplete: false,
      handoffReady: false,
    });
    expect(snapshot).toMatchObject({
      phase: "telegraph",
      tick120: source.handoffTick120,
      relativeTick120: 0,
      roomId: "FORCED_ALIGNMENT",
      patternId: "room.forced.left_right_gate",
      occurrenceId: "room:0:encounter:0:room.forced.left_right_gate",
      tierId: "listen",
      difficulty: "EASY",
      composer: false,
      rawRunSeed: {domain: "raw-run-seed", value: RAW_RUN_SEED},
      resolvedSeed: {domain: "resolved-occurrence-seed", value: RESOLVED_ROOM_SEED},
      difficultySalt: 0x1100,
      boundaryTicks120: {
        start: source.handoffTick120,
        telegraphEnd: source.handoffTick120 + 63,
        read: source.handoffTick120 + 159,
        materialSettle: source.handoffTick120 + 1383,
        rest: source.handoffTick120 + 1509,
        fixedSliceComplete: source.handoffTick120 + 1701,
        residueDeadline: source.handoffTick120 + 1699,
      },
      combat: null,
      entities: {digitalBodies: 0, liveColliders: 0, residueVisuals: 0},
      fixedSliceComplete: false,
      roomComplete: false,
      handoffReady: false,
      faulted: false,
    });
    expect(source.state.snapshot()).toEqual(beforeState);
    expect(source.bus.events()).toEqual(beforeEvents);
    expect(session.canonicalEventSerialization()).toBe(source.sourceSerialization);
    expect(isDeepFrozen(snapshot)).toBe(true);
    expect(isDeepFrozen(RUN_ROOM_SESSION_CONTRACT)).toBe(true);
    expect(Object.values(snapshot).some((value) =>
      value === source.bus || value === source.state)).toBe(false);
  });

  it("rejects wrong seed domains, hostile accessors, unsafe H, and mismatched shared handles", () => {
    const source = sourceFixture();
    expect(() => new CanonicalRunRoomSession({
      ...optionsFor(source),
      rawRunSeed: {domain: "resolved-occurrence-seed", value: RAW_RUN_SEED},
    } as unknown as CanonicalRunRoomSessionOptions)).toThrow(/raw-run-seed/);
    expect(() => new CanonicalRunRoomSession({
      ...optionsFor(source),
      rawRunSeed: {domain: "raw-run-seed", value: 0x1_0000_0000},
    })).toThrow(/uint32/);

    let optionReads = 0;
    const hostileOptions = Object.defineProperty({}, "rawRunSeed", {
      enumerable: true,
      get() {
        optionReads += 1;
        return {domain: "raw-run-seed", value: RAW_RUN_SEED};
      },
    });
    Object.defineProperties(hostileOptions, {
      handoff: {enumerable: true, value: source.handoff},
      eventBus: {enumerable: true, value: source.bus},
      runState: {enumerable: true, value: source.state},
    });
    expect(() => new CanonicalRunRoomSession(
      hostileOptions as CanonicalRunRoomSessionOptions,
    )).toThrow(/own enumerable data property/);
    expect(optionReads).toBe(0);

    let barrierReads = 0;
    const hostileHandoff = {
      ...source.handoff,
      barriers: Object.defineProperty({}, "combatDrained", {
        enumerable: true,
        get() {
          barrierReads += 1;
          return true;
        },
      }),
    };
    expect(() => new CanonicalRunRoomSession({
      ...optionsFor(source),
      handoff: hostileHandoff as CanonicalRunSessionHandoffSnapshot,
    })).toThrow(/own enumerable data property/);
    expect(barrierReads).toBe(0);

    const overflowSource = sourceFixture(Number.MAX_SAFE_INTEGER - 1700);
    expect(() => new CanonicalRunRoomSession(optionsFor(overflowSource))).toThrow(/boundaries safely/);

    const otherBus = new CanonicalEventBus();
    otherBus.enqueue({
      id: "flower.intensity.commit",
      tick120: 0,
      entityStableId: "other-source",
      localSequence: 0,
      occurrenceKey: "other-source:flower",
      payload: {source: "other", targetIntensity: 0.4},
    });
    otherBus.flush();
    expect(() => new CanonicalRunRoomSession({
      ...optionsFor(source),
      eventBus: otherBus,
    })).toThrow(/same canonical trace/);
    expect(source.state.snapshot().tick120).toBe(source.handoffTick120);
    expect(source.bus.canonicalSerialization()).toBe(source.sourceSerialization);
  });
});

describe("run room exact pre-read and READ ownership", () => {
  it("consumes H+1 exactly, screens Override without reading it, and starts local READ 0 at H+159", () => {
    const source = sourceFixture();
    const session = new CanonicalRunRoomSession(optionsFor(source));
    let overrideReads = 0;
    const firstInput = Object.defineProperty(inputAt(source.handoffTick120 + 1, {
      movement: {x: 1, y: 0},
    }), "overridePressed", {
      enumerable: true,
      get() {
        overrideReads += 1;
        return true;
      },
    });
    const first = session.step(firstInput);
    expect(overrideReads).toBe(0);
    expect(first).toMatchObject({
      phase: "telegraph",
      combat: null,
      entities: {digitalBodies: 0, liveColliders: 0},
      runCombat: {override: {state: "idle", cycle: 0}},
    });
    expect(first.runCombat.playerPosition.x).toBeCloseTo(180 + 188 / 120, 12);
    expect(session.events().filter((event) => event.id.startsWith("player.override"))).toEqual([]);

    const beforeSkip = session.snapshot();
    expect(() => session.step(inputAt(source.handoffTick120 + 3))).toThrow(/one exact tick/);
    expect(session.snapshot()).toEqual(beforeSkip);

    const telegraphLast = stepTo(session, source.handoffTick120 + 62);
    expect(telegraphLast).toMatchObject({phase: "telegraph", combat: null});
    expect(telegraphLast.entities).toEqual({digitalBodies: 0, liveColliders: 0, residueVisuals: 0});
    const entry = session.step(inputAt(source.handoffTick120 + 63));
    expect(entry).toMatchObject({phase: "entry", combat: null});
    const entryLast = stepTo(session, source.handoffTick120 + 158);
    expect(entryLast).toMatchObject({phase: "entry", combat: null});
    expect(session.events()).toHaveLength(source.sourceEvents.length);

    const read = session.step(inputAt(source.handoffTick120 + 159, {
      movement: {x: 1, y: 0},
      overridePressed: true,
      overrideDirection: {x: 0, y: -1},
    }));
    expect(read).toMatchObject({
      phase: "read",
      tick120: source.handoffTick120 + 159,
      combat: {
        startTick120: source.handoffTick120 + 159,
        tick120: source.handoffTick120 + 159,
        relativeTick120: 0,
        seed: RESOLVED_ROOM_SEED,
        patternId: "room.forced.left_right_gate",
        projectiles: [],
      },
      runCombat: {
        activeOccurrenceId: "room:0:encounter:0:room.forced.left_right_gate",
        override: {state: "idle", cycle: 0},
      },
      entities: {digitalBodies: 0, liveColliders: 0, residueVisuals: 0},
    });
    expect(session.events()).toHaveLength(source.sourceEvents.length);
  });

  it("creates the first real entities at READ local 88 and colliders at local 93", () => {
    const source = sourceFixture();
    const session = new CanonicalRunRoomSession(optionsFor(source));
    const readStart = source.handoffTick120 + 159;
    const beforeSpawn = stepTo(session, readStart + 87);
    expect(beforeSpawn.entities).toEqual({digitalBodies: 0, liveColliders: 0, residueVisuals: 0});
    const spawned = session.step(inputAt(readStart + 88));
    expect(spawned.entities).toMatchObject({digitalBodies: 4, liveColliders: 0});
    expect(spawned.combat?.projectiles.every((projectile) => projectile.state === "arm")).toBe(true);
    const firstRoomEvents = session.events().slice(source.sourceEvents.length);
    expect(firstRoomEvents.find((event) => event.id === "projectile.spawn.commit")).toMatchObject({
      id: "projectile.spawn.commit",
      tick120: readStart + 88,
    });
    const armed = stepTo(session, readStart + 93);
    expect(armed.entities.liveColliders).toBe(4);
    expect(session.events().filter((event) =>
      event.id === "projectile.armed" && event.tick120 === readStart + 93)).toHaveLength(4);
  });

  it("keeps the actual First Eye trace and run-owned body facts across occurrence ownership", () => {
    const source = realFirstEyeSource();
    const before = source.state.snapshot();
    expect(before.player.health).toBe(3);
    const session = new CanonicalRunRoomSession(optionsFor(source));
    const afterOne = session.step(inputAt(source.handoffTick120 + 1, {
      movement: {x: 1, y: 0},
      focused: true,
    }));
    expect(afterOne.runCombat.player.health).toBe(before.player.health);
    expect(afterOne.runCombat.evidence).toEqual(before.evidence);
    expect(afterOne.runCombat.override).toMatchObject({
      state: before.override.state,
      cycle: before.override.cycle,
      deadlineTick120: before.override.deadlineTick120,
      localVoid: before.override.localVoid,
      scarCount: before.override.scarCount,
    });
    expect(afterOne.runCombat.playerPosition.x).toBeGreaterThan(before.playerPosition.x);

    const read = stepTo(session, source.handoffTick120 + 159);
    expect(read.runCombat).toMatchObject({
      player: {health: before.player.health},
      evidence: before.evidence,
      override: {
        state: before.override.state,
        cycle: before.override.cycle,
        deadlineTick120: before.override.deadlineTick120,
        localVoid: before.override.localVoid,
        scarCount: before.override.scarCount,
      },
      claimedOccurrenceIds: [
        "room:0:encounter:0:room.forced.left_right_gate",
        "run:first-eye",
      ],
    });
    expect(session.events().slice(0, source.sourceEvents.length)).toEqual(source.sourceEvents);
    expect(serializeCanonicalEvents(session.events().slice(0, source.sourceEvents.length)))
      .toBe(source.sourceSerialization);
  });
});

describe("run room terminal tail and honest completion", () => {
  it("drains at H+1699, closes two neutral ticks, then remains an idle non-handoff owner", () => {
    const source = sourceFixture();
    const session = new CanonicalRunRoomSession(optionsFor(source));
    const H = source.handoffTick120;
    let activeArmOrFlightPeak = 0;
    let allAuthorityEntitiesPeak = 0;
    const observeBudget = (snapshot: CanonicalRunRoomSessionSnapshot): void => {
      activeArmOrFlightPeak = Math.max(activeArmOrFlightPeak, snapshot.entities.digitalBodies);
      allAuthorityEntitiesPeak = Math.max(
        allAuthorityEntitiesPeak,
        snapshot.entities.digitalBodies + snapshot.entities.residueVisuals,
      );
    };
    const stepTrackedTo = (targetTick120: number): CanonicalRunRoomSessionSnapshot => {
      let snapshot = session.snapshot();
      while (snapshot.tick120 < targetTick120) {
        snapshot = session.step(inputAt(snapshot.tick120 + 1));
        observeBudget(snapshot);
      }
      return snapshot;
    };

    const material = stepTrackedTo(H + 1383);
    expect(material).toMatchObject({
      phase: "material_settle",
      combat: {patternComplete: true, digitalBodiesDrained: true},
    });
    const rest = stepTrackedTo(H + 1509);
    expect(rest.phase).toBe("rest");
    const beforeDrain = stepTrackedTo(H + 1698);
    expect(beforeDrain.combat?.projectileLifecycleDrained).toBe(false);
    expect(beforeDrain.entities.residueVisuals).toBeGreaterThan(0);

    const drained = session.step(inputAt(H + 1699));
    observeBudget(drained);
    expect(drained).toMatchObject({
      phase: "rest",
      fixedSliceComplete: false,
      roomComplete: false,
      handoffReady: false,
      entities: {digitalBodies: 0, liveColliders: 0, residueVisuals: 0},
      combat: {
        relativeTick120: 1540,
        patternComplete: true,
        projectileLifecycleDrained: true,
        runTimedStateQuiescent: true,
        handoffReady: true,
        projectiles: [],
      },
      runCombat: {activeOccurrenceId: null},
    });
    expect({activeArmOrFlightPeak, allAuthorityEntitiesPeak}).toEqual({
      activeArmOrFlightPeak: RUN_ROOM_SESSION_CONTRACT.budgetEvidence.activeArmOrFlightPeak,
      allAuthorityEntitiesPeak: RUN_ROOM_SESSION_CONTRACT.budgetEvidence.allAuthorityEntitiesPeak,
    });
    const positionAtDrain = drained.runCombat.playerPosition;
    const roomEventCountAtDrain = session.events().length;

    const neutralOne = session.step(inputAt(H + 1700, {
      movement: {x: 1, y: 0},
      focused: true,
    }));
    const complete = session.step(inputAt(H + 1701, {
      movement: {x: 1, y: 0},
      focused: true,
    }));
    expect(neutralOne.runCombat.playerPosition).toEqual(positionAtDrain);
    expect(complete).toMatchObject({
      phase: "first_room_slice_complete",
      fixedSliceComplete: true,
      roomComplete: false,
      handoffReady: false,
      runCombat: {playerPosition: positionAtDrain},
      faulted: false,
    });
    expect(session.events()).toHaveLength(roomEventCountAtDrain);

    const later = session.step(inputAt(H + 1702, {
      movement: {x: 1, y: 0},
      focused: true,
      overridePressed: true,
      overrideDirection: {x: 0, y: -1},
    }));
    expect(later.phase).toBe("first_room_slice_complete");
    expect(later.runCombat.playerPosition.x).toBeGreaterThan(positionAtDrain.x);
    expect(later.runCombat.override).toMatchObject({state: "idle", cycle: 0});
    expect(later).toMatchObject({roomComplete: false, handoffReady: false});
  }, 15_000);
});
