import {describe, expect, it} from "vitest";
import {
  CanonicalEventBus,
  V4_ENVELOPE_REQUIRED_FIELDS,
  type CanonicalGameplayEvent,
  type GameplayEventDraft,
  type JsonObject,
} from "./events";
import {assertRunMemory, RunMemoryRecorder, validateRunMemory, type RunMemory} from "../game/run-memory";
import {
  AUTHORED_BOSS_RESOLUTIONS,
  AUTHORED_ROOM_THRESHOLDS,
  AUTHORED_SNAPSHOT_OBSERVATIONS,
  AUTHORED_WORLD_REACTION_EDGES,
  NARRATIVE_AUTHORITY_REPORT,
  NARRATIVE_ROOM_IDS,
  NARRATIVE_STATE_IDS,
  NarrativeAuthority,
  evaluateObservationCondition,
  selectSnapshotObservations,
  validateNarrativeRecord,
  type AuthoredObservationDefinition,
  type NarrativeAuthorityOptions,
  type NarrativeRoomId,
} from "./narrative";

function makeMemory(): RunMemory {
  const recorder = new RunMemoryRecorder({runId: "run-narrative-v4", seed: 413, startedAtTick: 0});
  recorder.recordBehaviorFact({
    segmentId: "room-information",
    room: "INFORMATION",
    atTick: 1,
    eventId: "room-enter",
    kind: "ROOM_ENTER",
  });
  recorder.recordBehaviorFact({
    segmentId: "room-information",
    room: "INFORMATION",
    atTick: 2,
    eventId: "room-dwell",
    kind: "ROOM_DWELL",
    amount: 2400,
  });
  recorder.recordBehaviorFact({
    segmentId: "room-information",
    room: "INFORMATION",
    atTick: 3,
    eventId: "light-sample",
    kind: "LIGHT_SAMPLE",
    amount: 0.44,
  });
  recorder.recordGhostPoint({
    tMs: 0,
    xNorm: 0.2,
    yNorm: 0.8,
    room: "INFORMATION",
    flower: 0.3,
    focus: false,
    flags: ["ROOM_ENTER"],
  });
  recorder.recordGhostPoint({
    tMs: 240,
    xNorm: 0.7,
    yNorm: 0.4,
    room: "INFORMATION",
    flower: 0.6,
    focus: true,
    flags: ["OVERRIDE"],
  });
  recorder.addOverrideScar({
    id: "scar-v4",
    position: {room: "INFORMATION", xNorm: 0.7, yNorm: 0.4},
    direction8: "NW",
    localVoidRadiusPx: 28,
    createdAtTick: 3,
    persistenceRuns: 2,
  });
  recorder.addDeathTrace({
    id: "trace-v4",
    position: {room: "INFORMATION", xNorm: 0.4, yNorm: 0.6},
    damageVector: [0, -1],
    createdAtTick: 4,
    causeArchetype: "needle",
  });
  recorder.addBurnIn({
    id: "burn-v4",
    room: "INFORMATION",
    captureDigest: "1".repeat(64),
    gazeStillMs: 2100,
    decayTicks: 80,
  });
  const memory = recorder.finalize({
    endedAtTick: 720,
    durationMs: 6000,
    roomsVisited: ["INFORMATION"],
    resolution: {
      reason: "NO_DUSK_WITHDRAWAL",
      bossId: "no_dusk",
      factEventId: "boss.noDusk.protocolRetracted",
    },
  });
  if (memory.ghostRoute === null) throw new Error("test memory must have an actual route");
  memory.materialMemory.ghostResidues.push({
    id: "ghost-residue-v4",
    position: {room: "INFORMATION", xNorm: 0.7, yNorm: 0.4},
    sourceRouteDigest: memory.ghostRoute.routeDigest,
    createdAfterReplay: true,
    persistenceRuns: 1,
  });
  expect(validateRunMemory(memory)).toEqual({ok: true, errors: []});
  return memory;
}

function event(
  id: string,
  payload: JsonObject,
  tick120: number,
  occurrenceKey = `${id}:${tick120}`,
): CanonicalGameplayEvent {
  const bus = new CanonicalEventBus();
  const draft: GameplayEventDraft = {
    id,
    tick120,
    entityStableId: "narrative-test",
    localSequence: 0,
    occurrenceKey,
    payload,
  };
  bus.enqueue(draft);
  const committed = bus.flush();
  const result = committed[0];
  if (result === undefined) throw new Error("event factory did not commit");
  return result;
}

function routeFacts(memory: RunMemory): {
  readonly routeDigest: string;
  readonly routeDurationMs: number;
} {
  if (memory.ghostRoute === null) throw new Error("test memory must have a route");
  return {
    routeDigest: memory.ghostRoute.routeDigest,
    routeDurationMs: memory.ghostRoute.points.at(-1)?.tMs ?? 0,
  };
}

function snapshotPayload(memory: RunMemory): JsonObject {
  return {
    runId: memory.run.id,
    snapshotHash: memory.fingerprint.digestSha256,
    deterministicSeed: memory.run.seed,
    ...routeFacts(memory),
    materialCounts: {
      overrideScars: memory.materialMemory.overrideScars.length,
      deathTraces: memory.materialMemory.deathTraces.length,
      burnIns: memory.materialMemory.burnIns.length,
      ghostResidues: memory.materialMemory.ghostResidues.length,
    },
  };
}

function restoreEvents(memory: RunMemory, startTick = 1): readonly CanonicalGameplayEvent[] {
  if (memory.ghostRoute === null) throw new Error("test memory must have a route");
  const identity = {fromRunId: memory.run.id, nextRunId: "run-narrative-v4-next"};
  const route = routeFacts(memory);
  const finalPoint = memory.ghostRoute.points.at(-1) as unknown as JsonObject;
  return Object.freeze([
    event("cross_run.restore.begin", {...identity, ...route}, startTick),
    event("overrideScar.rehydrate", {
      ...identity,
      recordType: "overrideScar",
      count: memory.materialMemory.overrideScars.length,
      records: ["payload-is-not-authority"],
    }, startTick + 1),
    event("deathTrace.rehydrate", {
      ...identity,
      recordType: "deathTrace",
      count: memory.materialMemory.deathTraces.length,
      records: [],
    }, startTick + 2),
    event("burnIn.rehydrate", {
      ...identity,
      recordType: "burnIn",
      count: memory.materialMemory.burnIns.length,
      records: [],
    }, startTick + 3),
    event("ghost.replay.begin", {
      ...identity,
      ...route,
      pointCount: memory.ghostRoute.points.length,
      routePoints: ["payload-is-not-authority"],
      timeScale: 1,
      collisionClass: "NONE",
      rewardClass: "NONE",
      emitterClass: "PRESENTATION_ONLY",
    }, startTick + 4),
    event("ghost.replay.complete", {
      ...identity,
      ...route,
      finalPoint,
      burnAfterRead: true,
    }, startTick + 5),
    event("ghost.residue.write", {
      ...identity,
      recordType: "ghostResidue",
      residueId: "new-residue",
      sourceRouteDigest: memory.ghostRoute.routeDigest,
      createdAfterReplay: true,
      persistenceRuns: 1,
      position: {room: "INFORMATION", xNorm: 0.7, yNorm: 0.4},
      priorGhostResidueCount: memory.materialMemory.ghostResidues.length,
    }, startTick + 6),
    event("witness.turn", {
      ...identity,
      evaluatedAfterGhostResidue: true,
      overrideScarIds: memory.materialMemory.overrideScars.map((scar) => scar.id),
      ghostEndpoint: finalPoint,
      priority: "AUTHORED",
    }, startTick + 7),
    event("returnInput", {
      ...identity,
      inputState: "READY",
      routeDurationMs: route.routeDurationMs,
    }, startTick + 8),
    event("cross_run.restore.complete", {...identity, ...route}, startTick + 9),
  ]);
}

function stateSequence(memory: RunMemory): readonly CanonicalGameplayEvent[] {
  const start = [...restoreEvents(memory)];
  let tick = 20;
  const next = (id: string, payload: JsonObject): CanonicalGameplayEvent => event(id, payload, tick++);
  return Object.freeze([
    ...start,
    next("gaze.acquire.begin", {cycle: 1, clampAtMs: 900}),
    next("gaze.clamp.commit", {cycle: 1, forcedIntensity: 0.22}),
    next("gaze.clamp.release", {cycle: 1, releaseAttempt: 1}),
    next("room.transition.world_swap.commit", {
      generation: 1,
      fromRoom: "INFORMATION",
      toRoom: "FORCED_ALIGNMENT",
    }),
    next("room.transition.world_swap.commit", {
      generation: 2,
      fromRoom: "FORCED_ALIGNMENT",
      toRoom: "IN_BETWEEN",
    }),
    next("player.override.ready", {cycle: 1}),
    next("player.override.local_void.open", {
      cycle: 2,
      originX: 120,
      originY: 320,
      directionX: 1,
      directionY: 0,
      radius: 28,
      halfAngleDegrees: 24,
    }),
    next("player.override.local_void.close", {cycle: 2}),
    next("room.transition.world_swap.commit", {
      generation: 3,
      fromRoom: "IN_BETWEEN",
      toRoom: "POLARIZED",
    }),
    next("player.override.ready", {cycle: 2}),
    next("run.end.commit", {reason: "NO_DUSK_WITHDRAWAL"}),
    next("boss.encounter.resolve", {
      bossId: "no_dusk",
      generation: 1,
      outcome: "NO_DUSK_WITHDRAWAL",
      finalPhaseId: "binary-clock",
    }),
    next("snapshot.begin", {runId: memory.run.id}),
    next("snapshot.serialize.commit", snapshotPayload(memory)),
    next("snapshot.present.begin", {
      runId: memory.run.id,
      snapshotHash: memory.fingerprint.digestSha256,
    }),
    next("cross_run.record.persist.commit", snapshotPayload(memory)),
    next("snapshot.complete", {runId: memory.run.id}),
  ]);
}

function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current = root;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      throw new Error(`cannot set test path ${path}`);
    }
    current = next as Record<string, unknown>;
  }
  current[parts.at(-1) as string] = value;
}

function getPath(root: Record<string, unknown>, path: string): unknown {
  let current: unknown = root;
  for (const part of path.split(".")) {
    if (Array.isArray(current) && part === "length") return current.length;
    if (typeof current !== "object" || current === null || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function ensureGhostPointCount(memory: RunMemory, count: number): void {
  if (memory.ghostRoute === null) throw new Error("test memory must have a route");
  const seedPoint = memory.ghostRoute.points[0];
  if (seedPoint === undefined) throw new Error("test route must have a point");
  memory.ghostRoute.points = Array.from({length: count}, (_, index) => ({
    ...structuredClone(seedPoint),
    tMs: index * 120,
    xNorm: (index % 10) / 10,
    flags: index === 0 ? ["ROOM_ENTER"] : [],
  }));
}

function satisfyObservation(definition: AuthoredObservationDefinition): RunMemory {
  const memory = structuredClone(makeMemory());
  const branch = definition.condition.split(/\s*\|\|\s*/u)[0] ?? "";
  const comparisons = branch.split(/\s*&&\s*/u).map((raw) => {
    const match = /^(.+?)\s*(==|!=|<=|>=|<|>)\s*(.+)$/u.exec(raw.trim());
    if (match === null) throw new Error(`unsupported authored test condition: ${raw}`);
    return {left: match[1]?.trim() ?? "", operator: match[2] ?? "", right: match[3]?.trim() ?? ""};
  });
  const root = memory as unknown as Record<string, unknown>;
  for (const comparison of comparisons.filter(({right}) => !/^[A-Za-z]/u.test(right) || right.startsWith("'"))) {
    const stringLiteral = /^'([^']*)'$/u.exec(comparison.right);
    const literal: unknown = stringLiteral !== null
      ? stringLiteral[1]
      : comparison.right === "true"
        ? true
        : comparison.right === "false"
          ? false
          : comparison.right === "null"
            ? null
            : Number(comparison.right);
    if (comparison.left === "ghostRoute.points.length") {
      ensureGhostPointCount(memory, Number(literal));
      continue;
    }
    if (comparison.left.endsWith(".length")) continue;
    let target = literal;
    if (typeof literal === "number") {
      const ratioPaths = new Set([
        "metrics.meanLight",
        "metrics.quietLightRatio",
        "metrics.middleLightRatio",
        "metrics.loudLightRatio",
        "metrics.gazeRatio",
        "metrics.focusDwellRatio",
        "metrics.seamDwellRatio",
        "metrics.routeWidth",
      ]);
      if (comparison.operator === ">") {
        target = ratioPaths.has(comparison.left)
          ? Math.min(1, literal + Math.max(0.01, (1 - literal) / 2))
          : Math.floor(literal) + 1;
      } else if (comparison.operator === "<") {
        target = literal > 0 ? literal / 2 : literal - 1;
      }
    }
    setPath(root, comparison.left, target);
  }
  for (const comparison of comparisons.filter(({right}) => /^[A-Za-z]/u.test(right) && !right.startsWith("'"))) {
    const rightValue = getPath(root, comparison.right);
    if (comparison.operator !== "==") throw new Error("test solver only expects authored path equality");
    setPath(root, comparison.left, rightValue);
  }
  expect(validateRunMemory(memory).ok, definition.id).toBe(true);
  return memory;
}

describe("V4 narrative/world-reaction authority", () => {
  it("compiles every directly loaded V4 narrative catalog and reports unresolved manifest joins", () => {
    expect(NARRATIVE_AUTHORITY_REPORT).toMatchObject({
      narrativeStates: 16,
      roomThresholds: 16,
      bossResolutions: 8,
      snapshotObservations: 64,
      weatherTypes: 5,
      worldReactionEdges: 26,
      witnessStates: 7,
      canonicalEvents: 72,
      runtimeMachines: 12,
      compiledObservationConditions: 64,
    });
    expect(NARRATIVE_AUTHORITY_REPORT.manifestGaps).toEqual(expect.arrayContaining([
      expect.stringContaining("GLITCH"),
      expect.stringContaining("player.graze"),
      expect.stringContaining("Override.promptDiegetic"),
    ]));
    expect(V4_ENVELOPE_REQUIRED_FIELDS).toEqual([
      "id",
      "authority",
      "simulationTimeMs",
      "sequence",
      "occurrenceKey",
      "payload",
    ]);
  });

  it("catalogs every threshold in all four rooms and only commits canonical room references", () => {
    expect(NARRATIVE_ROOM_IDS).toHaveLength(4);
    for (const room of NARRATIVE_ROOM_IDS) {
      expect(AUTHORED_ROOM_THRESHOLDS.filter((threshold) => threshold.roomId === room)).toHaveLength(4);
    }
    const authority = new NarrativeAuthority();
    const rooms: readonly NarrativeRoomId[] = [
      "FORCED_ALIGNMENT",
      "IN_BETWEEN",
      "POLARIZED",
      "INFORMATION",
    ];
    rooms.forEach((room, index) => {
      const fromRoom = index === 0 ? "INFORMATION" : rooms[index - 1] as NarrativeRoomId;
      authority.consume(event("room.transition.world_swap.commit", {
        generation: index,
        fromRoom,
        toRoom: room,
      }, index + 1));
    });
    expect(authority.snapshot().visitedRooms).toEqual(NARRATIVE_ROOM_IDS);
    expect(authority.snapshot().activeRoom).toBe("INFORMATION");
  });

  it("projects all eight authored boss resolutions as facts and material remainders", () => {
    const authority = new NarrativeAuthority();
    AUTHORED_BOSS_RESOLUTIONS.forEach((definition, index) => {
      authority.consume(event("boss.encounter.resolve", {
        bossId: definition.bossId,
        generation: index,
        outcome: definition.resolutionId,
        finalPhaseId: `phase-${index}`,
      }, index + 1));
    });
    expect(authority.snapshot().bossResolutions.map(({bossId, resolutionId, fact, materialRemainder}) => ({
      bossId,
      resolutionId,
      fact,
      materialRemainder,
    }))).toEqual(AUTHORED_BOSS_RESOLUTIONS.map(({bossId, resolutionId, fact, materialRemainder}) => ({
      bossId,
      resolutionId,
      fact,
      materialRemainder,
    })));
  });

  it("reaches every authored world-reaction edge from canonical gameplay facts", () => {
    const authority = new NarrativeAuthority();
    const sourceEvents = [
      event("flower.intensity.commit", {source: "SIGNAL", targetIntensity: 0.4}, 1),
      event("flower.intensity.commit", {source: "FOCUS", targetIntensity: 0.2}, 2),
      event("flower.intensity.commit", {source: "GAZE", targetIntensity: 0.1}, 3),
      event("projectile.graze.commit", {
        projectileId: "p1",
        projectileGeneration: 1,
        playerId: "player",
        evidence: 1,
      }, 4),
      event("flower.intensity.commit", {source: "OVERRIDE", targetIntensity: 0.8}, 5),
      event("snapshot.begin", {runId: "run"}, 6),
      event("room.transition.room_ready", {generation: 1, room: "INFORMATION"}, 7),
      event("weather.omen.begin", {weather: "STATIC", cycle: 1, activeAtMs: 500}, 8),
      event("cross_run.scar.write.commit", {
        cycle: 1,
        scarType: "DIRECTIONAL_VOID",
        roomId: "INFORMATION",
        x: 120,
        y: 320,
        directionX: 1,
        directionY: 0,
      }, 9),
    ];
    authority.consumeMany(sourceEvents);
    const projected = new Set(authority.snapshot().reactions.map(({from, to, event: reaction}) =>
      `${from}\u0000${to}\u0000${reaction}`));
    for (const edge of AUTHORED_WORLD_REACTION_EDGES) {
      expect(projected.has(`${edge.from}\u0000${edge.to}\u0000${edge.event}`), JSON.stringify(edge)).toBe(true);
    }
  });

  it("is idempotent for an identical occurrence and rejects a conflicting duplicate", () => {
    const authority = new NarrativeAuthority();
    const committed = event("flower.intensity.commit", {
      source: "SIGNAL",
      targetIntensity: 0.42,
    }, 1, "same-occurrence");
    authority.consume(committed);
    const once = authority.canonicalSerialization();
    authority.consume(committed);
    expect(authority.canonicalSerialization()).toBe(once);
    const conflict = {
      ...committed,
      payload: {...committed.payload, targetIntensity: 0.8},
    } as CanonicalGameplayEvent;
    expect(() => authority.consume(conflict)).toThrow(/conflicting duplicate/);
  });

  it("is bit-stable across delivery chunks and presentation cadence", () => {
    const memory = makeMemory();
    const options: NarrativeAuthorityOptions = {
      previousRun: validateNarrativeRecord(memory, assertRunMemory),
      snapshotRecord: validateNarrativeRecord(memory, assertRunMemory),
    };
    const events = stateSequence(memory);
    const oneByOne = new NarrativeAuthority(options);
    events.forEach((committed) => oneByOne.consume(committed));
    const chunked = new NarrativeAuthority(options);
    chunked.consumeMany(events.slice(0, 7));
    chunked.snapshot();
    chunked.consumeMany(events.slice(7, 19));
    chunked.snapshot();
    chunked.consumeMany(events.slice(19));
    expect(chunked.canonicalSerialization()).toBe(oneByOne.canonicalSerialization());
    const replay = new NarrativeAuthority(options);
    replay.consumeMany(events);
    expect(replay.canonicalSerialization()).toBe(oneByOne.canonicalSerialization());
  });

  it("keeps weather entirely in presentation projection", () => {
    const authority = new NarrativeAuthority();
    const before = authority.snapshot();
    authority.consumeMany([
      event("weather.omen.begin", {weather: "RAIN", cycle: 3, activeAtMs: 400}, 1),
      event("weather.active.begin", {weather: "RAIN", cycle: 3}, 2),
      event("weather.aftermath.begin", {weather: "RAIN", cycle: 3}, 3),
      event("weather.cooldown.begin", {weather: "RAIN", cycle: 3}, 4),
      event("weather.complete", {weather: "RAIN", cycle: 3}, 5),
    ]);
    const after = authority.snapshot();
    expect({
      state: after.state,
      activeRoom: after.activeRoom,
      visitedRooms: after.visitedRooms,
      bossResolutions: after.bossResolutions,
      transitions: after.transitions,
      crossRun: after.crossRun,
      observations: after.observations,
      handoffReady: after.handoffReady,
    }).toEqual({
      state: before.state,
      activeRoom: before.activeRoom,
      visitedRooms: before.visitedRooms,
      bossResolutions: before.bossResolutions,
      transitions: before.transitions,
      crossRun: before.crossRun,
      observations: before.observations,
      handoffReady: before.handoffReady,
    });
    expect(after.weather).toMatchObject({weather: "RAIN", cycle: 3, phase: "COMPLETE"});
    expect(after.reactions.length).toBeGreaterThan(0);
  });

  it("fails fast on unknown room, boss, weather, event id, and factual resolution", () => {
    expect(() => new NarrativeAuthority().consume(event("room.transition.room_ready", {
      generation: 1,
      room: "INFO_OVERFLOW",
    }, 1))).toThrow(/unknown narrative room/);
    expect(() => new NarrativeAuthority().consume(event("boss.encounter.resolve", {
      bossId: "invented-boss",
      generation: 1,
      outcome: "INVENTED",
      finalPhaseId: "phase",
    }, 1))).toThrow(/unknown authored boss/);
    expect(() => new NarrativeAuthority().consume(event("boss.encounter.resolve", {
      bossId: "no_dusk",
      generation: 1,
      outcome: "PROTOCOL_WITHDRAWAL",
      finalPhaseId: "phase",
    }, 1))).toThrow(/unauthored factual resolution/);
    expect(() => new NarrativeAuthority().consume(event("weather.omen.begin", {
      weather: "GLITCH",
      cycle: 1,
      activeAtMs: 200,
    }, 1))).toThrow(/unknown narrative weather/);
    const valid = event("flower.intensity.commit", {source: "SIGNAL", targetIntensity: 0.4}, 1);
    expect(() => new NarrativeAuthority().consume({...valid, id: "unknown.event"} as CanonicalGameplayEvent))
      .toThrow(/unknown canonical gameplay event id/);
  });

  it("reads cross-run material and ghost facts only through an immutable validated record", () => {
    const memory = makeMemory();
    const token = validateNarrativeRecord(memory, assertRunMemory);
    memory.run.id = "mutated-after-validation";
    const authority = new NarrativeAuthority({previousRun: token});
    const immutableRecord = structuredClone(token.read()) as unknown as RunMemory;
    authority.consumeMany(restoreEvents(immutableRecord));
    const snapshot = authority.snapshot();
    expect(snapshot.crossRun[0]?.fromRunId).toBe("run-narrative-v4");
    expect(snapshot.crossRun.find(({eventId}) => eventId === "overrideScar.rehydrate")?.recordCount).toBe(1);
    expect(authority.canonicalSerialization()).not.toContain("payload-is-not-authority");
    expect(authority.canonicalSerialization()).not.toContain("mutated-after-validation");
    expect(() => new NarrativeAuthority().consume(restoreEvents(immutableRecord)[0] as CanonicalGameplayEvent))
      .toThrow(/validated previous-run record/);
  });

  it("covers all authored states and finishes with observation plus handoff", () => {
    const memory = makeMemory();
    const token = validateNarrativeRecord(memory, assertRunMemory);
    const authority = new NarrativeAuthority({previousRun: token, snapshotRecord: token});
    authority.consumeMany(stateSequence(memory));
    const snapshot = authority.snapshot();
    const covered = new Set([narrativeStateJsonInitial(), ...snapshot.transitions.map(({to}) => to)]);
    expect([...covered].sort()).toEqual([...NARRATIVE_STATE_IDS].sort());
    expect(snapshot.state).toBe("RUN_CYCLE_COMPLETE");
    expect(snapshot.observations.length).toBeGreaterThan(0);
    expect(snapshot.observations.length).toBeLessThanOrEqual(3);
    expect(snapshot.handoffReady).toBe(true);
    const serialized = authority.canonicalSerialization().toLowerCase();
    for (const forbidden of ["score", "rank", "victory", "defeat", "success", "failure", "good", "bad"]) {
      expect(new RegExp(`\\b${forbidden}\\b`, "u").test(serialized)).toBe(false);
    }
  });

  it("parses and evaluates all 64 authored observation conditions without eval", () => {
    expect(AUTHORED_SNAPSHOT_OBSERVATIONS).toHaveLength(64);
    for (const definition of AUTHORED_SNAPSHOT_OBSERVATIONS) {
      const record = validateNarrativeRecord(satisfyObservation(definition), assertRunMemory);
      expect(evaluateObservationCondition(definition.id, record), definition.id).toBe(true);
      const selected = selectSnapshotObservations(record);
      expect(selected.length).toBeLessThanOrEqual(3);
      expect(new Set(selected.map(({category}) => category)).size).toBe(selected.length);
      for (const observation of selected) {
        expect(observation.trace.length).toBeGreaterThan(0);
      }
    }
  });
});

function narrativeStateJsonInitial(): string {
  return "BOOT_REHYDRATE";
}
