import {describe, expect, it} from "vitest";
import {CanonicalEventBus} from "./events";
import {
  BossPhaseAuthority,
  compileEncounterCombatPlan,
  defaultEncounterManifestSource,
  EncounterScheduleMachine,
  RoomTransitionAuthority,
  V4_ENCOUNTER_CATALOG,
  validateEncounterAuthorityManifests,
  type EncounterManifestSource,
  type EncounterObservation,
  type EncounterCombatPlan,
} from "./encounters";

interface MutablePatternRef {
  patternId: string;
}

interface MutableSource {
  encounter: {
    parallelEncounterPools: Record<string, {patternIds: string[]}>;
  };
  bosses: {
    rigs: Array<{
      room: string;
      phases: Array<{patternId: string; entryCondition: string}>;
    }>;
  };
  rooms: {
    composers: Array<{
      room: string;
      patternPool: MutablePatternRef[];
    }>;
  };
  run: {
    roomSampling: {rooms: string[]};
  };
  events: {
    events: Array<{id: string}>;
  };
}

function mutableSource(): MutableSource & EncounterManifestSource {
  return structuredClone(defaultEncounterManifestSource()) as MutableSource & EncounterManifestSource;
}

function observationKey(value: EncounterObservation): string {
  return [
    value.tick120,
    value.kind,
    value.room,
    value.waveId ?? "-",
    value.segmentId ?? "-",
    value.patternId ?? "-",
    value.bossId ?? "-",
  ].join("|");
}

function runSchedule(
  plan: EncounterCombatPlan,
  cadence: readonly number[],
): Readonly<{observations: readonly string[]; canonical: string}> {
  const bus = new CanonicalEventBus();
  const machine = new EncounterScheduleMachine(plan, bus);
  const observations: string[] = [];
  for (const tick of cadence) {
    observations.push(...machine.advanceToTick(tick).map(observationKey));
    bus.flush();
  }
  expect(machine.complete()).toBe(true);
  expect(machine.observationsRemaining()).toBe(0);
  return Object.freeze({
    observations: Object.freeze(observations),
    canonical: bus.canonicalSerialization(),
  });
}

function chunkTicks(finalTick: number): readonly number[] {
  const ticks: number[] = [];
  let tick = 0;
  let strideIndex = 0;
  const strides = [1, 17, 113, 7, 61] as const;
  while (tick < finalTick) {
    tick = Math.min(finalTick, tick + (strides[strideIndex % strides.length] ?? 1));
    ticks.push(tick);
    strideIndex += 1;
  }
  return Object.freeze(ticks);
}

describe("V4 encounter content authority", () => {
  it("derives every authored room and all three phases of every boss", () => {
    const catalog = V4_ENCOUNTER_CATALOG;
    expect(catalog.schemaVersion).toBe("4.0.0");
    expect(catalog.rooms.map((room) => room.room).sort()).toEqual(catalog.runRoomOrder.slice().sort());
    expect(catalog.rooms).toHaveLength(4);
    expect(catalog.bosses).toHaveLength(8);
    expect(catalog.bosses.flatMap((boss) => boss.phases)).toHaveLength(24);
    expect(catalog.bosses.every((boss) => boss.phases.length === 3)).toBe(true);
    expect(catalog.bosses.every((boss) => boss.collisionOffBeforeVisual)).toBe(true);
    expect(catalog.weatherIsPresentationOnly).toBe(true);
    expect(catalog.failurePolicy).toEqual({
      minimumUntelegraphedSpawnDistancePx: 96,
      noForcedHitAtMaximumSpeed: true,
      collisionNeverFromAlpha: true,
    });

    for (const room of catalog.rooms) {
      expect(catalog.bossesForRoom(room.room)).toHaveLength(2);
      for (const pattern of room.patterns) {
        expect(catalog.requirePatternDuration(pattern.patternId)).toBeGreaterThan(0);
      }
    }
  });

  it("fails fast when room, pattern, phase-chain, or parallel references drift", () => {
    const unknownRoom = mutableSource();
    unknownRoom.run.roomSampling.rooms[0] = "UNAUTHORED_ROOM";
    expect(() => validateEncounterAuthorityManifests(unknownRoom)).toThrow(
      /run room references and room composer authorities must match exactly/,
    );

    const unknownPattern = mutableSource();
    const roomPattern = unknownPattern.rooms.composers[0]?.patternPool[0];
    expect(roomPattern).toBeDefined();
    if (roomPattern !== undefined) roomPattern.patternId = "room.unknown.absence";
    expect(() => validateEncounterAuthorityManifests(unknownPattern)).toThrow(
      /room composer references unknown pattern/,
    );

    const brokenPhase = mutableSource();
    const secondPhase = brokenPhase.bosses.rigs[0]?.phases[1];
    expect(secondPhase).toBeDefined();
    if (secondPhase !== undefined) secondPhase.entryCondition = "unrelated.exit";
    expect(() => validateEncounterAuthorityManifests(brokenPhase)).toThrow(/phase entry chain is invalid/);

    const unknownParallel = mutableSource();
    const pool = unknownParallel.encounter.parallelEncounterPools.weatherEcho;
    expect(pool).toBeDefined();
    pool?.patternIds.push("encounter.unknown.parallel");
    expect(() => validateEncounterAuthorityManifests(unknownParallel)).toThrow(
      /parallel encounter pool references unknown pattern/,
    );

    const divergedEvents = mutableSource();
    divergedEvents.events.events.pop();
    expect(() => validateEncounterAuthorityManifests(divergedEvents)).toThrow(
      /diverges from the canonical bus registry/,
    );
  });

  it("compiles authored room, wave, segment, and boss phase order", () => {
    const plan = compileEncounterCombatPlan({seed: 0x1020_3040, roomCount: 4, wavesPerRoom: 3});
    expect(new Set(plan.rooms.map((room) => room.room))).toEqual(new Set(V4_ENCOUNTER_CATALOG.runRoomOrder));
    expect(plan.rooms).toHaveLength(4);

    let priorRoomEnd = 0;
    for (const room of plan.rooms) {
      expect(room.startTick120).toBe(priorRoomEnd);
      expect(room.waves).toHaveLength(3);
      let priorWaveEnd = room.startTick120;
      for (const wave of room.waves) {
        expect(wave.startTick120).toBe(priorWaveEnd);
        expect(wave.segments.map((segment) => segment.id.split(":").at(-1))).toEqual(
          V4_ENCOUNTER_CATALOG.segments.map((segment) => segment.id),
        );
        expect(wave.segments[0]?.collision).toBe(false);
        expect(wave.segments.at(-1)?.required).toBe(true);
        expect(wave.segments.at(-1)?.newSpawns).toBe(false);
        for (let index = 1; index < wave.segments.length; index += 1) {
          expect(wave.segments[index]?.startTick120).toBe(wave.segments[index - 1]?.endTick120);
        }
        expect(wave.endTick120).toBe(wave.segments.at(-1)?.endTick120);
        expect(V4_ENCOUNTER_CATALOG.parallelPools[0]?.patternIds).toContain(wave.parallelPatternId);
        priorWaveEnd = wave.endTick120;
      }
      expect(room.endTick120).toBe(priorWaveEnd);
      priorRoomEnd = room.endTick120;
    }
    expect(plan.handoffTick120).toBe(priorRoomEnd);
    expect(plan.boss.startTick120).toBe(plan.handoffTick120);
    const boss = V4_ENCOUNTER_CATALOG.requireBoss(plan.boss.bossId);
    expect(plan.boss.phases.map((phase) => phase.phaseId)).toEqual(boss.phases.map((phase) => phase.id));
    expect(plan.boss.endTick120).toBeGreaterThan(plan.boss.startTick120);
  });

  it("uses stable code-point ordering for the parallel pool", () => {
    const source = mutableSource();
    const pool = source.encounter.parallelEncounterPools.weatherEcho;
    expect(pool).toBeDefined();
    pool?.patternIds.reverse();
    const reorderedCatalog = validateEncounterAuthorityManifests(source);
    const baseline = compileEncounterCombatPlan({seed: 8831, roomCount: 4}, V4_ENCOUNTER_CATALOG);
    const reordered = compileEncounterCombatPlan({seed: 8831, roomCount: 4}, reorderedCatalog);
    expect(reordered).toEqual(baseline);
  });

  it("keeps weather presentation outside gameplay selection and trace", () => {
    const clear = compileEncounterCombatPlan({
      seed: 415,
      roomCount: 4,
      presentationWeather: {id: "STATIC", seed: 1},
    });
    const dense = compileEncounterCombatPlan({
      seed: 415,
      roomCount: 4,
      presentationWeather: {id: "ECLIPSE", seed: 0xffff_ffff},
    });
    expect(dense).toEqual(clear);

    const clearTrace = runSchedule(clear, [clear.handoffTick120]);
    const denseTrace = runSchedule(dense, chunkTicks(dense.handoffTick120));
    expect(denseTrace).toEqual(clearTrace);
  });
});

describe("room and encounter scheduling authority", () => {
  it("produces the same observations and canonical trace across render chunk cadences", () => {
    const plan = compileEncounterCombatPlan({seed: 0x1234_abcd, roomCount: 4});
    const single = runSchedule(plan, [plan.handoffTick120]);
    const chunked = runSchedule(plan, chunkTicks(plan.handoffTick120));
    expect(chunked).toEqual(single);
    expect(single.observations.at(-1)).toContain("boss.handoff");
  });

  it("locks a room transition until the exact threshold tick commits", () => {
    const bus = new CanonicalEventBus();
    const transitions = new RoomTransitionAuthority(bus, "threshold-test");
    expect(transitions.begin("INFORMATION", "IN_BETWEEN", 10)).toBe(1);
    expect(transitions.isLocked()).toBe(true);
    expect(() => transitions.begin("INFORMATION", "POLARIZED", 11)).toThrow(/locked/);
    transitions.commitThreshold(37);
    expect(transitions.isLocked()).toBe(false);
    expect(() => transitions.commitThreshold(38)).toThrow(/no locked threshold/);
    const events = bus.flush();
    expect(events.map((event) => event.id)).toEqual([
      "room.transition.begin",
      "room.transition.world_swap.commit",
      "room.transition.room_ready",
      "room.transition.complete",
    ]);
    expect(events.map((event) => event.tick120)).toEqual([10, 37, 37, 37]);
  });

  it("assigns unique stable local order when threshold commit shares a tick", () => {
    const bus = new CanonicalEventBus();
    const transitions = new RoomTransitionAuthority(bus, "same-tick-test");
    transitions.begin("FORCED_ALIGNMENT", "POLARIZED", 52);
    transitions.commitThreshold(52);
    const events = bus.flush();
    expect(events.map((event) => event.id)).toEqual([
      "room.transition.begin",
      "room.transition.world_swap.commit",
      "room.transition.room_ready",
      "room.transition.complete",
    ]);
    expect(events.map((event) => event.localSequence)).toEqual([0, 1, 2, 3]);
    expect(new Set(events.map((event) => event.occurrenceKey))).toHaveLength(4);
  });
});

describe("V4 boss phase authority", () => {
  it("executes all authored bosses through three ordered phases with schema-complete events", () => {
    for (const [bossOrdinal, boss] of V4_ENCOUNTER_CATALOG.bosses.entries()) {
      const bus = new CanonicalEventBus();
      const machine = new BossPhaseAuthority(boss.id, bossOrdinal + 1, bus);
      machine.begin(1);
      machine.commitPhaseExit(boss.phases[0]?.id ?? "missing", 101, "declared-exit-condition");
      machine.commitPhaseExit(boss.phases[1]?.id ?? "missing", 202, "declared-exit-condition");
      machine.resolveFinal(boss.phases[2]?.id ?? "missing", 303, "authored-condition");
      const events = bus.flush();

      expect(events).toHaveLength(13);
      expect(events.filter((event) => event.id === "boss.phase.enter").map((event) =>
        event.payload.phaseId)).toEqual(boss.phases.map((phase) => phase.id));
      expect(events.filter((event) => event.id === "boss.phase.attack_plan.commit").map((event) =>
        event.payload.attackPlanId)).toEqual(boss.phases.map((phase) => phase.patternId));
      expect(events.at(-1)?.id).toBe("boss.encounter.resolve");
      expect(events.at(-1)?.payload.outcome).toBe(boss.resolutionId);
      expect(events.at(-1)?.payload.finalPhaseId).toBe(boss.phases[2]?.id);
      const snapshot = machine.snapshot();
      expect(snapshot.state).toBe("resolved");
      expect(snapshot.collisionEnabled).toBe(false);
      expect(snapshot.resolution?.materialRemainder).toBe(boss.materialRemainder);
      expect(Object.isFrozen(snapshot)).toBe(true);
    }
  });

  it("rejects skipped, repeated, and same-tick phase changes", () => {
    const boss = V4_ENCOUNTER_CATALOG.bosses[0];
    expect(boss).toBeDefined();
    if (boss === undefined) return;
    const bus = new CanonicalEventBus();
    const machine = new BossPhaseAuthority(boss.id, 1, bus);
    machine.begin(20);
    expect(() => machine.commitPhaseExit(boss.phases[1]?.id ?? "missing", 30, "fact")).toThrow(
      /expected/,
    );
    expect(() => machine.commitPhaseExit(boss.phases[0]?.id ?? "missing", 20, "fact")).toThrow(
      /later exact tick/,
    );
    machine.commitPhaseExit(boss.phases[0]?.id ?? "missing", 73, "fact");
    expect(() => machine.commitPhaseExit(boss.phases[0]?.id ?? "missing", 74, "fact")).toThrow(
      /expected/,
    );
    expect(() => machine.resolveFinal(boss.phases[1]?.id ?? "missing", 90, "authored-condition")).toThrow(
      /before its final phase/,
    );
    const breakEvents = bus.flush().filter((event) => event.tick120 === 73);
    expect(breakEvents.map((event) => event.id)).toEqual([
      "boss.phase.exit",
      "boss.phase.swap",
      "boss.phase.enter",
      "boss.phase.attack_plan.commit",
    ]);
  });

  it("records structural rupture as material fact without fabricating resolution", () => {
    const boss = V4_ENCOUNTER_CATALOG.bosses[3];
    expect(boss).toBeDefined();
    if (boss === undefined) return;
    const bus = new CanonicalEventBus();
    const machine = new BossPhaseAuthority(boss.id, 4, bus);
    machine.begin(5);
    machine.recordStructuralRupture(44);
    const snapshot = machine.snapshot();
    expect(snapshot.state).toBe("active");
    expect(snapshot.collisionEnabled).toBe(false);
    expect(snapshot.structuralRupture).toEqual({
      tick120: 44,
      materialRemainder: boss.materialRemainder,
      residueType: boss.residueType,
    });
    expect(snapshot.resolution).toBeNull();
    expect(() => machine.recordStructuralRupture(45)).toThrow(/only once/);
    expect(bus.flush().some((event) => event.id === "boss.encounter.resolve")).toBe(false);
  });

  it("keeps exact canonical ordering independent of chunked external checks", () => {
    const boss = V4_ENCOUNTER_CATALOG.bosses[6];
    expect(boss).toBeDefined();
    if (boss === undefined) return;

    const trace = (cadence: readonly number[]): string => {
      const bus = new CanonicalEventBus();
      const machine = new BossPhaseAuthority(boss.id, 9, bus);
      const actions = [
        {tick: 11, run: () => machine.begin(11)},
        {
          tick: 127,
          run: () => machine.commitPhaseExit(
            boss.phases[0]?.id ?? "missing",
            127,
            "declared-exit-condition",
          ),
        },
        {
          tick: 251,
          run: () => machine.commitPhaseExit(
            boss.phases[1]?.id ?? "missing",
            251,
            "declared-exit-condition",
          ),
        },
        {
          tick: 389,
          run: () => machine.resolveFinal(
            boss.phases[2]?.id ?? "missing",
            389,
            "authoritative-duration",
          ),
        },
      ] as const;
      let cursor = 0;
      for (const renderTick of cadence) {
        while (actions[cursor] !== undefined && (actions[cursor]?.tick ?? Number.POSITIVE_INFINITY) <= renderTick) {
          actions[cursor]?.run();
          cursor += 1;
        }
        bus.flush();
      }
      expect(cursor).toBe(actions.length);
      return bus.canonicalSerialization();
    };

    expect(trace([389])).toBe(trace([11, 29, 127, 180, 251, 388, 389]));
  });
});
