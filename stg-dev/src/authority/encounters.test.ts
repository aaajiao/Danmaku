import {describe, expect, it} from "vitest";
import {CanonicalEventBus, type CanonicalEventBatchReceipt} from "./events";
import {
  BossPhaseAuthority,
  compileEncounterEnvelopeFixture,
  defaultEncounterManifestSource,
  EncounterEnvelopeObservationMachine,
  V4_ENCOUNTER_CATALOG,
  validateEncounterAuthorityManifests,
  type EncounterManifestSource,
  type EncounterObservation,
  type EncounterEnvelopeFixture,
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
      phases: Array<{
        patternId: string;
        entryCondition: string;
        laserGeometry?: string | null;
        spatialLaw?: string;
      }>;
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
  plan: EncounterEnvelopeFixture,
  cadence: readonly number[],
): readonly string[] {
  const machine = new EncounterEnvelopeObservationMachine(plan);
  const observations: string[] = [];
  for (const tick of cadence) {
    observations.push(...machine.advanceToTick(tick).map(observationKey));
  }
  expect(machine.complete()).toBe(true);
  expect(machine.observationsRemaining()).toBe(0);
  return Object.freeze(observations);
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

function occupyBossOccurrence(
  bus: CanonicalEventBus,
  occurrenceKey: string,
  tick120: number,
): void {
  bus.enqueue({
    id: "boss.encounter.resolve",
    tick120,
    entityStableId: "boss-conflict-fixture",
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
    expect(catalog.requireBoss("boss.misreader").phases.map((phase) => ({
      id: phase.id,
      laserGeometry: phase.laserGeometry,
      spatialLaw: phase.spatialLaw,
    }))).toEqual([
      {
        id: "observe",
        laserGeometry: null,
        spatialLaw: "sample_then_misread",
      },
      {
        id: "enforce",
        laserGeometry: "laser.misread_bezier",
        spatialLaw: "correction_is_late",
      },
      {
        id: "fail_to_totalize",
        laserGeometry: "laser.misread_bezier",
        spatialLaw: "three_read_predictions_disagree_with_following_movement",
      },
    ]);
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

    const missingLaserGeometry = mutableSource();
    const laserPhase = missingLaserGeometry.bosses.rigs[0]?.phases[0];
    expect(laserPhase).toBeDefined();
    if (laserPhase !== undefined) delete laserPhase.laserGeometry;
    expect(() => validateEncounterAuthorityManifests(missingLaserGeometry)).toThrow(/laserGeometry/);

    const missingSpatialLaw = mutableSource();
    const spatialPhase = missingSpatialLaw.bosses.rigs[0]?.phases[0];
    expect(spatialPhase).toBeDefined();
    if (spatialPhase !== undefined) spatialPhase.spatialLaw = "";
    expect(() => validateEncounterAuthorityManifests(missingSpatialLaw)).toThrow(/spatialLaw/);

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

  it("compiles the deterministic non-live room, wave, segment, and boss envelope fixture", () => {
    const plan = compileEncounterEnvelopeFixture({seed: 0x1020_3040, roomCount: 4, wavesPerRoom: 3});
    expect(plan.id).toBe("encounter-envelope-fixture-v4-10203040");
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

  it("pins the historical fixture's code-point ordering for its non-live parallel pool", () => {
    const source = mutableSource();
    const pool = source.encounter.parallelEncounterPools.weatherEcho;
    expect(pool).toBeDefined();
    pool?.patternIds.reverse();
    const reorderedCatalog = validateEncounterAuthorityManifests(source);
    const baseline = compileEncounterEnvelopeFixture({seed: 8831, roomCount: 4}, V4_ENCOUNTER_CATALOG);
    const reordered = compileEncounterEnvelopeFixture({seed: 8831, roomCount: 4}, reorderedCatalog);
    expect(reordered).toEqual(baseline);
  });

  it("keeps weather presentation outside gameplay selection and trace", () => {
    const clear = compileEncounterEnvelopeFixture({
      seed: 415,
      roomCount: 4,
      presentationWeather: {id: "STATIC", seed: 1},
    });
    const dense = compileEncounterEnvelopeFixture({
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

describe("non-live encounter envelope observations", () => {
  it("produces the same observations across render chunk cadences without writing canonical events", () => {
    const plan = compileEncounterEnvelopeFixture({seed: 0x1234_abcd, roomCount: 4});
    const single = runSchedule(plan, [plan.handoffTick120]);
    const chunked = runSchedule(plan, chunkTicks(plan.handoffTick120));
    expect(chunked).toEqual(single);
    expect(single.at(-1)).toContain("boss.handoff");
  });
});

describe("V4 boss phase authority", () => {
  it("stages one frozen phase-exit proposal for a later combined append", () => {
    const boss = V4_ENCOUNTER_CATALOG.requireBoss("boss.misreader");
    const bus = new CanonicalEventBus();
    const machine = new BossPhaseAuthority(boss.id, 30, bus);
    machine.begin(1);
    bus.flush();
    const before = machine.snapshot();
    const committedBefore = bus.events();
    const current = boss.phases[0];
    expect(current).toBeDefined();
    if (current === undefined) return;

    const proposal = machine.preparePhaseExit(current.id, 20, "declared-exit-condition");
    const view = machine.readPreparedPhaseExit(proposal, bus);
    expect(Object.isFrozen(proposal)).toBe(true);
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.drafts)).toBe(true);
    expect(view).toMatchObject({
      authority: "v4-boss-phase-exit-proposal",
      bossId: "boss.misreader",
      generation: 30,
      tick120: 20,
      fromPhaseId: "observe",
      toPhaseId: "enforce",
      attackPlanId: "boss.misreader.phase2",
      laserGeometry: "laser.misread_bezier",
      spatialLaw: "correction_is_late",
    });
    expect(view.drafts.map((draft) => draft.id)).toEqual([
      "boss.phase.exit",
      "boss.phase.swap",
      "boss.phase.enter",
      "boss.phase.attack_plan.commit",
    ]);
    for (const draft of view.drafts) {
      expect(Object.getPrototypeOf(draft)).toBe(Object.prototype);
      expect(Object.isFrozen(draft)).toBe(true);
      expect(Object.isFrozen(draft.payload)).toBe(true);
      expect(Object.keys(draft).sort()).toEqual([
        "entityStableId",
        "id",
        "localSequence",
        "occurrenceKey",
        "payload",
        "tick120",
      ]);
    }
    expect(machine.snapshot()).toEqual(before);
    expect(bus.events()).toEqual(committedBefore);

    const receipts = bus.enqueuePreparedBatch([view.drafts]);
    expect(machine.snapshot()).toEqual(before);
    expect(bus.events()).toEqual(committedBefore);
    machine.applyPreparedPhaseExit(
      proposal,
      bus,
      receipts[0] as CanonicalEventBatchReceipt,
    );
    expect(machine.snapshot()).toMatchObject({state: "active", phaseId: "enforce"});
    expect(bus.flush().map((event) => event.id)).toEqual([
      "boss.phase.exit",
      "boss.phase.swap",
      "boss.phase.enter",
      "boss.phase.attack_plan.commit",
    ]);
    expect(() => machine.readPreparedPhaseExit(proposal, bus)).toThrow(/already applied/);
    expect(() => machine.applyPreparedPhaseExit(
      proposal,
      bus,
      receipts[0] as CanonicalEventBatchReceipt,
    )).toThrow(/already applied/);
  });

  it("rejects stale, foreign, and wrong-bus phase-exit proposals", () => {
    const boss = V4_ENCOUNTER_CATALOG.requireBoss("boss.misreader");
    const bus = new CanonicalEventBus();
    const otherBus = new CanonicalEventBus();
    const machine = new BossPhaseAuthority(boss.id, 29, bus);
    const other = new BossPhaseAuthority(boss.id, 28, bus);
    machine.begin(1);
    other.begin(1);
    bus.flush();
    const current = boss.phases[0];
    expect(current).toBeDefined();
    if (current === undefined) return;
    const stale = machine.preparePhaseExit(current.id, 20, "first-proposal");

    expect(() => machine.readPreparedPhaseExit(stale, otherBus)).toThrow(/event bus does not match/);
    expect(() => other.readPreparedPhaseExit(stale, bus)).toThrow(/not owned/);
    machine.commitPhaseExit(current.id, 20, "accepted-proposal");
    bus.flush();
    expect(() => machine.readPreparedPhaseExit(stale, bus)).toThrow(/stale/);
    expect(() => machine.applyPreparedPhaseExit(
      stale,
      bus,
      Object.freeze({}) as CanonicalEventBatchReceipt,
    )).toThrow(/stale/);
    expect(machine.snapshot().phaseId).toBe("enforce");
  });

  it("requires an exact accepted draft-group receipt before applying prepared state", () => {
    const boss = V4_ENCOUNTER_CATALOG.requireBoss("boss.misreader");
    const bus = new CanonicalEventBus();
    const machine = new BossPhaseAuthority(boss.id, 27, bus);
    machine.begin(1);
    bus.flush();
    const current = boss.phases[0];
    expect(current).toBeDefined();
    if (current === undefined) return;
    const proposal = machine.preparePhaseExit(current.id, 20, "prepared-before-reentry");
    const before = machine.snapshot();
    expect(() => machine.applyPreparedPhaseExit(
      proposal,
      bus,
      Object.freeze({}) as CanonicalEventBatchReceipt,
    )).toThrow(/receipt is not recognized/);
    expect(machine.snapshot()).toEqual(before);
    expect(bus.flush()).toEqual([]);

    const view = machine.readPreparedPhaseExit(proposal, bus);
    const receipts = bus.enqueuePreparedBatch([view.drafts]);
    machine.applyPreparedPhaseExit(
      proposal,
      bus,
      receipts[0] as CanonicalEventBatchReceipt,
    );
    expect(machine.snapshot().phaseId).toBe("enforce");
    expect(bus.flush()).toHaveLength(4);
  });

  it("keeps begin state and pending facts atomic when a later occurrence conflicts", () => {
    const boss = V4_ENCOUNTER_CATALOG.requireBoss("boss.misreader");
    const generation = 31;
    const bus = new CanonicalEventBus();
    const machine = new BossPhaseAuthority(boss.id, generation, bus);
    const firstPhase = boss.phases[0];
    expect(firstPhase).toBeDefined();
    if (firstPhase === undefined) return;
    occupyBossOccurrence(
      bus,
      `boss-authority:${boss.id}:${generation}:attack-plan:${firstPhase.id}`,
      5,
    );
    const before = machine.snapshot();

    expect(() => machine.begin(5)).toThrow(/duplicate authoritative occurrence key/);
    expect(machine.snapshot()).toEqual(before);
    expect(bus.flush().map((event) => event.entityStableId)).toEqual(["boss-conflict-fixture"]);
  });

  it("keeps phase swap state and its four facts atomic under an occurrence conflict", () => {
    const boss = V4_ENCOUNTER_CATALOG.requireBoss("boss.misreader");
    const generation = 32;
    const bus = new CanonicalEventBus();
    const machine = new BossPhaseAuthority(boss.id, generation, bus);
    machine.begin(1);
    bus.flush();
    const current = boss.phases[0];
    const next = boss.phases[1];
    expect(current).toBeDefined();
    expect(next).toBeDefined();
    if (current === undefined || next === undefined) return;
    occupyBossOccurrence(
      bus,
      `boss-authority:${boss.id}:${generation}:attack-plan:${next.id}`,
      20,
    );
    const before = machine.snapshot();

    expect(() => machine.commitPhaseExit(current.id, 20, "declared-exit-condition")).toThrow(
      /duplicate authoritative occurrence key/,
    );
    expect(machine.snapshot()).toEqual(before);
    expect(bus.flush().map((event) => event.entityStableId)).toEqual(["boss-conflict-fixture"]);
  });

  it("keeps final resolution and collision state atomic under an occurrence conflict", () => {
    const boss = V4_ENCOUNTER_CATALOG.requireBoss("boss.misreader");
    const generation = 33;
    const bus = new CanonicalEventBus();
    const machine = new BossPhaseAuthority(boss.id, generation, bus);
    const first = boss.phases[0];
    const second = boss.phases[1];
    const final = boss.phases[2];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(final).toBeDefined();
    if (first === undefined || second === undefined || final === undefined) return;
    machine.begin(1);
    bus.flush();
    machine.commitPhaseExit(first.id, 2, "declared-exit-condition");
    bus.flush();
    machine.commitPhaseExit(second.id, 3, "declared-exit-condition");
    bus.flush();
    occupyBossOccurrence(
      bus,
      `boss-authority:${boss.id}:${generation}:encounter-resolve`,
      4,
    );
    const before = machine.snapshot();
    expect(before).toMatchObject({state: "active", phaseId: final.id, collisionEnabled: true});

    expect(() => machine.resolveFinal(final.id, 4, "authored-condition")).toThrow(
      /duplicate authoritative occurrence key/,
    );
    expect(machine.snapshot()).toEqual(before);
    expect(bus.flush().map((event) => event.entityStableId)).toEqual(["boss-conflict-fixture"]);
  });

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

  it("does not expose an unevidenced standalone structural-rupture mutation", () => {
    const boss = V4_ENCOUNTER_CATALOG.bosses[3];
    expect(boss).toBeDefined();
    if (boss === undefined) return;
    const bus = new CanonicalEventBus();
    const machine = new BossPhaseAuthority(boss.id, 4, bus);
    expect(() => machine.begin(-0)).toThrow(/non-negative safe integer/);
    machine.begin(5);
    const snapshot = machine.snapshot();
    expect(snapshot.state).toBe("active");
    expect(snapshot.collisionEnabled).toBe(true);
    expect(snapshot.structuralRupture).toBeNull();
    expect(snapshot.resolution).toBeNull();
    expect((machine as unknown as Record<string, unknown>).recordStructuralRupture).toBeUndefined();
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
